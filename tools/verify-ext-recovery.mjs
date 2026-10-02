// ===== 验证脚本：#802 外置功能包「加载失败」页面侧自愈 =====
// 立项（用户实报「更多功能里的小功能全部，打开显示加载失败」）：外置化后 35 个 js 任一拉取失败
// ＝该功能永久死、页面零重试。修复三层：build.mjs 外置标签 onerror 记 __mochiExtFail（#802a）／
// pwa.js 三波自动重注入 + 顶部恢复条（#802b）／sw.js js/* 缓存优先+后台刷新（#802c）。
// 本脚本做行为断言（不 mock 产品码，/js/* 故障由服务端真实 404 注入）：
//   S 阶段（正常服务，对照）：S1 全部 ext 执行（差集空）；S2 恢复条从未出现（不误报）。
//   R 阶段（/js/* 一律 404 → 页面加载完成后放开为 200）：
//     R1 结构：产物 index.html 外置标签带 onerror=__mochiExtFail 标记（≥30 条）；
//     R2 恢复条在 ~19s 内出现（三波静默重试后）且文案带计数；
//     R3 诊断环补了 [ext-recovery] 一条；
//     R4 点「点此重试」→ 放开的 200 被重新注入执行：差集清零、window.openDecision 变 function；
//     R5 全部到位后恢复条自动撤下。
//   P 阶段（#1035 按 URL 钉死的坏响应：裸地址一律 404、带 ?mb= 的换址请求 200）：
//     P1 裸址三波全灭后「换址逃生」把缺口清零（功能入口当场复活，无需刷新）；
//     P2 每次换址的键都不同（会话戳.次数）＝不会复用同一条坏缓存；
//     P3 到位后恢复条自动撤下；
//     P4 同一上下文再开一次页面：脚本零失败、零缺口、不必再走换址＝好字节已按裸路径写回 SW 缓存
//        （一次修好长期有效，而不是每次开页赌 26s 的换址波）。
//   B 阶段（换址也只拿回一段 HTML 错误页＝门户/代理塞回的坏体）：
//     B1 验真拦下＝坏体绝不执行（openDecision 仍不是函数、不多一处假 SyntaxError），条如实挂着；
//     B2 条上有「知道了」；B3 点它＝本会话不再出现该条（只关提醒，不拦后台自愈）；
//     B4 之后网络恢复＝一次开页即全好＝坏体从没被写进缓存（防「修好了却 permanently 更坏」）。
// 用法：node tools/verify-ext-recovery.mjs（需 playwright；MOCHI_ROOT 可指仓外副本做红/绿基线：
//       纯 HEAD 副本（无修复）应在 R4/R5＋P1~P4＋B1~B4 处红＝判别力在）。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const SERVE_ROOT = normalize(process.env.MOCHI_ROOT || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const isJsArtifact = (p) => extname(p) === '.js' && p.indexOf(sep + 'js' + sep) >= 0;

let jsFailMode = false; // true：/js/* 一律 404（故障注入）
// #1035 P 阶段：坏响应「按 URL 生效」——裸地址永远拿不到，带 ?mb= 的换址地址正常 200。
// 这正是旧自愈修不好的那一类：三波重注入与用户点重试用的是同一个裸地址＝每波取回同一份坏响应。
let pinBareFail = false;
// #1035 B 阶段：换址地址也只拿回一段 HTML 错误页（门户/代理塞回的坏体）＝验真必须拦下
let badBodyMode = false;
const stat = { js200: 0, js404: 0, pin404: 0, bustSeen: new Set(), badBodyServed: 0 };
const srv = createServer((req, res) => {
  let p = '';
  try {
    p = normalize(join(SERVE_ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(SERVE_ROOT)) { res.writeHead(403); res.end(); return; }
    const hasQuery = req.url.indexOf('?') >= 0;
    if (isJsArtifact(p)) {
      if (jsFailMode) { stat.js404++; res.writeHead(404); res.end('nf'); return; }
      if (pinBareFail && !hasQuery) { stat.pin404++; res.writeHead(404); res.end('nf'); return; }
      if (hasQuery) stat.bustSeen.add(req.url);
      if (badBodyMode && hasQuery) {
        stat.badBodyServed++;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><head><title>503 Backend Fetch Failure</title></head><body>origin unreachable</body></html>');
        return;
      }
    }
    const body = readFileSync(p);
    if (isJsArtifact(p)) stat.js200++;
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('nf');
    if (p && isJsArtifact(p)) stat.js404++;
  }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;

let fails = 0;
function check(tag, desc, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + tag + ' ' + desc + (detail ? '  [' + detail + ']' : ''));
  if (!ok) fails++;
}
async function newState(ctx) {
  const page = await ctx.newPage();
  return page;
}
async function poll(page, fn, timeoutMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(stepMs || 300);
  }
}

const browser = await chromium.launch();

// ===== R1 结构断言（读产物 HTML，不需起页面） =====
{
  let html = '';
  try { html = readFileSync(join(SERVE_ROOT, 'index.html'), 'utf8'); } catch (e) {}
  const n = (html.match(/onerror="window\.__mochiExtFail=/g) || []).length;
  check('R1', '产物外置标签带 onerror=__mochiExtFail 标记', n >= 30, '命中 ' + n + ' 条');
}

// ===== S 阶段：正常服务（对照：自愈引擎不得误报） =====
{
  jsFailMode = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newState(ctx);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await sleep(8000); // 盖过第 1、2 波自愈扫描（1.5s/6s）
  const st = await page.evaluate(() => ({
    missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0),
    bar: !!document.getElementById('ext-recovery-bar')
  }));
  check('S1', '正常网络下 ext 全部执行（差集空）', st.missing.length === 0, '缺 ' + st.missing.length);
  check('S2', '正常网络下恢复条从未出现（不误报）', !st.bar, st.bar ? 'bar 在' : '');
  await ctx.close();
}

// ===== R 阶段：故障注入（/js/* 404）→ 页面加载完成后放开 200 → 点恢复条 → 功能复活 =====
{
  jsFailMode = true;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newState(ctx);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  const st0 = await page.evaluate(() => ({
    missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0),
    failMarked: (window.__mochiExtFail || []).length
  }));
  check('R0', '故障注入下 ext 缺口与 onerror 标记在案', st0.missing.length >= 30 && st0.failMarked >= 30, '缺 ' + st0.missing.length + ' / 标记 ' + st0.failMarked);
  const barShown = await poll(page, async () => page.evaluate(() => {
    const b = document.getElementById('ext-recovery-bar');
    return !!b && b.hidden === false && /个功能包/.test(b.textContent || '');
  }), 40000, 400);
  check('R2', '三波静默重试后恢复条出现', barShown, '40s 内未出现');
  if (barShown) {
    const diag = await page.evaluate(() => (window.__jsErrors || []).filter((s) => String(s).indexOf('[ext-recovery]') >= 0).length);
    check('R3', '诊断环补 [ext-recovery] 一条', diag >= 1, '命中 ' + diag);
    jsFailMode = false; // 网络恢复
    // 开屏层（#splash）在故障场景可能仍盖在最上（#784 同款教训）：点按走元素 .click()
    //（真实触发监听器），不经坐标命中测试
    await page.evaluate(() => { const b = document.getElementById('ext-recovery-bar'); if (b) b.click(); });
    const healed = await poll(page, async () => page.evaluate(() =>
      (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length === 0 &&
      typeof window.openDecision === 'function'
    ), 30000, 400);
    const stEnd = await page.evaluate(() => ({
      missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0),
      openDecision: typeof window.openDecision
    }));
    check('R4', '点重试后缺口清零、功能入口当场复活（无需刷新）', healed && stEnd.missing.length === 0 && stEnd.openDecision === 'function',
      '缺 ' + stEnd.missing.length + ' openDecision=' + stEnd.openDecision);
    const barGone = await poll(page, async () => page.evaluate(() => {
      const b = document.getElementById('ext-recovery-bar');
      return !b || b.hidden === true;
    }), 10000, 300);
    check('R5', '全部到位后恢复条自动撤下', barGone);
  }
  await ctx.close();
}

// ===== P 阶段（#1035）：坏响应「按 URL 生效」＝裸址永远 404、换址地址 200 =====
// 旧自愈在这种故障下永远修不好：三波重注入与用户点「点此重试」用的都是同一个裸地址，
// 每一发都取回同一份坏响应（iQOO+Edge 实报的 fullscreen.js 连续两天每次开页必报＝同形）。
{
  jsFailMode = false; pinBareFail = true; badBodyMode = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newState(ctx);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  const st0 = await page.evaluate(() => (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length);
  check('P0', '裸址钉死时 ext 整批没到位（正是旧自愈修不好的那一类）', st0 >= 30, '缺 ' + st0);
  const healed = await poll(page, async () => page.evaluate(() =>
    (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length === 0 &&
    typeof window.openDecision === 'function'
  ), 60000, 500);
  const st1 = await page.evaluate(() => ({
    missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length,
    openDecision: typeof window.openDecision
  }));
  check('P1', '裸址三波全灭后「换址逃生」清零缺口、功能入口当场复活（无需刷新）', healed && st1.missing === 0 && st1.openDecision === 'function',
    '缺 ' + st1.missing + ' openDecision=' + st1.openDecision + ' 裸址404=' + stat.pin404);
  const keys = Array.from(stat.bustSeen);
  check('P2', '换址请求带「会话戳.次数」且一发一键（不复用任何可能已被钉死的键）',
    keys.length >= 30 && keys.every((u) => /[?&]mb=[a-z0-9]+\.\d+$/.test(u)), keys.length + ' 个不同地址');
  const barGoneP = await poll(page, async () => page.evaluate(() => {
    const b = document.getElementById('ext-recovery-bar');
    return !b || b.hidden === true;
  }), 15000, 300);
  check('P3', '换址到位后恢复条自动撤下', barGoneP);
  //  durable：换址取回的好字节按**裸路径**写回 SW 缓存＝同会话再开一次页面直接命中缓存，
  //  脚本标签零失败、也不必再走 26s 的换址波（判据取页面侧事实：SW 每次命中后仍会按 #802c
  //  后台刷新发一发裸址请求，那是既有设计、不算自愈失败，故只看「页面有没有再报错」）。
  const pinBefore = stat.pin404;
  const bustBefore = stat.bustSeen.size;
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await sleep(6000);
  const st2 = await page.evaluate(() => ({
    missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length,
    extFail: (window.__mochiExtFail || []).length
  }));
  check('P4', '好字节已按裸路径写回缓存：再开一次页面脚本零失败、不必再走换址（一次修好长期有效）',
    st2.missing === 0 && st2.extFail === 0 && stat.bustSeen.size === bustBefore,
    '缺=' + st2.missing + ' 脚本失败标记=' + st2.extFail + ' 新增换址请求=' + (stat.bustSeen.size - bustBefore) +
    ' 新增裸址请求=' + (stat.pin404 - pinBefore));
  await ctx.close();
}

// ===== B 阶段（#1035）：换址也只拿回一段 HTML 错误页（门户/代理塞回的坏体） =====
{
  jsFailMode = false; pinBareFail = true; badBodyMode = true;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newState(ctx);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  const barShownB = await poll(page, async () => page.evaluate(() => {
    const b = document.getElementById('ext-recovery-bar');
    return !!b && b.hidden === false && /个功能包/.test(b.textContent || '');
  }), 40000, 400);
  // 换址波排在裸址三波之后（26s），条出现在 ~19s——只等条出现就判会被「还没走到换址」骗过去，
  // 这里再等服务器真切回过一段坏体（验真这一闸才有现场可判）。
  const badSeen = await poll(null, async () => stat.badBodyServed > 0, 40000, 500);
  const stb = await page.evaluate(() => ({
    missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length,
    openDecision: typeof window.openDecision,
    hasOff: !!document.querySelector('#ext-heal-off'),
    syntax: (window.__jsErrors || []).filter((s) => /SyntaxError|Unexpected token/i.test(String(s))).length
  }));
  check('B1', '坏体被验真拦下：绝不执行（不假复活、不多一处 SyntaxError），条也如实挂着',
    stb.missing >= 30 && stb.openDecision !== 'function' && stb.syntax === 0 && badSeen && stat.badBodyServed > 0 && barShownB,
    '缺 ' + stb.missing + ' badBody=' + stat.badBodyServed + ' 假语法错=' + stb.syntax + ' 条在=' + barShownB);
  check('B2', '条上有「知道了」（修不好时用户能关掉提醒，不必被常驻提示纠缠）', stb.hasOff);
  const offClicked = await page.evaluate(() => {
    const x = document.querySelector('#ext-heal-off');
    if (!x) return false;
    x.click();
    const b = document.getElementById('ext-recovery-bar');
    return !!b && b.hidden === true;
  });
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await sleep(25000); // 盖过「三波＋条出现」（~19s）：本会话已关过提醒就不得再出现
  const reShown = await page.evaluate(() => {
    const b = document.getElementById('ext-recovery-bar');
    return !!b && b.hidden === false;
  });
  check('B3', '点「知道了」后本会话不再出现该条（只关提醒，不拦后台自愈）', offClicked && !reShown,
    '点击即隐藏=' + offClicked + ' 重开又出现=' + reShown);
  // B4：坏体绝不进缓存（sw.js 写缓存侧的验真闸）。#1035 之后裸键是逃生写回的目标，一旦把
  // 门户/代理的 200 + text/html 错误页缓存下来＝下次开页直接命中坏体、脚本 parse 期就死
  // （连 onerror 都不触发，页面侧自愈根本记不到它）＝「修好了却 permanently 更坏」。
  pinBareFail = false; badBodyMode = false;
  const bustB = stat.bustSeen.size;
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  const okB4 = await poll(page, async () => page.evaluate(() =>
    (window.__mochiExtFiles || []).length > 30 &&
    (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length === 0
  ), 20000, 400);
  const stb4 = await page.evaluate(() => ({
    missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length,
    syntax: (window.__jsErrors || []).filter((s) => /SyntaxError|Unexpected token/i.test(String(s))).length
  }));
  check('B4', '网络恢复后一次开页即全好＝坏体从没被缓存过（不需换址、无假 SyntaxError）',
    okB4 && stb4.missing === 0 && stb4.syntax === 0 && stat.bustSeen.size === bustB,
    '缺=' + stb4.missing + ' 假语法错=' + stb4.syntax + ' 换址请求=' + (stat.bustSeen.size - bustB));
  await ctx.close();
}

jsFailMode = false; pinBareFail = false; badBodyMode = false;
await browser.close();
srv.close();
console.log('服务器 /js/*：200=' + stat.js200 + ' 404=' + stat.js404 + ' 裸址钉死404=' + stat.pin404 +
  ' 换址请求=' + stat.bustSeen.size + ' 坏体=' + stat.badBodyServed + '（服务根：' + SERVE_ROOT + '）');
console.log(fails ? '✗ verify-ext-recovery 失败 ' + fails + ' 条' : '✓ verify-ext-recovery 全部通过');
process.exit(fails ? 1 : 0);

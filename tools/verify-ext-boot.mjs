// ===== 验证脚本：PERF-PLAN 阶段 1b「core 全外置」404 桩裁决门（D5 三断言版） =====
// 前身＝阶段 1 裁决门（「core 不依赖 ext 加载期全局」）；core 归零后该前提失效（PERF-PLAN
// 阶段 1b D2/D5），本脚本按 D5 重定义。实现要点沿用：verify 用时间戳临时 profile 启 Chrome，
// 首屏导航不受 SW 控制，404 桩是真 404；服务端计数 /js/* 的 200/404 防「桩没生效」假绿。
// 断言：
//   S 阶段（正常服务，基线）：S1 期望清单全部执行完；S2 外置入口 typeof 就绪（openRoom）；
//     S3 /js/* 全 200 且请求数 ≥20；S4 __mochiDataReady 为真（数据链闭环）。
//   G1 全缺兜底（/js/* 一律 404）：文档骨架完整（#splash/.phone/#page-chat）、零未捕获
//     异常、boot 看门狗 12s 内挂出重试条（#boot-retry-bar）、__mochiBootRetry 可调（不真点，
//     点＝整页 reload 无断言价值）、服务器侧 js 请求全部 404（桩真生效）。
//   G2 部分缺失不连坐（每第 5 个 js 文件 404 ≈ 20%）：其余文件全部执行完
//     （__mochiLoaded ⊇ 非 404 集）、__jsErrors 为空（defer 下单资源失败不阻塞后续）。
// 用法：node tools/verify-ext-boot.mjs（需 playwright；产物 index.html + js/ 必须已构建）
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const isJsArtifact = (p) => extname(p) === '.js' && p.indexOf(sep + 'js' + sep) >= 0;
// G2 桩名单：产物 js/ 目录里每第 5 个文件（稳定「随机」20%，可复现）
const jsArtifacts = (() => {
  try { return readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')).sort().filter((f, i) => i % 5 === 0); } catch (e) { return []; }
})();

function makeServer(stubSet) {
  const stat = { js200: 0, js404: 0 };
  const all404 = Array.isArray(stubSet) && stubSet[0] === '*';
  const srv = createServer((req, res) => {
    let p = '';
    try {
      p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const base = p.split(sep).pop();
      if (stubSet && (all404 || stubSet.indexOf(base) >= 0) && isJsArtifact(p)) { stat.js404++; res.writeHead(404); res.end('nf'); return; }
      const body = readFileSync(p);
      if (isJsArtifact(p)) stat.js200++;
      res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) {
      res.writeHead(404); res.end('nf');
      if (p && isJsArtifact(p)) stat.js404++;
    }
  });
  return { stat, ready: new Promise((r) => srv.listen(0, '127.0.0.1', r)), srv };
}

async function bootPage(base, browser, settleMaxMs, waitBarMs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 等 __mochiLoaded 增长停滞（defer 外置全部执行完），最长 settleMaxMs（G2 要等 #802
  // 自愈引擎三波补枪后仍稳定的差集）
  const deadline = Date.now() + (settleMaxMs || 6000);
  let prev = -1, stable = 0;
  while (Date.now() < deadline && stable < 8) {
    const n = await page.evaluate(() => (window.__mochiLoaded || []).length);
    if (n === prev) stable++; else { stable = 0; prev = n; }
    await sleep(100);
  }
  // G1 专用：看门狗条在 load+3s/8s 才挂出，稳定判定不会等到它——显式轮询
  if (waitBarMs) {
    const barDeadline = Date.now() + waitBarMs;
    while (Date.now() < barDeadline) {
      if (await page.evaluate(() => !!document.getElementById('boot-retry-bar'))) break;
      await sleep(250);
    }
  }
  const state = await page.evaluate(() => ({
    jsErrors: window.__jsErrors || null,
    expected: window.__mochiJsFiles || null,
    ext: window.__mochiExtFiles || null,
    loaded: window.__mochiLoaded || null,
    dataReady: !!window.__mochiDataReady,
    bootRetry: typeof window.__mochiBootRetry,
    bootBar: !!document.getElementById('boot-retry-bar'),
    hasSplash: !!document.getElementById('splash'),
    hasPhone: !!document.querySelector('.phone'),
    hasChat: !!document.getElementById('page-chat'),
    openRoom: typeof window.openRoom
  }));
  await ctx.close();
  return state;
}

let fails = 0;
function check(tag, desc, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + tag + ' ' + desc + (detail ? '  [' + detail + ']' : ''));
  if (!ok) fails++;
}

const browser = await chromium.launch();

// ===== S 阶段：正常服务（基线，证明外置接线正确、全部可执行） =====
{
  const srv1 = makeServer(null);
  await srv1.ready;
  const base = 'http://127.0.0.1:' + srv1.srv.address().port;
  const state = await bootPage(base, browser, 15000);
  const missing = (state.expected || []).filter((n) => (state.loaded || []).indexOf(n) < 0);
  check('S1', '正常服务：期望清单全部执行完（差集=空）', state.expected && state.loaded && missing.length === 0, 'missing=' + missing.join(','));
  check('S2', '正常服务：外置入口 typeof 就绪（openRoom）', state.openRoom === 'function', 'typeof=' + state.openRoom);
  check('S3', '正常服务：/js/* 全部 200 且有请求', srv1.stat.js200 >= 20 && srv1.stat.js404 === 0, '200=' + srv1.stat.js200 + ' 404=' + srv1.stat.js404);
  check('S4', '正常服务：数据链就绪（__mochiDataReady）', state.dataReady === true, 'dataReady=' + state.dataReady);
  // S5（#860 D2 执行序守卫）：__mochiLoaded 的执行序必须与产物 defer 标签序逐位一致
  // （前 2 位=内联系统件 device/pwa，其后=EXT_TAG_ORDER；2026-10-01 停更收口起 ver-check 退役）。
  // 标签序被改（如改回
  // 「全 jsFiles 序」）＝存在「晚执行才安全」加载期依赖的文件被整体提前，行为脚本会静默翻红。
  const htmlArt = readFileSync(join(root, 'index.html'), 'utf8');
  const tagOrder = [...htmlArt.matchAll(/<script defer src="js\/([a-z0-9-]+\.js)"/g)].map((m) => m[1]);
  const loaded = state.loaded || [];
  const expectOrder = ['device.js', 'pwa.js'].concat(tagOrder);
  let orderOk = loaded.length === expectOrder.length;
  if (orderOk) for (let i = 0; i < expectOrder.length; i++) if (loaded[i] !== expectOrder[i]) { orderOk = false; break; }
  check('S5', '#860 执行序守卫：__mochiLoaded 逐位等于「2 内联件 + defer 标签序」', orderOk, orderOk ? '前6=' + loaded.slice(0, 6).join(',') : '首处差异 @' + loaded.findIndex((n, i) => n !== expectOrder[i]));
  srv1.srv.close();
}

// ===== G1 阶段：/js/* 一律 404（D5-G1 全缺兜底：骨架完整 + 看门狗出条） =====
{
  const srvAll = makeServer(['*']);
  await srvAll.ready;
  const base = 'http://127.0.0.1:' + srvAll.srv.address().port;
  const state = await bootPage(base, browser, 14000, 14000);
  const missing = (state.expected || []).filter((n) => (state.loaded || []).indexOf(n) < 0);
  check('G1a', '全缺：window.__jsErrors 为空', Array.isArray(state.jsErrors) && state.jsErrors.length === 0, JSON.stringify(state.jsErrors));
  check('G1b', '全缺：文档骨架完整（#splash/.phone/#page-chat）', state.hasSplash && state.hasPhone && state.hasChat, 'splash=' + state.hasSplash + ' phone=' + state.hasPhone + ' chat=' + state.hasChat);
  check('G1c', '全缺：开屏看门狗挂出重试条（#boot-retry-bar）', state.bootBar === true, 'bar=' + state.bootBar);
  check('G1d', '全缺：__mochiBootRetry 可调（typeof function，不真点＝点会整页 reload）', state.bootRetry === 'function', 'typeof=' + state.bootRetry);
  const extMissing = (state.ext || []).slice().sort();
  const missingSorted = missing.slice().sort();
  check('G1e', '全缺：差集恰=外置全集（仅 3 件内联系统件执行、79 件 ext 全没执行）', JSON.stringify(missingSorted) === JSON.stringify(extMissing) && missing.length > 0, 'missing=' + missing.length + '/' + (state.expected || []).length);
  check('G1f', '全缺：/js/* 有请求且全部 404（桩真生效）', srvAll.stat.js404 >= 20 && srvAll.stat.js200 === 0, '200=' + srvAll.stat.js200 + ' 404=' + srvAll.stat.js404);
  srvAll.srv.close();
}

// ===== G2 阶段：每第 5 个 js 文件 404（D5-G2 部分缺失不连坐） =====
{
  if (!jsArtifacts.length) { check('G2', '部分缺失：js/ 产物缺失（先构建）', false, 'jsArtifacts=0'); }
  else {
    const srv3 = makeServer(jsArtifacts);
    await srv3.ready;
    const base = 'http://127.0.0.1:' + srv3.srv.address().port;
    const state = await bootPage(base, browser, 20000);
    const stubbed = state.expected ? state.expected.filter((n) => jsArtifacts.indexOf(n) >= 0) : [];
    const missing = (state.expected || []).filter((n) => (state.loaded || []).indexOf(n) < 0);
    const extra = missing.filter((n) => stubbed.indexOf(n) < 0);
    check('G2a', '部分缺失：未执行差集恰为 404 名单（非桩文件零连坐）', state.expected && extra.length === 0 && stubbed.length > 0, 'extra=' + extra.join(',') + ' stubbed=' + stubbed.length + '/' + (state.expected || []).length);
    check('G2b', '部分缺失：window.__jsErrors 为空', Array.isArray(state.jsErrors) && state.jsErrors.length === 0, JSON.stringify(state.jsErrors));
    check('G2c', '部分缺失：/js/* 既有 200 也有 404（桩真生效）', srv3.stat.js200 >= 20 && srv3.stat.js404 >= stubbed.length, '200=' + srv3.stat.js200 + ' 404=' + srv3.stat.js404);
    srv3.srv.close();
  }
}

await browser.close();
console.log(fails === 0 ? '\nverify-ext-boot: ALL PASS' : '\nverify-ext-boot: ' + fails + ' FAIL');
process.exit(fails === 0 ? 0 : 1);

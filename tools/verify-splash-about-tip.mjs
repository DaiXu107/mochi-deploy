// ===== #864 开屏顶部「公告已精简 · 使用说明请看【设置 → 关于】」指引条验证（无头 Chrome，自组装 src，不依赖仓库产物）=====
// 立项：用户 2026-09-19 直派「开屏显眼的地方，顶部需要说明。公告内容已缩减，原公告内容的很多使用说明
//   已移动至【设置】的【关于】里」。
// 背景：#792 已把「数据与存储（重要）」等 5 行进 设置→关于，并把「有问题先去关于看」写进开屏公告的
//   必读摘要首条——但那一条在公告卡里、位于五张警示卡之下，不是开屏顶部的第一眼位置（用户要的是「顶部」）。
//   本批在品牌卡内（署名行与 #793 停更公告横幅之间）补一条静态指引条，在线 notice.json 覆盖碰不到它。
// 断言：①静态 src（指引条/样式/哨兵登记唯一/指向内容确实在位）；②行为（位置＝品牌卡内且在停更横幅之上、
//   首屏可见、明暗两套配色真的落了层、文本指向设置→关于）。
// #976（2026-09-21）：7 张必读卡整组前移到品牌卡之前（#splash-mustread），本指引条同批搬入该组，
//   位置类断言（B2/B3）随口径更新为「在必读卡组内、排在品牌卡之前」；文案/配色/暗色断言不变。
// 用法：node tools/verify-splash-about-tip.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };
const countOf = (hay, needle) => hay.split(needle).length - 1;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

// ===== 静态：src =====
const tpl = readSrc('template.html');
const base = readSrc('css/base.css');
const build = (() => { try { return readFileSync(join(root, 'build.mjs'), 'utf8'); } catch (e) { return ''; } })();
const notice = (() => { try { return JSON.parse(readSrc('pwa/notice.json')); } catch (e) { return null; } })();

const TIP_TXT = '公告已精简：原公告里的大量使用说明已移到';
ok(tpl.includes('class="splash-abouttip"') && tpl.includes('data-about-tip="1"'), 'S1a 开屏指引条块在 template.html（.splash-abouttip + data-about-tip）');
ok(tpl.includes(TIP_TXT) && tpl.includes('【设置 → 关于】'), 'S1b 指引条文案＝公告已精简 + 指向【设置 → 关于】');
ok(base.includes('.splash-abouttip {') && base.includes('.splash-abouttip strong { color:#c2410c'), 'S2a 指引条样式在 base.css（块 + 强调色）');
ok(base.includes('[data-theme="dark"] .splash-abouttip {') && base.includes('[data-theme="dark"] .splash-abouttip strong {'), 'S2b 暗色主题变体在 base.css');
ok(countOf(tpl, TIP_TXT) === 1, 'S3a 指引条文案在 template.html 内唯一（哨兵 needle 判别力前提）', 'count=' + countOf(tpl, TIP_TXT));
// 样式哨兵必须取「minifyCss 后逐字节不变」的单行规则（多行块的首行 needle 在 src 与产物里都不存在，实测被本断言抓到过一次）
const CSS_NEEDLE = '.splash-abouttip p { font-size:12.5px; line-height:1.8; color:#8a3d05;';
ok(countOf(base, CSS_NEEDLE) === 1, 'S3b 样式 needle 在 base.css 内唯一且 minify 后不变', 'count=' + countOf(base, CSS_NEEDLE));
ok(countOf(build, CSS_NEEDLE) === 1, 'S3b2 哨兵 #864b 用的就是这条 needle（登记与断言同一口径）');
ok(build.includes('#864a') && build.includes('#864b'), 'S3c 哨兵 #864a/#864b 已登记 build.mjs');
ok(countOf(build, '#864a') === 1 && countOf(build, '#864b') === 1, 'S3d 哨兵编号在本仓库内唯一（无并行批撞号）', 'a=' + countOf(build, '#864a') + ' b=' + countOf(build, '#864b'));
// 指向必须是真的：设置→关于 里确实有被「移过去」的那批内容（指引条不许指向空气）
ok(tpl.includes('id="about-storage-note"') && ['lose', 'perm', 'incog', 'backup', 'bug'].every((k) => tpl.includes('id="row-faq-st-' + k + '"')), 'S4 指向的「设置 → 关于 · 数据与存储（重要）」5 行确实在位（指引条不指向空气）');
// 在线公告侧（notice.json 覆盖链路）同样指向关于。v8.44 #1216（2026-09-25 用户直派）把「必读摘要」整块撤除，
// 这条口径的在线落点随之改为目录里的「公告已精简」章——判据从 summary[0] 平移到该章正文，指向性不变。
const slimSec = ((notice && notice.sections) || []).find((x) => String(x.h).replace(/^\d+、/, '').indexOf('公告已精简') === 0); // #1500 目录统一编号：比对前剥掉「N、」前缀，对编号变化不敏感
const slimTxt = slimSec ? JSON.stringify(slimSec.p || '') : '';
ok(Array.isArray(notice.summary) && notice.summary.length === 0, 'S5a 在线 summary 已随 #1216 清空（残留＝联网用户仍看到半块摘要，与静态兜底分叉）');
ok(!!slimSec && slimTxt.includes('设置 → 关于'), 'S5 在线公告「公告已精简」章同样指向设置→关于（摘要撤除后它是唯一在线落点）', slimTxt.slice(0, 40));

// ===== 行为：自组装页（只用 base.css，开屏是静态 DOM，不需要业务脚本）=====
const styles = readSrc('css/base.css');
let html = tpl.replace('/*__STYLES__*/', styles);
html = html.split('__BUILD_INFO__').join('verify').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v3.26.x-vat864');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    if (req.url === '/' || req.url.split('?')[0] === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(tmpdir(), 'mochi-vat864-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
let jsErr = 0;
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { jsErr++; console.log('  JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(1200);

const light = J(await ev(`(function(){
  var tip=document.querySelector('.splash-abouttip');
  if(!tip) return JSON.stringify({present:false});
  var card=tip.closest('.splash-brandcard'); var must=tip.closest('#splash-mustread');
  var brand=document.querySelector('.splash-brand');
  var stop=document.querySelector('.splash-stopupdate');
  var noticed=document.getElementById('splash-notice');
  var cs=getComputedStyle(tip); var r=tip.getBoundingClientRect();
  var BEFORE=4, AFTER=2; // Node.compareDocumentPosition 位：AFTER=文档中位于其后
  return JSON.stringify({
    present:true, inBrand:!!card, inMust:!!must,
    beforeBrandCard: brand ? !!(tip.compareDocumentPosition(brand) & BEFORE) : false,
    beforeStop: stop ? !!(tip.compareDocumentPosition(stop) & BEFORE) : null,
    beforeNotice: noticed ? !!(tip.compareDocumentPosition(noticed) & BEFORE) : null,
    text: tip.textContent.replace(/\\s+/g,' ').trim(),
    h: Math.round(r.height), top: Math.round(r.top), vh: window.innerHeight,
    bg: cs.backgroundColor, border: cs.borderLeftColor, display: cs.display, vis: cs.visibility,
    firstScreen: r.top >= 0 && r.top < window.innerHeight
  });
})()`));
ok(light.present === true, 'B1 指引条渲染在页面上（.splash-abouttip 存在）');
// #976（2026-09-21）口径变更：7 张必读卡整组前移到 #splash-mustread（品牌卡之前），
//   指引条随之离开品牌卡内 —— B2/B3 由「在品牌卡内、紧跟署名」改为「在必读卡组内、排在品牌卡之前」，
//   用户当时要的「开屏显眼的地方、顶部」只强不弱（组在品牌卡之上，更靠前）。
ok(light.inMust === true && light.inBrand === false, 'B2 指引条在必读卡组（#splash-mustread）内、已离开品牌卡（#976 位置口径变更）');
ok(light.beforeBrandCard === true, 'B3 指引条排在品牌卡之前（必读卡组在品牌卡之上）');
ok(light.beforeStop === true, 'B4 指引条排在 #793 停更公告横幅之上（顶部第一眼位置）');
ok(light.beforeNotice === true, 'B5 指引条排在公告卡之前（不靠公告卡滚动才看见）');
ok(light.firstScreen === true, 'B6 390×844 下指引条落在首屏内（top=' + light.top + ' < vh=' + light.vh + '）');
ok(light.h >= 30, 'B7 指引条有可见高度（未被压成 0）h=' + light.h);
ok(/公告已精简/.test(light.text) && /使用说明/.test(light.text) && /设置 → 关于/.test(light.text), 'B8 文案＝公告已精简 + 使用说明已移到【设置 → 关于】');
// B9 判定词重锚（2026-10-01 #1536 同批顺手收口）：原词「…找答案，再去报修」是 #1503 下线报修章之前的旧口径
//   （与 verify-973 S14b 同款存量红，纯 origin/main 副本实测同红），#864 指引条现行权威句＝「有问题先去那里找答案即可。」
ok(/有问题先去那里找答案即可/.test(light.text), 'B9 文案给了下一步（有问题先去那里找答案即可，详见设置→关于）');
ok(light.display !== 'none' && light.vis === 'visible', 'B10 指引条未被隐藏（display=' + light.display + '）');

const darkBg = await ev(`(function(){
  document.documentElement.setAttribute('data-theme','dark');
  var tip=document.querySelector('.splash-abouttip'); if(!tip) return null;
  return getComputedStyle(tip).backgroundColor;
})()`);
ok(!!darkBg && darkBg !== light.bg, 'B11 暗色主题真的落了层（暗色背景 ' + darkBg + ' ≠ 明色 ' + light.bg + '）');
ok(jsErr === 0, 'Z 页面零 JS 异常');

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n' + (fail ? '✗' : '✓') + ' verify-splash-about-tip: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

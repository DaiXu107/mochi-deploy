// ===== #574 字卡库开页「空白干等 IDB」——本机读不到数据时先出加载态 =====
// 用户报障（2026-09-16，iPhone 14 Pro + Safari，明说**其他 iOS 机型也有**）：
//   「字卡库卡」，打开要 5、6 秒，且「也没有动画加载的缓冲」——点下去没反应，稍后内容突然出现。
// 根因（零机型分支；无头桩实测复现）：openCcPage 的首屏渲染被 hydrateCurScope() 门控——
//   本机（LS/内存/缓存）读不到该作用域时要等 idbHydrateKey 取回；iOS 挂后台会杀掉 IDB
//   连接，此时单次读最长 6s、重试链（6s+8s）最长 14s（桩实测 14024ms）。实测（cc-* 键永不
//   回调的挂起桩 + 该作用域 LS 无键）：打开字卡库后列表 17s 内始终只有占位、无任何卡片，
//   页面内零加载态（只有一个转瞬 toast），观感＝点开卡死。与用户描述吻合。
// 修复（chatcard.js 一处 + chat-pages.css 一条，零机型分支、不碰取回时机与写路径权威门控）：
//   需要取回时【先出加载行】「正在加载字卡…」（带旋转指示），取回落定由 render() 覆写；
//   延迟 150ms 才出＝空库/健康设备（一次 IDB 读几十毫秒）全程不出现，观感零变化。
// 断言（B1 对未含修复的产物为红＝症状复现；B2/B3 保证健康路径零回归）：
//   S1 产物含加载行标记与文案（.cc-lib-loading / 正在加载字卡…）
//   B1 IDB 挂起 + 该作用域 LS 无键：打开字卡库 ≤1s 内出现加载行（修前：DOM 里没有＝空白无反馈）
//   B2 健康 IDB + 公用库 LS 有数据：卡片照常渲染，且全程不出现加载行（零闪动）
//   B3 健康 IDB + 专属库空：加载行出现后于取回落定时被摘除（不残留）
//   Z 全程零未捕获 JS 错误
// 用法：node tools/verify-cc-lib-loading.mjs
//   SERVE_ROOT=<dir> 可指向隔离构建目录（避免与并行构建者抢根产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SERVE_ROOT ? normalize(process.env.SERVE_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
{
  let html = '';
  try { html = readFileSync(join(root, 'index.html'), 'utf8'); const jd=join(root,'js'); for (const f of readdirSync(jd)) if (f.endsWith('.js')) html += `\n${readFileSync(join(jd,f),'utf8')}`; } catch (e) {}
  check('S1 产物含字卡库加载行标记与文案', html.indexOf('cc-lib-loading') >= 0 && html.indexOf('正在加载字卡') >= 0, 'len=' + html.length);
}

const profileDir = join(process.env.TEMP || '/tmp', 'mochi-ccload-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9970 + Math.floor(Math.random() * 25));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disk-cache-size=1048576',
  '--user-data-dir=' + profileDir,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { chrome.kill(); } catch (e) {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {} // 不留 GB 级 profile
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let ws = null, msgId = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(m, p = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); }); }
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

// cc-* 键挂起桩：返回永不回调的假 request（模拟 iOS 挂后台杀 IDB 连接后首读卡住）
const HANG_SRC = `(function(){
  window.__hangIdb = true;
  var origGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function(k){
    if (window.__hangIdb && String(k).indexOf('cc-') >= 0) return { onsuccess: null, onerror: null, result: undefined, error: null };
    return origGet.call(this, k);
  };
})();`;
// 只清专属字卡 LS 键（模拟该作用域本机读不到、要走 IDB 取回）
const CLEAR_OWN = `(function(){ try { localStorage.removeItem('xy-home-v2:default:cc-groups'); } catch(e){} })();`;
// 公用库种子（模拟 LS 有数据的健康路径）
const SEED_PUB = `(function(){ try {
  var out = { text: [['日常', ['字卡一','字卡二','字卡三','字卡四']]] };
  localStorage.setItem('xy-home-v2:cc-groups-public', JSON.stringify(out));
} catch(e){} })();`;

await connect();
await cdp('Page.enable'); await cdp('Runtime.enable');

let initScriptIds = [];
async function openPage(initScripts) {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  // CDP 的 addScriptToEvaluateOnNewDocument 跨阶段累积，必须先移除上一阶段的注入，
  // 否则 B3 会带着 B1 的挂起桩跑（实测踩过：B3 判红实为挂起桩残留）
  for (const id of initScriptIds) { try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch (e) {} }
  initScriptIds = [];
  for (const src of initScripts) {
    const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: src });
    if (r && r.identifier) initScriptIds.push(r.identifier);
  }
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(700);
  await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
}
async function openLib(sel) {
  await ev("(function(){var t=document.querySelector('.tab[data-page=page-chatcard]');if(t)t.click();return true;})()");
  await sleep(300);
  return ev(`(function(){
    return new Promise(function(resolve){
      var t1 = performance.now();
      var li = document.querySelector('${sel}');
      var liFound = !!li;
      if (li) li.click();
      var sawLoading = 0, loadingAt = -1, cleared = false, cards = 0;
      var iv = setInterval(function(){
        var list = document.getElementById('cc-list');
        var row = list ? list.querySelector('.cc-lib-loading') : null;
        var n = document.querySelectorAll('#cc-list .cc-item').length;
        if (n > cards) cards = n;
        // 判定按「加载行进入 DOM」：无头环境祖先页可能被并行逻辑隐藏，计算样式不可靠
        if (row) { if (!sawLoading) loadingAt = Math.round(performance.now() - t1); sawLoading++; }
        else if (sawLoading) { cleared = true; }
        var el = performance.now() - t1;
        if (el > 2600) { clearInterval(iv); resolve(JSON.stringify({ liFound: liFound, loadingSeen: sawLoading > 0, loadingAt: loadingAt, cleared: cleared, cards: cards })); }
      }, 100);
    });
  })()`);
}

console.log('--- B1 IDB 挂起 + 专属字卡 LS 无键：打开即出加载态（修前＝空白无反馈） ---');
await openPage([HANG_SRC, CLEAR_OWN]);
{
  const r = JSON.parse(await openLib('#li-custom-cards') || '{}');
  check('B1 打开 ≤1s 内出现加载行', r.loadingSeen && r.loadingAt >= 0 && r.loadingAt <= 1000, JSON.stringify(r));
}

console.log('--- B2 健康 IDB + 公用库 LS 有数据：卡片照常渲染、不出现加载行（零闪动） ---');
await openPage([SEED_PUB]);
{
  const r = JSON.parse(await openLib('#li-custom-cards-public') || '{}');
  check('B2a 卡片正常渲染（≥4 张）', r.cards >= 4, JSON.stringify(r));
  check('B2b 健康路径全程不出现加载行', !r.loadingSeen, JSON.stringify(r));
}

console.log('--- B3 健康 IDB + 专属库空：加载行出现后于取回落定时被摘除 ---');
await openPage([CLEAR_OWN]);
{
  const r = JSON.parse(await openLib('#li-custom-cards') || '{}');
  check('B3 加载行不残留（取回完成后摘除）', r.cleared || !r.loadingSeen, JSON.stringify(r));
}

console.log('--- Z 组：零未捕获错误 ---');
{
  const errs = await ev('JSON.stringify(window.__jsErrors || [])');
  let n = 0;
  try { n = JSON.parse(errs || '[]').length; } catch (e) {}
  check('Z1 无未捕获 JS 错误', n === 0, 'n=' + n);
}

cleanup();
const fail = results.filter(r => !r.ok).length;
console.log('== 结果：' + (results.length - fail) + '/' + results.length + (fail ? '  FAIL=' + fail : '  全绿'));
process.exit(fail ? 1 : 0);

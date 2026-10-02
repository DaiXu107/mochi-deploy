// #419 媒体池覆盖度核对——OPPO Find X9 模拟端到端验证（Edge/Chromium 内核 + Android 视口）
// 真机无法直接触达，用本机 Edge（与 OPPO 同内核）无头模拟：Android 手机视口 + 移动 UA 载入
// 构建产物 index.html，在真实 IDB 环境里用应用自身的 idbSet/idbDelete 落数据，
// 再调 window.mochiMediaCoverage() 验证三种缺失场景的核对结果 + 核对按钮在 DOM 在位。
// 用法：node tools/verify-media-coverage-e2e.mjs   （需已构建 index.html；CHROME_PATH 可指定 Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 160) + ']' : ''));
}

// ---- 用 Edge 优先（OPPO 上正是 Edge），退 Chrome ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!browserPath) { console.error('找不到 Edge/Chrome，请设置 CHROME_PATH'); process.exit(1); }
console.log('浏览器：' + (browserPath.includes('msedge') ? 'Edge' : 'Chrome') + '（' + browserPath + '）');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (21000 + Math.floor(Math.random() * 3000));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cov-e2e-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

// ---- OPPO Find X9 形态：Android 手机视口 + 移动触摸 + Edge Android UA ----
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.75, mobile: true, screenWidth: 412, screenHeight: 915 });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; PJD110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0' });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
// 就绪 = 数据就绪 + idb 接口 + 核对函数全部在位（防连到残留浏览器/未载完）
for (let i = 0; i < 60; i++) {
  const ok = await evalJs("(function(){return !!window.__mochiDataReady && typeof window.idbSet === 'function' && typeof window.mochiMediaCoverage === 'function' && document.title.indexOf('Mochi') >= 0;})()");
  if (ok) break;
  await sleep(300);
}
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(1500);

const H1 = 'a'.repeat(32), H2 = 'b'.repeat(32);
const DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ---- S0 前置：函数与接口在真实页面就位 ----
const pre = await evalJs("(function(){return {fn: typeof window.mochiMediaCoverage === 'function', ls: typeof window.idbListKeys === 'function', get: typeof window.idbGet === 'function', many: typeof window.idbGetMany === 'function', btn: !!document.getElementById('st-media-cov-btn'), btnTxt: (document.getElementById('st-media-cov-btn')||{}).textContent};})()");
check('前置 页面就绪：mochiMediaCoverage/idb 接口/核对按钮在位', !!(pre && pre.fn && pre.ls && pre.get && pre.many && pre.btn), pre && pre.btnTxt);

// 每场景前清场（LS 与 IDB 双删，防上一场景残留污染）
const CLEAR = `(async function(){
  try { localStorage.removeItem('xy-home-v2:chat-msgs'); } catch(e){}
  await window.idbDelete('xy-home-v2:chat-msgs');
  await window.idbDelete('xy-home-v2:media:${H1}');
  await window.idbDelete('xy-home-v2:media:${H2}');
  return true;
})()`;

// ---- S1 数据链完好：引用 1 令牌，池里 1 条有效 dataURL ----
await evalJs(CLEAR);
let r = await evalJs(`(async function(){
  await window.idbSet('xy-home-v2:chat-msgs', JSON.stringify({msgs:[{img:'@@m:${H1}'}]}));
  await window.idbSet('xy-home-v2:media:${H1}', ${JSON.stringify(DATA)});
  const rep = await window.mochiMediaCoverage();
  return {ok:rep.ok, referenced:rep.referenced, inPool:rep.inPool, missing:rep.missing};
})()`);
check('S1 数据链完好：引用=池内=1 缺 0', !!(r && r.ok && r.referenced === 1 && r.inPool === 1 && r.missing === 0), r);

// ---- S2 部分缺失：引用 2 令牌，池里只有 1 条 ----
await evalJs(CLEAR);
r = await evalJs(`(async function(){
  await window.idbSet('xy-home-v2:chat-msgs', '@@m:${H1} 和 @@m:${H2}');
  await window.idbSet('xy-home-v2:media:${H1}', ${JSON.stringify(DATA)});
  const rep = await window.mochiMediaCoverage();
  return {ok:rep.ok, referenced:rep.referenced, inPool:rep.inPool, missing:rep.missing, s0:rep.missingSamples[0]};
})()`);
check('S2 部分缺失：引用 2 池内 1 缺 1 且样本为 H2', !!(r && r.ok && r.referenced === 2 && r.inPool === 1 && r.missing === 1 && r.s0 === H2), r);

// ---- S3 池全空：引用令牌但池无任何键（备份完全没带图）----
await evalJs(CLEAR);
r = await evalJs(`(async function(){
  await window.idbSet('xy-home-v2:chat-msgs', '@@m:${H1}@@m:${H2}');
  const rep = await window.mochiMediaCoverage();
  return {ok:rep.ok, referenced:rep.referenced, inPool:rep.inPool, missing:rep.missing};
})()`);
check('S3 池全空：引用 2 池内 0 缺 2（=备份不含图片可判定）', !!(r && r.ok && r.referenced === 2 && r.inPool === 0 && r.missing === 2), r);

// ---- S4 页面无 JS 错误堆积（核对路径不污染错误环）----
const errs = await evalJs("(function(){return (window.__jsErrors||[]).filter(function(e){return /coverage|mochiMediaCoverage|media-pool/i.test(String(e&&e.message||e))}).length;})()");
check('S4 核对路径无 JS 错误污染', errs === 0, errs);

browser.kill();
server.close();
console.log('\n' + results.filter((x) => x.ok).length + '/' + results.length + ' passed');
process.exit(results.some((x) => !x.ok) ? 1 : 0);

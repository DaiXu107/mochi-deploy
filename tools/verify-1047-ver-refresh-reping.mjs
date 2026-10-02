// ===== 常驻回归：#1047 更新入口「点了没反应」＝手动下载通道 PRECACHE_NOW 重发 =====
// 用户实报（iPhone 17 / iOS 18.7 / Edge 独立应用 + 诊断 docx）：「有时候那里仍是旧版点更新还点不动」。
// 根因：手动通道（顶部「刷新使用新版」/ 设置→版本与更新→「检查更新」→ window.mochiRefreshNow，
// 三口同链）只在点击那一刻发一次 PRECACHE_NOW；iOS WebKit 会把空闲 SW 实例整只冻结（页面侧
// controller 引用仍在），那一刻的消息没人收 ⇒ PRECACHE_DONE 永不到来 ⇒ 按钮顶着「正在下载…」、
// _prBusy 把后续点击全部静默吞掉，最长干等 180s＝用户所见「点不动」。
// 修法：12s 一发重发同一条消息（投递到已停实例＝浏览器先唤醒它；SW 侧重复收到只是重复回执，幂等），
// DONE 即停、12 发封顶与 VER_DL_WAIT 对齐；自动通道 2.5s 兜底口径不变。
// 断言（390×844，无 CPU 节流；桩掉 navigator.serviceWorker 收投递）：
//  P1 前提：mochiRefreshNow 可用、桩控制器收到首发 PRECACHE_NOW（带 urls 数组）
//  P2 ★主判据：~30s 内 postMessage ≥3 次（首发 + ≥2 次重发）＝纯 HEAD 恒 1 次（红）
//  P3 每条都是 PRECACHE_NOW 且 urls 含 ./index.html（换消息＝改通道，判内容漂移）
//  P4 全程零未捕获异常
// 用法：node tools/verify-1047-ver-refresh-reping.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

// SW 桩：必须抢在 app 脚本前（pwa.js 读 controller 并挂 message 监听）
const STUB = `(function(){
  window.__prMsgs = []; window.__errs = [];
  var ctl = {
    postMessage: function (m) { try { window.__prMsgs.push(JSON.parse(JSON.stringify(m))); } catch (e) { window.__prMsgs.push({ type: m && m.type }); } },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  var sw = {
    controller: ctl,
    addEventListener: function () {}, removeEventListener: function () {},
    register: function () { return new Promise(function () {}); },
    getRegistration: function () { return Promise.resolve(undefined); },
    getRegistrations: function () { return Promise.resolve([]); },
    ready: new Promise(function () {})
  };
  try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw }); } catch (e) {}
  window.addEventListener('error', function (e) { window.__errs.push(String((e && e.message) || 'err').slice(0, 160)); });
  window.addEventListener('unhandledrejection', function (e) { window.__errs.push('rej:' + String((e && e.reason) || '').slice(0, 120)); });
})();`;

let ws = null, msgId = 0, pend = new Map(), chrome = null, cdpPort = 0;
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r && r.exceptionDetails) return null;
  return r && r.result ? r.result.value : null;
}
cdpPort = 9990 + Math.floor(Math.random() * 40);
chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'mochi-1045-')),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let connected = false;
for (let i = 0; i < 80; i++) {
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
      connected = true; break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!connected) { console.error('FAIL: 无法连接无头浏览器'); process.exit(1); }
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
await evalJs("(function(){var s=document.getElementById('splash');if(s)s.remove();return true;})()");
await sleep(800);

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

const entry = await evalJs('typeof window.mochiRefreshNow');
check('P1a 前提：window.mochiRefreshNow 在位（三口同链）', entry === 'function', String(entry));
await evalJs('window.mochiRefreshNow(); 1');
await sleep(1200);
const early = await evalJs('JSON.stringify(window.__prMsgs)');
const earlyMsgs = JSON.parse(early || '[]');
check('P1b 首发 PRECACHE_NOW 到桩（urls 含 ./index.html）', earlyMsgs.length >= 1 && earlyMsgs[0].type === 'PRECACHE_NOW' && JSON.stringify(earlyMsgs[0].urls || []).indexOf('./index.html') >= 0,
  'n=' + earlyMsgs.length);
await sleep(26000); // 跨两个 12s 重发点（t=12s、t=24s）
const late = await evalJs('JSON.stringify(window.__prMsgs)');
const msgs = JSON.parse(late || '[]');
check('P2 ★主判据：~30s 内 postMessage ≥3（首发+≥2 重发；纯 HEAD 恒 1＝点更新没反应本体）', msgs.length >= 3, 'n=' + msgs.length);
check('P3 全部都是 PRECACHE_NOW 且带 urls', msgs.every((m) => m.type === 'PRECACHE_NOW' && m.urls && m.urls.indexOf('./index.html') >= 0),
  JSON.stringify(msgs.map((m) => m.type)));
const errs = await evalJs('JSON.stringify(window.__errs.slice(0,5))');
check('P4 全程零未捕获异常', JSON.parse(errs || '[]').length === 0, errs);

try { chrome.kill(); } catch (e) {}
await sleep(200);
server.close();
console.log(pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

// ===== 验证 #530：安卓键盘期底部安全区归零（输入栏与输入法之间不再露大块底色） =====
// 背景：Chromium issues 406935609 / 457682720——安卓 IME 弹出时 env(safe-area-inset-bottom)
// 仍报手势条/浏览器底栏高度（应清零），而聊天输入栏底内边距用
// calc(10px + var(--mochi-safe-bottom, env(safe-area-inset-bottom,0px)))。
// --mochi-safe-bottom 此前只在 iOS 分支维护，安卓键盘期回落读 env → 输入栏被垫高、下方留白。
// 修复：安卓键盘在场期间把变量钉 0px；键盘收起摘除回落 env()。
// 本脚本用 visualViewport.height 垫片模拟「键盘只缩可视视口（resizes-visual）」，
// 断言变量在键盘期 = 0px、收起后 = ''（回落 env）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SERVE_ROOT ? normalize(process.env.SERVE_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-sb530-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

let pass = 0, fail = 0;
function check(desc, ok, detail) { if (ok) { pass++; console.log('PASS  ' + desc + (detail ? '  [' + detail + ']' : '')); } else { fail++; console.log('FAIL  ' + desc + (detail ? '  [' + detail + ']' : '')); } }

// visualViewport.height 垫片（实例属性遮蔽原型 getter，身份不变）+ __setVv 驱动 resize。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vv), 'height');
  let h = null;
  try {
    Object.defineProperty(vv, 'height', { get: () => (h === null ? (d && d.get ? d.get.call(vv) : 0) : h), configurable: true });
    window.__setVvHeight = (v) => { h = v; vv.dispatchEvent(new Event('resize')); };
  } catch (e) {}
  try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e2) {}
})();
` });

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 630, deviceScaleFactor: 3.5, mobile: true });

const safeBottom = `String(document.documentElement.style.getPropertyValue('--mochi-safe-bottom') || '')`;
const phoneH = `String(document.querySelector('.phone').style.height || '')`;

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  let entered = false;
  for (let i = 0; i < 24 && !entered; i++) {
    await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;return true;})()");
    await sleep(200);
    if (!(await evalJs("(function(){var e=document.getElementById('splash-enter');return !!(e&&!e.hidden&&!e.classList.contains('is-disabled'));})()"))) continue;
    await evalJs("(function(){var e=document.getElementById('splash-enter');if(e)e.click();return true;})()");
    await sleep(500);
    entered = !(await evalJs("(function(){var s=document.getElementById('splash');return !!(s&&!s.hidden);})()"));
  }
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(250);
  await evalJs("(function(){var ids=['qa-mask','applock-mask','modal-mask','tc-mask','call-mask'];ids.forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return true;})()");
  return entered;
}

const entered = await loadApp();
if (!entered) console.log('WARN  开屏未进入（后续断言可能受影响）');

// 前置状态：无键盘时变量不应存在（回落 env()，与改动前同语义）
check('[A1] 无键盘态不写 --mochi-safe-bottom（保持 env 回落）', (await evalJs(safeBottom)) === '', await evalJs(safeBottom));

// 聚焦聊天输入栏（键盘将弹出），再模拟 resizes-visual：只缩 vv（630 → 356）
await evalJs("(function(){var i=document.getElementById('chat-input');if(i)i.focus();return true;})()");
await sleep(200);
await evalJs('window.__setVvHeight && window.__setVvHeight(356)');
await sleep(700);

const hOpen = await evalJs(phoneH);
check('[B1] 键盘弹出后 .phone 仍收缩到可视高度（不回归）', hOpen === '356px', String(hOpen));
const sbOpen = await evalJs(safeBottom);
check('[B2] 键盘在场：--mochi-safe-bottom 钉为 0px（输入栏不再多垫一段空白）', sbOpen === '0px', String(sbOpen));
const padBottom = await evalJs("(function(){var r=document.querySelector('#page-chat .chat-input-row');if(!r)return null;return getComputedStyle(r).paddingBottom;})()");
check('[B3] 输入栏底内边距回到 10px（10 + 0；env 残留不再叠加）', padBottom === '10px', String(padBottom));

// 键盘收起：vv 回到基准 → 变量摘除，回落 env()
await evalJs('window.__setVvHeight && window.__setVvHeight(630)');
await sleep(1400);
const sbClosed = await evalJs(safeBottom);
check('[C1] 键盘收起：--mochi-safe-bottom 摘除（回落 env() 避让手势条）', sbClosed === '', String(sbClosed));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
process.exit(fail ? 1 : 0);

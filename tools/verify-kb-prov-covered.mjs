// ===== 专项验证 #387：点聊天输入栏 UI 乱+闪屏（无键盘环境盲推保底停靠） =====
// 回归用户报障（电脑浏览器 DevTools 移动模拟实测复现；要求多机型通用修法）：
// 点聊天输入栏后输入栏一行被顶到屏中间、下方大片空白（UI 乱），自愈清除后
// 反复点击又缩回（闪屏）。根因（mobile-adapt.js）：安卓 _aProvCheck / iOS
// _iProvCheck 的读数判据（|vv−基线|≤2 且 |inner−基线|≤2）只证「视口没动」
// 不证「键盘在场」——无软键盘环境视口永远不动，点输入栏即盲推 58% 停靠。
// 修复：两处盲推分支统一加「实测被盖」闸（#337 同一把尺：聚焦元素∪输入行
// 底边低于可视区底边+12px 才停靠）。悬浮键盘真场景键盘必然盖住输入栏照常
// 停靠零回归；元素可见无需停靠，只可能少停不可能多停。
// 无头模拟法：触摸事件真点输入栏（武装信号）+ __setVvHeight 表达键盘几何
//（与 verify-kb-cover-dock 同款垫片）；无键盘＝vv 全程不动。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kbcv387-' + Date.now()),
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

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  let entered = false;
  for (let i = 0; i < 24 && !entered; i++) {
    await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;return true;})()");
    await sleep(250);
    if (!(await evalJs("(function(){var e=document.getElementById('splash-enter');return !!(e&&!e.hidden&&!e.classList.contains('is-disabled'));})()"))) continue;
    await evalJs("(function(){var e=document.getElementById('splash-enter');if(e)e.click();return true;})()");
    await sleep(600);
    // #384 强制公告页：滑到底才能点确认进入
    await evalJs("(function(){var sc=document.getElementById('splash-mandatory-scroll');if(sc){sc.scrollTop=sc.scrollHeight;sc.dispatchEvent(new Event('scroll'));}return true;})()");
    await sleep(400);
    await evalJs("(function(){var b=document.getElementById('splash-mandatory-enter');if(b&&!b.classList.contains('is-disabled'))b.click();return true;})()");
    await sleep(600);
    entered = !(await evalJs("(function(){var s=document.getElementById('splash');return !!(s&&!s.hidden);})()"));
  }
  if (!entered) console.log('WARN  开屏未能进入 → 触摸前置条件不成立');
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(250);
  await evalJs("(function(){var ids=['qa-mask','applock-mask','modal-mask','tc-mask','call-mask'];ids.forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return true;})()");
}

async function tapChatInput() {
  const pos = JSON.parse(await evalJs(`(function(){var el=document.getElementById('chat-input')||document.querySelector('.chat-input-row');if(!el)return '{}';var r=el.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`) || '{}');
  if (pos.x === undefined) return false;
  const hit = await evalJs(`(function(){var el=document.getElementById('chat-input');var t=document.elementFromPoint(${pos.x},${pos.y});return JSON.stringify({hit:t?String(t.tagName)+'#'+String(t.id):'null',inside:!!(t&&el&&el.contains(t))});})()`);
  if (!(hit && JSON.parse(hit).inside)) { console.log('  · 触摸未命中输入框：' + (hit || 'null')); return false; }
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  return !!(await evalJs(`(function(){var i=document.getElementById('chat-input');return !!(i&&document.activeElement===i);})()`));
}

const phoneHn = `parseInt(String(document.querySelector('.phone').style.height||''),10)||0`;
const phoneH = `String(document.querySelector('.phone').style.height || '')`;
const rowPos = `(function(){var ir=document.querySelector('#page-chat .chat-input-row');if(!ir)return null;var r=ir.getBoundingClientRect();return JSON.stringify({top:Math.round(r.top),bottom:Math.round(r.bottom)});})()`;

let pass = 0, fail = 0;
function check(desc, ok, detail) { if (ok) { pass++; console.log('PASS  ' + desc + (detail ? '  [' + detail + ']' : '')); } else { fail++; console.log('FAIL  ' + desc + (detail ? '  [' + detail + ']' : '')); } }

// ---------- N1 核心复现：无键盘（vv 全程不动）点输入栏 → 不得盲推停靠 ----------
await loadApp();
check('[N1-准备] 触摸聚焦聊天输入栏', await tapChatInput());
await sleep(2600);
const n1h = await evalJs(phoneHn);
check('[N1] 无键盘环境点输入栏不收缩（修前盲推 58%≈490＝输入栏顶屏中）', n1h === 0, String(n1h));
const n1p = JSON.parse(await evalJs(rowPos) || 'null');
check('[N1] 输入栏仍在页面底部（bottom≥820）', !!n1p && n1p.bottom >= 820, n1p ? JSON.stringify(n1p) : 'null');

// ---------- N2 反复点击=闪屏源：聚焦/失焦三轮均不得出现中途收缩 ----------
let flick = false;
for (let i = 0; i < 3; i++) {
  await evalJs(`(function(){var i=document.getElementById('chat-input');if(i)i.blur();return true;})()`);
  await sleep(400);
  await tapChatInput();
  await sleep(1300);
  const h = await evalJs(phoneHn);
  if (h !== 0) { flick = true; break; }
}
check('[N2] 三轮点击/失焦循环零停靠抖动（闪屏源已断）', !flick);

// ---------- N3 悬浮键盘真场景保留：键盘在场（被盖）照常停靠 ----------
await evalJs('window.__setVvHeight && window.__setVvHeight(800)');
await sleep(1500);
const n3h = await evalJs(phoneHn);
check('[N3] 键盘在场（vv=800 盖住输入栏）保底停靠照常（#337 语义）', n3h >= 420 && n3h <= 560, String(n3h));

// ---------- N4 键盘收起复原路径不回归 ----------
await evalJs('window.__setVvHeight && window.__setVvHeight(844)');
await evalJs(`(function(){var i=document.getElementById('chat-input');if(i)i.blur();return true;})()`);
await sleep(1500);
const n4h = await evalJs(phoneH);
check('[N4] 失焦+vv 回基线后 .phone 恢复自然高度', n4h === '' || n4h === 'undefined' || n4h === 'null', String(n4h));

// ---------- N5 程序化聚焦（无触摸）零误触发（既有语义复核） ----------
await loadApp();
await evalJs(`(function(){var i=document.getElementById('chat-input');if(i)i.focus();return true;})()`);
await sleep(2000);
const n5h = await evalJs(phoneHn);
check('[N5] 自动聚焦（无触摸手势）不触发停靠', n5h === 0, String(n5h));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
process.exit(fail ? 1 : 0);

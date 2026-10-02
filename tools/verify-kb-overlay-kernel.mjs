// ===== 专项验证：纯悬浮键盘内核兜底（v3.12.x 推定停靠） =====
// 回归用户反馈「首次点击聊天输入栏打字，输入法把输入栏一行完全挡住」：
// X5/旧夸克等内核键盘弹出时 visualViewport.height 与 window.innerHeight 都不变，
// syncAndroidKb/syncIosKb 检测不到键盘 → .phone 永不收缩。修复：mobile-adapt.js
// 加二线兜底 _aProvCheck/_iProvCheck——手势聚焦文本框 + 宽限 900ms 后两视口仍
// 不动 → 推定键盘弹出，按无键盘基准 58% 保底收缩；失焦/真实 resize 即恢复。
// 无头环境天然就是「悬浮键盘」模拟场：聚焦不会引起任何视口变化。
// 触摸用 CDP Input.dispatchTouchEvent 走真实输入管线（武装 kbLastTouchAt 条件）。
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kbov-' + Date.now()),
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

// vv 高度可写垫片（实例属性遮蔽原型 getter，身份不变）+ __setVvHeight 驱动 resize，
// 模拟「正常 vv 内核」的键盘收缩信号（布局视口不动、只有 vv 缩）。
// 关键：document-start 时 viewport meta 尚未生效，vv.height 读到的是 980px 布局视口换算
// 值（本例 2121 而非 emulate 的 844）→ 直接冻结它会把 mobile-adapt 的 _aH 基线整体带偏
// （保底停靠判据 |vv−_aH|≤2 永远不成立，A1/C 就此假红）。未显式设置前透传真实读数。
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
  // 前置状态（不是被测逻辑）：本机已永久跳过开屏问答门，否则遮罩盖住输入栏 → CDP 触摸
  // 命中的是遮罩 → 键盘链路的触摸武装条件永不成立
  try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e2) {}
})();
` });

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  // 开屏（v3.26.x 起只能滑到底点【我已阅读并知晓】进入，点整屏无效、二次确认层已删）：
  // 按钮没滑到底时挂 .is-disabled、点了不生效 → #splash 一直挡整屏，触摸武装不了
  let entered = false;
  for (let i = 0; i < 24 && !entered; i++) {
    await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;return true;})()");
    await sleep(250);
    if (!(await evalJs("(function(){var e=document.getElementById('splash-enter');return !!(e&&!e.hidden&&!e.classList.contains('is-disabled'));})()"))) continue;
    await evalJs("(function(){var e=document.getElementById('splash-enter');if(e)e.click();return true;})()");
    await sleep(600);
    entered = !(await evalJs("(function(){var s=document.getElementById('splash');return !!(s&&!s.hidden);})()"));
  }
  if (!entered) console.log('WARN  开屏未能进入 → 触摸前置条件不成立');
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(250);
  await evalJs("(function(){var ids=['qa-mask','applock-mask','modal-mask','tc-mask','call-mask'];ids.forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return true;})()");
}

// 真实触摸点按聊天输入栏（走输入管线 → touchstart → 武装手势条件 → 原生聚焦）
async function tapChatInput() {
  const pos = JSON.parse(await evalJs(`(function(){var el=document.getElementById('chat-input')||document.querySelector('.chat-input-row');if(!el)return '{}';var r=el.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`) || '{}');
  if (pos.x === undefined) return false;
  // 先做命中测试：被遮罩/开屏挡住时触摸落在遮罩上，kbTouchArmed 永远不成立（旧脚本就此假红）
  const hit = await evalJs(`(function(){var el=document.getElementById('chat-input');var t=document.elementFromPoint(${pos.x},${pos.y});return JSON.stringify({hit:t?String(t.tagName)+'#'+String(t.id):'null',inside:!!(t&&el&&el.contains(t))});})()`);
  if (!(hit && JSON.parse(hit).inside)) { console.log('  · 触摸未命中输入框：' + (hit || 'null')); return false; }
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  // 不做程序化 focus 兜底——自动聚焦本来就过不了手势闸门，兜底只会把前置条件糊过去
  return !!(await evalJs(`(function(){var i=document.getElementById('chat-input');return !!(i&&document.activeElement===i);})()`));
}

const phoneH = `String(document.querySelector('.phone').style.height || '')`;
const inputRowPos = `(function(){var ir=document.querySelector('#page-chat .chat-input-row');if(!ir)return null;var r=ir.getBoundingClientRect();return JSON.stringify({top:Math.round(r.top),bottom:Math.round(r.bottom)});})()`;

// ---------- A1 核心场景：悬浮键盘内核（两视口都不变）→ 宽限期后保底停靠 ----------
await loadApp();
check('[A1-准备] 触摸聚焦聊天输入栏', await tapChatInput());
await sleep(2000);
const a1h = await evalJs(phoneH);
const a1n = a1h ? parseInt(a1h, 10) : 0;
check('[A1] 悬浮键盘下 .phone 保底收缩（≈基准58%=490px）', a1n >= 420 && a1n <= 560, String(a1h));
const a1p = JSON.parse(await evalJs(inputRowPos) || 'null');
check('[A1] 输入栏弹到典型输入法上沿（bottom≤500）且在屏内', !!a1p && a1p.bottom <= 500 && a1p.top >= 100, a1p ? JSON.stringify(a1p) : 'null');

// ---------- A2 失焦 → 键盘收起 → 复原 ----------
await evalJs(`(function(){var i=document.getElementById('chat-input');if(i)i.blur();return true;})()`);
await sleep(1400);
const a2h = await evalJs(phoneH);
check('[A2] 失焦后 .phone 恢复自然高度', a2h === '' || a2h === 'undefined' || a2h === 'null', String(a2h));

// ---------- B 正常内核回归：vv 快速收缩走原路径，不被兜底值覆盖 ----------
await loadApp();
await tapChatInput();
await sleep(80);
await evalJs('window.__setVvHeight && window.__setVvHeight(400)');
await sleep(800);
const b1 = await evalJs(phoneH);
check('[B] 正常内核 400px 收缩生效（非 490 兜底值）', b1 === '400px', String(b1));
await sleep(500);
const b2 = await evalJs(phoneH);
check('[B] 稳态无振荡（仍为 400px）', b2 === '400px', String(b2));

// ---------- C 迟到 vv 内核：兜底已停靠 → 真实信号到达后原机制接管 ----------
await loadApp();
await tapChatInput();
await sleep(1200);
const c0 = await evalJs(phoneH);
check('[C-前] 迟到信号窗口内兜底已停靠', (() => { const n = c0 ? parseInt(c0, 10) : 0; return n >= 420 && n <= 560; })(), String(c0));
await evalJs('window.__setVvHeight && window.__setVvHeight(400)');
await sleep(600);
const c1 = await evalJs(phoneH);
check('[C] 真实 vv 收缩后原机制接管（400px）', c1 === '400px', String(c1));

// ---------- D 程序化聚焦（无触摸）不误触兜底 ----------
await loadApp();
await evalJs(`(function(){var i=document.getElementById('chat-input');if(i)i.focus();return true;})()`);
await sleep(1800);
const d1 = await evalJs(phoneH);
check('[D] 自动聚焦（无触摸手势）不触发保底收缩', d1 === '' || d1 === 'undefined' || d1 === 'null', String(d1));

// ---------- E 硬件键盘按键抑制兜底 ----------
await loadApp();
await tapChatInput();
await sleep(30);
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:65,bubbles:true}))`);
await sleep(1900);
const e1 = await evalJs(phoneH);
check('[E] 检测到硬件键盘按键后不做保底收缩', e1 === '' || e1 === 'undefined' || e1 === 'null', String(e1));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
process.exit(fail ? 1 : 0);

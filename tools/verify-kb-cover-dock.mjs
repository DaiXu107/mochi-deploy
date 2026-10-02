// ===== 专项验证 #337：安卓键盘「可见性触发停靠 + VirtualKeyboard 实测尺 + 欠深自纠」 =====
// 回归用户报障（荣耀畅玩80Pro 自带浏览器，多机型同族）：点聊天输入栏，输入法整行盖住
// 输入栏。根因族：这类内核键盘弹出时 vv 读数漂移/不缩（|vv−基线|≤2 恒不成立）→
// v3.12.x 的读数判据 _aProvCheck 永不命中；58% 盲猜对高占比输入法（50~62%）也停靠不足。
// 修复三件套（mobile-adapt.js 安卓分支）：
//   ① 可见性触发：聚焦>900ms + 手势武装 + 实测元素底边低于可视区底边 → _aProvDock；
//   ② VirtualKeyboard 实测尺：overlaysContent=true + geometrychange 按 base−kbH 精停；
//   ③ 欠深自纠：保底停靠后仍被盖 → 每 250ms 再收 8% 基准，露出即停，触底 34%。
// 无头环境模拟法：__setVvHeight 写 vv.height（布局视口恒 844）——设成 800 构造
// 「读数漂移」（原判据 |800−844|>2 不命中、主路径 open=false 也不停靠），此时输入栏
// r.bottom≈844 > 800+12＝被盖，正是修复要接管的形态。
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kbcov-' + Date.now()),
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

// vv 高度可写垫片（与 verify-kb-overlay-kernel 同款：未显式设置前透传真实读数）
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

const phoneH = `String(document.querySelector('.phone').style.height || '')`;
const phoneHn = `parseInt(String(document.querySelector('.phone').style.height||''),10)||0`;
const inputRowPos = `(function(){var ir=document.querySelector('#page-chat .chat-input-row');if(!ir)return null;var r=ir.getBoundingClientRect();return JSON.stringify({top:Math.round(r.top),bottom:Math.round(r.bottom)});})()`;
const vkState = `(function(){try{var vk=navigator.virtualKeyboard;return vk?{has:true,overlays:!!vk.overlaysContent}:null;}catch(e){return {has:false};}})()`;

let pass = 0, fail = 0;
function check(desc, ok, detail) { if (ok) { pass++; console.log('PASS  ' + desc + (detail ? '  [' + detail + ']' : '')); } else { fail++; console.log('FAIL  ' + desc + (detail ? '  [' + detail + ']' : '')); } }

// ---------- F1 读数漂移内核：原判据失效 → 可见性触发停靠 ----------
await loadApp();
check('[F1-准备] 触摸聚焦聊天输入栏', await tapChatInput());
await evalJs('window.__setVvHeight && window.__setVvHeight(800)');
await sleep(2300);
const f1h = await evalJs(phoneHn);
const f1diag = await evalJs('JSON.stringify(window.__mochiAndroidKb ? window.__mochiAndroidKb() : null)');
check('[F1] 读数漂移（vv=800≠基线844）下可见性触发保底停靠（≈58%=490）', f1h >= 420 && f1h <= 560, String(f1h));
const f1p = JSON.parse(await evalJs(inputRowPos) || 'null');
check('[F1] 输入栏已被拉回可视区内（bottom≤812=visBottom+12）', !!f1p && f1p.bottom <= 812, f1p ? JSON.stringify(f1p) : 'null');

// ---------- F1b VirtualKeyboard 实测尺随保底停靠拉起 ----------
const f1vk = await evalJs(vkState);
if (f1vk && f1vk.has) check('[F1b] 保底停靠期 overlaysContent=true（实测尺已拉起）', f1vk.overlays === true, JSON.stringify(f1vk));
else console.log('SKIP  [F1b] 本内核无 VirtualKeyboard API（特性探测分支，跳过）');

// ---------- F2 欠深自纠：停靠高度不足仍被盖 → 逐拍收紧至露出 ----------
await evalJs(`(function(){document.querySelector('.phone').style.height='820px';return true;})()`);
await sleep(1200);
const f2h = await evalJs(phoneHn);
check('[F2] 欠深自纠逐拍收紧（820→约752，未到 34% 地板）', f2h >= 700 && f2h <= 800, String(f2h));
const f2p = JSON.parse(await evalJs(inputRowPos) || 'null');
check('[F2] 收紧后输入栏露出（bottom≤814）', !!f2p && f2p.bottom <= 814, f2p ? JSON.stringify(f2p) : 'null');

// ---------- F6 读数回摆：真实收缩信号到达 → 主路径接管、实测尺归还 ----------
await evalJs('window.__setVvHeight && window.__setVvHeight(254)');
await sleep(900);
const f6h = await evalJs(phoneH);
check('[F6] vv 回摆到真实收缩值 → 主路径接管（254px）', f6h === '254px', String(f6h));
const f6vk = await evalJs(vkState);
if (f6vk && f6vk.has) check('[F6] 主路径接管后 overlaysContent=false（实测尺归还内核）', f6vk.overlays === false, JSON.stringify(f6vk));

// ---------- F3 失焦复原（vv 回基线=键盘真实收起） ----------
await evalJs('window.__setVvHeight && window.__setVvHeight(844)');
await evalJs(`(function(){var i=document.getElementById('chat-input');if(i)i.blur();return true;})()`);
await sleep(1500);
const f3h = await evalJs(phoneH);
check('[F3] 失焦后 .phone 恢复自然高度', f3h === '' || f3h === 'undefined' || f3h === 'null', String(f3h));

// ---------- F4 程序化聚焦（无触摸）零误触发 ----------
await loadApp();
await evalJs(`(function(){var i=document.getElementById('chat-input');if(i)i.focus();return true;})()`);
await sleep(2000);
const f4h = await evalJs(phoneH);
check('[F4] 自动聚焦（无触摸手势）不触发可见性停靠', f4h === '' || f4h === 'undefined' || f4h === 'null', String(f4h));
const f4vk = await evalJs(vkState);
if (f4vk && f4vk.has) check('[F4] 未停靠则实测尺不拉起', f4vk.overlays === false, JSON.stringify(f4vk));

// ---------- F5 正常内核主路径优先：vv 快速收缩不被可见性/实测尺覆盖 ----------
await loadApp();
await tapChatInput();
await sleep(80);
await evalJs('window.__setVvHeight && window.__setVvHeight(400)');
await sleep(900);
const f5h = await evalJs(phoneH);
check('[F5] 正常内核 400px 收缩生效（主路径优先，非 490 兜底）', f5h === '400px', String(f5h));
const f5vk = await evalJs(vkState);
if (f5vk && f5vk.has) check('[F5] 主路径会话不拉起实测尺', f5vk.overlays === false, JSON.stringify(f5vk));

// ---------- F7 悬浮内核停靠（#387 契约更新：视口全不动＝无键盘证据，不dock；
//            键盘在场用 __setVvHeight(700) 表达「键盘盖住输入栏但内核读数不动」） ----------
await loadApp();
await tapChatInput();
await sleep(2300);
const f7h = await evalJs(phoneHn);
check('[F7-前] 视口全不动（=无键盘证据，#387）不再盲推停靠', f7h === 0, String(f7h));
await evalJs('window.__setVvHeight && window.__setVvHeight(800)');
await sleep(1500);
const f7d = await evalJs(phoneHn);
check('[F7] 悬浮内核+输入栏被盖 → 保底停靠照常（#337 语义保留）', f7d >= 420 && f7d <= 560, String(f7d));
await evalJs('window.__setVvHeight && window.__setVvHeight(844)');
await evalJs(`(function(){var p=document.querySelector('.phone');p.style.height='';return true;})()`);
await sleep(1300);
const f7b = await evalJs(phoneH);
check('[F7] 键盘收起（vv 回基线）+ 元素可见 → 不再触发任何停靠', f7b === '' || f7b === 'undefined' || f7b === 'null', String(f7b));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
process.exit(fail ? 1 : 0);

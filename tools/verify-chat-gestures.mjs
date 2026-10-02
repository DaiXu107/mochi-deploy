// ===== 回归脚本：聊天页手势入口（点头像拍一拍 / 长按气泡出引用菜单）=====
// 背景（用户报障，多机型同现、含内嵌浏览器，要求零机型分支防复发）：
//   ① 点联系人头像打不开拍一拍；② 长按聊天气泡打不开引用/动作菜单。
// 根因（src/js/chat.js，#G1/#G2，均与机型无关的"click 不可靠"族）：
//   G1 头像拍一拍原来只有 click 监听——部分内核/内嵌浏览器在点按期会因 DOM 重渲拆走目标、
//      滚动回弹期按位漂移、长按候选判定等吞掉合成 click＝拍一拍永远打不开。
//   G2 长按菜单原来走 touchstart+500ms 定时器——部分内核按住期间发小 touchmove（手指呼吸漂移）
//      或长按手势被系统接入（文本操作条/长按候选）发 touchcancel，定时器被清＝菜单永不出现。
// 修复：
//   G1 pointerdown 布点 + pointerup 轻点判定（位移<=12px 且 <=450ms）+ pointercancel 复位
//      + click 兜底防双开（#152 继续按钮 pointerdown 方案同款，滑动手势不误开）。
//   G2 ① touchmove 容错 <12px 微移不取消长按（>12px 仍视为滑动取消）；② contextmenu
//      （内核对长按的权威信号）同步打开动作菜单兜底，与定时器路径互斥，桌面右键同步受益。
// 验证（无头 Chrome 390×844 + CDP 真实输入管线 dispatchTouchEvent/dispatchMouseEvent）：
//   S1-S4 静态锚：修复源逻辑在位（脚本侧双保险，别等构建哨兵）
//   A1 触屏轻点头像→拍一拍面板开（旧版只靠 click，无头不合成 click＝必红，精确复现报障）
//   A2 触屏从头像起滑（滚动）→绝不误开拍一拍
//   B1 长按气泡 650ms→动作菜单开（定时器路径）
//   B2 长按中 5px 微移→仍开（微移容错）
//   B3 按住后 30px 滑动→不开（真滑动仍取消长按）
//   B4 右键气泡→动作菜单开（contextmenu 兜底，旧版必红）
// 用法（收口后）：node build.mjs && node tools/verify-chat-gestures.mjs
// 用法（预收口验证隔离构建）：SERVE_ROOT=<隔离构建目录> node tools/verify-chat-gestures.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root); // SERVE_ROOT=隔离构建目录（未收口时验证）；normalize 统一 Windows 分隔符，否则 403
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { console.error('SRV403', req.url); res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { console.error('SRVERR', req.url, e.message); try { res.writeHead(404); res.end('nf'); } catch (e2) { console.error('SRVHEADERR', e2.message); } }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9850 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gest-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') jsErrors++; if (m.method === 'Network.loadingFailed') { try { console.error('NETFAIL', m.params.errorText, m.params.type, m.params.blockedReason || ''); } catch (e) {} } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const navR = await cdp('Page.navigate', { url: baseUrl + '/index.html' });
console.log('NAV', JSON.stringify(navR));
await sleep(3500);

let pass = 0, fail = 0, skip = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
function note(name, detail) { skip++; console.log('  ⚠ SKIP', name, detail || ''); }

// —— 关开屏（clock.js 门控：滑到底 + 点「点击进入」）——
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
      return 'mwait';
    }
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box');
    if (sb) sb.scrollTop = sb.scrollHeight;
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
// 兜底：无头合成 click 不可靠（enter 键用 .is-disabled class 置灰挡住 se.click），
// 自动点按没关掉就强制隐藏开屏。等价于用户已进入，仅测试夹具用，不改产品逻辑。
if (!splashClosed) {
  await evalJs(`(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men)men.click();mm.hidden=true;}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()`);
  await sleep(500);
}
const spFinal = await evalJs(`(function(){var sp=document.getElementById('splash');return sp?sp.classList.contains('hide')||sp.hidden:true;})()`);
chk('前置 开屏已关闭（自动点按+强制隐藏兜底）', spFinal === true, 'spFinal=' + String(spFinal));
await sleep(500);
// 启动诊断（排查无头环境下 window.enterChat 时序）：关屏前后全局状态 + 是否有重载
const bootDiag = await evalJs(`(function(){var nav=performance.getEntriesByType('navigation')[0];var sp=document.getElementById('splash');return {ec:typeof window.enterChat,ca:typeof window.chatAddIn,ready:document.readyState,type:nav?nav.type:null,url:location.href,spHide:sp?sp.classList.contains('hide'):null,spHidden:sp?sp.hidden:null,disp:sp?getComputedStyle(sp).display:null};})()`);
console.log('BOOTDIAG', JSON.stringify(bootDiag));

// —— 进聊天并用 JS 关闭面板的辅助（无头环境不合成 click，面板间复位直接置 hidden）——
const pokeHidden = () => evalJs("(function(){var p=document.getElementById('poke-card');return p?p.hidden:null;})()");
const menuHidden = () => evalJs("(function(){var m=document.getElementById('msg-actions');return m?m.hidden:null;})()");
const closePoke = () => evalJs("(function(){var p=document.getElementById('poke-card');if(p)p.hidden=true;return true;})()");
const closeMenu = () => evalJs("(function(){var m=document.getElementById('msg-actions');if(m)m.hidden=true;return true;})()");

async function enterChat() {
  await evalJs('window.enterChat(); true');
  await sleep(1200);
  const n = await evalJs("document.querySelectorAll('.msg-in .msg-av').length");
  if (!n) { await evalJs("window.chatAddIn('联系人发来的第一条测试消息'); true"); await sleep(900); }
  const kn = await evalJs("document.querySelectorAll('.msg-in .msg-av').length");
  chk('前置 聊天空有收到的消息（.msg-in 头像可点）', kn > 0, 'msg-in count=' + String(kn));
}

// —— 输入管线真实手势助手（CDP Input, CSS 视口坐标）——
async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t + 0.08, touchPoints: [] });
}
// holdPress：按住 durMs。drift={dx,dy,atMs} 可选——按住中途给一个小/大位移，测「微移容错 / 真滑动取消」
async function holdPress(x, y, durMs, drift) {
  const t0 = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 2 }] });
  if (drift) {
    await sleep(drift.atMs);
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', timestamp: Date.now() / 1000, touchPoints: [{ x: x + drift.dx, y: y + drift.dy, radiusX: 1, radiusY: 1, force: 1, id: 2 }] });
  }
  await sleep(Math.max(0, durMs - (drift ? drift.atMs : 0)));
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: Date.now() / 1000 + 0.05, touchPoints: [] });
}
async function swipe(x, y, x2, y2, steps = 6) {
  const t0 = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 3 }] });
  for (let i = 1; i <= steps; i++) {
    await sleep(30);
    const cx = x + ((x2 - x) * i) / steps, cy = y + ((y2 - y) * i) / steps;
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', timestamp: Date.now() / 1000, touchPoints: [{ x: cx, y: cy, radiusX: 1, radiusY: 1, force: 1, id: 3 }] });
  }
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: Date.now() / 1000 + 0.05, touchPoints: [] });
}
async function rightClick(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', timestamp: t, x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(60);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', timestamp: t + 0.1, x, y, button: 'right', buttons: 0, clickCount: 1 });
}
const rectOf = (sel) => evalJs(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;var r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),visible:r.top>=0&&r.bottom<=innerHeight};})()`);

// —— S1-S4 静态锚：修复源逻辑在位（配合 build.mjs 哨兵的脚本侧双保险）——
const chatSrc = (() => { try { return readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8'); } catch (e) { return ''; } })();
chk('S1 头像 pointerup 轻点判定锚（dt<=450 && 位移<=12px）', chatSrc.indexOf('dt > 450 || dx * dx + dy * dy > 144') >= 0);
chk('S2 拍一拍 click 兜底防双开锚（pokeTapGuard 吞补发 click）', chatSrc.indexOf('Date.now() < pokeTapGuard') >= 0);
chk('S3 contextmenu 兜底开动作菜单锚（ctxR 分支）', chatSrc.indexOf('activeMsgEl !== ctxR.item') >= 0);
chk('S4 长按微移容错锚（>12px 才取消）', chatSrc.indexOf('mdx * mdx + mdy * mdy > 144') >= 0);
// —— S5/S6 触屏五保险·旧内核 touch 路径锚（无 PointerEvent 的国产壳/旧 WebView 唯一可靠入口）——
chk('S5 拍一拍 touchstart 布点锚（旧内核 touch 路）', chatSrc.indexOf('pokeTapT = { x: t.clientX, y: t.clientY, t: Date.now(), id: t.identifier };') >= 0);
chk('S6 拍一拍 touchend 轻点判定锚（同口径判滑动，文本异形护哨兵唯一）', chatSrc.indexOf('dx * dx + dy * dy > 144 || dt > 450') >= 0);

await enterChat();

// —— A1 轻点头像 → 拍一拍面板开（旧版纯 click：无头不合成 click，必红＝复现报障）——
const av = await rectOf('.msg-in .msg-av');
chk('A0 找到收件头像且可见', !!av, JSON.stringify(av));
if (av) {
  await closePoke();
  await tap(av.x, av.y);
  await sleep(500);
  const ph = await pokeHidden();
  chk('A1 触屏轻点头像→拍一拍面板打开', ph === false, 'poke-card.hidden=' + String(ph));
  await closePoke();
}

// —— A2 从头像起滑（滚动）→ 不得误开拍一拍 ——
if (av) {
  await closePoke();
  await swipe(av.x, av.y, av.x, av.y - 120);
  await sleep(400);
  const ph = await pokeHidden();
  chk('A2 触屏从头像起向上滑→不误开拍一拍（滑动不算点）', ph === true, 'poke-card.hidden=' + String(ph));
}

// —— T1/T2 旧内核判别：手动 dispatch TouchEvent（浏览器不会为脚本事件补发 pointer/click），
// 精确模拟「无 PointerEvent 内核只有 touch 事件」——修复前无 touch 监听＝T1 必红（旧内核打不开=报障复现）。
// T1 轻点 → touch 路开面板；T2 起点在头像、抬手偏移 30px → 不误开。 ——
if (av) {
  await closePoke();
  await evalJs(`(function(){var av=document.querySelector('.msg-in .msg-av');if(!av)return 'no-av';
var r=av.getBoundingClientRect();var cx=Math.round(r.left+r.width/2),cy=Math.round(r.top+r.height/2);
var mk=function(type,ox,oy){var t=new Touch({identifier:7,target:av,clientX:cx+ox,clientY:cy+oy});return new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[t],changedTouches:[t]});};
av.dispatchEvent(mk('touchstart',0,0));av.dispatchEvent(mk('touchend',0,0));return true;})()`);
  await sleep(400);
  const ph1 = await pokeHidden();
  chk('T1 旧内核（仅 touch 事件）轻点头像→拍一拍面板打开（五保险 touch 路）', ph1 === false, 'poke-card.hidden=' + String(ph1));
  await closePoke();
  await evalJs(`(function(){var av=document.querySelector('.msg-in .msg-av');if(!av)return 'no-av';
var r=av.getBoundingClientRect();var cx=Math.round(r.left+r.width/2),cy=Math.round(r.top+r.height/2);
var mk=function(type,ox,oy){var t=new Touch({identifier:8,target:av,clientX:cx+ox,clientY:cy+oy});return new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[t],changedTouches:[t]});};
av.dispatchEvent(mk('touchstart',0,0));av.dispatchEvent(mk('touchend',30,0));return true;})()`);
  await sleep(400);
  const ph2 = await pokeHidden();
  chk('T2 旧内核抬手偏移 30px→不误开拍一拍（touch 路滑动判定）', ph2 === true, 'poke-card.hidden=' + String(ph2));
  await closePoke();
}

// —— 气泡手势：找一个可弹菜单的收件文字气泡 ——
const bub = await evalJs(`(function(){
  var list=document.querySelectorAll('.msg-in .msg-bubble'),i,el;
  for(i=0;i<list.length;i++){var b=list[i];
    if(b.querySelector('.msg-quote'))continue;
    var it=b.closest('.msg'); if(!it||it.classList.contains('msg-poke'))continue;
    if(b.querySelector('.msg-poke-seg'))continue;
    var txt=(b.textContent||'').trim(); if(txt.length<2||txt.indexOf('撤回了一条消息')>=0||txt.indexOf('已读不回')>=0)continue;
    el=b;break;}
  if(!el)return null;
  var r=el.getBoundingClientRect();
  return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),visible:r.top>=0&&r.bottom<=innerHeight};
})()`);
chk('A3 找到可弹菜单的收件气泡', !!bub, JSON.stringify(bub));

if (bub) {
  // B1 长按 650ms（无漂移）→ 菜单开（touchstart 定时器路径）
  await closeMenu();
  await holdPress(bub.x, bub.y, 650);
  await sleep(350);
  const mh1 = await menuHidden();
  chk('B1 触屏长按气泡 650ms→动作菜单打开（定时器路径）', mh1 === false, 'msg-actions.hidden=' + String(mh1));
  await closeMenu();

  // B2 长按中 5px 微移 → 仍开（微移容错，老代码 touchmove 即清定时器＝必红）
  await closeMenu();
  await holdPress(bub.x, bub.y, 650, { dx: 5, dy: 0, atMs: 200 });
  await sleep(350);
  const mh2 = await menuHidden();
  chk('B2 长按中 5px 微移仍打开菜单（微移容错）', mh2 === false, 'msg-actions.hidden=' + String(mh2));
  await closeMenu();

  // B3 按住后 30px 滑动 → 不开（真滑动仍取消长按）
  await closeMenu();
  await holdPress(bub.x, bub.y, 700, { dx: 30, dy: 0, atMs: 200 });
  await sleep(350);
  const mh3 = await menuHidden();
  chk('B3 按住后滑动 30px→不打开菜单（真滑动仍取消）', mh3 === true, 'msg-actions.hidden=' + String(mh3));

  // B4 右键 → 菜单开（contextmenu 兜底路径，旧版 preventDefault 后不开＝必红）
  await closeMenu();
  await rightClick(bub.x, bub.y);
  await sleep(350);
  const mh4 = await menuHidden();
  chk('B4 触屏外的右键/长按（contextmenu）→动作菜单打开（兜底路径）', mh4 === false, 'msg-actions.hidden=' + String(mh4));
  await closeMenu();
} else {
  note('气泡手势断言 A3/B1-B4 因找不到可弹气泡而跳过', '');
}

const jsErrCount = await evalJs('(window.__jsErrors && __jsErrors.length) || 0');
chk('终态 无未捕获 JS 异常', jsErrCount === 0 && jsErrors === 0, 'cdp=' + String(jsErrors) + ' app=' + String(jsErrCount));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('（作用域：' + (process.env.SERVE_ROOT ? 'SERVE_ROOT=' + process.env.SERVE_ROOT : '仓库根目录产品') + '）');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过');
process.exit(fail ? 1 : 0);
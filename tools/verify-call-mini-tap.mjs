// ===== 回归脚本：#830 点「通话小框」打开通话半框 =====
// 用法：node tools/verify-call-mini-tap.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-call-mini-tap.mjs （测仓外隔离副本产物）
// 用户需求（2026-09-19）：「通话小框需要点击可以打开通话半框」。
// 现状：#call-mini 只有两条出路——拖动、点右侧红色挂断键；点中间什么都没发生，
//   想回到通话界面（看状态/挂断）只能先拖开再点挂断，或去聊天页「更多功能→通话」。
// 修复（call.js）：拖拽与点击在同一组 pointer 事件里按 moved 分流——真实拖动过只存坐标，
//   没拖动＝轻点 → enterChat() + openChatCallPanel()；按下点落在挂断键上的那一下整个交回
//   按钮自身（pressOnHang），不会「挂断顺带弹半框」。半框属聊天页 DOM 且标题/背景按当前
//   桌面读，故通话归属桌面不同就先切桌面（防 A 的通话显示成 B＝#811 同族串身份）。
// 断言：
//   A 轴 源码锚（轻点分流 + 归属桌面切换）
//   B 轴 真实点击（CDP Input 派发，非 element.click）：
//     B1 轻点小框 → 通话半框打开、聊天页在前
//     B2 半框显示「通话中」状态且挂断键在位（小框点开的就是能挂断的那一屏）
//     B3 轻点不影响通话本身（仍在通话中、时长在走）
//     B4 拖动 → 半框不弹（拖拽回归守卫）且坐标落库
//     B5 点小框挂断键 → 只挂断，不弹半框
//     B6 跨桌面：通话归属 A、当前在 B → 轻点后回到 A 且半框标题是 A 的昵称
//     B7 全程零 JS 异常
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = 9930 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mini-tap-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map(); const jsErrs = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrs.push(((d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || 'unknown').slice(0, 200));
          }
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
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 240)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- A 轴：源码锚（逻辑锚点，删掉修复即消失） ----
let callSrc = '';
try { callSrc = readFileSync(join(root, 'src', 'js', 'call.js'), 'utf8'); } catch (e) {}
check('A1 轻点入口函数在位（openCallHalfFromMini → enterChat + openChatCallPanel）',
  callSrc.includes('function openCallHalfFromMini()') && callSrc.includes('window.openChatCallPanel();'), '');
check('A2 拖动/轻点同组分流（未移动且未按在挂断键才算轻点）',
  callSrc.includes('const tap = !moved && !pressOnHang;') && callSrc.includes('if (tap) openCallHalfFromMini();'), '');
check('A3 挂断键那一下不接管（pointerdown 命中挂断键即标记并交回按钮）',
  callSrc.includes("{ pressOnHang = true; return; }"), '');
check('A4 归属桌面不同先切桌面（防 A 的通话显示成 B）',
  callSrc.includes('window.setActiveContact(ownerCid)'), '');

// ---- 开屏进应用 ----
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs(`(function(){
    try {
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
        var me = document.getElementById('splash-mandatory-enter'); if (me && !me.hidden) me.click();
        mm.hidden = true;
      }
      var sp = document.getElementById('splash');
      if (sp) { sp.classList.add('hide'); sp.hidden = true; }
      var qm = document.getElementById('qa-mask'); if (qm) qm.hidden = true;
      var mask = document.getElementById('modal-mask'); if (mask && !mask.hidden) mask.hidden = true;
    } catch (e) {}
    return 1;
  })()`);
  await sleep(500);
}

const STATE = `(function(){ var s=null; try{ s=window.getCallState(); }catch(e){} return s?{status:s.status,durationSec:s.durationSec}:'none'; })()`;
const PANEL = `(function(){ var p=document.getElementById('chat-call-panel');
  var pg=document.getElementById('page-chat'); var st=document.getElementById('call-panel-status');
  var nm=document.getElementById('call-panel-name'); var hang=document.getElementById('call-panel-hang');
  return JSON.stringify({ open: !!p && !p.hidden, chat: !!pg && !pg.hidden,
    status: st?st.textContent:'', name: nm?nm.textContent:'', hang: !!hang && !hang.hidden,
    cid: window.__activeCid||'default' }); })()`;
const toObj = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } };

// 元素中心点（小框/挂断键）——坐标每次重取，拖动后位置会变
async function center(sel) {
  return evalJs(`(function(){ var el=document.querySelector(${JSON.stringify(sel)});
    if(!el||el.hidden) return null; var r=el.getBoundingClientRect();
    if(r.width<=0||r.height<=0) return null;
    return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}); })()`)
    .then((s) => toObj(s));
}
async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', timestamp: t, x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', timestamp: t + 0.06, x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(320);
}
async function dragTo(x, y, dx, dy) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', timestamp: t, x, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', timestamp: t + i * 0.01, x: x + dx * i / 6, y: y + dy * i / 6, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', timestamp: t + 0.2, x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(320);
}
const closePanel = () => evalJs("(function(){ var p=document.getElementById('chat-call-panel'); if(p) p.hidden=true; return 1; })()");

async function startCall(nick) {
  await evalJs(`(function(){
    window.activeStore().set('call-mini-enabled','1');
    ${nick ? `window.activeStore().set('cs-lbl-partner', ${JSON.stringify(nick)});` : ''}
    window.triggerIncomingCall(); return 1; })()`);
  await sleep(700);
  await evalJs("(function(){ var b=document.getElementById('call-answer-btn'); if(b&&!b.hidden) b.click(); return 1; })()");
  await sleep(2600); // 接通 2 秒后自动最小化为小框
}

await boot();

// ================= B1~B3 轻点开半框 =================
await startCall('昵称甲');
let mini = await center('#call-mini');
check('B0 前置：通话已接通且小框在屏', !!mini, JSON.stringify(toObj(await evalJs(STATE))));
if (mini) {
  await tap(mini.x, mini.y);
  const p = toObj(await evalJs(PANEL));
  check('B1 轻点小框 → 通话半框打开且聊天页在前', !!p && p.open && p.chat, JSON.stringify(p));
  check('B2 半框显示通话中状态＋挂断键在位', !!p && /通话中/.test(p.status) && p.hang === true, JSON.stringify(p));
  const s1 = toObj(await evalJs(STATE));
  check('B3 轻点不误挂断（仍在通话中且时长在走）', !!s1 && s1.status === 'connected' && s1.durationSec >= 0, JSON.stringify(s1));

  // ================= B4 拖动不弹半框（拖拽回归守卫） =================
  await closePanel();
  await sleep(200);
  mini = await center('#call-mini');
  if (mini) {
    await dragTo(mini.x, mini.y, -100, -160);
    const p2 = toObj(await evalJs(PANEL));
    const pos = await evalJs(`(function(){ try { return window.activeStore().get('call-mini-pos')||''; } catch(e){ return ''; } })()`);
    check('B4 拖动后半框未被弹开＋坐标已落库', !!p2 && p2.open === false && !!pos, JSON.stringify({ panel: p2, pos: String(pos).slice(0, 40) }));
  } else {
    check('B4 拖动后半框未被弹开＋坐标已落库', false, '小框取不到中心点');
  }

  // ================= B5 挂断键只挂断、不弹半框 =================
  await closePanel();
  await sleep(200);
  const hangPt = await center('#call-mini-hang');
  if (hangPt) {
    await tap(hangPt.x, hangPt.y);
    const p3 = toObj(await evalJs(PANEL));
    const s3 = toObj(await evalJs(STATE));
    const miniGone = await evalJs("(function(){ var m=document.getElementById('call-mini'); return !m || m.hidden; })()");
    check('B5 点小框挂断键 → 只挂断（通话结束、小框收起、半框没被顺手弹开）',
      !!p3 && p3.open === false && (s3 === 'none' || !s3) && miniGone === true, JSON.stringify({ p: p3, st: s3 }));
  } else {
    check('B5 点小框挂断键 → 只挂断', false, '挂断键取不到中心点');
  }
}

// ================= B6 跨桌面：甲的通话、当前在乙桌面点小框 =================
await boot();
await startCall('昵称甲');           // 默认桌面（甲）发起并接通
const cidB = await evalJs(`(function(){
  try {
    var id = window.createContact('联系人乙');
    window.setActiveContact(id);
    window.activeStore().set('cs-lbl-partner','昵称乙');
    return id;
  } catch (e) { return 'ERR:' + e.message; }
})()`);
await sleep(600);
const beforeDesk = await evalJs(`(function(){ return JSON.stringify({cid: window.__activeCid||'default', miniName: (document.getElementById('call-mini-name')||{}).textContent||''}); })()`);
const b6pre = toObj(beforeDesk);
check('B6a 前置：已切到乙桌面，而小框仍显示甲（通话归属未变）',
  !!b6pre && b6pre.cid === cidB && b6pre.miniName === '昵称甲', JSON.stringify({ cidB, pre: b6pre }));
mini = await center('#call-mini');
if (mini && typeof cidB === 'string' && !String(cidB).startsWith('ERR')) {
  await tap(mini.x, mini.y);
  const p6 = toObj(await evalJs(PANEL));
  check('B6 别的桌面轻点小框 → 切回通话归属桌面并打开它的半框（标题不串身份）',
    !!p6 && p6.open === true && p6.cid === 'default' && p6.name === '昵称甲',
    JSON.stringify({ pre: beforeDesk, post: p6 }));
} else {
  check('B6 别的桌面轻点小框 → 切回通话归属桌面并打开它的半框', false, '前置未就绪: ' + JSON.stringify({ cidB, mini, beforeDesk }));
}
await evalJs("(function(){ try{ window.hangupCall(); }catch(e){} return 1; })()");

// ================= B7 零 JS 异常 =================
check('B7 全程零未捕获 JS 异常', jsErrs.length === 0, jsErrs.slice(0, 2).join(' | '));

chrome.kill();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n通过 ${results.length - failed} / ${results.length}`);
process.exit(failed ? 1 : 0);

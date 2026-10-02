// ===== 回归脚本：头像互动半框里删一条，整框不许自己收起来（#1207 家族·第二载体）=====
// 报障（用户实报 2026-09-24，摩托罗拉 G100 / Edge 153）：「删除一个头像，互动栏就会收回，
//   只能再打开互动栏的头像池删除头像」——即四个池子（TA 的头像 / 我的头像 / TA 的昵称 / 我的昵称）
//   里点 ✕ 删一条，整枚底部半框当场关掉，要删第二条必须重开。
// 根因（与 #1207 占卜抽牌同一记，零机型分支）：#906 给底半框挂的「点半框外关闭」分派器
//   window.mochiSheetOutsideClose 在事件冒泡到 document 那刻**实时**读 panel.contains(e.target) 判内外，
//   而删除按钮的处理器（avatar-lib.js 的 delBtn / buildNickCell）在同一记派发里就 renderGrid()
//   把整格 innerHTML='' 重建 ⇒ 被点的那枚 ✕ 早被摘走 ⇒ contains 恒假 ⇒「点框内删一条」被误判成
//   「点框外」＝整框收掉。400ms「刚开即关」闩救不到（半框早开着）。
// 修法：#1207 已把该判据改成派发那一刻的 e.composedPath()（分派器一处收口＝同族全修），本脚本
//   不新增 src 改动，只把头像互动这枚载体钉成常驻断言——占卜那侧的 verify-1207 测不到它。
// 判别力（2026-09-24 实测）：绿＝现 tip（HEAD 663375d，含 #1207）产物 **18/18**；
//   红＝用户设备上那一版 `5f6c279`（线上 version.json ts=1790155786485＝部署于 2026-09-23 17:29，
//   早于 #1207）**11/18，恰红 S1（锚）＋P5/P6/P7/P8＋M2＋N2**（P5＝报障本体：删一条后 open=false）。
//   X2 是「防修过头」闸（真点框外＝面板上方消息气泡仍要收框），两侧同绿＝这条能力没被削弱。
// 用法：node tools/verify-1207-avlib-delete-noclose.mjs
//      SERVE_ROOT=<隔离构建目录> 指定被测产物（默认主树产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end(); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9870 + Math.floor(Math.random() * 100);
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-1207-avdel-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) { if (ok) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, detail || ''); } }

// —— S 组：产物锚点（分派器存在＋#1207 的派发时路径判据在位）——
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const chatText = rd('js/chat.js') + readFileSync(join(root, 'index.html'), 'utf8');
chk('S0 产物含点外关闭分派器（#906 前提）', chatText.includes('window.mochiSheetOutsideClose = function (panel, close)'), '');
chk('S1 点外判定走派发时路径 composedPath（#1207 锚）', chatText.includes('composedPath'), '');
const avText = rd('js/avatar-lib.js') + chatText;
chk('S2 头像互动半框已接入该分派器', avText.includes("mochiSheetOutsideClose(document.getElementById('avlib-card'), closeAvlib)"), '');

// —— 清场：开屏 / 首启模态 / 备份提醒条 ——
for (let i = 0; i < 30; i++) {
  const s = await evalJs(`(function(){
    var mm=document.getElementById('splash-mandatory');
    if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men&&!men.classList.contains('is-disabled')){men.click();return 'mclicked';}return 'mwait';}
    var sp=document.getElementById('splash'); if(!sp||sp.classList.contains('hide')) return 'closed';
    var sb=document.getElementById('splash-box'); if(sb)sb.scrollTop=sb.scrollHeight;
    var se=document.getElementById('splash-enter'); if(se&&!se.disabled){se.click();return 'clicked';} return 'wait';})()`);
  if (s === 'closed') break;
  await sleep(300);
}
await evalJs(`(function(){
  var mm=document.getElementById('splash-mandatory'); if(mm)mm.hidden=true;
  var sp=document.getElementById('splash'); if(sp){sp.classList.add('hide');sp.hidden=true;}
  var bk=document.getElementById('backup-remind-bar'); if(bk)bk.hidden=true;
  var md=document.getElementById('modal-mask'); if(md)md.hidden=true; return true;})()`);
await sleep(500);
await evalJs('window.enterChat && window.enterChat(); true');
await sleep(1500);
await evalJs(`(function(){document.querySelectorAll('.modal-mask').forEach(function(m){m.hidden=true;});var bk=document.getElementById('backup-remind-bar');if(bk)bk.hidden=true;document.body.classList.remove('scroll-lock');return true;})()`);

// 池子种子：per-cid 命名空间写 avatar-lib / avatar-me-lib（值是 dataURL 数组，图本身不重要）
async function seed(key, n) {
  return evalJs(`(function(){
    var st=window.activeStore?window.activeStore():window.xyStore('xy-home-v2');
    var a=[];for(var i=0;i<${n};i++)a.push('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='+i);
    st.set(${JSON.stringify(key)},JSON.stringify(a));return a.length;})()`);
}
const isOpen = () => evalJs(`(function(){var e=document.getElementById('avlib-card');return e?!e.hidden:null;})()`);
const count = (grid) => evalJs(`(function(){return document.querySelectorAll('#${grid} .avlib-cell, #${grid} .avlib-name-cell').length;})()`);
async function openPane() { await evalJs('window.openAvlib && window.openAvlib(); true'); await sleep(1200); }
async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t + 0.08, touchPoints: [] });
}
// 真点选择器第一个元素：滚进视野 → 量中心 → 派发真实 touch（不用 el.click()，那是零几何的假点击）
async function tapEl(sel) {
  const b = await evalJs(`(function(){
    var els=document.querySelectorAll(${JSON.stringify(sel)}); if(!els.length) return null;
    var el=els[0]; try{el.scrollIntoView({block:'center'});}catch(e){}
    var r=el.getBoundingClientRect(); if(!r.width||!r.height) return null;
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  if (!b) return null;
  await sleep(150);
  const hit = await evalJs(`(function(){return !!document.elementFromPoint(${b.x},${b.y});})()`);
  if (!hit) return null;
  await tap(b.x, b.y);
  return b;
}
const reopen = async () => { if (await isOpen() !== true) await openPane(); };

// —— P 组：报障本体＝TA 的头像池连删两条 ——
await seed('avatar-lib', 3);
await openPane();
await reopen();
chk('P1 头像互动半框已打开', await isOpen() === true, '');
chk('P2 池内 3 条已渲染', await count('avlib-grid') === 3, 'cells=' + await count('avlib-grid'));
const t1 = await tapEl('#avlib-grid .avlib-del');
chk('P3 前置 ✕ 按钮真点得到', !!t1, JSON.stringify(t1));
await sleep(700);
chk('P4 删除生效（3→2）', await count('avlib-grid') === 2, 'cells=' + await count('avlib-grid'));
chk('P5【报障本体】删一条后半框仍开着', await isOpen() === true, 'open=' + await isOpen());
await sleep(600);
chk('P6 越过 400ms「刚开」闩后半框仍开着', await isOpen() === true, '');
await tapEl('#avlib-grid .avlib-del');
await sleep(700);
chk('P7 连删第二条生效（2→1）', await count('avlib-grid') === 1, 'cells=' + await count('avlib-grid'));
chk('P8 连删第二条后半框仍开着', await isOpen() === true, '');

// —— M 组：我的头像池（pane-b，同一条 renderGrid 路径）——
await reopen();
await evalJs(`(function(){var b=document.getElementById('avlib-tab-b');if(b)b.click();return true;})()`);
await sleep(500);
await seed('avatar-me-lib', 2);
await evalJs('window.openAvlib && window.openAvlib(); true');
await sleep(1000);
const mBefore = await count('avlib-me-grid');
await tapEl('#avlib-me-grid .avlib-del');
await sleep(700);
chk('M1 我的头像池删除生效', await count('avlib-me-grid') === mBefore - 1, mBefore + '→' + await count('avlib-me-grid'));
chk('M2 我的头像池删后半框仍开着', await isOpen() === true, '');

// —— N 组：昵称池（buildNickCell 整表重建，同一机制）——
await reopen();
await evalJs(`(function(){var b=document.getElementById('avlib-kind-name');if(b)b.click();var a=document.getElementById('avlib-tab-a');if(a)a.click();return true;})()`);
await sleep(400);
await evalJs(`(function(){var st=window.activeStore?window.activeStore():window.xyStore('xy-home-v2');st.set('nick-lib',JSON.stringify(['昵称甲','昵称乙']));return true;})()`);
await evalJs('window.openAvlib && window.openAvlib(); true');
await sleep(1000);
const nBefore = await count('avlib-nick-list');
await tapEl('#avlib-nick-list .avlib-name-del');
await sleep(700);
chk('N1 昵称池删除生效', await count('avlib-nick-list') === nBefore - 1, nBefore + '→' + await count('avlib-nick-list'));
chk('N2 昵称池删后半框仍开着', await isOpen() === true, '');

// —— X 组：防修过头（真点框外仍要收框）＋零异常 ——
await evalJs(`(function(){var b=document.getElementById('avlib-kind-avatar');if(b)b.click();return true;})()`);
await openPane();
await sleep(900);
chk('X1 重开后半框开着', await isOpen() === true, '');
const ox = await evalJs(`(function(){
  var p=document.getElementById('avlib-card'); if(!p) return null;
  var r=p.getBoundingClientRect();
  var x=Math.round(r.left+r.width/2), y=Math.round(r.top-70);
  var el=document.elementFromPoint(x,y);
  if(!el) return null;
  if(el.closest && el.closest('button,a,input,select,[contenteditable]')) return null;
  return {x:x,y:y,tag:el.tagName+'#'+(el.id||'')+'.'+(el.className||'')};})()`);
if (ox) { await tap(ox.x, ox.y); await sleep(800); }
chk('X2 点面板上方（真框外）半框照常收起', await isOpen() === false, JSON.stringify(ox));
const errs = await evalJs(`(function(){return (window.__jsErrors||[]).slice(0,5);})()`);
chk('X3 全程无 JS 异常', !errs || !errs.length, JSON.stringify(errs));

console.log('\n[#1207-avlib-del] root=' + root + '  PASS=' + pass + '  FAIL=' + fail);
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

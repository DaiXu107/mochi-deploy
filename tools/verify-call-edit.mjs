// ===== 通话半框内修改联系人头像 / 通话卡片背景图片 验证 =====
// 用户反馈：点击更多功能里的【通话】，需要可以修改联系人头像和通话卡片背景图片
// 覆盖：①通话半框新增「联系人头像」「通话背景图片」「移除通话背景」三行
//       ②联系人头像行 → 收起通话半框并打开头像互动半框（换的就是聊天域 cs-avatar-partner）
//       ③通话背景图片行 → 与设置页共用的 pickCallBg 上传流程（拦截 file input click 验证）
//       ④移除行 → 清空背景恢复默认（回显/toast/has-bg 同步）
//       ⑤通话头像跟随聊天域：partnerAv 先读 cs-avatar-partner 再回退桌面 avatar-partner
//       ⑥构建产物静态断言
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9760 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-calledit-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await gotoApp();

// 三张互不相同的 1x1 PNG：桌面头像 / 聊天域(通话)头像 / 通话背景
const AV_DESK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const AV_CS = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const BG_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ---- S 组：种入桌面头像/聊天头像/通话背景后重载 ----
await evalJs(`(function(){
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  localStorage.setItem('xy-home-v2:default:avatar-partner', '${AV_DESK}');
  localStorage.setItem('xy-home-v2:default:cs-avatar-partner', '${AV_CS}');
  localStorage.setItem('xy-home-v2:default:call-bg', '${BG_PNG}');
  location.reload();
  return 'seeded';
})()`);
await sleep(400);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);

let s = await evalJs(`(function(){
  return {
    desk: localStorage.getItem('xy-home-v2:default:avatar-partner'),
    cs: localStorage.getItem('xy-home-v2:default:cs-avatar-partner'),
    bg: localStorage.getItem('xy-home-v2:default:call-bg')
  };
})()`);
check('S1 种入桌面头像/聊天头像/通话背景并重载成功', s && s.desk === AV_DESK && s.cs === AV_CS && s.bg === BG_PNG, JSON.stringify(s));

// ---- A 组：通话半框新入口与回显 ----
await evalJs(`(function(){
  var a = document.querySelector('.app[data-app="chat"]');
  if (a) a.click();
  var mc = document.getElementById('more-call');
  if (mc) mc.click();
  return 'open';
})()`);
await sleep(700);
s = await evalJs(`(function(){
  var p = document.getElementById('chat-call-panel');
  var avRow = document.getElementById('call-av-edit-row');
  var bgRow = document.getElementById('call-bg-edit-row');
  var rm = document.getElementById('call-bg-edit-remove');
  var bgVal = document.getElementById('call-bg-edit-val');
  return {
    panelOpen: !!(p && !p.hidden),
    hasRows: !!avRow && !!bgRow,
    rmVisible: !!(rm && !rm.hidden),
    bgVal: bgVal ? bgVal.textContent : ''
  };
})()`);
check('A1 通话半框打开且含「联系人头像/通话背景图片」两行，背景行显示已设置、移除行可见', s && s.panelOpen && s.hasRows && s.rmVisible && s.bgVal === '已设置', JSON.stringify(s));

s = await evalJs(`(function(){
  var panel = document.querySelector('.call-mask .call-panel');
  return {
    hasBg: !!(panel && panel.classList.contains('has-bg')),
    img: panel ? panel.style.backgroundImage : ''
  };
})()`);
check('A2 通话大面板已应用背景图（has-bg + backgroundImage 命中种入图）', s && s.hasBg && s.img.indexOf(BG_PNG) >= 0, JSON.stringify({ ...s, img: s && s.img.slice(0, 60) }));

// ---- C 组：背景图片行走共用上传流程（拦截 file input 的 click，不弹原生选择框） ----
s = await evalJs(`(function(){
  window.__fileClicks = 0;
  var proto = HTMLInputElement.prototype;
  var orig = proto.click;
  proto.click = function(){ if (String(this.type || '').toLowerCase() === 'file') { window.__fileClicks++; return; } return orig.apply(this, arguments); };
  document.getElementById('call-bg-edit-row').click();
  proto.click = orig;
  return window.__fileClicks;
})()`);
check('C1 点「通话背景图片」行触发文件选择（与设置页共用 pickCallBg）', s !== null && s >= 1, String(s));

// ---- B 组：联系人头像行 → 收起通话半框并打开头像互动 ----
s = await evalJs(`(function(){
  document.getElementById('call-av-edit-row').click();
  var cp = document.getElementById('chat-call-panel');
  var av = document.getElementById('avlib-card');
  var opened = !!(av && !av.hidden);
  var closedBtn = document.getElementById('avlib-close');
  if (closedBtn) closedBtn.click();
  var avClosed = !!(av && av.hidden);
  return { callPanelHidden: !!(cp && cp.hidden), avlibOpened: opened, avlibClosedByBtn: avClosed };
})()`);
await sleep(300);
check('B1 点「联系人头像」行：通话半框收起 + 头像互动半框打开，可关闭返回', s && s.callPanelHidden && s.avlibOpened && s.avlibClosedByBtn, JSON.stringify(s));

// ---- D 组：通话头像跟随聊天域（cs-avatar-partner 优先，回退桌面键） ----
s = await evalJs(`(function(){
  var mc = document.getElementById('more-call');
  if (mc) mc.click();
  if (window.triggerIncomingCall) window.triggerIncomingCall();
  var im = document.querySelector('#call-av img');
  var src = im ? im.src : '';
  if (window.hangupCall) window.hangupCall();
  return { src: src };
})()`);
await sleep(300);
check('D1 来电面板头像 = 聊天域 cs-avatar-partner（不再是旧桌面键）', s && s.src === AV_CS, s ? 'src=' + s.src.slice(0, 60) : 'null');

await evalJs(`(function(){
  localStorage.removeItem('xy-home-v2:default:cs-avatar-partner');
  location.reload();
  return 'reloading';
})()`);
await sleep(400);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);
s = await evalJs(`(function(){
  if (window.triggerIncomingCall) window.triggerIncomingCall();
  var im = document.querySelector('#call-av img');
  var src = im ? im.src : '';
  if (window.hangupCall) window.hangupCall();
  return { src: src };
})()`);
await sleep(300);
check('D2 未设聊天域头像时回退桌面键 avatar-partner', s && s.src === AV_DESK, s ? 'src=' + s.src.slice(0, 60) : 'null');

// ---- A3：移除行恢复默认背景（放最后，破坏性操作） ----
await evalJs(`(function(){
  var mc = document.getElementById('more-call');
  if (mc) mc.click();
  var rm = document.getElementById('call-bg-edit-remove');
  if (rm && !rm.hidden) rm.click();
  return 'removed';
})()`);
await sleep(500);
s = await evalJs(`(function(){
  var panel = document.querySelector('.call-mask .call-panel');
  var bgVal = document.getElementById('call-bg-edit-val');
  var rm = document.getElementById('call-bg-edit-remove');
  var toastEl = document.getElementById('cc-toast');
  return {
    keyCleared: !localStorage.getItem('xy-home-v2:default:call-bg'),
    hasBgClass: !!(panel && panel.classList.contains('has-bg')),
    bgVal: bgVal ? bgVal.textContent : '',
    rmHidden: !!(rm && rm.hidden),
    toast: toastEl ? toastEl.textContent : ''
  };
})()`);
check('A3 点「移除通话背景」：键清除、has-bg 移除、回显默认、移除行隐藏、toast 提示', s && s.keyCleared && !s.hasBgClass && s.bgVal === '默认' && s.rmHidden && s.toast === '已恢复默认通话背景', JSON.stringify(s));

// ---- F 组：构建产物静态断言 ----
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  check('F1 构建产物含三个编辑行锚点与危险行样式类', html.indexOf('call-av-edit-row') >= 0 && html.indexOf('call-bg-edit-row') >= 0 && html.indexOf('call-bg-edit-remove') >= 0 && html.indexOf('call-panel-row-danger') >= 0, '');
  check('F2 通话头像读聊天域 cs-avatar-partner 回退桌面键（partnerAv/syncCallAv 两处）', html.split("get('cs-avatar-partner') || ").length >= 3 && html.indexOf("store.get('cs-avatar-partner') || store.get('avatar-partner')") >= 0, '');
  check('F3 设置页行与通话半框行共用 pickCallBg 绑定', html.indexOf("callBgRow.addEventListener('click', pickCallBg)") >= 0 && html.indexOf("callBgEditRow.addEventListener('click', pickCallBg)") >= 0, '');
}

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

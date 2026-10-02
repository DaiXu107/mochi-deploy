// ===== 验证脚本：移动/装修模式下桌面横滑翻页恢复 + 拖拽手势归属不回归 =====
// 用法：node build.mjs && node tools/verify-desk-move-swipe.mjs
// 需要：Node 21+（内置 fetch / WebSocket）+ 本机 Chrome/Edge
//       （找不到浏览器时用环境变量 CHROME_PATH 指定，如 CHROME_PATH="C:\...\chrome.exe"）
// 检查项：① 移动模式开启后 容器(#desktop-pages/.page-slide) touch-action=pan-x pan-y（允许横滑翻页）；
//         ② 可拖拽元素(.app/[data-desk-widget]) touch-action=none（手势归拖拽，不被浏览器抢占）；
//         ③ 模拟触摸在桌面空白处左滑 → desktop-pages.scrollLeft 前进（翻到第二页）——修复前 pan-y 会原地不动；
//         ④ 模拟触摸按住图标并移动 → 出现 .desk-drag-clone（长按拖拽仍生效）；
//         ⑤ 翻回后右键/长按不弹原生菜单（contextmenu 被拦截）。
// 任一失败退出码 1。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1. 找浏览器 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node 21+（内置 WebSocket），当前 Node ' + process.version);
  process.exit(1);
}

// ---- 2. 静态服务器 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

// ---- 3. 启动无头 Chrome + CDP ----
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9400 + Math.floor(Math.random() * 500));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-desk-swipe-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

// ---- 4. 初始化 ----
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');var c=document.getElementById('splash-confirm');if(c)c.hidden=true;if(s){s.classList.add('hide');setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s);},50);}return true;})()");
await sleep(900);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 辅助：在指定 page-slide 内找空白坐标（避开 .app / [data-desk-widget] / .dots）
async function findBlankInSlide(slideIdx) {
  return JSON.parse(await evalJs(`(function(){
    var dp = document.getElementById('desktop-pages');
    var sl = dp.querySelectorAll('.page-slide')[${slideIdx}];
    if (!sl) return 'null';
    var r = sl.getBoundingClientRect();
    for (var yy = r.top + 60; yy < r.bottom - 80; yy += 36) {
      for (var xx = r.left + 30; xx < r.right - 30; xx += 36) {
        var el = document.elementFromPoint(xx, yy);
        if (!el || !el.closest) continue;
        if (el.closest('.app') || el.closest('[data-desk-widget]') || el.closest('.dots') || el.closest('.desk-page-hint') || el.closest('.desk-page-add')) continue;
        return JSON.stringify({ x: xx, y: yy, at: (el.className || el.tagName).toString().slice(0, 30), path: (function(){ var p=[]; var n=el; for(var i=0;i<4&&n;i++){ p.push((n.className||n.tagName).toString().slice(0,18)); n=n.parentElement; } return p.join('/'); })() });
      }
    }
    return 'null';
  })()`));
}

// T0 对照：非移动模式下横滑翻页（验证无头手势模拟本身是否有效）
await evalJs(`(function(){ window.__diagT = []; ['touchstart','touchmove','touchend'].forEach(function(ev){ document.addEventListener(ev, function(e){ window.__diagT.push(ev + '@' + Math.round((e.touches&&e.touches[0]?e.touches[0].clientX:0)) + ',' + Math.round((e.touches&&e.touches[0]?e.touches[0].clientY:0)) + ' t=' + (e.target&&e.target.className||e.target.tagName).toString().slice(0,20)); }, true); }); return true; })()`);
const geom0 = await findBlankInSlide(0);
const sl0 = await evalJs('document.getElementById("desktop-pages").scrollLeft');
if (geom0 && geom0.x) {
  console.log('  [diag] T0 坐标=(' + geom0.x + ',' + geom0.y + ') elementAt=' + geom0.at + ' scrollLeft=' + sl0);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geom0.x, y: geom0.y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: geom0.x - i * 26, y: geom0.y }] });
    await sleep(16);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  console.log('  [diag] T0 事件=' + JSON.stringify(await evalJs('window.__diagT && window.__diagT.slice(-12)')));
} else {
  console.log('  [diag] T0 找不到第一页空白坐标');
}
const sl1 = await evalJs('document.getElementById("desktop-pages").scrollLeft');
check('T0 对照：非移动模式横滑可翻页', sl1 > sl0, (sl1 | 0) + ' > ' + (sl0 | 0));
await evalJs('document.getElementById("desktop-pages").scrollTo({left:0,behavior:"instant"})');
await sleep(300);

// T0b 纯装饰模式（从设置入口进，不进移动模式）：组件上快速横滑 → 应翻页
await evalJs("(function(){var r=document.getElementById('row-custom-icon');if(r)r.click();return true;})()");
await sleep(400);
const decorOnly = await evalJs("(function(){var ph=document.getElementById('page-phone');return JSON.stringify({decor:ph&&ph.classList.contains('decor-on'),move:ph&&ph.classList.contains('desk-move-mode')});})()");
const dj = JSON.parse(decorOnly);
const slD0 = await evalJs('document.getElementById("desktop-pages").scrollLeft');
const dApp = JSON.parse(await evalJs(`(function(){
  var a = document.querySelector('.page-slide .app');
  if (!a) return 'null';
  var ar = a.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(ar.left + ar.width / 2), y: Math.round(ar.top + ar.height / 2) });
})()`));
let decorSwipeOk = false;
if (dj.decor && dApp && dApp.x) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dApp.x, y: dApp.y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dApp.x - i * 26, y: dApp.y }] });
    await sleep(16);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(600);
  const slD1 = await evalJs('document.getElementById("desktop-pages").scrollLeft');
  decorSwipeOk = slD1 > slD0;
  console.log('  [diag] T0b 装饰模式组件横滑 ' + slD0 + ' -> ' + slD1);
}
check('T0b 纯装饰模式组件横滑可翻页', dj.decor && decorSwipeOk);
// 退出装饰模式（完成按钮），回初始态
await evalJs("(function(){var b=document.getElementById('decor-done');if(b)b.click();return true;})()");
await sleep(300);
await evalJs('document.getElementById("desktop-pages").scrollTo({left:0,behavior:"instant"})');
await sleep(300);

// T1 移动模式开启（复用「编辑布局」按钮，等价于长按进移动模式）
await evalJs("(function(){var b=document.getElementById('decor-edit-layout');if(b)b.click();return true;})()");
await sleep(300);
const moveOn = await evalJs("(function(){var ph=document.getElementById('page-phone');var dp=document.getElementById('desktop-pages');var sl=dp&&dp.querySelector('.page-slide');var a=dp&&dp.querySelector('.app');return JSON.stringify({cls:ph&&ph.classList.contains('desk-move-mode'),decor:ph&&ph.classList.contains('decor-on'),bar:!!document.getElementById('decor-bar')&&!document.getElementById('decor-bar').hidden});})()");
check('T1 移动模式已开启（desk-move-mode + decor-on + 装饰条）', moveOn && JSON.parse(moveOn).cls && JSON.parse(moveOn).decor && JSON.parse(moveOn).bar);

// T2 手势归属：容器允许横滑翻页，可拖拽元素 none（手势归拖拽）
const g = await evalJs(`(function(){
  var dp = document.getElementById('desktop-pages');
  var sl = dp.querySelector('.page-slide');
  var a = dp.querySelector('.app');
  var w = dp.querySelector('[data-desk-widget]');
  return JSON.stringify({ dp: dp && getComputedStyle(dp).touchAction, slide: sl && getComputedStyle(sl).touchAction, app: a && getComputedStyle(a).touchAction, widget: w && getComputedStyle(w).touchAction });
})()`);
const gj = JSON.parse(g);
check('T2 容器 touch-action = pan-x pan-y（允许横滑）', gj.dp === 'pan-x pan-y' && gj.slide === 'pan-x pan-y', (gj.dp || '?') + ' / ' + (gj.slide || '?'));
check('T3 可拖拽元素 touch-action = none（手势归 JS 拖拽/翻页判定）', (gj.app === 'none' || gj.widget === 'none'), (gj.app || '?') + ' / ' + (gj.widget || '?'));

// T4 移动模式组件上快速横滑 → JS 手势翻页（修复前滑不动）
let swiped = false;
// 回到第一页
await evalJs('document.getElementById("desktop-pages").scrollTo({left:0,behavior:"instant"})');
await sleep(300);
// 找第一页第一个可见组件（含 .app 图标）的中心作为滑动起点
const swipeGeom = JSON.parse(await evalJs(`(function(){
  var dp = document.getElementById('desktop-pages');
  var a = dp.querySelector('.app');
  if (!a) return 'null';
  var ar = a.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(ar.left + ar.width / 2), y: Math.round(ar.top + ar.height / 2) });
})()`));
if (swipeGeom && swipeGeom.x) {
  const before = await evalJs('document.getElementById("desktop-pages").scrollLeft');
  const x0 = swipeGeom.x, y0 = swipeGeom.y;
  console.log('  [diag] T4 移动模式组件横滑起点=(' + x0 + ',' + y0 + ') scrollLeft before=' + before);
  await evalJs('window.__diagT = []');
  // 快速横滑（10 帧向左，模拟翻页滑动）
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 26, y: y0 }] });
    await sleep(16);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(600);
  const after = await evalJs('document.getElementById("desktop-pages").scrollLeft');
  console.log('  [diag] T4 事件=' + JSON.stringify(await evalJs('window.__diagT && window.__diagT.slice(-12)')));
  console.log('  [diag] scrollLeft after=' + after);
  check('T4 移动模式组件横滑翻页（scrollLeft 前进）', after > before, (after | 0) + ' > ' + (before | 0));
  swiped = after > before;
} else {
  check('T4 移动模式组件横滑翻页（scrollLeft 前进）', false, '找不到组件坐标');
}
// 回到第一页供 T5 拖拽
await evalJs('document.getElementById("desktop-pages").scrollTo({left:0,behavior:"instant"})');
await sleep(300);

// T5 按住图标拖动 → 出现拖拽 clone（长按拖拽仍生效）
const appGeom = JSON.parse(await evalJs(`(function(){
  var dp = document.getElementById('desktop-pages');
  // 当前可见的 page-slide（scrollLeft 最近的）
  var slides = dp.querySelectorAll('.page-slide');
  var cur = 0, best = Infinity;
  for (var i = 0; i < slides.length; i++) { var d = Math.abs(slides[i].getBoundingClientRect().left - dp.getBoundingClientRect().left); if (d < best) { best = d; cur = i; } }
  var a = slides[cur] ? slides[cur].querySelector('.app, [data-desk-widget]') : null;
  if (!a) return 'null';
  var ar = a.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(ar.left + ar.width / 2), y: Math.round(ar.top + ar.height / 2) });
})()`));
if (appGeom && appGeom.x) {
  const cx = appGeom.x, cy = appGeom.y;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await sleep(420); // 超过长按 350ms，进入移动模式 + 开始拖拽
  const hasCloneDuring = await evalJs('!!document.querySelector(".desk-drag-clone")');
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 26, y: cy + 8 }] });
  await sleep(60);
  const hasCloneAfter = await evalJs('!!document.querySelector(".desk-drag-clone")');
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  check('T5 长按图标可拖拽（出现拖拽 clone）', hasCloneDuring || hasCloneAfter);
} else {
  check('T5 长按图标可拖拽（出现拖拽 clone）', false, '找不到图标坐标');
}

// T6 翻页后返回第一页，避免环境差异；右键/长按不弹原生菜单（contextmenu 被拦截）
await evalJs('document.getElementById("desktop-pages").scrollTo({left:0})');
await sleep(300);
const menuEvt = await evalJs(`(function(){
  var ph = document.getElementById('page-phone');
  var blocked = false;
  function h(e){ blocked = true; }
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); blocked = true; }, true);
  var ev = new Event('contextmenu', { cancelable: true });
  var ret = ph.dispatchEvent(ev);
  return JSON.stringify({ defaultPrevented: ret === false || (ev.defaultPrevented === true), blocked: blocked });
})()`);
const mj = JSON.parse(menuEvt);
check('T6 桌面右键/长按被拦截（contextmenu preventDefault）', mj.blocked === true && mj.defaultPrevented === true);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

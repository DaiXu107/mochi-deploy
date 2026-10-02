// ===== 验证脚本：桌面小组件位置持久化（装修/移动模式拖动 → 保存 → 重启不回退）=====
// 用法：node build.mjs && node tools/verify-desk-persist.mjs
// 需要：Node 21+（内置 fetch / WebSocket）+ 本机 Chrome/Edge
//       （找不到浏览器时用环境变量 CHROME_PATH 指定）
// 背景：用户反馈 vivo Edge「小组件调整位置点保存后，再次打开回到调整前的位置」。
// 检查项：
//   T1 长按拖动组件换位 → desk-layout 落库（localStorage）且 DOM 顺序改变；
//   T2 刷新页面（同一 profile）→ 布局从存储恢复，DOM 顺序与保存的一致；
//   T3 只删 localStorage 的 desk-layout（模拟配额/清理导致 LS 缺失、仅 IDB 有数据）→
//      刷新后 mochi-restore-done 回填完成时布局仍应被应用（rebuildDeskWhenReady 补应用，
//      v3.14.x 前：首次 applyDeskLayout 在脚本加载期读空直接放弃，此后无人补应用 → 失败）。
// 排错记录：目标坐标必须在移动模式生效、装修态布局稳定后现取——进出装修态会显隐
// 装修提示节点使组件矩形整体位移，提前算好的绝对坐标会落到错误插入点（表现为
// insertBefore(x, 原邻位) 无操作、顺序不变）。任一失败退出码 1。
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 400));
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-desk-persist-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir,
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

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 打开页面并等启动完成（数据就绪 + splash 移除）
async function openApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');var c=document.getElementById('splash-confirm');if(c)c.hidden=true;if(s){s.classList.add('hide');setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s);},50);}return true;})()");
  await sleep(800);
}

// 读第 0 页顶层组件顺序（DOM 现状，只看 slide 直接子节点）
function slideOrderExpr() {
  return `(function(){
    var dp = document.getElementById('desktop-pages');
    var sl = dp && dp.querySelector('.page-slide');
    if (!sl) return 'null';
    return JSON.stringify(Array.prototype.slice.call(sl.children)
      .filter(function(n){ return n.hasAttribute && n.hasAttribute('data-desk-widget'); })
      .map(function(n){ return n.getAttribute('data-desk-widget'); }));
  })()`;
}
// 已存布局第 0 页数组 + 存储键名（localStorage 快照）
const layoutInfoExpr = `(function(){
  var keys = [];
  for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && /:desk-layout$/.test(k)) keys.push(k); }
  if (!keys.length) return 'null';
  var v = localStorage.getItem(keys[0]);
  return JSON.stringify({ key: keys[0], first: v ? JSON.parse(v)[0] : null });
})()`;
// 取指定组件内一个真正命中该组件的按点（组件中心可能落在子卡间隙上，
// pointerdown 的 closest 匹配不到组件会导致长按不触发；在矩形内多点探测）
function centerOfExpr(wid) {
  return `(function(){
    var sl = document.querySelector('#desktop-pages .page-slide');
    var n = sl && sl.querySelector('[data-desk-widget="${wid}"]');
    if (!n) return 'null';
    var r = n.getBoundingClientRect();
    var offs = [[0.5,0.5],[0.32,0.5],[0.68,0.5],[0.5,0.3],[0.5,0.72],[0.25,0.35],[0.75,0.65]];
    for (var i=0;i<offs.length;i++){
      var x = Math.round(r.left + r.width*offs[i][0]), y = Math.round(r.top + r.height*offs[i][1]);
      var el = document.elementFromPoint(x,y);
      if (el && el.closest && el.closest('[data-desk-widget]') === n) return JSON.stringify({x:x,y:y});
    }
    return 'null';
  })()`;
}
// 移动模式生效后取：第 0 页顶层组件数组中 SRC 的下一个组件下部落点（85% 高度处，
// 落点过中线才会判到再下一个插入位，避免等价原位的无操作插入）
function dropPairExpr(wid) {
  return `(function(){
    var dp = document.getElementById('desktop-pages');
    var sl = dp.querySelector('.page-slide');
    var all = Array.prototype.slice.call(sl.children).filter(function(n){ return n.hasAttribute && n.hasAttribute('data-desk-widget'); });
    var si = -1;
    for (var i=0;i<all.length;i++){ if(all[i].getAttribute('data-desk-widget')==='${wid}'){ si=i;break; } }
    if (si < 0 || si+1 >= all.length) return 'null';
    var b = all[si+1].getBoundingClientRect();
    return JSON.stringify({ dstW: all[si+1].getAttribute('data-desk-widget'), x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height*0.85) });
  })()`;
}

// ---- T1：长按组件 550ms 进移动模式+起拖 → 拖到下一组件下部松手 ----
await openApp();
const before = JSON.parse(await evalJs(slideOrderExpr()));
console.log('  [diag] 第0页初始顺序=' + JSON.stringify(before));
// 自动挑一个「可命中、可拖」的组件：apps=图标整组走网格分支要避开；deco 在装修态
// 顶部易被提示节点挤位；候选按 DOM 序取第一个探到有效按点的（中心可能落在子卡间隙）
const candIds = (before || []).filter(w => w !== 'apps' && w !== 'p2apps' && w !== 'deco');
let dragSrc = null, src = null;
for (const wid of candIds) {
  const p = JSON.parse(await evalJs(centerOfExpr(wid)));
  if (p && p.x) { dragSrc = wid; src = p; break; }
}
if (!dragSrc || before.indexOf(dragSrc) >= before.length - 1) {
  check('T1 前置：第0页有可拖组件且不位于末位', false, 'cand=' + JSON.stringify(candIds));
} else {
  console.log('  [diag] 拖动组件=' + dragSrc + ' 按点=' + JSON.stringify(src));
  // 输入事件流/错误/DOM 变更捕获
  await evalJs("(function(){ window.__dragDiag={clone:0}; new MutationObserver(function(){ if(document.querySelector('.desk-drag-clone')) window.__dragDiag.clone++; }).observe(document.body,{childList:true}); window.__errs=[]; window.addEventListener('error',function(e){ window.__errs.push(String(e.message).slice(0,80)); }); return true; })()");
  if (!src || !src.x) {
    check('T1 前置：取得源组件坐标', false, JSON.stringify(src));
  } else {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: src.x, y: src.y }] });
    await sleep(550); // 超过长按 350ms：进移动模式 + startDeskDrag
    // 模式已生效、布局已稳定 → 现取目标落点
    const dst = JSON.parse(await evalJs(dropPairExpr(dragSrc)));
    if (!dst || !dst.x) {
      await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      check('T1 前置：取得目标落点（移动模式生效后）', false, JSON.stringify(dst));
    } else {
      for (let i = 1; i <= 8; i++) {
        await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: src.x + Math.round((dst.x - src.x) * i / 8), y: src.y + Math.round((dst.y - src.y) * i / 8) }] });
        await sleep(40);
      }
      await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(600);
      console.log('  [diag] clone=' + JSON.stringify(await evalJs('window.__dragDiag')) + ' 错误=' + JSON.stringify(await evalJs('window.__errs')));
      const o0 = await evalJs(slideOrderExpr());
      // 点完成退出（模拟用户点保存）
      await evalJs("(function(){var b=document.getElementById('decor-done');if(b)b.click();return true;})()");
      await sleep(400);
      const afterDom = JSON.parse(await evalJs(slideOrderExpr()));
      const saved = JSON.parse(await evalJs(layoutInfoExpr));
      const domChanged = JSON.stringify(afterDom) !== JSON.stringify(before);
      // saveDeskLayout 用 querySelectorAll 收集（含 apps 网格内嵌套的 app-* 图标条目，
      // 排在顶层组件之后）——按前缀比较第 0 页顶层顺序
      const savedMatches = !!(saved && saved.first && JSON.stringify(saved.first.slice(0, afterDom.length)) === JSON.stringify(afterDom));
      check('T1a 拖动后 DOM 顺序改变', domChanged, JSON.stringify(before) + ' -> 落地=' + o0 + ' -> 完成=' + JSON.stringify(afterDom));
      check('T1b desk-layout 已按新 DOM 落库', savedMatches, saved ? JSON.stringify(saved.first) : 'null');

      // ---- T2：刷新（同一 profile），布局应保持 ----
      await openApp();
      const reloaded = JSON.parse(await evalJs(slideOrderExpr()));
      check('T2 重启后组件顺序保持', JSON.stringify(reloaded) === JSON.stringify(afterDom),
        JSON.stringify(reloaded) + ' 期望 ' + JSON.stringify(afterDom));

      // ---- T3：模拟 LS 缺失（只存于 IDB）：删 LS 键后刷新，回填完成时应补应用布局 ----
      await evalJs(`(function(){ var ks=[]; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(k&&/:desk-layout$/.test(k)) ks.push(k);} ks.forEach(function(k){localStorage.removeItem(k);}); return ks.join(','); })()`);
      await openApp();
      await sleep(1500); // 等 rebuildDeskWhenReady（mochi-restore-done 后 buildDeskPages+applyDeskLayout）跑完
      const healed = JSON.parse(await evalJs(slideOrderExpr()));
      check('T3 仅 IDB 有布局时重启仍恢复顺序', JSON.stringify(healed) === JSON.stringify(afterDom),
        JSON.stringify(healed) + ' 期望 ' + JSON.stringify(afterDom));
    }
  }
}

chrome.kill();
server.close();
const fail = results.filter(r => !r.ok).length;
console.log('==== verify-desk-persist: ' + (results.length - fail) + '/' + results.length + ' ====');
process.exit(fail ? 1 : 0);

// ===== 常驻回归脚本：#931 朋友圈【贴纸】面板「点开非常卡顿」（多机型同发，零机型分支）=====
// 用法：node build.mjs && node tools/verify-feed-sticker-perf.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-feed-sticker-perf.mjs   （测临时构建副本，红绿对照）
// 用户报障原文：「朋友圈里点击贴纸，打开贴纸功能会非常卡顿……其他设备型号也有出现」。
// 根因（无头 393×851 dsf3 + CPU 4× 节流实测，150 张真 dataURL 库）：贴纸面板把当前视图全部贴纸
//   一次性 img.src=<20~68KB dataURL> 同步挂进 DOM＝一次交互里上百次「大字符串属性赋值 + 立即解码」
//   （微基准 150 张赋值 175ms 量级、冷开同步 175ms、点「全部」365ms），且每次重写整格直接丢弃旧
//   节点＝关掉再开 0/150 个节点被复用、上百张从零重解码（重开同步 292ms）。同环境同库的聊天表情
//   面板（#435 进视口才补 src + 分批泵 + #662 同身份节点回收 + #457 内容签名短路）冷开 60ms、重开 8~12ms。
// 修法＝把聊天侧那套已实证机制接到本面板（feed.js 自持 IntersectionObserver、图源只挂 JS 引用不进
//   DOM 属性、点击走一条委托、内容未变整格不重建），零 UA/机型/内核判断。
// 断言面：S 产物锚（机制在不在）/ B1~B8 行为（懒挂载·面板标记体积·进视口真出图·重开复用与耗时·
//   切分组耗时·委托点击落位·4 列网格几何·令牌批量预热被调用）/ Z 零 JS 异常。
// 红基线（纯 HEAD 产物）实测：红 S1~S6 + B1/B2/B4/B8＝用户所见缺陷面；B0/B3/B3b/B6/B7/Z 两侧同绿
//   ＝防修过头闸（别把懒加载做成「永不显示」、别把点格子选位改掉、别丢 4 列网格、别报错）。
//   B5 是耗时软闸（红侧随负载 38~109ms 抖动、绿侧 11~25ms），只作绿侧防回流，不当红绿判别面。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (...p) => { try { return readFileSync(join(root, ...p), 'utf8'); } catch (e) { return ''; } };
const feedProduct = read('js', 'feed.js') || read('index.html');
const chatProduct = read('js', 'chat.js') || read('index.html');

const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (info ? '  [' + info + ']' : '')); };

// ---- S：产物锚（机制被删/被改没，先看这一组）----
check('S1 贴纸图交给聊天侧同一条分批泵（删＝回到一次性全量挂 src）',
  feedProduct.includes('window.mochiEmojiLazyEnqueue(img, src)'), 'js/feed.js');
check('S2 整格重写前先回收旧 img（删＝每次从零重解码，重开必卡）',
  feedProduct.includes('feedStickerHarvest(list)'), 'js/feed.js');
check('S3 内容签名短路在位（删＝同样的内容每次重建上百格子）',
  feedProduct.includes('sig === feedStickerRenderSig'), 'js/feed.js');
check('S4 本面板自持可见性观察器（删＝要么全量挂载要么图永不出现）',
  feedProduct.includes('new IntersectionObserver') && feedProduct.includes("rootMargin: '120px 0px'"), 'js/feed.js');
check('S5 聊天侧导出可被外部容器借用（删＝feed 拿不到泵/回收池）',
  chatProduct.includes('window.mochiEmojiLazyEnqueue = emojiLazyEnqueue;') && chatProduct.includes('window.mochiEmojiLazyAdopt = emojiAdoptImg;'), 'js/chat.js');
check('S6 泵按 JS 引用取源、用完即清（删＝节点被回收池复活时带着上一轮的源）',
  chatProduct.includes('img.__emojiLazySrc = null;'), 'js/chat.js');

// ---- 浏览器侧：真种子 + 真点击 ----
const N = Number(process.env.N || 150);
const THROTTLE = Number(process.env.CPU_THROTTLE || 4);
const cands = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x64)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = cands.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，无法跑行为断言'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9931 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-931-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 80; i++) {
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
  console.error('CDP 连不上'); process.exit(2);
}
const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常', JSON.stringify(r.exceptionDetails).slice(0, 240)); return null; }
  return r && r.result ? r.result.value : null;
}
// 种子：canvas 现造 N 张真 JPEG dataURL（≈4~20KB，形态与用户上传的表情包一致），分 3 组写进
// 「我的表情包」键；配图动态 8 条（朋友圈要有【贴纸】按钮）。
const boot = `
(function () {
  function mk(i) {
    var c = document.createElement('canvas'); c.width = 420; c.height = 420;
    var x = c.getContext('2d');
    x.fillStyle = 'rgb(' + (200 + (i % 40)) + ',' + (180 - (i % 60)) + ',220)'; x.fillRect(0, 0, 420, 420);
    x.fillStyle = '#e0507a'; x.beginPath(); x.arc(210, 210, 150 + (i % 30), 0, 6.3); x.fill();
    for (var k = 0; k < 26; k++) { x.fillStyle = 'rgba(90,120,' + ((i * 7 + k * 5) % 255) + ',.85)'; x.fillRect((k * 61) % 400, (k * 97) % 400, 38, 38); }
    return c.toDataURL('image/jpeg', 0.92);
  }
  var g1 = [], g2 = [], g3 = [];
  for (var i = 0; i < ${N}; i++) { var s = mk(i); (i < 50 ? g1 : (i < 100 ? g2 : g3)).push(s); }
  try { localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['\\u5e38\\u7528', g1], ['\\u6536\\u85cf', g2], ['\\u7b2c\\u4e09\\u6279', g3]])); }
  catch (e) { window.__seedErr = String(e).slice(0, 90); }
  var T = Date.now(), img = mk(9999), posts = [];
  for (var j = 0; j < 8; j++) posts.push({ id: 'f_' + (1700000000000 + j) + '_default', role: 'me', owner: 'default', authorName: '\\u6211', taName: '\\u5c0f\\u6843', content: '\\u52a8\\u6001' + j, imgs: [img], ts: T - j * 60000, likes: [], comments: [] });
  var SEED = JSON.stringify(posts), FEED = 'xy-home-v2:feed-posts';
  Object.defineProperty(window, 'idbGet', { configurable: true, get: function () { return function (k) { return Promise.resolve(k === FEED ? SEED : null); }; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: true, get: function () { return function () { return Promise.resolve(true); }; }, set: function () {} });
  window.__warmN = 0; window.__enqN = 0;
})();
`;
await connect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 851, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1500);
await evalJs(`(function () {
  var w = window.mochiEmojiWarmGroupTokens;
  if (w && !window.__warmWrapped) { window.__warmWrapped = 1; window.mochiEmojiWarmGroupTokens = function (a) { window.__warmN++; return w(a); }; }
  var e = window.mochiEmojiLazyEnqueue;
  if (e && !window.__enqWrapped) { window.__enqWrapped = 1; window.mochiEmojiLazyEnqueue = function (img, s) { window.__enqN++; return e(img, s); }; }
  var p = new PerformanceObserver(function (l) { l.getEntries().forEach(function (x) { (window.__lt = window.__lt || []).push(Math.round(x.duration)); }); });
  try { p.observe({ entryTypes: ['longtask'] }); } catch (e2) {}
  return 1;
})()`);

const snap = () => evalJs(`(function () {
  var list = document.getElementById('feed-sticker-list');
  var card = document.getElementById('feed-sticker-card');
  if (!list || !card) return null;
  var imgs = [].slice.call(list.querySelectorAll('img'));
  var g = list.querySelector('.emoji-grid');
  var lr = list.getBoundingClientRect();
  var vis = 0;
  imgs.forEach(function (i) { var r = i.getBoundingClientRect(); if (r.width > 0 && r.bottom > lr.top - 130 && r.top < lr.bottom + 130) vis++; });
  var iw = 0;
  if (g && g.firstElementChild) iw = g.firstElementChild.getBoundingClientRect().width;
  return {
    imgs: imgs.length, withSrc: imgs.filter(function (i) { return !!i.getAttribute('src'); }).length,
    asyncDec: imgs.filter(function (i) { return i.decoding === 'async'; }).length,
    dataSrc: list.querySelectorAll('img[data-src]').length,
    htmlLen: card.innerHTML.length, grid: !!g, cellW: Math.round(iw), listW: Math.round(lr.width),
    vis: vis, enqN: window.__enqN || 0, warmN: window.__warmN || 0,
    items: list.querySelectorAll('.emoji-item[data-stk-idx]').length,
    lt: (window.__lt || []).slice(-3)
  };
})()`);

// B1 冷开：整格挂上但不一次性写 src（红＝150/150 立刻带 src、0 async）
await evalJs(`(function(){ document.querySelector('.app[data-app="feed"]').click(); return 1; })()`);
await sleep(600);
const opened = await evalJs(`(function () {
  var b = document.querySelector('#feed-list .feed-act[data-sticker]');
  if (!b) return null;
  var t0 = performance.now(); b.click(); var t1 = performance.now();
  window.__openMs = Math.round(t1 - t0);
  [].slice.call(document.querySelectorAll('#feed-sticker-list img')).forEach(function (i) { i.__probe = 1; });
  return 1;
})()`);
check('B0 环境：朋友圈里有【贴纸】入口且面板可打开', !!opened);
const cold = await snap();
check('B1 冷开一次性挂 src 归零（全部懒挂 + decoding=async）',
  !!cold && cold.imgs >= 100 && cold.withSrc === 0 && cold.asyncDec === cold.imgs, cold && JSON.stringify(cold));
check('B2 面板标记体积不含大 dataURL（防「图源写进 DOM 属性」回流）',
  !!cold && cold.htmlLen < 60000 && cold.dataSrc === 0, cold && 'htmlLen=' + cold.htmlLen + ' dataSrc=' + cold.dataSrc);
check('B7 网格仍是聊天侧 4 列几何（防 .emoji-grid 容器丢失＝每格撑成整行）',
  !!cold && cold.grid && cold.cellW > 0 && cold.cellW < cold.listW / 2, cold && JSON.stringify({ grid: cold.grid, cellW: cold.cellW, listW: cold.listW }));

// B3 进视口的图真能出图（防「懒过头＝永远不显示」），且不全量（红＝一次全挂）
await sleep(2600);
const lazy = await snap();
check('B3 进视口的图在若干拍后真补上 src（懒而不漏）', !!lazy && lazy.withSrc > 0 && lazy.withSrc <= lazy.imgs, lazy && 'withSrc=' + lazy.withSrc + '/' + lazy.imgs + ' enq=' + lazy.enqN);

// B3b 滚到底要能补上（懒加载最容易修成「滚过去了还是白格」；红基线一次全挂也满足＝防修过头闸）
const scrolled = await evalJs(`(async function () {
  var list = document.getElementById('feed-sticker-list');
  if (!list) return null;
  var step = Math.max(120, list.clientHeight - 60), last = 0, stable = 0;
  for (var k = 0; k < 40 && list.scrollTop + list.clientHeight < list.scrollHeight - 2; k++) {
    last = list.scrollTop; list.scrollTop = list.scrollTop + step;
    await new Promise(function (r) { setTimeout(r, 160); });
    if (list.scrollTop === last) { stable++; if (stable > 2) break; } else stable = 0;
  }
  var imgs = [].slice.call(list.querySelectorAll('img'));
  var n0 = imgs.filter(function (i) { return !!i.getAttribute('src'); }).length;
  await new Promise(function (r) { setTimeout(r, 2200); });
  var n1 = imgs.filter(function (i) { return !!i.getAttribute('src'); }).length;
  var bottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
  var lr = list.getBoundingClientRect();
  var vis = 0, visSrc = 0;
  imgs.forEach(function (i) {
    var r = i.getBoundingClientRect();
    if (r.bottom <= lr.top || r.top >= lr.bottom || !r.width) return;
    vis++; if (i.getAttribute('src')) visSrc++;
  });
  return { firstScreen: ${lazy.withSrc || 0}, visible: vis, visibleSrc: visSrc, atBottom: bottom, n0: n0, n1: n1 };
})()`);
check('B3b 滚到底后屏上的图照样补上 src（懒加载不漏后半屏）',
  !!scrolled && scrolled.atBottom && scrolled.visible >= 4 && scrolled.visibleSrc === scrolled.visible,
  scrolled && JSON.stringify(scrolled));

// B4 关掉再开：节点复用 + 同步耗时（红＝0 复用、重开同步 66~292ms）
const reopen = await evalJs(`(async function () {
  var card = document.getElementById('feed-sticker-card');
  card.hidden = true;
  await new Promise(function (r) { setTimeout(r, 60); });
  var b = document.querySelector('#feed-list .feed-act[data-sticker]');
  var t0 = performance.now(); b.click(); var t1 = performance.now();
  var imgs = [].slice.call(document.querySelectorAll('#feed-sticker-list img'));
  return { ms: Math.round(t1 - t0), kept: imgs.filter(function (i) { return i.__probe === 1; }).length, total: imgs.length };
})()`);
check('B4 重开同内容＝节点全复用且同步耗时不超阈值（红基线 0/150 复用）',
  !!reopen && reopen.kept === reopen.total && reopen.total >= 100 && reopen.ms <= 40, reopen && JSON.stringify(reopen));

// B5 切分组（红基线 50 张 109ms）
const chip = await evalJs(`(async function () {
  var cs = document.querySelectorAll('#feed-sticker-groups .emoji-g-chip');
  if (cs.length < 2) return null;
  var t0 = performance.now(); cs[1].click(); var t1 = performance.now();
  await new Promise(function (r) { setTimeout(r, 80); });
  return { ms: Math.round(t1 - t0), imgs: document.querySelectorAll('#feed-sticker-list img').length };
})()`);
check('B5 点分组胶囊只重建该组且同步耗时不超阈值', !!chip && chip.imgs > 0 && chip.imgs < 150 && chip.ms <= 60, chip && JSON.stringify(chip));

// B6 委托点击仍能进「点照片选位置」模式（防「监听挂在未入树的 grid 上」＝点不动）
const pick = await evalJs(`(async function () {
  var ds = [].slice.call(document.querySelectorAll('#feed-sticker-list .emoji-item'));
  var d = null;
  for (var i = 0; i < ds.length; i++) { if (ds[i].querySelector('img')) { d = ds[i]; break; } }
  if (!d) return null;
  d.click();
  await new Promise(function (r) { setTimeout(r, 120); });
  var box = document.querySelector('.feed-sticker-picking');
  return { picking: !!box, hint: !!document.querySelector('.feed-pick-hint'), n: ds.length };
})()`);
check('B6 点格子进入选位模式（一条委托代替上百个监听器，功能不减）', !!pick && pick.picking && pick.hint, pick && JSON.stringify(pick));
await evalJs(`(function(){ var e=document.querySelector('.feed-pick-hint'); if (e) e.click(); return 1; })()`);

// B8 令牌批量预热通道被调用（红基线＝本面板从不走聊天侧 warm）
const warm = await snap();
check('B8 渲染时把本视图图源交给聊天侧批量预热通道（红基线 0 次）', !!warm && warm.warmN >= 2, warm && 'warmN=' + warm.warmN);

const errN = await evalJs(`(window.__jsErrors || []).length`);
const firstErr = await evalJs(`(window.__jsErrors || []).slice(0,2).join(' | ')`);
check('Z 全程零未捕获 JS 异常', !errN, '错误 ' + errN + (firstErr ? '：' + firstErr : ''));

const pass = results.every((r) => r.ok);
console.log('\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + results.filter((r) => r.ok).length + '/' + results.length);
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);

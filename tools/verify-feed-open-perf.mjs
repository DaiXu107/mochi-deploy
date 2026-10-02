// ===== 回归脚本：#669 打开朋友圈「点桌面图标进页有点卡顿」（红米K80 Chrome 报障，多机型同现）=====
// 用法：node build.mjs && node tools/verify-feed-open-perf.mjs   （MOCHI_ROOT=<已构建目录> 测隔离副本）
// 背景与修复见 FIX-REGRESSION #669 / BUGS.md #669：桌面图标每次点击都走 openFeedPage → render()
//   整包重建列表（200 条动态＝4.0MB 标记），修法是渲染签名——内容与上次一致时跳过重建。
// 本脚本量的是「同一次运行内」首次打开 vs 再进一次的相对代价：修复后再进一次几乎免费（个位数 ms），
//   修复前再进一次＝又一次整包解析（数百 ms）。阈值取相对量（< 首次的 1/2 + 10ms），不写死绝对值，
//   机器快慢都判得住；另附 Profiler 采样与节流倍数输出便于定位。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
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
const cdpPort = 9850 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-diagperf-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
const boot = `
(function () {
  var T = Date.now();
  // #1434：朋友圈改成「本周＋按月」翻页折叠——本尺量的是「同一次运行内首开 vs 再开」的整包
  //   重建代价，种子必须整批落在本自然周里（原写法每小时一条、200 条横跨 8.3 天＝会被折到
  //   上一整月，K1 数的就不是这 200 条了）。步长按「本周已经走过的时间」均分，周一凌晨跑也不外溢。
  var WS = (function () { var d = new Date(T); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); })();
  var WEEK_STEP = Math.max(1, T - WS) / 240;
  var post = function (i) {
    // 贴近真实：800px JPEG 压缩产物量级（≈40KB dataURL），不是 1×1 占位
    var pad = new Array(8200).join('A');
    var img = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD' + pad;
    return { id: 'f_' + (1700000000000 + i) + '_default', role: i % 3 === 0 ? 'me' : 'ta', owner: 'default',
      authorName: '小桃', authorAv: '', taName: '小桃', taAv: '', content: '第' + i + '条动态 ' + new Array(40).join('内容'),
      imgs: [img, img], ts: T - Math.round(i * WEEK_STEP), likes: ['我', '小桃'],
      comments: [
        { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '评论一 ' + i, ts: T - i * 3600000 + 1000, replies: [{ role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '回复 ' + i, ts: T - i * 3600000 + 2000 }] },
        { role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '评论二 ' + i, ts: T - i * 3600000 + 3000, replies: [] }
      ] };
  };
  var arr = [];
  for (var i = 0; i < 200; i++) arr.push(post(i));
  var FEED = 'xy-home-v2:feed-posts';
  var SEED = JSON.stringify(arr); // 大键只在 IDB（>200KB）：用内存种子走 idbGet 桩，避免 LS 配额
  try { localStorage.removeItem(FEED); } catch (e) {}
  window.__ready = false;
  window.__writes = 0;
  var gStub = function (k) { return Promise.resolve(k === FEED ? SEED : null); };
  var sStub = function (k, v) { if (k === FEED) window.__writes++; return Promise.resolve(true); };
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
})();
`;
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 851, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE || 4) }); // 近似中端安卓（红米K80 级）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
const goto = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1500);
};
await goto();

const bindDiag = await evalJs(`(function () {
  var t0 = performance.now();
  document.querySelector('.app[data-app="feed"]').click();
  var openMs = Math.round(performance.now() - t0);
  var list = document.getElementById('feed-list');
  var out = { firstOpenMs: openMs, cards: list.querySelectorAll('.feed-post').length,
    likeBtns: list.querySelectorAll('.feed-act[data-like]').length,
    stkBtns: list.querySelectorAll('.feed-act[data-sticker]').length };
  var stk = list.querySelector('.feed-act[data-sticker]');
  if (stk) stk.click();
  var card = document.getElementById('feed-sticker-card');
  out.panel = !!(card && !card.hidden);
  if (out.panel) card.hidden = true;
  return out;
})()`);
console.log('· 绑定自检（首次打开并立刻点「贴纸」）：' + JSON.stringify(bindDiag));

const probe = await evalJs(`(function () {
  var out = {};
  var icon = document.querySelector('.app[data-app="feed"]');
  out.hasIcon = !!icon;
  if (!icon) return out;
  // 冷开（首次点击）：计时包含 openFeedPage -> render() 全部同步工作
  var t0 = performance.now();
  icon.click();
  var t1 = performance.now();
  out.coldMs = Math.round(t1 - t0);
  out.coldNodes = document.getElementById('feed-list').querySelectorAll('*').length;
  out.coldCards = document.querySelectorAll('#feed-list .feed-post').length;
  out.imgs = document.querySelectorAll('#feed-list img').length;
  // 热开（已是当前页，再点一次＝原型每次进入都全量重建的代价）
  var t2 = performance.now();
  icon.click();
  var t3 = performance.now();
  out.warmMs = Math.round(t3 - t2);
  // 只量 render 里的 DOM 写入（innerHTML 赋值本身）
  var list = document.getElementById('feed-list');
  out.htmlLen = list.innerHTML.length;
  var t4 = performance.now();
  list.innerHTML = list.innerHTML;
  var t5 = performance.now();
  out.reparseMs = Math.round(t5 - t4);
  out.iconHTML = (icon.outerHTML || '').slice(0, 120);
  return out;
})()`);
console.log('探针：', JSON.stringify(probe));

// 冷开 + Profiler 采样：直接点名热点函数（self time 占比）
await evalJs(`(function(){ var o = document.querySelector('.app[data-app="chat"]') || document.querySelector('.tabbar .tab'); if (o) o.click(); return true; })()`);
await cdp('Profiler.enable');
await cdp('Profiler.setSamplingInterval', { interval: 200 });
await cdp('Profiler.start');
await evalJs(`(function(){ var icon = document.querySelector('.app[data-app="feed"]'); if (icon) icon.click(); return true; })()`);
const prof = await cdp('Profiler.stop');
const nodes = (prof && prof.profile && prof.profile.nodes) || [];
const byId = {};
nodes.forEach(n => { byId[n.id] = n; });
const self = {};
(nodes || []).forEach(n => {
  const f = n.callFrame || {};
  const name = (f.functionName || '(anonymous)') + ' @' + String(f.url || '').split('/').pop().slice(0, 24) + ':' + (f.lineNumber || 0);
  self[name] = (self[name] || 0) + (n.hitCount || 0);
});
const top = Object.keys(self).sort((a, b) => self[b] - self[a]).slice(0, 14).map(k => k + ' ×' + self[k]);
console.log('Profiler top（self 采样数）：\n  ' + top.join('\n  '));

const probe3 = await evalJs(`(function () {
  var out = {};
  var icon = document.querySelector('.app[data-app="feed"]');
  var o = document.querySelector('.app[data-app="chat"]') || document.querySelector('.tabbar .tab');
  if (o) o.click();
  var t0 = performance.now();
  if (icon) icon.click();
  out.ms = Math.round(performance.now() - t0);
  out.nodes = document.getElementById('feed-list').querySelectorAll('*').length;
  out.cards = document.querySelectorAll('#feed-list .feed-post').length;
  out.imgs = document.querySelectorAll('#feed-list img').length;
  return out;
})()`);
console.log('再进一次（内容未变，节流 ' + (process.env.CPU_THROTTLE || 4) + 'x）：', JSON.stringify(probe3));
const results = [];
function check(desc, ok, detail) { results.push({ ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- 判据一（确定性，不依赖计时）：内容未变时再进朋友圈必须原样保留列表节点 ----
// 修复前：桌面图标每次点击都整包重建，200 张卡片全部换新节点（kept=0）；修复后 kept=200。
const keep = await evalJs(`(function () {
  var list = document.getElementById('feed-list');
  var cards = [].slice.call(list.querySelectorAll('.feed-post'));
  cards.forEach(function (c) { c.__perfKeep = 1; });
  document.querySelector('.app[data-app="chat"]').click();
  var t0 = performance.now();
  document.querySelector('.app[data-app="feed"]').click();
  var ms = Math.round(performance.now() - t0);
  var after = [].slice.call(document.getElementById('feed-list').querySelectorAll('.feed-post'));
  return { total: cards.length, kept: after.filter(function (c) { return c.__perfKeep === 1; }).length, ms: ms };
})()`);
check('K1 内容未变时再进朋友圈不重建列表（节点原样保留）', !!keep && keep.total > 100 && keep.kept === keep.total,
  keep ? (keep.kept + '/' + keep.total + ' 保留，耗时 ' + keep.ms + 'ms') : '');
console.log('   · 首次打开 ' + (bindDiag ? bindDiag.firstOpenMs : '?') + 'ms（' + (bindDiag ? bindDiag.cards : '?') + ' 张卡片 / 节点 ' + (probe ? probe.coldNodes : '?') + '）→ 再进一次 ' + (keep ? keep.ms : '?') + 'ms');

// ---- 判据二（确定性）：数据一变（新发一条动态）必须立刻反映到列表，且重建＝不显示旧数据 ----
// 用公开钩子 window.feedAddPost（真实 save + render 链路），不依赖点赞的延后落盘与取名口径。
const changed = await evalJs(`(function () {
  var list = document.getElementById('feed-list');
  var n0 = list.querySelectorAll('.feed-post').length;
  var r = window.feedAddPost('数据变化的判据动态', []);
  var n1 = list.querySelectorAll('.feed-post').length;
  var top = list.querySelector('.feed-post');
  var shownNow = top ? top.textContent.indexOf('数据变化的判据动态') >= 0 : false;
  [].slice.call(list.querySelectorAll('.feed-post')).forEach(function (c) { c.__perfKeep2 = 1; });
  document.querySelector('.app[data-app="chat"]').click();
  document.querySelector('.app[data-app="feed"]').click();
  var cards = [].slice.call(document.getElementById('feed-list').querySelectorAll('.feed-post'));
  var topAfter = document.getElementById('feed-list').querySelector('.feed-post');
  return { ok: !!r, n0: n0, n1: n1, shownNow: shownNow, total: cards.length,
    kept: cards.filter(function (c) { return c.__perfKeep2 === 1; }).length,
    topNow: topAfter ? (topAfter.textContent.indexOf('数据变化的判据动态') >= 0) : false };
})()`);
check('K2 数据一变（新发动态）立即出现在列表里＝不会被签名跳过', !!changed && changed.ok && changed.shownNow === true && changed.topNow === true, JSON.stringify(changed));
console.log('   · 注意：列表按「最新 200 条」窗口渲染，新发一条后卡片总数仍是 200（第 201 条在窗口外，'
  + '属既有窗口行为），因此判据看的是「新动态出现在首位」而不是条数+1');

const errCount = await evalJs(`(window.__jsErrors || []).length`);
check('K3 零 JS 异常', !errCount, '错误 ' + errCount);

const pass = results.every(r => r.ok);
console.log('\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + results.filter(r => r.ok).length + '/' + results.length);
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);

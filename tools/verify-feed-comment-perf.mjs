// ===== 回归脚本：朋友圈发评论卡顿——单卡局部刷新替代全量重渲染（v3.10.x 修复） =====
// 用法：node build.mjs && node tools/verify-feed-comment-perf.mjs
// 背景（用户反馈）：朋友圈发布评论会卡顿。
// 根因：submitComment → renderVisible() 全量重渲染整个列表——所有卡片 HTML 字符串重建 +
//   全部 dataURL 配图 <img> 重新解码 + 全部事件重绑；重度图片数据（主键 MB 级）下发一条
//   评论就冻结数百 ms~秒级。且每次 save 还多付 1~2 次全量 JSON.stringify（persistSnap 探
//   大小一次、结尾再序列化一次）。TA 回应定时器同路径再付一遍。
// 修复：① 抽出单卡模板 postCardHtml/postCardHtmlAll + refreshPostCard(pid) 只替换该动态
//   卡片节点（其余卡片原地不动），「单条动态变化」调用点全部切换；卡片不在当前列表时
//   回退 renderVisible 全量兜底。② persistSnap 只做一次全量序列化（超限裁剪才重串）。
// 验证（受控 idbGet/idbSet 桩 + 150 条含伪图 dataURL 的历史动态 ≈9MB 主键走 IDB 大键路径；
//   发评论前给所有兄弟卡片打 JS 属性标记）：断言发评论/回复/点赞后兄弟节点标记原样保留
//   （DOM 未整列表重建）、评论/回复内容出现在目标卡片内、落盘写入包含新数据、TA 自动评论/
//   回复/回赞定时器到达后仍是局部刷新、剥图快照语义保持。
// 注：目标动态为「我」发布（TA 回赞只作用于我的动态）；回复对象用 TA 的评论
//   （应用不允许回复自己的评论）。
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
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9850 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-feedperf-' + Date.now()),
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}
async function gotoApp(reload) {
  if (reload) await cdp('Page.reload', { ignoreCache: false });
  else await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
async function until(expr, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await evalJs(expr)) return true; await sleep(150); }
  return false;
}

// ---- 种子（页面脚本执行前注入）：150 条含伪图 dataURL 的历史动态（≈9MB 主键，
//   必走「只进 IDB 不进 LS」大键路径）+ 目标动态 target_1（我发布，带 1 条预置评论）。
//   设置：评论/回复/回赞概率 100%、速度最快；关掉 TA 自动发帖/点赞防列表结构漂移。----
const boot = `
(function () {
  var T = Date.now();
  var pad = new Array(700).join('x');
  var imgPad = new Array(30000).join('Qw');
  var posts = [];
  for (var i = 0; i < 150; i++) {
    posts.push({ id: 'hist_' + i, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '',
      content: '历史动态' + i + ' ' + pad, imgs: ['data:image/jpeg;base64,' + imgPad],
      ts: T - 200000 - (150 - i) * 1000, likes: [], comments: [] });
  }
  posts.push({ id: 'target_1', role: 'me', owner: 'default', authorName: '我', authorAv: '', taName: '小桃', taAv: '',
    content: '我的动态：今晚吃火锅', imgs: [], ts: T - 5000, likes: [],
    comments: [{ role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '预置评论：好呀好呀', ts: T - 4000, replies: [] }] });
  var idbSeed = {};
  idbSeed['xy-home-v2:feed-posts'] = JSON.stringify(posts);
  window.__perfCaptured = {};
  var gStub = function (k) { return Promise.resolve(idbSeed[k] !== undefined ? idbSeed[k] : null); };
  var sStub = function (k, v) { window.__perfCaptured[k] = v; return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbDelete', { configurable: false, get: function () { return dStub; }, set: function () {} });
  try { localStorage.removeItem('xy-home-v2:feed-posts'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:default:feed-posts-snap'); } catch (e) {}
  var S = 'xy-home-v2:default:';
  // TA 昵称种子——定时器生成的评论/回复/回赞作者名经 taFeedNameFor 实时取，
  // 空档案回退 'TA'，与种子里手写的 authorName 对不上，这里统一成「小桃」
  localStorage.setItem(S + 'lbl-partner', '小桃');
  localStorage.setItem(S + 'feed-ta-name', '小桃');
  localStorage.setItem(S + 'lbl-user', '我');
  localStorage.setItem(S + 'reply-fd-comment-prob', '100');
  localStorage.setItem(S + 'reply-fd-comment-speed-min', '0.05');
  localStorage.setItem(S + 'reply-fd-comment-speed-max', '0.3');
  localStorage.setItem(S + 'reply-fd-reply-prob', '100');
  localStorage.setItem(S + 'reply-fd-reply-speed-min', '0.05');
  localStorage.setItem(S + 'reply-fd-reply-speed-max', '0.3');
  localStorage.setItem(S + 'reply-fd-likeback-prob', '100');
  localStorage.setItem(S + 'reply-fd-like-speed-min', '0.05');
  localStorage.setItem(S + 'reply-fd-like-speed-max', '0.3');
  localStorage.setItem(S + 'reply-fd-like-prob', '0');
  localStorage.setItem(S + 'reply-fd-post-prob', '0');
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- boot1 空跑初始化 → 注入种子重载 ----
await gotoApp();
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await gotoApp(true);

// ---- 进入朋友圈页并给所有卡片打身份标记 ----
await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
await sleep(900);
const cardCount = await evalJs(`document.querySelectorAll('#feed-list .feed-post').length`);
check('S1 列表渲染出 151 张卡片（150 历史 + 目标）', cardCount === 151, '实际 ' + cardCount);
await evalJs(`(function(){
  var list = document.getElementById('feed-list');
  list.__perfTagList = 'LIST-IDENTITY';
  window.__tagsBefore = [];
  list.querySelectorAll('.feed-post').forEach(function (el) {
    if (el.id !== 'feed-post-target_1') { el.__perfTag = 'keep-' + el.id; window.__tagsBefore.push('keep-' + el.id); }
  });
  return window.__tagsBefore.length;
})()`);

// ---- A. 发布文字评论：只有目标卡片被替换，兄弟卡片身份不变 ----
await evalJs(`(function(){ var b = document.querySelector('#feed-list .feed-act[data-comment="target_1"]'); if (b) b.click(); return !!b; })()`);
await sleep(250);
const barShown = await evalJs(`(function(){ var bar = document.getElementById('feed-comment-bar'); return !!bar && !bar.hidden; })()`);
check('A0 点评论按钮后评论条显示', barShown === true);
await evalJs(`(function(){ var i = document.getElementById('feed-comment-input'); i.value = 'PERF-COMMENT-MARKER-今晚我也想吃'; return true; })()`);
const t0 = Date.now();
await evalJs(`(function(){ var b = document.getElementById('feed-comment-send'); b.click(); return true; })()`);
await sleep(600);
const ms = Date.now() - t0;
const barHidden = await evalJs(`(function(){ var bar = document.getElementById('feed-comment-bar'); return !!bar && bar.hidden; })()`);
check('A1 发送后评论条收起', barHidden === true);
const cardState = await evalJs(`(function(){
  var card = document.getElementById('feed-post-target_1');
  if (!card) return null;
  var cs = card.querySelectorAll('.feed-comment');
  var txt = card.textContent;
  return { comments: cs.length, hasMarker: txt.indexOf('PERF-COMMENT-MARKER') >= 0, hasPreset: txt.indexOf('预置评论') >= 0 };
})()`);
check('A2 目标卡片出现新评论（≥2 条且含标记与预置）', cardState && cardState.comments >= 2 && cardState.hasMarker && cardState.hasPreset, cardState ? JSON.stringify(cardState) : '卡片丢失');
const identity = await evalJs(`(function(){
  var list = document.getElementById('feed-list');
  var nowTags = [];
  list.querySelectorAll('.feed-post').forEach(function (el) { if (el.__perfTag) nowTags.push(el.__perfTag); });
  return { listSame: list.__perfTagList === 'LIST-IDENTITY', tags: nowTags.length, allKept: window.__tagsBefore.every(function (t) { return nowTags.indexOf(t) >= 0; }), total: list.querySelectorAll('.feed-post').length };
})()`);
check('A3 兄弟卡片 DOM 身份原样保留（未整列表重绘）', identity && identity.listSame && identity.allKept && identity.tags === 150, identity ? JSON.stringify(identity) : '');
check('A4 卡片总数不变（无重复插入）', identity && identity.total === 151, identity ? String(identity.total) : '');
console.log('      （信息）发送到断言耗时约 ' + ms + 'ms（含 600ms 固定等待，仅参考）');
const saved = await evalJs(`(function(){
  try {
    var raw = window.__perfCaptured['xy-home-v2:feed-posts'] || '';
    var arr = JSON.parse(raw);
    var p = arr.filter(function (x) { return x.id === 'target_1'; })[0];
    return { n: p ? p.comments.length : -1, hasMarker: p ? p.comments.some(function (c) { return c.content.indexOf('PERF-COMMENT-MARKER') === 0; }) : false, size: raw.length };
  } catch (e) { return { n: -2 }; }
})()`);
check('A5 落盘写入包含新评论（主键仍为完整大对象路径）', saved && saved.n >= 2 && saved.hasMarker === true, saved ? (saved.n + '条/' + Math.round(saved.size / 1024) + 'KB') : JSON.stringify(saved));

// ---- B. 等 TA 自动评论定时器到达（概率 100%），拿到其下标作为回复目标 ----
// 注：until 的条件必须是布尔——返回下标 -1（未到达）也是真值，会首轮误判成功
const taCiReady = await until(`(function(){
  try {
    var arr = JSON.parse(window.__perfCaptured['xy-home-v2:feed-posts'] || '[]');
    var p = arr.filter(function (x) { return x.id === 'target_1'; })[0];
    if (!p) return false;
    for (var i = 0; i < p.comments.length; i++) { if (p.comments[i].role === 'ta') return true; }
    return false;
  } catch (e) { return false; }
})()`, 4000);
const taCiIdx = await evalJs(`(function(){
  try {
    var arr = JSON.parse(window.__perfCaptured['xy-home-v2:feed-posts'] || '[]');
    var p = arr.filter(function (x) { return x.id === 'target_1'; })[0];
    for (var i = 0; i < p.comments.length; i++) { if (p.comments[i].role === 'ta') return i; }
    return -1;
  } catch (e) { return -1; }
})()`);
check('B0 TA 自动评论已落盘（comment 定时器）', taCiReady && taCiIdx >= 0, 'ci=' + taCiIdx);

// ---- C. 回复模式：点 TA 的评论进入回复，发送后写入该评论的回复区，兄弟卡片不动 ----
await evalJs(`(function(){ var c = document.querySelector('#feed-post-target_1 .feed-comment[data-ci="' + ${taCiIdx} + '"]'); if (c) c.click(); return !!c; })()`);
await sleep(250);
const ph = await evalJs(`(function(){ var i = document.getElementById('feed-comment-input'); return i && !document.getElementById('feed-comment-bar').hidden ? i.placeholder : ''; })()`);
check('C0 回复模式占位符以「回复」开头', ph.indexOf('回复') === 0, ph);
await evalJs(`(function(){ var i = document.getElementById('feed-comment-input'); i.value = 'PERF-REPLY-MARKER-那必须的'; return true; })()`);
await evalJs(`(function(){ document.getElementById('feed-comment-send').click(); return true; })()`);
await sleep(600);
const replyState = await evalJs(`(function(){
  var card = document.getElementById('feed-post-target_1');
  if (!card) return null;
  var rep = card.querySelectorAll('.feed-reply');
  var txt = card.textContent;
  return { replies: rep.length, hasMarker: txt.indexOf('PERF-REPLY-MARKER') >= 0 };
})()`);
check('C1 我的回复写入评论区回复块', replyState && replyState.replies >= 1 && replyState.hasMarker, replyState ? JSON.stringify(replyState) : '');

// ---- D. TA 定时回应（回复我的回复）：到达后同样局部刷新 ----
const taReplied = await until(`(function(){
  try {
    var arr = JSON.parse(window.__perfCaptured['xy-home-v2:feed-posts'] || '[]');
    var p = arr.filter(function (x) { return x.id === 'target_1'; })[0];
    if (!p || !p.comments[${taCiIdx}] || !p.comments[${taCiIdx}].replies) return false;
    return p.comments[${taCiIdx}].replies.some(function (r) { return r.role === 'ta'; });
  } catch (e) { return false; }
})()`, 4000);
check('D1 TA 自动回复我的回复已落盘（reply 定时器）', taReplied === true);
const domTaReply = await until(`(function(){
  var card = document.getElementById('feed-post-target_1');
  if (!card) return false;
  var reps = card.querySelectorAll('.feed-reply');
  var taN = 0;
  reps.forEach(function (r) { var bs = r.querySelectorAll('b'); if (bs[0] && bs[0].textContent === '小桃') taN++; });
  return taN >= 1;
})()`, 3000);
check('D2 页面卡片渲染出 TA 的回复块', domTaReply === true);
const midIdentity = await evalJs(`(function(){
  var list = document.getElementById('feed-list');
  var nowTags = [];
  list.querySelectorAll('.feed-post').forEach(function (el) { if (el.__perfTag) nowTags.push(el.__perfTag); });
  return { kept: nowTags.length, allKept: window.__tagsBefore.every(function (t) { return nowTags.indexOf(t) >= 0; }) };
})()`);
check('D3 定时器刷新后兄弟卡片身份仍保留（定时器路径也是局部刷新）', midIdentity && midIdentity.kept === 150 && midIdentity.allKept, midIdentity ? JSON.stringify(midIdentity) : '');

// ---- E. 点赞：按钮状态切换 + TA 回赞定时器（回赞只作用于我的动态），均局部刷新 ----
await evalJs(`(function(){ var b = document.querySelector('#feed-post-target_1 .feed-act[data-like="target_1"]'); if (b) b.click(); return !!b; })()`);
await sleep(400);
const likeState = await evalJs(`(function(){
  var card = document.getElementById('feed-post-target_1');
  if (!card) return null;
  var btn = card.querySelector('.feed-act[data-like="target_1"]');
  return { liked: !!(btn && btn.className.indexOf('liked') >= 0), hasLikesRow: !!card.querySelector('.feed-likes'), likesText: card.querySelector('.feed-likes') ? card.querySelector('.feed-likes').textContent.trim() : '' };
})()`);
check('E1 点赞后按钮高亮 + 出现点赞行', likeState && likeState.liked && likeState.hasLikesRow, likeState ? JSON.stringify(likeState) : '');
const taLiked = await until(`(function(){
  try {
    var arr = JSON.parse(window.__perfCaptured['xy-home-v2:feed-posts'] || '[]');
    var p = arr.filter(function (x) { return x.id === 'target_1'; })[0];
    return !!p && (p.likes || []).indexOf('小桃') >= 0;
  } catch (e) { return false; }
})()`, 4000);
check('E2 TA 回赞已落盘（likeback 定时器）', taLiked === true);
const domTaLike = await until(`(function(){
  var card = document.getElementById('feed-post-target_1');
  var row = card && card.querySelector('.feed-likes');
  return !!row && row.textContent.indexOf('小桃') >= 0;
})()`, 3000);
check('E3 页面点赞行渲染出 TA 回赞', domTaLike === true);
const finalIdentity = await evalJs(`(function(){
  var list = document.getElementById('feed-list');
  var nowTags = [];
  list.querySelectorAll('.feed-post').forEach(function (el) { if (el.__perfTag) nowTags.push(el.__perfTag); });
  return { kept: nowTags.length, allKept: window.__tagsBefore.every(function (t) { return nowTags.indexOf(t) >= 0; }) };
})()`);
check('E4 全流程结束后兄弟卡片身份依然保留', finalIdentity && finalIdentity.kept === 150 && finalIdentity.allKept, finalIdentity ? JSON.stringify(finalIdentity) : '');

// ---- F. 剥图快照：save 路径仍正常更新（persistSnap 单次序列化重构不破坏语义） ----
const snapOk = await evalJs(`(function(){
  var snap = localStorage.getItem('xy-home-v2:default:feed-posts-snap') || '';
  if (!snap.length || snap.length > 200 * 1024) return { ok: false, len: snap.length };
  try {
    var a = JSON.parse(snap);
    return { ok: Array.isArray(a) && a.length >= 100 && snap.indexOf('data:image') < 0, len: snap.length, n: a.length };
  } catch (e) { return { ok: false }; }
})()`);
check('F1 剥图快照 ≤200KB、已剥图、条数有效', snapOk && snapOk.ok, snapOk ? JSON.stringify(snapOk) : '');

const pass = results.every(r => r.ok);
console.log('\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + results.filter(r => r.ok).length + '/' + results.length);
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);

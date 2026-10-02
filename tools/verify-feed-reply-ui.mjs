// ===== 专项脚本：朋友圈评论区「A 回复 B」目标修复 + 楼中楼 UI 对称重设计（v3.14.x） =====
// 用法：node build.mjs && node tools/verify-feed-reply-ui.mjs
// 背景（用户反馈）：
//   ① 联系人回应我的回复显示成【联系人昵称 回复 联系人昵称】——旧版渲染把被回复人写死为
//      原评论作者；修复=每条新回复写入 to 快照 + 渲染端按发言轮次推断（存量数据兼容）。
//   ② 评论区排序 UI 不对称——chat-pages.css 里 .feed-comments/.feed-reply 被定义两次，
//      后段规则覆盖前面：灰底圆角面板里多出一道 border-top 横线、回复区双重缩进
//      （容器 22px + 行内 12px）；重设计=统一面板、左引导线楼中楼、「回复」徽章分隔。
// 验证（无头 Chrome，种子=旧格式无 to 的往返回复）：
//   A 存量推断：小桃评论下的我的回复+小桃再回应 → 「我 回复 小桃」「小桃 回复 我」（回归点：
//     不再出现「小桃 回复 小桃」）；「回复」徽章元素存在；
//   B 定向回复：点小桃的回复行 → 占位符「回复 小桃…」→ 发送 → 存储写入 to='小桃'，
//     DOM 出现「我 回复 小桃」；
//   C TA 回应：fd-reply-prob=100 强制必回 → 新回复 to='我'，DOM 再现「小桃 回复 我」；
//   D UI 对称：.feed-comments 有灰底无 border-top；.feed-replies 左引导线 2px；
//     我的回复行与 TA 回复行屏幕左缘完全对齐（对称）。

const root = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const { spawn } = await import('node:child_process');
const { createServer } = await import('node:http');
const { readFileSync, statSync } = await import('node:fs');
const { join, normalize, dirname, extname } = await import('node:path');
const { fileURLToPath } = await import('node:url');

const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-feedreply-' + Date.now()),
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

// ---- 种子（页面脚本执行前注入）：TA 动态 + 两条评论，楼中楼为旧格式（无 to 字段）----
const boot = `
(function () {
  var T = Date.now();
  var P_ID = 'f_1700000000001_default';
  var c1 = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '周末去看海吗', ts: T - 5000, replies: [
    { role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '去呀去呀', ts: T - 4000 },
    { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '那说定了，别忘了防晒', ts: T - 3000 }
  ] };
  var c2 = { role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '我也想凑热闹', ts: T - 2000, replies: [
    { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '带上我！', ts: T - 1500 }
  ] };
  var post = { id: P_ID, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '', content: '海边的风', imgs: [], ts: T - 8000, likes: [], comments: [c1, c2] };
  var idbSeed = {};
  idbSeed['xy-home-v2:feed-posts'] = JSON.stringify([post]);
  window.__frCaptured = {};
  var gStub = function (k) { return Promise.resolve(idbSeed[k] !== undefined ? idbSeed[k] : null); };
  var sStub = function (k, v) { window.__frCaptured[k] = v; return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbDelete', { configurable: false, get: function () { return dStub; }, set: function () {} });
  try { localStorage.removeItem('xy-home-v2:feed-posts'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:default:feed-posts-snap'); } catch (e) {}
  localStorage.setItem('xy-home-v2:default:feed-posts-snap', JSON.stringify([post]));
  // TA 必回且回得快（两处键都种：兼容根键/default 命名空间两种读法）
  ['xy-home-v2:', 'xy-home-v2:default:'].forEach(function (pre) {
    localStorage.setItem(pre + 'reply-fd-reply-prob', '100');
    localStorage.setItem(pre + 'reply-fd-reply-speed-min', '0.05');
    localStorage.setItem(pre + 'reply-fd-reply-speed-max', '0.3');
    localStorage.setItem(pre + 'reply-fd-comment-prob', '0');
    localStorage.setItem(pre + 'reply-fd-likeback-prob', '0');
  });
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await gotoApp();
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await gotoApp(true);

// ---- 打开朋友圈 ----
await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
await sleep(900);

// ---- A. 存量数据（无 to）按轮次推断渲染 ----
// 行文本形如「<名字>回复<目标>：<内容>」（徽章两侧留白是 CSS margin，textContent 无空格）
const a1 = await evalJs(`(function(){
  function rowsOf(scope) {
    return Array.from(scope.querySelectorAll('.feed-reply')).map(function(r){
      var t = r.textContent.replace(/\\s+/g, '');
      var i = t.indexOf('回复'), j = t.indexOf('：');
      if (i < 0 || j < i) return { raw: t };
      return { name: t.slice(0, i), target: t.slice(i + 2, j), body: t.slice(j + 1), raw: t };
    });
  }
  var th = document.querySelector('#feed-list .feed-comment');
  if (!th) return { ok:false, why:'no-thread' };
  var rows = rowsOf(th);
  return {
    n: rows.length,
    texts: rows.map(function(r){ return r.raw; }),
    badSelfReply: rows.some(function(r){ return r.name && r.name === r.target; }),
    taRespondsMe: rows.length > 1 && rows[1].name !== '我' && rows[1].target === '我',
    meReplyTa: rows.some(function(r){ return r.name === '我' && r.target === '小桃'; })
  };
})()`);
check('A1 楼中楼渲染出 2 条存量回复', a1 && a1.n === 2, a1 ? JSON.stringify(a1.texts) : '无线程');
check('A2 推断正确：TA 的回应指向「我」且无任何「X 回复 X」自指行', !!a1 && !a1.badSelfReply && a1.taRespondsMe);
const a3 = await evalJs(`!!document.querySelector('#feed-list .feed-reply .fd-r-sep')`);
check('A3 「回复」徽章元素存在（UI 重设计标记）', a3 === true);

// ---- D. UI 对称性（先于交互改动断言基线样式） ----
const d1 = await evalJs(`(function(){
  var panel = document.querySelector('#feed-list .feed-comments');
  var rep = document.querySelector('#feed-list .feed-replies');
  if (!panel || !rep) return null;
  var cs = getComputedStyle(panel), rs = getComputedStyle(rep);
  return { bg: cs.backgroundColor, borderTop: cs.borderTopWidth, guideLeft: rs.borderLeftWidth };
})()`);
check('D1 评论面板有灰底且不再有 border-top 横线', !!d1 && d1.bg !== 'rgba(0, 0, 0, 0)' && d1.borderTop === '0px', d1 ? JSON.stringify(d1) : '');
check('D2 楼中楼有 2px 左引导线', !!d1 && d1.guideLeft === '2px', d1 ? d1.guideLeft : '');
const d3 = await evalJs(`(function(){
  var rows = Array.from(document.querySelectorAll('#feed-list .feed-comment')[0].querySelectorAll('.feed-reply'));
  if (rows.length < 2) return null;
  var l0 = rows[0].getBoundingClientRect().left, l1 = rows[1].getBoundingClientRect().left;
  var p0 = getComputedStyle(rows[0]).paddingLeft, p1 = getComputedStyle(rows[1]).paddingLeft;
  return { leftSame: Math.abs(l0 - l1) < 0.5, padSame: p0 === p1, l0: l0, l1: l1 };
})()`);
check('D3 我的回复与 TA 的回复左缘完全对齐（对称缩进）', !!d3 && d3.leftSame && d3.padSame, d3 ? JSON.stringify(d3) : '');

// ---- B. 点小桃的回复行 → 定向回复该作者 → 发送 ----
const b1 = await evalJs(`(function(){
  var th = document.querySelector('#feed-list .feed-comment');
  var rows = th.querySelectorAll('.feed-reply');
  rows[1].click();
  return true;
})()`);
await sleep(500);
const ph = await evalJs(`(function(){ var i = document.getElementById('feed-comment-input'); return i && !document.getElementById('feed-comment-bar').hidden ? i.placeholder : ''; })()`);
check('B1 点小桃回复行 → 评论条打开且占位符「回复 小桃…」', ph === '回复 小桃…', String(ph));
await evalJs(`(function(){ var i = document.getElementById('feed-comment-input'); i.value = '好呀，我会带防晒霜'; return true; })()`);
await evalJs(`(function(){ document.getElementById('feed-comment-send').click(); return true; })()`);
await sleep(700);
const b2 = await evalJs(`(function(){
  var w = window.__frCaptured || {};
  var raw = w['xy-home-v2:feed-posts'] || localStorage.getItem('xy-home-v2:feed-posts') || '';
  try {
    var p = JSON.parse(raw)[0];
    var rs = p.comments[0].replies;
    var last = rs[rs.length - 1];
    return { n: rs.length, role: last.role, to: last.to || '' };
  } catch (e) { return { err: String(e) }; }
})()`);
check('B2 我的定向回复已入库：role=me 且 to=小桃', b2 && b2.role === 'me' && b2.to === '小桃', JSON.stringify(b2));
const b3 = await evalJs(`(function(){
  function rowsOf(scope) {
    return Array.from(scope.querySelectorAll('.feed-reply')).map(function(r){
      var t = r.textContent.replace(/\\s+/g, '');
      var i = t.indexOf('回复'), j = t.indexOf('：');
      if (i < 0 || j < i) return { raw: t };
      return { name: t.slice(0, i), target: t.slice(i + 2, j), body: t.slice(j + 1), raw: t };
    });
  }
  var th = document.querySelector('#feed-list .feed-comment');
  return rowsOf(th);
})()`);
check('B3 DOM 出现「我 回复 小桃」（含新发的定向回复）', Array.isArray(b3) && b3.filter(r => r.name === '我' && r.target === '小桃').length >= 2 && b3.some(r => (r.body || '').indexOf('防晒霜') >= 0), JSON.stringify(b3));

// ---- C. TA 必回：新回应的目标应为我 ----
await sleep(2600);
const c1r = await evalJs(`(function(){
  var w = window.__frCaptured || {};
  var raw = w['xy-home-v2:feed-posts'] || localStorage.getItem('xy-home-v2:feed-posts') || '';
  try {
    var p = JSON.parse(raw)[0];
    var rs = p.comments[0].replies;
    var last = rs[rs.length - 1];
    return { n: rs.length, role: last.role, to: last.to || '' };
  } catch (e) { return { err: String(e) }; }
})()`);
check('C1 TA 自动回应入库：role=ta 且 to=我（核心回归：不再指向原评论作者小桃）', c1r && c1r.role === 'ta' && c1r.to === '我', JSON.stringify(c1r));
const c2r = await evalJs(`(function(){
  function rowsOf(scope) {
    return Array.from(scope.querySelectorAll('.feed-reply')).map(function(r){
      var t = r.textContent.replace(/\\s+/g, '');
      var i = t.indexOf('回复'), j = t.indexOf('：');
      if (i < 0 || j < i) return { raw: t };
      return { name: t.slice(0, i), target: t.slice(i + 2, j), body: t.slice(j + 1), raw: t };
    });
  }
  var th = document.querySelector('#feed-list .feed-comment');
  return rowsOf(th);
})()`);
check('C2 DOM 共 4 行、无任何「X 回复 X」自指行且 TA 回应指向我', Array.isArray(c2r) && c2r.length === 4 && !c2r.some(r => r.name && r.name === r.target) && c2r[3].target === '我', JSON.stringify(c2r));

// ---- E. 双写入口静态接线（防未来回归） ----
const e1 = await evalJs(`fetch('/src/js/feed.js').then(r=>r.text()).then(function(s){
  return {
    mineWrite: s.indexOf("stampAuthor({ content: content, ts: Date.now(), to:") >= 0,
    taWrite: s.indexOf("stampAuthor({ content: replyText, ts: Date.now(), to:") >= 0,
    infer: s.indexOf('speakers[i] !== rNameRaw') >= 0
  };
})`);
check('E1 源码双写入口均带 to 快照 + 渲染端轮次推断在位', !!e1 && e1.mineWrite && e1.taWrite && e1.infer, JSON.stringify(e1));

const pass = results.every(r => r.ok);
console.log('\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + results.filter(r => r.ok).length + '/' + results.length);
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);

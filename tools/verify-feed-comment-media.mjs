// ===== 回归脚本：#667 朋友圈评论区 TA 的表情包/图片退化成「[图片]」文字 =====
// 用法：node build.mjs && node tools/verify-feed-comment-media.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-feed-comment-media.mjs   （测临时构建副本，红绿对照）
// 背景（用户报障，华为 P50E Edge，明说「其他设备型号也有出现」）：朋友圈评论区联系人的评论
//   不显示表情包/图片，只显示「[图片]」两个字；聊天里同一批字卡图正常。
// 根因（三条，全在同一份「剥图快照」链上，零机型分支）：
//   ① stripPostImg 把媒体池令牌 @@m:hash 也换成「[图片]」文字——令牌只有 44 字符，保留它
//      就能从池里解回真图；旧实现连令牌一起剥掉，快照成为唯一可读副本时（大键只在 IDB、
//      Edge 杀后台/IDB 挂起、LS 被清）评论区就只剩「[图片]」文字；
//   ② deeperList/deepMergePost 的「择优保留含图那一版」只认整串令牌与 data:image——混排评论
//      「好可爱 @@m:hash」被判成无图版，剥图版（[图片] 文字）反而被留下（纯图评论那条路
//      v3.26.x 已修，混排是漏网口；字卡库经 #554 令牌化后混排已是常态）；
//   ③ feedMergeFromIdb 的降级兜底无条件写 feedMem = 剥图版，load() 从此被它遮蔽，用户点赞/
//      评论触发的写回把剥图版当「最新整包」写进权威键——#188 写守卫查的是持久层，看不见
//      写入源已被 feedMem 掉包，图就此永久变文字。
// 断言面：A 权威可读时的混排渲染与写回不被降级 / B 快照保留令牌且仍剥大图 / C 权威读不到
//   时令牌评论照常出图 / D 权威恢复可读后写回不得用剥图版盖掉完整版 / E 全程零 JS 异常。
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fdmedia-' + Date.now()),
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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
async function gotoApp(mode) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html?m=' + mode });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- 种子（在页面脚本执行前注入）----
// 令牌 T1~T4（池里有真图）；BIG1/BIG2 为「大体积 dataURL」（快照该剥的那类）。
// 动态 P 的评论：c1 纯令牌 / c2 文字+令牌（带一条文字+令牌的回复） / c3 纯大图 / c4 文字+大图。
// 快照（陈旧版，= 修复前 stripPostImg 的产物）：令牌与 dataURL 全变「[图片]」文字。
const boot = `
(function () {
  var mode = /[?&]m=deg/.test(location.search) ? 'deg' : 'full';
  var T = Date.now();
  var FEED = 'xy-home-v2:feed-posts';
  var SNAP = 'xy-home-v2:default:feed-posts-snap';
  var TOK = ['a1b2c3d4e5f60718293a4b5c6d7e8f01', 'a1b2c3d4e5f60718293a4b5c6d7e8f02', 'a1b2c3d4e5f60718293a4b5c6d7e8f03', 'a1b2c3d4e5f60718293a4b5c6d7e8f04'];
  var SMALL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  var pad = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  var BIG1 = 'data:image/png;base64,' + new Array(16).join(pad);
  var BIG2 = 'data:image/png;base64,' + new Array(15).join(pad) + 'AAAA';
  var c1 = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '@@m:' + TOK[0], ts: T - 5000, replies: [] };
  var c2 = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '好可爱呀 @@m:' + TOK[1], ts: T - 4000, replies: [
    { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '哈哈哈@@m:' + TOK[2], ts: T - 3000, to: '我' }
  ] };
  var c3 = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: BIG1, ts: T - 2000, replies: [] };
  var c4 = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '看这个 ' + BIG2, ts: T - 1000, replies: [] };
  var base = { id: 'f_1700000000000_default', role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '', content: '今天的天空很好看', imgs: [], ts: T - 90000, likes: [] };
  var full = JSON.parse(JSON.stringify(base)); full.comments = [c1, c2, c3, c4];
  // 陈旧快照：剥图版（修复前实现产物——令牌/dataURL 统统变 [图片] 文字）
  var staleComment = function (c) {
    var o = JSON.parse(JSON.stringify(c));
    o.content = String(o.content).replace(/data:image\\/[^\\s"'<>]+/g, '[图片]').replace(/@@m:[0-9a-f]{32}/g, '[图片]');
    if (o.replies) o.replies = o.replies.map(function (r) { r.content = String(r.content).replace(/data:image\\/[^\\s"'<>]+/g, '[图片]').replace(/@@m:[0-9a-f]{32}/g, '[图片]'); return r; });
    return o;
  };
  var stale = JSON.parse(JSON.stringify(base)); stale.imgs = []; stale.comments = [c1, c2, c3, c4].map(staleComment);
  // 大列表（总长 >200KB，与用户机型一致）：权威主键因此只进 IDB、不进 localStorage，
  // 写日志（≤64KB 才入账）也接不住它——「权威键读不到」时的降级链路才真实可复现。
  // 这些历史动态都比 P 旧，快照按新→旧裁剪时 P（最新）必然保留。
  var bulk = [];
  for (var i = 0; i < 300; i++) {
    bulk.push({ id: 'bulk_' + i, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '',
      content: '历史动态' + i + ' ' + new Array(700).join('x'), imgs: [], ts: T - 200000 - (300 - i) * 1000, likes: [], comments: [] });
  }
  // 池：令牌 → 真图（渲染端 media-pool 观察器按 idbGet 取回）
  var seed = {};
  seed[FEED] = JSON.stringify(bulk.concat([full]));
  seed['xy-home-v2:media:' + TOK[0]] = SMALL;
  seed['xy-home-v2:media:' + TOK[1]] = SMALL;
  seed['xy-home-v2:media:' + TOK[2]] = SMALL;
  window.__bulkJson = JSON.stringify(bulk);
  window.__mkFeed = function () { return seed[FEED]; };
  window.__w = { list: [], last: {} };
  var gStub = function (k) {
    if (k === FEED && mode === 'deg') return Promise.resolve(undefined); // 权威键读不到（IDB 挂起/超时）
    return Promise.resolve(seed[k] !== undefined ? seed[k] : null);
  };
  var sStub = function (k, v) {
    var st = ''; try { st = String((new Error()).stack || ''); } catch (e) {}
    window.__w.list.push({ k: k, v: v, stack: st.split('\\n').slice(1, 4).join(' <- ') });
    window.__w.last[k] = v; return Promise.resolve(true);
  };
  var hStub = function (k) { return Promise.resolve(k === FEED ? true : null); }; // 权威键确实存在（探测三态：true）
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbHasKey', { configurable: false, get: function () { return hStub; }, set: function () {} });
  try { localStorage.removeItem(FEED); } catch (e) {}
  // 快照写入来源取证：记录每次写 SNAP 的调用栈（定位「快照里的 [图片] 是谁写进去的」）
  try {
    var _si = localStorage.setItem.bind(localStorage);
    window.__ls = [];
    localStorage.setItem = function (k, v) {
      if (String(k).indexOf('feed-posts') >= 0) {
        var st = ''; try { st = String((new Error()).stack || '').split('\\n').slice(1, 5).join(' <- ').replace(/https?:\\/\\/[^\\s]*?index\\.html[^\\s:]*/g, 'index.html'); } catch (e2) {}
        window.__ls.push({ k: String(k), n: (String(v) || '').length, stack: st });
      }
      return _si(k, v);
    };
  } catch (e) {}
  if (mode === 'full') {
    // 首次进入：铺陈旧剥图快照（模拟用户机上的历史快照）
    if (!localStorage.getItem(SNAP)) localStorage.setItem(SNAP, JSON.stringify([stale]));
  }
  localStorage.setItem('xy-home-v2:default:active-contact', 'default');
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });

const FEED = 'xy-home-v2:feed-posts';
const SNAP = 'xy-home-v2:default:feed-posts-snap';
const openFeed = async () => {
  await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
  await sleep(900);
};
const commentImgs = () => evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-comments');
  if (!box) return null;
  var imgs = [].slice.call(box.querySelectorAll('img'));
  return { n: imgs.length, src: imgs.map(function(i){ return i.getAttribute('src') || ''; }), text: box.textContent || '' };
})()`);

// ================= A. 权威可读（正常设备）：混排评论照常出图，不被剥图快照降级 =================
await gotoApp('full');
await openFeed();
const poolProbe = await evalJs(`(function(){ return { pool: typeof window.mochiMediaTokenMissing, many: typeof window.idbGetMany, all: typeof window.idbSetAll, get: typeof window.idbGet, subtle: !!(window.crypto && crypto.subtle) }; })()`);
console.log('· 环境探针（媒体池）：' + JSON.stringify(poolProbe));
const a = await commentImgs();
check('A0 评论区渲染出 4 条评论', a && a.n >= 4, a ? ('img=' + a.n) : '无评论区');
check('A1 纯令牌评论出图', !!a && a.src.some(s => s.indexOf('data:image/png') === 0), a ? a.src.slice(0, 4).join('|').slice(0, 120) : '');
check('A2 文字+令牌混排出图（本案漏网口）', !!a && a.n >= 3, a ? ('img=' + a.n) : '');
check('A3 评论区无「[图片]」占位文字', !!a && a.text.indexOf('[图片]') < 0, a ? a.text.slice(0, 80) : '');
check('A4 4 张图 + 1 条回复图 = 5 张全部渲染', !!a && a.n === 5, a ? ('img=' + a.n) : '');
const aWrite = await evalJs(`(function(){ var v = (window.__w.last['${FEED}'] || ''); return { has: v.indexOf('a1b2c3d4e5f60718293a4b5c6d7e8f01') >= 0, hasBig: v.indexOf('iVBORw0KGgo') >= 0, hasPh: v.indexOf('[图片]') >= 0, len: v.length }; })()`);
check('A5 合并写回未被降级（令牌与大图都还在）', !!aWrite && aWrite.has && aWrite.hasBig && !aWrite.hasPh, JSON.stringify(aWrite));
const aDump = await evalJs(`(function(){
  var out = { writes: (window.__w.list || []).filter(function(x){ return x.k === '${FEED}'; }).map(function(x){ return x.v.length; }) };
  try {
    var a = JSON.parse(window.__w.last['${FEED}'] || '[]');
    var p = a.filter(function(x){ return x.id === 'f_1700000000000_default'; })[0];
    out.n = a.length;
    out.p = p ? (p.comments || []).map(function(c){ return String(c.content).slice(0, 26); }) : 'NO-P';
  } catch (e) { out.err = String(e); }
  try {
    var sa = JSON.parse(localStorage.getItem('${SNAP}') || '[]');
    var sp = sa.filter(function(x){ return x.id === 'f_1700000000000_default'; })[0];
    out.snapN = sa.length;
    out.snapP = sp ? (sp.comments || []).map(function(c){ return String(c.content).slice(0, 26); }) : 'NO-P';
  } catch (e) { out.snapErr = String(e); }
  return out;
})()`);
console.log('· 载荷转储：' + JSON.stringify(aDump));
const errA = await evalJs(`(window.__jsErrors || []).length`);
check('A6 零 JS 异常', !errA, '错误 ' + errA);
const dbg = await evalJs(`(function(){
  var imgs = [].slice.call(document.querySelectorAll('img[src^="@@m:"]'));
  var h = imgs.length ? String(imgs[0].getAttribute('src')).slice(4) : 'none';
  return window.idbGet('xy-home-v2:media:' + h).then(function (v) {
    return { imgs: imgs.length, h: h, read: (typeof v === 'string' ? v.slice(0, 24) : String(v)),
      tried: imgs.length ? String(imgs[0].dataset.tokTried || '') : '',
      miss: imgs.length ? !!window.mochiMediaTokenMissing('@@m:' + h) : null,
      ex: (typeof window.mochiMediaExpand === 'function' ? String(window.mochiMediaExpand('@@m:' + h)).slice(0, 24) : 'nofn'),
      lsKeys: Object.keys(localStorage).filter(function (k) { return k.indexOf('feed-posts') >= 0; }) };
  });
})()`);
console.log('· 媒体池/存储调试：' + JSON.stringify(dbg));

// ================= B. 剥图快照：保留媒体令牌，仍剥大体积 dataURL，且 ≤200KB =================
// 注：安卓仿真下输入框被 mobile-adapt 换成 contenteditable，程序化发布链路不可靠；
// 这里用「点赞」触发的真实 save()（→ scheduleSnap → persistSnap）来核快照产物。
await evalJs(`(function(){ var b = document.querySelector('#feed-list .feed-act[data-like]'); if (b) b.click(); return !!b; })()`);
await sleep(2600);
const b = await evalJs(`(function(){ var v = localStorage.getItem('${SNAP}') || ''; return { len: v.length, tok: v.indexOf('@@m:a1b2c3d4e5f60718293a4b5c6d7e8f01') >= 0, tok2: v.indexOf('@@m:a1b2c3d4e5f60718293a4b5c6d7e8f02') >= 0, big: v.indexOf('iVBORw0KGgo') >= 0, ph: v.indexOf('[图片]') >= 0 }; })()`);
check('B1 快照保留媒体池令牌（修复前令牌被剥成 [图片]）', !!b && b.tok && b.tok2, JSON.stringify(b));
// ⚠ #1363 重锚（不是放宽）：那一发巨型载荷如今在落盘前就被换成媒体池引用，快照侧根本没有东西可剥成
//   「[图片]」了——占位符出现与否不再是「有没有剥图」的证据。本条改按「快照既不许带巨型载荷、也不许丢
//   引用」这一对事实取证：#667 两种坏法（连令牌一起剥＝B1 的 tok 红；不剥图本体＝big 红）仍然都拦得住。
check('B2 快照仍不带大体积 dataURL（#1363 重锚：该载荷已被换成可自愈引用，无物可剥＝无占位符）', !!b && b.big === false && (b.ph === true || (b.tok && b.tok2)), JSON.stringify(b));
check('B3 快照体积仍 ≤200KB 预算', !!b && b.len > 0 && b.len <= 200 * 1024, b ? String(b.len) : '');
const bDump = await evalJs(`(function(){
  var out = { ls: (window.__ls || []) };
  try {
    var sa = JSON.parse(localStorage.getItem('${SNAP}') || '[]');
    var sp = sa.filter(function(x){ return x.id === 'f_1700000000000_default'; })[0];
    out.snapN = sa.length;
    out.snapP = sp ? (sp.comments || []).map(function(c){ return String(c.content).slice(0, 22); }) : 'NO-P';
  } catch (e) { out.err = String(e); }
  return out;
})()`);
console.log('· 快照转储：' + JSON.stringify(bDump).slice(0, 900));

// ================= C. 权威键读不到（大键只在 IDB / IDB 挂起）：令牌评论照常出图 =================
await gotoApp('deg');
await openFeed();
const c = await commentImgs();
const cCount = await evalJs(`document.querySelectorAll('#feed-list .feed-comment').length`);
check('C1 降级窗口评论区仍有评论渲染（文本兜底）', cCount >= 4, '评论 ' + cCount + ' 条');
check('C2 降级窗口令牌评论照常出图（修复前只剩 [图片] 文字）', !!c && c.src.filter(s => s.indexOf('data:image/png') === 0).length >= 3, c ? ('img=' + c.n + ' src=' + c.src.slice(0, 3).join('|').slice(0, 90)) : '');
check('C2b 混排评论未被降级成「好可爱呀 [图片]」', !!c && c.text.indexOf('好可爱呀 [图片]') < 0 && c.text.indexOf('好可爱呀') >= 0, c ? (c.text || '').slice(0, 60) : '');
const cWrite = await evalJs(`(function(){ var l = (window.__w.list || []).filter(function(x){ return x.k === '${FEED}'; }); return { n: l.length, stack: l.length ? l[0].stack : '', len: l.length ? l[0].v.length : 0 }; })()`);
check('C3 权威键仍在（探测为 true）时不得写回', cWrite && cWrite.n === 0, JSON.stringify(cWrite));

// ================= D. 权威副本恢复可读：写回必须用完整版，不得用剥图版盖掉 =================
await evalJs(`(function(){ try { localStorage.setItem('${FEED}', window.__mkFeed()); } catch (e) {} return true; })()`);
await evalJs(`(function(){ var b = document.querySelector('#feed-list .feed-act[data-like]'); if (b) b.click(); return !!b; })()`);
await sleep(3500);
const d = await evalJs(`(function(){ var v = (window.__w.last['${FEED}'] || ''); return { hasBig: v.indexOf('iVBORw0KGgo') >= 0, hasTok: v.indexOf('@@m:a1b2c3d4e5f60718293a4b5c6d7e8f01') >= 0, hasPh: v.indexOf('[图片]') >= 0, wrote: (window.__w.list || []).filter(function(x){ return x.k === '${FEED}'; }).length, len: v.length }; })()`);
// ⚠ #1363 重锚（不是放宽）：「完整版」的证据原来是「那份大 dataURL 还在原文里」，而 #1363 之后那份载荷已在池里、
//   以引用在场（写回带 @@m: 且不含 [图片] 占位＝完整）。#187/#188 那种「剥图版掉包」照旧红：掉包必然带
//   [图片] 占位、且引用会丢（B1 那把尺同拦）。
check('D1 权威恢复可读后写回用完整版（#1363 重锚：认引用不带占位符，不认巨型载荷原文）', !!d && d.wrote > 0 && d.hasTok === true && d.hasPh === false, JSON.stringify(d));
check('D2 写回内容不含「[图片]」占位', !!d && d.hasPh === false, JSON.stringify(d));
const d2 = await commentImgs();
check('D3 同会话自愈：评论区大图恢复渲染', !!d2 && d2.src.filter(s => s.indexOf('data:image/png') === 0).length >= 4, d2 ? ('img=' + d2.n + ' text=' + (d2.text || '').slice(0, 40)) : '');
const errD = await evalJs(`(window.__jsErrors || []).length`);
check('D4 零 JS 异常', !errD, '错误 ' + errD);

const pass = results.every(r => r.ok);
console.log('\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + results.filter(r => r.ok).length + '/' + results.length);
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);

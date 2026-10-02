// ===== 回归脚本：朋友圈评论丢失——同 id 动态深度合并 + 剥图快照裁剪（v3.10.x 修复） =====
// 用法：node build.mjs && node tools/verify-feed-comment-merge.mjs
// 背景（用户反馈）：TA 发的朋友圈，我评论、TA 回复聊了多个回合，第二天只剩一条 TA 评论。
// 根因：feedMergeFromIdb 权威回读合并是 post 级「本地整条覆盖 IDB」——主键 >200KB 时只进
//   IDB 不进 LS，本地副本退化为陈旧剥图快照（超 200KB 静默停写冻结在旧时刻）；启动合并时
//   陈旧快照版本整条盖掉 IDB 里带全部后续评论的新版本，并随即写回 IDB → 评论永久丢失。
// 修复：① mergePosts 同 id 动态深度合并（评论/回复按 ts+作者+内容并集去重、点赞并集、
//   正文/配图取未剥图的完整版）；② persistSnap 剥图后仍超 200KB 时按新→旧裁剪动态数，
//   快照始终可写、始终含最新动态。
// 验证（new-document 注入受控 idbGet/idbSet 桩——getter/setter 冻结防 idb.js 覆盖；
//   IDB 种子=昨晚完整版（5 条评论含回复），LS 主键缺失，LS 剥图快照=冻结旧版（仅 1 条
//   评论/1 条回复））：断言权威合并结果为并集而非被旧版覆盖 + 页面渲染 5 条评论 +
//   大列表发布后快照被裁剪至 ≤200KB 且含最新动态。
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-feedmerge-' + Date.now()),
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

// ---- 种子构造（在页面脚本执行前注入）----
// 完整版（IDB 昨晚状态）：post P 有 5 条 TA 评论，其中第 2 条带 3 条往返回复；点赞 [我, TA]
// 陈旧版（LS 剥图快照冻结态）：同一 post id 仅 1 条评论（= 完整版第 1 条，验证去重）、
//   第 2 条仅剩 1 条回复；点赞仅 [我]。用户症状 = 打开只见这 1 条。
const boot = `
(function () {
  var T = Date.now();
  var P_ID = 'f_1700000000000_default';
  var c1 = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '第一条评论：看到啦好开心', ts: T - 5000, replies: [] };
  var c2full = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '第二条评论：你今天做什么啦', ts: T - 4000, replies: [
    { role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '回复1：上班呀', ts: T - 3500 },
    { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '回复2：辛苦啦晚上吃什么', ts: T - 3000 },
    { role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '回复3：火锅！', ts: T - 2500 }
  ] };
  var c2stale = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '第二条评论：你今天做什么啦', ts: T - 4000, replies: [
    { role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '回复1：上班呀', ts: T - 3500 }
  ] };
  var c3 = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '第三条评论：哈哈火锅好呀', ts: T - 2000, replies: [] };
  var c4 = { role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '第四条评论：周末去吗', ts: T - 1500, replies: [] };
  var c5 = { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: '第五条评论：去去去！', ts: T - 1000, replies: [] };
  var postBase = { id: P_ID, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '', content: '昨晚的动态正文', imgs: [], ts: T - 9000, likes: ['我', '小桃'] };
  var full = JSON.parse(JSON.stringify(postBase)); full.comments = [c1, c2full, c3, c4, c5];
  var stale = JSON.parse(JSON.stringify(postBase)); stale.likes = ['我']; stale.comments = [c1, c2stale];
  // 大列表种子：400 条文本动态（剥图后仍 >200KB），最老一条带 OLDEST 标记
  var bulk = [];
  for (var i = 0; i < 400; i++) {
    bulk.push({ id: 'bulk_' + i, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '', content: (i === 0 ? 'OLDEST-MARKER-' : '') + '历史动态' + i + ' ' + new Array(600).join('x'), imgs: [], ts: T - 100000 - (400 - i) * 1000, likes: [], comments: [] });
  }
  var idbSeed = {};
  idbSeed['xy-home-v2:feed-posts'] = JSON.stringify(bulk.concat([full]));
  window.__feedMergeCaptured = {};
  // 受控桩：getter/setter 冻结——idb.js 稍后的 window.idbGet = fn 赋值走 setter 被忽略
  var gStub = function (k) { return Promise.resolve(idbSeed[k] !== undefined ? idbSeed[k] : null); };
  var sStub = function (k, v) { window.__feedMergeCaptured[k] = v; return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbDelete', { configurable: false, get: function () { return dStub; }, set: function () {} });
  try { localStorage.removeItem('xy-home-v2:feed-posts'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:default:feed-posts-snap'); } catch (e) {}
  localStorage.setItem('xy-home-v2:default:feed-posts-snap', JSON.stringify([stale]));
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- boot1：全新档案空跑一次（让首次加载的初始化标记落地），随后注入种子重载 ----
await gotoApp();
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await gotoApp(true);

// ---- A. 权威合并：IDB 完整版 × 本地陈旧快照 → 并集（核心回归：修复前只剩 1 条评论） ----
const mergedRaw = await evalJs(`(function(){ var w = window.__feedMergeCaptured || {}; return w['xy-home-v2:feed-posts'] || localStorage.getItem('xy-home-v2:feed-posts') || ''; })()`);
let merged = null;
try { merged = JSON.parse(mergedRaw || 'null'); } catch (e) {}
const P = Array.isArray(merged) ? merged.find(p => p && p.id === 'f_1700000000000_default') : null;
check('A1 权威合并已落盘且包含目标动态', !!P, merged ? ('共' + merged.length + '条') : '无写入');
check('A2 五条评论全部保留（修复前被陈旧快照覆盖只剩1条）', P && Array.isArray(P.comments) && P.comments.length === 5, P ? '实际' + (P.comments || []).length + '条' : '');
const c2 = P && (P.comments || []).find(c => c.content.indexOf('第二条') === 0);
check('A3 往返回复并集保留（3条，修复前只剩1条）', c2 && Array.isArray(c2.replies) && c2.replies.length === 3, c2 ? '实际' + ((c2.replies || []).length) + '条' : '');
check('A4 点赞并集（我+小桃）', !!P && Array.isArray(P.likes) && P.likes.indexOf('我') >= 0 && P.likes.indexOf('小桃') >= 0, P ? JSON.stringify(P.likes) : '');
check('A5 重复合并去重（同评论不重复计）', !!P && P.comments.length === 5);

// ---- B. 页面渲染：进入朋友圈可见全部评论 ----
await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
await sleep(800);
const domCount = await evalJs(`document.querySelectorAll('#feed-list .feed-comment').length`);
check('B1 朋友圈页渲染出 5 条评论', domCount === 5, '实际 ' + domCount);

// ---- C. 剥图快照：大列表（>200KB）发布新动态后被裁剪保留最新，不再静默停写 ----
await evalJs(`(function(){ var b = document.getElementById('feed-publish-btn'); if (b) b.click(); return true; })()`);
await sleep(300);
await evalJs(`(function(){ var i = document.getElementById('feed-input'); if (i) { i.value = 'NEWEST-MARKER-刚发的新动态'; } return true; })()`);
await evalJs(`(function(){ var b = document.getElementById('feed-publish'); if (b) b.click(); return true; })()`);
await sleep(1500);
const snapLen = await evalJs(`(localStorage.getItem('xy-home-v2:default:feed-posts-snap') || '').length`);
const snapHasNew = await evalJs(`(localStorage.getItem('xy-home-v2:default:feed-posts-snap') || '').indexOf('NEWEST-MARKER') >= 0`);
const snapHasOldest = await evalJs(`(localStorage.getItem('xy-home-v2:default:feed-posts-snap') || '').indexOf('OLDEST-MARKER') >= 0`);
check('C1 快照已更新且 ≤200KB（修复前超限静默停写冻结在旧时刻）', snapLen > 0 && snapLen <= 200 * 1024, String(snapLen));
check('C2 快照包含最新发布的动态（裁剪保最新）', snapHasNew === true);
check('C3 快照裁掉最老动态以腾出空间', snapHasOldest === false, snapHasOldest ? '未裁剪' : '');

// ---- D. 合并结果整体落盘一致性：发布后再读捕获写入，目标动态评论仍是 5 条 ----
const reCount = await evalJs(`(function(){ var w = window.__feedMergeCaptured || {}; try { var a = JSON.parse(w['xy-home-v2:feed-posts'] || '[]'); var p = a.filter(function(x){return x.id==='f_1700000000000_default';})[0]; return p ? p.comments.length : -1; } catch (e) { return -2; } })()`);
check('D1 后续保存不回退评论数（仍为5）', reCount === 5, '实际 ' + reCount);

const pass = results.every(r => r.ok);
console.log('\\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + results.filter(r => r.ok).length + '/' + results.length);
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);

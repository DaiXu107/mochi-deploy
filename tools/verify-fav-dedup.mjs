// ===== 回归脚本：收藏「已收藏但页面不全」——判重按归属+时间戳 / 启动回填只补不覆盖（v3.26.x 修复） =====
// 用法：node build.mjs && node tools/verify-fav-dedup.mjs
// 背景（用户反馈，iPhone 12 Pro / Safari）：收藏了 5 条消息，收藏页只显示 3 条；返回聊天
//   再次收藏同一条，提示「已收藏过这条消息」，但收藏页确实没有。
// 根因：① 长按收藏判重只比 side+text 且不分归属——TA 自动收藏（by:'ta'，显示在「联系人」
//   tab）会挡住「我」收藏同一条；同文案不同消息（不同时间戳）也只能存一条。
//   ② 进聊天时 idbGet(prefix:':fav-msgs') 无条件覆盖本地收藏——idbSet 是异步
//   fire-and-forget，iOS 杀后台时 IDB 落后于 localStorage，旧快照回滚新收藏。
// 修复：判重限定归属（我/TA 各自独立）并加 ts 比较；启动回填仅在本地无收藏时补入。
// 验证（new-document 注入受控 idbGet/idbSet 桩——getter/setter 冻结防 idb.js 覆盖；
//   IDB 种子=陈旧 2 条快照，LS=较新 3 条）：断言启动不回滚 + TA 已收藏的消息仍可被我收藏 +
//   同文案不同消息可分别收藏 + 同一条消息重复收藏仍拦截 + 收藏页渲染条数一致 +
//   addMyFavItem/addTaFavItem 归属互不挡 + 清空本地后回填仍生效。
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-favdedup-' + Date.now()),
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

// ---- 种子（页面脚本执行前注入）----
// 聊天记录 4 条：两条同文案「早安呀」的 TA 消息（不同时间戳）+ 一条我的 + 一条 TA。
// 收藏：LS=较新 3 条（我的2 + TA自动收藏1）；IDB=陈旧 2 条快照（模拟 iOS 杀后台异步写未落地）。
const boot = `
(function () {
  var T = 1756000000000;
  var msgs = [
    { side: 'in',  text: '早安呀',         type: 'text', ts: T - 50000 },
    { side: 'out', text: '想你了',         type: 'text', ts: T - 40000 },
    { side: 'in',  text: '早安呀',         type: 'text', ts: T - 30000 },
    { side: 'in',  text: '晚上一起吃饭吗', type: 'text', ts: T - 20000 }
  ];
  var A = { side: 'in',  text: '早安呀',         type: 'text', ts: T - 50000, by: 'me' };
  var B = { side: 'out', text: '想你了',         type: 'text', ts: T - 40000, by: 'ta' };
  var C = { side: 'in',  text: '晚上一起吃饭吗', type: 'text', ts: T - 20000, by: 'me' };
  var FAV_KEY = 'xy-home-v2:default:fav-msgs';
  var CHAT_KEY = 'xy-home-v2:default:chat-msgs';
  var idbSeed = {};
  idbSeed[CHAT_KEY] = JSON.stringify(msgs);
  idbSeed[FAV_KEY] = JSON.stringify([A, B]); // 陈旧快照：比 LS 少 1 条
  // 收藏种子只在首次加载种入一次（sessionStorage 跨 reload 保持标记）——
  // 「本地清空后从 IDB 回填」用例前的 reload 不能再重塞
  if (!sessionStorage.getItem('__fav-seeded')) {
    if (!localStorage.getItem(FAV_KEY)) localStorage.setItem(FAV_KEY, JSON.stringify([A, B, C])); // 本地较新：3 条
    sessionStorage.setItem('__fav-seeded', '1');
  }
  if (!localStorage.getItem(CHAT_KEY)) localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
  // 受控桩：getter/setter 冻结——idb.js 稍后的 window.idbGet = fn 赋值走 setter 被忽略
  var gStub = function (k) { return Promise.resolve(idbSeed[k] !== undefined ? idbSeed[k] : undefined); };
  var sStub = function (k, v) { idbSeed[k] = v; return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbDelete', { configurable: false, get: function () { return dStub; }, set: function () {} });
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- boot1：全新档案空跑一次（初始化标记落地），随后注入种子重载 ----
await gotoApp();
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await gotoApp(true);

// ---- A. 启动回填不回滚：本地 3 条 × IDB 陈旧 2 条 → 仍为 3 条（修复前被覆盖成 2 条） ----
const bootLen = await evalJs(`(function(){ try { return JSON.parse(localStorage.getItem('xy-home-v2:default:fav-msgs') || '[]').length; } catch (e) { return -1; } })()`);
check('A1 启动后收藏不回滚（本地3条，IDB陈旧2条；修复前被覆盖成2）', bootLen === 3, '实际 ' + bootLen);

// ---- 进入聊天页 ----
await evalJs(`(function(){ var el = document.querySelector('.app[data-app="chat"]'); if (el) el.click(); return !!el; })()`);
await sleep(1000);
const bubbleCnt = await evalJs(`document.querySelectorAll('#chat-body .msg .msg-bubble').length`);
check('B0 聊天页渲染出种子消息', bubbleCnt >= 4, '气泡 ' + bubbleCnt);

// 点击指定文案的气泡 → 打开消息操作栏 → 点「收藏」
async function favMsgByText(text) {
  const opened = await evalJs(`(function(){
    var bs = document.querySelectorAll('#chat-body .msg .msg-bubble');
    for (var i = 0; i < bs.length; i++) {
      if ((bs[i].textContent || '').trim() === ${JSON.stringify(text)}) { bs[i].click(); return true; }
    }
    return false;
  })()`);
  if (!opened) return 'no-bubble';
  await sleep(200);
  const clicked = await evalJs(`(function(){
    var bar = document.getElementById('msg-actions');
    if (!bar || bar.hidden) return false;
    var b = bar.querySelector('.ma-btn[data-act="fav"]');
    if (!b || b.hidden) return false;
    b.click();
    return true;
  })()`);
  await sleep(150);
  return clicked ? 'ok' : 'no-fav-btn';
}
async function favLen() {
  return evalJs(`(function(){ try { return JSON.parse(localStorage.getItem('xy-home-v2:default:fav-msgs') || '[]').length; } catch (e) { return -1; } })()`);
}
async function favLast() {
  return evalJs(`(function(){ try { var a = JSON.parse(localStorage.getItem('xy-home-v2:default:fav-msgs') || '[]'); return a.length ? JSON.stringify(a[a.length-1]) : ''; } catch (e) { return ''; } })()`);
}

// ---- B. TA 收藏过（by:'ta'）不再挡「我」收藏同一条（修复前：提示已收藏过、我的收藏页无此条） ----
let r = await favMsgByText('想你了');
let len = await favLen();
let last = '';
try { last = JSON.parse(await favLast() || '{}'); } catch (e) {}
check('B1 TA 已收藏的消息仍可被我收藏（3→4）', r === 'ok' && len === 4, r + ' len=' + len);
check('B2 新增条目归属为「我」（by=me）', last && last.by === 'me' && last.text === '想你了', JSON.stringify(last));

// ---- C. 同文案不同消息（不同时间戳）可分别收藏（修复前：第二条被「已收藏过」挡住） ----
r = await favMsgByText('早安呀'); // 命中第一条（已收藏，ts 相同）→ 应拦截
len = await favLen();
check('C1 已收藏的同一条消息重复点仍拦截（保持4条）', r === 'ok' && len === 4, r + ' len=' + len);
// 直接点第二条同文案消息：先定位两条「早安呀」气泡，点第二个
const r2 = await evalJs(`(function(){
  var bs = document.querySelectorAll('#chat-body .msg .msg-bubble');
  var hits = [];
  for (var i = 0; i < bs.length; i++) { if ((bs[i].textContent || '').trim() === '早安呀') hits.push(bs[i]); }
  if (hits.length < 2) return 'only-' + hits.length;
  hits[1].click();
  return 'ok';
})()`);
await sleep(200);
const clicked2 = await evalJs(`(function(){
  var bar = document.getElementById('msg-actions');
  if (!bar || bar.hidden) return false;
  var b = bar.querySelector('.ma-btn[data-act="fav"]');
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(150);
len = await favLen();
try { last = JSON.parse(await favLast() || '{}'); } catch (e) {}
check('C2 同文案的第二条消息也能收藏（按时间戳区分；修复前被挡）', r2 === 'ok' && clicked2 && len === 5 && last.ts === 1756000000000 - 30000, r2 + ' len=' + len);
// 重复点同一条 → 拦截
const clicked3 = await evalJs(`(function(){
  var bs = document.querySelectorAll('#chat-body .msg .msg-bubble');
  var hits = [];
  for (var i = 0; i < bs.length; i++) { if ((bs[i].textContent || '').trim() === '早安呀') hits.push(bs[i]); }
  if (hits.length < 2) return false;
  hits[1].click();
  return true;
})()`);
await sleep(200);
await evalJs(`(function(){
  var bar = document.getElementById('msg-actions');
  if (!bar || bar.hidden) return false;
  var b = bar.querySelector('.ma-btn[data-act="fav"]');
  if (b) b.click();
  return true;
})()`);
await sleep(150);
len = await favLen();
check('C3 同一条消息重复收藏仍拦截（保持5条）', clicked3 && len === 5, 'len=' + len);

// ---- D. 收藏页渲染：「我的收藏」条数与存储一致，不再有"存了却看不到" ----
await evalJs(`(function(){
  document.querySelectorAll('.page').forEach(function(p){ p.hidden = true; });
  var pg = document.getElementById('page-fav');
  if (pg) pg.hidden = false;
  if (window.renderFav) window.renderFav();
  return !!pg;
})()`);
await sleep(300);
const myCnt = await evalJs(`(function(){
  var mine = document.querySelectorAll('#fav-tabs .fav-tab');
  for (var i = 0; i < mine.length; i++) { if (mine[i].dataset.tab === 'mine') mine[i].click(); }
  return true;
})()`);
await sleep(200);
const rendered = await evalJs(`document.querySelectorAll('#fav-list .msg').length`);
const headerCnt = await evalJs(`(function(){ var c = document.querySelector('#fav-list .ccg-count'); return c ? Number(c.textContent) : -1; })()`);
const storedMine = await evalJs(`(function(){ try { var a = JSON.parse(localStorage.getItem('xy-home-v2:default:fav-msgs') || '[]'); return a.filter(function(x){ return (x.by||'me') !== 'ta'; }).length; } catch (e) { return -1; } })()`);
check('D1 「我的收藏」页渲染条数 = 存储条数（修复前存5见3）', myCnt && rendered === storedMine && rendered > 0, '渲染' + rendered + ' 存储' + storedMine);
check('D2 分组头计数与列表一致', headerCnt === rendered, '头' + headerCnt + ' 列表' + rendered);

// ---- E. addMyFavItem/addTaFavItem 归属互不挡（卡片类收藏同款判重） ----
const apiRes = await evalJs(`(function(){
  var item = { kind: 'card', special: 'invite', q: '周末看电影', mine: '', ta: '', ts: 1756111111111 };
  var t1 = window.addTaFavItem(JSON.parse(JSON.stringify(item)));
  var t2 = window.addMyFavItem(JSON.parse(JSON.stringify(item)));
  return JSON.stringify({ t1: t1, t2: t2 });
})()`);
let api = {};
try { api = JSON.parse(apiRes || '{}'); } catch (e) {}
check('E1 TA 收藏过的卡片，「我」仍可收藏（修复前被 favDup 挡）', api.t1 === true && api.t2 === true, apiRes);

// ---- F. 本地收藏清空后，IDB 回填仍生效（保留原回填能力） ----
await evalJs(`(function(){ localStorage.removeItem('xy-home-v2:default:fav-msgs'); return true; })()`);
await gotoApp(true);
const fillLen = await evalJs(`(function(){ try { return JSON.parse(localStorage.getItem('xy-home-v2:default:fav-msgs') || '[]').length; } catch (e) { return -1; } })()`);
check('F1 本地无收藏时从 IDB 回填（2条种子）', fillLen === 2, '实际 ' + fillLen);

const pass = results.every(r => r.ok);
console.log('\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + results.filter(r => r.ok).length + '/' + results.length);
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);

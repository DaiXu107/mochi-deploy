// ===== 回归脚本：#1032 拍卖藏品（🎒 拍品收藏）页改版＝卡片网格 + 空态直达 =====
// 用法：node build.mjs && node tools/verify-1032-auction-bag-ui.mjs
// 背景（用户直派「拍卖会ui里的【拍卖藏品】功能页面没有设计ui」）：showBag() 原先是一行行
//   pong-end-stat 裸文本，从未有过设计层。#1032 改两列卡片网格（成色描边/徽章、展台区、
//   落槌价+日期或 📬 来源、整行送TA）+ 统计条 + 空态（🎒＋「开始拍卖」直达）。
// 本脚本盯四件事：①新布局真的渲染（网格/卡片/统计条/成色兜底）②转赠与返回链路语义不变
//   （.au-send-btn + data-i、结算后「返回」）③空态直达能开局 ④用户可控名称转义不回退。
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

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
const cdpPort = 9760 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-au1032-' + Date.now()),
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
// 开屏关闭（同族脚本口径：滑到底＋点进入，强制公告先确认）
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
      return 'mwait';
    }
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box');
    if (sb) sb.scrollTop = sb.scrollHeight;
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
const splashDiag = await evalJs(`(function(){
  var sp = document.getElementById('splash');
  return { hasHide: sp ? sp.classList.contains('hide') : null, spHidden: sp ? sp.hidden : null, disp: sp ? getComputedStyle(sp).display : null };
})()`);
chk('A0 开屏已关闭（同族三条件口径）', splashClosed || splashDiag.disp === 'none' || splashDiag.spHidden === true, JSON.stringify(splashDiag));

await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1200);
await evalJs(`(function(){ try { window.giftWalletSet({ myBalance: 999900, systemBalance: 999900 }); } catch (e) {} return 1; })()`);
const opened = await evalJs(`(function(){
  var b = document.getElementById('more-auction');
  if (b) { b.click(); return 'btn'; }
  if (window.openAuctionPanel) { window.openAuctionPanel(); return 'api'; }
  return 'no-entry';
})()`);
await sleep(800);
chk('A1 拍卖会面板可打开', opened === 'btn' || opened === 'api', String(opened));
// 开场教学是全屏层，先点「开始拍卖」进竞价，头部 🎒 才点得到
await evalJs(`(function(){ var b = document.getElementById('au-intro-start'); if (b) b.click(); return 1; })()`);
await sleep(400);

// 种数据（xyStore 优先，退回 localStorage——与 auction.js lsGet 读径同序，避开内存缓存假绿）
async function seed(key, val) {
  return await evalJs(`(function(){
    var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
    var s = JSON.stringify(${JSON.stringify(val)});
    try { if (window.xyStore) { window.xyStore(pre).set(${JSON.stringify(key)}, s); return 'xystore'; } } catch (e) {}
    try { localStorage.setItem(pre + ':' + ${JSON.stringify(key)}, s); return 'ls'; } catch (e) { return 'ERR'; }
  })()`);
}
const openBag = async () => { await evalJs(`(function(){ var b = document.getElementById('au-bag'); if (b) b.click(); return 1; })()`); await sleep(300); };
const backFromBag = async () => { await evalJs(`(function(){ var b = document.getElementById('au-btn-start'); if (b) b.click(); return 1; })()`); await sleep(300); };

await seed('auction-items', [
  { ico: '💎', name: '小钻戒', fen: 9999, ts: Date.now(), rarity: 'SSR' },
  { ico: '🎫', name: '演唱会门票', fen: 3999, ts: Date.now() },
  { ico: '🧸', name: 'Mochi 玩偶', fen: 0, ts: Date.now(), from: 'ta' }
]);
await seed('auction-stats', { sessions: 2, myWins: 2, taWins: 1, spentFen: 13998 });
await openBag();

const G = JSON.parse(await evalJs(`(function(){
  var ov = document.getElementById('au-overlay');
  var grid = ov ? ov.querySelector('.au-bag-grid') : null;
  var cards = grid ? Array.prototype.slice.call(grid.querySelectorAll('.au-bag-card')) : [];
  var stat = ov ? ov.querySelector('.au-bag-stat') : null;
  var title = document.getElementById('au-ov-title');
  return JSON.stringify({
    ovHidden: ov ? !!ov.hidden : null, isFs: ov ? ov.classList.contains('au-ov-fs') : null,
    title: title ? title.textContent : '',
    display: grid ? getComputedStyle(grid).display : 'no-el',
    cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    n: cards.length,
    oldRow: document.querySelectorAll('.au-bag-row').length,
    overflowX: grid ? (grid.scrollWidth > innerWidth) : null,
    stat: stat ? stat.textContent : '',
    cards: cards.map(function (c) {
      var r = c.getBoundingClientRect();
      var badge = c.querySelector('.au-bag-badge');
      var meta = c.querySelector('.au-bag-meta');
      var name = c.querySelector('.au-bag-name');
      var send = c.querySelector('.au-send-btn');
      return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
        ssr: c.classList.contains('au-bag-ssr'), rare: c.classList.contains('au-bag-rare'),
        border: getComputedStyle(c).borderTopColor, shadow: getComputedStyle(c).boxShadow,
        badge: badge ? badge.textContent : '', name: name ? name.textContent : '',
        meta: meta ? meta.textContent : '', send: send ? (send.getAttribute('data-i') + '|' + send.textContent) : '' };
    })
  });
})()`));
chk('B1 背包浮层打开且为全屏列表态（#381 语义不变）', G.ovHidden === false && G.isFs === true, JSON.stringify({ h: G.ovHidden, fs: G.isFs }));
chk('B2 标题计数照常（G1 链路依赖）', G.title.indexOf('🎒 拍品收藏（3）') >= 0, G.title);
chk('B3 卡片网格渲染：display:grid、两列、3 张卡', G.display === 'grid' && G.cols === 2 && G.n === 3, JSON.stringify({ d: G.display, c: G.cols, n: G.n }));
chk('B4 裸文本行样式退役（.au-bag-row 不再出现）', G.oldRow === 0, String(G.oldRow));
chk('B5 统计条含件数/累计花费/TA 寄回', G.stat.indexOf('共 3 件') >= 0 && G.stat.indexOf('¥139.98') >= 0 && G.stat.indexOf('寄回 1 件') >= 0, G.stat);
chk('B6 无横向溢出（390 视口）', G.overflowX === false, String(G.overflowX));
if (G.cards.length === 3) {
  const [c0, c1, c2] = G.cards;
  chk('C1 落库成色直读（SSR 卡金框＋内发光）', c0.badge === 'SSR' && c0.ssr === true && /rgba\(240, 173, 40/.test(c0.border) && /rgba\(240, 173, 40/.test(c0.shadow), JSON.stringify(c0));
  chk('C2 旧条目按拍品池底价兜底（演唱会门票 3999→稀有蓝框）', c1.badge === '稀有' && c1.rare === true && /rgba\(88, 150, 230/.test(c1.border), JSON.stringify(c1));
  chk('C3 TA 寄回落槌价为 0：按名反查池兜底＋来源行＋无送按钮', c2.badge === '普通' && c2.meta.indexOf('寄来') >= 0 && c2.send === '', JSON.stringify(c2));
  chk('C4 我的拍品卡：落槌价＋日期行＋送TA（data-i 语义不变）', /¥99\.99 拍下 · \d+月\d+日/.test(c0.meta) && c0.send === '0|送TA' && c1.send === '1|送TA', JSON.stringify({ m0: c0.meta, s0: c0.send, s1: c1.send }));
  chk('C5 两列网格几何：第 1/2 卡同行不同列、卡宽>120、不出屏', c0.top === c1.top && c0.left < c1.left && c0.w > 120 && c1.right <= 390, JSON.stringify({ t0: c0.top, t1: c1.top, l0: c0.left, l1: c1.left, w: c0.w, r1: c1.right }));
} else { chk('C1~C5 卡片断言', false, 'cards=' + G.cards.length); }

// D1 送TA 仍先弹不可撤回确认（openModal），取消后收藏不缩水
await evalJs(`(function(){ var b = document.querySelector('#au-overlay .au-send-btn'); if (b) b.click(); return 1; })()`);
await sleep(300);
const d1 = JSON.parse(await evalJs(`(function(){
  var m = document.getElementById('modal-mask');
  var s = document.getElementById('modal-static');
  return JSON.stringify({ open: !!m && !m.hidden, text: s ? s.textContent : '' });
})()`));
chk('D1 送TA 确认弹窗含拍品名', d1.open === true && d1.text.indexOf('小钻戒') >= 0, JSON.stringify(d1));
await evalJs(`(function(){ var c = document.getElementById('modal-cancel') || document.getElementById('modal-close'); if (c) c.click(); return 1; })()`);
await sleep(250);
// D2 转义不回退：自制拍品名称可含 HTML（esc 收口）
await backFromBag();
await seed('auction-items', [{ ico: '🐚', name: '<b>粗</b>字体', fen: 100, ts: Date.now() }]);
await openBag();
const d2 = JSON.parse(await evalJs(`(function(){
  var ov = document.getElementById('au-overlay');
  var name = ov ? ov.querySelector('.au-bag-name') : null;
  return JSON.stringify({ text: name ? name.textContent : '', bold: ov ? ov.querySelectorAll('.au-bag-name b').length : -1, n: ov ? ov.querySelectorAll('.au-bag-card').length : -1 });
})()`));
chk('D2 名称转义：按字面渲染、不产出 <b> 节点', d2.text === '<b>粗</b>字体' && d2.bold === 0 && d2.n === 1, JSON.stringify(d2));
// D3 返回语义：场次中返回＝收浮层回竞价（#346 不变）
await backFromBag();
const d3 = JSON.parse(await evalJs(`(function(){
  var ov = document.getElementById('au-overlay');
  var st = window.__auDebug && window.__auDebug.st();
  return JSON.stringify({ hidden: ov ? !!ov.hidden : null, started: st ? !!st.started : null, phase: st ? st.phase : '' });
})()`));
chk('D3 场次中「返回」收背包回竞价', d3.hidden === true && d3.started === true && d3.phase === 'bidding', JSON.stringify(d3));

// E1 空态：0 件时出引导卡；E2 点「开始拍卖」直达新场次
await seed('auction-items', []);
await openBag();
const e1 = JSON.parse(await evalJs(`(function(){
  var ov = document.getElementById('au-overlay');
  var em = ov ? ov.querySelector('.au-bag-empty') : null;
  var btn = ov ? ov.querySelector('.au-bag-empty-btn') : null;
  var r = btn ? btn.getBoundingClientRect() : null;
  return JSON.stringify({ has: !!em, text: em ? em.textContent : '', btn: btn ? btn.textContent : '',
    tap: r ? (r.width > 60 && r.height > 20 && r.top > 0 && r.bottom < innerHeight) : false,
    grid: ov ? ov.querySelectorAll('.au-bag-grid').length : -1 });
})()`));
chk('E1 空态渲染（🎒＋文案，无网格残壳），直达按钮可见可点', e1.has === true && e1.text.indexOf('还什么都没拍到') >= 0 && e1.btn === '开始拍卖' && e1.tap === true && e1.grid === 0, JSON.stringify(e1));
await evalJs(`(function(){ var b = document.querySelector('#au-overlay .au-bag-empty-btn'); if (b) b.click(); return 1; })()`);
await sleep(500);
const e2 = JSON.parse(await evalJs(`(function(){
  var ov = document.getElementById('au-overlay');
  var st = window.__auDebug && window.__auDebug.st();
  return JSON.stringify({ hidden: ov ? !!ov.hidden : null, started: st ? !!st.started : null, phase: st ? st.phase : '', idx: st ? st.idx : -1, lots: st && st.lots ? st.lots.length : 0 });
})()`));
chk('E2 空态直达真开局（浮层收起、竞价阶段、新一场 3 件）', e2.hidden === true && e2.started === true && e2.phase === 'bidding' && e2.lots === 3, JSON.stringify(e2));

// E3 📜 拍卖记录浮层不在本批面：仍是原 pong-end-stat 形态（防顺手半改）
await evalJs(`(function(){ var b = document.getElementById('au-history'); if (b) b.click(); return 1; })()`);
await sleep(300);
const e3 = JSON.parse(await evalJs(`(function(){
  var ov = document.getElementById('au-overlay');
  return JSON.stringify({ open: ov && !ov.hidden, bag: ov ? ov.querySelectorAll('.au-bag-card').length : -1, empty: ov ? ov.querySelectorAll('.au-bag-empty').length : -1 });
})()`));
chk('E3 拍卖记录照常打开且未混入藏品页新组件', e3.open === true && e3.bag === 0 && e3.empty === 0, JSON.stringify(e3));
await backFromBag();

console.log(`\nverify-1032-auction-bag-ui: ${pass} PASS / ${fail} FAIL`);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);

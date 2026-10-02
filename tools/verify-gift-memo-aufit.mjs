// ===== 回归脚本：#372 连续送心愿单礼物第二件起消失 / #373 今日备忘·心情换页刷新回退 / #374 拍卖背包·记录浮层显示不全 =====
// 用法：node build.mjs && node tools/verify-gift-memo-aufit.mjs
// #372 根因：dupSig 对 special:'gift' 取鲜花字段（flName/flEmoji/flWish，礼物记录里全 undefined）
//   → 任意两件礼物签名恒等，60s 相邻去重窗口内第二件被当重复删（ normCollapseRange 刷新归一化触发）。
//   断言：60s 内连续 chatAddGift 两件不同礼物 + 刷新归一化后两条都在。
// #373 根因：ensureMemoRowP3 把 v3.13.x 一次性迁移写成每次启动无条件执行，用户手动把
//   memo-row 换到第二页后刷新被打回第三页。断言：种 desk-layout(memo-row 在第2页) 启动后
//   DOM 与存储都仍在第2页。
// #374 根因：背包/记录浮层 absolute 填满 .au-stage，未开局时 stage 仅 ~30px＝列表被裁成
//   一条缝。断言：未开局点 🎒 → #au-overlay 带 .au-ov-fs 且高>300px，返回后收起。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, pass, extra) => { results.push({ name, pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (extra ? ' —— ' + extra : '')); };

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p) => p && (() => { try { return statSync(p).isFile(); } catch (e) { return false; } })());
const chromePath = candidates[0];
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
const cdpPort = 9680 + Math.floor(Math.random() * 80);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v372-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws, msgId = 0; const pend = new Map();
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
    await sleep(500);
  }
  throw new Error('cdp connect fail');
}
function send(method, params) { return new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evl(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result ? r.result.value : undefined;
}
await cdpConnect();
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 384, height: 752, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: baseUrl + '/index.html' });
async function waitApp() {
  for (let i = 0; i < 30; i++) { await sleep(500); if (await evl(`!!document.getElementById('chat-auction-panel') && typeof window.xyStore==='function'`)) return true; }
  return false;
}
if (!(await waitApp())) { // 偶发无头坏页态：重导航一次兜底
  await send('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitApp())) { console.error('page not ready'); chrome.kill(); process.exit(2); }
}
await sleep(2000);
// 过开屏
const entered = await evl(`(function(){ var b=document.getElementById('splash-box'); if(b) b.scrollTop=b.scrollHeight; return 1; })()`);
await sleep(600);
await evl(`(function(){ var e=document.getElementById('splash-enter'); if(e && !e.hidden) e.click(); return 1; })()`);
await sleep(1200);

// ---- #373：memo-row 换到第2页后，启动/切桌面不再被打回第3页 ----
// 用应用自己的存储层种布局（预置裸 LS 会被启动回填时序吞掉），再触发 contact-switched
// 走真实启动路径（buildDeskPages + ensureMemoRowP3 + applyDeskLayout）
const memoSeed = await evl(`(function(){
  try {
    window.xyStore('xy-home-v2:default').set('desk-layout', JSON.stringify([["deco","quote-row","checkin","apps","music"],["memo-row","p2apps"],[]]));
    window.xyStore('xy-home-v2:default').set('desk-page-count', '2');
    document.dispatchEvent(new Event('contact-switched'));
    return 'ok';
  } catch (e) { return 'err:' + e.message; }
})()`);
await sleep(1200);
const memo = await evl(`(function(){
  var n=document.querySelector('[data-desk-widget="memo-row"]'); if(!n) return {err:'nonode'};
  var slides=document.querySelectorAll('.page-slide'); var pi=-1;
  slides.forEach(function(s,i){ if(s===n.closest('.page-slide')) pi=i; });
  var lay=null; try { lay=JSON.parse(localStorage.getItem('xy-home-v2:default:desk-layout')||'null'); } catch(e){}
  var stIdx=-1; if(lay) lay.forEach(function(pg,i){ if(pg && pg.indexOf('memo-row')>=0) stIdx=i; });
  return { domPage: pi, storePage: stIdx, layNull: !lay };
})()`);
ok('#380 种布局成功', memoSeed === 'ok', String(memoSeed));
ok('#380 memo-row 换到第2页后仍在第2页(DOM，不被打回第3页)', memo && memo.domPage === 1, JSON.stringify(memo));
ok('#380 memo-row 换到第2页后仍在第2页(存储)', memo && memo.storePage === 1, JSON.stringify(memo));

// ---- #372：60s 内连续送两件不同礼物，刷新归一化后两条都在 ----
const seeded = await evl(`(function(){
  try {
    var a={ side:'out', special:'gift', giftId:'g1', giftName:'永生玫瑰', giftEmoji:'🌹', giftImg:'', giftPrice:5.2, giftWish:'心意', giftCat:'classic', ts:Date.now() };
    var b={ side:'out', special:'gift', giftId:'g2', giftName:'Mochi 玩偶', giftEmoji:'🧸', giftImg:'', giftPrice:9, giftWish:'心意', giftCat:'classic', ts:Date.now()+50 };
    window.chatAddGift(a); window.chatAddGift(b);
    return 2;
  } catch (e) { return 'err:' + e.message; }
})()`);
await sleep(500);
// 刷新（触发刷新归一化 collapseRapidDups/normCollapseRange 全库跑）
await send('Page.navigate', { url: baseUrl + '/index.html' });
if (!(await waitApp())) { console.error('page not ready after reload'); chrome.kill(); process.exit(2); }
await sleep(2500); // 等 runDeferredNormalization
const giftCount = await evl(`(function(){
  try {
    var raw=localStorage.getItem('xy-home-v2:default:chat-msgs');
    if(!raw) return 'nomsgs';
    var arr=JSON.parse(raw); if(!Array.isArray(arr)) arr=(arr.msgs||[]);
    var g=arr.filter(function(m){ return m && m.special==='gift'; });
    var names=g.map(function(m){ return m.giftName; }).join(',');
    return { count:g.length, names:names };
  } catch(e){ return 'err:'+e.message; }
})()`);
ok('#379 两件不同礼物刷新后都还在(不被60s相邻去重吞)', giftCount && giftCount.count === 2, JSON.stringify(giftCount) + ' seed=' + seeded);

// ---- #374：未开局点 🎒，浮层转全屏不被裁；返回后收起 ----
await evl(`(function(){ var mp=document.getElementById('chat-more-panel'); if(mp) mp.hidden=false; return 1; })()`);
await sleep(300);
await evl(`(function(){ var b=document.getElementById('more-auction'); if(b) b.click(); return 1; })()`);
await sleep(1200);
await evl(`(function(){ var b=document.getElementById('au-bag'); if(b) b.click(); return 1; })()`);
await sleep(600);
const bag = await evl(`(function(){
  var ov=document.getElementById('au-overlay'); if(!ov) return {err:'noov'};
  var b=ov.getBoundingClientRect();
  return { hidden: ov.hidden, fs: ov.classList.contains('au-ov-fs'), h: Math.round(b.height), w: Math.round(b.width) };
})()`);
ok('#381 未开局点🎒浮层转全屏(au-ov-fs)', bag && !bag.hidden && bag.fs === true, JSON.stringify(bag));
ok('#381 全屏浮层高度>300px(不再裁成一条缝)', bag && bag.h > 300, 'h=' + (bag && bag.h));
await evl(`(function(){ var b=document.getElementById('au-btn-start'); if(b) b.click(); return 1; })()`);
await sleep(400);
const closed = await evl(`(function(){ var ov=document.getElementById('au-overlay'); return ov ? ov.hidden : 'noov'; })()`);
ok('#381 点返回浮层收起', closed === true, String(closed));

chrome.kill(); server.close();
const fail = results.filter(r => !r.pass).length;
console.log('---\\n' + results.length + ' 断言，通过 ' + (results.length - fail) + '，失败 ' + fail);
process.exit(fail ? 1 : 0);

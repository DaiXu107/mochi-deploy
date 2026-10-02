// ===== 常驻回归脚本 #1316：聊天「TA 的心愿」卡——送完礼物按钮不消失 / 旧卡复活重复扣款 =====
// 用法：node tools/verify-1316-wish-card-sent-fact.mjs [被测根目录]
// 症状（用户实报 2026-09-27，红米 K80 Chrome，明说其他设备型号也有出现、要求不要覆盖式修补）：
//   「礼物卡片我已经点击【送他】，但是送完礼物这个按钮还是没有消失。」
// 根因（零机型／零 UA 分支＝判据只取「这一件心愿到底兑现了没有」这一个事实）：卡片上的「已送出」从来不
//   是一个事实，而是两件事的叠加——① 渲染时按「TA 心愿单此刻还有没有这个商品 id」实时推断（同一件商品的
//   每张卡共用同一个 id）；② 成交那一刻给「点按钮时捕获的那个节点」打一次性补丁。纯 HEAD 同尺实测三条：
//   ① 同款商品两张卡买掉一张，另一张永远挂着【送 TA】，再点只剩一句 toast（实测 dom ["0:BUY","1:done"]、
//      余额不再动）；② 中途任何一次整窗重画都让补丁落在脱离文档的旧节点上＝静默失效，礼物已送出、心愿单
//      已没有这件（wishHas:false）而屏上照旧是 BUY，只有刷新才恢复（实测重载后 6:done）；③ TA 日后重新
//      许愿同一件商品时，早已送出的旧卡重新长出【送 TA】，再点一次就再扣一次钱（实测余额 49500→48250、
//      心意柜 2→3 件）。
// 收口：兑现那一刻把事实写进卡片记录（wishSent，随聊天整包落盘），渲染与换装问同一把尺子
//   wishCardIsPending（卡片自己的 wishSent 优先，其次才是实时推断），成交后按新数据逐张重画屏上心愿卡；
//   通知挂在 wishTaRemove（心愿清单被消费掉的唯一收口）上 ⇒ 聊天卡片／市集「☆ 心愿单」面板／直接买下
//   TA 正许愿的那件，三扇门走同一条路。认不出记录的卡片一律不动手（宁可留着按钮也不凭空宣告已送出）。
// RED 基线（纯 HEAD）：S1~S6 缺锚／B1/B2/B4/B6/B7/B9/B10/B11a 全红；两侧同绿＝夹具真实（B0）与旧契约
//   未动（B3 成交链路与扣款次数、B5 重载态、B8 真待买的卡片仍可买、B11b 保守闸不误伤、S7 #919a/#1004/
//   #1313 三把旧针、Z1 零未捕获异常）。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
console.log('被测根目录: ' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean)
  .find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 260) : '')); } };

// ---------------- S 层：逻辑锚（src ＋ 产物双查） ----------------
console.log('S 层：源码与产物锚点');
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const srcChat = rd('src/js/chat.js'), proChat = rd('js/chat.js');
const srcGift = rd('src/js/gift-shop.js'), proGift = rd('js/gift-shop.js');
A('S1 「已送出」是记在这张卡片记录上的事实（wishSent 优先于任何实时推断）',
  srcChat.includes('if (rec.wishSent) return false;') && proChat.includes('if (rec.wishSent) return false;'), null);
A('S2 渲染按同一把尺子判待买（旧的「只看 TA 心愿单此刻」那一行已不在）',
  srcChat.includes('const wStill = wishCardIsPending(rec);') && proChat.includes('const wStill = wishCardIsPending(rec);') && !proChat.includes('const wStill = !window.giftTaWishHas || window.giftTaWishHas(rec.wishGiftId);'), null);
A('S3 成交回调报的是「这件兑现了」，不再改点击时捕获的节点',
  srcChat.includes("window.giftBuyFromWishCard(wRec, function () { chatWishSettled(wRec.wishGiftId); });") && proChat.includes("window.giftBuyFromWishCard(wRec, function () { chatWishSettled(wRec.wishGiftId); });"), null);
A('S4 成交后按新数据逐张重画屏上心愿卡（含同款商品的兄弟卡片）',
  srcChat.includes("document.querySelectorAll('#chat-body .msg-wish')") && proChat.includes("document.querySelectorAll('#chat-body .msg-wish')"), null);
A('S5 认不出记录就不动手（越界／缺 idx 一律不抹）',
  srcChat.includes('if (!isFinite(idx) || idx < 0 || idx >= msgs.length) continue;') && proChat.includes('if (!isFinite(idx) || idx < 0 || idx >= msgs.length) continue;'), null);
A('S6 清单消费掉的唯一收口处通知聊天（三扇门同一条路）',
  srcGift.includes('try { if (window.chatWishSettled) window.chatWishSettled(id); } catch (e) {}') && proGift.includes('try { if (window.chatWishSettled) window.chatWishSettled(id); } catch (e) {}'), null);
A('S6b 一次性节点补丁的旧形态已不在产物（回流＝中途一次重画就让换装落在脱离文档的旧节点上）',
  !proChat.includes("wItem.querySelector('.msg-wish-acts')"), { 在产物出现: proChat.split("wItem.querySelector('.msg-wish-acts')").length - 1 });
A('S7 #919a／#1004／#1313 三把旧针一字未动（本批不碰渲染族）',
  proChat.includes('function chatPumpStalled() {') && proChat.includes("if (batchRendering) chatPumpRescue('resume-heal');") && proChat.includes('if (myToken !== _rwToken) { try { restoreInplaceDrafts(); } catch (e) {}'), null);

// ---------------- B 层：无头行为（真点按钮，走 App 自己的入口） ----------------
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9891 + (process.pid % 40);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1316-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
const C = { pend: new Map(), id: 0, errors: [] };
async function targets() { for (let i = 0; i < 90; i++) { try { const l = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); const p = l.find((t) => t.type === 'page'); if (p) return p; } catch (e) {} await sleep(200); } throw new Error('no cdp'); }
await new Promise(async (res, rej) => { C.ws = new WebSocket((await targets()).webSocketDebuggerUrl); C.ws.onopen = res; C.ws.onerror = rej; });
C.ws.onmessage = (m) => {
  const x = JSON.parse(m.data);
  if (x.method === 'Runtime.exceptionThrown') { try { C.errors.push(String((x.params.exceptionDetails || {}).text || (x.params.exceptionDetails.exception || {}).description || '').slice(0, 140)); } catch (e) {} }
  if (x.id && C.pend.has(x.id)) { C.pend.get(x.id)(x.result); C.pend.delete(x.id); }
};
const cdp = (method, params = {}) => { const id = ++C.id; return new Promise((res) => { C.pend.set(id, res); C.ws.send(JSON.stringify({ id, method, params })); }); };
const JS = async (expr) => { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return 'EVAL_ERR'; return r && r.result ? r.result.value : null; } catch (e) { return 'THROW:' + e.message; } };
const JSONS = async (expr) => { const v = await JS(expr); try { return JSON.parse(v); } catch (e) { return { raw: String(v).slice(0, 120) }; } };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const BOOT = async (clearFirst) => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' }); await sleep(2200);
  for (let i = 0; i < 60; i++) { if (await JS('!!window.__mochiDataReady')) break; await sleep(300); }
  if (clearFirst) {
    await cdp('Page.navigate', { url: 'about:blank' }); await sleep(300);
    await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,service_workers' });
    await cdp('Page.navigate', { url: baseUrl + '/index.html' }); await sleep(2500);
    for (let i = 0; i < 60; i++) { if (await JS('!!window.__mochiDataReady')) break; await sleep(300); }
  }
  await JS("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e2=document.getElementById('splash-enter');if(e2&&!e2.hidden)e2.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return 1;})()");
  await sleep(700);
  await JS("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}return 1;})()");
};
// 播种拆两步，且中间必过一次重载：gift-shop 的 TA 心愿 id 集合是模块级记忆化（#588），失效点只挂在
// wishSave 上，脚本直接写存储不会让它失效——先写清单→重载（新模块态按存储重建集合）→再发卡片，
// 两侧（含纯 HEAD）拿到的都是「卡片确实按 TA 心愿单实时数据长出【送 TA】」这一眼。
const SEED_DATA = (plan) => `(function(){
  try {
    window.chatImportMsgs([]);
    var ids = ${JSON.stringify(plan.map(function (g) { return g.id; }))};
    var uniq = []; ids.forEach(function (id) { if (uniq.indexOf(id) < 0) uniq.push(id); });
    var now = Date.now();
    window.activeStore().set('gift-wishlist-ta', JSON.stringify(uniq.map(function (id) {
      return { giftId: id, name: '心愿' + id, emoji: '📿', img: '', price: 12.5, cat: 'other', wish: '送给你', tm: now };
    })));
    return 'data';
  } catch (e) { return 'ERR:' + e.message; }
})()`;
const SEED_CARDS = (plan) => `(function(){
  try {
    var now = Date.now();
    for (var i = 0; i < 4; i++) window.chatAddGift({ side: 'out', special: 'gift', text: '垫底' + i, giftId: 'x' + i, giftName: '垫底礼物' + i, giftEmoji: '🎁', giftPrice: 1, giftCat: 'other', giftWish: '哈', ts: now - 9000 + i });
    var ids = ${JSON.stringify(plan.map(function (g) { return g.id; }))};
    for (var k = 0; k < ids.length; k++) {
      window.chatAddGift({ side: 'in', special: 'wish', text: '想要「' + ids[k] + '」第' + k + '次', ts: now + k * 30, wishTs: now + k * 30,
        wishGiftId: ids[k], wishGiftName: '心愿' + ids[k], wishGiftEmoji: '📿', wishGiftImg: '', wishGiftPrice: 12.5, wishGiftCat: 'other', wishGiftWish: '送给你' });
    }
    var a = document.querySelector('.app[data-app=chat]'); if (a) a.click();
    return 'cards:' + ids.length;
  } catch (e) { return 'ERR:' + e.message; }
})()`;
const SNAP = `(function(){
  var els = document.querySelectorAll('#chat-body .msg-wish'), out = [];
  els.forEach(function (el) {
    out.push({ idx: el.dataset.idx, buy: !!el.querySelector('.msg-wish-buy'), done: !!el.querySelector('.msg-wish-done') });
  });
  var msgs = window.getChatMsgs(), sent = [];
  msgs.forEach(function (m) { if (m && m.special === 'wish') sent.push(!!m.wishSent); });
  var wl = []; try { wl = JSON.parse(window.activeStore().get('gift-wishlist-ta') || '[]').map(function (x) { return x.giftId; }); } catch (e) {}
  var box = []; try { box = JSON.parse(window.activeStore().get('giftbox-items') || '[]').filter(function (b) { return b.side === 'out'; }); } catch (e) {}
  return JSON.stringify({ cards: out, sentFlags: sent, taWish: wl, bal: window.giftWalletGet().myBalance, boxOut: box.length, n: msgs.length });
})()`;
const tapBuyAt = (i) => `(function(){
  var els = document.querySelectorAll('#chat-body .msg-wish');
  var el = els[${i}]; if (!el) return 'NO_CARD';
  var b = el.querySelector('.msg-wish-buy'); if (!b) return 'NO_BTN';
  b.click();
  return document.getElementById('gb-ok') ? 'panel-open' : 'NO_PANEL';
})()`;
const CONFIRM = `(function(){
  var m = document.getElementById('tc-mask');
  if (!m || m.hidden) return 'NO_PANEL_OPEN';            // 面板没开着就不许点（残留的 #gb-ok 会被误当成成交）
  var b = document.getElementById('gb-ok'); if (!b) return 'NO_OK';
  b.click(); return 'confirmed';
})()`;
// 真·整窗重画：走 App 自己的渲染入口（body 清空重画）＝回场复核／退出重进／分帧构建那一轮
const REBUILD = `(function(){ return window.chatImportMsgs(window.getChatMsgs().slice()) ? 'rebuilt' : 'no'; })()`;

const SETUP = async (plan, label) => {
  const r1 = await JS(SEED_DATA(plan));
  await BOOT(false); await sleep(1300);
  const r2 = await JS(SEED_CARDS(plan));
  console.log('  [' + label + '] ' + r1 + ' / ' + r2);
  await sleep(1400);
};
console.log('B 层：无头行为（真点【送 TA】）');

// ---------- 组 1：同款商品两张卡，买掉一张（症状本体＝另一张的按钮永不消失） ----------
await BOOT(true);
await SETUP([{ id: 'p1' }, { id: 'p1' }], '组1');
const g1a = await JSONS(SNAP);
A('B0 夹具真实：心愿单里一件 p1，聊天里两张 p1 卡各带【送 TA】（两侧同绿＝场景对得上用户所见）',
  g1a.cards.length === 2 && g1a.cards.every(function (c) { return c.buy && !c.done; }) && g1a.taWish.indexOf('p1') >= 0, g1a);
await JS(tapBuyAt(1)); await sleep(300);
await JS(CONFIRM); await sleep(1500);
const g1b = await JSONS(SNAP);
A('B1 成交这一刻：屏上两张同款心愿卡都转成「已送出」（HEAD＝另一张仍挂着【送 TA】＝用户报的那一眼）',
  g1b.cards.length === 2 && g1b.cards.every(function (c) { return c.done && !c.buy; }), g1b.cards);
A('B2 屏上不再残留任何可点的【送 TA】（HEAD 残留那张点了只剩一句 toast、永远不消失）',
  !(await JS("(function(){return !!document.querySelector('#chat-body .msg-wish .msg-wish-buy');})()")), null);
A('B3 成交链路没被改坏：只扣一次钱、心意柜只多一件（两侧同绿）',
  g1a.bal - g1b.bal === 1250 && g1b.boxOut - g1a.boxOut === 1, { d: g1a.bal - g1b.bal, box: g1a.boxOut + '->' + g1b.boxOut });
A('B4 兑现成为一个记在卡片记录上的事实（两张卡的记录都落下 wishSent）',
  g1b.sentFlags.length === 2 && g1b.sentFlags.every(Boolean), g1b.sentFlags);
A('B5 心愿兑现后 TA 心愿单里不再有这件（旧契约未动）', g1b.taWish.indexOf('p1') < 0, g1b.taWish);
await BOOT(false); await sleep(1300);
const g1c = await JSONS(SNAP);
A('B5b 重载后仍是一张不留按钮（两侧同绿：状态是数据推出来的，不靠一次性补丁）',
  g1c.cards.length === 2 && g1c.cards.every(function (c) { return c.done && !c.buy; }), g1c.cards);

// ---------- 组 2：TA 重新许愿同一件商品（旧卡复活＝再点一次再扣一次钱） ----------
await SETUP([{ id: 'p1' }, { id: 'p1' }, { id: 'p2' }], '组2');
// 先把 p1 买掉，再把 p1 放回心愿单（＝TA 隔了些日子重新许愿同一件），并整窗重画
await JS(tapBuyAt(1)); await sleep(250); await JS(CONFIRM); await sleep(1300);
const g2a = await JSONS(SNAP);
await JS("(function(){var s=window.activeStore();var a=JSON.parse(s.get('gift-wishlist-ta')||'[]');a.unshift({giftId:'p1',name:'心愿p1',emoji:'📿',img:'',price:12.5,cat:'other',wish:'送给你',tm:Date.now()});s.set('gift-wishlist-ta',JSON.stringify(a));return 1;})()");
await JS("(function(){try{var t=window.createContact('v1316b');window.setActiveContact(t);window.setActiveContact('default');}catch(e){}return 1;})()");
await BOOT(false); await sleep(1500);
const g2b = await JSONS(SNAP);
A('B6 重新许愿同一件商品之后，早已送出的旧卡不得复活成【送 TA】（HEAD 复活＝用户看到「明明送过了又冒出来」）',
  g2b.cards.filter(function (c, i) { return i < 2; }).every(function (c) { return c.done && !c.buy; }), g2b.cards);
A('B7 真正待买的那张新卡照常带【送 TA】（修复不许把待买的一并抹掉，两侧同绿）',
  g2b.cards.length === 3 && !!g2b.cards[2] && g2b.cards[2].buy === true, g2b.cards);
await JS(tapBuyAt(0)); await sleep(250); await JS(CONFIRM); await sleep(1300);
const g2c = await JSONS(SNAP);
A('B8 旧卡复活那一下不得再扣一次钱（HEAD 复活的后果＝余额再减 12.50、心意柜多一件重复记录）',
  g2c.bal === g2b.bal && g2c.boxOut === g2b.boxOut, { bal: g2b.bal + '->' + g2c.bal, box: g2b.boxOut + '->' + g2c.boxOut });

// ---------- 组 3：成交那一刻屏上刚换过一批节点（一次性补丁落在旧节点上） ----------
await SETUP([{ id: 'p3' }], '组3');
const g3pre = await JSONS(SNAP);
A('B9a 夹具真实：组3 的 p3 心愿卡确实在屏上且带【送 TA】（两侧同绿）',
  g3pre.cards.length === 1 && g3pre.cards[0].buy === true && g3pre.taWish.indexOf('p3') >= 0, g3pre.cards);
const bal3 = (await JSONS(SNAP)).bal;
await JS(tapBuyAt(0)); await sleep(300);
await JS(REBUILD); await sleep(1500);
const g3mid = await JSONS(SNAP);
await JS(CONFIRM); await sleep(1500);
const g3b = await JSONS(SNAP);
A('B9 弹窗期间发生过整窗重画（回场复核／退出重进那一轮），成交后卡片照样当场转「已送出」（HEAD＝补丁落在脱离文档的旧节点上，屏上仍是 BUY 而心愿单已没有这件，只有刷新才好）',
  g3mid.cards.length === 1 && g3mid.cards[0].buy === true && g3b.cards.length === 1 && g3b.cards[0].done === true && !g3b.cards[0].buy, { 重画后: g3mid.cards, 成交后: g3b.cards });
A('B9b 这一发确实扣了钱、心愿也确实从清单里掉了（不是靠「没买成」装出来的绿）',
  bal3 - g3b.bal === 1250 && g3b.taWish.indexOf('p3') < 0, { d: bal3 - g3b.bal, wl: g3b.taWish });

// ---------- 组 4：另一扇门——市集「☆ 心愿单」面板里点送 TA，聊天里的卡片也要当场收 ----------
await SETUP([{ id: 'p4' }], '组4');
await JS("(function(){var a=document.querySelector('.app[data-app=market]');if(a)a.click();return 1;})()"); await sleep(900);
await JS("(function(){var b=document.getElementById('market-wish');if(b)b.click();return !!b;})()"); await sleep(900);
await JS("(function(){var t=document.querySelector('#tc-body [data-wtab=ta]');if(t)t.click();return !!t;})()"); await sleep(700);
const panelOk = await JS("(function(){var b=document.querySelector('#tc-body [data-wbuy]');if(!b)return 'NO_ROW';b.click();return document.getElementById('gb-ok')?'buy-panel':'NO_PANEL';})()");
await sleep(400); await JS(CONFIRM); await sleep(1500);
const g4b = await JSONS(SNAP);
A('B10 从市集心愿单面板买下 TA 正许愿的这件，聊天里同款心愿卡也当场收成「已送出」（HEAD＝聊天那张要等下一次整窗重画，中途用户看到的就是「送完了按钮还在」）',
  panelOk === 'buy-panel' && g4b.cards.length === 1 && g4b.cards[0].done === true && !g4b.cards[0].buy, { panelOk: panelOk, cards: g4b.cards });

// ---------- 组 5：保守闸——认不出记录的卡片绝不凭空抹成已送出 ----------
await JS("(function(){var b=document.getElementById('tc-mask');if(b)b.hidden=true;return 1;})()");
await SETUP([{ id: 'p5' }], '组5');
const hasFn = await JS("(function(){return typeof window.chatWishSettled === 'function';})()");
A('B11a 聊天侧的「这件心愿兑现了」收口函数在位（gift-shop 三扇门都经它；缺席即红）', hasFn === true, hasFn);
const g5 = await JS("(function(){\
  var el=document.querySelector('#chat-body .msg-wish'); if(!el) return 'NO_CARD';\
  el.dataset.idx='99999';\
  if (window.chatWishSettled) window.chatWishSettled('p5');\
  var still=document.querySelector('#chat-body .msg-wish');\
  return JSON.stringify({buy: !!(still && still.querySelector('.msg-wish-buy')), done: !!(still && still.querySelector('.msg-wish-done'))});\
})()");
const g5o = (function () { try { return JSON.parse(g5); } catch (e) { return { raw: String(g5).slice(0, 120) }; } })();
A('B11b 窗口下标漂移／认不出记录的那张卡不动手（宁可留着按钮，也不凭空宣告已送出，两侧同绿）',
  g5o && g5o.buy === true && g5o.done === false, g5o);

const errs = C.errors.slice(0, 6);
A('Z1 全程零未捕获异常（两侧同绿）', errs.length === 0, errs);

console.log('\n通过 ' + pass + ' / 断言失败 ' + fail);
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { require('fs').rmSync(join(process.env.TEMP || '/tmp', 'mochi-1316-' + Date.now()), { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);

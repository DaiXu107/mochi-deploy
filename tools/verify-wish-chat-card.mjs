// ===== 回归验证：#660「TA 把商品放进清单时有概率发到聊天，让我给 TA 买」=====
// 用法：node tools/verify-wish-chat-card.mjs   （自组装 src，不依赖构建产物）
// 需求（用户 2026-09-17 直派）：「心意集市里还缺少功能：联系人把商品放入清单的时候，有概率
//   发送到聊天里，让我给 TA 买。默认开启，并且要在心意集市及心意柜设置里清楚概率，也可以开关。」
// 落点：TA 把商品加进【TA 自己的心愿单】那一刻（maybeAutoGift ③），按「TA 的心愿发到聊天」
//   开关 + 概率发一张 special:'wish' 卡片进聊天；卡片上的【送 TA】复用市集购买链路买下送出，
//   成交后卡片就地转「已送出」（待买/已送出按 TA 心愿单实时数据判定，记录里不写状态）。
// RED 基线：拿掉 ③ 里的按概率发卡 / 渲染分支 / 设置两行 / 缓存按桌面隔离 任一处，对应断言必红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? ' \u2014 ' + extra : '')); }
};

// ---------------- S 层：源码断言 ----------------
console.log('S 层：源码口径');
{
  const gs = readFileSync(join(root, 'src/js/gift-shop.js'), 'utf8');
  const cj = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
  const css = readFileSync(join(root, 'src/css/market.css'), 'utf8');
  const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
  ok(/wishChatOn: s\.wishChatOn === 0 \? 0 : 1/.test(gs), 'S1 「TA 的心愿发到聊天」开关默认开启（未设置过＝1）');
  ok(/wishChatPct: clampPct\(s\.wishChatPct, 60\)/.test(gs), 'S2 默认概率 60 可被设置覆盖');
  ok(/const pushed = !!\(quotaLeft && st\.wishChatOn && Math\.random\(\) \* 100 < st\.wishChatPct && wishChatPush\(giftW\)\);/.test(gs),
    'S3 TA 把商品加进清单那一步按「当日张数＋开关＋概率」决定是否发卡（#1437 补额度这一道闸）');
  ok(/else if \(quotaLeft\) toast\(partnerName\(\) \+ ' 把「' \+ giftW\.name/.test(gs),
    'S4 发了卡就不再叠旧 toast；当天张数用完那次连 toast 一并静默（#1437 作者点口径）');
  ok(/function wishChatPush\(gift\) \{/.test(gs), 'S5 发卡函数存在');
  ok(/window\.chatAddGift\(\{/.test(gs) && /special: 'wish'/.test(gs), 'S6 卡片经 chatAddGift 落聊天（special:wish）');
  ok(/wishGiftId: gift\.id, wishGiftName: gift\.name/.test(gs), 'S7 卡片自带商品快照字段（商品日后改动不影响已发卡片）');
  ok(/window\.giftTaWishHas = function \(id\)/.test(gs), 'S8 暴露「这件还在 TA 心愿单里吗」给聊天渲染');
  ok(/window\.giftBuyFromWishCard = function \(rec, done\)/.test(gs), 'S9 暴露卡片【送 TA】入口');
  ok(/openBuyDialog\(\{[\s\S]{0,400}\}, \{ fromTaWish: true, onDone: done \}\);/.test(gs), 'S10 入口复用市集购买弹窗并带成交回调');
  ok(/if \(opts\.onDone\) \{ try \{ opts\.onDone\(\); \} catch \(e\) \{\} \}/.test(gs), 'S11 购买成功才回调（取消/失败不误标已送出）');
  ok(/data-gsw="wishChatOn"/.test(gs), 'S12 设置面板有开关行');
  ok(/data-gsn="wishChatPct"/.test(gs), 'S13 设置面板有概率行');
  ok(/const hi = Number\(inp\.max\) \|\| 100;/.test(gs) && /toast\('请填 0~' \+ hi \+ ' 的整数'\);/.test(gs), 'S14 概率输入沿用非法值保护（不清空写 0；#1437 起封顶问输入框自己的 max）');
  ok(/function taWishIds\(\) \{[\s\S]{0,260}_taWishIdsFor !== tag/.test(gs), 'S15 TA 心愿 id 缓存按桌面打标（切联系人不再张冠李戴）');
  ok(/if \(rec\.special === 'wish'\) \{/.test(cj), 'S16 聊天有 TA 心愿卡渲染分支');
  // ⚠️ #1316 重锚（同名换 needle，不算缩尺）：#660 当年把「待买/已送出」全押在「TA 心愿单此刻还有没有
  //   这件商品」的实时推断上，同一件商品的多张心愿卡因此共用一个状态、成交又只给「点击时捕获的那个节点」
  //   打一次性补丁（红米 K80 实报「送完礼物按钮还是没消失」）。现在两把判据合成一把：卡片自己的 wishSent
  //   优先，其次才是实时推断；换装按新数据逐张做。旧 needle 在新形态下必然消失，本条改成认新那一行。
  ok(/const wStill = wishCardIsPending\(rec\);/.test(cj) && /return !window\.giftTaWishHas \|\| window\.giftTaWishHas\(rec\.wishGiftId\);/.test(cj), 'S17 待买/已送出按「卡片自己记的 wishSent ＋ TA 心愿单实时数据」这一把尺子判定（#1316 重锚）');
  ok(/!window\.giftBuyFromWishCard\) \{ toast[\s\S]{0,80}\nwindow\.giftBuyFromWishCard\(wRec/.test(cj), 'S18 【送 TA】点击走 gift-shop 入口（并入既有卡片点击委派）');
  // ⚠️ #1316 重锚：成交换装不再抓「点击时捕获的那个节点」（中途任何一次整窗重画都会让补丁落在脱离文档
  //   的旧节点上＝静默失效，只有刷新才好），改为报出「这件心愿兑现了」＋按新数据逐张就地换装（仍不整窗重建）。
  ok(/if \(acts\) acts\.outerHTML = wishDoneHtml\(\);/.test(cj) && /window\.giftBuyFromWishCard\(wRec, function \(\) \{ chatWishSettled\(wRec\.wishGiftId\); \}\);/.test(cj), 'S19 成交后按新数据逐张就地转已送出（不整窗重建，#1316 重锚）');
  // ⚠️ #1347 重锚：#660 当年这条抓的是【卡片类型名白名单】的尾巴（'gift' || rec.special === 'wish'），
  // 而那层名单本批整撤了换成结构判据（in 侧内容 − 纯状态回声）——心愿卡的契约由这条更宽的判据承接，
  // 断言随之改成认新判据（不是放宽：名单复活时这一行消失＝照样红）。行为面另有
  // tools/verify-1347-badge-covers-cards.mjs 的 A11 真投递断言守着，不只靠文本锚。
  ok(/const notable = rec\.side === 'in' && rec\.special !== 'read';/.test(cj), 'S20 TA 心愿卡并入「值得提醒」消息（未读角标/桌面横幅；#1347 起由整类结构判据承接）');
  ok(/else if \(special === 'wish'\) \{ q = \(rec\.wishGiftName/.test(cj), 'S21 收藏快照覆盖心愿卡（心形不是点了没反应）');
  ok(/\.msg-wish-buy \{/.test(css), 'S22 卡片按钮样式在位');
  ok(/TA 心愿发到聊天概率/.test(gs), 'S23 使用说明/行标题点明概率可调');
  ok(/TA 逛市集时会把想要的加进自己的心愿单，并按概率把这份心愿发一张卡片到聊天/.test(tpl), 'S24 功能介绍页补了这条（用户可感知功能文案同步）');
}

// ---------------- B 层：无头 Chrome 行为 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arrOf = (k) => (bm.match(new RegExp(k + '\\s*=\\s*\\[([\\s\\S]*?)\\]')) || [])[1]
  .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => {
  let code = '';
  try { code = readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) {}
  return '(function(){try{\n' + code + '\n}catch(__e){if(window.__jsErrors)window.__jsErrors.push("' + f + ':"+(__e&&__e.message||__e));}})();';
}).join('\n'));

const site = join(tmpdir(), 'mochi-wishchat-' + Date.now());
const profDir = join(tmpdir(), 'mochi-wishchat-prof-' + Date.now());
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'index.html'), html);
const server = createServer((req, res) => {
  try {
    const p = normalize(join(site, decodeURIComponent(req.url.split('?')[0])));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9790 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
let booted = false;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); booted = true; break; }
  } catch (e) {}
  await sleep(150);
}
if (!booted) { console.error('无法连接无头 Chrome'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return '__ERR__' + JSON.stringify(r.exceptionDetails).slice(0, 300);
  return r && r.result ? r.result.value : null;
}
const goto = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) { if ((await evalJs('!!window.__mochiDataReady')) === true) return true; await sleep(250); }
  return false;
};
const finish = () => { try { chrome.kill(); } catch (e) {} try { server.close(); } catch (e) {} try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {} try { rmSync(site, { recursive: true, force: true }); } catch (e) {} };

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
if (!(await goto())) { console.error('应用未就绪'); finish(); process.exit(1); }
await sleep(1000);

// 只留「③ TA 加自己的心愿单」这条路径可掷中：其余分支概率归 0，保证断言确定性
const ONLY_ADD_WISH = (extra) => Object.assign({
  wlVer: 2, giftInOn: 0, giftInPct: 0, wlOn: 1, wlBuyPct: 0, wlAddPct: 100,
  wishChatOn: 1, wishChatPct: 100, selfOn: 0, selfPct: 0
}, extra || {});
const setRawSettings = (obj) => evalJs(`(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', ${JSON.stringify(JSON.stringify(obj))}); return 1; })()`);
const readSettings = () => evalJs("(function(){ try { return window.xyStore('xy-home-v2').get('market-wl-settings') || ''; } catch(e){ return ''; } })()");
const openChat = () => evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');}); var a=document.querySelector('.app[data-app=chat]'); if(a)a.click(); return 1; })()");
// 从存储读（不读 DOM）：聊天 DOM 会被上个桌面/上个状态污染，判行为只看落库事实
const storeOf = (cid) => evalJs(`(function(){
  var s = window.storeFor(${JSON.stringify(cid || 'default')});
  var msgs = []; try { msgs = JSON.parse(s.get('chat-msgs')||'[]'); } catch(e){}
  var wl = []; try { wl = JSON.parse(s.get('gift-wishlist-ta')||'[]'); } catch(e){}
  var box = []; try { box = JSON.parse(s.get('giftbox-items')||'[]'); } catch(e){}
  var cards = msgs.filter(function(m){ return m && m.special === 'wish'; });
  return JSON.stringify({
    wishCards: cards.length,
    lastCard: cards.length ? cards[cards.length-1] : null,
    giftBubbles: msgs.filter(function(m){ return m && m.special === 'gift'; }).length,
    taWish: wl.map(function(x){ return x.giftId; }),
    boxOut: box.filter(function(b){ return b.side === 'out'; }).length,
    boxIn: box.filter(function(b){ return b.side === 'in'; }).length
  });
})()`);
const cardDom = () => evalJs(`(function(){
  var els = document.querySelectorAll('#chat-body .msg-wish');
  var el = els.length ? els[els.length-1] : null;
  return JSON.stringify({
    cards: els.length,
    hasBuy: !!(el && el.querySelector('.msg-wish-buy')),
    done: !!(el && el.querySelector('.msg-wish-done')),
    tag: el && el.querySelector('.msg-wish-tag') ? el.querySelector('.msg-wish-tag').textContent : '',
    name: el && el.querySelector('.msg-gift-name') ? el.querySelector('.msg-gift-name').textContent : '',
    price: el && el.querySelector('.msg-gift-price') ? el.querySelector('.msg-gift-price').textContent : '',
    inBody: !!document.getElementById('chat-body')
  });
})()`);
const wallet = () => evalJs("(function(){ var w = window.giftWalletGet(); return JSON.stringify({ my: w.myBalance, ta: w.systemBalance }); })()");

console.log('B 层：无头行为');

// ---- B1/B2/B3：默认开启 + 概率 100 → TA 加心愿单时卡片落进聊天 ----
await setRawSettings(ONLY_ADD_WISH({}));
if (!(await goto())) { console.error('冷启动未就绪'); finish(); process.exit(1); }
await sleep(900);
await openChat();
await sleep(400);
await evalJs('window.maybeAutoGift()');
await sleep(500);
const st1 = JSON.parse(await storeOf());
const dom1 = JSON.parse(await cardDom());
ok(st1.wishCards === 1, 'B1 TA 把商品加进自己心愿单时卡片落进聊天记录', JSON.stringify(st1).slice(0, 200));
ok(st1.lastCard && st1.lastCard.wishGiftId && st1.lastCard.wishGiftName, 'B2 卡片带商品快照（id + 名字）', JSON.stringify(st1.lastCard || {}).slice(0, 200));
ok(st1.lastCard && String(st1.lastCard.text || '').indexOf('想要') === 0, 'B3 卡片正文是可读的心愿话术（桌面横幅预览同源）', String(st1.lastCard && st1.lastCard.text));
ok(dom1.cards === 1 && dom1.hasBuy, 'B4 聊天里渲染出心愿卡且带【送 TA】按钮', JSON.stringify(dom1));
ok(dom1.name === (st1.lastCard || {}).wishGiftName, 'B5 卡片显示商品名（与记录一致）', dom1.name + ' / ' + (st1.lastCard || {}).wishGiftName);
ok(/^\u00A5\d/.test(String(dom1.price)), 'B6 卡片显示价格', String(dom1.price));

// ---- B7：总开关关掉 → 只加心愿单、不发卡（旧 toast 路径回落） ----
await setRawSettings(ONLY_ADD_WISH({ wishChatOn: 0 }));
await evalJs('window.maybeAutoGift()');
await sleep(400);
{
  const s = JSON.parse(await storeOf());
  ok(s.wishCards === 1, 'B7 关闭开关后不再发新卡（旧卡不受影响）', JSON.stringify(s).slice(0, 120));
  ok(s.taWish.length === 2, 'B8 关掉发卡不影响「TA 把商品加进自己心愿单」本身', JSON.stringify(s.taWish));
}

// ---- B9：概率 0 → 同样不发卡 ----
await setRawSettings(ONLY_ADD_WISH({ wishChatPct: 0 }));
await evalJs('window.maybeAutoGift()');
await sleep(400);
{
  const s = JSON.parse(await storeOf());
  ok(s.wishCards === 1, 'B9 概率调 0 后不再发新卡', JSON.stringify(s).slice(0, 120));
  ok(s.taWish.length === 3, 'B10 概率 0 也不影响心愿单本身', JSON.stringify(s.taWish));
}

// ---- B11/B12：默认值（未设置过的用户）＝开关开、概率 60；设置面板两行在位且可改 ----
await evalJs("(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', JSON.stringify({ wlVer: 2 })); return 1; })()");
await setRawSettings({ wlVer: 2 });
await evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); var a=document.querySelector('.app[data-app=\"market\"]'); if(a)a.click(); return 1; })()");
await sleep(700);
await evalJs("(function(){ var b=document.getElementById('market-settings'); if(b) b.click(); return !!b; })()");
await sleep(500);
{
  const r = await evalJs(`(function(){
    var sw = document.querySelector('#tc-body [data-gsw="wishChatOn"]');
    var inp = document.querySelector('#tc-body [data-gsn="wishChatPct"]');
    if (!sw || !inp) return 'NO_ROW';
    var before = { on: sw.classList.contains('on'), pct: inp.value };
    sw.click();
    inp.value = '25';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    var raw = null; try { raw = JSON.parse(window.xyStore('xy-home-v2').get('market-wl-settings')||'')||null; } catch(e){}
    return JSON.stringify({ before: before, saved: raw });
  })()`);
  const o = r === 'NO_ROW' ? null : JSON.parse(r);
  ok(!!o, 'B11 设置面板「TA 的心愿发到聊天」开关 + 概率行在位', String(r).slice(0, 160));
  ok(!!o && o.before.on === true, 'B12 未设置过的用户默认开启', String(r).slice(0, 160));
  ok(!!o && o.before.pct === '60', 'B13 默认概率 60（设置里可见可改）', String(r).slice(0, 160));
  ok(!!o && o.saved && o.saved.wishChatOn === 0, 'B14 开关可关掉并落库', String(r).slice(0, 200));
  ok(!!o && o.saved && o.saved.wishChatPct === 25, 'B15 概率改 25 落库', String(r).slice(0, 200));
}

// ---- B16/B17：点【送 TA】→ 市集购买弹窗 → 成交后礼物进聊天/心意柜、TA 心愿单移除、卡片转已送出 ----
await setRawSettings(ONLY_ADD_WISH({}));
await evalJs("(function(){ if (window.closeTc) window.closeTc(); document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); var a=document.querySelector('.app[data-app=\"market\"]'); if(a)a.click(); return 1; })()");
await sleep(300);
await evalJs("(function(){ var m=document.getElementById('tc-mask'); if(m) m.hidden=true; return 1; })()");
await openChat();
await sleep(400);
{
  const before = JSON.parse(await storeOf());
  const targetId = (before.lastCard || {}).wishGiftId;                           // 买的就是这张卡对应的那件
  const priceFen = Math.round(Number((before.lastCard || {}).wishGiftPrice || 0) * 100);
  ok(before.taWish.indexOf(targetId) >= 0, 'B16 卡片对应的商品确实在 TA 心愿单里（点【送 TA】的前置条件）', JSON.stringify(before.taWish));
  await evalJs(`(function(){ var b = document.querySelector('#chat-body .msg-wish-buy'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  const panel = await evalJs(`(function(){
    var ok = document.getElementById('gb-ok');
    var svg = document.querySelector('#tc-body .gb-preview');
    var wishTa = document.getElementById('gb-wishbtn');
    return JSON.stringify({ hasOk: !!ok, preview: !!svg, noWishBtn: !wishTa, maskOpen: !document.getElementById('tc-mask').hidden });
  })()`);
  const p1 = JSON.parse(panel);
  ok(p1.hasOk && p1.preview && p1.maskOpen, 'B17 点【送 TA】打开的是市集购买弹窗（复用同一链路）', panel);
  ok(p1.noWishBtn === true, 'B18 从心愿卡进来的是「送 TA」语义（不带自己加入心愿单按钮）', panel);
  const wBefore = JSON.parse(await wallet());
  await evalJs("(function(){ var b=document.getElementById('gb-ok'); if(b) b.click(); return !!b; })()");
  await sleep(700);
  const after = JSON.parse(await storeOf());
  const wAfter = JSON.parse(await wallet());
  const domAfter = JSON.parse(await cardDom());
  ok(after.giftBubbles === before.giftBubbles + 1, 'B19 买下后礼物卡片飞进聊天', before.giftBubbles + ' -> ' + after.giftBubbles);
  ok(after.boxOut === before.boxOut + 1, 'B20 礼物同步进心意柜-送出的', before.boxOut + ' -> ' + after.boxOut);
  ok(after.taWish.indexOf(targetId) < 0, 'B21 送出后自动从 TA 心愿单移除（心愿兑现）', JSON.stringify(after.taWish) + ' / ' + targetId);
  // 「我送 TA」走 out 侧＝扣我的余额（TA 余额只在 TA 送我时动）
  ok(wBefore.my - wAfter.my === priceFen, 'B22 扣的正是这件礼物的价钱（out 侧＝我的余额）', wBefore.my + ' -> ' + wAfter.my + ' / ' + priceFen);
  ok(domAfter.done === true && domAfter.hasBuy === false, 'B23 卡片就地转「已送出」，不再显示【送 TA】', JSON.stringify(domAfter));
}

// ---- B24/B25：刷新后重进聊天，已送出的卡片仍是「已送出」（状态按数据判定，不靠一次性 DOM 补丁） ----
if (!(await goto())) { console.error('二次冷启动未就绪'); finish(); process.exit(1); }
await sleep(900);
await evalJs("(function(){ var a=document.querySelector('.app[data-app=chat]'); if(a)a.click(); return !!a; })()");
await sleep(800);
{
  const d = JSON.parse(await cardDom());
  const s = JSON.parse(await storeOf());
  ok(d.cards === 1 && d.done === true && d.hasBuy === false, 'B24 冷启动重进聊天：已送出的卡片仍显示已送出（无【送 TA】）', JSON.stringify(d));
  ok(s.wishCards === 1, 'B25 卡片记录只此一张（未重复发）', JSON.stringify(s).slice(0, 120));
}

// ---- B26~B28：TA 心愿单缓存按桌面隔离（切联系人后不得拿上一个桌面的 id 判待买/已送出） ----
{
  await setRawSettings(ONLY_ADD_WISH({ wishChatOn: 0 }));   // 只加心愿、不发卡，单看数据口径
  await evalJs('window.maybeAutoGift()');
  await sleep(400);
  const idA = JSON.parse(await storeOf()).taWish[0];         // 刚 unshift 进去的那件
  const onA = await evalJs(`window.giftTaWishHas(${JSON.stringify(idA)})`);
  const tmpCid = await evalJs("(function(){ var id = window.createContact('心愿卡验证桌面'); return id; })()");
  await evalJs(`(function(){ window.setActiveContact(${JSON.stringify(tmpCid)}); return 1; })()`);
  await sleep(700);
  const onB = await evalJs(`window.giftTaWishHas(${JSON.stringify(idA)})`);
  await evalJs("(function(){ window.setActiveContact('default'); return 1; })()");
  await sleep(700);
  const backA = await evalJs(`window.giftTaWishHas(${JSON.stringify(idA)})`);
  ok(onA === true, 'B26 A 桌面上这件心愿认得出（待买态正确）', String(onA) + ' / ' + idA);
  ok(onB === false, 'B27 切到没许过愿的桌面后不认这件心愿（旧实现缓存跨桌面复用＝错判已送出）', String(onB));
  ok(backA === true, 'B28 切回 A 桌面读取恢复正确（缓存按桌面重建）', String(backA));
}

{
  const errs = await evalJs('JSON.stringify((window.__jsErrors||[]).slice(0,5))');
  ok(errs === '[]', 'B29 全程零 JS 错误', String(errs));
}

console.log('\n通过 ' + pass + ' / 断言失败 ' + fail);
finish();
process.exit(fail ? 1 : 0);

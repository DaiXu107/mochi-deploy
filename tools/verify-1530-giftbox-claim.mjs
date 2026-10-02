// ===== 常驻回归 #1530：心意柜详情里的【领取】（用户报障「心意柜里的礼物显示待领取，无法点击领取」，多机型同现）=====
// 根因：领取动作从 #985 起只挂在聊天礼物卡上（giftCardActsInner 需要卡带 giftBoxId 且能读到柜记录），
// 心意柜点开详情只有「待领取」徽标、没有任何领取动作——聊天卡被删／丢 giftBoxId／聊天清空后，
// 柜里这件永远「待领取」且无路可领。多机型同现＝逻辑缺口，不是机型问题。
// 修法（#1530）：心意柜详情面板对 boxPending 那件渲染【领取】（复用 .msg-gift-claim 视觉），
// 走 giftBoxMarkClaimed 既有写回路（单一事实源仍是柜记录）→ 就地换「✓ 已领取」＋重画列表；
// chat.js 新增 chatGiftClaimSync：按 giftBoxId 把屏上聊天卡 giftPatchCard 就地重画＋补聊天留痕
// 「你收下了 …」（rateAllow 同 #1341 口径，额度满不吞）。
// 断言组：
//   S  源码口径（详情按钮只对 boxPending 出、幂等守卫、既有写回路、同步钩子、留痕带 rateAllow、容器样式）
//   B1 联系人送我礼物（真实链路）→ 心意柜那件待领取；点开详情出现【领取】
//   B2 点详情【领取】→ 按钮就地转「✓ 已领取」、柜记录 claimed:1、列表卡待领取徽标消失
//   B3 聊天侧同步：卡片就地转已领取（无【领取】钮）＋聊天留痕「你收下了 …」
//   B4 本批主场景：孤儿柜记录（柜里 claimed:0 但聊天卡不存在）→ 详情照领：claimed:1＋留痕＋零异常
//   B5 反向守卫：已领取（claimed:1）的详情不出【领取】；side:'self' 带 claimed:0 也不出（防放宽）
//   Z1 全程零未捕获 JS 异常
// 红基线（纯 HEAD 副本）预期：S 全红；B1 前 3 条绿（旧版也有礼物与待领取徽标）、详情按钮起红；
// B2/B3/B4 红；B5 两条绿（旧版本来就不出按钮＝控制项）。
// 用法：node tools/verify-1529-giftbox-claim.mjs            （自组装 src，不依赖构建产物）
//       MOCHI_ROOT=<仓外副本> node tools/verify-1529-giftbox-claim.mjs   （红/绿对照必传）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => { try { return JSON.parse(v); } catch (e) { return null; } };

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
  const mc = readFileSync(join(root, 'src/css/market.css'), 'utf8');
  ok(/boxPending\(it\) \? '<div class="gb-detail-claim"><button class="msg-gift-claim" type="button" data-gb-claim="' \+ esc\(it\.id\) \+ '">领取<\/button><\/div>'/.test(gs),
    'S1 详情面板只对 boxPending 那件渲染【领取】（复用聊天卡按钮视觉）');
  ok(/if \(!boxPending\(it\)\) return; \/\/ 已领取＝幂等/.test(gs),
    'S2 领取处理器带幂等守卫（旧面板残留按钮不重复记账）');
  ok(/if \(!window\.giftBoxMarkClaimed \|\| !window\.giftBoxMarkClaimed\(it\.id\)\)/.test(gs) &&
     /renderBox\(\); \/\/ 柜列表就地转已领取/.test(gs),
    'S3 柜内领取走 giftBoxMarkClaimed 既有写回路＋领后重画列表（单一事实源仍在柜）');
  ok(/if \(window\.chatGiftClaimSync\) window\.chatGiftClaimSync\(it\.id, it\.name\)/.test(gs),
    'S4 领后调回聊天侧同步钩子（卡片重画＋留痕）');
  ok(/window\.chatGiftClaimSync = function \(boxId, giftName\) \{/.test(cj) &&
     /if \(r && r\.special === 'gift' && r\.giftBoxId === boxId\) \{ giftPatchCard\(i\); if \(!rec\) rec = r; \}/.test(cj),
    'S5 聊天侧按 giftBoxId 就地补卡（giftPatchCard，不写任何状态）');
  ok(/addIn\('你收下了 ' \+ \(\(rec && rec\.giftName\) \|\| giftName \|\| '礼物'\), \{ special: 'poke', rateAllow: true \}\)/.test(cj),
    'S6 留痕与卡上领取同款文案且带 rateAllow（额度满不被 #1341 闸吞）');
  ok(/\.gb-detail-claim \{ display: flex; margin-top: 16px; \}/.test(mc),
    'S7 详情领取钮容器样式在位（面板居中布局里按钮整行撑满）');
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

const site = join(tmpdir(), 'mochi-g1529-' + Date.now());
const profDir = join(tmpdir(), 'mochi-g1529-prof-' + Date.now());
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9720 + Math.floor(Math.random() * 60));
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
const finish = () => {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
  try { rmSync(site, { recursive: true, force: true }); } catch (e) {}
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
if (!(await goto())) { console.error('应用未就绪'); finish(); process.exit(1); }
await sleep(1000);

// 只留「① 心愿单兑现」这条可掷中的路径（同 verify-985 口径）
const BASE = { wlVer: 2, wlOn: 1, giftInOn: 1, wlBuyPct: 100, wlAddPct: 0, giftInPct: 0, selfOn: 0, selfPct: 0, wishChatOn: 0, wishChatPct: 0, giftReplyOn: 0, giftReplyPct: 0, giftReplyMode: 0 };
const setSettings = (extra) => evalJs(`(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', ${JSON.stringify(JSON.stringify(Object.assign({}, BASE, extra || {})))}); return 1; })()`);
const MY_WISH = [{ giftId: 'g_v1529a', name: '验证蜡烛', emoji: '\uD83D\uDD6F\uFE0F', img: '', price: 88, cat: 'gcare', wish: '给你暖暖的', tm: Date.now() }];
const setMyWish = (list) => evalJs(`(function(){ window.activeStore().set('gift-wishlist', ${JSON.stringify(JSON.stringify(list))}); return 1; })()`);
const waitFor = async (fn, ms) => {
  const t0 = Date.now();
  let v = await fn();
  while (!v && Date.now() - t0 < (ms || 6000)) { await sleep(250); v = await fn(); }
  return v;
};
const openChat = () => evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');}); var a=document.querySelector('.app[data-app=chat]'); if(a)a.click(); return 1; })()");
const openBoxPage = () => evalJs("(function(){ var a=document.querySelector('.app[data-app=giftbox]'); if(!a) return 0; a.click(); return 1; })()");
const chatState = (cid) => evalJs(`(function(){
  var s = window.storeFor(${JSON.stringify(cid || 'default')});
  var msgs = []; try { msgs = JSON.parse(s.get('chat-msgs')||'[]'); } catch(e){}
  var gifts = msgs.filter(function(m){ return m && m.special === 'gift'; });
  var last = gifts.length ? gifts[gifts.length-1] : null;
  return JSON.stringify({
    gifts: gifts.length,
    lastBoxId: last ? (last.giftBoxId || '') : '',
    pokes: msgs.filter(function(m){ return m && m.special === 'poke'; }).map(function(m){ return String(m.text||''); })
  });
})()`);
const boxState = (cid) => evalJs(`(function(){
  var s = window.storeFor(${JSON.stringify(cid || 'default')});
  var box = []; try { box = JSON.parse(s.get('giftbox-items')||'[]'); } catch(e){}
  return JSON.stringify(box.map(function(b){ return { id: b.id, side: b.side, name: b.name, claimed: (b.claimed === undefined ? null : b.claimed) }; }));
})()`);
// 心意柜列表卡（按 id）与详情面板
const boxCardDom = (id) => evalJs(`(function(){
  var c = document.querySelector('#giftbox-list .giftbox-card[data-id="${id}"]');
  if (!c) return JSON.stringify({ found: false });
  return JSON.stringify({ found: true, pending: !!c.querySelector('.giftbox-pending'), name: (c.querySelector('.giftbox-name')||{}).textContent || '' });
})()`);
const openBoxDetail = async (id) => {
  await evalJs(`(function(){ var c=document.querySelector('#giftbox-list .giftbox-card[data-id="${id}"]'); if(c)c.click(); return !!c; })()`);
  await sleep(400);
};
const detailDom = () => evalJs(`(function(){
  var body = document.getElementById('tc-body');
  if (!body) return JSON.stringify({ found: false });
  var btn = body.querySelector('button[data-gb-claim]');
  return JSON.stringify({
    open: !!(document.getElementById('tc-mask') && !document.getElementById('tc-mask').hidden),
    hasClaim: !!btn,
    claimId: btn ? btn.dataset.gbClaim : '',
    got: body.querySelector('.msg-gift-got') ? String(body.querySelector('.msg-gift-got').textContent) : '',
    pending: !!body.querySelector('.gb-detail-pending')
  });
})()`);
const closePanel = () => evalJs("(function(){ var b=document.getElementById('tc-mask-close'); if(b)b.click(); return 1; })()");
const waitBoxClaimed = (id) => waitFor(async () => { const l = J(await boxState()) || []; return l.some((x) => x.id === id && x.claimed === 1); }, 6000);
const waitPoke = (txt) => waitFor(async () => { const c = J(await chatState()) || {}; return (c.pokes || []).some((t) => String(t).indexOf(txt) >= 0); }, 6000);

console.log('B 层：无头行为');
try {

// ---- B1：真实链路（TA 买下我的心愿送我）→ 柜里那件待领取；点开详情出现【领取】 ----
await setSettings({});
await setMyWish(MY_WISH);
if (!(await goto())) { console.error('冷启动未就绪'); finish(); process.exit(1); }
await sleep(900);
await openChat();
await sleep(300);
await evalJs('window.maybeAutoGift()');
const gotGift = await waitFor(async () => { const c = J(await chatState()); return c && c.gifts === 1 && c.lastBoxId; }, 9000);
{
  const c = J(await chatState());
  const b = J(await boxState()) || [];
  ok(!!gotGift, 'B1 联系人送我的礼物进聊天并带心意柜指针', JSON.stringify(c));
  const inBox = b.filter((x) => x.side === 'in');
  ok(inBox.length === 1 && inBox[0].claimed === 0, 'B1b 心意柜那件记 claimed:0（待领取）', JSON.stringify(inBox));
  await openBoxPage();
  await sleep(500);
  const card = J(await boxCardDom(inBox[0].id)) || {};
  ok(card.found && card.pending, 'B1c 心意柜列表卡标「待领取」', JSON.stringify(card));
  await openBoxDetail(inBox[0].id);
  const d = J(await detailDom()) || {};
  ok(d.open && d.hasClaim && d.claimId === inBox[0].id, 'B1d 详情面板出现【领取】按钮（#1530 主修复面）', JSON.stringify(d));
}

// ---- B2：点详情【领取】→ 就地转已领取＋柜记录同步＋列表徽标消失 ----
const boxId1 = ((J(await boxState()) || []).filter((x) => x.side === 'in')[0] || {}).id;
{
  await evalJs("(function(){ var b=document.querySelector('#tc-body button[data-gb-claim]'); if(b)b.click(); return !!b; })()");
  await sleep(400);
  const d = J(await detailDom()) || {};
  ok(!d.hasClaim && String(d.got).indexOf('已领取') >= 0, 'B2 详情按钮就地转「✓ 已领取」', JSON.stringify(d));
  const claimed = await waitBoxClaimed(boxId1);
  ok(claimed, 'B2b 柜记录 claimed:1（走 giftBoxMarkClaimed 落盘）', JSON.stringify(await boxState()));
  const card = J(await boxCardDom(boxId1)) || {};
  ok(card.found && !card.pending, 'B2c 列表卡待领取徽标就地消失（renderBox 已重画）', JSON.stringify(card));
}

// ---- B3：聊天侧同步——卡片就地转已领取＋聊天留痕 ----
{
  await openChat();
  await sleep(400);
  const d = evalJs(`(function(){
    var els = document.querySelectorAll('#chat-body .msg-gift');
    var el = els.length ? els[els.length-1] : null;
    if (!el) return JSON.stringify({ found: false });
    return JSON.stringify({ found: true, hasClaim: !!el.querySelector('.msg-gift-claim'),
      got: el.querySelector('.msg-gift-got') ? String(el.querySelector('.msg-gift-got').textContent) : '' });
  })()`);
  const dd = J(await d) || {};
  ok(dd.found && !dd.hasClaim && String(dd.got).indexOf('已领取') >= 0, 'B3 屏上聊天卡被同步重画成已领取', JSON.stringify(dd));
  const poke = await waitPoke('你收下了');
  ok(poke, 'B3b 聊天留痕「你收下了 …」落库', JSON.stringify((J(await chatState()) || {}).pokes));
  await closePanel();
  await sleep(200);
}

// ---- B4：本批主场景——孤儿柜记录（柜里 claimed:0 但聊天卡不存在）照领 ----
const ORPHAN = { id: 'gb_v1529_orphan', side: 'in', name: '孤儿礼物', emoji: '\uD83C\uDF81', img: '', price: 12, wish: '没有聊天卡也要能领', tm: Date.now() - 60000, replies: [], claimed: 0 };
{
  await evalJs(`(function(){
    var s = window.activeStore();
    var box = []; try { box = JSON.parse(s.get('giftbox-items')||'[]'); } catch(e){}
    box.unshift(${JSON.stringify(ORPHAN)});
    s.set('giftbox-items', JSON.stringify(box));
    return 1;
  })()`);
  // 聊天记录里确保没有指向它的卡（新种子 id 独立）；重载让记忆化表按新存储重读
  if (!(await goto())) { console.error('B4 重载未就绪'); finish(); process.exit(1); }
  await sleep(900);
  await openBoxPage();
  await sleep(500);
  const card = J(await boxCardDom(ORPHAN.id)) || {};
  ok(card.found && card.pending, 'B4 孤儿柜记录在列表中标「待领取」（聊天侧没有这张卡）', JSON.stringify(card));
  await openBoxDetail(ORPHAN.id);
  let d = J(await detailDom()) || {};
  ok(d.open && d.hasClaim, 'B4b 孤儿记录的详情同样出现【领取】', JSON.stringify(d));
  await evalJs("(function(){ var b=document.querySelector('#tc-body button[data-gb-claim]'); if(b)b.click(); return !!b; })()");
  await sleep(400);
  const claimed = await waitBoxClaimed(ORPHAN.id);
  ok(claimed, 'B4c 孤儿记录领取落盘（claimed:1）＝聊天卡丢了也能领', JSON.stringify(await boxState()));
  d = J(await detailDom()) || {};
  ok(!d.hasClaim && String(d.got).indexOf('已领取') >= 0, 'B4d 领取后面板转「✓ 已领取」', JSON.stringify(d));
  const poke = await waitPoke('你收下了 孤儿礼物');
  ok(poke, 'B4e 无卡场景只留痕不补卡（留痕照落）', JSON.stringify((J(await chatState()) || {}).pokes));
  await closePanel();
  await sleep(200);
}

// ---- B5：反向守卫——已领取的详情不出【领取】；side:'self' 带 claimed:0 也不出 ----
{
  await openBoxPage();
  await sleep(400);
  await openBoxDetail(boxId1);
  let d = J(await detailDom()) || {};
  ok(d.open && !d.hasClaim && d.pending === false, 'B5 已领取那件重开详情无【领取】（幂等口径上屏）', JSON.stringify(d));
  await closePanel();
  await sleep(200);
  const SELF = { id: 'gb_v1529_self', side: 'self', name: 'TA 自买礼物', emoji: '\uD83C\uDF81', img: '', price: 9, wish: '自己买的', tm: Date.now() - 30000, replies: [], claimed: 0 };
  await evalJs(`(function(){
    var s = window.activeStore();
    var box = []; try { box = JSON.parse(s.get('giftbox-items')||'[]'); } catch(e){}
    box.unshift(${JSON.stringify(SELF)});
    s.set('giftbox-items', JSON.stringify(box));
    return 1;
  })()`);
  await evalJs("(function(){ var a=document.querySelector('.app[data-app=giftbox]'); if(a)a.click(); return 1; })()");
  await sleep(400);
  await evalJs("(function(){ var t=document.querySelector('.gb-tab[data-btab=self]'); if(t)t.click(); return 1; })()");
  await sleep(400);
  await openBoxDetail(SELF.id);
  d = J(await detailDom()) || {};
  ok(d.open && !d.hasClaim, 'B5b side:self 带 claimed:0 也不出【领取】（boxPending 只认真礼物）', JSON.stringify(d));
  await closePanel();
}

} catch (e) {
  fail++;
  console.log('  \u2717 B 层执行中断：' + (e && e.message));
}

// ---- Z1：全程零未捕获 JS 异常 ----
{
  const errs = J(await evalJs('JSON.stringify(window.__jsErrors||[])')) || [];
  ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', JSON.stringify(errs));
}

finish();
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

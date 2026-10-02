// ===== 回归验证：#848「我送礼给 TA 之后，TA 有概率回一句」（和正常聊天一样回复） =====
// 用法：node tools/verify-gift-reply.mjs      （自组装 src，不依赖构建产物）
// 需求（用户 2026-09-19 直派）：「我送联系人礼物之后（含 TA 发心愿卡索要、我送了），联系人有概率
//   回复一条消息，就是和正常聊天一样回复；之前好像设置过但现在心意集市和心意柜的设置里没有这个功能，
//   也没有默认开启。」
// 落点：src/js/gift-shop.js —— 任一途径送出礼物都经 buyAndSend（市集、心意柜、聊天半框、TA 心愿卡
//   【送 TA】），在 side==='out' 成交后按「心意集市和心意柜设置」的三键门控决定是否回话：
//   giftReplyOn 总开关（默认开）、giftReplyPct 概率（默认 60）、giftReplyMode 内容来源
//   （0=系统预设话术 / 1=和正常聊天一样回复＝window.genChatStyleReply / 2=混合）。
//   投递延迟窗里切了桌面走 window.chatAppendDeskRec 补投到原桌面（同 #489/#585 口径），不静默丢弃。
// 用例：
//   S 层 源码锚点（默认值三键、挂点、三档分流、两个话术池、设置三行、跨桌面补投）
//   G1 心愿兑现＋预设档 → TA 回一句「心愿兑现」话术（in 文本消息）
//   G2 总开关关闭 → 礼物照常落聊天/心意柜，但不回话
//   G3 概率 0 → 不回话
//   G4 聊天档（默认档）→ 回的是字卡管线产物（不在两个预设池里）
//   G5 混合档 → 8 次里两种来源都出现过（六四开）
//   G6 普通送礼（非心愿）＋预设档 → 回「通用」话术
//   G7 心意集市设置面板：三行在位、默认开/60/聊天档、开关与概率可落库、模式胶囊三档可选
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? ' \u2014 ' + extra : '')); }
};

// ---------------- S 层：源码断言 ----------------
const gsSrc = readFileSync(join(root, 'src/js/gift-shop.js'), 'utf8');
console.log('S 层：源码口径');
const poolOf = (name) => {
  const m = gsSrc.match(new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);'));
  if (!m) return null;
  try { return new Function('return ' + m[1])(); } catch (e) { return null; }
};
const POOL_GENERIC = poolOf('GIFT_REPLY_GENERIC');
const POOL_WISH = poolOf('GIFT_REPLY_WISH');
{
  ok(/giftReplyOn: s\.giftReplyOn === 0 \? 0 : 1, giftReplyPct: clampPct\(s\.giftReplyPct, 60\), giftReplyMode: clampMode\(s\.giftReplyMode, 1\)/.test(gsSrc),
    'S1 三键默认值＝开 / 60% / 聊天档（未设置过的用户直接生效，用户点名「要默认开启」）');
  // #985 同批换锚（2026-09-21）：giftReplyFeedback 多了 chatRec 入参（要把这句回话同时贴到那张
  // 礼物卡与心意柜那件上），语义一字未变——仍是「out 侧送出即挂门控」「总开关关＝完全不回话」
  ok(/if \(side === 'out'\) giftReplyFeedback\(gift, rec\);/.test(gsSrc),
    'S2 送出即挂回应门控（任一送礼途径都经 buyAndSend）');
  ok(/function giftReplyFeedback\(gift, chatRec\) \{[\s\S]{0,400}if \(!st\.giftReplyOn\) return;/.test(gsSrc),
    'S3 总开关硬闸（关＝完全不回话）');
  ok(/Math\.random\(\) \* 100 >= clampPct\(st\.giftReplyPct, 60\)/.test(gsSrc), 'S4 概率读设置并钳制');
  ok(/const useChatStyle = mode === 1 \|\| \(mode === 2 && Math\.random\(\) < 0\.4\);/.test(gsSrc),
    'S5 三档分流（0 预设 / 1 聊天 / 2 混合四成聊天式）');
  ok(/window\.genChatStyleReply/.test(gsSrc) && /chatAddInTyped/.test(gsSrc),
    'S6 聊天档走 genChatStyleReply + 带「正在输入…」过渡（与正常回复同观感）');
  ok(Array.isArray(POOL_GENERIC) && POOL_GENERIC.length >= 3 && Array.isArray(POOL_WISH) && POOL_WISH.length >= 3,
    'S7 两套预设话术池在位（通用 / 心愿兑现）', JSON.stringify({ g: POOL_GENERIC && POOL_GENERIC.length, w: POOL_WISH && POOL_WISH.length }));
  ok(/taWishIds\(\)\.has\(gift\.id\)/.test(gsSrc), 'S8 心愿兑现判定在 wishTaRemove 之前取（话术按场景分档）');
  ok(/window\.chatAppendDeskRec\(cid, \{ side: 'in', text: txt \}\);/.test(gsSrc),
    'S9 切桌面后补投到原桌面（同 deliverInGift 口径，不静默丢）');
  ok(/data-gsw="giftReplyOn"/.test(gsSrc) && /data-gsn="giftReplyPct"/.test(gsSrc),
    'S10 心意集市/心意柜设置里有开关行 + 概率行（用户报「设置里没这个功能」的正面回答）');
  ok(/getElementById\('gs-gift-reply-mode'\)/.test(gsSrc) && /GIFT_REPLY_MODES\.map/.test(gsSrc),
    'S11 设置里有「TA 回什么」三档胶囊及其 pills 绑定');
  ok(/我送礼后 TA 回一句/.test(gsSrc), 'S12 设置面板与使用说明写清该功能');
  try { new Function(gsSrc); ok('S13', true, ''); } catch (e) { ok(false, 'S13 gift-shop 整文件编译', String(e.message || e)); }
}

// ---------------- B 层：无头 Chrome 行为 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
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

const site = join(tmpdir(), 'mochi-giftreply-' + Date.now());
const profDir = join(tmpdir(), 'mochi-giftreply-prof-' + Date.now());
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9490 + Math.floor(Math.random() * 60));
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
  for (let i = 0; i < 80; i++) { if ((await evalJs('!!window.__mochiDataReady')) === true) break; await sleep(250); }
  // 每次导航后重新注入话术池（页面重载会把它清掉），供 readState 判定「这句来自哪条链」
  await evalJs(`window.__poolGeneric=${JSON.stringify(POOL_GENERIC || [])};window.__poolWish=${JSON.stringify(POOL_WISH || [])};`);
  return !!(await evalJs('!!window.__mochiDataReady'));
};
const finish = () => {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
  try { rmSync(site, { recursive: true, force: true }); } catch (e) {}
};

await cdp('Page.enable');
await cdp('Runtime.enable');
if (!(await goto())) { console.error('应用未就绪'); finish(); process.exit(1); }
await sleep(1000);

// 只留「③ TA 加自己心愿单 + 发卡」这条可掷中的路径（其余自动行为概率归 0），门控三键按用例覆盖
const BASE = { wlVer: 2, giftInOn: 0, giftInPct: 0, wlOn: 1, wlBuyPct: 0, wlAddPct: 100, wishChatOn: 1, wishChatPct: 100, selfOn: 0, selfPct: 0, giftReplyOn: 1, giftReplyPct: 100, giftReplyMode: 0 };
const setRawSettings = (extra) => {
  const o = Object.assign({}, BASE, extra || {});
  return evalJs(`(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', ${JSON.stringify(JSON.stringify(o))}); return 1; })()`);
};
const openChat = () => evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');}); var a=document.querySelector('.app[data-app=chat]'); if(a)a.click(); return 1; })()");
// 聊天记录里「我送出的礼物」与「TA 回的文本消息」各数一次；回话＝side:in 且非 special 卡片的纯文本
const readState = () => evalJs(`(function(){
  var s = window.storeFor('default');
  var msgs = []; try { msgs = JSON.parse(s.get('chat-msgs')||'[]'); } catch(e){}
  var gifts = msgs.filter(function(m){ return m && m.special === 'gift'; }).length;
  var inTexts = msgs.filter(function(m){ return m && m.side === 'in' && !m.special && String(m.text||'').trim(); });
  var last = inTexts.length ? inTexts[inTexts.length-1] : null;
  return JSON.stringify({
    gifts: gifts, inTexts: inTexts.length,
    wishHits: inTexts.filter(function(m){ return window.__poolWish.indexOf(String(m.text)) >= 0; }).length,
    genericHits: inTexts.filter(function(m){ return window.__poolGeneric.indexOf(String(m.text)) >= 0; }).length,
    lastText: last ? String(last.text) : '',
    inWishPool: last ? (window.__poolWish.indexOf(String(last.text)) >= 0 ? 1 : 0) : 0,
    inGenericPool: last ? (window.__poolGeneric.indexOf(String(last.text)) >= 0 ? 1 : 0) : 0,
    taWish: (function(){ try { return JSON.parse(s.get('gift-wishlist-ta')||'[]').map(function(x){ return x.giftId; }); } catch(e){ return []; } })(),
    errs: (window.__jsErrors || []).length
  });
})()`);

// 走 TA 心愿卡【送 TA】送出（心愿兑现场景）：先保证聊天里有张未兑现的卡
async function ensureWishCard() {
  await openChat();
  await sleep(300);
  for (let i = 0; i < 6; i++) {
    const has = await evalJs("(function(){ return !!document.querySelector('#chat-body .msg-wish-buy:not([disabled])'); })()");
    if (has) return true;
    await evalJs('window.maybeAutoGift()');
    await sleep(600);
  }
  return !!(await evalJs("(function(){ return !!document.querySelector('#chat-body .msg-wish-buy'); })()"));
}
const clickBuyOnWishCard = async () => {
  await evalJs("(function(){ var b=document.querySelectorAll('#chat-body .msg-wish-buy'); if(b.length) b[b.length-1].click(); return b.length; })()");
  await sleep(500);
  return evalJs("(function(){ var b=document.getElementById('gb-ok'); if(b){ b.click(); return 1; } return 0; })()");
};
// 走聊天「更多 → 心意集市」半框送一份普通礼物（非心愿场景）
const sendFromGiftPanel = async () => {
  await openChat();
  await sleep(200);
  await evalJs("(function(){ var b=document.getElementById('more-gift'); if(b) b.click(); return !!b; })()");
  await sleep(600);
  const picked = await evalJs("(function(){ var b=document.querySelector('#gift-grid .gift-item'); if(b){ b.click(); return 1; } return 0; })()");
  await sleep(600);
  const clicked = await evalJs("(function(){ var b=document.getElementById('gb-ok'); if(b){ b.click(); return 1; } return 0; })()");
  return Number(picked) && Number(clicked);
};
const settle = (ms) => sleep(ms || 4600);

console.log('B 层：无头行为');

// ---- G1 心愿兑现 + 预设档 → TA 回一句心愿话术 ----
await setRawSettings({ giftReplyMode: 0 });
if (!(await goto())) { console.error('冷启动未就绪'); finish(); process.exit(1); }
await sleep(900);
{
  const ready = await ensureWishCard();
  const before = JSON.parse(await readState());
  const clicked = Number(await clickBuyOnWishCard());
  await settle();
  const after = JSON.parse(await readState());
  ok(ready && clicked === 1, 'G1a 前置：TA 心愿卡在位且【送 TA】→ 购买弹窗→ 送给 TA 点成了', JSON.stringify({ ready, clicked }));
  ok(after.gifts === before.gifts + 1, 'G1b 礼物气泡落聊天（送出留痕照旧）', before.gifts + ' -> ' + after.gifts);
  ok(after.inTexts >= before.inTexts + 1, 'G1c TA 回了一条消息（in 文本；夹具里 TA 自己的主动消息另计）', before.inTexts + ' -> ' + after.inTexts);
  ok(after.wishHits === before.wishHits + 1 && after.genericHits === before.genericHits,
    'G1d 心愿兑现走「心愿」话术池、恰一条（按池命中增量判，不受夹具噪音干扰）', JSON.stringify({ w: before.wishHits + '->' + after.wishHits, g: before.genericHits + '->' + after.genericHits, txt: String(after.lastText).slice(0, 30) }));
  ok(after.errs === 0, 'G1e 全程零 JS 异常', String(after.errs));
}

// ---- G2 总开关关闭 → 不回话，但礼物照常送出 ----
{
  await setRawSettings({ giftReplyMode: 0, giftReplyOn: 0 });
  const ready = await ensureWishCard();
  const before = JSON.parse(await readState());
  await clickBuyOnWishCard();
  await settle();
  const after = JSON.parse(await readState());
  ok(ready && after.gifts === before.gifts + 1 && after.wishHits === before.wishHits && after.genericHits === before.genericHits,
    'G2 开关关闭：礼物送出、心愿兑现照常，但 TA 一句回礼话都不说', JSON.stringify({ g: before.gifts + '->' + after.gifts, w: before.wishHits + '->' + after.wishHits, t: before.genericHits + '->' + after.genericHits }));
}

// ---- G3 概率 0 → 不回话 ----
{
  await setRawSettings({ giftReplyMode: 0, giftReplyOn: 1, giftReplyPct: 0 });
  const ready = await ensureWishCard();
  const before = JSON.parse(await readState());
  await clickBuyOnWishCard();
  await settle();
  const after = JSON.parse(await readState());
  ok(ready && after.gifts === before.gifts + 1 && after.wishHits === before.wishHits && after.genericHits === before.genericHits,
    'G3 概率调 0：等同于不回应（心愿兑现流程不受影响）', JSON.stringify({ g: before.gifts + '->' + after.gifts, w: before.wishHits + '->' + after.wishHits, t: before.genericHits + '->' + after.genericHits }));
}

// ---- G4 聊天档（默认档）→ 回的是字卡管线产物，不在预设池里 ----
{
  await setRawSettings({ giftReplyMode: 1 });
  const ready = await ensureWishCard();
  const before = JSON.parse(await readState());
  await clickBuyOnWishCard();
  await settle();
  const after = JSON.parse(await readState());
  ok(ready && after.inTexts >= before.inTexts + 1 && String(after.lastText).trim().length > 0 && after.inWishPool === 0 && after.inGenericPool === 0
    && after.wishHits === before.wishHits && after.genericHits === before.genericHits,
    'G4 聊天档：回一句来自聊天字卡/词典管线（与正常聊天同源，不是预设话术）', JSON.stringify({ t: before.inTexts + '->' + after.inTexts, txt: String(after.lastText).slice(0, 40) }));
}

// ---- G5 混合档 → 两种来源都出现过（约六四开） ----
{
  await setRawSettings({ giftReplyMode: 2 });
  let presetHits = 0, chatHits = 0, sends = 0;
  for (let i = 0; i < 8; i++) {
    if (!(await ensureWishCard())) break;
    const before = JSON.parse(await readState());
    await clickBuyOnWishCard();
    await settle(4200);
    const after = JSON.parse(await readState());
    const poolDelta = (after.wishHits - before.wishHits) + (after.genericHits - before.genericHits);
    const textDelta = after.inTexts - before.inTexts;
    if (textDelta <= 0 && poolDelta <= 0) continue;
    sends++;
    if (poolDelta > 0) presetHits++; else if (textDelta > 0) chatHits++;
  }
  ok(sends >= 6 && presetHits >= 1 && chatHits >= 1,
    'G5 混合档：8 次送出里预设话术与聊天式各出现过（分流生效）', JSON.stringify({ sends, presetHits, chatHits }));
}

// ---- G6 普通送礼（非心愿）＋预设档 → 通用话术 ----
{
  await setRawSettings({ giftReplyMode: 0 });
  const before = JSON.parse(await readState());
  const sent = await sendFromGiftPanel();
  await settle();
  const after = JSON.parse(await readState());
  ok(sent && after.genericHits === before.genericHits + 1 && after.wishHits === before.wishHits,
    'G6 聊天半框普通送礼（不在 TA 心愿单）也回一句，且走通用话术池', JSON.stringify({ sent, t: before.inTexts + '->' + after.inTexts, pool: after.inGenericPool, txt: String(after.lastText).slice(0, 30) }));
}

// ---- G7 心意集市设置面板：三行在位 + 默认值 + 可落库 + 模式三档 ----
{
  await evalJs("(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', JSON.stringify({ wlVer: 2 })); return 1; })()");
  await evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); var a=document.querySelector('.app[data-app=\"market\"]'); if(a)a.click(); return 1; })()");
  await sleep(700);
  await evalJs("(function(){ var b=document.getElementById('market-settings'); if(b) b.click(); return !!b; })()");
  await sleep(600);
  const r = await evalJs(`(function(){
    var sw = document.querySelector('#tc-body [data-gsw="giftReplyOn"]');
    var inp = document.querySelector('#tc-body [data-gsn="giftReplyPct"]');
    var mode = document.getElementById('gs-gift-reply-mode');
    if (!sw || !inp || !mode) return 'NO_ROW';
    var before = { on: sw.classList.contains('on') ? 1 : 0, pct: inp.value, modeTxt: mode.textContent, modeV: mode.dataset.v };
    mode.click();
    var pills = [].slice.call(document.querySelectorAll('#modal-pills button')).map(function(b){ return b.textContent; });
    var hasPill = pills.length === 3 && pills.some(function(t){ return t.indexOf('像正常聊天一样回复') >= 0; });
    var cancel = document.getElementById('modal-cancel'); if (cancel) cancel.click();
    sw.click();
    inp.value = '25'; inp.dispatchEvent(new Event('change', { bubbles: true }));
    var raw = null; try { raw = JSON.parse(window.xyStore('xy-home-v2').get('market-wl-settings')||'')||null; } catch(e){}
    return JSON.stringify({ before: before, pills: pills, hasPill: hasPill, saved: raw });
  })()`);
  const o = r === 'NO_ROW' ? null : JSON.parse(r);
  ok(!!o, 'G7a 心意集市/心意柜设置里有「我送礼后 TA 回一句」三行（开关 / 概率 / 回什么）', String(r).slice(0, 160));
  ok(!!o && o.before.on === 1 && o.before.pct === '60', 'G7b 未设置过的用户默认开启、概率 60', JSON.stringify(o && o.before));
  ok(!!o && o.before.modeV === '1' && o.before.modeTxt.indexOf('像正常聊天') >= 0, 'G7c 默认档＝和正常聊天一样回复（用户原话）', JSON.stringify(o && o.before));
  ok(!!o && o.hasPill, 'G7d 点「TA 回什么」弹出三档胶囊', JSON.stringify(o && o.pills));
  ok(!!o && o.saved && o.saved.giftReplyOn === 0 && o.saved.giftReplyPct === 25, 'G7e 开关可关、概率可改成 25 并落库', JSON.stringify(o && o.saved));
}

finish();
console.log('\n' + (fail ? 'FAIL ' + fail + ' / ' : 'PASS ') + '共 ' + (pass + fail) + ' 项（绿 ' + pass + '）');
process.exit(fail ? 1 : 0);

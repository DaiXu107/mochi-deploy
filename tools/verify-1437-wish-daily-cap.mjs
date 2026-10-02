// ===== 回归验证：#1437「TA 的心愿卡（要我买）补每日额度，并可在心意柜设置里调」 =====
// 用法：node tools/verify-1437-wish-daily-cap.mjs            （绿侧＝当前工作树）
//       MOCHI_SRC=/c/Users/Administrator/m1437/b node tools/verify-1437-wish-daily-cap.mjs   （红侧＝纯 HEAD 副本）
//       node tools/verify-1437-wish-daily-cap.mjs --rate    （附带打印默认概率下每判定机会的原始命中率）
// 作者 2026-09-29 报「联系人向我发送要我给联系人买东西的概率偏高，感觉一直在买东西」＋「这个也要有上限，
// 并且可以在心意柜设置里调整」。量出来的根因两条：
//   ① 每日额度只有两本账——①④ 共用 3 次/天、② 独立 3 次/天，而 ③「TA 加心愿 → 发卡到聊天」这一环
//      **从来没被任何闸管过**（gift-shop.js 旧注释自述「③ 加心愿不占上限」）。当天前两本吃满后，
//      每个判定机会只剩 ③ 一条路可走 → 越到后段越只冒「要我买」的卡。
//   ② 同一设置面板里「TA 自己买」的说明写着「不发聊天消息」，而 selfChatOn 默认开、买完照样发一张卡进
//      聊天（#983 那批加的默认值）——作者按说明理解，体感就变成「TA 一直在买东西」。
// 口径（作者逐条点选）：上限**只数发进聊天的那几张**（TA 往自己心愿单里攒多少不受限）／默认 3 张/天／
// 张数用完那次连回落的黑浮层一并静默／那句矛盾说明一起改掉。
// RED 基线（纯 HEAD 副本）预期：S1~S8/S11 与 B1~B7/B9 全红（旧代码压根没有第三本账，10 个判定机会发满 10 张），
// B4/B8 这类「旧行为仍在」的对照项应两侧同绿＝夹具真实、旧契约未动。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize((process.env.MOCHI_SRC || dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const redNames = [];
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; redNames.push(name.split(' ')[0]); console.log('  \u2717 ' + name + (extra ? ' \u2014 ' + extra : '')); }
};

// ---------------- S 层：源码口径 ----------------
console.log('S 层：源码口径（src 根＝' + root + '）');
{
  const gs = readFileSync(join(root, 'src/js/gift-shop.js'), 'utf8');
  ok(/const WISHCHAT_DAILY_PREFIX = 'ml2_wishchat_daily_';/.test(gs), 'S1 第三本账的每日额度键存在');
  ok(/const quotaLeft = dayCount\(WISHCHAT_DAILY_PREFIX\) < st\.wishChatDayMax;/.test(gs), 'S2 发卡前按设置值问当日张数（写死常量＝设置页那格成摆设）');
  ok(/if \(pushed\) dayIncr\(WISHCHAT_DAILY_PREFIX\);/.test(gs), 'S3 只有真发进聊天才记账（先记后发＝被限流闸退回的那张白占额度）');
  ok(/else if \(quotaLeft\) toast\(/.test(gs), 'S4 张数用完那次连回落 toast 一并静默（作者点口径）');
  ok(/const pushed = !!\(quotaLeft && st\.wishChatOn && Math\.random\(\) \* 100 < st\.wishChatPct && wishChatPush\(giftW\)\);/.test(gs),
    'S5 pushed 判定＝额度→开关→概率→真发（#663a 旧契约「开关＋概率发卡」仍在，只是前面多一道闸）');
  ok(/wishChatDayMax: clampCount\(s\.wishChatDayMax, 3, 20\)/.test(gs), 'S6 默认 3 张、可调 0~20 从设置读');
  ok(/clampCount\(v, def, max\)/.test(gs), 'S7 次数型钳位助手就位（与 clampPct 分家）');
  ok(/data-gsn="wishChatDayMax"/.test(gs) && /max="20"/.test(gs), 'S8 心意柜设置面板有「TA 心愿卡每天最多」那一格且封顶 20');
  ok(/const hi = Number\(inp\.max\) \|\| 100;/.test(gs), 'S9 非法值封顶问输入框自己的 max（面板收 0~100、引擎钳 0~20 的双头口径不许回来）');
  ok(!/wishChatDayMax: clampPct\(/.test(gs), 'S10 反向：张数没被概率钳位误用（否则 0~20 与 0~100 两套语义糊在一起）');
  ok(!/收进「心意柜-TA 自己买的」，不发聊天消息/.test(gs) && /默认开着，买完会同时发一张礼物卡到聊天/.test(gs),
    'S11 说明不再自相矛盾（旧那句「不发聊天消息」与 selfChatOn 默认开打脸）');
  ok(/const AUTO_DAILY_PREFIX = 'ml2_gift_daily_';/.test(gs) && /const SELF_DAILY_PREFIX = 'ml2_selfbuy_daily_';/.test(gs) && /const WISHCHAT_DAILY_PREFIX/.test(gs),
    'S12 三本账并存：送我／自买／心愿卡各自一枚键');
}

// ---------------- B 层：无头 Chrome 行为 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
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

const site = join(tmpdir(), 'mochi-1437-site-' + Date.now());
const profDir = join(tmpdir(), 'mochi-1437-prof-' + Date.now());
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9740 + Math.floor(Math.random() * 50));
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
  if (r && r.exceptionDetails) return '__ERR__' + JSON.stringify(r.exceptionDetails).slice(0, 260);
  return r && r.result ? r.result.value : null;
}
const goto = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) { if ((await evalJs('!!window.__mochiDataReady')) === true) return true; await sleep(250); }
  return false;
};
let finished = false;
const finish = () => {
  if (finished) return; finished = true;
  for (const p of [profDir, site]) {
    for (let i = 0; i < 5; i++) { try { rmSync(p, { recursive: true, force: true }); return; } catch (e) { sleepSync(300); } }
  }
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
};
function sleepSync(ms) { const t = Date.now(); while (Date.now() - t < ms) {} }

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
if (!(await goto())) { console.error('应用未就绪'); finish(); process.exit(1); }
await sleep(800);

// 页内夹具
await evalJs(`(function(){
  var d = new Date();
  window.__tk = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  window.__cnt = { wishCard:0, giftCard:0, selfCard:0 };
  if (!window.__wrapped) {
    window.__wrapped = true;
    var orig = window.chatAddGift;
    window.__origAddGift = orig;
    window.chatAddGift = function(rec){
      try {
        var sp = (rec&&rec.special)||'';
        if (sp==='wish') window.__cnt.wishCard++;
        else if (sp==='gift') { if (rec.giftSelf) window.__cnt.selfCard++; else window.__cnt.giftCard++; }
      } catch(e){}
      return orig.apply(this, arguments);
    };
    window.__wrappedAddGift = window.chatAddGift;   // B9 要把「摘掉投递链路」还原成带计数的那一层
  }
  var w = window.giftWalletGet(); w.systemBalance = 50000000; window.giftWalletSet(w);
  return 1;
})()`);

const env = JSON.parse(await evalJs(`JSON.stringify({ night: !!(window.nightModeActive && window.nightModeActive()), rl: !!(window.chatRateLimitFull && window.chatRateLimitFull()) })`));
console.log('\n前置读数：夜间闸=' + env.night + ' 总量限流=' + env.rl + '（任一为真都会吞掉发卡，本尺要求为 false）');
if (env.night || env.rl) { console.error('环境不满足（不是回归）'); finish(); process.exit(2); }

const setSettings = async (obj) => {
  await evalJs(`(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', ${JSON.stringify(JSON.stringify(obj))}); return 1; })()`);
  const back = JSON.parse(await evalJs(`(function(){ var s=null; try{s=JSON.parse(window.xyStore('xy-home-v2').get('market-wl-settings')||'')||null;}catch(e){} return JSON.stringify(s); })()`));
  for (const k of Object.keys(obj)) if (!back || back[k] !== obj[k]) { console.error('✗ 设置没写进去：' + k); finish(); process.exit(1); }
};
const clearSettings = () => evalJs(`(function(){ window.xyStore('xy-home-v2').remove('market-wl-settings'); return 1; })()`);
// 复位「今天」：三本账归零＋两张心愿单清空＋卡片计数归零
const resetDay = () => evalJs(`(function(){
  var s = window.activeStore();
  s.set('ml2_gift_daily_'+window.__tk,'0'); s.set('ml2_selfbuy_daily_'+window.__tk,'0'); s.set('ml2_wishchat_daily_'+window.__tk,'0');
  s.remove('gift-wishlist-ta'); s.remove('gift-wishlist');
  window.__cnt = { wishCard:0, giftCard:0, selfCard:0 };
  var t = document.getElementById('cc-toast'); if (t) t.textContent='';
  return 1;
})()`);
const dayCounters = () => evalJs(`(function(){ var s = window.activeStore(); return JSON.stringify({
  wish: Number(s.get('ml2_wishchat_daily_'+window.__tk)||0),
  gift: Number(s.get('ml2_gift_daily_'+window.__tk)||0),
  self: Number(s.get('ml2_selfbuy_daily_'+window.__tk)||0),
  taLen: (JSON.parse(s.get('gift-wishlist-ta')||'[]')||[]).length,
  cards: window.__cnt.wishCard }); })()`);
// 连跑 n 个判定机会；每 tick 记录「TA 心愿单是否加了件」「有没有弹黑浮层」
const runTicks = async (n, keepWishlist) => JSON.parse(await evalJs(`(function(){
  var toasts = [];
  for (var i=0;i<${n};i++){
    var s = window.activeStore();
    if (!${!!keepWishlist}) { s.remove('gift-wishlist-ta'); }
    var t0 = document.getElementById('cc-toast'); if (t0) t0.textContent = '';
    var before = (JSON.parse(s.get('gift-wishlist-ta')||'[]')||[]).length;
    window.maybeAutoGift();
    var after = (JSON.parse(s.get('gift-wishlist-ta')||'[]')||[]).length;
    toasts.push({ added: after > before ? 1 : 0, toast: ((document.getElementById('cc-toast')||{}).textContent || '').slice(0, 60) });
  }
  return JSON.stringify(toasts);
})()`));

const WISH_ONLY = { wlVer: 2, giftInOn: 1, giftInPct: 0, wlOn: 1, wlBuyPct: 0, wlAddPct: 100, wishChatOn: 1, wishChatPct: 100, selfOn: 1, selfPct: 0 };

console.log('\nB 层：无头行为');
// ---- B1 设置面板那一格的默认值与封顶（默认＝从未设置过，走代码默认）----
await clearSettings();
{
  const v = JSON.parse(await evalJs(`(function(){
    var el = document.getElementById('giftbox-settings'); if (!el) return JSON.stringify({err:'no-entry'});
    el.click();
    var inp = document.querySelector('#tc-body [data-gsn="wishChatDayMax"]');
    var out = inp ? { value: inp.value, max: inp.max, min: inp.min } : { err: 'no-row' };
    var m = document.getElementById('tc-mask'); if (m) m.hidden = true;
    return JSON.stringify(out);
  })()`));
  ok(v.value === '3' && v.max === '20', 'B1 未设置过＝面板显示默认 3 张、封顶 20', JSON.stringify(v));
}

// ---- B2 默认额度：10 个判定机会只发 3 张，心愿单照加 10 件 ----
await setSettings(Object.assign({}, WISH_ONLY)); // 显式写一份，排除「默认值来自缺键」这一路
await resetDay();
{
  const t = await runTicks(10, true);
  const c = JSON.parse(await dayCounters());
  ok(c.cards === 3 && c.wish === 3, 'B2 默认每天最多 3 张（第 4 张起不再发）', JSON.stringify(c));
  ok(c.taLen === 10, 'B3 额度只管发卡：TA 往自己心愿单里攒了 10 件，一件没少', JSON.stringify(c));
  const silentAfter = t.slice(3).every(function (x) { return x.added === 1 && x.toast === ''; });
  ok(silentAfter, 'B4 张数用完那次静默（不加卡也不弹黑浮层，作者点的口径）', JSON.stringify(t.slice(3)));
}

// ---- B5 可调：改成 5 张就发 5 张（不是写死 3）----
await setSettings(Object.assign({}, WISH_ONLY, { wishChatDayMax: 5 }));
await resetDay();
{
  await runTicks(9, true);
  const c = JSON.parse(await dayCounters());
  ok(c.cards === 5 && c.wish === 5, 'B5 设置里调成 5 张就发 5 张（值真被引擎读走）', JSON.stringify(c));
}

// ---- B6 调成 0＝整条发卡停，但 TA 照旧默默加心愿 ----
await setSettings(Object.assign({}, WISH_ONLY, { wishChatDayMax: 0 }));
await resetDay();
{
  const t = await runTicks(6, true);
  const c = JSON.parse(await dayCounters());
  ok(c.cards === 0 && c.wish === 0, 'B6 张数调 0＝不发卡', JSON.stringify(c));
  ok(c.taLen === 6 && t.every(function (x) { return x.added === 1 && x.toast === ''; }), 'B7 调 0 之后只默默加心愿、零提示（与面板说明一致）', JSON.stringify(c));
}

// ---- B8 概率没中（张数额度还开着）→ 回落旧 toast 的通路没被砍 ----
await setSettings(Object.assign({}, WISH_ONLY, { wishChatPct: 0 }));
await resetDay();
{
  const t = await runTicks(3, true);
  ok(t.every(function (x) { return x.added === 1 && x.toast.indexOf('心愿单') >= 0; }), 'B8 概率没中仍回落旧提示（#663 旧契约没被本批顺手砍掉）', JSON.stringify(t));
}

// ---- B9 记账只在真发卡之后：投递链路缺席时不烧额度 ----
await setSettings(Object.assign({}, WISH_ONLY));
await resetDay();
{
  const c1 = JSON.parse(await evalJs(`(function(){
    window.chatAddGift = null;                       // wishChatPush 判 !window.chatAddGift 直接 return false
    for (var i=0;i<4;i++){ window.maybeAutoGift(); }
    var s = window.activeStore();
    window.chatAddGift = window.__wrappedAddGift;    // 还原成带计数的那一层，后面还要数卡片
    return JSON.stringify({ wish: Number(s.get('ml2_wishchat_daily_'+window.__tk)||0), cards: window.__cnt.wishCard });
  })()`));
  ok(c1.wish === 0 && c1.cards === 0, 'B9 发不出去就不占额度（旧写法先记后发＝白烧三张）', JSON.stringify(c1));
  const c2 = JSON.parse(await dayCounters());
  await runTicks(4, true);
  const c3 = JSON.parse(await dayCounters());
  ok(c3.cards === 3 && c3.wish === 3, 'B10 还原投递链路后当天仍能发满 3 张（B9 没把额度偷吃掉）', JSON.stringify({ before: c2, after: c3 }));
}

// ---- B11 三本账互不挤占（#585 那条口径的第三本）----
{
  await resetDay();
  await setSettings({ wlVer: 2, giftInOn: 1, giftInPct: 100, wlOn: 0, wlBuyPct: 0, wlAddPct: 100, wishChatOn: 1, wishChatPct: 100, selfOn: 1, selfPct: 100, wishChatDayMax: 3 });
  await runTicks(8, true);   // ② 与 ④ 先各自吃满
  const mid = JSON.parse(await dayCounters());
  await setSettings({ wlVer: 2, giftInOn: 1, giftInPct: 0, wlOn: 1, wlBuyPct: 0, wlAddPct: 100, wishChatOn: 1, wishChatPct: 100, selfOn: 1, selfPct: 0, wishChatDayMax: 3 });
  await runTicks(8, true);   // 同一天再走 ③
  const c = JSON.parse(await dayCounters());
  ok(mid.self === 3 && mid.gift === 3, 'B11 「送我」与「自买」各自先吃满 3 次', JSON.stringify(mid));
  ok(c.wish === 3 && c.cards === 3 && c.self === 3 && c.gift === 3, 'B12 同日三本账并存＝送 3／自买 3／心愿卡 3，互不挤占', JSON.stringify(c));
}

// ---- B13 跨日复位（额度是「每天」不是「总共」）----
{
  await setSettings(Object.assign({}, WISH_ONLY));
  await resetDay();
  await runTicks(6, true);
  const a = JSON.parse(await dayCounters());
  await evalJs(`(function(){ var s = window.activeStore(); s.set('ml2_wishchat_daily_'+window.__tk, '0'); window.__cnt.wishCard = 0; return 1; })()`);
  await runTicks(5, true);
  const b = JSON.parse(await dayCounters());
  ok(a.cards === 3 && b.cards === 3, 'B13 换新一天又能发满 3 张（不是「一辈子 3 张」）', JSON.stringify({ a: a.cards, b: b.cards }));
}

// ---- 可选：默认概率下的原始命中率（只打印，不断言）----
if (process.argv.indexOf('--rate') >= 0) {
  await clearSettings();
  await resetDay();
  const RATE = 600;
  const r = JSON.parse(await evalJs(`(function(){
    var added=0, pushed=0, self=0, gift=0;
    for (var i=0;i<${RATE};i++){
      var s = window.activeStore();
      s.set('ml2_gift_daily_'+window.__tk,'0'); s.set('ml2_selfbuy_daily_'+window.__tk,'0'); s.set('ml2_wishchat_daily_'+window.__tk,'0');
      s.remove('gift-wishlist-ta'); s.remove('gift-wishlist');
      var c0 = window.__cnt.wishCard;
      window.maybeAutoGift();
      if (window.__cnt.wishCard > c0) pushed++;
      added += (JSON.parse(s.get('gift-wishlist-ta')||'[]')||[]).length > 0 ? 1 : 0;
      self += Number(s.get('ml2_selfbuy_daily_'+window.__tk)||0);
      gift += Number(s.get('ml2_gift_daily_'+window.__tk)||0);
    }
    return JSON.stringify({ pushed:pushed, added:added, self:self, gift:gift });
  })()`));
  console.log('\n命中率（默认概率，n=' + RATE + '，每 tick 复位额度＝量原始率）：' +
    '加心愿 ' + (100 * r.added / RATE).toFixed(2) + '% ｜ 心愿卡进聊天 ' + (100 * r.pushed / RATE).toFixed(2) +
    '% ｜ 自买 ' + (100 * r.self / RATE).toFixed(2) + '% ｜ 送我(④) ' + (100 * r.gift / RATE).toFixed(2) + '%');
}

// ---- Z 层：零异常 ----
{
  const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
  ok(errs === '[]', 'Z1 全程零 JS 异常', String(errs).slice(0, 260));
}

console.log('\n合计：' + pass + ' 绿 / ' + fail + ' 红' + (redNames.length ? '（红：' + redNames.join(',') + '）' : ''));
finish();
process.exit(fail ? 1 : 0);

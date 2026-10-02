// ===== 回归 #1347：桌面【聊天】角标与桌面横幅不能再按「卡片类型名」决定认不认一条收件 =====
// 报障（OPPO 一加12 PJD110／Chrome 153／桌面 PWA standalone，2026-09-27，诊断单
// mochi-diag-2026-09-27-03-35-00138083648986497636.docx）：用户原话「主动发的消息在桌面消息
// （软件内部的消息）弹出有问题，主动发的消息桌面的【聊天】角标会不显示数字」＋「帮我修复，并且
// 不要覆盖修改导致不同型号设备浏览器的 bug 反复出现。这个问题其他设备型号也有出现」。
//
// 根因（src/js/chat.js addRec 落库处，零机型／零 UA 分支可证）：「值得提醒」判据是一条
// 【卡片类型名白名单】——side 'in' 且 special ∈｛无、poke、gift、wish｝才走 incChatUnread() 与
// showDeskMsg()。TA 定时主动发送那条链发的是纯文本／字卡（无 special），命中名单，所以那一路
// 一直好使；而聊天里真真切切多出来的卡片只要名字不在名单里就双双装死。无头逐项实测（纯 tip
// 02c196b 产物、桌面页在屏上、逐条投递读 #chat-badge 与 #desk-msg）：查岗提问卡 ask-card／提问
// 提示行 ask-msg／问卷 ask-survey／三选一 ask-choose／自动红包 redpacket／送花 flower／小游戏
// 结算 pong ＝角标 +0 且横幅不弹，同场对照普通文本＝角标 +1 且横幅照弹。差异 100% 由
// rec.special 这一个字符串决定，与机型／UA／内核无关＝「其他型号也有出现」的成因不是某些设备
// 坏了，而是这些卡片形态在任何设备上都从没进过名单。
// 另一半（同一件事的两半）：卡片正文不住在 rec.text 里（红包＝rpAmount/rpWish、礼物＝giftName、
// 送花＝flName、查岗＝askQuestion），预览串拿到空 → showDeskPopup 的「说不出就不弹」把桌面横幅
// 与后台系统通知一起静默丢掉。#660 当年写的「未读角标／桌面横幅／系统通知三处都能看懂」对 gift
// 这一类无 text 的卡片其实一直不成立（实测：礼物卡角标 +1 而横幅不弹）。
//
// 改法（两处各一条结构判据，类型名一个不看）：
//   ① notable = rec.side === 'in' && rec.special !== 'read'——判「聊天列表是否因此多出一条 TA 的
//      内容」＋「它是不是纯状态回声」；已读回执不是内容，其余（含以后新增的任何卡片形态）皆算。
//   ② extractDeskMsg 末尾：卡片且预览既无正文又无图时补一句不含类型的通用文案，让横幅／系统通知
//      永远说得出「有一条新消息在等你点开」，而不是干脆不吭声。
//
// 用例（同一把尺子分别打绿副本与纯 tip 副本；尺子一律取产品可观测事实＝角标数字、横幅显隐与文案、
// localStorage 里那枚 chat-unread 键，不拿本批新增导出当尺子）：
//   S1~S5 静态锚（新判据行／预览兜底行／旧名单形态不得回流／邻批 #663k 重锚后指向新逻辑／
//          判据那一行不许再出现任何类型名）
//   A1~A8 本批新契约：七类既有卡片 + 一枚「未来自增类型」夹具必须角标恰好 +1 且横幅弹
//       A8 是本批判别力的核心——判据若还是类型名表，随便起一个名单外的名字就漏；这里用一个
//       全库根本不存在的 special 值，绿侧必须照样认。
//   A9~A10 无 text 卡片的横幅文案＝通用那句（不许是空、也不许是 dataURL 乱码），且有正文的卡片
//       仍用其原文案（防兜底盖掉真内容）
//   A11 TA 心愿卡 wish＝邻批 #660/#663k 契约的行为面（那批旧写法只有文本锚，本批撤了名单，
//       这里真投一张卡读角标与横幅，防「换锚换成空承诺」）
//   B1~B7 旧契约不动（两侧皆绿才算本批零噪音）：普通文本照旧／已读回执不算／silent 只压横幅不压
//       角标（#345/#1184）／进聊天清零／out 侧自己发的不算未读／desk-msg-en 关了不弹但角标照增
//       ／桌面页不在屏时横幅不弹（#795）而角标照增
//   C1 隐藏态（后台）收到卡片：角标照增且确实进了系统通知闸门（数 bgNotifyCheck 调用次数）
//   Z1 全程零 JS 异常
//
// ⚠ 夹具纪律（第一版在此栽过）：这个 App 自己会发主动消息（TA 心情／查岗／红包／摸鱼小结各有
//   定时器），任何「读差值」的尺子只要跨两次 CDP 往返就可能被一条自发消息插进来，把 +1 量成 +2、
//   把横幅文案量成别人的。于是每条测量都收进**同一个同步回合**里：读初值 → 投递 → 读数，中间
//   不 await（投递链里 incChatUnread/showDeskPopup 本就是同步的）。顺带核「msgs 恰好多 1 条」。
// 用法：node tools/verify-1347-badge-covers-cards.mjs            （测主树产物）
//       node tools/verify-1347-badge-covers-cards.mjs <被测目录>  （测红/绿副本，同尺 A/B）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const results = [];
const t = (name, ok, detail) => { results.push({ name, ok }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  ← ' + detail : '')); };

// ---------- S 组：静态锚（先跑，产品码缺件就没必要起浏览器） ----------
const cj = read('src/js/chat.js');
const gateRe = /const notable = rec\.side === 'in' && rec\.special !== 'read';/;
t('S1 未读角标/横幅的判据＝「in 侧内容」减「纯状态回声」（退回类型名白名单即红）',
  gateRe.test(cj));
t('S2 卡片预览说不出内容时的通用兜底句在位（删＝无 text 卡片照旧静默丢掉横幅与系统通知）',
  /if \(!text && !img && rec\.special && rec\.special !== 'read'\) text = '发来一条新消息，点开看看';/.test(cj));
t('S3 旧「卡片类型名白名单」形态不得回流（名单一复活＝名单外的卡片类型再次装死）',
  !/rec\.special === 'gift' \|\| rec\.special === 'wish'/.test(cj));
t('S4 邻批 #663k（心愿卡要进角标与横幅）重锚后指向这条新的结构判据',
  gateRe.test(cj) && buildNeedleOf('build.mjs', '#663k') === true, buildNeedleOf('build.mjs', '#663k', true));
t('S5 notable 那一行不含任何卡片类型名（防「名字留着、名单偷偷加回来」）',
  !/const notable = [^\n]*'(poke|gift|wish|redpacket|flower|pong|ask-card|ask-msg|ask-survey|ask-choose)'/.test(cj));
function buildNeedleOf(file, tag, detail) {
  const s = read(file);
  const m = s.match(new RegExp("\\{ name: '" + tag + "[^\\n]*needle: \"([^\"]*)\""));
  if (!m) return detail ? '登记表里找不到 ' + tag : false;
  if (detail) return 'needle=' + m[1];
  return m[1].indexOf("rec.side === 'in' && rec.special !== 'read'") >= 0;
}

// ---------- 运行时 ----------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
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
const base = 'http://127.0.0.1:' + server.address().port;
const port = 11400 + Math.floor(Math.random() * 200);
const tmpProfile = join(process.env.TEMP || '/tmp', 'mochi-v1347-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpProfile, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const pg = l.find((x) => x.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.log('环境不满足：连不上无头 Chrome'); server.close(); try { chrome.kill(); } catch (e) {} process.exit(2); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 240); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
// 报障机型现场：360×752／一加12／桌面 PWA。visibilityState 用 defineProperty 伪造（无头没法真
// 切后台），并在注入期就挂好 bgNotifyCheck 计数桩与 __forceHidden。
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 752, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e) {}
    window.__mochiHidden = false;
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return window.__mochiHidden ? 'hidden' : 'visible'; } });
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return !!window.__mochiHidden; } });
    } catch (e) {}
    window.__forceHidden = function (v) { window.__mochiHidden = !!v; try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {} };
    window.__bgnCalls = [];
    (function () {
      const t0 = setInterval(function () {
        if (typeof window.bgNotifyCheck === 'function' && !window.bgNotifyCheck.__v1347) {
          const orig = window.bgNotifyCheck;
          const w = function (title) { window.__bgnCalls.push(String(title || '').slice(0, 30)); return orig.apply(this, arguments); };
          w.__v1347 = true; window.bgNotifyCheck = w; clearInterval(t0);
        }
      }, 30);
    })();
  `
});
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(3000);
let ready = false;
for (let i = 0; i < 80; i++) { if (await ev('!!window.__mochiDataReady')) { ready = true; break; } await sleep(300); }
t('R0 环境就绪（数据已恢复）且桌面页在屏上（横幅只在桌面页弹＝#795 的口径，尺子前提）',
  ready === true && String(await ev('!(document.getElementById("page-phone").hidden)')) === 'true');
if (!ready) { console.log('环境不满足，跳过运行时断言'); server.close(); try { chrome.kill(); } catch (e) {} process.exit(2); }
// 顺手把 TA 自己的定时主动发送关掉：不是为了让断言宽松，而是让「 msgs 恰好多 1 条」这条核账
// 只对当前这一发成立（关掉后任何 +1 都只可能来自被测那一发投递）。
await ev(`(function(){try{var p='xy-home-v2:default:reply-';localStorage.setItem(p+'as-en','0');}catch(e){}try{window.rescheduleAutoSend&&window.rescheduleAutoSend();}catch(e){}})()`);

// 一次投递的全部测量＝同一个同步回合里的「读初值 → 投 → 读数」。角标数字、LS 那枚键、横幅显隐
// 与文案、msgs 条数与尾条的 special 一并取回。
const MEASURE = `(function (expr, opts) {
  function rd() {
    var b = document.getElementById('chat-badge'), d = document.getElementById('desk-msg'), dt = document.getElementById('desk-msg-text');
    var pp = document.getElementById('page-phone'), pc = document.getElementById('page-chat');
    var un = 0; try { un = parseInt(localStorage.getItem('xy-home-v2:default:chat-unread'), 10) || 0; } catch (e) {}
    var arr = window.getChatMsgs ? window.getChatMsgs() : [];
    var tail = arr.length ? arr[arr.length - 1] : null;
    return {
      n: b ? (b.hidden ? 0 : (parseInt(b.textContent, 10) || 0)) : -1,
      banner: !!(d && !d.hidden && pp && !pp.hidden),
      txt: (d && !d.hidden && dt) ? String(dt.textContent || '') : '',
      dom: un, len: arr.length,
      tailSide: tail ? String(tail.side || '') : '', tailSpecial: tail ? String(tail.special || '') : '',
      chat: !!(pc && !pc.hidden), desk: !!(pp && !pp.hidden)
    };
  }
  var d = document.getElementById('desk-msg'); if (d) d.hidden = true;
  var a = rd();
  try { eval(expr); } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }); }
  var b2 = rd();
  return JSON.stringify({ dn: b2.n - a.n, ddom: b2.dom - a.dom, dlen: b2.len - a.len, banner: b2.banner, txt: b2.txt, tailSide: b2.tailSide, tailSpecial: b2.tailSpecial, n: b2.n, before: a, after: b2 });
})`;
async function deliver(expr) {
  const raw = String(await ev(MEASURE + '(' + JSON.stringify(expr) + ')'));
  let r = null; try { r = JSON.parse(raw); } catch (e) {}
  if (!r || r.err) { console.log('  ! 投递/测量失败：' + (r && r.err ? r.err : raw.slice(0, 120))); return r || { dn: -99, banner: false, txt: '', dlen: -99 }; }
  return r;
}
// 一条断言的「认账」形状：本批发出的这一条＝msgs 恰好多 1 条 且 尾条就是它
const oneCard = (r, special) => r.dlen === 1 && r.tailSpecial === special && r.dn === 1 && r.banner === true;

// ---------- A 组：本批新契约（红侧＝角标 +0 且横幅不弹） ----------
const CARDS = [
  ['A1 查岗提问卡 ask-card（TA 主动查岗，在等回答）', `window.chatAddSystem('V1347 查岗：你现在在干嘛？', { special: 'ask-card', askQuestion: 'V1347 查岗', askStatus: 'pending' })`, 'ask-card'],
  ['A2 提问提示行 ask-msg', `window.chatAddSystem('V1347 想问你一个问题。', { special: 'ask-msg' })`, 'ask-msg'],
  ['A3 批量问卷 ask-survey', `window.chatAddSystem('V1347 问卷（3 题）', { special: 'ask-survey', surveyStatus: 'sent', surveyQs: [] })`, 'ask-survey'],
  ['A4 三选一 ask-choose（帮我决定）', `window.chatAddSystem('V1347 帮我决定：吃啥', { special: 'ask-choose', choiceStatus: 'pending' })`, 'ask-choose'],
  ['A6 小游戏结算卡 pong（有正文）', `window.chatAddSystem('V1347 Pong · 你 7 : 5 TA · 你赢', { special: 'pong' })`, 'pong'],
  ['A8 未来自增类型夹具（全库根本不存在的 special 名）', `window.chatAddSystem('V1347 未来卡片', { special: 'zz-never-seeded-card' })`, 'zz-never-seeded-card'],
];
for (const [name, expr, sp] of CARDS) {
  const r = await deliver(expr);
  t(name, oneCard(r, sp), '角标+' + r.dn + ' msgs+' + r.dlen + ' 尾条=' + r.tailSpecial + ' 横幅=' + r.banner + ' 文案=' + JSON.stringify(r.txt));
}
// 无正文的卡片：角标 +1，横幅弹得出来且文案是那一句通用的（不是空串、不是 dataURL）
const NOTEXT = [
  ['A5 自动红包 redpacket（正文在 rpAmount/rpWish，rec.text 为空）', `window.chatAddIn('', { special: 'redpacket', rpAmount: 500, rpStatus: 'pending', rpWish: 'V1347 红包' })`, 'redpacket'],
  ['A7 送花 flower（正文在 flName，rec.text 为空）', `window.chatSendFlower('🌹', 'V1347 玫瑰', 'V1347 心愿', true)`, 'flower'],
  ['A9 礼物卡 gift（正文在 giftName，rec.text 为空）', `window.chatAddGift({ side: 'in', special: 'gift', giftName: 'V1347 小熊' })`, 'gift'],
];
for (const [name, expr, sp] of NOTEXT) {
  const r = await deliver(expr);
  t(name, r.dn === 1 && r.banner === true && r.txt.length > 0 && r.txt.indexOf('V1347') < 0 && r.txt.indexOf('data:') < 0,
    '角标+' + r.dn + ' 横幅=' + r.banner + ' 文案=' + JSON.stringify(r.txt));
}
const gen = await deliver(`window.chatAddIn('', { special: 'redpacket', rpAmount: 313, rpStatus: 'pending' })`);
const gen2 = await deliver(`window.chatAddIn('V1347 有正文的那张', { special: 'ask-card', askQuestion: 'V1347 有正文', askStatus: 'pending' })`);
t('A10 通用兜底句只给「说不出内容」的卡片，有正文的卡片仍用其原文案（防兜底盖掉真内容）',
  gen.banner && gen.txt === '发来一条新消息，点开看看' && gen2.banner && gen2.txt.indexOf('V1347 有正文') >= 0,
  '空=' + JSON.stringify(gen.txt) + ' 有正文=' + JSON.stringify(gen2.txt));

// ---------- B 组：旧契约不许动（两侧皆绿才算本批零噪音） ----------
// A11 是邻批 #660/#663k 那条契约的「行为面」版本：它旧写法只靠文本锚（名单里有 wish），本批把那层
// 名单整撤了，契约改由结构判据承接——这里真投一张心愿卡读角标与横幅，防止「换锚＝换了个空承诺」。
const a11 = await deliver(`window.chatAddGift({ side: 'in', special: 'wish', text: 'V1347 想要「小熊」', wishGiftId: 'v1347-fixture' })`);
t('A11 TA 心愿卡 wish：角标 +1 且横幅弹（#660 旧契约由本批结构判据承接，行为面不许退化）',
  a11.dn === 1 && a11.banner === true && a11.txt.indexOf('V1347 想要') >= 0,
  '角标+' + a11.dn + ' 横幅=' + a11.banner + ' 文案=' + JSON.stringify(a11.txt));
const b1 = await deliver(`window.chatAddIn('V1347 普通文本', { initiative: true })`);
t('B1 TA 主动发的纯文本：角标 +1 且横幅照弹（名单时代就成立，本批不许弄坏）',
  b1.dn === 1 && b1.banner === true && b1.txt.indexOf('V1347 普通文本') >= 0,
  '角标+' + b1.dn + ' 横幅=' + b1.banner + ' 文案=' + JSON.stringify(b1.txt));
const b2 = await deliver(`window.chatAddIn('', { special: 'read' })`);
t('B2 已读回执不是内容：角标不动、横幅不弹（防「一律弹」的修过头）',
  b2.dn === 0 && b2.banner === false, '角标+' + b2.dn + ' 横幅=' + b2.banner);
const b3 = await deliver(`window.chatAddIn('V1347 silent 收件', { initiative: true, silent: true })`);
t('B3 silent 只压横幅不压角标（#345/#1184 契约：墓碑也是未读事件）',
  b3.dn === 1 && b3.banner === false, '角标+' + b3.dn + ' 横幅=' + b3.banner);
// 点进聊天＝读过了，角标与 LS 那枚键一起归零（clearChatUnread 在 enterChat 第一段，同步）
const b4raw = String(await ev(`(function(){
  var a=document.querySelector('.app[data-app="chat"]'); var before=document.getElementById('chat-badge');
  var bn = before ? (before.hidden?0:(parseInt(before.textContent,10)||0)) : -1;
  if (a) a.click();
  var after=document.getElementById('chat-badge'); var un=0; try{un=parseInt(localStorage.getItem('xy-home-v2:default:chat-unread'),10)||0;}catch(e){}
  var pc=document.getElementById('page-chat');
  return JSON.stringify({bn:bn, an: after?(after.hidden?0:(parseInt(after.textContent,10)||0)):-1, un:un, chat: !!(pc && !pc.hidden)});
})()`));
let b4 = {}; try { b4 = JSON.parse(b4raw); } catch (e) {}
t('B4 点进聊天页：角标与 chat-unread 键一并归零（未读定义＝没进过聊天）',
  b4.bn > 0 && b4.an === 0 && b4.un === 0 && b4.chat === true,
  '进页前 n=' + b4.bn + ' 进页后 n=' + b4.an + ' LS=' + b4.un + ' 聊天页在场=' + b4.chat);
await ev("(function(){var t=document.querySelector('.tab[data-page=\"page-phone\"]');if(t)t.click();})()");
await sleep(600);
// 自己发出的那条不该算「未读」——走 chatAddGift(out) 而非输入栏发送：后者会排一条 TA 的回复链
const b5 = await deliver(`window.chatAddGift({ side: 'out', special: 'gift', giftName: 'V1347 我送出的' })`);
t('B5 我方发出的一条（out 侧）不算未读：角标不动', b5.dn === 0 && b5.tailSide === 'out', '角标+' + b5.dn + ' 尾条 side=' + b5.tailSide);
// desk-msg 开关关掉：不弹横幅，但角标照增（开关管的是横幅，不是「有没有新消息」）
await ev(`(function(){try{localStorage.setItem('xy-home-v2:default:desk-msg-en','0');localStorage.setItem('xy-home-v2:desk-msg-en','0');}catch(e){}})()`);
const b6 = await deliver(`window.chatAddIn('V1347 关了横幅开关', { initiative: true })`);
t('B6 桌面横幅开关关掉：不弹，但角标照增（#660 那条开关只管横幅）',
  b6.dn === 1 && b6.banner === false, '角标+' + b6.dn + ' 横幅=' + b6.banner + ' 文案=' + JSON.stringify(b6.txt));
await ev(`(function(){try{localStorage.removeItem('xy-home-v2:default:desk-msg-en');localStorage.removeItem('xy-home-v2:desk-msg-en');}catch(e){}})()`);
// #795：桌面页不在屏（用户在设置页）时横幅不弹，而角标照增；回桌面数字还在
// ⚠ 切页本身是异步的（tabs 走下一帧交接，同一个同步回合里 page-phone 还没被置 hidden），
// 所以「切过去」与「测量」之间必须留一拍，否则量到的是切页前的页面状态。
await ev("(function(){var t=document.querySelector('.tab[data-page=\"page-setting\"]');if(t)t.click();})()");
await sleep(700);
const b7raw = String(await ev(`(function(){
  function rd(){var b=document.getElementById('chat-badge');return b?(b.hidden?0:(parseInt(b.textContent,10)||0)):-1;}
  var pp=document.getElementById('page-phone');
  var a=rd();
  window.chatAddSystem('V1347 设置页来卡', { special: 'ask-card', askQuestion: 'V1347 设置页', askStatus: 'pending' });
  var d=document.getElementById('desk-msg'); var midShown=!!(d && !d.hidden);
  var b=rd();
  return JSON.stringify({deskHiddenWhileSetting: !!pp.hidden, midShown: midShown, a:a, b:b});
})()`));
let b7 = {}; try { b7 = JSON.parse(b7raw); } catch (e) {}
await ev("(function(){var t=document.querySelector('.tab[data-page=\"page-phone\"]');if(t)t.click();})()");
await sleep(700);
const b7back = await ev(`(function(){var b=document.getElementById('chat-badge');return b?((b.hidden?0:(parseInt(b.textContent,10)||0))+'|'+String(b.textContent)+'|'+(!document.getElementById('page-phone').hidden)):'x';})()`);
const [b7n, b7txt, b7desk] = String(b7back).split('|');
t('B7 桌面页不在屏（用户在设置页）：横幅不弹（#795）而角标照增，回桌面看得见数字',
  b7.deskHiddenWhileSetting === true && b7.midShown === false && b7.b === b7.a + 1 && Number(b7n) === b7.b && b7desk === 'true',
  '桌面隐藏=' + b7.deskHiddenWhileSetting + ' 当刻横幅=' + b7.midShown + ' n ' + b7.a + '→' + b7.b + '→回桌面 n=' + b7n + '(' + b7txt + ')');

// ---------- C 组：隐藏态（后台）那条链 ----------
const craw = String(await ev(`(function(){
  window.__forceHidden(true);
  function rd(){var b=document.getElementById('chat-badge');return b?(b.hidden?0:(parseInt(b.textContent,10)||0)):-1;}
  var a=rd(); var c0=(window.__bgnCalls||[]).length;
  window.chatAddSystem('V1347 后台查岗卡', { special: 'ask-card', askQuestion: 'V1347 后台', askStatus: 'pending' });
  var b=rd(); var c1=(window.__bgnCalls||[]).length;
  window.__forceHidden(false);
  return JSON.stringify({a:a,b:b,c0:c0,c1:c1});
})()`));
let cr = {}; try { cr = JSON.parse(craw); } catch (e) {}
t('C1 后台来一张卡片：角标照增，且确实进了系统通知闸门（bgNotifyCheck 被调用）',
  cr.b === cr.a + 1 && Number(cr.c1) > Number(cr.c0),
  '角标 ' + cr.a + '→' + cr.b + ' bgNotifyCheck 调用 ' + cr.c0 + '→' + cr.c1);

// ---------- Z 组：全程零 JS 异常 ----------
const je = String(await ev('JSON.stringify((window.__jsErrors||[]).filter(function(s){return String(s).indexOf("via_inject_blocker")<0;}).slice(-3))'));
t('Z1 全程零 JS 异常', je === '[]', je);

const failed = results.filter((r) => !r.ok);
console.log('\nverify-1347-badge-covers-cards（根目录=' + root + '）：' + (results.length - failed.length) + ' 绿 / ' + failed.length + ' 红，共 ' + results.length + ' 条');
if (failed.length) console.log('红项：' + failed.map((f) => f.name).join(' | '));
server.close();
try { chrome.kill(); } catch (e) {}
process.exit(failed.length ? 1 : 0);

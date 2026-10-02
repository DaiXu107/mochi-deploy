// verify-1400-music-invite-both-ways.mjs — #1400 音乐「一起听歌」补齐我这一侧的那一半
//
// 立项（作者 2026-09-29 直派原话）：「缺少设计，缺少我点击某首音乐邀请联系人一起听，联系人可以同意
//   或拒绝，或申请换一首歌」「还缺少我点击按钮让联系马上触发邀请我听某首歌的按钮」。
// 现状判读（改前）：站内只有 TA→我 那一半——`maybeMusicRequest()` 按 `settings.reqProb` 概率弹
//   `openMusicInvitePanel()`；我这一侧零入口。聊天里那张通用邀请字卡（chat.js `sendInviteContent`）
//   文案写的就是「想和你一起听歌」，点完只有一句台词、**不会真的起播**＝用户要的正是这个缺口。
//   「马上触发」也只埋着一颗 音乐设置 → 诊断邀请 → 强制触发一次，而那颗是**随机挑歌**、不是用户点的这首。
// 本批口径（三档照 chat.js 那条邀请的现成掷骰）：同意 60／拒绝 25／申请换一首 15；换那一跳**复用同一个
//   邀请面板**（不另建弹窗、不抢播）＝下一跳仍由用户点「一起听」，与 TA→我 那条一字不差的规矩。
//
// 断言（同一把尺在「tip＋本批」与「纯 tip」两侧各跑一遍；红侧读数即缺口本体）：
//   G 组＝夹具真（开屏真 dismissed、.phone computed visibility=visible，不过闸后面读数一律不算）
//   A 组＝我邀 TA：两颗按钮在／邀请留痕／同意档真的起播（不是只回台词）／拒绝档不改播／
//         申请换一首档弹的是**另一首**且点「一起听」才播／在飞时第二发被挡而落定后第三发照收／
//         回应迟到时人已切桌面 ⇒ 不落到新桌面
//   B 组＝让 TA 邀我听这首：点的这首就是弹的那首／冷却窗内自然触发不弹而按钮照弹（不走概率不等冷却）／
//         面板按钮接线可用（#994：渲染与接线成对）／已有一条待确认时不叠第二条
//   S 组＝逻辑锚在产物里（行为断言的前提）　Z 组＝零未捕获异常、本站资源零 console error
//
// 用法：cd <产物目录> && node build.mjs && node tools/verify-1400-music-invite-both-ways.mjs
//       SERVE_ROOT=<产物目录> 做红绿对照（对照时务必显式传）
//   ⚠ 音频夹具＝本脚本现造的两段 30s 静音 WAV，**以 data: URL 入库**（不走伺服层）。第一版拿
//     http://127.0.0.1 的本地文件当夹具，结果读数与产品完全无关：`music-player.js` 启动时有一条
//     #1036 的整库迁移（`if (/^http:\/\//i.test(m.url)) m.url = https://…`），任何 http 外链歌曲
//     在冷启那一刻都被升成 https ⇒ 本站 http 夹具必吃 ERR_SSL_PROTOCOL_ERROR、networkState=3、
//     readyState=0。当时 A3b 一片红看着像「TA 点头了却没播」，实为夹具假红——同一条路上**用户直接
//     点歌**的读数逐字相同（`tools/tmp-diag-1400.mjs` 量出来的），这才判出病灶不在本批。
//   ⚠ 时长要明显长于一条链跑完的时间：0.25s 的 clip 一进门就播完，`paused` 在稳态也恒真＝又一个假红。
//   ⚠ --autoplay-policy=no-user-gesture-required 是**测试夹具旋钮**（无头里让媒体不必真手势），
//     不是产品分支；两侧同参，判据只取「元素在不在播、src 是不是这一首」。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
console.log('被测根目录 = ' + root);

function toneWav(sec, pad) {
  const rate = 8000, n = rate * sec + (pad || 0);
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(n, 40);
  buf.fill(128, 44);
  return buf;
}
// 两首各 30s（甲 240000 字节／乙 240001＝src 逐字可分辨，谁在播不是猜的）
const URI_A = 'data:audio/wav;base64,' + toneWav(30, 0).toString('base64');
const URI_B = 'data:audio/wav;base64,' + toneWav(30, 1).toString('base64');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function extnameOf(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); }
const server = createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  try {
    let p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extnameOf(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + server.address().port;
const BASE = ORIGIN + '/index.html';

let pass = 0, fail = 0;
const A_ = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n + (x !== undefined ? '  [' + JSON.stringify(x) + ']' : '')); } else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  [' + JSON.stringify(x) + ']' : '')); } return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };

// ===== S 组：逻辑锚先在产物里（否则后面的行为断言就是测了个寂寞）=====
console.log('[S] 逻辑锚');
const mp = read('js/music-player.js');
const html = read('index.html');
A_(mp.indexOf('id="sm-e-ta-ask"') >= 0 && mp.indexOf('inviteTaToListen(id)') >= 0, 'S1 管理音乐那排有「邀请 TA 一起听」且接到了 inviteTaToListen', { ask: mp.indexOf('id="sm-e-ta-ask"') >= 0, wired: mp.indexOf('inviteTaToListen(id)') >= 0 });
A_(mp.indexOf('id="sm-e-ta-inv"') >= 0 && mp.indexOf('forceTaInviteFor(id)') >= 0, 'S2 同一排有「让 TA 邀我听这首」且接到了 forceTaInviteFor');
A_(mp.indexOf("if (roll < 0.6) { accept(say('音乐邀请TA·同意'") >= 0 && mp.indexOf('if (roll < 0.85) {') >= 0, 'S3 三档阈值在（同意 60／拒绝 25／其余＝申请换一首）');
A_(mp.indexOf('openMusicInvitePanel(pick.id, !!currentId)') >= 0, 'S4 换那一跳复用唯一邀请面板（没有另建一层弹窗）');
A_(mp.indexOf('if (myInvitePending) {') >= 0 && mp.indexOf('myInvitePending = false;') >= 0, 'S5 在飞闸在位、回应落地与切桌面两处都交还');
A_(mp.indexOf("return !!(reqData && m && !m.hidden && document.getElementById('sm-req-yes'));") >= 0, 'S6 待确认邀请只在面板真在屏上时才算数（否则被顶掉的那一条会永久锁死入口）');
A_(html.indexOf('你也可以主动邀请 TA 听歌') >= 0 && html.indexOf('音乐</span><span class="lg-count">12</span>') >= 0, 'S7 功能介绍第 10 节补了条、计数跟着走到 12');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const jsErrs = [], consErrs = [];
page.on('pageerror', (e) => jsErrs.push(String((e && e.message) || e)));
page.on('console', (m) => { if (m.type() === 'error') consErrs.push(((m.location && m.location().url) || '?') + ' :: ' + m.text()); });

const ENTER_A = `(function(){var sp=document.getElementById('splash'); if(sp){try{sp.click();}catch(e){}} var e=document.getElementById('splash-enter'); if(e&&!e.hidden)e.click(); return 1;})()`;
const ENTER_B = `(function(){var ms=document.getElementById('splash-mandatory-scroll'); if(ms){ms.scrollTop=ms.scrollHeight; ms.dispatchEvent(new Event('scroll',{bubbles:true}));} var me=document.getElementById('splash-mandatory-enter'); if(me)me.click(); return 1;})()`;
// 聊天里的留痕一律走 chatExportMsgs 数（不靠 #chat-body 画没画——本尺全程停在音乐页）
const MSGS = `(function(){try{var a=window.chatExportMsgs?window.chatExportMsgs():[];return JSON.stringify(a.map(function(m){return (m&&m.text)||'';}));}catch(e){return '[]';}})()`;
const REQNAME = `(function(){var e=document.querySelector('.sm-req-name');return e?e.textContent:'';})()`;
const MASK = `(function(){var m=document.getElementById('tc-mask');return m?!m.hidden:false;})()`;
// 播放判据只取元素真值：在播这一发的 src 是不是这首歌、pause 标志与走到哪儿
const PLAY = `(function(){var o=window.__mochiMusic; if(!o||!o.el) return JSON.stringify({el:0}); var s=o.el.src||''; return JSON.stringify({el:1,paused:o.el.paused,ended:o.el.ended,t:+(o.el.currentTime||0).toFixed(1),rs:o.el.readyState,net:o.el.networkState,which:(s===window.__t00A?'a':(s===window.__t00B?'b':(s?'other':''))),flag:!!window.__musicPlaying});})()`;
const openMenu = (id) => page.evaluate((i) => { const b = document.querySelector('#music-lib-list .sm-song[data-id="' + i + '"] .sm-song-more'); if (b) { b.click(); return 1; } return 0; }, id);
const clickBtn = (sel) => page.evaluate((s) => { const b = document.getElementById(s); if (b) { b.click(); return 1; } return 0; }, sel);
const fixRandom = (v) => page.evaluate((x) => { if (!window.__t00RealRandom) window.__t00RealRandom = Math.random; Math.random = function () { return x; }; return 1; }, v);
const unRandom = () => page.evaluate(() => { if (window.__t00RealRandom) { Math.random = window.__t00RealRandom; window.__t00RealRandom = null; } return 1; });
const countMsg = async (needle) => { const a = JSON.parse(await page.evaluate(MSGS)); return a.filter((t) => t.indexOf(needle) >= 0).length; };
const closePanel = () => page.evaluate(() => { const m = document.getElementById('tc-mask'); if (m) m.hidden = true; });

// ===== 进门＋铺库（两首外链歌，url 指本尺自己伺服的那段 WAV）=====
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
await page.evaluate(ENTER_A); await sleep(600); await page.evaluate(ENTER_B); await sleep(900);
await page.evaluate((pair) => {
  const s = window.storeFor('default');
  s.set('music-library', JSON.stringify([
    { id: 't_A', name: '甲', artist: '歌手甲', url: pair.a, source: 'url', duration: 30, playlistId: 'default', addedAt: Date.now() },
    { id: 't_B', name: '乙', artist: '歌手乙', url: pair.b, source: 'url', duration: 30, playlistId: 'default', addedAt: Date.now() },
  ]));
  s.set('music-playlists', JSON.stringify([{ id: 'spl_default', name: '默认歌单', createdAt: Date.now() }]));
  try { const st = window.activeStore(); st.set('__last-backup', String(Date.now())); st.set('__last-backup-remind', String(Date.now())); } catch (e) {}
  return 1;
}, { a: URI_A, b: URI_B });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
await page.evaluate(ENTER_A); await sleep(600); await page.evaluate(ENTER_B); await sleep(900);
// 「哪一首在播」按逐字 src 判，靠的就是这两枚常量（重载会清掉，所以铺完库再种一次）
await page.evaluate((pair) => { window.__t00A = pair.a; window.__t00B = pair.b; return 1; }, { a: URI_A, b: URI_B });
const phoneVis = await page.evaluate(`(function(){var ph=document.querySelector('.phone');return ph?getComputedStyle(ph).visibility:'nf';})()`);
if (!A_(phoneVis === 'visible', 'G0 夹具硬闸：真的进了应用（.phone computed visibility = visible）', { phoneVis })) {
  console.log('夹具没进场——后续读数一律不作数'); console.log('SUMMARY ' + pass + ' 绿 / ' + fail + ' 红');
  await browser.close(); server.close(); process.exit(2);
}
const nav = await page.evaluate(() => { const a = document.querySelector('.app[data-app="music"]'); if (a) a.click(); const p = document.getElementById('page-music'); return p ? !p.hidden : false; });
await sleep(1200);
const rows = await page.evaluate(() => document.querySelectorAll('#music-lib-list .sm-song').length);
A_(nav && rows === 2, 'G1 音乐页打开、库里有两首歌（甲／乙）', { nav, rows });

// ===== A 组：我邀 TA 一起听 =====
console.log('[A] 我邀 TA 一起听（同意／拒绝／申请换一首）');
const m1 = await openMenu('t_A');
const btns = await page.evaluate(() => { const a = document.getElementById('sm-e-ta-ask'), b = document.getElementById('sm-e-ta-inv'); return { ask: !!a, inv: !!b, askTxt: a ? a.textContent : '', invTxt: b ? b.textContent : '' }; });
A_(m1 === 1 && btns.ask && btns.inv, 'A1 那首歌的「管理音乐」里有两颗按钮（红侧＝一颗都没有＝我这一侧零入口）', btns);

await fixRandom(0.1);            // 0.1 ⇒ 延迟 1750ms、roll=0.1＜0.6 ⇒ 同意档
await clickBtn('sm-e-ta-ask'); await sleep(700);
const inv1 = await countMsg('一起听《甲》');
A_(inv1 >= 1, 'A2 点「邀请 TA 一起听」→ 聊天里当场留下「你邀请 X 一起听《甲》」', { inv1 });
await sleep(3200);
const p1 = JSON.parse(await page.evaluate(PLAY));
const ok1 = await countMsg('TA 同意了一起听');
await unRandom();
A_(ok1 >= 1, 'A3a 同意档：TA 点头后有那句留痕（红侧＝只有台词、没人真播）', { ok1 });
A_(p1.el === 1 && p1.which === 'a' && p1.paused === false && p1.t > 0, 'A3b 同意档＝真的起播这一首（元素 src 指甲、没在暂停且已走表）', p1);

await fixRandom(0.7);            // 0.7 ⇒ 0.6≤roll＜0.85 ⇒ 拒绝档（⚠ 每一档都要睡过「最长那一发延迟」＝1500+0.9×2500≈3.75s，睡少了量到的是「还没落地」而不是「没这档」）
await openMenu('t_A'); await clickBtn('sm-e-ta-ask'); await sleep(4400); await unRandom();
const rej = await countMsg('这次没答应');
const p2 = JSON.parse(await page.evaluate(PLAY));
A_(rej >= 1 && p2.which === 'a' && p2.paused === false && (await page.evaluate(MASK)) === false, 'A4 拒绝档：留痕有、面板不出、正在播的那首没被改动', { rej, which: p2.which, paused: p2.paused, t: p2.t });

await fixRandom(0.9);            // 0.9 ⇒ 申请换一首；同一发随机数决定「换哪一首」＝others[0]＝乙
await openMenu('t_A'); await clickBtn('sm-e-ta-ask'); await sleep(4400); await unRandom();
const mask3 = await page.evaluate(MASK);
const req3 = await page.evaluate(REQNAME);
A_(mask3 === true && /乙/.test(req3) && !/甲/.test(req3), 'A5a 申请换一首＝弹的是**另一首**（复用 TA 那套邀请面板：没另建弹窗、也没抢播）', { mask3, req3 });
const yes3 = await clickBtn('sm-req-yes'); await sleep(1800);
const p3 = JSON.parse(await page.evaluate(PLAY));
A_(yes3 === 1 && p3.which === 'b' && p3.paused === false, 'A5b 换那一跳仍由用户点「一起听」才播（点了就播乙）', { which: p3.which, paused: p3.paused });

// 换一首那一发把 cooldownAt 记上了 ⇒ 此刻「冷却窗内自然触发不弹」是可测的
await fixRandom(0.001);          // 概率档必中（5%×0.001），只可能被冷却闸挡下
const pre4 = await page.evaluate(MASK);
await page.evaluate(() => { try { window.maybeMusicRequest(); } catch (e) {} }); await sleep(900);
const mid4 = await page.evaluate(MASK);
await openMenu('t_A'); await clickBtn('sm-e-ta-inv'); await sleep(700);
const post4 = await page.evaluate(MASK);
const req4 = await page.evaluate(REQNAME);
await unRandom();
A_(pre4 === false && mid4 === false, 'B2a 冷却窗内自然触发不弹（把「等概率／等冷却」与「马上」这两条路分开）', { pre4, mid4 });
A_(post4 === true && /甲/.test(req4), 'B2b 同一时刻「让 TA 邀我听这首」照弹，且弹的就是我点的那首（红侧＝这颗按钮不存在）', { post4, req4 });

// 在飞闸：第一发还没落地时第二发被挡；落定之后第三发照收（＝不是掐表不许再试）
// 计数口径：同意那句留痕逐字也含「你邀请 」（它是同一句话的后半段），所以「发出过几发邀请」
// 只能按 差值 问——拿单一句式数会把每一发同意算成两次点按（第一版就是这么假红的）。
await closePanel();
await fixRandom(0.1);
const invCount = async () => (await countMsg('你邀请 ')) - (await countMsg('TA 同意了一起听'));
const before6 = await invCount();
await openMenu('t_A'); await clickBtn('sm-e-ta-ask'); await sleep(500);
await openMenu('t_B'); await clickBtn('sm-e-ta-ask'); await sleep(600);
const during6 = await invCount();               // 第一发的留痕已同步落下，第二发该被在飞闸挡掉
await sleep(3000);                               // 第一条落定
const after6a = await invCount();
await openMenu('t_B'); await clickBtn('sm-e-ta-ask'); await sleep(700);
const after6b = await invCount();
const acc6 = await countMsg('TA 同意了一起听');
await sleep(4400); await unRandom();
A_(during6 === before6 + 1 && after6a === during6 && after6b === after6a + 1, 'A6 在飞时第二发被挡、落定后第三发照收（红侧＝要么叠三条要么掐 20s 不许再邀）', { before6, during6, after6a, after6b, acc6 });

// 回应迟到时人已切桌面 ⇒ 那条回应不许写到新桌面（同 #994 的串写闸）
await closePanel();
await fixRandom(0.1);
const before7 = await countMsg('TA 同意了一起听');
await openMenu('t_A'); await clickBtn('sm-e-ta-ask'); await sleep(400);
const cid = await page.evaluate(() => { window.__t00Cid = window.__activeCid; window.__activeCid = '__t00_other__'; return String(window.__t00Cid); });
await sleep(3200);
await page.evaluate(() => { window.__activeCid = window.__t00Cid; });
const after7 = await countMsg('TA 同意了一起听');
const mask7 = await page.evaluate(MASK);
const p7 = JSON.parse(await page.evaluate(PLAY));
await unRandom();
A_(after7 === before7 && mask7 === false && p7.which === 'b', 'A7 回应落地时已切联系人＝不落到这一桌（留痕不补、面板不弹、播着的乙不被抢切）', { before7, after7, mask7, which: p7.which, cid });

// ===== B 组：让 TA 马上邀我听这一首 =====
console.log('[B] 让 TA 马上邀我听这一首');
await closePanel();
await openMenu('t_B'); await clickBtn('sm-e-ta-inv'); await sleep(700);
const reqB1 = await page.evaluate(REQNAME);
A_(/乙/.test(reqB1), 'B1 点「让 TA 邀我听这首」＝面板里那首就是我点的乙（诊断那颗是随机挑，不是这一首）', { reqB1 });
const yesB = await clickBtn('sm-req-yes'); await sleep(1800);
const pB = JSON.parse(await page.evaluate(PLAY));
A_(yesB === 1 && pB.which === 'b' && pB.paused === false && pB.flag === true, 'B3 面板按钮接线可用（#994：渲染与接线成对，只画按钮＝点了没反应）', pB);
// 「屏上已有邀请时不叠第二条」这一发在 UI 上不可达（两层面板共用同一个 tc 层，入口按钮随之没了），
// 可达的反而是另一头：邀请被别的面板顶掉之后 reqData 还挂着——那一刻谁也答不了它。所以这一条问的是
// 「不许拿一条永远答不了的邀请把入口锁死」（红侧＝第二次点只报「已经有一条等你确认」而屏幕上根本没有邀请）。
await openMenu('t_A'); await clickBtn('sm-e-ta-inv'); await sleep(600);
const reqB4 = await page.evaluate(REQNAME);
const onScreen4 = await page.evaluate(() => !!document.getElementById('sm-req-yes'));
await openMenu('t_B'); const gotInv = await clickBtn('sm-e-ta-inv'); await sleep(600);
const reqB4b = await page.evaluate(REQNAME);
const yesB4b = await page.evaluate(() => !!document.getElementById('sm-req-yes'));
A_(gotInv === 1 && onScreen4 === true && /甲/.test(reqB4) && /乙/.test(reqB4b) && yesB4b === true, 'B4 被别的面板顶掉的邀请不许把这两个入口永久锁死', { reqB4, reqB4b, onScreen4, yesB4b });

console.log('[Z] 异常面');
const local = consErrs.filter((s) => s.indexOf(ORIGIN) === 0);
A_(jsErrs.length === 0, 'Z1 全程零未捕获异常（pageerror）', jsErrs.slice(0, 3));
A_(local.length === 0, 'Z2 本站资源零 console error（外链探知的噪音只按同一源计）', local.slice(0, 3));

console.log('SUMMARY ' + pass + ' 绿 / ' + fail + ' 红');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);

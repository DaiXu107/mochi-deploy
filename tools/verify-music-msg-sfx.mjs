// ===== 回归脚本（#673）：音乐播放时不该出现「消息提示音」、TA 暂停互动不该反复打断 =====
// 用法：node build.mjs && node tools/verify-music-msg-sfx.mjs
// 背景（用户报障 vivo iQOO Z9x Edge，明说其他设备型号也有；要求不要覆盖修改引发跨机型回归）：
//   「导入的歌曲里播放时出现消息提示音。不管是什么音乐，点击播放音乐，在播放的同时出现消息的
//     提示音，无法正常播放音乐」。
// 根因：音乐互动台词（暂停/恢复/收藏/切歌/随机/换模式/预订/一起听邀请）漏了全站互动功能既有的
//   silent 约定（小游戏/拍卖会/摸鱼等十余处都传 silent:true），被 v3.26.x「单聊 addIn 统一播
//   音效」接进了响铃通道——听歌时每掷中一次概率就响一次提示音盖在音乐上；其中「TA 暂停再播放」
//   还会把音乐真停 3.5 秒，而用户点播放打断这次互动时不记账（同歌/下一首还能再掷中）＝反复打断。
// 验证：
//   A 组 源码锚：所有音乐互动台词都走 taMusicSys/taMusicSay，两个助手都带 silent:true，
//              产物里不存在裸的音乐互动 chatAddSystem 台词。
//   B 组 行为（真实播放本地导入歌 + 概率 100%）：
//     B1 概率 100% 播本地歌 → 聊天出现「TA 暂停播放」字卡（功能仍在，未被改坏）
//     B2 3.5s 后出现「TA 恢复播放」字卡（功能仍在）
//     B3 「TA 收藏了歌曲《…》」系统消息照常进聊天（功能仍在）
//     B4 【核心】音乐互动消息一律以 silent 送达 + 消息时刻 ±1.5s 内没有任何 playSfx 调用
//     B5 【核心】普通 TA 对话消息（非音乐互动）照常响「联系人发送和回复消息」音效（没被整体关掉）
//     B6 【核心】用户点播放打断 TA 暂停互动后，同一首歌再播不再被暂停（修复前会再触发）
//     B7 零 JS 异常
// verify-suite:timeout=300000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
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

// 8-bit PCM WAV（长音：判定窗口 10~25s，200s 保证全流程不自然结束）
function makeWavDataUrl(seconds, sr) {
  const n = sr * seconds;
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) buf.writeUInt8(128 + Math.round(Math.sin(i / sr * 440) * 20), 44 + i);
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-musicsfx-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// —— 注入：音效开启（「联系人发送和回复消息」=气泡）+ playSfx / chatAddSystem / chatAddIn 全量记账 ——
const boot = `
(function () {
  window.__ev = [];
  var t0 = Date.now();
  function stamp() { return Date.now() - t0; }
  function wrap(name, rec) {
    var impl = null;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { var f = impl; if (!f) return function () {}; return function () { try { rec.apply(null, arguments); } catch (e) {} return f.apply(this, arguments); }; },
        set: function (fn) { impl = fn; }
      });
    } catch (e) {}
  }
  wrap('playSfx', function (type) { window.__ev.push({ k: 'sfx', type: String(type), t: stamp() }); });
  wrap('chatAddSystem', function (text, opts) { window.__ev.push({ k: 'sys', text: String(text).slice(0, 40), silent: !!(opts && opts.silent), t: stamp() }); });
  wrap('chatAddIn', function (text, opts) { window.__ev.push({ k: 'in', text: String(text).slice(0, 40), silent: !!(opts && opts.silent), t: stamp() }); });
  window.onerror = function (m, s, l) { window.__ev.push({ k: 'err', text: String(m).slice(0, 120) + ' @' + l }); };
  window.addEventListener('unhandledrejection', function (e) { window.__ev.push({ k: 'rej', text: String(e && e.reason).slice(0, 120) }); });
})();
`;
const seed = `
(function () {
  try {
    var S = window.activeStore();
    S.set('sfx-in-b', 'bubble');
    S.set('sfx-out-b', 'tick');
  } catch (e) {}
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });

async function openMusic() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(500);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(500);
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-music');});var t=document.querySelector('#page-music .fav-tab[data-mtab=\"lib\"]');if(t)t.click();return true;})()");
  await sleep(500);
}
// 预置本地歌（IDB 音频 + 库条目）与音乐设置
async function seedSongs(songs, gs) {
  const payload = JSON.stringify({ songs, gs: gs || null }).replace(/'/g, "\\'");
  return evalJs("(async function(){var d=" + payload + ";" +
    "if(window.idbSet){for(var i=0;i<d.songs.length;i++){await window.idbSet('xy-home-v2:default:music-file:'+d.songs[i].id, d.songs[i].wav);}}" +
    "window.activeStore().set('music-library',JSON.stringify(d.songs.map(function(s){return {id:s.id,name:s.name,artist:'',url:'',source:'local',duration:s.dur||200,playlistId:'default',addedAt:Date.now()};})));" +
    "if(d.gs)window.activeStore().set('music-global',JSON.stringify(d.gs));" +
    "return true;})()");
}
const msgs = () => evalJs("(function(){try{return JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs')||'[]');}catch(e){return [];}})()");
const textsOf = (arr) => (Array.isArray(arr) ? arr : []).map(m => m && (m.text || '') || '').join('|');
// __ev 是 append-only 全量账本（音效/系统消息/字卡/异常），不会被 IDB 数据恢复重写；
// 用 localStorage chat-msgs 做计数源不可靠（B3/B6 曾因运行中途被重写/归零而误红）。B 组统一从这里数。
const evInTexts = () => evalJs("(window.__ev||[]).filter(function(e){return e.k==='in';}).map(function(e){return e.text||'';}).join('|')");
const evSysInTexts = () => evalJs("(window.__ev||[]).filter(function(e){return e.k==='sys'||e.k==='in';}).map(function(e){return e.text||'';}).join('|')");
const PAUSE_RE = /先暂停一下|让音乐停一会儿|先搁一搁|我有话想跟你说|陪我一下下|按下了暂停键/;
const RESUME_RE = /继续听吧|按了播放|等急了|音乐继续|按下了播放键|说完啦/;
const clickSong = (id) => evalJs("(function(){var r=document.querySelector('#music-lib-list .sm-song[data-id=\"" + id + "\"]');if(r){r.click();return true;}return false;})()");
// 轮询等某个特征出现；命中返回耗时 ms，超时返回 -1
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return Date.now() - t0;
    await sleep(300);
  }
  return -1;
}

console.log('--- #673 音乐播放提示音 / TA 暂停互不打断 验证（root=' + root + '）---');

// —— A 组：源码锚（直接读产物 index.html）——
const html = readFileSync(join(root, 'index.html'), 'utf8');
check('A1 音乐互动统一走静默通道助手（taMusicSys 在位）', html.includes('function taMusicSys(text) {'));
check('A2 字卡通道助手（taMusicSay 在位）', html.includes('function taMusicSay(text) {'));
check('A3 助手带 silent:true（两条都在）',
  html.includes("window.chatAddSystem(text, { silent: true })") && html.includes("window.chatAddIn(text, { silent: true })"));
// 音乐互动台词逐条：必须走 taMusicSys/taMusicSay（静默），不能直连 window.chatAddSystem（响铃）
const MUSIC_LINES = [
  "name + ' 收藏了歌曲《'", "nm + ' 暂停了音乐'", "nm + ' 又播放了音乐'",
  "name + ' 预订了下一首要听的歌：《'", "name + ' 切到了下一首《'",
  "name + ' 随机挑了一首《'", "name + ' 把播放模式换成了'", "name + ' 想和你一起听《'",
];
const routed = MUSIC_LINES.filter(l => html.includes('taMusicSys(' + l));
const ringing = MUSIC_LINES.filter(l => html.includes('window.chatAddSystem(' + l));
check('A4 音乐互动台词逐条改走静默助手（' + routed.length + '/' + MUSIC_LINES.length + '）且无一条直连响铃通道',
  routed.length === MUSIC_LINES.length && ringing.length === 0,
  { routed: routed.length, ringing });
check('A4b 暂停/恢复两张字卡也走静默（taMusicSay(m)）', html.includes('taMusicSay(m);'));
check('A4c 一起听邀请/接受/拒绝三条同样静默',
  html.includes('taMusicSys(askMsg);') && html.includes('taMusicSys(accMsg);') && html.includes("taMusicSys('你拒绝了 ' + name"));
check('A7 chatAddSystem 透传 silent（吞掉＝所有 chatAddSystem(..., { silent:true }) 重新失效，本批核心根因之一）',
  html.includes("special: opts.special || 'poke', silent: opts.silent, img: opts.img"));
check('A5 用户打断互动时记账（bookTaPauseFired 在位）', html.includes('function bookTaPauseFired(id) {'));
check('A6 打断记账接线（cancelTaPause 内按已触发态记账）',
  html.includes('if (taPauseActive && taPauseFiredId) bookTaPauseFired(taPauseFiredId);'));

// —— 种子 + 打开音乐页 ——
const wav = makeWavDataUrl(200, 8000);
await openMusic();
await evalJs(seed);
await evalJs("(function(){window.__ev.length = 0; window.__evT0 = Date.now(); return true;})()");
await seedSongs([
  { id: 'v673_a', name: '验证歌A', dur: 200, wav: wav },
  { id: 'v673_b', name: '验证歌B', dur: 200, wav: wav },
], { taPauseProb: 100, taFavProb: 100, taReserveProb: 0, taNextProb: 0, taRandProb: 0, taModeProb: 0, reqProb: 0, cooldownMs: 0 });
await openMusic();
await evalJs(seed);
await evalJs("(function(){window.__ev.length = 0; window.__evT0 = Date.now(); return true;})()");

// —— B1~B4：播歌A（暂停互动 100% + 收藏 100%）——
const clicked = await clickSong('v673_a');
let playing = false;
for (let i = 0; i < 20; i++) { await sleep(300); if (await evalJs('!!window.__musicPlaying')) { playing = true; break; } }
check('B0 点击本地导入歌开始播放', !!clicked && playing, { clicked, playing });

const pauseAt = await waitFor(async () => PAUSE_RE.test(await evInTexts()), 32000);
check('B1 概率 100% 时 TA 暂停互动照常触发（聊天出现「暂停播放」字卡）', pauseAt >= 0, { pauseAt });
const resumeAt = await waitFor(async () => RESUME_RE.test(await evInTexts()), 12000);
check('B2 3.5s 后出现「TA 恢复播放」字卡（互动链路未被动过）', resumeAt >= 0, { resumeAt });
let favAt = await waitFor(async () => /收藏了歌曲/.test(await evSysInTexts()), 32000);
if (favAt < 0) {
  // 去竞态重试：收藏定时器（点播后 10~25s）若恰落在 TA 暂停互动的 3.5s 静音窗内，
  // 按产品设计「听歌中途暂停不再收藏」会放弃且不重排（scheduleTaFavCheck 只在
  // playTrack 时挂）＝本次播放收藏被吞，属时序巧合而非回归。重播同一首歌＝重新
  // 挂定时器；该歌的暂停互动已在 B1 触发并被 #673 记账（同歌再播不再暂停），
  // 第二遍没有暂停窗，收藏必在 10~25s 内照常触发。
  await clickSong('v673_a');
  await waitFor(async () => evalJs('window.__musicPlaying === true'), 8000);
  favAt = await waitFor(async () => /收藏了歌曲/.test(await evSysInTexts()), 34000);
}
check('B3 「TA 收藏了歌曲《…》」照常进聊天（收藏链路未被动过）', favAt >= 0, { favAt });

// 核心：音乐互动事件明细 + 音效时间线
const ev = await evalJs('JSON.stringify(window.__ev || [])');
const evs = JSON.parse(ev || '[]');
const musicMsgs = evs.filter(e => (e.k === 'sys' || e.k === 'in') && /暂停了音乐|又播放了音乐|收藏了歌曲|按下了暂停键|按下了播放键|先暂停一下|让音乐停一会儿|先搁一搁|陪我一下下|继续听吧|按了播放|音乐继续|说完啦|等急了|想和你一起听|切到了下一首|随机挑了一首|预订了下一首|把播放模式换成了/.test(e.text || ''));
const notSilent = musicMsgs.filter(e => !e.silent);
check('B4a 音乐互动消息全部以 silent 送达（修复前 silent 全为 false/undefined）',
  musicMsgs.length > 0 && notSilent.length === 0,
  { total: musicMsgs.length, notSilent: notSilent.map(e => e.text) });
const sfxCalls = evs.filter(e => e.k === 'sfx' && e.type === 'in');
const nearSfx = sfxCalls.filter(s => musicMsgs.some(m => Math.abs((m.t || 0) - (s.t || 0)) <= 1500));
check('B4b 【核心】音乐互动消息时刻 ±1.5s 内没有任何「消息提示音」（修复前恰有 4 次）',
  nearSfx.length === 0,
  { sfxTotal: sfxCalls.length, near: nearSfx.length, sfxT: sfxCalls.map(s => s.t) });

// —— B5：对照——普通 TA 对话消息仍响音效（没把音效通道整体关掉）——
await evalJs("window.chatAddIn('验证用：在吗'); true");
await sleep(400);
const afterChat = await evalJs('(window.__ev||[]).filter(function(e){return e.k==="sfx"&&e.type==="in";}).length');
check('B5 普通 TA 对话消息照常响「联系人发送和回复消息」音效（未误伤正常消息音）',
  afterChat > sfxCalls.length,
  { before: sfxCalls.length, after: afterChat });

// —— B6：用户点播放打断 TA 暂停互动后，同一首歌再播不再被打断（#673 记账修复）——
// 用歌B：等音频真的被 TA 暂停（轮询 __musicPlaying===false，120ms 粒度，命中后立刻点播放＝用户自然反应），
// 再重播同一首歌——修复后本次互动已记账（该歌不再触发），修复前不留痕、同歌会再次被暂停。
const countPauseCards = async () => ((await evInTexts()).match(new RegExp(PAUSE_RE.source, 'g')) || []).length;
await clickSong('v673_b');
await waitFor(async () => evalJs('window.__musicPlaying === true'), 8000);
const pausedAt = await (async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 32000) {
    if (await evalJs('window.__musicPlaying === false')) return Date.now() - t0;
    await sleep(120);
  }
  return -1;
})();
await evalJs("(function(){var b=document.getElementById('sm-play');if(b)b.click();return !!b;})()");
await sleep(900);
const resumedAfterInterrupt = await evalJs('window.__musicPlaying === true');
const pauseCountBefore = await countPauseCards();
await clickSong('v673_b');
await sleep(32000);
const pauseCountAfter = await countPauseCards();
check('B6 【核心】用户打断过 TA 暂停互动后，同一首歌再播不再被暂停（修复前会再次触发）',
  pausedAt >= 0 && resumedAfterInterrupt && pauseCountAfter === pauseCountBefore,
  { pausedAt, resumedAfterInterrupt, before: pauseCountBefore, after: pauseCountAfter });

// —— B7：零 JS 异常 ——
const errs = evs.filter(e => e.k === 'err' || e.k === 'rej');
const errs2 = JSON.parse(await evalJs('JSON.stringify((window.__ev||[]).filter(function(e){return e.k==="err"||e.k==="rej";}))') || '[]');
check('B7 零未捕获 JS 异常', errs.length === 0 && errs2.length === 0, errs.concat(errs2).map(e => e.text).slice(0, 3));

try { chrome.kill(); } catch (e) {}
server.close();
const failed = results.filter((r) => !r.ok);
console.log('\n结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
if (failed.length) { console.log('未通过：' + failed.map((f) => f.desc).join(' | ')); process.exit(1); }

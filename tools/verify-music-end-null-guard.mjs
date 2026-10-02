// ===== #928 回归脚本：曲尾「进度定时器先于 ended 抓到」不得撞空指针（reading 'duration'）=====
// verify-suite:timeout=240000   ← 两次冷启动 ＋ 一曲降速播完（约 8s）＋ 切歌复核
// 用法：node tools/verify-music-end-null-guard.mjs
//       MOCHI_ROOT=<产物目录> node tools/verify-music-end-null-guard.mjs   # 对任意产物复跑（红/绿副本）
//
// 需求来源（真机实录）：华为 nova12 活力版 + Edge 诊断包「最近错误 20 条」全部同一条
//   Uncaught TypeError: Cannot read properties of null (reading 'duration')
//   at .../mochi/:57705:12  ← v3.26.731 内联产物里正是 startProgress 的 500ms 定时器回调那一行。
//
// 根因（src/js/music-player.js 的 startProgress）：回调 `if (!audio) return; checkAutoEnd(); if (!audio.duration) return;`
//   ——checkAutoEnd() 在曲尾（currentTime >= duration-0.15）会同步走 handleEnded → next → playTrack → teardownAudio，
//   teardownAudio 同步把模块级 audio 置 null；本地歌下一首要走 idbGet 异步读，控制流回到回调时 audio 仍是 null
//   ⇒ 下一行 `!audio.duration` 抛 TypeError。回调开头判过一次 !audio，没判 checkAutoEnd 之后的再置空。
//
// 复现设计（不 mock 状态，走真实内核）：
//   · 夹具＝两首本地歌（source:'local'），音频 Blob 用 window.idbSet 只写 IDB（LS 副本留空）⇒ 必走异步读，
//     与真机（几 MB 本地歌只剩 IDB 权威）同一条链路；
//   · 曲尾竞态要「定时器 tick 先于 ended 事件」才触发：把 audio.playbackRate 降到 0.125——
//     曲尾前 0.15s 的墙钟窗口＝0.15/0.125＝1.2s ＞ 定时器 500ms 间隔 ⇒ 必然有 tick 落进窗口（鸽笼原理）。
//   · P3 前提防止「ended 自然收尾」蒙混过关：A 元素若派发过 ended 事件＝本次没构成竞态命中，脚本按前提失败报红。
//
// 断言（修复后应为全绿）：
//   F0 夹具隔离/异步链路（恰 2 首本地歌，且 LS 副本不可信 ⇒ 点播只能走 idbGet 异步读）· P1 曲在播
//   · P2 降速生效 · P3 曲尾由定时器抓到（A 元素全程无 ended 事件）；
//   S1 产物锚（js/music-player.js 含 #928 重判守卫）；
//   R1 零 reading 'duration' 异常（判别点：纯 HEAD 红副本应 ≥1 条）；
//   R2 曲尾照常自动切下一首 B 并在播（next() 在抛错之前已调用，红绿两侧同值）。
//
// ⚠ 无头实测两条坑（2026-09-20，别再踩）：
//   ① app 自带的 window.__jsErrors 在 headless 恒为空（不采集）——R1 必须以自注入的
//      window.addEventListener('error') 采集（__mgErr）为准，__jsErrors 只打印参考；
//   ② 媒体事件不看「最近 N 条」窗口（ended 会滚出窗口 ⇒ P3 误判）——用全量 __endedSeqs 台账。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_ROOT || here);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（全局 WebSocket）'); process.exit(1); }

// —— 现生成的合法静音 WAV（8kHz/8bit/mono/1.0s）：够长能起播、够短跑得快 ——
function wavBuffer(seconds) {
  const rate = 8000, n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(n, 40);
  buf.fill(0x80, 44); // 8bit 无符号的「零」
  return buf;
}
const WAV = wavBuffer(1);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/__tail.wav') {
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(WAV.length), 'Accept-Ranges': 'bytes' });
    return res.end(WAV);
  }
  try {
    let p = normalize(join(root, u === '/' ? 'index.html' : u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const profileDir = join(process.env.TEMP || '/tmp', 'mochi-mend-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9820 + Math.floor(Math.random() * 80));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  // 本脚本测的是曲尾定时器竞态，不是手势闸：放开自动播放，避免把 AutoplayPolicy 误当成缺陷
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--user-data-dir=' + profileDir,
  '--remote-debugging-port=' + cdpPort,
  'about:blank',
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 80; i++) {
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
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

// ---------- 夹具 ----------
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? '  PASS ' : '  FAIL ') + desc + (detail === undefined ? '' : '  → ' + JSON.stringify(detail).slice(0, 260)));
}
const A_ID = 'mend-a', B_ID = 'mend-b';
const RATE = 0.125; // 曲尾窗 0.15/RATE = 1.2s ＞ 500ms tick ⇒ 竞态必然命中

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 每次新文档都装：媒体台账（元素序号 + 事件，判「曲尾由定时器抓到」要靠 A 元素有没有 ended 事件）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__mediaEvents = [];
  window.__mgSeq = 0;
  window.__mgErr = [];
  window.__endedSeqs = [];
  // 无头实测：app 的 __jsErrors 在 headless 恒空（不采集）⇒ 判别点必须自采
  window.addEventListener('error', function (e) { try { window.__mgErr.push(String((e && e.message) || e)); } catch (x) {} });
  window.addEventListener('unhandledrejection', function (e) { try { window.__mgErr.push('rej:' + String((e && e.reason && e.reason.message) || (e && e.reason) || e)); } catch (x) {} });
  (function () {
    var Native = window.Audio;
    if (!Native) return;
    function Wrapped() {
      var el = new Native();
      try {
        el.__mgSeq = ++window.__mgSeq;
        window.__mediaEvents.push('new#' + el.__mgSeq);
        ['play', 'playing', 'pause', 'ended', 'loadeddata', 'error'].forEach(function (ev) {
          el.addEventListener(ev, function () {
            var s = String(el.currentSrc || el.src || '');
            window.__mediaEvents.push(ev + '#' + el.__mgSeq + ':' + s.slice(-14) + ':' + (Math.round(el.currentTime * 1000) / 1000));
            if (ev === 'ended') window.__endedSeqs.push(el.__mgSeq); // 全量台账，P3 不受事件窗滚出影响
          });
        });
      } catch (e) {}
      return el;
    }
    Wrapped.prototype = Native.prototype;
    window.Audio = Wrapped;
  })();
` });

async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  // 开屏与随机浮层会抢点击/盖住文案（见 headless-verify-overlay-hazard）
  await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
  await sleep(300);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
  await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
}

await gotoApp();

const seeded = await evalJs(`(async function(){
  try {
    var s = window.storeFor('default');
    var now = Date.now();
    var lib = [
      { id: ${JSON.stringify(A_ID)}, name: '取证-曲尾甲', artist: 'mock', source: 'local', duration: 1, playlistId: 'default', addedAt: now },
      { id: ${JSON.stringify(B_ID)}, name: '取证-曲尾乙', artist: 'mock', source: 'local', duration: 1, playlistId: 'default', addedAt: now + 1 }
    ];
    s.set('music-library', JSON.stringify(lib));
    s.set('music-playlists', JSON.stringify([{ id: 'default', name: '取证歌单' }]));
    s.set('music-default-done', '1');
    // TA 互动（曲尾抢播/暂停/收藏）是掷骰子的，会把「下一首是谁」变成随机：全部关掉换确定性
    s.set('music-global', JSON.stringify({ taPauseEn: false, taNextProb: 0, taRandProb: 0, taModeProb: 0, taFavProb: 0, reqProb: 0 }));
    var r = await fetch('/__tail.wav');
    var b = await r.blob();
    await window.idbSet('xy-home-v2:default:music-file:${A_ID}', b);
    await window.idbSet('xy-home-v2:default:music-file:${B_ID}', b);
    var rb = await window.idbGet('xy-home-v2:default:music-file:${A_ID}');
    var lsCopy = s.get('music-file:${A_ID}');
    return 'OK:' + (rb && rb.size ? rb.size : 'null') + ':ls=' + (lsCopy === null || lsCopy === undefined || lsCopy === '' ? 'none' : String(lsCopy).length);
  } catch (e) { return 'ERR:' + (e && e.message); }
})()`);
console.log('夹具写入：' + JSON.stringify(seeded));
if (typeof seeded !== 'string' || seeded.indexOf('OK:') !== 0) { console.error('夹具喂数据失败：' + seeded); process.exit(1); }

// 重新载入让模块把 library 读进闭包（换文档即重读）
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(500);
await gotoApp();

const fixture = await evalJs(`(function(){
  try {
    var n = (JSON.parse(window.storeFor('default').get('music-library') || '[]') || []).length;
    // LS 副本形状：Blob 永远不在 LS（读回只能是字符串）。按 app 同款阈值（≥10 字符）判可信；
    // 不可信（缺省／脏值 '{}'，探针实测 app 自身会写入该占位串）⇒ 点播只能落到 idbGet 异步读，
    // 这正是 #928 竞态的另一半前提（同步命中 LS 就没有异步空窗）。
    var v = window.storeFor('default').get('music-file:${A_ID}');
    var shape = (v === null || v === undefined || v === '') ? 'absent' : (typeof v === 'string' ? 'string:len=' + v.length : typeof v);
    return { tracks: n, lsShape: shape, lsPlausible: (typeof v === 'string' && v.length >= 10) };
  } catch (e) { return { err: e.message }; }
})()`);
console.log('夹具读数：' + JSON.stringify(fixture));
check('F0 夹具前提：恰 2 首本地歌（多出＝上一场景 IDB 回填污染），且 LS 副本不可信（缺省/脏值 ⇒ 必走 idbGet 异步读）',
  fixture && fixture.tracks === 2 && fixture.lsPlausible === false, fixture);

// ---------- 点播 A（本地歌，走 IDB 异步读）----------
await evalJs("(function(){var el=document.querySelector('.app[data-app=\"music\"]');if(el)el.click();return 1;})()");
await sleep(500);
const clicked = await evalJs(`(function(){
  var row = document.querySelector('#music-lib-list .sm-song[data-id="${A_ID}"]') || document.querySelector('.sm-song[data-id="${A_ID}"]');
  if (!row) return 'NO-ROW';
  row.click(); return 'OK';
})()`);
if (clicked !== 'OK') { console.error('点不到取证曲目行（' + clicked + '）——歌单渲染或行选择器变了'); process.exit(1); }

const SNAP = `(function(){
  var el = (window.__mochiMusic && window.__mochiMusic.el) || null;
  var my = (window.__mgErr || []).filter(function (e) { return /duration/.test(String(e)); });
  var txt = function (id) { var e = document.getElementById(id); return e ? (e.innerText || e.textContent || '').trim() : ''; };
  return {
    hasEl: !!el, seq: el ? (el.__mgSeq || 0) : 0,
    paused: el ? el.paused : null, ct: el ? Math.round(el.currentTime * 1000) / 1000 : null,
    dur: el && typeof el.duration === 'number' && isFinite(el.duration) ? Math.round(el.duration * 1000) / 1000 : String(el ? el.duration : ''),
    rate: el ? el.playbackRate : null, rs: el ? el.readyState : null,
    src: el ? String(el.currentSrc || el.src || '').slice(0, 12) : '',
    name: txt('sm-pb-name') || txt('mw-song') || txt('sm-f-name') || '',
    myErrCount: my.length, myErrs: my.slice(-2), myAllCount: (window.__mgErr || []).length,
    legacyErrCount: (window.__jsErrors || []).length,
    endedSeqs: (window.__endedSeqs || []),
    ev: (window.__mediaEvents || []).slice(-24)
  };
})()`;

// 等 A 真的在播（本地歌要先过 idbGet → playLocal → play()）
let s = null, seqA = 0;
for (let i = 0; i < 120; i++) {
  s = await evalJs(SNAP);
  if (s && s.hasEl && s.paused === false && s.ct > 0 && typeof s.dur === 'number' && s.dur > 0.5) { seqA = s.seq; break; }
  await sleep(150);
}
const p1 = !!(s && seqA && s.paused === false && s.ct > 0);
console.log('\n【现场 · A 起播】' + JSON.stringify({ seq: s && s.seq, paused: s && s.paused, ct: s && s.ct, dur: s && s.dur, rs: s && s.rs, rate: s && s.rate, src: s && s.src, name: s && s.name }));
check('P1 前提：A 真在播（本地歌已过 IDB 异步读，元素存在/未暂停/进度在走）', p1, s);

// 降速：把曲尾前 0.15s 的墙钟窗口拉到 1.2s（＞500ms tick）⇒ 竞态必然命中
await evalJs(`(function(){
  var el = (window.__mochiMusic && window.__mochiMusic.el);
  if (el && el.__mgSeq === ${seqA}) el.playbackRate = ${RATE};
  return 1;
})()`);
await sleep(200);
s = await evalJs(SNAP);
check('P2 前提：降速生效（曲尾窗 0.15/' + RATE + '＝1.2s ＞ 定时器 500ms 间隔，tick 必然命中曲尾窗）',
  s && s.rate === RATE, s && { rate: s.rate });

// ---------- 等曲尾：主判据＝定时器先抓到（A 无 ended 事件）----------
let sawCrash = false, bPlaying = false, bAt = 0, last = s, guard = 0;
const t0 = Date.now();
while (Date.now() - t0 < 35000) {
  last = await evalJs(SNAP);
  if (!last) break;
  if (last.myErrCount > 0) sawCrash = true;
  if (last.seq && last.seq !== seqA && last.paused === false && last.ct > 0) { if (!bPlaying) { bPlaying = true; bAt = Date.now(); } }
  if (sawCrash && bPlaying) break;                       // 红：异常 + 已换歌
  if (bPlaying && Date.now() - bAt > 2500) break;        // 绿：换歌后再看 2.5s 无异常
  guard++;
  await sleep(150);
}
const evAny = (last && last.ev) || [];
const endedSeqs = (last && last.endedSeqs) || []; // 全量台账：不受「最近 N 条」窗口滚出影响
const endedForA = endedSeqs.indexOf(seqA) >= 0;
console.log('\n【现场 · 曲尾后】' + JSON.stringify({ seq: last && last.seq, paused: last && last.paused, ct: last && last.ct, name: last && last.name, myErrCount: last && last.myErrCount }));
console.log('  媒体台账: ' + JSON.stringify(evAny));
console.log('  ended 序号台账: ' + JSON.stringify(endedSeqs) + '（A 元素 seq=' + seqA + '）');
console.log('  异常台账[自采/duration/]: ' + JSON.stringify((last && last.myErrs) || []) + '  __jsErrors=' + (last ? last.legacyErrCount : '-') + '（headless 实测恒空，仅参考）');
console.log('  等待轮次=' + guard + ' 用时=' + (Date.now() - t0) + 'ms  sawCrash=' + sawCrash + ' bPlaying=' + bPlaying);

check('P3 前提：曲尾由定时器抓到（A 元素全程没派发 ended 事件——否则是自然收尾，本次不构成竞态命中）',
  p1 && !endedForA, { endedForA, endedSeqs });

const prodPath = join(root, 'js/music-player.js');
let prodTxt = '';
try { prodTxt = readFileSync(prodPath, 'utf8'); } catch (e) { try { prodTxt = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e2) {} }
const NEEDLE = 'if (!audio || !audio.duration) return;\nif (audio.currentTime > 0) clearStallGuard();';
const needleHits = prodTxt ? prodTxt.split(NEEDLE).length - 1 : 0;
check('S1 产物锚：js/music-player.js 含 #928 曲尾重判守卫（checkAutoEnd 之后必须重判 audio 再读 duration）',
  needleHits >= 1, { hits: needleHits, file: prodTxt ? 'js/music-player.js' : '(缺)' });

check('R1 判别点：零 reading \'duration\' 空指针异常（自采 __mgErr；纯 HEAD 红副本应 ≥1 条：定时器先抓到曲尾 = 每次曲尾必抛）',
  last && last.myErrCount === 0, last && { myErrCount: last.myErrCount, myErrs: last.myErrs, legacy: last.legacyErrCount });

check('R2 曲尾照常自动切下一首并在播（next() 在 checkAutoEnd 内已调用，红绿两侧同值；TA 抢播已按夹具关闭）',
  bPlaying, { bPlaying, seq: last && last.seq, seqA, name: last && last.name, paused: last && last.paused, ct: last && last.ct });

// ---------- 收尾 ----------
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果: ' + (results.length - fails) + ' 通过 / ' + fails + ' 失败（共 ' + results.length + ' 条）');
console.log('红绿口径（2026-09-20 实测）：纯 HEAD 仓外副本 ＝ F0/P1/P2/P3/R2 绿、R1/S1 红（reading \'duration\' 至少 1 条）、');
console.log('                               R2 绿（切歌不被异常带走）＝判别点确实落在「重判守卫」上；');
console.log('                               HEAD＋#928 一行修复的绿副本应全绿。');
try { chrome.kill(); } catch (e) {}
// 临时 profile 必须删干净：Chrome 退出是异步的，单次 rmSync 会 EBUSY（静默失败＝TEMP 里堆目录）
let cleaned = false;
for (let i = 0; i < 12 && !cleaned; i++) {
  try { rmSync(profileDir, { recursive: true, force: true }); cleaned = true; }
  catch (e) { await sleep(250); }
}
if (!cleaned) console.log('⚠ 临时 profile 未删净，请手动清理：' + profileDir);
server.close();
process.exit(fails ? 1 : 0);

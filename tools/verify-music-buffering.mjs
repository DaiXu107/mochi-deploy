// ===== #795 回归脚本：音乐「网络缓冲期」必须有可辨识的「缓冲中」态，且切歌不被旧曲拖死 =====
// verify-suite:timeout=300000   ← 前提要真等 12s 停滞守卫 ＋ 三次冷启动，共享套件并发下默认 180s 不够
// 用法：node tools/verify-music-buffering.mjs
//       MOCHI_ROOT=<产物目录> node tools/verify-music-buffering.mjs   # 对任意产物复跑
//       node tools/verify-music-buffering.mjs --only-premise          # 只量现场不断言
//
// 需求（用户原话）：「还缺少音乐加载时的加载动画，有时候会卡住，其实是网络在加载。」
//
// 读码定性（src/js/music-player.js，2026-09-18）：
//   · 桌面小组件那个跳动动画 = #mw-bars.playing rect（home.css:666 bar-bounce），
//     唯一开关是 syncPlayIcons(playing)（:3492），而 playing 真值只来自
//     audio.onplay（:2961）/ audio.onpause（:2964）—— onplay 按定义要等数据到位才触发；
//   · 全文件零个 loadstart/waiting/stalled/canplay/progress 监听（只有 :2206 一个 error），
//     ⇒ 结构上不存在「缓冲中」这一态；
//   · 于是网络取流期（代码自注 :2677：网易云外链 outer/url 302→CDN「可能需 10~30 秒缓冲」）
//     两态必居其一，且两态都说谎：
//       A 态 静止——切歌时 :2804 先 syncPlayIcons(false)，此后直到 onplay 无人再改
//                 ⇒ 灰条不动 + 按钮仍是 ▶ ＝「点了没反应/卡住了」；
//       B 态 跳动——期间任何一次 updatePlayerBar()（:3504 用 audio && !audio.paused 判）
//                 会把动画点亮（play() 一调用 paused 就假，readyState 仍 0）
//                 ⇒ 条在跳、00:00 不走、没声 ＝「看着在播却不动」。
//   · 而 12s 停滞守卫 armStallGuard（:2666）此刻判据是 `readyState>0 || buffered || networkState===2`
//     ⇒ 它认定「还在加载」并重新计时，与 UI 显示的静止恰好相反（两套口径）。
//
// 本脚本怎么取证（不 mock、不伪造状态）：起一台同源 HTTP，`/__stall.mp3` 只回头、永不吐字节
//   ⇒ 真 <audio> 元素自然进入 readyState=0 / networkState=2(LOADING) / buffered 空 / currentTime=0，
//   与真机弱网缓冲是同一内核状态；另用 `/__blip.wav`（脚本现生成的合法静音 WAV）作正向对照，
//   证明动画链路本身是活的、缺陷只出在缓冲态——否则整脚本红等于探针坏了。
//
// 断言写成「修复后应为真」（共 9 条，实测 2026-09-18 run4/5/6 三次同结果）：
//   绿＝M0 夹具隔离 / M1 内核真在加载 / M5 正向对照曲能播 / M7 零 JS 异常；
//   红＝M2 无「缓冲中」专属态 · M3 现状读到 B 态（条跳 + 暂停钮 + 00:00 无声）· M4 媒体事件零消费 · M6 守卫与 UI 两套口径
//        ——这四条即缺陷本体（结构性缺「缓冲」态，不是时序巧合：派发 waiting/stalled/progress 全静默）。
//   红＝M8 附带发现（跑对照场景时撞出来的第二条链路，run4/5/6 三次同结果）：缓冲期切歌后新曲也放不出来。
//        实测媒体台账（脚本内 HTMLMediaElement.play/pause 包装记录）：
//          play:stall → pause:stall（teardownAudio）→ play:blip → play-reject:stall:AbortError
//          → pause:blip → play-reject:blip:AbortError → pause:blip
//        旧元素的 play() 被 teardown 的 removeAttribute+load 打断成 reject（AbortError），其 catch
//        回调一路走到 offerRemoveDamagedSong（:2794）里的 `audio.pause()`（:2803），而此刻模块级 audio
//        已指向**新**元素 ⇒ 刚 play 的新曲被旧曲的失败回调停掉；停掉又让新曲自己的 play() 也 reject，
//        于是同一颗雷炸两次：新曲还挨一句「播放失败（可能为会员/失效歌曲）」＋ failMap 计数（连续 2 次
//        就弹「移出音乐库」）——一首完全正常的歌被判定成坏链。界面上只剩「点了没反应」＝用户说的「有时候会卡住」。
//
// 尚未纳入 npm run verify:all：产品码未修，纳入即全红；修复落地后把本脚本加进 tools/verify-suite.mjs 清单。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_ROOT || here);
const ONLY_PREMISE = process.argv.includes('--only-premise');
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

// —— 现生成的合法静音 WAV（8kHz/8bit/mono/0.5s），正向对照用 ——
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
const WAV = wavBuffer(30); // 够长：采样窗口内不会播完（0.6s 版会在探针前 ended → M5 假红）

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const stallReqs = [];
const server = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/__stall.mp3') {
    // 只回头、永不吐字节 ⇒ 内核按「正在下载」停在 readyState=0
    stallReqs.push(Date.now());
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Transfer-Encoding': 'chunked' });
    return; // 不 res.end()：连接挂着
  }
  if (u === '/__blip.wav') {
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

const profileDir = join(process.env.TEMP || '/tmp', 'mochi-mbuf-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9820 + Math.floor(Math.random() * 80));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  // 本脚本测的是「缓冲态 UI」，不是手势闸：放开自动播放，避免把 AutoplayPolicy 误当成缺陷
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
const STALL_ID = 'mbuf-stall', BLIP_ID = 'mbuf-blip';

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 每次新文档都装：toast 收集器（缓冲期唯一可见反馈就是 toast，2s 即逝）＋基线 JS 异常数
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__toasts = [];
  window.__errBase = (window.__jsErrors || []).length;
  (function poll() {
    var mo = new MutationObserver(function (ms) {
      ms.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) {
        if (!n || !n.nodeName || n.nodeName === 'SCRIPT' || n.nodeName === 'STYLE') return;
        var t = String(n.textContent || '').trim();
        // 只收「像提示条」的短纯文本：注入脚本源码里也含「正在 / 加载」，会被误当成 toast
        if (t.length > 80 || /[{}\\n]/.test(t)) return;
        if (/失败|缓冲|加载|正在|已改用/.test(t)) window.__toasts.push(t.slice(0, 60));
      }); });
    });
    function arm() { if (document.body) mo.observe(document.body, { childList: true, subtree: true }); else setTimeout(arm, 50); }
    arm();
  })();
  // ---- 媒体调用台账：谁调用 play/pause、play() 是否被拒（排除「探针采样时机」类误判）----
  window.__mediaLog = [];
  (function () {
    var P = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (!P) return;
    var op = P.play, opa = P.pause;
    function tag(el) { var s = String(el.currentSrc || el.src || ''); return s ? s.slice(-22) : 'no-src'; }
    P.play = function () {
      var k = tag(this);
      window.__mediaLog.push('play:' + k);
      var pr;
      try { pr = op.apply(this, arguments); } catch (e) { window.__mediaLog.push('play-throw:' + k + ':' + e.name); throw e; }
      if (pr && pr.then) pr.then(function () { window.__mediaLog.push('play-ok:' + k); },
        function (e) { window.__mediaLog.push('play-reject:' + k + ':' + (e && e.name)); });
      return pr;
    };
    P.pause = function () { window.__mediaLog.push('pause:' + tag(this)); return opa.apply(this, arguments); };
  })();
` });

async function clearOrigin() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(600);
  await cdp('Storage.clearDataForOrigin', { origin: new URL(baseUrl).origin, storageTypes: 'all' });
  await sleep(400);
}

async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  // 开屏与随机浮层会抢点击/盖住文案（见 headless-verify-overlay-hazard）
  await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
  await sleep(300);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
  await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
}

await clearOrigin();
await gotoApp();

const seeded = await evalJs(`(function(){
  try {
    var s = window.storeFor('default');
    var lib = [
      { id: ${JSON.stringify(STALL_ID)}, name: '取证-停滞曲', artist: 'mock', url: ${JSON.stringify(baseUrl)} + '/__stall.mp3', source: 'url', duration: 0, playlistId: 'default', addedAt: Date.now() },
      { id: ${JSON.stringify(BLIP_ID)}, name: '取证-出声曲', artist: 'mock', url: ${JSON.stringify(baseUrl)} + '/__blip.wav', source: 'url', duration: 1, playlistId: 'default', addedAt: Date.now() }
    ];
    s.set('music-library', JSON.stringify(lib));
    s.set('music-playlists', JSON.stringify([{ id: 'default', name: '取证歌单' }]));
    s.set('music-default-done', '1');
    return 'OK';
  } catch (e) { return 'ERR:' + e.message; }
})()`);
if (seeded !== 'OK') { console.error('夹具喂数据失败：' + seeded); process.exit(1); }

// 重新载入让模块把 library 读进闭包（换文档即重读，不必再清 origin）
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(500);
await gotoApp();

const fixture = await evalJs(`(function(){
  try {
    var s = window.storeFor('default');
    var n = (JSON.parse(s.get('music-library') || '[]') || []).length;
    var cids = (JSON.parse((window.storeFor('default'), localStorage.getItem('xy-home-v2:contacts') || window.storeFor('default').get('contacts') || '[]')) || []).length;
    return { tracks: n, contacts: cids };
  } catch (e) { return { err: e.message }; }
})()`);
console.log('夹具读数：' + JSON.stringify(fixture));
check('M0 夹具隔离：曲目恰为 2 首（多出＝上一场景 IDB 回填污染，非产品回归）', fixture && fixture.tracks === 2, fixture);

// ---------- 进入缓冲窗口 ----------
await evalJs("(function(){var el=document.querySelector('.app[data-app=\"music\"]');if(el)el.click();return 1;})()");
await sleep(500);
const clicked = await evalJs(`(function(){
  var row = document.querySelector('#music-lib-list .sm-song[data-id="${STALL_ID}"]') || document.querySelector('.sm-song[data-id="${STALL_ID}"]');
  if (!row) return 'NO-ROW';
  row.click(); return 'OK';
})()`);
if (clicked !== 'OK') { console.error('点不到取证曲目行（' + clicked + '）——歌单渲染或行选择器变了'); process.exit(1); }
await sleep(3000);

const SNAP = `(function(){
  var a = (window.__mochiMusic && window.__mochiMusic.el) || document.querySelector('audio');
  var bars = document.getElementById('mw-bars');
  var anim = bars && bars.firstElementChild ? getComputedStyle(bars.firstElementChild).animationName : 'no-el';
  var txt = function (id) { var e = document.getElementById(id); return e ? (e.innerText || e.textContent || '') : ''; };
  var surf = [txt('music-widget'), txt('sm-player-bar'), txt('sm-float'), txt('sm-f-mini')].join(' | ');
  // 曲名/艺人名先从文本里剔掉：夹具叫「弱网缓冲」时探测会被自己的歌名点亮（run1 实测假绿）
  ['sm-pb-name', 'sm-pb-artist', 'mw-song', 'mw-artist', 'sm-f-name', 'sm-f-artist', 'sm-f-mini-name'].forEach(function (id) {
    var t = txt(id); if (t) surf = surf.split(t).join('');
  });
  var ico = ['sm-play-ico', 'sm-f-play-ico', 'sm-f-mini-play-ico', 'mw-play-ico'].map(function (id) {
    var e = document.getElementById(id); return e ? String(e.innerHTML) : '';
  }).join('');
  return {
    hasAudio: !!a,
    paused: a ? a.paused : null, readyState: a ? a.readyState : null, networkState: a ? a.networkState : null,
    buffered: a && a.buffered ? a.buffered.length : null, currentTime: a ? a.currentTime : null,
    barsClass: bars ? (bars.getAttribute('class') || '') : 'no-bars', barsAnim: anim,
    barsVisible: !!(bars && bars.offsetParent !== null),
    btnShowsPause: ico.indexOf('h3.5v13H7') >= 0,
    cur: txt('sm-pb-cur'), saysBuffer: /缓冲|加载中|读取中|正在加载/.test(surf),
    mediaLog: (window.__mediaLog || []).slice(-8),
    toasts: (window.__toasts || []).slice(-6)
  };
})()`;

const s1 = await evalJs(SNAP);
console.log('\n【现场 · 点播 +3s（内核真在加载）】');
console.log('  audio: paused=' + s1.paused + ' readyState=' + s1.readyState + ' networkState=' + s1.networkState + ' buffered=' + s1.buffered + ' currentTime=' + s1.currentTime);
console.log('  动画: #mw-bars class="' + s1.barsClass + '" 首条 animation-name=' + s1.barsAnim + '（bar-bounce＝在跳／none＝静止）可见=' + s1.barsVisible + ' 播放钮＝暂停态(看着在播)?' + s1.btnShowsPause);
console.log('  文案: sm-pb-cur=' + JSON.stringify(s1.cur) + ' 界面含缓冲类提示=' + s1.saysBuffer + ' toast=' + JSON.stringify(s1.toasts));
console.log('  服务端：/__stall.mp3 已被请求 ' + stallReqs.length + ' 次（只回头、永不吐字节）');
console.log('  媒体调用台账: ' + JSON.stringify(s1.mediaLog) + '（无 play-ok＝play 承诺仍挂在网络上，从未落地）');

check('M1 前提坐实：此刻内核确实处在「网络加载中」（未出声、无数据、networkState=LOADING）',
  s1.hasAudio && s1.paused === false && s1.readyState < 3 && s1.buffered === 0 && s1.currentTime === 0, s1);

const showsBuffer = s1.saysBuffer || /buffering|stalling|loading/.test(s1.barsClass);
check('M2 缓冲期存在可辨识的「缓冲中」表达（专属动画类或文案）——现状缺此态', showsBuffer, s1);

// 修复后的判据：要么明说在缓冲，要么至少别谎报
const aLie = s1.barsAnim === 'none' && !s1.btnShowsPause && !showsBuffer;
const bLie = (s1.barsAnim === 'bar-bounce' || s1.btnShowsPause) && s1.currentTime === 0 && s1.readyState < 3 && !showsBuffer;
check('M3 两态说谎已消除：既不是「点着却静止像死了」(A)，也不是「跳着/暂停钮却 00:00 没声」(B)',
  !aLie && !bLie, aLie ? 'A 态：静止且不说在加载' : bLie ? 'B 态：显示在播却零秒无声' : 'ok');

// ---------- 12s 停滞守卫与 UI 是否说相反的话 ----------
await sleep(11500);
const s2 = await evalJs(SNAP);
const guardStillWaiting = !(s2.toasts || []).join(' ').match(/失败|已改用/);
console.log('\n【现场 · 点播 +14.5s】动画=' + s2.barsAnim + ' 缓冲提示=' + s2.saysBuffer + ' toast=' + JSON.stringify(s2.toasts));
check('M6 看门狗与 UI 同一口径：守卫仍在等（未弹失败兜底）时，界面必须也正显示在等',
  !guardStillWaiting || s2.saysBuffer, { guardStillWaiting, saysBuffer: s2.saysBuffer });

// ---------- 正向对照：换新文档再点（A 曲仍挂在加载中，同文档切换会互相干扰）----------
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(500);
await gotoApp();
await evalJs("(function(){var el=document.querySelector('.app[data-app=\"music\"]');if(el)el.click();return 1;})()");
await sleep(500);
await evalJs(`(function(){var r=document.querySelector('#music-lib-list .sm-song[data-id="${BLIP_ID}"]')||document.querySelector('.sm-song[data-id="${BLIP_ID}"]');if(r)r.click();return 1;})()`);
await sleep(800);
const s3a = await evalJs(SNAP);
await sleep(1700);
const s3 = await evalJs(SNAP);
console.log('\n【现场 · 正常对照曲（/__blip.wav，能真出声；新文档单测）】');
console.log('  +0.8s: paused=' + s3a.paused + ' readyState=' + s3a.readyState + ' currentTime=' + s3a.currentTime + ' 动画=' + s3a.barsAnim);
console.log('  +2.5s: paused=' + s3.paused + ' readyState=' + s3.readyState + ' currentTime=' + s3.currentTime + ' 动画=' + s3.barsAnim + ' class=' + s3.barsClass);
console.log('  媒体调用台账: ' + JSON.stringify(s3.mediaLog));
console.log('  toast: ' + JSON.stringify(s3.toasts));
check('M5 正向对照：数据到位后动画真的会跳、进度真的在走（＝A/B 两态的缺陷只出在缓冲态，不是探针坏了）',
  s3.barsAnim === 'bar-bounce' && s3.readyState >= 3 && s3.paused === false && s3.currentTime > 0, s3);

// ---------- 附带发现：缓冲期切歌，旧曲挂死的 play() 拒绝会不会抢停新曲 ----------
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(500);
await gotoApp();
await evalJs("(function(){var el=document.querySelector('.app[data-app=\"music\"]');if(el)el.click();return 1;})()");
await sleep(500);
await evalJs(`(function(){var r=document.querySelector('#music-lib-list .sm-song[data-id="${STALL_ID}"]')||document.querySelector('.sm-song[data-id="${STALL_ID}"]');if(r)r.click();return 1;})()`);
await sleep(2000);
await evalJs(`(function(){var r=document.querySelector('#music-lib-list .sm-song[data-id="${BLIP_ID}"]')||document.querySelector('.sm-song[data-id="${BLIP_ID}"]');if(r)r.click();return 1;})()`);
await sleep(1600);
const s4 = await evalJs(SNAP);
console.log('\n【现场 · 缓冲期切歌（停滞曲 → 出声曲，同一文档）】');
console.log('  paused=' + s4.paused + ' readyState=' + s4.readyState + ' currentTime=' + s4.currentTime + ' 动画=' + s4.barsAnim + ' class=' + s4.barsClass);
console.log('  媒体调用台账: ' + JSON.stringify(s4.mediaLog));
console.log('  toast: ' + JSON.stringify(s4.toasts));
check('M8 缓冲期切歌不被旧曲拖死：切到可播曲目后应真的在播（现状＝旧曲 play() 拒绝回调走到 audio.pause()，:2803 停的是新曲）',
  s4.paused === false && s4.currentTime > 0 && s4.readyState >= 3, s4);

// M4（改写在能真出声的对照曲上跑）：只有「播着的时候派发 waiting 会进缓冲态、派发 playing 会退出」
//   才证明媒体事件真有人消费——停滞窗里元素本来就没数据，派发 canplay 后仍显示「缓冲中」才是对的，
//   所以旧写法（六事件一把梭 + 比 before/after）在正确修复下也会红，属断言设计缺陷。
const dispatch = (ev) => evalJs(`(function(){var a=(window.__mochiMusic&&window.__mochiMusic.el)||document.querySelector('audio');a.dispatchEvent(new Event('${ev}'));return 1;})()`);
const isBuf = (s) => /buffering/.test(s.barsClass) || s.saysBuffer;
await dispatch('waiting');
await sleep(300);
const sWait = await evalJs(SNAP);
await dispatch('playing');
await sleep(300);
const sPlay = await evalJs(SNAP);
console.log('  事件消费：派发 waiting → class=' + sWait.barsClass + ' 文案=' + JSON.stringify(sWait.cur) + '；派发 playing → class=' + sPlay.barsClass + ' 文案=' + JSON.stringify(sPlay.cur));
check('M4 媒体事件有人消费：真播放中派发 waiting 应进入缓冲态、派发 playing 应退出（现状＝零监听，两个方向都不动）',
  isBuf(sWait) && !isBuf(sPlay) && sPlay.barsAnim === 'bar-bounce', { wait: sWait.barsClass + '/' + sWait.cur, play: sPlay.barsClass + '/' + sPlay.cur });

const jsErrs = await evalJs("(window.__jsErrors||[]).slice(0,3).join(' | ')");
check('M7 全程零新增 JS 异常', !jsErrs, jsErrs);

// ---------- 收尾 ----------
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果: ' + (results.length - fails) + ' 通过 / ' + fails + ' 失败（共 ' + results.length + ' 条）');
console.log('修复前（实测 2026-09-19 仓外纯 HEAD 副本 `mochi-mbuf-head`：4 通过 / 5 失败）＝M0/M1/M5/M7 绿（夹具隔离 · 内核真在加载 · 对照曲能播 · 零异常），');
console.log('                        M2/M3/M4/M6 红＝「缓冲中」这一态结构上不存在（现状读到的是 B 态：条在跳、按钮是暂停态、00:00 不走、没声），');
console.log('                        M8 红＝缓冲期切歌被旧曲的 play() 拒绝回调停掉（＝用户说的「卡住」）。');
console.log('全部修复后应 9/9 绿。');
try { chrome.kill(); } catch (e) {}
// 临时 profile 必须删干净：Chrome 退出是异步的，单次 rmSync 会 EBUSY（静默失败＝TEMP 里堆目录，撑爆磁盘）
let cleaned = false;
for (let i = 0; i < 12 && !cleaned; i++) {
  try { rmSync(profileDir, { recursive: true, force: true }); cleaned = true; }
  catch (e) { await sleep(250); }
}
if (!cleaned) console.log('⚠ 临时 profile 未删净，请手动清理：' + profileDir);
server.close();
process.exit(fails ? 1 : 0);

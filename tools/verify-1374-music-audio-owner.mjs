// ===== 常驻回归脚本 #1374：站内只留「正在出声的那一路」——前台静音闸 / 让位判据取元素真值 / 消息音效不叠音乐 =====
// 用法：node tools/verify-1374-music-audio-owner.mjs [被测根目录]（或 MOCHI_VERIFY_ROOT=…）
//
// 现场（用户 2026-09-28 直派，安卓 iQOO 10／Chrome 150，随附 mochi-diag-2026-09-28-11-51-02…docx；
//   并明说「这个问题其他设备型号也有出现」「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现」）：
//   ①「后台通知无法收到消息」
//   ②「后台播放音乐切出来不会暂停，息屏之后还会继续播放音乐，但是息屏之后不会显示后台播放音乐的横幅」
//   ③「网站内播放音乐的时候一直有嘟嘟声，一直边放音乐边嘟嘟响，是其他音频设置混进来了，而不是只有音乐的声音」
// 无头真跑产物量到的三条事实（判据一律零机型／零 UA＝只取「此刻这一路在不在出声」「用户在不在看着这一页」）：
//   A. 报障机诊断当场读数「音频=播放 vol=0.2」＝那颗内置保活音（18kHz 循环流）正在出声，而且它
//      在**前台**也照常出声。按页面生命周期规范只有 hidden 的页面才可能被冻结，前台放它零收益、
//      纯打扰，且它是 loop 常播＝用户在站内听歌时实打实多出一路音频＝③的「嘟嘟」本体。
//      #190/#207/#340 三轮只调过它的「幅度＋频率」，没人问过「此刻该不该出声」。
//   B. 让位判据 musicNowPlaying() 是单向核验：`if (!window.__musicPlaying) return false` 抢在元素
//      真值之前——元素正在出声而意图标志还是 false 时判成「没在播」＝保活音照播＝两路同时出声（③）。
//      #780 补的是反方向（标志 true／元素已停），这一半从来没补。
//   C. #780 那条「标志说在播、元素已停、用户还想听 ⇒ 替它推一把」写的是 `m.el.unpause()`——
//      媒体元素没有 unpause 这个方法，TypeError 被外层 try 整个吞掉＝自愈从未跑过：歌停着不响、
//      保活音与「Mochi 后台保活」媒体条一直接管＝②所见「息屏后没有后台播放音乐那条横幅」。
//   D. 消息类音效（用户自己配的「联系人发送和回复消息」）在站内音乐出声时照响——#673 那批特意留下
//      这条（当时诉求是「音乐互动台词别响」），而 TA 每 8~180s 回一条＝听歌时被反复插播＝③的
//      「其他音频设置混进来了，而不是只有音乐的声音」字面所指。本批按用户当场口径改：音乐在出声时
//      消息类音效不叠；没在放歌时照常响；来电铃声（错过就没了的单发事件）照旧响。
//
// 断言分组：F 夹具诚实 · A 本批新契约（红侧读数即症状本体）· B 旧契约不许动 · S 逻辑锚 · Z 零异常
// #1489 重锚：本批把默认保活通道换成 WebAudio（不占媒体音频通道＝不把别的 App 压低），
//   而本尺通篇量的是那颗 <audio> 媒体元素（音量闸三态／媒体条归属／让位时序）＝夹具显式钉 __ka-noduck='0'
//   走老通道，一条断言不改地继续守老路；新通道的同义面由 verify-1489-ka-audio-channel.mjs 守。
// verify-suite:timeout=300000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] || process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) {
  console.error('✗ 被测根目录没有 index.html（喂错目录了：所有断言会一起红，看起来像"修复没生效"）');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srcKeep = readFileSync(join(root, 'src', 'js', 'bg-keep.js'), 'utf8');
const srcSfx = readFileSync(join(root, 'src', 'js', 'sfx.js'), 'utf8');
const prodKeep = readFileSync(join(root, 'js', 'bg-keep.js'), 'utf8');
const prodSfx = readFileSync(join(root, 'js', 'sfx.js'), 'utf8');

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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1374-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
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
const waitReady = async () => { for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); } };

// 每次导航前注入：mock 掉所有 <audio>（确定性 play/pause 记账）＋可编程可见性＋WebAudio 出声计数
const INIT_SCRIPT = `
window.__au = { list: [], log: [], errs: [], lastPlayed: null };
window.onerror = function (m, s, l, c, e) { window.__au.errs.push(String(m)); };
window.addEventListener('unhandledrejection', function (ev) { window.__au.errs.push('rej:' + String(ev.reason)); });
function mkAudio() {
  var idx = window.__au.list.length;
  var el = {
    __idx: idx, __viaCreate: false,
    paused: true, ended: false, duration: 200, currentTime: 0,
    readyState: 4, networkState: 1, volume: 1, muted: false,
    preload: '', src: '', referrerPolicy: '', loop: false,
    buffered: { length: 0, end: function () { return 0; } },
    style: {}, parentNode: { removeChild: function () {} },
    onplay: null, onpause: null, onended: null, onerror: null, onloadedmetadata: null,
    removeAttribute: function () { el.src = ''; }, load: function () {}, setAttribute: function () {},
    addEventListener: function () {}
  };
  el.play = function () {
    el.paused = false; el.ended = false;
    window.__au.log.push({ act: 'play', inst: idx, hidden: !!document.hidden, t: Date.now() });
    window.__au.lastPlayed = el;
    if (el.onplay) el.onplay();
    return Promise.resolve();
  };
  el.pause = function () {
    if (el.paused) return;
    el.paused = true;
    window.__au.log.push({ act: 'pause', inst: idx, hidden: !!document.hidden, t: Date.now() });
    if (el.onpause) el.onpause();
  };
  window.__au.list.push(el);
  return el;
}
window.Audio = function () { return mkAudio(); };
(function () {
  var orig = document.createElement.bind(document);
  document.createElement = function (tag) {
    if (String(tag).toLowerCase() === 'audio') { var el = mkAudio(); el.__viaCreate = true; return el; }
    return orig.apply(null, arguments);
  };
})();
// WebAudio 侧（内置音效库走这条）：数「真按下的 start」
window.__wa = { starts: 0 };
(function () {
  if (!window.AudioBufferSourceNode || !AudioBufferSourceNode.prototype.start) return;
  var _s = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function () { window.__wa.starts++; try { return _s.apply(this, arguments); } catch (e) { return undefined; } };
})();
window.__setHidden = function (h) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return h ? 'hidden' : 'visible'; } });
  Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return !!h; } });
  document.dispatchEvent(new Event('visibilitychange'));
};
window.__findKeep = function () {
  return window.__au.list.filter(function (e) { return e.__viaCreate && e.loop === true && /(data:audio\\/wav|blob:)/.test(e.src || ''); })[0] || null;
};
window.__playsOf = function (el, ts) {
  if (!el) return -1;
  return window.__au.log.filter(function (e) { return e.inst === el.__idx && e.act === 'play' && (!ts || e.t > ts); }).length;
};`;

let pass = 0, fail = 0;
const reds = [];
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info !== undefined ? '  [' + JSON.stringify(info) + ']' : '')); }
  else { fail++; reds.push(name); console.log('FAIL  ' + name + (info !== undefined ? '  [' + JSON.stringify(info) + ']' : '')); }
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SCRIPT });

  // ---------- 预置：一首外链测试曲（mock 播放）＋ 后台保活开 ＋ 自配「收消息音效」（走自定义路径＝确定性） ----------
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(700);
  const seed = await evalJs(`(function(){
    try {
      var arr=[{ id:'sm_a1374', neteaseId:'990001', name:'1374共存放心曲', artist:'Verify',
        url:'https://cdn.test/a1374.mp3', source:'url', cover:'', duration:180, playlistId:'default', addedAt:Date.now() }];
      window.storeFor('default').set('music-library', JSON.stringify(arr));
      window.xyStore('xy-home-v2').set('bg-keepalive', '1');
      window.xyStore('xy-home-v2').set('__ka-noduck', '0'); // #1489：本尺量的是「媒体元素那条通道」（保活音频＋媒体条的音量闸/共存），新通道的同义断言在 verify-1489-ka-audio-channel.mjs
      // 用户自己在「音效设置」里配过的收消息音效（dataURL＝自定义路径，mock 元素必出声，不受自动播放策略摆布）
      var dv='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      try { window.activeStore().set('sfx-in', dv); window.activeStore().set('sfx-out', dv);
            window.activeStore().set('sfx-ring', dv); } catch(e) {}
      window.xyStore('xy-home-v2').set('sfx-unified', '1');
      try { window.xyStore('xy-home-v2').set('sfx-in', dv); window.xyStore('xy-home-v2').set('sfx-out', dv); window.xyStore('xy-home-v2').set('sfx-ring', dv); } catch(e) {}
      return 'OK';
    } catch(e){ return 'ERR:'+e.message; }
  })()`);
  check('F0 夹具预置成功（测试曲＋保活开关＋自定义收消息音效）', seed === 'OK', String(seed));

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(1500);

  // ---------- F 组·夹具诚实 ----------
  const f1 = await evalJs(`(function(){
    var k = window.__findKeep();
    return { has: !!k, paused: k ? k.paused : null, loop: k ? k.loop : null,
      wav: k ? /data:audio\\/wav/.test(k.src) : null, plays: window.__playsOf(k),
      vis: document.visibilityState, keepFlag: !!(window.__kaProbe && window.__kaProbe().keep) };
  })()`);
  check('F1 保活随开关自动启动、内置保活音已 play 过（自动播放解锁时序没被动坏）',
    f1 && f1.has && f1.keepFlag && f1.plays >= 1 && f1.wav && f1.loop, f1);
  check('F2 mock 与真页面共存：可见性可编程（默认 visible）', f1 && f1.vis === 'visible', { vis: f1 && f1.vis });

  // ---------- A1~A3 前台静音闸 ----------
  const a1 = await evalJs(`(function(){ var k=window.__findKeep(); return { vol: k?k.volume:null, hidden: document.visibilityState }; })()`);
  check('A1 【本批核心】前台（用户正在看着这一页）时内置保活音 volume=0＝字面静音（红侧＝0.2 常播＝用户所见「站内一直有嘟嘟声」）',
    a1 && a1.hidden === 'visible' && a1.vol === 0, a1);
  await evalJs('window.__setHidden(true); true');
  await sleep(400);
  const a2 = await evalJs(`(function(){ var k=window.__findKeep(); return { vol: k?k.volume:null, vis: document.visibilityState }; })()`);
  check('A2 切到后台（息屏/切走）恢复到 #724 那一档（0.2/0.35）＝ audible 冻结豁免一格没少',
    a2 && a2.vis === 'hidden' && a2.vol >= 0.2, a2);
  await evalJs('window.__setHidden(false); true');
  await sleep(400);
  const a3 = await evalJs(`(function(){ var k=window.__findKeep(); return { vol: k?k.volume:null }; })()`);
  check('A3 回前台再压回 0（闸双向换档，不是一次性）', a3 && a3.vol === 0, a3);

  // ---------- 起播音乐：让位（旧契约 B 组）＋ A4 标志假死方向 ----------
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(600);
  const started = await evalJs(`(function(){
    var row=document.querySelector('#music-lib-list .sm-song'); if(!row) return 'NO-ROW';
    row.click(); return 'OK';
  })()`);
  await sleep(800);
  const b1 = await evalJs(`(function(){
    var k = window.__findKeep(), m = window.__au.lastPlayed;
    if (m && !m.__viaCreate) window.__musicIdx = m.__idx;
    return { ok: ${JSON.stringify(started)}, flag: window.__musicPlaying === true,
      musicPaused: m ? m.paused : null, isMusic: m ? !m.__viaCreate : null, keepPaused: k ? k.paused : null };
  })()`);
  check('B1 音乐起播瞬间保活音让位暂停（v3.10.x 旧契约未动）',
    b1 && b1.ok === 'OK' && b1.flag && b1.musicPaused === false && b1.keepPaused === true, b1);

  // A4：元素正在出声、意图标志被写成 false（#780 漏掉的那个方向）
  const a4 = await evalJs(`(function(){
    var k = window.__findKeep(), m = window.__au.list[window.__musicIdx];
    window.__before = window.__playsOf(k);
    window.__musicPlaying = false;            // 意图标志假死（元素仍在出声）
    return { keepPlaysBefore: window.__before, keepPausedNow: k ? k.paused : null, musicPaused: m ? m.paused : null };
  })()`);
  await sleep(600);
  const a4b = await evalJs(`(function(){
    var k = window.__findKeep(), m = window.__au.list[window.__musicIdx];
    return { playsAfter: window.__playsOf(k), newPlays: window.__playsOf(k) - window.__before,
      keepPaused: k ? k.paused : null, musicPlaying: m ? m.paused === false : null };
  })()`);
  check('A4 【本批核心】标志 false 而元素在出声＝判「正在出声」：保活音零补播尝试且仍暂停（红侧＝两路同时出声）',
    a4b && a4b.newPlays === 0 && a4b.keepPaused === true && a4b.musicPlaying === true, { before: a4, after: a4b });

  // ---------- A5 #1374d：标志 true／元素已停／用户还想听 ⇒ 真把歌推回去（旧写法 unpause() 是死调用） ----------
  // 触发走生产里真会发生的那一发：歌被系统静默掐掉（不触发 onpause，标志仍为 true）后用户切歌/停止
  //   → music-player teardown 派发 music-media-release → bg-keep 的收回闸 syncKeepForMusic 走到「假死核验」。
  await evalJs(`(function(){
    var m = window.__au.list[window.__musicIdx];
    window.__musicPlaying = true;                    // 回到「标志说在播」（A4 把它落过一刀）
    m.paused = true;                                 // 静默掐掉：不经 mock 的 pause()，不触发 onpause
    window.__musicPlaysBefore = window.__playsOf(m);
    document.dispatchEvent(new Event('music-media-release'));
    return { flagStillTrue: window.__musicPlaying === true, want: !!(window.__mochiMusic && window.__mochiMusic.want && window.__mochiMusic.want()) };
  })()`);
  await sleep(700);
  const a5 = await evalJs(`(function(){
    var m = window.__au.list[window.__musicIdx];
    return { musicPaused: m ? m.paused : null, newPlays: window.__playsOf(m) - window.__musicPlaysBefore,
      want: !!(window.__mochiMusic && window.__mochiMusic.want && window.__mochiMusic.want()) };
  })()`);
  check('A5 【本批核心】假死自愈真跑起来了：歌被系统掐掉后由让位闸推回播放（红侧＝unpause 抛错被吞＝歌一直不响、保活条霸着媒体条＝用户所见「息屏后没有音乐横幅」）',
    a5 && a5.musicPaused === false && a5.newPlays >= 1 && a5.want === true, a5);

  // ---------- A6/A7/A8 消息音效不叠在音乐上 ----------
  await evalJs(`(function(){ var m=window.__au.list[window.__musicIdx]; if (m.paused) m.play(); window.__musicPlaying = true; return true; })()`);
  await sleep(300);
  const a6 = await evalJs(`(function(){
    var before = window.__au.log.length, wbefore = window.__wa.starts;
    window.playSfx('in');
    return { musicAudible: !!(window.__mochiMusic && window.__mochiMusic.el && window.__mochiMusic.el.paused === false),
      mediaPlays: window.__au.log.filter(function(e){return e.act==='play';}, window.__au.log.slice(before)).length,
      newMedia: window.__au.log.length - before, waDelta: window.__wa.starts - wbefore };
  })()`);
  check('A6 【本批核心】音乐正在出声时 playSfx("in") 不叠消息音效（红侧＝听歌时每来一条回复插播一声＝用户所见「其他音频设置混进来了」）',
    a6 && a6.musicAudible === true && a6.newMedia === 0 && a6.waDelta === 0, a6);
  const a7 = await evalJs(`(function(){
    var m = window.__au.list[window.__musicIdx]; m.pause();      // 用户把歌停了
    var before = window.__au.log.length;
    window.playSfx('in');
    return { audible: !!(window.__mochiMusic && window.__mochiMusic.el && window.__mochiMusic.el.paused === false),
      newMedia: window.__au.log.length - before };
  })()`);
  check('A7 没在放歌时消息音效照常响（本批不是把音效通道整体关掉）', a7 && a7.audible === false && a7.newMedia >= 1, a7);
  const a8 = await evalJs(`(function(){
    var m = window.__au.list[window.__musicIdx]; m.play();       // 音乐又在出声
    window.__ringBefore = window.__au.log.filter(function(e){return e.act==='play';}).length;
    window.playSfx('ring');                                      // 来电铃声＝错过就没了的单发事件
    return { audible: !!(window.__mochiMusic && window.__mochiMusic.el && window.__mochiMusic.el.paused === false) };
  })()`);
  await sleep(900);
  const a8b = await evalJs('window.__au.log.filter(function(e){return e.act==="play";}).length - window.__ringBefore');
  check('A8 音乐在播时来电铃声照旧响（闸只管消息类，不吞一次性事件）',
    a8 && a8.audible === true && a8b >= 1, { audible: a8 && a8.audible, ringPlays: a8b });

  // ---------- B 组·其余旧契约（用真·用户动作＝点播放/暂停键，wantPlay 才会落到「用户主动暂停」） ----------
  await evalJs(`(function(){ var btn=document.getElementById('sm-play'); if(btn) btn.click(); return !!btn; })()`);
  await sleep(900);
  // 收回走 App 自己的设计路径：切出去（#153 那条 hidden 补播闸会 kaResetBackoff＋立即补播）
  // 再切回来（healKeepAlive）——前面几步反复让位/收回会把退避轨道挂上，干等是不确定的
  await evalJs('window.__setHidden(true); true');
  await sleep(400);
  await evalJs('window.__setHidden(false); document.dispatchEvent(new Event("focus")); true');
  await sleep(2200);
  const b2 = await evalJs(`(function(){
    var k = window.__findKeep(), m = window.__au.list[window.__musicIdx];
    return { userPaused: window.__musicPlaying === false, musicPaused: m ? m.paused : null,
      keepPlaying: k ? k.paused === false : null, keepVol: k ? k.volume : null, vis: document.visibilityState };
  })()`);
  check('B2 用户暂停音乐后保活音收回在播（v3.10.x 收回路径未动；前台闸只压音量不改 play 时序）',
    b2 && b2.userPaused && b2.musicPaused === true && b2.keepPlaying === true, b2);
  await evalJs('window.__setHidden(true); true');
  await sleep(500);
  const b3 = await evalJs(`(function(){ var k=window.__findKeep(); return { vis: document.visibilityState, vol: k?k.volume:null, paused: k?k.paused:null }; })()`);
  check('B3 隐藏时收回的保活音吃到 #724 那一档（>0＝audible 豁免信号还在）',
    b3 && b3.vis === 'hidden' && b3.vol >= 0.2 && b3.paused === false, b3);
  await evalJs('window.__setHidden(false); true');
  await sleep(500);
  const b4 = await evalJs(`(function(){
    var md = navigator.mediaSession && navigator.mediaSession.metadata;
    return { title: md ? String(md.title) : '', state: navigator.mediaSession ? navigator.mediaSession.playbackState : '' };
  })()`);
  check('B4 保活媒体条本身没被撤（用户靠它确认保活在跑；本批只动音量不动媒体会话）',
    b4 && /后台保活/.test(b4.title) && b4.state === 'playing', b4);
  const b5 = await evalJs(`(function(){
    try { document.dispatchEvent(new Event('music-media-release')); } catch(e){ return 'ERR:'+e.message; }
    var md = navigator.mediaSession && navigator.mediaSession.metadata;
    return { title: md ? String(md.title) : '' };
  })()`);
  check('B5 music-media-release 后保活条恢复（#2346 那条接线未断）', b5 && /后台保活/.test(String(b5.title)), b5);
  check('B6 #924 隐藏期被外部抢焦点不回的闸仍在（iOS 分支一字未动）',
    /function kaYieldStealFocus\(\)\s*\{\s*return kaIsIOS\(\) && document\.visibilityState === 'hidden';/.test(prodKeep), undefined);
  // #1489 重锚（同一把尺，问的还是「基础档在不在两处入口落得到」）：#1374a 那两处 kaSetToneLevel(KA_VOL_BASE)
  //   在 #1489 收进转子构造——启动 kaBuildTransducer(KA_VOL_BASE)、清自定义 kaSwapTransducer(true)→resetBase
  //   那一支，唯一的直写口变成 kaSetToneLevel(level || KA_VOL_BASE)。老拓扑（恰 2 处直写）与新拓扑任一在位
  //   都算合格；把音量直写成常数那种坏法（keepEl.volume = 0.2）两边都不许回流。
  check('B7 #724 分级常量与档位入口仍在（老拓扑两处直写基础档／新拓扑启动＋清自定义两入口，#1489 重锚）',
    /const KA_VOL_BASE = 0\.2, KA_VOL_MAX = 0\.35;/.test(prodKeep) &&
    ((prodKeep.match(/kaSetToneLevel\(KA_VOL_BASE\);/g) || []).length === 2 ||
      (/kaSetToneLevel\(level \|\| KA_VOL_BASE\);/.test(prodKeep) && /if \(!kaBuildTransducer\(KA_VOL_BASE\)\)/.test(prodKeep) && /resetBase \? KA_VOL_BASE : kaToneLevel/.test(prodKeep))) &&
    !/keepEl\.volume = 0\.\d+;/.test(prodKeep), undefined);

  // ---------- S 组·逻辑锚 ----------
  check('S1 音量只有一个写入方：闸表达式 visible⇒0 / hidden⇒该档（产物）',
    /kaCustomAudio \? 1 : \(kaVisibleNow\(\) \? 0 : kaToneLevel\)/.test(prodKeep), undefined);
  check('S2 可见性变化＝换档时机（独立 visibilitychange 落音量，产物）',
    /document\.addEventListener\('visibilitychange', function \(\) \{ kaApplyToneVolume\(\); \}\)/.test(prodKeep), undefined);
  check('S3 musicNowPlaying 先读元素真值，再退到意图标志（产物）',
    /function musicNowPlaying\(\) \{[\s\S]{0,900}?window\.__mochiMusic[\s\S]{0,400}?return !!window\.__musicPlaying;/.test(prodKeep) &&
    !/function musicNowPlaying\(\) \{\s*try \{ if \(!window\.__musicPlaying\) return false; \} catch/.test(prodKeep), undefined);
  check('S4 死掉的 unpause 写法不再出现（absent：回流即报红）', !/\.unpause\(\)/.test(prodKeep), undefined);
  check('S5 消息音效闸的判据＝那一个元素此刻在不在出声（产物 sfx.js）',
    /paused === false/.test(prodSfx) && /if \(type !== 'ring' && siteMusicAudible\(\)\) return;/.test(prodSfx), undefined);
  check('S6 自定义保活音频不吃前台闸（volume=1 分支在闸内，源码与产物同形）',
    /kaCustomAudio \? 1 :/.test(srcKeep) && /kaApplyToneVolume\(\);/.test(srcKeep), undefined);

  // ---------- Z 组 ----------
  const errs = await evalJs('window.__au.errs.slice(0,6)');
  check('Z1 全程零未捕获 JS 异常', Array.isArray(errs) && errs.length === 0, errs);

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) { console.log('未通过：' + reds.join(' | ')); process.exitCode = 1; }
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}
process.exit(process.exitCode || 0);

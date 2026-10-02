// ===== 常驻回归脚本 #1489：后台保活不再占用手机媒体音频通道（进页变响／退页变轻 的音量泵动）=====
// 用法：node tools/verify-1489-ka-audio-channel.mjs [被测根目录]（或 MOCHI_VERIFY_ROOT=…）
//
// 现场（作者 2026-09-30 直派，华为 Mate80／自带浏览器，随附 mochi-diag-2026-09-30-06-56-07…docx；
//   并明说「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现」「这个问题其他设备型号也有出现」）：
//   「在后台放音乐，进 mochi 会突然变响，退出来又会变轻」。
// 诊断单当场读数（【保活现场】，抓那一刻页面在前台）＝证据而非推测：
//   保活=开 · 音频=播放 vol=0 · 媒体条=有 playing · WebRTC=connected
//   → 保活押的是「<audio> 媒体元素常播＋媒体会话 playbackState=playing」，这条在系统眼里＝
//     「本应用正在放媒体」＝占住媒体音频通道＝别的 App 被强制压低（音频焦点 duck）。
//   #1374b 为治「边放音乐边嘟嘟响」把前台音量钉 0、后台才回 0.2：于是每次前后台切换都在改
//   「我们算不算在放媒体」＝进页系统收走焦点→对方恢复（变响）；退页又抢回来→对方再被压低（变轻）。
//   这是通道性质不是机型性质（#1374 报障机＝iQOO10/Chrome；本文件 v3.13.x/v3.44.x 两处自述
//   「网页音频与其他 App 共用系统音频焦点」「持续播放的音频会占用手机音频通道」）。
// 修法口径（作者选定＝两条都给，加一档开关，默认开）：默认静音音频改经 WebAudio 输出＋不声明
//   保活媒体条；开关关掉＝现状逐字回来（媒体元素＋媒体条）；用户上传的自定义保活音频恒走媒体元素；
//   环境没有 AudioContext／解码被拒＝当场静默回落媒体元素（保活绝不因新档而死）。
//
// 断言分组：S 逻辑锚 · F 夹具诚实 · U 本批新契约（红侧读数即症状本体）· B 旧契约不许动 · Z 零异常
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
console.log('被测：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const srcKeep = read('src', 'js', 'bg-keep.js');
const prodKeep = read('js', 'bg-keep.js');
const prodHtml = read('index.html');
// device.js 是被 core 内联的那一批（build.mjs 把它并进 index.html，产物根目录没有 js/device.js）
// ——读数按「外置文件优先，否则取内联的那份」，两侧同尺。
const prodDevice = existsSync(join(root, 'js', 'device.js')) ? read('js', 'device.js') : prodHtml;
// 产物侧的 bg-keep 可能是【外置 js 文件】也可能是【内联进 index.html】——两侧都找，取在场的那份
const keepBody = prodKeep.includes('kaBuildTransducer') || prodKeep.includes('startKeepAlive') ? prodKeep : prodHtml;

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
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-1489-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + profileDir,
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

// 每次导航前注入：mock 所有 <audio>（确定性 play/pause 记账）＋WebAudio 出声计数＋可编程可见性
// ＋可拔掉的 AudioContext（U9：验「这条路不通要静默回落，不许把保活弄死」）
const INIT_SCRIPT = `
window.__au = { list: [], log: [], errs: [] };
window.onerror = function (m) { window.__au.errs.push(String(m)); };
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
    addEventListener: function (n, f) { (el.__h = el.__h || {})[n] = (el.__h[n] || []).concat([f]); }
  };
  el.__fire = function (n) { var a = (el.__h || {})[n] || []; for (var i = 0; i < a.length; i++) { try { a[i](); } catch (e) {} } };
  el.play = function () {
    el.paused = false; el.ended = false;
    window.__au.log.push({ act: 'play', inst: idx, hidden: !!document.hidden, t: Date.now() });
    el.__fire('play');
    return Promise.resolve();
  };
  el.pause = function () {
    if (el.paused) return;
    el.paused = true;
    window.__au.log.push({ act: 'pause', inst: idx, hidden: !!document.hidden, t: Date.now() });
    el.__fire('pause');
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
// WebAudio 侧：数「建了几只 BufferSource / 真按下了几次 start / 挂没挂到 destination」
window.__wa = { ctxs: 0, bufs: 0, starts: 0, toDest: 0, gainSets: 0, last: null };
(function () {
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  var Wrapped = function () {
    var c = new AC();
    window.__wa.ctxs++;
    var cbs = c.createBufferSource.bind(c);
    c.createBufferSource = function () {
      var s = cbs.apply(c, arguments);
      window.__wa.bufs++;
      var st = s.start.bind(s);
      s.start = function () { window.__wa.starts++; window.__wa.last = { state: c.state, loop: s.loop, bufLen: s.buffer ? s.buffer.length : 0 }; return st.apply(s, arguments); };
      var co = s.connect.bind(s);
      s.connect = function (dst) { try { if (dst && dst === c.destination) window.__wa.toDest++; } catch (e) {} return co.apply(s, arguments); };
      return s;
    };
    var cg = c.createGain.bind(c);
    c.createGain = function () {
      var g = cg.apply(c, arguments);
      // 输出链是「音源 → 增益 → destination」，所以「接到输出」这一格要数增益那一段
      // （数音源的 connect 会恒 0＝尺子自己骗自己，实测踩过）
      var co = g.connect.bind(g);
      g.connect = function (dst) { try { if (dst && dst === c.destination) window.__wa.toDest++; } catch (e) {} return co.apply(g, arguments); };
      try {
        var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g.gain), 'value') ||
          Object.getOwnPropertyDescriptor(g.gain, 'value');
        if (d && d.set) { var _s = d.set; Object.defineProperty(g.gain, 'value', { configurable: true, enumerable: !!d.enumerable, get: d.get, set: function (v) { window.__wa.gainSets++; _s.call(g.gain, v); } }); }
      } catch (e) {}
      return g;
    };
    return c;
  };
  Wrapped.prototype = AC.prototype;
  try { Object.defineProperty(window, 'AudioContext', { value: Wrapped, configurable: true, writable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'webkitAudioContext', { value: Wrapped, configurable: true, writable: true }); } catch (e) {}
})();
window.__setHidden = function (h) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return h ? 'hidden' : 'visible'; } });
  Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return !!h; } });
  document.dispatchEvent(new Event('visibilitychange'));
};
// 内置保活那颗音（18kHz 静音 WAV）在媒体元素路上的样子
window.__findKeepEl = function () {
  return window.__au.list.filter(function (e) { return e.__viaCreate && e.loop === true && /data:audio\\/wav/.test(e.src || ''); })[0] || null;
};
window.__countKeepEls = function () {
  return window.__au.list.filter(function (e) { return e.__viaCreate && e.loop === true && /data:audio\\/wav/.test(e.src || ''); }).length;
};
// U9 夹具：把 AudioContext 拔掉（在页面脚本跑之前），其余一律照旧
try {
  if (localStorage.getItem('xy-home-v2:__x_noac') === '1') {
    Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(window, 'webkitAudioContext', { value: undefined, configurable: true, writable: true });
  }
} catch (e) {}
`;

let pass = 0, fail = 0;
const reds = [];
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info !== undefined ? '  [' + JSON.stringify(info) + ']' : '')); }
  else { fail++; reds.push(name); console.log('FAIL  ' + name + (info !== undefined ? '  [' + JSON.stringify(info) + ']' : '')); }
}

async function seed(extra) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(600);
  const r = await evalJs(`(function(){ try {
    window.xyStore('xy-home-v2').set('bg-keepalive','1');
    ${extra || ''}
    return 'OK'; } catch(e){ return 'ERR:'+e.message; } })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html?seeded=1' });
  await waitReady();
  await sleep(2000);
  return r;
}
const probe = () => evalJs(`(function(){ try {
  var p = (typeof window.__kaProbe === 'function') ? window.__kaProbe() : null;
  return { keep: p && p.keep, anchor: p && p.anchor, noduck: p && p.noduck, waErr: p && p.waErr, duckIn: p && p.duckIn,
    audio: p && p.audio, ms: p && p.ms, pc: p && p.pc,
    els: window.__countKeepEls(), wa: window.__wa, vis: document.visibilityState,
    noduckFlag: localStorage.getItem('xy-home-v2:__ka-noduck'),
    sub: !!document.getElementById('bg-keep-noduck') };
} catch(e){ return { err: String(e) }; } })()`);

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SCRIPT });

  // ================= S 组·逻辑锚（产物侧；名字能留、逻辑改了必须消失）=================
  check('S1 转子选择＝只认「本档开关＋有没有自定义音频」，零机型零 UA 分支',
    /function kaNoDuckNow\(\) \{ return kaNoDuckSaved\(\) && !kaCustomWanted\(\) && !kaWaBroken; \}/.test(keepBody), undefined);
  check('S2 新档不声明保活媒体条（媒体条＝那次抢焦点，挂着＝不出声也占通道）',
    /if \(kaNoDuckNow\(\)\) \{ kaReleaseKeepMediaSession\(\); return; \}/.test(keepBody), undefined);
  check('S3 5s 轻心跳不再把 playbackState 按回 playing（新档下 hold 只能由不抢档决定）',
    /let hold = !kaNoDuckNow\(\);/.test(keepBody), undefined);
  check('S4 两条转子共用同一套 play/pause 边沿（退避／让位／首次交互时序没被另开一份）',
    /function kaOnPlayEdge\(\) \{ kaMarkPlayed\(\); \}/.test(keepBody) &&
    /keepEl\.addEventListener\('play', function \(\) \{ kaOnPlayEdge\(\); \}\)/.test(keepBody) &&
    /keepEl\.addEventListener\('pause', function \(\) \{ kaOnPauseEdge\(\); \}\)/.test(keepBody), undefined);
  check('S5 启动只经 kaBuildTransducer（先在册→再落档→再挂源，#1374b 唯一写入方语义不裂变）',
    /if \(!kaBuildTransducer\(KA_VOL_BASE\)\)/.test(keepBody) &&
    /keepAudio = t;/.test(keepBody) && /kaSetToneLevel\(level \|\| KA_VOL_BASE\);/.test(keepBody) && /t\.arm\(src\);/.test(keepBody), undefined);
  check('S6 自定义保活音频恒走媒体元素（那是用户要出声放的）',
    /if \(keepAudio\.mode === KA_MODE_WA\) \{ kaSwapTransducer\(\); return; \}/.test(keepBody) &&
    /function kaCustomWanted\(\) \{ return !!kaCustomAudio \|\| kaCustomOn\(\); \}/.test(keepBody), undefined);
  check('S7 WebAudio 路不通＝当场回落媒体元素，不是静默死掉',
    /function kaFallbackToMedia\(\)/.test(keepBody) &&
    /kaWaBroken = true; kaFallbackToMedia\(\)/.test(keepBody) &&
    /if \(!t\) \{ kaWaBroken = true; t = kaMakeMediaKeep\(\); \}/.test(keepBody), undefined);
  check('S8b 媒体会话收口只剩一处（#924d 那条 WebKit 怪癖处置被抄成两份＝哑哨兵＋两个写入方）',
    (keepBody.match(/navigator.mediaSession.playbackState = 'paused'/g) || []).length === 1, undefined);
  check('S9 设置行与诊断读数都在场（一行开关＋诊断「锚=」把占不占通道摊开）',
    /id="bg-keep-noduck"/.test(prodHtml) && /锚=' \+ kp\.anchor/.test(prodDevice), undefined);

  // ================= F 组·夹具诚实 =================
  const s0 = await seed('localStorage.removeItem("xy-home-v2:__ka-noduck"); localStorage.removeItem("xy-home-v2:__ka-audio-on"); localStorage.removeItem("xy-home-v2:__x_noac");');
  check('F0 夹具预置成功（后台保活开、不抢档＝缺省、无自定义音频）', s0 === 'OK', String(s0));
  const f1 = await probe();
  check('F1 保活真在跑（__kaProbe().keep＝开，锚有读数＝转子建起来了）',
    f1 && f1.keep === true, f1 && { keep: f1.keep, anchor: f1.anchor, els: f1.els });
  check('F2 缺省即新档：不抢＝开、锚＝WebAudio(不占媒体通道)',
    f1 && f1.noduckFlag === null && f1.anchor === 'WebAudio(不占媒体通道)', f1 && { flag: f1.noduckFlag, anchor: f1.anchor, duckIn: f1.duckIn, waErr: f1.waErr });

  // ================= U 组·本批新契约（红侧读数＝症状本体）=================
  check('U1 【核心】新档下不再建那颗 loop 的保活 <audio> 媒体元素（红侧＝1 只在册＝正是压低对方音乐的那一路）',
    f1 && f1.els === 0, f1 && { keepEls: f1.els, anchor: f1.anchor });
  check('U2 【核心】新档不出「Mochi 后台保活」媒体条（红侧＝媒体条=有 playing＝那次抢焦点）',
    f1 && f1.ms && f1.ms.metadata === false, f1 && { ms: f1.ms });
  check('U3 豁免没被摘掉：同一颗样本仍经 WebAudio 真出声（createBufferSource＋start＋挂到 destination）',
    f1 && f1.wa && f1.wa.bufs >= 1 && f1.wa.starts >= 1 && f1.wa.toDest >= 1, f1 && f1.wa);
  check('B2 自动播放策略没被绕过：转子读数「在播」而非停在暂停（红侧走元素路时此格由元素真值自证）',
    f1 && f1.audio && f1.audio.paused === false && f1.audio.loop === true, f1 && f1.audio);

  // U5 前台静音闸（#1374b）语义不动：visible⇒0 / hidden⇒恢复档
  const vVis = await evalJs('window.__kaProbe().audio.volume');
  await evalJs('window.__setHidden(true)');
  await sleep(400);
  const vHid = await evalJs('window.__kaProbe().audio.volume');
  const u5 = await probe();
  check('B1 #1374b 前台静音闸照旧（前台 vol=0／后台回到 #724 那一档），新档没把它摘掉',
    vVis === 0 && vHid > 0 && vHid <= 0.35, { vis: vVis, hid: vHid });
  check('U5 切到后台＝继续出声（冻结豁免在）而媒体条始终不出现＝不再抢回媒体通道＝退出不再「变轻」',
    u5 && u5.audio && u5.audio.paused === false && u5.ms && u5.ms.metadata === false && u5.wa.starts >= 1,
    u5 && { paused: u5.audio.paused, ms: u5.ms, starts: u5.wa.starts });

  // U6 来回切前后台＝不新建任何媒体元素（泵动的源头就是元素路的音量翻转）
  await evalJs('window.__setHidden(false)');
  await sleep(400);
  await evalJs('window.__setHidden(true)');
  await sleep(400);
  await evalJs('window.__setHidden(false)');
  await sleep(600);
  const u6 = await probe();
  check('U6 前后台来回切三次＝全程零保活媒体元素（红侧＝元素一直在册＝每次翻转都在改「算不算在放媒体」）',
    u6 && u6.els === 0, u6 && { keepEls: u6.els, anchor: u6.anchor });

  // U7/U8 新通道也要守 v3.10.x 的「站内音乐优先」共存契约——换的是出声的孔，不是让位语义
  await evalJs('(function(){ window.__musicPlaying = true; return 1; })()');
  await sleep(900);
  const u7wa = await probe();
  check('U7 新通道守 v3.10.x 共存契约：站内音乐在播＝保活那一路让位暂停（不再两路同时出声）',
    u7wa && u7wa.anchor === 'WebAudio(不占媒体通道)' && u7wa.audio && u7wa.audio.paused === true,
    u7wa && { anchor: u7wa.anchor, paused: u7wa.audio && u7wa.audio.paused });
  await evalJs('(function(){ window.__musicPlaying = false; return 1; })()');
  await sleep(1600);
  const u8wa = await probe();
  check('U8 歌停＝保活收回继续在出声，而媒体条始终不出现（收回那一刻也不把媒体通道抢回来）',
    u8wa && u8wa.audio && u8wa.audio.paused === false && u8wa.ms && u8wa.ms.metadata === false,
    u8wa && { paused: u8wa.audio && u8wa.audio.paused, ms: u8wa.ms });

  // U7 关掉档＝现状逐字回来（媒体元素＋媒体条 playing）
  await evalJs('(function(){ localStorage.setItem("xy-home-v2:__ka-noduck","0"); return true; })()');
  await cdp('Page.navigate', { url: baseUrl + '/index.html?off=1' });
  await waitReady();
  await sleep(2200);
  const u7 = await probe();
  check('B3 关掉档＝回到老路逐字：建那颗 loop 保活媒体元素＋声明「Mochi 后台保活」媒体条 playing（老内核豁免不丢，两侧同绿＝老路一字未动）',
    u7 && u7.els === 1 && u7.ms && u7.ms.metadata === true && u7.ms.state === 'playing',
    u7 && { anchor: u7.anchor, els: u7.els, ms: u7.ms });
  check('B4 关档路径不碰 WebAudio（没多开一条 Context＝没修过头）',
    u7 && u7.wa && u7.wa.ctxs === 0, u7 && u7.wa);

  // U9 无 AudioContext 环境＝静默回落，保活不许当场死掉
  await evalJs('(function(){ localStorage.setItem("xy-home-v2:__x_noac","1"); localStorage.setItem("xy-home-v2:__ka-noduck","1"); return true; })()');
  await cdp('Page.navigate', { url: baseUrl + '/index.html?noac=1' });
  await waitReady();
  await sleep(2200);
  const u9 = await probe();
  check('U9 没有 AudioContext＝当场回落媒体元素继续保活（锚=媒体元素、keep 仍开、诊断留「路=」取证）',
    u9 && u9.keep === true && u9.anchor === '媒体元素(占媒体通道)' && u9.els === 1,
    u9 && { anchor: u9.anchor, els: u9.els, waErr: u9.waErr });

  // U10 自定义音频在册＝即便档开着也走媒体元素（那是用户要出声放的）
  await evalJs('(function(){ localStorage.removeItem("xy-home-v2:__x_noac"); localStorage.setItem("xy-home-v2:__ka-audio-on","1"); localStorage.setItem("xy-home-v2:__ka-noduck","1"); return true; })()');
  await cdp('Page.navigate', { url: baseUrl + '/index.html?custom=1' });
  await waitReady();
  await sleep(2200);
  const u10 = await probe();
  check('U10 上传了自定义保活音频＝恒走媒体元素（新档不参与，v3.44.x「要出声」的语义不被改坏）',
    u10 && u10.anchor === '媒体元素(占媒体通道)' && u10.noduck === false,
    u10 && { anchor: u10.anchor, noduck: u10.noduck });

  // U11/U12 当场换通道（走「落档＋生效」那唯一一个口；设置行在隐藏页里 rect=0，
  // 用 CDP 点 label 必假红——口径同本仓 __kaNextDelayMs／__kaRetryBaseMs 那一族量具入口）
  await evalJs('(function(){ localStorage.removeItem("xy-home-v2:__ka-audio-on"); localStorage.setItem("xy-home-v2:__ka-noduck","1"); return 1; })()');
  await cdp('Page.navigate', { url: baseUrl + '/index.html?toggle=1' });
  await waitReady();
  await sleep(2000);
  const pre = await probe();
  await evalJs('(function(){ if (window.__kaNoduckSet) window.__kaNoduckSet(false); return 1; })()');
  await sleep(1500);
  const u11 = await probe();
  check('U11 关档当场生效＝换回媒体元素并继续出声（不重开网页；旧转子已摘、定时器没断）',
    pre && pre.anchor === 'WebAudio(不占媒体通道)' && u11 && u11.anchor === '媒体元素(占媒体通道)' &&
    u11.keep === true && u11.audio && u11.audio.paused === false && u11.els >= 1,
    u11 && { pre: pre && pre.anchor, now: u11.anchor, keep: u11.keep, paused: u11.audio && u11.audio.paused });
  await evalJs('(function(){ if (window.__kaNoduckSet) window.__kaNoduckSet(true); return 1; })()');
  await sleep(1500);
  const u12 = await probe();
  check('U12 再开回来＝又换回 WebAudio 且媒体条随之让出（换通道可逆，不用重载）',
    u12 && u12.anchor === 'WebAudio(不占媒体通道)' && u12.keep === true &&
    u12.ms && u12.ms.metadata === false && u12.audio && u12.audio.paused === false,
    u12 && { now: u12.anchor, ms: u12.ms, paused: u12.audio && u12.audio.paused });

  // ================= Z 组 =================
  const errs = await evalJs('window.__au.errs.slice(0,6)');
  check('Z1 全程零未捕获 JS 异常', Array.isArray(errs) && errs.length === 0, errs);

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) { console.log('未通过：' + reds.join(' | ')); process.exitCode = 1; }
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  try { chrome.kill('SIGKILL'); } catch (e) {}
  server.close();
}

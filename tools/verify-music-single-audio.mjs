// ===== 回归脚本：弱网换源期间不产生第二个播放器（单实例强制）=====
// 用法：node build.mjs && node tools/verify-music-single-audio.mjs
// 背景（用户反馈：红米K80 弱网点播网易云外链歌）：
//   外链加载慢 → 12s 停滞守卫判失败 → retryWithHttpsUrl 先 teardown 再异步拉
//   meting 直链（最长 8s 空窗）。旧代码空窗期内原 play() 被 teardown 中断而
//   reject → handlePlayReject 武装自动续播/后台补播 → tryResumePlayback 见
//   !audio 就 rebuildAndPlay 用旧 URL 造野元素；直链回来后 audio=createAudio()
//   只覆盖变量没人停野元素 → 两个播放器同时响，暂停只停变量指向的那个。
// 修复（src/js/music-player.js）：
//   ① createAudio 收口为唯一工厂：新建前把本模块创建过的所有旧元素硬停
//      （liveAudioEls 在册清场），结构上保证同时最多一个可能出声的 <audio>；
//   ② handlePlayReject / tryResumePlayback / armAutoResume.retry 在换源窗口
//      （httpsRetrying/demoFallbackBusy）封禁反击，不再造野元素抢跑；
//   ③ 换源回调补守卫：空窗期已切歌/来电 hold（callHoldPending）/用户停止
//      时不再强行起播。
// 验证（stub meting 直链接口延迟应答 + Audio mock 弱网挂起模型）：
//   场景A（慢 1.2s）：点播 → 停滞守卫换源成功 → 直链实例在播，且全程
//     「未销毁且在播」的实例数峰值 = 1、曾播放的实例除最终在播者外全部已销毁；
//   场景B（慢 2.6s）：点播进入换源空窗后模拟来电 hold（musicHoldForCall(true)）
//     → 直链回来后不得创建新实例、不得出声；通话结束（false）后仍静音。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9720 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-sga-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};

// 直链应答对象：代码只读 r.url / r.redirected / r.headers / r.body，用鸭子类型对象
// 保证确定性——redirected=true + content-type audio/mpeg 模拟真实 meting 302 应答
//（2026-08-30 v3.26.x 起解析器校验「必须 302 跳转或音频响应」才接受为直链）
const DIRECT_OBJ = "{ url: 'https://m701.music.126.net/weak-fixed.mp3', redirected: true, headers: { get: function (k) { return k === 'content-type' ? 'audio/mpeg' : null; } }, body: null }";

const INIT_SCRIPT = `
// ---- meting 直链接口 stub：延迟 ${'${slowMs}'} 应答，模拟弱网拉直链的空窗期 ----
window.__META = { slowMs: 1200 };
try {
  var __q = new URLSearchParams(location.search);
  if (__q.get('slowms')) window.__META.slowMs = parseInt(__q.get('slowms'), 10) || 1200;
} catch (e) {}
(function(){
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.__fetched = [];
  window.fetch = function (input, opts) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    window.__fetched.push(String(url).slice(0, 140));
    if (url.indexOf('meting/?type=url') >= 0) {
      return new Promise(function (res) {
        setTimeout(function () { res(${DIRECT_OBJ}); }, window.__META.slowMs);
      });
    }
    return origFetch ? origFetch(input, opts) : Promise.reject(new Error('no-fetch'));
  };
})();
// ---- Audio mock：弱网挂起模型 ----
// play(): src 含 126.net → 立即出声成功（onplay/onloadedmetadata、有进度）；
//         其余外链 → 挂起不出声（paused=false 但 duration=NaN、Promise 不落定），
//         精确复现「停滞守卫 12s 判失败」所需状态（currentTime=0、readyState=0、
//         无缓冲、networkState≠LOADING）。
// teardown 路径 removeAttribute('src')+load() → 标记 __stopped，挂起中的 play
//   Promise 以异常拒绝（对应真内核中断加载时 reject 未决 play 的行为）。
// maxConcurrent 记录全程「未销毁且在播」实例数峰值 —— 双播放器回归的核心指标。
window.__au = { list: [], log: [], maxConcurrent: 0 };
// 可听音乐判定：排除 bg-keep 保活音频（data:audio/wav、近零音量，设计上常驻）
function __audible(x) {
  return !x.__stopped && x.paused === false && x.volume > 0.5 && String(x.src).indexOf('data:') !== 0;
}
window.Audio = function () {
  var idx = window.__au.list.length;
  var el = {
    __idx: idx, __stopped: false, __played: false,
    paused: true, ended: false, duration: NaN, currentTime: 0,
    readyState: 0, networkState: 0, volume: 1, muted: false,
    preload: '', src: '', referrerPolicy: '',
    buffered: { length: 0, end: function () { return 0; } },
    style: {}, parentNode: { removeChild: function () {} },
    onplay: null, onpause: null, onended: null, onerror: null, onloadedmetadata: null,
    addEventListener: function () {}
  };
  function bump() {
    var alive = 0;
    window.__au.list.forEach(function (x) { if (__audible(x)) alive++; });
    if (alive > window.__au.maxConcurrent) window.__au.maxConcurrent = alive;
  }
  el.removeAttribute = function (k) { if (String(k).toLowerCase() === 'src') { el.__stopped = true; el.src = ''; } };
  el.load = function () { if (el.__rej) { var r = el.__rej; el.__rej = null; r(new Error('interrupted-by-load')); } };
  el.pause = function () { el.paused = true; if (el.onpause) el.onpause(); };
  el.play = function () {
    if (el.__stopped || !el.src) {
      window.__au.log.push({ act: 'reject', inst: idx });
      return Promise.reject(new Error('NoSource'));
    }
    el.__played = true;
    el.paused = false;
    window.__au.log.push({ act: 'play', inst: idx, src: String(el.src).slice(0, 90) });
    // 网易云外链（meting/outer，需换源）→ 挂起不出声，复现停滞守卫路径；其余立即成功
    if (String(el.src).indexOf('music.163.com') >= 0 || String(el.src).indexOf('meting') >= 0) {
      bump();
      return new Promise(function (res, rej) { el.__res = res; el.__rej = rej; });
    }
    el.readyState = 4; el.networkState = 1; el.duration = 180; el.currentTime = 0.5;
    if (el.onloadedmetadata) el.onloadedmetadata();
    if (el.onplay) el.onplay();
    bump();
    return Promise.resolve();
  };
  window.__au.list.push(el);
  return el;
};
// ---- toast 收集器（2s 即逝，轮询兜住）----
window.__toasts = [];
setInterval(function () {
  var t = document.getElementById('cc-toast');
  if (t && String(t.className).indexOf('show') >= 0 && t.textContent && window.__toasts.indexOf(t.textContent) < 0) window.__toasts.push(t.textContent);
}, 100);
`;

const SEED_LIB = JSON.stringify([
  { id: 'sm_weak1', name: '弱网测试歌', artist: 'Test', url: 'https://music.163.com/song/media/outer/url?id=999', source: 'url', neteaseId: '999', duration: 0, playlistId: 'default', addedAt: 1 },
  { id: 'sm_weak2', name: '普通外链歌', artist: 'Test', url: 'https://cdn.example.com/song2.mp3', source: 'url', neteaseId: '', duration: 0, playlistId: 'default', addedAt: 2 }
]);

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

async function loadAndSeed(query) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (query || '') });
  await waitReady();
  await sleep(400);
  // 预置曲库（含一首网易云外链歌），下次加载生效
  await evalJs(`try { window.storeFor('default').set('music-library', ${JSON.stringify(SEED_LIB)}); 'OK'; } catch(e){ 'ERR:'+e.message; }`);
}

async function openAppAndPlay() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (arguments.length > 0 ? '' : '') });
  await waitReady();
  await sleep(900);
  const opened = await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(400);
  const clicked = await evalJs(`(function(){ var row=document.querySelector('#music-lib-list .sm-song'); if(row)row.click(); return !!row; })()`);
  return { opened: opened, clicked: clicked };
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SCRIPT });

  // ================= 场景 A：换源成功路径不产生第二播放器 =================
  await loadAndSeed('');
  const a = await openAppAndPlay();
  check('音乐页打开并可点播歌曲', !!(a.opened && a.clicked), JSON.stringify(a));

  // 停滞守卫 12s 后触发换源；直链 1.2s 后应答 → 轮询等直链实例出声（上限 +14s）
  let cdnPlaying = null;
  for (let i = 0; i < 47; i++) {
    cdnPlaying = await evalJs(`(function(){
      var L = window.__au.list;
      for (var i = L.length - 1; i >= 0; i--) {
        var x = L[i];
        if (x.__played && !x.__stopped && !x.paused && String(x.src).indexOf('126.net') >= 0) return { idx: x.__idx, src: x.src };
      }
      return null;
    })()`);
    if (cdnPlaying) break;
    await sleep(300);
  }
  check('换源成功：直链实例正在播放', !!cdnPlaying, JSON.stringify(cdnPlaying));

  const snapA = await evalJs(`(function(){
    var L = window.__au.list;
    function aud(x){ return x.volume > 0.5 && String(x.src).indexOf('data:') !== 0; }
    var cur = null;
    for (var i = L.length - 1; i >= 0; i--) { if (!L[i].__stopped && !L[i].paused && aud(L[i])) { cur = L[i]; break; } }
    return {
      max: window.__au.maxConcurrent,
      total: L.length,
      detail: L.map(function(x){ return { i: x.__idx, src: String(x.src).slice(0, 46), st: x.__stopped ? 1 : 0, pa: x.paused ? 1 : 0, vol: x.volume }; }),
      strays: L.filter(function(x){ return x.__played && aud(x) && x !== cur && !x.__stopped; }).map(function(x){ return x.__idx; }),
      toasts: window.__toasts.join('|')
    };
  })()`);
  check('核心指标：全程可听音乐实例数峰值为 1（旧代码此场景=2）', snapA && snapA.max === 1, 'max=' + (snapA && snapA.max));
  check('无野元素存活：曾播放的音乐实例中除当前在播者外均已销毁', snapA && snapA.strays.length === 0, 'strays=' + JSON.stringify(snapA && snapA.strays));
  check('换源流程完整走过（出现「正在获取完整版直链」提示）', !!(snapA && snapA.toasts.indexOf('正在获取完整版直链') >= 0), snapA && snapA.toasts);

  // ================= 场景 C：消息栏切歌（next()）路径不残留旧声源 =================
  // 用户反馈复现：弱网双播放器状态下按消息栏「下一首」→ 只切走一个，旧歌继续响 → 双声。
  // 修复后：playTrack → teardownAudio 清场在册全部元素 + createAudio 建新 → 旧声源必毁。
  // 场景 A 结束时 song1（直链）在播，此时模拟消息栏 nexttrack 按钮调用 next()
  //（播放条 #sm-next 与 mediaSession nexttrack handler 调用同一个 next()）
  const nextOk = await evalJs(`(function(){ var b = document.getElementById('sm-next'); if(!b) return false; b.click(); return true; })()`);
  check('消息栏切歌可触发（找到下一首按钮）', !!nextOk);
  let song2Playing = null;
  for (let i = 0; i < 15; i++) {
    song2Playing = await evalJs(`(function(){
      var L = window.__au.list;
      for (var i = L.length - 1; i >= 0; i--) {
        var x = L[i];
        if (x.__played && !x.__stopped && !x.paused && String(x.src).indexOf('cdn.example.com') >= 0) return { idx: x.__idx, src: x.src };
      }
      return null;
    })()`);
    if (song2Playing) break;
    await sleep(200);
  }
  check('消息栏切歌：成功切到下一首并出声', !!song2Playing, JSON.stringify(song2Playing));
  const snapC = await evalJs(`(function(){
    var L = window.__au.list;
    function aud(x){ return x.volume > 0.5 && String(x.src).indexOf('data:') !== 0; }
    var cur = null;
    for (var i = L.length - 1; i >= 0; i--) { if (!L[i].__stopped && !L[i].paused && aud(L[i])) { cur = L[i]; break; } }
    return {
      max: window.__au.maxConcurrent,
      cur: cur ? { i: cur.__idx, src: String(cur.src).slice(0, 40) } : null,
      prevGone: !L.some(function(x){ return x.__played && aud(x) && String(x.src).indexOf('126.net') >= 0 && !x.__stopped; }),
      strays: L.filter(function(x){ return x.__played && aud(x) && x !== cur && !x.__stopped; }).map(function(x){ return x.__idx; })
    };
  })()`);
  check('切歌后旧歌（直链实例）已被销毁', !!(snapC && snapC.prevGone), JSON.stringify(snapC));
  check('切歌后仍无野元素存活', !!(snapC && snapC.strays.length === 0), 'strays=' + JSON.stringify(snapC && snapC.strays));
  check('全程可听音乐实例数峰值保持 1（消息栏切歌不产生双声）', !!(snapC && snapC.max === 1), 'max=' + (snapC && snapC.max));

  // ================= 场景 B：换源空窗期来电 hold → 直链回来不得起播 =================
  await loadAndSeed('?slowms=2600');
  await waitReady();
  await sleep(900);
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(400);
  await evalJs(`(function(){ var row=document.querySelector('#music-lib-list .sm-song'); if(row)row.click(); return !!row; })()`);
  // 轮询等停滞守卫触发（出现换源 toast，约 12s）
  let switchSeen = false;
  for (let i = 0; i < 60; i++) {
    const t = await evalJs('window.__toasts.join("|")');
    if (t && t.indexOf('正在获取完整版直链') >= 0) { switchSeen = true; break; }
    await sleep(250);
  }
  check('场景B：换源空窗已进入（停滞守卫触发）', switchSeen);
  // 空窗期内来电 → 音乐被 hold（audio 已被 teardown，验证 callHoldPending 分支）
  const held = await evalJs('(function(){ try { window.musicHoldForCall(true); return true; } catch(e){ return false; } })()');
  const cntAtHold = await evalJs('window.__au.list.length');
  await sleep(3800); // 等 2.6s 的直链应答到达并走完回调
  const snapB = await evalJs(`(function(){
    var L = window.__au.list;
    function aud(x){ return x.volume > 0.5 && String(x.src).indexOf('data:') !== 0; }
    return {
      total: L.length,
      cdnAny: L.some(function(x){ return String(x.src).indexOf('126.net') >= 0; }),
      sounding: L.filter(function(x){ return !x.__stopped && !x.paused && aud(x); }).map(function(x){ return x.__idx; })
    };
  })()`);
  check('空窗期 hold 后：直链回调未创建新实例', !!(held && snapB && snapB.total === cntAtHold), 'cnt ' + cntAtHold + '→' + (snapB && snapB.total));
  check('空窗期 hold 后：未用直链起播', !!(snapB && !snapB.cdnAny), JSON.stringify(snapB));
  check('空窗期 hold 后：无任何声源在响', !!(snapB && snapB.sounding.length === 0), 'sounding=' + JSON.stringify(snapB && snapB.sounding));
  // 通话结束恢复：audio 为 null → 不自动起播，保持静音
  await evalJs('(function(){ try { window.musicHoldForCall(false); return true; } catch(e){ return false; } })()');
  await sleep(700);
  const snapB2 = await evalJs(`(function(){
    var L = window.__au.list;
    function aud(x){ return x.volume > 0.5 && String(x.src).indexOf('data:') !== 0; }
    return { sounding: L.filter(function(x){ return !x.__stopped && !x.paused && aud(x); }).length, total: L.length };
  })()`);
  check('通话结束后仍保持静音（不自动续播）', !!(snapB2 && snapB2.sounding === 0 && snapB2.total === snapB.total), JSON.stringify(snapB2));

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) process.exitCode = 1;
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}
process.exit(process.exitCode || 0);

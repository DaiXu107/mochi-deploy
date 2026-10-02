// ===== 回归脚本：手机端「音乐播放 × 后台保活音频」共存——音乐卡顿修复（v3.10.x） =====
// 用法：node build.mjs && node tools/verify-music-keep-coexist.mjs
// 背景（用户反馈）：开启后台保活后播放音乐，两个 <audio> 同时出声导致音乐卡顿——
//   手机端双音频流混音/音频焦点争抢，且保活每 5 秒补播重试与音乐自身防暂停补播拉锯。
// 修复（src/js/bg-keep.js，AI-B 域）：音乐播放期间（window.__musicPlaying=true）
//   保活音频主动让位暂停（音乐自带活跃媒体会话，防后台冻结目的不丢）；停止后自动收回。
// 验证（mock Audio + mock document.createElement('audio')，统一记录 play/pause 日志；
//   预置外链测试曲 + 全局键 bg-keepalive='1' 使保活随模块加载自动启动）：
//   1) 启动时保活音频在播（wav 循环流）
//   2) 点击歌曲起播 → 瞬间保活音频被让位暂停、音乐正常在播
//   3) 音乐播放期间 5 秒轮询不再补播保活音频、playbackState 不被强设
//   4) 切前台/聚焦触发 healKeepAlive 也不把保活音频拉回来
//   5) 用户暂停音乐 → 保活音频自动收回恢复播放
//   6) music-media-release → 保活媒体条恢复 + 保活音频在播
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-keepco-' + Date.now()),
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

// 每次导航前注入：mock Audio 与 createElement('audio')（统一日志），可编程 visibilityState
const INIT_SCRIPT = `
window.__au = { list: [], log: [], lastPlayed: null };
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
    removeAttribute: function () {}, load: function () {}, setAttribute: function () {},
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
    if (String(tag).toLowerCase() === 'audio') {
      var el = mkAudio(); el.__viaCreate = true; return el;
    }
    return orig.apply(null, arguments);
  };
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
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SCRIPT });

  // ---- 第 1 次加载：预置外链测试曲 + 开启后台保活（全局系统键） ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(600);
  const seed = await evalJs(`(function(){
    try {
      var arr=[{ id:'sm_kc_1', neteaseId:'990001', name:'保活共存放心曲', artist:'Verify',
        url:'https://cdn.test/kc.mp3', source:'url', cover:'', duration:180, playlistId:'default', addedAt:Date.now() }];
      window.storeFor('default').set('music-library', JSON.stringify(arr));
      window.xyStore('xy-home-v2').set('bg-keepalive', '1');
      window.xyStore('xy-home-v2').set('__ka-noduck', '0'); // #1489：本尺量的是「媒体元素那条通道」（保活音频＋媒体条的音量闸/共存），新通道的同义断言在 verify-1489-ka-audio-channel.mjs
      return 'OK';
    } catch(e){ return 'ERR:'+e.message; }
  })()`);
  check('预置测试曲+保活开关入库', seed === 'OK', String(seed));

  // ---- 第 2 次加载：mock 生效，保活随模块启动 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(1200);
  const a1 = await evalJs(`(function(){
    var k = window.__findKeep();
    return { has: !!k, paused: k ? k.paused : null, loop: k ? k.loop : null,
      wav: k ? /data:audio\\/wav/.test(k.src) : null, plays: window.__playsOf(k) };
  })()`);
  check('A1 启动时保活音频已在播（wav 循环流）', a1 && a1.has && a1.paused === false && a1.loop && a1.wav && a1.plays >= 1, JSON.stringify(a1));

  // 打开音乐页并点击歌曲起播
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(500);
  const started = await evalJs(`(function(){
    var row=document.querySelector('#music-lib-list .sm-song'); if(!row)return 'NO-ROW';
    row.click(); return 'OK';
  })()`);
  await sleep(700);
  const b1 = await evalJs(`(function(){
    var k = window.__findKeep();
    var music = window.__au.lastPlayed;
    if (music && !music.__viaCreate) window.__musicIdx = music.__idx; // 锁定音乐实例（防 lastPlayed 被 keep 收回动作覆盖）
    return { ok:${JSON.stringify(started)}, playing: window.__musicPlaying === true,
      musicPaused: music ? music.paused : null, isMusic: music ? !music.__viaCreate : null,
      keepPaused: k ? k.paused : null };
  })()`);
  check('B2 音乐起播瞬间保活音频让位暂停', b1 && b1.ok === 'OK' && b1.playing && b1.musicPaused === false && b1.keepPaused === true, JSON.stringify(b1));
  check('B3 让位不影响音乐本身在播', b1 && b1.isMusic && b1.musicPaused === false, JSON.stringify(b1));

  // ---- 音乐播放期间：5 秒轮询不补播保活、不强设 playbackState ----
  const t0 = await evalJs('Date.now()');
  await sleep(5700);
  const c1 = await evalJs(`(function(){
    var k = window.__findKeep();
    var music = window.__au.list[window.__musicIdx];
    return { keepPlaysSince: window.__playsOf(k, ${t0}), keepPaused: k ? k.paused : null,
      musicPaused: music ? music.paused : null,
      pbState: (navigator.mediaSession && navigator.mediaSession.playbackState) || '' };
  })()`);
  check('C4 轮询周期内保活音频零补播尝试', c1 && c1.keepPlaysSince === 0 && c1.keepPaused === true, JSON.stringify(c1));
  check('C5 音乐持续在播不被打扰', c1 && c1.musicPaused === false, JSON.stringify(c1));
  check('C6 playbackState 保持音乐设置的 playing', c1 && c1.pbState === 'playing', 'pb=' + (c1 && c1.pbState));

  // ---- healKeepAlive（切前台/聚焦）也不打破让位 ----
  await evalJs(`(function(){ window.__setHidden(true); return true; })()`);
  await sleep(200);
  await evalJs(`(function(){ window.__setHidden(false); document.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); return true; })()`);
  await sleep(2200);
  const d1 = await evalJs(`(function(){
    var k = window.__findKeep();
    var music = window.__au.list[window.__musicIdx];
    return { keepPlaysHeal: window.__playsOf(k, ${t0}), keepPaused: k ? k.paused : null, musicPaused: music ? music.paused : null };
  })()`);
  check('D7 自愈路径（visible/focus/pageshow）不让保活抢回', d1 && d1.keepPlaysHeal === 0 && d1.keepPaused === true && d1.musicPaused === false, JSON.stringify(d1));

  // ---- 用户暂停音乐 → 保活音频自动收回 ----
  await evalJs(`(function(){ var btn=document.getElementById('sm-play'); if(btn)btn.click(); return !!btn; })()`);
  await sleep(700);
  const e1 = await evalJs(`(function(){
    var k = window.__findKeep();
    var music = window.__au.list[window.__musicIdx];
    return { playingFlag: window.__musicPlaying === false, keepResumed: k ? k.paused === false : null,
      musicPaused: music ? music.paused : null };
  })()`);
  check('E8 音乐暂停后保活音频自动收回在播', e1 && e1.playingFlag && e1.keepResumed && e1.musicPaused === true, JSON.stringify(e1));

  // ---- music-media-release：保活媒体条恢复 ----
  const f1 = await evalJs(`(function(){
    try { document.dispatchEvent(new Event('music-media-release')); } catch(e){ return 'ERR:'+e.message; }
    var md = navigator.mediaSession && navigator.mediaSession.metadata;
    return { title: md ? md.title : '', keep: (window.__findKeep()||{}).paused };
  })()`);
  check('F9 停止后保活媒体条恢复（metadata=后台保活）', f1 && /后台保活/.test(f1.title) && f1.keep === false, JSON.stringify(f1));

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

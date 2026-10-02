// ===== 回归脚本：手机端切后台音乐停摆——外部打断自动续播（v3.10.x 修复） =====
// 用法：node build.mjs && node tools/verify-music-bg-resume.mjs
// 背景（用户反馈）：音乐播放中浏览器挂后台，突然音乐就停了，切回前台才恢复。
// 根因：手机浏览器/系统会在后台因省电、音频焦点抢占、渲染进程冻结等暂停 <audio>
//   （用户没点暂停），旧代码只有 armAutoResume「等用户手势」兜底，后台毫无反击；
//   回前台能"自己恢复"全靠冻结解除后 ended/checkAutoEnd 补处理的运气。
// 修复：引入「意图播放」标记 wantPlay（仅用户主动暂停/真停止/来电 hold 清除），
//   外部打断 → 后台按 300ms~12s 退避定时补播（原元素优先，被拒 muted 解锁降级，
//   再失败重建元素）；回前台 visible/focus/pageshow 立即补播；10s 看门狗兜底；
//   连续失败封顶 6 次防死链无限拉取。
// 验证（mock window.Audio 记录 play/pause/systemPause 日志；systemPause 模拟系统
//   在后台不打招呼的打断）：点击列表真实驱动 playTrack 后逐场景断言：
//   1) 点击歌曲正常起播（onplay/__musicPlaying）
//   2) 切后台 + 被打断 → 1.5s 内自动续播且恢复播放态
//   3) 用户点暂停后再次被打断 → 不自动续播（意图已清除）
//   4) 回前台（visible）→ 立即恢复播放
//   5) 来电 hold 打断 → 不续播；hold 释放 → 恢复播放
//   6) 元素丢失/ended 未处理（冻结期场景）→ 自动重建元素续播（外链歌）
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-bgresume-' + Date.now()),
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

// 每次导航前注入：mock Audio（记录日志）+ 可编程的 visibilityState
const INIT_SCRIPT = `
window.__au = { list: [], log: [], lastPlayed: null };
window.Audio = function () {
  var idx = window.__au.list.length;
  var el = {
    __idx: idx,
    paused: true, ended: false, duration: 200, currentTime: 0,
    readyState: 4, networkState: 1, volume: 1, muted: false,
    preload: '', src: '', referrerPolicy: '',
    buffered: { length: 0, end: function () { return 0; } },
    style: {}, parentNode: { removeChild: function () {} },
    onplay: null, onpause: null, onended: null, onerror: null, onloadedmetadata: null,
    removeAttribute: function () {}, load: function () {},
    addEventListener: function () {}
  };
  el.play = function () {
    el.paused = false; el.ended = false;
    window.__au.log.push({ act: 'play', inst: idx, hidden: !!document.hidden, t: Date.now() });
    window.__au.lastPlayed = el;
    if (window.__au.rejectNext) {
      // 模拟源加载失败（meting 不可达/断网）：Chrome 对无法加载的 media 会 reject
      // 并把元素留在暂停态（paused=true），非 NotAllowedError
      var e = window.__au.rejectNext; window.__au.rejectNext = null;
      el.paused = true;
      return Promise.reject(e);
    }
    if (el.onplay) el.onplay();
    return Promise.resolve();
  };
  el.pause = function () {
    if (el.paused) return;
    el.paused = true;
    window.__au.log.push({ act: 'pause', inst: idx, hidden: !!document.hidden, t: Date.now() });
    if (el.onpause) el.onpause();
  };
  // 模拟系统/浏览器在后台不打招呼的打断：不经 pause()，直接置位并派发事件
  el.systemPause = function () {
    el.paused = true;
    window.__au.log.push({ act: 'syspause', inst: idx, hidden: !!document.hidden, t: Date.now() });
    if (el.onpause) el.onpause();
  };
  window.__au.list.push(el);
  return el;
};
window.__setHidden = function (h) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return h ? 'hidden' : 'visible'; } });
  Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return !!h; } });
  document.dispatchEvent(new Event('visibilitychange'));
};
window.__playsSince = function (ts) { return window.__au.log.filter(function (e) { return e.act === 'play' && e.t > ts; }).length; };
// 音乐源离线模拟：meting/网易云外链 fetch 一律失败——保持测试封闭（不依赖真实网络），
// 同时让「一次性 https 重试链」无法借真实网络救场：修复前代码会走 retryWithHttpsUrl
// 把元素换成外链 URL，修复后代码留在原元素由退避补播接上（场景⑥ 据此区分新旧行为）
window.__realFetch = window.fetch;
window.fetch = function (url, opts) {
  var u = String(url);
  if (u.indexOf('api.injahow.cn') >= 0 || u.indexOf('music.163.com') >= 0) {
    return Promise.reject(new TypeError('network blocked (offline sim)'));
  }
  return window.__realFetch.apply(window, arguments);
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

  // ---- 第 1 次加载：写入一首外链测试曲 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(600);
  const seed = await evalJs(`(function(){
    var arr=[
      { id:'sm_bg_1', neteaseId:'990001', name:'BG回归曲1', artist:'Verify',
        url:'https://cdn.test/a.mp3', source:'url', cover:'', duration:180, playlistId:'default', addedAt:Date.now() },
      { id:'sm_bg_2', neteaseId:'990002', name:'BG回归曲2', artist:'Verify',
        url:'https://cdn.test/b.mp3', source:'url', cover:'', duration:180, playlistId:'default', addedAt:Date.now() }
    ];
    try { window.storeFor('default').set('music-library', JSON.stringify(arr)); return true; } catch(e){ return 'ERR:'+e.message; }
  })()`);
  check('预置测试曲入库', seed === true, String(seed));

  // ---- 第 2 次加载：mock 生效，走完整播放流程 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(900);
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(500);
  const started = await evalJs(`(function(){
    var row=document.querySelector('#music-lib-list .sm-song'); if(!row)return 'NO-ROW';
    row.click(); return 'OK';
  })()`);
  await sleep(400);
  const s0 = await evalJs(`(function(){
    var L=window.__au.log;
    return { ok:${JSON.stringify(started)}, plays:L.filter(function(e){return e.act==='play';}).length,
      playing: window.__musicPlaying===true, lastPaused: window.__au.lastPlayed?window.__au.lastPlayed.paused:null };
  })()`);
  check('点击歌曲正常起播', s0 && s0.plays >= 1 && s0.playing && s0.lastPaused === false, JSON.stringify(s0));
  const curId = await evalJs(`(function(){ try{ return (JSON.parse(window.storeFor('default').get('music-library')||'[]')[0]||{}).id; }catch(e){ return null; } })()`);

  // ---- 场景 ①：切后台 + 系统打断 → 自动续播 ----
  const scA = await evalJs(`(function(){
    window.__setHidden(true);
    window.__au.lastPlayed.systemPause();
    return Date.now();
  })()`);
  await sleep(1600);
  const rA = await evalJs(`(function(){
    return { plays: window.__playsSince(${scA}), paused: window.__au.lastPlayed.paused, playing: window.__musicPlaying===true };
  })()`);
  check('后台被打断 → 1.5s 内自动续播', rA && rA.plays >= 1, JSON.stringify(rA));
  check('自动续播后恢复播放态', rA && rA.paused === false && rA.playing, JSON.stringify(rA));

  // ---- 场景 ②：用户主动暂停后，再被打断不得自动续播 ----
  const scB = await evalJs(`(function(){
    window.__setHidden(false);
    var btn=document.getElementById('sm-play'); if(btn)btn.click(); // toggle → 用户暂停
    return Date.now();
  })()`);
  await sleep(300);
  const midB = await evalJs(`(function(){ window.__au.lastPlayed.systemPause(); return window.__au.log.filter(function(e){return e.act==='play';}).length; })()`);
  await sleep(2200);
  const rB = await evalJs(`(function(){ return window.__au.log.filter(function(e){return e.act==='play';}).length; })()`);
  check('用户暂停后再被打断 → 不自动续播', rB === midB, 'before=' + midB + ' after=' + rB);

  // ---- 场景 ③：回前台立即恢复 ----
  await evalJs(`(function(){ var btn=document.getElementById('sm-play'); if(btn)btn.click(); return true; })()`);
  await sleep(300);
  const scC = await evalJs(`(function(){
    window.__setHidden(true);
    window.__au.lastPlayed.systemPause();
    window.__setHidden(false); // 冻结解除/回到前台 → visible 兜底应立即拉起
    return Date.now();
  })()`);
  await sleep(1300);
  const rC = await evalJs(`(function(){ return { plays: window.__playsSince(${scC}), paused: window.__au.lastPlayed.paused }; })()`);
  check('回前台 → 播放恢复', rC && rC.plays >= 1 && rC.paused === false, JSON.stringify(rC));

  // ---- 场景 ④：来电 hold 打断不抢播；释放后恢复 ----
  const scD = await evalJs(`(function(){
    window.musicHoldForCall(true);
    return { held: window.__au.lastPlayed.paused };
  })()`);
  const midD = await evalJs(`(function(){ window.__au.lastPlayed.systemPause(); return window.__au.log.filter(function(e){return e.act==='play';}).length; })()`);
  await sleep(1900);
  const afterD = await evalJs(`(function(){ return window.__au.log.filter(function(e){return e.act==='play';}).length; })()`);
  check('来电 hold＝暂停且不被自动续播打扰', scD && scD.held === true && afterD === midD, JSON.stringify(scD) + ' plays ' + midD + '→' + afterD);
  const relD = await evalJs(`(function(){
    window.musicHoldForCall(false);
    return { paused: window.__au.lastPlayed.paused, plays: window.__au.log.filter(function(e){return e.act==='play';}).length };
  })()`);
  check('通话结束 → hold 前在播的歌恢复播放', relD && relD.paused === false && relD.plays > midD, JSON.stringify(relD));

  // ---- 场景 ⑤：元素丢失/ended 未处理（冻结期结束未触发）→ 重建元素续播 ----
  const cntE = await evalJs(`(function(){
    window.__setHidden(true);
    var el=window.__au.lastPlayed;
    el.ended = true; el.paused = true;
    el.systemPause();
    return { insts: window.__au.list.length };
  })()`);
  await sleep(1700);
  const rE = await evalJs(`(function(){
    var L=window.__au.list, last=L[L.length-1];
    return { insts: L.length, rebuilt: last && last.src==='https://cdn.test/a.mp3',
      playing: last && last.paused===false, cid: ${JSON.stringify(curId)} };
  })()`);
  check('ended 未处理 → 自动重建元素续播（外链歌）', rE && rE.insts > cntE.insts && rE.rebuilt && rE.playing, JSON.stringify(rE));

  // ---- 场景 ⑥：后台自动下一首源加载失败（NotSupportedError）→ 退避补播自动接上 ----
  // 回归锚点：a6d854a 起非 NotAllowedError 拒绝直接走一次性 https 重试链（后台单发
  // 即弃、无退避，红米K80 实测「切后台无法自动播放下一首」）；修复后后台拒绝恢复
  // scheduleBgResume 退避补播——留在原元素反复试播，源恢复即接上（不断网不换 URL）。
  const scF = await evalJs(`(function(){
    window.__setHidden(true);
    window.__au.rejectNext = { name: 'NotSupportedError', message: 'source load failed' };
    window.__au.lastPlayed.onended(); // 触发自动下一首 → playTrack(sm_bg_2) → play() 被拒
    return Date.now();
  })()`);
  await sleep(500);
  const rF1 = await evalJs(`(function(){
    var last = window.__au.lastPlayed;
    return { src: last ? last.src : null, hidden: !!document.hidden };
  })()`);
  check('后台自动下一首源加载失败 → 已切到下一首（未被换成外链 URL）', rF1 && rF1.src === 'https://cdn.test/b.mp3', JSON.stringify(rF1));
  await sleep(1300);
  const rF = await evalJs(`(function(){
    var last = window.__au.lastPlayed;
    return { src: last ? last.src : null, paused: last ? last.paused : null, playing: window.__musicPlaying===true };
  })()`);
  check('后台源恢复 → 退避补播在原元素接上播放', rF && rF.src === 'https://cdn.test/b.mp3' && rF.paused === false && rF.playing, JSON.stringify(rF));

  const fin = await evalJs('(function(){ return window.__musicPlaying===true; })()');
  check('结束时处于播放中状态', fin === true);

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

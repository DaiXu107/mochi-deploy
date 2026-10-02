// ===== 回归脚本：TA收藏（联系人收藏歌曲）删歌后记录保留 + 快照迁移 + 网易云歌还原播放 =====
// 用法：node build.mjs && node tools/verify-music-ta-fav-keep.mjs
// 背景（用户要求 2026-08-30）：音乐库里的歌删掉后，「XX的收藏」里的记录依旧保留。
// 根因：music-favs-ta 只存歌曲 ID，渲染用 findTrack(id).filter(Boolean)——歌曲一删
//   记录整体消失（ID 成永远无法显示也无法移除的僵尸项）。
// 修复：改存歌曲快照 {id,name,artist,neteaseId,url,cover,duration,favAt}；旧纯 id
//   数据渲染时从库内回补快照（自愈迁移）；已删歌曲用快照展示 +「已删除」标识；
//   点击已删歌：有 neteaseId/原 url → 重新加入音乐库并播放；否则提示无法播放。
// 验证：
//   1) 旧纯 id 数据渲染：库内歌曲名正常、已删歌显示「已删除」+ 无法播放提示，且快照回写
//   2) 删除库内歌曲后 TA 收藏记录依旧保留（名字来自快照 + 已删除标识 + 可还原提示）
//   3) 点击已删的网易云歌 → 重新入库并起播，收藏条目指向新 id、恢复可播
//   4) 已删不可还原歌的移除按钮仍可用
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-tafavkeep-' + Date.now()),
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

// 每次导航前注入：mock Audio（任何 src 都起播成功，不做网络）
const INIT_SCRIPT = `
window.__au = { list: [], log: [] };
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
    window.__au.log.push({ act: 'play', inst: idx, src: String(el.src).slice(0, 90) });
    if (el.onplay) el.onplay();
    return Promise.resolve();
  };
  el.pause = function () { el.paused = true; if (el.onpause) el.onpause(); };
  window.__au.list.push(el);
  return el;
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

  // ---- 第 1 次加载：写入旧格式数据（纯 id 的 music-favs-ta + 音乐库两首歌）----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(600);
  const seed = await evalJs(`(function(){
    try {
      var store = window.storeFor('default');
      store.set('music-library', JSON.stringify([
        { id:'sm_t1', neteaseId:'990001', name:'网易歌A', artist:'TA爱听', url:'https://api.injahow.cn/meting/?type=url&id=990001', source:'url', cover:'', duration:180, playlistId:'default', addedAt:1 },
        { id:'sm_t2', neteaseId:'', name:'直链歌B', artist:'Verify', url:'https://cdn.test/b.mp3', source:'url', cover:'', duration:200, playlistId:'default', addedAt:2 }
      ]));
      // 旧格式：纯 id 数组——含两首库内歌 + 一首已删歌（sm_gone）
      store.set('music-favs-ta', JSON.stringify(['sm_t1','sm_t2','sm_gone']));
      return true;
    } catch(e){ return 'ERR:'+e.message; }
  })()`);
  check('预置旧格式数据（库2首 + 收藏3条纯id）', seed === true, String(seed));

  // ---- 第 2 次加载：进音乐页收藏 tab，验证旧数据自愈迁移 + 已删歌展示 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(900);
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(400);
  const openTa = await evalJs(`(function(){
    var tab=document.querySelector('#page-music .fav-tab[data-mtab="favta"]'); if(!tab)return 'NO-TAB';
    tab.click(); return 'OK';
  })()`);
  await sleep(400);
  const r1 = await evalJs(`(function(){
    var rows=document.querySelectorAll('#music-fav-ta-list .sm-song');
    var out={ n:rows.length, names:[], gone:[], goneTags:0 };
    rows.forEach(function(r){
      var nm=r.querySelector('.sm-song-name');
      var sub=r.querySelector('.sm-song-sub');
      out.names.push(nm?nm.textContent.trim():'');
      out.subs = out.subs || [];
      out.subs.push(sub?sub.textContent.trim():'');
      if(r.classList.contains('ta-fav-gone')){ out.gone.push(nm?nm.textContent.trim():''); if(nm&&nm.querySelector('.sm-fav-gone-tag')) out.goneTags++; }
    });
    return out;
  })()`);
  check('收藏 tab 打开（favta）', openTa === 'OK', openTa);
  check('旧纯 id 数据渲染出 3 行（库内歌名字正常 + 已删歌占位）', !!(r1 && r1.n === 3 && r1.names[0] === '网易歌A' && r1.names[1] === '直链歌B'), JSON.stringify(r1 ? r1.names : null));
  check('已删歌(sm_gone)行：置灰 + 已删除标签 + 无法播放提示', !!(r1 && r1.gone.length === 1 && r1.gone[0].indexOf('未知歌曲') >= 0 && r1.goneTags === 1 && r1.subs[2].indexOf('无法播放') >= 0), JSON.stringify(r1 ? { gone: r1.gone, goneTags: r1.goneTags, sub: r1.subs[2] } : null));
  const healed = await evalJs(`(function(){
    var v=JSON.parse(window.storeFor('default').get('music-favs-ta')||'[]');
    return { n:v.length, t1: v[0] && v[0].name, t2: v[1] && v[1].name, isObj: typeof v[0] === 'object' };
  })()`);
  check('旧 id 数据自愈回写快照（库内歌补 name/neteaseId）', !!(healed && healed.isObj && healed.t1 === '网易歌A' && healed.t2 === '直链歌B'), JSON.stringify(healed));

  // ---- 删除库内 sm_t1（网易云歌）→ 整页重载从 LS 重建内存库 → TA 收藏记录保留 + 可还原 ----
  await evalJs(`(function(){
    var store = window.storeFor('default');
    var lib=JSON.parse(store.get('music-library')||'[]').filter(function(m){return m.id!=='sm_t1';});
    store.set('music-library', JSON.stringify(lib));
    return lib.length;
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(900);
  await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el)el.click(); return !!el; })()`);
  await sleep(300);
  await evalJs(`(function(){ var t=document.querySelector('#page-music .fav-tab[data-mtab="favta"]'); if(t)t.click(); return true; })()`);
  await sleep(300);
  const r2 = await evalJs(`(function(){
    var rows=document.querySelectorAll('#music-fav-ta-list .sm-song');
    var out={ n:rows.length, t1gone:false, t1name:'', t1sub:'' };
    rows.forEach(function(r){
      var nm=r.querySelector('.sm-song-name'); var sub=r.querySelector('.sm-song-sub');
      if(nm && nm.textContent.indexOf('网易歌A')>=0){ out.t1name=nm.textContent.trim(); out.t1sub=sub?sub.textContent.trim():''; out.t1gone=r.classList.contains('ta-fav-gone'); }
    });
    return out;
  })()`);
  check('删歌后 TA 收藏记录依旧保留（网易歌A 行仍在，名字来自快照）', !!(r2 && r2.n >= 3 && r2.t1name.indexOf('网易歌A') >= 0), JSON.stringify(r2));
  check('已删的网易歌A 行：已删除标签 + 可还原提示', !!(r2 && r2.t1gone && r2.t1name.indexOf('已删除') >= 0 && r2.t1sub.indexOf('重新加入') >= 0), JSON.stringify(r2));

  // ---- 点击已删的网易歌A → 重新加入音乐库并播放 ----
  const prePlays = await evalJs('window.__au.log.filter(function(e){return e.act==="play";}).length');
  await evalJs(`(function(){
    var rows=document.querySelectorAll('#music-fav-ta-list .sm-song');
    for(var i=0;i<rows.length;i++){ var nm=rows[i].querySelector('.sm-song-name'); if(nm && nm.textContent.indexOf('网易歌A')>=0){ rows[i].click(); break; } }
    return true;
  })()`);
  await sleep(600);
  const r3 = await evalJs(`(function(){
    var store = window.storeFor('default');
    var lib=JSON.parse(store.get('music-library')||'[]');
    var restored = lib.filter(function(m){return m.neteaseId==='990001';});
    var ta=JSON.parse(store.get('music-favs-ta')||'[]');
    var plays=window.__au.log.filter(function(e){return e.act==='play';}).length;
    var rows=document.querySelectorAll('#music-fav-ta-list .sm-song');
    var liveNow=false;
    rows.forEach(function(r){ var nm=r.querySelector('.sm-song-name'); if(nm && nm.textContent.indexOf('网易歌A')>=0 && !r.classList.contains('ta-fav-gone')) liveNow=true; });
    return { restoredN: restored.length, restoredName: restored[0]?restored[0].name:'', restoredUrl: restored[0]?restored[0].url:'', taId: ta[0]?ta[0].id:'', plays: plays, liveNow: liveNow };
  })()`);
  check('点击已删网易云歌 → 重新加入音乐库（neteaseId 恢复，meting 直链重建）', !!(r3 && r3.restoredN === 1 && r3.restoredName === '网易歌A' && r3.restoredUrl.indexOf('meting') >= 0), JSON.stringify(r3));
  check('重新入库后已起播，收藏条目指向新 id、行恢复可播', !!(r3 && r3.plays > prePlays && r3.taId.indexOf('sm_fav_') === 0 && r3.liveNow), JSON.stringify({ taId: r3.taId, plays: r3.plays, liveNow: r3.liveNow }));

  // ---- 已删不可还原歌（sm_gone）的移除按钮仍可用 ----
  await evalJs(`(function(){
    var rows=document.querySelectorAll('#music-fav-ta-list .sm-song');
    for(var i=0;i<rows.length;i++){ var nm=rows[i].querySelector('.sm-song-name'); if(nm && nm.textContent.indexOf('未知歌曲')>=0){ var b=rows[i].querySelector('.sm-song-more'); if(b)b.click(); break; } }
    return true;
  })()`);
  await sleep(300);
  const r4 = await evalJs(`(function(){
    var rows=document.querySelectorAll('#music-fav-ta-list .sm-song');
    var names=[];
    rows.forEach(function(r){ var nm=r.querySelector('.sm-song-name'); if(nm)names.push(nm.textContent.trim()); });
    var ta=JSON.parse(window.storeFor('default').get('music-favs-ta')||'[]');
    return { n:rows.length, hasGone: names.some(function(n){return n.indexOf('未知歌曲')>=0;}), taLen: ta.length };
  })()`);
  check('已删不可还原歌可正常移除（行消失 + 存储清理）', !!(r4 && r4.n === 2 && !r4.hasGone && r4.taLen === 2), JSON.stringify(r4));

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

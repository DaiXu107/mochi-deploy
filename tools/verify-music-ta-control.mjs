// ===== 音乐·梦角主动控制概率 + 联系人收藏歌曲 专项验证 =====
// 覆盖：音乐设置新增 4 个概率（歌曲播完切下一首/随机挑歌/换播放模式、TA收藏歌曲）
// 的 UI 与持久化；【TA的收藏】tab 渲染与昵称联动；歌曲播完 TA 按概率接动作；
// 播放歌曲听一会儿后联系人按概率把歌收进「TA的收藏」。
// 用法：node tools/verify-music-ta-control.mjs（需先 node build.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

// —— 生成静音 WAV dataURL（Node 侧拼，注入浏览器当本地音频）——
function makeWavDataUrl(seconds, sr) {
  const n = sr * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / sr * 440) * 4000), 44 + i * 2);
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mtc-' + Date.now()),
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const lsGetRaw = (k) => evalJs("(function(){try{return localStorage.getItem('" + k + "');}catch(e){return null;}})()");

// 打开页面 → 等数据就绪 → 过开屏 → 进音乐页
async function openMusic(tab) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(500);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-music');});var t=document.querySelector('#page-music .fav-tab[data-mtab=\"" + (tab || 'lib') + "\"]');if(t)t.click();return true;})()");
  await sleep(500);
}
// 预置两首本地歌（直接写库 + IDB 音频），可选写入 music-global 设置
async function seedSongs(songs, globalSettings) {
  const payload = JSON.stringify({
    songs, gs: globalSettings || null,
    filePrefix: 'xy-home-v2:default:music-file:'
  }).replace(/'/g, '\\\'');
  return evalJs("(async function(){var d=" + payload + ";" +
    "if(window.idbSet){for(var i=0;i<d.songs.length;i++){await window.idbSet(d.filePrefix+d.songs[i].id,d.songs[i].wav);}}" +
    "window.activeStore().set('music-library',JSON.stringify(d.songs.map(function(s){return {id:s.id,name:s.name,artist:'',url:'',source:'local',duration:s.dur||1,playlistId:'default',addedAt:Date.now()};})));" +
    "if(d.gs)window.activeStore().set('music-global',JSON.stringify(d.gs));" +
    "return true;})()");
}
const settingsRows = () => evalJs("Array.from(document.querySelectorAll('#tc-body .gs-row')).map(function(r){var lab=r.querySelector('span')?r.querySelector('span').textContent:'';var v=r.querySelector('.stp-val')?r.querySelector('.stp-val').value:null;return lab+'='+v;})") || [];
const clickStep = (id, dir) => evalJs("(function(){var b=document.querySelector('#" + id + " ." + (dir < 0 ? 'stp-min' : 'stp-max') + "');if(b){b.click();return true;}return false;})()");
// 失败诊断：行列表/播放条/提示/audio 错误
const playDebug = () => Promise.all([
  evalJs("Array.from(document.querySelectorAll('#music-lib-list .sm-song')).map(function(r){return r.dataset.id;})"),
  evalJs("(function(){var e=document.getElementById('cc-toast');return e?e.textContent:'';})()"),
  evalJs("(function(){var el=document.getElementById('sm-pb-name');return el?el.textContent:'';})()"),
  evalJs('!!window.__musicPlaying')
]).then(([rows, toast, pb, playing]) => 'rows=' + JSON.stringify(rows) + ' toast=' + toast + ' pb=' + pb + ' playing=' + playing);

// 点击歌曲并等待真正开播（轮询，最多 ~12s；中途未开播则补点一次）
async function clickAndPlay(id) {
  for (let i = 0; i < 6; i++) {
    await evalJs("(function(){var r=document.querySelector('#music-lib-list .sm-song[data-id=\"" + id + "\"]');if(r)r.click();return true;})()");
    for (let j = 0; j < 8; j++) {
      await sleep(700);
      if (await evalJs('!!window.__musicPlaying')) return true;
    }
  }
  return false;
}

console.log('--- 音乐·梦角主动控制概率 + 联系人收藏歌曲 验证 ---');

// ===== A. 设置面板：新概率行渲染 + 默认值 + 步进持久化 =====
await openMusic();
await evalJs("(function(){var b=document.getElementById('music-set');if(b)b.click();return true;})()");
await sleep(500);
let rows = await settingsRows();
check('A1 设置面板含「歌曲播完·切下一首概率」且默认 15', rows.some(r => r.indexOf('歌曲播完·切下一首概率=15') >= 0), rows.join(' | '));
check('A2 设置面板含「歌曲播完·随机挑歌概率」且默认 10', rows.some(r => r.indexOf('歌曲播完·随机挑歌概率=10') >= 0));
check('A3 设置面板含「歌曲播完·换播放模式概率」且默认 5', rows.some(r => r.indexOf('歌曲播完·换播放模式概率=5') >= 0));
check('A4 设置面板含「TA 收藏歌曲概率」且默认 20', rows.some(r => r.indexOf('TA 收藏歌曲概率=20') >= 0));
check('A5 原有「音乐请求触发概率」仍为 5（未被破坏）', rows.some(r => r.indexOf('音乐请求触发概率=5') >= 0));
await clickStep('sm-set-next', 1);   // 15→20
await clickStep('sm-set-favprob', -1); // 20→15
await sleep(300);
rows = await settingsRows();
check('A6 步进可调：切下一首 15→20、TA收藏 20→15', rows.some(r => r.indexOf('切下一首概率=20') >= 0) && rows.some(r => r.indexOf('TA 收藏歌曲概率=15') >= 0), rows.join(' | '));
const mgRaw = await lsGetRaw('xy-home-v2:default:music-global');
let mg = {}; try { mg = JSON.parse(mgRaw || '{}'); } catch (e) {}
check('A7 概率改动持久化到 music-global（taNextProb=20 / taFavProb=15）', Number(mg.taNextProb) === 20 && Number(mg.taFavProb) === 15, JSON.stringify(mg));

// ===== B.【TA的收藏】tab：存在、昵称联动、空态文案 =====
await openMusic('favta');
const tabLabel = await evalJs("(function(){var t=document.querySelector('#page-music .fav-tab[data-mtab=\"favta\"]');return t?t.textContent:'';})()");
check('B1 favta tab 存在且默认昵称文案「TA的收藏」', tabLabel === 'TA的收藏', tabLabel);
const emptyHtml = await evalJs("(function(){var el=document.getElementById('music-fav-ta-list');return el?el.textContent:'';})()");
check('B2 空态文案包含昵称', emptyHtml.indexOf('还没有收藏歌曲') >= 0 && emptyHtml.indexOf('TA') >= 0, emptyHtml.slice(0, 40));
// 昵称联动：设 lbl-partner 后 renderPage 重填
await evalJs("(function(){window.activeStore().set('lbl-partner','小梦');return true;})()");
await evalJs("(function(){document.getElementById('music-back').click();return true;})()");
await sleep(200);
await openMusic('favta');
const tabLabel2 = await evalJs("(function(){var t=document.querySelector('#page-music .fav-tab[data-mtab=\"favta\"]');return t?t.textContent:'';})()");
check('B3 设昵称后 tab 变为「小梦的收藏」', tabLabel2 === '小梦的收藏', tabLabel2);

// ===== C. 联系人收藏歌曲：taFavProb=100，播放后 10~25s 内收进 music-favs-ta =====
const wavLong = makeWavDataUrl(40, 8000); // 40s 长音：判定窗口内不会自然结束（采样率需≥8k，低采样率 Chromium 解码失败）
await seedSongs([{ id: 'mtc_a', name: '收藏测试歌', dur: 40, wav: wavLong }], { taFavProb: 100, taNextProb: 0, taRandProb: 0, taModeProb: 0 });
await openMusic('lib');
const playing = await clickAndPlay('mtc_a');
check('C1 点击歌曲开始播放', !!playing, 'playing=' + playing + (playing ? '' : ' | ' + await playDebug()));
let favHit = false;
for (let i = 0; i < 40 && !favHit; i++) { // 最多等 ~32s（判定延迟 10~25s + 余量）
  await sleep(800);
  const raw = await evalJs("(function(){try{return window.activeStore().get('music-favs-ta');}catch(e){return null;}})()");
  try {
    // 兼容两代格式：旧=纯 id 字符串数组；v3.26.x 起=歌曲快照对象数组 {id,...}
    const arr = JSON.parse(raw || '[]');
    favHit = arr.some(x => x === 'mtc_a' || (x && x.id === 'mtc_a'));
  } catch (e) {}
}
check('C2 听一会儿后联系人按 100% 概率收藏了这首歌（music-favs-ta）', favHit);
await evalJs("(function(){var t=document.querySelector('#page-music .fav-tab[data-mtab=\"favta\"]');if(t)t.click();return true;})()");
await sleep(300);
const favRow = await evalJs("(function(){var el=document.getElementById('music-fav-ta-list');var r=el&&el.querySelector('.sm-song[data-id=\"mtc_a\"]');return r?(r.querySelector('.sm-song-name')||{}).textContent||'':'';})()");
check('C3 「小梦的收藏」列表显示被收藏的歌曲', favRow === '收藏测试歌', String(favRow));

// ===== D. 歌曲播完 TA 接动作：换播放模式概率 100% =====
// 两首短歌（1s），reqProb=100 + 无冷却直接调真实 maybeMusicRequest → 点「一起听」
// 接受 → taActive=true → 歌播完必触发换播放模式
const wavShort = makeWavDataUrl(1, 8000);
await seedSongs(
  [{ id: 'mtc_b1', name: '短歌一', dur: 1, wav: wavShort }, { id: 'mtc_b2', name: '短歌二', dur: 1, wav: wavShort }],
  { reqProb: 100, cooldownMs: 0, taNextProb: 0, taRandProb: 0, taModeProb: 100, taFavProb: 0 }
);
await openMusic('lib');
await evalJs("(function(){window.maybeMusicRequest();return true;})()");
let hasReq = false;
for (let i = 0; i < 10 && !hasReq; i++) { await sleep(500); hasReq = await evalJs("!!document.getElementById('sm-req-yes')"); }
check('D0 真实邀请链路弹出「一起听」确认', !!hasReq);
await evalJs("(function(){var y=document.getElementById('sm-req-yes');if(y)y.click();return true;})()");
await sleep(800);
// 面板没关掉说明首次点击没生效，补点一次
await evalJs("(function(){var y=document.getElementById('sm-req-yes');if(y)y.click();return true;})()");
let modeRec = '';
for (let i = 0; i < 28 && !modeRec; i++) { // 歌长 1s，播完即应产生换模式记录
  await sleep(700);
  const raw = await evalJs("(function(){try{return window.activeStore().get('music-history');}catch(e){return null;}})()");
  try {
    const arr = JSON.parse(raw || '[]');
    const hit = arr.filter(h => h.mode && /TA 把播放模式换成/.test(h.triggerType || ''));
    if (hit.length) modeRec = hit[hit.length - 1].triggerType;
  } catch (e) {}
}
check('D1 歌曲播完 TA 按 100% 概率换了播放模式并有记录', modeRec.indexOf('TA 把播放模式换成') === 0, modeRec || '(无记录)');

// ===== E. 三项全 0 = TA 不主动控制：播完不产生任何 TA 动作记录 =====
await seedSongs(
  [{ id: 'mtc_c1', name: '安静歌一', dur: 1, wav: wavShort }, { id: 'mtc_c2', name: '安静歌二', dur: 1, wav: wavShort }],
  { reqProb: 100, cooldownMs: 0, taNextProb: 0, taRandProb: 0, taModeProb: 0, taFavProb: 0 }
);
await openMusic('lib');
await evalJs("(function(){window.maybeMusicRequest();return true;})()");
let hasReq2 = false;
for (let i = 0; i < 10 && !hasReq2; i++) { await sleep(500); hasReq2 = await evalJs("!!document.getElementById('sm-req-yes')"); }
await evalJs("(function(){var y=document.getElementById('sm-req-yes');if(y)y.click();return true;})()");
await sleep(800);
await evalJs("(function(){var y=document.getElementById('sm-req-yes');if(y)y.click();return true;})()");
const histBefore = JSON.parse(await evalJs("(function(){return window.activeStore().get('music-history')||'[]';})()") || '[]');
await sleep(4500);
const histAfter = JSON.parse(await evalJs("(function(){return window.activeStore().get('music-history')||'[]';})()") || '[]');
const newTaActs = histAfter.slice(histBefore.length).filter(h => (h.mode && /TA 把播放模式换成/.test(h.triggerType || '')) || /TA 切到了下一首|TA 随机挑了一首/.test(h.triggerType || ''));
check('E1 三项概率全 0 时歌曲播完 TA 无任何主动控制记录', newTaActs.length === 0, 'new=' + newTaActs.length);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

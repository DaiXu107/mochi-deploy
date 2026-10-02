// ===== 音乐·联系人「预订下一首」→ 待播队列 专项验证 =====
// 覆盖：正在播放时 TA 按概率预订一首歌 → 系统消息发出 → 打开「播放列表」面板
// 的【待播队列】分区应能看到被预订的歌（且不与被播歌重复）。
// 用法：node tools/verify-music-reserve-queue.mjs（需先 node build.mjs）
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mrq-' + Date.now()),
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
// 读取当前播放歌曲名（播放条）
const pbName = () => evalJs("(function(){var el=document.getElementById('sm-pb-name');return el?el.textContent.trim():'';})()");
// 打开播放列表面板，返回 {queueSection, playingSection, panelText}
async function openQueuePanelDump() {
  await evalJs("(function(){var b=document.getElementById('sm-queue');if(b)b.click();return true;})()");
  await sleep(400);
  const body = await evalJs("(function(){var el=document.getElementById('tc-body');return el?el.textContent:'';})()");
  const html = await evalJs("(function(){var el=document.getElementById('tc-body');return el?el.innerHTML:'';})()");
  // 待播队列区：第一个 .sm-req-hint「待播队列」到「当前播放列表」标题之间
  let queueNames = [];
  const queueHtml = (html || '').split('当前播放列表')[0] || '';
  queueNames = Array.from(queueHtml.matchAll(/sm-song-name">([^<]+)</g) || []).map(m => m[1]);
  const playingNames = Array.from((html || '').matchAll(/sm-song-name">([^<]+)</g) || []).map(m => m[1]);
  return { body: (body || '').trim(), queueNames, playingNames, htmlLen: (html || '').length };
}

console.log('--- 音乐·联系人「预订下一首」→ 待播队列 验证 ---');

// ===== A. 播放中：TA 预订下一首 → 待播队列显示被预订的歌 =====
const wavLong = makeWavDataUrl(40, 8000); // 40s，判定窗口内不会自然结束
// 注意：seedSongs 需要 window.activeStore/idbSet 已存在（页面加载后），
// 因此先 openMusic 加载页面 → 种子写库 → 再 openMusic 重载让 bootMusic→loadAll 读到种子库
await openMusic('lib');
await seedSongs(
  [
    { id: 'mrq_a', name: '正在播的歌', dur: 40, wav: wavLong },
    { id: 'mrq_b', name: '被预订的歌', dur: 40, wav: wavLong }
  ],
  { taReserveProb: 100, reqProb: 0, cooldownMs: 0, taNextProb: 0, taRandProb: 0, taModeProb: 0, taFavProb: 0 }
);
await openMusic('lib'); // 重载：bootMusic→loadAll 读取种子库
const playing = await clickAndPlay('mrq_a');
check('A1 点击歌曲开始播放', !!playing, 'pb=' + await pbName());

// 直接调用真实入口触发预订（reqProb=0 → 不弹「一起听」；taReserveProb=100 → 必预订）
await evalJs("(function(){try{window.maybeMusicRequest();}catch(e){}return true;})()");
await sleep(800);

// 系统消息：聊天记录里应出现「预订了下一首要听的歌」（chatAddSystem → addRec → chat-msgs）
const sysHit = await evalJs("(function(){try{var raw=window.activeStore().get('chat-msgs')||'[]';var arr=JSON.parse(raw);if(!Array.isArray(arr))return false;return arr.some(function(m){return /预订了下一首要听的歌/.test((m&&m.text)||'');});}catch(e){return false;}})()");
check('A2 聊天出现「预订了下一首要听的歌」系统消息', !!sysHit, 'stored=' + (await evalJs("(function(){try{var raw=window.activeStore().get('chat-msgs')||'[]';var arr=JSON.parse(raw);return (arr||[]).filter(function(m){return /预订|一起听/.test((m&&m.text)||'');}).map(function(m){return m.text;}).join(' | ');}catch(e){return '';}})()") || ''));

const dump1 = await openQueuePanelDump();
const queueHasB = dump1.queueNames.indexOf('被预订的歌') >= 0;
const queueHasA = dump1.queueNames.indexOf('正在播的歌') >= 0;
check('A3 【待播队列】显示了被预订的《被预订的歌》', queueHasB, JSON.stringify(dump1.queueNames));
check('A4 待播队列不含正在播的《正在播的歌》', !queueHasA, JSON.stringify(dump1.queueNames));
check('A5 面板同时显示「当前播放列表」', dump1.body.indexOf('当前播放列表') >= 0, dump1.body.slice(0, 60));

// ===== B. 再订一首：队列里已有 1 首时再次预订 → 排进第二首 =====
// 先清掉本次会话的冷却标记：cooldownMs=0 已保证不冷却，直接再触发一次
await evalJs("(function(){try{window.maybeMusicRequest();}catch(e){}return true;})()");
await sleep(800);
const dump2 = await openQueuePanelDump();
const secondHit = dump2.queueNames.filter(n => n !== '正在播的歌').length >= 1;
check('B1 再次预订仍会显示在待播队列', secondHit, JSON.stringify(dump2.queueNames));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

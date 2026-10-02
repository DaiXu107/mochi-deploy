// ===== 听歌记录封面验证：冗余 cover 优先、trackId 回查、无封面回退图标 =====
// 用法：node tools/verify-music-history-cover.mjs（需先 node build.mjs）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-hc-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
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

// 打开页面 + 进音乐页「梦角邀请听歌记录」tab
async function openHisTab() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(700);
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-music');});var t=document.querySelector('#page-music .fav-tab[data-mtab=\"his\"]');if(t)t.click();return true;})()");
  await sleep(500);
}

// 读页面当前音乐库（JSON 字符串 → 数组）
const libArr = () => evalJs("(function(){try{return JSON.parse(window.activeStore().get('music-library')||'null')||[];}catch(e){return[];}})()") || [];
// 读听歌记录列表的图标状态
const hisIcoState = () => evalJs("Array.from(document.querySelectorAll('#music-his-list .sm-his')).map(function(r){var i=r.querySelector('.sm-his-ico');return {cov:i.classList.contains('has-cov'), bg:i.style.backgroundImage||'', name:r.querySelector('.sm-his-name').textContent};})") || [];

// 场景：注入 1 首带封面的歌 + 5 类记录后 reload 验证
console.log('--- 听歌记录封面验证 ---');
await openHisTab();
// 前置：注入一首带封面的歌（种子歌已移除，不依赖内置数据）
const covSong = { id: 'cov_track_1', name: '封面测试歌', artist: '测试', cover: 'https://example.com/cover.jpg', url: '', source: 'local', duration: 0, playlistId: 'default', addedAt: Date.now() };
await evalJs("(function(){window.activeStore().set('music-library', JSON.stringify([" + JSON.stringify(covSong) + "]));return true;})()");
await sleep(300);
await openHisTab(); // reload 载入前置歌曲
const lib = await libArr();
const seedWithCov = lib.find((m) => m.cover) || null;
check('前置：库里存在有封面的歌', !!seedWithCov, seedWithCov ? seedWithCov.name : 'none');

const now = Date.now();
const recs = [
  { id: 'smh_a', trackId: seedWithCov ? seedWithCov.id : '', trackName: seedWithCov ? seedWithCov.name : 'A歌', triggerType: 'TA 邀请你一起听歌', ts: now - 5000 },           // 无 cover 字段 → 回查
  { id: 'smh_b', trackId: '', trackName: '', triggerType: '拒绝了 TA 的听歌邀请《某歌》', rejected: true, ts: now - 4000 },      // 无 trackId → 音符图标
  { id: 'smh_c', trackId: 'deleted_track_xyz', trackName: '已删除的歌', triggerType: 'TA 邀请你一起听歌', ts: now - 3000 },      // trackId 找不到 → 音符图标
  { id: 'smh_d', trackId: 'xxx', trackName: '冗余封面歌', cover: 'data:image/png;base64,iVBORw0KGgo=', triggerType: 'TA 邀请你一起听歌', ts: now - 2000 }, // 冗余 cover 优先
  { id: 'smh_e', trackId: '', trackName: '', triggerType: 'TA 把播放模式换成随机播放', mode: true, ts: now - 1000 }               // mode 记录 → 模式图标
];
await evalJs("(function(){window.activeStore().set('music-history', JSON.stringify(" + JSON.stringify(recs) + "));return true;})()");
await sleep(300);
await openHisTab(); // reload + 进 his tab

const states = await hisIcoState();
check('记录按时间倒序渲染 5 条', states.length === 5, 'rows=' + states.length);
const st = (i) => states[i] || {};
// 倒序：0=最新(mode e) 1=冗余封面d 2=找不到c 3=拒绝b 4=回查a
check('H1 回查路径：库中有封面的歌显示封面', st(4).cov === true, 'bg=' + (st(4).bg || '').slice(0, 40));
check('H2 无 trackId（拒绝记录）保留音符图标', st(3).cov === false, 'name=' + st(3).name);
check('H3 trackId 找不到保留音符图标', st(2).cov === false, 'name=' + st(2).name);
check('H4 冗余 cover 优先显示', st(1).cov === true && st(1).bg.indexOf('data:image/png') > 0, 'bg=' + (st(1).bg || '').slice(0, 40));
check('H5 mode 记录保留模式图标', st(0).cov === false, 'name=' + st(0).name);
check('H6 封面记录的歌名正确', st(4).name === (seedWithCov ? seedWithCov.name : 'A歌'), st(4).name);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

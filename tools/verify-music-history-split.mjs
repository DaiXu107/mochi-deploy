// ===== 听歌记录分离验证：我的听歌 / TA 邀请听歌 分开记，旧数据自动迁移 =====
// 用法：node tools/verify-music-history-split.mjs（需先 node build.mjs）
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
  '/usr/bin/google-chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser'
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-hs-' + Date.now()),
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
const lsGet = (k) => evalJs("(function(){try{return window.activeStore().get('" + k + "');}catch(e){return null;}})()");
const hisRows = () => evalJs("Array.from(document.querySelectorAll('#music-his-list .sm-his')).map(function(r){return {name:r.querySelector('.sm-his-name').textContent, sub:r.querySelector('.sm-his-sub').textContent};})") || [];
const subTabs = () => evalJs("Array.from(document.querySelectorAll('#music-his-list .sm-his-subtab')).map(function(b){return {label:b.textContent, sel:b.classList.contains('sel')};})") || [];
const clickSub = (label) => evalJs("(function(){var b=Array.from(document.querySelectorAll('#music-his-list .sm-his-subtab')).find(function(x){return x.textContent==='" + label + "';});if(b){b.click();return true;}return false;})()");

console.log('--- 听歌记录分离验证（我的 / TA 邀请 分开 + 旧数据迁移） ---');

// 场景 1：旧版本残留——music-history 里混了 3 条我的点歌(triggerType='') + 2 条 TA 邀请
// 期望：loadAll 后我的 3 条迁到 music-my-history，music-history 只剩 2 条 TA 邀请
await openHisTab();
const now = Date.now();
const oldMixed = [
  { id: 'smh_old1', trackId: 't1', trackName: '我点的歌A', triggerType: '', ts: now - 5000 },              // 我的（旧残留）
  { id: 'smh_old2', trackId: 't2', trackName: 'TA邀请接受的歌', triggerType: '接受了 TA 的听歌邀请', ts: now - 4000 }, // TA 邀请
  { id: 'smh_old3', trackId: 't3', trackName: '我点的歌B', triggerType: '', ts: now - 3000 },              // 我的（旧残留）
  { id: 'smh_old4', trackId: '', trackName: '', triggerType: '拒绝了 TA 的听歌邀请《某歌》', rejected: true, ts: now - 2000 }, // TA 邀请(拒绝)
  { id: 'smh_old5', trackId: '', trackName: '', triggerType: 'TA 把播放模式换成随机播放', mode: true, ts: now - 1000 }  // TA 邀请(模式)
];
await evalJs("(function(){window.activeStore().set('music-history', JSON.stringify(" + JSON.stringify(oldMixed) + "));window.activeStore().remove('music-my-history');return true;})()");
await sleep(300);
await openHisTab(); // 触发 loadAll 迁移

const taHist = await lsGet('music-history');
const myHist = await lsGet('music-my-history');
const taArr = taHist ? JSON.parse(taHist) : [];
const myArr = myHist ? JSON.parse(myHist) : [];
check('S1 旧数据迁移：music-history 只剩 TA 邀请记录（3 条）', taArr.length === 3, 'len=' + taArr.length);
check('S1 旧数据迁移：music-my-history 收到我的点歌（2 条）', myArr.length === 2, 'len=' + myArr.length);
check('S1 迁移后 music-history 不再含 triggerType==="" 的记录', taArr.every(h => h.triggerType || h.mode || h.rejected), 'leftover=' + taArr.filter(h => !h.triggerType && !h.mode && !h.rejected).length);
check('S1 迁移后 music-my-history 含原我的点歌名', myArr.some(h => h.trackName === '我点的歌A') && myArr.some(h => h.trackName === '我点的歌B'), 'names=' + myArr.map(h => h.trackName).join(','));

// 场景 2：UI 二级子 tab 存在 + 默认 ta
const subs = await subTabs();
check('S2 二级子 tab 渲染 2 个', subs.length === 2, 'n=' + subs.length);
check('S2 子 tab 文案：我的听歌 / TA 邀请听歌', subs.some(s => s.label === '我的听歌') && subs.some(s => s.label === 'TA 邀请听歌'), 'labels=' + subs.map(s => s.label).join(','));
check('S2 默认选中 TA 邀请听歌子 tab', subs.find(s => s.label === 'TA 邀请听歌') && subs.find(s => s.label === 'TA 邀请听歌').sel === true, 'sel=' + subs.map(s => s.label + (s.sel ? '✓' : '')).join(','));

// 场景 3：默认 ta 子 tab 只显示 TA 邀请记录（3 条），不含我的点歌
let rows = await hisRows();
check('S3 TA 邀请子 tab 显示 3 条 TA 邀请记录', rows.length === 3, 'rows=' + rows.length);
check('S3 TA 邀请子 tab 不含"我点的歌A"', !rows.some(r => r.name === '我点的歌A'), 'names=' + rows.map(r => r.name).join(','));

// 场景 4：切到"我的听歌"子 tab 显示我的点歌（2 条）
await clickSub('我的听歌');
await sleep(300);
rows = await hisRows();
check('S4 我的听歌子 tab 显示 2 条我的点歌', rows.length === 2, 'rows=' + rows.length);
check('S4 我的听歌子 tab 含"我点的歌A"和"我点的歌B"', rows.some(r => r.name === '我点的歌A') && rows.some(r => r.name === '我点的歌B'), 'names=' + rows.map(r => r.name).join(','));

// 场景 5：切回 TA 邀请子 tab，再次确认互不混杂
await clickSub('TA 邀请听歌');
await sleep(300);
rows = await hisRows();
check('S5 切回 TA 邀请子 tab 仍显示 3 条 TA 邀请记录', rows.length === 3, 'rows=' + rows.length);

// 场景 6：迁移幂等——再 reload 一次，music-my-history 不会重复收同一批
await openHisTab();
const myHist2 = await lsGet('music-my-history');
const myArr2 = myHist2 ? JSON.parse(myHist2) : [];
check('S6 迁移幂等：reload 后 music-my-history 仍 2 条（不重复）', myArr2.length === 2, 'len=' + myArr2.length);
const ids = new Set(myArr2.map(h => h.id));
check('S6 迁移幂等：id 无重复', myArr2.length === ids.size, 'unique=' + ids.size);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
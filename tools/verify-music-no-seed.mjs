// ===== 移除默认种子歌验证：全新数据不补种、旧种子歌升级即删、不再复活 =====
// 用法：node tools/verify-music-no-seed.mjs（需先 node build.mjs）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ns-' + Date.now()),
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

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
}
const libArr = () => evalJs("(function(){try{return JSON.parse(window.activeStore().get('music-library')||'null')||[];}catch(e){return[];}})()") || [];
const seedCount = async () => (await libArr()).filter((m) => m && m.id && m.id.indexOf('sm_seed_') === 0).length;

// 场景 A：全新数据 → 不再自动补种子歌
console.log('--- 场景 A：全新数据不补种 ---');
await openPage();
const libA = await libArr();
check('A1 全新数据音乐库为空（不再自动放默认歌曲）', libA.length === 0, 'len=' + libA.length);
const chipsA = await evalJs("Array.from(document.querySelectorAll('#music-lib-filter .mlf-chip')).map(function(c){return c.textContent.trim();})") || [];
check('A2 筛选条正确显示空库（全部音乐 0 首）', chipsA.length > 0 && chipsA[0].indexOf('全部音乐0') === 0, JSON.stringify(chipsA));

// 场景 B：旧数据含种子歌 → 升级自动删除 + 不再复活
console.log('--- 场景 B：旧种子歌升级即删 ---');
const old = [
  { id: 'sm_seed_123_0', neteaseId: '2613048732', name: 'Moonlit Dream', artist: 'DLSS · shell（月光梦）', cover: 'https://x/y.jpg', url: 'https://example.com/1.mp3', source: 'url', duration: 0, playlistId: 'spl_default', addedAt: Date.now() - 100000 },
  { id: 'sm_seed_123_1_h', neteaseId: '27538343', name: 'Baby', artist: 'EXO-K', cover: '', url: 'https://example.com/2.mp3', source: 'url', duration: 0, playlistId: 'spl_default', addedAt: Date.now() - 100000 },
  { id: 'user_track_1', neteaseId: '999999', name: '我的歌', artist: '用户', cover: '', url: 'https://example.com/3.mp3', source: 'url', duration: 0, playlistId: 'default', addedAt: Date.now() - 100000 }
];
await evalJs("(function(){window.activeStore().set('music-library', JSON.stringify(" + JSON.stringify(old) + "));return true;})()");
await sleep(200);
await openPage(); // reload → loadAll 迁移删除种子歌
const libB = await libArr();
check('B1 旧种子歌全部删除', await seedCount() === 0, 'seed=' + await seedCount());
check('B2 用户自己的歌保留', libB.length === 1 && libB[0].id === 'user_track_1', 'len=' + libB.length + ' id=' + (libB[0] && libB[0].id));
await openPage(); // 再 reload → 确认不复活
const libC = await libArr();
check('B3 再次刷新种子歌不复活', libC.length === 1 && await seedCount() === 0, 'len=' + libC.length + ' seed=' + await seedCount());

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

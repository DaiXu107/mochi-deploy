// ===== 音乐库分类筛选验证：全部音乐 / 未分类音乐（无歌隐藏）/ 歌单 chips =====
// 用法：node tools/verify-music-filter.mjs（需先 node build.mjs）
// 场景A（全新数据）：未分类 0 首 → 「未分类音乐」chip 不显示；列表=全部歌曲
// 场景B（注入未分类歌后 reload）：未分类 chip 出现；点击筛选列表正确
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
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mf-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
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
  await sleep(600); // 等 loadAll 种子/补种完成
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(700);
  // 打开音乐页（我的音乐库 tab）
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-music');});var t=document.querySelector('#page-music .fav-tab[data-mtab=\"lib\"]');if(t)t.click();return true;})()");
  await sleep(500);
}

async function chipsInfo() {
  const txt = await evalJs("Array.from(document.querySelectorAll('#music-lib-filter .mlf-chip')).map(function(c){return c.textContent.trim();})") || [];
  const sel = await evalJs("(function(){var s=document.querySelector('#music-lib-filter .mlf-chip.sel');return s?s.dataset.mlf:null;})()");
  return { txt, sel };
}
const listCount = () => evalJs("document.querySelectorAll('#music-lib-list .sm-song').length") || 0;
const emptyVisible = () => evalJs("(function(){var e=document.getElementById('music-lib-empty');return e?!e.hidden:false;})()") || false;
// music-library 是大键（只进 IDB + 内存缓存），store.get 返回 JSON 字符串，需先 parse
const libArr = () => evalJs("(function(){try{return JSON.parse(window.activeStore().get('music-library')||'null');}catch(e){return null;}})()");
const libArrLen = async () => (await libArr() || []).length;
const plArrLen = async (pid) => (await libArr() || []).filter((m) => m.playlistId === pid).length;

// ---------- 场景 A：全新数据（种子歌已移除，音乐库为空，未分类 0 首） ----------
console.log('--- 场景 A：全新数据，空库 ---');
await openPage();

const hasFilter = await evalJs("(function(){var w=document.getElementById('music-lib-filter');return !!w;})()");
check('A1 筛选条存在', hasFilter === true);
const filterHidden = await evalJs("(function(){var w=document.getElementById('music-lib-filter');return !!w&&w.hidden;})()");
check('A1b 空库时筛选条隐藏', filterHidden === true);
const libCountA = await libArrLen();
const rowsA = await listCount();
const chipsA = await chipsInfo();
check('A2 列表行数 = 全部歌曲数', rowsA === libCountA, 'rows=' + rowsA + ' lib=' + libCountA);
check('A3 「全部音乐」chip 存在', chipsA.txt.some((t) => t.indexOf('全部音乐') === 0), JSON.stringify(chipsA.txt));
check('A4 未分类 0 首 → 「未分类音乐」chip 不显示', !chipsA.txt.some((t) => t.indexOf('未分类音乐') === 0), JSON.stringify(chipsA.txt));
check('A5 默认选中「全部音乐」', chipsA.sel === 'all', chipsA.sel);
check('A6 歌单 chip 存在（默认歌单）', chipsA.txt.some((t) => t.indexOf('默认歌单') === 0), JSON.stringify(chipsA.txt));

// 点默认歌单 chip：行数 = 默认歌单歌曲数
await evalJs("(function(){var c=document.querySelector('#music-lib-filter .mlf-chip[data-mlf=\"spl_default\"]');if(c)c.click();return true;})()");
await sleep(300);
const plCountA = await plArrLen('spl_default');
const rowsPlA = await listCount();
const chipsA2 = await chipsInfo();
check('A7 点歌单 chip → 只显示该歌单歌曲', rowsPlA === plCountA, 'rows=' + rowsPlA + ' pl=' + plCountA);
check('A8 选中态切到歌单', chipsA2.sel === 'spl_default', chipsA2.sel);

// ---------- 场景 B：注入 1 首未分类歌后 reload ----------
console.log('--- 场景 B：注入未分类歌后重载 ---');
await evalJs("(function(){var st=window.activeStore();var lib=JSON.parse(st.get('music-library')||'[]');lib.push({id:'mf_test_un',name:'测试未分类歌',artist:'测试歌手',url:'',source:'local',duration:0,playlistId:'default',addedAt:Date.now()});st.set('music-library',JSON.stringify(lib));return true;})()");
await sleep(300);
await openPage(); // reload + 重新进音乐页

const chipsB = await chipsInfo();
const libCountB = await libArrLen();
const unCountB = await plArrLen('default');
const rowsB = await listCount();
check('B1 有未分类歌 → 「未分类音乐」chip 出现', chipsB.txt.some((t) => t.indexOf('未分类音乐') === 0), JSON.stringify(chipsB.txt));
check('B2 列表行数 = 全部歌曲数', rowsB === libCountB, 'rows=' + rowsB + ' lib=' + libCountB);

await evalJs("(function(){var c=document.querySelector('#music-lib-filter .mlf-chip[data-mlf=\"default\"]');if(c)c.click();return true;})()");
await sleep(300);
const rowsUnB = await listCount();
const emptyB = await emptyVisible();
const firstUn = await evalJs("(function(){var r=document.querySelector('#music-lib-list .sm-song .sm-song-name');return r?r.textContent:null;})()");
check('B3 点「未分类音乐」→ 只显示未分类歌曲', rowsUnB === unCountB && rowsUnB === 1, 'rows=' + rowsUnB + ' un=' + unCountB);
check('B4 未分类列表为空态不显示', emptyB === false);
check('B5 列表内容为注入的歌曲', firstUn === '测试未分类歌', String(firstUn));

await evalJs("(function(){var c=document.querySelector('#music-lib-filter .mlf-chip[data-mlf=\"all\"]');if(c)c.click();return true;})()");
await sleep(300);
const rowsAllB = await listCount();
check('B6 切回「全部音乐」→ 行数恢复全部', rowsAllB === libCountB, 'rows=' + rowsAllB + ' lib=' + libCountB);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

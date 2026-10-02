// ===== 复现脚本：大信件（>200KB）导致「聊天通知在、信箱看不到新信」 =====
// 场景：信件含大图 dataURL → xyStore.set 跳过 localStorage 主键（只进 IDB+内存+快照）
//   → 来信 save 后 LS 主键保持旧值（非空、不含新信）→ load() 读 LS 旧值，新信不可见
//   → 但 notifyMailToChat 已发通知 → 用户看到通知、信箱看不到信
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-bigmail-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 构造：LS 主键先有一封旧信（非空），然后模拟一封含大图(>200KB)的新信写入 ----
const setup = JSON.parse(await evalJs(`(function(){
  try {
    const KEY = 'mail-letters';
    // 1) 旧信写入 LS 主键（正常小信，会进 LS）
    const oldLetter = { id: 'l_old_1', type: 'received', tt: '旧信', content: '这是旧信', tm: 1000000 };
    window.storeFor('default').set(KEY, JSON.stringify([oldLetter]));
    const lsBefore = localStorage.getItem('xy-home-v2:default:' + KEY);
    // 2) 构造 >200KB 的大图 dataURL
    const bigImg = 'data:image/png;base64,' + 'A'.repeat(220 * 1024);
    // 3) 模拟 maybeIncomingLetterFor：load → unshift 新信(含大图) → save
    let list = [];
    try { list = JSON.parse(window.storeFor('default').get(KEY) || '[]'); } catch(e) {}
    if (!Array.isArray(list)) list = [];
    list.unshift({ id: 'l_big_1', type: 'received', tt: '大图来信', content: 'sticker:' + bigImg, tm: Date.now() });
    window.storeFor('default').set(KEY, JSON.stringify(list)); // save(list, cid) 同款
    // 4) 检查 LS 主键是否被跳过（保持旧值）
    const lsAfter = localStorage.getItem('xy-home-v2:default:' + KEY);
    return JSON.stringify({
      lsBeforeLen: (lsBefore||'').length,
      lsAfterLen: (lsAfter||'').length,
      lsHasOld: (lsAfter||'').indexOf('l_old_1') >= 0,
      lsHasBig: (lsAfter||'').indexOf('l_big_1') >= 0,
      // 快照里有没有新信
      snap: localStorage.getItem('xy-home-v2:default:mail-letters-snap'),
      snapHasBig: (localStorage.getItem('xy-home-v2:default:mail-letters-snap')||'').indexOf('l_big_1') >= 0,
      // 内存缓存里有没有新信（xyStore 无条件写 memoryCache）
      memHasBig: JSON.stringify(window.activeStore().get(KEY)).indexOf('l_big_1') >= 0
    });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [构造大信]', JSON.stringify(setup));

// ---- 关键：信箱 load()（activeStore 视角）能否看到新信 ----
const read = JSON.parse(await evalJs(`(function(){
  try {
    const KEY = 'mail-letters';
    const raw = window.activeStore().get(KEY);
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch(e) {}
    return JSON.stringify({
      rawLen: (raw||'').length,
      ids: list.map(l => l.id),
      hasOld: list.some(l => l.id === 'l_old_1'),
      hasBig: list.some(l => l.id === 'l_big_1')
    });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [信箱 load() 读到]', JSON.stringify(read));
check('大信写入后 LS 主键被跳过（保持旧值）', setup.lsHasBig === false, JSON.stringify(setup));
check('快照含新信（兜底数据在）', setup.snapHasBig === true, JSON.stringify(setup));
check('信箱 load() 看不到新信（主键旧值遮蔽）', read.hasBig === false, JSON.stringify(read));
check('信箱 load() 只显示旧信', read.hasOld === true && read.hasBig === false, JSON.stringify(read));

// ---- 用户视角：打开信箱页 ----
const ui = JSON.parse(await evalJs(`(function(){
  try {
    if (window.openMailPage) window.openMailPage();
    const items = Array.from(document.querySelectorAll('#mail-in-list .mail-item')).map(it => it.textContent.slice(0, 30));
    return JSON.stringify({ items: items });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [信箱页]', JSON.stringify(ui));
check('信箱页看不到大图来信', !JSON.stringify(ui.items).includes('大图来信'), JSON.stringify(ui));

const failed = results.filter(r => !r.ok);
console.log('\n===== 复现结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);

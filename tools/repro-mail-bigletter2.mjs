// ===== 复现脚本：真实 save() 路径 + 大信件 + 跨会话 → 信箱空但聊天通知在 =====
// 模拟 mail.js save(list, cid) 完整路径：
//   1. csFor(cid).set(KEY, JSON.stringify(list)) —— 大键跳过 LS 主键（removeItem）
//   2. writeSnap —— 剥图快照若仍 >200KB 则不写 LS
// 然后重开页面（memoryCache 清空）→ load() 只能读 LS 主键(空)/快照(无)/IDB
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

const userDataDir = join(process.env.TEMP || '/tmp', 'mochi-bigmail2-' + Date.now());
const cdpPort = 9900 + Math.floor(Math.random() * 90);
function launch() {
  return spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + userDataDir,
    '--remote-debugging-port=' + cdpPort, 'about:blank'
  ], { stdio: 'ignore' });
}
let chrome = launch();

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

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

async function boot() {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
}

// ===== 会话 1：走 mail.js 真实 save() 路径写入大信件 =====
await boot();
const s1 = JSON.parse(await evalJs(`(function(){
  try {
    const KEY = 'mail-letters';
    // 旧信（正常小信）
    const oldLetter = { id: 'l_old_1', type: 'received', tt: '旧信', content: '这是旧信', tm: 1000000 };
    window.storeFor('default').set(KEY, JSON.stringify([oldLetter]));
    // 来信走真实 save 路径：先读 list，unshift 新信，再 csFor.set + writeSnap
    const bigImg = 'data:image/png;base64,' + 'A'.repeat(250 * 1024); // 250KB 单图
    // 多封大图信，剥图后快照仍超 200KB
    let list = [];
    try { list = JSON.parse(window.storeFor('default').get(KEY) || '[]'); } catch(e) {}
    if (!Array.isArray(list)) list = [];
    for (let i = 0; i < 4; i++) {
      list.unshift({ id: 'l_big_' + i, type: 'received', tt: '大图来信' + i, content: 'sticker:' + bigImg, tm: Date.now() + i });
    }
    // save(list, 'default') 真实路径：csFor(cid).set + writeSnap
    window.storeFor('default').set(KEY, JSON.stringify(list)); // 大键 → LS 跳过
    // writeSnap（模拟 mail.js 内部函数）
    const strip = (l) => { const c = Object.assign({}, l); c.content = String(c.content).replace(/data:image\\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[图片]'); return c; };
    const snap = JSON.stringify(list.map(strip));
    if (snap.length <= 200 * 1024) localStorage.setItem('xy-home-v2:default:mail-letters-snap', snap);
    else localStorage.removeItem('xy-home-v2:default:mail-letters-snap');
    return JSON.stringify({
      lsMail: localStorage.getItem('xy-home-v2:default:' + KEY),          // 应 null（大键删除）
      snapLen: snap.length,
      snapWrote: snap.length <= 200 * 1024,
      snap: localStorage.getItem('xy-home-v2:default:mail-letters-snap')
    });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [会话1 写入]', JSON.stringify(s1).slice(0, 400));
check('大信件主键跳过 LS（被删）', s1.lsMail === null, 'lsMail=' + String(s1.lsMail).slice(0, 30));
check('剥图快照超 200KB 未写 LS', s1.snapWrote === false, 'snapLen=' + s1.snapLen);

// ===== 会话 2：重开（同 user-data-dir）→ 检查信箱能否读到 =====
chrome.kill();
await sleep(800);
chrome = launch();
ws = null;
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

// 立即看信箱（不等 IDB 合并完成，模拟用户刚打开就看到空）
const s2early = JSON.parse(await evalJs(`(function(){
  try {
    const raw = window.activeStore().get('mail-letters');
    return JSON.stringify({ raw: raw, len: (raw||'').length });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [会话2 刚启动(未等IDB)]', JSON.stringify(s2early).slice(0, 200));
check('重开后信箱 load() 空（LS主键删+快照无）', !s2early.raw || s2early.raw === '[]' || s2early.len === 0, JSON.stringify(s2early));

// 等 IDB 合并完成（mailMergeFromIdb 会写回）
await sleep(4000);
const s2after = JSON.parse(await evalJs(`(function(){
  try {
    const raw = window.activeStore().get('mail-letters');
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch(e) {}
    if (window.openMailPage) window.openMailPage();
    const items = Array.from(document.querySelectorAll('#mail-in-list .mail-item')).length;
    return JSON.stringify({ len: (raw||'').length, ids: list.map(l=>l.id), items: items });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [会话2 等IDB后]', JSON.stringify(s2after).slice(0, 300));

const failed = results.filter(r => !r.ok);
console.log('\n===== 复现结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(failed.length ? 1 : 0);

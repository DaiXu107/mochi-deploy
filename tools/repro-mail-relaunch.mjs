// ===== 复现脚本：重开后「聊天通知还在但信箱空」 =====
// 场景：会话1 来信落盘 + 聊天通知 → 关闭页面（数据留在 LS/IDB）→ 会话2 重开
//   聊天记录从 LS 快照读回（通知还在），信箱从启动 IDB 合并读回 → 检查信是否可见
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

const userDataDir = join(process.env.TEMP || '/tmp', 'mochi-relaunch-' + Date.now());
const cdpPort = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + userDataDir,
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

// ===== 会话 1：触发来信 + 聊天通知 =====
await boot();
const seedOk = await evalJs(`(function(){
  try {
    const s = window.activeStore();
    s.set('reply-ml-write-prob', '100');
    s.set('reply-ml-write-min', '0');
    s.set('reply-ml-write-max', '0');
    s.set('reply-ml-write-daily-max', '50');
    s.set('mail-letter-last', '0');
    s.set('mail-letter-next', '0');
    const d = new Date();
    const today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    s.set('mail-letter-day', JSON.stringify({ d: today, n: 0 }));
    return true;
  } catch(e) { return 'err: ' + e.message; }
})()`);
check('会话1 种子来信配置', seedOk === true, String(seedOk));
await evalJs("(function(){document.dispatchEvent(new Event('visibilitychange'));return true;})()");
await sleep(1500);
const s1 = JSON.parse(await evalJs(`(function(){
  const out = {};
  try { out.mail = JSON.parse(window.activeStore().get('mail-letters') || '[]').map(l => l.id); } catch(e) { out.mail = 'err'; }
  try { out.chat = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]').filter(m => m && m.mailNotice).length; } catch(e) { out.chat = 'err'; }
  try { out.idb = null; window.idbGet('xy-home-v2:default:mail-letters').then(v => { window.__probeIdbMail = v; }); } catch(e) {}
  return JSON.stringify(out);
})()`) || '{}');
console.log('  [会话1]', JSON.stringify(s1));
check('会话1 信箱有来信', (s1.mail || []).length > 0, JSON.stringify(s1.mail));
check('会话1 聊天有通知', s1.chat > 0, 'chat=' + s1.chat);

// 等 IDB 写入完成
await sleep(1200);
const idbMail = await evalJs('window.__probeIdbMail ? "len=" + window.__probeIdbMail.length : null');
console.log('  [会话1 IDB 信件]', idbMail);

// ===== 会话 2：重开页面（同一 user-data-dir，模拟重开 App） =====
chrome.kill();
await sleep(800);
const chrome2 = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + userDataDir,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
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

// 等待 mail 权威合并完成
await sleep(2500);
const s2 = JSON.parse(await evalJs(`(function(){
  const out = {};
  try { out.mail = JSON.parse(window.activeStore().get('mail-letters') || '[]').map(l => l.id); } catch(e) { out.mail = 'err'; }
  try { out.chat = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]').filter(m => m && m.mailNotice).map(m => (m.text||'').replace(/<[^>]+>/g,'').slice(0,15)); } catch(e) { out.chat = 'err'; }
  try { if (window.openMailPage) window.openMailPage(); } catch(e) {}
  out.mailPageItems = Array.from(document.querySelectorAll('#mail-in-list .mail-item')).length;
  return JSON.stringify(out);
})()`) || '{}');
console.log('  [会话2 重开后]', JSON.stringify(s2));
check('会话2 聊天通知仍在（持久化）', (s2.chat || []).length > 0, JSON.stringify(s2.chat));
check('会话2 信箱仍能读到来信', (s2.mail || []).length > 0, JSON.stringify(s2.mail));
check('会话2 信箱页显示来信', s2.mailPageItems > 0, 'items=' + s2.mailPageItems);
check('重开后 通知↔信箱 一致', (s2.chat || []).length > 0 ? (s2.mail || []).length > 0 : true, JSON.stringify(s2));

const failed = results.filter(r => !r.ok);
console.log('\n===== 复现结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
try { chrome2.kill(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(failed.length ? 1 : 0);

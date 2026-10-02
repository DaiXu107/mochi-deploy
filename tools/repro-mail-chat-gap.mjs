// ===== 复现脚本：聊天显示「给你寄来了一封信」但信箱列表为空（完整来信链路） =====
// 用法：node tools/repro-mail-chat-gap.mjs
// 复现路径：真实触发 maybeIncomingLetterFor（来信）→ 检查 聊天系统消息 与 信箱列表 是否一致。
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-repro-gap-' + Date.now()),
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

// ---- 种子：来信概率拉满 + 清掉间隔/每日上限，确保触发 ----
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
  } catch(e) { return 'seed err: ' + e.message; }
})()`);
check('种子：来信配置拉满', seedOk === true, String(seedOk));
if (seedOk !== true) process.exit(1);

// ---- 触发来信（visibilitychange 补查 → maybeIncomingLetter 全量遍历） ----
await evalJs("(function(){document.dispatchEvent(new Event('visibilitychange'));return true;})()");
await sleep(1500);

// ---- 收集来信后状态 ----
const state = JSON.parse(await evalJs(`(function(){
  const out = {};
  try {
    // 1) 信箱数据（activeStore 视角，即用户打开信箱看到的）
    const raw = window.activeStore().get('mail-letters');
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch(e) {}
    out.mailList = list.map(l => ({ id: l.id, type: l.type, tt: l.tt, c: (l.content||'').slice(0, 20) }));
    // 2) storeFor('default') 视角（来信写入键）
    const raw2 = window.storeFor('default').get('mail-letters');
    out.storeForRaw = raw2 === null ? null : (raw2.length + ' chars');
    // 3) 聊天系统消息（mailNotice）
    const msgs = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]');
    out.chatNotices = msgs.filter(m => m && m.mailNotice).map(m => (m.text||'').replace(/<[^>]+>/g,'').slice(0, 30));
    // 4) 桌面弹窗 / 角标
    out.badge = (function(){ const b = document.getElementById('mail-badge'); return b ? (b.hidden ? 0 : b.textContent) : 'no-el'; })();
    // 5) 来信写到了哪些键
    out.lsKeys = Object.keys(localStorage).filter(k => k.indexOf('mail-letter') >= 0);
  } catch(e) { out.err = String(e); }
  return JSON.stringify(out);
})()`) || '{}');
console.log('  [来信后状态]', JSON.stringify(state, null, 1));

const hasLetter = state.mailList && state.mailList.length > 0;
const hasChatNotice = state.chatNotices && state.chatNotices.length > 0;
check('信箱里有来信（activeStore 读到）', hasLetter, JSON.stringify(state.mailList || []));
check('聊天里有来信通知', hasChatNotice, JSON.stringify(state.chatNotices || []));
check('「聊天有通知 ⇒ 信箱有信」一致', !hasChatNotice || hasLetter, 'chat=' + (state.chatNotices||[]).length + ' mail=' + (state.mailList||[]).length);

// ---- 打开信箱页，验证列表渲染 ----
const ui = JSON.parse(await evalJs(`(function(){
  try {
    if (window.openMailPage) window.openMailPage();
    const items = Array.from(document.querySelectorAll('#mail-in-list .mail-item')).map(it => it.textContent);
    return JSON.stringify({ items: items.length, text: items });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [信箱页列表]', JSON.stringify(ui));
check('信箱页「收到的信」有内容', ui.items > 0, JSON.stringify(ui));

const failed = results.filter(r => !r.ok);
console.log('\n===== 复现结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);

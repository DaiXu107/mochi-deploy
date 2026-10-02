// ===== TA 引用目标验证 =====
// 背景：连发多条消息（句1/句2/句3）会排多个回复轮，旧实现执行时才读 lastMineText，
// 导致引用永远指向最后一句，且多轮都命中 quote-prob 会连续引用同一条（引用两次句3）。
// 修复：① 引用源在调度时快照（每轮引用触发它的那条消息）；
//       ② lastQuotedText 记录上次实际引用文本，同内容不连续引用。
// 用法：node tools/verify-quote-target.mjs（需先 node build.mjs）
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-qt-' + Date.now()),
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
async function gotoChat() {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return true;})()");
  await sleep(600);
}
// 收口回复参数：引用必中、回复快、单条、无干扰随机路径（键带 reply- 前缀）
const CFG = {
  'reply-quote-prob': 100, 'reply-rs-min': 0.3, 'reply-rs-max': 0.6,
  'reply-reply-min': 1, 'reply-reply-max': 1,
  'reply-rn-prob': 0, 'reply-touch-prob': 0, 'reply-rc-prob': 0,
  'reply-sticker-prob': 0, 'reply-emoji-prob': 0, 'reply-image-prob': 0, 'reply-voice-prob': 0,
  'reply-kaomoji-prob': 0, 'reply-cf-prob': 0, 'reply-py-prob': 0, 'reply-as-en': 0
};
async function applyCfg() {
  const kvs = JSON.stringify(CFG);
  return await evalJs("(function(){var o=" + kvs + ";Object.keys(o).forEach(function(k){window.activeStore().set(k, String(o[k]));});return true;})()");
}
// 通过输入框发送一条消息（contenteditable 路径）
async function sendMsg(text) {
  await evalJs(`(function(){
    const inp = document.getElementById('chat-input');
    if (!inp) return false;
    inp.textContent = ${JSON.stringify(text)};
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  await sleep(120);
  await evalJs("document.getElementById('chat-send').click()");
}
// 读取 TA 消息的引用文本（只取 .msg-in，按 DOM 顺序）
async function taQuotes() {
  const raw = await evalJs(`(function(){
    const items = Array.from(document.querySelectorAll('.msg'));
    const out = [];
    items.forEach(function(el){
      if (!el.classList.contains('msg-in')) return;
      const q = el.querySelector('.msg-quote');
      if (!q) return;
      const t = q.querySelector('.msg-quote-text');
      out.push(t ? t.textContent : '[img]');
    });
    return JSON.stringify(out);
  })()`);
  try { return JSON.parse(raw); } catch (e) { return []; }
}

// ---- 场景 1：连发句1/句2/句3 → 三个回复轮各引用触发它的那条，无连续重复 ----
console.log('--- 场景 1：连发三条不同消息 ---');
await openPage();
await evalJs("(function(){window.activeStore().set('chat-msgs', '[]');return true;})()");
await sleep(200);
await openPage();
await applyCfg();
await gotoChat();
await sendMsg('句1');
await sendMsg('句2');
await sendMsg('句3');
await sleep(6000);
const q1 = await taQuotes();
const set1 = Array.from(new Set(q1));
check('1-1 TA 三条回复轮都有引用（3 条）', q1.length === 3, JSON.stringify(q1));
check('1-2 引用内容各不相同（无连续重复引用）', set1.length === q1.length, JSON.stringify(q1));
check('1-3 引用集 = {句1,句2,句3}（不再永远只引用最后一句）',
  set1.length === 3 && set1.indexOf('句1') >= 0 && set1.indexOf('句2') >= 0 && set1.indexOf('句3') >= 0, JSON.stringify(set1));

// ---- 场景 2：连发两条相同消息 → 同内容只引用一次 ----
console.log('--- 场景 2：连发两条相同消息 ---');
await openPage();
await evalJs("(function(){window.activeStore().set('chat-msgs', '[]');return true;})()");
await sleep(200);
await openPage();
await applyCfg();
await gotoChat();
await sendMsg('重复句');
await sendMsg('重复句');
await sleep(6000);
const q2 = await taQuotes();
const cntDup = q2.filter((t) => t === '重复句').length;
check('2-1 相同内容不连续引用（重复句只引用一次）', cntDup === 1, JSON.stringify(q2));

// ---- 场景 3：不发消息的纯等待 → TA 不应凭空引用（无引用源） ----
console.log('--- 场景 3：纯等待无引用源 ---');
await openPage();
await evalJs("(function(){window.activeStore().set('chat-msgs', '[]');return true;})()");
await sleep(200);
await openPage();
await applyCfg();
await gotoChat();
await sleep(4000);
const q3 = await taQuotes();
check('3-1 无引用源时不产生引用', q3.length === 0, JSON.stringify(q3));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

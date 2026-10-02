// ===== 回归：聊天设置「隐藏通话小框」开关对已接通通话立即生效 =====
// 复现用户反馈：通话接通后小框已弹出，此时进聊天设置勾选「隐藏通话小框」，
//   小框必须马上收起（旧版 setCallMiniEnabled 只写 key，当前通话小框不消失）。
// 用例：
//   A. 接通 → 2.6s 后小框显示（前提）
//   B. 聊天设置勾选隐藏 → 立即：mini.hidden=true（小框收起，通话仍在）
//   C. 通话状态未被破坏（getCallState 仍 connected，可经通话半框挂断）
//   D. 取消勾选 → 大面板已收起且通话中 → 小框恢复显示
//   E. 关闭隐藏后再次接通 → 2.6s 后自动最小化为小框（原有行为不回归）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
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
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-callmini-live-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await waitReady();
await sleep(1200);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
function snap() {
  return evalJs(`(function(){
    const mini = document.getElementById('call-mini');
    const mask = document.getElementById('call-mask');
    return {
      miniHidden: mini ? mini.hidden : 'NO-EL',
      maskHidden: mask ? mask.hidden : 'NO-EL',
      state: (window.getCallState && window.getCallState()) || null,
      cmhChecked: document.getElementById('cs-call-mini-hide') ? document.getElementById('cs-call-mini-hide').checked : null
    };
  })()`);
}

// ---- A. 接通后小框弹出（前提）----
await evalJs(`window.activeStore().set('call-mini-enabled', '1'); window.triggerIncomingCall(); true;`);
await sleep(600);
await evalJs(`document.getElementById('call-answer-btn').click(); true;`);
await sleep(2600);
let s = await snap();
console.log('== A: 接通 2.6s 后 ==', JSON.stringify(s));
check('A: 通话已接通', s.state && s.state.status === 'connected', s.state ? s.state.status : 'null');
check('A: 大面板已收起', s.maskHidden === true, 'maskHidden=' + s.maskHidden);
check('A: 小框已弹出', s.miniHidden === false, 'miniHidden=' + s.miniHidden);

// ---- B. 打开聊天设置，勾选「隐藏通话小框」→ 小框立即收起 ----
await evalJs(`(function(){
  const btn = document.getElementById('chat-settings-btn');
  if (btn) btn.click();
  return true;
})()`);
await sleep(400);
const beforeToggle = await snap();
await evalJs(`(function(){
  const el = document.getElementById('cs-call-mini-hide');
  if (el) el.closest('label.toggle').click();
  return true;
})()`);
// 不 sleep，立即断言（修复要求当场生效）
s = await snap();
console.log('== B: 勾选隐藏后立即 ==', JSON.stringify(s));
check('B: 勾选后开关 checked=true', s.cmhChecked === true, 'checked=' + s.cmhChecked);
check('B: 小框立即收起（mini.hidden=true）', s.miniHidden === true, 'miniHidden=' + s.miniHidden);
check('B: 通话仍保持接通', s.state && s.state.status === 'connected', s.state ? s.state.status : 'null');

// 等 800ms（跨过 500ms 轮询），确认小框不会又被拨回显示
await sleep(800);
s = await snap();
console.log('== B2: 勾选后 +800ms ==', JSON.stringify(s));
check('B2: 小框保持收起', s.miniHidden === true, 'miniHidden=' + s.miniHidden);
check('B2: 开关状态未被轮询拨回', s.cmhChecked === true, 'checked=' + s.cmhChecked);

// ---- C. 通话半框仍可打开（隐藏小框后的挂断入口）----
await evalJs(`(function(){
  const p = document.getElementById('chat-call-panel');
  const more = document.getElementById('more-call');
  if (more) { more.click(); }
  return true;
})()`);
await sleep(400);
const c = await evalJs(`(function(){
  const p = document.getElementById('chat-call-panel');
  const hang = document.getElementById('call-panel-hang');
  return { panelHidden: p ? p.hidden : 'NO-EL', hangHidden: hang ? hang.hidden : 'NO-BTN' };
})()`);
console.log('== C: 通话半框 ==', JSON.stringify(c));
check('C: 通话半框可打开', c.panelHidden === false, 'panelHidden=' + c.panelHidden);
check('C: 半框显示挂断按钮', c.hangHidden === false, 'hangHidden=' + c.hangHidden);

// ---- D. 取消勾选 → 小框恢复显示（大面板已收起且通话中）----
await evalJs(`(function(){
  document.getElementById('chat-call-panel').hidden = true;
  const el = document.getElementById('cs-call-mini-hide');
  if (el) el.closest('label.toggle').click();
  return true;
})()`);
await sleep(300);
s = await snap();
console.log('== D: 取消勾选后 ==', JSON.stringify(s));
check('D: 开关 checked=false', s.cmhChecked === false, 'checked=' + s.cmhChecked);
check('D: 小框恢复显示', s.miniHidden === false, 'miniHidden=' + s.miniHidden);

// ---- E. 挂断 → 再接通（显示模式下）→ 自动最小化小框（原有行为不回归）----
await evalJs(`window.hangupCall(); true;`);
await sleep(400);
await evalJs(`window.triggerIncomingCall(); true;`);
await sleep(600);
await evalJs(`document.getElementById('call-answer-btn').click(); true;`);
await sleep(2600);
s = await snap();
console.log('== E: 显示模式再接通 ==', JSON.stringify(s));
check('E: 通话已接通', s.state && s.state.status === 'connected', s.state ? s.state.status : 'null');
check('E: 小框自动弹出（显示模式不回归）', s.miniHidden === false, 'miniHidden=' + s.miniHidden);
await evalJs(`window.hangupCall(); true;`);
await sleep(400);

const failed = results.filter(r => !r.ok);
console.log('\n==== 结果：' + results.length + ' 项检查，' + failed.length + ' 项失败 ====');
if (failed.length) { failed.forEach(f => console.log('  FAIL:', f.desc)); process.exitCode = 1; }
else console.log('全部通过');
chrome.kill();
server.close();
process.exit(process.exitCode || 0);

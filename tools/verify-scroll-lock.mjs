// ===== 专项验证：浮层打开时 body 滚动锁（FLOAT_SELECTORS 覆盖检查，390×844 手机视口） =====
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cands = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!cands.length) { console.error('no chrome'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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
const port = 9960 + Math.floor(Math.random() * 30);
const chrome = spawn(cands[0], ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-probe-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const pg = l.find((t) => t.type === 'page');
    if (pg) {
      ws = new WebSocket(pg.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
const cdp = (method, params = {}) => { const i = ++id; return new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
const ev = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JSERR', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
};
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);

const RED = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff2255"/></svg>');

// ① 聊天里塞一条图片消息 → 进聊天页 → 点图片开大图层
await ev(`(function(){
  const s = window.activeStore();
  const arr = JSON.parse(s.get('chat-msgs') || '[]');
  arr.push({ side: 'in', type: 'image', text: ${JSON.stringify(RED)}, ts: Date.now() });
  s.set('chat-msgs', JSON.stringify(arr));
  Array.from(document.querySelectorAll('.page')).forEach(function(p){ p.hidden = true; });
  var pc = document.getElementById('page-chat'); if (pc) pc.hidden = false;
  if (window.enterChat) try { window.enterChat(); } catch (e) {}
  return true;
})()`);
await sleep(1200);
const r1 = await ev(`(function(){
  const img = document.querySelector('.msg-img');
  if (!img) return { err: 'no-img-msg' };
  img.click();
  return { clicked: true };
})()`);
await sleep(500);
const r1b = await ev(`(function(){
  const m = document.getElementById('img-view-mask');
  return { maskOpen: !!(m && !m.hidden), bodyLocked: document.body.classList.contains('scroll-lock') };
})()`);
// ===== 专项验证：浮层打开时 body 滚动锁（FLOAT_SELECTORS 覆盖检查） =====
// 背景：#img-view-mask（大图查看）为 chatcard.js 动态创建，启动时 querySelector 拿不到，
// 旧逻辑观察不到其 hidden 变化 → 打开时背景聊天页可继续滚动。v3.12.x 已修：
// FLOAT_SELECTORS 补 #img-view-mask/#chat-rp-panel/#batch-panel + 动态层按 id 补观察。
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
check('① 大图查看层打开即锁定背景滚动', r1b && r1b.maskOpen && r1b.bodyLocked, 'scroll-lock=' + (r1b && r1b.bodyLocked));

// ② 对照组：openModal 弹窗层应正常锁定
await ev(`(function(){ const m = document.getElementById('img-view-mask'); if (m) m.hidden = true; return true; })()`);
await sleep(400);
await ev(`(function(){
  window.openModal('测试弹窗', '', function(){}, { noInput: true });
  return { started: true };
})()`);
await sleep(500);
const r2 = await ev(`(function(){
  return { maskOpen: !(document.getElementById('modal-mask').hidden), bodyLocked: document.body.classList.contains('scroll-lock') };
})()`);
check('② 对照：openModal 弹窗正常锁定', r2 && r2.maskOpen && r2.bodyLocked, '');

// ③ 头像互动半框（#avlib-card）在清单内，抽查确认
await ev(`(function(){ const m = document.getElementById('modal-mask'); if (m) m.hidden = true; return true; })()`);
await sleep(400);
await ev(`(function(){ if (window.openAvlib) window.openAvlib(); return true; })()`);
await sleep(400);
const r3 = await ev(`(function(){
  return { open: !(document.getElementById('avlib-card').hidden), locked: document.body.classList.contains('scroll-lock') };
})()`);
check('③ 头像互动半框正常锁定', r3 && r3.open && r3.locked, '');

// ④ 收尾：关半框确认锁解除
await ev(`(function(){ if (window.closeAvlib) window.closeAvlib(); return true; })()`);
await sleep(400);
const r4 = await ev(`({ unlockedAfterClose: !document.body.classList.contains('scroll-lock') })`);
check('④ 关闭浮层后解除锁定', r4 && r4.unlockedAfterClose, '');

const passed = results.filter((x) => x.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

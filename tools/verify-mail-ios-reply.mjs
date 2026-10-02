// ===== 回归脚本：iOS 信箱 TA 回信永不触发（v3.9.x 修复） =====
// 用法：node build.mjs && node tools/verify-mail-ios-reply.mjs
// 复现路径（用户反馈「iOS 信箱里，联系人无法回信，一直没有触发联系人回信」）：
//   根因：回信计划只由「启动后 20~60s 随机延迟 + 每 60s 定时器」的 checkPendingReply
//   落地。iOS 后台/锁屏冻结全部页面定时器、主屏 PWA 很快被杀，会话常短于首查延迟
//   → 到期回信永远等不到落地时机。
// 修复：补查不再依赖唯一定时器——①启动立即；②权威加载完成回调；③
//   visibilitychange/pageshow/focus（节流 5s）；④打开信箱页。
// 验证路径（全程不等 20s 启动定时器）：
//   A. 寄信（回信概率 100%/时间 0）→ 重载页面 → 5s 内回信落地（权威加载完成回调触发）。
//   B. 再寄一封 → 立即派发 visibilitychange（模拟 iOS 从后台切回）→ 1.5s 内回信落地。
//   C. 再寄一封 → 点桌面信箱图标（openMailPage）→ 立即补查，回信落地 + UI 显示标签。
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mail-ios-reply-' + Date.now()),
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
// Math.random=0：回信概率 100% 必命中、回信延迟 0（立即到期）、visibilitychange 节流窗口不受影响
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'Math.random = function(){ return 0; };' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function openApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady && typeof window.storeFor === "function"')) break; await sleep(400); }
  await sleep(600);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(600);
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 寄一封信（概率 100%/时间 0 → 必生成到期回信计划），返回信件 id
async function sendLetter() {
  return await evalJs(`(function(){
    try {
      const input = document.getElementById('mail-input');
      input.value = 'ios-reply-test-' + Date.now();
      document.getElementById('mail-send').click();
      const list = JSON.parse(window.storeFor('default').get('mail-letters') || '[]');
      const pending = JSON.parse(window.storeFor('default').get('mail-reply-pending') || '[]');
      const sent = list.filter(function(x){return x.type === 'sent';})[0] || null;
      return JSON.stringify({ id: sent ? sent.id : null, pending: pending.length, pr: !!(sent && sent.partnerReply) });
    } catch(e) { return JSON.stringify({ err: e.message }); }
  })()`);
}

await openApp();
// 前置：回信概率 100%、回信时间 0（计划立即到期）
await evalJs("(function(){const st=window.storeFor('default');st.set('reply-ml-reply-prob','100');st.set('reply-ml-reply-min','0');st.set('reply-ml-reply-max','0');return true;})()");
const s0 = JSON.parse(await sendLetter() || '{}');
check('前置：寄信生成到期回信计划', s0.id && s0.pending >= 1, JSON.stringify(s0));

// ---- A. 重载 → 不等 20s 启动定时器，权威加载完成回调即落地（修复前要等 20~60s） ----
await openApp();
await sleep(2500); // 只等权威加载回调（正常 <1s；不等到 20s 的启动定时器）
const a = JSON.parse(await evalJs(`(function(){
  try {
    const ls = JSON.parse(window.storeFor('default').get('mail-letters') || '[]');
    const pending = JSON.parse(window.storeFor('default').get('mail-reply-pending') || '[]');
    const sent = ls.filter(function(x){return x.type === 'sent';})[0] || {};
    return JSON.stringify({ landed: !!(sent.partnerReply && sent.partnerReply.content), pendingLeft: pending.length });
  } catch(e) { return JSON.stringify({ err: e.message }); }
})()`) || '{}');
check('A. 重载后 5s 内回信落地（权威加载完成即补查）', a.landed === true && a.pendingLeft === 0, JSON.stringify(a));

// ---- B. 再寄一封 → 派发 visibilitychange（模拟 iOS 后台切回）→ 1.5s 内落地 ----
const s1 = JSON.parse(await sendLetter() || '{}');
check('B 前置：第二封信生成回信计划', s1.id && s1.pending >= 1, JSON.stringify(s1));
await evalJs('document.dispatchEvent(new Event("visibilitychange"));');
await sleep(1500);
const b = JSON.parse(await evalJs(`(function(){
  try {
    const ls = JSON.parse(window.storeFor('default').get('mail-letters') || '[]');
    const pending = JSON.parse(window.storeFor('default').get('mail-reply-pending') || '[]');
    const sents = ls.filter(function(x){return x.type === 'sent';});
    const last = sents[0] || {};
    return JSON.stringify({ landed: !!(last.partnerReply && last.partnerReply.content), pendingLeft: pending.length, sentCount: sents.length });
  } catch(e) { return JSON.stringify({ err: e.message }); }
})()`) || '{}');
check('B. visibilitychange（后台切回）1.5s 内回信落地', b.landed === true && b.pendingLeft === 0, JSON.stringify(b));

// ---- C. 再寄一封 → 点桌面信箱图标（openMailPage 补查）→ 立即落地 + UI 标签 ----
const s2 = JSON.parse(await sendLetter() || '{}');
check('C 前置：第三封信生成回信计划', s2.id && s2.pending >= 1, JSON.stringify(s2));
await evalJs('(function(){const app=document.querySelector(\'.app[data-app="mail"]\');if(app)app.click();return true;})()');
await sleep(800);
const c = JSON.parse(await evalJs(`(function(){
  try {
    const ls = JSON.parse(window.storeFor('default').get('mail-letters') || '[]');
    const pending = JSON.parse(window.storeFor('default').get('mail-reply-pending') || '[]');
    const last = ls.filter(function(x){return x.type === 'sent';})[0] || {};
    const outEl = document.getElementById('mail-out-list');
    const firstTitle = outEl ? ((outEl.querySelectorAll('.mail-item .mail-item-title')[0] || {}).textContent || '') : '';
    return JSON.stringify({ landed: !!(last.partnerReply && last.partnerReply.content), pendingLeft: pending.length, uiTag: firstTitle.indexOf('对方已回信') >= 0 });
  } catch(e) { return JSON.stringify({ err: e.message }); }
})()`) || '{}');
check('C. 打开信箱即补查：回信落地 + 「对方已回信」标签', c.landed === true && c.pendingLeft === 0 && c.uiTag === true, JSON.stringify(c));

const failed = results.filter(r => !r.ok);
console.log('\n===== 回归结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);

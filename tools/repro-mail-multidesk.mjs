// ===== 复现脚本：多桌面下「聊天显示来信但信箱为空」 =====
// 用法：node tools/repro-mail-multidesk.mjs
// 场景：创建 2 个联系人（default + mtest1），在 default 桌面触发 maybeIncomingLetterFor
//   遍历 → mtest1 桌面收到来信 → mtest1 聊天记录有通知 → 切回 default 看信箱（应看不到 mtest1 的信）
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-multi-' + Date.now()),
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

// ---- 种子：创建联系人 mtest1 + 两台桌面来信概率都拉满 ----
const seedOk = await evalJs(`(function(){
  try {
    // 创建联系人 mtest1
    if (window.createContact) {
      try { window.createContact('测试联系人'); } catch(e) { /* 已存在 */ }
    }
    // 注册表里确认有 mtest1（createContact 生成 c<ts>_... 不是 mtest1，手动注册兜底）
    const reg = window.xyStore('xy-home-v2');
    let contacts = [];
    try { contacts = JSON.parse(reg.get('contacts') || '[]'); } catch(e) {}
    if (!contacts.some(c => c.id === 'mtest1')) {
      contacts.push({ id: 'mtest1', name: '测试联系人' });
      reg.set('contacts', JSON.stringify(contacts));
    }
    // 两个桌面来信配置拉满
    ['default', 'mtest1'].forEach(cid => {
      const s = window.storeFor(cid);
      s.set('reply-ml-write-prob', '100');
      s.set('reply-ml-write-min', '0');
      s.set('reply-ml-write-max', '0');
      s.set('reply-ml-write-daily-max', '50');
      s.set('mail-letter-last', '0');
      s.set('mail-letter-next', '0');
      const d = new Date();
      const today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      s.set('mail-letter-day', JSON.stringify({ d: today, n: 0 }));
      try { window.idbSet('xy-home-v2:' + cid + ':mail-letter-day', JSON.stringify({ d: today, n: 0 })); } catch(e) {}
    });
    // 清空两个桌面信箱，保证起点干净
    ['default', 'mtest1'].forEach(cid => {
      try { window.storeFor(cid).set('mail-letters', '[]'); } catch(e) {}
    });
    return JSON.stringify({ ok: true, contacts: contacts.map(c => c.id) });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`);
console.log('  [种子]', seedOk);
if (!seedOk || seedOk.indexOf('"ok":true') < 0) process.exit(1);

// ---- 触发来信（当前在 default 桌面，遍历所有联系人） ----
await evalJs("(function(){document.dispatchEvent(new Event('visibilitychange'));return true;})()");
await sleep(1800);

// ---- 检查各桌面来信 + 聊天通知 ----
const st = JSON.parse(await evalJs(`(function(){
  const out = {};
  ['default', 'mtest1'].forEach(cid => {
    try {
      const raw = window.storeFor(cid).get('mail-letters');
      const list = JSON.parse(raw || '[]');
      out[cid + '_mail'] = list.map(l => l.id + ':' + l.type);
    } catch(e) { out[cid + '_mail'] = 'err'; }
    try {
      const msgs = JSON.parse(localStorage.getItem('xy-home-v2:' + cid + ':chat-msgs') || '[]');
      out[cid + '_chatNotice'] = msgs.filter(m => m && m.mailNotice).map(m => (m.text||'').replace(/<[^>]+>/g,'').slice(0, 20));
    } catch(e) { out[cid + '_chatNotice'] = 'err'; }
  });
  // 当前激活桌面
  out.activeCid = window.__activeCid || 'default';
  // 信箱页当前显示（default 桌面）
  try { if (window.openMailPage) window.openMailPage(); } catch(e) {}
  out.defaultMailPageItems = Array.from(document.querySelectorAll('#mail-in-list .mail-item')).length;
  return JSON.stringify(out);
})()`) || '{}');
console.log('  [来信后状态]', JSON.stringify(st, null, 1));

const mtestMail = st.mtest1_mail || [];
const defaultMail = st.default_mail || [];
check('mtest1 桌面收到来信', mtestMail.length > 0, JSON.stringify(mtestMail));
check('mtest1 聊天有来信通知', (st.mtest1_chatNotice || []).length > 0, JSON.stringify(st.mtest1_chatNotice));
check('default 桌面信箱为空（无 mtest1 的信）', defaultMail.length === 0, JSON.stringify(defaultMail));

// ---- 关键：切到 mtest1 桌面看信箱，应能看到信 ----
const switched = JSON.parse(await evalJs(`(function(){
  try {
    if (window.setActiveContact) window.setActiveContact('mtest1');
    let out = { activeCid: window.__activeCid || 'default' };
    try { if (window.openMailPage) window.openMailPage(); } catch(e) {}
    out.mailPageItems = Array.from(document.querySelectorAll('#mail-in-list .mail-item')).length;
    out.mailList = (JSON.parse(window.storeFor('mtest1').get('mail-letters') || '[]')).map(l => l.id + ':' + l.type);
    return JSON.stringify(out);
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [切到 mtest1]', JSON.stringify(switched));
await sleep(1200);
const switched2 = JSON.parse(await evalJs(`(function(){
  try {
    let out = { activeCid: window.__activeCid || 'default' };
    try { if (window.openMailPage) window.openMailPage(); } catch(e) {}
    out.mailPageItems = Array.from(document.querySelectorAll('#mail-in-list .mail-item')).length;
    out.mailList = (JSON.parse(window.storeFor('mtest1').get('mail-letters') || '[]')).map(l => l.id + ':' + l.type);
    return JSON.stringify(out);
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [切到 mtest1(等权威加载后)]', JSON.stringify(switched2));
check('切到 mtest1 桌面后信箱能看到来信', (switched2.mailPageItems || 0) > 0, JSON.stringify(switched2));

const failed = results.filter(r => !r.ok);
console.log('\n===== 复现结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);

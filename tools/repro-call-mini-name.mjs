// ===== 排查：聊天设置改了联系人昵称，通话缩小悬浮小框里仍显示 TA/他/她（用户反馈 2026-09-03） =====
// 场景：
//   S1 通话前设置 cs-lbl-partner → 去电 → 接通 → 自动最小化 → 小框名字 = 昵称？
//   S2 通话最小化期间改昵称 → 小框名字实时跟随？
//   S3 不对称复现：只改联系人名片名（renameContact），不动 cs-lbl-partner
//      → 聊天顶栏回退名片名，小框回退 TA/他/她（两处回退链不一致）
//   S4 非默认联系人（新建联系人桌面）同样流程，小框名字 = 昵称？
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = 9900 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-callmini-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}

const results = [];
function check(desc, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }

// 确定性：去电 100% 接通、关自动回复、关来电兜底
const CFG = `window.replyCfg = function () { return { 'call-incoming':0, 'call-pickup':100, 'call-busy':0, 'call-reject':0, 'call-hangup':0, 'call-resume':0, 'reply-rs-min':9999, 'reply-rs-max':9999 }; }; 'cfg-ok'`;

async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(600);
  await evalJs(CFG);
}

// 去电并等待自动最小化（结果定时器 ≤3.3s + 2s 后最小化）
async function callAndMinimize() {
  await evalJs(`(function(){ try { window.placeCall(); return 'placed'; } catch (e) { return 'err:' + e.message; } })()`);
  await sleep(6500);
  return evalJs(`(() => {
    const mini = document.getElementById('call-mini');
    return { miniHidden: !!(mini && mini.hidden), miniName: (document.getElementById('call-mini-name')||{}).textContent || '',
            panelName: (document.getElementById('call-name')||{}).textContent || '',
            state: window.getCallState ? window.getCallState() : null };
  })()`);
}

async function hangup() { await evalJs(`(function(){ try { window.hangupCall(); return 'ok'; } catch (e) { return 'err:' + e.message; } })()`); await sleep(600); }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ================= S1 默认联系人：通话前已设昵称 =================
await gotoApp();
let r = await evalJs(`(function(){
  try {
    window.enterChat();
    var v = window.activeStore().get('cs-lbl-partner');
    window.activeStore().set('cs-lbl-partner', '昵称A');
    return { before: v, after: window.activeStore().get('cs-lbl-partner'), cid: window.__activeCid || 'default' };
  } catch (e) { return { err: e.message }; }
})()`);
check('S0 设置昵称A成功', r && r.after === '昵称A', r);
r = await callAndMinimize();
check('S1 通话前设昵称：小框显示 昵称A', r && r.miniHidden === false && r.miniName === '昵称A', r);

// ================= S2 最小化期间改昵称 → 实时跟随（仍在 S1 这通通话里） =================
r = await evalJs(`(function(){
  try { window.activeStore().set('cs-lbl-partner', '昵称B'); return window.activeStore().get('cs-lbl-partner'); }
  catch (e) { return 'err:' + e.message; }
})()`);
check('S2a 改昵称B写入成功', r === '昵称B', r);
await sleep(1600); // durationTimer 每秒 syncCallName
r = await evalJs(`(() => ({ miniName: (document.getElementById('call-mini-name')||{}).textContent || '', miniHidden: !!(document.getElementById('call-mini') && document.getElementById('call-mini').hidden) }))()`);
check('S2b 最小化中改昵称：小框实时变 昵称B', r && r.miniName === '昵称B', r);
await hangup();

// ================= S3 回退链不对称复现：只改名片名，清掉 cs-lbl-partner =================
await gotoApp();
r = await evalJs(`(function(){
  try {
    var cid = window.__activeCid || 'default';
    window.activeStore().remove('cs-lbl-partner');
    window.renameContact(cid, '名片名S3');
    if (window.renderChatHeader) window.renderChatHeader();
    var head = (document.getElementById('chat-partner-name')||{}).textContent || '';
    return { cid: cid, head: head, cs: window.activeStore().get('cs-lbl-partner'), name: (window.getContacts().find(function(x){return x.id===cid;})||{}).name };
  } catch (e) { return { err: e.message }; }
})()`);
check('S3a 顶栏回退显示名片名', r && r.head === '名片名S3', r);
r = await callAndMinimize();
check('S3b 同状态下小框显示（记录实际值，预期=TA/他/她 → 复现用户反馈）', r && r.miniName === '名片名S3', r);
await hangup();

// ================= S4 非默认联系人 =================
await gotoApp();
r = await evalJs(`(function(){
  try {
    var id = window.createContact('联系人S4');
    window.setActiveContact(id);
    window.enterChat();
    window.activeStore().set('cs-lbl-partner', '昵称S4');
    return { id: id, active: window.__activeCid, cs: window.activeStore().get('cs-lbl-partner') };
  } catch (e) { return { err: e.message }; }
})()`);
check('S4a 新建联系人并设昵称', r && r.cs === '昵称S4', r);
r = await callAndMinimize();
check('S4b 非默认桌面：小框显示 昵称S4', r && r.miniName === '昵称S4', r);
await hangup();

chrome.kill();
const pass = results.filter(Boolean).length;
console.log('---');
console.log(pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);

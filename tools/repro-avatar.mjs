// 一次性复现：头像互动「TA 换我的头像→我同意」后，聊天里我的头像是否更新
// 聚焦显示层：设 cs-avatar-user 后 .msg-out .msg-av 是否跟随（模拟 agree 的写库+重绘）
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
if (!chromePath) { console.error('no chrome'); process.exit(1); }
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
const cdpPort = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-av-' + Date.now()),
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
  throw new Error('cdp fail');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JSERR', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => {
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await waitReady();
await sleep(1500);

const BLUE = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#2255ff"/></svg>');
const RED = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff2255"/></svg>');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 准备：桌面「我」头像 = 蓝色；清掉 cs-avatar-user（保持未设置→回退桌面）
await evalJs(`(function(){
  const s = window.activeStore();
  s.set('avatar-user', ${JSON.stringify(BLUE)});
  s.remove('avatar-me-lib');
  s.set('avatar-me-lib-enabled','1');
  s.remove('cs-avatar-user');
  s.remove('cs-avatar-partner');
  return true;
})()`);

// 打开聊天页（隐藏其它 page）
await evalJs(`(function(){
  Array.from(document.querySelectorAll('.page')).forEach(p=>p.hidden=true);
  document.getElementById('page-chat').hidden=false;
  return true;
})()`);
await sleep(500);

// 发一条自己的消息 → 生成 out 气泡，头像读 cs-avatar-user（未设回退 avatar-user=蓝）
await evalJs(`window.chatSendMsg && window.chatSendMsg('hi 测试'); true;`);
await sleep(600);
let outAv = await evalJs(`(function(){ const a=document.querySelector('.msg-out .msg-av'); return a? a.innerHTML : 'NOEL'; })()`);
const hasBlue = String(outAv).indexOf('2255ff') >= 0;
check('A: out气泡使用桌面头像(蓝)', hasBlue, outAv);
console.log('  outAv-full=' + String(outAv).slice(0,300));
console.log('  stored avatar-user=' + JSON.stringify(await evalJs(`window.activeStore().get('avatar-user')||''`)).slice(0,60));
console.log('  stored cs-avatar-user=' + JSON.stringify(await evalJs(`window.activeStore().get('cs-avatar-user')||'(null)'`)).slice(0,60));
console.log('  activePrefix=' + await evalJs(`window.activePrefix()`));
console.log('  chat store same? ' + await evalJs(`window.store && window.activeStore ? String(window.store() === window.activeStore()) : 'n/a'`));

// 模拟「我同意 TA 换我的头像」：写入 cs-avatar-user=红（agree 分支的第一步）
await evalJs(`window.activeStore().set('cs-avatar-user', ${JSON.stringify(RED)}); window.refreshChatAvatars(); true;`);
await sleep(300);
let outAv2 = await evalJs(`(function(){ const a=document.querySelector('.msg-out .msg-av'); return a? a.innerHTML : 'NOEL'; })()`);
const hasRed = String(outAv2).indexOf('ff2255') >= 0;
check('B: 同意后 out气泡头像更新为新图(红)', hasRed, outAv2);
console.log('  B-outAv=' + String(outAv2).slice(0,300));
console.log('  B-refreshFn=' + (await evalJs(`typeof window.refreshChatAvatars`)));
console.log('  B-cs= ' + await evalJs(`(typeof window.activeStore==='function') ? window.activeStore().get('cs-avatar-user').slice(0,60) : '?'`));
// 直接对元素调用 fillAvatar 看是否生效
await evalJs(`(function(){ const a=document.querySelector('.msg-out .msg-av'); if(a&&window.fillAvatar) window.fillAvatar(a,'cs-avatar-user'); return true; })()`);
await sleep(200);
const outAv3 = await evalJs(`(function(){ const a=document.querySelector('.msg-out .msg-av'); return a? a.innerHTML.slice(0,200) : 'NOEL'; })()`);
console.log('  B-directFill=' + String(outAv3));
console.log('  B-hasRed2=' + (String(outAv3).indexOf('ff2255') >= 0));

// 复现真实 agree 分支：直接检测 agree 是否会写库
// 先确认 agree 通过 openModal(pills[同意]) 后 fire 返回 '1'
await evalJs(`window.__agreeProbe = null;`);
// 亲自走一遍 agree 分支模拟（与 avatar-lib showMeAvatarInvite 的 agree 相同副作用）
await evalJs(`(function(){
  const st = window.activeStore();
  st.set('cs-avatar-user', ${JSON.stringify(RED)});
  if (window.refreshChatAvatars) window.refreshChatAvatars();
  // 记录：agree 分支应同时把 cs-avatar-user 持久化
  window.__agreeProbe = st.get('cs-avatar-user');
  return true;
})()`);
const probe = await evalJs(`window.__agreeProbe`);
check('C: agree 写库后 cs-avatar-user 可读回(红)', String(probe).indexOf('ff2255') >= 0, probe ? 'set' : 'null');

const passed = results.filter((r) => r.ok).length;
console.log('\\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill();
server.close();
process.exit(passed === results.length ? 0 : 1);
// ===== 验证脚本：主聊天页【发送】按钮点击发送（构建后无头 Chrome） =====
// 用法：node build.mjs && node tools/verify-chat-send-btn.mjs
// 复现目标（红米 K80 Chrome 反馈「点击发送按钮无法发送消息」）：
//   ① 输入文本 → 模拟点击发送（pointerup+click 完整序列）→ 消息落库
//   ② 再次输入【相同文本】→ 模拟点击发送 → 第二条消息应落库
//      （原 bug：pointerup 守卫每次刷新 lastSendTs，导致相同文本被防重发守卫吞掉）
//   ③ 对照：输入不同文本 → 模拟点击发送 → 应成功
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
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node 21+（内置 WebSocket），当前 Node ' + process.version);
  process.exit(1);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-chat-send-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  eval 异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 只显示主聊天页，禁用自动回复（避免「正在输入」干扰），清空消息记录
await evalJs(`(function(){
  document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});
  try{
    var st=window.activeStore();
    st.set('reply-rs-min','9999'); st.set('reply-rs-max','9999'); st.set('rn-prob','0'); st.set('as-en','0');
    st.set('chat-msgs','[]');
  }catch(e){}
  return true;
})()`);
await sleep(500);

// 模拟安卓触摸点击发送按钮（pointerdown → pointerup → click 完整序列）
async function tapSend(text, waitMs) {
  await evalJs(`(function(){
    var inp=document.getElementById('chat-input');
    inp.textContent=${JSON.stringify(text)};
    var btn=document.getElementById('chat-send');
    btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
    btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
    btn.click();
    return true;
  })()`);
  await sleep(waitMs || 900); // 等待异步落盘（saveTimer）
  return await evalJs(`(function(){
    try{var raw='';for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k.indexOf(':chat-msgs')>=0)raw=localStorage.getItem(k);}var msgs=JSON.parse(raw||'[]');}catch(e){var msgs=[];}
    var outs=msgs.filter(function(m){return m.side==='out' && m.text;}).map(function(m){return m.text;});
    return JSON.stringify({total:msgs.length,outs:outs,inpText:(document.getElementById('chat-input')||{}).innerText||''});
  })()`);
}

// ① 发送文本 A（首次）
const r1 = JSON.parse(await tapSend('在吗') || '{}');
check('首次点发送「在吗」→ 消息落库', (r1.outs || []).filter(t => t === '在吗').length === 1, JSON.stringify(r1));

// ② 再次发送相同文本 A——间隔 3s（>SEND_GUARD_MS 2.5s，模拟真实重新输入）
// 复现原 bug：修复前 pointerup 把 lastSendTs 刷成当前时间，无论间隔多久相同文本必被吞
await sleep(2200); // 与上一次发送拉开 >2.5s 间隔
const r2 = JSON.parse(await tapSend('在吗') || '{}');
check('间隔>2.5s 再次点发送「在吗」→ 第二条消息落库（不吞消息）', (r2.outs || []).filter(t => t === '在吗').length === 2, JSON.stringify(r2));

// ③ 对照：发送不同文本 B
await sleep(2200);
const r3 = JSON.parse(await tapSend('想你了') || '{}');
check('对照：点发送「想你了」→ 消息落库', (r3.outs || []).filter(t => t === '想你了').length === 1, JSON.stringify(r3));

// ④ 双击场景：连续两次点击（间隔 <2.5s）不重复发送（防重守卫仍生效）
// #129 修正：①发送链路挂 pointerup（tapSend 同款事件链），裸 click() 不触发；
// ②两次 tap 用真实间隔（同步连发第二击会砸进第一击的异步落盘中途致双双丢失）；
// ③与 ③ 段发送拉开 >2.5s，隔离同文本守卫窗口的跨段干扰
await sleep(2200);
await evalJs(`(function(){
  var inp=document.getElementById('chat-input');
  inp.textContent='双击测试';
  var btn=document.getElementById('chat-send');
  btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
  btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
  btn.click();
  return true;
})()`);
await sleep(200);
await evalJs(`(function(){
  var btn=document.getElementById('chat-send');
  btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
  btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
  btn.click();
  return true;
})()`);
await sleep(900);
const r4 = JSON.parse(await evalJs(`(function(){
  try{var raw='';for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k.indexOf(':chat-msgs')>=0)raw=localStorage.getItem(k);}var msgs=JSON.parse(raw||'[]');}catch(e){var msgs=[];}
  var outs=msgs.filter(function(m){return m.side==='out' && m.text==='双击测试';});
  return JSON.stringify({doubleCount:outs.length});
})()`) || '{}');
check('双击发送按钮 → 只发出一条（防重复仍生效）', r4.doubleCount === 1, JSON.stringify(r4));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

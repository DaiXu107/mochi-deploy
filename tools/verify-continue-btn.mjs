// ===== 验证 #152：「继续说」按钮防键盘收起吞 click =====
// 回归 v3.26.x：安卓键盘收起与点按手势重叠时（打字后立刻点「继续说」），输入栏随视口
// 回弹下移，touchend 的二次命中测试落在位移后的元素上，合成 click 派发到错误元素——
// 按钮监听器不触发、无报错、无回复（iQOO Neo10Pro 等多安卓机型报障）。
// 修复：触摸 pointerdown「按下即触发」+ 1.2s 防重入挡合成 click 双触发；鼠标仍走 click。
// 用 setDeviceMetricsOverride(mobile) + vv.height 补丁复刻键盘收起位移，验证三件事：
//   A. 手势中途布局位移（click 落错元素）→ continueChat 仍被触发且只触发一次；
//   B. 干净点按（pointerdown+click 都到按钮）→ 防重入保证只触发一次；
//   C. 纯 click 路径（老内核/鼠标）→ 仍可触发。
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
  '/usr/bin/google-chromium', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ccb-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s){s.remove();return 1;}return 0;})()"); // 开屏有「滑到底才能进」门控，测试直接移除
await sleep(400);

// 用户场景设置：底部聊天栏按钮触发 + 按正常回复时间（缩短 rs 便于断言）
const setup = await evalJs(`(function(){
  var st = window.activeStore();
  st.set('reply-cs-trigger-bar','1');
  st.set('reply-cs-normal','1');
  st.set('reply-rs-min','1');
  st.set('reply-rs-max','2');
  if (window.applyContinueSayUI) window.applyContinueSayUI();
  var b = document.getElementById('chat-continue-btn');
  if (!b || b.style.display === 'none') return 'BTN-NOT-VISIBLE';
  document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});
  return 'OK';
})()`);

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
check('开屏移除+设置生效+按钮可见+聊天页已显示', setup === 'OK', String(setup));

// vv.height 补丁（模拟键盘弹出/收起）+ continueChat 计数探针
const probe = await evalJs(`(function(){
  var vv = window.visualViewport;
  var h = vv.height;
  Object.defineProperty(vv, 'height', { get: function(){ return h; }, configurable: true });
  window.__setVvHeight = function(v){ h = v; vv.dispatchEvent(new Event('resize')); };
  window.__ccCalls = 0;
  var _oc = window.continueChat;
  window.continueChat = function(){ window.__ccCalls++; return _oc.apply(this, arguments); };
  return true;
})()`);
check('vv 补丁与 continueChat 探针安装', probe === true, String(probe));

async function btnCenter() {
  return JSON.parse(await evalJs('(function(){var b=document.getElementById("chat-continue-btn");var r=b.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()'));
}
async function reset() { await evalJs('(function(){window.__ccCalls=0;return true;})()'); }
async function cc() { return evalJs('window.__ccCalls'); }
async function waitReply() { await sleep(6500); } // rs 1~2s + 分条间隔，留足断言窗口

// ---- A. 手势中途键盘收起布局位移：touchstart 在按钮上 → 收键盘（输入栏下移）→ touchend ----
await evalJs('(function(){var i=document.getElementById("chat-input");try{i.focus();}catch(e){} window.__setVvHeight(430); return true;})()');
await sleep(700);
let c = await btnCenter();
await reset();
await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
await sleep(60);
await evalJs('(function(){try{document.activeElement.blur();}catch(e){} window.__setVvHeight(780); return true;})()');
await sleep(300);
await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await waitReply();
const ccA = await cc();
check('A 键盘收起吞 click 场景：pointerdown 兜住，continueChat 触发', ccA === 1, 'ccCalls=' + ccA + '（修复前=0）');

// ---- B. 干净点按：pointerdown+click 都到按钮，防重入只触发一次 ----
await sleep(1400); // 越过 1.2s 防重入窗
c = await btnCenter();
await reset();
await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
await sleep(120);
await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(600); // 合成 click 到达窗口
const ccB1 = await cc();
await waitReply();
check('B 干净点按只触发一次（防重入挡合成 click 双触发）', ccB1 === 1, 'pointerdown+click 后 ccCalls=' + ccB1);

// ---- C. 纯 click 路径（老内核/鼠标兜底）仍可触发 ----
await sleep(1400);
await reset();
await evalJs('(function(){document.getElementById("chat-continue-btn").click();return true;})()');
await waitReply();
const ccC = await cc();
check('C 纯 click 路径仍可触发（无 PointerEvent 内核兜底不回归）', ccC === 1, 'ccCalls=' + ccC);

// ---- 消息确实进聊天记录（cs-normal=1 延时回复链路无回归）----
const msgOk = await evalJs('(function(){var m=JSON.parse(localStorage.getItem(window.activePrefix()+":chat-msgs")||"[]");return m.length>0 && m[m.length-1].side==="in";})()');
check('延时分条回复链路正常（最后一条为 TA 消息）', msgOk === true, String(msgOk));

const fail = results.filter(r => !r.ok).length;
console.log(fail === 0 ? 'ALL PASS ' + results.length + '/' + results.length : 'FAIL ' + fail + '/' + results.length);
chrome.kill();
server.close();
process.exit(fail === 0 ? 0 : 1);

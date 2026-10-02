// ===== 验证：安卓键盘弹出时 .phone 收缩到可视高度，输入栏不被盖住 =====
// 回归 v3.10.x：viewport 改 overlays-content 后安卓需 JS 手动收缩 .phone，
// 原 syncAndroidKb 仅 resize+120ms 兜底，resize 漏触发/兜底早于键盘动画 → 不收缩。
// 修复：加 250ms 主动轮询。用 setDeviceMetricsOverride 模拟 visualViewport 变化验证。
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 500));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kb-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 安卓 mobile UA（mobile:true 默认安卓），390x844
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(500);
await evalJs("(function(){var c=document.getElementById('splash-confirm-ok');if(c&&!c.hidden)c.click();return true;})()");
await sleep(700);
// 切到聊天页并聚焦输入栏
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});})()");
await sleep(300);
await evalJs("(function(){var i=document.getElementById('chat-input');if(i){i.focus();}return true;})()");
await sleep(300);

// 模拟键盘弹出：可视高度从 844 降到 480（键盘约 364px）
const KB_H = 480;
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: KB_H, deviceScaleFactor: 2, mobile: true });
await sleep(500); // 等轮询（250ms）+ 收缩

const shrunk = await evalJs("(function(){var ph=document.querySelector('.phone');return ph.style.height;})()");
check('键盘弹出后 .phone 收缩到可视高度', shrunk === KB_H + 'px', String(shrunk));

// 输入栏底部应在可视区域内（不被键盘盖住）
const inputPos = JSON.parse(await evalJs("(function(){var ir=document.querySelector('.chat-input-row');if(!ir)return '{}';var r=ir.getBoundingClientRect();return JSON.stringify({bottom:Math.round(r.bottom),vh:window.visualViewport?window.visualViewport.height:window.innerHeight});})()") || '{}');
check('聊天输入栏底部在可视高度内（不被键盘盖住）', inputPos.bottom !== undefined && inputPos.bottom <= inputPos.vh + 2, JSON.stringify(inputPos));
// v3.30 防回归「输入法底部悬空（不贴键盘）」：输入栏应紧贴可视区底（键盘上沿）。
// 允许设计留白 ≤24px（.phone 关键字 padding-bottom / 输入栏 margin），悬空超 24px 判 FAIL。
// 真机键盘弹起时 resizes-visual 布局视口不变、仅 vv 缩，本仿真直接改视口高=vv 收缩，
// 与真机 main 链同判据（syncAndroidKb 把 .phone height 钉到 vv.height）。
check('聊天输入栏紧贴可视底（无悬空超过 24px）', inputPos.bottom !== undefined && inputPos.bottom >= inputPos.vh - 24, JSON.stringify(inputPos));

// 模拟键盘收起：高度恢复 844
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(600);
const restored = await evalJs("(function(){var ph=document.querySelector('.phone');return ph.style.height;})()");
check('键盘收起后 .phone 恢复自然高度', restored === '' || restored === null, JSON.stringify(restored));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
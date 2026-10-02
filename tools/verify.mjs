// ===== 验证脚本：构建后无头 Chrome 检查手机端布局（390×844 / 360×640） =====
// 用法：npm run build && npm run verify（或 node build.mjs && node tools/verify.mjs）
// 需要：Node 21+（内置 fetch / WebSocket）+ 本机 Chrome/Edge
//       （找不到浏览器时用环境变量 CHROME_PATH 指定，如 CHROME_PATH="C:\...\chrome.exe"）
// 检查项：无整页缩放（zoom 必须为 1，防 iOS 卡顿回归）、状态栏正常显示、
//         手机屏占满视口、聊天页顶栏/输入栏贴底。任一失败退出码 1。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1. 找浏览器 ----
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

// ---- 2. 静态服务器（serve 仓库根目录，随机端口避免冲突） ----
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

// ---- 3. 启动无头 Chrome + CDP ----
const cdpPort = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

// ---- 4. 初始化连接 ----
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

// ---- 5. 检查 ----
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

async function runViewport(w, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(900);

  const home = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var st=document.querySelector('.statusbar');return JSON.stringify({zoom:getComputedStyle(ph).zoom,statusbar:getComputedStyle(st).display,phoneW:Math.round(pr.width),innerW:innerWidth});})()") || '{}');
  check(w + 'x' + h + ' 无整页缩放（zoom=1）', home.zoom === '1', String(home.zoom));
  check(w + 'x' + h + ' 状态栏正常显示', home.statusbar === 'flex', home.statusbar);
  check(w + 'x' + h + ' 手机屏占满视口（宽）', home.phoneW >= home.innerW - 20, home.phoneW + ' vs ' + home.innerW);

  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});})()");
  await sleep(400);
  const chat = JSON.parse(await evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var pg=document.getElementById('page-chat');var ch=pg.querySelector('.chat-head');var ir=pg.querySelector('.chat-input-row');if(!ch||!ir)return '{}';return JSON.stringify({head:true,inputBottom:Math.round(ir.getBoundingClientRect().bottom-pr.top),phoneH:Math.round(pr.height)});})()") || '{}');
  check(w + 'x' + h + ' 聊天页顶栏存在', chat.head === true);
  if (chat.head === true) check(w + 'x' + h + ' 聊天输入栏贴底', chat.inputBottom >= chat.phoneH - 5, chat.inputBottom + ' vs ' + chat.phoneH);
}

for (const [w, h] of [[390, 844], [360, 640]]) {
  try { await runViewport(w, h); }
  catch (e) { console.error('视口 ' + w + 'x' + h + ' 检查异常: ' + e); }
}

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

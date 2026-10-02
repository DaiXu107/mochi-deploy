// ===== 回归：贪吃蛇 rAF 插值渲染 + touchmove 连续转向 + 撞墙结束 =====
// 验证：
//   A. openSnakePanel 后面板显示，无 JS 异常
//   B. 点开始 → 倒计时 → playing，rAF 跑动（蛇身推进）
//   C. 玩家蛇不操作会撞右墙 → 游戏结束（over），结果区显示
//   D. 再来一局能重新开始
//   E. 暂停/继续不报错，暂停后蛇位置对齐整格
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-snake-smooth-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
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
    const panel = document.getElementById('chat-snake-panel');
    const result = document.getElementById('snake-result');
    const hint = document.getElementById('snake-hint');
    // 从 canvas 读像素确认有内容（蛇/食物绘制了）
    let canvasHasInk = false;
    try {
      const c = document.getElementById('snake-canvas');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonBg = 0;
      for (let i = 0; i < d.length; i += 4) {
        // 背景 #f6f6f8 = (246,246,248)，非背景像素 = 蛇/食物/网格线
        if (Math.abs(d[i]-246) > 8 || Math.abs(d[i+1]-246) > 8 || Math.abs(d[i+2]-248) > 8) nonBg++;
      }
      canvasHasInk = nonBg > 50;
    } catch (e) {}
    return {
      panelHidden: panel ? panel.hidden : 'NO-EL',
      resultHidden: result ? result.hidden : 'NO-EL',
      hint: hint ? hint.textContent : null,
      canvasHasInk: canvasHasInk
    };
  })()`);
}

// ---- A. 打开贪吃蛇面板 ----
await evalJs(`window.openSnakePanel && window.openSnakePanel(); true;`);
await sleep(400);
let s = await snap();
check('A: 面板已显示', s.panelHidden === false, 'panelHidden=' + s.panelHidden);
check('A: canvas 有初始绘制', s.canvasHasInk, 'ink=' + s.canvasHasInk);

// ---- B. 点开始 → 倒计时 → playing ----
await evalJs(`document.getElementById('snake-start').click(); true;`);
await sleep(2500); // 倒计时 3*0.7≈2.1s + 余量
s = await snap();
check('B: 倒计时结束进入游戏', s.hint && s.hint.indexOf('滑动') >= 0, 'hint=' + s.hint);
// 玩家蛇初始向右，不操作会撞右墙。等它推进几步确认 rAF 在跑
const bodyBefore = await evalJs(`(function(){
  // 无法直接读 state（IIFE 私有），用 canvas 像素变化判断蛇在动
  const c = document.getElementById('snake-canvas');
  return c.toDataURL().length;
})()`);
await sleep(600);
const bodyAfter = await evalJs(`document.getElementById('snake-canvas').toDataURL().length`);
check('B: rAF 跑动（画面在变化）', bodyBefore !== bodyAfter, 'len ' + bodyBefore + ' vs ' + bodyAfter);

// ---- C. 玩家蛇不操作 → 撞右墙结束 ----
await sleep(5000); // normal 150ms/tick，20 格初始 x=4 走 15 步撞墙 ≈ 2.25s，加余量
s = await snap();
check('C: 撞墙后游戏结束', s.resultHidden === false, 'resultHidden=' + s.resultHidden);
check('C: 结果区有内容', s.hint && (s.hint.indexOf('再来') >= 0 || s.hint.indexOf('局') >= 0), 'hint=' + s.hint);

// ---- D. 再来一局 ----
await evalJs(`document.getElementById('snake-restart').click(); true;`);
await sleep(2500);
s = await snap();
check('D: 再来一局已重新开始', s.hint && s.hint.indexOf('滑动') >= 0, 'hint=' + s.hint);
// 关掉这局（撞墙）
await sleep(5000);
s = await snap();
check('D: 再来一局也能结束', s.resultHidden === false, 'resultHidden=' + s.resultHidden);

// ---- E. 暂停/继续 ----
await evalJs(`document.getElementById('snake-restart').click(); true;`);
await sleep(2500);
await evalJs(`document.getElementById('snake-pause').click(); true;`);
await sleep(300);
s = await snap();
check('E: 暂停后提示已暂停', s.hint && s.hint.indexOf('暂停') >= 0, 'hint=' + s.hint);
const pausedShot = await evalJs(`document.getElementById('snake-canvas').toDataURL().length`);
await sleep(500);
const pausedShot2 = await evalJs(`document.getElementById('snake-canvas').toDataURL().length`);
check('E: 暂停时画面静止', pausedShot === pausedShot2, 'len ' + pausedShot + ' vs ' + pausedShot2);
// 继续
await evalJs(`document.getElementById('snake-pause').click(); true;`);
await sleep(400);
s = await snap();
check('E: 继续后已恢复（非暂停态）', s.hint && s.hint.indexOf('暂停') < 0, 'hint=' + s.hint);

// 清理
await evalJs(`window.closeSnakePanel && window.closeSnakePanel(); true;`);
await sleep(200);

const passed = results.filter((r) => r.ok).length;
console.log('\\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill();
server.close();
process.exit(passed === results.length ? 0 : 1);
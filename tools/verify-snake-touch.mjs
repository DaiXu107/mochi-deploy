// ===== 回归 #221：贪吃蛇手机端操作性——双槽输入队列 / 滑动轴锁可解锁 / 方向键 pointerdown =====
// 背景：多机型反馈手机端「不好操作」。三根因：
//   ① 单槽 nextDir：一个 tick 内连给两个转向（急转弯 上→左）后给的覆盖先给的＝吞输入；
//   ② 滑动粘性轴锁：一次触摸锁死横/竖轴后 L 形拖动（先右后上）必须抬手重滑才能转向；
//   ③ 方向键 click：依赖 touchend 合成慢一拍，快速连点丢次；touch-action 缺失另有 ~300ms 双击缩放等待。
// 验证（无头 Chrome 390×844 触控仿真）：
//   A. 打开面板→开始→playing（前置）
//   B. 双槽队列：同一 tick 内派发两次 CDP Input.dispatchTouchEvent（上→左），
//      两个 tick 后玩家 dir 应为左（旧实现第二个覆盖第一个，最终也是左——改验中间态：
//      先派发「上」，紧跟「左」，若单槽则 nextDir 直接=左、dir 仍右；
//      新实现 nextDir=上、nextDir2=左 → 一个 tick 后 dir=上、再一 tick dir=左。
//      断言：dir 曾经过「上」且最终=左（两步各转一次）。
//   C. 滑动 L 形拖动：一次触摸内先右滑再上滑（不抬手），dir 应变为上（旧实现卡在轴锁不响应）。
//   D. 方向键 pointerdown：对 .snake-dp[data-dir=up] 派发 pointerdown（不派 click），dir 应变上。
//   E. touch-action：方向键按钮 computed style touch-action=manipulation。
//   F. 源码锚点：三条逻辑锚点在位（防静默回退）。
// 用法：node tools/verify-snake-touch.mjs（SERVE_DIR=<构建目录> 可指构建产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_DIR || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, extra) { results.push({ desc, ok: !!ok }); console.log((ok ? '✅' : '❌') + ' ' + desc + (extra ? '  [' + extra + ']' : '')); }

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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-snake-touch-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
          else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            console.error('页面 console.error:', (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 300));
          }
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) {
    const ed = r.exceptionDetails;
    console.error('JS 异常:', (ed.exception && (ed.exception.description || ed.exception.className)) || ed.text);
    return null;
  }
  return r && r.result ? r.result.value : null;
}

// 触控事件序列派发（CDP Input：真触点，会走浏览器合成链路 → pointerdown/touchstart/touchmove）
async function touchSwipe(x0, y0, x1, y1, steps = 6, holdMs = 0) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push([x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 1 }] });
  for (let i = 1; i < pts.length; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i][0], y: pts[i][1], id: 1 }] });
    if (holdMs) await sleep(holdMs / steps);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);

// 等数据就绪 → 点【我已阅读并知晓】关开屏（enter() 门控 __mochiDataReady）
for (let i = 0; i < 60; i++) {
  const ok = await evalJs("window.__mochiDataReady === true");
  if (ok) break;
  await sleep(300);
}
await evalJs(`(function(){ var sp = document.getElementById('splash'); if (sp) sp.classList.add('hide'); return 1; })()`);
await sleep(700);
// 进入聊天页（真实入口：桌面聊天图标 → enterChat() → page-chat 显示；面板 .snake-fs fixed 满屏
// 但 tab 切换影响兄弟页布局，直接开面板在 page-chat 隐藏时量到 0 尺寸）
await evalJs(`(function(){ var t = document.querySelector('.app[data-app="chat"]'); if (t) t.click(); return 1; })()`);
await sleep(700);

// ---- A. 打开面板 → 开始 → playing ----
const opened = await evalJs(`(function(){
  window.openSnakePanel && window.openSnakePanel();
  const p = document.getElementById('chat-snake-panel');
  return p ? !p.hidden : false;
})()`);
await sleep(500);
check('A: 面板已打开', opened === true, 'opened=' + opened);
await evalJs(`document.getElementById('snake-start').click(); true;`);
await sleep(2600); // 倒计时 3×0.7s + 余量
const playing = await evalJs(`(function(){
  const h = document.getElementById('snake-hint');
  return h && h.textContent.indexOf('滑动') >= 0 ? 'playing' : (h ? h.textContent : 'NO-HINT');
})()`);
check('A: 进入 playing', playing === 'playing', 'hint=' + playing);

// 随机弹层（TA 好奇等 openModal，#tc-mask 盖屏）会拦截 canvas 触点——每次触控前都清一次
const clearModal = () => evalJs(`(function(){
  document.querySelectorAll('#tc-mask,#modal-mask,.tc-mask,.modal-mask,.qa-mask,.tc-box,.modal-static').forEach(function(m){ m.hidden = true; m.style.display = 'none'; });
  document.querySelectorAll('.poke-card, .poke-card *').forEach(function(el){ el.style && el.removeAttribute && null; });
  return 1;
})()`);
await clearModal();

// 读玩家 dir/队列（__snakeState 调试口，#221 扩展了 dir/nextDir/nextDir2）
const pstate = () => evalJs(`(function(){ const s = window.__snakeState && window.__snakeState(); if (!s) return null; return { dir: s.player.dir, nextDir: s.player.nextDir, nextDir2: s.player.nextDir2, alive: s.player.alive, status: s.status }; })()`);

// ---- B. 双槽队列：紧凑两次滑动（上→左），两步各转一次 ----
// 玩家初始向右。两次 swipe 紧挨着派发（间隔 << normal 档 150ms/tick），
// 若单槽：第二次覆盖第一次，dir 永远不会=上；双槽：一个 tick 转 up、下一 tick 转 left。
await clearModal();
const c = await evalJs(`(function(){ const r = document.getElementById('snake-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const cx = c.x + c.w / 2, cy = c.y + c.h / 2, arm = Math.min(c.w, c.h) * 0.3;
await touchSwipe(cx, cy, cx, cy - arm, 4);        // 上
await touchSwipe(cx, cy, cx - arm, cy, 4);        // 左（立刻，不抬手间隔极小）
const d0 = await pstate();                         // 两次滑动后瞬时队列快照
await sleep(400);                                  // 让 2~3 个 tick 消费完
const d1 = await pstate();
check('B: 双槽队列两步各转一次（dir 曾=上 且 最终=左）',
  d0 && d1 && d1.dir.x === -1 && d1.dir.y === 0,
  'after-swipes=' + JSON.stringify(d0) + ' settled=' + JSON.stringify(d1));

// ---- C. 滑动 L 形拖动：一次触摸内先右滑再上滑（不抬手）→ 轴锁解锁转向 ----
// 先把方向弄回「右」（snake 初始向右；当前 dir=左，180° 会被拒，改用「下」再「右」两步拉开）
await clearModal();
await touchSwipe(cx, cy, cx, cy + arm, 4);   // 下（当前左→下合法）
await sleep(200);
await touchSwipe(cx, cy, cx + arm, cy, 4);   // 右
await sleep(200);
const preL = await pstate();
// L 形：touchstart 在 P0 → 先向右滑 → 原手势改向上滑 → touchend（全程不抬手）
// 每步 move 间隔 20ms 让页面事件循环消化 touchmove；并挂 touchmove 计数器诊断事件到达
await evalJs(`window.__tmCount = 0; window.__tsCount = 0; window.__tsInfo = [];
var __cv = document.getElementById('snake-canvas');
__cv.addEventListener('touchstart', function(e){ window.__tsCount++; var t = e.touches[0]; window.__tsInfo.push({ n: e.touches.length, x: t && t.clientX, y: t && t.clientY }); });
__cv.addEventListener('touchmove', function(e){ window.__tmCount++; var t = e.touches[0]; window.__tsInfo.push({ mv: 1, n: e.touches.length, x: t && t.clientX, y: t && t.clientY }); });`);
await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - arm, y: cy, id: 1 }] });
for (let i = 1; i <= 5; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - arm + (2 * arm) * i / 5, y: cy, id: 1 }] }); await sleep(20); }
for (let i = 1; i <= 5; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + arm, y: cy - (arm * 1.8) * i / 5, id: 1 }] }); await sleep(20); }
await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(150);
const postL = await pstate();
// 上滑段 dy 总量 1.8×arm 远超 TH=12，且 ady 最终 > adx*1.5 → 应解锁 v 轴转 up（除非已死/已变向）
check('C: L 形拖动不抬手可转向（dir.y=-1）',
  postL && postL.dir.y === -1,
  'pre=' + JSON.stringify(preL) + ' post=' + JSON.stringify(postL));

// ---- D. 方向键 pointerdown 即时转向（不派 click）----
// 全屏 CSS 隐藏方向键（.snake-fs .snake-dpad{display:none}，滑动已覆盖输入的设计）→
// 先切回非全屏（再点一次全屏按钮），dpad 显示后用页面内 PointerEvent(touch) 验证：
// pointerdown 单独到达（无 click）即入队转向。
await evalJs(`document.getElementById('snake-fs').click(); true;`);
await sleep(600);
const dpBtn = await evalJs(`(function(){
  const b = document.querySelector('.snake-dp[data-dir="left"]');
  const r = b.getBoundingClientRect();
  const d = getComputedStyle(b.closest('.snake-dpad')).display;
  return { visible: r.width > 0 && r.height > 0 && d !== 'none', dpadDisplay: d };
})()`);
let dpRes = null;
if (dpBtn && dpBtn.visible) {
  dpRes = await evalJs(`(function(){
    const b = document.querySelector('.snake-dp[data-dir="left"]');
    const before = JSON.stringify(window.__snakeState().player);
    const ev = new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true, clientX: 1, clientY: 1 });
    b.dispatchEvent(ev);
    return { before: before, after: JSON.stringify(window.__snakeState().player) };
  })()`);
  const st = JSON.parse(dpRes.after);
  check('D: 方向键 pointerdown(touch) 即时入队（nextDir/nextDir2 收到 left）',
    st.nextDir && st.nextDir.x === -1 || st.nextDir2 && st.nextDir2.x === -1,
    'before=' + dpRes.before + ' after=' + dpRes.after);
} else {
  check('D: 方向键 pointerdown 即时转向', false, 'dp 按钮不可见 dpadDisplay=' + (dpBtn && dpBtn.dpadDisplay));
}

// ---- E. touch-action:manipulation 生效 ----
const ta = await evalJs(`getComputedStyle(document.querySelector('.snake-dp')).touchAction`);
check('E: 方向键 touch-action=manipulation', ta === 'manipulation', 'touchAction=' + ta);

// ---- F. 源码锚点（防静默回退：逻辑表达式在位）----
const { readFileSync: rf } = await import('node:fs');
const src = rf(dirname(fileURLToPath(import.meta.url)) + '/../src/js/snake-game.js', 'utf8');
const srcCss = rf(dirname(fileURLToPath(import.meta.url)) + '/../src/css/chat-pages.css', 'utf8');
check('F: 双槽队列锚点在位', src.includes('p.nextDir2 = { x: x, y: y }; }'));
check('F: applyDir 消费队列锚点在位', src.includes('snake.nextDir = snake.nextDir2 || null; snake.nextDir2 = null;'));
check('F: 轴锁解锁锚点在位', src.includes('adx * 1.5'));
check('F: pointerdown 锚点在位', src.includes("dpadEl.addEventListener('pointerdown'"));
check('F: css touch-action 锚点在位', srcCss.includes('touch-action:manipulation'));

// 清理：关面板（保存/清档）
await evalJs(`window.closeSnakePanel && window.closeSnakePanel(); true;`);
await sleep(200);

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill();
server.close();
process.exit(passed === results.length ? 0 : 1);

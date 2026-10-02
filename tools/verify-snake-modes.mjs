// verify-snake-modes.mjs — 贪吃蛇三模式（经典/双人对战/双人组队）+ 食物数量可选 行为验证
// 用法：node tools/verify-snake-modes.mjs [页面.html]（默认 index.html，需先构建）
// 断言：模式选择器三选项在位；duo 对面=AI；pvp 对面=P2 且 WASD 可控；coop 有 P2 蛇且 WASD 可控；
//       食物数量选择器调整后开局 foods 数量一致；零 JS 报错。
import { spawn } from 'node:child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { statSync } from 'node:fs';

const pageArg = process.argv[2] || 'index.html';
const pagePath = path.resolve(pageArg);
if (!statSync(pagePath).isFile()) { console.error('找不到页面：' + pagePath); process.exit(1); }
const root = path.dirname(pagePath);

const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
];
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const cdpPort = 9400 + Math.floor(Math.random() * 400);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); } });
}).listen(0);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-snake-mode-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

function join(a, b) { return a.replace(/[\\/]+$/, '') + path.sep + b; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let ws = null;
const pend = {};
let mid = 0;
function cdp(method, params) {
  return new Promise((res) => { const i = ++mid; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result ? r.result.value : undefined;
}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : '')); }

let list = [];
for (let i = 0; i < 30; i++) {
  try { list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); if (list.some(t => t.type === 'page')) break; } catch (e) {}
  await sleep(300);
}
const tgt = list.find(t => t.type === 'page' && t.url === 'about:blank') || list.find(t => t.type === 'page');
ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) { pend[m.id](m.result); delete pend[m.id]; } };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/index.html' });
let ready = false;
for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) { ready = true; break; } await sleep(200); }
check('页面加载就绪', ready);

const errors = [];
// 收集未捕获错误：注入 error 钩子
await evalJs(`window.addEventListener('error', function (e) { (window.__jsErrs = window.__jsErrs || []).push(String(e.message)); }); true;`);

// ---- 1. 模式选择器在位且三选项 ----
const modeInfo = await evalJs(`(function(){
  const s = document.getElementById('snake-mode'); if (!s) return null;
  return { opts: [...s.options].map(o => o.value), v: s.value };
})()`);
check('M1 模式选择器在位', !!modeInfo, JSON.stringify(modeInfo));
check('M2 三选项 duo/pvp/coop', modeInfo && modeInfo.opts.join(',') === 'duo,pvp,coop', modeInfo && modeInfo.opts.join(','));

// ---- 2. duo：对面是 AI ----
await evalJs(`window.openSnakePanel(); document.getElementById('snake-mode').value='duo'; document.getElementById('snake-mode').dispatchEvent(new Event('change')); document.getElementById('snake-start').click(); true;`);
await sleep(2600);
const duo = await evalJs(`(function(){ const s = window.__snakeState(); return { status: s.status, ctrl: s.opp.ctrl, hasP2: !!s.p2 }; })()`);
check('M3 duo 对面=AI 且无 P2', duo && duo.status === 'playing' && duo.ctrl === 'ai' && !duo.hasP2, JSON.stringify(duo));
await evalJs(`window.closeSnakePanel(); true;`);
await sleep(300);

// ---- 3. pvp：对面=P2，WASD 控 P2、方向键控 P1 ----
await evalJs(`window.openSnakePanel(); document.getElementById('snake-mode').value='pvp'; document.getElementById('snake-mode').dispatchEvent(new Event('change')); document.getElementById('snake-start').click(); true;`);
await sleep(2600);
let st = await evalJs(`window.__snakeState()`);
check('M4 pvp 对面=P2', st && st.status === 'playing' && st.opp.ctrl === 'p2', st && ('ctrl=' + st.opp.ctrl + ' st=' + st.status));
// P1 方向键：向下
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
await sleep(120);
const p1 = await evalJs(`(function(){ const s = window.__snakeState(); return s.player.dir.y === 1 || (s.player.nextDir && s.player.nextDir.y === 1); })()`);
check('M5 pvp 方向键控 P1', p1 === true);
// P2 WASD：s=向下（P1 已朝下，P2 初始朝左，按 w 应朝上）
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
await sleep(120);
const p2 = await evalJs(`(function(){ const s = window.__snakeState(); return { d: s.opp.dir, n: s.opp.nextDir, st: s.status }; })()`);
check('M6 pvp WASD 控 P2', p2 && (p2.d.y === -1 || (p2.n && p2.n.y === -1)), JSON.stringify(p2));
await evalJs(`window.closeSnakePanel(); true;`);
await sleep(300);

// ---- 4. coop：有 P2 蛇、对面=AI，WASD 控 P2 ----
await evalJs(`window.openSnakePanel(); document.getElementById('snake-mode').value='coop'; document.getElementById('snake-mode').dispatchEvent(new Event('change')); document.getElementById('snake-start').click(); true;`);
await sleep(2600);
st = await evalJs(`window.__snakeState()`);
check('M7 coop 有 P2 蛇且对面=AI', st && st.status === 'playing' && st.opp.ctrl === 'ai' && st.p2 && st.p2.body.length >= 3, st && JSON.stringify({ ctrl: st.opp.ctrl, p2: !!st.p2, st: st.status }));
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
await sleep(120);
const p2c = await evalJs(`(function(){ const s = window.__snakeState(); return { d: s.p2 ? s.p2.dir : null, n: s.p2 ? s.p2.nextDir : null, st: s.status }; })()`);
check('M8 coop WASD 控 P2', p2c && p2c.d && (p2c.d.y === -1 || (p2c.n && p2c.n.y === -1)), JSON.stringify(p2c));
await evalJs(`window.closeSnakePanel(); true;`);
await sleep(300);

// ---- 5. 食物数量：调到 8 后开局 foods=8 ----
await evalJs(`window.openSnakePanel(); document.getElementById('snake-food').value='8'; document.getElementById('snake-food').dispatchEvent(new Event('change')); document.getElementById('snake-mode').value='duo'; document.getElementById('snake-mode').dispatchEvent(new Event('change')); document.getElementById('snake-start').click(); true;`);
await sleep(2600);
st = await evalJs(`window.__snakeState()`);
check('M9 食物×8 开局同屏 8 份', st && st.foods.length === 8, st && ('foods=' + st.foods.length));
await evalJs(`window.closeSnakePanel(); true;`);

// ---- 6. 零 JS 报错 ----
const errs = await evalJs(`window.__jsErrs || []`);
check('M10 全程零 JS 报错', errs.length === 0, errs.join(' | ').slice(0, 200));

chrome.kill(); server.close();
const pass = results.filter(r => r.ok).length;
const fail = results.length - pass;
console.log('\nverify-snake-modes: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

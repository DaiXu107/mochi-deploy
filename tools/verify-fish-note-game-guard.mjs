// ===== 回归 #604（第 1 报）：玩游戏时仍会飘出「摸鱼抓包」浮字、挡住操作 =====
// 用户原话：「为什么玩游戏的时候还会触发联系人模鱼抓包弹窗，挡住我玩游戏」。
//
// 根因：p2-features.js 的摸鱼浮字巡检（chk，60s 一次 + 进页 5s 一次）只看
//   `document.hidden` 与摸鱼值上涨，从不问「现在是不是在玩游戏」——而这条浮字是
//   限时可点的「点我抓包」（.ta-chime-note.grab：pointer-events:auto、fixed 居中偏下
//   bottom:22%），正好盖在棋盘与方向键上抢点按；配合 #352 的 6s 展示时长，玩游戏时
//   被它截走点击＝用户说的「挡住我玩游戏」。零机型分支（任何机型浏览器同样触发）。
//
// 修复：chk 在 taChimeAllow/taChimeUse 之前加 `if (gamePanelOpen()) return;`——
//   任一游戏面板/游乐室页可见时跳过（零渲染盒残留不算），且跳过时不吃 45 分钟冷却
//   与每日 12 次额度（lastTa 不推进，出游戏后这次涨值照样能飘）。
//
// 用法：node tools/verify-fish-note-game-guard.mjs
//   SERVE_DIR=<构建目录>  默认仓库根（跑根目录 index.html 产物）
//   SRC_DIR=<源码目录>    默认仓库根 src（静态锚点用；RED 基线时指旧源码）
//
// 测试加速说明（只动测试侧，不改产品代码）：用 CDP addScriptToEvaluateOnNewDocument
//   把「60000ms 的 setInterval」压缩到 250ms（摸鱼巡检），并把 Math.random 固定为 0
//   （让 dcf-fish 的 35% 必中），从而在几秒内确定性地跑到巡检分支。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_DIR || here);
const srcRoot = normalize(process.env.SRC_DIR || join(here, 'src'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, extra) { results.push({ desc, ok: !!ok }); console.log((ok ? '✅' : '❌') + ' ' + desc + (extra ? '  [' + extra + ']' : '')); }

// ---------- S 组：源码逻辑锚点 ----------
let src = '';
try { src = readFileSync(join(srcRoot, 'js', 'p2-features.js'), 'utf8'); } catch (e) {}
const guardIdx = src.indexOf('if (gamePanelOpen()) return;');
const useIdx = src.indexOf("taChimeUse('fish-ta-note')");
check('S1 摸鱼巡检带「游戏开着就跳过」闸门（gamePanelOpen 守卫在位）', guardIdx >= 0);
check('S2 闸门必须排在 taChimeUse 之前（否则冷却被吃掉，出游戏也不再飘）', guardIdx >= 0 && useIdx >= 0 && guardIdx < useIdx, 'guard@' + guardIdx + ' use@' + useIdx);
check('S3 游戏面板清单含贪吃蛇与游乐室页', src.includes("'chat-snake-panel'") && src.includes("'page-arcade'"));

// ---------- 无头浏览器 ----------
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 100));
const profile = join(process.env.TEMP || '/tmp', 'mochi-fish-guard-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => { for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); } };

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 测试加速 + 确定性（只作用于本次会话的页面，不碰产品代码）
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){
    var _si = window.setInterval;
    window.setInterval = function (fn, ms) {
      if (ms === 60000) return _si(fn, 250);   // 摸鱼巡检 60s → 250ms
      return _si.apply(window, arguments);
    };
    Math.random = function () { return 0; };    // 35% 概率必中（确定性地走到浮字分支）
  })();`
});
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await waitReady(); await sleep(1500);

// 浮字展示计数（包装 window.taChimeShow；chk 走的是运行时全局查找，包装生效）
await evalJs(`(function(){
  window.__chimeN = 0;
  var orig = window.taChimeShow;
  window.taChimeShow = function (t, o) { window.__chimeN++; return orig(t, o); };
  return 1;
})()`);

const storeEval = (body) => evalJs(`(function(){ var s = window.activeStore && window.activeStore(); if (!s) return null; ${body} })()`);
async function clearChimeKeys() {
  return storeEval(`try { s.remove('ta-chime:fish-ta-note:last'); s.remove('ta-chime:fish-ta-note:day'); } catch (e) {} return 1;`);
}
async function bumpFish() {
  return storeEval(`var v = parseInt(s.get('fish-total-ta') || '0', 10) || 0; s.set('fish-total-ta', '' + (v + 3)); return v + 3;`);
}
const chimeLast = () => storeEval(`return s.get('ta-chime:fish-ta-note:last') || '';`);

// 等巡检把 lastTa 初始化（首跑 setTimeout(chk, 5000) 把当前值记为基线）
await sleep(6000);

// ---- A：游戏开着时，摸鱼值上涨不得飘浮字、也不得吃掉冷却 ----
await evalJs('window.enterChat && window.enterChat(); 1');
await sleep(400);
await evalJs('window.openSnakePanel && window.openSnakePanel(); 1');
await sleep(600);
const gameOpen = await evalJs(`(function(){ var p = document.getElementById('chat-snake-panel'); return !!(p && !p.hidden && p.getClientRects().length); })()`);
check('A0 前置：贪吃蛇面板已打开（真实可见）', gameOpen === true, 'open=' + gameOpen);
// 计数只增不减：巡检是 250ms 一次（压缩后），重置计数会把窗口内刚发生的展示抹掉，
// 故一律用「窗口前后计数不变/增加」判定，不重置。
const nA0 = await evalJs('window.__chimeN');
await clearChimeKeys();
await bumpFish();
await sleep(2000);   // 压缩后 ≈8 次巡检
const nA1 = await evalJs('window.__chimeN');
const lastAfterGame = await chimeLast();
check('A1 游戏开着：摸鱼浮字不飘出来（挡住操作的根因已闸住）', nA1 === nA0, 'chimeN ' + nA0 + '→' + nA1);
check('A2 游戏开着：不消耗 45 分钟冷却（出游戏后还能飘）', !lastAfterGame, 'last=' + lastAfterGame);

// ---- B：关掉游戏后，同一次涨值仍应正常飘出来 ----
await evalJs('window.closeSnakePanel && window.closeSnakePanel(); 1');
await sleep(500);
const gameClosed = await evalJs(`(function(){ var p = document.getElementById('chat-snake-panel'); return !!(p && !p.hidden && p.getClientRects().length); })()`);
check('B0 前置：面板已关闭', gameClosed === false, 'open=' + gameClosed);
const nB0 = await evalJs('window.__chimeN');
await clearChimeKeys();   // 清掉可能存在的冷却，保证这一窗口内必定能飘
await bumpFish();
await sleep(2000);
const nFree = await evalJs('window.__chimeN');
const lastFree = await chimeLast();
check('B1 无游戏时：摸鱼浮字照旧飘出来（原行为不变）', nFree > nB0, 'chimeN ' + nB0 + '→' + nFree);
check('B2 无游戏时：冷却正常记账', !!lastFree, 'last=' + lastFree);

// ---- C：全屏态的贪吃蛇（手机默认形态）同样不飘 ----
await evalJs('window.openSnakePanel && window.openSnakePanel(); 1');
await sleep(600);
const fsOn = await evalJs(`document.getElementById('chat-snake-panel').classList.contains('snake-fs')`);
const nC0 = await evalJs('window.__chimeN');
await clearChimeKeys();
await bumpFish();
await sleep(2000);
const nFs = await evalJs('window.__chimeN');
check('C1 贪吃蛇全屏态（' + (fsOn ? '已全屏' : '非全屏') + '）：同样不飘浮字', nFs === nC0, 'chimeN ' + nC0 + '→' + nFs);
await evalJs('window.closeSnakePanel && window.closeSnakePanel(); 1');

chrome.kill(); server.close();
const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过' + (passed === results.length ? '  ALL PASS' : ''));
process.exit(passed === results.length ? 0 : 1);

// verify-suite:timeout=300000
// FIX 2026-09-19 #846 行为回归：手机端「消息发出去之后屏幕闪一下」（红米 K80 Chrome 实报，用户点名勿做机型分支）
// 根因（无头 Chrome 实证，零机型分支）：历史超过 WINDOW_MAX(400) 的桌面，进页/上翻会把屏上窗口撑到 400 条
// （renderStart>0）；此后每发一条消息都命中 addRec 的「窗口超限钳位」分支＝renderWindow(false,true,true)
// 整窗重建——body.innerHTML='' 删掉屏上 400 个节点、同步重造最新 200 个气泡，img/头像全部重建重新解码
// （实测单批 removedNodes=400、rmImg=66、scrollTop 26086→12686）＝肉眼整屏闪一下。历史 ≤400 条的桌面
// renderStart=0 从不命中＝"偶尔闪/别的机型不闪"的假象来源（与 #211/#508/#230 同族）。
// 修法：钳位改 trimWindowTopQuiet(RENDER_MAX) 静默裁顶＝只删视口以上的节点＋按删掉高度补偿 scrollTop，
// 新消息与常规收发一样走 renderMsg 增量追加（DOM 上限与 #211 口径不变）。
// 断言（390×844 移动视口 + 4x CPU 节流，跑真实产物 index.html）：
//  A0 前置：上翻把屏上窗口撑到 WINDOW_MAX(400)＝钳位分支确已上膛（防 A1/A2 因分支没命中而假绿）
//  A1 窗口满载后发送：单次 DOM 批量删除 ≤4 个节点（整窗重建＝400 个节点一批全清）
//  A2 同场景：屏上最后 20 个气泡节点发送后仍是同一批对象（可见区零重建＝图片/头像零重解码）
//  A3 同场景：新消息已落屏且画面贴底（每 100ms 采样取最好一帧；打字行高度已扣减——发送后紧跟来的
//     TA 提问卡只会把「最后一帧」推离底部 10px，单次终帧读数会偶发假红）、屏上条数回收到 RENDER_MAX
//     量级、零 JS 异常
//  A4 短历史（120 条）常规发送：纯增量（删除 0 节点、只追加），不回归
//  S1~S3 产物锚点：静默裁顶调用在位、scrollTop 高度补偿在位、整窗重建调用式不再出现
// 判别力实测（2026-09-19，绿＝HEAD(7a71470)＋仅 #846 仓外隔离副本、连跑两遍；红＝纯 HEAD 副本）：
//   绿 8/8·exit 0；红 3/8＝恰红 A1（removedNodes=400、rm=422/add=222）＋A2（20 个可见气泡存活 0 个
//   ＝整屏节点全换新）＋S1~S3，其余 3 条为夹具前提与产物无关的断言。
// 用法：node tools/verify-chat-send-window-trim.mjs [产物目录，默认仓库根]
//   红基线：node tools/verify-chat-send-window-trim.mjs ../mochi-846red
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9880 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-846-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank',
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }

function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('return !!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(500);
}
// N 条历史（每 9 条一张真尺寸图片＝重建时必然重建 img 并重解码）
async function seed(N) {
  return evalJs(`
    var P = window.activePrefix();
    var cv = document.createElement('canvas'); cv.width = 600; cv.height = 400;
    var g = cv.getContext('2d'); g.fillStyle = '#8ab'; g.fillRect(0,0,600,400);
    var src = cv.toDataURL('image/png');
    var now = Date.now(), full = [];
    for (var i = 0; i < ${N}; i++) {
      var ts = now - (${N} - i) * 60000;
      if (i % 9 === 0) full.push({ side: i % 2 ? 'in' : 'out', type: 'image', text: '图片', img: src, ts: ts });
      else full.push({ side: i % 2 ? 'in' : 'out', text: (i % 2 ? '对方消息' : '我的消息') + i, ts: ts });
    }
    await window.idbSet(P + ':chat-msgs', JSON.stringify(full));
    await window.idbSet(P + ':chat-meta', JSON.stringify({ n: full.length, t: Date.now() }));
    var tail = full.slice(-30).map(function (m) { var c = Object.assign({}, m); if (c.img) { c.img = ''; c._lsLite = 1; } return c; });
    localStorage.setItem(P + ':chat-msgs', JSON.stringify(tail));
    return 'seeded ${N}';
  `);
}
const ENTER = "document.querySelector('.app[data-app=\"chat\"]').click(); return true;";
// 上翻一轮（滚动处理有 100ms 防抖＋200ms 程序化滚动抑制，必须分轮跑）
const SCROLL_UP_ONE = `
  var b = document.getElementById('chat-body');
  b.scrollTop = 0; b.dispatchEvent(new Event('scroll', { bubbles: true }));
  return b.querySelectorAll('[data-idx]').length;
`;
const WND_N = "return document.getElementById('chat-body').querySelectorAll('[data-idx]').length;";
// 发送 + 观察：单次批量删除上限、可见尾部气泡节点身份存活数、贴底离距、屏上条数
const SEND_OBS = `
  var b = document.getElementById('chat-body');
  var all = b.querySelectorAll('[data-idx]');
  var mark = [];
  for (var i = Math.max(0, all.length - 20); i < all.length; i++) { all[i].__keep846 = 1; mark.push(all[i]); }
  var maxBatch = 0, rm = 0, added = 0;
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      rm += m.removedNodes.length; added += m.addedNodes.length;
      if (m.removedNodes.length > maxBatch) maxBatch = m.removedNodes.length;
    });
  }).observe(b, { childList: true, subtree: true });
  var input = document.getElementById('chat-input'), send = document.getElementById('chat-send');
  input.focus();
  input.textContent = '#846 判别发送 ' + Date.now();
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 150); });
  send.click();
  var gapBest = 1e9;
  for (var k = 0; k < 12; k++) {
    await new Promise(function (r) { setTimeout(r, 100); });
    var t2 = document.getElementById('chat-typing');
    var g2 = b.scrollHeight - b.scrollTop - b.clientHeight - (t2 && !t2.hidden ? t2.offsetHeight : 0);
    if (Math.abs(g2) < Math.abs(gapBest)) gapBest = g2;
  }
  var alive = 0;
  mark.forEach(function (n) { if (n.isConnected && n.__keep846 === 1) alive++; });
  var ty = document.getElementById('chat-typing');
  var gap = b.scrollHeight - b.scrollTop - b.clientHeight - (ty && !ty.hidden ? ty.offsetHeight : 0);
  var txt = b.textContent || '';
  return { maxBatch: maxBatch, rm: rm, added: added, alive: alive, marked: mark.length,
    kids: b.children.length, gap: Math.round(gap), gapBest: Math.round(gapBest),
    hasNew: txt.indexOf('判别发送') >= 0,
    tailTxt: txt.slice(-60), jsErr: (window.__jsErrors || []).length };
`;

console.log('#846 发送时窗口钳位不整窗重建（产物目录：' + root + '）');
// 把屏上窗口撑到 WINDOW_MAX（=pruneWindowTop 生效态）＝发送时钳位分支上膛
async function fillWindow() {
  let n = await evalJs(WND_N);
  for (let i = 0; i < 30 && !(n >= 400); i++) {
    await evalJs(SCROLL_UP_ONE);
    await sleep(420);
    n = await evalJs(WND_N);
  }
  return n;
}
// ---- A1/A2/A3：长历史 + 窗口撑到上限 + 发送 ----
await openPage();
await seed(600);
await openPage();
await evalJs(ENTER);
await sleep(3000);
const wndN = await fillWindow();
ok('A0 前置：屏上窗口已被钳到 WINDOW_MAX（钳位分支确已上膛，否则 A1/A2 会假绿）', wndN >= 400, '窗口条数=' + wndN);
const r1 = await evalJs(SEND_OBS);
ok('A1 窗口满载后发送：无整批清空（单次批量删除 ≤4 节点）', r1 && r1.maxBatch <= 4, JSON.stringify(r1) + ' 窗口条数=' + wndN);
ok('A2 屏上可见尾部 20 个气泡发送后节点身份全部存活（零重建零重解码）', r1 && r1.alive === r1.marked, JSON.stringify(r1));
ok('A3 新消息已落屏、画面贴底、条数回收到 RENDER_MAX 量级', r1 && r1.hasNew && Math.abs(r1.gapBest) <= 8 && r1.kids <= 230 && r1.jsErr === 0, JSON.stringify(r1));

// ---- A4：短历史常规发送仍是纯增量（不回归） ----
await openPage();
await seed(120);
await openPage();
await evalJs(ENTER);
await sleep(3000);
const r2 = await evalJs(SEND_OBS);
ok('A4 短历史常规发送：纯增量（删除 0 节点）且新消息可见', r2 && r2.rm === 0 && r2.hasNew && r2.alive === r2.marked, JSON.stringify(r2));

// ---- S 组：产物锚点 ----
let art = '';
try { art = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { console.error('产物缺失：' + join(root, 'index.html')); process.exit(2); }
ok('S1 钳位走静默裁顶调用', art.includes('trimWindowTopQuiet(RENDER_MAX);'));
ok('S2 裁顶后按删掉高度补偿 scrollTop', art.includes('body.scrollTop = Math.max(0, body.scrollTop - cut)'));
ok('S3 发送路径不再整窗重建（forceSync 调用式已下线）', !art.includes('renderWindow(false, true, true)'));

chrome.kill(); server.close();
console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

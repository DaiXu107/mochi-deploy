// ===== 回归：通话小框（#call-mini）拖动后不可消失/飞向视口外 =====
// 复现用户反馈：「通话的小框拖动后会莫名其妙消失」，且多机型（含不同浏览器内核）
//   时有时无。旧实现把屏幕坐标系结果直接塞进 style.left/top，只在「元素坐标空间==
//   可视视口」时成立；一旦祖先带 transform（fixed 退化成绑定该祖先）、或宽视口下
//   position 落到 .phone 内，坐标空间错位把小框甩到视口外 = “拖完消失”。
// 修复（call.js v3.33.x）：按手指位移增量驱动，用 getBoundingClientRect 把目标屏幕位
//   精确换算回元素自身坐标空间，对 fixed/absolute/带 transform 祖先一律成立；目标位
//   钳制在可视视口内，拖拽上边界仍抬到系统状态栏下方（miniSafeTop，#114 保留）。
// 用例（多视口：手机 390x844 / 手机 360x640 / 桌面 1200x900）：
//   A. 接通 → 小框显示，hidden=false 且 rect 在视口内
//   B. 多方向拖动（左上/右下/下/右）→ 始终 visible=true、rect 各边不越视口
//   C. 拖动过程小框从未被设置 hidden（hiddenTrace 为空）
//   D. inline 在首次移动后已清除 bottom、transform（进入拖动态，不拉伸/不残留动画位移）
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mini-drag-' + Date.now()),
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
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

async function drag(elExpr, dx, dy) {
  return evalJs(`(async function(){
    const el = ${elExpr};
    const dx = ${dx}, dy = ${dy};
    if(!el) return null;
    if(!el.__trace) {
      window.__miniTrace = window.__miniTrace || [];
      try { Object.defineProperty(el, 'hidden', { configurable:true, get(){return this._h;}, set(v){ this._h=v; if(v) window.__miniTrace.push(1); } }); } catch(e){}
      el._h = el.hidden;
      el.__trace = 1;
    }
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    el.dispatchEvent(new PointerEvent('pointerdown', {clientX:cx, clientY:cy, bubbles:true, pointerId:1, isPrimary:true}));
    const n = 6;
    for(let i=1;i<=n;i++){
      el.dispatchEvent(new PointerEvent('pointermove', {clientX:cx + dx*i/n, clientY:cy + dy*i/n, bubbles:true, pointerId:1, isPrimary:true}));
      await new Promise(res=>requestAnimationFrame(res));
    }
    el.dispatchEvent(new PointerEvent('pointerup', {clientX:cx+dx, clientY:cy+dy, bubbles:true, pointerId:1, isPrimary:true}));
    await new Promise(res=>setTimeout(res,50));
    const rr = el.getBoundingClientRect();
    return {
      hidden: el.hidden,
      hiddenTraced: (window.__miniTrace||[]).length > 0,
      bottom: el.style.bottom, transform: el.style.transform,
      vw: innerWidth, vh: innerHeight,
      rect:{ l:rr.left, t:rr.top, r:rr.right, b:rr.bottom }
    };
  })()`);
}

const waitReady = async () => { for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); } };
const inViewport = (o, mar) => o.rect.l >= -mar && o.rect.t >= -mar && o.rect.r <= o.vw + mar && o.rect.b <= o.vh + mar;

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

async function run(size, label) {
  const { width, height, mobile } = size;
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await cdp('Page.navigate', { url: baseUrl + '/index.html?t=' + Date.now() });
  await waitReady();
  await sleep(1500);
  await evalJs(`window.activeStore().set('call-mini-enabled','1'); window.triggerIncomingCall(); true;`);
  await sleep(600);
  await evalJs(`document.getElementById('call-answer-btn').click(); true;`);
  await sleep(2600);

  console.log('[' + label + ']');
  const b = await evalJs(`(function(){const el=document.getElementById('call-mini');if(!el)return null;const r=el.getBoundingClientRect();return {hidden:el.hidden,rect:{l:r.left,t:r.top,r:r.right,b:r.bottom}};})()`);
  if (!b) { ok(false, '小框存在'); return; }
  ok(!b.hidden && b.rect.l >= 0 && b.rect.t >= 0 && b.rect.r <= width && b.rect.b <= height,
    '接通后小框显示且在视口内 (A)');

  const r1 = await drag(`document.getElementById('call-mini')`, -120, -300);
  const r2 = await drag(`document.getElementById('call-mini')`, 20, 100);
  const r3 = await drag(`document.getElementById('call-mini')`, 0, 400);
  const moves = [['左上', r1], ['右下', r2], ['下', r3]];
  if (!mobile) moves.push(['右', await drag(`document.getElementById('call-mini')`, 900, 0)]);
  for (const [name, o] of moves) {
    ok(o && !o.hidden, name + ' 拖动后未隐藏 (B/C)');
    ok(o && inViewport(o, 0.5), name + ' 拖动后仍在视口内 (B)');
  }
  ok(r2 && r2.bottom === 'auto' && r2.transform === 'none', '拖动态已清 bottom+transform (D)');
  await evalJs(`window.hangupCall(); true;`);
  await sleep(300);
}

try {
  await run({ width: 390, height: 844, mobile: true }, '手机 390x844');
  await run({ width: 360, height: 640, mobile: true }, '手机 360x640');
  await run({ width: 1200, height: 900, mobile: false }, '桌面 1200x900');
} finally {
  chrome.kill();
  server.close();
}
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
// ===== 恢复默认桌面后第三页「经期」小组件消失 验证 =====
// 根因：reset 原 remove('desk-page-count') → buildDeskPages 按默认 2 页收缩，
//       静态第三页整页删除，desk-period 与 p3apps 进隐藏池；ensureP3 只找回
//       p3apps，desk-period 留在池里不再显示。
// 修复：reset 改为恢复 desk-page-count='3'（第三页未被删时组件原样保留）+
//       ensureP3 后把池里的 desk-period 找回第三页（覆盖第三页此前已被删的场景）。
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-desk-reset-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
// 点「恢复默认桌面」行并确认弹窗
async function clickReset() {
  return evalJs(`(function () {
    var row = document.getElementById('row-desk-reset');
    if (!row) return 'no-row';
    row.click();
    setTimeout(function () {
      var pills = document.getElementById('modal-pills');
      var pill = pills && !pills.hidden ? pills.querySelector('.pill') : null;
      if (pill) pill.click();
      var ok = document.getElementById('modal-ok');
      if (ok) ok.click();
    }, 120);
    return 'clicked';
  })()`);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const dpState = `(() => {
  var n = document.querySelector('[data-desk-widget="desk-period"]');
  if (!n) return { exists: false };
  var inPool = !!n.closest('#desk-widget-pool');
  var slide = n.closest('.page-slide');
  var idx = slide ? Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'), slide) : -1;
  var p3 = document.querySelector('[data-desk-widget="p3apps"]');
  var p3Slide = p3 ? p3.closest('.page-slide') : null;
  var p3Idx = p3Slide ? Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'), p3Slide) : -1;
  var orderOk = false;
  if (slide && p3Slide === slide) {
    var kids = Array.prototype.slice.call(slide.children).filter(function (c) { return c.hasAttribute('data-desk-widget'); });
    // v3.13.x：今日备忘/心情行(memo-row)移到第三页经期卡下方 → 新默认顺序 dp < memo-row < p3apps
    var mr = slide.querySelector('[data-desk-widget="memo-row"]');
    orderOk = kids.length > 2 && kids[0] === n && mr && kids[1] === mr && kids[2] === p3;
  }
  return { exists: true, inPool: inPool, pageIdx: idx, p3Idx: p3Idx, beforeP3: orderOk,
    count: localStorage.getItem('xy-home-v2:default:desk-page-count') };
})()`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 第 1 次加载：种子数据（默认 3 页桌面）----
await gotoApp();
await evalJs(`(function () {
  localStorage.setItem('xy-home-v2:default:desk-page-count', '3');
  localStorage.removeItem('xy-home-v2:default:desk-layout');
  return 'seeded';
})()`);

// ---- 第 2 次加载：正常三页桌面（基线：经期组件在第三页）→ 点恢复默认 ----
await gotoApp();
var base = await evalJs(dpState);
check('基线: 经期组件存在于第三页(未进隐藏池)', base.exists && !base.inPool && base.pageIdx === 2, JSON.stringify(base));

await clickReset();
await sleep(1500);
var after1 = await evalJs(dpState);
check('A1: 恢复默认后经期组件仍在 DOM 且未进隐藏池', after1.exists && !after1.inPool, JSON.stringify(after1));
check('A2: 经期组件位于第三页(page-slide#2)', after1.exists && !after1.inPool && after1.pageIdx === 2, 'pageIdx=' + after1.pageIdx);
check('A3: 经期组件在功能图标组(p3apps)之前(模板默认顺序)', after1.beforeP3, '');
check('A4: p3apps 图标组也在第三页', after1.p3Idx === 2, 'p3Idx=' + after1.p3Idx);
check('A5: desk-page-count 恢复为 3', String(after1.count) === '3', 'count=' + after1.count);
var decoOk = await evalJs(`!!document.querySelector('.page-slide [data-desk-widget="deco"]')`);
check('A6: 第一页核心组件(deco)不受影响', decoOk === true);

// ---- 第 3 次加载：模拟「第三页此前已被删除」——count=2 触发收缩，两组件进池 ----
await evalJs(`localStorage.setItem('xy-home-v2:default:desk-page-count', '2')`);
await gotoApp();
var pooled = await evalJs(`(() => {
  var n = document.querySelector('[data-desk-widget="desk-period"]');
  var p3 = document.querySelector('[data-desk-widget="p3apps"]');
  return { dpInPool: !!(n && n.closest('#desk-widget-pool')), p3InPool: !!(p3 && p3.closest('#desk-widget-pool')) };
})()`);
check('前置: 删页后 desk-period 留在隐藏池(BUG 条件；p3apps 已被 ensureP3 自动找回)', pooled.dpInPool, JSON.stringify(pooled));

await clickReset();
await sleep(1500);
var after2 = await evalJs(dpState);
check('B1: 第三页被删过的场景下恢复默认后经期组件找回', after2.exists && !after2.inPool && after2.pageIdx === 2, JSON.stringify(after2));
check('B2: 该场景下 p3apps 也回到第三页', after2.p3Idx === 2, 'p3Idx=' + after2.p3Idx);

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

// ===== 今日备忘/心情卡移到第三页「经期倒计时」下方 验证 =====
// 需求：桌面第二页的【今日备忘】【今天的心情】卡片（memo-row）默认位置改为
//       第三页经期卡（desk-period）下方、p3apps 图标组之前。
// 覆盖：①模板/产物静态顺序 ②全新用户（无布局）模板默认即在第三页且不误写布局
//       ③老用户 desk-layout 里 memo-row 在第二页 → 自动迁移（DOM+存储同步，
//         其余组件不动）④迁移幂等（二次加载不再改写）⑤用户已手动移除（隐藏池）
//         尊重不找回 ⑥已在第三页的布局原样保留。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- T0 静态断言：src 模板与构建产物中 memo-row 位于 desk-period 之后、p3apps 之前 ----
function staticOrder(file) {
  const s = String(readFileSync(join(root, file)));
  const dp = s.indexOf('data-desk-widget="desk-period"');
  const mr = s.indexOf('data-desk-widget="memo-row"');
  const p3 = s.indexOf('data-desk-widget="p3apps"');
  return { dp, mr, p3, ok: dp >= 0 && dp < mr && mr < p3 && s.indexOf('data-card-bg="memo"') > 0 };
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
for (const f of ['src/template.html', 'index.html']) {
  const r = staticOrder(f);
  check(`T0 ${f}: 经期卡 < 备忘心情行 < 第三页图标组`, r.ok, JSON.stringify(r));
}

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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-memo-p3-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  await sleep(1400);
}
const P = 'xy-home-v2:default:';
const memoState = `(() => {
  var n = document.querySelector('[data-desk-widget="memo-row"]');
  if (!n) return { exists: false };
  var slides = document.querySelectorAll('.page-slide');
  var slide = n.closest('.page-slide');
  var idx = slide ? Array.prototype.indexOf.call(slides, slide) : -1;
  var inPool = !!n.closest('#desk-widget-pool');
  var kids = slide ? Array.prototype.slice.call(slide.children).filter(function (c) { return c.hasAttribute('data-desk-widget'); }) : [];
  var ki = kids.indexOf(n);
  return { exists: true, inPool: inPool, idx: idx, totalSlides: slides.length,
    prevW: ki > 0 ? kids[ki - 1].getAttribute('data-desk-widget') : null,
    nextW: ki < kids.length - 1 ? kids[ki + 1].getAttribute('data-desk-widget') : null,
    memoText: (n.querySelector('#memo-text') || {}).textContent || '' };
})()`;
const getLay = `(() => { var v = localStorage.getItem('${P}desk-layout'); return v == null ? null : JSON.parse(v); })()`;
const setLay = (lay) => evalJs(`localStorage.setItem('${P}desk-layout', JSON.stringify(${JSON.stringify(lay)})); localStorage.setItem('${P}desk-page-count', '3'); 'seeded'`);
const LAY_LEGACY = [['deco', 'quote-row', 'checkin', 'apps'], ['p2apps', 'memo-row', 'week', 'weekend'], ['desk-period', 'p3apps']];
const LAY_NOMEMO = [['deco', 'quote-row', 'checkin', 'apps'], ['p2apps', 'week', 'weekend'], ['desk-period', 'p3apps']];
const LAY_ALREADY = [['deco', 'quote-row', 'checkin', 'apps'], ['p2apps', 'week', 'weekend'], ['desk-period', 'memo-row', 'p3apps']];
const EXPECT_MIGRATED = [['deco', 'quote-row', 'checkin', 'apps'], ['p2apps', 'week', 'weekend'], ['desk-period', 'memo-row', 'p3apps']];

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 场景 A：全新用户（count=3、无 desk-layout）→ 模板默认即在第三页经期卡下 ----
await gotoApp();
await evalJs(`localStorage.clear(); localStorage.setItem('${P}desk-page-count', '3'); localStorage.removeItem('${P}desk-layout'); 'seeded'`);
await gotoApp();
var a = await evalJs(memoState);
check('A1: 全新用户备忘心情行在第三页(page-slide#2)', a.exists && !a.inPool && a.idx === 2, JSON.stringify(a));
check('A2: 前一个组件是经期卡(desk-period)', a.prevW === 'desk-period', 'prevW=' + a.prevW);
check('A3: 后一个组件是第三页图标组(p3apps)', a.nextW === 'p3apps', 'nextW=' + a.nextW);
check('A4: 未装修用户不写入 desk-layout(保持模板语义)', (await evalJs(getLay)) === null, '');
check('A5: 卡片内容正常渲染(#memo-text 存在)', typeof a.memoText === 'string' && a.memoText.length > 0, '');

// ---- 场景 B：老用户布局里 memo-row 在第二页 → 自动迁到第三页经期卡下 ----
await setLay(LAY_LEGACY);
await gotoApp();
var b = await evalJs(memoState);
var blay = await evalJs(getLay);
check('B1: 迁移后备忘心情行在第三页经期卡下', b.exists && !b.inPool && b.idx === 2 && b.prevW === 'desk-period' && b.nextW === 'p3apps', JSON.stringify(b));
// 注：同频/伸手/喝水/吃什么/番茄钟/猪猪/市场等动态注入图标会向后追加页条目，故只比对前三页
check('B2: 存储 desk-layout 同步迁移(前三页)', Array.isArray(blay) && JSON.stringify(blay.slice(0, 3)) === JSON.stringify(EXPECT_MIGRATED), JSON.stringify(blay));
check('B3: 第二页其余组件(week/weekend/p2apps)不动', Array.isArray(blay) && blay[1].join(',') === 'p2apps,week,weekend', JSON.stringify(blay && blay[1]));

// ---- 场景 C：再次加载幂等，不再改写 ----
var layAfterB = JSON.stringify(blay);
await gotoApp();
var c = await evalJs(memoState);
var clay = await evalJs(getLay);
check('C1: 二次加载位置不变(幂等)', c.exists && !c.inPool && c.idx === 2 && c.prevW === 'desk-period', JSON.stringify(c));
check('C2: 二次加载布局存储不再变化', JSON.stringify(clay) === layAfterB, '');

// ---- 场景 D：用户已手动移除（布局不含 memo-row=在隐藏池）→ 尊重不找回 ----
await setLay(LAY_NOMEMO);
await gotoApp();
var d = await evalJs(memoState);
var dlay = await evalJs(getLay);
check('D1: 已移除进池的备忘心情行不被强行找回', d.exists && d.inPool, JSON.stringify(d));
check('D2: 该场景布局原样保留(前三页且全表无 memo-row)', Array.isArray(dlay) && JSON.stringify(dlay.slice(0, 3)) === JSON.stringify(LAY_NOMEMO) && !dlay.some(pg => (pg || []).indexOf('memo-row') >= 0), JSON.stringify(dlay));

// ---- 场景 E：已在第三页的布局原样保留 ----
await setLay(LAY_ALREADY);
await gotoApp();
var e = await evalJs(memoState);
var elay = await evalJs(getLay);
check('E1: 已在第三页的位置保持', e.exists && !e.inPool && e.idx === 2 && e.prevW === 'desk-period' && e.nextW === 'p3apps', JSON.stringify(e));
check('E2: 已正确的布局存储保留(前三页逐字一致)', Array.isArray(elay) && JSON.stringify(elay.slice(0, 3)) === JSON.stringify(LAY_ALREADY), '');

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

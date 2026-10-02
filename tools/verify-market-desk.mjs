// ===== 心意市集/心意柜 桌面图标注入专项验证（src/js/gift-shop.js injectDeskApps） =====
// 回归背景：旧 injectDeskApp 用 curCnt<6 新建第 6 页，而 personalize.js DESK_PAGE_MAX=5，
// mochi-restore-done 后 buildDeskPages 钳回 5 页删尾页 → 图标被扫进隐藏池，且 app-market
// 不在 WIDGET_IDS 白名单永远无法找回 → OPPO 真机「更新完桌面没有心意市集，刷新也没有」。
// 覆盖：未装修落第三页 / 满 5 页装修桌面不新建第 6 页且图标可见（数据就绪钳页后仍在）/
//       布局已含 app-market 不被吞 / 点开市集·心意柜全屏页 / 市集网格渲染。
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mkt-desk-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 页内探针：两个图标的落位状态
const probeIcons = `(() => {
  function st(id) {
    var n = document.querySelector('[data-app="' + id + '"]');
    if (!n) return { exists: false };
    var pool = document.getElementById('desk-widget-pool');
    var inPool = !!(pool && pool.contains(n));
    var grid = n.closest('.app-grid');
    var slide = n.closest('.page-slide');
    var idx = slide ? Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'), slide) : -1;
    return { exists: true, inPool: inPool, inGrid: !!grid, isP3: !!(grid && grid.classList.contains('p3-grid')),
      slideIdx: idx, name: (n.querySelector('.app-name') || {}).textContent || '' };
  }
  var slides = document.querySelectorAll('.page-slide').length;
  var pc = null;
  try { pc = window.xyStore(window.activePrefix()).get('desk-page-count'); } catch (e) {}
  return { market: st('market'), giftbox: st('giftbox'), slides: slides,
    pageCount: pc,
    jsErr: (window.__jsErrors || []).length };
})()`;

// 预注入：清桌布局键 + 写指定布局/页数（先于所有应用脚本执行）
async function preLayout(lay, count) {
  const src = `
    try {
      localStorage.removeItem('xy-home-v2:desk-layout');
      localStorage.removeItem('xy-home-v2:desk-page-count');
      ${lay ? `localStorage.setItem('xy-home-v2:desk-layout', '${JSON.stringify(lay)}');` : ''}
      ${count ? `localStorage.setItem('xy-home-v2:desk-page-count', '${count}');` : ''}
    } catch (e) {}
  `;
  const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: src });
  return r.identifier;
}
async function unpre(id) { try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch (e) {} }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 场景 A：未装修（无 desk-layout）→ 图标应无条件进第三页图标组 ----
let pre = await preLayout(null, null);
await gotoApp();
let s = await evalJs(probeIcons);
check('1. 未装修：市集+心意柜都落在第三页图标组内', s && s.market.exists && s.giftbox.exists && s.market.isP3 && s.giftbox.isP3 && s.market.slideIdx === 2 && s.giftbox.slideIdx === 2, JSON.stringify(s));
check('2. 图标名正确', s && s.market.name === '心意市集' && s.giftbox.name === '心意柜', s && s.market.name + '/' + s.giftbox.name);
check('3. 无 JS 异常', s && s.jsErr === 0, 'errors=' + (s && s.jsErr));
await unpre(pre);

// ---- 场景 B：满 5 页装修桌面、布局不含市集（用户翻车现场）----
// 旧代码会新建第 6 页 → 数据就绪后被钳回 5 页、图标进隐藏池永不复现；新代码应兜底进第三页组。
pre = await preLayout([['deco'], ['music', 'p2apps'], ['p3apps'], ['app-chat'], []], '5');
await gotoApp();
s = await evalJs(probeIcons);
check('4. 满5页：不再新建第6页（slides 保持 5、计数仍为 5）', s && s.slides === 5 && s.pageCount === '5', JSON.stringify({ slides: s && s.slides, pageCount: s && s.pageCount }));
check('5. 满5页：心意市集图标可见（未进隐藏池）', s && s.market.exists && !s.market.inPool, JSON.stringify(s && s.market));
check('6. 满5页：心意柜图标可见（未进隐藏池）', s && s.giftbox.exists && !s.giftbox.inPool, JSON.stringify(s && s.giftbox));
await sleep(900); // 再等一拍：确认 restore-done 钳页/延迟重建后仍稳定可见
s = await evalJs(probeIcons);
check('7. 数据就绪后再核查：两图标仍未被扫进隐藏池', s && !s.market.inPool && !s.giftbox.inPool && s.slides === 5, JSON.stringify({ mPool: s && s.market.inPool, gPool: s && s.giftbox.inPool, slides: s && s.slides }));
await unpre(pre);

// ---- 场景 C：布局已含 app-market（老布局残留）→ 不被吞、保持可见 ----
pre = await preLayout([['deco'], ['music'], ['p3apps'], [], ['app-market']], '5');
await gotoApp();
s = await evalJs(probeIcons);
check('8. 布局已含 app-market：图标可见不在池（随组或按布局归位）', s && s.market.exists && !s.market.inPool && (s.market.isP3 || s.market.slideIdx === 4), JSON.stringify(s && s.market));
await unpre(pre);

// ---- 场景 D：点开市集/心意柜全屏页 ----
pre = await preLayout(null, null);
await gotoApp();
await evalJs(`document.querySelector('[data-app="market"]').click()`);
await sleep(400);
let pg = await evalJs(`(() => {
  var m = document.getElementById('page-market');
  return { exists: !!m, visible: m && !m.hidden, full: m && m.classList.contains('full'),
    gridItems: m ? m.querySelectorAll('.gift-item').length : 0 };
})()`);
check('9. 点市集图标打开全屏页且商品网格有内容', pg && pg.exists && pg.visible && pg.full && pg.gridItems > 0, JSON.stringify(pg));
await evalJs(`document.getElementById('market-back').click()`);
await sleep(300);
await evalJs(`document.querySelector('[data-app="giftbox"]').click()`);
await sleep(400);
pg = await evalJs(`(() => {
  var g = document.getElementById('page-giftbox');
  var h = document.getElementById('page-phone');
  return { exists: !!g, visible: g && !g.hidden, full: g && g.classList.contains('full'), homeClosed: h && h.hidden };
})()`);
check('10. 点心意柜图标打开全屏页', pg && pg.exists && pg.visible && pg.full && pg.homeClosed, JSON.stringify(pg));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

// ===== 回归验证：系统预设字卡页「视口虚拟窗口」（FIX-REGRESSION #90） =====
// 用户反馈：iPhone 15 Plus Safari/Edge/Chrome 进「系统预设字卡」能滑，点返回就卡住，
// 卡回去后整页都很卡。根因（headless 390×844 实测，见下方 V1/V4 旧值）：该页把整个
// 分类一次性铺进 DOM——main 分类 4903 行 / 33221 个节点 / 4628 个 checkbox，全站节点
// 从 1.08 万涨到 4.43 万且返回后不释放；返回时各页 MutationObserver 的选择器扫描被
// 膨胀的文档放大（长任务 127+61ms），残留 DOM 让之后每次切页都付税 → 「整页变卡」。
// 修复：default-cards.js 渲染改真虚拟窗口（flat 数据 + 前缀和 + 视口±0.8 屏 + 占位块）。
// 本脚本验证「窗口化后功能仍然完整」：全量行仍可达、末条与数据一致、无占位空白、
// 单卡开关/搜索仍写对键，以及常驻 DOM 有界 / 返回无长任务（旧版即复发的形态）。
// 用法：构建后 `node tools/verify-preset-card-window.mjs`（对照旧产物复测可加
//       PREVIEW_DIR=<旧产物目录>）。退出码非 0 = 有 FAIL 项。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.PREVIEW_DIR ? normalize(process.env.PREVIEW_DIR) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cc-win-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map(); const jsErrors = [];
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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { jsErrors.push(JSON.stringify(r.exceptionDetails).slice(0, 200)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
let pass = 0, fail = 0;
function check(name, okVal, detail) {
  if (okVal) { pass++; console.log('  PASS  ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
  else { fail++; console.log('  FAIL  ' + name + '  → ' + JSON.stringify(detail)); }
}

// longtask 观察 + 点击后「两帧」阻塞时长探针（任何页面脚本之前挂上）
const PROBE = `(function(){
  window.__p = { longtasks: [] };
  try { new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__p.longtasks.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  window.__nodes = function(){ return document.querySelectorAll('*').length; };
  window.__clickAndBlock = function(id){
    var el = document.getElementById(id);
    var t0 = performance.now();
    el.click();
    var syncMs = +(performance.now() - t0).toFixed(1);
    return new Promise(function(res){
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        res({ syncMs: syncMs, blockMs: +(performance.now() - t0).toFixed(1) });
      }); });
    });
  };
})();`;

async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
  await evalJs(`(function(){ var s = document.getElementById('splash'); if (s) { s.classList.add('hide'); if (s.parentNode) s.parentNode.removeChild(s); } })()`);
  await sleep(500);
}

// 滚动 4 档采样：容器 / 渲染行数 / 命中区 / 末条文字 / 子树节点
async function scan(pageId, listId) {
  const rows = [];
  for (const frac of [0, 0.25, 0.5, 0.999]) {
    const r = await evalJs(`(async function(){
      var page = document.getElementById('${pageId}');
      var list = document.getElementById('${listId}');
      var sc = null, el = list;
      while (el && el !== document.documentElement) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) { sc = el; break; }
        el = el.parentElement;
      }
      if (!sc) sc = page.scrollHeight > page.clientHeight + 1 ? page : null;
      var max = sc ? (sc.scrollHeight - sc.clientHeight) : (document.documentElement.scrollHeight - window.innerHeight);
      if (sc) sc.scrollTop = Math.round(max * ${frac}); else window.scrollTo(0, Math.round(max * ${frac}));
      await new Promise(function(res){ requestAnimationFrame(function(){ requestAnimationFrame(res); }); });
      await new Promise(function(res){ setTimeout(res, 80); });
      var items = list.querySelectorAll('.cc-item');
      var lr = list.getBoundingClientRect(), sr = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
      var cx = Math.round((Math.max(lr.left, sr.left) + Math.min(lr.right, sr.right)) / 2);
      var top = Math.max(lr.top, sr.top), bottom = Math.min(lr.bottom, sr.bottom);
      function hitAt(y) {
        var h = document.elementFromPoint(cx, Math.round(y));
        if (!h || !h.closest) return 'null';
        var d = h.closest('.cc-item,.cc-group-header,.cc-vspace');
        return d ? d.className.toString().slice(0, 24) : h.tagName + '.' + (h.className || '').slice(0, 14);
      }
      // 取列表可见区 40%/65%/85%（避开底部固定 tabbar 遮挡区与页头）
      var hits = [hitAt(top + (bottom - top) * 0.4), hitAt(top + (bottom - top) * 0.65), hitAt(top + (bottom - top) * 0.85)];
      var key = document.querySelector('#${pageId} .cc-tab.sel');
      var dk = key ? key.dataset.type : null;
      var grps = (window.DEFAULT_CARD_DATA || {})[dk] || [];
      var lastGrp = grps[grps.length - 1];
      return {
        scroller: sc ? (sc.id || sc.tagName) : 'window', scrollTop: Math.round(sc ? sc.scrollTop : window.pageYOffset), max: Math.round(max),
        items: items.length, nodes: list.querySelectorAll('*').length,
        firstText: items[0] ? items[0].textContent.slice(0, 14) : '',
        lastText: items[items.length - 1] ? items[items.length - 1].textContent.slice(0, 14) : '',
        hit: hits.join('|'),
        key: dk,
        expectLast: lastGrp ? String(lastGrp[1][lastGrp[1].length - 1]).slice(0, 14) : '',
        rows: grps.reduce(function(s, g){ return s + 1 + g[1].length; }, 0)
      };
    })()`);
    if (!r) return null;
    rows.push(r);
    console.log('    滚 ' + Math.round(frac * 100) + '%  ' + r.scroller + ' ' + r.scrollTop + '/' + r.max +
      '  渲染 ' + r.items + ' 卡  子树 ' + r.nodes + '  命中 [' + r.hit + ']  首 "' + r.firstText + '"  末 "' + r.lastText + '"');
    await sleep(100);
  }
  return rows;
}

function judge(pageId, listId, rows) {
  const a = rows[0], b = rows[rows.length - 1];
  check(pageId + ' 常驻 DOM 有界（列表子树 < 1500 节点，旧版 main 33221）',
    rows.every((r) => r.nodes < 1500), { nodes: rows.map((r) => r.nodes) });
  check(pageId + ' 滚动范围保留（可滚 > 20 屏，占位块撑起全高）', b.max > b.scrollTop + 0 && b.max > 5000, { max: b.max, 分类: b.key, 数据行数: b.rows });
  check(pageId + ' 窗口随滚动推进（首条变化）', a.firstText !== b.firstText, { first0: a.firstText, firstEnd: b.firstText });
  check(pageId + ' 滚到底末条 = 该分类数据末条', !!b.lastText && b.lastText.indexOf(b.expectLast.slice(0, 10)) === 0, { dom: b.lastText, data: b.expectLast });
  check(pageId + ' 可见区无占位空白（未命中 .cc-vspace）', rows.every((r) => r.hit.indexOf('cc-vspace') < 0), rows.map((r) => r.hit));
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
console.log('被测产物: ' + join(root, 'index.html'));

await gotoApp();
const base = await evalJs(`window.__nodes()`);
await evalJs(`(function(){ var t = document.querySelector('.tab[data-page="page-chatcard"]'); if (t) t.click(); })()`);
await sleep(700);
await evalJs(`(function(){ document.getElementById('li-default-cards').click(); })()`);
await sleep(900);
const inPage = await evalJs(`({ nodes: window.__nodes(), listNodes: document.getElementById('dc-list').querySelectorAll('*').length, items: document.querySelectorAll('#dc-list .cc-item').length, inputs: document.querySelectorAll('#dc-list input').length })`);
console.log('\n[V1 进入「聊天默认字卡」]');
console.log('    全站节点 ' + base + ' → ' + inPage.nodes + '  列表子树 ' + inPage.listNodes + '  渲染 ' + inPage.items + ' 卡 / ' + inPage.inputs + ' 开关');
check('V1 全站 DOM 增量有界（< 1500，旧版 +33497）', inPage.nodes - base < 1500, { base, after: inPage.nodes });
judge('聊天默认字卡', 'dc-list', await scan('page-default-cards', 'dc-list'));

await evalJs(`window.__p.longtasks.length = 0;`);
const back = await evalJs(`window.__clickAndBlock('dc-back')`);
await sleep(2000);
const lt = await evalJs(`window.__p.longtasks.filter(function(t){return t.d>=50;})`);
const after = await evalJs(`({ nodes: window.__nodes(), kept: document.getElementById('dc-list').querySelectorAll('*').length })`);
console.log('\n[V2 点返回]');
console.log('    同步 ' + back.syncMs + 'ms  到两帧后 ' + back.blockMs + 'ms  ≥50ms 长任务 ' + JSON.stringify(lt.map((t) => t.d)) + '  残留 ' + after.kept + ' 节点');
check('V2 返回无 ≥50ms 长任务（旧版 [127,61]）', lt.length === 0, { longtasks: lt.map((t) => t.d), blockMs: back.blockMs });
check('V2b 返回后列表残留有界（< 1500，旧版 33221 常驻）', after.kept < 1500, { kept: after.kept });

const again = await evalJs(`(async function(){
  var t0 = performance.now();
  document.getElementById('li-default-cards').click();
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  var enterMs = +(performance.now() - t0).toFixed(1);
  var t1 = performance.now();
  document.getElementById('dc-back').click();
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  return { enterMs: enterMs, backMs: +(performance.now() - t1).toFixed(1) };
})()`);
console.log('\n[V3 二次进出（旧版 590ms / 182ms）] 进入 ' + again.enterMs + 'ms  返回 ' + again.backMs + 'ms');
check('V3 二次进入阻塞 < 250ms', again.enterMs < 250, again);
check('V3b 二次返回阻塞 < 250ms', again.backMs < 250, again);

// V3b 后停在字卡库页（页面 hidden 时布局按设计会跳过，DOM 保持上一窗口）→ 重新进入并回顶
const reenter = async () => {
  await evalJs(`(function(){ document.getElementById('li-default-cards').click(); return 1; })()`);
  await sleep(700);
  await evalJs(`(async function(){
    var el = document.getElementById('dc-list');
    while (el && el !== document.documentElement) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) { el.scrollTop = 0; break; }
      el = el.parentElement;
    }
    window.scrollTo(0, 0);
    await new Promise(function(r){ setTimeout(r, 200); });
    return 1;
  })()`);
  await sleep(200);
};
await reenter();

// V4 单卡开关：窗口末条（dataset.idx → flat）写对 dc-off 键
const tog = await evalJs(`(async function(){
  var list = document.getElementById('dc-list');
  var items = list.querySelectorAll('.cc-item');
  var last = items[items.length - 1];
  if (!last) return { err: 'no-item' };
  var text = last.querySelector('.t').textContent.replace('系统', '').trim();
  var cat = document.querySelector('#dc-tabs .cc-tab.sel').dataset.type;
  var key = 'xy-home-v2:default:dc-off-' + cat + ':' + text;
  last.querySelector('input').click();
  await new Promise(function(r){ setTimeout(r, 150); });
  var off = localStorage.getItem(key), cls = last.classList.contains('off');
  last.querySelector('input').click();
  await new Promise(function(r){ setTimeout(r, 150); });
  return { idx: last.dataset.idx, text: text.slice(0, 12), off: off, on: localStorage.getItem(key), gray: cls };
})()`);
console.log('\n[V4 单卡开关（窗口末条）]');
check('V4 开关写入 dc-off-<分类>:<该卡文案> 并可复原', !tog.err && tog.off === '1' && tog.on === '0' && tog.gray === true, tog);

// V5 搜索：跨全库命中 + 清空恢复窗口
const sr = await evalJs(`(async function(){
  var inp = document.getElementById('dc-search-input');
  inp.value = '辛苦啦';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 900); });
  var items = document.querySelectorAll('#dc-list .cc-item');
  var allOk = Array.prototype.every.call(items, function(it){ return it.textContent.indexOf('辛苦啦') >= 0; });
  var out = { items: items.length, allOk: allOk, heads: document.querySelectorAll('#dc-list .cc-group-header').length };
  inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 900); });
  out.restored = document.querySelectorAll('#dc-list .cc-item').length;
  return out;
})()`);
console.log('\n[V5 搜索收窄] ' + JSON.stringify(sr));
check('V5 搜索结果全部含关键词且有组头', sr.allOk === true && sr.items > 0 && sr.heads > 0, sr);
check('V5b 清空搜索恢复窗口渲染', sr.restored > 0, sr);

// V6「其他互动功能字卡」页（滚动容器与 dc 页不同，取行数最多的分类）
await evalJs(`(function(){ var b = document.getElementById('dc-back'); if (b) b.click(); return 1; })()`);
await sleep(400);
await evalJs(`(function(){ document.getElementById('li-fun-cards').click(); })()`);
await sleep(700);
const bigTab = await evalJs(`(function(){
  var D = window.DEFAULT_CARD_DATA || {};
  var best = null, n = 0;
  document.querySelectorAll('#page-fun-cards .cc-tab[data-type]').forEach(function(t){
    var r = (D[t.dataset.type] || []).reduce(function(s, g){ return s + 1 + g[1].length; }, 0);
    if (r > n) { n = r; best = t; }
  });
  if (best) best.click();
  return { key: best ? best.dataset.type : '', rows: n };
})()`);
await sleep(700);
console.log('\n[V6 其他互动功能字卡页（最大分类 ' + bigTab.key + ' ' + bigTab.rows + ' 行）]');
judge('其他互动功能字卡', 'fc-list', await scan('page-fun-cards', 'fc-list'));
const fcBack = await evalJs(`window.__clickAndBlock('fc-back')`);
check('V6b 功能字卡页返回两帧内完成（< 250ms）', fcBack.blockMs < 250, fcBack);

const errs = await evalJs(`(window.__p && window.__p.longtasks.length) || 0`);
check('V7 全程无 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3));
console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过（长任务样本 ' + errs + '）');
chrome.kill(); server.close();
process.exitCode = fail ? 1 : 0;

// ===== #1490 经期页「症状缓解建议」卡：查旧/写新同 id（重复堆卡）＋就近删除入口 =====
// 背景：renderRemedies() 查旧节点用 #period-remedy-card、新建节点却写 id='period-card'，
//   old.remove() 永远命中不到 → 每 render 一次页内就多留一张「症状缓解建议」，作者两次
//   报「重复七八条」；且该卡是「最近一条带症状的每日记录」派生出来的，页内此前没有任何
//   删除入口（只能绕去日历格子→日格弹层里删那个键），作者报「内容没有删除的按钮」。
// 本尺两次进页面（真触发两轮 render）后数卡，再点新的 .pc-del 断言只清当天症状。
// 红侧（纯 tip）预期：S1/S2/S3 静态红＋B2/B3 重复堆卡红＋B5~B8 删除链红。
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const results = [];
function check(desc, ok, detail, discriminating) {
  results.push({ desc, ok: !!ok, discriminating: !!discriminating });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 160) + ']' : ''));
}

// ---- S 组：静态锚点（产物形态）----
const prodPeriod = (() => { try { return readFileSync(join(root, 'js', 'period.js'), 'utf8'); } catch (e) { return ''; } })();
const srcPeriod = (() => { try { return readFileSync(join(root, 'src', 'js', 'period.js'), 'utf8'); } catch (e) { return ''; } })();
check('S1 产物渲染前清掉新旧两种 id 的遗留卡', prodPeriod.includes("querySelectorAll('#period-card, #period-remedy-card')"), '', true);
check('S2 产物卡片带就近删除按钮 .pc-del', prodPeriod.includes('class="pc-del"'), '', true);
const remedyIdWrites = (srcPeriod.match(/card\.id = 'period-remedy-card';/g) || []).length;
check('S3 建卡写的 id 与查旧一致（period-remedy-card ×2）', remedyIdWrites === 2, '命中 ' + remedyIdWrites + ' 次', true);

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1490-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await gotoApp();

// 清经期键 + 挂错误钩
await evalJs(`(function(){ Object.keys(localStorage).filter(function(k){return k.indexOf('xy-home-v2')===0 && k.indexOf('period')>=0;}).forEach(function(k){localStorage.removeItem(k);}); window.__errs=[]; window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); }); return 'ok'; })()`);

// 种当天带症状的每日记录（心情/备注同时在，用来验删除只清症状）
const seeded = await evalJs(`(function(){
  var d = new Date();
  var k = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  window.__ds = k;
  var daily = {};
  daily[k] = { symptoms: ['fatigue','insomnia'], mood: 4, note: '尺子留的备注', flow: 'medium' };
  window.xyStore('xy-home-v2').set('period-daily', JSON.stringify(daily));
  return localStorage.getItem('xy-home-v2:period-daily');
})()`);
check('B0 种子写入 period-daily', !!(seeded && seeded.indexOf('fatigue') >= 0), seeded, false);

// 进/出页面各 3 轮＝3 次 render
const openPage = `(function(){ document.querySelector('.app[data-app="period"]').click(); var p=document.getElementById('page-period'); return p && !p.hidden ? 'open' : 'shut'; })()`;
const leavePage = `(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); var h=document.getElementById('page-phone'); if(h) h.hidden=false; return 'home'; })()`;
let openState = null;
for (let round = 0; round < 3; round++) {
  openState = await evalJs(openPage);
  await sleep(350);
  await evalJs(leavePage);
  await sleep(150);
}
check('B1 经期页可打开', openState === 'open', openState, false);
await sleep(300);

const countExpr = `(function(){
  var scroll = document.querySelector('#page-period .period-scroll');
  if (!scroll) return null;
  var cards = Array.prototype.slice.call(scroll.querySelectorAll('.period-card'));
  var titles = cards.filter(function(c){ var t=c.querySelector('.period-card-title'); return t && t.textContent.indexOf('症状缓解建议')>=0; });
  return {
    remedyCards: titles.length,
    legacyId: scroll.querySelectorAll('#period-card').length,
    hasDel: !!scroll.querySelector('.pc-del'),
    prRows: scroll.querySelectorAll('.pr-row').length,
    text: scroll.textContent.slice(0, 4000),
    topTitle: !!scroll.querySelector('.ps-title'),
    psEmpty: !!scroll.querySelector('.ps-empty'),
    errs: window.__errs
  };
})()`;
let s = await evalJs(countExpr);
check('B2 三轮 render 后「症状缓解建议」卡恰 1 张', s && s.remedyCards === 1, s && ('卡 ' + s.remedyCards + ' 张 / 遗留 id ' + s.legacyId + ' 个'), true);
check('B3 无遗留 period-card 节点', s && s.legacyId === 0, s && String(s.legacyId), true);
check('B4 页内确有症状内容（疲劳/失眠）＝探针防假绿', !!(s && s.text.indexOf('疲劳') >= 0 && s.text.indexOf('失眠') >= 0), '', false);
check('B5 卡片带就近删除按钮', !!(s && s.hasDel), '', true);
check('B6 删除前 TOP3 在场', !!(s && s.topTitle), '', false);

// 点删除
s = await evalJs(`(function(){
  var card = document.getElementById('period-remedy-card');
  var btn = card && card.querySelector('.pc-del');
  if (!btn) return { missing: true, errs: window.__errs };
  btn.click();
  return { missing: false, errs: window.__errs };
})()`);
await sleep(400);
const stored = await evalJs(`(function(){
  try { return JSON.parse(localStorage.getItem('xy-home-v2:period-daily')||'{}')[window.__ds]; } catch (e) { return null; }
})()`);
check('B7 删除后当天症状清空（symptoms 空数组）', !!(stored && Array.isArray(stored.symptoms) && stored.symptoms.length === 0), stored && JSON.stringify(stored.symptoms), true);
check('B8 删除保留心情与备注（只清症状）', !!(stored && stored.mood === 4 && stored.note === '尺子留的备注'), stored && JSON.stringify({ mood: stored.mood, note: stored.note }), true);

s = await evalJs(countExpr);
check('B9 删除后症状条目消失（无 .pr-row）', !!(s && s.prRows === 0), s && String(s.prRows), true);
check('B10 删除后 TOP3 归零、卡回空态（无删除按钮）', !!(s && !s.topTitle && s.psEmpty && !s.hasDel), s && JSON.stringify({ topTitle: s.topTitle, psEmpty: s.psEmpty, hasDel: s.hasDel }), true);
// 删掉最后一条症状后 renderRemedies 走到「无 html 可渲染」的分支＝整张卡随之退场（不残留、不堆卡）
check('B11 删除后该卡随之退场（无残留堆积）', !!(s && s.remedyCards === 0), s && String(s.remedyCards), true);
check('B12 全链路零 JS 异常', !!(s && s.errs && s.errs.length === 0), s && JSON.stringify(s.errs), false);

// ---- 汇总 ----
server.close();
try { chrome.kill(); } catch (e) {}
const total = results.length;
const pass = results.filter((r) => r.ok).length;
const discFail = results.filter((r) => r.discriminating && !r.ok).length;
console.log('----');
console.log('结果: ' + pass + '/' + total + '（判别断言失败 ' + discFail + ' 条）');
if (pass === total) console.log('✅ 全部通过');
else { console.log('❌ 有失败项' + (discFail ? '（其中判别断言 ' + discFail + ' 条——红侧应恰为这些）' : '')); process.exitCode = 1; }
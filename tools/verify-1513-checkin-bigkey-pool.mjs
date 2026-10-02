// #1513 行为回归尺：寻踪（TA 的日常）自定义库＝IDB-only 大键时不得当「没有」
// 作者实报（多设备型号同现＝纯行为口径，零机型分支）：关闭「使用系统预设」后，
// 【TA在哪里】【TA在做什么】调不到用户自己添加的字卡，日常里只剩【TA想对你说】有内容。
// 根因：三类自定义库（checkin-cards-place/action/msg）超 200KB＝IDB-only 大键，切一次后台
// （#1195e 放掉 memoryCache 副本）或冷启回填未到时 store.get 同步读空被 genCheckin 当「没有」
// ＝关预设时该分类被 DEF 过滤器清空、字段生成空。修＝doCheckin 唯一收口点先问 awaitingBigKey
// （#1342d 门面 #1358j），读不全让路＋requestBigKey 请库＋whenBigKeyBack 回来再生成（4s 保底）。
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

// ---- S 组：源码/产物锚（外置 js/<file> 与内联 index.html 两种落点都认）----
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const p2Code = srcOf('p2-features.js') + indexHtml;
console.log('S 源码/产物锚');
ok('S1 生成前问大键读全没有（#1513a）', p2Code.includes("store.awaitingBigKey('checkin-cards-' + k)"));
ok('S2 读不全让路请库取回＋回来再生成（#1513b）', p2Code.includes("store.whenBigKeyBack('checkin-cards-' + k, function () {"));
ok('S3 4 秒保底在位（让路一时不让路一世，不把闸变成新的「不更新」）',
  p2Code.includes('if (seq !== ckBigSeq || !ckBigPending) return;'));
ok('S4 #1493 顶库闸未被牵连（checkin-history 读不全先让路）',
  p2Code.includes("window.xyBigWriteHold && window.xyBigWriteHold(store, 'checkin-history')"));

// ---- 无头浏览器 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1511-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr.trim() + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 423, height: 853, deviceScaleFactor: 1.7, mobile: true });
// 二级锁必须在文档脚本之前解锁；「使用系统预设」关闭＝本批口径（只抽自定义库）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.setItem('xy-home-v2:cardlock-pwver','2');localStorage.setItem('xy-home-v2:default:checkin-cards-default','0');}catch(e){}})()" });
let jsErr = 0;
ws.addEventListener('message', (ev) => {
  try { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErr++; } catch (e) {}
});
async function openCold() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(500);
}
const bigText = '云边小卖部屋顶天台车站面包房东侧巷口第二个路口的奶茶店旁再往东走三分钟过了天桥就是江边的旧仓库区';

console.log('B 行为断言（423×853 无头）');
await openCold();
const fx = await evalJs(`
  try { if (window.cardLockTryUnlock) window.cardLockTryUnlock('990815'); } catch (e) {}
  return { ready: !!window.chatAddIn && !!window.xyStore && !!window.openCheckinPage };
`);
if (!fx || !fx.ready) { console.error('SKIP: 模块未就绪 ' + JSON.stringify(fx)); chrome.kill(); server.close(); process.exit(2); }

// ---- B0 小库回归对照：普通 <200KB 自定义库照常生效（关预设只抽自定义的口径不被本批破坏）----
const b0 = await evalJs(`
  var ns = window.xyStore('xy-home-v2:default');
  ns.set('checkin-cards-place', JSON.stringify([{ t: '小库地点·楼下猫咖' }]));
  ns.set('checkin-cards-action', JSON.stringify([{ t: '小库动作·撸猫' }]));
  ns.set('checkin-cards-msg', JSON.stringify([{ t: '小库话术·早点回家' }]));
  try { window.openCheckinPage(); } catch (e) { return { err: String(e).slice(0, 120) }; }
  var btn = document.getElementById('ck-refresh'); if (btn) btn.click();
  await new Promise(function (r2) { setTimeout(r2, 500); });
  return {
    place: (document.getElementById('ck-place') || {}).textContent,
    action: (document.getElementById('ck-action') || {}).textContent,
    msg: (document.getElementById('ck-msg') || {}).textContent
  };
`);
ok('B0 小库（<200KB）关预设后三字段全用自定义（原口径零回归）',
  b0 && b0.place === '小库地点·楼下猫咖' && b0.action === '小库动作·撸猫' && b0.msg === '小库话术·早点回家', JSON.stringify(b0));

// ---- B1 种大键：place/action 各 5200 条（>200KB＝IDB-only，LS 副本被收走），msg 保持小键 ----
const b1 = await evalJs(`
  var ns = window.xyStore('xy-home-v2:default');
  var bigPlace = [], bigAction = [];
  for (var i = 0; i < 5200; i++) {
    bigPlace.push({ t: '自定义地点第' + i + '号·${bigText}' });
    bigAction.push({ t: '自定义动作第' + i + '号·给多肉浇水数羊数到天亮然后把窗帘拉开看云' });
  }
  ns.set('checkin-cards-place', JSON.stringify(bigPlace));
  ns.set('checkin-cards-action', JSON.stringify(bigAction));
  var ls = function (k) { return (localStorage.getItem('xy-home-v2:default:' + k) || '').length; };
  return { placeLS: ls('checkin-cards-place'), actionLS: ls('checkin-cards-action') };
`);
ok('B1 大键写入后 LS 副本被收走（IDB-only 前提成立）', b1 && b1.placeLS === 0 && b1.actionLS === 0, JSON.stringify(b1));

// 冷启一遍让大键流式回填进 memoryCache（健康态先确认读得到）
await openCold();
const b2pre = await evalJs(`
  var ns = window.xyStore('xy-home-v2:default');
  var rd = function (k) { var v = null; try { v = ns.get(k); } catch (e) {} return v ? v.length : 0; };
  return { place: rd('checkin-cards-place'), action: rd('checkin-cards-action') };
`);
ok('B2 冷启回填后健康态读得到大库', b2pre && b2pre.place > 200000 && b2pre.action > 200000, JSON.stringify(b2pre));

// ---- B3 盲窗刷新（判别核心）：放掉 memoryCache 副本后立刻点刷新＝genCheckin 同步读空的现场 ----
// 绿：让路等取回，取回后用完整自定义池生成（三字段全自定义＋checkin-current 三键齐全）。
// 红（旧产物）：当场用空池生成＝place/action 空，只剩想对你说。
const b3 = await evalJs(`
  var hiddenDesc = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try { Object.defineProperty(document, 'visibilityState', { get: function () { return 'hidden'; }, configurable: true });
    document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
  try { Object.defineProperty(document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
    document.dispatchEvent(new Event('visibilitychange')); } catch (e2) {}
  var btn = document.getElementById('ck-refresh');
  try { window.openCheckinPage(); } catch (e3) {}
  btn = document.getElementById('ck-refresh');
  if (btn) btn.click();
  var cur0 = null; try { cur0 = JSON.parse(window.xyStore('xy-home-v2:default').get('checkin-current') || 'null'); } catch (e4) {}
  var fin = null;
  for (var t = 0; t < 50; t++) {
    await new Promise(function (r2) { setTimeout(r2, 100); });
    var c = null; try { c = JSON.parse(window.xyStore('xy-home-v2:default').get('checkin-current') || 'null'); } catch (e5) {}
    // 只认「新生成的大库内容」＝place 以「自定义地点」开头（B0 写下的小库旧 current 不算数）
    if (c && c.place && String(c.place).indexOf('自定义地点') === 0 && c.action && c.msg) { fin = c; break; }
  }
  if (hiddenDesc) { try { Object.defineProperty(document, 'visibilityState', hiddenDesc); } catch (e6) {} }
  return {
    atClick: { p: cur0 && cur0.place || '', a: cur0 && cur0.action || '' },
    final: fin ? { p: (fin.place || '').slice(0, 12), a: (fin.action || '').slice(0, 12), m: (fin.msg || '').slice(0, 12), full: !!(fin.place && fin.action && fin.msg) } : null,
    ui: { p: (document.getElementById('ck-place') || {}).textContent || '', a: (document.getElementById('ck-action') || {}).textContent || '', m: (document.getElementById('ck-msg') || {}).textContent || '' }
  };
`);
ok('B3 盲窗刷新＝等取回后用完整自定义池生成（place/action/msg 三键齐全；红侧在此恰红＝place/action 空）',
  b3 && b3.final && b3.final.full &&
  String(b3.final.p).indexOf('自定义地点') === 0 && String(b3.final.a).indexOf('自定义动作') === 0 &&
  String(b3.ui.p).indexOf('自定义地点') === 0 && String(b3.ui.a).indexOf('自定义动作') === 0,
  JSON.stringify(b3));

// ---- B4 聊天推送不带 undefined／空拼串 ----
const b4 = await evalJs(`
  var arr = window.getChatMsgs ? window.getChatMsgs() : [];
  var bad = [];
  arr.slice(-6).forEach(function (m) { var t = (m && (m.text || m.content)) || ''; if (t.indexOf('undefined') >= 0) bad.push(t.slice(0, 40)); });
  return { bad: bad, tail: arr.slice(-3).map(function (m) { return ((m && (m.text || m.content)) || '').slice(0, 30); }) };
`);
ok('B4 聊天推送无 undefined 拼串', b4 && b4.bad.length === 0, JSON.stringify(b4));

// ---- B5 寻踪记录完整（不落残缺条目）----
const b5 = await evalJs(`
  var h = []; try { h = JSON.parse(window.xyStore('xy-home-v2:default').get('checkin-history') || '[]'); } catch (e) {}
  var last = h[h.length - 1] || {};
  return { n: h.length, last: { p: last.place || '', a: last.action || '', m: last.msg || '' } };
`);
ok('B5 寻踪记录首条三键齐全（不落残缺记录；msg 各读各的库＝B0 种下的小库话术）',
  b5 && b5.n > 0 && String(b5.last.p).indexOf('自定义地点') === 0 &&
  String(b5.last.a).indexOf('自定义动作') === 0 && b5.last.m === '小库话术·早点回家', JSON.stringify(b5));

// ---- B6 我的添加列表盲窗不谎报「暂未添加」----
const b6 = await evalJs(`
  var hiddenDesc = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try { Object.defineProperty(document, 'visibilityState', { get: function () { return 'hidden'; }, configurable: true });
    document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
  try { Object.defineProperty(document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
    document.dispatchEvent(new Event('visibilitychange')); } catch (e2) {}
  var li = document.getElementById('li-checkin-cards-mine');
  if (!li) return { noLi: true };
  document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
  li.click();
  var txt0 = (document.getElementById('cck-mine-list') || {}).textContent || '';
  await new Promise(function (r2) { setTimeout(r2, 1500); });
  var txt1 = (document.getElementById('cck-mine-list') || {}).textContent || '';
  if (hiddenDesc) { try { Object.defineProperty(document, 'visibilityState', hiddenDesc); } catch (e3) {} }
  return { atOpen: txt0.slice(0, 60), after: txt1.slice(0, 60),
    lied: txt0.indexOf('暂未添加') >= 0, settled: txt1.indexOf('自定义地点') >= 0 };
`);
ok('B6 我的添加盲窗不谎报「暂未添加」（取回提示或直接出列表，稍候内容自动出现）',
  b6 && !b6.noLi && !b6.lied && b6.settled, JSON.stringify(b6));

ok('Z 全程零未捕获 JS 异常', jsErr === 0, 'jsErr=' + jsErr);

try { ws.close(); } catch (e) {}
chrome.kill(); server.close();
console.log('—— 合计：' + pass + ' 绿 / ' + fail + ' 红 ——');
process.exit(fail ? 1 : 0);

// #918 行为回归：进聊天页「补尾」不得再把主线程冻死（弹闪一下才恢复／没有加载动画）。
// 用法：node tools/verify-chat-newer-index.mjs [产物目录]     THROTTLE=1 SEED_N=600 为复现口径
// 复现口径实测：只有**不节流**＋600 条历史才会走进「LS 尾部快照先上屏 → 权威后到 → 同窗补尾」
// （重度节流时应用等权威再整窗渲，压根不进补尾，红基线会假绿）；IDB_DELAY=1500 可另模拟大键首读超时。
// 判据分两层：① 复杂度断言（与机器负载无关）＝补尾期 data-idx 型 querySelector 调用次数；
// ② 时长断言＝最长长任务／首帧到位；③ 语义＝只补画不重画、下标唯一递增、翻到最新。
// 「无整窗重画」（B3/B7）取 MutationObserver 的批量摘除记录（一条摘 ≥10 个兄弟节点＝renderWindow 的
// body.innerHTML='' 清空），不取「尾条标记是否失活」——#245 的 lite 原位升级 replaceChild 必然让尾条
// 标记失活一次（绿侧实测 t≈184ms），那是设计行为不是闪屏，用它当判据会偶发假红（2026-09-20 实测）。
// 红基线（旧写法，THROTTLE=1 SEED_N=600）实测：q=157,084 次全表扫、单任务 3.2~4.4s 纯冻结
// （冻结期画面停在 40 条快照、进度条画不动，解冻一次性落成 400 条＝用户看到的「闪一下才恢复」）；
// 绿（#918 查表）：q≤4、最长任务 63~153ms。⚠️ 闪屏由**冻结**造成，两侧都没有 renderWindow 的
// 清空重画（B3 在红基线也是绿的＝纯守卫断言），别指望 B3 单独判别本缺陷，判红靠 B1/B2/B8。
// B8＝「首帧有内容」的时刻（红基线实测 4,620ms 屏幕才有东西＝用户所见「卡一下／没有加载动画」本体；
// 绿侧 65~269ms）。
// 压测档：SEED_N=2500 绿侧同样全绿（q=4、最长任务 ~465ms、零批量摘除），红基线该档 q=3,126,250。
// （本脚本改判据前曾在 2500 档报「约 400ms 一次整窗重画」＝同一 marker 假红，已随判据一并纠正。）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
const TH = Number(process.env.THROTTLE || 1); // 实测：只有不节流时「快照先上屏→权威后到」才会走进补尾
const SEED_N = Number(process.env.SEED_N || 600);
const MAX_IDX_QUERY = Number(process.env.MAX_IDX_QUERY || 200); // 旧写法数千次，新写法 0~40
const MAX_LONGTASK = Number(process.env.MAX_LONGTASK || 1200); // ms，旧写法实测 3897ms 单任务冻结
const MAX_FIRST = Number(process.env.MAX_FIRST || 1500); // ms，旧写法实测 4,620ms 屏幕才有东西
const IDB_DELAY = Number(process.env.IDB_DELAY || 0); // 可选：模拟「大键首读超时＋补读慢」的低端机时序
const BULK = Number(process.env.BULK || 10); // 一条 childList 记录摘掉 ≥BULK 个节点＝整窗/大段重画（原位升级只摘 1 个）
const SLEEP = Number(process.env.DUR || 9000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, info) => {
  if (cond) { pass++; console.log('  PASS ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (info ? '  [' + info + ']' : '')); }
};

// —— 静态锚：修复还在，且没有退回「循环内全表扫」 ——
const srcChat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const buildMjs = readFileSync(join(root, 'build.mjs'), 'utf8');
const fnBody = (() => {
  const i = srcChat.indexOf('function loadNewerIncremental(');
  const j = srcChat.indexOf('\nfunction ', i + 10);
  return i < 0 ? '' : srcChat.slice(i, j < 0 ? i + 6000 : j);
})();
console.log('#918 进页补尾索引表化（产物：' + root + '）');
ok('S1 屏上下标一次成表在位', srcChat.includes('const onScreen = new Map(); // #918a'));
ok('S2 #766 幂等守卫生效（改查表，口径不变）', srcChat.includes('if (onScreen.has(i)) continue; // #766a'));
ok('S3 锚点选取同批改查表', srcChat.includes('anchor = onScreen.get(j) || null; // #918b'));
ok('S4 补尾循环内无逐条全表 querySelector', !fnBody.includes(`body.querySelector('[data-idx="'`));
ok('S5 哨兵 #918a/#918b 已登记', buildMjs.includes("needle: 'const onScreen = new Map(); // #918a'") && buildMjs.includes("needle: 'anchor = onScreen.get(j) || null; // #918b'"));
ok('S6 哨兵 #766a 已换锚到查表形态', buildMjs.includes('if (onScreen.has(i)) continue; // #766a'));

// —— 无头环境 ——
const chrome = (() => {
  const c = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  const p = c.find((x) => { try { return statSync(x).isFile(); } catch (e) { return false; } });
  if (!p) { console.error('SKIP: 无 chrome（环境不满足，不算回归）'); process.exit(2); }
  return p;
})();
if (!existsSync(join(root, 'index.html'))) { console.error('SKIP: 无产物 index.html'); process.exit(2); }
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
const cdpPort = 9960 + Math.floor(Math.random() * 30);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v918-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
if (!ws) { console.error('SKIP: CDP 连不上'); proc.kill(); server.close(); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: TH });

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('return !!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await evalJs(`var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;`);
  await sleep(400);
}
await boot();
const seeded = await evalJs(`
  var P = window.activePrefix();
  var cv = document.createElement('canvas'); cv.width=600; cv.height=400;
  var g = cv.getContext('2d'); g.fillStyle='#8ab'; g.fillRect(0,0,600,400);
  var src = cv.toDataURL('image/png');
  var now = Date.now(), N = ${SEED_N}, full = [];
  for (var i = 0; i < N; i++) {
    var ts = now - (N - i) * 60000;
    if (i % 9 === 0) full.push({ side: i % 2 ? 'in' : 'out', type: 'image', text: '图片', img: src, ts: ts });
    else if (i % 37 === 5) { full.push({ side:'out', text:'重复句'+i, ts: ts }); full.push({ side:'out', text:'重复句'+i, ts: ts + 300 }); i++; }
    else full.push({ side: i % 2 ? 'in' : 'out', text: (i % 2 ? '对方消息' : '我的消息') + i, ts: ts });
  }
  await window.idbSet(P + ':chat-msgs', JSON.stringify(full));
  await window.idbSet(P + ':chat-meta', JSON.stringify({ n: full.length, t: Date.now() }));
  var tail = full.slice(-40).map(function (m) { var c = Object.assign({}, m); if (c.img) { c.img=''; c._lsLite = 1; } return c; });
  localStorage.setItem(P + ':chat-msgs', JSON.stringify(tail));
  return 'seeded ' + full.length;
`);
console.log('seed: ' + JSON.stringify(seeded));
const SEEDED_LEN = Number(String(seeded).replace(/\D+/g, '')) || SEED_N;

// 探针：计 data-idx 型 querySelector 调用 + 长任务 + 整窗重画标记
const PROBE = `
  var b = document.getElementById('chat-body');
  window.__q = 0; window.__qa = 0; window.__long = []; window.__samp = [];
  if (!window.__qw) {
    window.__qw = 1;
    var IDX = /\\[data-idx/;
    var pq = Element.prototype.querySelector, pqa = Element.prototype.querySelectorAll;
    Element.prototype.querySelector = function (s) { if (window.__count && IDX.test(String(s))) window.__q++; return pq.call(this, s); };
    Element.prototype.querySelectorAll = function (s) { if (window.__count && IDX.test(String(s))) window.__qa++; return pqa.call(this, s); };
  }
  window.__count = 1;
  var t0 = performance.now();
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { window.__long.push([Math.round(e.startTime - t0), Math.round(e.duration)]); }); }).observe({ type: 'longtask', buffered: false }); } catch (err) {}
  var marker = null, lost = -1, first = -1;
  // 整窗重画的判据＝「一条 childList 记录里一次性摘掉 ≥BULK 个兄弟节点」（renderWindow 用
  // body.innerHTML='' 清空＝单条记录 removedNodes=全部；实测绿侧一条都没有）。
  // ⚠️ 不能用「标记节点失活」当判据：#245 的 lite 原位升级走 replaceChild，一次摘 1 个再插回，
  // 尾条正是被升级的 lite 快照节点 ⇒ 标记必然失活，但画面没有任何一次整窗清空（实测 t=184ms 假红）。
  var bulk = -1, maxRem = 0, inplace = 0;
  if (window.__mo) { try { window.__mo.disconnect(); } catch (err) {} }
  window.__mo = new MutationObserver(function (list) {
    if (first < 0) return; // 首帧之前是初始渲染，不算重画
    var now = performance.now() - t0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].removedNodes.length;
      if (r >= ${BULK}) { if (bulk < 0) bulk = now; if (r > maxRem) maxRem = r; }
      else if (r > 0) inplace++;
    }
  });
  window.__mo.observe(b, { childList: true });
  function tick() {
    var now = performance.now();
    if (!document.getElementById('page-chat').hidden && b.children.length > 10 && first < 0) {
      first = now - t0; marker = b.lastElementChild; marker.setAttribute('data-mk', '1');
    }
    if (marker && lost < 0 && !marker.isConnected) lost = now - t0;
    window.__first = Math.round(first); window.__lost = Math.round(lost);
    window.__bulk = Math.round(bulk); window.__maxRem = maxRem; window.__inplace = inplace;
    window.__samp.push([Math.round(now - t0), b.children.length]);
  }
  window.__timer = setInterval(tick, 50);
  window.__stop = function () { clearInterval(window.__timer); window.__count = 0; try { window.__mo.disconnect(); } catch (err) {} return 1; };
  tick();
  return true;
`;
const SNAP = `
  var b = document.getElementById('chat-body');
  var idx = [], dup = 0, bad = 0, seen = {};
  var nodes = b.querySelectorAll('[data-idx]');
  for (var i = 0; i < nodes.length; i++) {
    var k = parseInt(nodes[i].dataset.idx, 10);
    if (seen[k]) dup++; else seen[k] = 1;
    idx.push(k);
  }
  for (var i = 1; i < idx.length; i++) if (idx[i] <= idx[i-1]) bad++;
  var last = b.lastElementChild;
  return JSON.stringify({ n: idx.length, max: idx.length ? idx[idx.length-1] : -1, dup: dup, bad: bad,
    lastText: last ? (last.textContent || '').slice(0, 40) : '', maxLong: (window.__long||[]).reduce(function(m,l){return Math.max(m,l[1]);},0),
    q: window.__q, qa: window.__qa, first: window.__first, lost: window.__lost,
    bulk: window.__bulk, maxRem: window.__maxRem, inplace: window.__inplace,
    longs: (window.__long||[]).length, errs: (window.__jsErrors||[]).slice(0,4) });
`;

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('return !!window.__mochiDataReady')) break; await sleep(300); }
await evalJs(`var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;`);
await sleep(400);
// 夹具：让「LS 尾部快照先上屏 → 权威后到 → 同窗补尾」这条真实时序必然出现。
// 单纯推迟读取不够（应用会等权威回来再整窗渲＝走 renderWindow，压根不进补尾）；低端机的现场是
// chat-msgs 大键**首读超时/读空**（#869 守卫：读空不当空历史，改用有损 LS 快照先画、打 pendingRead
// 占位），随后补读拿到权威 → inplacePatchIfSameWindow 的 grown 补尾 = loadNewerIncremental。
// 故包装 idbGet：chat-msgs 首读返回 null，之后的读推迟 IDB_DELAY 再给真值。
if (IDB_DELAY > 0) {
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
    var D = ${IDB_DELAY}, real = null, first = 0;
    Object.defineProperty(window, 'idbGet', { configurable: true,
      get: function () { if (!real) return undefined; return function (k) {
        if (typeof k === 'string' && k.indexOf('chat-msgs') >= 0) {
          if (!first++) return Promise.resolve(null);
          return new Promise(function (res) { setTimeout(function () { real(k).then(res, function () { res(null); }); }, D); });
        }
        return real.apply(null, arguments);
      }; },
      set: function (v) { real = v; } });
  })();` });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('return !!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs(`var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;`);
  await sleep(400);
}

console.log('\n— R1 冷进聊天（LS 尾部快照 → 权威全量补尾）—');
await evalJs(PROBE);
await evalJs(`document.querySelector('.app[data-app="chat"]').click(); return true;`);
await sleep(SLEEP);
const r1 = JSON.parse(await evalJs(SNAP));
await evalJs('return window.__stop()');
console.log('  ' + JSON.stringify(r1));
ok('B1 补尾期无逐条全表扫（idx querySelector 次数）', r1.q <= MAX_IDX_QUERY, 'q=' + r1.q + ' 阈值 ' + MAX_IDX_QUERY + '，批量扫描 qa=' + r1.qa);
ok('B2 无分钟级主线程冻结（最长长任务）', r1.maxLong < MAX_LONGTASK, r1.maxLong + 'ms < ' + MAX_LONGTASK + 'ms，长任务数 ' + r1.longs);
ok('B3 画面一次性到位（无整窗重画＝无一次摘掉 ≥' + BULK + ' 个节点的记录）', r1.bulk < 0 && r1.first > 0 && r1.first < SLEEP, '首帧 ' + r1.first + 'ms，批量摘除 t=' + r1.bulk + '（最多一条摘 ' + r1.maxRem + ' 个），单节点原位升级 ' + r1.inplace + ' 条，尾条标记失活 t=' + r1.lost + '（＝原位升级，正常）');
ok('B8 首帧内容及时（冻结期屏幕什么都没有＝「没有加载动画」本体）', r1.first > 0 && r1.first <= MAX_FIRST, '首帧 ' + r1.first + 'ms ≤ ' + MAX_FIRST + 'ms');
ok('B4 补画不重画（下标唯一且严格递增）', r1.dup === 0 && r1.bad === 0, 'n=' + r1.n + ' dup=' + r1.dup + ' bad=' + r1.bad);
ok('B5 看得到最新消息（补到尾部）', r1.max >= SEEDED_LEN - 1, '末下标 ' + r1.max + ' ≥ 种子末 ' + (SEEDED_LEN - 1) + '，末尾「' + r1.lastText + '」');

console.log('\n— R2 上翻一页（loadOlderIncremental 语义不回归）—');
await evalJs(`
  var b=document.getElementById('chat-body'); window.__count=1; window.__q=0;
  b.scrollTop = 0; b.dispatchEvent(new Event('scroll'));
  return true;
`);
await sleep(2500);
const r2 = JSON.parse(await evalJs(SNAP));
await evalJs('window.__count=0; return 1;');
ok('B6 上翻后仍唯一递增且更长', r2.dup === 0 && r2.bad === 0 && r2.max >= SEEDED_LEN - 1 && r2.n >= r1.n, 'n=' + r2.n + '（R1 ' + r1.n + '）dup=' + r2.dup + ' bad=' + r2.bad);

console.log('\n— R3 回桌面 → 再进聊天（热重进不再重建）—');
await evalJs(`
  document.getElementById('chat-back').click(); return true;
`);
await sleep(800);
await evalJs(PROBE);
await evalJs(`document.querySelector('.app[data-app="chat"]').click(); return true;`);
await sleep(4000);
const r3 = JSON.parse(await evalJs(SNAP));
await evalJs('return window.__stop()');
ok('B7 热重进零整窗重画', r3.bulk < 0 && r3.q <= MAX_IDX_QUERY, 'q=' + r3.q + ' 批量摘除 t=' + r3.bulk + '（最多一条摘 ' + r3.maxRem + ' 个）原位升级 ' + r3.inplace + ' 条 最长任务 ' + r3.maxLong + 'ms');
const errz = await evalJs('return JSON.stringify((window.__jsErrors||[]).slice(0,6))');
ok('Z1 全程零 JS 异常', !Array.isArray(r1.errs) || r1.errs.length === 0, 'jsErrors=' + errz);

proc.kill(); server.close();
console.log('\n结果：' + pass + ' 过 / ' + fail + ' 红');
process.exit(fail ? 1 : 0);

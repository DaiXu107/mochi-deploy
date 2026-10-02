// ===== 常驻回归脚本 #1324：iOS「切页面／从后台切回来最卡」——回前台那两笔整包同步重写 ＋ 两把帧尺的挂起边界 =====
// 用法：node tools/verify-1324-resume-writes-and-frame-edge.mjs [被测根目录]（首行打印被测根目录，防喂错产物）
// 症状（用户实报 2026-09-27，iPhone 17 Pro Max／iOS 26.6.1「添加到主屏幕」，附 perfcheck＋诊断单各两份）：
//   「切页面和从后台切回来最卡」＋「不同型号不同 ios 可能出现不同问题，不要覆盖式修补」「其他设备型号也有出现」。
//   导出件读数：10 秒里前台冻结 19 次（>250ms）、最慢一帧 799ms（60 秒那份 1937ms）、本页被系统回收 8~10 次；
//   冻结前序操作里 `wrj-journal` 距冻结起点中位 **2ms＝紧邻高危**；诊断单【性能】「切回桌面帧耗时 平均 1196ms／
//   p90 3435ms／最慢 20828ms」（#1300 那单更读到 25575ms）。
// 三处根因（纯 HEAD 副本量出来的，零机型／零 UA 分支；尺子一律取「这一拍到底做了多少次同步写、写了多少字节」
// 与「这一差值跨没跨过可见性边界」两个事实，不取毫秒数——毫秒数在无 GPU 的内核上没有判别力）：
//   W＝idb.js 的写日志 `__wr-journal`：#943c 把「每次小键写都整包重写」改成 200ms 防抖，但「离页当场冲刷」被
//     写成「不管内容变没变都整本重写」。实测四次后台往返、一条数据都没改，仍 stringify＋同步 setItem 重写
//     8 次／552KB（单次约 42KB＝整个日志预算 66KB 的三分之二），而 WebKit 的 setItem 是同步持久写、且恰好
//     压在系统正要挂起页面那一拍。收口＝只问「要写的这份和库里那份是否逐字相同」，相同即跳过（与 #1311／#1222
//     同口径＝比内容不比引用身份）；内容真变了（含本会话从未落过的第一次）照旧必达＝#943c／#1257 一字未削。
//   M＝ta-ask.js 的好奇卡快答迁移：`migrated = true` 挂在「这条 id 在修复表里」上，而不是「这次真的改到了字」。
//     第一次就固化对的数据，之后每次读都「再迁一遍＋整包写回 22KB」＝永久空转；回前台经 mochi-fg-resume 会
//     走到两次，于是每次回前台两发 22KB 同步写，还顺手把 W 那本日志顶脏。收口＝逐格比对，改到字才算迁移。
//   R＝desktop-slider.js 两把帧尺（#690 翻页／#884 切回桌面）：#707 只挡「回调还在跑而页面已隐藏」，而真机
//     挂起时内核一帧都不派发 ⇒ 整段后台时长被量成「一帧」——「最慢 20828ms／25575ms」就是这么来的（它自己
//     的 hid＝0 就是铁证：声称一帧后台都没剔）。这条读数连续把 #1225／#1300／#1301 三批的优先级带去「修切回
//     桌面」。收口＝沿用 perf-check.js 早已在用的那把尺（可见性翻转＝一次边界，跨边界的差值不作数），两把尺
//     共用一个一次性消费的挂起标志；#707 那一行（#707h 针）一个字未动。
// 断言（同一 tab、真实覆写 document.hidden、rAF 停存夹具模拟「挂起期一帧都不派发」）：
//   S1~S7 静态锚（src＋产物各 7 处）＋S8 删除型（旧「无条件置 migrated」形态不得回流）
//   W0 前提：观察器真数得到 __wr-journal 的同步写（W 组一切读数的地基；为 0 时本组无意义）
//   W1 四次后台往返＋零数据改动 ⇒ __wr-journal 一个字节都不再写（判别核心；HEAD 侧 ≥2 次／约 84KB+）
//   W2 真改动仍然必达：写一个小键后立刻切后台 ⇒ 落盘恰一次且内容含这条（防呆：不许把防丢语义一起削掉）
//   W3 内容闸不是闩锁：再切两轮后台 ⇒ 依旧零重写（防「只挡第一次」）
//   W4 启动期那次重写照旧发生（LS 被回滚时的自愈断言＝_wrjLanded 初始为 null 的那一发；两侧皆绿＝旧契约没动）
//   M1 前提：库里的快答确实被迁成「我身边」且落过一次盘（迁移本身没被改坏）
//   M2 迁移落库之后两次后台往返 ⇒ 这一键零同步写回（判别核心；HEAD 侧每次回前台再写 22KB）
//   R1~R5 翻页尺：样本攒满、跨边界那一差不进样本（最慢帧远小于停存时长）、且计入 hid；不跨边界的正常样本不受影响
//   T1~T3 切回桌面尺同款（这条路径的旧读数＝「平均 1196ms／最慢 20828ms」）
//   N1 #707h 旧行为（回调看见 hidden）一字未动；N2 #1295 现场快照 sc/ph 两字段仍在
//   Z1 全程零未捕获 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
console.log('被测根目录: ' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, budgetMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = false; try { v = await fn(); } catch (e) { v = false; }
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 >= budgetMs) return { ok: false, ms: Date.now() - t0 };
    await sleep(stepMs || 200);
  }
}
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const NEEDLES = [
  ['S1', '写日志内容闸（与库里那份逐字相同就不再整本重写）', 'src/js/idb.js', 'js/idb.js', 'if (s === _wrjLanded) return;'],
  ['S2', '落盘成功才记「库里那份就是它」（写失败不许当成已落盘）', 'src/js/idb.js', 'js/idb.js', 'localStorage.setItem(WRJ_KEY, s); _wrjLanded = s;'],
  ['S3', '「迁移过了」只认真改了字', 'src/js/ta-ask.js', 'js/ta-ask.js', 'if (nextQuick.some((o, i) => o !== prevQuick[i])) { q.quick = nextQuick; migrated = true; }'],
  ['S4', '两把帧尺共用的挂起边界标志', 'src/js/desktop-slider.js', 'js/desktop-slider.js', 'let awayEdge = false;'],
  ['S5', '边界一次性消费（一次边界只作废一帧）', 'src/js/desktop-slider.js', 'js/desktop-slider.js', 'function awayGap() { if (!awayEdge) return false; awayEdge = false; return true; }'],
  ['S6', '翻页尺（#690）认挂起边界', 'src/js/desktop-slider.js', 'js/desktop-slider.js', 'if (awayGap()) { hid++; last = 0; requestAnimationFrame(tick); return; } // #1324'],
  ['S7', '切回桌面尺（#884）同款', 'src/js/desktop-slider.js', 'js/desktop-slider.js', 'if (document.hidden || awayGap()) { hid++; last = 0; requestAnimationFrame(tick); return; } // #1324'],
];
console.log('静态锚:');
for (const [tag, label, sf, pf, needle] of NEEDLES) {
  A_(tag + ' ' + label + '（源）', read(sf).includes(needle));
  A_(tag + ' ' + label + '（产物）', read(pf).includes(needle));
}
// S8 删除型：旧形态「映射完就无条件置 migrated」＝每次读都整包回写的本体，不许以任何形式回流
const OLD_SHAPE = 'q.quick = q.quick.map(o => fix[o] || o);\n          migrated = true;';
const OLD_SHAPE_PROD = 'q.quick = q.quick.map(o => fix[o] || o);\nmigrated = true;';
A_('S8 删除型：无条件置 migrated 的旧形态不得在产物里出现', !read('js/ta-ask.js').includes(OLD_SHAPE_PROD) && !read('src/js/ta-ask.js').includes(OLD_SHAPE), read('js/ta-ask.js').includes(OLD_SHAPE_PROD) ? '产物命中旧形态' : undefined);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9801 + Math.floor(Math.random() * 40));
const profile = join(process.env.TEMP || '/tmp', 'mochi-1324-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

function mkClient(wsUrl) {
  const c = { tag: 'x', pend: new Map(), id: 0, errors: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl); c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String((m.params.exceptionDetails || {}).text || '').slice(0, 160)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  c.evalJs = async (expr) => {
    try {
      const r = await Promise.race([
        c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
        new Promise((res) => setTimeout(() => res({ __tmo: 1 }), 15000)),
      ]);
      if (r && r.__tmo) { console.error('  [eval timeout] ' + expr.slice(0, 70)); return '__TMO__'; }
      if (r && r.exceptionDetails) { console.error('  [eval err]', String((r.exceptionDetails.exception || {}).description || '').slice(0, 200)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  return c;
}
async function listTargets() { return (await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json()); }
async function waitCdp() { for (let i = 0; i < 80; i++) { try { await listTargets(); return; } catch (e) { await sleep(200); } } throw new Error('no cdp'); }

// 早于全站脚本注入的同步写观察器：按键累计「次数＋字节＋同一份内容被连续重写的次数（dup）」，并留下最近一次
// 的值。W 组的判据取 dup 而非次数——「有改动时必达」是既有语义，要治的只是「一个字都没变也整本重写」。
const WATCH = `(function(){
  if (window.__1324w) return 'already';
  var w = { byKey: {}, val: {} };
  window.__1324w = w;
  var raw = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    try {
      var kk = String(k).replace('xy-home-v2:', '');
      var s = String(v == null ? '' : v);
      var o = w.byKey[kk] || (w.byKey[kk] = { n: 0, b: 0, dup: 0 });
      o.n++; o.b += s.length;
      if (w.val[kk] === s) o.dup++;   // 与上一次写出去的字节完全一样＝这一发纯属空转
      w.val[kk] = s;
    } catch (e) {}
    return raw.apply(this, arguments);
  };
  return 'ok';
})()`;
const T0 = `(function(){ window.__1324t0 = {}; for (var k in window.__1324w.byKey) window.__1324t0[k] = window.__1324w.byKey[k].n; return 1; })()`;
const RDR = (key) => `(function(){var a=window.__1324w.byKey['${key}']||{n:0,b:0,dup:0},t=window.__1324t0||{};return JSON.stringify({n:a.n-((t['${key}'])||0),dup:a.dup,b:a.b})})()`;

// 真实前后台夹具（#1300 同款）：覆写 document.hidden／visibilityState 后派发事件，#913 暂停类与大键释放都读它
const HIDE = `(function(){try{window.__1324f={d:Object.getOwnPropertyDescriptor(Document.prototype,'hidden'),v:Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState')};Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true}});Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden'}});document.dispatchEvent(new Event('visibilitychange'));}catch(e){return String(e&&e.message||e)}return 'hid'})()`;
const SHOW = `(function(){try{if(window.__1324f&&window.__1324f.d)Object.defineProperty(document,'hidden',window.__1324f.d);if(window.__1324f&&window.__1324f.v)Object.defineProperty(document,'visibilityState',window.__1324f.v);document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('mochi-fg-resume'));}catch(e){return String(e&&e.message||e)}return 'shown'})()`;
// rAF 停存＝真机挂起「一帧都不派发」的等价形态：停存期间不跑任何回调，放行时机由夹具决定（R 组地基）
const PARK = `(function(){
  if (window.__1324parked) return 'already';
  window.__1324raw = window.requestAnimationFrame.bind(window);
  window.__1324q = []; window.__1324on = false;
  window.requestAnimationFrame = function (cb) { if (window.__1324on) { window.__1324q.push(cb); return -1; } return window.__1324raw(cb); };
  window.__1324parked = true;
  return 'ok';
})()`;
const PARK_ON = "(function(){window.__1324on = true; return 1})()";
const PARK_GO = "(function(){window.__1324on = false; var q = window.__1324q; window.__1324q = []; q.forEach(function(cb){ try { window.__1324raw(cb); } catch(e){} }); return q.length})()";

let C = null;
try {
  await waitCdp();
  C = mkClient((await listTargets()).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await C.connect();
  await C.cdp('Page.enable'); await C.cdp('Runtime.enable');
  await C.cdp('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
  await C.cdp('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  await C.cdp('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await C.cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,service_workers' });
  // 好奇卡种子：cw4 的快答是【迁移前】的旧字面值 ⇒ 首读必迁一次（M1），迁完就该静默（M2）
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  await C.evalJs(`(function(){ try { localStorage.setItem('xy-home-v2:default:ta-curious', JSON.stringify({ settings: { enabled: false, prob: 0, probLowV313: true }, questions: [ { id: 'cw4', text: 'x', quick: ['你身边', '书桌边'], isPreset: true } ], history: [] })); } catch (e) {} return 1; })()`);
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await C.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(600);
  await C.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}['ta-ask','ta-choose','ta-curious','ta-roast','ta-tacc'].forEach(function(k){try{var s2=window.activeStore();var r=s2.get(k);var d=r?JSON.parse(r):{};d.settings=d.settings||{};d.settings.enabled=false;s2.set(k,JSON.stringify(d));}catch(e){}});return true;})()");
  await sleep(600);
  console.log('夹具: ' + JSON.stringify(await C.evalJs("(function(){return {watch:window.__1324w?'on':'OFF',desk:!!document.getElementById('desktop-pages'),phone:!!document.getElementById('page-phone'),nodes:document.getElementsByTagName('*').length}})()")));
  await C.evalJs(PARK);

  console.log('\nW 组 写日志（__wr-journal）:');
  await C.evalJs(T0);
  const seenAny = JSON.parse(await C.evalJs(`(function(){return JSON.stringify(window.__1324w.byKey['__wr-journal']||{n:0,b:0,dup:0})})()`));
  A_('W0 前提：观察器真的数到了 __wr-journal 的同步写（否则本组一切读数无意义）', seenAny.n >= 1, seenAny);
  A_('W4 启动期那次重写照旧发生（LS 被回滚时的自愈断言＝内容闸初始为 null 的那一发）', seenAny.n >= 1, seenAny);
  for (let i = 0; i < 4; i++) { await C.evalJs(HIDE); await sleep(700); await C.evalJs(SHOW); await sleep(700); }
  const w1 = JSON.parse(await C.evalJs(RDR('__wr-journal')));
  A_('W1 四次后台往返·零数据改动 ⇒ 同一份日志不再被逐字重写（判别核心；取 dup 不取次数，真改动仍算必达）', w1.dup === 0, w1);
  await C.evalJs(`(function(){try{window.activeStore().set('verify-1324-probe', JSON.stringify({hit:1}))}catch(e){}return 1})()`);
  await sleep(300);
  await C.evalJs(HIDE); await sleep(200); await C.evalJs(SHOW); await sleep(400);
  const w2 = JSON.parse(await C.evalJs(`(function(){return JSON.stringify({inLs:(localStorage.getItem('xy-home-v2:__wr-journal')||'').indexOf('verify-1324-probe')>=0})})()`));
  A_('W2 真改动仍然必达：写一个小键→切后台→日志里就有这一条（防呆闸，不许把 #943c/#1257 一起削掉）', w2.inLs === true, w2);
  await C.evalJs(T0);
  for (let i = 0; i < 3; i++) { await C.evalJs(HIDE); await sleep(500); await C.evalJs(SHOW); await sleep(500); }
  const w3 = JSON.parse(await C.evalJs(RDR('__wr-journal')));
  A_('W3 内容闸不是闩锁：此后每一轮零改动的往返同样零重写', w3.dup === 0, w3);

  console.log('\nM 组 好奇卡快答迁移:');
  const m1 = JSON.parse(await C.evalJs(`(function(){
    var raw = localStorage.getItem('xy-home-v2:default:ta-curious') || '';
    var hit = false; try { var d = JSON.parse(raw); hit = !!(d && d.questions && d.questions[0] && d.questions[0].quick && d.questions[0].quick.indexOf('我身边') >= 0); } catch (e) {}
    var a = window.__1324w.byKey['default:ta-curious'] || { n: 0, b: 0 };
    return JSON.stringify({ fixed: hit, writes: a.n, bytes: a.b });
  })()`));
  A_('M1 前提：库里的快答确实被迁成「我身边」并且落过一次盘（迁移本身没被改坏）', m1.fixed === true && m1.writes >= 1, m1);
  await C.evalJs(T0);
  for (let i = 0; i < 3; i++) { await C.evalJs(HIDE); await sleep(600); await C.evalJs(SHOW); await sleep(600); }
  const m2 = JSON.parse(await C.evalJs(RDR('default:ta-curious')));
  A_('M2 迁完之后三次后台往返 ⇒ 这一键零同步写回（HEAD 侧每次回前台再整包写 22KB）', m2.n === 0, m2);

  console.log('\nR 组 翻页帧尺（#690）:');
  // ⚠️ 夹具纪律（本脚本第一版在这里假红过）：无头里给 `#desktop-pages` 赋 scrollLeft 会被
  //   scroll-snap 立刻吸回 0、真触摸滑动也量不到 scroll 事件（实测 scroll 计数恒 0）＝采样器根本
  //   没起采，于是「样本没落键」被误报成「修复没生效」。起采一律走合成 scroll 事件——本组测的是
  //   采样器对「跨挂起边界的差值」的算术，不是内核怎么派发滚动。
  const deskKey = "'xy-home-v2:__diag-deskperf'";
  const armDesk = "(function(){document.getElementById('desktop-pages').dispatchEvent(new Event('scroll'));return 1})()";
  const readKey = (k) => `(function(){return localStorage.getItem(${k})||'null'})()`;
  // 等样本落键并**把值取回来**（waitFor 只回 {ok,ms}——第一版在这里写成了 .value，恒 undefined＝
  // 一整组「读不到」被当成「修复没生效」，红得毫无意义。判据必须能分辨「没落键」与「读法错」。）
  const grab = async (k) => { let v = null; await waitFor(async () => { const s = await C.evalJs(readKey(k)); v = s && s !== 'null' ? JSON.parse(s) : null; return !!v; }, 9000, 200); return v; };
  await C.evalJs("(function(){try{localStorage.removeItem(" + deskKey + ")}catch(e){}return 1})()");
  await C.evalJs(armDesk);
  await sleep(200);
  await C.evalJs(PARK_ON);
  await sleep(120);
  await C.evalJs(HIDE);
  await sleep(900); // 挂起期：rAF 全部停存＝内核一帧都不派发
  await C.evalJs(SHOW); // 先恢复可见，再放行 ⇒ 没有任何一次回调看见过 hidden（旧尺子因此把这 900ms 记成一帧）
  await C.evalJs(PARK_GO);
  const r1v = await grab(deskKey);
  // #1467 重基线：夹具只发一发合成 scroll 就挂起 900ms，恢复时「翻页」早已停——按新契约当场截短收笔。
  // n>=10＋cut=1＝尺子既没被夹具饿死、截短语义也在场；旧「攒满 60 帧」口径随 #1467 截短退役。
  A_('R1 前提：停存夹具之后翻页样本仍然落键（没被夹具饿死；恢复时翻页已停＝按 #1467 契约截短）', !!r1v && r1v.n >= 10 && r1v.cut === 1, r1v && { n: r1v.n, cut: r1v.cut });
  A_('R2 跨挂起边界那一差不进样本：最慢帧远小于停存时长 900ms', !!r1v && r1v.worst < 400, r1v && { worst: r1v.worst, mean: r1v.mean, hid: r1v.hid });
  A_('R3 被丢弃的挂起边界如实计入 hid（尺子自证剔过几帧，不静默吞）', !!r1v && r1v.hid >= 1, r1v && { hid: r1v.hid });
  A_('R4 现场快照两字段仍在（#1295 的 sc/ph 一字未动）', !!r1v && typeof r1v.sc === 'string' && typeof r1v.ph === 'string', r1v && { sc: r1v.sc, ph: r1v.ph });
  await C.evalJs("(function(){try{localStorage.removeItem(" + deskKey + ")}catch(e){}return 1})()");
  await C.evalJs(armDesk);
  const r5v = await grab(deskKey);
  // #1467 重基线：正常样本照常出数，但「60 帧量级」随截短退役——arm 那一眼 scroll 之后无人翻页，
  // ≥500ms 即截短；cut 字段必须是数值＝新代码带语义、旧代码（无字段）在此判红。
  A_('R5 不跨边界的正常样本照常出数（#1467 后 arm 后无人翻页＝500ms 截短收笔，cut 字段在场）', !!r5v && typeof r5v.cut === 'number' && r5v.n >= 10 && typeof r5v.mean === 'number', r5v);

  console.log('\nN 组 #707h 旧行为（回调真的看见 hidden＝不停存）:');
  await C.evalJs("(function(){try{localStorage.removeItem(" + deskKey + ")}catch(e){}return 1})()");
  await C.evalJs(armDesk);
  await sleep(200);
  await C.evalJs(HIDE);   // 不停存：rAF 照常派发 ⇒ 采样器自己能看见 document.hidden（#707 原本治的就是这一种）
  await sleep(400);
  await C.evalJs(SHOW);
  const n1v = await grab(deskKey);
  // #1467 重基线：截短后帧数变小，核心契约不变——hidden 期照旧剔除（hid>=1）、挂起间隙不冒充一帧（worst<400）。
  A_('N1 #707h 一字未动：回调看得见 hidden 时照旧剔除、且不记进样本（#1467 后样本可截短、hid/worst 契约不变）', !!n1v && n1v.n >= 10 && n1v.hid >= 1 && n1v.worst < 400, n1v);

  console.log('\nT 组 切回桌面帧尺（#884；#943e 限频 5 分钟＝每场加载只有一次起采机会）:');
  // ⚠️ 夹具纪律第二条：#943e 让 swSample 五分钟只发一次，而前面那十几发 visibilitychange 里任何一次
  //   「page-phone 的 hidden 被重设」都可能把这唯一一发预算花掉（实测：预算被别处花掉后本组恒 null，
  //   看起来就像修复没生效）。所以 T 组换一次全新加载，且它是这场加载里第一次取消隐藏桌面（T0 守这个前提）。
  const swKey = "'xy-home-v2:__diag-swperf'";
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await C.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(1200);
  await C.evalJs(PARK);
  await C.evalJs("(function(){try{localStorage.removeItem(" + swKey + ")}catch(e){}return 1})()");
  await C.evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-setting\"]');if(t)t.click();return !!t})()");
  await sleep(800); // 桌面整页隐藏
  const t0v = JSON.parse(await C.evalJs(`(function(){return JSON.stringify({phoneHidden:document.getElementById('page-phone').hidden,sw:!!localStorage.getItem(${swKey})})})()`));
  A_('T0 前提：这场加载里桌面确实被隐藏过、且 swperf 仍是空的（预算没被别处花掉）', t0v.phoneHidden === true && t0v.sw === false, t0v);
  await C.evalJs("(function(){document.getElementById('page-phone').hidden=false;return 1})()"); // 取消隐藏＝起采
  await sleep(200);
  await C.evalJs(PARK_ON);
  await sleep(100);
  await C.evalJs(HIDE);
  await sleep(900); // 挂起期一帧都不派发
  await C.evalJs(SHOW); // 先恢复可见再放行＝旧尺子的盲区
  await C.evalJs(PARK_GO);
  const t1v = await grab(swKey);
  A_('T1 前提：切回桌面样本真的攒满并落了键（30 帧量级）', !!t1v && t1v.n >= 20, t1v);
  A_('T2 跨挂起边界那一差不进样本（旧读数「最慢 20828ms／25575ms」正是这么量出来的）', !!t1v && t1v.worst < 400, t1v && { worst: t1v.worst, mean: t1v.mean, hid: t1v.hid });
  A_('T3 边界如实计入 hid（剔了几帧要能自证）', !!t1v && t1v.hid >= 1, t1v && { hid: t1v.hid });

  console.log('\nZ 组:');
  A_('Z1 全程零未捕获 JS 异常', C.errors.length === 0, C.errors.slice(0, 3));
} catch (e) {
  console.error('运行期异常：' + (e && e.stack || e));
  fail++;
} finally {
  if (C) { try { C.ws.close(); } catch (e) {} }
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 绿 / ' + fail + ' 红');
process.exit(fail ? 1 : 0);

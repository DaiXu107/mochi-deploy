// ===== 回归 #1291：后台通知「延迟+重复」三源收口——一条消息只弹一次 =====
// 用户追问（#1241 已入库后再报）：「为什么联系人发送的后台消息的弹窗还是会重复」。
// #1241 收口的是「内核回执不落地 → 四级阶梯重发＝4 次」；本条收的是它没覆盖的另外三源
// （零机型／零 UA 分支，判据只取通道调用次数与队列去向）：
//   ①「SW 未就绪 + 隐藏态」双通道叠发：swNotifyLater（就绪即补发）与 pageFallback（页面通道）
//      被同时执行——同一条消息当场交出去两次，SW 一旦就绪补发再弹第三条；
//   ② swLaterFlush 没有「回前台」判据：用户已回前台后补发队列才就绪 → 旧消息/已结束的通话
//      通知再炸一遍（补发本是给「隐藏态 SW 掉线」补投的，回前台用户已在应用里看见）；
//   ③ call.js holdIncomingCall：同一次响铃经「切后台→回前台重响→再切后台」反复触发，
//      每次都无条件 bgCallNotify → 同一次来电的通知跟着前后台来回攒。
// 用例（无头 CDP，真跑产物；VERIFY_ROOT 指被测副本）：
//   S1~S3 源锚（单通道行／flush 前台闸／来电 6s 去重）
//   S4~S6 登记表锚（#1291a／#1291b 两针在册且与 src 同源；既有 #614/#673 针已重锚）
//   S7~S8 产物锚（js/bg-keep.js、js/call.js 里三处修复都在）
//   B1 隐藏+SW 未就绪：一条消息只走「补发队列」一条腿（RED 本体①，旧写法＝页面通道也调一次）
//   B2 回前台后 SW 才就绪：补发不再执行（RED 本体②，旧写法＝旧消息回前台又弹一遍）
//   B3 隐藏+SW 就绪：SW 恰 1 次、页面通道 0（对照组，两侧皆绿）
//   B4 前台+SW 未就绪：页面通道恰 1 次（对照组：前台回退通道不被本批误伤）
//   B5 隐藏+SW 拿不到（60s 到点形态）：回前台出恢复条（对照组：有意跳过≠通道故障）
//   B6 6 秒内同名来电两次：系统通知恰 1 条（RED 本体③，旧写法＝2）
//   Z1 页面零 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
console.log('被测根目录：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = Number(process.env.MOCHI_CDP_PORT) || (12910 + Math.floor(Math.random() * 180));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1291-' + port + '-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
if (!ws) { console.error('CDP 连不上（端口 ' + port + ' 可能被占用）'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// SW 通道桩：本脚本不需要真 SW，只要「就绪／未就绪」两态可控（判据只取调用次数，不认内核名字）。
//   页面通道＝new Notification 计数；SW 通道＝假 reg.showNotification 计数（回执恒 resolve）。
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__notiCalls = [];
    window.__pageNoti = [];
    try {
      localStorage.setItem('xy-home-v2:bg-notify', '1');
      localStorage.setItem('xy-home-v2:bg-keepalive', '1');
      localStorage.setItem('xy-home-v2:applock-qaskip', '1');
    } catch (e) {}
    window.__forceHidden = function (v) {
      window.__mochiHidden = !!v;
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return window.__mochiHidden ? 'hidden' : 'visible'; } });
        Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return !!window.__mochiHidden; } });
      } catch (e) {}
      try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
    };
    window.__mkReg = function (tag) {
      return {
        tag: tag, active: {}, installing: null, waiting: null, scope: './',
        update: function () { return Promise.resolve(); },
        addEventListener: function () {},
        showNotification: function (title, opts) {
          var o = opts || {};
          window.__notiCalls.push({ title: String(title), body: String(o.body || ''), tag: tag, at: Date.now() });
          return Promise.resolve();
        }
      };
    };
    window.__swNewEpisode = function () {
      window.__swReadyPromise = new Promise(function (res) { window.__swReadyResolve = res; });
    };
    window.__swNewEpisode();
    window.__swSet = function (mode, tag) {
      if (mode === 'none') { window.__swMode = 'none'; window.__swNewEpisode(); return; }
      window.__swMode = 'ready';
      window.__swReg = window.__swReg || window.__mkReg(tag || 'stub');
      try { window.__swReadyResolve(window.__swReg); } catch (e) {}
    };
    // 「等到点仍拿不到 SW」形态（swNotifyLater 的 60s 窗口到点）＝以 null 落地，不是 reject：
    // device.js 把 unhandledrejection 也收进 __jsErrors，拒一个共享 ready 会污染 Z1 读数
    window.__swFail = function () { try { window.__swReadyResolve(null); } catch (e) {} };
    (function () {
      var swc = navigator.serviceWorker;
      if (!swc) return;
      try {
        Object.defineProperty(swc, 'ready', { configurable: true, get: function () { return window.__swMode === 'ready' ? Promise.resolve(window.__swReg) : window.__swReadyPromise; } });
        swc.getRegistration = function () { return Promise.resolve(window.__swMode === 'ready' ? window.__swReg : undefined); };
        swc.register = function () { return Promise.resolve(window.__swReg || window.__mkReg('boot')); };
      } catch (e) {}
      window.__swMode = 'none';
    })();
    var NO = window.Notification;
    window.Notification = function (t, o) { window.__pageNoti.push({ title: String(t), body: String((o || {}).body || ''), at: Date.now() }); };
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = function () { return Promise.resolve('granted'); };
    if (NO) { try { window.Notification.maxActions = NO.maxActions; } catch (e) {} }
  `
});
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(3000);
for (let i = 0; i < 80; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
try { await ev("(function(){ var s=document.getElementById('splash'); if (s) s.classList.add('hide'); return 1; })()"); } catch (e) {}

const results = []; const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  <- ' + detail : '')); };
const srcOf = (f) => { try { return readFileSync(join(root, 'src/js', f), 'utf8'); } catch (e) { return ''; } };
const artOf = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
const notiOf = async (mark) => JSON.parse(await ev("JSON.stringify(window.__notiCalls.filter(function (c) { return (c.title + ' ' + c.body).indexOf(" + JSON.stringify(mark) + ") >= 0; }))"));
const pageOf = async (mark) => JSON.parse(await ev("JSON.stringify(window.__pageNoti.filter(function (c) { return (c.title + ' ' + c.body).indexOf(" + JSON.stringify(mark) + ") >= 0; }))"));
const waitGate = async (mark) => { for (let i = 0; i < 20; i++) { const g = JSON.parse(await ev("JSON.stringify(window.bgNotifyGateInfo(" + JSON.stringify(mark) + "))")); if (!g || !g.tooFreshHidden) break; await sleep(1000); } };

// ===== S 组：源锚 + 产物锚（本批三处修复各在其位；旧写法即红） =====
const bk = srcOf('bg-keep.js'), cl = srcOf('call.js'), bm = artOf('build.mjs');
const artBk = artOf('js/bg-keep.js'), artCl = artOf('js/call.js');
t('S1 隐藏态单通道：SW 未就绪只挂补发队列、不再同时走页面通道',
  bk.includes("if (!reg) { if (hidden) { swNotifyLater(title, opts, chanOut); note('none'); resolve(false); } else { pageFallback(); } return; }"), '');
t('S2 补发 flush 加「回前台即作废」闸（有意跳过记 none、不进通道故障账）',
  bk.includes("for (let i = 0; i < swLaterQueue.length; i++) swNotifyNote('none', swLaterQueue[i].chanOut);"), '');
t('S3 来电挂起 6s 内同名不重复发系统通知',
  cl.includes("if (!justNotified) bgCallNotify(name, '快回来接听，对方会等你几分钟', avOverride);"), '');
t('S4 登记表 #1291a 的针与 src 同源（针在册、src/js/bg-keep.js 也命中；旧写法即红）',
  bm.includes('#1291a') && bk.includes('swLaterQueue[i].chanOut'), '');
t('S5 登记表 #1291b 的针与 src 同源（call.js）',
  bm.includes('#1291b') && cl.includes("if (!justNotified) bgCallNotify(name, '快回来接听，对方会等你几分钟', avOverride);"), '');
t('S6 既有 #614/#673 针已重锚到新的单通道行（不重锚＝旧 needle 找不到，构建报缺针）',
  bm.includes("note(\\'none\\'); resolve(false); } else { pageFallback(); } return; }") ||
  bm.includes("note('none'); resolve(false); } else { pageFallback(); } return; }"), '');
t('S7 产物 js/bg-keep.js 里两处修复都在（只改 src 没构建即红）',
  artBk.includes("if (!reg) { if (hidden) { swNotifyLater(title, opts, chanOut); note('none'); resolve(false); } else { pageFallback(); } return; }") &&
  artBk.includes("for (let i = 0; i < swLaterQueue.length; i++) swNotifyNote('none', swLaterQueue[i].chanOut);"), '');
t('S8 产物 js/call.js 里来电去重在（只改 src 没构建即红）',
  artCl.includes("if (!justNotified) bgCallNotify(name, '快回来接听，对方会等你几分钟', avOverride);"), '');

// ===== B1 隐藏 + SW 未就绪：一条消息只交出去一条腿 =====
await ev("window.__swSet('none')");
await ev('window.__forceHidden(true)');
await waitGate('一二九一甲');
await ev("window.showDeskPopup({ name: 'TA', text: '一二九一甲', isHidden: true })");
await sleep(6500);
const b1n = await notiOf('一二九一甲'), b1p = await pageOf('一二九一甲');
t('B1 隐藏+SW 未就绪：页面通道不得被同时调用（RED 本体①，旧写法＝1）', b1p.length === 0,
  'SW=' + b1n.length + ' page=' + b1p.length + ' ' + JSON.stringify(b1p).slice(0, 140));

// ===== B2 回前台后 SW 才就绪：补发不再执行 =====
await ev('window.__forceHidden(false)');
await sleep(400);
await ev("window.__swSet('ready', 'A')");
await sleep(1800);
const b2n = await notiOf('一二九一甲');
t('B2 回前台后就绪的补发不再执行（RED 本体②，旧写法＝回前台又弹一遍旧消息）', b2n.length === 0,
  'calls=' + b2n.length + ' ' + JSON.stringify(b2n).slice(0, 140));

// ===== B3 对照组：隐藏 + SW 就绪 = 恰走 SW 一次 =====
await ev('window.__forceHidden(true)');
await waitGate('一二九一乙');
await ev("window.showDeskPopup({ name: 'TA', text: '一二九一乙', isHidden: true })");
await sleep(3000);
const b3n = await notiOf('一二九一乙'), b3p = await pageOf('一二九一乙');
t('B3 隐藏+SW 就绪：SW 恰 1 次、页面通道 0（对照组，两侧皆绿）', b3n.length === 1 && b3p.length === 0,
  'SW=' + b3n.length + ' page=' + b3p.length);

// ===== B4 对照组：前台 + SW 未就绪 = 页面通道恰一次（迟到补弹语义：前台唯一会发系统通知的路径） =====
await ev("window.__swSet('none')");
await ev('window.__forceHidden(false)');
await sleep(300);
await ev("window.bgNotifyCheck('一二九一丙', Date.now(), { name: 'TA', late: true })");
await sleep(6500);
const b4n = await notiOf('一二九一丙'), b4p = await pageOf('一二九一丙');
t('B4 前台+SW 未就绪：页面通道恰 1 次（对照组：前台回退通道不被本批误伤）', b4p.length === 1 && b4n.length === 0,
  'SW=' + b4n.length + ' page=' + b4p.length);

// ===== B5 对照组：隐藏 + SW 拿不到（到点仍 null）＝补发队列记通道故障、回前台出恢复条 =====
await ev("window.__swSet('none')");
await ev('window.__forceHidden(true)');
await waitGate('一二九一丁');
await ev("window.showDeskPopup({ name: 'TA', text: '一二九一丁', isHidden: true })");
await sleep(5000);
await ev('window.__swFail()');   // 模拟「等到点仍拿不到 SW」：以 null 落地 → flush(null)
await sleep(600);
await ev('window.__forceHidden(false)');
await sleep(1600);
const heal = await ev("(function(){ var b=document.getElementById('notify-heal-bar'); var x=document.getElementById('notify-heal-txt'); return JSON.stringify({ hidden: b?!!b.hidden:null, txt: x?String(x.textContent):'' }); })()");
const healObj = JSON.parse(heal || '{}');
t('B5 通道真故障仍出恢复条（对照组：有意跳过≠故障，两侧皆绿）',
  healObj.hidden === false && /没能弹出/.test(healObj.txt) && /1 条/.test(healObj.txt), 'bar=' + heal);

// ===== B6 同名来电 6 秒内两次：系统通知恰 1 条 =====
await ev("window.__swSet('ready', 'C')");
await ev('window.__forceHidden(true)');
await sleep(300);
await ev("window.callHoldIncoming('一二九一来电', 'default', undefined, false)");
await sleep(1200);
await ev("window.callHoldIncoming('一二九一来电', 'default', undefined, false)");
await sleep(3000);
const b6 = await notiOf('一二九一来电');
t('B6 同名来电 6 秒内两次：系统通知恰 1 条（RED 本体③，旧写法＝2）', b6.length === 1,
  'calls=' + b6.length + ' ' + JSON.stringify(b6.map(function (c) { return c.title; })).slice(0, 160));

// ===== Z1 零异常 =====
const errs = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('Z1 页面零 JS 异常', errs === 0, 'jsErrors=' + errs + ' ' + JSON.stringify(await ev('(window.__jsErrors||[]).slice(0,3)')).slice(0, 200));

if (process.env.MOCHI_1291_DUMP) {
  console.log('NOTI=' + JSON.stringify(await ev('window.__notiCalls')).slice(0, 1600));
  console.log('PAGE=' + JSON.stringify(await ev('window.__pageNoti')).slice(0, 1200));
}

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter(r => r.ok).length;
console.log('==== verify-1291-notify-late-double: ' + pass + '/' + results.length + ' ====');
process.exit(pass === results.length ? 0 : 1);

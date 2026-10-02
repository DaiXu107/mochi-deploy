// ===== 回归 #1241：通知发送链「超时＝失败」假象——一条消息只弹一次 =====
// 用户实报（realme GT Neo6 SE／雨见浏览器，明说其他设备型号也有）：「发现同一个消息，手机会通知
// 四次，后台弹窗也会通知 4 次」。
// 根因（零机型／零 UA 分支，判据只取内核回执形态）：showSysNotification 的四级剥媒体降级阶梯
//   STRIP_LADDER（#614/#673/#705 为「媒体字段被内核挑掉」而设）把「超时」与「内核明确拒绝」当同
//   一种失败处理（tryNext）。而雨见这类第三方 Chromium 内核的实况是：通知**已经挂到系统**、
//   reg.showNotification() 返回的 Promise 却永不 settle ⇒ 每 4 秒重发一次、阶梯四级踩满＝同一条
//   消息弹 4 次（阶梯长度恰＝用户所报的 4）。收口＝未落地按「已挂出」结算并就此收手，明确拒绝
//   照旧逐级剥媒体（B3 是防修过头的对照组：阶梯语义必须原样保留）。同族双向假象见 #1218/#1227。
// 用例（无头 CDP，真跑产物；VERIFY_ROOT 指被测副本）：
//   S1~S3 源锚：收手闸／kaTimeout 旗标／诊断点名
//   B1 挂起内核：一条消息的 showNotification 恰 1 次（RED 判别点＝本批本体，旧写法为 4）
//   B2 未落地如实计数且发送链照常 settle（通道=sw，不吊着调用方）
//   B3 明确拒绝仍逐级剥媒体重发（对照组，两侧皆绿＝#614/#673/#705 语义未被修过头）
//   B4 正常内核仍恰 1 次（对照组，两侧皆绿）
//   B5 同内容再触发不补发（旧写法：阶梯耗尽后 resolve(false) 回滚去重账→同内容又弹一轮）
//   B6 全程只走 SW 通道，页面通道未被同时调用（防双通道叠发）
//   B7 页面零 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = Number(process.env.MOCHI_CDP_PORT) || (12410 + Math.floor(Math.random() * 180));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1241-' + port + '-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
if (!ws) { console.error('CDP 连不上（端口 ' + port + ' 可能被占用）'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 内核形态由 window.__notiKernel 逐次决定：'hang'＝通知照常交出、Promise 永不 settle（雨见实况）
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__notiCalls = [];
    window.__pageNoti = 0;
    window.__notiKernel = 'hang';
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
    (function () {
      const proto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
      if (proto && proto.showNotification && !proto.__v1241Wrapped) {
        proto.__v1241Wrapped = true;
        const orig = proto.showNotification;
        proto.showNotification = function (title, opts) {
          const o = opts || {};
          const rec = { title: String(title), body: String(o.body || ''), hasIcon: !!o.icon, hasBadge: !!o.badge, hasImage: !!o.image, kernel: window.__notiKernel, at: Date.now() };
          window.__notiCalls.push(rec);
          let r;
          try { r = orig.call(this, title, opts); } catch (e) { rec.threw = String(e && e.message || e).slice(0, 120); throw e; }
          if (window.__notiKernel === 'hang') return new Promise(function () {});
          if (window.__notiKernel === 'reject') return Promise.reject(new Error('sim-media-reject'));
          if (r && r.then) { r.then(function () { rec.resolved = true; }, function (e) { rec.rejected = String(e && e.message || e).slice(0, 120); }); }
          return r;
        };
      }
      const NO = window.Notification;
      if (NO) { window.Notification = function (t, o) { window.__pageNoti++; return new NO(t, o); }; window.Notification.permission = NO.permission; window.Notification.requestPermission = NO.requestPermission.bind(NO); }
    })();
  `
});
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(3000);
for (let i = 0; i < 80; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }

const results = []; const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  <- ' + detail : '')); };
const srcOf = (f) => { try { return readFileSync(join(root, 'src/js', f), 'utf8'); } catch (e) { return ''; } };
const callsOf = async (mark) => JSON.parse(await ev('JSON.stringify(window.__notiCalls.filter(function (c) { return c.body.indexOf(' + JSON.stringify(mark) + ') >= 0; }))'));

// ===== S 组：源锚（本批三处代码各在其位） =====
const bk = srcOf('bg-keep.js'), dv = srcOf('device.js');
t('S1 未落地收手闸在（退回旧的「超时也算失败→tryNext」即红）', bk.includes("if (e && e.kaTimeout) { notifyUnsettled++; note('sw'); resolve(true); return; }"), '');
t('S2 超时回执带 kaTimeout 旗标（把三态压回两态即红）', bk.includes("const te = new Error('ka-timeout'); te.kaTimeout = true; reject(te);"), '');
t('S3 诊断【保活现场】点名未落地次数', dv.includes("通知回执未落地="), '');

// ===== 隐藏态 + 过渡期闸门 =====
await ev('window.__forceHidden(true)');
for (let i = 0; i < 30; i++) { const g = JSON.parse(await ev("JSON.stringify(window.bgNotifyGateInfo('一二四一挂起内核甲'))")); if (!g.tooFreshHidden) break; await sleep(1000); }

const fire = (mark) => ev("window.bgNotifyCheck('一二四一验证消息 " + mark + "', Date.now(), { name: 'TA' })");

// B1 挂起内核：一条消息只交出去一次
await ev("window.__notiKernel = 'hang'");
const t0 = Date.now();
await fire('甲');
await sleep(6000);
let c1 = await callsOf('甲');
t('B1a 挂起内核首跳恰 1 次 showNotification（旧写法此际已 2 次）', c1.length === 1, 'calls=' + c1.length);
// 旧写法在第 4/8/12 秒各补一跳（阶梯 4 级），最迟 ~16s 落定；红侧一见 >1 即可早停
let c1n = c1.length;
while (Date.now() - t0 < 24000) { c1n = (await callsOf('甲')).length; if (c1n > 1) break; await sleep(1000); }
t('B1 通知已挂出但 Promise 永不 settle 的内核：一条消息恰 1 次（RED 本体，旧写法＝4）', c1n === 1, 'calls=' + c1n + ' / 等 ' + (Date.now() - t0) + 'ms');

// B2 未落地如实计数，且发送链照常 settle（不吊调用方、通道说真话）
const ch = await ev('window.bgNotifyLastChannel && window.bgNotifyLastChannel()');
const nu = await ev('(typeof window.bgNotifyUnsettled === "function") ? window.bgNotifyUnsettled() : -1');
t('B2a 未落地次数如实上报=1（诊断据此点名；旧写法＝无此读数/或记成失败）', nu === 1, 'unsettled=' + nu);
t('B2b 发送链照常结算、通道仍为 sw', ch === 'sw', 'channel=' + ch);

// B3 明确拒绝＝阶梯的正题，照旧逐级剥媒体（对照组：两侧皆绿，防把 #614/#673/#705 修过头）
await ev("window.__notiKernel = 'reject'");
await fire('乙');
await sleep(9000);
const c3 = await callsOf('乙');
const last3 = c3[c3.length - 1] || {};
t('B3 内核明确拒绝仍逐级剥媒体重发（4 级阶梯走完、末跳 badge/icon 已剥净）',
  c3.length === 4 && last3.hasBadge === false && last3.hasIcon === false && last3.hasImage === false,
  'calls=' + c3.length + ' last=' + JSON.stringify(last3).slice(0, 170));

// B4 正常内核仍恰 1 次（对照组：两侧皆绿＝健康设备一字不变）
await ev("window.__notiKernel = 'ok'");
await fire('丙');
await sleep(5000);
const c4 = await callsOf('丙');
t('B4 正常内核（Promise 会落地）仍恰 1 次且真 resolved', c4.length === 1 && c4[0].resolved === true, 'calls=' + JSON.stringify(c4).slice(0, 170));

// B5 挂起内核结算后，同内容再触发不得补发（旧写法：阶梯耗尽→resolve(false)→回滚去重账→又弹一轮）
const before5 = (await ev('window.__notiCalls.length'));
await ev("window.__notiKernel = 'hang'");
await fire('甲');
await sleep(9000);
const after5 = await ev('window.__notiCalls.length');
t('B5 同内容再触发不补发（未落地已按受理记账，不再回滚）', after5 === before5, 'before=' + before5 + ' after=' + after5);

// B6 全程只走 SW 通道
const pn = await ev('window.__pageNoti');
t('B6 页面通道未被同时调用（双通道叠发＝另一条重复来源）', pn === 0, 'pageNoti=' + pn);

// B7 零异常
const errs = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('B7 页面零 JS 异常', errs === 0, 'jsErrors=' + errs);

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter(r => r.ok).length;
console.log('==== verify-1241-notify-settle-once: ' + pass + '/' + results.length + ' ====');
process.exit(pass === results.length ? 0 : 1);

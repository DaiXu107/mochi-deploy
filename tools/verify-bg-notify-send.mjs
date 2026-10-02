// ===== 回归：后台通知发送链「真的把通知发出去」（#705 kaWithTimeout thunk 兼容） =====
// 用户直派（vivo X200S Edge，明说多机型）：「后台通知弹窗失效……以前是一直有弹窗的，现在
// 一直没有。这个问题很多手机都这样。基本上这个功能全部失效了。」
// 根因：#673 把 showNotification 调用改成传 thunk（function(){ return reg.showNotification(...) }），
//       但 kaWithTimeout 仍只认 Promise——函数没有 .then → TypeError 进 catch → reject →
//       STRIP_LADDER 四级降级被同一个 TypeError 连环「失败」秒耗尽 → resolve(false)，
//       reg.showNotification 从未执行、全程无报错。此前的 verify 只断言「Promise 会落定」
//       （settled≠sent），恰是盲区：修复前本脚本 T2 在旧产物上红（0 次调用）。
// 用例：
//   T1 环境：通知权限 granted + SW 已激活
//   T2 隐藏态 showDeskPopup(isHidden) → 恰 1 次 reg.showNotification、真正 resolve、urgency=high（RED 判别点）
//   T3 实际通道上报为 'sw'（测试按钮/诊断据此说真话）
//   T4 同内容重发被「已通知」指纹拦（不重复弹）
//   T5 force（来电形态）绕过去重闸门（错过就没了的单发事件不被吞）
//   T6 页面零 JS 异常
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
const port = 11500 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vbns-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 只包一层（diag 脚本曾双层包裹造成「重复通知」假象）；顺带记录页面通道 Notification 构造
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__notiCalls = [];
    window.__pageNoti = 0;
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
      if (proto && proto.showNotification && !proto.__vbnsWrapped) {
        proto.__vbnsWrapped = true;
        const orig = proto.showNotification;
        proto.showNotification = function (title, opts) {
          const o = opts || {};
          const rec = { title: String(title), urgency: o.urgency, hasBadge: !!o.badge, hasIcon: !!o.icon, body: String(o.body || '').slice(0, 40), at: Date.now() };
          window.__notiCalls.push(rec);
          try {
            const r = orig.call(this, title, opts);
            if (r && r.then) { r.then(function () { rec.resolved = true; }, function (e) { rec.rejected = String(e && e.message || e).slice(0, 120); }); }
            return r;
          } catch (e) { rec.threw = String(e && e.message || e).slice(0, 120); throw e; }
        };
      }
      const NO = window.Notification;
      if (NO) { window.Notification = function (t, o) { window.__pageNoti++; return new NO(t, o); }; window.Notification.permission = NO.permission; window.Notification.requestPermission = NO.requestPermission.bind(NO); }
    })();
  `
});
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }

const results = []; const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  ← ' + detail : '')); };

// T1 环境就绪
const perm = await ev('Notification.permission');
const swOk = await ev("navigator.serviceWorker.getRegistration().then(function(r){return !!(r&&r.active);})");
t('T1 环境就绪（perm=granted 且 SW active）', perm === 'granted' && swOk === true, 'perm=' + perm + ' sw=' + swOk);

// 隐藏态（等待过渡期 15s 闸门过期）
await ev('window.__forceHidden(true)');
for (let i = 0; i < 30; i++) { const g = JSON.parse(await ev("JSON.stringify(window.bgNotifyGateInfo('七零五通知链验证消息'))")); if (!g.tooFreshHidden) break; await sleep(1000); }

// T2 真实入口触发 → 恰 1 次 SW showNotification 且真正 resolve
await ev("window.showDeskPopup({ name: 'TA', text: '七零五通知链验证消息', isHidden: true })");
await sleep(2500);
const calls1 = JSON.parse(await ev('JSON.stringify(window.__notiCalls)'));
t('T2 隐藏态通知真的发出（恰 1 次、resolved、urgency=high）',
  calls1.length === 1 && calls1[0].resolved === true && calls1[0].urgency === 'high',
  'calls=' + JSON.stringify(calls1).slice(0, 220));

// T3 通道上报为 sw（诊断/测试按钮说真话）
const ch = await ev('window.bgNotifyLastChannel && window.bgNotifyLastChannel()');
t('T3 实际通道=sw', ch === 'sw', 'channel=' + ch);

// T4 同内容重发被已通知指纹拦（无新增调用）
await ev("window.showDeskPopup({ name: 'TA', text: '七零五通知链验证消息', isHidden: true })");
await sleep(1500);
const n2 = await ev('window.__notiCalls.length');
t('T4 同内容重发不再弹（去重指纹生效）', n2 === 1, 'notiCalls=' + n2);

// T5 force（来电形态）绕过去重
await ev("window.bgNotifyCheck('TA 来电了，快回来接听', Date.now(), { name: 'TA来电', avFixed: true, force: true })");
await sleep(2000);
const calls5 = JSON.parse(await ev('JSON.stringify(window.__notiCalls)'));
const last = calls5[calls5.length - 1] || {};
t('T5 force 来电通知放行（共 2 条、标题=TA来电）', calls5.length === 2 && last.title === 'TA来电' && last.resolved === true,
  'calls=' + calls5.length + ' last=' + JSON.stringify(last).slice(0, 160));

// T6 零 JS 异常
const errs = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('T6 页面零 JS 异常', errs === 0, 'jsErrors=' + errs);

// T7 自检按钮说真话（#708）：点击真实「测试」按钮 → 结果必须分层归因（SW 通道=「已真正提交系统显示」）
//   且 8s 超时哨兵不误触（正常链路应在 8s 内出结果）
await ev("document.getElementById('bg-notify-test') && document.getElementById('bg-notify-test').click()");
let toastTxt = '';
for (let i = 0; i < 18; i++) { await sleep(500); toastTxt = String(await ev("(function(){var t=document.getElementById('cc-toast'); return t?(t.textContent||''):'';})()")); if (toastTxt.indexOf('测试结果') >= 0) break; }
t('T7a 自检报出真实通道（SW=已真正提交系统显示）', toastTxt.indexOf('已发送并真正提交系统显示') >= 0 && toastTxt.indexOf('Service Worker 通道') >= 0, toastTxt.split('\n')[0] + ' | len=' + toastTxt.length);
t('T7b 超时哨兵不误触（正常链路不报「测试超时」）', toastTxt.indexOf('测试超时') < 0, '');
// T7c #724 端到端归因：受理≠挂出——结果必须含系统通知队列回读行（结果瘦身后的新自检层）
for (let i = 0; i < 12; i++) { if (toastTxt.indexOf('系统通知队列') >= 0) break; await sleep(500); toastTxt = String(await ev("(function(){var t=document.getElementById('cc-toast'); return t?(t.textContent||''):'';})()")); }
t('T7c 端到端归因：结果含系统通知队列回读行（#724 受理≠挂出）', toastTxt.indexOf('系统通知队列') >= 0, toastTxt.split('\n')[toastTxt.split('\n').length - 1]);

// T8 #761 旧包检测层：结果必含版本行（本地 version.json 与产物同批构建 → 期望「版本已最新」）
const hasVerLine = toastTxt.indexOf('版本已最新') >= 0 || toastTxt.indexOf('旧包正在运行') >= 0;
t('T8 自检含版本真伪行（#761 旧包检测）', hasVerLine, toastTxt.indexOf('版本') >= 0 ? toastTxt.split('\n').find((l) => l.indexOf('版本') >= 0) : '无版本行');

// T9 #761 结果问人本人：SW 发送成功后必弹「弹了吗」确认框；选「没看到」→ 按实效排序的实操指引
// #1014 起发送成功先给「第二段·后台阶段」入口（自测补上「切后台还弹不弹」那一半）；
//   用户选「不用了」＝只测第一段，这时照旧弹「弹了吗」确认框（#761 口径不丢）
let askShown = false, phase2Shown = false;
for (let i = 0; i < 16; i++) {
  await sleep(500);
  const st = await ev("(function(){var m=document.getElementById('modal-mask'), tt=document.getElementById('modal-title'); if(!(m && !m.hidden && tt)) return 'none'; var tx=(tt.textContent||''); var ps=[].map.call(document.querySelectorAll('#modal-pills .pill, #modal-pills button'),function(b){return b.textContent;}); return JSON.stringify({title:tx,pills:ps});})()");
  if (String(st).indexOf('自检确认') >= 0) { askShown = true; break; }
  if (String(st).indexOf('第二段') >= 0) {
    phase2Shown = true;
    await ev("(function(){var ps=document.querySelectorAll('#modal-pills .pill, #modal-pills button'); for(var i=0;i<ps.length;i++){ if(/不用了/.test(ps[i].textContent)) { ps[i].click(); return 1; } } return 0; })()");
    await sleep(600);
  }
}
t('T9a 发送成功后先给「第二段（切后台）」入口', phase2Shown, 'phase2Shown=' + phase2Shown);
for (let i = 0; i < 10 && !askShown; i++) { await sleep(500); askShown = await ev("(function(){var m=document.getElementById('modal-mask'); var tt=document.getElementById('modal-title'); return !!(m && !m.hidden && tt && (tt.textContent||'').indexOf('自检确认') >= 0);})()"); }
t('T9a2 不测第二段时照旧弹「弹了吗」确认框（#761 口径）', askShown, 'modalShown=' + askShown);
if (askShown) {
  const qStatic = String(await ev("(function(){var s=document.getElementById('modal-static'); return s?(s.textContent||''):'';})()"));
  t('T9b 确认框说明「通知栏≠屏幕上方横幅」', qStatic.indexOf('屏幕上方') >= 0, qStatic.slice(0, 40));
  await ev("(function(){var ps=document.getElementById('modal-pills').children; for (var i=0;i<ps.length;i++){ if((ps[i].textContent||'').indexOf('没看到')>=0){ ps[i].click(); return 1; } } return 0; })()");
  let guide = '';
  for (let i = 0; i < 10; i++) { await sleep(400); guide = String(await ev("(function(){var s=document.getElementById('modal-static'); return s?(s.textContent||''):'';})()")); if (guide.indexOf('重置浏览器通知权限') >= 0) break; }
  t('T9c 选「没看到」→ 实操指引含权限重开步（用户实测恢复项）', guide.indexOf('重置浏览器通知权限') >= 0, guide.slice(0, 50));
  t('T9d 指引含「屏幕上方显示」横幅开关与省电项', guide.indexOf('在屏幕上方显示') >= 0 && guide.indexOf('省电') >= 0, '');
  await ev("(function(){var o=document.getElementById('modal-ok'); if(o) o.click();})()");
}

// T10 收尾复查零 JS 异常（确认框/指引弹窗全链路不炸）
const errs2 = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('T10 新增自检层全链路零 JS 异常', errs2 === 0, 'jsErrors=' + errs2);

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter(r => r.ok).length;
console.log('==== verify-bg-notify-send: ' + pass + '/' + results.length + ' ====');
process.exit(pass === results.length ? 0 : 1);

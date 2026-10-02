// ===== 回归 #915：互动卡/心愿「后台没有弹窗」根治——真后台积压回前台迟到补弹 =====
// 用户直派（多机型，零机型分支）：「联系人发送的互动卡和心愿没有后台弹窗」。
// 根因：互动卡（询问/小问题/好奇/吐槽/查岗）与心愿卡的系统通知只在页面隐藏那一刻才弹；
// 后台被冻结/深度节流的触发链回前台补跑时页面已可见，bgNotifyCheck 的 visible 分支
// 「看见即已读」markSeen+return 把补弹永久吞掉。
// 修法：bg-keep 记录「本次回前台前在后台待了多久」(_fgFromHiddenFor) + window.bgLateCatchup
// 探针（默认 ≥60s 且回前台 ≤8s）；产生方（ta-ask/ck-question/gift-shop）据此打 extra.late，
// bgNotifyCheck 对 late 跳过 visible 吞弹但照常过全部去重闸门（seenDup/notifiedDup/
// recentChatDup/#780 身份闸），用户在聊天页时不补弹。
// 用例：
//   S1~S6 源码锚（bg-keep late 直通/时长记账/探针，ta-ask 导出+四调用点，ck-question，gift-shop）
//   B0 环境（perm=granted、SW active、数据就绪）
//   B1 bgLateCatchup 存在；B2 启动后无后台史→false
//   B3/B4 伪后台 1.5s 回前台：bgLateCatchup(1000,60000)=true、bgLateCatchup(60000)=false（时长是真测的）
//   B5 短后台 200ms→(1000) false（门槛真实生效）
//   B6 可见且非 late→照旧吞（对照组，HEAD 也过）
//   B7 可见且 late 且内容全新→真发出系统通知（RED 判别点：HEAD 恒 0 发）
//   B8 同内容 late 重发→被已发窗吞（绝不双弹）
//   B9/B10 前台真看过（非 late markSeen）→之后 late 同内容照样吞（seenDup 契约）
//   B11 interactLateNotify 停聊天页时=false（DOM 守卫）
//   B12 全程零 JS 异常
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
const port = 11700 + Math.floor(Math.random() * 200);
const profile = join(process.env.TEMP || '/tmp', 'mochi-vblc-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profile, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

const results = []; const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  ← ' + detail : '')); };

// ===== S 组：源码锚（读 VERIFY_ROOT/src，红绿副本同脚本自动对比） =====
const src = (f) => { try { return readFileSync(join(root, 'src/js', f), 'utf8'); } catch (e) { return ''; } };
const bgk = src('bg-keep.js'), task = src('ta-ask.js'), ckq = src('ck-question.js'), gsh = src('gift-shop.js');
t('S1 bg-keep visible 分支 late 直通（删＝迟到补弹被自己 markSeen 吞）', bgk.includes("if (document.visibilityState === 'visible') { if (!extra.late) { markSeen(nkey); return; } }"), '');
t('S2 bg-keep 回前台记时长（探针判据）', bgk.includes('_fgFromHiddenFor = lastHiddenAt > 0 ? now - lastHiddenAt : 0;'), '');
t('S3 bg-keep bgLateCatchup 探针导出', bgk.includes('window.bgLateCatchup = function (minHiddenMs, winMs)'), '');
t('S4 ta-ask 迟到判定导出＋四调用点带 late', task.includes('window.interactLateNotify = _lateNotify;') && (task.match(/late: _lateNotify\(\)/g) || []).length >= 4, 'sites=' + (task.match(/late: _lateNotify\(\)/g) || []).length);
t('S5 ck-question 查岗卡 late 复用', ckq.includes('late: !!(window.interactLateNotify && window.interactLateNotify())'), '');
t('S6 gift-shop 心愿卡 late 补发', gsh.includes("window.bgNotifyCheck(wishText, Date.now(), { name: partnerName() + '的心愿', late: true });"), '');

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__notiCalls = [];
    try {
      localStorage.setItem('xy-home-v2:bg-notify', '1');
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
      if (proto && proto.showNotification && !proto.__vblcWrapped) {
        proto.__vblcWrapped = true;
        const orig = proto.showNotification;
        proto.showNotification = function (title, opts) {
          const o = opts || {};
          const rec = { title: String(title), body: String(o.body || '').slice(0, 40), at: Date.now() };
          window.__notiCalls.push(rec);
          try {
            const r = orig.call(this, title, opts);
            if (r && r.then) { r.then(function () { rec.resolved = true; }, function (e) { rec.rejected = String(e && e.message || e).slice(0, 120); }); }
            return r;
          } catch (e) { rec.threw = String(e && e.message || e).slice(0, 120); throw e; }
        };
      }
    })();
  `
});
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }

// B0 环境
const perm = await ev('Notification.permission');
const swOk = await ev("navigator.serviceWorker.getRegistration().then(function(r){return !!(r&&r.active);})");
t('B0 环境就绪（perm=granted 且 SW active）', perm === 'granted' && swOk === true, 'perm=' + perm + ' sw=' + swOk);

// B1 探针存在
const probeType = await ev('typeof window.bgLateCatchup');
t('B1 bgLateCatchup 已导出', probeType === 'function', 'typeof=' + probeType);
if (probeType !== 'function') {
  // HEAD 产物没有探针：B2~B11 全按缺陷面记红，保持判别力可见
  t('B2 启动后无后台史→false', false, '探针缺失（HEAD 无 #915）');
  t('B4 真后台 1.5s 回前台→late 窗内 true', false, '探针缺失');
  t('B5 门槛按实测时长生效', false, '探针缺失');
  t('B6 可见非 late 照旧吞', false, '跳过');
  t('B7 可见+late 全新内容→真发出', false, '探针缺失（RED 判别点）');
  t('B8 同内容 late 重发被吞', false, '跳过');
  t('B10 前台看过→late 同内容仍吞', false, '跳过');
  t('B11 停聊天页不补弹', false, '跳过');
} else {
  // B2 启动后（从未进后台）不该报迟到
  const b2 = await ev('window.bgLateCatchup(1000, 9999999)');
  t('B2 启动后无后台史→false', b2 === false, 'v=' + b2);

  // B3/B4 伪后台 1.5s → 回前台：短门槛真、默认 60s 门槛不满足（证时长是实测非拍脑袋）
  await ev('window.__forceHidden(true)');
  await sleep(1500);
  await ev('window.__forceHidden(false)');
  await sleep(100);
  const b4a = await ev('window.bgLateCatchup(1000, 60000)');
  const b4b = await ev('window.bgLateCatchup(60000, 60000)');
  t('B4 真后台 1.5s 回前台→bgLateCatchup(1000)=true 且 (60000)=false', b4a === true && b4b === false, 'a=' + b4a + ' b=' + b4b);

  // B5 短后台 200ms → 1000ms 门槛不满足
  await sleep(1300); // 越过 1s 合并窗，保证本次 resume 独立记账
  await ev('window.__forceHidden(true)');
  await sleep(200);
  await ev('window.__forceHidden(false)');
  await sleep(100);
  const b5 = await ev('window.bgLateCatchup(1000, 60000)');
  t('B5 短后台 200ms→false（按实测后台时长判，不是回前台就放行）', b5 === false, 'v=' + b5);

  // B6 可见且非 late→吞（HEAD 同行为，对照组）
  await ev("window.bgNotifyCheck('九一五对照甲内容', Date.now(), { name: '九一五测试' })");
  await sleep(600);
  const n6 = await ev('window.__notiCalls.length');
  t('B6 可见非 late 照旧吞（前台看见即已读语义不回归）', n6 === 0, 'calls=' + n6);

  // B7 真后台回前台 + late + 全新内容 → 发出（RED 判别点）
  await sleep(1300);
  await ev('window.__forceHidden(true)');
  await sleep(1500);
  await ev('window.__forceHidden(false)');
  await sleep(100);
  await ev("window.bgNotifyCheck('九一五迟到补弹乙内容', Date.now(), { name: '九一五测试', late: true })");
  await sleep(2500);
  const calls7 = JSON.parse(await ev('JSON.stringify(window.__notiCalls)'));
  t('B7 可见+late+全新内容→恰 1 条系统通知真的发出', calls7.length === 1 && calls7[0].resolved === true, 'calls=' + JSON.stringify(calls7).slice(0, 200));

  // B8 同内容 late 重发 → 已发窗吞（绝不双弹）
  await ev("window.bgNotifyCheck('九一五迟到补弹乙内容', Date.now(), { name: '九一五测试', late: true })");
  await sleep(800);
  const n8 = await ev('window.__notiCalls.length');
  t('B8 同内容 late 重发被已发窗吞', n8 === 1, 'calls=' + n8);

  // B9/B10 前台真看过（非 late → markSeen）的内容，之后 late 补弹照样吞
  await ev("window.bgNotifyCheck('九一五看过丙内容', Date.now(), { name: '九一五测试' })");
  await sleep(300);
  await sleep(1300);
  await ev('window.__forceHidden(true)');
  await sleep(1500);
  await ev('window.__forceHidden(false)');
  await sleep(100);
  await ev("window.bgNotifyCheck('九一五看过丙内容', Date.now(), { name: '九一五测试', late: true })");
  await sleep(1500);
  const n10 = await ev('window.__notiCalls.length');
  t('B10 前台看过的内容 late 补弹仍被 seenDup 吞（不重弹已读）', n10 === 1, 'calls=' + n10);

  // B11 停在聊天页→interactLateNotify=false（卡片在眼前不再弹）。
  // _lateNotify 内部走默认 60s 门槛，伪后台只有 1.5s，这里临时把探针桩成 true 专测页守卫本身。
  await ev("(function(){window.__blcSaved = window.bgLateCatchup; window.bgLateCatchup = function () { return true; }; return 1;})()");
  const b11a = await ev('typeof window.interactLateNotify === "function" ? window.interactLateNotify() : "__MISS__"');
  await ev("(function(){var cp=document.getElementById('page-chat'); if(cp){cp.__was=cp.hidden; cp.hidden=false;} return 1;})()");
  const b11b = await ev('typeof window.interactLateNotify === "function" ? window.interactLateNotify() : "__MISS__"');
  await ev("(function(){var cp=document.getElementById('page-chat'); if(cp) cp.hidden=!!cp.__was; return 1;})()");
  await ev('(function(){window.bgLateCatchup = window.__blcSaved; return 1;})()');
  t('B11 late 判定含停聊天页守卫（页外 true / 页内 false）', b11a === true && b11b === false, 'out=' + b11a + ' in=' + b11b);
}

// B12 零 JS 异常
const errs = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('B12 全程零 JS 异常', errs === 0, 'jsErrors=' + errs);

try { chrome.kill(); } catch (e) {}
server.close();
try { const { rmSync } = await import('node:fs'); rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
const pass = results.filter(r => r.ok).length;
console.log('==== verify-bg-late-catchup @ ' + root + ': ' + pass + '/' + results.length + ' ====');
process.exit(pass === results.length ? 0 : 1);

// ===== 回归 #780：后台整页冻结后「积压重放」不该再弹系统通知，且保活双锚各自的断点在位 =====
// 用户直派（红米 24117RK2CC / Android 15 / Chrome 151，两条同根报障）：
//   ①「手机浏览器后台弹窗总是时有时没有，没有及时弹出」
//   ②「浏览器总是在我把浏览器切到后台的时候，突然弹窗之前前几分钟我看过的聊天消息」
// 真机取证（设置→工具→诊断信息）：音频=暂停 · 媒体条=playing · WebRTC=new —— 两条冻结豁免
//   同时失效 ⇒ Chromium 后台约 1 分钟整页冻结；解冻瞬间积压的回复链一口气重投，而 bg-keep
//   的三道内容去重窗口（已弹 2min／已看 3min／历史 5min）起点全是 Date.now()，冻结几分钟
//   就全部过期 ⇒ 刚在聊天里看过的内容被当新消息连弹进通知栏。
// 本脚本守的是「按消息身份拦重放」这条新判据（与文案、与冻结时长都无关），外加保活双锚的
//   接线静态核对——内容指纹窗口调宽窄的老路 v3.20.x 已证明会误吞同文案真消息，不再走。
// 用例（静态接线：产品码缺件即红，不必起浏览器）：
//   T1a 收件处打投递身份标（chat.js：dAt/dVis + __mochiMsgDelivered）
//   T2a 音乐元素只读出口已发布（music-player.js：window.__mochiMusic）
//   T3a 隐藏态媒体条只在「条还归保活自己」时才重申（治报障③：第三方标签页音乐被抢停）
//   T4a 通知受理后回写身份标（__mochiMsgNotified 两侧接线）
//   T5  让位判据带实效核验（musicNowPlaying 读元素 paused，标志假死不再误让位）
//   T6  WebRTC 回环等 ICE 采集完成再 flush（恒 'new' ＝第二豁免一直是死的）
//   T7a/T7b 取证面：__kaProbe 交出 music/pcGathering/pcCand，诊断行会报「在场信号矛盾」
// 用例（运行时行为断言，无头 Chrome + 真 SW 通知）：
//   T0 环境就绪  T1 在场投递落标且探针视为同一条投递链
//   T2 冻结重放按身份拦死（本批主判据）  T3 不在场首投照弹  T4 已弹过的不弹第二遍
//   T5 force（来电形态）绕过闸门  T6 页面零 JS 异常
// 用法：node tools/verify-bg-freeze.mjs            （测主树产物）
//       VERIFY_ROOT=<隔离构建目录> node tools/verify-bg-freeze.mjs   （测红/绿基线）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const results = [];
const t = (name, ok, detail) => { results.push({ name, ok }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  ← ' + detail : '')); };

// ---------- 静态接线（先跑：产品码缺件就没必要起浏览器） ----------
const bk = read('src/js/bg-keep.js'), cj = read('src/js/chat.js'), mp = read('src/js/music-player.js'), dv = read('src/js/device.js');
// #1374 重锚（同一把尺、两种坏法照旧都红）：T5 旧写法把「if (!window.__musicPlaying) return false;」
//   那一行（意图标志抢在元素真值之前的短路）当「实效核验」的证据，而 #1374c 判它正是漏掉的那半个
//   方向（元素在出声／标志还是 false ⇒ 判成「没在播」⇒ 保活音与音乐两路同响）。尺子改问：
//   ① 元素真值的两个方向都在（=== true 与 === false 各一条）；② 标志只作退路（return !!window.__musicPlaying）；
//   ③ 那条短路不再出现在 musicNowPlaying 体内。#780 要拦的两种坏法（标志假死不自检／拿不到元素时不let位）照旧都红。
const mnp = (bk.match(/function musicNowPlaying\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
t('T5 让位判据带实效核验（#1374c：双向，元素真值优先·标志只作退路）', /m\.el\.paused === true/.test(bk) && /m\.el\.paused === false/.test(bk) && /return !!window\.__musicPlaying;/.test(mnp) && !/if \(!window\.__musicPlaying\) return false;/.test(mnp), '');
t('T5b #1374d 假死自愈真起播（旧写法 unpause 不得回流）', /const pr = m\.el\.play\(\);/.test(bk) && !/\.unpause\(\)/.test(bk), '');
t('T6 WebRTC 等 ICE 采集完成再 flush', /iceGatheringState === 'complete'/.test(bk) && /Promise\.all\(\[gathered\(p1\), gathered\(p2\)\]\)/.test(bk), '');
t('T7a __kaProbe 交出在场信号与 ICE 读数', /music: music,/.test(bk) && /pcGathering:/.test(bk) && /pcCand:/.test(bk), '');
t('T7b 诊断行会报「在场信号矛盾」', dv.indexOf('在场信号矛盾') >= 0, '');
t('T1a 收件处打投递身份标', /rec\.dVis = \(document\.visibilityState === 'visible'/.test(cj) && /window\.__mochiMsgDelivered =/.test(cj), '');
t('T4a 通知回写身份标入口在位', /window\.__mochiMsgNotified = /.test(cj) && /__mochiMsgNotified\(extra\.msgTs, 'in'\)/.test(bk), '');
t('T2a 音乐元素只读出口已发布', /window\.__mochiMusic = \{ el: a, want:/.test(mp), '');
t('T3a 隐藏态媒体条只在仍归保活时才重申（不抢第三方标签页的媒体条）', /String\(md\.title\) === 'Mochi 后台保活'/.test(bk) && /if \(hold\) \{/.test(bk), '');
if (results.some((r) => !r.ok)) {
  // VBF_SKIP_STATIC=1：在不含本批修复的红副本上继续跑运行时，验证判据确实会红（有牙齿）
  if (!process.env.VBF_SKIP_STATIC) { console.log('静态接线不全（该构建不含本批修复＝RED 基线，符合预期）'); process.exit(1); }
  console.log('静态接线不全，按 VBF_SKIP_STATIC 继续跑运行时基线');
}

// ---------- 运行时行为断言 ----------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
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
const base = 'http://127.0.0.1:' + server.address().port;
const port = 11700 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vbf-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const pg = l.find((x) => x.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__notiCalls = [];
    try { localStorage.setItem('xy-home-v2:bg-notify', '1'); localStorage.setItem('xy-home-v2:bg-keepalive', '1'); localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e) {}
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
      if (proto && proto.showNotification && !proto.__vbfWrapped) {
        proto.__vbfWrapped = true;
        const orig = proto.showNotification;
        proto.showNotification = function (title, opts) {
          const rec = { title: String(title), at: Date.now() };
          window.__notiCalls.push(rec);
          try { const r = orig.call(this, title, opts); if (r && r.then) r.then(function () { rec.resolved = true; }, function (e) { rec.rejected = String(e && e.message || e).slice(0, 120); }); return r; }
          catch (e) { rec.threw = String(e && e.message || e).slice(0, 120); throw e; }
        };
      }
    })();
  `
});
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }

const perm = await ev('Notification.permission');
const swOk = await ev('navigator.serviceWorker.getRegistration().then(function(r){return !!(r&&r.active);})');
t('T0 环境就绪（perm=granted 且 SW active）', perm === 'granted' && swOk === true, 'perm=' + perm + ' sw=' + swOk);
if (perm !== 'granted' || swOk !== true) { console.log('环境不满足，跳过运行时断言'); server.close(); try { chrome.kill(); } catch (e) {} process.exit(2); }

// 打开聊天页：在场投递要落进聊天、且不当作「值得提醒」再弹一次
await ev("(function(){var t=document.querySelector('.tab[data-page=\"chat\"]')||document.getElementById('tab-chat');if(t)t.click();})()");
await sleep(1200);

// ---------- T1 在场投递打身份标 ----------
// 注意：chatAddIn 走带随机延迟的回复链，注入那一刻的 Date.now() ≠ 最终落进 msgs 的 rec.ts，
// 所以必须按唯一文本把那条回读出来，拿它的真实 ts 再判。
const READ_BY_TEXT = 'window.__readByText=function(s){var a=window.getChatMsgs&&window.getChatMsgs();if(!a)return null;for(var i=a.length-1;i>=0;i--){var m=a[i];if(m&&String(m.text||"").indexOf(s)>=0)return {ts:m.ts||0,dAt:m.dAt||0,dVis:m.dVis?1:0,nAt:m.nAt||0};}return null;};';
await ev(READ_BY_TEXT);
await ev('window.chatAddIn("七七七一在场投递验证", {})');
let rec1 = null;
for (let i = 0; i < 40; i++) { rec1 = JSON.parse(String(await ev('JSON.stringify(window.__readByText("七七七一在场投递验证"))'))); if (rec1 && rec1.dAt) break; await sleep(300); }
const ts1 = rec1 && rec1.ts ? rec1.ts : 0;
const probeNow = JSON.parse(String(await ev('JSON.stringify(window.__mochiMsgDelivered ? window.__mochiMsgDelivered(' + ts1 + ', "in") : "n/a")')));
t('T1 在场投递：dAt/dVis 落标（页面可见且在聊天页 ⇒ dVis=1），同一次投递链探针返 null',
  !!rec1 && rec1.dVis === 1 && !!rec1.dAt && probeNow === null,
  'rec=' + JSON.stringify(rec1) + ' probe=' + JSON.stringify(probeNow));

// ---------- T2 冻结重放被拦（本批主判据） ----------
// 文案换成三条内容窗都没见过的探针串：这样 HEAD 版必弹（判据为红），绿版只能靠【消息身份】
// 拦住——否则本用例只是在测旧的内容去重，没有牙齿。
await sleep(1400); // 越过「同一次投递链」200ms 判定线 ＝ 模拟解冻后的稍后时刻
const REPLAY_TEXT = '七七七一冻结重放探针';
await ev('window.__forceHidden(true)');
let g = {};
for (let i = 0; i < 30; i++) { g = JSON.parse(String(await ev("JSON.stringify(window.bgNotifyGateInfo('" + REPLAY_TEXT + "', '', " + ts1 + "))"))); if (!g.tooFreshHidden) break; await sleep(1000); }
const nBefore = await ev('window.__notiCalls.length');
const replayBefore = await ev('(window.bgNotifyGateStats&&window.bgNotifyGateStats().replay)||0');
await ev("window.bgNotifyCheck('" + REPLAY_TEXT + "', Date.now(), { name: 'TA', deliveredAt: 0, msgTs: " + ts1 + " })");
await sleep(1500);
const nAfter = await ev('window.__notiCalls.length');
const replayAfter = await ev('(window.bgNotifyGateStats&&window.bgNotifyGateStats().replay)||0');
t('T2 冻结重放不弹（在场投递过的同一条，按身份拦死）', nAfter === nBefore && replayAfter === replayBefore + 1,
  'notiCalls ' + nBefore + '→' + nAfter + ' replay=' + replayAfter + ' identityBlocked=' + g.identityBlocked);

// ---------- T3 不在场首投照弹（防拦截过头） ----------
await ev('window.__forceHidden(true)');
await sleep(400);
const tsOut = await ev('(Date.now() + 13)');
const n3 = await ev('window.__notiCalls.length');
await ev('window.chatAddGift({ side: "in", ts: ' + tsOut + ', text: "七七七一不在场首投验证" })');
await sleep(3000);
const n3b = await ev('window.__notiCalls.length');
const vis3 = await ev('(function(){var a=window.getChatMsgs&&window.getChatMsgs();for(var i=a.length-1;i>=0;i--){if(a[i]&&a[i].ts===' + tsOut + ')return a[i].dVis?1:0;}return "miss";})()');
t('T3 不在场首投照弹（dVis=0 不当重放）', n3b === n3 + 1 && vis3 === 0, 'notiCalls ' + n3 + '→' + n3b + ' dVis=' + vis3);

// ---------- T4 已弹过的同一条不再弹第二遍（nAt 回写） ----------
const n4 = await ev('window.__notiCalls.length');
const hasNAt = await ev('(function(){var a=window.getChatMsgs&&window.getChatMsgs();for(var i=a.length-1;i>=0;i--){if(a[i]&&a[i].ts===' + tsOut + ')return a[i].nAt?1:0;}return 0;})()');
await ev("window.bgNotifyCheck('七七七一不在场首投验证', Date.now(), { name: 'TA', deliveredAt: 0, msgTs: " + tsOut + " })");
await sleep(1500);
const n4b = await ev('window.__notiCalls.length');
t('T4 已弹过的不再弹第二遍（nAt 永久身份标，不吃 2 分钟内容窗）', n4b === n4 && hasNAt === 1, 'notiCalls=' + n4b + ' nAt=' + hasNAt);

// ---------- T5 force（来电形态）不受新闸门影响 ----------
const n5 = await ev('window.__notiCalls.length');
await ev("window.bgNotifyCheck('TA 来电了，快回来接听', Date.now(), { name: 'TA来电', avFixed: true, force: true })");
await sleep(2000);
// 隐藏期回复链本身还会合法弹通知（非本批回归），故按标题精确判定这次 force 是否落地
const n5b = await ev('window.__notiCalls.length');
const hit5 = await ev('(function(){var a=window.__notiCalls,n=0;for(var i=0;i<a.length;i++){if(a[i].title==="TA来电")n++;}return n;})()');
t('T5 force 一次性事件绕过身份闸门', hit5 >= 1, 'notiCalls ' + n5 + '→' + n5b + ' TA来电=' + hit5);

// ---------- T6 零 JS 异常 ----------
const errs = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('T6 页面零 JS 异常', errs === 0, 'jsErrors=' + errs);

const failed = results.filter((r) => !r.ok).length;
console.log('\n' + (failed ? 'RED ' : 'GREEN ') + (results.length - failed) + '/' + results.length + ' 通过');
server.close();
try { chrome.kill(); } catch (e) {}
process.exit(failed ? 1 : 0);

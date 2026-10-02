// ===== 回归脚本：#722 接通的电话切后台回前台被记「未接」（vivo X200S Edge 等多机型） =====
// 用法：node tools/verify-call-hold-ghost.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-call-hold-ghost.mjs   （测指定构建副本，RED 基线用）
// 根因（2026-09-18）：响铃挂起 call-hold 的消费墓碑 {ts:0} 对 IDB 是异步写——消费后进程被杀/
// 刷新（vivo/Edge 杀渲染进程常态）会让旧挂起残留 IDB；iOS 系统级清 LS 后 idbRestore 又拿 IDB
// 旧值回填进 LS（retainValue 的 LS 缺失回填）。resumeHeldCall 的 IDB 兜底路径对捞出的孤儿
// 【没有新鲜度检查】，resumeProcessHold 兜底分支【无条件补写「来电 · 未接听」】——用户接通了
// 电话（通话甚至刚被 recoverCall 恢复成接通态）后切后台回前台，聊天里凭空多一条未接系统消息。
// 修复＝三闸：①挂起带写入运行期标识 sid；②IDB 兜底卡 3 分钟新鲜度（超窗孤儿只重写墓碑自愈）；
// ③补写未接须「同运行期挂起 ＋ 此刻无活通话」。
// 断言：
//   A 轴（源码锚）：四条修复锚在位（失败只记 RED 不拦 B 轴——RED 基线靠 B1 行为红作证）。
//   B1（RED 判别核心，用户场景原样）：IDB 孤儿挂起（10 分钟前）＋ 新鲜 call-active（接通态）
//       → 刷新恢复通话 → 绝不允许补写「未接听」，通话保持接通，孤儿被墓碑自愈。
//   B4（回归护栏，用户流程字面）：来电→真实点接听→hidden/visible 循环（页面活着）——
//       不写挂起、不记未接、通话不断。
//   B2（产品语义保留）：同运行期「响铃切后台→超时未回」→ 仍补写未接（#161 挂起语义不回退）。
//   B3（#161 冷启动重响保留）：跨运行期 3 分钟内的挂起（LS 幸存、旧页面已不可能再消费——
//       等过 20s 兜底定时器再种子并立即换页）→ 新页面照常重响可接听，不记未接。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚（失败不退出，RED 基线要靠 B 轴行为红） ----------
let callSrc = '';
try { callSrc = readFileSync(join(root, 'src/js/call.js'), 'utf8'); } catch (e) {}
check('A1 挂起带写入运行期标识 sid', callSrc.includes('sid: HOLD_SID'));
check('A2 IDB 兜底挂起卡 3 分钟新鲜度（超窗孤儿只重写墓碑）', callSrc.includes('if (Date.now() - ih.ts > CALL_HOLD_MS) { clearCallHold(); return; }'));
check('A3 补写未接双闸（同运行期挂起＋无活通话）', callSrc.includes("if (!crossRun && !currentCall) notifyCallEnd(h.cid || cur, heldMissedHtml(h.name || partnerName()), 'in', '未接听');"));
check('A4 LS 路径把 sid 对照结果传给补未接判定', callSrc.includes('resumeProcessHold(h, h.sid !== HOLD_SID);'));

// ---------- B 轴：真实浏览器行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  process.exit(2);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9330 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-722-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
          }
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      jsErrors.push((r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 200));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function waitAppReady() {
  for (let i = 0; i < 80; i++) {
    const ok = await evalJs(`!!(window.placeCall && window.getCallState && window.triggerIncomingCall && window.idbGet)`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}
async function waitCallConnected(timeout = 10000) {
  for (let i = 0; i < Math.ceil(timeout / 300); i++) {
    const st = await evalJs(`JSON.stringify(window.getCallState ? window.getCallState() : null)`);
    try { const o = JSON.parse(st); if (o && o.status === 'connected') return o; } catch (e) {}
    await sleep(300);
  }
  return null;
}
// 读主页通话记录里「未接听」条目数
const REC_READ = `(function(){
  var raw = null; try { raw = localStorage.getItem('xy-home-v2:default:records-call'); } catch(e){}
  var arr; try { arr = JSON.parse(raw || '[]'); } catch(e){ arr = []; }
  if (!Array.isArray(arr)) arr = [];
  return arr.filter(function(r){ return r && String(r.text||'').indexOf('未接听') >= 0; }).length;
})()`;
async function missedCount() {
  const n = await evalJs(REC_READ);
  return typeof n === 'number' ? n : -1;
}
// 钉死随机数（防 maybeIncoming 45~120s 兜底定时器在测试窗口内掷中 15% 来电搅局）
const PIN_RANDOM = `Math.random = (function(orig){ return function(){ return 0.5; }; })(Math.random); 'pinned'`;
// 真实 dispatch visibilitychange 的隐藏/可见对（visibilityState 只读，defineProperty 覆写）
const VIS = (state) => `(function(){
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return '${state}'; } });
  document.dispatchEvent(new Event('visibilitychange'));
  return '${state}';
})()`;

const HOLD_KEY = 'xy-home-v2:call-hold';
const CALL_KEY = 'xy-home-v2:call-active';
try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('应用未就绪');
  await evalJs(PIN_RANDOM);

  // ---- B1（RED 核心）：IDB 孤儿挂起 + 新鲜接通态 call-active → 刷新恢复通话 → 不得记未接 ----
  // 种子：IDB 放一条 10 分钟前的旧挂起（墓碑 flush 被杀打断的形态）；LS 不放 call-hold
  //（iOS 清 LS 后被 idbRestore 回填的形态由回填链自然复现）；LS 放新鲜 call-active
  //（接通中＝recoverCall 要恢复的那通已接电话）；SS 清空防旧墓碑短路恢复链。
  await evalJs(`(async function(){
    await window.idbSet('${HOLD_KEY}', { ts: Date.now()-600000, name: 'TA', cid: 'default', msg: false });
    try { localStorage.setItem('${CALL_KEY}', JSON.stringify({ cid:'default', direction:'in', status:'connected',
      startTime: Date.now()-60000, connectedTime: Date.now()-50000, name:'TA', av:'', ts: Date.now() })); } catch(e){}
    try { sessionStorage.removeItem('${CALL_KEY}'); } catch(e){}
    try { localStorage.removeItem('${HOLD_KEY}'); } catch(e){}
    return 'seeded';
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('刷新后应用未就绪');
  await evalJs(PIN_RANDOM);
  await sleep(2600); // mochi-restore-done → bootCallResume(recoverCall + 1200ms resumeHeldCall) 落定
  const b1conn = await waitCallConnected(4000);
  const b1 = await evalJs(`(function(){
    var raw = null; try { raw = localStorage.getItem('${HOLD_KEY}'); } catch(e){}
    var tomb = false; try { tomb = !!raw && JSON.parse(raw).ts === 0; } catch(e){}
    return JSON.stringify({ tomb: tomb });
  })()`);
  let b1o = null; try { b1o = JSON.parse(b1); } catch (e) {}
  const b1missed = await missedCount();
  check('B1 接通态刷新恢复后：IDB 孤儿挂起不补「未接」、通话续上、孤儿被墓碑自愈',
    b1missed === 0 && !!b1conn && !!b1o && b1o.tomb,
    'missed=' + b1missed + ' conn=' + JSON.stringify(b1conn) + ' holdTomb=' + (b1o && b1o.tomb));

  // ---- B4（用户流程字面）：先挂断 B1 恢复的通话，再走 来电→真实接听→hidden/visible 循环 ----
  await evalJs(`window.hangupCall(); 'hungup'`);
  await sleep(300);
  await evalJs(`window.triggerIncomingCall(); 'ringing'`);
  await sleep(400);
  const b4ans = await evalJs(`(function(){
    var b = document.getElementById('call-answer-btn'); if (!b) return 'no-btn'; b.click(); return 'answered';
  })()`);
  const b4conn = await waitCallConnected();
  await evalJs(VIS('hidden'));
  await evalJs(VIS('visible'));
  await sleep(600);
  const b4missed = await missedCount();
  const b4st = JSON.parse(await evalJs(`JSON.stringify(window.getCallState ? window.getCallState() : null)`) || 'null');
  const b4h = JSON.parse(await evalJs(`(function(){
    var raw = null; try { raw = localStorage.getItem('${HOLD_KEY}'); } catch(e){}
    var ts = -1; try { ts = JSON.parse(raw || '{"ts":1}').ts; } catch(e){}
    return JSON.stringify({ noHold: ts === 0 });
  })()`) || 'null');
  check('B4 来电真实接听后切后台回前台（无刷新）：不写挂起、不记未接、通话保持',
    b4ans === 'answered' && !!b4conn && b4missed === 0 && !!b4st && b4st.status === 'connected' && !!b4h && b4h.noHold,
    'ans=' + b4ans + ' missed=' + b4missed + ' status=' + (b4st && b4st.status) + ' noHold=' + (b4h && b4h.noHold));
  await evalJs(`window.hangupCall(); 'hungup'`);
  await sleep(300);

  // ---- B2（语义保留）：同运行期响铃切后台 → 超时（拨快时钟 4 分钟）未回 → 仍补写未接 ----
  await evalJs(`window.triggerIncomingCall(); 'ringing'`);
  await sleep(400);
  const b2 = await evalJs(`(function(){
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return 'hidden'; } });
    document.dispatchEvent(new Event('visibilitychange'));   // 真实 sid 挂起写入（endCall 静默收尾）
    var orig = Date.now;
    Date.now = function(){ return orig.call(Date) + 240000; }; // 拨快 4 分钟＝超过 3 分钟挂起窗
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return 'visible'; } });
      document.dispatchEvent(new Event('visibilitychange'));  // resumeHeldCall：同运行期过期挂起 → 补未接
    } finally { Date.now = orig; }
    return 'done';
  })()`);
  await sleep(500);
  const b2missed = await missedCount();
  check('B2 同运行期挂起超时未回：仍补写「未接」（#161 语义不回退）', b2 === 'done' && b2missed >= 1, 'missed=' + b2missed + ' flow=' + b2);

  // ---- B3（冷启动重响保留）：跨运行期 3 分钟内的挂起 → 新页面照常重响 ----
  // 编排要点（两处都是无头编排的坑，不是产品行为）：
  //   ①等本页超过 20s 兜底定时器再种子——旧页面若还活着会把挂起消费掉（消费即重响、
  //     语义正确），新页面就无挂起可恢复，测的不再是目标场景；
  //   ②种子走 IDB（await 事务，跨导航可靠）而非 LS——LS 的写入先落渲染进程缓存、异步
  //     提交到浏览器进程，导航瞬间未提交的写会被丢弃，新文档读到上一条已提交值（实测
  //     复现：LS 种子在换页后变回旧墓碑且两页都无 setItem 事件）。LS 侧放墓碑，让恢复
  //     走 IDB 兜底分支——恰好覆盖「iOS 清 LS 后靠 IDB 挂起重响」这条路径。
  await evalJs(`(async function(){
    var left = 21000 - performance.now();
    if (left > 0) await new Promise(function(r){ setTimeout(r, left); });
    await window.idbSet('${HOLD_KEY}', { ts: Date.now()-30000, name: 'TA', cid: 'default', msg: false, sid: 'other-run' });
    try { localStorage.setItem('${HOLD_KEY}', '{"ts":0}'); } catch(e){}
    try { sessionStorage.removeItem('${CALL_KEY}'); } catch(e){}
    try { localStorage.removeItem('${CALL_KEY}'); } catch(e){}
    return 'seeded-at-' + Math.round(performance.now());
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('三次刷新后应用未就绪');
  await evalJs(PIN_RANDOM);
  await sleep(2600); // bootCallResume → resumeHeldCall 重响
  const b3 = await evalJs(`(function(){
    var st = window.getCallState ? window.getCallState() : null;
    var mask = document.getElementById('call-mask');
    return JSON.stringify({ ringing: !!st && st.status === 'ringing', maskShown: !!mask && !mask.hidden });
  })()`);
  let b3o = null; try { b3o = JSON.parse(b3); } catch (e) {}
  const b3missed = await missedCount();
  check('B3 跨运行期 3 分钟内挂起：新页面照常重响（#161 冷启动语义保留）且不记未接',
    !!b3o && b3o.ringing && b3o.maskShown && b3missed === b2missed,
    'ringing=' + (b3o && b3o.ringing) + ' mask=' + (b3o && b3o.maskShown) + ' missed=' + b3missed + '/' + b2missed);

  const errs = jsErrors.filter((e) => String(e).indexOf('quota') < 0);
  check('Z 全程无意外 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const fails = results.filter(r => !r.ok).length;
console.log('----');
console.log(fails === 0 ? 'ALL PASS ' + results.length + '/' + results.length : 'FAIL ' + (results.length - fails) + '/' + results.length);
process.exit(fails === 0 ? 0 : 1);

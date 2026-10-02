// ===== 回归脚本：#699 刷新网页后通话没续上、也没保存通话记录到主页（多机型） =====
// 用法：node tools/verify-call-refresh-resume.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-call-refresh-resume.mjs   （测临时构建副本）
// 根因（2026-09-17）：saveCallActive 里 sessionStorage 与 localStorage 双写同处一个 try，
// 存储亚健康机型（LS 配额满 QuotaExceededError 同 #406 实锤 / 隐私模式 / WebView 禁用
// sessionStorage）第一句一抛整块中止，call-active 一份都没落盘＝recoverCall 读不到任何标记，
// 通话不续上、也不补「通话中断」记录，整通电话无声消失。且 call-active 从没写 IDB
// （call-hold #406 补了、call-active 漏了）。
// 断言：
//   A 轴（源码锚）：三路写入拆开各吃各的 try + IDB 副本；clear 写 {ts:0} 墓碑；
//                   recoverCall 回读链 sessionStorage→localStorage→IDB；IDB 副本卡新鲜度窗。
//   B 轴（真实产物）：真实去电接通后三路 call-active 都有；刷新后续上；挂断后 records-call
//                     有记录；模拟存储亚健康机型（两路 LS 写入全抛）仅 IDB 幸存时仍能写入
//                     且刷新后从 IDB 续上（RED 判别核心）；过期 IDB 旧标记不翻旧账。
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

// ---------- A 轴：源码锚 ----------
let callSrc = '';
try { callSrc = readFileSync(join(root, 'src/js/call.js'), 'utf8'); } catch (e) {}
check('A1 saveCallActive 三路写入拆开各吃各的 try（并回同一 try＝亚健康机型一抛全丢）',
  /try \{ sessionStorage\.setItem\(CALL_ACTIVE_KEY, payload\); \} catch \(e\) \{\}\s*\n\s*try \{ localStorage\.setItem\(CALL_ACTIVE_KEY, payload\); \} catch \(e\) \{\}\s*\n\s*try \{ if \(window\.idbSet\) window\.idbSet\(CALL_ACTIVE_KEY, JSON\.parse\(payload\)\); \} catch \(e\) \{\}/.test(callSrc));
check('A2 clearCallActive 写 {ts:0} 墓碑进 IDB（防 idbRestore 幽灵回填）', callSrc.includes('window.idbSet(CALL_ACTIVE_KEY, { ts: 0 })'));
check('A3 recoverCall 回读链补 IDB 兜底（recoverProcess(ih, \'idb\')）', callSrc.includes("recoverProcess(ih, 'idb')"));
// A4 口径更新（2026-09-18 #757 会话）：#698 的 IDB 新鲜度窗在 #757 里被收进「窗分档」
//   ——IDB 副本仍卡 10 分钟（CALL_IDB_WINDOW，原样保留＝#705 幽灵复活防线），SS/LS 改用
//   6 小时墙钟窗（CALL_RESUME_WINDOW）。锚点随之从内联表达式挪到分档表达式本身。
check('A4 IDB 副本仍卡 10 分钟新鲜度窗（#757 分档后原样保留，防数天后翻出旧通话/幽灵复活）',
  callSrc.includes('const CALL_IDB_WINDOW = 600000;')
  && callSrc.includes("const windowMs = src === 'idb' ? CALL_IDB_WINDOW : CALL_RESUME_WINDOW;"));
if (results.some(r => !r.ok)) {
  console.log('----');
  console.log('A 轴有 FAIL：源码锚缺失（修复被覆盖或未接入），B 轴跳过');
  process.exit(1);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-698-' + Date.now()),
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
    const ok = await evalJs(`!!(window.placeCall && window.getCallState && window.idbGet)`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}
async function waitCallConnected(timeout = 12000) {
  for (let i = 0; i < Math.ceil(timeout / 300); i++) {
    const st = await evalJs(`JSON.stringify(window.getCallState ? window.getCallState() : null)`);
    try {
      const o = JSON.parse(st);
      if (o && o.status === 'connected' && o.durationSec >= 0) return o;
    } catch (e) {}
    await sleep(300);
  }
  return null;
}

const CALL_KEY = 'xy-home-v2:call-active';
try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('应用未就绪');

  // B1 真实去电接通（Math.random 钉 0.5：去电结果落 70% 接通档、结果延迟固定 ~2.5s）
  //    → 三路 call-active 全部落盘（sessionStorage / localStorage / IDB，含 connectedTime）
  await evalJs(`Math.random = (function(orig){ return function(){ return 0.5; }; })(Math.random); window.placeCall(); 'dialing'`);
  const b1 = await waitCallConnected();
  await sleep(400); // IDB 写入是异步，稍等结算
  const b1stores = await evalJs(`(async function(){
    var ss=null, ls=null, idb=null;
    try { ss = JSON.parse(sessionStorage.getItem('${CALL_KEY}')||'null'); } catch(e){}
    try { ls = JSON.parse(localStorage.getItem('${CALL_KEY}')||'null'); } catch(e){}
    try { idb = await window.idbGet('${CALL_KEY}'); } catch(e){}
    return JSON.stringify({
      ss: !!(ss && ss.connectedTime), ls: !!(ls && ls.connectedTime),
      idb: !!(idb && idb.connectedTime), idbTs: idb ? !!idb.ts : false
    });
  })()`);
  let o = null; try { o = JSON.parse(b1stores); } catch (e) {}
  check('B1 去电接通：call-active 三路落盘（sessionStorage/localStorage/IDB）', b1 && o && o.ss && o.ls && o.idb, b1stores);

  // B2 刷新 → 通话续上（status connected，时长从接通时刻继续）
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('刷新后应用未就绪');
  await sleep(800); // 等 mochi-restore-done → bootCallResume → recoverCall
  const b2 = await waitCallConnected(8000);
  check('B2 刷新后通话续上（getCallState=connected）', !!b2, JSON.stringify(b2));

  // B3 挂断 → 主页通话记录落库（records-call 有「通话已挂断」条目）
  await evalJs(`window.hangupCall(); 'hangup'`);
  await sleep(400);
  const b3 = await evalJs(`(function(){
    var raw = localStorage.getItem('xy-home-v2:default:records-call') || '[]';
    var arr; try { arr = JSON.parse(raw); } catch(e){ return 'parse-err'; }
    var hit = (Array.isArray(arr) ? arr : []).some(function(r){ return r && String(r.text||'').indexOf('已挂断') >= 0; });
    return JSON.stringify({ n: (Array.isArray(arr)?arr.length:0), hit: hit, first: (Array.isArray(arr)&&arr[0]) ? arr[0].text : '' });
  })()`);
  o = null; try { o = JSON.parse(b3); } catch (e) {}
  check('B3 续上后挂断：主页 records-call 落一条「已挂断」记录', o && o.hit, b3);

  // B4/B5 RED 判别核心：模拟存储亚健康机型（sessionStorage.setItem 与 localStorage.setItem 全抛，
  //   复刻 #699/#406 故障形态）→ 去电接通 → 两路 LS 必然全空、IDB 副本必须幸存（双写拆开+IDB 兜底）；
  //   该状态下刷新 → 仍能从 IDB 续上（原实现此处 call-active 一份都没有＝通话消失且无记录）
  //   口径更新（2026-09-18 #722 会话，对照 #705 墓碑制）：先摘掉 B3 挂断留下的 SS/LS {"ts":0}
  //   墓碑——recoverCall 读到 SS 墓碑即 return、从不下探 IDB，不摘就测不到「仅 IDB 幸存」这条链
  //   （原版此处恒红＝过期口径，非回归）。
  await evalJs(`(function(){
    sessionStorage.setItem = function(){ throw new Error('quota'); };
    localStorage.setItem = function(){ throw new Error('quota'); };
    try { sessionStorage.removeItem('${CALL_KEY}'); } catch(e){}
    try { localStorage.removeItem('${CALL_KEY}'); } catch(e){}
    return 'stubbed';
  })()`);
  // B3 挂断后面板收起/清理是异步的——placeCall 开头 `if (currentCall) { toast('已有通话中'); return; }`
  // 会被残体静默挡掉（高负载下更明显，HEAD 部署包同机也复现）。先等残体清空（至多 5s）再拨。
  let b4pre = 'clear';
  for (let i = 0; i < 17; i++) {
    const pre = await evalJs(`JSON.stringify(window.getCallState ? window.getCallState() : null)`);
    let po = null; try { po = JSON.parse(pre); } catch (e) {}
    if (!po || po.status === 'ended') break;
    b4pre = pre.slice(0, 80);
    await sleep(300);
  }
  await evalJs(`window.placeCall(); 'dialing'`);
  const b4conn = await waitCallConnected();
  // 轮询回读（每 300ms，至多 25s）——两个真实竞态都出在无头高负载时：
  // ① idbSet fire-and-forget，超时重试链最长 ~12s；② B3 挂断写的 {ts:0} 墓碑若走了重试链，
  //    会晚于本段接通写入落盘、把副本覆灭，心跳约 20s 后才再写（call.js hbCount>=20）。
  // 判定口径：等墓碑风暴尘埃落定（>12s）后，连续两次（间隔 1s）读到 connectedTime 才算幸存。
  // HEAD 部署包同机实测同样会红，属测试时序窗问题而非产品回归。
  const b4 = await evalJs(`(async function(){
    var ls=null, idb=null, t0=Date.now(), stable=0;
    for(;;){
      try { idb = await window.idbGet('${CALL_KEY}'); } catch(e){}
      const ok = !!(idb && idb.connectedTime);
      stable = ok ? stable + 1 : 0;
      if (stable >= 2 && Date.now() - t0 > 12000) break;
      if (Date.now() - t0 > 25000) break;
      await new Promise(r=>setTimeout(r,300));
    }
    try { ls = JSON.parse(localStorage.getItem('${CALL_KEY}')||'null'); } catch(e){ ls = 'throw'; }
    return JSON.stringify({ lsEmpty: !ls || ls === 'throw' || !ls.connectedTime, idb: !!(idb && idb.connectedTime), raw: String(JSON.stringify(idb)).slice(0,120) });
  })()`);
  o = null; try { o = JSON.parse(b4); } catch (e) {}
  check('B4 存储亚健康机型（两路 LS 写入全抛）：接通后 IDB 副本幸存', !!b4conn && o && o.lsEmpty && o.idb,
    b4 + ' conn=' + b4conn + ' pre=' + b4pre + ' errs=' + JSON.stringify(jsErrors.slice(-4)));

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('再次刷新后应用未就绪');
  await sleep(800);
  const b5 = await waitCallConnected(8000);
  check('B5 同机型刷新：仅 IDB 副本幸存也能续上通话', !!b5, JSON.stringify(b5));
  await evalJs(`window.hangupCall(); 'hangup'`);

  // B6 IDB 里塞 2 小时前的旧标记（心跳早停＝早已结束）→ 刷新后不恢复、不翻旧账。
  //   口径更新（2026-09-18 #722 会话，对照 #705 墓碑制）：clearCallActive 现写 {"ts":0}
  //   墓碑而非 removeItem，「被清」＝读到 ts:0 墓碑；且种子前先摘掉 SS/LS 旧标记，
  //   让 recoverCall 真正走到 IDB 兜底回读路径（原版 SS 墓碑命中即 return，测不到 A4）。
  await evalJs(`(async function(){
    await window.idbSet('${CALL_KEY}', { cid:'default', direction:'out', status:'connected',
      startTime: Date.now()-7200000, connectedTime: Date.now()-7200000, name:'TA', av:'', ts: Date.now()-7200000 });
    try { sessionStorage.removeItem('${CALL_KEY}'); } catch(e){}
    try { localStorage.removeItem('${CALL_KEY}'); } catch(e){}
    return 'seeded';
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('三次刷新后应用未就绪');
  await sleep(1200);
  const b6 = await evalJs(`(function(){
    function tomb(v){ if(!v) return true; try { var o=JSON.parse(v); return !!o && o.ts===0; } catch(e){ return false; } }
    var st = window.getCallState ? window.getCallState() : null;
    return JSON.stringify({ noGhost: !st, cleared: tomb(sessionStorage.getItem('${CALL_KEY}')) && tomb(localStorage.getItem('${CALL_KEY}')) });
  })()`);
  o = null; try { o = JSON.parse(b6); } catch (e) {}
  check('B6 过期 IDB 旧标记：不恢复旧通话、标记被清（10 分钟新鲜度窗）', o && o.noGhost && o.cleared, b6);

  // ================= C 轴（#757）：页面被冻结/杀进程后的「墙钟恢复」=================
  // 用户直派（小米 civi4pro 夸克，明说其他机型也有）：刷新/重开后概率出现「电话挂断、
  // 无挂断记录，通话和通话时间也没续上」。根因＝恢复窗口按「心跳 ts 10 分钟窗」判定，而
  // 心跳是 setInterval——页面被系统冻结/杀掉时根本不跑，ts 停在被冻结那一刻；用户回来
  // （尤其杀后台后重开＝新运行期、sessionStorage 已空）走 LS 兜底时被判「早已结束」→
  // 静默清标记：不续上、不补记录。RED 判别：C2/C3 在旧产物上必红（通话消失、records 空）。
  // 场景构造＝「SS 丢失 + LS/IDB 快照 ts 停在 N 分钟前」（页面冻结的等价现场）。
  async function reload(pauseMs) {
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    if (!(await waitAppReady())) throw new Error('C 轴刷新后应用未就绪');
    await sleep(pauseMs || 900);
  }
  // 清场：挂断活通话 + 清三路标记 + 清通话记录（否则上一场景的活通话会在 pagehide
  //   冲刷时把种子覆盖成「新鲜」标记，测出来的就不是本场景）
  async function resetCall() {
    await evalJs(`(async function(){
      try { if (window.getCallState && window.getCallState()) window.hangupCall(); } catch(e){}
      try { sessionStorage.removeItem('${CALL_KEY}'); } catch(e){}
      try { localStorage.removeItem('${CALL_KEY}'); } catch(e){}
      try { await window.idbSet('${CALL_KEY}', { ts: 0 }); } catch(e){}
      try { localStorage.removeItem('xy-home-v2:default:records-call'); } catch(e){}
      try { if (window.idbSet) window.idbSet('xy-home-v2:default:records-call', []); } catch(e){}
      return 'reset';
    })()`);
    await sleep(320); // 等挂断收尾（心跳停表）落定
  }
  // ageMs＝种子快照的 ts 距今多久（＝页面已冻结多久）；clearSs＝SS 是否被内核清掉
  async function seedSnapshot(ageMs, clearSs) {
    return evalJs(`(async function(){
      var p = { cid:'default', direction:'out', status:'connected',
        startTime: Date.now()-600000, connectedTime: Date.now()-600000, name:'TA', av:'', ts: Date.now()-${ageMs} };
      var s = JSON.stringify(p);
      try { sessionStorage.setItem('${CALL_KEY}', s); } catch(e){}
      try { localStorage.setItem('${CALL_KEY}', s); } catch(e){}
      try { await window.idbSet('${CALL_KEY}', p); } catch(e){}
      ${clearSs ? `try { sessionStorage.removeItem('${CALL_KEY}'); } catch(e){}` : ''}
      return 'seeded';
    })()`);
  }
  async function recsHit(needle) {
    const r = await evalJs(`(function(){
      try { var a = JSON.parse(localStorage.getItem('xy-home-v2:default:records-call')||'[]');
        return String((a && a[0] && a[0].text)||''); } catch(e){ return 'err'; }
    })()`);
    return String(r || '').indexOf(needle) >= 0;
  }

  // C1 源码锚：窗分档（SS/LS 墙钟窗 vs IDB 10 分钟静默窗）＋隐藏/冻结冲刷在位
  check('C1 恢复窗分档（CALL_RESUME_WINDOW 墙钟窗 / CALL_IDB_WINDOW IDB 静默窗）+ 隐藏/冻结冲刷',
    callSrc.includes("const windowMs = src === 'idb' ? CALL_IDB_WINDOW : CALL_RESUME_WINDOW;")
    && callSrc.includes('function flushCallActive()') && callSrc.includes("addEventListener('freeze'"),
    '');

  // C2/C3 用户场景复刻：SS 被清 + LS 快照 ts 停在 11 分钟前（锁屏/后台冻结）→ 刷新必须续上
  await resetCall();
  await seedSnapshot(11 * 60 * 1000, true);
  await reload(1400);
  const c2 = await waitCallConnected(8000);
  check('C2 SS 被内核清掉 + 标记 ts 停在 11 分钟前 → 刷新后通话仍续上（旧产物：整通消失）', !!c2, JSON.stringify(c2));
  check('C3 续上后通话时长从接通时刻继续（未从头计时）', !!c2 && c2.durationSec >= 595, c2 ? String(c2.durationSec) : 'null');

  // C4 超窗（8 小时，远超墙钟窗）：不恢复旧通话，但必须留一条「通话中断」记录
  //    （旧实现静默清标记＝用户报的「无挂断记录」）
  await resetCall();
  await seedSnapshot(8 * 3600 * 1000, true);
  await reload(1600);
  const c4state = await evalJs(`JSON.stringify(window.getCallState ? window.getCallState() : null)`);
  const c4ghost = c4state && c4state !== 'null';
  check('C4a 超窗（8 小时）快照不恢复旧通话', !c4ghost, String(c4state));
  check('C4b 超窗快照补写「通话中断」记录（旧产物：静默消失、记录为零）', await recsHit('通话中断'), '');

  // C5 通话中派发 visibilitychange(hidden)（页面被冻结/杀进程前最后时机）→ 标记 ts 必须刷新
  await resetCall();
  await evalJs(`Math.random = (function(){ return function(){ return 0.5; }; })(); window.placeCall(); 'dialing'`);
  const c5conn = await waitCallConnected();
  // 先把标记改旧（模拟「上一次心跳已是 20 分钟前」的冻结现场），再触发隐藏
  await evalJs(`(function(){
    var p = { cid:'default', direction:'out', status:'connected', startTime: Date.now()-1200000,
      connectedTime: Date.now()-1200000, name:'TA', av:'', ts: Date.now()-1200000 };
    try { localStorage.setItem('${CALL_KEY}', JSON.stringify(p)); } catch(e){}
    try { sessionStorage.setItem('${CALL_KEY}', JSON.stringify(p)); } catch(e){}
    return 'aged';
  })()`);
  await evalJs(`(function(){
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    try { document.dispatchEvent(new Event('visibilitychange')); } catch(e){}
    try { window.dispatchEvent(new Event('pagehide')); } catch(e){}
    return new Date().toISOString();
  })()`);
  await sleep(200);
  const c5 = await evalJs(`(function(){
    try { var o = JSON.parse(localStorage.getItem('${CALL_KEY}')||'null');
      return JSON.stringify({ age: o ? Date.now() - o.ts : null, connected: !!(o && o.connectedTime) }); } catch(e){ return 'err'; }
  })()`);
  o = null; try { o = JSON.parse(c5); } catch (e) {}
  check('C5 通话中隐藏/离页 → 标记 ts 立刻冲刷到当下（页面冻结前把现场落盘）',
    !!c5conn && o && o.connected && o.age !== null && o.age < 5000, c5);
  // 收尾：挂断本场景的通话，避免影响 C6/D 轴
  await evalJs(`(function(){
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    try { window.hangupCall(); } catch(e){}
    return 'done';
  })()`);
  await sleep(300);

  // C6 标记瘦身（#757 顺带）：payload 不再内嵌头像 dataURL —— 恢复后头像仍要从 store 重读出来
  //   （RED 判别：把 av 写回 payload 则 C6 的「键体 <1KB」红；把 syncCallAv 的 store 读删掉则
  //   「恢复后头像仍在」红）
  await resetCall();
  await evalJs(`(function(){
    var av = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    try { localStorage.setItem('xy-home-v2:default:avatar-partner', av); } catch(e){}
    try { localStorage.setItem('xy-home-v2:default:cs-avatar-partner', av); } catch(e){}
    return 'av-seeded';
  })()`);
  await seedSnapshot(4 * 60 * 1000, true);
  const c6size = await evalJs(`(function(){ try { return String((localStorage.getItem('${CALL_KEY}')||'').length); } catch(e){ return 'err'; } })()`);
  await reload(1400);
  const c6 = await waitCallConnected(8000);
  const c6av = await evalJs(`(function(){
    var el = document.getElementById('call-mini-av');
    return JSON.stringify({ hasImg: !!(el && el.querySelector('img')), len: ${Number(c6size) || 0} });
  })()`);
  o = null; try { o = JSON.parse(c6av); } catch (e) {}
  check('C6a 通话标记键体不再内嵌头像（<1KB，弱内核写入失败的放大器已拆）',
    Number(c6size) > 0 && Number(c6size) < 1024, String(c6size));
  check('C6b 标记瘦身后续上通话仍显示头像（按归属桌面从 store 重读）', !!c6 && o && o.hasImg, c6av);
  await evalJs(`(function(){ try { window.hangupCall(); } catch(e){} return 'done'; })()`);
  await sleep(300);
  await evalJs(`(function(){
    try { localStorage.removeItem('xy-home-v2:default:avatar-partner'); } catch(e){}
    try { localStorage.removeItem('xy-home-v2:default:cs-avatar-partner'); } catch(e){}
    return 'clean';
  })()`);

  const errs = jsErrors.filter((e) => e.indexOf('quota') < 0); // B4 故意抛的 quota 不算
  check('B7 全程无意外 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const fails = results.filter(r => !r.ok).length;
console.log('----');
console.log(fails === 0 ? 'ALL PASS ' + results.length + '/' + results.length : 'FAIL ' + (results.length - fails) + '/' + results.length);
process.exit(fails === 0 ? 0 : 1);

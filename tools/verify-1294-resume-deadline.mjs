// ===== 常驻回归脚本 #1294：回场复核状态机的两处死线残余（#1202 之后仍复发的面）=====
// 用法：node tools/verify-1294-resume-deadline.mjs [被测根目录]
// 症状（用户实报 2026-09-26，红米 K80 Chrome，明说其他设备型号也有出现）：「把浏览器挂着后台一段时间
//   然后回来，聊天里依旧不显示新发的聊天消息，一片空白，要刷新才正常；或退出聊天回桌面操作两次才显示，
//   有时多次操作也不恢复」——即 #1067→#1202 上线后同一症状第三次复报。
// 根因（零机型分支，两条都是 #1202 状态机自己的死线把子弹丢掉）：
//   ① phase 0 撞死线＝整发权威重读被跳过：`if (batchRendering) { if(!overdue){...} _rcPhase=2 }` ——
//     死线（6s）到点时那半轮整窗构建仍在飞，旧形态直接放弃开枪、屏/模型复核又因 batchRendering 早退
//     ⇒ 这一轮零重读、且同一次离场不会有第二次 visibilitychange＝后台落库的新消息永远进不了内存。
//     真机解冻风暴（回前台重排/大列表分帧构建在慢机上）恰好最常超过 6s ⇒ 用户所见「一片空白/停在旧记录，
//     只有刷新/重进才恢复」。数据重读与构建在飞无关（loadMsgs 不直写 DOM，落地渲染收尾自带 #220/#951h
//     在飞作废闸），只有 DOM 补画才该让路。
//   ② phase 1 读在飞撞死线＝复核先于落地草草收尾：大历史（#716 红米 K80 实报 41.2MB）的 IDB 真读
//     可达十几秒，6s 死线到点时 lastIdbLoadAt 还没动，旧形态照样进 ④——拿旧模型复核＝「屏上尾部==内存
//     尾部」零动作；等慢读真落地，本轮早已结束，此后只剩 loadMsgs 收尾那一条自带闸的渲染路（用户当时
//     不在底部就只置 windowStale）＝又一条「模型有、屏上没有」的无主态。
// 夹具纪律（与 verify-1202 完全同款）：
//   ① `setTimeout(fn,0)` 链式让帧定时器停存（park）＝真机隐藏标签深度节流/整页冻结的等价形态；
//   ② 后台期把 A 的「收消息＋落盘」入口静音；B＝第二标签页同 origin 真落库。
// 用例：
//   A1~A4 静态锚（src／产物：死线不掉弹 ＋ 读在飞有界续期）
//   P0~P3 前提：320 条贴底渲染／构建在飞（屏上清空＝用户口径「一片空白」）／另一上下文确已落库
//   D0 前提：软死线之前不许抢跑（零重读）**或**已按 #1313 的停滞接管并真的画回来
//      （2026-09-26 重锚：停摆的分帧轮不再是「永久在飞」，旧形态「3s 后仍零重读」成了对无主空白的背书）
//   D1 【判别核心】构建在飞拖过 6s 死线：到点仍必须开出这一发权威重读（HEAD 红：reads=[]）
//   D2 【判别核心】障碍清除后新消息自己上屏（HEAD 红：永远不上屏，只有刷新/重进才画＝用户原话）
//   D3 屏上尾部追平内存尾部（无「模型有、屏上没有」错位）
//   D4 回场仍贴底（#930/#416 语义不打回）
//   D5 契约：短离场（2s）零重读（≤60s 行为零变化）
//   Z1 全程零 JS 异常
// RED 基线（纯 HEAD＝含 #1202）：A1~A4 缺锚 + D1/D2/D3 红；P0~P3/D4/D5 两侧同绿。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
console.log('被测根目录: ' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, budgetMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 >= budgetMs) return { ok: false, ms: Date.now() - t0 };
    await sleep(stepMs || 250);
  }
}
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 300) : '')); } };

console.log('静态断言:');
let src = '', prod = '';
try { src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { prod = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
A_('A1 源：phase 0 死线到点不再跳过子弹（让路条件收窄为「没到期」）', /if \(batchRendering && !overdue\) \{ _rcTimer = setTimeout\(chatResumeReconcileStep, 250\); return; \}/.test(src));
A_('A2 产物：死线到点仍开枪（build 剥注释后代码行在位）', /if \(batchRendering && !overdue\) \{ _rcTimer = setTimeout\(chatResumeReconcileStep, 250\); return; \}/.test(prod));
A_('A3 源：读库链在飞时软死线按硬顶续期', /_lmChainBusy === window\.activePrefix\(\) && now < _rcArmAt \+ CHAT_RESUME_RECONCILE_HARD_MS/.test(src));
A_('A4 产物：硬顶常量在位', prod.includes('const CHAT_RESUME_RECONCILE_HARD_MS = 15000;'));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9861 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1294-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

function mkClient(wsUrl, tag) {
  const c = { tag, pend: new Map(), id: 0, errors: [], ws: null };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl);
    c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String(m.params.exceptionDetails.text || '').slice(0, 120)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  c.evalJs = async (expr) => {
    try {
      const r = await c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) { console.error('  [' + tag + ' eval err]', String((r.exceptionDetails.exception || {}).description || '').slice(0, 200)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  return c;
}
async function listTargets() { return (await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json()); }
async function waitCdp() {
  for (let i = 0; i < 80; i++) { try { await listTargets(); return; } catch (e) { await sleep(200); } }
  throw new Error('CDP 端口未就绪: ' + cdpPort);
}
async function openTab(url) {
  const r = await fetch('http://127.0.0.1:' + cdpPort + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  return await r.json();
}
async function closeTab(id) { try { await fetch('http://127.0.0.1:' + cdpPort + '/json/close/' + id); } catch (e) {} }

async function bootTab(client, url) {
  await client.cdp('Page.enable'); await client.cdp('Runtime.enable');
  await client.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 772, deviceScaleFactor: 2, mobile: true });
  await client.cdp('Page.navigate', { url });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await client.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await client.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(500);
  await client.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}return true;})()");
  await client.evalJs(`(function(){
    try { var st = window.activeStore(); st.set('cs-rp-auto-prob', '0'); } catch (e) {}
    ['ta-ask','ta-choose','ta-curious','ta-roast','ta-tacc'].forEach(function(k){
      try { var st = window.activeStore(); var d = null; try { d = JSON.parse(st.get(k) || 'null'); } catch (e) { d = null; }
        if (!d || typeof d !== 'object') d = {}; if (!d.settings || typeof d.settings !== 'object') d.settings = {};
        d.settings.enabled = false; st.set(k, JSON.stringify(d)); } catch (e) {}
    });
    return true;
  })()`);
}

const GO = (state) => `(function(){
  try {
    if (${JSON.stringify(state)} === 'hidden') { window.__origVS = Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') || Object.getOwnPropertyDescriptor(document,'visibilityState'); }
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return ${JSON.stringify(state)};}});
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const RESUME = (ageMs) => `(function(){
  try {
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'visible';}});
    window.__chatHiddenAgeMs = ${ageMs};
    document.dispatchEvent(new Event('visibilitychange'));
    window.__chatHiddenAgeMs = null;
    if (window.__origVS) { Object.defineProperty(document,'visibilityState',window.__origVS); window.__origVS = null; }
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;

const PARK = `(function(){
  if (window.__parkRaw) return 'already';
  window.__parkRaw = window.setTimeout;
  window.__parked = [];
  window.__parkOn = false;
  window.setTimeout = function (fn, ms) {
    if (window.__parkOn && (ms === undefined || ms === 0) && typeof fn === 'function') { window.__parked.push(fn); return 1; }
    return window.__parkRaw.apply(window, arguments);
  };
  return 'ok';
})()`;
const PARK_SET = (on) => `(function(){
  window.__parkOn = ${on ? 'true' : 'false'};
  if (!${on ? 'true' : 'false'} && window.__parked && window.__parked.length) {
    var q = window.__parked.slice(); window.__parked.length = 0;
    q.forEach(function (f) { try { f(); } catch (e) { window.__parkErr = String(e && e.message || e); } });
  }
  return (window.__parked || []).length;
})()`;
const MUTE = `(function(){
  try {
    window.__fixt = { inW: window.chatAddIn, sysW: window.chatAddSystem, typedW: window.chatAddInTyped, setW: window.idbSet, setAllW: window.idbSetAll };
    window.chatAddIn = function(){ return null; };
    window.chatAddSystem = function(){ return null; };
    if (window.chatAddInTyped) window.chatAddInTyped = function(){};
    window.idbSet = function(){ return Promise.resolve(); };
    if (window.idbSetAll) window.idbSetAll = function(){ return Promise.resolve(); };
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const UNMUTE = `(function(){
  try { var f = window.__fixt || {}; if (f.inW) window.chatAddIn = f.inW; if (f.sysW) window.chatAddSystem = f.sysW;
    if (f.typedW) window.chatAddInTyped = f.typedW; if (f.setW) window.idbSet = f.setW; if (f.setAllW) window.idbSetAll = f.setAllW;
    window.__fixt = null; } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;

const ARM_COUNT = `(function(){
  window.__histReads = [];
  if (!window.__idbGetRaw) { window.__idbGetRaw = window.idbGet; }
  var raw = window.__idbGetRaw;
  window.idbGet = function(k, o) { try { if (/chat-(msgs|blk-idx|arch|blk-)/.test(String(k))) window.__histReads.push(String(k)); } catch (e) {} return raw.apply(this, arguments); };
  return true;
})()`;

const SNAP = `(function(){
  var b=document.getElementById('chat-body');
  if(!b) return JSON.stringify({err:1});
  var last=-1, kids=b.children;
  for (var i=kids.length-1;i>=0;i--){ var v=kids[i]&&kids[i].dataset?parseInt(kids[i].dataset.idx,10):NaN; if (isFinite(v)){ last=v; break; } }
  return JSON.stringify({ kids:kids.length, last:last, n:(window.getChatMsgs?window.getChatMsgs().length:-1),
    gap:Math.round(b.scrollHeight-b.scrollTop-b.clientHeight), text:(b.textContent||'').slice(-60) });
})()`;
const HAS = (mark) => `(function(){var b=document.getElementById('chat-body');return b?b.textContent.indexOf(${JSON.stringify(mark)})>=0:false;})()`;

let B = null;
try {
  await waitCdp();
  let page = (await listTargets()).find((t) => t.type === 'page');
  const A = mkClient(page.webSocketDebuggerUrl, 'A'); await A.connect();
  await bootTab(A, baseUrl + '/index.html');
  await A.cdp('Page.navigate', { url: 'about:blank' }); await sleep(300);
  await A.cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await bootTab(A, baseUrl + '/index.html');
  await A.evalJs(PARK);

  const seeded = await A.evalJs(`(function(){
    try {
      var now = Date.now(), arr = [];
      for (var i = 0; i < 320; i++) arr.push({ side: i % 2 ? 'in' : 'out', text: '记录' + String(i).padStart(3, '0'), ts: now - (320 - i) * 60000 });
      return window.chatImportMsgs(arr) ? 'true' : 'false';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  A_('P0 前提：320 条历史导入成功', seeded === 'true', seeded);
  await sleep(2500);
  await A.evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(3500);
  await A.evalJs(ARM_COUNT);
  let s0 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('P1 前提：聊天页在贴底且已渲染（屏上尾部＝内存尾部）', !s0.err && s0.kids > 50 && s0.last === s0.n - 1 && Math.abs(s0.gap) <= 8, s0);
  await sleep(3000);

  // ---------- 让「整窗分帧构建」停在飞并拖过 6s 死线（＝真机解冻风暴慢于复核预算的形态） ----------
  await A.evalJs(PARK_SET(true));
  const reimport = await A.evalJs('(function(){ try { window.__parkOn = false; var r = window.chatImportMsgs(window.chatExportMsgs()); window.__parkOn = true; return r ? "true" : "false"; } catch (e) { return "ERR:" + e.message; } })()');
  const inflight = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('P2 前提：构建在飞（屏上已清空＝用户口径「一片空白」，分帧泵停存）', reimport === 'true' && inflight.kids === 0, { reimport, inflight });
  await sleep(4000);

  const MARK = '__MSG1294__后台新消息';
  await A.evalJs('window.__histReads.length = 0');
  await A.evalJs(MUTE);
  await A.evalJs(GO('hidden'));

  const t = await openTab(baseUrl + '/index.html');
  B = mkClient(t.webSocketDebuggerUrl, 'B'); await B.connect();
  await bootTab(B, baseUrl + '/index.html');
  await B.cdp('Page.bringToFront');
  await B.cdp('Page.setWebLifecycleState', { state: 'active' });
  await sleep(300);
  const wrote = await B.evalJs(`(function(){ try { if (!window.chatAddIn) return 'no-api'; window.chatAddIn(${JSON.stringify(MARK)}, {}); return String(window.getChatMsgs ? window.getChatMsgs().length : -1); } catch (e) { return 'ERR:' + e.message; } })()`);
  const STORE_SCAN = `(function(){
    var mark = ${JSON.stringify(MARK)};
    return window.idbGetAllKeys().then(function(keys){
      var ks = (keys || []).filter(function(k){ return /chat-(msgs|arch|blk|tail)/.test(String(k)); });
      return Promise.all(ks.map(function(k){ return window.idbGet(k).then(function(v){ return String(v).indexOf(mark) >= 0 ? String(k) : ''; }).catch(function(){ return ''; }); }))
        .then(function(hits){ var h = hits.filter(Boolean); return h.length ? ('in-store:' + h.join(',')) : 'not-in-store'; });
    }).catch(function(){ return 'read-fail'; });
  })()`;
  let storeHit = '';
  const inStore = await waitFor(async () => { storeHit = String((await B.evalJs(STORE_SCAN)) || ''); return storeHit.indexOf('in-store') === 0; }, 25000, 500);
  A_('P3 前提：另一上下文确已把新消息写进同一 origin 的 chat store', inStore.ok, { waitedMs: inStore.ms, hit: storeHit, wrote });
  await closeTab(t.id); B = null;
  await sleep(500);

  // ---------- 回场：构建仍在飞 ----------
  await A.evalJs(UNMUTE);
  await A.evalJs(RESUME(65000));
  await sleep(3000);
  const readsEarly = await A.evalJs('JSON.stringify(window.__histReads)');
  const sEarly = JSON.parse((await A.evalJs(SNAP)) || '{}');
  const pumpEarly = JSON.parse((await A.evalJs("(function(){return JSON.stringify(window.__chatPumpDiag ? window.__chatPumpDiag() : null);})()")) || 'null');
  // ⚠️ 本条的前提窗在 #1313 之后被收窄（重锚、非松绑）：一条**真的停摆**的分帧轮不再是「永久在飞」，
  // 最迟在停滞被认定之后必须有人接管收装 ⇒ 障碍一清，本批的复核状态机提前开出那一发重读是**对的**。
  // 本条要守的两件事一个字没少：**不许抢跑**（停滞尚未成立就不许提前重读）、**不许无主**（屏被清空却
  // 没有任何接管记录＝用户那句「一片空白、只有刷新才恢复」的本体）。两种诚实形态之一才放行：
  //   ① 仍在让路窗内＝旧契约原样（零重读）；② 已按停滞接管＝必须留下 watchdog/resume-heal 那一发事故
  //   记录，**并且屏上真的重新有内容**（只留证不画回来照样红）。
  // 纯 HEAD 侧没有 __chatPumpDiag ⇒ ②恒不成立 ⇒ 本条等价于旧断言（＝两侧同一条尺子）。
  // D1（6s 死线到点必须开那一发）与 D2~D5 一字未动，本批没有给「死线」让路。
  const letWayHeld = readsEarly === '[]';
  const takenOver = !!pumpEarly && Array.isArray(pumpEarly.incidents)
    && pumpEarly.incidents.some((x) => /watchdog|resume-heal/.test(String(x && x.why))) && sEarly.kids > 0;
  A_('D0 让路语义未被抢跑：软死线前零重读，或已按 #1313 的停滞接管并真的画回来（前提窗收窄）', letWayHeld || takenOver, { letWayHeld, takenOver, readsEarly, kids: sEarly.kids, pump: pumpEarly });

  // ---------- D1 判别核心：6s 死线到点，构建仍在飞＝子弹也必须开（数据重读与构建无关） ----------
  await sleep(4500); // 越过 _rcDeadline（arm+6s）＋两个 250ms 步进
  const readsAtDeadline = JSON.parse((await A.evalJs('JSON.stringify(window.__histReads)')) || '[]');
  A_('D1 【核心】构建拖过 6s 死线时仍开出权威重读（旧形态在这里整发掉弹＝永不上屏的根因）', Array.isArray(readsAtDeadline) && readsAtDeadline.length > 0, readsAtDeadline);

  // ---------- D2 障碍清除后：新消息必须自己上屏（不靠退出重进/刷新） ----------
  await A.evalJs(PARK_SET(false));
  const sawMsg = await waitFor(async () => (await A.evalJs(HAS(MARK))) === true, 25000, 300);
  const after = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('D2 【核心】障碍清除后：后台落库的新消息已自己上屏（用户症状本体）', sawMsg.ok, { waitedMs: sawMsg.ms, after, reads: await A.evalJs('JSON.stringify(window.__histReads)') });
  A_('D3 屏上尾部已追平内存尾部（无「模型有、屏上没有」的错位）', !after.err && after.last >= after.n - 1, after);

  const s3 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('D4 长离场回场后仍贴底（#930/#416 语义未被打回）', !s3.err && Math.abs(s3.gap) <= 8, s3);

  // ---------- D5 契约：短离场＋无构建在飞 ⇒ 零重读 ----------
  await A.evalJs('window.__histReads.length = 0');
  await A.evalJs(GO('hidden'));
  await sleep(400);
  await A.evalJs(RESUME(2000));
  await sleep(2500);
  const shortReads = await A.evalJs('JSON.stringify(window.__histReads)');
  A_('D5 短离场（2s）回场不强制重读权威（≤60s 行为零变化）', shortReads === '[]', shortReads);

  A_('Z1 主标签页零 JS 异常', A.errors.length === 0, A.errors.slice(0, 3));
  console.log('\n结果：绿 ' + pass + ' / 红 ' + fail);
} catch (e) {
  console.error('脚本异常：', e && e.message || e);
  fail++;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
process.exit(fail ? 1 : 0);

// ===== 常驻回归脚本 #1202：长挂后台回前台，聊天里新消息必须上屏（#1067 同族的「一枪被打掉」面）=====
// 用法：node tools/verify-1202-resume-reconcile.mjs [被测根目录]
// 症状（用户实报 2026-09-24）：「把浏览器放在后台一段时间再切回来，聊天里新的聊天消息无法显示」，
//   明说其他设备型号也有出现——即 #1067（长离场回场补一发强制权威重读）之后仍然复发。
// 根因（零机型分支）：#1067 那一枪挂在 chatResumeRepin 的 350ms 回调里，而回调开头是
//   `if (!chatVisible() || !chatPinnedBottom || batchRendering) return;`。真机回场最常撞上的就是
//   batchRendering：整页冻结/深度节流的后台里那半轮 renderWindow 分帧构建（buildChunk 走
//   setTimeout(fn, 0) 链）根本没跑完，解冻后仍按 1 次/分钟被节流 ⇒ 350ms 到点时构建仍在飞 ⇒
//   重读＋贴底一起作废；而 chatResumeRepinT 已清空、visibilitychange 不会再来第二次＝**没有任何补口**。
//   第二面：读库链落地那一刻若正撞「几何恢复风暴」（#978 语），loadMsgs 收尾只置 windowStale
//   ＝消息进了内存、屏上不画，此后只有退出重进聊天或刷新才画。
// 修法（本批）：一枪换成「有界复核」状态机（等障碍清 → 真读一发 → 读库落地 → 屏/模型一致性补画）。
// 夹具纪律：
//   ① 把 `setTimeout(fn, 0)` 这一类**链式让帧**定时器停存（park）＝真机隐藏标签深度节流/整页冻结的
//      等价形态；ms>0 的定时器照常跑，所以「回场闸确实被触发、却被 batchRendering 挡掉」可观测。
//   ② 后台期把 A 的「收消息＋落盘」入口整体静音（同 #1067 口径）：真机上冻住的页面既收不到也写不了，
//      不静音则 A 自己的整包写回会把 B 的写入覆盖（最后写入者赢）＝读侧断言变成写侧竞态。
// 用例：
//   S1~S4 静态锚（src／产物：复核闸在位 ＋ 重读不再挂在一次性回调上）
//   P0~P3 前提：贴底渲染／构建在飞（屏上被清空）／另一上下文确已落库
//   C1 构建在飞期不抢跑：让路窗内零重读＋尚未上屏，**或**已按 #1313 的停滞接管并真的画回来
//      （⚠️ 2026-09-26 #1313 重锚：停摆的分帧轮不再是「永久在飞」，旧形态「3s 后仍旧零重读」成了
//       对无主空白的背书；本条改成两种诚实形态之一，纯 HEAD 侧因没有 __chatPumpDiag 而等价于旧断言）
//   C2 【判别核心】障碍清除后：新消息必须**自己**上屏、气泡有文字、屏上尾部追平内存尾部
//   C3 回场仍贴底（#930/#416 语义不打回）
//   C4 【契约】短离场（2s）＋无构建在飞：历史键零重读（≤60s 行为零变化）
//   Z1 全程零 JS 异常
// RED 基线（纯 HEAD）：S1~S4 缺锚 + C2/C2b/C2c 红（消息永不上屏）；C1/C3/C4 两侧同绿。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
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
A_('S1 回场复核状态机在位（源：等障碍清才真读一发权威）', /function chatResumeReconcileStep\(\)[\s\S]{0,1200}?loadMsgs\(true\)/.test(src));
A_('S2 长离场改为挂复核闸（源：不再只有一次性 350ms 一枪）', /chatResumeReconcileArm\(awaitLongAway\)/.test(src));
A_('S3 回场复核状态机在位（产物）', /function chatResumeReconcileStep\(\)[\s\S]{0,1200}?loadMsgs\(true\)/.test(prod));
A_('S4 屏/模型一致性复核在位（产物）', prod.includes('chatResumeReconcileHeal'));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9811 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1202-' + Date.now()),
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
  // 关掉两条自主产消息源（自动回复 / TA 的提问·选择·好奇·吐槽卡定时器）：与「另一上下文落库」抢同一份
  // chat store（最后写入者赢）会把读侧断言变成写侧竞态。
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

// 回场驱动：覆写 visibilityState 后派发事件（产品读的就是事件契约），派发完还原真实描述符
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

// 夹具①：把「链式让帧」的 setTimeout(fn, 0) 停存＝真机隐藏标签深度节流/整页冻结的等价形态
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
// 夹具②：后台期把 A 的「收消息＋落盘」入口静音（真机冻住的页面本来就收不到也写不了）
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

  // 种 320 条历史（走产品导入口＝真落库）
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
  await sleep(3000); // 让开屏后的空闲归一化落定

  // ---------- 让「整窗分帧构建」停在飞（真实形态＝后台期那半轮构建被冻结/深度节流） ----------
  await A.evalJs(PARK_SET(true));
  const reimport = await A.evalJs('(function(){ try { window.__parkOn = false; var r = window.chatImportMsgs(window.chatExportMsgs()); window.__parkOn = true; return r ? "true" : "false"; } catch (e) { return "ERR:" + e.message; } })()');
  const inflight = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('P2 前提：构建在飞（屏上已清空、分帧泵停存）', reimport === 'true' && inflight.kids === 0, { reimport, inflight });
  await sleep(4000); // 等这次导入的整包落盘真完成（随后 B 的写入才是「最后写入者」）

  const MARK = '__MSG1202__后台新消息';
  await A.evalJs('window.__histReads.length = 0');
  await A.evalJs(MUTE);
  await A.evalJs(GO('hidden'));

  // ---------- 另一上下文（第二标签页，共享同一 origin 存储）把新消息落库 ----------
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

  // ---------- C1 构建仍在飞：那一枪被挡是事实（本批不许它变成「永不再来」） ----------
  await A.evalJs(UNMUTE);
  await A.evalJs(RESUME(65000));
  await sleep(3000);
  const readsDuring = await A.evalJs('JSON.stringify(window.__histReads)');
  const onScreenDuring = await A.evalJs(HAS(MARK));
  const sDuring = JSON.parse((await A.evalJs(SNAP)) || '{}');
  const pumpDuring = JSON.parse((await A.evalJs("(function(){return JSON.stringify(window.__chatPumpDiag ? window.__chatPumpDiag() : null);})()")) || 'null');
  // ⚠️ 本条的前提窗在 #1313 之后被收窄（重锚、非松绑）：一条**真的停摆**的分帧轮不再等于「永久在飞」——
  // 最迟在停滞被认定之后必须有人接管收装。所以旧写法「3s 之后仍零重读＋屏上没有」在这里不再是契约，
  // 而本条要守的东西一个字没少：**不许抢跑**（停滞没成立就不许提前重读/提前画）、**不许无主**（屏被清空
  // 却没有任何接管记录＝本症状本体）。两种诚实形态之一才放行：
  //   ① 仍在让路窗内＝旧契约原样（零重读＋新消息尚未上屏）；② 已按停滞接管＝必须留下 watchdog/resume-heal
  //   那一发事故记录，**并且屏上真的重新有内容**（只留证不画回来照样红）。
  // 纯 HEAD 侧没有 __chatPumpDiag ⇒ ②恒不成立 ⇒ 本条等价于旧断言（尺子两侧同一条）。
  const letWayHeld = onScreenDuring === false && readsDuring === '[]';
  const takenOver = !!pumpDuring && Array.isArray(pumpDuring.incidents)
    && pumpDuring.incidents.some((x) => /watchdog|resume-heal/.test(String(x && x.why))) && sDuring.kids > 0;
  A_('C1 构建在飞期不抢跑：让路窗内零重读尚未上屏，或已按停滞接管并真的画回来（#1313 收窄前提窗）', letWayHeld || takenOver, { letWayHeld, takenOver, readsDuring, onScreenDuring, kids: sDuring.kids, pump: pumpDuring });

  // ---------- C2 判别核心：障碍清除后，新消息必须自己上屏（不靠用户退出重进/刷新） ----------
  await A.evalJs(PARK_SET(false));
  const sawMsg = await waitFor(async () => (await A.evalJs(HAS(MARK))) === true, 20000, 300);
  const after = JSON.parse((await A.evalJs(SNAP)) || '{}');
  const bubbleTxt = await A.evalJs(`(function(){
    var b=document.getElementById('chat-body'); if(!b) return 'no-body';
    var n=null, kids=b.children;
    for (var i=kids.length-1;i>=0;i--){ if ((kids[i].textContent||'').indexOf(${JSON.stringify(MARK)})>=0){ n=kids[i]; break; } }
    if(!n) return 'no-node';
    var bb=n.querySelector('.msg-bubble')||n;
    return JSON.stringify({ txtLen:(bb.textContent||'').trim().length, txt:(bb.textContent||'').trim().slice(0,40) });
  })()`);
  let bt = {}; try { bt = JSON.parse(bubbleTxt); } catch (e) {}
  A_('C2 障碍清除后：后台落库的新消息已自己上屏（用户症状本体）', sawMsg.ok, { waitedMs: sawMsg.ms, after, reads: await A.evalJs('JSON.stringify(window.__histReads)') });
  A_('C2b 新消息气泡有文字（不是空白气泡）', bt.txtLen > 0 && String(bt.txt).indexOf('__MSG1202__') >= 0, bubbleTxt);
  A_('C2c 屏上尾部已追平内存尾部（无「模型有、屏上没有」的错位）', !after.err && after.last >= after.n - 1, after);

  // ---------- C3 回场仍贴底 ----------
  const s3 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('C3 长离场回场后仍贴底（#930/#416 语义未被打回）', !s3.err && Math.abs(s3.gap) <= 8, s3);

  // ---------- C4 契约：短离场＋无构建在飞 ⇒ 零重读 ----------
  await A.evalJs('window.__histReads.length = 0');
  await A.evalJs(GO('hidden'));
  await sleep(400);
  await A.evalJs(RESUME(2000));
  await sleep(2500);
  const shortReads = await A.evalJs('JSON.stringify(window.__histReads)');
  A_('C4 短离场（2s）回场不强制重读权威（≤60s 行为零变化）', shortReads === '[]', shortReads);

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

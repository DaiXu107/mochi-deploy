// ===== 常驻回归脚本 #1067：长挂后台 / 锁屏后回前台，聊天里「后台期落库的新消息」不显示 =====
// 用法：node tools/verify-1067-resume-reread.mjs [被测根目录]
// 症状（用户实报，红米 K80 Chrome，明说其他机型同现）：
//   「每次把浏览器切后台放置一段时，或者手机锁屏了，再打开浏览器，聊天里新的聊天消息就是
//    空白不显示，要刷新重新进入网页才正常」。
// 根因（零机型分支）：后台/锁屏期本 tab 的 JS 被冻结，新消息由**别的上下文**落进 IDB
//   （另一标签页 / 主屏图标实例 / SW 的 psync 队列），本 tab 的内存 msgs 仍是旧的；而回前台
//   只走 chatResumeRepin（#930：贴底复核）与 chatResumeRearmRead（#967：仅当「权威未达」才补读），
//   权威早已在手时**没有任何重新读库入口**，普通 loadMsgs() 又被 IDB_RELOAD_MIN_GAP(8s) 时间闸
//   跳过 ⇒ 后台落库的新消息永远不上屏，刷新（重新开屏）才正常。数据一直在库里，只是内存没重读。
// 修法：长离场（>CHAT_RESUME_FRESH_MS 60s）回前台时在既有回场闸内补一发强制权威重读
//   （loadMsgs(true)＝forceIdb 绕过 8s 时间闸），合并后台落库的新消息并走既有增量渲染。
//   ≤60s 的短离场一字不动（不重读＝不抢主线程，见 C1）。
//   2026-09-24 #1202 起这一发子弹搬进「回场一致性复核状态机」的 ② 阶段（旧写法挂在 350ms 一次性
//   回调里，撞上后台冻结留下的半轮 renderWindow＝`batchRendering` 一挡，重读连同贴底一起作废且再无
//   补口——本脚本 C2 在那个形态下实测仍红，见 verify-1202-resume-reconcile）。S2/S4 两根锚随之
//   换形为 `try { if (chatDbReady) loadMsgs(true); } catch (e) {}`，语义不变。
// 用例：
//   S1~S4  静态锚（src 源与产物各两处）
//   C1 【契约】短离场（2s）回场不强制重读权威（chat 历史键读取次数 = 0）
//   C2 【判别核心】长离场（65s）回场：另一上下文落库的新消息必须上屏，且气泡有文字
//   C3 回场补投递 SW 离线提醒队列（psync-queue）里的消息（护住「另一条后台来消息通道」）
//   C4 长离场回场后仍贴底（#930/#416 语义不打回）
//   Z1 全程零 JS 异常
// RED 基线（纯 HEAD）：S2/S3/S4 缺 + C2 红（消息不上屏＝用户症状本体）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 轮询等待（机器负载高时「350ms 回场闸 + 重读 + 增量渲染」会超过固定等待窗 ⇒ 假红；改成等真值出现，
// 上限仍有限＝真没上屏照样红）
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
A_('S1 长离场判据变量在位（源）', src.includes('const awaitLongAway = gone > CHAT_RESUME_FRESH_MS;'));
A_('S2 长离场回场补强制权威重读（源）', src.includes("try { if (chatDbReady) loadMsgs(true); } catch (e) {}")); // #1202 换锚：这一发子弹已搬进回场复核状态机
A_('S3 长离场判据变量在位（产物）', prod.includes('const awaitLongAway = gone > CHAT_RESUME_FRESH_MS;'));
A_('S4 长离场回场补强制权威重读（产物）', prod.includes("try { if (chatDbReady) loadMsgs(true); } catch (e) {}")); // #1202 换锚：同上（产物侧）

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9711 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1067-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

// —— 通用 CDP 客户端（每个 tab 一份）——
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
  // PUT /json/new 是 Chrome 111+ 的口径
  const r = await fetch('http://127.0.0.1:' + cdpPort + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  return await r.json();
}
async function closeTab(id) { try { await fetch('http://127.0.0.1:' + cdpPort + '/json/close/' + id); } catch (e) {} }

let A = null, B = null;
async function bootTab(client, url) {
  await client.cdp('Page.enable'); await client.cdp('Runtime.enable');
  await client.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 772, deviceScaleFactor: 2, mobile: true });
  await client.cdp('Page.navigate', { url });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await client.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await client.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(500);
  // 静音备份提醒/版本条（回场会真触发它们）
  await client.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}return true;})()");
  // 夹具：关掉两条自主产消息源（自动回复 / TA 的提问·选择·好奇·吐槽 卡片定时器）——它们的写盘会与
  // 「另一上下文落库」抢同一份 chat store（最后写入者赢），把夹具变成竞态；本批只测「读侧有没有重读」。
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

// —— 回场驱动器：覆写 visibilityState 后派发事件（产品读的就是事件契约）——
const GO = (state, ageMs) => `(function(){
  try {
    if (${JSON.stringify(state)} === 'hidden') { window.__origVS = Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') || Object.getOwnPropertyDescriptor(document,'visibilityState'); }
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return ${JSON.stringify(state)};}});
    window.__chatHiddenAgeMs = ${ageMs === null ? 'null' : ageMs};
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
// 回场：先强制可见态派发一次（产品在 visible 分支读离场时长），派发后再还原真实描述符
// ——无头里「另一个标签页是否抢焦点」不可控，强制可见＝让被测契约（事件 + 时长）稳定成立。
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

// —— 读取计数：只数「权威历史键」（chat-unread 这类同前缀小键不算）——
const ARM_COUNT = `(function(){
  window.__histReads = [];
  if (!window.__idbGetRaw) { window.__idbGetRaw = window.idbGet; }
  var raw = window.__idbGetRaw;
  window.idbGet = function(k, o) { try { if (/chat-(msgs|blk-idx|arch|blk-)/.test(String(k))) window.__histReads.push(String(k)); } catch (e) {} return raw.apply(this, arguments); };
  return true;
})()`;

try {
  await waitCdp();
  let page = (await listTargets()).find((t) => t.type === 'page');
  A = mkClient(page.webSocketDebuggerUrl, 'A'); await A.connect();
  await bootTab(A, baseUrl + '/index.html');
  // 清存储 → 干净底子
  await A.cdp('Page.navigate', { url: 'about:blank' }); await sleep(300);
  await A.cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await bootTab(A, baseUrl + '/index.html');

  // 种 320 条历史（走产品导入口＝真落库）
  const seeded = await A.evalJs(`(function(){
    try {
      var now = Date.now(), arr = [];
      for (var i = 0; i < 320; i++) arr.push({ side: i % 2 ? 'in' : 'out', text: '记录' + String(i).padStart(3, '0'), ts: now - (320 - i) * 60000 });
      return window.chatImportMsgs(arr) ? 'true' : 'false';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  A_('P0 前提：320 条历史导入成功', seeded === 'true', seeded);
  await sleep(1200);
  await A.evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(3500);
  await A.evalJs(ARM_COUNT);

  const SNAP = `(function(){
    var b=document.getElementById('chat-body');
    if(!b) return JSON.stringify({err:1});
    return JSON.stringify({ kids:b.children.length, gap:Math.round(b.scrollHeight-b.scrollTop-b.clientHeight),
      cid:(window.__activeCid||'default'), has:function(t){return b.textContent.indexOf(t)>=0;},
      text:(b.textContent||'').slice(-80) });
  })()`;
  let s0 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('P1 前提：聊天页在贴底且已渲染', !s0.err && s0.kids > 50 && Math.abs(s0.gap) <= 8, s0);
  await sleep(3000); // 让开屏后的空闲归一化落定，避免它随后把旧数组写回（污染「另一上下文已落库」的前提）

  // ---------- C1 契约：短离场不强制重读 ----------
  await A.cdp('Page.bringToFront');
  await A.evalJs('window.__histReads.length = 0');
  await A.evalJs(GO('hidden', null));
  await sleep(400);
  await A.evalJs(RESUME(2000));
  await sleep(2200);
  const shortReads = await A.evalJs('JSON.stringify(window.__histReads)');
  A_('C1 短离场（2s）回场不强制重读权威（≤60s 行为零变化）', shortReads === '[]', shortReads);

  // ---------- C2 判别核心：另一上下文落库 → 长离场回场必须上屏 ----------
  // 时序按真机来：A 先「退后台 + 冻结」（锁屏/挂后台等效）→ 期间另一上下文把新消息落库 → A 回前台。
  // 冻结是必要的夹具纪律：A 不冻时它自己的自主产消息（回复链/TA的提问卡定时器）会紧接着写盘，
  // 把 B 的写入覆盖掉（最后写入者赢）＝测到的是写侧竞态，不是本批要治的读侧。
  const MARK2 = '__MSG1067__后台新消息';
  const before2 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  await A.evalJs('window.__histReads.length = 0');
  await A.cdp('Page.bringToFront');
  await A.evalJs(GO('hidden', null));
  // 夹具纪律（不冻进程，避免冻住的渲染进程把 origin 的 IDB 事务吊住、连带 B 也写不进）：把 A 的
  // 「收消息 + 落盘」入口整体静音——真机上 A 冻结期本来就收不到消息也写不了盘；不静音的话 A 自己的
  // 自主产消息（回复链/TA提问卡/礼物卡定时器）会在回场那一瞬抢先把旧数组写回，覆盖 B 的写入＝夹具
  // 退化成「最后写入者赢」的写侧竞态，本批要测的读侧就测不出来了。断言做完立刻还原（C3 还要收消息）。
  await A.evalJs("(function(){ window.__fixt = { inW: window.chatAddIn, sysW: window.chatAddSystem, typedW: window.chatAddInTyped, setW: window.idbSet, setAllW: window.idbSetAll }; window.chatAddIn = function(){ return null; }; window.chatAddSystem = function(){ return null; }; if (window.chatAddInTyped) window.chatAddInTyped = function(){}; window.idbSet = function(){ return Promise.resolve(); }; if (window.idbSetAll) window.idbSetAll = function(){ return Promise.resolve(); }; return true; })()");
  await sleep(300);
  // 开第二个标签页（共享同一 origin 存储＝另一上下文的真实形态），由它把新消息落库
  const t = await openTab(baseUrl + '/index.html');
  B = mkClient(t.webSocketDebuggerUrl, 'B'); await B.connect();
  await bootTab(B, baseUrl + '/index.html');
  await B.cdp('Page.bringToFront');
  await B.cdp('Page.setWebLifecycleState', { state: 'active' });
  await sleep(300);
  const wrote = await B.evalJs(`(function(){
    try {
      if (!window.chatAddIn) return 'no-api';
      window.chatAddIn(${JSON.stringify(MARK2)}, {});
      return String((window.getChatMsgs ? window.getChatMsgs().length : -1));
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  // 写库前提：扫全部 chat-* 键——产品是「同步写 LS/IDB 小键 <cid>:chat-tail（≤60 条轻量副本）＋ 空闲整包落盘」
  // 两条腿（#180/#722 起还可能分块），新消息在后台标签里常常只走到 chat-tail，故四个键族一起扫。
  const STORE_SCAN = `(function(){
    var mark = ${JSON.stringify(MARK2)};
    return window.idbGetAllKeys().then(function(keys){
      var ks = (keys || []).filter(function(k){ return /chat-(msgs|arch|blk|tail)/.test(String(k)); });
      return Promise.all(ks.map(function(k){ return window.idbGet(k).then(function(v){ return String(v).indexOf(mark) >= 0 ? String(k) : ''; }).catch(function(){ return ''; }); }))
        .then(function(hits){ var h = hits.filter(Boolean); return h.length ? ('in-store:' + h.join(',')) : 'not-in-store'; });
    }).catch(function(){ return 'read-fail'; });
  })()`;
  let storeHit = '';
  const inStore = await waitFor(async () => { storeHit = String((await B.evalJs(STORE_SCAN)) || ''); return storeHit.indexOf('in-store') === 0; }, 20000, 500);
  const bDom = await B.evalJs(`(function(){var b=document.getElementById('chat-body');return b?String(b.textContent.indexOf(${JSON.stringify(MARK2)}) >= 0):'no-body';})()`);
  console.log('  · 另一上下文写库：内存条数=' + wrote + ' 其 DOM 命中=' + bDom + ' 落库=' + (storeHit || 'n/a'));
  await closeTab(t.id); B = null;
  await sleep(300);
  A_('P2 前提：另一上下文确已把新消息写进同一 origin 的 chat store', inStore.ok, { waitedMs: inStore.ms, hit: storeHit });

  await A.evalJs(RESUME(65000));
  const sawMsg = await waitFor(async () => (await A.evalJs(`(function(){var b=document.getElementById('chat-body');return b?b.textContent.indexOf(${JSON.stringify(MARK2)})>=0:false;})()`)) === true, 15000, 300);
  const after2 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  const reads2 = await A.evalJs('JSON.stringify(window.__histReads)');
  A_('C2 长离场（65s）回场：后台落库的新消息已上屏（用户症状本体）', sawMsg.ok, { waitedMs: sawMsg.ms, before: before2.kids, after: after2.kids, tail: after2.text, reads: reads2 });
  A_('C2b 回场确有强制权威重读（forceIdb 绕开 8s 时间闸）', reads2 !== '[]', reads2);
  const bubbleTxt = await A.evalJs(`(function(){
    var b=document.getElementById('chat-body'); if(!b) return 'no-body';
    var n=null, kids=b.children;
    for (var i=kids.length-1;i>=0;i--){ if ((kids[i].textContent||'').indexOf(${JSON.stringify(MARK2)})>=0){ n=kids[i]; break; } }
    if(!n) return 'no-node';
    var bb=n.querySelector('.msg-bubble')||n;
    return JSON.stringify({ txtLen:(bb.textContent||'').trim().length, txt:(bb.textContent||'').trim().slice(0,40) });
  })()`);
  let bt = {}; try { bt = JSON.parse(bubbleTxt); } catch (e) {}
  A_('C2c 新消息气泡有文字（不是空白气泡）', bt.txtLen > 0 && String(bt.txt).indexOf('__MSG1067__') >= 0, bubbleTxt);
  // 还原 A 的写盘（C3 要用它写 psync-queue）
  await A.evalJs('(function(){ var f = window.__fixt || {}; if (f.inW) window.chatAddIn = f.inW; if (f.sysW) window.chatAddSystem = f.sysW; if (f.typedW) window.chatAddInTyped = f.typedW; if (f.setW) window.idbSet = f.setW; if (f.setAllW) window.idbSetAll = f.setAllW; window.__fixt = null; return true; })()');

  // ---------- C3 psync 队列（SW 离线提醒）回场补投递 ----------
  const MARK3 = '__PSYNC1067__离线提醒消息';
  const inj = await A.evalJs(`(function(){
    try {
      var cid = window.__activeCid || 'default';
      return window.idbSet('xy-home-v2:psync-queue', [{ t: ${JSON.stringify(MARK3)}, ts: Date.now(), cid: cid }]).then(function(){ return 'ok'; }).catch(function(e){ return 'ERR:' + e.message; });
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  await A.evalJs(GO('hidden', null));
  await sleep(400);
  await A.evalJs(RESUME('null'));
  const sawP = await waitFor(async () => (await A.evalJs(`(function(){var b=document.getElementById('chat-body');return b?b.textContent.indexOf(${JSON.stringify(MARK3)})>=0:false;})()`)) === true, 12000, 300);
  A_('C3 回场补投递 SW 离线提醒队列里的消息（psync 通道）', sawP.ok, { inject: inj, waitedMs: sawP.ms });

  // ---------- C4 回场仍贴底 ----------
  const s4 = JSON.parse((await A.evalJs(SNAP)) || '{}');
  A_('C4 长离场回场后仍贴底（#930/#416 语义未被打回）', !s4.err && Math.abs(s4.gap) <= 8, s4);

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

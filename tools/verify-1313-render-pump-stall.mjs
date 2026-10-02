// ===== 常驻回归脚本 #1313：渲染泵停摆（分帧链不再回来）后「一片空白、只有刷新才恢复」=====
// 用法：node tools/verify-1313-render-pump-stall.mjs [被测根目录]
// 症状（用户实报 2026-09-26，红米 K80 Chrome，第四次复报同一句话、明说其他设备型号也有出现、要求不要
//   覆盖式修补）：「把浏览器挂着后台一段时间，然后回来，聊天里依旧不显示现在回来后新发的聊天消息，
//   一片空白，要重新刷新网页才恢复正常。」
// 根因（零机型／零 UA 分支；判据只取「这一轮整窗构建还在不在推进」这一个事实）：
//   分帧构建唯一的生命线是 buildChunk 末尾那条 setTimeout(buildChunk,0) 自续链，而 body.innerHTML=''
//   发生在**开轮那一刻**。链一旦不再回来（单条记录把 renderMsg 弄抛／内核把 0ms 链吞掉），
//   batchRendering／appendTarget／chatRebuilding 就永久停在「构建中」，屏上是空列表。此后每一条恢复
//   路径都撞上同一个早退——回场复核④ `|| batchRendering) return;`、#1004 空洞自愈、增量补尾、
//   退出重进的同窗补丁（要求「屏上是这份 msgs」）＝没有任何补口，只有刷新能恢复。而「在飞」这个判据
//   本身在卡死态永远为真 ⇒ 凡拿「让路给在飞的构建」当理由的早退都是死路。
// 夹具纪律（与 verify-1202／#1294 同款）：`setTimeout(fn,0)` 链式让帧定时器停存（park）＝真机隐藏标签
//   深度节流／整页冻结后那条链再也没回来的等价形态；本支刻意**永不放行**＝链被吞掉那一种下场。
//   看门狗自己挂的是真延时定时器（2500ms），不在那条 0ms 链上，所以链死了它还在——这既是修复的落点，
//   也是本支夹具能区分「健康的分帧轮」与「停摆的分帧轮」的原因（H1 断言专门守着不误伤前者）。
// 用例：
//   S1~S7  静态锚（停滞判据／进展时间戳／看门狗／接管收尾／回场死路改尺／两条整窗路径的逐条 try/catch）
//   P0~P2  前提：320 条贴底渲染正常；泵停那一眼屏上确实被清空（＝用户口径「一片空白」的现场）；泵确实停住
//   H1     健康分帧轮零事故（不误伤：没有停滞就不许接管、不许留事故记录）
//   R1~R6  【判别核心】停滞被认出来 → 接管落屏 → 屏上重新有消息 → 卡死期新发的消息自己上屏 →
//          进度条收起 → 屏上尾部追平内存尾部（HEAD 红：kids 0／seen false／loading 常驻／last -1）
//   R7     接管后不重复画（屏上 data-idx 无重复且单调）
//   R8~R10 单条坏记录（parts 类型漂移成字符串＝真机 buildChunk→renderMsg 抛错那一族）不得带走整轮：
//          其余记录照常上屏、进度条收起、且不被 #1004 的补画队列弄成 700ms 重画风暴
//   Z1     全程零未捕获异常
// RED 基线（纯 HEAD＝含 #1067/#1202/#1294/#1004/#919a）：S1~S7c 缺锚＋H1/R1/R2/R3/R4/R5/R6/R8/R8b/
//   R9/R10 全红；两侧同绿＝P0／P1（现场即症状：屏上被清空、进度条常驻）／S8（#919a·#919b·#1004·#720b
//   四把旧针一字未动）／R7（无重复画）／Z1（无崩溃噪音）。
//   H1「健康轮零事故」在 HEAD 上因 __chatPumpDiag 不存在而红＝缺席即红，不是行为回归。
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
const bothHas = (needle) => src.includes(needle) && prod.includes(needle);
const hasN = (needle) => { const c = prod.split(needle).length - 1; return c; };
// S1 停滞阈值这一行＝本批唯一尺子来源（改回「按在飞判断」这行必然消失）
A_('S1 停滞阈值常量在位（src＋产物）', bothHas('const CHAT_PUMP_STALL_MS = 2500;'), { inSrc: src.includes('CHAT_PUMP_STALL_MS'), inProd: prod.includes('CHAT_PUMP_STALL_MS') });
// S2 判据函数：问的是「有没有进展」，不是「在不在飞」
A_('S2 停滞判据函数（src＋产物）', bothHas('function chatPumpStalled() {'), null);
// S3 分帧轮登记泵＋排看门狗（删＝没有任何东西会在链死后续得上）
A_('S3 分帧轮登记泵并排看门狗（src＋产物）', bothHas('chatPump = myPump; chatPumpArmWatch(myPump);'), null);
// S4 进展时间戳的唯一出处（挪出 buildChunk＝尺子失效）
A_('S4 泵进展时间戳在续链入口（src＋产物）', bothHas('chatPumpTouch(); // #1313'), null);
// S5 接管＝把剩下的画完再走既有 finishSwap（换成第二套收尾逻辑／只换装不补尾都会漏画）
A_('S5 接管复用同一份逐条画＋既有收尾（src＋产物）', bothHas('while (!myPump.done && i < len) paintRange(Math.min(i + RENDER_CHUNK, len));'), null);
// S6 回场复核④的死路改尺（旧形态 `|| batchRendering) return;` 整行消失）
A_('S6 回场复核④按停滞接管而非早退（src＋产物）', bothHas("if (batchRendering) chatPumpRescue('resume-heal');"), null);
A_('S6b 旧死路形态已不在（产物不得再有 heal 开头的 batchRendering 无条件早退）', !prod.includes('if (!chatVisible() || !chatPinnedBottom || batchRendering) return; // #162／换装期不写 DOM'), null);
// S7 两条整窗路径各自的逐条守卫（少一条＝单条坏记录仍能带走整轮）
A_('S7 分帧路径单条弄抛不带走整轮（src＋产物）', bothHas('} catch (eThrow) { threwIdx.push(i); } // #1313：单条记录不许带走整轮构建'), null);
A_('S7b 同步路径同理（src＋产物）', bothHas('} catch (eThrow) { threwIdx.push(i); } // #1313：同步整窗路径同理'), null);
A_('S7c 抛错下标与可自愈空洞分开登记（否则 #1004 的补画队列变成 700ms 空转）', bothHas("if (threwIdx.length) { windowStale = true; chatRenderIncident('paint-throw', 0, threwIdx.length); }"), null);
A_('S8 #919a/#919b/#1004/#720b 四把旧针一字未动（产物各恰 1 次）', hasN("{ skippedIdx.push(i); continue; } // #919a") === 1 && hasN('// #919b 同 #919a') === 1 && prod.includes('function armWindowHoleHeal(idxs) {') && prod.includes('if (myToken !== _rwToken) { try { restoreInplaceDrafts(); } catch (e) {}'), { a: hasN("{ skippedIdx.push(i); continue; } // #919a") });

// ---- 浏览器夹具 ----
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9876 + (process.pid % 40);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1313-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

function mkClient(wsUrl) {
  const c = { pend: new Map(), id: 0, errors: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl);
    c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String((m.params.exceptionDetails || {}).text || (m.params.exceptionDetails.exception || {}).description || '').slice(0, 160)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  c.evalJs = async (expr) => {
    try {
      const r = await c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) return null;
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  return c;
}
const listTargets = async () => (await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json());
async function waitCdp() { for (let i = 0; i < 80; i++) { try { await listTargets(); return; } catch (e) { await sleep(200); } } throw new Error('no cdp'); }

// 停存「链式让帧定时器」（ms 为 0／省略）＝真机那条 0ms 自续链再也没回来的等价形态。
// 刻意永不放行：本支要验的就是「它不会回来」。看门狗挂的是 2500ms 真延时定时器，不受停存影响。
const PARK = `(function(){
  if (window.__parkRaw) return 'already';
  window.__parkRaw = window.setTimeout; window.__parked = []; window.__parkOn = false;
  window.setTimeout = function (fn, ms) {
    if (window.__parkOn && (ms === undefined || ms === 0) && typeof fn === 'function') { window.__parked.push(fn); return 1; }
    return window.__parkRaw.apply(window, arguments);
  };
  return 'ok';
})()`;
const PARK_SET = (on) => `(function(){ window.__parkOn = ${on ? 'true' : 'false'}; return 1; })()`;
// 触发一次「冷路径整窗重建」（≥80 条才会走分帧），且从这一发起链式让帧定时器永久停存。
// ⚠️ 夹具纪律（第一版在这里假绿过）：绝不在场景一内解除停存——一旦解除，回场后 loadMsgs 落地触发的
// 新一轮 setTimeout(buildChunk,0) 就能正常跑完，纯 HEAD 也「自己好了」，R3~R6 全部失去判别力。
// 「链再也没回来」就是这条链再也没回来：停存保持到场景二之前才松开。
const REBUILD_PARKED = `(function(){
  window.__parkOn = false;
  var arr = window.chatExportMsgs();
  window.__parkOn = true;
  return window.chatImportMsgs(arr);
})()`;
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
const SNAP = `(function(){
  var b=document.getElementById('chat-body');
  if(!b) return JSON.stringify({err:1});
  var last=-1, kids=b.children, dup=0, prev=-1, seq=[];
  for (var i=0;i<kids.length;i++){ var v=kids[i]&&kids[i].dataset?parseInt(kids[i].dataset.idx,10):NaN; if(!isFinite(v))continue; if(v<=prev)dup++; seq.push(v); prev=v; }
  for (var j=kids.length-1;j>=0;j--){ var w=kids[j]&&kids[j].dataset?parseInt(kids[j].dataset.idx,10):NaN; if (isFinite(w)){ last=w; break; } }
  var pg=document.getElementById('chat-loading');
  return JSON.stringify({kids:kids.length,last:last,dup:dup,uniq:new Set(seq).size,idxs:seq,n:window.getChatMsgs?window.getChatMsgs().length:-1,
    loading:pg?getComputedStyle(pg).display:'?', tailIdxMax:seq.length?seq[seq.length-1]:-1,
    parked:(window.__parked||[]).length,
    diag:window.__chatPumpDiag?window.__chatPumpDiag():null});
})()`;

let C = null;
try {
  await waitCdp();
  C = mkClient((await listTargets()).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await C.connect();
  await C.cdp('Page.enable'); await C.cdp('Runtime.enable');
  await C.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  await C.cdp('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await C.cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,service_workers' });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await C.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(500);
  await C.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}['ta-ask','ta-choose','ta-curious','ta-roast','ta-tacc'].forEach(function(k){try{var s2=window.activeStore();var r=s2.get(k);var d=r?JSON.parse(r):{};d.settings=d.settings||{};d.settings.enabled=false;s2.set(k,JSON.stringify(d));}catch(e){}});return true;})()");
  await sleep(400);
  await C.evalJs(PARK);

  console.log('\n行为断言（泵停摆＝那条 0ms 链再也不回来）:');
  await C.evalJs(`(function(){ var now=Date.now(), arr=[]; for (var i=0;i<300;i++) arr.push({side:i%2?'in':'out',text:'记录'+String(i).padStart(3,'0'),ts:now-(300-i)*60000}); return window.chatImportMsgs(arr)?'true':'false'; })()`);
  await sleep(2500);
  await C.evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(3500);
  const s0 = JSON.parse(await C.evalJs(SNAP));
  A_('P0 前提：320 条历史进聊天后屏上贴底有内容、进度条收起（夹具真跑起了分帧轮并正常收装）', s0.kids >= 150 && s0.last === s0.n - 1 && s0.loading === 'none', s0);
  A_('H1 健康的分帧轮零事故（没停滞就绝不接管、绝不留事故记录）', s0.diag && s0.diag.incidents && s0.diag.incidents.length === 0, s0.diag);

  await C.evalJs(PARK_SET(true));
  await C.evalJs(REBUILD_PARKED);
  await sleep(600);
  const s1 = JSON.parse(await C.evalJs(SNAP));
  A_('P1 前提·现场即症状：泵停那一整窗重建把屏上清空且进度条常驻（＝用户说的「一片空白」）', s1.kids === 0 && s1.loading === 'block' && s1.parked >= 1, s1);

  await C.evalJs(GO('hidden'));
  await sleep(1200);
  await C.evalJs(RESUME(75000)); // 长离场（>60s）回场＝用户口径「挂着后台一段时间然后回来」
  const rec = await waitFor(async () => { const q = JSON.parse(await C.evalJs(SNAP)); return q.kids > 0 && q.loading === 'none' ? q : false; }, 20000, 500);
  const s2 = JSON.parse(await C.evalJs(SNAP));
  A_('R1 停摆被认出来并接管（事故记录里有 watchdog／resume-heal 那一发）', (() => { const inc = (s2.diag && s2.diag.incidents) || []; return inc.some((x) => /watchdog|resume-heal/.test(x.why)); })(), s2.diag);
  A_('R2 接管是「停滞之后」发生的，不是抢跑（stallMs ≥ 阈值）', (() => { const inc = (s2.diag && s2.diag.incidents) || []; return inc.some((x) => /watchdog|resume-heal/.test(x.why) && x.stallMs >= 2000); })(), s2.diag);
  A_('R3 回场后屏上重新有聊天记录（HEAD 红：永远 0 条，只有刷新才画）', s2.kids > 0 && rec.ok, { kids: s2.kids, ms: rec.ms });
  A_('R5 加载进度条收起（HEAD 红：常驻 block）', s2.loading === 'none', s2.loading);
  A_('R6a 接管当帧屏上尾部即追平（若此处落后，看 idxs 尾巴是不是补挂顺序问题）', s2.last === s2.n - 1, { last: s2.last, n: s2.n, dup: s2.dup, uniq: s2.uniq, kids: s2.kids, tailIdxs: (s2.idxs || []).slice(-6), diag: s2.diag });

  const M1 = '__STUCK_MSG__';
  await C.evalJs(`window.chatSendMsg(${JSON.stringify(M1)})`);
  const seen = await waitFor(async () => { const t = await C.evalJs(`(function(){var b=document.getElementById('chat-body');return b&&b.textContent.indexOf(${JSON.stringify(M1)})>=0;})()`); return t ? true : false; }, 12000, 400);
  // 恢复不等于「同一瞬间收敛」：接管落屏之后，回场复核那一发的权威重读还会再补一次画。这里等的是
  // 「屏上最终追平内存」这条不变量，不是「第一帧就对」——HEAD 侧 last 永远是 -1，等再久也红。
  const settled = await waitFor(async () => { const q = JSON.parse(await C.evalJs(SNAP)); return (q.last === q.n - 1 && q.dup === 0 && q.uniq === q.idxs.length) ? q : false; }, 12000, 500);
  const s3 = JSON.parse(await C.evalJs(SNAP));
  A_('R4 卡死期新发的消息自己上屏（HEAD 红：n 在涨而屏上不画＝用户原话「不显示新发的消息」）', seen.ok, { n: s3.n, last: s3.last });
  A_('R6 屏上尾部最终追平内存尾部（无「模型有、屏上没有」的错位）', settled.ok, { last: s3.last, n: s3.n, idxs: (s3.idxs || []).slice(-6) });
  A_('R7 接管不重复画（屏上 data-idx 无倒插、无同一条画两遍）', s3.dup === 0 && s3.kids > 0 && s3.uniq === s3.idxs.length, { dup: s3.dup, uniq: s3.uniq, kids: s3.kids, idxs: (s3.idxs || []).slice(-6) });

  // 单条坏记录（mood 类型漂移成字符串＝renderMsg 里 rec.mood.forEach 必抛，真机 buildChunk→renderMsg
  // 「reading 'side'」那一族的等价形态）不得带走整轮。
  // 夹具纪律：坏记录必须落在**被画的那段窗口里**（进聊天后窗口是尾部 RENDER_MAX 条，索引 7 根本不会
  // 被渲染＝第一次跑法就是这样假绿成「没抛错」），且要能区分「跳过它」与「整轮没画」。
  await C.evalJs(PARK_SET(false));
  await C.evalJs(`(function(){
    var a = window.chatExportMsgs(); var L = a.length;
    var arr = a.map(function (x, i) { return (i === L - 3) ? { side: 'in', ts: x.ts, text: '__BADREC__', mood: '不是数组' } : x; });
    window.__badAt = L - 3; window.__nbAt = L - 4;
    return window.chatImportMsgs(arr);
  })()`);
  await sleep(4000);
  const s4 = JSON.parse(await C.evalJs(SNAP));
  const nb = await C.evalJs(`(function(){var b=document.getElementById('chat-body');return b?(b.textContent.indexOf('记录'+String(window.__nbAt).padStart(3,'0'))>=0):false;})()`);
  const bad = await C.evalJs(`(function(){var b=document.getElementById('chat-body');return b?(b.textContent.indexOf('__BADREC__')>=0):false;})()`);
  A_('R8 单条记录弄抛不再带走整轮（其余照常上屏、进度条收起；HEAD 红：链在抛错那一刻断掉＝永久空白）', s4.kids >= 190 && s4.loading === 'none', { kids: s4.kids, loading: s4.loading });
  A_('R8b 跳过的是那一条，不是整窗（邻居那条画了、坏记录那条没画）', nb === true && bad === false, { nb, bad, kids: s4.kids, n: s4.n });
  A_('R9 该事故被留证（paint-throw 记账，不静默吞掉）', (() => { const inc = (s4.diag && s4.diag.incidents) || []; return inc.some((x) => x.why === 'paint-throw' && x.threw >= 1); })(), s4.diag);
  await sleep(3000); // > #1004 补画窗口 700ms 的两轮：抛错的下标若被喂进自愈队列，这里会看到反复整窗重画
  const s5 = JSON.parse(await C.evalJs(SNAP));
  const threwN1 = ((s4.diag && s4.diag.incidents) || []).filter((x) => x.why === 'paint-throw').length;
  const threwN2 = ((s5.diag && s5.diag.incidents) || []).filter((x) => x.why === 'paint-throw').length;
  A_('R10 不自愈空转（同一坏记录不引发反复整窗重画：屏上稳定有内容且记账不涨）', s5.kids > 150 && threwN2 <= threwN1 + 1, { kids: s5.kids, threwN1, threwN2 });
  A_('Z1 全程零未捕获异常（本批把单条抛错接住并留证，不是把它藏起来）', C.errors.length === 0, C.errors.slice(0, 4));
} catch (e) {
  A_('夹具跑通（脚本自身未抛错）', false, String(e && e.message || e));
} finally {
  try { server.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
console.log(`\n结果: ${pass} 绿 / ${fail} 红`);
process.exit(fail ? 1 : 0);

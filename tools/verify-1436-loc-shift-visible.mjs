// ===== #1436 界面级回归：TA 在身边「换位」落地可见 ＋ 方位感知【感知一下】的「主动感知即刻换位」=====
// 作者两条现场（2026-09-29 直派，判据一律零机型／零 UA 分支）：
//  ① 「ta 在身边的【换位发到聊天】开启了这个，但是只有弹窗，没有发送到聊天，也没有记录在这个功能的位置
//     时间线里」——复现量具在纯 HEAD 产物上量到两条：
//       · 时间线：换位那一发 histLen 2→3（写进库了），而面板开着时屏上 `.loc-tl-item` 恒 1 行＝**没人重画**
//         （手动发位置卡／组合卡那两条路一直是「saveHist → renderLocPanel → refreshSense」，唯独自动这条没走）；
//       · 聊天：把「TA 消息限流」打开（rl-en=1）后 chatTotal 4→4、气泡照弹＝那一发被 rateBlocksIn **静默吞掉**。
//     修法＝emitLocChange 落地必重画面板＋刷新感知，且发进聊天那一发带 {rateAllow:true}（作者点选「让换位豁免限流」）。
//  ② 「新增 ta 的方位感知里可手动打开【主动感知位置时，联系人换位不受时间内才换位的限制】——现在点【感知一下】
//     受『TA 自动换位：每 2～6 小时随机换一次』限制，一直是同一个方位」——同日作者复核直派「我是要我自己主动
//     点击【感知一下】才变啊，你是不是乱加设置了」＝**按钮即开关**：第一版那枚 loc-sense-shift 开关退役，
//     点【感知一下】无条件先催 TA 当场换一张位置卡、再按新位置报方位；手动发的位置卡也不受限流管（#1436g）。
//
// 用法：node tools/verify-1436-loc-shift-visible.mjs                （量当前产物 index.html + js/p2-features.js）
//       MOCHI_ROOT=<仓外副本> 跑另一版；MOCHI_EXPECT=red 用于纯 HEAD 的对照（旧产物必红）
// 触发方式：doLocAuto 在 IIFE 里不外露——addInitScript 包一层 setTimeout，把「延时 ≥1 小时且回调源码含
//   doLocAuto」的那一发捕获成 window.__cap，再由脚本手动打点（真闭包、真闸门、真 store，不改产物）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const PAGE = process.env.MOCHI_PAGE || '/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 260) + ']' : ''));
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!browserPath) { console.error('找不到 Edge/Chrome，请设置 CHROME_PATH'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (26000 + Math.floor(Math.random() * 2000));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1436-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0, SW_SEEN = false;
const EVAL_ERRS = []; // 尺子自己踩到的异常也要算账（不然「点了没反应」会被读成「什么都没发生」）
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      const d = String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 240);
      EVAL_ERRS.push(d);
      console.log('  [eval err] ' + d);
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function tap(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
// 与本用例无关、但会在空库首启后自动弹出并吃掉点击的系统浮层（TA 主动提问的回答弹层等）
// ——不收掉的话 elementFromPoint 命中的是它，「tap 未命中」是尺子的锅，不是应用的。
async function quiet() {
  await evalJs("(function(){['modal-mask','qa-mask','tc-mask'].forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return 1;})()");
}
// 真点击：滚进视口＋elementFromPoint 命中验（.toggle 的 input 本身是 opacity:0;width:0;height:0，必须点 .tk）
async function tapEl(sel) {
  await quiet();
  const r = await evalJs(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return {vis:false,why:'missing'};e.scrollIntoView({block:'center'});var b=e.getBoundingClientRect();var t=document.elementFromPoint(Math.round(b.left+b.width/2),Math.round(b.top+b.height/2));return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2),vis:b.width>0&&b.height>0&&b.top>=0&&b.bottom<=innerHeight,hit:!!(t&&(t===e||e.contains(t)||t.contains(e))),hitEl:t?String(t.id||t.className).slice(0,40):null};})()`);
  if (!r || !r.vis || !r.hit) { console.log('  [tap 未命中] ' + sel + ' ' + JSON.stringify(r)); return false; }
  await tap(r.x, r.y); await sleep(420); return true;
}
const READ = `(function(){
  var st=window.activeStore();
  var hist=[],cur=null;
  try{hist=JSON.parse(st.get('loc-history')||'[]');}catch(e){}
  try{cur=JSON.parse(st.get('loc-current')||'null');}catch(e){}
  var rl=null; try{rl=window.__rlDiag&&window.__rlDiag();}catch(e){}
  var bub=document.getElementById('loc-change-bubble');
  var now=new Date(), p=function(n){return n<10?'0'+n:''+n;};
  var today=now.getFullYear()+'-'+p(now.getMonth()+1)+'-'+p(now.getDate());
  return {
    histLen: hist.length, first: hist[0] && hist[0].text,
    // 最近一张「位置卡」（跳过 type==='sense' 的感知记录）——C 组一次点击会写两条（位置卡＋感知），
    // 拿 hist[0] 当「新那一张」会把感知行错认成位置卡（实测 C4/C5 就是这么误红的）
    firstPos: (function(){for(var i=0;i<hist.length;i++){if((hist[i]&&hist[i].type)!=='sense')return hist[i].text;}return null;})(),
    curText: cur && cur.text,
    rows: document.querySelectorAll('#loc-body .loc-tl-item').length,
    row0: (function(){var e=document.querySelector('#loc-body .loc-tl-item .loc-tl-text');return e?(e.textContent||'').trim():null;})(),
    nowCard: (function(){var e=document.querySelector('#loc-body .loc-now-main .loc-sec-value');return e?(e.textContent||'').trim():null;})(),
    dayCount: (function(){var e=document.querySelector('#loc-body .loc-day-count');return e?e.textContent:null;})(),
    todayRows: hist.filter(function(h){try{var d=new Date(h.ts);return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())===today;}catch(e){return false;}}).length,
    chatTotal: rl && rl.total, chatLastIn: (function(){var bs=document.querySelectorAll('#chat-body .msg-in .msg-bubble');return bs.length?(bs[bs.length-1].textContent||'').trim():null;})(),
    inTexts: (function(){var bs=document.querySelectorAll('#chat-body .msg-in .msg-bubble');var a=[];for(var i=Math.max(0,bs.length-5);i<bs.length;i++)a.push((bs[i].textContent||'').trim());return a;})(),
    bubble: bub && bub.classList.contains('loc-bubble-show') ? (bub.textContent||'') : null,
    switchCount: (function(){var rows=document.querySelectorAll('#loc-body .set-group .gs-row');return rows.length;})(),
    hasShiftTg: !!document.getElementById('loc-shift-tg'),
    shiftKey: st.get('loc-sense-shift'),
    shiftFn: typeof window.locShiftNow
  };
})()`;

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + PAGE });
  await sleep(2400);
  for (let i = 0; i < 90; i++) {
    const ok = await evalJs("(function(){return !!window.__mochiDataReady && typeof window.enterChat==='function' && !!document.getElementById('loc-panel');})()");
    if (ok) break;
    await sleep(300);
  }
  SW_SEEN = SW_SEEN || (await evalJs("(function(){return !!(navigator.serviceWorker&&navigator.serviceWorker.controller);})()"));
  await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
  await sleep(650);
  for (let i = 0; i < 6; i++) {
    const vis = await evalJs("(function(){var m=document.getElementById('modal-mask');return !!m&&!m.hidden;})()");
    if (!vis) break;
    await evalJs("(function(){var m=document.getElementById('modal-mask');var b=m.querySelectorAll('.modal-btns button,.modal-pills button,.modal-pill');if(!b.length)return 0;b[b.length-1].click();return b.length;})()");
    await sleep(550);
  }
}
// 播种：上一张位置卡必须存在（弹窗判据＝与上一次不同），三枚换位开关回到默认（无键＝开）
async function seed(extraKv) {
    // 收口批修：种子从「1 小时前」改「2 分钟前」——跨午夜跑尺时 1h 前落在昨天、按日视图把新旧两条分进两天＝B3 假红（2026-09-30 00:1x 实测）；断言语义不变。
  return evalJs(`(function(){
    var st=window.activeStore();
    var t=Date.now();
    st.set('loc-current', JSON.stringify({text:'在你左边',type:'dir',ts:t-120000,auto:true}));
    st.set('loc-history', JSON.stringify([{text:'在你左边',type:'dir',ts:t-120000,auto:true}]));
    st.remove('loc-auto'); st.remove('loc-chat'); st.remove('loc-bubble'); st.remove('loc-sense-shift');
    ${Object.entries(extraKv || {}).map(([k, v]) => `st.set(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(' ')}
    var e=document.getElementById('loc-change-bubble'); if(e) e.classList.remove('loc-bubble-show');
    return 1;
  })()`);
}
// 打开位置面板（走真入口：聊天页 → 寻踪半框 →「TA在身边 · 看看 TA 在哪」）
// 必须先把全屏那层位置面板收掉：openLocPanel 会把寻踪半框一起 hidden=true（p2-features.js 里那句
// `ck.hidden = true`），半框还藏着的时候点入口＝elementFromPoint 命不中（实测 hit:false 是尺子的锅）
async function openPanel() {
  await quiet();
  await evalJs("(function(){var p=document.getElementById('loc-panel');if(p){p.hidden=true;p.classList.remove('loc-full');}window.enterChat();return 1;})()");
  await sleep(650);
  await evalJs("(function(){window.openCkPanel&&window.openCkPanel();return 1;})()");
  await sleep(500);
  const ok = await tapEl('#ck-loc-entry');
  await sleep(650);
  return ok;
}
async function fireAuto() {
  const r = await evalJs("(function(){if(!(window.__cap||[]).length)return 'no-cb';window.__cap[window.__cap.length-1]();return 'fired';})()");
  await sleep(1100);
  return r;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Network.enable');
await cdp('Network.setBypassServiceWorker', { bypass: true });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: [
  "try{localStorage.setItem('xy-home-v2:applock-en','0');localStorage.setItem('xy-home-v2:applock-qa-en','0');localStorage.setItem('xy-home-v2:__last-backup-remind',String(Date.now()));}catch(e){}",
  "(function(){var o=window.setTimeout;window.__cap=[];window.setTimeout=function(fn,d){try{if(typeof fn==='function'&&typeof d==='number'&&d>=3600000&&String(fn).indexOf('doLocAuto')>=0)window.__cap.push(fn);}catch(e){}return o.apply(window,arguments);};})()",
  "(function(){try{if(!navigator.serviceWorker)return;var reg={scope:'/',update:function(){return Promise.resolve();},unregister:function(){return Promise.resolve(false);},addEventListener:function(){},showNotification:function(){return Promise.resolve();},getNotifications:function(){return Promise.resolve([]);},installing:null,waiting:null,active:null};navigator.serviceWorker.register=function(){return Promise.resolve(reg);};Object.defineProperty(navigator.serviceWorker,'ready',{get:function(){return Promise.resolve(reg);}});}catch(e){}})()"
].join('\n') });

// ================= S0 环境 =================
await boot();
// bootLocAuto 挂在 mochi-restore-done 与 3s 定时器上，那一发 setTimeout 不一定在第一次读数时就已经排上
// ——不轮询等它，S0 会在两侧之间随机翻面（实测红侧 cap=0 误红）
for (let i = 0; i < 25; i++) {
  const n = await evalJs("(window.__cap||[]).length");
  if (n > 0) break;
  await sleep(300);
}
const env = await evalJs("(function(){return {data:!!window.__mochiDataReady, hidden:document.hidden, panel:!!document.getElementById('loc-panel'), cap:(window.__cap||[]).length};})()");
check('S0 环境闸门：数据就绪＋面板锚点在＋定时器那一发已被捕获', !!(env && env.data && env.panel && env.hidden === false && env.cap > 0), env);

// ================= A 组：换位落地必重画面板（作者①「没记进位置时间线」）=================
await seed();
const a0 = await openPanel();
const before1 = await evalJs(READ);
const fired1 = await fireAuto();
const after1 = await evalJs(READ);
check('A0 面板已开（真入口进去的）', a0 === true && before1.rows >= 1, before1);
check('A1 换位写进了库（hist 条数 +1）', after1.histLen === before1.histLen + 1, { before: before1.histLen, after: after1.histLen });
check('A2 面板开着就当场重画：时间线第一行就是刚换上的那一张（旧写法＝数据进了、屏还停在上一张）',
  after1.row0 === after1.first && after1.nowCard === after1.first, { row0: after1.row0, nowCard: after1.nowCard, first: after1.first, rowsBefore: before1.rows, rowsAfter: after1.rows });
check('A3「此刻的位置」也跟着换成新那一张', after1.curText === after1.first && after1.curText !== before1.curText, { cur: after1.curText, first: after1.first });
check('A4「共 N 条」那行读数与屏上一致', /共\s*\d+\s*条/.test(String(after1.dayCount || '')) && String(after1.dayCount).indexOf(String(after1.todayRows)) >= 0, after1.dayCount);
check('A5 顶部轻提示仍在（没把 #790 那条链路改坏）', typeof after1.bubble === 'string' && after1.bubble.indexOf('换了位置') >= 0, after1.bubble);

// ================= B 组：开着「TA 消息限流」也照发进聊天（作者①「没有发送到聊天」）=================
await seed({ 'reply-rl-en': '1', 'reply-rl-max': '1', 'reply-rl-win': '5' });
await openPanel();
const before2 = await evalJs(READ);
const rlFull = await evalJs("!!(window.chatRateLimitFull&&window.chatRateLimitFull())");
const fired2 = await fireAuto();
const after2 = await evalJs(READ);
check('B0 前提自证：限流确实开着且此刻已满额', rlFull === true && before2.chatTotal >= 1, { full: rlFull, diag: await evalJs("window.__rlDiag()") });
check('B1 换位那一发落进聊天（消息总数 +1）', after2.chatTotal === before2.chatTotal + 1, { before: before2.chatTotal, after: after2.chatTotal });
check('B2 聊天里最后一条 TA 消息就是那句新位置', after2.chatLastIn === after2.first, { last: after2.chatLastIn, first: after2.first });
check('B3 时间线同步重画（不是只有弹窗）', after2.rows === after2.todayRows && after2.rows > before2.rows, { rows: after2.rows, before: before2.rows });

// ================= C 组：感知一下＝按钮即开关（作者②复核直派）＋手动发卡不受限流（#1436g）=================
await boot();
await seed();
await openPanel();
const c0 = await evalJs(READ);
check('C0 换位设置组里是三枚开关、第一版那枚前置开关已退役（作者否决「乱加设置」）',
  c0.switchCount === 3 && c0.hasShiftTg === false && !c0.shiftKey && c0.shiftFn === 'function', { switchCount: c0.switchCount, hasShiftTg: c0.hasShiftTg, shiftKey: c0.shiftKey, shiftFn: c0.shiftFn });
const tapP1 = await tapEl('#fw-perceive');
await sleep(900);
const c1 = await evalJs(READ);
check('C1 不开任何开关直接点【感知一下】：先换一张位置卡再记感知（时间线 +2＝一张位置卡＋一条感知，此刻的位置换新）',
  tapP1 === true && c1.histLen === c0.histLen + 2 && c1.curText !== c0.curText, { tap: tapP1, hist: [c0.histLen, c1.histLen], cur: [c0.curText, c1.curText] });
// 三个读数必须互相咬合：库里的 loc-current ＝ 面板「此刻的位置」那一格 ＝ 时间线第一行。
// （不要用「第一条非 sense 记录」去找新那张卡——位置卡自己的 type 也可能是 sense，实测这样误红过）
check('C4 三个读数同一条：loc-current＝屏上「此刻的位置」＝时间线第一行是刚写的感知',
  c1.curText === c1.nowCard && c1.row0 === c1.first, { cur: c1.curText, nowCard: c1.nowCard, row0: c1.row0, first: c1.first });
check('C5 聊天里落了那句新位置（限流默认关时也应落）', c1.chatTotal > c0.chatTotal && c1.chatLastIn === c1.curText, { chat: [c0.chatTotal, c1.chatTotal], last: c1.chatLastIn, cur: c1.curText });
// C6 4 秒冷却内再点＝一个字都不写（按钮即开关没把冷却顶掉）
const tapP3 = await tapEl('#fw-perceive');
const c6 = await evalJs(READ);
check('C6 冷却内连点不催第二次（换位与感知都不写）', c6.histLen === c1.histLen, { tap: tapP3, hist: [c1.histLen, c6.histLen] });
// C7 限流满额时「问 TA 一声」：TA 回的组合卡照样落聊天（#1436g 手动发位置卡不限流；旧写法＝静默被吞）
await sleep(4600); // 过掉感知冷却（C7 不点感知，纯保险）
await seed({ 'reply-rl-en': '1', 'reply-rl-max': '1', 'reply-rl-win': '5' });
const c7b = await evalJs(READ);
const rlFull7 = await evalJs("!!(window.chatRateLimitFull&&window.chatRateLimitFull())");
const askTapped = await tapEl('#loc-ask-btn'); // askWhere 会发「你在哪？」并把面板收回聊天页
await sleep(5200); // TA 回组合卡在 2~4 秒随机延迟之后
const c7a = await evalJs(READ);
// 只有真走 sendComboCard 的那一发才会写 loc-current＋时间线（引擎对「你在哪？」自己的回复不写这把库）⇒
// 判「cur 被这发更新、且等于新落聊天的某条 in」——旧版（组合卡被限流静默吞）这一条必红。
const comboLanded7 = c7a.curText !== c7b.curText && (c7a.inTexts || []).indexOf(c7a.curText) >= 0;
check('C7 限流满额时「问 TA 一声」TA 回的位置卡照落聊天并写进「此刻的位置」（手动发卡带豁免位，作者直派「不要受限流管」）',
  askTapped === true && rlFull7 === true && c7a.chatTotal > c7b.chatTotal && comboLanded7, { tapped: askTapped, full: rlFull7, chat: [c7b.chatTotal, c7a.chatTotal], cur: [c7b.curText, c7a.curText], inTexts: c7a.inTexts });

// ================= Z 组：零 JS 错误 + 自证未被 SW 接管 =================
const errs = await evalJs("(function(){return (window.__jsErrors||[]).filter(function(e){return /loc-|p2-features|sense|shift|playLocFx|chatAddIn/i.test(String((e&&e.message)||e));}).length;})()");
check('Z1 相关路径零 JS 错误（含尺子自己踩到的异常——点了没反应不能被读成「什么都没发生」）',
  errs === 0 && EVAL_ERRS.length === 0, { pageErrors: errs, evalErrors: EVAL_ERRS.slice(0, 3) });
// Z2 自证「量的就是 MOCHI_ROOT 指的那份产物」：直接读被服务的那份 js/p2-features.js，再对页面里的接线
// 旧版 Z2 只断言「没被 Service Worker 接管」——但空库首启那发注册偶尔会让 controller 在某一拍为真（与本批
// 无关的噪音），而真正常绿的前提是「文档确实来自这份副本」。改判据：文件里有本批接线 ∧ 页面里也接上了，
// 两者同真同假；若 SW 递来旧文档，这一条会当场红（而不是让 A/B 组的读数骗人）。
const served = await evalJs("(async function(){try{var t=await (await fetch('/js/p2-features.js?_=' + Date.now())).text();return t.indexOf('window.locShiftNow') >= 0;}catch(e){return 'fetch-fail';}})()");
const wired = await evalJs("(function(){return typeof window.locShiftNow === 'function';})()");
const swNow = await evalJs("(function(){return !!(navigator.serviceWorker&&navigator.serviceWorker.controller);})()");
check('Z2 自证闸门：被服务的 js/p2-features.js 里有本批接线，且页面里真接上了（红侧该条同假）',
  served === true && wired === true, { served, wired, swNow, swSeenDuringBoot: SW_SEEN });

browser.kill();
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('\n合计 ' + pass + '/' + results.length + ' 通过');
if (EXPECT === 'red') {
  if (pass < results.length) { console.log('RED-OK：旧产物如预期红 ' + (results.length - pass) + ' 条（' + results.filter((r) => !r.ok).map((r) => r.desc.split(' ')[0]).join('、') + '）'); process.exit(0); }
  console.error('红对照失败：旧产物竟全绿＝断言没咬合'); process.exit(1);
}
process.exit(pass === results.length ? 0 : 1);

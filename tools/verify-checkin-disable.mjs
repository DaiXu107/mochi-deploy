// ===== 回归脚本：#823 寻踪（TA 的日常）总开关 —— 关闭即全静 =====
// 用法：node tools/verify-checkin-disable.mjs（MOCHI_ROOT 可指到仓外隔离副本的产物根）
// 用户直派（2026-09-19）：「寻踪功能缺少禁用，关闭这个功能」——经确认要的是「加总开关，关了就全静」。
//   旧实现只有「寻踪日常发送到聊天」概率（dcf-checkin）：调到 0% 只停聊天推送，寻踪页与记录照旧生成，
//   桌面上【寻踪】图标、聊天「更多功能」里的寻踪、点 TA 头像的寻踪半框一个都收不掉＝用户说的「缺少禁用」。
// 新增 per-cid 键 checkin-en（从未写过＝默认开启，老用户零迁移）。关闭后：
//   ① doCheckin 单点收口——日常不生成、不推聊天、不落记录、不重置计时（自动轮询/手动刷新/半框/寻踪页全经它）；
//   ② 三入口一并收起——桌面图标（与装修手动隐藏同轴，applyHiddenIcons 复位也不放回来）、更多面板 #more-ck、点头像的半框；
//   ③ 寻踪页不再打开，并给出「设置 → 工具 → 寻踪 可重新开启」指引（功能大全等程序化跳转不落空）；
//   ④ 已有日常与寻踪记录原样保留，重新开启即恢复（不补发关闭期间的消息）。
// #1403 改约（作者直派「关闭寻踪时不需要隐藏我的按钮图标，因为这个功能里还有一个【TA在身边 ·
//   位置感知】需要点击进去才能看到页面」＋「关闭时功能里需文字显示已禁用 联系人无法再触发更新日常」）：
//   #823 把「停用生成」与「收起入口」捆成一件事，于是关一个功能连带把住在同一页里的独立功能
//   （位置面板唯一入口在寻踪页/半框，见 #875）一起藏掉，三个入口同收＝这一页再也进不去。现在——
//   生成侧闸门一字未动（① 仍在），入口侧只留聊天那一头（② 的「更多功能」与半框仍收），
//   桌面【寻踪】图标不再跟随收起、寻踪页照常打开并在页顶写明「已禁用」（⑤ 新契约，替换旧 A5/A8 的
//   「图标收起＋页面打不开」），关闭态点「刷新」给一句可执行说明而不是空转（⑥ 静默失败补口）。
// 断言：
//   P1 开关在位且默认开启（HEAD 无此 API＝必红）
//   A2 关到实设：per-cid 键落 '0' ＋ 字卡库同名开关同步 ＋ 桌面图标**不**收起（#1403）
//   A3 关闭后聊天「更多功能」里寻踪项收起（面板每次打开都重算，冷启动持久化态也算）
//   A4 关闭后点顶部 TA 头像不再弹寻踪半框
//   A5 关闭后寻踪页照样打开、页顶写明「已禁用」（#1403；旧契约是整页拦死＋toast）
//   A5b 关闭态点「刷新」不空转：给一句点名设置里那个开关的说明，且不落新记录
//   A6 关闭后自动轮询路径零副作用（节奏键/当前日常/记录三样都不动）
//   A7 已有日常与寻踪记录保留（关闭不删数据）
//   A8 切桌面、装修「恢复隐藏图标」后图标仍在（#1403 起这是常态；装修名单里手动隐藏仍生效）
//   A9 重新开启即全恢复（半框/页/生成侧恢复）
//   A10 记录默认只展开当天、更早的按天收在「更早记录」里（#1403 第二条诉求；A10b 展开后条目真在）
//   S1 产物锚点（逻辑锚：修复被覆盖即消失；#1403 起 JS 已外置，锚按各自产物文件核对）
// 需要：Node 21+ ＋ 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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
const cdpPort = 9890 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ck-disable-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  // 页面被原生对话框/长任务卡住时 Runtime.evaluate 永不返回——回归脚本必须给出 FAIL 而不是挂死
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; pend.delete(id); res(v); };
    pend.set(id, finish);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => finish(null), 15000);
  });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 240)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
// 总时长看门狗：某步把无头浏览器卡死时也要落地结论，不让回归脚本无限挂着
const watchdog = setTimeout(() => {
  console.log('\nTIMEOUT 看门狗触发（4 分钟未完成），已出结果 ' + results.length + ' 条');
  try { chrome.kill(); } catch (e) {}
  process.exit(2);
}, 240000);
const toObj = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return {}; } };

// ---- 开屏：进应用（与真机同路径：等数据就绪 → 点「进入」→ splash 退场） ----
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs(`(function(){
    try {
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
        var me = document.getElementById('splash-mandatory-enter'); if (me && !me.hidden) me.click();
        mm.hidden = true;
      }
      var sp = document.getElementById('splash');
      if (sp) { sp.classList.add('hide'); sp.hidden = true; }
      var mask = document.getElementById('modal-mask');
      if (mask && !mask.hidden) mask.hidden = true;
    } catch (e) {}
    return 1;
  })()`);
  await sleep(800);
  // splash「进入」后可能逢页面刷新（pwa/ver-check），刷完才谈得上运行期断言
  await waitReady();
}
// 等页面重新就绪（核心运行时在位）；纯 HEAD 上 window.checkinEnabled 本就没有，故不参与判定
async function waitReady() {
  for (let i = 0; i < 20; i++) {
    if (await evalJs("(typeof window.activeStore === 'function' && !!window.__mochiDataReady) ? 1 : 0")) return true;
    await sleep(300);
  }
  return false;
}
// 取现场（不抛异常）：页面尚未重新就绪时读到 undefined 属正常，交由各断言判红
async function snap() {
  const v = await evalJs(SNAPSHOT);
  const s = toObj(v);
  if (s && s.api !== undefined) return s;
  await sleep(1200);
  const again = toObj(await evalJs(SNAPSHOT));
  return again && again.api !== undefined ? again : {};
}

// 一次性取全部寻踪相关现场（同一次求值内读，避免多次往返之间被别的路径改写）
const SNAPSHOT = `(function(){
  var st = (typeof window.activeStore === 'function') ? window.activeStore() : { get: function () { return null; }, set: function () {} };
  var app = document.querySelector('.app[data-app="checkin"]');
  var hist = [];
  try { hist = JSON.parse(st.get('checkin-history') || '[]'); } catch (e) {}
  var cur = null;
  try { cur = JSON.parse(st.get('checkin-current') || 'null'); } catch (e) {}
  var pg = document.getElementById('page-checkin');
  var panel = document.getElementById('ck-panel');
  var fe = document.getElementById('ck-fe-en');
  return JSON.stringify({
    api: typeof window.checkinEnabled === 'function' ? (window.checkinEnabled() ? 1 : 0) : -1,
    key: st.get('checkin-en'),
    desk: app ? (getComputedStyle(app).display) : 'no-app',
    setRow: !!document.getElementById('sf-checkin-row'),
    setChk: (function(){ var i = document.getElementById('sf-checkin-en'); return i ? (i.checked ? 1 : 0) : -1; })(),
    feChk: fe ? (fe.checked ? 1 : 0) : -1,
    last: st.get('checkin-last'), next: st.get('checkin-next'),
    curTs: cur && cur.ts ? curTsOf(cur) : (cur && cur.place ? 'no-ts' : ''),
    curPlace: cur && cur.place ? cur.place : '',
    hist: hist.length,
    page: pg && !pg.hidden ? 1 : 0,
    banner: (function () { var b = document.getElementById('ck-off-tip'); return b && !b.hidden ? String(b.textContent || '').slice(0, 20) : ''; })(),
    panel: panel && !panel.hidden ? 1 : 0,
    errs: (window.__jsErrors || []).length
  });
  function curTsOf(o){ return String(o.ts); }
})()`;

await boot();

// ---- P1 开关在位且默认开启（老用户从未写过该键＝开启，图标可见、设置行已勾选） ----
{
  const s = await snap();
  check('P1 总开关在位、默认开启（桌面图标可见＋设置行已渲染并勾选）',
    s.api === 1 && s.setRow && s.setChk === 1 && s.desk !== 'none',
    JSON.stringify({ api: s.api, setRow: s.setRow, setChk: s.setChk, desk: s.desk, key: s.key }));
}

// ---- A2 点设置页真实开关关闭：键落 '0' ＋ 字卡库同名开关同步 ＋ 桌面图标不收起（#1403 改约） ----
{
  await evalJs("(function(){ var i=document.getElementById('sf-checkin-en'); if(i) i.click(); return 1; })()");
  await sleep(400);
  const s = await snap();
  // #823 原口径此处要求 desk==='none'；#1403 起桌面【寻踪】不再跟随总开关收起——「TA在身边 ·
  // 位置感知」的唯一入口就在这页里，收图标＝连带关掉另一个独立功能（作者直派第一条）
  check('A2 关闭生效：per-cid 键＝0、字卡库同名开关同步为关、桌面【寻踪】图标不收起',
    s.api === 0 && s.key === '0' && s.desk !== 'none' && s.feChk === 0,
    JSON.stringify({ api: s.api, key: s.key, desk: s.desk, feChk: s.feChk }));
}

// ---- A3 关闭后聊天「更多功能」里寻踪项收起（真实点「+」开面板；面板每次打开重算分类＝持久化冷态也收得住） ----
{
  await evalJs("(function(){ if (window.enterChat) window.enterChat(); return 1; })()");
  await sleep(500);
  await evalJs("(function(){ var b=document.getElementById('chat-more-btn'); if(b) b.click(); return 1; })()");
  await sleep(400);
  const r = toObj(await evalJs(`(function(){
    var it = document.getElementById('more-ck');
    var tool = document.querySelector('#more-tabs .more-tab[data-mcat="tool"]');
    if (tool) tool.click();
    return JSON.stringify({ before: it ? (it.hidden ? 1 : 0) : -1 });
  })()`));
  await sleep(200);
  const after = await evalJs("(function(){ var it=document.getElementById('more-ck'); return it ? (it.hidden?1:0) : -1; })()");
  check('A3 关闭后「更多功能」里的寻踪项收起（开面板与切到「工具」分类都不显示）',
    r.before === 1 && after === 1, JSON.stringify({ openPanel: r.before, toolTab: after }));
  await evalJs("(function(){ var p=document.getElementById('chat-more-panel'); if(p) p.hidden = true; return 1; })()");
}

// ---- A4 关闭后点顶部 TA 头像不再弹寻踪半框（chat.js 头像入口走 toggleCkPanel） ----
{
  await evalJs("(function(){ if (window.toggleCkPanel) window.toggleCkPanel(); return 1; })()");
  await sleep(400);
  const s = await snap();
  check('A4 关闭后点 TA 头像不弹寻踪半框', s.panel === 0, 'ck-panel 可见=' + s.panel);
}

// ---- A5（#1403 改约）关闭后寻踪页照样打开，并在页顶写明「已禁用」 ----
// 旧契约＝整页拦死＋一句 toast。作者直派：这一页里住着「TA在身边 · 位置感知」，拦页面＝连带拦掉
// 另一个独立功能；改成「进得去、看得见为什么不再更新」。这里同时兜住功能大全那类程序化跳转。
{
  await evalJs("(function(){ if (window.openCheckinPage) window.openCheckinPage(); return 1; })()");
  await sleep(400);
  const s = await snap();
  const inPage = await evalJs("(function(){ var e=document.getElementById('ck-loc-entry-desk'); return e ? 1 : 0; })()");
  check('A5 关闭后点桌面图标那条路径照样打开寻踪页，页顶写明「已禁用：联系人无法再触发更新日常」',
    s.page === 1 && s.banner.indexOf('已禁用') === 0, JSON.stringify({ page: s.page, banner: s.banner }));
  check('A5c 页面开着时「TA在身边 · 位置感知」那颗入口仍在（关寻踪不许连带关位置）', inPage === 1, 'entry=' + inPage);
}

// ---- A5b（#1403）关闭态点「刷新」不空转：给一句点名设置里那个开关的说明，且不落新记录 ----
// 旧写法＝按钮照常响应、进 doCheckin 首行闸门 return＝屏幕上一点反应都没有（站内最大宗那一型静默失败）
{
  const before = await snap();
  await evalJs("(function(){ var e=document.getElementById('cc-toast'); if(e) e.textContent=''; var b=document.getElementById('ck-refresh'); if(b) b.click(); return 1; })()");
  await sleep(400);
  const after = await snap();
  // 这句提示走的是 p2-features.js 内部那枚 toast（写 #cc-toast，不是 window.toast）——读数只能问 DOM
  const said = await evalJs("(function(){ var e=document.getElementById('cc-toast'); return e ? String(e.textContent || '') : ''; })()");
  const told = said.indexOf('已禁用') >= 0 && said.indexOf('设置') >= 0;
  check('A5b 关闭态点「刷新」有一句可执行说明、且不写新记录',
    told && after.hist === before.hist, JSON.stringify({ said: said.slice(0, 40), hist: [before.hist, after.hist] }));
  await evalJs("(function(){ var b=document.getElementById('checkin-back'); if(b) b.click(); return 1; })()");
  await sleep(300);
}

// ---- A6 关闭后自动轮询零副作用：把节奏键推回「该更新了」再走一遍启动同款触发（mochi-restore-done → bootCheckin → checkAutoCheckin） ----
{
  const before = await snap();
  await evalJs("(function(){ if (typeof window.activeStore !== 'function') return 0; var st=window.activeStore(); st.set('checkin-last','0'); st.set('checkin-next','0'); return 1; })()");
  await evalJs("(function(){ document.dispatchEvent(new Event('mochi-restore-done')); return 1; })()");
  await sleep(1500);
  const after = await snap();
  check('A6 关闭后自动链一步都不做：节奏键停在播种值、当前日常与记录不动、零推送',
    after.last === '0' && after.next === '0' && after.hist === before.hist && after.curTs === before.curTs && after.key === '0' && after.errs === before.errs,
    JSON.stringify({ last: [before.last, after.last], next: after.next, cur: [before.curTs, after.curTs], hist: [before.hist, after.hist], errs: [before.errs, after.errs] }));
}

// ---- A7 已有日常与寻踪记录原样保留（关闭不删数据；两侧同绿＝不破坏存量） ----
{
  const s = await snap();
  check('A7 关闭状态下已有日常与寻踪记录保留（记录条数 >0 且当前日常仍在库里）',
    s.hist > 0 && !!s.curPlace, JSON.stringify({ hist: s.hist, cur: s.curPlace }));
}

// ---- A8（#1403 换向）桌面图标唯一的收起理由＝装修里的手动隐藏名单 ----
// 旧契约这里量的是「切桌面／退出装修后图标仍收起」（applyHiddenIcons 会把名单外图标 display 复位
// 成 ''，总开关必须挤进那条并集才拦得住）。现在图标不跟随总开关，于是这一格换成量两件相反的事：
// 名单里真有它 → 收起后别被复位放回来；名单里没有它 → 总开关关着也必须在桌面上（否则位置感知又进不去）。
{
  await evalJs("(function(){ var st=window.activeStore(); var a=[]; try{a=JSON.parse(st.get('hidden-icons')||'[]');}catch(e){} if(a.indexOf('checkin')<0){a.push('checkin');st.set('hidden-icons',JSON.stringify(a));} if(window.applyDeskLayout)window.applyDeskLayout(); document.dispatchEvent(new Event('contact-switched')); document.dispatchEvent(new Event('decor-exited')); return 1; })()");
  await sleep(600);
  const s = await snap();
  check('A8 装修里手动隐藏过寻踪 → 图标收起，切桌面／退出装修后仍不复位放回',
    s.desk === 'none', 'desk=' + s.desk);
  await evalJs("(function(){ var st=window.activeStore(); var a=[]; try{a=JSON.parse(st.get('hidden-icons')||'[]');}catch(e){} a=a.filter(function(x){return x!=='checkin';}); st.set('hidden-icons',JSON.stringify(a)); if(window.applyDeskLayout)window.applyDeskLayout(); document.dispatchEvent(new Event('decor-exited')); return 1; })()");
  await sleep(600);
  const s2 = await snap();
  check('A8b 撤掉手动隐藏后图标回到桌面（总开关此刻仍是关闭态＝收起与否只认装修名单，不再连带关掉位置感知的入口）',
    s2.desk !== 'none' && s2.api === 0 && s2.key === '0', JSON.stringify({ desk: s2.desk, api: s2.api, key: s2.key }));
}

// ---- A9 重新开启即全恢复（图标回来、半框能开、寻踪页能开；开关两处同步） ----
{
  await evalJs("(function(){ var i=document.getElementById('sf-checkin-en'); if(i) i.click(); return 1; })()");
  await sleep(400);
  await evalJs("(function(){ if (window.toggleCkPanel) window.toggleCkPanel(); return 1; })()");
  await sleep(400);
  const s0 = await snap();
  await evalJs("(function(){ if (window.openCheckinPage) window.openCheckinPage(); return 1; })()");
  await sleep(500);
  const s1 = await snap();
  check('A9 重新开启即恢复：图标显示、点头像弹半框、寻踪页能打开、页顶「已禁用」说明条撤掉、两处开关同步为开',
    s1.api === 1 && s1.key === '1' && s1.desk !== 'none' && s0.panel === 1 && s1.page === 1 && s1.feChk === 1 && s1.banner === '',
    JSON.stringify({ api: s1.api, key: s1.key, desk: s1.desk, panel: s0.panel, page: s1.page, feChk: s1.feChk, banner: s1.banner }));
}

// ---- A10（#1403 第二条诉求）记录默认只展开当天、更早的按天收进「更早记录」----
// 旧写法把整条历史平铺进这张卡（日常每 1~8 小时一条＝一天最多十几条，几周后这一卡比整页还长＝
// 「寻踪记录没有自动折叠起来导致记录很长」＋追加口径「用户又不一定要保存那么多记录，这种无限变长的
// 记录还需要有单独的删除功能」。尺子只问渲染出来的 DOM 结构：今天几条平铺、更早切成几个月块（默认
// 折起、新月份在前）、每条有没有「删除」、点下去是不是先弹确认、确认后才少一条。
{
  const SEED = `(function(){
    var st = window.activeStore();
    var d = 864e5, now = Date.now();
    var mk = function (ts, tag) { return { t: '10:00:00', place: 'P' + tag, action: 'A' + tag, msg: 'M' + tag, ts: ts }; };
    // 顺手把节奏键推到「还早」：A6 里被拨回 0，此刻总开关已在 A9 重新开启，60s 轮询若插在播种与读 DOM
    // 之间会真生成一条当天记录＝把 todayRows 从 2 变成 3 的假红（夹具噪音，不是被测行为）
    st.set('checkin-last', String(now)); st.set('checkin-next', '8');
    st.set('checkin-history', JSON.stringify([mk(now - 70 * d, 'm3a'), mk(now - 70 * d, 'm3b'), mk(now - 30 * d, 'm2a'), mk(now - 1 * d, 'y1'), mk(now, 't1'), mk(now, 't2')]));
    if (window.openCheckinPage) window.openCheckinPage();
    return 1;
  })()`;
  await evalJs(SEED);
  await sleep(500);
  const r = toObj(await evalJs(`(function(){
    var el = document.getElementById('ck-history');
    if (!el) return JSON.stringify({});
    var todayRows = 0;
    Array.prototype.forEach.call(el.children, function (c) { if (c.classList.contains('ck-location')) todayRows++; });
    var ds = el.querySelectorAll('details.dc-h-more');
    var labels = [], cnts = [], openFlags = [];
    Array.prototype.forEach.call(ds, function (x) {
      labels.push(String((x.querySelector('.dc-h-more-sum') || {}).textContent || '').replace(/\\s+/g, ''));
      cnts.push(String((x.querySelector('.dc-h-more-cnt') || {}).textContent || ''));
      openFlags.push(x.open ? 1 : 0);
    });
    var first = ds[0];
    return JSON.stringify({
      todayRows: todayRows, blocks: ds.length, labels: labels, cnts: cnts, openFlags: openFlags,
      firstDay: first ? String((first.querySelector('.dc-h-day-label') || {}).textContent || '') : '',
      firstRows: first ? first.querySelectorAll('.ck-location').length : -1,
      dels: el.querySelectorAll('.hist-del').length,
      errs: (window.__jsErrors || []).length
    });
  })()`));
  check('A10 记录默认只展开当天（今天 2 条平铺；更早 4 条按月份折成 3 块、新月份在前、默认全折起）',
    r.todayRows === 2 && r.blocks === 3 && r.openFlags.join('') === '000'
    && /^2026年9月/.test(r.labels[0] || '') && /^2026年8月/.test(r.labels[1] || '') && /^2026年7月/.test(r.labels[2] || '')
    && /1 条/.test(r.cnts[0] || '') && /2 条/.test(r.cnts[2] || ''), JSON.stringify(r));
  check('A10b 月块里再按天分组、日标题点名「昨天」（当天不在这儿），块内条目一条不少',
    r.firstDay === '昨天' && r.firstRows === 1, JSON.stringify({ firstDay: r.firstDay, firstRows: r.firstRows }));
  check('A10c 每条行内都有「删除」（6 条＝今天 2 ＋ 月块里 4，一条都不能漏）', r.dels === 6, 'dels=' + r.dels);
  // 折叠不是把记录删掉：展开后里面 2 条真在
  const opened = await evalJs("(function(){ var ds=document.querySelectorAll('#ck-history details.dc-h-more'); var last=ds[ds.length-1]; if(!last) return -1; last.open = true; return last.querySelectorAll('.ck-location').length; })()");
  check('A10d 展开最旧那个月块后里面 2 条逐条可见（只折叠、不删数据、不封顶）', opened === 2, 'rows=' + opened);
  // A11 按条删除：先弹确认（回显删的是哪条），确认后才少那一条；数据仍走双写
  await evalJs("(function(){ var b=document.querySelectorAll('#ck-history .hist-del'); return b[0] ? (b[0].click(), 1) : 0; })()");
  await sleep(400);
  const m1 = toObj(await evalJs(`(function(){
    var mask = document.getElementById('modal-mask');
    return JSON.stringify({
      open: !!(mask && !mask.hidden),
      title: String((document.getElementById('modal-title') || {}).textContent || ''),
      stat: String((document.getElementById('modal-static') || {}).textContent || ''),
      len: (function(){ try { return JSON.parse(window.activeStore().get('checkin-history') || '[]').length; } catch (e) { return -1; } })()
    });
  })()`));
  check('A11 点「删除」先弹确认、把删的是哪条回显出来，此刻数据一条未少',
    m1.open === true && m1.title.indexOf('删除这条寻踪记录') >= 0 && m1.stat.indexOf('P') >= 0 && m1.len === 6, JSON.stringify(m1));
  await evalJs("(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()");
  await sleep(500);
  const m2 = toObj(await evalJs(`(function(){
    var el = document.getElementById('ck-history');
    var h = [];
    try { h = JSON.parse(window.activeStore().get('checkin-history') || '[]'); } catch (e) {}
    return JSON.stringify({
      len: h.length, tags: h.map(function (x) { return x && x.place ? String(x.place).slice(1) : '?'; }).join(','),
      dels: el ? el.querySelectorAll('.hist-del').length : -1,
      todayRows: el ? (function(){ var n = 0; Array.prototype.forEach.call(el.children, function (c) { if (c.classList.contains('ck-location')) n++; }); return n; })() : -1
    });
  })()`));
  check('A11b 确认之后只少那一条（点的是 DOM 里第一枚＝今天那行；6→5，月块里三条与今天另一条原样，今天从 2 行变 1 行）',
    m2.len === 5 && m2.tags.indexOf('m3a') >= 0 && m2.tags.indexOf('m3b') >= 0 && m2.tags.indexOf('t2') >= 0 && m2.tags.indexOf('t1') < 0 && m2.todayRows === 1, JSON.stringify(m2));
  // A11c 取消不动数据（防「一点就删」）
  await evalJs("(function(){ var b=document.querySelectorAll('#ck-history .hist-del'); if(b[0]) b[0].click(); return 1; })()");
  await sleep(350);
  await evalJs("(function(){ var b=document.getElementById('modal-cancel'); if(b) b.click(); return 1; })()");
  await sleep(400);
  const kept = await evalJs("(function(){ try { return JSON.parse(window.activeStore().get('checkin-history') || '[]').length; } catch (e) { return -1; } })()");
  check('A11c 确认框里点「取消」＝一条不删', kept === 5, 'len=' + kept);
  // A12 数据还在回填时不许删（本地快照可能不是库里那份，一次 splice 会连带抹掉没读回来的＝#1330/#1359 母型）
  await evalJs(`(function(){
    window.__ckToast = [];
    var mask = document.getElementById('modal-mask'); if (mask) mask.hidden = true; // 上一发（取消）之后先把弹层复位，别让残留的「开着」冒充这一发的判定
    var t = window.toast;
    window.toast = function (m) { try { window.__ckToast.push(String(m)); } catch (e) {} if (t) return t.apply(null, arguments); };
    window.__mochiHistPendingReal = window.mochiDataPending;
    window.mochiDataPending = function () { return true; };
    var b = document.querySelectorAll('#ck-history .hist-del');
    if (b[0]) b[0].click();
    return 1;
  })()`);
  await sleep(400);
  const gated = toObj(await evalJs(`(function(){
    var mask = document.getElementById('modal-mask');
    var len = -1;
    try { len = JSON.parse(window.activeStore().get('checkin-history') || '[]').length; } catch (e) {}
    if (window.__mochiHistPendingReal) window.mochiDataPending = window.__mochiHistPendingReal;
    return JSON.stringify({ maskOpen: !!(mask && !mask.hidden), mtitle: String((document.getElementById('modal-title') || {}).textContent || ''), len: len, toasts: window.__ckToast || [] });
  })()`));
  // 收口批补二改判据：原「maskOpen===false」会被站内一次性弹层（storage-guide/备份提醒，新装档必弹）恰落窗内打红＝假红（2026-09-30 实测读数：toast 与不删两条产品行为全对、只有 maskOpen=true）。改判「没弹删除确认框」——站内其它弹层真人会自己点掉，与判据无关（同 A11 族口径）。
  check('A12 记录还在读取时点删除＝不弹删除确认、一条不删，并给一句「稍等一下再删」',
    gated.len === 5 && gated.toasts.some((m) => m.indexOf('稍等一下再删') >= 0) && String(gated.mtitle || '').indexOf('删除这条') < 0, JSON.stringify(gated));
  // A10e 没有 ts 的存量记录：不猜日期，整批落进末尾「更早」月块里照旧可查、也照旧删得掉
  await evalJs(`(function(){
    var st = window.activeStore();
    st.set('checkin-history', JSON.stringify([{ t: '09:00:00', place: '老数据A', action: '老动作A' }, { t: '10:00:00', place: 'P today', action: 'A today', ts: Date.now() }]));
    if (window.openCheckinPage) window.openCheckinPage();
    return 1;
  })()`);
  await sleep(450);
  const nodate = toObj(await evalJs(`(function(){
    var el = document.getElementById('ck-history');
    var det = el ? el.querySelector('details.dc-h-more') : null;
    return JSON.stringify({
      today: el ? el.querySelectorAll(':scope > .ck-location').length : -1,
      label: det ? String((det.querySelector('.dc-h-more-sum') || {}).textContent || '') : '',
      inner: det ? det.querySelectorAll('.ck-location').length : -1
    });
  })()`));
  check('A10e 没有 ts 的存量老记录归进「更早」并照旧可查（不猜日期、也不静默丢掉）',
    nodate.today === 1 && nodate.inner === 1 && nodate.label.indexOf('更早') === 0, JSON.stringify(nodate));
  // 那条老记录也删得掉（key＝原始下标，不是 ts）
  await evalJs("(function(){ var ds=document.querySelectorAll('#ck-history details.dc-h-more'); var b=ds.length ? ds[ds.length-1].querySelector('.hist-del') : null; if(b) b.click(); return 1; })()");
  await sleep(350);
  await evalJs("(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()");
  await sleep(450);
  const nodateAfter = toObj(await evalJs(`(function(){
    var h = [];
    try { h = JSON.parse(window.activeStore().get('checkin-history') || '[]'); } catch (e) {}
    var el = document.getElementById('ck-history');
    return JSON.stringify({ len: h.length, left: h.map(function (x) { return x.place || ''; }).join(','), blocks: el ? el.querySelectorAll('details.dc-h-more').length : -1 });
  })()`));
  check('A11d 无 ts 的老记录同样按条删得掉（删完只剩当天那条，「更早」块随之消失）',
    nodateAfter.len === 1 && nodateAfter.left === 'P today' && nodateAfter.blocks === 0, JSON.stringify(nodateAfter));
}

// ---- S1 产物锚点（逻辑锚；修复被并行会话覆盖即消失）----
// #1403：本组原来到 index.html 里数 JS 锚点，而 JS 早已外置成 js/<file>.js（同一族存量误红见
// verify-music-msg-sfx 的 A 组：产物里压根不含这些串＝恒红）。改成各件读各件；设置/使用说明仍读 index.html。
{
  const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
  const html = art('index.html');
  const P2 = art(join('js', 'p2-features.js'));
  const CHAT = art(join('js', 'chat.js'));
  const PERS = art(join('js', 'personalize.js'));
  const IDB = art(join('js', 'idb.js')) || html; // 内联件回落 index.html（见上方注释）
  const cnt = (txt, n) => txt.split(n).length - 1;
  const SL = String.fromCharCode(47, 47); // 斜杠对，避免本文件里出现裸注释串
  const anchors = {
    gateDo: cnt(P2, 'if (!ckEn()) return; ' + SL + ' #823a'),           // 生成侧总闸（本批一字未动）
    gatePanel: cnt(P2, 'if (!ckEn()) return; ' + SL + ' #823b'),         // 半框闸（未动）
    key: cnt(P2, "const CK_EN_KEY = 'checkin-en';"),
    deskOff: cnt(P2, 'window.checkinDeskOff = function () { return false; };'), // #1403 换向后的口径
    pageOpens: cnt(P2, 'else if (ckEn()) doCheckin();'),
    iconManOnly: cnt(P2, "checkinApp.style.display = man ? 'none' : '';"),
    banner: cnt(P2, 'card.insertBefore(el, card.firstChild);'),
    refreshTold: cnt(P2, "if (!ckEn()) { toast('寻踪已禁用：设置 → 工具 → 寻踪 重新开启后才能刷新日常'); return; }"),
    dayGroup: cnt(P2, 'histEl.innerHTML = window.mochiHistFold('),
    // idb.js 与 device.js 同属「core 内联」那几件，产物里没有 js/idb.js 这份文件——读它恒空串＝假绿，
    // 与 build.mjs 的 artifactText 同口径回落 index.html（#1403 第二轮把折叠抽成共用件后必须这样取）
    histFold: cnt(IDB, 'window.mochiHistFold = function'),
    histDel: cnt(IDB, 'window.mochiHistDelBind = function'),
    fold: cnt(IDB, "HIST_FOLD_OPEN[fk]"), // 收口批补二重锚：#1402/#1417 族给 details 加了 HIST_FOLD_OPEN 状态恢复（未读组默认开/开合态持久），旧静态形态锚已从产物消失（2026-09-30 实测 fold:0）
    ckDel: cnt(P2, 'window.mochiHistDelBind(document.getElementById(\'ck-history\')'),
    more: cnt(CHAT, "it.id === 'more-ck' && window.checkinEnabled"),     // 聊天那头仍收（未动）
    iconUnion: cnt(PERS, "if (hidden.indexOf(key) >= 0 || (ckOff && key === 'checkin')) app.style.display = 'none';"),
    help: cnt(html, '寻踪（TA 的日常）'),
    lic: cnt(html, '不想用寻踪可以整体关闭')
  };
  const all = Object.values(anchors).every((n) => n >= 1);
  check('S1 产物锚点齐备（两道生成闸＋开关键＋图标口径＋页面可进＋已禁用条＋刷新不空转＋按月折叠与共用尺子＋寻踪按条删＋聊天侧两针＋说明文案）',
    all, JSON.stringify(anchors));
  // device.js 属「core 内联 3 个文件」之一，产物里没有 js/device.js 这份文件——读它恒得空串＝假绿。
  // 与 build.mjs 的 artifactText 同口径：外置名单之外的文件一律在 index.html 里找（针 #1403f）
  check('S1b 删除型锚：功能诊断那句拿总开关当「未生效」原因的措辞不回流',
    cnt(html, '寻踪总开关已关闭：设置 → 工具 → 寻踪 可重新开启') === 0);
  let sh = '';
  try { sh = readFileSync(join(root, 'js', 'settings-help.js'), 'utf8'); } catch (e) {}
  check('S2 设置页搜索/说明素材登记在位（外置 settings-help.js 认 #sf-checkin-row）',
    sh.indexOf("sel: '#sf-checkin-row'") >= 0);
}

const failed = results.filter((r) => !r.ok);
clearTimeout(watchdog);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过' + (failed.length ? '；失败：' + failed.map((f) => f.desc).join(' | ') : ''));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(failed.length ? 1 : 0);

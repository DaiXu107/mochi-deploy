// ===== 经期日历「点一格 → 记上这次经期」链路验证 =====
// 家族史：OPPO Reno16（v3.10.x）「没办法设置成生理期／编辑完确定也不会变红」。2026-09-29 作者
// 复报「无法直接**点击**经期日历里的时间设置经期周期」，量出三条：
//   ① 点一格只落 1 天（记 7 天要点 7 次）＝这个入口给不出「一个周期」；
//   ② 点日格整发被吞＝弹层都不出——旧写法在日历上挂了一枚 500ms 计时器判长按，靠 contextmenu
//      与 click 互吞去重；主线程一卡（本站自带「卡顿自检」量的就是这类长任务）计时器赶在松手前
//      先响，松手补发的那一发 click 就被吞掉＝用户所见「点了没反应」；
//   ③ 月首月尾那些格子是「看得见、点不动」的死格，而补记偏偏落在月头月尾。
// ⚠️ 本尺一律走 Input.dispatchTouchEvent 真触摸＋按前 elementFromPoint 命中测试：旧版 A/B 组用
//    element.click() 直接调，绕过整条触摸管线——②那种「点了没反应」在它眼里永远是绿的。
// 用法：node tools/verify-period-mark.mjs [产物目录]（首行打印被测根目录＝防喂错产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] ? resolve(process.argv[2]) : dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pmark-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function tStart(x, y) { await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); }
async function tEnd() { await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function rawTap(x, y, hold = 60) { await tStart(x, y); await sleep(hold); await tEnd(); await sleep(450); }
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
// 本尺测的是日历点按，不是这两条产品功能，所以按「今天已经提醒过／更新引导已送达」的正常状态起手
// （判据与 pwa.js due()／storage-guide.js FLAG_KEY 同源，一个字都没改它们的逻辑）：
//   xy-home-v2:__last-backup-remind ＝ 定期备份提醒的当日冷却；xy-home-v2:storage-guide-shown ＝ 送达账
const SEED_FLAGS = `(function(){ try {
  localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
  localStorage.setItem('xy-home-v2:storage-guide-shown', '1250');
} catch (e) {} })()`;

// 取元素中心 + 命中测试：手指落点必须真的落在要测的那个元素上，否则本尺不认自己的读数
async function hit(sel) {
  return await evalJs(`(function(){
    var c = document.querySelector(${JSON.stringify(sel)});
    if (!c) return { ok: false, why: 'no-el', sel: ${JSON.stringify(sel)} };
    var r = c.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var e = document.elementFromPoint(x, y);
    return { ok: !!e && (e === c || c.contains(e)), x: x, y: y, hit: e ? (e.tagName + '.' + String(e.className || '')) : 'none' };
  })()`);
}
// 备份提醒／引导这类 openModal 会在任意时刻落下（#1263 让路闸），它一盖住页面点按就全落它身上：
// 先按用户那一路真触摸关掉，再量命中；关掉几个数一并进读数，别让它把「点不动」洗成假绿
async function dismissModals() {
  let n = 0;
  for (let i = 0; i < 6; i++) {
    // 只按「收得掉弹窗」那几枚：先找 稍后/取消/知道了，再退到 .modal-btn.cancel；
    // 绝不能顺手按「去备份」那种会跳页的按钮（旧写法取 querySelector 第一个 button＝点了个跳转）
    const pick = await evalJs(`(function(){
      var m = document.getElementById('modal-mask');
      if (!m || m.hidden) return null;
      // 引导／说明类弹窗要滑到底才亮确认件（verify-1266 同法），先把正文滚到底再挑按钮
      [].slice.call(m.querySelectorAll('.modal-static, .modal-textarea, .modal-scroll, .modal')).forEach(function(el){
        try { el.scrollTop = el.scrollHeight; } catch (e) {}
      });
      var box = m.querySelector('.modal'); if (box) { try { box.scrollTop = box.scrollHeight; } catch (e) {} }
      var vis = [].slice.call(m.querySelectorAll('button, .pill')).filter(function(b){
        var r = b.getBoundingClientRect(); return r.width > 2 && r.height > 2;
      });
      var want = vis.filter(function(b){ return /稍后|以后|知道|不用|取消|关闭/.test(String(b.textContent)); })[0]
        || vis.filter(function(b){ return /cancel/.test(String(b.className)); })[0];
      if (!want) return null;
      var r = want.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!pick) break;
    await rawTap(pick.x, pick.y); n++;
    await sleep(600);
  }
  // 「TA 的小问题」那类站内面板会随时顶上来（#tc-mask＋#tc-mask-close），它盖住日历时按到的不是日格
  for (let i = 0; i < 4; i++) {
    const q = await hit('#tc-mask:not([hidden]) #tc-mask-close, .mg-mask:not([hidden]) .mg-close');
    if (!q || !q.ok) break;
    await rawTap(q.x, q.y); n++;
    await sleep(600);
  }
  return n;
}
// 弹窗可能在载入后 1~4 秒才落下（#1263 让路闸），所以「关一次」不等于「干净」：边关边等
async function hitReady(sel, tries = 14) {
  let n = 0;
  for (let i = 0; i < tries; i++) {
    n += await dismissModals();
    const q = await hit(sel);
    if (q && q.ok) { q.dismissed = n; return q; }
    const maskUp = await evalJs(`(function(){ var m = document.getElementById('modal-mask'); return !!m && !m.hidden && getComputedStyle(m).display !== 'none'; })()`);
    const wait = maskUp ? 700 : 350;
    await sleep(wait);
  }
  const q2 = await hit(sel);
  if (q2) q2.dismissed = n;
  return q2;
}
async function tapSel(sel, note, hold) {
  const q = await hitReady(sel);
  if (!q || !q.ok) { check(note + '：命中测试过关（手指真落在那个元素上）', false, '关掉 ' + (q && q.dismissed) + ' 个弹窗后 ' + JSON.stringify(q)); return false; }
  await rawTap(q.x, q.y, hold);
  return true;
}
async function dsOf(off) {
  return await evalJs(`(function(){ var d = new Date(); d.setDate(d.getDate()+${off});
    var p = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(function(n){ return String(n).padStart(2, '0'); });
    return p[0]+'-'+p[1]+'-'+p[2]; })()`);
}
function addDaysDs(ds, n) { const d = new Date(ds); d.setDate(d.getDate() + n); const p = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((x) => String(x).padStart(2, '0')); return p[0] + '-' + p[1] + '-' + p[2]; }
// 那条「数据会被自动清空 · 备份提醒」是产品功能（pwa.js，不许绕），但它会随时盖住日历；
// 本尺测的是点按链路＝按「今天已经提醒过」的正常状态起手，不替它改判据也不删它。
const seed = (recs, cfg) => evalJs(`(function(){ var st = window.xyStore('xy-home-v2');
  st.set('period-migrated','1'); st.set('period-daily','{}');
  st.set('period-cfg', JSON.stringify(${JSON.stringify(cfg)}));
  st.set('period-records', JSON.stringify(${JSON.stringify(recs)}));
  try { st.set('__last-backup-remind', String(Date.now())); } catch (e) {}
  return 1; })()`);
async function gotoPeriod() {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(250);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: SEED_FLAGS });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1400);
  // 开屏公告与「唯一遮罩」族（同 verify-1266 的处置）：本尺测的是日历点按，先撤干净
  await evalJs(`(function(){try{var s=document.querySelector('#splash,.splash');if(s)s.remove();var q=document.querySelector('#qa-mask');if(q)q.remove();}catch(e){}return 1;})()`);
  await evalJs(`(function(){document.querySelector('.app[data-app="period"]').click();return 1;})()`);
  await sleep(800);
  // 定期备份提醒／引导类 openModal 弹出时刻不定，逐层真触摸关掉，关到够得着日历为止
  for (let i = 0; i < 10; i++) {
    const q = await hit('#period-grid .pc-cell[data-date]');
    if (q && q.ok) break;
    const ok = await hit('#modal-mask:not([hidden]) .modal-ok, #modal-mask:not([hidden]) button');
    if (!ok || !ok.ok) break;
    await rawTap(ok.x, ok.y);
    await sleep(600);
  }
  // 记账探针：每一次写 period-records 都记一笔＝「这一发点按到底落了几次账」拿得到读数
  await evalJs(`(function(){
    window.__w = [];
    var _s = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) { if (String(k).indexOf('period-records') >= 0) window.__w.push(String(v)); return _s(k, v); };
    return 1;
  })()`);
}
const reads = (forDs) => evalJs(`(function(){
  var FOR = ${JSON.stringify(forDs || '')};
  var out = { writes: (window.__w || []).slice(-4), recs: window.xyStore('xy-home-v2').get('period-records') || '[]' };
  var p = document.getElementById('period-day-pop');
  out.pop = !!p;
  out.popDate = p ? String(((p.querySelector('.dp-date') || {}).textContent) || '') : '';
  var pb = p && p.querySelector('.dp-period');
  out.swOn = !!(pb && pb.classList.contains('on'));
  out.swText = pb ? String(pb.textContent || '') : '';
  var cd = FOR || out.popDate;
  var c = cd ? document.querySelector('#period-grid .pc-cell[data-date="' + cd + '"]') : null;
  out.cellCls = c ? c.className : '(找不到那格 ' + cd + ')';
  out.cellDs = cd || '';
  out.rows = Array.prototype.map.call(document.querySelectorAll('#period-history .period-hist-row'), function(r){ return r.querySelector('.ph-date').textContent + '|' + r.querySelector('.ph-meta').textContent; });
  return out;
})()`);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
console.log('被测根目录: ' + root);
const PERIOD_LEN = 5;
const CFG = { cycleLen: 28, periodLen: PERIOD_LEN, lutealPhase: 14 };

// 目标日：本月 8 号（不贴着今天，避免与「标记今天开始／记录今天」两个入口的读数混在一起）
await seed([], CFG);
await gotoPeriod();
const target = await evalJs(`(function(){ var d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-08'; })()`);
const pre = await hitReady(`#period-grid .pc-cell[data-date="${target}"]`);
check('P0 撤罩后命中测试真的落在目标日格上（本尺不测被遮住的假绿）', pre && pre.ok, JSON.stringify(pre));
if (!pre || !pre.ok) { console.log('前置不成立＝读数无意义，直接收场'); chrome.kill(); server.close(); process.exit(1); }

// ===== A 组：点一格＝一步落成「按设置天数」的整段 =====
await dismissModals();
await rawTap(pre.x, pre.y);
let R = await reads();
check('A1 真触摸点一格 → 弹层打开且日期＝所点那一格', R.pop && R.popDate === target, 'pop=' + R.pop + ' 弹层日期=' + R.popDate + ' 所点=' + target);
const recA = JSON.parse(R.recs || '[]');
const wantEnd = addDaysDs(target, PERIOD_LEN - 1);
check('A2 落库＝一条、区间＝所点那天起 ' + PERIOD_LEN + ' 天（旧口径＝只落那一天，或点了根本不落账）',
  recA.length === 1 && (recA[0] || {}).start === target && (recA[0] || {}).end === wantEnd, JSON.stringify(recA) + ' / 期望尾 ' + wantEnd);
check('A3 那一格当场变红（不必回弹层再按保存）', /ph-period/.test(R.cellCls), R.cellCls);
check('A4 这一发点按只写一次账（没有标了又撤＝两路手势互吞那族）', R.writes.length === 1, JSON.stringify(R.writes));
check('A5 弹层里的生理期开关回显「已标记」', R.swOn === true, R.swText);
const before2 = R.recs;
await rawTap(pre.x, pre.y);
R = await reads();
check('A6 再点同一格＝只开弹层、账一字未动（浏览性点按不许误删）', R.pop && R.recs === before2, 'recs 变了=' + (R.recs !== before2));
check('A7 历史行报出整段天数（旧口径＝持续 1 天）', new RegExp('持续 ' + PERIOD_LEN + ' 天').test(R.rows.join('|')), R.rows.join('|'));
// 顺带走一遍旧版量过的完整编辑流程（经量＋备注 → 保存不崩、daily 落得住）
await tapSel('#period-day-pop .dp-flow[data-flow="medium"]', 'A8 选经量');
await evalJs(`(function(){ var p = document.getElementById('period-day-pop'); if (!p) return 0;
  var nb = p.querySelector('.ce-box.dp-note') || p.querySelector('textarea.dp-note');
  if (nb) nb.textContent = '第一天，肚子有点疼'; return 1; })()`);
await tapSel('#period-day-pop .dp-save', 'A9 点保存');
R = await reads(target);
const daily = await evalJs(`window.xyStore('xy-home-v2').get('period-daily') || '{}'`);
check('A8 经量＋备注照常落库、保存后浮层关闭（v3.10.x 那条「填完点保存不崩」未动）',
  !R.pop && String(daily).indexOf('medium') >= 0 && String(daily).indexOf('肚子有点疼') >= 0, String(daily));

// ===== B 组：取消的出口在弹层开关上 =====
await tapSel(`#period-grid .pc-cell[data-date="${target}"]`, 'B0 点那格');
await tapSel('#period-day-pop .dp-period', 'B1 点开关');
R = await reads();
check('B1 关开关 → 文案回到「这天起记为生理期（N 天）」并写明段长', R.swOn === false && new RegExp(PERIOD_LEN + ' 天').test(R.swText), R.swText);
await tapSel('#period-day-pop .dp-save', 'B2 点保存');
R = await reads(target);
check('B2 保存 → 以这天为起点的那一段整段撤掉（回到没点过）', JSON.parse(R.recs || '[]').length === 0, R.recs);
check('B3 那一格回成非经期', R.cellCls.indexOf('ph-period') < 0, R.cellDs + ' → ' + R.cellCls);
// 中间日：点已标记的一天只开弹层、不动数据；要摘那一天得关开关（旧拆分口径）
await seed([{ id: 'm1', start: target, end: wantEnd }], CFG);
await gotoPeriod();
const midDay = addDaysDs(target, 2);
await tapSel(`#period-grid .pc-cell[data-date="${midDay}"]`, 'B4 点段中间那天');
R = await reads();
const mRec = JSON.parse(R.recs || '[]');
check('B4 点段中间那一天＝只开弹层、不拆段（点按不做破坏性动作）',
  mRec.length === 1 && (mRec[0] || {}).start === target && (mRec[0] || {}).end === wantEnd, JSON.stringify(mRec));
await tapSel('#period-day-pop .dp-period', 'B5 关掉开关');
await tapSel('#period-day-pop .dp-save', 'B6 保存');
R = await reads(midDay);
const mRec2 = JSON.parse(R.recs || '[]');
check('B5 中间那天关开关→保存＝只摘那一天（拆成前后两截＝旧拆分口径未动）',
  mRec2.length === 2 && mRec2.every((x) => !(x.start === midDay && x.end === midDay)), JSON.stringify(mRec2));

// ===== C 组：不再吞点击（本次复报第二条）=====
const prodJs = (() => { try { return readFileSync(join(root, 'js', 'period.js'), 'utf8'); } catch (e) { return ''; } })();
check('C1 日历上那枚长按计时器与 contextmenu 两路已整块拆除（名字回到产物里＝竞态回流）',
  prodJs.indexOf('pressTimer') < 0 && prodJs.indexOf("'contextmenu'") < 0,
  '计时器名 ' + (prodJs.match(/pressTimer/g) || []).length + ' 次 / contextmenu ' + (prodJs.match(/contextmenu/g) || []).length + ' 次');
await seed([], CFG);
await gotoPeriod();
const d9 = await evalJs(`(function(){ var d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-09'; })()`);
const h9 = await hitReady(`#period-grid .pc-cell[data-date="${d9}"]`);
// 按住后把主线程占住 700ms 再松手＝真机「点了没反应」那一型（长任务把计时器推到松手之前）
if (h9 && h9.ok) {
  await tStart(h9.x, h9.y);
  await evalJs(`(function(){ var t = Date.now(); while (Date.now() - t < 700) {} return 1; })()`);
  await tEnd();
  await sleep(600);
}
R = await reads();
const cRec = JSON.parse(R.recs || '[]');
check('C2 按住后被长任务卡住再松手 → 弹层仍打开（旧写法这一发被吞＝用户所见「点了没反应」）',
  R.pop === true, 'pop=' + R.pop + ' 读数=' + JSON.stringify(R.cellCls));
check('C3 同一发卡住的点按只落一次账、且落的是整段',
  cRec.length === 1 && (cRec[0] || {}).end === addDaysDs(d9, PERIOD_LEN - 1), JSON.stringify(cRec));
await seed([], CFG);
await gotoPeriod();
const d11 = await evalJs(`(function(){ var d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-11'; })()`);
const h11 = await hitReady(`#period-grid .pc-cell[data-date="${d11}"]`);
if (h11 && h11.ok) await rawTap(h11.x, h11.y, 900);
else check('C4 前置：那一格点得到', false, JSON.stringify(h11));
R = await reads();
const lRec = JSON.parse(R.recs || '[]');
check('C4 按住 900ms 与轻点同一读法（同一格不再有两种手势两态＝零计时器判据）',
  lRec.length === 1 && (lRec[0] || {}).start === d11 && (lRec[0] || {}).end === addDaysDs(d11, PERIOD_LEN - 1), JSON.stringify(lRec));

// ===== D 组：月首月尾补格不再是死格（本次复报第三条）=====
await seed([], CFG);
await gotoPeriod();
const grid = await evalJs(`(function(){
  var all = [].slice.call(document.querySelectorAll('#period-grid .pc-cell'));
  var out = { n: all.length, dead: 0, deadCls: [], outs: 0, opacity: {} };
  all.forEach(function(c){
    if (!c.getAttribute('data-date')) { out.dead++; out.deadCls.push(c.className); }
    if (c.classList.contains('pc-out')) { out.outs++; if (out.opacity.out === undefined) out.opacity.out = getComputedStyle(c).opacity; }
    else if (out.opacity.in === undefined) out.opacity.in = getComputedStyle(c).opacity;
  });
  out.month = (document.getElementById('period-month-txt') || {}).textContent || '';
  return out;
})()`);
check('D1 整屏没有「看得见、点不动」的死格（每格都带 data-date、且整行填满）', grid.dead === 0 && grid.n % 7 === 0, JSON.stringify(grid));
check('D2 补进来的相邻月格淡一档、与当月格读数不同（认得出谁不是这个月）', grid.outs > 0 && grid.opacity.out !== grid.opacity.in, JSON.stringify(grid.opacity));
const tailDs = await evalJs(`(function(){
  var a = [].slice.call(document.querySelectorAll('#period-grid .pc-cell.pc-out')).filter(function(c){ return c.classList.contains('ph-none'); });
  var c = a[a.length - 1]; return c ? c.getAttribute('data-date') : null;
})()`);
const hTail = tailDs ? await hitReady(`#period-grid .pc-cell[data-date="${tailDs}"]`) : { ok: false, why: 'no-tail-cell' };
check('D3 视图末尾找得到一格空的补日（旧写法：下月头几天根本不在这一屏上）', hTail.ok, tailDs + ' ' + JSON.stringify(hTail));
if (hTail.ok) {
  await rawTap(hTail.x, hTail.y);
  R = await reads();
  const tRec = JSON.parse(R.recs || '[]');
  check('D4 真触摸点那格补日 → 记上的区间起点＝那个补日（跨月的日子不必再翻月去够）',
    tRec.length === 1 && (tRec[0] || {}).start === tailDs, tailDs + ' → ' + JSON.stringify(tRec));
  const tailPaint = await evalJs(`(function(){
    var a = [].slice.call(document.querySelectorAll('#period-grid .pc-cell.pc-out'));
    return { n: a.filter(function(c){ return c.classList.contains('ph-period'); }).length, cls: a.map(function(c){ return c.getAttribute('data-date') + ':' + c.className.replace('pc-cell ', ''); }).join(' ') };
  })()`);
  check('D5 一段经期跨到次月时，次月那几天在补格里也照涂实心（与当月格同一套着色）', tailPaint.n >= 1, JSON.stringify(tailPaint));
} else {
  // 红侧必须照样出数（旧版这里整块跳过＝两侧条数不一样，差集读不出「净红几条」）
  check('D4 真触摸点那格补日 → 记上的区间起点＝那个补日（跨月的日子不必再翻月去够）', false, '压根没有补格可点＝D3 的下游');
  check('D5 一段经期跨到次月时，次月那几天在补格里也照涂实心（与当月格同一套着色）', false, '同上');
}

// ===== E 组：没修过头（两侧皆绿的对照组）=====
await seed([], CFG);
await gotoPeriod();
const todayDs = await dsOf(0);
await tapSel('#period-record-today', 'E1 点「记录今天」');
R = await reads();
check('E1 「记录今天」真触摸仍能开弹层（#1266 那条旧契约未动）', R.pop && R.popDate === todayDs, R.popDate + ' / ' + todayDs);
await tapSel('#period-day-pop .dp-close', 'E1b 关掉弹层');
await tapSel('#period-record-span', 'E2 点「记一次经期」');
check('E2 「记一次经期」入口仍在且仍能开（#1387e 那条针的契约没被本批换掉）',
  await evalJs(`!!document.getElementById('period-record-pop')`) === true, '');
await evalJs(`(function(){ var p = document.getElementById('period-record-pop'); if (p) p.remove(); document.body.classList.remove('scroll-lock'); return 1; })()`);
await seed([{ id: 'h1', start: await dsOf(-30), end: await dsOf(-26) }, { id: 'h2', start: await dsOf(-2), end: await dsOf(2) }], CFG);
await gotoPeriod();
const nextLine = await evalJs(`(function(){ var e = document.getElementById('period-next-line'); return e ? { hidden: !!e.hidden, text: e.textContent } : null; })()`);
check('E3 状态卡「下次经期预计 M/D ~ M/D」日期行照常（#1321 那条口径未动）',
  !!nextLine && !nextLine.hidden && /下次经期预计/.test(nextLine.text), JSON.stringify(nextLine));
await tapSel('#period-cog', 'E4 点齿轮');
check('E4 周期设置面板仍能开（三个 stepper 在位）',
  await evalJs(`(function(){ var p = document.getElementById('period-settings-pop'); return !!p && p.querySelectorAll('.dp-stepper').length === 3; })()`) === true, '');
const errs = await evalJs(`(window.__jsErrors || []).slice(0,6)`);
check('E5 全程零未捕获异常', !errs || !errs.length, JSON.stringify(errs));

const passed = results.filter((r) => r.ok).length;
console.log('\n合计: ' + passed + ' 通过 / ' + (results.length - passed) + ' 失败 / ' + results.length + ' 条');
chrome.kill(); server.close();
process.exit(results.length - passed ? 1 : 0);

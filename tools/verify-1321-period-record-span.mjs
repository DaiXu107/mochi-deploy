// ===== #1321 经期「记一次经期」＋「下次经期日期行」＋「本次经期不再涂成预测」行为验证 =====
// 用户实报（2026-09-27）：「无法直接记录一个周期，或者我直接记了，今天它没有后面直接显示这个月的
// 经期预测的时间，正常我设置的时候会直接设置我的经期是几天。」
// 纯 HEAD 同尺量到的三件事（本脚本按同一把尺子复现，实测读数见各条 detail）：
//   ① 记一次经期没有一次记完的入口：长按一格＝只算 1 天（历史行「持续 1 天」＋状态卡「预计还剩 1 天」，
//      设置里的「经期天数」在这条路上被吃掉）；「标记今天开始」＝按设置铺 7 天；设置页那个日期字段
//      补出来的是一条永不结束的「进行中」——同一个「今天来经」三种读法。
//   ② 预测算出来了却全页没有一处写成日期：状态卡只有「距下次经期约 N 天」，日历只画当月格＝下次开始
//      日落到下个月时本月一格预测都没有（实测 9/27 记录 → nextStart 10/25，9 月零格）。
//   ③ dayPhase 把「已记下的这一次经期自己」也当预测起点（starts[0]）＝本次经期的剩余天数被涂成图例上
//      明写「预测」的那种颜色（实测实心 1 格＋9/28~9/30 三格虚线）。
// 零机型／零 UA 分支：判据只取「这条记录自己写了几天」「这一格属于已记区间还是未来区间」两个数据事实。
// 夹具全部按「距今天 N 天」偏移生成＝换日子跑同样成立。无头 Chrome 真跑产物、真点按钮、真长按日格。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('被测根目录:', root);
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9840 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1321-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接 CDP');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : '')); }
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const cnt = (hay, n) => hay.split(n).length - 1;
if (!read('index.html')) { console.error('根目录没有 index.html＝产物未构建，退出（不当成断言失败）'); process.exit(2); }

// ---- A 组：锚点（src + 产物各查一次；旧形态回流即红）----
const SRC = read('src/js/period.js'), PROD = read('js/period.js');
const MA_SRC = read('src/js/mobile-adapt.js'), MA_PROD = read('js/mobile-adapt.js');
const HTML = read('index.html');
const PRED_NEW = 'for (var j = 1; j < starts.length; j++)';
const PRED_OLD = 'for (var j = 0; j < starts.length; j++)';
check('A1 预测着色跳过「已记下的那一次自己」（starts[0]）', cnt(SRC, PRED_NEW) === 1 && cnt(PROD, PRED_NEW) === 1,
  'src ' + cnt(SRC, PRED_NEW) + ' / 产物 ' + cnt(PROD, PRED_NEW));
check('A2 旧形态（连第 0 项一起涂预测）未回流', cnt(PROD, PRED_OLD) === 0, cnt(PROD, PRED_OLD));
check('A3 状态卡有「下次经期预计 …~…」日期行', cnt(PROD, "'下次经期预计 '") === 1 && cnt(PROD, "id = 'period-next-line'") === 1,
  cnt(PROD, "'下次经期预计 '") + '/' + cnt(PROD, "id = 'period-next-line'"));
check('A4 「记一次经期」弹层在册（新入口唯一收口）', cnt(PROD, 'function openRecordPop()') === 1 && cnt(PROD, "id = 'period-record-pop'") === 1,
  cnt(PROD, 'function openRecordPop()') + '/' + cnt(PROD, "id = 'period-record-pop'"));
check('A5 补记落成完整区间：设置页那一路不再写 end:null',
  cnt(PROD, 'end: addDays(dateVal, cfg.periodLen - 1)') === 1 && cnt(PROD, 'start: dateVal, end: null') === 0,
  '新区间 ' + cnt(PROD, 'end: addDays(dateVal, cfg.periodLen - 1)') + ' / 旧进行中 ' + cnt(PROD, 'start: dateVal, end: null'));
check('A6 新弹层进 mobile-adapt 手动锁名单（否则面板打开时底层仍可滑、锁会残留）',
  cnt(MA_SRC, "'period-record-pop'") === 1 && cnt(MA_PROD, "'period-record-pop'") === 1, cnt(MA_PROD, "'period-record-pop'"));
check('A7 日期行样式进产物 CSS（按 minify 后形态取行；只用中性 --muted，不新增强调色）',
  cnt(HTML, '.period-next-line { font-size:12px; color:var(--muted,#666); margin-bottom:10px; font-weight:600; }') === 1,
  cnt(HTML, '.period-next-line'));
check('A8 #1302 那把尺子没被打回（有一段实际间隔即用中位数）',
  cnt(PROD, 's.n >= 1 ? Math.round(s.median) : cfg.cycleLen') === 1, cnt(PROD, 's.n >= 1 ? Math.round(s.median) : cfg.cycleLen'));

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1500);
await evalJs(`(function(){
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  document.querySelector('.app[data-app="period"]').click();
  return 1;
})()`);
await sleep(800);
check('A9 经期页可打开', await evalJs(`!document.getElementById('page-period').hidden`));

const CFG = { cycleLen: 28, periodLen: 7, lutealPhase: 14 };
function dsOf(off) {
  const d = new Date(); d.setDate(d.getDate() + off);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function mdOfDs(ds) { const p = ds.split('-'); return (+p[1]) + '/' + (+p[2]); }

// 重置数据并重进页面（app click 会重读 store 并整页重渲染＝种数据后唯一的生效入口）
async function reset(recs) {
  await evalJs(`(function(){
    var st = window.xyStore('xy-home-v2');
    st.set('period-migrated','1');
    st.set('period-records', JSON.stringify(${JSON.stringify(recs || [])}));
    st.set('period-cfg', JSON.stringify(${JSON.stringify(CFG)}));
    st.set('period-daily','{}');
    document.querySelector('.app[data-app="period"]').click();
    return 1;
  })()`);
  await sleep(700);
}
async function snapshot() {
  return await evalJs(`(function(){
    function addDays(n){ var d = new Date(); d.setDate(d.getDate()+n);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    var out = { today: addDays(0) };
    out.raw = window.xyStore('xy-home-v2').get('period-records');
    out.title = (document.getElementById('period-status-title')||{}).textContent;
    out.sub = (document.getElementById('period-status-sub')||{}).textContent;
    out.month = (document.getElementById('period-month-txt')||{}).textContent;
    out.nextLine = (function(){ var e = document.getElementById('period-next-line');
      return e ? { exists: true, hidden: !!e.hidden, text: e.textContent } : { exists: false, hidden: true, text: '' }; })();
    out.rows = Array.prototype.map.call(document.querySelectorAll('#period-history .period-hist-row'), function(r){
      return r.querySelector('.ph-date').textContent + ' | ' + r.querySelector('.ph-meta').textContent; });
    out.cells = {}; out.outCells = {};
    document.querySelectorAll('#period-grid .pc-cell[data-date]').forEach(function(c){
      var m = /ph-([a-z]+)/.exec(c.className); var ph = m ? m[1] : 'none';
      // 月首月尾补进来的相邻月格（.pc-out）另记一桶：本尺的断言说的是「当前这月视图里当月那几格
      // 涂了什么」，把补格混进 cells 会让「本月 predict 0 格」这类判据失去原意
      if (c.classList.contains('pc-out')) out.outCells[c.getAttribute('data-date')] = ph;
      else out.cells[c.getAttribute('data-date')] = ph; });
    out.st = (function(){ var s = window.periodStatus ? window.periodStatus() : null;
      return s ? { nextStart: s.nextStart, inPeriod: s.inPeriod, phase: s.phase, cycleLen: s.cycleLen } : null; })();
    out.row = (function(){ var r = document.getElementById('period-action-row'); if (!r) return null;
      var vis = Array.prototype.filter.call(r.querySelectorAll('.period-btn'), function(b){ return !b.hidden; });
      return { n: vis.length, widths: vis.map(function(b){ return Math.round(b.getBoundingClientRect().width); }),
        overflow: Math.round(r.scrollWidth - r.clientWidth), text: vis.map(function(b){ return b.textContent; }) }; })();
    return out;
  })()`);
}
function daysIn(snap, fromOff, toOff) {
  const got = [];
  for (let o = fromOff; o <= toOff; o++) { const ds = dsOf(o); if (snap.cells[ds]) got.push(ds); }
  return got;
}
const phaseDays = (snap, ph) => Object.keys(snap.cells).filter((k) => snap.cells[k] === ph).sort();
// 整屏看得见的格子（当月格＋月首月尾补进来的相邻月格）——#1399 之后一段经期跨月时补格也照涂，
// 数「这一眼看得见的实心格有没有铺开」要连补格一起数
const viewPhaseDays = (snap, ph) => {
  const all = Object.assign({}, snap.cells, snap.outCells || {});
  return Object.keys(all).filter((k) => all[k] === ph).sort();
};
const viewKeys = (snap) => Object.keys(Object.assign({}, snap.cells, snap.outCells || {})).sort();
function daysFrom(ds, n) {
  const out = [];
  const base = new Date(ds);
  for (let k = 0; k < n; k++) {
    const d = new Date(base); d.setDate(d.getDate() + k);
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }
  return out;
}
// 翻月翻到包含 ds 的那一月（日历只画当月格＝不翻月根本看不见那一发预测）
async function gotoMonthOf(ds) {
  if (!ds) return false; // 红侧夹具本身没落成记录＝没有可翻的月份，兜住并让下游断言照常出数（脚本一崩整组没读数＝假绿的老坑）
  const ym = ds.slice(0, 7);
  for (let i = 0; i < 15; i++) {
    const cur = await evalJs(`(document.getElementById('period-month-txt')||{}).textContent || ''`);
    const m = /(\d+)\s*年\s*(\d+)\s*月/.exec(String(cur));
    if (m && (+m[1]) + '-' + String(+m[2]).padStart(2, '0') === ym) return true;
    await evalJs(`document.getElementById('period-next').click();'n'`);
    await sleep(260);
  }
  return false;
}
// 点一格（#1399 起这是日历上唯一的手势：旧写法另有一路 contextmenu＋500ms 计时器判长按）
const tapCell = async (off) => {
  await evalJs(`(function(){
    function addDays(n){ var d = new Date(); d.setDate(d.getDate()+n);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    var c = document.querySelector('#period-grid .pc-cell[data-date="'+addDays(${off})+'"]');
    if (!c) return 'nocell';
    c.click();
    return 'sent';
  })()`);
  await sleep(600);
  // 点完会带出当日详情浮层（就地标记之后顺手让你补细节），本尺后面的断言不经过它，先收掉
  await evalJs(`(function(){ var p = document.getElementById('period-day-pop'); if (p) p.remove(); document.body.classList.remove('scroll-lock'); return 1; })()`);
  await sleep(200);
};

// ---- B 组：「记一次经期」真点一遍＝用户要的「一次记完一个周期」----
await reset([]);
const bOpen = await evalJs(`(function(){ var b = document.getElementById('period-record-span');
  if (!b || b.hidden) return 'no-btn'; b.click();
  return document.getElementById('period-record-pop') ? 'opened' : 'no-pop'; })()`);
check('B0 动作行有「记一次经期」按钮且一点就开面板', bOpen === 'opened', bOpen);
const bPreview = (await evalJs(`(function(){
  var i = document.querySelector('#period-record-pop input.dp-date-input');
  if (!i) return { span: '（无面板）', days: '', start: '' };
  i.value = '${dsOf(-2)}'; i.dispatchEvent(new Event('change', { bubbles: true }));
  var d = document.querySelector('#period-record-pop .dp-ovu-preview');
  var v = document.querySelector('#period-record-pop .st-val');
  return { span: d ? d.textContent : '', start: i.value, days: v ? v.textContent : '' };
})()`)) || { span: '（读不到）', days: '', start: '' };
check('B1 默认持续天数取自设置的「经期天数」（实测 7）', bPreview && bPreview.days === String(CFG.periodLen), bPreview && bPreview.days);
check('B2 预览行按「开始日＋天数」实时算出整段区间',
  bPreview && bPreview.span.indexOf(dsOf(-2)) >= 0 && bPreview.span.indexOf(dsOf(4)) >= 0 && /7 天/.test(bPreview.span), bPreview && bPreview.span);
await evalJs(`document.querySelector('#period-record-pop .dp-save').click();'s'`);
await sleep(800);
const B = await snapshot();
const bRec = JSON.parse(B.raw || '[]');
check('B3 保存落成一条真区间：start=今天-2、end=今天+4（既不是「进行中」也不是单日）',
  bRec.length === 1 && (bRec[0]||{}).start === dsOf(-2) && (bRec[0]||{}).end === dsOf(4), JSON.stringify(bRec));
check('B4 历史行按设置的经期天数报「持续 7 天」并写出结束日',
  B.rows.length === 1 && /持续 7 天/.test(B.rows[0]) && B.rows[0].indexOf(dsOf(4)) >= 0 && B.rows[0].indexOf('进行中') < 0, B.rows.join('|'));
const bWant = daysIn(B, -2, 4), bSolid = phaseDays(B, 'period').filter((d) => d >= dsOf(-2) && d <= dsOf(4));
check('B5 日历把这一整段涂成实心经期格（当月内可见的每一天都算）',
  bWant.length >= 3 && bSolid.length === bWant.length, '期望 ' + bWant.length + ' 格 / 实心 ' + bSolid.length + ' 格');
// 锁的撤除由 mobile-adapt 的观察器异步复核（它内部记着 locked 状态，移除弹层那一瞬可能
// 先照旧加一次再撤）＝判「残留」要给它一次观察器周期，否则会把自愈读成漏锁（第一版就误红过一次）。
let b6 = null;
for (let i = 0; i < 12; i++) {
  b6 = await evalJs(`(function(){
    var others = ['#tc-mask','#modal-mask','#cc-export-mask','#feed-notice-panel','#emoji-panel','#dl-picker-mask','#phone-bg-gallery-panel'].filter(function(s){
      var e = document.querySelector(s); return e && !e.hidden; });
    var manual = ['period-day-pop','period-care-pop','period-report-pop','period-settings-pop','period-notify-pop'].filter(function(id){
      return !!document.getElementById(id); });
    return { popGone: !document.getElementById('period-record-pop'),
      lock: document.body.classList.contains('scroll-lock'), others: others, manual: manual };
  })()`);
  if (!b6 || !b6.lock || b6.others.length || b6.manual.length) break;
  await sleep(220);
}
check('B6 面板关掉且滚动锁一起撤（别的浮层没开着却仍锁＝锁漏给本弹层）',
  b6 && b6.popGone && (!b6.lock || b6.others.length + b6.manual.length > 0), JSON.stringify(b6));
check('B7 记完之后动作行让位给「标记今天结束」（今天落在这段区间里＝进行中，旧口径自洽）',
  await evalJs(`(function(){ var s=document.getElementById('period-mark-start'), e=document.getElementById('period-mark-end');
    return s.hidden && !e.hidden ? 'ok' : 'start.hidden=' + s.hidden + ',end.hidden=' + e.hidden; })()`) === 'ok');

// ---- C 组：本次经期的尾巴不再混进「预测」色（用户截图里那串虚线格）----
await reset([]);
await tapCell(0);
const C = await snapshot();
const cRec = JSON.parse(C.raw || '[]');
// #1399 换锚：这一发点按给的读法从「1 天」改成「按设置的经期天数铺开整段」，手势从长按改成点。
// 旧断言把「只落一天」当契约钉住，而用户复报的正是这件事——它拦不住这次的口径修正。
check('C0 夹具真实：点今天那一格＝落成「今天起 ' + CFG.periodLen + ' 天」的整段',
  cRec.length === 1 && (cRec[0]||{}).start === dsOf(0) && (cRec[0]||{}).end === daysFrom(dsOf(0), CFG.periodLen).slice(-1)[0], JSON.stringify(cRec));
const cTail = daysIn(C, 1, CFG.periodLen - 1).filter((d) => C.cells[d] === 'predict');
check('C1 本次经期区间内的后续天数不再被涂成「预测」（旧版此处＝实心 1 格＋一串虚线格）',
  cTail.length === 0, cTail.map((d) => d + ':' + C.cells[d]).join(' '));
// 视图末尾不一定铺得下整段（这一屏画到 10/3，那段记到 10/5），所以判据取「看得见的部分
// 恰好等于区间与本屏的交集」——旧口径下这里只有今天一格
const cWantVisible = daysFrom(dsOf(0), CFG.periodLen).filter((d) => viewKeys(C).indexOf(d) >= 0);
check('C2 看得见的实心格＝这一段与本屏的交集，从今天连着排（旧口径＝只红今天那一格）',
  viewPhaseDays(C, 'period').join(' ') === cWantVisible.join(' ') && cWantVisible.length >= 3,
  viewPhaseDays(C, 'period').join(' ') + ' / 期望 ' + cWantVisible.join(' '));
const cNextDs = C.st.nextStart;
const cMoved = await gotoMonthOf(cNextDs);
await sleep(450);
const C2 = await snapshot();
const cWant = daysFrom(cNextDs, CFG.periodLen).filter((d) => C2.cells[d]);
check('C3 下一次经期的预测照常涂色＝翻到那一月真数出预测格（跳过的是第 0 项，不是整条链）',
  !!cMoved && C2.cells[cNextDs] === 'predict' && cWant.length >= 3 && cWant.every((d) => C2.cells[d] === 'predict'),
  '视图 ' + C2.month + ' / next=' + cNextDs + ' → ' + C2.cells[cNextDs] + ' / 该月 predict ' + phaseDays(C2, 'predict').join(' '));

// ---- D 组：日期行＝用户要的「这个月的经期预测时间」----
check('D0 状态卡下方有日期行且可见（经期中也显示，不再是只有天数）',
  C.nextLine.exists && !C.nextLine.hidden, JSON.stringify(C.nextLine));
check('D1 日期行写的就是 status() 算出的那个 nextStart（同源，不另算一遍）',
  C.nextLine.text.indexOf('下次经期预计 ') === 0 && C.nextLine.text.indexOf(mdOfDs(C.st.nextStart)) >= 0,
  C.nextLine.text + ' / nextStart=' + C.st.nextStart);
const dExpectEnd = (() => { const d = new Date(C.st.nextStart); d.setDate(d.getDate() + CFG.periodLen - 1); return mdOfDs(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')); })();
check('D2 日期行区间尾＝开始日＋经期天数-1（同一条设置口径）',
  C.nextLine.text.indexOf(dExpectEnd) >= 0, C.nextLine.text + ' / 期望尾 ' + dExpectEnd);
const dNextMonth = C.st.nextStart && C.st.nextStart.slice(0, 7) !== C.today.slice(0, 7);
check('D3 下次开始日落在下个月时，本月日历本就一格预测都没有——这一行不挑月份（症状本体）',
  !dNextMonth || phaseDays(C, 'predict').length === 0,
  'next=' + C.st.nextStart + ' / 视图 ' + C.month + ' / 本月 predict ' + phaseDays(C, 'predict').length + ' 格');
await reset([{ id: 'x1', start: dsOf(-95), end: dsOf(-89) }, { id: 'x2', start: dsOf(-67), end: dsOf(-61) }, { id: 'x3', start: dsOf(-36), end: dsOf(-30) }, { id: 'x4', start: dsOf(-12), end: dsOf(-6) }]);
const D = await snapshot();
check('D4 非经期同一行照写日期，且与标题的天数自洽（距 N 天 ⇔ 那一个是 N 天后；中位数取三段里的 28）',
  !D.nextLine.hidden && D.nextLine.text.indexOf(mdOfDs(D.st.nextStart)) >= 0 && D.st.cycleLen === 28 &&
  new Date(D.st.nextStart) - new Date(D.today) >= 864e5 / 2,
  D.title + ' / ' + D.nextLine.text + ' / cycleLen=' + D.st.cycleLen);
check('D5 攒满三段间隔后日期行带 σ 波动后缀（间隔 28/31/24 ⇒ std≈2.9 才许谈波动＝#1302 分级口径未动）',
  /（±3 天）/.test(D.nextLine.text), D.nextLine.text);
await reset([{ id: 'z1', start: dsOf(-40), end: dsOf(-34) }, { id: 'z2', start: dsOf(-4), end: dsOf(-4) }]);
const D6 = await snapshot();
check('D6 只有一段间隔时不硬凑 σ（天数对而徽章/波动照旧要 3 段＝#1302 口径未动）',
  !/（±\d+ 天）/.test(D6.nextLine.text) && D6.st.cycleLen === 36, D6.nextLine.text + ' / cycleLen=' + D6.st.cycleLen);
await reset([]);
const D7 = await snapshot();
check('D7 完全没记录时不凭空宣告日期（没有任何起点可预测）',
  /暂无记录/.test(D7.title) && (!D7.nextLine.exists || D7.nextLine.hidden === true), D7.title + ' / ' + JSON.stringify(D7.nextLine));

// ---- E 组：设置页那一路的补记也不再挂「进行中」----
await reset([]);
await evalJs(`document.getElementById('period-cog').click();'c'`);
await sleep(700);
check('E0 周期设置面板能打开（含经期天数三个 stepper）',
  await evalJs(`!!document.getElementById('period-settings-pop')`));
await evalJs(`(function(){ var i = document.querySelector('#period-settings-pop .dp-date-input'); i.value = '${dsOf(-12)}'; return 1; })()`);
await evalJs(`document.querySelector('#period-settings-pop .dp-save').click();'s'`);
await sleep(800);
const E = await snapshot();
const eRec = JSON.parse(E.raw || '[]');
check('E1 设置页填「上次经期开始日」保存＝一条完整区间（旧版＝永不结束的「进行中」）',
  eRec.length === 1 && (eRec[0]||{}).start === dsOf(-12) && (eRec[0]||{}).end === dsOf(-6), JSON.stringify(eRec));
check('E2 历史行写得出结束日、不再出现「进行中」',
  E.rows.length === 1 && E.rows[0].indexOf('进行中') < 0 && E.rows[0].indexOf(dsOf(-6)) >= 0, E.rows.join('|'));

// ---- F 组：对照（旧契约一字未动的证据）----
await reset([]);
await evalJs(`document.getElementById('period-mark-start').click();'m'`);
await sleep(800);
const F1 = await snapshot();
check('F0 「标记今天开始」仍造 end:null 的进行中记录（这一路语义本批未改）',
  /"end":null/.test(F1.raw || '') && /进行中/.test(F1.rows.join('|')), F1.rows.join('|'));
check('F1 进行中的记录仍按设置的经期天数铺实心格（没被顺手改成 1 天）',
  phaseDays(F1, 'period').length >= 2 && phaseDays(F1, 'period')[0] === dsOf(0), phaseDays(F1, 'period').join(' '));
check('F2 进行中的「预计还剩 N 天」仍取设置天数（实测 7 而非 1）',
  /预计还剩 7 天/.test(F1.sub), F1.sub);
await reset([]);
await tapCell(0);
const f3a = await snapshot();
await tapCell(0);
const f3b = await snapshot();
check('F3 再点同一格只开弹层、不动数据（浏览性点按不误删；取消的出口在弹层开关＝B 组那条路）',
  JSON.parse(f3a.raw || '[]').length === 1 && f3a.raw === f3b.raw,
  JSON.parse(f3a.raw || '[]').length + ' 条 →' + JSON.parse(f3b.raw || '[]').length + ' 条');
await reset([]);
await tapCell(0);
const f4 = await snapshot();
check('F4 点完那一格，历史行与状态卡报的是整段（持续 7 天，旧口径＝持续 1 天／预计还剩 1 天）',
  /持续 7 天/.test(f4.rows.join('|')) && /预计还剩 [1-7] 天/.test(f4.sub), f4.sub + ' / ' + f4.rows.join('|'));

// ---- G 组：版式（动作行多一块按钮不许挤破；390×844）----
await reset([{ id: 'g1', start: dsOf(-3), end: dsOf(-3) }]);
const G = await snapshot();
check('G0 动作行三块可见按钮都画得出来、行内无溢出（flex 不许横向撑破）',
  G.row && G.row.n === 3 && G.row.overflow <= 1 && G.row.widths.every((w) => w >= 60),
  G.row && (G.row.n + ' 块 / overflow ' + G.row.overflow + ' / 宽 ' + G.row.widths.join(',')));
check('G1 三块＝旧两样加新一样（旧入口没被换掉或藏掉）',
  G.row && /标记今天开始/.test(G.row.text.join('|')) && /记录今天/.test(G.row.text.join('|')) && /记一次经期/.test(G.row.text.join('|')),
  G.row && G.row.text.join(' | '));
// 三块并排最容易出的毛病不是溢出而是「标签折行」＝同一行里有一块比别人高（第一版实测
// 「标记今天开始」六字在 12px 内边距下折成两行，而 overflow 仍是 0＝只量宽度抓不到）
const G3 = await evalJs(`(function(){
  var r = document.getElementById('period-action-row'); if (!r) return null;
  var vis = Array.prototype.filter.call(r.querySelectorAll('.period-btn'), function(b){ return !b.hidden; });
  var hs = vis.map(function(b){ return Math.round(b.getBoundingClientRect().height); });
  var inner = vis.map(function(b){ return b.scrollWidth - b.clientWidth; });
  return { hs: hs, inner: inner, texts: vis.map(function(b){ return b.textContent; }) };
})()`);
check('G1b 非经期那三块等高＝六字的旧标签没被新按钮挤到换行（行内也不各自溢出）',
  G3 && G3.hs.length === 3 && Math.max.apply(null, G3.hs) - Math.min.apply(null, G3.hs) <= 1 && G3.inner.every((v) => v <= 1),
  G3 && ('高 ' + G3.hs.join('/') + ' 内溢出 ' + G3.inner.join('/') + ' ' + G3.texts.join('|')));
await reset([{ id: 'g2', start: dsOf(0), end: dsOf(3) }]);
const G2 = await snapshot();
check('G2 经期中仍是三块（「标记今天开始」让位给「标记今天结束」，不是四块并排）',
  G2.row && G2.row.n === 3 && /标记今天结束/.test(G2.row.text.join('|')), G2.row && G2.row.text.join(' | '));

// ---- Z 组：全程零未捕获异常 ----
const errs = await evalJs(`(window.__errs || []).slice(0,6)`);
check('Z1 全程零未捕获异常', !errs || !errs.length, JSON.stringify(errs));

const pass = results.filter((r) => r.ok).length;
console.log('\n合计: ' + pass + ' 通过 / ' + (results.length - pass) + ' 失败 / ' + results.length + ' 条');
await cdp('Browser.close').catch(() => {});
server.close();
try { chrome.kill(); } catch (e) {}
process.exit(results.length - pass ? 1 : 0);

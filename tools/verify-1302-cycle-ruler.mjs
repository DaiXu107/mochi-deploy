// ===== 常驻回归脚本 #1302：经期「周期」两把尺子（历史行 vs 预测）必须同源 =====
// 实报（红米 K80 + Chrome）：经期记录页历史记录行写「周期 31 天」，而状态卡/日历预测/桌面小组件
// 按设置里的 28 天算——因为 effCycleLen 要求攒满 3 段实际间隔才肯用记录中位数，只记过 1~2 次时
// 静默回落到 cfg.cycleLen。同一页两个数字互相矛盾＝用户口径「历史记录里周期显示是错误的」。
// 用户选定口径：历史行保留真实间隔，**预测改跟实际间隔走**（有 1 段即生效）。
// 零机型／零 UA 分支＝判据只取「有没有实际间隔」这一个数据事实，不认内核名字。
//
// 用法：node tools/verify-1302-cycle-ruler.mjs [被测根目录]
//   绿侧：node tools/verify-1302-cycle-ruler.mjs <本批副本>
//   红侧（纯 HEAD 基线）：另抽一份 `git archive HEAD | tar -x -C <dir>` 副本，build 后用同一把尺子跑
//   （严禁在仓库内建 git worktree：Windows 下清理会把主树未提交改动整棵打回 HEAD）
// 首行打印被测根目录；被测根没有 index.html 直接 exit 2（防喂错产物两侧同跑假绿）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(resolve(process.argv[2] || here));
console.log('被测根目录 = ' + root);
if (!existsSync(join(root, 'index.html'))) {
  console.error('FAIL  被测根目录没有 index.html（产物未构建或路径喂错）：' + root);
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(2); }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1302-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

// ---- A 组：锚点（源 + 产物各一处；旧形态回流即红）----
const SRC_NEEDLE = 's.n >= 1 ? Math.round(s.median) : cfg.cycleLen';
const OLD_NEEDLE = 's.n >= 3 ? s.median : cfg.cycleLen';
let srcTxt = '';
try { srcTxt = readFileSync(join(root, 'src/js/period.js'), 'utf8'); } catch (e) {}
let prodTxt = '';
try { prodTxt = readFileSync(join(root, 'js/period.js'), 'utf8'); } catch (e) {}
const cnt = (hay, n) => (hay.split(n).length - 1);
check('A1 src/js/period.js 有「有一段间隔即用中位数」锚', cnt(srcTxt, SRC_NEEDLE) === 1, cnt(srcTxt, SRC_NEEDLE));
check('A2 产物 js/period.js 同锚唯一命中', cnt(prodTxt, SRC_NEEDLE) === 1, cnt(prodTxt, SRC_NEEDLE));
check('A3 旧形态（要求攒满 3 段）未回流', cnt(prodTxt, OLD_NEEDLE) === 0, cnt(prodTxt, OLD_NEEDLE));

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1500);
// 打开经期页（app click 会重读 store 并整页重渲染＝种数据后唯一的生效入口）
await evalJs(`(function(){
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  document.querySelector('.app[data-app="period"]').click();
  return 'open';
})()`);
await sleep(800);
check('A4 经期页可打开', await evalJs(`!document.getElementById('page-period').hidden`));

// ---- 夹具：种记录 + 设置，重进页面，读回三处读数 ----
// recs 用「相对今天的天数偏移」表达，尺子在任何一天跑都成立（不写死日期）。
async function probe(recOffsets, cfg, monthsAhead) {
  const seed = {
    recs: recOffsets.map(function (o) { return { id: 't' + o + '_' + Math.random().toString(36).slice(2, 7), start: o, end: o }; }),
    cfg: cfg,
  };
  const s = await evalJs(`(function(){
    var st = window.xyStore('xy-home-v2');
    var seed = ${JSON.stringify(seed)};
    function addDays(base, n){ var d = new Date(base); d.setDate(d.getDate() + n);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    var today = new Date();
    var recs = seed.recs.map(function(r){ return { id: r.id, start: addDays(today, r.start), end: addDays(today, r.end) }; });
    st.set('period-migrated', '1');
    st.set('period-records', JSON.stringify(recs));
    st.set('period-cfg', JSON.stringify(seed.cfg));
    document.querySelector('.app[data-app="period"]').click();
    var title = document.getElementById('period-status-title').textContent;
    var rows = Array.prototype.map.call(document.querySelectorAll('#period-history .period-hist-row'), function (r) {
      return { date: r.querySelector('.ph-date').textContent, meta: r.querySelector('.ph-meta').textContent };
    });
    var desk = { label: (document.getElementById('dpd-label')||{}).textContent || '', sub: (document.getElementById('dpd-sub')||{}).textContent || '' };
    return { title: title, rows: rows, desk: desk, recs: recs };
  })()`);
  if (!s) return null;
  // 逐月翻到 monthsAhead 个月，收集日历日格类名（app click 已把视图复位到本月）
  const cells = {};
  for (let mi = 0; mi <= monthsAhead; mi++) {
    if (mi > 0) { await evalJs(`document.getElementById('period-next').click();'n'`); await sleep(250); }
    const got = await evalJs(`(function(){
      var out = {};
      document.querySelectorAll('#period-grid .pc-cell[data-date]').forEach(function (c) { out[c.getAttribute('data-date')] = c.className; });
      return out;
    })()`);
    Object.assign(cells, got || {});
  }
  return { ...s, cells };
}
function phaseOf(res, ds) {
  const cls = res && res.cells ? res.cells[ds] : null;
  if (!cls) return 'missing';
  const m = /ph-([a-z]+)/.exec(cls);
  return m ? m[1] : 'none';
}
function dsOf(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// 与 period.js 的 mdLabel 同口径（去前导零），验桌面小组件与状态卡取的是同一个日期
function mdOf(offsetDays) { const p = dsOf(offsetDays).split('-'); return (+p[1]) + '/' + (+p[2]); }
const CFG = { cycleLen: 28, periodLen: 5, lutealPhase: 14 };

// ---- B 组：用户实报形态（两次 1 天记录、真实间隔 31 天、设置 28）----
// 记录：最近一次 = 今天-3（周期第 4 天），上一次 = 今天-34 ⇒ 间隔 31 天。
const B = await probe([-34, -3], CFG, 2);
check('B0 夹具到位：历史行按真实间隔报 31 天（这一行本来就是对的）',
  B && /周期 31 天/.test(B.rows.map((r) => r.meta).join('|')), B && B.rows.map((r) => r.meta).join(' | '));
check('B1 状态卡改跟实际间隔：距下次经期 28 天（旧版按设置 28 算出 25 天）',
  B && /距下次经期约 28 天/.test(B.title), B && B.title);
check('B2 日历预测起点落在 今天+28（= 上次开始 + 31）', B && phaseOf(B, dsOf(28)) === 'predict', B && phaseOf(B, dsOf(28)));
check('B3 日历不再按设置值把 今天+25 涂成预测经期（旧版此处＝ph-predict）', B && phaseOf(B, dsOf(25)) !== 'predict', B && phaseOf(B, dsOf(25)));
check('B4 桌面小组件与状态卡同源（预计开始日 = 今天+28）',
  B && B.desk.sub.indexOf(mdOf(28)) >= 0, B && B.desk.sub);

// ---- C 组：对照（间隔中位数本就被采纳的 3 段形态＝不许被本批改坏）----
// 间隔 30/31/32 ⇒ 中位 31；最近一次 = 今天-3 ⇒ 距下次 28 天（新旧两侧同读数）
const C = await probe([-96, -66, -35, -3], CFG, 2);
check('C0 对照：三段间隔时历史行照旧报最近一段的真实间隔 32 天',
  C && /周期 32 天/.test(C.rows.map((r) => r.meta).join('|')), C && C.rows.map((r) => r.meta).join(' | '));
check('C1 对照：满 3 段的老契约未动（距下次经期 28 天）', C && /距下次经期约 28 天/.test(C.title), C && C.title);
check('C2 对照：预测起点 = 今天+28（中位数 31）', C && phaseOf(C, dsOf(28)) === 'predict', C && phaseOf(C, dsOf(28)));

// ---- D 组：对照（零间隔＝只有一段记录时仍回落设置值 28）----
const D = await probe([-3], CFG, 2);
check('D1 对照：无任何间隔时仍用设置周期长度（距下次经期 25 天）', D && /距下次经期约 25 天/.test(D.title), D && D.title);
check('D2 对照：零间隔时预测起点 = 今天+25（设置 28 − 已走 3 天）', D && phaseOf(D, dsOf(25)) === 'predict', D && phaseOf(D, dsOf(25)));

// ---- E 组：两段间隔取中位数（偶数段＝平均后取整，不许出现小数日期）----
// 间隔 33 与 30 ⇒ 中位 31.5 ⇒ 取整 32；最近一次 = 今天-3 ⇒ 距下次 29 天
const E = await probe([-66, -33, -3], CFG, 2);
check('E1 两段间隔即生效：中位 31.5 取整 32（距下次经期 29 天，旧版回落到设置＝25 天）',
  E && /距下次经期约 29 天/.test(E.title), E && E.title);
check('E2 取整后日历自洽：今天+29 为预测经期、今天+26 不是',
  E && phaseOf(E, dsOf(29)) === 'predict' && phaseOf(E, dsOf(26)) !== 'predict',
  E && (phaseOf(E, dsOf(29)) + '/' + phaseOf(E, dsOf(26))));

// ---- F 组：清场 + 零未捕获异常 ----
await evalJs(`(function(){
  var st = window.xyStore('xy-home-v2');
  st.remove('period-records'); st.remove('period-daily');
  document.querySelector('.app[data-app="period"]').click();
  return 'clean';
})()`);
await sleep(500);
const errs = await evalJs('window.__errs || []');
check('F1 全程零未捕获 JS 异常', !errs || !errs.length, JSON.stringify(errs));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

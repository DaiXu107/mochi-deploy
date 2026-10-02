// ===== 启动长任务归因尺子（PERF-PLAN 阶段 1/2 的「谁吃了首帧前那 1 秒」） =====
// 立项：2026-09-19。verify-perf.mjs 只给总量（longtask 11 个/共 1542ms、首帧前 974ms），不给「谁」。
// 本尺子量出每个 JS 功能文件的**顶层执行**耗时，与 longtask 窗口对齐，产出三张榜：
//   ①分类总账（JS 执行 / V8 编译 / 样式重算 / 布局 / 主线程任务合计）——CDP Performance.getMetrics；
//   ②文件榜（每个功能文件顶层执行 ms、起于首帧前还是首帧后）；
//   ③长任务逐个归因（≥50ms 任务窗口里哪些文件在跑 + 残差＝非脚本顶层执行部分）。
// 量法（**仓库产物零改动**）：插桩只在 HTTP 响应层做——对 index.html 与 js/*.js 的响应体，在每个功能
// 文件 IIFE 的收尾处插一句 `__mt(i)`（记 performance.now()）。收尾锚用 build.mjs 包装里每个文件唯一的
// `if (window.__mochiLoaded) window.__mochiLoaded.push("<file>");`。
//   每文件耗时 = 本文件收尾时刻 − 前一文件收尾时刻（功能文件按文档序串行执行，core 全部先于 ext，
//   ext 段内也按文档序，故差分成立）。差分**含**该文件自身的编译/解析尾巴，属期望口径。
//   ⚠ 为什么不用「首尾双钩子」：向后找包装器 `(function () { try {` 会命中前序文件代码里的同名文本
//     （实测 device/chat/personalize/bg-keep 等 8+ 个文件的起手钩子被塞进字符串死区＝不执行，
//     跨文件串号还造出负时长）。单收尾锚含文件名＝全局唯一，插它后面绝对安全。
// 口径边界：只量「脚本顶层执行」。定时器/rAF/MutationObserver 回调里的耗时落进**残差**，不冤枉文件；
//   残差本身也是结论（＝HTML 解析 + 编译 + 样式布局 + 回调）。第 1 个文件的数含开屏前 HTML 解析＋
//   首块编译，榜上单列一行说明，别当纯执行看。
// 数值随机器负载浮动，故不设绝对门槛（同 verify-perf），只做结构自洽断言。
// 用法：
//   node tools/verify-perf-attribution.mjs                 3 次冷加载取中位数
//   MOCHI_PERF_RUNS=1 node tools/verify-perf-attribution.mjs   快速看一眼（噪声大）
//   MOCHI_PERF_CPU=6 ...                                   换节流倍率（默认 4×，与 verify-perf 同口径）
// verify-suite:timeout=180000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUNS = Math.max(1, Number(process.env.MOCHI_PERF_RUNS) || 3);
const CPU_RATE = Math.max(1, Number(process.env.MOCHI_PERF_CPU) || 4);

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（性能尺子需要无头 Chrome）'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

// ---- 插桩：每功能文件收尾一句 __mt(i)；每个内联 script 块另加首尾两句（负索引，同表登记） ----
const PUSH = 'if (window.__mochiLoaded) window.__mochiLoaded.push("';
const NAMES = [];        // 索引 → 显示名（功能文件名 / 块锚名）
const CHUNK_OF = [];    // 功能文件索引 → 所属内联块号

function findPushes(src) {
  const marks = [];
  for (let pos = 0; ; ) {
    const p = src.indexOf(PUSH, pos);
    if (p < 0) break;
    const q = src.indexOf('"', p + PUSH.length);
    if (q < 0) break;
    marks.push({ p, name: src.slice(p + PUSH.length, q) });
    pos = q + 1;
  }
  return marks;
}

// 内联块边界：首块起始 `<script>` 之后到最后一个功能文件收尾锚之间，每个 `</script>` 结束一块
function chunkEdges(src, marks) {
  const first = src.lastIndexOf('<script', marks[0].p);
  const openGt = src.indexOf('>', first);
  if (first < 0 || openGt < 0 || src.indexOf('</script>', openGt) < marks[0].p) return null; // 首锚之前就有 </script>＝首锚不在这个块里，归属不可信
  const last = marks[marks.length - 1].p;
  const closes = [];
  for (let pos = openGt; ;) {
    const c = src.indexOf('</script>', pos);
    if (c < 0 || c > last) break;
    closes.push(c);
    pos = c + 9;
  }
  const opens = [openGt + 1].concat(closes.map((c) => {
    const o = src.indexOf('<script', c);
    return o < 0 ? -1 : src.indexOf('>', o) + 1;
  }));
  return { opens, closes, count: closes.length + 1 };
}

function instrument(src, startIdx, kind) {
  const marks = findPushes(src);
  const splices = [];
  let chunkCount = 0;
  marks.forEach((mk, k) => {
    const idx = startIdx + k;
    splices.push({ p: mk.p, text: `__mt(${idx});`, tag: mk.name });
    NAMES[idx] = mk.name;
  });
  if (kind === 'core' && marks.length) {
    const ed = chunkEdges(src, marks);
    if (!ed) { console.error('内联块边界识别失败（首锚前存在 </script>），拒绝出数'); process.exit(1); }
    chunkCount = ed.count;
    ed.opens.forEach((o, k) => { splices.push({ p: o, text: `__mt(${-(2 * k + 1)});`, tag: '块' + k + '起' }); });
    ed.closes.forEach((c, k) => { splices.push({ p: c, text: `__mt(${-(2 * k + 2)});`, tag: '块' + k + '止' }); });
    for (let i = 0; i < marks.length; i++) {
      let k = 0;
      while (k < ed.closes.length && marks[i].p > ed.closes[k]) k++;
      CHUNK_OF[startIdx + i] = k;
    }
  }
  if (kind === 'ext') {
    // 外置文件自己的起手锚＝该 script 的第一句，用于把「下载/解析/编译尾巴」与本文件执行分开
    for (let k = 0; k < marks.length; k++) splices.push({ p: 0, text: `__mt(${-(startIdx + k + 10000)});`, tag: NAMES[startIdx + k] + '起' });
  }
  // 倒序插入：前插会移动下标，正序插会让后续锚位失准
  let text = src;
  splices.sort((a, b) => b.p - a.p).forEach((s) => { text = text.slice(0, s.p) + s.text + text.slice(s.p); });
  return { text, next: startIdx + marks.length, chunkCount };
}

const htmlRaw = readFileSync(join(root, 'index.html'), 'utf8');
const core = instrument(htmlRaw, 0, 'core');
const coreCount = core.next;
const CHUNK_TOTAL = core.chunkCount;
let nextIdx = core.next;
const extText = new Map();
{
  const extTag = /<script defer src="js\/([^"]+)"/g;
  let m;
  while ((m = extTag.exec(htmlRaw))) {
    const r = instrument(readFileSync(join(root, 'js', m[1]), 'utf8'), nextIdx, 'ext');
    if (r.next === nextIdx) { console.error('外置文件 ' + m[1] + ' 里没找到功能文件收尾锚，插桩失败'); process.exit(1); }
    extText.set(m[1], r.text);
    nextIdx = r.next;
  }
}
const totalFiles = nextIdx;
const extCount = totalFiles - coreCount;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(root, url));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    let body;
    if (url === '/' || url === '/index.html') body = core.text;
    else if (/^\/js\/[^/]+\.js$/.test(url) && extText.has(url.slice(4))) body = extText.get(url.slice(4));
    else {
      if (statSync(p).isDirectory()) p = join(p, 'index.html');
      body = readFileSync(p);
    }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-perfattr-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

const WATCHDOG = setTimeout(() => {
  console.error('看门狗：170s 未跑完（CDP 失联或页面僵死）。常见诱因：并行 verify-suite 收尾清扫 mochi- 前缀无头 Chrome 误伤本实例——直接复跑即可');
  try { chrome.kill('SIGKILL'); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(1);
}, 170000);

let ws = null, msgId = 0;
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
        ws.onclose = () => { for (const res of pend.values()) res(undefined); pend.clear(); };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接');
}
function cdp(method, params = {}) {
  if (!ws || ws.readyState !== 1) return Promise.resolve(undefined);
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { pend.delete(id); res(undefined); } });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

// 每个新文档最早注入：收尾登记表 + longtask 观测 + 异常收集（须先于页面脚本）
const INIT_SOURCE = `
window.__mfx = {};
window.__mt = function (i) { window.__mfx[i] = performance.now(); };
window.__perf = { lt: [], errs: [] };
try {
  new PerformanceObserver(function (l) {
    var es = l.getEntries();
    for (var i = 0; i < es.length; i++) window.__perf.lt.push([Math.round(es[i].startTime), Math.round(es[i].duration)]);
  }).observe({ entryTypes: ['longtask'] });
} catch (e) {}
window.addEventListener('error', function (e) { window.__perf.errs.push(String(e.message)); });
`;

const MEASURE_EXPR = `(function(){
  var nav = performance.getEntriesByType('navigation')[0] || {};
  return JSON.stringify({
    dcl: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    lt: window.__perf.lt, errs: (window.__perf.errs || []).slice(0, 5),
    jsErrs: (window.__jsErrors || []).slice(0, 8), mfx: window.__mfx
  });
})()`;

async function coldRun() {
  await cdp('Network.clearBrowserCache', {});
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  // getMetrics 是**浏览器级累计**计数器（跨导航只增不减，Performance.clearMetrics 实测不生效），
  // 所以本文档净量只能靠「导航前快照 → 导航后快照」相减得到。
  const m0 = await cdp('Performance.getMetrics');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  let ready = false;
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) { ready = true; break; } await sleep(200); }
  await sleep(2500);
  const raw = await evalJs(MEASURE_EXPR);
  const metrics = await cdp('Performance.getMetrics');
  const pick = (mm) => { const o = {}; for (const x of (mm && mm.metrics ? mm.metrics : [])) o[x.name] = x.value; return o; };
  const a = pick(m0), b = pick(metrics);
  const delta = {};
  for (const k of Object.keys(b)) delta[k] = Math.max(0, (b[k] - (a[k] || 0)) * 1000);
  return { ready, m: raw ? JSON.parse(raw) : null, metrics: delta };
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Performance.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SOURCE });

console.log('启动归因尺子：响应体 index.html ' + (Buffer.byteLength(core.text, 'utf8') / 1024).toFixed(0) + 'KB（含插桩）  功能文件 core ' + coreCount + ' + ext ' + extCount + '  CPU 节流 ' + CPU_RATE + '×  测量 ' + RUNS + ' 次');

const warm = await coldRun();
if (!warm.ready || !warm.m) { console.error('预热跑页面未就绪，插桩可能破坏了产物'); chrome.kill(); server.close(); process.exit(1); }

const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await coldRun());
const ok = runs.filter((r) => r.ready && r.m);
const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// ---- 差分：每文件 收尾时刻 → 上一收尾（同块内）或本块起手锚（跨块，编译不计进文件）的间隔 ----
const OPEN_IDX = (k) => -(2 * k + 1);
const CLOSE_IDX = (k) => -(2 * k + 2);
const EXT_OPEN_IDX = (i) => -(i + 10000);
const prevIdxOf = (i) => {
  if (i >= coreCount) return EXT_OPEN_IDX(i);
  if (i === 0) return CHUNK_OF[0] === 0 ? OPEN_IDX(0) : null;
  return CHUNK_OF[i] !== CHUNK_OF[i - 1] ? OPEN_IDX(CHUNK_OF[i]) : i - 1;
};

function slotTimes(i) {
  return ok.map((r) => r.m.mfx[i]).filter((x) => typeof x === 'number');
}
const files = [];
for (let i = 0; i < totalFiles; i++) {
  const rec = slotTimes(i);
  const pi = prevIdxOf(i);
  const prev = pi === null ? [] : slotTimes(pi);
  if (!rec.length || (pi !== null && !prev.length)) continue;
  const end = median(rec);
  const dur = pi === null ? end : end - median(prev);
  files.push({ name: NAMES[i], kind: i < coreCount ? 'core' : 'ext', chunk: i < coreCount ? CHUNK_OF[i] : -1, prevIdx: pi, start: Math.round(end - dur), dur: Math.round(dur), n: rec.length });
}
const unmeasured = totalFiles - files.length;
files.sort((a, b) => b.dur - a.dur);

const dclMed = median(ok.map((r) => r.m.dcl));
const ltMed = median(ok.map((r) => r.m.lt.reduce((a, x) => a + x[1], 0)));
const neg = files.filter((f) => f.dur < 0);
const jsTotal = files.reduce((a, f) => a + f.dur, 0);
const jsPre = files.filter((f) => f.start < dclMed).reduce((a, f) => a + f.dur, 0);

console.log('\n【分类总账】getMetrics **本文档净量**中位数（ms；导航前后取差，非浏览器累计值）');
for (const k of ['ScriptDuration', 'V8CompileDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration']) {
  const v = median(ok.map((r) => Math.round(r.metrics[k] || 0)));
  console.log('  ' + k.padEnd(21) + v + 'ms');
}

// ---- 块级分解：首帧前那一秒到底是「HTML/CSS 解析」「JS 编译」还是「JS 执行」 ----
console.log('\n【内联块分解】（core 共 ' + CHUNK_TOTAL + ' 个 script 块；编译尾巴＝本块起手 − 上块收尾）');
{
  const headParse = median(slotTimes(OPEN_IDX(0)).concat([0]));
  console.log('  导航 → 块0 起手（HTML head 与 CSS 解析、网络）：' + Math.round(headParse) + 'ms');
  let prevClose = null;
  for (let k = 0; k < CHUNK_TOTAL; k++) {
    const o = median(slotTimes(OPEN_IDX(k)));
    const cArr = slotTimes(CLOSE_IDX(k));
    const inChunk = files.filter((f) => f.chunk === k);
    const exec = inChunk.reduce((a, f) => a + f.dur, 0);
    const compile = prevClose === null ? 0 : o - prevClose;
    console.log('  块' + k + ' 起手 ' + String(Math.round(o)).padStart(5) + 'ms  止 ' + (cArr.length ? String(Math.round(median(cArr))).padStart(5) + 'ms' : '（末块）') + '  内含 ' + String(inChunk.length).padStart(2) + ' 文件  执行 ' + String(Math.round(exec)).padStart(4) + 'ms  编译 ' + String(Math.round(compile)).padStart(4) + 'ms');
    if (cArr.length) prevClose = median(cArr);
  }
  const lastCoreClose = median(slotTimes(coreCount - 1));
  const extOpen0 = slotTimes(EXT_OPEN_IDX(coreCount));
  const extExec = files.filter((f) => f.kind === 'ext').reduce((a, f) => a + f.dur, 0);
  console.log('  末块执行止 ' + Math.round(lastCoreClose) + 'ms → 外置段首文件起手 ' + (extOpen0.length ? Math.round(median(extOpen0)) + 'ms' : '?') + '（这段＝body HTML 解析 + 外置文件下载/编译等待）；外置段纯执行合计 ' + extExec + 'ms；DCL ' + dclMed + 'ms');
}

console.log('\n【文件榜】功能文件顶层执行（合计 ' + jsTotal + 'ms｜起于首帧前的文件共 ' + jsPre + 'ms；DCL 中位 ' + dclMed + 'ms，longtask 合计 ' + ltMed + 'ms）');
console.log('   #  文件                          执行ms    止于ms   归属   样本');
files.slice(0, 20).forEach((f, i) => {
  console.log('  ' + String(i + 1).padStart(2) + '  ' + f.name.padEnd(26) + String(f.dur).padStart(8) + String(f.start + f.dur).padStart(9) + ('   ' + f.kind).padStart(8) + String(f.n).padStart(7));
});
const preFiles = files.filter((f) => f.start < dclMed);
console.log('   ── 首帧前 top3：' + preFiles.slice(0, 3).map((f) => f.name + ' ' + f.dur + 'ms').join(' / '));
const extPre = files.filter((f) => f.kind === 'ext' && f.start < dclMed).reduce((a, f) => a + f.dur, 0);
console.log('   ── 外置(ext)段首帧前合计 ' + extPre + 'ms ＝阶段 2「挪到首帧后」的可回收上限');

// ---- 长任务逐个归因（区间重叠） ----
const ltUnion = [];
{
  const maxLen = Math.max(...ok.map((r) => r.m.lt.length));
  for (let i = 0; i < maxLen; i++) {
    const col = ok.map((r) => r.m.lt[i]).filter(Boolean);
    if (col.length < Math.ceil(ok.length / 2)) continue;
    ltUnion.push([median(col.map((x) => x[0])), median(col.map((x) => x[1]))]);
  }
}
console.log('\n【长任务归因】（任务窗口与文件执行区间求交；残差＝HTML 解析 + 编译 + 样式布局 + 回调）');
for (const [t, d] of ltUnion) {
  if (d < 50) continue;
  const hits = [];
  let sum = 0;
  for (const f of files) {
    const ov = Math.min(f.start + f.dur, t + d) - Math.max(f.start, t);
    if (ov > 0) { sum += ov; hits.push({ name: f.name, ov: Math.round(ov) }); }
  }
  hits.sort((a, b) => b.ov - a.ov);
  console.log('  @' + String(t).padStart(5) + 'ms 时长 ' + String(d).padStart(4) + 'ms｜JS 顶层 ' + String(Math.round(sum)).padStart(4) + 'ms（' + String(Math.round(100 * sum / d)).padStart(2) + '%）｜残差 ' + String(Math.round(d - sum)).padStart(4) + 'ms｜' + (hits.slice(0, 3).map((h) => h.name + ' ' + h.ov + 'ms').join(' / ') || '（无文件顶层执行）') + (t < dclMed ? '' : '  [首帧后]'));
}

const jsErrAll = ok.every((r) => (r.m.jsErrs || []).length === 0);
const results = [];
function check(desc, isOk, detail) { results.push(!!isOk); console.log((isOk ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const chunkAnchorMiss = []
  .concat(Array.from({ length: CHUNK_TOTAL }, (_, k) => slotTimes(OPEN_IDX(k)).length ? null : '块' + k + '起'))
  .concat(Array.from({ length: Math.max(0, CHUNK_TOTAL - 1) }, (_, k) => slotTimes(CLOSE_IDX(k)).length ? null : '块' + k + '止'))
  .concat(Array.from({ length: extCount }, (_, k) => slotTimes(EXT_OPEN_IDX(coreCount + k)).length ? null : 'ext起' + NAMES[coreCount + k]))
  .filter(Boolean);
check('P1 插桩齐全（core ' + coreCount + ' + ext ' + extCount + ' 收尾锚全 firing、' + CHUNK_TOTAL + ' 个内联块首尾锚与外置起手锚全 firing、差分无负值）', ok.length === RUNS && files.length === totalFiles && neg.length === 0 && chunkAnchorMiss.length === 0, '量到 ' + files.length + '/' + totalFiles + '（缺 ' + unmeasured + '）；负时长 ' + neg.length + '；缺锚 ' + JSON.stringify(chunkAnchorMiss));
check('P2 ' + RUNS + ' 次冷加载全部就绪、启动零未捕获异常、零被吞异常（__jsErrors）', ok.length === RUNS && ok.every((r) => r.m.errs.length === 0) && jsErrAll, ok.length + '/' + RUNS + ' 就绪；异常 ' + JSON.stringify(ok.map((r) => r.m.errs)) + ' 吞 ' + JSON.stringify(ok.map((r) => r.m.jsErrs)));
check('P3 归因非退化（量到 ≥5 个文件、首帧前 JS>0）', files.length >= 5 && jsPre > 0, files.length + ' 个文件；首帧前 JS ' + jsPre + 'ms');
check('P4 插桩未把口径拖飞（DCL 中位 <3000ms，与 verify-perf 同量级）', dclMed > 0 && dclMed < 3000, 'DCL ' + dclMed + 'ms / longtask ' + ltMed + 'ms');

const passed = results.filter(Boolean).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
clearTimeout(WATCHDOG);
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

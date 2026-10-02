// ===== 性能基线尺子（PERF-PLAN 阶段 0「先有尺子再动刀」） =====
// 立项：2026-09-16 PERF-PLAN.md。纯测量工具，零产品改动。断言只有两类：
//   ①结构自洽：页面就绪 / 启动窗口零 JS 异常 / longtask 观测可用 / DOM 节点与内联脚本量在正常量级；
//   ②与上一份基线对比：关键指标中位数恶化超容差才算退步。
// 不设任何绝对性能门槛——机器快慢不该被当成回归；基线存 tools/perf-baseline.local.json
//（机器本地、不入库：不同机器数值不可互比，换机器/换 Chrome 后删掉重录即可）。
// 用法：
//   node tools/verify-perf.mjs            首跑=记录基线；之后每跑=与基线对比
//   node tools/verify-perf.mjs --record   强制重录基线（每个优化阶段收口后执行一次）
// 测量口径：无头 Chrome 390×844 DPR2 移动视口 + CPU 4× 节流（Lighthouse 模拟中低端手机同款手法，
// MOCHI_PERF_CPU 可调倍率；桌面原生速度下 3.7MB 内联 JS 连一个 ≥50ms 长任务都没有，对优化不敏感），
// 本地 HTTP 起产物；第 1 次加载为预热（Service Worker 首装+预缓存，弃用不测），之后 3 次冷加载
//（SW 已接管，等价真机稳态冷启动）各测：DCL（DOMContentLoadedEventEnd）/ load（loadEventEnd）/
// 启动后 5s 窗口 longtask 个数·总时长·峰值 / DOM 节点数 / 内联脚本字符量 / 外置脚本字节数 /
// index 文档字节数。取 3 次中位数与基线比。
// PERF-PLAN 各阶段预期移动：阶段1 JS 外置化 → 内联字符量（现约 3.9M 字符）明显下降、DCL/longtask 下降；
//   阶段2 空闲期执行 → 启动窗口 longtask 总时长进一步下降；阶段3/4 以真机为准，本尺子作参考。
//
// 2026-09-16 加固（冻结峰值守卫）——来自五种打包形态的对照实测（同产物：全内联 / 单个大文件外置 /
// 按 12 块外置 defer / 12 块首帧后注入）：
//   ①口径澄清：longtask 是「从导航开始累积到 就绪+5s」的全部任务，**不是**「就绪后 5s 窗口内的任务」
//     （观测器由 addScriptToEvaluateOnNewDocument 注入、数组从不清空）。原注释与实现不符，此处改齐。
//   ②新增「单次冻结峰值」中位数（ltMax）+ 结构性断言 A6：实测把 JS 合成**单个大文件**外置时，
//     DCL 会变好（1106→721ms）、longtask 个数与总时长也下降（9个/765ms→3个/531ms），但会制造一次
//     429~471ms 的冻结（现状 128~141ms = 3 倍多）。旧口径（只看 DCL/个数/总时长）对这种「指标变好、
//     体感变卡」是**全绿放行**——A6 就是拦它。
//   ③新增首帧前/后阻塞拆分（ltPreDcl / ltPostDcl，信息项、不参与断言）：阶段 2 把工作挪到首帧之后时
//     这两个数会此消彼长而总量不降，用来分辨「真的少做了」与「只是挪走了」。
// verify-suite:timeout=240000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RECORD = process.argv.includes('--record');
const BASELINE_FILE = join(root, 'tools', 'perf-baseline.local.json');

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（性能尺子需要无头 Chrome）'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const indexBytes = statSync(join(root, 'index.html')).size;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    // no-store：每次导航传输口径一致（SW 接管后本值影响很小，但首装跑需要）
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-perf-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

// 总看门狗：套件路径有 240s 强杀，单跑直跑没有——任何挂起（CDP 失联/页面僵死）最多 220s 必须可见地失败。
// 220s < 套件 240s：先于套件强杀打出原因，不被吞成无输出的 timeout。
const WATCHDOG = setTimeout(() => {
  console.error('看门狗：220s 未跑完（CDP 失联或页面僵死）。常见诱因：并行会话跑 verify-suite 收尾清扫 mochi- 前缀无头 Chrome 误伤本实例——直接复跑即可');
  try { chrome.kill('SIGKILL'); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(1);
}, 220000);

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
        // CDP 断联快速失败：并行会话跑 verify-suite 收尾会清扫 mochi- 前缀临时档的无头 Chrome，会误伤本脚本实例；
        // 放行所有挂起调用 → 各处按 null/undefined 走既有的可见失败路径，而不是 Promise 永不 resolve 无限挂起
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

// 每个新文档最早期注入：longtask 观测器 + 异常收集（必须先于页面脚本，否则漏掉启动期长任务）
const INIT_SOURCE = `
window.__perf = { lt: [], errs: [], ltBad: false };
try {
  new PerformanceObserver(function (list) {
    var es = list.getEntries();
    for (var i = 0; i < es.length; i++) window.__perf.lt.push([Math.round(es[i].startTime), Math.round(es[i].duration)]);
  }).observe({ entryTypes: ['longtask'] });
} catch (e) { window.__perf.ltBad = true; }
window.addEventListener('error', function (e) { window.__perf.errs.push(String(e.message)); });
`;
// 采集时机：__mochiDataReady 后再等 5000ms（口径固定）。注意 longtask 数组是从**导航开始**累积的
//（观测器注入在最早期、从不清空），故 longtask 口径＝「导航 → 就绪+5s」全程，含首帧前的全部阻塞。
const MEASURE_EXPR = `(function(){
  var nav = performance.getEntriesByType('navigation')[0] || {};
  var inlineChars = 0, extScripts = 0;
  var scripts = document.getElementsByTagName('script');
  for (var i = 0; i < scripts.length; i++) { if (scripts[i].src) extScripts++; else inlineChars += (scripts[i].textContent || '').length; }
  var extBytes = 0, res = performance.getEntriesByType('resource');
  for (var j = 0; j < res.length; j++) { if (res[j].initiatorType === 'script' || /\\.js($|\\?)/.test(res[j].name)) extBytes += (res[j].decodedBodySize || 0); }
  var dclT = Math.round(nav.domContentLoadedEventEnd || 0);
  var lt = window.__perf.lt, ltTotal = 0, ltMax = 0, ltPreDcl = 0, ltPostDcl = 0;
  for (var k = 0; k < lt.length; k++) {
    ltTotal += lt[k][1];
    if (lt[k][1] > ltMax) ltMax = lt[k][1];
    if (lt[k][0] < dclT) ltPreDcl += lt[k][1]; else ltPostDcl += lt[k][1];
  }
  return JSON.stringify({
    ttfb: Math.round(nav.responseEnd || 0), dcl: dclT, load: Math.round(nav.loadEventEnd || 0),
    domNodes: document.getElementsByTagName('*').length, inlineChars: inlineChars, extScripts: extScripts, extBytes: extBytes,
    docBytes: nav.encodedBodySize || 0,
    ltCount: lt.length, ltTotal: Math.round(ltTotal), ltMax: Math.round(ltMax),
    ltPreDcl: Math.round(ltPreDcl), ltPostDcl: Math.round(ltPostDcl), ltBad: !!window.__perf.ltBad,
    errs: (window.__perf.errs || []).slice(0, 5)
  });
})()`;

async function coldRun() {
  await cdp('Network.clearBrowserCache', {});
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  let ready = false;
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) { ready = true; break; } await sleep(200); }
  await sleep(5000);
  const raw = await evalJs(MEASURE_EXPR);
  return { ready, m: raw ? JSON.parse(raw) : null };
}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const kb = (n) => (n / 1024).toFixed(0) + 'KB';

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
const browser = await cdp('Browser.getVersion');
const chromeVer = browser && browser.product ? browser.product : 'unknown';
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const CPU_RATE = Math.max(1, Number(process.env.MOCHI_PERF_CPU) || 4);
await cdp('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT_SOURCE });

console.log('性能基线尺子：' + chromeVer + '  产物 index.html ' + kb(indexBytes) + '  CPU 节流 ' + CPU_RATE + '×' + (CPU_RATE !== 4 ? '（非默认倍率，与基线不可直接互比）' : ''));
console.log('口径：预热 1 次（SW 首装，弃用）+ 冷加载测 3 次（就绪后再观测 5s）取中位数\n');

// ---- 预热跑（SW 安装 + 预缓存；不进统计） ----
const warm = await coldRun();
if (!warm.ready || !warm.m) {
  console.error('预热跑页面未就绪（__mochiDataReady 未出现），产物或环境异常');
  chrome.kill(); server.close(); process.exit(1);
}

// ---- 测量跑 ×3 ----
const runs = [];
for (let i = 0; i < 3; i++) {
  const r = await coldRun();
  runs.push(r);
  const m = r.m;
  console.log('冷加载 #' + (i + 1) + (!r.ready || !m ? '  ⚠️ 未就绪/测量失败' : '') + '： DCL ' + (m ? m.dcl : '?') + 'ms  load ' + (m ? m.load : '?') + 'ms  longtask ' + (m ? m.ltCount : '?') + '个/共' + (m ? m.ltTotal : '?') + 'ms(峰值' + (m ? m.ltMax : '?') + 'ms)  DOM ' + (m ? m.domNodes : '?') + '节点  内联JS ' + (m ? kb(m.inlineChars) : '?') + '  外置JS ' + (m ? kb(m.extBytes) : '?') + (m ? '  首帧前/后阻塞 ' + m.ltPreDcl + '/' + m.ltPostDcl + 'ms' : ''));
}

const ok = runs.filter((r) => r.ready && r.m);
const med = {
  dcl: median(ok.map((r) => r.m.dcl)),
  load: median(ok.map((r) => r.m.load)),
  ltCount: median(ok.map((r) => r.m.ltCount)),
  ltTotal: median(ok.map((r) => r.m.ltTotal)),
  ltMax: median(ok.map((r) => r.m.ltMax)),
  ltPreDcl: median(ok.map((r) => r.m.ltPreDcl)),
  ltPostDcl: median(ok.map((r) => r.m.ltPostDcl)),
  domNodes: median(ok.map((r) => r.m.domNodes)),
  inlineChars: median(ok.map((r) => r.m.inlineChars)),
};
console.log('\n中位数：DCL ' + med.dcl + 'ms  load ' + med.load + 'ms  longtask ' + med.ltCount + '个/共' + med.ltTotal + 'ms(峰值' + med.ltMax + 'ms)  DOM ' + med.domNodes + '节点  内联JS ' + kb(med.inlineChars) + '  首帧前/后阻塞 ' + med.ltPreDcl + '/' + med.ltPostDcl + 'ms');

// ---- A 组：结构自洽断言（全部要求 3 跑齐全——空数组 every() 会空真通过，别让残跑混出绿） ----
const all3 = (f) => ok.length === 3 && ok.every((r) => f(r.m));
check('A1 三次冷加载全部就绪（__mochiDataReady）', ok.length === 3, ok.length + '/3');
check('A2 启动窗口零 JS 异常', all3((m) => m.errs.length === 0), JSON.stringify(ok.map((r) => r.m.errs)));
check('A3 longtask 观测可用' + (CPU_RATE > 1 ? '且非零（节流下解析必有长任务）' : '（不节流：桌面快到没有 ≥50ms 长任务属正常，只验观测器就位）'), all3((m) => !m.ltBad && (CPU_RATE > 1 ? m.ltCount > 0 : true)), ok.map((r) => r.m.ltCount).join(','));
check('A4 DOM 节点数在正常量级（≥8000，当前约 1.4 万；骤降=页面没渲染全）', all3((m) => m.domNodes >= 8000), ok.map((r) => r.m.domNodes).join(','));
// 冻结峰值阈值：现状约 130ms（4× 节流）；>300ms 表示启动期出现了一次用户能感觉到的冻结。
// 机器差异大时用 MOCHI_PERF_PEAK_MS 覆盖（改了就要在同一台机器上重录基线，否则两套口径混比）。
const PEAK_MS = Math.max(50, Number(process.env.MOCHI_PERF_PEAK_MS) || 300);
check('A5 脚本总量在正常量级（内联字符+外置字节 ≥3M，防「脚本整块丢失」；外置化后此值应基本不变、只有内联部分下降）', all3((m) => m.inlineChars + m.extBytes >= 3000000), ok.map((r) => kb(r.m.inlineChars) + '+' + kb(r.m.extBytes)).join(','));
check('A6 单次冻结峰值中位数 <' + PEAK_MS + 'ms（现状约 130ms；把 JS 合成单个大文件外置实测会到 429~471ms，属「DCL 变好、体感变卡」）', all3(() => true) && median(ok.map((r) => r.m.ltMax)) < PEAK_MS, '中位峰值 ' + median(ok.map((r) => r.m.ltMax)) + 'ms，逐次 ' + ok.map((r) => r.m.ltMax).join(','));

// ---- B 组：与基线对比（中位数恶化超容差 = 退步） ----
// 容差：相对 +35% 且绝对超 floors 才算退步（本机并发跑 verify 时长任务数值噪声不小，双重条件防误报）
const TOL = { dcl: 150, load: 150, ltTotal: 150, ltCount: 3, ltMax: 150 };
// 基线里必须有这些键才允许对比；ltMax 是 2026-09-16 新增，旧基线没有它——只跳过这一项，
// 不因缺字段就把整份基线判废（否则会在没人预期的时候静默重录基线，丢掉历史对照）。
const BASE_REQUIRED = ['dcl', 'load', 'ltTotal', 'ltCount'];
let base = null;
if (!RECORD && existsSync(BASELINE_FILE)) {
  try { base = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')); } catch (e) { console.log('（基线文件损坏，按重录处理：' + BASELINE_FILE + '）'); }
}
const baseOk = !!(base && base.med && BASE_REQUIRED.every((k) => Number.isFinite(base.med[k])));
if (ok.length < 3) {
  // 有效跑不足：A1 已红，本跑数据残缺——绝不用它写/比基线（undefined 入基线会让后续对比永久失真）
  console.log('有效冷加载不足 3 次（' + ok.length + '/3），跳过基线' + (baseOk ? '对比' : '记录') + '；A1 已判失败，本跑不覆盖基线文件');
} else if (baseOk) {
  const rows = [];
  let bad = 0;
  for (const k of Object.keys(TOL)) {
    if (!Number.isFinite(base.med[k])) { rows.push('  ' + k + ': 基线无此项（旧格式），本次跳过 —— 阶段收口跑 `--record` 重录后启用'); continue; }
    const oldV = base.med[k], newV = med[k];
    const delta = newV - oldV;
    const ratio = oldV > 0 ? newV / oldV : 1;
    const worse = delta > TOL[k] && ratio > 1.35;
    if (worse) bad++;
    rows.push('  ' + k + ': ' + oldV + ' → ' + newV + '（' + (delta >= 0 ? '+' : '') + delta + '，' + ((ratio - 1) * 100).toFixed(0) + '%）' + (worse ? '  ← 退步超容差' : ''));
  }
  check('B1 与基线对比无退步（基线 ' + new Date(base.ts).toLocaleString() + ' @ ' + (base.chrome || '?') + '）', bad === 0, bad + ' 项超容差');
  console.log('\n基线对比明细（容差：绝对 +' + TOL.dcl + 'ms/' + TOL.ltCount + '个 且相对 +35% 才算退步）：\n' + rows.join('\n'));
} else {
  writeFileSync(BASELINE_FILE, JSON.stringify({ ts: Date.now(), chrome: chromeVer, node: process.version, indexBytes, med }, null, 1));
  check('B1 基线已记录（下次运行开始对比；阶段收口后用 --record 重录）', true, BASELINE_FILE);
  console.log('\n已写入基线：DCL ' + med.dcl + 'ms / load ' + med.load + 'ms / longtask ' + med.ltCount + '个共' + med.ltTotal + 'ms(峰值' + med.ltMax + 'ms) / DOM ' + med.domNodes + ' / 内联JS ' + kb(med.inlineChars) + ' / 首帧前阻塞 ' + med.ltPreDcl + 'ms');
}

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
clearTimeout(WATCHDOG);
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

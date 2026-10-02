// verify-1226-perf-ruler.mjs — #1226 卡顿自检「尺子四处纠偏」的行为断言（无头 WebKit＋Chromium）
// verify-suite:timeout=240000
// 现场来源：iPhone 16 Pro Max / iOS 18.7 用户直派的自检报告——「长任务（>50ms）：窗口内无」与同一份
// 报告「前台冻结 106 次、最长 2393ms」并排；「正常帧间隔约 4ms」在 60Hz 屏上仍是 4ms（#958 只治掉了
// 「单次抖动」那一半，4ms 只要重复到 3 次仍永远赢过 16ms）。四处改动全部只动尺子（诊断层），产品行为零变化。
// 本脚本不依赖构建产物：直接读 src/js/perf-check.js（新版）与 git show HEAD 的同名文件（旧版），
// 各自内联进一个最小夹具页喂给浏览器——所以它能在「未构建」状态下跑，也天然构成红绿对照。
//   S1 周期估计取众数（纯 node 切片跑直方图，不启浏览器）：16ms×1055 与 4ms×23 同窗 → 新取 16、旧取 4
//   S2 WebKit×新版：能力表里没有 longtask ⇒ 报告说「没有 longtask 观测通道」，不再出现「窗口内无」
//   S3 WebKit×旧版（红侧对照）：旧版 observe 不抛错就以为能观测 ⇒ 复刻出「窗口内无」那句假话
//   S4 Chromium×新版：longtask 通道照常（零新增误伤），且人为阻塞被分成「主线程被占住」
//   S5/S6 每帧页面归因：新版整窗 getComputedStyle 次数远小于帧数；旧版次数≈帧数（＝尺子自己在窗口里强制样式重算）
//   S7 WebKit×新版：没有 longtask 通道时冻结分型仍给出方向（用户那台机就是这一路）
//   S8 两侧同绿（对照组）：阈值自适应、掉帧/冻结计数这些既有能力一件没改坏
//   S9 页归因走缓存之后，切页期间帧与掉帧仍记在真正所在的那一页上（这条是 ③ 自带风险的护栏：
//      缓存不失效＝整窗记在第一页，「掉帧集中在哪页」会整体错位；旧版同场景＝对照组）
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { dirname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const readNew = () => readFileSync(join(root, 'src/js/perf-check.js'), 'utf8');
const readOld = () => execFileSync('git', ['show', 'HEAD:src/js/perf-check.js'], { cwd: root, maxBuffer: 1 << 26 }).toString('utf8');

let NEW = '', OLD = '';
try { NEW = readNew(); OLD = readOld(); } catch (e) { console.log('环境不满足：读不到 src 或 HEAD 版 perf-check.js（' + e.message + '）'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

// ===== S1：周期估计（把 periodEst 函数体切出来，喂构造直方图；两版各跑一次）=====
function periodOf(src, hist) {
  const i = src.indexOf('function periodEst() {');
  if (i < 0) return NaN;
  const j = src.indexOf('\n  }', i);
  const body = src.slice(i, j + 4);
  try {
    return Function('gapHist', 'var minD = 0;' + body + ' periodEst(); return minD;')(hist);
  } catch (e) { return NaN; }
}
console.log('S1 刷新周期估计（纯 node，构造直方图）');
{
  const real = { 16: 1055, 4: 23, 33: 50, 17: 200 }; // 用户那份报告的分布形状：16ms 是屏，4ms 是补帧抖动
  ok(periodOf(NEW, real) === 16, 'S1a 新版取众数＝16ms（真 vsync 周期）', '实得 ' + periodOf(NEW, real));
  ok(periodOf(OLD, real) === 4, 'S1b 旧版取「重复 ≥3 的最小值」＝4ms（＝红侧，证明本条断言有牙）', '实得 ' + periodOf(OLD, real));
  ok(periodOf(NEW, { 8: 600, 16: 3 }) === 8, 'S1c 真高刷（整窗 8ms）两版判定不变（新＝8）', '实得 ' + periodOf(NEW, { 8: 600, 16: 3 }));
  ok(periodOf(OLD, { 8: 600, 16: 3 }) === 8, 'S1d 真高刷旧版也是 8ms（对照组：没改坏高刷档）');
  ok(periodOf(NEW, { 33: 500 }) === 33, 'S1e iOS 低电量整档 30fps（33ms）取 33（新＝33）', '实得 ' + periodOf(NEW, { 33: 500 }));
  ok(periodOf(NEW, { 4: 1, 17: 2 }) === 4, 'S1f 没有间隔重复到 3 次 → 回退「单次最小值」（新＝4）', '实得 ' + periodOf(NEW, { 4: 1, 17: 2 }));
  ok(periodOf(OLD, { 4: 1, 17: 2 }) === 4, 'S1g 回退口径与旧版逐字一致（对照组）');
}

// ===== 夹具页：最小 DOM＋常驻动画（保证持续出帧），把两版源码分别内联进去 =====
const fixture = (src) => '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}'
  + '.page{position:fixed;inset:0;background:#fff}.d{position:absolute;left:0;top:0;width:2px;height:2px;background:#111;animation:mv 900ms steps(3) infinite alternate}@keyframes mv{from{left:0}to{left:320px}}</style></head>'
  + '<body><div class="page" id="page-phone"><div class="d"></div></div>'
  + '<div class="page" id="page-feed" hidden style="background:#eef"><div class="d"></div></div><script>'
  + src.replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
const routes = { '/new.html': fixture(NEW), '/old.html': fixture(OLD) };
const server = createServer((req, res) => {
  const body = routes[req.url.split('?')[0]];
  if (!body) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

// 一个检测窗：装上 getComputedStyle 计数器 → 按排程灌「阻塞 / 开关二级页」→ 等报告回来
async function runWindow(launcher, which, dur, blocks, acts) {
  let b = null;
  try { b = await launcher(); } catch (e) { return { env: String(e && e.message || e).slice(0, 160) }; }
  try {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
    const p = await ctx.newPage();
    await p.goto(baseUrl + '/' + which + '.html');
    const out = await p.evaluate(async (a) => {
      window.__gcs = 0;
      const orig = window.getComputedStyle;
      window.getComputedStyle = function () { window.__gcs++; return orig.apply(window, arguments); };
      (a.blocks || []).forEach((bb) => { setTimeout(function () { const t = performance.now(); while (performance.now() - t < bb[1]) {} }, bb[0]); });
      (a.acts || []).forEach((ac) => setTimeout(function () {
        if (ac[1] === 'b') { const t = performance.now(); while (performance.now() - t < ac[2]) {} return; }
        const f = document.getElementById('page-feed');
        if (!f) return;
        // 与 verify-perf-check-live 的窗口 B 同款做法：直接改页节点的 hidden＋inline z-index
        if (ac[1] === 'on') { f.removeAttribute('hidden'); f.style.zIndex = '9999'; }
        else { f.setAttribute('hidden', ''); f.style.zIndex = ''; }
      }, ac[0]));
      const r = await window.mochiPerfCheck.start(a.dur);
      if (!r) return { err: 'null' };
      return {
        frames: r.frames, janky: r.janky, severe: r.severe, worst: r.worst, hid: r.hid, fz: r.fz,
        fzJs: r.fzJs, fzPaint: r.fzPaint, jankMs: r.jankMs, period: r.period, ltCap: r.ltCap,
        lt: r.lt ? { ok: r.lt.ok, n: r.lt.n } : null, verdict: r.verdict, text: r.text,
        pageFrames: r.pageFrames, pages: r.pages, topPage: r.topPage,
        gcs: window.__gcs,
      };
    }, { dur, blocks, acts: acts || null });
    return out;
  } catch (e) {
    return { err: String(e && e.message || e).slice(0, 160) };
  } finally {
    try { await b.close(); } catch (e) {}
  }
}

const DUR = 4000;
const BLOCKS = [[600, 320], [1500, 360]];
let haveWebkit = true;
console.log('S2~S3 WebKit（iOS Safari 同内核；本仓无头 webkit 即用户那台机的等效内核）');
const wkNew = await runWindow(() => webkit.launch(), 'new', DUR, BLOCKS);
if (wkNew.env) { haveWebkit = false; console.log('  环境不满足：无头 WebKit 起不来（' + wkNew.env + '）——S2/S3/S7 跳过'); }
else {
  ok(wkNew.ltCap === false, 'S2a 新版按能力表判定：WebKit 没有 longtask 通道（ltCap=false）', JSON.stringify({ ltCap: wkNew.ltCap }));
  ok(wkNew.lt === null, 'S2b 于是长任务计数不参与结论（rep.lt=null），不再假装观测过', JSON.stringify(wkNew.lt));
  ok(wkNew.text.includes('没有 longtask 观测通道'), 'S2c 报告照实说「这台内核没有 longtask 观测通道」', wkNew.text.split('\n').filter((l) => l.includes('长任务')).join(' / '));
  ok(!wkNew.text.includes('窗口内无'), 'S2d 报告里不再出现「窗口内无」（＝没有观测支撑的否定）');
  const wkOld = await runWindow(() => webkit.launch(), 'old', DUR, BLOCKS);
  ok(wkOld.err !== 'null' && (wkOld.lt && wkOld.lt.ok === true), 'S3a 红侧：旧版在 WebKit 上把 lt.ok 置真（observe 不抛错＝误判有通道）', JSON.stringify(wkOld.lt));
  ok(wkOld.text.includes('窗口内无'), 'S3b 红侧：旧版报告复刻出用户那份「长任务（>50ms）：窗口内无」', wkOld.text.split('\n').filter((l) => l.includes('长任务')).join(' / '));
  ok(wkOld.fz >= 1 && wkNew.fz >= 1, 'S3c 两侧都抓到前台冻结（红绿只差在措辞与归因，不在采样）', 'new fz=' + wkNew.fz + ' old fz=' + wkOld.fz);
  console.log('S7 WebKit×新版：没有长任务通道时仍给出冻结方向（用户那台机就是这一路）');
  ok(/· 冻结类型/.test(wkNew.text), 'S7a 报告出现「冻结类型」行', wkNew.text.split('\n').filter((l) => l.includes('冻结类型')).join(' / '));
  ok((wkNew.fzJs || 0) >= 1, 'S7b 人为的同步阻塞被分成「主线程被任务占住」≥1 次', JSON.stringify({ fz: wkNew.fz, fzJs: wkNew.fzJs, fzPaint: wkNew.fzPaint }));
  ok(wkNew.text.includes('主线程被任务占住') && wkNew.text.includes('出帧跟不上'), 'S7c 两类都在报告里点名（不许只报一类）');
}
console.log('S4~S6, S8 Chromium（对照：有通道的内核不能被改坏）');
const crNew = await runWindow(() => chromium.launch({ args: ['--disable-gpu'] }), 'new', DUR, BLOCKS);
if (crNew.env) console.log('  环境不满足：无头 Chromium 起不来（' + crNew.env + '）');
else {
  ok(crNew.ltCap === true, 'S4a Chromium 有 longtask 通道（能力表判定，不看机型）', JSON.stringify({ ltCap: crNew.ltCap }));
  ok(!!(crNew.lt && crNew.lt.ok === true), 'S4b 通道在 ⇒ 观察器照常自建（rep.lt.ok）', JSON.stringify(crNew.lt));
  ok(crNew.fz >= 1 && (crNew.fzJs || 0) >= 1, 'S4c 两次阻塞被抓成前台冻结并归入「主线程被占住」', JSON.stringify({ fz: crNew.fz, fzJs: crNew.fzJs, fzPaint: crNew.fzPaint, worst: crNew.worst }));
  ok(/· 冻结类型/.test(crNew.text) && crNew.text.includes('主线程被任务占住'), 'S4d 报告输出冻结类型行');
  ok(crNew.jankMs >= 24 && crNew.jankMs <= 34, 'S8a 阈值自适应仍落在 [24,34]（对照组）', 'jankMs=' + crNew.jankMs);
  ok(crNew.period >= 4 && crNew.period <= 40, 'S8b 周期读数在正常区间（对照组）', 'period=' + crNew.period);
  ok(crNew.frames > 60, 'S8c 采样窗内确实持续出帧（夹具没白挂动画）', 'frames=' + crNew.frames);
  ok(crNew.gcs <= 8, 'S5 新版整窗 getComputedStyle 次数 ≤8（页归因走缓存）', 'gcs=' + crNew.gcs + ' / frames=' + crNew.frames);
  const crOld = await runWindow(() => chromium.launch({ args: ['--disable-gpu'] }), 'old', DUR, BLOCKS);
  ok(crOld.err !== 'null' && crOld.frames > 60 && crOld.gcs >= crOld.frames * 0.5,
    'S6 红侧：旧版每帧直查 DOM＋取样式（getComputedStyle 次数≈帧数＝尺子把强制样式重算塞进被测窗口）', 'gcs=' + crOld.gcs + ' / frames=' + crOld.frames);
  ok(!!(crOld.lt && crOld.lt.ok === true), 'S6b 旧版在 Chromium 上通道正常（红侧只在 WebKit 那一支，不牵连安卓）');
  // S9：页归因缓存必须跟着页走——这条是 ③ 自带风险的护栏（缓存不失效＝整窗记在第一页上，
  //      「掉帧集中在哪页」这种结论会整体错位，比省下的那几次 getComputedStyle 贵得多）
  console.log('S9 切页期间归因仍然跟得上（新版＝缓存失效正确；旧版＝对照组）');
  const ACTS = [[700, 'on'], [1000, 'b', 80], [1300, 'b', 80], [1600, 'b', 80], [1900, 'off'],
    [2500, 'b', 80], [3100, 'b', 80], [3600, 'b', 80]];
  const s9New = await runWindow(() => chromium.launch({ args: ['--disable-gpu'] }), 'new', 4500, null, ACTS);
  const s9Old = await runWindow(() => chromium.launch({ args: ['--disable-gpu'] }), 'old', 4500, null, ACTS);
  ok((s9New.pageFrames || {})['朋友圈'] >= 20, 'S9a 新版：二级页那 1.2 秒的帧记在「朋友圈」名下（观察器确实把缓存打脏了）', JSON.stringify(s9New.pageFrames));
  ok((s9New.pages || {})['朋友圈'] >= 2, 'S9b 新版：落在二级页的阻塞计入该页掉帧（不掉帧计数不认页＝集中页判定会错位）', JSON.stringify(s9New.pages));
  ok((s9New.pageFrames || {}).main > (s9New.pageFrames || {})['朋友圈'], 'S9c 新版：收掉二级页后帧重新记回桌面（不是脏一次就再也不更新）', JSON.stringify(s9New.pageFrames));
  ok(s9New.frames > 60 && (s9New.pages || {}).main >= 2, 'S9d 新版：桌面侧阻塞照常计入（对照组：缓存没把主场景漏掉）', JSON.stringify({ frames: s9New.frames, pages: s9New.pages }));
  ok((s9Old.pageFrames || {})['朋友圈'] >= 20 && (s9Old.pages || {})['朋友圈'] >= 2,
    'S9e 旧版同场景同结论（对照组：#770 的页归因能力一件没改坏）', JSON.stringify({ pf: s9Old.pageFrames, p: s9Old.pages }));
}
if (!haveWebkit) { server.close(); console.log('环境不满足：缺 WebKit'); process.exit(2); }
server.close();
console.log('----');
console.log('verify-1226-perf-ruler: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

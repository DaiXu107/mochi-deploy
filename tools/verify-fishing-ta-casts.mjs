// ===== 专项验证 #1031：钓鱼 TA 状态机「抛竿期每拍重决策」＋ 状态行「2.5s 后清空」=====
// 背景（2026-09-22 用户实报「钓鱼一直只有我钓到鱼，没有联系人」）：
//   实测（无头 Chrome 开面板 300s）TA 确实会钓（8 条鱼 + 1 件纪念品），但两件叠加让人看不见：
//   ① fishing.js 的 TA decide() 抛竿分支只设 until 不设 next，而 taStep 守卫是 now >= ta.next
//     ⇒ 进入 casting 后每拍都被重新决策（4000 拍里 988 拍是白重抛），TA 约 1/4 时间停在「抛竿」；
//   ② 状态行的结算播报由 statusText 的 keep 保 2.5s，到期后 render 在「idle + 今日页签」把整行写成
//     空串 ⇒ TA 的「钓到了」只在 2.5s 窗口里可见，随机事件基本赶不上（自己钓是点了才看，永远赶得上）。
// 用法：node tools/verify-fishing-ta-casts.mjs（纯 Node，自切 src 状态机 + 定种子 PRNG，不开浏览器）
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : '')); }

const src = read('src/js/fishing.js');
const L = src.split(/\r?\n/);

// ---------------- A 组：静态锚点 ----------------
const castingBlock = src.slice(src.indexOf("this.phase = 'casting';"), src.indexOf("this.phase = 'casting';") + 400);
check('A1 TA 抛竿分支把 next 推到 biteAt（晚于 until，守卫才不会抢占 resolve）', /this\.next = this\.biteAt;/.test(castingBlock), /this\.next[^;]*;/.exec(castingBlock) ? /this\.next[^;]*;/.exec(castingBlock)[0] : '未设 next');
check('A2 idle+今日 的状态行写「最近一条播报」而非空串', /curTab === 'today'\)\s*\{?\s*if \(statusEl\.textContent !== lastNotice\)/.test(src));
check('A3 statusText 记录 lastNotice（TA 播报有处可回读）', /lastNotice = t;/.test(src));
check('A4 旧的「清空状态行」写法已退役（不再有无条件写空串分支）', !/curTab === 'today'\) statusEl\.textContent = '';/.test(src));

// ---------------- B 组：TA 状态机行为（定种子重放，判别力在频率与链长） ----------------
function mulberry(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function runTa(seed) {
  const a = L.findIndex((l) => l.includes('function taStep()'));
  const b = L.findIndex((l, idx) => idx > a && l.trim() === 'resetTa();');
  if (a < 0 || b < 0) throw new Error('未能切出 TA 状态机源码区间');
  const body = L.slice(a, b + 1).join('\n');
  let NOW = 0;
  const rnd = mulberry(seed);
  const stub = {
    Math: { random: rnd },
    Date: { now: () => NOW },
    rand: (x, y) => x + Math.floor(rnd() * (y - x + 1)),
    render() {}, statusText() {}, sfxCatch() {}, sfxMiss() {}, sfxGift() {}, taWord: () => 'TA',
    rollTaItem: () => ({ id: 'fish_small', cat: 'fish', r: 1 }), loadGifts: () => [], saveGifts() {},
    giftNoteFor: () => 'x', loadToday: () => ({ mine: {}, ta: {}, keep: {} }), saveToday() {},
    markDex() {}, maybeTaCook() {}, sendTaLine() {}, taCaught() {}, setTimeout() {}
  };
  const f = new Function(...Object.keys(stub), body + '\nreturn { taStep: taStep, resetTa: resetTa, get ta() { return ta; } };');
  const m = f(...Object.values(stub));
  m.resetTa();
  let bites = 0, waitings = 0, churn = 0, chain = 0, maxChain = 0, prev = '';
  for (let i = 0; i < 4000; i++) {
    NOW += 1200;
    const before = m.ta.phase;
    m.taStep();
    const after = m.ta.phase;
    if (before === 'biting' && after === 'idle') bites++;
    if (before === 'waiting') waitings++;
    if (before === 'casting' && after === 'casting') { churn++; chain++; if (chain > maxChain) maxChain = chain; } else chain = 0;
    prev = after;
  }
  return { bites: bites, perMin: +(bites / 80).toFixed(2), waitings: waitings, churnPct: +(churn / 40).toFixed(1), maxChain: maxChain, end: prev };
}
let s1, s2, s3;
try { s1 = runTa(20260922); s2 = runTa(7); s3 = runTa(99999); } catch (e) { check('B0 状态机重放可运行', false, e.message); }
if (s1) {
  console.log('   重放（80 分钟玩法 / 4000 拍）：seed20260922 ' + JSON.stringify(s1) + '\n   seed7 ' + JSON.stringify(s2) + '\n   seed99999 ' + JSON.stringify(s3));
  // 判据口径：修好后 TA 咬钩结算 ~2.8/min（buggy 实测 ~1.4/min）；连续 casting 链 ≤3 拍（buggy 常见 8~12 拍）
  [s1, s2, s3].forEach(function (s, i) {
    check('B' + (i + 1) + ' TA 咬钩结算频率 ≥1.9 次/分（seed）', s.perMin >= 1.9, 'perMin=' + s.perMin + ' bites=' + s.bites);
  });
  check('B4 连续 casting 重决策链 ≤3 拍（抛竿期不再每拍重 roll）', Math.max(s1.maxChain, s2.maxChain, s3.maxChain) <= 3, 'maxChain=' + Math.max(s1.maxChain, s2.maxChain, s3.maxChain));
  check('B5 白重抛占比 <12% 拍', Math.max(s1.churnPct, s2.churnPct, s3.churnPct) < 12, 'churnPct=' + [s1.churnPct, s2.churnPct, s3.churnPct].join('/'));
  check('B6 waiting 相位仍会出现（未把 TA 锁成匀速机器）', s1.waitings > 0 && s2.waitings > 0, 'waitings=' + s1.waitings + '/' + s2.waitings);
  check('B7 三分支随机仍在（rest/daze/shift 未被删光）', /'rest'/.test(src) && /'daze'/.test(src) && /'shift'/.test(src));
}

const pass = results.filter((r) => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);

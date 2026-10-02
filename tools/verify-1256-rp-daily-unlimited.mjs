// verify-1256-rp-daily-unlimited.mjs — #1256 红包「每日上限 0=不限」恒拦＋日计数 UTC 口径 行为回归
// 用法：node tools/verify-1256-rp-daily-unlimited.mjs [chat.js 路径]
//   缺省读本仓 src/js/chat.js（绿侧＝含 #1256 修复的副本/主树）；红侧显式传旧版文件。
//   红侧基线＝入库基点 e5bce82（HEAD 前移后旧侧要钉死该提交，见「旧侧基线自失效」教训）：
//   git show e5bce82:src/js/chat.js > /tmp/chat_1256_old.js && node tools/verify-1256-rp-daily-unlimited.mjs /tmp/chat_1256_old.js
// 依赖运行环境 TZ＝UTC+8（S8 用「本地过零点、UTC 还在昨天」的时刻判日期口径；偏移不符则 S8 记 SKIP）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const target = process.argv[2] || fileURLToPath(new URL('../src/js/chat.js', import.meta.url));
const src = readFileSync(target, 'utf8');

function extractFn(name) {
  const sig = 'function ' + name + '(';
  const i = src.indexOf(sig);
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) break; }
  }
  return src.slice(i, j + 1);
}

const parts = ['rpLocalDay', 'rpDailyKey', 'rpDailyCount', 'rpDailyIncr', 'rpDailyMax', 'trySystemAutoSend'].map(n => [n, extractFn(n)]);
const missing = parts.filter(([, s]) => !s).map(([n]) => n);
const code = "const RP_DAILY_PREFIX = 'ml2_rp_daily_';\n" + parts.filter(([, s]) => s).map(([, s]) => s).join('\n') + '\n__sink.trySystemAutoSend = trySystemAutoSend;\n__sink.rpDailyCount = rpDailyCount;';

const results = [];
function T(name, fn) { try { results.push([name, fn()]); } catch (e) { results.push([name, 'ERR ' + (e && e.message)]); } }

const tzOff = new Date().getTimezoneOffset(); // UTC+8 → -480
const EPOCH = Date.UTC(2026, 8, 24, 16, 30); // UTC=09-24 16:30 → 本地(UTC+8)=09-25 00:30
const utcDay = new Date(EPOCH).toISOString().slice(0, 10);
const d0 = new Date(EPOCH);
const localDay = d0.getFullYear() + '-' + (d0.getMonth() + 1) + '-' + d0.getDate();

function makeSandbox({ cap, prob, rand = 0.01, night = false, seed = {} }) {
  const DAYK = 'ml2_rp_daily_';
  const ls = new Map();
  // 种子里形如 2026-9-25 / 2026-09-24 的裸日串自动补上日计数键前缀，其余键原样
  for (const [k, v] of Object.entries(seed)) ls.set(/^\d{4}-/.test(k) ? DAYK + k : k, v);
  const wallet = { myBalance: 52000, systemBalance: 52000 };
  const fired = [];
  const timers = [];
  const win = {
    nightModeActive: () => night,
    activeStore: () => ({ get: k => (ls.has(k) ? ls.get(k) : null), set: (k, v) => ls.set(k, v) }),
    __activeCid: 'default',
    logFish: null,
  };
  const sandbox = {
    window: win,
    store: { get: k => (ls.has(k) ? ls.get(k) : null), set: (k, v) => ls.set(k, v) },
    setTimeout: (f) => timers.push(f),
    isQixiToday: () => false,
    pick: a => a[0],
    genRpAmount: () => 520,
    randInt: a => a,
    rpCoverGet: () => 0,
    rpWalletGet: () => wallet,
    rpWalletSet: w => { Object.assign(wallet, w); },
    addIn: (txt, opts) => { fired.push(opts); return {}; },
    Math: { random: () => rand, floor: Math.floor, max: Math.max, min: Math.min },
    __sink: {},
  };
  sandbox.Date = class {
    constructor() { this._d = new Date(EPOCH); }
    getFullYear() { return this._d.getFullYear(); }
    getMonth() { return this._d.getMonth(); }
    getDate() { return this._d.getDate(); }
    toISOString() { return this._d.toISOString(); }
    static now() { return EPOCH; }
  };
  if (cap !== undefined) sandbox.store.set('cs-rp-daily-max', String(cap));
  if (prob !== undefined) ls.set('cs-rp-auto-prob', String(prob));
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 2000 });
  return {
    fire() { sandbox.__sink.trySystemAutoSend(); timers.forEach(f => f()); return fired.length; },
    countKey(dayStr) { return Number(ls.get(DAYK + dayStr)) || 0; },
    wallet,
  };
  function store_get(sb, k) { return sb.store.get(k); }
}
if (missing.length) console.log('ℹ️ 旧版缺失函数（按旧语义跑行为断言）：' + missing.join(','));

// —— 行为断言 ——
T('S1 上限=0(不限)+概率100% ⇒ 该发就发（红侧=0＝被 0>=0 恒拦）', () => makeSandbox({ cap: 0, prob: 100 }).fire() === 1 ? true : 'FAIL');
T('S2 上限=0 且今日计数已灌 99 ⇒ 仍不限发', () => {
  const sb = makeSandbox({ cap: 0, prob: 100, seed: { [utcDay]: '99', [localDay]: '99', 'cs-rp-auto-prob': '100' } });
  return sb.fire() === 1 ? true : 'FAIL';
});
T('S3 上限=2 且今日已 2 ⇒ 拦（对照组，两侧皆绿）', () => {
  const sb = makeSandbox({ cap: 2, prob: 100, seed: { [utcDay]: '2', [localDay]: '2', 'cs-rp-auto-prob': '100' } });
  return sb.fire() === 0 ? true : 'FAIL';
});
T('S4 上限=2 且今日 1 ⇒ 发', () => {
  const sb = makeSandbox({ cap: 2, prob: 100, seed: { [utcDay]: '1', [localDay]: '1', 'cs-rp-auto-prob': '100' } });
  return sb.fire() === 1 ? true : 'FAIL';
});
T('S5 未设上限 ⇒ 默认 5 次/日 语义保持（灌 5 ⇒ 拦）', () => {
  const sb = makeSandbox({ cap: undefined, prob: 100, seed: { [utcDay]: '5', [localDay]: '5', 'cs-rp-auto-prob': '100' } });
  return sb.fire() === 0 ? true : 'FAIL';
});
T('S6 概率仍生效：prob=50、rand=0.6 ⇒ 拦（对照）', () => makeSandbox({ cap: 0, prob: 50, rand: 0.6, seed: { 'cs-rp-auto-prob': '50' } }).fire() === 0 ? true : 'FAIL');
T('S7 prob=100 时金额/留言照常（发 1 张 ¥5.20 红包卡）', () => {
  const sb = makeSandbox({ cap: 5, prob: 100 });
  if (sb.fire() !== 1) return 'FAIL';
  const w = sb.wallet;
  return w.systemBalance === 52000 - 520 ? true : 'FAIL balance=' + w.systemBalance;
});
T('S8 发成功后今日计数 +1（写进本次读取的那把日键）', () => {
  const sb = makeSandbox({ cap: 0, prob: 100 });
  sb.fire();
  return (sb.countKey(localDay) === 1 || sb.countKey(utcDay) === 1) ? true : 'FAIL local=' + sb.countKey(localDay) + ' utc=' + sb.countKey(utcDay);
});
if (tzOff === -480) {
  T('S9 日键按本地日期：UTC 昨天已灌满 5、本地今天为 0 ⇒ 该发（红侧=拦＝UTC 口径）', () => {
    if (utcDay === localDay) return 'SKIP';
    const sb = makeSandbox({ cap: 5, prob: 100, seed: { [utcDay]: '5', 'cs-rp-auto-prob': '100' } });
    return sb.fire() === 1 ? true : 'FAIL';
  });
} else {
  console.log('ℹ️ S9 SKIP：运行时钟非 UTC+8（偏移 ' + tzOff + '），本地/UTC 跨日样本不成立');
}
T('S10 夜间静默仍拦（#1015 守卫不动，对照）', () => makeSandbox({ cap: 0, prob: 100, night: true }).fire() === 0 ? true : 'FAIL');

// —— 零机型／零 UA 分支（对照本批触及的抽取段） ——
const touched = parts.filter(([, s]) => s).map(([, s]) => s).join('\n');
T('Z1 抽取段零机型/零 UA 分支', () => !(/navigator\.userAgent|iPhone|iPad|Android|Chrome|MicroMessenger|ubsx/i.test(touched)) ? true : 'FAIL');

// —— 哨兵针在位（仅绿侧应过） ——
T('Z2 #1256a 逻辑针在 src', () => touched.includes('if (rpMax > 0 && rpDailyCount() >= rpMax) return;') ? true : (missing.includes('rpDailyKey') ? 'FAIL(旧侧)' : 'FAIL'));
T('Z3 #1256b 本地日键针在 src 且全 src 唯一', () => {
  const n = src.split('return RP_DAILY_PREFIX + rpLocalDay();').length - 1;
  return n === 1 ? true : (n === 0 ? 'FAIL(旧侧)' : 'FAIL 命中' + n + '次');
});

let pass = 0, fail = 0;
for (const [name, r] of results) {
  if (r === true) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + ' → ' + r); }
}
console.log((fail ? '❌' : '✅') + ' verify-1256 ' + pass + '/' + fail + ' （目标文件：' + target + '）');
process.exit(fail ? 1 : 0);

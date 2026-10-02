// ===== 验证脚本：#1407 经期提醒（预测日边界／提醒小时到点／通知侧分级口径）=====
// 用法：
//   node tools/verify-1407-period-remind-hour.mjs          —— 修复版（工作树 src）应全绿
//   node tools/verify-1407-period-remind-hour.mjs --red    —— 对 HEAD 的 period.js 跑同一把尺，
//                                                             本批新契约应当成片的红（判别用）
// 背景（作者让查「经期提醒有没有错误」，量出来三条真错＋一条口径不一致）：
//   ① status() 里 `while (s <= today)` 把「正好等于今天」那一格预测跳掉 → nextStart 永远 ≥ 明天，
//      于是提醒设置里那颗「当天」按钮对应的 d===0 那一发永不可达（checkCare 只能注一句
//      「0=当天不可达故滤掉」在下游绕），而预测日当天状态卡写「经期已推迟 1 天」、日历同一格
//      涂的是 predict（预测经期）＝同页两把尺差一天。
//   ② notifyCfg.hour 全仓只有写入与渲染、零个读方；本模块又一个 setInterval 都没有 →
//      「提醒时间（小时 0-23）」是纯摆设（实测 hour 从 0 扫到 23、钟点钉凌晨 3 点，通知恒 1 条）。
//   ③ 通知侧不看 predictTier：#559 判过的「太扯淡」那句话（给只记过 1 次的人报『已延迟 N 天』）
//      在通知这一路照发，经前也照旧按全部预警日连发；深夜 23:00–06:00 静默也只覆盖了聊天那一侧。
// 判据一律零机型／零 UA 分支：只看日期差、墙钟小时、规律档（CV 与有效周期数）。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import vm from 'node:vm';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const RED = process.argv.includes('--red');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + detail + ']'));
}

// 两侧同尺：旧版没有 window.periodNotifyCheckNow 这个触发口，统一在模块收尾前插一个私有导出，
// 让 OLD／NEW 都按同一组 API 被量（插的这行本身不含任何本批契约）。
function withExports(src) {
  const i = src.lastIndexOf('})();');
  if (i < 0) throw new Error('未找到模块收尾 })();');
  return src.slice(0, i) + '  window.__P={status:status,checkNotify:checkNotify,dayPhase:dayPhase,advHit:typeof advHit==="function"?advHit:null};\n' + src.slice(i);
}
let srcPeriod, srcData;
if (RED) {
  // 红侧基线不能写死 HEAD：并行收口随时可能把本批改完的 src 连带提交（实测 2026-09-29 14:54 那发
  // 「构建收口」就把 #1407 一起带进去了），那时 HEAD 已含本修复＝旧侧集体假绿。
  // 照 verify-period-care-warn 的先例：在 src/js/period.js 的最近提交里向前找第一个不含 advHit 的＝本批之前。
  const revs = execSync('git log --format=%H -30 -- src/js/period.js', { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n').filter(Boolean);
  let ref = '';
  for (const r of revs) {
    const p = execSync('git show ' + r + ':src/js/period.js', { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (p.indexOf('advHit') < 0 && p.indexOf('_said_') < 0) { srcPeriod = p; ref = r.slice(0, 8); break; }
  }
  if (!ref) throw new Error('近 30 个提交里没找到「本批之前」的 period.js（红侧基线钉不住）');
  srcData = execSync('git show ' + ref + ':src/js/default-cards-data.js', { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  console.log('（RED 对照＝' + ref + '，第一个不含本批标记的 period.js）');
} else {
  srcPeriod = read('src/js/period.js');
  srcData = read('src/js/default-cards-data.js');
}
srcPeriod = withExports(srcPeriod);

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const dayStr = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayStr(d); };
const TODAY = dayStr(new Date());
// 规律档：末次 lastDaysAgo 天前、之前每 28 天一次 → 3 段有效周期、CV=0（predictTier=rule）
const ruleRecs = (lastDaysAgo) => [lastDaysAgo, lastDaysAgo + 28, lastDaysAgo + 56, lastDaysAgo + 84];

function makeEnv(records, opts) {
  opts = opts || {};
  const ls = new Map();
  const notifyJson = JSON.stringify({
    enabled: opts.enabled === true,
    advanceDays: opts.advanceDays || [3, 1, 0],
    hour: 'hour' in opts ? opts.hour : 9,
    careEnabled: opts.careEnabled !== false,
    fired: {},
  });
  const recJson = JSON.stringify(records.map((ago, i) => ({ id: 'r' + i, start: daysAgo(ago), end: null })));
  const seed = () => { ls.set('period-records', recJson); ls.set('period-notify', notifyJson); };
  // restoreLate＝开局 LS 里还没有这几把键，值只在 IDB 里（＝LS 被清/导入备份那一类设备）；
  // 模块那发 idbGet().then 会把值写回 LS，但内存里那份 cfg/recs/notifyCfg 停在默认值——
  // G15 量的就是「回填落地后有没有重读内存」。
  const idb = new Map([['xy-home-v2:period-records', recJson], ['xy-home-v2:period-notify', notifyJson]]);
  if (!opts.restoreLate) seed();
  const store = { get: (k) => (ls.has(k) ? ls.get(k) : null), set: (k, v) => ls.set(k, v), remove: (k) => ls.delete(k) };
  const notes = [];   // notifyAssist 落点（系统通知）
  const cares = [];   // checkCare 落点（发进聊天的关心语）
  const timers = [];  // 模块级注册的钟——G8 要真的敲它，不在源码里数「setInterval」这个字
  const later = [];   // setTimeout 的回调（G15 要跑那只「回填后再读一遍」的补跑）
  const docOn = [];   // document 监听器（G8 要真的走一遍回前台）
  const errs = [];    // 敲钟/派发时抛出来的错（本批要求零异常，不许靠 try 蒙过去）
  const clock = { h: 'clock' in opts ? opts.clock : 12 };
  const sb = {
    setTimeout: (fn, ms) => { later.push({ fn, ms }); return later.length; }, clearTimeout: () => {},
    // #1407 起 period.js 模块级真有 setInterval 了（到点检查的钟），桩里必须给这两个符号，
    // 否则 vm 里跑到那一行直接 setInterval is not defined → 整支尺子假红。
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    console: { info() {}, warn() {}, error() {}, log() {} },
    Notification: function (title, o) { notes.push(title + ' | ' + (o && o.body)); },
  };
  sb.window = sb;
  sb.Notification.permission = 'granted';
  // 桩 navigator：真浏览器必有；缺它时 notifyAssist 里的 navigator.serviceWorker 抛 ReferenceError、
  // 被外层 try 静默吞掉 → 通知数恒 0 的夹具假象（实测踩过）。
  sb.navigator = {};
  sb.window.xyStore = () => store;
  sb.window.isDefaultCardOff = () => false;
  sb.window.chatAddIn = (text, o) => cares.push(((o && o.tag) || '') + ' | ' + text);
  sb.window.dcfGet = () => ('dcf' in opts ? opts.dcf : 100);
  // IDB 桩：G15 要造「LS 空、IDB 有值」那台设备（模块初始化读到默认值，回填晚一步才落地）
  sb.window.idbGet = (k) => Promise.resolve(idb.has(k) ? idb.get(k) : null);
  sb.window.idbSet = (k, v) => { idb.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return Promise.resolve(); };
  sb.Math = Object.assign(Object.create(Math), { random: () => ('rand' in opts ? opts.rand : 0) });
  sb.Date = class extends Date { getHours() { return clock.h; } };
  sb.document = {
    getElementById: (id) => (id === 'page-period' ? { hidden: true } : null),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (name, fn) => { docOn.push({ name, fn }); }, removeEventListener: () => {},
    body: { classList: { add: () => {}, remove: () => {} } },
  };
  vm.createContext(sb);
  vm.runInContext(srcData, sb, { filename: 'default-cards-data.js' });
  vm.runInContext(srcPeriod, sb, { filename: 'period.js' });
  const notify = () => sb.window.__P.checkNotify();
  const care = () => sb.window.periodCheckCare();
  // 敲一遍模块级注册的那只钟（等价于真页面上「到点了」），以及派发一个 document 事件
  const knockClock = () => { for (const t of timers) { try { t.fn(); } catch (e) { errs.push('钟回调抛错：' + e.message); } } };
  const dispatch = (name) => { for (const h of docOn) if (h.name === name) { try { h.fn({ type: name }); } catch (e) { errs.push(name + ' 监听器抛错：' + e.message); } } };
  // 跑掉排队的 setTimeout 回调（G15：回填落地后那只 200ms 的「重读＋补跑」就是这么排的）
  const runLater = async (rounds) => {
    for (let i = 0; i < (rounds || 2); i++) {
      await new Promise((r) => setImmediate(r));           // 先让 idbGet().then 这类微任务落地
      const batch = later.splice(0, later.length);
      for (const t of batch) { try { t.fn(); } catch (e) { errs.push('延时回调抛错：' + e.message); } }
    }
    await new Promise((r) => setImmediate(r));
  };
  return { notes, cares, clock, store, sb, timers, docOn, errs, ls, seed, status: () => sb.window.__P.status(), dayPhase: (ds) => sb.window.__P.dayPhase(ds), notify, care, knockClock, dispatch, runLater, readFired: () => (JSON.parse(store.get('period-notify') || '{}').fired || {}) };
}
const txt = (e) => JSON.stringify(e.notes);
const first = (e) => (e.notes[0] || '');
const run = (name, fn) => { try { fn(); } catch (e) { check(name + '（异常）', false, e && e.message); } };

// ---- ① 预测日边界 ----
run('G1 预测日当天：状态卡＝「今天预计是经期开始日」，与日历那一格同一天', () => {
  const e = makeEnv(ruleRecs(28));
  check('    nextStart 落在今天（旧版跳到 cl 之后）', e.status().nextStart === TODAY, e.status().nextStart);
  check('    状态卡不再写「推迟」', /推迟/.test(e.status().title) === false, e.status().title);
  check('    状态卡写「今天预计是经期开始日」', e.status().title.indexOf('今天预计是经期开始日') === 0, e.status().title);
  check('    日历今日格仍是 predict（两处读数现在同一天）', e.dayPhase(TODAY) === 'predict', e.dayPhase(TODAY));
});
run('G2 「当天」那一发真的会弹（advanceDays 含 0·rule 档·已到设定小时）', () => {
  const e = makeEnv(ruleRecs(28), { enabled: true, clock: 12 });
  e.notify();
  check('    通知 1 条（旧版恒 0 条＝那颗按钮是死的）', e.notes.length === 1, txt(e));
  check('    文本＝今天预计是经期开始日', first(e).indexOf('今天预计是经期开始日') > 0, first(e));
});
run('G3 推迟天数从预测日次日起算（不再比实际多算一天）', () => {
  const e = makeEnv(ruleRecs(29), { enabled: true, clock: 12 });
  check('    末次 29 天前（周期 28）→ 推迟 1 天（旧版＝2 天）', e.status().title === '经期已推迟 1 天', e.status().title);
  const f = makeEnv(ruleRecs(33), { enabled: true, clock: 12 });
  check('    末次 33 天前 → 推迟 5 天（旧版＝6 天，聊天侧同步少一天）', f.status().title === '经期已推迟 5 天', f.status().title);
});
run('G4 连着隔一个周期没记时不许自相矛盾（delayed 闸）', () => {
  const e = makeEnv(ruleRecs(56), { enabled: true, clock: 12 });
  const st = e.status();
  check('    状态卡写推迟 28 天', st.title === '经期已推迟 28 天', st.title);
  e.notify();
  check('    不弹「今天预计是经期开始日」（旧版这里会同时说两句话）', /今天预计/.test(txt(e)) === false, txt(e));
});

// ---- ② hour 与到点检查 ----
run('G5 没到设定小时不发，且当天名额不吞（之后照常补发）', () => {
  const e = makeEnv(ruleRecs(25), { enabled: true, hour: 21, clock: 12 });
  e.notify();
  check('    12 点·设定 21 点 → 零发送（旧版照发）', e.notes.length === 0, txt(e));
  const c0 = Object.keys(e.readFired()).length;
  check('    未发时没写 fired（写了就是把当天名额吞了）', c0 === 0, JSON.stringify(e.readFired()));
  e.clock.h = 22;
  e.notify();
  check('    过了 21 点再查 → 补发 1 条', e.notes.length === 1, txt(e));
});
run('G6 设定落在深夜段按 06:00 起算（明写在弹层那句话里，不静默改写）', () => {
  const e = makeEnv(ruleRecs(25), { enabled: true, hour: 3, clock: 3 });
  e.notify();
  check('    凌晨 3 点·设定 3 点 → 零发送（旧版发）', e.notes.length === 0, txt(e));
  e.clock.h = 7;
  e.notify();
  check('    早上 7 点 → 补发 1 条', e.notes.length === 1, txt(e));
});
run('G7 深夜 23:00–06:00 静默覆盖通知这一侧（与聊天侧同口径）', () => {
  const e = makeEnv([0, 28, 56, 84], { enabled: true, hour: 0, clock: 23 });
  e.notify();
  check('    经期中·23 点 → 通知零发送（旧版发「经期第 1 天」）', e.notes.length === 0, txt(e));
  const f = makeEnv([0, 28, 56, 84], { enabled: true, hour: 9, clock: 10 });
  f.notify();
  check('    对照：白天照常 1 条', f.notes.length === 1, txt(f));
});
run('G8 到点检查的钟真在跑（量行为，不在源码里数那个词——注释里也写着 setInterval，数词必假绿）', () => {
  // careEnabled:false＝把聊天那一路关掉，单独看这只钟接没接上提醒（#1407⑧ 之后两只路共享当天名额，
  // 关心先发的话会把名额占掉，这里必须隔离量法，否则量到的是「谁占了名额」而不是「钟在不在」）。
  const e = makeEnv(ruleRecs(25), { enabled: true, hour: 9, clock: 12, careEnabled: false });
  check('    模块级注册了一只周期 ≤ 5 分钟的钟（旧版一只都没有）', e.timers.length >= 1 && e.timers.some((t) => t.ms > 0 && t.ms <= 300000), JSON.stringify(e.timers.map((t) => t.ms)));
  e.clock.h = 3;
  e.knockClock();
  check('    凌晨 3 点敲这只钟 → 不发（深夜静默优先于定时器）', e.notes.length === 0, txt(e));
  e.clock.h = 12;
  e.knockClock();
  check('    白天敲同一只钟 → 真发出 1 条（证明它接的就是 checkNotify）', e.notes.length === 1, txt(e));
  const f = makeEnv(ruleRecs(25), { enabled: true, hour: 9, clock: 12, careEnabled: false });
  check('    接了 mochi-fg-resume（回前台补一发，同 memo-app/p2-features 那条通道）', f.docOn.some((h) => h.name === 'mochi-fg-resume'), f.docOn.map((h) => h.name).join(','));
  f.dispatch('mochi-fg-resume');
  check('    派发回前台 → 补发 1 条（隐藏页被内核节流的那条路）', f.notes.length === 1, txt(f));
  check('    零异常（敲钟与派发都不许抛穿）', f.errs.length === 0 && e.errs.length === 0, JSON.stringify(e.errs.concat(f.errs)));
});
run('G9 冷却未动：同日同一发只弹一次', () => {
  const e = makeEnv(ruleRecs(25), { enabled: true, clock: 12 });
  e.notify(); e.notify(); e.notify();
  check('    三次检查累计 1 条', e.notes.length === 1, txt(e));
});

// ---- ③ 通知侧分级口径（与聊天侧同一把尺）----
run('G10 不规律档不再收到「推迟/延迟 N 天」（#559 的判定管到通知）', () => {
  const e = makeEnv([41], { enabled: true, clock: 12 });
  e.notify();
  check('    发 1 条', e.notes.length === 1, txt(e));
  check('    不含「推迟/延迟」', /推迟|延迟/.test(first(e)) === false, first(e));
  check('    改成间隔口吻「距上次经期已经 42 天」', first(e).indexOf('距上次经期已经 42 天') > 0, first(e));
});
run('G11 不规律档推迟 7 天（<10）→ 通知也不发（旧版发「已延迟 7 天」）', () => {
  const e = makeEnv([35], { enabled: true, clock: 12 });
  e.notify();
  check('    零发送', e.notes.length === 0, txt(e));
});
run('G12 规律档推迟满 10 天升「去看看医生」，5~9 天只提「建议关注」（与聊天侧同一道坎）', () => {
  const e = makeEnv(ruleRecs(38), { enabled: true, clock: 12 });  // dayOfCycle 39 → 推迟 10 天
  e.notify();
  check('    推迟 10 天 → 发 1 条', e.notes.length === 1, e.status().title + ' ' + txt(e));
  check('    天数与状态卡同数（推迟 10 天）', /推迟 10 天/.test(first(e)), first(e));
  check('    带就医建议', /医生/.test(first(e)), first(e));
  const f = makeEnv(ruleRecs(33), { enabled: true, clock: 12 });  // 推迟 5 天
  f.notify();
  check('    推迟 5 天 → 发、提「建议关注」、不提医生', f.notes.length === 1 && /医生/.test(first(f)) === false && /建议关注/.test(first(f)), f.status().title + ' ' + txt(f));
  const g = makeEnv(ruleRecs(32), { enabled: true, clock: 12 });  // 推迟 4 天
  g.notify();
  check('    推迟 4 天 → 不发（阈值 5 未动）', g.notes.length === 0, g.status().title + ' ' + txt(g));
});
run('G13 不规律档经前只认最接近的一次（旧版按全部预警日连发）', () => {
  const e = makeEnv([25], { enabled: true, clock: 12 });  // 单记录＝free，距预测 3 天
  e.notify();
  check('    提前 3 天 → 通知零发送（旧版发「距下次经期约 3 天」）', e.notes.length === 0, txt(e));
  const r = makeEnv(ruleRecs(25), { enabled: true, clock: 12 });  // 同一天数、rule 档
  r.notify();
  check('    对照：规律档提前 3 天照常 1 条', r.notes.length === 1, txt(r));
});
run('G14 聊天侧未被顺手改坏（语料全是「还有 {d} 天」口吻，当天那一发仍归通知）', () => {
  const e = makeEnv([27], { enabled: true, clock: 12 });   // free·提前 1 天 → 发「仅供参考」版
  e.care();
  check('    不规律档提前 1 天 → 聊天发 1 条', e.cares.length === 1, JSON.stringify(e.cares));
  const f = makeEnv(ruleRecs(28), { enabled: true, clock: 12 }); // 当天
  f.care();
  check('    当天 → 聊天零发送（没有「还有 0 天」这种话）', f.cares.length === 0, JSON.stringify(f.cares));
  check('    但通知认当天（上一条 G2 的分工）', (f.sb.window.__P.advHit ? f.sb.window.__P.advHit(0, 'rule', true) : true) === true);
});

// ---- ⑦ 回填竞态 / ⑧ 两渠道同一天只说一句 ----
const runA = async (name, fn) => { try { await fn(); } catch (e) { check(name + '（异常）', false, e && e.message); } };

await runA('H1 LS 被清那类设备：IDB 回填落地后必须重读内存（此前当天那一发整轮丢失）', async () => {
  const e = makeEnv(ruleRecs(25), { enabled: true, hour: 9, clock: 12, careEnabled: false, restoreLate: true });
  check('    开局内存读不到记录（状态卡＝暂无记录）', e.status().phase === 'unknown', e.status().phase);
  e.notify();
  check('    这一发不发（内存里 notifyCfg 还是 enabled=false 的默认值）', e.notes.length === 0, txt(e));
  await e.runLater(1);   // 模块自己那发 idbGet().then 落进 LS
  check('    对照：LS 已被模块回填好（不是没数据，是没重读内存）', !!e.store.get('period-records') && !!e.store.get('period-notify'), 'ok');
  check('    但内存仍停在默认值（这就是当天丢那一发的原因）', e.status().phase === 'unknown', e.status().phase);
  e.dispatch('mochi-restore-done');
  await e.runLater(2);   // 回填事件 → 200ms 后那次「重读＋补跑」
  check('    事件后内存跟上（状态卡改口读预测）', e.status().phase !== 'unknown', e.status().phase);
  e.notify();
  check('    补跑后这一发发得出（旧版这里恒 0 条）', e.notes.length === 1, txt(e));
  check('    零异常', e.errs.length === 0, JSON.stringify(e.errs));
});

await runA('H2 同一语境同一天只说一句：TA 先开口，提醒不再重复（旧版两条各一条）', async () => {
  const e = makeEnv(ruleRecs(25), { enabled: true, hour: 9, clock: 12 });
  e.care();
  check('    聊天侧发 1 条', e.cares.length === 1, JSON.stringify(e.cares));
  e.notify();
  check('    通知侧就不发了（旧版这里再多一条＝同一天两句同义话）', e.notes.length === 0, txt(e));
  const keys = Object.keys(e.readFired());
  check('    两侧共用同一枚当天名额键（键名全部以 _said_ 起头）', keys.length === 1 && keys[0].indexOf('_said_') > 0, JSON.stringify(keys));
});

await runA('H3 反过来也成立：提醒先落地，TA 那句同语境就不重复', () => {
  const e = makeEnv(ruleRecs(25), { enabled: true, hour: 9, clock: 12 });
  e.notify();
  check('    通知 1 条', e.notes.length === 1, txt(e));
  e.care();
  check('    聊天侧不再补第二条（旧版照发）', e.cares.length === 0, JSON.stringify(e.cares));
});

await runA('H4 提醒只在「这句今天没人说过」时补位：关掉关心＝通知照常发', () => {
  const e = makeEnv(ruleRecs(25), { enabled: true, hour: 9, clock: 12, careEnabled: false });
  e.care();
  e.notify();
  check('    关心关掉时这一发由提醒来说（不是双双沉默）', e.notes.length === 1, txt(e));
});

await runA('H5 同语境键在两个渠道语义一致（经期期中那一发也只留一条）', () => {
  const e = makeEnv([0, 28, 56, 84], { enabled: true, hour: 9, clock: 12 });
  e.care();
  e.notify();
  check('    经期中：聊天 1 条＋通知 0 条', e.cares.length === 1 && e.notes.length === 0, JSON.stringify([e.cares, e.notes]));
  const f = makeEnv([0, 28, 56, 84], { enabled: true, hour: 9, clock: 12, careEnabled: false });
  f.care(); f.notify();
  check('    对照：关心关了 → 通知 1 条', f.cares.length === 0 && f.notes.length === 1, JSON.stringify([f.cares, f.notes]));
});

// ---- ⑥ 权限缺失时那句话不再说谎（纯文案面，但它是「静默失败」的最后一道说明）----
run('G17 权限/能力缺失时的指路改口：不再承诺「以站内形式出现」', () => {
  // 钉的是那句用户可见的原话（逐字）——注释里难免提到旧说法，收窄成整句才不会被自己的注释顶红。
  const LIE = '提醒只会在打开应用时以站内形式出现';
  check('    被测源码里那句原话已删净（旧版两处分支都写着它）', srcPeriod.indexOf(LIE) < 0, srcPeriod.indexOf(LIE) >= 0 ? '仍在' : '已删');
  check('    改口后的实话在位：这一弹发不出去＋屏上只剩页内读数', srcPeriod.indexOf('这一弹发不出去') >= 0, '');
  check('    并点名另一路的「梦角关心」不走通知权限（否则用户以为两样一起没了）',
    srcPeriod.indexOf('梦角关心」是另一路') >= 0 && srcPeriod.indexOf('只剩页内读数') >= 0, '');
});

// ---- 汇总 ----
const total = results.length, pass = results.filter((r) => r.ok).length;
console.log('\n合计 ' + total + ' 断言：通过 ' + pass + ' ／ 失败 ' + (total - pass));
if (!RED && pass !== total) process.exit(1);
if (RED && pass === total) { console.log('⚠ RED 全绿＝这把尺子没有判别力'); process.exit(1); }
process.exit(pass === total ? 0 : (RED ? 0 : 1));

// ===== 验证脚本：#559 经期预警按「语境 × 经期规律」分级 =====
// 用法：
//   node tools/verify-period-care-warn.mjs          —— 修复版应全绿（A 静态锚点 + B 行为断言）
//   node tools/verify-period-care-warn.mjs --red    —— 对「最近一个不含本修复的提交」跑 B 段，
//                                                      判别断言应全失败、其余全通过
//
// 背景（用户反馈两条）：
//   ①「还没到经期时间，联系人直接在聊天里发送了经期关心」——旧版三种触发语境（经期中/
//     经前提醒日/推迟）共用「经期关心」语料（经期中口吻）；
//   ②「经期已经推迟 13 天了，别太紧张」太扯淡——推迟措辞不看经期规律一刀切。
// 设计（period.js checkCare 注释有完整矩阵）：predictTier 用 cycleStats 判档——有效周期
//   ≥3 且 CV<0.2 = rule「预测可信」，其余 = free「预测仅参考」。rule：经前按全部预警日、
//   推迟 ≥5 天轻度措辞、≥10 天升关注档（就医建议）；free：经前只在最接近的一次预警日发
//   「仅供参考」版、不说「推迟」，晚 ≥10 天才以「距上次经期 N 天」间隔口吻轻提。
// ⚠️ #1407① 之后「推迟 N 天」的起算挪后一天（预测日当天不再算推迟 1 天），本文件 B2/B3/B5 的种子各 +1 天以保持
//    「推迟 13/6/7 天」这些场景名与语境阈值不变；A5/A7 两处静态锚已按现状重锚（A5 那条自 #1405 加
//    nightAllow 起就是哑锚，本次顺手修）。
// B 段 vm 桩加载真实源码（default-cards-data.js + period.js），种子 period-records 控制
//   周期相位与规律档（4 连 28 天记录=rule；单记录=free），Math.random=0 全确定性。
// ⚠️ 本文件曾被并行会话「编辑器旧缓冲回写」覆盖回草稿版（2026-09-16，已重写恢复）；
//    改本文件前先 git diff 确认基线，避免再次回退丢失 --red 基线与分级场景。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import vm from 'node:vm';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const RED = process.argv.includes('--red');
const results = [];
function check(desc, ok, discriminating) {
  results.push({ desc, ok: !!ok, discriminating: !!discriminating });
  console.log((ok ? 'PASS' : 'FAIL') + (discriminating && !ok ? '(判别)' : '') + '  ' + desc);
}

// ---- A 段：静态锚点（RED 模式跳过——修复前源码本来就没有这些锚点）----
if (!RED) {
  const periodSrc = read('src/js/period.js');
  const dataSrc = read('src/js/default-cards-data.js');
  const dcSrc = read('src/js/default-cards.js');
  check('A1 period.js 按分组名取语料助手 + 经期关心同源读取', periodSrc.includes("cardGroupLines('经期关心', PERIOD_CARE_FALLBACK)") && periodSrc.includes('function cardGroupLines(name, fb)'));
  check('A2 预警语抽取器按 ctx×tier 选组（adv 规律/不规律、delay 轻/关注/不规律）', periodSrc.includes('function pickWarnLine(ctx, tier)') && periodSrc.includes("name = '经前预警·不规律'; fb = PERIOD_PREWARN_FREE_FALLBACK;") && periodSrc.includes("ctx === 'delayDeep'") && periodSrc.includes("ctx === 'delayIrregular'"));
  check('A3 checkCare 语境 kind 分流（in/adv/delay/delayIrr）', periodSrc.includes("ctx = 'inPeriod'; kind = 'in';") && periodSrc.includes("ctx = 'adv' + d; kind = 'adv';") && periodSrc.includes("ctx = delayDays >= 10 ? 'delayDeep' : 'delay'; kind = 'delay';") && periodSrc.includes("ctx = 'delayIrregular'; kind = 'delayIrr';"));
  check('A4 预警语 {d} 替换为具体天数（adv/delay/间隔三种取数）', periodSrc.includes('String(line).replace(/\\{d\\}/g, String(diffDays(today, st.nextStart)));') && periodSrc.includes('String(line).replace(/\\{d\\}/g, String(delayDays));') && periodSrc.includes('String(line).replace(/\\{d\\}/g, String(st.dayOfCycle || 0));'));
  check('A5 标签按语境区分（经期关心/经期预警）', periodSrc.includes("kind === 'sym' ? '症状关心' : (kind === 'in' ? '经期关心' : '经期预警')")); // #1407 顺手重锚：#1405 给这行加了 nightAllow，旧锚自那批起就一直是哑的（HEAD 上实测 A5 已红）
  check('A6 分级判据 predictTier（有效周期 ≥3 且 CV<0.2=rule，否则 free）', periodSrc.includes("if (s.n >= 3 && s.cv < 0.2) return 'rule';") && periodSrc.includes("return 'free';"));
  check('A7 free 档经前只在最接近的预警日提一次', periodSrc.includes("return tier === 'free' ? d === advs[0] : true;") && periodSrc.includes('if (advHit(d, tier, false))')); // #1407 重锚：命中判定收成 advHit 一把尺（通知与聊天同调用），旧的两处手抄没了
  check('A8 数据源：经期关心保持第 0 组 + 五个预警/推迟分组齐备', dataSrc.indexOf('["经期关心"') >= 0 && dataSrc.indexOf('["经期关心"') < dataSrc.indexOf('["温柔前缀"') && dataSrc.includes('["经前预警", [') && dataSrc.includes('["经前预警·不规律", [') && dataSrc.includes('["经期推迟", [') && dataSrc.includes('["经期推迟·关注", [') && dataSrc.includes('["经期推迟·不规律", ['));
  check('A9 规律档推迟强调「一向很准」+ 关注档带就医建议 + 不规律档不说「推迟」', dataSrc.includes('你一向很准的') && dataSrc.includes('陪你去看看医生吧') && dataSrc.includes('距上次经期已经 {d} 天了'));
  check('A10 字卡库「TA的关心」说明更新（分级判据 CV + 分组名）', dcSrc.includes('CV<0.2') && dcSrc.includes('「经期推迟·不规律」') && dcSrc.includes('「经期预警」'));
  check('A11 深夜静默 23:00–06:00（同记忆备忘/喝水先例；删则半夜被经期预警叫醒）', periodSrc.includes('if (_h >= 23 || _h < 6) return; // #559 深夜静默（23:00–06:00 不发、不写 fired）') && dcSrc.includes('23:00–06:00 深夜静默'));
}

// ---- B 段：vm 桩环境跑真实源码的行为断言 ----
// RED 基线取源：并行收口频繁，「HEAD」随时可能已含本修复——自动向前找最近一个
// period.js 不含「经期预警」标签的提交（即语境分流落地前）作对照
function redSources() {
  const revs = execSync('git log --format=%H -20 -- src/js/period.js', { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n').filter(Boolean);
  for (const r of revs) {
    const p = execSync('git show ' + r + ':src/js/period.js', { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (p.indexOf("'经期预警'") < 0) {
      const d = execSync('git show ' + r + ':src/js/default-cards-data.js', { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      return { ref: r.slice(0, 8), period: p, data: d };
    }
  }
  throw new Error('近 20 个提交里没找到修复前的 period.js（分级基线）');
}
const red = RED ? redSources() : null;
if (RED) console.log('（RED 对照提交：' + red.ref + '）');
const srcPeriod = RED ? red.period : read('src/js/period.js');
const srcData = RED ? red.data : read('src/js/default-cards-data.js');

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return dayStr(d); }

// 从当前源码数据里取指定分组语料（修复前源码无该分组则返回空表）
function groupLines(name) {
  try {
    const s = { window: {} };
    vm.createContext(s);
    vm.runInContext(srcData, s, { filename: 'default-cards-data.js' });
    const g = s.window.DEFAULT_CARD_DATA && s.window.DEFAULT_CARD_DATA.period;
    if (Array.isArray(g)) for (const grp of g) if (grp && grp[0] === name) return grp[1];
  } catch (e) {}
  return [];
}
const PREWARN = groupLines('经前预警');
const PREWARN_FREE = groupLines('经前预警·不规律');
const DELAY_MILD = groupLines('经期推迟');
const DELAY_DEEP = groupLines('经期推迟·关注');
const DELAY_FREE = groupLines('经期推迟·不规律');

// 规律档记录：末次经期 lastDaysAgo 天前 + 之前每 28 天一次（3 个有效周期差，CV=0 → rule）
function ruleRecs(lastDaysAgo) { return [lastDaysAgo, lastDaysAgo + 28, lastDaysAgo + 56, lastDaysAgo + 84]; }

// 建一个全新桩环境：records=经期开始日（天数前数组）、提醒配置、opts.hour=受控「当前小时」
// （默认 12 白天——否则测试在真实深夜运行会被 #559 深夜静默拦掉而误报）。
// 返回 { calls, hourRef, fire, store }；hourRef.h 可在两次 fire 之间改动（验静默不吞当天名额）。
function makeEnv(records, opts) {
  opts = opts || {};
  const lsMap = new Map();
  lsMap.set('period-records', JSON.stringify(records.map((ago, i) => ({ id: 'r' + i, start: daysAgoStr(ago), end: null }))));
  lsMap.set('period-notify', JSON.stringify({ enabled: false, advanceDays: [3, 1, 0], hour: 9, careEnabled: opts.careEnabled !== false, fired: {} }));
  if (opts.blockGroups) opts.blockGroups.forEach((name) => groupLines(name).forEach((l) => lsMap.set('dc-off-period:' + l, '1')));
  const store = {
    get: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    set: (k, v) => lsMap.set(k, v),
    remove: (k) => lsMap.delete(k)
  };
  const calls = [];
  const hourRef = { h: 'hour' in opts ? opts.hour : 12 };
  const sandbox = {
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    // #1407 起 period.js 模块级真有 setInterval 了（「提醒时间」那把到点检查的钟），桩里不给这两个
    // 符号，vm 里跑到那一行就 setInterval is not defined → B 段整族假红（16 异常）。
    setInterval: function () { return 0; },
    clearInterval: function () {},
    console: { info: function () {}, warn: function () {}, error: function () {}, log: function () {} }
  };
  sandbox.window = sandbox;
  sandbox.window.xyStore = function () { return store; };
  // 与 default-cards.js 同语义：字卡库逐张开关（dc-off-<分类>:<文案>）读取口
  sandbox.window.isDefaultCardOff = function (cat, c) { return store.get('dc-off-' + cat + ':' + c) === '1'; };
  sandbox.window.chatAddIn = function (text, o) { calls.push({ text: String(text), tag: (o && o.tag) || '' }); };
  sandbox.Math = Object.assign(Object.create(Math), { random: function () { return 0; } });
  // 受控 Date：只覆写 getHours（其余继承真实 Date），用于深夜静默场景
  sandbox.Date = class extends Date { getHours() { return hourRef.h; } };
  // page-period 桩：truthy 即可（period.js 早期判空），hidden=true 防 render 路径
  sandbox.document = {
    getElementById: function (id) { return id === 'page-period' ? { hidden: true } : null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
    body: { classList: { add: function () {}, remove: function () {} } }
  };
  vm.createContext(sandbox);
  vm.runInContext(srcData, sandbox, { filename: 'default-cards-data.js' });
  vm.runInContext(srcPeriod, sandbox, { filename: 'period.js' });
  return { calls, hourRef, fire: () => sandbox.window.periodCheckCare(), store };
}
function scenario(records, opts) {
  const env = makeEnv(records, opts);
  env.fire();
  return env.calls;
}
const errs = [];
function run(name, fn) {
  const before = results.length;
  try { fn(); } catch (e) {
    errs.push(name);
    if (results.length === before) check(name + '（异常）', false);
    console.log('      └ 异常: ' + (e && e.message));
  }
}
function expectOne(calls, tag, dayTxt, pool, poolD) {
  check('    应发且仅发 1 条', calls.length === 1);
  if (calls.length !== 1) throw new Error('实发 ' + calls.length + ': ' + JSON.stringify(calls));
  check('    标签=经期预警', calls[0].tag === '经期预警', true);
  check('    文案带「' + dayTxt + '」', calls[0].text.indexOf(dayTxt) >= 0, true);
  check('    占位符 {d} 已替换', calls[0].text.indexOf('{d}') < 0);
  if (pool.length) check('    文案出自「' + (pool === PREWARN ? '经前预警' : pool === PREWARN_FREE ? '经前预警·不规律' : pool === DELAY_MILD ? '经期推迟' : pool === DELAY_DEEP ? '经期推迟·关注' : '经期推迟·不规律') + '」分组', pool.some((l) => l.replace(/\{d\}/g, poolD) === calls[0].text));
}

run('B1 规律档·经前预警日（距预测 3 天）→ 确定口吻预警', () => {
  expectOne(scenario(ruleRecs(25)), '经期预警', '3 天', PREWARN, '3');
});
run('B2 规律档·推迟 13 天 → 升「关注」档（就医建议口吻）', () => {
  expectOne(scenario(ruleRecs(41)), '经期预警', '13 天', DELAY_DEEP, '13');
});
run('B3 规律档·推迟 6 天 → 轻度措辞（「一向很准」，不提医生）', () => {
  const calls = scenario(ruleRecs(34));
  check('    应发且仅发 1 条', calls.length === 1);
  if (calls.length !== 1) throw new Error('实发 ' + calls.length + ': ' + JSON.stringify(calls));
  check('    标签=经期预警', calls[0].tag === '经期预警', true);
  check('    文案带「6 天」', calls[0].text.indexOf('6 天') >= 0, true);
  check('    轻度档不提就医', calls[0].text.indexOf('医生') < 0);
  if (DELAY_MILD.length) check('    文案出自「经期推迟」分组', DELAY_MILD.some((l) => l.replace(/\{d\}/g, '6') === calls[0].text));
});
run('B4 不规律档·推迟 13 天 → 间隔口吻「距上次经期 41 天」，绝不说「推迟」', () => {
  const calls = scenario([40]);
  check('    应发且仅发 1 条', calls.length === 1);
  if (calls.length !== 1) throw new Error('实发 ' + calls.length + ': ' + JSON.stringify(calls));
  check('    标签=经期预警', calls[0].tag === '经期预警', true);
  check('    文案带间隔天数「41 天」（{d}=距上次经期）', calls[0].text.indexOf('41 天') >= 0, true);
  check('    不说「推迟/晚了」（预测不可信）', calls[0].text.indexOf('推迟') < 0 && calls[0].text.indexOf('晚了') < 0);
  if (DELAY_FREE.length) check('    文案出自「经期推迟·不规律」分组', DELAY_FREE.some((l) => l.replace(/\{d\}/g, '41') === calls[0].text));
});
run('B5 不规律档·仅推迟 7 天 → 不发（预测误差可能比推迟还大，提了就是「太扯淡」）', () => {
  const calls = scenario([34]);
  // 判别断言：RED 下旧码照发＝本项 FAIL 属预期，直接返回不再抛异常
  check('    零发送', calls.length === 0, true);
});
run('B6 不规律档·经前提前 1 天（最接近的预警日）→ 发「仅供参考」版', () => {
  expectOne(scenario([27]), '经期预警', '1 天', PREWARN_FREE, '1');
});
run('B7 不规律档·经前提前 3 天 → 不发（只认最接近的一次预警日，不按不可信预测连发）', () => {
  const calls = scenario([25]);
  // 判别断言：RED 下旧码照发＝本项 FAIL 属预期，直接返回不再抛异常
  check('    零发送', calls.length === 0, true);
});
run('B8 经期中 → 仍发「经期关心」（原语料，语境不受影响）', () => {
  const calls = scenario([0]);
  check('    应发且仅发 1 条', calls.length === 1);
  if (calls.length !== 1) throw new Error('实发 ' + calls.length + ': ' + JSON.stringify(calls));
  check('    标签=经期关心', calls[0].tag === '经期关心');
  check('    无占位符泄漏', calls[0].text.indexOf('{d}') < 0);
});
run('B9 距下次经期 18 天（不在预警日）→ 不发任何消息', () => {
  const calls = scenario([10]);
  check('    零发送', calls.length === 0);
  if (calls.length !== 0) throw new Error('实发 ' + JSON.stringify(calls));
});
run('B10 同一语境同日只发一条（冷却不受分级影响）', () => {
  const env = makeEnv(ruleRecs(25));
  env.fire();
  env.fire();
  check('    同日两次判定只发 1 条', env.calls.length === 1);
});
run('B11 经期页「梦角关心」开关关闭 → 完全不发', () => {
  const calls = scenario(ruleRecs(25), { careEnabled: false });
  check('    零发送', calls.length === 0);
});
run('B12 字卡库把「经前预警」整组关掉 → 经前预警日一条不发（不回落经期中语料）', () => {
  if (!PREWARN.length) { console.log('SKIP  B12（源码无经前预警分组，RED 模式正常）'); return; }
  const calls = scenario(ruleRecs(25), { blockGroups: ['经前预警'] });
  check('    整组关闭时经前预警日零发送', calls.length === 0, true);
});

run('B13 深夜 23:00 经前预警日 → 不发（半夜不叫醒，同备忘/喝水先例）', () => {
  const calls = scenario(ruleRecs(25), { hour: 23 });
  check('    深夜零发送', calls.length === 0, true);
});
run('B14 凌晨 05:59 经期中 → 不发（静默期覆盖 23:00–06:00 全段）', () => {
  const calls = scenario([0], { hour: 5 });
  check('    深夜零发送', calls.length === 0, true);
});
run('B15 静默不吞当天名额：深夜不发 → 白天改点后照常补发', () => {
  const env = makeEnv(ruleRecs(25), { hour: 23 });
  env.fire();
  check('    深夜段零发送（且未写 fired）', env.calls.length === 0, true);
  const c0 = env.calls.length;
  env.hourRef.h = 12;
  env.fire();
  check('    白天段增量 1 条（静默若写了 fired 这里会是 0）', env.calls.length === c0 + 1, true);
});
run('B16 06:00 整点边界 → 视为白天照发（不小于 6 不静默）', () => {
  const calls = scenario(ruleRecs(25), { hour: 6 });
  check('    06:00 照发 1 条', calls.length === 1);
});

// ---- 汇总 ----
const total = results.length;
const pass = results.filter((r) => r.ok).length;
const disc = results.filter((r) => r.discriminating);
const discFail = disc.filter((r) => !r.ok);
const plainFail = results.filter((r) => !r.discriminating && !r.ok);
console.log('----');
console.log((RED ? 'RED 基线' : '结果') + ': ' + pass + '/' + total + '（判别断言 ' + (disc.length - discFail.length) + '/' + disc.length + '，异常 ' + errs.length + '）');
if (RED) {
  // RED 基线预期：判别断言全部失败（修复前无分级），非判别断言全部通过
  if (disc.length > 0 && discFail.length === disc.length && plainFail.length === 0 && errs.length === 0) {
    console.log('✅ RED 基线成立：判别断言 ' + discFail.length + '/' + disc.length + ' 全失败（脚本有牙），非判别断言全通过');
  } else {
    console.log('❌ RED 基线不符合预期：判别失败 ' + discFail.length + '/' + disc.length + '（应全失败）、非判别失败 ' + plainFail.length + '（应全通过）、异常 ' + errs.length);
    process.exitCode = 1;
  }
} else {
  if (pass === total && errs.length === 0) console.log('✅ 全部通过');
  else { console.log('❌ 有失败项'); process.exitCode = 1; }
}

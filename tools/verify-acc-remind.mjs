// ===== 专项回归：记账「TA 记账提醒」（每天概率触发聊天系统字卡，默认关闭） =====
// 需求（用户原话）：「在记账的设置里新增：联系人每天有概率在聊天发送系统消息提醒我记账，
//   默认关闭，需要手动开启。」
// 实现（src/js/accounting.js，全部 per-cid 键，随桌面命名空间隔离）：
//   acc-remind-on    开关，键不存在＝'0'＝关闭（默认关闭）
//   acc-remind-prob  每天概率，未设＝30
//   acc-remind-day   当天掷骰状态 {date,hit,done}，保证「一天最多一条」且日概率＝字面概率
//   投递 window.chatAddIn(text, {tag:'记账提醒'})——掷骰与投递同一次同步调用，读的就是当时桌面的键
// 用例：A 组＝提取真实函数体＋stub 依赖跑行为；S 组＝源码/样式锚点。
// 红对照：MOCHI_ACC_FILE=<git show HEAD:src/js/accounting.js> MOCHI_EXPECT=red node tools/verify-acc-remind.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const srcAcc = readFileSync(process.env.MOCHI_ACC_FILE || join(root, 'src/js/accounting.js'), 'utf8');
const srcCss = readFileSync(process.env.MOCHI_CSS_FILE || join(root, 'src/css/chat-pages.css'), 'utf8');

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

function extractFn(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error('找不到 ' + sig);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(sig + ' 花括号不配平');
}

const SIGS = ['function rmOn()', 'function rmProb()', 'function rmRecordedToday()', 'function rmSend()', 'function rmTick()'];
let api = null;
try {
  const body = SIGS.map((s) => extractFn(srcAcc, s)).join('\n');
  api = makeApi(body);
} catch (e) {
  failures.push('A*：无法从 accounting.js 提取提醒函数体——' + e.message);
}

// 一天内的时间/记录/桌面都由调用方注入，stub 掉全部外依赖
function makeApi(body) {
  return new Function('window', 'document', 'store', 'todayStr', 'loadRecs', 'Date',
    'KEY_RM_ON', 'KEY_RM_PROB', 'KEY_RM_DAY', 'RM_PROB_DEF', 'RM_MSGS',
    '"use strict";' + body + '; return { rmOn: rmOn, rmProb: rmProb, rmRecordedToday: rmRecordedToday, rmSend: rmSend, rmTick: rmTick };');
}
function dateStub(hour) {
  return hour === undefined ? Date : function () { return { getHours: () => hour }; };
}
function mkStore(init) {
  const m = {};
  Object.keys(init || {}).forEach((k) => { m[k] = init[k]; });
  return {
    get: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    set: (k, v) => { m[k] = String(v); },
    _dump: () => m
  };
}
// rand＝掷骰桩（0 ⇒ 0*ratio<p 恒命中；0.99 ⇒ 只有 p=100 才命中）
function run(opts) {
  const o = opts || {};
  const spy = { sent: [], tags: [], attempts: 0 };
  const win = {
    __mochiDataReady: o.ready !== false,
    taFit: (t) => t.replace(/TA/g, '他'),
    chatAddIn: (text, mo) => {
      spy.attempts++;
      if (o.deliver === false) throw new Error('stub: 投递失败');
      spy.sent.push(text); spy.tags.push(mo && mo.tag);
    }
  };
  const store = mkStore(o.store);
  const fn = makeApi(SIGS.map((s) => extractFn(srcAcc, s)).join('\n'));
  const api = fn(win, { hidden: false, activeElement: null }, store,
    () => o.today || '2026-09-19', () => o.recs || [], dateStub(o.hour),
    'acc-remind-on', 'acc-remind-prob', 'acc-remind-day', 30, ['提醒文案一', '提醒文案二']);
  const realRandom = Math.random;
  Math.random = () => (o.rand === undefined ? 0 : o.rand);
  let err = null;
  try { for (let i = 0; i < (o.times || 1); i++) api.rmTick(); } catch (e) { err = e; }
  Math.random = realRandom;
  if (err) failures.push('EX：tick 抛异常——' + err.message);
  return { spy, store, err, api };
}

const ON = { 'acc-remind-on': '1' };
const TODAY = '2026-09-19';

if (api) {
  // A1 默认关闭：键不存在 ⇒ rmOn()=false，且 tick 零投递、零写状态
  const a1 = run({ hour: 12, recs: [] });
  note('A1-默认关闭', a1.spy.sent.length === 0, '默认（无键）不应发任何提醒，实发 ' + a1.spy.sent.length);
  note('A1-不写状态', Object.keys(a1.store._dump()).length === 0, '默认关闭时不该落任何键，实得 ' + JSON.stringify(a1.store._dump()));

  // A2 显式 '0' 同样静默
  const a2 = run({ hour: 12, store: { 'acc-remind-on': '0', 'acc-remind-prob': '100' } });
  note('A2-显式关闭', a2.spy.sent.length === 0, '关闭态应零投递，实发 ' + a2.spy.sent.length);

  // A3 开启＋概率 100＋今天没记 ⇒ 发 1 条，带「记账提醒」tag
  const a3 = run({ hour: 12, store: Object.assign({ 'acc-remind-prob': '100' }, ON), recs: [] });
  note('A3-开启即投', a3.spy.sent.length === 1, '开启＋100% 应发 1 条，实发 ' + a3.spy.sent.length);
  note('A3-来源标签', a3.spy.tags[0] === '记账提醒', 'tag 应为「记账提醒」，实得 ' + a3.spy.tags[0]);
  note('A3-称呼跟随', /他/.test(a3.spy.sent[0] || '') || !/TA/.test(a3.spy.sent[0] || ''), '文案应过 taFit，实得 ' + a3.spy.sent[0]);

  // A4 一天只一条：同日重复 tick 不再发
  const a4 = run({ hour: 12, store: Object.assign({ 'acc-remind-prob': '100' }, ON), recs: [], times: 5 });
  note('A4-每天最多一条', a4.spy.sent.length === 1, '同日 5 次 tick 应只发 1 条，实发 ' + a4.spy.sent.length);

  // A5 概率 0 ⇒ 不发，但当天已掷过（不反复重掷）
  const a5 = run({ hour: 12, store: Object.assign({ 'acc-remind-on': '1', 'acc-remind-prob': '0' }, {}), recs: [] });
  note('A5-概率0不发', a5.spy.sent.length === 0, '概率 0 应不发，实发 ' + a5.spy.sent.length);
  note('A5-当日已掷', /"done":1/.test(a5.store.get('acc-remind-day') || ''), '未命中应把当天标记为已掷完，实得 ' + a5.store.get('acc-remind-day'));

  // A6 今天已经记过账 ⇒ 不催
  const a6 = run({ hour: 12, store: Object.assign({ 'acc-remind-prob': '100' }, ON), recs: [{ date: TODAY, amount: 5 }] });
  note('A6-已记账不催', a6.spy.sent.length === 0, '今天有记录应不提醒，实发 ' + a6.spy.sent.length);
  note('A6-当日封口', /"done":1/.test(a6.store.get('acc-remind-day') || ''), '应标记当天结束，实得 ' + a6.store.get('acc-remind-day'));

  // A7 昨天记过、今天没记 ⇒ 仍催（只认当天）
  const a7 = run({ hour: 12, store: Object.assign({ 'acc-remind-prob': '100' }, ON), recs: [{ date: '2026-09-18', amount: 5 }] });
  note('A7-只看当天', a7.spy.sent.length === 1, '只有昨天记录时今天应催，实发 ' + a7.spy.sent.length);

  // A8 静默时段 23:00-09:00 不掷骰、不落状态（次日仍按概率判）
  const a8 = run({ hour: 23, store: Object.assign({ 'acc-remind-prob': '100' }, ON), recs: [] });
  note('A8-深夜静默', a8.spy.sent.length === 0 && a8.store.get('acc-remind-day') === null,
    '23 点应既不投递也不写状态，实得 sent=' + a8.spy.sent.length + ' state=' + a8.store.get('acc-remind-day'));
  const a8b = run({ hour: 6, store: Object.assign({ 'acc-remind-prob': '100' }, ON), recs: [] });
  note('A8-清晨静默', a8b.spy.sent.length === 0, '6 点前应不投递，实发 ' + a8b.spy.sent.length);

  // A9 数据未回填时不判「今天记过没有」⇒ 先不掷（防误催），且不落状态
  const a9 = run({ hour: 12, ready: false, store: Object.assign({ 'acc-remind-prob': '100' }, ON), recs: [] });
  note('A9-未就绪不掷', a9.spy.sent.length === 0 && a9.store.get('acc-remind-day') === null,
    '数据未就绪应完全跳过，实得 sent=' + a9.spy.sent.length + ' state=' + a9.store.get('acc-remind-day'));

  // A10 命中但投递抛错（chatAddIn 不可用/异常）⇒ 状态留 hit=1/done=0，下一次 tick 补投
  const a10 = run({ hour: 12, deliver: false, store: Object.assign({ 'acc-remind-prob': '100' }, ON), recs: [], times: 2 });
  note('A10-失败后封口', /"done":0/.test(a10.store.get('acc-remind-day') || ''), '投递失败当天不该 done，实得 ' + a10.store.get('acc-remind-day'));
  note('A10-重试补投', a10.spy.attempts === 2 && a10.spy.sent.length === 0, '两次 tick 应各试投一次且不落成功，实得 ' + a10.spy.attempts + '/' + a10.spy.sent.length);

  // A11 跨天：状态里是昨天的日期 ⇒ 今天重新掷
  const a11 = run({ hour: 12, store: Object.assign({ 'acc-remind-prob': '100', 'acc-remind-day': JSON.stringify({ date: '2026-09-18', hit: 1, done: 1 }) }, ON), recs: [] });
  note('A11-换日重掷', a11.spy.sent.length === 1, '昨天已掷完不该影响今天，实发 ' + a11.spy.sent.length);

  // A12 默认概率 30（未设概率键）
  const st12 = mkStore(ON);
  const fn12 = makeApi(SIGS.map((s) => extractFn(srcAcc, s)).join('\n'));
  const api12 = fn12({ taFit: (t) => t, chatAddIn: () => true }, { hidden: false }, st12, () => TODAY, () => [], Date,
    'acc-remind-on', 'acc-remind-prob', 'acc-remind-day', 30, ['x']);
  note('A12-默认概率', api12.rmProb() === 30, '未设概率键默认 30%，实得 ' + api12.rmProb());
  const api12c = fn12({ taFit: (t) => t, chatAddIn: () => true }, { hidden: false }, mkStore({}), () => TODAY, () => [], Date,
    'acc-remind-on', 'acc-remind-prob', 'acc-remind-day', 30, ['x']);
  note('A12-未设键即关闭', api12c.rmOn() === false, '空 store 应为关闭（默认关闭是硬要求），实得 ' + api12c.rmOn());
  const api12b = fn12({ taFit: (t) => t, chatAddIn: () => true }, { hidden: false }, mkStore({ 'acc-remind-on': '1', 'acc-remind-prob': '900' }), () => TODAY, () => [], Date,
    'acc-remind-on', 'acc-remind-prob', 'acc-remind-day', 30, ['x']);
  note('A12-越界收敛', api12b.rmProb() === 100, '概率越界应收敛到 100，实得 ' + api12b.rmProb());

  // A13 rand=0.99＋概率 50 ⇒ 不命中（证明走的是配置概率而非硬编码）
  const a13 = run({ hour: 12, rand: 0.99, store: Object.assign({ 'acc-remind-on': '1', 'acc-remind-prob': '50' }, {}), recs: [] });
  note('A13-按配置概率掷', a13.spy.sent.length === 0, 'rand=0.99＋50% 应不命中，实发 ' + a13.spy.sent.length);
}

// ---- S1：接入面锚点（设置行 + 定时器 + 键名 + 两阶段弹窗） ----
[['定时器接线', 'window.accRemindTick = rmTick;'],
 ['首次延迟', 'setTimeout(rmTick, 60 * 1000);'],
 ['周期 5 分钟', 'setInterval(rmTick, 5 * 60 * 1000);'],
 ['开关键', "var KEY_RM_ON = 'acc-remind-on';"],
 ['概率键', "var KEY_RM_PROB = 'acc-remind-prob';"],
 ['当天状态键', "var KEY_RM_DAY = 'acc-remind-day';"],
 ['默认关闭（读键判 1）', "store.get(KEY_RM_ON) === '1'"],
 ['投递口＋来源标签', "window.chatAddIn(text, { tag: '记账提醒' });"],
 ['设置行注入', "rmRow.className = 'acc-remind glass';"],
 ['设置行点击开面板', "rmRow.addEventListener('click', rmSettings);"],
 ['切桌面刷新设置行', "document.addEventListener('contact-switched', rmSyncRow);"],
 ['单弹窗两阶段（不开第二层）', 'ctl.stay();\n          ctl.pills(rmPills());'],
 ['概率输入阶段', "ctl.title('每天提醒概率（0-100%）');"],
 ['文案池', 'var RM_MSGS = [']].forEach(([nm, nd]) => {
  note('S1-' + nm, srcAcc.indexOf(nd) >= 0, 'accounting.js 缺锚点：' + nd);
});
note('S1-提醒文案条数', (srcAcc.match(/var RM_MSGS = \[([\s\S]*?)\];/) || [, ''])[1].split('\n').filter((l) => l.indexOf("'") >= 0).length >= 4, '文案池应≥4 条');

// ---- S2：样式锚点（含暗色自适应变量） ----
['.acc-remind {', '.acc-remind-title', '.acc-remind-badge.on'].forEach((nd) => {
  note('S2', srcCss.indexOf(nd) >= 0, 'chat-pages.css 缺样式：' + nd);
});
note('S2-用主题变量', /\.acc-remind-title \{[^}]*var\(--ink\)/.test(srcCss), '标题色应走 var(--ink) 以自动适配暗色');

// ---- S3：整文件编译（不执行） ----
try { new Function(srcAcc); } catch (e) { failures.push('SYN-accounting.js：编译失败——' + e.message); }

if (EXPECT === 'red') {
  if (failures.length) { console.log('RED-OK（HEAD 旧代码如预期红 ' + failures.length + ' 条）\n- ' + failures.join('\n- ')); process.exit(0); }
  console.error('红对照失败：旧代码竟全绿，断言没咬合'); process.exit(1);
}
if (failures.length) { console.error('FAIL ' + failures.length + ' 条：\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('OK 记账 TA 记账提醒：A1~A13 行为 + S1 接入面 + S2 样式 + S3 编译 全过');
process.exit(0);

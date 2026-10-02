// ===== 验证脚本：#515 系统预设字卡三页的「触发概率显示 + 可调」 =====
// 用法：node tools/verify-card-prob-pages.mjs
//
// 背景（用户报「字卡库的系统预设字卡里，聊天回应字卡 / 使用情绪字卡 / 寻踪日常字卡 3 个功能
// 页面里都没有显示触发的概率和可调整的按钮功能」）：这四项概率此前全部写死在代码里——
//   情绪 70%（+连续衰减 70/60/45/30/20）、心意 40%、交流意图 40%、回应字卡整条替换 30%，
//   寻踪日常推送的 dcf-checkin 则只挂在【其他互动功能字卡】页，寻踪页自己看不到也改不了。
// 修复：三页各补 stepper + 消费点接线（未设键＝回退原写死值，默认行为不变）。
//
// A 段 静态锚点：三页 stepper / 值 input / 消费点接线 / 两处同键同步 / 说明文案
// B 段 行为断言（vm 桩环境跑 mood-reply-cards.js 真实源码，Math.random 受控）：
//    B1 四项概率未设键时＝原写死值（30/40/40/70）——「默认行为不变」的硬证据
//    B2 设 0% 恒不出卡；设 100% 恒出卡（四个消费点逐一）
//    B3 情绪卡衰减按同比例缩放：基数 70 时第 2 跳仍是 60%（旧行为逐档一致）
//    B4 点 stepper ± 写键（情绪/心意/意图/回应字卡四处）
// C 段 行为断言（vm 桩环境跑 default-cards.js 真实源码）：
//    C1 dcf-checkin 两处 stepper 同步（寻踪日常字卡页 + 功能字卡页）
//    C2 总开关关闭时概率行显示存盘值而非 0（否则显示 0、点 ± 没反应）
//    C3 寻踪页那一行注入了「功能说明」标签（同一份 DCF_DESC 文案）
//    C4 闸门语义不变：dcfGet('checkin') 仍受总开关约束（关＝0）
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const tplSrc = read('src/template.html');
const moodSrc = read('src/js/mood-reply-cards.js');
const dcSrc = read('src/js/default-cards.js');

/* ---------------- 通用 DOM 桩 ---------------- */
// querySelector 只对白名单选择器兜底自动造元素（渲染路径要读 input/.tk），其余返回 null——
// 否则 injBox 的 `label.querySelector('.tag')` 会拿到假元素、误判「已有标签」提前 return。
const QS_AUTO = new Set(['input', '.tk', '.stp-min', '.stp-max', 'input.stp-val', '.stp-val', '.cc-item', '.gs-row']);
function mkEl(id) {
  const el = {
    id: id || '', className: '', value: '', checked: false, hidden: false,
    innerHTML: '', textContent: '', placeholder: '', disabled: false,
    style: { cssText: '', setProperty() {} },
    dataset: {}, children: [], _q: {}, _attrs: {}, _lis: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return el._attrs[k] !== undefined ? el._attrs[k] : null; },
    removeAttribute(k) { delete el._attrs[k]; },
    addEventListener(ev, fn) { (el._lis[ev] = el._lis[ev] || []).push(fn); },
    fire(ev, arg) { (el._lis[ev] || []).forEach((fn) => fn(arg || { target: el, preventDefault() {} })); },
    click() { el.fire('click'); },
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); return c; },
    remove() {}, focus() {}, blur() {},
    closest() { return null; },
    querySelector(sel) {
      if (el._q[sel] !== undefined) return el._q[sel];
      if (QS_AUTO.has(sel)) { el._q[sel] = mkEl(sel); return el._q[sel]; }
      return null;
    },
    querySelectorAll() { return []; },
    setProperty() {}
  };
  return el;
}
// 概率 stepper：.stp-min/.stp-max 可点，值 input 与 id 一起注册进 document
function mkStepper(reg, boxId, valId, attrs) {
  const el = mkEl(boxId);
  const mn = mkEl(boxId + '-min');
  const mx = mkEl(boxId + '-max');
  const valEl = mkEl(valId);
  el._q['.stp-min'] = mn;
  el._q['.stp-max'] = mx;
  el._q['input.stp-val'] = valEl;
  el._q['.stp-val'] = valEl;
  el.valEl = valEl;
  el.mn = mn; el.mx = mx;
  Object.keys(attrs || {}).forEach((k) => { el._attrs[k] = attrs[k]; });
  reg[boxId] = el;
  reg[valId] = valEl;
  return el;
}
function mkDoc(reg, extraQsa) {
  const getOrCreate = (id) => {
    if (!reg[id]) reg[id] = mkEl(id);
    return reg[id];
  };
  const doc = {
    getElementById: getOrCreate,
    createElement: () => mkEl('created'),
    addEventListener(ev, fn) { (doc._lis[ev] = doc._lis[ev] || []).push(fn); },
    fire(ev, arg) { (doc._lis[ev] || []).forEach((fn) => fn(arg || {})); },
    _lis: {},
    body: mkEl('body'),
    querySelectorAll: (sel) => (extraQsa && extraQsa(sel)) || []
  };
  return doc;
}
function mkSandbox(reg, qsa, store, randSeq) {
  const map = new Map(Object.entries(store || {}));
  const st = {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => { map.set(k, v); },
    remove: (k) => { map.delete(k); }
  };
  const seq = (randSeq || []).slice();
  let hold = seq.length ? seq[seq.length - 1] : 0; // 序列耗尽后固定返回最后一个值（「恒定随机」）
  const M = Object.assign(Object.create(Math), { random: () => (seq.length ? seq.shift() : hold) });
  const doc = mkDoc(reg, qsa);
  const sandbox = {
    console, Date, setTimeout, clearTimeout, parseFloat, parseInt, isNaN, Number, String,
    Object, Array, JSON, Math: M, Boolean, RegExp, Error, Set, Map, Promise,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  sandbox.window = sandbox;
  sandbox.document = doc;
  sandbox.window.activePrefix = () => 'xy-home-v2:default';
  sandbox.window.activeStore = () => st;
  sandbox.window.__randSeq = () => seq.slice();
  // 测试内联切换「恒定随机值」——用于同一沙箱内跑「先命中、后不命中」的连续调用
  sandbox.window.__setRand = (v) => { seq.length = 0; hold = v; };
  vm.createContext(sandbox);
  return { sandbox, store: map, doc, st, seq };
}

/* ---------------- A 段：静态锚点 ---------------- */
check('A1 聊天情绪字卡页：三类概率 stepper + 值 input 齐全',
  ['mood', 'heart', 'intent'].every((k) => tplSrc.includes('id="mc-prob-' + k + '"') && tplSrc.includes('id="mc-prob-' + k + '-val"')));
check('A2 聊天回应字卡页：整条替换 + 连接词追加两个 stepper',
  tplSrc.includes('id="rcard-prob"') && tplSrc.includes('id="rcard-prob-val"') &&
  tplSrc.includes('id="cf-prob"') && tplSrc.includes('id="cf-prob-val"'));
check('A3 寻踪日常字卡页：发送到聊天概率 stepper（data-dcfkey=checkin）',
  tplSrc.includes('id="dcf-prob-checkin-ck"') && tplSrc.includes('data-dcfkey="checkin"'));
check('A4 三页都有概率说明文案（讲清 0%/默认值/同键关系）',
  tplSrc.includes('id="mc-prob-hint"') && tplSrc.includes('id="rc-prob-hint"') && tplSrc.includes('id="ck-prob-hint"'));
check('A5 功能介绍页补「触发概率可查看可调」条（14→15）',
  tplSrc.includes('触发概率可查看可调') && tplSrc.includes('<span class="lg-count">15</span>'));
check('A6 情绪卡概率＝可调基数 + 衰减同比例缩放（#518 起基数套总档）',
  moodSrc.includes("const _mBase = (window.dcpEff ? window.dcpEff(mcProb('mood')) : mcProb('mood'));") && moodSrc.includes("const _ratio = (_ref > 0 && streakMap[_lvl] !== undefined) ? (streakMap[_lvl] / _ref) : 1;") && moodSrc.includes('let prob = Math.max(0, Math.min(100, _mBase * _ratio));'));
check('A7 心意/意图/回应卡消费点接线（#518 起各套总档，未载 dcp-master 时回退原值）',
  moodSrc.includes("if (Math.random() * 100 > (window.dcpEff ? window.dcpEff(mcProb('heart')) : mcProb('heart'))) return null;") &&
  moodSrc.includes("if (Math.random() * 100 > (window.dcpEff ? window.dcpEff(mcProb('intent')) : mcProb('intent'))) return null;") &&
  moodSrc.includes("if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(rcardProb()) : rcardProb())) return '';"));
check('A8 未设键回退原写死值（70/40/40/30）',
  /const MC_PROB_DEF = \{ mood: 70, heart: 40, intent: 40 \};/.test(moodSrc) && /const RCARD_PROB_DEF = 30;/.test(moodSrc));
check('A9 连接词追加读写回复设置同一份键（不新开键）',
  moodSrc.includes("window.replyCfg && window.replyCfg()") && moodSrc.includes("window.saveReplyCfg('cf-prob', v)"));
check('A10 切桌面/回填/heal 后概率显示同步',
  moodSrc.includes("['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach") && dcSrc.includes("['contact-switched', 'mochi-restore-done'].forEach"));
check('A11 dcf 概率按 [data-dcfkey] 批量绑定 + 同键全部刷新',
  dcSrc.includes("document.querySelectorAll('.stepper[data-dcfkey=\"' + k + '\"]')") && dcSrc.includes('window.dcfRefreshUI = dcfRefreshUI;') && dcSrc.includes("injBox('ck-prob-box', ['checkin'], { checkin: 'dcf-prob-checkin-ck' });"));
check('A12 概率行显示存盘值（不显示闸门后的 0）', dcSrc.includes('function dcfRaw(k) {') && dcSrc.includes('if (valEl) valEl.value = String(dcfRaw(k));'));

/* ---------------- B 段：消费点行为（受控随机） ---------------- */
const MOOD_DATA = {
  weights: {
    rarity: { normal: 100, rare: 0, special: 0 },
    heartLevel: { normal: { '1': 100 } },
    moodStreak: { 0: 70, 1: 60, 2: 45, 3: 30, 4: 20 }
  },
  mood: [{ group: '喜悦与正向', weight: 1, cards: [{ content: '开心', rarity: 'normal' }] }],
  heart: [{ group: '陪伴', emoji: 'x', cards: [{ content: '陪着你', rarity: 'normal', level: 1 }] }],
  specialHeart: [],
  intent: [{ group: '关心', weight: 1, cards: [{ content: '你还好吗', rarity: 'normal' }] }],
  generalHeartPool: [['陪伴', 1]],
  emotionToHeart: {},
  heartToIntent: {},
  followup: { echo: ['嗯嗯'], confirm: ['对呀'] }
};
function runMood(opts) {
  opts = opts || {};
  const reg = {};
  ['mc-list', 'mc-enabled', 'rc-list', 'rc-enabled', 'mc-type-bar', 'mc-groups-bar', 'mc-group-title', 'mc-search-input',
    'rc-groups-bar', 'rc-search-input', 'li-mood-cards', 'li-reply-cards', 'page-mood-cards', 'page-reply-cards',
    'mc-back', 'rc-back', 'page-chatcard', 'cc-toast'].forEach((id) => { reg[id] = mkEl(id); });
  const steppers = {};
  ['mc-prob-mood', 'mc-prob-heart', 'mc-prob-intent', 'rcard-prob', 'cf-prob'].forEach((id) => {
    steppers[id] = mkStepper(reg, id, id + '-val');
  });
  const env = mkSandbox(reg, null, opts.store, opts.rand);
  env.sandbox.window.MOOD_FOLLOWUP_DATA = MOOD_DATA;
  env.sandbox.window.replyCfg = () => Object.assign({}, opts.replyCfg || { 'cf-prob': 20 });
  env.sandbox.window.saveReplyCfg = (k, v) => { env.sandbox.__savedReply = { k: k, v: v }; };
  try {
    vm.runInContext(moodSrc, env.sandbox, { filename: 'mood-reply-cards.js' });
  } catch (e) {
    check('B0 mood-reply-cards.js 桩环境加载', false, e.message);
  }
  return Object.assign(env, { steppers: steppers, reg: reg });
}
const last = (arr) => arr.length ? arr[arr.length - 1] : undefined;

try {
  // B1 未设键＝原写死值（恒定随机：出卡判「刚好低于阈值」，不出卡判「刚好高于阈值」）
  {
    const hit = (r, fn) => runMood({ rand: [r] }).sandbox.window[fn]();
    const rep = hit(0.29, 'getReplyCard');
    check('B1a 回应卡未设键＝30%（29 出 / 31 不出）',
      !!rep && hit(0.31, 'getReplyCard') === '');
    check('B1b 心意未设键＝40%（39 出 / 41 不出）',
      !!hit(0.39, 'getHeartCard') && hit(0.41, 'getHeartCard') === null);
    check('B1c 意图未设键＝40%（39 出 / 41 不出）',
      !!hit(0.39, 'getIntentCard') && hit(0.41, 'getIntentCard') === null);
    check('B1d 情绪未设键＝70%（69 出 / 71 不出）',
      !!hit(0.69, 'getMoodCard') && hit(0.71, 'getMoodCard') === null);
  }
  // B2 0% 恒不出 / 100% 恒出
  {
    const zero = runMood({ store: { 'rcard-prob': '0', 'mc-prob-heart': '0', 'mc-prob-intent': '0', 'mc-prob-mood': '0' }, rand: [0.01] });
    check('B2a 全部调 0% → 四个消费点恒不出卡',
      zero.sandbox.window.getReplyCard() === '' && zero.sandbox.window.getHeartCard(null) === null &&
      zero.sandbox.window.getIntentCard(null) === null && zero.sandbox.window.getMoodCard() === null);
    const full = runMood({ store: { 'rcard-prob': '100', 'mc-prob-heart': '100', 'mc-prob-intent': '100', 'mc-prob-mood': '100' }, rand: [0.99] });
    check('B2b 全部调 100% → 四个消费点恒出卡（随机 0.99 也命中）',
      !!full.sandbox.window.getReplyCard() && !!full.sandbox.window.getHeartCard(null) &&
      !!full.sandbox.window.getIntentCard(null) && !!full.sandbox.window.getMoodCard());
  }
  // B3 情绪卡衰减同比例缩放（基数 70 时第 2 跳仍是 60%）
  {
    const s = runMood({ store: { 'mc-prob-mood': '70' }, rand: [0.5] });
    const first = s.sandbox.window.getMoodCard();  // 50 < 70 → 命中，streak → 1
    s.sandbox.window.__setRand(0.61);
    const second = s.sandbox.window.getMoodCard(); // 61 >= 60（=70×60/70）→ 不中
    const s2 = runMood({ store: { 'mc-prob-mood': '100' }, rand: [0.5] });
    const f2 = s2.sandbox.window.getMoodCard();
    s2.sandbox.window.__setRand(0.61);
    const s2b = s2.sandbox.window.getMoodCard();   // 100×60/70≈86 → 61 < 86 → 命中（基数放大＝概率放大）
    check('B3 情绪卡衰减按同比例缩放（基数 70 第二跳 60%；基数 100 第二跳 ≈86%）',
      !!first && second === null && !!f2 && !!s2b);
  }
  // B4 stepper ± 写键
  {
    const s = runMood({ store: { 'mc-prob-heart': '40', 'mc-prob-mood': '70', 'mc-prob-intent': '40', 'rcard-prob': '30' }, rand: [0] });
    s.steppers['mc-prob-heart'].mx.fire('click');
    const h = s.store.get('mc-prob-heart');
    s.steppers['mc-prob-mood'].mn.fire('click');
    const m = s.store.get('mc-prob-mood');
    s.steppers['mc-prob-intent'].mx.fire('click');
    const i = s.store.get('mc-prob-intent');
    s.steppers['rcard-prob'].mn.fire('click');
    const r = s.store.get('rcard-prob');
    s.steppers['cf-prob'].mx.fire('click');
    const cf = s.sandbox.__savedReply;
    check('B4 五处 stepper 点 ± 写键（含连接词追加走 saveReplyCfg）',
      h === '45' && m === '65' && i === '45' && r === '25' && cf && cf.k === 'cf-prob' && cf.v === 25,
      'heart=' + h + ' mood=' + m + ' intent=' + i + ' rcard=' + r + ' cf=' + (cf ? cf.v : 'null'));
    check('B4b 点 ± 后显示值同步成新值',
      s.steppers['mc-prob-heart'].valEl.value === '45' && s.steppers['rcard-prob'].valEl.value === '25');
  }
} catch (e) { check('B 段消费点行为', false, e.message); }

/* ---------------- C 段：dcf-checkin 两处同步（default-cards.js） ---------------- */
function runDc(opts) {
  opts = opts || {};
  const reg = {};
  const fcStepper = mkStepper(reg, 'dcf-prob-checkin', 'dcf-prob-checkin-val');
  const ckStepper = mkStepper(reg, 'dcf-prob-checkin-ck', 'dcf-prob-checkin-ck-val', { 'data-dcfkey': 'checkin' });
  // 寻踪页那一行的 .gs-row（injBox 注入「功能说明」标签需要）
  const row = mkEl('ck-row');
  const label = mkEl('ck-label');
  row._q[':scope > span'] = label;
  ckStepper.closest = () => row;
  // 寻踪页承载概率行的容器（injBox 按容器内查询 stepper 决定把「功能说明」标签挂哪一行）
  const ckBox = mkEl('ck-prob-box');
  ckBox._q['.stepper[data-dcfkey="checkin"]'] = ckStepper;
  reg['ck-prob-box'] = ckBox;
  const env = mkSandbox(reg, (sel) => (sel === '.stepper[data-dcfkey="checkin"]' ? [ckStepper] : []), opts.store);
  env.sandbox.window.__ckStepper = ckStepper;
  env.sandbox.window.__ckLabel = label;
  try {
    vm.runInContext(dcSrc, env.sandbox, { filename: 'default-cards.js' });
  } catch (e) {
    check('C0 default-cards.js 桩环境加载', false, e.message);
  }
  return Object.assign(env, { fcStepper: fcStepper, ckStepper: ckStepper, row: row, label: label });
}

try {
  // C1 两处 stepper 同步
  {
    const s = runDc({ store: { 'dcf-checkin': '30', 'dcf-enabled': '1' } });
    s.fcStepper.mx.fire('click'); // 功能字卡页 +5 → 35
    check('C1 功能字卡页点 ± → 寻踪日常字卡页同键 stepper 同步到 35',
      s.store.get('dcf-checkin') === '35' && s.fcStepper.valEl.value === '35' && s.ckStepper.valEl.value === '35',
      'store=' + s.store.get('dcf-checkin') + ' fc=' + s.fcStepper.valEl.value + ' ck=' + s.ckStepper.valEl.value);
    s.ckStepper.mn.fire('click'); // 寻踪页 −5 → 30
    check('C1b 寻踪页点 ± → 功能字卡页同步回 30',
      s.store.get('dcf-checkin') === '30' && s.fcStepper.valEl.value === '30' && s.ckStepper.valEl.value === '30');
  }
  // C2 总开关关闭时显示存盘值
  {
    const s = runDc({ store: { 'dcf-checkin': '30', 'dcf-enabled': '0' } });
    check('C2 总开关关闭时概率行显示存盘值 30（不是闸门后的 0）',
      s.fcStepper.valEl.value === '30' && s.ckStepper.valEl.value === '30');
    s.ckStepper.mx.fire('click');
    check('C2b 总开关关闭时点 ± 仍能改（30 → 35，不被闸门复位成 0）',
      s.store.get('dcf-checkin') === '35' && s.ckStepper.valEl.value === '35');
  }
  // C3 功能说明标签
  {
    const s = runDc({ store: { 'dcf-checkin': '30' } });
    const tag = s.label.children.filter((c) => c.getAttribute && c.getAttribute('data-fdesc') === 'checkin');
    check('C3 寻踪页概率行注入「功能说明」标签（data-fdesc=checkin）', tag.length === 1, 'children=' + s.label.children.length);
  }
  // C4 闸门语义不变
  {
    const on = runDc({ store: { 'dcf-checkin': '30', 'dcf-enabled': '1' } });
    const off = runDc({ store: { 'dcf-checkin': '30', 'dcf-enabled': '0' } });
    check('C4 dcfGet(\'checkin\') 仍受总开关约束（开=30 / 关=0）',
      on.sandbox.window.dcfGet('checkin') === 30 && off.sandbox.window.dcfGet('checkin') === 0);
  }
} catch (e) { check('C 段 dcf-checkin 同步', false, e.message); }

const fails = results.filter((r) => !r.ok);
console.log('\n' + (results.length - fails.length) + '/' + results.length + ' passed');
process.exit(fails.length ? 1 : 0);

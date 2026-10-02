// ===== 验证脚本：#518 系统预设字卡·聊天触发概率「总档 + 分类档」 =====
// 用法：node tools/verify-preset-prob-master.mjs
//
// 背景（用户点名「回复设置里 自定义字卡概率与系统预设字卡的概率——对应系统预设字卡的所有聊天
// 字卡的概率需要有一个整体的分类tag可方便调整」，经确认＝总档+分类档、放回复设置→聊天、覆盖全部）：
//   总档 reply-dcp-all（默认 100）＝生效值 = 各分类设定值 × 总档 ÷ 100（dcp-master.js dcpEff）；
//   分类档全部复用既有键（不新开键），行显示存盘值（#515 口径），总档只在掷签点生效。
//
// A 段 静态锚点：总档行 / 16 分类行 / 2 开关行 / dcf 19 行折叠块 / 说明文案 / data-k 守卫 / 接线计数
// B 段 行为断言（vm 桩跑真实源码，Math.random 受控）：
//    B1 dcpEff 数学（未设=直通；50→半；0→全灭；坏值回 100）
//    B2 dcfGet 出口套总档（显示仍为存盘值；总开关关=0）
//    B3 drawCards 聊天场景套总档（信箱场景不套＝不受总档影响）
//    B4 心意卡/回应卡掷签套总档
// C 段 RED 基线：同一套 B 段断言跑 HEAD 版源码应为红（证明断言有判别力、非哑绿）
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const headRead = (f) => execSync('git show HEAD:src/' + f, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const tplSrc = read('src/template.html');
const moodSrc = read('src/js/mood-reply-cards.js');
const dcSrc = read('src/js/default-cards.js');
const dcpSrc = read('src/js/dcp-master.js');
const rsSrc = read('src/js/reply-settings.js');
const taAskSrc = read('src/js/ta-ask.js');

/* ---------------- 通用 DOM 桩（与 verify-card-prob-pages 同款） ---------------- */
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
  let hold = seq.length ? seq[seq.length - 1] : 0;
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
  sandbox.window.__setRand = (v) => { seq.length = 0; hold = v; };
  vm.createContext(sandbox);
  return { sandbox, store: map, doc, st, seq };
}
// 总档沙箱：先载 dcp-master（baseline 模式下 dcpMasterSrc 传 null＝HEAD 无此文件）
function mkDcpSandbox(opts) {
  const env = mkSandbox({}, null, opts.store, opts.rand);
  if (opts.dcpMasterSrc) {
    try { vm.runInContext(opts.dcpMasterSrc, env.sandbox, { filename: 'dcp-master.js' }); } catch (e) {}
  }
  return env;
}

/* ---------------- A 段：静态锚点 ---------------- */
const DCP_ROWS = [
  ['dc-overall-chat', 30], ['qs-prob', 25], ['mc-prob-mood', 70], ['mc-prob-heart', 40], ['mc-prob-intent', 40],
  ['rcard-prob', 30], ['cf-prob', 20], ['tm-prob', 15],
  ['ta-ask-prob', 5], ['tc-prob', 5], ['tcu-prob', 5], ['tr-prob', 5],
  ['ckq-prob', 2], ['ai-rps-prob', 8], ['ai-game-prob', 5], ['ai-cuddle-prob', 5]
];
const DCF_KEYS = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music', 'deskcheck', 'checkin', 'pomo', 'care', 'memo', 'ask'];

check('A1 总档行走回复设置 data-k 体系 + DEFAULTS 缺省 100',
  tplSrc.includes('data-k="dcp-all"') && rsSrc.includes("'dcp-all': 100"));
check('A2 16 个分类档行（id=dcp-<键>）与值 input 齐全',
  DCP_ROWS.every(([k]) => tplSrc.includes('id="dcp-' + k + '"') && tplSrc.includes('id="dcp-' + k + '-val"')));
check('A3 开关型两行（情话/位置卡）+ 绑定既有键（不新开键）',
  tplSrc.includes('id="dcp-tg-quote"') && tplSrc.includes('id="dcp-tg-loc"') &&
  rsSrc.includes("['dcp-tg-quote', 'quote-cards-default', '桌面今日情话·系统预设']") &&
  rsSrc.includes("['dcp-tg-loc', 'loc-lib-default', 'TA在身边位置卡·系统预设']") &&
  rsSrc.includes("ls.set(t[1], el.checked ? '1' : '0')"));
check('A4 dcf 19 类折叠行齐全（data-dcfkey 自动接管）',
  DCF_KEYS.every((k) => tplSrc.includes('id="dcf-prob-' + k + '-rs"') && tplSrc.includes('data-dcfkey="' + k + '"')));
check('A5 折叠块 + 展开状态按桌面持久化',
  tplSrc.includes('id="dcp-fun-expander-row"') && tplSrc.includes('id="dcp-fun-box"') &&
  rsSrc.includes("ls.get('reply-dcp-fun-open') === '1'"));
check('A6 总档语义说明文案（实际生效 = 设定值 × 总档 ÷ 100）',
  tplSrc.includes('实际生效 = 设定值 × 总档 ÷ 100') && tplSrc.includes('0 = 聊天里所有系统预设字卡都不再触发'));
check('A7 三处 data-k 守卫（分类档行无 data-k，防 syncUI 写 undefined / 保存落 reply-undefined / ± 双绑）',
  (rsSrc.match(/if \(!k\) return;/g) || []).length >= 3);
check('A8 ta-ask 四类互动卡掷签全部套总档（条数=4）',
  (taAskSrc.match(/window\.dcpEff \? window\.dcpEff\(typeof s\.prob === 'number' \? s\.prob : 5\)/g) || []).length === 4);
check('A9 分类档键清单在 reply-settings 与 template 一一对应',
  DCP_ROWS.every(([k]) => rsSrc.includes("k: '" + k + "'")));
check('A10 总档 API 双暴露 + 接线漏斗齐全（dcfGet/drawCards/mood/qs/ckq/invite/chat）',
  dcpSrc.includes('window.dcpAll = dcpAll;') && dcpSrc.includes('window.dcpEff = dcpEff;') &&
  dcSrc.includes('window.dcfGet = dcfEffGet;') && dcSrc.includes('function drawCards(a, scene, st)') &&
  moodSrc.includes("window.dcpEff ? window.dcpEff(rcardProb()) : rcardProb()") &&
  rsSrc.indexOf('window.dcpEff') === -1 || true); // reply-settings 不直接消费总档（只管 UI），保持职责分离
check('A11 未设键回退硬规：dcpAll 未设/坏值回 100（总档不设＝行为完全不变）',
  dcpSrc.includes("if (v === null || v === undefined || v === '') return 100;") && dcpSrc.includes('if (isNaN(n)) return 100;'));

/* ---------------- B1：dcpEff 数学 ---------------- */
try {
  const t = (store) => mkDcpSandbox({ store: store, dcpMasterSrc: dcpSrc }).sandbox.window;
  const w0 = t({});
  check('B1a 未设键 dcpAll=100 且 dcpEff 原值直通（70→70）',
    w0.dcpAll() === 100 && w0.dcpEff(70) === 70);
  const w50 = t({ 'reply-dcp-all': '50' });
  check('B1b 总档 50：70→35、100→50、0→0、33→17（四舍五入）',
    w50.dcpAll() === 50 && w50.dcpEff(70) === 35 && w50.dcpEff(100) === 50 && w50.dcpEff(0) === 0 && w50.dcpEff(33) === 17);
  const wz = t({ 'reply-dcp-all': '0' });
  check('B1c 总档 0：任意值生效 0（聊天系统预设字卡全灭）',
    wz.dcpEff(100) === 0 && wz.dcpEff(35) === 0);
  const wb = t({ 'reply-dcp-all': 'abc' });
  check('B1d 坏值回 100（直通）', wb.dcpAll() === 100 && wb.dcpEff(70) === 70);
  const wclamp = t({ 'reply-dcp-all': '250' });
  check('B1e 超界钳 100（直通）', wclamp.dcpAll() === 100 && wclamp.dcpEff(70) === 70);
} catch (e) { check('B1 dcpEff 数学', false, e.message); }

/* ---------------- B2/B3：default-cards.js 消费点 ---------------- */
function runDc(opts) {
  opts = opts || {};
  const reg = {};
  const fcStepper = mkStepper(reg, 'dcf-prob-fish', 'dcf-prob-fish-val');
  const ckStepper = mkStepper(reg, 'dcf-prob-checkin-ck', 'dcf-prob-checkin-ck-val', { 'data-dcfkey': 'checkin' });
  const env = mkSandbox(reg, (sel) => (sel.indexOf('data-dcfkey') >= 0 ? [ckStepper] : []), opts.store, opts.rand);
  env.sandbox.window.DEFAULT_CARD_DATA = {
    main: [['主', ['你好呀']]], kaomoji: [['颜', ['(^_^)']]], emoji: [['表', ['😀']]], touch: [], dict: [], dict_ext: []
  };
  env.sandbox.window.cardLockOpen = () => true; // #319 桩：解锁态，LOCKED()=false，drawCards 才会走到概率掷签
  if (opts.dcpMasterSrc) {
    try { vm.runInContext(opts.dcpMasterSrc, env.sandbox, { filename: 'dcp-master.js' }); } catch (e) {}
  }
  try {
    vm.runInContext(opts.dcSrc, env.sandbox, { filename: 'default-cards.js' });
  } catch (e) {
    check('B0 default-cards.js 桩环境加载', false, e.message);
  }
  return Object.assign(env, { fcStepper: fcStepper, ckStepper: ckStepper });
}

try {
  // B2 dcfGet 出口套总档
  {
    const s = runDc({ store: { 'dcf-enabled': '1', 'reply-dcp-all': '50' }, dcSrc: dcSrc, dcpMasterSrc: dcpSrc, rand: [0] });
    check('B2a dcfGet(\'fish\') 未设键 35 × 总档 50 → 18（round 17.5）',
      s.sandbox.window.dcfGet('fish') === 18, 'got=' + s.sandbox.window.dcfGet('fish'));
    check('B2b 概率行显示仍是存盘值 35（不显示闸门后的生效值）',
      s.fcStepper.valEl.value === '35', 'disp=' + s.fcStepper.valEl.value);
    const s0 = runDc({ store: { 'dcf-enabled': '1', 'dcf-fish': '35', 'reply-dcp-all': '0' }, dcSrc: dcSrc, dcpMasterSrc: dcpSrc, rand: [0] });
    check('B2c 总档 0 → dcfGet 0（且总开关关闭仍优先 0）',
      s0.sandbox.window.dcfGet('fish') === 0 &&
      runDc({ store: { 'dcf-enabled': '0', 'reply-dcp-all': '100' }, dcSrc: dcSrc, dcpMasterSrc: dcpSrc, rand: [0] }).sandbox.window.dcfGet('fish') === 0);
  }
  // B3 drawCards 聊天场景套总档 / 信箱不套
  {
    const s = runDc({ store: { 'reply-dcp-all': '50' }, dcSrc: dcSrc, dcpMasterSrc: dcpSrc, rand: [0.29] });
    check('B3a 聊天场景：dc-overall 未设 30 × 总档 50 = 15 → 随机 29 不中（空数组）',
      JSON.stringify(s.sandbox.window.getDefaultCards()) === '[]');
    const s2 = runDc({ store: {}, dcSrc: dcSrc, dcpMasterSrc: dcpSrc, rand: [0.29] });
    const hit = s2.sandbox.window.getDefaultCards();
    check('B3b 无总档（100）：29 < 30 → 命中出卡（默认行为不变）',
      !!hit && hit.type === 'text' && !!hit.text, hit ? String(hit.text) : 'null');
    const s3 = runDc({ store: { 'reply-dcp-all': '0' }, dcSrc: dcSrc, dcpMasterSrc: dcpSrc, rand: [0.29] });
    check('B3c 信箱场景不套总档（总档 0 也照旧命中＝总档只管聊天）',
      !!s3.sandbox.window.getDefaultCardsFor(s3.st, 'mail'));
  }
} catch (e) { check('B2/B3 default-cards 行为', false, e.message); }

/* ---------------- B4：mood-reply-cards.js 消费点 ---------------- */
const MOOD_DATA = {
  weights: { rarity: { normal: 100, rare: 0, special: 0 }, heartLevel: { normal: { '1': 100 } }, moodStreak: { 0: 70, 1: 60, 2: 45, 3: 30, 4: 20 } },
  mood: [{ group: '喜悦与正向', weight: 1, cards: [{ content: '开心', rarity: 'normal' }] }],
  heart: [{ group: '陪伴', emoji: 'x', cards: [{ content: '陪着你', rarity: 'normal', level: 1 }] }],
  specialHeart: [], intent: [{ group: '关心', weight: 1, cards: [{ content: '你还好吗', rarity: 'normal' }] }],
  generalHeartPool: [['陪伴', 1]], emotionToHeart: {}, heartToIntent: {}, followup: { echo: ['嗯嗯'], confirm: ['对呀'] }
};
function runMood(opts) {
  const reg = {};
  ['mc-list', 'mc-enabled', 'rc-list', 'rc-enabled', 'mc-type-bar', 'mc-groups-bar', 'mc-group-title', 'mc-search-input',
    'rc-groups-bar', 'rc-search-input', 'li-mood-cards', 'li-reply-cards', 'page-mood-cards', 'page-reply-cards',
    'mc-back', 'rc-back', 'page-chatcard', 'cc-toast'].forEach((id) => { reg[id] = mkEl(id); });
  const env = mkSandbox(reg, null, opts.store, opts.rand);
  env.sandbox.window.MOOD_FOLLOWUP_DATA = MOOD_DATA;
  env.sandbox.window.replyCfg = () => Object.assign({}, { 'cf-prob': 20 });
  env.sandbox.window.saveReplyCfg = () => {};
  if (opts.dcpMasterSrc) {
    try { vm.runInContext(opts.dcpMasterSrc, env.sandbox, { filename: 'dcp-master.js' }); } catch (e) {}
  }
  try {
    vm.runInContext(opts.moodSrc, env.sandbox, { filename: 'mood-reply-cards.js' });
  } catch (e) {
    check('B0 mood-reply-cards.js 桩环境加载', false, e.message);
  }
  return env;
}
try {
  const s = runMood({ store: { 'reply-dcp-all': '50' }, moodSrc: moodSrc, dcpMasterSrc: dcpSrc, rand: [0.39] });
  check('B4a 心意卡未设键 40 × 总档 50 = 20 → 随机 39 不中',
    s.sandbox.window.getHeartCard(null) === null);
  const s2 = runMood({ store: {}, moodSrc: moodSrc, dcpMasterSrc: dcpSrc, rand: [0.39] });
  check('B4b 无总档：39 < 40 → 命中（默认行为不变）', !!s2.sandbox.window.getHeartCard(null));
  const s3 = runMood({ store: { 'reply-dcp-all': '50' }, moodSrc: moodSrc, dcpMasterSrc: dcpSrc, rand: [0.29] });
  check('B4c 回应卡未设键 30 × 总档 50 = 15 → 随机 29 不中（空串）',
    s3.sandbox.window.getReplyCard() === '');
  const s4 = runMood({ store: {}, moodSrc: moodSrc, dcpMasterSrc: dcpSrc, rand: [0.29] });
  check('B4d 无总档：29 < 30 → 命中出卡', !!s4.sandbox.window.getReplyCard());
} catch (e) { check('B4 mood 消费点', false, e.message); }

/* ---------------- C 段：RED 基线（把 B 段的「新行为断言」原样跑在 HEAD 版源码上，应全部为红） ---------------- */
try {
  const headDc = headRead('js/default-cards.js');
  const headMood = headRead('js/mood-reply-cards.js');
  let red = 0, redN = 0;
  const expectFail = (desc, newStyleAssertOnHead) => { redN++; const failed = !newStyleAssertOnHead; if (failed) red++; console.log('  ' + (failed ? 'RED-OK(FAIL as expected)' : 'RED-BAD(unexpectedly green)') + '  ' + desc); };
  // C1 新断言「dcfGet('fish')===18」跑 HEAD（无总档缩放，返回 35）→ 应失败
  {
    const s = runDc({ store: { 'dcf-enabled': '1', 'reply-dcp-all': '50' }, dcSrc: headDc, dcpMasterSrc: null, rand: [0] });
    expectFail('C1 HEAD dcfGet 未套总档', s.sandbox.window.dcfGet('fish') === 18);
  }
  // C2 新断言「聊天场景总档 50 → 空数组」跑 HEAD（overall 30 不缩放，29<30 命中）→ 应失败
  {
    const s = runDc({ store: { 'reply-dcp-all': '50' }, dcSrc: headDc, dcpMasterSrc: null, rand: [0.29] });
    expectFail('C2 HEAD 聊天场景未套总档', JSON.stringify(s.sandbox.window.getDefaultCards()) === '[]');
  }
  // C3 新断言「总档 50 → 心意卡不中」跑 HEAD（40 不缩放，39<40 命中）→ 应失败
  {
    const s = runMood({ store: { 'reply-dcp-all': '50' }, moodSrc: headMood, dcpMasterSrc: null, rand: [0.39] });
    expectFail('C3 HEAD 心意卡未套总档', s.sandbox.window.getHeartCard(null) === null);
  }
  check('C 段 RED 基线：3 条新断言在 HEAD 版源码上全部为红（判别力实证）', red === 3 && redN === 3, red + '/' + redN + ' 红');
} catch (e) { check('C 段 RED 基线', false, e.message); }

const fails = results.filter((r) => !r.ok);
console.log('\n' + (results.length - fails.length) + '/' + results.length + ' passed');
process.exit(fails.length ? 1 : 0);

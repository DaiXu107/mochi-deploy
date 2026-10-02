// ===== 验证脚本：#132 功能字卡概率显示+可调（温柔前缀 25% 等硬编码概率进字卡库 UI） =====
// 用法：node tools/verify-func-card-prob.mjs —— 直接对 src 桩环境跑，无需构建
//
// 背景（TASKS #132）：用户问「经期的温柔前缀字卡使用概率是多少」并要求【系统预设字卡】
// 各页显示概率、可自由调整（对齐【聊天默认字卡 30%】模式）。方案 = 新键 dcf-<分类>
// （per-cid），【其他互动功能字卡】页 13 分类 +【查岗】页各一个 stepper，默认=各分类
// 历史硬编码值（行为不变）；消费方经 window.dcfGet / dcfP / dcfHit 接线。
//
// A 段 逻辑锚点：dcfGet API 与默认表 / 模板 14 个 stepper / period 温柔前缀 / fish/eat/
//         sync/reach/water/garden/deskcheck/room/cjian/drift/music 十二处消费点
// B 段 行为断言（vm 桩环境加载 default-cards.js 真实源码）：
//    B1 dcfGet 未设置时回退各分类历史默认（25/35/40/50/55/60/100）
//    B2 dcfGet 已设置时按 dcf-<分类> 键读（clamp 0-100）
//    B3 未知分类回退 100
// C 段 行为断言（vm 桩环境加载 period.js 不现实——依赖过多，改抽 warmText 概率行
//         结构 + 哨兵锚点双确认；详见 A11-A12）
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

// ---- A 段：逻辑锚点 ----
const dcSrc = read('src/js/default-cards.js');
const tplSrc = read('src/template.html');
const periodSrc = read('src/js/period.js');
const p2Src = read('src/js/p2-features.js');
const gardenSrc = read('src/js/garden.js');
const chatSrc = read('src/js/chat.js');
const roomSrc = read('src/js/room.js');
const cjianSrc = read('src/js/cjian.js');
const driftSrc = read('src/js/drift-bottle.js');
const musicSrc = read('src/js/music-player.js');

check('A1 dcfGet 暴露 + DCF_DEF 默认表', dcSrc.includes('window.dcfGet = dcfVal;') && dcSrc.includes('period: 25'));
check('A2 fc 页 13 分类 stepper（fish..music）', ['fish','eat','period','water','garden','sync','reach','cjian','room','piggy','drift','interact','music'].every(k => tplSrc.includes('id="dcf-prob-' + k + '"')));
check('A3 dk 页查岗 stepper', tplSrc.includes('id="dcf-prob-deskcheck"'));
check('A4 stepper 值 input（period/deskcheck）', tplSrc.includes('id="dcf-prob-period-val"') && tplSrc.includes('id="dcf-prob-deskcheck-val"'));
check('A5 fc 页说明文案提到使用概率可调', tplSrc.includes('每个分类下方的「使用概率」'));
check('A6 heal 重同步覆盖 dcf 键', dcSrc.includes('Object.keys(DCF_DEF).forEach(function (k)'));
check('A7 温柔前缀概率行接 _warmP（dcfGet）', periodSrc.includes('if (Math.random() * 100 >= _warmP) return text;') && periodSrc.includes("window.dcfGet('period')"));
check('A8 温柔前缀默认 25 兜底', periodSrc.includes('var _warmP = 25;'));
// #224：摸鱼接线改经本 IIFE 助手 dcfPFish（原 dcfP 跨 IIFE 引用必抛 ReferenceError，语义等价 dcfGet('fish') 默认 35）
check('A9 p2-features 四单值分类接线', p2Src.includes('dcfPFish(35)') && p2Src.includes("dcfP('eat', 35)") && p2Src.includes("dcfP('sync', 60)") && p2Src.includes("dcfP('reach', 55)"));
check('A10 喝水乘法门控三处', (p2Src.match(/dcfHit\('water'\)/g) || []).length === 3);
check('A11 花园/查岗接线', gardenSrc.includes("window.dcfGet('garden')") && chatSrc.includes('Math.random() * 100 < _dkP'));
check('A12 room/cjian/drift/music 门控', roomSrc.includes("window.dcfGet('room')") && cjianSrc.includes("window.dcfGet('cjian')") && driftSrc.includes("window.dcfGet('drift')") && musicSrc.includes("window.dcfGet('music')"));
check('A13 drift 空话术不落库（TA回应瓶）', driftSrc.includes('const _dl = poolLine'));
check('A14 room bubble 空串守卫', roomSrc.includes('if (!t) return; // v3.32.x #132'));

// ---- B 段：vm 桩环境跑 default-cards.js 真实源码的 dcfGet ----
function runDc(envExtra) {
  const el = (id) => ({
    checked: true, addEventListener() {}, value: '0',
    querySelector: () => ({ addEventListener() {} }), querySelectorAll: () => [], closest: () => null,
    appendChild() {}, insertBefore() {}, removeChild() {}, textContent: '', style: {}, dataset: {}, hidden: false,
    addEventListenerChange() {}
  });
  const document = {
    getElementById: (id) => (id === 'dc-toast' ? null : el(id)),
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, setAttribute() {}, dataset: {} }),
    addEventListener() {},
    querySelectorAll: () => []
  };
  document.querySelectorAll = () => [];
  const store = new Map(Object.entries(envExtra || {}));
  const st = { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v); }, remove: (k) => { store.delete(k); } };
  const sandbox = {
    window: {},
    document,
    Math, Date, console, setTimeout, clearTimeout, parseFloat, parseInt, isNaN, Number, String, Object, Array, JSON,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  sandbox.window = sandbox;
  sandbox.window.activePrefix = () => 'xy-home-v2:default';
  sandbox.window.activeStore = () => st;
  vm.createContext(sandbox);
  vm.runInContext(dcSrc, sandbox, { filename: 'default-cards.js' });
  return { dcfGet: sandbox.window.dcfGet, store };
}

try {
  const { dcfGet } = runDc();
  const defaults = { fish: 35, eat: 35, period: 25, water: 35, garden: 40, sync: 60, reach: 55, cjian: 100, room: 100, piggy: 100, drift: 100, interact: 100, music: 100, deskcheck: 50 };
  let ok = true;
  Object.keys(defaults).forEach(k => { if (dcfGet(k) !== defaults[k]) { ok = false; console.log('   dcfGet(' + k + ')=' + dcfGet(k) + ' 预期 ' + defaults[k]); } });
  check('B1 dcfGet 未设置回退历史默认（14 分类逐一）', ok);
} catch (e) { check('B1 dcfGet 未设置回退历史默认', false, e.message); }

try {
  const { dcfGet, store } = runDc({ 'dcf-period': '80', 'dcf-fish': '-5', 'dcf-eat': '140' });
  check('B2 dcfGet 读已设值且 clamp 0-100', dcfGet('period') === 80 && dcfGet('fish') === 0 && dcfGet('eat') === 100);
  check('B3 dcfGet 未知分类回退 100', dcfGet('nonexist') === 100);
  store.set('dcf-period', '0');
  check('B4 dcf-period 可设 0（经期语态关断）', dcfGet('period') === 0);
} catch (e) { check('B2-B4 dcfGet 设值', false, e.message); }

// ---- C 段：period 温柔前缀行为（桩 DEFAULT_CARD_DATA + 最小环境抽函数） ----
try {
  const src = periodSrc;
  const m = src.match(/var _warmP = 25;[\s\S]{0,120}?if \(Math\.random\(\) \* 100 >= _warmP\) return text;/);
  check('C1 温柔前缀概率行结构完整（默认 25 → 可调覆盖）', !!m);
} catch (e) { check('C1 温柔前缀概率行结构', false, e.message); }

const fails = results.filter(r => !r.ok);
console.log('\n' + (results.length - fails.length) + '/' + results.length + ' passed');
process.exit(fails.length ? 1 : 0);

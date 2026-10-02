// #956 行为断言：「多字卡回复」总开关（py-en）关闭 ⇒ 拼接随机标点（py-punct-en）一并失效。
// 用法：node tools/verify-956-py-master-gate.mjs   （MOCHI_ROOT 可指向隔离副本）
// 用户实报（2026-09-21）：「多字卡回复关闭了，但是拼接随机标点没有关闭，还是能触发多字卡回复」。
// 修前缺陷（纯 HEAD 实证）：chat.js pyJoinCards 的取池闸门只看 py-punct-en——关掉「多字卡回复」
//   后，词典拼字单气泡 / 互动卡同源回应等非抽卡形态仍按标点池拼卡（气泡里出现 。！？......—— 连接），
//   用户看到的「多字卡回复」形态（多条字卡拼一条）关不掉。
// 修法：pyJoinCards 取池闸门升为 py-en && py-punct-en（pyJoinOn，总开关关＝只用单个空格）；
//   设置页「拼接随机标点」行与「拼接符号」池在总开关关闭时一并置灰（置灰＝真实生效状态）。
//   不动的边界（#851/#693/#726 用户口径）：来源 chip 仍按「气泡里实际有几张卡」判定，与总开关无关。
// 用例：S1~S2 静态锚；B1~B4 拼卡池（pyJoinCards）；B5 边界；Z1 零异常（载入即断言）。
// RED 基线（纯 HEAD）：S1/S3 红、B2/B4 红（标点照旧拼接）；B1/B3/B5 两侧同绿＝防修过头。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ← ' + extra : '')); }
};
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
// 断言回调绝不抛（红侧要打印逐条红，而不是崩在第一条）
const eq = (name, fn, extra) => { let v = false; try { v = !!fn(); } catch (e) { v = false; } ok(name, v, extra); };

const chatProd = read('js/chat.js') || read('index.html');
const rsProd = read('js/reply-settings.js') || read('index.html');
const tplProd = read('index.html');
const buildSrc = read('build.mjs');

// —— 从产物切出 pyJoinCards，一次 runInNewContext 内执行（函数体自包含，无需 cfg） ——
function sliceFn(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex(l => l.indexOf('function ' + name + '(') === 0);
  if (start < 0) return '';
  let depth = 0, out = [], seen = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    out.push(l);
    for (const ch of l) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
    if (seen && depth <= 0) break;
  }
  return out.join('\n');
}
const fnSrc = sliceFn(chatProd, 'pyJoinCards');
if (!fnSrc) { console.log('SKIP: 产物里找不到 pyJoinCards（读不到 js/chat.js？root=' + root + '）'); process.exit(2); }
const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} }, Math, Date, Number, String, Array, Object, JSON, isFinite, NaN, RegExp, __t: null };
vm.createContext(sandbox);
try { vm.runInContext(fnSrc + '\n__t = pyJoinCards;', sandbox); } catch (e) { ok('载入 pyJoinCards', false, e.message); }
const pyJoinCards = sandbox.__t;
if (typeof pyJoinCards !== 'function') { console.log('FAIL pyJoinCards 未导出（函数形态变了？）'); process.exit(1); }

// 全符号点亮的池（默认态）：空格/，/。/！/？/....../—— 全开
const FULL = { 'py-punct-en': 1, 'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 1, 'py-punct-ex': 1, 'py-punct-q': 1, 'py-punct-el': 1, 'py-punct-dash': 1 };
const SEP = ['，', '。', '！', '？', '......', '——'];
const joinMany = (cfg, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    // 抛错也记成一条「异常」样本（红侧/半修形态要打印逐条红，不能崩在第一条）
    try { out.push(pyJoinCards(['甲卡', '乙卡', '丙卡'], Object.assign({ 'py-en': 1 }, cfg))); }
    catch (e) { out.push('__THROW__' + e.message); }
  }
  return out;
};
const EXPECT_SPACE = '甲卡 乙卡 丙卡';

// ===== S1~S3 静态锚 =====
eq('S1 pyJoinCards 取池闸门＝多字卡回复总开关 && 拼接随机标点（pyJoinOn）',
  () => chatProd.indexOf("const pyJoinOn = !!(c && c['py-en'] === 1 && c['py-punct-en'] === 1);") >= 0);
eq('S2 来源 chip 判据未被本批收进总开关（#851 口径：仍按气泡内实际张数，防过度收口）',
  () => chatProd.indexOf('const pyMultiExtra = (pyMultiHit || (rep.spell && rep.spellOne))') >= 0 &&
    chatProd.indexOf('pyChipOn') < 0 &&
    chatProd.indexOf("tag: pyMultiHit ? '多字卡回复'") >= 0 &&
    chatProd.indexOf("tag: rMulti ? '多字卡回复'") >= 0 &&
    chatProd.indexOf("tag: pyMultiDrawn ? '多字卡回复'") >= 0);
eq('S3 设置页接线（pyMasterOn 闸门 + chips/两行置灰 + py-en 变更重同步 + 说明文案 + 哨兵 #956a~g）',
  () => {
    const a = rsProd.indexOf("const pyMasterOn = cfg['py-en'] === 1;") >= 0 &&
      rsProd.indexOf("const en = pyMasterOn && cfg['py-punct-en'] === 1;") >= 0 &&
      rsProd.indexOf("const dis = !(dcfg['py-en'] === 1 && dcfg['py-punct-en'] === 1);") >= 0 &&
      rsProd.indexOf('rowPunct.style.opacity') >= 0 && rsProd.indexOf('rowChips.style.opacity') >= 0 &&
      rsProd.indexOf("pyEnEl.addEventListener('change'") >= 0;
    const b = tplProd.indexOf('关闭上方「多字卡回复」后本组一并失效') >= 0;
    const c = ['#956a', '#956b', '#956c', '#956d', '#956e', '#956f', '#956g'].every(n => buildSrc.indexOf("name: '" + n) >= 0);
    return a && b && c;
  });

// ===== B1 多字卡回复开启时拼卡照旧（防修过头）=====
{
  const list = joinMany(FULL, 240);
  const punct = list.filter(t => SEP.some(s => t.indexOf(s) >= 0));
  const kinds = new Set(list.map(t => t.replace(/[^，。！？.—— ]/g, '')));
  ok('B1 py-en=1 时拼接随机标点照旧生效（' + punct.length + '/240 条含非空格连接符）', punct.length >= 100 && kinds.size >= 2);
}
// ===== B2（判别力核心）多字卡回复关闭 ⇒ 标点池失效，恒空格 =====
{
  const list = joinMany(Object.assign({}, FULL, { 'py-en': 0 }), 240);
  const bad = list.filter(t => t !== EXPECT_SPACE);
  ok('B2 py-en=0 时拼接随机标点不再生效（240 条全为空格连接）', bad.length === 0, bad.slice(0, 3).join(' / '));
}
// ===== B3 py-punct-en=0 本来就是空格（存量行为不回退）=====
{
  const list = joinMany(Object.assign({}, FULL, { 'py-punct-en': 0 }), 200);
  ok('B3 py-punct-en=0 仍恒空格（#650 原口径不回退）', list.every(t => t === EXPECT_SPACE));
}
// ===== B4 总开关关闭且空格符号也关 ⇒ 仍空格（不得回落标点池）=====
{
  const list = joinMany(Object.assign({}, FULL, { 'py-en': 0, 'py-punct-space': 0 }), 200);
  ok('B4 py-en=0 且关掉「空格」符号＝仍空格（不回落标点）', list.every(t => t === EXPECT_SPACE), list[0]);
}
// ===== B5 边界不变（空/单段/缺失 cfg）=====
eq('B5 空数组空串、单段原样、undefined cfg 不抛',
  () => pyJoinCards([], FULL) === '' && pyJoinCards(['只有一张'], FULL) === '只有一张' && pyJoinCards(['A', 'B']) === 'A B');

console.log('\nverify-956：通过 ' + pass + ' / 断言失败 ' + fail);
process.exit(fail ? 1 : 0);

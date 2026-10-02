// ===== #855 专项回归：寻踪「使用系统预设」开启＝系统预设＋我的添加合并抽取 =====
// 用户反馈：寻踪字卡添加自定义后，不再使用系统预设的寻踪预设字卡（多设备必现、与机型无关）。
// 根因（零机型分支）：genCheckin 的抽取池用 ckItems()＝纯自定义库，系统预设只在自定义库
//   为空时兜底——用户加过一张自定义字卡后，地点/动作/话术三类预设整库退场。
// 修法：开关（checkin-cards-default，默认开）开启时走 ckMergeDef＝预设在前、按原文去重合并；
//   关闭开关口径不变（只抽「我的添加」，文本恰为预设原文的排除；全空兜底预设防空白）。
// 用例（对提取出的真实函数体做单元级行为断言，stub 掉 store/window）：
//   A1 开预设＋自定义地点：预设与自定义都被抽到（合并生效）
//   A2 开预设＋自定义话术：同上（话术类）
//   A3 关预设＋有自定义：只抽自定义、无自定义的分类跳过（口径不变）
//   A4 开预设＋无自定义：整库预设（原兜底不回退）
//   A5 关预设＋无自定义：全空兜底预设（防空白/undefined 不回退）
//   A6 开预设＋单卡开关：被关掉的那张（预设或自定义）不再出现
//   A7 合并去重：与预设同文的自定义并入后不重复计概率
//   S1 源码锚点：ckMergeDef 声明＋genCheckin 合并接线两处
// 红对照：MOCHI_P2_FILE=<HEAD 版 p2-features.js> MOCHI_EXPECT=red node tools/verify-checkin-preset-mix.mjs
//   ——旧代码 A1/A2/A7/S1 必红（预设被自定义顶掉、无合并函数）。
// 纯 node 单元验证（提取函数体＋stub），不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const p2Path = process.env.MOCHI_P2_FILE || join(root, 'src/js/p2-features.js');
const src = readFileSync(p2Path, 'utf8');

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- 提取「const DEF_PLACES」到 genCheckin 函数体末尾的整段（含全部 ck 辅助函数） ----
function extractSlice() {
  const start = src.indexOf('const DEF_PLACES');
  if (start < 0) throw new Error('找不到 const DEF_PLACES');
  const at = src.indexOf('function genCheckin()');
  if (at < 0) throw new Error('找不到 function genCheckin()');
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('genCheckin 花括号不配平');
}

// ---- stub 工厂 ----
function mkStore(init) { const m = Object.assign({}, init || {}); return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; } }; }
const stubWin = {};

// 载入真实函数族，返回 { genCheckin, ckMergeDef, DEF_PLACES, DEF_ACTIONS, DEF_CHECK_MSGS }
function load(store) {
  const fn = new Function('store', 'window', '"use strict";\n' + extractSlice() +
    '\n;return { genCheckin: genCheckin, ckMergeDef: (typeof ckMergeDef !== "undefined" ? ckMergeDef : null), DEF_PLACES: DEF_PLACES, DEF_ACTIONS: DEF_ACTIONS, DEF_CHECK_MSGS: DEF_CHECK_MSGS };');
  return fn(store, stubWin);
}

// 跑 N 次统计抽到的取值集合（同一 store，共享单卡开关状态）
function sample(gen, n) {
  const seen = {};
  for (let i = 0; i < n; i++) {
    const out = gen();
    ['place', 'action', 'msg'].forEach(k => {
      if (out[k] == null) return;
      seen[k] = seen[k] || {};
      seen[k][out[k]] = 1;
    });
  }
  return seen;
}

try {
  // A1 开预设（默认态，无键）＋自定义地点：预设与自定义都被抽到
  {
    const lib = load(mkStore({ 'checkin-cards-place': JSON.stringify(['我的秘密基地']) }));
    const s = sample(lib.genCheckin, 400);
    note('A1', s.place && s.place['我的秘密基地'] === 1 && Object.keys(s.place).some(t => lib.DEF_PLACES.indexOf(t) >= 0),
      '开预设时应同时抽到自定义与系统预设地点，实得 ' + JSON.stringify(Object.keys(s.place || {})));
  }
  // A2 开预设＋自定义话术：同上
  {
    const lib = load(mkStore({ 'checkin-cards-msg': JSON.stringify(['今天特别想你呀']) }));
    const s = sample(lib.genCheckin, 400);
    note('A2', s.msg && s.msg['今天特别想你呀'] === 1 && Object.keys(s.msg).some(t => lib.DEF_CHECK_MSGS.indexOf(t) >= 0),
      '开预设时应同时抽到自定义与系统预设话术，实得 ' + JSON.stringify(Object.keys(s.msg || {})));
  }
  // A3 关预设＋有自定义：只抽自定义，无自定义的分类跳过（口径不变）
  {
    const lib = load(mkStore({ 'checkin-cards-default': '0', 'checkin-cards-place': JSON.stringify(['我的秘密基地']), 'checkin-cards-msg': JSON.stringify(['只有这一句']) }));
    const s = sample(lib.genCheckin, 400);
    note('A3', s.place && Object.keys(s.place).length === 1 && s.place['我的秘密基地'] === 1 &&
      s.msg && Object.keys(s.msg).length === 1 && s.msg['只有这一句'] === 1 && !s.action,
      '关预设应只抽自定义且空分类跳过，实得 ' + JSON.stringify(s));
  }
  // A4 开预设＋无自定义：整库预设（原兜底不回退）
  {
    const lib = load(mkStore({}));
    const s = sample(lib.genCheckin, 100);
    note('A4', s.place && Object.keys(s.place).length > 1 && Object.keys(s.place).every(t => lib.DEF_PLACES.indexOf(t) >= 0),
      '开预设无自定义应整库抽预设，实得 ' + JSON.stringify(Object.keys(s.place || {})));
  }
  // A5 关预设＋无自定义：全空兜底预设（防寻踪空白，不回退）
  {
    const lib = load(mkStore({ 'checkin-cards-default': '0' }));
    const s = sample(lib.genCheckin, 100);
    note('A5', s.place && Object.keys(s.place).every(t => lib.DEF_PLACES.indexOf(t) >= 0),
      '关预设且无自定义应兜底预设，实得 ' + JSON.stringify(Object.keys(s.place || {})));
  }
  // A6 开预设＋单卡开关：被关掉的预设不再出现（合并后 ck-off-* 照常生效）
  {
    const lib = load(mkStore({ 'checkin-cards-place': JSON.stringify(['我的秘密基地']), 'ck-off-place:在家': '1' }));
    const s = sample(lib.genCheckin, 400);
    note('A6', s.place && s.place['在家'] !== 1,
      '单卡开关关掉的预设「在家」不应再被抽到，实得 ' + JSON.stringify(Object.keys(s.place || {})));
  }
  // A7 合并去重：与预设同文的自定义并入后不重复计概率
  {
    const lib = load(mkStore({}));
    note('A7', typeof lib.ckMergeDef === 'function' &&
      lib.ckMergeDef([{ t: '在家' }, { t: '我的秘密基地' }], lib.DEF_PLACES).length === lib.DEF_PLACES.length + 1,
      '同文自定义应并入预设不重复，实得 ' + (typeof lib.ckMergeDef === 'function' ? lib.ckMergeDef([{ t: '在家' }, { t: '我的秘密基地' }], lib.DEF_PLACES).length : '无 ckMergeDef'));
  }
} catch (e) {
  failures.push('A*：行为断言执行失败——' + e.message);
}

// ---- S 组源码锚点 ----
try {
  if (src.indexOf('function ckMergeDef(custom, def)') < 0) throw new Error('源码缺锚点：function ckMergeDef(custom, def)');
  if (src.indexOf('places = ckMergeDef(places, DEF_PLACES);') < 0) throw new Error('源码缺锚点：places = ckMergeDef(places, DEF_PLACES);');
} catch (e) {
  failures.push('S1：' + e.message);
}

// ---- 全文件语法自检（编译不执行） ----
try { new Function(src); } catch (e) { failures.push('SYN：整文件编译失败——' + e.message); }

// ---- 汇总（red 对照：旧代码应至少违反一条新断言） ----
if (EXPECT === 'red') {
  if (failures.length) { console.log('RED-OK（旧代码如预期红 ' + failures.length + ' 条：' + failures.join('；') + '）'); process.exit(0); }
  console.error('红对照失败：旧代码竟全绿，断言没咬合'); process.exit(1);
}
if (failures.length) { console.error('FAIL ' + failures.length + ' 条：\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('OK #855 寻踪预设＋自定义合并抽取：A1~A7 行为 + S1 源码锚点 + 语法 全过');
process.exit(0);

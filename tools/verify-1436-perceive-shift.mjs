// ===== #1436 回归：方位感知【感知一下】＝按钮即开关（点了就先换位、再报方位）=====
// 作者需求原文：「新增 ta 的方位感知里可手动打开【主动感知位置时，联系人换位不受时间内才换位的
// 限制】——因为现在点【感知一下】受『TA 自动换位：开启后每 2～6 小时随机换一次位置』的限制，一直是同一个方位」。
// 同日作者复核直派（本尺随批重写）：「我是要我自己主动点击【感知一下】才变啊，你是不是乱加设置了」
// ＝**按钮即开关**：第一版那枚「主动感知即刻换位」开关退役，点【感知一下】无条件先催 TA 当场换一张
// 位置卡、再按新位置报方位；不需要打开任何设置。
//
// 落点（全部在 src/js/p2-features.js，判据零机型／零 UA 分支）：
//   F1 perceive()：无条件 window.locShiftNow() 先催一次换位（4 秒冷却照旧）
//   F2 getSense(force)：force 不等 15～45 分钟漂移闸就重掷方向（位置卡带方向时仍以位置卡为准）
//   F3 位置面板那一段：emitLocChange(avoidText) 避开上一张；window.locShiftNow 是它的对外出口
//   F4 开关退役：loc-shift-tg／loc-sense-shift／shiftNow 三个标识符在文件里一处不剩
//   F5 手动发位置卡／组合卡带 { rateAllow: true }（作者直派「不要受限流管」，sendLocCard＋sendComboCard 两处）
//   F6 反向硬闸：这一路不受夜间静默／loc-auto 总开关管（那两枚只管 TA 自己到点来打扰），
//      但「换位发到聊天」「换位提醒弹窗」两枚照常生效——由 verify-loc-change-setting.mjs 的 B6~B10 钉
//
// 用例：
//   G1 点【感知一下】（force）：立刻重掷方向（作者要的那一发，无开关前置）
//   G2 非 force（面板刷新／被动提示）：不许动——随机性只跟着「用户主动感知」走
//   G3 新位置卡带方向：方向跟随位置卡，且**不另抽一次**（屏上两处永远对得上）
//   G4 force＋位置卡带方向：仍然跟随位置卡（fixedDir 分支优先于 force 重掷）
//   P1 点【感知一下】：恰好催一次换位，且顺序是先换位后取读数
//   P2 4s 冷却内连点五次：只催一次（冷却语义没被顶掉）
//   A1 开关退役三标识符归零（absent）
//   A2 无条件接线两处（perceive 催换位＋getSense force 越闸）
//   A3 方位感知出口 window.locShiftNow 已接（面板那一段导出＋调用方）
//   A4~A6 emitLocChange 不带夜间/总开关闸＋落地必重画＋零机型零 UA
//   A7 手动发卡 rateAllow 至少两处（sendLocCard／sendComboCard）
// 红对照：MOCHI_EXPECT=red 跑在旧代码（开关版）上——G1/P*/A1/A2/A7 必红。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const p2Path = process.env.MOCHI_P2_FILE || join(root, 'src/js/p2-features.js');
const src = readFileSync(p2Path, 'utf8');

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

function extractFn(sig) {
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

// ---- 假 DOM（按 id memoize 同一枚元素；classList 用 Set 真记账）----
function mkDoc() {
  const byId = new Map();
  const mk = (tag) => {
    const el = { tag, id: '', textContent: '', hidden: true, disabled: false, children: [],
      _cls: new Set(),
      classList: { add(c) { el._cls.add(c); }, remove(c) { el._cls.delete(c); }, contains(c) { return el._cls.has(c); } },
      appendChild(c) { el.children.push(c); return c; } };
    Object.defineProperty(el, 'className', { get: () => Array.from(el._cls).join(' '), set: (v) => { el._cls = new Set(String(v).split(' ').filter(Boolean)); } });
    return el;
  };
  const doc = { createElement: mk, getElementById(id) { if (!byId.has(id)) byId.set(id, mk('div')); return byId.get(id); } };
  return doc;
}

const DIRS8 = ['正前方', '右前方', '右侧', '右后方', '后方', '左后方', '左侧', '左前方'];

// 跑真实 getSense（判据只问 per-cid 键，不喂假函数；开关退役后不再有 shiftNow 可抠）
// state=感知状态对象，opts={force,fixedDir,now,nextDirAt}→返回 {dir, rolls, ensure, saved}
function runGetSense(state, opts) {
  const o = opts || {};
  const trace = { rolls: 0, dir: null, saved: 0, ensure: 0 };
  const kv = {};
  if (o.curText) kv['loc-current'] = JSON.stringify({ text: o.curText, type: 'dir', ts: o.now || 1 });
  const store = { _m: kv, get(k) { return k in this._m ? this._m[k] : ''; }, set(k, v) { this._m[k] = v; } };
  const FakeDate = { now: () => (o.now === undefined ? 100000 : o.now) };
  const fn = new Function('store', 'Date', 'load', 'save', 'dirFromText', 'rollDir', 'ensureDirInLib',
    'rollRangeAndPower',
    '"use strict";' + extractFn('function getSense(force)') +
    '\nreturn getSense(' + (o.force ? 'true' : 'false') + ');');
  const out = fn(store, FakeDate,
    () => JSON.parse(JSON.stringify(state)),
    () => { trace.saved++; },
    (t) => (t === '靠在你左边' ? '左侧' : t === '在你右边站会儿' ? '右侧' : ''),
    () => { trace.rolls++; return '左前方'; },
    (d) => { trace.ensure++; return d; },
    () => ({ rangef: '近', power: '明显' }));
  trace.dir = out && out.dir;
  return trace;
}

// 跑真实 perceive：返回各出口的调用顺序（轨迹）
function runPerceive(opts) {
  const o = opts || {};
  const trace = [];
  const doc = mkDoc();
  const store = { _m: {}, get(k) { return k in this._m ? this._m[k] : ''; }, set(k, v) { this._m[k] = v; } };
  const win = {
    locShiftNow: () => { trace.push('shift'); return true; },
    locAddHist: (t, ty) => { trace.push('hist:' + ty); },
    locRefreshBody: () => { trace.push('refreshBody'); }
  };
  const RealDate = { now: () => (o.now === undefined ? 100000 : o.now) };
  const fn = new Function('store', 'window', 'document', 'Date', 'perceiveCdUntil', 'getSense',
    'maybeTouch', 'resultText', 'render', 'DIRS', 'esc', 'setTimeout',
    '"use strict";' +
    extractFn('function perceive()') + '\nperceive();');
  fn(store, win, doc, RealDate, o.cdUntil || 0,
    (force) => { trace.push('getSense' + (force ? ':force' : '')); return { dir: '右侧', rangef: '近', power: '明显' }; },
    () => null, (s) => '方位感知\n右侧', () => {}, DIRS8.map((k) => ({ k, arrow: '→', angle: 0 })),
    (x) => String(x), (f) => 0);
  return trace;
}

// ================= G 组：getSense 的方向闸 =================
try {
  const base = { dir: '右侧', rangef: '近', power: '明显', nextDirAt: 999999999999 }; // 漂移闸远未到点
  const g1 = runGetSense(base, { force: true });
  note('G1', g1.rolls === 1 && g1.dir === '左前方',
    '点【感知一下】必须当场重掷方向（按钮即开关，作者主诉「我自己主动点击【感知一下】才变」），实得 ' + JSON.stringify(g1));

  const g2 = runGetSense(base, { force: false });
  note('G2', g2.rolls === 0 && g2.dir === '右侧',
    '非主动感知（面板刷新／被动提示）不许越漂移闸——随机性只跟着用户那一次点击走，实得 ' + JSON.stringify(g2));

  // G3 新位置卡带方向 → 方向跟随位置卡，且不再另抽一次（屏上「此刻的位置」与方位感知必须同一条）
  const g3 = runGetSense({ dir: '左侧', rangef: '近', power: '明显', nextDirAt: 999999999999 },
    { force: true, curText: '在你右边站会儿' });
  note('G3', g3.rolls === 0 && g3.dir === '右侧',
    '位置卡带方向时感知方向须跟随它（不另抽），实得 ' + JSON.stringify(g3));

  // G4 force 也一样：带方向的位置卡优先（不许两处各掷各的）
  const g4 = runGetSense({ dir: '左侧', rangef: '近', power: '明显', nextDirAt: 999999999999 },
    { force: true, curText: '靠在你左边' });
  note('G4', g4.rolls === 0 && g4.dir === '左侧',
    'force＋位置卡带方向仍须跟随位置卡（fixedDir 分支优先），实得 ' + JSON.stringify(g4));
} catch (e) { failures.push('G*：getSense 行为断言执行失败——' + e.message); }

// ================= P 组：perceive 的调用顺序 =================
try {
  const p1 = runPerceive({});
  const iShift = p1.indexOf('shift'), iGet = p1.indexOf('getSense:force');
  note('P1', iShift === 0 && iGet === 1,
    '点【感知一下】必须无条件「先催 TA 换位、再按新位置取读数」（顺序反了＝屏上报的是上一张的方位；不催＝点了不动），实得轨迹 ' + JSON.stringify(p1));

  const p2 = runPerceive({ now: 5000, cdUntil: 9000 });
  note('P2', p2.length === 0,
    '4 秒冷却内点下去＝整条不动（换位也不催），实得轨迹 ' + JSON.stringify(p2));
} catch (e) { failures.push('P*：perceive 行为断言执行失败——' + e.message); }

// ================= A 组：源码级契约与零机型 =================
try {
  note('A1 第一版那枚前置开关已退役（作者复核直派「你是不是乱加设置了」）',
    src.indexOf('loc-shift-tg') < 0 && src.indexOf('loc-sense-shift') < 0 && src.indexOf('shiftNow') < 0,
    'loc-shift-tg／loc-sense-shift／shiftNow 有残留＝开关没删干净');
  note('A2 无条件接线两处（perceive 催换位＋getSense force 越闸）',
    src.indexOf('if (window.locShiftNow) window.locShiftNow();') >= 0 &&
    src.indexOf('now >= s.nextDirAt) || force') >= 0, '催换位或越闸判据缺一个');
  note('A3 方位感知出口 window.locShiftNow 已接（面板那一段导出）',
    src.indexOf('window.locShiftNow = function ()') >= 0 && src.indexOf('window.locShiftNow) window.locShiftNow()') >= 0, '导出或调用方缺一个');
  note('A4 即刻换位那一路不带夜间/总开关闸（夜间与 loc-auto 只拦 TA 自己到点来打扰）',
    extractFn('function emitLocChange(avoidText)').indexOf('nightModeActive') < 0 &&
    extractFn('function emitLocChange(avoidText)').indexOf("store.get('loc-auto')") < 0, '抽出来的那一发里混进了定时器闸');
  note('A5 换位落地必重画面板＋刷新感知', (() => {
    const body = extractFn('function emitLocChange(avoidText)');
    return /renderLocPanel\(\);/.test(body) && /window\.refreshSense\)/.test(body);
  })(), 'emitLocChange 里没有 renderLocPanel/refreshSense');
  note('A6 零机型／零 UA 分支（本批改动区间只看键与时间闸）', (() => {
    const zone = extractFn('function emitLocChange(avoidText)') + extractFn('function getSense(force)') +
      extractFn('function perceive()');
    return !/navigator\.userAgent|navigator\.platform/i.test(zone) && !/OPPO|vivo|Redmi|iPhone|iPad|PJD110|msie|chrome\//i.test(zone);
  })(), '改动区间里出现了机型名或 UA 读取');
  note('A7 手动发位置卡/组合卡带限流豁免位（作者直派「不要受限流管」，两处同型）',
    src.split('if (window.chatAddIn) window.chatAddIn(text, { rateAllow: true });').length - 1 >= 2,
    'sendLocCard／sendComboCard 两处没都带上 rateAllow');
} catch (e) { failures.push('A*：源码锚点缺失——' + e.message); }

// ---- 全文件语法自检（编译不执行） ----
try { new Function(src); } catch (e) { failures.push('SYN：整文件编译失败——' + e.message); }

if (EXPECT === 'red') {
  if (failures.length) { console.log('RED-OK（旧代码如预期红 ' + failures.length + ' 条：' + failures.slice(0, 3).join('；') + '…）'); process.exit(0); }
  console.error('红对照失败：旧代码竟全绿，断言没咬合'); process.exit(1);
}
if (failures.length) { console.error('FAIL ' + failures.length + ' 条：\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('OK #1436 感知一下＝按钮即开关：G1~G4 方向闸 + P1~P2 调用顺序 + A1~A7 契约与零机型 + 语法 全过');
process.exit(0);

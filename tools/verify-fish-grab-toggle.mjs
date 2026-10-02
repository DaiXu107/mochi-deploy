// ===== #791 专项回归：摸鱼抓包浮字总开关（回复设置可关，关=不飘字不抓包不吃额度） =====
// 用户反馈：摸鱼「抓包 TA」的桌面浮字（点我抓包）也要能关闭，设置要有合适的落点，功能大全要能搜到。
// 实现：
//   #791a reply-settings.js  DEFAULTS 'fish-grab-en':1（存 reply-fish-grab-en，per-cid）＋
//        「摸鱼值 / 工作值」组 JS 注入开关行（模板在途，照群聊「让对方继续说」注入同构）＋
//        三处通用开关数组与 TOGGLE_NAMES 纳管（同步 UI/保存/全部桌面保存/保存提示）
//   #791b p2-features.js    chk() 在 taChimeAllow 之前闸门：fish-grab-en=0 → 直接 return，
//        不飘字不抓包、不吃 45 分钟冷却与每日 12 次额度；摸鱼值累计由 fish-en 管，互不影响
//   #791c feature-hub.js    功能大全补三条：TA在身边·换位提醒设置 / 摸鱼抓包 / 摸鱼抓包浮字开关
// 用例（提取真实 chk 函数体＋stub，单次调用不落盘）：
//   B1 开（默认/=1）＋涨值：taChimeAllow 调 1 次、taChimeShow 调 1 次（现状行为不变）
//   B2 关（=0）＋涨值：taChimeAllow/taChimeShow 均 0 次（早退在配额消耗前）
//   S1 reply-settings 源码含：DEFAULTS 键、注入行 id、TOGGLE_NAMES、三数组纳管
//   S2 feature-hub 源码含：三条新条目名称
// 红对照：MOCHI_P2_FILE=<HEAD 版 p2-features.js> MOCHI_RS_FILE=<HEAD 版 reply-settings.js>
//         MOCHI_HUB_FILE=<HEAD 版 feature-hub.js> MOCHI_EXPECT=red node tools/verify-fish-grab-toggle.mjs
//   ——旧 chk 无闸门（B2 红）、旧回设/大全无新锚点（S1/S2 红）。
// 纯 node 单元验证，不依赖不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const srcP2 = readFileSync(process.env.MOCHI_P2_FILE || join(root, 'src/js/p2-features.js'), 'utf8');
const srcRS = readFileSync(process.env.MOCHI_RS_FILE || join(root, 'src/js/reply-settings.js'), 'utf8');
const srcHub = readFileSync(process.env.MOCHI_HUB_FILE || join(root, 'src/js/feature-hub.js'), 'utf8');

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

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- B 组：真实 chk 行为（stub 全部外依赖） ----
function runChk(replyCfg, opts) {
  const o = opts || {};
  const spy = { allow: 0, use: 0, show: 0 };
  const win = {
    replyCfg: () => replyCfg,
    activeStore: () => ({ get: (k) => (k === 'fish-total-ta' ? '10' : '') }),
    taChimeAllow: () => { spy.allow++; return true; },
    taChimeUse: () => { spy.use++; },
    taChimeShow: (note, opts2) => { spy.show++; },
    taFit: null, addFishPts: () => {}, chatAddIn: () => {}, toast: () => {}, addFishCatchRecord: () => {},
    getFishPool: (n, fb) => fb, isDefaultCardOff: () => false, dcfGet: () => 100
  };
  const doc = { hidden: false };
  const fn = new Function('window', 'document', 'lastTa', 'gamePanelOpen', 'dcfPFish', 'fishPool', 'pick',
    'FISH_NOTE_FALLBACK', 'CATCH_REPLIES',
    '"use strict";' + extractFn(srcP2, 'function chk()') + '; chk();');
  fn(win, doc, 5, () => false, () => 100, (n, fb) => fb, (a) => a[0], ['兜底'], ['回应']);
  return spy;
}
try {
  const b1 = runChk({ 'fish-grab-en': 1 });
  note('B1', b1.allow === 1 && b1.show === 1 && b1.use === 1,
    '开关开应 allow1/use1/show1（现状不变），实得 ' + JSON.stringify(b1));
  const b1d = runChk({}); // 未设过键=默认开
  note('B1d', b1d.allow === 1 && b1d.show === 1, '未设键应默认开，实得 ' + JSON.stringify(b1d));
  const b2 = runChk({ 'fish-grab-en': 0 });
  note('B2', b2.allow === 0 && b2.use === 0 && b2.show === 0,
    '开关关应全静默（不吃冷却/额度），实得 ' + JSON.stringify(b2));
} catch (e) {
  failures.push('B*：行为断言执行失败——' + e.message);
}

// ---- S1：reply-settings 锚点 ----
[['DEFAULTS 键', "'fish-grab-en': 1"],
 ['注入行 id', 'id="fish-grab-en"'],
 ['TOGGLE_NAMES', "'fish-grab-en': '摸鱼抓包浮字'"],
 ['通用数组纳管×3', "'rc-en', 'fish-en', 'work-en', 'fish-grab-en']"]].forEach(([nm, nd]) => {
  let n = 0, at = -1;
  while ((at = srcRS.indexOf(nd, at + 1)) >= 0) n++;
  note('S1-' + nm, n >= (nm.indexOf('×3') >= 0 ? 3 : 1), nm + ' 应出现（数组需≥3 处），实得 ' + n);
});

// ---- S2：feature-hub 三条新条目 ----
['TA在身边 · 换位提醒设置', "n: '摸鱼抓包'", "n: '摸鱼抓包浮字开关'"].forEach((nd) => {
  note('S2', srcHub.indexOf(nd) >= 0, '功能大全缺条目锚点：' + nd);
});

// ---- 全文件语法自检（编译不执行） ----
[[srcP2, 'p2-features.js'], [srcRS, 'reply-settings.js'], [srcHub, 'feature-hub.js']].forEach(([s, nm]) => {
  try { new Function(s); } catch (e) { failures.push('SYN-' + nm + '：编译失败——' + e.message); }
});

if (EXPECT === 'red') {
  if (failures.length) { console.log('RED-OK（旧代码如预期红 ' + failures.length + ' 条：' + failures.join('；') + '）'); process.exit(0); }
  console.error('红对照失败：旧代码竟全绿，断言没咬合'); process.exit(1);
}
if (failures.length) { console.error('FAIL ' + failures.length + ' 条：\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('OK #791 摸鱼抓包浮字开关：B1/B1d/B2 行为 + S1 回设锚点 + S2 功能大全锚点 + 三文件编译 全过');
process.exit(0);

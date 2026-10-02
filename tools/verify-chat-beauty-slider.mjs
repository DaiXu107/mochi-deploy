// ===== #835 专项回归：聊天设置·美化「气泡字号 / 气泡框大小」改滑块、禁自由输入 =====
// 用户原话：「聊天设置的美化里的 聊天气泡字体大小 页面为什么可以输入内容」「改成滑块滑动自定义，禁止输入」
//           「同时修复『气泡框大小』的同类问题」。
// 根因：openModal 默认自带文本框（只有传 noInput 才隐藏）——字号这处只传了 pills 没传 noInput，
//       气泡框大小干脆走 openTCPanel 的 <input>；两处都对用户输入零校验，任意文字直接落
//       cs-font-size / cs-bubble-size 并写成 CSS 变量 → 浏览器按非法值静默忽略（改了没反应）、
//       设置行右侧挂着那串乱码、还会被美化方案一起备份带走。
// 修法（src/js/chat-settings.js，零机型分支）：
//   ① 两处统一改「滑块＋预设胶囊＋noInput 禁输入」（与本文件气泡圆角同口径），拖动实时预览 CSS 变量；
//   ② 气泡框大小滑块档位＝左右内边距，上下按 BUBBLE_PAD_RATIO(0.78) 配比跟随
//      ——10→8 / 14→11 / 18→14 恰为原三档预设值，预设零漂移；
//   ③ 读数侧 clampFontSize / normBubblePad 钳制：存量脏值与导入方案里的非法串一律回落默认。
// 用例：
//   A1 clampFontSize 值域与脏值收敛；A2 normBubblePad 合法对保留/非法回落/越界钳制；
//   A3 bubblePadFromLr 三档预设零漂移；A4 clampBubbleLr 从内边距对反向取档位（取左右那个）；
//   S1 字号弹窗禁输入＋挂滑块；S2 气泡框大小弹窗禁输入＋挂滑块；S3 两弹窗预设胶囊仍在；
//   S4 applySettings 两个读数走钳制；S5 自定义档回显实际 px（不再是「自定义」）；
//   S6 旧自由文本框（openTCPanel + 其 input id）整块退役不得回流；S7 圆角弹窗（同源参照）未被牵连。
// 用法：
//   node tools/verify-chat-beauty-slider.mjs                     （期望全绿）
//   MOCHI_CHAT_SETTINGS_FILE=<旧版 chat-settings.js> MOCHI_EXPECT=red node …  （红对照）
// 纯 node 静态＋单元验证，不依赖也不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(process.env.MOCHI_CHAT_SETTINGS_FILE || join(root, 'src/js/chat-settings.js'), 'utf8');

const failures = [];
let asserted = 0;
const note = (id, ok, why) => { asserted++; if (!ok) failures.push(id + '：' + why); };

// ---- 提取 #835 辅助函数区（常量＋四个函数整块），真跑不抄写 ----
function extractHelpers() {
  const start = src.indexOf('const FONT_SIZE_MIN');
  const end = src.indexOf('const BUBBLE_RADII');
  if (start < 0 || end < 0 || end <= start) throw new Error('找不到 #835 辅助函数区');
  return src.slice(start, end);
}
let H = null;
try {
  H = new Function('"use strict";' + extractHelpers() +
    '; return { clampFontSize, normBubblePad, clampBubbleLr, bubblePadFromLr, FONT_SIZE_DEFAULT, BUBBLE_PAD_DEFAULT };')();
} catch (e) {
  failures.push('X：辅助函数区提取/执行失败 —— ' + e.message);
}

if (H) {
  // ---- A1 字号钳制 ----
  note('A1.1', H.clampFontSize('14px') === 14, "14px → 14，得 " + H.clampFontSize('14px'));
  note('A1.2', H.clampFontSize(16) === 16, '滑块回传的数字 16 应原样，得 ' + H.clampFontSize(16));
  note('A1.3', H.clampFontSize('18') === 18, "18 → 18，得 " + H.clampFontSize('18'));
  note('A1.4', H.clampFontSize('abc') === H.FONT_SIZE_DEFAULT, "脏值 'abc' 应回落默认 " + H.FONT_SIZE_DEFAULT + '，得 ' + H.clampFontSize('abc'));
  note('A1.5', H.clampFontSize(null) === H.FONT_SIZE_DEFAULT, '缺键应回落默认，得 ' + H.clampFontSize(null));
  note('A1.6', H.clampFontSize('') === H.FONT_SIZE_DEFAULT, '空串应回落默认，得 ' + H.clampFontSize(''));
  note('A1.7', H.clampFontSize('5') === 11, '低于下限应收敛 11，得 ' + H.clampFontSize('5'));
  note('A1.8', H.clampFontSize('99px') === 30, '超上限应收敛 30，得 ' + H.clampFontSize('99px'));
  note('A1.9', H.FONT_SIZE_DEFAULT === 14 && H.clampFontSize('0') === 11, '默认档仍是原 14px、下限不吞掉 0');

  // ---- A2 内边距对规范化 ----
  note('A2.1', H.normBubblePad('8px 10px') === '8px 10px', '预设值必须逐字保留（方案/显示靠它匹配 label）');
  note('A2.2', H.normBubblePad('11px 14px') === '11px 14px', '标准档原样，得 ' + H.normBubblePad('11px 14px'));
  note('A2.3', H.normBubblePad('12,16') === '12px 16px', '逗号分隔的老写法应补齐 px，得 ' + H.normBubblePad('12,16'));
  note('A2.4', H.normBubblePad('abc') === H.BUBBLE_PAD_DEFAULT, "脏值 'abc' 应回落默认，得 " + H.normBubblePad('abc'));
  note('A2.5', H.normBubblePad('11px') === H.BUBBLE_PAD_DEFAULT, '只有一个数＝不完整，应回落默认，得 ' + H.normBubblePad('11px'));
  note('A2.6', H.normBubblePad(null) === H.BUBBLE_PAD_DEFAULT, '缺键回落默认');
  note('A2.7', H.normBubblePad('50px 60px') === '30px 30px', '越界应双向钳到 30px，得 ' + H.normBubblePad('50px 60px'));
  note('A2.8', H.normBubblePad('-4px 8px') === '4px 8px', '负 padding 非法，应收敛到下限侧，得 ' + H.normBubblePad('-4px 8px'));

  // ---- A3 滑块档位 → 内边距对：三档预设零漂移 ----
  note('A3.1', H.bubblePadFromLr(10) === '8px 10px', '10 档应等于「紧凑 8px 10px」，得 ' + H.bubblePadFromLr(10));
  note('A3.2', H.bubblePadFromLr(14) === '11px 14px', '14 档应等于「标准 11px 14px」，得 ' + H.bubblePadFromLr(14));
  note('A3.3', H.bubblePadFromLr(18) === '14px 18px', '18 档应等于「宽松 14px 18px」，得 ' + H.bubblePadFromLr(18));
  note('A3.4', H.bubblePadFromLr(3) === '5px 6px', '越界档位先钳到 6 再配比，得 ' + H.bubblePadFromLr(3));
  note('A3.5', H.bubblePadFromLr(40) === '19px 24px', '超上限钳到 24，得 ' + H.bubblePadFromLr(40));
  note('A3.6', H.bubblePadFromLr('abc') === '11px 14px', '非数字档回落标准档，得 ' + H.bubblePadFromLr('abc'));

  // ---- A4 内边距对 → 档位（取左右那个）----
  note('A4.1', H.clampBubbleLr('8px 10px') === 10, '应取第二个数（左右），得 ' + H.clampBubbleLr('8px 10px'));
  note('A4.2', H.clampBubbleLr('14px 18px') === 18, '宽松档往返应回 18，得 ' + H.clampBubbleLr('14px 18px'));
  note('A4.3', H.clampBubbleLr('abc') === 14, '脏值回落标准档 14，得 ' + H.clampBubbleLr('abc'));
  note('A4.4', H.clampBubbleLr(20) === 20, '裸数字档位原样，得 ' + H.clampBubbleLr(20));
  // 往返闭合：任意预设先转档、再转回值，必须落回原预设串
  for (const p of ['8px 10px', '11px 14px', '14px 18px']) {
    note('A4.5', H.bubblePadFromLr(H.clampBubbleLr(p)) === p, '预设 ' + p + ' 往返不漂移，得 ' + H.bubblePadFromLr(H.clampBubbleLr(p)));
  }
}

// ---- 弹窗处理器区块（按行锚切段，段内断言）----
function segment(startSig, endSig) {
  const a = src.indexOf(startSig);
  if (a < 0) return '';
  const b = src.indexOf(endSig, a + startSig.length);
  return b < 0 ? src.slice(a) : src.slice(a, b);
}
const fontSeg = segment("const csFont = row('cs-font-size');", "const csPad = row('cs-bubble-size');");
const padSeg = segment("const csPad = row('cs-bubble-size');", "const csRadius = row('cs-bubble-radius');");

note('S1', /noInput:\s*true/.test(fontSeg) && /slider:\s*\{[^}]*min:\s*FONT_SIZE_MIN/.test(fontSeg),
  '字号弹窗必须 noInput（禁自由输入）且带字号滑块；缺任一＝用户又能往设置里打字');
note('S2', /noInput:\s*true/.test(padSeg) && /slider:\s*\{[^}]*min:\s*BUBBLE_LR_MIN/.test(padSeg),
  '气泡框大小弹窗必须 noInput 且带胖瘦滑块');
note('S3', /pills:\s*FONT_SIZES/.test(fontSeg) && /pills:\s*BUBBLE_SIZES/.test(padSeg),
  '两处预设胶囊要保留（小/标准/大/特大、紧凑/标准/宽松 一键档）');
note('S4a', src.includes("const fs = clampFontSize(store.get('cs-font-size')) + 'px';"),
  'applySettings 字号读数必须走钳制（否则存量脏值照旧写进 --chat-font-size）');
note('S4b', src.includes("const pad = normBubblePad(store.get('cs-bubble-size'));"),
  'applySettings 内边距读数必须走规范化');
note('S4c', src.includes("store.set('cs-font-size', clampFontSize(v) + 'px');"),
  '字号写入前必须钳制');
note('S4d', padSeg.includes("store.set('cs-bubble-size', typeof v === 'number' ? bubblePadFromLr(v) : normBubblePad(v));"),
  "气泡框大小只能由滑块档（number）或预设串产出");
note('S5', /set\('cs-bubble-size-val',\s*pn \? pn\.label : pad\)/.test(src),
  '自定义档应回显实际内边距（滑块能停 19 档，全显「自定义」＝看不出改到哪）');
note('S6a', !padSeg.includes('openTCPanel'), '气泡框大小不得再走自由文本面板');
note('S6b', !src.includes('cs-pad-input'), '旧自由文本输入框不得回流（整块已退役）');
note('S7', /slider:\s*\{[\s\S]*?min:\s*0,\s*max:\s*40/.test(src) && src.includes("const BUBBLE_RADII = ["),
  '参照物：气泡圆角弹窗（同为滑块＋预设）未被牵连改动');

// ---- 汇总 ----
const reds = failures.length;
if (EXPECT === 'red') {
  console.log(reds ? 'RED-OK：' + reds + ' 条断言未过（旧版符合预期）' : 'FAIL：红对照却全绿，脚本无判别力');
  failures.slice(0, 12).forEach((f) => console.log('  · ' + f));
  process.exit(reds ? 0 : 1);
}
if (reds) {
  console.log('❌ 未过 ' + reds + '/' + asserted + '：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('✅ verify-chat-beauty-slider：' + asserted + '/' + asserted + ' 全过');

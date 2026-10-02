// verify-triage.mjs 分类判据的反向对照：每条判据都对应本轮误判过一次的真实形态，
// 目的是防止后来者改锚点规则时把「假期望过期」重新放回 B 桶（B 桶会被当成改脚本的依据）。
// 用法：node tools/verify-triage-classify.mjs
import { readFileSync } from 'node:fs';
import {
  verdictFor, seedLitsOf, labelLitsOf, inputLitsOf, inMarkup, isAnchor
} from './verify-triage.mjs';

let pass = 0, fail = 0;
const check = (desc, ok, detail) => {
  if (ok) { pass++; console.log('PASS  ' + desc + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + desc + (detail ? '  [' + detail + ']' : '')); }
};
const verdictOf = (file, label) => {
  const code = readFileSync('tools/' + file, 'utf8');
  const v = verdictFor(code, label, seedLitsOf(code), labelLitsOf(code), inputLitsOf(code));
  return v ? v.kind : 'null';
};
const synth = (code, label) => { const v = verdictFor(code, label, new Set(), labelLitsOf(code), inputLitsOf(code)); return v ? v.kind : 'null'; };
const REAL_ANCHOR = '.chat-body';
const FAKE_ANCHOR = '__definitely_absent_anchor_zz__';

// ---- 真实脚本：已知正确分类 ----
check('测试输入回显不当锚点（verify-chat-send-btn 双击测试）', verdictOf('verify-chat-send-btn.mjs', '双击发送按钮 → 只发出一条（防重复仍生效）') === 'runtime', verdictOf('verify-chat-send-btn.mjs', '双击发送按钮 → 只发出一条（防重复仍生效）'));
check('join 比对不当锚点（verify-cjian 弹窗选项清单）', verdictOf('verify-cjian.mjs', '管理弹窗四选项（添加/时辰区间/改名/删除）——单桌视图直接进动作阶段 —— ') === 'runtime');
check('成组种子不当锚点（verify-poke-emoji-tabs 公用互动）', verdictOf('verify-poke-emoji-tabs.mjs', 'B3 getScopedGroups：public/own 分区读取正确') === 'runtime');
check('相邻 check 标签不当锚点（verify-memory-flip B6b）', verdictOf('verify-memory-flip.mjs', 'B6b 结算后 TA 从字卡库取一句游戏回应') === 'runtime');
check('反向断言缺失即达标（verify-bugfix-six S2b 旧文案已删）', verdictOf('verify-bugfix-six.mjs', 'S2b Pong 提示改为右侧挡板') !== 'stale');
check('同窗口的 F2 反向断言不污染 F3（verify-unified-heart-wallet）', verdictOf('verify-unified-heart-wallet.mjs', 'F3 TA自动申请已打包 + 聊天记录流水区块已打包') === 'runtime');
check('fillInput 写入的文案不当锚点（verify-narc-v2 性格行）', verdictOf('verify-narc-v2.mjs', 'P2e 行内显示已填值') !== 'stale');

// ---- 合成语句：判据本身 ----
const LBL = 'T1 静态锚点说明';
const st = (stmt) => "const built='x';\ncheck('" + LBL + "', " + stmt + ", v);\n";
check('静态断言里锚点缺失 → 判期望过期', synth(st("built.indexOf('" + FAKE_ANCHOR + "') >= 0"), LBL) === 'stale');
check('静态断言里锚点在产物中 → 不判期望过期', synth(st("built.indexOf('" + REAL_ANCHOR + "') >= 0"), LBL) !== 'stale');
check('indexOf(...) < 0 形式的删除型断言不判过期', synth(st("built.indexOf('" + FAKE_ANCHOR + "') < 0"), LBL) !== 'stale');
check('文件路径字面量不当锚点', synth(st("readFileSync('src/zzz-nosuch.js').indexOf('" + REAL_ANCHOR + "') >= 0"), LBL) !== 'stale');
check('探针语句（只 stringify 不比字面量）不判过期', synth("const v=1;\ncheck('" + LBL + "', v, JSON.stringify({k:'" + FAKE_ANCHOR + "'}));\n", LBL) !== 'stale');
check('十六进制色值不作锚点', isAnchor('ff2255') === false);
check('正常文案仍认作锚点', isAnchor('功能介绍与二传二改说明') === true);

// ---- markup 证据 ----
check('helper 造元素（el("span","cj-card-name",…)）算 markup 证据', inMarkup('cj-card-name') === true);
check('只出现在 CSS 与 querySelector 串里的类不算 markup 证据', inMarkup('mail-list') === false);

console.log('\n结果：' + pass + '/' + (pass + fail) + (fail ? '  ← 分类判据回归，B 桶结论不可信，先修 verify-triage.mjs' : ' 全绿'));
process.exit(fail ? 1 : 0);

// ===== 专项 #255：iOS 键盘期弹窗顶对齐 + 批量导入弹窗放大 + room.js floorPick 补齐 =====
// 用法：node tools/verify-modal-kb-dock.mjs
//       SRCDIR=<目录> node tools/verify-modal-kb-dock.mjs   # 对任意源快照红绿对照
// 背景（用户报障 iPhone16P/iOS26 Safari，明说其他设备型号也有）：
//   ① 公用/专享字卡【批量导入】弹窗打字时输入框往上滑、显示不正常——键盘开合动画与
//      输入法候选条显隐使 .phone 高度变化，.modal-mask{align-items:center} 的弹窗每次
//      重新取中 = 输入框跟着上滑；修复=键盘会话(_kbActive/_iProv)给 mask 挂
//      modal-kb-dock 顶对齐（mobile-adapt.js 五个生命周期点开关），位置锚定不再移动。
//   ② 批量导入弹窗太小——opts.big 宽版(420px/94vw)+原生 textarea rows=8
//     （iOS 不做 ce-box 转换，rows 决定实际高度）。
//   ③ room.js 装扮选墙纸确定后 setTimeout(floorPick) 必抛 ReferenceError（floorPick
//      整个函数缺失，用户诊断「Can't find variable: floorPick ×6」）——补齐地板弹窗。
// 验证方式：A 组源码静态断言（可用 SRCDIR 对任意快照/HEAD 红绿对照）；
//           PRODUCT=1 时追加构建产物断言（部署同款）。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const srcDir = process.env.SRCDIR ? normalize(process.env.SRCDIR) : join(root, 'src');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && !ok ? '  [' + JSON.stringify(detail) + ']' : ''));
}

const css = readFileSync(join(srcDir, 'css', 'base.css'), 'utf8');
const ma = readFileSync(join(srcDir, 'js', 'mobile-adapt.js'), 'utf8');
const cc = readFileSync(join(srcDir, 'js', 'chatcard.js'), 'utf8');
const rm = readFileSync(join(srcDir, 'js', 'room.js'), 'utf8');

// ---- A1/A2 base.css：顶对齐规则 + 宽版尺寸 ----
check('A1 base.css 键盘期 mask 顶对齐规则（align-items:flex-start）',
  /\.modal-mask\.modal-kb-dock \{ align-items: flex-start; \}/.test(css));
check('A2 base.css 顶对齐时安全区上边距（弹窗不贴刘海/状态栏）',
  /\.modal-mask\.modal-kb-dock \.modal \{ margin-top: max\(10px, env\(safe-area-inset-top\)\); \}/.test(css));
check('A3 base.css modal--big 宽版 420px/94vw（放大）',
  /\.modal\.modal--big \{ width:min\(420px, 94vw\); \}/.test(css));

// ---- A4 mobile-adapt.js：开关函数 + 生命周期接线 ----
check('A4 mobile-adapt syncModalKbDock 定义（toggle 表达式 _kbActive||_iProv）',
  /function syncModalKbDock\(\) \{[\s\S]*?classList\.toggle\('modal-kb-dock', !!\(_kbActive \|\| _iProv\)\)/.test(ma));
check('A5 mobile-adapt 生命周期接线 ≥5 处（键盘开启/restoreKb/推定停靠/推定清除/轮询兜底）',
  (ma.match(/syncModalKbDock\(\);/g) || []).length >= 5,
  (ma.match(/syncModalKbDock\(\);/g) || []).length);
check('A6 mobile-adapt restoreKb 收键盘时摘除（后随 kbUndockPanels→unlockDocScroll）',
  /kbUndockPanels\(\);\n\s*syncModalKbDock\(\);[\s\S]{0,80}unlockDocScroll\(\);/.test(ma));

// ---- A5 chatcard.js：批量导入弹窗放大 ----
{
  const m = cc.match(/批量导入字卡（一行一个）'[\s\S]{0,8000}?\}, \{([\s\S]*?)\}\);\n      \}/);
  const opts = m ? m[1] : '';
  check('A7 chatcard 批量导入弹窗走 opts.big 宽版', /big: true/.test(opts));
  check('A8 chatcard 原生 textarea rows=8（iOS 无 ce-box，rows 决定高度）', /textareaRows: 8/.test(opts));
  check('A9 chatcard 弹窗仍保留 txtImport/分组下拉（放大不砍功能）',
    /txtImport: true/.test(opts) && /groups: \(groups\[cur\] \|\| \[\]\)\.map/.test(opts));
}

// ---- A6 room.js：floorPick 补齐 ----
check('A10 room.js floorPick 函数已定义（此前整体缺失=ReferenceError）',
  /function floorPick\(\) \{/.test(rm));
check('A11 room.js 装扮墙纸确定后延后调 floorPick 仍在位',
  /setTimeout\(floorPick, 0\);/.test(rm));
check('A12 room.js floorPick 用 FLOORS 数据 + f: 前缀写 d.floor（renderScene floor-<id> 消费）',
  /FLOORS\.map\(f =>/.test(rm) && /d\.floor = v\.slice\(2\); save\(\); renderScene\(\);/.test(rm) && /value: f\.lv <= d\.lv \? 'f:' \+ f\.id : ''/.test(rm));
check('A13 room.js floorPick 锁级过滤与墙纸同款（🔒Lv 提示 + 超级地板不可选）',
  /' 🔒Lv' \+ f\.lv : ''/.test(rm));

// ---- 产物断言（可选） ----
if (process.env.PRODUCT === '1') {
  const prod = readFileSync(join(root, 'index.html'), 'utf8');
  check('P1 产物含 modal-kb-dock CSS 规则', /\.modal-mask\.modal-kb-dock \{ align-items: flex-start; \}/.test(prod));
  check('P2 产物含 syncModalKbDock 开关', /function syncModalKbDock\(\)/.test(prod));
  check('P3 产物含批量导入弹窗 big+rows=8', /textareaRows: 8/.test(prod));
  check('P4 产物含 floorPick 函数', /function floorPick\(\) \{/.test(prod));
  check('P5 产物 modal--big 已放大 420px', /\.modal\.modal--big \{ width:min\(420px, 94vw\); \}/.test(prod));
}

const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
process.exit(pass === results.length ? 0 : 1);

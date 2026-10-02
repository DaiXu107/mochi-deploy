// ===== #794 专项回归：屏幕适配「诊断→修正」闭环 + 第七轴（左右安全边）+ 适配码 =====
// 用户需求：不同人的屏幕让用户自己调更自由。落地四件事：
//   #794a~b 左右安全边轴（mobile-adapt.js 落层 --mochi-side-adj，base.css 六个 .phone 形态消费）
//   #794c~d 诊断→修正计算器 screenFixCalc（device.js，判定器同口径折算轴值建议）+ 报告「一键修正」按钮
//   #794e~i 微调面板（建议行 / 按住看默认 / 适配码 MCADJ1 导入导出）+ openModal extraBtn + 备份恢复偏移提醒
// 用例：
//   B1 顶部重叠 → top 轴正向建议         B5 对应轴已手动调过 → 该轴跳过
//   B2 顶部双倍避让 → top 轴负向建议     B6 键盘停靠期 → 底部三条全豁免（#282 同口径）
//   B3 底部少填 → h 轴正向建议           B7 桌面模拟器外壳 → 底部三条全豁免（#528 同口径）
//   B4 tabbar 被裁/悬空 → bottom 轴建议  B8 正常贴合 → 空建议
//   S1~S9 源码锚点：轴登记/落层/CSS 消费/建议行/按钮/适配码/备份提醒/extraBtn 模板位
// 红对照：MOCHI_DEVICE_FILE=<HEAD 版 device.js> MOCHI_EXPECT=red node tools/verify-screen-freedom.mjs
//   ——HEAD 无 screenFixCalc，B1~B8 全红；S 锚点随对照文件选择相应缺失。
// 纯 node 验证（vm 提取函数体＋stub），不触发 node build.mjs，多会话并行安全。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const devicePath = process.env.MOCHI_DEVICE_FILE || join(root, 'src/js/device.js');
const adaptPath = process.env.MOCHI_ADAPT_FILE || join(root, 'src/js/mobile-adapt.js');
const persoPath = process.env.MOCHI_PERSONALIZE_FILE || join(root, 'src/js/personalize.js');
const tmplPath = process.env.MOCHI_TEMPLATE_FILE || join(root, 'src/template.html');
const backupPath = process.env.MOCHI_BACKUP_FILE || join(root, 'src/js/data-backup.js');
const basecssPath = process.env.MOCHI_BASECSS_FILE || join(root, 'src/css/base.css');

const deviceSrc = readFileSync(devicePath, 'utf8');
const adaptSrc = readFileSync(adaptPath, 'utf8');
const persoSrc = readFileSync(persoPath, 'utf8');
const tmplSrc = readFileSync(tmplPath, 'utf8');
const backupSrc = readFileSync(backupPath, 'utf8');
const basecssSrc = readFileSync(basecssPath, 'utf8');

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- 提取 IIFE 内指定函数体（花括号配平），失败=锚点没了 ----
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

// ---- B1~B8：screenFixCalc 行为断言（判定器 stub：expTop/expBase 按形态给值；force 位借当 resStand 开关）----
let calcOk = true;
try {
  extractFn(deviceSrc, 'function screenFixCalc');
} catch (e) {
  calcOk = false;
  if (EXPECT !== 'red') failures.push('B*：screenFixCalc 提取失败——' + e.message);
}
const mk = (inp, cur) => {
  const sb = {
    window: {
      mochiViewportForm: function (i) {
        const resStand = !!i.safeTopForce;
        return {
          resStand, coverBrowser: false, iosCover: false, e2eBrowser: false,
          expTop: resStand ? 0 : (i.envTop || 0), expBase: resStand ? (i.innerH || 0) : ((i.envTop || 0) + (i.innerH || 0))
        };
      },
      mochiScreenAdj: { all: function () { return cur; } }
    },
    Math, JSON, parseFloat
  };
  const c = vm.createContext(sb);
  return vm.runInContext('(' + extractFn(deviceSrc, 'function screenFixCalc') + ')', c)(inp);
};
if (calcOk) {

  const baseInp = {
    standalone: true, envTop: 59, innerH: 740, screenH: 852, innerW: 390, screenW: 390,
    iosMajor: 18, safMajor: 18, andr: false, force: false,
    sbTop: 30, sbPadTop: '0px', diff: 112, vvH: 740, isMobileDev: true,
    phoneBottom: 852, tabBottom: 810, envBottom: 34
  };
  // B1 顶部重叠：sbEffTop=30 < envTop-5=54 → top +29
  const CUR0 = { top: 0, bottom: 0, h: 0, desk: 0, shift: 0, text: 0, side: 0 };
  const b1 = mk(Object.assign({}, baseInp), CUR0);
  note('B1', b1.some(s => s.axis === 'top' && s.delta === 29) && b1.some(s => /顶部重叠/.test(s.why)), '期望 top +29 建议，实得 ' + JSON.stringify(b1));
  // B2 顶部双倍避让：sbEffTop=200 > expTop+60=119 → top -(200-59)=-141 钳到 -80
  const b2 = mk(Object.assign({}, baseInp, { sbTop: 200 }), CUR0);
  note('B2', b2.some(s => s.axis === 'top' && s.delta === -80) && b2.some(s => /双倍避让/.test(s.why)), '期望 top -80（-141 钳位）建议，实得 ' + JSON.stringify(b2));
  // B3 底部少填：expBase=799，phoneBottom=700 → h +80 钳位（99→80）
  const b3 = mk(Object.assign({}, baseInp, { phoneBottom: 700, tabBottom: null }), CUR0);
  note('B3', b3.some(s => s.axis === 'h' && s.delta === 80) && b3.some(s => /少填/.test(s.why)), '期望 h +80（99 钳位）建议，实得 ' + JSON.stringify(b3));
  // B4 tabbar 被裁：期望底=799-34=765，tabBottom=810 → bottom +45；悬空：tabBottom=600 → bottom -80 钳位
  const b4a = mk(Object.assign({}, baseInp, { phoneBottom: 799, tabBottom: 810 }), CUR0);
  note('B4a', b4a.some(s => s.axis === 'bottom' && s.delta === 45), '期望 bottom +45 建议，实得 ' + JSON.stringify(b4a));
  const b4b = mk(Object.assign({}, baseInp, { phoneBottom: 799, tabBottom: 600 }), CUR0);
  note('B4b', b4b.some(s => s.axis === 'bottom' && s.delta === -80) && b4b.some(s => /悬空/.test(s.why)), '期望 bottom -80（-165 钳位）建议，实得 ' + JSON.stringify(b4b));
  // B5 已手动调过 top → 无 top 建议（其余照旧）
  const b5 = mk(Object.assign({}, baseInp), Object.assign({}, CUR0, { top: 20 }));
  note('B5', !b5.some(s => s.axis === 'top'), 'top 已调过仍出建议：' + JSON.stringify(b5));
  // B6 键盘停靠期：vv 缩 300（>inner×22%=163）→ 底部三条全豁免
  const b6 = mk(Object.assign({}, baseInp, { phoneBottom: 700, tabBottom: 810, vvH: 440 }), {});
  note('B6', !b6.some(s => s.axis === 'h' || s.axis === 'bottom'), '键盘停靠期仍出底部建议：' + JSON.stringify(b6));
  // B7 桌面模拟器外壳 → 底部三条全豁免
  const b7 = mk(Object.assign({}, baseInp, { phoneBottom: 700, tabBottom: 810, isMobileDev: false }), {});
  note('B7', !b7.some(s => s.axis === 'h' || s.axis === 'bottom'), '桌面外壳仍出底部建议：' + JSON.stringify(b7));
  // B8 正常贴合 → 空建议
  const b8 = mk(Object.assign({}, baseInp, { sbTop: 59, phoneBottom: 799, tabBottom: 760 }), {});
  note('B8', b8.length === 0, '正常形态应无建议，实得 ' + JSON.stringify(b8));
}

// ---- S1~S9：源码锚点 ----
const sChecks = [
  ['S1', adaptSrc.includes("side: 'screen-adj-side'") && adaptSrc.includes('side: [0, 12]'), 'mobile-adapt.js 缺 side 轴登记（KEYS/RANGE）'],
  ['S2', adaptSrc.includes("origSet('--mochi-side-adj', adj.side + 'px')"), 'mobile-adapt.js 缺 applySide 落层'],
  ['S3', (basecssSrc.match(/var\(--mochi-side-adj,0px\)/g) || []).length >= 5, 'base.css 消费 --mochi-side-adj 的 .phone 形态块不足 5 处（实得 ' + (basecssSrc.match(/var\(--mochi-side-adj,0px\)/g) || []).length + '）'],
  ['S4', deviceSrc.includes('window.mochiScreenFixSuggest = function'), 'device.js 未暴露 mochiScreenFixSuggest'],
  ['S5', deviceSrc.includes("label: '一键修正'"), 'device.js 诊断报告缺一键修正按钮'],
  ['S6', persoSrc.includes('window.mochiScreenFixSuggest ? window.mochiScreenFixSuggest() : []') && /k: 'side', name: '左右安全边'/.test(persoSrc), 'personalize.js 面板缺建议行或 side 轴行'],
  ['S7', persoSrc.includes("const MOCHI_ADJ_TAG = 'MCADJ1:'") && persoSrc.includes('adjCodeImport') && persoSrc.includes('adjCodeExport'), 'personalize.js 缺适配码导入/导出'],
  ['S8', tmplSrc.includes('id="modal-extra"') && persoSrc.includes('const cfg3 = opts.extraBtn || null;'), 'template/personalize 缺 extraBtn 按钮位或接线'],
  ['S9', backupSrc.includes('screen-adj-(top|bottom|h|desk|shift|text|side)'), 'data-backup.js 恢复确认缺屏幕偏移提醒'],
  ['S10', persoSrc.includes("holdBtn.addEventListener('pointerdown', holdOn)"), 'personalize.js 缺按住看默认按钮']
];
sChecks.forEach(([id, ok, why]) => note(id, EXPECT === 'red' ? !ok : ok, EXPECT === 'red' ? 'HEAD 对照本应缺失却仍在（红侧应红）：' + why : why));

// ---- 输出 ----
const pass = sChecks.length + 8 - failures.length;
if (failures.length) {
  console.log('❌ verify-screen-freedom ' + pass + '/' + (sChecks.length + 8) + '（' + (EXPECT === 'red' ? '红基线对照' : '绿侧') + '）');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('✅ verify-screen-freedom ' + (sChecks.length + 8) + '/' + (sChecks.length + 8) + (EXPECT === 'red' ? '（红基线全红=判别力确认）' : '（B1~B8 行为 + S1~S10 锚点）'));

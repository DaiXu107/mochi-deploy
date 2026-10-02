// 修复默认颜文字字卡里手机字体覆盖差的字符 → 替换成覆盖好、视觉相近的字符
// 用法: node tools/fix-kaomoji-chars.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, '..', 'src', 'js', 'default-cards-data.js');

// 字符替换映射（手机字体覆盖差 → 覆盖好、视觉相近）
// 只替换颜文字里出现的、手机系统字体大概率缺失字形的字符
const REPLACEMENTS = [
  [ '\u{1D17}', '\u03C9' ], // ᴗ LATIN SMALL LETTER OPEN E → ω GREEK SMALL LETTER OMEGA (视觉相近，都是小圆嘴)
  [ '\u203F', '_' ],       // ‿ UNDERTIE → _ LOW LINE
  [ '\uFE4F', '_' ],       // ﹏ DASHED LOW LINE → _ LOW LINE
  [ '\uFE3F', '_' ],       // ︿ (OVERLINE 呈现形式) → _ LOW LINE
  [ '\uFE35', '_' ],       // ︵ (OVERLINE 呈现形式) → _ LOW LINE
  [ '\u0831', '\u2022' ],  // ࡇ ARABIC LETTER HAH → • BULLET
  [ '\u{1DC4}', '' ],      // ᷄ COMBINING MACRON-MACRON BELOW → 删除
  [ '\u{1DC5}', '' ],      // ᷅ COMBINING MACRON-MACRON ABOVE → 删除
  [ '\u0348', '' ],        // ͈ COMBINING RING BELOW → 删除
  [ '\u0325', '' ],        // ̥ COMBINING DOT BELOW → 删除
  [ '\u0329', '' ],        // ̩ COMBINING VERTICAL LINE BELOW → 删除
  [ '\uFEA5', 'o' ],       // ڡ ARABIC LETTER PEH INITIAL FORM → o
  [ '\u25E1', '\u00B0' ],  // ◡ WHITE ARC UP → ° DEGREE SIGN
  [ '\u0847', '\u2022' ],  // ࡇ ARABIC LETTER PEH (Extended-A) → • BULLET
  [ '\uFE36', '_' ],       // ︶ (OVERLINE 呈现形式) → _ LOW LINE
  [ '\uFECC', 'o' ],       // ﻌ ARABIC LETTER AIN FINAL FORM → o
  [ '\uDC40', '' ],        // 孤立低代理项（无效 Unicode）→ 删除
  [ '\uFFFD', '\u{1F440}' ], // � REPLACEMENT CHARACTER → 👀 EYES（偷看颜文字）
  // 第二批（2026-08-29 用户反馈有的手机仍显示叉叉）：扫描剩余字符后补替换
  [ '\u{1D25}', '\u03C9' ],  // ᴥ LATIN LETTER AIN → ω（(U・ᴥ・U)→(U・ω・U)）
  [ '\u2256', '\uFFE3' ],    // ≖ RING IN EQUAL TO → ￣ 全角上横线（(≖ω≖)→(￣ω￣)）
  [ '\u25CD', '\u25CE' ],    // ◍ CIRCLE WITH VERTICAL FILL → ◎ 靶心圆（CJK 字体覆盖好）
  [ '\u2083', '3' ],         // ₃ SUBSCRIPT THREE → 3（(๑•́ ₃ •̀๑)→(๑•́ 3 •̀๑)）
  [ '\u275B', '\u02D8' ],    // ❛ HEAVY SINGLE COMMA QUOTE → ˘ BREVE（٩(๑❛ω❛๑)۶→٩(๑˘ω˘๑)۶）
];

const src = fs.readFileSync(file, 'utf8');
let changed = 0;
let result = src;
for (const [from, to] of REPLACEMENTS) {
  const count = result.split(from).length - 1;
  if (count > 0) {
    result = result.split(from).join(to);
    changed += count;
    console.log(`替换 U+${from.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')} → ${JSON.stringify(to)}: ${count} 处`);
  }
}

if (changed === 0) {
  console.log('无需替换');
  process.exit(0);
}

// 验证：执行文件内容，确认 DEFAULT_CARD_DATA 可正常加载
let data;
try {
  const sandbox = { window: {} };
  new Function('window', result)(sandbox.window);
  data = sandbox.window.DEFAULT_CARD_DATA;
} catch (e) { console.error('加载失败，未写入:', e.message); process.exit(1); }
if (!data || !data.kaomoji || !Array.isArray(data.kaomoji)) { console.error('kaomoji 结构异常，未写入'); process.exit(1); }
const kaoCount = data.kaomoji.reduce((s, g) => s + (g[1] ? g[1].length : 0), 0);
console.log(`验证通过：kaomoji ${data.kaomoji.length} 组共 ${kaoCount} 张，main ${data.main.length} 组`);

fs.writeFileSync(file, result, 'utf8');
console.log(`\n总计替换 ${changed} 处字符，已写入 ${path.relative(path.join(__dirname, '..'), file)}`);

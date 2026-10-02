// ===== 验证脚本：#426 日历留言纯文字口径 行为级回归 =====
// 背景：OPPO Reno6/雨见浏览器报「日历留言有乱码＝图片令牌」——#388 只守了自定义字卡循环，
// 默认主字卡循环漏过滤（「名称|||@@m:hash」型贴纸/语音卡拼进留言并持久化）；
// 且 #388 前已落盘的存量留言渲染直出令牌。修复=calTextOnly 统一选卡过滤 + calCleanMsg 渲染端剥令牌。
// 本脚本从 src/js/calendar.js 源码提取 calTextOnly/calCleanMsg 真实实现（非复刻）做断言。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(join(root, 'src/js/calendar.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// --- 提取真实函数体并求值 ---
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{');
  const m = re.exec(src);
  if (!m) throw new Error('源码中找不到 ' + name);
  let i = m.index + m[0].length, depth = 1, out = m[0];
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    out += ch;
    i++;
  }
  return out;
}
const calTextOnly = new Function('return ' + extractFn('calTextOnly'))();
const calCleanMsg = new Function('return ' + extractFn('calCleanMsg'))();

// --- calTextOnly：纯文字放行 ---
ok('T1 普通文本字卡放行', calTextOnly('今天也想对你说点什么') === true);
ok('T2 空串/非字符串拒绝', calTextOnly('') === false && calTextOnly(null) === false && calTextOnly(123) === false);
// 媒体令牌：全串（mochiMediaIsToken 锚定正则可测）与裸令牌混排（锚定正则测不出、indexOf 才拦得住）
ok('T3 全串媒体令牌拒绝', calTextOnly('@@m:654984e3d879e96b7bec1280b9a12b46') === false);
ok('T4 裸令牌混排拒绝（#388 漏网口径）', calTextOnly('想给你看一张图 @@m:654984e3d879e96b7bec1280b9a12b46 好看吗') === false);
// 贴纸/语音卡存储格式「名称|||data:…/名称|||@@m:hash」——默认主字卡循环此前的漏网主力
ok('T5 名称|||dataURL 贴纸卡拒绝', calTextOnly('可爱猫猫|||data:image/png;base64,iVBORw0KGgo') === false);
ok('T6 名称|||令牌 语音/贴纸卡拒绝', calTextOnly('语音留言|||@@m:ca8e20cbe3a0c92de2a78701b54bd49e') === false);
ok('T7 dataURL 开头图卡拒绝', calTextOnly('data:image/jpeg;base64,/9j/4AAQ') === false);

// --- calCleanMsg：存量落盘留言渲染端清洗 ---
ok('R1 令牌剥成 [图片]', calCleanMsg('看看这个 @@m:654984e3d879e96b7bec1280b9a12b46 好看吗') === '看看这个 [图片] 好看吗');
ok('R2 多令牌全剥', (calCleanMsg('@@m:654984e3d879e96b7bec1280b9a12b46和@@m:ca8e20cbe3a0c92de2a78701b54bd49e').match(/\[图片\]/g) || []).length === 2);
ok('R3 dataURL 剥成 [图片]', calCleanMsg('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg') === '[图片]');
ok('R4 纯文本原样保留', calCleanMsg('今天也想对你说点什么') === '今天也想对你说点什么');
ok('R5 非字符串原样返回（防渲染崩）', calCleanMsg(null) === null);
ok('R6 令牌格式要求 32 位十六进制（不误伤普通文本里的 @@m:）', calCleanMsg('@@m:not-a-token') === '@@m:not-a-token');

// --- 源码接线断言：默认主字卡循环必须也走过滤（本次漏网根因） ---
ok('W1 默认字卡循环接入 calTextOnly 过滤', /isOff\('main', c\)\) return; if \(!calTextOnly\(c\)\) return/.test(src));
ok('W2 两处渲染点（日历卡+今日留言横幅）都过 calCleanMsg', (src.match(/calCleanMsg\(e2?\.message\)/g) || []).length >= 2);

console.log(`verify-calendar-textonly: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

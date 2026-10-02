// ===== 验证脚本：#429 信件纯文字口径 行为级回归 =====
// 背景：OPPO Reno16 Via/Edge 报「信件乱码＝联系人字卡库图片令牌」（多机型同族 #426）——
// mailCardPool 默认主字卡三循环（defText/defKaomoji/defEmoji）零过滤、自定义循环的
// mochiMediaIsToken 全串锚定测不出裸令牌混排，贴纸/语音默认卡（「名称|||@@m:hash」
// 「名称|||audio;base64」）拼进信件并持久化；渲染端不剥「名称|||」前缀残留与非图片 base64。
// 修复=mailTextOnly 统一选卡过滤（indexOf 口径）+ mailCleanDisplay 渲染端清洗。
// 本脚本从 src/js/mail.js 源码提取 mailTextOnly/mailCleanDisplay 真实实现（非复刻）做断言。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(join(root, 'src/js/mail.js'), 'utf8');

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
// #1235 起 mailTextOnly/mailCleanDisplay 依赖文件顶部的统一判据常量块（MAIL_PAYLOAD_RE + mailIsImgRef，
// 借 chat.js #948 那一份），单抽函数会 ReferenceError ⇒ 一并抽出常量块并喂一个带令牌口径的 window。
const blkStart = src.indexOf('const MAIL_DATAURL_SRC =');
const blk = blkStart < 0 ? '' : src.slice(blkStart, src.indexOf('// v3.27.x 性能：load()', blkStart));
const win1235 = { mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s) };
const mkMail = (names) => new Function('window', blk + '\n' + names.map(extractFn).join('\n') +
  '\nreturn { ' + names.map((n) => n + ': ' + n).join(', ') + ' };')(win1235);
const { mailTextOnly, mailCleanDisplay } = mkMail(['mailTextOnly', 'mailCleanDisplay']);

// --- mailTextOnly：纯文字放行（信件正文/颜文字/emoji 池共用） ---
ok('T1 普通文本字卡放行', mailTextOnly('今晚的月色真温柔') === true);
ok('T2 颜文字/emoji 文本放行', mailTextOnly('(๑•́ ₃ •̀๑)') === true && mailTextOnly('🌸✨') === true);
ok('T3 空串/非字符串拒绝', mailTextOnly('') === false && mailTextOnly(null) === false && mailTextOnly(123) === false);
// 裸令牌混排：mochiMediaIsToken 全串锚定测不出、indexOf 才拦得住（#388 漏网口径）
ok('T4 裸令牌混排拒绝', mailTextOnly('想给你看一张图 @@m:654984e3d879e96b7bec1280b9a12b46 好看吗') === false);
// 贴纸/语音默认卡「名称|||data:…/名称|||@@m:hash」——默认主字卡三循环此前的漏网主力
ok('T5 名称|||dataURL 贴纸卡拒绝', mailTextOnly('可爱猫猫|||data:image/png;base64,iVBORw0KGgo') === false);
ok('T6 名称|||audio 语音卡拒绝', mailTextOnly('晚安语音|||audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMA') === false);
ok('T7 名称|||令牌卡拒绝', mailTextOnly('语音留言|||@@m:ca8e20cbe3a0c92de2a78701b54bd49e') === false);
ok('T8 dataURL 开头图卡拒绝', mailTextOnly('data:image/jpeg;base64,/9j/4AAQ') === false);

// --- mailCleanDisplay：存量落盘信件渲染端清洗（只洗显示不改历史数据） ---
ok('R1 「名称|||」前缀残留剥除（令牌交由 renderBody 内联渲染）', mailCleanDisplay('可爱猫猫|||@@m:654984e3d879e96b7bec1280b9a12b46') === '@@m:654984e3d879e96b7bec1280b9a12b46');
ok('R2 非图片 base64（语音等）剥成 [附件]', mailCleanDisplay('晚安语音|||audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMA') === '[附件]');
ok('R3 图片 dataURL 保留（renderBody RE 认它渲内联图，不误剥）', /data:image\/png;base64,iVBORw0KGgo/.test(mailCleanDisplay('看看 data:image/png;base64,iVBORw0KGgo 好看吗')));
ok('R4 纯文本原样保留', mailCleanDisplay('今晚的月色真温柔') === '今晚的月色真温柔');
ok('R5 非字符串原样返回（防渲染崩）', mailCleanDisplay(null) === null);

// --- 源码接线断言：默认主字卡三循环 + 自定义循环必须都走 mailTextOnly（本次漏网根因） ---
ok('W1 默认 main 循环接入 mailTextOnly', /isOff\('main', c\)\) return; if \(!mailTextOnly\(c\)\) return/.test(src));
ok('W2 默认 kaomoji 循环接入 mailTextOnly', /isOff\('kaomoji', c\)\) return; if \(!mailTextOnly\(c\)\) return/.test(src));
ok('W3 默认 emoji 循环接入 mailTextOnly', /isOff\('emoji', c\)\) return; if \(!mailTextOnly\(c\)\) return/.test(src));
ok('W4 自定义卡循环接入 mailTextOnly', /#429 过滤收敛到 mailTextOnly/.test(src));
ok('W5 渲染端两显示点（renderBody 正文+shortDesc 摘要）都过 mailCleanDisplay', (src.match(/mailCleanDisplay\(/g) || []).length >= 4);

console.log(`verify-mail-textonly: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

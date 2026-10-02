// ===== 验证脚本：#1235 信箱媒体载荷「统一判据」行为级回归（荣耀 100 + Edge 实报，多机型同族） =====
// 用户报障原话：「回信，主动发信和联系人发送的消息会有乱码／应该就是字卡库的图片变成了乱码和乱码
// 令牌／这个问题其他设备型号也有出现／之前修好过，现在这台手机又出现了」。
// 根因（零机型分支，全部只取字符串形态）：信箱自己另写了一份「串首小写 data:image/」判定（#429/#386/
// #533/#403 各补一种形态），而载荷形态由内核给出、无法约束——File.type 为空时 FileReader 产出
// "data:;base64,…"，相册/文件管理器给 "data:application/octet-stream;base64,…"，导入备份与老库里是
// 大写 MIME、前导空白、「名称|||」残名。变体既不被 renderBody 认作图、也不被 mailCleanDisplay 剥掉
// ⇒ 整段 base64 当正文铺出＝所见乱码；令牌前挂着没剥净的残名＝所见「乱码令牌」。
// 修复＝mail.js 四处消费者（渲染/清洗/选卡/附图池）全部改借 chat.js #948 那一份判据，并在落库口把
// 无 MIME 图片补正 MIME、大写折成小写（chat.js#948 明说：判据不留第二份＝本次乱码的复发土壤）。
// 本脚本从**真实源码**提取（非复刻）：chat.js 判据段 + media-pool 令牌口径 + mail.js 的 #1235 常量块
// 与 renderBody/shortDesc/mailCleanDisplay/mailPlainDesc/mailTextOnly/mailCanonPayload。
// 尺子：可见文字里出现 ≥120 字符的 base64 串／裸令牌／「|||」残名＝用户所见乱码，一条都不许有。
// 用法：node tools/verify-1235-mail-garble-unified.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const mailSrc = readFileSync(join(root, 'src/js/mail.js'), 'utf8');
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

function cut(src, start, end, label) {
  const s = src.indexOf(start);
  const e = s < 0 ? -1 : src.indexOf(end, s + 1);
  if (s < 0 || e < 0 || e <= s) {
    console.error('抽取失败（' + label + '）：找不到 ' + JSON.stringify(start) + ' 或收尾锚 ' + JSON.stringify(end));
    process.exit(2);
  }
  return src.slice(s, e);
}
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{');
  const m = re.exec(mailSrc);
  if (!m) { console.error('mail.js 中找不到函数 ' + name); process.exit(2); }
  let i = m.index + m[0].length, depth = 1, out = m[0];
  while (i < mailSrc.length && depth > 0) {
    const ch = mailSrc[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    out += ch; i++;
  }
  return out;
}

// ---- 红侧预检：统一口径整块被回退（并行会话旧缓冲写回）时按「回归失败」报 exit 1，
// 而不是抽取阶段 exit 2（环境不满足会被 verify-suite 记成非回归，掩盖真丢针）
const missing = ['const MAIL_DATAURL_SRC =', 'function mailIsImgRef', 'function mailCanonPayload', 'function mailPlainDesc']
  .filter((a) => !mailSrc.includes(a));
if (missing.length) {
  console.error('  ✗ #1235 统一口径整块不在 src/js/mail.js（回退/丢针）：' + missing.join(' | '));
  console.log('verify-1235-mail-garble-unified: 0 通过 / 1 失败');
  process.exit(1);
}

// ---- 沙箱：chat.js #948 判据段（真实实现）挂到 window，mail.js 借用 ----
const win = { mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s) };
const judgeSrc = cut(chatSrc, 'function chatIsImageUrlCard(', 'function getPool() {', 'chat.js 判据段');
new Function('env', 'with (env) { ' + judgeSrc + ' }')({ window: win, String, Math, RegExp, JSON });
ok('S0 chat.js #948 判据可求值且已导出（信箱借的就是这一份）',
  !!(win.chatIsImgSrcLike && win.chatIsDataImgLikeSrc && win.chatFixNoMimeImg && win.chatHasMediaPayload && win.chatIsDataAudioSrc));

const mailBlock = cut(mailSrc, 'const MAIL_DATAURL_SRC =', '// v3.27.x 性能：load()');
const mailCode = mailBlock + '\n' + ['escHtml', 'renderBody', 'shortDesc', 'mailCleanDisplay', 'mailPlainDesc', 'mailTextOnly', 'mailCanonPayload'].map(extractFn).join('\n');
const M = new Function('env', 'with (env) { ' + mailCode + '\n return { renderBody, shortDesc, mailCleanDisplay, mailPlainDesc, mailTextOnly, mailCanonPayload }; }')({ window: win, String, Math, RegExp, JSON });

// ---- 夹具：同一张 1×1 PNG 的各种「内核回执形态」----
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAPg';
const MIX = 'iVBORw0KGg' + 'oABC' + 'def123+/=' + 'AAAACCAYAAABytg0k';
const TOK = '@@m:654984e3d879e96b7bec1280b9a12b46';
const AUDIO = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMA';
const variants = [
  ['规范图片 dataURL', `看这个 data:image/png;base64,${PNG} 好可爱`],
  ['大写 MIME', `看这个 data:IMAGE/png;base64,${PNG} 好可爱`],
  ['大写 data 前缀', `看这个 DATA:image/png;base64,${PNG} 好可爱`],
  ['无 MIME（File.type 为空）', `看这个 data:;base64,${PNG} 好可爱`],
  ['octet-stream（相册/文件管理器）', `看这个 data:application/octet-stream;base64,${PNG} 好可爱`],
  ['前导空白载荷', `看这个   data:image/png;base64,${PNG}`],
  ['sticker: + 无 MIME', `哈哈 sticker:data:;base64,${PNG} 嘻嘻`],
  ['image: + 大写 MIME', `晚安 image:DATA:image/jpeg;base64,${PNG}`]
];

// ---- 尺子：去掉 <img> 标签后的可见文字里不许有 base64／裸令牌／||| 残名 ----
const visible = (html) => String(html).replace(/<img\b[^>]*>/g, ' ');
const garble = (html) => {
  const t = visible(html);
  return /[A-Za-z0-9+/]{120,}/.test(t) || /@@m:[0-9a-f]{32}/.test(t) || t.includes('|||');
};

// ---- B1 显示层：八种图片形态变体全部渲成图、零乱码 ----
for (const [name, s] of variants) {
  const html = M.renderBody(s, false);
  ok('B1 ' + name + ' → 渲内联图', /<img\b[^>]*class="mail-body-img"/.test(html), html.slice(0, 90));
  ok('B1 ' + name + ' → 信纸零乱码', !garble(html), html.slice(0, 90));
  ok('B1 ' + name + ' → 摘要零乱码', !garble(M.shortDesc(s, false)), M.shortDesc(s, false));
  ok('B1 ' + name + ' → 横幅零乱码', !garble(M.mailPlainDesc('给你寄来了一封信：' + s)), String(M.mailPlainDesc('给你寄来了一封信：' + s)).slice(0, 90));
}

// ---- B2 存量令牌/残名：清洗层收口（只洗显示，不改历史数据） ----
{
  const cases = [
    ['裸令牌夹正文', `想给你看 ${TOK} 好看吗`, false],
    ['sticker: 令牌', `哈哈 ${'sticker:' + TOK} 嘻嘻`, false],
    ['名称|||令牌（无空格文件名）', `可爱猫猫|||${TOK}`, false],
    ['名称|||令牌（带空格文件名）', `my cat photo.png|||${TOK}`, true],
    ['名称|||令牌（超 40 字名称）', `${'很'.repeat(45)}猫.png|||${TOK}`, true],
    ['语音卡（audio dataURL）', `晚安语音|||${AUDIO}`, false]
  ];
  for (const [name, s, noName] of cases) {
    const html = M.renderBody(s, false);
    ok('B2 ' + name + ' → 零乱码', !garble(html), html.slice(0, 90));
    ok('B2 ' + name + ' → 摘要零乱码', !garble(M.shortDesc(s, false)), M.shortDesc(s, false));
    if (noName) ok('B2 ' + name + ' → 残名整段剥净', !/\.png/.test(visible(html)), visible(html).slice(0, 60));
  }
  ok('B2 令牌解回真图交给媒体池（renderBody 把令牌原样放进 <img src>，删则图永久退化）',
    /src="' ?\+ ?attrs|@@m:654984e3d879e96b7bec1280b9a12b46/.test(M.renderBody(TOK, false)), M.renderBody(TOK, false).slice(0, 80));
  ok('B2 语音载荷收成 [附件]（不铺 base64、也不误当图片渲）',
    M.mailCleanDisplay(AUDIO) === '[附件]' && !/audio/i.test(M.mailCleanDisplay(AUDIO)));
}

// ---- B3 选卡闸门：变体媒体卡不得进「文字池」拼进信件正文（来信乱码的直接产生现场） ----
{
  const mustOut = [
    ['串首无 MIME 载荷', `data:;base64,${PNG}`],
    ['前导空白＋大写 MIME', ` DATA:IMAGE/PNG;base64,${PNG}`],
    ['正文中间夹带 octet-stream', `看这个 data:application/octet-stream;base64,${PNG}`],
    ['正文中间夹带令牌', `想给你看一张图 ${TOK} 好看吗`],
    ['名称|||令牌贴纸卡', `可爱猫猫|||${TOK}`],
    ['名称|||audio 语音卡', `晚安语音|||${AUDIO}`],
    ['图床直链卡', 'https://img.example.com/a/IMG_2343.png'],
    // chatHasMediaPayload 的夹带口径要求载荷前有空格；sticker:/image: 紧邻前缀没有空格
    ['sticker: 紧邻无 MIME 载荷', `sticker:data:;base64,${PNG}`],
    ['image: 紧邻大写 MIME', `image:DATA:IMAGE/png;base64,${PNG}`]
  ];
  for (const [name, c] of mustOut) ok('B3 ' + name + ' → 拒绝进文字池', M.mailTextOnly(c) === false, c.slice(0, 60));
  const mustIn = [['普通文本', '今晚的月色真温柔'], ['颜文字', '(๑•́ ₃ •̀๑)'], ['句子里的 data: 字样不误伤', 'I keep my data: safe and sound']];
  for (const [name, c] of mustIn) ok('B3 ' + name + ' → 正常放行', M.mailTextOnly(c) === true, c);
}

// ---- B4 落库口规范化：只改形态，逗号后的载荷一个字不动 ----
{
  ok('B4 无 MIME 图片按魔数补正 MIME', M.mailCanonPayload(`data:;base64,${PNG}`) === `data:image/png;base64,${PNG}`, M.mailCanonPayload(`data:;base64,${PNG}`).slice(0, 60));
  ok('B4 大写 data/MIME 折成小写', M.mailCanonPayload(`DATA:IMAGE/PNG;base64,${PNG}`) === `data:image/png;base64,${PNG}`);
  ok('B4 逗号后 base64 原样（大小写/+/= 不许动）', M.mailCanonPayload(`data:IMAGE/png;base64,${MIX}`).endsWith(',' + MIX));
  ok('B4 幂等（规范化两次＝一次）', M.mailCanonPayload(M.mailCanonPayload(`data:;base64,${PNG}`)) === M.mailCanonPayload(`data:;base64,${PNG}`));
  ok('B4 无魔数的无 MIME 载荷不强补（留给清洗层收 [附件]）', M.mailCanonPayload('data:;base64,AAAA') === 'data:;base64,AAAA');
  ok('B4 纯文本/非字符串原样返回', M.mailCanonPayload('今晚的月色') === '今晚的月色' && M.mailCanonPayload(null) === null);
  ok('B4 多载荷同串逐个规范化', (M.mailCanonPayload(`a data:IMAGE/png;base64,${PNG} b data:;base64,${PNG} c`)
    === `a data:image/png;base64,${PNG} b data:image/png;base64,${PNG} c`));
}

// ---- S 结构接线：判据不留第二份（BUGS #948 铁律；本次复发的直接土壤） ----
ok('S1 mailIsImgRef 借 chat.js 口径（不自写精确前缀）', /function mailIsImgRef\(s\) \{[\s\S]{0,80}window\.chatIsImgSrcLike/.test(mailSrc));
ok('S2 渲染端兜底走统一口径（不是图片引用就不铺载荷）', /if \(!mailIsImgRef\(src\)\) return seg\(window\.chatIsDataAudioSrc/.test(mailSrc));
ok('S3 清洗层载荷分类走 MAIL_PAYLOAD_RE + mailIsImgRef', /return t\.replace\(MAIL_PAYLOAD_RE, function \(m\) \{\s*if \(!mailIsImgRef\(m\)\) return '\[附件\]'/.test(mailSrc));
ok('S4 选卡闸门借 chatHasMediaPayload（旧的五个串首口径测不出变体）', /if \(window\.chatHasMediaPayload && window\.chatHasMediaPayload\(c\)\) return false;/.test(mailSrc));
ok('S4b 选卡闸门再兜一层载荷切片探测（sticker:/image: 紧邻前缀没有空格）', /if \(c\.search\(MAIL_PAYLOAD_RE\) >= 0\) return false;/.test(mailSrc));
ok('S5 附图池选卡走 mailIsImgRef（删则无 MIME/大写变体抽不到图）', /s\.indexOf\('http'\) !== 0 && mailIsImgRef\(s\)/.test(mailSrc));
ok('S6 摘要与横幅合一走 mailPlainDesc（两处弹窗各写一份正则＝本次漏网）', (mailSrc.match(/mailPlainDesc\(/g) || []).length >= 4 &&
  /window\.showDeskPopup\(\{ name: '信箱', text: mailPlainDesc\(/.test(mailSrc));
ok('S7 落库口规范化已接入（发信/回信/TA 写信/两处插入口）', (mailSrc.match(/mailCanonPayload\(/g) || []).length >= 7 &&
  /return mailCanonPayload\(t\);/.test(mailSrc) &&
  /const content = input \? mailCanonPayload\(readMailVal\(input\)\)\.trim\(\) : '';/.test(mailSrc) &&
  /mailInsertInto\(textarea, 'image:' \+ mailCanonPayload\(reader\.result\)\)/.test(mailSrc) &&
  /'sticker:' \+ mailCanonPayload\(src\)/.test(mailSrc));
ok('S8 旧的「非图片 dataURL」窄口径不回流（data:(?!image/) 精确前缀＝复发土壤）', !mailSrc.includes('data:(?!image/'));
ok('S9 renderBody 仍把令牌分支放在末位（#386 针的形态锚，改序＝哑哨兵）', mailSrc.includes('|@@m:[0-9a-f]{32})/g'));
ok('S10 零机型分支：mail.js 不读 navigator.userAgent/机型名单', !/userAgent|Maxthon|HeyTap|MicroMessenger|iPhone|Android/i.test(mailSrc.replace(/v3\.\d+(\.\d+)? #\d+[^\n]*iPhone[^\n]*\n/g, '')));

console.log(`verify-1235-mail-garble-unified: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

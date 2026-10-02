// ===== 验证脚本：#1235e 字卡库网格「统一判据」行为级回归（荣耀 100 + Edge 实报，多机型同族） =====
// 用户报障原话：「主动发信和联系人发送的消息会有乱码／应该就是字卡库的图片变成了乱码和乱码令牌／
// 这个问题其他设备型号也有出现／之前修好过，现在这台手机又出现了」。
// 本批是同一句报障的**库内侧影**（信箱那半＝#1235a~d，见 verify-1235-mail-garble-unified.mjs）：
// chatcard.js 的 cardItemHtml／两条点击路径／列表内联搜索各自写了「串头小写精确前缀」判定
// （c.indexOf('@@m:') === 0、c.indexOf('data:') === 0），只认规范形态；而库里图片载荷的来路有五种
// ——#554 令牌化保留的「名称|||@@m:hash」、File.type 空的 data:;base64,、文件管理器给的
// data:application/octet-stream;base64,、备份/老库里的大写 MIME 与前导空白。「名称|||」前缀那两类、
// 以及大写 MIME／前导空白两类**全部掉进末行文字分支**＝网格直出「@@m:hex32」或几百 KB base64（＝用户
// 所见乱码/乱码令牌；同一份判据喂八形态的实测：HEAD 4/8 直出乱码）；另两类小写串头形态旧分支虽渲成
// <img>，但无 MIME 那条不补 MIME、纯靠内核嗅探＝部分内核白块，本批交 chatFixNoMimeImg 补正。
// 修复＝判定一份不写：卡体是不是媒体、是图还是音，全部交回 chat.js #948 那一份判据
// （chatIsImgSrcLike / chatIsInlineDataSrc / chatIsDataAudioSrc / chatFixNoMimeImg）。
// 本脚本从**真实源码**提取（非复刻）：chat.js #948 判据段 + chatcard.js 的 ccCardSplit/ccCardMedia/
// cardItemHtml/ccNameBadgeHtml/ccCardMatchText。
// 尺子：格子的**可见文字**里出现 ≥120 字符的 base64／裸令牌／「|||」残名＝用户所见乱码，一条不许有；
// 同时图片形态必须仍然渲成 <img class="cc-img">（只把乱码藏起来、图也没了＝假绿）。
// 用法：node tools/verify-1235e-ccgrid-garble.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const ccSrc = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');
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
  const m = re.exec(ccSrc);
  if (!m) { console.error('chatcard.js 中找不到函数 ' + name); process.exit(2); }
  let i = m.index + m[0].length, depth = 1, out = m[0];
  while (i < ccSrc.length && depth > 0) {
    const ch = ccSrc[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    out += ch; i++;
  }
  return out;
}

// ---- 红侧预检：统一口径整块被回退（并行会话旧缓冲写回）时按「回归失败」报 exit 1，
// 而不是抽取阶段 exit 2（环境不满足会被 verify-suite 记成非回归，掩盖真丢针）
const missing = ['function ccCardSplit(c) {', 'function ccCardMedia(c) {', 'const cm = ccCardMedia(c);', 'const cm = ccCardMedia(it.c);', 'if (ccCardMedia(c) || c.indexOf(\'@@m:\') >= 0) return \'\';']
  .filter((a) => !ccSrc.includes(a));
if (missing.length) {
  console.error('  ✗ #1235e 统一口径整块不在 src/js/chatcard.js（回退/丢针）：' + missing.join(' | '));
  console.log('verify-1235e-ccgrid-garble: 0 通过 / 1 失败');
  process.exit(1);
}

// ---- 沙箱：chat.js #948 判据段（真实实现）挂到 window，chatcard.js 借用 ----
const win = {
  mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s),
  mochiMediaTokenMissing: () => win.__tokMissing === true,
  mochiMediaExpand: (t) => (win.__tokMissing ? null : 'data:image/png;base64,EXPANDED')
};
const judgeSrc = cut(chatSrc, 'function chatIsImageUrlCard(', 'function getPool() {', 'chat.js #948 判据段');
new Function('env', 'with (env) { ' + judgeSrc + ' }')({ window: win, String, Math, RegExp, JSON });
ok('S0 chat.js #948 判据可求值且已导出（字卡库借的就是这一份）',
  !!(win.chatIsImgSrcLike && win.chatIsInlineDataSrc && win.chatIsDataAudioSrc && win.chatFixNoMimeImg));

// cur / manageMode / ccCardName 在真机上是模块闭包量，这里挂到 env 上按用例改；
// 提取出的函数靠 `with` 作用链在**调用时**解析它们，与模块内同源。
const env = { window: win, String, Math, RegExp, JSON, cur: 'sticker', manageMode: false, cardName: '', CC_NAME_BTN_CSS: 'position:absolute', CC_NAME_CAP_CSS: 'position:absolute' };
const escStub = "const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');";
const ccCode = escStub + '\nconst ccCardName = () => env2.cardName;\n' +
  ['ccCardSplit', 'ccCardMedia', 'cardItemHtml', 'ccNameBadgeHtml', 'ccCardMatchText'].map(extractFn).join('\n');
const C = new Function('env2', 'with (env2) { ' + ccCode + "\n return { ccCardSplit, ccCardMedia, cardItemHtml, ccNameBadgeHtml, ccCardMatchText }; }")(env);

// ---- 夹具：同一张图/一段音频在各种「内核回执形态」下的字卡 ----
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAPg';
const TOK = '@@m:654984e3d879e96b7bec1280b9a12b46';
const AUDIO = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMA';
const BIN = 'data:application/octet-stream;base64,' + PNG;
const IMG = 'data:image/png;base64,' + PNG;
// 用户所见「乱码」的两种形状：长 base64 串、裸令牌串
const LONG_B64 = /base64,[A-Za-z0-9+/=]{120,}/;
const BARE_TOK = /@@m:[0-9a-f]{32}/;
const LEAK = (html) => LONG_B64.test(html) || BARE_TOK.test(html) || /\|\|\|/.test(html);
// 只看可见文字（data-src 里当然该有载荷，那不是「铺出来给用户看」）
const visible = (html) => html.replace(/data-src="[^"]*"/g, '').replace(/title="[^"]*"/g, '');
const imgForms = [
  ['规范图片 dataURL', IMG],
  ['octet-stream（文件管理器给的）', BIN],
  ['无 MIME 图片（File.type 为空）', 'data:;base64,' + PNG],
  ['大写 MIME', 'DATA:IMAGE/PNG;base64,' + PNG],
  ['前导空白', ' ' + IMG],
  ['媒体池令牌', TOK],
  ['名称|||令牌（#554 令牌化保留前缀）', '可爱猫猫|||' + TOK],
  ['名称|||octet-stream', '晚安图|||' + BIN]
];

// ---- A 网格渲染：八种形态既不许直出乱码，也必须仍然是一张图 ----
for (const [name, card] of imgForms) {
  env.cur = 'sticker'; env.cardName = ''; win.__tokMissing = false;
  const h = C.cardItemHtml(card);
  ok('A ' + name + ' → 渲成缩略图', h.indexOf('class="cc-img"') >= 0 && h.indexOf('data-src="') >= 0, h.slice(0, 90));
  ok('A ' + name + ' → 可见文字零乱码', !LEAK(visible(h)), visible(h).slice(0, 90));
}
// 点击判定必须与网格同源：凡是画成图的那张卡，ccCardMedia 都得认它是图（否则点开＝文字编辑弹窗）
for (const [name, card] of imgForms) {
  const m = C.ccCardMedia(card);
  ok('A2 ' + name + ' → 点击查看大图口径同步（img:true）', !!(m && m.img === true), JSON.stringify(m));
}

// ---- B 池里确认缺失的令牌：#387/#493 同口径文字占位，不发白块、不直出令牌 ----
{
  env.cur = 'sticker'; win.__tokMissing = true;
  const h = C.cardItemHtml(TOK);
  ok('B 缺失令牌 → [图片丢失] 占位', h.indexOf('>[图片丢失]<') > 0, h);
  ok('B 缺失令牌 → 不再挂 <img>', h.indexOf('cc-img') < 0, h);
  const h2 = C.cardItemHtml('可爱猫猫|||' + TOK);
  ok('B2 缺失令牌的「名称|||令牌」卡同样走占位（旧口径直出整串乱码令牌）', h2.indexOf('>[图片丢失]<') > 0 && !LEAK(visible(h2)), h2);
  win.__tokMissing = false;
}

// ---- C 非图片内联载荷：收成一条标注，绝不铺 base64 ----
{
  env.cur = 'sticker';
  const a = C.cardItemHtml(AUDIO);
  ok('C 裸音频 dataURL（旧口径当 <img> 渲染＝坏图）→ [语音] 标注', a.indexOf('[语音]') > 0 && a.indexOf('cc-img') < 0 && !LEAK(visible(a)), visible(a).slice(0, 80));
  const b = C.cardItemHtml('data:;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  ok('C 无 MIME 且魔数非图 → [附件] 标注', b.indexOf('[附件]') > 0 && !LEAK(visible(b)), visible(b).slice(0, 80));
  const c = C.cardItemHtml('晚安语音|||' + AUDIO.toUpperCase().replace('DATA:AUDIO/MPEG', 'DATA:AUDIO/MPEG'));
  ok('C 变体音频卡（大写 MIME）→ 标注带名称且不直出载荷', c.indexOf('[语音]') > 0 && c.indexOf('晚安语音') > 0 && !LEAK(visible(c)), visible(c).slice(0, 80));
  ok('C2 变体音频卡不认作图（点击不落文字编辑器也不 viewImage）', !!(C.ccCardMedia('晚安语音|||' + AUDIO) && C.ccCardMedia('晚安语音|||' + AUDIO).img === false));
}

// ---- D 文字卡零误伤：形态各异的正文照旧走文字分支，一字不改 ----
{
  const texts = ['今晚的月色真温柔', '(๑•́ ₃ •̀๑)|||(๑ᵒ̴̶̷̤ ᵒ̴̶̷̤)', 'I keep my data: safe and sound', '哈哈|||晚安', 'https://example.com/a.png'];
  for (const t of texts) {
    env.cur = 'text';
    const h = C.cardItemHtml(t);
    const keep = t === 'https://example.com/a.png' ? h.indexOf('cc-img') >= 0 : h.indexOf('class="t"') >= 0 && h.indexOf('&') < 0;
    ok('D 文字卡 ' + JSON.stringify(t.slice(0, 20)) + ' → 仍按正文渲染（零误伤）', keep, h.slice(0, 90));
    if (t !== 'https://example.com/a.png') ok('D 同卡不认作媒体', C.ccCardMedia(t) === null, JSON.stringify(C.ccCardMedia(t)));
  }
  env.cur = 'text';
  ok('D2 「名称|||图链」维持旧行为（链卡带残名时不认作图，链接本身可读＝非乱码）', C.ccCardMedia('可爱|||https://x.com/a.png') === null);
}

// ---- E 名称标签：修完乱码后卡体内嵌名称不许一起消失 ----
{
  env.cur = 'sticker'; env.manageMode = false; env.cardName = '';
  const badge = C.ccNameBadgeHtml('可爱猫猫|||' + TOK, '可爱猫猫');
  ok('E names 映射无记录时用卡体内嵌名称兜底', badge.indexOf('可爱猫猫') > 0, badge.slice(0, 120));
  env.cardName = '存图';
  ok('E2 names 映射有记录时仍以映射为准（兜底不覆盖用户改名）', C.ccNameBadgeHtml('可爱猫猫|||' + TOK, '可爱猫猫').indexOf('存图') > 0);
  env.cardName = '';
  ok('E3 非图片分类不叠名称按钮（#680 行为不变）', (env.cur = 'text', C.ccNameBadgeHtml('可爱猫猫|||' + TOK, '可爱猫猫') === ''));
}

// ---- F 列表内联搜索：媒体形态一律不进正文匹配（否则搜索结果列表直出乱码） ----
{
  for (const [name, card] of imgForms) {
    ok('F ' + name + ' → 搜索可匹配文本为空', C.ccCardMatchText(card, 'text') === '', JSON.stringify(C.ccCardMatchText(card, 'text')));
  }
  env.cur = 'text';
  ok('F2 普通文字照旧按正文匹配', C.ccCardMatchText('今晚的月色', 'text') === '今晚的月色');
  ok('F3 句中 data: 字样不误伤', C.ccCardMatchText('I keep my data: safe', 'text') === 'i keep my data: safe');
  ok('F4 残令牌（@@m: 开头但不是完整 32 hex）也挡在正文外', C.ccCardMatchText('@@m:xyz', 'text') === '');
  ok('F5 语音存量卡按名称前缀匹配（载荷不进正文）', C.ccCardMatchText('晚安|||' + AUDIO, 'voice') === '晚安');
  ok('F6 变体音频卡（大写 MIME）不再把整串 base64 当正文', C.ccCardMatchText('晚安|||' + AUDIO.toUpperCase(), 'voice') === '晚安');
  ok('F7 含 ||| 的颜文字仍按正文匹配', C.ccCardMatchText('(哈哈)||(嘻嘻)', 'text') === '(哈哈)||(嘻嘻)');
}

// ---- G 语音卡播放链路零回归：规范「名称|||data:audio」仍出播放按钮（本批刻意不动语音族） ----
{
  env.cur = 'voice';
  const h = C.cardItemHtml('晚安|||' + AUDIO);
  ok('G 规范语音卡仍是播放按钮 + 名称（本批不碰语音族）', h.indexOf('cc-play') >= 0 && h.indexOf('晚安') >= 0, visible(h).slice(0, 80));
  ok('G2 规范语音卡不会被媒体判定劫走（ccCardMedia 只认图片令牌/内联载荷/裸链）', C.ccCardMedia('晚安|||' + AUDIO).img === false);
}

// ---- S 结构与接线（零机型分支＋两条点击路径＋既有针面原文在位） ----
{
  ok('S1 点击·同步渲染路径接统一判据', ccSrc.indexOf('const cm = ccCardMedia(c);') > 0);
  ok('S2 点击·分块渲染路径接统一判据', ccSrc.indexOf('const cm = ccCardMedia(it.c);') > 0);
  ok('S3 #493 针面原文在位（同步路径）', ccSrc.indexOf('viewImage(v || c);') > 0);
  ok('S4 #493 针面原文在位（分块路径）', ccSrc.indexOf('viewImage(v || it.c);') > 0);
  ok('S5 #493/#387 缺失令牌占位文案在位', ccSrc.indexOf('style="color:var(--muted)">[图片丢失]</div></div>\';') > 0);
  ok('S6 网格不再自带第二份判定（cardItemHtml 体内无 @@m: 串首判定）', cut(ccSrc, 'function cardItemHtml(c) {', '\n  // #680：图片/表情包格的名称标签', 'cardItemHtml').indexOf("indexOf('@@m:') === 0") < 0);
  ok('S7 网格不再自带第二份判定（cardItemHtml 体内无 data: 串首判定）', cut(ccSrc, 'function cardItemHtml(c) {', '\n  // #680：图片/表情包格的名称标签', 'cardItemHtml2').indexOf("indexOf('data:') === 0") < 0);
  ok('S8 内联载荷分类只借 chat.js 一份口径（无第二份 image/ 正则）', (ccSrc.slice(ccSrc.indexOf('function ccCardMedia'), ccSrc.indexOf('function cardItemHtml')).match(/\/\^data:image\//g) || []).length === 0);
  ok('S9 回复池／话术池成员判定未被本批改动（爆炸半径收在展示面）', ccSrc.indexOf('function isMediaImg(c) {') > 0 && ccSrc.indexOf('function ccFuncTextOnly(c) {') > 0);
  ok('S10 零机型／零 UA 分支（chatcard.js 不读 userAgent）', (ccSrc.match(/userAgent/g) || []).length === 0);
}

console.log('verify-1235e-ccgrid-garble: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

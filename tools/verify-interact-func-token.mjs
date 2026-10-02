// ===== 验证脚本：#648 互动卡/功能字卡池令牌乱码收口 行为级回归 =====
// 背景：vivo V2528A+Edge（等多机型同报，#383 令牌直出家族第四次复发）——「联系人发送的
// 图片变成令牌乱码，联系人卡片互动的回复也是令牌乱码」。根因两层（零机型分支）：
//   ①源头：#554「字卡图去重入库」/#632 自动瘦身把字卡库 ≥CC_CC_TOK_MIN 的内联图整库替换成
//     @@m: 令牌（字符串级替换不分分类），getCustomFuncCards（互动回应/查岗/游戏/摸鱼等
//     功能池的唯一自定义来源）旧过滤只挡 data:——令牌/裸图链/「名称|||data:」卡全漏进
//     文字话术池；chat.js 询问回应分支还绕过 pickAskCardReply 裸抽 pool[random]。
//   ②展示：已落库的存量媒体回应（rec.askReply/choiceReply/curiousReply/roastReply/
//     inviteAnswer）在互动卡「TA：」行/结果弹窗/收藏快照用 escTxt 直出令牌串。
// 修复＝getCustomFuncCards 源头补 ccFuncTextOnly 四道守卫 + pickAskCardReply 预设池同款
// 过滤 + 询问回应走 pickAskCardReply + askCardReplyClean 存量展示清洗（只洗显示不改数据）。
// 本脚本从 src 提取真实函数体（非复刻）做行为断言 + 接线断言。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const ccSrc = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');
const taSrc = readFileSync(join(root, 'src/js/ta-ask.js'), 'utf8');
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// --- 提取真实函数体并求值 ---
function extractFn(src, name) {
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
// chatcard.js 是 IIFE 内函数，依赖 window.mochiMediaIsToken——用假窗求值
const fakeWindow = { mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s) };
const ccFuncTextOnly = new Function('window', 'return ' + extractFn(ccSrc, 'ccFuncTextOnly'))(fakeWindow);
// chat.js 的 askCardReplyClean 依赖同文件的 chatIsImageUrlCard——一并提取注入
const chatIsImageUrlCard = new Function('return ' + extractFn(chatSrc, 'chatIsImageUrlCard'))();
const askCardReplyClean = new Function('chatIsImageUrlCard', 'return ' + extractFn(chatSrc, 'askCardReplyClean'))(chatIsImageUrlCard);

// --- A. ccFuncTextOnly：功能池四道守卫（对应 getCustomCards 消费端 #383/#388/#533 口径） ---
ok('A1 普通文字话术放行', ccFuncTextOnly('今晚想你了') === true);
ok('A2 颜文字/emoji 话术放行', ccFuncTextOnly('(๑•́ ₃ •̀๑)') === true && ccFuncTextOnly('🌸✨') === true);
ok('A3 空串/纯空白/非字符串拒绝', ccFuncTextOnly('') === false && ccFuncTextOnly('   ') === false && ccFuncTextOnly(null) === false && ccFuncTextOnly(123) === false);
ok('A4 data: 载荷卡拒绝', ccFuncTextOnly('data:image/png;base64,iVBORw0KGgo') === false);
ok('A5 裸令牌卡拒绝（#554/#632 全库令牌化产物）', ccFuncTextOnly('@@m:654984e3d879e96b7bec1280b9a12b46') === false);
ok('A6 裸 http(s) 图链卡拒绝（链接导入回退形态）', ccFuncTextOnly('https://img.heliar.top/file/1778238597646_x.png') === false);
ok('A7 名称|||令牌 卡拒绝', ccFuncTextOnly('语音留言|||@@m:ca8e20cbe3a0c92de2a78701b54bd49e') === false);
ok('A8 名称|||dataURL 卡拒绝', ccFuncTextOnly('可爱猫猫|||data:image/png;base64,iVBORw0KGgo') === false);
ok('A9 文内含 @@m: 子串的令牌卡拒绝（全串锚定测不出嵌套，indexOf 才拦得住）', ccFuncTextOnly('看这张 @@m:654984e3d879e96b7bec1280b9a12b46 好看吗') === false);

// --- B. getCustomFuncCards 双循环接线（专属 + 公用都必须走 ccFuncTextOnly） ---
ok('B1 专属功能池循环接入 ccFuncTextOnly', /grp\[1\]\.forEach\(c => \{ if \(ccFuncTextOnly\(c\)\) map\[k\]\.push\(c\); \}\)/.test(ccSrc));
ok('B2 公用功能池循环接入 ccFuncTextOnly', /grp\[1\]\.forEach\(c => \{ if \(ccFuncTextOnly\(c\)\) out\.push\(c\); \}\)/.test(ccSrc));
ok('B3 旧「只挡 data:」过滤不再存在于功能池双循环', !/indexOf\('data:'\) !== 0\) (map\[k\]\.push\(c\)|out\.push\(c\))/.test(ccSrc));

// --- C. pickAskCardReply：预设池媒体过滤（上层裸抽直传的媒体卡不再原样返回） ---
const presetFilterLine = (taSrc.split('\n').find(l => l.indexOf('c.indexOf(\'data:\') === 0') >= 0) || '');
ok('C1 预设池过滤行存在且含四形态判定', presetFilterLine.indexOf("c.indexOf('data:') === 0") >= 0
  && presetFilterLine.indexOf("c.indexOf('|||') >= 0") >= 0
  && presetFilterLine.indexOf('https?') >= 0
  && presetFilterLine.indexOf('window.mochiMediaIsToken && window.mochiMediaIsToken(c)') >= 0);

// --- D. chat.js 询问回应不再裸抽（与吐槽/好奇分支同走 pickAskCardReply） ---
ok('D1 询问回应分支走 pickAskCardReply(pool)', /window\.chatAskReply\(idx, v, \(window\.pickAskCardReply \? window\.pickAskCardReply\(pool\) : pool\[Math\.floor\(Math\.random\(\) \* pool\.length\)\]\)\)/.test(chatSrc));

// --- E. askCardReplyClean：存量媒体回应展示清洗（只洗显示，不改历史数据） ---
ok('E1 整条图片直链→[图片]', askCardReplyClean('https://img.heliar.top/file/1778238597646_%E5%92%8B%E8%BF%99%E6%A0%B7.png') === '[图片]');
ok('E2 整条 data: base64→[图片]', askCardReplyClean('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ') === '[图片]');
ok('E3 内嵌令牌→[图片]（前后文字保留）', askCardReplyClean('不错呀 @@m:654984e3d879e96b7bec1280b9a12b46 真好看') === '不错呀 [图片] 真好看');
ok('E4 「名称|||令牌」语音形留名称段', askCardReplyClean('语音留言|||@@m:ca8e20cbe3a0c92de2a78701b54bd49e') === '语音留言');
ok('E5 「名称.后缀|||…」剥扩展名', askCardReplyClean('晚上好.mp3|||@@m:ca8e20cbe3a0c92de2a78701b54bd49e') === '晚上好');
ok('E6 无名「|||…」→[语音]', askCardReplyClean('|||@@m:ca8e20cbe3a0c92de2a78701b54bd49e') === '[语音]');
ok('E7 纯文字回应原样保留', askCardReplyClean('嗯嗯，我知道啦。') === '嗯嗯，我知道啦。');
ok('E8 文内普通链接不误伤（非图片直链）', askCardReplyClean('可以看 https://example.com/posts/123 这篇') === '可以看 https://example.com/posts/123 这篇');
ok('E9 空值返回空串（上层 || 兜底不受影响）', askCardReplyClean('') === '' && askCardReplyClean(null) === '');

// --- F. 展示点接线：四张互动卡渲染 + 即时更新 + 收藏快照 + ta-ask 两结果弹窗 ---
ok('F1 renderMsg 四卡回应行清洗（choice/curious/roast/ask）', (chatSrc.match(/T\(askCardReplyClean\(rec\.(choice|curious|roast|ask)Reply\)\)/g) || []).length >= 4);
ok('F2 邀请卡回应行清洗', /askCardReplyClean\(rec\.inviteAnswer\)/.test(chatSrc));
ok('F3 回答后即时 innerHTML 更新点清洗（reply/finalReply）', (chatSrc.match(/askCardReplyClean\((reply|finalReply)\)/g) || []).length >= 4);
ok('F4 cardSnapshot 收藏快照清洗', (chatSrc.match(/ta = askCardReplyClean\(rec\./g) || []).length >= 5);
ok('F5 助手暴露 window.askCardReplyClean（ta-ask 复用）', /window\.askCardReplyClean = askCardReplyClean;/.test(chatSrc));
ok('F6 ta-ask 好奇/选项/吐槽三结果弹窗清洗', (taSrc.match(/window\.askCardReplyClean \? window\.askCardReplyClean\(rec\./g) || []).length >= 3);

// --- G. 复扫收口（同日第二段）：拍一拍家族 + 收藏页互动卡片 ---
const gcSrc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');
ok('G1 getPokeCards 源头过滤接入 ccFuncTextOnly', /window\.getPokeCards = function \(\) \{[\s\S]*?ccFuncTextOnly\(c\)\) out\.push\(c\); [\s\S]*?\n  \};/.test(ccSrc));
ok('G2 getPokeCardsFor 源头过滤接入 ccFuncTextOnly', /window\.getPokeCardsFor = function \(cid\) \{[\s\S]*?ccFuncTextOnly\(c\)\) out\.push\(c\); \}\)\);/.test(ccSrc));
ok('G3 守卫助手暴露 window.ccTextCardOnly', /window\.ccTextCardOnly = ccFuncTextOnly;/.test(ccSrc));
const pokeTextOnly = new Function('return ' + extractFn(chatSrc, 'pokeTextOnly'))();
ok('G4 pokeTextOnly 纯文字放行', pokeTextOnly('拍了拍你的脸蛋') === true);
ok('G5 pokeTextOnly 媒体形态全拒（令牌/文内令牌/图链/|||/data:/空）',
  pokeTextOnly('@@m:654984e3d879e96b7bec1280b9a12b46') === false
  && pokeTextOnly('看看 @@m:654984e3d879e96b7bec1280b9a12b46') === false
  && pokeTextOnly('https://img.heliar.top/file/x.png') === false
  && pokeTextOnly('语音|||@@m:ca8e20cbe3a0c92de2a78701b54bd49e') === false
  && pokeTextOnly('data:image/png;base64,iVBORw0KGgo') === false
  && pokeTextOnly('') === false && pokeTextOnly(null) === false);
ok('G6 pokeAllCards 自建分组循环接入过滤', /g\[1\]\.forEach\(x => \{ if \(pokeTextOnly\(x\)\) out\.push\(x\); \}\)/.test(chatSrc));
ok('G7 sendPoke 面板单点防御', /if \(!pokeTextOnly\(action\)\) \{ toast\(/.test(chatSrc));
ok('G8 拍一拍气泡展示清洗（pokeIconHtml 尾段过 askCardReplyClean）', /return escTxt\(askCardReplyClean\(s\)\)/.test(chatSrc));
ok('G9 收藏页互动卡片回应行清洗', /escTxt\(window\.taFit \? window\.taFit\(askCardReplyClean\(f\.ta\)\) : askCardReplyClean\(f\.ta\)\)/.test(chatSrc));
ok('G10 群聊拍一拍短语池过滤（gcPokeActions 同口径）', /x\.indexOf\('@@m:'\) >= 0\) return false;/.test(gcSrc));

// --- H. 复扫收口（同日第三段）：问答记录/收藏列表、统计榜、撤回兜底 ---
const p2Src = readFileSync(join(root, 'src/js/p2-features.js'), 'utf8');
ok('H1 taReplyShow 清洗+转义助手存在', /function taReplyShow\(s\) \{[\s\S]*?askCardReplyClean[\s\S]*?escG\(/.test(taSrc));
ok('H2 记录/收藏列表回应列接线 taReplyShow（≥5 处）', (taSrc.match(/taReplyShow\((f|x)\.reply\)/g) || []).length >= 5);
ok('H3 邀请/问问记录答案列清洗', /askCardReplyClean \? window\.askCardReplyClean\(x\.a \|\| ''\)/.test(taSrc));
ok('H4 统计卡集补嵌套令牌+图链守卫', p2Src.indexOf("c.indexOf('@@m:') < 0 && !/^https?:\\/\\//i.test(c)") >= 0);
ok('H5 常用文字榜剔除混排令牌消息', p2Src.indexOf("if (m.text.indexOf('@@m:') >= 0) return;") >= 0);
ok('H6 撤回无快照兜底走内嵌令牌助手', /window\.mochiInlineTextHtml \? window\.mochiInlineTextHtml\(quoteDisplayFit\(text, rec\.side\)\) : escTxtBr/.test(chatSrc));

// --- 汇总 ---
console.log('#648 互动卡/功能池/拍一拍/记录页令牌乱码收口：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

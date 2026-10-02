// #948 聊天里的图片变成长乱码 行为验证（纯 Node，零浏览器依赖）
// 立项：用户直派 OPPO K13x 自带浏览器（实报 HeyTapBrowser/Chrome115 内核）「聊天里的图片变成了
// 长乱码」，并明说「这个问题其他设备型号也有出现」⇒ 本批判据零机型分支，全部只取字符串形态。
// 诊断附件实证：929 条消息、chat-msgs 单键 4.1MB，而媒体池仅 64 条＝大量图片载荷以整段 base64
// 内联在消息 text 里；旧判定全是 `x.indexOf('data:image/') === 0` 这种大小写敏感＋不容前导空白
// ＋只认 image 的精确前缀，内核（解码失败按原图入库那条腿／相册与文件管理器给出的类型）给出的
// 变体形态（data:application/octet-stream、data:IMAGE/PNG、串首空白…）一律判成「不是媒体」＝
// 既不进媒体池也不升级成图片消息，于是被当正文铺进气泡。
// 本脚本抽取**真实源码**的两段跑行为断言：
//   ① 判据层：chatIsImageUrlCard → chatIsDataImgLikeSrc/chatIsImgSrcLike/chatIsDataAudioSrc/
//      chatIsInlineDataSrc/chatIsMediaPayload/chatHasMediaPayload（大小写＋前导空白不敏感、
//      octet-stream 认作图片候选、audio/video 各归各位、普通文字卡与 "data:" 字样不误伤）；
//   ② 渲染层：window.mochiInlineTextHtml（正文中间夹着的载荷一律收成 [图片]/[语音]/[附件]，
//      断言「base64 正文绝不作为可见文字出现在产物 HTML 里」＝用户所见乱码的直接尺子）；
//   ③ 池层：media-pool 的 mediaPayloadKind 借用口径与本地兜底口径必须逐项同结论（禁第二份漂移）。
// 用法：node tools/verify-inline-media-garble.mjs
import { readFileSync } from 'node:fs';

const chatSrc = readFileSync(new URL('../src/js/chat.js', import.meta.url), 'utf8');
const poolSrc = readFileSync(new URL('../src/js/media-pool.js', import.meta.url), 'utf8');
const gcSrc = readFileSync(new URL('../src/js/group-chat.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

function cut(src, start, end, label, soft) {
  const s = src.indexOf(start);
  const e = s < 0 ? -1 : src.indexOf(end, s + 1);
  if (s < 0 || e < 0 || e <= s) {
    if (soft) return null; // 红副本（纯 HEAD）判据段本批尚未存在：让对应断言逐条变红，不整体退出
    console.error('抽取失败（' + label + '）：找不到 ' + JSON.stringify(start) + ' 或收尾锚 ' + JSON.stringify(end));
    process.exit(2);
  }
  return src.slice(s, e);
}

// ---- 抽取：判据段（chatIsImageUrlCard 起、getPool 前）＋ 渲染段（escTxt 起、pokeIconHtml 前）----
const srcPred = cut(chatSrc, 'function chatIsImageUrlCard(', 'function getPool() {', '判据段');
const srcInline = cut(chatSrc, 'function escTxt(', 'function pokeIconHtml', '渲染段');

const win = {
  // media-pool 的官方令牌口径（本脚本按同一形态桩一份，仅用于「令牌＝图片引用」断言）
  mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s)
};
const env = { window: win, String, Math, RegExp, console };
const loaded = new Function('env', 'with (env) { ' + srcPred + '\n' + srcInline + '\n return { chatIsDataImgLikeSrc: typeof chatIsDataImgLikeSrc === "function" ? chatIsDataImgLikeSrc : null, chatIsImgSrcLike: typeof chatIsImgSrcLike === "function" ? chatIsImgSrcLike : null, chatIsDataImgSrc: typeof chatIsDataImgSrc === "function" ? chatIsDataImgSrc : null, chatIsDataAudioSrc: typeof chatIsDataAudioSrc === "function" ? chatIsDataAudioSrc : null, chatIsInlineDataSrc: typeof chatIsInlineDataSrc === "function" ? chatIsInlineDataSrc : null, chatIsMediaPayload: typeof chatIsMediaPayload === "function" ? chatIsMediaPayload : null, chatHasMediaPayload: typeof chatHasMediaPayload === "function" ? chatHasMediaPayload : null }; }')(env);
const inline = win.mochiInlineTextHtml || null;
const P = loaded;

const hasPred = !!(P && P.chatHasMediaPayload && P.chatIsImgSrcLike && P.chatIsDataImgLikeSrc);
ok(hasPred, 'S1 chat.js 判据段可抽取且五个统一口径齐备（各写一份精确前缀判定＝本次乱码的复发土壤）');
ok(typeof inline === 'function', 'S2 window.mochiInlineTextHtml 已挂载（文字气泡消费者边界）');
// 判据缺失（纯 HEAD 形态）时不整体退出：T/F/INL 一律返回 false，让本批缺陷面逐条落红。
const T = (fn) => (...args) => typeof fn === 'function' && !!fn(...args);
const F = (fn) => (...args) => typeof fn === 'function' && !fn(...args);
const INL = typeof inline === 'function' ? inline : () => null;
ok(/window\.chatIsDataImgLikeSrc = chatIsDataImgLikeSrc;/.test(chatSrc), 'S3 判据导出到 window（media-pool/群聊借用同一口径）');
ok(/const isImgPayload = window\.chatIsDataImgLikeSrc \|\| window\.chatIsDataImgSrc;/.test(gcSrc), 'S4 群聊落盘令牌化借用同一口径（群聊自写一份＝乱码从群聊复发）');
ok(/if \(!mediaPayloadKind\(payload\)\) \{ resolve\(null\); return; \}/.test(poolSrc), 'S5 媒体池 tokenize 闸门走统一判据（旧精确前缀＝变体载荷永不进池）');
ok(/const _isMediaRep = !!\(rep && \(rep\.type === 'sticker' \|\| rep\.type === 'image' \|\| rep\.type === 'voice'/.test(chatSrc), 'S6 genChatStyleReply 源头闸覆盖单卡媒体形态（本次乱码的直接来路：TA 回应把整张表情包载荷当文字返回）');

const H32 = '58395ec7c37e171594d598aeec80cb87';
const TOK = '@@m:' + H32;
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAPg';
const pImg = 'data:image/png;base64,' + B64;
const pImgWs = '   data:image/png;base64,' + B64;
const pImgUpper = 'data:IMAGE/PNG;base64,' + B64;
const pHeic = 'data:image/heic;base64,' + B64;
const pOctet = 'data:application/octet-stream;base64,' + B64;
const pAudio = 'data:audio/webm;base64,' + B64;
const pVideo = 'data:video/mp4;base64,' + B64;
const urlImg = 'https://img.example.com/a/IMG_2343.png';
const txtPlain = '普通文本 <b>& 换行\n第二行';
const txtDataWord = 'I keep my data: safe and sound';

// ---- B1 判据层：整条载荷各形态归类正确 ----
{
  const isImg = T(P.chatIsDataImgSrc), like = T(P.chatIsDataImgLikeSrc), srcLike = T(P.chatIsImgSrcLike);
  const isAudio = T(P.chatIsDataAudioSrc);
  const notLike = F(P.chatIsDataImgLikeSrc), notSrcLike = F(P.chatIsImgSrcLike);
  ok(isImg(pImg), 'B1a 标准 data:image/png 认作图片（改回大小写敏感即红）');
  ok(isImg(pImgWs), 'B1b 串首空白的图片载荷也认（旧精确 indexOf===0 漏过＝内联留存）');
  ok(isImg(pImgUpper), 'B1c 大写 MIME 图片载荷也认');
  ok(isImg(pHeic), 'B1d data:image/heic 也认 image/*（旧写法只认字面 image/ 前缀）');
  ok(like(pOctet), 'B1e 无类型载荷（data:application/octet-stream）认作图片候选——Chromium 家族内核实测按图片嗅探解码，判成非媒体＝整段 base64 当正文铺出＝用户所见乱码');
  ok(srcLike(pOctet) && srcLike(pImgWs) && srcLike(pImgUpper), 'B1f 三者都过「整条就是图片引用」（renderMsg/normCell 据此渲图并补 type=image）');
  ok(notLike(pAudio) && notSrcLike(pAudio), 'B1g 语音载荷不算图片候选（图片收藏又变语音条＝#397 那条老账，防修过头）');
  ok(notLike(pVideo), 'B1h video/* 排除在图片候选外（按图渲染必坏）');
  ok(isAudio(pAudio), 'B1i 整条裸 data:audio 认作语音（旧判定只认「名称|||」形态＝裸载荷直出 base64）');
  ok(srcLike(TOK) && srcLike(urlImg), 'B1j 令牌与图片直链仍在「图片引用」判据内（#383/#534 语义不动）');
  ok(notSrcLike(txtPlain) && notSrcLike('https://example.com/post/1'), 'B1k 普通文本与普通链接不误判成图（否则文字气泡变裂图）');
}
// ---- B2 判据层：文字卡池守卫（chatHasMediaPayload）不误伤正常文本 ----
{
  const has = T(P.chatHasMediaPayload), noHas = F(P.chatHasMediaPayload);
  const whole = T(P.chatIsMediaPayload), noWhole = F(P.chatIsMediaPayload);
  ok(has(pImg) && has(pOctet) && has(pAudio), 'B2a 三种载荷都判「含媒体」（getPool 据此不进文字池）');
  ok(has('看这张 ' + TOK + ' 哈哈') && has('语音名|||' + pAudio), 'B2b 正文夹真令牌／「名称|||data:」混排也判含媒体');
  ok(has('别理它 ' + pImg), 'B2c 正文中间夹着内联载荷也判含媒体（混排文字卡同样不得进文字池）');
  ok(noHas('别理它 ' + urlImg), 'B2c2 文本＋图片直链混排不判媒体（#534 只自愈整条就是图链的消息，普通链接保留原文＝不把它换成裂图）');
  ok(noHas(txtDataWord), 'B2d 刻意不按裸 "data:" 子串匹配：正常英文文字卡不被误剔（误剔＝联系人少一张文本卡，比少一层防护更难查）');
  ok(noHas('今天也加油') && noHas(''), 'B2e 普通文本与空串零误判');
  ok(noWhole(txtDataWord) && whole('https://x.com/a.jpg'), 'B2f chatIsMediaPayload 只认整条载荷/整条图片直链');
}
// ---- B3 渲染层：正文夹载荷绝不把 base64 铺成可见文字（用户所见乱码的直接尺子）----
{
  const cases = [[pImg, '[图片]'], [pImgUpper, '[图片]'], [pHeic, '[图片]'], [pOctet, '[附件]'], [pAudio, '[语音]']];
  let allClean = true, allLabeled = true;
  for (const [payload, label] of cases) {
    const h = String(INL('宝贝看看这个 ' + payload + ' 好不好看') || '');
    if (h.indexOf(B64) >= 0) { allClean = false; console.log('    · base64 泄漏：' + payload.slice(0, 34) + '…'); }
    if (h.indexOf(label) < 0) { allLabeled = false; console.log('    · 缺标注 ' + label + '：' + payload.slice(0, 34) + '…'); }
  }
  ok(allClean, 'B3a 混排消息里 base64 正文一律不落成可见文字（本条＝本批主诉的尺子）');
  ok(allLabeled, 'B3b 图片/无类型/语音载荷各收成对应标注 [图片]/[附件]/[语音]');
}
{
  const h = String(INL(TOK + ' 在后面') || '');
  ok(h.indexOf('<img class="msg-inline-tok" src="' + TOK + '"') >= 0, 'B3c 内嵌真令牌仍转行内 <img>（#385 语义零回归）');
  const plain = String(INL(txtPlain) || '');
  ok(plain === '普通文本 &lt;b&gt;&amp; 换行<br>第二行', 'B3d 无媒体文本逐字符与旧 escTxtBr 一致（早退守卫未被绕过）');
  const word = String(INL(txtDataWord) || '');
  ok(word === txtDataWord, 'B3e 含 "data:" 字样的正常英文句子原样保留（不被媒体化）');
  const fake = String(INL('@@m:zzz 和 data:image/png;base64,短') || '');
  ok(fake.indexOf('@@m:zzz') >= 0, 'B3f 形似非法令牌按文本转义，不滥转');
  const upper = String(INL('@@m:' + H32.toUpperCase()) || '');
  ok(upper.indexOf('<img') < 0 && upper.indexOf('@@m:' + H32.toUpperCase()) >= 0,
    'B3g 32 位大写十六进制伪令牌仍按文本转义（拆分正则带 i 就会把它切成空 src 裂图；#385 口径）');
}
// ---- B4 池层：借用口径与本地兜底口径逐项同结论（禁第二份判据漂移）----
{
  const srcKind = cut(poolSrc, 'var KIND_HEAD_RE', 'if (!OK) return;', '池判据段', true);
  if (srcKind === null) {
    ok(false, 'B4a 借用 chat.js 与本地兜底两种加载次序结论完全一致（本模块单独加载不改行为）', 'media-pool 统一判据段尚未存在');
    ok(false, 'B4b 归类逐条正确：无类型载荷入池当图、音频走音频、video/令牌/直链/文本一律不进池');
  } else {
  const mkWin = (withChat) => {
    const w = {
      chatIsDataImgLikeSrc: withChat ? P.chatIsDataImgLikeSrc : undefined,
      chatIsDataAudioSrc: withChat ? P.chatIsDataAudioSrc : undefined
    };
    const e = { window: w, String, Math, RegExp };
    return new Function('env', 'with (env) { ' + srcKind + '\n return mediaPayloadKind; }')(e);
  };
  const kindDelegate = mkWin(true);
  const kindLocal = mkWin(false);
  const battery = [[pImg, 'image'], [pImgWs, 'image'], [pImgUpper, 'image'], [pHeic, 'image'], [pOctet, 'image'],
    [pAudio, 'audio'], ['名称|||' + pAudio, ''], [pVideo, ''], [TOK, ''], [urlImg, ''], [txtPlain, ''], ['', '']];
  let agree = true, right = true;
  for (const [s, want] of battery) {
    const a = kindDelegate(s), b = kindLocal(s);
    if (a !== b) { agree = false; console.log('    · 口径漂移：' + JSON.stringify(s.slice(0, 28)) + ' → ' + a + ' / ' + b); }
    if (a !== want) { right = false; console.log('    · 归类应为 ' + (want || '(空)') + '，实得 ' + (a || '(空)') + '：' + JSON.stringify(s.slice(0, 28))); }
  }
  ok(agree, 'B4a 借用 chat.js 与本地兜底两种加载次序结论完全一致（本模块单独加载不改行为）');
  ok(right, 'B4b 归类逐条正确：无类型载荷入池当图、音频走音频、video/令牌/直链/文本一律不进池');
  }
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

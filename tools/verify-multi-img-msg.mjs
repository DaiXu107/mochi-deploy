// ===== 专项验证：#624 聊天「一条消息两张图」（TA 表情包概率 + 图片概率同时命中） =====
// 用法：node tools/verify-multi-img-msg.mjs（自读 src，不依赖构建产物，纯 Node 无浏览器）
// 背景（用户报，红米K80 Chrome，明说其他设备型号也有、要求不要覆盖修改引发跨机型回归）：
//   「为什么我无法触发，联系人给我发的一条消息里有两个图片，字卡库的公用字卡和专属字卡里的
//   【表情包】或【图片】」＋「聊天里一条消息里我和联系人都可以发送多个图片」。
// 根因（零机型/零内核分支，纯逻辑）：
//   ① chat.js genReplyText 的「表情包概率 / 图片概率」原为 if/else if 互斥，两条同时命中最多
//      只出一张（sticker 优先还会完全遮住 image），TA 永远发不出「一条消息两张图」；
//   ② normCell / migrateLegacyMediaMsgs 的存量规则把「text 以 data:image/ 开头」的 text/无 type
//      记录一律升级成 type:'image'，而 renderMsg 的类型分支先于 parts 分支 ⇒ parts 里 ≥2 张图的
//      消息（用户自己的多图发送 / TA 的两图消息）刷新或重进后只剩第一张。
// 断言分两段（真实函数体执行，均为自包含/可注入桩）：
//   A 段 genReplyText：两条概率独立判定（都命中＝sticker + image 两张图同一条）；单命中/都不命中
//      时与旧版逐个分支一致（防误伤）。附 HEAD 版 RED 对照（判别力实证）。
//   B 段 normCell：parts ≥2 张图的多图记录不被升级成 type:'image'；单图/无 parts 的升级语义保留。
//      附 HEAD 版 RED 对照（无守卫时多图被折叠成单图）。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, info) => {
  if (c) { pass++; console.log('PASS  ' + n); }
  else { fail++; console.log('FAIL  ' + n + (info !== undefined ? '  [' + JSON.stringify(info) + ']' : '')); }
};

const chatSrc = read('src/js/chat.js');
let headSrc = '';
try { headSrc = execSync('git show HEAD:src/js/chat.js', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) {}

function slice(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) return null;
  const b = src.indexOf(endMarker, a + startMarker.length);
  if (b < 0) return null;
  return src.slice(a, b);
}

/* ================= A 段：genReplyText 真实函数体 ================= */
// 桩：getPool 由用例注入；hit(p) 用「命中集」模拟；pick* 取首个可用值。
const ST = 'data:image/png;base64,STICKER';
const IM = 'data:image/jpeg;base64,IMAGE';
// 直观工厂：每次调用注入桩，返回已绑定的 genReplyText。
function makeGen(src, poolOf, hitset) {
  const body = slice(src, 'function genReplyText(c) {', 'function scheduleReply() {');
  if (!body) return null;
  const fallback = ['兜底回复'];
  const fn = new Function('getPool', 'hit', 'pickNonBlank', 'pick', 'FALLBACK_REPLY_POOL',
    body + '\nreturn genReplyText;');
  const hit = (p) => hitset.has(Number(p));
  const pick = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : '');
  const pickNonBlank = (arr) => { for (const x of (arr || [])) if (typeof x === 'string' && x.trim()) return x; return ''; };
  return fn(() => poolOf, hit, pickNonBlank, pick, fallback);
}

const fullPool = { text: ['你好'], kaomoji: ['(๑•̀ㅂ•́)و'], emoji: ['😀'], sticker: [ST], image: [IM], voice: ['语音.mp3|||data:audio/mp3;base64,AA'], poke: [] };
const noImgPool = { text: ['你好'], kaomoji: [], emoji: [], sticker: [ST], image: [], voice: [], poke: [] };
const noStickerPool = { text: ['你好'], kaomoji: [], emoji: [], sticker: [], image: [IM], voice: [], poke: [] };

const genBothHit = makeGen(chatSrc, fullPool, new Set([1]));
const genStickerOnly = makeGen(chatSrc, fullPool, new Set([1]));
const genHeadBoth = makeGen(headSrc, fullPool, new Set([1]));

t('A0 提取到当前 genReplyText 真实函数体', !!genBothHit);
t('A0b 提取到 HEAD 版 genReplyText（RED 对照用）', !!genHeadBoth);

// c：sticker-prob / image-prob 用 1=命中、0=不命中；其余键给 0 避免干扰
const cBoth = { 'sticker-prob': 1, 'image-prob': 1, 'emoji-prob': 0, 'voice-prob': 0, 'kaomoji-prob': 0 };
const cSticker = { 'sticker-prob': 1, 'image-prob': 0, 'emoji-prob': 0, 'voice-prob': 0, 'kaomoji-prob': 0 };
const cImage = { 'sticker-prob': 0, 'image-prob': 1, 'emoji-prob': 0, 'voice-prob': 0, 'kaomoji-prob': 0 };
const cNone = { 'sticker-prob': 0, 'image-prob': 0, 'emoji-prob': 0, 'voice-prob': 0, 'kaomoji-prob': 0 };

if (genBothHit) {
  const r = genBothHit(cBoth);
  const imgs = (r.parts || []).filter(p => p.k === 'img');
  t('A1 两概率都命中 → 同一条消息两张图（GREEN）', r && r.type === 'text' && imgs.length === 2, r && { type: r.type, n: imgs.length });
  t('A2 两图分别为 sticker + image（来源＝字卡库表情包/图片池）',
    imgs.length === 2 && imgs[0].sub === 'sticker' && imgs[0].v === ST && imgs[1].sub === 'image' && imgs[1].v === IM,
    imgs.map(p => p.sub + ':' + p.v.slice(0, 22)));
  t('A3 多图消息 text 为图片载荷（与用户多图发送同形，供横幅/去重）', !!r && r.text === ST);
  const rs = genBothHit(cSticker);
  t('A4 只中表情包概率 → 整条表情包（旧行为不变）', rs && rs.type === 'sticker' && rs.text === ST && !rs.parts);
  const ri = genBothHit(cImage);
  t('A5 只中图片概率 → 整条图片（旧行为不变）', ri && ri.type === 'image' && ri.text === IM && !ri.parts);
  const rn = genBothHit(cNone);
  t('A6 都不命中 → 纯文字（旧行为不变）', rn && rn.type === 'text' && rn.text === '你好' && !rn.parts);
} else {
  t('A1 两概率都命中 → 同一条消息两张图（GREEN）', false);
  t('A2 两图分别为 sticker + image（来源＝字卡库表情包/图片池）', false);
  t('A3 多图消息 text 为图片载荷（与用户多图发送同形，供横幅/去重）', false);
  t('A4 只中表情包概率 → 整条表情包（旧行为不变）', false);
  t('A5 只中图片概率 → 整条图片（旧行为不变）', false);
  t('A6 都不命中 → 纯文字（旧行为不变）', false);
}

// A7/A8：池缺一类时不误造两图
{
  const g = makeGen(chatSrc, noImgPool, new Set([1]));
  const r = g(cBoth);
  t('A7 表情包概率+图片概率都命中但图片池为空 → 退回整条表情包', r && r.type === 'sticker' && !r.parts, r && r.type);
  const g2 = makeGen(chatSrc, noStickerPool, new Set([1]));
  const r2 = g2(cBoth);
  t('A8 表情包池为空 → 退回整条图片', r2 && r2.type === 'image' && !r2.parts, r2 && r2.type);
}

// RED 对照：HEAD 版两天概率同时命中只能出一张（sticker 遮住 image）
if (genHeadBoth) {
  const rh = genHeadBoth(cBoth);
  const imgsH = (rh.parts || []).filter(p => p.k === 'img');
  t('A9 RED 对照：HEAD 版两概率都命中最多一张图（用户「无法触发两个图片」的机制）',
    rh && imgsH.length <= 1 && rh.type !== 'text', rh && { type: rh.type, n: imgsH.length });
}

/* ================= B 段：normCell 真实函数体 ================= */
function makeNorm(src, guardOn) {
  const helper = slice(src, 'function hasMultiImgParts(r) {', 'function normCell(r) {');
  const body = slice(src, 'function normCell(r) {', '// ===== FIX 2026-09-07 #256');
  if (!body) return null;
  const head = guardOn && helper ? helper : '';
  try {
    return new Function('ICON_BELL', 'ICON_TEL', 'ICON_ENV', 'ICON_CQ_FIX', 'chatIsImageUrlCard', 'window',
      (head ? head + '\n' : '') + body + '\nreturn normCell;')(
      '<bell>', '<tel>', '<env>', {}, (s) => /^https?:\/\//.test(String(s)), {});
  } catch (e) { return null; }
}
const normNow = makeNorm(chatSrc, true);
const normHead = makeNorm(headSrc, false); // HEAD 无 helper，guardOn=false 且 helper 取不到

t('B0 提取到当前 normCell 真实函数体', !!normNow);
t('B0b 提取到 HEAD 版 normCell（RED 对照用）', !!normHead);

const recMulti = () => ({ type: 'text', text: 'data:image/png;base64,STICKER', parts: [{ k: 'img', v: 'data:image/png;base64,STICKER', sub: 'sticker' }, { k: 'img', v: 'data:image/jpeg;base64,IMAGE', sub: 'image' }] });
if (normNow) {
  const r1 = recMulti();
  normNow(r1);
  t('B1 多图记录不被升级成 type:image（否则渲染走单图分支，第二张丢）', r1.type === 'text', r1.type);
  const r2 = { type: 'text', text: 'data:image/png;base64,ONE', parts: [{ k: 'img', v: 'data:image/png;base64,ONE', sub: 'image' }] };
  normNow(r2);
  t('B2 单图 parts 仍升级为 type:image（既有语义保留，防视觉回归）', r2.type === 'image', r2.type);
  const r3 = { type: 'text', text: 'data:image/png;base64,NO' };
  normNow(r3);
  t('B3 无 parts 的 data:image 文本仍升级为 type:image（既有语义保留）', r3.type === 'image', r3.type);
  const r4 = { type: 'text', text: '今天也要好好吃饭呀', parts: [{ k: 'text', v: '今天也要好好吃饭呀' }, { k: 'img', v: 'data:image/png;base64,X', sub: 'image' }] };
  normNow(r4);
  t('B4 文字+单图消息不受影响（type 仍 text）', r4.type === 'text', r4.type);
} else {
  ['B1 多图记录不被升级成 type:image（否则渲染走单图分支，第二张丢）',
   'B2 单图 parts 仍升级为 type:image（既有语义保留，防视觉回归）',
   'B3 无 parts 的 data:image 文本仍升级为 type:image（既有语义保留）',
   'B4 文字+单图消息不受影响（type 仍 text）'].forEach(n => t(n, false));
}
if (normHead) {
  const rh = recMulti();
  normHead(rh);
  t('B5 RED 对照：HEAD 版把多图记录折叠成 type:image（第二张丢失的机制）', rh.type === 'image', rh.type);
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAIL') + '  ' + pass + '/' + (pass + fail));
process.exitCode = fail === 0 ? 0 : 1;

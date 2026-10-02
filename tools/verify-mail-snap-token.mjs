// #681 信箱剥图快照保留媒体池令牌 行为验证（纯 Node，零浏览器依赖）
// 立项：朋友圈同族 #667 已收口，WORKLOG 明留「src/js/mail.js stripLetterImg 有一模一样的
// 令牌剥离形态（信箱在同样降级窗口会把图变文字）」。根因：剥图快照把 @@m:<hash32> 也换成
// 「[图片]」，而主键（IDB）读不到时 load() 只剩快照，令牌是「图在哪」的唯一线索——被剥掉后
// 图永久退化成文字（media-pool 观察器无从解图）。本脚本抽**真实源码**的 stripLetterImg /
// mailCleanDisplay / renderBody / hasRealImg，端到端断言：
//   ①快照只剥 dataURL、保留令牌（dataURL→[图片]，@@m: 原样）；
//   ②降级路径把快照渲染成 <img class="mail-body-img" src="@@m:…">（交观察器解图），不是 [图片] 文字；
//   ③合并判定 hasRealImg 认令牌（含令牌的版本不被剥图版压掉）；
//   ④dataURL 大图仍照旧剥掉（快照预算保护不回归）。
// RED 对照：MOCHI_MAIL_SRC=<修复前 mail.js> node tools/verify-mail-snap-token.mjs
// 用法：node tools/verify-mail-snap-token.mjs
import { readFileSync } from 'node:fs';

const SRC = process.env.MOCHI_MAIL_SRC || new URL('../src/js/mail.js', import.meta.url);
const mailSrc = readFileSync(SRC, 'utf8');

const TOK = '@@m:58395ec7c37e171594d598aeec80cb87';
const BIG = 'data:image/png;base64,' + 'A'.repeat(4096);

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};
const slice = (startAnchor, endAnchor) => {
  const i = mailSrc.indexOf(startAnchor);
  const j = mailSrc.indexOf(endAnchor, i + 1);
  if (i < 0 || j <= i) return null;
  return mailSrc.slice(i, j);
};

// ---- 抽真实函数体（同一 IIFE 内的依赖显式注入）----
const cleanBody = slice('function mailCleanDisplay(', 'function mailCardPool(');
ok(!!cleanBody, 'A1 mailCleanDisplay 函数可定位');
const mailCleanDisplay = new Function(cleanBody + '\nreturn mailCleanDisplay;')();

const stripBody = slice('function stripLetterImg(', 'function writeSnap(');
ok(!!stripBody, 'A2 stripLetterImg 函数可定位');
const stripLetterImg = new Function('mailCleanDisplay', stripBody + '\nreturn stripLetterImg;')(mailCleanDisplay);

const renderBodyBody = slice('function renderBody(', 'function shortDesc(');
ok(!!renderBodyBody, 'A3 renderBody 函数可定位');
const fitPassthrough = (t) => t;
const renderBody = new Function('window', 'taFit', 'mailCleanDisplay', renderBodyBody + '\nreturn renderBody;')({ taFit: fitPassthrough }, fitPassthrough, mailCleanDisplay);

const hasRealImgBody = slice('function hasRealImg(', 'function mergeLists(');
ok(!!hasRealImgBody, 'A4 hasRealImg 函数可定位');
const mochiMediaIsToken = (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s);
const hasRealImg = new Function('window', hasRealImgBody + '\nreturn hasRealImg;')({ mochiMediaIsToken });

// ---- B 轴：快照剥图行为 ----
const letter = {
  id: 'l_1', type: 'received', tt: '想你了', tm: 1,
  content: '今天路过一个地方 ' + TOK + ' 突然想起你',
  myReply: { content: '我也想你 ' + BIG, tm: 2 },
  partnerReply: { content: '晚安 ' + TOK, tm: 3 }
};
const snap = JSON.parse(JSON.stringify([letter].map(stripLetterImg)))[0];

ok(snap.content.indexOf(TOK) >= 0, 'B1 正文内媒体池令牌在快照中保留（图仍可解）', snap.content);
ok(snap.content.indexOf('[图片]') < 0, 'B1b 令牌不再被剥成「[图片]」文字', snap.content);
ok(snap.content.indexOf('今天路过一个地方') >= 0, 'B2 正文文字照常保留');
ok(snap.myReply && snap.myReply.content.indexOf('[图片]') >= 0, 'B3 dataURL 大图仍剥成 [图片]（快照预算保护不回归）', snap.myReply && snap.myReply.content);
ok(snap.myReply && snap.myReply.content.indexOf('data:image/') < 0, 'B3b 快照内不留裸 dataURL');
ok(snap.partnerReply && snap.partnerReply.content.indexOf(TOK) >= 0, 'B4 对方回信内令牌同样保留', snap.partnerReply && snap.partnerReply.content);

// ---- C 轴：降级路径端到端——快照唯一可读时渲染出图元素而非文字 ----
const rendered = renderBody(snap.content, false);
ok(rendered.indexOf('<img class="mail-body-img" src="' + TOK + '"') >= 0, 'C1 快照渲染出 <img src=@@m:…>（交观察器解图）', rendered);
ok(rendered.indexOf('[图片]') < 0, 'C1b 降级渲染不出现「[图片]」占位文字', rendered);
ok(rendered.indexOf('今天路过一个地方') >= 0 && rendered.indexOf('突然想起你') >= 0, 'C2 令牌两侧文字仍在');

// ---- D 轴：合并判定——含令牌的完整版本不被剥图版压掉 ----
ok(hasRealImg({ content: '图 ' + TOK }) === true, 'D1 hasRealImg 认「裸令牌」为含图（合并保留含图版本）');
ok(hasRealImg({ content: '图 ' + BIG }) === true, 'D2 hasRealImg 认 dataURL 为含图（原行为不回归）');
ok(hasRealImg({ content: '纯文字' }) === false, 'D3 hasRealImg 对纯文字为假（不误判）');
ok(hasRealImg(snap) === true, 'D4 修复后的快照被认作含图（不被剥图版压掉）');

// ---- E 轴：摘要/通知等处令牌清洗仍在（不因本修复把可见文字处的令牌漏出）----
const summaryStrips = /function shortDesc\([\s\S]{0,900}?\.replace\(\/@@m:\[0-9a-f\]\{32\}\/g, ''\)/.test(mailSrc);
ok(summaryStrips, 'E1 列表摘要 shortDesc 仍剥除令牌（列表文字不残留 @@m:）');
ok(mailSrc.indexOf(".replace(/@@m:[0-9a-f]{32}/g, '[图片]')") >= 0, 'E2 弹窗/通知文字仍把令牌清洗为 [图片]');

console.log('\n-----');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

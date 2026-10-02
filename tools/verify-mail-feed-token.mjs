// #386 信箱/朋友圈媒体池令牌乱码 行为验证（纯 Node，零浏览器依赖）
// 立项：用户复报（多机型）——聊天乱码已愈（#383/#385），但信箱信纸/朋友圈动态与评论
// 仍直出 @@m:<hash32> 令牌串：mail.js renderBody / feed.js inlineBody + contentHtmlFor
// 的图片识别 RE 只认 data:image 与 http 链，令牌漏过被当文字。
// 本脚本抽取**真实源码**的 renderBody / inlineBody / contentHtmlFor 的图片 RE 与各剥离
// 处跑行为断言：令牌段 → 进 <img src>（交 media-pool 观察器解图），普通网址/文字照常；
// 摘要/快照/通知剥离处令牌 → [图片]/[表情包]。链路被改坏立刻红。
// 用法：node tools/verify-mail-feed-token.mjs
import { readFileSync } from 'node:fs';

const TOK = '@@m:58395ec7c37e171594d598aeec80cb87';
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

// ---- 1) mail.js renderBody：抽真实函数跑行为断言 ----
const mailSrc = readFileSync(new URL('../src/js/mail.js', import.meta.url), 'utf8');
const iRB = mailSrc.indexOf('function renderBody(');
const iRBEnd = mailSrc.indexOf('function shortDesc(', iRB);
ok(iRB > 0 && iRBEnd > iRB, 'mail renderBody 函数可定位');
const mailFit = (t) => t; // taFit 直通
const renderBody = new Function('fit', 'window', 'taFit',
  mailSrc.slice(iRB, iRBEnd) + '\nreturn renderBody;')(mailFit, { taFit: mailFit }, mailFit);

const mailOut = renderBody('不错 ' + TOK + ' 很好', false);
ok(mailOut.indexOf('<img class="mail-body-img" src="' + TOK + '"') >= 0, 'M1 信纸令牌渲染为 <img src=@@m:…>（交观察器解图）', mailOut.slice(0, 120));
ok(mailOut.indexOf('不错 ') >= 0 && mailOut.indexOf(' 很好') >= 0, 'M2 令牌两侧文字保留');
ok(renderBody('看看 https://example.com/a 这个', false).indexOf('https://example.com/a') >= 0, 'M3 无前缀普通网址仍按文本保留（不误判为图）');
const dataImg = 'data:image/png;base64,iVBORw0KGgo=';
ok(renderBody('a ' + dataImg + ' b', false).indexOf('<img class="mail-body-img"') >= 0, 'M4 data:image 原链路不回归');
ok(renderBody('a sticker:' + TOK + ' b', false).indexOf('src="' + TOK + '"') >= 0, 'M5 sticker: 前缀 + 令牌也走 <img>（前缀剥离与 data: 同款）');

// shortDesc：令牌剥掉后不残留
const iSD = mailSrc.indexOf('function shortDesc(');
const iSD2 = mailSrc.indexOf('function letterPaper(', iSD);
const shortDesc = new Function('escHtml', 'window', 'taFit',
  mailSrc.slice(iSD, iSD2) + '\nreturn shortDesc;')((t) => t, {}, undefined);
const sdOut = shortDesc(TOK + ' hello');
ok(sdOut.indexOf('@@m:') < 0 && sdOut.indexOf('hello') >= 0, 'M6 信箱列表摘要令牌剥除不残留', sdOut);

// ---- 2) feed.js inlineBody：抽真实函数跑行为断言 ----
const feedSrc = readFileSync(new URL('../src/js/feed.js', import.meta.url), 'utf8');
const iIB = feedSrc.indexOf('function inlineBody(');
const iIBEnd = feedSrc.indexOf('function makePicker(', iIB);
ok(iIB > 0 && iIBEnd > iIB, 'feed inlineBody 函数可定位');
const inlineBody = new Function('attrEsc', 'window', 'taFit',
  feedSrc.slice(iIB, iIBEnd) + '\nreturn inlineBody;')((t) => t, {}, undefined);
const fbOut = inlineBody('不错 ' + TOK + ' 很好', '');
ok(fbOut.indexOf('<img class="feed-inline-img" src="' + TOK + '"') >= 0, 'F1 朋友圈正文令牌渲染为 <img src=@@m:…>', fbOut.slice(0, 120));
ok(fbOut.indexOf('不错 ') >= 0 && fbOut.indexOf(' 很好') >= 0, 'F2 令牌两侧文字保留');
ok(inlineBody('看看 https://example.com/a 这个', '').indexOf('https://example.com/a') >= 0, 'F3 无前缀普通网址仍按文本保留');

// contentHtmlFor 图片网格 RE：令牌进 imgs 网格
const iCH = feedSrc.indexOf('function contentHtmlFor(');
const iCHEnd = feedSrc.indexOf('function feedStickersHtml(', iCH);
ok(iCH > 0 && iCHEnd > iCH, 'feed contentHtmlFor 函数可定位');
const contentHtmlFor = new Function('attrEsc', 'inlineBody', 'feedStickersHtml', 'window',
  feedSrc.slice(iCH, iCHEnd) + '\nreturn contentHtmlFor;')((t) => t, inlineBody, () => '');
const p = { content: '图 ' + TOK + ' 文', role: 'ta' };
const chOut = contentHtmlFor(p);
ok(chOut.indexOf('src="' + TOK + '"') >= 0, 'F4 图片网格认令牌（与配图同尺寸渲染）', chOut.slice(0, 160));
const chText = chOut.replace(/<[^>]*>/g, ' ');
ok(chText.indexOf('图') >= 0 && chText.indexOf('文') >= 0, 'F5 网格路径文字保留');

// ---- 3) 剥离/判定处：令牌不进摘要与通知文字 ----
ok(/@@m:\[0-9a-f\]\{32\}\/g, '\[图片\]'\)\.replace/.test(feedSrc.replace(/\n/g, '')) || feedSrc.indexOf(".replace(/@@m:[0-9a-f]{32}/g, '[图片]')") >= 0, 'F6 朋友圈快照剥图处令牌→[图片]（3 处同款）');
ok(feedSrc.indexOf(".replace(/@@m:[0-9a-f]{32}/g, '[表情包]')") >= 0, 'F7 通知文字清洗令牌→[表情包]');
ok(feedSrc.indexOf("prevImg = /data:image\\//.test(String(prev.content || '')) || (window.mochiMediaIsToken") >= 0, 'F8 评论合并图片判定补认令牌');
ok(mailSrc.indexOf(".replace(/@@m:[0-9a-f]{32}/g, '[图片]')") >= 0, 'M7 信件快照剥图处令牌→[图片]');
ok(mailSrc.indexOf("some(window.mochiMediaIsToken)") >= 0, 'M8 hasRealImg 补认令牌（合并保留含图版本）');

// ---- 4) 来源侧：feed cardPool 第三道令牌守卫（与 chat.js #383 同款）----
ok(feedSrc.indexOf('if (c && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return;') >= 0, 'F9 cardPool 裸令牌卡不进文字池');
ok(feedSrc.indexOf("(s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s)))") >= 0, 'F10 onlyData 媒体筛选放行令牌卡');
ok(mailSrc.indexOf("(s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s)))") >= 0, 'M9 信件表情筛选放行令牌卡');

console.log('\n-----');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

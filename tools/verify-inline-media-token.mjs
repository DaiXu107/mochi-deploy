// #385 聊天/群聊内嵌媒体池令牌乱码 行为验证（纯 Node，零浏览器依赖）
// 立项：华为畅享70Pro Chrome 报障（明说其他设备型号也有）——联系人在聊天/群聊发来的混合文本
// 消息里夹了裸 @@m:<hash32> 令牌，渲染端 escTxtBr 把整个字符串（含令牌段）原样铺出＝乱码
// "不错 多笑笑吧 @@m:5839…cb87 我不是很适应这个"（#383 只治整条＝裸令牌，没治"夹在文字中间"）。
// 本脚本抽取**真实源码**的 escTxt / escTxtBr / window.mochiInlineTextHtml 跑行为断言：
//   内嵌令牌 → 拆成行内 <img class="msg-inline-tok">（交 media-pool 观察器解图），不再直出令牌串；
//   纯文本 / 令牌在首 / 尾 / 连续多卡 → 各形态断言；HTML 注入字符照常转义。
// 链路被改坏立刻红。用法：node tools/verify-inline-media-token.mjs
import { readFileSync } from 'node:fs';

const srcPath = new URL('../src/js/chat.js', import.meta.url);
const text = readFileSync(srcPath, 'utf8');

function cut(start, end) {
  const s = text.indexOf(start);
  const e = text.indexOf(end, s + 1);
  if (s < 0 || e < 0 || e <= s) {
    console.error('抽取失败：找不到 ' + JSON.stringify(start) + ' 或收尾锚点 ' + JSON.stringify(end));
    process.exit(2);
  }
  return text.slice(s, e);
}
// 三者在源码里连续紧挨：escTxt → escTxtBr → （#385 注释）→ window.mochiInlineTextHtml
const srcInline = cut('function escTxt(', 'function pokeIconHtml');
// #948：mochiInlineTextHtml 现在要调同处第一个 IIFE 里的媒体判据（chatHasMediaPayload /
// chatIsDataImgSrc / chatIsDataAudioSrc / chatIsInlineDataSrc）。沙箱单独 eval 时它们不在作用域链上
// （真机里靠 IIFE 同域＋window 导出解析），所以判据段一并抽进来——断言跑的是真实口径，不桩。
const srcPred = cut('function chatIsImageUrlCard(', 'function getPool() {');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

const win = { mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s) };
const env = { window: win, String, Math, RegExp, console };
const names = ['escTxt', 'escTxtBr'];
const fns = new Function('env', 'with (env) { ' + srcPred + '\n' + srcInline + ' return { ' + names.join(', ') + ' }; }')(env);
const inline = win.mochiInlineTextHtml || null;

const assertPresent = typeof inline === 'function';
ok(assertPresent, 'B0 抽取并挂载 window.mochiInlineTextHtml（助手存在，改掉即红）');
if (!assertPresent) { console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败'); process.exit(fail ? 1 : 0); }

const H32 = '58395ec7c37e171594d598aeec80cb87';
const TOK = '@@m:' + H32;

// B1 正例：令牌夹在文字中间 → 转行内 <img>，不再直出令牌串
{
  const h = inline('不错 多笑笑吧\n' + TOK + '\n我不是很适应这个');
  ok(h.indexOf('<img class="msg-inline-tok" src="' + TOK + '"') >= 0, 'B1 混排文本令牌 → 行内 <img class="msg-inline-tok">');
  ok(h.split('@@m:' + H32).length === 2, 'B1 令牌串恰好只出现在 <img src> 属性里（不在任何纯文本处）');
  ok(h.includes('不错 多笑笑吧<br>'), 'B1 令牌前文字照常转义+换行 <br>');
  ok(h.includes('<br>我不是很适应这个'), 'B1 令牌后文字照常转义+换行 <br>');
  ok(h.indexOf('<br><img') >= 0, 'B1 行内图独立成行');
}

// B2 令牌在字符串最前 / 最尾 / 单独整条
{
  ok(inline(TOK + ' 在后面').indexOf('<img class="msg-inline-tok" src="' + TOK + '"') >= 0, 'B2 令牌在首');
  ok(inline('前面 ' + TOK).indexOf('<img class="msg-inline-tok" src="' + TOK + '"') >= 0, 'B2 令牌在尾');
  ok(inline(TOK).indexOf('<img class="msg-inline-tok" src="' + TOK + '"') >= 0, 'B2 整条纯令牌也走行内 <img>（#383 之外的渲染端兜底）');
}

// B3 连续两条令牌（多字卡拼接 join(' ')）都展开
{
  const TOK2 = '@@m:' + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const h = inline('卡一 ' + TOK + ' ' + TOK2);
  ok((h.match(/<img class="msg-inline-tok" src="@@m:[0-9a-f]{32}"/g) || []).length === 2, 'B3 两条内嵌令牌都展开（多卡拼接）');
}

// B4 纯文本 / 无令牌 → 与旧 escTxtBr 完全一致，零回归
{
  const h = inline('普通文本 <b>& 换行\n第二行');
  ok(h === '普通文本 &lt;b&gt;&amp; 换行<br>第二行', 'B4 无令牌文本逐字符与旧 escTxtBr 一致');
}

// B5 形似但非法令牌（不足 32 hex / 含大写）按普通文本转义，不滥转
{
  const h = inline('@@m:zzz 和 @@m:' + H32.toUpperCase());
  ok(h.indexOf('<img') < 0, 'B5 非法令牌（非 32 位小写 hex）不当图，按文本转义');
  ok(h.includes('@@m:zzz'), 'B5 非法令牌文本原样保留');
}

// B6 号码/其它 @@ 前缀不受影响
{
  ok(inline('请加微信 @@wx 123').indexOf('<img') < 0, 'B6 非 @@m: 的 @@ 文本不受影响');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
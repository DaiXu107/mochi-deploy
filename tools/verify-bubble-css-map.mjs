// ===== 验证脚本：聊天气泡 CSS 上传映射（mochiMapBubbleCss，纯 Node 抽源码真函数） =====
// 用法：node tools/verify-bubble-css-map.mjs
// 复现目标（#179：EC-PAD01 SE+Edge 及多机型反馈「聊天里上传网页模板气泡 CSS 后气泡零变化」）：
//   根因与机型无关、只与上传内容有关——旧映射表类名对不上模板时，整份替换后一条规则都
//   匹配不到节点。修后必须满足：
//   ① 纯声明 / 已知别名照旧生效；② 新增别名（bubble-left/right、sent、you、received…）生效；
//   ③ 完全不认识的模板 → 整包声明兜底套到双方气泡并返回提示（保证必有可见变化）；
//   ④ keyframes 帧 / 注释不进兜底；⑤ 群聊作用域前缀正确；⑥ 无选择器声明块直接套用。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
function normalize(p) { return p; }

const src = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const marker = 'window.mochiMapBubbleCss = function';
const start = src.indexOf(marker);
if (start < 0) { console.error('✗ chat.js 里找不到 mochiMapBubbleCss（被删/被改名？）'); process.exit(1); }
const tail = src.slice(start);
const endMarker = tail.search(/^\};[ \t]*\r?$/m);
if (endMarker < 0) { console.error('✗ 找不到函数结尾锚点'); process.exit(1); }
const fnSrc = tail.slice(0, endMarker + 2);
const window = {};
new Function('window', fnSrc + ';')(window);
const map = window.mochiMapBubbleCss;
if (typeof map !== 'function') { console.error('✗ mochiMapBubbleCss 不是函数'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

console.log('场景 1：纯声明（无选择器）→ 双方气泡 !important');
{
  const r = map('border-radius:20px;box-shadow:0 2px 8px #000', '');
  ok(r.out.includes('.msg-out .msg-bubble{border-radius:20px;box-shadow:0 2px 8px #000!important;}'), 'out 侧套用');
  ok(r.out.includes('.msg-in .msg-bubble{'), 'in 侧套用');
  ok(!r.hint, '无提示');

  // 旧版权兼容口径：{...} 包裹的纯声明
  const r2 = map('{border-radius:9px}', '');
  ok(r2.out.includes('border-radius:9px!important;'), '空选择器声明块直接套用');
}

console.log('场景 2：已知/新增别名映射');
{
  const r = map('.message-sent{background:red}.message-received{background:blue}', '');
  ok(r.out.includes('.msg-out .msg-bubble{background:red}') && r.out.includes('.msg-in .msg-bubble{background:blue}'), 'message-sent/received 照旧');
  ok(!r.hint, '无提示');

  const r2 = map('.bubble-left{background:#fff}.bubble-right{background:#000}', '');
  ok(r2.out.includes('.msg-out .msg-bubble{background:#fff}'), 'bubble-left → 我方');
  ok(r2.out.includes('.msg-in .msg-bubble{background:#000}'), 'bubble-right → 对方');

  const r3 = map('.you{color:green}.sent{color:pink}', '');
  ok(r3.out.includes('.msg-in .msg-bubble{color:green}') && r3.out.includes('.msg-out .msg-bubble{color:pink}'), 'you/sent 新别名');

  const r4 = map('.msg-out .msg-bubble{box-shadow:0 0 4px #000}', '');
  ok(r4.out.includes('.msg-out .msg-bubble{box-shadow:0 0 4px #000}'), '标准选择器原样保留');
}

console.log('场景 3：完全未知的模板类名 → 整包声明兜底（#179 主场景）');
{
  const r = map('.wechat-box .content{background:linear-gradient(#ff9a9e,#fad0c4);border-radius:18px}.row{display:flex}', '');
  ok(!!r.hint, '返回兜底提示', JSON.stringify(r.hint));
  ok(r.out.includes('.msg-out .msg-bubble{') && r.out.includes('.msg-in .msg-bubble{'), '双方气泡被套用');
  ok(r.out.includes('background:linear-gradient(#ff9a9e,#fad0c4)') && r.out.includes('border-radius:18px'), '声明完整进入');
  ok(r.out.includes('!important'), '兜底带 !important');

  // :root 变量随兜底一起落到气泡（var() 同元素可解析），但不原样注入 :root
  const r2 = map(':root{--bubble-bg:red}.weird-thing{color:pink}', '');
  ok(r2.out.includes('--bubble-bg:red') && r2.out.includes('color:pink'), 'var 定义随兜底保留');
  ok(!r2.out.includes(':root'), ':root 不原样注入');
}

console.log('场景 4：keyframes 帧 / 注释不进兜底');
{
  const r = map('@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}.wx-bubble-x{color:red}', '');
  ok(r.out.includes('color:red'), '真实声明兜底');
  ok(!r.out.includes('rotate'), 'keyframes 帧被跳过', r.out);

  const r2 = map('/* .ghost{color:red} */ .unknown-bubble-xyz{color:blue}', '');
  ok(r2.out.includes('color:blue') && !r2.out.includes('color:red'), '注释被剥离');
}

console.log('场景 5：群聊作用域前缀');
{
  const r = map('border-radius:20px', '#page-group-chat ');
  ok(r.out.startsWith('#page-group-chat .msg-out .msg-bubble{'), '群聊前缀正确');
  const r2 = map('.totally-unknown{color:#123456}', '#page-group-chat ');
  ok(r2.out.startsWith('#page-group-chat .msg-out') && r2.out.includes('color:#123456'), '群聊兜底带前缀');
}

console.log('场景 6：空值安全');
{
  ok(map('', '').out === '', '空串不出样式');
  ok(map('/* only comment */', '').out === '', '纯注释不出样式');
}

console.log('场景 7：#气泡css 通用气泡类映射必须提特异到双类（收口批补的判别面）');
{
  const a = map('.bubble{background:red}', '');
  ok(a.out === '.msg-bubble.msg-bubble{background:red}', 'SH 类 .bubble 映射成双类（单类＝底色被 app 表面规则盖回）', a.out);
  const b = map('.chat-bubble{background:#0f0}', '');
  ok(b.out === '.msg-bubble.msg-bubble{background:#0f0}', 'SH 类 .chat-bubble 同口径', b.out);
  const c = map('.message{background:blue}', '#page-group-chat ');
  ok(c.out === '#page-group-chat .msg-bubble.msg-bubble{background:blue}', '群聊作用域同样双类', c.out);
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

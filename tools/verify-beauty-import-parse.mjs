// #408 粘贴导入 JSON 自救解析——纯 Node 抽源码真函数行为断言（防回归，零浏览器依赖）
// 抽取 personalize.js 的 window.mochiParsePastedJSON，覆盖：原文/BOM零宽/nbsp/包裹文字/
// 中文引号/字符串外全角标点/尾逗号/字符串内中文标点保护/空文本与垃圾抛错；
// #879 追加：整份网页包裹（.html 分享链路）方案提取——容器内文/裸嵌配平扫描/
// 值含花括号 CSS/长候选优先/无方案可行动报错。
import { readFileSync } from 'node:fs';

const SRC = new URL('../src/js/personalize.js', import.meta.url);
const src = readFileSync(SRC, 'utf8');
const startMark = 'window.mochiParsePastedJSON = function (raw) {';
const si = src.indexOf(startMark);
if (si < 0) { console.error('FATAL: 找不到 mochiParsePastedJSON 定义'); process.exit(1); }
const throwMark = src.indexOf("throw (lastErr || new Error('不是有效的方案 JSON'));", si);
if (throwMark < 0) { console.error('FATAL: 找不到函数收尾 throw'); process.exit(1); }
const ei = src.indexOf('};', throwMark);
const fnSrc = src.slice(si, ei + 2);

const mochiParsePastedJSON = new Function('window', fnSrc + '\nreturn window.mochiParsePastedJSON;')({});

let pass = 0, fail = 0;
// eq 第二参可为值或取值函数（函数抛错＝该断言 FAIL 而非脚本崩溃——红基线上 HEAD 恰在此抛错）
const eq = (name, fnOrVal, want) => {
  let g;
  try {
    const got = typeof fnOrVal === 'function' ? fnOrVal() : fnOrVal;
    g = JSON.stringify(got);
  } catch (e) { fail++; console.error('FAIL ' + name + '（抛错: ' + ((e && e.message) || e) + '）'); return; }
  const w = JSON.stringify(want);
  if (g === w) { pass++; console.log('ok   ' + name); }
  else { fail++; console.error('FAIL ' + name + '\n  got:  ' + g + '\n  want: ' + w); }
};
const throws = (name, fn) => {
  try { fn(); fail++; console.error('FAIL ' + name + '（未抛错）'); }
  catch (e) { pass++; console.log('ok   ' + name + ' → ' + (e.message || e)); }
};
const throwsMsg = (name, fn, re) => {
  try { fn(); fail++; console.error('FAIL ' + name + '（未抛错）'); }
  catch (e) {
    if (re && !re.test(e.message || '')) { fail++; console.error('FAIL ' + name + '（报错文案不匹配: ' + (e.message || e) + '）'); }
    else { pass++; console.log('ok   ' + name + ' → ' + (e.message || e)); }
  }
};

// 1 原文直过
eq('原文合法 JSON', mochiParsePastedJSON('{"a":1}'), { a: 1 });
// 2 BOM/零宽/双向控制
eq('BOM+零宽+双向控制字符', mochiParsePastedJSON('\uFEFF\u200B{"a\u200E":\u200F1}\u2060'), { a: 1 });
// 3 nbsp（contenteditable 粘贴常见，JSON 规范空白外字符）
eq('nbsp 空格清洗', mochiParsePastedJSON('{"a":\u00A01,\u00A0"b":2}'), { a: 1, b: 2 });
// 4 前后包裹说明文字（转发/复制带出）
eq('前后包裹说明文字裁剪', mochiParsePastedJSON('这是方案：\n{"a":1}\n复制以上内容导入'), { a: 1 });
// 5 全中文引号（无半角引号，输入法/转发改写）
eq('中文引号归一', mochiParsePastedJSON('{“a”：1，“b”：“樱花”}'), { a: 1, b: '樱花' });
// 6 字符串外全角标点（有半角引号）
eq('字符串外全角逗号冒号', mochiParsePastedJSON('{"a":1，"b":2，"c"：3}'), { a: 1, b: 2, c: 3 });
// 7 字符串内中文标点保护（值不被污染）
eq('字符串内全角标点保留', mochiParsePastedJSON('{"a":"x，y：z"}'), { a: 'x，y：z' });
// 8 尾逗号（字符串外）
eq('尾逗号丢弃', mochiParsePastedJSON('{"a":1,"b":2,}'), { a: 1, b: 2 });
eq('数组尾逗号+全角括号', mochiParsePastedJSON('｛"a"：［1，2，］｝'), { a: [1, 2] });
// 9 字符串内含 ,} 序列不被尾逗号/扫描破坏
eq('字符串内逗号右括号保护', mochiParsePastedJSON('{"a":"x,}","b":1,}'), { a: 'x,}', b: 1 });
// 10 混合脏：包裹+零宽+全角
eq('混合脏链路', mochiParsePastedJSON('\u200B方案如下\n{"a"：1\uFEFF，}\n请复制'), { a: 1 });
// 11 抛错类：空文本 / 垃圾 / 顶层数组 / 顶层标量
throws('空文本抛错', () => mochiParsePastedJSON('   '));
throws('垃圾文本抛错', () => mochiParsePastedJSON('这不是方案'));
throws('顶层数组抛错', () => mochiParsePastedJSON('[1,2]'));
throws('顶层标量抛错', () => mochiParsePastedJSON('"abc"'));
// 12 脏 JSON 抛错时错误信息非空（供 toast/诊断带出）
throws('损坏 JSON 带真实报错', () => mochiParsePastedJSON('{"a":1,,}'));

// ===== 13~19 #879 整份网页包裹（分享/售卖链路把方案打包成 .html：全选复制/选文件选中 .html）=====
const SCHEME = '{"__kind__":"chat-beauty","cs-in-bg":"#ffe4ec","cs-out-bg":"#111111","cs-bubble-radius":"18px","cs-font-size":"15px"}';
// page() 按真实报障形态做：页内带 <style> 与页尾脚本的花括号干扰（HEAD 朴素「首{到末}」裁剪
// 恰被这些括号带歪＝报障机理「JSON Parse error: Expected '}'」；第④步容器/字符串感知扫描不受影响）
const page = (inner) => '<!DOCTYPE html>\n<html lang="zh">\n<head>\n <meta charset="UTF-8">\n <meta name="viewport" content="width=device-width, initial-scale=1.0">\n <title>美化方案</title>\n <style>body { color:#333; background:#fff; } .tip { padding:10px; }</style>\n</head>\n<body>\n' + inner + '\n<script>var pageCfg={"pv":1};</script>\n</body>\n</html>';
// 13 整份网页 + <pre> 内嵌 HTML 实体转义方案（源码形态复制）
eq('网页<pre>实体转义方案提取', () => mochiParsePastedJSON(page('<h1>我的美化方案</h1>\n<pre>' + SCHEME.replace(/"/g, '&quot;') + '</pre>\n<p>长按全选复制</p>')), JSON.parse(SCHEME));
// 14 整份网页 + <textarea> 包裹
eq('网页<textarea>包裹方案提取', () => mochiParsePastedJSON(page('<textarea readonly>' + SCHEME + '</textarea>')), JSON.parse(SCHEME));
// 15 整份网页 + script 变量赋值（容器不带 application/json → 走配平扫描）
eq('网页script内方案提取', () => mochiParsePastedJSON(page('<script>var scheme = ' + SCHEME + ';\nconsole.log(scheme);</script>')), JSON.parse(SCHEME));
// 16 方案裸嵌正文（无容器）+ 页内更小干扰 JSON（配平扫描长候选优先）
eq('网页裸嵌方案提取且长候选优先', () => mochiParsePastedJSON(page('<p>方案如下：</p>\n' + SCHEME + '\n<p>复制以上内容导入</p>\n<script>var cfg={"a":1};</script>')), JSON.parse(SCHEME));
// 17 方案值含花括号（自定义气泡 CSS）——字符串感知扫描不把值内 {} 当对象边界
const SCHEME_CSS = SCHEME.slice(0, -1) + ',"cs-bubble-css":".msg-bubble span { color:#ff4d94; }"}';
eq('裸嵌方案值含花括号CSS提取', () => mochiParsePastedJSON(page('<p>方案：</p>\n' + SCHEME_CSS)), JSON.parse(SCHEME_CSS));
// 18 网页里没有方案 → 可行动报错（不再抛天书 JSON error）
throwsMsg('网页无方案给可行动报错', () => mochiParsePastedJSON(page('<p>这里什么都没有</p>')), /网页/);
// 19 非网页垃圾文本保持原生解析报错（第④步不误伤既有抛错语义、不给网页引导文案；引擎文案不同故不写死）
try { mochiParsePastedJSON('这不是方案'); fail++; console.error('FAIL 非网页垃圾原文案（未抛错）'); }
catch (e) {
  const m = String((e && e.message) || e);
  if (/网页/.test(m)) { fail++; console.error('FAIL 非网页垃圾原文案（误给网页引导: ' + m + '）'); }
  else { pass++; console.log('ok   非网页垃圾保持原生解析报错 → ' + m); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

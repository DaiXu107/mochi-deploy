// verify-display-tune.mjs — #764 屏幕适配微调（#707「屏幕位置设置」合并升级收口）回归锁定
// 立项：用户直派「iOS/安卓机型适配总偏离，让用户自己调，作为独立功能、要显眼」。
// 方案：入口升为 设置→工具 首位独立组；面板六轴 range 滑杆实时预览 + 双击复位 + 一键还原；
//       新「文字大小」轴写 --mochi-text-adj，由 cssFiles 末位的 display-tune.css 逐条 calc 消费。
// 本脚本锁定：接线三环（LS 键→劫持层→CSS 消费）逐环在位、入口唯一、旧步进/手输模式不回潮、
//       zoom/scale 红线不越、all() 三轴旧伤不复发。
// 用法：node tools/verify-display-tune.mjs（纯源级断言，零浏览器依赖）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const adapt = read('src/js/mobile-adapt.js');
const pers = read('src/js/personalize.js');
const tune = read('src/css/display-tune.css');
const tpl = read('src/template.html');
const tabs = read('src/js/tabs.js');
const help = read('src/js/settings-help.js');
const build = read('build.mjs');

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name); }
};

console.log('[A] 数据层（mobile-adapt.js 劫持层：六轴 + 文字轴落层）');
ok(adapt.includes("text: 'screen-adj-text'"), 'A1 KEYS 登记文字轴 LS 键（全局根命名空间，跨桌面共用）');
ok(/RANGE = \{[^}]*text: \[0, 12\]/.test(adapt), 'A2 RANGE 逐轴取值范围：text=0~12（偏移轴仍是 ±80/±60）');
ok(adapt.includes("if (adj.text) origSet('--mochi-text-adj', adj.text + 'px');"), 'A3 applyText 写 --mochi-text-adj（origSet 绕开自身包装层，幂等直写）');
ok(/applyCached\(\) \{[\s\S]*?applyText\(\);/.test(adapt), 'A4 applyCached 重放链挂上 applyText（缺环＝改了值要刷新才见效；#794 起 applyText 后还有 applySide，故不锁收尾括号）');
ok(adapt.includes("all: function () { return { top: adj.top, bottom: adj.bottom, h: adj.h, desk: adj.desk, shift: adj.shift, text: adj.text, side: adj.side }; },"), 'A5 all() 回满七轴（#707 旧版只回三轴＝面板桌面/整体位移显示 undefinedpx；#794 加 side 轴）');
ok(!adapt.includes("return { top: adj.top, bottom: adj.bottom, h: adj.h };"), 'A6 负向：三轴旧 all() 已消灭（回潮即 A5 失效）');
ok(adapt.includes("var rg = RANGE[k] || [-80, 80];\n      if (isNaN(v) || v < rg[0] || v > rg[1]) return false;"), 'A7 set() 按 RANGE 逐轴校验（文字轴塞不进负数/超限值）');

console.log('[B] 面板层（personalize.js：滑杆实时预览 + 第六轴）');
const s0 = pers.indexOf("#707\u2192#764\uff1a\u5c4f\u5e55\u9002\u914d\u5fae\u8c03");
const s1 = pers.indexOf("getElementById('row-screen-adj')", s0);
ok(s0 > 0 && s1 > s0, 'B0 面板 IIFE 可定位（#707\u2192#764 注释头 \u2192 入口接线）');
const body = pers.slice(s0, s1 + 400);
ok(body.includes("{ k: 'text', name: '\u6587\u5b57\u5927\u5c0f', min: 0, max: 12"), 'B1 AXES 第六轴「文字大小」注册');
ok((body.match(/\{ k: '/g) || []).length === 7, 'B2 七轴齐全（=7，缺轴即面板回流；#794 加了 side 轴）');
ok(body.includes("rng.type = 'range'") && body.includes("rng.setAttribute('data-adj-slider', ax.k);"), 'B3 range \u6ed1\u6746\u63a5\u7ebf\uff08\u6bcf\u8f74\u4e00\u6839 + data-adj-slider \u8eab\u4efd\uff09');
ok(body.includes("rng.addEventListener('input', () => {\n          applyAxis(ax, parseInt(rng.value, 10) || 0, true);"), 'B4 input \u4e8b\u4ef6\u5373\u65f6\u843d\u5c42\uff08\u8fb9\u62d6\u8fb9\u770b\uff1b\u6539\u56de change \u624d\u843d\u5c42\uff1d\u62d6\u52a8\u65e0\u9884\u89c8\uff09');
ok(body.includes("rng.addEventListener('dblclick', () => { applyAxis(ax, 0); })"), 'B5 \u53cc\u51fb\u6ed1\u6746\u590d\u4f4d 0');
ok(body.includes('else panel.hidden = false;'), 'B6 \u8fd4\u56de\u952e\u5173\u9762\u677f\u540e\u91cd\u5f00\u53ef\u590d\u6d3b\uff08\u7f3a\u5931\uff1dtabs \u7f6e hidden \u540e\u518d\u70b9\u5165\u53e3\u6ca1\u53cd\u5e94\uff1dzombie \u9762\u677f\uff09');
ok(!body.includes("mkBtn('\u2212', -2)") && !body.includes('\u8bf7\u8f93\u5165\u6574\u6570\u50cf\u7d20'), 'B7 \u8d1f\u5411\uff1a\u65e7 \u00b12 \u6b65\u8fdb\u6309\u94ae/\u624b\u8f93\u5f39\u7a97\u6a21\u5f0f\u5df2\u4ece\u9762\u677f\u6d88\u706d');
ok(pers.includes("'\u5c4f\u5e55\u9002\u914d\u5fae\u8c03': '") && pers.includes("'\u5c4f\u5e55\u9002\u914d\u5fae\u8c03': 'pmspwt'"), 'B8 \u641c\u7d22\u522b\u540d + \u62fc\u97f3\u8868\u540c\u6b65\uff08#550 \u6559\u8bad\uff1a\u6539\u540d\u4e0d\u8865\u522b\u540d\uff1d\u641c\u300c\u5b57\u53f7/\u504f\u79fb\u300d\u96f6\u547d\u4e2d\uff09');

console.log('[C] \u6d88\u8d39\u5c42\uff08display-tune.css\uff1a\u539f\u5b57\u53f7 + \u504f\u79fb\u53e0\u52a0\uff0c\u96f6 zoom/scale\uff09');
ok(tune.includes('.msg-bubble { font-size: calc(var(--chat-font-size, 14px) + var(--mochi-text-adj, 0px)); }'), 'C1 \u6c14\u6ce1\u6d88\u8d39\u89c4\u5219\u951a\u5728 --chat-font-size \u4e4b\u4e0a\uff08\u7f8e\u5316\u62bd\u5c49\u5b57\u53f7\u8c03\u4e86\u672c\u8f74\u4ecd\u53e0\u52a0\uff0c\u4e92\u4e0d\u8986\u76d6\uff09');
ok(tune.includes('.chat-input { font-size: calc(15px + var(--mochi-text-adj, 0px)); }')
  && tune.includes('.phone .chat-input[contenteditable="true"] { font-size: calc(15px + var(--mochi-text-adj, 0px)); }'), 'C2 \u8f93\u5165\u6846\u6d88\u8d39\uff08\u542b [contenteditable=true] \u9ad8\u7279\u5f02\u6027\u8865\u5200\u2014\u2014base.css \u7684 .phone [contenteditable="true"]{font-size:16px} \u9632 iOS \u805a\u7126\u7f29\u653e\u89c4\u5219\u4f1a\u538b\u8fc7\u88f8\u7c7b\u9009\u62e9\u5668\uff09');
ok(tune.includes('.set-row .txt { font-size: calc(14px + var(--mochi-text-adj, 0px)); }') && tune.includes('.gc-set-row .txt'), 'C3 \u8bbe\u7f6e\u4e3b\u9875/\u7fa4\u804a\u8bbe\u7f6e\u884c\u6d88\u8d39');
const tuneNoCmt = tune.replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/zoom:|transform:\s*scale/.test(tuneNoCmt), 'C4 \u7ea2\u7ebf\uff1a\u672c\u6587\u4ef6\u89c4\u5219\u533a\u6c38\u4e0d\u5f15\u5165\u6574\u9875\u7f29\u653e\u7cfb\u58f0\u660e\uff08AGENTS \u6280\u672f\u7ea2\u7ebf\uff0ciOS \u5361\u987f\u6559\u8bad\uff1b\u6ce8\u91ca\u5265\u9664\u540e\u518d\u6d4b\uff0c\u9632\u7981\u4ee4\u63aa\u8f9e\u8bef\u89e6\u53d1\uff09');
ok(tune.includes('#screen-adj-panel[hidden] { display: none !important; }'), 'C5 \u9762\u677f hidden \u771f\u9690\u85cf\uff08\u5185\u8054 display:flex \u4f1a\u538b\u8fc7 UA [hidden]\uff0c\u7f3a\u8fd9\u6761\u8fd4\u56de\u952e\u5173\u4e0d\u6389\uff09');
ok(build.indexOf("'display-tune.css'") > build.indexOf("'feature-data.css'") && build.includes("cssFiles = ["), 'C6 \u63a5\u5165 cssFiles \u672b\u4f4d\uff08\u540e\u52a0\u8f7d\u8986\u76d6\u5148\u52a0\u8f7d\uff1b\u63d2\u4e2d\u95f4\u4f1a\u88ab dark.css \u7b49\u8986\u76d6\uff09');

console.log('[D] \u5165\u53e3\u4e0e\u63a5\u7ebf\uff08template/tabs/settings-help\uff09');
ok((tpl.match(/id="row-screen-adj"/g) || []).length === 1, 'D1 #row-screen-adj \u5168\u5c40\u552f\u4e00\uff08\u65e7\u884c\u6ca1\u5220\u5e72\u51c0\uff1d\u540c id \u53cc\u5b9e\u4f53\uff0c\u70b9\u51fb\u63a5\u7ebf\u53ea\u9489\u7b2c\u4e00\u4e2a\uff09');
ok(!tpl.includes('\u5c4f\u5e55\u4f4d\u7f6e\u8bbe\u7f6e<span'), 'D2 \u8d1f\u5411\uff1a\u65e7\u300c\u5c4f\u5e55\u4f4d\u7f6e\u8bbe\u7f6e\u300d\u884c\u6807\u9898\u5df2\u6d88\u706d');
const toolsIdx = tpl.indexOf('data-sec="tools"');
const adjIdx = tpl.indexOf('id="row-screen-adj"');
const auditIdx = tpl.indexOf('id="row-card-audit"');
ok(toolsIdx > 0 && adjIdx > toolsIdx && adjIdx < auditIdx, 'D3 \u5165\u53e3\u5728\u5de5\u5177\u533a\u9996\u4f4d\uff08\u6392 #532 \u5b57\u5361\u81ea\u68c0\u4e4b\u524d\uff1d\u7528\u6237\u8981\u6c42\u7684\u300c\u663e\u773c\u300d\u843d\u70b9\uff09');
ok(tabs.includes("'screen-adj-panel'];"), 'D4 tabs.js \u8fd4\u56de\u952e\u6e05\u5355\u767b\u8bb0\uff08\u7f3a\uff1d\u5b89\u5353\u8fd4\u56de\u76f4\u63a5\u9000\u9875\u4e0d\u5173\u9762\u677f\uff09');
ok(help.includes("sel: '#row-screen-adj', name: '\u5c4f\u5e55\u9002\u914d\u5fae\u8c03'"), 'D5 settings-help \u529f\u80fd\u8bf4\u660e\u968f\u6539\u540d\u540c\u6b65');
const notice = read('src/pwa/notice.json');
ok(notice.includes('\u4e03\u3001\u5c4f\u5e55\u9002\u914d\u5fae\u8c03'), 'D6 \u5f00\u5c4f\u516c\u544a\u7b2c\u4e03\u7ae0\u540c\u6b65\uff08\u7528\u6237\u53ef\u611f\u77e5\u529f\u80fd \u2192 \u516c\u544a\u6587\u6848 checklist\uff09');

console.log('[E] \u54e8\u5175\u767b\u8bb0\uff08build.mjs\uff09');
ok((build.match(/#764[a-i] /g) || []).length === 9, 'E1 #764a~i \u4e5d\u6761\u54e8\u5175\u5168\u90e8\u767b\u8bb0');

console.log('[F] \u7f16\u8bd1\u515c\u5e95');
for (const [name, src] of [['mobile-adapt.js', adapt], ['personalize.js', pers], ['tabs.js', tabs], ['settings-help.js', help]]) {
  try { new Function(src); ok(true, name + ' \u6574\u6587\u4ef6\u7f16\u8bd1\u901a\u8fc7'); }
  catch (e) { ok(false, name + ' \u7f16\u8bd1\u5931\u8d25\uff1a' + e.message); }
}

console.log('\n\u7ed3\u679c\uff1a' + pass + '/' + (pass + fail) + ' \u9879\u901a\u8fc7' + (fail ? '\uff08' + fail + ' \u9879\u5931\u8d25\uff09' : ''));
process.exit(fail ? 1 : 0);

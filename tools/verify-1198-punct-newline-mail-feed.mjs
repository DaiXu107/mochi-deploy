// #1198 行为断言：多字卡「拼接符号」池新增内置「换行」（py-punct-nl，默认关）＋信箱/朋友圈共用同一套池
// 用法：node tools/verify-1198-punct-newline-mail-feed.mjs   （MOCHI_ROOT 可指向隔离副本做红绿对照）
// 用户直派（2026-09-24）：「多字卡回复和标点符号 需要新增联系人自己随机选择是否换行」
//   ＋「也需要增加信箱和朋友圈，也加上这个功能。也在回复设置里」
// 方案：chat.js pyJoinCards 的符号池加第八枚内置「换行」（默认关＝存量设备观感零变化），
//   并开放第三个参数 sceneOn（信箱 ml-punct-en / 朋友圈 fd-punct-en 的自家开关：true＝用池、
//   false＝只用空格，且不叠聊天的 py-en/py-punct-en 闸门）；媒体段（dataURL/@@m/外链图）两侧
//   恒用空格（内联图正则按 [^\s"'<>]+ 取 URL，标点或换行贴到尾部会被一起吞进 URL＝图裂）。
// 用例：S1~S8 静态锚（S8＝聊天侧消费点仍是两参调用＝防修过头）；B1~B8 行为（pyJoinCards 从产物
//   切出后在 vm 内跑，样本量取大、阈值留足余量以免随机抖动误报）。
// RED 基线（纯 HEAD b932e48）：S1~S7、B2/B3/B4/B5/B6 红（13 条）；S8/B1/B7/B8 两侧同绿＝默认关的
//   存量零变化与边界口径不变（防修过头）。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ← ' + extra : '')); }
};
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const eq = (name, fn, extra) => { let v = false; try { v = !!fn(); } catch (e) { v = false; } ok(name, v, extra); };

const chatProd = read('js/chat.js') || read('index.html');
const mailProd = read('js/mail.js') || read('index.html');
const feedProd = read('js/feed.js') || read('index.html');
const rsProd = read('js/reply-settings.js') || read('index.html');
const tplProd = read('index.html');
const cssProd = read('index.html');
const buildSrc = read('build.mjs');

// —— 从产物切出 pyJoinCards（函数体自包含，不依赖闭包 cfg），在 vm 内执行 ——
function sliceFn(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex(l => l.indexOf('function ' + name + '(') === 0);
  if (start < 0) return '';
  let depth = 0, out = [], seen = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    out.push(l);
    for (const ch of l) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
    if (seen && depth <= 0) break;
  }
  return out.join('\n');
}
const fnSrc = sliceFn(chatProd, 'pyJoinCards');
if (!fnSrc) { console.log('SKIP: 产物里找不到 pyJoinCards（读不到 js/chat.js？root=' + root + '）'); process.exit(2); }
const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} }, Math, Date, Number, String, Array, Object, JSON, isFinite, NaN, RegExp, __t: null };
vm.createContext(sandbox);
try { vm.runInContext(fnSrc + '\n__t = pyJoinCards;', sandbox); } catch (e) { ok('载入 pyJoinCards', false, e.message); }
const pyJoinCards = sandbox.__t;
if (typeof pyJoinCards !== 'function') { console.log('FAIL pyJoinCards 未导出（函数形态变了？）'); process.exit(1); }

// 七枚存量符号全亮（#694 默认态）；「换行」默认关＝不写该键
const FULL = { 'py-en': 1, 'py-punct-en': 1, 'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 1, 'py-punct-ex': 1, 'py-punct-q': 1, 'py-punct-el': 1, 'py-punct-dash': 1 };
const NL = Object.assign({}, FULL, { 'py-punct-nl': 1 });
const SEP = ['，', '。', '！', '？', '......', '——'];
const SEG = ['甲卡', '乙卡', '丙卡'];
const joinMany = (cfg, n, sceneOn, segs) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    try { out.push(pyJoinCards(segs || SEG, cfg, sceneOn)); }
    catch (e) { out.push('__THROW__' + e.message); }
  }
  return out;
};
const EXPECT_SPACE = '甲卡 乙卡 丙卡';
const MEDIA = ['文字卡', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', '文字卡二'];

// ===== S1~S6 静态锚 =====
eq('S1 chat.js：第八枚内置「换行」入池',
  () => chatProd.indexOf("if (c['py-punct-nl'] === 1) pool.push('\\n');") >= 0);
eq('S2 chat.js：第三参 sceneOn（信箱/朋友圈自带开关，不叠聊天 py-en 闸门）',
  () => chatProd.indexOf('function pyJoinCards(segs, c, sceneOn)') >= 0 &&
    chatProd.indexOf('const usePool = sceneOn === undefined ? pyJoinOn : !!sceneOn;') >= 0);
eq('S3 chat.js：媒体段两侧恒空格（防标点/换行贴进图片 URL 尾部）',
  () => chatProd.indexOf("const isMediaSeg = s => typeof s === 'string' && (s.indexOf('data:') === 0") >= 0);
eq('S4 reply-settings：三个默认值＋chip＋自定义去重真值',
  () => rsProd.indexOf("'py-punct-nl': 0,") >= 0 && rsProd.indexOf("'ml-punct-en': 0,") >= 0 &&
    rsProd.indexOf("'fd-punct-en': 0,") >= 0 &&
    rsProd.indexOf("['py-punct-nl', '换行']") >= 0 &&
    rsProd.indexOf("'——', '\\n'") >= 0 &&
    rsProd.indexOf("'ml-punct-en': '信件拼接随机标点'") >= 0 &&
    rsProd.indexOf("'fd-punct-en': '朋友圈拼接随机标点'") >= 0);
eq('S5 reply-settings：ml/fd 两个开关接进渲染/变更/保存三处清单',
  () => {
    const c = (rsProd.match(/'ml-punct-en'/g) || []).length;
    const d = (rsProd.match(/'fd-punct-en'/g) || []).length;
    return c >= 5 && d >= 5;
  });
eq('S6 入口与容器：chip、两行开关、朋友圈三处 pre-wrap、接入文案',
  () => tplProd.indexOf('data-k="py-punct-nl">换行<') >= 0 &&
    tplProd.indexOf('id="ml-punct-en"') >= 0 && tplProd.indexOf('id="fd-punct-en"') >= 0 &&
    tplProd.indexOf('信件拼接随机标点') >= 0 &&
    cssProd.indexOf('.feed-content { font-size:14px; color:var(--ink); line-height:1.6; margin-top:10px; word-break:break-word; white-space:pre-wrap; }') >= 0 &&
    cssProd.indexOf('.feed-comment { font-size:12px; color:#555; line-height:1.7; padding:3px 0; cursor:pointer; white-space:pre-wrap; }') >= 0 &&
    cssProd.indexOf('.feed-reply { font-size:12px; color:#666; line-height:1.7; padding:2px 0; cursor:pointer; white-space:pre-wrap; }') >= 0);
eq('S6b 消费点：信件正文/朋友圈评论/TA 动态三处走 pyJoinCards＋自家开关',
  () => mailProd.indexOf("window.pyJoinCards(parts, rcf, rcf['ml-punct-en'] === 1)") >= 0 &&
    feedProd.indexOf("window.pyJoinCards(parts, rcf, rcf['fd-punct-en'] === 1)") >= 0 &&
    feedProd.indexOf("window.pyJoinCards(textParts, rcf, rcf['fd-punct-en'] === 1)") >= 0);
eq('S7 哨兵 #1198a~m 已登记',
  () => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'].every(s => buildSrc.indexOf("name: \"#1198" + s) >= 0));
eq('S8 聊天侧消费点未被改成三参（未点亮时聊天行为与原实现同源，防修过头）',
  () => chatProd.indexOf('pyJoinCards(spellSegs, c)') >= 0 && chatProd.indexOf('pyJoinCards(segs, cfg())') >= 0);

// ===== B1 默认关＝存量零变化（红绿两侧都应绿）=====
{
  const list = joinMany(FULL, 300);
  const nl = list.filter(t => t.indexOf('\n') >= 0);
  const punct = list.filter(t => SEP.some(s => t.indexOf(s) >= 0));
  ok('B1 不点亮「换行」时 300 条永不含换行（' + nl.length + ' 条含 \\n）＋标点照旧（' + punct.length + '/300）',
    nl.length === 0 && punct.length >= 100);
}
// ===== B2 点亮后抽得到换行，但不独占 =====
{
  const list = joinMany(NL, 400);
  const nl = list.filter(t => t.indexOf('\n') >= 0);
  const noNl = list.length - nl.length;
  const pure = list.filter(t => t === EXPECT_SPACE).length;
  ok('B2 点亮「换行」后随机抽得到它（' + nl.length + '/400 含 \\n）且仍与其它符号混抽（' + noNl + ' 条不含换行、' + pure + ' 条纯空格）',
    nl.length >= 30 && noNl >= 100 && pure >= 1);
}
// ===== B3 只勾「换行」＝每处都换行 =====
{
  const only = { 'py-en': 1, 'py-punct-en': 1, 'py-punct-nl': 1 };
  const list = joinMany(only, 60);
  const bad = list.filter(t => t !== '甲卡\n乙卡\n丙卡');
  ok('B3 池里只勾「换行」⇒ 两张卡之间恒另起一行', bad.length === 0, bad.slice(0, 2).join(' / '));
}
// ===== B4 信箱/朋友圈开关不看聊天闸门（sceneOn 的核心语义）=====
{
  const chatOff = Object.assign({}, FULL, { 'py-en': 0, 'py-punct-en': 0 });
  const on = joinMany(chatOff, 200, true);
  const off = joinMany(chatOff, 200, false);
  const onPunct = on.filter(t => SEP.some(s => t.indexOf(s) >= 0));
  const offBad = off.filter(t => t !== EXPECT_SPACE);
  ok('B4 聊天两闸全关时：sceneOn=true 仍走符号池（' + onPunct.length + '/200 含标点），sceneOn=false 恒空格',
    onPunct.length >= 80 && offBad.length === 0, offBad.slice(0, 2).join(' / '));
}
// ===== B5 信箱/朋友圈开关打开后也抽得到换行 =====
{
  const chatOff = Object.assign({}, NL, { 'py-en': 0, 'py-punct-en': 0 });
  const list = joinMany(chatOff, 300, true);
  const nl = list.filter(t => t.indexOf('\n') >= 0);
  ok('B5 场景开关独立：聊天闸门关闭时信件/动态照样能抽到换行（' + nl.length + '/300）', nl.length >= 20);
}
// ===== B6 媒体段两侧恒空格（开关全亮也不贴标点）=====
{
  const want = '文字卡 ' + MEDIA[1] + ' 文字卡二';
  const list = joinMany(NL, 200, undefined, MEDIA);
  const bad = list.filter(t => t !== want);
  ok('B6 dataURL 卡两侧恒空格（200 条全为「文字卡 <url> 文字卡二」，标点/换行不贴 URL 尾部）', bad.length === 0,
    bad.slice(0, 2).map(t => JSON.stringify(t)).join(' '));
}
// ===== B7 边界不变（红绿两侧都应绿）=====
eq('B7 空数组空串、单段原样、无 cfg 空格、开关 undefined 走聊天闸门',
  () => pyJoinCards([], NL) === '' && pyJoinCards(['只有一张'], NL) === '只有一张' &&
    pyJoinCards(['A', 'B']) === 'A B' && pyJoinCards(['A', 'B'], { 'py-punct-nl': 1 }) === 'A B');
// ===== B8 池被关空时回退空格（#650 原口径不回退）=====
{
  const none = { 'py-en': 1, 'py-punct-en': 1 };
  const list = joinMany(none, 60, true);
  ok('B8 场景开关打开但池内一枚没勾⇒ 回退单个空格（不崩不残留）', list.every(t => t === EXPECT_SPACE), list[0]);
}

console.log('\nverify-1198：通过 ' + pass + ' / 断言失败 ' + fail);
process.exit(fail ? 1 : 0);

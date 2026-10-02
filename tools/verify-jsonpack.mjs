// ===== 验证脚本：备份导出流式打包器的 JSON 保真度（FIX-REGRESSION #104）=====
// 为什么要单独验：v3.32.x 把导出尾段的 `JSON.stringify(data)` 换成手写流式序列化
//（createJsonPack / packString / packValue / jsonToBlobStreaming），目的是让 800MB 级数据
// 也能导出（vivo X200s Edge：单个字符串超浏览器上限 → RangeError: Invalid string length
// → 遮罩永不隐藏 = 用户报的「一直在打包中」）。手写序列化器一旦产出与 JSON.stringify
// 有任何差异，就是**静默的数据损坏**（备份文件看起来正常、导入后字段变形），
// 而哨兵和布局检查都发现不了。这里做的是最强的断言：整串逐字节相等。
//
// 打包器是 IIFE 内部函数，页面上取不到；为了不往生产代码里塞测试钩子，
// 这里直接从源码按唯一标记切出这一段，在本地作用域里求值后测试。
// 用法：node tools/verify-jsonpack.mjs
import { readFileSync } from 'node:fs';
import { normalize, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(join(root, 'src/js/data-backup.js'), 'utf8');

const FROM = 'const PACK_MERGE';
const TO = '\n  // ===== 导出 =====';
const i0 = src.indexOf(FROM);
const i1 = src.indexOf(TO);
if (i0 < 0 || i1 < 0 || i1 <= i0) {
  console.error('FAIL  在 src/js/data-backup.js 里找不到打包器段落（标记被改动？）');
  process.exit(1);
}
const section = src.slice(i0, i1);
const make = new Function(section + '\nreturn { createJsonPack, packString, packValue, overSmallLimit, jsonToBlobStreaming };');
const { createJsonPack, packValue, overSmallLimit, jsonToBlobStreaming } = make();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); fail++; }
};

// 把一段值用打包器写成 JSON 文本
async function packOne(v, cfg, own) {
  const pack = createJsonPack();
  const stat = { own: !!own, stripCnt: 0, stripChars: 0 };
  await packValue(pack, v, 0, cfg || { mode: 'full', strip: false }, stat);
  return { text: await pack.finish().text(), stat };
}
// 与 JSON.stringify 逐字节比对（undefined 顶层输入时 stringify 返回 undefined）
async function sameAsNative(name, v) {
  const expected = JSON.stringify(v);
  const { text } = await packOne(v, { mode: 'full', strip: false }, true);
  const got = expected === undefined ? 'null' : text;
  ok(name, got === expected, expected === undefined ? '(native 返回 undefined)' : diffHint(expected, got));
}
function diffHint(a, b) {
  if (a === b) return '';
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return '首差异@' + i + ' 期望 …' + JSON.stringify(a.slice(Math.max(0, i - 20), i + 20)) +
    ' 实得 …' + JSON.stringify(b.slice(Math.max(0, i - 20), i + 20));
}

// ===== 1. 标量与转义保真 =====
await sameAsNative('标量：字符串/数字/布尔/null', { s: '中文 emoji 😀', n: 1.5, zero: -0, t: true, f: false, nil: null });
await sameAsNative('转义：引号/反斜杠/换行/制表/控制字符', ['a"b', 'c\\d', 'e\nf', 'g\th', '\u0000\u001f', '\u2028\u2029']);
await sameAsNative('键名转义（含中文键与空键）', { '键 名': 1, 'a"b': 2, '': 3, '1': 4 });
ok('NaN/Infinity → null（与 stringify 一致）', (await packOne([NaN, Infinity, -Infinity])).text === '[null,null,null]');
await sameAsNative('空容器', { a: [], o: {}, nested: [[[]], { x: {} }] });

// ===== 2. 与 stringify 的「非字符串」语义一致 =====
await sameAsNative('Date/Map/Set/TypedArray 不被拍平（整包 stringify）',
  { d: new Date(1788099438922), m: new Map([['k', 1]]), s: new Set([1, 2]), u8: new Uint8Array([1, 2, 3]) });
{
  const v = { a: 1, b: undefined, c: function () { return 1; }, d: 2 };
  const { text } = await packOne(v, { mode: 'full', strip: false }, false);
  ok('undefined / 函数属性被省略（写成 null 会让导入侧多出键）', text === JSON.stringify(v), diffHint(JSON.stringify(v), text));
  const { text: arrText } = await packOne([1, undefined, function () {}, 2], { mode: 'full', strip: false }, false);
  ok('数组里的 undefined/函数 → null（与 stringify 一致）', arrText === '[1,null,null,2]', arrText);
}

// ===== 3. 深容器下钻（PACK_DEPTH 边界内外都要等价） =====
await sameAsNative('第 3 层容器（下钻路径内）', { a: [{ b: [{ c: 'x' }] }, { d: [1, 2, '三'] }] });
await sameAsNative('第 5 层深嵌套（越界后整包 stringify）', { a: { b: { c: { d: { e: [{ f: '深' }] } } } } });

// ===== 4. 超长字符串分片转义（>PACK_SLICE，正是单个大键的形态） =====
{
  const big = '图'.repeat(900000) + '😀'.repeat(200000) + 'tail';   // ~2.9M 字符，必跨分片边界
  const withQuotes = big.replace(/图/g, 'a"b\\c\n');
  await sameAsNative('3M 字符超长字符串分片转义', { v: big });
  await sameAsNative('超长字符串 + 需转义字符', { v: withQuotes });
  const { text } = await packOne([big], { mode: 'full', strip: false }, true);
  ok('超长字符串解析回来与原值相等', JSON.parse(text)[0] === big);
  // 代理对不能被切片边界劈开
  const emojiAtBoundary = 'x'.repeat(1024 * 1024 - 1) + '😀😀😀' + 'y'.repeat(10);
  await sameAsNative('代理对正好落在分片边界', { v: emojiAtBoundary });
}

// ===== 5. 精简模式剥附件 =====
{
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(4096);
  const v = { msgs: [{ text: '你好', img: dataUrl, voice: dataUrl, tiny: 'data:text/plain;base64,AAA' }] };
  const { text, stat } = await packOne(v, { mode: 'text', strip: true }, true);
  const back = JSON.parse(text);
  ok('text 模式：base64 附件置空串（保持字段类型）',
    back.msgs[0].img === '' && back.msgs[0].voice === '' && back.msgs[0].text === '你好');
  ok('text 模式：≤1024 的短 dataURL 不动（不是附件体量）', back.msgs[0].tiny === 'data:text/plain;base64,AAA');
  ok('text 模式：计数准确', stat.stripCnt === 2 && stat.stripChars === dataUrl.length * 2,
    'stripCnt=' + stat.stripCnt + ' stripChars=' + stat.stripChars);
}

// ===== 6. 内存有界：值序列化完即释放；共用值绝不改写 =====
{
  const own = ['a'.repeat(2000), 'b'.repeat(2000), 'c'.repeat(2000)];
  await packOne(own, { mode: 'full', strip: false }, true);
  ok('own=true：数组元素写完即释放', own.every((x) => x === null), JSON.stringify(own.map((x) => typeof x)));
  const shared = [{ text: 'x'.repeat(2000) }, { text: 'y'.repeat(2000) }];
  await packOne(shared, { mode: 'full', strip: false }, false);
  ok('own=false：业务侧正在用的对象一字不改', shared.length === 2 && shared[0].text.length === 2000);
  const objOwn = { k1: 'v'.repeat(2000), k2: { deep: 1 } };
  await packOne(objOwn, { mode: 'full', strip: false }, true);
  ok('own=true：对象键写完即删', Object.keys(objOwn).length === 0, Object.keys(objOwn).join(','));
}

// ===== 7. overSmallLimit：只判大小，绝不为量长度整包 stringify =====
{
  const bigArr = [{ text: 'x'.repeat(25000), img: 'y'.repeat(25000) }];
  const smallArr = [{ text: '你好' }, { text: '在吗', img: 'data:image/png;base64,AAA' }];
  const bigStr = 'z'.repeat(30000);
  let stringifyCalls = 0;
  const origStringify = JSON.stringify;
  JSON.stringify = function () { stringifyCalls++; return origStringify.apply(JSON, arguments); };
  const r1 = overSmallLimit(bigArr, 20 * 1024);
  const r2 = overSmallLimit(smallArr, 20 * 1024);
  const r3 = overSmallLimit(bigStr, 20 * 1024);
  const r4 = overSmallLimit({ a: 1, b: '短' }, 20 * 1024);
  JSON.stringify = origStringify;
  ok('overSmallLimit 判定正确（超阈值 true / 未超 false）',
    r1 === true && r2 === false && r3 === true && r4 === false,
    [r1, r2, r3, r4].join(','));
  ok('overSmallLimit 不做整包 stringify（旧 byteLen 的复制来源）', stringifyCalls === 0, 'calls=' + stringifyCalls);
}

// ===== 8. 总装：jsonToBlobStreaming 产出的整份备份 = JSON.stringify(等价对象) =====
{
  const bigKey = 'a'.repeat(3 * 1024 * 1024);
  const idbValues = {
    'xy-home-v2:default:chat-msgs': [{ t: 1, text: '你好呀 😀' }, { t: 2, text: bigKey }],
    'xy-home-v2:default:cc-groups': { g1: [{ w: '字' }] }
  };
  const order = Object.keys(idbValues);
  let i = 0;
  const readNext = async () => {
    if (i >= order.length) return null;
    const k = order[i++];
    return { k: k, v: idbValues[k], own: true };
  };
  const small = { 'xy-home-v2:nickname': '小莫', 'xy-home-v2:theme': JSON.stringify({ a: 1 }) };
  const exportTime = new Date(1788099438922).toISOString();
  // 参照串必须在打包前算好：own=true 会让打包器写完即释放，跑完后 idbValues 已被掏空
  const expected = JSON.stringify({ version: '1.0', app: 'mochi-zika', exportTime: exportTime, idb: idbValues, ls: small });
  const pack = await jsonToBlobStreaming({ exportTime: exportTime, cfg: { mode: 'full', strip: false } }, readNext, small);
  const text = await pack.finish().text();
  ok('整份备份逐字节等于 JSON.stringify（导入侧 JSON.parse 直接可解）', text === expected, diffHint(expected, text));
  const back = JSON.parse(text);
  ok('解析回来内容一致（聊天条数/大文本不丢）',
    back.idb['xy-home-v2:default:chat-msgs'].length === 2 &&
    back.idb['xy-home-v2:default:chat-msgs'][1].text === bigKey &&
    back.ls['xy-home-v2:nickname'] === '小莫');
  ok('读出的大键已被就地释放（内存有界的直接证据）', idbValues['xy-home-v2:default:chat-msgs'].every((x) => x === null));
}

// ===== 9. 内存有界的核心不变量：单个片段长度不随数据规模增长 =====
// 这就是 #104 的全部意义：旧实现把整个数据集写成「一个字符串」，V8 64 位下单串上限
// ≈5.37 亿字符 → chat-msgs 514MB 的设备直接 RangeError: Invalid string length。
// 现在任何一次 push 的量级只到 PACK_SLICE（1M 字符），与库有多大无关。
{
  let maxLen = 0, total = 0, pushes = 0;
  const rec = { push(s) { if (!s) return; if (s.length > maxLen) maxLen = s.length; total += s.length; pushes++; }, tick() { return Promise.resolve(); } };
  const stat = { own: true, stripCnt: 0, stripChars: 0 };
  const N = 40;
  const msgs = [];
  for (let i = 0; i < N; i++) msgs.push({ t: i, text: '聊'.repeat(500000), img: 'data:image/png;base64,' + 'A'.repeat(500000) });
  await packValue(rec, msgs, 0, { mode: 'full', strip: false }, stat);
  ok('40M 字符数据全程单片段 ≤ 1M+开销（不会再出现「整包一个字符串」）',
    maxLen <= 1024 * 1024 + 1024, 'maxLen=' + maxLen + ' pushes=' + pushes);
  ok('确实写了几十 MB（测试不是空跑）', total > 20 * 1024 * 1024, 'total=' + total);
  ok('值序列化完即释放（源数组已被掏空）', msgs.every((m) => m === null));
}

console.log('结果：' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);

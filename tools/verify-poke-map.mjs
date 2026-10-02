// ===== #287 验证脚本：群聊拍一拍人称映射与单聊 sendPoke+pokePersonMap 等价性 =====
// 背景：#287 给群聊加「点成员头像拍一拍」。单聊拍一拍文本存 {me}/{ta} 占位符（渲染期
// pokePersonMap 回填昵称），群聊拍一拍沿 gcPokeText 口径「落库即定稿文本」——两条链
// 必须对同一条字卡产出逐字相同的最终文本，否则同一条拍一拍字卡在两页显示不一致。
// 用法：node tools/verify-poke-map.mjs （程序化提取 src 内真实函数比对，不依赖构建）
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const gc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');

function extractFn(src, name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) throw new Error(name + ' not found');
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + ' unbalanced');
}
const pokePersonMapSrc = extractFn(chat, 'pokePersonMap');
const sendPokeSrc = extractFn(chat, 'sendPoke');
const gcPokeTextOfSrc = extractFn(gc, 'gcPokeTextOf');

// 单聊全链：sendPoke → addRec 捕获 {me}/{ta} 文本 → pokePersonMap 回填昵称。
// new Function 的自由变量落 globalThis，先给全桩（setTimeout 打断后续回复链）。
let captured = null;
globalThis.addRec = (o) => { captured = o.text; };
globalThis.window = globalThis;
globalThis.logFish = null;
globalThis.setTimeout = () => 0;
globalThis.hit = () => false;
globalThis.cfg = () => ({});
globalThis.addIn = () => ({});
globalThis.showTyping = () => {};
globalThis.hideTyping = () => {};
globalThis.performPoke = () => {};
globalThis.genOneReply = () => ({ text: '', type: 'text' });
globalThis.randInt = (a) => a;
globalThis.T = (s) => s;
const singleOf = new Function(
  'pokePersonMapSrc', 'sendPokeSrc',
  `${pokePersonMapSrc}\n${sendPokeSrc}\n` +
  'return function (action, taNm, meNm) {\n' +
  '  captured = null;\n' +
  '  addRec = (o) => { captured = o.text; };\n' +
  '  sendPoke(action);\n' +
  '  return pokePersonMap(captured, taNm, meNm);\n' +
  '};'
);
const runSingle = singleOf(pokePersonMapSrc, sendPokeSrc);
// 群聊定稿：gcPokeTextOf(action, 成员名)，myName 桩固定
const gcOf = new Function('myName', 'return ' + gcPokeTextOfSrc)(() => '我的昵称');

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? '✅' : '❌') + ' ' + name + (ok ? '' : '  ' + detail)); };

const cases = [
  // 预设·我的（mine 味：含「你」）
  '拍了拍你', '戳了戳你的脸蛋', '弹了一下你的额头', '揉了揉你的头发', '捏了捏你的脸颊', '拍了拍你的肩膀',
  // 预设·TA（ta 味：含「我」）
  '拍了拍我', '戳了戳我的脸蛋', '揉了揉我的头发',
  // 自定义/边角形态
  '我拍了拍你',      // 句首我 + 句中有你（整句保留、只换你、不加速度词前缀）
  '你猜怎么着',      // 句首你（去掉你、我的昵称直接接）
  '拍了拍你的头说真乖', '抱了抱你', '拍了拍我的肩膀',
  '狠狠摔了一跤', '拍拍身上的灰尘' // 无代词
];
const TANM = '小明', MENM = '我的昵称';
for (const c of cases) {
  const single = runSingle(c, TANM, MENM);
  const group = gcOf(c, TANM);
  check('字卡「' + c + '」两页文本一致', single === group, '单聊:' + single + ' / 群聊:' + group);
}
// 防哑哨兵：三段源码必须都真实提取到
check('映射源提取完整（pokePersonMap/sendPoke/gcPokeTextOf）',
  pokePersonMapSrc.length > 100 && sendPokeSrc.length > 200 && gcPokeTextOfSrc.length > 150);

const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);

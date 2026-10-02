// ===== 回归脚本：底部安全区「一个属性一个主人」的补口（#1318 收尾 + #1393e 同族）=====
// 用法：node tools/verify-safe-bottom-single-writer.mjs [--root <目录>]
//
// 立项原因（2026-09-29 体检查出的缺口里第 ①③ 条，外加把 #1393e 一起钉住）：
//   ① iOS 侧 syncSafeBottom 里「键盘期钉 0」「工具条占用期钉 0」两处原来绕过唯一写入点
//      syncBottomSafe 直接 setProperty('0px')。落值是对的，但唯一写入点顺手记的那份
//      「底部基准」(_bottomPin，经 __mochiSafeBottomDiag().base 进诊断单) 会停在上一档
//      ⇒ 同一屏里「基准」与 DOM 现值互相打嘴＝#1393e 那一族（报告写出与事实不符的读数）的缩小版。
//   ② #1318 删掉 1s 复述循环后，「属性被外人摘掉自动补回」的自愈没了。现在的口径是根本不该有
//      第二个写入方，所以本尺钉的是**没有旁路写入**，而不是补一个轮询回去。
//   ③ 顺带钉 #1393e：诊断报值那一格必须取现场计算值，不许再把自带单位/本就是 calc 的读数接第二个单位。
//
// 判据纪律：源码文本事实＋把被测函数真放进 vm 跑起来量返回值（不掺「名字在不在」这种弱断言）。
//   反向对照用两份底本：改前的 HEAD 纯副本应红在 A1/A3/A5，而不是红在「文件读不到」。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const argv = process.argv.slice(2);
const ri = argv.indexOf('--root');
const root = ri >= 0 && argv[ri + 1] ? argv[ri + 1] : 'C:/Users/Administrator/Desktop/mochi';
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };

let pass = 0, fail = 0;
const ok = (name, cond, readout) => {
  if (cond) { pass++; console.log('PASS  ' + name + (readout ? '   ' + JSON.stringify(readout) : '')); }
  else { fail++; console.log('FAIL  ' + name + (readout ? '   ' + JSON.stringify(readout) : '')); }
};

const MA = 'src/js/mobile-adapt.js';
const ma = rd(MA);
if (ma === null) { console.log('FAIL  取不到 ' + MA + '（--root 给对了吗）'); console.log('\n结果：0/1 项通过'); process.exit(1); }
const dev = rd('src/js/device.js') || '';
const lines = ma.split('\n');

function ownerOf(idx) { // 该行归属的最近一个 function 名
  let name = '(顶层)', at = 0;
  for (let i = 0; i <= idx; i++) { const m = lines[i].match(/function\s+([A-Za-z0-9_]+)/); if (m) { name = m[1]; at = i + 1; } }
  return { name: name, at: at };
}

/* A1：该属性的写入点全部落在 syncBottomSafe / syncSafeBottomA 里（一形态一主人，无旁路） */
const writes = [];
lines.forEach((l, i) => { if (/--mochi-safe-bottom["']/.test(l) && (/setProperty\(/.test(l) || /removeProperty\(/.test(l))) writes.push(i); });
const owners = {};
writes.forEach(i => { const o = ownerOf(i); owners[o.name] = (owners[o.name] || 0) + 1; });
const outside = Object.keys(owners).filter(k => k !== 'syncBottomSafe' && k !== 'syncSafeBottomA');
ok('A1 写入点只在两个平台各自唯一的函数里', writes.length >= 4 && outside.length === 0, { 行数: writes.length + 1, 归属: owners, 旁路: outside });

/* A2：其它 src 文件不得写该属性（读可以有） */
const foreign = [];
if (existsSync(join(root, 'src/js'))) {
  readdirSync(join(root, 'src/js')).filter(f => f.endsWith('.js') && f !== 'mobile-adapt.js').forEach(f => {
    rd('src/js/' + f).split('\n').forEach((l, i) => { if (/--mochi-safe-bottom["']/.test(l) && (/setProperty\(/.test(l) || /removeProperty\(/.test(l))) foreign.push(f + ':' + (i + 1)); });
  });
}
ok('A2 其余 src 文件里没有第二个写入方', foreign.length === 0, { 旁路: foreign.slice(0, 4) });

/* A3：删除型——「自带比较再直写」的老写法不得回流 */
const oldForm = lines.filter(l => l.indexOf("if (cur !== ") >= 0 && l.indexOf("setProperty('--mochi-safe-bottom', '0px')") >= 0).length;
ok('A3 删除型：绕过唯一写入点的 cur 比较＋直写 0px 不再存在', oldForm === 0, { 命中行: oldForm });

/* A4：行为等价——把被测函数放进 vm 真跑，钉 0 的落值必须逐字仍是 0px */
const fs2 = ma.indexOf('function bottomSafeCss');
const fe2 = ma.indexOf('\n  }', fs2);
const fnSrc = fs2 >= 0 ? ma.slice(fs2, fe2 + 4) : '';
const vmCode = [
  fnSrc,
  'var OUT = {};',
  'window.__mochiScreenAdj.bottom = 0;',
  'OUT.pin = bottomSafeCss("pin");',
  'OUT.env0 = bottomSafeCss("env");',
  'OUT.num0 = bottomSafeCss(0);',
  'OUT.numNeg = bottomSafeCss(-60);',
  'window.__mochiScreenAdj.bottom = 12;',
  'OUT.env12 = bottomSafeCss("env");',
  'OUT.num12 = bottomSafeCss(34);',
  'OUT.done = 1;',
].join('\n');
let OUT = {}, vmErr = '';
try { const ctx = { window: { __mochiScreenAdj: { bottom: 0 } } }; runInNewContext(vmCode, ctx); OUT = ctx.OUT || {}; } catch (e) { vmErr = String(e.message).slice(0, 90); }
ok('A4a 钉 0 交回写入点后落值逐字不变', OUT.pin === '0px', { 读数: OUT.pin, 报错: vmErr });
ok('A4b 偏移=0 时 env 那一支仍返回空串（摘除属性让 CSS 回落 env()，#129/#969 未动）', OUT.env0 === '', { 读数: OUT.env0 });
ok('A4c 偏移=12 时把偏移叠在 env() 上（用户手调照常生效）', OUT.env12 === 'calc(env(safe-area-inset-bottom, 0px) + 12px)', { 读数: OUT.env12 });
ok('A4d 数值基准按本机偏移收口，负值夹到 0px', OUT.num0 === '0px' && OUT.numNeg === '0px' && OUT.num12 === '46px', { 读数: [OUT.num0, OUT.numNeg, OUT.num12] });

/* A5：「底部基准」只有一个更新者，且就在唯一写入点里 */
const pinSets = [];
lines.forEach((l, i) => { if (/_bottomPin\s*=/.test(l) && l.indexOf('var _bottomPin') < 0) pinSets.push(ownerOf(i).name + ':' + (i + 1)); });
ok('A5 诊断里的「底部基准」与实际写入者同源（更新点唯一且在 syncBottomSafe 内）', pinSets.length === 1 && pinSets[0].indexOf('syncBottomSafe') === 0, { 更新点: pinSets });

/* A6：#1393e 同族——诊断取现场值，且不再补第二个单位 */
const dl = dev.split('\n').filter(l => l.indexOf("--mochi-safe-bottom=' + (function") >= 0);
const readsLive = dl.some(l => l.indexOf("getComputedStyle(document.documentElement).getPropertyValue('--mochi-safe-bottom')") >= 0);
const secondUnit = dl.some(l => l.indexOf("_v + 'px'") >= 0);
const asIs = dl.some(l => l.indexOf("return _v || (") >= 0);
ok('A6a 诊断那一格取现场计算值（命中行数=' + dl.length + '）', dl.length >= 1 && readsLive, {});
ok('A6b 照原样报（自带单位或本就是 calc 都不再接单位）', asIs && secondUnit === false, { 接二次单位: secondUnit });
const diagReader = /getPropertyValue\(['"]--mochi-safe-bottom['"]\)\.trim\(\)\s*\|\|/.test(dev);
ok('A6c 另一处取证读数同样原样报（未设才写回落说明）', diagReader, {});

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过   （被测：' + root + '）');
process.exit(fail ? 1 : 0);

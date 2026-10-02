// verify-1480-survey-perq-multimax.mjs — #1480「多选题按题限个数」链路是否真的通（用户实报）
// 用户原话（2026-09-30）：「批量问卷里设置的多选题有缺陷，无法设置单个题目最多选几个答案，只能设置整体的」。
// #1415 给批量问卷加了多选题，但「最多选几个」只有全站共用的那一根杆（per-cid 键 ask-multi-max，
// 2~6 默认 3）——十道多选题只能共用一个上限。本批把标记语法扩成「（多选·最多N）」：按题写死、
// 随题/随卡/随收藏透传，没写的题仍走杆。判据一律零机型／零 UA 分支。
// 本尺钉住四件事：
//   ① 标记解析真认「·最多N」（括号式/裸后缀/全半角分隔/带「个」，2~6 有效、越界退回杆）；
//   ② 按题上限一路透传不丢：问卷解析落 multiMax → TA 作答先取题上的再落杆 → 收藏进题库保住
//      → 题库批量导入同判据 → 推卡 askMultiMax 随卡走；
//   ③ 用户手答 TA 的限选题同受一道闸（勾超被拦并说明），没带上限的卡与改前逐字同行为；
//   ④ 老口径一字不动：普通「（多选）」仍是多选、杆仍是杆、单选题仍抽 1 个（覆盖式修补最易撞坏的一侧）。
// 用法：node build.mjs && node tools/verify-1480-survey-perq-multimax.mjs
//       红侧／隔离副本：SERVE_ROOT=<纯 HEAD 副本> node tools/verify-1480-survey-perq-multimax.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 200) + ']' : '')); } };
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const count = (s, needle) => s.split(needle).length - 1;
console.log('serve root = ' + root);

const ask = read(join('js', 'ta-ask.js'));
const chat = read(join('js', 'chat.js'));
const idx = read('index.html');
const notice = read('notice.json');
ok(ask.length > 1000, 'S0 产物 js/ta-ask.js 读到了（空＝没构建或 SERVE_ROOT 指错）', ask.length);

// ================= S 组：产物源码级（两侧同尺，红侧＝纯 HEAD） =================
console.log('S 组 产物源码级');
{
  ok(count(ask, 'const br = s.match(/[（(]\\s*多\\s*选\\s*(?:[·•:：]?\\s*最\\s*多\\s*(\\d{1,2})\\s*个?\\s*)?[)）]\\s*$/);') === 1,
    'S1 括号式标记认「·最多N」（退回旧正则＝按题上限从源头就没人读，「只能设置整体的」复发）');
  ok(count(ask, 'const bare = s.length > 2 ? s.match(/\\s*多\\s*选\\s*(?:[·•:：]?\\s*最\\s*多\\s*(\\d{1,2})\\s*个?\\s*)?$/) : null;') === 1,
    'S2 裸后缀同样认「·最多N」（只改括号式＝【题？多选·最多2】这种写法悄悄降级成普通多选）');
  ok(count(ask, 'if (cur.multi && cur.max >= 2) sq.multiMax = cur.max;') === 1,
    'S3 问卷解析把按题上限存成 multiMax（解析认了、落库丢了＝发出的卷子没有限选）');
  ok(count(ask, 'if (cur.multi && cur.max >= 2) q.multiMax = cur.max; singles++;') === 1,
    'S4 题库批量导入同判据落 multiMax（同一标记两个入口只有问卷认＝题库导入悄悄降级）');
  ok(count(ask, 'const max = (q.multiMax >= 2 && q.multiMax <= 6) ? q.multiMax') === 1,
    'S5 TA 作答上限先取题上的 multiMax 再落回全站杆（题干写死的 N 不作数＝本批白修）');
  ok(count(ask, 'askMultiMax: (isPick && q.type === \'multi\' && q.multiMax >= 2) ? q.multiMax : 0') === 1,
    'S6 按题上限随互动卡透传（题库限选题推给用户答时不带闸＝手动勾选不受限）');
  ok(count(ask, 'if (nq.type === \'multi\' && q.multiMax >= 2) nq.multiMax = q.multiMax;') === 1,
    'S7 问卷收藏进题库保住 multiMax（限选题收进题库变普通多选＝限选悄悄消失）');
  ok(count(ask, "tc-known\">多选' + (q.multiMax >= 2 ? '·限' + q.multiMax : '')") === 1,
    'S8 题库徽标亮出「多选·限N」（限与不限长得一样＝出题人分不清哪道按题限了）');
  ok(count(ask, "(q.type === 'multi' ? '多选' + (q.multiMax >= 2 ? '·限' + q.multiMax : '') + '·' : '单选·')") === 1,
    'S9 问卷详情徽标同口径（点开卷子看不出哪道题限选几个）');
  ok(count(ask, "+ (nCap ? nCap + ' 题单独限选、其余' : '') +") === 1,
    'S10 草稿状态行点名单独限选的题数（杆上读数被当成全卷统一上限＝按题限生效了也没人知道）');
  ok(count(chat, 'const capN = (rec.askMultiMax >= 2 && rec.askMultiMax <= 6) ? rec.askMultiMax : 0;') === 1,
    'S11 手动作答上限的取数（capN 恒 0＝闸永远不关）');
  ok(count(chat, "if (at < 0 && capN && picked.length >= capN) { toast('这题最多选 ' + capN + ' 个'); return; }") === 1,
    'S12 手动作答的上限闸（限 2 的题勾第 3 个照样上屏＝用户侧与 TA 侧两套规矩）');
  ok(count(chat, "? '最多选 ' + rec.askMultiMax + ' 个，选完点「提交」'") === 1,
    'S13 限选卡提示语直接说「最多选 N 个」（卡上不说、勾到第三个才被拦＝像故障不像规则）');
  ok(count(chat, "'askType', 'askMultiMax', 'deskCk'") === 1,
    'S14 尾日志压缩字段表带上 askMultiMax（尾巴回放出的限选卡丢了上限＝跨桌面/回收恢复后闸失效）');
  ok(count(idx, '个别题想另限就写成「（多选·最多2）」') === 1,
    'S15 问卷格式说明写出按题限选写法（页面没有任何一处教这个写法＝功能等于不存在）');
  ok(count(notice, '想按题限个数就写成「（多选·最多2）」') === 0,
    'S16 #1502 起该说明随开屏公告章下线、不得回流（写法说明由问卷设置页 S15 承担，开屏公告不再复述功能说明）');
  // 老口径一字未动（覆盖式修补最易撞坏的一侧）
  ok(count(ask, 'askMultiMarkOf(') === 3 && count(ask, 'function askMultiMarkOf(') === 1,
    'S17 「多选」标记仍只有一处定义、两处消费（多出一处＝有人开始各写一套判据）',
    'def=' + count(ask, 'function askMultiMarkOf(') + ' use=' + count(ask, 'askMultiMarkOf('));
  ok(count(ask, "if (q.type === 'multi' && typeof window.mochiPickMulti === 'function') {") === 1,
    'S18 TA 答多选题仍走「一次抽好几个」那条路（本批不该动 #1415 的作答出口）');
  const uaBad = /navigator\.userAgent|iPhone|iPad|HarmonyOS|Xiaomi|Redmi|MicroMessenger/i;
  const win = (s, needle, span) => { const i = s.indexOf(needle); return i < 0 ? '' : s.slice(Math.max(0, i - span), i + needle.length + span); };
  ok(!uaBad.test(win(ask, 'function askMultiMarkOf', 900)) && !uaBad.test(win(chat, 'const capN = (rec.askMultiMax', 600)),
    'S19 本批新增逻辑里零机型／零 UA 分支（判据只取题目自身的结构事实）');
}

// ================= B 组：抽真身进沙箱判解析行为 =================
console.log('B 组 解析沙箱');
const mm = (function () {
  const a = ask.indexOf('function askMultiMarkOf');
  const b = ask.indexOf('function surveyAnswerText');
  ok(a > 0 && b > a, 'B0 解析函数切片定位成功（indexOf 区间，不用缩进正则——verify-1230 的教训）', a + '/' + b);
  if (!(a > 0 && b > a)) return null;
  const slice = ask.slice(a, b);
  ok(slice.length > 800, 'B0b 切片长度合理（截成空串＝整串 needle 冒充代码丢了）', slice.length);
  try {
    const f = new Function('window', slice + '\nreturn { mm: askMultiMarkOf, sp: surveyParse };');
    return f({});
  } catch (e) { ok(false, 'B0c 解析函数编译失败', String(e)); return null; }
})();
if (mm) {
  let r;
  r = mm.mm('今晚想吃点什么？（多选）');
  ok(r && r.multi === true && r.max === 0 && r.text === '今晚想吃点什么？', 'B1 老「（多选）」口径一字未动（multi + max 0 + 干净题干）', JSON.stringify(r));
  r = mm.mm('周末干嘛？多选');
  ok(r && r.multi === true && r.max === 0 && r.text === '周末干嘛？', 'B2 裸后缀「多选」老口径一字未动', JSON.stringify(r));
  r = mm.mm('今晚想吃点什么？（多选·最多2）');
  ok(r && r.multi === true && r.max === 2 && r.text === '今晚想吃点什么？', 'B3 括号式「（多选·最多2）」＝按题限 2、题干剥干净', JSON.stringify(r));
  r = mm.mm('题？（多选·最多 3 个）');
  ok(r && r.max === 3, 'B4 带空格与「个」也认（「（多选·最多 3 个）」）', JSON.stringify(r));
  r = mm.mm('题？（多选：最多4）');
  ok(r && r.max === 4, 'B5 全角冒号分隔也认（「（多选：最多4）」）', JSON.stringify(r));
  r = mm.mm('题？多选·最多5');
  ok(r && r.multi === true && r.max === 5 && r.text === '题？', 'B6 裸后缀「题？多选·最多5」同样按题限', JSON.stringify(r));
  r = mm.mm('题？（多选·最多9）');
  ok(r && r.multi === true && r.max === 0, 'B7 越界数字 9 只当普通多选、上限退回杆（不把没剥干净的标记念给 TA）', JSON.stringify(r));
  r = mm.mm('题？（多选·最多1）');
  ok(r && r.multi === true && r.max === 0, 'B8 「最多1」对多选题没意义＝视为没写（仍走杆）', JSON.stringify(r));
  r = mm.mm('今晚吃啥？');
  ok(r && r.multi === false && r.max === 0, 'B9 没标记的题干照旧是普通题（本批不改变无标记行为）', JSON.stringify(r));
  r = mm.mm('多选');
  ok(r && r.multi === false, 'B10 整句就是「多选」两个字＝字面题目（len>2 老闸门还在）', JSON.stringify(r));
  const qs = mm.sp('【题A？（多选·最多2）】\n火锅\n烧烤\n【题B？（多选）】\n火锅\n烧烤\n【题C？】\n火锅\n烧烤\n【题D？】\n一');
  ok(Array.isArray(qs) && qs.length === 4, 'B11 四道题都解析出来（多选×2＋单选＋文字）', JSON.stringify(qs && qs.map(q => q.type)));
  ok(qs[0] && qs[0].type === 'multi' && qs[0].multiMax === 2, 'B12 问卷解析把按题上限落到该题的 multiMax 上', JSON.stringify(qs[0]));
  ok(qs[1] && qs[1].type === 'multi' && !('multiMax' in qs[1]), 'B13 没写「·最多N」的多选不带 multiMax 键（走杆的题就是走杆，不多存一份）', JSON.stringify(qs[1]));
  ok(qs[2] && qs[2].type === 'single' && !('multiMax' in qs[2]), 'B14 单选题不带 multiMax（上限概念只属于多选）');
  ok(qs[3] && qs[3].type === 'text', 'B15 文字题不受影响');
}

// ================= C 组：TA 作答上限取数沙箱 =================
console.log('C 组 作答沙箱');
(function () {
  const a = ask.indexOf('function askMultiMarkOf');
  const b = ask.indexOf('function surveySeqAnswers');
  if (!(a > 0 && b > a)) { ok(false, 'C0 作答函数切片定位失败', a + '/' + b); return; }
  const calls = [];
  const sandbox = { window: { mochiPickMulti: (len, max) => { calls.push([len, max]); return [1]; }, askMultiMaxLoad: () => 3 } };
  let fns;
  try {
    fns = new Function('window', ask.slice(a, b) + '\nreturn { pick: surveyPickAnswer };')(sandbox.window);
  } catch (e) { ok(false, 'C0b 作答函数编译失败', String(e)); return; }
  calls.length = 0;
  let ans = fns.pick({ type: 'multi', options: ['火锅', '烧烤', '寿司'], multiMax: 2 });
  ok(calls.length === 1 && calls[0][1] === 2, 'C1 题上写死「最多2」＝作答上限就是 2（不看杆）', JSON.stringify(calls));
  ok(ans === '烧烤', 'C2 答案串仍按抽中的选项原文念（不因 multiMax 改变答案形态）', ans);
  calls.length = 0;
  fns.pick({ type: 'multi', options: ['火锅', '烧烤', '寿司'] });
  ok(calls.length === 1 && calls[0][1] === 3, 'C3 没写「·最多N」的题仍走全站那根杆（杆＝3）', JSON.stringify(calls));
  calls.length = 0;
  fns.pick({ type: 'multi', options: ['火锅', '烧烤', '寿司'], multiMax: 9 });
  ok(calls.length === 1 && calls[0][1] === 3, 'C4 越界的按题数不作数、退回杆（2~6 之外的值视为没写）', JSON.stringify(calls));
  calls.length = 0;
  const pick = sandbox.window.mochiPickMulti;
  sandbox.window.mochiPickMulti = undefined;
  const single = fns.pick({ type: 'single', options: ['十点', '十一点'] });
  sandbox.window.mochiPickMulti = pick;
  ok(calls.length === 0 && ['十点', '十一点'].indexOf(single) >= 0, 'C5 单选题仍走抽 1 个的老路（本批不传染单选）', single);
})();

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✅') + ' verify-1480 共 ' + (pass + fail) + ' 断言，通过 ' + pass);
process.exit(fail ? 1 : 0);

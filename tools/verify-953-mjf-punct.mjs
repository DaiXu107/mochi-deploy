// ===== 回归脚本：梦角自由造句·句尾标点与「修改/关闭」开关（#953） =====
// 用法：node tools/verify-953-mjf-punct.mjs   （MOCHI_ROOT 可指向隔离副本）
// 症状：①用户实报「梦角自由造句没有使用标点符号」——三种手法要么把尾标点剥掉、要么只在词间
//   插逗号/空格，出句清一色没有句尾标点；②用户直派「使用标点符号也可以修改或关闭」——
//   回复设置里要能改标点候选、也能整个关掉不补。
// 修复：dream-free.js 出句唯一收口 dreamFreePick 统一补标点（句尾已有标点不重复补），
//   候选池由回复设置驱动——mjf-punct=0 ＝不补；reply-mjf-punct-pool 原串非空＝用它当池
//   （空格/| 分隔，无分隔则按字符拆），空＝内置默认池（。 ~ ！ ……）。
// 用例（均为行为断言，vm 里喂 mock 语料）：
//   S1 默认（mjf-punct 缺省/1）出句 100% 带句尾标点
//   S2 mjf-punct=0 出句不补标点（源句本身无标点时一律无标点）
//   S3 自定义池「！|？」＝只出这两个候选
//   S4 无分隔符自定义池「。？」＝按字符拆成两个候选
//   S5 空白池回落内置默认池（仍 100% 带标点）
//   S6 不叠标点：源句自带句尾标点时不出现「！！」式双标点
//   S7 设置接线锚在位（DEFAULTS 有 mjf-punct、池原串随 replyCfg/replyCfgFor 读出、模板有开关与
//      输入框、build.mjs 有 #953a~f 哨兵）
// —— 以下为 #1396 新契约（「可用标点」换成与 #650/#712 同款 chips 池；纯 HEAD 底本 S8~S14 应全红）——
//   S8 chips 池只取 on=1、按存盘序进池（等概率，不再句号写三遍）
//   S9 chips 池选到「空格/换行」也真补得到句尾（旧文本框按空白切分，这两枚永远选不到）
//   S10 chips 池全关/坏 JSON ⇒ 回落 #953 旧链（旧原串优先），不炸、不是「一枚都不补」
//   S11 从没点过 chip（新键为空）⇒ 出句池与 #953 当天逐字相同＝存量零变化的直接证据
//   S12 mjf-punct=0 时新池同样不补（关掉就是关掉，与池内容无关）
//   S13 新键 reply-mjf-punct-set 随 replyCfg/replyCfgFor 双双附带 ＋ 模板十枚内置 chips 与「＋」钮齐
//   S14 旧文本框与「可用标点（空格分隔）」那句文案不回流（留着＝两套口径并存）
// RED 基线（#953 当年，纯 HEAD 底本）：S1~S7 全红（dreamFreePick 不补标点、mjf-punct 键不存在）。
//   本批（#1396）对照＝同 tip 纯 HEAD 副本只放进本尺：S1~S7 与 S11 皆绿（旧链一字未动），
//   S8~S10／S11b／S12~S14 红——红在「新池根本不认／新键没人附带／旧文本框还在」，正是本批的增量。
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ← ' + extra : '')); }
};
const END_OK = /[。．！？!?~～…，、,.;；:：）)”’"]/;
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };

// —— 加载产物 js/dream-free.js（外置模块形态）到 vm，喂 mock 语料/词典 ——
const src = read('js/dream-free.js');
if (!src) { console.log('SKIP: 找不到 ' + join(root, 'js/dream-free.js')); process.exit(2); }
const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} }, Math, Date, Number, String, Array, Object, isFinite, NaN };
sandbox.window.getDefaultCardGroups = (cat) => (cat === 'dict'
  ? [['词库A', ['今天', '也要', '好好', '爱自己', '晚安', '抱抱', '亲亲']]]
  : []);
sandbox.window.getCustomCards = () => [];
sandbox.window.defaultCardCat = () => true;
sandbox.window.isDefaultCardOff = () => false;
sandbox.window.ccAppendCards = () => true;
vm.createContext(sandbox);
try { vm.runInContext(src, sandbox); } catch (e) { console.log('FAIL 载入 dream-free.js 抛错：' + e.message); process.exit(1); }
const W = sandbox.window;
if (typeof W.dreamFreePick !== 'function') { console.log('FAIL dreamFreePick 未导出（模块形态变了？）'); process.exit(1); }

// 语料分组：PLAIN＝源句尾无标点（用于判「补了没有」）；WITH_PUNCT＝源句自带句尾标点
//（用于判「不叠标点」）。换语料＝改 getCustomCards（默认聊天字卡/词典两源保持空池，
// 只让自定义字卡源出句，判据才干净）
const PLAIN = ['今天也要好好爱自己，晚安哦', '抱抱你然后亲亲你一下', '最喜欢你想你的样子了'];
const WITH_PUNCT = PLAIN.concat(['今天也要好好爱自己。', '抱抱你，亲亲你！', '最爱你的笑容呀？']);
function setCorpus(list) {
  sandbox.window.getCustomCards = () => list;
  sandbox.window.defaultCardCat = () => false; // 默认聊天字卡源不参与
}

const run = (cfg, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = W.dreamFreePick(Object.assign({ 'mjf-en': 1, 'mjf-prob': 100 }, cfg));
    if (r && typeof r.text === 'string') out.push(r.text);
  }
  return out;
};
const badEnd = (list) => list.filter(t => !END_OK.test(t.charAt(t.length - 1)));
const tailOf = (list) => list.map(t => t.charAt(t.length - 1));

// S1 默认：出句必须带句尾标点（语料含自带标点与裸句两种）
{
  setCorpus(WITH_PUNCT);
  const list = run({}, 300);
  const bad = badEnd(list);
  ok('S1 默认出句 100% 带句尾标点（' + list.length + ' 条）', list.length >= 100 && bad.length === 0,
    bad.length ? '无标点例：' + bad.slice(0, 3).join(' / ') : '');
}
// S2 关闭：不补标点（裸句语料 ⇒ 出句不应以池内标点收尾）
{
  setCorpus(PLAIN);
  const list = run({ 'mjf-punct': 0 }, 200);
  const bad = list.filter(t => /[。．！？~～…]$/.test(t));
  ok('S2 mjf-punct=0 不补句尾标点（' + list.length + ' 条）', list.length >= 100 && bad.length === 0,
    bad.length ? '仍补例：' + bad.slice(0, 3).join(' / ') : '');
}
// S3 自定义池（| 分隔）
{
  setCorpus(PLAIN);
  const list = run({ 'mjf-punct-pool': '！|？' }, 200);
  const tails = new Set(tailOf(list));
  ok('S3 自定义池「！|？」只出这两个候选', list.length >= 100 && tails.size === 2 && tails.has('！') && tails.has('？'),
    '实际候选：' + [...tails].join(''));
}
// S4 自定义池（无分隔符 ⇒ 按字符拆）
{
  setCorpus(PLAIN);
  const list = run({ 'mjf-punct-pool': '。？' }, 200);
  const tails = new Set(tailOf(list));
  ok('S4 无分隔自定义池「。？」按字符拆成两个候选', list.length >= 100 && tails.size === 2 && tails.has('。') && tails.has('？'),
    '实际候选：' + [...tails].join(''));
}
// S5 空白池回落内置默认池
{
  setCorpus(PLAIN);
  const list = run({ 'mjf-punct-pool': '   ' }, 150);
  const bad = badEnd(list);
  const tails = new Set(tailOf(list));
  ok('S5 空白池回落内置默认池（仍全部带标点且不止一种候选）', list.length >= 80 && bad.length === 0 && tails.size >= 2,
    bad.length ? '无标点例：' + bad.slice(0, 2).join(' / ') : '候选只有：' + [...tails].join(''));
}
// S6 不叠标点：源句自带句尾标点时不得出现双标点（注意「……」是合法的单候选，不算叠标点）
{
  setCorpus(WITH_PUNCT);
  const list = run({}, 300).concat(run({ 'mjf-punct-pool': '！' }, 200));
  const dup = list.filter(t => /[。．！？]{2,}$/.test(t) || /[。．！？~～]\s*[。．！？~～]$/.test(t));
  ok('S6 已有句尾标点不重复补（无双标点）', dup.length === 0, dup.slice(0, 3).join(' / '));
}
// S7 设置接线锚
{
  const rs = read('src/js/reply-settings.js');
  const tpl = read('src/template.html');
  const bm = read('build.mjs');
  const a = rs.includes("'mjf-punct': 1,");
  const b = rs.includes("String(ls.get('reply-mjf-punct-pool') || '')") && rs.includes("String((s || ls).get('reply-mjf-punct-pool') || '')");
  const c = tpl.includes('id="mjf-punct"') && tpl.includes('id="mjf-punct-pool"');
  const d = ['#953a', '#953b', '#953c', '#953d', '#953e', '#953f'].every(n => bm.includes("name: '" + n));
  ok('S7 设置接线（DEFAULTS 键 / 池读取 / 模板池容器 / 哨兵）', a && b && c && d,
    [!a && '缺 DEFAULTS mjf-punct', !b && '缺池读取', !c && '缺模板行', !d && '缺哨兵'].filter(Boolean).join('；'));
}
// ===== #1396：「可用标点」= 与 #650/#712 同款 chips 池（reply-mjf-punct-set）新契约 =====
const hasPool = typeof W.dreamFreePunctPool === 'function'; // 新池判据导出（旧底本没有＝下面各支红）
const poolOf = cfg => (hasPool ? W.dreamFreePunctPool(Object.assign({ 'mjf-punct': 1 }, cfg)) : null);
const setOf = arr => JSON.stringify(arr);
const eqArr = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
const noPool = '未导出 dreamFreePunctPool（＝新池整条不认）';
// S8 只取 on=1、按存盘序等概率进池（句号不再靠「写三遍」加权）
{
  const p = poolOf({ 'mjf-punct-set': setOf([{ s: '？', on: 1 }, { s: '。', on: 0 }, { s: '！', on: 1 }]) });
  ok('S8 chips 池只取 on=1、按存盘序进池', hasPool && eqArr(p, ['？', '！']), hasPool ? JSON.stringify(p) : noPool);
  const q = poolOf({ 'mjf-punct-set': setOf([{ s: '', on: 1 }, { s: '1234567', on: 1 }, { s: '。', on: 2 }, { s: '！', on: 1 }]) });
  ok('S8b 非法项（空 s／超 6 字／on 非 1）不进池', hasPool && eqArr(q, ['！']), hasPool ? JSON.stringify(q) : noPool);
}
// S9 「空格／换行」这两枚旧文本框永远选不到的候选，现在真能补到句尾
{
  setCorpus(PLAIN);
  const nl = run({ 'mjf-punct-set': setOf([{ s: '\n', on: 1 }]) }, 150);
  const sp = run({ 'mjf-punct-set': setOf([{ s: ' ', on: 1 }]) }, 150);
  ok('S9 选到「换行/空格」也真补得到句尾', nl.length >= 60 && sp.length >= 60
    && nl.every(t => t.charAt(t.length - 1) === '\n') && sp.every(t => t.charAt(t.length - 1) === ' '),
    nl.length + '/' + sp.length + ' 条，换行尾样本 ' + JSON.stringify(nl.slice(0, 2)));
}
// S10 新池存在但一枚没点亮／串坏掉 ⇒ 回落 #953 旧链（旧原串优先），不是「不补标点」
{
  const a = poolOf({ 'mjf-punct-set': setOf([{ s: '。', on: 0 }]), 'mjf-punct-pool': '！|？' });
  const b = poolOf({ 'mjf-punct-set': 'not-json', 'mjf-punct-pool': '！' });
  ok('S10 新池全空/坏 JSON ⇒ 回落旧链（旧原串优先）', hasPool && eqArr(a, ['！', '？']) && eqArr(b, ['！']),
    hasPool ? JSON.stringify([a, b]) : noPool);
}
// S11 默认池常量一字未动（存量零变化的底座，两侧皆绿才算诚实）
{
  const m = src.match(/const END_PUNCT_DEFAULT = (\[[^\]]*\]);/);
  ok('S11 内置默认池常量一字未动', !!m && m[1] === "['。', '。', '。', '~', '！', '……']", m ? m[1] : '没找到该行');
  const p = poolOf({});
  const q = poolOf({ 'mjf-punct-set': '', 'mjf-punct-pool': '   ' });
  ok('S11b 没点过 chip 时新代码算出的池 === 那个默认池', hasPool && eqArr(p, ['。', '。', '。', '~', '！', '……']) && eqArr(q, ['。', '。', '。', '~', '！', '……']),
    hasPool ? JSON.stringify([p, q]) : noPool);
}
// S12 「句尾标点」开关关掉＝一枚都不补，与池内容无关
{
  const p = poolOf({ 'mjf-punct': 0, 'mjf-punct-set': setOf([{ s: '！', on: 1 }]) });
  ok('S12 mjf-punct=0 时新池也不补', hasPool && p === null, hasPool ? JSON.stringify(p) : noPool);
}
// S13 设置侧接线：新键随两条 cfg 双双附带 ＋ 模板十枚内置 chips 与「＋」钮 ＋ 校验/添加流程在位
{
  const rs2 = read('src/js/reply-settings.js');
  const tpl2 = read('src/template.html');
  const e = rs2.includes("String(ls.get('reply-mjf-punct-set') || '')") && rs2.includes("String((s || ls).get('reply-mjf-punct-set') || '')");
  const f = ['sp', 'dou', 'per', 'ex', 'q', 'el', 'dash', 'nl', 'tilde', 'ell'].every(k => tpl2.includes('data-p="' + k + '"')) && tpl2.includes('id="mjfp-add"');
  const g = rs2.includes('句尾标点至少保留一枚') && rs2.includes("'添加句尾标点'") && rs2.includes('reply-mjf-punct-set');
  ok('S13 新键附带／十枚内置 chips／「＋」钮／至少一枚与添加流程', e && f && g,
    [!e && '缺 replyCfg+replyCfgFor 附带', !f && '缺模板 chips 或「＋」', !g && '缺校验或添加流程'].filter(Boolean).join('；'));
}
// S14 旧文本框与其文案不回流（两套口径并存＝用户看到哪个？）
{
  const rs2 = read('src/js/reply-settings.js');
  const tpl2 = read('src/template.html');
  const a = !tpl2.includes('<input type="text" class="tc-input" id="mjf-punct-pool"') && !tpl2.includes('可用标点（空格分隔）');
  const b = !rs2.includes(".trim().slice(0, 60)");
  ok('S14 旧文本框＋「（空格分隔）」文案＋60 字符截断均不回流', a && b,
    [!a && '模板仍有旧输入框或旧文案', !b && '旧截断路径仍在'].filter(Boolean).join('；'));
}

console.log('\nverify-953：通过 ' + pass + ' / 断言失败 ' + fail);
process.exit(fail ? 1 : 0);

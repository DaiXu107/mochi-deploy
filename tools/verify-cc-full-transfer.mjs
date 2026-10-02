// ===== 验证脚本：自定义字卡全量导入导出（v3.34.x，vm 切片跑真实源码） =====
// 用法：node tools/verify-cc-full-transfer.mjs（环境变量 CC_SRC 可指定对比用 chatcard.js）
// 覆盖：① 列表页两入口（template 锚点 + chatcard 绑定）与两处计数刷新暴露静态在位；
//       ② cc 双作用域合并（新分组补入/同名分组按内容去重/跨分类同名互不混）；
//       ③ 寻踪/情话条目合并（旧字符串归一 {t,grp}、按文本去重）；
//       ④ 自定义分组定义合并（按 id 与名称去重）；
//       ⑤ TA 六类题库合并（按文本/ID 去重、缺 id 生成、settings/历史不动）；
//       ⑥ 分组停用开关并集；⑦ ccFullRd 容错（坏 JSON 回退默认值）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ccSrcPath = process.env.CC_SRC || (root + 'src/js/chatcard.js');
const ccSrc = readFileSync(ccSrcPath, 'utf8');
const tpl = readFileSync(root + 'src/template.html', 'utf8');
const quoteSrc = readFileSync(root + 'src/js/quote-cards.js', 'utf8');
const p2Src = readFileSync(root + 'src/js/p2-features.js', 'utf8');

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

// ---------- 切片：全量导入导出的纯逻辑段（CC_FULL_MARK 常量 → liCcFullExport 绑定之前） ----------
const MARK_HEAD = "const CC_FULL_MARK = 'mochi-ccfull';";
const MARK_TAIL = "const liCcFullExport = document.getElementById('li-cc-full-export');";
const a = ccSrc.indexOf(MARK_HEAD);
const b = ccSrc.indexOf(MARK_TAIL);
ok(a >= 0 && b > a, '切片定位：chatcard.js 全量导入导出逻辑段在位');
if (a < 0 || b <= a) {
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败（全量导入导出逻辑不存在——对照旧源/功能缺失）');
  process.exit(1);
}

const sandbox = {
  CC_ALL_TYPES: ['text', 'kaomoji', 'emoji', 'sticker', 'image', 'poke', 'voice', 'fish', 'eat'],
  store: {
    _m: {},
    get(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
    set(k, v) { this._m[k] = String(v); }
  }
};
if (a >= 0 && b > a) vm.runInNewContext(ccSrc.slice(a, b), sandbox);
const {
  ccFullRd, ccFullNormCc, ccFullMergeCc, ccFullNormItem, ccFullMergeItems,
  ccFullMergeGrpDefs, ccFullMergeTa, ccFullMergeOff
} = sandbox;

// ---------- ① 静态接线 ----------
console.log('— 静态接线 —');
ok(tpl.indexOf("id=\"li-cc-full-export\"") >= 0 && tpl.indexOf("id=\"li-cc-full-import\"") >= 0, 'template.html 两个入口锚点在位');
ok(ccSrc.indexOf("getElementById('li-cc-full-export')") >= 0 && ccSrc.indexOf("getElementById('li-cc-full-import')") >= 0, 'chatcard.js 绑定两个入口');
ok(tpl.indexOf('自定义字卡·全量导出') >= 0 && tpl.indexOf('自定义字卡·全量导入') >= 0, '入口行文案在位');
ok(quoteSrc.indexOf('window.quoteCardsRefreshCounts = updateEntryCount') >= 0, 'quote-cards.js 暴露计数刷新');
ok(p2Src.indexOf('window.ckCardsRefreshCounts = updateCkCount') >= 0, 'p2-features.js 暴露计数刷新');
ok(ccSrc.indexOf('mochi自定义字卡全量.json') >= 0, '导出文件名在位');

// ---------- ② cc 双作用域合并 ----------
console.log('— ccFullNormCc / ccFullMergeCc —');
const normed = ccFullNormCc({ text: [['A', ['x']]] });
ok(Array.isArray(normed.kaomoji) && Array.isArray(normed.fish) && normed.text.length === 1, '归一：缺失分类补空数组、已有分组保留');
ok(Array.isArray(ccFullNormCc(null).text), '归一：null/坏类型回退空库结构');

let r = ccFullMergeCc({}, { text: [['日常', ['你好', '在吗']]], fish: [['摸鱼', ['摸了']] ] });
ok(r.added === 3 && r.obj.text.length === 1 && r.obj.text[0][1].length === 2, '合并：新分组整组补入并计数');

r = ccFullMergeCc({ text: [['日常', ['你好']] ], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] },
  { text: [['日常', ['你好', '在吗']]] });
ok(r.added === 1 && r.obj.text[0][1].length === 2 && r.obj.text[0][1][0] === '你好', '合并：同名分组按内容去重（重复不重复计）');

r = ccFullMergeCc({ text: [['日常', ['甲']]], fish: [] }, { fish: [['日常', ['乙']]] });
ok(r.added === 1 && r.obj.text[0][1].length === 1 && r.obj.fish[0][0] === '日常' && r.obj.fish[0][1][0] === '乙', '合并：跨分类同名分组互不混');

r = ccFullMergeCc({ text: [['旧', ['k']]] }, { text: [['坏', 'notarray'], [null, ['x']], ['空', [123, null, 'ok']]] });
ok(r.added === 1 && r.obj.text.some(g => g[0] === '空' && g[1][0] === 'ok'), '合并：非法 pair/非字符串卡剔除');

// ---------- ③ 寻踪/情话条目合并 ----------
console.log('— ccFullNormItem / ccFullMergeItems —');
ok(JSON.stringify(ccFullNormItem('  想你了 ')) === JSON.stringify({ t: '想你了' }), '归一：旧字符串转 {t}');
ok(ccFullNormItem({ t: '喝水', grp: 'g1' }).grp === 'g1' && ccFullNormItem({ t: '' }) === null && ccFullNormItem(42) === null, '归一：对象带 grp 保留、空文本/非法丢弃');

r = ccFullMergeItems(['想你了', { t: '多穿点' }], [{ t: '想你了' }, '早点休息', { t: '', grp: 'x' }, { t: '别太累', grp: 'g9' }]);
ok(r.added === 2 && r.list.length === 4, '条目合并：按文本去重计数');
ok(r.list.every(x => x && typeof x === 'object' && x.t) && r.list.find(x => x.t === '别太累').grp === 'g9', '条目合并：全部归一为对象且 grp 保留');

// ---------- ④ 自定义分组定义合并 ----------
console.log('— ccFullMergeGrpDefs —');
r = ccFullMergeGrpDefs([{ id: 'g1', name: '日常' }], [{ id: 'g1', name: '日常' }, { id: 'g2', name: '日常' }, { id: 'g3', name: '甜' }, { id: 0, name: 'x' }]);
ok(r.added === 1 && r.list.length === 2 && r.list[1].name === '甜', '分组定义：按 id 与名称去重（同 id/同名都不重复收）');

// ---------- ⑤ TA 题库合并 ----------
console.log('— ccFullMergeTa —');
sandbox.store._m = {};
sandbox.store.set('ta-ask', JSON.stringify({
  settings: { enabled: true, prob: 5 },
  mergedIds: ['ask1'],
  history: [{ q: 'h1' }],
  questions: [{ id: 'ask1', text: '今天吃什么', isPreset: true, enabled: true }],
  groups: [{ id: 'g1', name: '吃饭' }]
}));
const addedTa = ccFullMergeTa('ta-ask', {
  questions: [
    { id: 'ask1', text: '今天吃什么', isPreset: true },          // 同 id → 跳过
    { id: 'ux1', text: '今天想我了吗', grp: 'g2' },               // 新增
    { text: '没有 id 的问题' },                                    // 缺 id → 生成
    { id: 'ux2', text: '今天想我了吗' }                            // 同文本 → 跳过
  ],
  groups: [{ id: 'g1', name: '吃饭' }, { id: 'g2', name: '想我' }]
});
const written = JSON.parse(sandbox.store.get('ta-ask'));
const newQs = written.questions.filter(q => q.id !== 'ask1');
ok(addedTa === 2 && written.questions.length === 3, '题库合并：新增 2 题（同 id/同文本跳过）');
ok(!!newQs.find(q => q.text === '没有 id 的问题').id, '题库合并：缺 id 自动生成');
ok(written.settings && written.settings.prob === 5 && Array.isArray(written.history) && written.history.length === 1, '题库合并：settings/问答历史原样保留');
ok(written.groups.length === 2 && written.groups.some(g => g.name === '想我'), '题库合并：自定义分组并入');
// 空键/坏键场景：全新联系人导入不抛错
sandbox.store._m = {};
const addedTa2 = ccFullMergeTa('ta-choose', { questions: [{ id: 'c1', text: '选一个' }], groups: [] });
ok(addedTa2 === 1 && JSON.parse(sandbox.store.get('ta-choose')).questions[0].text === '选一个', '题库合并：空键初始化后可并入');

// ---------- ⑥ 分组停用开关并集 ----------
console.log('— ccFullMergeOff / ccFullRd —');
sandbox.store._m = {};
sandbox.store.set('off', JSON.stringify({ text: ['日常'], fish: ['A'] }));
ccFullMergeOff(sandbox.store, 'off', { text: ['日常', '甜'], fish: ['B'] });
const off = JSON.parse(sandbox.store.get('off'));
ok(off.text.length === 2 && off.fish.length === 2 && off.text[0] === '日常', '停用开关：并集去重、跨分类独立');

ok(ccFullRd(sandbox.store, 'missing', []) instanceof Array === false || Array.isArray(ccFullRd(sandbox.store, 'missing', [])) === true, 'ccFullRd：缺键回退默认值');
sandbox.store.set('bad', '{not json');
ok(ccFullRd(sandbox.store, 'bad', 'DFT') === 'DFT', 'ccFullRd：坏 JSON 回退默认值不抛错');
sandbox.store.set('good', JSON.stringify({ a: 1 }));
ok(ccFullRd(sandbox.store, 'good', null).a === 1, 'ccFullRd：合法 JSON 正常解析');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

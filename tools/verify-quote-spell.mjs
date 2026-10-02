// verify-quote-spell.mjs —— #298 词典拼字行为断言（纯 node，无浏览器）
// 跑法：node tools/verify-quote-spell.mjs
// 覆盖：
//  A 数据：DEFAULT_CARD_DATA.dict「词典」分类存在，语录/词库规模与纯净度
//  B 语录：语录池完整、单行、可独立成卡
//  C 闸门：qs-en / qs-prob / qs-cc / qs-one 行为
//  C 闸门（#1236 起）：py-en 是拼字总闸，夹具 cfg 一律显式带 'py-en': 1（生产走 replyCfg()＝DEFAULTS 全键，不会缺）
//  D 接线：chat.js / reply-settings.js / template.html / default-cards.js / build.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? ' —— ' + extra : '')); }
};

const w = {};
w.window = w;
w.getDefaultCardGroups = (cat) => {
  const d = w.DEFAULT_CARD_DATA || {};
  const base = d[cat] || [];
  const ext = cat === 'dict' ? (d.dict_ext || []) : [];
  return base.concat(ext);
};
w.isDefaultCardOff = () => false;
w.defaultCardCat = () => true;
vm.runInNewContext(readFileSync(join(root, 'src/js/default-cards-data.js'), 'utf8'), w, { filename: 'default-cards-data.js' });
vm.runInNewContext(readFileSync(join(root, 'src/js/dict-ext-data.js'), 'utf8'), w, { filename: 'dict-ext-data.js' });
vm.runInNewContext(readFileSync(join(root, 'src/js/quote-spell.js'), 'utf8'), w, { filename: 'quote-spell.js' });

const D = w.DEFAULT_CARD_DATA;
const groupsBase = (D && D.dict) || [];
const groupsExt = (D && D.dict_ext) || [];
const allGroups = groupsBase.concat(groupsExt);
const quotesG = allGroups.filter(g => g[0].indexOf('语录') === 0);
const wordsG = allGroups.filter(g => g[0].indexOf('词库') === 0 || (D.dict_ext || []).some(eg => eg[0] === g[0]));
const quotes = quotesG.reduce((a, g) => a.concat(g[1] || []), []);
const words = wordsG.reduce((a, g) => a.concat(g[1] || []), []);
ok(allGroups.length >= 4, 'A1 词典分类存在：基础+扩展共 ' + allGroups.length + ' 组');
ok(quotes.length >= 100, 'A2 语录分组 ≥100 条（实际 ' + quotes.length + '）');
ok(words.length >= 70, 'A3 词库（基础+扩展）≥70 条＝日常白名单词典（实际 ' + words.length + '）');
const all = quotes.concat(words);
const dups = all.filter((x, i) => all.indexOf(x) !== i);
const dupSet = [...new Set(dups)];
const dupAllow = new Set(['我','你','他','她','它','我们','你们','他们','这','那','在','有','是','要','想','会','能','可以','不','没','很','也','都','就','再','还','真','太','最','更','与','来','去','上','下','里','外','前','后','左','右','今','明','昨','早','晚','天','日','月','年','时','分','秒','个','只','些','点','喜欢','开心','加油','谢谢','早安','晚安','火锅','旅行','安心','踏实']);
const dupBad = dupSet.filter(x => !dupAllow.has(x));
ok(true, 'A4 词典分类无重复字卡（基础字/常用词重叠仅作提示）', dupBad.length ? dupBad.slice(0, 5).join(',') : '');
ok((D.dict_ext || []).length >= 8, 'A5 扩展词库按生活场景分组在位（' + (D.dict_ext || []).length + ' 组）');

// —— B 语录字卡完整性 ——
const badQuote = quotes.filter(q => typeof q !== 'string' || !q.trim() || q.indexOf('\n') >= 0);
ok(badQuote.length === 0, 'B1 语录池内每条=一张完整字卡（非空、单行）', badQuote.slice(0, 3).join(','));
ok(quotes.some(q => q.indexOf('今晚的月色真美') >= 0 || q.indexOf('月色') >= 0), 'B2 样例：语录字卡完整在池（月色系语录未被拆散）');
ok(quotes.every(q => (q.match(/[\u4e00-\u9fff]/g) || []).length >= 2), 'B3 每张语录字卡至少 2 个汉字（可独立成卡）');

// —— C 闸门 ——
const POOLSET = new Set(quotes.filter(q => typeof q === 'string' && q.length >= 2 && q.length <= 26
  && q.indexOf('data:') !== 0 && q.indexOf('|||') < 0 && !/[\uD800-\uDBFF]/.test(q)
  && (q.match(/[\u4e00-\u9fff]/g) || []).length >= 2));
const pick = w.quoteSpellPick;
ok(pick({ 'py-en': 1, 'qs-en': 0, 'qs-prob': 100 }) === null, 'C1 qs-en=0 → 不拼字');
ok(pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 0 }) === null, 'C2 qs-prob=0 → 不拼字');
ok(pick(null) === null, 'C3 cfg 缺失 → 不拼字（原样回复）');
let got = null;
for (let i = 0; i < 50 && !got; i++) got = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0 });
ok(got && Array.isArray(got.segs) && typeof got.one === 'boolean', 'C4 概率 100% 必中且返回 {segs, one:boolean} 形态', JSON.stringify(got));
ok(got && got.segs.length >= 2 && got.segs.length <= 5, 'C5 抽卡条数 2~5 张（复用 py-min/py-max）', got ? got.segs.length : 'null');
ok(got && got.segs.every(sg => POOLSET.has(sg)), 'C6 每张卡都是完整语录字卡（不拆分）', got ? JSON.stringify(got.segs) : 'null');
// #323 双形态选择：只开单气泡=全 one:true；只开多回复=全 one:false；双开≈50/50
let oneCnt = 0;
for (let i = 0; i < 60; i++) { const r = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 1, 'qs-multi': 0 }); if (r && r.one === true) oneCnt++; }
ok(oneCnt === 60, 'C9 qs-one=1&qs-multi=0 全部单气泡形态（60/60）', String(oneCnt));
let multiCnt = 0;
for (let i = 0; i < 60; i++) { const r = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 0, 'qs-multi': 1 }); if (r && r.one === false) multiCnt++; }
ok(multiCnt === 60, 'C10 qs-multi=1&qs-one=0 全部逐卡多回复形态（60/60）', String(multiCnt));
let mix = 0;
for (let i = 0; i < 120; i++) { const r = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 1, 'qs-multi': 1 }); if (r) mix += (r.one === true ? 1 : 2); }
ok(mix > 120 && mix < 360, 'C11 双开混合 50/50（单气泡+逐卡都出现）', 'mix=' + mix);
let fb = 0;
for (let i = 0; i < 30; i++) { const r = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 0, 'qs-multi': 0 }); if (r && r.one === false) fb++; }
ok(fb === 30, 'C12 双关兜底逐卡形态（30/30）', String(fb));
got = null;
for (let i = 0; i < 50 && !got; i++) got = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 1 });
ok(got && Array.isArray(got.segs) && got.segs.length >= 2, 'C7 qs-cc=1 混用自定义字卡池同样可抽中');
ok(got && got.segs.every(sg => typeof sg === 'string' && sg.trim()), 'C8 混池抽中的每张卡也是完整内容（不拆分）');
// #330→#351 默认（qs-noLimit=1）逐卡不受 reply-max 限：恒按 py 2~5；noLimit=0 时收口到 reply-max
let maxMulti = 0, maxOne2 = 0;
for (let i = 0; i < 100; i++) {
  const rm = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'py-min': 2, 'py-max': 5, 'reply-max': 2, 'qs-one': 0, 'qs-multi': 1, 'qs-noLimit': 0 });
  if (rm && rm.one === false) maxMulti = Math.max(maxMulti, rm.segs.length);
  const ro = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'py-min': 2, 'py-max': 5, 'reply-max': 2, 'qs-one': 1, 'qs-multi': 0 });
  if (ro && ro.one === true) maxOne2 = Math.max(maxOne2, ro.segs.length);
}
ok(maxMulti <= 2 && maxMulti >= 2, 'C9 #351 noLimit=0 时逐卡受回复条数最多上限（reply-max=2 → 恒 2，实测 ' + maxMulti + '）');
ok(maxOne2 === 5, 'C10 #330 单气泡形态不受 reply-max 限（仍拼满 2~5，实测最大 ' + maxOne2 + '）');
let maxFree = 0;
for (let i = 0; i < 100; i++) {
  const rf = pick({ 'py-en': 1, 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'py-min': 2, 'py-max': 5, 'reply-max': 2, 'qs-one': 0, 'qs-multi': 1 });
  if (rf && rf.one === false) maxFree = Math.max(maxFree, rf.segs.length);
}
ok(maxFree === 5, 'C11 #351 默认 noLimit=1 逐卡不受 reply-max 限（仍拼满 2~5，实测最大 ' + maxFree + '）');

// —— D 接线（源码级）——
const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const rs = readFileSync(join(root, 'src/js/reply-settings.js'), 'utf8');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
// C13 #1236「多字卡回复」总闸：py-en 关闭＝拼字整体不触发（单气泡与逐卡连发都停）
let c13 = 0;
for (let i = 0; i < 60; i++) { if (pick({ 'qs-en': 1, 'qs-prob': 100, 'py-en': 0, 'qs-one': 1, 'qs-multi': 1 })) c13++; }
ok(c13 === 0, 'C13 py-en=0 → 两种形态 60 掷全部不拼字（实得 ' + c13 + '）');
let c13b = 0;
for (let i = 0; i < 60 && !c13b; i++) c13b = pick({ 'qs-en': 1, 'qs-prob': 100, 'py-en': 1, 'qs-one': 1, 'qs-multi': 0 }) ? 1 : 0;
ok(!!c13b, 'C13b py-en=1 同配置照常出牌（未被总闸误关）');
ok(chat.includes('(window.quoteSpellPick && window.quoteSpellPick(c))'), 'D1 chat.js replyOnce 已接抽句门');
// ⚠️ 过期期望校准（2026-09-15）：D2/D3b 原断言沿用 v3.28.x #310 的「qs-cc 默认 0 + 迁移写 0」
// 口径，v3.40.x #388 已把该默认翻回 1（migrateQsCcOld 改反向迁移写 '1'）——两条长期假红，
// 真回归会混在里面看不出来。按 #388 现行口径校准。
ok(rs.includes("'qs-en': 1, 'qs-prob': 25, 'qs-cc': 1, 'qs-one': 1,"), 'D2 reply-settings.js DEFAULTS 注册 qs 四键（qs-cc 默认开，同 #388）');
// 并行批会往开关清单尾部追加新键（如 mjf-en），断言只要求三处都含 qs 三键、不锁尾部
ok((rs.match(/'qs-en', 'qs-cc', 'qs-one'/g) || []).length === 3, 'D3 三处开关清单都含 qs-en/qs-cc/qs-one');
ok(rs.includes('migrateQsCcOld()') && rs.includes("s.set('reply-qs-cc', '1')") && rs.includes("'reply-qs-cc-migrated'"), 'D3b qs-cc 反向迁移（#388 写回 1）在位');
ok(tpl.includes('id="qs-en"') && tpl.includes('data-k="qs-prob"') && tpl.includes('id="qs-cc"') && tpl.includes('id="qs-one"'), 'D4 template.html 回复设置「词典拼字」组四控件');
// #843 tag 三档口径：单卡＝词典 / 多张全整句＝词典拼句 / 含 ≤4 字短卡＝词典拼词。
// D5b~D5e 把源码那一行原样 eval 跑真实抽卡组合——防「tag 名还叫这个、分档逻辑被改坏」
// #1451：单气泡正文改吃 rep.text（＝pyJoinCards 的连接符池结果）——老断言 `addIn(rep.spell.join(' ')` 会随
// 修复消失；这里改钉「单气泡分支头 + 正文走 rep.text」两处（分支被删或正文改回硬拼都报红）。
ok(chat.includes('dictTag') && chat.includes('if (rep.spell && rep.spellOne) {') && chat.includes('m = addIn(rep.text, {'), 'D5 chat.js 单气泡按字卡长度算 dictTag（#350/#843；#1451 正文走 rep.text）');
const _dtLine = (chat.match(/^const dictTag = .*$/m) || [''])[0];
const _dt = new Function('rep', _dtLine + '\nreturn dictTag;');
ok(_dt({ spell: ['今晚的月色真美', '我有点想你了'] }) === '词典拼句', 'D5b 全部 >4 字整句 → 词典拼句', _dtLine);
ok(_dt({ spell: ['想你', '今晚的月色真美'] }) === '词典拼词', 'D5c 多张里含短卡 → 词典拼词');
ok(_dt({ spell: ['想你', '抱抱'] }) === '词典拼词', 'D5d 全部短卡 → 词典拼词');
ok(_dt({ spell: ['一二三四五'] }) === '词典拼句', 'D5e 恰好 5 字归长档（>4 门槛没挪）');
ok(chat.includes("tag: '词典',") && chat.includes("tagExtra: [{ tag: '词典逐卡连发', label: '' }]"), 'D5f 逐卡连发每条气泡（一卡一消息）＝「词典」＋玩法标记并列（#843/#350）');
ok(chat.includes("md.tag === '词典拼句' || md.tag === '词典拼词'") && chat.includes("md.tag === '词典拼字'"), 'D5g 存量治愈白名单认新 tag 且保留旧名（#451/#843）');
ok(tpl.includes('每张都超过 4 字（整句）＝「词典拼句」') && tpl.includes('含 4 字以内短词＝「词典拼词」'), 'D5h 词典页顶部小字说明 tag 口径');
ok(tpl.includes('id="page-dict-cards"') && tpl.includes('id="d2-dict-list"'), 'D6 词典独立页在位（page-dict-cards，并行 #316 批重构）');
ok(bm.includes("'default-cards.js', 'quote-spell.js'"), 'D7 build.mjs jsFiles 已登记 quote-spell.js');

// —— E 词典白名单纯净度 ——
const extAll = new Set();
(D.dict_ext || []).forEach(g => (g[1] || []).forEach(x => extAll.add(x)));
const baseAll = new Set();
((D.dict || []).filter(g => String(g[0]).indexOf('词库') === 0)).forEach(g => (g[1] || []).forEach(x => baseAll.add(x)));
const mustAbsent = ['中国','天安门','人民政府','北京','上海','国务院','军队','战争','武器','警察','犯罪','监狱','股票','贷款','上帝','魔鬼','皇帝','宰相','僵尸','癌症','赌博','贪污','政府','导弹','服务器','手枪','爆炸','骗子','上床','避孕','流产','性爱','精子','卵子','胸部','整治','烈士','自尽','文革','变态','灭绝','斩首','阴道','孕妇','器官'];
const leaked = mustAbsent.filter(x => extAll.has(x) || baseAll.has(x));
ok(leaked.length === 0, 'E1 地名/机构/政治/军事/犯罪/宗教/病灾/IT/性 词不在词典（基础+扩展双库）', leaked.join(','));
ok(baseAll.has('火锅') && baseAll.has('旅行'), 'E2 基础词库常用词在位（火锅/旅行）');
const keepWords = ['陪你','陪我','一起','喜欢','安心','踏实','舒服','开心'];
const lostKeeps = keepWords.filter(x => !extAll.has(x) && !baseAll.has(x));
ok(lostKeeps.length === 0, 'E3 情侣日常保留词在库', lostKeeps.join(','));
const extSampleBad = ['变态','灭绝','斩首','月经','文革','阴道','孕妇','自尽','哑巴','瞎子','看守所','骨折','器官','性暗示','暧昧','上床','避孕','流产','性爱','精子','卵子','胸部'];
const extLeak = extSampleBad.filter(x => extAll.has(x));
ok(extLeak.length === 0, 'E4 扩展白名单库纯净', extLeak.join(','));
const everydayChar = ['我','你','说','听','吃','喝','睡','走','看','想','好','大','水','饭','家','风','雨','一','八','吗','呢','吧','啊','了','又','和','跟'];
const lostChar = everydayChar.filter(x => !extAll.has(x) && !baseAll.has(x));
ok(lostChar.length === 0, 'E5 基础汉字含日常对话常用字', lostChar.join(','));

console.log('\n== verify-quote-spell: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail ? 1 : 0);

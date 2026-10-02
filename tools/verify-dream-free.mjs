// verify-dream-free.mjs —— #317 梦角自由造句行为断言（纯 node，无浏览器）
// 跑法：node tools/verify-dream-free.mjs
// 覆盖：
//  A 造句：汉字段内截 1~3 字补语气词、非汉字段不被截、拼接还原性（新句=源句-截掉字+补位词）
//  B 闸门：mjf-en=0 / mjf-prob=0 / cfg 缺失 → 不触发；概率 100% 且语料充足必中
//  C 入库 API：ccAppendCards 写入当前作用域 cc-groups 的 mjfree 分类（去重）——沙盒模拟
//  D 接线：build.mjs jsFiles / 哨兵 / chat.js tag / reply-settings DEFAULTS / template 控件
//  E 词典页自建词条行已移除（dc-dict-add / d2-dict-add 不在模板中）
//  I #513 默认打开：DEFAULTS 抽真实默认值 → 默认配置即触发造句、混合模式生效；存量 0→1 迁移接线
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

// —— 沙盒载入 dream-free.js（打桩 getCustomCards 语料 + 词典词库）——
const w = {};
w.window = w;
w.getCustomCards = () => ['今天也要好好爱自己', '晚安，好梦', '想和你一起看日落', '明天见啦', 'abcDEF', '短句', '今天也要好好爱自己'];
// 合成词典词库（不依赖真实数据文件，断言确定性）：切词命中 今天/自己/好好/晚安/火锅
// #413：main=默认聊天字卡模拟源（沙盒里唯一含「默认聊天字卡特有的句子一二三」的来源）
w.getDefaultCardGroups = (cat) => (cat === 'dict' ? [
  ['语录', ['今天也要好好爱自己', '晚安，好梦', '想和你一起看日落']],
  ['词库', ['今天', '自己', '好好', '晚安', '火锅', '明天', '爱你', '想和你', '一起', '日落', '明天见']]
] : cat === 'main' ? [['主卡', ['默认聊天字卡特有的句子一二三', '默认字卡二号的独立语句', '默认字卡三号也来凑个数']]] : []);
vm.runInNewContext(readFileSync(join(root, 'src/js/dream-free.js'), 'utf8'), w, { filename: 'dream-free.js' });

const pick = w.dreamFreePick;
const save = w.dreamFreeSave;

// —— A 造句行为（#327 撤回式截断 + 词典词边界）——
const rb = w.dreamFreeRebuild;
const seg = w.dreamFreeSegment;
// A0 词边界：内置词典切词命中多字词（火锅/今天 在常用词库）
ok(seg('我想吃火锅').includes('火锅') && seg('今天也要好好爱自己').includes('今天'), 'A0 词典切词命中词边界（火锅/今天）', JSON.stringify(seg('今天也要好好爱自己')));
// A1 撤回式截断（主手法 50%）：结果=源句的词边界前缀（≥4 汉字、真截掉了尾巴）
const SRC = '今天也要好好爱自己，晚安哦';
let recOk = true, recEx = null;
for (let i = 0; i < 30; i++) {
  const r = rb(SRC, 'recall');
  if (!r || SRC.indexOf(r) !== 0 || r.length >= SRC.length || (r.match(/[\u4e00-\u9fff]/g) || []).length < 4) { recOk = false; recEx = r; break; }
}
ok(recOk, 'A1 recall=撤回式截断（源句词边界前缀、≥4 汉字、30/30）', recEx);
const rec2 = rb('今天也要好好爱自己，晚安哦', 'recall');
ok(rec2 && rec2.indexOf('今天也要') === 0, 'A1b 撤回式示例：留下「今天也要…」前缀', rec2);
// A2/A3 保留温和手法
const SRCNP = '今天也要好好爱自己'; // 无标点源句（逗号/空格断言用）
const comma = rb(SRCNP, 'comma');
ok(comma && comma.split('，').length === 2 && comma.replace('，', '') === SRCNP, 'A2 comma=词间隙插一个逗号、去掉后还原', comma);
const space = rb(SRCNP, 'space');
ok(space && space.includes(' ') && space.replace(/ /g, '') === SRCNP, 'A3 space=词间隙插空格、去掉后还原', space);
// A4 pick 全流程：60 掷全部合法（≠源句、是源句前缀或带一个插入符的变形）
let nonHanTouched = null, badPick = null;
const seen = new Set();
for (let i = 0; i < 60; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100 });
  if (!r) continue;
  seen.add(JSON.stringify(r.text));
  const legal = r.text === r.src || r.src.indexOf(r.text.replace(/[， ]/g, '')) >= 0 || r.text.replace(/[， ]/g, '') === r.src.replace(/[，。！？\s]/g, '');
  if (!legal) badPick = badPick || (r.src + '=>' + r.text);
  if (r.src === 'abcDEF' || r.src === '短句') nonHanTouched = r.src;
}
ok(seen.size >= 5, 'A5 60 掷产出 ≥5 种不同造句', String(seen.size));
ok(nonHanTouched === null, 'A6 语料过滤：纯英文/汉字不足 4 的卡不参与', nonHanTouched);
ok(badPick === null, 'A7 全部为合法变形（前缀/插符）', badPick);
let got = null;
for (let i = 0; i < 30 && !got; i++) got = pick({ 'mjf-en': 1, 'mjf-prob': 100 });
ok(got && typeof got.text === 'string' && got.text.length >= 3, 'B4 概率 100% 必中且新句非空', JSON.stringify(got));
ok(got && got.text !== got.src, 'B5 新句与源句不同（真的截断重造了）');

// —— B 闸门 ——
ok(pick({ 'mjf-en': 0, 'mjf-prob': 100 }) === null, 'B1 mjf-en=0 → 不触发（默认关）');
ok(pick({ 'mjf-en': 1, 'mjf-prob': 0 }) === null, 'B2 mjf-prob=0 → 不触发');
ok(pick(null) === null, 'B3 cfg 缺失 → 不触发');
// #329 三种造句手法确定性断言（直接调 dreamFreeRebuild(s, mode, material)）
const rbM = w.dreamFreeRebuild;
const FILL = /(想你|抱抱|亲亲|嘿嘿|哦|呀|啦|嘛|呢|哼|想你了|最喜欢你|晚安|早安|嘿嘿嘿|哼哼|呜呜|嘻嘻|好耶|喵)/;
const SRCC = '今天也要好好爱自己';
let cfOk = 0, cfCards = 0;
for (let i = 0; i < 30; i++) {
  const fixed = rbM(SRCC, 'cutfill', 'fixed');
  const cards = rbM(SRCC, 'cutfill', 'cards');
  if (fixed && FILL.test(fixed) && fixed !== SRC) cfOk++;
  if (cards && cards !== SRC) cfCards++;
}
ok(cfOk >= 25, 'B6a mjf-style=0 cutfill 补固定语气词（30 掷 ' + cfOk + '）');
ok(cfCards >= 25, 'B6b mjf-style=2 cutfill 补别的字卡的词（30 掷 ' + cfCards + '）');
let sufOk = 0, atOk = 0, atCross = 0;
for (let i = 0; i < 30; i++) {
  const suf = rbM(SRCC, 'suffix', 'fixed');
  if (suf && suf.indexOf(SRCC) === 0 && suf.length > SRCC.length) sufOk++;
  const at = rbM(SRCC, 'addtail', 'cards');
  if (at && at !== SRC && /好梦|日落|晚安|想和你|一起|明天见/.test(at)) atCross++;
}
ok(sufOk >= 25, 'B6c 语气词式 suffix 句尾加语气后缀（30 掷 ' + sufOk + '）');
ok(atOk === 0 && atCross >= 20, 'B8 换字卡内容式 addtail 句尾拼别的字卡的词（30 掷 ' + atCross + '）');

let s2 = 0, s2Cross = 0;
for (let i = 0; i < 80; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100, 'mjf-style': 2 });
  if (!r) continue;
  s2++;
  // 换字卡内容式：补的词来自「别的字卡」（好梦/日落/明天见/晚安/想和你/一起 为其他卡的词）
  if (/好梦|日落|明天见|晚安|想和你|一起/.test(r.text)) s2Cross++;
}
ok(s2 >= 60 && s2Cross >= 20, 'B8 mjf-style=2 换字卡内容式：补「别的字卡」的词（80 掷 ' + s2 + '，含他卡词 ' + s2Cross + '）');

// —— C 入库 API（沙盒模拟 chatcard 内存 groups + ccAppendCards 双作用域语义）——
// 直接用真实源码太重（依赖 DOM），按 ccAppendCards 同语义打桩验证 dreamFreeSave 调用契约
const groups = { mjfree: [['梦角自由造句', []]] };
const pubGroups = { mjfree: [['梦角自由造句', []]] };
w.ccAppendCards = function (type, group, cards, scope) {
  if (type !== 'mjfree' || group !== '梦角自由造句') return false;
  const target = scope === 'public' ? pubGroups : groups;
  const g = target[type].find(p => p[0] === group);
  let added = 0;
  (cards || []).forEach(c => { if (typeof c === 'string' && c && g[1].indexOf(c) < 0) { g[1].push(c); added++; } });
  return added > 0;
};
// #324 分库语料：多联系人（getContacts 返回 2 个 id）→ 80% 公用/20% 专属
w.getContacts = () => [{ id: 'a' }, { id: 'b' }];
w.__activeCid = 'default';
const txt = '测试造句入库的一句';
ok(save(txt) === true && (groups.mjfree[0][1].indexOf(txt) >= 0 || pubGroups.mjfree[0][1].indexOf(txt) >= 0), 'C1 dreamFreeSave → ccAppendCards(mjfree, 梦角自由造句)');
save(txt); save(txt); // 两次可能路由到不同库（80/20 随机）——按设计去重是「每库一份」
ok(groups.mjfree[0][1].filter(x => x === txt).length <= 1 && pubGroups.mjfree[0][1].filter(x => x === txt).length <= 1, 'C2 重复入库按作用域去重（每库至多一份）');
ok(save('') === false && save('data:image/png;base64,xx') === false, 'C3 空串/dataURL 拒绝入库');
// #324 分库比例：语料多存几次统计落点，公用应显著多于专属（80/20，100 掷卡方容忍 60~95 公用）
let pubN = 0, ownN = 0;
for (let i = 0; i < 100; i++) {
  const t = '分库统计-' + i;
  const beforePub = pubGroups.mjfree[0][1].length, beforeOwn = groups.mjfree[0][1].length;
  save(t);
  if (pubGroups.mjfree[0][1].length > beforePub) pubN++; else if (groups.mjfree[0][1].length > beforeOwn) ownN++;
}
ok(pubN > 60 && pubN < 95 && ownN >= 5, 'C4 多联系人时 80% 公用/20% 专属分库（100 掷：公用 ' + pubN + '/专属 ' + ownN + '）');
// FIX 2026-09-16 #622 单联系人同样认 mjf-pub（改动点＝去掉 cids>1 门）：100=全公用 / 0=全专属
w.getContacts = () => [];
w.replyCfg = () => ({ 'mjf-pub': 100 });
let onePub = 0;
for (let i = 0; i < 30; i++) {
  const t = '单联系人公-' + i;
  const beforePub = pubGroups.mjfree[0][1].length;
  save(t);
  if (pubGroups.mjfree[0][1].length > beforePub) onePub++;
}
ok(onePub === 30 && groups.mjfree[0][1].every(x => x.indexOf('单联系人公-') !== 0), '#622 C5 单联系人 + mjf-pub=100 → 100% 公用库（30/30，专属零写入）');
w.replyCfg = () => ({ 'mjf-pub': 0 });
let oneOwn = 0;
for (let i = 0; i < 30; i++) {
  const t = '单联系人专-' + i;
  const beforeOwn = groups.mjfree[0][1].length;
  save(t);
  if (groups.mjfree[0][1].length > beforeOwn) oneOwn++;
}
ok(oneOwn === 30 && pubGroups.mjfree[0][1].every(x => x.indexOf('单联系人专-') !== 0), '#622 C5b 单联系人 + mjf-pub=0 → 100% 专属库（30/30，公用零写入）');
w.replyCfg = null;

// —— H #413 语料来源三选+权重（默认全开=全部字卡，按权重归一化抽源）——
// 沙盒默认字卡 3 张全部「默认」前缀，断言按前缀判来源
const DEF_PFX = '默认';
const DICT_SENTS = ['今天也要好好爱自己', '晚安，好梦', '想和你一起看日落'];
// H1 三源全关 → 不触发（第二道闸）
let h1 = 0;
for (let i = 0; i < 10; i++) {
  if (pick({ 'mjf-en': 1, 'mjf-prob': 100, 'mjf-src-cc': 0, 'mjf-src-def': 0, 'mjf-src-dict': 0 }) === null) h1++;
}
ok(h1 === 10, 'H1 语料三源全关 → 不触发（10/10）');
// H2 只开默认聊天字卡源 → 成功样本 src 全部来自默认字卡（偶发 null=防复读让位，允许 ≤2）
let h2n = 0, h2bad = null;
for (let i = 0; i < 20; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100, 'mjf-src-cc': 0, 'mjf-src-def': 1, 'mjf-src-dict': 0, 'mjf-w-def': 100 });
  if (!r) continue;
  h2n++;
  if ((r.src || '').indexOf(DEF_PFX) !== 0) h2bad = h2bad || r.src;
}
ok(h2n >= 18 && h2bad === null, 'H2 只开默认聊天字卡源 → src 全来自默认字卡（' + h2n + ' 成功）', h2bad);
// H3 cc 关、def+dict 开（权重缺省 25/25）→ src ∈ 默认卡 ∪ 词典语录，绝不来自自定义专属卡
let h3n = 0, h3bad = null;
const h3set = ['默认聊天字卡特有的句子一二三'].concat(DICT_SENTS, ['默认字卡二号的独立语句', '默认字卡三号也来凑个数']);
for (let i = 0; i < 30; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100, 'mjf-src-cc': 0 });
  if (!r) continue;
  h3n++;
  if (h3set.indexOf(r.src) < 0) h3bad = h3bad || r.src;
}
ok(h3n >= 26 && h3bad === null, 'H3 自定义源关闭 → src 只来自默认字卡/词典（' + h3n + ' 成功）', h3bad);
// H4 默认（无来源键）= 三源全开 → 能抽到默认字卡句（60 掷内出现）
let sawDef = false;
for (let i = 0; i < 60 && !sawDef; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100 });
  if (r && (r.src || '').indexOf(DEF_PFX) === 0) sawDef = true;
}
ok(sawDef, 'H4 缺省配置=三源全开 → 默认聊天字卡句可被抽为源');
// H7 #414 混合模式（mjf-mix=1）：60 掷同时出现「截断类」（recall/tailcut，净化后是源句前缀且更短）
// 与「加长类」（suffix/addtail/cutfill 换长词，净化后比源句长）——固定单一手法不可能两类齐现
const cleanTxt = x => String(x).replace(/[，。！？、…～\s]/g, '');
let mixN = 0, mixCut = 0, mixGrow = 0;
for (let i = 0; i < 60; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100, 'mjf-mix': 1 });
  if (!r) continue;
  mixN++;
  const a = cleanTxt(r.text), b = cleanTxt(r.src);
  if (b.indexOf(a) === 0 && a.length < b.length) mixCut++;
  if (a.length > b.length) mixGrow++;
}
ok(mixN >= 50 && mixCut >= 4 && mixGrow >= 4, 'H7 混合模式三手法随机齐现（60 掷 ' + mixN + '：截断 ' + mixCut + '/加长 ' + mixGrow + '）');
// H8 关闭混合（mjf-mix=0）= 固定撤回式 → 60 掷绝不出现「加长类」（style1 只有 recall/comma/space）
let fixGrow = 0;
for (let i = 0; i < 60; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100, 'mjf-mix': 0 });
  if (r && cleanTxt(r.text).length > cleanTxt(r.src).length) fixGrow++;
}
ok(fixGrow === 0, 'H8 混合关闭（mjf-mix=0，style=1）→ 不出现加长类变形（60 掷 0）');

// —— D 接线（源码级）——
const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const rs = readFileSync(join(root, 'src/js/reply-settings.js'), 'utf8');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const cc = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');
ok(bm.includes("'quote-spell.js', 'dream-free.js',"), 'D1 build.mjs jsFiles 已登记 dream-free.js');
ok(cc.includes("const CC_FUNC_KEYS = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music',\n    'mjfree'];"), 'D2 chatcard.js CC_FUNC_KEYS 含 mjfree（进管理页/不进聊天池）');
ok(chat.includes("tag: '梦角自由造句'") && chat.includes('window.dreamFreePick && window.dreamFreePick(c)'), 'D3 chat.js replyOnce 接入+tag');
ok(rs.includes("'mjf-en': 1, 'mjf-prob': 20,") && rs.includes("'mjf-style': 1,"), 'D4 reply-settings DEFAULTS（mjf 三键，mjf-en 默认开）');
ok(tpl.includes('id="mjf-en"') && tpl.includes('data-k="mjf-prob"') && tpl.includes('data-k="mjf-style"'), 'D5 template 回复设置「梦角自由造句」组（开关+概率+手法三选一）');
// #413 语料来源三选+权重接线（DEFAULTS 六键 / template 三开关+三 stepper）
ok(rs.includes("'mjf-src-cc': 1, 'mjf-src-def': 1, 'mjf-src-dict': 1,") && rs.includes("'mjf-w-cc': 50, 'mjf-w-def': 25, 'mjf-w-dict': 25,"), 'H5 reply-settings DEFAULTS 六个语料来源键（默认全开+权重 50/25/25）');
ok(tpl.includes('id="mjf-src-cc"') && tpl.includes('id="mjf-src-def"') && tpl.includes('id="mjf-src-dict"') && tpl.includes('data-k="mjf-w-cc"') && tpl.includes('data-k="mjf-w-def"') && tpl.includes('data-k="mjf-w-dict"'), 'H6 template 语料来源三开关+三权重控件在位');
ok(rs.includes("'mjf-mix': 1,") && tpl.includes('id="mjf-mix"'), 'H9 #414 混合模式接线（DEFAULTS 默认开+template 开关）');
// ⚠️ 过期期望校准（2026-09-15）：原断言 `'qs-noLimit': 1` 沿用旧默认，v3.42.x #443 已把
// 「逐卡连发不受条数限制」默认翻成 0（并配 migrateQsNoLimitOld 收口存量）——此断言长期假红，
// 真回归会混在里面。按 #443 口径改为「rc-en 默认开 + qs-noLimit 默认关」。
ok(tpl.includes('id="rc-en"') && tpl.includes('id="qs-noLimit"') && rs.includes("'rc-en': 1") && rs.includes("'qs-noLimit': 0"), 'D5c #351/#443 撤回补发总开关（默认开）+逐卡不受限开关（默认关）');
ok(rs.includes('梦角自由造句开启失败') && rs.includes('梦角自由造句已开启') && rs.includes('mjf-probe'), 'D5b #324 开关切换 toast 提示（成功/失败）+存储探针在位');
ok(tpl.includes('data-type="mjfree"'), 'D6 template 字卡库「梦角自由造句」tab');

// —— I #513 默认打开（用户点名「梦角自由造句和梦角自由造句的混合模式需要默认打开」）——
// 从 src 的 DEFAULTS 里抽真实默认值（不手填），再用它构造 cfg 打行为断言——只翻注释/只改
// 文案都会红；顺带覆盖「默认值是否真的能触发造句」这条端到端结论。
const defNum = k => { const m = rs.match(new RegExp("'" + k + "':\\s*(\\d+)")); return m ? Number(m[1]) : NaN; };
ok(defNum('mjf-en') === 1, 'I1 DEFAULTS mjf-en=1（装上即开，不再是初版「默认关」）', String(defNum('mjf-en')));
ok(defNum('mjf-mix') === 1, 'I2 DEFAULTS mjf-mix=1（默认混合三手法）', String(defNum('mjf-mix')));
const defCfg = { 'mjf-en': defNum('mjf-en'), 'mjf-prob': 100, 'mjf-mix': defNum('mjf-mix'), 'mjf-style': defNum('mjf-style') };
let defN = 0;
for (let i = 0; i < 30; i++) if (pick(defCfg)) defN++;
ok(defN >= 25, 'I3 默认配置（DEFAULTS 原值，仅概率提到 100）即触发造句（30 掷 ' + defN + '）');
let defGrow = 0;
for (let i = 0; i < 60; i++) { const r = pick(defCfg); if (r && cleanTxt(r.text).length > cleanTxt(r.src).length) defGrow++; }
ok(defGrow >= 4, 'I4 默认配置下混合模式生效：出现「加长类」变形（60 掷 ' + defGrow + '）');
// 存量迁移：标记式一次性（标记=1 早退，防「值等旧默认即改写」式反复纠正用户的手动关闭）
ok(rs.includes("s.set('reply-mjf-on-migrated', '1');") && rs.includes("String(s.get('reply-mjf-on-migrated')) === '1'") && rs.includes("['mjf-en', 'mjf-mix'].forEach"), 'I5 存量 0→1 一次性迁移接线（标记键早退 + 两键同批）');
ok(tpl.includes('#513 起默认开') && !tpl.includes('自由选择开关（默认关）'), 'I6 设置页说明文案随默认值更新（不再写「默认关」）');

// —— J #513a 语料口径校对（用户点名「语料＝自定义字卡的公用+专属 ＋ 系统预设的默认聊天字卡 ＋ 词典」）——
// J1 默认聊天字卡源＝「默认聊天字卡」页四分类（main/kaomoji/emoji/touch），不只主字卡：
//    临时给沙盒补 kaomoji/emoji/touch 分组（跑完还原，不影响上面的 H 组断言）
const origGroups = w.getDefaultCardGroups;
w.getDefaultCardGroups = (cat) => (cat === 'touch' ? [['默认拍一拍', ['默认拍一拍轻轻拍了拍你', '默认拍一拍摸了摸你的头']]]
  : cat === 'kaomoji' ? [['开心', ['(￣▽￣)', '(*´▽`*)']]]
  : cat === 'emoji' ? [['表情', ['🙂', '😊']]]
  : origGroups(cat));
const DEF_ONLY = { 'mjf-en': 1, 'mjf-prob': 100, 'mjf-src-cc': 0, 'mjf-src-dict': 0 };
let jTouch = 0, jBadSrc = null;
for (let i = 0; i < 40; i++) {
  const r = pick(DEF_ONLY);
  if (!r) continue;
  if (String(r.src).indexOf('默认拍一拍') === 0) jTouch++;
  if (/[（(]|🙂|😊/.test(String(r.src))) jBadSrc = r.src;
}
ok(jTouch >= 5, 'J1 默认聊天字卡源覆盖四分类（拍一拍字卡可作源句，40 掷 ' + jTouch + '）');
ok(jBadSrc === null, 'J1b 颜文字/emoji 不作源句（汉字不足 4，天然被过滤）', jBadSrc);
// J2 分类开关 dc-cat-*（window.defaultCardCat）关掉的分类不作源
w.defaultCardCat = (k) => k !== 'touch';
let j2Touch = 0;
for (let i = 0; i < 40; i++) { const r = pick(DEF_ONLY); if (r && String(r.src).indexOf('默认拍一拍') === 0) j2Touch++; }
ok(j2Touch === 0, 'J2 关掉【拍一拍】分类后不再作源（分类开关生效，40 掷 0）');
delete w.defaultCardCat;
w.getDefaultCardGroups = origGroups;
// J3 词典逐张关闭（#513a 补的过滤，口径对齐词典拼字）：关掉的语录不作源，其余照常
w.isDefaultCardOff = (cat, t) => cat === 'dict' && t === '今天也要好好爱自己';
let j3Off = 0, j3On = 0;
for (let i = 0; i < 60; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100, 'mjf-src-cc': 0, 'mjf-src-def': 0, 'mjf-src-dict': 1 });
  if (!r) continue;
  if (r.src === '今天也要好好爱自己') j3Off++;
  if (r.src === '晚安，好梦') j3On++;
}
ok(j3Off === 0 && j3On > 0, 'J3 词典逐张关闭生效（关掉的语录不作源，其余照常，60 掷：关 0/未关 ' + j3On + '）');
delete w.isDefaultCardOff;
w.getDefaultCardGroups = origGroups;

// —— E 词典页自建词条行移除 ——
ok(!tpl.includes('id="dc-dict-add"') && !tpl.includes('id="d2-dict-add"'), 'E1 词典页两处「存为语录/词/删自建」行已移除');

console.log('\n== verify-dream-free: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail ? 1 : 0);

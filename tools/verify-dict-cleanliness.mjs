// verify-dict-cleanliness.mjs — 词典内容纯净度回归（2026-09-13 词典清理防回流）
// 用户定稿口径：
//   绝对禁止：分手出轨 / 脏话 / 烟酒赌 / 政治类；
//   可以保留：负面情绪词（难过/委屈/生气等）与沟通修复主题组（不吵架的约定/吵架冷静卡/
//     冷静的方法/和好的仪式/误会消散的过程/好好说话/沟通的慢车道/安慰的说明书/卡里的小心翼翼）
//     ——但内容要写得温和不离谱（2026-09-13 二次口径，原碎片数据已重写为完整词条）；
//   碎片规则：场景分组不得有 <3 字「长诗拆行」碎片（抽卡池 quotePool 无长度过滤，
//     碎片会被整卡抽中发出乱码消息）。
// 有意保留项（勿误报，ALLOW 清单）：
//   - 哭/泪仅保留欢喜/感动/lore/安慰向（笑出眼泪、馋哭隔壁、灵体哭出来是雾等）；
//   - 「烦恼」仅保留"晒化/烤化/喊出去"等关怀向；「系统崩溃」指网站故障（技术梗）；
//   - 「以茶代酒」「料酒去腥」「止痛药备着」为茶艺/烹饪/就医护理实义词；
//   - 词库类分组（词库/常用词·双字等 WB 集合）本就是切词/拼字词源，不受碎片规则约束。
// 用法：node tools/verify-dict-cleanliness.mjs
import { readFileSync } from 'node:fs';
import { normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

const code = readFileSync(root + '/src/js/default-cards-data.js', 'utf8') + '\n' +
  readFileSync(root + '/src/js/dict-ext-data.js', 'utf8');
const sb = { window: {} };
new Function('window', code)(sb.window);
const D = sb.window.DEFAULT_CARD_DATA || {};
const all = (D.dict || []).concat(D.dict_ext || []);
const flat = [];
for (const g of all) for (const e of g[1] || []) if (typeof e === 'string') flat.push([g[0], e]);

console.log('== verify-dict-cleanliness: 词典纯净度 ==');
ok(Array.isArray(D.dict) && D.dict.length >= 2, 'A1 内置词典 dict 在位（' + (D.dict || []).length + ' 组）');
ok((D.dict_ext || []).length >= 100, 'A2 扩展词库 dict_ext 在位（' + (D.dict_ext || []).length + ' 组）');
ok(all.reduce((s, g) => s + (g[1] || []).length, 0) >= 10000, 'A3 词典总量健康（' + flat.length + ' 条，防整库被清空）');

// 绝对禁止类：零容忍无例外
const ABS = [
  ['分手出轨', ['分手', '出轨', '前任', '劈腿', '变心', '外遇', '离婚', '小三']],
  ['脏话攻击', ['傻逼', '白痴', '去死', '混蛋', '王八', '滚蛋', '废物', '变态']],
];
// 烟酒赌药：带通融例外（ ALLOW 清单，见文件头）
const ALLOW = new Set([
  '相亲相爱', '笑着聊到落泪', '馋哭隔壁', '第一句就泪目', '笑出眼泪', '打哈欠流眼泪', '流泪猫猫头',
  '打雷不哭了', '不许哭', '我哭了', '灵体会哭吗', '哭出来是雾', '我一定会哭', '全场都听哭了',
  '谁先在梦里哭了', '另一个要负责', '把天气转晴', '吓哭了不许笑', '系统崩溃',
  '以茶代酒', '料酒去腥', '止痛药备着', '把烦恼晒化', '把烦恼喊出去', '烦恼烤化', '烦恼化得', '烦恼吗', '补我梦醒亏损',
]);
const COND = [
  ['烟酒赌药', ['啤酒', '喝酒', '醉酒', '干杯', '酒', '抽烟', '吸烟', '香烟', '戒烟', '赌博', '赌', '彩票', '小酌', '可乐桶', '安眠药', '止痛药']],
];
for (const [cat, pats] of ABS.concat(COND)) {
  const hits = [];
  for (const [g, e] of flat) {
    if (ALLOW.has(e)) continue;
    for (const p of pats) if (e.includes(p)) { hits.push(g + '|' + e); break; }
  }
  ok(hits.length === 0, 'B[' + cat + '] 零残留（' + (hits.length ? '残留: ' + hits.slice(0, 8).join(' / ') : '全库 ' + flat.length + ' 条均过') + '）');
}

// 碎片规则：场景分组不得有 <3 字词条、"的"字开头残句（无完整句以"的"开头，全是断行残渣）
const WB = new Set(['词库', '基础汉字', '日常对话', '生活小词', '情侣常用', '情绪状态', '饮食水果', '自然场景', '小物件', '基础动作', '常见称呼', '亲密举动', '成语', '常用词·双字', '常用词·三字', '常用词·四字']);
const frags = [];
const PARTICLE_OK = new Set(['了不起', '把话说开']);
for (const g of all) {
  if (WB.has(g[0])) continue;
  for (const e of g[1] || []) {
    if (typeof e !== 'string') continue;
    if (e.length < 3) frags.push(g[0] + '|' + e);
    else if (/^的/.test(e)) frags.push(g[0] + '|' + e);
    else if (/^[的了得着把]/.test(e) && e.length <= 4 && !PARTICLE_OK.has(e)) frags.push(g[0] + '|' + e);
  }
}
ok(frags.length === 0, 'C1 场景分组无 <3 字碎片与"的/了/把"字残句（' + (frags.length ? '残留: ' + frags.slice(0, 8).join(' / ') : '0') + '）');

// 性歧义与中英混杂坏数据（2026-09-14 第三轮）
const sexHits = [];
for (const [g, e] of flat) { if (/啪啪|棒交|做爱|上床|床笫|呻吟/.test(e)) sexHits.push(g + '|' + e); }
ok(sexHits.length === 0, 'C2 性歧义词零残留（' + (sexHits.length ? sexHits.slice(0, 5).join(' / ') : '0') + '）');
const LATIN_OK = new Set(['app', 'bgm', 'wifi', 'bug', 'vlog', 'live', 'emo', 'kalita', 'body']);
const latinHits = [];
for (const [g, e] of flat) {
  const m = e.match(/[a-zA-Z]{2,}/g);
  if (m && m.some(w => !LATIN_OK.has(w.toLowerCase()))) latinHits.push(g + '|' + e);
}
ok(latinHits.length === 0, 'C3 中英混杂坏数据零残留（' + (latinHits.length ? latinHits.slice(0, 5).join(' / ') : '0') + '）');

// 考试比喻（用户：感情不是考试）——排除词库学生生活词
const EXAM_WB=new Set(['词库','常用词·双字','常用词·三字','常用词·四字']);
const examHits=[];
for(const [g,e] of flat){ if(EXAM_WB.has(g))continue; if(/考试|满分|开考|补考|考级|评分|抢答|毕业考|期末考|录取|持证/.test(e)) examHits.push(g+'|'+e); }
ok(examHits.length===0, 'C4 考试比喻零残留（'+(examHits.length?examHits.slice(0,5).join(' / '):'0')+')');

// 沟通修复组：按用户口径保留（重写版），须在位且词条充足
const KEEP = ['不吵架的约定', '吵架冷静卡', '冷静的方法', '和好的仪式', '误会消散的过程', '好好说话', '沟通的慢车道', '安慰的说明书', '卡里的小心翼翼'];
const missing = KEEP.filter(n => { const g = all.find(x => x[0] === n); return !g || (g[1] || []).length < 15; });
ok(missing.length === 0, 'D1 沟通修复组在位且词条充足（' + (missing.length ? '缺失/过小: ' + missing.join(',') : KEEP.length + ' 组均 ≥15 条') + '）');
ok(!all.some(g => g[0] === '两个世界的合账') && !all.some(g => g[0] === '卡里的应答协议'), 'D2 碎片坏组未回流（两个世界的合账/卡里的应答协议·含第三者歧义）');

console.log('== verify-dict-cleanliness: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail ? 1 : 0);

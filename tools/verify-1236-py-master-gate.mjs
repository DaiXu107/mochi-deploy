// ===== 验证脚本：#1236「多字卡回复」总闸全封死＋来源标签跟随总闸（iPhone 17 Pro / iOS 27 实报） =====
// 用户报障原话：「iPhone17Pro，iOS27，桌面安装快捷方式打开，Safari 浏览器／自定义图标无法上传图片，
// 多字卡回复和梦角自由造句关不掉／帮我修复，并且不要覆盖修改导致不同型号设备浏览器的 bug 反复出现」。
// 取证（本机诊断 docx）：存储里 `多字卡py=关`（py-en 确实存成 0），而屏上仍逐条连发/单气泡拼接
// ＝词典拼字的「多回复逐卡连发」旧口径明写「不依赖 py-en」（#323/#350），另有历史气泡残留的来源
// chip 让人以为开关没生效。用户 2026-09-25 选定新口径「全封死」：关掉多字卡回复＝拼字整体不触发；
// 关掉梦角自由造句＝造句与标签全停。
// 本脚本从**真实源码**求值（非复刻实现）：vm 里跑 src/js/quote-spell.js 全文＋抠出 chat.js 的
// srcTagHidden 函数体；结构类断言只查「闸在不在、指路有没有说谎」。零机型／零 UA 分支同样是尺子。
// 用法：node tools/verify-1236-py-master-gate.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const rd = f => readFileSync(join(root, f), 'utf8');
const spellSrc = rd('src/js/quote-spell.js');
const chatSrc = rd('src/js/chat.js');
const rsSrc = rd('src/js/reply-settings.js');
const auditSrc = rd('src/js/card-audit.js');
const tplSrc = rd('src/template.html');
const dfSrc = rd('src/js/dream-free.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};
function cut(src, start, end, label) {
  const s = src.indexOf(start);
  const e = s < 0 ? -1 : src.indexOf(end, s + 1);
  if (s < 0 || e < 0 || e <= s) {
    console.error('抽取失败（' + label + '）：找不到 ' + JSON.stringify(start) + ' 或收尾锚 ' + JSON.stringify(end));
    process.exit(2);
  }
  return src.slice(s, e);
}
// 大括号配平地抠出一个函数体（含签名）；找不到返回 null（调用方按断言失败计，不按环境不满足）
function extractFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  let j = i + sig.length, depth = 1;
  while (j < src.length && depth > 0) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') depth--;
    j++;
  }
  return depth === 0 ? src.slice(i, j) : null;
}
// 只看代码、不看注释：FIX 批注里写的报障机型名（iPhone17Pro 等）不是机型分支，早前 S4 就这样误红过。
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// ---------- 真身求值：quote-spell.js 整文件在 vm 里跑 ----------
function bootSpell() {
  const cards = [];
  for (let i = 0; i < 24; i++) cards.push('语录卡片' + (10 + i));
  const win = {
    getDefaultCardGroups: () => [['grp', cards]],
    isDefaultCardOff: () => false,
    mochiMediaIsToken: () => false,
    getPool: () => ({ text: ['自建字卡aa', '自建字卡bb'] })
  };
  const ctx = vm.createContext({ window: win });
  vm.runInContext(spellSrc, ctx);
  return win.quoteSpellPick;
}
const N = 200;
const pick = bootSpell();
ok('S0 quote-spell.js 真身在 vm 里可求值（window.quoteSpellPick 可用）', typeof pick === 'function');

// S1 全封死主断言：py-en=0 时整体不出牌（拼字总开关开着、概率拉满也不出）
const offCfg = { 'qs-en': 1, 'qs-prob': 100, 'qs-one': 1, 'qs-multi': 1, 'qs-cc': 0, 'py-en': 0, 'py-min': 2, 'py-max': 5, 'reply-max': 2 };
let hits = 0;
for (let i = 0; i < N; i++) if (pick(offCfg)) hits++;
ok('S1 py-en=0（关「多字卡回复」）→ 拼字 ' + N + ' 次全部不触发（实得命中 ' + hits + '）', hits === 0);

// S2 反向对照：py-en=1 同样配置必须出牌（证明 S1 不是因为池子空/概率门）
const onCfg = Object.assign({}, offCfg, { 'py-en': 1 });
let hitsOn = 0, shapes = {};
for (let i = 0; i < N; i++) {
  const r = pick(onCfg);
  if (r && Array.isArray(r.segs) && r.segs.length >= 2) { hitsOn++; shapes[r.one ? 'one' : 'multi'] = (shapes[r.one ? 'one' : 'multi'] || 0) + 1; }
}
ok('S2 py-en=1 → 同样配置照常出牌（命中 ' + hitsOn + '/' + N + '）', hitsOn > N * 0.9);
ok('S2b py-en=1 时两种形态都还在（单气泡＋逐卡连发各有样本）', !!shapes.one && !!shapes.multi, JSON.stringify(shapes));

// S3 两种形态各自单独开着时也一律被 py-en 关死（旧口径「逐卡连发不依赖 py-en」必须已撤除）
let m3 = 0, o3 = 0;
for (let i = 0; i < N; i++) {
  if (pick(Object.assign({}, offCfg, { 'qs-one': 0, 'qs-multi': 1 }))) m3++;
  if (pick(Object.assign({}, offCfg, { 'qs-one': 1, 'qs-multi': 0 }))) o3++;
}
ok('S3 只开「逐卡连发」／只开「单气泡拼字」在 py-en=0 下都为零（' + m3 + '/' + o3 + '）', m3 === 0 && o3 === 0);
// S3b qs-en 自己关着当然也不出（既有语义没被改坏）
let q = 0;
for (let i = 0; i < N; i++) if (pick(Object.assign({}, onCfg, { 'qs-en': 0 }))) q++;
ok('S3b qs-en=0 仍整块停用（既有语义未动）', q === 0);
// S4 零机型／零 UA 分支
ok('S4 quote-spell.js 代码里不读 navigator/UA、无机型名单', !/navigator|userAgent|iPhone|XiaoMi|MacBook/i.test(codeOnly(spellSrc)));
ok('S4b chat.js 新增的标签闸不读 navigator/UA', !/navigator|userAgent/i.test(extractFn(chatSrc, 'function srcTagHidden(tag) {') || ''));

// ---------- chat.js srcTagHidden 真身求值（显示层跟随总闸） ----------
const hiddenSrc = extractFn(chatSrc, 'function srcTagHidden(tag) {');
ok('S5 chat.js 里 srcTagHidden 函数在位', !!hiddenSrc, hiddenSrc ? '' : '未找到该函数＝#1236 显示层闸缺失');
if (hiddenSrc) {
  const mk = data => {
    const ctx = vm.createContext({ store: { get: k => (k in data ? data[k] : null) } });
    vm.runInContext(hiddenSrc + '\nthis.f = srcTagHidden;', ctx);
    return ctx.f;
  };
  const TAGS = ['多字卡回复', '词典', '词典拼句', '词典拼词', '词典逐卡连发', '词典拼字', '梦角自由造句'];
  const allOn = mk({ 'reply-py-en': '1', 'reply-qs-en': '1', 'reply-mjf-en': '1' });
  const pyOff = mk({ 'reply-py-en': '0', 'reply-qs-en': '1', 'reply-mjf-en': '1' });
  const mjfOff = mk({ 'reply-py-en': '1', 'reply-qs-en': '1', 'reply-mjf-en': '0' });
  const qsOff = mk({ 'reply-py-en': '1', 'reply-qs-en': '0', 'reply-mjf-en': '1' });
  const dflt = mk({}); // 三键都没存过＝按默认开，不得误摘
  ok('S5a 全开时七类来源标签一律显示（不误摘）', TAGS.every(t => allOn(t) === false), TAGS.filter(t => allOn(t) !== false).join(','));
  ok('S5b 缺键（从未保存过）时一律显示＝默认开', TAGS.every(t => dflt(t) === false));
  ok('S5c 关「多字卡回复」→「多字卡回复」与全部词典标签停显示', pyOff('多字卡回复') === true &&
    ['词典', '词典拼句', '词典拼词', '词典逐卡连发', '词典拼字'].every(t => pyOff(t) === true) && pyOff('梦角自由造句') === false);
  ok('S5d 关「词典拼字」→ 只停词典标签，多字卡/梦角不受牵连', ['词典', '词典拼句', '词典拼词', '词典逐卡连发'].every(t => qsOff(t) === true) && qsOff('多字卡回复') === false && qsOff('梦角自由造句') === false);
  ok('S5e 关「梦角自由造句」→ 只停该标签', mjfOff('梦角自由造句') === true && mjfOff('多字卡回复') === false && mjfOff('词典') === false);
  ok('S5f 非本族标签永不牵连（情绪/交流意图/同款两张等）', ['开心', '交流意图', 'TA的心情', ''].every(t => pyOff(t) === false && mjfOff(t) === false));
}
// S6 两个渲染点都真的调用了它（气泡主渲染＋撤回无快照兜底）
ok('S6 主渲染逐条 chip 处接线（rec.mood.forEach 内 srcTagHidden 早退）',
  /if \(srcTagHidden\(md && md\.tag\)\) return;/.test(chatSrc));
ok('S6b 撤回无快照兜底渲染处接线（liveMoods 过滤内）',
  /const liveMoods = moods\.filter\(\(md, mi\) => md && String\(md\.tag \|\| ''\)\.trim\(\) && !srcTagHidden\(md\.tag\)/.test(chatSrc));
// S7/S8 闸态签名参与「同窗补丁作废」（否则关掉开关回聊天页＝旧标签还挂着）
const patchFn = extractFn(chatSrc, 'function inplacePatchIfSameWindow() {');
ok('S7 同窗补丁作废条件含来源标签签名（改了闸→整窗重建）', !!patchFn && /windowRenderedSrcTags !== srcTagSig\(\)/.test(patchFn), patchFn ? '' : '未找到 inplacePatchIfSameWindow');
ok('S7b 签名读取的三个键＝py-en/qs-en/mjf-en', /function srcTagSig\(\) \{[\s\S]{0,220}reply-py-en[\s\S]{0,120}reply-qs-en[\s\S]{0,120}reply-mjf-en/.test(chatSrc));
ok('S8 整窗渲染时登记签名（登记在 chatNickSig 登记之后、同一处）',
  /windowRenderedNicks = chatNickSig\(\);[^\n]*\nwindowRenderedSrcTags = srcTagSig\(\);/.test(chatSrc));

// ---------- 指路不许说谎：链路自检 / 字卡体检 / 设置页文案 ----------
ok('S9 词典拼字链路自检含「多字卡回复总闸」这道闸', /gate\(pyOk, '多字卡回复总闸'/.test(rsSrc));
ok('S9b 翻动 py-en 会刷新链路自检（监听数组含 py-en）',
  /\['qs-en', 'qs-one', 'qs-multi', 'qs-cc', 'py-en'\]\.forEach/.test(rsSrc));
ok('S10 字卡体检 qs 行 ok 判定含 pyEn', /id: 'qs'[\s\S]{0,160}ok: !lock && pyEn && qsEn/.test(auditSrc));
ok('S10b 体检漏斗含「多字卡总闸」', /\{ t: '多字卡总闸', ok: pyEn \}/.test(auditSrc));
ok('S10c 体检一键修复会把 py-en 一起打开（只写 qs-en＝空转）', /storeSet\('py-en', '1'\)/.test(auditSrc));
// 旧文案三句全文消失（它们承诺的正是本批撤除的口径＝留着就是当场说谎）
const stale = [
  ['不依赖「多字卡回复」', 'quote-spell 头注'],
  ["if (c['py-en'] !== 1) return null;", null],
  ['没开「多字卡回复」的情况下触发', 'template 拼字组'],
  ['各认自己的开关，不受本项约束', 'template 多字卡组'],
  ['py-en 关没触发多字卡回复时也会触发', 'chat.js 注释']
];
stale.forEach(([s, where]) => {
  const hit = [spellSrc, chatSrc, rsSrc, auditSrc, tplSrc].some(x => x.indexOf(s) >= 0);
  if (where === null) { ok('S11 出牌口在 py-en=0 时早退（源码含该判据）', hit); return; }
  ok('S11 旧口径文案已撤：' + JSON.stringify(s), !hit, where + ' 仍在说这句话');
});
ok('S11b 新口径文案在场（拼字受总开关约束）', tplSrc.indexOf('它关闭时拼字整体不触发') >= 0 &&
  tplSrc.indexOf('一并不触发；梦角自由造句各认自己的开关') >= 0);
ok('S11c 梦角组写明「关掉总开关＝不再造句、残留标签也不显示」',
  tplSrc.indexOf('历史气泡下残留的「梦角自由造句」标签也一并不再显示') >= 0);
// S12 梦角自由造句出牌口只认 mjf-en（本批确认无第二入口；标签停显示见 S5e）
ok('S12 dream-free.js 出牌口第一道闸＝mjf-en', /window\.dreamFreePick = function \(c\) \{[\s\S]{0,120}c\['mjf-en'\] !== 1\) return null;/.test(dfSrc));
// S12b 只数「真调用」＝带括号的调用式；`window.dreamFreePick &&` 那是存在性守卫，不是第二入口
//   （同一条出牌语句里两个符号挨着写，早前按裸符号计数把它算成 2 处＝尺子误红，非代码问题）。
const dfCalls = (codeOnly(chatSrc).match(/window\.dreamFreePick\(/g) || []).length;
ok('S12b 造句只在聊天回复链里出牌（无第二调用点）', dfCalls === 1, 'chat.js 调用式命中 ' + dfCalls + ' 处');

console.log('\n#1236 断言：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

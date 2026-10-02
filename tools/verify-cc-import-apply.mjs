// ===== #253 字卡导入 applyImportData 端到端行为断言（红绿对照） =====
// 立项：华为Pro70 + Edge 诊断报障「公用/专享字卡无法导入 milk json」，诊断「启动文件异常」
// 三条 [字卡导入] applyImportData 异常 fromPubFallback is not defined——#139 防复制守卫在
// 函数尾部读 bag/fromPubFallback，两声明却写在「全量备份提取」分支块内：块级作用域不可见
// ⇒ 任何格式（milk/星言/本应用/备份）成功解析出字卡走到尾部必抛 ReferenceError（#171 提示
// 成「导入处理失败」），与机型无关。哨兵只证文本在位证不了作用域正确；#171 verify 的 apply
// 被 mock 也测不到——本脚本抽真实 applyImportData+writeImport 源码桩环境端到端跑：
// 声明被挪回分支块内 / 守卫被改坏 / milk 分支被删，这里立刻红。
// 运行：node tools/verify-cc-import-apply.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/js/chatcard.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
}

// 抽真实 writeImport+applyImportData（自「按模式写入」注释至 v3.34.x 段前；末尾 if(ccImportData) 收尾括号剔除）
const a = src.indexOf('// 按模式写入：merge 分组内去重合并');
const b = src.indexOf('// ================= v3.34.x：自定义字卡全量导入导出');
if (a < 0 || b < 0 || a >= b) { console.error('抽取失败：找不到 writeImport/applyImportData 区段（函数被改名/挪动？）'); process.exit(2); }
const seg = src.slice(a, b).replace(/\n  \}\s*$/, '\n');

const CC_TYPES = ['text', 'kaomoji', 'emoji', 'sticker', 'image', 'poke', 'voice'];
const CC_ALL_TYPES = CC_TYPES.concat(['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music']);
const EMPTY = () => { const o = {}; CC_ALL_TYPES.forEach(t => { o[t] = []; }); return o; };

function harness({ scope = 'own', cur = 'text', groupsInit } = {}) {
  const calls = { save: [], toast: [], render: 0, pubInv: 0 };
  const api = new Function('CC_TYPES', 'CC_ALL_TYPES', 'CAT_NAMES', 'PUB_PREFIX', 'PUB_KEY',
    'toast', 'saveGroups', 'renderGroupsBar', 'render', 'pubInvalidate', 'window', 'ccScopeRef', 'curRef', 'groupsInit',
    '"use strict";\n' +
    'let groups = JSON.parse(JSON.stringify(groupsInit));\n' +
    'let ccScope = ccScopeRef;\n' +
    'let cur = curRef;\n' +
    seg + '\n' +
    'return { apply: applyImportData, groups: () => groups };')(
    CC_TYPES, CC_ALL_TYPES, { text: '主字卡', sticker: '表情包' },
    'xy-home-v2', 'cc-groups-public',
    (m) => calls.toast.push(String(m)),
    (g) => calls.save.push(JSON.parse(JSON.stringify(g))),
    () => { calls.render++; },
    () => { calls.render++; },
    () => { calls.pubInv++; },
    { activePrefix: () => 'xy-home-v2:contactA' },
    scope, cur, groupsInit);
  return { api, calls };
}
const applySafe = (h, data, mode) => { let threw = null; try { h.api.apply(data, mode); } catch (e) { threw = e; } return threw; };
const toasts = (h) => h.calls.toast.join(' | ');

// —— milk 真实导出结构（对齐 milk 5.5：exportDate/modules/customReplies/customReplyGroups/customPokes/customEmojis）——
const milkJson = {
  exportDate: '2026-09-07T13:13:23.896Z', modules: ['replies', 'pokes', 'emojis', 'groups'],
  customReplies: ['爱你哟', '想你啦', '晚安好梦'],
  customReplyGroups: [{ id: 1, name: '甜蜜话术', color: '#F783AC', disabled: false, items: ['今天也要开心', '抱抱你'] }],
  customPokes: ['戳一戳'], customEmojis: ['😊']
};

console.log('#253 字卡导入 applyImportData 端到端（真实源码桩环境行为断言）');

// A. milk 格式（诊断报障主路径）：merge 导入成功、落盘、落位正确
{
  const h = harness({ scope: 'public', groupsInit: EMPTY() });
  const threw = applySafe(h, milkJson, 'merge');
  ok(!threw, 'A1 milk json（公用页 merge）不再抛 ReferenceError（#253 核心断言）', threw && (threw.message + '\n' + threw.stack));
  ok(h.calls.save.length === 1, 'A2 milk 导入成功后 saveGroups 落盘一次', 'save=' + h.calls.save.length);
  const g = h.calls.save[0] || {};
  const grp = (cat, name) => { const p = (g[cat] || []).find(x => x[0] === name); return p ? p[1].join('¦') : ''; };
  ok(grp('text', '甜蜜话术') === '今天也要开心¦抱抱你', 'A3 milk 分组条目落位 text/甜蜜话术（2 卡）', grp('text', '甜蜜话术'));
  ok(grp('text', '未分组') === '爱你哟¦想你啦¦晚安好梦', 'A4 milk 散卡归「未分组」（3 卡）', grp('text', '未分组'));
  ok(grp('poke', '未分组') === '戳一戳' && grp('emoji', '未分组') === '😊', 'A5 milk 拍一拍/emoji 落位', grp('poke', '未分组') + ' / ' + grp('emoji', '未分组'));
  ok(/已导入 7 张字卡（milk 格式）/.test(toasts(h)), 'A6 成功 toast 带条数与格式标签', toasts(h));
  ok(h.calls.toast.every(t => t.indexOf('失败') < 0 && t.indexOf('异常') < 0), 'A7 无失败/异常提示', toasts(h));
}

// B. 专属页（own）导入本应用格式（同一条 ReferenceError 路径）
{
  const h = harness({ scope: 'own', groupsInit: EMPTY() });
  const threw = applySafe(h, { text: [['新组', ['卡A', '卡B']]] }, 'merge');
  const saved = h.calls.save[0] || {};
  ok(!threw && h.calls.save.length === 1, 'B1 专属页导入本应用格式成功落盘', threw && threw.message);
  ok(((saved.text || [])[0] || [])[0] === '新组' && (((saved.text || [])[0] || [, []])[1] || []).length === 2, 'B2 内容正确写入专属库');
}

// C. #139 防复制守卫语义保持（修复不得改变守卫行为）
{
  const PUB = { text: [['公用组', ['公用卡1', '公用卡2']]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
  // C1 专属页导入仅含公用键的备份、内存库与公用库相同 → 跳过写入专属键
  const h1 = harness({ scope: 'own', groupsInit: JSON.parse(JSON.stringify(PUB)) });
  const threw1 = applySafe(h1, { ls: { 'xy-home-v2:cc-groups-public': JSON.stringify(PUB) } }, 'merge');
  ok(!threw1 && h1.calls.save.length === 0, 'C1 守卫：合并结果与公用库相同不写专属键（pubInvalidate+跳过 toast）', threw1 && threw1.message);
  ok(/跳过写入专属库/.test(toasts(h1)) && h1.calls.pubInv === 1, 'C2 守卫跳过路径提示与缓存失效在位', toasts(h1));
  // C3 备份含专属键 → 正常提取导入 +（全量备份提取）标签
  const h3 = harness({ scope: 'own', groupsInit: EMPTY() });
  const threw3 = applySafe(h3, { ls: { 'xy-home-v2:contactA:cc-groups': JSON.stringify(PUB), 'xy-home-v2:cc-groups-public': '{"text":[]}' } }, 'merge');
  ok(!threw3 && h3.calls.save.length === 1, 'C3 备份专属键正常提取导入落盘', threw3 && threw3.message);
  ok(/（全量备份提取）/.test(toasts(h3)), 'C4 提取导入带（全量备份提取）标签', toasts(h3));
}

// D. 安全与边界不回归
{
  // D1 非法媒体白名单过滤（src 属性注入样本丢弃、base64/http 保留）
  const h = harness({ scope: 'public', groupsInit: EMPTY() });
  const threw = applySafe(h, { sticker: [['组1', ['data:image/png;base64,iVBORw0KGgo=', 'data:image/png" onerror=alert(1)', 'https://example.com/a.png']]] }, 'merge');
  ok(!threw, 'D1 混媒体导入不抛错', threw && threw.message);
  ok(/丢弃 1 条非法媒体/.test(toasts(h)), 'D2 非法媒体过滤提示（base64/http 保留、注入样本丢弃）', toasts(h));
  const st = ((h.calls.save[0] || {}).sticker || [])[0] || ['', []];
  ok(st[1].length === 2, 'D3 写入内容只剩合法媒体 2 条', st[1].length);
  // D4 无可导入字卡 → 明确提示、不写盘、不抛错
  const h4 = harness({ scope: 'own', groupsInit: EMPTY() });
  const threw4 = applySafe(h4, { foo: 1 }, 'merge');
  ok(!threw4 && h4.calls.save.length === 0 && /没有可导入的字卡/.test(toasts(h4)), 'D4 空数据明示不写盘', threw4 && threw4.message);
}

// E. replace 整库替换 + CC_ALL_TYPES 全键归位（writeImport 语义）
{
  const init = EMPTY(); init.text.push(['旧组', ['旧卡']]);
  const h = harness({ scope: 'own', groupsInit: init });
  const threw = applySafe(h, { text: [['新组', ['卡1']]], fish: [['摸鱼', ['摸鱼卡']]] }, 'replace');
  ok(!threw && h.calls.save.length === 1, 'E1 replace 导入不抛错并落盘', threw && threw.message);
  const g = h.calls.save[0] || {};
  ok(g.text.length === 1 && g.text[0][0] === '新组', 'E2 旧库清空、按文件填充', JSON.stringify(g.text));
  ok(Array.isArray(g.fish) && g.fish.length === 0 && Array.isArray(g.voice) && g.voice.length === 0, 'E3 CC_ALL_TYPES 全键归位（功能分类不在本应用格式解析范围，正确保持空）');
  ok(/已替换字卡库 · 共 1 张字卡/.test(toasts(h)), 'E4 replace 成功 toast', toasts(h));
}

console.log('摘要: ' + pass + ' 通过 / ' + fail + ' 失败 (#253 字卡导入端到端)');
process.exit(fail ? 1 : 0);

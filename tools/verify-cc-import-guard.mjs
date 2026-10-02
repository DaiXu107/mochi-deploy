// ===== #193 字卡库写路径防覆盖守卫 行为断言 =====
// 抽 src/js/chatcard.js 真实源码（ccAuthSeen 守卫 + saveGroupsNow + mergeCcGroupsInto +
// rescueCcOverwrite）在桩环境下跑行为断言：权威大库（如 17.67MB 公用库）被启动回填挂起/
// hydrateCurScope 未落定时，内存 groups 只是空/残缺快照，saveGroups 必须绝不整包写回——
// 探测 IDB 有键就走合并营救（旧字卡 + 本次导入都不丢）；确认无键（新装/空库）才放行直写。
// 运行：node tools/verify-cc-import-guard.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'js', 'chatcard.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// ---------- 源码接线断言（标记置位/重置的五个出口都在） ----------
ok(/function applyRestored\([^]*?ccAuthMark\(lsKey === PUB_KEY \? 'public' : 'own'\)/.test(src), 'applyRestored 启动恢复读到权威 → 置位标记');
ok((src.match(/if \(fullKey === curFullKey\(\)\) ccAuthMark\(\);/g) || []).length === 3, 'hydrateScope 三出口（hasData/成功/确认无键）均按 curFullKey 置位');
ok(/ccAuthSeen\.own = false; .*#193/.test(src), 'contact-switched 重置 own 作用域标记（新桌面权威键未取回，守卫重新生效）');
ok(/function saveGroups\(groups\) \{\s*if \(!ccAuthSeen\[ccScope\] && window\.idbHasKey\) \{/.test(src), 'saveGroups 首行即守卫（全部写路径收口：批量导入/上传/编辑/删除共用 scheduleSave→saveGroups）');

// ---------- 行为断言（抽真实源码桩环境执行） ----------
function slice(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error('切片失败: ' + from.slice(0, 40));
  return src.slice(a, b);
}
const guardSrc = slice('const ccAuthSeen', 'let groups = loadGroups();');

function harness({ idbHas, idbHydrateFails = false, scope = 'public' } = {}) {
  const setCalls = [];
  const storeVal = {}; // 模拟 store 三路读（hydrate 后 loadGroups 从这里读）
  const api = new Function('PUB_PREFIX', 'PUB_KEY', 'window', 'curStore', 'curKey', 'ccScopeRef',
    'hydrateCurScope', 'loadGroups', 'renderGroupsBar', 'render', 'pubInvalidate', 'refreshLibCounts',
    '"use strict";\nlet ccDirty = false;\nlet ccScope = ccScopeRef;\nlet groups = null;\n' + guardSrc +
    '\nreturn { saveGroups, saveGroupsNow, mergeCcGroupsInto, rescueCcOverwrite, curFullKey,' +
    ' mark: ccAuthMark, setGroups: v => { groups = v; }, seen: () => ({ public: ccAuthSeen.public, own: ccAuthSeen.own }), setDirty: v => { ccDirty = v; }, getDirty: () => ccDirty };')(
    'xy-home-v2', 'cc-groups-public',
    { idbHasKey: idbHas === 'none' ? undefined : () => new Promise((res, rej) => { if (idbHas === 'reject') rej(new Error('busy')); else res(typeof idbHas === 'function' ? idbHas() : idbHas); }) },
    () => ({ get: k => storeVal[k] || null, set: (k, v) => { setCalls.push([k, v]); storeVal[k] = v; } }),
    () => scope === 'public' ? 'cc-groups-public' : 'cc-groups',
    scope,
    () => idbHydrateFails ? Promise.reject(new Error('idb down')) : (storeVal.__hydrate = true, Promise.resolve(true)),
    () => storeVal.__hydrate ? JSON.parse(storeVal.__auth || 'null') || { text: [] } : { text: [] },
    () => {}, () => {}, () => {}, () => {},
  );
  return { api, setCalls, storeVal };
}

const AUTH = { text: [['旧分组', ['旧卡1', '旧卡2']]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
const MEM_ADD = { text: [['旧分组', ['旧卡1', '新卡A']], ['新分组', ['新卡B']]] };

(async () => {
  // A. 未见过权威 + IDB 有权威键 → 拒写 + 合并营救：旧卡与新卡都在
  {
    const h = harness({ idbHas: true });
    h.storeVal.__auth = JSON.stringify(AUTH);
    h.api.setDirty(true);
    h.api.setGroups(MEM_ADD); h.api.saveGroups(MEM_ADD);
    await new Promise(r => setTimeout(r, 20));
    ok(h.setCalls.length === 0 || JSON.parse(h.setCalls[0][1]).text[0][1].indexOf('旧卡2') >= 0, 'A1 第一次写回必含权威旧卡（绝不先整包直写残缺库覆盖旧字卡）');
    const saved = h.setCalls.length ? null : h.storeVal['cc-groups-public'] || '';
    // rescue 写回走 saveGroupsNow→curStore().set
    await new Promise(r => setTimeout(r, 20));
    const wrote = (h.storeVal['cc-groups-public'] || '');
    ok(!!wrote, 'A2 合并营救后写回权威键');
    const g = JSON.parse(wrote || '{}');
    const names = JSON.stringify(g);
    ok(names.indexOf('旧卡1') >= 0 && names.indexOf('旧卡2') >= 0, 'A3 旧字卡全部保留');
    ok(names.indexOf('新卡A') >= 0 && names.indexOf('新卡B') >= 0, 'A4 本次导入的增量也保留（同名分组去重补卡+新分组整组补入）');
    ok(!h.api.getDirty(), 'A5 营救写回后 ccDirty 落盘清零');
    ok(h.api.seen().public === true, 'A6 营救完成置位权威已见标记（后续写零开销直写）');
    // 营救后再次 saveGroups 应直写不再探测
    const before = Object.keys(h.storeVal).length;
    h.api.setGroups(MEM_ADD); h.api.saveGroups(MEM_ADD);
    ok(!!h.storeVal['cc-groups-public'] && h.storeVal['cc-groups-public'].length > 0 && before >= 0, 'A7 已见权威后直写不再走守卫探测');
  }
  // B. 未见过权威 + IDB 确认无键（新装/空库）→ 放行直写
  {
    const h = harness({ idbHas: false });
    h.api.setGroups(MEM_ADD); h.api.saveGroups(MEM_ADD);
    await new Promise(r => setTimeout(r, 20));
    ok(!!h.storeVal['cc-groups-public'], 'B1 健康连接确认无键 = 内存库就是全部，放行直写（新装不卡导入）');
    ok(h.api.seen().public === true, 'B2 放行同时置位标记');
  }
  // C. 探测/取回失败 → 宁缓写绝不覆盖
  {
    const h = harness({ idbHas: 'reject' });
    h.api.setGroups(MEM_ADD); h.api.saveGroups(MEM_ADD);
    await new Promise(r => setTimeout(r, 20));
    ok(!h.storeVal['cc-groups-public'] && h.api.getDirty() === true, 'C1 探测失败不写回且保持待写（离页冲刷可重试）');
    const h2 = harness({ idbHas: true, idbHydrateFails: true });
    h2.storeVal.__auth = JSON.stringify(AUTH);
    h2.api.saveGroups(MEM_ADD);
    await new Promise(r => setTimeout(r, 30));
    ok(!h2.storeVal['cc-groups-public'], 'C2 取回权威失败也不拿残缺库覆盖');
  }
  // D. mergeCcGroupsInto 纯函数行为
  {
    const h = harness({ idbHas: false });
    const auth = JSON.parse(JSON.stringify(AUTH));
    const out = h.api.mergeCcGroupsInto(auth, { text: [['旧分组', ['旧卡1', '新卡A']], ['品牌新组', ['x']]] });
    ok(out.text[0][1].length === 3 && out.text[0][1].indexOf('新卡A') >= 0, 'D1 同名分组去重补卡（旧卡1 不重复）');
    ok(out.text.some(g => g[0] === '品牌新组'), 'D2 权威没有的分组整组补入');
    ok(out.text.length === 2 && out.text[0][1].length === 3, 'D3 权威原有分组与卡片数不受影响');
  }
  // E. rescue 并发去重
  {
    const h = harness({ idbHas: true });
    h.storeVal.__auth = JSON.stringify(AUTH);
    h.api.setGroups(MEM_ADD); h.api.saveGroups(MEM_ADD);
    h.api.setGroups(MEM_ADD); h.api.saveGroups(MEM_ADD);
    await new Promise(r => setTimeout(r, 30));
    const n = JSON.parse(h.storeVal['cc-groups-public'] || '{}').text[0][1].length;
    ok(n === 3, 'E1 并发多次 saveGroups 只营救一次（幂等不重复补卡）');
  }

  console.log('\n' + pass + ' pass / ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();

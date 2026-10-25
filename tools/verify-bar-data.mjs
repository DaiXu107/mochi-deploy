// ===== 吧台数据回归测试（纯 Node，无浏览器/无存储）=====
// 运行：node tools/verify-bar-data.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (p) => readFileSync(join(root, p), 'utf8');
const ctx = vm.createContext({ console, window: { matchMedia: () => ({ matches: false }) } });
for (const f of ['src/js/bar-presets.js', 'src/js/bar-fusions.js', 'src/js/bar-names.js', 'src/js/bar-render.js']) {
  vm.runInContext(read(f), ctx);
}

const Presets = ctx.window.BarPresets;
const Fusions = ctx.window.BarFusions;
const Names = ctx.window.BarNames;
const Render = ctx.window.BarRender;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

console.log('\n[1] 原料与配方完整性');
ok('预设版本为 2', Presets.version === 2);
const ingIds = new Set(Presets.ingredients.map((i) => i.id));
ok('原料 id 唯一', ingIds.size === Presets.ingredients.length, 'duplicate id');
ok('全部原料有颜色', Presets.ingredients.every((i) => /^#[0-9a-f]{6}$/i.test(i.color || '')));
const fusionIds = new Set(Fusions.map((f) => f.id));
ok('配方 id 唯一', fusionIds.size === Fusions.length);
const unresolved = [];
for (const f of Fusions) {
  for (const r of f.requires) if (!ingIds.has(r) && !fusionIds.has(r)) unresolved.push(f.id + ':' + r);
}
ok('所有 requires 均可解析', unresolved.length === 0, unresolved.join(','));
ok('配方数量已扩充（>49）', Fusions.length > 49, '当前 ' + Fusions.length);

console.log('\n[2] 新增原料');
const wanted = ['cream', 'coffee_liqueur', 'jasmine', 'butterfly_pea', 'yuzu_flower', 'borage', 'peach_puree', 'osmanthus_syrup', 'jasmine_honey', 'rose_syrup', 'lavender_syrup', 'yuzu_flower_syrup', 'cane_syrup', 'cheese_foam', 'black_sugar_pearl', 'edible_flower', 'snow_cake', 'ice_cube', 'sparkling_wine', 'rice_wine', 'brown_sugar_syrup'];
ok('新增原料全部存在', wanted.every((id) => ingIds.has(id)), wanted.filter((id) => !ingIds.has(id)).join(','));

console.log('\n[3] 链式合成可达性');
const byId = {}; Presets.ingredients.forEach((i) => { byId[i.id] = i; });
const byFusion = {}; Fusions.forEach((f) => { byFusion[f.id] = f; });
function settle(slots) {
  const sorted = Fusions.slice().sort((a, b) => b.requires.length - a.requires.length);
  for (let round = 0; round < 12; round++) {
    const ids = slots.map((s) => s.id);
    const hit = sorted.find((f) => f.requires.every((r) => ids.includes(r)));
    if (!hit) return;
    const need = hit.requires.slice();
    const next = [];
    for (const s of slots) {
      const k = need.indexOf(s.id);
      if (k >= 0) need.splice(k, 1); else next.push(s);
    }
    next.push(hit.result);
    slots.length = 0; slots.push(...next);
  }
}
function sim(ids) {
  const slots = [];
  for (const id of ids) {
    const item = byId[id] || (byFusion[id] && byFusion[id].result);
    if (!item) return 'missing:' + id;
    slots.push({ ...item });
    settle(slots);
  }
  return slots.map((s) => s.name).join(' + ');
}
const cases = {
  '桂花冷萃': ['cold_brew', 'osmanthus_syrup', 'ice_cube'],
  '茉莉拿铁': ['espresso', 'milk', 'jasmine_honey'],
  '玫瑰浓缩': ['espresso', 'rose_syrup', 'cream'],
  '柚花美式': ['espresso', 'yuzu_flower_syrup', 'soda_water'],
  '黑糖珍珠咖啡': ['espresso', 'milk', 'brown_sugar_syrup', 'black_sugar_pearl'],
  '海盐芝士咖啡': ['espresso', 'cheese_foam', 'sea_salt'],
  '橙香冰摇咖啡': ['espresso', 'orange_juice', 'ice_cube', 'cane_syrup'],
  '洛神花冰咖': ['cold_brew', 'hibiscus', 'black_tea', 'peach_puree'],
  '洛神气泡': ['hibiscus', 'soda_water', 'honey'],
  '蝶豆花青柠气泡': ['butterfly_pea', 'soda_water', 'lime'],
  '薰衣草拿铁': ['lavender_syrup', 'milk', 'espresso'],
  '琉璃苣冰奶茶': ['borage', 'milk', 'black_tea', 'ice_cube'],
  '蝶豆花金汤力': ['gin', 'tonic_water', 'butterfly_pea'],
  '玫瑰荔枝气泡酒': ['sparkling_wine', 'rose_syrup', 'lychee'],
  '桂花酒酿奶茶': ['rice_wine', 'milk_tea', 'osmanthus_syrup'],
  '薰衣草花草茶': ['black_tea', 'jasmine', 'lavender'],
  '浓缩咖啡马天尼': ['vodka', 'espresso', 'coffee_liqueur']
};
for (const [name, ids] of Object.entries(cases)) ok(name, sim(ids) === name, sim(ids));
ok('桂花冷萃（链式）', sim(['espresso', 'milk', 'osmanthus_syrup', 'cold_brew']) === '桂花冷萃');

console.log('\n[4] 蝶豆花变色与抽象名池');
const blue = Render.mixLiquidColor([{ id: 'butterfly_pea', color: '#4f6bd8', role: 'main' }]);
const purple = Render.mixLiquidColor([{ id: 'butterfly_pea', color: '#4f6bd8', role: 'main' }, { id: 'lime', color: '#b7d84a', role: 'main' }]);
ok('蝶豆花本身为蓝', blue.b > blue.r && blue.b > blue.g, JSON.stringify(blue));
ok('蝶豆花遇酸变紫', purple.r > blue.r && purple.b > purple.g, JSON.stringify(purple));
const allNames = Names.order.reduce((a, k) => a.concat(Names.pools[k] || []), []);
for (const n of ['金雪', '秋酿', '绯色', '刺与蜜', '蓝夜', '紫雾']) ok('抽象名「' + n + '」存在', allNames.includes(n));

console.log('\n结果：' + pass + '/' + (pass + fail) + (fail ? ' 失败' : ' 全部通过'));
process.exit(fail ? 1 : 0);

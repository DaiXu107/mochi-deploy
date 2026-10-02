// ===== 专项回归：记账功能缺陷批（#819：数据闸门 / 金额校验 / 环形图整圆 / 编辑分类 / 搜索 / 口径 / 预算文案） =====
// 背景：#801 体检出的 D1~D9 全部修掉，且不得引入安卓/iOS 卡顿（性能红线做进断言）。
// 用例分组：
//   A＝D1 权威值闸门（LS 读不到键 ≠ 没有账，未确认前禁整包写盘，防历史账目被空态覆盖）
//   B＝D6 金额/时间校验（isFinite ＋ 上限钳制，堵 ¥Infinity 污染统计与图表）
//   C＝D7/D8 图表（单一分类整圆拆两段弧；读取中不说「无支出」）
//   D＝D2 编辑态保留已停用分类（不静默改分类）
//   E＝D5/D8 搜索（按日期命中、标明搜索全部账目、读取中不说「没有记录」）
//   F＝D4 预算文案跟随区间
//   G＝D3/D9 源码锚点（至少留一个分类、备份导入后重读重渲）
//   P＝性能红线（零新增高频定时器/滚动监听/合成层，闸门取回有界重试）
// 红对照：MOCHI_ACC_FILE=<git show HEAD:src/js/accounting.js> MOCHI_EXPECT=red node tools/verify-acc-defects.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const srcAcc = readFileSync(process.env.MOCHI_ACC_FILE || join(root, 'src/js/accounting.js'), 'utf8');
const srcCss = readFileSync(process.env.MOCHI_CSS_FILE || join(root, 'src/css/chat-pages.css'), 'utf8');
const srcTpl = readFileSync(join(root, 'src/template.html'), 'utf8');

const failures = [];
const notes = [];
const ok = (id, cond, why) => { (cond ? notes : failures).push((cond ? '✓ ' : '✗ ') + id + (cond ? '' : '：' + why)); };

function extractFn(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error('找不到 ' + sig);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(sig + ' 花括号不配平');
}

// ---- DOM stub：记账页所有渲染函数只写 innerHTML/textContent/style/class，桩到这一层就够 ----
function mkEl(id) {
  return { id, innerHTML: '', textContent: '', hidden: false, style: {}, className: '', children: [],
    setAttribute() {}, addEventListener() {}, appendChild(c) { this.children.push(c); },
    querySelector() { return mkEl(id + '-q'); }, focus() {} };
}
function mkDoc(ids) {
  const els = {};
  (ids || []).forEach((i) => { els[i] = mkEl(i); });
  return {
    els,
    hidden: false,
    activeElement: null,
    getElementById: (i) => els[i] || null,
    createElement: () => ({ className: '', textContent: '', setAttribute() {}, addEventListener() {}, appendChild() {} })
  };
}
function mkStore(init) {
  const m = Object.assign({}, init || {});
  return {
    get: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    set: (k, v) => { m[k] = String(v); },
    remove: (k) => { delete m[k]; },
    _dump: () => m
  };
}

function extractConst(src, re) {
  const m = src.match(re);
  if (!m) throw new Error('找不到常量 ' + re);
  return m[0];
}

const SIGS = ['function hasVal(', 'function authOk(', 'function hydrate(', 'function hydrateAll()',
  'function dataPending()', 'function writable(', 'function saveRecs(',
  'function safeAmount(', 'function migrateRecs(',
  'function pad2(', 'function dayStr(', 'function parseDay(', 'function fmt(', 'function getRange(',
  'function inRange(', 'function esc(', 'function loadingHtml(', 'function loadingTxt(',
  'function renderChart(', 'function renderRank(', 'function renderCatGrid(', 'function renderList(',
  'function renderBudget('];

function bodySrc() {
  return extractConst(srcAcc, /var AMOUNT_MAX = [^;]+;/) + '\n' +
    extractConst(srcAcc, /var WEEK = \[[^\]]*\];/) + '\n' +
    SIGS.map((s) => extractFn(srcAcc, s)).join('\n');
}

let api = null;
try {
  api = makeApi(bodySrc());
} catch (e) {
  failures.push('ALL：无法从 accounting.js 提取被测函数体——' + e.message);
}

function makeApi(body) {
  return new Function('window', 'document', 'store', 'todayStr', 'idbLog',
    '"use strict";\n' +
    'var KEY_REC = "accounting-records", KEY_CAT = "accounting-categories", KEY_BUDGET = "accounting-budget";\n' +
    'var page = { hidden: false };\n' +
    'var authSeen = {}, authTry = {}, hydrated = {};\n' +
    'var recs = [], cats = null, budget = { expense: 0 };\n' +
    'var viewMode = "month", anchor = "2026-09-15";\n' +
    'var curType = "expense", curCat = "", curFilter = "all", curRankCat = "", searchKw = "";\n' +
    'var editId = null, editExtCat = "", curRankCatX = "";\n' +
    'function loadAll() { recs = migrateRecs(JSON.parse(store.get(KEY_REC) || "[]")); }\n' +
    'function loadRecs() { try { return JSON.parse(store.get(KEY_REC) || "[]"); } catch (e) { return []; } }\n' +
    'function loadCats() { try { var c = JSON.parse(store.get(KEY_CAT) || "null"); if (c && c.expense && c.income) return c; } catch (e) {} return { expense: ["餐饮"], income: ["工资"] }; }\n' +
    'function loadBudget() { try { var b = JSON.parse(store.get(KEY_BUDGET) || "null"); if (b && typeof b === "object") return b; } catch (e) {} return { expense: 0 }; }\n' +
    'function newId() { return "id_" + (++idbLog.seq); }\n' +
    body + '\n' +
    'return {\n' +
    '  set: function (o) { if ("recs" in o) recs = o.recs; if ("cats" in o) cats = o.cats; if ("budget" in o) budget = o.budget;\n' +
    '    if ("viewMode" in o) viewMode = o.viewMode; if ("anchor" in o) anchor = o.anchor; if ("curType" in o) curType = o.curType;\n' +
    '    if ("curCat" in o) curCat = o.curCat; if ("curFilter" in o) curFilter = o.curFilter; if ("curRankCat" in o) curRankCat = o.curRankCat;\n' +
    '    if ("searchKw" in o) searchKw = o.searchKw; if ("editId" in o) editId = o.editId; if ("pageHidden" in o) page.hidden = o.pageHidden; },\n' +
    '  get: function () { return { curCat: curCat, editExtCat: editExtCat, authSeen: authSeen, authTry: authTry, hydrated: hydrated }; },\n' +
    '  resetAuth: function () { authSeen = {}; authTry = {}; hydrated = {}; },\n' +
    '  writable: writable, hydrateAll: hydrateAll, dataPending: dataPending, saveRecs: saveRecs,\n' +
    '  safeAmount: safeAmount, migrateRecs: migrateRecs, renderChart: renderChart, renderRank: renderRank,\n' +
    '  renderCatGrid: renderCatGrid, renderList: renderList, renderBudget: renderBudget, AMOUNT_MAX: AMOUNT_MAX\n' +
    '};');
}

const R1 = '2026-09-19';
const R2 = '2026-08-05';
function rec(id, cat, amt, date, type) {
  return { id: id, type: type || 'expense', amount: amt, category: cat, note: 'n' + id, date: date || R1, time: 100 };
}

function run(opts) {
  const o = opts || {};
  const doc = mkDoc(['acc-chart-bar', 'acc-chart-ring', 'acc-chart-ring-center', 'acc-rank-list', 'acc-rank-card', 'acc-cat-grid',
    'acc-list', 'acc-budget-wrap', 'acc-budget-bar', 'acc-budget-txt']);
  const store = mkStore(o.store);
  const log = { hydrate: 0, readyReg: 0, seq: 0 };
  const win = {
    activePrefix: () => (o.prefix || 'xy-home-v2:default'),
    idbSet: () => {},
    mochiDataPending: () => !!o.pending,
    mochiOnDataReady: (fn) => { log.readyReg++; o.readyFn = fn; },
    idbHydrateKey: (k) => {
      log.hydrate++;
      const v = (o.hydrateResults || ['true'])[Math.min(log.hydrate, (o.hydrateResults || ['true']).length) - 1];
      if (v === 'never') return new Promise(() => {});
      const val = v === 'true' ? '[]' : null;
      if (v === 'true') store.set('accounting-records', '[]');
      return Promise.resolve(v === 'throw' ? null : v === 'false' ? false : v === 'null' ? null : true);
    },
    mochiLoadingHtml: (what) => '<div class="mochi-data-loading">' + what + '还在读取</div>',
    mochiLoadingText: () => '正在读取…'
  };
  const fn = makeApi(bodySrc());
  const inst = fn(win, doc, store, () => o.today || R1, log);
  inst.set(Object.assign({ pageHidden: false }, o.vars || {}));
  return { inst, doc, store, log, win };
}

if (api) {
  // ---------- A：D1 权威值闸门 ----------
  {
    const { inst, store } = run({ hydrateResults: ['never'] });
    const w = inst.writable('accounting-records');
    ok('A1 LS 无键 ⇒ writable=false（不许整包写盘）', w === false, 'writable 返回 ' + w);
    inst.saveRecs([rec('a', '餐饮', 5)]);
    ok('A2 saveRecs 在权威值未确认时被拒', store._dump()['accounting-records'] === undefined,
      '空态下照样写盘＝历史账目会被覆盖');
  }
  {
    const { inst, store, log } = run({ pending: true });
    inst.writable('accounting-records');
    ok('A3 整体回填未完时不去读 IDB（防把「还没回填」读成「确实没有」），改挂就绪回调',
      log.hydrate === 0 && log.readyReg === 1, 'hydrate=' + log.hydrate + ' readyReg=' + log.readyReg);
  }
  {
    const { inst, log } = run({});
    let done = 0;
    inst.hydrateAll();
    ok('A4 取回在途期间口径为「正在读取」', inst.dataPending() === true, 'hydrated=' + JSON.stringify(inst.get().hydrated));
  }
  {
    const { inst, store } = run({ hydrateResults: ['null'] });
    inst.hydrateAll();
    await new Promise((r) => setTimeout(r, 0));
    ok('A5 IDB 健康确认「无此键」（新联系人）⇒ 放行写盘，不把新用户锁死',
      inst.writable('accounting-records') === true, 'writable=false');
    inst.saveRecs([rec('a', '餐饮', 5)]);
    ok('A6 放行后写盘真的落键', store._dump()['accounting-records'] !== undefined, '未写入');
  }
  {
    const { inst } = run({ hydrateResults: ['false'] });
    inst.hydrateAll();
    await new Promise((r) => setTimeout(r, 0));
    const g1 = inst.get();
    ok('A7 单次读失败：仍不放行、仍按「正在读取」口径（保持可重试）',
      g1.authSeen['accounting-records'] === undefined && g1.hydrated['accounting-records'] === 1,
      JSON.stringify(g1));
    inst.hydrateAll();
    await new Promise((r) => setTimeout(r, 0));
    const g2 = inst.get();
    ok('A8 连续两次失败 ⇒ 降级放行（IDB 坏了记账还能用，不永久锁死）',
      g2.authSeen['accounting-records'] === 1 && inst.writable('accounting-records') === true, JSON.stringify(g2));
  }
  {
    const { inst } = run({ prefix: 'xy-home-v2:default' });
    inst.hydrateAll();
    await new Promise((r) => setTimeout(r, 30));
    ok('A9 取回落定后在途标记撤销（读到真账目不再挂「正在读取」）',
      inst.dataPending() === false, JSON.stringify(inst.get().hydrated));
  }
}

if (api) {
  // ---------- B：D6 金额 / 时间校验 ----------
  const { inst } = run({});
  const M = inst.AMOUNT_MAX;
  ok('B1 Infinity ⇒ 0（不再是 ¥Infinity 传导进统计）', inst.safeAmount(Infinity) === 0, String(inst.safeAmount(Infinity)));
  ok('B2 非法字符串 ⇒ 0', inst.safeAmount('abc') === 0, String(inst.safeAmount('abc')));
  ok('B3 超大数 ⇒ 钳到上限 ' + M, inst.safeAmount(1e18) === M, String(inst.safeAmount(1e18)));
  ok('B4 负数 ⇒ 取绝对值', inst.safeAmount(-12.5) === 12.5, String(inst.safeAmount(-12.5)));
  const bad = [{ id: 'x', type: 'expense', amount: '1e999', category: '餐饮', note: '', date: R1, time: Infinity }];
  const fixed = inst.migrateRecs(bad);
  ok('B5 migrateRecs 把历史脏数据一并收口（amount/time 都归位）',
    fixed[0].amount === 0 && isFinite(fixed[0].time) && fixed[0].time > 0, JSON.stringify(fixed[0]));
}

if (api) {
  // ---------- C：D7 环形图整圆 + D8 环心口径 ----------
  {
    const { inst, doc } = run({ vars: { recs: [rec('a', '餐饮', 10, R1)] } });
    inst.renderChart();
    const paths = (doc.els['acc-chart-ring'].innerHTML.match(/<path/g) || []).length;
    ok('C1 单一分类（100%）⇒ 拆两段弧，整圆不再空白', paths === 2, 'path 数=' + paths + '（1＝起止点重合，画不出弧）');
    const d = doc.els['acc-chart-ring'].innerHTML;
    const nums = (d.match(/-?\d+\.\d/g) || []).length;
    ok('C2 两段弧端点各自不同（真的画了半个圆＋半个圆）', nums >= 12, 'd=' + d.slice(0, 120));
  }
  {
    const { inst, doc } = run({ vars: { recs: [rec('a', '餐饮', 10, R1), rec('b', '交通', 5, R1)] } });
    inst.renderChart();
    const paths = (doc.els['acc-chart-ring'].innerHTML.match(/<path/g) || []).length;
    ok('C3 两分类保持原样（各一段，未误拆）', paths === 2, 'path 数=' + paths);
  }
  {
    const { inst, doc } = run({ pending: true, vars: { recs: [] } });
    inst.renderChart();
    ok('C4 数据读取中 ⇒ 环心说「正在读取」而不是「无支出」',
      doc.els['acc-chart-ring-center'].innerHTML.indexOf('正在读取') >= 0, doc.els['acc-chart-ring-center'].innerHTML);
  }
  {
    const { inst, doc } = run({ vars: { recs: [] }, hydrateResults: ['null'] });
    inst.hydrateAll();
    await new Promise((r) => setTimeout(r, 0));
    inst.renderChart();
    ok('C5 确认完为空 ⇒ 环心老实说「无支出」',
      doc.els['acc-chart-ring-center'].innerHTML.indexOf('无支出') >= 0, doc.els['acc-chart-ring-center'].innerHTML);
    const rankPaths = doc.els['acc-rank-list'];
    inst.renderRank();
    ok('C6 排行为空同理', rankPaths.innerHTML.indexOf('无支出') >= 0, rankPaths.innerHTML);
  }
}

if (api) {
  // ---------- D：D2 编辑态保留已停用分类 ----------
  {
    const { inst, doc } = run({ vars: { cats: { expense: ['餐饮', '交通'], income: ['工资'] }, editId: 'x', curCat: '宠物', curType: 'expense' } });
    inst.renderCatGrid();
    const names = doc.els['acc-cat-grid'].children.map((c) => c.textContent);
    ok('D1 编辑一条「宠物」分类的记录 ⇒ 宠物那格挂回并标「已停用」',
      names.indexOf('宠物（已停用）') >= 0, JSON.stringify(names));
    ok('D2 curCat 不再被悄悄改选成首项', inst.get().curCat === '宠物', inst.get().curCat);
  }
  {
    const { inst, doc } = run({ vars: { cats: { expense: ['餐饮', '交通'], income: ['工资'] }, editId: null, curCat: '宠物', curType: 'expense' } });
    inst.renderCatGrid();
    const names = doc.els['acc-cat-grid'].children.map((c) => c.textContent);
    ok('D3 非编辑态维持原行为（已停用分类不复活、自动归位首项）',
      names.join(',') === '餐饮,交通' && inst.get().curCat === '餐饮', JSON.stringify(names) + ' / ' + inst.get().curCat);
  }
}

if (api) {
  // ---------- E：D5 搜索 + D8 列表口径 ----------
  {
    const { inst, doc } = run({ vars: { recs: [rec('a', '餐饮', 10, R2), rec('b', '交通', 5, R1)], searchKw: '08-05' } });
    inst.renderList();
    const h = doc.els['acc-list'].innerHTML;
    ok('E1 按日期片段能搜到往期记录（搜索不再受当前区间限制）',
      h.indexOf('n a'.replace(' ', '')) >= 0 || h.indexOf('na') >= 0 || h.indexOf('acc-row') >= 0, h.slice(0, 80));
    ok('E2 结果顶部说明搜索范围与条数', h.indexOf('搜索全部账目 · 共 1 条') >= 0, h.slice(0, 80));
  }
  {
    const { inst, doc } = run({ vars: { recs: [rec('a', '餐饮', 10, R2)], searchKw: 'zzz' } });
    inst.renderList();
    ok('E3 搜不到时口径写明「全部账目」，不再和区间口径混', doc.els['acc-list'].innerHTML.indexOf('全部账目') >= 0,
      doc.els['acc-list'].innerHTML);
  }
  {
    const { inst, doc } = run({ pending: true, vars: { recs: [], searchKw: '' } });
    inst.renderList();
    ok('E4 数据读取中 ⇒ 列表说「还在读取」而不是「还没有记录」',
      doc.els['acc-list'].innerHTML.indexOf('还在读取') >= 0, doc.els['acc-list'].innerHTML);
  }
  {
    const { inst, doc } = run({ vars: { recs: [], searchKw: '' }, hydrateResults: ['null'] });
    inst.hydrateAll();
    await new Promise((r) => setTimeout(r, 0));
    inst.renderList();
    ok('E5 确认完为空 ⇒ 老实说「本区间还没有记录」',
      doc.els['acc-list'].innerHTML.indexOf('本区间还没有记录') >= 0, doc.els['acc-list'].innerHTML);
  }
}

if (api) {
  // ---------- F：D4 预算文案跟随区间 ----------
  const { inst, doc } = run({ vars: { budget: { expense: 1000 }, recs: [rec('a', '餐饮', 300, R1)], viewMode: 'month', anchor: '2026-07-10' } });
  inst.renderBudget(300, inst.renderChart && { label: '2026 年 7 月', start: '2026-07-01', end: '2026-07-31' });
  const t = doc.els['acc-budget-txt'].textContent;
  ok('F1 预算文案跟着区间走（看 7 月不再写「本月预算」）', t.indexOf('2026 年 7 月预算') === 0, t);
  const { inst: i2, doc: d2 } = run({ vars: { budget: { expense: 1000 }, viewMode: 'week' } });
  i2.renderBudget(20, { label: '9/14 - 9/20', start: '2026-09-14', end: '2026-09-20' });
  ok('F2 非月视图仍隐藏预算条（原行为不变）', d2.els['acc-budget-wrap'].hidden === true, '未隐藏');
}

// ---------- G / P：源码锚点 + 性能红线 ----------
const has = (s) => srcAcc.indexOf(s) >= 0;
ok('G1 D1：三处写盘入口全部过闸门（记一笔/删除/预算/分类）',
  (srcAcc.match(/writable\(KEY_(REC|CAT|BUDGET)\)/g) || []).length >= 5,
  '闸门调用数=' + (srcAcc.match(/writable\(KEY_/g) || []).length);
ok('G2 D9：备份导入完成后重读重渲（mochi-restore-done）',
  /addEventListener\('mochi-restore-done', function \(\) \{[\s\S]{0,200}resetAuth\(\)/.test(srcAcc), '未接');
ok('G3 D1：切桌面时权威值结论一并作废（防按旧桌面结论放行覆盖新桌面）',
  has('function resetAuth() { authSeen = {}; authTry = {}; hydrated = {}; }'), '未重置');
ok('G4 D3：分类至少保留一个（删空后记一笔会落到不存在的分类）',
  has('c3[delType].length <= 1'), '未拦');
ok('G5 D5：搜索框说明可搜日期（template 锚点）', srcTpl.indexOf('搜索全部账目：备注/分类/金额/日期') >= 0, '未改');
ok('G6 D1：旧的「按键 idbGet 直写 LS」回填已下线', !has('if (!store.get(KEY_REC)) window.idbGet'), '仍在直写');

const timers = (srcAcc.match(/setInterval\(/g) || []).length;
ok('P1 性能：零新增定时器（记账页只有提醒那一条 5 分钟心跳）', timers <= 1, 'setInterval 数=' + timers);
ok('P2 性能：无滚动/触摸/滚轮监听、无 rAF（不碰帧循环）',
  !/addEventListener\('(scroll|touchmove|wheel|pointermove)'/.test(srcAcc) && !has('requestAnimationFrame'), '存在高频监听');
ok('P3 性能：闸门取回有界（失败最多重试一次即降级，不无限循环取回）',
  has('authTry[k] >= 2'), '无重试上限');
const accCss = (srcCss.match(/\.acc-[^\n]*\n/g) || []).join('');
ok('P4 性能：记账样式零新增合成层/毛玻璃（无 will-change、无新增 backdrop-filter）',
  !/will-change/.test(accCss) && (accCss.match(/backdrop-filter/g) || []).length === 0,
  '新增：' + (accCss.match(/will-change|backdrop-filter/g) || []).join(','));

const line = failures.length ? '\n' : '';
console.log(notes.join('\n') + line);
console.log('\n' + (failures.length ? '✗ ' + failures.length + ' 条失败' : '✓ ' + notes.length + ' 条断言全过'));
failures.forEach((f) => console.log('  ' + f));
const red = EXPECT === 'red';
if (red) process.exit(failures.length ? 0 : 1);
process.exit(failures.length ? 1 : 0);

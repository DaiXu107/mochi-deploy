// ===== 真页面回归：记账缺陷批 #819（数据闸门 D1 / 空态口径 D8 / 环形图 D7 / 搜索 D5 / 预算 D4 / 金额 D6 / 分类 D3 / 导入重渲 D9 / 卡顿红线） =====
// 跑法：先在仓外隔离副本构建（mkdir ../mochi-acc814 && git archive HEAD | tar -x -C ../mochi-acc814，
//       只放本批 src），node ../mochi-acc814/build.mjs，再 MOCHI_ROOT=../mochi-acc814 node tools/verify-acc-defects-browser.mjs
// 与 tools/verify-acc-defects.mjs 的分工：那边纯 node 单元级（函数体＋stub，证闸门算法与几何/文案分支），
// 这边证接上真产物之后：真实 xyStore（memoryCache+LS+IDB）下「LS 空但 IDB 有账」这一条毁数路径
// 真的被拦住、历史真的没被覆盖；以及开页零新增定时器、零 JS 报错。
// 夹具纪律：不复用同一 context 的存储（换 context 代替 clearDataForOrigin），复位走 activeStore()。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.MOCHI_ROOT || process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const srv = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;

const failures = [];
const note = (id, ok, why) => { console.log((ok ? 'PASS ' : 'FAIL ') + id + (why ? '  [' + why + ']' : '')); if (!ok) failures.push(id + '｜' + why); };

const browser = await chromium.launch({ headless: true });
const REC_KEY = 'xy-home-v2:default:accounting-records';
const CAT_KEY = 'xy-home-v2:default:accounting-categories';
const BUD_KEY = 'xy-home-v2:default:accounting-budget';

const boot = async (page) => {
  await page.goto(base + '/index.html');
  await page.waitForFunction('!!window.__mochiDataReady', null, { timeout: 30000 }).catch(() => {});
  await page.evaluate("(() => { var e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); var s = document.getElementById('splash'); if (s && !s.classList.contains('hide')) { s.classList.add('hide'); s.hidden = true; } var q = document.getElementById('qa-mask'); if (q) q.remove(); })()");
  await sleep(700);
};
const openAcc = (page) => page.evaluate(`(() => { var a = document.querySelector('.app[data-app="accounting"]'); if (a) a.click(); return !!a; })()`);
const goHome = (page) => page.evaluate(`(() => { var b = document.getElementById('acc-back'); if (b) b.click(); return true; })()`);
const seed = (page, recs, cats, budget) => page.evaluate(`(() => {
  var st = window.activeStore();
  st.set('accounting-records', ${JSON.stringify(JSON.stringify(recs))});
  st.set('accounting-categories', ${JSON.stringify(JSON.stringify(cats))});
  st.set('accounting-budget', ${JSON.stringify(JSON.stringify(budget))});
  return true; })()`);

const d = (off) => { const x = new Date(Date.now() - off * 86400000); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const R = (id, cat, amt, date, type) => ({ id, type: type || 'expense', amount: amt, category: cat, note: '备注' + id, date, time: 100 });

// ---------- 场景一：常规数据下的渲染与交互（D7 / D5 / D4 / D6 / D3 / D9） ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  // 定时器探针必须在加载前装好，否则模块加载期创建的 interval 不在账上、无法归因
  await page.addInitScript(`(() => {
    window.__ivs = []; window.__ivAt = []; window.__ivWrap = 1;
    var o = window.setInterval;
    window.setInterval = function (f, ms) { window.__ivs.push(ms); try { window.__ivAt.push(String(new Error('iv').stack).split('\\n').slice(2, 5).join(' <- ')); } catch (e) { window.__ivAt.push(''); } return o.apply(window, arguments); };
  })()`);
  await boot(page);
  const iv0 = await page.evaluate('(() => window.__ivs.length)()');
  await openAcc(page);
  await sleep(300);
  await seed(page, [R('r1', '餐饮', 30, d(0)), R('r2', '餐饮', 45, d(1)), R('r3', '交通', 12, d(40))],
    { expense: ['餐饮', '交通'], income: ['工资'] }, { expense: 500 });
  // 重开页面才会走 render()→loadAll() 重读 store（prev/next 只重渲内存里的旧 recs）
  await goHome(page);
  await openAcc(page);
  await sleep(400);

  // D7：本月只有「餐饮」一个分类（第三笔在 40 天前，不在本月）⇒ 环必须画满
  const ring = await page.evaluate(`(() => {
    var svg = document.getElementById('acc-chart-ring');
    var ps = svg ? svg.querySelectorAll('path') : [];
    var box = svg ? svg.getBoundingClientRect() : { width: 0 };
    return { n: ps.length, w: Math.round(box.width), first: ps[0] ? ps[0].getAttribute('d') : '' }; })()`);
  note('B1-D7 单一分类环形图拆两段弧（旧 bug＝1 段起止同点＝整块空白）', ring.n === 2, JSON.stringify(ring));
  note('B1-D7 两段弧端点不同', ring.first && /M[\d.]+ [\d. ]+A/.test(ring.first) && ring.first.slice(0, 9) !== ring.first.slice(-9), ring.first);

  // D4：切到上个月看预算，文案要跟区间走
  await page.evaluate(`(() => { document.getElementById('acc-prev').click(); return true; })()`);
  await sleep(250);
  const bud = await page.evaluate(`(() => {
    var w = document.getElementById('acc-budget-wrap'), t = document.getElementById('acc-budget-txt');
    return { hidden: !w || w.hidden, txt: t ? t.textContent : '', month: (document.getElementById('acc-month-txt') || {}).textContent }; })()`);
  note('B2-D4 往期区间的预算条不再谎称「本月」', bud.hidden === false && bud.txt.indexOf('本月预算') !== 0 && /预算 /.test(bud.txt), JSON.stringify(bud));
  await page.evaluate(`(() => { document.getElementById('acc-next').click(); return true; })()`);
  await sleep(250);

  // D5：按日期片段搜往期账目（r3 在 40 天前，落在当前月份视图之外）
  const srch = await page.evaluate(`(() => {
    var i = document.getElementById('acc-search'), k = '${d(40).slice(5)}';
    i.value = k; i.dispatchEvent(new Event('input', { bubbles: true }));
    var rows = document.querySelectorAll('#acc-list .acc-row').length;
    var tip = document.querySelector('#acc-list .acc-search-tip');
    i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
    return { rows: rows, tip: tip ? tip.textContent : '', ph: i.placeholder }; })()`);
  note('B3-D5 搜日期片段命中往期记录', srch.rows === 1, JSON.stringify(srch));
  note('B3-D5 结果顶部说明搜索范围', srch.tip.indexOf('搜索全部账目 · 共 1 条') >= 0, srch.tip);
  note('B3-D5 输入框 placeholder 写明可搜日期', srch.ph.indexOf('日期') >= 0, srch.ph);

  // D6：天文数字金额不进账本
  const big = await page.evaluate(`(() => {
    var a = document.getElementById('acc-amount'); a.value = '1e999';
    document.getElementById('acc-save').click();
    var txt = document.getElementById('acc-list').textContent + document.getElementById('acc-ov-expense').textContent;
    return { inf: /Infinity/i.test(txt), rows: document.querySelectorAll('#acc-list .acc-row').length,
      stored: (JSON.parse(localStorage.getItem('${REC_KEY}') || '[]')).length, toast: (document.getElementById('cc-toast') || {}).textContent }; })()`);
  note('B4-D6 非法超大金额被拒、账本零污染', big.inf === false && big.stored === 3 && big.rows === 2, JSON.stringify(big));

  // D3：只剩一个分类时删除必须被拒（走真实弹窗点选）
  // 那笔账落在 cats 之外的「其他」上，让唯一分类「餐饮」名下无记录——否则旧版会先被「下有记录」
  // 误打误撞拦下，红的不是「删空」这个本体
  await seed(page, [R('r1', '其他', 30, d(0))], { expense: ['餐饮'], income: ['工资'] }, { expense: 0 });
  // 弹窗契约（personalize.js openModal）：#modal-pills 下的 .pill 点击只选中，必须再点 #modal-ok 才提交
  const PICK = '#modal-pills .pill';
  const del = await page.evaluate(`(async () => {
    document.getElementById('acc-cog').click();
    await new Promise(function (r) { setTimeout(r, 300); });
    var one = function (txt) { return Array.prototype.find.call(document.querySelectorAll('${PICK}'), function (x) { return x.textContent.trim() === txt; }); };
    var d = one('删除支出分类');
    if (!d) return { err: 'no-del-btn', n: document.querySelectorAll('${PICK}').length };
    d.click();
    document.getElementById('modal-ok').click();
    await new Promise(function (r) { setTimeout(r, 300); });
    if (document.getElementById('modal-title').textContent.indexOf('选择要删除') < 0) return { err: 'phase2-not-open', title: document.getElementById('modal-title').textContent };
    var c = one('餐饮');
    if (!c) return { err: 'no-cat-pill', pills: Array.prototype.map.call(document.querySelectorAll('${PICK}'), function (x) { return x.textContent; }).join('|') };
    c.click();
    document.getElementById('modal-ok').click();
    await new Promise(function (r) { setTimeout(r, 300); });
    var cats = JSON.parse(localStorage.getItem('${CAT_KEY}') || 'null');
    var toast = (document.getElementById('cc-toast') || {}).textContent || '';
    var cancel = document.getElementById('modal-cancel'); if (cancel) cancel.click();
    return { kept: cats && cats.expense && cats.expense.length, toast: toast }; })()`);
  note('B5-D3 最后一个分类删不掉（删空＝记账直接不可用）', del.kept === 1 && del.toast.indexOf('至少保留一个') >= 0, JSON.stringify(del));

  // D9：备份导入完成事件后不切页也要重读重渲
  const rd = await page.evaluate(`(() => {
    var st = window.activeStore();
    st.set('accounting-records', JSON.stringify([${JSON.stringify(R('r9', '餐饮', 88, d(0)))}]));
    document.dispatchEvent(new Event('mochi-restore-done'));
    var t = document.getElementById('acc-list').textContent;
    return { has: t.indexOf('备注 r9'.replace(' ', '')) >= 0 || t.indexOf('88') >= 0, txt: t.slice(0, 60) }; })()`);
  note('B6-D9 导入备份后原地重渲（不用切页再进）', rd.has === true, rd.txt);

  // 卡顿红线：本批代码（accounting.js）不得起任何常驻定时器。开页时应用自身会因输入框 focus
  // 起一条全局 250ms 监听（mobile-adapt 的 startAWatch，单例、与本批无关），故按来源归因而非绝对零。
  const perf = await page.evaluate(`(() => {
    var t0 = performance.now();
    for (var i = 0; i < 10; i++) { document.querySelector('.app[data-app="accounting"]').click(); }
    var ms = performance.now() - t0;
    var at = window.__ivAt.slice(${iv0});
    return { added: window.__ivs.length - ${iv0}, mine: at.filter(function (s) { return s.indexOf('accounting') >= 0; }).length,
      src: at.map(function (s) { return (s.match(/at ([\\w$<>]+) \\([^)]*?([\\w.-]+\\.js|index.html):(\\d+)/) || []).slice(2, 4).join(':'); }), ms: Math.round(ms) }; })()`);
  note('P1 记账本批零常驻定时器（开页 10 次，无一条 interval 出自 accounting.js）', perf.mine === 0, '新增=' + perf.added + ' 出自 accounting=' + perf.mine + ' 来源=' + JSON.stringify(perf.src));
  note('P2 连开 10 次记账页总耗时 < 400ms（无掉帧级重绘）', perf.ms < 400, 'ms=' + perf.ms);
  note('P-零 JS 报错', await page.evaluate(`(() => (window.__jsErrors || []).length === 0)()`),
    await page.evaluate(`(() => JSON.stringify(window.__jsErrors || []))()`));
  await ctx.close();
}

// ---------- 场景二：LS 空、IDB 有账、取回悬空 ⇒ 闸门必须拦下整包写盘（D1 / D8） ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const HIST = [R('h1', '餐饮', 20, d(0)), R('h2', '交通', 21, d(1))];
  // 取回钩子必须在加载前装好：gate 模式把每次 idbHydrateKey 的 promise 挂起排队，
  // 放行时才按真实实现落定（复刻真机「IDB 慢/事务挂起」的窗口，窗口长度由夹具说了算，零竞态）
  await page.addInitScript(`(() => {
    var real = null;
    window.__trap = { mode: 'gate', calls: 0, queue: [] };
    Object.defineProperty(window, 'idbHydrateKey', {
      configurable: true,
      get: function () {
        return function () {
          var args = arguments;
          window.__trap.calls++;
          if (window.__trap.mode === 'real') return real.apply(window, args);
          return new Promise(function (res) { window.__trap.queue.push(function () { res(real.apply(window, args)); }); });
        };
      },
      set: function (f) { real = f; }
    });
  })()`);
  await boot(page);
  note('B7-夹具：IDB 接口在位（取回钩子已接管、真实实现已被捕获）',
    await page.evaluate(`(() => typeof window.idbHydrateKey === 'function' && !!window.idbSet && !!window.idbGet)()`));
  // 历史账目【只写 IndexedDB】：裸 idbSet 不经 xyStore ⇒ LS 与内存缓存都没有它（remove 会连 IDB 一起删，故不用它）
  await page.evaluate(`(() => window.idbSet('${REC_KEY}', ${JSON.stringify(JSON.stringify(HIST))}))()`);
  note('B7-夹具：LS 侧确实没有账本键（现场＝大键没驻留，不是数据真没了）',
    await page.evaluate(`(() => localStorage.getItem('${REC_KEY}') === null)()`));

  await openAcc(page);
  await sleep(300);

  // 取回被挂起期间的一切断言都在同一次同步调用里做完（夹具不让它落定，不存在时间竞态）
  const pend = await page.evaluate(`(() => {
    var r = { calls: window.__trap.calls,
      list: (document.getElementById('acc-list').textContent || '').trim().slice(0, 40),
      empty: !!document.querySelector('#acc-list .acc-empty') };
    var a = document.getElementById('acc-amount'); a.value = '9.9';
    document.getElementById('acc-save').click();
    r.toast = (document.getElementById('cc-toast') || {}).textContent || '';
    r.ls = localStorage.getItem('${REC_KEY}');
    return r; })()`);
  note('B8-D8 取回未完时列表说「正在读取」而不是「还没有记录」',
    /正在读取|还在读取/.test(pend.list) && pend.empty === false, JSON.stringify(pend));
  note('B9-D1 权威值未确认时「记一笔」被拦下并给反馈', /还在读取/.test(pend.toast), JSON.stringify(pend));
  note('B10-D1 被拦下时账本键未被空数组覆盖（毁数路径关闭）', pend.ls === null, String(pend.ls));

  // 放行：挂起的取回按真实实现落定。此后【不再有任何交互】，历史必须由取回回调自己补渲出来
  const callsBefore = await page.evaluate(`(() => { window.__trap.mode = 'real'; var q = window.__trap.queue.splice(0); q.forEach(function (f) { f(); }); return window.__trap.calls; })()`);
  await sleep(900);
  const back = await page.evaluate(`(() => {
    var t = document.getElementById('acc-list').textContent || '';
    var a = document.getElementById('acc-amount'); a.value = '9.9';
    document.getElementById('acc-save').click();
    var after = JSON.parse(localStorage.getItem('${REC_KEY}') || '[]');
    return { histRows: (t.match(/备注h/g) || []).length, list: t.trim().slice(0, 40),
      n: after.length, ids: after.map(function (r) { return r.id; }).join(','), toast: (document.getElementById('cc-toast') || {}).textContent }; })()`);
  note('B11-D1 取回落定后历史账目自动补渲（零交互、不用重开应用）', back.histRows === 2, JSON.stringify(back));
  note('B12-D1 放行后记一笔是追加，历史两笔还在', back.n === 3 && /h1/.test(back.ids) && /h2/.test(back.ids), JSON.stringify(back));
  // 卡顿红线：取回只能由用户动作驱动，空闲期间不得有任何轮询式重试
  const idle0 = await page.evaluate(`(() => window.__trap.calls)()`);
  await sleep(3000);
  const idle1 = await page.evaluate(`(() => window.__trap.calls)()`);
  note('P3 取回有界无轮询（未确认期调用数有上限、空闲 3s 不再增长）',
    idle0 === idle1 && idle1 <= 12, 'idle前=' + idle0 + ' idle后=' + idle1 + ' 放行前=' + callsBefore);
  note('P4 全程零 JS 报错', await page.evaluate(`(() => (window.__jsErrors || []).length === 0)()`),
    await page.evaluate(`(() => JSON.stringify(window.__jsErrors || []))()`));
  await ctx.close();
}

srv.close();
await browser.close();
console.log('\n' + (failures.length ? '✗ ' + failures.length + ' 条失败\n  ' + failures.join('\n  ') : 'OK 记账 #819 真页面回归全过'));
process.exit(failures.length ? (process.env.MOCHI_EXPECT === 'red' ? 0 : 1) : 0);

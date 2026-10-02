// ===== 功能：记账（桌面第三页） =====
// 记录收支、分类管理、按月/周/年统计、按日分组列表、编辑、图表、分类排行、预算、搜索
// 数据 localStorage + IndexedDB 双写（键前缀 xy-home-v2:），纯本地无后端
// 启动时自动确保桌面第三页存在（首次），把记账图标露出来
// 数据兼容：键名 accounting-records/accounting-categories 永不变，旧记录经 migrateRecs 惰性补字段
(function () {
  var G = 'xy-home-v2';
  var store = window.activeStore();
  var page = document.getElementById('page-accounting');
  if (!store || !page) return;

  var KEY_REC = 'accounting-records';
  var KEY_CAT = 'accounting-categories';
  var KEY_BUDGET = 'accounting-budget';

  var DEF_CATS = {
    expense: ['餐饮', '交通', '购物', '娱乐', '医疗', '居住', '通讯', '其他'],
    income: ['工资', '兼职', '红包', '投资', '其他']
  };

  function loadRecs() { try { return JSON.parse(store.get(KEY_REC) || '[]'); } catch (e) { return []; } }
  // ===== 权威值闸门（防「拿空态覆盖历史」）FIX 2026-09-19 #819-D1 =====
  // 「此刻读不到键」有两种完全不同的含义：① 真没有（新装/新联系人）；② IndexedDB 还没回填完
  // （整体 restore 排队中）或这一键被 v3.14.x 的大键驻留预算挂起（只按需取回）。把 ② 当 ①
  // 的后果是：此刻 loadRecs() 得空数组 → 记一笔 → 整包写回 → 历史账目被覆盖。因此每个键先
  // 确认权威值（LS 有值 / idbHydrateKey 取回成功 / IDB 健康确认无此键）才允许整包写盘。
  var authSeen = {};
  var authTry = {};
  var hydrated = {};
  function hasVal(k) { try { return store.get(k) !== null; } catch (e) { return true; } }
  function authOk(k) { return !!authSeen[k] || hasVal(k); }
  function hydrate(k, onDone) {
    if (authOk(k)) { authSeen[k] = 1; return; }
    // 整体回填还没跑完时读 IDB，容易把「还没回填」读成「确实没有」——等就绪事件再来一轮
    if (window.mochiDataPending && window.mochiDataPending()) {
      if (window.mochiOnDataReady) { try { window.mochiOnDataReady(function () { hydrate(k, onDone); }); } catch (e) {} }
      return;
    }
    if (!window.idbHydrateKey) { authSeen[k] = 1; if (onDone) onDone(); return; }
    var myPrefix = window.activePrefix();
    authTry[k] = (authTry[k] || 0) + 1;
    hydrated[k] = 1;                                                 // 取回在途：这段时间的空态要说「正在读取」
    try {
      window.idbHydrateKey(myPrefix + ':' + k).then(function (r) {
        if (window.activePrefix() !== myPrefix) return;            // 切了桌面＝本轮作废，contact-switched 会重跑
        if (r === false) {                                         // 读失败/超时：保持可重试（这期间口径仍是「正在读取」）；连续两次仍失败则降级以本地现状为准（别把记账彻底锁死）
          if (authTry[k] >= 2) { delete hydrated[k]; authSeen[k] = 1; if (onDone) onDone(); }
          return;
        }
        delete hydrated[k];
        authSeen[k] = 1;                                           // true=取回成功；null=IDB 健康确认无此键（新联系人空库）
        try { if (k === KEY_REC) loadAll(); if (!page.hidden) render(); } catch (e2) {}
        if (onDone) onDone();
      })['catch'](function () { delete hydrated[k]; });
    } catch (e) { delete hydrated[k]; authSeen[k] = 1; }
  }
  function hydrateAll() { hydrate(KEY_REC); hydrate(KEY_CAT); hydrate(KEY_BUDGET); }
  // 空态口径（与 decision/divination/feed 同一原语）：数据还在回填中就说「正在读取」，
  // 不能说「本月没有支出」——账没丢，只是还没读上来。
  function dataPending() {
    if (window.mochiDataPending && window.mochiDataPending()) return true;
    return !!(hydrated[KEY_REC] || hydrated[KEY_CAT] || hydrated[KEY_BUDGET]);
  }
  // 写盘闸门：调用方（记一笔/删除/分类/预算）先问一句，不通过就当场给反馈，绝不静默丢这笔
  function writable(k) {
    if (authOk(k)) { authSeen[k] = 1; return true; }
    hydrate(k);
    return false;
  }
  function saveRecs(list) {
    if (!authOk(KEY_REC)) return;
    try {
      store.set(KEY_REC, JSON.stringify(list));
      try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + KEY_REC, JSON.stringify(list)); } catch (e2) {}
    } catch (e) {}
  }
  function loadCats() {
    try { var c = JSON.parse(store.get(KEY_CAT) || 'null'); if (c && c.expense && c.income) return c; } catch (e) {}
    return { expense: DEF_CATS.expense.slice(), income: DEF_CATS.income.slice() };
  }
  function saveCats(c) {
    if (!authOk(KEY_CAT)) return;
    try {
      store.set(KEY_CAT, JSON.stringify(c));
      try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + KEY_CAT, JSON.stringify(c)); } catch (e2) {}
    } catch (e) {}
  }
  function migrateCats(c) {
    // 迁移：移除默认分组「教育」（2026-08）
    if (c && Array.isArray(c.expense) && c.expense.indexOf('教育') >= 0) {
      c.expense = c.expense.filter(function (x) { return x !== '教育'; });
      return true;
    }
    return false;
  }
  function loadBudget() {
    try { var b = JSON.parse(store.get(KEY_BUDGET) || 'null'); if (b && typeof b === 'object') return b; } catch (e) {}
    return { expense: 0 };
  }
  function saveBudget(b) {
    if (!authOk(KEY_BUDGET)) return;
    try {
      store.set(KEY_BUDGET, JSON.stringify(b));
      try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + KEY_BUDGET, JSON.stringify(b)); } catch (e2) {}
    } catch (e) {}
  }
  // 启动回填不再按键 idbGet 直写 LS（旧实现分不清「还没回填」与「真没有」，且绕过 v3.14.x
  // 大键驻留预算）；统一交给状态初始化处的 hydrateAll()：确认到权威值之后才放行写盘与渲染。

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayStr() { return dayStr(new Date()); }
  function newId() { return Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36); }
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  // FIX 2026-09-19 #819-D6：金额口径单点收口——NaN/Infinity/负数/超上限一律收敛，杜绝 ¥Infinity 入账落盘
  var AMOUNT_MAX = 1e12;
  function safeAmount(v) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    if (!isFinite(n)) return 0;
    n = Math.abs(n);
    if (n > AMOUNT_MAX) n = AMOUNT_MAX;
    return Math.round(n * 100) / 100;
  }

  function migrateRecs(list) {
    migrateRecs.changed = false;
    if (!Array.isArray(list)) { migrateRecs.changed = true; return []; }
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') { list.splice(i, 1); i--; migrateRecs.changed = true; continue; }
      if (!r.id) { r.id = newId(); migrateRecs.changed = true; }
      if (r.type !== 'expense' && r.type !== 'income') { r.type = 'expense'; migrateRecs.changed = true; }
      var a = safeAmount(r.amount);
      if (a !== r.amount) { r.amount = a; migrateRecs.changed = true; }
      if (typeof r.category !== 'string' || !r.category) { r.category = String(r.category || '其他'); migrateRecs.changed = true; }
      if (typeof r.note !== 'string') { r.note = String(r.note || ''); migrateRecs.changed = true; }
      if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) { r.date = todayStr(); migrateRecs.changed = true; }
      if (typeof r.time !== 'number' || !isFinite(r.time)) { r.time = Date.now(); migrateRecs.changed = true; }
    }
    return list;
  }

  var recs = [], cats = null, budget = null;
  function loadAll() {
    recs = migrateRecs(loadRecs());
    if (migrateRecs.changed) saveRecs(recs);
    cats = loadCats();
    if (migrateCats(cats)) saveCats(cats);
    budget = loadBudget();
  }
  loadAll();
  hydrateAll();
  var now = new Date();
  var viewMode = 'month';
  var anchor = dayStr(now);
  var curType = 'expense';
  var curCat = '';
  var curFilter = 'all';
  var curRankCat = '';
  var searchKw = '';
  var editId = null;
  var editExtCat = '';

  function getRange() {
    var a = parseDay(anchor);
    var y = a.getFullYear(), m = a.getMonth(), d = a.getDate();
    if (viewMode === 'month') {
      return { start: dayStr(new Date(y, m, 1)), end: dayStr(new Date(y, m + 1, 0)), label: y + ' 年 ' + (m + 1) + ' 月' };
    }
    if (viewMode === 'week') {
      var wd = a.getDay();
      var monday = new Date(y, m, d - (wd === 0 ? 6 : wd - 1));
      var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      return { start: dayStr(monday), end: dayStr(sunday), label: (monday.getMonth() + 1) + '/' + monday.getDate() + ' - ' + (sunday.getMonth() + 1) + '/' + sunday.getDate() };
    }
    return { start: y + '-01-01', end: y + '-12-31', label: y + ' 年' };
  }
  function inRange(r, range) { return r.date >= range.start && r.date <= range.end; }
  function shiftAnchor(dir) {
    var a = parseDay(anchor);
    var y = a.getFullYear(), m = a.getMonth(), d = a.getDate();
    if (viewMode === 'month') {
      m += dir; if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      anchor = dayStr(new Date(y, m, 1));
    } else if (viewMode === 'week') {
      anchor = dayStr(new Date(y, m, d + dir * 7));
    } else {
      y += dir; anchor = dayStr(new Date(y, 0, 1));
    }
  }

  function fmt(n) {
    n = Math.round(n * 100) / 100;
    var s = Math.abs(n).toFixed(2);
    s = s.replace(/\.?0+$/, '');
    return (n < 0 ? '-' : '') + '¥' + s;
  }

  function renderOverview() {
    var range = getRange();
    var exp = 0, inc = 0;
    recs.forEach(function (r) {
      if (!inRange(r, range)) return;
      if (r.type === 'expense') exp += r.amount;
      else if (r.type === 'income') inc += r.amount;
    });
    var el;
    if ((el = document.getElementById('acc-ov-expense'))) el.textContent = fmt(exp);
    if ((el = document.getElementById('acc-ov-income'))) el.textContent = fmt(inc);
    if ((el = document.getElementById('acc-ov-balance'))) el.textContent = fmt(inc - exp);
    if ((el = document.getElementById('acc-month-txt'))) el.textContent = range.label;
    renderBudget(exp, range);
  }

  // FIX 2026-09-19 #819-D4：预算条文案跟着所看区间走（切到往期不再谎称「本月」）
  function renderBudget(exp, range) {
    var wrap = document.getElementById('acc-budget-wrap');
    if (!wrap) return;
    var limit = safeAmount(budget && budget.expense);
    if (!limit || viewMode !== 'month') { wrap.hidden = true; return; }
    wrap.hidden = false;
    var pct = limit > 0 ? Math.min(exp / limit, 1) : 0;
    var over = exp > limit;
    var bar = document.getElementById('acc-budget-bar');
    if (bar) { bar.style.width = (pct * 100) + '%'; bar.className = 'acc-budget-bar' + (over ? ' over' : ''); }
    var txt = document.getElementById('acc-budget-txt');
    if (txt) txt.textContent = (range ? range.label : '本月') + '预算 ' + fmt(limit) + ' / 已支 ' + fmt(exp) + (over ? ' · 超支 ' + fmt(exp - limit) : '');
  }

  function renderChart() {
    var range = getRange();
    var barSvg = document.getElementById('acc-chart-bar');
    var ringSvg = document.getElementById('acc-chart-ring');
    var ringCenter = document.getElementById('acc-chart-ring-center');
    if (!barSvg || !ringSvg) return;

    var buckets = [];
    if (viewMode === 'year') {
      for (var i = 0; i < 12; i++) buckets.push({ e: 0, i: 0 });
      var yr = String(parseDay(anchor).getFullYear());
      recs.forEach(function (r) {
        if (r.date.slice(0, 4) !== yr) return;
        var mi = +r.date.slice(5, 7) - 1;
        if (mi < 0 || mi > 11) return;
        if (r.type === 'expense') buckets[mi].e += r.amount;
        else buckets[mi].i += r.amount;
      });
    } else {
      var startD = parseDay(range.start), endD = parseDay(range.end);
      var days = Math.round((endD - startD) / 86400000) + 1;
      for (var j = 0; j < days; j++) buckets.push({ e: 0, i: 0 });
      recs.forEach(function (r) {
        if (!inRange(r, range)) return;
        var di = Math.round((parseDay(r.date) - startD) / 86400000);
        if (di < 0 || di >= days) return;
        if (r.type === 'expense') buckets[di].e += r.amount;
        else buckets[di].i += r.amount;
      });
    }
    var maxV = 0;
    buckets.forEach(function (b) { if (b.e > maxV) maxV = b.e; if (b.i > maxV) maxV = b.i; });
    if (maxV === 0) maxV = 1;
    var W = 300, H = 120, n = buckets.length;
    var gap = n > 1 ? 2 : 0;
    var bw = (W - gap * (n - 1)) / n;
    var barHtml = '';
    for (var k = 0; k < n; k++) {
      var eH = (buckets[k].e / maxV) * (H - 16);
      var iH = (buckets[k].i / maxV) * (H - 16);
      var x = k * (bw + gap);
      if (eH > 0) barHtml += '<rect x="' + x.toFixed(1) + '" y="' + (H - eH).toFixed(1) + '" width="' + (bw / 2).toFixed(1) + '" height="' + eH.toFixed(1) + '" fill="#e85a5a" rx="1"/>';
      if (iH > 0) barHtml += '<rect x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - iH).toFixed(1) + '" width="' + (bw / 2).toFixed(1) + '" height="' + iH.toFixed(1) + '" fill="#3aa86c" rx="1"/>';
    }
    barSvg.innerHTML = barHtml;

    var catMap = {};
    var totalExp = 0;
    recs.forEach(function (r) {
      if (!inRange(r, range) || r.type !== 'expense') return;
      catMap[r.category] = (catMap[r.category] || 0) + r.amount;
      totalExp += r.amount;
    });
    var ringColors = ['#e85a5a', '#f5a623', '#4a90e2', '#7ed321', '#9013fe', '#bd10e0', '#50e3c2', '#f8e71c', '#b8e986', '#9b9b9b'];
    var cx = 60, cy = 60, R = 46, r0 = 30;
    function pt(rr, a) { return (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1); }
    function ringSeg(a0, a1, col) {
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      return '<path d="M' + pt(R, a0) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + pt(R, a1) +
        ' L' + pt(r0, a1) + ' A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + pt(r0, a0) + ' Z" fill="' + col + '"/>';
    }
    var ringHtml = '';
    if (totalExp > 0) {
      var catsArr = Object.keys(catMap).sort(function (a, b) { return catMap[b] - catMap[a]; });
      var acc = 0;
      catsArr.forEach(function (c, idx) {
        var v = catMap[c];
        var a0 = acc / totalExp * Math.PI * 2 - Math.PI / 2;
        acc += v;
        var a1 = acc / totalExp * Math.PI * 2 - Math.PI / 2;
        var col = ringColors[idx % ringColors.length];
        // FIX 2026-09-19 #819-D7：张角逼近整圆时起止点重合，一条弧画不出来（实测＝只记过一类时整个环是空的），拆两段半圆
        if (a1 - a0 >= Math.PI * 1.999) {
          var mid = a0 + Math.PI;
          ringHtml += ringSeg(a0, mid, col) + ringSeg(mid, a1 - 0.0001, col);
        } else {
          ringHtml += ringSeg(a0, a1, col);
        }
      });
    }
    ringSvg.innerHTML = ringHtml;
    if (ringCenter) ringCenter.innerHTML = totalExp > 0 ? '<div class="acc-ring-val">' + fmt(totalExp) + '</div><div class="acc-ring-lbl">总支出</div>' : '<div class="acc-ring-lbl">' + (dataPending() ? loadingTxt() : '无支出') + '</div>';
  }

  function renderRank() {
    var box = document.getElementById('acc-rank-list');
    var card = document.getElementById('acc-rank-card');
    if (!box || !card) return;
    var range = getRange();
    var catMap = {};
    var total = 0;
    recs.forEach(function (r) {
      if (!inRange(r, range) || r.type !== 'expense') return;
      catMap[r.category] = (catMap[r.category] || 0) + r.amount;
      total += r.amount;
    });
    var arr = Object.keys(catMap).map(function (c) { return { cat: c, amt: catMap[c] }; }).sort(function (a, b) { return b.amt - a.amt; });
    var titleEl = card.querySelector('.acc-rank-title');
    var rangeLbl = viewMode === 'month' ? '本月' : (viewMode === 'week' ? '本周' : '本年');
    if (titleEl) titleEl.textContent = '分类排行（' + rangeLbl + '支出）';
    if (!arr.length) { box.innerHTML = dataPending() ? loadingHtml('记账') : '<div class="acc-empty">' + rangeLbl + '无支出</div>'; return; }
    var html = '';
    arr.slice(0, 8).forEach(function (it) {
      var pct = total > 0 ? (it.amt / total * 100) : 0;
      var sel = it.cat === curRankCat ? ' sel' : '';
      html += '<div class="acc-rank-item' + sel + '" data-cat="' + esc(it.cat) + '">';
      html += '<div class="acc-rank-info"><span class="acc-rank-cat">' + esc(it.cat) + '</span><span class="acc-rank-amt">' + fmt(it.amt) + '</span></div>';
      html += '<div class="acc-rank-bar-wrap"><div class="acc-rank-bar" style="width:' + pct.toFixed(1) + '%"></div></div>';
      html += '<div class="acc-rank-pct">' + pct.toFixed(1) + '%</div>';
      html += '</div>';
    });
    box.innerHTML = html;
  }

  function renderCatGrid() {
    var grid = document.getElementById('acc-cat-grid');
    if (!grid) return;
    var list = (cats && cats[curType]) || [];
    // 编辑一条旧记录时，它的分类可能已被「分类管理」删掉：这里必须保留那一格，
    // 否则会被静默改选成列表第一项，点保存等于把这笔账挪到别的分类名下。
    // FIX 2026-09-19 #819-D2：编辑中的账目其分类已被移出分类表时，把原分类临时挂回并标「（已停用）」，
    // 否则下拉里没有它、保存会把分类静默改成列表首项
    editExtCat = '';
    if (editId && curCat && list.indexOf(curCat) < 0) {
      list = list.concat([curCat]);
      editExtCat = curCat;
    }
    if (curCat && list.indexOf(curCat) < 0) curCat = '';
    if (!curCat && list.length) curCat = list[0];
    grid.innerHTML = '';
    list.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'acc-cat' + (c === curCat ? ' sel' : '');
      b.textContent = c + (c === editExtCat ? '（已停用）' : '');
      b.setAttribute('data-cat', c);
      b.addEventListener('click', function () { curCat = c; editExtCat = ''; renderCatGrid(); });
      grid.appendChild(b);
    });
  }

  function renderList() {
    var box = document.getElementById('acc-list');
    if (!box) return;
    var filtered;
    var searching = searchKw && searchKw.trim().length > 0;
    if (searching) {
      var kw = searchKw.trim().toLowerCase();
      filtered = recs.filter(function (r) {
        if (curFilter !== 'all' && r.type !== curFilter) return false;
        if (curRankCat && r.category !== curRankCat) return false;
        if (r.note && r.note.toLowerCase().indexOf(kw) >= 0) return true;
        if (r.category && r.category.toLowerCase().indexOf(kw) >= 0) return true;
        if (String(r.amount).indexOf(kw) >= 0) return true;
        if (fmt(r.amount).indexOf(kw) >= 0) return true;
        // FIX 2026-09-19 #819-D5：搜索按「全部账目」口径（含日期片段），结果顶部另给范围说明
        if (r.date.indexOf(kw) >= 0) return true;               // 按日期搜：'2026-09-19' / '09-19' 都能命中
        return false;
      });
    } else {
      var range = getRange();
      filtered = recs.filter(function (r) {
        if (!inRange(r, range)) return false;
        if (curFilter !== 'all' && r.type !== curFilter) return false;
        if (curRankCat && r.category !== curRankCat) return false;
        return true;
      });
    }
    if (!filtered.length) {
      box.innerHTML = (!searching && dataPending()) ? loadingHtml('记账')
        : '<div class="acc-empty">' + (searching ? '没有匹配的记录（搜索的是全部账目）' : (curRankCat ? '该分类下没有记录' : '本区间还没有记录，点上方「记一笔」开始')) + '</div>';
      return;
    }
    var groups = {};
    filtered.forEach(function (r) {
      if (!groups[r.date]) groups[r.date] = [];
      groups[r.date].push(r);
    });
    var dates = Object.keys(groups).sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    var html = '';
    if (searching) html += '<div class="acc-search-tip">搜索全部账目 · 共 ' + filtered.length + ' 条</div>';
    var today = todayStr();
    dates.forEach(function (d) {
      var items = groups[d].sort(function (a, b) { return b.time - a.time; });
      var dayExp = 0, dayInc = 0;
      items.forEach(function (r) {
        if (r.type === 'expense') dayExp += r.amount;
        else dayInc += r.amount;
      });
      var dt = parseDay(d);
      var label = (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日 · 周' + WEEK[dt.getDay()];
      if (d === today) label += ' · 今天';
      html += '<div class="acc-day">';
      html += '<div class="acc-day-head"><span class="acc-day-date">' + label + '</span>';
      if (dayExp) html += '<span class="acc-day-sum expense">' + fmt(dayExp) + '</span>';
      if (dayInc) html += '<span class="acc-day-sum income">' + fmt(dayInc) + '</span>';
      html += '</div>';
      items.forEach(function (r) {
        var amt = (r.type === 'expense' ? '-' : '+') + fmt(r.amount).replace(/^-/, '');
        var editing = r.id === editId ? ' editing' : '';
        html += '<div class="acc-row' + editing + '" data-id="' + r.id + '">';
        html += '<div class="acc-row-info"><div class="acc-row-cat">' + esc(r.category) + '</div>';
        html += '<div class="acc-row-note">' + esc(r.note || '无备注') + '</div></div>';
        html += '<span class="acc-row-amount ' + r.type + '">' + amt + '</span>';
        html += '<button class="acc-row-del" data-id="' + r.id + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
        html += '</div>';
      });
      html += '</div>';
    });
    box.innerHTML = html;
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // FIX 2026-09-19 #819-D8：读取中的列表态（「没回填」不能说成「还没有」）——复用全局原语（同 decision/feed/divination），原语缺席时退回同款文案
  function loadingHtml(what) {
    if (window.mochiLoadingHtml) { try { return window.mochiLoadingHtml(what); } catch (e) {} }
    return '<div class="acc-empty">' + loadingTxt() + '</div>';
  }
  function loadingTxt() {
    if (window.mochiLoadingText) { try { return window.mochiLoadingText(); } catch (e) {} }
    return '正在读取…';
  }

  function render() {
    loadAll();
    renderOverview();
    renderChart();
    renderRank();
    renderCatGrid();
    renderList();
    // 每次进页面/渲染都补一次权威值确认（已确认的键在这里只是一次内存判断，零开销）
    hydrateAll();
  }

  function startEdit(id) {
    var r = recs.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    editId = id;
    curType = r.type;
    curCat = r.category;
    var amountEl = document.getElementById('acc-amount');
    var noteEl = document.getElementById('acc-note');
    var dateEl = document.getElementById('acc-date');
    var typeTabs = document.getElementById('acc-type-tabs');
    if (amountEl) amountEl.value = r.amount;
    if (noteEl) noteEl.value = r.note || '';
    if (dateEl) dateEl.value = r.date;
    if (typeTabs) typeTabs.querySelectorAll('.acc-type-tab').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-type') === r.type); });
    var titleEl = document.getElementById('acc-form-title');
    var cancelBtn = document.getElementById('acc-cancel');
    var saveBtn = document.getElementById('acc-save');
    if (titleEl) titleEl.textContent = '编辑记录';
    if (cancelBtn) cancelBtn.hidden = false;
    if (saveBtn) saveBtn.textContent = '保存';
    renderCatGrid();
    renderList();
    var card = document.getElementById('acc-form-card');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (amountEl) amountEl.focus();
  }
  function cancelEdit() {
    editId = null;
    var amountEl = document.getElementById('acc-amount');
    var noteEl = document.getElementById('acc-note');
    if (amountEl) amountEl.value = '';
    if (noteEl) noteEl.value = '';
    var titleEl = document.getElementById('acc-form-title');
    var cancelBtn = document.getElementById('acc-cancel');
    var saveBtn = document.getElementById('acc-save');
    if (titleEl) titleEl.textContent = '记一笔';
    if (cancelBtn) cancelBtn.hidden = true;
    if (saveBtn) saveBtn.textContent = '记一笔';
    editExtCat = '';
    renderCatGrid();
    renderList();
  }

  function saveOne() {
    var amountEl = document.getElementById('acc-amount');
    var noteEl = document.getElementById('acc-note');
    var dateEl = document.getElementById('acc-date');
    if (!amountEl) return;
    if (!writable(KEY_REC)) { toast('账目还在读取，稍等一下再记'); return; }
    var raw = parseFloat(amountEl.value);
    if (!isFinite(raw) || raw <= 0) { toast('请输入有效金额'); amountEl.focus(); return; }
    if (raw > AMOUNT_MAX) { toast('金额太大了，请分项记录'); amountEl.focus(); return; }
    var amount = safeAmount(raw);
    var note = (noteEl ? noteEl.value : '').trim();
    var date = dateEl && dateEl.value ? dateEl.value : todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = todayStr();
    if (!curCat) curCat = (cats[curType] && cats[curType][0]) || '其他';
    var list = migrateRecs(loadRecs());
    if (migrateRecs.changed) saveRecs(list);
    if (editId) {
      var found = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === editId) {
          list[i].type = curType; list[i].amount = amount; list[i].category = curCat; list[i].note = note; list[i].date = date;
          found = true; break;
        }
      }
      if (!found) { toast('原记录已不存在'); cancelEdit(); return; }
      saveRecs(list);
      recs = list;
      toast('已更新');
      cancelEdit();
    } else {
      var rec = { id: newId(), type: curType, amount: amount, category: curCat, note: note, date: date, time: Date.now() };
      list.push(rec);
      saveRecs(list);
      recs = list;
      amountEl.value = '';
      if (noteEl) noteEl.value = '';
      toast('已记 ' + (curType === 'expense' ? '支出 ' : '收入 ') + fmt(amount));
    }
    renderOverview();
    renderChart();
    renderRank();
    renderList();
  }

  function delOne(id) {
    if (!window.openModal) { doDel(id); return; }
    var rec = recs.filter(function (r) { return r.id === id; })[0];
    var txt = rec ? (rec.type === 'expense' ? '支出 ' : '收入 ') + fmt(rec.amount) + ' · ' + rec.category + (rec.note ? ' · ' + rec.note : '') : '这条记录';
    window.openModal('删除这条记录？', '', function (v) { if (v === 'ok') doDel(id); }, { noInput: true, staticText: txt });
  }
  function doDel(id) {
    if (!writable(KEY_REC)) { toast('账目还在读取，稍等一下再删'); return; }
    var list = loadRecs().filter(function (r) { return r.id !== id; });
    saveRecs(list);
    recs = list;
    if (editId === id) cancelEdit();
    renderOverview();
    renderChart();
    renderRank();
    renderList();
    toast('已删除');
  }

  function setBudget() {
    if (!window.openModal) return;
    if (!writable(KEY_BUDGET)) { toast('预算还在读取，稍等一下再改'); return; }
    var cur = budget && budget.expense ? budget.expense : '';
    window.openModal('设置月度支出预算', String(cur), function (v) {
      if (v === null || v === undefined) return;
      if (v === '') { budget = { expense: 0 }; saveBudget(budget); toast('已清除预算'); renderOverview(); return; }
      var n = parseFloat(v);
      if (!isFinite(n) || n < 0 || n > AMOUNT_MAX) { toast('请输入有效金额'); return; }
      budget = { expense: safeAmount(n) };
      saveBudget(budget);
      toast('预算已设为 ' + fmt(budget.expense));
      renderOverview();
    });
  }

  function manageCats() {
    if (!window.openModal) return;
    // v3.13.x：单弹窗两阶段重构（ctl.stay 就地切换）——取代旧「60ms 再开第二层」
    // 嵌套写法。真机键盘收起/再聚焦竞态会让嵌套的第二层无法输入（与红包/市集
    // 钱包弹窗同族问题）；现在加/删都在同一个弹窗里完成。
    var phase = 1, action = '', delType = '';
    function typeName(t) { return t === 'expense' ? '支出' : '收入'; }
    const ctl = window.openModal('分类管理', '', function (v) {
      if (phase === 1) {
        if (!v) return;
        action = v;
        if (v.indexOf('add:') === 0) {
          var type = v.slice(4);
          phase = 2;
          ctl.stay();
          ctl.title('添加' + typeName(type) + '分类');
          ctl.pills(null);
          ctl.input(true);
          ctl.maxLen(8);
          ctl.ph('新分类名，如：宠物');
          ctl.okText('添加');
        } else {
          var type2 = v.slice(4);
          delType = type2;
          var cs = loadCats()[type2] || [];
          if (!cs.length) { toast('没有可删除的分类'); return; }
          phase = 2;
          ctl.stay();
          ctl.title('选择要删除的' + typeName(type2) + '分类');
          ctl.input(false);
          ctl.pills(cs.map(function (c) { return { label: c, value: c }; }));
          ctl.okText('删除');
        }
        return;
      }
      // 阶段二：v = 输入的分类名（加）或点中的分类胶囊值（删）
      if (action.indexOf('add:') === 0) {
        if (!writable(KEY_CAT)) { toast('分类还在读取，稍等一下再改'); return; }
        var name = String(v == null ? '' : v).trim();
        if (!name) return;
        var typeA = action.slice(4);
        var c1 = loadCats();
        if (!Array.isArray(c1[typeA])) c1[typeA] = [];
        if (c1[typeA].indexOf(name) >= 0) { toast('该分类已存在'); return; }
        c1[typeA].push(name);
        saveCats(c1);
        cats = c1;
        renderCatGrid();
        toast('已添加「' + name + '」');
      } else {
        if (!v) return;
        if (!writable(KEY_CAT)) { toast('分类还在读取，稍等一下再改'); return; }
        var c3 = loadCats();
        if (!Array.isArray(c3[delType])) { toast('没有可删除的分类'); return; }
        var i = c3[delType].indexOf(v);
        if (i < 0) { toast('分类不存在'); return; }
        // FIX 2026-09-19 #819-D3：至少留一个——删空后分类栏是空的，记一笔会落到不存在的分类上
        if (c3[delType].length <= 1) { toast('至少保留一个' + typeName(delType) + '分类'); return; }
        var used = loadRecs().some(function (r) { return r.type === delType && r.category === v; });
        if (used) { toast('「' + v + '」下有记录，无法删除'); return; }
        c3[delType].splice(i, 1);
        saveCats(c3);
        cats = c3;
        if (curType === delType && curCat === v) curCat = '';
        renderCatGrid();
        toast('已删除「' + v + '」');
      }
    }, {
      noInput: true,
      pills: [
        { label: '添加支出分类', value: 'add:expense' },
        { label: '添加收入分类', value: 'add:income' },
        { label: '删除支出分类', value: 'del:expense' },
        { label: '删除收入分类', value: 'del:income' }
      ]
    });
  }

  function toast(msg) {
    var t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2000);
  }

  var app = document.querySelector('.app[data-app="accounting"]');
  if (app && page) {
    app.addEventListener('click', function () {
      var editing = Array.from(document.querySelectorAll('.app-grid')).some(function (g) { return g.classList.contains('editing'); });
      if (editing) return;
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      page.hidden = false;
      var d = new Date();
      viewMode = 'month';
      anchor = dayStr(d);
      curType = 'expense'; curCat = ''; curFilter = 'all'; curRankCat = ''; searchKw = '';
      var de = document.getElementById('acc-date');
      if (de) de.value = todayStr();
      var se = document.getElementById('acc-search');
      if (se) se.value = '';
      cancelEdit();
      render();
    });
  }
  var back = document.getElementById('acc-back');
  if (back) back.addEventListener('click', function () {
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
    var home = document.getElementById('page-phone');
    if (home) home.hidden = false;
  });
  var prevBtn = document.getElementById('acc-prev');
  if (prevBtn) prevBtn.addEventListener('click', function () { shiftAnchor(-1); renderOverview(); renderChart(); renderRank(); renderList(); });
  var nextBtn = document.getElementById('acc-next');
  if (nextBtn) nextBtn.addEventListener('click', function () { shiftAnchor(1); renderOverview(); renderChart(); renderRank(); renderList(); });

  var viewTabs = document.getElementById('acc-view-tabs');
  if (viewTabs) viewTabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.acc-view-tab');
    if (!btn) return;
    viewMode = btn.getAttribute('data-view');
    viewTabs.querySelectorAll('.acc-view-tab').forEach(function (b) { b.classList.toggle('sel', b === btn); });
    curRankCat = '';
    renderOverview(); renderChart(); renderRank(); renderList();
  });

  var typeTabs = document.getElementById('acc-type-tabs');
  if (typeTabs) typeTabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.acc-type-tab');
    if (!btn) return;
    curType = btn.getAttribute('data-type');
    curCat = '';
    typeTabs.querySelectorAll('.acc-type-tab').forEach(function (b) { b.classList.toggle('sel', b === btn); });
    renderCatGrid();
  });

  var filterTabs = document.getElementById('acc-filter-tabs');
  if (filterTabs) filterTabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.acc-filter-tab');
    if (!btn) return;
    curFilter = btn.getAttribute('data-filter');
    filterTabs.querySelectorAll('.acc-filter-tab').forEach(function (b) { b.classList.toggle('sel', b === btn); });
    renderList();
  });

  var searchEl = document.getElementById('acc-search');
  if (searchEl) searchEl.addEventListener('input', function () {
    searchKw = searchEl.value || '';
    renderList();
  });

  var saveBtn = document.getElementById('acc-save');
  if (saveBtn) saveBtn.addEventListener('click', saveOne);

  var cancelBtn = document.getElementById('acc-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', cancelEdit);

  var listEl = document.getElementById('acc-list');
  if (listEl) listEl.addEventListener('click', function (e) {
    var del = e.target.closest('.acc-row-del');
    if (del) { delOne(del.getAttribute('data-id')); return; }
    var row = e.target.closest('.acc-row');
    if (row) startEdit(row.getAttribute('data-id'));
  });

  var rankEl = document.getElementById('acc-rank-list');
  if (rankEl) rankEl.addEventListener('click', function (e) {
    var item = e.target.closest('.acc-rank-item');
    if (!item) return;
    var cat = item.getAttribute('data-cat');
    curRankCat = (curRankCat === cat) ? '' : cat;
    curFilter = 'expense';
    var ft = document.getElementById('acc-filter-tabs');
    if (ft) ft.querySelectorAll('.acc-filter-tab').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-filter') === 'expense'); });
    renderRank();
    renderList();
  });

  var cog = document.getElementById('acc-cog');
  if (cog) cog.addEventListener('click', manageCats);

  var budgetSetBtn = document.getElementById('acc-budget-set');
  if (budgetSetBtn) budgetSetBtn.addEventListener('click', setBudget);

  // ===== TA 记账提醒：TA 每天有概率在聊天里发一条提醒记账的字卡 =====
  // 默认关闭（acc-remind-on 不存在即关闭），要在记账页设置行里手动开启。
  // 三个键都随桌面命名空间隔离（每个联系人单独设）。投递用 window.chatAddIn：
  // 掷骰与投递在同一个同步调用里完成，读的就是当时那个桌面的键，不存在延迟串台窗口。
  var KEY_RM_ON = 'acc-remind-on';
  var KEY_RM_PROB = 'acc-remind-prob';
  var KEY_RM_DAY = 'acc-remind-day';
  var RM_PROB_DEF = 30;
  var RM_MSGS = [
    '今天的账还没记呢，记一笔好不好',
    '今天花了些什么呀？记下来我才知道你的一天',
    '来记账啦，我帮你看着小账本',
    '先把今天的记了嘛，晚点就忘啦',
    '记账时间到～今天也辛苦了',
    '今天的收支记一笔嘛，我们一起攒着'
  ];
  function rmOn() { try { return store.get(KEY_RM_ON) === '1'; } catch (e) { return false; } }
  function rmProb() {
    var n; try { n = parseInt(store.get(KEY_RM_PROB), 10); } catch (e) {}
    return (typeof n === 'number' && isFinite(n)) ? Math.max(0, Math.min(100, n)) : RM_PROB_DEF;
  }
  function rmRecordedToday() {
    var today = todayStr();
    var list = loadRecs();
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].date === today) return true; }
    return false;
  }
  function rmSend() {
    var text = RM_MSGS[Math.floor(Math.random() * RM_MSGS.length)];
    if (window.taFit) { try { text = window.taFit(text); } catch (e) {} }
    try {
      if (!window.chatAddIn) return false;
      window.chatAddIn(text, { tag: '记账提醒' });
      return true;
    } catch (e) { return false; }
  }
  // 每天只掷一次骰 ⇒ 「每天概率」就是字面日概率（不会因每 5 分钟掷一次而叠加成天天发）；
  // 当天已经记过账不再催；23:00-09:00 静默；数据未回填时读不到「今天记过没有」，先不掷；
  // 命中但投递没成功（chatAddIn 尚未就绪或抛错）留待下一次 tick 补投，补投同样只在静默期外。
  function rmTick() {
    try {
      if (!rmOn() || !window.__mochiDataReady || document.hidden) return;
      var h = new Date().getHours();
      if (h < 9 || h >= 23) return;
      var ae = document.activeElement;
      if (ae && ae.isContentEditable) return;
      var today = todayStr();
      var st = null;
      try { st = JSON.parse(store.get(KEY_RM_DAY) || 'null'); } catch (e) {}
      if (!st || st.date !== today) st = { date: today, hit: 0, done: 0 };
      if (st.done) return;
      if (!st.hit) {
        st.hit = 1;
        if (rmRecordedToday()) { store.set(KEY_RM_DAY, JSON.stringify({ date: today, hit: 1, done: 1 })); return; }
        if (Math.random() * 100 >= rmProb()) { store.set(KEY_RM_DAY, JSON.stringify({ date: today, hit: 1, done: 1 })); return; }
        store.set(KEY_RM_DAY, JSON.stringify(st));
      }
      if (rmSend()) { st.done = 1; store.set(KEY_RM_DAY, JSON.stringify(st)); }
    } catch (e) {}
  }
  window.accRemindTick = rmTick;
  setTimeout(rmTick, 60 * 1000);
  setInterval(rmTick, 5 * 60 * 1000);

  var rmRow = null;
  function rmRowEl() {
    if (rmRow && rmRow.parentNode) return rmRow;
    var scroll = page.querySelector('.acc-scroll');
    if (!scroll) return null;
    rmRow = document.createElement('div');
    rmRow.className = 'acc-remind glass';
    rmRow.id = 'acc-remind-row';
    rmRow.innerHTML = '<div class="acc-remind-main"><div class="acc-remind-title">TA 记账提醒</div>' +
      '<div class="acc-remind-sub" id="acc-remind-sub"></div></div>' +
      '<div class="acc-remind-badge" id="acc-remind-badge"></div>';
    var ov = scroll.querySelector('.acc-overview');
    if (ov && ov.nextSibling) scroll.insertBefore(rmRow, ov.nextSibling);
    else scroll.appendChild(rmRow);
    rmRow.addEventListener('click', rmSettings);
    return rmRow;
  }
  function rmSyncRow() {
    var el = rmRowEl();
    if (!el) return;
    var on = rmOn();
    var s = document.getElementById('acc-remind-sub');
    var b = document.getElementById('acc-remind-badge');
    if (s) s.textContent = on ? 'TA 每天有概率在聊天里提醒你记账（今天记过就不再催）' : '默认关闭 · 点击开启';
    if (b) { b.textContent = on ? '已开启 · ' + rmProb() + '%' : '已关闭'; b.className = 'acc-remind-badge' + (on ? ' on' : ''); }
  }
  function rmPills() {
    return [
      { label: rmOn() ? '关闭提醒' : '开启提醒', value: 'toggle' },
      { label: '每天概率 ' + rmProb() + '%', value: 'prob' }
    ];
  }
  function rmHint() {
    return rmOn()
      ? '已开启：白天（9:00-23:00）每天掷一次骰，命中时 TA 在聊天里发一条带「记账提醒」标签的字卡；每个联系人单独设，当天最多 1 条。'
      : '当前关闭：TA 不会主动提醒记账。开启后按下面的概率每天判定一次，今天已经记过账就不催。';
  }
  // 单弹窗两阶段（与 manageCats 同写法）：改概率在同一个弹窗里就地换输入框，
  // 不开第二层——嵌套弹窗在安卓上会撞键盘收起/再聚焦竞态（见 manageCats 注释）。
  function rmSettings() {
    if (!window.openModal) return;
    var phase = 1;
    const ctl = window.openModal('TA 记账提醒', '', function (v) {
      if (phase === 1) {
        if (v === 'toggle') {
          try { store.set(KEY_RM_ON, rmOn() ? '0' : '1'); } catch (e) {}
          ctl.stay();
          ctl.pills(rmPills());
          ctl.hint(rmHint());
          rmSyncRow();
          toast(rmOn() ? '已开启 TA 记账提醒' : '已关闭 TA 记账提醒');
        } else if (v === 'prob') {
          phase = 2;
          ctl.stay();
          ctl.title('每天提醒概率（0-100%）');
          ctl.hint('每天最多提醒 1 条；关掉提醒即完全不发。');
          ctl.pills(null);
          ctl.input(true);
          ctl.text(String(rmProb()));
          ctl.maxLen(3);
          ctl.ph('例如 30');
          ctl.okText('保存');
        }
        return;
      }
      var n = parseFloat(String(v == null ? '' : v).trim());
      if (!isFinite(n)) { ctl.stay(); ctl.hint('请输入 0-100 的数字'); return; }
      n = Math.max(0, Math.min(100, Math.round(n)));
      try { store.set(KEY_RM_PROB, String(n)); } catch (e) {}
      rmSyncRow();
      toast('记账提醒概率已设为 ' + n + '%');
    }, { noInput: true, staticText: rmHint(), pills: rmPills() });
  }
  rmSyncRow();
  document.addEventListener('contact-switched', rmSyncRow);

  // FIX 2026-09-19 #819-D9：换桌面/导入备份都会作废「权威值已确认」结论，必须重读重渲（旧版要切页才见新数据）
  function resetAuth() { authSeen = {}; authTry = {}; hydrated = {}; }

  document.addEventListener('contact-switched', function () {
    try {
      resetAuth();
      loadAll();
      editId = null; curRankCat = ''; editExtCat = '';
      if (!page.hidden) render(); else hydrateAll();
    } catch (e) {}
    setTimeout(ensureP3, 200);
  });

  // 导入备份会整包替换 localStorage：本模块此刻缓存的 recs/cats/budget、以及「哪些键已确认」
  // 全是导入前的过期值。不重读的话，用户在导入后记一笔就会把旧账整包写回去。
  document.addEventListener('mochi-restore-done', function () {
    try {
      resetAuth();
      loadAll();
      editId = null;
      if (!page.hidden) render(); else hydrateAll();
      rmSyncRow();
    } catch (e) {}
  });

  function ensureP3() {
    var box = document.getElementById('desktop-pages');
    var p3 = document.querySelector('[data-desk-widget="p3apps"]');
    if (!box || !p3) return;
    if (p3.closest && p3.closest('.page-slide') && !p3.closest('#desk-widget-pool')) return;
    try {
      var s = window.activeStore();
      var n = parseInt(s.get('desk-page-count'), 10);
      if (isNaN(n) || n < 3) s.set('desk-page-count', '3');
    } catch (e) {}
    var slides = box.querySelectorAll('.page-slide');
    var third;
    if (slides.length >= 3) {
      third = slides[2];
    } else {
      third = document.createElement('div');
      third.className = 'page-slide desk-page third';
      third.setAttribute('data-desk', '2');
      box.appendChild(third);
    }
    var hint = third.querySelector('.desk-page-hint');
    var addBtn = third.querySelector('.desk-page-add');
    if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
    if (addBtn && addBtn.parentNode) addBtn.parentNode.removeChild(addBtn);
    third.appendChild(p3);
    if (window.deskRebuild) window.deskRebuild();
  }
  window.ensureP3 = ensureP3;
  if (window.__mochiDataReady) ensureP3();
  else {
    try {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        ensureP3();
      });
    } catch (e) { ensureP3(); }
  }
})();

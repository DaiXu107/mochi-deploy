/* ===== 记录汇总（只读聚合） =====
   2026-11-22 作者定稿：聊天「更多功能 → 互动 → 记录」打开。
   设计口径（按作者要求「别太冗杂」）：
   · 一屏 8 行，一行一个来源，不重复、不分组标题；
   · 一行 = 图标 + 名称 + 一句关键值 + 时间，重要数字加粗；
   · **本页只读**：不写任何数据，点一行直接进对应功能的原页面；
   · 任何来源读不到就整行不显示（不摆「暂无」占位、不编数据）。
   数据全部从现有键现算，不新增存储键 → 导出/备份/清空天然兼容。
*/
(function () {
  'use strict';
  var G = 'xy-home-v2';
  var ROWS = [
    { k: 'period',     name: '经期',  icon: '🌸', cls: 'period', app: 'period',     page: 'page-period',     tone: 'period' },
    { k: 'memory',     name: '纪念',  icon: '🎉', cls: 'mem',    app: 'memory',     page: 'page-memory',     tone: 'mem' },
    { k: 'mood',       name: '心情',  icon: '☁️', cls: 'mood',   app: '',           page: 'page-mood',       tone: 'mood' },
    { k: 'accounting', name: '账本',  icon: '🧾', cls: 'money',  app: 'accounting', page: 'page-accounting', tone: 'money' },
    { k: 'calendar',   name: '留言',  icon: '💬', cls: '',       app: 'calendar',   page: 'page-calendar',   tone: '' },
    { k: 'ask',        name: '提问',  icon: '❓', cls: 'ask',    app: 'interact',   page: 'page-interact',   tone: 'ask' },
    { k: 'chat',       name: '聊天',  icon: '📊', cls: '',       app: 'stats',      page: 'page-stats',      tone: '' },
    { k: 'arc',        name: '档案',  icon: '🗂', cls: 'arc',    app: 'memo-arc',   page: 'page-memo-arc',   tone: 'arc' }
  ];

  function store() { try { return window.activeStore(); } catch (e) { return null; } }
  function g(k) { try { var s = store(); return s ? s.get(k) : null; } catch (e) { return null; } }
  function j(k, d) { try { var v = g(k); if (v === null || v === undefined || v === '') return d; return JSON.parse(v); } catch (e) { return d; } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ds(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ds(new Date()); }
  function daysBetween(a, b) {
    try { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); } catch (e) { return 0; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function bold(s) { return '<b>' + esc(s) + '</b>'; }
  function hm(ts) {
    try { var d = new Date(Number(ts) || 0); return pad(d.getHours()) + ':' + pad(d.getMinutes()); } catch (e) { return ''; }
  }

  // ---------- 各来源的「一行摘要」 ----------
  function readPeriod() {
    var p = window.__periodProbe;
    if (!p || typeof p.status !== 'function') return null;
    var st = null;
    try { st = p.status(); } catch (e) { return null; }
    if (!st || !st.title) return null;
    if (st.phase === 'unknown') return null;
    return { text: esc(st.title), time: '', hot: !!st.delayed || !!st.inPeriod };
  }
  function readMemory() {
    var start = g('love-start');
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(String(start))) return null;
    var n = daysBetween(String(start), today()) + 1;
    if (!(n > 0)) return null;
    var extras = j('mem-extras', []);
    var tail = '';
    if (Array.isArray(extras) && extras.length) {
      var soon = null;
      extras.forEach(function (it) {
        if (!it || !it.date) return;
        var d = daysBetween(today(), String(it.date));
        if (d >= 0 && (!soon || d < soon.d)) soon = { d: d, name: it.name || '纪念日' };
      });
      if (soon && soon.d <= 60) tail = ' · ' + (soon.d === 0 ? '今天就是' + soon.name : soon.name + '还有 ' + soon.d + ' 天');
    }
    return { text: '已相伴 ' + bold(n) + ' 天' + esc(tail), time: '' };
  }
  function readMood() {
    var pkg = j('mood-diary', null);
    if (!pkg || !pkg.d) return null;
    var keys = Object.keys(pkg.d).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }).sort();
    if (!keys.length) return null;
    var last = keys[keys.length - 1];
    var rec = pkg.d[last] || {};
    var MOODS = { '😊': '开心', '🙂': '平静', '😐': '一般', '🤒': '不舒服', '😔': '低落', '😢': '难过', '😡': '烦躁', '😴': '疲惫' };
    var m = MOODS[rec.m] || rec.m || '';
    var note = String(rec.n || '').trim();
    var when = last === today() ? '今天' : (daysBetween(last, today()) === 1 ? '昨天' : last.slice(5));
    return { text: (m ? esc(m) : '已记录') + (note ? ' · ' + esc(note.slice(0, 18)) : ''), time: when };
  }
  function readAccounting() {
    var arr = j('accounting-records', null);
    if (!Array.isArray(arr) || !arr.length) return null;
    var ym = today().slice(0, 7);
    var exp = 0, cnt = 0;
    arr.forEach(function (r) {
      if (!r || typeof r.date !== 'string' || r.date.slice(0, 7) !== ym) return;
      if (r.type === 'expense') { exp += Number(r.amount) || 0; cnt++; }
    });
    if (!cnt) return null;
    return { text: '本月支出 ' + bold('¥' + Math.round(exp)) + ' · ' + cnt + ' 笔', time: '' };
  }
  function readCalendar() {
    var d = new Date();
    for (var i = 0; i < 45; i++) {
      var k = ds(d);
      var mine = g('cal-my-' + k) || '';
      var memo = g('memo-' + k) || '';
      var txt = String(mine || memo || '').trim();
      if (txt) {
        var when = i === 0 ? '今天' : (i === 1 ? '昨天' : k.slice(5));
        return { text: esc(txt.slice(0, 24)), time: when };
      }
      d.setDate(d.getDate() - 1);
    }
    return null;
  }
  function readAsk() {
    var pkg = j('ta-ask', null);
    if (!pkg || !Array.isArray(pkg.history) || !pkg.history.length) return null;
    var done = 0, last = null;
    pkg.history.forEach(function (h) { if (h && h.q) { if (h.status !== 'pending') done++; if (!last || (h.ts || 0) > (last.ts || 0)) last = h; } });
    if (!last) return null;
    var q = String(last.q || '').slice(0, 16);
    return { text: '已回答 ' + bold(done) + ' · 最近「' + esc(q) + '」', time: last.ts ? hm(last.ts) : '' };
  }
  function readChat() {
    var arr = j('chat-msgs', null);
    if (!Array.isArray(arr) || !arr.length) return null;
    var t0 = new Date(today() + 'T00:00:00').getTime();
    var n = 0;
    arr.forEach(function (m) { if (m && Number(m.ts) >= t0) n++; });
    if (!n) return null;
    return { text: '今天 ' + bold(n.toLocaleString ? n.toLocaleString() : n) + ' 条', time: '' };
  }
  function readArc() {
    var cur = g('narc-cur') || '';
    if (!cur) return null;
    var pkg = j('narc-' + cur, null);
    if (!pkg || typeof pkg !== 'object') return null;
    var n = 0;
    Object.keys(pkg).forEach(function (k) {
      var v = pkg[k];
      if (typeof v === 'string' && v.trim()) n++;
      else if (Array.isArray(v) && v.length) n++;
    });
    if (!n) return null;
    var nm = String(pkg.name || '').trim();
    return { text: (nm ? esc(nm) + ' · ' : '') + bold(n) + ' 条设定', time: '' };
  }

  var READERS = {
    period: readPeriod, memory: readMemory, mood: readMood,
    accounting: readAccounting, calendar: readCalendar, ask: readAsk,
    chat: readChat, arc: readArc
  };

  // ---------- 打开原页面（复用桌面图标自己的打开逻辑） ----------
  function openTarget(row) {
    var closed = false;
    try {
      var pg = document.getElementById('page-records');
      if (pg) pg.hidden = true;
      var app = row.app ? document.querySelector('.app[data-app="' + row.app + '"]') : null;
      if (app) { app.click(); closed = true; }
      if (!closed && row.page) {
        var target = document.getElementById(row.page);
        if (target) {
          document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
          target.hidden = false;
          closed = true;
        }
      }
    } catch (e) {}
    if (!closed && window.toast) { try { window.toast('这个功能还没加载完'); } catch (e2) {} }
  }

  // ---------- 渲染 ----------
  function render() {
    var box = document.getElementById('records-list');
    if (!box) return;
    var rows = [];
    ROWS.forEach(function (row) {
      var fn = READERS[row.k];
      if (!fn) return;
      var r = null;
      try { r = fn(); } catch (e) { r = null; }
      if (!r || !r.text) return;
      rows.push({ row: row, out: r });
    });
    if (!rows.length) {
      box.innerHTML = '<div class="rec-empty">还没有可汇总的记录<br><span>随手记点什么，这里就会出现</span></div>';
      return;
    }
    var h = '';
    rows.forEach(function (it, i) {
      var r = it.row, o = it.out;
      h += '<div class="rec-row' + (i === 0 ? ' rec-first' : '') + '" data-k="' + r.k + '">' +
        '<span class="rec-ic ' + (r.cls || '') + '">' + r.icon + '</span>' +
        '<span class="rec-nm">' + esc(r.name) + '</span>' +
        '<span class="rec-v">' + o.text + '</span>' +
        (o.time ? '<span class="rec-t">' + esc(o.time) + '</span>' : '') +
        '<svg class="rec-arw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>' +
        '</div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('.rec-row').forEach(function (el) {
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-k');
        var row = ROWS.filter(function (x) { return x.k === k; })[0];
        if (row) openTarget(row);
      });
    });
  }

  function openPage() {
    var pg = document.getElementById('page-records');
    if (!pg) return;
    render();
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
    pg.hidden = false;
    try { var mp = document.getElementById('chat-more-panel'); if (mp) mp.hidden = true; } catch (e) {}
  }
  window.openRecordsPage = openPage;

  try {
    var back = document.getElementById('records-back');
    if (back) back.addEventListener('click', function () {
      var pg = document.getElementById('page-records');
      if (pg) pg.hidden = true;
      var home = document.getElementById('page-phone');
      if (home) home.hidden = false;
    });
    document.addEventListener('contact-switched', function () {
      var pg = document.getElementById('page-records');
      if (pg && !pg.hidden) render();
    });
    document.addEventListener('mochi-restore-done', function () {
      var pg = document.getElementById('page-records');
      if (pg && !pg.hidden) render();
    });
  } catch (e) {}
})();

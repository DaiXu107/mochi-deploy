// mood-diary.js —— #303 心情日记本（v3.26.x）
// 每天选一个心情表情 + 可选一句话；月视图画「我 vs TA」心情曲线对照 + 日历格 + 统计。
// TA 的心情按「日期+桌面」伪随机生成（同一天任何时刻打开都一样，约 1/3 概率与我同心情）。
// 存储：activeStore 的 'mood-diary'（IDB 镜像键 activePrefix()+':mood-diary'），
// 结构 { d: { 'YYYY-MM-DD': { m: emoji, n: 备注, ts } } }
(function () {
  'use strict';

  const MOODS = [
    { e: '😊', n: '开心', s: 5 },
    { e: '🥰', n: '甜蜜', s: 5 },
    { e: '😄', n: '快乐', s: 5 },
    { e: '😌', n: '平静', s: 4 },
    { e: '🤒', n: '不舒服', s: 2 },
    { e: '😔', n: '低落', s: 2 },
    { e: '😢', n: '难过', s: 1 },
    { e: '😡', n: '烦躁', s: 1 },
    { e: '😴', n: '疲惫', s: 2 }
  ];
  const KEY = 'mood-diary';

  function store() { return window.activeStore(); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // 与 device.js/mobile-adapt.js 同款 #cc-toast 通道（每个 js 单独 IIFE，拿不到 chat.js 顶层 toast）
  function toast(t) {
    try {
      let el = document.getElementById('cc-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'cc-toast';
        document.body.appendChild(el);
      }
      el.textContent = t;
      el.className = 'cc-toast show';
      clearTimeout(el.__timer);
      el.__timer = setTimeout(() => { el.className = 'cc-toast'; }, 1800);
    } catch (e) {}
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function moodByEmoji(e) { return MOODS.find(m => m.e === e) || null; }

  function loadAll() {
    try {
      const v = JSON.parse(store().get(KEY) || 'null');
      if (v && v.d && typeof v.d === 'object') return v;
    } catch (e) {}
    return { d: {} };
  }
  function saveAll(data) {
    try { store().set(KEY, JSON.stringify(data)); } catch (e) {}
    try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + KEY, JSON.stringify(data)); } catch (e) {}
  }

  // TA 心情：字符串哈希 → 伪随机，与日期+桌面绑定，同日稳定；与「我当天记录的心情」完全独立（#338）。
  // 仅当「当天有真实交互（聊天有消息）」才生成 TA 心情，无交互日期返回 null（不显示）。
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }
  // 本桌面对应聊天消息数组（优先取内存已加载的；未加载时回退 localStorage 快照）
  function chatArr() {
    try { const m = window.getChatMsgs ? window.getChatMsgs() : null; if (Array.isArray(m) && m.length) return m; } catch (e) {}
    try { const v = JSON.parse(store().get('chat-msgs') || '[]'); if (Array.isArray(v)) return v; } catch (e) {}
    return [];
  }
  const _interactCache = { built: false, set: {} };
  function buildInteractSet() {
    const set = {};
    for (const m of chatArr()) {
      if (m && m.ts) { const d = new Date(m.ts); set[d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())] = 1; }
    }
    _interactCache.set = set;
    _interactCache.built = true;
  }
  function hasInteraction(dateKey) {
    if (!_interactCache.built) buildInteractSet();
    return !!_interactCache.set[dateKey];
  }
  function taMoodFor(dateKey) {
    if (!hasInteraction(dateKey)) return null; // 无真实交互 → 不显示 TA 心情
    // FIX #338：不再读 mood-diary 我的当日记录（旧版 35% 概率返回 moodByEmoji(mine.m)，
    // 导致我记录心情后 TA 心情被改成同款）；哈希加盐保证与旧跟随逻辑不可逆混淆。
    const h = hashStr('ta-mood-indep|' + (window.__activeCid || 'default') + '|' + dateKey);
    return MOODS[h % MOODS.length];
  }

  let curYM = null; // 'YYYY-MM'，月视图当前月
  let selMood = '';

  function openMoodDiary() {
    const pg = document.getElementById('page-mood');
    if (!pg) return;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    pg.hidden = false;
    const now = new Date();
    curYM = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    _interactCache.built = false; // 每次打开重建「有交互日期」集合，确保读到最新聊天
    renderToday();
    renderMonth();
  }

  function renderToday() {
    const now = new Date();
    const k = dkey(now);
    const data = loadAll();
    const mine = data.d[k];
    selMood = mine ? mine.m : '';
    const grid = document.getElementById('mood-emoji-grid');
    if (grid) {
      grid.innerHTML = '';
      MOODS.forEach(m => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mood-emoji-item' + (selMood === m.e ? ' sel' : '');
        b.innerHTML = '<span class="mood-emoji-face">' + m.e + '</span><span class="mood-emoji-name">' + m.n + '</span>';
        b.addEventListener('click', () => {
          selMood = (selMood === m.e ? '' : m.e);
          grid.querySelectorAll('.mood-emoji-item').forEach(x => x.classList.remove('sel'));
          if (selMood) b.classList.add('sel');
        });
        grid.appendChild(b);
      });
    }
    const note = document.getElementById('mood-note');
    if (note) note.value = mine ? (mine.n || '') : '';
    const ta = document.getElementById('mood-ta-line');
    if (ta) {
      const tm = taMoodFor(k);
      const nm = store().get('lbl-partner') || 'TA';
      ta.textContent = tm ? (nm + ' 今天的心情：' + tm.e + ' ' + tm.n)
                         : (nm + ' 今天还没有互动，还没有心情哦');
    }
    const btn = document.getElementById('mood-save');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (!selMood) { toast('先选一个今天的心情吧'); return; }
        const dd = loadAll();
        dd.d[dkey(new Date())] = { m: selMood, n: (document.getElementById('mood-note') || {}).value || '', ts: Date.now() };
        saveAll(dd);
        toast('今天的心情记下啦 ' + selMood);
        renderToday();
        renderMonth();
      });
    }
    const title = document.getElementById('mood-today-title');
    if (title) {
      const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
      title.textContent = '今天的心情 · ' + (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + wd;
    }
  }

  function renderMonth() {
    const label = document.getElementById('mood-month-label');
    const curve = document.getElementById('mood-curve');
    const gridEl = document.getElementById('mood-month-grid');
    const stats = document.getElementById('mood-month-stats');
    if (!label || !curve || !gridEl) return;
    const [y, mo] = curYM.split('-').map(Number);
    label.textContent = y + ' 年 ' + mo + ' 月';
    const days = new Date(y, mo, 0).getDate();
    const data = loadAll().d;

    // ---- 曲线（SVG）：我=粉，TA=蓝，缺天断线 ----
    const W = 320, H = 110, L = 14, R = 8, T = 10, B = 24;
    const cxf = i => L + (days <= 1 ? 0 : (i / (days - 1)) * (W - L - R));
    const cyf = s => T + (1 - (s - 1) / 4) * (H - T - B);
    function poly(which) {
      let seg = [], segs = [];
      for (let i = 1; i <= days; i++) {
        const k = y + '-' + pad(mo) + '-' + pad(i);
        let s = null;
        if (which === 'me') { const rec = data[k]; if (rec) { const m = moodByEmoji(rec.m); if (m) s = m.s; } }
        else { const m = taMoodFor(k); if (m) s = m.s; }
        if (s == null) { if (seg.length > 1) segs.push(seg); seg = []; }
        else seg.push([cxf(i - 1), cyf(s)]);
      }
      if (seg.length > 1) segs.push(seg);
      return segs.map(g => '<polyline points="' + g.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="none" stroke="' + (which === 'me' ? '#ff6b9d' : '#6ba7ff') + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>').join('');
    }
    let marks = '';
    for (let i = 1; i <= days; i += 5) marks += '<text x="' + cxf(i - 1).toFixed(1) + '" y="' + (H - 6) + '" font-size="9" fill="#999" text-anchor="middle">' + i + '</text>';
    curve.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">' +
      '<line x1="' + L + '" y1="' + cyf(3) + '" x2="' + (W - R) + '" y2="' + cyf(3) + '" stroke="rgba(0,0,0,.08)" stroke-dasharray="3 4"/>' +
      poly('ta') + poly('me') + marks + '</svg>' +
      '<div class="mood-legend"><span class="ml-me">— 我</span><span class="ml-ta">— ' + esc(store().get('lbl-partner') || 'TA') + '</span></div>';

    // ---- 日历格 ----
    const firstDow = new Date(y, mo - 1, 1).getDay();
    let gh = '';
    ['日', '一', '二', '三', '四', '五', '六'].forEach(w => gh += '<span class="mood-cell mood-dow">' + w + '</span>');
    for (let i = 0; i < firstDow; i++) gh += '<span class="mood-cell"></span>';
    const todayK = dkey(new Date());
    for (let i = 1; i <= days; i++) {
      const k = y + '-' + pad(mo) + '-' + pad(i);
      const rec = data[k];
      const tm = taMoodFor(k);
      const cls = 'mood-cell mood-day' + (k === todayK ? ' today' : '');
      gh += '<span class="' + cls + '" title="我 ' + (rec ? moodByEmoji(rec.m).n : '未记录') + '｜TA ' + (tm ? tm.n : '未互动') + '">' +
        '<span class="mood-dnum">' + i + '</span>' +
        '<span class="mood-dfaces"><i>' + (rec ? rec.m : '') + '</i><i>' + (tm ? tm.e : '') + '</i></span></span>';
    }
    gridEl.innerHTML = gh;

    // ---- 统计 ----
    if (stats) {
      let rec = 0, taRec = 0;
      const cnt = {};
      for (let i = 1; i <= days; i++) {
        const k = y + '-' + pad(mo) + '-' + pad(i);
        if (data[k]) { rec++; const mm = moodByEmoji(data[k].m); if (mm) cnt[mm.e + ' ' + mm.n] = (cnt[mm.e + ' ' + mm.n] || 0) + 1; }
        if (taMoodFor(k)) taRec++;
      }
      const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      // 连续记录天数（倒推到今天为止）
      let streak = 0;
      const d = new Date();
      while (data[dkey(d)]) { streak++; d.setDate(d.getDate() - 1); }
      stats.innerHTML = '本月记录 <b>' + rec + '</b> 天 · 连续 <b>' + streak + '</b> 天' +
        (top ? ' · 最常的心情：' + esc(top) : '') +
        (streak >= 3 ? ' 🎉' : '');
    }
  }

  function bindChrome() {
    const back = document.getElementById('mood-back');
    if (back && !back.dataset.bound) {
      back.dataset.bound = '1';
      back.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => p.hidden = true);
        // 返回目标：聊天更入口 → 聊天页；日历入口 → 日历页；其它 → 桌面
        const backTarget = window.__moodFrom === 'chat' ? 'page-chat'
                          : (window.__moodFrom === 'calendar' ? 'page-calendar' : 'page-phone');
        const node = document.getElementById(backTarget);
        if (node) node.hidden = false;
        window.__moodFrom = '';
      });
    }
    const prev = document.getElementById('mood-prev-m');
    const next = document.getElementById('mood-next-m');
    const shift = (n) => {
      let [y, m] = curYM.split('-').map(Number);
      m += n;
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
      curYM = y + '-' + pad(m);
      renderMonth();
    };
    if (prev && !prev.dataset.bound) { prev.dataset.bound = '1'; prev.addEventListener('click', () => shift(-1)); }
    if (next && !next.dataset.bound) { next.dataset.bound = '1'; next.addEventListener('click', () => shift(1)); }
    // 入口：桌面「日历」页顶部「心情日记」卡（v3.27.x 由更多功能 → 工具迁入日历）
    const entry = document.getElementById('cal-mood-entry');
    if (entry && !entry.dataset.bound) {
      entry.dataset.bound = '1';
      entry.addEventListener('click', () => {
        window.__moodFrom = 'calendar';
        openMoodDiary();
      });
    }
  }

  function init() {
    bindChrome();
    // 首次绑定失败（DOM 未就绪等）时兜底重试一次
    if (!document.getElementById('mood-back')) setTimeout(bindChrome, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.openMoodDiary = openMoodDiary;
  // 日历/开屏横幅复用：返回今天的心情日记摘要
  // { mine:{e,n,note}|null, ta:{e,n}|null }——ta 仅当当天有真实交互才生成，否则 null
  window.moodDiaryToday = function () {
    try {
      const k = dkey(new Date());
      const data = loadAll();
      const rec = data.d[k];
      const mine = rec ? { e: rec.m, n: (moodByEmoji(rec.m) || {}).n || '', note: rec.n || '' } : null;
      _interactCache.built = false; // 重建「有交互日期」集合，确保读到最新聊天
      const tm = taMoodFor(k);
      return { mine: mine, ta: tm ? { e: tm.e, n: tm.n } : null };
    } catch (e) { return { mine: null, ta: null }; }
  };
})();

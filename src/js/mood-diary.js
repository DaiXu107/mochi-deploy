// mood-diary.js —— #303 心情日记本（v3.26.x）
// 每天选一个心情表情 + 可选一句话；月视图画「我 vs TA」心情曲线对照 + 日历格 + 统计。
// TA 的心情按「日期+桌面」伪随机生成（同一天任何时刻打开都一样，约 1/3 概率与我同心情）。
// 存储：activeStore 的 'mood-diary'（IDB 镜像键 activePrefix()+':mood-diary'），
// 结构 { d: { 'YYYY-MM-DD': { m: emoji, n: 备注, ts } }, days: { 'YYYY-MM-DD': 1 } }
// （days＝记下「这些天有过聊天互动」，#1353c；旧版只读 v.d，多出来的字段旧读者一律不看）
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

  // FIX 2026-09-28 #1353e：日记包多一条 `days`（记下「这些天真有过聊天互动」），TA 心情与日历那句改读它。
  //   旧包只有 {d:{...}}；多出来的字段旧读者一律不看（loadAll 仍认 v.d），备份/导出/清空按整串走＝零影响。
  function normPkg(v) {
    if (!v || typeof v !== 'object' || !v.d || typeof v.d !== 'object') return null;
    if (!v.days || typeof v.days !== 'object') v.days = {};
    return v;
  }
  function loadAll() {
    try { const p = normPkg(JSON.parse(store().get(KEY) || 'null')); if (p) return p; } catch (e) {}
    return { d: {}, days: {} };
  }
  // FIX 2026-09-28 #1353a~d：整本写回＝「库里那一格 ∪ 本机这一份」，同一天取 ts 更新的那份——这一格从此只会变多。
  //   旧写法把「本机此刻同步读到的那份」当全量：localStorage 立刻整包、IndexedDB 也整包盖。而真机上本机这份
  //   经常就是少的——① LS 配额满时 setItem 静默抛＝LS 停在旧包，xyStore.get 只认内存与 LS，库里那份更新的
  //   被旧包整场遮住（报障件逐字「LS 写探针：写入失败(QuotaExceededError)」，另一台整域 5.8MB／1845 键）；
  //   ② 页面被系统回收（同一件实测回收 139 次／56 次）后内存清零，这一格若还挂在启动回填的挂起名单上＝同步
  //   读到 NULL＝「用户从没记过」。两种形态下点一次最正常的「记下今天」，都把库里更早的记录整包顶掉＝用户口径
  //   「只能记录三天心情，第四天会把之前的清空只剩第四天」。无头实测（纯产物、同一把尺）：库里 6 天＋LS 一份
  //   落后两天的旧包 → 点一次保存 → 库里剩 3 天，中间那几天永久消失，toast 照旧谎报「记下啦」。
  //   判据只取一个当场事实：库里那一格现在有什么。零机型／零 UA 分支。
  function libKey() { return window.activePrefix() + ':' + KEY; }
  function parseLib(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try { return normPkg(JSON.parse(raw)); } catch (e) { return null; }
  }
  function unionPkg(lib, ours) {
    if (!lib) return ours;
    const out = { d: {}, days: {} };
    const put = function (k) {
      if (out.d[k]) return;
      const a = lib.d[k], b = ours.d[k];
      if (a && b) out.d[k] = (((b.ts || 0) >= (a.ts || 0)) ? b : a);
      else out.d[k] = a || b;
    };
    Object.keys(lib.d).forEach(put);
    Object.keys(ours.d).forEach(put);
    Object.keys(lib.days || {}).forEach(function (k) { out.days[k] = 1; });
    Object.keys(ours.days || {}).forEach(function (k) { out.days[k] = 1; });
    return out;
  }
  // 「记下哪天有过互动」那一刻广播一次（日历入口卡据此补渲；两处分拨同一个口，全站只这一处 dispatch）
  function broadcastInteract() {
    setTimeout(function () { try { document.dispatchEvent(new Event('mood-interact-recorded')); } catch (e) {} }, 0);
  }
  let _libMergeBusy = false, _libMergeAgain = false;
  function queueLibMerge(retry) {
    if (_libMergeBusy) { _libMergeAgain = true; return; }
    _libMergeBusy = true;
    const info = {};
    let p;
    try { p = Promise.resolve(window.idbGet(libKey(), info)); } catch (e) { p = Promise.resolve(undefined); }
    const bail = function () {
      _libMergeBusy = false;
      // 这一趟没读到库里那份：不许拿「本机这份」去整本盖它（＝这一批要根治的那件事）。
      // 本机这份已在内存＋LS 里，补一趟就好；补试只发一次，不变成常驻轮询。
      if (!retry) { setTimeout(queueLibMerge, 4000, true); return; }
      if (_libMergeAgain) { _libMergeAgain = false; queueLibMerge(false); }
    };
    Promise.resolve(p).then(function (libRaw) {
      _libMergeBusy = false;
      const ours = loadAll();
      if ((libRaw === undefined || libRaw === null) && info.ambiguous) { bail(); return; }
      const merged = unionPkg(parseLib(libRaw), ours);
      try { store().set(KEY, JSON.stringify(merged)); } catch (e) {}
      // 库里那些日子并回来了：只重画月视图（它才是「之前的被清空」的那块屏），
      // 不动 renderToday——它会拿存盘的备注盖掉用户正在输入框里写的那句话。
      const grewD = Object.keys(merged.d).length > Object.keys(ours.d).length;
      const grewDy = Object.keys(merged.days).length > Object.keys(ours.days).length;
      if (grewDy) _interactCache.built = false; // 并回来的那些天也要重新认一遍「有没有互动」
      if (grewD || grewDy) {
        try { renderMonth(); } catch (e) {}
        broadcastInteract();
      }
      if (_libMergeAgain) { _libMergeAgain = false; queueLibMerge(false); }
    }, bail);
  }
  function saveAll(data) {
    const s = JSON.stringify(data);
    // ① 本机这一份立刻落地（内存＋LS）：页面上马上看得见，这一发被系统回收也不丢今天这一条。
    //    刻意不走 xyStore.set——那条腿会顺手把 IndexedDB 也整包盖掉，而 IDB 必须先把库里那份读回来合并（②）。
    try { if (window.idbMemoSet) window.idbMemoSet(libKey(), s); } catch (e) {}
    try { localStorage.setItem(libKey(), s); } catch (e) {}
    if (!window.idbMemoSet || !window.idbGet || !window.idbSet) {
      // 数据层这两个口不在（同一份构建里不会发生）＝按旧语义直接落，不把保存变成存不进去
      try { store().set(KEY, s); } catch (e2) {}
      try { if (window.idbSet) window.idbSet(libKey(), s); } catch (e2) {}
      return;
    }
    // ② IDB 那一腿等库里那份读回来，合并后再落
    queueLibMerge(false);
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
  // FIX 2026-09-28 #1353e~i：聊天这一格「读到过」与「一条都没有」是两件事。旧写法把「这一发什么也没读到」
  //   当成「这一天没互动」，于是：① 大历史在本机只有尾部窗口/启动回填还没把聊天读回来时，日记里早已出现过
  //   的那些天的 TA 心情会凭空消失＝用户口径「第四天会把之前的清空只剩第四天，之后记录三天又清空」；
  //   ② 日历那张「TA（心情日记）」入口卡开页那一刻画的是「今天还没有互动」，之后聊天读回来了也不重画＝
  //   用户口径「日历上也不显示TA的心情」（纯产物实测：LS 里没有 chat-msgs 快照而库里 5 天聊天完好时，
  //   日历这一行整场说「今天还没有互动」，同一场里日记页却明明显示着 TA 今天的心情）。
  //   改法两件事，判据只取「记下的日子」＋「这一发到底读到没读到聊天」：
  //   · 哪天有过互动＝记进包里的 days（并集，只增不减），下一场不必重新看到也还在；
  //   · 没读到聊天＝说「还在读」而不是宣布「没互动」，并在真的记下新日子时让日历那句跟着重画。
  const _interactCache = { built: false, set: {}, seen: false };
  function dayKeyOf(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function buildInteractSet() {
    const pkg = loadAll();
    const set = {};
    Object.keys(pkg.days || {}).forEach(function (k) { set[k] = 1; });
    const arr = chatArr();
    let grew = 0;
    for (let i = 0; i < arr.length; i++) {
      const m = arr[i];
      if (m && m.ts && !set[dayKeyOf(m.ts)]) { set[dayKeyOf(m.ts)] = 1; grew++; }
    }
    let ready = false;
    try { ready = !!(window.__chatDbReady && window.__chatDbReady()); } catch (e) {}
    _interactCache.set = set;
    _interactCache.seen = !!arr.length || ready;
    _interactCache.built = true;
    if (grew) {
      pkg.days = set;
      saveAll(pkg); // 看到一次就记下来，别等下一场现算——下一场本机那份未必还带着这几天
      broadcastInteract();
    }
  }
  function hasInteraction(dateKey) {
    if (!_interactCache.built) buildInteractSet();
    return !!_interactCache.set[dateKey];
  }
  // 这一天到底有没有互动——「没查到」分两种：这一发真读到了聊天（＝没互动）与这一发没读到聊天（＝不知道）
  function interactionUnknown(dateKey) {
    if (!_interactCache.built) buildInteractSet();
    return !_interactCache.set[dateKey] && !_interactCache.seen;
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

  // #797：回填完成补渲一次（renderToday 经 loadAll 现读现画幂等）
  if (window.mochiOnDataReady) window.mochiOnDataReady(function () { try { renderToday(); } catch (e) {} });
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
      // #797：回填未完成时不说「还没有互动」（读起来像 TA 没理人），出读取占位，
      // done 后由本页重渲收敛
      // #1353c：同款谎话的另一条来路＝这一发根本没读到聊天（大历史只带尾部窗口/还没进过聊天页）。
      // 已记下的日子在 days 里，不靠这一发读到什么；没读到又没记下时只能说「还在读」，不能宣布「没互动」。
      ta.textContent = tm ? (nm + ' 今天的心情：' + tm.e + ' ' + tm.n)
        : (((window.mochiDataPending && window.mochiDataPending()) || interactionUnknown(k)) ? window.mochiLoadingText()
        : (nm + ' 今天还没有互动，还没有心情哦'));
    }
    const btn = document.getElementById('mood-save');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (!selMood) { toast('先选一个今天的心情吧'); return; }
        const dd = loadAll();
        // #1162（#850 同款防护）：回填未完成且现读为空＝历史记录还在 IDB 里没回到本机快照。
        // 此刻整包落盘会用「只含今天」的对象打穿 LS＋IDB 权威值＝历史记录被抹掉（真丢，
        // 事后导出只会说「没有数据」）。pending 期让位，回填完成后 mochiOnDataReady 已重渲，再记即可。
        if (!Object.keys(dd.d).length && window.mochiDataPending && window.mochiDataPending()) { toast('数据还在从本机数据库读取，稍等几秒再记，免得盖掉更早的日记'); return; }
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
  // { mine:{e,n,note}|null, ta:{e,n}|null, taUnknown:bool }——ta 仅当那天有过互动才有，否则 null；
  // taUnknown＝这一发既没读到聊天、days 里也还没记下今天（＝不知道，不许说成「还没有互动」，#1353c）
  window.moodDiaryToday = function () {
    try {
      const k = dkey(new Date());
      const data = loadAll();
      const rec = data.d[k];
      const mine = rec ? { e: rec.m, n: (moodByEmoji(rec.m) || {}).n || '', note: rec.n || '' } : null;
      _interactCache.built = false; // 重建「有交互日期」集合，确保读到最新聊天
      const tm = taMoodFor(k);
      return { mine: mine, ta: tm ? { e: tm.e, n: tm.n } : null, taUnknown: !tm && interactionUnknown(k) };
    } catch (e) { return { mine: null, ta: null, taUnknown: false }; }
  };
})();

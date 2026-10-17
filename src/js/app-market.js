/* ===== 应用市场 + 桌面图标移除（二传新增）=====
   · 桌面长按图标 → 抖动编辑模式（personalize.js 的移动模式），图标左上角出现 ×
   · 点 × = 从桌面移除（只写 hidden-icons，不删任何数据），底部给「撤销」
   · 应用市场（#page-appmarket）：扫描 DOM 里所有 .app[data-app]，列出已添加/未添加，
     可一键加回桌面；新功能只要模板里加一个 .app 图标就自动上架
*/
(function () {
  'use strict';

  // 不可移除的三个：聊天 / 设置 / 应用市场（防止把自己锁在门外）
  var CORE = { chat: 1, settings: 1, appstore: 1 };

  // 元数据：分类 / 一句话说明 / 上线日期（30 天内显示「新」）
  var META = {
    chat:        { cat: '聊天', desc: '和 TA 的主聊天：字卡、图文、引用' },
    'group-chat':{ cat: '聊天', desc: '所有桌面成员聚在一个窗口聊天（随群聊模式）' },
    home:        { cat: '记录', desc: '情侣空间与相处统计' },
    mail:        { cat: '聊天', desc: '写信 / 收信，支持图文信件' },
    feed:        { cat: '聊天', desc: '发动态、点赞评论，TA 也会发' },
    calendar:    { cat: '记录', desc: '日历、每日留言与备忘' },
    memory:      { cat: '记录', desc: '纪念日、倒数日与相伴天数' },
    settings:    { cat: '工具', desc: '设置中心：外观 / 聊天 / 提醒 / 数据' },
    note:        { cat: '工具', desc: '我的收藏与 TA 的收藏' },
    music:       { cat: '娱乐', desc: '本地 / 链接听歌、歌单、一起听歌' },
    stats:       { cat: '记录', desc: '聊天记录与情绪表达统计' },
    interact:    { cat: '记录', desc: 'TA 的询问、好奇与邀请历史' },
    checkin:     { cat: '工具', desc: '寻踪 / 查岗打卡与位置感知' },
    garden:      { cat: '娱乐', desc: '种花杂交、花束工坊' },
    bar:         { cat: '娱乐', desc: '用原料调制饮料并送到聊天', since: '2026-10-13' },
    cjian:       { cat: '工具', desc: '每位梦角的世界时间与在场状态' },
    divination:  { cat: '娱乐', desc: '塔罗 / 雷诺曼占卜（随群聊模式）' },
    period:      { cat: '记录', desc: '经期预测、症状与体温记录' },
    accounting:  { cat: '记录', desc: '收支分类、预算与账本' },
    'memo-arc':  { cat: '记录', desc: '认识 TA：九个分区与共同记录' },
    'my-arc':    { cat: '记录', desc: '写给 TA 的自我说明与 IF 设定' },
    room:        { cat: '娱乐', desc: '等距 2.5D 双人小屋', since: '2026-10-15' },
    appstore:    { cat: '工具', desc: '应用市场：把移除的图标加回桌面', since: '2026-10-17' },
    tongpin:     { cat: '互动', desc: 'TA 此刻状态 + 敲三下暗号' },
    shenshou:    { cat: '互动', desc: '摸摸身边：三种触感 + 悄悄话' },
    water:       { cat: '工具', desc: '今日喝水进度，TA 定时提醒' },
    eat:         { cat: '工具', desc: '随机抽菜 / 转盘，问问 TA 吃什么' },
    piggy:       { cat: '工具', desc: '存取与心愿目标，TA 当监督人' },
    pomo:        { cat: '工具', desc: '番茄钟专注计时' },
    memo:        { cat: '工具', desc: '备忘录：随手记下想说的' },
    market:      { cat: '娱乐', desc: '心意市集：挑选礼物送给 TA' },
    giftbox:     { cat: '娱乐', desc: '心意柜：收下与保管 TA 的心意' }
  };
  var CAT_ORDER = ['全部', '聊天', '记录', '工具', '娱乐', '互动', '其他'];
  var CUR_CAT = '全部';
  var NEW_DAYS = 30 * 24 * 3600 * 1000;

  function hidden() {
    try { return (window.getHiddenIcons && window.getHiddenIcons()) || []; } catch (e) { return []; }
  }
  function setHidden(arr) {
    try { if (window.setHiddenIcons) window.setHiddenIcons(arr); } catch (e) {}
  }
  function toast(msg) {
    try { if (window.toast) { window.toast(msg); return; } } catch (e) {}
    try {
      var t = document.getElementById('cc-toast');
      if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
      t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
      clearTimeout(t._amT); t._amT = setTimeout(function () { t.className = 'cc-toast'; }, 2200);
    } catch (e) {}
  }
  function nameOf(app) {
    var n = app.querySelector('.app-name');
    return (n && n.textContent.trim()) || app.dataset.app;
  }
  function isEditing() {
    try { return !!(window.__deskIsEditing && window.__deskIsEditing()); } catch (e) { return false; }
  }

  /* ---------------- 扫描应用 ---------------- */
  function scan() {
    var seen = {}, list = [];
    Array.prototype.forEach.call(document.querySelectorAll('.app[data-app]'), function (app) {
      var k = app.dataset.app;
      if (!k || seen[k]) return;
      seen[k] = 1;
      var inPool = !!app.closest('#desk-widget-pool');
      var hid = hidden().indexOf(k) >= 0;
      var meta = META[k] || { cat: '其他', desc: '' };
      var isNew = false;
      if (meta.since) {
        var t0 = new Date(meta.since + 'T00:00:00').getTime();
        isNew = Date.now() - t0 <= NEW_DAYS;
      }
      list.push({
        key: k,
        name: nameOf(app),
        icon: (app.querySelector('.app-ico') || {}).innerHTML || '',
        meta: meta,
        state: inPool ? 'auto' : (hid ? 'add' : 'added'),
        core: !!CORE[k],
        isNew: isNew
      });
    });
    return list;
  }

  /* ---------------- 移除 / 加回 ---------------- */
  var undoBar = null, undoTimer = 0;
  function showUndo(msg, fn) {
    hideUndo();
    undoBar = document.createElement('div');
    undoBar.className = 'app-undo';
    undoBar.innerHTML = '<span>' + msg + '</span><button type="button">撤销</button>';
    undoBar.querySelector('button').addEventListener('click', function () {
      try { fn(); } catch (e) {}
      hideUndo();
    });
    document.body.appendChild(undoBar);
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, 5000);
  }
  function hideUndo() {
    clearTimeout(undoTimer);
    if (undoBar && undoBar.parentNode) undoBar.parentNode.removeChild(undoBar);
    undoBar = null;
  }
  function removeApp(k) {
    if (!k || CORE[k]) return;
    var list = hidden();
    if (list.indexOf(k) >= 0) return;
    var app = document.querySelector('.app[data-app="' + k + '"]');
    var nm = app ? nameOf(app) : k;
    list.push(k);
    setHidden(list);
    toast('已从桌面移除「' + nm + '」· 数据都还在');
    ensureBadges();
    if (page && !page.hidden) refresh();
    showUndo('已移除「' + nm + '」', function () {
      var l = hidden().filter(function (x) { return x !== k; });
      setHidden(l);
      ensureBadges();
      if (page && !page.hidden) refresh();
    });
  }
  function addApp(k) {
    var app = document.querySelector('.app[data-app="' + k + '"]');
    if (!app) return;
    if (app.closest('#desk-widget-pool')) {
      toast('这个图标由对应开关控制，打开开关后会自动出现');
      return;
    }
    var l = hidden().filter(function (x) { return x !== k; });
    setHidden(l);
    ensureBadges();
    toast('已添加「' + nameOf(app) + '」到桌面');
    refresh();
  }

  /* ---------------- × 移除徽章 ---------------- */
  function ensureBadges() {
    Array.prototype.forEach.call(document.querySelectorAll('.app[data-app]'), function (app) {
      var k = app.dataset.app;
      var old = app.querySelector('.app-x');
      if (CORE[k]) { if (old) old.remove(); return; }
      if (old) return;
      var x = document.createElement('i');
      x.className = 'app-x';
      x.setAttribute('data-k', k);
      x.textContent = '×';
      app.appendChild(x);
    });
  }

  /* ---------------- 应用市场页 ---------------- */
  var page = null, tabsEl = null, listEl = null, searchEl = null;
  function ensurePage() {
    if (document.getElementById('page-appmarket')) { page = document.getElementById('page-appmarket'); return; }
    page = document.createElement('div');
    page.className = 'page';
    page.id = 'page-appmarket';
    page.hidden = true;
    page.innerHTML =
      '<div class="chat-head">' +
        '<span class="ch-back" id="amk-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span>' +
        '<span class="ch-name">应用市场</span>' +
      '</div>' +
      '<div class="cal-scroll amk-scroll">' +
        '<div class="amk-search"><input id="amk-q" placeholder="搜索应用，如 占卜 / 花园 / 记账" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div>' +
        '<div class="amk-tabs" id="amk-tabs"></div>' +
        '<div class="amk-list" id="amk-list"></div>' +
        '<div class="amk-tip">从桌面移除只会收起图标，聊天记录、设置与存档都不会被删除；随时可以在这里加回来。</div>' +
      '</div>';
    // 必须排在 .tabbar 之前（.phone 是纵向 flex：页在前、底栏在后）
    var host = document.querySelector('.phone') || document.body;
    var tb = host.querySelector('.tabbar');
    if (tb && tb.parentNode === host) host.insertBefore(page, tb);
    else host.appendChild(page);
    tabsEl = page.querySelector('#amk-tabs');
    listEl = page.querySelector('#amk-list');
    searchEl = page.querySelector('#amk-q');
    page.querySelector('#amk-back').addEventListener('click', function () {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var home = document.getElementById('page-phone');
      if (home) home.hidden = false;
    });
    tabsEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]');
      if (!b) return;
      CUR_CAT = b.getAttribute('data-cat');
      refresh();
    });
    listEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var k = b.getAttribute('data-k');
      if (b.getAttribute('data-act') === 'add') addApp(k);
      else if (b.getAttribute('data-act') === 'remove') removeApp(k);
    });
    searchEl.addEventListener('input', renderList);
    document.addEventListener('contact-switched', function () {
      if (page && !page.hidden) refresh();
    });
  }

  function refresh() {
    ensurePage();
    var apps = scan(), cats = {};
    apps.forEach(function (a) { cats[a.meta.cat || '其他'] = 1; });
    var tabs = CAT_ORDER.filter(function (c) { return c === '全部' || cats[c]; });
    if (tabs.indexOf(CUR_CAT) < 0) CUR_CAT = '全部';
    tabsEl.innerHTML = tabs.map(function (c) {
      return '<button type="button" data-cat="' + c + '" class="' + (c === CUR_CAT ? 'sel' : '') + '">' + c + '</button>';
    }).join('');
    renderList();
  }

  function renderList() {
    if (!listEl) return;
    var q = (searchEl && searchEl.value || '').trim().toLowerCase();
    var apps = scan().filter(function (a) {
      if (CUR_CAT !== '全部' && (a.meta.cat || '其他') !== CUR_CAT) return false;
      if (!q) return true;
      return (a.name + ' ' + (a.meta.desc || '') + ' ' + (a.meta.cat || '')).toLowerCase().indexOf(q) >= 0;
    });
    // 排序：新功能最先，其次已添加，最后按名称
    apps.sort(function (a, b) {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      if (a.state !== b.state) return a.state === 'added' ? -1 : (b.state === 'added' ? 1 : 0);
      return a.name.localeCompare(b.name, 'zh');
    });
    if (!apps.length) {
      listEl.innerHTML = '<div class="amk-empty">没找到相关应用，换个词试试</div>';
      return;
    }
    var total = scan().length, added = scan().filter(function (a) { return a.state === 'added'; }).length;
    var html = '<div class="amk-sum">已添加 ' + added + ' / ' + total + ' 个应用</div>';
    apps.forEach(function (a) {
      var isNew = a.isNew;
      var btn;
      if (a.core) btn = '<span class="amk-btn core">内置</span>';
      else if (a.state === 'auto') btn = '<span class="amk-btn auto">随开关</span>';
      else if (a.state === 'add') btn = '<button type="button" class="amk-btn add" data-act="add" data-k="' + a.key + '">添加</button>';
      else btn = '<button type="button" class="amk-btn on" data-act="remove" data-k="' + a.key + '">移除</button>';
      html += '<div class="amk-row">' +
        '<div class="amk-ico">' + a.icon + '</div>' +
        '<div class="amk-info"><div class="amk-name">' + a.name +
          (isNew ? '<em class="amk-new">新</em>' : '') +
          '<span class="amk-cat">' + (a.meta.cat || '其他') + '</span></div>' +
          '<div class="amk-desc">' + (a.meta.desc || '') + '</div></div>' +
        btn + '</div>';
    });
    listEl.innerHTML = html;
  }

  function openMarket() {
    refresh();
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = (p !== page); });
    try { document.querySelectorAll('.tabbar .tab').forEach(function (t) { t.classList.remove('active'); }); } catch (e) {}
  }

  /* ---------------- 入口绑定 ---------------- */
  function bindEntry() {
    var ico = document.querySelector('.app[data-app="appstore"]');
    if (!ico || ico._amBound) return;
    ico._amBound = 1;
    ico.addEventListener('click', function (e) {
      var editing = false;
      try {
        editing = Array.prototype.some.call(document.querySelectorAll('.app-grid'), function (g) { return g.classList.contains('editing'); });
      } catch (e0) {}
      if (editing) {
        var grid = ico.closest('.app-grid');
        if (grid && grid.classList.contains('editing')) return;
        if (window.openIconMenu) { e.stopPropagation(); window.openIconMenu(ico); }
        return;
      }
      openMarket();
    });
  }

  /* ---------------- 初始化 ---------------- */
  ensurePage();
  ensureBadges();
  bindEntry();

  // 运行时注入的图标（同频/伸手/喝水/心意市集等）也要有 × 与市场条目
  try {
    var raf = 0;
    var phRoot = document.getElementById('page-phone') || document.body;
    new MutationObserver(function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; ensureBadges(); });
    }).observe(phRoot, { childList: true, subtree: true });
  } catch (e) {}

  // 桌面抖动时再补一次（可能刚注入图标）
  try {
    var ph = document.getElementById('page-phone');
    if (ph) {
      new MutationObserver(function () {
        if (ph.classList.contains('desk-move-mode')) ensureBadges();
      }).observe(ph, { attributes: true, attributeFilter: ['class'] });
    }
  } catch (e) {}

  // 点 × 移除（捕获阶段，先于图标自身的点击处理）
  document.addEventListener('click', function (e) {
    var x = e.target.closest && e.target.closest('.app-x');
    if (!x) return;
    e.preventDefault();
    e.stopPropagation();
    removeApp(x.getAttribute('data-k'));
  }, true);

  // 打开中时刷新（从设置中心等入口进来）
  try {
    new MutationObserver(function () { if (page && !page.hidden) refresh(); })
      .observe(page, { attributes: true, attributeFilter: ['hidden'] });
  } catch (e) {}

  window.openAppMarket = openMarket;
  window.removeDeskApp = removeApp;
  window.addDeskApp = addApp;
})();

/* ===== 界面风格 · 纸页（BETWEEN US 风格）=====
   经典 Mochi / 纸页两套风格，全局设置项（mochi-ui-style = classic | paper）。
   纸页风格只在 html.paper-skin 下生效，只换外观，不改功能与数据结构。
   · 首帧前由 template 里的内联脚本挂类，避免闪白
   · 纸页固定浅色纸面：切换时暂存原深色设置，切回经典时还原
   · 底栏在纸页下改成参考项目的「英文 + 中文 + 手绘圈」文字导航
*/
(function () {
  'use strict';
  var root = document.documentElement;
  var THEME_KEY = 'xy-home-v2:theme-mode';
  var PAPER_THEME_KEY = 'mochi-paper-theme-mode';
  var STYLE_KEY = 'mochi-ui-style';
  var STORE_NS = 'xy-home-v2';
  var STORE_STYLE_KEY = 'ui-style';
  var themeWatcher = null;

  function isPaper() { return root.classList.contains('paper-skin'); }
  function styleText(v) { return v === 'paper' ? 'paper' : (v === 'classic' ? 'classic' : null); }
  // 手机 localStorage 配额满时 setItem 会静默失败：本页能切、刷新就回默认。
  // 因此风格同时写进 xyStore（内存 + localStorage + IndexedDB），读取时优先用它。
  function saveStyle(style) {
    try { localStorage.setItem(STYLE_KEY, style); } catch (e) {}
    try { if (window.xyStore) window.xyStore(STORE_NS).set(STORE_STYLE_KEY, style); } catch (e) {}
  }
  function storedStyle() {
    try {
      if (window.xyStore) {
        var s = styleText(window.xyStore(STORE_NS).get(STORE_STYLE_KEY));
        if (s) return s;
      }
    } catch (e) {}
    try { return styleText(localStorage.getItem(STYLE_KEY)); } catch (e) { return null; }
  }
  function styleForcedByUrl() {
    try { return /(^|[?&])paper=(1|0|white)(&|$)/.test(location.search); } catch (e) { return false; }
  }
  function syncStoredStyle() {
    if (styleForcedByUrl()) return;
    var s = storedStyle();
    if (!s) return;
    var cur = isPaper() ? 'paper' : 'classic';
    if (s !== cur) setStyle(s, { silent: true });
  }
  function themeNow() { try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { return 'light'; } }
  function setThemeLocal(mode) { try { localStorage.setItem(THEME_KEY, mode); } catch (e) {} }
  function setThemeLabel(mode) {
    var l = document.getElementById('theme-mode-val');
    if (l) l.textContent = mode === 'auto' ? '跟随系统' : (mode === 'dark' ? '已开启' : '已关闭');
  }
  function applyThemeAttr(mode) {
    var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
  }

  // 纸页是浅色纸面：暂存当前主题，强制浅色；观察器防 personalize 在之后又写回深色
  function forceLight() {
    try {
      if (root.getAttribute('data-theme') === 'dark') {
        var cur = themeNow();
        if (cur === 'dark' || cur === 'auto') {
          try { localStorage.setItem(PAPER_THEME_KEY, cur); } catch (e) {}
          setThemeLocal('light');
        }
        root.removeAttribute('data-theme');
        setThemeLabel('light');
      }
    } catch (e) {}
  }
  function watchTheme() {
    if (themeWatcher) return;
    try {
      themeWatcher = new MutationObserver(forceLight);
      themeWatcher.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) {}
  }
  function unwatchTheme() {
    try { if (themeWatcher) themeWatcher.disconnect(); } catch (e) {}
    themeWatcher = null;
  }
  function restoreTheme() {
    var prev = 'light';
    try { prev = localStorage.getItem(PAPER_THEME_KEY) || 'light'; } catch (e) {}
    try { localStorage.removeItem(PAPER_THEME_KEY); } catch (e) {}
    setThemeLocal(prev);
    applyThemeAttr(prev);
    setThemeLabel(prev);
  }

  /* ---------------- 底栏文字导航 ---------------- */
  var NAV = {
    'page-phone': ['HOME', '主页'],
    'page-chatcard': ['CARDS', '字卡'],
    'tab-switch-contact': ['SWITCH', '联系人']
  };
  function addNavLabels() {
    var bar = document.querySelector('.tabbar');
    if (!bar) return;
    var tabs = Array.prototype.slice.call(bar.querySelectorAll('.tab'));
    tabs.forEach(function (tab) {
      var key = tab.getAttribute('data-page') || tab.id;
      var pair = NAV[key];
      if (!pair) return;
      if (!tab.querySelector('.paper-tab-label')) {
        var s = document.createElement('span');
        s.className = 'paper-tab-label';
        var b = document.createElement('b'); b.textContent = pair[0];
        var i = document.createElement('i'); i.textContent = pair[1];
        s.appendChild(b); s.appendChild(i);
        tab.appendChild(s);
      }
    });
    if (!bar.querySelector('.paper-nav-slash')) {
      var list = Array.prototype.slice.call(bar.querySelectorAll('.tab'));
      list.forEach(function (tab, idx) {
        if (idx >= list.length - 1) return;
        var sp = document.createElement('span');
        sp.className = 'paper-nav-slash';
        sp.setAttribute('aria-hidden', 'true');
        sp.textContent = '/';
        tab.parentNode.insertBefore(sp, tab.nextSibling);
      });
    }
    bar.classList.add('paper-nav-ready');
  }
  function removeNavLabels() {
    try {
      var bar = document.querySelector('.tabbar');
      if (bar) bar.classList.remove('paper-nav-ready');
      document.querySelectorAll('.paper-tab-label, .paper-nav-slash').forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    } catch (e) {}
  }

  /* ---------------- 聊天顶栏：真实状态行优先 ---------------- */
  var chatStatusBound = false;
  function syncChatSub() {
    var id = document.getElementById('chat-partner-id');
    var st = document.getElementById('chat-partner-status');
    if (!id || !st) return;
    var has = isPaper() && !st.hidden && String(st.textContent || '').trim() !== '';
    id.classList.toggle('paper-has-status', has);
  }
  function watchChatStatus() {
    syncChatSub();
    if (chatStatusBound) return;
    chatStatusBound = true;
    try {
      var st = document.getElementById('chat-partner-status');
      if (st) new MutationObserver(syncChatSub).observe(st, {
        attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true
      });
    } catch (e) {}
    document.addEventListener('contact-switched', syncChatSub);
    document.addEventListener('mochi-wrj-heal', syncChatSub);
  }

  /* ---------------- 风格切换 ---------------- */
  function syncLabels() {
    var paper = isPaper();
    var short = paper ? '纸页' : '经典';
    var el = document.getElementById('ui-style-val');
    if (el) el.textContent = short;
    var el2 = document.getElementById('sh-ui-style-val');
    if (el2) el2.textContent = short;
  }

  function setStyle(style, opts) {
    opts = opts || {};
    var paper = style === 'paper';
    saveStyle(paper ? 'paper' : 'classic');
    if (paper) {
      root.classList.add('paper-skin');
      root.classList.remove('paper-white');
      forceLight();
      watchTheme();
      addNavLabels();
      watchChatStatus();
    } else {
      unwatchTheme();
      root.classList.remove('paper-skin', 'paper-white');
      removeNavLabels();
      restoreTheme();
      syncChatSub();
    }
    syncLabels();
    try { document.dispatchEvent(new CustomEvent('mochi-ui-style-changed', { detail: { style: paper ? 'paper' : 'classic' } })); } catch (e) {}
    if (!opts.silent) {
      try { if (window.toast) window.toast(paper ? '已切换为纸页风格' : '已切换为经典风格'); } catch (e) {}
    }
  }
  window.mochiSetUiStyle = setStyle;
  window.mochiUiStyle = function () { return isPaper() ? 'paper' : 'classic'; };

  window.mochiOpenUiStylePicker = function () {
    if (!window.openModal) return false;
    var cur = isPaper() ? 'paper' : 'classic';
    window.openModal('界面风格', '', function (v) {
      if (v === 'soon') {
        try { if (window.toast) window.toast('这是留给以后新风格的位置'); } catch (e) {}
        return;
      }
      setStyle(v);
    }, {
      noInput: true,
      // 点选项即生效并关闭：不再要求再点一次「确定」，避免「以为切了、其实没落盘」
      pillSubmit: true,
      pill: cur,
      pills: [
        { label: '经典 Mochi', value: 'classic' },
        { label: '纸页 · BETWEEN US', value: 'paper' },
        { label: '更多风格 · 预留', value: 'soon' }
      ],
      staticText: '经典 Mochi：原来的圆润外观。纸页 · BETWEEN US：骨瓷纸底、全文衬线、克莱因蓝与细线框，固定浅色纸面。更多风格的位置已经留好，以后可以直接加。'
    });
    return true;
  };

  function bindEntry() {
    var row = document.getElementById('row-ui-style');
    if (row) {
      row.addEventListener('click', function () {
        if (window.mochiOpenUiStylePicker) window.mochiOpenUiStylePicker();
      });
    }
    // 设置中心是动态渲染的：在页面点击里兜底（settings-hub 也会主动调）
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-act="ui-style"]');
      if (!el) return;
      if (window.mochiOpenUiStylePicker) window.mochiOpenUiStylePicker();
    });
    syncLabels();
  }

  function init() {
    try { localStorage.removeItem('mochi-paper-preview'); } catch (e) {}
    // 首帧内联脚本只读得到 localStorage；这里再对一次 xyStore（配额满时值在内存/IndexedDB），
    // 并在回填完成后再对一次，解决「手机上切换后刷新又回默认」。
    syncStoredStyle();
    if (isPaper()) {
      forceLight();
      watchTheme();
      addNavLabels();
      watchChatStatus();
    } else {
      syncChatSub();
    }
    bindEntry();
    try { document.addEventListener('mochi-restore-done', syncStoredStyle); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

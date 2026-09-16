// ===== #572 功能：页面内「先做这个」提示（复杂页首访自述 + 首选动作 + 本页功能索引）=====
// 需求（用户 2026-09-16「每个复杂页面里不知道先点哪儿」）：能说清「这是什么/从哪进」的只有
// 设置页的功能大全（feature-hub.js）与功能说明胶囊（settings-help.js）——用户已经站在字卡库/
// 美化页里发懵时，答案在另一个页面的另一个入口后面；且页面内层级平行（字卡库三 tab + 添加/
// 批量导入/链接导入/分组、美化七八组、回复设置一屏概率），没有任何地方说「先动这两项」。
// 本模块解决前两条，做法三层：
//   ① 每页首访在**页面内**插一条细提示（不是弹窗、不挡操作、可忽略）：一句话「先做这个」+ 一键动作；
//   ② 同一行可展开「这页还有什么（N）」——条目直接取自功能大全的目录表（window.mochiHubItemsFor），
//      文案与跳转链单一事实源，页面提示与功能大全永远不会分叉成两套说明；
//   ③ 空状态补动作（各页空态按钮 id：#memo-empty-add / #feed-empty-pub / #dl-empty-put 统一在这里
//      委托到该页既有入口，不重复实现任何打开逻辑）。
// 只提示一次：标记键 xy-home-v2:__coach-seen（已看页 id 数组，已列入 contacts.js EXCLUDE，
// 防 migrateLegacy 每次刷新迁进 default 并删根键导致反复弹）；设置 → 工具 → 使用提示 可重置重看。
// 自包含：样式与 DOM 全部本文件创建，不改 template.html / 全局 CSS；动作一律 .click() 既有入口。
(function () {
  const G = 'xy-home-v2:';
  const MARK = G + '__coach-seen';

  function seen() {
    try { const v = JSON.parse(localStorage.getItem(MARK) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function markSeen(id) {
    try {
      const v = seen();
      if (v.indexOf(id) < 0) { v.push(id); localStorage.setItem(MARK, JSON.stringify(v)); }
    } catch (e) {}
  }
  function resetAll() {
    try { localStorage.removeItem(MARK); } catch (e) {}
    const bars = document.querySelectorAll('.pc-bar');
    for (let i = 0; i < bars.length; i++) bars[i].remove();
  }

  // ---- 注册表：页面 / 何时才提示 need()（缺省＝首访一次） / 一句话 / 首选动作（既有入口链） / 本页索引取哪些入口 ----
  const REG = [
    {
      id: 'chatcard', page: 'page-chatcard',
      tip: '先选「公用字卡」，右上「+」添加或用「批量导入」导入；一张卡都没有时，TA 就没有话可说。',
      act: { label: '去添加字卡', go: ['#li-custom-cards-public'] },
      hubs: ['.tab[data-page="page-chatcard"]'],
      // 已经有字卡就不打扰：直接读原始库键判定，不依赖字卡池 hydration 时序
      need: function () {
        try {
          const has = function (raw) {
            if (!raw) return false;
            const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
            for (const k in d) { if (Array.isArray(d[k]) && d[k].some(function (g) { return g && Array.isArray(g[1]) && g[1].length; })) return true; }
            return false;
          };
          return !has(window.xyStore(window.activePrefix()).get('cc-groups')) && !has(window.xyStore(G).get('cc-groups-public'));
        } catch (e) { return false; }
      }
    },
    {
      id: 'theme', page: 'page-theme',
      tip: '这一页有主题色、壁纸、图标、字号、圆角、组件七八组——先用「方案」一键套用，再按需要逐项微调。',
      act: { label: '去套用方案', go: ['.them-tab[data-tab="scheme"]'] },
      hubs: ['#row-appearance']
    },
    {
      id: 'reply-settings', page: 'page-reply-settings',
      tip: '看着像一屏参数，其实先只调「回复速度（最短/最长）」和「回复条数」就够用，其余保持默认。',
      hubs: ['#row-general']
    }
  ];

  // ---- 样式（自包含注入；配色走全局变量，深色自动跟随） ----
  (function injectStyle() {
    const st = document.createElement('style');
    st.textContent =
      '.pc-bar{margin:10px 12px 4px;border-radius:12px;background:rgba(47,111,208,.09);border:1px solid rgba(47,111,208,.22);padding:10px 12px;font-size:12.5px;line-height:1.6;color:var(--ink,#111)}' +
      '.pc-row{display:flex;gap:8px;align-items:flex-start}' +
      '.pc-txt{flex:1;min-width:0}' +
      '.pc-act{flex:0 0 auto;font-size:12.5px;font-weight:700;color:#2f6fd0;background:none;border:0;padding:0;cursor:pointer;white-space:nowrap}' +
      '.pc-x{flex:0 0 auto;color:var(--muted,#999);font-size:15px;line-height:1;padding:0 2px;cursor:pointer}' +
      '.pc-more{margin-top:8px;border-top:1px dashed rgba(47,111,208,.28);padding-top:6px;max-height:34vh;overflow-y:auto}' +
      '.pc-item{padding:7px 2px;border-bottom:1px solid rgba(0,0,0,.06);cursor:pointer}' +
      '.pc-item:last-child{border-bottom:0}' +
      '.pc-item .pc-n{font-weight:700}' +
      '.pc-item .pc-d{color:var(--muted,#777);font-size:12px;display:block;margin-top:1px}' +
      '.pc-toggle{margin-top:7px;font-size:12px;color:#2f6fd0;cursor:pointer;display:inline-block}' +
      '[data-theme="dark"] .pc-bar{background:rgba(143,180,239,.12);border-color:rgba(143,180,239,.3)}' +
      '[data-theme="dark"] .pc-act,[data-theme="dark"] .pc-toggle{color:#8fb4ef}' +
      '[data-theme="dark"] .pc-item{border-bottom-color:rgba(255,255,255,.08)}';
    document.head.appendChild(st);
  })();

  // ---- 跳转：链式 .click() 既有入口（与 feature-hub 同机制，不重复实现任何打开逻辑） ----
  function runGo(go) {
    try {
      (go || []).forEach(function (sel) {
        const el = document.querySelector(sel);
        if (el) el.click();
      });
    } catch (e) {}
  }

  function buildBar(cfg) {
    const bar = document.createElement('div');
    bar.className = 'pc-bar';
    bar.setAttribute('data-pc', cfg.id);
    const items = (window.mochiHubItemsFor ? window.mochiHubItemsFor(cfg.hubs) : []) || [];
    let html = '<div class="pc-row"><span class="pc-txt"><b>先把这页用起来：</b>' + cfg.tip + '</span>'
      + (cfg.act ? '<button class="pc-act" data-pcact="1">' + cfg.act.label + '</button>' : '')
      + '<span class="pc-x" data-pcx="1">×</span></div>';
    if (items.length) {
      html += '<div class="pc-toggle" data-pctoggle="1">这页还有什么（' + items.length + '）▾</div><div class="pc-more" hidden>';
      items.forEach(function (it, i) {
        html += '<div class="pc-item" data-pcitem="' + i + '"><span class="pc-n">' + it.n + '</span><span class="pc-d">' + (it.d || '') + '</span></div>';
      });
      html += '</div>';
    }
    bar.innerHTML = html;
    bar.addEventListener('click', function (e) {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-pcx]')) { bar.remove(); return; }
      if (t.closest('[data-pcact]')) { runGo(cfg.act && cfg.act.go); bar.remove(); return; }
      const tg = t.closest('[data-pctoggle]');
      if (tg) {
        const more = bar.querySelector('.pc-more');
        if (more) { more.hidden = !more.hidden; tg.textContent = tg.textContent.replace(/[▾▴]$/, more.hidden ? '▾' : '▴'); }
        return;
      }
      const it = t.closest('[data-pcitem]');
      if (it) { const k = parseInt(it.getAttribute('data-pcitem'), 10); if (items[k]) runGo(items[k].go); }
    });
    return bar;
  }

  // ---- 进入页面即按需插入（每页一次；已看/不需要则不再出现） ----
  REG.forEach(function (cfg) {
    const page = document.getElementById(cfg.page);
    if (!page || !window.MutationObserver) return;
    const mo = new MutationObserver(function () {
      const old = page.querySelector('.pc-bar[data-pc="' + cfg.id + '"]');
      if (page.hidden) { if (old) old.remove(); return; } // 离开即收起：提示不常驻页面（回来由已看标记决定不再弹）
      if (seen().indexOf(cfg.id) >= 0) return;
      if (old) return;
      setTimeout(function () { // 等页面入场一帧，别和切页动画抢主线程
        try {
          if (page.hidden || seen().indexOf(cfg.id) >= 0) return;
          if (page.querySelector('.pc-bar[data-pc="' + cfg.id + '"]')) return;
          if (typeof cfg.need === 'function' && !cfg.need()) { markSeen(cfg.id); return; }
          page.insertBefore(buildBar(cfg), page.firstChild);
          markSeen(cfg.id); // 「一生一次」：显示即标记，避免忽略后反复打扰；要重看走设置里的重置
        } catch (e) {}
      }, 380);
    });
    mo.observe(page, { attributes: true, attributeFilter: ['hidden'] });
  });

  // ---- 空状态补动作（各页空态按钮 → 既有入口；空态字符串由各文件加一行，行为统一在这里） ----
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#memo-empty-add')) { const i = document.getElementById('memo-inp'); if (i) { try { i.focus(); } catch (e0) {} } return; }
    if (t.closest('#feed-empty-pub')) { const b = document.getElementById('feed-publish-btn'); if (b) b.click(); return; }
    if (t.closest('#dl-empty-put')) { const b = document.getElementById('d-put'); if (b) b.click(); return; }
  });

  // ---- 设置 → 工具 → 使用提示（重置重看；行 DOM 本文件注入，不改 template.html） ----
  (function injectSettingRow() {
    const sec = document.querySelector('#page-setting .them-sec[data-sec="tools"]')
      || document.querySelector('#page-setting .them-sec[data-sec="about"]');
    if (!sec) return;
    const grp = document.createElement('div');
    grp.className = 'set-group glass';
    grp.innerHTML = '<div class="set-row" id="row-pagetips">'
      + '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z"/><path d="M10 19h4"/></svg></div>'
      + '<div class="txt">使用提示<span class="sub">重置后，字卡库 / 美化 / 回复设置等页面会再提示一次怎么上手</span></div>'
      + '<div class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>'
      + '</div>';
    sec.appendChild(grp);
    // FIX 2026-09-16 #589「点击使用提示没有任何反应」：原实现只调 window.toast，而全项目
    // 从未给 window.toast 赋过值（device.js 记录过同一个死通道）——重置其实已经成功，只是
    // 没有任何可见反馈（设置页没有 .pc-bar 可移除，屏幕上零变化）。保留 window.toast 优先
    // （哪天真的挂上就直接用），否则自绘 #cc-toast（全站统一样式，见 chat-pages.css，
    // 与 device.js 的 diagToast / feature-hub 同款观感）。
    function tipToast(msg) {
      try { if (typeof window.toast === 'function') { window.toast(msg); return; } } catch (e) {}
      try {
        let t = document.getElementById('cc-toast');
        if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
        t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
        clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2400);
      } catch (e) {}
    }
    const row = grp.querySelector('#row-pagetips');
    if (row) row.addEventListener('click', function () {
      resetAll();
      tipToast('已重置：再进入那些页面会重新看到上手提示');
    });
  })();

  window.mochiPageTipsReset = resetAll; // 供验证脚本/调试复位
})();

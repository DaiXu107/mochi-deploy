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
      name: '字卡库（公用 / 专属）',
      open: ['.tab[data-page="page-chatcard"]'],
      skipText: '你已经有字卡，这页不再提示',
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
      name: '手机桌面美化',
      open: ['#row-appearance'],
      tip: '这一页有主题色、壁纸、图标、字号、圆角、组件七八组——先用「方案」一键套用，再按需要逐项微调。',
      act: { label: '去套用方案', go: ['.them-tab[data-tab="scheme"]'] },
      hubs: ['#row-appearance']
    },
    {
      id: 'reply-settings', page: 'page-reply-settings',
      name: '回复设置',
      open: ['#row-general'],
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
      '[data-theme="dark"] .pc-item{border-bottom-color:rgba(255,255,255,.08)}' +
      // 使用提示面板（#640）：底部半框，配色与定位同 .mg-guide / #beauty-drawer 一族
      '.pc-sh-mask{position:fixed;inset:0;z-index:97;background:rgba(0,0,0,.42);display:flex;align-items:flex-end;justify-content:center;-webkit-tap-highlight-color:transparent}' +
      '.pc-sh-mask[hidden]{display:none}' +
      '.pc-sh{width:min(430px,100%);max-height:84vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:18px 18px 0 0;padding:16px 14px calc(14px + var(--mochi-safe-bottom,env(safe-area-inset-bottom,0px)));box-shadow:0 -10px 34px rgba(0,0,0,.3)}' +
      '.pc-sh-t{font-size:16px;font-weight:800;text-align:center;margin-bottom:4px}' +
      '.pc-sh-s{font-size:12px;line-height:1.7;color:var(--muted,#888);margin-bottom:12px}' +
      '.pc-sh-item{padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.04);margin-bottom:8px;cursor:pointer}' +
      '.pc-sh-item:active{transform:scale(.99)}' +
      '.pc-sh-h{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700}' +
      '.pc-sh-st{flex:1;font-weight:400;font-size:11px;color:var(--muted,#888)}' +
      '.pc-sh-go{flex:0 0 auto;font-size:12px;font-weight:700;color:#2f6fd0;white-space:nowrap}' +
      '.pc-sh-d{font-size:12px;line-height:1.7;color:var(--muted,#777);margin-top:4px}' +
      '.pc-sh-msg{margin:2px 2px 10px;padding:9px 11px;border-radius:10px;background:rgba(47,111,208,.12);color:#2f6fd0;font-size:12px;line-height:1.65}' +
      '.pc-sh-msg[hidden]{display:none}' +
      '.pc-sh-foot{display:flex;gap:9px;margin-top:4px}' +
      '.pc-sh-btn{flex:1;padding:12px;border:0;border-radius:12px;font-size:13px;font-weight:700;font-family:inherit;background:rgba(0,0,0,.07);color:var(--ink,#111);cursor:pointer}' +
      '.pc-sh-btn.main{background:var(--ink,#111);color:var(--card-bg,#fff)}' +
      '[data-theme="dark"] .pc-sh-item{background:rgba(255,255,255,.07)}' +
      '[data-theme="dark"] .pc-sh-btn{background:rgba(255,255,255,.12)}' +
      '[data-theme="dark"] .pc-sh-btn.main{background:#8fb4ef;color:#111}' +
      '[data-theme="dark"] .pc-sh-go{color:#8fb4ef}';
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

  // #1421 提示条不许把列表窗口挤窄：这一族页面自己不滚（`scrollHeight==clientHeight`），滚动权在
  // 内层那扇窗口上（.gs-scroll/.cal-scroll 那一族——回复设置、美化页都是）。挂在页首＝条子常驻在
  // 窗口上方当第二层头部：360×640 实测回复设置的窗口被压到 419px、顶部 372px 划下去毫无反应，
  // 正是 #1411 那一族「页面跟着屏幕一起固定」的同一条几何。判据只看现算的两个事实（页有没有滚动
  // 区间、子树里谁真的在裁剪内容），零机型／零 UA 分支；整页滚的页（字卡库、存储查看）照旧挂页首。
  function mountBar(page, bar) {
    if (page.scrollHeight - page.clientHeight > 0) { page.insertBefore(bar, page.firstChild); return; }
    const all = page.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const n = all[i];
      if (n === bar || (n.closest && n.closest('.pc-bar'))) continue;
      let oy = '';
      try { oy = getComputedStyle(n).overflowY; } catch (e) { continue; }
      if (!/(auto|scroll)/.test(oy)) continue;
      if (!n.firstElementChild || n.clientHeight < 120) continue;
      n.insertBefore(bar, n.firstChild);
      return;
    }
    page.insertBefore(bar, page.firstChild);
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
          mountBar(page, buildBar(cfg));
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
      + '<div class="txt">使用提示<span class="sub">点开可看每页会提示什么、重新显示这些上手提示、直接去对应页面</span></div>'
      + '<div class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>'
      + '</div>';
    sec.appendChild(grp);
    // FIX 2026-09-16 #592「点击使用提示没有任何反应」：原实现只调 window.toast，而全项目
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
    if (row) row.addEventListener('click', function () { openSheet(); });

    // FIX 2026-09-16 #640（用户第二次报「点击使用提示什么反应也没有，根本没有设计这个功能」）：
    // #592 修好了「点击的唯一反馈是死通道」这一层，但整行在屏幕上仍然只有两个落脚点——2.4 秒后
    // 自动消失的 toast，和设置页看不见的 .pc-bar 移除。用户无法判断它做了什么，更无从知道该去
    // 哪几页看；而且行文案把「字卡库」写在最前，已有字卡的用户进字卡库本就按设计不再提示
    // （REG.chatcard.need）＝承诺里最显眼的那条永远不出现。故点击改为开一个面板：把「哪几页有
    // 提示、每页提示什么、现在还会不会再提示、重置结果」全部摆在屏幕上（结果常驻到关闭），
    // 并能从面板直接去对应页面。tipToast 保留给重置动作做即时反馈（见上 #592）。
    let sheet = null;
    function willShow(cfg) {
      try { return !(typeof cfg.need === 'function' && !cfg.need()); } catch (e) { return true; }
    }
    function ensureSheet() {
      if (sheet && sheet.isConnected) return sheet;
      sheet = document.createElement('div');
      sheet.className = 'pc-sh-mask';
      sheet.id = 'pc-sheet-mask'; // id 形态：mobile-adapt FLOAT_SELECTORS / tabs 返回键清单按 id 登记
      sheet.hidden = true;
      sheet.innerHTML = '<div class="pc-sh">'
        + '<div class="pc-sh-t">使用提示</div>'
        + '<div class="pc-sh-s">复杂页面第一次进去会自己在页面里显示一条「先把这页用起来」；看过就不再打扰。可以在这里重新显示，也可以直接去对应页面。</div>'
        + '<div class="pc-sh-list"></div>'
        + '<div class="pc-sh-msg" hidden></div>'
        + '<div class="pc-sh-foot">'
        + '<button type="button" class="pc-sh-btn main" data-shreset="1">重新显示这些提示</button>'
        + '<button type="button" class="pc-sh-btn" data-shclose="1">关闭</button>'
        + '</div></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', function (e) {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-shclose]') || t === sheet) { closeSheet(); return; }
        if (t.closest('[data-shreset]')) {
          resetAll();
          tipToast('已重置：再进入那些页面会重新看到上手提示');
          renderSheet(true);
          return;
        }
        const it = t.closest('[data-shgo]');
        if (it) {
          const cfg = REG[parseInt(it.getAttribute('data-shgo'), 10)];
          closeSheet();
          if (cfg) setTimeout(function () { runGo(cfg.open); }, 60); // 等遮罩收起再切页，免与入场动画抢帧
        }
      });
      return sheet;
    }
    function renderSheet(justReset) {
      if (!sheet) return;
      let html = '';
      REG.forEach(function (cfg, i) {
        const ok = willShow(cfg);
        html += '<div class="pc-sh-item" data-shgo="' + i + '">'
          + '<div class="pc-sh-h"><span>' + cfg.name + '</span>'
          + '<span class="pc-sh-st">' + (ok ? '下次进入会提示' : (cfg.skipText || '这页当前不需要提示')) + '</span>'
          + '<span class="pc-sh-go">去看看 →</span></div>'
          + '<div class="pc-sh-d">' + cfg.tip + '</div></div>';
      });
      sheet.querySelector('.pc-sh-list').innerHTML = html;
      const msg = sheet.querySelector('.pc-sh-msg');
      if (justReset) {
        let n = 0;
        REG.forEach(function (c) { if (willShow(c)) n++; });
        msg.textContent = n
          ? '已重新显示：进入上面标着「下次进入会提示」的 ' + n + ' 个页面，就会看到「先把这页用起来」提示条。'
          : '已重新显示：不过这几页目前都不需要提示（条件见上方说明）。';
        msg.hidden = false;
      } else {
        msg.hidden = true; msg.textContent = '';
      }
    }
    function openSheet() { ensureSheet(); renderSheet(false); sheet.hidden = false; }
    function closeSheet() { if (sheet) sheet.hidden = true; } // 关＝置 hidden（属性变更会解开 mobile-adapt 的背景滚动锁）
  })();

  window.mochiPageTipsReset = resetAll; // 供验证脚本/调试复位
  window.mochiPageTipsPanel = function () { // 供验证脚本/调试直达面板
    const row = document.getElementById('row-pagetips');
    if (row) row.click();
  };
})();

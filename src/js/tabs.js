// ===== 功能：底部 tab 页面切换 + 独立全屏页导航隐藏 + 状态栏隐藏 =====
(function () {
  const tabs = document.querySelectorAll('.tab');
  const pages = document.querySelectorAll('.page');
  // v3.27.x：切页前抢拍钩子（device.js 屏幕适配监视注册 __mochiLeaveSnap）——
  // syncChrome 的 blur 会在切页瞬间触发键盘残留自愈（#209 K70 实锤：停靠残留只
  // 存在于切页前最后一帧），必须在 pages hidden 之前同步采集，晚了就是自愈后
  const sdLeaveSnap = () => { try { if (window.__mochiLeaveSnap) window.__mochiLeaveSnap('switch'); } catch (e) {} };

  // ===== FIX 2026-09-19 #815：整屏空白（一个页面都不显示）一帧内自愈 =====
  // 现象（华为 Nova 12 Pro + QQ 浏览器实报「经常整屏空白、还会闪」，用户明说其他机型也有）：
  // 本机自带屏幕诊断的历史签名给出实锤——`[switch] ✗底部导航栏悬空 phone=647(底647) tab=106`
  // 连捕 4 次：.phone 高 647 铺满视口、底部导航却停在 106px，即 flex 列里只剩状态栏＋导航栏，
  // **一个 .page 都没在显示**（`.page[hidden]{display:none}`）。用户看到的就是整屏空白。
  // 根因（与机型无关，纯写法）：全项目 30+ 处切页都是「先把所有 .page 打 hidden、再显目标页」
  // 的非原子链路（本文件下方、chat.js:6905、feature-data.js:597、card-audit.js:962/999/1216、
  // arcade.js:208、accounting.js:634…），中间任一步落空就永久停在「零可见页」：目标 id 拼错/
  // 改名（getElementById→null 直接 TypeError）、页面由外置 js/ 提供而那次没拉进来（#802）、
  // 且多数站点整个函数还包在 try/catch 里＝静默无报错。旧底部 tab 切页正是最典型的一处。
  // 修法＝把「.phone 内任何时刻恰有一个可见 .page」立成不变量：每次切页记下最后那个可见页，
  // 扫到零可见时下一帧复查（rAF＝让同任务「先关后开」的正常中间态走完，绝不误伤），仍零可见
  // 就把最后可见页显回来（兜底 page-phone），并留一笔现场（window.__mochiBlankHeal ＋
  // __jsErrors，下份诊断报告能直接点出是谁把页关没了）。空白由「永久卡死」变成用户看不见的一帧。
  let _lastVisId = '', _healAt = 0, _healRaf = 0;
  // #1445：桌面模糊载体（.phone）的静态锚缓存——与 #338 的 _scPhone 同款假设（.phone 是
  // template.html 静态锚点），只在第一次真正要用时查一次
  let _blurPh = null;
  try { window.__mochiBlankHeal = window.__mochiBlankHeal || { n: 0, at: 0, last: '' }; } catch (e0) {}
  function liveVisiblePage() {
    const live = document.querySelectorAll('.page');
    for (let i = 0; i < live.length; i++) if (!live[i].hidden) return live[i];
    return null;
  }
  function healBlank() {
    if (_healRaf) return;
    _healRaf = requestAnimationFrame(() => {
      _healRaf = 0;
      try {
        if (liveVisiblePage()) return; // 正常中间态：已经有人把页显出来了
        // 开屏未退／数据未回填完＝布局本就还没稳，与屏幕诊断监视器同一套守卫，不做主张
        const sp = document.getElementById('splash');
        if (sp && !sp.classList.contains('hide')) return;
        if (!window.__mochiDataReady) return;
        const now = Date.now();
        if (now - _healAt < 800) return;
        const back = document.getElementById(_lastVisId) || document.getElementById('page-phone');
        if (!back) return;
        _healAt = now;
        back.hidden = false;
        const h = window.__mochiBlankHeal;
        h.n++; h.at = now; h.last = back.id;
        try { if (window.__jsErrors) window.__jsErrors.push('整屏空白自愈 ' + h.n + ' 次：切页后无任何可见页面，已补回 ' + back.id + '（最后可见页 ' + (_lastVisId || '?') + '）'); } catch (e1) {}
      } catch (e2) {}
    });
  }
  // 切页关页一律走实时清单：本文件顶部的 pages 是 load 期静态快照，而 page-market /
  // page-giftbox / page-memo / page-tongpin / page-eat / page-pomodoro … 是运行中才建的
  // （gift-shop.js:1493、p2-features.js:2495 等），快照关不到它们 → 从这些页点底部 tab 会
  // 两页同显、两个 .page 各 flex:1 平分高度＝下半屏一片空白（多机型同现的另一条空白路）。
  function hideAllPages() {
    document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // 同值不写：#336/#338 不唤醒无关页观察器
  }
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sdLeaveSnap();
      // FIX #815：先拿目标页再关其它页——旧写法关完才 getElementById，目标取不到就是
      // TypeError，而此时全部页已 hidden＝整屏空白卡死。取不到目标就一页都不关。
      const target = document.getElementById(tab.dataset.page || '');
      if (!target) {
        try { if (window.__jsErrors) window.__jsErrors.push('底部 tab 目标页缺失（data-page=' + (tab.dataset.page || '?') + '），已放弃本次切页'); } catch (e3) {}
        return;
      }
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      hideAllPages();
      target.hidden = false;
      // #976：切页瞬间暂停壁纸全屏模糊（真机实测「切页后」单帧 2787ms），400ms 后自动恢复；
      // 与桌面滑页（desktop-slider #976）共用同一类名与同一个收尾计时，重叠时后者说了算，无副作用
      // #1445：只在桌面真的开着背景模糊时才切这个类。该类全站唯一消费者是 home.css 的
      // `html.desk-swiping .phone.desk-blur-on #phone-bg-layer{filter:none}`——而 .desk-blur-on 只在
      // 「模糊>0 且走 CSS filter 那条载体」时挂（personalize.js applyBgBlur／deskBlurRender 兜底）。
      // 未开模糊（出厂默认，本次报告现场也是「模糊=关」）时那条规则永不匹配＝零收益；而对 <html>
      // 增删类名会让整棵文档的样式失效重算（本报告现场 20020 节点 × 5664 条规则），一次切页白付两遍。
      // 判据只问「模糊载体在不在」这一个内核无关事实，零机型／零 UA 分支。
      try {
        const ph = _blurPh || (_blurPh = document.querySelector('.phone'));
        if (ph && ph.classList.contains('desk-blur-on')) {
          document.documentElement.classList.add('desk-swiping');
          clearTimeout(window.__mochiBlurT);
          window.__mochiBlurT = setTimeout(function () { document.documentElement.classList.remove('desk-swiping'); }, 400);
        }
      } catch (e0) {}
    });
  });

  // 独立全屏页：隐藏底部导航栏 + 状态栏（Mochi/时间），页面自身补偿内边距
  const FULL_PAGES = ['page-chat', 'page-group-chat', 'page-chat-settings', 'page-custom-cards', 'page-default-cards', 'page-fun-cards', 'page-mood-cards', 'page-reply-cards', 'page-theme', 'page-fav', 'page-fav-settings', 'page-memory', 'page-calendar', 'page-period', 'page-accounting', 'page-garden', 'page-divine', 'page-music', 'page-stats', 'page-interact', 'page-checkin', 'page-ta-ask', 'page-ta-ask-survey', 'page-ta-choose', 'page-ta-curious', 'page-ta-roast', 'page-ta-checkin', 'page-ta-invite', 'page-checkin-cards', 'page-quote-cards', 'page-home', 'page-mail', 'page-mail-write', 'page-mail-reply', 'page-feed', 'page-feed-all', 'page-feed-friends', 'page-license', 'page-about', 'page-guide', 'page-featurehub', 'page-reply-settings', 'page-call-settings', 'page-sfx-settings', 'page-memo-arc', 'page-cjian', 'page-room', 'page-drift', 'page-my-arc', 'page-mood'];
  // FIX 2026-09-11 #338：静态锚点缓存（.phone/.tabbar）+ syncChrome 签名早退（见下方注释）
  let _scPhone = null, _scTabbar = null, _scLastSig = null;
  function syncChrome() {
    // FIX 2026-09-11 #338 手机端卡顿成分（多机型「经常卡、按不动」同族）：syncChrome 挂在
    // 44 个 .page 的 hidden 观察器上，切桌面/进出聊天一次会触发几十次回调，旧实现每次都
    // querySelector('.phone') + querySelector('.tabbar') + querySelectorAll('.page') 全量扫描
    // （4× CPU 降频实测：连切 4 次桌面仅此一处 ≈420ms 主线程）。页面/tabbar/phone 都是
    // template.html 静态锚点（本文件顶部 pages 常量同款假设），缓存后按「可见页+全屏态」
    // 签名早退：签名没变（没有发生真正的切页）就不重复写、不 blur；外部 rAF 舞步
    // （p2-features/memo-app 自定义全屏页）依赖的恢复语义不变——它们开页时签名必然变化。
    let visible = null;
    for (let i = 0; i < pages.length; i++) { if (!pages[i].hidden) { visible = pages[i]; break; } }
    // FIX #815：静态快照扫不到可见页时再用实时清单复查一次——运行中才建的 .page（page-memo
    // 等）不在快照里，旧代码在这种状态下永远算不出可见页（chrome 判定失效），也就看不见
    // 「零可见＝整屏空白」这个致命态。稳态切页恒走上面那条缓存扫描，零额外开销。
    if (!visible) visible = liveVisiblePage();
    if (visible) _lastVisId = visible.id;
    else healBlank();
    const isFull = visible ? FULL_PAGES.indexOf(visible.id) >= 0 : false;
    const sig = (visible ? visible.id : '') + '|' + (isFull ? '1' : '0');
    if (sig === _scLastSig) return;
    _scLastSig = sig;
    const phone = _scPhone || (_scPhone = document.querySelector('.phone'));
    const tabbar = _scTabbar || (_scTabbar = document.querySelector('.tabbar'));
    if (tabbar) tabbar.hidden = isFull;
    if (phone) phone.classList.toggle('no-statusbar', isFull);
    if (visible) visible.classList.toggle('full', isFull);
    // v3.5.116：页面切换时收起输入法——输入框若仍聚焦，键盘会盖住新页面，
    // 全屏/手机端表现为「按钮位置错误、页面被键盘挡一半」（切回桌面/聊天设置等）
    // v3.5.127：contenteditable 输入框（聊天输入栏 div 版）同样需 blur 收起输入法
    try {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) ae.blur();
    } catch (e) {}
  }
  // 监听所有页面 hidden 变化（任何页面切换都会触发）
  document.querySelectorAll('.page').forEach(p => {
    const mo = new MutationObserver(syncChrome);
    mo.observe(p, { attributes: true, attributeFilter: ['hidden'] });
  });
  syncChrome();

  // 外观与主题：设置页点击进入独立页面，返回回设置页
  const appearanceRow = document.getElementById('row-appearance');
  const themePage = document.getElementById('page-theme');
  const themeBack = document.getElementById('theme-back');
  if (appearanceRow && themePage) {
    appearanceRow.addEventListener('click', () => {
      sdLeaveSnap();
      hideAllPages(); // FIX #815：实时清单，运行中才建的 .page 也一并关掉
      themePage.hidden = false;
    });
  }
  if (themeBack) {
    themeBack.addEventListener('click', () => {
      sdLeaveSnap();
      const setPage = document.getElementById('page-setting');
      if (!setPage) { hideAllPages(); themePage.hidden = false; return; } // FIX #815：兜底退回主题页，不留零可见页
      hideAllPages();
      setPage.hidden = false;
    });
  }
})();

// ===== 全屏 PWA 安卓返回键（v3.5.96）：先关弹层 → 回上一页 → 最后退出应用 =====
// 全屏模式下没有浏览器返回栏，安卓返回手势/按键默认直接退出应用；
// 改为与微信一致：弹层优先关闭，其次页面回退（页面切换入栈），栈空才退出
(function () {
  // 仅 PWA 安装模式（standalone/fullscreen）启用返回键拦截；浏览器标签页模式交给浏览器自带返回
  const inPwa = window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (!inPwa) return;
  const PAGES = Array.from(document.querySelectorAll('.page'));
  function visiblePage() { return PAGES.find(p => !p.hidden); }
  const first = visiblePage();
  if (first) history.replaceState({ page: first.id }, '');
  let stack = [];
  // v3.5.132：初始页入栈——否则从桌面直接进入任何页面（第一跳只 push 1 个条目），
  // 返回键判定 stack.length<=1 直接放行，无法回到桌面
  if (first) stack.push(first.id);
  const mo = new MutationObserver(() => {
    const v = visiblePage();
    if (!v) return;
    const last = stack.length ? stack[stack.length - 1] : null;
    if (last !== v.id) {
      stack.push(v.id);
      history.pushState({ page: v.id }, '');
    }
  });
  PAGES.forEach(p => mo.observe(p, { attributes: true, attributeFilter: ['hidden'] }));
  window.addEventListener('popstate', () => {
    // 1) 弹层优先关闭（不改变页面栈）——与 mobile-adapt.js 的滚动穿透锁同一组浮层，
    //    微信式交互：按返回先关面板（表情/更多/拍一拍/搜索/半框等），再退页面
    const layers = ['img-view-mask', 'modal-mask', 'qa-mask', 'tc-mask', 'poke-card', 'emoji-panel',
      'chat-more-panel', 'chat-search', 'chat-decision-panel', 'chat-divine-panel', 'chat-snake-panel',
      'avlib-card', 'ck-panel', 'feed-notice-panel', 'desk-msg', 'chat-ask-panel', 'msg-actions',
      // FIX 2026-09-16 #640：设置 → 工具 →「使用提示」面板（page-coach.js 动态创建，登记进
      // mobile-adapt 的 FLOAT_SELECTORS 同族）——返回键先关面板，不直接退页面
      'pc-sheet-mask',
      // #764：屏幕适配微调面板（personalize.js 动态创建）——返回键先关面板；
      // 这里只置 hidden，入口点击侧已做 panel.hidden=false 复活，不会留 zombie
      'screen-adj-panel'];
    for (const id of layers) {
      const el = document.getElementById(id);
      if (el && !el.hidden) { el.hidden = true; return; }
    }
    const mg = document.querySelector('.mg-mask:not([hidden])');
    if (mg) { mg.hidden = true; return; }
    // 2) 来电中 → 走完整拒绝逻辑；通话中 → 挂断
    const callMask = document.getElementById('call-mask');
    if (callMask && !callMask.hidden) {
      const reject = document.getElementById('call-reject-btn');
      if (reject && !reject.hidden) { reject.click(); return; }
      const hang = document.getElementById('call-hang-btn');
      if (hang && !hang.hidden) { hang.click(); return; }
      callMask.hidden = true;
      return;
    }
    // 3) 回上一页；已在初始页 → 不拦截，浏览器/系统退出应用
    if (stack.length <= 1) return;
    stack.pop();
    const target = stack[stack.length - 1];
    // v3.27.x：返回键回退也是切页，hidden 前同样抢拍（本 IIFE 无 sdLeaveSnap 引用，直调钩子）
    try { if (window.__mochiLeaveSnap) window.__mochiLeaveSnap('switch'); } catch (e) {}
    PAGES.forEach(p => { p.hidden = p.id !== target; });
    // v3.5.131：返回键回退页面时同步退出桌面装修模式（否则 editing 类残留，
    // 之后点 app 图标被 `if (editing) return` 静默吞掉，表现为"点了没反应"）
    try {
      if (window.exitDecor) window.exitDecor();
    } catch (e) {}
    // 补回一个 history 条目，防止浏览器误判直接退出
    history.pushState({ page: target }, '');
  });
})();

// ===== 功能：PWA（安装到桌面/主屏 + beforeinstallprompt 安装按钮 + 静默更新最新版）=====
(function () {
  // v3.6.x：请求持久化存储——iOS Safari / 安卓 Chrome 在设备存储紧张或配额记账异常时
  // 会直接清掉整个源（origin）的网站数据（localStorage + IndexedDB 一起没，用户表现
  // 为「每次重新打开都是全新、聊天记录全丢」；WebKit 有同款已知 bug：
  // bugs.webkit.org/266559——配额未初始化导致所有网站的 localStorage/IDB 周期性被清）。
  // persist() 获批后该源数据豁免「存储压力清理」，是本应用（数据全在本地）唯一
  // 的官方防线；iOS Safari 15.4+ 支持，获批失败静默忽略，不影响任何功能。
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
  } catch (e) {}

  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 3000);
  }

  // ================= v3.26.x：#279 自动升级防打断——用户活动感知 =================
  // 多机型（iQOO12 Chrome 等，机型无关）反馈「用着用着页面自己重开回开屏、问答门又要重答」：
  // #273 冷加载自动升级的 reload 在 PRECACHE_NOW 预取完成那一刻无条件落地，弱网（GitHub
  // Pages 国内 3.6MB+ 产物）预取可达几十秒，正好砸进用户已开始的会话（打字/切页/答问答门）。
  // 通用根因修复、零机型分支：捕获级记本页面首次交互（触摸/按下/按键）时刻，自动重载
  // 落地前复核——用户已操作且页面在前台就放弃重载、退回常驻更新条；页面在后台时照常重载
  //（回前台即新版）。手动点「刷新使用新版」不受此限。与 v3.5.114 撤销 SW 通道自动刷新
  //（「刚进入桌面就被打断回到开屏」）同一设计取向。
  let _userActTs = 0;
  function markUserAct() { if (!_userActTs) _userActTs = Date.now(); }
  ['touchstart', 'pointerdown', 'mousedown', 'keydown'].forEach(function (t) {
    try { document.addEventListener(t, markUserAct, { capture: true, passive: true }); } catch (e) {}
  });
  // 自动重载放行条件：页面在后台（用户看不见、重载无感）或本页面用户还没碰过
  function autoReloadAllowed() {
    try { if (document.visibilityState === 'hidden') return true; } catch (e) {}
    return !_userActTs;
  }
  // 无头验证专用探针（tools/verify-auto-upgrade-guard.mjs 使用，只读）
  window.__pwaAutoUpgradeTest = { allowed: function () { return autoReloadAllowed(); } };

  // v3.10.x：点「刷新使用新版」——先让 SW 预取最新 index.html 写入当前缓存
  //（PRECACHE_NOW），收到回执后再 reload；弱网下 reload 的导航请求若直接走网络
  // 优先仍可能超时回退旧缓存 → 永远卡旧版。SW 回执或 2.5s 兜底超时后刷新。
  let _prMsg = null;
  function refreshNow(auto, autoTs) {
    // v3.26.x：ack 已在按钮 onclick 里写入（按版本 ts 免打扰），这里只管预取+刷新
    const doReload = function () {
      // #279：自动升级（auto=true）的重载落地前最后一刻复核——预取期间用户开始操作时
      // 放弃本次自动重载、退回常驻更新条由用户自选时机，绝不打断会话中途。
      if (auto && !autoReloadAllowed()) { showVerBar(autoTs); return; }
      try { location.reload(); } catch (e) {}
    };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        let done = false;
        if (_prMsg) navigator.serviceWorker.removeEventListener('message', _prMsg);
        _prMsg = function (e) {
          if (e.data && e.data.type === 'PRECACHE_DONE') { done = true; doReload(); }
        };
        navigator.serviceWorker.addEventListener('message', _prMsg);
        navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE_NOW', urls: ['./index.html', './version.json'] });
        setTimeout(function () { if (!done) doReload(); }, 2500); // 兜底：SW 预取异常也刷新
      } else {
        doReload();
      }
    } catch (e) { doReload(); }
  }
  // #570：开屏版本检测（ver-check.js）复用同一条「预取最新 index 再 reload」链——
  // 直接裸 location.reload 在弱网/iOS 会拿到旧缓存＝「刷了还在旧版」，必须走这里。
  window.mochiRefreshNow = function () { refreshNow(); };

  // ================= v3.26.x：更新条防重复（版本轮询 + SW 检测两通道共享） =================
  // 用户反馈「刷新到新版后顶部还提醒」：根因是 SW 交接期（新 SW 刚装完接管）与弱网
  // 旧缓存场景下，版本轮询 / SW updatefound 两条通道会在新页面上再次触发弹条。
  // 这里统一收口：① 点「刷新使用新版」或「稍后」后，记下当时线上 version.json 的版本 ts，
  // 之后只对「比这个版本更新」的部署再提醒——一天多次部署每次都会提醒一次，不会一天只弹一次；
  // ② 弹条前若页面 data-build-ts 已等于线上 version.json ts，说明已是最新，跳过。
  const VER_ACK_KEY = 'xy-home-v2:ver-update-ack-ts';
  // FIX 2026-09-07 #225 顶部更新条「一直重复提醒」（v3.26.x 按版本 ack 后用户复发报障）。残留两洞：
  // ① ack 只在点「刷新/稍后」时写——用户看到条不点（直接杀掉重开/切走），ack 不存在 → 同一版本每次打开都弹；
  // ② SW 通道拉 version.json 失败时 showVerBar() 无 ts 照弹，ack 被整体绕过（GitHub Pages 弱网常态）。
  // 收口（v2，按站点主口径修订：本站一天可能部署十几次，禁止任何按时间窗压制新版本提醒）：
  // ver-update-notify 记「最近弹过的版本 ts」——弹条即记、永久有效：同一版本只弹一次（无论点没点
  // 按钮、隔多久重开）；更新的版本（ts 更大）立即照弹，不受任何时间限制；ts 未知（拉版本失败）只在
  // 从没弹过条时才照弹（宁多勿漏只留给全新用户；真正的新版本由轮询通道在网络恢复后正常提醒，不会漏）。
  const VER_NOTIFY_KEY = 'xy-home-v2:ver-update-notify';
  let _verBarShown = false;
  // 用户上次已确认/已刷到的版本时间戳（0 = 从未确认过）
  function verAckTs() {
    try {
      const v = localStorage.getItem(VER_ACK_KEY);
      const n = Number(v);
      return (v && !isNaN(n) && n > 0) ? n : 0;
    } catch (e) { return 0; }
  }
  function verMarkAck(ts) {
    try { localStorage.setItem(VER_ACK_KEY, String(ts > 0 ? ts : Date.now())); } catch (e) {}
  }
  // 是否提醒：线上 ts 比用户上次确认的版本更新才弹；ts 未知（拉版本文件失败）宁多勿漏照弹
  function verShouldNotify(ts) {
    const n = Number(ts);
    if (!n || isNaN(n)) return true;
    return n > verAckTs();
  }
  function verLsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function verLsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // 弹条即记「ts|时刻」，不依赖用户点按钮——同版本只弹一次的依据（记录永久有效，不按时间过期）
  function verMarkNotify(onlineTs) {
    const n = Number(onlineTs);
    verLsSet(VER_NOTIFY_KEY, (n > 0 ? n : 0) + '|' + Date.now());
  }
  // FIX 2026-09-07 #225v2 是否已提醒过：同版本（记录 ts ≥ 线上 ts）不再弹；
  // ts 未知（拉版本失败）时只要弹过任何版本就不再照弹——「宁多勿漏」只保留给从没弹过条的
  // 全新用户，弱网绕过免打扰的口子堵死；真正的新版本由轮询通道在网络恢复后立即提醒，不会漏。
  function verSeen(onlineTs) {
    const last = verLsGet(VER_NOTIFY_KEY);
    if (!last) return false;
    const n = Number(onlineTs);
    if (!n || isNaN(n)) return true;
    const lastTs = Number(String(last).split('|')[0]);
    return lastTs >= n;
  }
  // v3.10.x：带超时的 fetch（5s），弱网不挂起；失败由调用方快速重试
  function fetchJson(url, ms) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    return fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (timer) clearTimeout(timer); if (!r.ok) throw new Error('bad'); return r.json(); })
      .catch(function (err) { if (timer) clearTimeout(timer); throw err; });
  }
  // 显示更新条（版本轮询 + SW 检测共用）：跨通道一次性去重 + 已确认过本版本不再提醒
  // FIX 2026-09-07 #225v2：追加 verSeen 一版一弹（同版本不重复弹；新版本立即弹，无任何时间窗）
  function showVerBar(onlineTs) {
    if (_verBarShown || !verShouldNotify(onlineTs) || verSeen(onlineTs)) return;
    _verBarShown = true;
    verMarkNotify(onlineTs);
    const barEl = document.getElementById('ver-update-bar');
    if (!barEl) { toast('已检测到新版本，刷新页面即可更新'); return; }
    barEl.hidden = false;
    const actEl = document.getElementById('ver-update-refresh');
    if (actEl) actEl.onclick = function () { verMarkAck(onlineTs); refreshNow(); };
    // v3.5.134：可关闭（"稍后"）——不挡用户当前操作；关闭即记为已确认当前版本
    const closeBtn = document.getElementById('ver-update-close');
    if (closeBtn) closeBtn.onclick = function () { verMarkAck(onlineTs); barEl.hidden = true; };
  }

  // ================= v3.6.x：新版本检测（版本文件轮询，iOS/安卓均可靠） =================
  // 纯 Service Worker 检测不可靠：sw 只在页面加载/导航时检查、iOS Safari 对 sw 更新
  // 事件支持差——用户开着旧页面永远收不到「新版本」提醒。
  // 方案：构建时在站点根目录生成 version.json（含构建时间戳），页面定期 fetch 对比；
  // 服务器时间戳更新即认为有新版本，显示常驻提示条，点击「刷新使用新版」立即刷新。
  // 当前页面读到的时间戳作为基线（首次 fetch 即最新 → 不误报）。
  (function () {
    const bar = document.getElementById('ver-update-bar');
    if (!bar) return;
    // #386：file:// 直开本地文件时浏览器禁止 fetch 同目录 json（origin 'null'），
    // 版本轮询只会每 5s 刷一条 CORS 报错并误弹「网络异常」，直接跳过（线上 http/https 才启用）。
    if (location.protocol === 'file:') return;
    let baseTs = null;      // 当前页面的版本时间戳（基线）
    let baseGot = false;
    // v3.7.x：基线在页面加载时直接从 splash-ver data-build-ts 确定（构建时注入），
    // 不依赖「首次 fetch 的 version.json」——旧逻辑首次 fetch 只设基线就 return，
    // 必须等 30 秒后第二次轮询才会比较；且旧缓存页面 + 网络拿到最新 version.json
    // 时基线被污染成最新版 → 永不提示更新。注入基线后第一次 fetch 即可比较
    (function () {
      const sv = document.getElementById('splash-ver');
      const t = sv && Number(sv.getAttribute('data-build-ts'));
      if (t > 0) { baseTs = t; baseGot = true; }
    })();
    // 防抖：检查到新版本后只提示一次，避免每次轮询都闪（跨通道去重在主作用域 showVerBar）
    let lastCheck = 0;
    let failCount = 0;
    function checkVersion() {
      // FIX 2026-09-14 #436 后台发热减负：保活音频豁免让本轮询在后台不节流——原先后台照跑＝
      // 每 15s 一次 version.json 网络请求，整夜周期性唤醒射频＝后台发热/耗电的纯浪费源。
      // 版本提醒条只对看得见屏幕的用户有意义：回前台有 visibilitychange/pageshow 即时检查兜底。
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      // v3.10.x：轮询 30s → 15s；检测失败后 5s 快速重试（GitHub Pages 国内弱网抖动时尽快恢复）
      const interval = failCount > 0 ? 5000 : 15000;
      if (now - lastCheck < interval) return;
      lastCheck = now;
      // 加时间戳参数绕过缓存：fetch 拿到的必须是最新 version.json
      const url = './version.json?v=' + now;
      fetchJson(url, 5000)
        .then(function (d) {
          failCount = 0;
          const ts = Number(d && d.ts);
          if (!ts || isNaN(ts)) { healNetHint(); return; }
          // 老版本页面无 data-build-ts 注入时回退旧逻辑（首次 fetch 当基线）
          if (!baseGot) { baseTs = ts; baseGot = true; healNetHint(); return; }
          // v3.30.x FIX：每次成功拉取都撤销弱网误报（若曾显示）——网络恢复即自愈，
          // 不再让「网络异常，未能确认最新版本」常驻顶部；随后发现有新版才弹更新条。
          healNetHint();
          if (ts > baseTs) showVerBar(ts);
        })
        .catch(function () { failCount++; maybeNetHint(); });
    }
    // v3.29.x：#273 弱网兜底。拉 version.json 持续失败（连遭 3 次超时）时，顶部更新条
    // 也给出「网络异常，未能确认最新版本」+「重试刷新」入口——否则弱网下页面常驻旧缓存、
    // 又拉不到版本文件，用户永远收不到任何提示＝「顶部刷新按钮消失」。点击复用 refreshNow()
    // （PRECACHE_NOW 预取最新 index 落盘 + reload），弱网也能尽量够到最新版；每页面加载只
    // 提示一次（内存守卫），不随 5s 轮询反复闪。网络恢复且真有新版时，正常 then 分支的
    // showVerBar 会覆盖本文案，不会与新版本提醒打架。
    // v3.30.x FIX（红米K80 Chrome 等多机型「刷新顶部总显示『网络异常』」）：原误报两个根因，
    // 一个都不在「真断网」：① 阈值过松（连 2 次 5s 超时即报）——GitHub Pages 国内弱网下
    // 5000ms 时常差几秒才回，慢而不挂也被当成断网；② netHealed 单向位，一旦置真，之后哪怕
    // 拉取成功也永不撤销文案 → 误报文案常驻顶部、刷新一次报一次。修复：阈值提到 3 次 +
    // 每次成功拉取调用 healNetHint() 复位文案/位（网络恢复即自愈，位回 false 可重新触发）。
    let netHealed = false;
    function healNetHint() {
      if (!netHealed) return;
      netHealed = false;
      failCount = 0;
      bar.hidden = true;
      const txt = bar.querySelector('.vub-txt');
      if (txt) txt.textContent = '检测到新版本';
      const act = document.getElementById('ver-update-refresh');
      if (act) act.textContent = '刷新使用新版';
    }
    function maybeNetHint() {
      if (netHealed || failCount < 3) return;
      netHealed = true;
      const txt = bar.querySelector('.vub-txt');
      if (txt) txt.textContent = '网络异常，未能确认最新版本';
      const act = document.getElementById('ver-update-refresh');
      const close = document.getElementById('ver-update-close');
      if (act) act.textContent = '重试刷新';
      bar.hidden = false;
      if (act) act.onclick = function () { refreshNow(); };
      if (close) close.onclick = function () { bar.hidden = true; };
    }
    checkVersion();
    setInterval(checkVersion, 5000); // 5s 触发一次，内部再按 15s/5s 节流
    // 切回前台时立即检查（用户在别的 tab 待了很久，回来立刻发现新版）
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkVersion();
    });
    // v3.29.x：#273 冷加载自愈。普通刷新 / 从桌面（standalone）启动 / 重进都触发
    // pageshow 且 persisted=false（b/f-cache 返回为 true，不升级）。做一次性版本对比：
    // 云端更新且本会话未尝试过 → tryAutoUpgrade 走 PRECACHE_NOW + reload 自动进新版；
    // 预取异常刷新后仍回旧版时由 session 守卫兜底退回更新条，不反复刷。
    document.addEventListener('pageshow', function (e) {
      if (e.persisted) return;
      fetchJson('./version.json?v=' + Date.now(), 5000).then(function (d) {
        const ts = Number(d && d.ts);
        if (!ts || isNaN(ts)) return;
        if (!baseGot) { baseTs = ts; baseGot = true; return; }
        if (ts > baseTs && !tryAutoUpgrade(ts)) showVerBar(ts);
      }).catch(function () { /* 网络不可用：不动静，等周期轮询网络恢复后弹条 */ });
    });
  })();

  // ================= v3.6.x：定期备份提醒（本地数据只存在浏览器，Safari 可能意外清空） =================
  // iOS Safari 会因存储压力/系统 bug（WebKit#266559）清掉整个源的 localStorage+IDB，
  // 用户表现为「每次重开数据全丢」。代码无法阻止系统级清空，唯一防线是定期导出备份文件
  //（存到 iOS「文件」App，清空后能一键恢复）。距上次成功导出超 INTERVAL 且近 INTERVAL 未提醒过时，
  // 在顶部显示提醒条（复用 ver-update-bar 样式，更新提示优先显示时让位）。
  // v3.3x.x：应需求把冷却从 7 天 → 2 天 → 现为 1 天——用户反馈「现在什么时间都不会出现提醒」，
  // 期望每天在进桌面时弹一次（不是每次启动都弹的天天打扰、也不是 7 天才一次那么久）。
  (function () {
    const bar = document.getElementById('backup-remind-bar');
    if (!bar) return;
    const G = 'xy-home-v2:';
    const DAY = 86400000;
    const INTERVAL = DAY;
    function ts(key) { try { return Number(localStorage.getItem(G + key)) || 0; } catch (e) { return 0; } }
    // v3.3x.x：开屏直接弹说明弹窗（用户需求）——把「为什么必须备份」讲清楚：
    // ① 浏览器/设备可能自动清空本地数据，任何手机/浏览器（含网页套壳转 App）都无法规避；
    // ② 若数据总也存不住（每次打开像没保存、一刷新就丢），多半是本机存储没能写进去（设备/浏览器异常）。
    // 顶部提醒条保留作兜底：弹窗组件未就绪时退回原提醒条，保证提醒不丢。
    // 返回值：'ok' 已弹；'busy' 已有其他弹窗占用（勿顶掉，稍后重试，且不写冷却）；'nofn' 弹窗组件不可用。
    function openBackupModal(days, everBacked) {
      if (typeof window.openModal !== 'function') return 'nofn';
      // 避让已有弹窗：openModal 全站唯一，若此刻首启引导/字卡锁提醒等弹窗已开，
      // 直接再弹会把它顶掉（pwa.js 的 mochi-restore-done 监听注册在最后，最易覆盖别人）。
      const mask = document.getElementById('modal-mask');
      if (mask && !mask.hidden) return 'busy';
      const intro = everBacked
        ? '距上次完整备份已 ' + days + ' 天。'
        : '你还没做过完整的数据备份（「备份聊天」只含聊天记录，不算完整备份）。';
      const TEXT =
        intro + '聊天记录、字卡、照片、设置等全部数据只保存在本机浏览器里，不在云端。\n\n' +
        '① 浏览器可能自动清空本地数据\n' +
        '存储空间不足、无痕/隐私模式、系统清理后台等都可能触发。不管什么手机、什么浏览器，' +
        '连网页套壳转 App 使用也一样，都无法规避——这是设备/平台的限制。\n' +
        '对策：善用「导出备份」把数据存成文件，定期导出，别只依赖本地存储。\n\n' +
        '② 若数据总也存不住，多半是本机存储异常\n' +
        '如果每次打开都像没保存、一刷新就丢，大概率不是正常的定期清空，' +
        '而是本机存储没能写进去（设备/浏览器异常），建议换个正常浏览器/设备使用。';
      const pills = [
        { label: '去备份', value: 'go' },
        { label: '备份聊天', value: 'chat' },
        { label: '稍后', value: 'later' }
      ];
      window.openModal('数据备份提醒', '', function (v) {
        if (v === 'go') { try { if (window.runBackupExport) window.runBackupExport(); } catch (e) {} }
        else if (v === 'chat') { try { if (window.runChatExport) window.runChatExport(); } catch (e) {} }
      }, { noInput: true, big: true, pillSubmit: true, staticText: TEXT, pills: pills });
      return 'ok';
    }
    function markReminded() { try { localStorage.setItem(G + '__last-backup-remind', String(Date.now())); } catch (e) {} }
    function show(days, everBacked, tries) {
      tries = tries || 0;
      // 版本更新提示优先（避免同屏叠两个提醒）
      const upd = document.getElementById('ver-update-bar');
      if (upd && !upd.hidden) return;
      const r = openBackupModal(days, everBacked);
      if (r === 'ok') { markReminded(); return; }
      // 已有弹窗占用：不顶掉对方、也不写冷却，1.5s 后重试（最多 6 次≈9s），期间对方关掉即可弹
      if (r === 'busy' && tries < 6) { setTimeout(function () { show(days, everBacked, tries + 1); }, 1500); return; }
      // 兜底（弹窗组件不可用或长时间被占用）：退回顶部提醒条，保证提醒不丢
      const txt = document.getElementById('backup-remind-txt');
      if (txt) {
        txt.textContent = everBacked
          ? '距上次导出备份已 ' + days + ' 天，数据只存本机浏览器，建议导出备份'
          : '数据只存在本机浏览器里，建议定期导出备份（防浏览器意外清除）';
      }
      bar.hidden = false;
      markReminded();
    }
    function tryShow() {
      if (window.__resetting) return;
      const lastBackup = ts('__last-backup');
      const lastRemind = ts('__last-backup-remind');
      if (lastRemind && Date.now() - lastRemind < INTERVAL) return; // 近期已提醒过
      if (lastBackup && Date.now() - lastBackup < INTERVAL) return; // 刚备份过
      show(lastBackup ? Math.max(Math.floor((Date.now() - lastBackup) / DAY), INTERVAL / DAY) : 0, !!lastBackup);
    }
    function gated() {
      // 全新安装/数据被清空的空状态不提醒（没有可备份的数据，避免噪音）
      try { if (!localStorage.getItem(G + 'contacts')) return; } catch (e) {}
      tryShow();
    }
    document.addEventListener('mochi-restore-done', gated);
    const poll = setInterval(function () {
      if (window.__mochiDataReady) { clearInterval(poll); gated(); }
    }, 300);
    const go = document.getElementById('backup-remind-go');
    if (go) go.addEventListener('click', function () {
      bar.hidden = true;
      try { if (window.runBackupExport) window.runBackupExport(); } catch (e) {}
    });
    // v3.3x.x：#355b 单独备份聊天记录（只导出聊天，体积小；不进 __last-backup，仍提示整体备份）
    const chat = document.getElementById('backup-remind-chat');
    if (chat) chat.addEventListener('click', function () {
      bar.hidden = true;
      try { if (window.runChatExport) window.runChatExport(); } catch (e) {}
    });
    const close = document.getElementById('backup-remind-close');
    if (close) close.addEventListener('click', function () { bar.hidden = true; });
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        // v3.5.114：不再自动刷新页面——原逻辑在检测到新 sw 后清旧缓存并 FORCE_RELOAD，
        // 会导致用户刚进入桌面就被打断回到开屏（每次构建 sw.js 都会变，更新频繁时必现）。
        // 新版 sw 用 skipWaiting 安装即接管 + activate 自动清旧缓存，当前页面可继续使用，
        // 下次刷新自然加载最新版；这里只轻提示一次（版本条已覆盖主要场景）。
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // v3.10.x：检测到新 SW 直接显示常驻更新条（原逻辑只 toast 一闪而过，
              // 用户容易看不到）；与版本轮询（version.json）双通道互补，任一命中即提示。
              // v3.26.x：防「刷新到新版后还提醒」——① 已确认过该版本（ack ts）不再弹；
              // ② 页面已是线上最新（data-build-ts 等于 version.json ts）时，SW 交接期的
              // updatefound 不再误报（新 SW 刚装完接管，页面其实已是最新）。
              try {
                const sv = document.getElementById('splash-ver');
                const localTs = (sv && Number(sv.getAttribute('data-build-ts'))) || 0;
                fetchJson('./version.json?v=' + Date.now(), 5000)
                  .then(function (d) {
                    const ts = Number(d && d.ts);
                    if (!ts || isNaN(ts) || ts > localTs) showVerBar(ts);
                  })
                  .catch(function () { showVerBar(); }); // 拉不到版本文件也照弹（宁多勿漏）
              } catch (e) {}
            }
          });
        });
      }).catch(() => {});
    });
  }

  // ================= v3.29.x：#273 普通刷新也能自愈进新版 =================
  // 缓存优先 + 后台静默刷新下，手动刷新先命中旧缓存、后台拉取弱网易超时 → 用户
  // “反复刷新仍旧版”。这里：冷加载（普通刷新/重进/桌面启动）时发现云端有更新版本，
  // 本会话首次直接走 refreshNow()（PRECACHE_NOW 预取最新 index 落盘再 reload），一跳
  // 进新版；session 守卫保证只尝试一次，预取失败刷新后仍回旧版时自动退回常驻更新条，
  // 绝不无限循环。周期轮询（15s/5s）与 SW updatefound 通道不动，只弹更新条不自动刷新，
  // 避免打断用户会话中途的操作（发消息/编辑中）。
  const AUTO_UPGRADE_KEY = 'xy-home-v2:auto-upgrade-session';
  function tryAutoUpgrade(autoTs) {
    try {
      if (sessionStorage.getItem(AUTO_UPGRADE_KEY)) return false;
      sessionStorage.setItem(AUTO_UPGRADE_KEY, String(Date.now()));
    } catch (e) { return false; }
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // #279：用户已在本页面开始操作（且前台）→ 不发自动重载，返回 false 让调用方
      // 走 showVerBar 常驻更新条；预取期间才开始操作的由 refreshNow 内部在重载前让路
      if (!autoReloadAllowed()) return false;
      refreshNow(true, autoTs);
      return true;
    }
    return false;
  }

  let deferredPrompt = null;
  const btn = document.getElementById('pwa-install');
  const hide = () => { if (btn) btn.hidden = true; };

  window.addEventListener('beforeinstallprompt', (e) => {
    // 不阻止默认行为：让浏览器自由弹安装提示，菜单安装不受影响
    deferredPrompt = e;
    if (btn) {
      // v3.5.123：聊天页（.page.full）可见时不显示安装按钮——避免遮挡输入栏/发送按钮
      const chatVisible = Array.from(document.querySelectorAll('.page')).some(p => p.id === 'page-chat' && !p.hidden);
      btn.hidden = chatVisible;
    }
  });

  // v3.5.131：聊天页可见性持续跟踪（原实现只在 prompt 触发时刻检查一次——
  // 之后进聊天页按钮仍悬在输入栏上方遮挡发送按钮）
  if (btn) {
    const chatPage = document.getElementById('page-chat');
    if (chatPage) {
      const mo = new MutationObserver(() => {
        if (deferredPrompt) btn.hidden = !chatPage.hidden;
      });
      mo.observe(chatPage, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  if (btn) {
    btn.addEventListener('click', () => {
      if (!deferredPrompt) {
        // beforeinstallprompt 未触发（不满足可安装条件 / 已安装过旧版 / 浏览器 UI 变化）→ 引导手动安装
        // v3.16.x：设备判定统一读 device.js（mochiDevice）——此前这里各自算 isIOS/isAndroid
        const d = window.mochiDevice || {};
        const isIOS = !!d.isIOS;
        const isAndroid = !!d.isAndroid;
        let guide = isIOS
          ? 'iPhone 安装：点底部「分享」按钮 → 「添加到主屏幕」。'
          : isAndroid
            ? '安卓安装：点右上角「⋮」菜单 → 「安装应用」。\n若没有该选项：① 确认打开的是最新版 https 页面；② 到手机设置里删除已安装的旧版「Mochi」后重试。'
            : '电脑安装：点地址栏右侧「安装」图标，或菜单 → 保存并分享 → 安装应用。';
        if (window.openModal) {
          window.openModal('安装到桌面', '', () => {}, { noInput: true, staticText: guide });
        } else {
          toast(guide);
        }
        return;
      }
      // v3.6.x：Edge 安卓 PWA 与浏览器标签页使用独立存储分区，安装后桌面应用看到的是空数据。
      // 安装前若检测到有数据且从未导出过备份，提示先导出——避免用户装完才发现"数据丢了"。
      // 仅 Edge 安卓触发（Chrome 安卓 PWA 与标签页共享存储，不打扰）。
      try {
        const ua = navigator.userAgent || '';
        const isEdgeAndroid = /android/i.test(ua) && /edg/i.test(ua);
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
        const G = 'xy-home-v2:';
        let hasData = false;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(G) === 0 && k !== G + '__onboard-done' && k !== G + '__edge-backup-hint-done') { hasData = true; break; }
        }
        if (isEdgeAndroid && !isStandalone && hasData && !localStorage.getItem(G + '__last-backup') && !localStorage.getItem(G + '__edge-backup-hint-done')) {
          try { localStorage.setItem(G + '__edge-backup-hint-done', String(Date.now())); } catch (e) {}
          if (window.openModal) {
            window.openModal('安装前建议先导出备份', '', () => {
              try { if (window.runBackupExport) window.runBackupExport(); } catch (e) {}
            }, {
              noInput: true,
              staticText: 'Edge 安卓的桌面应用与浏览器使用各自独立的存储空间，安装后从桌面打开会看到空数据（昵称/打卡/摸鱼天数都会是默认值）。\n\n建议先在浏览器里导出一份备份，安装到桌面后再导入即可恢复。\n\n· 点「确定」：立即导出备份（导出完成后再次点安装按钮即可安装）\n· 点「取消」：直接安装（之后可在设置页导出备份再导入）'
            });
            return;
          }
        }
      } catch (e) {}
      try {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((r) => {
          if (r.outcome === 'accepted') hide();
          deferredPrompt = null;
        });
      } catch (e) {
        // v3.5.131：prompt 抛错（事件已失效等）时兜底引导
        deferredPrompt = null;
        try { btn.hidden = true; } catch (e2) {}
        window.openModal('安装到桌面', '', () => {}, { noInput: true, staticText: '请在浏览器菜单中点击「安装应用」' });
      }
    });
  }

  window.addEventListener('appinstalled', hide);
  // iOS Safari 提示（无 beforeinstallprompt）
  // v3.16.x：设备判定统一读 device.js（mochiDevice）
  const isIOS = !!(window.mochiDevice || {}).isIOS;
  if (isIOS) {
    const iOSHint = document.getElementById('pwa-ios-hint');
    if (iOSHint) {
      try { if (window.navigator.standalone) { iOSHint.hidden = true; return; } } catch (e) {}
      setTimeout(() => { iOSHint.hidden = false; }, 60000);
      iOSHint.addEventListener('click', () => { iOSHint.hidden = true; });
    }
  }
})();

// ===== 全新环境引导：无任何数据时首次提示「可导入备份」 =====
// 背景：Edge 安卓「安装应用」的 PWA 与浏览器标签页使用独立存储分区
// （storage partition），用户从标签页换到桌面图标打开时看到的是全新空环境
// （昵称/打卡/摸鱼全默认值），误以为数据丢了。
// 注：Chrome 安卓 PWA 与标签页共享存储不隔离，这是 Edge 的实现策略差异。
// 判定：localStorage + IndexedDB 都没有 xy-home-v2: 数据键 → 全新环境。
// 时机：等数据就绪（__mochiDataReady）且开屏关闭后再弹——modal-mask z-index(90)
// 低于 splash(999)，开屏期间弹会被盖住。弹过一次写标记（含点取消），不再打扰。
(function () {
  const G = 'xy-home-v2:';
  const MARK = G + '__onboard-done';
  // localStorage 侧：无任何数据键（标记键除外）
  function freshLs() {
    try {
      if (localStorage.getItem(MARK)) return false; // 已提示过
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(G) === 0 && k !== MARK) return false; // 有任何数据键 → 老环境
      }
    } catch (e) { return false; }
    return true;
  }
  // IndexedDB 侧：大键（聊天/字卡/音乐等）可能只进 IDB 不占 localStorage，也要查
  function idbEmpty() {
    return new Promise((resolve) => {
      try {
        if (!window.idbGetAllKeys) { resolve(true); return; }
        window.idbGetAllKeys().then((keys) => {
          resolve(!(keys || []).some(k => String(k).indexOf(G) === 0));
        }).catch(() => resolve(true));
      } catch (e) { resolve(true); }
    });
  }
  // 开屏是否已关闭（clock.js：点击进入 → 加 .hide 类 → 400ms 后移除节点）
  function splashGone() {
    const s = document.getElementById('splash');
    return !s || !s.isConnected || s.classList.contains('hide');
  }
  function maybeShow() {
    if (!freshLs()) return;
    if (window.__resetting) return; // 重置/导入流程中不打扰
    idbEmpty().then((clean) => {
      if (!clean) return; // IndexedDB 有数据 → 不是全新环境
      // 先写标记：无论用户确定/取消，只提示这一次
      try { localStorage.setItem(MARK, String(Date.now())); } catch (e) {}
      if (!window.openModal) return;
      const go = () => {
        // 切到设置页并触发「导入数据」文件选择（row-import 已由 data-backup.js 绑定）
        try {
          const tab = document.querySelector('.tab[data-page="page-setting"]');
          if (tab) tab.click();
        } catch (e) {}
        setTimeout(() => {
          try {
            const row = document.getElementById('row-import');
            if (row) row.click();
          } catch (e) {}
        }, 120);
      };
      window.openModal('欢迎使用 Mochi', '', go, {
        noInput: true,
        staticText: '检测到当前是全新环境，还没有任何数据。\n\n· 如果之前在浏览器标签页里设置过昵称/打卡：点「确定」会打开设置页的数据导入，选择之前导出的备份文件即可全部恢复。\n\n· 如果是第一次使用：点「取消」直接开始设置即可。'
      });
    });
  }
  let ready = false;
  const poll = setInterval(function () {
    if (window.__mochiDataReady) ready = true;
    if (ready && splashGone()) {
      clearInterval(poll);
      setTimeout(maybeShow, 300); // 留一点开屏退出动画缓冲
    }
  }, 300);
})();
// ===== v3.26.x：防倒卖第二锚点——开屏两条官方声明「在位看门狗」（与 clock.js 运行时回填互为备份） =====
// clock.js 的回填负责加载时重建/篡改重写 + 官方远程刷新；这里是独立常驻兜底：任何时刻只要两条声明
// 缺失（二传者运行时删除、或 clock.js 回填整段被删），5 秒内用本地常量补回——想彻底去掉声明必须
// 同时改 clock.js 与本文件两处。只补缺失、绝不改写已在位内容，与 clock.js 的 marked 判定互不干扰。
(function () {
  const W1 = 'Mochi字卡网站完全免费，作者只有小红书这一个账号：小红书@言序（1842523578）。如有出现任何收费情况，均为诈骗，注意防止被骗。';
  const W2 = '二传、分享本站链接必须标注作者署名：小红书 @言序（1842523578），禁止删除或修改。严禁冒为自己制作、删除篡改署名，或以任何形式收费倒卖本站链接、安装包——本站完全免费，收费即诈骗。如果你是花钱买来的链接：你被骗了，请拒付退款并举报卖家。';
  function mkWatchBar(tag, title, text) {
    const b = document.createElement('div');
    b.className = 'splash-alert';
    b.setAttribute('data-anti-scam', tag);
    b.innerHTML = '<div class="splash-alert-t"></div><p></p>';
    b.querySelector('.splash-alert-t').textContent = title;
    b.querySelector('p').textContent = text;
    return b;
  }
  setInterval(function () {
    try {
      const n = document.getElementById('splash-notice');
      if (!n) return;
      // #315b 免责声明卡（data-anti-scam="d"）固定最顶——回填重建的 1/2 都插它后面；它被删时退回最顶（旧行为）
      const dis = n.querySelector('.splash-alert[data-anti-scam="d"]');
      if (!n.querySelector('.splash-alert[data-anti-scam="1"]')) {
        n.insertBefore(mkWatchBar('1', '防骗提醒', W1), dis ? dis.nextSibling : n.firstChild);
      }
      if (!n.querySelector('.splash-alert[data-anti-scam="2"]')) {
        const b1 = n.querySelector('.splash-alert[data-anti-scam="1"]');
        n.insertBefore(mkWatchBar('2', '转载署名 · 严禁倒卖', W2), b1 ? b1.nextSibling : (dis ? dis.nextSibling : n.firstChild));
      }
    } catch (e) { /* 静默：看门狗绝不能成为错误源 */ }
  }, 5000);
})();

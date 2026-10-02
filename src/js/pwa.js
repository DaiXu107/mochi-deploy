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
      // v8.x #956：申请一次不够——Safari/Chromium 按「用户互动历史」授予持久化，冷启动首次
      // 申请常直接返回 false 且此后不再有机会。这里首次用户手势（点/摸/按）后再补申请一次，
      // 提高获批率；只在未持久化时才申请，非 iOS/桌面端行为不变（persist 是幂等空操作）。
      const tryPersist = function () {
        try {
          if (navigator.storage.persisted) {
            navigator.storage.persisted().then(function (p) {
              if (!p) { try { navigator.storage.persist().catch(function () {}); } catch (e) {} }
            }).catch(function () { try { navigator.storage.persist().catch(function () {}); } catch (e) {} });
          } else {
            navigator.storage.persist().catch(function () {});
          }
        } catch (e) { try { navigator.storage.persist().catch(function () {}); } catch (e2) {} }
      };
      tryPersist();
      let _persistGestureDone = false;
      const onFirstGesture = function () {
        if (_persistGestureDone) return;
        _persistGestureDone = true;
        tryPersist();
      };
      ['touchend', 'pointerup', 'click', 'keydown'].forEach(function (t) {
        try { document.addEventListener(t, onFirstGesture, { capture: true, passive: true }); } catch (e) {}
      });
    }
  } catch (e) {}

  // v8.x #956：iOS 且当前不在「添加到主屏幕」的独立应用里 = ITP 7 天清空高危场景。
  // 判据统一走 device.js 的 isIOS（唯一判定源，含 iPadOS 伪装 UA 分支），standalone 读
  // navigator.standalone / display-mode（与 fullscreen.js、bg-keep.js 同款），零新增机型分支。
  window.mochiIosTabRisk = function () {
    try {
      if (!(window.mochiDevice || {}).isIOS) return false;
      if (navigator.standalone === true) return false;
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return false;
      return true;
    } catch (e) { return false; }
  };
  // #959f：关于段「iPhone/iPad 7 天规则」提醒条只对 iOS 显示——非 iOS 隐藏。
  // JS 未跑（脚本被截断等）＝保留不隐藏：宁可让安卓用户多读一句，也不误藏掉 iOS 用户的关键提醒。
  try {
    const _aboutIos = document.getElementById('about-ios-pwa-note');
    if (_aboutIos && !(window.mochiDevice || {}).isIOS) _aboutIos.hidden = true;
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
  // FIX 2026-09-21 #992：后台换版不得打断「后台保活 / 后台通知」（用户实报「浏览器网页没多久就
  //   自动刷新了，后台保活功能失效」）——这两个开关的存在意义就是页面在后台继续运行，而 #965 的
  //   待换版落地时刻恰好选在「页面转入后台那一刻」⇒ 一开保活、切走就被重载。无头实证：重载把
  //   运行中的保活音频拆掉（__kaProbe().ev.died +1）、页面重新回到开屏问答门，后台期间消息与
  //   通知全停，用户回来只看到「页面自己刷新了」。修法：换版落地前先看这两个开关——开着就只弹
  //   更新条、后台不落地，等用户哪次把开关关掉再切后台（或下次冷启动，开屏版本检查每次都会跑）
  //   自然换版；手动点「刷新使用新版」不受此限（与 #279 同口径）。
  function bgLivenessOn() {
    try {
      if (!window.xyStore) return false;
      const st = window.xyStore('xy-home-v2');
      return st.get('bg-keepalive') === '1' || st.get('bg-notify') === '1';
    } catch (e) { return false; }
  }
  // #965 自动升级「不放弃、也不打断」——待换版登记：页面前台且用户已交互时不再退回更新条
  // 收工（旧行为＝多数用户不会点更新条＝长期停在旧版、拿旧版 bug 反馈），改为先登记，等页面
  // 下一次转入后台（切走/回桌面/锁屏）时 reload 落地。iOS 上隐藏期的 reload 常被系统冻结到
  // 回前台才真正执行＝用户回到前台即新版、全程零打断。reload 会卸载页面，监听无需移除
  //（若极端内核忽略了隐藏期 reload，监听仍在，下次转后台会再试，不会卡死）。
  // #992：转后台那一刻若保活/通知开着则跳过——监听常挂，等关掉开关后那次转后台再落地。
  let _pendingAutoReload = false;
  function armAutoReloadWhenHidden() {
    if (_pendingAutoReload) return;
    _pendingAutoReload = true;
    const onHide = function () {
      try { if (document.visibilityState !== 'hidden') return; } catch (e) { return; }
      if (bgLivenessOn()) return; // #992：后台保活/后台通知开着＝后台要活着，不在后台换版
      try { location.reload(); } catch (e) {}
    };
    try { document.addEventListener('visibilitychange', onHide); } catch (e) {}
    // 登记这一刻若已不在前台（刚被切走/冻结），直接落地（同上闸门）
    try { if (document.visibilityState === 'hidden') onHide(); } catch (e) {}
  }
  // 无头验证专用探针（tools/verify-auto-upgrade-guard.mjs 使用，只读；#965 追加 pending/arm）
  window.__pwaAutoUpgradeTest = {
    allowed: function () { return autoReloadAllowed(); },
    pending: function () { return _pendingAutoReload; },
    arm: function () { armAutoReloadWhenHidden(); }
  };

  // v3.10.x：点「刷新使用新版」——先让 SW 预取最新 index.html 写入当前缓存
  //（PRECACHE_NOW），收到回执后再 reload；弱网下 reload 的导航请求若直接走网络
  // 优先仍可能超时回退旧缓存 → 永远卡旧版。
  // #944：SW 侧（#942）弱网会走不带超时的慢路径慢慢传完（实测 ~30KB/s 传 1.4~4MB 需
  // 50~130s），PRECACHE_DONE 因此可能一两分钟后才来——本函数随之改三处：
  // ① 手动通道全程有反馈：按钮变「正在下载…」、条文案写明「弱网可能需要一两分钟」，
  //    不再让用户点了没反应、以为新版有 bug；
  // ② 手动通道删掉 2.5s 无条件重载的旧兜底（它总在下载完成前把用户重载回旧缓存），
  //    改等 PRECACHE_DONE（上限 VER_DL_WAIT）；超时仍没等到＝下载没完成，如实告知并给
  //    「重试刷新」，不再骗用户重载回旧版；
  // ③ ack（「本版本已确认」免打扰记录）从按钮 onclick 挪到下载确认成功后写入——下载失败
  //    时本版本之后仍会再次提醒，不再出现「点了刷新没刷上、从此再无提示」的静默卡旧版。
  let _prMsg = null;
  let _prBusy = false; // 手动下载进行中（防重复点击叠监听/叠计时器）
  const VER_DL_WAIT = 180000; // 手动通道等 PRECACHE_DONE 的上限（弱网慢路径实测 50~130s，取宽裕值）
  let _prPing = 0, _prPingN = 0; // #1047：下载通道重发循环（见 refreshNow 手动分支注释）
  function refreshNow(auto, autoTs, ackTs) {
    const doReload = function () {
      // #279/#965：自动升级（auto=true）落地前复核——用户已操作且在前台时绝不打断会话，
      // 但也不再「放弃」（旧行为＝只弹更新条，多数用户不点＝长期旧版）：改登记待换版，
      // 页面下一次转后台时自动落地（切走/回桌面/锁屏），用户回来即新版。更新条照弹，
      // 想立刻升级的用户仍可手动点。
      if (auto && !autoReloadAllowed()) { armAutoReloadWhenHidden(); showVerBar(autoTs); return; }
      // #992：自动通道 + 保活/通知开着 ⇒ 就算此刻已经在后台也不换版（页面一重载＝后台保活/通知
      //   当场失效、还要回开屏重过问答门）。登记待换版并弹更新条，让用户自己挑时机手动刷。
      if (auto && bgLivenessOn()) { armAutoReloadWhenHidden(); showVerBar(autoTs); return; }
      try { location.reload(); } catch (e) {}
    };
    // #944：手动通道的过程反馈（自动通道静默，行为与 #273 时代一致）
    const barEl = document.getElementById('ver-update-bar');
    const txtEl = barEl ? barEl.querySelector('.vub-txt') : null;
    const actEl = document.getElementById('ver-update-refresh');
    const setUi = function (txt, btn) {
      if (auto) return;
      if (txtEl && txt) txtEl.textContent = txt;
      if (actEl && btn) actEl.textContent = btn;
    };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        let done = false;
        if (_prMsg) navigator.serviceWorker.removeEventListener('message', _prMsg);
        _prMsg = function (e) {
          if (e.data && e.data.type === 'PRECACHE_DONE') {
            done = true; _prBusy = false;
            if (_prPing) { clearInterval(_prPing); _prPing = 0; }
            try { window.__mochiVerDlBusy = false; } catch (x) {}
            // #944：新版已确认落进缓存，此刻才写 ack（下载失败不写＝本版本还会再次提醒）
            if (!auto && ackTs > 0) verMarkAck(ackTs);
            doReload();
          }
        };
        navigator.serviceWorker.addEventListener('message', _prMsg);
        if (!auto) {
          if (_prBusy) return; // 下载已在进行：忽略重复点击（监听器/计时器都只有一份）
          _prBusy = true;
          try { window.__mochiVerDlBusy = true; } catch (x) {}
          setUi('正在下载新版…网络慢时可能需要一两分钟，请保持页面打开', '正在下载…');
        }
        // PERF-PLAN 阶段 1：带上外置 js/ 清单——弱网点「刷新使用新版」时 ext 一并预取落新缓存，防旧 index 配新 ext 的混合版本（SW 侧零改动，urls 数组本就支持）
        const prUrls = ['./index.html', './version.json'].concat(window.__mochiExtFiles || []);
        navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE_NOW', urls: prUrls });
        if (!auto) {
          // #1047：「点更新没反应」根治——手动通道原来只在点击那一刻发一次 PRECACHE_NOW；
          // iOS WebKit 会把空闲的 SW 实例整只冻结（controller 引用还在），那一刻的消息可能
          // 没人收，PRECACHE_DONE 永不到来 ⇒ 按钮顶着「正在下载…」、_prBusy 把后续点击全部
          // 静默吞掉，最长干等 180s＝用户所见「点更新还点不动」。改 12s 一发重发同一条消息
          // （投递到已停实例＝浏览器先唤醒它；SW 侧重复收到只是重复回执，幂等）；DONE 即停、
          // 12 发封顶与 VER_DL_WAIT 对齐，超时路径一并清。自动通道不加（2.5s 兜底口径不变）。
          _prPingN = 0;
          if (_prPing) clearInterval(_prPing);
          _prPing = setInterval(function () {
            if (done || !navigator.serviceWorker || !navigator.serviceWorker.controller) { clearInterval(_prPing); _prPing = 0; return; }
            if (++_prPingN > 12) { clearInterval(_prPing); _prPing = 0; return; }
            try { navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE_NOW', urls: prUrls }); } catch (e) {}
          }, 12000);
        }
        if (auto) {
          setTimeout(function () { if (!done) doReload(); }, 2500); // 自动通道保持 2.5s 兜底（#273 时代行为）
        } else {
          // #944：手动通道等满 VER_DL_WAIT 仍无回执＝下载没完成——如实告知＋可重试，
          // 不再重载（重载只会回到旧缓存），并回滚「弹过条」记录让本版本之后能再次提醒
          //（否则 verSeen 把本版本记成已提醒，用户从此收不到任何提示＝静默卡旧版）。
          setTimeout(function () {
            if (done) return;
            _prBusy = false;
            if (_prPing) { clearInterval(_prPing); _prPing = 0; }
            try { window.__mochiVerDlBusy = false; } catch (x) {}
            if (_prMsg) navigator.serviceWorker.removeEventListener('message', _prMsg);
            try {
              const last = localStorage.getItem('xy-home-v2:ver-update-notify');
              const n = Number(String(last || '').split('|')[0]);
              if (ackTs > 0 && n === ackTs) localStorage.removeItem('xy-home-v2:ver-update-notify');
            } catch (x) {}
            setUi('新版没下载完（网络太慢）。已取消本次刷新，网络好转后会再次提醒；也可点「重试刷新」再试', '重试刷新');
            if (actEl) actEl.onclick = function () { refreshNow(false, 0, ackTs); };
          }, VER_DL_WAIT);
        }
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
    if (actEl) actEl.onclick = function () { refreshNow(false, 0, onlineTs); }; // #944：ack 挪到下载确认成功后写（refreshNow 内）
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
    // FIX 2026-09-28 #1351c「知道有线上新版，却从没去取过那个新包」——换版送达的那半件事
    //   （iPhone 15／iOS 17.6.1 复报「上次的大部分需要添加图片的功能都已修复，但……还是无法添加」，
    //   随附诊断单里【更新状态】逐字写着：远端部署于 23:26、本机构建 13:28＝落后约 10 小时，
    //   而同一张单【保活现场】写着 保活=开／通知=开＝#992 那道「后台不落地换版」的闸门永久生效，
    //   更新条用户没点＝这一场永远停在旧包。上一批修好的门，对这台手机等于没修过）。
    //   全站没有一处调用 registration.update()：新 sw.js 只能等浏览器自己的更新检查
    //   （规范上限 24h，且只在导航时做），而 PWA 桌面快捷方式一开就是几天不重新导航。
    //   本函数只在「线上 version.json 的 ts 比这一页的构建 ts 新」这一刻调用一次，
    //   判据零机型／零 UA；它只让新 sw 装上（新缓存就位、旧缓存按 sw 自己的 activate 清掉），
    //   换版【落地】时机一字未动——#965 的待换版登记、#992 的保活闸门、手动更新条全照旧。
    function askSwUpdate() {
      try {
        if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistration) return;
        navigator.serviceWorker.getRegistration().then(function (r) {
          try { if (r && typeof r.update === 'function') r.update(); } catch (e) {}
        }).catch(function () {});
      } catch (e2) {}
    }
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
          // #965：前台轮询发现新版也走自动通道（不只弹条）——长开会话（用户几天不关）也能
          // 后台预取，转后台即换版；tryAutoUpgrade 返回 false（无 controller／本版本已试过）才回更新条
          if (ts > baseTs) { if (!tryAutoUpgrade(ts)) showVerBar(ts); }
          askSwUpdate(); // FIX 2026-09-28 #1351c：判出「线上比这一页新」这一刻就去请 sw.js 重新装一次（见函数注释）
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
      if (window.__mochiVerDlBusy) return; // #944：手动下载进行中，勿把「正在下载…」进度文案复位
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
        if (ts > baseTs) askSwUpdate(); // FIX 2026-09-28 #1351c：冷启动/重进这一发同样顺手请一次
      }).catch(function () { /* 网络不可用：不动静，等周期轮询网络恢复后弹条 */ });
    });
  })();

  // ================= v3.6.x：定期备份提醒（本地数据只存在浏览器，Safari 可能意外清空） =================
  // iOS Safari 会因存储压力/系统 bug（WebKit#266559）清掉整个源的 localStorage+IDB，
  // 用户表现为「每次重开数据全丢」。代码无法阻止系统级清空，唯一防线是定期导出备份文件
  //（存到 iOS「文件」App，清空后能一键恢复）。距上次成功导出超 1 天且今日未提醒过时，
  // 在顶部显示提醒条（复用 ver-update-bar 样式，更新提示优先显示时让位）。
  // v3.3x.x：应需求把冷却从 7 天 → 2 天 → 现为 1 天——用户反馈「现在什么时间都不会出现提醒」，
  // 期望每天在进桌面时弹一次（不是每次启动都弹的天天打扰、也不是 7 天才一次那么久）。
  // v3.3x.x：开屏直接弹说明弹窗（用户需求）——把「为什么必须备份」讲清楚：
  // ① 浏览器/设备可能自动清空本地数据，任何手机/浏览器（含网页套壳转 App）都无法规避；
  // ② 若数据总也存不住（每次打开像没保存、一刷新就丢），多半是本机存储没能写进去（设备/浏览器异常）。
  // 顶部提醒条保留作兜底：弹窗组件未就绪时退回原提醒条，保证提醒不丢。
  (function () {
    const bar = document.getElementById('backup-remind-bar');
    if (!bar) return;
    const G = 'xy-home-v2:';
    const DAY = 86400000;
    const startedAt = Date.now();
    // FIX 2026-09-26 #1307：冷却标记改走 xyStore（内存缓存 + LS 快照 + IndexedDB），不再裸写 localStorage。
    //   一加 Ace5/Edge 实报「已经备份了，还是不断弹出备份的弹窗」而同一台机的导出件写着
    //   「localStorage 状态：写入失败(QuotaExceededError)」＋「整域 187 键 ≈10.0 MB，其中非本项目
    //   94 键 ≈9.4 MB」＝同源（GitHub Pages 一个源一个 localStorage，兄弟站点把配额吃满）时，
    //   下面这三处裸写各自被 catch 静默吞掉，标记永远是 0 ⇒ due() 永远为真、上面那条 2s 快轮询
    //   每 2 秒把用户刚关掉的弹窗再弹一次——「明明备份过了还在弹」。裸写点的失败在 #1305 之前
    //   根本没有现场，本批把该族里唯一「失败即改变用户可见行为」的标记收到持久层这一侧。
    //   取值仍要兼容旧设备：老数据只在 localStorage，xyStore.get 读空时回落裸 LS 一次。
    const flagStore = window.xyStore ? window.xyStore('xy-home-v2') : null;
    function flagGet(key) {
      try { const v = flagStore ? flagStore.get(key) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
      try { return localStorage.getItem(G + key); } catch (e) { return null; }
    }
    function flagSet(key, val) {
      try { if (flagStore) { flagStore.set(key, val); return; } } catch (e) {}
      try { localStorage.setItem(G + key, val); } catch (e) {}
    }
    function ts(key) { try { return Number(flagGet(key)) || 0; } catch (e) { return 0; } }
    // 冷却按「自然日」判定而非「距今满 24 小时」：按 24h 计时时，每天比前一天早一秒打开
    // 就永远凑不满 24 小时（提醒会无限往后漂＝用户所见「从来没弹过」）。
    function dayKey(t) { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
    function markReminded() { flagSet('__last-backup-remind', String(Date.now())); }
    // 开屏是否已关闭（clock.js：点击进入 → 加 .hide → 400ms 后移除节点）。
    // modal-mask 在 .phone 内（开屏期间 .phone 整棵 visibility:hidden）、提醒条 z-998 也低于
    // splash z-999 ⇒ 开屏期间弹＝弹在看不见的地方，旧版却照样写冷却，于是当天再也不会第二次弹。
    function splashGone() {
      const s = document.getElementById('splash');
      return !s || !s.isConnected || s.classList.contains('hide');
    }
    // 弹窗三态：'ok' 已弹 / 'busy' 别的弹窗占用（勿顶掉、也不写冷却，下轮再试）/ 'nofn' 组件不可用
    // v8.x #956：iOS Safari 标签页（未添加到主屏幕）高危——WebKit ITP 会在「连续 7 个 Safari
    // 使用日无第一方互动」后清空该源全部可写存储（localStorage/IndexedDB/Cache/SW），且
    // persist() 在标签页里几乎不授予；唯一豁免就是「添加到主屏幕」（主屏应用独立存储桶、
    // 不计入 7 天计时）。这正是「没装到桌面、数据总是丢」的根因。Android/桌面无此 7 天规则，
    // 故只在 iOS 标签页分支展示，其他机型文案与流程一字不变（零机型回归面）。
    function openIosInstallGuide() {
      if (typeof window.openModal !== 'function') return;
      // 刻意不挡「当前弹窗已开」——本引导由备份弹窗的 pill 回调打开，那一刻旧弹窗还在屏上
      // （openModal 的 _openSeq 嵌套守卫会因本次开窗而跳过对旧弹窗的 close）。挡了就永远打不开。
      window.openModal('装到桌面 · 让数据不被自动清空', '', function () {}, {
        noInput: true, big: true,
        staticText: '原因：在 Safari 标签页里，Apple 会在连续 7 天没打开本应用后自动清空本地数据（隐私策略，任何网站都躲不过）；添加到主屏幕后从桌面图标打开，就不受这条限制。\n\n'
          + '步骤（顺序很重要）：\n'
          + '① 先导出一份完整备份（点下方「先导出备份」，存到「文件」App 或微信收藏都行）——主屏幕应用和 Safari 是两套独立存储，不先导出，切过去会看到空数据。\n'
          + '② 点 Safari 底部的「分享」按钮（方框加向上箭头）。\n'
          + '③ 在弹出的菜单里选「添加到主屏幕」→ 右上角「添加」。\n'
          + '④ 回到手机桌面，点新出现的 Mochi 图标打开。\n'
          + '⑤ 在打开的桌面应用里：设置 → 导入数据，选第①步的备份文件恢复。\n\n'
          + '此后平时都从桌面图标打开，Safari 清不清都不影响你的数据。',
        copyBtn: { label: '先导出备份', fn: function (c) { try { if (window.runBackupExport) window.runBackupExport(); } catch (e) {} try { if (c && c.close) c.close(); } catch (e2) {} } }
      });
    }
    function openBackupModal(days, everBacked) {
      if (typeof window.openModal !== 'function') return 'nofn';
      const mask = document.getElementById('modal-mask');
      if (mask && !mask.hidden) return 'busy';
      // #1541a 同族：modal-mask 之外的自绘弹层（联系人管理面板 #contact-manager 等）开着
      // 也是占用——返 busy 下轮复查再弹，不顶掉用户正在操作的层及其上层输入弹窗。
      if (window.mochiOverlayBusy && window.mochiOverlayBusy()) return 'busy';
      const intro = everBacked
        ? '距上次完整备份已经 ' + days + ' 天了。'
        : '你到现在还没做过一次完整的数据备份（「备份聊天」只含聊天记录，不算完整备份）。';
      const iosTab = !!(window.mochiIosTabRisk && window.mochiIosTabRisk());
      let TEXT =
        intro + '\n\n' +
        '先说清楚一件事：你的聊天记录、字卡、照片、音乐、设置，全部只存在这台手机的这个浏览器里，云端一份都没有。\n\n' +
        '① 数据会被自动清掉，躲不过\n' +
        '不管用什么手机、什么浏览器（网页套壳转成 App 也一样），**系统和浏览器都会在它认为需要的时候自动清除网页存的数据**——存储空间不够、清理软件一键优化、无痕模式、很久没打开、系统升级，都可能触发。**这是设备本身的限制，网站没有办法替你保住数据。**\n' +
        '一旦被清，所有东西全没，只能拿以前导出的备份文件恢复。**所以必须定期导出备份，没有别的办法。**\n\n' +
        '② 怎么办\n' +
        '点下面的「去备份」，把全部数据导出成一个文件，再存到浏览器以外的地方：微信收藏、文件夹、云盘、电脑都行，至少留一份。恢复时在 设置 → 通用 →「导入数据」选这个文件即可。\n\n' +
        '③ 如果数据总也存不住\n' +
        '每次打开都像没保存、一刷新就丢，多半不是正常的定期清空，而是本机存储没能写进去（设备/浏览器异常），建议换个正常浏览器/设备使用。';
      if (iosTab) {
        TEXT += '\n\n④ 你现在是用 Safari 打开的（没添加到主屏幕）\n'
          + 'Safari 会在「连续 7 天没打开本应用」后自动清空本地数据——这是 Apple 的隐私策略，网站躲不过；添加到主屏幕后再从桌面图标打开，就不会被这样清。注意：主屏幕应用和 Safari 是两套独立存储，切过去之前必须先导出备份、再在桌面应用里导入。点下方「怎么装到桌面」看分步说明。';
      }
      const pills = [
        { label: '去备份', value: 'go' },
        { label: '备份聊天', value: 'chat' }
      ];
      if (iosTab) pills.push({ label: '怎么装到桌面', value: 'install' });
      pills.push({ label: '稍后', value: 'later' });
      window.openModal('数据会被自动清空 · 备份提醒', '', function (v) {
        if (v === 'go') { try { if (window.runBackupExport) window.runBackupExport(); } catch (e) {} }
        else if (v === 'chat') { try { if (window.runChatExport) window.runChatExport(); } catch (e) {} }
        else if (v === 'install') { try { openIosInstallGuide(); } catch (e) {} }
      }, { noInput: true, big: true, warn: true, staticEmph: true, pillSubmit: true, staticText: TEXT, pills: pills });
      return 'ok';
    }
    // 兜底顶部提醒条（弹窗组件不可用、或被别的弹窗长期占用时）：渲染成功返回 true 才允许写冷却
    function showBar(days, everBacked) {
      const txt = document.getElementById('backup-remind-txt');
      // #980：iOS 标签页（没装到主屏幕）是本提醒的高危场景——条上也点明「装到主屏幕再打开」，
      // 不指望用户点进弹窗才看到第 ④ 条；非 iOS 一字不变（零回归面）。
      const iosTab = !!(window.mochiIosTabRisk && window.mochiIosTabRisk());
      if (txt) {
        txt.textContent = (everBacked
          ? '⚠ 手机和浏览器都会自动清空数据（设备限制，躲不掉）· 距上次备份已 ' + days + ' 天，快导出备份'
          : '⚠ 手机和浏览器都会自动清空数据，一清就全没 · 你还没导出过完整备份')
          + (iosTab ? '｜iPhone：导出后请「添加到主屏幕」，改用桌面图标打开' : '');
      }
      // #980：iOS 时文案变长，窄屏（320px 级）允许按钮换行，防「去备份」被挤出屏外（#939 续二同款处理）
      if (iosTab) { bar.style.flexWrap = 'wrap'; bar.style.rowGap = '6px'; }
      bar.hidden = false;
      return bar.getClientRects().length > 0;
    }
    // 是否到了该提醒的时候（今日未提醒 + 不是刚备份过 + 本地确有数据可备）
    function due() {
      // #1307：contacts 是 xyStore 键（contacts.js regStore 写）——裸读 LS 在配额满的设备上
      // 会读空并把提醒整族静默掐掉（＝与「不断弹」同一根因的反向症状：标记写不进＝永远不弹）
      try { if (!flagGet('contacts')) return false; } catch (e) { return false; }
      const lastRemind = ts('__last-backup-remind');
      if (lastRemind && dayKey(lastRemind) === dayKey(Date.now())) return false;
      const lastBackup = ts('__last-backup');
      if (lastBackup && Date.now() - lastBackup < DAY) return false;
      return true;
    }
    function tryShow() {
      if (window.__resetting || document.hidden) return;
      // 数据就绪才判；IDB 整轮挂起的设备上 __mochiDataReady 永不置位，60s 后按已就绪处理
      //（标记只有 KB 级小键，回填没完成时最坏是多弹一次，不会读到脏值）
      if (!window.__mochiDataReady && Date.now() - startedAt < 60000) return;
      if (!splashGone()) return;
      if (!due()) return;
      // 版本更新提示优先（避免同屏叠两个提醒）：本轮让路，下轮复查再弹
      const upd = document.getElementById('ver-update-bar');
      if (upd && !upd.hidden) return;
      const lastBackup = ts('__last-backup');
      const days = lastBackup ? Math.max(Math.floor((Date.now() - lastBackup) / DAY), 1) : 0;
      const r = openBackupModal(days, !!lastBackup);
      if (r === 'ok') { markReminded(); return; }
      // 别的弹窗正占用全站唯一 #modal-mask：本轮让路（不顶掉对方、也不写冷却），复查时间线下轮再补
      if (r === 'busy') return;
      // 兜底（弹窗组件不可用）：退回顶部提醒条，保证提醒不丢
      if (showBar(days, !!lastBackup)) markReminded();
    }
    // 每日复查：开屏期间/别的弹窗占用时都不写冷却，靠这条时间线在用户真正进入后补上。
    // 前 10 分钟每 2s 一次（覆盖「点进桌面」那一刻，尽快弹出）后自动收掉；
    // 慢轮询每 60s 一次——应用常驻不刷新（PWA + 后台保活）跨天时，第二天照样提醒得到。
    const fast = setInterval(function () {
      try { tryShow(); } catch (e) {}
      if (Date.now() - startedAt > 600000) clearInterval(fast);
    }, 2000);
    setInterval(function () { try { tryShow(); } catch (e) {} }, 60000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') setTimeout(tryShow, 800);
    });
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
    const _ts = Number(autoTs) || 0;
    try {
      // #965：会话守卫从「每会话一次」改为「每个版本 ts 一次」——长开的会话撞上第二次
      // 部署时仍能自动升级；同一版本不重复预取（防循环）。
      const last = Number(sessionStorage.getItem(AUTO_UPGRADE_KEY)) || 0;
      if (_ts > 0 && last >= _ts) return false;
      sessionStorage.setItem(AUTO_UPGRADE_KEY, String(_ts || Date.now()));
    } catch (e) { return false; }
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // #279/#965：用户已交互不再直接放弃（旧行为＝退回更新条、多数用户不点＝长期旧版）；
      // 照常后台预取，reload 由 refreshNow 的「待换版」闸挪到页面转后台时落地，不打断会话。
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
        // FIX 2026-09-26 #1307：这条「安装前先导出」的已提示标记同样是裸写 localStorage——
        // 同源配额被兄弟站点吃满时写失败被吞，每次点安装按钮都重弹一遍（与备份弹窗同一根因）。
        const hintFlag = window.xyStore ? window.xyStore('xy-home-v2') : null;
        const hintGet = function (k) {
          try { const v = hintFlag ? hintFlag.get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
          try { return localStorage.getItem(G + k); } catch (e) { return null; }
        };
        if (isEdgeAndroid && !isStandalone && hasData && !hintGet('__last-backup') && !hintGet('__edge-backup-hint-done')) {
          try { if (hintFlag) hintFlag.set('__edge-backup-hint-done', String(Date.now())); else localStorage.setItem(G + '__edge-backup-hint-done', String(Date.now())); } catch (e) {}
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
      const iosTab = !!(window.mochiIosTabRisk && window.mochiIosTabRisk());
      window.openModal('欢迎使用 Mochi', '', go, {
        noInput: true,
        staticText: '检测到当前是全新环境，还没有任何数据。\n\n· 如果之前在浏览器标签页里设置过昵称/打卡：点「确定」会打开设置页的数据导入，选择之前导出的备份文件即可全部恢复。'
          + (iosTab ? '\n\n· 如果你之前明明在用、数据却突然不见了：多半是 Safari 清空了本地数据——没添加到主屏幕时，Safari 会在连续 7 天没打开后自动清空。以后请点「分享」→「添加到主屏幕」安装，并从桌面图标打开（安装前先导出备份；主屏幕应用与 Safari 是两套独立存储，需在桌面应用里导入）。' : '')
          + '\n\n· 如果是第一次使用：点「取消」直接开始设置即可。'
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
  const W = '本站完全免费，没有收过任何人一分钱，个人出资和花费时间搭建的。开放二传二改但禁止以盈利为目的。Mochi字卡网站完全免费，作者只有小红书这一个账号：小红书@言序（1842523578）。如有出现任何收费情况，均为诈骗，注意防止被骗。二传、分享本站链接必须标注作者署名：小红书 @言序（1842523578），禁止删除或修改。严禁冒为自己制作、删除篡改署名，或以任何形式收费倒卖本站链接、安装包——本站完全免费，收费即诈骗。如果你是花钱买来的链接：你被骗了，请拒付退款并举报卖家。';
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
      // v8.29 #976：必读卡组前移后，查找放宽到整个开屏滚动容器、补回锚点＝必读卡组最顶
      // （#splash-mustread 缺失的旧副本回退 #splash-notice，二传副本照常兜住）
      const n = document.getElementById('splash-mustread') || document.getElementById('splash-notice');
      const scope = document.getElementById('splash-box') || document;
      if (!n) return;
      // #613/#621：合并置顶声明卡（免费 · 署名 · 防倒卖，原防骗卡+署名卡并成一张）补回锚点 = 必读区最顶
      if (!scope.querySelector('.splash-alert[data-anti-scam="1"]')) {
        n.insertBefore(mkWatchBar('1', '免费 · 署名 · 防倒卖', W), n.firstChild);
      }
    } catch (e) { /* 静默：看门狗绝不能成为错误源 */ }
  }, 5000);
})();

// ================= #802 外置功能包加载失败自愈（「更多功能」成片「加载失败」根治） =================
// 用户实报（2026-09-19）：「更多功能里的小功能全部，打开显示加载失败」。外置化（PERF-PLAN 阶段 1）
// 后 35 个功能文件走 <script defer src="js/*">，任一拉取失败（GitHub Pages 弱网/被墙窗口、旧 SW
// 代际过渡期：缓存被 #157 后台刷新换成新 HTML 而 js 不在旧 PRECACHE 里）该功能即死：带守卫的入口
// toast「xx加载失败」，没守卫的（Pong/钓鱼/四子棋…）点了没反应——页面零重试，只能整页刷新赌网络。
// 本引擎在页面侧闭环（不等 SW 代际更新到位）：① build.mjs #802a 给外置标签挂 onerror，失败文件
// 进 __mochiExtFail（error 是终态、原标签绝不会再执行 ⇒ 按这份清单重注入不会双执行；「没在
// __mochiLoaded」的还可能只是仍在慢下载中，不重注入）；② load 后 1.5s/6s/15s 三波自动重注入
// （s.src 保持裸路径，同 URL 才能命中 SW 预缓存/HTTP 缓存；同一文件两次尝试间隔 ≥4s，防对仍在
// 途的上一发重复补枪）；③ 三波后仍有缺口 → 顶部恢复条（复用 ver-update-bar 样式），点＝换址再试，
// 全部到位自动撤条，诊断环补一条（设备兼容诊断可见）便于远程排查；条上带「知道了」，本次会话可关。执行期异常（script onload 而
// IIFE 抛错）不归这里管：那类在 __jsErrors 有记录，重注入同一份代码只会再抛一次，双绑定风险大于收益。
(function () {
  if (!window.__mochiExtFiles || !window.__mochiExtFiles.length) return;
  let waves = 0, bar = null, barTxt = null, reported = false, barOff = 0;
  const lastTry = {};
  // #1035（iQOO+Edge 实报「功能包未加载成功」永挂，其他机型同现；零机型/零内核分支）：
  // 三波重注入刻意用「同一个裸地址」（同 URL 才命中 SW 预缓存/HTTP 缓存）——代价是一旦失败原因
  // 按 URL 生效（浏览器 HTTP 缓存 / CDN 边缘节点 / 中间代理里的一条坏响应），每波重注入、每次
  // 点「点此重试」、甚至下次开页都取回同一份坏响应＝永远修不好，顶部条还会因无法关闭而常驻。
  // 故裸址三波之后改走「换址逃生」：地址带一次一变与会话一变的戳（?mb=<会话戳>.<第几次>）＋
  // cache:'reload'，绕开所有按 URL 命中的缓存层；字节先验真（防代理塞回的 HTML 错误页被当真代码跑）
  // 再就地执行，sw.js 把取回的好字节按裸路径写回缓存＝一次修好、下次开页直接命中、离线也在。
  const HEAL_NS = Date.now().toString(36);
  const HEAL_MAX = 3;
  const bust = {}, healing = {};
  try { barOff = sessionStorage.getItem('mochi-ext-bar-off') === '1' ? 1 : 0; } catch (e0) {}
  function failList() {
    const fail = window.__mochiExtFail || [], loaded = window.__mochiLoaded || [], out = [];
    for (let i = 0; i < fail.length; i++) if (loaded.indexOf(fail[i]) < 0 && out.indexOf(fail[i]) < 0) out.push(fail[i]);
    return out;
  }
  // FIX 2026-09-28 #1371e：开机求值序＝build.mjs 的 jsFiles 下标（device/idb/contacts 在前、
  // mobile-adapt 在最后＝那一份数组本身就是依赖序）。自愈的两条腿都必须按它补发，见下方 reinject。
  function byBootOrder(list) {
    const seq = window.__mochiJsFiles || [];
    const rank = {};
    for (let i = 0; i < seq.length; i++) if (rank[seq[i]] === undefined) rank[seq[i]] = i;
    const at = f => (rank[f] === undefined ? seq.length : rank[f]);
    return (list || []).slice().sort((a, b) => at(a) - at(b));
  }
  function reinject(list) {
    const now = Date.now();
    // FIX 2026-09-28 #1371e：原实现按下标顺序 append＋s.async=true＝执行序退回「谁先下完谁先跑」，
    // 把 <script defer> 那份「依赖先于调用方」的保证整张丢掉。window.activeStore 要到 contacts.js
    // 自己跑到它那一行才挂上（jsFiles 第 3 位），而 quote-cards／fav-settings／records／loc-lib／sfx／
    // chat／chatcard 都在 IIFE 第一行就调它——报障件 00:06 那四条「window.activeStore is not a function」
    // 正是 70 个包首拉全灭后自愈乱序的那一场：抛错那一发整段 IIFE 中止＝自定义字卡／表情包／收藏这一场
    // 全空，而库里一字未动＝用户所见「都没了」。零机型／零 UA 分支，判据只问「谁必须先跑」。
    const q = byBootOrder(list);
    for (let i = 0; i < q.length; i++) {
      const f = q[i];
      if (lastTry[f] && now - lastTry[f] < 4000) continue;
      lastTry[f] = now;
      const s = document.createElement('script');
      s.src = 'js/' + f;
      // async=false＝动态插入的脚本按插入序执行（与 defer 同一份序），下一发不抢跑
      s.async = false;
      s.onerror = function () { try { window.__mochiExtFail = (window.__mochiExtFail || []).concat(f); } catch (x) {} };
      document.head.appendChild(s);
    }
  }
  // 外置产物一律是 build.mjs 包的 `(function () { try {` 开头；代理/门户的坏响应是 HTML
  // （`<!doctype`/`<html`）或以状态文案开头的裸文本，长度也对不上——验真不过就当没取到。
  function looksLikeJs(txt) {
    return typeof txt === 'string' && txt.length > 64 && !/^\s*<\w/.test(txt);
  }
  // FIX 2026-09-28 #1371e：换址逃生这条腿同形——并发 fetch＋到手就 append＝执行序仍是完成序，
  // 与 reinject 是同一把尺子的两个口子（用户口径：不要覆盖式修补）。改成一串按依赖序的链：
  // 上一发执行完（或这一发判定放弃）才发下一发，就地执行的 inline 脚本因此与 <script defer> 同序。
  // 链上每一发各带一个天花板——弱网正是一发不回来的常态，挂死一发不能拖住后面全部；到点放弃的那一发
  // 即使后来才到手也不再插回去（同一文件跑两遍＝#897 记过的双绑定风险）。
  const BYPASS_WAIT_MS = 12000;
  function bypassOne(f) {
    if (healing[f] || (bust[f] || 0) >= HEAL_MAX) return Promise.resolve();
    const now0 = Date.now();
    if (lastTry[f] && now0 - lastTry[f] < 4000) return Promise.resolve();
    lastTry[f] = now0;
    healing[f] = 1;
    bust[f] = (bust[f] || 0) + 1;
    let gaveUp = false;
    let tid = 0;
    const work = fetch('js/' + f + '?mb=' + HEAL_NS + '.' + bust[f], { cache: 'reload' }).then(function (res) {
      if (!res || !res.ok) throw new Error('status');
      return res.text();
    }).then(function (txt) {
      healing[f] = 0;
      if (!looksLikeJs(txt)) throw new Error('bad-body');
      // 等字节这段时间里原标签可能只是慢、终于跑完了（或前一次换址已成功）＝不再执行第二遍
      if ((window.__mochiLoaded || []).indexOf(f) >= 0) return;
      if (gaveUp) return; // 天花板已到＝链已经往下走了，这一发插回来就是同一文件第二遍
      const s = document.createElement('script');
      s.textContent = txt;
      s.onerror = function () { try { window.__mochiExtFail = (window.__mochiExtFail || []).concat(f); } catch (x) {} };
      document.head.appendChild(s);
    }).catch(function () {
      healing[f] = 0;
      try { window.__mochiExtFail = (window.__mochiExtFail || []).concat(f); } catch (x) {}
    });
    return new Promise(function (resolve) {
      const next = function () { if (tid) clearTimeout(tid); resolve(); };
      tid = setTimeout(function () { gaveUp = true; healing[f] = 0; tid = 0; resolve(); }, BYPASS_WAIT_MS);
      work.then(next, next);
    });
  }
  function healByBypass(list) {
    let p = Promise.resolve();
    byBootOrder(list).forEach(function (f) { p = p.then(function () { return bypassOne(f); }); });
    return p;
  }
  function syncBar(miss) {
    if (!miss.length) { if (bar) bar.hidden = true; return; }
    if (waves < 3 || barOff) return;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'ver-update-bar';
      bar.id = 'ext-recovery-bar';
      bar.style.cursor = 'pointer';
      // #1035：两条按钮＝窄屏（320px 级）一行放不下会被截出屏外「知道了点不到」——#939f/#980f
      // 同款处置，只在本条内联换行，共用样式零影响。
      bar.style.cssText += 'flex-wrap:wrap;row-gap:6px;';
      bar.innerHTML = '<span class="vub-txt"></span><b>点此重试</b><b class="vub-act" id="ext-heal-off">知道了</b>';
      bar.addEventListener('click', function () {
        const miss2 = failList();
        if (miss2.length) {
          // 手动重试＝用户主动要求，放开换址次数上限再试一轮（自动波只用 HEAL_MAX 次）
          for (let i = 0; i < miss2.length; i++) bust[miss2[i]] = 0;
          healByBypass(miss2);
        }
        setTimeout(function () { syncBar(failList()); }, 4000);
      });
      const x = bar.querySelector('#ext-heal-off');
      if (x) x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        barOff = 1;
        try { sessionStorage.setItem('mochi-ext-bar-off', '1'); } catch (e6) {}
        bar.hidden = true;
      });
      document.body.appendChild(bar);
      barTxt = bar.querySelector('.vub-txt');
    }
    barTxt.textContent = miss.length + ' 个功能包没加载成功（网络波动），功能可能不全——';
    bar.hidden = false;
  }
  function pass() {
    waves++;
    const miss = failList();
    if (miss.length) reinject(miss);
    setTimeout(function () {
      const left = failList();
      if (left.length && waves >= 3 && !reported) {
        reported = true;
        try { window.__jsErrors = window.__jsErrors || []; window.__jsErrors.push('[ext-recovery] ' + left.length + ' 个外置功能包加载失败: ' + left.slice(0, 5).join(',')); } catch (x) {}
      }
      syncBar(left);
    }, 4000);
  }
  // #1035 换址波：裸址三波（1.5/6/15s）全灭后的第四波起，间隔逐步拉开（26/55/100s）——
  // 既给「按 URL 生效的坏响应」换一个取不到的键，也给弱网留出「上一发其实还在途」的余量。
  function healPass() {
    waves++;
    const miss = failList();
    if (miss.length) healByBypass(miss);
    setTimeout(function () { syncBar(failList()); }, 4000);
  }
  function boot() {
    setTimeout(pass, 1500);
    setTimeout(pass, 6000);
    setTimeout(pass, 15000);
    setTimeout(healPass, 26000);
    setTimeout(healPass, 55000);
    setTimeout(healPass, 100000);
  }
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();

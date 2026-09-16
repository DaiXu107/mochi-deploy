// ===== 功能：完整通话系统（仿星言简约版） =====
// 来电：全屏弹窗（头像/名称/对方来电 + 接听/拒绝 + 30 秒倒计时未接）
// 去电：拨打 → 忙线/拒绝/接通/未接 概率
// 接通：显示通话时长，2 秒后最小化为通话小框（底部悬浮，可挂断）
// 概率（与星言一致）：来电 15% / 接通 70% / 忙线 15% / 拒绝 15% / 对方挂断 2%（接通满 3 分钟后每 60 秒检查）
// 来电触发：TA 回复消息/主动发消息后按概率掷一次 + 独立定时器每 60-120 秒兜底检查（5 分钟冷却）
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  const CALL = { incoming: 15, pickup: 70, busy: 15, reject: 15, hangup: 2 };
  // 从回复设置读取（可自由调整概率，与星言通话设置一致）
  function callCfg() {
    const c = (window.replyCfg && window.replyCfg()) || {};
    return {
      incoming: c['call-incoming'] !== undefined ? c['call-incoming'] : CALL.incoming,
      pickup: c['call-pickup'] !== undefined ? c['call-pickup'] : CALL.pickup,
      busy: c['call-busy'] !== undefined ? c['call-busy'] : CALL.busy,
      reject: c['call-reject'] !== undefined ? c['call-reject'] : CALL.reject,
      hangup: c['call-hangup'] !== undefined ? c['call-hangup'] : CALL.hangup,
      // #200：禁止联系人挂断总开关（回复/通话设置，默认关）——开启后通话中对方永不主动挂断。
      // 同时兜住「挂断几率为 0 仍被挂断」：该设置按桌面（联系人）隔离存储，从未保存过该键的
      // 联系人会回落 2% 默认值，总开关与下方 hangup<=0 双重硬闸一起把这类情况全部拦死
      nohangup: c['call-no-hangup'] === 1 || c['call-no-hangup'] === '1',
      resume: c['call-resume'] !== undefined ? c['call-resume'] : 1
    };
  }

  // 通话背景（v3.5.50）：设置页上传图片 → 应用到大面板 + 通话小框
  const CALL_BG_KEY = 'call-bg';
  function applyCallBg() {
    const bg = store.get(CALL_BG_KEY) || '';
    const panel = document.querySelector('.call-panel');
    const miniEl = document.getElementById('call-mini');
    [panel, miniEl].forEach(el => {
      if (!el) return;
      if (bg) {
        el.style.backgroundImage = 'url("' + bg + '")';
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.classList.add('has-bg');
      } else {
        el.style.backgroundImage = '';
        el.classList.remove('has-bg');
      }
    });
    const val = document.getElementById('call-bg-val');
    if (val) val.textContent = bg ? '已设置' : '默认';
    const rm = document.getElementById('call-bg-remove');
    if (rm) rm.hidden = !bg;
    // v3.12.x：聊天页「更多功能→通话」半框里的背景行同步回显（设置页与半框两处入口共用状态）
    const evalVal = document.getElementById('call-bg-edit-val');
    if (evalVal) evalVal.textContent = bg ? '已设置' : '默认';
    const rmEdit = document.getElementById('call-bg-edit-remove');
    if (rmEdit) rmEdit.hidden = !bg;
  }
  // v3.12.x：上传逻辑抽成 pickCallBg()——设置页 #call-bg-row 与通话半框 #call-bg-edit-row 两个入口共用
  function pickCallBg() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(1, 600 / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.width * scale));
            c.height = Math.max(1, Math.round(img.height * scale));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            const data = c.toDataURL('image/jpeg', 0.85);
            store.set(CALL_BG_KEY, data);
            applyCallBg();
            toast('通话背景已设置');
          } catch (e) {
            toast('图片处理失败');
          }
        };
        img.onerror = () => toast('图片读取失败');
        img.src = reader.result;
      };
      reader.onerror = () => toast('图片读取失败');
      reader.readAsDataURL(f);
    };
    input.click();
    return input;
  }
  const callBgRow = document.getElementById('call-bg-row');
  if (callBgRow) callBgRow.addEventListener('click', pickCallBg);
  // v3.12.x：聊天页「更多功能→通话」半框内直接修改联系人头像 / 通话卡片背景图片
  //   - 联系人头像行 → 收起通话半框，打开「头像互动」半框（上传/点选即换，写 cs-avatar-partner）
  //   - 通话背景图片行 → 与设置页同款上传流程
  //   - 移除行 → 恢复默认背景（无背景时隐藏，随 applyCallBg 同步显隐）
  const callAvEditRow = document.getElementById('call-av-edit-row');
  if (callAvEditRow) {
    callAvEditRow.addEventListener('click', () => {
      const cp = document.getElementById('chat-call-panel');
      if (cp) cp.hidden = true;
      if (window.openAvlib) window.openAvlib();
      else toast('头像库暂不可用');
    });
  }
  const callBgEditRow = document.getElementById('call-bg-edit-row');
  if (callBgEditRow) callBgEditRow.addEventListener('click', pickCallBg);
  const callBgEditRm = document.getElementById('call-bg-edit-remove');
  if (callBgEditRm) {
    callBgEditRm.addEventListener('click', () => {
      store.remove(CALL_BG_KEY);
      applyCallBg();
      toast('已恢复默认通话背景');
    });
  }
  const callBgRm = document.getElementById('call-bg-remove');
  if (callBgRm) {
    callBgRm.addEventListener('click', () => {
      store.remove(CALL_BG_KEY);
      applyCallBg();
      toast('已恢复默认通话背景');
    });
  }
  // v3.5.94：通话背景大键可能只存在 IndexedDB（导入兜底写入/大键只进 IDB）→ 启动补读后重新应用
  // v3.6.x：修复——这段补读原本被错位写进「上传背景图片」的回调里，只在用户上传图片时才执行，
  //   页面加载时从不运行，导致导入数据后通话背景无法从 IndexedDB 恢复；移回模块顶层随加载执行
  try {
    if (window.idbGet) {
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':' + CALL_BG_KEY).then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !store.get(CALL_BG_KEY)) {
          store.set(CALL_BG_KEY, v);
          applyCallBg();
        }
      });
    }
  } catch (e) {}
  applyCallBg();
  // v3.26.x：切换联系人桌面后重读当前桌面的通话背景——.call-panel/#call-mini 是全站共享 DOM，
  //   背景图 style 只在加载/上传/移除时写入，切桌面不刷新就会残留上一个联系人的背景（跨桌面串图）
  document.addEventListener('contact-switched', applyCallBg);

  // v3.7.x：通话小框开关（每联系人桌面独立，默认开启）
  //   - 开启：接通后 2 秒自动最小化为底部悬浮小框（原行为）
  //   - 隐藏：接通后保持通话大面板常驻；点「缩小」收起进后台，不显示悬浮小框
  const CALL_MINI_KEY = 'call-mini-enabled';
  function callMiniEnabled() {
    try { return store.get(CALL_MINI_KEY) !== '0'; } catch (e) { return true; }
  }
  window.getCallMiniEnabled = function () { return callMiniEnabled(); };
  window.setCallMiniEnabled = function (v) {
    try { store.set(CALL_MINI_KEY, v ? '1' : '0'); } catch (e) {}
    applyCallMiniNow(!!v);
  };
  // v3.8.x：设置里切「隐藏通话小框」立即生效——通话中已显示的悬浮小框马上收起
  // （通话转后台，仍可经通话半框挂断）；切回开启时若大面板已收起则恢复显示小框
  function applyCallMiniNow(enabled) {
    if (!currentCall || !mini) return;
    if (enabled) {
      if (currentCall.status === 'connected' && mask && mask.hidden) {
        syncCallName();
        syncCallAv();
        mini.hidden = false;
        liftMiniIntoSafeArea(); // v3.26.x #137：显示时校正，防旧坐标落进系统状态栏区
      }
    } else {
      mini.hidden = true;
    }
  }

  // ---- 来电 / 去电 / 通话中 ----
  let currentCall = null; // { direction, status, startTime, connectedTime, timer }
  let durationTimer = null;

  const mask = document.getElementById('call-mask');
  const mini = document.getElementById('call-mini');
  const avEl = document.getElementById('call-av');
  const nameEl = document.getElementById('call-name');
  const statusEl = document.getElementById('call-status');
  const durEl = document.getElementById('call-duration');
  const cdEl = document.getElementById('call-countdown');
  const hangBtn = document.getElementById('call-hang-btn');
  const rejectBtn = document.getElementById('call-reject-btn');
  const answerBtn = document.getElementById('call-answer-btn');
  const miniBtn = document.getElementById('call-minimize-btn');
  const miniAv = document.getElementById('call-mini-av');
  const miniName = document.getElementById('call-mini-name');
  const miniTime = document.getElementById('call-mini-time');
  // 小框位置持久化（可拖动）
  // v3.5.108：校验保存的位置有效（形如「数字px」且在视口内），
  //   无效/越界/空值一律忽略并清除，回退默认底部居中——避免旧坏数据导致小框闪到别处
  // v3.28.x #114：iOS standalone 顶部被系统状态栏占用的高度（iPhone15 实测 59px）。
  //   旧存档/拖拽落点若在状态栏区，触点被系统栏吞、缩略窗拖不动（用户报障「缩略窗在
  //   顶部动不了」）。落位/拖拽时把上边界抬到系统状态栏下方。
  // v3.26.x #136（复现修，iPhone15 + iOS 18.7 + 全屏态）：ios-fs-active 下 .phone 用
  //   100vh 铺满物理屏后 screen.height == visualViewport.height == 852，差值=0 落在
  //   20-160 过滤区间外 → 原 diff 探针返回 0，小框存档 y≈0 时整个 56px 高的胶囊
  //   落进系统状态栏悬浮区 → 点挂断没反应、也拖不出来（触点全被系统栏吞）。
  //   三级探测链：① env() 探针（隐藏 fixed 元素实测 env(safe-area-inset-top)，
  //   viewport-fit=cover 下 WebKit 会返回真实系统栏高度，是标准做法）；
  //   ② 原 screen-vv 差值法（v3.28.x #114 通道，部分环境仍有效）；
  //   ③ 47px 保守兜底（iPhone 刘海/灵动岛机型系统状态栏最小高度 47-62px，47 取下限；
  //   仅 standalone iOS 生效，非刘海小屏（SE 20px）被多让 27px 无实际影响）。
  //   确保任何 iOS 型号下小框永不落进状态栏区。
  let _miniSafeTopCache = -1;
  function miniSafeTop() {
    try {
      if (!document.documentElement.classList.contains('ios-pwa-standalone')) return 0;
      if (_miniSafeTopCache >= 0) return _miniSafeTopCache;
      let top = 0;
      // ① env() 探针：viewport-fit=cover 下返回真实系统状态栏高度（0 则本环境确实无避让）
      try {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
        document.body.appendChild(probe);
        const v = parseFloat(getComputedStyle(probe).paddingTop);
        document.body.removeChild(probe);
        if (!isNaN(v) && v >= 20 && v <= 160) top = v;
      } catch (e1) {}
      // ② screen-vv 差值法（v3.28.x #114 原通道）
      if (!top) {
        const sh = (window.screen && window.screen.height) || 0;
        const ih = window.innerHeight || 0;
        if (sh > 0 && ih > 0) {
          const diff = sh - ih;
          if (diff >= 20 && diff <= 160) top = diff;
        }
      }
      // ③ 59px 保守兜底：probe 与 diff 都失手（如 #137 环境 env=0 且 100vh 铺满后 vv=screen）。
      //    取 iPhone15 实测系统状态栏高度 59px（#114 通道）——覆盖刘海/灵动岛机型全部
      //    44-59px 状态栏；老非刘海机型（SE 20px 栏）被多让 ~39px，仅顶部拖拽上限略低，无害。
      if (!top) top = 59;
      _miniSafeTopCache = top;
      return top;
    } catch (e) {}
    return 0;
  }
  // v3.26.x #137 补强：小框「显示时」抬升——此前只在文件加载时对旧存档抬一次，但小框
  // 有 5 处显示点（接通 2s 自动最小化/手动缩小/刷新恢复通话/设置开关/恢复通话路径），
  // 任何路径显示「内联 top 低于系统状态栏区」的坐标都会复现「卡在顶上点不了拖不动」。
  // 统一在显示后校正：内联 top 存在且 < miniSafeTop() → 抬到安全线并回写存档。
  // （默认底部居中位没有内联 top，不受影响；函数声明提升，5 处显示点均可调。）
  function liftMiniIntoSafeArea() {
    try {
      if (!mini || mini.hidden) return;
      const st = miniSafeTop();
      if (st <= 0) return;
      const m = String(mini.style.top || '').match(/^(-?\d+(\.\d+)?)px$/);
      if (!m) return; // 无内联 top（默认底部居中），无需处理
      const y = parseFloat(m[1]);
      if (y < st) {
        mini.style.top = st + 'px';
        if (mini.style.bottom && mini.style.bottom !== 'auto') mini.style.bottom = 'auto';
        if (!miniPos) miniPos = { left: mini.style.left, top: mini.style.top };
        else miniPos.top = mini.style.top;
        try { store.set('call-mini-pos', JSON.stringify(miniPos)); } catch (e2) {}
      }
    } catch (e) {}
  }
  let miniPos = null;
  try { miniPos = JSON.parse(store.get('call-mini-pos') || 'null'); } catch (e) {}
  function miniPosValid(p) {
    if (!p || typeof p !== 'object') return false;
    const lm = String(p.left || '').match(/^(-?\d+(\.\d+)?)px$/);
    const tm = String(p.top || '').match(/^(-?\d+(\.\d+)?)px$/);
    if (!lm || !tm) return false;
    const x = parseFloat(lm[1]), y = parseFloat(tm[1]);
    if (isNaN(x) || isNaN(y)) return false;
    if (x < 0 || x > window.innerWidth - 30) return false;
    if (y < 0 || y > window.innerHeight - 30) return false;
    return true;
  }
  if (miniPos && mini && miniPosValid(miniPos)) {
    // v3.28.x #114：旧存档落点在系统状态栏区（y < 安全区）→ 抬到状态栏下方，避免
    // 触点被系统栏吞掉、缩略窗拖不动
    const _st = miniSafeTop();
    let _y = parseFloat(String(miniPos.top).match(/(-?\d+(\.\d+)?)px/)[1]);
    if (_st > 0 && _y < _st) {
      miniPos.top = _st + 'px';
      try { store.set('call-mini-pos', JSON.stringify(miniPos)); } catch (e) {}
    }
    mini.style.left = miniPos.left;
    mini.style.top = miniPos.top;
    mini.style.bottom = 'auto';
    mini.style.transform = 'none';
  } else if (miniPos) {
    // 旧坏数据：清除，用默认底部居中
    try { store.remove('call-mini-pos'); } catch (e) {}
    miniPos = null;
  }

  // v3.26.x：通话昵称与聊天域解耦——优先读聊天专用键 cs-lbl-partner（聊天设置里设的联系人
  // 昵称），未设置时回退联系人名片名，最后默认 TA，不再回退桌面 lbl-partner（用户要求：
  // 聊天昵称不跟随桌面）。v3.26.x：回退链补齐联系人名片名，与聊天顶栏（cs-lbl-partner →
  // 名片名 → TA）保持一致——只改名片（联系人管理改名）时通话小框不再显示成 TA/他/她
  function partnerName() {
    const nick = store.get('cs-lbl-partner') || (window.contactNameFor ? window.contactNameFor(window.__activeCid || 'default') : '');
    return nick || (window.taWord ? window.taWord() : 'TA');
  }
  // v3.12.x：通话头像跟随聊天域——优先读聊天专用键 cs-avatar-partner（头像互动半框/换头像写的就是它），
  // 未设置时回退桌面键 avatar-partner；此前只读桌面键，导致通话面板不跟随换头像
  function partnerAv() { return store.get('cs-avatar-partner') || store.get('avatar-partner') || ''; }
  // v3.6.x：通话绑定归属桌面（cid + 昵称 + 头像）——通话中切换到其他联系人桌面再挂断时，
  // 文案与记录仍归属发起通话的桌面，不会显示成当前桌面的联系人
  function bindCall(callObj) {
    callObj.cid = window.__activeCid || 'default';
    callObj.name = partnerName();
    callObj.av = partnerAv();
    saveCallActive();
    return callObj;
  }
  // v3.26.x：通话进行中状态持久化（全局键，不绑 per-cid）——
  //   endCall 正常清除；若刷新/崩溃导致 endCall 未执行，启动恢复时检测到残留 → 补写「通话中断」记录，
  //   与正常挂断区分（ended='interrupt'）。解决用户反馈：接通后刷新页面，通话记录里没有这条中断。
  const CALL_ACTIVE_KEY = 'xy-home-v2:call-active';
  // v3.26.x：#120 双写 localStorage——sessionStorage 在「关闭标签页/Safari 后重开」或
  //   iPadOS 杀后台后重开时会整体清空（主屏幕 PWA 重开同此），恢复逻辑就读不到任何标记，
  //   「刷新后恢复通话」失效（iPad Air 7 + Safari 实测反馈）。localStorage 持久保留，
  //   作兜底副本；新鲜度窗口见 recoverCall（防止几天后重开翻出旧通话）。
  function callActivePayload() {
    return JSON.stringify({
      cid: currentCall.cid, direction: currentCall.direction, status: currentCall.status,
      startTime: currentCall.startTime, connectedTime: currentCall.connectedTime || 0,
      name: currentCall.name || '', av: currentCall.av || '', ts: Date.now()
    });
  }
  function saveCallActive() {
    try {
      if (!currentCall) return;
      const payload = callActivePayload();
      sessionStorage.setItem(CALL_ACTIVE_KEY, payload);
      try { localStorage.setItem(CALL_ACTIVE_KEY, payload); } catch (e) {}
    } catch (e) {}
  }
  function clearCallActive() {
    try { sessionStorage.removeItem(CALL_ACTIVE_KEY); } catch (e) {}
    try { localStorage.removeItem(CALL_ACTIVE_KEY); } catch (e) {}
  }
  function fillAv(el, data) {
    if (!el) return;
    // v3.6.x：img 用属性赋值（dataURL 含引号时拼 innerHTML 会逃逸注入 HTML）
    el.innerHTML = '';
    if (data) {
      const img = document.createElement('img');
      img.src = data;
      img.alt = '头像';
      el.appendChild(img);
    } else {
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>';
    }
  }
  // v3.7.x：通话中头像实时跟随——联系人换头像（头像库手动/自动/设置页）后，
  // 通话大面板与小框同步刷新；按归属桌面读 avatar-partner（跨桌面通话仍显示正确的 TA）
  let shownAv = null;
  let shownName = null;
  function syncCallAv() {
    if (!currentCall) return;
    let av = '';
    try {
      const s = (window.storeFor && window.storeFor(currentCall.cid)) || store;
      // v3.12.x：同 partnerAv——先读聊天专用键再回退桌面键（按归属桌面读，跨桌面通话仍显示正确的 TA）
      av = s.get('cs-avatar-partner') || s.get('avatar-partner') || '';
    } catch (e) { av = currentCall.av || partnerAv(); }
    if (av === shownAv) return;
    shownAv = av;
    fillAv(avEl, av);
    fillAv(miniAv, av);
  }
  function syncCallName() {
    if (!currentCall) return;
    let name = '';
    try {
      const s = (window.storeFor && window.storeFor(currentCall.cid)) || store;
      // v3.26.x：与 partnerName 同步解耦——先读聊天专用键，再回退联系人名片名，最后默认
      // TA，不再读桌面键；性别称呼按归属桌面读（跨桌面通话仍显示正确的 TA）
      name = s.get('cs-lbl-partner')
        || (window.contactNameFor ? window.contactNameFor(currentCall.cid) : '')
        || (window.taWordFor ? window.taWordFor(currentCall.cid) : (window.taWord ? window.taWord() : 'TA'));
    } catch (e) { name = currentCall.name || partnerName(); }
    if (name === shownName) return;
    shownName = name;
    if (nameEl) nameEl.textContent = name;
    if (miniName) miniName.textContent = name;
  }
  function fmtDur(sec) {
    if (isNaN(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
  }
  function setMaskBtns(mode) {
    // mode: 'ringing' 来电(接听/拒绝) | 'calling' 去电中(挂断+缩小) | 'active' 通话中(挂断+缩小) | 'none'
    if (hangBtn) hangBtn.hidden = !(mode === 'calling' || mode === 'active');
    if (rejectBtn) rejectBtn.hidden = !(mode === 'ringing');
    if (answerBtn) answerBtn.hidden = !(mode === 'ringing');
    if (miniBtn) miniBtn.hidden = !(mode === 'calling' || mode === 'active');
  }
  // 缩小到小框（弹层 → 底部小框；小框被隐藏时仅收起大面板，通话转后台）
  // v3.7.x：通话小框开关关闭 → 不显示悬浮小框（后台通话，经通话半框挂断）
  function minimizeCall() {
    if (!currentCall) return;
    if (mask) mask.hidden = true;
    if (cdEl) cdEl.hidden = true;
    if (mini) {
      if (callMiniEnabled()) {
        syncCallName();
        syncCallAv();
        mini.hidden = false;
        liftMiniIntoSafeArea(); // v3.26.x #137：显示时校正，防旧坐标落进系统状态栏区
      } else {
        mini.hidden = true;
      }
    }
  }
  function stopTimers() {
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
  }
  function updateDur() {
    if (!currentCall) return;
    // v3.13.x：计时基准用「接听时刻」而非「响铃/拨出时刻」——
    // 此前用 startTime 会把响铃等待时长计入通话，响铃末尾接听时时长会从 0 直接蹦到 30 秒
    const base = currentCall.connectedTime || currentCall.startTime;
    const sec = Math.floor((Date.now() - base) / 1000);
    if (durEl) durEl.textContent = fmtDur(sec);
    if (miniTime) miniTime.textContent = fmtDur(sec);
  }
  // 进入通话中：计时 + 状态
  function startCallDuration() {
    stopTimers();
    if (!currentCall.connectedTime) currentCall.connectedTime = Date.now(); // v3.26.x：恢复通话时已有 connectedTime 不覆盖，计时从接通时刻继续
    updateDur(); // v3.13.x：接通立即刷新显示，避免接通瞬间仍停留「00:00」卡一下
    let checkCount = 0;
    let hbCount = 0;
    durationTimer = setInterval(() => {
      updateDur();
      syncCallAv();
      syncCallName();
      // v3.26.x：#120 心跳——每 20 秒刷新 call-active 的 ts（新鲜度窗口的判定依据），
      //   此前只在接通时写一次，恢复兜底无法区分「刚被杀」与「早已结束」
      if (++hbCount >= 20) { hbCount = 0; saveCallActive(); }
      // 对方挂断概率：接通 3 分钟保护期后，每 60 秒检查一次
      // v3.6.x：放宽——原实现 10 秒保护后每 30 秒掷一次，默认 5% 实际效果远超设置字面值
      //（约 3 分钟累计 ~23% 被挂断、10 分钟内累计 ~62%），用户反馈「3 分钟左右自动挂断、
      // 没一通超过 10 分钟」；改 3 分钟保护 + 60 秒周期后，挂断概率才接近设置的字面含义
      if (currentCall && currentCall.status === 'connected') {
        if (Date.now() - currentCall.connectedTime >= 180000) {
          checkCount++;
          if (checkCount >= 60) {
            checkCount = 0;
            // #200：总开关开启或挂断概率 <=0 时硬闸不掷骰——概率为 0 本就不该挂断，
            // 这里再显式拦一道，防设置读取异常回落默认值导致「设 0 仍被挂断」
            const hp = callCfg();
            if (!(hp.nohangup || hp.hangup <= 0) && Math.random() * 100 < hp.hangup) {
              endCall('对方挂断了电话');
            }
          }
        }
      }
    }, 1000);
  }
  // 通话结束信息写入归属桌面（v3.6.x 修复跨桌面挂断显示成当前联系人）：
  // 当前桌面走内存链路（实时渲染/未读角标）；非当前桌面直接写该桌面 IDB 聊天记录
  // + LS 快照 + 通话记录存储（该桌面 msgs 内存已在 contact-switched 时重置，
  // 下次进入由 loadMsgs 从 IDB 读回）
  function notifyCallEnd(cid, sysHtml, recType, recText) {
    const cur = window.__activeCid || 'default';
    if (cid === cur) {
      if (window.chatAddSystem) window.chatAddSystem(sysHtml);
      if (window.addCallRecord) window.addCallRecord(recType, recText);
      return;
    }
    // v3.14.x：改走 chat.js 统一安全追加——原「idbGet→push→整包写回」在读取
    // 超时（返回 undefined）时会把该桌面全部聊天记录覆盖成 [这一条]
    if (window.chatAppendToDeskMsg) { window.chatAppendToDeskMsg(cid, sysHtml); }
    try {
      const s = (window.storeFor && window.storeFor(cid)) || store;
      let list = [];
      try { list = JSON.parse(s.get('records-call') || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      list.unshift({ type: recType, text: recText, ts: Date.now() });
      s.set('records-call', JSON.stringify(list.slice(0, 50)));
    } catch (e) {}
  }
  // 结束通话：清界面 + 聊天系统消息（接通过必带时长）+ 记录
  // v3.5.51：真实时长从接听时刻计算（覆盖对方挂断/不明原因中断路径）；
  //   接通后结束 → 系统消息明确「通话已挂断 / 对方已挂断 · 时长 xx」
  function endCall(text, holdSilent) {
    clearCallActive(); // v3.26.x：正常结束清除进行中标记（中断恢复靠残留检测）
    // v3.5.127：所有结束路径（超时/拒绝/挂断/对方挂断）统一停铃声
    if (window.stopSfx) window.stopSfx('ring');
    // v3.5.129：通话结束恢复音乐播放/悬浮小框
    if (window.musicHoldForCall) window.musicHoldForCall(false);
    stopTimers();
    if (mask) mask.hidden = true;
    if (mini) mini.hidden = true;
    if (cdEl) cdEl.hidden = true;
    if (currentCall && !holdSilent) {
      // #161：holdSilent=true（响铃挂起静默收尾）只清 UI 不写未接——未接由
      // resumeHeldCall 在挂起超时/无法重响时统一补写，避免「用户明明能接却被判未接」
      // 真实通话时长：durationSec（接通后已计时）兜底用 connectedTime 计算
      const dur = currentCall.durationSec || (currentCall.connectedTime ? Math.max(0, Math.floor((Date.now() - currentCall.connectedTime) / 1000)) : 0);
      const dir = currentCall.direction;
      // v3.6.x：姓名用通话绑定的桌面（通话中切桌面后挂断不显示成当前联系人）
      const name = currentCall.name || partnerName();
      const durTxt = dur > 0 ? ' · 时长 ' + fmtDur(dur) : '';
      // 接通过 → 系统消息明确「挂断/对方挂断/中断 + 时长」；未接通保持原结果文案
      // v3.5.129：只有真正接通（connectedTime 存在）才改写文案+加时长——
      // 否则"未接听/忙线/拒绝/取消"都会被误标成「通话已结束 · 时长 xx」
      let resText = text;
      if (dur > 0 && currentCall.connectedTime) {
        if (text === '对方挂断了电话') resText = '对方已挂断';
        else if (text === '已挂断') resText = '通话已挂断';
        else resText = '通话已结束'; // 不明原因中断等
        resText += durTxt;
      }
      notifyCallEnd(currentCall.cid || 'default', '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>' + (dir === 'in' ? name + ' 来电' : '我拨打 ' + name) + ' · ' + resText, dir, text + (dur ? '（' + fmtDur(dur) + '）' : ''));
    }
    currentCall = null;
    shownAv = null;
    shownName = null;
  }
  // v3.31.x：后台来电通知——页面在后台时无法弹来电 UI（也无法接听），改为发系统通知
  //（走 bg-keep 的 showSysNotification 链路：SW 通知页面隐藏也能显示）。
  // force=true：来电是「错过就没了」的单发事件，绕过 bgNotifyCheck 的 15s 过渡期/去重闸门。
  // avFixed=true：来电归属当前桌面，头像用 partnerAv() 权威值，空则走中立 mochi 图标。
  // #161：加 hint 尾缀——通知文案变为「XX 来电了，快回来接听，对方会等你几分钟」
  function bgCallNotify(name, hint, avOverride) {
    try {
      if (window.bgNotifyCheck) window.bgNotifyCheck(name + ' 来电了' + (hint ? '，' + hint : ''), Date.now(), { name: name + '来电', av: avOverride || partnerAv(), avFixed: true, force: true });
    } catch (e) {}
  }
  // #161：响铃挂起——后台来电不再「命中即未接」（用户反馈：点开通知永远接不到，
  // 联系人已经挂断＝设计缺陷）。改为：先发系统通知 + 挂起来电（CALL_HOLD_KEY 全局
  // 根键，含归属 cid——回前台时可能停在别的桌面；已登记 contacts.js EXCLUDE 防迁移），
  // CALL_HOLD_MS 内回到应用（visibilitychange visible / 冷启动恢复）→ 重新响铃可接听；
  // 超时未回 → resumeHeldCall 补写「未接来电」记录+系统消息。
  const CALL_HOLD_MS = 3 * 60 * 1000;
  const CALL_HOLD_KEY = 'xy-home-v2:call-hold';
  function heldMissedHtml(nm) {
    return '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>' + nm + ' 来电 · 未接听';
  }
  function holdIncomingCall(name, cid, avOverride, msgWritten) {
    let prev = null;
    try { prev = readCallHold(); } catch (e) {}
    // 覆盖前先处理上一条已超时未处理的挂起（页面冻结期间第二次来电的场景）
    if (prev && prev.cid && Date.now() - prev.ts > CALL_HOLD_MS) {
      notifyCallEnd(prev.cid, heldMissedHtml(prev.name || partnerName()), 'in', '未接听');
    }
    // FIX 2026-09-13 #406 挂起双写拆开：原 LS setItem 与 idbSet 同处一个 try——LS 配额满
    // QuotaExceededError 一抛整块中止、IDB 也不写＝后台只有通知没有挂起，回前台点开通知
    // 无弹窗也无未接消息（OPPO Reno14 Edge 实报 + 多机型同族；诊断「LS 写入失败」实锤）。
    // msgWritten＝来电系统消息「打来了语音通话」是否已写过（前台响铃已写传 true，
    // 后台触发未写传 false，重响补首发见 resumeProcessHold/incomingCall）
    const h = { ts: Date.now(), name: name, cid: cid || (window.__activeCid || 'default'), msg: !!msgWritten };
    try { localStorage.setItem(CALL_HOLD_KEY, JSON.stringify(h)); } catch (e) {}
    if (window.idbSet) { try { window.idbSet(CALL_HOLD_KEY, h); } catch (e) {} }
    bgCallNotify(name, '快回来接听，对方会等你几分钟', avOverride);
  }
  // #204：暴露给 incoming-requests.js——跨桌面来电后台命中时同走「响铃挂起」（原只发
  // 通知即丢弃，切回应用无来电 UI 也无未接记录）；avOverride 用归属联系人头像
  window.callHoldIncoming = holdIncomingCall;
  // #441：暴露给 incoming-requests.js——跨桌面来电「稍后/弹窗被顶未应答」补记未接。
  // 原路径只把 pending 标 seen，什么记录都不留（桌内来电拒绝/超时都有记录），
  // 跨桌面来电就无声消失。复用 notifyCallEnd：系统消息 + 通话记录都落到归属联系人
  // 桌面（cid 恰为当前桌面时自动走当前桌面链路），幂等性由调用方 setStatus 命中保证。
  window.callRecordMissed = function (cid, name) {
    try { notifyCallEnd(cid || 'default', heldMissedHtml(name || partnerName()), 'in', '未接听'); } catch (e) {}
  };
  function readCallHold() {
    try {
      const h = JSON.parse(localStorage.getItem(CALL_HOLD_KEY) || 'null');
      return (h && h.ts) ? h : null;
    } catch (e) { return null; }
  }
  function clearCallHold() {
    // 写 {ts:0} 而非删除：防 idbRestore 用 IDB 旧值回填出「幽灵挂起」重复记未接
    try { localStorage.setItem(CALL_HOLD_KEY, '{"ts":0}'); } catch (e) {}
    if (window.idbSet) { try { window.idbSet(CALL_HOLD_KEY, { ts: 0 }); } catch (e) {} }
  }
  // 回前台/冷启动检查挂起：有效→重新响铃（incomingCall(true) 不重复发系统消息）；
  // #291：归属桌面不是当前桌面时先切到归属联系人桌面再响铃（原直接判未接——用户点开
  // 通知/回到应用落在别的桌面，条件 h.cid===__activeCid 永不成立＝永远接不到来电）；
  // 过期/已在通话/归属联系人已不存在→补写未接（notifyCallEnd 跨桌面自动落到归属桌面）
  // FIX 2026-09-13 #406：LS 配额满时挂起只落在 IDB（见 holdIncomingCall）——回前台/冷启动
  // 先读 LS，读不到再回读 IDB，杜绝「通知照发、回来什么也没有」；holdBusy 防
  // visibilitychange 重响与 20s 兜底定时器并发双处理（挂起消费必须恰好一次）
  let holdBusy = false;
  function resumeHeldCall() {
    if (holdBusy) return;
    const h = readCallHold();
    if (h) { clearCallHold(); resumeProcessHold(h); return; }
    if (window.idbGet) {
      holdBusy = true;
      window.idbGet(CALL_HOLD_KEY).then(function (ih) {
        holdBusy = false;
        if (!ih || !ih.ts) return;
        clearCallHold();
        resumeProcessHold(ih);
      }).catch(function () { holdBusy = false; });
    }
  }
  function resumeProcessHold(h) {
    const cur = window.__activeCid || 'default';
    if (Date.now() - h.ts <= CALL_HOLD_MS && !currentCall) {
      if (h.cid === cur) { incomingCall(true, !!h.msg); return; }
      // 跨桌面：目标必须在联系人名册内才自动切（防切到已删除桌面造成空命名空间），
      // 切换成功后立即在归属桌面重响
      if (h.cid && window.setActiveContact) {
        let known = (h.cid === 'default');
        try { if (window.getContacts) known = window.getContacts().some(c => c && c.id === h.cid); } catch (e) {}
        if (known) {
          try { window.setActiveContact(h.cid); } catch (e) {}
          if ((window.__activeCid || 'default') === h.cid) { incomingCall(true, !!h.msg); return; }
        }
      }
    }
    notifyCallEnd(h.cid || cur, heldMissedHtml(h.name || partnerName()), 'in', '未接听');
  }
  // 监听联系人重命名事件，实时同步通话昵称
  document.addEventListener('contact-renamed', (e) => {
    if (currentCall && e.detail && e.detail.id === currentCall.cid) {
      syncCallName();
    }
  });
  // v3.5.129：响铃中切后台（锁屏/切走）→ 停铃声并结束来电——
  // 后台无法接听，30 秒干响没有意义（安卓后台音频还会常驻媒体通知）
  // v3.31.x：结束的同时补发一条系统通知（未接来电），用户在通知栏可见
  // #161：升级为「响铃挂起」——切后台静默收尾不判未接（endCall 第二参），
  // 挂起 CALL_HOLD_MS 内回到应用重新响铃可接听，超时才由 resumeHeldCall 补写未接
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && currentCall && currentCall.status === 'ringing') {
      const cid = currentCall.cid || (window.__activeCid || 'default');
      const nm = currentCall.name || partnerName();
      const msgOk = !!(currentCall.sysMsg); // FIX 2026-09-13 #406：续传「打来了语音通话」已写标记
      endCall('', true);
      holdIncomingCall(nm, cid, undefined, msgOk);
    } else if (document.visibilityState === 'visible') {
      resumeHeldCall();
    }
  });
  // v3.6.x：通话弹层开始时先关闭大图查看器——img-view-mask z-index 高于 call-mask，
  // 不关的话来电/去电面板被大图完全盖住，接听/拒绝按钮点不到
  function closeImageOverlay() {
    try {
      const iv = document.getElementById('img-view-mask');
      if (iv) iv.hidden = true;
    } catch (e) {}
  }
  // #161：isReplay——响铃挂起回前台重响时 true，不重复发「给你打来了语音通话」系统消息
  //（挂起前那次前台响铃已发过；后台触发路径则由重响首发，聊天记录两种路径都恰一条）
  // FIX 2026-09-13 #406：重响是否首发该消息由挂起携带的 msg 决定（后台触发来电从未写过，
  // 必须补首发；前台响铃已写 msg=true 则不重复）。currentCall.sysMsg 续传给再次切后台的挂起。
  function incomingCall(isReplay, msgWritten) {
    if (currentCall) return;
    closeImageOverlay();
    // v3.5.60：来电播放设置的铃声音效
    if (window.playSfx) window.playSfx('ring');
    // v3.5.129：来电暂停音乐 + 隐藏悬浮小框（避免铃声+音乐同响、小框遮挡接听按钮）
    if (window.musicHoldForCall) window.musicHoldForCall(true);
    // v3.5.127：来电时收起输入法（键盘会盖住通话面板下半部的接听/拒绝按钮）
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    const name = partnerName();
    currentCall = bindCall({ direction: 'in', status: 'ringing', startTime: Date.now(), durationSec: 0 });
    shownAv = null;
    shownName = null;
    syncCallAv();
    syncCallName();
    if (nameEl) nameEl.textContent = name;
    if (statusEl) statusEl.textContent = '对方来电...';
    if (durEl) durEl.textContent = '00:00';
    if (mask) mask.hidden = false;
    setMaskBtns('ringing');
    let wroteSysMsg = false;
    if ((!isReplay || !msgWritten) && window.chatAddSystem) {
      window.chatAddSystem('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>' +  name + ' 给你打来了语音通话');
      wroteSysMsg = true;
    }
    if (currentCall) currentCall.sysMsg = !!msgWritten || wroteSysMsg;
    // 30 秒倒计时未接
    let count = 30;
    if (cdEl) { cdEl.hidden = false; cdEl.textContent = count + ' 秒后未接听'; }
    const t = setInterval(() => {
      if (!currentCall || currentCall.status !== 'ringing') { clearInterval(t); return; }
      syncCallAv();
      count--;
      if (count <= 0) {
        clearInterval(t);
        if (cdEl) cdEl.hidden = true;
        currentCall.status = 'ended';
        endCall('未接听');
      } else if (cdEl) {
        cdEl.textContent = count + ' 秒后未接听';
      }
    }, 1000);
  }
  // 接听
  function answerCall() {
    if (!currentCall || currentCall.status !== 'ringing') return;
    // v3.5.127：接听即停铃声（不走 endCall 路径）
    if (window.stopSfx) window.stopSfx('ring');
    currentCall.status = 'connected';
    // 接通即恢复音乐播放（模拟通话不再占用音乐，响铃时暂停、接通后立即续播，
    // 同时恢复悬浮小框）；挂断路径照常由 endCall 兜底）
    if (window.musicHoldForCall) window.musicHoldForCall(false);
    if (cdEl) cdEl.hidden = true;
    if (nameEl) nameEl.textContent = partnerName();
    if (statusEl) statusEl.textContent = '正在通话...';
    setMaskBtns('active');
    if (window.chatAddSystem) window.chatAddSystem('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg> 通话已接通');
    startCallDuration();
    saveCallActive(); // v3.26.x：接通后更新持久化（记下 connectedTime 供中断恢复算时长）
    // 2 秒后最小化小框（星言一致）；v3.7.x：小框开关隐藏时保持大面板常驻
    setTimeout(() => {
      if (currentCall && currentCall.status === 'connected') {
        if (callMiniEnabled()) {
          if (mask) mask.hidden = true;
          if (mini) {
            syncCallName();
            syncCallAv();
            mini.hidden = false;
            liftMiniIntoSafeArea(); // v3.26.x #137：显示时校正，防旧坐标落进系统状态栏区
          }
        }
      }
    }, 2000);
  }
  // 拒绝
  function rejectCall() {
    if (!currentCall || currentCall.status !== 'ringing') return;
    currentCall.status = 'ended';
    endCall('已拒绝');
  }
  // 用户挂断（去电中或通话中）
  function userHangup() {
    if (!currentCall) return;
    if (currentCall.status === 'ringing') { currentCall.status = 'ended'; endCall('已取消'); return; }
    // v3.6.x：未接通（呼叫中取消）不算时长——endCall 只在 connectedTime 存在时才标注时长
    // v3.13.x：真实时长按接听时刻 connectedTime 计算（与 updateDur 基准一致，不含响铃/拨出等待）
    if (currentCall.connectedTime) currentCall.durationSec = Math.floor((Date.now() - currentCall.connectedTime) / 1000);
    currentCall.status = 'ended';
    endCall('已挂断');
  }
  // 去电：拨打 → 忙线/拒绝/接通/未接（星言概率）
  window.placeCall = function () {
    if (currentCall) { toast('已有通话中'); return; }
    const name = partnerName();
    currentCall = bindCall({ direction: 'out', status: 'calling', startTime: Date.now(), durationSec: 0 });
    // v3.6.x：绑定本次通话对象——结果定时器回调里校验 currentCall === callRef，
    // 否则「挂断后 3 秒内重拨」会让上一次的随机结果套到新通话上
    const callRef = currentCall;
    closeImageOverlay();
    // v3.6.x：去电同样暂停音乐 + 隐藏悬浮小框（与来电一致），挂断后才能自动恢复播放
    if (window.musicHoldForCall) window.musicHoldForCall(true);
    shownAv = null;
    shownName = null;
    syncCallAv();
    syncCallName();
    if (nameEl) nameEl.textContent = name;
    if (statusEl) statusEl.textContent = '正在呼叫...';
    if (durEl) durEl.textContent = '00:00';
    if (mask) mask.hidden = false;
    setMaskBtns('calling');
    if (window.chatAddSystem) window.chatAddSystem('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>' +  name + ' 语音通话');
    const r = Math.random() * 100;
    const cc = callCfg();
    setTimeout(() => {
      // v3.6.x：必须是本次通话仍在呼叫中才执行（挂断后重拨不套用旧结果）
      if (currentCall !== callRef || callRef.status !== 'calling') return;
      // v3.x.x：去电结果提示——原每次拨打只静默关面板、结果仅写聊天系统消息，
      // 用户看不到接通/未接/忙线；改为各结果分别 toast 明确提示
      if (r < cc.busy) {
        callRef.status = 'ended'; toast('对方忙线中'); endCall('忙线中');
      } else if (r < cc.busy + cc.reject) {
        callRef.status = 'ended'; toast('对方已拒绝'); endCall('对方已拒绝');
      } else if (r < cc.busy + cc.reject + cc.pickup) {
        callRef.status = 'connected';
        // 对方接通即恢复音乐播放（与来电接听一致）
        if (window.musicHoldForCall) window.musicHoldForCall(false);
        toast('通话已接通');
        if (statusEl) statusEl.textContent = '正在通话...';
        startCallDuration();
        saveCallActive(); // v3.26.x：去电接通后更新持久化
        // v3.7.x：小框开关隐藏时接通后保持大面板常驻（不自动最小化）
        setTimeout(() => {
          if (currentCall === callRef && callRef.status === 'connected') {
            if (callMiniEnabled()) {
              if (mask) mask.hidden = true;
          if (mini) { syncCallName(); syncCallAv(); mini.hidden = false; liftMiniIntoSafeArea(); /* v3.26.x #137 显示时校正 */ }
            }
          }
        }, 2000);
      } else {
        callRef.status = 'ended'; toast('对方未接通'); endCall('未接通');
      }
    }, 1800 + Math.random() * 1500);
  };
  // 按钮绑定
  if (answerBtn) answerBtn.addEventListener('click', answerCall);
  if (rejectBtn) rejectBtn.addEventListener('click', rejectCall);
  if (hangBtn) hangBtn.addEventListener('click', userHangup);
  if (miniBtn) miniBtn.addEventListener('click', minimizeCall);
  if (document.getElementById('call-mini-hang')) document.getElementById('call-mini-hang').addEventListener('click', userHangup);
  // 小框拖拽（pointer 事件，兼容鼠标/触摸）
  // v3.5.108：轻点/误触不再导致小框跳位——
  //   - pointerdown 不立即清 bottom（避免 top/bottom 同时 auto 时 fixed 元素跳到别处）
  //   - 只有真正移动（拖动）才切到拖动态：清 bottom + 设 left/top
  //   - pointerup 只在「真实拖动过」才保存位置，轻点不写入（防止存坏坐标）
  // ---- 拖拽坐标系说明（v3.33.x 修复「小框拖动后消失」，零机型/UA 分支）----
  //   旧实现算出的 x/y 是「屏幕/布局视口坐标系」（e.clientX - offX，而 offX = clientX - rect.left，
  //   rect.left 来自 getBoundingClientRect＝屏幕系），却把这段屏幕坐标直接塞进 style.left/top。
  //   这只在「元素的坐标空间 == 可视视口」时恰好成立（普通 position:fixed 且无 transform 祖先）；
  //   一旦小框定位空间与视口不一致——祖先带 transform 让 fixed 退化成绑定到该祖先、
  //   或宽视口下 position:absolute 落在 .phone 内——屏幕坐标会被当成元素自身坐标写入，
  //   小框被甩到视口外 = “拖完莫名消失”。各机型/页面状态（壁纸并层、切换动画、键盘适配、
  //   桌面预览）下是否出现 transform 祖先各不相同 → 不同设备型号都时有时无地复现。
  //   修复：拖拽按「手指位移增量」驱动，用 getBoundingClientRect 把目标屏幕坐标精确换算回
  //   元素自身坐标空间（style = offsetLeft + (目标屏幕位 - 当前 rect 位)），对任意坐标系
  //   （fixed / absolute / 带 transform 祖先）都成立；目标位统一钳制在可视视口内，
  //   iOS standalone 上边界仍抬到系统状态栏下方（miniSafeTop，v3.28.x #114 保留）。
  //   无 transform 的常规路径换算结果与原逻辑逐像素一致（不回归）。
  if (mini) {
    let dragging = false, moved = false, pressLX = 0, pressLY = 0, startLeft = 0, startTop = 0;
    // e.clientX/Y 属「可视视口」坐标系，getBoundingClientRect 属「布局视口」；
    // 转布局视口统一相减，避免 visualViewport 被浏览器条偏移时拖拽错位（同样兼容多机型）
    function vpX(e) { const vv = window.visualViewport; return e.clientX + ((vv && vv.offsetLeft) || 0); }
    function vpY(e) { const vv = window.visualViewport; return e.clientY + ((vv && vv.offsetTop) || 0); }
    mini.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#call-mini-hang')) return; // 挂断按钮不触发拖动
      dragging = true;
      moved = false;
      const r = mini.getBoundingClientRect();
      pressLX = vpX(e); pressLY = vpY(e);
      startLeft = r.left; startTop = r.top; // 按下瞬间小框左上角的屏幕（布局）位
      mini.setPointerCapture && mini.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    mini.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (!moved) {
        // 首次移动：切换为拖动态（清除 bottom，避免与 top 同时存在导致拉伸）。
        // bottom/transform/left/top 同一次同步回调内改完，浏览器只会渲染该批次终态，不会闪跳
        mini.style.bottom = 'auto';
        mini.style.transform = 'none';
        moved = true;
      }
      const mw = mini.offsetWidth, mh = mini.offsetHeight;
      // 期望左上角屏幕位 = 按住位 + 手指位移（保持抓取偏移恒定）
      const vv = window.visualViewport;
      const vw = (vv && vv.width) || window.innerWidth;
      const vh = (vv && vv.height) || window.innerHeight;
      const voL = (vv && vv.offsetLeft) || 0, voT = (vv && vv.offsetTop) || 0;
      let tx = startLeft + (vpX(e) - pressLX);
      let ty = startTop + (vpY(e) - pressLY);
      // 钳制在可视视口内（四条边都留 4px 余量）
      tx = Math.max(Math.max(4, voL), Math.min(voL + vw - mw - 4, tx));
      // v3.28.x #114：拖拽上边界抬到系统状态栏下方，避免缩略窗拖进状态栏区被吞触点
      ty = Math.max(Math.max(miniSafeTop(), voT), Math.min(voT + vh - mh - 4, ty));
      // 把目标屏幕位换算回元素自身坐标空间再写入 style（见函数头坐标系说明）
      const c = mini.getBoundingClientRect();
      mini.style.left = ((mini.offsetLeft || 0) + (tx - c.left)) + 'px';
      mini.style.top = ((mini.offsetTop || 0) + (ty - c.top)) + 'px';
    });
    const endDrag = () => { dragging = false; };
    mini.addEventListener('pointerup', endDrag);
    mini.addEventListener('pointercancel', endDrag);
    mini.addEventListener('pointerup', () => {
      // 只有真实拖动过才保存（位置有效；left/top 已按元素自身坐标空间写出，
      // 重新加载 restore 路径照常读回，不会被误当作屏幕坐标）
      if (moved && mini.style.left && mini.style.top) {
        if (miniPos) { miniPos.left = mini.style.left; miniPos.top = mini.style.top; }
        else miniPos = { left: mini.style.left, top: mini.style.top };
        store.set('call-mini-pos', JSON.stringify(miniPos));
      }
    });
  }

  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }

  // ================= 联系人主动来电（星言机制：每 5 分钟冷却 + 来电概率） =================
  window.triggerIncomingCall = incomingCall;
  // 上次来电时间戳：首次约 1-2 分钟检查（原 2-5 分钟太久，用户会以为 TA 从不来电），
  // 之后每 60-120 秒检查一次（来电概率 + 冷却至少 5 分钟；原 30 秒太频繁，用户反馈来电过多）
  function callLast() { const v = parseInt(store.get('records-call-last'), 10); return isNaN(v) ? 0 : v; }
  function maybeIncoming() {
    try {
      if (currentCall) return;
      const now = Date.now();
      // v3.6.x：冷却戳为未来时间（设备时钟被改动过）→ 按 0 处理，避免来电被永久锁死
      const last = Math.min(callLast(), now);
      if (now - last < 300000) return; // 5 分钟冷却
      if (Math.random() * 100 >= callCfg().incoming) return;
      store.set('records-call-last', String(now));
      // v3.31.x：后台命中来电不再直接放弃（原 v3.5.127 直接 return，后台永远没来电通知）
      // #161：升级为「响铃挂起」——不再即判未接，先发通知+挂起，3 分钟内回到应用
      // 重新响铃可接听，超时由 resumeHeldCall 补写未接（写记录/系统消息收口在挂起侧）
      if (document.hidden) {
        holdIncomingCall(partnerName(), window.__activeCid || 'default');
        return;
      }
      incomingCall();
    } catch (e) {}
  }
  // v3.6.x：暴露给聊天模块——TA 回复消息/主动发消息后按「通话设置-来电概率」掷一次来电
  // （与 maybeMusicRequest 同模式：chat.js 只调 window 钩子，来电逻辑全在本模块）
  window.callMaybeTrigger = maybeIncoming;
  // v3.7.x：通话半框用的状态快照 + 挂断（chat.js 打开半框时每秒轮询显示）
  window.getCallState = function () {
    if (!currentCall) return null;
    const start = currentCall.connectedTime || currentCall.startTime;
    return {
      status: currentCall.status,           // ringing(来电) | calling(呼出中) | connected(通话中)
      direction: currentCall.direction,     // in | out
      name: currentCall.name || partnerName(),
      durationSec: Math.max(0, Math.floor((Date.now() - start) / 1000))
    };
  };
  window.hangupCall = function () { userHangup(); };
  // v3.26.x：启动恢复——上次通话因刷新/崩溃中断（call-active 未被 endCall 清除）→ 补写「通话中断」记录
  //   必须在 mochi-restore-done 后执行：此时 records-call 已从 IDB 回填到 LS，unshift 写回不会覆盖。
  //   mochi-restore-done 一定在回填完成后派发（idb.js finish()），即使保险丝超时最终完成也会派发。
  function recoverCall() {
    let info = null;
    try { info = JSON.parse(sessionStorage.getItem(CALL_ACTIVE_KEY) || 'null'); } catch (e) { info = null; }
    // v3.26.x：#120 sessionStorage 空 → 读 localStorage 兜底（关浏览器/PWA 重开场景）。
    //   同标签普通刷新 sessionStorage 仍在，优先读它以保持原行为。
    let fromLs = false;
    if (!info) {
      try { info = JSON.parse(localStorage.getItem(CALL_ACTIVE_KEY) || 'null'); } catch (e) { info = null; }
      fromLs = !!info;
    }
    if (!info) return;
    if (!info.connectedTime) { clearCallActive(); return; } // 未接通就中断（响铃/呼叫中刷新），不恢复不记
    const cid = info.cid || 'default';
    const dir = info.direction || 'out';
    const name = info.name || 'TA';
    // v3.26.x：开启「刷新后恢复通话」→ 重建通话 UI + 从接通时刻继续计时（TA 本地模拟，无需重连）
    if (callCfg().resume !== 0) {
      // #120 localStorage 兜底只恢复「新鲜」标记（心跳每 20 秒刷 ts；10 分钟窗覆盖 iPadOS
      //   杀后台后不久重开），超窗视为早已结束：静默清标记，不恢复也不翻旧账
      if (fromLs && Date.now() - (info.ts || 0) > 600000) { clearCallActive(); return; }
      try {
        currentCall = { cid: cid, direction: dir, status: 'connected', startTime: info.startTime || info.connectedTime, connectedTime: info.connectedTime, durationSec: 0, name: name, av: info.av || '' };
        shownAv = null; shownName = null;
        if (callMiniEnabled()) {
          if (mask) mask.hidden = true;
          if (cdEl) cdEl.hidden = true;
          if (mini) { syncCallName(); syncCallAv(); mini.hidden = false; liftMiniIntoSafeArea(); /* v3.26.x #137 显示时校正 */ }
        } else {
          if (mask) mask.hidden = false;
          if (cdEl) cdEl.hidden = true;
          if (nameEl) nameEl.textContent = name;
          if (statusEl) statusEl.textContent = '正在通话...';
          setMaskBtns('active');
          syncCallAv(); syncCallName();
        }
        startCallDuration();
        saveCallActive(); // #120 回写 sessionStorage（后续刷新优先走 sessionStorage 快路径）+ 刷新 ts
      } catch (e) { clearCallActive(); }
      return;
    }
    // 关闭恢复 → 记中断记录
    clearCallActive();
    const dur = Math.max(0, Math.floor((info.ts - info.connectedTime) / 1000));
    const durTxt = dur > 0 ? ' · 时长 ' + fmtDur(dur) : '';
    const recText = '通话中断（页面刷新或异常退出）' + durTxt;
    const sysHtml = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>' + (dir === 'in' ? name + ' 来电' : '我拨打 ' + name) + ' · 通话中断' + durTxt;
    try {
      const s = (window.storeFor && window.storeFor(cid)) || store;
      let list = [];
      try { list = JSON.parse(s.get('records-call') || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      list.unshift({ type: dir, text: recText, ts: Date.now(), ended: 'interrupt' });
      s.set('records-call', JSON.stringify(list.slice(0, 50)));
      if (window.idbSet) { try { window.idbSet('xy-home-v2:' + cid + ':records-call', list.slice(0, 50)); } catch (e) {} }
    } catch (e) {}
    try {
      const cur = window.__activeCid || 'default';
      if (cid === cur) { if (window.chatAddSystem) window.chatAddSystem(sysHtml); }
      else if (window.chatAppendToDeskMsg) { window.chatAppendToDeskMsg(cid, sysHtml); }
    } catch (e) {}
    try { if (!document.getElementById('page-home').hidden && window.__renderHomeCall) window.__renderHomeCall(); } catch (e) {}
  }
  // #161：冷启动恢复——restore 完成后检查响铃挂起（3 分钟内重开浏览器 → 重新响铃可接听；
  // resumeHeldCall 读后即清 + 写 {ts:0}，重复触发幂等无副作用）
  function bootCallResume() {
    try { recoverCall(); } catch (e) {}
    setTimeout(function () { try { resumeHeldCall(); } catch (e) {} }, 1200);
  }
  if (window.__mochiDataReady) { try { bootCallResume(); } catch (e) {} }
  else { try { document.addEventListener('mochi-restore-done', function () { try { bootCallResume(); } catch (e) {} }); } catch (e) {} }
  setTimeout(function () { try { resumeHeldCall(); } catch (e) {} }, 20000); // 回填挂起设备兜底（幂等）
  setTimeout(() => {
    function scheduleCallCheck() {
      maybeIncoming();
      setTimeout(scheduleCallCheck, (60 + Math.random() * 60) * 1000);
    }
    scheduleCallCheck();
  }, (45 + Math.random() * 75) * 1000);
})();

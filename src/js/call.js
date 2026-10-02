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
  // FIX 2026-09-29 #1394（作者直派「刷新后恢复通话开了，但接上通话后一直不触发挂断概率」）：
  //   可选参数 cid＝这一通电话的归属桌面。原实现一律读「当前激活桌面」的设置（replyCfg →
  //   activeStore 按 __activeCid 动态解析），而「通话中挂断概率」这一发掷在通话进行期间——那时
  //   用户可能已切到别的联系人桌面（或刷新后回到别的桌面），于是「A 的通话」按「B 的概率」判定：
  //   B 从没存过这个键则回落默认 2%，B 设过 0 就永不挂断；而挂断记录仍写回归属桌面＝设置页看到
  //   的和实际生效的不是同一个人。
  //   ⚠ 只在「归属桌面 ≠ 当前桌面」时才改读法：default 桌面的 activeStore 带旧顶层键回退
  //   （contacts.js 的 defaultStore），storeFor('default') 没有那一层——无条件换读法会把未迁移的
  //   老数据判成「没设过」＝静默回落默认值，那是新缺陷不是修复。
  function callCfg(cid) {
    const own = cid && cid !== (window.__activeCid || 'default');
    const c = (own && window.replyCfgFor ? window.replyCfgFor(cid) : (window.replyCfg && window.replyCfg())) || {};
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
  function paintCallBg(el, bg) {
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
  }
  // #987：两处涂装收进同一个函数——原来 applyCallBg / applyCallHalfBg 各涂各的落点，
  //   谁后运行谁说了算，结果「半框背景」把图涂在了设置用的半屏面板上（用户报「上传错地方」）。
  //   落点口径：来电/去电弹窗卡片（.call-panel）＝联系人来电 / 你拨打联系人时那个方形通话框，
  //   优先用「半框背景」，没设过回落「通话背景」；通话小框（#call-mini）只认「通话背景」。
  function applyCallBgs() {
    const cbg = store.get(CALL_BG_KEY) || '';
    const hbg = store.get(CALL_HALF_BG_KEY) || '';
    paintCallBg(document.querySelector('.call-panel'), hbg || cbg);
    paintCallBg(document.getElementById('call-mini'), cbg);
    const val = document.getElementById('call-bg-val');
    if (val) val.textContent = cbg ? '已设置' : '默认';
    const rm = document.getElementById('call-bg-remove');
    if (rm) rm.hidden = !cbg;
    // v3.12.x：聊天页「更多功能→通话」半框里的背景行同步回显（设置页与半框两处入口共用状态）
    const evalVal = document.getElementById('call-bg-edit-val');
    if (evalVal) evalVal.textContent = cbg ? '已设置' : '默认';
    const rmEdit = document.getElementById('call-bg-edit-remove');
    if (rmEdit) rmEdit.hidden = !cbg;
    const hval = document.getElementById('call-half-bg-val');
    if (hval) hval.textContent = hbg ? '已设置' : '默认';
    const hrm = document.getElementById('call-half-bg-remove');
    if (hrm) hrm.hidden = !hbg;
    // #651：通话功能页同款入口行随存值同步回显（与设置页两处入口共用状态）
    const hEditVal = document.getElementById('call-half-bg-edit-val');
    if (hEditVal) hEditVal.textContent = hbg ? '已设置' : '默认';
    const hEditRm = document.getElementById('call-half-bg-edit-remove');
    if (hEditRm) hEditRm.hidden = !hbg;
  }
  // 两个名字都保留（#368 锚行 contact-switched → applyCallBg、#641 起 applyCallHalfBg 被
  //   上传/移除/切桌面各处调用）：现在指向同一份「两处涂装」，先跑后跑结果一致。
  function applyCallBg() { applyCallBgs(); }
  // v3.12.x：上传逻辑抽成 pickCallBg()——设置页 #call-bg-row 与通话半框 #call-bg-edit-row 两个入口共用
  // #641：支持指定存储键（默认通话背景 call-bg；传 call-half-bg 即「通话半框背景」）
  function pickCallBg(key, msg) {
    const bgKey = key || CALL_BG_KEY;
    // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
    return window.mochiFilePick({
      id: 'mochi-call-bg-pick', accept: 'image/*',
      onFiles: (files) => {
      const f = files && files[0];
      if (!f) { toast('没有取到图片，请再选一次'); return; }
      if (!window.mochiImgIngest) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return; }
      // FIX 2026-09-25 #1270：原实现 readAsDataURL + new Image() 整幅解码（48MP 照片＝192MB 位图）→ iOS 直接回收页面
      // FIX 2026-09-28 #1054（重放）：上限 600 太小——这张图是按 cover 铺满整张通话卡片的，600 边在手机上必然被
      //   放大糊掉（用户实报「上传通话半框图片很糊」）。#1270 迁到统一 ingest 时这一档被带回 600＝回归，现按原批
      //   结论提到 1920：缩放/字节收敛都交给 ingest（与聊天背景 csBgMaxSide 那档同量级，零机型分支）。
      window.mochiImgIngest(f, { maxSide: 1920, quality: 0.85, tag: 'call-bg' }).then((r) => {
        if (!r || r.st !== 'ok' || !r.data) { toast(window.mochiImgIngestMiss(r, '通话背景')); return; }
        const data = r.data;
        store.set(bgKey, data);
        if (bgKey === CALL_HALF_BG_KEY) applyCallHalfBg(); else applyCallBg();
        toast(msg || '通话背景已设置');
      });
      }
    });
  }
  const callBgRow = document.getElementById('call-bg-row');
  if (callBgRow) callBgRow.addEventListener('click', () => pickCallBg(CALL_BG_KEY));
  // FIX 2026-09-27 #1323：这四行是那份 iPhone 诊断单里唯一还留着「只剩合成腿」的照片门——00:03:15 与
  // 00:03:35 两发都只有 leg:fire＋fb:onscreen、一条 files=N 都没回来，而同一分钟里头像库那扇铺了真层
  // 的门 surf:hit＋surf:files=1 当场成功＝同一台设备、同一次会话的 A/B，与机型无关（判据只有「手指
  // 这一下落在的是不是一个真 file input」）。四行都在 template.html 里静态存在、不随渲染重建＝当场铺
  // 一次长期有效；共用同一个宿主 mochi-call-bg-pick，管线仍走上面 pickCallBg 那一条（模具见 device.js
  // #1323，选完图由 surface 交回宿主、按最后一次点按的闭包写各自的键，两把键不会串）。
  if (window.mochiFilePickDoor) {
    ['call-bg-row', 'call-bg-edit-row', 'call-half-bg-row', 'call-half-bg-edit-row'].forEach(function (rid) {
      const door = document.getElementById(rid);
      if (door) window.mochiFilePickDoor(door, { owner: 'mochi-call-bg-pick', accept: 'image/*' });
    });
  }
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
  if (callBgEditRow) callBgEditRow.addEventListener('click', () => pickCallBg(CALL_BG_KEY));
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
  // #641/#987：来电/去电弹窗背景（键 call-half-bg）——作用于联系人来电 / 你拨打联系人时
  //   弹出的那个方形通话框（.call-panel），也就是聊天页「更多功能→通话」里「打开来电弹窗」
  //   预览的那个框。与通话小框的通话背景（call-bg）互不影响；没设过它时弹窗回落显示通话背景。
  const CALL_HALF_BG_KEY = 'call-half-bg';
  function applyCallHalfBg() { applyCallBgs(); }
  const callHalfBgRow = document.getElementById('call-half-bg-row');
  if (callHalfBgRow) callHalfBgRow.addEventListener('click', () => pickCallBg(CALL_HALF_BG_KEY, '通话半框背景已设置'));
  const callHalfBgRm = document.getElementById('call-half-bg-remove');
  if (callHalfBgRm) {
    callHalfBgRm.addEventListener('click', () => {
      store.remove(CALL_HALF_BG_KEY);
      applyCallHalfBg();
      toast('已恢复默认通话半框背景');
    });
  }
  // #641：通话设置页「打开通话半框」——跳到当前联系人的聊天页并展开通话半框
  const callHalfOpenRow = document.getElementById('call-half-open');
  if (callHalfOpenRow) {
    callHalfOpenRow.addEventListener('click', () => {
      if (!window.enterChat || !window.openChatCallPanel) { toast('通话半框暂不可用'); return; }
      window.enterChat();
      window.openChatCallPanel();
    });
  }
  // #651：通话功能页（聊天「更多功能→通话」半框）内直接上传/移除「通话半框背景」——
  //   与设置页 #call-half-bg-row 同键 call-half-bg、共用 pickCallBg；行值回显由 applyCallHalfBg 同步
  const callHalfBgEditRow = document.getElementById('call-half-bg-edit-row');
  if (callHalfBgEditRow) callHalfBgEditRow.addEventListener('click', () => pickCallBg(CALL_HALF_BG_KEY, '通话半框背景已设置'));
  const callHalfBgEditRm = document.getElementById('call-half-bg-edit-remove');
  if (callHalfBgEditRm) {
    callHalfBgEditRm.addEventListener('click', () => {
      store.remove(CALL_HALF_BG_KEY);
      applyCallHalfBg();
      toast('已恢复默认通话半框背景');
    });
  }
  // #651：「打开来电弹窗」预览——在通话功能页里直接打开「联系人来电」时的大弹窗
  //   （.call-mask/.call-panel，非迷你小框 #call-mini）看看效果。纯 DOM 预览：不掷概率、
  //   不写记录/系统消息、不播音效、不碰 currentCall；标题标「· 预览」提示非真实来电；
  //   预览期盖一层透明拦截层，点弹窗/遮罩任意处退出，绝不会误触真实接听/拒绝按钮。
  //   真实来电/去电触发时 incomingCall/placeCall 开头调 closeCallPreview() 立即让位。
  let callPreviewOn = false;
  function closeCallPreview() {
    if (!callPreviewOn) return;
    callPreviewOn = false;
    const m = document.getElementById('call-mask');
    const title = m && m.querySelector('.call-title');
    if (title) title.textContent = '语音通话';
    if (m) m.hidden = true;
    const catcher = document.getElementById('call-preview-catcher');
    if (catcher && catcher.parentNode) catcher.parentNode.removeChild(catcher);
    setMaskBtns('none');
  }
  function previewCallPopup() {
    if (callPreviewOn) { closeCallPreview(); return; }
    // #987：通话进行中点这行不再只弹一句「当前正在通话中」——用户点它想看的就是那个方形
    //   通话框，而真实通话面板本来就是那个框，直接把面板展开（并收起悬浮小框，免得面板与
    //   小框两层叠着）；全程不构造预览画面、不碰通话状态、不触发接听/拒绝。面板已开着
    //   （来电响铃中 / 关闭「隐藏通话小框」的常驻面板）时没有可展开的东西，只提示一句。
    if (currentCall) {
      if (mask && mask.hidden) {
        mask.hidden = false;
        if (mini) mini.hidden = true;
        toast('通话中·已展开通话面板');
      } else {
        toast('通话中·通话面板已打开');
      }
      return;
    }
    const m = document.getElementById('call-mask');
    if (!m) { toast('通话弹窗暂不可用'); return; }
    fillAv(document.getElementById('call-av'), partnerAv());
    const nm = document.getElementById('call-name');
    if (nm) nm.textContent = partnerName();
    const st = document.getElementById('call-status');
    if (st) st.textContent = '对方来电...';
    const du = document.getElementById('call-duration');
    if (du) du.textContent = '00:00';
    const cd = document.getElementById('call-countdown');
    if (cd) cd.hidden = true;
    const title = m.querySelector('.call-title');
    if (title) title.textContent = '语音通话 · 预览';
    setMaskBtns('ringing');
    m.hidden = false;
    const catcher = document.createElement('div');
    catcher.id = 'call-preview-catcher';
    catcher.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;';
    catcher.addEventListener('click', closeCallPreview);
    m.appendChild(catcher);
    callPreviewOn = true;
    toast('预览模式：点击任意处退出');
  }
  const callViewRow = document.getElementById('call-view-row');
  if (callViewRow) callViewRow.addEventListener('click', previewCallPopup);
  // 预览中切桌面：通话功能页随切换收起，预览弹窗一并退出（姓名/头像不残留上一桌面）
  document.addEventListener('contact-switched', closeCallPreview);
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
      // #641：通话半框背景同为大图键，启动补读同款兜底
      window.idbGet(myPrefix + ':' + CALL_HALF_BG_KEY).then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (v && typeof v === 'string' && v.length > 2 && !store.get(CALL_HALF_BG_KEY)) {
          store.set(CALL_HALF_BG_KEY, v);
          applyCallHalfBg();
        }
      });
    }
  } catch (e) {}
  applyCallBg();
  applyCallHalfBg();
  // v3.26.x：切换联系人桌面后重读当前桌面的通话背景——.call-panel/#call-mini 是全站共享 DOM，
  //   背景图 style 只在加载/上传/移除时写入，切桌面不刷新就会残留上一个联系人的背景（跨桌面串图）
  // #641：通话半框背景同样按桌面各存各的，切桌面一并重读重涂（#368 原锚行保持原样）
  document.addEventListener('contact-switched', applyCallBg);
  document.addEventListener('contact-switched', applyCallHalfBg);

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

  // 2026-09-16（#616 用户要求：聊天昵称因为变更多，只影响聊天页；其他功能一律跟桌面昵称）：
  // 通话改回「桌面昵称 lbl-partner 优先」。v3.26.x 时这里对齐聊天域读 cs-lbl-partner，但昵称池
  // 上线后聊天昵称会被频繁轮换，通话/来电横幅跟着一起变就成了噪音；名片名兜底与聊天顶栏同
  // 口径（只改名片时不再显示成 TA/他/她）。
  // 回退链：桌面昵称 → 聊天昵称 → 联系人名片名 → TA——桌面没设过时仍退回聊天昵称，
  // 「只设过聊天昵称」的老用户显示不变（用户确认的回退口径）。
  function partnerName() {
    const nick = store.get('lbl-partner') || store.get('cs-lbl-partner')
      || (window.contactNameFor ? window.contactNameFor(window.__activeCid || 'default') : '');
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
  // FIX 2026-09-18 #757：标记里不再带头像 dataURL（实测该键在真机诊断里 52.0 KB——就是
  //   avatar-partner 的 base64 被整份塞进 payload）。它每 20 秒被三路各写一遍，是弱内核
  //   （夸克/UC 系分叉内核）上「写入偶发失败 / 标记过期」的放大器；恢复时 syncCallAv 本就按
  //   归属桌面重读头像（cs-avatar-partner → avatar-partner），payload 里的 av 只是 store 读取
  //   抛异常时的兜底。字段保留为空串（老值仍能被 recoverProcess 兼容读回），键体重回 <1KB。
  function callActivePayload() {
    return JSON.stringify({
      cid: currentCall.cid, direction: currentCall.direction, status: currentCall.status,
      startTime: currentCall.startTime, connectedTime: currentCall.connectedTime || 0,
      // #1394：掷骰的墙钟锚跟着落盘——不带它，刷新/恢复后「下一次该掷的时刻」只能从零重排，
      //   那正是「反复刷新＝无限续命」的来路。旧载荷没这个字段（读到 0）→ 恢复时按当下重算。
      hangupAt: currentCall.hangupAt || 0,
      name: currentCall.name || '', av: '', ts: Date.now()
    });
  }
  // FIX 2026-09-17 #698：三路写入拆开各吃各的 try + 追加 IndexedDB 兜底——
  //   原实现 sessionStorage 与 localStorage 同处一个 try，部分机型（LS 配额满 QuotaExceededError
  //   #406 已实锤 / 隐私模式 / WebView 禁用 sessionStorage）第一句一抛整块中止，
  //   call-active 一份都没落盘＝刷新后通话不续上、也不补「通话中断」记录（多机型反馈）。
  //   与 #406 的 call-hold 同口径：IDB 副本保证任何存储亚健康机型都读得回（recoverCall 回读链
  //   sessionStorage → localStorage → IDB，新鲜度窗口见 recoverProcess）。
  function saveCallActive() {
    if (!currentCall) return;
    const payload = callActivePayload();
    try { sessionStorage.setItem(CALL_ACTIVE_KEY, payload); } catch (e) {}
    try { localStorage.setItem(CALL_ACTIVE_KEY, payload); } catch (e) {}
    try { if (window.idbSet) window.idbSet(CALL_ACTIVE_KEY, JSON.parse(payload)); } catch (e) {}
  }
  // FIX 2026-09-18 #757（用户直派：小米 civi4pro 夸克「刷新后概率出现电话挂断，但无挂断记录；
  //   刷新重新打开，通话和通话时间也没有续上」，用户明说其他机型也有）：恢复窗口原实现是
  //   「心跳 ts 10 分钟窗」，而心跳是 setInterval——页面被系统冻结/杀进程时（锁屏、切后台、
  //   浏览器回收标签页；安卓 5 分钟后 Freeze）它根本不跑，ts 就停在被冻结那一刻。用户回来
  //   （尤其浏览器杀后台后重开＝新运行期、sessionStorage 已空）走 localStorage 兜底时，这通
  //   电话被判「早已结束」→ clearCallActive 静默清标记：不续上、不补记录，整通电话无声消失。
  //   实测复现（tools/verify-call-refresh-resume.mjs C 轴）：SS 丢失 + LS 的 ts 停在 11 分钟
  //   前 ⇒ 通话消失且 records-call 零条。修法四条：
  //   ①恢复窗口改用「通话语义的墙钟上限」CALL_RESUME_WINDOW——锁屏/挂后台整场都算通话；
  //   ②超窗不再静默：SS/LS 是本机同步写下的真实标记（正常结束必留 {ts:0} 墓碑），超窗即
  //     补写「通话中断」记录；IDB 兜底副本维持原 10 分钟静默窗（#705 的幽灵复活防线靠它）；
  //   ③隐藏/冻结/离页时立刻冲刷一次标记（见下方监听），让 ts 精确停在「页面最后一次存活」，
  //     而不是上一个 20 秒心跳；
  //   ④恢复中途出错也补记录（原来只 clearCallActive＝同样无声消失）。
  const CALL_RESUME_WINDOW = 6 * 3600 * 1000; // #757：SS/LS 墙钟窗（锁屏/后台整场通话都算）
  const CALL_IDB_WINDOW = 600000;             // #120/#705：IDB 兜底副本的新鲜度窗，原样不变
  // #757：把「页面要走了」这一刻的现场立刻落盘（connected 通话才算；响铃/去电中会被
  //   endCall 清成墓地，status 判据天然把它们排除，与本函数注册顺序无关）。
  function flushCallActive() {
    if (!currentCall || currentCall.status !== 'connected') return;
    saveCallActive();
  }
  function clearCallActive() {
    // FIX 2026-09-17 #705 SS/LS 同步写 {ts:0} 墓碑而非 removeItem——#698 给 recoverCall 加了
    //   IDB 兜底回读，而这里的 IDB 墓碑是异步的：挂断后页面在墓碑落地前被杀/刷新（vivo/Edge
    //   杀渲染进程常态），下次启动 SS/LS 全空 → 落进 IDB 回读 → 拿到仍是「通话中」的新鲜快照
    //   ＝幽灵通话复活（小框凭空弹「正在通话」、恢复关闭时补写幽灵「通话中断」记录，用户观感
    //   即「接完/挂了之后 TA 又打来」）。SS/LS 墓碑是同步落地的，recoverCall 的 SS/LS 路径
    //   读到无 connectedTime 即清除并 return，不再落到 IDB 兜底；真中断恢复语义不受影响
    //   （真中断＝kill 时 endCall 没跑＝SS/LS 里还是真实快照）。写 {ts:0} 而非删除＝同
    //   clearCallHold 口径，防 idbRestore 用 IDB 旧值回填出幽灵标记；无 connectedTime 的值
    //   recoverCall/callInProgress 读到即视为无通话，幂等无副作用。
    try { sessionStorage.setItem(CALL_ACTIVE_KEY, '{"ts":0}'); } catch (e) {}
    try { localStorage.setItem(CALL_ACTIVE_KEY, '{"ts":0}'); } catch (e) {}
    // 写 {ts:0} 墓碑而非删除（同 clearCallHold 口径）：防 idbRestore 用 IDB 旧值回填出幽灵标记；
    // 无 connectedTime 的值 recoverCall 读到即清，幂等无副作用
    try { if (window.idbSet) window.idbSet(CALL_ACTIVE_KEY, { ts: 0 }); } catch (e) {}
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
      // 2026-09-16（#616）：与 partnerName 同口径——桌面昵称优先、聊天昵称兜底，再回退联系人
      // 名片名，最后默认 TA；性别称呼按归属桌面读（跨桌面通话仍显示正确的 TA）
      name = s.get('lbl-partner') || s.get('cs-lbl-partner')
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
    // FIX 2026-09-29 #1394（作者直派「刷新恢复通话后一直不触发通话中挂断概率」）：掷骰周期从
    //   「数满 60 个 1 秒 tick」改成墙钟锚 currentCall.hangupAt。两条根因都在「数 tick」这一件事上：
    //   ①通话进行时页面通常在息屏/后台，隐藏页定时器被内核节流到约 1 次/分钟、安卓 5 分钟后整页冻结
    //   （#757 在本文件写下过同一事实：心跳 setInterval「页面被系统冻结/杀进程时根本不跑」）——
    //   60 次 tick 最长要走 60 分钟，冻结期间压根不走；②计数是 startCallDuration 的闭包局部，
    //   每刷新/恢复一次就从零重数＝反复刷新可无限续命。作者实测所见「接上通话后一直不掷骰」即此。
    //   锚随 call-active 载荷落盘（见 callActivePayload）并在恢复时带回，故后台与刷新都不再赖账；
    //   前台节奏一字未动（接通满 3 分钟后每 60 秒一次，与函数头文档同口径）。
    //   语义取舍（作者点名的口径）：整页冻结 30 分钟后回场，只补掷一次（锚已过期→下一 tick 掷一发，
    //   然后重新 +60 秒），不按错过的档数成串补掷。
    if (!currentCall.hangupAt) currentCall.hangupAt = Math.max(currentCall.connectedTime + 180000, Date.now());
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
      if (currentCall && currentCall.status === 'connected' && Date.now() >= currentCall.hangupAt) {
        currentCall.hangupAt = Date.now() + 60000;
        // #200：总开关开启或挂断概率 <=0 时硬闸不掷骰——概率为 0 本就不该挂断，
        // 这里再显式拦一道，防设置读取异常回落默认值导致「设 0 仍被挂断」
        // #1394：按归属桌面读概率（掷骰时用户可能已切桌面）
        const hp = callCfg(currentCall.cid);
        if (!(hp.nohangup || hp.hangup <= 0) && Math.random() * 100 < hp.hangup) {
          endCall('对方挂断了电话');
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
    // FIX 2026-09-17 #705 任何一通电话结束都重写来电冷却戳——原实现只在「联系人来电触发」
    //   那一刻写 records-call-last：①去电（placeCall）从不写＝打完电话后联系人可能马上
    //   又打来；②来电从「触发」起算 5 分钟，而后台来电（#161 响铃挂起）常要等用户回来看
    //   才被接听，接完时冷却已所剩无几＝「接通电话后联系人还会再打电话」（用户直派，
    //   多机型）。改为结束时刻起算：每通电话（含未接/拒绝/挂起收尾）结束后 5 分钟内
    //   maybeIncoming 一律不再掷来电，与「冷却至少 5 分钟」的产品语义一致。
    try { store.set('records-call-last', String(Date.now())); } catch (e) {}
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
  // #1456：callAlert/callTag——让后台来电通知带「振铃感」（振动＋常驻＋重提醒，见
  //   bg-keep.js bgNotifyCheck 的 extra.callAlert 分支）。后台放不出铃声是移动端内核
  //   冻结后台页音频的硬限制，通知侧做到最接近来电即是上限。
  function bgCallNotify(name, hint, avOverride) {
    try {
      if (window.bgNotifyCheck) window.bgNotifyCheck(name + ' 来电了' + (hint ? '，' + hint : ''), Date.now(), { name: name + '来电', av: avOverride || partnerAv(), avFixed: true, force: true, callAlert: true, callTag: name, kind: 'call' });
    } catch (e) {}
  }
  // #161：响铃挂起——后台来电不再「命中即未接」（用户反馈：点开通知永远接不到，
  // 联系人已经挂断＝设计缺陷）。改为：先发系统通知 + 挂起来电（CALL_HOLD_KEY 全局
  // 根键，含归属 cid——回前台时可能停在别的桌面；已登记 contacts.js EXCLUDE 防迁移），
  // CALL_HOLD_MS 内回到应用（visibilitychange visible / 冷启动恢复）→ 重新响铃可接听；
  // 超时未回 → resumeHeldCall 补写「未接来电」记录+系统消息。
  const CALL_HOLD_MS = 3 * 60 * 1000;
  const CALL_HOLD_KEY = 'xy-home-v2:call-hold';
  // FIX 2026-09-18 #722（用户直派「接了电话却被记未接」，vivo/Edge/iOS 多机型）：
  //   挂起带「写入运行期」标识（每次页面运行随机）。消费侧据此区分两种值：
  //   ①同运行期切后台写下的真挂起（响铃切后台→回前台）＝保有「超时补写未接」语义；
  //   ②跨运行期从持久层幸存下来的值＝两种来源都是假象——clearCallHold 的 {ts:0} 墓碑
  //   对 IDB 是异步写，消费后进程被杀/刷新（vivo/Edge 常态，#705 call-active 同款实锤）
  //   会让旧挂起残留 IDB；iOS 系统级清 LS 后 idbRestore 又拿 IDB 旧值回填进 LS。
  //   这类孤儿被 resumeHeldCall 当真挂起消费时，旧实现无条件补写「来电 · 未接听」
  //   ＝用户明明接通了电话（甚至通话刚被 recoverCall 恢复成接通态），切后台回前台
  //   聊天里却多一条未接。跨运行期孤儿一律静默清（见 resumeHeldCall/resumeProcessHold）
  const HOLD_SID = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function heldMissedHtml(nm) {
    return '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>' + nm + ' 来电 · 未接听';
  }
  // #1456：后台来电「隔 30 秒重弹一次通知」——后台只弹一条「XX 来电了」，用户很容易划掉或没留意；
  // 真来电是一直在响的，这里用重复提醒模拟「还在响」。边界（防空转/防叠条/防误催）：
  //   ①由 holdIncomingCall（挂起写入）启动，与 #1291 的 6s 短窗去重互补（重弹间隔 30s > 6s 窗）；
  //   ②每次重弹仍走 bgCallNotify（force=true，照旧绕过内容去重闸门，不会因同名同文被吞掉）；
  //   ③同一联系人共用一条通知 tag（见 bg-keep.js 的 extra.callAlert）＝「替换＋再提醒」，
  //     不是堆一串条，#1291「一条来电攒出一串重复通知」的口径不变；
  //   ④任一条命中即立刻停：已回到前台（含只发 focus 不发 visibilitychange 的机型）、
  //     挂起被消费或已写墓碑、换了联系人/姓名、超出 CALL_HOLD_MS 窗口、重弹已达上限。
  const CALL_REPEAT_MS = 30000;
  const CALL_REPEAT_MAX = 5;
  let callRepeatTimer = 0;
  let callRepeatCount = 0;
  function stopCallRepeat() {
    if (callRepeatTimer) { clearTimeout(callRepeatTimer); callRepeatTimer = 0; }
    callRepeatCount = 0;
  }
  function startCallRepeat(name, cid, avOverride) {
    stopCallRepeat();
    const wantCid = cid || (window.__activeCid || 'default');
    const tick = function () {
      callRepeatTimer = 0;
      if (currentCall) { stopCallRepeat(); return; } // 已接通/前台响铃中/通话已结束
      if (document.visibilityState === 'visible') { stopCallRepeat(); return; }
      let h = null;
      try { h = readCallHold(); } catch (e) {}
      if (!h || h.name !== name || h.cid !== wantCid || Date.now() - h.ts > CALL_HOLD_MS) { stopCallRepeat(); return; }
      if (callRepeatCount >= CALL_REPEAT_MAX) { stopCallRepeat(); return; }
      callRepeatCount++;
      bgCallNotify(name, '快回来接听，对方会等你几分钟', avOverride);
      callRepeatTimer = setTimeout(tick, CALL_REPEAT_MS);
    };
    callRepeatTimer = setTimeout(tick, CALL_REPEAT_MS);
  }
  function holdIncomingCall(name, cid, avOverride, msgWritten) {
    let prev = null;
    try { prev = readCallHold(); } catch (e) {}
    // #1291（原 #1218 通知批，撞号已改）：同一次响铃经「切后台→回前台重响→再切后台」会反复触发
    //   holdIncomingCall，每次都无条件 bgCallNotify → 同名「XX 来电了」通知跟着前后台来回攒
    //   （配 SW 就绪补发＝一条来电攒出一串重复通知，「延迟+重复」的来源之一）。短窗（6s）内已有
    //   同一联系人的挂起且刚通知过 → 只重建挂起、不再重复发系统通知（不影响挂起语义）。
    const justNotified = prev && prev.name === name && Date.now() - prev.ts < 6000;
    // 覆盖前先处理上一条已超时未处理的挂起（页面冻结期间第二次来电的场景）。
    // FIX 2026-09-18 #722：只补写「本运行期写下」的过期挂起；跨运行期读到的旧挂起是
    //   墓碑 flush 竞态/LS 回填孤儿（见 HOLD_SID 注释），其未接语义不可信，静默让位
    //   （新挂起连 sid 一起覆盖写入，孤儿就此自愈清除）
    if (prev && prev.cid && prev.sid === HOLD_SID && Date.now() - prev.ts > CALL_HOLD_MS) {
      notifyCallEnd(prev.cid, heldMissedHtml(prev.name || partnerName()), 'in', '未接听');
    }
    // FIX 2026-09-13 #406 挂起双写拆开：原 LS setItem 与 idbSet 同处一个 try——LS 配额满
    // QuotaExceededError 一抛整块中止、IDB 也不写＝后台只有通知没有挂起，回前台点开通知
    // 无弹窗也无未接消息（OPPO Reno14 Edge 实报 + 多机型同族；诊断「LS 写入失败」实锤）。
    // msgWritten＝来电系统消息「打来了语音通话」是否已写过（前台响铃已写传 true，
    // 后台触发未写传 false，重响补首发见 resumeProcessHold/incomingCall）
    const h = { ts: Date.now(), name: name, cid: cid || (window.__activeCid || 'default'), msg: !!msgWritten, sid: HOLD_SID };
    try { localStorage.setItem(CALL_HOLD_KEY, JSON.stringify(h)); } catch (e) {}
    if (window.idbSet) { try { window.idbSet(CALL_HOLD_KEY, h); } catch (e) {} }
    // #1291：仅当短窗内没刚通知过同一联系人的来电时才发系统通知（见上方 justNotified）
    if (!justNotified) bgCallNotify(name, '快回来接听，对方会等你几分钟', avOverride);
    // #1456：挂起期间每 30 秒重弹一次（回前台/接通/墓碑/超窗/达上限任一命中即停）
    startCallRepeat(name, cid, avOverride);
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
    // #1456：挂起被消费/超窗自愈＝这通来电已经不在了，停掉「30 秒重弹」
    // （否则回前台接听后通知栏还在催「快回来接听」）
    stopCallRepeat();
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
    // FIX 2026-09-18 #722：第二参 crossRun＝挂起并非本运行期写下（sid 对不上＝持久层
    //   幸存值/冷启动恢复）。同运行期的真挂起才保有「超时补写未接」语义，见 resumeProcessHold
    if (h) { clearCallHold(); resumeProcessHold(h, h.sid !== HOLD_SID); return; }
    if (window.idbGet) {
      holdBusy = true;
      window.idbGet(CALL_HOLD_KEY).then(function (ih) {
        holdBusy = false;
        if (!ih || !ih.ts) return;
        // FIX 2026-09-18 #722：能走到 IDB 兜底，说明 LS 墓碑/LS 本身已不在——此刻 IDB
        //   里还有带 ts 的挂起，只可能是 clearCallHold 那笔异步 IDB 墓碑被杀进程/刷新
        //   打断（vivo/Edge 杀渲染进程常态）或 iOS 清 LS 后被 idbRestore 回填的孤儿，
        //   不是正在等待重响的真挂起。旧实现拿来就当真挂起消费，超时兜底分支无条件
        //   补写「来电 · 未接听」＝接通的电话切后台回前台被记未接（多机型实报）。
        //   修复：IDB 兜底先卡 3 分钟新鲜度——超窗孤儿只重写墓碑自愈、绝不再补未接；
        //   窗内（iOS 清 LS 但确实 3 分钟内回来）仍重响，crossRun=true 保有 #161 冷启动重响
        if (Date.now() - ih.ts > CALL_HOLD_MS) { clearCallHold(); return; }
        clearCallHold();
        resumeProcessHold(ih, true);
      }).catch(function () { holdBusy = false; });
    }
  }
  function resumeProcessHold(h, crossRun) {
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
    // FIX 2026-09-18 #722：补写未接须同时满足——①挂起是本运行期写下的（crossRun=false；
    //   跨运行期孤儿见 resumeHeldCall 注释）②此刻没有活通话（刷新恢复/接通中的通话在场
    //   时补未接＝用户接了电话却被记未接的第二个保险闸）。不满足即静默丢弃，挂起已被
    //   调用方清为 {ts:0} 墓碑，幂等自愈
    if (!crossRun && !currentCall) notifyCallEnd(h.cid || cur, heldMissedHtml(h.name || partnerName()), 'in', '未接听');
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
  // FIX 2026-09-18 #757：隐藏/冻结/离页三处立刻冲刷通话标记（见 CALL_RESUME_WINDOW 注释）——
  //   页面被系统冻结或杀进程前最后能跑的时机就是这里，把 ts 停在此刻（同运行期此前的
  //   sessionStorage 快路径不受影响，这三行只让跨运行期的兜底副本更准、更晚过期）。
  //   注册在上方 visibilitychange 之后：响铃切后台那条路径先 endCall 清成 {ts:0} 墓碑，
  //   本回调再进来时 currentCall 已空、自然不写（不会把刚清掉的标记复活）。
  document.addEventListener('visibilitychange', function () {
    try { if (document.visibilityState === 'hidden') flushCallActive(); } catch (e) {}
  });
  window.addEventListener('pagehide', function () { try { flushCallActive(); } catch (e) {} });
  document.addEventListener('freeze', function () { try { flushCallActive(); } catch (e) {} });
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
    // 夜间免打扰：兜住所有直达来电入口（含跨桌面接听、响铃挂起恢复），时段内一律不响铃
    if (window.nightModeActive && window.nightModeActive()) return;
    // #651：预览中的弹窗立即让位给真实来电（不拆拦截层，接听/拒绝会点不到）
    closeCallPreview();
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
    // #651：预览中手动拨打——先拆预览弹层再进入真实去电
    closeCallPreview();
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
  // #830：轻点小框 → 打开通话半框（聊天页「更多功能→通话」的半屏面板）。
  //   小框此前只有「拖动」和右侧挂断键两条出路，点中间没反应；拖拽与点击在同一组
  //   pointer 事件里按 moved 分流（真实拖动过只存位置，不弹面板），按在挂断键上的
  //   那次抬起整个交回按钮自身，不重复触发。
  //   半框属聊天页 DOM，故先 enterChat 再 openChatCallPanel；通话归属桌面与当前桌面
  //   不同时先切桌面——半框标题/背景都按当前桌面读，不切就会把 A 的通话显示成 B（同 #811 串身份口径）。
  function openCallHalfFromMini() {
    if (!currentCall) return;
    const ownerCid = currentCall.cid || window.__activeCid || 'default';
    if (ownerCid !== (window.__activeCid || 'default')) {
      try { if (window.setActiveContact) window.setActiveContact(ownerCid); } catch (e) {}
    }
    if (!window.enterChat || !window.openChatCallPanel) {
      if (mask) mask.hidden = false; // 半框入口缺失时退回展开通话大面板，不让点击变成没反应
      return;
    }
    window.enterChat();
    window.openChatCallPanel();
  }
  if (mini) {
    let dragging = false, moved = false, pressOnHang = false, pressLX = 0, pressLY = 0, startLeft = 0, startTop = 0;
    // e.clientX/Y 属「可视视口」坐标系，getBoundingClientRect 属「布局视口」；
    // 转布局视口统一相减，避免 visualViewport 被浏览器条偏移时拖拽错位（同样兼容多机型）
    function vpX(e) { const vv = window.visualViewport; return e.clientX + ((vv && vv.offsetLeft) || 0); }
    function vpY(e) { const vv = window.visualViewport; return e.clientY + ((vv && vv.offsetTop) || 0); }
    // FIX 2026-09-22 #1036：平板内核把小框触摸抢判成页面滚动手势→拖拽中途 pointercancel，
    // 且 setPointerCapture 未包 try/catch（抛错会打断整个 pointerdown）——表现为「只能一下一下拖」。
    // 套用 #1012 已验证口径：拖拽存续期挂 document 级非被动 touchmove preventDefault，
    // pointermove/up/cancel 移到 document（capture 失败/手势被抢后 mini 收不到后续事件也能继续跟手）。
    const stopPan = (ev) => { if (dragging && ev.cancelable) ev.preventDefault(); };
    const stopPanOn = () => document.addEventListener('touchmove', stopPan, { passive: false });
    const stopPanOff = () => document.removeEventListener('touchmove', stopPan);
    mini.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#call-mini-hang')) { pressOnHang = true; return; } // 挂断按钮不触发拖动
      pressOnHang = false;
      dragging = true;
      moved = false;
      const r = mini.getBoundingClientRect();
      pressLX = vpX(e); pressLY = vpY(e);
      startLeft = r.left; startTop = r.top; // 按下瞬间小框左上角的屏幕（布局）位
      try { mini.setPointerCapture && mini.setPointerCapture(e.pointerId); } catch (err) {}
      stopPanOn();
      e.preventDefault();
    });
    document.addEventListener('pointermove', (e) => {
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
    }, { passive: false });
    const persistPos = () => {
      // 只有真实拖动过才保存（位置有效；left/top 已按元素自身坐标空间写出，
      // 重新加载 restore 路径照常读回，不会被误当作屏幕坐标）
      if (moved && mini.style.left && mini.style.top) {
        if (miniPos) { miniPos.left = mini.style.left; miniPos.top = mini.style.top; }
        else miniPos = { left: mini.style.left, top: mini.style.top };
        store.set('call-mini-pos', JSON.stringify(miniPos));
      }
    };
    document.addEventListener('pointerup', () => {
      if (!dragging) return;
      persistPos();
      // #830：没拖动过＝轻点（挂断键那一下由按钮自己的 click 处理）
      const tap = !moved && !pressOnHang;
      pressOnHang = false;
      dragging = false;
      stopPanOff();
      if (tap) openCallHalfFromMini();
    });
    document.addEventListener('pointercancel', () => {
      if (!dragging) return;
      // 手势被系统抢走（来电/通知栏等）也保住已拖出的位置，不丢半程
      persistPos();
      pressOnHang = false;
      dragging = false;
      stopPanOff();
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
      // 夜间免打扰（设置里开启后 22:00–7:00 生效）：联系人不再主动打电话
      if (window.nightModeActive && window.nightModeActive()) return;
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
  // v3.26.x #678：通话占用门——供 incoming-requests.js / 其它模块查询「此刻是否正占着电话」。
  //   用户报「明明一直通话中联系人还是会打电话过来」（OPPO Reno6 5G + 雨见，明说多机型）：
  //   跨桌面来电调度只看了 layerBusy() 的 #call-mask——通话最小化到悬浮小框时 call-mask 是
  //   hidden，且浮层让路上限（BUSY_ESCAPE 3 轮）到期后强制顶屏，于是通话中照样弹出「XX 来电了」；
  //   且切到别的桌面后，正在通话的那个联系人不再是激活桌面 → 连「正在跟你通话的人」都会再打一次。
  //   currentCall 为空时回退读 call-active 标记（刷新/后台重建期间通话尚未恢复，心跳 ts ≤20s
  //   刷新；10 分钟新鲜度窗口与 recoverCall 同口径）——只放行「确实没在通话」的场景。
  window.callInProgress = function () {
    if (currentCall) return true;
    try {
      const raw = sessionStorage.getItem(CALL_ACTIVE_KEY) || localStorage.getItem(CALL_ACTIVE_KEY);
      const info = raw ? JSON.parse(raw) : null;
      if (info && info.connectedTime && Date.now() - (info.ts || 0) <= 600000) return true;
    } catch (e) {}
    return false;
  };
  // v3.26.x：启动恢复——上次通话因刷新/崩溃中断（call-active 未被 endCall 清除）→ 补写「通话中断」记录
  //   必须在 mochi-restore-done 后执行：此时 records-call 已从 IDB 回填到 LS，unshift 写回不会覆盖。
  //   mochi-restore-done 一定在回填完成后派发（idb.js finish()），即使保险丝超时最终完成也会派发。
  // FIX 2026-09-17 #698：回读链扩成 sessionStorage → localStorage → IndexedDB（#406 call-hold 同口径）——
  //   saveCallActive 三路写入后，任何一路幸存就能续上；恢复处理拆到 recoverProcess（异步回读 IDB 后仍能走同一处理）
  function recoverCall() {
    let info = null;
    try { info = JSON.parse(sessionStorage.getItem(CALL_ACTIVE_KEY) || 'null'); } catch (e) { info = null; }
    if (info) { recoverProcess(info, 'ss'); return; }
    // v3.26.x：#120 sessionStorage 空 → 读 localStorage 兜底（关浏览器/PWA 重开场景）。
    //   同标签普通刷新 sessionStorage 仍在，优先读它以保持原行为。
    try { info = JSON.parse(localStorage.getItem(CALL_ACTIVE_KEY) || 'null'); } catch (e) { info = null; }
    if (info) { recoverProcess(info, 'ls'); return; }
    // #698：两路都空（写入端被配额/隐私模式整块吞掉）→ 回读 IDB 副本
    if (window.idbGet) {
      window.idbGet(CALL_ACTIVE_KEY).then(function (ih) {
        if (ih && ih.ts) recoverProcess(ih, 'idb');
      }).catch(function () {});
    }
  }
  function recoverProcess(info, src) {
    if (!info.connectedTime) { clearCallActive(); return; } // 未接通就中断（响铃/呼叫中刷新），不恢复不记
    const age = Date.now() - (info.ts || 0);
    // #698：IDB 副本永久留存，必须卡新鲜度（心跳每 20 秒刷 ts，10 分钟窗同 callInProgress/#120 口径），
    // 否则数天后重开会翻出早已结束的旧通话；LS 副本维持原 #120 行为不变
    // FIX 2026-09-18 #757：窗分档（见 CALL_RESUME_WINDOW 注释）——IDB 兜底副本仍卡 10 分钟
    // 静默窗（#705 幽灵复活防线：能走到 IDB 说明 SS/LS 都被系统清过，那里的「通话中」不可信）；
    // SS/LS 是本机同步写下的真实标记，用 6 小时墙钟窗（心跳在页面冻结时不跑，10 分钟心跳窗
    // 会把「锁屏/后台整场通话」误判成早已结束 ⇒ 用户报的「刷新后电话没了」）。
    const windowMs = src === 'idb' ? CALL_IDB_WINDOW : CALL_RESUME_WINDOW;
    if (age > windowMs) {
      clearCallActive();
      // #757：超窗的 SS/LS 快照＝这通电话从没写过结束记录（正常结束必留 {ts:0} 墓碑，早被
      //   上面 !connectedTime 分支拦掉），旧实现静默清掉正是「无挂断记录」的来源——改为按
      //   「关闭恢复」同一条链补写「通话中断」，让用户至少能看到这通电话结束在哪。
      //   IDB 孤儿维持静默（#705：异步墓碑丢失/iOS 清 LS 回填，补记录＝幽灵未接）。
      if (src !== 'idb') writeInterruptRecord(info);
      return;
    }
    const cid = info.cid || 'default';
    const dir = info.direction || 'out';
    const name = info.name || 'TA';
    // v3.26.x：开启「刷新后恢复通话」→ 重建通话 UI + 从接通时刻继续计时（TA 本地模拟，无需重连）
    if (callCfg().resume !== 0) {
      try {
        // #1394：hangupAt 跟着带回来（旧载荷没这字段→0→startCallDuration 按当下重算）
        currentCall = { cid: cid, direction: dir, status: 'connected', startTime: info.startTime || info.connectedTime, connectedTime: info.connectedTime, hangupAt: info.hangupAt || 0, durationSec: 0, name: name, av: info.av || '' };
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
      } catch (e) {
        // #757：恢复中途出错（机型内核差异导致某个渲染/计时调用抛错）——旧实现只 clearCallActive
        //   ＝通话无声消失且无记录；改为先把半截通话清干净（currentCall 已赋值的场景，否则
        //   callInProgress 恒真、后续联系人来电全被占用门拦死），再补一条中断记录。
        currentCall = null; shownAv = null; shownName = null;
        if (mini) mini.hidden = true;
        if (mask) mask.hidden = true;
        if (cdEl) cdEl.hidden = true;
        clearCallActive();
        writeInterruptRecord(info);
      }
      return;
    }
    // 关闭恢复 → 记中断记录
    clearCallActive();
    writeInterruptRecord(info);
  }
  // FIX 2026-09-18 #757：中断记录统一出口（原为「关闭恢复」分支内联代码）——三条路径共用：
  //   「关闭恢复」设置、超窗的 SS/LS 快照、恢复中途出错。语义不变：归属桌面写 records-call
  //   （ended='interrupt'）+ 聊天系统消息 + 主页通话卡重渲染。
  function writeInterruptRecord(info) {
    const cid = info.cid || 'default';
    const dir = info.direction || 'out';
    const name = info.name || 'TA';
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

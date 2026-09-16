// ===== 功能：全屏模式（v3.5.93） =====
// 安卓 Chrome PWA standalone 会保留系统状态栏（顶部时间/电量）——manifest 无法隐藏。
// 提供设置页「全屏模式」开关：开启后用 Fullscreen API 真正全屏（隐藏系统状态栏）。
// v3.6.x：iOS 无 Fullscreen API（Safari 仅视频支持），系统状态栏永远无法隐藏：
//   · 从主屏幕打开（standalone）：开关改为隐藏应用内模拟状态栏（唯一还能藏的一栏），
//     内容顶到系统状态栏下方、屏幕利用更满；状态持久化、切后台回来自动恢复。
//   · 浏览器内打开：开关不可用，弹说明引导「添加到主屏幕」（iOS 唯一真全屏途径）。
// v3.6.x：Via 等安卓浏览器「网页全屏」默认转横屏（视频式全屏），与本应用竖屏设计冲突。
//   处理分三档，保证任何情况下屏幕保持竖屏：
//   1) 无 Screen Orientation 锁 API（Via/阉割 WebView）→ 不碰原生全屏，直接走 CSS
//      兜底（fs-css-active 类），竖屏永不变；
//   2) 有锁 API（Chrome/Edge）→ 进原生全屏 + 锁竖屏 + 方向监视，全屏且竖屏；
//   3) 全屏被外力转横屏 → 先在全屏态内重试锁竖屏，仍失败则退出全屏；
//      退出后主动持续锁回竖屏（浏览器退出全屏后不一定自动回竖屏），
//      锁不回来就提示用户开启自动旋转 / 竖着拿手机 / 用浏览器自带全屏。
(function () {
  const uid = window.activePrefix();
  const store = {
    get(k){ try { return localStorage.getItem(window.activePrefix() + ':' + k); } catch(e){ return null; } },
    set(k, v){ try { localStorage.setItem(window.activePrefix() + ':' + k, v); } catch(e){} }
  };
  const FS_KEY = 'fullscreen-enabled';
  // v3.6.x：CSS 兜底全屏持久化 key——上次走兜底（浏览器转横屏）则恢复时不再请求原生全屏
  const FB_KEY = 'fullscreen-fallback';
  // v3.16.x：设备判定统一收口到 device.js（window.mochiDevice）——此前与
  // mobile-adapt.js 各算一遍（此处 isIOS 判定曾是它的复制）。现在统一读取，
  // 判定逻辑只维护 device.js 一处。
  let isIOS = false, isVia = false;
  try {
    const d = window.mochiDevice;
    if (d) { isIOS = !!d.isIOS; isVia = !!d.isVia; }
  } catch (e) {}
  // v3.26.x：iOS 全屏引导需分浏览器（Edge iOS 的「添加到主屏幕」只建快捷方式、
  // 打开仍是浏览器标签，而 Safari 那条才是无浏览器栏的独立应用）。device.js 只
  // 导出平台判定、不含浏览器名，这里单独读 UA
  const _ua = String((navigator && navigator.userAgent) || '');
  const isEdgeIOS = isIOS && /edg/i.test(_ua);
  const isSafariIOS = isIOS && /safari/i.test(_ua) && !/edg|chrome|opt|fxios|via|quark|micromessenger/i.test(_ua);
  const inIosStandalone = isIOS && (
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
  // v3.7.x：标记 iOS PWA standalone 供 CSS 适配——standalone + black-translucent 下
  // 100dvh 不包含系统状态栏，.phone 底部留白、底部 tabbar/输入栏上移点不到
  //（base.css 用 100vh 覆盖占满全屏）
  if (inIosStandalone) document.documentElement.classList.add('ios-pwa-standalone');
  // v3.6.x：Via 浏览器——网页全屏必转横屏且方向锁被 WebView 禁用（实测 lock 无效、
  // 退出后也不自动回竖屏），原生全屏正是横屏源头，直接走 CSS 兜底；真全屏引导
  // 用 Via 自带全屏模式（竖屏沉浸）。判定已收口 device.js（mochiDevice.isVia）

  function fsSupported() {
    // v3.6.x：webkit 前缀也判为支持（老版安卓 WebView/Chromium 只有 webkitRequestFullscreen）
    return typeof document.documentElement.requestFullscreen === 'function'
        || typeof document.documentElement.webkitRequestFullscreen === 'function';
  }
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  // v3.26.x：横屏判定不能只看视口宽高。手机开「桌面版网站」模式后 layout viewport
  // 被拉成 980×≈500（横宽竖窄），竖着拿也满足 innerWidth>innerHeight，于是全屏开关
  // 被「已是横屏」分支拦下、永远进不去全屏。物理屏幕方向才反映真实持握且不受视口
  // 伪装影响：系统明确 portrait 即「伪装横屏」，不算横屏。真转横屏（Via/视频式全屏）
  // 时系统方向同步变 landscape，原有横屏兜底路径不受影响。
  function viewportLandscape() {
    if (!(window.innerWidth > window.innerHeight)) return false;
    try {
      const t = screen.orientation && screen.orientation.type;
      if (typeof t === 'string' && t) {
        if (/^portrait/i.test(t)) return false;
        if (/^landscape/i.test(t)) return true;
      }
    } catch (e) {}
    try {
      const o = window.orientation;
      if (typeof o === 'number' && !isNaN(o) && Math.abs(o) % 180 === 0) return false;
    } catch (e) {}
    return true;
  }
  // v3.6.x：开关的「视觉激活」判定——原生全屏 / CSS 兜底全屏 / iOS 兜底 /
  // display-mode 全屏（display_override fullscreen 直启）任一成立即视为开启。
  // 修复：Via 等浏览器走 CSS 兜底后开关被 fullscreenchange 误关（syncToggle 只看
  // isFullscreen()，兜底时已退出原生全屏 → 开关显示关闭但兜底实际生效，状态对不上）
  function fsVisualActive() {
    const d = document.documentElement;
    return isFullscreen()
      || d.classList.contains('fs-css-active')
      || d.classList.contains('ios-fs-active')
      || !!(window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches);
  }
  // v3.6.x：是否有 Screen Orientation API 可锁方向——无 lock 的老/阉割 WebView
  // 网页全屏必转横屏且锁不回来，应直接走 CSS 兜底，绝不碰原生全屏
  function orientLockable() {
    return !!(screen.orientation && typeof screen.orientation.lock === 'function');
  }
  function lockFsOrient() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        const p = screen.orientation.lock('portrait');
        if (p && p.catch) p.catch(() => {});
        return true;
      }
    } catch (e) {}
    return false;
  }
  function unlockFsOrient() {
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (e) {}
  }
  // v3.6.x：CSS 兜底全屏——进入/恢复时同步复选框（syncBox 默认 true）；
  //   仅在「重试原生全屏前清理旧兜底」场景传 false（此时开关仍保持用户勾选态）
  function applyFsCss(on, syncBox) {
    document.documentElement.classList.toggle('fs-css-active', on);
    store.set(FB_KEY, on ? '1' : '0');
    if (syncBox === false) return;
    const el = document.getElementById('sf-fullscreen');
    if (el) el.checked = on;
  }
  let _fsTipShown = false;
  function showFsFallbackTip() {
    if (_fsTipShown) return;
    _fsTipShown = true;
    const msg = isVia
      ? 'Via 浏览器的网页全屏会自动转成横屏，本应用已自动保持竖屏，不再横屏。\n\n想真全屏（隐藏浏览器栏）：Via 菜单 → 设置 → 通用 → 开启「全屏模式」，返回即竖屏沉浸全屏。'
      : '当前浏览器的网页全屏会自动转成横屏，本应用已自动保持竖屏，不再横屏。\n\n想真全屏（隐藏浏览器栏）请：\n· 浏览器工具栏开启「竖屏锁定」后再开全屏；\n· 或「添加到主屏幕」从桌面图标打开（竖屏全屏）。';
    if (window.openModal) {
      window.openModal('竖屏全屏提示', '', () => {}, { noInput: true, staticText: msg });
    } else {
      try { new Notification('竖屏全屏提示', { body: msg }); } catch (e) {}
    }
  }
  let _fsFailTipShown = false;
  function showFsFailTip() {
    if (_fsFailTipShown) return;
    _fsFailTipShown = true;
    const msg = '当前浏览器未允许进入全屏，已自动关闭该开关。\n\n可重试一次；或使用 Chrome/Edge 并允许全屏权限，或添加到主屏幕后从桌面图标打开。';
    if (window.openModal) {
      window.openModal('无法进入全屏', '', () => {}, { noInput: true, staticText: msg });
    } else {
      try { new Notification('无法进入全屏', { body: msg }); } catch (e) {}
    }
  }
  let _rotTipShown = false;
  function showRotateTip() {
    if (_rotTipShown) return;
    _rotTipShown = true;
    const msg = '屏幕当前仍是横屏，本应用已尝试自动恢复竖屏。\n\n若未恢复：\n· 打开手机下拉栏的「自动旋转」，竖着拿手机即可转回；\n· 或直接使用浏览器自带的全屏模式（Via 设置 → 通用 → 全屏模式）。';
    if (window.openModal) {
      window.openModal('请恢复竖屏', '', () => {}, { noInput: true, staticText: msg });
    } else {
      try { new Notification('请恢复竖屏', { body: msg }); } catch (e) {}
    }
  }
  // v3.6.x：已安装应用以 display_override fullscreen 直启（系统级全屏）时，
  // JS 无法用 API 退出系统全屏——开关关闭后说明现状，避免「关了没反应」的困惑
  function showSystemFsNote() {
    const msg = '全屏模式已关闭，下次启动不会自动进入全屏。\n\n当前应用是以「全屏显示」方式从主屏幕打开的（系统级全屏），浏览器的地址栏/工具栏由系统控制，需退出应用或从主屏幕重新打开后才会显示。';
    if (window.openModal) {
      window.openModal('全屏模式已关闭', '', () => {}, { noInput: true, staticText: msg });
    } else {
      try { new Notification('全屏模式已关闭', { body: msg }); } catch (e) {}
    }
  }
  // v3.6.x：把方向锁回竖屏。浏览器退出全屏后不一定自动回竖屏
  //（自动旋转关闭时系统方向会卡在横屏）——退出后主动持续 lock 竖屏多次，
  // 全部无效再提示用户手动处理。
  function forcePortrait(tries, cb) {
    if (window.innerWidth <= window.innerHeight) { if (cb) cb(); return; } // 已竖屏
    lockFsOrient();
    if (tries > 0) setTimeout(() => forcePortrait(tries - 1, cb), 400);
    else if (cb) cb();
  }
  // v3.6.x：全屏期间持续监视方向——「进入全屏→浏览器转横屏→锁屏失败」的时序
  // 在部分浏览器长达数秒，单次 setTimeout 复核容易错过；每 300ms 查一次，
  // 发现横屏立即处理，最长监视约 4s 后自动停止（此时竖屏已稳定）。
  // 由 fullscreenchange 驱动启停（见下方监听），避开「全屏过渡未完成」的时序窗口。
  let _fsMonTimer = null;
  function stopFsMonitor() {
    if (_fsMonTimer) { clearInterval(_fsMonTimer); _fsMonTimer = null; }
  }
  // FIX 2026-09-05 #189：iOS（含 iPad）一律不启动方向监视——Safari 根本没有
  // orientation.lock（WebKit 明确不支持，全屏态调用也只返回错误，见 WebKit Bugzilla
  // #257695），监视器每 300ms 查到「横屏」后 lock 必然失败 → handleLandscapeForced
  // 把刚进的全屏自动杀掉：iPad 横屏持握点开【全屏模式】约 2 秒后被退出 + 误报
  // 「网页全屏会自动转成横屏」弹窗，开关态错乱——即报修的「iPad 全屏模式没有生效」。
  // 横屏持握 iPad 是完全合法的姿势，不是安卓那种「全屏被强制转横」故障。
  function startFsMonitorSafe() { if (isIOS) return; startFsMonitor(); }
  function startFsMonitor() {
    stopFsMonitor();
    let left = 4000;
    const tick = () => {
      left -= 300;
      // 已退出全屏（用户手动/系统）→ 停止监视
      if (!isFullscreen() && !document.documentElement.classList.contains('fs-active')) { stopFsMonitor(); return; }
      if (viewportLandscape()) { onLandscapeDetected(); return; }
      if (left <= 0) stopFsMonitor();
    };
    _fsMonTimer = setInterval(tick, 300);
    setTimeout(tick, 250);
  }
  // 检测到横屏：先在全屏态内重试锁竖屏（全屏态 lock 成功率最高，
  // 避免「一横屏就退出全屏，退出时机过早」），多次无效才退出全屏
  let _landscapeBusy = false;
  function onLandscapeDetected() {
    if (_landscapeBusy) return;
    _landscapeBusy = true;
    let tries = 0;
    const attempt = () => {
      if (window.innerWidth <= window.innerHeight) { _landscapeBusy = false; return; } // 转回来了
      if (!isFullscreen()) { _landscapeBusy = false; handleLandscapeForced(); return; }
      lockFsOrient();
      if (++tries < 4) setTimeout(attempt, 400);
      else { _landscapeBusy = false; handleLandscapeForced(); }
    };
    attempt();
  }
  // 被强制转横屏：退出原生全屏 → CSS 兜底保持竖屏布局 → 提示 →
  // 退出后主动锁回竖屏，锁不回来提示用户手动处理
  function handleLandscapeForced() {
    stopFsMonitor();
    exitFs();
    applyFsCss(true);
    showFsFallbackTip();
    forcePortrait(5, showRotateTip);
  }
  function enterFs() {
    try {
      const el = document.documentElement;
      let p;
      // v3.26.x #212：挖孔屏「全屏不盖满」——安卓 Chrome 默认 navigationUI:'auto'
      // 时不把全屏面铺到挖孔/摄像头区，页面外系统层 letterbox 顶端露一条空白
      //（页面内任何测量都全 ✓ 无法诊断：iQOO12+Chrome 诊断全绿仍报「聊天全屏
      // 顶端留白」，用户明说多机型都有）。Chromium issue 40723205 官方 workaround
      // 即 navigationUI:'hide'；iOS 路径（iosTryNativeFs）早已同款参数，此处仅补
      // 安卓路径。不认选项参数的老内核会忽略它，webkitRequestFullscreen 前缀
      // API 本就不收参数，行为均不变。
      const fsOpts = { navigationUI: 'hide' };
      if (el.requestFullscreen) p = el.requestFullscreen(fsOpts);
      else if (el.webkitRequestFullscreen) p = el.webkitRequestFullscreen();
      // 进入后锁竖屏（需全屏态，此时已满足）并启动方向监视（iOS 经 Safe 入口跳过）；
      // 无论锁屏 API 是否报成功，监视器都会复核视口方向
      const tryLock = () => { lockFsOrient(); startFsMonitorSafe(); };
      if (p && p.then) { p.then(tryLock, tryLock); return p; }
      setTimeout(tryLock, 300);
    } catch (e) {}
    return null;
  }
  function exitFs() {
    try {
      unlockFsOrient();
      stopFsMonitor();
      // 安卓切后台/换页瞬间文档可能已非全屏态，exitFullscreen 的 promise 会 reject，需兜住避免误报错误
      if (document.exitFullscreen) {
        const p = document.exitFullscreen();
        if (p && p.catch) p.catch(() => {});
      }
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) {}
  }
  // 启动时若用户开过全屏且处于 PWA 环境，尝试恢复（需用户手势才能生效时静默跳过）
  // v3.5.113：userIntent=true 时是用户主动切换（写入存储）；
  //   系统级退出（切后台/手势 Esc）只同步 UI 显示，不覆盖用户「开全屏」的持久化意图
  let _sysToggle = false;
  // v3.6.x：用户本会话主动关闭全屏的意图标记——display_override fullscreen
  // 安装态下 display-mode 媒体查询恒为真，若系统全屏变化据此同步开关，会把
  // 用户已关闭的状态又弹回开启（关了又弹回死循环）；原生全屏仍实时反映
  let _userFsOff = false;
  function syncToggle(userIntent) {
    const el = document.getElementById('sf-fullscreen');
    if (el) {
      if (!userIntent) _sysToggle = true;
      // v3.6.x：用户主动关闭后，系统全屏变化不再把开关弹回开启（仅原生全屏
      // 仍按实际状态显示）；未主动关闭时维持原行为（反映视觉激活态）
      el.checked = (_userFsOff && !isFullscreen()) ? false : fsVisualActive();
    }
    if (!userIntent) setTimeout(() => { _sysToggle = false; }, 0);
  }
  // v3.5.109：Chrome 安卓全屏模式下输入框聚焦会错误弹出浏览器「密码/安全提示」条（位置错乱）。
  // 全屏激活时统一给输入框禁用自动填充/自动校正/自动大写，退出全屏后恢复原属性。
  function applyFsInputHacks() {
    const fs = isFullscreen();
    document.querySelectorAll('input, textarea').forEach(inp => {
      if (inp.type === 'checkbox' || inp.type === 'range' || inp.type === 'file' || inp.type === 'color') return;
      if (fs) {
        if (!inp.dataset.fsAuto) {
          // v3.5.126：全屏时统一 autocomplete="off"（不删属性——之前 removeAttribute
          // 让输入框变裸文本框被 Chrome 识别成可自动填充字段，弹「管理密码」条）。
          // 与 mobile-adapt.js 聚焦策略一致：off 保留，只清 password 语义值。
          // v3.5.123：进入时把 autocorrect/autocapitalize/spellcheck 的模板原值存进 dataset，
          // 退出时还原（不能直接删除——会销毁模板静态声明的防自动填充属性）
          inp.dataset.fsAuto = '1';
          inp.dataset.fsTplAc = inp.getAttribute('autocomplete') || '';
          const ac = inp.getAttribute('autocomplete');
          if (ac === 'new-password' || ac === 'current-password') inp.removeAttribute('autocomplete');
          inp.setAttribute('autocomplete', 'off');
          inp.dataset.fsOrigCorr = inp.getAttribute('autocorrect') || '';
          inp.dataset.fsOrigCap = inp.getAttribute('autocapitalize') || '';
          inp.dataset.fsOrigSpell = inp.getAttribute('spellcheck') || '';
          inp.setAttribute('autocorrect', 'off');
          inp.setAttribute('autocapitalize', 'off');
          inp.setAttribute('spellcheck', 'false');
        }
      } else if (inp.dataset.fsAuto !== undefined) {
        // v3.5.126：退出时还原模板 autocomplete（模板声明 off 则还原 off）
        const tplAc = inp.dataset.fsTplAc;
        if (tplAc) inp.setAttribute('autocomplete', tplAc); else inp.removeAttribute('autocomplete');
        delete inp.dataset.fsTplAc;
        // 还原模板原值（空值 = 删除属性）
        const restore = (key, origKey) => {
          const orig = inp.dataset[origKey] || '';
          if (orig) inp.setAttribute(key, orig); else inp.removeAttribute(key);
          delete inp.dataset[origKey];
        };
        restore('autocorrect', 'fsOrigCorr');
        restore('autocapitalize', 'fsOrigCap');
        restore('spellcheck', 'fsOrigSpell');
        delete inp.dataset.fsAuto;
      }
    });
  }
  // v3.6.x：iOS 全屏说明弹窗——用应用内 openModal（原 Notification 在无权限时直接
  // 抛异常且不检查，用户点了开关毫无反馈，看起来像「不能用」）
  // v3.26.x：按现状三态出文案。旧文案的「点底部分享→添加到主屏幕」在 Edge iOS 里
  // 根本不存在（Edge 用右上 ⋯ 菜单，且它建的只是快捷方式，打开仍是浏览器标签），
  // 用户照做也拿不到全屏——现在明确指向 Safari 那条真独立应用路径。
  function showIosGuide() {
    let msg;
    if (isFullscreen()) {
      msg = '已进入全屏模式，浏览器工具栏已隐藏。\n\niOS 顶部系统状态栏（时间/电量）由系统控制，任何网页都无法隐藏，这是所有 iPhone 网页的共同限制。';
    } else if (inIosStandalone) {
      msg = '已进入全屏模式。iOS 的系统状态栏（时间/电量）由系统控制，任何网页都无法隐藏，这是所有 iPhone 应用的共同限制。\n\n应用内的模拟状态栏（Mochi/时间/电量）已下移到系统状态栏正下方、两栏不重叠，内容顶满屏幕、屏幕利用更满。';
    } else {
      msg = '当前浏览器未允许本页进入全屏，开关已回滚。\n\niPhone 上想真正隐藏浏览器栏，只有：\n· 【推荐】改用 Safari 打开本站 → 底部「分享」→「添加到主屏幕」→ 点桌面图标打开，即无浏览器栏的独立应用；'
        + (isEdgeIOS ? '\n· Edge 菜单「添加到主屏幕」只会创建快捷方式，打开后仍是带工具栏的网页（就是现在的状态），这条路拿不到全屏。' : '')
        + '\n\n另外：iOS 顶部系统状态栏（时间/电量）永远无法由网页隐藏。';
    }
    if (window.openModal) {
      window.openModal('iOS 全屏说明', '', () => {}, { noInput: true, staticText: msg });
    } else {
      try { new Notification('iOS 全屏说明', { body: msg }); } catch (e) {}
    }
  }
  // v3.26.x：iOS 真全屏——旧实现在 isIOS 分支直接拒绝调用 Fullscreen API（注释写的
  // 「iOS 无 Fullscreen API」在 2026 年的 iOS 上已不成立：Safari/Edge 对 documentElement
  // 已开放），导致浏览器态下开关结构性无效。现改为在用户手势内真试一次：
  //   · 成功 → 走既有 .fs-active（真全屏，浏览器栏消失）
  //   · reject / 1.5s 复核未进全屏 → 回滚开关 + 分浏览器说明
  //   · standalone 且此前已应用「隐藏模拟状态栏」→ 不回滚（那部分效果仍然有效）
  // 不做方向锁（iOS 无该 API），也不走安卓的 CSS 伪全屏兜底。
  let _iosFsSettled = false;
  function iosFsFailed() {
    if (_iosFsSettled) return;
    _iosFsSettled = true;
    if (isFullscreen()) return;
    const t = document.getElementById('sf-fullscreen');
    if (inIosStandalone) { if (t) t.checked = true; showIosGuide(); return; }
    if (t) t.checked = false;
    showIosGuide();
  }
  function iosTryNativeFs() {
    _iosFsSettled = false;
    let p = null;
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) p = el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) p = el.webkitRequestFullscreen();
    } catch (e) {}
    if (p && p.catch) p.catch(() => { iosFsFailed(); });
    syncFsClass();
    // 复核窗口沿用安卓同款 1500ms（低端机/重载页面上 requestFullscreen 完成可能慢于
    // 一个宏任务，过早回滚会把用户意图覆盖成关闭）
    setTimeout(() => {
      if (isFullscreen()) { _iosFsSettled = true; applyFsInputHacks(); return; }
      iosFsFailed();
    }, 1500);
  }
  // v3.6.x：iOS standalone「全屏模式」= 隐藏应用内模拟状态栏（系统状态栏不可隐藏，
  // 交给 base.css 的 .ios-fs-active 规则处理安全区）；与 Fullscreen API 互斥
  function applyIosFs(on) {
    document.documentElement.classList.toggle('ios-fs-active', on);
    store.set(FS_KEY, on ? '1' : '0');
    const el = document.getElementById('sf-fullscreen');
    if (el) el.checked = on;
  }
  // v3.6.x：iOS 上改开关文案，明示平台限制，避免「点了没反应 / 不是真全屏」的困惑
  // v3.26.x：开关行加了「功能说明」标签，外层多包了一层 flex span——改选内层文本
  // span（row.querySelector('span span')），避免 textContent 覆盖把标签一起清掉
  function relabelIosToggle() {
    const el = document.getElementById('sf-fullscreen');
    if (!el) return;
    const row = el.closest('.gs-row');
    if (!row) return;
    const span = row.querySelector('span span') || row.querySelector('span');
    if (!span) return;
    span.textContent = inIosStandalone
      ? '全屏模式（内容顶满，系统状态栏不可隐藏）'
      : // v3.26.x：浏览器标签态现在真的去请求原生全屏（不再一律拒绝），文案照实描述；
        // 个别 iOS 浏览器（iOS <16.4 的 Safari）不放开该 API，失败时会弹说明并回滚开关
        '全屏模式（iOS 浏览器全屏，不支持时会弹说明）';
  }
  const fsToggle = document.getElementById('sf-fullscreen');
  if (fsToggle) {
    fsToggle.addEventListener('change', () => {
      if (fsToggle.checked) {
        _userFsOff = false;
        // v3.6.x：iOS 分支优先——standalone 走隐藏模拟状态栏，浏览器内引导安装
        // v3.26.x：不再「iOS 一律不试原生全屏」。Edge/Safari iOS 已对 documentElement
        // 开放 Fullscreen API，浏览器态点开关就该真去申请全屏（旧代码直接拒绝，开关
        // 结构性无效）。注意本分支必须留在 isVia / !orientLockable() 的安卓横屏兜底
        // 之前 return——iOS 没有方向锁 API，落到那些分支会被误判成伪全屏。
        if (isIOS) {
          if (inIosStandalone) applyIosFs(true);
          if (fsSupported()) iosTryNativeFs();
          else { if (!inIosStandalone) fsToggle.checked = false; showIosGuide(); }
          return;
        }
        // v3.6.x：点开关时视口已是横屏（多为上次全屏遗留的方向）——先自动尝试
        // 恢复竖屏，恢复失败再提示，本次不进入全屏
        // v3.26.x：改判物理方向——桌面版网站模式的 980×≈500 伪装横宽视口会把
        // 这条误触发成「永远开不了全屏」
        if (viewportLandscape()) {
          forcePortrait(4, showRotateTip);
          return;
        }
        // v3.6.x：Via 浏览器（UA 特征）——网页全屏必转横屏且方向锁被 WebView
        // 禁用（实测 lock 无效、退出后也不自动回竖屏），原生全屏正是横屏源头，
        // 直接走 CSS 兜底，保证任何情况下都不横屏；真全屏引导用 Via 自带全屏
        if (isVia) {
          applyFsCss(true);
          showFsFallbackTip();
          return;
        }
        if (!fsSupported()) {
          // 非 iOS 且不支持全屏 API（老 WebView）：无法全屏，回滚并提示
          fsToggle.checked = false;
          try { new Notification('当前浏览器不支持全屏', { body: '请使用 Chrome/Edge 浏览器，或添加到主屏幕后从桌面图标打开' }); } catch (e) {}
          return;
        }
        // v3.6.x：无方向锁 API 的老/阉割 WebView——网页全屏必转横屏且锁不回来，
        // 原生全屏正是横屏源头，直接走 CSS 兜底，保证任何情况下都不横屏
        if (!orientLockable()) {
          applyFsCss(true);
          showFsFallbackTip();
          return;
        }
        // 重新尝试原生全屏前清掉上次的 CSS 兜底（enterFs 内部按需回退）
        // 不重置复选框——开关此刻是用户刚勾上的状态
        applyFsCss(false, false);
        enterFs();
        syncFsClass();
        // v3.6.x：进入全屏后复核两点：
        //   a) lock 是否真正生效（部分 WebView 的 lock 是空壳，全屏仍横屏）——
        //      无效则记录「此浏览器全屏必横屏」（下次直接走兜底）并回退；
        //   b) 原生全屏是否被浏览器拦截（无手势/权限）——既未进全屏也未走
        //      兜底则回滚开关（避免「已开全屏却无效果」）。横屏回退（方向监视器
        //      检测到横屏后应用 fs-css-active）先生效时 fsVisualActive() 已为
        //      true，本回调不会误回滚。
        // v3.11.x：复核窗口 900→1500ms——低端机/重载页面上 requestFullscreen
        // 完成可能超过 900ms，过早回滚会把开关改回关闭并经 MutationObserver
        // 持久化 FS_KEY='0'（用户意图被覆盖，下次进入不再自动恢复）。
        setTimeout(() => {
          // FIX 2026-09-05 #189：iOS 跳过「全屏+横屏=被强制转横」杀全屏分支——
          // iPad 横屏持握点开关，requestFullscreen 成功后这里 viewportLandscape()=true
          // → handleLandscapeForced 立即退出全屏 + FB_KEY=1 永久兜底 + 误报弹窗，
          // 全屏开一次被杀一次（iPad 无方向锁，横屏持握是合法姿势非故障）
          if (!isIOS && isFullscreen() && viewportLandscape()) {
            store.set(FB_KEY, '1');
            handleLandscapeForced();
            return;
          }
          const t = document.getElementById('sf-fullscreen');
          if (t && t.checked && !fsVisualActive()) {
            t.checked = false;
            showFsFailTip();
          }
        }, 1500);
      } else {
        if (isIOS && inIosStandalone) { applyIosFs(false); return; }
        // v3.6.x：修复 OPPO Edge 等安卓浏览器「全屏无法关闭」——旧逻辑先判
        // display-mode: fullscreen 再决定是否允许关闭，而这些浏览器在 Fullscreen
        // API 激活期间也会匹配该媒体查询（反映当前全屏态而非安装态），导致关闭
        // 分支永远命中、开关弹回开启、全屏无法退出。改为先无条件退出（原生全屏
        // + CSS 兜底一起清）并持久化关闭；若退出后仍处于系统级全屏（安装态
        // display_override fullscreen，JS 无法退出）再给说明提示。
        _userFsOff = true;
        applyFsCss(false);
        exitFs();
        syncFsClass();
        store.set(FS_KEY, '0');
        // 已安装应用以 display_override fullscreen 直启时系统全屏无法用 API 退出——
        // 300ms 后复核：开关已关但仍在系统全屏 → 提示现状（避免「关了没反应」）
        setTimeout(() => {
          if (!_userFsOff) return;
          const t = document.getElementById('sf-fullscreen');
          const stillSysFs = window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches;
          if (t && !t.checked && stillSysFs) showSystemFsNote();
        }, 300);
      }
    });
    try { relabelIosToggle(); } catch (e) {}
  }
  // v3.26.x：设置页「功能说明」标签——点击弹 iOS 全屏限制说明（复用 showIosGuide 的三态文案）
  const fsHelp = document.getElementById('sf-fullscreen-help');
  if (fsHelp) {
    const openFsHelp = function (e) {
      if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (er) {} }
      showIosGuide();
    };
    fsHelp.addEventListener('click', openFsHelp);
    fsHelp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') openFsHelp(e);
    });
  }
  // 退出全屏（Esc 键/手势/切后台系统退出）时同步开关状态 + 输入框属性还原
  // v3.5.113：传 false——系统级变化不覆盖用户意图（否则切后台后开关被置灰，永远不再自动恢复）
  // v3.5.11x：Fullscreen API 激活时给根元素加 fs-active 类（挖孔屏顶部安全区适配）
  function syncFsClass() {
    const d = document.documentElement;
    const _fs = isFullscreen();
    d.classList.toggle('fs-active', _fs);
    // v3.26.x：iOS 浏览器原生全屏标记——iOS 系统状态栏（含灵动岛）永远由系统占据在
    // 内容上方、网页内容不会钻进状态栏区，CSS 无需再给顶部栏加安全区上边距。
    // 叠加 .fs-active 之上把 chat-head 等收紧贴顶（.fs-active 的
    // max(env(safe-area-inset-top),12px) 在 iOS 原生全屏会算出一条多余白带，
    // 用户实测「聊天顶部栏上面一大块空白」，见 base.css 对应规则）
    if (isIOS) d.classList.toggle('ios-native-fs', _fs);
  }
  // v3.7.x：当前是否为 PWA 安装态（standalone / display_override fullscreen 直启）——
  // 安装态切后台退出全屏是系统行为，需自动恢复；浏览器标签态用户退出全屏是主动操作，
  // 必须尊重（否则退出后被强制重入，Chrome 的「退出全屏」提示条反复弹出，无法正常使用）
  function fsInPwa() {
    try {
      return !!(window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
    } catch (e) { return false; }
  }
  // v3.8.x：切后台标记——系统切后台（Android 自动退出 Fullscreen API）时，
  // visibilitychange(hidden) 先于 fullscreenchange 触发。用此标记区分
  // 「系统退出」（保留用户全屏意图）与「用户主动退出」（Esc/下滑提示条，
  // 浏览器标签模式应尊重并清标记，避免反复重入弹条）。
  let _wentBg = false;
  // v3.11.x：最近一次转前台时刻——部分机型（小米 Chrome 实测反馈）切后台时
  // fullscreenchange(exit) 早于 visibilitychange(hidden)，或退出事件被推迟到
  // 回前台后才补发：两种时序下旧逻辑都会把「系统退出」误判成「用户主动退出」
  // 而清掉持久化意图 → 每次进入应用全屏都失效，必须手动关开开关。记录回前台
  // 时间供 handleFsExit 判定窗口使用。初值取模块加载时刻（加载后立刻补发的
  // 系统退出同样按系统行为处理）。
  let _lastVisibleAt = Date.now();
  function handleFsExit() {
    stopFsMonitor();
    const d = document.documentElement;
    // 浏览器标签模式下，用户通过系统 UI（下滑/提示条/Esc）退出全屏 = 主动放弃全屏：
    // 清掉持久化标记，切后台回来 / 重新聚焦不再强制重入（原设计「不覆盖用户意图」
    // 只适用于 PWA 安装态，浏览器标签态会造成全屏退出后又被拉回的死循环）。
    // v3.8.x：切后台导致的系统退出（_wentBg）不属于主动放弃——保留标记，
    // 切回后由 reenterFs 恢复。
    // v3.11.x：清除决策延迟 700ms 复核，修复事件时序竞态——
    //   · 复核时已转后台 / 窗口期内发生过 hidden → 系统切后台退出，保留意图；
    //   · fs-css-active 在（横屏兜底流程自己设置的）→ 本应用的主动兜底，不动；
    //   · 刚转前台 1.5s 内到达的 exit → 后台期间发生、回前台补发的系统退出，
    //     保留意图并立即尝试恢复（此时多半无手势，armRetry 会等首次触摸）；
    //   · 其余（持续可见且非刚回前台）→ 用户主动下滑/Esc 退出，尊重并清除。
    //   原实现同步判定，以上任一时序都会误清 FS_KEY，下次进入永不自动恢复。
    if (!fsInPwa()) {
      setTimeout(() => {
        if (document.visibilityState !== 'visible') return;            // 已在后台 → 系统行为
        if (_wentBg) return;                                           // 复核窗口内切过后台
        try { if (d.classList.contains('fs-css-active')) return; } catch (e) {} // 横屏兜底自有状态
        if (_lastVisibleAt && Date.now() - _lastVisibleAt < 1500) { reenterFs(); return; } // 回前台补发的系统退出
        try { store.set(FS_KEY, '0'); } catch (e) {}
        try { store.set(FB_KEY, '0'); } catch (e) {}
        try { d.classList.remove('fs-css-active'); } catch (e) {}
      }, 700);
    }
  }
  // 全屏态变化时同步开关 + 输入框属性 + fs-active 类；
  // v3.6.x：进入全屏即启动方向监视（cover 掉「enterFs 时全屏过渡未完成、锁屏请求
  // 过早被拒」的时序窗口），退出全屏停止监视
  document.addEventListener('fullscreenchange', () => {
    syncToggle(false); applyFsInputHacks(); syncFsClass();
    if (isFullscreen()) startFsMonitorSafe(); else handleFsExit();
  });
  document.addEventListener('webkitfullscreenchange', () => {
    syncToggle(false); applyFsInputHacks(); syncFsClass();
    if (isFullscreen()) startFsMonitorSafe(); else handleFsExit();
  });
  // v3.6.x：全屏/兜底激活期间系统方向被外力改横（手机横放/自动旋转）→ 锁回竖屏
  // FIX 2026-09-05 #189：iOS（含 iPad）整段跳过——Safari 无方向锁 API，锁不回竖屏；
  // 全屏态转横=误杀全屏（同 startFsMonitorSafe），非全屏态转横=弹「请恢复竖屏」
  // 误导弹窗。iOS 用户横屏持握是合法姿势，布局由 CSS 自适应，无需 JS 纠偏。
  document.addEventListener('orientationchange', () => {
    if (isIOS) return; // FIX 2026-09-05 #189（iOS 无方向锁，转横不纠偏不弹窗）
    const d = document.documentElement;
    if (!d.classList.contains('fs-active') && !d.classList.contains('fs-css-active')) return;
    if (window.innerWidth <= window.innerHeight) return;
    if (isFullscreen()) onLandscapeDetected();
    else forcePortrait(5, showRotateTip);
  });
  syncFsClass();
  // v3.6.x：启动时同步开关——display_override fullscreen 直启（无 Fullscreen API 调用、
  // 不触发 fullscreenchange）时开关也应显示开启；此处在 MutationObserver 注册前执行，
  // 不会误写持久化状态。
  try { syncToggle(false); } catch (e) {}
  // v3.5.126：聚焦兜底已移除——autocomplete="off"/"new-password" 会被 Chrome
  //   当密码字段处理（new-password 更甚），反而弹「保存密码/管理密码」条。
  //   密码/自动填充提示的压制统一交给 mobile-adapt.js 的 readonly 起手方案
  //   （readonly 破坏 Chrome 表单签名解析，触摸时解除，公认对 Chrome 最有效）。
  // 页面加载后若已在全屏（PWA 恢复/重新挂载场景），立即应用输入框 hacks
  try { applyFsInputHacks(); } catch (e) {}
  // v3.5.113：自动恢复全屏（启动时 / 切后台回来时）——用户开过全屏就尽量恢复
  // v3.5.122：修监听器泄漏——isFullscreen 时也移除监听、retry 前复查用户意图、
  //   只响应真实触摸（isTrusted，防 tabs.js 合成 click 拒接电话时误进全屏）
  let _retryArmed = false;
  function disarmRetry() {
    if (!_retryArmed) return;
    _retryArmed = false;
    document.removeEventListener('click', retryClick, true);
    document.removeEventListener('touchstart', retryTouch, true);
  }
  function retryClick(e) { if (!e.isTrusted) return; doRetry(); }
  function retryTouch(e) { if (!e.isTrusted) return; doRetry(); }
  function doRetry() {
    disarmRetry();
    if (store.get(FS_KEY) !== '1' || isFullscreen()) return; // 用户已关闭/已全屏 → 放弃
    // v3.8.x：非 PWA（浏览器标签）也允许恢复——FS_KEY=1 即用户明确开启过全屏
    // 且未主动关闭（主动退出会在 handleFsExit 清掉标记），切后台系统退出后
    // 恢复符合用户意图，不会造成「退出后被拉回」的死循环
    // v3.23.x：FB_KEY=1（历史横屏兜底）不再永久走兜底——手势时刻优先试原生全屏：
    // 成功则撤掉 CSS 兜底并清 FB_KEY；1.5s 复核仍失败则保底恢复兜底
    if (store.get(FB_KEY) === '1' && !isVia && orientLockable() && fsSupported()) {
      enterFs();
      setTimeout(() => {
        if (isFullscreen()) { applyFsCss(false, false); return; }
        if (!document.documentElement.classList.contains('fs-css-active')) applyFsCss(true);
      }, 1500);
      return;
    }
    enterFs();
  }
  // v3.8.x：立即武装手势重试（原实现延迟 600ms 才装监听）——用户切后台回来
  // 若在窗口期内触摸/点击，重试会被错过，之后无交互则全屏永不恢复
  //（OPPO Find X9 Chrome PWA 切后台退出全屏复现）
  // v3.11.x：监听改捕获阶段——部分面板/按钮会对 click 调 stopPropagation，
  // 冒泡阶段监听可能收不到首次触摸导致重试被吞（每次进入全屏都失效的方向之一）
  function armRetry() {
    // v3.26.x：iOS 永不武装手势重试——这个 capture touchstart/click 会让「之后任意
    // 一次触摸」补交全屏请求，用户实测表现为「卡了一下突然自己变全屏」，且与开关
    // 状态无关（FS_KEY 残留为 1 就中招）。iOS 没有安卓那种切后台被系统退出全屏、
    // 需要手势重入的场景，重入在 iOS 上没有任何正当用途。
    if (isIOS) return;
    disarmRetry();
    _retryArmed = true;
    document.addEventListener('click', retryClick, true);
    document.addEventListener('touchstart', retryTouch, true);
  }
  function reenterFs() {
    // v3.26.x：iOS 一律不自动重入全屏（含手势重试路径）——见 armRetry 同名注释。
    // iOS 的全屏只能由用户亲手点开关那一下申请（fullscreen.js 的 change 分支）。
    if (isIOS) return;
    // v3.7.x：浏览器标签模式不自动重入全屏——每次打开页面就弹「退出全屏」提示条，
    // 用户无法正常使用；用户主动退出（Esc/提示条）会经 handleFsExit 清掉标记，
    // 此处 FS_KEY !== '1' 即视为已放弃，直接返回（仅 PWA 安装态 / 仍在全屏中保持）。
    // v3.8.x：FS_KEY=1（用户明确开过且未主动关闭）时一律尝试恢复——
    // 含浏览器标签模式切后台系统退出全屏的场景（切回后恢复，符合用户意图）。
    if (store.get(FS_KEY) !== '1') return;
    if (isFullscreen()) return;
    // v3.6.x：上次走的是 CSS 兜底（浏览器转横屏）→ 直接恢复兜底，不再请求原生全屏
    // v3.23.x：兜底不再一票否决——FB_KEY 一旦置 1 就永不自动清除，之后每次进站
    // 都只恢复 CSS 兜底（伪全屏），用户必须手动关开开关才能回到原生全屏
    //（小米15 Pro Chrome 实测「每次进入都要关开全屏」）。改为：先给兜底保底视觉，
    // 同时武装手势重试——首次触摸再试原生全屏（doRetry 成功会撤掉兜底）
    if (store.get(FB_KEY) === '1') { applyFsCss(true); try { syncToggle(false); } catch (e) {} armRetry(); return; }
    // v3.6.x：Via / 无锁 API 的浏览器原生全屏必横屏，恢复时同样直接走兜底
    if (isVia || !orientLockable()) { applyFsCss(true); return; }
    if (!fsSupported()) return;
    // Fullscreen API 需要用户手势；自动调用会被浏览器拦截——先试一次，
    // 被拦则等用户首次触摸/点击时再试（手势时刻的请求浏览器允许）
    enterFs();
    armRetry();
  }
  // 启动时恢复
  // v3.6.x：iOS standalone 用 CSS 类恢复（无需用户手势、无 Fullscreen API 可调）
  try {
    if (store.get(FS_KEY) === '1') {
      if (isIOS && inIosStandalone) applyIosFs(true);
      else reenterFs();
    }
  } catch (e) {}
  // 切后台回来（Android/iOS 切走再切回会退出全屏）→ 自动恢复
  // v3.8.x：hidden 时置 _wentBg（区分「切后台系统退出」与「前台主动退出」，
  // 供 handleFsExit 判断是否保留全屏意图）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { _wentBg = true; return; }
    _wentBg = false;
    _lastVisibleAt = Date.now();   // v3.11.x：记录回前台时刻（供 handleFsExit 时序判定）
    if (isIOS && inIosStandalone) { if (store.get(FS_KEY) === '1') applyIosFs(true); }
    else reenterFs();
  });
  // 记录开关状态（供下次启动尝试恢复）
  // v3.5.113：系统级全屏变化（切后台退出）不覆盖用户「开全屏」的意图
  const obs = new MutationObserver(() => {
    if (_sysToggle) return;
    const el = document.getElementById('sf-fullscreen');
    if (el) store.set(FS_KEY, el.checked ? '1' : '0');
  });
  const el0 = document.getElementById('sf-fullscreen');
  if (el0) { obs.observe(el0, { attributes: true, attributeFilter: ['checked'] }); }

  // v3.9.x：全屏边缘防误触——部分国产浏览器（雨见/UC/QQ 等）全屏下左右边缘上下滑
  // 会调节音量/亮度（浏览器自带手势，网页拦不住）。用户开启后用边缘透明拦截层
  //（touch-action:none 吃掉边缘触摸，浏览器看不到边缘手势触发）+ touchstart 兜底
  // 尝试阻挡。对系统级手势可能无效，最可靠仍是浏览器设置关闭边缘滑动调节。
  const EG_KEY = 'fs-edge-guard';
  let _egLayers = null;
  let _egTouchHandler = null;
  function edgeGuardEnabled() { return store.get(EG_KEY) === '1'; }
  function fsAnyActive() {
    const d = document.documentElement;
    return isFullscreen() || d.classList.contains('fs-active')
      || d.classList.contains('fs-css-active') || d.classList.contains('ios-fs-active');
  }
  function enableEdgeGuard() {
    if (_egLayers) return;
    const css = 'position:fixed;top:0;width:24px;height:100vh;z-index:99999;background:transparent;touch-action:none;pointer-events:auto;';
    const left = document.createElement('div');
    left.setAttribute('style', css + 'left:0;');
    const right = document.createElement('div');
    right.setAttribute('style', css + 'right:0;');
    document.body.appendChild(left);
    document.body.appendChild(right);
    _egLayers = [left, right];
    _egTouchHandler = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      if (t.clientX <= 24 || t.clientX >= window.innerWidth - 24) {
        try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
      }
    };
    document.addEventListener('touchstart', _egTouchHandler, { passive: false, capture: true });
  }
  function disableEdgeGuard() {
    if (_egLayers) { _egLayers.forEach(l => { try { l.remove(); } catch (err) {} }); _egLayers = null; }
    if (_egTouchHandler) { document.removeEventListener('touchstart', _egTouchHandler, true); _egTouchHandler = null; }
  }
  function applyEdgeGuard() {
    if (edgeGuardEnabled() && fsAnyActive()) enableEdgeGuard();
    else disableEdgeGuard();
  }
  let _egTipShown = false;
  function showEdgeGuardTip() {
    if (_egTipShown) return;
    _egTipShown = true;
    const msg = '已开启全屏边缘防误触。屏幕左右边缘 24px 内的触摸将被拦截，避免触发部分浏览器的音量/亮度边缘手势。\n\n若仍无效（雨见等浏览器的边缘手势是系统级，网页可能拦不住），最可靠的方法是在浏览器设置 → 手势/全屏中关闭「边缘滑动调节音量/亮度」。';
    if (window.openModal) {
      window.openModal('全屏边缘防误触', '', () => {}, { noInput: true, staticText: msg });
    }
  }
  const egToggle = document.getElementById('sf-edge-guard');
  if (egToggle) {
    egToggle.checked = edgeGuardEnabled();
    egToggle.addEventListener('change', () => {
      store.set(EG_KEY, egToggle.checked ? '1' : '0');
      applyEdgeGuard();
      if (egToggle.checked) showEdgeGuardTip();
    });
  }
  // 全屏态变化（fs-active/fs-css-active/ios-fs-active class 切换）时同步启用/停用
  const _egObs = new MutationObserver(() => applyEdgeGuard());
  _egObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  applyEdgeGuard();

  // #320 全屏游戏面板抬层：`.game-fs` 面板在 #page-chat（.page z-index:2）的层叠上下文
  //   内，z-index 永远被压到 2，低于全局顶部提醒条（ver-update-bar/backup-remind-bar 998）
  //   ——全屏时头部难度下拉被提醒条盖住、点不到（连连看/消消乐全屏选不了难度的根因）。
  //   任一可见 .game-fs 生效时给 .phone 挂 game-fs-active 类，chat-pages.css 据此把
  //   所在 page 抬到 1000（>998），面板 z-9999 才真正置顶；退出后还原，提醒条照常显示。
  function gameFsHasActive() {
    // FIX 2026-09-11 #338 手机端卡顿成分：本检查挂在 document.body 整树观察器上，
    // 每个 DOM 变动批都做一次类并集选择器全文档扫描（4× 降频实测：切桌面一个阶段
    // 扫 74 次 ≈260ms 主线程）。改用 getElementsByClassName 活集合（C++ 直索引，
    // 双类匹配语义与 '.poke-card.game-fs' 完全等价，无选择器引擎/无快照分配）。
    var nodes = document.getElementsByClassName('poke-card game-fs');
    for (var i = 0; i < nodes.length; i++) { if (!nodes[i].hidden) return true; }
    return false;
  }
  var _gfsPhone = document.querySelector('.phone') || (document.body || document.documentElement);
  function applyGameFsElevate() {
    _gfsPhone.classList.toggle('game-fs-active', gameFsHasActive());
  }
  var _gfsObs = new MutationObserver(applyGameFsElevate);
  _gfsObs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
  applyGameFsElevate();
})();

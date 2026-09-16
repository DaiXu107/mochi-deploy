// ===== #319 系统内置字卡二级验证锁（防未成年人）=====
// 设计（用户点名）：
//   ① 默认全锁——所有系统预设字卡（main/kaomoji/emoji/dict/interact/period/fish…全部分类）
//      视为不存在，回复池、字卡库、词典拼字、各功能同源池一律取不到；用户自建字卡不受影响。
//   ② 开屏解锁——开屏公告区出现「防未成年人·内置字卡锁定」卡，点「输入密码解锁」弹
//      openModal 输入框，输对密码（990815）才放行并刷新页面生效；输错提示剩余次数并节流。
//   ③ 持久化 + 可重锁——解锁状态存全局根键（per-cid 无关），解锁后卡变「已解锁」可一键
//      重新上锁；想改密码只能改本文件重新部署（源码不存明文，只存散列）。
// 存储约定：纯本地无后端；密码不存明文——存 FNV-1a 32 位散列（防顺手翻源码/存储看到），
//   这不是安全边界（前端无真安全），只是「不显眼 + 不鼓励尝试」；真正意图是产品层的年龄门槛。
// FIX 2026-09-13 #389（LS 回滚家族，同族 #82/#88/#226/#229/#233/#265/#339）：原实现直接
//   localStorage 读写解锁状态——绕过 xyStore，不进 __wr-journal 写日志、不写 IDB、无每键
//   时间戳标记。荣耀 200 Pro Edge 等杀进程回滚 localStorage 的机型上，解锁后刷新/重进 =
//   最近一次磁盘提交被整批回滚，cardlock-state 退回 'locked'，密码框每次都要重输
//  （多机型可复现）。现改走 xyStore（写日志 + IDB 权威值 + 每键标记 + mochi-wrj-heal
//   自愈链，与其他设置键同路），零机型分支：杀进程回滚后由 wrjMergeFromIdb 按标记以
//   IDB 权威值自愈回 'open'；xyStore.get 的 memoryCache 优先读保证自愈后本会话立即可见；
//   状态翻转时补发 mochi-cardlock-open/-locked 事件（clock/chatcard/reply-settings 已监听
//   重渲染，解锁态晚到不再需要用户手动再刷一次）。
(function () {
  const GNS = 'xy-home-v2';
  const STATE_SHORT = 'cardlock-state';
  const LS_KEY = 'xy-home-v2:cardlock-state'; // 'locked' | 'open'
  // FNV-1a 32bit('mochi#990815')——盐前置，纯数字散列串不易反推常见日期格式
  const PW_HASH = '4240701628';
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return String(h >>> 0);
  }
  // #389 状态读写统一走 xyStore（内存缓存 + LS 快照 + __wr-journal + IDB + 标记五件套）；
  // xyStore 不在（理论不会：idb.js 先于本文件加载）才退回裸 LS，保持老行为可用。
  function stGet() {
    try {
      if (window.xyStore) {
        const v = window.xyStore(GNS).get(STATE_SHORT);
        if (v !== null && v !== undefined) return v;
      }
    } catch (e) {}
    try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
  }
  function stSet(v) {
    try { if (window.xyStore) { window.xyStore(GNS).set(STATE_SHORT, v); return; } } catch (e) {}
    try { localStorage.setItem(LS_KEY, v); } catch (e) {}
  }
  function isOpen() { try { return stGet() === 'open'; } catch (e) { return false; } }
  // 存量自愈：修复前解锁过的用户，状态键已被 contacts.js migrateLegacy 搬进
  // default 命名空间（xy-home-v2:default:cardlock-state）并删了根键——启动时把它
  // 搬回根键，解锁不用重输。EXCLUDE 收口后不会再产生新的搬移。
  // #389：写回改走 stSet——搬回的 'open' 同样进写日志/IDB/标记，不再只落裸 LS。
  (function healMigrated() {
    try {
      if (localStorage.getItem(LS_KEY)) return;
      const moved = localStorage.getItem('xy-home-v2:default:cardlock-state');
      if (moved === 'open') stSet('open');
    } catch (e) {}
  })();
  // 汇合点统一问这里：锁定 = 系统预设字卡整体不存在
  let lastOpen = isOpen();
  window.cardLockOpen = isOpen;
  // #389：wrj 自愈链修好本键（杀进程回滚把 LS/内存打回 'locked' → IDB 权威值回填 'open'）
  // 后，若状态翻转则补发对应事件，让已按旧状态渲染的开屏锁卡/字卡库锁卡/回复设置页
  // 重同步——解锁态晚到的会话不再显示「需要输入密码」假象。
  document.addEventListener('mochi-wrj-heal', function () {
    try {
      const open = isOpen();
      if (open !== lastOpen) {
        lastOpen = open;
        document.dispatchEvent(new Event(open ? 'mochi-cardlock-open' : 'mochi-cardlock-locked'));
      }
    } catch (e) {}
  });
  // #404 补强（米15夸克 LS 配额满实测）：解锁态也可能由 idbRestore 的 retainValue 在
  //   restore 阶段直接回填进 memoryCache（LS 配额满设备项目 LS 键恒空、IDB 是唯一值源）
  //   ——此时 IDB 值与写标记一致，wrjMergeFromIdb 的 healed 计数为 0、不广播
  //   mochi-wrj-heal，开屏锁卡/字卡库会一直停在首屏的「输入密码解锁」假象（无头复现：
  //   cardLockOpen() 已是 true 而锁卡 UI 仍锁定，且随读取竞态时好时坏）。restore 完成
  //   时主动复核一次状态翻转；事件与 wrj-heal 链幂等（setupCardLockCard 重复触发安全）。
  document.addEventListener('mochi-restore-done', function () {
    try {
      const open = isOpen();
      if (open !== lastOpen) {
        lastOpen = open;
        document.dispatchEvent(new Event(open ? 'mochi-cardlock-open' : 'mochi-cardlock-locked'));
      }
    } catch (e) {}
  });
  // 散列带盐校验（输错 5 次锁输入 60 秒，防小孩连试）
  let fails = 0, failUntil = 0;
  window.cardLockTryUnlock = function (pw) {
    const now = Date.now();
    if (now < failUntil) return { ok: false, msg: '尝试太频繁，请 ' + Math.ceil((failUntil - now) / 1000) + ' 秒后再试' };
    if (fnv1a('mochi#' + String(pw == null ? '' : pw)) === PW_HASH) {
      fails = 0;
      stSet('open');
      lastOpen = true;
      document.dispatchEvent(new Event('mochi-cardlock-open'));
      return { ok: true };
    }
    fails++;
    if (fails >= 5) { failUntil = now + 60000; fails = 0; return { ok: false, msg: '错误次数过多，请 1 分钟后再试' }; }
    return { ok: false, msg: '密码不对（还剩 ' + (5 - fails) + ' 次机会）' };
  };
  window.cardLockRelock = function () {
    stSet('locked');
    lastOpen = false;
    document.dispatchEvent(new Event('mochi-cardlock-locked'));
  };
  // FIX 2026-09-13 #404（米15夸克 LS 配额满家族）：解锁/上锁后 clock.js 原来盲等 900ms 就
  //   location.reload()——xyStore 的 IDB 权威值/写标记是异步落库的，夸克等内核 reload 杀进程
  //   时会中止在途 IDB 事务：值没提交成功，刷新后 retainValue/自愈链取不到新状态即回锁
  //  （LS 配额满的设备上项目 LS 键恒为空，IDB 是唯一凭证，一次提交失败就必现）。
  //   这里轮询 idbGet 权威值直到变为期望值再回调（200ms×15=3s 兜底，超时也放行刷新不卡 UI）。
  //   期望值取反即安全：解锁时期待 'open'（旧值必是 locked/缺失），重锁时期待 'locked'，
  //   读到旧值不会误判为已提交。
  window.cardLockConfirmPersisted = function (expect, cb) {
    let tries = 0;
    (function poll() {
      try {
        if (window.idbGet) {
          window.idbGet(LS_KEY).then(function (v) {
            if (v === expect || ++tries > 15) { cb(); return; }
            setTimeout(poll, 200);
          }).catch(cb);
        } else { cb(); }
      } catch (e) { cb(); }
    })();
  };
})();

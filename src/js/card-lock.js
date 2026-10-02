// ===== #319 系统内置字卡二级验证锁（防未成年人）=====
// 设计（用户点名）：
//   ① 默认全锁——所有系统预设字卡（main/kaomoji/emoji/dict/interact/period/fish…全部分类）
//      视为不存在，回复池、字卡库、词典拼字、各功能同源池一律取不到；用户自建字卡不受影响。
//   ② 开屏解锁——开屏公告区出现「防未成年人·内置字卡锁定」卡，点「输入密码解锁」弹
//      openModal 输入框，输对密码（990815，与开屏问答「暗号」同串）才放行；输错提示剩余
//      次数并节流。
//   ③ 持久化 + 可重锁——解锁状态存全局根键（per-cid 无关），解锁一次后刷新/重开不再重输
//      （#1511 作者拍板「已经解锁了就不要每次重新解锁」；#1497 会话闸撤销）；解锁后卡变「已解锁」
//      可一键重新上锁；想改密码只能改本文件重新部署（源码不存明文，只存散列）。
// 存储约定：纯本地无后端；密码不存明文——存 FNV-1a 32 位散列（防顺手翻源码/存储看到），
//   这不是安全边界（前端无真安全），只是「不显眼 + 不鼓励尝试」；真正意图是产品层的年龄门槛。
(function () {
  // #961 系统预设「默认聊天字卡 / 词典」体量提醒——字卡库顶部红条（default-cards.js 填 #dc-size-hint /
  //   #dict-size-hint）与二级密码解锁成功弹窗（clock.js promptCardUnlock）共用同一份文案，避免两处
  //   各写一遍后走词。card-lock.js 在 jsFiles 里先于 clock.js / default-cards.js 加载，故常量落这里。
  window.mochiPresetSizeTip = '字卡太多不用全开：「默认聊天字卡」和「聊天默认字卡·词典」都是很大的池子（词典还含扩展常用词，是数量最多的一类）。抽卡按分组随机，字卡多 ≠ 回复更好用——量太大反而更容易抽到生僻、重复或不合适的内容。如果你不常用词典拼字 / 拼句玩法，建议把词典关掉：到「字卡库 → 聊天默认字卡·词典」页点「使用的全部关闭」，或按分组「整组停用」、逐张关闭，只留常用的语录。关闭不影响其他任何功能，需要时随时可以再打开。';
  const GNS = 'xy-home-v2';
  const STATE_SHORT = 'cardlock-state';
  const LS_KEY = 'xy-home-v2:cardlock-state'; // 'locked' | 'open'（#1497 起仅作诊断留痕）
  // FNV-1a 32bit('mochi#990815')——盐前置，纯数字散列串不易反推常见日期格式
  const PW_HASH = '4240701628';
  // #1495 全角/夹空白归一化（保留）：部分输入法与内核把数字打成全角（９９０８１５）或数字间
  //   夹空白（99 0815），原样过散列必败＝「输对了密码却解锁不了」的多机型报障直因。判据只取
  //   字符形态（空白集＋全角数字区），零机型／零 UA 分支。applock 暗号三入口同款同判据。
  function normCode(v) {
    return String(v == null ? '' : v)
      .replace(/\s+/g, '')
      .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 65248); });
  }
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return String(h >>> 0);
  }
  // #389 状态写统一走 xyStore（内存缓存 + LS 快照 + __wr-journal + IDB + 标记五件套）；
  // xyStore 不在（理论不会：idb.js 先于本文件加载）才退回裸 LS，保持老行为可用。
  // #1497 的会话闸已按 #1511 撤销（不再绕开存储值），写侧照走＝诊断与历史链路不哑。
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
  // #1497 会话闸已按 #1511 撤销（2026-09-30 作者再拍板「已经解锁了……每次刷新重新打开网页总是让我
  //   重新解锁……帮我修复」）：解锁态回归持久化——isOpen 读存储（#389/#404 自愈链随之恢复职能），
  //   解锁一次后刷新/重开不再重输；当天的「不要弹窗」（#1501）与「解锁就地生效不刷新」均保留。
  //   当天早些时候的「每次加载重新上锁」口径由会话闸实现，实测与「已解锁就不要再问」诉求冲突，撤。
  function isOpen() { try { return stGet() === 'open'; } catch (e) { return false; } }
  // 存量自愈：修复前解锁过的用户，状态键已被 contacts.js migrateLegacy 搬进
  // default 命名空间（xy-home-v2:default:cardlock-state）并删了根键——启动时把它
  // 搬回根键（#1497 起仅留痕用，保持历史数据完整）。
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
  // #389：wrj 自愈链修好本键后若状态翻转则补发对应事件（#1497 起闸门读会话旗标，此链
  //   只剩「会话内自愈翻转」的边角作用，保留＝事件契约不哑）。
  document.addEventListener('mochi-wrj-heal', function () {
    try {
      const open = isOpen();
      if (open !== lastOpen) {
        lastOpen = open;
        document.dispatchEvent(new Event(open ? 'mochi-cardlock-open' : 'mochi-cardlock-locked'));
      }
    } catch (e) {}
  });
  document.addEventListener('mochi-restore-done', function () {
    try {
      const open = isOpen();
      if (open !== lastOpen) {
        lastOpen = open;
        document.dispatchEvent(new Event(open ? 'mochi-cardlock-open' : 'mochi-cardlock-locked'));
      }
    } catch (e) {}
  });
  // 散列带盐校验（输错 5 次锁输入 60 秒，防小孩连试）；比对前 normCode 归一（全角/夹空白）
  let fails = 0, failUntil = 0;
  window.cardLockTryUnlock = function (pw) {
    const now = Date.now();
    if (now < failUntil) return { ok: false, msg: '尝试太频繁，请 ' + Math.ceil((failUntil - now) / 1000) + ' 秒后再试' };
    if (fnv1a('mochi#' + normCode(pw)) === PW_HASH) {
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
  //   #1497：解锁侧不再刷新（会话闸下解锁后 reload＝当场打回锁定），仅重锁路径继续用。
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

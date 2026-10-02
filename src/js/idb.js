// ===== 功能：IndexedDB 存储（持久化关键数据，不丢失任何记录） =====
// 用于：字卡数据（cc-groups）、查岗记录（checkin-history）、聊天记录等
// 策略：写入时双写（localStorage 缓存 + IndexedDB 权威持久），
//       读取时优先 localStorage（同步快），初始化时从 IndexedDB 合并/恢复最新数据
(function () {
  const DB_NAME = 'mochi-db';
  const DB_VERSION = 1;
  const STORE = 'kv';

  let dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    const self = new Promise((resolve, reject) => {
      // FIX 2026-09-25 #1227（iPhone 15 Pro Max + Safari 实报「存储异常」每次打开都弹；
      // 该弹窗家族此前已在 iPhone 16 Pro Safari 修过两轮，本轮根因之一是这段兜底计时器）：
      // 原实现 8s 挂起兜底计时器**无条件**执行——open 早已成功落地它照样把 dbPromise 置空，
      // 于是下一次调用又开一条新连接、上一条没人 close（连接泄漏）。iOS 挂后台会杀 IDB
      // 服务进程、冷启动 open 常逼近 8s，前后台一切换就累积一批僵尸连接＋无谓重开。
      // 现在计时器只在「请求尚未落地」时生效（settled 闸）；若 open 在判挂起之后才迟到，
      // 迟到的连接是孤儿（Promise 已 rejected、无人使用），当场 close 掉不再泄漏。
      // 零机型／零 UA 分支：判据只有本内核请求的落地状态。
      let settled = false;
      let hangFired = false;
      try {
        if (!window.indexedDB) { settled = true; reject(new Error('no idb')); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE);
          }
        };
        // v3.26.x #135：版本升级被其他标签页/旧连接阻塞——原实现无 onblocked 处理：
        // blocked 请求既不 onsuccess 也不 onerror，open() 永不落地，所有 open().then
        // 挂死（含启动回填 idbRestore → 开屏永远「正在加载数据…」）。新版本 SW 换代后
        // 新旧页面并存时高发（iPad 7 + Edge 实测卡开屏）。收到 blocked 主动失败本次
        // open（下次调用重建）；旧连接方随后释放或关闭旧标签页后自然恢复。
        req.onblocked = () => {
          settled = true;
          reject(new Error('idb open blocked'));
        };
        req.onsuccess = () => {
          settled = true;
          if (hangFired) { try { req.result.close(); } catch (e0) {} return; }
          resolve(req.result);
        };
        req.onerror = () => { settled = true; reject(req.error); };
      } catch (e) { settled = true; reject(e); }
      // v3.26.x #135：open() 兜底落地——iOS/Edge 内核存在「open 请求既不 success
      // 也不 error 也不 blocked」的挂起形态（IDB 服务进程被杀瞬间发起的请求）。原实现
      // 各事务超时计时器都注册在 open().then 里，open 不落地则计时器永不启动 →
      // idbGet/idbGetMany/idbListKeys/idbRestore 全部永久挂起，开屏永远停在
      // 「正在加载数据…」（iPad 7 + Edge 实测）。8s 未落地判失败：本次 open 失败，
      // 调用方 catch 走 LS 兜底/慢保险丝，开屏永不卡死；#1227 后连接缓存的清退
      // 统一交给下方带身份核对的 catch（旧实现计时器无条件拆缓存＝泄漏＋churn）。
      setTimeout(function () {
        if (settled) return; // #1227：请求已落地＝本计时器作废，绝不拆健康连接的缓存
        hangFired = true;
        reject(new Error('idb open hang'));
      }, 8000);
    });
    // v3.6.x 修复（open 失败永久不可用）：失败时清 dbPromise 允许下次重试——
    // 原实现缓存 rejected Promise，整个会话 IDB 永久不可用（隐私模式/配额耗尽/
    // 浏览器临时禁用 IDB 后恢复时无法自愈）
    // #1227：仅当缓存仍指向本条 promise 才清——原闭包直接引用变量，一条旧挂起请求
    // 的迟到 reject 会把期间已重建好的健康连接再踢掉一次。
    self.catch(() => { if (dbPromise === self) dbPromise = null; });
    dbPromise = self;
    return dbPromise;
  }
  // v3.25.x（修 iOS「字卡数据没有加载」高发）：iOS Safari/PWA 挂后台后会杀掉
  // IndexedDB 服务进程，原连接之后所有事务同步抛 InvalidStateError（"The database
  // connection is closing"）或 UnknownError（"Connection to Indexed Database server
  // lost"），而 open() 永久缓存旧连接 → 整个会话读写全废且永不自愈；若启动回填
  // 恰被打断，字卡库等大键本会话空载（字卡库空、TA 回复没有自定义字卡）。
  // 各事务入口检测到连接级错误时置 dbPromise=null，下一次 open() 重建连接
  //（新连接会按需拉起 IDB 服务，通常当场恢复）。
  function connLost(e) {
    try {
      if (!e) return false;
      // v3.26.x 修复（iPhone 16 Pro Safari「存储异常」弹窗每会话必现）：iOS 挂后台会
      // 杀 IndexedDB 服务进程，回前台后旧连接上事务失败，错误名不固定——iOS 18 实测
      // 多报 UnknownError/InternalError/TransactionInactiveError（而非只有
      // InvalidStateError）。原只匹配 InvalidStateError → 连接永不重建 → 本会话后续
      // 写入全部失败 → 连续 5 次弹「存储异常」且每会话必现。这里把 iOS 常见连接级
      // 错误名一并判死（重试最多 3 次封顶，真实数据错误不会被无限掩盖）。
      const n = e.name;
      if (n === 'InvalidStateError' || n === 'UnknownError' || n === 'InternalError' || n === 'TransactionInactiveError') return true;
      const m = String((e && e.message) || e);
      return /connection\s+(is\s+)?(closed|lost|closing)|server\s+lost|database\s+connection|indexed\s+database/i.test(m);
    } catch (err) { return false; }
  }
  // v3.26.x 修复（iPhone 16 Pro Safari「存储异常」弹窗每会话必现）：仅靠错误触发
  // 重建不可靠（iOS 错误名多变、有时事务只挂起不报错），回前台时主动作废旧连接
  // 引用，下一次 open() 重建新连接——事务持有自己的 db 引用，不影响在途事务，
  // 重建开销极小。同时预拉起新连接，回前台后的首次写入不再撞上服务未就绪。
  // 仅 iOS 启用（桌面/安卓靠 connLost 兜底已够，避免切窗每次重建）。
  function armFgIdbReset() {
    try {
      if (typeof document === 'undefined' || !document.addEventListener) return;
      // v3.26.x 收口第二批：iOS 判定（含 iPadOS 13+ Macintosh 伪装 UA 分支 #144）
      // 改读唯一判定源 device.js（mochiDevice.isIOS）——此前这里复刻一份
      // iPhone|iPad|iPod 正则 + touchMac 伪装检测，与 device.js 各算一遍，
      // device.js 判定规则升级时这里会被漏掉（收口第二批清单项）。
      // 真桌面 Mac maxTouchPoints=0 不会误判（device.js #144 分支自带触摸信号门槛）。
      if (!((window.mochiDevice || {}).isIOS)) return;
      const resetNow = function () {
        try {
          if (!dbPromise) return;
          dbPromise = null;
          open().catch(function () {});
        } catch (e) {}
      };
      document.addEventListener('visibilitychange', function () {
        try { if (document.visibilityState === 'visible') resetNow(); } catch (e) {}
      });
      if (window.addEventListener) window.addEventListener('focus', resetNow);
    } catch (e) {}
  }
  armFgIdbReset();

  // 写入（key: 完整键名，如 'xy-home-v2:cc-groups'）
  // v3.7.0：写入失败重试 2 次（间隔 100ms），累计失败超 5 次 openModal 告警。
  // 不破坏现有数据：重试是再写一次同样的 key/value，不删不改其他键。
  // 告警让用户感知"静默丢数据"风险——原实现 resolve(false) 调用方忽略返回值，
  // 数据只进 memoryCache 刷新即丢且无感知；告警后用户可主动导出备份。
  // v3.26.x 修复（旧数据多的人「存储异常」弹窗每会话必现）：
  // ① 失败计数改为「连续失败」——任一次写入成功即清零。原实现整个会话累计不清零，
  //    iOS 回前台/偶发抖动的一阵失败会永久污染计数，之后哪怕全部写成功也照样弹窗。
  //    配额满等真实持续失败场景仍会连续计满 5 次、照常告警，不掩盖问题。
  // ② 超时按值体积放大——chat-msgs 单键可达几十~几百 MB（图片 base64 内联），
  //    慢设备上合法整包写入本来就可能 >4s：被判失败→重试又超时→计 1 次失败，
  //    实际事务多半最终写成功，纯属误报。256KB 起每 256KB +2s，封顶 +26s；
  //    小值维持 4s 快速判挂起不变（荣耀/Edge 挂起场景不回归）。
  let _idbFailCnt = 0;
  let _idbFailAlerted = false;
  let _idbFailLastErr = '';
  function _idbFailNotify() {
    _idbFailCnt++;
    if (_idbFailCnt < 5 || _idbFailAlerted) return;
    _idbFailAlerted = true;
    try { console.warn('[mochi] IDB 写入连续失败 ' + _idbFailCnt + ' 次（最后错误: ' + (_idbFailLastErr || '超时/挂起') + '），建议立即导出备份'); } catch (e) {}
    try {
      if (window.openModal) {
        // #576：原弹窗只报错并让用户「去设置页导出」，手机端用户不知道设置页里该干什么。
        // 现按处理顺序给分步建议 + 两个直达按钮（copyBtn/exportBtn 通用按钮位）：
        // 「去导出备份」→ #row-export、「查看存储」→ #row-storage-view；平台差异各给一条
        // 针对性提示（iOS 系统清存储/无痕模式，安卓系统存储挂钩）。跳转失败不关窗、
        // 就地提示手动路径，兜底永远可手动走设置页。
        const md = window.mochiDevice || {};
        const platTip = md.isIOS
          ? 'iOS 存储紧张时系统可能清空网站数据，且无痕模式下数据不落盘——定期导出是唯一防线。'
          : (md.isAndroid ? '安卓的写入配额与手机系统存储挂钩，请确保系统存储有足够剩余空间。' : '');
        const ctl = window.openModal('存储异常', '', null, {
          noInput: true,
          staticText: '近期数据多次写入失败（最后一次内核回执：' + (_idbFailLastErr || '事务超时未落地') + '），数据可能没有存上。建议按顺序处理：\n\n'
            + '① 先导出一份备份（下方「去导出备份」直达；数据量大可改选「只备份文字」，文件更小）\n'
            + '② 查看存储占用并瘦身（下方「查看存储」直达：字卡图去重 / 图片压缩 / 清理本地音乐）\n'
            + (platTip ? '③ ' + platTip + '\n' : '')
            + (platTip ? '④' : '③') + ' 若每次打开都弹：设置 → 设备兼容诊断，一键复制报告反馈',
          copyBtn: { label: '去导出备份', fn: function (c) { idbFailAct('#row-export', c, '设置 → 导出数据'); } },
          exportBtn: { label: '查看存储', fn: function (c) { idbFailAct('#row-storage-view', c, '设置 → 查看存储'); } }
        });
        try { if (ctl && ctl.okText) ctl.okText('知道了'); } catch (e0) {}
      }
    } catch (e) {}
  }
  // #576：存储异常弹窗直达按钮的跳转——与 card-audit.showSettingRow 同款链路（显
  // #page-setting → 点行所在分组 tab → 滚动居中），不重复实现入口逻辑；行上的点击
  // 处理器仍由各自功能文件绑定，用户到达后照常手点。成功才关弹窗（ctl.close）。
  function idbFailAct(rowSel, ctl, fallbackTip) {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      const sp = document.getElementById('page-setting');
      if (sp) sp.hidden = false;
      const el = document.querySelector(rowSel);
      if (!el) throw new Error('row missing');
      const sec = el.closest ? el.closest('.them-sec') : null;
      if (sec && sec.dataset && sec.dataset.sec) {
        const tab = document.querySelector('#set-tabs .them-tab[data-tab="' + sec.dataset.sec + '"]');
        if (tab) tab.click();
      }
      try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}
      if (ctl && ctl.close) ctl.close();
    } catch (e) {
      try { if (ctl && ctl.hint) ctl.hint('入口暂不可达，请手动前往：' + fallbackTip); } catch (e2) {}
    }
  }
  // v3.26.x：写入挂起超时——idbGet 侧早已确认部分安卓内核（真我/荣耀 Edge 等）事务
  // 可能挂起（既不 onsuccess 也不 onerror）；写入侧原实现同样裸奔：挂起时 Promise
  // 永不 resolve，下面的重试骨架（只对显式 false 生效）永远不会触发 → 写入静默丢失，
  // IDB 权威层停留在旧值。杀进程回滚 localStorage 后（荣耀 200 Pro Edge 实测：设置
  // 开关退出重进"变回去"），启动回填以 IDB 为准就成了旧值回退。现与 idbGet 同款：
  // 单次事务 4s 未完成即判挂起 → 置空连接重建重试（外层重试骨架最多再试 2 次）。
  window.idbSet = function (key, value) {
    // FIX 2026-09-25 #1227（iPhone 15 Pro Max + Safari「存储异常」每次打开都弹；与 open()
    // 的 settled 闸同批，根因之二）：原实现把「本地超时」直接当「写失败」——超时时事务
    // 其实还活着（iOS 大键整包写常超本地判定窗；本机诊断实证 default:chat-msgs 单键 32.8MB），
    // 于是同一 idbSet 调用内盲目再排 2 次重试、调用方（chat.js persistMsgsToIdb 数组失败
    // 回退整包字符串）又追一轮 → 一次逻辑保存最多 6 个全量写事务：每个 put() 的 structured
    // clone 都在主线程付费（卡顿），排队事务又挤慢彼此（更多超时），最终 5 连败弹「存储异常」
    // ——而所有事务其实都陆续写成功了（假警报）。现改「读回执再裁决」：超时只判「本次没等到」，
    // 事务的最终回执留着；下一次尝试先等它——迟到 oncomplete＝值已落盘，直接按成功收场，
    // 不再重复排队；迟到 error/abort 才照常走新事务。真挂起内核（荣耀/Edge 无回执形态）
    // 等满一个 lim 后行为与旧版一致，防丢语义不变。零机型／零 UA 分支：判定只取事务回执。
    // 已知取舍：重试链共享同一 value 引用，若在等待回执期间数组被追加（新消息进来），
    // 迟到成功会跳过对更新快照的重写——LS 快照＋memoryCache＋下次防抖保存会补上，与旧版
    // 事务排队竞态同级。
    let lateReceipt = null; // Promise<true|false|null>：上一次超时尝试的最终内核回执（null=等满放弃）
    function tryOnce() {
      const wait = lateReceipt || Promise.resolve(null);
      lateReceipt = null;
      return wait.then((lateOk) => {
        if (lateOk === true) return true; // 上一事务最终写成功＝本值已落盘，不重复排队
        return open().then(db => new Promise((resolve) => {
          let done = false;
          let lateRes = null; // 超时落地后置为回执投递器
          // v3.26.x：超时按值体积放大（大包误报修复，见 _idbFailNotify 上方说明）。
          // v3.26.x OOM：聊天记录改 IDB 直存数组（structured clone，免整包 JSON.stringify）——
          // 数组也按估算体积放大超时，否则 150MB 级数组在慢设备上 >4s 被判挂起、误触发回退重写。
          let lim = 4000;
          try {
            let est = 0;
            if (typeof value === 'string') est = value.length;
            else if (Array.isArray(value)) {
              // FIX 2026-09-21 #950：估算器支持嵌套数组（表情包 my-emoji-groups 直存数组＝
              // [[分组名,[dataURL...]],...]，原循环对内层元素只计 64 字节/个，30MB 级包被
              // 估成几百字节＝超时不放大，慢设备上 structured clone 未完成就被判挂起、
              // 误触发 #434 退避重发循环）。通用递归：字符串计长、嵌套数组/对象下钻，深度封顶。
              const est950 = (v, d) => {
                if (typeof v === 'string') return v.length;
                if (!v || typeof v !== 'object') return 32;
                if (d > 4) return 64;
                let n = 0;
                if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) n += est950(v[i], d + 1); return n + 16; }
                if (typeof v.text === 'string') n += v.text.length;
                if (typeof v.img === 'string') n += v.img.length;
                if (typeof v.voice === 'string') n += v.voice.length;
                if (Array.isArray(v.parts)) { for (let j = 0; j < v.parts.length; j++) { const p = v.parts[j]; if (p && typeof p.v === 'string') n += p.v.length; } }
                return n + 64;
              };
              for (let i = 0; i < value.length; i++) est += est950(value[i], 0);
            }
            if (est > 262144) lim = 4000 + Math.min(26000, Math.ceil(est / 262144) * 2000);
          } catch (e) {}
          const t = setTimeout(function () {
            if (done) return; done = true;
            dbPromise = null; // 连接疑似挂起，下次 open 重建
            lateReceipt = new Promise((res) => {
              lateRes = res;
              setTimeout(() => res(null), lim); // #1227：再等一个 lim 仍无回执＝按挂起处理（真我/荣耀 Edge 形态）
            });
            resolve(false);
          }, lim);
          // #1227：done 之后事务仍可能落地——最终回执经 deliverLate 投给重试链；
          // 迟到的 oncomplete 同时清零连续失败计数（写其实成功了，不许计成失败）。
          const deliverLate = (v) => { if (lateRes) { const r = lateRes; lateRes = null; if (v) _idbFailCnt = 0; r(v); } };
          try {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => { if (done) { deliverLate(true); return; } done = true; clearTimeout(t); resolve(true); };
            tx.onerror = () => { _idbFailLastErr = (tx.error && tx.error.name) || 'error'; if (connLost(tx.error)) dbPromise = null; if (done) { deliverLate(false); return; } done = true; clearTimeout(t); resolve(false); };
            tx.onabort = () => { _idbFailLastErr = (tx.error && tx.error.name) || 'abort'; if (connLost(tx.error)) dbPromise = null; if (done) { deliverLate(false); return; } done = true; clearTimeout(t); resolve(false); };
          } catch (e) { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (e && e.name) || 'error'; if (connLost(e)) dbPromise = null; resolve(false); }
        })).catch(() => false);
      });
    }
    return (async () => {
      let ok = await tryOnce();
      if (!ok) { await new Promise(r => setTimeout(r, 100)); ok = await tryOnce(); }
      if (!ok) { await new Promise(r => setTimeout(r, 100)); ok = await tryOnce(); }
      if (ok) { _idbFailCnt = 0; return true; } // v3.26.x：成功即清零——只对连续失败告警
      _idbFailNotify();
      return false;
    })();
  };

  // 批量写入（单事务一次完成，比逐条 idbSet 快；任一条失败则整体失败）
  // FIX 2026-09-07 #226：补挂起超时骨架（与 idbSet/idbGet 同款）——原实现裸奔：真我/荣耀/
  // 小米 Edge 等挂起内核上事务既不 oncomplete 也不 onerror，Promise 永不落地，两个调用方
  // 的「返回 false 兜底」双双失效：
  // ① wrj 写日志标记微批（wrjMarkFlush）：兜底退回逐键 idbSet 永不触发 → 标记静默丢失 →
  //    浏览器杀进程回滚 localStorage 后 wrjMergeFromIdb 找不到新标记、自愈失效 → 最近的
  //    美化/设置/小数据刷新后回退（#166 微批化后该家族多机型复发「刷新后丢美化/丢数据」）；
  // ② media-pool mochiMediaFlush：writeBuf 已 splice 出去却既没写成功也没回队 → 表情/图片
  //    令牌静默丢。现按值体积放大超时（与 idbSet 同公式），超时置空连接并 resolve(false)。
  window.idbSetAll = function (pairs) {
    if (!pairs || !pairs.length) return Promise.resolve(true);
    return open().then(db => new Promise((resolve) => {
      let done = false;
      let est = 0;
      try { pairs.forEach(p => { const v = p && p.v; est += (typeof v === 'string' ? v.length : 64); }); } catch (e0) {}
      const lim = 4000 + (est > 262144 ? Math.min(26000, Math.ceil(est / 262144) * 2000) : 0);
      const t = setTimeout(function () {
        if (done) return; done = true;
        dbPromise = null; // 事务疑似挂起，连接重建交给下一次调用
        resolve(false);
      }, lim);
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const os = tx.objectStore(STORE);
        pairs.forEach(p => { os.put(p.v, p.k); });
        tx.oncomplete = () => { if (done) return; done = true; clearTimeout(t); resolve(true); };
        tx.onerror = () => { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (tx.error && tx.error.name) || 'error'; if (connLost(tx.error)) dbPromise = null; resolve(false); };
        tx.onabort = () => { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (tx.error && tx.error.name) || 'abort'; if (connLost(tx.error)) dbPromise = null; resolve(false); };
      } catch (e) { if (done) return; done = true; clearTimeout(t); resolve(false); }
    })).catch(() => false);
  };

  // 读取
  // v3.9.x 修复（真我 Edge 切联系人后聊天记录消失）：IDB 事务在部分安卓内核
  //（真我 Edge 等）可能挂起——既不触发 onsuccess 也不触发 onerror，Promise 永不
  // resolve，上层 loadMsgs 回调永不执行，聊天记录渲染空后无法补回。加超时保护：
  // 4s 未返回则重试一次（新事务，偶发挂起可自愈），再 4s 仍未返回则 resolve(undefined)
  // 让上层走 LS 兜底/保险丝，避免永久卡死。总上限 8s（原 8+8=16s 进聊天页空白太久）。
  // FIX 2026-09-17 #665a 读结果「歧义」标记（可选第二参，只增不改返回值语义）：
  //   `undefined` 有两种来源——①键真不存在（onsuccess 拿到 undefined）；②事务挂起超时/
  //   连接丢失/打开失败（本文件上方各安卓内核实录）。上层媒体池必须区分：把②当①会永久
  //   拉黑一个其实存在的媒体池条目（朋友圈/聊天的令牌贴纸「有时看不到、很随机」，#665）。
  //   传入一个对象即得 `info.ambiguous === true`（仅②置位），不传参的调用方行为一字不变。
    // ===== #1466 Safari「冻结事务态」读结果守卫（iPhone 15 Pro Max／iOS 18.7 Safari 实证：
  // 诊断单 mochi-diag-2026-09-29-13-56 的【最近错误】：InvalidStateError: Failed to read the
  // 'result' property from 'IDBRequest': The request has not finished. @js/idb.js:237＝idbGet
  // 的 onsuccess 里 finish(req.result) 那一发）——该机本页被系统回收 116 次、前后台频繁切换，
  // 页面被反复挂起/回收后，success 事件会照常派发、请求本体却还没完成：此刻读 .result 直接抛
  // InvalidStateError。旧写法把 finish(req.result) 的实参求值放在 onsuccess 里，一抛＝finish
  // 永远不执行，这一发读既不成功也不失败，只能干等 4s/6s 等待窗→重试→再等；等待窗里上层拿
  // 旧账渲染、新账几秒后从另一条路画上来＝「聊天记录一会显示以前一会显示现在」的读侧源头之一
  // （#1357 同症状台账排除数据层时的盲区）。收口＝事务性 onsuccess 的 .result 读取统一过
  // reqResultSafe：抛了就计一只只读数（__xyIdbBrokeN，诊断单打印）并按各点既有语义判
  // 「这一发没落地」（主读路径立刻换连接重试一发，不再等满等待窗）。判据只问「这一发完成
  // 没有」一个事实，零机型／零 UA 分支。
  try { window.__xyIdbBrokeN = window.__xyIdbBrokeN || 0; } catch (e0) {} // #1466：只读计数启动即置 0（诊断单打印用）
  function reqResultSafe(rq) {
    try { return { ok: true, v: rq.result }; }
    catch (eBroke) {
      try { window.__xyIdbBrokeN = (window.__xyIdbBrokeN || 0) + 1; } catch (e0) {}
      return { ok: false, e: eBroke };
    }
  }
window.idbGet = function (key, info) {
    const ambiable = (info && typeof info === 'object') ? info : null;
    const amb = () => { if (ambiable) ambiable.ambiguous = true; };
  // ===== FIX 2026-09-28 #1360 等待窗到点 ≠ 这一发没读出来：真读还在内核里跑就别把结果丢掉
  // 整包 chat-msgs 上百 MB 级（本次报障机 IDB default:chat-msgs=102MB、localStorage 只剩 2.2MB 有损
  // 尾巴）时，下面两个超时分支只 resolve(undefined)，而那一发 get 请求其实还在内核里反序列化。上层据此
  // 得到三个后果：① 屏上只剩那条尾巴＝用户所见「记录一天比一天少」；② 每 5~15s 的重试各发一整包重读
  // （同一份 102MB 读第二遍第三遍＝堆尖峰；该机诊断「本页被系统回收过 59 次」）；③ #722 的分块迁移只挂在
  // 「整包读成功」这一条路上＝包越大越读不成、读不成永远分不了块＝永久锁死。
  // 收口＝放弃那一刻给还挂着的那一发加一个落地监听，把结果登记成一个可等的口子（window.idbLateRead），
  // 谁在等这份权威就继续等它；带天花板，真挂死的事务不会永远占着口子。判据只问「这一发完成没有」一个
  // 事实，零机型／零 UA 分支。⚠ 本批只在 run() 那两行针脚（#665a/#665c）之外加工具，针脚行一字未动。
  const LATE_READ_MAX_MS = 180000;
  const _late = {};
  function lateTake(k, v) {
    const e = _late[k];
    if (!e || e.done) return;
    e.done = true; delete _late[k];
    try { e.res(v); } catch (err) {}
  }
  function lateArm(k, rq) {
    const e = _late[k];
    if (!e || e.done || !rq || typeof rq.addEventListener !== 'function') return;
    try { rq.addEventListener('success', function () { let v; try { v = rq.result; } catch (err2) { v = undefined; } lateTake(k, v); }); } catch (err) {}
    try { rq.addEventListener('error', function () { lateTake(k, undefined); }); } catch (err) {}
    try { rq.addEventListener('abort', function () { lateTake(k, undefined); }); } catch (err) {}
  }
  function lateGiveUp(k, rq) {
    if (!_late[k]) {
      let res;
      const pr = new Promise(function (r) { res = r; });
      _late[k] = { p: pr, res: res, done: false };
    }
    lateArm(k, rq);
    setTimeout(function () { lateTake(k, undefined); }, LATE_READ_MAX_MS);
  }
  window.idbLateRead = function (key) {
    const e = _late[key];
    return (e && !e.done) ? e.p : undefined;
  };
    // #716：读等待窗可按值体积放大（minWaitMs>4000 才生效，其余调用方行为一字不变）——
    //   41MB 级 chat-msgs 在手机上单次读取+反序列化就超默认 4s+4s，每次尝试都超时=undefined，
    //   上层重试 6 次每次重读整包全部失败＝「正在加载聊天记录」挂很久也进不去（红米 K80 实报）。
    //   写入侧 idbSetAll 早已按字节放大超时（+2000/256KB），读取侧一直漏了同款。
    const minWait = (ambiable && typeof ambiable.minWaitMs === 'number' && ambiable.minWaitMs > 4000) ? Math.min(60000, ambiable.minWaitMs) : 4000;
    return open().then(db => new Promise((resolve) => {
      let done = false;
      let timer = null;
      function finish(val) { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(val); }
      function run() {
        try {
          const tx = db.transaction(STORE, 'readonly');
          // #1445：两条回调都是「闭包里读外层 req 变量」（`() => finish(req.result)`），而下面
          // 超时重试那一发会把 req 换成**新的、还没完结的**那个请求。旧请求迟到 success 时读到
          // 的就是新请求 ⇒ InvalidStateError: Failed to read the 'result' property from
          // 'IDBRequest': The request has not finished.（实报：page-phone，js/idb.js:237:33 ×2）；
          // 且 finish() 永不执行＝这一发读结果被丢，上层把「读不到」当「键不存在」——正是本仓
          // 反复出现的毁数链那一族。换请求前先把旧请求的这两个回调摘掉（lateArm 挂的是
          // addEventListener，不受影响，放弃等待窗之后的迟到回执照旧能投递）。
          const prev = req;
          req = tx.objectStore(STORE).get(key); // #1360：这发请求提到外层，放弃等待窗之后还要给它加落地监听
          if (prev) { try { prev.onsuccess = null; prev.onerror = null; } catch (ePrev) {} }
          req.onsuccess = () => {
            // #1466：抛了就当场判「没落地」——立刻换连接重试一发（与等待窗首次到点同形），
            // 不再让这一发既不成功也不失败地干等 4s。
            const _rG = reqResultSafe(req);
            if (!_rG.ok) {
              if (connLost(_rG.e)) dbPromise = null;
              amb();
              if (!retried) {
                retried = true;
                dbPromise = null;
                open().then(function (db2) { db = db2; run(); }).catch(function () { finish(undefined); });
                return;
              }
              finish(undefined);
              return;
            }
            finish(_rG.v);
          };
          req.onerror = () => { if (connLost(req.error)) dbPromise = null; amb(); finish(undefined); };
        } catch (e) { if (connLost(e)) dbPromise = null; amb(); finish(undefined); }
      }
      let req = null; // #1360
      let retried = false;
      timer = setTimeout(function () {
        if (done) return;
        if (!retried) {
          retried = true;
          lateGiveUp(key, req); // #1360：第一次到点也登记这一发（它才是跑得最久的那次）；重试的新事务只是加第二个证人
          // v3.25.x：重建连接再试——挂起超时多因连接已死（iOS 挂后台杀 IDB 服务），
          // 原地重试只会再等 4 秒；重开后新连接通常当场返回
          dbPromise = null;
          open().then(function (db2) {
            db = db2;
            run();
            timer = setTimeout(function () { dbPromise = null; amb(); lateGiveUp(key, req); finish(undefined); }, minWait);
          }).catch(function () { amb(); finish(undefined); });
          return;
        }
        dbPromise = null;
        amb();
        lateGiveUp(key, req); // #1360：这一发不再等人，但结果照旧登记，还挂着的人能拿到
        finish(undefined);
      }, minWait);
      run();
    })).catch(() => { amb(); return undefined; });
  };

  // v3.5.117：批量读取（单事务内多个 get，替代 N 次独立事务）——
  //   启动回填头像/图标/壁纸等几十个键时，从"几十次事务排队"降到"1 次事务"，
  //   手机端明显提速（每张图一个独立事务是桌面图片加载慢的主因之一）
  // v3.10.x：超时保护（与 idbGet 同款 4s+4s）——部分安卓内核（真我/荣耀 Edge 等）
  //   批量事务可能挂起（既不 onsuccess 也不 onerror），idbRestore 分批恢复链会整条
  //   卡死：12s 保险丝放行开屏后剩余键永远不回填，桌面头像/卡片背景/页面背景全部
  //   "丢失"。现在 4s 未完成对未返回的键重试一次（新事务），再 4s 放弃并返回已收到
  //   的部分结果，批次链继续走完。
  window.idbGetMany = function (keys) {
    const list = (keys || []).filter(Boolean);
    if (!list.length) return Promise.resolve({});
    return open().then(db => new Promise((resolve) => {
      const out = {};
      let done = false;
      let timer = null;
      let retried = false;
      const finish = () => { if (!done) { done = true; if (timer) clearTimeout(timer); resolve(out); } };
      function run(ks) {
        try {
          const tx = db.transaction(STORE, 'readonly');
          const os = tx.objectStore(STORE);
          let pending = ks.length;
          ks.forEach(k => {
            const req = os.get(k);
            req.onsuccess = () => { const _rM = reqResultSafe(req); if (_rM.ok) out[k] = _rM.v; if (--pending <= 0) finish(); }; // #1466：被打穿的那格按「未返回」处理，交给既有重试腿补读
            req.onerror = () => { if (connLost(req.error)) dbPromise = null; if (--pending <= 0) finish(); };
          });
          tx.onerror = () => { if (connLost(tx.error)) dbPromise = null; finish(); };
          tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; finish(); };
        } catch (e) { if (connLost(e)) dbPromise = null; finish(); }
      }
      timer = setTimeout(function () {
        if (done) return;
        if (!retried) {
          retried = true;
          const miss = list.filter(k => !(k in out));
          if (!miss.length) { finish(); return; }
          run(miss);
          timer = setTimeout(function () { dbPromise = null; finish(); }, 4000);
          return;
        }
        dbPromise = null;
        finish();
      }, 4000);
      run(list);
    })).catch(() => ({}));
  };

  // 只读探测通用骨架（4s 未返回 → 重建连接重试一次 → 再 8s 判失败）
  // 部分安卓内核（真我/荣耀/小米 Edge 等）事务可能挂起：既不 onsuccess 也不 onerror，
  // 没有超时兜底，调用方的 Promise 就永不落地（诊断里「IndexedDB 大键明细」停在「读取中…」）。
  // run(db, finish) 内用 finish(结果) 落地；失败/超时一律 resolve(IDB_LIST_FAILED)。
  // v3.26.x #90：IDB_LIST_FAILED 是这条链的关键——旧实现超时后 resolve 空数组，与
  // 「库里真的没有」不可区分，上层（chat.js 判定「这台桌面没有聊天记录」）就把一次
  // 读取失败当成真的没历史，接着把新消息整包写回 → 全部历史被覆盖且不可逆。
  const IDB_LIST_FAILED = null;
  function idbProbe(run) {
    return open().then(db => new Promise((resolve) => {
      let done = false;
      let timer = null;
      let retried = false;
      function finish(val) { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(val); }
      function attempt(conn) {
        try { run(conn, finish); } catch (e) { if (connLost(e)) dbPromise = null; finish(IDB_LIST_FAILED); }
      }
      timer = setTimeout(function () {
        if (done) return;
        if (!retried) {
          retried = true;
          // 挂起多因连接已死（iOS 挂后台杀 IDB 服务 / Edge 回收后台进程），重开通常当场恢复
          dbPromise = null;
          open().then(function (db2) {
            timer = setTimeout(function () { dbPromise = null; finish(IDB_LIST_FAILED); }, 8000);
            attempt(db2);
          }).catch(function () { finish(IDB_LIST_FAILED); });
          return;
        }
        dbPromise = null;
        finish(IDB_LIST_FAILED);
      }, 4000);
      attempt(db);
    })).catch(() => IDB_LIST_FAILED);
  }

  // 列出所有键（严格版）：数组 = 权威清单（空数组 = 确认空库，可信）；null = 这次没读到。
  // 凡是要用「清单里没有」推出「键不存在」的判定，都必须走它（或 idbHasKey），
  // 拿到 null 只能当「未知」——安排重试，绝不落盘覆盖。
  window.idbListKeys = function () {
    return idbProbe(function (db, finish) {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => { const _rL = reqResultSafe(req); finish(_rL.ok ? (_rL.v || []) : IDB_LIST_FAILED); }; // #1466：抛了照 onerror 口径＝「这次没读到」，三态语义不变
      req.onerror = () => { if (connLost(req.error)) dbPromise = null; finish(IDB_LIST_FAILED); };
      tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; finish(IDB_LIST_FAILED); };
    });
  };

  // 单个键是否存在：count(键) 只数一条，比全量清单轻得多（MB 级大键写入排队时也挤得进去）
  // true = 确认存在 / false = 确认不存在 / null = 这次没读到（不可据此判空）
  window.idbHasKey = function (key) {
    if (!key) return Promise.resolve(IDB_LIST_FAILED);
    return idbProbe(function (db, finish) {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count(key);
      req.onsuccess = () => { const _rH = reqResultSafe(req); finish(_rH.ok ? ((_rH.v || 0) > 0) : IDB_LIST_FAILED); }; // #1466：同上，存在性三态不变
      req.onerror = () => { if (connLost(req.error)) dbPromise = null; finish(IDB_LIST_FAILED); };
      tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; finish(IDB_LIST_FAILED); };
    });
  };

  // 兼容旧调用方（扫描/清理类：读不到时「什么都不做」是安全方向）：失败仍折叠成空数组
  window.idbGetAllKeys = function () {
    return window.idbListKeys().then(function (keys) { return keys || []; });
  };

  // 删除
  // v3.26.x：删除挂起超时——与 idbSet/idbGet 同款。原实现裸奔：事务挂起（既不
  // oncomplete 也不 onerror）时 Promise 永不 resolve，data-backup.js 的快照清理
  // 复核链卡死，几百 MB 遗留副本历经多次启动仍在。现 4s 未完成即判挂起 → 重建
  // 连接重试（最多 3 次），让 purgeLegacySnapshot 的复核能落地。
  window.idbDelete = function (key) {
    function tryOnce() {
      return open().then(db => new Promise((resolve) => {
        let done = false;
        const t = setTimeout(function () {
          if (done) return; done = true;
          dbPromise = null;
          resolve(false);
        }, 4000);
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => { if (done) return; done = true; clearTimeout(t); resolve(true); };
          tx.onerror = () => { if (done) return; done = true; clearTimeout(t); if (connLost(tx.error)) dbPromise = null; resolve(false); };
          tx.onabort = () => { if (done) return; done = true; clearTimeout(t); if (connLost(tx.error)) dbPromise = null; resolve(false); };
        } catch (e) { if (done) return; done = true; clearTimeout(t); if (connLost(e)) dbPromise = null; resolve(false); }
      })).catch(() => false);
    }
    return (async () => {
      let ok = await tryOnce();
      if (!ok) { await new Promise(r => setTimeout(r, 100)); ok = await tryOnce(); }
      if (!ok) { await new Promise(r => setTimeout(r, 100)); ok = await tryOnce(); }
      return ok;
    })();
  };

  // 清空全部键（"清除所有数据"用）：不删库，避免连接占用导致 blocked
  window.idbClearAll = function () {
    return open().then(db => new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => { if (connLost(tx.error)) dbPromise = null; resolve(false); };
        tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; resolve(false); };
      } catch (e) { resolve(false); }
    })).catch(() => false);
  };

  // 真删库（应用内「清除本地数据」用）：关闭现有连接后 deleteDatabase 彻底删除
  // mochi-db（连文件一起移除）。比 idbClearAll（仅 clear store）更彻底：
  // 数据量大/连接挂起时 clear 事务可能静默失败（返回 false 或超时），只剩
  // localStorage 被清、IndexedDB 残留，启动时 idbRestore 又把残留全量回填——
  // 手机端「清除本地数据等于没清除」（用户反馈专属字卡没了但其余内容复活）。
  // 删库成功后 reopen 会经 onupgradeneeded 重建空 store，idbRestore 无可回填。
  window.idbDestroy = function () {
    return new Promise((resolve) => {
      let settled = false;
      const fin = (ok) => { if (settled) return; settled = true; resolve(ok); };
      try {
        // 关闭并释放现有连接，否则 deleteDatabase 会因连接占用阻塞（onblocked 永不落地）
        if (dbPromise) {
          dbPromise.then(d => { try { d.close(); } catch (e1) {} }).catch(() => {});
          dbPromise = null;
        }
        if (!window.indexedDB) { fin(false); return; }
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => fin(true);
        req.onerror = () => fin(false);
        // onblocked = 仍被其它进程连接占用（旧标签页/旧 SW 也在开本库）。不设为失败，
        // 交给下方超时兜底，让调用方有时间清完其它标签页后本请求落地。
        req.onblocked = () => {};
        // 兜底：blocked/挂起时最长等 6s，之后判失败交由调用方退回 idbClearAll
        setTimeout(() => fin(false), 6000);
      } catch (e) { fin(false); }
    });
  };

  // v3.6.x：原子替换全部键（导入备份用）——单事务内 clear() + 批量 put()。
  // 事务成功 = 全部替换完成；任一步失败/中止 → 整个事务回滚，store 保持事务开始前的
  // 旧数据。这取代「先 idbClearAll 清空、再逐条 idbSet」的导入流程——原流程清空与写入
  // 之间有几分钟无原子窗口，中途崩溃/杀进程会留下半空库，旧数据无法恢复。
  // 注意：不可克隆值（函数等）会让 put 同步抛 DataCloneError——必须捕获后主动 abort
  // 事务（否则同步异常只跳过该次 put，已排队的 clear/put 仍会提交，等于部分替换）。
  // entries: [{ k, v }, ...]；返回 Promise<boolean>（true=全部替换成功）
  window.idbReplaceAll = function (entries) {
    const list = (entries || []).filter(e => e && e.k !== undefined && e.k !== null);
    if (!list.length) return window.idbClearAll();
    return open().then(db => new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const os = tx.objectStore(STORE);
        let bad = false;
        os.clear();
        try {
          list.forEach(e => { os.put(e.v, e.k); });
        } catch (e) {
          bad = true;
          try { tx.abort(); } catch (e2) {}
        }
        tx.oncomplete = () => resolve(!bad);
        tx.onerror = () => { if (connLost(tx.error)) dbPromise = null; resolve(false); };
        tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; resolve(false); };
      } catch (e) { resolve(false); }
    })).catch(() => false);
  };

  // 存储适配层：各模块统一用它读写（接口与原 store 一致）。
  // IndexedDB 是权威持久层；localStorage 只是快速快照（配额满/隐私模式写失败也不丢数据——
  // 启动时从 IDB 恢复）；内存缓存兜底 localStorage 缺失的键。
  // v3.5.92：大键（>200KB，如头像池/壁纸/朋友圈背景等图片 dataURL）只写 IndexedDB，
  //   不写 localStorage——手机 5MB 配额不再被几十 MB 图片撑爆，大数据全进 IDB（配额大得多）
  const LS_BIG_LIMIT = 200 * 1024;
  let memoryCache = null;

  // v3.14.x：大键尺寸索引（OOM 防线之一）——启动回填前就能知道哪些键 >200KB，
  // 从而把大键单独逐批流式恢复（避免多个 MB 级字符串同批读入叠加峰值），
  // 并对大键驻留总量设预算上限（重度数据用户在手机上曾因回填把堆推到
  // 渲染进程上限直接崩溃，见 tools/diag-oom-repro.mjs 复现）。
  // 索引本身是极小的 JSON（只有键名+长度），存 localStorage；旧数据没有索引时
  // 回填会在读到实际值后自愈补记。键名带 __ 前缀，idbRestore 不回填它。
  const BIG_IDX_KEY = 'xy-home-v2:__big-idx';
  function bigIdxLoad() {
    try { return JSON.parse(localStorage.getItem(BIG_IDX_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  let _bigIdx = bigIdxLoad();
  // #907：LS 大键残留清扫——_bigIdx 记的键（写入时 >200KB）在 xyStore.set 里已 removeItem，
  // 但历史遗留（小于阈值时写进 LS、后来涨过阈值且此后没再写过的键）会永久残留：既双倍计算
  // 又长期占着 5MB LS 配额（设备诊断「LS 残留大键」告警源，实测某机 fav-msgs 306KB 残留）。
  // 大键新值只进 IDB，LS 副本必为旧值 → 启动时按索引清扫一次是安全的。
  try {
    Object.keys(_bigIdx).forEach(function (k) {
      try { if (localStorage.getItem(k) !== null) localStorage.removeItem(k); } catch (e) {}
    });
  } catch (e) {}
  let _bigIdxSaveTimer = null;
  function bigIdxSave() {
    if (_bigIdxSaveTimer) return;
    _bigIdxSaveTimer = setTimeout(function () {
      _bigIdxSaveTimer = null;
      try { localStorage.setItem(BIG_IDX_KEY, JSON.stringify(_bigIdx)); } catch (e) {}
    }, 300);
  }
  function bigIdxTrack(key, v) {
    const big = typeof v === 'string' && v.length > LS_BIG_LIMIT;
    if (big) {
      if (_bigIdx[key] !== v.length) { _bigIdx[key] = v.length; bigIdxSave(); }
    } else if (_bigIdx[key] !== undefined) {
      delete _bigIdx[key]; bigIdxSave();
    }
  }

  // ===== FIX 2026-09-21 #950 表情包大包数组直存的内存驻留口 =====
  // xyStore.set 按字符串设计（非字符串会被 localStorage.setItem 强转成垃圾串、bigIdx 误判），
  // 大包数组直存后不能走它。idbMemoSet 只做两件事：把值（可为数组对象）驻进 memoryCache
  // （同会话 store.get 立即可见，跨桌面合并等读端拿到最新），并按估算体积维护 big-idx
  // （大键流式恢复/驻留预算仍认得它）。不写 LS、不写 IDB、不进写日志——持久化由调用方的
  // idbSet 负责。值体积估算与 idbSet 同一套递归（字符串计长、嵌套数组/对象下钻、深度封顶）。
  window.idbMemoSet = function (key, value) {
    if (!key) return;
    if (!memoryCache) memoryCache = {};
    memoryCache[key] = value;
    try {
      let n;
      if (typeof value === 'string') n = value.length;
      else {
        const est = (v, d) => {
          if (typeof v === 'string') return v.length;
          if (!v || typeof v !== 'object') return 32;
          if (d > 4) return 64;
          let s = 0;
          if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) s += est(v[i], d + 1); return s + 16; }
          for (const kk in v) { try { s += est(v[kk], d + 1); } catch (e2) {} }
          return s + 64;
        };
        n = est(value, 0);
      }
      if (n > LS_BIG_LIMIT) { if (_bigIdx[key] !== n) { _bigIdx[key] = n; bigIdxSave(); } }
      else if (_bigIdx[key] !== undefined) { delete _bigIdx[key]; bigIdxSave(); }
    } catch (e) {}
  };

  // v3.16.x：localStorage「写失败脏键」集合——set 时 localStorage.setItem 抛异常
  // （配额满/隐私模式）说明 LS 快照残留旧值，回填时这些键必须信 IndexedDB 而不是 LS。
  // 持久化双份：sessionStorage（同标签页刷新有效）+ IndexedDB 的 __ls-dirty 键
  // （跨浏览器重启仍有效——配额满/隐私模式通常持续，只有 IDB 是可靠源，用它记住
  // 哪些键的 LS 是坏的，回填时避开，不破坏 v3.16.x「IDB 权威」语义）。
  // FIX 2026-09-29 #1443b：把「本场 localStorage 写不写得进」升成一个当场可证的事实，不再逐键猜。
  //   旧口径只有【某一枚键的那一发 setItem 恰好抛过】才把它标进「LS 不可信」集合（lsDirtyAdd）。
  //   一台 LS 整域已满、每一次写都抛的机器（iPhone 12 Pro／iOS 17.1.1 主屏幕模式；诊断单：整域 3187 键
  //   ≈6.1MB、1 字节写探针直接 QuotaExceededError、本页被系统回收 26 次）上，只要某一本账自配额满
  //   之后没人再写过，它那本【冻结在旧时刻的 LS 快照】就永远「没标脏」⇒ 回填照「LS 有值且没标脏＝
  //   LS 最新」把库里那份更新整包换成旧包（retainValue／idbHydrateKey 两处），收藏就这样凭空少一截
  //   （同屏读数：fav-msgs LS 311.7KB < IDB 328.4KB；另一桌面 162.0KB < 175.9KB——LS 一律更小）。
  //   #1335 已把这句话写在写日志上（「落不了盘的账本不能算最近一次写入」），这一批推广到整层 LS。
  //   判据仍是「这一枚 setItem 抛没抛」一个内核事实，零机型／零 UA 分支；LS 写得进的机器探针必然
  //   成功 ⇒ 旧行为一个字不变。量法沿用 #1335c 的教训：拿一个【新键名】试写（原样写回同一枚键是
  //   0 字节增量的无操作、配额满也不抛，实测过），写完立刻撤掉，健康机器上不留痕迹。
  let _lsWriteDead = null;
  function lsWriteDead() {
    if (_lsWriteDead !== null) return _lsWriteDead;
    _lsWriteDead = false;
    const pk = 'xy-home-v2:__ls-alive-probe';
    try { localStorage.setItem(pk, 'mochi-ls-alive-probe-1'); } catch (e) { _lsWriteDead = true; }
    try { localStorage.removeItem(pk); } catch (e2) {}
    return _lsWriteDead;
  }
  function lsWriteDeadReset() { _lsWriteDead = null; } // #1443c：剥完残留腾出配额后让下一问重新试写
  // 这一枚键的 LS 快照还能不能充当「最近一次写入」：逐键脏标记 或 整层写不进，任一成立都不可信
  function lsUntrusted(k) {
    if (lsWriteDead()) return true;
    return !!(_lsDirtyKeys && _lsDirtyKeys.has(k));
  }
  window.xyLsWriteDead = lsWriteDead; // 只读探针：诊断单与清扫侧共用这一把尺
  const LS_DIRTY_KEY = 'xy-home-v2:__ls-dirty';
  let _lsDirtyKeys = null;
  try {
    const s = sessionStorage.getItem(LS_DIRTY_KEY);
    if (s) { const arr = JSON.parse(s); if (Array.isArray(arr)) _lsDirtyKeys = new Set(arr); }
  } catch (e) {}
  function lsDirtySave() {
    const arr = _lsDirtyKeys ? Array.from(_lsDirtyKeys) : [];
    try { sessionStorage.setItem(LS_DIRTY_KEY, JSON.stringify(arr)); } catch (e) {}
    try { if (window.idbSet) window.idbSet(LS_DIRTY_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function lsDirtyAdd(k) {
    if (!_lsDirtyKeys) _lsDirtyKeys = new Set();
    _lsDirtyKeys.add(k);
    lsDirtySave();
  }
  function lsDirtyDel(k) {
    if (_lsDirtyKeys && _lsDirtyKeys.delete(k)) lsDirtySave();
  }

  // FIX 2026-09-27 #1349a：大键同步读口的「这一场没人把它读回来」名册（判据零机型／零 UA）
  //   #1195e 切后台时按体积放掉 memoryCache 里的大键副本，注释里承诺「回前台后首次读自动回填」——
  //   那一句只对 idbGet 成立：xyStore.get 只认内存缓存与 localStorage，而 IDB-only 大键这两份恰好
  //   都没有（>200KB 的值在 set 里被主动 removeItem）。于是放掉之后同步口读到的 null，与「用户真的
  //   没有这条数据」长得一模一样，而且整场不会自愈（荣耀畅玩40Plus／夸克实报「后面添加的头像，头像
  //   库里不知道为什么直接清空」＝打开相册选文件本身就是一发切后台）。纯 HEAD 产物无头实测：切一次
  //   后台后 store.get 读 NULL、3 秒后仍 NULL，而库里那 30 条完好；页面按「池子是空的」做一次最正常
  //   的追加并整包写回 ⇒ 库里剩 1 条。
  //   名册只收一个当场事实：#1195e 真放掉过的那几键（启动预算挂起那一格为什么刻意不在册，见下方
  //   bigKeyBlind 的批注）。启动回填还没轮到的键一律不碰 ⇒ 不与 #785 的就绪时序抢跑、不重复读；
  //   释放动作本身一字未动（那是 iOS 内存压力下的正解，#1197d/#1271/#1300 三批都指着它）。
  var _memoBlind = {};            // 键 -> true＝在册待问 / 'fly'＝已踢一趟，不叠发
  function bigMissRehydrate(key) {
    if (_memoBlind[key] === 'fly') return;
    _memoBlind[key] = 'fly';
    try {
      bigHydAsk(key).then(function (st) {
        // 问不出结果（读失败／超时）＝这一格还没裁决，摘标允许下一读再问一趟；'ok'/'absent' 都是
        // 当场问到的事实，不再重复问（问库那条腿与 #1218 共用 bigHydAsk 合流，见下方 #1349i）。
        if (st === 'unknown') delete _memoBlind[key];
      }, function () { delete _memoBlind[key]; });
    } catch (e) { delete _memoBlind[key]; }
  }
  // 只认「这一场这一格被 #1195e 真放掉过」这一个当场事实。启动预算挂起（__xyIdbDeferredKeys）那一格
  // 刻意不在这里补踢：那条路上 #1218/#1258/#172 各消费方本来就按「每个命名空间每会话只踢一趟」在问库
  // （#1258d 的不变量），数据层再补一脚＝同一个 MB 级原图被读两遍、邻居当场报红（实测 32/0→29/3）。
  // 头像池这类「读回来还要整包写回去」的通路，那一格由消费方自己的证人闸门兜（#1349d~h）。
  // FIX 2026-09-30 #1469t：这一腿也要认「健康连接已经确认库里没有」。#1361a 给 _bigIdx 那位证人写的
  //   处置（只有 bigHydAbsent 才作废证人）当年没同步落到 _memoBlind 这一腿上，于是「被 #1195e 放掉过、
  //   而库里其实已经没有这一键」的机器会永久停在「这一格读不回来」：#1342i 的写回闸与 #1469 的
  //   「删除／清空按住并提示」都被它焊死（新尺丁7 实测连按 8 轮全是那句提示，三态那一问早已回答
  //   'absent'，_memoBlind 那一格却还挂着 'fly'）。判据仍是当场事实（这一问有没有问出结果），
  //   零机型／零 UA 分支；库里真回来的那一格（'ok'）不受影响。
  const bigHydAbsent = {};     // 完整键名 -> 健康连接确认库里确实没有（本会话不再空读）#1469t：搬到此处的 _memoBlind 之前，同模块内先声明再问，不留 TDZ
  function bigKeyBlind(key) { return !!_memoBlind[key] && !bigHydAbsent[key]; }
  // ===== FIX 2026-09-27 #1342：「同步读空」不是答案——写回侧那一句问话 =====
  // #1349 已经把「这一格被 #1195e 放掉过」记进 _memoBlind 并在首次读空时补踢一趟（名册与合流都用
  // 它那一份，本批不另起第二套、也不挂第二脚）。本批补的是它的**下一环**：读数没回来之前，
  // 谁都不许拿这一格空账做「整本写回」。四本「美化方案」账（beauty-schemes／full-beauty-schemes／
  // chat-beauty-schemes／gc-beauty-schemes）写法清一色 `JSON.parse(store.get(K) || '[]')` → 改 →
  // `store.set(K, 整本)`，而这些都是 IDB-only 大键（>200KB 从不落 LS）⇒ 冷读那一发正好把库里那本
  // 顶成一格（iPhone／iOS 16.6 实报「美化方案无法保存，重新刷新过后数据会被清除」；红侧实测
  // 库里 20 条 → 一次最普通的保存 → 1 条 → 重开仍 1 条）。#1335 的 ③④ 与 #1336 点过名的
  // 「personalize 那几处逐页读-改-写还没接尺子」，收口就在这一个口上。
  // 判据只有两个当场事实：①这一格现在读不到值（内存与 LS 双双为空）；②它要么在 #1349 的
  // 「被放掉过」名册里，要么还挂在 #975 启动回填的挂起名单 __xyIdbDeferredKeys 上（本批刻意把
  // 后者也算进来——#1349 只兜前者，而方案账这一族在挂起名单里同样会被整本写回顶掉）。
  // 零机型／零 UA 分支。写过即放行（set 无条件写内存缓存 ⇒ ①当场不成立），不把这道闸变成新的存不进去。
  function bigReadUnconfirmed(key) {
    if (memoryCache && (key in memoryCache)) return false;
    try { if (localStorage.getItem(key) !== null) return false; } catch (e) { return true; }
    if (bigKeyBlind(key)) return true;
    var di = window.__xyIdbDeferredKeys;
    if (Array.isArray(di) && di.indexOf(key) >= 0) return true;
    // FIX 2026-09-28 #1361a：第三格证人——上面两本账（#1195e 的「被放掉过」名册、#975 的启动挂起名单）
    // 都活在**本页这一场**的内存里。而荣耀 X70／Edge 153 这类机器一页要被系统回收 200 次（报障件
    // 【保活现场】逐字写着「本页被系统回收过 200 次」）＝每一次冷启动两本账都从零开始，这一格就永不成立：
    // IDB-only 大键（>200KB 的值在 xyStore.set 里被主动 removeItem）此刻内存＋LS 双读空，同步口照旧
    // 谎报「没有」。可库里那份的证人 __big-idx 就躺在 localStorage 里，回收杀不掉它、#1195e 释放刻意
    // 不清它、xyStore.remove 与小值写回才同步销账——它说这一格本该有一份 >200KB 的副本，而这里读空
    // ＝「没读到」不是「没有」，这一格不许整包写回。判据仍是当场事实，零机型／零 UA 分支。
    // 只有健康连接确认过库里真没这一键（bigHydAbsent）才作废这个证人，否则一次 IDB 挂起会把闸永久焊死
    // 在「不许写」上＝#1342 那条「不把这道闸变成新的存不进去」的约束照旧管着这一格。
    if (typeof _bigIdx[key] === 'number' && _bigIdx[key] > LS_BIG_LIMIT && !bigHydAbsent[key]) return true;
    // FIX 2026-09-28 #1361m：第四格＝启动回填这一发还没落定（直接沿用 #785 现成的数据就绪三态
    // mochiDataPending，它自带 2 分钟上限＝永不把这道闸焊死成「存不进去」）。上面三把证据都只认
    // **「这一格本该有一份 ≥200KB 的副本」**，于是对**小键**这一型天生看不见：收藏包／字卡库被
    // #139/#142 压缩与令牌化压回 200KB 以下之后就不再有证人，而 LS 那份照样可能不在——配额满时
    // setItem 抛掉（这台报障机整域 8.7MB／1388 键、最大单键 chat-msgs 3.7MB）、或回收前最后一次
    // 同步写根本没落盘。此时同步读数 null ＋ 库里那本还在回填队列里排队 ⇒ 「没读到」不是「没有」。
    // 这台机的现状正是这一型：诊断里 default:cc-groups 只剩 228B、公用 21.6KB，两本都在 200KB 以下。
    // 判据仍是当场事实（回填状态），零机型／零 UA 分支。
    if (window.mochiDataPending && window.mochiDataPending()) return true;
    return false;
  }

  // FIX 2026-09-27 #1342i：「读空未确认 ⇒ 这一格不许整包写回」这句判断＋这一句提示，全站只留一份。
  // 四本方案账做的都是同一件事：JSON.parse(store.get(K) || '[]') → 改 → store.set(K, 整本)。判据与
  // 文案若各写一份，就是 #1335 那条「一条通路喂坏四个页面、逐页补闸＝覆盖式修补」的反面教材——
  // 所以调用方只调这一句，`what` 只负责说清是哪本账。零机型／零 UA 分支。
  // FIX 2026-09-30 #1469：多收一个可选 forced 位——消费方自己那枚「本地这份是写失败留下的旧账」残缺判据
  //   （信箱的 mailReadIncomplete）也要走**同一句**判断＋**同一句**文案，不再在业务侧另写一份提示。
  //   forced 为真＝跳过 awaitingBigKey 那一问直接认「这一发读不全」；请求库值与提示两条腿一字不变，
  //   老调用方（不传第四参）行为逐位不变。零机型／零 UA 分支。
  window.xyBigWriteBlocked = function (store, key, what, forced) {
    try {
      if (!forced && (!store || typeof store.awaitingBigKey !== 'function' || !store.awaitingBigKey(key))) return false;
    } catch (e) { return false; }
    try { if (store.requestBigKey) store.requestBigKey(key); } catch (e3) {}
    if (window.toast) { try { window.toast((what || '这份数据') + '这次没读全（存储正忙）：等几秒再点一次即可，不需要重新设置'); } catch (e2) {} }
    return true;
  };
  // FIX 2026-09-28 #1361b：同一句判断的**静默**版，给没有任何用户动作的自动写入方（TA 自动收藏别人的
  // 动态、梦角自由造句自动入库……）。这些通路没有「请用户再点一次」可说：弹提示＝凭空冒出来的话，
  // 硬写＝用一发空读数顶掉库里那本账（＝用户看到的「莫名其妙被清空」）。所以只拦不下＋顺手请一次库
  // （复用 #1349 那只单次飞行闸），让调用方自己决定让路还是暂存。判断仍然只有一份＝数据层的那一句
  // awaitingBigKey（#1342d），本函数不另起第二把尺。零机型／零 UA 分支。
  window.xyBigWriteHold = function (store, key) {
    try {
      if (!store || typeof store.awaitingBigKey !== 'function' || !store.awaitingBigKey(key)) return false;
    } catch (e) { return false; }
    try { if (store.requestBigKey) store.requestBigKey(key); } catch (e3) {}
    return true;
  };
  // FIX 2026-09-28 #1361n：整包读-改-写的账在落笔前真正该问的不是「这一格是不是大键」，而是「这一发
  // 的空读有没有权威可言」。xyBigWriteHold 那三格证据（名册／挂起名单／大键证人）都只认「该有一份
  // ≥200KB 的副本」，于是对两种真实形状天生失明：①收藏包／字卡库被压缩与令牌化压回 200KB 以下；
  // ②启动回填整轮 bail out（idbListKeys 读失败时 restore 照样 finish→就绪，可一个键都没灌回来）。
  // 这两种情况下同步读空照样被当成「没有」＝照样清库。本函数把话说到根上：**读数非空一律放行；
  // 读空就不许直接落笔**——调用方必须先去库里问一趟（三态里只有 'absent'＝健康连接确认库里真没这一键，
  // 才允许把「空」当成答案，那正是 #1218/#1349 已经认下的口径）。零机型／零 UA 分支。
  window.xyPackageEmptyRead = function (store, key) {
    try { return !!store && store.get(key) === null; } catch (e) { return true; }
  };
  // #1342f 取证出口（只读、零副作用）：这一场被放掉过几格、还有几格读空没问出结果。
  // 报障件里「方案没了／壁纸重开就空」从来不留任何痕迹——加了这一行才分得清「库里真没有」
  // 与「取回还在路上／问不出结果」两种完全不同的现场。
  window.__xyBigReadDiag = function () {
    try {
      var blind = 0, fly = 0;
      for (var bk in _memoBlind) {
        if (!Object.prototype.hasOwnProperty.call(_memoBlind, bk)) continue;
        if (_memoBlind[bk] === 'fly') fly++; else blind++;
      }
      var di = Array.isArray(window.__xyIdbDeferredKeys) ? window.__xyIdbDeferredKeys.length : -1;
      var un = 0;
      for (var uk in _memoBlind) {
        if (Object.prototype.hasOwnProperty.call(_memoBlind, uk) && bigReadUnconfirmed(uk)) un++;
      }
      return { blind: blind, asked: fly, deferred: di, unconfirmed: un };
    } catch (e) { return null; }
  };

  window.xyStore = function (prefix) {
    return {
      get(k) {
        const key = prefix + ':' + k;
        // v3.16.x：内存缓存优先——localStorage 只是快速快照，配额满/隐私模式/存储异常时
        // setItem 静默失败，localStorage 会残留旧值；若 get 仍优先读它，memoryCache/IDB 里
        // 的新值被永久遮蔽（典型表现：换头像后聊天页顶部/气泡不更新，刷新、回前台重刷都不恢复）。
        // memoryCache 只在本会话写入（set 无条件写最新值；idbRestore/idbHydrateKey 回填 IDB
        // 权威值且跳过已有键），新鲜度恒 >= localStorage，优先读它保证「已写入的新值立即可见」。
        if (memoryCache && key in memoryCache) return memoryCache[key];
        try { const v = localStorage.getItem(key); if (v !== null) return v; } catch (e) {}
        // FIX 2026-09-27 #1349a：内存与 LS 双双读空 ＋ 这一格在「被 #1195e 放掉过」的名册里 ⇒ 这不是
        //   「没有」，是「没读到」。当场补踢一趟按需取回（同键一次不叠发），下一读即库里权威值；本次
        //   仍返回 null，与旧行为逐字节一致＝零副作用，只是不再让这一格永久沉默到重开。
        if (bigKeyBlind(key)) bigMissRehydrate(key);
        return null;
      },
      // FIX 2026-09-27 #1342d：做「整本读-改-写」的调用方在写回前问这一句——true＝这一格现在读不到值，
      // 而名册/挂起名单说库里本该有一份，此时把整本写回去＝用一页空纸顶掉库里那本（＝用户报的「被清空」）。
      awaitingBigKey(k) { return bigReadUnconfirmed(prefix + ':' + k); },
      // FIX 2026-09-29 #1417：第五格证据——「读到了值，但那份是写失败留下的旧版」。上面四格
      //   （#1195e 放掉名册／#975 启动挂起名单／_bigIdx 大键证人／#785 回填未落定）都只认
      //   「内存＋LS 双读空」，对这种形状天生失明：双写架构里 setItem 抛 QuotaExceededError
      //   （报障机整域 10.0MB／4943 键、单次会话 213 次写入被拒）时旧值原地不动 ⇒ 同步口读到
      //   一份**看起来很正常**的旧账，库里那版被永久遮蔽（信箱实报：屏上/LS 停在 09/26 的
      //   145 封，IDB 里 150 封含当天那封回信 ⇒「后台通知说有回信、点进信箱找不到」）。
      //   判据＝数据层自己那本脏账（setItem 成功即摘、失败即挂，sessionStorage＋IndexedDB
      //   双份，#1358 回放与 #1361 大键证人已在用同一本），全站只此一份。零机型／零 UA 分支。
      lsStale(k) { return !!(_lsDirtyKeys && _lsDirtyKeys.has(prefix + ':' + k)); },
      // FIX 2026-09-27 #1342r：被拦下的那一发顺手请它去问一次库——复用 #1349 那一只单次飞行闸
      //（'fly' 不叠发）与 #1218 那条合流 bigHydAsk，绝不新挂第二脚；用户再点一次保存时值就回来了。
      requestBigKey(k) { try { bigMissRehydrate(prefix + ':' + k); } catch (e) {} },
      // FIX 2026-09-28 #1358d：光「问一次」不够——消费方还得在它回来时再画一遍。
      // 信箱／朋友圈那两页在 #1195e 切后台放掉大键内存副本之后，回前台那一发同步读交不出主键，
      // 页面就把「没读到」画成「没有」（OPPO Reno14／Edge 实报「前一秒还有，后一秒点进去突然没了，
      // 没有刷新或者更新」；无头实测同一条键：屏上 0 条＋空态宣告「还没有」，而库里 20 条完好、
      // 几百毫秒后那一份已经回到内存却没人再画一次）。
      // 本口不新挂第二脚：踢趟用 #1349 那一只单次飞行闸、取回用 #1218 那条合流 bigHydAsk；
      // 只有库里真交出整包（'ok'）才回调，'absent'（确无此键）与 'unknown'（这次问不出）都不回调——
      // 既不把「没读到」讲成「没有」，也不替「没有」作证。判据＝这一格此刻读不读得到，零机型／零 UA 分支。
      whenBigKeyBack(k, cb) {
        const full = prefix + ':' + k;
        let unconfirmed = true;
        try { unconfirmed = bigReadUnconfirmed(full); } catch (e) { unconfirmed = false; }
        if (!unconfirmed) {
          // 现在就读得到＝没什么可等的，按同一口径直接叫一声（调用方自己会画对，也不留一个永不触发的回调）
          try { if (cb) cb(); } catch (e1) {}
          return;
        }
        try { bigMissRehydrate(full); } catch (e2) {}
        try {
          Promise.resolve(bigHydAsk(full)).then(function (st) {
            if (st !== 'ok') return;
            try { if (cb) cb(); } catch (e3) {}
          }, function () {});
        } catch (e4) {}
      },
      set(k, v) {
        const key = prefix + ':' + k;
        // v3.5.111：内存缓存无条件初始化并写入——大键（壁纸/头像池等）只进 IDB + 内存、
        // 不进 localStorage；若缓存未初始化（页面刚加载、IDB 恢复未完成）就上传大图，
        // 会既不在 localStorage 也不在内存缓存，切回桌面时读空导致壁纸被清掉。
        if (!memoryCache) memoryCache = {};
        memoryCache[key] = v;
        // FIX 2026-09-27 #1335f：本会话写过这一键＝内存里这份不再是「冻结日志回放进来的旧值」，
        //   #1335d/e 那两道让位到此为止（不摘掉的话，同一会话里后一次回填会把用户刚写的值当成可疑旧值
        //   覆盖掉＝把这次的修复变成新的丢数据路径）。
        try { delete _wrjReplayed[key]; } catch (e0) {}
        try { bigIdxTrack(key, v); } catch (e) {}
        let _wrjT = null; // FIX 2026-09-25 #1257c：标记不再随写同步落——值事务提交回执到点才补记（见下方 idbSet 处与 wrjRecord 尾注）
        try { _wrjT = wrjRecord(key, v); } catch (e) {}
        // 大键跳过 localStorage（只进 IDB + 内存缓存）
        const big = typeof v === 'string' && v.length > LS_BIG_LIMIT;
        if (!big) {
          try {
            localStorage.setItem(key, v);
            lsDirtyDel(key); // 写成功 → 清除脏标记
          } catch (e) {
            lsDirtyAdd(key); // 写失败 → 标记：回填时该键以 IDB 为准
          }
        } else {
          // #907：大键写入＝多 MB 级 stringify/结构化克隆，是 iOS 上「主线程被堵住几秒」的头号嫌疑——
          // 打相位标记，供卡顿自检在 >250ms 前台冻结时点名（__mochiPhaseLog）
          try { if (window.__mochiPhase) window.__mochiPhase('idb-big:' + String(k).slice(0, 18)); } catch (e0) {}
          try { localStorage.removeItem(key); } catch (e) {}
        }
        // FIX 2026-09-25 #1257 收藏/设置「改完回来又变旧」的自愈反噬（OPPO Reno16 Chrome 实报
        //   fav-msgs LS 4.0KB vs IDB 3.9KB，多机型同现；零机型分支）：旧写法 wrjRecord 同步
        //   wrjMark——值事务提交失败（挂起内核/回收杀事务，idbSet 3 试后 resolve false）标记照落，
        //   库里留下【旧值+新标记】；下次启动 wrjMergeFromIdb 见「标记比已知写入新」就信 IDB，
        //   把 LS 里更新的真值整键覆写回旧值＝自愈通道反噬成数据回退。改：标记只在值事务
        //   最终提交回执（#1227 语义，resolve true＝oncomplete 已到）后才补记；写失败＝无新标记，
        //   合并端天然不信旧值，LS/内存里更新的那份保住。回放/合并的修复通道一字未动。
        try {
          if (window.idbSet) {
            const _p = window.idbSet(key, v);
            if (_wrjT && _p && _p.then) _p.then(function (ok) { if (ok) wrjMark(key, _wrjT); }, function () {});
            else if (_wrjT) wrjMark(key, _wrjT);
          }
        } catch (e) {}
      },
      remove(k) {
        const key = prefix + ':' + k;
        if (memoryCache) delete memoryCache[key];
        try { localStorage.removeItem(key); } catch (e) {}
        try { wrjForget(key); } catch (e) {}
        if (_bigIdx[key] !== undefined) { delete _bigIdx[key]; bigIdxSave(); }
        try { if (window.idbDelete) window.idbDelete(key); } catch (e) {}
      }
    };
  };

  // v3.26.x：导出兜底——IDB 读取失败/超时时，本会话 memoryCache 可能有最新值
  //（idbRestore 回填的大键、或本会话 xyStore.set 写入的值），供 data-backup.js 导出兜底，
  // 避免 IDB-only 大键（朋友圈/字卡等）在 IDB 事务挂起时彻底丢失。
  // #961 内存驻留体检出口（只读）——iOS 不提供 JS 堆读数，设备诊断【内存体检】段要把
  // 「谁在内存里占位」列清：memoryCache＝本会话所有读过的键（含大键数组直存的同一引用），
  // 体积对字符串取长度、对数组/对象取 big-idx 的估算值。零副作用、不读 IDB、不写 LS。
  window.idbMemoStats = function (topN) {
    try {
      if (!memoryCache) return { n: 0, bytes: 0, top: [] };
      const arr = Object.keys(memoryCache).map(function (k) {
        const v = memoryCache[k];
        const len = typeof v === 'string' ? v.length : (_bigIdx[k] || -1);
        return { k: k, len: len };
      });
      let total = 0;
      arr.forEach(function (e) { if (e.len > 0) total += e.len; });
      arr.sort(function (a, b) { return b.len - a.len; });
      return { n: arr.length, bytes: total, top: arr.slice(0, topN || 6) };
    } catch (e) { return { n: 0, bytes: 0, top: [] }; }
  };
  // #975：内存副本释放口——大键（朋友圈 feed-posts 32MB、自动备份快照 17MB…）在 memoryCache 里
  // 常驻，是 iOS「内存压力→回收页面」的主因（iPhone 17 实测常驻 66MB / 被回收 93 次）。
  // 本接口只丢内存副本（LS/IDB 持久层不动）：切后台时释放、回来按需从 IDB 重读。
  window.idbMemoDrop = function (key) {
    try {
      if (memoryCache) delete memoryCache[key];
      if (_bigIdx[key] !== undefined) { delete _bigIdx[key]; bigIdxSave(); }
    } catch (e) {}
  };
  // #1195e：把 #975 的「逐个点名释放」补成**通用闸**——切后台时按体积自动放掉所有大键的
  // 内存副本。依据是本机诊断（iPhone 17 Pro / iOS 27，v8.35）的两条实锤：
  //   ① 300s 采样里「长任务（>50ms）：无」，却有 159 次 >250ms 的前台冻结、最长 2959ms
  //      ⇒ 帧冻结**不是 JS 长任务**，是 iOS 内存压力下把整个渲染进程挂起/回收；
  //   ② 同一份报告「本页已被系统回收过 69 次」，内存体检「驻留 159 键 ≈45.7MB」，
  //      其中 phone-bg / cs-bg-item / chat-beauty-schemes 等键各占 0.7~1.9MB，且
  //      每个都是全屏底图（402×874@3x 解码后单张约 12MB 位图）。
  // 关键性质：memoryCache 是**纯缓存**——idbGet 在键不在缓存时本来就走 LS→IDB 重新读，
  // 唯一读缓存口的 data-backup.js 导出兜底在读不到时也照常从 IDB 取值。所以按体积丢缓存
  // 不改任何持久数据、不改任何读语义，回前台后首次读自动回填（唯一代价是那次读多一次
  // IDB 往返，且只在切后台时发生一次，不在任何交互帧上）。
  // 不设机型/UA 分支：iOS 回收、Android 低内存杀进程、Web 与 PWA 行为一致，判据只有体积。
  var MEMO_BG_DROP_BYTES = 256 * 1024; // 单键 ≥256KB 即在切后台时放掉；与 lsBig 同一量级
  window.idbMemoReleaseBig = function (minBytes) {
    try {
      if (!memoryCache) return 0;
      var lim = (typeof minBytes === 'number' && minBytes > 0) ? minBytes : MEMO_BG_DROP_BYTES;
      var dropped = 0;
      for (var k in memoryCache) {
        if (!Object.prototype.hasOwnProperty.call(memoryCache, k)) continue;
        var v = memoryCache[k];
        // 体积口径与 idbMemoStats 同源：字符串按长度、非字符串按 big-idx 的写入时估算值。
        // 估算拿不到（-1/缺项）时**保守跳过**——宁可不放，也不误判一个其实很小的键。
        var len = (typeof v === 'string') ? v.length : (_bigIdx[k] || -1);
        // FIX 2026-09-27 #1349a：放掉＝登记进「本场景该有却没读到」名册（释放动作与体积口径一字未动，
        //   #1197d 那根针钉的就是这一格）——xyStore.get 撞上这一格不再无声返回 null。
        if (len > 0 && len >= lim) { delete memoryCache[k]; _memoBlind[k] = true; dropped++; }
      }
      // 刻意**不**清 _bigIdx：它只存「键 → 字节数」的小账（不是那份大 payload），留着才能让
      // 下次切后台、以及设置页内存体检继续按同一口径判断这个键有多大；清掉反而丢判断依据。
      return dropped;
    } catch (e) { return 0; }
  };
  // 切后台统一跑一次。挂 visibilitychange + pagehide 双事件：pagehide 是 iOS 真正冻结/
  // 回收页面前的最后机会（此时 visibilityState 未必已翻转），visibilitychange 覆盖普通切后台。
  // 只在 idb.js 内部跑，不经各业务文件——省得每个模块各挂一个监听器（#969 常驻高频任务的教训）。
  (function () {
    var onBg = function () { try { if (window.idbMemoReleaseBig) window.idbMemoReleaseBig(); } catch (e1) {} };
    try { document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') onBg(); }); } catch (e2) {}
    try { window.addEventListener('pagehide', onBg); } catch (e3) {}
  })();
  window.idbGetCached = function (key) {
    if (memoryCache && Object.prototype.hasOwnProperty.call(memoryCache, key)) return memoryCache[key];
    return undefined;
  };

  // v3.6.x：聊天记录键判定——旧顶层键 xy-home-v2:chat-msgs + 各联系人命名空间键
  // xy-home-v2:default:chat-msgs / xy-home-v2:cxxx:chat-msgs。聊天记录有独立的 LS
  // 兜底快照机制（chat.js writeLsSnapshot ≤2MB，专属 chat.js 管理），idbRestore
  // 与大键迁移都不得动它，否则聊天记录失去唯一 LS 备份。
  function isChatMsgsKey(k) {
    if (!k || typeof k !== 'string') return false;
    if (k.indexOf('xy-home-v2:') !== 0) return false;
    const tail = k.slice('xy-home-v2:'.length);
    // FIX 2026-09-17 #127：聊天增量日志键 chat-arch 同族——它只存 IDB、由 chat.js 直读，
    // 回填进 LS/memoryCache 只会白占配额，与 chat-msgs 一并排除。
    if (tail === 'chat-arch' || /^[^:]+:chat-arch$/.test(tail)) return true;
    return tail === 'chat-msgs' || /^[^:]+:chat-msgs$/.test(tail);
  }
  // v3.42.x #426：群聊消息键（全局 xy-home-v2:group-chat-msgs / 自定义群 xy-home-v2:gc-msgs-<gid>，
  // 键名生成见 group-chat.js groupMsgKey）。与 chat-msgs 同族：IDB 权威 + LS lite 快照
  //（gcWriteMsgs 维护），大记录（>3MB）为结构化数组直存。
  function isGroupMsgsKey(k) {
    if (!k || typeof k !== 'string') return false;
    return k === 'xy-home-v2:group-chat-msgs' || /^xy-home-v2:gc-msgs-.+$/.test(k);
  }

  // ==== 2026-09-18 #785 数据就绪三态原语：把「真没有内容」与「还没回填完」在 UI 上分开 ====
  // 根因（与机型无关，是时序差）：IDB 回填快慢按数据量/机器差出一个数量级，慢机器上业务页
  // 先读到的 localStorage 就是空值。页面各自把空值陈述成终态文案（「这一天还没有内容」
  //「还没有收到信」），用户读成「数据丢了」并当 bug 报。开屏那层早就有了（12s 保险丝派发
  // mochi-restore-slow + 「仍要进入」），但全项目只有开屏一个消费者，进入应用后没有第二层。
  // 判据取时序状态而非机型/UA。
  // 回填挂起兜底：整轮 restore 永不完成时 done 永不到达，无上限的转圈比误报的「还没有」更糟，
  // 所以以启动（调 restore）时刻为锚给 2 分钟上限，超限即按权威空态陈述。
  const DATA_PENDING_CEILING_MS = 120000;
  window.mochiDataState = function () {
    if (window.__mochiDataReady) return 'ready';
    try {
      if (window.__mochiLoadT && Date.now() - window.__mochiLoadT > DATA_PENDING_CEILING_MS) return 'timeout';
    } catch (e) {}
    try { if (window.__mochiDataSlow) return 'slow'; } catch (e) {}
    return 'loading';
  };
  // 现值可能不完整：页面此时不得对用户陈述「没有内容」，应出加载占位并用 mochiOnDataReady 补渲
  window.mochiDataPending = function () {
    const s = window.mochiDataState();
    return s === 'loading' || s === 'slow';
  };
  // 只写文本的槽位（日历里情话/备忘/心情/留言各一行）用
  window.mochiLoadingText = function () { return '正在读取…'; };
  // 整块空态（列表页的 .ta-empty 位）用
  window.mochiLoadingHtml = function (what) {
    return '<div class="mochi-data-loading">' + (what || '内容') + '还在读取，稍候会自动刷新</div>';
  };
  // #1403（2026-09-29）：历史列表「当天直显、更早按月份折叠」的唯一实现。作者口径两句都要守：
  // 「不要封顶，我都要保存历史记录」＝**只改显示形状、一条数据都不裁**（不是分页也不是 slice）；
  // 「每天只显示当天的，其他记录都月份按折叠起来」＝今天平铺，更早的按「2026年8月」这样的月块默认折起。
  // 口径接 #1053（帮我决定记录），只把「更早」再切成月；样式皮直接复用 chat-pages.css 里 #1053 那组
  // 全局 .dc-h-* 类（-more/-sum/-cnt/-day/-day-label/-day-empty）⇒ 零新增 CSS、与决定记录/寻踪记录同款；
  // 折叠用原生 <details>⇒ 零 JS 展开状态要维护，也不会出现「名字在、逻辑变」那种自绘开关。
  // items: [{ts:Number, html:String}] 顺序任意（内部按新在前排）；没有 ts 的条目**不猜日期**，
  // 统一落进末尾那个月块（label「更早」），保证「折叠 ≠ 丢条目」。
  // FIX 2026-09-29 #1416：开合态不能只活在 details 节点里——每一个调用方都是整栏 el.innerHTML= 重画
  //   （来一条新抓包／新的一日常／送出礼物／切记录页 tab 都会重画），于是用户刚展开的「8 月」下一次
  //   重绘自己就收回去。同批 mail.js 早已把状态收进模块级 map（#993 统计页 stats-fold 的站内惯例），
  //   这里对齐：调用方给 opts.key（每张列表一个前缀），状态存 map，toggle 事件委托一次（toggle 不冒泡，
  //   用捕获阶段挂 document）。默认前缀 'hist' 兜住没给 key 的调用，行为不会比现在更差。
  const HIST_FOLD_OPEN = {};
  function histFoldRemember(e) {
    try {
      const el = e.target;
      if (!el || el.tagName !== 'DETAILS' || !el.getAttribute) return;
      const fk = el.getAttribute('data-hist-fold');
      if (!fk) return;
      HIST_FOLD_OPEN[fk] = el.open ? 1 : 0;
    } catch (err) {}
  }
  if (!window.__mochiHistFoldBound) {
    window.__mochiHistFoldBound = 1;
    try { document.addEventListener('toggle', histFoldRemember, true); } catch (err) {}
  }
  window.mochiHistFold = function (items, opts) {
    const o = opts || {};
    const list = (Array.isArray(items) ? items : []).filter(x => x && typeof x.html === 'string');
    if (!list.length) return o.empty || '';
    const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
    const today = dayKey(Date.now());
    const todayItems = [], months = {}, monthKeys = [];
    list.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(x => {
      const dk = x.ts ? dayKey(x.ts) : '';
      if (dk === today) { todayItems.push(x); return; }
      const d = x.ts ? new Date(x.ts) : null;
      const mk = d ? d.getFullYear() + '-' + (d.getMonth() + 1) : 'none';
      if (!months[mk]) { months[mk] = { label: d ? d.getFullYear() + '年' + (d.getMonth() + 1) + '月' : '更早', rank: d ? d.getFullYear() * 12 + d.getMonth() : -1, days: {}, dayKeys: [] }; monthKeys.push(mk); }
      const m = months[mk], key = dk || 'none';
      if (!m.days[key]) { m.days[key] = { label: d ? mochiHistDayLabel(d) : '更早', items: [] }; m.dayKeys.push(key); }
      m.days[key].items.push(x);
    });
    monthKeys.sort((a, b) => months[b].rank - months[a].rank);
    let html = todayItems.length ? todayItems.map(x => x.html).join('') : (o.todayEmpty || '');
    const fkBase = (typeof o.key === 'string' && o.key) ? o.key : 'hist';
    return html + monthKeys.map(mk => {
      const m = months[mk];
      const cnt = m.dayKeys.reduce((n, k) => n + m.days[k].items.length, 0);
      const fk = fkBase + '|' + mk;
      return '<details class="dc-h-more"' + (HIST_FOLD_OPEN[fk] ? ' open' : '') + ' data-hist-fold="' + fk + '"><summary class="dc-h-more-sum">' + m.label + '<span class="dc-h-more-cnt">' + cnt + ' 条</span></summary><div class="dc-h-more-body">' +
        m.dayKeys.map(dk => '<div class="dc-h-day"><div class="dc-h-day-label">' + m.days[dk].label + '</div>' + m.days[dk].items.map(x => x.html).join('') + '</div>').join('') +
        '</div></details>';
    }).join('');
  };
  // 月块里的日标题：昨天／前天单独点名（当天不在这儿，它是平铺那一屏），其余 M月D日、跨年补年份
  function mochiHistDayLabel(d) {
    const now = new Date(), t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const one = 864e5, d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((t - d0) / one);
    if (diff === 1) return '昨天';
    if (diff === 2) return '前天';
    const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '年' + md;
  }
  // #1403（同日追加，作者「用户又不一定要保存那么多记录。这种无限变长的记录还需要有单独的删除功能」）：
  // 折叠只解决「看着长」，这一对解决「存得多」。三条口径：
  // ① **只删「这一条」**——绝不做整表清空，也绝不靠封顶裁条（作者前一句要求「都要保存」），
  //   所以每条行内出一枚「删除」，键由调用方给（站内多数列表没有 id，用数组下标 'i'+n 就够稳：
  //   列表是追加序、删完立刻重画）。
  // ② 删除前一律走 `window.openModal`（站内唯一弹窗方案，禁 confirm()；形态抄 accounting.js:557
  //   的 `{noInput:true, staticText:…}`）并把「删的是哪一条」回显进去——用户要的「单独删」必须看得见
  //   自己删掉的是哪条，不然一次误点就是静默丢数据。
  // ③ 数据还在回填时**不许删**：那时有本地快照≠库里那份（#1330/#1359 一族），一次 splice 写回
  //   可能把没读回来的条目一起抹掉——照 accounting 的 `writable()` 口径先挡下并给一句可执行提示。
  // 按钮用行内样式：color:inherit ⇒ 明暗两套主题自动跟，零新增 CSS。
  window.mochiHistDel = function (key, label) {
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<button type="button" class="hist-del" data-hist-del="' + esc(key) + '" data-hist-label="' + esc(label) + '"' +
      ' style="float:right;margin:0 0 2px 8px;border:0;background:none;color:inherit;opacity:.42;font-size:11px;font-weight:400;padding:2px 2px;cursor:pointer">删除</button>';
  };
  // 容器上挂一次委托（重画列表不需要重挂；各页重复调用也只有一个监听）
  window.mochiHistDelBind = function (el, opts) {
    const o = opts || {};
    if (!el || el.__mochiHistDelBound || typeof o.onDel !== 'function') return;
    el.__mochiHistDelBound = 1;
    // capture 阶段拦下：心意柜这类列表里，整行自己挂了「点开详情」的监听（冒泡阶段它先跑，
    // 在容器上 stopPropagation 已经晚了＝删一条会顺手把详情弹出来）
    el.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('.hist-del') : null;
      if (!btn || !el.contains(btn)) return;
      e.preventDefault(); e.stopPropagation();
      const key = btn.getAttribute('data-hist-del') || '';
      const label = btn.getAttribute('data-hist-label') || '';
      // ③ 回填未完＝此刻的本地数组可能不是库里那份，删一条会连带抹掉没读回来的
      if (typeof window.mochiDataPending === 'function' && window.mochiDataPending()) {
        try { if (typeof window.toast === 'function') window.toast('记录还在读取，稍等一下再删'); } catch (er) {}
        return;
      }
      if (typeof window.openModal !== 'function') { try { o.onDel(key); } catch (er) {} return; }
      window.openModal(o.title || '删除这条记录？', '', function (v) {
        if (v === 'ok') { try { o.onDel(key); } catch (er) {} }
      }, { noInput: true, staticText: label ? ('「' + label + '」') : (o.what || '这一条') });
    }, true); // 捕获阶段：心意柜这类「整行本身可点开详情」的列表，必须抢在行自己的 click 之前拦下，
              // 否则一次点「删除」＝同时开了详情面板（冒泡阶段在子元素之后，拦不住）
  };
  // 真就绪后补渲一次。刻意不判页面可见性（区别于既有多处 if (!page.hidden) 闸门）——回填完成时
  // 用户不在这页，那种闸门会让该模块永久停留在加载态；隐藏页写几行文本零成本，可见页面的重渲
  // 自有各自的现读入口兜底（如 mail 的 render 开头按 hidden 早退）。
  // #785b（2026-09-19）：「已就绪直接 return」在 JS 外置化后站不住——calendar/mail/feed 及
  //   #797 接入页全是 defer 外置脚本，空库/快恢复时 mochi-restore-done 在这些脚本执行前就已
  //   派发，只挂监听会永远等不到（verify-data-loading-buffer B3/C2/D2 恒红即此根因）。现两层：
  //   ① 已就绪时 setTimeout(0) 调度一次 fn（等调用方模块求值完再跑，避开 TDZ/半初始化）；
  //   ② 监听改为常挂不再 early-return——done 之后仍会在备份导入（data-backup 触发 idbRestore）
  //   等场景再次派发，届时补渲同样是各页想要的；调用方回调皆纯重画幂等，重复派发零风险。
  window.mochiOnDataReady = function (fn) {
    if (window.mochiDataState() === 'ready') {
      try { setTimeout(function () { try { fn(); } catch (e) {} }, 0); } catch (e) {}
    }
    try {
      document.addEventListener('mochi-restore-done', function () { try { fn(); } catch (e) {} });
    } catch (e) {}
  };

  // 恢复：从 IndexedDB 读回 localStorage 缺失的键（初始化时调用）
  // v3.14.x OOM 防线（修复荣耀等安卓真机「开屏卡住→网页崩溃」）：
  //   原实现把所有键无上限读入 memoryCache 驻留——重度数据用户（几十 MB 字卡/
  //   图片键）启动回填时 JS 堆被推到渲染进程上限直接崩溃（diag-oom-repro.mjs
  //   实测 40MB 种子→堆 164MB→targetCrashed）。现改为：
  //   ① 大键（>200KB）按 __big-idx 索引提前识别，单独逐键流式恢复（不再与
  //      其他键同批叠加峰值）；旧数据无索引时读到实际值后自愈补记。
  //   ② 大键驻留总量设预算（设备内存 ≤4GB 取 12MB，否则 24MB）：超预算的键
  //      本会话不加载，记入 window.__xyIdbDeferredKeys，可用 window.idbHydrateKey(key)
  //      按需异步取回；小键行为完全不变。
  window.idbRestore = function (uidPrefix) {
    // v3.5.116：所有路径都设置就绪标志（空数据/无 IDB 也算就绪），
    //   开屏「点击进入」靠它判断，避免空数据场景误等
    let readySent = false;
    const sendReady = function () {
      if (readySent) return;
      readySent = true;
      try { window.__mochiDataReady = true; } catch (e) {}
      try { document.dispatchEvent(new Event('mochi-restore-done')); } catch (e) {}
    };
    let finished = false;
    const finish = function () {
      if (finished) return;
      finished = true;
      clearTimeout(safety);
      sendReady();
    };
    // v3.5.122：整体保险——极端情况（IndexedDB 事务挂起/设备存储异常）下
    //   12 秒后通知开屏「加载较慢」。否则 open() 或任一事务永不完成时，开屏永远
    //   「正在加载数据…」没有进入按钮（低端安卓机曾现卡死数分钟）。
    // v3.6.x：保险丝超时只放行开屏、不再截断恢复——低端机大量图片键分批恢复
    //   可能真的超过 12 秒，原逻辑会把剩余键丢弃（本会话数据缺失，只能刷新重试）；
    //   现在超时后恢复循环继续后台把剩余键补齐
    // v3.26.x：保险丝不再静默设 __mochiDataReady（原 sendReady 会让开屏「点击进入」
    //   可点，但后台回填未完成 → 用户进入后数据不全，正是"没加载完就进入"的 bug）。
    //   改为派发 mochi-restore-slow + 设 __mochiDataSlow，开屏据此显示「仍要进入」
    //   小链接让用户主动选（进入时提示数据可能不全），按钮默认仍置灰等到真就绪。
    //   不置 finished：processBatch 继续恢复，真完成时 finish() 才设 __mochiDataReady。
    const safety = setTimeout(function () {
      if (finished) return;
      try { window.__mochiDataSlow = true; } catch (e) {}
      try { document.dispatchEvent(new Event('mochi-restore-slow')); } catch (e) {}
      // 不置 finished：processBatch 继续恢复剩余键
    }, 12000);
    // v3.16.x：先恢复「LS 写失败脏键」集合（持久化在 IDB，跨浏览器重启仍有效）——
    // 必须在业务键回填之前读，回填时才能避开 LS 已损坏（残留旧值）的键、信 IDB 权威值
    // FIX 2026-09-26 #1309a：启动回填的「清单」那一发读失败，不许折叠成「库里没数据」
    //   （小米 14U/Edge 实报「信/收藏/朋友圈全没了、一直丢数据」；诊断单同屏：LS 整域 192 键 ≈10MB
    //   全是同源兄弟站点占的、站内 0 键＝localStorage 这一层在本机永久不存在，全站只剩 IDB 一份拷贝）
    //   旧写法走 idbGetAllKeys()（兼容版：失败折叠成 []），于是一发 getAllKeys 被内核中止＝
    //   「库里没数据」→ 当场 finish() 派发「数据已就绪」→ #785 三态在此说谎：各页空态从「还在读取」
    //   翻成「还没有」，同时把所有业务页「读空→照常整包写回」的口子开开（信箱 5 封→1 封即这条链）。
    //   现改取严格三态 idbListKeys()：数组＝权威清单（[]=确认空库，可信），null＝这次没读到＝未知；
    //   未知→有界退避重试（同 #1162a/feature-data、#229/wrjMerge 两处的既有口径），且重试期间
    //   一律不派发就绪（12s 保险丝照旧放行开屏并显示「仍要进入」，用户不会被钉在开屏）。
    //   判据只取「内核回没回话」这一个事实，零机型／零 UA 分支。
    let listTries = 0;
    const LIST_BACKOFF = [4000, 10000, 20000, 40000, 70000];
    const readKeyList = function () {
      return window.idbListKeys().then(function (keys) {
        if (keys !== null) return keys;
        if (finished || listTries >= LIST_BACKOFF.length) return null;
        const wait = LIST_BACKOFF[listTries++];
        try { if (window.__mochiPhase) window.__mochiPhase('restore-list-retry:' + listTries); } catch (e) {}
        return new Promise(function (r) { setTimeout(r, wait); }).then(readKeyList);
      });
    };
    Promise.all([readKeyList(), window.idbGet(LS_DIRTY_KEY)]).then(res => {
      const keys = res[0];
      try {
        const arr = JSON.parse(res[1] || '[]');
        if (Array.isArray(arr) && arr.length) {
          if (!_lsDirtyKeys) _lsDirtyKeys = new Set();
          arr.forEach(k => { if (k) _lsDirtyKeys.add(k); });
          try { sessionStorage.setItem(LS_DIRTY_KEY, JSON.stringify(Array.from(_lsDirtyKeys))); } catch (e) {}
        }
      } catch (e) {}
      // #1309a：null＝未知，绝不是「没有」——这一行是全站空态不再说谎的总闸（宁可停在「正在读取」，
      //   也不要把没读到的东西陈述成「还没有」再被下一次写入整包抹掉）
      if (keys === null) return;
      if (!keys.length) { finish(); return; }
      const need = (keys || []).filter(k =>
        k.indexOf(uidPrefix) === 0 &&
        k !== LS_DIRTY_KEY && // 脏键索引自身不回填
        k.indexOf(uidPrefix + 'music-file:') !== 0 &&
        // #142：媒体池键（xy-home-v2:media:<hash>）不回填——几百个图片键回填进
        // memoryCache/LS 等于把去重省下的内存又加倍吃回去；媒体层（media-pool.js）
        // 按哈希按需 idbGet 解析令牌，池键只存 IDB
        k.indexOf(uidPrefix + 'media:') !== 0 &&
        // v3.6.x：聊天记录不回填 localStorage——chat.js 已改为只写 IndexedDB，
        // 恢复到这里会重新占满 5MB 配额（几千条带图记录是几十 MB），且读取
        // 路径已不依赖 LS 快照（loadMsgs 直接 IDB 权威读）。
        // 修复：原 `indexOf(uidPrefix+'chat-msgs')!==0` 匹配不到命名空间键
        //（xy-home-v2:default:chat-msgs），改用 isChatMsgsKey 同时排除旧顶层键
        // 与各联系人命名空间键
        !isChatMsgsKey(k) &&
        // v3.42.x #426：群聊消息键不回填（v3.6.x chat-msgs 同款理由）——loadMsgs 直接
        // IDB 权威读，LS 有 gcWriteMsgs 自己维护的 lite 快照；回填会对 #426 起的数组
        // 直存值整包 JSON.stringify（启动期堆尖峰）并在 memoryCache 死驻留一份串化副本
        !isGroupMsgsKey(k) &&
        // v3.7.0：自动备份副本键不回填——它是 data-backup.js 写入的全量 JSON 快照，
        // 体积可能几 MB，回填到 localStorage 会撑爆 5MB 配额，且不是业务数据
        k !== 'xy-home-v2:__auto-backup-snapshot' &&
        // v3.26.x：小键写日志的每键时间戳标记不是业务数据，不回填
        k.indexOf('__wr-j:') < 0 &&
        // FIX 2026-09-18 #757 跨域改动（idb.js=AI-B 域，用户直派修 bug，已在 WORKLOG 声明）：
        //   通话进行中标记（call.js 的全局根键）不回填 localStorage——它有三路副本、语义各不相同：
        //   SS/LS 是 call.js 亲笔同步写下的「真实标记」（正常挂断必留 {ts:0} 墓碑），IDB 是兜底
        //   副本（异步墓碑可能丢失，只能按 10 分钟窗当「孤儿」处理）。这里代抄一次就把 IDB 孤儿
        //   变成看似 call.js 亲笔写的 LS 标记，「挂了之后 TA 又打来」的幽灵通话（#705 实锤）
        //   会在 6 小时墙钟窗内被续上。call.js 自己有 IDB 回读路径（recoverCall: SS→LS→IDB，
        //   IDB 档仍卡 10 分钟），不需要这里代抄。
        k !== 'xy-home-v2:call-active' &&
        k !== BIG_IDX_KEY);
      if (!need.length) { finish(); return; }
      // v3.14.x：大键驻留预算——低内存手机（deviceMemory≤4GB）更保守。
      // 重度数据用户曾因回填把堆推到渲染进程上限直接崩溃（diag-oom-repro.mjs 复现：
      // 40MB 种子→手机级堆上限下 targetCrashed），预算封顶后最坏驻留可控。
      const deviceGB = (function () { try { return navigator.deviceMemory || 8; } catch (e) { return 8; } })();
      const BIG_BUDGET = (deviceGB <= 4 ? 12 : 24) * 1024 * 1024;
      let bigBudgetUsed = 0;
      let budgetWarned = false;
      window.__xyIdbDeferredKeys = [];
      // v3.14.x：已知大键分流（__big-idx 索引）——
      //   ① 超过整个预算的键【直接不读】：读了也留不下，白制造一次 MB 级垃圾峰值
      //     （GC 时机不可控，手机上垃圾堆积本身就是崩溃源），只登记挂起；
      //   ② 其余已知大键单独成批流式恢复；未知键单键起步探路，索引自愈后下次走快路
      const neverRead = [], knownBig = [], rest = [];
      need.forEach(function (k) {
        const sz = _bigIdx[k];
        if (typeof sz === 'number' && sz > LS_BIG_LIMIT) {
          if (sz > BIG_BUDGET) neverRead.push(k);
          else knownBig.push(k);
        } else rest.push(k);
      });
      if (neverRead.length) {
        budgetWarned = true;
        neverRead.forEach(function (k) { window.__xyIdbDeferredKeys.push(k); });
        try { console.info('[mochi] 启动回填：' + neverRead.length + ' 个超大键跳过加载（单键超 ' + Math.round(BIG_BUDGET / 1048576) + 'MB 预算），需要时可用 idbHydrateKey(键名) 按需取回'); } catch (e) {}
      }
      // 返回 true=已驻留；false=超预算挂起（或本会话已写入更新值，跳过）
      function retainValue(k, v) {
        if (v === undefined || v === null) return false;
        // 本会话已写入更新值则跳过（原 v3.6.x 语义）：OPPO 雨见等 IDB 慢的浏览器上，
        // 回填未完成时收到的新数据（大键只进 IDB+内存）若被 IDB 旧快照覆盖，
        // 会出现来信弹窗已提示、信箱列表却是旧数据的错位——memoryCache 有值即最新。
        if (memoryCache && (k in memoryCache)) {
          // FIX 2026-09-27 #1335d：这一行原样时无条件让「内存里已有的值」压住库里刚读到的权威值——本意是
          //   「本会话写过的新值不许被回填遮蔽」（v3.6.x，OPPO 慢 IDB 那一族），但【冻结日志的回放】也占
          //   这一格，于是回放进来的旧值被当成了本会话的新写入，库里那条更新的大值整场会话没人应用
          //   （#1335 症状本体）。只有「日志落不了盘、且这一键确实是回放塞进来的」才让位；本会话真写过
          //   的值照旧绝不回填遮蔽——v3.6.x 那条语义一个字没动。
          if (!wrjReplayOverride(k)) return false;
        }
        // FIX 2026-09-21 #950：大包数组直存（表情包 my-emoji-groups 等）后 IDB 里的值可能是
        // 数组对象——原实现 JSON.stringify 整包＝把主线程串化从保存点挪到了启动回填点（30MB 级
        // ＝百 ms 级启动长任务）。大对象改为「按估算体积走同一条大键管线、值本身直驻
        // memoryCache」＝零串化零 parse；小对象（<200KB，老版字符串形态的键不受影响）仍串化。
        if (typeof v !== 'string') {
          const estObj = (x, d) => {
            if (typeof x === 'string') return x.length;
            if (!x || typeof x !== 'object') return 32;
            if (d > 4) return 64;
            let s = 0;
            if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) s += estObj(x[i], d + 1); return s + 16; }
            for (const kk in x) { try { s += estObj(x[kk], d + 1); } catch (e2) {} }
            return s + 64;
          };
          const nObj = estObj(v, 0);
          if (nObj > LS_BIG_LIMIT) {
            // LS 侧不存在有效副本（大键从不落 LS），无「LS 更新」遮蔽问题，直接驻对象
            try { if (_bigIdx[k] !== nObj) { _bigIdx[k] = nObj; bigIdxSave(); } } catch (e0) {}
            if (nObj > BIG_BUDGET || bigBudgetUsed + nObj > BIG_BUDGET) {
              window.__xyIdbDeferredKeys.push(k);
              if (!budgetWarned) { budgetWarned = true; try { console.info('[mochi] 启动回填：大键驻留超预算(' + Math.round(BIG_BUDGET / 1048576) + 'MB)，超出部分本会话挂起，可随时 idbHydrateKey(键名) 按需取回'); } catch (e0) {} }
              return false;
            }
            bigBudgetUsed += nObj;
            if (!memoryCache) memoryCache = {};
            memoryCache[k] = v;
            return true;
          }
        }
        let str = typeof v === 'string' ? v : JSON.stringify(v);
        // v3.16.x 修复（摸鱼天数回退等）：idbSet 是异步 fire-and-forget，页面被杀/
        // 快速退出时 IDB 事务可能未完成 → IDB 值落后于 localStorage。若回填直接用
        // IDB 旧值写 memoryCache（get 优先读它），会把用户已写入的新值遮蔽——桌面
        // 摸鱼天数等显示旧值，且后续 logFish 等「读-改-写」基于旧值追加 → 真实丢数据。
        // 规则：localStorage 有该键且未标记「LS 写失败」→ 以 LS 为准（它是最新一次
        // 同步写成功的快照）；否则（LS 缺失 / LS 写失败过）→ 用 IDB 值（v3.16.x 语义）。
        // 注意：不回写 IDB——LS 写失败场景（配额满/隐私模式）IDB 是唯一新值源，
        // 回写会把 IDB 新值覆盖成旧值造成数据回退；IDB 落后会在下次业务 set
        // （logFish 等读-改-写）双写时自然追平。
        let lsVal = null;
        try { lsVal = localStorage.getItem(k); } catch (e) {}
        if (lsVal !== null && !lsUntrusted(k)) {
          str = lsVal;
        }
        try { if (str.length > LS_BIG_LIMIT) { if (_bigIdx[k] !== str.length) { _bigIdx[k] = str.length; bigIdxSave(); } } else if (_bigIdx[k] !== undefined) { delete _bigIdx[k]; bigIdxSave(); } } catch (e) {}
        if (str.length > LS_BIG_LIMIT) {
          if (str.length > BIG_BUDGET || bigBudgetUsed + str.length > BIG_BUDGET) {
            window.__xyIdbDeferredKeys.push(k);
            if (!budgetWarned) {
              budgetWarned = true;
              try { console.info('[mochi] 启动回填：大键驻留超预算(' + Math.round(BIG_BUDGET / 1048576) + 'MB)，超出部分本会话挂起，可随时 idbHydrateKey(键名) 按需取回'); } catch (e) {}
            }
            return false;
          }
          bigBudgetUsed += str.length;
        }
        if (!memoryCache) memoryCache = {};
        memoryCache[k] = str;
        // v3.5.92：大键（>200KB 图片 dataURL）只留 IDB + 内存缓存，不回填 localStorage
        if (str.length > LS_BIG_LIMIT) return true;
        try {
          // 仅当 localStorage 无此键，或 IndexedDB 数据更新时覆盖
          if (!localStorage.getItem(k)) localStorage.setItem(k, str);
        } catch (e) {}
        return true;
      }
      // 队列：已知大键（solo 单元）优先，其后未知键按 curBatch 动态切批——
      // 初始单键探路（最坏瞬时峰值=最大单键×2，而非多键叠加），连续小键后恢复批量提速
      const soloQueue = knownBig.map(function (k) { return [k]; });
      let restIdx = 0;
      let curBatch = 1;
      let smallStreak = 0;
      function takeUnit() {
        if (soloQueue.length) return soloQueue.shift();
        if (restIdx >= rest.length) return null;
        const u = rest.slice(restIdx, restIdx + curBatch);
        restIdx += u.length;
        return u;
      }
      function processBatch() {
        if (finished) return;
        const unit = takeUnit();
        if (!unit) { finish(); return; }
        window.idbGetMany(unit).then(map => {
          let bytes = 0, allSmall = true;
          unit.forEach(k => { const v = map[k]; if (typeof v === 'string') { bytes += v.length; if (v.length > 65536) allSmall = false; } });
          // v3.25.x：本批没读到的键登记进挂起名单——事务部分超时/失败时这些键读丢了
          // 又不在名单里，下游所有按需取回路径（回复池/字卡库）都以名单为门槛，
          // 会整会话空载（iOS 挂后台打断回填时的高发症状）
          try { unit.forEach(function (k) { if (!(k in map) && window.__xyIdbDeferredKeys.indexOf(k) < 0) window.__xyIdbDeferredKeys.push(k); }); } catch (e0) {}
          unit.forEach(k => { retainValue(k, map[k]); map[k] = null; });
          // 自适应批次：本单元偏大 → 保持/回到单键探路；连续 10 个全小键单元 → 恢复批量
          if (bytes > 2 * 1048576) { curBatch = 1; smallStreak = 0; }
          else if (allSmall && ++smallStreak >= 10 && curBatch === 1) { curBatch = 4; smallStreak = 0; }
          setTimeout(processBatch, 0); // 让出主线程，下一批
        }).catch(() => {
          // v3.5.132：批次失败继续下一批（原实现 finish() 会截断剩余全部键——
          // 低端机偶发事务失败时几百个键本会话不恢复）
          // v3.25.x：失败批次整组登记挂起名单（留痕给按需取回路径，见上）
          try { unit.forEach(function (k) { if (window.__xyIdbDeferredKeys.indexOf(k) < 0) window.__xyIdbDeferredKeys.push(k); }); } catch (e0) {}
          setTimeout(processBatch, 0);
        });
      }
      setTimeout(processBatch, 0);
    }).catch(() => { finish(); });
  };
  // v3.14.x：按需恢复单个键（含被预算挂起的大键）——显式调用不受预算限制，
  // 成功后自动移出 __xyIdbDeferredKeys。供各功能模块对"用户正在看的"大数据
  // 做懒加载兜底（如打开字卡面板前先 idbHydrateKey('xy-home-v2:cc-groups')）。
  // v3.25.x：返回值区分三种结果——true=取回成功；null=健康连接确认 IDB 无此键
  //（新装/新联系人的正常空库，调用方可以缓存「确实没有」避免反复空读）；
  // false=读取失败/超时（如 iOS 挂后台连接被杀），调用方保持可重试。
  window.idbHydrateKey = function (key) {
    // v3.28.x：修「还有手机没解决」第三层——原实现单次 8s 超时，对「慢但可用」的 IDB
    //（真我/荣耀 Edge 等内核事务偶发挂起；MB 级字卡库读取耗时可能 >8s）会直接判失败，
    // 且不重试。字卡回复池整会话取不回自定义字卡，联系人一直发兜底那几条系统预设卡。
    // 与 idbGet 同款 4s+4s：4s 未返回先重建连接重试一次（挂起多因连接已死，重开后通常
    // 当场返回），再 4s 仍无返回才放弃——总上限仍 8s，但成功率大幅提升。
    // v3.28.x（四层收口）：4s+4s 对「慢但可用」的读取反而有害——事务没挂只是读得慢
    //（几 MB 图片字卡库在低端机 >8s），4s 一到就重建连接重开事务，白浪费一次读的进度，
    // 第二次同样只给 4s，读到 8s 就放弃 → 此类手机自定义字卡永远取不回，联系人一直兜底。
    // 改为 6s+8s：首试 6s 耐心等慢读；仍无返回才重建连接再试（挂起连接重开通常当场恢复），
    // 二次给足 8s。首试事务在 6~14s 间完成仍会被 finish 收到（done 未置位）→ 总上限 14s，
    // 覆盖字段里「>8s 才读出来」的低端真机；回复等待上限 20s 仍能兜住（见 ensureReplyCardsReady）。
    return open().then(db => new Promise((resolve) => {
      let done = false;
      let timer = null;
      function finish(val) { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(val); }
      function run() {
        try {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => {
            // #1466：同 idbGet——抛了当场判「没落地」＋立刻换连接重试一发，不等 6s 首窗。
            const _rK = reqResultSafe(req);
            if (!_rK.ok) {
              if (connLost(_rK.e)) dbPromise = null;
              if (!retried) {
                retried = true;
                dbPromise = null;
                open().then(function (db2) { db = db2; run(); }).catch(function () { finish(undefined); });
                return;
              }
              finish(undefined);
              return;
            }
            finish(_rK.v === undefined ? null : _rK.v);
          };
          req.onerror = () => { if (connLost(req.error)) dbPromise = null; finish(undefined); };
        } catch (e) { if (connLost(e)) dbPromise = null; finish(undefined); }
      }
      let retried = false;
      timer = setTimeout(function () {
        if (done) return;
        if (!retried) {
          retried = true;
          dbPromise = null;
          open().then(function (db2) { db = db2; run(); timer = setTimeout(function () { dbPromise = null; finish(undefined); }, 8000); }).catch(function () { finish(undefined); });
          return;
        }
        dbPromise = null;
        finish(undefined);
      }, 6000);
      run();
    })).then(v => {
      if (v === null) return null;
      if (v === undefined) return false;
      // FIX 2026-09-27 #1335e：按需取回这一路同 #1335d——内存里那份只是冻结日志回放进来的旧值时，
      //   不许拦住的这次取回（#1218 的 idbEnsureBigKey／各页读空补路都从这一格过）。
      if (!(memoryCache && (key in memoryCache)) || wrjReplayUnvouched(key)) {
        // FIX 2026-09-21 #950：数组直存的大对象不再整包 stringify 驻留——直驻对象（零串化），
        // 与 retainValue 同口径；小对象仍串化成字符串（老键形态零变化）
        if (typeof v !== 'string') {
          const estObj = (x, d) => {
            if (typeof x === 'string') return x.length;
            if (!x || typeof x !== 'object') return 32;
            if (d > 4) return 64;
            let s = 0;
            if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) s += estObj(x[i], d + 1); return s + 16; }
            for (const kk in x) { try { s += estObj(x[kk], d + 1); } catch (e2) {} }
            return s + 64;
          };
          const nObj = estObj(v, 0);
          if (nObj > LS_BIG_LIMIT) {
            if (!memoryCache) memoryCache = {};
            memoryCache[key] = v;
            try { if (_bigIdx[key] !== nObj) { _bigIdx[key] = nObj; bigIdxSave(); } } catch (e0) {}
            const di0 = window.__xyIdbDeferredKeys;
            if (Array.isArray(di0)) { const i0 = di0.indexOf(key); if (i0 >= 0) di0.splice(i0, 1); }
            return true;
          }
        }
        let str = typeof v === 'string' ? v : JSON.stringify(v);
        // 与 retainValue 同规则（v3.16.x 摸鱼天数回退修复）：LS 有值且未写失败 →
        // 以 LS 为准（IDB 异步写可能未落地）；LS 缺失/写失败 → 用 IDB 值；不回写 IDB
        let lsVal = null;
        try { lsVal = localStorage.getItem(key); } catch (e) {}
        if (lsVal !== null && !lsUntrusted(key)) {
          str = lsVal;
        }
        if (!memoryCache) memoryCache = {};
        memoryCache[key] = str;
        try { if (str.length > LS_BIG_LIMIT) { if (_bigIdx[key] !== str.length) { _bigIdx[key] = str.length; bigIdxSave(); } } } catch (e) {}
        if (str.length <= LS_BIG_LIMIT) { try { if (!localStorage.getItem(key)) localStorage.setItem(key, str); } catch (e) {} }
      }
      const di = window.__xyIdbDeferredKeys;
      if (Array.isArray(di)) { const i = di.indexOf(key); if (i >= 0) di.splice(i, 1); }
      return true;
    }).catch(() => false);
  };
  // FIX 2026-09-25 #1218（用户实报「小米15 / edge：清理数据后再导入显示背景被清除，上传图片显示
  // 原图已丢失请重新上传」；同族症状在别的机型/浏览器同样出现——OPPO K13 Turbo Pro + edge「背景图
  // 显示被清理需要重启才能显示」、红米 K80 + chrome「从通知弹窗点开进聊天页，聊天背景与桌面背景
  // 一起莫名消失，刷新又恢复正常」）：
  // 这类 >200KB 的原图（桌面/聊天壁纸及其图库条目）只存在 IndexedDB —— xyStore.get 只认内存缓存与
  // localStorage，永不回退 IDB；启动回填按内存预算（≤4GB 取 12MB，否则 24MB）逐键流式补，用的又是
  // 定死 4s+4s、不按体积放大的 idbGetMany ⇒ 刚清库整包导入的那一轮、或启动期被秒级长任务占住主线程
  // 时（OPPO 诊断实测：chat-msgs 单键 107.7MB 远超整轮预算、启动长任务 1432ms、JS 堆 1020MB），
  // MB 级原图常常读不完就被判「挂起」进 __xyIdbDeferredKeys。挂起/超时都不等于数据没了，可每个消费
  // 方一读空就直接宣布「原图已丢失，请重新上传」、把生效指针 store.remove 掉、把已铺好的图层拆掉
  // ——用户被告知要重传，其实图就在库里；刷新一次时序变了就又显示，正是「重启才显示」。
  // 方案：把「读空先按需取回（idbHydrateKey：6s+8s、挂起时重建连接、不受回填预算限制），再按内核
  // 回执三态定性」收成数据层唯一一份。字卡库 chatcard.hydrateScope（#193）与音乐库 bootMusic（#1208）
  // 已是同口径的两个先例，这里只是给没做这件事的那批键补上；消费方只允许在 'absent' 时说「已丢失」。
  // 零机型／零 UA 分支：判据只有内核回执的三态。
  const bigHydInflight = {};   // 完整键名 -> 进行中的取回（同键并发合流，不重复读 MB 级值）
  // FIX 2026-09-27 #1349i：把「同一完整键那一趟取回」收成一个口，#1218 的消费方问库与 xyStore.get
  //   撞上「被放掉」那一格的补踢（#1349a）共用同一格合流。两条腿各发一趟会把 MB 级原图读两遍，
  //   还会把 #1258d 那条「每个命名空间只踢一趟按需取回」的不变量撞红（那一句是各页「读空先别拆层、
  //   等回执」的前提，实测纯底本 32/0 → 29/3）。回执形态与 idbEnsureBigKey 内部逐字一致。
  function bigHydAsk(full) {
    if (bigHydInflight[full]) return bigHydInflight[full];
    if (typeof window.idbHydrateKey !== 'function') return Promise.resolve('unknown');
    bigHydInflight[full] = Promise.resolve(window.idbHydrateKey(full)).then((v) => {
      delete bigHydInflight[full];
      if (v === true) return 'ok';
      if (v === null) { bigHydAbsent[full] = true; return 'absent'; }
      return 'unknown';
    }).catch(() => { delete bigHydInflight[full]; return 'unknown'; });
    return bigHydInflight[full];
  }
  // 一个相对键名在「当前桌面」的候选完整键名：命名空间键 + default 桌面的旧顶层键
  //（defaultStore().get 就有这条回退，取回路径必须同口径，否则未迁移老数据上的原图永远取不回）
  window.idbBigKeyCandidates = function (relKey) {
    // FIX 2026-09-27 #1342a：调用方给的若是**完整键名**就照原样认，不再拼命名空间。
    // 「所有桌面通用」那几本账（beauty-schemes / chat-beauty-schemes / gc-beauty-schemes /
    // full-beauty-schemes）存的是全局根键 xy-home-v2:<键>，不在任何 per-cid 命名空间里；按相对键名
    // 拼候选只会得到 xy-home-v2:default:beauty-schemes 这种根本不存在的位置，而在非 default 桌面
    // 连下面那条旧顶层键候选都不列 ⇒ 三态尺子对全局根键结构性失明：库里明明有那本账，ensure 却
    // 能报出 'absent'（＝「确认没有」），把「读空」讲成「数据没了」。
    if (typeof relKey === 'string' && relKey.indexOf('xy-home-v2:') === 0) return [relKey];
    let prefix = 'xy-home-v2:default';
    try { if (window.activePrefix) prefix = window.activePrefix() || prefix; } catch (e) {}
    const out = [prefix + ':' + relKey];
    try {
      const legacy = 'xy-home-v2:' + relKey;
      if ((!window.__activeCid || window.__activeCid === 'default') && out.indexOf(legacy) < 0) out.push(legacy);
    } catch (e) {}
    return out;
  };
  // #1258同批：大键尺寸索引的同步查询口（零 IDB 往返，只读 localStorage 里那份 __big-idx）。
  // 消费方据此判「这个大键本该还在」：_bigIdx 由 xyStore.set 同步维护、remove 时同步删除、
  // 启动回填与按需取回还会自愈补记（#907 清扫同源），也不受切后台释放内存副本（#1195e）影响，
  // 是「指针已丢」设备上唯一还活着的旁证。返回字节数；查不到 = undefined。
  window.idbBigIdxSize = function (relKey) {
    if (typeof relKey !== 'string' || !relKey) return undefined;
    let cands = [];
    try { cands = window.idbBigKeyCandidates(relKey) || []; } catch (e) {}
    for (let i = 0; i < cands.length; i++) {
      const n = _bigIdx[cands[i]];
      if (typeof n === 'number' && n > 0) return n;
    }
    return undefined;
  };
  // → Promise<'ok'|'absent'|'unknown'>
  //   'ok'      已取回进内存缓存，此后 store.get(relKey) 可读（调用方仍要自己复核，见 bigKeyReady）
  //   'absent'  健康连接确认所有候选键在库里都不存在 ⇒ 这才是真的「原图已丢失」
  //   'unknown' 读取失败/超时，或本环境没有按需取回能力 ⇒ 任何情况下都不许当成丢失
  window.idbEnsureBigKey = function (relKey) {
    if (typeof relKey !== 'string' || !relKey) return Promise.resolve('unknown');
    const hyd = window.idbHydrateKey;
    if (typeof hyd !== 'function') return Promise.resolve('unknown');
    const cands = window.idbBigKeyCandidates(relKey);
    let sawAbsent = false, sawUnknown = false;
    const step = (i) => {
      // 三态里最要紧的一条：只要有任何一个候选键这一轮没问出结果（读失败/超时），就绝不许退成
      // 'absent'——default 桌面有两个候选键，命名空间键读失败而旧顶层键「确认没有」时说「已丢失」，
      // 就是把一次超时讲成数据没了（用户据此去重传，甚至眼看着图被判死刑）。
      if (i >= cands.length) return Promise.resolve(sawAbsent && !sawUnknown ? 'absent' : 'unknown');
      const full = cands[i];
      if (bigHydAbsent[full]) { sawAbsent = true; return step(i + 1); }
      const settle = (r) => {
        if (r === 'ok') return 'ok';
        if (r === 'absent') sawAbsent = true; else sawUnknown = true;
        return step(i + 1);
      };
      if (bigHydInflight[full]) return bigHydInflight[full].then(settle);
      return bigHydAsk(full).then(settle);
    };
    return step(0);
  };
  // 备份导入/恢复之后必须重探一次：上一轮「确认库里没有」是按当时的库做的，导入把数据带回来时
  // 那份留底就成了假证（用户流程正是「清库 → 导入 → 打开看到已丢失」）。与 #787 字体补读同口径。
  window.idbResetBigKeyProbe = function () {
    try { for (const k in bigHydAbsent) delete bigHydAbsent[k]; } catch (e) {}
    try { for (const k in bigHydInflight) delete bigHydInflight[k]; } catch (e) {}
  };
  // #1218u 写完验真（大键落盘回执）。上面管的是「读」，这一份管「写」：xyStore.set 对 >200KB 的值
  // 只写内存缓存 + 发一个不管结果的 idbSet（LS 那份被大键分支主动 removeItem 掉了），所以配额满、
  // 事务被内核杀掉时写失败**没有任何回执**——当场看着「已设置」，重开那张图就没了。用户实报
  // 「按提示重新上传壁纸也不行」正是这条：存储被别的大键（实测某机单聊天库 107MB）挤爆后，
  // 每次上传都在内存里成功、在库里失败，而且永远报成功。判据取 count(键) 的真回执，零机型分支。
  // → Promise<'landed' | 'missing' | 'unknown'>：'missing' 要求连续两次确认库里没有（见下），
  // 因为 idbSet 与本次 count 各自挂在 open() 之后，事务入队顺序不保证——只问一遍会把「还没写完」
  // 冤枉成「没写进去」。'unknown' 绝不报警（问不出结果时宁可闭嘴，不许吓用户）。
  window.idbBigKeyLanded = function (relKey, gap) {
    if (typeof relKey !== 'string' || !relKey || typeof window.idbHasKey !== 'function') return Promise.resolve('unknown');
    let full = '';
    try { full = (window.idbBigKeyCandidates(relKey) || [])[0] || ''; } catch (e) {}
    if (!full) return Promise.resolve('unknown');
    // 只有「大键」才需要问库：xyStore.set 对 ≤200KB 的值本来就同步写了 localStorage（LS 有值且没
    // 标脏＝它本身就是落盘证据），此时 IDB 恰好不可用（隐私模式）也不该报「存储已满」。大键索引
    // _bigIdx 由 set 同步维护，认它；LS 写失败被标进 _lsDirtyKeys 的键，那份 LS 是旧值，不算数。
    const lsHeld = (() => {
      try { return _bigIdx[full] === undefined && localStorage.getItem(full) !== null && !(_lsDirtyKeys && _lsDirtyKeys.has(full)); } catch (e) { return false; }
    })();
    if (lsHeld) return Promise.resolve('landed');
    const once = () => Promise.resolve(window.idbHasKey(full)).then(
      (h) => (h === true ? 'landed' : (h === false ? 'missing' : 'unknown')), () => 'unknown');
    return once().then((r) => {
      if (r !== 'missing') return r;
      return new Promise((res) => { setTimeout(() => res(once()), gap || 1200); });
    });
  };
  // ===== v3.26.x：小键写日志（Edge/荣耀杀进程丢最近提交 → 设置开关回退）=====
  // 现象：荣耀 200 Pro Edge 反馈「系统预设字卡朋友圈/写信使用、我方发语音」关掉后
  // 退出浏览器重进又变回开启（Via/雨见正常）。根因链：切换开关后很快退出浏览器时，
  // Edge 杀进程把 localStorage 最近一次磁盘提交整批回滚（同步 setItem 不报错但落盘
  // 丢失）；重启后 idbRestore 的 retainValue 以「LS 有值且未标脏」为最新 → 取回的是
  // 回滚后的旧值，设置回退且每次启动都如此（LS 恒有旧值，IDB 里的新值永远不被应用）。
  // 方案（双链路）：① LS 写日志 `__wr-journal`——xyStore.set 对 ≤64KB 的小值同步追加
  //   {k,v,t}（LS 单持久化），启动时同步回放（先于各业务模块初始化读值），救「LS 值被
  //   回滚但 LS 日志幸存」的场景；② IDB 每键时间戳标记 `__wr-j:<完整键名>`——set 时
  //   额外写一个只含时间戳的小标记（与值互相独立的提交单元），restore 完成后异步比对：
  //   有标记且比已知写入新 → 以 IDB 里的值为准修正 内存+LS，救「LS 值与 LS 日志同批
  //   回滚」的场景（标记幸存即证明该键最近被写过、且 IDB 值事务先于标记事务提交）。
  //   每键独立标记不会被新会话整体覆写（整包日志副本会——首版教训）。
  //   有实际修复时广播 mochi-wrj-heal 让已按旧值渲染的开关 UI 重同步。
  //   聊天记录/大键/元键不进日志；时间戳守卫保证回放/合并永不覆盖本会话新写入。
  const WRJ_KEY = 'xy-home-v2:__wr-journal';
  const WRJ_MARK = 'xy-home-v2:__wr-j:';
  const WRJ_MAX = 24;              // 条数上限（#960：40→24，覆盖窗口仍远大于 IDB 标记 150ms 冲刷节奏）
  const WRJ_BUDGET = 64 * 1024;    // 值+键字符总量上限（#960：128→64KB 且预算计入键名/结构开销——原口径漏算键名，实测「128KB 预算」产出 183.7KB 包；每次小键写入都整包 stringify+同步写 LS，包越大人越容易掉帧）
  const WRJ_VAL_LIMIT = 64 * 1024; // 单值超过不记录（大键有自己的恢复路径）
  let _wrj = null;                 // [{k, v, t}]，按 key 去重、最新在前
  let _wrjTimes = {};              // key -> 最近一次已知写入时间（回放/合并/本会话写入共用）
  let _wrjMerged = false;
  // FIX 2026-09-27 #1335：「这本账还落不落得进盘」＝回放条目算不算权威的唯一尺子
  //   （红米 Note12Turbo/Chrome 实报「版本更新后收藏被全部清空，每次都被清空」；用户明说其他机型也有出现、
  //    不要覆盖式修补，判据零机型／零 UA 分支＝只取「日志这一发写进去没有」这一个内核事实）。
  //   日志只有 localStorage 一份副本，落盘＝整包 setItem。同源（GitHub Pages 同账号）兄弟站点把整域配额吃掉
  //   之后，这一发从此必抛（实测某机本会话 212 次、单发 118.4KB，全部出自 wrjPersistFlush，而旧写法
  //   `catch (e) {}` 把它吞得一个字不剩）⇒ 屏上那本日志【永久冻结】在最后一次成功提交的形态上。
  //   而回放排在回填之前（业务模块紧接着就同步读值，这是 #339/#226 刻意定的时序，不能动），此刻
  //   `_wrjTimes` 还是空的 ⇒ 守卫 `(_wrjTimes[k]||0) >= e.t` 恒不成立 ⇒ 每一条旧值都被无条件当成权威塞进
  //   memoryCache；retainValue 第一行 `if (k in memoryCache) return false` 本意是「本会话写过的值不许被
  //   回填遮蔽」，这里却把【冻结日志里的旧值】认成了本会话的新写入，于是库里那条更新的大值整场会话
  //   没人应用；用户点一次收藏拿这份旧快照做读-改-写 ⇒ 库里 20 条被整包抹成 3 条＝永久丢失；下一开站
  //   同一发冻结日志照样赢 ⇒ 「每次都被清空」。
  //   判据：落不了盘的账本不能当「最近一次写入」。探针排在回放之前、写回的就是刚从 LS 读出来的同一份内容
  //   （幂等、零语义变化），它抛 ⇒ 本场回放进来的每一条都标成「未经背书」，允许被回填/按需取回的库里
  //   权威值覆盖。LS 写得进的机器（#226/#339 那一族：IDB 那次写失败、日志才是最新）探针必然成功 ⇒
  //   一个字都不改旧行为。
  let _wrjStranded = false;        // 日志这一路落盘被拒过＝这本账冻结了，不再充当权威
  let _wrjStrandedN = 0;           // 被拒次数（只给诊断单看现场）
  const _wrjReplayed = {};         // key -> true：memoryCache 里这一键来自冻结日志的回放（不是本会话写的）
  function wrjReplayUnvouched(key) { return !!(_wrjStranded && _wrjReplayed[key]); }
  function wrjReplayOverride(key) {
    if (!wrjReplayUnvouched(key)) return false;
    delete _wrjReplayed[key]; // 库里的权威值已经接管这一键
    return true;
  }
  // 只观测，不改写任何数据
  window.__wrjDiag = function () {
    let n = 0; for (const k in _wrjReplayed) n++;
    return { stranded: _wrjStranded, rej: _wrjStrandedN, replayed: n };
  };
  function wrjLoad(raw) {
    try {
      const a = JSON.parse(raw || '[]');
      return Array.isArray(a) ? a.filter(function (e) { return e && typeof e.k === 'string' && typeof e.v === 'string' && typeof e.t === 'number'; }) : [];
    } catch (e) { return []; }
  }
  function wrjLsRaw() { try { return localStorage.getItem(WRJ_KEY); } catch (e) { return null; } }
  // FIX 2026-09-20 #943c：日志落盘防抖——原实现 xyStore.set 每写一个小键就把整本日志
  // JSON.stringify（预算 128KB/40 条）同步 setItem 一次＝每次键写入都给主线程加一次
  // 全包串化税（456 键的域里发消息/开关切换连写时叠加成可感长任务）。改 200ms trailing
  // 合并；离页（visibilitychange hidden / pagehide）当场冲刷，写入仍必达，防丢语义不变。
  let _wrjPersistT = null;
  // #1206 交互让路：本函数是「整本日志 stringify ＋ 同步 localStorage 写」（实测该域里
  // __wr-journal 已长到 76.9KB），200ms 防抖到期点正好落在用户滑动/打字的窗口里付费。
  // 现按 __mochiInteracting()（mobile-adapt.js 的交互窗口信号）让路到停手，但最迟
  // WRJ_BUSY_CAP 必落一次——连续滑动不停手也不会把日志无限押后；离页另有
  // visibilitychange hidden / pagehide 当场冲刷两条兜底，防丢语义与 #943c 完全一致。
  // 与 #1324 的「内容逐字相同即跳过」叠在一处：让路决定「什么时候写」，跳过决定「要不要写」。
  const WRJ_FLUSH_MS = 200, WRJ_BUSY_CAP = 1200;
  let _wrjDue = 0, _wrjCap = 0;
  function wrjBusy() {
    try { return !!(window.__mochiInteracting && window.__mochiInteracting()); } catch (e) { return false; }
  }
  // FIX 2026-09-27 #1324（iPhone 17 Pro Max／iOS 26.6.1 复报「切页面和从后台切回来最卡」；同批 perfcheck
  //   自报「前台冻结 19 次／10 秒」「wrj-journal 距冻结起点中位 2ms＝紧邻高危」）：上面那条「离页当场冲刷」
  //   把「有改动必达」写成了「不管有没有改动都整本重写一遍」。纯 HEAD 副本实测：四次后台往返里一条数据都没
  //   改，`__wr-journal` 仍被 stringify＋同步 setItem 重写 8 次、合计 552KB（单次约 42KB＝整个日志预算的
  //   66%），而且这条链在 WebKit 上是**同步持久写**，恰好落在系统正要挂起页面的那一拍。判据收成一把尺子：
  //   「要写的这份内容与库里那份是否逐字相同」——相同＝上一次已经落过，跳过（与 #1311/#1222 同口径＝比内容
  //   不比引用身份，因为同一份数据每次从 localStorage 拿回来都是新字符串实例，按身份比会把「没变」判成「变了」）。
  //   #943c 的防抖、#1257 的「写入仍必达」一字未削：只要内容真的变了（含本会话从未落过、_wrjLanded 仍为
  //   null 的第一次冲刷＝启动期照旧重新断言一次，LS 被回滚时能自愈回去），下一次 flush 必写。
  let _wrjLanded = null;             // 上一次真的写进 localStorage 的那份序列化串
  function wrjPersistFlush() {
    if (_wrjPersistT) { clearTimeout(_wrjPersistT); _wrjPersistT = null; }
    _wrjDue = 0; _wrjCap = 0; // #1206 回看/落盘一并作废，下一次排程重新起表
    let s;
    try { s = JSON.stringify(_wrj || []); } catch (e0) { return; }
    if (s === _wrjLanded) return;    // 内容没变＝库里那份就是它，不必再同步重写一整本
    try { if (window.__mochiPhase) window.__mochiPhase('wrj-journal'); } catch (e1) {}
    try { localStorage.setItem(WRJ_KEY, s); _wrjLanded = s; } catch (e2) {}
    // FIX 2026-09-27 #1335a：上面那一行一字不动（#1324b 那根针保护它），落没落盘改用一份现成事实来问——
    //   `_wrjLanded` 只在写成功之后才被置成 s ⇒ 事后一比对就知道这本账这一次落进去了没有。
    //   旧形态是 `catch (e) {}` 把抛出的那一发吞得一个字不剩：实测某机本会话抛 212 次（单发 118.4KB、
    //   全部出自这一行），每一次都在白记一遍永远落不了的账，屏上那本日志从此冻结在最后一次成功提交的
    //   形态上，下一场开站照旧把旧值当「最近一次写入」回放（＝#1335 整条链的第一块多米诺）。
    if (_wrjLanded !== s) { _wrjStranded = true; _wrjStrandedN++; }
  }
  // 到期裁决：还在手势里且没到硬上限 → 150ms 后回看（回看不重置 due/cap＝押后总量有界）；
  // 否则当场落盘。排程之后手指才落下来的（滑动中途到期）走同一条路，不留「已排程就照付」的缺口。
  function wrjPersistAt() {
    _wrjPersistT = null;
    const now = Date.now();
    if (wrjBusy() && now < _wrjCap) { _wrjPersistT = setTimeout(wrjPersistAt, 150); return; }
    wrjPersistFlush();
  }
  function wrjPersist() {
    if (_wrjPersistT) return;
    const now = Date.now();
    if (!_wrjDue) _wrjDue = now + WRJ_FLUSH_MS;
    if (!_wrjCap) _wrjCap = now + WRJ_BUSY_CAP;
    _wrjPersistT = setTimeout(wrjPersistAt, Math.max(0, Math.min(_wrjDue, _wrjCap) - now));
  }
  // v3.26.x 存储优化：标记合并落库——原实现每个小键 set 各发一个 IDB 事务写时间戳标记，
  // 值事务之外白翻倍事务数；现积攒 150ms 用 idbSetAll 单事务批量写。语义不变：值事务在
  // xyStore.set 里同步先发出，flush 时早已入队（值先于标记提交）；150ms 内立刻退出浏览器的
  // 极端窗口由下方 pagehide/visibilitychange 即时冲刷兜住，且主防线本就是同步写的 LS 日志。
  // idbSetAll 无重试骨架，返回 false 时退回逐键 idbSet（自带 3 次重试）。
  const WRJ_MARK_FLUSH_MS = 150;
  let _wrjMarkBuf = new Map(); // 完整标记键 -> t
  let _wrjMarkT = null;
  let _wrjMarkDue = 0, _wrjMarkCap = 0; // #1206 让路用的到期点/硬上限（0＝未排程）
  function wrjMarkFlush() {
    if (_wrjMarkT) { clearTimeout(_wrjMarkT); _wrjMarkT = null; }
    _wrjMarkDue = 0; _wrjMarkCap = 0;
    if (!_wrjMarkBuf.size) return;
    const pairs = [];
    _wrjMarkBuf.forEach(function (t, k) { pairs.push({ k: k, v: t }); });
    _wrjMarkBuf.clear();
    try {
      if (window.idbSetAll) {
        window.idbSetAll(pairs).then(function (ok) {
          if (ok) return;
          pairs.forEach(function (p) { try { if (window.idbSet) window.idbSet(p.k, p.v); } catch (e2) {} });
        }).catch(function () {});
        return;
      }
    } catch (e) {}
    pairs.forEach(function (p) { try { if (window.idbSet) window.idbSet(p.k, p.v); } catch (e2) {} });
  }
  function wrjMarkSchedule() {
    // #1206 同日志落盘口径让路：idbSetAll 的入参数组要在主线程做结构化克隆，手势窗口内
    // 一样是白付的账。只押后【标记】事务——值事务在 xyStore.set 里已同步先发出，
    // 「值先于标记提交」的既有前提不受影响；离页仍由 pagehide/visibilitychange 当场冲刷。
    if (_wrjMarkT) return;
    const now = Date.now();
    if (!_wrjMarkDue) _wrjMarkDue = now + WRJ_MARK_FLUSH_MS;
    if (!_wrjMarkCap) _wrjMarkCap = now + WRJ_BUSY_CAP;
    _wrjMarkT = setTimeout(wrjMarkAt, Math.max(0, Math.min(_wrjMarkDue, _wrjMarkCap) - now));
  }
  // 到期裁决（与 wrjPersistAt 同口径）：手势中每 150ms 回看，due/cap 不重置＝押后总量有界
  function wrjMarkAt() {
    _wrjMarkT = null;
    const now = Date.now();
    if (wrjBusy() && now < _wrjMarkCap) { _wrjMarkT = setTimeout(wrjMarkAt, 150); return; }
    wrjMarkFlush();
  }
  function wrjMark(key, t) {
    _wrjMarkBuf.set(WRJ_MARK + key, t);
    wrjMarkSchedule();
  }
  function wrjUnmark(key) {
    _wrjMarkBuf.delete(WRJ_MARK + key); // 还没落库的标记直接撤销，省一个删除事务
    try { if (window.idbDelete) window.idbDelete(WRJ_MARK + key); } catch (e) {}
  }
  function wrjRecord(key, v) {
    if (!key || key === WRJ_KEY || key.indexOf('__') >= 0) return;
    if (isChatMsgsKey(key) || /:chat-meta$/.test(key) || key.indexOf('music-file:') >= 0) return;
    // FIX 2026-09-16 #628：大值（>64KB，壁纸/头像/上传字体等只进 IDB+内存的键）不进 LS 日志，
    //   但必须【清掉同一键残留的小值条目】——xyStore.set 写大值时 removeItem 掉了 LS 值，若日志里
    //   那条旧小值还在，下次启动 wrjReplay 会把它回放进「内存+LS」，而 idbRestore 以「LS 有值且未
    //   标脏」为准 ⇒ IDB 里刚写的大值整场会话被遮蔽（实测：先输入字体名、之后再上传字体文件，
    //   重进变回上次的字体名；壁纸「先选渐变预设、再上传图片」同型）。wrjForget 同时撤掉该键的
    //   IDB 时间戳标记，避免 wrjMergeFromIdb 再把旧值当权威。
    if (typeof v === 'string' && v.length > WRJ_VAL_LIMIT) { wrjForget(key); return; }
    if (typeof v !== 'string') return;
    if (!_wrj) _wrj = wrjLoad(wrjLsRaw());
    const t = Date.now();
    _wrj = _wrj.filter(function (e) { return e.k !== key; });
    _wrj.unshift({ k: key, v: v, t: t });
    let chars = 0, cut = _wrj.length;
    for (let i = 0; i < _wrj.length; i++) {
      chars += _wrj[i].v.length + _wrj[i].k.length + 24; // #960：键名+结构开销一并计入，预算才真实约束产物大小
      if (i >= WRJ_MAX || chars > WRJ_BUDGET) { cut = i; break; }
    }
    if (cut < _wrj.length) _wrj.length = cut;
    _wrjTimes[key] = t;
    wrjPersist();
    return t; // FIX 2026-09-25 #1257b：只报时间戳、不再当场 wrjMark——标记由调用方在值事务提交回执后补记（见 xyStore.set）；删掉这层交接＝「旧值+新标记」自愈反噬复发
  }
  function wrjForget(key) {
    if (!_wrj) _wrj = wrjLoad(wrjLsRaw());
    const before = _wrj.length;
    _wrj = _wrj.filter(function (e) { return e.k !== key; });
    _wrjTimes[key] = Date.now();
    if (_wrj.length !== before) wrjPersist();
    wrjUnmark(key);
  }
  // 离页即时冲刷待写标记＋防抖中的日志落盘（#943c），压缩「写完立刻退出」丢标记/丢日志的窗口
  try {
    document.addEventListener('visibilitychange', function () {
      try { if (document.visibilityState === 'hidden') { wrjMarkFlush(); wrjPersistFlush(); } } catch (e) {}
    });
  } catch (e) {}
  try { if (window.addEventListener) window.addEventListener('pagehide', function () { try { wrjMarkFlush(); wrjPersistFlush(); } catch (e) {} }); } catch (e) {}
  // 回放：把日志里的「最近一次写入」补进 内存+LS。时间戳守卫保证只应用比
  // 已知写入更新的条目（不会覆盖本会话新写入的值）。
  function wrjReplay(entries) {
    if (!entries || !entries.length) return 0;
    if (!memoryCache) memoryCache = {};
    let n = 0;
    let _wrjDirtyTouched = false;
    entries.forEach(function (e) {
      if ((_wrjTimes[e.k] || 0) >= e.t) return;
      _wrjTimes[e.k] = e.t;
      if (memoryCache[e.k] === e.v) return;
      memoryCache[e.k] = e.v;
      // FIX 2026-09-27 #1335b：日志冻结时这一路整个改道——
      //   ① 绝不把旧值写回 localStorage：那一条只有几十字符，在「大值写不进」的机器上【照样写得进去】，
      //     于是回放会拿旧快照把 LS 里那份新鲜值整份换掉，而 retainValue／idbHydrateKey 的旧规则恰好是
      //     「LS 有值且没标脏＝LS 才是最新」⇒ 旧快照从此每一场都赢（＝用户看到的「每次都被清空」）；
      //   ② 反过来把这一键标进「LS 不可信」集合（lsDirtyAdd＝站内既有那把尺子，sessionStorage＋IDB 双份
      //     持久化、跨重启有效），让所有下游判定统一改口以 IDB 为准，不另起第二套口径；
      //   ③ 记下这一键的内存值来自回放（不是本会话写的），允许被回填／按需取回的权威值覆盖（见 retainValue）。
      if (_wrjStranded) {
        _wrjReplayed[e.k] = true;
        // 直接改集合、最后统一 lsDirtySave 一次：lsDirtyAdd 每次都整包重写 sessionStorage＋IDB，
        // 启动期连着十几条回放条目就是十几次 IDB 事务（#943c 为同一件事把日志落盘改成防抖过）。
        try {
          if (!_lsDirtyKeys) _lsDirtyKeys = new Set();
          if (!_lsDirtyKeys.has(e.k)) { _lsDirtyKeys.add(e.k); _wrjDirtyTouched = true; }
        } catch (e3) {}
      } else {
        try { if (e.v.length <= LS_BIG_LIMIT) localStorage.setItem(e.k, e.v); } catch (e2) {}
      }
      // #339 修复锚：WRJ_REPLAY_NO_IDB 恒真——回放值可能是被回滚的旧值，回写 IDB 会踩掉
      // 更新的值（见下方 FIX 注释）；此守卫若被翻转/删除恢复无条件 idbSet，即本 bug 回归
      if (!WRJ_REPLAY_NO_IDB) { try { if (window.idbSet) window.idbSet(e.k, e.v); } catch (e2) {} }
      n++;
    });
    if (_wrjDirtyTouched) { try { lsDirtySave(); } catch (e4) {} } // #1335g：整场回放只落一次盘
    return n;
  }
  // 同步回放 LS 日志（杀进程场景下 LS 值与 LS 日志常同批回滚，此路为空时靠下方 IDB 合并兜底）
  // FIX 2026-09-12 #339（LS 回滚家族第五层，同族 #82/#88/#226/#229/#233/#265）：回放
  //   【绝不回写 IDB】。写路径顺序＝LS 日志→LS 值→IDB 值→(≤150ms 微批)IDB 标记；杀进程
  //   回滚后 LS 值与 LS 日志同批退回上次磁盘提交，日志里的条目因此可能是旧值，而 IDB 值+
  //   标记早已落库（更新）。旧实现在回放里 idbSet 回写 → 用旧值踩掉 IDB 里的新值 → 随后
  //   wrjMergeFromIdb 按「标记比已知新 → 取 IDB 值自愈」读到的恰是被踩掉的旧值 → 自愈被
  //   自己废掉，用户「改完设置就退浏览器」的最近一次改动 100% 丢失（默认字卡概率/回复速度/
  //   emoji 概率等全站小键设置，多机型）。回放只救 内存+LS；IDB 方向的调和全权交给
  //   wrjMergeFromIdb（其时间戳守卫保证只前不后）。
  var WRJ_REPLAY_NO_IDB = true;
  // FIX 2026-09-27 #1335c：回放之前先问一句「这本账今天还落不落得进盘」。探针排在回放【之前】：回放一旦把
  //   旧值塞进 memoryCache，回填那条权威路就被 `k in memoryCache` 挡死，整条链就是从这一步开始跑偏的。
  //   量法＝拿一个【另一个键名】试写同等体积：原样写回 WRJ_KEY 在 Chrome 里是 0 字节增量的无操作、
  //   配额满也不抛（实测：拿刚读出来的同一份内容写回去照样成功，探针当场变成假阴性＝这一版自己踩过的坑），
  //   换键名才真按体积向内核要位置。写完立刻撤掉，健康机器上不留痕迹。
  //   LS 写得进的机器（#226/#339 那一族：IDB 那次写失败、日志才是最新的那一发）探针必然成功 ⇒
  //   旧行为一个字不变。判据只取「这一枚 setItem 抛没抛」，零机型／零 UA 分支。
  function wrjBootCommitProbe() {
    const entries = wrjLoad(wrjLsRaw());
    _wrj = entries;
    let payload = '';
    try { payload = JSON.stringify(entries); } catch (e) { return entries; }
    if (!payload || payload === '[]') return entries; // 空账本无所谓落不落盘
    try {
      localStorage.setItem(WRJ_KEY + ':probe', payload);
      localStorage.removeItem(WRJ_KEY + ':probe');
    } catch (e) { _wrjStranded = true; _wrjStrandedN++; try { localStorage.removeItem(WRJ_KEY + ':probe'); } catch (e2) {} }
    return entries;
  }
  try { wrjReplay(wrjBootCommitProbe()); } catch (e) {}
  // FIX 2026-09-07 #229：合并失败必须重试——原实现入口即置 _wrjMerged=true，且走
  // idbGetAllKeys（把「清单读取失败(null)」折叠成「空数组」，与「库里确实没有标记」
  // 不可区分）：真我/荣耀/小米 Edge 等挂起内核上合并恰逢 IDB 挂起窗口时空转一次后，
  // 整个会话永久放弃 → LS 被杀进程回滚的美化/设置/近期小数据在本会话再无第二道
  // 自愈防线（用户视角＝刷新后部分数据丢失，多机型复发）。现改走严格三态
  // idbListKeys：null=读取失败 → 有界重试（10s×5），合并真正走完（或确认无可修）
  // 才置 _wrjMerged；有标记却读不到任何有效时间戳（idbGetMany 失败折叠成 undefined）
  // 同样重试。时间戳守卫（t > _wrjTimes）保证迟到的重试合并永不覆盖本会话新写入。
  let _wrjMergeTries = 0;
  let _wrjMergeBusy = false;
  function wrjMergeRetry() {
    _wrjMergeBusy = false; // 各失败路径统一在此解锁，重试才能重新进入
    if (_wrjMerged || _wrjMergeTries >= 5) return;
    _wrjMergeTries++;
    setTimeout(function () { try { wrjMergeFromIdb(); } catch (e) {} }, 10000);
  }
  function wrjMergeFromIdb() {
    if (_wrjMerged || _wrjMergeBusy) return;
    if (!window.idbListKeys || !window.idbGetMany) return;
    _wrjMergeBusy = true;
    window.idbListKeys().then(function (keys) {
      if (!keys) { wrjMergeRetry(); return; }
      const marked = keys.filter(function (k) { return String(k).indexOf(WRJ_MARK) === 0; });
      if (!marked.length) { _wrjMergeBusy = false; _wrjMerged = true; return; }
      window.idbGetMany(marked).then(function (marks) {
        // 有标记且比已知写入新的键 → 读 IDB 权威值修正 内存+LS（标记幸存 = 该键最近
        // 被写过且 IDB 值事务先于标记事务提交，LS 若与其不一致就是被回滚的旧值）
        const cand = marked.filter(function (mk) {
          const t = marks[mk];
          const full = String(mk).slice(WRJ_MARK.length);
          return typeof t === 'number' && t > (_wrjTimes[full] || 0);
        });
        if (!cand.length) {
          const anyTs = marked.some(function (mk) { return typeof marks[mk] === 'number'; });
          if (!anyTs) { wrjMergeRetry(); return; } // 有标记却全读不到数值＝这轮没读到，不是真没有
          _wrjMergeBusy = false; _wrjMerged = true; // 标记都在但都不比已知写入新＝确实无可修
          return;
        }
        _wrjMergeBusy = false; _wrjMerged = true;
        window.idbGetMany(cand.map(function (mk) { return String(mk).slice(WRJ_MARK.length); })).then(function (vals) {
          if (!memoryCache) memoryCache = {};
          let healed = 0;
          cand.forEach(function (mk) {
            const full = String(mk).slice(WRJ_MARK.length);
            const v = vals[full];
            if (typeof v !== 'string' || v.length > WRJ_VAL_LIMIT) return;
            _wrjTimes[full] = marks[mk];
            if (memoryCache[full] === v) return;
            memoryCache[full] = v;
            try { if (v.length <= LS_BIG_LIMIT) localStorage.setItem(full, v); } catch (e2) {}
            healed++;
          });
          if (healed > 0) {
            try { document.dispatchEvent(new Event('mochi-wrj-heal')); } catch (e2) {}
          }
        });
      });
    }).catch(function () { wrjMergeRetry(); });
  }
  document.addEventListener('mochi-restore-done', wrjMergeFromIdb);
  setTimeout(wrjMergeFromIdb, 15000); // restore 整体挂起时的兜底（正常走 mochi-restore-done，_wrjMerged 防重入）

  window.__mochiLoadT = Date.now();
  // v3.5.24：启动时自动从 IndexedDB 回填 localStorage 缺失的键。
  // 之前只定义不调用——手机端导入/配额异常导致 localStorage 部分丢失后，IndexedDB 里的
  // 聊天记录/字卡/查岗等备份永远不会回填。现在初始化自动跑一次。
  try { window.idbRestore('xy-home-v2:'); } catch (e) {}

  // v3.5.92：一次性迁移——localStorage 里 >200KB 的旧大键（头像池/壁纸/朋友圈背景等）
  // 移入 IndexedDB 并从 localStorage 删除（老用户升级后 LS 立刻瘦身，不再撑爆 5MB）
  // v3.5.122：music-file 旧双写残留也一并迁移（旧版本音频存过 LS，读取路径会先查 IDB，
  //   迁移删掉 LS 副本后仍能从 IDB 读到；写入成功才删，失败保留下次重试）
  try {
    if (!sessionStorage.getItem('xy-ls-big-migrated')) {
      let moved = 0;
      // 先收集键再处理：避免边删边遍历导致索引跳跃漏项
      const bigKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('xy-home-v2:') !== 0) continue;
        // v3.6.x：聊天记录 LS 兜底快照（200KB~2MB 常见）绝不能当大键搬进 IDB 后
        // 删 LS——否则 Edge 等浏览器杀后台/强制关闭时丢 IndexedDB 数据，聊天记录
        // 连唯一备份都没了（vivo S16 Edge 实测：收藏/音乐/字卡/信/朋友圈都在
        //（LS+IDB 双写），唯独聊天记录整体消失——聊天是唯一只写 IDB 的数据）
        if (isChatMsgsKey(k)) continue;
        // v3.42.x #426：群聊消息 LS lite 快照同理绝不迁移——lite 快照是「剥过媒体负载的
        // 减裁副本」，IDB 同键是全量权威（大记录为结构化数组）；这里无条件 idbSet 覆盖会把
        // 权威值打回精简版＝老消息永久剥坏，随后删 LS 连兜底一起没
        if (isGroupMsgsKey(k)) continue;
        // v3.29.x：已下线的自动备份副本键绝不参与迁移——它以 LS 形态存在时（远古版本或
        // 手工改过的备份包）必然远超 LS_BIG_LIMIT，一旦被收进 bigKeys，下面的循环会整包读进
        // 内存 + 写回 IDB + 常驻 memoryCache（idb.js:930），等于把 data-backup.js 刚清理掉的
        // 副本又复活一份，还白钉住几百 MB 堆。副本是纯冗余遗留物，不需要迁移，交给 purge。
        if (k === 'xy-home-v2:__auto-backup-snapshot') continue;
        const v = localStorage.getItem(k);
        if (v && v.length > LS_BIG_LIMIT) bigKeys.push(k);
      }
      // v3.5.95：逐键写入成功才从 localStorage 删除（防 IDB 写失败时数据双丢）；
      // 全部成功才置迁移标记（部分失败时下次启动会重试未迁移的键）
      (async () => {
        let moved = 0;
        for (const k of bigKeys) {
          const v = localStorage.getItem(k);
          if (!v) continue;
          try {
            const ok = await window.idbSet(k, v);
            if (ok) {
              // v3.5.132：同步写 memoryCache——迁移的键不在 idbRestore 的快照里，
              // 不写 cache 的话本会话 store.get 三路全空（壁纸/背景"消失"直到刷新）
              if (!memoryCache) memoryCache = {};
              memoryCache[k] = v;
              try { localStorage.removeItem(k); } catch (e) {}
              moved++;
            } else {
              // v3.26.x：idbSet 失败可能是 IDB 连接刚启动未就绪/事务瞬时挂起，
              // 延迟 5s 重试一次（连接恢复后能成功，下次启动即可删 LS 拖留）。
              // 仍失败则 LS 保留（不丢数据，下次启动迁移块会再试）。
              setTimeout(async function () {
                try {
                  const v2 = localStorage.getItem(k);
                  if (!v2) return;
                  const ok2 = await window.idbSet(k, v2);
                  if (ok2) {
                    if (!memoryCache) memoryCache = {};
                    memoryCache[k] = v2;
                    try { localStorage.removeItem(k); } catch (e) {}
                  }
                } catch (e) {}
              }, 5000);
            }
          } catch (e) {}
        }
        if (moved > 0) { try { sessionStorage.setItem('xy-ls-big-migrated', '1'); } catch (e) {} }
      })();
    }
  } catch (e) {}

  window.idbBigSize = function (key) {
    // v3.26.x #139：大键尺寸只读访问（__big-idx 索引在 set/回填时记录 >200KB 值的长度）。
    // 供字卡库去重等模块免读大值做「是否有变化」预检，避免每次会话把 100MB+ 键拉进堆。
    try { const s = _bigIdx[key]; return typeof s === 'number' ? s : null; } catch (e) { return null; }
  };

  // ===== v3.26.x #139：LS 大键残留清扫（恢复设置保存配额） =====
  // 现象（#139 诊断）：LS 整域 10MB 满、写探针 QuotaExceededError，设置/桌面保存失败。
  // xyStore.set 对 >LS_BIG_LIMIT 的值会清 LS 副本，但「全量备份导入直写 LS」且发生在
  // 上方 v3.5.92 迁移（sessionStorage 门，每浏览器会话只跑一次）之后时，存量残留直到
  // 下次重启都没人清（fav-msgs 207KB 等 LS+IDB 双份计费）。补一个事件驱动的幂等清扫：
  // restore 完成 / 备份导入（都会派发 mochi-restore-done）后延迟执行——
  //   · IDB 值与 LS 值完全一致 → 纯去重，直接删 LS 副本（零数据风险）；
  //   · IDB 缺失/落后 → 先按 retainValue 同规则以 LS 追平 IDB，写成功且 LS 未被业务
  //     再写才删 LS（写失败本轮跳过下轮收敛；绝不先删后写）。
  //   · IDB 值是非字符串（结构化存储）→ 不动（不是本清扫的目标形态）。
  let _lsSweepDone = false;
  // #721：失败重试——原实现一次性闩到底（_lsSweepDone），可候选里只要有一项在存储繁忙
  // 时刻读不到/追平写失败就整会话不再清（用户诊断单里 207KB 残留跨会话存活即此形态：
  // 回填后 20s 正是 IDB 事务高峰）。现记录本轮是否留了没清干净的候选，留了就稍后重试
  // （上限 2 次、每次间隔 60s），存储一直不健康时不无限循环。
  let _lsSweepFail = false;
  let _lsSweepTries = 0;
  function lsResidueSweep() {
    if (_lsSweepDone) return;
    _lsSweepDone = true;
    _lsSweepFail = false;
    if (!window.idbGet || !window.idbSet) return;
    const markFail = function () { _lsSweepFail = true; };
    let names = [];
    try { names = Object.keys(localStorage); } catch (e) { return; }
    const cands = names.filter(function (k) {
      if (typeof k !== 'string' || k.indexOf('xy-home-v2:') !== 0) return false;
      if (isChatMsgsKey(k)) return false;                  // 聊天 LS 快照是唯一备份，绝不动
      if (k.indexOf('music-file:') >= 0) return false;     // 音频有专属迁移路径
      if (k === BIG_IDX_KEY || k === LS_DIRTY_KEY || k === WRJ_KEY || k.indexOf('__wr-j:') === 0) return false;
      if (k === 'xy-home-v2:__auto-backup-snapshot') return false;
      let v = null;
      try { v = localStorage.getItem(k); } catch (e) { return false; }
      // #1443c：LS 整层写不进的机器，配额是被一批【卡在 200K 字符阈值下面的大快照】撑死的——本机
      //   3×feed-cover-bg=359.4KB、fav-msgs=311.7KB、feed-posts=264.5KB、cc-groups-public=276.8KB，
      //   按 iOS 的 UTF-16 记账每个只有 13 万~18 万字符，全在 LS_BIG_LIMIT 之下 ⇒ 旧筛选条件一辈子
      //   碰不到它们，配额永久满、这一层永久写不进。探针抛过 ⇒ 候选阈值降到 32K 字符，只把真正占
      //   地方的那批请出去；LS 写得进的机器阈值一字不变。
      const minBytes = lsWriteDead() ? 32 * 1024 : LS_BIG_LIMIT;
      return typeof v === 'string' && v.length > minBytes;
    });
    let i = 0;
    (function step() {
      if (i >= cands.length) {
        // #1443c：请出去一批就重新探一次——腾出配额后这一层重新写得进，判定自动回到原口径
        //   （只复位缓存位，不直接断言「活了」，下一问自会试写一发）
        try { lsWriteDeadReset(); } catch (eR) {}
        // 本轮收尾：有候选没清干净（读写失败/超时）→ 允许稍后重试一轮（上限 2 次）
        if (_lsSweepFail && _lsSweepTries < 2) {
          _lsSweepTries++;
          _lsSweepDone = false;
          setTimeout(lsResidueSweep, 60000);
        }
        return;
      }
      const k = cands[i++];
      let lsVal = null;
      try { lsVal = localStorage.getItem(k); } catch (e) {}
      // #1443c：逐条复检必须与候选筛选同一把尺——上一版只降了 cands 那道的阈值，这一道仍留 200K 字符，
      // 于是本机那排 13万~18万字符的快照「进了候选、又被这一步退回」，配额照样腾不出来（新尺 L4 抓到）。
      if (typeof lsVal !== 'string' || lsVal.length <= (lsWriteDead() ? 32 * 1024 : LS_BIG_LIMIT)) { setTimeout(step, 0); return; }
      window.idbGet(k).then(function (idbVal) {
        const next = function () { setTimeout(step, 0); };
        if (idbVal && typeof idbVal !== 'string') { next(); return; }
        if (typeof idbVal === 'string' && idbVal === lsVal) {
          // 纯去重：IDB 已有同值，LS 副本是双倍计费残留；删前复读防业务刚写入新值
          try { if (localStorage.getItem(k) === lsVal) localStorage.removeItem(k); } catch (e) {}
          next(); return;
        }
        // FIX 2026-09-29 #1443c：LS 整层写不进的机器绝不再把 LS 那份当「最新」追平 IDB——那正是
        //   收藏／字卡被旧包整包顶掉的放大器（见上方 lsWriteDead 注释）。这一层落不下去时改判据：
        //   库里那份有值且不比 LS 短＝IDB 至少一样全 ⇒ 只剥 LS 这一份重复快照；LS 反而更长＝谁新
        //   说不出，两份都留着，不赌。LS 写得进的机器走原路，一字未动。
        if (lsWriteDead()) {
          if (typeof idbVal === 'string' && idbVal.length >= lsVal.length) {
            if (!memoryCache) memoryCache = {};
            if (!(k in memoryCache)) memoryCache[k] = idbVal;
            try { if (localStorage.getItem(k) === lsVal) localStorage.removeItem(k); } catch (e0) {}
          }
          next(); return;
        }
        // IDB 缺失/落后 → 以 LS 为最新追平 IDB，写成功且 LS 未变才删（绝不先删后写）
        window.idbSet(k, lsVal).then(function (ok) {
          if (ok) {
            let cur = null;
            try { cur = localStorage.getItem(k); } catch (e) {}
            if (cur === lsVal) {
              if (!memoryCache) memoryCache = {};
              if (!(k in memoryCache)) memoryCache[k] = lsVal;
              try { localStorage.removeItem(k); } catch (e) {}
            }
          } else { markFail(); } // #721 追平写失败（配额满/事务挂了）：这轮没清掉，稍后重试
          next();
        }).catch(function () { markFail(); next(); });
      }).catch(function () { markFail(); setTimeout(step, 0); });
    })();
  }
  document.addEventListener('mochi-restore-done', function () { setTimeout(lsResidueSweep, 20000); });
  setTimeout(lsResidueSweep, 45000); // restore 挂起/事件丢失兜底（_lsSweepDone 防重入）
  window.idbLsResidueSweep = lsResidueSweep;

  // v3.16.x：跨上下文同步——get 改 memoryCache 优先后，另一上下文（PWA + 浏览器标签双开、
  // 多窗口）写入 localStorage 的新值会被本侧 memoryCache 旧值遮蔽。storage 事件（仅跨上下文
  // 触发）到达时删除对应缓存键，后续 get 自然回退读到 localStorage 新值；业务侧（如
  // avatar-lib 的 storage 监听）随后触发界面刷新。e.key 是完整键（含前缀），与 memoryCache 键一致。
  window.addEventListener('storage', function (e) {
    try {
      if (e && e.key && memoryCache && e.key in memoryCache) delete memoryCache[e.key];
    } catch (err) {}
  });
})();

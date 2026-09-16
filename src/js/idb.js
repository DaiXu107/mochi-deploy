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
    dbPromise = new Promise((resolve, reject) => {
      try {
        if (!window.indexedDB) { reject(new Error('no idb')); return; }
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
          try { dbPromise = null; } catch (e1) {}
          reject(new Error('idb open blocked'));
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
      // v3.26.x #135：open() 兜底落地——iOS/Edge 内核存在「open 请求既不 success
      // 也不 error 也不 blocked」的挂起形态（IDB 服务进程被杀瞬间发起的请求）。原实现
      // 各事务超时计时器都注册在 open().then 里，open 不落地则计时器永不启动 →
      // idbGet/idbGetMany/idbListKeys/idbRestore 全部永久挂起，开屏永远停在
      // 「正在加载数据…」（iPad 7 + Edge 实测）。8s 未落地判失败：清 dbPromise 让
      // 下次调用重建连接，调用方 catch 走 LS 兜底/慢保险丝，开屏永不卡死。
      setTimeout(function () {
        try { dbPromise = null; } catch (e2) {}
        reject(new Error('idb open hang'));
      }, 8000);
    });
    // v3.6.x 修复（open 失败永久不可用）：失败时清 dbPromise 允许下次重试——
    // 原实现缓存 rejected Promise，整个会话 IDB 永久不可用（隐私模式/配额耗尽/
    // 浏览器临时禁用 IDB 后恢复时无法自愈）
    dbPromise.catch(() => { dbPromise = null; });
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
          staticText: '近期数据多次写入失败，数据可能没有存上。建议按顺序处理：\n\n'
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
    function tryOnce() {
      return open().then(db => new Promise((resolve) => {
        let done = false;
        // v3.26.x：超时按值体积放大（大包误报修复，见 _idbFailNotify 上方说明）。
        // v3.26.x OOM：聊天记录改 IDB 直存数组（structured clone，免整包 JSON.stringify）——
        // 数组也按估算体积放大超时，否则 150MB 级数组在慢设备上 >4s 被判挂起、误触发回退重写。
        let lim = 4000;
        try {
          let est = 0;
          if (typeof value === 'string') est = value.length;
          else if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
              const m = value[i];
              if (typeof m === 'string') { est += m.length; continue; }
              if (!m || typeof m !== 'object') { est += 32; continue; }
              const t = m.text; if (typeof t === 'string') est += t.length;
              const im = m.img; if (typeof im === 'string') est += im.length;
              const vc = m.voice; if (typeof vc === 'string') est += vc.length;
              const ps = m.parts;
              if (Array.isArray(ps)) { for (let j = 0; j < ps.length; j++) { const p = ps[j]; if (p && typeof p.v === 'string') est += p.v.length; } }
              est += 64;
            }
          }
          if (est > 262144) lim = 4000 + Math.min(26000, Math.ceil(est / 262144) * 2000);
        } catch (e) {}
        const t = setTimeout(function () {
          if (done) return; done = true;
          dbPromise = null; // 连接疑似挂起，下次 open 重建
          resolve(false);
        }, lim);
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => { if (done) return; done = true; clearTimeout(t); resolve(true); };
          tx.onerror = () => { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (tx.error && tx.error.name) || 'error'; if (connLost(tx.error)) dbPromise = null; resolve(false); };
          tx.onabort = () => { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (tx.error && tx.error.name) || 'abort'; if (connLost(tx.error)) dbPromise = null; resolve(false); };
        } catch (e) { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (e && e.name) || 'error'; if (connLost(e)) dbPromise = null; resolve(false); }
      })).catch(() => false);
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
  window.idbGet = function (key) {
    return open().then(db => new Promise((resolve) => {
      let done = false;
      let timer = null;
      function finish(val) { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(val); }
      function run() {
        try {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => finish(req.result);
          req.onerror = () => { if (connLost(req.error)) dbPromise = null; finish(undefined); };
        } catch (e) { if (connLost(e)) dbPromise = null; finish(undefined); }
      }
      let retried = false;
      timer = setTimeout(function () {
        if (done) return;
        if (!retried) {
          retried = true;
          // v3.25.x：重建连接再试——挂起超时多因连接已死（iOS 挂后台杀 IDB 服务），
          // 原地重试只会再等 4 秒；重开后新连接通常当场返回
          dbPromise = null;
          open().then(function (db2) {
            db = db2;
            run();
            timer = setTimeout(function () { dbPromise = null; finish(undefined); }, 4000);
          }).catch(function () { finish(undefined); });
          return;
        }
        dbPromise = null;
        finish(undefined);
      }, 4000);
      run();
    })).catch(() => undefined);
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
            req.onsuccess = () => { out[k] = req.result; if (--pending <= 0) finish(); };
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
      req.onsuccess = () => finish(req.result || []);
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
      req.onsuccess = () => finish((req.result || 0) > 0);
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

  // v3.16.x：localStorage「写失败脏键」集合——set 时 localStorage.setItem 抛异常
  // （配额满/隐私模式）说明 LS 快照残留旧值，回填时这些键必须信 IndexedDB 而不是 LS。
  // 持久化双份：sessionStorage（同标签页刷新有效）+ IndexedDB 的 __ls-dirty 键
  // （跨浏览器重启仍有效——配额满/隐私模式通常持续，只有 IDB 是可靠源，用它记住
  // 哪些键的 LS 是坏的，回填时避开，不破坏 v3.16.x「IDB 权威」语义）。
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
        return null;
      },
      set(k, v) {
        const key = prefix + ':' + k;
        // v3.5.111：内存缓存无条件初始化并写入——大键（壁纸/头像池等）只进 IDB + 内存、
        // 不进 localStorage；若缓存未初始化（页面刚加载、IDB 恢复未完成）就上传大图，
        // 会既不在 localStorage 也不在内存缓存，切回桌面时读空导致壁纸被清掉。
        if (!memoryCache) memoryCache = {};
        memoryCache[key] = v;
        try { bigIdxTrack(key, v); } catch (e) {}
        try { wrjRecord(key, v); } catch (e) {}
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
          try { localStorage.removeItem(key); } catch (e) {}
        }
        try { if (window.idbSet) window.idbSet(key, v); } catch (e) {}
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
    return tail === 'chat-msgs' || /^[^:]+:chat-msgs$/.test(tail);
  }
  // v3.42.x #426：群聊消息键（全局 xy-home-v2:group-chat-msgs / 自定义群 xy-home-v2:gc-msgs-<gid>，
  // 键名生成见 group-chat.js groupMsgKey）。与 chat-msgs 同族：IDB 权威 + LS lite 快照
  //（gcWriteMsgs 维护），大记录（>3MB）为结构化数组直存。
  function isGroupMsgsKey(k) {
    if (!k || typeof k !== 'string') return false;
    return k === 'xy-home-v2:group-chat-msgs' || /^xy-home-v2:gc-msgs-.+$/.test(k);
  }

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
    Promise.all([window.idbGetAllKeys(), window.idbGet(LS_DIRTY_KEY)]).then(res => {
      const keys = res[0];
      try {
        const arr = JSON.parse(res[1] || '[]');
        if (Array.isArray(arr) && arr.length) {
          if (!_lsDirtyKeys) _lsDirtyKeys = new Set();
          arr.forEach(k => { if (k) _lsDirtyKeys.add(k); });
          try { sessionStorage.setItem(LS_DIRTY_KEY, JSON.stringify(Array.from(_lsDirtyKeys))); } catch (e) {}
        }
      } catch (e) {}
      if (!keys || !keys.length) { finish(); return; }
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
        if (memoryCache && (k in memoryCache)) return false;
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
        if (lsVal !== null && !(_lsDirtyKeys && _lsDirtyKeys.has(k))) {
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
          req.onsuccess = () => finish(req.result === undefined ? null : req.result);
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
      if (!(memoryCache && (key in memoryCache))) {
        let str = typeof v === 'string' ? v : JSON.stringify(v);
        // 与 retainValue 同规则（v3.16.x 摸鱼天数回退修复）：LS 有值且未写失败 →
        // 以 LS 为准（IDB 异步写可能未落地）；LS 缺失/写失败 → 用 IDB 值；不回写 IDB
        let lsVal = null;
        try { lsVal = localStorage.getItem(key); } catch (e) {}
        if (lsVal !== null && !(_lsDirtyKeys && _lsDirtyKeys.has(key))) {
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
  const WRJ_MAX = 40;              // 条数上限
  const WRJ_BUDGET = 128 * 1024;   // 值字符总量上限（防日志本身膨胀拖慢每次 set）
  const WRJ_VAL_LIMIT = 64 * 1024; // 单值超过不记录（大键有自己的恢复路径）
  let _wrj = null;                 // [{k, v, t}]，按 key 去重、最新在前
  let _wrjTimes = {};              // key -> 最近一次已知写入时间（回放/合并/本会话写入共用）
  let _wrjMerged = false;
  function wrjLoad(raw) {
    try {
      const a = JSON.parse(raw || '[]');
      return Array.isArray(a) ? a.filter(function (e) { return e && typeof e.k === 'string' && typeof e.v === 'string' && typeof e.t === 'number'; }) : [];
    } catch (e) { return []; }
  }
  function wrjLsRaw() { try { return localStorage.getItem(WRJ_KEY); } catch (e) { return null; } }
  function wrjPersist() {
    try { localStorage.setItem(WRJ_KEY, JSON.stringify(_wrj || [])); } catch (e) {}
  }
  // v3.26.x 存储优化：标记合并落库——原实现每个小键 set 各发一个 IDB 事务写时间戳标记，
  // 值事务之外白翻倍事务数；现积攒 150ms 用 idbSetAll 单事务批量写。语义不变：值事务在
  // xyStore.set 里同步先发出，flush 时早已入队（值先于标记提交）；150ms 内立刻退出浏览器的
  // 极端窗口由下方 pagehide/visibilitychange 即时冲刷兜住，且主防线本就是同步写的 LS 日志。
  // idbSetAll 无重试骨架，返回 false 时退回逐键 idbSet（自带 3 次重试）。
  const WRJ_MARK_FLUSH_MS = 150;
  let _wrjMarkBuf = new Map(); // 完整标记键 -> t
  let _wrjMarkT = null;
  function wrjMarkFlush() {
    if (_wrjMarkT) { clearTimeout(_wrjMarkT); _wrjMarkT = null; }
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
  function wrjMark(key, t) {
    _wrjMarkBuf.set(WRJ_MARK + key, t);
    if (!_wrjMarkT) _wrjMarkT = setTimeout(wrjMarkFlush, WRJ_MARK_FLUSH_MS);
  }
  function wrjUnmark(key) {
    _wrjMarkBuf.delete(WRJ_MARK + key); // 还没落库的标记直接撤销，省一个删除事务
    try { if (window.idbDelete) window.idbDelete(WRJ_MARK + key); } catch (e) {}
  }
  function wrjRecord(key, v) {
    if (typeof v !== 'string' || v.length > WRJ_VAL_LIMIT) return;
    if (!key || key === WRJ_KEY || key.indexOf('__') >= 0) return;
    if (isChatMsgsKey(key) || /:chat-meta$/.test(key) || key.indexOf('music-file:') >= 0) return;
    if (!_wrj) _wrj = wrjLoad(wrjLsRaw());
    const t = Date.now();
    _wrj = _wrj.filter(function (e) { return e.k !== key; });
    _wrj.unshift({ k: key, v: v, t: t });
    let chars = 0, cut = _wrj.length;
    for (let i = 0; i < _wrj.length; i++) {
      chars += _wrj[i].v.length;
      if (i >= WRJ_MAX || chars > WRJ_BUDGET) { cut = i; break; }
    }
    if (cut < _wrj.length) _wrj.length = cut;
    _wrjTimes[key] = t;
    wrjPersist();
    wrjMark(key, t);
  }
  function wrjForget(key) {
    if (!_wrj) _wrj = wrjLoad(wrjLsRaw());
    const before = _wrj.length;
    _wrj = _wrj.filter(function (e) { return e.k !== key; });
    _wrjTimes[key] = Date.now();
    if (_wrj.length !== before) wrjPersist();
    wrjUnmark(key);
  }
  // 离页即时冲刷待写标记，压缩「写完立刻退出」丢标记的窗口
  try {
    document.addEventListener('visibilitychange', function () {
      try { if (document.visibilityState === 'hidden') wrjMarkFlush(); } catch (e) {}
    });
  } catch (e) {}
  try { if (window.addEventListener) window.addEventListener('pagehide', wrjMarkFlush); } catch (e) {}
  // 回放：把日志里的「最近一次写入」补进 内存+LS。时间戳守卫保证只应用比
  // 已知写入更新的条目（不会覆盖本会话新写入的值）。
  function wrjReplay(entries) {
    if (!entries || !entries.length) return 0;
    if (!memoryCache) memoryCache = {};
    let n = 0;
    entries.forEach(function (e) {
      if ((_wrjTimes[e.k] || 0) >= e.t) return;
      _wrjTimes[e.k] = e.t;
      if (memoryCache[e.k] === e.v) return;
      memoryCache[e.k] = e.v;
      try { if (e.v.length <= LS_BIG_LIMIT) localStorage.setItem(e.k, e.v); } catch (e2) {}
      // #339 修复锚：WRJ_REPLAY_NO_IDB 恒真——回放值可能是被回滚的旧值，回写 IDB 会踩掉
      // 更新的值（见下方 FIX 注释）；此守卫若被翻转/删除恢复无条件 idbSet，即本 bug 回归
      if (!WRJ_REPLAY_NO_IDB) { try { if (window.idbSet) window.idbSet(e.k, e.v); } catch (e2) {} }
      n++;
    });
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
  try { wrjReplay(wrjLoad(wrjLsRaw())); } catch (e) {}
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
  function lsResidueSweep() {
    if (_lsSweepDone) return;
    _lsSweepDone = true;
    if (!window.idbGet || !window.idbSet) return;
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
      return typeof v === 'string' && v.length > LS_BIG_LIMIT;
    });
    let i = 0;
    (function step() {
      if (i >= cands.length) return;
      const k = cands[i++];
      let lsVal = null;
      try { lsVal = localStorage.getItem(k); } catch (e) {}
      if (typeof lsVal !== 'string' || lsVal.length <= LS_BIG_LIMIT) { setTimeout(step, 0); return; }
      window.idbGet(k).then(function (idbVal) {
        const next = function () { setTimeout(step, 0); };
        if (idbVal && typeof idbVal !== 'string') { next(); return; }
        if (typeof idbVal === 'string' && idbVal === lsVal) {
          // 纯去重：IDB 已有同值，LS 副本是双倍计费残留；删前复读防业务刚写入新值
          try { if (localStorage.getItem(k) === lsVal) localStorage.removeItem(k); } catch (e) {}
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
          }
          next();
        }).catch(next);
      }).catch(function () { setTimeout(step, 0); });
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

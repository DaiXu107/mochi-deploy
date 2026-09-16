// ===== #142 媒体池（内容寻址去重）=====
// 问题：聊天记录/收藏里同一张表情包/图片每发一次就整份 base64 存一遍（诊断实证
// chat-msgs 全桌面 ≈214MB，其中同一批字卡表情重复占大头）。
// 方案：图片 dataURL 按 SHA-256 内容哈希存进全局媒体池（IndexedDB 键 xy-home-v2:media:<hash>，
// 只存一份），消息/收藏里替换为令牌 @@m:<hash32>。令牌跨桌面/跨会话/跨设备（备份携带池键）
// 稳定自描述。渲染解析集中在本文档级 MutationObserver——img[src^="@@m:"] 内存命中同步重写、
// 未命中异步取回后重写，业务渲染代码零改动。
// 数据安全底线：
//   · 池数据落盘先于引用落盘（normalize 流程先 mochiMediaFlush 再 saveMsgs）——崩溃窗口内
//     最多「池多一条孤儿」，绝不会出现「令牌入库而池数据丢失」；
//   · 写池前先查池（idbGetMany 批量）——已有同哈希条目不重复写，跨会话零重写；
//   · crypto.subtle 不可用（非安全上下文）时整模块禁用，一切保持旧路径，绝无半启用态；
//   · v1 池只增不删（无 GC），孤儿条目体积=去重后的唯一内容量，可控。
// FIX 2026-09-10 #283 池收音频：tokenize 放行 data:audio/（语音）——历史语音/语音字卡以
// 「名称|||data:audio/…」整份内联在消息 text，chat-msgs 常年几十 MB，每次落盘 structured
// clone 整包＝低端机长任务/「经常卡按不动」。音频内容唯一（录音无法去重缩总库），但令牌化后
// 每次落盘只 clone 44 字符引用。音频纪律：①不进 map 热缓存（迁移批量会把省下的内存吃回去），
// ②播放走 mochiMediaExpandAsync 按需 idbGet；图片路径（map/观察器）行为不变。
// 消费方：chat.js（消息令牌化 normalize + 编辑入口展开 + 语音播放取回）、chat.js 收藏压缩管道（CAS）。
// 注意：本文件须在 chat.js 之前加载（渲染解析要先于首屏渲染就位），jsFiles 已登记。
(function () {
  const FULL = 'xy-home-v2:media:';
  const TOK = '@@m:';
  const TOKEN_RE = /^@@m:([0-9a-f]{32})$/;
  // 非安全上下文/无 IDB → 整模块禁用（提供恒空展开，业务侧按 null 回退原值）
  const OK = typeof crypto !== 'undefined' && crypto.subtle && window.idbGet && window.idbGetMany && window.idbSetAll;
  window.mochiMediaExpand = function (s) { return null; };
  // #283 音频令牌异步取回（禁用态恒 null，调用方按缺失占位）
  window.mochiMediaExpandAsync = function (s, cb) { try { cb(null); } catch (e) {} };
  window.mochiMediaIsToken = function (s) { return typeof s === 'string' && TOKEN_RE.test(s); };
  if (!OK) return;

  const map = new Map();            // hash -> dataURL（已解析/已落池内容，渲染热缓存）
  // FIX 2026-09-13 #387 令牌缺失负缓存——公用库被 #377 写回泄漏持久化令牌后，无池数据
  // 的设备（公用库跨设备共享不带池键）令牌永远解不出图＝字卡库纯白图/面板空分组/发出去
  // 全是坏图。这里记录「idbGet 确认缺失」的 hash：①mochiMediaTokenMissing 供媒体筛选端
  // 剔除（不 send 白图卡）；②观察器给已渲染 img 打 media-tok-missing 占位（诚实可见，
  // 不再纯白）。可自愈：idbGet 后续读到有效值即从 missing 除名（不学 #275 永久负缓存，
  // 导入完整备份补回池键后下次渲染即恢复）。
  const missing = new Set();        // hash -> true（idbGet 确认池缺失）
  // FIX 2026-09-13 #397 缺失重试冷却——旧行为每次渲染/每次 DOM 变动都对缺失令牌再打一次
  // idbGet，「池没带过来」的设备（iOS Safari/多机型大库）一屏几十个坏图＝每秒几十次 IDB
  // 读 + 多次 querySelectorAll，主线程被占满＝「界面卡住点不动」（iPhone 16 Safari 报障，
  // 与其他机型同族）。60s 冷却窗口内不再重读（导入完整备份时靠 mochi-restore-done 立即清空，
  // 自愈语义不丢）；命中有效值仍即时除名。
  // 防风暴（不影响自愈）——①同一 img 元素对同一令牌只尝试一次：观察器重扫/属性抖动不再
  // 重复打 IDB，而新渲染的元素照常重试＝池补回后立即自愈（#275 语义保留，verify-media-pool
  // T9 实证）；②全局在飞上限：坏图成片的设备不再一次打出几十个 IDB 读把主线程打满
  //（iPhone 16 Safari「界面卡住点不动」，与其他机型同族）。
  let missReads = 0;
  const MISS_READ_MAX = 8;
  // #450 miss 读在飞看门狗：IDB 拥塞/内核挂起（#229 家族）时 idbGet 可能迟回不回，
  // 不释放槽位＝missReads 永久占满＝此后所有令牌图全部饿死成裂图。到期只放行「读槽」，
  // 迟到的结果照常结算（settle 单飞防双扣）。15s 取「慢机一次大库读的数倍」量级。
  const TOK_WATCH_MS = 15000;
  // #450 miss 读重试泵：MISS_READ_MAX=8 并发上限下，一屏令牌图超过上限的部分（收藏页
  // 大量旧收藏/字卡库大组首屏）拿不到读也不再被扫——src 保持 @@m: 令牌＝浏览器当相对
  // URL 请求 404＝iOS 裂图问号黑块（#402 同款表现）。原实现只在「DOM 再变更」时才重扫，
  // 静态页面（收藏列表翻到底不再动）饿死图永久裂＝「收藏大量内容加载失败，只出现问号
  // 黑块」多机型同报。这里每次 miss 读结算后 300ms 防抖全文档补扫一轮：map 已热/inflight
  // 在飞/tokTried 已试/missing 已占位的哈希天然跳过，只重试被上限饿死的图，逐波清零。
  // 防抖幂等，无常驻定时器；上限满时本轮直接放弃（等下次结算再泵）。
  let missPumpT = null;
  function missRetryPump() {
    if (missPumpT) return;
    missPumpT = setTimeout(function () {
      missPumpT = null;
      if (missReads >= MISS_READ_MAX) return;
      try { scanRoot(document); } catch (e) {}
    }, 300);
  }
  window.mochiMediaTokenMissing = function (s) { const m = TOKEN_RE.exec(s || ''); return !!(m && missing.has(m[1])); };
  // FIX 2026-09-13 #397 批量打占位——旧实现每个缺失 hash 各做一次全文档 querySelectorAll，
  // 坏图成片的设备（池数据没跟过来的大库）一次渲染几十次查询＝主线程尖峰；改为攒批 + 单次扫描。
  const markQueue = new Set();
  let markT = null;
  // FIX 2026-09-13 #402 缺失占位换成内联 SVG（原方案保留令牌 src＝浏览器当相对 URL 去请求
  // 404＝iOS 裂图问号黑块；占位后不再发无效请求，池补回后新渲染元素照常解图）
  const MISS_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="100%" height="100%" fill="#ececec"/><text x="50%" y="50%" font-size="14" fill="#9a9a9a" text-anchor="middle" dominant-baseline="middle">图片缺失</text></svg>');
  function flushMissingMarks() {
    markT = null;
    if (!markQueue.size) return;
    const list = Array.prototype.slice.call(markQueue); markQueue.clear();
    let nodes;
    try { nodes = document.querySelectorAll('img[src^="' + TOK + '"]'); } catch (e) { nodes = []; }
    Array.prototype.forEach.call(nodes, function (el) {
      let m; try { m = TOKEN_RE.exec(el.getAttribute('src') || ''); } catch (e2) { m = null; }
      if (!m || list.indexOf(m[1]) < 0) return;
      try { el.classList.add('media-tok-missing'); el.alt = '图片缺失'; el.src = MISS_PLACEHOLDER; } catch (e3) {}
    });
  }
  function markMissing(h) {
    markQueue.add(h);
    if (markT) return;
    markT = setTimeout(flushMissingMarks, 120);
  }
  // FIX 2026-09-14 #439 文字占位登记自愈——chat.js 按本模块官方判定（mochiMediaTokenMissing
  // 确认缺失）把「图片丢失」文字占位换掉 img 后，观察器/rebuild 的自愈都只重写 img[src^=@@m:]，
  // 摸不到已替换的占位＝「点了重建媒体池还是丢失」。这里按 hash 登记 {占位, 原 img}，池补回时
  // 原位换回真图（resolveImg 成功路径与 mochiMediaRebuild heal 均触发 mochiMediaPhRestore）。
  const phReg = new Map();          // hash -> [占位 span（.__mochiImg=原 img）]
  window.mochiMediaPhRegister = function (h, ph, img) {
    if (!ph || !ph.nodeType || !TOKEN_RE.test(TOK + h)) return;
    let list = phReg.get(h);
    if (!list) { list = []; phReg.set(h, list); }
    if (list.indexOf(ph) < 0) { ph.__mochiImg = img || null; list.push(ph); }
  };
  window.mochiMediaPhRestore = function (h, v) {
    const list = phReg.get(h);
    if (!list || typeof v !== 'string' || v.indexOf('data:image/') !== 0) return;
    phReg.delete(h);
    list.forEach(function (ph) {
      try {
        const im = ph.__mochiImg;
        if (im) {
          try { ph.replaceWith(im); } catch (e2) {}
          im.classList.remove('media-tok-missing');
          im.removeAttribute('alt');
          im.src = v;
        }
      } catch (e) {}
    });
  };
  const inflight = {};              // hash -> true（渲染侧单飞取回）
  let writeBuf = [];                // 待落池 [{k,v}]
  let flushT = null;
  // 真实现（OK 路径）：令牌→池内容；未知哈希/非令牌→null（调用方按 null 回退原值）
  window.mochiMediaExpand = function (s) {
    const m = TOKEN_RE.exec(s || '');
    return m ? (map.get(m[1]) || null) : null;
  };
  // FIX 2026-09-10 #283 音频令牌异步取回：map 命中（本会话刚写池未冲刷的窗口）或按需
  // idbGet；校验 data:audio/ 前缀（图片走观察器不经过这里）；音频绝不回填 map（内存纪律，
  // 见文件头）；取不到（池缺失/被剥空/脏值）→ null，调用方按「语音数据缺失」占位。
  window.mochiMediaExpandAsync = function (s, cb) {
    const done = function (v) { try { cb(v); } catch (e) {} };
    const m = TOKEN_RE.exec(String(s || ''));
    if (!m) { done(null); return; }
    const c = map.get(m[1]);
    if (typeof c === 'string' && c.indexOf('data:audio/') === 0) { done(c); return; }
    window.idbGet(FULL + m[1]).then(function (v) {
      done(typeof v === 'string' && v.indexOf('data:audio/') === 0 ? v : null);
    }).catch(function () { done(null); });
  };
  // FIX 2026-09-15 #503 令牌完整解析（字卡库导出还原用）：map 命中直回，否则 idbGet
  // 池键原值（不限音频，图片/任意 data: 都回）；不回填 map（导出属一次性全量读，
  // 遵守 #377 内存纪律）；非令牌/池缺失 → null。
  window.mochiMediaResolve = function (s) {
    const m = TOKEN_RE.exec(String(s || ''));
    if (!m) return Promise.resolve(null);
    const c = map.get(m[1]);
    if (typeof c === 'string' && c) return Promise.resolve(c);
    return window.idbGet(FULL + m[1]).then(function (v) {
      return (typeof v === 'string' && v) ? v : null;
    }).catch(function () { return null; });
  };

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    const arr = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, '0');
    return out.slice(0, 32); // 128 位十六进制前缀——实际内容寻址撞库概率为 0，键长可控
  }
  window.mochiMediaFlush = function () {
    if (flushT) { clearTimeout(flushT); flushT = null; }
    if (!writeBuf.length) return Promise.resolve(true);
    const buf = writeBuf.splice(0);
    return window.idbSetAll(buf).then(function (ok) {
      if (!ok) { writeBuf = buf.concat(writeBuf); scheduleFlush(); }
      return ok;
    }).catch(function () { writeBuf = buf.concat(writeBuf); scheduleFlush(); return false; });
  };
  function scheduleFlush() { if (!flushT) flushT = setTimeout(function () { flushT = null; window.mochiMediaFlush(); }, 300); }
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') window.mochiMediaFlush();
    });
  } catch (e) {}

  // 池探测队列：同一哈希的多次 tokenize 合并成一次 idbGetMany（跨记录重复表情只查/写一次）
  const lookupQueue = new Map();    // hash -> { data, cbs:[] }
  let lookupT = null;
  window.mochiMediaTokenize = function (dataUrl, opts) {
    return new Promise(function (resolve) {
      // FIX 2026-09-10 #283 放行 data:audio/（语音令牌化）；<1024 小载荷不进池
      if (typeof dataUrl !== 'string' || dataUrl.length < 1024 ||
          (dataUrl.indexOf('data:image/') !== 0 && dataUrl.indexOf('data:audio/') !== 0)) { resolve(null); return; }
      sha256Hex(dataUrl).then(function (h) {
        if (map.has(h)) { resolve(TOK + h); return; }
        let q = lookupQueue.get(h);
        if (!q) { q = { data: dataUrl, cbs: [], nc: !!(opts && opts.noCache) }; lookupQueue.set(h, q); }
        q.cbs.push(resolve);
        if (!lookupT) lookupT = setTimeout(runLookups, 60);
      }).catch(function () { resolve(null); });
    });
  };
  async function runLookups() {
    lookupT = null;
    if (!lookupQueue.size) return;
    const entries = Array.from(lookupQueue.entries());
    lookupQueue.clear();
    let dirty = false;
    for (let i = 0; i < entries.length; i += 40) {
      const slice = entries.slice(i, i + 40);
      let vals = {};
      try { vals = (await window.idbGetMany(slice.map(function (e) { return FULL + e[0]; }))) || {}; } catch (e) { vals = {}; }
      slice.forEach(function (e) {
        const v = vals[FULL + e[0]];
        // FIX 2026-09-10 #283 只有图片进 map 热缓存；音频内容唯一且体积大（一次语音迁移
        // 可达几十 MB），缓存=把令牌化省下的内存原样吃回，只写池/查池不缓存
        // #377 noCache 选项：字卡库大库内存瘦身令牌化用——池命中/新写都不进 map 热缓存，
        // 渲染时走下方 resolveImg 懒解析按需进 map（只驻留真正显示过的图）
        const isImg = e[1].data.indexOf('data:image/') === 0;
        const nc = !!e[1].nc;
        if (typeof v === 'string') { if (isImg && !nc) map.set(e[0], v); }          // 池里已有（跨会话/桌面重复）→ 不重写
        else { if (isImg && !nc) map.set(e[0], e[1].data); writeBuf.push({ k: FULL + e[0], v: e[1].data }); dirty = true; }
        e[1].cbs.forEach(function (cb) { try { cb(TOK + e[0]); } catch (e2) {} });
      });
      await new Promise(function (r) { setTimeout(r, 0); }); // 分批让出主线程
    }
    if (dirty) scheduleFlush();
  }

  // ===== 集中渲染解析：img[src^="@@m:"] → 池数据 =====
  function resolveImg(img) {
    const m = TOKEN_RE.exec(img.getAttribute('src') || '');
    if (!m) return;
    const h = m[1];
    const v = map.get(h);
    if (v) { img.src = v; return; }
    if (inflight[h]) return;
    try { if (img.dataset && img.dataset.tokTried === h) return; } catch (e) {}
    // #450 被上限饿死的图不再无声返回——登记一次防抖补扫（本轮上限没满时直接被下方
    // 正常读走，泵空转一次无害）；饿死图未设 tokTried，泵补扫时会正常重试
    if (missReads >= MISS_READ_MAX) { missRetryPump(); return; }
    try { if (img.dataset) img.dataset.tokTried = h; } catch (e) {}
    inflight[h] = true;
    missReads++;
    // #450 单飞结算收口：释放槽位（inflight/missReads）与「处理结果」解耦——看门狗到期
    // 或 idbGet 返回，谁先到谁结算，只结算一次（防 missReads 被超量扣减）；结算后泵一轮
    // 补扫，把被上限饿死的图逐波清掉。迟到的 idbGet 结果照常按下方体检处理。
    const __tokSt = { settled: false };
    const __tokSettle = function () {
      if (__tokSt.settled) return;
      __tokSt.settled = true;
      clearTimeout(__tokWatch);
      delete inflight[h];
      missReads = Math.max(0, missReads - 1);
      missRetryPump();
    };
    const __tokWatch = setTimeout(function () { __tokSettle(); }, TOK_WATCH_MS);
    window.idbGet(FULL + h).then(function (v2) {
      __tokSettle();
      // FIX 2026-09-10 #275 池值体检：池里只可能存 data:image/ 字符串（tokenize 入口已保证）。
      // 读到空串/脏值（旧「只备份文字」备份把池 dataURL 剥成 "" 再导入所致）绝不能当有效数据：
      // 原 `typeof v2 !== 'string'` 放行空串 → map 永久缓存 '' + img.src=''（解析成页面 URL）
      // ＝永久坏图且占位误报「网络不通」。改与「池缺失」同路：保持令牌原样交给 #186/#202 占位；
      // 日后导入完整备份补回池键，下次渲染经此处重读即自愈（不入 map 负缓存，缺数据可重试）。
      // FIX 2026-09-16 #547 落池竞态不标缺失：read-miss 但本哈希还在 writeBuf 待冲刷
      // （scheduleFlush 300ms 防抖窗口内，表情面板渲染→观察器读池先于 idbSetAll 落库）＝
      // 不是真缺失。旧路径直接 missing.add → isMediaImg 把令牌卡剔出面板（贴纸「消失/
      // 变少」+ 签名数量骤变 → 整面板重建＝「每次打开都重新加载」复发）。改为：不标缺失、
      // 清 tokTried 放行本图重试，交给 missRetryPump 在落池后补扫自愈；flush 真失败/被丢时
      // writeBuf 已清，下轮读仍 miss 才走原缺失占位路径（真缺数据设备行为不变）。
      if (typeof v2 !== 'string' || v2.indexOf('data:image/') !== 0) {
        let pending = false;
        for (let wi = 0; wi < writeBuf.length; wi++) { if (writeBuf[wi] && writeBuf[wi].k === FULL + h) { pending = true; break; } }
        if (pending) {
          try { if (img.dataset && img.dataset.tokTried === h) delete img.dataset.tokTried; } catch (eTT) {}
          missRetryPump();
          return;
        }
        missing.add(h); markMissing(h); return;
      }
      missing.delete(h); // 后续读到有效值＝池已补回（导入完整备份等），解除剔除/占位
      map.set(h, v2);
      try { window.mochiMediaPhRestore(h, v2); } catch (ePH) {} // #439 已换文字占位的原位换回自愈
      let nodes;
      try { nodes = document.querySelectorAll('img[src="' + TOK + h + '"]'); } catch (e) { nodes = []; }
      Array.prototype.forEach.call(nodes, function (el) { el.src = v2; });
    }).catch(function () { __tokSettle(); });
  }
  function scanRoot(root) {
    if (!root) return;
    let nodes;
    try { nodes = root.querySelectorAll ? root.querySelectorAll('img[src^="' + TOK + '"]') : null; } catch (e) { return; }
    if (nodes) Array.prototype.forEach.call(nodes, resolveImg);
    if (root.tagName === 'IMG') resolveImg(root);
  }
  try {
    const obs = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const mu = muts[i];
        if (mu.type === 'attributes' && mu.target && mu.target.tagName === 'IMG') resolveImg(mu.target);
        else if (mu.type === 'childList') {
          for (let j = 0; j < mu.addedNodes.length; j++) scanRoot(mu.addedNodes[j]);
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  } catch (e) {}
  // FIX 2026-09-13 #397 数据恢复时清空缺失负缓存与冷却——导入完整备份（携带池键）后，
  // 原本判缺的令牌立即重试解析，不必等冷却窗口过期或重启
  try {
    document.addEventListener('mochi-restore-done', function () { missing.clear(); });
  } catch (e) {}
  // 观察器挂载前已存在的 DOM（本脚本先于 body 尾部业务渲染执行，正常为空）兜底扫一遍
  function bootScan() { scanRoot(document); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootScan);
  else bootScan();

  // ===== FIX 2026-09-14 #435 令牌批量预热（渲染方主动调，首个消费方=聊天表情面板）=====
  // 背景：面板一次渲染几十张令牌图，原路径＝懒加载逐图补 src → 观察器逐个 resolveImg →
  // miss 读 idbGet（MISS_READ_MAX=8 并发排队）→ 重写 src → 再解码，五段异步串行＝冷启动
  // 图慢半拍、低端机迟迟不出图。预热＝渲染方把整组 hash 一次性交来：过滤 map 已有/在飞/
  // 已确认缺失/本会话已预热过的，剩余分批 idbGetMany（单事务批量读，每批 8 个，批间让出
  // 主线程），读到有效值走 resolveImg 完成态同款语义（map.set + missing.delete + 全文档
  // 重写匹配 img）。与观察器互斥：预热在飞期间占 inflight[h]，观察器对同 hash 不再重复
  // 打 IDB；读到脏值不 markMissing（占位仍交观察器原逻辑），只记已试防整组重渲染重扫
  //（#397 防风暴同款纪律）。
  const warmSeen = new Set();
  const warmQueue = [];
  let warmT = null;
  function warmPump() {
    warmT = null;
    const batch = warmQueue.splice(0, 8);
    if (!batch.length) return;
    window.idbGetMany(batch.map(function (h) { return FULL + h; })).then(function (vals) {
      vals = vals || {};
      batch.forEach(function (h) {
        delete inflight[h];
        const v = vals[FULL + h];
        if (typeof v !== 'string' || v.indexOf('data:image/') !== 0) return; // 脏值/缺失：不进 map 不占位
        missing.delete(h);
        if (!map.has(h)) map.set(h, v);
        let nodes;
        try { nodes = document.querySelectorAll('img[src="' + TOK + h + '"]'); } catch (e) { nodes = []; }
        Array.prototype.forEach.call(nodes, function (el) { el.src = v; });
      });
      if (warmQueue.length) warmT = setTimeout(warmPump, 0);
    }).catch(function () {
      batch.forEach(function (h) { delete inflight[h]; }); // 整批失败：放行观察器原路径自愈
    });
  }
  window.mochiMediaWarmTokens = function (hashes) {
    if (!Array.isArray(hashes)) return;
    for (let i = 0; i < hashes.length; i++) {
      const h = String(hashes[i] || '');
      if (!/^[0-9a-f]{32}$/.test(h) || warmSeen.has(h)) continue;
      warmSeen.add(h);
      if (map.has(h) || missing.has(h) || inflight[h]) continue;
      inflight[h] = true;
      warmQueue.push(h);
    }
    if (warmQueue.length && !warmT) warmT = setTimeout(warmPump, 0);
  };

  // ===== v3.26.x 存储优化：孤儿媒体 GC（mark-and-sweep）=====
  // 背景：#142 v1 池只增不删——消息/收藏删除后池内图片永留，长账用户池底越滚越大。
  // 安全底线（宁可漏删、绝不误删）：
  //   · mark 集 = 全部 *:chat-msgs + *:fav-msgs（含旧顶层键）里的令牌 ∪ 本会话
  //     map/writeBuf/inflight（含「刚令牌化还没落库」的新图）——令牌只由 chat.js 写进
  //     消息与收藏（#142 设计），扫描面即全覆盖；
  //   · 引用键逐键串行读，读完即弃引用（峰值内存≈最大单个聊天包）；
  //   · 清单读失败 / 任一引用键读不到（idbGet 超时返回 undefined 与「键不存在」不可分）
  //     → 整次放弃不删：没读到可能藏着唯一引用，删了就是永久坏图；
  //   · 只删池键，绝不动聊天/收藏；确认交互由调用方（查看存储页）负责。
  window.mochiMediaGC = function () {
    // FIX 2026-09-14 #441 进度回传走 arguments[0]（零参签名保持不变，#423 哨兵锚点不动）
    const prog = typeof arguments[0] === 'function' ? arguments[0] : null;
    return (async function () {
      const out = { ok: false, reason: '', orphans: [], bytes: 0, poolN: 0, refN: 0 };
      if (!window.idbListKeys || !window.idbGet || !window.idbGetMany) { out.reason = '接口不可用（需安全上下文）'; return out; }
      try { await window.mochiMediaFlush(); } catch (e) {}
      const keys = await window.idbListKeys();
      if (!keys) { out.reason = '键清单读取失败（存储繁忙），本次不清理'; return out; }
      const SCAN_RE = /@@m:([0-9a-f]{32})/g;
      const keep = new Set();
      map.forEach(function (_v, h) { keep.add(h); });
      writeBuf.forEach(function (p) { keep.add(String(p.k).slice(FULL.length)); });
      Object.keys(inflight).forEach(function (h) { keep.add(h); });
      // FIX 2026-09-06 #186 引用扫描面补全：旧正则 /(?:^|:)(?:chat-msgs|fav-msgs)$/ 漏了
      // ①群聊键 xy-home-v2:group-chat-msgs / :gc-msgs-<gid>（前缀是 group- 不是 :，不匹配）
      // ②LS 快照/尾巴日志（#180：IDB 写失败机型上消息只在 localStorage/xy-home-v2:<cid>:chat-tail）
      // → 这些引用的表情/图片令牌被误判孤儿删除 = 单发表情包/图片变空白气泡且不可逆。
      // 修复：REFS 扩到群聊+尾巴键；并追加扫描 localStorage 同名键（读到的令牌全部进 keep，
      // 宁可漏删绝不误删；LS 读异常时放弃本次清理）。
      const REFS = /(?:^|:)(?:chat-msgs|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail|cc-groups(?:-public)?)$/;
      // FIX 2026-09-15 #506 引用面补字卡库两键：#387 修复前写回泄漏/旧备份导入会把 @@m: 令牌
      // 留在 cc-groups / cc-groups-public 里，同样引用池条目——不进 keep 会被误判孤儿删除
      // ＝字卡库图片（含导出还原源）永久丢失。GC 与 Coverage 两处同批。
      const refKeys = keys.filter(function (k) { return REFS.test(String(k)); });
      try {
        for (let li = 0; li < localStorage.length; li++) {
          const lk = localStorage.key(li);
          if (lk && REFS.test(lk)) refKeys.push('__ls__' + lk);
        }
      } catch (lErr) { out.reason = 'localStorage 读取失败（存储繁忙），为安全起见本次不清理'; return out; }
      out.refN = refKeys.length;
      // FIX 2026-09-14 #441 大库冻结修复：chat-msgs 在 IDB 是数组直存（大桌面单键 40MB+），
      // 旧逻辑整包 JSON.stringify＝几十秒长任务冻结主线程＝页面假死、中途锁屏/切后台被杀
      // 扫描永不完成＝「点了没反应、永远等不到弹窗」（红米K80 实报）。改为逐条小 stringify
      //（令牌 44 字符完整落在单条消息内，按条切分不会切断令牌），每 128 条让出主线程。
      const yieldUI = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
      const scanKeep = function (s) { SCAN_RE.lastIndex = 0; let m; while ((m = SCAN_RE.exec(s))) keep.add(m[1]); };
      for (let i = 0; i < refKeys.length; i++) {
        let v;
        if (refKeys[i].indexOf('__ls__') === 0) {
          // FIX 2026-09-06 #186 LS 引用键：令牌可能在 LS 快照/尾巴日志里有、IDB 还没落——必须一并标记
          try { v = localStorage.getItem(refKeys[i].slice(6)); } catch (e2) { v = undefined; }
          if (v === undefined || v === null) continue; // 该 LS 键刚好被清＝无引用可标，不构成放弃条件
        } else {
          v = await window.idbGet(refKeys[i]);
          if (v === undefined || v === null) { out.reason = '有聊天记录/收藏没读到（存储繁忙？），为安全起见本次不清理'; return out; }
        }
        try { if (prog) prog(i + 1, refKeys.length, '读取引用'); } catch (eP1) {}
        if (typeof v === 'string') { scanKeep(v); }
        else if (Array.isArray(v)) {
          for (let j = 0; j < v.length; j++) {
            const mi = v[j];
            let s = '';
            try { s = typeof mi === 'string' ? mi : (mi && typeof mi === 'object' ? JSON.stringify(mi) : ''); } catch (e8) { out.reason = '引用数据序列化失败，本次不清理'; return out; }
            if (s) scanKeep(s);
            if ((j & 127) === 127) await yieldUI();
          }
        } else {
          try { scanKeep(JSON.stringify(v) || ''); } catch (e9) { out.reason = '引用数据序列化失败，本次不清理'; return out; }
        }
        await yieldUI();
      }
      const poolKeys = keys.filter(function (k) { return String(k).indexOf(FULL) === 0; });
      out.poolN = poolKeys.length;
      const orphans = [];
      for (let i = 0; i < poolKeys.length; i++) {
        if (!keep.has(String(poolKeys[i]).slice(FULL.length))) orphans.push(String(poolKeys[i]));
      }
      // 孤儿体积只用于报告：分批读、读完即弃（峰值≈一批×单图大小）
      let bytes = 0;
      for (let i = 0; i < orphans.length; i += 16) {
        const batch = orphans.slice(i, i + 16);
        let vals = {};
        try { vals = (await window.idbGetMany(batch)) || {}; } catch (e3) {}
        batch.forEach(function (k) { const v = vals[k]; if (typeof v === 'string') bytes += v.length * 2; });
      }
      out.orphans = orphans;
      out.bytes = bytes;
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), orphans: [], bytes: 0, poolN: 0, refN: 0 }; });
  };
  // 扫描报告里的孤儿真正删除（查看存储页确认后调用）；返回成功删除条数
  window.mochiMediaGCApply = function (orphans) {
    return (async function () {
      const list = (orphans || []).map(String);
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        let ok = false;
        try { ok = await window.idbDelete(list[i]); } catch (e) { ok = false; }
        if (ok) { map.delete(list[i].slice(FULL.length)); n++; }
      }
      return n;
    })();
  };
  // FIX 2026-09-14 媒体池核对（校验「图片丢失」是『备份没带池』还是『链路没写回』）：
  // 导入完整备份后跑一次，比对「聊天/收藏/群聊/尾巴引用到的唯一令牌数」vs「池里真正存在的条数」。
  // 返回 { referenced:引用令牌总数, inPool:池内在数, missing:池内缺数, missingSamples:个别缺串 }。
  // 诊断口径：inPool≈referenced 且 missing=0 → 数据链完好，占位会随重渲染自愈；
  //           missing 大 → 池键确实没回来（要么备份是文字降级包，要么源端本就没池数据），
  //           需重导「含图片的完整备份」；inPool=0 → 备份完全没带池键。
  // 只读、纯查（不写不删）；批 40 查池规避 IDB 风暴（与 GC/runLookups 同纪律）。
  window.mochiMediaCoverage = function () {
    // FIX 2026-09-14 #441 进度回传走 arguments[0]（零参签名不变），调用方实时显示扫描进度
    const prog = typeof arguments[0] === 'function' ? arguments[0] : null;
    return (async function () {
      const out = { ok: false, reason: '', referenced: 0, inPool: 0, missing: 0, missingSamples: [] };
      if (!window.idbListKeys || !window.idbGet || !window.idbGetMany) { out.reason = '接口不可用（需安全上下文/IDB）'; return out; }
      const REFS = /(?:^|:)(?:chat-msgs|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail|cc-groups(?:-public)?)$/;
      const SCAN_RE = /@@m:([0-9a-f]{32})/g;
      let keys;
      try { keys = await window.idbListKeys(); } catch (e) { out.reason = '键清单读取失败'; return out; }
      if (!Array.isArray(keys)) { out.reason = '键清单非法'; return out; }
      // 引用面 = IDB 的聊天/收藏/群聊/尾巴键 + localStorage 同名键（含 #186 LS 快照/尾巴）
      const refKeys = keys.filter(function (k) { return REFS.test(String(k)); });
      try { for (let i = 0; i < localStorage.length; i++) { const lk = localStorage.key(i); if (lk && REFS.test(lk)) refKeys.push('__ls__' + lk); } } catch (e) {}
      const refs = new Set();
      // FIX 2026-09-14 #441 与 GC 同款大库冻结修复：chat-msgs 在 IDB 是数组直存（大桌面单键
      // 40MB+），旧逻辑整包 JSON.stringify＝几十秒长任务冻结主线程＝页面假死、零进度反馈、
      // 中途锁屏/切后台页面被杀扫描永不完成＝「核对/重建点了没反应、永远等不到结果弹窗」。
      // 改为逐条小 stringify（令牌 44 字符完整落在单条消息内，按条切分不会切断令牌），
      // 每 256 条让出主线程＋逐键进度回传，UI 全程可响应。
      const yieldUI = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
      const scanTokens = function (s) { SCAN_RE.lastIndex = 0; let m; while ((m = SCAN_RE.exec(s))) refs.add(m[1]); };
      for (let i = 0; i < refKeys.length; i++) {
        let v;
        const rk = refKeys[i]; const isLs = rk.indexOf('__ls__') === 0;
        try { if (prog) prog(i + 1, refKeys.length, isLs ? '本地快照' : '聊天/收藏'); } catch (eP2) {}
        if (isLs) { try { v = localStorage.getItem(rk.slice(6)); } catch (e2) { v = undefined; } }
        else { try { v = await window.idbGet(rk); } catch (e2) { v = undefined; } }
        if (v === undefined || v === null) continue;
        if (typeof v === 'string') { scanTokens(v); }
        else if (Array.isArray(v)) {
          for (let j = 0; j < v.length; j++) {
            const mg = v[j];
            let s = '';
            try { s = typeof mg === 'string' ? mg : (mg && typeof mg === 'object' ? JSON.stringify(mg) : ''); } catch (e3) { continue; }
            if (s) scanTokens(s);
            if ((j & 255) === 255) await yieldUI();
          }
        } else {
          try { scanTokens(JSON.stringify(v) || ''); } catch (e4) {}
        }
        await yieldUI();
      }
      const uniq = Array.from(refs);
      out.referenced = uniq.length;
      const bad = [];
      for (let i = 0; i < uniq.length; i += 40) {
        const batch = uniq.slice(i, i + 40);
        let vals = {};
        try { vals = (await window.idbGetMany(batch.map(function (h) { return FULL + h; }))) || {}; } catch (e3) { vals = {}; }
        batch.forEach(function (h) { const v = vals[FULL + h]; if (typeof v !== 'string' || v.indexOf('data:') !== 0) bad.push(h); });
      }
      out.inPool = uniq.length - bad.length;
      out.missing = bad.length;
      out.missingSamples = bad.slice(0, 8);
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), referenced: 0, inPool: 0, missing: 0, missingSamples: [] }; });
  };
  // FIX 2026-09-13 #423 媒体池一键重建（图片自愈）：#275 实锤「多机型反复图片丢失的真相」——
  // 旧「只备份文字」导出把池值剥成空串但留下键，空池条目随完整备份在多设备间传播；池键在、
  // 值是 ''，令牌永远解不出图，且重导「完整备份」也救不回（源头池同样是空的）。
  // 池是内容寻址（令牌 = SHA-256(dataURL) 前缀），本机任何键里还留着的同一张图原始 dataURL
  //（字卡库/收藏/表情分组/头像库/壁纸/备份快照等）都是合法来源——扫出来按哈希把「缺失/空串」
  // 池条目补回，同名令牌立即恢复解析。安全底线：
  //   · 只写「池缺失或值非法」的条目，绝不覆盖有效池值；绝不删除任何键、绝不改业务数据；
  //   · 来源扫描只读（LS 全键 + IDB 非池非音乐键；聊天记录数组走浅层字段扫，不做整包
  //     stringify——几十 MB 长任务风险，与 device.js 诊断 sizeOf 同纪律）；
  //   · 写池批 40 idbSetAll，整批失败退回逐键 idbSet（自带重试），再失败如实计 writeFail；
  //   · 补回后清缺失负缓存并直接重写已渲染占位 img（dataset.tokTried 会挡观察器重试，
  //     必须主动重写才算即时自愈）。
  window.mochiMediaRebuild = function () {
    // FIX 2026-09-14 #441 进度回传走 arguments[0]（零参签名不变，#423 哨兵锚点不动）
    const prog = typeof arguments[0] === 'function' ? arguments[0] : null;
    return (async function () {
      const out = { ok: false, reason: '', poolN: 0, validN: 0, brokenN: 0, foundN: 0, written: 0, alreadyOk: 0, writeFail: 0, bytes: 0 };
      const yieldUI = function () { return new Promise(function (r) { setTimeout(r, 0); }); }; // #441 阶段间让出主线程
      if (!window.idbListKeys || !window.idbGet || !window.idbGetMany || !window.idbSetAll || !window.idbSet) { out.reason = '接口不可用（需安全上下文/IDB）'; return out; }
      try { await window.mochiMediaFlush(); } catch (e) {}
      let keys;
      try { keys = await window.idbListKeys(); } catch (e) { out.reason = '键清单读取失败'; return out; }
      if (!Array.isArray(keys)) { out.reason = '键清单非法'; return out; }
      const POOL_RE = /^xy-home-v2:media:[0-9a-f]{32}$/;
      // ① 池体检：有效（data:image|audio 字符串）/ 破损（缺失、空串、非 data: 值）
      const poolKeys = keys.filter(function (k) { return POOL_RE.test(String(k)); });
      out.poolN = poolKeys.length;
      const valid = new Set();
      for (let i = 0; i < poolKeys.length; i += 40) {
        const batch = poolKeys.slice(i, i + 40);
        let vals = {};
        try { vals = (await window.idbGetMany(batch)) || {}; } catch (e) { vals = {}; }
        batch.forEach(function (k) {
          const v = vals[k];
          if (typeof v === 'string' && (v.indexOf('data:image/') === 0 || v.indexOf('data:audio/') === 0)) valid.add(String(k).slice(FULL.length));
        });
        try { if (prog) prog(Math.min(poolKeys.length, i + 40), poolKeys.length, '核对池内条目'); } catch (eP3) {}
        await yieldUI(); // #441 批间让出主线程（池 741+ 条×大值，连读会冻结 UI）
      }
      out.validN = valid.size;
      out.brokenN = poolKeys.length - valid.size;
      // ② 收集本机存留的原始图片 dataURL（任何键里的副本都算，按完整 dataURL 去重）
      // 注：业务存储里 dataURL 全部在 JSON 引号/分隔符内（","body":"data:...），正则边界安全；
      // 极端「零分隔相邻两个 dataURL」会把后者的 data 前缀吞进前者的游程（真实格式不存在）。
      const DATA_RE = /data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]{1024,}/g;
      const found = new Map();
      let foundBytes = 0;
      function scanString(s) {
        if (typeof s !== 'string' || s.length < 1100) return;
        DATA_RE.lastIndex = 0;
        let m;
        while ((m = DATA_RE.exec(s))) {
          const d = m[0];
          if (!found.has(d)) { found.set(d, true); foundBytes += d.length * 2; }
        }
      }
      function scanValue(v) {
        if (typeof v === 'string') { scanString(v); return; }
        if (Array.isArray(v)) { // 聊天记录 IDB 直存数组——浅层扫字段（与 device.js sizeOf 同口径）
          for (let i = 0; i < v.length; i++) {
            const m = v[i];
            if (typeof m === 'string') { scanString(m); continue; }
            if (!m || typeof m !== 'object') continue;
            if (typeof m.text === 'string') scanString(m.text);
            if (typeof m.img === 'string') scanString(m.img);
            if (typeof m.voice === 'string') scanString(m.voice);
            const ps = m.parts;
            if (Array.isArray(ps)) { for (let j = 0; j < ps.length; j++) { const p = ps[j]; if (p && typeof p.v === 'string') scanString(p.v); } }
          }
        }
      }
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const lk = localStorage.key(i);
          if (!lk) continue;
          let v = null;
          try { v = localStorage.getItem(lk); } catch (e2) { v = null; }
          if (v) scanString(v);
        }
      } catch (e) { out.reason = 'localStorage 读取失败（存储繁忙），本次只扫了部分来源'; }
      const srcKeys = keys.filter(function (k) {
        k = String(k);
        return !POOL_RE.test(k) && k.indexOf(':music-file:') < 0 && k.indexOf('__wr-j:') < 0;
      });
      for (let i = 0; i < srcKeys.length; i += 4) { // 批 4 读、逐个扫完即弃（峰值≈4×最大单键）
        try { if (prog) prog(i, srcKeys.length, '扫描本机副本'); } catch (eP4) {}
        const batch = srcKeys.slice(i, i + 4);
        let vals = {};
        try { vals = (await window.idbGetMany(batch)) || {}; } catch (e3) { vals = {}; }
        batch.forEach(function (k) { scanValue(vals[k]); vals[k] = null; });
        await yieldUI(); // #441 批间让出主线程防冻结
      }
      out.foundN = found.size;
      out.bytes = foundBytes;
      // ③ 算哈希、只补缺失/空串条目（有效池值绝不重写）
      const fill = [];
      const dataList = Array.from(found.keys());
      for (let i = 0; i < dataList.length; i++) {
        try { if (prog) prog(i, dataList.length, '校验哈希'); } catch (eP5) {}
        let h = '';
        try { h = await sha256Hex(dataList[i]); } catch (e4) { continue; }
        if (valid.has(h)) { out.alreadyOk++; continue; }
        fill.push({ k: FULL + h, v: dataList[i] });
        if ((i & 15) === 15) await new Promise(function (r) { setTimeout(r, 0); }); // 让出主线程
      }
      for (let i = 0; i < fill.length; i += 40) {
        const batch = fill.slice(i, i + 40);
        let ok = false;
        try { ok = await window.idbSetAll(batch); } catch (e5) { ok = false; }
        if (ok !== true) { // 整批失败退回逐键（idbSet 自带重试）
          for (let j = 0; j < batch.length; j++) {
            let ok1 = false;
            try { ok1 = await window.idbSet(batch[j].k, batch[j].v); } catch (e6) { ok1 = false; }
            if (ok1) heal(batch[j]); else out.writeFail++;
          }
        } else {
          batch.forEach(function (p) { heal(p); });
        }
      }
      function heal(p) {
        const h = String(p.k).slice(FULL.length);
        valid.add(h);
        if (p.v.indexOf('data:image/') === 0) { map.set(h, p.v); try { window.mochiMediaPhRestore(h, p.v); } catch (ePH2) {} } // 音频不进热缓存（#283 内存纪律）；#439 占位原位换回
        missing.delete(h);
        out.written++;
      }
      // ④ 即时自愈：清负缓存 + 直接重写已渲染占位 img（tokTried 挡观察器重试，必须主动重写）
      if (out.written) {
        try {
          const nodes = document.querySelectorAll('img[src^="' + TOK + '"]');
          Array.prototype.forEach.call(nodes, function (el) {
            const m = TOKEN_RE.exec(el.getAttribute('src') || '');
            if (!m) return;
            const v = map.get(m[1]);
            if (!v) return;
            try { el.classList.remove('media-tok-missing'); el.removeAttribute('alt'); } catch (e7) {}
            el.src = v;
          });
        } catch (e8) {}
      }
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '重建异常：' + ((e && e.message) || e), poolN: 0, validN: 0, brokenN: 0, foundN: 0, written: 0, alreadyOk: 0, writeFail: 0, bytes: 0 }; });
  };
  // ===== #424 媒体池自动体检 + 主动弹窗一键修复 =====
  // 背景：#423 给了手动入口「设置→查看存储→媒体池」，但正处「图片丢失」状态的用户不知道要
  // 自己去找入口——用户明确提出「不能自己识别出异常，弹出弹窗叫我点击修复吗」。本模块把体检
  // 主动前移：等 IDB 回填就绪（__mochiDataReady）+ 开屏 splash 移除 + 页面可见且空闲后，跑一次
  // 只读 mochiMediaCoverage；missing > 0 弹窗提供「一键修复」（即 mochiMediaRebuild）。节流纪律：
  //   · 体检最多 24h 一次（全局根键 media-auto-check，走 xyStore 五件套，已登记 contacts EXCLUDE）；
  //   · 弹窗出现即写 snooze=now+72h——点取消/关弹窗/切走都算「暂不」，不再打扰（顺带规避
  //     #32 族「取消按钮无回调无法区分」坑：回调只处理点确定）；
  //   · 点「一键修复」→ 重建成功后按剩余缺失更新记录（0 → 恢复正常 24h 节奏）；
  //   · 体检失败（存储繁忙等）也算已体检（明天再试），避免每次启动都失败重扫。
  const AC_KEY = 'media-auto-check';
  function acWrite(o) { try { if (window.xyStore) window.xyStore('xy-home-v2').set(AC_KEY, JSON.stringify(o)); } catch (e) {} }
  // 纯函数（可测）：当前状态下是否该跑自动体检
  window.mochiMediaAutoShouldRun = function (st, now) {
    if (!st || typeof st !== 'object') return true;
    if (st.snooze && now < st.snooze) return false;
    return !(typeof st.t === 'number' && (now - st.t) < 86400000);
  };
  window.mochiMediaAutoCheck = function () {
    return (async function () {
      const out = { ran: false, skipped: '', missing: 0, repaired: 0 };
      const now = Date.now();
      let st = null;
      try { st = JSON.parse((window.xyStore && window.xyStore('xy-home-v2').get(AC_KEY)) || 'null'); } catch (e) { st = null; }
      if (!window.mochiMediaAutoShouldRun(st, now)) { out.skipped = '24h节流/免打扰中'; return out; }
      if (!window.mochiMediaCoverage || !window.mochiMediaRebuild) { out.skipped = '接口不可用'; return out; }
      const rep = await window.mochiMediaCoverage();
      if (!rep || !rep.ok) { acWrite({ t: now, missing: -1, snooze: 0 }); out.skipped = '体检未完成：' + ((rep && rep.reason) || ''); return out; }
      acWrite({ t: now, missing: rep.missing, snooze: 0 });
      out.ran = true;
      out.missing = rep.missing;
      if (!rep.missing || !window.openModal) return out;
      acWrite({ t: now, missing: rep.missing, snooze: now + 72 * 3600000 });
      await new Promise(function (res) {
        window.openModal('发现 ' + rep.missing + ' 张图片数据缺失', '', function () { res(); }, {
          noInput: true, okText: '一键修复',
          staticText: '聊天/收藏/字卡库里有 ' + rep.missing + ' 张引用的图片不在媒体池里，会显示「图片丢失」。\n\n现在扫描本机还留存的原图副本（字卡库/收藏/表情分组/头像库/壁纸/备份快照等）自动补回缺失的池条目：\n· 只补缺失/空串条目，不改任何其他数据，不删除任何数据；\n· 补得回多少取决于本机还留有多少原图副本；\n· 扫描需通读本机数据，请保持页面打开。'
        });
      });
      try { if (typeof toast === 'function') toast('正在重建媒体池，请稍候…'); } catch (e) {}
      const rb = await window.mochiMediaRebuild();
      if (!rb || !rb.ok) {
        if (window.openModal) window.openModal('修复未完成', '', null, { noInput: true, staticText: ((rb && rb.reason) || '未知原因') + '\n\n没有改动任何数据，稍后存储空闲时可到 设置→查看存储→媒体池 再试。' });
        return out;
      }
      acWrite({ t: Date.now(), missing: Math.max(0, rep.missing - rb.written), snooze: 0 });
      out.repaired = rb.written;
      const tpl = rb.written > 0
        ? ['已修复 ' + rb.written + ' 张！聊天/字卡库里的图片会自动恢复（当前页面的占位图已即时刷新）。']
        : ['本机没有可补回的原图副本。'];
      if (rb.written === 0) tpl.push('这些图片只能从还有它们的设备上导出「完整备份」（不要选「只备份文字」），再在本机导入恢复。');
      if (window.openModal) window.openModal('修复完成', '', null, { noInput: true, staticText: tpl.join('\n') });
      return out;
    })().catch(function () { return { ran: false, skipped: '异常', missing: 0, repaired: 0 }; });
  };
  // 自调度：等就绪（__mochiDataReady + splash 已移除，1s 轮询最多 10 分钟）→ 延 20s 让首屏
  // 先渲染 → 可见且无弹窗时才真正跑（不可见等 visibilitychange；有弹窗隔 60s 重试最多 3 次）。
  (function acKick(tries) {
    if (typeof document === 'undefined') return;
    if (!window.__mochiDataReady || document.getElementById('splash')) {
      if ((tries || 0) < 600) setTimeout(function () { acKick((tries || 0) + 1); }, 1000);
      return;
    }
    setTimeout(function () {
      const go = function () { try { window.mochiMediaAutoCheck(); } catch (e) {} };
      if (document.visibilityState !== 'visible') {
        const once = function () { document.removeEventListener('visibilitychange', once); go(); };
        document.addEventListener('visibilitychange', once);
        return;
      }
      if (document.querySelector('.modal')) {
        let n = 0;
        const t = setInterval(function () { n++; if (n > 3 || !document.querySelector('.modal')) { clearInterval(t); if (n <= 3) go(); } }, 60000);
        return;
      }
      go();
    }, 20000);
  })();
})();

// ===== #170 字卡库瘦身（查看存储页后端；纯逻辑+IDB，无 DOM 依赖，可被 verify 直载） =====
// 背景：#160 实测 cc-groups 双作用域 62.8MB（大头是自定义字卡里的 base64 GIF/大图），
// #160 只砍了新上传上限（CC_GIF_MAX_B64 512KB），存量清理一直靠用户自己翻字卡管理页
// 盲删——本模块给「查看存储」页提供按【分组】的体积扫描与整组删除：
//   · mochiCcSlimScan()：枚举公用键（cc-groups-public）/旧版顶层残留（cc-groups）/
//     各联系人专属键（<cid>:cc-groups），按分组统计体积与卡数，体积降序；
//   · mochiCcSlimDeleteGroup(prefix, key, cat, name)：按 分类+组名 整组删除，
//     与字卡管理页删掉该组数据语义完全一致。
// 数据安全底线：
//   · 读走 idbGet 权威层——大库常因启动驻留预算挂在 __xyIdbDeferredKeys，此时
//     store.get 会假空；idbGet 不受预算影响；
//   · 写回必须走 xyStore.set（内存缓存+LS+IDB 三路同拍）——chatcard.js 的各缓存
//     （pubCache / ccFuncOwnSrc 原始串身份缓存）都以「原始串换新」自动失效，与字卡
//     管理页自己的保存路径完全同源；
//   · 删除前重读当前值、在【当前值】上删组再写回——扫描到确认之间用户的编辑不丢；
//   · 只整组删除，不手术单卡；键读不到 / 结构不是 [组名, 卡数组] 二元组 / 组名匹配
//     不到 → 一律不动并如实返回 false。
(function () {
  const G = 'xy-home-v2:';
  function libs() {
    const out = [{ prefix: G, key: 'cc-groups-public', label: '公用字卡库' }];
    try {
      (window.getContacts ? window.getContacts() : []).forEach(function (c) {
        if (c && c.id) out.push({ prefix: G + c.id + ':', key: 'cc-groups', label: (c.name || c.id) + ' · 专属' });
      });
    } catch (e) {}
    // 旧版顶层键（多桌面功能之前的历史残留，chatcard 迁移逻辑的源头，有就扫）
    out.push({ prefix: G, key: 'cc-groups', label: '旧版顶层字卡库（残留）' });
    return out;
  }
  function parseLib(raw) {
    try {
      const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const g = JSON.parse(s || 'null');
      if (g && typeof g === 'object' && g.text) return g;
    } catch (e) {}
    return null;
  }
  window.mochiCcSlimScan = function () {
    return (async function () {
      const out = { ok: false, reason: '', libs: [], groups: [], totalBytes: 0 };
      if (!window.idbListKeys || !window.idbGet) { out.reason = '接口不可用'; return out; }
      const keys = await window.idbListKeys();
      if (!keys) { out.reason = '键清单读取失败（存储繁忙），稍后再试'; return out; }
      const keySet = {};
      keys.forEach(function (k) { keySet[String(k)] = true; });
      const list = libs().filter(function (L) { return keySet[L.prefix + L.key]; });
      for (let i = 0; i < list.length; i++) {
        const L = list[i];
        const raw = await window.idbGet(L.prefix + L.key);
        // 读不到只跳过该库并如实标注（可能不全），绝不据此当「空库」做任何写操作
        if (raw === undefined || raw === null) { out.reason = '字卡库「' + L.label + '」没读到（存储繁忙），结果可能不全'; continue; }
        const g = parseLib(raw);
        if (!g) continue;
        let libBytes = 0;
        Object.keys(g).forEach(function (cat) {
          const arr = g[cat];
          if (!Array.isArray(arr)) return;
          arr.forEach(function (tu) {
            if (!Array.isArray(tu) || typeof tu[0] !== 'string') return; // 非二元组结构不认，宁可少列不误删
            let bytes = 0;
            try { bytes = JSON.stringify(tu).length * 2; } catch (e) { return; }
            libBytes += bytes;
            out.groups.push({ prefix: L.prefix, key: L.key, label: L.label, cat: cat, name: tu[0], cards: Array.isArray(tu[1]) ? tu[1].length : 0, bytes: bytes });
          });
        });
        out.libs.push({ label: L.label, bytes: libBytes });
        out.totalBytes += libBytes;
      }
      out.groups.sort(function (a, b) { return b.bytes - a.bytes; });
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), libs: [], groups: [], totalBytes: 0 }; });
  };
  window.mochiCcSlimDeleteGroup = function (prefix, key, cat, name) {
    return (async function () {
      if (!window.idbGet || !window.xyStore) return false;
      // FIX 2026-09-16 #560：调用方传来的 prefix 带尾冒号（scan 的 libs 用 G='xy-home-v2:'），
      // 而 xyStore(prefix).set 内部再拼 ':'+key —— 尾冒号+冒号＝写出 xy-home-v2::cc-groups-public
      // 双冒号垃圾键，真实键从未被改：删除报「成功」、刷新后分组复活（删除从未真正落库）。
      // 这里剥尾冒号后再进 xyStore；读路径 idbGet(prefix+key) 是字符串直拼、本就正确，不动。
      const pStore = String(prefix).replace(/:$/, '');
      let raw = await window.idbGet(prefix + key);
      if (raw === undefined || raw === null) return false;
      const g = parseLib(raw);
      if (!g || !Array.isArray(g[cat])) return false;
      const before = g[cat].length;
      // 在【当前值】上删组（不是扫描快照）：扫描到确认之间用户的编辑不丢
      g[cat] = g[cat].filter(function (tu) { return !(Array.isArray(tu) && tu[0] === name); });
      if (g[cat].length === before) return false; // 组名没匹配到 → 不动
      let s = '';
      try { s = JSON.stringify(g); } catch (e) { return false; }
      try { window.xyStore(pStore).set(key, s); } catch (e) { return false; }
      // 同字节直写等 commit（对齐 #554 迁移同款 durable 收尾）：调用方随后读回即见删除生效
      try { await window.idbSet(pStore + ':' + key, s); } catch (e2) {}
      return true;
    })();
  };
})();
// ===== #411 卡顿自检 · 一键优化（只优化不删除，数据层纯逻辑，verify 可直载） =====
// 背景：iPhone 15 Pro Max + Chrome 等多机型报「卡顿」——诊断实锤主因是公用/专属字卡库
// 单键可达 44MB（#377/#387/#398 已做内存内令牌化瘦身，但大库的解析/按需取回仍是间歇冻结点）。
// 本模块只做「把大库预热/取回，移出用户关键路径」，绝不碰/删任何用户数据，跨设备零语义变化：
//   · mochiPerfLevel(totalBytes, bigGroups)：纯判定 轻/中/重；
//   · mochiPerfAgg(mochiCcSlimScan 结果)：聚合总占用与超大分组数，返回分级结论（无 DOM/IDB 依赖，可 verify）；
//   · mochiPerfHeal()：非破坏自愈——按需取回被启动回填挂起的大键库 + 预热令牌化回复池，
//     让后续打开聊天/字卡/回复不再触发 8s 慢读或 44MB 一次性解析（返回取回/预热摘要）。
(function () {
  window.mochiPerfLevel = function (totalBytes, bigGroups) {
    const mb = (Number(totalBytes) || 0) / 1048576;
    const bg = Number(bigGroups) || 0;
    if (mb > 16 || bg >= 6) return '重';
    if (mb > 5 || bg >= 2) return '中';
    return '轻';
  };
  // rep = mochiCcSlimScan() 返回对象；不动 rep，只聚合
  window.mochiPerfAgg = function (rep) {
    const agg = { ok: !!(rep && rep.ok), level: '轻', libs: 0, totalBytes: 0, biggestBytes: 0, bigGroups: 0, reason: (rep && rep.reason) || '' };
    if (!rep || !rep.ok) return agg;
    ((rep.libs) || []).forEach(function (l) { agg.libs += 1; agg.totalBytes += (l.bytes || 0); });
    ((rep.groups) || []).forEach(function (g) {
      const b = g.bytes || 0;
      if (b > agg.biggestBytes) agg.biggestBytes = b;
      if (b > 1048576) agg.bigGroups += 1; // 单分组 >1MB 通常是整组大图/动图媒体
    });
    agg.level = window.mochiPerfLevel(agg.totalBytes, agg.bigGroups);
    return agg;
  };
  // 非破坏自愈：取回挂起的大键 + 预热令牌化池。返回 { ok, hydrated, warmed, reason }。
  // prog(pct, label)：可选进度回调（pct 0-100，label 阶段文案），供调用方在取回/预热
  // 期间显示实时进度；不传时行为与原版完全一致（verify 资产/旧调用方零影响）。
  window.mochiPerfHeal = function (prog) {
    return (async function () {
      const out = { ok: false, hydrated: 0, warmed: 0, reason: '' };
      const step = function (pct, label) { if (typeof prog === 'function') { try { prog(pct, label); } catch (e) {} } };
      try {
        // ① 取回被启动回填预算挂起的大键库（公用 + 当前桌面专属），
        //    IDB 连得上的设备后续打开/回复即跳过 8s 慢读与反复 hydrate。
        if (window.hydrateLibScopes) {
          try {
            step(10, '取回大键库（读取本机存储）…');
            await window.hydrateLibScopes(['public', 'own']);
            out.hydrated = 2;
            step(40, '取回完成');
          }
          catch (e) { out.reason = '取回:' + ((e && e.message) || e); }
        } else { step(40, ''); }
        // ② 预热令牌化回复池：此处触发 44MB 解析+令牌化（#377/#398），
        //    在用户主动点击「一键优化」时完成，移出之后的聊天/回复关键路径。
        //    注：getCustomCards 是同步长任务，45→100 之间主线程被占、进度条停在
        //    「预热回复池…」直到任务结束翻页——属预期（总比干等/无声强）。
        if (window.getCustomCards) {
          try {
            step(45, '预热回复池（大库需稍等片刻）…');
            const cards = window.getCustomCards();
            out.warmed = Array.isArray(cards) ? cards.length : 0;
            step(100, '预热完成');
          }
          catch (e) { out.reason = (out.reason ? out.reason + '；' : '') + '预热:' + ((e && e.message) || e); }
        } else { step(100, ''); }
        out.ok = true;
        return out;
      } catch (e) { out.reason = (out.reason ? out.reason + '；' : '') + '自愈:' + ((e && e.message) || e); return out; }
    })();
  };
})();

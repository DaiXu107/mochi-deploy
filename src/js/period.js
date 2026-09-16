// ===== 功能：经期记录（桌面第三页） =====
// 记录经期开始/结束、预测下次经期、判断周期阶段（经期/排卵期/安全期）
// 数据 localStorage + IndexedDB 双写（键前缀 xy-home-v2:），纯本地无后端
// v3.10.x 全局共享：经期记录属"本人生理数据"，所有联系人桌面共用一份
//   全局键 xy-home-v2:period-*（参照 fish-log / garden-data-global 先例）。
//   首次启动 migrateToGlobal 遍历各联系人旧键合并去重写入全局并清理旧键
//   （period-migrated 标记幂等）。contacts.js EXCLUDE 已加 period-* 防
//   migrateLegacy 误迁全局键进 default 桌面。
// v3.10.x 增强：
//   1. 动态周期——取最近 6 次实际周期中位数 + 标准差 σ + CV 规律性徽章 + 黄体期反推
//   2. 置信区间渲染——预测日按高斯衰减着色（中心深边缘浅）
//   3. 每日属性——经量/症状/体温/情绪/备注，长按日格录入
//   4. 症状统计——常见症状 TOP3 + 频次柱状图
//   5. 本地通知——经期预测前 3/1/当天 + 延迟预警
//   6. 趋势图——近 12 次周期长度折线 + 均值线
//   7. 倒计时卡——大数字 + 圆环进度
(function () {
  var G = 'xy-home-v2';
  var store = window.xyStore(G);
  var page = document.getElementById('page-period');
  if (!store || !page) return;

  var KEY_REC = 'period-records';
  var KEY_CFG = 'period-cfg';
  var KEY_DAILY = 'period-daily';
  var KEY_NOTIFY = 'period-notify';
  var KEY_CARE = 'period-care-lines';

  // ---- 经期专属关心语（梦角触发，配合 ta-ask care 题库）----
  // v3.14.x：预设语单一数据源迁至 default-cards-data.js 的 DEFAULT_CARD_DATA.period
  //   （字卡库【系统预设字卡】「经期关心」tab 同源展示/逐张开关 dc-off-period:*，
  //   构建顺序保证其先于本文件加载）；此处仅留精简兜底防数据文件缺失。
  var PERIOD_CARE_FALLBACK = [
    '今天经期第几天了？肚子还痛不痛，要不要帮你揉揉',
    '记得喝点红糖水，别碰凉的，听话',
    '经期别太累了，早点躺下休息，我陪你',
    '经期情绪低落是正常的，不是你的错，我在',
    '抱抱，今天什么都不做也行，就躺着'
  ];
  function cardGroupLines(name, fb) {
    try {
      var g = window.DEFAULT_CARD_DATA && window.DEFAULT_CARD_DATA.period;
      if (Array.isArray(g)) {
        for (var i = 0; i < g.length; i++) {
          if (g[i] && g[i][0] === name && Array.isArray(g[i][1]) && g[i][1].length) return g[i][1];
        }
      }
    } catch (e) {}
    return fb;
  }
  var PERIOD_CARE_LINES = cardGroupLines('经期关心', PERIOD_CARE_FALLBACK);
  // v3.42.x #559：经期预警/推迟专属语（按语境 + 经期规律分级）——此前经前提醒日/推迟日
  //   与经期中共用「经期关心」语料（经期中口吻），经期还没到就发「今天经期第几天了？」
  //   （用户反馈①）。分级（用户反馈②「根据经期规律提醒」）：cycleStats 有效周期 ≥3 且
  //   CV<0.2（很规律+较规律）＝「预测可信」（rule），其余（不规律/记录不足）＝「预测仅
  //   参考」（free）——对后者不再说「推迟/晚了 N 天」（预测误差可能比推迟天数还大，
  //   用户反馈「太扯淡」），改以「距上次经期已经 {d} 天」的间隔口吻。{d} 由 checkCare
  //   替换为具体天数；「经期关心」标签与原语料仅经期中使用；单卡开关 dc-off-period:*。
  var PERIOD_PREWARN_FALLBACK = [
    '算算日子，还有 {d} 天左右可能就来经期了，这几天别贪凉',
    '经期快到了（预计 {d} 天后），提前把热水袋给你翻出来',
    '还有 {d} 天左右到经期，最近早点睡，经前别熬夜',
    '预计 {d} 天后来经期，这几天情绪有点波动也正常，有我在',
    '快到经期了（约 {d} 天后），卫生用品备好了吗？没有我提醒你',
    '还有 {d} 天左右经期就来，这几天少喝冰的，乖'
  ];
  var PERIOD_PREWARN_FREE_FALLBACK = [
    '记录上看，还有 {d} 天左右到经期——你的周期一向随性，就当个参考',
    '按你的记录粗算，大约 {d} 天后是经期，仅供参考，先有个准备',
    '大概还有 {d} 天？你的经期比较有个性，这条就当提个醒',
    '估摸 {d} 天前后，快到了就提前少碰凉的，不准也别怪我'
  ];
  var PERIOD_DELAY_FALLBACK = [
    '比平时晚了 {d} 天了，你一向很准的，这两天多留意，注意休息',
    '你周期一直挺稳的，这次晚了 {d} 天，最近是不是太累了？早点睡',
    '晚了 {d} 天了，先别慌，你的经期向来准时，注意保暖，再等等看',
    '按你的规律这次迟到了 {d} 天，压力大也会这样，别自己吓自己'
  ];
  var PERIOD_DELAY_DEEP_FALLBACK = [
    '已经比平时晚了 {d} 天了，你这么准的人都推迟这么久，建议关注一下身体',
    '晚了 {d} 天了，一直不来的话，陪你去看看医生吧，我先帮你记着日子',
    '推迟第 {d} 天了，你一向规律，这种情况别拖着，查一下更放心',
    '已经 {d} 天没来了，身体的事不拖，想什么时候去检查，我陪你'
  ];
  var PERIOD_DELAY_FREE_FALLBACK = [
    '距上次经期已经 {d} 天了，你的经期一向随性，再等等，别自己吓自己',
    '这次间隔到 {d} 天了，你的周期自由发挥惯了，正常，照顾好自己',
    '上次到现在 {d} 天了，你的经期从不按套路来，安心，我陪着你',
    '已经 {d} 天没来了，你的周期向来有自己的想法；超过两个月还没来就去看看医生吧'
  ];
  function loadCareLines() {
    try { var a = JSON.parse(store.get(KEY_CARE) || 'null'); if (Array.isArray(a)) return a; } catch (e) {}
    return PERIOD_CARE_LINES.slice();
  }
  function saveCareLines(a) {
    try {
      store.set(KEY_CARE, JSON.stringify(a));
      try { if (window.idbSet) window.idbSet(G + ':' + KEY_CARE, JSON.stringify(a)); } catch (e2) {}
    } catch (e) {}
  }
  function isCareOff(line) { return store.get('period-care-off:' + line) === '1'; }
  function setCareOff(line, off) { store.set('period-care-off:' + line, off ? '1' : '0'); }
  // v3.14.x：字卡库【经期关心】tab 的逐张开关（dc-off-period:<文案>）同样参与过滤——
  //   库内关掉某张 → 实际抽取也不再用它；与经期页「关心语管理」的旧开关（period-care-off:*）
  //   任一关闭即视为关闭（两处入口语义一致）
  function careLineBlocked(l) {
    if (isCareOff(l)) return true;
    try { if (window.isDefaultCardOff && window.isDefaultCardOff('period', l)) return true; } catch (e) {}
    return false;
  }

  function loadRecs() { try { return JSON.parse(store.get(KEY_REC) || '[]'); } catch (e) { return []; } }
  function saveRecs(list) {
    try {
      store.set(KEY_REC, JSON.stringify(list));
      try { if (window.idbSet) window.idbSet(G + ':' + KEY_REC, JSON.stringify(list)); } catch (e2) {}
    } catch (e) {}
  }
  function loadCfg() {
    try { var c = JSON.parse(store.get(KEY_CFG) || 'null'); if (c) return c; } catch (e) {}
    return { cycleLen: 28, periodLen: 5, lutealPhase: 14 };
  }
  function saveCfg(c) {
    try {
      store.set(KEY_CFG, JSON.stringify(c));
      try { if (window.idbSet) window.idbSet(G + ':' + KEY_CFG, JSON.stringify(c)); } catch (e2) {}
    } catch (e) {}
  }
  function loadDaily() { try { return JSON.parse(store.get(KEY_DAILY) || '{}'); } catch (e) { return {}; } }
  function saveDaily(obj) {
    try {
      store.set(KEY_DAILY, JSON.stringify(obj));
      try { if (window.idbSet) window.idbSet(G + ':' + KEY_DAILY, JSON.stringify(obj)); } catch (e2) {}
    } catch (e) {}
  }
  function loadNotify() {
    try { var n = JSON.parse(store.get(KEY_NOTIFY) || 'null'); if (n) return n; } catch (e) {}
    return { enabled: false, advanceDays: [3, 1, 0], hour: 9, careEnabled: true, fired: {} };
  }
  function saveNotify(n) {
    try {
      store.set(KEY_NOTIFY, JSON.stringify(n));
      try { if (window.idbSet) window.idbSet(G + ':' + KEY_NOTIFY, JSON.stringify(n)); } catch (e2) {}
    } catch (e) {}
  }
  // 启动时从 IDB 回填缺失键（导入备份/清空后不丢记录）
  (function restore() {
    try {
      if (!window.idbGet) return;
      var keys = [KEY_REC, KEY_CFG, KEY_DAILY, KEY_NOTIFY];
      keys.forEach(function (k) {
        if (!store.get(k)) window.idbGet(G + ':' + k).then(function (v) {
          if (!v) return;
          try { store.set(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {}
        });
      });
    } catch (e) {}
  })();

  // ---- v3.10.x 全局共享迁移：各联系人桌面旧 period-* 合并到全局键 ----
  // 等 mochi-restore-done（IDB 回填完）后跑，遍历所有联系人，把各桌面旧键
  // 合并去重写入全局 xy-home-v2:period-*，然后清理旧键，设 period-migrated 标记（幂等）。
  // records 用 normalize 合并重叠区间；daily 按日期并集合并属性；cfg/notify 取首个有效。
  function migrateToGlobal() {
    try {
      if (store.get('period-migrated')) return;
      if (!window.getContacts || !window.storeFor) return;
      var contacts = window.getContacts();
      var allRecs = [], allDaily = {}, mergedCfg = null, mergedNotify = null, hasAny = false;
      contacts.forEach(function (c) {
        try {
          var s = window.storeFor(c.id);
          var rRaw = s.get(KEY_REC);
          if (rRaw) { var r = JSON.parse(rRaw); if (Array.isArray(r) && r.length) { allRecs = allRecs.concat(r); hasAny = true; } }
          var dRaw = s.get(KEY_DAILY);
          if (dRaw) { var d = JSON.parse(dRaw); if (d && typeof d === 'object') { Object.keys(d).forEach(function (k) { if (!allDaily[k]) allDaily[k] = {}; Object.assign(allDaily[k], d[k]); }); hasAny = true; } }
          var cfRaw = s.get(KEY_CFG);
          if (cfRaw && !mergedCfg) { var cf = JSON.parse(cfRaw); if (cf && cf.cycleLen) { mergedCfg = cf; hasAny = true; } }
          var nfRaw = s.get(KEY_NOTIFY);
          if (nfRaw && !mergedNotify) { var nf = JSON.parse(nfRaw); if (nf) { mergedNotify = nf; hasAny = true; } }
        } catch (e) {}
      });
      if (hasAny) {
        if (allRecs.length) store.set(KEY_REC, JSON.stringify(normalize(allRecs)));
        if (Object.keys(allDaily).length) store.set(KEY_DAILY, JSON.stringify(allDaily));
        if (mergedCfg) store.set(KEY_CFG, JSON.stringify(mergedCfg));
        if (mergedNotify) store.set(KEY_NOTIFY, JSON.stringify(mergedNotify));
      }
      // 清理各桌面旧键（LS + IDB，storeFor 返回的 xyStore 三处同步）
      contacts.forEach(function (c) {
        try { var s = window.storeFor(c.id); s.remove(KEY_REC); s.remove(KEY_CFG); s.remove(KEY_DAILY); s.remove(KEY_NOTIFY); } catch (e) {}
      });
      store.set('period-migrated', '1');
      // 重载内存变量 + 刷新视图
      cfg = loadCfg(); recs = loadRecs(); daily = loadDaily(); notifyCfg = loadNotify();
      if (!page.hidden) { try { render(); checkNotify(); } catch (e) {} }
    } catch (e) {}
  }
  if (window.__mochiDataReady) { migrateToGlobal(); }
  else {
    try {
      document.addEventListener('mochi-restore-done', function h() {
        document.removeEventListener('mochi-restore-done', h);
        migrateToGlobal();
      });
    } catch (e) { migrateToGlobal(); }
  }

  var cfg = loadCfg();
  var recs = loadRecs();
  var daily = loadDaily();
  var notifyCfg = loadNotify();

  // ---- 日期工具 ----
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function diffDays(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 864e5); }
  function addDays(s, n) { var d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); }
  function todayStr() { return dayStr(new Date()); }
  function newId() { return Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36); }
  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }

  // ---- 记录规范化：按 start 排序，合并重叠/相邻（间隔≤1天视为同一次）----
  function normalize(list) {
    list = list.slice().sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    var out = [];
    list.forEach(function (r) {
      var last = out[out.length - 1];
      if (last) {
        var lastEnd = last.end || last.start;
        if (diffDays(lastEnd, r.start) <= 1) {
          if (r.end && (!last.end || r.end > last.end)) last.end = r.end;
          return;
        }
      }
      out.push({ id: r.id || newId(), start: r.start, end: r.end || null });
    });
    return out;
  }

  // ---- 周期统计（方案 1）：取最近 6 次实际周期，中位数 + 标准差 + CV ----
  function cycleStats() {
    var norm = normalize(recs);
    var diffs = [];
    for (var i = 1; i < norm.length; i++) {
      var d = diffDays(norm[i - 1].start, norm[i].start);
      if (d >= 15 && d <= 60) diffs.push(d);
    }
    var recent = diffs.slice(-6);
    var n = recent.length;
    if (!n) return { n: 0, median: cfg.cycleLen, mean: cfg.cycleLen, std: 0, cv: 0, diffs: diffs };
    var med = median(recent);
    var mean = recent.reduce(function (s, x) { return s + x; }, 0) / n;
    var variance = recent.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / n;
    var std = Math.sqrt(variance);
    return { n: n, median: med, mean: mean, std: std, cv: mean ? std / mean : 0, diffs: diffs };
  }
  function effCycleLen() { var s = cycleStats(); return s.n >= 3 ? s.median : cfg.cycleLen; }
  function effStd() { var s = cycleStats(); return s.n >= 3 ? s.std : 0; }
  // 黄体期反推：若 daily 标记了排卵症状日，luteal = 周期 - 排卵日，取近 3 次中位数
  function effLuteal() {
    var norm = normalize(recs);
    var cl = effCycleLen();
    var luDays = [];
    for (var i = 0; i < norm.length; i++) {
      var cs = norm[i].start;
      for (var ds in daily) {
        if (daily[ds] && daily[ds].symptoms && daily[ds].symptoms.indexOf('ovulation') >= 0) {
          var dc = diffDays(cs, ds) + 1;
          if (dc >= 8 && dc <= 24) { luDays.push(cl - dc); break; }
        }
      }
    }
    if (luDays.length >= 1) {
      var med = median(luDays.slice(-3));
      return Math.min(20, Math.max(7, Math.round(med)));
    }
    return cfg.lutealPhase || 14;
  }
  function luteal() { return effLuteal(); }
  function regularity() {
    var s = cycleStats();
    if (s.n < 3) return null;
    if (s.cv < 0.1) return { label: '很规律', cls: 'reg-good' };
    if (s.cv < 0.2) return { label: '较规律', cls: 'reg-mid' };
    return { label: '不规律', cls: 'reg-bad' };
  }

  // ---- PMS 经前综合征指数：基于黄体期症状记录 ----
  function pmsLevel() {
    var st = status();
    // 只在黄体期算（排卵后、下次经期前）
    if (st.inPeriod || !st.dayOfCycle || !st.ovulationDay || st.dayOfCycle <= st.ovulationDay) return null;
    recs = normalize(recs);
    var last = recs[recs.length - 1];
    if (!last) return null;
    var ovuDate = addDays(last.start, st.ovulationDay - 1);
    var today = todayStr();
    var score = 0, days = 0;
    for (var ds in daily) {
      if (ds < ovuDate || ds > today) continue;
      var info = daily[ds];
      if (!info) continue;
      var hasSym = info.symptoms && info.symptoms.length;
      if (hasSym) {
        days++;
        info.symptoms.forEach(function (s) {
          if (s === 'moodlow' || s === 'irritable') score += 2;
          else if (s === 'breast' || s === 'headache' || s === 'fatigue' || s === 'insomnia' || s === 'acne' || s === 'appetite') score += 1;
        });
      }
      if (info.mood && info.mood <= 2) score += 2;
    }
    var label, cls, tip;
    if (score >= 8) { label = 'PMS 重度'; cls = 'pms-heavy'; tip = '经前综合征较重，提前调整作息心情'; }
    else if (score >= 4) { label = 'PMS 中度'; cls = 'pms-mid'; tip = '经前反应明显，照顾好自己'; }
    else if (score >= 1) { label = 'PMS 轻微'; cls = 'pms-light'; tip = '经前反应轻，状态不错'; }
    else { return { score: 0, label: 'PMS 不明显', cls: 'pms-none', tip: '', days: 0 }; }
    return { score: score, label: label, cls: cls, tip: tip, days: days };
  }

  // ---- 当前状态 ----
  function status() {
    recs = normalize(recs);
    var today = todayStr();
    var cl = effCycleLen();
    var inPeriod = false, curRec = null;
    recs.forEach(function (r) {
      var end = r.end || addDays(r.start, cfg.periodLen - 1);
      if (today >= r.start && today <= end) { inPeriod = true; curRec = r; }
    });
    var last = recs[recs.length - 1];
    var baseStart = curRec ? curRec.start : (last ? last.start : null);
    var nextStart = null;
    var ovulationDay = cl - luteal();
    if (baseStart) {
      if (inPeriod) nextStart = addDays(curRec.start, cl);
      else { var s = baseStart; while (s <= today) s = addDays(s, cl); nextStart = s; }
    }
    var stats = cycleStats();
    var sigmaTxt = (stats.n >= 3 && stats.std >= 0.5) ? '（±' + Math.round(stats.std) + ' 天）' : '';
    if (inPeriod) {
      var dayOfPeriod = diffDays(curRec.start, today) + 1;
      var end2 = curRec.end || addDays(curRec.start, cfg.periodLen - 1);
      var remain = diffDays(today, end2) + 1;
      return { phase: 'period', inPeriod: true, nextStart: nextStart, dayOfCycle: dayOfPeriod, ovulationDay: ovulationDay, cycleLen: cl, title: '经期第 ' + dayOfPeriod + ' 天', sub: '预计还剩 ' + Math.max(0, remain) + ' 天 · 注意保暖休息', sigma: sigmaTxt };
    }
    if (!baseStart) return { phase: 'unknown', inPeriod: false, nextStart: null, dayOfCycle: 0, ovulationDay: ovulationDay, cycleLen: cl, title: '暂无记录', sub: '点下方按钮标记本次经期开始', sigma: '' };
    if (baseStart > today) return { phase: 'safe', inPeriod: false, nextStart: baseStart, dayOfCycle: 0, ovulationDay: ovulationDay, cycleLen: cl, title: '距下次经期约 ' + diffDays(today, baseStart) + ' 天' + sigmaTxt, sub: '已预记录未来经期开始', sigma: sigmaTxt };
    var dayOfCycle = diffDays(baseStart, today) + 1;
    if (dayOfCycle > cl) return { phase: 'safe', inPeriod: false, nextStart: nextStart, dayOfCycle: dayOfCycle, ovulationDay: ovulationDay, cycleLen: cl, title: '经期已推迟 ' + (dayOfCycle - cl) + ' 天', sub: '点下方按钮标记本次经期开始', sigma: sigmaTxt };
    if (dayOfCycle >= ovulationDay - 5 && dayOfCycle <= ovulationDay + 1) {
      var toOv = ovulationDay - dayOfCycle;
      return { phase: 'fertile', inPeriod: false, nextStart: nextStart, dayOfCycle: dayOfCycle, ovulationDay: ovulationDay, cycleLen: cl, title: '排卵期 · 第 ' + dayOfCycle + ' 天', sub: toOv > 0 ? '距排卵约 ' + toOv + ' 天' : (toOv === 0 ? '今天约为排卵日' : '排卵约 ' + (-toOv) + ' 天前'), sigma: sigmaTxt };
    }
    return { phase: 'safe', inPeriod: false, nextStart: nextStart, dayOfCycle: dayOfCycle, ovulationDay: ovulationDay, cycleLen: cl, title: nextStart ? '距下次经期约 ' + diffDays(today, nextStart) + ' 天' + sigmaTxt : '周期第 ' + dayOfCycle + ' 天', sub: '周期第 ' + dayOfCycle + ' 天', sigma: sigmaTxt };
  }

  // ---- 给定日期阶段（日历着色）----
  function dayPhase(ds) {
    recs = normalize(recs);
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var end = r.end || addDays(r.start, cfg.periodLen - 1);
      if (ds >= r.start && ds <= end) return 'period';
    }
    var last = recs[recs.length - 1];
    if (!last) return 'none';
    var today = todayStr();
    var cl = effCycleLen();
    var ovu = cl - luteal();
    // 所有周期起点（含最近一次实际开始 + 未来预测）
    var starts = [];
    var s = last.start, guard = 0;
    while (s <= addDays(today, cl * 3) && guard < 200) {
      starts.push(s);
      s = addDays(s, cl); guard++;
    }
    // 预测经期着色
    for (var j = 0; j < starts.length; j++) {
      var pEnd = addDays(starts[j], cfg.periodLen - 1);
      if (ds >= starts[j] && ds <= pEnd) return 'predict';
    }
    // 排卵期着色（排卵日前5天到后1天）
    for (var k = 0; k < starts.length; k++) {
      var ovStart = addDays(starts[k], ovu - 5 - 1);
      var ovEnd = addDays(starts[k], ovu + 1 - 1);
      if (ds >= ovStart && ds <= ovEnd) return 'fertile';
    }
    return 'none';
  }

  // ---- 暴露给外部模块（mood-reply-cards 经期情绪联动 / calendar 经期着色）----
  window.periodStatus = status;
  window.periodDayPhase = dayPhase;

  // ---- 梦角经期聊天语态：经期中 TA 的文字回复更温柔 ----
  // v3.26.x：温柔前缀受字卡库【其他互动功能字卡→经期→温柔前缀】单卡开关联动——
  // 六条前缀与 DEFAULT_CARD_DATA.period「温柔前缀」分组同源（v3.26.x 之前独立数组，未进
  // 字卡库）；逐张开关（dc-off-period:<文案>），关闭后该前缀不再随机拼出。开关键即文案本身。
  var PERIOD_WARM_PREFIX = (function () {
    try {
      var g = window.DEFAULT_CARD_DATA && window.DEFAULT_CARD_DATA.period;
      if (Array.isArray(g)) {
        for (var i = 0; i < g.length; i++) {
          if (g[i] && g[i][0] === '温柔前缀' && Array.isArray(g[i][1]) && g[i][1].length) {
            return g[i][1].slice();
          }
        }
      }
    } catch (e) {}
    return ['乖，', '傻瓜，', '我在呢。', '嘘…', '宝贝，', '嗯，'];
  })();
  // v3.26.x：温柔动作后缀受字卡库【其他互动功能字卡→经期→温柔动作】单卡开关联动——
  // FIX 2026-09-16 #586：与「温柔前缀」同口径改为【读数据分组本身】。原实现把 6 条后缀
  //   抄死在代码里（v3.14.x 只登记 1 条，v3.26.x 补到 6 条），而 default-cards-data.js 的
  //   「温柔动作」分组此后随字卡薄池批次涨到 12 条：字卡库列出 12 张、逐张开关齐全，
  //   实际只有前 6 张会被拼出——后 6 张是「哑开关」（开关点了不生效），前缀侧读实时数据
  //   已涨到 12 条，两侧口径不一致。现按前缀同款做法以数据分组为唯一来源，池子加卡片时
  //   字卡库开关自动跟上，不再需要改代码；数据缺失时回退内置 6 条兜底。
  var WARM_SUFFIX = (function () {
    try {
      var g = window.DEFAULT_CARD_DATA && window.DEFAULT_CARD_DATA.period;
      if (Array.isArray(g)) {
        for (var i = 0; i < g.length; i++) {
          if (g[i] && g[i][0] === '温柔动作' && Array.isArray(g[i][1]) && g[i][1].length) {
            return g[i][1].slice();
          }
        }
      }
    } catch (e) {}
    return [
      '（把你往怀里带了带）', '（轻轻抵着你的额头）', '（握紧你的手）',
      '（摸了摸你发顶）', '（语气柔下来）', '（把热牛奶推到你手边）'
    ];
  })();
  // v3.26.x #196：近期已用不重复——池小且纯均匀随机时连抽同几句被用户当 bug
  // （小米15Pro 反馈「基本都是这几句」）。各池记最近 3 条，先抽未在近期的，全用过才放宽。
  var warmRecent = { p: [], s: [] };
  function warmPick(pool, hist) {
    var avail = pool.filter(function (x) {
      return !window.isDefaultCardOff || !window.isDefaultCardOff('period', x);
    });
    if (!avail.length) return '';
    var fresh = avail.filter(function (x) { return warmRecent[hist].indexOf(x) < 0; });
    var src = fresh.length ? fresh : avail;
    var pick = src[Math.floor(Math.random() * src.length)];
    warmRecent[hist].push(pick);
    if (warmRecent[hist].length > 3) warmRecent[hist].shift();
    return pick;
  }
  function warmPrefix() {
    try { return warmPick(PERIOD_WARM_PREFIX, 'p'); } catch (e) {}
    return '';
  }
  // v3.26.x：温柔动作后缀同前缀口径——逐张开关（dc-off-period:<文案>）在 warmPick 内过滤，
  //   关闭后该动作后缀不再随机拼出；池子取自 DEFAULT_CARD_DATA.period「温柔动作」分组（见上）。
  function warmSuffix() {
    try { return warmPick(WARM_SUFFIX, 's'); } catch (e) {}
    return '';
  }
  // FIX 2026-09-16 #586 拼接处必须以空白分隔——温柔前缀、正文、温柔动作各自是一张字卡：
  //   原实现直接 `p + text + s` 首尾相接，用户看到的是「多张字卡粘成一串、没有空格」
  //   （如「傻瓜，今天也要好好爱自己（握紧你的手）」＝前缀+字卡+动作三张挤在一起），
  //   与单气泡拼字的既定口径相反（#315/#370 定稿：字卡与字卡之间空一格），用户据此
  //   报「没开拼字功能，联系人发消息还是用拼字卡」。本函数＝唯一拼接点：两端各留一个
  //   空格；任一段为空（卡被字卡库逐张关掉）时不留孤立空格；正文自身已带空白时不重复。
  function warmJoin(a, b) {
    if (!a) return b || '';
    if (!b) return a;
    if (/\s$/.test(a) || /^\s/.test(b)) return a + b;
    return a + ' ' + b;
  }
  function warmText(text) {
    if (typeof text !== 'string' || !text) return text;
    try {
      if (!status().inPeriod) return text;
      // v3.26.x #157：温柔前缀/温柔动作属系统预设字卡（DEFAULT_CARD_DATA.period）——
      // 原实现只认逐张开关（dc-off-period:*），无视总开关/聊天使用：用户关掉「使用默认
      // 字卡」后聊天里仍偶发前缀/动作字卡（小米15Pro 等多机型反馈）。现随总开关与
      // 聊天使用场景开关一并停用。
      var _dcfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
      if (_dcfg.enabled === false) return text;
      if (window.defaultCardUse && !window.defaultCardUse('chat')) return text;
      // v3.32.x #132：触发概率接字卡库【其他互动功能字卡→经期→使用概率】（dcf-period，
      // 默认 25%=历史值）——原为硬编码 25%，现可在字卡库调（设 0 即经期语态不出现）
      var _warmP = 25;
      try { if (window.dcfGet) _warmP = window.dcfGet('period'); } catch (e) {}
      if (Math.random() * 100 >= _warmP) return text;
      var p = warmPrefix();
      var s = warmSuffix();
      var r = Math.random();
      // FIX 2026-09-16 #586：45% 前缀 / 35% 动作 / 20% 双拼（口径不变），拼接一律走 warmJoin
      //   （字卡之间空一格）——回改成 p + text + s 的裸拼接即回归「字卡粘成一串」。
      if (r < 0.45) return warmJoin(p, text);
      if (r < 0.8) return warmJoin(text, s);
      var out = warmJoin(warmJoin(p, text), s);
      return out || text;
    } catch (e) { return text; }
  }
  window.periodWarmText = warmText;

  // ---- 预测置信度（方案 3）：距预测开始日越近越深，高斯衰减 ----
  function predictConfidence(ds) {
    var stats = cycleStats();
    if (stats.n < 3 || stats.std < 0.5) return 1;
    recs = normalize(recs);
    var last = recs[recs.length - 1];
    if (!last) return 1;
    var today = todayStr();
    var cl = stats.median;
    var sigma = stats.std;
    var k = 0, start = last.start;
    while (addDays(start, cl) <= ds && k < 200) { start = addDays(start, cl); k++; }
    if (start < today) return 1;
    var offset = diffDays(start, ds);
    if (offset >= cfg.periodLen) return 0;
    return Math.exp(-(offset * offset) / (2 * sigma * sigma));
  }

  // ---- 渲染 ----
  var PHASE_ICO = {
    period: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2C12 3.2 6 9.2 6 14.2a6 6 0 0 0 12 0c0-5-6-11-6-11z"/><path d="M12 16.4c0 0-2.3-1.4-2.3-2.9a1.25 1.25 0 0 1 2.3-.9 1.25 1.25 0 0 1 2.3.9c0 1.5-2.3 2.9-2.3 2.9z"/></svg>',
    fertile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S4.5 15.2 4.5 9.9A4.9 4.9 0 0112 7.1a4.9 4.9 0 017.5 2.8c0 5.3-7.5 10.6-7.5 10.6z"/></svg>',
    safe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    unknown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2C12 3.2 6 9.2 6 14.2a6 6 0 0 0 12 0c0-5-6-11-6-11z"/><path d="M12 16.4c0 0-2.3-1.4-2.3-2.9a1.25 1.25 0 0 1 2.3-.9 1.25 1.25 0 0 1 2.3.9c0 1.5-2.3 2.9-2.3 2.9z"/></svg>'
  };

  function renderStatus() {
    var st = status();
    var card = document.getElementById('period-status-card');
    // 倒计时环（方案 10）
    if (card) {
      var ring = card.querySelector('.period-countdown');
      if (!ring) {
        ring = document.createElement('div');
        ring.className = 'period-countdown';
        card.insertBefore(ring, card.firstChild);
      }
      var daysToNext = st.nextStart ? diffDays(todayStr(), st.nextStart) : null;
      var progress = st.cycleLen && st.dayOfCycle ? Math.min(1, st.dayOfCycle / st.cycleLen) : 0;
      var bigNum, bigSub;
      if (st.inPeriod) { bigNum = st.dayOfCycle; bigSub = '经期第' + st.dayOfCycle + '天'; }
      else if (daysToNext !== null && daysToNext >= 0) { bigNum = daysToNext; bigSub = '天后'; }
      else { bigNum = '—'; bigSub = ''; }
      var circ = 2 * Math.PI * 26;
      var dash = circ * progress;
      ring.innerHTML = '<div class="pd-ring-wrap">' +
        '<svg viewBox="0 0 60 60" class="pd-ring">' +
          '<circle cx="30" cy="30" r="26" fill="none" stroke="#eee" stroke-width="4"/>' +
          '<circle cx="30" cy="30" r="26" fill="none" stroke="#e85a8f" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + ' ' + circ.toFixed(1) + '" transform="rotate(-90 30 30)"/>' +
        '</svg>' +
        '<div class="pd-num">' + bigNum + '</div>' +
        '</div>' +
        '<div class="pd-sub">' + bigSub + '</div>';
    }
    var ico = document.getElementById('period-status-ico');
    if (ico) { ico.innerHTML = PHASE_ICO[st.phase] || PHASE_ICO.unknown; ico.className = 'period-status-ico phase-' + st.phase; }
    var t = document.getElementById('period-status-title');
    if (t) t.textContent = st.title;
    var s = document.getElementById('period-status-sub');
    if (s) s.textContent = st.sub;
    // CV 规律性徽章（方案 1）
    var head = document.querySelector('.period-status-head');
    if (head) {
      var badge = head.querySelector('.reg-badge');
      var reg = regularity();
      if (reg) {
        if (!badge) { badge = document.createElement('span'); head.appendChild(badge); }
        badge.className = 'reg-badge ' + reg.cls;
        badge.textContent = reg.label;
      } else if (badge) { badge.remove(); }
    }
    var bar = document.getElementById('period-phase-bar');
    if (bar) {
      var activeSeg = -1;
      if (st.phase === 'period') activeSeg = 0;
      else if (st.phase === 'fertile') activeSeg = 1;
      var segs = ['经期', '排卵期'];
      bar.innerHTML = segs.map(function (n, i) { return '<span class="seg seg-' + i + (i === activeSeg ? ' active' : '') + '">' + n + '</span>'; }).join('');
    }
    // 排卵倒计时行（经期中不显示）
    var ovuLine = document.getElementById('period-ovu-line');
    if (!ovuLine) {
      ovuLine = document.createElement('div');
      ovuLine.id = 'period-ovu-line';
      ovuLine.className = 'period-ovu-line';
      if (bar && bar.parentNode) bar.parentNode.insertBefore(ovuLine, bar.nextSibling);
    }
    if (ovuLine) {
      if (st.inPeriod || !st.dayOfCycle || !st.ovulationDay) {
        ovuLine.hidden = true;
      } else {
        ovuLine.hidden = false;
        var toOvu = st.ovulationDay - st.dayOfCycle;
        if (toOvu > 0) ovuLine.textContent = '距排卵约 ' + toOvu + ' 天';
        else if (toOvu === 0) ovuLine.textContent = '今天约为排卵日';
        else ovuLine.textContent = '距下次排卵约 ' + (st.cycleLen - st.dayOfCycle + st.ovulationDay) + ' 天';
      }
    }
    // PMS 经前综合征指数行（仅黄体期显示）
    var pmsLine = document.getElementById('period-pms-line');
    if (!pmsLine) {
      pmsLine = document.createElement('div');
      pmsLine.id = 'period-pms-line';
      pmsLine.className = 'period-pms-line';
      if (ovuLine && ovuLine.parentNode) ovuLine.parentNode.insertBefore(pmsLine, ovuLine.nextSibling);
      else if (bar && bar.parentNode) bar.parentNode.insertBefore(pmsLine, bar.nextSibling);
    }
    if (pmsLine) {
      var pms = pmsLevel();
      if (!pms) { pmsLine.hidden = true; }
      else {
        pmsLine.hidden = false;
        pmsLine.innerHTML = '<span class="pms-badge ' + pms.cls + '">' + pms.label + '</span>' +
          (pms.tip ? '<span class="pms-tip">' + pms.tip + '</span>' : '');
      }
    }
    var startBtn = document.getElementById('period-mark-start');
    var endBtn = document.getElementById('period-mark-end');
    if (startBtn) startBtn.hidden = st.inPeriod;
    if (endBtn) endBtn.hidden = !st.inPeriod;
  }

  var viewY = 0, viewM = -1;
  function renderGrid() {
    var grid = document.getElementById('period-grid');
    if (!grid) return;
    // 补排卵期图例（template 只有经期/预测，JS 补 fertile）
    var legend = grid.parentNode.querySelector('.period-legend');
    if (legend && !legend.querySelector('.lg-fertile')) {
      var lf = document.createElement('span');
      lf.className = 'lg lg-fertile';
      lf.textContent = '排卵期';
      legend.appendChild(lf);
    }
    var now = new Date();
    if (viewM < 0) { viewY = now.getFullYear(); viewM = now.getMonth(); }
    var y = viewY, m = viewM;
    var monthEl = document.getElementById('period-month-txt');
    if (monthEl) monthEl.textContent = y + ' 年 ' + (m + 1) + ' 月';
    var first = new Date(y, m, 1);
    var days = new Date(y, m + 1, 0).getDate();
    var startWd = first.getDay();
    var wds = ['日', '一', '二', '三', '四', '五', '六'];
    var html = wds.map(function (w) { return '<span class="pc-wd">' + w + '</span>'; }).join('');
    for (var i = 0; i < startWd; i++) html += '<span class="pc-cell blank"></span>';
    var today = todayStr();
    var stats = cycleStats();
    var hasBand = stats.n >= 3 && stats.std >= 0.5;
    for (var d = 1; d <= days; d++) {
      var ds = y + '-' + pad2(m + 1) + '-' + pad2(d);
      var ph = dayPhase(ds);
      var isToday = ds === today;
      var cls = 'pc-cell ph-' + ph + (isToday ? ' today' : '');
      var style = '';
      if (ph === 'predict' && hasBand) {
        var conf = predictConfidence(ds);
        cls += ' band';
        style = ' style="--conf:' + conf.toFixed(2) + '"';
      }
      var dayInfo = daily[ds];
      var mark = '';
      if (dayInfo) {
        if (dayInfo.flow) { cls += ' pc-flow-' + dayInfo.flow; mark += '<i class="dm-flow f-' + dayInfo.flow + '"></i>'; }
        if (dayInfo.symptoms && dayInfo.symptoms.length) mark += '<i class="dm-sym"></i>';
        if (dayInfo.note) mark += '<i class="dm-note"></i>';
      }
      html += '<span class="' + cls + '"' + style + ' data-date="' + ds + '">' + d + mark + '</span>';
    }
    grid.innerHTML = html;
  }

  function renderHistory() {
    var el = document.getElementById('period-history');
    if (!el) return;
    recs = normalize(recs);
    if (!recs.length) { el.innerHTML = '<div class="period-empty">还没有记录，标记本次经期开始后会显示在这里</div>'; return; }
    var arr = recs.slice().reverse();
    var html = '';
    arr.forEach(function (r, i) {
      var end = r.end || addDays(r.start, cfg.periodLen - 1);
      var len = diffDays(r.start, end) + 1;
      var next = arr[i - 1];
      var cycleTxt = next ? ' · 周期 ' + diffDays(r.start, next.start) + ' 天' : '';
      var endTxt = r.end ? r.end : '进行中';
      html += '<div class="period-hist-row"><span class="ph-date">' + r.start + ' ~ ' + endTxt + '</span><span class="ph-meta">持续 ' + len + ' 天' + cycleTxt + '</span><button class="ph-del" data-id="' + r.id + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6"/></svg></button></div>';
    });
    el.innerHTML = html;
  }

  // ---- 症状统计 + 趋势图（方案 5 + 9）----
  var SYMPTOMS = [
    { k: 'cramp', label: '痛经' }, { k: 'headache', label: '头痛' }, { k: 'backache', label: '腰酸' },
    { k: 'breast', label: '乳房胀' }, { k: 'acne', label: '痤疮' }, { k: 'fatigue', label: '疲劳' },
    { k: 'insomnia', label: '失眠' }, { k: 'moodlow', label: '情绪低落' }, { k: 'irritable', label: '易怒' },
    { k: 'appetite', label: '食欲增加' }, { k: 'ovulation', label: '排卵症状' }
  ];
  var FLOWS = [
    { k: 'spot', label: '点滴' }, { k: 'light', label: '轻' }, { k: 'medium', label: '中' }, { k: 'heavy', label: '重' }
  ];
  var MOODS = [
    { k: 1, label: '很差' }, { k: 2, label: '低落' }, { k: 3, label: '一般' }, { k: 4, label: '不错' }, { k: 5, label: '很好' }
  ];
  var SYM_MAP = {}; SYMPTOMS.forEach(function (s) { SYM_MAP[s.k] = s.label; });

  function renderStats() {
    var scroll = document.querySelector('#page-period .period-scroll');
    if (!scroll) return;
    var old = document.getElementById('period-stats-card');
    if (old) old.remove();
    var card = document.createElement('div');
    card.className = 'period-card glass';
    card.id = 'period-stats-card';
    // 症状频次
    var freq = {};
    for (var ds in daily) {
      var info = daily[ds];
      if (info && info.symptoms) info.symptoms.forEach(function (s) { freq[s] = (freq[s] || 0) + 1; });
    }
    var sorted = Object.keys(freq).map(function (k) { return { k: k, n: freq[k] }; }).sort(function (a, b) { return b.n - a.n; });
    var symHtml = '';
    if (sorted.length) {
      var max = sorted[0].n;
      var top3 = sorted.slice(0, 3).map(function (x) { return SYM_MAP[x.k] || x.k; }).join('、');
      symHtml = '<div class="ps-title">常见症状 · TOP3：' + top3 + '</div><div class="ps-bars">';
      sorted.slice(0, 8).forEach(function (x) {
        var pct = Math.round(x.n / max * 100);
        symHtml += '<div class="ps-bar"><span class="ps-name">' + (SYM_MAP[x.k] || x.k) + '</span><span class="ps-track"><span class="ps-fill" style="width:' + pct + '%"></span></span><span class="ps-num">' + x.n + '</span></div>';
      });
      symHtml += '</div>';
    } else {
      symHtml = '<div class="ps-empty">暂无症状记录（长按日格可录入）</div>';
    }
    // 趋势图
    var stats = cycleStats();
    var trendHtml = '';
    if (stats.diffs.length >= 2) {
      var diffs = stats.diffs.slice(-12);
      var minV = Math.min.apply(null, diffs), maxV = Math.max.apply(null, diffs);
      var mean = stats.mean;
      var pad = 2;
      var lo = Math.min(minV, mean) - pad, hi = Math.max(maxV, mean) + pad;
      if (hi <= lo) hi = lo + 1;
      var W = 280, H = 90, pl = 26, pr = 10, pt = 8, pb = 16;
      var xStep = (W - pl - pr) / Math.max(1, diffs.length - 1);
      var yOf = function (v) { return pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo)); };
      var pts = diffs.map(function (v, i) { return (pl + i * xStep).toFixed(1) + ',' + yOf(v).toFixed(1); });
      var meanY = yOf(mean);
      // v3.14.x：均值文字标签从图形区移到标题下方的说明行（原来画在均值线上方、
      //   常与折线/数据点重叠）；左侧留白改画 y 轴上下界刻度（此前 pl 空占无内容）
      function fN(v) { return String(Number(v.toFixed(1))); }
      trendHtml = '<div class="ps-title">周期长度趋势（近 ' + diffs.length + ' 次）</div>' +
        '<div class="ps-trend-cap">— — 均值 ' + mean.toFixed(1) + ' 天 · 区间 ' + fN(minV) + '～' + fN(maxV) + ' 天</div>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ps-trend" preserveAspectRatio="xMidYMid meet">' +
          '<text x="' + (pl - 4) + '" y="' + (pt + 4).toFixed(1) + '" fill="#aaa" font-size="8" text-anchor="end">' + fN(hi) + '</text>' +
          '<text x="' + (pl - 4) + '" y="' + (H - pb + 3).toFixed(1) + '" fill="#aaa" font-size="8" text-anchor="end">' + fN(lo) + '</text>' +
          '<line x1="' + pl + '" y1="' + meanY.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + meanY.toFixed(1) + '" stroke="#f5a623" stroke-dasharray="3 3" stroke-width="1"/>' +
          '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#e85a8f" stroke-width="2"/>' +
          diffs.map(function (v, i) { return '<circle cx="' + (pl + i * xStep).toFixed(1) + '" cy="' + yOf(v).toFixed(1) + '" r="2.5" fill="#e85a8f"/>'; }).join('') +
        '</svg>';
    }
    // 症状↔周期相位分布（找规律：痛经总在第1天、排卵期出血等）
    var phaseHtml = '';
    if (sorted.length) {
      recs = normalize(recs);
      var symPhase = {};
      for (var ds2 in daily) {
        var info2 = daily[ds2];
        if (!info2 || !info2.symptoms) continue;
        var start2 = null;
        for (var ri = 0; ri < recs.length; ri++) {
          if (recs[ri].start <= ds2) start2 = recs[ri].start;
          else break;
        }
        if (!start2) continue;
        var doc2 = diffDays(start2, ds2) + 1;
        if (doc2 > effCycleLen()) continue;
        info2.symptoms.forEach(function (s) {
          symPhase[s] = symPhase[s] || {};
          symPhase[s][doc2] = (symPhase[s][doc2] || 0) + 1;
        });
      }
      var top3syms = sorted.slice(0, 3);
      var phaseRows = '';
      top3syms.forEach(function (x) {
        var dist = symPhase[x.k] || {};
        var days = Object.keys(dist).map(Number).sort(function (a, b) { return a - b; });
        if (!days.length) return;
        var maxN = Math.max.apply(null, days.map(function (d) { return dist[d]; }));
        phaseRows += '<div class="ps-phase-row"><span class="ps-phase-name">' + (SYM_MAP[x.k] || x.k) + '</span><span class="ps-phase-bars">';
        days.forEach(function (d) {
          var pct = Math.round(dist[d] / maxN * 100);
          phaseRows += '<span class="ps-phase-bar" style="height:' + pct + '%" title="第' + d + '天 ' + dist[d] + '次"><i>' + d + '</i></span>';
        });
        phaseRows += '</span></div>';
      });
      if (phaseRows) phaseHtml = '<div class="ps-title">症状↔周期天分布</div><div class="ps-phase">' + phaseRows + '</div>';
    }
    card.innerHTML = '<div class="period-card-title">统计<button class="period-report-btn">月度报告</button></div>' +
      '<div class="ps-insight">' + periodInsight() + '</div>' + symHtml + trendHtml + phaseHtml;
    var reportBtn = card.querySelector('.period-report-btn');
    if (reportBtn) reportBtn.addEventListener('click', openReportPop);
    var histCardEl = scroll.querySelector('#period-history');
    if (histCardEl) histCardEl = histCardEl.closest('.period-card');
    if (histCardEl && histCardEl.nextSibling) histCardEl.parentNode.insertBefore(card, histCardEl.nextSibling);
    else scroll.appendChild(card);
  }

  // ---- 每日健康小贴士（按周期阶段取池，梦角口吻）----
  var PERIOD_TIPS = {
    period: [
      { main: '经期注意保暖，少碰冷饮凉食，小腹可以用暖水袋热敷。', mochi: '暖好自己，比什么都重要。' },
      { main: '喝点温红糖姜茶，多吃含铁的红枣、瘦肉，别让手脚发凉。', mochi: '我记得你说过手凉。' },
      { main: '经期激素波动容易累，想发脾气就发，我在呢。', mochi: '不用撑着，哭一场也没关系。' }
    ],
    follicular: [
      { main: '经期结束后适当活动，散步或拉伸，帮身体找回节奏。', mochi: '我陪你走那段路。' },
      { main: '补充蛋白质和膳食纤维，休息充足，精力会慢慢回来。', mochi: '你恢复的样子最好看。' }
    ],
    ovulatory: [
      { main: '排卵期代谢加快，多吃深色蔬菜和豆类，补充叶酸。', mochi: '好好吃饭，我才放心。' },
      { main: '这个阶段睡眠质量很重要，尽量别熬夜。', mochi: '别熬了，睡吧，我守着你。' }
    ],
    luteal: [
      { main: '经前期容易烦躁或低落，这是正常的，给自己多点耐心。', mochi: '靠近一点，我抱抱你。' },
      { main: '经前期少吃盐、多喝水，能缓解水肿和胀气。', mochi: '我给你留了温水。' }
    ],
    unknown: [
      { main: '连续记录几次经期后，我可以帮你预测周期和排卵窗口。', mochi: '从今天开始记一点点，好吗？' }
    ]
  };
  function tipsPool(st) {
    if (st.inPeriod) return PERIOD_TIPS.period;
    if (st.phase === 'fertile') return PERIOD_TIPS.ovulatory;
    if (!st.dayOfCycle) return PERIOD_TIPS.unknown;
    if (st.ovulationDay && st.dayOfCycle > st.ovulationDay) return PERIOD_TIPS.luteal;
    if (st.ovulationDay && st.dayOfCycle < st.ovulationDay) return PERIOD_TIPS.follicular;
    return PERIOD_TIPS.unknown;
  }
  function dayOfYear() {
    var n = new Date();
    return Math.floor((n - new Date(n.getFullYear(), 0, 0)) / 86400000);
  }
  function renderTips() {
    var scroll = document.querySelector('#page-period .period-scroll');
    if (!scroll) return;
    var old = document.getElementById('period-tips-card');
    if (old) old.remove();
    var st = status();
    var pool = tipsPool(st);
    var tip = pool[dayOfYear() % pool.length];
    var card = document.createElement('div');
    card.className = 'period-card glass';
    card.id = 'period-tips-card';
    card.innerHTML = '<div class="period-card-title">健康小贴士</div>' +
      '<div class="pt-main">' + tip.main + '</div>' +
      '<div class="pt-mochi">梦角 · ' + tip.mochi + '</div>';
    var statsCard = document.getElementById('period-stats-card');
    if (statsCard && statsCard.nextSibling) statsCard.parentNode.insertBefore(card, statsCard.nextSibling);
    else scroll.appendChild(card);
  }

  // ---- 症状缓解建议（按已记录症状，配梦角口吻）----
  var REMEDY_MAP = {
    cramp: { title: '痛经', main: '热敷小腹、喝温红糖姜茶，尝试侧卧蜷缩能减轻张力。', mochi: '疼得厉害就告诉我，别自己扛。' },
    headache: { title: '头痛', main: '到安静处遮光休息一会，轻按太阳穴，暂别浓茶咖啡。', mochi: '闭会儿眼，我在这儿。' },
    backache: { title: '腰酸', main: '热敷腰后、别久坐久站，做几下轻柔伸展。', mochi: '坐久了就站起来动动。' },
    breast: { title: '乳房胀', main: '穿宽松内衣、少点咖啡因、温敷能缓解胀感。', mochi: '这几天都顺着你。' },
    acne: { title: '痤疮', main: '温和洁面、少甜食油腻，别再用手挤。', mochi: '别挤它，我心疼。' },
    fatigue: { title: '疲劳', main: '早点睡或午后小憩片刻，别逞强硬撑。', mochi: '歇一歇，好不好。' },
    insomnia: { title: '失眠', main: '睡前一小时放下手机、泡脚放松，忌浓茶咖啡。', mochi: '睡不着就想想我，聊会天。' },
    moodlow: { title: '情绪低落', main: '晒晒太阳、找人说说，允许自己慢半拍。', mochi: '我陪着你。' },
    irritable: { title: '易怒', main: '深呼吸几次，给自己一个出口，别急着回应。', mochi: '愣一下，嗯？' },
    appetite: { title: '食欲增加', main: '备点健康零嘴，正餐规律些，别苛责自己。', mochi: '想吃就吃，别自责。' },
    ovulation: { title: '排卵症状', main: '轻微腹痛坠胀正常，多喝温水多休息。', mochi: '这几天我都记着。' }
  };
  function renderRemedies() {
    var scroll = document.querySelector('#page-period .period-scroll');
    if (!scroll) return;
    var old = document.getElementById('period-remedy-card');
    if (old) old.remove();
    // 找最近一条带症状记录的每日详情（今天优先）
    var latest = daily[todayStr()];
    var ds = todayStr();
    if (!latest || !latest.symptoms || !latest.symptoms.length) {
      var keys = Object.keys(daily);
      for (var i = keys.length - 1; i >= 0; i--) {
        var info = daily[keys[i]];
        if (info && info.symptoms && info.symptoms.length) { ds = keys[i]; latest = info; break; }
      }
    }
    if (!latest) {
      var card = document.createElement('div');
      card.className = 'period-card glass';
      card.id = 'period-card';
      card.innerHTML = '<div class="period-card-title">症状缓解建议</div>' +
        '<div class="pr-empty">记录症状后，这里会给针对性缓解建议。</div>';
      var stats = document.getElementById('period-stats-card');
      if (stats && stats.nextSibling) stats.parentNode.insertBefore(card, stats.nextSibling);
      else scroll.appendChild(card);
      return;
    }
    var html = '';
    latest.symptoms.forEach(function (k) {
      var r = REMEDY_MAP[k];
      if (!r) return;
      html += '<div class="pr-row"><span class="pr-sym">' + r.title + '</span><span class="pr-main">' + r.main + '</span><span class="pr-mochi">梦角 · ' + r.mochi + '</span></div>';
    });
    if (!html) return;
    var card = document.createElement('div');
    card.className = 'period-card glass';
    card.id = 'period-card';
    card.innerHTML = '<div class="period-card-title">症状缓解建议</div>' + html;
    var stats = document.getElementById('period-stats-card');
    if (stats && stats.nextSibling) stats.parentNode.insertBefore(card, stats.nextSibling);
    else scroll.appendChild(card);
  }

  // ---- 周期数据洞察：一句文本 ----
  function periodInsight() {
    var st = cycleStats();
    if (st.n < 2) return '继续记录几次经期后，这里会有周期洞察。';
    var mean = st.mean, med = st.median, n = st.diffs.length;
    var txt = '近 ' + n + ' 次周期平均 ' + (mean.toFixed(0)) + ' 天 · 中位 ' + med + ' 天';
    // 经期平均天数
    var lens = [];
    recs = normalize(recs);
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      lens.push(diffDays(r.start, r.end || addDays(r.start, cfg.periodLen - 1)) + 1);
    }
    if (lens.length) txt += ' · 经期平均 ' + (lens.reduce(function (a, b) { return a + b; }, 0) / lens.length).toFixed(1) + ' 天';
    // 近3次 vs 更早：周期长度变化趋势
    var ds = st.diffs;
    if (ds.length >= 4) {
      var rec3 = ds.slice(-3).reduce(function (a, b) { return a + b; }, 0) / 3;
      var earlyArr = ds.slice(0, -3);
      var early = earlyArr.reduce(function (a, b) { return a + b; }, 0) / earlyArr.length;
      var delta = rec3 - early;
      var trend = Math.abs(delta) < 1 ? '周期稳定' : (delta > 0 ? '周期较前期延长 ' + delta.toFixed(1) + ' 天' : '周期较前期缩短 ' + Math.abs(delta).toFixed(1) + ' 天');
      txt += ' · ' + trend;
    }
    var reg = regularity();
    if (reg) txt += ' · ' + reg.label;
    return txt;
  }
  function render() { try { renderStatus(); } catch (e) {} try { renderGrid(); } catch (e) {} try { renderHistory(); } catch (e) {} try { renderStats(); } catch (e) {} try { renderTips(); } catch (e) {} try { renderRemedies(); } catch (e) {} try { renderDeskWidget(); } catch (e) {} }

  // ---- 操作 ----
  function markStart() {
    recs = normalize(recs);
    var today = todayStr();
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var end = r.end || addDays(r.start, cfg.periodLen - 1);
      if (today >= r.start && today <= end) { toast('当前已在经期中'); return; }
    }
    recs.push({ id: newId(), start: today, end: null });
    recs = normalize(recs);
    saveRecs(recs);
    toast('已记录经期开始');
    render();
    checkNotify();
  }
  function markEnd() {
    recs = normalize(recs);
    var today = todayStr();
    var found = null;
    recs.forEach(function (r) { if (!r.end && r.start <= today) found = r; });
    if (!found) { toast('没有进行中的经期记录'); return; }
    found.end = today;
    recs = normalize(recs);
    saveRecs(recs);
    toast('已记录经期结束');
    render();
  }
  function toggleDay(ds) {
    recs = normalize(recs);
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var end = r.end || addDays(r.start, cfg.periodLen - 1);
      if (ds >= r.start && ds <= end) {
        if (ds === r.start && ds === end) {
          recs = recs.filter(function (x) { return x !== r; });
        } else if (ds === r.start) {
          r.start = addDays(r.start, 1);
        } else if (ds === end) {
          r.end = addDays(ds, -1);
        } else {
          recs = recs.filter(function (x) { return x !== r; });
          recs.push({ id: newId(), start: r.start, end: addDays(ds, -1) });
          recs.push({ id: newId(), start: addDays(ds, 1), end: r.end });
        }
        recs = normalize(recs);
        saveRecs(recs);
        render();
        return;
      }
    }
    recs.push({ id: newId(), start: ds, end: ds });
    recs = normalize(recs);
    saveRecs(recs);
    render();
  }
  function delRec(id) {
    recs = recs.filter(function (r) { return String(r.id) !== String(id); });
    saveRecs(recs);
    toast('已删除');
    render();
  }

  function toast(msg) {
    var t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2000);
  }

  // v3.12.x：浮层挂到 .phone 内（原挂 body）——配合 .period-day-pop fixed→absolute：
  // 手机端键盘弹出时 mobile-adapt 收缩 .phone 停靠键盘上方，挂 body 的 fixed 浮层
  // 仍相对整屏定位 → 底部面板沉到键盘后面（备注/体温/关心语输入和保存按钮被盖住）。
  // 挂 .phone 后 absolute 锚定手机框，面板始终停靠在可视区底部。
  function appendPop(pop) {
    var host = document.querySelector('.phone');
    (host || document.body).appendChild(pop);
  }

  // v3.10.x：安卓 ce-box 转换器读值兜底——mobile-adapt.js 把 input/textarea 转成
  // contenteditable div（.ce-box）且插在原输入框**前面**、继承同名 class，浮层里
  // querySelector('.dp-note') 这类按 class 选会先命中 div（无 value 属性），备注
  // 读 .value.trim() 直接抛 TypeError、保存回调整体中断——vivo Edge 实测「记录今天
  // 点了保存不保存」。固定按标签选回原 input/textarea（value 已被代理到 ce-box），
  // 个别内核代理读空时再从 __ceBox 取文本兜底（同 music-player readCeInput 先例）。
  function readInpVal(el) {
    if (!el) return '';
    var v;
    try { v = el.value; } catch (e) {}
    if (v !== undefined && v !== null && String(v).trim()) return String(v);
    try {
      var box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
      if (box) return (box.innerText !== undefined ? box.innerText : box.textContent) || '';
    } catch (e) {}
    return v === undefined || v === null ? '' : String(v);
  }

  // ---- 每日详情浮层（方案 4）----
  function openDayPop(ds) {
    var existing = document.getElementById('period-day-pop');
    if (existing) existing.remove();
    var info = daily[ds] || {};
    var pop = document.createElement('div');
    pop.id = 'period-day-pop';
    pop.className = 'period-day-pop';
    var flowHtml = FLOWS.map(function (f) {
      return '<button class="dp-flow' + (info.flow === f.k ? ' on' : '') + '" data-flow="' + f.k + '">' + f.label + '</button>';
    }).join('');
    // v3.10.x：显式「生理期」开关——原来把某天标成经期（红色）只有长按日格一条路，
    // 用户在编辑浮层里填完点保存自然期待变红，却永远不变（浮层只存经量/症状）；
    // OPPO Reno16 反馈「编辑完确定也不会变红」。现在浮层顶部给开关：开=该日标为经期，
    // 关=取消（走 toggleDay 同一套合并逻辑），保存时与当前状态比对后一次性生效。
    var isPeriodNow = dayPhase(ds) === 'period';
    var symHtml = SYMPTOMS.map(function (s) {
      var on = info.symptoms && info.symptoms.indexOf(s.k) >= 0;
      return '<button class="dp-sym' + (on ? ' on' : '') + '" data-sym="' + s.k + '">' + s.label + '</button>';
    }).join('');
    var moodHtml = MOODS.map(function (m) {
      return '<button class="dp-mood' + (info.mood === m.k ? ' on' : '') + '" data-mood="' + m.k + '">' + m.label + '</button>';
    }).join('');
    pop.innerHTML =
      '<div class="dp-mask"></div>' +
      '<div class="dp-sheet">' +
        '<div class="dp-head"><span class="dp-date">' + ds + '</span><button class="dp-close" aria-label="关闭">×</button></div>' +
        '<div class="dp-section"><div class="dp-label">生理期</div><button class="dp-sym dp-period' + (isPeriodNow ? ' on' : '') + '">' + (isPeriodNow ? '已标记为生理期（点此取消）' : '标记这天为生理期') + '</button></div>' +
        '<div class="dp-section"><div class="dp-label">经量</div><div class="dp-flow-row">' + flowHtml + '</div></div>' +
        '<div class="dp-section"><div class="dp-label">症状</div><div class="dp-sym-grid">' + symHtml + '</div></div>' +
        '<div class="dp-section"><div class="dp-label">基础体温（℃）</div><input class="dp-temp" type="number" step="0.1" min="35" max="38" value="' + (info.temp || '') + '" placeholder="36.5"/></div>' +
        '<div class="dp-section"><div class="dp-label">情绪</div><div class="dp-mood-row">' + moodHtml + '</div></div>' +
        '<div class="dp-section"><div class="dp-label">备注</div><textarea class="dp-note" placeholder="今天的感觉…">' + (info.note || '') + '</textarea></div>' +
        '<div class="dp-actions"><button class="dp-del">删除</button><button class="dp-save period-btn primary">保存</button></div>' +
      '</div>';
    appendPop(pop);
    document.body.classList.add('scroll-lock');
    pop.querySelector('.dp-mask').addEventListener('click', closeDayPop);
    pop.querySelector('.dp-close').addEventListener('click', closeDayPop);
    pop.querySelectorAll('.dp-flow').forEach(function (b) {
      b.addEventListener('click', function () {
        pop.querySelectorAll('.dp-flow').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
    });
    pop.querySelectorAll('.dp-sym[data-sym]').forEach(function (b) {
      b.addEventListener('click', function () { b.classList.toggle('on'); });
    });
    var perBtn = pop.querySelector('.dp-period');
    if (perBtn) perBtn.addEventListener('click', function () {
      var on = perBtn.classList.toggle('on');
      perBtn.textContent = on ? '已标记为生理期（点此取消）' : '标记这天为生理期';
    });
    pop.querySelectorAll('.dp-mood').forEach(function (b) {
      b.addEventListener('click', function () {
        pop.querySelectorAll('.dp-mood').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
    });
    pop.querySelector('.dp-save').addEventListener('click', function () {
      var flowBtn = pop.querySelector('.dp-flow.on');
      var moodBtn = pop.querySelector('.dp-mood.on');
      var syms = [];
      pop.querySelectorAll('.dp-sym.on[data-sym]').forEach(function (b) { syms.push(b.getAttribute('data-sym')); });
      // v3.10.x：按标签选原输入框——.dp-temp/.dp-note 在安卓 ce-box 转换后先匹配到
      // 继承同类的 div（无 value），备注读值抛错导致保存中断（vivo Edge 实测）
      var temp = parseFloat(readInpVal(pop.querySelector('input.dp-temp')));
      var mood = moodBtn ? parseInt(moodBtn.getAttribute('data-mood'), 10) : 0;
      var note = readInpVal(pop.querySelector('textarea.dp-note')).trim();
      var obj = {};
      if (flowBtn) obj.flow = flowBtn.getAttribute('data-flow');
      if (syms.length) obj.symptoms = syms;
      if (!isNaN(temp) && temp >= 35 && temp <= 38) obj.temp = temp;
      if (mood && mood !== 3) obj.mood = mood;
      if (note) obj.note = note;
      if (Object.keys(obj).length) daily[ds] = obj; else delete daily[ds];
      saveDaily(daily);
      // v3.10.x：生理期开关落地——与打开浮层时的实际状态比对，变化才 toggle 一次
      //（toggleDay 内部已含 normalize + saveRecs + render；无变化不动数据）
      if (perBtn) {
        var wantPeriod = perBtn.classList.contains('on');
        if (wantPeriod !== (dayPhase(ds) === 'period')) toggleDay(ds);
      }
      closeDayPop();
      render();
      toast('已保存');
    });
    pop.querySelector('.dp-del').addEventListener('click', function () {
      delete daily[ds];
      saveDaily(daily);
      closeDayPop();
      render();
      toast('已删除');
    });
  }
  function closeDayPop() {
    var pop = document.getElementById('period-day-pop');
    if (pop) pop.remove();
    document.body.classList.remove('scroll-lock');
  }

  // ---- 本地通知（方案 6）----
  function notifyAssist(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(function (reg) {
          try { reg.showNotification(title, { body: body, tag: 'period-' + Date.now() }); }
          catch (e) { try { new Notification(title, { body: body }); } catch (e2) {} }
        });
      } else {
        try { new Notification(title, { body: body }); } catch (e) {}
      }
    } catch (e) {}
  }
  function checkNotify() {
    if (!notifyCfg.enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var st = status();
    var today = todayStr();
    notifyCfg.fired = notifyCfg.fired || {};
    var fired = false;
    if (st.nextStart && !st.inPeriod) {
      var d = diffDays(today, st.nextStart);
      notifyCfg.advanceDays.forEach(function (adv) {
        if (d === adv && !notifyCfg.fired[today + '_adv' + adv]) {
          var txt = adv === 0 ? '今天预计是经期开始日' : '距下次经期约 ' + adv + ' 天';
          notifyAssist('经期提醒', txt + ' · 注意保暖、备好用品');
          notifyCfg.fired[today + '_adv' + adv] = 1;
          fired = true;
        }
      });
    }
    // 经期中每天提醒
    if (st.inPeriod && !notifyCfg.fired[today + '_inperiod']) {
      notifyAssist('经期提醒', '经期第 ' + st.dayOfCycle + ' 天 · 注意保暖休息');
      notifyCfg.fired[today + '_inperiod'] = 1;
      fired = true;
    }
    if (st.phase === 'safe' && /推迟/.test(st.title)) {
      var m = st.title.match(/推迟 (\d+) 天/);
      var delayDays = m ? parseInt(m[1], 10) : 0;
      if (delayDays >= 5 && !notifyCfg.fired[today + '_delay']) {
        notifyAssist('经期延迟提醒', '经期已延迟 ' + delayDays + ' 天，如持续异常建议关注');
        notifyCfg.fired[today + '_delay'] = 1;
        fired = true;
      }
    }
    var cut = addDays(today, -30);
    Object.keys(notifyCfg.fired).forEach(function (k) { if (k < cut) delete notifyCfg.fired[k]; });
    if (fired) saveNotify(notifyCfg);
  }

  // ---- 关心语抽取 ----
  // v3.42.x #559：语境 + 规律分级抽取——经期中走原逻辑（80% 经期专属语 + 20% ta-ask
  //   care 题库）；预警语境只从对应分组抽（不混通用题库，避免语境错位），全被字卡库
  //   关掉则返回空串（本次不发）。ctx 决定语境（adv*/delay/delayDeep/delayIrregular），
  //   tier 决定规律档（rule=预测可信 / free=预测仅参考）。
  function pickWarnLine(ctx, tier) {
    var name, fb;
    if (ctx.indexOf('adv') === 0) {
      if (tier === 'free') { name = '经前预警·不规律'; fb = PERIOD_PREWARN_FREE_FALLBACK; }
      else { name = '经前预警'; fb = PERIOD_PREWARN_FALLBACK; }
    } else if (ctx === 'delayDeep') { name = '经期推迟·关注'; fb = PERIOD_DELAY_DEEP_FALLBACK; }
    else if (ctx === 'delayIrregular') { name = '经期推迟·不规律'; fb = PERIOD_DELAY_FREE_FALLBACK; }
    else { name = '经期推迟'; fb = PERIOD_DELAY_FALLBACK; }
    var pool = cardGroupLines(name, fb).filter(function (l) { return l && !careLineBlocked(l); });
    if (!pool.length) return '';
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // 经期中专用（原逻辑不变）
  function pickCareLine() {
    var lines = loadCareLines().filter(function (l) { return l && !careLineBlocked(l); });
    if (!lines.length) lines = PERIOD_CARE_LINES.filter(function (l) { return l && !careLineBlocked(l); });
    if (Math.random() * 100 < 80) {
      return lines[Math.floor(Math.random() * lines.length)];
    }
    var pool = window.MOCHI_TA_ASK_CARE;
    if (pool && pool.length) {
      var usable = pool.filter(function (q) { return q.enabled !== false; });
      if (!usable.length) usable = pool;
      return usable[Math.floor(Math.random() * usable.length)].text;
    }
    return lines[Math.floor(Math.random() * lines.length)];
  }
  // ---- 梦角关心触发（经期专属，每天最多一条）----
  // 触发时机：启动后 + 联系人每条文字回复后（chat.js）；经期中每天 + 经期前
  //   advanceDays 提醒日 + 推迟预警
  // v3.42.x #559 详细设计（语境 × 经期规律 分级提醒，用户反馈「根据经期规律提醒」）：
  //   predictTier：cycleStats 有效周期 ≥3 且 CV<0.2（很规律+较规律）＝rule「预测可信」；
  //   其余（不规律/记录 <3 次）＝free「预测仅参考」。
  //   ① 经前预警：rule 按提醒设置的全部预警日（默认提前 3/1 天）发确定口吻；
  //     free 的预测误差可能 ±一周以上，只在最接近的一次预警日（提前天数最小值）发一次
  //     措辞带「按记录推算、仅供参考」的版本，避免按不可信预测连发多天。
  //   ② 推迟预警：rule 晚 ≥5 天发「比平时晚了 N 天」（你一向很准），晚 ≥10 天升
  //     「关注」档（措辞带就医建议）；free 不说「推迟/晚了」——预测本身不可信，说了
  //     就是「太扯淡」（用户原话），晚 ≥10 天才以「距上次经期已经 N 天」的间隔口吻
  //     轻提（{d} 语义=间隔天数，且 60 天+ 的文案自然带出就医建议）。
  //   各语境每天最多一条（fired 键含 ctx，tier/深浅不同互不挤占）；字卡库同名分组
  //   可逐张开关，整组关掉则该语境当天不发。
  // v3.14.x 概率重设计——旧版三层门控叠加（chat 回复路径预掷 20% × 连发衰减至 20%
  //   × 当日基数），第 2 天起单次触发率跌到约 12%、第 5 天起仅 ~4%，体感就是
  //   「只有第一天会来关心」。现在：去掉连发衰减与 chat 预掷，只保留「同一天最多
  //   一条」冷却；进入判定后按当天基数掷一次——经期第1-2天 90%、第3-4天 70%、
  //   第5+天 55%；经期前提醒/推迟预警 75%。防刷屏由每日一条上限兜底。
  // v3.42.x #422：「梦角关心」开关之外叠加「其他互动功能字卡」的 dcf-care 概率门控
  //   （默认 100%＝原节奏，0%＝不发），随联系人桌面隔离；两者都关才真完全关。
  function predictTier() {
    var s = cycleStats();
    if (s.n >= 3 && s.cv < 0.2) return 'rule';
    return 'free';
  }
  function checkCare() {
    if (!notifyCfg.careEnabled) return;
    if (!window.chatAddIn) return;
    // v3.42.x #559：深夜静默 23:00–06:00（同 memo-app「备忘提醒」/ p2-features「喝水·吃饭提醒」
    //   先例）——之前经期关心/预警是本功能族唯一没有静默期的，半夜聊天时 TA 会发
    //   「经期预警」把人叫醒。静默期直接不发、也不写 fired，白天再触发照常补发（不吞当天）。
    var _h = new Date().getHours();
    if (_h >= 23 || _h < 6) return; // #559 深夜静默（23:00–06:00 不发、不写 fired）
    try { if (Math.random() * 100 >= (window.dcfGet ? window.dcfGet('care') : 100)) return; } catch (e) {}
    var st = status();
    var today = todayStr();
    var tier = predictTier();
    var shouldCare = false, ctx = '', kind = '';
    if (st.inPeriod) { shouldCare = true; ctx = 'inPeriod'; kind = 'in'; }
    else if (st.nextStart) {
      var d = diffDays(today, st.nextStart);
      // free 档只认最接近的一次预警日（提前天数最小值，0=当天不可达故滤掉）
      var advOk = true;
      if (tier === 'free') {
        var advs = notifyCfg.advanceDays.filter(function (x) { return x >= 1; });
        advOk = advs.length ? d === Math.min.apply(null, advs) : false;
      }
      if (advOk && notifyCfg.advanceDays.indexOf(d) >= 0) { shouldCare = true; ctx = 'adv' + d; kind = 'adv'; }
    }
    var delayDays = 0;
    if (st.phase === 'safe' && /推迟/.test(st.title)) {
      var m = st.title.match(/推迟 (\d+) 天/);
      delayDays = m ? parseInt(m[1], 10) : 0;
      if (tier === 'rule' && delayDays >= 5) { shouldCare = true; ctx = delayDays >= 10 ? 'delayDeep' : 'delay'; kind = 'delay'; }
      else if (tier === 'free' && delayDays >= 10) { shouldCare = true; ctx = 'delayIrregular'; kind = 'delayIrr'; }
    }
    if (!shouldCare) return;
    notifyCfg.fired = notifyCfg.fired || {};
    var careKey = today + '_care_' + ctx;
    if (notifyCfg.fired[careKey]) return;
    var baseProb = 75;
    if (st.inPeriod) {
      var doc = st.dayOfCycle || 1;
      if (doc <= 2) baseProb = 90;
      else if (doc <= 4) baseProb = 70;
      else baseProb = 55;
    }
    if (Math.random() * 100 > baseProb) return;
    // {d} 占位符按语境取数：adv=距预测经期天数；delay/delayDeep=已推迟天数；
    // delayIrregular=距上次经期天数（间隔口吻，不提「推迟」）
    var line = kind === 'in' ? pickCareLine() : pickWarnLine(ctx, tier);
    if (!line) return;
    if (kind === 'adv') line = String(line).replace(/\{d\}/g, String(diffDays(today, st.nextStart)));
    else if (kind === 'delay') line = String(line).replace(/\{d\}/g, String(delayDays));
    else if (kind === 'delayIrr') line = String(line).replace(/\{d\}/g, String(st.dayOfCycle || 0));
    // 带标签 chip 发进聊天（addIn opts.tag → rec.mood），用户能看出消息来源与语境：
    // 「经期关心」= 经期中，「经期预警」= 经前预警/推迟（#559 起区分）
    try { window.chatAddIn(line, { tag: kind === 'in' ? '经期关心' : '经期预警' }); } catch (e) {}
    notifyCfg.fired[careKey] = 1;
    var cut = addDays(today, -30);
    Object.keys(notifyCfg.fired).forEach(function (k) { if (k < cut) delete notifyCfg.fired[k]; });
    saveNotify(notifyCfg);
  }
  window.periodCheckCare = checkCare;

  // ---- 关心语管理浮层（增删/单卡开关）----
  function openCarePop() {
    var existing = document.getElementById('period-care-pop');
    if (existing) existing.remove();
    var lines = loadCareLines();
    var pop = document.createElement('div');
    pop.id = 'period-care-pop';
    pop.className = 'period-day-pop';
    function renderList() {
      if (!lines.length) return '<div class="period-empty">还没有关心语，加一条吧</div>';
      return lines.map(function (l, i) {
        var off = isCareOff(l);
        return '<div class="care-row" data-idx="' + i + '">' +
          '<span class="care-txt' + (off ? ' off' : '') + '">' + l + '</span>' +
          '<button class="care-toggle' + (off ? '' : ' on') + '">' + (off ? '关' : '开') + '</button>' +
          '<button class="care-del">×</button>' +
        '</div>';
      }).join('');
    }
    pop.innerHTML =
      '<div class="dp-mask"></div>' +
      '<div class="dp-sheet">' +
        '<div class="dp-head"><span class="dp-date">梦角关心语</span><button class="dp-close">×</button></div>' +
        '<div class="dp-section"><div class="dp-label">新增关心语</div><div class="dp-add-row"><input class="dp-care-input" type="text" placeholder="输入关心语"/><button class="dp-add-btn period-btn primary">添加</button></div></div>' +
        '<div class="dp-section"><div class="dp-label">已有关心语（点开关启停，×删除）</div><div class="care-list">' + renderList() + '</div></div>' +
        '<div class="dp-tip">经期触发时从开启的关心语里随机抽一条推到聊天。关闭的不会被抽中。</div>' +
      '</div>';
    appendPop(pop);
    document.body.classList.add('scroll-lock');
    pop.querySelector('.dp-mask').addEventListener('click', closeCarePop);
    pop.querySelector('.dp-close').addEventListener('click', closeCarePop);
    // v3.10.x：同上——按标签选原 input，读值走 readInpVal（ce-box 转换后 .dp-care-input
    // 先命中 div，添加关心语在安卓上静默失效）
    var input = pop.querySelector('input.dp-care-input');
    var listEl = pop.querySelector('.care-list');
    function addLine() {
      var v = readInpVal(input).trim();
      if (v && lines.indexOf(v) < 0) {
        lines.push(v); saveCareLines(lines);
        input.value = '';
        listEl.innerHTML = renderList();
      }
    }
    pop.querySelector('.dp-add-btn').addEventListener('click', addLine);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') addLine(); });
    listEl.addEventListener('click', function (e) {
      var row = e.target.closest('.care-row');
      if (!row) return;
      var idx = parseInt(row.getAttribute('data-idx'), 10);
      var line = lines[idx];
      if (!line) return;
      if (e.target.closest('.care-toggle')) {
        var off = isCareOff(line);
        setCareOff(line, !off);
        row.querySelector('.care-txt').classList.toggle('off', !off);
        var btn = row.querySelector('.care-toggle');
        btn.classList.toggle('on', off);
        btn.textContent = off ? '开' : '关';
      } else if (e.target.closest('.care-del')) {
        lines.splice(idx, 1); saveCareLines(lines);
        listEl.innerHTML = renderList();
      }
    });
  }
  function closeCarePop() {
    var pop = document.getElementById('period-care-pop');
    if (pop) pop.remove();
    document.body.classList.remove('scroll-lock');
  }

  // ---- 月度报告卡（本月经期总结，可分享到朋友圈）----
  var FLOW_MAP = {}; FLOWS.forEach(function (f) { FLOW_MAP[f.k] = f.label; });
  function openReportPop() {
    var existing = document.getElementById('period-report-pop');
    if (existing) existing.remove();
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth();
    var monthStr = y + '年' + (m + 1) + '月';
    var mStart = y + '-' + pad2(m + 1) + '-01';
    var mEnd = y + '-' + pad2(m + 1) + '-' + pad2(new Date(y, m + 1, 0).getDate());
    recs = normalize(recs);
    var monthRecs = recs.filter(function (r) {
      var end = r.end || addDays(r.start, cfg.periodLen - 1);
      return r.start <= mEnd && end >= mStart;
    });
    var monthDaily = {};
    for (var ds in daily) { if (ds >= mStart && ds <= mEnd) monthDaily[ds] = daily[ds]; }
    var periodDays = 0;
    monthRecs.forEach(function (r) {
      var end = r.end || addDays(r.start, cfg.periodLen - 1);
      var s = r.start < mStart ? mStart : r.start;
      var e = end > mEnd ? mEnd : end;
      periodDays += diffDays(s, e) + 1;
    });
    var flowCount = { spot: 0, light: 0, medium: 0, heavy: 0 };
    for (var ds2 in monthDaily) { if (monthDaily[ds2].flow) flowCount[monthDaily[ds2].flow]++; }
    var flowTxt = Object.keys(flowCount).filter(function (k) { return flowCount[k]; }).map(function (k) {
      return (FLOW_MAP[k] || k) + ' ' + flowCount[k] + '天';
    }).join('、');
    var freq = {};
    for (var ds3 in monthDaily) { if (monthDaily[ds3].symptoms) monthDaily[ds3].symptoms.forEach(function (s) { freq[s] = (freq[s] || 0) + 1; }); }
    var sortedSym = Object.keys(freq).map(function (k) { return { k: k, n: freq[k] }; }).sort(function (a, b) { return b.n - a.n; });
    var symTxt = sortedSym.slice(0, 3).map(function (x) { return (SYM_MAP[x.k] || x.k) + ' ' + x.n + '次'; }).join('、') || '无';
    var stats = cycleStats();
    var cycleTxt = stats.n >= 1 ? stats.median + ' 天（中位数）' : '数据不足';
    var recordDays = Object.keys(monthDaily).length;
    var reportText = '📊 ' + monthStr + ' 经期报告\n' +
      '周期长度：' + cycleTxt + '\n' +
      '经期天数：' + periodDays + ' 天\n' +
      '经量分布：' + (flowTxt || '未记录') + '\n' +
      '常见症状：' + symTxt + '\n' +
      '记录天数：' + recordDays + ' 天';
    var pop = document.createElement('div');
    pop.id = 'period-report-pop';
    pop.className = 'period-day-pop';
    pop.innerHTML =
      '<div class="dp-mask"></div>' +
      '<div class="dp-sheet">' +
        '<div class="dp-head"><span class="dp-date">' + monthStr + ' 经期报告</span><button class="dp-close">×</button></div>' +
        '<div class="dp-section"><div class="dp-label">周期长度</div><div class="dp-val">' + cycleTxt + '</div></div>' +
        '<div class="dp-section"><div class="dp-label">经期天数</div><div class="dp-val">' + periodDays + ' 天</div></div>' +
        '<div class="dp-section"><div class="dp-label">经量分布</div><div class="dp-val">' + (flowTxt || '未记录') + '</div></div>' +
        '<div class="dp-section"><div class="dp-label">常见症状</div><div class="dp-val">' + symTxt + '</div></div>' +
        '<div class="dp-section"><div class="dp-label">记录天数</div><div class="dp-val">' + recordDays + ' 天</div></div>' +
        '<div class="dp-actions"><button class="dp-save period-btn primary" id="period-report-share">分享到朋友圈</button></div>' +
      '</div>';
    appendPop(pop);
    document.body.classList.add('scroll-lock');
    pop.querySelector('.dp-mask').addEventListener('click', closeReportPop);
    pop.querySelector('.dp-close').addEventListener('click', closeReportPop);
    pop.querySelector('#period-report-share').addEventListener('click', function () {
      if (window.feedAddPost) {
        var id = window.feedAddPost(reportText);
        if (id) { closeReportPop(); toast('已分享到朋友圈'); }
        else toast('分享失败');
      } else { toast('朋友圈功能未就绪'); }
    });
  }
  function closeReportPop() {
    var pop = document.getElementById('period-report-pop');
    if (pop) pop.remove();
    document.body.classList.remove('scroll-lock');
  }

  // ---- 周期设置浮层（stepper 分别设定 + 上次开始日 + 排卵日预览）----
  function openSettingsPop() {
    var existing = document.getElementById('period-settings-pop');
    if (existing) existing.remove();
    var cur = loadCfg();
    var norm = normalize(recs);
    var lastStart = norm.length ? norm[norm.length - 1].start : '';
    var pop = document.createElement('div');
    pop.id = 'period-settings-pop';
    pop.className = 'period-day-pop';
    function stepper(label, key, min, max, unit) {
      return '<div class="dp-section"><div class="dp-label">' + label + '</div>' +
        '<div class="dp-stepper" data-key="' + key + '" data-min="' + min + '" data-max="' + max + '">' +
          '<button class="st-btn st-minus">−</button>' +
          '<span class="st-val">' + cur[key] + '</span>' +
          '<button class="st-btn st-plus">+</button>' +
          '<span class="st-unit">' + (unit || '天') + '</span>' +
        '</div></div>';
    }
    pop.innerHTML =
      '<div class="dp-mask"></div>' +
      '<div class="dp-sheet">' +
        '<div class="dp-head"><span class="dp-date">周期设置</span><button class="dp-close">×</button></div>' +
        stepper('周期长度', 'cycleLen', 15, 60) +
        stepper('经期天数', 'periodLen', 2, 14) +
        stepper('黄体期', 'lutealPhase', 7, 20) +
        '<div class="dp-section"><div class="dp-label">预计排卵日</div><div class="dp-ovu-preview">周期第 ' + (cur.cycleLen - cur.lutealPhase) + ' 天</div></div>' +
        '<div class="dp-section"><div class="dp-label">上次经期开始日（填了即可预测）</div><input class="dp-date-input" type="date" value="' + lastStart + '"/></div>' +
        '<div class="dp-tip">周期长度=两次经期开始间隔；经期天数=每次持续天数；黄体期=排卵后到下次经期的天数。每个人不同，按自己情况设。</div>' +
        '<div class="dp-actions"><button class="dp-save period-btn primary">保存</button></div>' +
      '</div>';
    appendPop(pop);
    document.body.classList.add('scroll-lock');
    pop.querySelector('.dp-mask').addEventListener('click', closeSettingsPop);
    pop.querySelector('.dp-close').addEventListener('click', closeSettingsPop);
    var work = { cycleLen: cur.cycleLen, periodLen: cur.periodLen, lutealPhase: cur.lutealPhase };
    var ovuPreview = pop.querySelector('.dp-ovu-preview');
    pop.querySelectorAll('.dp-stepper').forEach(function (st) {
      var key = st.getAttribute('data-key');
      var min = parseInt(st.getAttribute('data-min'), 10);
      var max = parseInt(st.getAttribute('data-max'), 10);
      var valEl = st.querySelector('.st-val');
      st.querySelector('.st-minus').addEventListener('click', function () {
        if (work[key] > min) { work[key]--; valEl.textContent = work[key]; ovuPreview.textContent = '周期第 ' + (work.cycleLen - work.lutealPhase) + ' 天'; }
      });
      st.querySelector('.st-plus').addEventListener('click', function () {
        if (work[key] < max) { work[key]++; valEl.textContent = work[key]; ovuPreview.textContent = '周期第 ' + (work.cycleLen - work.lutealPhase) + ' 天'; }
      });
    });
    pop.querySelector('.dp-save').addEventListener('click', function () {
      saveCfg(work); cfg = work;
      var dateVal = pop.querySelector('.dp-date-input').value;
      if (dateVal) {
        var norm2 = normalize(recs);
        var exists = norm2.some(function (r) { return r.start === dateVal; });
        if (!exists) {
          norm2.push({ id: newId(), start: dateVal, end: null });
          norm2 = normalize(norm2);
          saveRecs(norm2); recs = norm2;
        }
      }
      closeSettingsPop();
      render();
      toast('已保存');
      checkNotify();
    });
  }
  function closeSettingsPop() {
    var pop = document.getElementById('period-settings-pop');
    if (pop) pop.remove();
    document.body.classList.remove('scroll-lock');
  }

  function openNotifyPop() {
    var existing = document.getElementById('period-notify-pop');
    if (existing) existing.remove();
    var pop = document.createElement('div');
    pop.id = 'period-notify-pop';
    pop.className = 'period-day-pop';
    var advOpts = [3, 2, 1, 0];
    var advHtml = advOpts.map(function (d) {
      var on = notifyCfg.advanceDays.indexOf(d) >= 0;
      return '<button class="dp-sym adv' + (on ? ' on' : '') + '" data-adv="' + d + '">' + (d === 0 ? '当天' : '前' + d + '天') + '</button>';
    }).join('');
    pop.innerHTML =
      '<div class="dp-mask"></div>' +
      '<div class="dp-sheet">' +
        '<div class="dp-head"><span class="dp-date">经期提醒设置</span><button class="dp-close">×</button></div>' +
        '<div class="dp-section"><div class="dp-label">启用提醒</div><button class="dp-toggle' + (notifyCfg.enabled ? ' on' : '') + '">' + (notifyCfg.enabled ? '已开启' : '已关闭') + '</button></div>' +
        '<div class="dp-section"><div class="dp-label">梦角关心（经期自动发关心语）</div><div class="dp-care-ctrl"><button class="dp-toggle care-toggle' + (notifyCfg.careEnabled ? ' on' : '') + '">' + (notifyCfg.careEnabled ? '已开启' : '已关闭') + '</button><button class="dp-care-mgr period-btn">管理关心语</button></div></div>' +
        '<div class="dp-section"><div class="dp-label">提醒提前天数</div><div class="dp-sym-grid">' + advHtml + '</div></div>' +
        '<div class="dp-section"><div class="dp-label">提醒时间（小时 0-23）</div><input class="dp-hour" type="number" min="0" max="23" value="' + (notifyCfg.hour || 9) + '"/></div>' +
        '<div class="dp-tip">提醒在打开应用时检查并推送；后台通知需浏览器支持。</div>' +
        '<div class="dp-actions"><button class="dp-save period-btn primary">保存</button></div>' +
      '</div>';
    appendPop(pop);
    document.body.classList.add('scroll-lock');
    pop.querySelector('.dp-mask').addEventListener('click', closeNotifyPop);
    pop.querySelector('.dp-close').addEventListener('click', closeNotifyPop);
    var toggleBtn = pop.querySelector('.dp-toggle');
    toggleBtn.addEventListener('click', function () {
      notifyCfg.enabled = !notifyCfg.enabled;
      toggleBtn.textContent = notifyCfg.enabled ? '已开启' : '已关闭';
      toggleBtn.classList.toggle('on', notifyCfg.enabled);
      if (notifyCfg.enabled && 'Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) {}
      }
    });
    var careBtn = pop.querySelector('.care-toggle');
    if (careBtn) careBtn.addEventListener('click', function () {
      notifyCfg.careEnabled = !notifyCfg.careEnabled;
      careBtn.textContent = notifyCfg.careEnabled ? '已开启' : '已关闭';
      careBtn.classList.toggle('on', notifyCfg.careEnabled);
    });
    var careMgr = pop.querySelector('.dp-care-mgr');
    if (careMgr) careMgr.addEventListener('click', openCarePop);
    pop.querySelectorAll('.adv').forEach(function (b) {
      b.addEventListener('click', function () { b.classList.toggle('on'); });
    });
    pop.querySelector('.dp-save').addEventListener('click', function () {
      var advs = [];
      pop.querySelectorAll('.adv.on').forEach(function (b) { advs.push(parseInt(b.getAttribute('data-adv'), 10)); });
      if (!advs.length) advs = [3, 1, 0];
      // v3.10.x：同上——.dp-hour 转换后先命中 div 读 undefined，提醒小时静默重置 9 点
      var h = parseInt(readInpVal(pop.querySelector('input.dp-hour')), 10);
      notifyCfg.advanceDays = advs;
      notifyCfg.hour = isNaN(h) ? 9 : Math.min(23, Math.max(0, h));
      saveNotify(notifyCfg);
      closeNotifyPop();
      toast('已保存');
      checkNotify();
      checkCare();
    });
  }
  function closeNotifyPop() {
    var pop = document.getElementById('period-notify-pop');
    if (pop) pop.remove();
    document.body.classList.remove('scroll-lock');
  }

  // ---- 事件绑定 ----
  var app = document.querySelector('.app[data-app="period"]');
  if (app && page) {
    app.addEventListener('click', function () {
      var editing = Array.from(document.querySelectorAll('.app-grid')).some(function (g) { return g.classList.contains('editing'); });
      if (editing) return;
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      page.hidden = false;
      cfg = loadCfg(); recs = loadRecs(); daily = loadDaily(); notifyCfg = loadNotify();
      viewM = -1;
      render();
      checkNotify();
      checkCare();
    });
  }
  var back = document.getElementById('period-back');
  if (back) back.addEventListener('click', function () {
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
    var home = document.getElementById('page-phone');
    if (home) home.hidden = false;
  });
  var prevBtn = document.getElementById('period-prev');
  if (prevBtn) prevBtn.addEventListener('click', function () { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderGrid(); });
  var nextBtn = document.getElementById('period-next');
  if (nextBtn) nextBtn.addEventListener('click', function () { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderGrid(); });
  var ms = document.getElementById('period-mark-start');
  if (ms) ms.addEventListener('click', markStart);
  var me = document.getElementById('period-mark-end');
  if (me) me.addEventListener('click', markEnd);
  var rt = document.getElementById('period-record-today');
  if (rt) rt.addEventListener('click', function () { openDayPop(todayStr()); });
  // 日历日格：短按打开每日详情浮层（记录经量/症状/情绪），长按切换经期标记
  var grid = document.getElementById('period-grid');
  if (grid) {
    var pressTimer = null, longPressed = false;
    grid.addEventListener('click', function (e) {
      if (longPressed) { longPressed = false; return; }
      var cell = e.target.closest('.pc-cell');
      if (!cell || cell.classList.contains('blank')) return;
      openDayPop(cell.getAttribute('data-date'));
    });
    grid.addEventListener('contextmenu', function (e) {
      var cell = e.target.closest('.pc-cell');
      if (!cell || cell.classList.contains('blank')) return;
      e.preventDefault();
      // v3.10.x：长按双触发去重——安卓长按日格时 contextmenu 与 touchstart 的 500ms
      // 定时器几乎同时各调一次 toggleDay = 标红又立刻取消（OPPO Reno16 Edge/Via
      // 实测「没办法设置成生理期」）。谁先到谁生效：定时器已触发（longPressed）则
      // 跳过；contextmenu 先到则取消定时器，保证只 toggle 一次。longPressed 不在
      // 这里复位——它还要供 click 处理器吞掉长按后的合成点击。
      if (longPressed) return;
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      toggleDay(cell.getAttribute('data-date'));
    });
    grid.addEventListener('touchstart', function (e) {
      var cell = e.target.closest('.pc-cell');
      if (!cell || cell.classList.contains('blank')) return;
      var ds = cell.getAttribute('data-date');
      longPressed = false;
      pressTimer = setTimeout(function () { pressTimer = null; longPressed = true; toggleDay(ds); }, 500);
    }, { passive: true });
    grid.addEventListener('touchmove', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });
    grid.addEventListener('touchend', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });
    grid.addEventListener('touchcancel', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });
  }
  var hist = document.getElementById('period-history');
  if (hist) hist.addEventListener('click', function (e) {
    var del = e.target.closest('.ph-del');
    if (!del) return;
    delRec(del.getAttribute('data-id'));
  });
  var cog = document.getElementById('period-cog');
  if (cog) cog.addEventListener('click', openSettingsPop);
  // 通知设置入口：在 cog 旁加铃铛按钮（JS 创建，不改 template）
  var cogEl = document.getElementById('period-cog');
  if (cogEl && cogEl.parentNode && !document.getElementById('period-notify-btn')) {
    var nb = document.createElement('span');
    nb.id = 'period-notify-btn';
    nb.className = 'period-cog';
    nb.title = '提醒设置';
    nb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    nb.addEventListener('click', openNotifyPop);
    cogEl.parentNode.insertBefore(nb, cogEl);
  }

  // v3.10.x 全局共享：经期数据不随联系人切换重载（所有桌面共用全局键）。
  // contact-switched 无需处理；进页面时 app click handler 已重读全局同一份数据。

  // ---- 桌面经期倒计时小组件 ----
  // v3.26.x：内容补充——左上角阶段标签 + 副行预计下次日期 + 底部周期进度条。
  // 阶段标签 dpd-phase / 进度条 dpd-bar-wrap 由 ensureWidgetExtras 按需创建，
  // 避免改 AI-B 的 template.html（desk-period 卡整体归 AI-A，内层元素可由 JS 生成）。
  function ensureWidgetExtras() {
    var card = document.querySelector('[data-desk-widget="desk-period"]');
    if (!card) return;
    if (!document.getElementById('dpd-phase')) {
      var b = document.createElement('div'); b.id = 'dpd-phase'; b.className = 'dpd-phase';
      b.hidden = true; card.insertBefore(b, card.firstChild);
    }
    if (!document.getElementById('dpd-bar-wrap')) {
      var wrap = document.createElement('div');
      wrap.id = 'dpd-bar-wrap'; wrap.className = 'dpd-bar-wrap'; wrap.hidden = true;
      var cap = document.createElement('div'); cap.className = 'dpd-bar-cap';
      var track = document.createElement('div'); track.className = 'dpd-bar';
      var fill = document.createElement('div'); fill.id = 'dpd-bar-fill'; fill.className = 'dpd-bar-fill';
      track.appendChild(fill); wrap.appendChild(cap); wrap.appendChild(track);
      card.appendChild(wrap);
    }
  }
  // 日期串 "2026-9-3" → "9/3"
  function mdLabel(s) { if (!s) return ''; var p = s.split('-'); return (+p[1]) + '/' + (+p[2]); }
  function renderDeskWidget() {
    ensureWidgetExtras();
    var phaseEl = document.getElementById('dpd-phase');
    var labelEl = document.getElementById('dpd-label');
    var daysEl = document.getElementById('dpd-days');
    var subEl = document.getElementById('dpd-sub');
    var barWrap = document.getElementById('dpd-bar-wrap');
    var barFill = document.getElementById('dpd-bar-fill');
    if (!labelEl || !daysEl || !subEl) return;
    var st = status();
    // 阶段标签（左上角）
    var ph = { txt: '', cls: '' };
    if (st.inPeriod) ph = { txt: '经期', cls: 'phase-period' };
    else if (st.phase === 'fertile') ph = { txt: '排卵期', cls: 'phase-fertile' };
    // 其余（安全期/正常）不显示阶段标签
    if (phaseEl) {
      if (ph.txt) { phaseEl.textContent = ph.txt; phaseEl.className = 'dpd-phase ' + ph.cls; phaseEl.hidden = false; }
      else { phaseEl.className = 'dpd-phase'; phaseEl.hidden = true; }
    }
    // 主内容
    if (st.inPeriod) {
      labelEl.textContent = '经期第 ' + st.dayOfCycle + ' 天';
      daysEl.textContent = st.dayOfCycle;
      subEl.textContent = '注意保暖休息';
    } else if (st.nextStart) {
      var d = diffDays(todayStr(), st.nextStart);
      labelEl.textContent = '距下次经期';
      daysEl.textContent = d + ' 天';
      subEl.textContent = '预计 ' + mdLabel(st.nextStart) + ' 开始';
    } else {
      labelEl.textContent = '经期';
      daysEl.textContent = '—';
      subEl.textContent = '未记录';
    }
    // 周期进度条（第 X/总 天；无周期数据则隐藏，填充宽度不少于 3% 以便可见）
    if (barWrap && barFill && st.dayOfCycle && st.cycleLen) {
      var cap = barWrap.querySelector('.dpd-bar-cap');
      if (cap) cap.textContent = '周期第 ' + st.dayOfCycle + '/' + st.cycleLen + ' 天';
      barWrap.hidden = false;
      var pct = Math.max(3, Math.min(100, st.dayOfCycle / st.cycleLen * 100));
      barFill.style.width = pct + '%';
    } else if (barWrap) {
      barWrap.hidden = true;
    }
  }
  window.periodRenderDeskWidget = renderDeskWidget;
  // 桌面组件点击跳经期页
  (function bindDeskWidget() {
    var w = document.querySelector('[data-desk-widget="desk-period"]');
    if (w) w.addEventListener('click', function () {
      var app = document.querySelector('.app[data-app="period"]');
      if (app) app.click();
    });
  })();

  // 启动后稍延迟检查通知（经期预测/延迟预警）+ 梦角关心触发
  setTimeout(checkNotify, 3000);
  setTimeout(checkCare, 5000);
  setTimeout(renderDeskWidget, 2500);
  setTimeout(renderDeskWidget, 6000);
  document.addEventListener('contact-switched', function () { setTimeout(renderDeskWidget, 200); });
  document.addEventListener('mochi-restore-done', function () { setTimeout(renderDeskWidget, 200); });
})();

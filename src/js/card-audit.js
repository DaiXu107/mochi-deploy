// ===== 功能：设置 → 工具 →【所有字卡使用状态自检系统】 =====
// 需求（用户）：字卡分「自定义字卡」和「系统预设字卡」，系统预设又被二级密码（#319 防未
//   成年人锁）整体锁住，且分组/分类非常多——要一个统一自检页，一次看清「每类字卡现在到底
//   能不能被联系人用到、卡在链路哪一步、坏在哪」，并能一键跳去修 / 就地修。
// 设计：只读诊断 + 安全修复。诊断不写任何键；修复只在用户点按钮时写「恢复可用」类键
//   （概率回默认、开关打开、分组启用、单卡关闭清空），全部走 activeStore/xyStore，不改动
//   任何自定义字卡内容。
// 数据来源（读现有键/现有 API，不复制业务逻辑到本文件）：
//   · 锁：window.cardLockOpen()（card-lock.js #319）
//   · 系统预设开关/概率：activeStore 的 dc-* / dcf-* / dict-* / mc-* / rc-*/rcard-* / tm-* 等
//   · 卡数：window.DEFAULT_CARD_DATA / MOOD_FOLLOWUP_DATA / TA_MOOD_DATA
//   · 卡数据健康：window.__ccAuditHealth()（chatcard.js，媒体池丢失令牌/语音坏数据/超大图）
//   · 自定义字卡：window.getScopedGroups(type, scope)（已按停用分组过滤 + 令牌化池视图）
// 安全：绝不对各桌面 cc-groups 巨型串 JSON.parse（实测单键 150MB+）——各桌面概览只报体积
//   （字符串 length 为 O(1)），明细仅按需解析（体积上限保护）。
(function () {
  var page = document.getElementById('page-card-audit');
  if (!page) return;
  var row = document.getElementById('row-card-audit');
  var back = document.getElementById('card-audit-back');
  var bodyEl = document.getElementById('card-audit-body');
  var refreshBtn = document.getElementById('card-audit-refresh');
  var copyBtn = document.getElementById('card-audit-copy');
  var filterBtn = document.getElementById('card-audit-filter');
  var pickBtn = document.getElementById('card-audit-pick');
  var applyBtn = document.getElementById('card-audit-apply');
  var undoBtn = document.getElementById('card-audit-undo');
  var exportBtn = document.getElementById('card-audit-export');
  if (!bodyEl) return;

  var GNS = 'xy-home-v2';
  var lastText = '';
  var sections = [];   // 本次 build 的分节 HTML
  var lines = [];      // 本次 build 的纯文本报告
  var fixMap = {};     // 修复按钮 id → 执行函数（每次 build 重建）
  var bulkFixes = [];  // 「一键修复系统预设可用」批量执行列表
  var issueCount = 0;
  var issues = [];
  var onlyProblems = false; // 「只看有问题」筛选
  var pickMode = false;     // 「批量修复」勾选模式
  var undoStack = [];       // 上一次修复的撤销数据（单级撤销）
  var fixDesc = {};         // 修复 id → 变更预览描述

  // ---------- 基础读取 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function activeCid() { try { return window.getActiveContact ? window.getActiveContact() : (window.__activeCid || 'default'); } catch (e) { return 'default'; } }
  function activePrefix() { try { return window.activePrefix ? window.activePrefix() : (GNS + ':' + activeCid()); } catch (e) { return GNS + ':' + activeCid(); } }
  function store(k) { try { return window.activeStore().get(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { window.activeStore().set(k, String(v)); return true; } catch (e) { return false; } }
  function glob(k) { try { return window.xyStore(GNS).get(k); } catch (e) { return null; } }
  function globSet(k, v) { try { window.xyStore(GNS).set(k, String(v)); return true; } catch (e) { return false; } }
  // 作用域感知读写（撤销/公共库用）：own=当前桌面命名空间，public=全局根键
  function storeGetScope(scope, key) { try { return scope === 'public' ? window.xyStore(GNS).get(key) : window.activeStore().get(key); } catch (e) { return null; } }
  function storeSetScope(scope, key, val) { try { if (scope === 'public') window.xyStore(GNS).set(key, String(val)); else window.activeStore().set(key, String(val)); return true; } catch (e) { return false; } }
  function storeRemoveScope(scope, key) { try { if (scope === 'public') window.xyStore(GNS).remove(key); else window.activeStore().remove(key); return true; } catch (e) { return false; } }
  function recordUndo(scope, key) { try { undoStack.push({ scope: scope, key: key, old: storeGetScope(scope, key) }); } catch (e) {} }
  function rawFor(cid, k) { try { var s = window.storeFor ? window.storeFor(cid) : window.xyStore(GNS + ':' + cid); return s.get(k); } catch (e) { return null; } }
  function num(v, d) { if (v === null || v === undefined || v === '') return d; var n = Number(v); return isNaN(n) ? d : n; }
  function clampPct(v) { var n = Number(v); if (!isFinite(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }
  function boolOf(v, d) { if (v === null || v === undefined || v === '') return d; return v === '1'; }
  function locked() { try { return !(window.cardLockOpen && window.cardLockOpen()); } catch (e) { return false; } }
  function dcpAll() { return Math.max(0, Math.min(100, num(store('reply-dcp-all'), 100))); }
  function dcfEff(raw, key) {
    var a = dcpAll();
    var eff = a >= 100 ? raw : Math.round(raw * a / 100);
    if (key !== 'deskcheck' && !boolOf(store('dcf-enabled'), true)) eff = 0;
    return Math.max(0, Math.min(100, eff));
  }
  function contacts() { try { return (window.getContacts ? window.getContacts() : []) || []; } catch (e) { return []; } }
  function deskName(cid) { try { return (window.contactNameFor ? window.contactNameFor(cid) : '') || cid; } catch (e) { return cid; } }
  function parseGroups(raw) {
    try { var g = JSON.parse(raw || 'null'); if (g && g.text) return g; } catch (e) {}
    return {};
  }
  // 概率人话化：p% 换算成「平均每 N 条回复 / N 次触发约 1 次」
  function humanProb(p, unit) {
    p = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
    if (p <= 0) return '基本不出现';
    if (p >= 100) return unit === 'trig' ? '每次触发都出现' : '每条回复都出现';
    var n = Math.max(2, Math.round(100 / p));
    return '平均每 ' + n + ' ' + (unit === 'trig' ? '次触发' : '条回复') + '约 1 次';
  }
  function deferredLibs() {
    try { return !!(window.libScopesDeferred && window.libScopesDeferred(['public', 'own'])); } catch (e) { return false; }
  }

  // 单卡关闭计数：<prefix>:dc-off-<cat>:<内容>。一次自检内「一次性索引 + 缓存」，不再反复扫。
  var offCache = null; // {cat:n}
  function buildOffIndex() {
    var idx = {};
    try {
      var pre = activePrefix() + ':dc-off-';
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(pre) !== 0) continue;
        var rest = k.slice(pre.length);
        var c = rest.indexOf(':');
        var cat = c < 0 ? rest : rest.slice(0, c);
        idx[cat] = (idx[cat] || 0) + 1;
      }
    } catch (e) {}
    return idx;
  }
  function offCount(cat) { return (offCache && offCache[cat]) || 0; }
  function offKeysOf(cat) {
    var out = [];
    try {
      var pre = activePrefix() + ':dc-off-' + cat + ':';
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(pre) === 0) out.push(k.slice(activePrefix().length + 1));
      }
    } catch (e) {}
    return out;
  }

  var presetCntCache = {};
  function presetGroups(cat) {
    try { return (window.DEFAULT_CARD_DATA && window.DEFAULT_CARD_DATA[cat]) || []; } catch (e) { return []; }
  }
  function presetCount(cat) {
    if (presetCntCache[cat] !== undefined) return presetCntCache[cat];
    var n = 0;
    presetGroups(cat).forEach(function (g) { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; });
    presetCntCache[cat] = n;
    return n;
  }
  function dataCount(node) {
    var n = 0;
    try {
      if (Array.isArray(node)) {
        node.forEach(function (g) { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; else if (Array.isArray(g)) n += g.length; });
      } else if (node && typeof node === 'object') {
        Object.keys(node).forEach(function (k) { var v = node[k]; if (Array.isArray(v)) n += v.length; else if (v && typeof v === 'object') n += dataCount(v); });
      }
    } catch (e) {}
    return n;
  }

  // 自定义字卡分类标签与顺序
  var CC_LABEL = {
    text: '文字', kaomoji: '颜文字', emoji: 'emoji', sticker: '表情包', image: '图片', poke: '拍一拍', voice: '语音',
    fish: '摸鱼', eat: '吃饭', period: '经期', water: '喝水', garden: '花园', sync: '同频', reach: '伸手',
    cjian: '此间', room: '房间', piggy: '存钱罐', drift: '漂流瓶', interact: '互动回应', music: '音乐', mjfree: '梦角自由造句'
  };
  var CC_ORDER = Object.keys(CC_LABEL);

  // 当前桌面/公用池视图（带停用过滤；不整库 parse）
  var poolCache = {};
  function scopePool(scope, type) {
    var key = scope + '|' + type;
    if (poolCache[key] !== undefined) return poolCache[key];
    var v = [];
    try { v = (window.getScopedGroups ? window.getScopedGroups(type, scope) : []) || []; } catch (e) { v = []; }
    poolCache[key] = v;
    return v;
  }
  function offRecord(scope) {
    var raw;
    try { raw = scope === 'public' ? glob('cc-groups-public-off') : store('cc-groups-off'); } catch (e) { raw = null; }
    try { var o = raw ? JSON.parse(raw) : null; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  }
  function offCountIn(rec) { var n = 0; Object.keys(rec).forEach(function (t) { if (Array.isArray(rec[t])) n += rec[t].length; }); return n; }

  // 功能字卡定义（与 default-cards.js DCF_DEF / DCF_DEF_NAME 对齐；末位=是否有独立字卡池）
  var DCF = [
    ['fish', '摸鱼', 35, true], ['eat', '吃饭', 35, true], ['period', '经期', 25, true], ['water', '喝水', 35, true],
    ['garden', '花园', 40, true], ['sync', '同频', 60, true], ['reach', '伸手', 55, true], ['cjian', '此间', 100, true],
    ['room', '房间', 100, true], ['piggy', '存钱罐', 100, true], ['drift', '漂流瓶', 100, true], ['interact', '互动回应', 100, true],
    ['music', '音乐', 100, true], ['deskcheck', '跨桌面查岗', 50, true],
    ['checkin', '寻踪日常', 100, false], ['pomo', '番茄钟', 100, false], ['care', 'TA的关心（经期）', 100, false],
    ['memo', '备忘提醒', 100, false], ['ask', 'TA主动提问', 100, false]
  ];

  // 跳转目标（选择器链，逐个 .click()；'#row-...' 为设置行，走 showSettingRow）
  var JUMPS = {
    defaultCards: ['.tab[data-page="page-chatcard"]', '#li-default-cards'],
    dictCards: ['.tab[data-page="page-chatcard"]', '#li-dict-cards'],
    funCards: ['.tab[data-page="page-chatcard"]', '#li-fun-cards'],
    customPublic: ['.tab[data-page="page-chatcard"]', '#li-custom-cards-public'],
    customOwn: ['.tab[data-page="page-chatcard"]', '#li-custom-cards'],
    moodCards: ['.tab[data-page="page-chatcard"]', '#li-mood-cards'],
    replyCards: ['.tab[data-page="page-chatcard"]', '#li-reply-cards'],
    taMood: ['.tab[data-page="page-chatcard"]', '#li-ta-mood'],
    quoteCards: ['.tab[data-page="page-chatcard"]', '#li-quote-cards'],
    locCards: ['.tab[data-page="page-chatcard"]', '#li-loc-cards'],
    checkinCards: ['.tab[data-page="page-chatcard"]', '#li-checkin-cards'],
    deskcheck: ['.tab[data-page="page-chatcard"]', '#li-deskcheck'],
    taCheckin: ['.tab[data-page="page-chatcard"]', '#li-ta-checkin'],
    taAsk: ['.tab[data-page="page-chatcard"]', '#li-ta-ask'],
    taChoose: ['.tab[data-page="page-chatcard"]', '#li-ta-choose'],
    taCurious: ['.tab[data-page="page-chatcard"]', '#li-ta-curious'],
    taRoast: ['.tab[data-page="page-chatcard"]', '#li-ta-roast'],
    replySettings: '#row-general',
    storage: '#row-storage-view'
  };

  // ---------- HTML 片段 ----------
  function cls(lv) { return lv === 'ok' ? 'ca-ok' : lv === 'warn' ? 'ca-warn' : lv === 'bad' ? 'ca-bad' : 'ca-mute'; }
  function rowHtml(label, value, lv, opt) {
    opt = opt || {};
    var lab = esc(label);
    if (opt.jump) lab = '<span class="ca-jump" data-jump="' + esc(opt.jump) + '">' + lab + '</span>';
    var v = esc(value);
    var edit = opt.edit ? '<span class="ca-jump ca-edit" data-jump="' + esc(opt.edit) + '">调整</span>' : '';
    var fix = '';
    if (opt.fix) fix = '<button class="ca-fix" type="button" data-fix="' + esc(opt.fix) + '">' + esc(opt.fixLabel || '修复') + '</button>';
    return '<div class="storage-row"><span>' + lab + '</span><b class="' + cls(lv) + '">' + v + edit + fix + '</b></div>';
  }
  function funnelHtml(items) {
    var parts = [];
    items.forEach(function (it, i) {
      if (i) parts.push('<span class="sep">→</span>');
      parts.push('<span class="st ' + (it.ok ? 'ca-flow-ok' : 'ca-flow-no') + '">' + (it.ok ? '✓' : '✕') + esc(it.t) + '</span>');
    });
    return '<div class="ca-funnel">' + parts.join('') + '</div>';
  }
  function cardHtml(title, inner, note) {
    return '<div class="cal-card glass"><div class="cal-card-title">' + esc(title) + '</div>' + inner + (note ? '<div class="storage-hint">' + note + '</div>' : '') + '</div>';
  }
  function stripHtml(s) {
    return String(s)
      .replace(/<button[^>]*data-fix="[^"]*"[^>]*>[^<]*<\/button>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|span|b|em|p|li)>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  function push(title, inner, note) {
    sections.push(cardHtml(title, inner, note));
    lines.push('【' + title + '】');
    lines.push(stripHtml(inner));
    if (note) lines.push(stripHtml(note));
    lines.push('');
  }
  function addFix(id, fn) { fixMap[id] = fn; }
  function addIssue(lv, text) {
    if (lv === 'warn' || lv === 'bad') issueCount++;
    issues.push({ lv: lv, text: text });
  }

  // ---------- 修复动作 ----------
  function fixProb(id, key, def, after) {
    addFix(id, function () {
      var ok = storeSet(key, def);
      if (ok && after) { try { after(); } catch (e) {} }
      return ok ? true : 'fail';
    });
  }
  function fixEnable(id, key, after) {
    addFix(id, function () { var ok = storeSet(key, '1'); if (ok && after) { try { after(); } catch (e) {} } return ok ? true : 'fail'; });
  }
  function fixGroupOff(id, scope, type) {
    addFix(id, function () {
      var key = scope === 'public' ? 'cc-groups-public-off' : 'cc-groups-off';
      var raw = scope === 'public' ? glob(key) : store(key);
      var o = {}; try { o = JSON.parse(raw || '{}') || {}; } catch (e) { o = {}; }
      if (!o[type]) return false;
      delete o[type];
      var json = JSON.stringify(o);
      var ok = scope === 'public' ? globSet(key, json) : storeSet(key, json);
      try { if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite(); } catch (e) {}
      return ok ? true : 'fail';
    });
  }
  function fixCardOffs(id, cat) {
    addFix(id, function () {
      var ks = offKeysOf(cat);
      if (!ks.length) return false;
      var ok = false;
      ks.forEach(function (short) { if (storeSet(short, '0')) ok = true; });
      return ok ? true : 'fail';
    });
  }
  function registerBulk(id) { bulkFixes.push(id); }

  // ---------- 报告构建 ----------
  function build() {
    offCache = buildOffIndex();
    presetCntCache = {}; poolCache = {};
    sections = []; lines = []; fixMap = {}; bulkFixes = []; issueCount = 0; issues = [];

    var lock = locked();
    var dcEn = boolOf(store('dc-enabled'), true);
    var dcfEn = boolOf(store('dcf-enabled'), true);
    var mcEn = boolOf(store('mc-enabled'), true);
    var all = dcpAll();
    var customTotal = 0;
    try { customTotal = window.cardLockCustomCount ? window.cardLockCustomCount() : 0; } catch (e) { customTotal = 0; }
    var contactsArr = contacts();
    var pubOff = offRecord('public');
    var ownOff = offRecord('own');

    // 当前桌面可用量（一次）
    var ownUsable = 0, pubUsable = 0;
    CC_ORDER.forEach(function (t) {
      scopePool('own', t).forEach(function (g) { ownUsable += (g && Array.isArray(g[1]) ? g[1].length : 0); });
      scopePool('public', t).forEach(function (g) { pubUsable += (g && Array.isArray(g[1]) ? g[1].length : 0); });
    });
    var ownGroups = CC_ORDER.reduce(function (n, t) { return n + scopePool('own', t).length; }, 0);
    var pubGroups = CC_ORDER.reduce(function (n, t) { return n + scopePool('public', t).length; }, 0);
    var deferred = deferredLibs();                     // 大库 IDB 回填挂起：本次读数可能偏少

    // ===== #583：回复设置 → 聊天 的「链路闸门」读数 =====
    // 用户点名「回复设置里的聊天设置那些也要一起检查」——字卡用不到，有一半原因不在字卡池，
    //   而在「这条回复根本没触发 / 被别的机制占掉」。本段把回复设置→聊天里所有决定
    //   「字卡能否出镜」的键读成一组闸门，供下方「二、回复链路」节与问题清单共用。
    // 两条口径与消费端逐一核对过（dcp-master.js 的接线清单 + 各消费文件）：
    //   ① 生效值 = 存盘值 × 总档(reply-dcp-all) ÷ 100。总档只缩放系统预设侧；注意
    //      梦角造句的 mjf-prob 不过总档（dream-free.js 直接读存盘值），默认聊天字卡只
    //      缩放 overall、分类占比 dc-prob-* 不缩放（drawCards 里总档只乘 overall）。
    //   ② 预设默认字卡最终落进回复的概率 = (1 − csp-cust%) × P(drawCards 命中)，不是与
    //      自定义字卡「二选一」——chat.js genReplyText 在默认字卡覆盖点前按 csp-cust 掷签
    //      保留自定义文本，命中保留则 drawCards 的结果被丢弃。
    var cspCust = clampPct(num(store('csp-cust'), 50));
    var dcUseChat = boolOf(store('dc-use-chat'), true);
    var dcOvRaw = clampPct(num(store('dc-overall-chat'), 30));
    var dcOvEff = Math.round(dcOvRaw * all / 100);
    var qsEn = boolOf(store('qs-en'), true);
    var qsProbRaw = clampPct(num(store('qs-prob'), 25));
    var qsProbEff = Math.round(qsProbRaw * all / 100);        // quote-spell.js 套总档
    var qsCc = boolOf(store('qs-cc'), true);
    // 注意：定义 window.dictUse / dictOverall 的那个 IIFE 开头是 `if (!dictView) return;`
    //   ——词典页锚点缺失时这两个 API 整个不存在。所以先按存储键取默认值、API 在时再覆盖，
    //   别把「API 不在」写成硬编码 true（那会把用户关掉的场景误报成开）。
    var dictUseChat = boolOf(store('dict-use-chat'), true);
    try { if (window.dictUse) dictUseChat = window.dictUse('chat') !== false; } catch (e) {}
    var dictOvChat = clampPct(num(store('dict-overall-chat'), 75));
    try { if (window.dictOverall) dictOvChat = clampPct(num(window.dictOverall('chat'), 75)); } catch (e) {}
    var dictPoolN = Math.max(0, presetCount('dict') - offCount('dict'));
    var mjfEn = boolOf(store('mjf-en'), true);
    var mjfProb = clampPct(num(store('mjf-prob'), 20));       // 不过总档
    var MJF_SRC = [['mjf-src-cc', 'mjf-w-cc', '自定义字卡', 50], ['mjf-src-def', 'mjf-w-def', '默认聊天字卡', 25], ['mjf-src-dict', 'mjf-w-dict', '词典', 25]];
    var mjfSrcOn = MJF_SRC.filter(function (s) { return boolOf(store(s[0]), true) && num(store(s[1]), s[3]) > 0; });
    var rcProbRaw = clampPct(num(store('rcard-prob'), 30));
    var cfProbRaw = clampPct(num(store('cf-prob'), 20));
    var rcProbEff = Math.round(rcProbRaw * all / 100);
    var cfProbEff = Math.round(cfProbRaw * all / 100);
    var pyEn = boolOf(store('py-en'), true);
    var pyProb = clampPct(num(store('py-prob'), 50));
    var rcSw = boolOf(store('rc-enabled'), true);        // 聊天回应字卡总开关（与「撤回后补发」的 rc-en 不是同一个键）
    var rnProb = clampPct(num(store('rn-prob'), 20));
    var asEn = boolOf(store('as-en'), true);
    var dndEn = boolOf(store('dnd-en'), false);
    // 附加件（不套总档，chat.js 直接读存盘值）
    var ATTACH = [['touch-prob', '拍一拍', 5], ['sticker-prob', '表情包', 10], ['emoji-prob', 'emoji', 5], ['image-prob', '图片', 5], ['voice-prob', '语音', 10], ['kaomoji-prob', '颜文字', 5], ['quote-prob', '引用', 30]];
    var attachOn = ATTACH.filter(function (a) { return num(store(a[0]), a[2]) > 0; });
    // 表情包/图片两条附加概率同时为 0 ⇒ 字卡库里的 sticker/image 卡永不进聊天（见下方附加件行）。
    // 必须在这里（问题清单之前）算好——放到渲染段会因 var 提升恒为 undefined，那条问题永不触发。
    var mediaOff = clampPct(num(store('sticker-prob'), 10)) === 0 && clampPct(num(store('image-prob'), 5)) === 0;

    // ===== 问题清单（先算，结论卡与角标都用） =====
    if (lock) addIssue('bad', '系统预设字卡被「二级密码锁」整体锁定（#319 防未成年人保护）——默认聊天字卡、词典（含词典拼字）等系统预设池当前都取不到，下方开关全开也无效。到开屏公告区「防未成年人·内置字卡锁定」卡点「输入密码解锁」即可恢复。');
    if (customTotal === 0 && lock) addIssue('bad', '你还没有任何自定义字卡，且系统预设字卡被锁定：联系人回复会非常单薄。建议先在「字卡库」里添加几张自定义字卡，或解锁系统预设。');
    if (!dcEn) addIssue('warn', '系统预设「聊天默认字卡」总开关关闭：聊天/信箱/朋友圈都不会混入系统预设聊天字卡。');
    if (!dcfEn) addIssue('warn', '「其他互动功能字卡」总开关关闭：摸鱼/吃饭/花园等功能触发时不再出字卡（不影响聊天默认字卡）。');
    if (all === 0) addIssue('warn', '系统预设字卡「聊天触发概率总档」为 0%：所有系统预设聊天概率归零。');
    if (ownUsable + pubUsable === 0 && !lock) addIssue('warn', '当前桌面没有任何「可用的自定义字卡」。');
    if (!pubGroups) addIssue('warn', '公用字卡库为空（所有桌面共享的库）。');
    ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
      var total = presetCount(k), off = offCount(k);
      if (total > 0 && off >= total) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类内 ' + total + ' 张已全部单卡关闭，实际无可用内容。');
      if (!boolOf(store('dc-cat-' + k), true)) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类开关被关闭。');
      if (num(store('dc-prob-' + k), 25) === 0) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类占比为 0%，该分类不会被抽中。');
    });
    DCF.forEach(function (d) {
      var key = d[0], name = d[1], def = d[2], hasPool = d[3];
      if (key === 'deskcheck') return;
      if (num(store('dcf-' + key), def) === 0 && dcfEn) addIssue('warn', '功能字卡「' + name + '」概率为 0%，该功能不再出字卡。');
      if (hasPool && presetCount(key) > 0 && offCount(key) >= presetCount(key)) addIssue('warn', '功能字卡「' + name + '」预设内容已全部单卡关闭。');
    });
    Object.keys(ownOff).forEach(function (t) { if ((ownOff[t] || []).length) addIssue('warn', '本桌面专属字卡「' + (CC_LABEL[t] || t) + '」有 ' + ownOff[t].length + ' 个分组被停用。'); });
    Object.keys(pubOff).forEach(function (t) { if ((pubOff[t] || []).length) addIssue('warn', '公用字卡「' + (CC_LABEL[t] || t) + '」有 ' + pubOff[t].length + ' 个分组被停用。'); });
    var health = { tokens: 0, missing: 0, bigMedia: 0, badVoice: 0 };
    try { if (window.__ccAuditHealth) health = window.__ccAuditHealth() || health; } catch (e) {}
    if (health.missing > 0) addIssue('bad', '检测到 ' + health.missing + ' 张图片/表情卡在媒体池里已丢失（聊天里会显示占位或发不出），多为导入的备份未含图片——需从有完整图片的源头设备重新导出「完整备份」再导入，或用「查看存储→媒体池重建」尝试自愈。');
    if (health.badVoice > 0) addIssue('warn', '检测到 ' + health.badVoice + ' 条语音卡数据格式异常（可能无法播放）。');
    if (health.bigMedia > 0) addIssue('warn', '检测到 ' + health.bigMedia + ' 张超大图片卡（>512KB），字卡库体积大、iOS/安卓容易卡顿，建议到「查看存储→字卡库瘦身」清理。');
    // #583：回复设置侧闸门——这半边关掉时字卡池再满也看不到出镜
    if (rnProb >= 100) addIssue('bad', '「已读不回概率」为 100%：TA 只显示回执、不再回复任何内容——所有字卡与互动都不会出现（回复设置→聊天 最上面的被动回复组）。');
    else if (rnProb > 60) addIssue('warn', '「已读不回概率」为 ' + rnProb + '%：大多数消息只会显示回执、不再回复内容，字卡与互动基本看不到（这是可选偏好；若你正困惑「字卡用不到」，先看这一项）。');
    if (qsEn && qsProbEff === 0 && qsProbRaw > 0) addIssue('warn', '「词典拼字」存盘 ' + qsProbRaw + '% 但被「系统预设字卡·聊天触发概率」总档 ' + all + '% 缩到 0%——拼字实际不会触发（两行都在 回复设置→聊天 里）。');
    if (!qsEn) addIssue('warn', '「词典拼字」总开关关闭：词典语录字卡不会参与拼字出镜。');
    else if (qsProbRaw === 0) addIssue('warn', '「词典拼字」概率为 0%：词典语录字卡不会参与拼字出镜。');
    else {
      var dictBlock = !dictUseChat ? '词典的「聊天使用」被关闭' : (dictOvChat === 0 ? '词典的「聊天概率」为 0%' : ((dictPoolN <= 0) ? '词典抽卡池为空（语录被逐张关闭）' : ''));
      if (dictBlock) addIssue('warn', '「词典拼字」开着且概率生效，但' + dictBlock + '——拼字抽不到卡，去「字卡库→默认字卡·词典」页调整。');
    }
    if (!mjfEn) addIssue('warn', '「梦角自由造句」总开关关闭。');
    else if (mjfProb === 0) addIssue('warn', '「梦角自由造句」概率为 0%。');
    else if (!mjfSrcOn.length) addIssue('warn', '「梦角自由造句」开着，但三个语料来源（自定义字卡/默认聊天字卡/词典）全关或权重全为 0——不会触发。');
    if (!pyEn) addIssue('warn', '「多字卡回复」总开关关闭：每条消息只回一条、每条只用一张字卡。');
    if (cspCust === 0) addIssue('warn', '「自定义字卡占比」为 0%：TA 的纯文字回复会尽量让系统预设默认字卡覆盖，你自己建的字卡基本不出现（想反过来就把它调高）。');
    if (!attachOn.length) addIssue('warn', '拍一拍/表情包/emoji/图片/语音/颜文字/引用 七项附加概率全为 0：回复只剩纯文字（回复设置→聊天 的被动回复组）。');
    else if (mediaOff) addIssue('warn', '「表情包概率」「图片概率」都为 0：字卡库里的表情包与图片字卡不会在聊天里出现（这两项是命中后往同一条回复里加图，不是独立机制，所以平时不容易联想到它们卡住了媒体字卡）。');
    if (!issues.length) addIssue('ok', '未发现明显问题：字卡各链路按当前设置正常取用。');

    // ===== 结论卡 =====
    var badN = 0, warnN = 0;
    issues.forEach(function (v) { if (v.lv === 'bad') badN++; else if (v.lv === 'warn') warnN++; });
    var verdictInner = '';
    var headLv, headTxt;
    if (lock) { headLv = 'bad'; headTxt = '系统预设字卡被二级密码锁住，先用开屏密码解锁'; }
    else if (badN) { headLv = 'bad'; headTxt = '有 ' + badN + ' 个需要处理的问题（字卡可能用不到）'; }
    else if (warnN) { headLv = 'warn'; headTxt = '整体可用，有 ' + warnN + ' 项可优化'; }
    else { headLv = 'ok'; headTxt = '一切正常：字卡按当前设置正常参与回复'; }
    verdictInner += (deferred ? '<div class="ca-banner ca-warn">⚠ 部分字卡还没从数据库取回（大库回填中），本次可用张数可能偏少，结果仅供参考。<button class="ca-fix" type="button" data-load="full">点此加载完整字卡</button></div>' : '');
    if (deferred) issueCount++;
    verdictInner += '<div class="ca-headline ' + cls(headLv) + '">' + (headLv === 'ok' ? '✓ ' : headLv === 'warn' ? '! ' : '✕ ') + esc(headTxt) + '</div>';
    issues.forEach(function (v) { verdictInner += '<div class="ca-issues ' + cls(v.lv) + '">● ' + esc(v.text) + '</div>'; });
    verdictInner += rowHtml('系统预设字卡', lock ? '被锁停' : ((dcEn || dcfEn) ? '部分/全部可用' : '总开关关闭'), lock ? 'bad' : 'ok', { edit: 'defaultCards' });
    verdictInner += rowHtml('当前桌面可用自定义字卡', '本桌面 ' + ownUsable + ' 张 · 公用 ' + pubUsable + ' 张（' + (ownGroups + pubGroups) + ' 组）', ownUsable + pubUsable > 0 ? 'ok' : 'mute', { edit: 'customOwn' });

    var fixable = [];
    if (!lock) {
      if (!dcEn) fixable.push({ id: 'fx-dc-en', key: 'dc-enabled', kind: 'en' });
      if (!dcfEn) fixable.push({ id: 'fx-dcf-en', key: 'dcf-enabled', kind: 'en' });
      if (all === 0) fixable.push({ id: 'fx-dcp-all', key: 'reply-dcp-all', kind: 'num', v: 100 });
      ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
        if (!boolOf(store('dc-cat-' + k), true)) fixable.push({ id: 'fx-dc-cat-' + k, key: 'dc-cat-' + k, kind: 'en' });
        if (num(store('dc-prob-' + k), 25) === 0) fixable.push({ id: 'fx-dc-prob-' + k, key: 'dc-prob-' + k, kind: 'num', v: 25 });
        if (presetCount(k) > 0 && offCount(k) >= presetCount(k)) fixable.push({ id: 'fx-dc-off-' + k, kind: 'cardoff', cat: k });
      });
      DCF.forEach(function (d) {
        if (d[0] === 'deskcheck') return;
        if (num(store('dcf-' + d[0]), d[2]) === 0) fixable.push({ id: 'fx-dcf-' + d[0], key: 'dcf-' + d[0], kind: 'num', v: d[2] });
        if (d[3] && presetCount(d[0]) > 0 && offCount(d[0]) >= presetCount(d[0])) fixable.push({ id: 'fx-dcf-off-' + d[0], kind: 'cardoff', cat: d[0] });
      });
    }
    fixable.forEach(function (f) {
      if (f.kind === 'en') fixEnable(f.id, f.key);
      else if (f.kind === 'num') fixProb(f.id, f.key, f.v, f.key.indexOf('dcf-') === 0 ? function () { try { window.dcfRefreshUI(f.key.slice(4)); } catch (e) {} } : null);
      else if (f.kind === 'cardoff') fixCardOffs(f.id, f.cat);
      registerBulk(f.id);
    });
    Object.keys(ownOff).forEach(function (t) { if ((ownOff[t] || []).length) { var id = 'fx-goff-own-' + t; fixGroupOff(id, 'own', t); registerBulk(id); } });
    Object.keys(pubOff).forEach(function (t) { if ((pubOff[t] || []).length) { var id2 = 'fx-goff-pub-' + t; fixGroupOff(id2, 'public', t); registerBulk(id2); } });
    if (bulkFixes.length) {
      addFix('__allfix', function () {
        bulkFixes.forEach(function (id) { try { if (fixMap[id]) fixMap[id](); } catch (e) {} });
        try { if (window.dcfRefreshUI) DCF.forEach(function (d) { window.dcfRefreshUI(d[0]); }); } catch (e) {}
        return true;
      });
      verdictInner += '<div class="ca-fixbar"><button class="storage-clear" type="button" data-fix="__allfix">一键修复系统预设可用</button></div>';
      verdictInner += '<div class="ca-sub">上述修复只把「概率回默认、开关打开、分组启用、单卡关闭清空」，不改动任何字卡内容；二级密码锁需本人去开屏解锁。</div>';
    }
    push('自检结论', verdictInner, null);

    // ===== 回复链路（回复设置 → 聊天） =====
    // #583：这一节回答「字卡池是满的，为什么还是看不到字卡」——把 回复设置→聊天 里所有
    //   决定字卡能否出镜的键摆成闸门。纯行为项（回复速度/条数/间隔）不进表：它们不影响
    //   「能不能出」，复读设置页只会把自检页撑长（用户要的是「卡在哪」，不是「值是多少」）。
    //   各机制是按概率依次掷签争夺同一条回复，不是互斥分区，所以这里逐行给「生效概率」+
    //   漏斗，不画语义上会骗人的饼图。
    var chainInner = '';
    var replyFixables = [];
    function replyFixSpec(m) {
      if (!m.fix) return null;
      var id = 'inl-rs-' + m.id;
      if (m.fix.kind === 'en') fixEnable(id, m.fix.key);
      else if (m.fix.kind === 'num') fixProb(id, m.fix.key, m.fix.v);
      else if (m.fix.kind === 'fn' && typeof m.fix.run === 'function') addFix(id, m.fix.run);
      else return null;
      replyFixables.push(id);
      return id;
    }
    var MECH = [
      {
        id: 'qs', name: '词典拼字', key: 'qs-en · qs-prob', ok: !lock && qsEn && qsProbEff > 0 && dictUseChat && dictOvChat > 0 && dictPoolN > 0,
        txt: '存盘 ' + qsProbRaw + '% · 生效 ' + qsProbEff + '%（' + humanProb(qsProbEff, 'reply') + '）',
        extra: '池 ' + dictPoolN + ' 条 · ' + (qsCc ? '混用自定义字卡' : '只用词典语录'),
        gates: [{ t: '锁', ok: !lock }, { t: '拼字开关', ok: qsEn }, { t: '拼字概率', ok: qsProbEff > 0 }, { t: '词典聊天使用', ok: dictUseChat }, { t: '词典概率', ok: dictOvChat > 0 }, { t: '抽卡池', ok: dictPoolN > 0 }],
        fix: !qsEn ? { kind: 'en', key: 'qs-en', label: '打开' } : (qsProbRaw === 0 ? { kind: 'num', key: 'qs-prob', v: 25, label: '恢复概率' } : null)
      },
      {
        id: 'mjf', name: '梦角自由造句', key: 'mjf-en · mjf-prob', ok: mjfEn && mjfProb > 0 && mjfSrcOn.length > 0,
        txt: mjfProb + '%（' + humanProb(mjfProb, 'reply') + '，此概率不过总档）',
        extra: mjfSrcOn.length ? '语料来源：' + mjfSrcOn.map(function (s) { return s[2]; }).join(' / ') : '语料来源：全关',
        gates: [{ t: '总开关', ok: mjfEn }, { t: '概率', ok: mjfProb > 0 }, { t: '语料来源', ok: mjfSrcOn.length > 0 }],
        fix: !mjfEn ? { kind: 'en', key: 'mjf-en', label: '打开' } : (mjfProb === 0 ? { kind: 'num', key: 'mjf-prob', v: 20, label: '恢复概率' } : null)
      },
      {
        id: 'rc', name: '聊天回应字卡', key: 'rc-enabled · rcard-prob · cf-prob',
        ok: rcSw && rcProbEff > 0,
        txt: '整条替换 存盘 ' + rcProbRaw + '% · 生效 ' + rcProbEff + '% ｜ 连接词追加 存盘 ' + cfProbRaw + '% · 生效 ' + cfProbEff + '%' + (all < 100 ? '（总档 ' + all + '% 缩放）' : ''),
        extra: '', gates: [{ t: '开关', ok: rcSw }, { t: '整条替换', ok: rcProbEff > 0 }],
        // 两处闸门同一颗按钮修：总开关关着时只写 rcard-prob 是空转（概率本来就非 0），
        //   必须先开开关——故这里用自定义修复而不是 kind:'num'。
        fix: (!rcSw || rcProbRaw === 0) ? {
          kind: 'fn', label: (!rcSw ? '打开' : '恢复概率'), run: function () {
            if (!boolOf(store('rc-enabled'), true)) storeSet('rc-enabled', '1');
            if (num(store('rcard-prob'), 30) === 0) storeSet('rcard-prob', 30);
            return true;
          }
        } : null
      },
      {
        id: 'py', name: '多字卡回复', key: 'py-en · py-prob', ok: pyEn && pyProb > 0,
        txt: (pyEn ? '开' : '关') + ' · ' + pyProb + '%（' + humanProb(pyProb, 'reply') + '，不过总档） · 每条拼 ' + num(store('py-min'), 2) + '~' + num(store('py-max'), 5) + ' 张',
        extra: '', gates: [{ t: '总开关', ok: pyEn }, { t: '概率', ok: pyProb > 0 }],
        // py-prob 也是会被设成 0 的（模板 data-min=0）——「概率为 0」与「开关关着」是两个闸门，
        //   同一颗按钮一起收口，不然点了「打开」仍然不出多字卡。
        fix: (!pyEn || pyProb === 0) ? {
          kind: 'fn', label: (!pyEn ? '打开' : '恢复概率'), run: function () {
            if (!boolOf(store('py-en'), true)) storeSet('py-en', '1');
            if (num(store('py-prob'), 50) === 0) storeSet('py-prob', 50);
            return true;
          }
        } : null
      }
    ];
    MECH.forEach(function (m) {
      var fixId = replyFixSpec(m);
      chainInner += '<div class="storage-row"><span>' + esc(m.name) + '<span class="ca-sub">' + esc(m.key) + '</span></span><b class="' + (m.ok ? 'ca-ok' : 'ca-warn') + '">' +
        esc(m.txt) + (m.extra ? ' · ' + esc(m.extra) : '') +
        (fixId && !m.ok ? ' <button class="ca-fix" type="button" data-fix="' + fixId + '">' + esc(m.fix.label) + '</button>' : '') +
        ' <span class="ca-jump ca-edit" data-jump="@reply:chat">调整</span></b></div>' + funnelHtml(m.gates);
    });
    // 「预设覆盖 vs 自定义保留」的真实口径：先按 py-en 抽自定义字卡，genReplyText 兜底，
    // 最后在默认字卡覆盖点按 csp-cust 掷签——命中保留自定义就丢弃 drawCards 的结果。
    // 所以预设实际落进回复的概率 = 总档缩放后的聊天概率 ×(1−csp-cust%)，不是与自定义互补。
    var presetFinal = (lock || !dcEn || !dcUseChat) ? 0 : Math.round(dcOvEff * (100 - cspCust) / 100);
    chainInner += '<div class="ca-ratio"><div class="ca-ratio-bar"><i style="width:' + presetFinal + '%"></i><u style="width:' + (100 - presetFinal) + '%"></u></div>' +
      '<div class="ca-ratio-legend"><span class="ca-ok">预设默认字卡覆盖 ' + presetFinal + '%</span><span class="ca-mute">其余 ' + (100 - presetFinal) + '%：自定义字卡 / 兜底池</span></div></div>';
    var idCsp = 'inl-rs-csp';
    var cspFix = '';
    if (cspCust === 0 && !lock) { fixProb(idCsp, 'csp-cust', 50); replyFixables.push(idCsp); cspFix = idCsp; }
    chainInner += rowHtml('自定义字卡占比（csp-cust）', cspCust + '%' + (cspCust === 0 ? ' · 自定义字卡基本不出现' : (cspCust >= 100 ? ' · 预设默认字卡基本不覆盖' : '')), cspCust === 0 ? 'warn' : 'ok', { fix: cspFix, edit: '@reply:chat' });
    chainInner += rowHtml('默认聊天字卡 · 聊天使用 / 概率（dc-use-chat · dc-overall-chat）', (dcUseChat ? '场景开' : '场景关') + ' · 存盘 ' + dcOvRaw + '% · 生效 ' + dcOvEff + '%（总档 ' + all + '%）', (!dcUseChat || dcOvEff === 0 || !dcEn) ? 'warn' : 'ok', { edit: 'defaultCards' });
    chainInner += funnelHtml([{ t: '锁', ok: !lock }, { t: '总开关', ok: dcEn }, { t: '聊天场景', ok: dcUseChat }, { t: '总档', ok: all > 0 }, { t: '聊天概率', ok: dcOvEff > 0 }, { t: '自定义占比放行', ok: cspCust < 100 }]);
    // 附加件：拍一拍/表情包/emoji/图片/语音/颜文字/引用——命中后往同一条回复里追加内容，
    // 表情包/图片/颜文字都是从你的字卡库里抽的（所以它们归零＝那几类字卡永不出现）。
    var attachMech = [['sticker-prob', '表情包'], ['image-prob', '图片'], ['kaomoji-prob', '颜文字'], ['touch-prob', '拍一拍'], ['emoji-prob', 'emoji'], ['voice-prob', '语音'], ['quote-prob', '引用']];
    var ATTACH_DEF = {};
    ATTACH.forEach(function (a) { ATTACH_DEF[a[0]] = a[2]; });
    var attachTxt = attachMech.map(function (a) { return a[1] + ' ' + clampPct(num(store(a[0]), ATTACH_DEF[a[0]])) + '%'; }).join(' · ');
    // FIX 2026-09-16 #583：附加件里有两类是从你自己的字卡库里抽卡的——「表情包概率」抽
    //   sticker 卡、「图片概率」抽 image 卡（chat.js genOneReply 命中后 push 一张
    //   getMediaCards(...)）。所以这两项同时为 0 ＝ 字卡库里的表情包/图片永远不会出现在
    //   聊天里，不只是「回复变纯文字」。全 7 项为 0 多是有意做纯文字，只作汇总提示；
    //   仅这两项为 0 更隐蔽，单独报并只补这两个键（其余附加件是用户有意留着的）。
    //   mediaOff 在读取段就算好了（`var` 提升会让这里的声明在问题清单处恒为 undefined）。
    // ⚠️ 按钮必须走 rowHtml 的 opt.fix 通道，不能把 `<button …>` 拼进 value——
    //   rowHtml 对 value 做 esc()，拼进去只会渲染成「转义后的源码文本」（本批首版就踩了，
    //   verify B14b 抓到：按钮在 DOM 里根本不存在）。带按钮的行全页同此约定。
    var attachNeedFix = (!attachOn.length || mediaOff) && !lock;
    if (attachNeedFix) {
      addFix('inl-rs-attach', function () {
        var okAny = false;
        if (attachOn.length) {
          ATTACH.forEach(function (a) { if ((a[0] === 'sticker-prob' || a[0] === 'image-prob') && storeSet(a[0], a[2])) okAny = true; });
        } else {
          ATTACH.forEach(function (a) { if (storeSet(a[0], a[2])) okAny = true; });
        }
        return okAny ? true : 'fail';
      });
      replyFixables.push('inl-rs-attach');
    }
    if (mediaOff && attachOn.length) attachTxt += ' · 表情包/图片字卡不会出现';
    chainInner += rowHtml('附加件（命中后往同一条回复里加内容）', attachTxt, (!attachOn.length || mediaOff) ? 'warn' : 'ok',
      { fix: attachNeedFix ? 'inl-rs-attach' : '', fixLabel: attachOn.length ? '恢复表情包/图片' : '全部恢复默认', edit: '@reply:chat' });
    // 行为闸门：不影响「字卡出不出」，但决定「TA 这条回复到底会不会发生」——已读不回
    //   100% 时一切都看不到，属 bad；主动发送/免打扰是用户自己的选择，只作中性展示。
    chainInner += rowHtml('已读不回概率（rn-prob）', rnProb + '%' + (rnProb >= 100 ? ' · TA 不再回复任何内容' : (rnProb > 60 ? ' · 大多数消息只显示回执' : '')), rnProb >= 100 ? 'bad' : rnProb > 60 ? 'warn' : 'ok', { edit: '@reply:chat' });
    chainInner += rowHtml('主动发送（as-en · as-prob）', (asEn ? '开 · ' + clampPct(num(store('as-prob'), 30)) + '%' : '关（TA 不主动找你）') + (dndEn ? ' · 免打扰中' : ''), 'mute', { edit: '@reply:chat' });
    if (replyFixables.length) {
      addFix('__allfix-reply', function () {
        replyFixables.forEach(function (id) { try { if (fixMap[id]) fixMap[id](); } catch (e) {} });
        return true;
      });
      chainInner += '<div class="ca-fixbar"><button class="storage-clear" type="button" data-fix="__allfix-reply">一键恢复字卡链路</button></div>';
      chainInner += '<div class="ca-sub">只把「开关打开、概率回默认」——不改字卡内容、不动你的回复速度/条数等偏好。</div>';
    }
    push('回复链路（回复设置 → 聊天）', chainInner,
      '字卡出镜＝「这条回复发生了」×「抽卡池有货」×「这条回复的内容名额被字卡类机制抢到」。本节的漏斗任一 ✕ 该机制就不出字卡。<br>' +
      '<b>总档</b>（reply-dcp-all）统一缩放系统预设侧概率（生效＝存盘×总档÷100）；<b>梦角自由造句</b>不过总档，<b>默认聊天字卡</b>只缩放整体概率、分类占比不缩放。<br>' +
      '<b>预设默认字卡覆盖</b>＝生效聊天概率 ×(1−自定义字卡占比)：先抽自定义字卡，最后按 csp-cust 掷签决定要不要让预设覆盖——所以「系统预设 X% / 自定义 (100−X)%」的说法不成立，两者不是二选一。<br>' +
      '点每行「调整」直达对应设置页（回复设置侧的行直达「回复设置 → 聊天」；「默认聊天字卡」那行去字卡库的默认字卡页）。情绪/心意/意图、TA 的心情等不受二级锁影响的池在下方「五」节。');

    // ===== 一、二级密码锁 =====
    var lockInner = '';
    lockInner += rowHtml('当前状态', lock ? '锁定中（系统预设字卡整体停用）' : '已解锁', lock ? 'bad' : 'ok');
    lockInner += rowHtml('存储键', GNS + ':cardlock-state（全局，不随桌面）', 'mute');
    push('一、二级密码锁（#319 防未成年人）', lockInner,
      '锁定时：默认聊天字卡、词典（含词典拼字）、其他互动功能字卡的系统预设内容全部取不到，各页开关看起来「开了却没效果」属正常。<br><b>不受此锁影响（#499 豁免）</b>：聊天情绪字卡、心意字卡、交流意图、聊天回应字卡、TA 的心情、今日情话、位置卡、查岗问题库、TA 主动提问——未解锁也照常使用。<br>解锁：开屏公告区「防未成年人·内置字卡锁定」卡点「输入密码解锁」；重锁：同卡一键重新上锁。');

    // ===== 二、默认聊天字卡 =====
    var dcInner = '';
    var idDcEn = 'inl-dc-en';
    if (!dcEn && !lock) fixEnable(idDcEn, 'dc-enabled');
    dcInner += rowHtml('总开关（dc-enabled）', dcEn ? '开启' : '关闭', dcEn ? 'ok' : 'warn', { fix: (!dcEn && !lock) ? idDcEn : '', edit: 'defaultCards' });
    ['chat', 'mail', 'feed'].forEach(function (k, i) {
      var nm = ['聊天', '信箱', '朋友圈'][i];
      var on = boolOf(store('dc-use-' + k), true);
      var id = 'inl-dc-use-' + k;
      if (!on && !lock) fixEnable(id, 'dc-use-' + k);
      dcInner += rowHtml(nm + '使用（dc-use-' + k + '）', on ? '开启' : '关闭', on ? 'ok' : 'warn', { fix: (!on && !lock) ? id : '', edit: 'defaultCards' });
    });
    ['chat', 'mail', 'feed'].forEach(function (k, i) {
      var nm = ['聊天', '写信', '朋友圈'][i];
      var def = k === 'feed' ? 100 : 30;
      var v = num(store('dc-overall-' + k), def);
      var id = 'inl-dc-ov-' + k;
      if (v === 0 && !lock) fixProb(id, 'dc-overall-' + k, def);
      dcInner += rowHtml(nm + '概率（dc-overall-' + k + '）', v + '% · ' + humanProb(v, 'reply'), v === 0 ? 'warn' : 'ok', { fix: (v === 0 && !lock) ? id : '', edit: 'defaultCards' });
    });
    ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
      var cat = boolOf(store('dc-cat-' + k), true);
      var prob = num(store('dc-prob-' + k), 25);
      var total = presetCount(k), off = offCount(k);
      // #583：补两道真实存在、原先漏斗里没有的闸门——`dc-use-chat`（聊天场景开关，drawCards
      //   `if (!a.use(scene)) return []`）与总档 `dcpEff(overall)`。缺了它们，总档=0 或
      //   聊天场景被关时每一行仍显示 ✓，用户会以为「分类占比 25% 就该出卡」。
      var funnel = funnelHtml([
        { t: '锁', ok: !lock }, { t: '总开关', ok: dcEn }, { t: '聊天场景', ok: dcUseChat }, { t: '总档', ok: all > 0 },
        { t: '分类', ok: cat }, { t: '占比', ok: prob > 0 }, { t: '内容', ok: (total - off) > 0 }
      ]);
      var usable = !lock && dcEn && dcUseChat && all > 0 && cat && prob > 0 && (total - off > 0);
      var idCat = 'inl-dc-cat-' + k, idProb = 'inl-dc-prob-' + k, idOff = 'inl-dc-off-' + k;
      if (!lock) {
        if (!cat) fixEnable(idCat, 'dc-cat-' + k);
        if (prob === 0) fixProb(idProb, 'dc-prob-' + k, 25);
        if (total > 0 && off >= total) fixCardOffs(idOff, k);
      }
      dcInner += '<div class="storage-row"><span>' + esc(CC_LABEL[k]) + '（dc-cat-' + k + ' · dc-prob-' + k + '）</span><b class="' + (usable ? 'ca-ok' : 'ca-warn') + '">' +
        (cat ? '开' : '关') + ' · 占比 ' + prob + '%（聊天生效 ' + dcOvEff + '%×' + prob + '% ≈ ' + humanProb(dcOvEff * prob / 100, 'reply') + '） · ' + total + ' 张' + (off ? '（单卡关 ' + off + '）' : '') +
        (!cat && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idCat + '">启用</button>' : '') +
        (prob === 0 && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idProb + '">恢复占比</button>' : '') +
        (total > 0 && off >= total && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idOff + '">恢复单卡</button>' : '') +
        ' <span class="ca-jump ca-edit" data-jump="defaultCards">调整</span></b></div>' + funnel;
    });
    push('二、系统预设 · 聊天默认字卡', dcInner,
      '漏斗＝「锁 → 总开关 → 聊天场景 → 总档 → 分类开关 → 分类占比>0 → 有未关闭的内容」，任一 ✕ 该分类就抽不到。聊天生效概率＝dc-overall-chat 经总档缩放后的值（分类占比是命中后的相对权重，不再乘总档）。<br><b>注意</b>：分类占比高不等于「回复里就有这张卡」——预设抽中后还要过「自定义字卡占比 csp-cust」这一签才会覆盖自定义文本，实际覆盖率见上方「回复链路」节。<br><b>怎么调</b>：点每行「调整」进「聊天默认字卡」页改开关/占比，或点「修复」恢复默认。');

    // ===== 三、词典 =====
    var dictInner = '';
    var dictAnyUse = false, dictAnyProb = false;
    ['chat', 'mail', 'feed'].forEach(function (k, i) {
      var nm = ['聊天', '写信', '朋友圈'][i];
      var on = boolOf(store('dict-use-' + k), true); if (on) dictAnyUse = true;
      var id = 'inl-dict-use-' + k;
      if (!on && !lock) fixEnable(id, 'dict-use-' + k);
      dictInner += rowHtml(nm + '使用（dict-use-' + k + '）', on ? '开启' : '关闭', on ? 'ok' : 'warn', { fix: (!on && !lock) ? id : '', edit: 'dictCards' });
    });
    dictInner += rowHtml('一键全关（dict-use-closeall）', boolOf(store('dict-use-closeall'), false) ? '已全关' : '未使用', boolOf(store('dict-use-closeall'), false) ? 'warn' : 'mute');
    ['chat', 'mail', 'feed'].forEach(function (k, i) {
      var nm = ['聊天', '写信', '朋友圈'][i];
      var def = k === 'chat' ? 75 : 30;
      var v = num(store('dict-overall-' + k), def); if (v > 0) dictAnyProb = true;
      var id = 'inl-dict-ov-' + k;
      if (v === 0 && !lock) fixProb(id, 'dict-overall-' + k, def);
      dictInner += rowHtml(nm + '概率（dict-overall-' + k + '）', v + '% · ' + humanProb(v, 'reply'), v === 0 ? 'warn' : 'ok', { fix: (v === 0 && !lock) ? id : '', edit: 'dictCards' });
    });
    dictInner += rowHtml('词典内置词条', presetGroups('dict').length + ' 组 · ' + presetCount('dict') + ' 条' + (offCount('dict') ? '（单卡关 ' + offCount('dict') + '）' : ''), 'mute');
    var dq = 0, dw = 0;
    try { dq = (JSON.parse(glob('dict-custom-quotes') || '[]') || []).length; } catch (e) {}
    try { dw = (JSON.parse(glob('dict-custom-words') || '[]') || []).length; } catch (e) {}
    dictInner += rowHtml('自建词条（全局）', '语录 ' + dq + ' 条 · 词 ' + dw + ' 条', 'mute');
    var dictUsable = !lock && dictAnyUse && dictAnyProb;
    dictInner += rowHtml('实际可用', dictUsable ? '可用' : (lock ? '被二级锁整体停用' : '不可用'), dictUsable ? 'ok' : 'warn');
    dictInner += funnelHtml([{ t: '锁', ok: !lock }, { t: '场景', ok: dictAnyUse }, { t: '概率', ok: dictAnyProb }]);
    push('三、系统预设 · 词典（拼字抽句/切词）', dictInner,
      '词典属系统内置字卡，二级锁锁定时整池停用（下方开关全开也无效）；自建词条为全局键，不随桌面隔离。聊天词典内容走「词典拼字」，写信/朋友圈开启后按概率混入文案。<br><b>怎么调</b>：点每行「调整」进「默认字卡·词典」页。');

    // ===== 四、其他互动功能字卡 =====
    var fInner = '';
    var idDcfEn = 'inl-dcf-en';
    if (!dcfEn && !lock) fixEnable(idDcfEn, 'dcf-enabled');
    fInner += rowHtml('总开关（dcf-enabled）', dcfEn ? '开启' : '关闭（跨桌面查岗除外）', dcfEn ? 'ok' : 'warn', { fix: (!dcfEn && !lock) ? idDcfEn : '', edit: 'funCards' });
    var idDcp = 'inl-dcp';
    if (all === 0 && !lock) fixProb(idDcp, 'reply-dcp-all', 100);
    fInner += rowHtml('聊天概率总档（reply-dcp-all）', all + '%', all === 0 ? 'warn' : 'ok', { fix: (all === 0 && !lock) ? idDcp : '', edit: 'replySettings' });
    DCF.forEach(function (d) {
      var key = d[0], name = d[1], def = d[2], hasPool = d[3];
      var raw = num(store('dcf-' + key), def);
      var eff = dcfEff(raw, key);
      var total = hasPool ? presetCount(key) : -1;
      var off = hasPool ? offCount(key) : 0;
      var gate = key === 'deskcheck' ? true : dcfEn;
      var usable = !lock && gate && eff > 0 && (!hasPool || (total - off > 0));
      var funnel = funnelHtml([
        { t: '锁', ok: !(lock && hasPool) }, { t: '总开关', ok: gate }, { t: '概率', ok: eff > 0 },
        { t: '内容', ok: !hasPool || (total - off > 0) }
      ]);
      var id = 'inl-dcf-' + key, idOff = 'inl-dcf-off-' + key;
      if (raw === 0 && !lock) fixProb(id, 'dcf-' + key, def, function () { try { window.dcfRefreshUI(key); } catch (e) {} });
      if (hasPool && total > 0 && off >= total && !lock) fixCardOffs(idOff, key);
      var cnt = hasPool ? (total + ' 张' + (off ? '（单卡关 ' + off + '）' : '')) : '—（发到聊天型，无独立字卡池）';
      fInner += '<div class="storage-row"><span>' + esc(name) + '（dcf-' + key + '）</span><b class="' + (usable ? 'ca-ok' : 'ca-warn') + '">存盘 ' + raw + '% · 生效 ' + eff + '%（' + humanProb(eff, 'trig') + '） · ' + cnt +
        (raw === 0 && !lock ? ' <button class="ca-fix" type="button" data-fix="' + id + '">恢复概率</button>' : '') +
        (hasPool && total > 0 && off >= total && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idOff + '">恢复单卡</button>' : '') +
        ' <span class="ca-jump ca-edit" data-jump="funCards">调整</span></b></div>' + funnel;
    });
    push('四、系统预设 · 其他互动功能字卡（19 类）', fInner,
      '生效概率 = 分类存盘值 × 聊天概率总档 ÷ 100；总开关关闭时除「跨桌面查岗」外全部归 0。二级锁锁定时系统预设内容不可用，但你自建的同类功能字卡仍可用（本页只统计系统预设张数）。<br><b>怎么调</b>：点每行「调整」进「其他互动功能字卡」页（聊天概率总档在「回复设置 → 聊天」里调）。');

    // ===== 五、其他字卡池（#499 豁免） =====
    var oInner = '';
    var MC = window.MOOD_FOLLOWUP_DATA || {};
    var idMc = 'inl-mc-en';
    if (!mcEn) fixEnable(idMc, 'mc-enabled');
    oInner += rowHtml('聊天情绪/心意/意图（mc-enabled）', mcEn ? '开启' : '关闭', mcEn ? 'ok' : 'warn', { fix: !mcEn ? idMc : '', edit: 'moodCards' });
    ['mood', 'heart', 'intent'].forEach(function (k, i) {
      var nm = ['情绪', '心意', '交流意图'][i], def = [70, 40, 40][i], key = 'mc-prob-' + k;
      var v = num(store(key), def), id = 'inl-mc-' + k;
      if (v === 0) fixProb(id, key, def);
      oInner += rowHtml('　' + nm + '概率（' + key + '）', v + '% · ' + humanProb(v, 'reply'), v === 0 ? 'warn' : 'ok', { fix: v === 0 ? id : '', edit: 'moodCards' });
    });
    oInner += rowHtml('　情绪池张数', dataCount(MC.mood) + ' 张（不受二级锁影响）', 'mute');
    var rcEn = boolOf(store('rc-enabled'), true), rcProb = num(store('rcard-prob'), 30);
    var idRc = 'inl-rc';
    addFix(idRc, function () { if (!boolOf(store('rc-enabled'), true)) storeSet('rc-enabled', '1'); if (num(store('rcard-prob'), 30) === 0) storeSet('rcard-prob', 30); return true; });
    oInner += rowHtml('聊天回应字卡（rc-enabled / rcard-prob）', (rcEn ? '开启' : '关闭') + ' · 整条替换 ' + rcProb + '%（' + humanProb(rcProb, 'reply') + '） · 连接词追加 cf-prob ' + num(store('cf-prob'), 20) + '% · ' + dataCount(MC.followup) + ' 张', (rcEn && rcProb > 0) ? 'ok' : 'warn', { fix: (!rcEn || rcProb === 0) ? idRc : '', edit: 'replyCards' });
    var tmEn = boolOf(store('tm-enabled'), true), tmProb = num(store('tm-prob'), 15);
    var idTm = 'inl-tm';
    addFix(idTm, function () { if (!boolOf(store('tm-enabled'), true)) storeSet('tm-enabled', '1'); if (num(store('tm-prob'), 15) === 0) storeSet('tm-prob', 15); return true; });
    oInner += rowHtml('TA 的心情（tm-enabled / tm-prob）', (tmEn ? '开启' : '关闭') + ' · ' + tmProb + '%（' + humanProb(tmProb, 'reply') + '） · ' + dataCount((window.TA_MOOD_DATA || {}).groups) + ' 张', (tmEn && tmProb > 0) ? 'ok' : 'warn', { fix: (!tmEn || tmProb === 0) ? idTm : '', edit: 'taMood' });
    [['quote-cards-default', '桌面今日情话', 'quoteCards'], ['loc-lib-default', 'TA在身边位置卡', 'locCards'], ['checkin-cards-default', '寻踪日常字卡', 'checkinCards']].forEach(function (t) {
      var on = boolOf(store(t[0]), true), id = 'inl-' + t[0];
      if (!on) fixEnable(id, t[0]);
      oInner += rowHtml(t[1] + '（' + t[0] + '）', on ? '开启' : '关闭', on ? 'ok' : 'warn', { fix: !on ? id : '', jump: t[2] });
    });
    var ck = null; try { ck = JSON.parse(store('ta-checkin') || 'null'); } catch (e) {}
    var ckUseDef = ck && ck.settings ? ck.settings.useDefault !== false : true;
    oInner += rowHtml('查岗问题库（ta-checkin.settings.useDefault）', (ckUseDef ? '使用系统预设' : '仅用自建') + ' · 触发 ckq-en ' + (boolOf(store('ckq-en'), true) ? '开' : '关') + ' / ckq-prob ' + num(store('ckq-prob'), 2) + '%', 'mute', { jump: 'taCheckin' });
    var TA_EDIT = { 'ta-ask': 'taAsk', 'ta-choose': 'taChoose', 'ta-curious': 'taCurious', 'ta-roast': 'taRoast' };
    ['ta-ask:询问', 'ta-choose:小问题', 'ta-curious:好奇', 'ta-roast:吐槽'].forEach(function (pair) {
      var key = pair.split(':')[0], label = pair.split(':')[1];
      var blob = null; try { blob = JSON.parse(store(key) || 'null'); } catch (e) {}
      var s = blob && blob.settings ? blob.settings : {};
      var en = s.enabled !== false, pr = s.prob === undefined ? 5 : s.prob;
      oInner += rowHtml('TA 主动·' + label + '（' + key + '.settings）', (en ? '开启' : '关闭') + ' · 概率 ' + pr + '%', (en && pr > 0) ? 'ok' : 'warn', { edit: TA_EDIT[key] });
    });
    push('五、系统预设 · 其他字卡池（不受二级锁影响）', oInner,
      '这一组按 #499 明确豁免：未解锁二级密码也照常使用。各池开关存于各自数据块/键。<br><b>怎么调</b>：点每行「调整」进对应管理页；个别概率/开关可就地「修复」回默认。');

    // ===== 六/七、自定义字卡 =====
    function customCard(scope, offRec) {
      var inner = '', any = false;
      CC_ORDER.forEach(function (t) {
        var grps = scopePool(scope, t);
        var gc = grps.length, cc = 0;
        grps.forEach(function (g) { cc += (g && Array.isArray(g[1]) ? g[1].length : 0); });
        var offs = (offRec && Array.isArray(offRec[t])) ? offRec[t] : [];
        if (!gc && !cc && !offs.length) return;
        any = true;
        var offTxt = offs.length ? ' · <span class="ca-warn">已停用 ' + offs.length + ' 组：' + esc(offs.join('、')) + '</span>' : '';
        var offBtn = offs.length ? ' <button class="ca-fix" type="button" data-fix="inl-goff-' + scope + '-' + t + '">全部启用</button>' : '';
        inner += '<div class="storage-row"><span>' + esc(CC_LABEL[t]) + '</span><b>' + gc + ' 组 / ' + cc + ' 张' + offTxt + offBtn + '</b></div>';
        if (offs.length) fixGroupOff('inl-goff-' + scope + '-' + t, scope, t);
      });
      if (!any) inner = '<div class="storage-hint">该库为空：没有任何自定义字卡。</div>';
      return { inner: inner, any: any };
    }
    var ownC = customCard('own', ownOff);
    var pubC = customCard('public', pubOff);
    push('六、自定义字卡 · 公用库（全桌面共享）', pubC.inner,
      '这里统计「可用」状态：被停用的分组不计入组/张数，右侧列出停用名单并可就地「全部启用」。点 <span class="ca-jump" data-jump="customPublic">公用字卡库</span> 去管理。');
    push('七、自定义字卡 · 当前桌面专属库（' + esc(deskName(activeCid())) + '）', ownC.inner,
      '专属库仅当前桌面的联系人生效；分组停用只影响「使用」，字卡本身仍保留在字卡库中。点 <span class="ca-jump" data-jump="customOwn">专属字卡库</span> 去管理。');

    // ===== 八、各桌面概览（按需展开） =====
    var deskInner = '';
    if (!contactsArr.length) deskInner = '<div class="storage-hint">未读取到联系人列表。</div>';
    contactsArr.forEach(function (c, i) {
      var cid = c && c.id ? c.id : 'default';
      var name = (c && c.name) || cid;
      var isCur = cid === activeCid();
      var raw = rawFor(cid, 'cc-groups');
      var kb = raw ? Math.round(String(raw).length * 2 / 1024) : 0;
      var ofRec = {}; try { ofRec = JSON.parse(rawFor(cid, 'cc-groups-off') || '{}') || {}; } catch (e) { ofRec = {}; }
      var offN = offCountIn(ofRec);
      deskInner += '<div class="storage-row"><span>' + esc(name) + (isCur ? '（当前桌面）' : '') + '<span class="ca-sub">' + (raw ? '库约 ' + kb + ' KB' : '空库') + ' · 停用分组 ' + offN + ' 个</span></span>' +
        '<b>' + (raw ? '<button class="ca-jump" type="button" data-desk="' + i + '" data-cid="' + esc(cid) + '">查看明细</button>' : '—') + '</b></div>' +
        '<div class="ca-detail" id="ca-desk-' + i + '" hidden></div>';
    });
    push('八、各桌面专属字卡概览', deskInner,
      '为避免超大库（单键可达 150MB+）卡死页面，默认只报整库体积与停用分组数；点「查看明细」按需解析单个桌面（超过约 12MB 会拒绝解析以防卡顿）。');

    // ===== 九、卡数据健康 =====
    var hInner = '';
    hInner += rowHtml('媒体池丢失图片卡', health.missing + ' 张' + (health.tokens ? '（令牌 ' + health.tokens + ' 张）' : ''), health.missing ? 'bad' : 'ok');
    hInner += rowHtml('语音卡数据异常', health.badVoice + ' 条', health.badVoice ? 'warn' : 'ok');
    hInner += rowHtml('超大图片卡（>512KB）', health.bigMedia + ' 张', health.bigMedia ? 'warn' : 'ok');
    push('九、卡数据健康（图片/语音）', hInner,
      '丢失图片卡多因导入的备份未含图片，可从有完整图片的源头设备重新导出「完整备份」再导入，或到「查看存储 → 媒体池重建」尝试自愈；超大图片卡会让字卡库体积膨胀、iOS/安卓卡顿，可到「查看存储 → 字卡库瘦身」清理。点 <span class="ca-jump" data-jump="storage">查看存储</span>。');

    lastText = lines.join('\n');
    return { issueCount: issueCount };
  }

  // ---------- 渲染（分帧填充，避免大库首开空白） ----------
  function render() {
    var r = build();
    updateBadge(r.issueCount);
    var secs = sections.slice();
    bodyEl.innerHTML = '';
    var i = 0;
    (function step() {
      var end = Math.min(i + 2, secs.length);
      for (; i < end; i++) {
        var wrap = document.createElement('div');
        wrap.innerHTML = secs[i];
        while (wrap.firstChild) bodyEl.appendChild(wrap.firstChild);
      }
      if (i < secs.length) setTimeout(step, 0);
      else applyFilter();
    })();
  }
  // 「只看有问题」：隐藏 ✓/灰字的行与无问题的卡片（问题信号＝本体带 ca-warn/ca-bad/✕漏斗/修复按钮）
  function applyFilter() {
    try {
      bodyEl.querySelectorAll('.cal-card').forEach(function (card) {
        var hasIssue = !!card.querySelector('.ca-warn, .ca-bad, .ca-flow-no, [data-fix]');
        card.style.display = (onlyProblems && !hasIssue) ? 'none' : '';
        card.querySelectorAll('.storage-row').forEach(function (r) {
          var dirty = !!r.querySelector('.ca-warn, .ca-bad, [data-fix]');
          var b = r.querySelector('b');
          var clean = b && (b.classList.contains('ca-ok') || b.classList.contains('ca-mute')) && !dirty;
          r.style.display = (onlyProblems && clean) ? 'none' : '';
        });
        card.querySelectorAll('.ca-funnel').forEach(function (f) {
          f.style.display = (onlyProblems && !f.querySelector('.ca-flow-no')) ? 'none' : '';
        });
      });
    } catch (e) {}
  }

  // 角标（不打开也显示问题数）：只读键的轻量计数，不触发池解析
  function quickIssueCount() {
    var n = 0;
    try {
      if (locked()) n++;
      if (!boolOf(store('dc-enabled'), true)) n++;
      if (!boolOf(store('dcf-enabled'), true)) n++;
      if (num(store('reply-dcp-all'), 100) === 0) n++;
      if (!boolOf(store('mc-enabled'), true)) n++;
      ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
        if (!boolOf(store('dc-cat-' + k), true)) n++;
        if (num(store('dc-prob-' + k), 25) === 0) n++;
      });
      DCF.forEach(function (d) { if (d[0] !== 'deskcheck' && num(store('dcf-' + d[0]), d[2]) === 0) n++; });
      var oo = offRecord('own'), po = offRecord('public');
      if (offCountIn(oo)) n++;
      if (offCountIn(po)) n++;
      // #583：回复设置 → 聊天 侧的闸门（都只读单个键，不触发池解析）
      if (num(store('rn-prob'), 20) > 60) n++;   // >=100 是 bad、>60 是 warn，两者都计（同 build 的问题清单）
      if (!boolOf(store('qs-en'), true)) n++;
      else if (num(store('qs-prob'), 25) === 0) n++;
      if (!boolOf(store('mjf-en'), true)) n++;
      else if (num(store('mjf-prob'), 20) === 0) n++;
      if (!boolOf(store('py-en'), true) || num(store('py-prob'), 50) === 0) n++;
      if (num(store('csp-cust'), 50) === 0) n++;
      var _att = [['touch-prob', 5], ['sticker-prob', 10], ['emoji-prob', 5], ['image-prob', 5], ['voice-prob', 10], ['kaomoji-prob', 5], ['quote-prob', 30]];
      var _attAllOff = !_att.some(function (a) { return num(store(a[0]), a[1]) > 0; });
      if (_attAllOff) n++;
      else if (num(store('sticker-prob'), 10) === 0 && num(store('image-prob'), 5) === 0) n++;  // 媒体字卡不出镜（同 build 的 mediaOff）
    } catch (e) {}
    return Math.min(n, 99);
  }
  function updateBadge(n) {
    if (!row) return;
    try {
      var txt = row.querySelector('.txt');
      if (!txt) return;
      var b = row.querySelector('.ca-badge');
      if (!b) { b = document.createElement('span'); b.className = 'ca-badge'; txt.appendChild(b); }
      b.textContent = String(n);
      b.classList.toggle('zero', !(n > 0));
      row.setAttribute('data-ca-issues', String(n));
    } catch (e) {}
  }

  // ---------- 跳转 ----------
  function showSettingRow(sel) {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var sp = document.getElementById('page-setting'); if (sp) sp.hidden = false;
      var el = document.querySelector(sel); if (!el) return false;
      var sec = el.closest ? el.closest('.them-sec') : null;
      if (sec && sec.dataset && sec.dataset.sec) {
        var tab = document.querySelector('#set-tabs .them-tab[data-tab="' + sec.dataset.sec + '"]');
        if (tab) tab.click();
      }
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }
  // #583：直达 回复设置 页的指定分类 tab（自检页的「调整」按钮用）。回复设置是独立页
  //   （page-reply-settings）+ 页内 fav-tab 切换（reply-settings.js 的 rpTab），入口行
  //   #row-general 只切到默认的「聊天」tab，无法从设置页外部指定分类，故这里直接
  //   复刻同一套「隐藏全部页 → 显目标页 → 点 tab」的链路。
  function openReplyPage(tab) {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var rp = document.getElementById('page-reply-settings');
      if (!rp) return false;
      rp.hidden = false;
      var t = rp.querySelector('.fav-tab[data-rp="' + tab + '"]');
      if (t && t.click) t.click();
      var sc = rp.querySelector('.gs-scroll');
      if (sc) sc.scrollTop = 0;
      return true;
    } catch (e) { return false; }
  }
  function jump(key) {
    if (!key) return false;
    if (key.indexOf('@reply:') === 0) return openReplyPage(key.slice(7));
    if (key.charAt(0) === '#') return showSettingRow(key);
    var chain = JUMPS[key];
    if (!chain) return false;
    if (typeof chain === 'string') return showSettingRow(chain);
    var ok = false;
    try { document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; }); } catch (e) {}
    chain.forEach(function (sel) { var el = document.querySelector(sel); if (el && el.click) { el.click(); ok = true; } });
    if (!ok) toast('入口暂不可达：请到「字卡库」里找对应页');
    return ok;
  }

  // ---------- 各桌面明细（按需解析） ----------
  var MAX_DETAIL_CHARS = 6000000;
  function expandDesk(btn) {
    var i = btn.getAttribute('data-desk');
    var cid = btn.getAttribute('data-cid');
    var box = document.getElementById('ca-desk-' + i);
    if (!box) return;
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; btn.textContent = '查看明细'; return; }
    var raw = rawFor(cid, 'cc-groups');
    var chars = raw ? String(raw).length : 0;
    if (chars > MAX_DETAIL_CHARS) { toast('该桌面字卡库约 ' + Math.round(chars * 2 / 1048576) + ' MB，明细解析可能造成卡顿，已跳过（可在字卡库瘦身里处理）'); return; }
    var g = parseGroups(raw);
    var ofRec = {}; try { ofRec = JSON.parse(rawFor(cid, 'cc-groups-off') || '{}') || {}; } catch (e) {}
    var html = '';
    var total = 0, groupsTotal = 0;
    CC_ORDER.forEach(function (t) {
      var arr = (g[t] || []);
      if (!arr.length) return;
      var cc = 0; arr.forEach(function (x) { cc += (x && Array.isArray(x[1]) ? x[1].length : 0); });
      var offs = (ofRec[t] && ofRec[t].length) ? ofRec[t] : [];
      total += cc; groupsTotal += arr.length;
      html += '<div class="storage-row"><span>' + esc(CC_LABEL[t]) + '</span><b>' + arr.length + ' 组 / ' + cc + ' 张' + (offs.length ? ' · <span class="ca-warn">停用 ' + offs.length + ' 组</span>' : '') + '</b></div>';
    });
    html = '<div class="ca-sub">合计 ' + groupsTotal + ' 组 / ' + total + ' 张</div>' + html;
    box.innerHTML = html || '<div class="ca-sub">该桌面没有自定义字卡。</div>';
    box.hidden = false;
    btn.textContent = '收起';
  }

  // ---------- 复制/轻提示 ----------
  function toast(msg) {
    try {
      var t = document.getElementById('cc-toast');
      if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
      t.textContent = msg;
      t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
      clearTimeout(t._timer);
      t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2000);
    } catch (e) {}
  }
  function copyReport() {
    var txt = lastText || '';
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        toast(ok ? '自检报告已复制' : '复制失败，请长按页面手动选择');
      } catch (e) { toast('复制失败'); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(function () { toast('自检报告已复制'); }, fallback); }
      else fallback();
    } catch (e) { fallback(); }
  }

  // ---------- 事件 ----------
  function openAudit() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      page.hidden = false;
      render();
      var sc = page.querySelector('.cal-scroll');
      if (sc) sc.scrollTop = 0;
    } catch (e) {}
  }
  function closeAudit() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var s = document.getElementById('page-setting');
      if (s) s.hidden = false;
    } catch (e) {}
  }
  if (row) row.addEventListener('click', openAudit);
  if (back) back.addEventListener('click', closeAudit);
  if (refreshBtn) refreshBtn.addEventListener('click', function () { render(); toast('已重新自检'); });
  if (copyBtn) copyBtn.addEventListener('click', copyReport);
  if (filterBtn) filterBtn.addEventListener('click', function () {
    onlyProblems = !onlyProblems;
    filterBtn.textContent = onlyProblems ? '显示全部' : '只看有问题';
    applyFilter();
  });

  // 委托：修复 / 跳转 / 桌面明细
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var fixBtn = t.closest('[data-fix]');
    if (fixBtn) {
      e.preventDefault();
      var id = fixBtn.getAttribute('data-fix');
      var fn = fixMap[id];
      if (!fn) return;
      var res = false;
      try { res = fn(); } catch (err) { res = 'fail'; }
      render();
      if (res === false) toast('没有需要修复的项（或已是最新）');
      else if (res === 'fail') toast('修复未生效：本机存储可能已满或被拦截');
      else toast('已修复，正在重新自检');
      return;
    }
    var jumpEl = t.closest('[data-jump]');
    if (jumpEl) { e.preventDefault(); jump(jumpEl.getAttribute('data-jump')); return; }
    var deskBtn = t.closest('[data-desk]');
    if (deskBtn) { e.preventDefault(); expandDesk(deskBtn); return; }
    var loadBtn = t.closest('[data-load]');
    if (loadBtn) { e.preventDefault(); loadFullCards(); return; }
  });

  // 大库 IDB 回填挂起时：取回完整字卡后重新自检
  function loadFullCards() {
    if (!window.hydrateLibScopes) { toast('取回接口不可用，请稍后重试'); return; }
    toast('正在取回完整字卡…');
    // FIX 2026-09-16 #575：取回期间页内出加载占位（iOS 挂后台杀 IDB 连接时这段要等 6~14s，
    //   原先只有一句转瞬 toast，页面像卡住）；取回落定后下面的 render() 会覆写它。
    try {
      if (bodyEl) bodyEl.innerHTML = '<div class="mochi-load-row"><span class="mochi-spin"></span>正在取回完整字卡…</div>';
      if (typeof applyFilter === 'function') applyFilter();
    } catch (e) {}
    try {
      window.hydrateLibScopes(['public', 'own'], function () { render(); toast('已取回完整字卡，重新自检完成'); });
    } catch (e) { toast('取回失败，请稍后重试'); }
  }

  // 锁状态 / 切桌面 / 数据回填完成后：页开着就刷新；角标随时更新
  function refreshAll() { try { updateBadge(quickIssueCount()); } catch (e) {} try { if (!page.hidden) render(); } catch (e) {} }
  ['mochi-cardlock-open', 'mochi-cardlock-locked', 'contact-switched', 'mochi-restore-done'].forEach(function (ev) { document.addEventListener(ev, refreshAll); });
  setTimeout(refreshAll, 1200);
})();

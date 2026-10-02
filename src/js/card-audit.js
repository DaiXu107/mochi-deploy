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
  var buildErr = '';   // 本次 build 的内部错误（非空＝页面顶部出错误卡、导出报告带原因）
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
  // FIX 2026-09-29 #1451 回复设置读数改真源：本文件原先拿 store('qs-en') 这类【裸键】读回复设置
  //   的键——可回复设置的存键一律是 'reply-' + k（reply-settings.js getCfg 读 ls.get('reply-'+k)），
  //   裸读永远取不到存盘值、一律落回本文件写死的默认数：用户把「词典拼字」关掉、体检照样写「开」，
  //   把 qs-prob 调成 0、体检还说 25%。同一族的「一键修复」也把值写进裸键＝点了修复实际什么
  //   都没改（用户实报「我设的 2~5 可它一直发 5 张」在体检里根本查不出来，病根就在这）。
  //   现在回复侧读数一律走 window.replyCfg()（＝设置页与抽卡侧同一份 getCfg 生效值；#1451 起
  //   含折好的 qs-min/qs-max 一对），写入口走 window.saveReplyCfg（'reply-' 前缀、成对收口、
  //   主动发送重排定时器都在它里面）。replyCfg 取不到时退回读 'reply-' + k 的存盘值，再兜底默认数。
  function replyRaw(k) {
    var v = null;
    try { var rc0 = window.replyCfg ? window.replyCfg() : null; if (rc0) v = rc0[k]; } catch (e) { v = null; }
    if (v === undefined || v === null || v === '') { try { v = store('reply-' + k); } catch (e) { v = null; } }
    return v;
  }
  function replyNum(k, d) { return num(replyRaw(k), d); }
  function replyBool(k, d) { var v = replyRaw(k); if (v === null || v === undefined || v === '') return d; return Number(v) === 1; }
  function replySet(k, v) {
    try { if (window.saveReplyCfg) { window.saveReplyCfg(k, v); return true; } } catch (e) {}
    return storeSet('reply-' + k, v);
  }
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
  // FIX 2026-09-17 #677：关闭态存在【值】里，不是「键在不在」——default-cards.js
  //   setCardOff 写的是 off ? '1' : '0'，重新打开也不会删键（消费端 isDefaultCardOff
  //   同样只判 === '1'，多份验证脚本按「关=1/开=0」断言）。旧实现按键存在计数，于是：
  //   ① 只要用户曾经把某一类的每张卡都关过再打开，本页就会凭空报「已全部单卡关闭」；
  //   ② 更关键的是「恢复单卡」只把值改成 '0'、键仍在 ⇒ 计数分毫不变 ⇒ 告警行与按钮
  //      原样重画，用户看到的就是「按恢复没有反应」（用户 2026-09-17 报障，iPhone 等机型）。
  //   改判值后与消费端同口径：修复写 '0' ⇒ 立刻不再计入 ⇒ 告警与按钮一起消失。
  var offCache = null; // {cat:n}
  // 入参必须是【相对键】dc-off-<cat>:<内容>（即去掉 activePrefix() 后的形状）——store() 自己
  // 会补前缀，传成 '<cat>:<内容>' 会读到不存在的键、恒判「未关闭」（#677 首版就踩了：
  // offCount 恒 0 ⇒ 告警全不出现；verify B11a 当场抓到）。
  function offValue(rel) { return store(rel); }          // 内存缓存优先（LS 写失败时仍准）
  function isOffRel(rel) { return offValue(rel) === '1'; }
  var OFF_PREFIX = 'dc-off-';
  function buildOffIndex() {
    var idx = {};
    try {
      var pre = activePrefix() + ':';
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(pre) !== 0) continue;
        var rel = k.slice(pre.length);
        if (rel.indexOf(OFF_PREFIX) !== 0) continue;
        if (!isOffRel(rel)) continue;
        var rest = rel.slice(OFF_PREFIX.length);
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
      var pre = activePrefix() + ':' + OFF_PREFIX + cat + ':';
      var preLen = activePrefix().length + 1;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(pre) !== 0) continue;
        var rel = k.slice(preLen);                        // = dc-off-<cat>:<内容>
        if (isOffRel(rel)) out.push(rel);                 // 只收真·关闭（值 = '1'）的卡
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
  // ===== #932：系统预设字卡「整组停用」（#926 的 dc-groups-off = { 分类: [分组名,…] }）纳入自检 =====
  //   此前本页只按 dc-off-* 逐张统计：用户把整组停用时，分类明明已经抽不到卡，自检却报
  //   「未发现明显问题」、一键修复也不接管——等于自检比功能本身少一道闸。
  function goffRecord() {
    var raw; try { raw = store('dc-groups-off'); } catch (e) { return {}; }
    try { var o = raw ? JSON.parse(raw) : null; return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch (e) { return {}; }
  }
  var goffRec = {};         // 每次 build 复位（读的是当前桌面键）
  var goffCardsCache = {};  // cat -> 停用组内张数（同一条案出现在多个停用组只计一次）
  var effOffCache = {};     // cat -> 实际取不到的张数
  function goffNames(cat) { var a = goffRec[cat]; return Array.isArray(a) ? a : []; }
  function goffNamesShown(cat, max) {
    var a = goffNames(cat); max = max || 6;
    return a.slice(0, max).join('、') + (a.length > max ? '…等' : '');
  }
  function goffSuffix(cat) {
    var n = goffNames(cat).length;
    return n ? '（整组停用 ' + n + ' 组·' + goffCards(cat) + ' 张）' : '';
  }
  function goffCards(cat) {
    if (goffCardsCache[cat] !== undefined) return goffCardsCache[cat];
    var kill = {}; goffNames(cat).forEach(function (g) { kill[g] = 1; });
    var s = new Set();
    presetGroups(cat).forEach(function (grp) { if (kill[grp[0]] && Array.isArray(grp[1])) grp[1].forEach(function (c) { s.add(c); }); });
    goffCardsCache[cat] = s.size;
    return goffCardsCache[cat];
  }
  // 「该分类实际取不到」的张数：直接问消费端总闸 isDefaultCardOff（单卡闸 OR 分组闸，以后再加闸门
  //   自检不会又一次落后于功能）。没有分组停用时沿用旧的 dc-off-* 计数——不为零成本的路径去扫全池。
  function effOff(cat) {
    if (effOffCache[cat] !== undefined) return effOffCache[cat];
    var total = presetCount(cat);
    if (!total || !goffNames(cat).length) { effOffCache[cat] = offCount(cat); return effOffCache[cat]; }
    var n = offCount(cat);
    try {
      var api = window.defaultCardApiFor && window.activeStore ? window.defaultCardApiFor(window.activeStore()) : null;
      if (api && api.isOff) {
        n = 0;
        presetGroups(cat).forEach(function (grp) { (grp[1] || []).forEach(function (c) { if (api.isOff(cat, c)) n++; }); });
      } else {
        n = Math.max(n, goffCards(cat));
      }
    } catch (e) { n = Math.max(offCount(cat), goffCards(cat)); }
    effOffCache[cat] = n;
    return n;
  }
  function goffLabel(cat) {
    if (cat === 'dict') return '系统预设「词典」';
    for (var i = 0; i < DCF.length; i++) if (DCF[i][0] === cat) return '功能字卡「' + DCF[i][1] + '」';
    if (cat === 'main' || cat === 'kaomoji' || cat === 'emoji' || cat === 'touch') return '默认聊天字卡「' + (CC_LABEL[cat] || cat) + '」';
    return '系统预设「' + (CC_LABEL[cat] || cat) + '」';
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
  function addFix(id, fn, describe) { fixMap[id] = fn; if (describe) fixDesc[id] = describe; }
  function addIssue(lv, text) {
    if (lv === 'warn' || lv === 'bad') issueCount++;
    issues.push({ lv: lv, text: text });
  }

  // ---------- 修复动作 ----------
  function fixProb(id, key, def, after) {
    addFix(id, function () {
      recordUndo('own', key);
      var ok = storeSet(key, def);
      if (ok && after) { try { after(); } catch (e) {} }
      return ok ? true : 'fail';
    }, function () { return [key + '：' + num(store(key), def) + '% → ' + def + '%']; });
  }
  function fixEnable(id, key, after) {
    addFix(id, function () {
      recordUndo('own', key);
      var ok = storeSet(key, '1');
      if (ok && after) { try { after(); } catch (e) {} }
      return ok ? true : 'fail';
    }, function () { return [key + '：关闭 → 开启']; });
  }
  // FIX 2026-09-29 #1451 回复设置侧的同款修复：写入口换 replySet（'reply-' 前缀 + 成对收口），
  //   撤销按【带前缀的全键】记账——否则撤销那一笔读/写的又是裸键＝撤了等于没撤（同 #1451 读数族）。
  function fixReplyProb(id, key, def, after) {
    addFix(id, function () {
      recordUndo('own', 'reply-' + key);
      var ok = replySet(key, def);
      if (ok && after) { try { after(); } catch (e) {} }
      return ok ? true : 'fail';
    }, function () { return ['reply-' + key + '：' + replyNum(key, def) + '% → ' + def + '%']; });
  }
  function fixReplyEnable(id, key, after) {
    addFix(id, function () {
      recordUndo('own', 'reply-' + key);
      var ok = replySet(key, '1');
      if (ok && after) { try { after(); } catch (e) {} }
      return ok ? true : 'fail';
    }, function () { return ['reply-' + key + '：关闭 → 开启']; });
  }
  function fixGroupOff(id, scope, type) {
    addFix(id, function () {
      var key = scope === 'public' ? 'cc-groups-public-off' : 'cc-groups-off';
      var o = offRecord(scope);
      if (!o[type]) return false;
      recordUndo(scope, key);
      delete o[type];
      var json = JSON.stringify(o);
      var ok = scope === 'public' ? globSet(key, json) : storeSet(key, json);
      try { if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite(); } catch (e) {}
      return ok ? true : 'fail';
    }, function () {
      var o = offRecord(scope); var n = (o[type] || []).length;
      return ['启用' + (scope === 'public' ? '公用' : '本桌面') + '「' + (CC_LABEL[type] || type) + '」被停用的 ' + n + ' 个分组'];
    });
  }
  function fixPresetGroups(id, cat) {
    addFix(id, function () {
      var o = goffRecord();
      if (!Array.isArray(o[cat]) || !o[cat].length) return false;
      recordUndo('own', 'dc-groups-off');
      delete o[cat];
      return storeSet('dc-groups-off', JSON.stringify(o)) ? true : 'fail';   // 全清空时写 '{}'，与 default-cards.js 的写入口径一致
    }, function () {
      return ['启用' + goffLabel(cat) + '被整组停用的 ' + goffNames(cat).length + ' 个分组（' + goffCards(cat) + ' 张字卡恢复使用，组内单卡开关不动）'];
    });
  }
  function fixCardOffs(id, cat) {
    addFix(id, function () {
      var ks = offKeysOf(cat);
      if (!ks.length) return false;
      var ok = false;
      ks.forEach(function (short) { recordUndo('own', short); if (storeSet(short, '0')) ok = true; });
      return ok ? true : 'fail';
    }, function () { return ['恢复「' + (CC_LABEL[cat] || cat) + '」已单卡关闭的 ' + offKeysOf(cat).length + ' 张字卡']; });
  }
  function registerBulk(id) { bulkFixes.push(id); }

  // ---------- 报告构建 ----------
  function build() {
    offCache = buildOffIndex();
    presetCntCache = {}; poolCache = {};
    goffRec = goffRecord(); goffCardsCache = {}; effOffCache = {};
    sections = []; lines = []; fixMap = {}; fixDesc = {}; bulkFixes = []; issueCount = 0; issues = [];

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
    var cspCust = clampPct(replyNum('csp-cust', 50));
    var dcUseChat = boolOf(store('dc-use-chat'), true);        // 裸键：default-cards.js 场景开关，非 reply 命名空间
    var dcOvRaw = clampPct(num(store('dc-overall-chat'), 30)); // 裸键：同上（chatcard.js 也按裸键读）
    var dcOvEff = Math.round(dcOvRaw * all / 100);
    // #1451：以下回复侧读数一律走 replyNum/replyBool（reply- 前缀真源），别改回裸读
    var qsEn = replyBool('qs-en', true);
    var qsProbRaw = clampPct(replyNum('qs-prob', 25));
    var qsProbEff = Math.round(qsProbRaw * all / 100);        // quote-spell.js 套总档
    var qsCc = replyBool('qs-cc', true);
    // #1451 拼字张数一对：抽卡侧取的就是这两个数（缺键＝由 getCfg 折成跟随「最少/最多条数」，
    //   单设时是用户自己那一对）。「设的 2~5 可它一直发 5 张」这类报障先看这里的 单设/跟随 标记。
    var qsMinN = Math.max(1, Math.min(10, replyNum('qs-min', 2)));
    var qsMaxN = Math.max(qsMinN, Math.min(10, replyNum('qs-max', 5)));
    var qsPairOwn = replyBool('qs-pair-own', false);
    // 注意：定义 window.dictUse / dictOverall 的那个 IIFE 开头是 `if (!dictView) return;`
    //   ——词典页锚点缺失时这两个 API 整个不存在。所以先按存储键取默认值、API 在时再覆盖，
    //   别把「API 不在」写成硬编码 true（那会把用户关掉的场景误报成开）。
    var dictUseChat = boolOf(store('dict-use-chat'), true);
    try { if (window.dictUse) dictUseChat = window.dictUse('chat') !== false; } catch (e) {}
    var dictOvChat = clampPct(num(store('dict-overall-chat'), 75));
    try { if (window.dictOverall) dictOvChat = clampPct(num(window.dictOverall('chat'), 75)); } catch (e) {}
    var dictPoolN = Math.max(0, presetCount('dict') - effOff('dict'));
    var mjfEn = replyBool('mjf-en', true);
    var mjfProb = clampPct(replyNum('mjf-prob', 20));         // 不过总档
    var MJF_SRC = [['mjf-src-cc', 'mjf-w-cc', '自定义字卡', 50], ['mjf-src-def', 'mjf-w-def', '默认聊天字卡', 25], ['mjf-src-dict', 'mjf-w-dict', '词典', 25]];
    var mjfSrcOn = MJF_SRC.filter(function (s) { return replyBool(s[0], true) && replyNum(s[1], s[3]) > 0; });
    var rcProbRaw = clampPct(num(store('rcard-prob'), 30));   // 裸键：mood-reply-cards.js 的回应字卡概率
    var cfProbRaw = clampPct(replyNum('cf-prob', 20));
    var rcProbEff = Math.round(rcProbRaw * all / 100);
    var cfProbEff = Math.round(cfProbRaw * all / 100);
    var pyEn = replyBool('py-en', true);
    var pyProb = clampPct(replyNum('py-prob', 50));
    var rcSw = boolOf(store('rc-enabled'), true);        // 裸键：聊天回应字卡总开关（与「撤回后补发」的 reply-rc-en 不是同一个键）
    var rnProb = clampPct(replyNum('rn-prob', 20));
    var asEn = replyBool('as-en', true);
    var dndEn = replyBool('dnd-en', false);
    // 附加件（不套总档，chat.js 直接读存盘值）
    var ATTACH = [['touch-prob', '拍一拍', 5], ['sticker-prob', '表情包', 10], ['emoji-prob', 'emoji', 5], ['image-prob', '图片', 5], ['voice-prob', '语音', 10], ['kaomoji-prob', '颜文字', 5], ['quote-prob', '引用', 30]];
    var attachOn = ATTACH.filter(function (a) { return replyNum(a[0], a[2]) > 0; });
    // 表情包/图片两条附加概率同时为 0 ⇒ 字卡库里的 sticker/image 卡永不进聊天（见下方附加件行）。
    // 必须在这里（问题清单之前）算好——放到渲染段会因 var 提升恒为 undefined，那条问题永不触发。
    var mediaOff = clampPct(replyNum('sticker-prob', 10)) === 0 && clampPct(replyNum('image-prob', 5)) === 0;

    // ===== 问题清单（先算，结论卡与角标都用） =====
    if (lock) addIssue('bad', '系统预设字卡被「二级密码锁」整体锁定（#319 防未成年人保护）——默认聊天字卡、词典（含词典拼字）等系统预设池当前都取不到，下方开关全开也无效。到开屏公告区「防未成年人·内置字卡锁定」卡点「输入密码解锁」即可恢复。');
    if (customTotal === 0 && lock) addIssue('bad', '你还没有任何自定义字卡，且系统预设字卡被锁定：联系人回复会非常单薄。建议先在「字卡库」里添加几张自定义字卡，或解锁系统预设。');
    if (!dcEn) addIssue('warn', '系统预设「聊天默认字卡」总开关关闭：聊天/信箱/朋友圈都不会混入系统预设聊天字卡。');
    if (!dcfEn) addIssue('warn', '「其他互动功能字卡」总开关关闭：摸鱼/吃饭/花园等功能触发时不再出字卡（不影响聊天默认字卡）。');
    if (all === 0) addIssue('warn', '系统预设字卡「聊天触发概率总档」为 0%：所有系统预设聊天概率归零。');
    if (ownUsable + pubUsable === 0 && !lock) addIssue('warn', '当前桌面没有任何「可用的自定义字卡」。');
    if (!pubGroups) addIssue('warn', '公用字卡库为空（所有桌面共享的库）。');
    ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
      var total = presetCount(k), off = effOff(k), gn = goffNames(k).length;
      if (total > 0 && off >= total) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类内 ' + total + ' 张已' + (gn ? '全部关闭（单卡关闭 ' + offCount(k) + ' 张、整组停用 ' + gn + ' 个分组）' : '全部单卡关闭') + '，实际无可用内容。');
      if (!boolOf(store('dc-cat-' + k), true)) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类开关被关闭。');
      if (num(store('dc-prob-' + k), 25) === 0) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类占比为 0%，该分类不会被抽中。');
    });
    DCF.forEach(function (d) {
      var key = d[0], name = d[1], def = d[2], hasPool = d[3];
      if (key === 'deskcheck') return;
      if (num(store('dcf-' + key), def) === 0 && dcfEn) addIssue('warn', '功能字卡「' + name + '」概率为 0%，该功能不再出字卡。');
      if (hasPool && presetCount(key) > 0 && effOff(key) >= presetCount(key)) addIssue('warn', '功能字卡「' + name + '」预设内容已' + (goffNames(key).length ? '全部关闭（单卡 ' + offCount(key) + ' 张、整组停用 ' + goffNames(key).length + ' 组）' : '全部单卡关闭') + '。');
    });
    // 整组停用（#926）逐分类报警：按名单键遍历，19 个分类与名单里的历史/未知键一并覆盖
    Object.keys(goffRec).forEach(function (cat) {
      var gn = goffNames(cat).length;
      if (!gn) return;
      addIssue('warn', goffLabel(cat) + '有 ' + gn + ' 个分组被整组停用（组内 ' + goffCards(cat) + ' 张不参与抽取）：' + goffNamesShown(cat) + '。分组开关在该分类页的分组标题右侧。');
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
      var dictBlock = !dictUseChat ? '词典的「聊天使用」被关闭' : (dictOvChat === 0 ? '词典的「聊天概率」为 0%' : ((dictPoolN <= 0) ? '词典抽卡池为空（语录被逐张关闭' + (goffNames('dict').length ? '或整组停用 ' + goffNames('dict').length + ' 组' : '') + '）' : ''));
      if (dictBlock) addIssue('warn', '「词典拼字」开着且概率生效，但' + dictBlock + '——拼字抽不到卡，去「字卡库→默认字卡·词典」页调整。');
    }
    if (!mjfEn) addIssue('warn', '「梦角自由造句」总开关关闭。');
    else if (mjfProb === 0) addIssue('warn', '「梦角自由造句」概率为 0%。');
    else if (!mjfSrcOn.length) addIssue('warn', '「梦角自由造句」开着，但三个语料来源（自定义字卡/默认聊天字卡/词典）全关或权重全为 0——不会触发。');
    if (!pyEn) addIssue('warn', '「多字卡回复」总开关关闭：每条消息只回一条、每条只用一张字卡；#1236 起它同时是词典拼字的总闸（关掉＝单气泡拼字与逐卡连发都不触发）。');
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
        if (presetCount(k) > 0 && effOff(k) >= presetCount(k)) fixable.push({ id: 'fx-dc-off-' + k, kind: 'cardoff', cat: k });
      });
      DCF.forEach(function (d) {
        if (d[0] === 'deskcheck') return;
        if (num(store('dcf-' + d[0]), d[2]) === 0) fixable.push({ id: 'fx-dcf-' + d[0], key: 'dcf-' + d[0], kind: 'num', v: d[2] });
        if (d[3] && presetCount(d[0]) > 0 && effOff(d[0]) >= presetCount(d[0])) fixable.push({ id: 'fx-dcf-off-' + d[0], kind: 'cardoff', cat: d[0] });
      });
      // 整组停用（#926）也交一键修复：按名单键遍历，未知分类键同样能启用回来
      Object.keys(goffRec).forEach(function (cat) {
        if (goffNames(cat).length) fixable.push({ id: 'fx-goff-dc-' + cat, kind: 'goff', cat: cat });
      });
    }
    fixable.forEach(function (f) {
      if (f.kind === 'en') fixEnable(f.id, f.key);
      else if (f.kind === 'num') fixProb(f.id, f.key, f.v, f.key.indexOf('dcf-') === 0 ? function () { try { window.dcfRefreshUI(f.key.slice(4)); } catch (e) {} } : null);
      else if (f.kind === 'cardoff') fixCardOffs(f.id, f.cat);
      else if (f.kind === 'goff') fixPresetGroups(f.id, f.cat);
      registerBulk(f.id);
    });
    Object.keys(ownOff).forEach(function (t) { if ((ownOff[t] || []).length) { var id = 'fx-goff-own-' + t; fixGroupOff(id, 'own', t); registerBulk(id); } });
    Object.keys(pubOff).forEach(function (t) { if ((pubOff[t] || []).length) { var id2 = 'fx-goff-pub-' + t; fixGroupOff(id2, 'public', t); registerBulk(id2); } });
    if (bulkFixes.length) {
      // FIX 2026-09-17 #677：原来无条件 return true——即使每一项都没能落地（例如单卡关闭
      //   计数口径错导致「恢复单卡」是空转），toast 也照样说「已修复」，等于给用户
      //   「点了有用」的假反馈。改为按实际落地数回报。
      addFix('__allfix', function () {
        var n = 0;
        bulkFixes.forEach(function (id) { try { if (fixMap[id]) { var r = fixMap[id](); if (r !== false && r !== 'fail') n++; } } catch (e) {} });
        try { if (window.dcfRefreshUI) DCF.forEach(function (d) { window.dcfRefreshUI(d[0]); }); } catch (e) {}
        return n > 0 ? true : false;
      }, function () {
        var out = [];
        bulkFixes.forEach(function (id) { try { if (fixDesc[id]) out = out.concat(fixDesc[id]()); } catch (e) {} });
        return out;
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
      // #1451：本节（回复链路）里的 en/num 修复项都是 reply- 命名空间的键，一律走 reply 版
      //   修复器——老的 fixEnable/fixProb 会把值写进裸键，点了修复实际什么都没改。
      if (m.fix.kind === 'en') fixReplyEnable(id, m.fix.key);
      else if (m.fix.kind === 'num') fixReplyProb(id, m.fix.key, m.fix.v);
      else if (m.fix.kind === 'fn' && typeof m.fix.run === 'function') addFix(id, m.fix.run);
      else return null;
      replyFixables.push(id);
      return id;
    }
    var MECH = [
      {
        id: 'qs', name: '词典拼字', key: 'qs-en · qs-prob', ok: !lock && pyEn && qsEn && qsProbEff > 0 && dictUseChat && dictOvChat > 0 && dictPoolN > 0,
        txt: '存盘 ' + qsProbRaw + '% · 生效 ' + qsProbEff + '%（' + humanProb(qsProbEff, 'reply') + '）',
        // #1451：把抽卡侧真正取用的张数区间摆出来（单设/跟随一眼分清）——「设的 2~5 一直发 5 张」
        //   先看这里：若写着「跟随」而「多字卡回复」那对的条数已是 5~5，病根就在条数那对。
        extra: '池 ' + dictPoolN + ' 条 · ' + (qsCc ? '混用自定义字卡' : '只用词典语录') + ' · 每次拼 ' + qsMinN + '~' + qsMaxN + ' 张' + (qsPairOwn ? '（单设）' : '（跟随多字卡回复）'),
        // FIX 2026-09-25 #1236：pyEn 自本批起是词典拼字的总闸（关掉它两种形态都不触发）——体检的
        //   ok 与漏斗必须摆出它，否则「全绿却永不出拼字」＝体检说谎（#998/#1000 同族）。
        gates: [{ t: '锁', ok: !lock }, { t: '多字卡总闸', ok: pyEn }, { t: '拼字开关', ok: qsEn }, { t: '拼字概率', ok: qsProbEff > 0 }, { t: '词典聊天使用', ok: dictUseChat }, { t: '词典概率', ok: dictOvChat > 0 }, { t: '抽卡池', ok: dictPoolN > 0 }],
        fix: (!qsEn || !pyEn || qsProbRaw === 0) ? {
          kind: 'fn', label: (!qsEn ? '打开' : (!pyEn ? '开多字卡' : '恢复概率')), run: function () {
            // 三颗闸同一颗按钮收口（同 py 行的取舍）：只写 qs-en 而 py-en 还关着＝点了没反应。
            // #1451：写入口换 replySet——老写法 storeSet('qs-en') 写的是裸键，回复侧根本读不到。
            var n = 0;
            if (!replyBool('qs-en', true)) { recordUndo('own', 'reply-qs-en'); replySet('qs-en', '1'); n++; }
            if (!replyBool('py-en', true)) { recordUndo('own', 'reply-py-en'); replySet('py-en', '1'); n++; }
            if (replyNum('qs-prob', 25) === 0) { recordUndo('own', 'reply-qs-prob'); replySet('qs-prob', 25); n++; }
            return n > 0;
          }
        } : null
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
        txt: (pyEn ? '开' : '关') + ' · ' + pyProb + '%（' + humanProb(pyProb, 'reply') + '，不过总档） · 每条消息 ' + Math.max(1, Math.min(10, replyNum('py-min', 2))) + '~' + Math.max(1, Math.min(10, replyNum('py-max', 5))) + ' 条',
        extra: '', gates: [{ t: '总开关', ok: pyEn }, { t: '概率', ok: pyProb > 0 }],
        // py-prob 也是会被设成 0 的（模板 data-min=0）——「概率为 0」与「开关关着」是两个闸门，
        //   同一颗按钮一起收口，不然点了「打开」仍然不出多字卡。写入口走 replySet（#1451：老写法
        //   storeSet('py-en') 写的是裸键，点了修复回复侧读不到）。
        fix: (!pyEn || pyProb === 0) ? {
          kind: 'fn', label: (!pyEn ? '打开' : '恢复概率'), run: function () {
            if (!replyBool('py-en', true)) { recordUndo('own', 'reply-py-en'); replySet('py-en', '1'); }
            if (replyNum('py-prob', 50) === 0) { recordUndo('own', 'reply-py-prob'); replySet('py-prob', 50); }
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
    if (cspCust === 0 && !lock) { fixReplyProb(idCsp, 'csp-cust', 50); replyFixables.push(idCsp); cspFix = idCsp; }
    chainInner += rowHtml('自定义字卡占比（csp-cust）', cspCust + '%' + (cspCust === 0 ? ' · 自定义字卡基本不出现' : (cspCust >= 100 ? ' · 预设默认字卡基本不覆盖' : '')), cspCust === 0 ? 'warn' : 'ok', { fix: cspFix, edit: '@reply:chat' });
    chainInner += rowHtml('默认聊天字卡 · 聊天使用 / 概率（dc-use-chat · dc-overall-chat）', (dcUseChat ? '场景开' : '场景关') + ' · 存盘 ' + dcOvRaw + '% · 生效 ' + dcOvEff + '%（总档 ' + all + '%）', (!dcUseChat || dcOvEff === 0 || !dcEn) ? 'warn' : 'ok', { edit: 'defaultCards' });
    chainInner += funnelHtml([{ t: '锁', ok: !lock }, { t: '总开关', ok: dcEn }, { t: '聊天场景', ok: dcUseChat }, { t: '总档', ok: all > 0 }, { t: '聊天概率', ok: dcOvEff > 0 }, { t: '自定义占比放行', ok: cspCust < 100 }]);
    // 附加件：拍一拍/表情包/emoji/图片/语音/颜文字/引用——命中后往同一条回复里追加内容，
    // 表情包/图片/颜文字都是从你的字卡库里抽的（所以它们归零＝那几类字卡永不出现）。
    var attachMech = [['sticker-prob', '表情包'], ['image-prob', '图片'], ['kaomoji-prob', '颜文字'], ['touch-prob', '拍一拍'], ['emoji-prob', 'emoji'], ['voice-prob', '语音'], ['quote-prob', '引用']];
    var ATTACH_DEF = {};
    ATTACH.forEach(function (a) { ATTACH_DEF[a[0]] = a[2]; });
    var attachTxt = attachMech.map(function (a) { return a[1] + ' ' + clampPct(replyNum(a[0], ATTACH_DEF[a[0]])) + '%'; }).join(' · ');
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
        // 先记撤销（旧值），再写；#1451：七项附加概率都在 reply- 命名空间——老写法
        //   storeSet('sticker-prob') 写的是裸键，点了「恢复表情包/图片」实际什么都没改。
        function fixOne(a) { recordUndo('own', 'reply-' + a[0]); if (replySet(a[0], a[2])) okAny = true; }
        if (attachOn.length) {
          ATTACH.forEach(function (a) { if (a[0] === 'sticker-prob' || a[0] === 'image-prob') fixOne(a); });
        } else {
          ATTACH.forEach(fixOne);
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
    chainInner += rowHtml('主动发送（as-en · as-prob）', (asEn ? '开 · ' + clampPct(replyNum('as-prob', 30)) + '%' : '关（TA 不主动找你）') + (dndEn ? ' · 免打扰中' : ''), 'mute', { edit: '@reply:chat' });
    if (replyFixables.length) {
      addFix('__allfix-reply', function () {
        var n = 0;   // 同 __allfix：按实际落地数回报，全空转时不假报「已修复」
        replyFixables.forEach(function (id) { try { if (fixMap[id]) { var r = fixMap[id](); if (r !== false && r !== 'fail') n++; } } catch (e) {} });
        return n > 0 ? true : false;
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
      '锁定时：默认聊天字卡、词典（含词典拼字）、其他互动功能字卡的系统预设内容全部取不到，各页开关看起来「开了却没效果」属正常。<br><b>不受此锁影响（#499 豁免）</b>：聊天情绪字卡、心意字卡、交流意图、聊天回应字卡、TA 的心情、今日情话、位置卡、查岗问题库、TA 主动提问——未解锁也照常使用。<br><b>「浏览受锁、回应不受锁」（#1422）</b>：贴贴的回应与婉拒、游戏邀请的婉拒、朋友圈 TA 的点评与回复、我发出的邀请预设——这六组已进【其他互动功能字卡→互动回应】，锁定时<b>在库里看不到也搜不到</b>（跟系统预设整体一个口径），但 TA <b>照样会按它们说话</b>：婉拒与回应是交互的必需回应，锁定的只是浏览入口，不能出现「拒绝了 TA 的贴贴邀请之后一句话都不回」。解锁后可见可关，关掉的句子即刻从回应里退场（整组停用同理）。<br>解锁：开屏公告区「防未成年人·内置字卡锁定」卡点「输入密码解锁」；重锁：同卡一键重新上锁。');

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
      var total = presetCount(k), off = offCount(k), gn = goffNames(k).length;
      var avail = total - effOff(k);   // #932：单卡闸与分组闸合并后的真实可用张数
      // #583：补两道真实存在、原先漏斗里没有的闸门——`dc-use-chat`（聊天场景开关，drawCards
      //   `if (!a.use(scene)) return []`）与总档 `dcpEff(overall)`。缺了它们，总档=0 或
      //   聊天场景被关时每一行仍显示 ✓，用户会以为「分类占比 25% 就该出卡」。
      var funnel = funnelHtml([
        { t: '锁', ok: !lock }, { t: '总开关', ok: dcEn }, { t: '聊天场景', ok: dcUseChat }, { t: '总档', ok: all > 0 },
        { t: '分类', ok: cat }, { t: '占比', ok: prob > 0 }, { t: '内容', ok: avail > 0 }
      ]);
      var usable = !lock && dcEn && dcUseChat && all > 0 && cat && prob > 0 && avail > 0;
      var idCat = 'inl-dc-cat-' + k, idProb = 'inl-dc-prob-' + k, idOff = 'inl-dc-off-' + k, idGoff = 'inl-dc-goff-' + k;
      if (!lock) {
        if (!cat) fixEnable(idCat, 'dc-cat-' + k);
        if (prob === 0) fixProb(idProb, 'dc-prob-' + k, 25);
        if (total > 0 && avail <= 0) fixCardOffs(idOff, k);
        if (gn) fixPresetGroups(idGoff, k);
      }
      dcInner += '<div class="storage-row"><span>' + esc(CC_LABEL[k]) + '（dc-cat-' + k + ' · dc-prob-' + k + '）</span><b class="' + (usable ? 'ca-ok' : 'ca-warn') + '">' +
        (cat ? '开' : '关') + ' · 占比 ' + prob + '%（聊天生效 ' + dcOvEff + '%×' + prob + '% ≈ ' + humanProb(dcOvEff * prob / 100, 'reply') + '） · ' + total + ' 张' + (off ? '（单卡关 ' + off + '）' : '') + goffSuffix(k) +
        (!cat && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idCat + '">启用</button>' : '') +
        (prob === 0 && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idProb + '">恢复占比</button>' : '') +
        (total > 0 && avail <= 0 && off > 0 && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idOff + '">恢复单卡</button>' : '') +
        (gn && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idGoff + '">启用分组</button>' : '') +
        ' <span class="ca-jump ca-edit" data-jump="defaultCards">调整</span></b></div>' + funnel;
    });
    push('二、系统预设 · 聊天默认字卡', dcInner,
      '漏斗＝「锁 → 总开关 → 聊天场景 → 总档 → 分类开关 → 分类占比>0 → 有未关闭的内容」，任一 ✕ 该分类就抽不到。聊天生效概率＝dc-overall-chat 经总档缩放后的值（分类占比是命中后的相对权重，不再乘总档）。<br><b>内容闸口径</b>：单卡关闭与「整组停用」(#926，分组标题右侧开关，存 dc-groups-off) 合并统计——整组停用的组内字卡同样不参与抽取，所以一行可能显示「0 张可用」而单卡开关全是开的。<br><b>注意</b>：分类占比高不等于「回复里就有这张卡」——预设抽中后还要过「自定义字卡占比 csp-cust」这一签才会覆盖自定义文本，实际覆盖率见上方「回复链路」节。<br><b>怎么调</b>：点每行「调整」进「聊天默认字卡」页改开关/占比/分组开关，或点「修复」恢复默认（「启用分组」只放开分组、不动组内单卡开关）。');

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
    var idDictGoff = 'inl-dict-goff';
    if (goffNames('dict').length && !lock) fixPresetGroups(idDictGoff, 'dict');
    dictInner += rowHtml('词典内置词条', presetGroups('dict').length + ' 组 · ' + presetCount('dict') + ' 条' +
      (offCount('dict') ? '（单卡关 ' + offCount('dict') + '）' : '') + goffSuffix('dict') + ' · 可用 ' + dictPoolN + ' 条',
      dictPoolN > 0 ? 'mute' : 'warn', { fix: (goffNames('dict').length && !lock) ? idDictGoff : '', fixLabel: '启用分组', edit: 'dictCards' });
    var dq = 0, dw = 0;
    try { dq = (JSON.parse(glob('dict-custom-quotes') || '[]') || []).length; } catch (e) {}
    try { dw = (JSON.parse(glob('dict-custom-words') || '[]') || []).length; } catch (e) {}
    dictInner += rowHtml('自建词条（全局）', '语录 ' + dq + ' 条 · 词 ' + dw + ' 条', 'mute');
    var dictUsable = !lock && dictAnyUse && dictAnyProb && dictPoolN > 0;
    dictInner += rowHtml('实际可用', dictUsable ? '可用' : (lock ? '被二级锁整体停用' : (dictPoolN <= 0 ? '抽卡池为空' : '不可用')), dictUsable ? 'ok' : 'warn');
    dictInner += funnelHtml([{ t: '锁', ok: !lock }, { t: '场景', ok: dictAnyUse }, { t: '概率', ok: dictAnyProb }, { t: '内容', ok: dictPoolN > 0 }]);
    push('三、系统预设 · 词典（拼字抽句/切词）', dictInner,
      '词典属系统内置字卡，二级锁锁定时整池停用（下方开关全开也无效）；自建词条为全局键，不随桌面隔离。聊天词典内容走「词典拼字」，写信/朋友圈开启后按概率混入文案。词条可逐张关闭、也可整组停用（分组标题右侧开关），任一方式覆盖到全部词条时抽卡池即为空。<br><b>怎么调</b>：点每行「调整」进「默认字卡·词典」页。');

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
      var gn = hasPool ? goffNames(key).length : 0;
      var avail = hasPool ? total - effOff(key) : 1;   // #932：单卡闸∪分组闸后的真实可用张数
      var gate = key === 'deskcheck' ? true : dcfEn;
      var usable = !lock && gate && eff > 0 && avail > 0;
      var funnel = funnelHtml([
        { t: '锁', ok: !(lock && hasPool) }, { t: '总开关', ok: gate }, { t: '概率', ok: eff > 0 },
        { t: '内容', ok: avail > 0 }
      ]);
      var id = 'inl-dcf-' + key, idOff = 'inl-dcf-off-' + key, idGoff = 'inl-dcf-goff-' + key;
      if (raw === 0 && !lock) fixProb(id, 'dcf-' + key, def, function () { try { window.dcfRefreshUI(key); } catch (e) {} });
      if (hasPool && total > 0 && avail <= 0 && off > 0 && !lock) fixCardOffs(idOff, key);
      if (hasPool && gn && !lock) fixPresetGroups(idGoff, key);
      var cnt = hasPool ? (total + ' 张' + (off ? '（单卡关 ' + off + '）' : '') + goffSuffix(key)) : '—（发到聊天型，无独立字卡池）';
      fInner += '<div class="storage-row"><span>' + esc(name) + '（dcf-' + key + '）</span><b class="' + (usable ? 'ca-ok' : 'ca-warn') + '">存盘 ' + raw + '% · 生效 ' + eff + '%（' + humanProb(eff, 'trig') + '） · ' + cnt +
        (raw === 0 && !lock ? ' <button class="ca-fix" type="button" data-fix="' + id + '">恢复概率</button>' : '') +
        (hasPool && total > 0 && avail <= 0 && off > 0 && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idOff + '">恢复单卡</button>' : '') +
        (hasPool && gn && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idGoff + '">启用分组</button>' : '') +
        ' <span class="ca-jump ca-edit" data-jump="funCards">调整</span></b></div>' + funnel;
    });
    push('四、系统预设 · 其他互动功能字卡（19 类）', fInner,
      '生效概率 = 分类存盘值 × 聊天概率总档 ÷ 100；总开关关闭时除「跨桌面查岗」外全部归 0。二级锁锁定时系统预设内容不可用，但你自建的同类功能字卡仍可用（本页只统计系统预设张数）。<br><b>内容闸口径</b>：单卡关闭与「整组停用」（分组标题右侧开关，存 dc-groups-off）合并统计，整组停用的组内字卡不参与抽取。<br><b>怎么调</b>：点每行「调整」进「其他互动功能字卡」页（聊天概率总档在「回复设置 → 聊天」里调）。');

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
    addFix(idRc, function () {
      if (!boolOf(store('rc-enabled'), true)) { recordUndo('own', 'rc-enabled'); storeSet('rc-enabled', '1'); }
      if (num(store('rcard-prob'), 30) === 0) { recordUndo('own', 'rcard-prob'); storeSet('rcard-prob', 30); }
      return true;
    }, function () {
      var a = [];
      if (!boolOf(store('rc-enabled'), true)) a.push('rc-enabled：关闭 → 开启');
      if (num(store('rcard-prob'), 30) === 0) a.push('rcard-prob：0% → 30%');
      return a.length ? a : ['聊天回应字卡已是默认'];
    });
    oInner += rowHtml('聊天回应字卡（rc-enabled / rcard-prob）', (rcEn ? '开启' : '关闭') + ' · 整条替换 ' + rcProb + '%（' + humanProb(rcProb, 'reply') + '） · 连接词追加 cf-prob ' + replyNum('cf-prob', 20) + '% · ' + dataCount(MC.followup) + ' 张', (rcEn && rcProb > 0) ? 'ok' : 'warn', { fix: (!rcEn || rcProb === 0) ? idRc : '', edit: 'replyCards' });
    var tmEn = boolOf(store('tm-enabled'), true), tmProb = num(store('tm-prob'), 15);
    var idTm = 'inl-tm';
    addFix(idTm, function () {
      if (!boolOf(store('tm-enabled'), true)) { recordUndo('own', 'tm-enabled'); storeSet('tm-enabled', '1'); }
      if (num(store('tm-prob'), 15) === 0) { recordUndo('own', 'tm-prob'); storeSet('tm-prob', 15); }
      return true;
    }, function () {
      var a = [];
      if (!boolOf(store('tm-enabled'), true)) a.push('tm-enabled：关闭 → 开启');
      if (num(store('tm-prob'), 15) === 0) a.push('tm-prob：0% → 15%');
      return a.length ? a : ['TA 的心情已是默认'];
    });
    oInner += rowHtml('TA 的心情（tm-enabled / tm-prob）', (tmEn ? '开启' : '关闭') + ' · ' + tmProb + '%（' + humanProb(tmProb, 'reply') + '） · ' + dataCount((window.TA_MOOD_DATA || {}).groups) + ' 张', (tmEn && tmProb > 0) ? 'ok' : 'warn', { fix: (!tmEn || tmProb === 0) ? idTm : '', edit: 'taMood' });
    [['quote-cards-default', '桌面今日情话', 'quoteCards'], ['loc-lib-default', 'TA在身边位置卡', 'locCards'], ['checkin-cards-default', '寻踪日常字卡', 'checkinCards']].forEach(function (t) {
      var on = boolOf(store(t[0]), true), id = 'inl-' + t[0];
      if (!on) fixEnable(id, t[0]);
      oInner += rowHtml(t[1] + '（' + t[0] + '）', on ? '开启' : '关闭', on ? 'ok' : 'warn', { fix: !on ? id : '', jump: t[2] });
    });
    var ck = null; try { ck = JSON.parse(store('ta-checkin') || 'null'); } catch (e) {}
    var ckUseDef = ck && ck.settings ? ck.settings.useDefault !== false : true;
    oInner += rowHtml('查岗问题库（ta-checkin.settings.useDefault）', (ckUseDef ? '使用系统预设' : '仅用自建') + ' · 触发 ckq-en ' + (replyBool('ckq-en', true) ? '开' : '关') + ' / ckq-prob ' + replyNum('ckq-prob', 2) + '%', 'mute', { jump: 'taCheckin' });
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
  // FIX 2026-09-17 #677：build() 此前完全没有兜底，而唯一的两个调用方（openAudit /
  //   refreshAll）都把异常吞掉 ⇒ 一旦自检中途抛错：页面停在上一帧（或模板里的静态占位）、
  //   lastText 不更新（首开即恒为空串）。用户那边看到的就是「自检页像是能用，但导出
  //   报告里什么内容都没有」（2026-09-17 报障）。这里把错误本身写进报告与页面：
  //   任何情况下报告都有内容、失败原因直接可见，不再靠猜。
  function errText(e) { try { return (e && (e.message || e.name)) ? String(e.message || e.name) : String(e); } catch (e2) { return '未知错误'; } }
  // 版本号：设置页面包屑里的 #about-ver-val 是构建时替换的真值（window.APP_VERSION 未必赋值，
  //   见 personalize.js 同款注释），取不到再退回全局量。
  function appVer() {
    try { var el = document.getElementById('about-ver-val'); var t = el && String(el.textContent || '').trim(); if (t && t.indexOf('__') < 0) return t; } catch (e) {}
    try { return String(window.APP_VERSION || '未知'); } catch (e2) { return '未知'; }
  }
  function render() {
    var r;
    buildErr = '';
    try { r = build(); }
    catch (e) {
      buildErr = errText(e);
      lastText = (lines.length ? lines.join('\n') + '\n\n' : '') +
        '【自检未能完成】读取数据时出错：' + buildErr +
        '\n（本页只跑完了上面这些检查项）';
      r = { issueCount: issueCount + 1 };
    }
    updateBadge(r.issueCount);
    var secs = sections.slice();
    if (buildErr) secs.unshift(cardHtml('自检未能完成（内部错误）',
      '<div class="ca-banner ca-bad">⚠ 自检中途出错，下面显示的是出错前已跑完的部分：<br><b>' + esc(buildErr) + '</b><br>可用本页「导出文件」导出报告留档。</div>', null));
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
      else { injectPicks(); applyFilter(); }
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
      // #932：整组停用（#926）按有内容的分类计数，与 build 里「每分类一条 warn」对齐；仍不解析池
      var gso = goffRecord();
      Object.keys(gso).forEach(function (c) { if (Array.isArray(gso[c]) && gso[c].length) n++; });
      // #583：回复设置 → 聊天 侧的闸门（都只读单个键，不触发池解析）
      // #1451：这几个键全在 reply- 命名空间，读数走 replyNum/replyBool——老写法裸读永远读不到
      //   存盘值，角标和「打开自检页后的结论」会对不上（角标说没问题、页里列出问题）。
      if (replyNum('rn-prob', 20) > 60) n++;   // >=100 是 bad、>60 是 warn，两者都计（同 build 的问题清单）
      if (!replyBool('qs-en', true)) n++;
      else if (replyNum('qs-prob', 25) === 0) n++;
      if (!replyBool('mjf-en', true)) n++;
      else if (replyNum('mjf-prob', 20) === 0) n++;
      if (!replyBool('py-en', true) || replyNum('py-prob', 50) === 0) n++;
      if (replyNum('csp-cust', 50) === 0) n++;
      var _att = [['touch-prob', 5], ['sticker-prob', 10], ['emoji-prob', 5], ['image-prob', 5], ['voice-prob', 10], ['kaomoji-prob', 5], ['quote-prob', 30]];
      var _attAllOff = !_att.some(function (a) { return replyNum(a[0], a[1]) > 0; });
      if (_attAllOff) n++;
      else if (replyNum('sticker-prob', 10) === 0 && replyNum('image-prob', 5) === 0) n++;  // 媒体字卡不出镜（同 build 的 mediaOff）
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

  // ---------- 修复：预览确认 + 单级撤销 + 勾选批量 ----------
  function updateUndoBtn() { if (undoBtn) undoBtn.disabled = !undoStack.length; }
  function confirmFix(id) {
    var fn = fixMap[id];
    if (!fn) return;
    var lines = [];
    try { if (fixDesc[id]) lines = fixDesc[id]() || []; } catch (e) {}
    if (lines.length && window.openModal) {
      var ctl = window.openModal('确认修复（可撤销）', '', function (v) { if (v === 'ok') applyFix(id); },
        { noInput: true, big: true, staticText: '将进行以下修改（只改设置，不改动字卡内容）：\n\n' + lines.map(function (x) { return '· ' + x; }).join('\n') + '\n\n修复后可点顶部「撤销上次」还原。' });
      try { if (ctl && ctl.okText) ctl.okText('确认修复'); } catch (e) {}
    } else {
      applyFix(id);
    }
  }
  function applyFix(id) {
    var fn = fixMap[id];
    // FIX 2026-09-17 #677：原来这里静默 return——确认弹窗弹出后若期间有过一次后台
    //   render()（切桌面/回填完成等事件）重建了 fixMap，用户点「确认修复」会什么都不发生、
    //   连提示都没有（又一种「按恢复没有反应」）。补一句可见反馈。
    if (!fn) { toast('这一项已刷新，请重新点「修复」'); render(); return; }
    undoStack = [];
    var res = false;
    try { res = fn(); } catch (e) { res = 'fail'; }
    try { if (res !== false && res !== 'fail' && window.dcfRefreshUI) DCF.forEach(function (d) { window.dcfRefreshUI(d[0]); }); } catch (e) {}
    updateUndoBtn();
    render();
    if (res === false) toast('没有需要修复的项（或已是最新）');
    else if (res === 'fail') toast('修复未生效：本机存储可能已满或被拦截');
    else toast('已修复，可点「撤销上次」还原');
  }
  function undoLastFix() {
    if (!undoStack.length) { toast('没有可撤销的修复'); return; }
    var n = 0;
    undoStack.forEach(function (u) {
      if (u.old === null || u.old === undefined) { if (storeRemoveScope(u.scope, u.key)) n++; }
      else { if (storeSetScope(u.scope, u.key, u.old)) n++; }
    });
    undoStack = [];
    updateUndoBtn();
    try { if (window.dcfRefreshUI) DCF.forEach(function (d) { window.dcfRefreshUI(d[0]); }); } catch (e) {}
    render();
    toast(n ? '已撤销上次修复' : '撤销失败');
  }
  // 勾选模式：在每个可修复行插入复选框（跳过总「一键修复」）
  function injectPicks() {
    if (!pickMode) return;
    bodyEl.querySelectorAll('[data-fix]').forEach(function (btn) {
      var id = btn.getAttribute('data-fix');
      if (id === '__allfix') return;
      var row = btn.closest ? btn.closest('.storage-row') : null;
      if (!row || row.querySelector('.ca-pick')) return;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ca-pick';
      cb.setAttribute('data-pick', id);
      cb.checked = true;
      row.classList.add('ca-pick-row');
      var b = row.querySelector('b');
      if (b) b.insertBefore(cb, b.firstChild);
    });
    updatePickCount();
  }
  function updatePickCount() {
    if (!applyBtn) return;
    applyBtn.textContent = '应用所选 (' + bodyEl.querySelectorAll('.ca-pick:checked').length + ')';
  }
  function applySelected() {
    var ids = [];
    bodyEl.querySelectorAll('.ca-pick:checked').forEach(function (cb) { ids.push(cb.getAttribute('data-pick')); });
    if (!ids.length) { toast('请先勾选要修复的项'); return; }
    var lines = [];
    ids.forEach(function (id) { try { if (fixDesc[id]) lines = lines.concat(fixDesc[id]()); } catch (e) {} });
    var run = function () {
      undoStack = [];
      var n = 0;
      ids.forEach(function (id) { try { if (fixMap[id] && fixMap[id]() !== false) n++; } catch (e) {} });
      try { if (window.dcfRefreshUI) DCF.forEach(function (d) { window.dcfRefreshUI(d[0]); }); } catch (e) {}
      updateUndoBtn();
      render();
      toast('已修复 ' + n + ' 项，可点「撤销上次」还原');
    };
    if (window.openModal) {
      var ctl2 = window.openModal('确认修复所选 ' + ids.length + ' 项（可撤销）', '', function (v) { if (v === 'ok') run(); },
        { noInput: true, big: true, staticText: '将进行以下修改（只改设置，不改动字卡内容）：\n\n' + lines.map(function (x) { return '· ' + x; }).join('\n') + '\n\n修复后可点顶部「撤销上次」还原。' });
      try { if (ctl2 && ctl2.okText) ctl2.okText('确认修复'); } catch (e) {}
    } else run();
  }
  function togglePickMode() {
    pickMode = !pickMode;
    if (pickBtn) pickBtn.textContent = pickMode ? '退出批量' : '批量修复';
    if (applyBtn) applyBtn.hidden = !pickMode;
    render();
    // FIX 2026-09-16 #618：进入批量模式给一句明确指引（勾选是默认全选），并区分「无可修项」，
    //   否则按钮文字在顶部、复选框在下方滚动区，用户看不到变化就以为功能没用。
    if (pickMode) setTimeout(function () {
      var n = bodyEl.querySelectorAll('.ca-pick').length;
      toast(n ? '已进入批量修复：已自动勾选 ' + n + ' 项，点顶部「应用所选」确认' : '当前没有可批量修复的问题项');
    }, 260);
  }
  function exportReport() {
    // FIX 2026-09-17 #677：报告为空就现取一次（正常路径零影响：render() 已填过）。
    // 兜底再兜底——任何情况下导出文件都带「可读的头 + 原因」，绝不出现「导出了但没内容」。
    if (!lastText) { try { render(); } catch (e) {} }
    if (!lastText) {
      lastText = '【自检报告为空】没有取到自检结果。\n可能原因：自检页尚未完成首次渲染（请返回上一页重新打开「字卡使用状态自检」再导出）。\n'
        + '版本：' + appVer() + '\n时间：' + new Date().toLocaleString() + '\n设备：' + (navigator.userAgent || '');
    }
    // FIX 2026-09-18 #746：导出格式从 JSON 改为 docx（用户直派）——导出的 .json 在手机上
    //   没有关联应用打开，等于「导出文件用不了」；与诊断报告 #227 同解：docx 由 Word/WPS
    //   直接打开、可直接转发。主链复用 device.js 三级降级导出入口（分享面板→保存框→
    //   确认后下载），head 段承接原 JSON payload 结构化字段（版本/时间/设备/桌面/内部错误），
    //   信息不丢；mochiDiagExportDocx 不在（旧产物/极端内核）→ 降回原 JSON 链兜底，
    //   copyReport 仍是最后兜底——任何路径都不会空手而归。
    var head = '版本：' + appVer()
      + '\n时间：' + new Date().toLocaleString()
      + '\n设备：' + (navigator.userAgent || '')
      + '\n当前桌面：' + deskName(activeCid())
      + (buildErr ? '\n自检中途出错：' + buildErr : '')
      + '\n\n';
    var d = new Date();
    var p2 = function (x) { return (x < 10 ? '0' : '') + x; };
    var fname = 'mochi-card-audit-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.docx';
    if (typeof window.mochiDiagExportDocx === 'function') {
      try {
        window.mochiDiagExportDocx(head + lastText, 'mochi-card-audit-',
          'docx 下载未能触发，请改用「复制报告」粘贴给开发者', toast, '字卡使用状态自检报告');
        return;
      } catch (e) {}
    }
    var payload = {
      app: 'mochi', kind: 'card-audit',
      version: appVer(),
      generatedAt: new Date().toISOString(),
      ua: navigator.userAgent || '',
      desktop: deskName(activeCid()),
      buildError: buildErr || '',
      issueCount: issueCount,
      issues: issues.map(function (v) { return { level: v.lv, text: v.text }; }),
      report: lastText
    };
    var fnameJson = 'mochi-card-audit-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.json';
    if (window.mochiExportFile) {
      try { window.mochiExportFile(JSON.stringify(payload, null, 2), fnameJson, '字卡使用状态自检报告'); return; } catch (e) {}
    }
    copyReport();
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
  function openAudit(from) {
    try {
      // #595b：记录来源页——从「回复设置」快捷按钮进入时返回回复设置，否则回设置页
      window.__cardAuditFrom = from || '';
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
      var dest = window.__cardAuditFrom === 'reply' ? 'page-reply-settings' : 'page-setting';
      var s = document.getElementById(dest);
      if (s) s.hidden = false;
    } catch (e) {}
  }
  if (row) row.addEventListener('click', function () { openAudit(''); });
  // #595b：回复设置页「字卡使用状态自检」快捷按钮
  var rpsAuditBtn = document.getElementById('rps-card-audit');
  if (rpsAuditBtn) rpsAuditBtn.addEventListener('click', function () { openAudit('reply'); });
  if (back) back.addEventListener('click', closeAudit);
  if (refreshBtn) refreshBtn.addEventListener('click', function () { render(); toast('已重新自检'); });
  if (copyBtn) copyBtn.addEventListener('click', copyReport);
  if (filterBtn) filterBtn.addEventListener('click', function () {
    onlyProblems = !onlyProblems;
    filterBtn.textContent = onlyProblems ? '显示全部' : '只看有问题';
    applyFilter();
  });
  if (pickBtn) pickBtn.addEventListener('click', togglePickMode);
  if (applyBtn) applyBtn.addEventListener('click', applySelected);
  if (undoBtn) undoBtn.addEventListener('click', undoLastFix);
  if (exportBtn) exportBtn.addEventListener('click', exportReport);
  updateUndoBtn();

  // 委托：修复 / 跳转 / 桌面明细
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var fixBtn = t.closest('[data-fix]');
    if (fixBtn) {
      e.preventDefault();
      confirmFix(fixBtn.getAttribute('data-fix'));
      return;
    }
    var jumpEl = t.closest('[data-jump]');
    if (jumpEl) { e.preventDefault(); jump(jumpEl.getAttribute('data-jump')); return; }
    var deskBtn = t.closest('[data-desk]');
    if (deskBtn) { e.preventDefault(); expandDesk(deskBtn); return; }
    var loadBtn = t.closest('[data-load]');
    if (loadBtn) { e.preventDefault(); loadFullCards(); return; }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('ca-pick')) updatePickCount();
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

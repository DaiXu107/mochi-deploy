// ===== 梦角档案 v2（重构：与【我的档案】互为镜像的「认识TA」档案） =====
// 入口：桌面第三页「梦角档案」图标。
// 定位：【我的档案】=认识自己；【梦角档案】=认识TA——记录「TA是谁，以及我逐渐了解到TA什么」。
// 结构（11 个分区）：
//   TA是谁 / TA的喜好 / TA的习惯 / TA与我的相处 / 我对TA的了解（核心）
//   / TA的位置感 / TA的物品 / TA的梦境 / TA的声音 / 我们的共同记录 / 当前IF世界
//   + 总览页搜索 / 整份档案复制导出（v3.27.x 批量扩展）
// 自定义标签（v3.27.x）：喜好/习惯/物品/共同记录四组 tab 可由用户增删——
//   arc.tags.<group> 存自定义 {id,label}；arc.hide.<group> 存被隐藏的内置 tab id；
//   内置 tab 只能隐藏不能删（老数据 g 键还在，删了数据会失锚），自定义可删（残留条目
//   落到 FALLBACK_TAB 指定的内置 tab，绝不丢数据）。
// 数据键不变：xy-home-v2:narc-<rosterId>（全局根命名空间共享，contacts.js EXCLUDE 已登记）。
// 老数据全兼容（零迁移丢失）：
//   loves(旧了解卡)→「我对TA的了解·发现卡片」（惰性规范化补 src+dots，原字段一律保留）
//   wonders→还不了解；history→理解变化；bonds/moments/records→我们的共同记录（含时间线合并视图）
// 新增容器（ensureArc 惰性补齐）：who / tastes / habits / relate / pos / things / ifw / ifchanges。
// 弹窗注意：多阶段切换离开胶囊阶段必须 ctl.pills([]) 显式隐藏——fire() 的 pills 分支按 pillClicked
//   判断，残留会让下一阶段点确定收到旧胶囊值；cb 里链式开新弹窗必须 setTimeout 0（外层 finally
//   close 会把新弹窗 cb 清空，room.js 三处同款教训）。
(function () {
  const GNS = 'xy-home-v2';
  const page = document.getElementById('page-memo-arc');
  const root = document.getElementById('narc-root');

  function gStore() { try { return window.xyStore(GNS); } catch (e) { return null; } }
  function toast(m) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = m; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 1800);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function mdstr(ts) { const d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function short(s, n) { s = String(s == null ? '' : s); n = n || 18; return s.length > n ? s.slice(0, n) + '…' : s; }
  function strim(v) { return String(v == null ? '' : v).trim(); }

  // ---- 「了解」类型：新卡用新词表；旧数据类型保留映射照常渲染 ----
  const KTYPES = [
    ['klike', '我发现TA喜欢'], ['kdislike', '我知道TA不喜欢'], ['kdo', '我发现TA会'],
    ['kusual', 'TA平时会'], ['konlyme', 'TA只在我面前'], ['kless', 'TA不太会表达'],
    ['kcare', 'TA其实很在意'], ['kmicro', 'TA的小习惯'], ['ksurprise', '让我意外的地方'],
    ['kother', '其他发现']
  ];
  const LEGACY_TYPES = [
    ['like', 'TA喜欢'], ['dislike', 'TA不喜欢'], ['habit', 'TA习惯'], ['care', 'TA在意'],
    ['do', 'TA会'], ['dont', 'TA不会'], ['good', 'TA擅长'], ['bad', 'TA不擅长'],
    ['fear', 'TA害怕'], ['need', 'TA需要'], ['truth', 'TA其实'], ['us', '我们之间'], ['other', '其他']
  ];
  const TYPE_MAP = {};
  LEGACY_TYPES.concat(KTYPES).forEach(t => { TYPE_MAP[t[0]] = t[1]; });
  function typeLabel(t) { return TYPE_MAP[t] || '其他发现'; }

  // ---- 来源（可信程度）与了解程度圆点：来源是性质，圆点是把握；都不是好感度 ----
  const SRCS = [['think', '我认为'], ['told', 'TA告诉我的'], ['seen', '我观察到的'], ['confirmed', '已确认']];
  const SRC_MAP = {}; SRCS.forEach(s => { SRC_MAP[s[0]] = s[1]; });
  const SRC_PILLS = SRCS.map(s => ({ label: s[1], value: s[0] }));
  const SRC_DOT = { think: 2, told: 4, seen: 3, confirmed: 5 };
  const DOT_PILLS = [[1, '●○○○○ 刚有感觉'], [2, '●●○○○ 有几分'], [3, '●●●○○ 比较确定'], [4, '●●●●○ 很确定'], [5, '●●●●● 已确认']]
    .map(d => ({ label: d[1], value: String(d[0]) }));
  function dotsStr(n) { n = parseInt(n, 10); if (isNaN(n)) n = 0; n = Math.max(0, Math.min(5, n)); return '●'.repeat(n) + '○'.repeat(5 - n); }
  function legacyLevelOf(d) { return d >= 5 ? '2' : (d >= 3 ? '1' : '0'); }

  // ---- 字段定义：key, label, placeholder(空态也显示它当引导), 是否多行 ----
  const WHO_GROUPS = [
    { name: '基本资料', fields: [
      ['nick', '昵称', '例如：小梦、阿梦', 0],
      ['call', '称呼', '你们互相怎么叫对方？', 0],
      ['bday', '生日', '例如：3月14日（不确定也可以猜）', 0],
      ['calllike', 'TA喜欢的称呼', '例如：被叫小名会高兴', 0],
      ['calldis', 'TA讨厌的称呼', '例如：不确定就先空着', 0],
      ['age', '年龄', '例如：看起来十七八岁 / 永远十七岁', 0],
      ['constel', '星座', '例如：双鱼座（不确定就猜一个TA像的）', 0],
      ['identity', '身份', '例如：住在梦里的人', 0],
      ['nature', '性格', '例如：安静、慢热，其实很温柔', 0],
      ['looks', '外貌', '头发、眼睛、常穿的衣服……', 1],
      ['intro', '自我介绍', '如果TA要介绍自己，会怎么说？', 1]
    ] },
    { name: '世界设定', fields: [
      ['origin', '来自哪里', '例如：梦的另一边', 0],
      ['realm', '属于什么世界', '例如：梦境 / 现实的倒影', 0],
      ['relation', '与现实世界的关系', '例如：偶尔重叠，大多时候平行', 1]
    ] },
    { name: '存在方式', sub: '不用写成绝对设定，「不固定」「说不好」也是答案。', fields: [
      ['visible', '能否被看见', '例如：不固定 / 偶尔能被看见', 0],
      ['touch', '能否被触碰', '例如：可以产生体感', 0],
      ['exist', '存在方式', '例如：通常在身边，但不一定能被直接观察', 0],
      ['where', '平时在哪里', '例如：说不好，感觉就在旁边', 0],
      ['leave', '是否会离开', '例如：会离开一阵子，但总会回来', 0],
      ['power', '特殊能力 / 特殊设定', '例如：能让房间变得安静', 1]
    ] }
  ];
  const RELATE_FIELDS = [
    ['call', 'TA对我的称呼', '例如：名字、小笨蛋，或者只是「你」', 0],
    ['attitude', 'TA对我的态度', '例如：嘴上平淡，其实很纵容', 0],
    ['intimacy', '表达亲密的方式', '例如：不会抱，但会把头靠过来', 0],
    ['approach', '主动靠近我的方式', '例如：假装路过，然后停下来', 0],
    ['accompany', '陪伴我的方式', '例如：我不说话的时候，就安静待着', 0],
    ['comfort', '安慰我的方式', '例如：不讲道理，只说「有我在」', 0],
    ['loveway', '表达喜欢的方式', '例如：不说喜欢，但记得我说过的每件小事', 0],
    ['boundary', 'TA的雷区 / 底线', '例如：不喜欢被开玩笑说「再见」', 0],
    ['fight', '不愉快时TA会', '例如：先沉默，但会先递台阶', 0]
  ];
  const POS_FIELDS = [
    ['usual', '通常', '例如：身边', 0],
    ['often', '偶尔', '例如：身后 / 左侧 / 房间另一边', 0],
    ['special', '特殊情况', '例如：感觉不到TA位置的时候，可能是在打盹', 1]
  ];
  const IFW_FIELDS = [
    ['since', '从什么时候开始', '例如：今年春天 / 某个梦之后', 0],
    ['world', '当前世界', '例如：海边小镇', 0],
    ['mine', '我的身份', '例如：花店老板', 0],
    ['role', 'TA的身份', '例如：咖啡店老板', 0],
    ['rel', '我们的关系', '例如：恋人 / 刚认识', 0]
  ];
  const FIELD_INDEX = {};
  WHO_GROUPS.forEach(g => g.fields.forEach(f => { FIELD_INDEX[f[0]] = { map: 'who', label: f[1], ph: f[2], multi: f[3] }; }));
  RELATE_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'relate', label: f[1], ph: f[2], multi: f[3] }; });
  POS_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'pos', label: f[1], ph: f[2], multi: f[3] }; });
  IFW_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'ifw', label: f[1], ph: f[2], multi: f[3] }; });

  // ---- 各分区列表词表 ----
  const TASTE_TABS = [['like', '喜欢'], ['dislike', '不喜欢'], ['pref', '偏好']];
  const LIKE_CATS = ['食物', '饮料', '颜色', '动物', '植物', '天气', '季节', '地方', '活动', '音乐', '游戏', '其他'];
  const HABIT_TABS = [['daily', '日常习惯'], ['micro', '小动作'], ['expr', '表达习惯'], ['comp', '陪伴习惯']];
  const HABIT_PH = {
    daily: '例如：天黑以后才出现 / 喜欢待在窗边',
    micro: '例如：想事情的时候会沉默',
    expr: '例如：不说想你，会问「你梦见什么了」',
    comp: '例如：我难过的时候不说话，只是待在旁边'
  };
  const THING_TABS = [['use', 'TA常用'], ['fav', 'TA喜欢'], ['gave', 'TA送我'], ['igave', '我送TA'], ['ours', '我们共有']];
  const THING_PH = {
    use: '例如：常用的耳机',
    fav: '例如：那把旧伞',
    gave: '例如：TA送给我的玩偶',
    igave: '例如：我送TA的发绳',
    ours: '例如：我们的小屋钥匙'
  };
  const SHARED_TABS = [['first', '第一次'], ['habit', '共同经历'], ['secret', '只有我们知道的事'], ['day', '特别日子'], ['thing', '特别物品'], ['place', '特别地点'], ['timeline', '时间线']];
  const BOND_CATS = { first: '第一次', habit: '共同经历', secret: '只有我们知道的事', day: '特别日子', thing: '特别物品', place: '特别地点' };
  const BOND_PH = {
    first: '例如：第一次一起玩游戏',
    habit: '例如：每晚互道晚安',
    secret: '例如：只有我们知道的暗号',
    day: '例如：在一起的第一百天',
    thing: '例如：那半块橡皮',
    place: '例如：常一起发呆的天台'
  };
  // ---- 自定义标签（v3.27.x）：四组可增删 tab；内置只可隐藏，自定义可删（条目落回兜底 tab） ----
  const BUILTIN_TABS = { tastes: TASTE_TABS, habits: HABIT_TABS, things: THING_TABS, shared: SHARED_TABS.filter(t => t[0] !== 'timeline') };
  const TAB_GROUP_TITLE = { tastes: 'TA的喜好', habits: 'TA的习惯', things: 'TA的物品', shared: '我们的共同记录' };
  const FALLBACK_TAB = { tastes: 'pref', habits: 'daily', things: 'use', shared: 'habit' }; // 自定义标签被删时条目迁移目标
  function tabsOf(group, arc) {
    const hide = (arc.hide && arc.hide[group]) || [];
    const base = (BUILTIN_TABS[group] || []).filter(t => hide.indexOf(t[0]) < 0);
    const custom = ((arc.tags && arc.tags[group]) || []).map(t => [t.id, t.label]);
    return base.concat(custom);
  }
  // ---- TA的声音（v3.27.x 新分区）：TA说过的话，原话 + 场景 + 日期 ----
  // ---- 数据存取（名单合并所有桌面命名空间 cjian-roster + 旧根键兜底，同 v3.14.x） ----
  // v3.16.x：条目带 cid（属于哪个桌面联系人）；还没有梦角的联系人也给出「虚拟」chip
  // （virtual:true，id 为空串）——点击即按 cjian.seedIfEmpty 同款语义落一份真身。
  // 虚拟条件：该桌面 roster 为空且没有 cjian-seeded 标记（有标记=用户删过，尊重不复活）。
  function partnerNameOf(cid) {
    let name = '';
    try { name = String(window.xyStore(GNS + ':' + cid).get('lbl-partner') || '').trim(); } catch (e) {}
    if (!name) {
      try {
        const cs = window.getContacts ? window.getContacts() : [];
        const c = cs.find(x => x.id === cid);
        if (c && c.name) name = c.name;
      } catch (e) {}
    }
    return name || 'TA';
  }
  function deskRoster(cid) {
    let list = [];
    try { list = JSON.parse(window.xyStore(GNS + ':' + cid).get('cjian-roster') || '[]'); } catch (e) {}
    return Array.isArray(list) ? list : [];
  }
  function roster() {
    const out = [], seen = {};
    const push = (a, cid) => { (Array.isArray(a) ? a : []).forEach(x => { if (x && x.name && x.id && !seen[x.id]) { seen[x.id] = 1; out.push({ id: x.id, name: x.name, cid: cid || null, virtual: false }); } }); };
    let cs = null;
    try { cs = window.getContacts ? window.getContacts() : null; } catch (e) {}
    const desks = (cs && cs.length ? cs : [{ id: 'default' }]);
    desks.forEach(c => {
      const list = deskRoster(c.id);
      if (list.length) push(list, c.id);
      else {
        let seeded = false;
        try { seeded = !!window.xyStore(GNS + ':' + c.id).get('cjian-seeded'); } catch (e) {}
        if (!seeded) out.push({ id: '', name: partnerNameOf(c.id), cid: c.id, virtual: true });
      }
    });
    push(JSON.parse(gStore().get('cjian-roster') || '[]'), null);
    return out;
  }
  // 把某个桌面的虚拟名单落成真身（返回新梦角 id）；已有名单直接返回首个；
  // 该桌面带 cjian-seeded 标记且名单为空 = 用户删过，尊重不复活（返回空串）。
  function materializeDesk(cid) {
    try {
      const ds = window.xyStore(GNS + ':' + cid);
      const list = deskRoster(cid);
      if (list.length) { ds.set('cjian-seeded', '1'); return list[0].id; }
      let seeded = false;
      try { seeded = !!ds.get('cjian-seeded'); } catch (e) {}
      if (seeded) return '';
      const entry = { id: makeId(), name: partnerNameOf(cid), offsetMin: 0 };
      ds.set('cjian-roster', JSON.stringify([entry]));
      ds.set('cjian-seeded', '1');
      return entry.id;
    } catch (e) { return ''; }
  }
  function keyOf(id) { return 'narc-' + id; }
  function loadRaw(id) { const s = gStore(); if (!s) return null; try { const o = JSON.parse(s.get(keyOf(id)) || 'null'); if (o && typeof o === 'object') return o; } catch (e) {} return null; }
  function saveArc(id, o) { const s = gStore(); if (s) { try { s.set(keyOf(id), JSON.stringify(o)); } catch (e) {} } }
  function normObj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
  function makeId() { return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function ensureArc(id) {
    let o = loadRaw(id), dirty = false;
    if (!o) { o = { created: Date.now(), loves: [], bonds: [], moments: [], records: [], wonders: [], history: [] }; dirty = true; }
    ['loves', 'bonds', 'moments', 'records', 'wonders', 'history', 'tastes', 'habits', 'things', 'ifchanges', 'dreams', 'quotes'].forEach(k => { if (!Array.isArray(o[k])) { o[k] = []; dirty = true; } });
    if (!normObj(o.tags)) { o.tags = {}; dirty = true; }
    ['tastes', 'habits', 'things', 'shared'].forEach(k => { if (!Array.isArray(o.tags[k])) { o.tags[k] = []; dirty = true; } });
    if (!normObj(o.hide)) { o.hide = {}; dirty = true; }
    ['tastes', 'habits', 'things', 'shared'].forEach(k => { if (!Array.isArray(o.hide[k])) { o.hide[k] = []; dirty = true; } });
    if (!normObj(o.who)) { o.who = { f: {} }; dirty = true; } else if (!normObj(o.who.f)) { o.who.f = {}; dirty = true; }
    if (!normObj(o.relate)) { o.relate = { f: {}, notes: [] }; dirty = true; }
    else { if (!normObj(o.relate.f)) { o.relate.f = {}; dirty = true; } if (!Array.isArray(o.relate.notes)) { o.relate.notes = []; dirty = true; } }
    if (!normObj(o.pos)) { o.pos = { usual: '', often: '', special: '' }; dirty = true; }
    else ['usual', 'often', 'special'].forEach(k => { if (typeof o.pos[k] !== 'string') { o.pos[k] = ''; dirty = true; } });
    if (!normObj(o.ifw)) { o.ifw = { world: '', mine: '', role: '', rel: '' }; dirty = true; }
    else ['world', 'mine', 'role', 'rel'].forEach(k => { if (typeof o.ifw[k] !== 'string') { o.ifw[k] = ''; dirty = true; } });
    // 旧了解卡惰性规范化：补 src（来源）与 dots（了解程度），原字段一律保留
    (o.loves || []).forEach(it => {
      if (!it) return;
      if (!it.src) { it.src = (String(it.level) === '2') ? 'confirmed' : 'seen'; dirty = true; }
      if (it.dots == null) { it.dots = (String(it.level) === '2') ? 5 : (String(it.level) === '1' ? 3 : 2); dirty = true; }
    });
    if (dirty) saveArc(id, o);
    return o;
  }
  function curId() { try { return gStore().get('narc-cur') || ''; } catch (e) { return ''; } }
  function setCur(id) { try { gStore().set('narc-cur', id); } catch (e) {} }

  // ---- 默认播种：全局还没有任何真身梦角时，把当前桌面的联系人（TA）先落成真身 ----
  // 与 cjian.js seedIfEmpty 同源同键：取 lbl-partner → 联系人名 → 'TA'；写该桌面
  // cjian-roster 并落 cjian-seeded 标记——用户之后删光梦角不会复活（标记已存在）。
  function seedDefaultRoster() {
    try {
      if (roster().some(x => !x.virtual)) return; // 已有真身，不播种
      let cid = 'default';
      try {
        const m = String(window.activePrefix ? window.activePrefix() : '').match(/xy-home-v2:([^:]+)$/);
        if (m) cid = m[1];
      } catch (e) {}
      materializeDesk(cid);
    } catch (e) {}
  }

  // ---- 页面状态 ----
  let cur = '';
  let view = 'home';           // home|who|tastes|habits|relate|knows|pos|things|dream|voice|shared|ifw|search
  let searchQ = '';
  const tab = { tastes: 'like', habits: 'daily', things: 'use', shared: 'first', knows: 'cards' };

  // ---- 打开/关闭 ----
  const VALID_VIEWS = ['home', 'who', 'tastes', 'habits', 'relate', 'knows', 'pos', 'things', 'dream', 'voice', 'shared', 'ifw', 'search'];
  window.openNarc = function (view0) {
    syncCur();
    if (!page || !root) return;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    page.hidden = false;
    view = (view0 && VALID_VIEWS.indexOf(view0) >= 0) ? view0 : 'home';
    tab.tastes = 'like'; tab.habits = 'daily'; tab.things = 'use'; tab.shared = 'first'; tab.knows = 'cards';
    searchQ = '';
    render();
  };
  // 我的档案桥接入口：直接打开当前梦角的「我们的共同记录」（无梦角时回总览给引导）
  window.openNarcShared = function () {
    syncCur();
    if (!roster().length) { window.openNarc(); return; }
    window.openNarc('shared');
  };
  window.closeNarc = function () {
    if (!page) return;
    page.classList.remove('full');
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const home = document.getElementById('page-phone');
    if (home) home.hidden = false;
  };
  function syncCur() {
    seedDefaultRoster(); // 全局还没有真身时，把当前桌面联系人种为第一个梦角（与 cjian.seedIfEmpty 同键同标记）
    const real = roster().filter(x => !x.virtual); // 虚拟 chip 只作入口展示，不参与选中
    if (!real.length) { cur = ''; return; }
    const c = curId();
    cur = real.some(x => x.id === c) ? c : real[0].id;
    setCur(cur);
  }

  // ---- 渲染主入口 ----
  function render() {
    if (!root) return;
    syncCur();
    const r = roster();
    let h = '';
    h += '<div class="narc-chips">';
    r.forEach(c => {
      h += '<button class="narc-chip' + (!c.virtual && c.id === cur ? ' on' : '') + '" data-op="pick-roster" data-rid="' + esc(c.id) + '" data-cid="' + esc(c.cid || '') + '">' + esc(c.name) + '</button>';
    });
    h += '<button class="narc-chip narc-addchip" data-op="add-roster">＋ 添加</button>';
    h += '</div>';
    if (!cur) {
      // #611：提醒名单来源——梦角是跟着桌面联系人自动建档的，不是这里必须手动建的
      h += '<div class="narc-empty">还没有可以写档案的梦角<br>梦角会跟着桌面联系人自动建档，也可以在下方手动添一位';
      h += '<br><button class="ne-btn" data-op="add-roster">添加梦角</button></div>';
      root.innerHTML = h;
      return;
    }
    const arc = ensureArc(cur); // created 初始化在这：打开即开始计相处天数
    h += (view === 'home') ? overviewHTML(arc, r) : sectionHTML(arc, r);
    root.innerHTML = h;
  }
  function activeLovesOf(arc) { return arc.loves.filter(x => x.status !== 'retired'); }
  function filledN(m, keys) { return keys.filter(k => String(m[k] || '').trim()).length; }

  // ---- 总览：英雄区 + 分区菜单 ----
  function overviewHTML(arc, r) {
    const rosterName = (r.find(x => x.id === cur) || {}).name || 'TA';
    const days = Math.max(0, Math.floor((Date.now() - arc.created) / 86400000));
    const activeLoves = activeLovesOf(arc);
    const sharedN = arc.bonds.length + arc.moments.length + arc.records.length;
    const wondersOpen = arc.wonders.filter(w => !w.solved).length;
    let recent = null;
    activeLoves.forEach(x => { if (!recent || x.updated > recent.updated) recent = x; });

    let h = '<div class="narc-hero">';
    h += '<div class="narc-hero-top"><span class="narc-name">' + esc(rosterName) + '</span><span class="narc-days">一起留下 · ' + days + ' 天</span></div>';
    h += '<div class="narc-hero-sub">「我对TA的了解」不是TA的全部，是我和TA相处以后、慢慢知道的事。</div>';
    h += '<div class="narc-stats">';
    h += '<div class="narc-stat"><b>' + activeLoves.length + '</b><span>了解</span></div>';
    h += '<div class="narc-stat"><b>' + sharedN + '</b><span>共同记录</span></div>';
    h += '<div class="narc-stat"><b>' + arc.moments.length + '</b><span>重要时刻</span></div>';
    h += '<div class="narc-stat"><b>' + wondersOpen + '</b><span>还不了解</span></div>';
    h += '</div>';
    if (recent) {
      h += '<div class="narc-recent"><b>最近发现</b>　' + esc(typeLabel(recent.type)) + '……' + esc(short(recent.text, 26));
      h += '<span class="nr-date">' + mdstr(recent.updated) + '</span></div>';
    }
    h += '</div>';
    h += menuHTML(arc);
    h += '<div class="narc-tools"><button class="narc-tool" data-op="search-open">🔍 搜索档案</button><button class="narc-tool" data-op="export">📋 复制整份档案</button></div>';
    return h;
  }

  function menuHTML(arc) {
    const whoFilled = WHO_GROUPS.reduce((n, g) => n + g.fields.filter(f => String(arc.who.f[f[0]] || '').trim()).length, 0);
    const relFilled = RELATE_FIELDS.filter(f => String(arc.relate.f[f[0]] || '').trim()).length + arc.relate.notes.length;
    const posFilled = filledN(arc.pos, ['usual', 'often', 'special']);
    const ifwFilled = IFW_FIELDS.filter(f => String(arc.ifw[f[0]] || '').trim()).length + arc.ifchanges.length;
    const wondersOpen = arc.wonders.filter(w => !w.solved).length;
    const rows = [
      ['who', 'TA是谁', '基本资料 · 世界设定 · 存在方式', whoFilled],
      ['tastes', 'TA的喜好', '喜欢 / 不喜欢 / 偏好', arc.tastes.length],
      ['habits', 'TA的习惯', '日常 · 小动作 · 表达 · 陪伴', arc.habits.length],
      ['relate', 'TA与我的相处', '称呼 · 态度 · 亲密 · 陪伴的方式', relFilled],
      ['knows', '我对TA的了解', '发现 ' + activeLovesOf(arc).length + ' · 未解 ' + wondersOpen, activeLovesOf(arc).length, true],
      ['pos', 'TA的位置感', 'TA常出现的位置与方位', posFilled],
      ['things', 'TA的物品', '常用 · 喜欢 · 互赠 · 共有', arc.things.length],
      ['dream', 'TA的梦境', 'TA做过的、愿意让你知道的梦', arc.dreams.length],
      ['voice', 'TA的声音', 'TA说过的话——原话记下来', arc.quotes.length],
      ['shared', '我们的共同记录', '第一次 · 共同经历 · 时间线', arc.bonds.length + arc.moments.length + arc.records.length],
      ['ifw', '当前IF世界', 'TA在这个世界里的身份与变化', ifwFilled]
    ];
    let h = '<div class="narc-menu">';
    rows.forEach(row => {
      h += '<button class="narc-mrow" data-op="nav" data-view="' + row[0] + '">';
      h += '<span class="nm-main"><span class="nm-title">' + esc(row[1]) + (row[4] ? '<i class="nm-core">核心</i>' : '') + '</span>';
      h += '<span class="nm-desc">' + esc(row[2]) + '</span></span>';
      h += (row[3] > 0 ? '<span class="nm-count">' + row[3] + '</span>' : '');
      h += '<span class="nm-arrow">›</span></button>';
    });
    h += '</div>';
    return h;
  }

  // ---- 分区详情壳 ----
  function backHomeRow() {
    return '<div class="narc-backrow"><button class="narc-backhome" data-op="nav" data-view="home">‹ 返回总览</button></div>';
  }
  function sectHead(title, sub, addBtnHtml) {
    let h = '<div class="narc-sect"><div><h3>' + esc(title) + '</h3>' + (sub ? '<div class="narc-sect-sub">' + esc(sub) + '</div>' : '') + '</div>';
    h += '<span class="narc-sect-btns">' + (addBtnHtml || '') + '<button class="narc-copy" data-op="export-sect">复制</button></span>';
    h += '</div>';
    return h;
  }
  function fieldRowsHTML(mapObj, fields, mapName) {
    let h = '<div class="narc-fields">';
    fields.forEach(f => {
      const val = String(mapObj[f[0]] == null ? '' : mapObj[f[0]]);
      const empty = !val.trim();
      h += '<button class="narc-frow" data-op="efield" data-map="' + mapName + '" data-key="' + f[0] + '">';
      h += '<span class="nf-label">' + esc(f[1]) + '</span>';
      h += '<span class="nf-val' + (empty ? ' empty' : '') + '">' + (empty ? esc(f[2]) : esc(val)) + '</span>';
      h += '<span class="nf-edit">›</span></button>';
    });
    h += '</div>';
    return h;
  }
  function tabsHTML(tabs, curVal, viewKey) {
    let h = '<div class="narc-btabs">';
    tabs.forEach(t => { h += '<button class="narc-btab' + (curVal === t[0] ? ' on' : '') + '" data-op="stab" data-view="' + viewKey + '" data-tab="' + t[0] + '">' + esc(t[1]) + '</button>'; });
    if (viewKey !== 'knows') h += '<button class="narc-btab narc-tabmg" data-op="mgtab" data-group="' + viewKey + '">管理</button>';
    h += '</div>';
    return h;
  }
  function itemShell(inner, metaHtml) {
    return '<div class="narc-item">' + inner + '<div class="ni-meta">' + (metaHtml || '') + '</div></div>';
  }
  function opBtn(op, label, attrs, warn) {
    return '<button class="nk-op' + (warn ? ' warn' : '') + '" data-op="' + op + '"' + (attrs || '') + '>' + label + '</button>';
  }
  function sectionHTML(arc, r) {
    const SECS = {
      who: ['TA是谁', '对应「关于我」——这里记的是TA。'], tastes: ['TA的喜好', '喜欢什么、不喜欢什么、以及那些说不清的偏好。'],
      habits: ['TA的习惯', '相处久了才会注意到的部分。'], relate: ['TA与我的相处', '我的档案记「我希望怎么相处」，这里记「TA实际上怎么和我相处」。'],
      knows: ['我对TA的了解', '不是系统告诉你的设定，是你一点点发现的TA。'], pos: ['TA的位置感', '不是固定坐标，是「我感觉TA常在哪边」。'],
      things: ['TA的物品', '和TA有关的物件，也是记忆的一部分。'], dream: ['TA的梦境', 'TA做过的梦——有时候梦比话更真实。'],
      voice: ['TA的声音', 'TA说过的原话——语气和用词，都是TA的一部分。'],
      shared: ['我们的共同记录', '只记录「我们」共同发生的事——这是两个人的档案。'],
      ifw: ['当前IF世界', '世界母档在【我的档案·IF世界】；这里只写TA在这一侧的样子。'],
      search: ['搜索档案', '在TA的全部档案里找一句话。']
    };
    const meta = SECS[view] || SECS.who;
    let h = backHomeRow();
    h += sectHead(meta[0], meta[1], null);
    if (view === 'who') h += whoHTML(arc);
    else if (view === 'tastes') h += tastesHTML(arc);
    else if (view === 'habits') h += habitsHTML(arc);
    else if (view === 'relate') h += relateHTML(arc);
    else if (view === 'knows') h += knowsHTML(arc);
    else if (view === 'pos') h += posHTML(arc);
    else if (view === 'things') h += thingsHTML(arc);
    else if (view === 'dream') h += dreamHTML(arc);
    else if (view === 'voice') h += voiceHTML(arc);
    else if (view === 'shared') h += sharedHTML(arc);
    else if (view === 'ifw') h += ifwHTML(arc);
    else if (view === 'search') h += searchHTML(arc);
    return h;
  }

  // ---- 1. TA是谁 ----
  function whoHTML(arc) {
    let h = '';
    WHO_GROUPS.forEach(g => {
      h += '<div class="narc-ghead">' + esc(g.name) + (g.sub ? '<span class="narc-gsub">' + esc(g.sub) + '</span>' : '') + '</div>';
      h += fieldRowsHTML(arc.who.f, g.fields, 'who');
    });
    return h;
  }

  // ---- 2. TA的喜好 ----
  function tastesHTML(arc) {
    let h = tabsHTML(tabsOf('tastes', arc), tab.tastes, 'tastes');
    const curLabel = (tabsOf('tastes', arc).find(t => t[0] === tab.tastes) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="taste">＋ 记一条</button>');
    const items = arc.tastes.filter(x => x.g === tab.tastes).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      const tip = tab.tastes === 'like' ? 'TA喜欢什么呢？<br>从最确定的一件开始记吧。' : (tab.tastes === 'dislike' ? 'TA不喜欢什么呢？<br>同样自由地记录。' : '例如：喜欢安静的地方。<br>比起热闹，更喜欢两个人待着。');
      return h + '<div class="narc-empty">' + tip + '</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top">' + (it.cat ? '<span class="ni-cat">' + esc(it.cat) + '</span>' : '') + '</div><div class="ni-text">' + esc(it.t) + '</div>' + imgHTML(it);
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('img-li', it.img ? '换图' : '配图', ' data-kind="taste" data-id="' + it.id + '"') + opBtn('edit-li', '编辑', ' data-kind="taste" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="taste" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 3. TA的习惯 ----
  function habitsHTML(arc) {
    let h = tabsHTML(tabsOf('habits', arc), tab.habits, 'habits');
    const curLabel = (tabsOf('habits', arc).find(t => t[0] === tab.habits) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="habit">＋ 记一条</button>');
    const items = arc.habits.filter(x => x.g === tab.habits).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      const tips = { daily: '通常什么时候出现？喜欢待在哪里？<br>独处的时候、无聊的时候会做什么？', micro: '想事情的时候会沉默、靠近的时候不马上说话……<br>这种小动作最容易拼出真实的TA。', expr: 'TA习惯怎么表达？直接说出口，还是绕个弯？', comp: 'TA是怎么陪你的？' };
      return h + '<div class="narc-empty">' + (tips[tab.habits] || '') + '</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>' + imgHTML(it);
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('img-li', it.img ? '换图' : '配图', ' data-kind="habit" data-id="' + it.id + '"') + opBtn('edit-li', '编辑', ' data-kind="habit" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="habit" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 4. TA与我的相处 ----
  function relateHTML(arc) {
    let h = fieldRowsHTML(arc.relate.f, RELATE_FIELDS, 'relate');
    h += '<div class="narc-ghead">相处里的瞬间<span class="narc-gsub">那些说不进分类里的小事</span></div>';
    h += '<div style="margin:0 2px 10px;text-align:right"><button class="narc-add" data-op="add-li" data-kind="rnote">＋ 记一件小事</button></div>';
    if (!arc.relate.notes.length) h += '<div class="narc-empty">例如：TA不一定会直接说喜欢，但是会待在我旁边。</div>';
    arc.relate.notes.slice().sort((a, b) => b.created - a.created).forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="rnote" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="rnote" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }
  // ---- 5. 我对TA的了解（核心） ----
  function knowsHTML(arc) {
    const KT = [['cards', '发现卡片'], ['wonders', '还不了解'], ['changes', '理解变化']];
    let h = tabsHTML(KT, tab.knows, 'knows');
    if (tab.knows === 'cards') return h + cardsHTML(arc);
    if (tab.knows === 'wonders') return h + wondersHTML(arc);
    return h + changesHTML(arc);
  }

  function cardsHTML(arc) {
    let h = sectHead('我发现…', '每一条都是你自己的发现——不必全是事实，感觉也算数。', '<button class="narc-add" data-op="add-know">＋ 记录新的发现</button>');
    const items = arc.loves.slice().sort((a, b) => b.created - a.created);
    if (!items.length) return h + '<div class="narc-empty">还没有发现卡片。<br>从今天的一个小观察开始：TA今天做了什么？</div>';
    items.forEach(it => {
      const retired = it.status === 'retired';
      h += '<div class="narc-k' + (retired ? ' retired' : '') + '">';
      h += '<div class="nk-top"><span class="nk-type">' + esc(typeLabel(it.type)) + '……</span>';
      h += '<span class="nk-src">' + esc(SRC_MAP[it.src] || '我观察到的') + '</span>';
      h += '<span class="nk-dots">' + dotsStr(it.dots) + '</span>';
      h += '</div>';
      h += '<div class="nk-text">' + esc(it.text) + '</div>';
      const note = (it.note != null && String(it.note).trim()) ? it.note : (it.why || '');
      if (note) h += '<div class="nk-why">' + esc(note) + '</div>';
      h += '<div class="nk-meta"><span class="nk-date">' + (retired ? '' : '记录于 ' + mdstr(it.updated || it.created)) + '</span>';
      h += '<span class="nk-ops">';
      if (retired) {
        h += opBtn('restore-know', '恢复适用', ' data-id="' + it.id + '"') + opBtn('del-know', '删除', ' data-id="' + it.id + '"', 1);
      } else {
        h += opBtn('edit-know', '编辑', ' data-id="' + it.id + '"') + opBtn('revise-know', '重新理解', ' data-id="' + it.id + '"') + opBtn('retire-know', '暂不适用', ' data-id="' + it.id + '"') + opBtn('del-know', '删除', ' data-id="' + it.id + '"', 1);
      }
      h += '</span></div></div>';
    });
    return h;
  }

  // 还不了解（沿用旧数据 wonders）
  function wondersHTML(arc) {
    let h = sectHead('我还不了解TA的地方', '档案里的留白——留给未来的你们。', '<button class="narc-add" data-op="add-wonder">＋ 记一个想了解的事</button>');
    const open = arc.wonders.filter(w => !w.solved);
    const solved = arc.wonders.filter(w => w.solved);
    if (!open.length && !solved.length) {
      return h + '<div class="narc-empty">不要急着把TA研究透。<br>把正想知道、还没答案的问题留在这里。</div>';
    }
    open.forEach(w => {
      const inner = '<div class="ni-top"><span class="ni-tag">还不了解</span></div><div class="ni-text">' + esc(w.text) + '</div>';
      h += itemShell(inner, '<span class="ni-date">' + mdstr(w.created) + '</span><span class="nk-ops">' + opBtn('solve-wonder', '已了解', ' data-id="' + w.id + '"') + opBtn('del-wonder', '删除', ' data-id="' + w.id + '"', 1) + '</span>');
    });
    if (solved.length) {
      h += '<div class="narc-sect" style="margin-top:16px"><h3 style="opacity:.7">已解开的疑问</h3></div>';
      solved.forEach(w => {
        const inner = '<div class="ni-top"><span class="ni-tag">已了解</span></div><div class="ni-text">' + esc(w.text) + '</div>';
        h += '<div class="narc-item solved">' + inner + '<div class="ni-meta"><span class="ni-date">' + (w.solvedAt ? mdstr(w.solvedAt) + ' 有了答案' : '') + '</span><span class="nk-ops">' + opBtn('reopen-wonder', '重新打开', ' data-id="' + w.id + '"') + opBtn('del-wonder', '删除', ' data-id="' + w.id + '"', 1) + '</span></div></div>';
      });
    }
    return h;
  }

  // 理解变化（沿用旧数据 history）
  function changesHTML(arc) {
    const hist = arc.history.slice().sort((a, b) => b.time - a.time);
    if (!hist.length) {
      return '<div class="narc-empty">还没有理解上的变化。<br>当有一天你发现自己——「原来TA不是我以为的那样」——它会出现在这里。</div>';
    }
    let h = '';
    hist.forEach(ev => {
      h += '<div class="narc-hist"><span class="nh-dot"></span><div class="nh-wrap"><div class="nh-date">' + mdstr(ev.time) + '</div><div class="nh-text">' + String(ev.text || '').replace(/〈([^〈]*)〉/g, '<em>「$1」</em>') + '</div></div></div>';
    });
    return h;
  }

  // ---- 6. TA的位置感 ----
  function posHTML(arc) { return fieldRowsHTML(arc.pos, POS_FIELDS, 'pos'); }

  // ---- 7. TA的物品 ----
  function thingsHTML(arc) {
    let h = tabsHTML(tabsOf('things', arc), tab.things, 'things');
    const curLabel = (tabsOf('things', arc).find(t => t[0] === tab.things) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="thing">＋ 记一件</button>');
    const items = arc.things.filter(x => x.g === tab.things).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      return h + '<div class="narc-empty">TA常用的东西、TA送你的东西、你们共有的东西……<br>都可以记在这里。</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>' + imgHTML(it);
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('img-li', it.img ? '换图' : '配图', ' data-kind="thing" data-id="' + it.id + '"') + opBtn('edit-li', '编辑', ' data-kind="thing" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="thing" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }
  // ---- 8. TA的梦境 ----
  function dreamHTML(arc) {
    let h = sectHead('TA的梦境', 'TA做过的梦——有时候梦比话更真实。', '<button class="narc-add" data-op="add-dream">＋ 记一个梦</button>');
    const items = arc.dreams.slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      return h + '<div class="narc-empty">TA说过的、被你记住的那些梦。<br>梦见你了吗？梦里有你吗？</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.text) + '</div>' + imgHTML(it);
      h += itemShell(inner, '<span class="ni-date">' + esc(it.date) + '</span><span class="nk-ops">'
        + opBtn('img-li', it.img ? '换图' : '配图', ' data-kind="dream" data-id="' + it.id + '"')
        + opBtn('know-from-dream', '记为了解', ' data-id="' + it.id + '"')
        + opBtn('edit-dream', '编辑', ' data-id="' + it.id + '"')
        + opBtn('del-dream', '删除', ' data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }
  // ---- 8.5 TA的声音（v3.27.x 新增）----
  function voiceHTML(arc) {
    let h = sectHead('TA说过的话', '原话记下来——语气、用词、停顿，都是TA的一部分。', '<button class="narc-add" data-op="add-quote">＋ 记一句话</button>');
    const items = arc.quotes.slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      return h + '<div class="narc-empty">TA的口头禅、某次认真说过的话、<br>让你记到现在的语气……都值得原样留住。</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top">' + (it.scene ? '<span class="ni-tag">' + esc(it.scene) + '</span>' : '') + '</div>'
        + '<div class="ni-text ni-quote">「' + esc(it.text) + '」</div>' + imgHTML(it);
      h += itemShell(inner, '<span class="ni-date">' + esc(it.date) + '</span><span class="nk-ops">'
        + opBtn('img-li', it.img ? '换图' : '配图', ' data-kind="quote" data-id="' + it.id + '"')
        + opBtn('know-from-quote', '记为了解', ' data-id="' + it.id + '"')
        + opBtn('edit-quote', '编辑', ' data-id="' + it.id + '"')
        + opBtn('del-quote', '删除', ' data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }
  // ---- 9. 我们的共同记录（沿用 bonds/moments/records，新增 day/thing/place 分类与时间线） ----
  // v3.27.x：时间线并入 梦境/发现/理解变化/语录，按时间倒序连成完整的一条线
  function timelineItems(arc) {
    const arr = [];
    arc.bonds.forEach(b => arr.push({ t: b.created, text: b.text, date: b.date || '', tag: BOND_CATS[b.cat] || '共同经历', kind: 'bond', id: b.id }));
    arc.moments.forEach(m => arr.push({ t: m.created, text: m.text, date: m.date || '', tag: '重要时刻', star: true, kind: 'moment', id: m.id }));
    arc.records.forEach(rc => arr.push({ t: rc.created, text: rc.text, date: rc.date || '', tag: '相处记录', kind: 'record', id: rc.id, momentId: rc.momentId }));
    arc.dreams.forEach(d => arr.push({ t: d.created, text: d.text, date: d.date || '', tag: '梦境', kind: 'dream', id: d.id }));
    arc.quotes.forEach(q => arr.push({ t: q.created, text: '「' + q.text + '」', date: q.date || '', tag: 'TA的声音', kind: 'quote', id: q.id }));
    arc.loves.forEach(l => { if (l.status !== 'retired') arr.push({ t: l.created, text: typeLabel(l.type) + '……' + l.text, date: '', tag: '发现', kind: 'love', id: l.id }); });
    arc.history.forEach(ev => arr.push({ t: ev.time, text: ev.text || '', date: '', tag: '理解变化', kind: 'hist', id: '' }));
    return arr.sort((a, b) => b.t - a.t);
  }
  function sharedHTML(arc) {
    const shTabs = [['timeline', '时间线']].concat(tabsOf('shared', arc));
    let h = tabsHTML(shTabs, tab.shared, 'shared');
    if (tab.shared === 'timeline') {
      h += sectHead('我们的时间线', '第一次、共同经历、特别的日子，都在这里连成一条线。', '<button class="narc-add" data-op="add-record">＋ 写一条相处</button>');
      const arr = timelineItems(arc);
      if (!arr.length) return h + '<div class="narc-empty">还没有共同记录。<br>第一次见面、第一次聊天、第一次被TA主动找……都值得记下来。</div>';
      arr.forEach(x => {
        let inner = '<div class="ni-top">';
        if (x.kind === 'record') {
          inner += '<button class="ni-star' + (x.momentId ? ' on' : '') + '" data-op="toggle-moment" data-kind="record" data-id="' + x.id + '" title="记为重要时刻">⭐</button>';
        } else if (x.star) {
          inner += '<span class="ni-star on">⭐</span>';
        }
        inner += '<span class="ni-tag">' + esc(x.tag) + '</span></div>';
        inner += '<div class="ni-text">' + esc(x.text) + '</div>';
        let ops = '';
        if (x.kind === 'bond' || x.kind === 'record' || x.kind === 'moment') {
          ops = '<span class="nk-ops">' + opBtn('edit-entry', '编辑', ' data-kind="' + x.kind + '" data-id="' + x.id + '"') + opBtn('del-entry', '删除', ' data-kind="' + x.kind + '" data-id="' + x.id + '"', 1) + '</span>';
        }
        h += itemShell(inner, '<span class="ni-date">' + esc(x.date) + '</span>' + ops);
      });
      return h;
    }
    const catLabel = (tabsOf('shared', arc).find(t => t[0] === tab.shared) || [])[1] || BOND_CATS[tab.shared] || '';
    const isBuiltinCat = !!BOND_CATS[tab.shared];
    h += sectHead(catLabel, '', '<button class="narc-add" data-op="add-bond" data-cat="' + tab.shared + '">＋ 记一条「' + esc(catLabel) + '」</button>');
    const items = arc.bonds.filter(b => b.cat === tab.shared).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (!items.length) {
      const tips = { first: '第一次见面、第一次聊天、第一次被TA主动找、第一次一起玩游戏……', habit: '你们之间自然形成的共同习惯。', secret: '只有我们知道的事。', day: '值得标记的日子。', thing: '有故事的物件。', place: '有回忆的地方。' };
      return h + '<div class="narc-empty">' + esc(tips[tab.shared] || '这个分类下还没有记录。') + '<br>点上面「＋」记下来。</div>';
    }
    items.forEach(b => {
      const inner = '<div class="ni-top"><span class="ni-tag">' + esc(catLabel) + '</span></div><div class="ni-text">' + esc(b.text) + '</div>' + imgHTML(b);
      h += itemShell(inner, '<span class="ni-date">' + esc(b.date || '') + '</span><span class="nk-ops">'
        + opBtn('img-li', b.img ? '换图' : '配图', ' data-kind="bond" data-id="' + b.id + '"')
        + opBtn('edit-entry', '编辑', ' data-kind="bond" data-id="' + b.id + '"')
        + opBtn('del-entry', '删除', ' data-kind="bond" data-id="' + b.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 10. 当前IF世界 ----
  function ifwHTML(arc) {
    let h = fieldRowsHTML(arc.ifw, IFW_FIELDS, 'ifw');
    h += '<div class="narc-ghead">TA在这个世界的变化<span class="narc-gsub">例如：在这个世界TA可以被看见 / 住在我家隔壁</span></div>';
    h += '<div style="margin:0 2px 10px;text-align:right"><button class="narc-add" data-op="add-li" data-kind="ifch">＋ 记一条变化</button></div>';
    if (!arc.ifchanges.length) h += '<div class="narc-empty">换到IF世界后，TA有什么不一样？</div>';
    arc.ifchanges.slice().sort((a, b) => b.created - a.created).forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="ifch" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="ifch" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 配图（v3.27.x）：条目可选一张小图，压到 640px/JPEG 存 dataURL，老数据无 img 字段天然兼容 ----
  function imgHTML(it) { return (it && it.img) ? '<img class="ni-img" src="' + it.img + '" alt="">': ''; }
  function imgListOf(kind, arc) {
    if (kind === 'taste') return arc.tastes;
    if (kind === 'habit') return arc.habits;
    if (kind === 'thing') return arc.things;
    if (kind === 'bond') return arc.bonds;
    if (kind === 'record') return arc.records;
    if (kind === 'dream') return arc.dreams;
    return arc.quotes;
  }
  let imgTarget = null;
  function pickImg(kind, id) {
    if (!window.openModal) return;
    const arc = ensureArc(cur);
    const it = imgListOf(kind, arc).find(x => x.id === id);
    if (it && it.img) {
      window.openModal('这条已配图', '', function (v) {
        if (v === 'del') { delete it.img; saveArc(cur, arc); toast('已移除配图'); render(); }
        else if (v === 'new') { imgTarget = { kind: kind, id: id }; ensureImgInput().click(); }
      }, { noInput: true, pill: 'new', pills: [{ label: '换一张', value: 'new' }, { label: '移除配图', value: 'del' }] });
      return;
    }
    imgTarget = { kind: kind, id: id };
    ensureImgInput().click();
  }
  function ensureImgInput() {
    let inp = document.getElementById('narc-img-input');
    if (inp) return inp;
    inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none'; inp.id = 'narc-img-input';
    inp.addEventListener('change', function () {
      const f = inp.files && inp.files[0];
      const tgt = imgTarget; imgTarget = null; inp.value = '';
      if (!f || !tgt || !tgt.id) return;
      compressImg(f, function (dataURL) {
        const arc = ensureArc(cur);
        const it = imgListOf(tgt.kind, arc).find(x => x.id === tgt.id);
        if (!it) return;
        it.img = dataURL; saveArc(cur, arc); toast('已配上图'); render();
      });
    });
    document.body.appendChild(inp);
    return inp;
  }
  function compressImg(file, cb) {
    const fr = new FileReader();
    fr.onload = function () {
      const im = new Image();
      im.onload = function () {
        const M = 640; let w = im.width, ih = im.height;
        if (w > M || ih > M) { const r = Math.min(M / w, M / ih); w = Math.round(w * r); ih = Math.round(ih * r); }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = ih;
        cv.getContext('2d').drawImage(im, 0, 0, w, ih);
        cb(cv.toDataURL('image/jpeg', 0.72));
      };
      im.onerror = function () { toast('这张图读不出来，换一张试试'); };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  // ---- 搜索（v3.27.x）：跨分区全文过滤，点结果跳对应分区 ----
  function tabLabelOf(group, arc, id) { const t = tabsOf(group, arc).find(t2 => t2[0] === id); return t ? t[1] : ''; }
  function searchScan(arc) {
    const out = [];
    const pushF = (fields, m, viewName) => fields.forEach(f => {
      const v = String(m[f[0]] == null ? '' : m[f[0]]);
      if (v.trim()) out.push({ view: viewName, tab: '', head: f[1], text: v });
    });
    WHO_GROUPS.forEach(g => pushF(g.fields, arc.who.f, 'who'));
    pushF(RELATE_FIELDS, arc.relate.f, 'relate');
    pushF(POS_FIELDS, arc.pos, 'pos');
    pushF(IFW_FIELDS, arc.ifw, 'ifw');
    arc.tastes.forEach(it => out.push({ view: 'tastes', tab: it.g, head: 'TA的喜好', text: it.t }));
    arc.habits.forEach(it => out.push({ view: 'habits', tab: it.g, head: 'TA的习惯', text: it.t }));
    arc.things.forEach(it => out.push({ view: 'things', tab: it.g, head: 'TA的物品', text: it.t }));
    arc.relate.notes.forEach(it => out.push({ view: 'relate', tab: '', head: '相处里的瞬间', text: it.t }));
    activeLovesOf(arc).forEach(it => out.push({ view: 'knows', tab: 'cards', head: typeLabel(it.type), text: it.text + (it.note ? '　' + it.note : '') }));
    arc.wonders.forEach(w => out.push({ view: 'knows', tab: 'wonders', head: '还不了解', text: w.text }));
    arc.history.forEach(ev => out.push({ view: 'knows', tab: 'changes', head: '理解变化', text: ev.text || '' }));
    arc.dreams.forEach(it => out.push({ view: 'dream', tab: '', head: 'TA的梦境', text: it.text }));
    arc.quotes.forEach(it => out.push({ view: 'voice', tab: '', head: 'TA的声音', text: it.text + (it.scene ? '　' + it.scene : '') }));
    arc.bonds.forEach(b => out.push({ view: 'shared', tab: b.cat, head: BOND_CATS[b.cat] || tabLabelOf('shared', arc, b.cat) || '共同记录', text: b.text }));
    arc.moments.forEach(m => out.push({ view: 'shared', tab: 'timeline', head: '重要时刻', text: m.text }));
    arc.records.forEach(rc => out.push({ view: 'shared', tab: 'timeline', head: '相处记录', text: rc.text }));
    arc.ifchanges.forEach(it => out.push({ view: 'ifw', tab: '', head: 'IF世界的变化', text: it.t }));
    return out;
  }
  function searchHTML(arc) {
    let h = '<div class="narc-search"><input id="narc-q" class="narc-q" value="' + esc(searchQ) + '" placeholder="搜：喜欢、梦、第一次……" maxlength="40"></div>';
    h += '<div id="narc-results">' + searchResultsHTML(arc) + '</div>';
    return h;
  }
  function searchResultsHTML(arc) {
    const q = searchQ.trim().toLowerCase();
    if (!q) return '<div class="narc-empty">输入关键词，找TA档案里的任何一句话。</div>';
    const hits = searchScan(arc).filter(x => (x.text + ' ' + x.head).toLowerCase().indexOf(q) >= 0);
    if (!hits.length) return '<div class="narc-empty">没有找到含「' + esc(searchQ.trim()) + '」的记录。</div>';
    let h = '';
    hits.slice(0, 80).forEach(x => {
      h += '<button class="narc-sr" data-op="jump" data-view="' + x.view + '" data-tab="' + esc(x.tab || '') + '">';
      h += '<span class="nsr-head">' + esc(x.head) + '</span><span class="nsr-text">' + esc(short(x.text, 60)) + '</span></button>';
    });
    if (hits.length > 80) h += '<div class="narc-hint">还有 ' + (hits.length - 80) + ' 条没显示，换个更具体的关键词试试。</div>';
    return h;
  }

  // ---- 导出/复制（v3.27.x）：整份档案 or 当前分区，纯文本进剪贴板（失败回退 execCommand） ----
  function exportText(arc, sectView) {
    const rosterName = (roster().find(x => x.id === cur) || {}).name || 'TA';
    const days = Math.max(0, Math.floor((Date.now() - arc.created) / 86400000));
    const L = ['〔梦角档案 · ' + rosterName + '〕', '一起留下 · ' + days + ' 天'];
    const blocks = [];
    const add = (vn, head, lines) => { if (lines.length) blocks.push({ vn: vn, head: head, lines: lines }); };
    WHO_GROUPS.forEach(g => add('who', 'TA是谁 · ' + g.name, g.fields.filter(f => String(arc.who.f[f[0]] || '').trim()).map(f => f[1] + '：' + arc.who.f[f[0]])));
    add('tastes', 'TA的喜好', arc.tastes.map(it => (tabLabelOf('tastes', arc, it.g) || '') + (it.cat ? '·' + it.cat + ' ' : '') + it.t));
    add('habits', 'TA的习惯', arc.habits.map(it => (tabLabelOf('habits', arc, it.g) ? '[' + tabLabelOf('habits', arc, it.g) + '] ' : '') + it.t));
    add('relate', 'TA与我的相处', RELATE_FIELDS.filter(f => String(arc.relate.f[f[0]] || '').trim()).map(f => f[1] + '：' + arc.relate.f[f[0]])
      .concat(arc.relate.notes.map(it => '· ' + it.t)));
    add('knows', '我对TA的了解', activeLovesOf(arc).map(it => typeLabel(it.type) + '……' + it.text + '　(' + (SRC_MAP[it.src] || '') + ' ' + dotsStr(it.dots) + ')'));
    add('knows', '还不了解', arc.wonders.filter(w => !w.solved).map(w => '？' + w.text));
    add('knows', '理解变化', arc.history.map(ev => mdstr(ev.time) + ' ' + (ev.text || '')));
    add('pos', 'TA的位置感', POS_FIELDS.filter(f => String(arc.pos[f[0]] || '').trim()).map(f => f[1] + '：' + arc.pos[f[0]]));
    add('things', 'TA的物品', arc.things.map(it => (tabLabelOf('things', arc, it.g) ? '[' + tabLabelOf('things', arc, it.g) + '] ' : '') + it.t));
    add('dream', 'TA的梦境', arc.dreams.map(it => (it.date ? it.date + ' ' : '') + it.text));
    add('voice', 'TA的声音', arc.quotes.map(it => '「' + it.text + '」' + (it.scene ? '　——' + it.scene : '')));
    add('shared', '我们的共同记录', arc.bonds.map(b => (BOND_CATS[b.cat] || tabLabelOf('shared', arc, b.cat) || '共同记录') + '：' + b.text)
      .concat(arc.moments.map(m => '⭐' + m.text))
      .concat(arc.records.map(rc => '· ' + rc.text)));
    add('ifw', '当前IF世界', IFW_FIELDS.filter(f => String(arc.ifw[f[0]] || '').trim()).map(f => f[1] + '：' + arc.ifw[f[0]])
      .concat(arc.ifchanges.map(it => '· ' + it.t)));
    const wantAll = !sectView || sectView === 'home';
    (wantAll ? blocks : blocks.filter(b => b.vn === sectView)).forEach(b => {
      L.push(''); L.push('—— ' + b.head + ' ——');
      b.lines.forEach(t => L.push(t));
    });
    return L.join('\n');
  }
  function doExport(sectView) {
    const text = exportText(ensureArc(cur), sectView);
    if (!text) { toast('这一页还没有可复制的内容'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制，可粘贴保存'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const okc = document.execCommand('copy');
      document.body.removeChild(ta);
      toast(okc ? '已复制，可粘贴保存' : '复制失败，请重试');
    } catch (e) { toast('复制失败，请重试'); }
  }

  // ---- 标签管理（v3.27.x）：自定义标签可增删；内置标签只可隐藏/恢复（数据 g 键不丢锚） ----
  function manageTabs(group) {
    if (!window.openModal || !TAB_GROUP_TITLE[group]) return;
    const arc = ensureArc(cur);
    const customs = arc.tags[group] || [];
    const hides = arc.hide[group] || [];
    const pills = [];
    customs.forEach(t => pills.push({ label: '删除「' + t.label + '」', value: 'del:' + t.id }));
    BUILTIN_TABS[group].forEach(t => {
      if (hides.indexOf(t[0]) >= 0) pills.push({ label: '恢复「' + t[1] + '」', value: 'res:' + t[0] });
      else pills.push({ label: '隐藏「' + t[1] + '」', value: 'hide:' + t[0] });
    });
    pills.push({ label: '＋ 新增标签', value: 'add' });
    window.openModal('管理「' + TAB_GROUP_TITLE[group] + '」的标签', '', function (v) {
      if (!v) return;
      if (v === 'add') {
        const ctl2 = window.openModal('新标签名称', '', function (v2) {
          const label = strim(v2);
          if (!label) { ctl2.stay(); ctl2.focus(); return; }
          const a = ensureArc(cur);
          a.tags[group].push({ id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36), label: label });
          saveArc(cur, a); toast('已添加标签'); render();
        }, { placeholder: '例如：口头禅（最多 8 个字）', maxlength: 8 });
        return;
      }
      const i = v.indexOf(':'), act = v.slice(0, i), arg = v.slice(i + 1);
      const a = ensureArc(cur);
      if (act === 'del') {
        a.tags[group] = a.tags[group].filter(t => t.id !== arg);
        // 残留条目迁到兜底内置 tab，绝不丢数据
        const lists = { tastes: a.tastes, habits: a.habits, things: a.things, shared: a.bonds };
        (lists[group] || []).forEach(it => {
          if (it.g === arg) it.g = FALLBACK_TAB[group];
          if (it.cat === arg) it.cat = FALLBACK_TAB[group];
        });
        if (tab[group] === arg) tab[group] = FALLBACK_TAB[group];
      } else if (act === 'hide') {
        // 至少保留一个可见标签（自定义 + 未隐藏内置），否则拒绝
        const visibleAfter = tabsOf(group, a).filter(t => t[0] !== arg);
        if (!visibleAfter.length) { toast('至少保留一个标签'); return; }
        if (a.hide[group].indexOf(arg) < 0) a.hide[group].push(arg);
        if (tab[group] === arg) {
          if (group === 'shared') tab.shared = 'timeline';
          else tab[group] = visibleAfter[0][0];
        }
      } else if (act === 'res') {
        a.hide[group] = a.hide[group].filter(t => t !== arg);
      }
      saveArc(cur, a); toast('已更新标签'); render();
    }, { noInput: true, pills: pills });
  }

  // ---- 声音流程（v3.27.x）：原话 → 场景（可空）→ 日期 ----
  function addQuote() {
    if (!window.openModal) return;
    let phase = 'text', text = '', scene = '', ctl = null;
    ctl = window.openModal('TA说了什么？', '', function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        text = t; phase = 'scene';
        ctl.stay(); ctl.title('是在什么场景说的？（可选）'); ctl.hint('例如：晚安前 / 第一次视频的时候。');
        ctl.text(''); ctl.maxLen(30); ctl.ph('可留空'); ctl.okText('下一步');
        return;
      }
      if (phase === 'scene') {
        scene = strim(v); phase = 'date';
        ctl.stay(); ctl.title('是哪天说的？'); ctl.hint('留空默认今天。');
        ctl.text(mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        const arc = ensureArc(cur);
        arc.quotes.push({ id: makeId(), text: text, scene: scene, date: strim(v) || mdstr(Date.now()), created: Date.now() });
        saveArc(cur, arc); toast('TA的话记下了'); render();
      }
    }, { placeholder: '原话写这里——TA的原谅、语气和用词都是TA的一部分', maxlength: 200 });
  }
  function editQuote(id) {
    const arc = ensureArc(cur); const it = arc.quotes.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', nt = '', ns = it.scene || '', ctl = null;
    ctl = window.openModal('编辑这句话', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        nt = t; phase = 'scene';
        ctl.stay(); ctl.title('场景（可选）');
        ctl.text(it.scene || ''); ctl.maxLen(30); ctl.ph('可留空'); ctl.okText('下一步');
        return;
      }
      if (phase === 'scene') {
        ns = strim(v); phase = 'date';
        ctl.stay(); ctl.title('是哪天说的？');
        ctl.text(it.date || mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        it.text = nt; it.scene = ns; it.date = strim(v) || mdstr(Date.now());
        saveArc(cur, arc); toast('已更新'); render();
      }
    }, { placeholder: '原话', maxlength: 200 });
  }
  function delQuote(id) {
    if (!window.openModal) return;
    window.openModal('删掉这句话？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      arc.quotes = arc.quotes.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }
  // ---- 联动：梦境 / 语录 一键转成「发现卡片」（prefill 进第一阶段文本框） ----
  function knowFrom(kind, id) {
    const arc = ensureArc(cur);
    const arr = kind === 'dream' ? arc.dreams : arc.quotes;
    const it = arr.find(x => x.id === id);
    if (it && window.openModal) addKnow(it.text);
  }

  // ---- 字段编辑 ----
  function fieldMapOf(mapName, arc) {
    if (mapName === 'who') return arc.who.f;
    if (mapName === 'relate') return arc.relate.f;
    if (mapName === 'pos') return arc.pos;
    return arc.ifw;
  }
  function editField(mapName, key) {
    const def = FIELD_INDEX[key]; if (!def || !window.openModal) return;
    const arc = ensureArc(cur);
    const m = fieldMapOf(mapName, arc);
    window.openModal(def.label, m[key] || '', function (v) {
      m[key] = strim(v);
      saveArc(cur, arc); toast('已记下'); render();
    }, def.multi ? { textarea: true, textareaPlaceholder: def.ph } : { placeholder: def.ph, maxlength: 120 });
  }
  // ---- 列表项（喜好/习惯/物品/瞬间/IF变化） ----
  function listOf(kind, arc) {
    if (kind === 'taste') return arc.tastes;
    if (kind === 'habit') return arc.habits;
    if (kind === 'thing') return arc.things;
    if (kind === 'rnote') return arc.relate.notes;
    return arc.ifchanges;
  }
  function liPh(kind) {
    if (kind === 'taste') return tab.tastes === 'like' ? '例如：布丁 / 雨天的窗边' : (tab.tastes === 'dislike' ? '例如：被催着做决定' : '例如：比起热闹，更喜欢两个人待着。');
    if (kind === 'habit') return HABIT_PH[tab.habits];
    if (kind === 'thing') return THING_PH[tab.things];
    if (kind === 'rnote') return '例如：TA不一定会直接说喜欢，但是会待在我旁边。';
    return '例如：在这个世界TA可以被看见了。';
  }
  function liTitle(kind) {
    if (kind === 'taste') return (TASTE_TABS.find(t => t[0] === tab.tastes) || [])[1] || '';
    if (kind === 'habit') return (HABIT_TABS.find(t => t[0] === tab.habits) || [])[1] || '';
    if (kind === 'thing') return (THING_TABS.find(t => t[0] === tab.things) || [])[1] || '';
    if (kind === 'rnote') return '相处里的一件小事';
    return 'TA在这个世界的变化';
  }
  function addLi(kind) {
    if (!window.openModal) return;
    const useCat = kind === 'taste' && tab.tastes === 'like';
    let cat = '', phase = useCat ? 'cat' : 'text', ctl = null;
    ctl = window.openModal(liTitle(kind), '', function (v) {
      if (phase === 'cat') {
        if (!v) return;
        cat = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]); ctl.title('具体是什么呢？');
        ctl.input(true); ctl.maxLen(100); ctl.ph(liPh(kind)); ctl.okText('保存');
        return;
      }
      const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
      const arc = ensureArc(cur);
      const item = { id: makeId(), t: t, created: Date.now() };
      if (kind === 'taste') { item.g = tab.tastes; item.cat = (tab.tastes === 'like') ? (cat || '其他') : ''; }
      else if (kind === 'habit') item.g = tab.habits;
      else if (kind === 'thing') item.g = tab.things;
      listOf(kind, arc).push(item);
      saveArc(cur, arc); toast('已记下'); render();
    }, useCat ? { noInput: true, pills: LIKE_CATS.map(c => ({ label: c, value: c })) } : { placeholder: liPh(kind), maxlength: 120 });
  }
  function editLi(kind, id) {
    const arc = ensureArc(cur); const it = listOf(kind, arc).find(x => x.id === id); if (!it || !window.openModal) return;
    const reCat = kind === 'taste' && it.g === 'like';
    let phase = reCat ? 'cat' : 'text', newCat = it.cat || '', ctl = null;
    ctl = window.openModal('编辑', it.t, function (v) {
      if (phase === 'cat') {
        if (!v) return;
        newCat = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]); ctl.title('内容');
        ctl.input(true); ctl.text(it.t); ctl.maxLen(120); ctl.ph('内容'); ctl.okText('保存');
        return;
      }
      const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
      it.t = t; if (reCat) it.cat = newCat;
      saveArc(cur, arc); toast('已更新'); render();
    }, reCat ? { noInput: true, pill: it.cat, pills: LIKE_CATS.map(c => ({ label: c, value: c })) } : { placeholder: '内容', maxlength: 120 });
  }
  function delLi(kind, id) {
    if (!window.openModal) return;
    window.openModal('删除这条？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      const arr = listOf(kind, arc);
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr.splice(i, 1);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }
  // ---- 了解卡片（核心）流程 ----
  function addKnow(prefill) {
    if (!window.openModal) return;
    let phase = 'type', pType = '', pText = '', pNote = '', pSrc = 'seen', ctl = null;
    ctl = window.openModal('记录一条新的发现', prefill || '', function (v) {
      if (phase === 'type') {
        if (!v) return;
        pType = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]);
        ctl.title(typeLabel(pType) + '……');
        ctl.hint('写下你的发现，一句话就好。');
        ctl.input(true); ctl.maxLen(140); ctl.ph('例如：喜欢在下雨天待在窗边');
        if (prefill) ctl.text(prefill);
        ctl.okText('下一步');
        return;
      }
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        pText = t; phase = 'note';
        ctl.stay(); ctl.title('我的备注（可选）'); ctl.hint('后来发现的事、当时的场景，都可以补在这里。');
        ctl.text(''); ctl.maxLen(160); ctl.ph('可留空'); ctl.okText('下一步');
        return;
      }
      if (phase === 'note') {
        pNote = strim(v); phase = 'src';
        ctl.stay(); ctl.input(false); ctl.pills(SRC_PILLS, pSrc);
        ctl.title('这条发现是怎么来的？'); ctl.hint('不必都是「事实」——你的感觉也算数。');
        ctl.okText('下一步');
        return;
      }
      if (phase === 'src') {
        if (!v) return;
        pSrc = String(v); phase = 'dots';
        ctl.stay(); ctl.pills(DOT_PILLS, String(SRC_DOT[pSrc] || 3));
        ctl.title('现在有多确定？'); ctl.hint('了解程度不是好感度——只是「我有多大把握」。');
        ctl.okText('保存');
        return;
      }
      if (phase === 'dots') {
        const d = Math.max(1, Math.min(5, parseInt(v, 10) || 3));
        const arc = ensureArc(cur); const now = Date.now();
        arc.loves.push({ id: makeId(), type: pType, text: pText, note: pNote, why: pNote, src: pSrc, dots: d, level: legacyLevelOf(d), created: now, updated: now, status: 'active', revisions: [] });
        arc.history.push({ time: now, text: '「' + typeLabel(pType) + '」新增了解：' + short(pText) });
        saveArc(cur, arc); toast('记下了一条了解'); render();
      }
    }, { noInput: true, pills: KTYPES.map(t => ({ label: t[1], value: t[0] })) });
  }

  function editKnowFlow(id, revise) {
    const arc0 = ensureArc(cur); const it = arc0.loves.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', nt = '', nn = '', ns = it.src || 'seen', nd = (it.dots != null ? it.dots : 3), ctl = null;
    ctl = window.openModal(revise ? '重新理解TA' : '编辑这条了解', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        nt = t; phase = 'note';
        ctl.stay(); ctl.title('我的备注（可选）'); ctl.hint(revise ? '旧的看法会保留在「理解变化」里。' : '改动理解，也可以留一句话理由。');
        ctl.text(it.note != null ? (it.note || '') : (it.why || '')); ctl.maxLen(160); ctl.ph('可留空'); ctl.okText('下一步');
        return;
      }
      if (phase === 'note') {
        nn = strim(v); phase = 'src';
        ctl.stay(); ctl.input(false); ctl.pills(SRC_PILLS, ns);
        ctl.title('这条发现是怎么来的？'); ctl.okText('下一步');
        return;
      }
      if (phase === 'src') {
        if (!v) return;
        ns = String(v); phase = 'dots';
        ctl.stay(); ctl.pills(DOT_PILLS, String(nd));
        ctl.title('现在有多确定？'); ctl.okText('保存');
        return;
      }
      if (phase === 'dots') {
        nd = Math.max(1, Math.min(5, parseInt(v, 10) || nd || 3));
        const arc = ensureArc(cur); const t2 = arc.loves.find(x => x.id === id); if (!t2) return;
        const now = Date.now();
        if (revise) {
          t2.revisions.push({ text: t2.text, why: t2.why || '', note: t2.note || '', level: t2.level, dots: t2.dots, src: t2.src, time: now });
          arc.history.push({ time: now, text: '「' + typeLabel(t2.type) + '」重新理解：〈' + short(t2.text) + '〉→〈' + short(nt) + '〉' });
        } else if (t2.text !== nt) {
          arc.history.push({ time: now, text: '「' + typeLabel(t2.type) + '」修改：〈' + short(t2.text) + '〉→〈' + short(nt) + '〉' });
        }
        t2.text = nt; t2.note = nn; t2.why = nn; t2.src = ns; t2.dots = nd; t2.level = legacyLevelOf(nd);
        t2.updated = now; if (revise) t2.status = 'active';
        saveArc(cur, arc); toast(revise ? '更新了对TA的理解' : '已更新'); render();
      }
    }, { placeholder: '你发现的TA', maxlength: 140 });
  }
  function retireKnow(id) {
    const arc = ensureArc(cur); const it = arc.loves.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'ask', ctl = null;
    ctl = window.openModal('暂不适用这条了解？', '', function (v) {
      if (phase === 'ask') {
        if (v !== 'yes') return;
        phase = 'note';
        ctl.stay(); ctl.title('想留句话吗？（可选）');
        ctl.hint('以后还能回来看，当初为什么暂停。');
        ctl.input(true); ctl.maxLen(120); ctl.ph('可留空'); ctl.okText('确认'); ctl.text('');
        return;
      }
      if (phase === 'note') {
        it.note = strim(v);
        it.status = 'retired'; it.updated = Date.now();
        arc.history.push({ time: it.updated, text: '「' + typeLabel(it.type) + '」暂时不再适用：' + short(it.text) });
        saveArc(cur, arc); toast('已暂不适用'); render();
      }
    }, { noInput: true, pill: 'yes', pills: [{ label: '取消', value: 'no' }, { label: '暂不适用', value: 'yes' }] });
  }
  function restoreKnow(id) {
    const arc = ensureArc(cur); const it = arc.loves.find(x => x.id === id); if (!it) return;
    it.status = 'active'; it.updated = Date.now();
    arc.history.push({ time: it.updated, text: '「' + typeLabel(it.type) + '」恢复适用：' + short(it.text) });
    saveArc(cur, arc); toast('已恢复'); render();
  }
  function delKnow(id) {
    if (!window.openModal) return;
    window.openModal('删除这条了解？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      arc.loves = arc.loves.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }

  // ---- 共同记录流程 ----
  function addBond(cat) {
    if (!window.openModal) return;
    const catLabel = BOND_CATS[cat] || tabLabelOf('shared', ensureArc(cur), cat) || '共同记录';
    let phase = 'text', text = '', ctl = null;
    ctl = window.openModal('记一条「' + catLabel + '」', '', function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        text = t; phase = 'date';
        ctl.stay(); ctl.title('发生在哪一天？'); ctl.hint('留空默认今天。');
        ctl.text(mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        const arc = ensureArc(cur);
        arc.bonds.push({ id: makeId(), cat: cat, text: text, date: strim(v) || mdstr(Date.now()), created: Date.now() });
        saveArc(cur, arc); toast('已记下'); render();
      }
    }, { placeholder: BOND_PH[cat] || '', maxlength: 100 });
  }
  function addRecord() {
    if (!window.openModal) return;
    let phase = 'text', text = '', ctl = null;
    ctl = window.openModal('记一条相处', '', function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        text = t; phase = 'date';
        ctl.stay(); ctl.title('在哪一天？'); ctl.hint('留空默认今天。');
        ctl.text(mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月25日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        const arc = ensureArc(cur);
        arc.records.push({ id: makeId(), text: text, date: strim(v) || mdstr(Date.now()), created: Date.now() });
        saveArc(cur, arc); toast('已记下'); render();
      }
    }, { placeholder: '今天和TA聊了很久……', maxlength: 120 });
  }
  function editEntry(kind, id) {
    const arc = ensureArc(cur);
    const arr = kind === 'bond' ? arc.bonds : (kind === 'moment' ? arc.moments : arc.records);
    const it = arr.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', newText = '', ctl = null;
    ctl = window.openModal('编辑', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        newText = t; phase = 'date';
        ctl.stay(); ctl.title('在哪一天？');
        ctl.text(it.date || mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        it.text = newText; it.date = strim(v) || mdstr(Date.now());
        saveArc(cur, arc); toast('已更新'); render();
      }
    }, { placeholder: '内容', maxlength: 120 });
  }
  function delEntry(kind, id) {
    if (!window.openModal) return;
    window.openModal('删除这条？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      if (kind === 'bond') arc.bonds = arc.bonds.filter(x => x.id !== id);
      else if (kind === 'moment') arc.moments = arc.moments.filter(x => x.id !== id);
      else arc.records = arc.records.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }
  function toggleMoment(recId) {
    const arc = ensureArc(cur); const rec = arc.records.find(x => x.id === recId); if (!rec) return;
    if (rec.momentId) {
      arc.moments = arc.moments.filter(m => m.id !== rec.momentId);
      rec.momentId = '';
    } else {
      const m = { id: makeId(), text: rec.text, date: rec.date || mdstr(Date.now()), created: Date.now() };
      arc.moments.push(m); rec.momentId = m.id;
      arc.history.push({ time: Date.now(), text: '重要时刻：' + short(rec.text) });
    }
    saveArc(cur, arc); render();
  }
  // ---- 梦境流程：内容 → 日期 ----
  function addDream() {
    if (!window.openModal) return;
    let phase = 'text', text = '', ctl = null;
    ctl = window.openModal('记一个梦', '', function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        text = t; phase = 'date';
        ctl.stay(); ctl.title('梦到哪天？'); ctl.hint('留空默认今天。');
        ctl.text(mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        const arc = ensureArc(cur);
        arc.dreams.push({ id: makeId(), text: text, date: strim(v) || mdstr(Date.now()), created: Date.now() });
        saveArc(cur, arc); toast('记住了一个梦'); render();
      }
    }, { placeholder: 'TA梦见……', maxlength: 200 });
  }
  function editDream(id) {
    const arc = ensureArc(cur); const it = arc.dreams.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', newText = '', ctl = null;
    ctl = window.openModal('编辑这个梦', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        newText = t; phase = 'date';
        ctl.stay(); ctl.title('梦到哪天？');
        ctl.text(it.date || mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        it.text = newText; it.date = strim(v) || mdstr(Date.now());
        saveArc(cur, arc); toast('已更新'); render();
      }
    }, { placeholder: 'TA梦见……', maxlength: 200 });
  }
  function delDream(id) {
    if (!window.openModal) return;
    window.openModal('删掉这个梦？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      arc.dreams = arc.dreams.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }
  // ---- 还不了解流程 ----
  function addWonder() {
    if (!window.openModal) return;
    window.openModal('记一个想了解的事', '', function (v) {
      const t = strim(v); if (!t) return;
      const arc = ensureArc(cur);
      arc.wonders.push({ id: makeId(), text: t, solved: false, created: Date.now(), solvedAt: null });
      saveArc(cur, arc); toast('记下了，留给未来的你们'); render();
    }, { placeholder: '例如：TA真正害怕的是什么？', maxlength: 80 });
  }
  function solveWonder(id) {
    const arc = ensureArc(cur); const w = arc.wonders.find(x => x.id === id); if (!w || !window.openModal) return;
    window.openModal('「' + short(w.text, 20) + '」已经有答案了吗？', '', function (v) {
      if (v === 'only') { w.solved = true; w.solvedAt = Date.now(); saveArc(cur, arc); toast('已了解'); render(); return; }
      if (v === 'convert') {
        w.solved = true; w.solvedAt = Date.now(); saveArc(cur, arc); render();
        setTimeout(function () { addKnow(w.text); }, 0); // 链式开新弹窗必须延后一拍（外层 finally close 会清 cb）
      }
    }, { noInput: true, pill: 'only', pills: [{ label: '只是已了解', value: 'only' }, { label: '已了解 · 也记为了解', value: 'convert' }] });
  }
  function reopenWonder(id) {
    const arc = ensureArc(cur); const w = arc.wonders.find(x => x.id === id); if (!w) return;
    w.solved = false; w.solvedAt = null; saveArc(cur, arc); render();
  }
  function delWonder(id) {
    if (!window.openModal) return;
    window.openModal('删除这个疑问？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      arc.wonders = arc.wonders.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }

  // ---- 事件分发 ----
  function dispatch(op, el) {
    const id = el.getAttribute('data-id');
    const kind = el.getAttribute('data-kind');
    switch (op) {
      case 'nav': view = el.getAttribute('data-view') || 'home'; render(); break;
      case 'stab': { const tv = el.getAttribute('data-view'), tb = el.getAttribute('data-tab'); if (tv && tab[tv] != null) tab[tv] = tb; render(); break; }
      case 'pick-roster': {
        // 虚拟 chip（rid 为空 + 带 cid）：点击即把该桌面联系人落成真身再选中——
        // 已被用户删过的桌面（有 cjian-seeded 标记）不会复活，materializeDesk 返回空串
        const rid = el.getAttribute('data-rid') || '';
        const cid = el.getAttribute('data-cid') || '';
        cur = rid || (cid ? materializeDesk(cid) : '');
        if (cur) setCur(cur);
        tab.tastes = 'like'; tab.habits = 'daily'; tab.things = 'use'; tab.shared = 'first'; tab.knows = 'cards';
        searchQ = '';
        render();
        break;
      }
      // #611：档案页的管理只做名单（添加/改名/删除）——传 arc 让此间的「时辰区间」不进档案页
      case 'add-roster': if (window.cjianManage) window.cjianManage({ arc: 1 }); break;
      case 'efield': editField(el.getAttribute('data-map'), el.getAttribute('data-key')); break;
      case 'add-li': addLi(el.getAttribute('data-kind')); break;
      case 'edit-li': editLi(el.getAttribute('data-kind'), id); break;
      case 'del-li': delLi(el.getAttribute('data-kind'), id); break;
      case 'add-know': addKnow(''); break;
      case 'edit-know': editKnowFlow(id, false); break;
      case 'revise-know': editKnowFlow(id, true); break;
      case 'retire-know': retireKnow(id); break;
      case 'restore-know': restoreKnow(id); break;
      case 'del-know': delKnow(id); break;
      case 'add-bond': addBond(el.getAttribute('data-cat')); break;
      case 'add-record': addRecord(); break;
      case 'edit-entry': editEntry(kind, id); break;
      case 'del-entry': delEntry(kind, id); break;
      case 'toggle-moment': if (kind === 'record') toggleMoment(id); break;
      case 'add-dream': addDream(); break;
      case 'edit-dream': editDream(id); break;
      case 'del-dream': delDream(id); break;
      case 'add-quote': addQuote(); break;
      case 'edit-quote': editQuote(id); break;
      case 'del-quote': delQuote(id); break;
      case 'know-from-dream': knowFrom('dream', id); break;
      case 'know-from-quote': knowFrom('quote', id); break;
      case 'img-li': pickImg(kind, id); break;
      case 'mgtab': manageTabs(el.getAttribute('data-group')); break;
      case 'search-open': view = 'search'; searchQ = ''; render(); break;
      case 'jump': {
        const tv = el.getAttribute('data-view'), tb = el.getAttribute('data-tab');
        if (tv && VALID_VIEWS.indexOf(tv) >= 0) {
          if (tb && typeof tab[tv] !== 'undefined') tab[tv] = tb;
          view = tv; render();
        }
        break;
      }
      case 'export': doExport(''); break;
      case 'export-sect': doExport(view); break;
      case 'add-wonder': addWonder(); break;
      case 'solve-wonder': solveWonder(id); break;
      case 'reopen-wonder': reopenWonder(id); break;
      case 'del-wonder': delWonder(id); break;
    }
  }

  // ---- 绑定 ----
  function bind() {
    const back = document.getElementById('narc-back');
    if (back) back.addEventListener('click', function () { window.closeNarc(); });
    const manage = document.getElementById('narc-manage');
    // #611：带 arc 标记——档案页不该出现「时辰区间」（那是此间的世界时间设定）
    if (manage) manage.addEventListener('click', function (e) { e.stopPropagation(); if (window.cjianManage) window.cjianManage({ arc: 1 }); });
    const appIcon = document.querySelector('.app[data-app="memo-arc"]');
    if (appIcon) {
      appIcon.addEventListener('click', function () {
        const editing = Array.prototype.some.call(document.querySelectorAll('.app-grid'), g => g.classList.contains('editing'));
        if (editing) return;
        window.openNarc();
      });
    }
    if (root) {
      root.addEventListener('click', function (e) {
        const b = e.target.closest('[data-op]');
        if (!b) return;
        dispatch(b.getAttribute('data-op'), b);
      });
      // 搜索框：只重渲结果区，不动输入框本身（保焦点）
      root.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'narc-q') {
          searchQ = e.target.value;
          if (!cur) return;
          const box = document.getElementById('narc-results');
          if (box) box.innerHTML = searchResultsHTML(ensureArc(cur));
        }
      });
    }
  }

  function boot() { bind(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

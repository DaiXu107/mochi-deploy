// ===== 功能：聊天默认字卡 + 其他互动功能字卡 =====
// 数据来自星言简易版默认通用字卡；可开关；分类浏览（主字卡/颜文字/emoji）；
// 开启后联系人回复按「整体概率 + 分类占比」混入默认字卡
// v3.16.x：功能触发字卡（摸鱼/吃饭/经期/喝水/花园/同频/伸手/此间/房间/存钱罐/
// 漂流瓶/互动回应）从「聊天默认字卡」页拆出，独立成「其他互动功能字卡」页——
// 这些字卡不是聊天通用回复，是触发对应功能时联系人才会使用。
  // #427：dc-cat-dict 是词典独立成页前的遗留分类开关键，现行版本已无任何写入 UI；
  // 老用户存储里残留的 '0' 会让词典拼字自检/抽卡池永远判「词典分类被关」且无处打开
  //（多机型同报，纯数据态问题）。启动即清除全部命名空间的该键（LS + IDB，幂等），
  // 防 idbRestore 每次开屏把 IDB 旧值回填回来。放在页面锚点守卫之前，保证必执行。
  (function () {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && /^xy-home-v2:(?:[^:]+:)?dc-cat-dict$/.test(k)) localStorage.removeItem(k);
      }
    } catch (e) {}
    try {
      if (window.idbGetAllKeys && window.idbDelete) {
        window.idbGetAllKeys().then(function (keys) {
          (keys || []).forEach(function (k) {
            if (/^xy-home-v2:(?:[^:]+:)?dc-cat-dict$/.test(k)) { try { window.idbDelete(k); } catch (e) {} }
          });
        }).catch(function () {});
      }
    } catch (e) {}
  })();
  (function () {
  // #961 字卡库顶部标红提醒（聊天默认字卡页 #dc-size-hint、词典页 #dict-size-hint）：两池体量很大，
  //   不常用词典时建议关掉。文案唯一来源＝card-lock.js 的 window.mochiPresetSizeTip（二级密码解锁
  //   成功弹窗用同一份），本处只负责填字；放在页面锚点守卫之前——它的两个容器与字卡列表无关，
  //   列表锚点以后若改名也不该让提醒条变成空白。
  (function presetSizeHints() {
    const tip = window.mochiPresetSizeTip;
    if (!tip) return;
    ['dc-size-hint', 'dict-size-hint'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = tip;
    });
  })();
  const list = document.getElementById('dc-list');
  const tabsWrap = document.getElementById('dc-tabs');
  const enabledEl = document.getElementById('dc-enabled');
  if (!list || !tabsWrap || !enabledEl) return;

  const uid = window.activePrefix();
  const ls = window.activeStore();
  // v3.6.x：轻提示（复用 cc-toast 风格）
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }
  function toastCard(txt, off) {
    const s = String(txt == null ? '' : txt);
    toast((off ? '已关闭：' : '已开启：') + (s.length > 18 ? s.slice(0, 18) + '…' : s));
  }
  // ================= #926 分组开关（整组停用/启用） =================
  // 此前只能逐张关闭（dc-off-<分类>:<内容>），一个分组几十上百张（词典「常用词·双字」
  // 1380 张），想停用一整组只能一张张点。补一层分组开关，与自定义字卡库的 cc-groups-off
  // 同构同形态：存 <桌面>:dc-groups-off = { 分类: [分组名, ...] }（按联系人桌面独立，同 dc-off-*）。
  // 生效口径＝「该组内全部字卡视为已关闭」，收在 isOff 这一个消费端总闸上——聊天混入/群聊/
  // 写信/朋友圈/日历/词典拼字/梦角造句/各功能同源池全部自动跟上，无需逐个加分支。
  // 单卡开关各自的存值一字不动：分组开关只是叠一层，重新启用分组即恢复原状。
  const GOFF_KEY = 'dc-groups-off';
  let goffRaw = null;   // 单格缓存：读到的原始值没变才复用解析结果（切桌面读到另一桌面的值＝自动重解析）
  let goffObj = null;
  const goffExp = {};   // 分类 -> { src, names, set }：停用组内文案展开；没有分组停用时不建、不占内存
  function groupOffRecord(st) {
    let raw = null;
    try { raw = st.get(GOFF_KEY); } catch (e) { return null; }
    if (raw === goffRaw) return goffObj;
    let o = null;
    try {
      if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) o = p; }
    } catch (e) {}
    goffRaw = raw; goffObj = o;
    return o;
  }
  function groupOffTexts(cat, names) {
    const src = DATA[cat] || [];
    const e = goffExp[cat];
    if (e && e.src === src && e.names === names) return e.set;
    const kill = new Set(names), set = new Set();
    src.forEach(g => { if (kill.has(g[0])) (g[1] || []).forEach(c => set.add(c)); });
    goffExp[cat] = { src, names, set };
    return set;
  }
  // 同一条文案出现在多个分组时，任一所在分组停用即算停用（保守：停用即不出现）
  function groupOffFor(cat, c, st) {
    const o = groupOffRecord(st);
    const names = o && o[cat];
    return !!(names && names.length) && groupOffTexts(cat, names).has(c);
  }
  // ================= #1315 「整组停用」共用出口（供 mountCardView 以外的预设字卡页接入）==========
  // 需求＝用户实报「字卡库→系统预设字卡→其他互动功能字卡 的单独分组无法选择关闭使用」：
  // #926 的分组开关只覆盖 mountCardView 那四个列表，而【系统预设字卡】入口下另有 12 个由各页
  // 自渲染的预设池（情绪/回应/TA的心情/寻踪日常/今日情话/位置卡/TA 的询问·小问题·好奇·吐槽·
  // 查岗·邀请），它们只有逐张开关——一个分组几十张，想停掉整组只能一张张点，等于够不到「关闭使用」。
  // 机制与上面同构，但**另存一份键**（pg-groups-off，id 用「<页>:<分类>」）：dc-groups-off 的语义
  // 已被 #926 的针与 #932 的自检账绑在 mountCardView 的分类名单上，把别的页面塞进同一份名单＝改动
  // 邻居批的口径。各页仍走自己已有的单卡判据叠一层（判据＝该组内全部字卡视为已关闭），组内逐张
  // 开关的存值一字不动，重新启用分组即恢复原状；同 dc-* 按桌面（联系人命名空间）独立保存。
  const PG_KEY = 'pg-groups-off';
  let pgRaw = null, pgObj = null;   // 单格缓存：原始值没变才复用解析结果（切桌面＝自动重解析）
  function pgRecord(st) {
    let raw = null;
    try { raw = (st || ls).get(PG_KEY); } catch (e) { return null; }
    if (raw === pgRaw) return pgObj;
    let o = null;
    try {
      if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) o = p; }
    } catch (e) {}
    pgRaw = raw; pgObj = o;
    return o;
  }
  function pgIsOff(id, grp, st) {
    const o = pgRecord(st);
    const names = o && o[id];
    return !!(names && names.indexOf(grp) >= 0);
  }
  function pgSet(id, grp, off) {
    const cur = pgRecord(ls) || {};
    const arr = (cur[id] || []).slice();
    const i = arr.indexOf(grp);
    if (off && i < 0) arr.push(grp);
    if (!off && i >= 0) arr.splice(i, 1);
    const next = {};
    Object.keys(cur).forEach(k => { if (k !== id && Array.isArray(cur[k]) && cur[k].length) next[k] = cur[k].slice(); });
    if (arr.length) next[id] = arr;
    ls.set(PG_KEY, JSON.stringify(next));
  }
  function pgNames(id) {
    const o = pgRecord(ls);
    const names = o && o[id];
    return Array.isArray(names) ? names.slice() : [];
  }
  // 开关形态与 #926 分组头同款（.cc-group-header ＋ label.toggle.ccard-toggle，样式锚 .preset-list）；
  // .ccg-switch 只是接线时认出「这一发是分组开关」的凭据，不参与任何样式。
  function pgSwitchHTML(off) {
    return '<label class="toggle ccard-toggle ccg-switch" title="' + (off ? '启用该分组' : '停用该分组') + '">' +
      '<input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
  }
  function pgOffTag(off) { return off ? '<em class="ccg-off-tag">已停用</em>' : ''; }
  function pgWire(scopeEl, id, grp, onChange) {
    if (!scopeEl) return;
    const input = scopeEl.querySelector('.ccg-switch input');
    if (!input) return;
    input.addEventListener('change', () => {
      const nowOff = !input.checked;
      pgSet(id, grp, nowOff);
      if (typeof onChange === 'function') onChange(nowOff, grp);
    });
  }
  // 扁平 tab 页（列表里没有分组头可挂）用的「整类停用」条
  function pgCatBar(id, grp, label) {
    const off = pgIsOff(id, grp);
    return '<div class="set-group glass preset-cat-bar"><div class="gs-row"><span>整组停用「' + label + '」' +
      pgOffTag(off) + '</span>' + pgSwitchHTML(off) + '</div></div>';
  }
  window.presetGroup = {
    KEY: PG_KEY,
    isOff: pgIsOff,
    set: pgSet,
    names: pgNames,
    switchHTML: pgSwitchHTML,
    offTag: pgOffTag,
    bind: pgWire,
    bindBar: pgWire,   // 分组头与整类停用条用的是同一形态（.ccg-switch），两个名字都给，调用方按语义读
    catBar: pgCatBar,
    // 各页分组头的整行内容（名称＋已停用徽标＋张数＋开关），extra 传该页自己的附加徽标
    headerHTML: function (id, grp, label, count, extra) {
      const off = pgIsOff(id, grp);
      return '<span class="ccg-name">' + label + pgOffTag(off) + '</span><span class="ccg-count">' + count + '</span>' +
        (extra || '') + pgSwitchHTML(off);
    }
  };
  // ---- 开关/概率读取（store 参数化）----
  // 所有 dc-* 键都按桌面（联系人命名空间）独立保存；顶层 API 绑 activeStore（当前
  // 桌面），群聊等跨桌面场景用 defaultCardApiFor(目标桌面 store) 按成员自己的桌面读。
  // 默认值（对应星言 defaultCommonOverallProb=30, probs 各30）
  function apiFor(st) {
    const gE = function () { const v = st.get('dc-enabled'); return v === null ? true : v === '1'; };
    const gO = function () { const v = st.get('dc-overall'); return v === null ? 30 : Number(v); };
    // v3.28.x：场景概率——dc-overall-<k>（聊天/信箱/朋友圈）未设置时回退整体概率 dc-overall；
    //   朋友圈历史行为是「始终混入」（100），由消费方（feed.js）在键缺失时按 100 兜底
    const gOS = function (k) { const v = st.get('dc-overall-' + k); return v === null ? gO() : Number(v); };
    const gP = function (k) { const v = st.get('dc-prob-' + k); return v === null ? 25 : Number(v); };
    const gU = function (k) { const v = st.get('dc-use-' + k); return v === null ? true : v === '1'; };
    const gC = function (k) { const v = st.get('dc-cat-' + k); return v === null ? true : v === '1'; };
    const gOff = function (cat, c) {
      if (st.get('dc-off-' + cat + ':' + c) === '1') return true;
      return groupOffFor(cat, c, st);
    };
    return {
      enabled: gE,
      overall: gO,
      overallFor: gOS,
      prob: gP,
      use: gU,
      cat: gC,
      isOff: gOff,
      // 不依赖 this（箭头闭包）——调用方解构单个方法也不会丢上下文
      cfg: function () {
        return { enabled: gE(), overall: gO(), overallFor: gOS, probs: { main: gP('main'), kaomoji: gP('kaomoji'), emoji: gP('emoji'), touch: gP('touch') } };
      }
    };
  }
  const api = apiFor(ls);
  function getEnabled() { return api.enabled(); }
  function getOverall() { return api.overall(); }
  function getProb(k) { return api.prob(k); }
  // v3.7.x：场景开关——默认字卡可分别用于 聊天 / 信箱 / 朋友圈（默认全开）
  //   存 localStorage 键：dc-use-chat / dc-use-mail / dc-use-feed（'1' 开启）
  function getUse(k) { return api.use(k); }
  function setUse(k, on) { ls.set('dc-use-' + k, on ? '1' : '0'); }
  window.defaultCardUse = function (k) { return getUse(k); };
  // v3.8.x：分类开关——主字卡 / 颜文字 / emoji / 拍一拍 可分别开启/关闭（默认全开）
  //   存 localStorage 键：dc-cat-<k>（'1' 开启）；关闭后该分类不参与聊天混入/信箱混入/
  //   朋友圈补池/拍一拍抽取
  function getCat(k) { return api.cat(k); }
  function setCat(k, on) { ls.set('dc-cat-' + k, on ? '1' : '0'); }
  window.defaultCardCat = function (k) { return getCat(k); };
  window.defaultCardCfg = function () { return api.cfg(); };
  // v3.12.x：按指定桌面的 store 读一套开关（供群聊按成员所在桌面取：
  // 某成员桌面关闭【聊天使用】→ 单聊和群聊里这个成员都不再使用默认字卡）
  window.defaultCardApiFor = apiFor;

  // 数据（提取自星言 08_default_cards_data.js）
  const DATA = (window.DEFAULT_CARD_DATA) || { main: [], kaomoji: [], emoji: [] };
  // #319 防未成年人二级验证锁：锁定时系统预设字卡整体视为不存在（字卡库/回复池/词典拼字/
  //   各功能同源池全部取空），用户自建字卡不受影响——card-lock.js 先于本文件加载。
  const LOCKED = () => !(window.cardLockOpen && window.cardLockOpen());
  // #849 系统预设字卡去重（用户实报「词典里有重复内容，比如基础汉字的【嗯】与词库重复」「默认
  // 聊天字卡里有重复内容」）：批量化补卡时同一句话被反复写进多个分组，字卡库列表出现重复行、
  // 拼字抽卡池里同一张卡被抽中的概率翻倍。规则＝组内同文一律只留第一张；cross＝整个分类跨分组
  // 判重（词典、默认聊天字卡两分类按用户报障口径去重），分组顺序即优先级，先出现的分组保留。
  function dedupeCardGroups(groups, cross) {
    const across = cross ? new Set() : null;
    (groups || []).forEach(function (g) {
      if (!g || !Array.isArray(g[1])) return;
      const seen = across || new Set();
      const out = [];
      g[1].forEach(function (c) {
        if (typeof c !== 'string') { out.push(c); return; }
        if (seen.has(c)) return;
        seen.add(c);
        out.push(c);
      });
      g[1] = out;
    });
    return groups;
  }
  // dict 由 mergeDictCustom 每次重建（含自建词条），去重在那里做
  Object.keys(DATA).forEach(function (k) {
    if (k !== 'dict' && Array.isArray(DATA[k])) dedupeCardGroups(DATA[k], k === 'main');
  });

  // ================= v3.28.x #301：词典自建词条（词典 tab 内自由新增/删除） =================
  // 存储：全局命名空间 xy-home-v2:dict-custom-quotes / dict-custom-words（JSON 数组）——
  // 词典是语言资源，不随联系人桌面隔离。语录并入「语录·自建」分组（进拼字抽句池），
  // 词并入「词库·自建」分组（进切词词典）；内置词条不可删（可单卡关闭），自建词条可删。
  // v3.28.x #301 v3：词典扩展——DEFAULT_CARD_DATA.dict_ext（dict-ext-data.js，jieba 高频
  // ~3.8 万词按字数分组）并入词典分类；拼接规则＝组名前缀：语录* 进抽句池、词库* 进切词。
  const DICT_CUST_QKEY = 'dict-custom-quotes';
  const DICT_CUST_WKEY = 'dict-custom-words';
  // 页面加载时的内置词典快照（基础 dict + 扩展 dict_ext）：每次并组都从它重建，避免重复追加
  const PRESET_DICT = (DATA.dict || []).concat(DATA.dict_ext || []).map(g => [g[0], (g[1] || []).slice()]);
  function dictCustRead(key) {
    try {
      const raw = window.xyStore('xy-home-v2').get(key);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x) : [];
    } catch (e) { return []; }
  }
  function dictCustWrite(key, arr) {
    try { window.xyStore('xy-home-v2').set(key, JSON.stringify(arr)); } catch (e) {}
  }
  // 内置（基础+扩展）+自建并成 DATA.dict（重复调用安全：每次从 PRESET_DICT 重建）；
  // 同时刷新 window.__dictCustomSet（列表「自建」徽标依据，makeNode 读）
  function mergeDictCustom() {
    try {
      const qs = dictCustRead(DICT_CUST_QKEY);
      const ws = dictCustRead(DICT_CUST_WKEY);
      const base = PRESET_DICT.map(g => [g[0], g[1].slice()]);
      // v3.33.x：取消独立「词库·自建」分组（用户要求删掉）——自建词并入内置「词库」组
      //（组名仍以「词库」开头，切词词典消费不受影响）；「自建」徽标仍由 __dictCustomSet 标注。
      // 语录/词库兜底组仅在有内容时才创建，避免空分组占位。
      const gq = base.find(g => g[0] === '语录');
      if (gq) gq[1] = gq[1].concat(qs);
      else if (qs.length) base.push(['语录·自建', qs.slice()]);
      const gw = base.find(g => g[0].indexOf('词库') === 0);
      if (gw) gw[1] = gw[1].concat(ws);
      else if (ws.length) base.push(['词库·自建', ws.slice()]);
      DATA.dict = dedupeCardGroups(base, true);
      window.__dictCustomSet = new Set(qs.concat(ws));
    } catch (e) {}
  }
  mergeDictCustom();
  function dictCustomAdd(kind, text) {
    const v = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!v) return { ok: false, msg: '内容为空，先输入再保存' };
    if (v.indexOf('data:') === 0 || v.indexOf('|||') >= 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(v))) return { ok: false, msg: '该内容不能作为词典词条' }; // FIX 2026-09-13 #394 媒体池令牌串不得进词典
    const pref = kind === 'quote' ? '语录' : '词库';
    const dupPreset = PRESET_DICT.some(g => g[0].indexOf(pref) === 0 && g[1].indexOf(v) >= 0);
    if (dupPreset) return { ok: false, msg: '内置词典已有这条' };
    const key = kind === 'quote' ? DICT_CUST_QKEY : DICT_CUST_WKEY;
    const arr = dictCustRead(key);
    if (arr.indexOf(v) >= 0) return { ok: false, msg: '已存在这条自建词条' };
    arr.push(v);
    dictCustWrite(key, arr);
    mergeDictCustom();
    try { if (window.quoteSpellResetDict) window.quoteSpellResetDict(); } catch (e) {}
    return { ok: true, msg: (kind === 'quote' ? '已存为语录：' : '已存为词：') + v };
  }
  function dictCustomRemove(text) {
    const v = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!v) return false;
    let n = 0;
    [DICT_CUST_QKEY, DICT_CUST_WKEY].forEach(k => {
      const arr = dictCustRead(k);
      const i = arr.indexOf(v);
      if (i >= 0) { arr.splice(i, 1); dictCustWrite(k, arr); n++; }
    });
    if (n) {
      mergeDictCustom();
      try { if (window.quoteSpellResetDict) window.quoteSpellResetDict(); } catch (e) {}
    }
    return n > 0;
  }

  // v3.16.x：字卡库入口角标数量动态化——template.html 里写死的「3260」早已过期
  //（主字卡现 4621，全库含互动回应/摸鱼/吃什么/经期/喝水/花园等同源功能池共 5800+），
  // 改为按 DEFAULT_CARD_DATA 全部分类实时合计；后续新增分类角标自动跟上不再写死。
  // v3.16.x：拆页后「聊天默认字卡」角标只统计四大基础分类；
  // 「其他互动功能字卡」入口角标统计全部功能分类（fish/eat/period/water/garden/
  // sync/reach/cjian/room/piggy/drift/interact）。
  // deskcheck（联系人跨桌面查岗）独立成系统预设字卡里的单独入口，见 page-deskcheck。
  const FUNC_KEYS = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music'];
  // 词典（dict）已独立成大分类（page-dict-cards，见 dictView），不再并入默认聊天字卡——
  // BASE_KEYS 只含默认字卡四大分类；词典数据仅由词典独立页与词典拼字（quote-spell.js）消费。
  const BASE_KEYS = ['main', 'kaomoji', 'emoji', 'touch'];
  // v3.26.x：搜索跨全库（聊天默认字卡页 + 其他互动功能字卡页全部 tab），
  // 不再局限于当前 tab——用户搜「轻轻抵着」在任意页面都能找到经期温柔动作字卡。
  const ALL_KEYS = BASE_KEYS.concat(FUNC_KEYS);
  // 跨 tab 搜索结果用「[tab名] 分组名」标注来源：从 dc/fc tabs 读 data-type → 显示名
  const TAB_LABELS = (function () {
    const m = {};
    ['dc-tabs', 'fc-tabs'].forEach(function (id) {
      const w = document.getElementById(id);
      if (!w) return;
      w.querySelectorAll('.cc-tab[data-type]').forEach(function (t) { m[t.dataset.type] = t.textContent.trim(); });
    });
    return m;
  })();
  function tabLabel(k) { return TAB_LABELS[k] || k; }
  function sumKeys(keys) {
    let n = 0;
    keys.forEach(k => { (DATA[k] || []).forEach(g => { n += Array.isArray(g[1]) ? g[1].length : 0; }); });
    return n;
  }
  function refreshLibCount() {
    const el = document.getElementById('dc-lib-count');
    if (el) el.textContent = String(sumKeys(BASE_KEYS));
    const del = document.getElementById('dc-dict-count');
    if (del) del.textContent = String(sumKeys(['dict']));
    const fel = document.getElementById('fc-lib-count');
    if (fel) fel.textContent = String(sumKeys(FUNC_KEYS));
    const dkel = document.getElementById('dk-lib-count');
    if (dkel) dkel.textContent = String(sumKeys(['deskcheck']));
  }
  refreshLibCount();

  // v3.6.x：单卡开关——系统预设字卡可逐张开启/关闭使用
  //   存 localStorage 键：dc-off-<分类>:<字卡内容>，关闭为 '1'
  function isCardOff(cat, c) { return api.isOff(cat, c); }
  function setCardOff(cat, c, off) { ls.set('dc-off-' + cat + ':' + c, off ? '1' : '0'); }
  // v3.6.x：暴露单卡开关查询（供 chat.js 字卡池兜底过滤：自定义字卡为空时
  //   系统字卡补池也必须跳过用户已关闭的字卡）
  window.isDefaultCardOff = function (cat, c) { return isCardOff(cat, c); };
  // #926：分组开关读写（当前桌面）——写时整份重写，不改缓存里的对象（缓存靠 raw/数组引用失效）
  function isGroupOff(cat, gname) {
    const o = groupOffRecord(ls);
    const names = o && o[cat];
    return !!(names && names.indexOf(gname) >= 0);
  }
  function setGroupOff(cat, gname, off) {
    const cur = groupOffRecord(ls) || {};
    const arr = (cur[cat] || []).slice();
    const i = arr.indexOf(gname);
    if (off && i < 0) arr.push(gname);
    if (!off && i >= 0) arr.splice(i, 1);
    const next = {};
    Object.keys(cur).forEach(k => { if (k !== cat && Array.isArray(cur[k]) && cur[k].length) next[k] = cur[k].slice(); });
    if (arr.length) next[cat] = arr;
    ls.set(GOFF_KEY, JSON.stringify(next));
  }

  // ---- 页面 UI ----
  let cur = 'main';
  let q = '';
  enabledEl.checked = getEnabled();
  enabledEl.addEventListener('change', () => {
    ls.set('dc-enabled', enabledEl.checked ? '1' : '0');
    // v3.6.x：总开关也弹轻提示（与单卡开关一致）
    toast(enabledEl.checked ? '已开启：使用系统预设字卡' : '已关闭：使用系统预设字卡');
  });
  // v3.7.x：场景开关绑定——聊天 / 信箱 / 朋友圈 分别控制默认字卡的使用
  [['chat', '聊天'], ['mail', '信箱'], ['feed', '朋友圈']].forEach(([k, label]) => {
    const el = document.getElementById('dc-use-' + k);
    if (!el) return;
    el.checked = getUse(k);
    el.addEventListener('change', () => {
      setUse(k, el.checked);
      toast((el.checked ? '已开启' : '已关闭') + '：默认字卡' + label + '使用');
    });
  });
  // v3.12.x：场景开关下方小字说明——dc-* 键按桌面（联系人）独立保存；
  // 某联系人桌面关闭【聊天使用】，单聊和群聊里这个联系人都不会再使用默认字卡
  (function () {
    const row = document.getElementById('dc-use-feed');
    if (!row) return;
    const grp = row.closest('.set-group');
    if (!grp || document.getElementById('dc-scope-note')) return;
    const note = document.createElement('div');
    note.id = 'dc-scope-note';
    note.style.cssText = 'margin:8px 12px 10px;font-size:11px;line-height:1.6;color:#999;';
    note.textContent = '以上开关按当前桌面对应的联系人独立保存：当当前桌面联系人关闭【聊天使用】，聊天和群聊里这个联系人也无法使用默认字卡（其他联系人不受影响）。\n下方字卡列表里，每个分组标题右侧的开关是「整组停用/启用」——停用后本组字卡全部不再使用，组内每张卡自己的开关一字不改，重新启用分组即恢复原样。';
    note.style.whiteSpace = 'pre-line';
    grp.parentNode.insertBefore(note, grp.nextSibling);
  })();
  // v3.8.x：分类开关绑定——主字卡 / 颜文字 / emoji / 拍一拍 分别控制默认字卡分类使用
  // （词典已独立成大分类，不再归属默认字卡分类；词典拼字启用由词典独立页/回复设置控制）
  [['main', '主字卡'], ['kaomoji', '颜文字'], ['emoji', 'emoji'], ['touch', '拍一拍']].forEach(([k, label]) => {
    const el = document.getElementById('dc-cat-' + k);
    if (!el) return;
    el.checked = getCat(k);
    el.addEventListener('change', () => {
      setCat(k, el.checked);
      toast((el.checked ? '已开启' : '已关闭') + '：默认字卡' + label + '使用');
    });
  });
  // v3.28.x：使用概率绑定——聊天 / 信箱 / 朋友圈 三场景各自可调默认字卡出现概率
  //   存键 dc-overall-<k>（未设置=该场景历史默认：聊天/信箱 30，朋友圈 100 始终混入）
  const DC_OVERALL_DEF = { chat: 30, mail: 30, feed: 100 };
  function dcOverallVal(k) { const v = ls.get('dc-overall-' + k); return v === null ? DC_OVERALL_DEF[k] : Number(v); }
  function dcOverallSet(k, nv) { ls.set('dc-overall-' + k, String(nv)); }
  [['chat', '聊天'], ['mail', '写信'], ['feed', '朋友圈']].forEach(([k, label]) => {
    const box = document.getElementById('dc-overall-' + k);
    const valEl = document.getElementById('dc-overall-' + k + '-val');
    if (!box || !valEl) return;
    valEl.value = String(dcOverallVal(k));
    box.querySelector('.stp-min').addEventListener('click', () => {
      const nv = Math.max(0, (parseInt(valEl.value, 10) || 0) - 5);
      valEl.value = String(nv); dcOverallSet(k, nv);
      toast('默认字卡' + label + '使用概率：' + nv + '%');
    });
    box.querySelector('.stp-max').addEventListener('click', () => {
      const nv = Math.min(100, (parseInt(valEl.value, 10) || 0) + 5);
      valEl.value = String(nv); dcOverallSet(k, nv);
      toast('默认字卡' + label + '使用概率：' + nv + '%');
    });
  });
  // v3.33.x：分类占比绑定——默认字卡命中后四大分类按占比分配（四类合计 100%）。
  //   存键 dc-prob-<k>（未设置=等权 25，行为与旧权重等价）；改动即生效，
  //   抽取按相对权重归一（drawCards 用权重滚动），单独调一档不强制影响其它档。
  function dcProbSet(k, nv) { ls.set('dc-prob-' + k, String(nv)); }
  [['main', '主字卡'], ['kaomoji', '颜文字'], ['emoji', 'emoji'], ['touch', '拍一拍']].forEach(([k, label]) => {
    const box = document.getElementById('dc-prob-' + k);
    const valEl = document.getElementById('dc-prob-' + k + '-val');
    if (!box || !valEl) return;
    valEl.value = String(getProb(k));
    box.querySelector('.stp-min').addEventListener('click', () => {
      const nv = Math.max(0, (parseInt(valEl.value, 10) || 0) - 5);
      valEl.value = String(nv); dcProbSet(k, nv);
      toast('默认字卡' + label + '占比：' + nv + '%');
    });
    box.querySelector('.stp-max').addEventListener('click', () => {
      const nv = Math.min(100, (parseInt(valEl.value, 10) || 0) + 5);
      valEl.value = String(nv); dcProbSet(k, nv);
      toast('默认字卡' + label + '占比：' + nv + '%');
    });
  });
  // v3.43.x：设置区顶部 tag 分类 + 点击展开——默认全部收起（首屏只留字卡列表），
  //   点 tag 展开对应设置面板，再点同一 tag 收起；同一时刻只开一个，避免又堆成一团。
  //   列表始终显示（面板在 tag 与列表之间展开），不隐藏列表，虚拟窗口无需重排。
  //   barId → 面板 id = panelPrefix + key（key 取按钮 data-dcset）；keys 为该 bar 的面板顺序。
  //   两个页面共用：聊天默认字卡页（dc-set-*）与词典页（dict-set-*）。
  function mountSetTabs(barId, panelPrefix, keys) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    let openKey = '';
    function apply(key) {
      openKey = key || '';
      keys.forEach(function (k) {
        const el = document.getElementById(panelPrefix + k);
        if (el) el.hidden = (k !== openKey);
      });
      bar.querySelectorAll('.dc-set-tab[data-dcset]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.dcset === openKey);
      });
    }
    bar.addEventListener('click', function (e) {
      const b = e.target && e.target.closest ? e.target.closest('.dc-set-tab[data-dcset]') : null;
      if (!b) return;
      apply(b.dataset.dcset === openKey ? '' : b.dataset.dcset);
    });
    apply('');
  }
  mountSetTabs('dc-set-tabs', 'dc-set-', ['scene', 'prob', 'cat']);
  mountSetTabs('dict-set-tabs', 'dict-set-', ['use', 'prob']);
  // v3.32.x：功能字卡使用概率绑定——其他互动功能字卡页（含查岗页）每个分类一个
  //   stepper，存键 dcf-<分类>（per-cid，随桌面命名空间）。未设置时回退该分类的
  //   历史默认值（= 改版前代码里写死的触发概率），行为不变；设 0 即该分类字卡
  //   触发后不再随机出现。消费方统一走 window.dcfGet(分类) 读。
  // v3.42.x #422：DCF_DEF 增补「发到聊天型」功能——checkin 寻踪日常推送、pomo 番茄钟完成消息、care 经期关心、
  //   memo 备忘提醒、ask TA主动提问。它们不参与本页字卡管理（无独立字卡池），只挂概率门控：
  //   消费方 window.dcfGet('checkin'/'pomo'/'care'/'memo'/'ask')，0%=彻底不进聊天，100%=原行为。
  //   deskcheck 跨桌面查岗回应为独立入口，不进本页概率列表总开关。
  const DCF_DEF = { fish: 35, eat: 35, period: 25, water: 35, garden: 40, sync: 60, reach: 55, cjian: 100, room: 100, piggy: 100, drift: 100, interact: 100, music: 100, deskcheck: 50, checkin: 100, pomo: 100, care: 100, memo: 100, ask: 100 };
  // v3.42.x #422：功能说明弹窗标题用的人类可读名（与概率行标签一致）。
  const DCF_DEF_NAME = { fish: '摸鱼', eat: '吃饭', period: '经期', water: '喝水', garden: '花园', sync: '同频', reach: '伸手', cjian: '此间', room: '房间', piggy: '存钱罐', drift: '漂流瓶', interact: '互动回应', music: '音乐', deskcheck: '跨桌面查岗', checkin: '寻踪日常', pomo: '番茄钟', care: 'TA的关心', memo: '备忘提醒', ask: 'TA主动提问' };
  // v3.33.x：功能字卡总开关——【其他互动功能字卡】可整体开启/关闭（dcf-enabled 键，默认开启）。
  //   开启/关闭分别存 '1'/'0'；关闭后 FUNC_KEYS 各功能触发字卡都不再随机出现（dcfVal 返回 0），
  //   各分类概率（dcf-prob-*）仍保留。独立入口「联系人跨桌面查岗」(deskcheck) 不受此开关约束。
  function dcfEnabled() {
    try { const v = window.activeStore().get('dcf-enabled'); return v === null ? true : v === '1'; } catch (e) { return true; }
  }
  function dcfEnableSet(on) { try { window.activeStore().set('dcf-enabled', on ? '1' : '0'); } catch (e) {} }
  window.dcfEnabled = dcfEnabled;
  function dcfVal(k) {
    // v3.42.x #422：总开关同时覆盖新增的「发到聊天型」功能（checkin/pomo/care/memo/ask）——关总开关即
    //   连寻踪日常推送、番茄钟完成消息、经期关心、备忘提醒与 TA 主动提问一起停掉；deskcheck 是独立入口，仍不受总开关约束。
    if ((FUNC_KEYS.indexOf(k) >= 0 || k === 'checkin' || k === 'pomo' || k === 'care' || k === 'memo' || k === 'ask') && !dcfEnabled()) return 0;
    if (!(k in DCF_DEF)) return 100;
    try { const v = window.activeStore().get('dcf-' + k); if (v !== null && v !== undefined) { const n = Number(v); if (!isNaN(n)) return Math.max(0, Math.min(100, n)); } } catch (e) {}
    return DCF_DEF[k];
  }
  // #518：dcfGet 出口统一套「系统预设字卡总档」缩放（19 类功能字卡的唯一读取漏斗；
  // 各页概率行显示走 dcfRaw 存盘值，不受影响）
  function dcfEffGet(k) { return window.dcpEff ? window.dcpEff(dcfVal(k)) : dcfVal(k); }
  window.dcfGet = dcfEffGet;
  // 总开关 UI 绑定：存在则同步勾选状态、监听变更写键并轻提示
  (function () {
    const el = document.getElementById('dcf-enabled');
    if (!el) return;
    el.checked = dcfEnabled();
    el.addEventListener('change', () => {
      dcfEnableSet(el.checked);
      toast((el.checked ? '已开启' : '已关闭') + '：使用其他互动功能字卡');
    });
  })();
  // v3.42.x #444：概率框折叠/展开——默认收起（首屏留给字卡列表，#239 同因防复发），点展开栏切换；
  //   展开状态按桌面持久化（dcf-prob-open，'1'=展开），stepper/功能说明绑定与显隐无关照常生效。
  (function () {
    var bar = document.getElementById('dcf-prob-expander-row');
    var box = document.getElementById('dcf-prob-box');
    if (!bar || !box) return;
    function apply(open) {
      box.hidden = !open;
      var ar = document.getElementById('dcf-prob-expander-arrow');
      if (ar) ar.textContent = open ? '▴' : '▾';
    }
    var open = false;
    try { open = window.activeStore().get('dcf-prob-open') === '1'; } catch (e) {}
    apply(open);
    bar.addEventListener('click', function () {
      open = !open;
      apply(open);
      try { window.activeStore().set('dcf-prob-open', open ? '1' : '0'); } catch (e) {}
    });
  })();
  // v3.26.x #515：同一个概率键可以在多个页面各有一个 stepper（「寻踪日常发送到聊天」＝字卡库
  //   【寻踪日常字卡】页 +【其他互动功能字卡】页两处）——用 [data-dcfkey] 标记批量绑定，
  //   改任意一处即刷新全部同键 stepper（否则在 A 页调完回 B 页仍显示旧值＝用户以为两处不一致）。
  //   显示值取「存盘值」dcfRaw 而非闸门后的生效值 dcfVal：总开关关闭时 dcfVal 恒 0，会让各概率行
  //   显示成 0、点 ± 又被闸门复位成 0（点了没反应），用户看到的不是自己设的数值。
  function dcfRaw(k) {
    if (!(k in DCF_DEF)) return 100;
    try {
      const v = window.activeStore().get('dcf-' + k);
      if (v !== null && v !== undefined && v !== '') {
        const n = Number(v);
        if (!isNaN(n)) return Math.max(0, Math.min(100, n));
      }
    } catch (e) {}
    return DCF_DEF[k];
  }
  function dcfSteppers(k) {
    const out = [];
    const byId = document.getElementById('dcf-prob-' + k);
    if (byId) out.push(byId);
    document.querySelectorAll('.stepper[data-dcfkey="' + k + '"]').forEach(function (st) {
      if (out.indexOf(st) === -1) out.push(st);
    });
    return out;
  }
  function dcValEl(st) { return st.querySelector('input.stp-val') || st.querySelector('.stp-val'); }
  function dcfRefreshUI(k) {
    dcfSteppers(k).forEach(function (st) {
      const valEl = dcValEl(st);
      if (valEl) valEl.value = String(dcfRaw(k));
    });
  }
  window.dcfRefreshUI = dcfRefreshUI;
  function dcfSetVal(k, nv) {
    nv = Math.max(0, Math.min(100, parseInt(nv, 10) || 0));
    try { window.activeStore().set('dcf-' + k, String(nv)); } catch (e) {}
    dcfRefreshUI(k);
    toast('字卡使用概率（' + (DCF_DEF_NAME[k] || k) + '）：' + nv + '%');
  }
  // v3.26.x #515：绑定去重改用闭包数组记录，不给元素加 DOM expando/属性——mobile-adapt 会把输入类
  //   元素换成 ce-box（项目里有「读到过期 expando」的踩坑史），且各套验证桩的元素未必实现
  //   getAttribute（加了会让既有脚本的极简桩直接抛错，白伤别人脚本）
  const dcfBoundSteppers = [];
  function bindDcfProb() {
    Object.keys(DCF_DEF).forEach((k) => {
      dcfSteppers(k).forEach(function (st) {
        if (dcfBoundSteppers.indexOf(st) >= 0) return;
        dcfBoundSteppers.push(st);
        const mn = st.querySelector('.stp-min');
        const mx = st.querySelector('.stp-max');
        const curVal = function () {
          const valEl = dcValEl(st);
          const n = valEl ? parseInt(valEl.value, 10) : NaN;
          return isNaN(n) ? dcfRaw(k) : n;
        };
        if (mn) mn.addEventListener('click', () => dcfSetVal(k, curVal() - 5));
        if (mx) mx.addEventListener('click', () => dcfSetVal(k, curVal() + 5));
      });
      dcfRefreshUI(k);
    });
  }
  bindDcfProb();
  // v3.42.x #422：每个功能分类的【功能说明】标签（template 里 .gs-row .tag[data-fdesc]）——
  //   点击弹 openModal 静态说明，讲清该功能何时触发、概率控制什么、如何彻底关。用事件委托避免
  //   为每个分类单独绑监听。
  const DCF_DESC = {
    fish: '【摸鱼】联系人按你摸鱼/钓鱼的进度，在桌面上飘出「摸鱼浮字」打趣你；点击浮字可抓包，抓包会结算 TA 自上次被抓以来涨的全部摸鱼值（TA 补一份总账、你得同额），并在聊天里回应。\n触发时机：页面在前台时每 60 秒检查一次摸鱼值变化，仅在摸鱼值上涨、距上次 ≥45 分钟、当天不超过 12 次时判定；后台不触发。\n概率 = 每次判定出现浮字的概率（默认 35%），0% = 不出现浮字（本页字卡也可逐张关闭）。',
    eat: '【吃饭】到饭点（早 06:30–09:30、午 11:00–13:30、晚 17:00–19:30、夜宵 21:30–23:30）时，联系人主动来聊天提醒你吃饭，并按概率补一句「追问关心」（夜宵时段用夜宵关心话术）。\n触发时机：每 4 分钟判定一次，每个饭点每天只提醒一次，23:00–06:00 静默。主提醒由本功能自带的概率（默认 2%）控制；本项概率只控制提醒之后是否补发追问。\n概率 = 补发追问的概率（默认 35%），0% = 只提醒、不追问。',
    period: '【经期·温柔化】处于经期时，联系人的每条文字回复有概率被加上温柔前缀/后缀（如「抱抱」「慢慢来」）。\n触发时机：TA 每生成一条文字回复时判定一次，仅经期生效。\n概率 = 每条回复被温柔化的概率（默认 25%），0% = 不加温柔前缀/后缀。\n拼接时前缀、正文、动作各自是一张字卡，中间空一格（与单气泡拼字同款，不是被粘成一串）。\n（本项属经期专属语态，词典拼字/梦角自由造句全关也只停各自玩法；但「回复设置→多字卡回复」总开关关闭时本项一并不改写——加前缀/动作＝往同一条气泡里拼第二张字卡，归那颗总开关管。想单独停掉温柔语态只认本页概率与逐张开关。）\n（预测期的「梦角关心」是独立的一项「TA的关心」，另见其说明。）',
    water: '【喝水】每天 06:00–23:00，联系人会来聊天里催你喝水；当天已打卡达标时改为约 1/4 概率发夸奖。\n触发时机：页面在前台时每 8 分钟判定一次，至少隔 50 分钟、每天最多 4 条；打开喝水页时也可能补发；后台不触发。\n概率 = 每次判定发出催水的概率（默认 35%），0% = 完全不催。',
    garden: '【花园】联系人在花园打理植物（播种/浇水/收成/施肥/巡逻）后，可能在花园日志里留一句「梦角悄悄话」。\n触发时机：你与花园互动时有 8% 概率触发 TA 帮忙打理；回到手机桌面或进花园时，TA 也会按后台经过时间打理（每 30 分钟一段、每段 40% 概率）。\n概率 = 每次 TA 打理后追加悄悄话的概率（默认 40%），0% = 只打理、不留悄悄话。\n（TA 摘花送进聊天是另一套 30% 逻辑，不受本项影响。）',
    sync: '【同频】在「同频」页长按敲三下（每下长按 0.35 秒、三下需在 5 秒内完成）时，联系人有概率接住并回应你。\n触发时机：靠你主动长按触发，无冷却、无每日上限；回应会发到聊天（可在同频页关掉「发到聊天」）。\n概率 = 敲三下后接住的概率（默认 60%），0% = 永远接不住。',
    reach: '【伸手】在「伸手」页长按 0.5 秒时，联系人有概率回应你（温热/微凉/发丝等触感＋悄悄话，会发到聊天，可在该页关掉）。\n触发时机：靠你主动长按触发，无冷却、无每日上限。\n概率 = 主动伸手被回应的概率（默认 55%），0% = 主动伸手时只飘字、不留卡。\n（打开伸手页时 TA 也可能主动碰你（距上次 >6 小时 70%、否则 25%），该被动回应不受本项控制。）',
    cjian: '【此间】在「此间」页点「感知」时，联系人有概率补一句气息/落空的话术（只在页内显示，不发聊天）。\n触发时机：靠你点「感知」触发；按钮自带 4 秒防抖，梦角状态最多每 15 分钟变化一次。\n概率 = 每次感知出现话术的概率（默认 100%），0% = 感知不出话术。',
    room: '【房间】在「我们的房间」里进屋、用家具、开关灯、点 TA、点窗等互动时，联系人可能冒泡说话（气泡只在房间内显示）。\n触发时机：靠你点击触发，无每日上限；TA 自己走动/做动作不会发字卡。\n概率 = 每次互动冒泡的概率（默认 100%），0% = 点了也不冒泡。',
    piggy: '【存钱罐】切到心意币「存钱」页时，TA 可能往存钱罐里塞心意币，并发一条系统消息。\n触发时机：每次切换/打开该页判定一次；距上次越久越容易（>12 小时 45%、>1 小时 25%、否则 12%）。\n概率 = 本次判定是否放行（默认 100%），0% = 不塞币也不发系统消息。\n（真实存钱罐的存/取款关心、TA 取币另有各自的概率，不受本项控制。）',
    drift: '【漂流瓶】捞出漂流瓶时，瓶内话术（海风/TA的话/TA的回应）从「漂流瓶」字卡池抽取。\n触发时机：打开漂流瓶页、捡瓶前、从后台切回时结算；捡瓶有 20 秒冷却，TA 瓶每天最多 3 个；TA 回应在发布后 6–40 小时结算（45% 概率会回应，同时最多 2 个）。\n概率 = 抽到字卡话术的概率（默认 100%），0% = 不出字卡（普通瓶仍有内置兜底、不会空白；TA 回应瓶则不再生成）。',
    interact: '【互动回应】你主动做的各种小互动（戳一戳 / 拍一拍 / 拉拉手等）时，联系人回应的字卡。\n⚠ 当前版本本项概率尚未接线到回应抽取，调整暂不生效（回应的实际概率由回复设置里的相关项控制）。\n触发时机：你主动互动时。\n概率 = 预留的回应字卡概率（默认 100%），设计意图为 0% = 互动不回应字卡，修复接线后生效。',
    music: '【音乐】播放歌曲时，TA 偶尔会「暂停一下再恢复」来逗你。\n触发时机：每开始一首歌判定一次（自带 3% 概率、同一首只触发一次、距上次 ≥10 分钟）；命中后 10–25 秒随机暂停，3.5 秒后恢复。\n概率 = 暂停/恢复时是否附上字卡气泡（默认 100%），0% = 仍有暂停动作和系统消息，但不出字卡。',
    checkin: '【寻踪日常】联系人定期更新「TA 的日常」（在哪里 / 在做什么 / 想对你说），并推送到聊天。\n触发机制与时间：首次打开（数据就绪后）立即生成一条；此后每隔 1–8 小时随机更新一次，页面在前台时每 60 秒检查一次；后台不更新，从后台切回后 90 秒冷静期内不更新。\n推送内容：每次更新向聊天发三条——「更新了一条日常」提示 + 日常内容 + 30% 概率的「提醒你来寻踪」。\n概率 = 本次更新是否推送这三条到聊天的概率（默认 100%），0% = 完全不发（寻踪页与历史记录照常生成）。\n想整体停用：设置 → 工具 → 寻踪（TA 的日常）总开关——关闭后连日常生成与记录一起停用、聊天里的寻踪入口收起（桌面【寻踪】图标仍在，进去写明「已禁用」，页里「TA在身边 · 位置感知」照常可用），与本概率是两层东西。',
    pomo: '【番茄钟】你用番茄钟完成一段专注时，联系人在聊天里发「去休息一会儿」（如有奖励还会附上摸鱼补偿）的消息。\n触发时机：每完成一段「专注」结算一次（休息段不发），需番茄钟页的「发到聊天」开关也打开。\n概率 = 完成后发这条消息的概率（默认 100%），0% = 不发。',
    care: '【TA的关心（经期）】经期中、经前预警日（提前天数见经期页「提醒设置」）、或经期推迟时，联系人主动发消息。v3.42.x #559 起按「语境 × 经期规律」分级：经期中发「经期关心」（附「经期关心」标签，语料=字卡库「经期」tab「经期关心」分组+经期页自管理关心语）；经前预警日/推迟发「经期预警」（附「经期预警」标签）。分级判据=近 3 次周期变异系数 CV<0.2（很规律/较规律）视为预测可信，否则预测仅参考——①经前预警：预测可信按配置预警日发确定口吻（「经前预警」组）；预测仅参考只在最接近的一次预警日发「按记录推算、仅供参考」版（「经前预警·不规律」组）。②推迟：预测可信晚 ≥5 天发「比平时晚了 N 天，你一向很准」（「经期推迟」组），晚 ≥10 天升关注档、措辞带就医建议（「经期推迟·关注」组）；预测仅参考不说「推迟」（预测误差可能比推迟天数还大），晚 ≥10 天才以「距上次经期已经 N 天」间隔口吻轻提（「经期推迟·不规律」组）。各语料 {d} 自动替换为具体天数。\n触发时机：TA 每条文字/表情/图片回复后、打开经期页、保存提醒设置时各判定一次；每个语境每天最多一条；23:00–06:00 深夜静默（不发、也不占当天名额，白天再触发照常）。\n本概率 = 在原有闸门之上统一放行（默认 100%）：经期中第 1–2 天另有 90%、第 3–4 天 70%、第 5+ 天 55%，经前预警/推迟预警 75% 的基数；本项 100% = 保持原节奏，0% = 完全不发。\n与经期页那个「梦角关心」按钮是「与」的关系：本项设 0%、或那边关掉，任一成立就一条都不发（不必两个都关）。被本项拦成 0% 而经期页仍显示「已开启」时，经期页「提醒设置」底部会当场写出这一条与打开方式，不再静默不发。',
    memo: '【备忘提醒】你有未完成的备忘时，联系人在聊天里催一件，带「备忘提醒」标签。\n触发时机：启动 60 秒后首次、之后每 4 分钟判定一次、回前台补触发；至少隔 2 天、23:00–06:00 静默。\n本概率 = 在备忘页自带的「备忘提醒」开关/概率（默认 2%）之上是否放行（默认 100%）：100% = 保持原节奏，0% = 完全不催备忘。\n备忘页里自己的开关仍独立有效。',
    ask: '【TA主动提问】联系人在聊天里主动发起的问题卡：关心询问 / 小问题 / 好奇卡片 / 互动 / 吐槽，带你作答选项。\n触发时机：五类各自定时判定（首次 60–150 秒、之后每 240–300 秒），各有冷却（30/45/90 分钟），任一互动卡发出后 60 分钟内其余类型不再自动触发；无深夜静默。\n本概率 = 在各类自带的触发概率（询问/小问题/好奇/吐槽默认 5%、TA分享你的字卡默认 4%）与冷却之上是否统一放行（默认 100%）：100% = 保持原节奏，0% = 完全不主动提问。\n#1153 频率整体档：设置 → 回复设置 →「互动卡频率」四档（原频率 / 稍安静 / 安静 / 很安静）可把这五类（以及邀请三类、音乐邀请）的概率、提问卡冷却与 60 分钟跨类型间隔一起整体往下缩放；「原频率」（默认）＝完全保持现在的节奏，没有比它更高的档。\n不影响查岗（查岗走自己的「跨桌面查岗」）。',
    deskcheck: '【跨桌面查岗·回应】其他桌面的联系人来查岗、你回答后，TA 是否从「跨桌面查岗」字卡池抽 1–5 张作为回应。\n触发时机：查岗本身由全局「跨桌面查岗频率」控制（原频率：每 60 秒判定、每次 2% 概率、冷却 30 分钟；安静 1% / 3 小时（默认）；更安静 0.5% / 6 小时；最安静 0.2% / 12 小时），本项不控制是否来查岗，只控制回答之后的回应。\n概率 = 回答后抽回应字卡的概率（默认 50%），0% = 只给文字回复、不抽字卡。\n（本项为独立入口，不受「其他互动功能字卡」总开关约束。）'
  };
  // 注入「功能说明」标签到每个概率行（含新启用的 checkin/pomo）——复用 .gs-row .tag 样式，
  // 标签带 data-fdesc/<data-dname，交给下方 document 级事件委托。
  (function () {
    // v3.26.x #515：idOverride——同一个概率键在另一页的 stepper 用不同 id（寻踪日常字卡页那行带
    //   -ck 后缀），挂标签时按 override 取，不用 box.querySelector（保持「只按 id 取元素」的老口径，
    //   免得让既有验证脚本的极简桩元素缺 closest 抛错）
    function injBox(boxId, ks, idOverride) {
      var box = document.getElementById(boxId);
      if (!box) return;
      ks.forEach(function (k) {
        var stp = document.getElementById((idOverride && idOverride[k]) || ('dcf-prob-' + k));
        if (!stp) return;
        var row = stp.closest('.gs-row');
        if (!row) return;
        var label = row.querySelector(':scope > span');
        if (!label || label.querySelector('.tag')) return;
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.setAttribute('data-fdesc', k);
        tag.setAttribute('data-dname', DCF_DEF_NAME[k] || k);
        tag.setAttribute('role', 'button');
        tag.setAttribute('tabindex', '0');
        tag.textContent = '功能说明';
        label.style.cssText += ';display:flex;align-items:center;gap:6px;';
        label.appendChild(tag);
      });
    }
    injBox('dcf-prob-box', Object.keys(DCF_DEF).filter(function (k) { return k !== 'deskcheck'; }));
    injBox('dcf-prob-box-dk', ['deskcheck']);
    // v3.26.x #515：寻踪日常字卡页的概率行也挂「功能说明」（与功能字卡页同一份文案）
    injBox('ck-prob-box', ['checkin'], { checkin: 'dcf-prob-checkin-ck' });
  })();
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-fdesc]') : null;
    if (!t) return;
    var k = t.getAttribute('data-fdesc');
    var txt = DCF_DESC[k];
    if (!txt) return;
    // v3.26.x #515：显示存盘值而非闸门后的生效值（总开关关闭时生效值恒 0，会让用户
    //   以为「我设的数值被改了」）
    var n = dcfRaw(k);
    var title = '【' + (t.getAttribute('data-dname') || k) + '】功能说明';
    if (window.openModal) {
      window.openModal(title, '', function () {}, { noInput: true, staticText: txt + '\n\n当前使用概率：' + n + '%' });
    }
  });
  // v3.26.x：小键写日志异步合并（idb.js mochi-wrj-heal）把 dc-* 键修正后，重同步
  // 总开关/场景开关/分类开关的 UI——修荣耀 Edge 杀进程回滚 LS 后「开关退出重进变回去」
  // 且已打开的设置页仍显示旧值的问题
  // v3.26.x：默认字卡开关 UI 重同步——dc-* 与 dcf-* 都是 per-cid 键，切换联系人桌面 /
  //   IDB 回填 / 小键写日志修正后，已渲染的 checkbox/stepper 不会自动重读，会把上一个桌面
  //   的勾选/数值留在屏幕上。用户在旧状态上操作 → 写到当前桌面但 UI 显示旧桌面 →
  //   "关了还能发、再看又是开的"（#745 多机型同现，根因＝contact-switched 漏刷 dc-* 开关）
  function syncDcSwitchUI() {
    enabledEl.checked = getEnabled();
    ['chat', 'mail', 'feed'].forEach(function (k) {
      const el = document.getElementById('dc-use-' + k);
      if (el) el.checked = getUse(k);
    });
    ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
      const el = document.getElementById('dc-cat-' + k);
      if (el) el.checked = getCat(k);
    });
    // v3.28.x：使用概率 stepper 同样重同步
    ['chat', 'mail', 'feed'].forEach(function (k) {
      const valEl = document.getElementById('dc-overall-' + k + '-val');
      if (valEl) valEl.value = String(dcOverallVal(k));
    });
    // v3.33.x：分类占比 stepper 同样重同步
    ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
      const valEl = document.getElementById('dc-prob-' + k + '-val');
      if (valEl) valEl.value = String(getProb(k));
    });
    // v3.32.x：功能字卡概率 stepper（v3.26.x #515：改走 dcfRefreshUI，同时刷新同键全部 stepper）
    Object.keys(DCF_DEF).forEach(function (k) {
      dcfRefreshUI(k);
    });
    // v3.33.x：功能字卡总开关同样重同步
    const deEl = document.getElementById('dcf-enabled');
    if (deEl) deEl.checked = dcfEnabled();
  }
  document.addEventListener('mochi-wrj-heal', function () { try { syncDcSwitchUI(); } catch (e) {} });
  // v3.26.x #515 / #745：切换联系人桌面 / IDB 回填完成后，所有 dc-* / dcf-* 开关与概率行
  //   重新读键——dcf-* 是 per-cid 键，不重读会把上一个桌面的数值留在屏幕上（寻踪日常字卡页
  //   与功能字卡页同键，dcfRefreshUI 一并刷新）；#745 补：dc-enabled/dc-use-*/dc-cat-*/dc-overall-*/
  //   dc-prob-* 同为 per-cid，此前 contact-switched 漏刷这些开关，用户在联系人桌面关了默认字卡
  //   后切回 default 桌面，设置页仍显示旧桌面勾选状态，写入到非预期桌面 → 关了还能发、再看又是开的
  ['contact-switched', 'mochi-restore-done'].forEach(function (ev) {
    document.addEventListener(ev, function () { try { syncDcSwitchUI(); } catch (e) {} });
  });

  // ---- 双页共用渲染内核 ----
  // v3.16.x：把「分类 tab + 分组条 + 搜索 + 分批列表 + change 委托」抽成工厂，
  // 聊天默认字卡页（dc-* 锚点，仅基础分类）与 其他互动功能字卡页（fc-* 锚点，
  // 仅功能分类）各持一份独立状态；数据/开关键（dc-off-<分类>:*）与池 API 完全不变。
  // v3.26.x：渲染改为「视口虚拟窗口」（见下方常量注释）——工厂结构、DOM 类名、
  // 单卡开关键、tab/分组/搜索行为全部不变，只变列表的构建方式。
  const V_PAD = 0.8;    // 视口上下各多渲染 0.8 屏（重建频率 ≈ 每滚 0.8 屏一次）
  const V_MINW = 24;    // 窗口条目数下限（小屏/高条目时兜底，避免窗口过窄）
  const V_EST = 55;     // 未实测条目高度初值：.cc-item 13+13 padding + 行高 + 9 margin
  function mountCardView(ids, allowedKeys, emptyText, searchKeys) {
    const viewList = document.getElementById(ids.list);
    const viewTabs = document.getElementById(ids.tabs);
    const viewBar = document.getElementById(ids.groupsBar);
    const viewSearch = document.getElementById(ids.search);
    const pageEl = document.getElementById(ids.page);
    if (!viewList || !viewTabs || !viewBar || !viewSearch || !pageEl) return null;
    // #926：四个预设字卡列表（默认聊天字卡/功能字卡/词典/查岗）共用的分组开关样式锚，
    // 只打在这批列表容器上——#emoji-list、#poke-list 等同样用 .cc-group-header 但没有开关
    viewList.classList.add('preset-list');
    const view = {
      keys: allowedKeys.slice(),
      searchKeys: (searchKeys || []).slice(),
      cur: allowedKeys[0] || '',
      q: '',
      curGroup: ''
    };

    // ================= 虚拟窗口状态 =================
    // 实测（headless 390×844，空数据）：预设字卡 main 分类 4621 张旧版全量渲染 =
    // #dc-list 子树 33221 个节点、整页高 277922px、4628 个 checkbox，全站节点数从
    // 10841 翻到 44338；分批渲染仍占主线程 1.7s；点返回切页时 62 个 .page 的
    // MutationObserver + 全站选择器扫描在 4.4 万节点文档上放大（长任务 54ms）；
    // 二次进出更糟（进入阻塞 590ms、返回 182ms——display:none 销毁 3.3 万节点的
    // 渲染树，再显示要整棵重建）。iOS WebKit（Safari/Edge/Chrome 同内核）合成与内存
    // 开销还会再放大数倍，且残留 DOM 让之后每次切页都付这个税 → 真机反馈
    // 「进预设字卡能滑，点返回卡住，卡回去后整页都很卡」。
    // 方案：数据扁平成 flat[]（纯 JS，零 DOM），DOM 里只留视口上下各 V_PAD 屏的条目
    // （约 60~90 个节点），其余高度由顶部/底部占位块撑住；条目真实高度在插入后一次性
    // 读取并回填前缀和表，按窗口上方的累计变化量静默校正 scrollTop，长列表滚动位置不漂。
    let flat = [];                    // 当前列表数据（分组头 + 字卡）
    let n = 0;
    let hts = new Float64Array(0);    // 每条占位高度（实测或估计）
    let offs = new Float64Array(1);   // 前缀和：offs[i]=第 i 条顶部 y，offs[n]=总高
    let got = new Uint8Array(0);      // 该条是否已实测
    let est = V_EST;                  // 估计高度：随实测均值收敛
    let measSum = 0, measCnt = 0;
    let winLo = -1, winHi = -1;       // DOM 中已渲染窗口 [winLo, winHi)
    let topSpace = null, botSpace = null;
    // 滚动容器：元素 / 'win'（视口）/ null（未确认，按 'win' 处理）。
    // 三页布局不统一：#dc-list 有 CSS 显式放开 overflow 交给 .page 整页滚；
    // #fc-list/#dk-list 的 .card-list{flex:1} 在 .page(flex 列) 内被 min-height:auto
    // 撑开、自身不裁剪，实际滚的同样是 .page。只按 overflowY 样式选容器会把列表当成
    // 滚动容器（它的 scrollTop 恒 0）→ 窗口永不推进、往下滚全是空白。
    // 故以「确实在裁剪内容」判定，并在滚动事件里用 e.target 直接确认。
    let scroller = null;

    function clipsContent(el) {
      try {
        const oy = getComputedStyle(el).overflowY;
        if (oy !== 'auto' && oy !== 'scroll') return false;
        return el.scrollHeight > el.clientHeight + 1;
      } catch (e) { return false; }
    }
    function guessScroller() {
      if (scroller) return scroller;
      try {
        let el = viewList;
        while (el && el !== document.documentElement) {
          if (clipsContent(el)) { scroller = el; return scroller; }
          el = el.parentElement;
        }
      } catch (e) {}
      return null;
    }
    function onScroll(target) {
      if (pageEl.hidden) return;
      if (target && target.nodeType === 1) {
        // 元素滚动事件不冒泡、但 document 捕获阶段能收到：target 即滚动容器本身
        try { if (target !== viewList && !target.contains(viewList)) return; } catch (e) { return; }
        scroller = target;
      } else {
        const sc = guessScroller();
        if (sc && sc !== 'win') return;   // 本页有元素级滚动容器，视口滚动与我们无关
        scroller = 'win';
      }
      requestLayout(false);
    }
    function scrollY() {
      const sc = guessScroller();
      if (!sc || sc === 'win') return window.pageYOffset || document.documentElement.scrollTop || 0;
      return sc.scrollTop;
    }
    function setScrollY(v) {
      const sc = guessScroller();
      if (!sc || sc === 'win') window.scrollTo(0, v); else sc.scrollTop = v;
    }
    function recomputeOffsets() {
      if (offs.length !== n + 1) offs = new Float64Array(n + 1);
      let s = 0;
      for (let i = 0; i < n; i++) { offs[i] = s; s += hts[i]; }
      offs[n] = s;
    }
    function indexAt(y) {
      if (y <= 0) return 0;
      if (y >= offs[n]) return Math.max(0, n - 1);
      let a = 0, b = n;
      while (a < b) { const m = (a + b) >> 1; if (offs[m] <= y) a = m + 1; else b = m; }
      return Math.max(0, Math.min(n - 1, a - 1));
    }
    function groupHeaderHTML(label, count, off) {
      return '<span class="ccg-name">' + label + (off ? '<em class="ccg-off-tag">已停用</em>' : '') + '</span>' +
        '<span class="ccg-count">' + count + '</span>' +
        '<label class="toggle ccard-toggle" title="' + (off ? '启用该分组' : '停用该分组') + '"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
    }
    function makeNode(it, i) {
      const d = document.createElement('div');
      if (it.header) {
        // #926：分组标题右侧整组开关——停用后该组字卡一律不参与抽取（组内单卡开关各自存值不变）
        const goff = isGroupOff(it.cat, it.gname);
        d.className = 'cc-group-header' + (goff ? ' off' : '');
        d.innerHTML = groupHeaderHTML(it.glabel, it.count, goff);
      } else {
        const off = isCardOff(it.cat, it.c);
        d.className = 'cc-item glass' + (off ? ' off' : '');
        // 整页为系统预设字卡，统一标【系统】与自定义字卡区分（#301：词典自建词条标「自建」）；
        // 右侧单卡开关——逐张开启/关闭该字卡（关闭后功能/聊天回复不再抽取）
        d.innerHTML = '<div class="cc-txt"><div class="t">' + it.c + ' <span class="tc-known">' + (window.__dictCustomSet && window.__dictCustomSet.has(it.c) ? '自建' : '系统') + '</span></div></div>' +
          '<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
      }
      d.dataset.idx = i;
      return d;
    }
    // 写完再读，只触发一次布局：连续兄弟的 offsetTop 差 = 该条实际占位高（含 margin）
    function measureAndFix() {
      const kids = viewList.children;
      const count = kids.length - 2;
      if (count < 2) return;
      const baseBefore = offs[winLo];
      let touched = false;
      // kids = [topSpace, 条目…, botSpace]；末条用 botSpace 的 offsetTop 收尾（占位块高度
      // 不影响自身 offsetTop，读到的仍是末条实际占位高）
      for (let k = 1; k <= count; k++) {
        const i = winLo + k - 1;
        const h = kids[k + 1].offsetTop - kids[k].offsetTop;
        if (h > 0 && h !== hts[i]) {
          if (got[i]) measSum += h - hts[i]; else { got[i] = 1; measSum += h; measCnt++; }
          hts[i] = h;
          touched = true;
        }
      }
      if (!touched) return;
      if (measCnt) est = Math.max(20, measSum / measCnt);
      recomputeOffsets();
      const delta = offs[winLo] - baseBefore;
      topSpace.style.height = offs[winLo] + 'px';
      botSpace.style.height = Math.max(0, offs[n] - offs[winHi]) + 'px';
      if (Math.abs(delta) >= 1) setScrollY(scrollY() + delta);
    }
    // 按当前滚动位置重排窗口；force=false 时请求范围仍落在已渲染范围内就直接跳过（防抖）
    function layout(force) {
      if (!n) { winLo = winHi = -1; return; }
      const sc = guessScroller();
      const isWin = !sc || sc === 'win';
      const vh = isWin ? window.innerHeight : sc.clientHeight;
      if (!vh) return;                  // 页面正隐藏：等显示时再排
      const y = scrollY();
      // 列表内容坐标系里滚动视口顶端的 y：列表自身就是滚动容器时即 scrollTop；
      // 否则滚动容器矩形顶 - 列表矩形顶（列表 rect 已含滚动位移，相减即滚掉的量）。
      // offs[] 以条目 border-box 顶为基准，.card-list 无 border/padding-top，两套坐标对齐。
      let a;
      if (sc === viewList) a = y;
      else a = (isWin ? 0 : sc.getBoundingClientRect().top) - viewList.getBoundingClientRect().top;
      const pad = vh * V_PAD;
      let lo = indexAt(Math.max(0, a - pad));
      let hi = Math.min(n, indexAt(Math.min(offs[n], a + vh + pad)) + 1);
      const need = V_MINW - (hi - lo);
      if (need > 0) {
        hi = Math.min(n, hi + need);
        const need2 = V_MINW - (hi - lo);
        if (need2 > 0) lo = Math.max(0, lo - need2);
      }
      if (!force && lo >= winLo && hi <= winHi) return;
      winLo = lo; winHi = hi;
      if (!topSpace) {
        topSpace = document.createElement('div'); topSpace.className = 'cc-vspace';
        botSpace = document.createElement('div'); botSpace.className = 'cc-vspace';
      }
      topSpace.style.height = offs[lo] + 'px';
      botSpace.style.height = Math.max(0, offs[n] - offs[hi]) + 'px';
      const frag = document.createDocumentFragment();
      frag.appendChild(topSpace);
      for (let i = lo; i < hi; i++) frag.appendChild(makeNode(flat[i], i));
      frag.appendChild(botSpace);
      viewList.textContent = '';
      viewList.appendChild(frag);
      measureAndFix();
    }
    let rafPending = false, rafForce = false;
    function requestLayout(force) {
      if (force) rafForce = true;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        const f = rafForce;
        rafPending = false; rafForce = false;
        layout(f);
      });
    }
    function setData() {
      hts = new Float64Array(n); hts.fill(est);
      got = new Uint8Array(n);
      recomputeOffsets();
      winLo = winHi = -1;
    }
    function renderGroupsBar() {
      viewBar.innerHTML = '';
      const grps = DATA[view.cur] || [];
      const chips = [['', '全部']].concat(grps.map(g => [g[0], g[0]]));
      chips.forEach(([val, label]) => {
        const cEl = document.createElement('span');
        cEl.className = 'cc-g-chip' + (view.curGroup === val ? ' sel' : '');
        cEl.textContent = label;
        cEl.addEventListener('click', () => { view.curGroup = val; renderGroupsBar(); render(); });
        viewBar.appendChild(cEl);
      });
    }
    function render() {
      // 统一为 { key, gname, arr } 结构：非搜索时是当前 tab 的分组；
      // 搜索时跨 searchKeys 全库匹配（结果带来源 tab 名标注）
      let shown = (DATA[view.cur] || []).map(g => ({ key: view.cur, gname: g[0], arr: g[1] }));
      if (view.q) {
        const cross = [];
        (view.searchKeys.length ? view.searchKeys : view.keys).forEach(k => {
          (DATA[k] || []).forEach(g => {
            const arr = (g[1] || []).filter(c => c.indexOf(view.q) >= 0);
            if (arr.length || g[0].indexOf(view.q) >= 0) cross.push({ key: k, gname: g[0], arr });
          });
        });
        shown = cross;
      } else if (view.curGroup) {
        shown = shown.filter(g => g.gname === view.curGroup);
      }
      const list = [];
      shown.forEach(it => {
        list.push({ header: true, cat: it.key, gname: it.gname, glabel: (it.key !== view.cur ? '[' + tabLabel(it.key) + '] ' : '') + it.gname, count: it.arr.length });
        it.arr.forEach(c => list.push({ header: false, c, cat: it.key }));
      });
      flat = list; n = list.length;
      if (!n) {
        topSpace = botSpace = null;
        viewList.innerHTML = '<div class="cc-empty">' + emptyText + '</div>';
        winLo = winHi = -1;
        return;
      }
      setData();
      layout(true);
    }
    // change 事件委托——list 单一监听器替代每卡一个；窗口重建后 dataset.idx 仍指向 flat
    viewList.addEventListener('change', (e) => {
      const input = e.target;
      if (!input || input.type !== 'checkbox') return;
      const head = input.closest('.cc-group-header');
      if (head) {
        const hrec = flat[Number(head.dataset.idx)];
        if (!hrec || !hrec.header) return;
        const nowOff = !input.checked;
        setGroupOff(hrec.cat, hrec.gname, nowOff);
        // 「已停用」徽标可能让分组头换行变高：整窗重排一次，顺带重测高度（滚动位置不漂）
        requestLayout(true);
        toast(nowOff ? '已停用分组：' + hrec.gname + '（本组 ' + hrec.count + ' 张字卡不再使用）' : '已启用分组：' + hrec.gname);
        return;
      }
      const item = input.closest('.cc-item');
      if (!item) return;
      const rec = flat[Number(item.dataset.idx)];
      if (!rec || rec.header) return;
      const nowOff = !input.checked;
      // v3.26.x：跨 tab 搜索结果的字卡用其真实分类（rec.cat）存开关，而非当前 tab
      setCardOff(rec.cat || view.cur, rec.c, nowOff);
      item.classList.toggle('off', nowOff);
      toastCard(rec.c, nowOff);
    });
    viewTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.cc-tab[data-type]');
      if (!tab) return;
      if (view.keys.indexOf(tab.dataset.type) < 0) return;
      viewTabs.querySelectorAll('.cc-tab').forEach(t => t.classList.remove('sel'));
      tab.classList.add('sel');
      view.cur = tab.dataset.type;
      view.q = '';
      view.curGroup = '';
      renderGroupsBar();
      render();
    });
    viewSearch.addEventListener('input', () => {
      view.q = viewSearch.value.trim();
      clearTimeout(view._searchTimer);
      view._searchTimer = setTimeout(render, 150);
    });
    viewSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { viewSearch.value = ''; view.q = ''; render(); viewSearch.blur(); }
    });
    // 懒渲染：打开页才构建（大库不阻塞启动）。窗口只保留视口附近条目，常驻 DOM 恒定
    let renderedOnce = false;
    function ensureRendered() {
      if (renderedOnce) { requestLayout(true); return; }
      renderedOnce = true;
      document.addEventListener('scroll', function (e) { onScroll(e.target); }, { passive: true, capture: true });
      window.addEventListener('resize', () => requestLayout(true));
      // 页面隐藏时滚动容器的 scrollTop 归零、渲染树销毁：重新显示必须按新滚动位置重排
      if (typeof MutationObserver !== 'undefined') {
        try {
          new MutationObserver(() => { if (!pageEl.hidden) requestLayout(true); })
            .observe(pageEl, { attributes: true, attributeFilter: ['hidden'] });
        } catch (e) {}
      }
      refreshLibCount();
      renderGroupsBar();
      render();
    }
    return { view, ensureRendered, render };
  }

  // 聊天默认字卡页：仅四大基础分类（搜索跨全库，可在本页搜到功能字卡）
  const dcView = mountCardView({
    list: 'dc-list', tabs: 'dc-tabs', groupsBar: 'dc-groups-bar', search: 'dc-search-input', page: 'page-default-cards'
  }, BASE_KEYS, '暂无默认字卡', ALL_KEYS);
  // #301 词典 tab 自建词条行：仅词典 tab 显示；「存为语录/存为词」进词典分组与拼字引擎，
  // 「删自建」按原文精确删除（内置词条不可删，走单卡关闭）
  // #317：UI 行已按用户要求移除（词典是梦角语言资源，不提供手动存词条入口）——
  // dictCustomAdd/Remove API 与存储保留（历史自建词条仍在库中展示，可单卡关闭）
  (function () {
    const row = document.getElementById('dc-dict-add');
    if (!row || !dcView) return;
    const inp = document.getElementById('dc-dict-input');
    const sync = function () { try { row.hidden = dcView.view.cur !== 'dict'; } catch (e) {} };
    const tabs = document.getElementById('dc-tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      const t = e.target.closest('.cc-tab[data-type]');
      if (t) setTimeout(sync, 0);
    });
    const origEnsure = dcView.ensureRendered;
    dcView.ensureRendered = function () { const r = origEnsure.apply(null, arguments); sync(); return r; };
    const commit = function (kind) {
      const r = dictCustomAdd(kind, inp ? inp.value : '');
      toast(r.msg);
      if (r.ok) {
        if (inp) inp.value = '';
        if (dcView.render) dcView.render();
      }
    };
    const bq = document.getElementById('dc-dict-add-q');
    const bw = document.getElementById('dc-dict-add-w');
    if (bq) bq.addEventListener('click', () => commit('quote'));
    if (bw) bw.addEventListener('click', () => commit('word'));
    const bd = document.getElementById('dc-dict-del');
    if (bd) bd.addEventListener('click', () => {
      if (!window.openModal) { toast('弹窗组件不可用'); return; }
      window.openModal('删除自建词典词条', '', function (v) {
        if (v && dictCustomRemove(v)) {
          toast('已删除：' + String(v).replace(/\s+/g, ''));
          if (dcView.render) dcView.render();
        } else toast('未找到这条自建词条（内置词条不可删，可在列表里逐张关闭）');
      }, { staticText: '输入要删除的自建语录或词的原文（精确匹配）。内置词条无法删除，但可以在列表里逐张关闭。' });
    });
  })();
  // v3.35.x：词典独立分类——系统预设字卡里的单独入口（page-dict-cards），整页展示
  // DEFAULT_CARD_DATA.dict（语录+词库+扩展常用词），与「词典拼字」抽句/切词共用同一份数据。
  const dictView = mountCardView({
    list: 'd2-dict-list', tabs: 'd2-dict-tabs', groupsBar: 'd2-dict-groups-bar', search: 'd2-dict-search', page: 'page-dict-cards'
  }, ['dict'], '暂无词典字卡', ['dict']);
  // 词典自建词条行（本页全为词典，常驻显示）：存为语录/词、删自建，复用 dictCustomAdd/Remove
  // #317：UI 行已移除（用户要求），绑定代码随 getElementById(null) 自然空转，保留结构最小改动
  (function () {
    if (!dictView) return;
    const inp = document.getElementById('d2-dict-input');
    const commit = function (kind) {
      const r = dictCustomAdd(kind, inp ? inp.value : '');
      toast(r.msg);
      if (r.ok) { if (inp) inp.value = ''; if (dictView.render) dictView.render(); }
    };
    const bq = document.getElementById('d2-dict-add-q');
    const bw = document.getElementById('d2-dict-add-w');
    if (bq) bq.addEventListener('click', () => commit('quote'));
    if (bw) bw.addEventListener('click', () => commit('word'));
    const bd = document.getElementById('d2-dict-del');
    if (bd) bd.addEventListener('click', () => {
      if (!window.openModal) { toast('弹窗组件不可用'); return; }
      window.openModal('删除自建词典词条', '', function (v) {
        if (v && dictCustomRemove(v)) {
          toast('已删除：' + String(v).replace(/\s+/g, ''));
          if (dictView.render) dictView.render();
        } else toast('未找到这条自建词条（内置词条不可删，可在列表里逐张关闭）');
      }, { staticText: '输入要删除的自建语录或词的原文（精确匹配）。内置词条无法删除，但可以在列表里逐张关闭。' });
    });
  })();
  // v3.36.x：词典使用设置绑定（词典独立页）——场景开关（dict-use-chat/mail/feed）+
  //   使用概率（dict-overall-chat/mail/feed）+「使用的全部关闭」一键按钮。
  //   存储 per-cid（随桌面命名空间，同 dc-use-* 语义）；默认全开，概率默认：聊天 75
  //   （v3.40.x #370c 应需求从 100 降为 75——词典拼字是「概率触发」不该恒 100 全用了，保留正常
  //   回复空间）、写信/朋友圈 30（新混入场景）。
  //   消费方统一走 window.dictUse(scene) / window.dictOverall(scene) 读：
  //   quote-spell.js（聊天门）、mail.js taLetterContent（写信混入）、feed.js cardPool（朋友圈混入）。
  (function () {
    if (!dictView) return;
    const st = function () { try { return window.activeStore(); } catch (e) { return null; } };
    const gUse = function (k) { const s = st(); const v = s ? s.get('dict-use-' + k) : null; return v === null ? true : v === '1'; };
    const sUse = function (k, on) { const s = st(); if (s) s.set('dict-use-' + k, on ? '1' : '0'); };
    const DICT_OVERALL_DEF = { chat: 75, mail: 30, feed: 30 };
    const gOv = function (k) { const s = st(); const v = s ? s.get('dict-overall-' + k) : null; return v === null ? DICT_OVERALL_DEF[k] : Math.max(0, Math.min(100, Number(v))); };
    const sOv = function (k, nv) { const s = st(); if (s) s.set('dict-overall-' + k, String(nv)); };
    // 只读 API（跨文件消费）
    window.dictUse = function (scene) { return gUse(scene === 'mail' ? 'mail' : scene === 'feed' ? 'feed' : 'chat'); };
    window.dictOverall = function (scene) { return gOv(scene === 'mail' ? 'mail' : scene === 'feed' ? 'feed' : 'chat'); };
    // #390：二级锁与词典的关系提示——「防未成年人锁定」锁的是全部系统内置字卡（词典是其中
    //   一类），锁定时聊天/写信/朋友圈都不会用词典，下方场景开关全开也没效果。此前这层关系
    //   只在回复设置链路自检里提了一句「二级锁未解锁」，用户在词典页看到开关全开却无效果、
    //   看不懂和开屏二级密码的关系（用户实报）。这里在词典页顶部当场讲清：锁定=词典整体停用
    //   +去哪解锁；解锁/重锁事件即时刷新（card-lock.js 在本文件之前加载，cardLockOpen 必在）。
    const lockHint = document.getElementById('dict-lock-hint');
    function renderDictLockHint() {
      if (!lockHint) return;
      let locked = false;
      try { locked = !!(window.cardLockOpen && !window.cardLockOpen()); } catch (e) { locked = false; }
      if (!locked) { lockHint.hidden = true; lockHint.textContent = ''; return; }
      lockHint.hidden = false;
      lockHint.textContent = '防未成年人锁定开启中：词典属于系统内置字卡，锁定时聊天 / 写信 / 朋友圈都不会使用词典（下方开关全开也没效果，不是没保存）。到开屏公告区「防未成年人·内置字卡锁定」卡输入密码解锁，解锁后自动恢复，无需改这里任何开关。';
    }
    renderDictLockHint();
    document.addEventListener('mochi-cardlock-open', renderDictLockHint);
    document.addEventListener('mochi-cardlock-locked', renderDictLockHint);
    [['chat', '聊天'], ['mail', '写信'], ['feed', '朋友圈']].forEach(function (pair) {
      const k = pair[0], label = pair[1];
      const el = document.getElementById('dict-use-' + k);
      if (el) {
        el.checked = gUse(k);
        el.addEventListener('change', function () {
          sUse(k, el.checked);
          toast((el.checked ? '已开启' : '已关闭') + '：词典' + label + '使用');
        });
      }
      const box = document.getElementById('dict-overall-' + k);
      const valEl = document.getElementById('dict-overall-' + k + '-val');
      if (box && valEl) {
        valEl.value = String(gOv(k));
        const step = function (d) {
          const nv = Math.max(0, Math.min(100, (parseInt(valEl.value, 10) || 0) + d));
          valEl.value = String(nv); sOv(k, nv);
          toast('词典' + label + '使用概率：' + nv + '%');
        };
        const bMin = box.querySelector('.stp-min');
        const bMax = box.querySelector('.stp-max');
        if (bMin) bMin.addEventListener('click', function () { step(-5); });
        if (bMax) bMax.addEventListener('click', function () { step(5); });
      }
    });
    // 使用的全部关闭：三场景一键停用（弹窗确认；之后可逐个再打开）
    const ca = document.getElementById('dict-use-closeall');
    if (ca) ca.addEventListener('click', function () {
      const doClose = function () {
        ['chat', 'mail', 'feed'].forEach(function (k) {
          sUse(k, false);
          const el = document.getElementById('dict-use-' + k);
          if (el) el.checked = false;
        });
        toast('已关闭词典全部场景使用');
      };
      if (!window.openModal) { doClose(); return; }
      window.openModal('词典使用的全部关闭', '将同时关闭词典的聊天 / 写信 / 朋友圈三个场景使用（单卡开关不受影响，可随时再逐个打开）。', function () {
        doClose();
      }, { staticText: '确定执行？' });
    });
  })();
  const liDict = document.getElementById('li-dict-cards');
  if (liDict) {
    liDict.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-dict-cards');
      if (page) page.hidden = false;
      if (dictView) dictView.ensureRendered();
    });
  }
  const dictBack = document.getElementById('dict-back');
  if (dictBack) {
    dictBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  // 其他互动功能字卡页：仅功能分类（模板已预置全部功能 tab；搜索同样跨全库）
  const fcView = mountCardView({
    list: 'fc-list', tabs: 'fc-tabs', groupsBar: 'fc-groups-bar', search: 'fc-search-input', page: 'page-fun-cards'
  }, FUNC_KEYS, '暂无功能触发字卡', ALL_KEYS);

  // 兜底：若 template 静态 fc-tabs 里缺某个 FUNC_KEYS 分类，动态补一个 tab。
  // （其余功能分类已在模板静态预置；新增功能的 tab 靠这里自动补。）
  (function () {
    const tabs = document.getElementById('fc-tabs');
    if (!tabs) return;
    const known = Array.prototype.map.call(tabs.querySelectorAll('.cc-tab'), t => t.dataset.type);
    FUNC_KEYS.forEach(function (k) {
      if (known.indexOf(k) >= 0) return;
      const b = document.createElement('button');
      b.className = 'cc-tab';
      b.dataset.type = k;
      b.textContent = k === 'deskcheck' ? '联系人跨桌面查岗' : k;
      tabs.appendChild(b);
    });
  })();

  // 联系人跨桌面查岗（独立入口，单独页面渲染）：仅 deskcheck 一个分类
  const dkView = mountCardView({
    list: 'dk-list', tabs: 'dk-tabs', groupsBar: 'dk-groups-bar', search: 'dk-search-input', page: 'page-deskcheck'
  }, ['deskcheck'], '暂无联系人跨桌面查岗字卡', ['deskcheck']);

  // 入口/返回
  const li = document.getElementById('li-default-cards');
  if (li) {
    li.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-default-cards');
      if (page) page.hidden = false;
      if (dcView) dcView.ensureRendered();
    });
  }
  const back = document.getElementById('dc-back');
  if (back) {
    back.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  const liFun = document.getElementById('li-fun-cards');
  if (liFun) {
    liFun.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-fun-cards');
      if (page) page.hidden = false;
      if (fcView) fcView.ensureRendered();
    });
  }
  const fcBack = document.getElementById('fc-back');
  if (fcBack) {
    fcBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  const liDk = document.getElementById('li-deskcheck');
  if (liDk) {
    liDk.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const page = document.getElementById('page-deskcheck');
      if (page) page.hidden = false;
      if (dkView) dkView.ensureRendered();
    });
  }
  const dkBack = document.getElementById('dk-back');
  if (dkBack) {
    dkBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }

  // ---- 回复混入：供 chat.js 调用 ----
  // 返回当前分类下按权重选中一个分组的字卡数组；未触发返回 []
  // v3.12.x：核心逻辑抽成 getDefaultCardsFor(st)——st 传目标桌面 store；
  //   群聊用它按成员所在桌面抽取（成员桌面关了聊天使用 → 该成员在群聊里也不用默认字卡）
  // v3.28.x：scene 参数化——概率/场景开关按场景读（chat/mail/feed；缺省 chat）。
  //   drawCards 目前仅聊天类调用（getDefaultCards*），写信/朋友圈各走自己的消费逻辑
  function drawCards(a, scene, st) {
    scene = scene || 'chat';
    if (LOCKED()) return []; // #319 锁定＝不抽任何系统预设字卡
    // v3.7.x：场景开关——关闭后该场景不混入默认字卡
    if (!a.use(scene)) return [];
    const cfg = a.cfg();
    if (!cfg.enabled) return [];
    let overall = cfg.overallFor ? cfg.overallFor(scene) : cfg.overall;
    // #518：聊天场景套「系统预设字卡总档」缩放（生效=设定值×总档÷100，dcp-master.js）；
    // 信箱/朋友圈场景不走总档（总档只管聊天触发）。st 透传给 dcpAll 保证群聊按成员桌面取总档。
    if (scene === 'chat') overall = (window.dcpEff ? window.dcpEff(overall, st) : overall);
    if (Math.random() * 100 >= overall) return [];
    // 按 probs 加权选分类（v3.8.x：已关闭的分类权重按 0 处理，不参与抽取）
    const keys = ['main', 'kaomoji', 'emoji', 'touch'];
    const weights = keys.map(k => (a.cat(k) ? Math.max(0, cfg.probs[k] || 0) : 0));
    const total = weights.reduce((x, y) => x + y, 0);
    if (total <= 0) return [];
    let roll = Math.random() * total;
    let chosen = 'main';
    for (let i = 0; i < keys.length; i++) {
      roll -= weights[i];
      if (roll < 0) { chosen = keys[i]; break; }
    }
    // v3.6.x：单卡开关过滤——用户关闭的字卡不参与抽取，整组关完则跳过该组
    const grps = (DATA[chosen] || [])
      .map(g => [g[0], g[1].filter(c => !a.isOff(chosen, c))])
      .filter(g => g[1].length);
    if (!grps.length) return [];
    const g = grps[Math.floor(Math.random() * grps.length)];
    const text = g[1][Math.floor(Math.random() * g[1].length)];
    return { text: text, type: chosen === 'touch' ? 'poke' : 'text' };
  }
  window.getDefaultCardsFor = function (st, scene) { return drawCards(apiFor(st), scene, st); };
  window.getDefaultCards = function (scene) { return drawCards(api, scene); };
  // 默认字卡分组（供页面按分组查看）
  window.getDefaultCardGroups = function (cat) {
    if (LOCKED()) return []; // #319 锁定＝系统预设字卡不存在
    return (DATA[cat] || []).slice();
  };
  // v3.7.x：互动回应预设池读取（供互动卡片回复侧使用）——name 分组名（邀请TA·接受/
  // 邀请TA·拒绝/问问TA·回应/小问题·回应/好奇·回应/吐槽·回应/询问·回应），
  // 与「互动回应」tab 展示同源（DEFAULT_CARD_DATA.interact）；数据缺失时回退 fallback
  // v3.13.x：泛化为 getLibPool(分类, 分组, 兜底)——摸鱼浮字/花园/同频/伸手/喝水/存钱罐
  // 各功能统一走它取同源池（消费侧再按 isDefaultCardOff(分类, 文案) 过滤已关卡片）
  // v3.32.x：并入用户自建的功能字卡（字卡库→可自定义字卡→其他互动功能字卡，存 cc-groups
  // 功能分类字段）——自定义卡追加在同源池后一起随机抽取；非功能分类/无自定义时不影响原行为
  window.getLibPool = function (cat, group, fallback, exemptLock) {
    if (LOCKED() && !exemptLock) { // #319 锁定＝只回自建功能字卡，内置同源池与 fallback 兜底都不给
      try { return (window.getCustomFuncCards && window.getCustomFuncCards(cat)) || []; } catch (e) { return []; }
    }
    const g = (DATA[cat] || []).find(x => x[0] === group);
    let arr = g && Array.isArray(g[1]) && g[1].length ? g[1] : (Array.isArray(fallback) ? fallback : []);
    arr = arr.slice();
    // FIX 2026-09-30 #1498 消费端总闸下沉到取池口（本函数原先只「取组」、过滤全靠每个调用方自己
    //   记着过 isDefaultCardOff）：auction（拍卖）／五子棋／连线／消消乐／四子棋／记忆翻牌／钓鱼／
    //   音乐 等 8 个模块与 chat.js「吐槽·回应」、ta-ask.js「询问·回应」等处是**裸抽**
    //   （getInteractPool(name, fb) 后直接 pool[random]），用户逐张关闭或整组停用「互动回应」
    //   字卡后它们照旧使用（用户报障「设置了禁止使用的字卡，联系人还是能使用」的多机型同现）。
    //   这里对【预设组内容 + 兜底数组】这一半统一过闸——已过滤的调用方再过滤一次是幂等的
    //   （同口径三次过滤结果不变），裸抽的调用方从此自动跟上。自建功能字卡不过此闸：
    //   它们由 cc-groups-off / cc-groups-public-off 管（见 getCustomFuncCards，已各自剔除停用分组）。
    try { const off = window.isDefaultCardOff; if (off) arr = arr.filter(c => !off(cat, c)); } catch (e) {}
    try {
      const cf = (window.getCustomFuncCards && window.getCustomFuncCards(cat)) || [];
      if (cf.length) arr = arr.concat(cf);
    } catch (e) {}
    return arr;
  };
  // FIX 2026-09-30 #1498 兜底池必须同过一道闸（与 getLibPool 同一判据，零机型分支）：
  //   各功能模块自带的 FB/DEF_* 兜底数组，多数就是数据组内容的旧拷贝——实测「花园→梦角悄悄话」
  //   组内 7 条与 GB 的 WM 兜底 7 条**逐字重合**、「喝水→梦角催喝水」组内 18 条里兜底 6 条全重合。
  //   原写法「过闸后为空 ⇒ 回落兜底」于是把用户刚关掉的同一批句子又捡回来，逐张关光/整组停用
  //   等于没关（用户报障「设置了禁止使用的字卡，联系人还是能使用」）。统一出口：兜底也过闸，
  //   全关＝真停用（空数组、不出声）；只有数据文件缺该分组时兜底才真有货。
  window.gateCardFallback = function (cat, fallback) {
    try {
      const arr = Array.isArray(fallback) ? fallback.slice() : [];
      const off = window.isDefaultCardOff;
      if (!off) return arr;
      return arr.filter(c => !off(cat, c));
    } catch (e) { return []; }
  };
  // #1422（作者 2026-09-29 定）：这六池原是 chat.js／feed.js 里写死的「互动必答句」，字卡库里
  //   没有页面——搜得到（旧的跨分类搜索钩子登记过）却看不到、也逐句关不掉。现并到
  //   字卡库→系统预设字卡→【其他互动功能字卡→互动回应】同名分组，与「邀请TA·接受／拒绝」
  //   「游戏胜负平·回应」同页同类；逐句开关（dc-off-interact:<文案>）与整组停用
  //   （dc-groups-off.interact）全部复用 #926/#1315 既有闸（isDefaultCardOff 一条同时认这两样）。
  // 三条与 getDeskCheckPool 不同的口径，都是刻意的：
  //   ① 豁免 #319 二级锁——婉拒与回应是交互的必需回应，锁定设备不能让「拒绝贴贴邀请后 TA 一句话都不回」；
  //   ② 不并自建功能字卡——「我发出的邀请」那组本就由「邀请TA」半框自己的分组表呈现，混进来＝同一批卡两处显示；
  //   ③ 分组成员全被关掉时返回空数组（＝真停用），不回落代码兜底；兜底只在数据文件缺该分组时用。
  window.getPresetGroupLines = function (group, fallback) {
    let arr = [];
    try {
      const g = ((window.DEFAULT_CARD_DATA || {}).interact || []).find(x => x && x[0] === group);
      arr = g && Array.isArray(g[1]) && g[1].length ? g[1].slice() : (Array.isArray(fallback) ? fallback.slice() : []);
    } catch (e) { arr = Array.isArray(fallback) ? fallback.slice() : []; }
    const off = window.isDefaultCardOff;
    return off ? arr.filter(c => !off('interact', c)) : arr;
  };
  window.getInteractPool = function (name, fallback) {
    return window.getLibPool('interact', name, fallback);
  };
  window.getFishPool = function (name, fallback) {
    return window.getLibPool('fish', name, fallback);
  };
  // v3.17.x：桌面查岗回应字卡池（跨桌面「来消息」查岗——回复后按概率抽取，见 chat.js）
  // v3.18.x：按方向取池——dir 'meToTa'（联系人申请我对联系人查岗）抽「联系人申请我对
  // 联系人查岗」分组，否则（toMe / 未指定）抽「联系人对我查岗」分组，过滤已关卡片
  window.getDeskCheckPool = function (dir, fallback) {
    const group = dir === 'meToTa' ? '联系人申请我对联系人查岗' : '联系人对我查岗';
    let arr = window.getLibPool('deskcheck', group, fallback);
    if (!arr.length && Array.isArray(fallback) && fallback.length) arr = fallback.slice();
    return arr.filter(c => !(window.isDefaultCardOff && window.isDefaultCardOff('deskcheck', c)));
  };
})();

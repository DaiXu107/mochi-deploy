// ===== 功能：日历（按星言日历逻辑复刻） =====
// 每日生成：今日心情（分类/描述）+ TA 正在做什么 + TA 留言（从字卡池随机拼）
// 每次首次打开日历触发 TA 留言弹窗；美化毛玻璃、无 emoji、矢量图标
// v3.7.x：月历日期可点击自选——选中日期后上方卡片显示该日内容（当天心情/TA正在/TA留言/我的留言），
//   任意日期首次访问自动生成当日内容并落盘（cal-YYYY-MM-DD）；我的留言仅今天可编辑。
// v3.12.x：每日内容只从「首次使用日」开始生成——此前任意历史日期首次被查看都会现场随机
//   生成并落盘（含上面的"历史日期也补齐"），从未用过本站的日期也显示心情感言。
//   现在早于首次使用日的日期不读不写不生成（与未来日期同口径空态），并在进日历页时
//   清理此前误生成的 cal-YYYY-MM-DD 残留数据。
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  const page = document.getElementById('page-calendar');
  if (!page) return;

  // ---- 数据（无 emoji，纯文字）----
  const MOODS = [
    { mood: '温柔', cat: '温暖', desc: '今天很温柔。' },
    { mood: '开心', cat: '温暖', desc: '今天心情很好。' },
    { mood: '愉快', cat: '温暖', desc: '今天过得很轻松。' },
    { mood: '满足', cat: '温暖', desc: '今天觉得很满足。' },
    { mood: '放松', cat: '温暖', desc: '今天慢慢放松着。' },
    { mood: '安心', cat: '温暖', desc: '今天很安心。' },
    { mood: '平静', cat: '平静', desc: '今天很平静。' },
    { mood: '安静', cat: '平静', desc: '今天想安静一点。' },
    { mood: '专注', cat: '平静', desc: '今天专注于眼前的事。' },
    { mood: '思考中', cat: '平静', desc: '今天一直在思考。' },
    { mood: '想念', cat: '想念', desc: '今天有些想你。' },
    { mood: '等待', cat: '想念', desc: '今天静静等着与你相遇。' },
    { mood: '期待', cat: '想念', desc: '今天期待着一点惊喜。' },
    { mood: '牵挂', cat: '想念', desc: '今天一直惦记着你。' },
    { mood: '疲惫', cat: '低落', desc: '今天有一点累。' },
    { mood: '孤单', cat: '低落', desc: '今天有些安静。' },
    { mood: '烦恼', cat: '低落', desc: '今天有些事情放不下。' },
    { mood: '精神很好', cat: '活跃', desc: '今天状态很好。' },
    { mood: '兴致高涨', cat: '活跃', desc: '今天充满热情。' },
    { mood: '充满动力', cat: '活跃', desc: '今天想做很多事情。' }
  ];
  const ACTIVITIES = [
    '看书', '整理书籍', '写东西', '记录想法', '工作中', '整理资料',
    '回复消息', '听音乐', '戴着耳机发呆', '哼着歌', '喝茶', '泡茶中',
    '喝点饮料', '吃点心', '吃饭中', '休息中', '小睡一会', '发呆',
    '想事情', '思考中', '放空自己', '散步', '看风景', '晒太阳',
    '吹吹风', '听雨声', '看夜空', '看照片', '放松中', '创作中',
    '整理照片', '看视频', '看电影', '找点事情做', '整理东西', '安静待着',
    '看着窗外', '等待中', '想着你', '回忆过去', '想靠近你', '陪着你',
    '等你来聊天', '在线中', '忙碌中', '想给你一点惊喜', '静静待着', '在这里等你'
  ];
  // 心情图标（矢量 SVG，替代 emoji）
  const MOOD_ICONS = {
    '温暖': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>',
    '平静': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    '想念': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
    '低落': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    '活跃': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S4.5 15.2 4.5 9.9A4.9 4.9 0 0112 7.1a4.9 4.9 0 017.5 2.8c0 5.3-7.5 10.6-7.5 10.6z"/></svg>'
  };

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // v3.42.x #426 日历留言纯文字口径（OPPO Reno6/雨见浏览器报「日历留言有乱码＝图片令牌」，多机型同族）：
  // ①选卡过滤补齐——#388 只守了自定义字卡循环，默认主字卡循环漏过滤，贴纸/语音型默认卡
  //   （「名称|||@@m:hash」「名称|||data:…」及裸令牌混排）照样拼进留言并持久化成乱码；
  // ②渲染端清洗——#388 之前已落盘的 cal-YYYY-MM-DD 存量留言含令牌/dataURL，textContent 直出乱码，
  //   统一剥成 [图片]（与 mail.js 剥图/#403 清洗链同口径），只洗显示、不改历史数据。
  // 判定用 indexOf('@@m:') 而非 mochiMediaIsToken：后者全串锚定，令牌嵌在长文本里测不出。
  function calTextOnly(c) {
    if (typeof c !== 'string' || !c) return false;
    if (c.indexOf('data:') === 0) return false;
    if (c.indexOf('|||') >= 0) return false;
    if (c.indexOf('@@m:') >= 0) return false;
    // FIX 2026-09-15 #533 链接导入的媒体字卡（裸 http(s) 图链）不是文字——旧判定放行，
    // 每日留言拼进正文即直出「http://…png」（与 chat.js getPool / mail.js 同批修复）
    if (/^https?:\/\//i.test(c)) return false;
    return true;
  }
  function calCleanMsg(s) {
    if (typeof s !== 'string') return s;
    return s.replace(/@@m:[0-9a-f]{32}/g, '[图片]').replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[图片]');
  }

  // 留言：从自定义聊天字卡 + 默认字卡池随机拼 3~8 条（无 emoji）
  // v3.6.x：过滤语音/图片字卡——语音字卡存储格式为「文件名|||audio;base64,...」，
  //   以文件名开头（indexOf('data:') 不为 0），旧逻辑漏过滤会把整段音频 base64
  //   拼进每日留言并持久化（几百 KB~数 MB，拖慢渲染且内容不可读）
  function genMessage() {
    const cards = [];
    const custom = (window.getCustomCards && window.getCustomCards()) || [];
    // v3.12.x：排除拍一拍字卡（getCustomCards 是全类型扁平视图，含【拍一拍】分组——
    //   "戳戳额头"类文本不该拼进每日留言；与 chat/feed/mail 回复池同口径）
    const pokeSet = (function () {
      try {
        const pk = (window.getPokeCards && window.getPokeCards()) || [];
        return pk.length ? new Set(pk) : null;
      } catch (e) { return null; }
    })();
    custom.forEach(c => {
      if (pokeSet && pokeSet.has(c)) return;
      // FIX 2026-09-13 #388 媒体池令牌卡不进每日留言池（同 chat.js #383 第三道守卫）
      // FIX 2026-09-13 #426 过滤收敛到 calTextOnly（补裸令牌混排；默认卡循环同口径）
      if (calTextOnly(c)) cards.push(c);
    });
    const defs = (window.getDefaultCardGroups && window.getDefaultCardGroups('main')) || [];
    // v3.8.x：默认字卡总开关 + 分类开关——关闭后每日留言不混入系统默认主字卡
    // v3.12.x：单卡开关过滤——用户在默认字卡页关掉的卡不再进留言（此前漏过滤）
    const dcfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
    const catOn = window.defaultCardCat ? window.defaultCardCat('main') : true;
    const isOff = window.isDefaultCardOff || null;
    if (dcfg.enabled !== false && catOn) {
      defs.forEach(([g, arr]) => { if (Array.isArray(arr)) arr.forEach(c => { if (isOff && isOff('main', c)) return; if (!calTextOnly(c)) return; cards.push(c); }); });
    }
    if (!cards.length) return '今天也想对你说点什么...';
    const maxCount = Math.min(8, cards.length);
    const minCount = Math.min(3, maxCount);
    const count = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
    const pool = cards.slice();
    const sel = [];
    for (let i = 0; i < count && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      sel.push(pool.splice(idx, 1)[0]);
    }
    return sel.join('  ');
  }

  // ---- 首次使用日（本桌面命名空间第一次真实使用的日期） ----
  // v3.12.x：推断口径——键名带日期后缀的真实使用痕迹（greeted-/cal-my-/memo-/today-mood-
  //   /day-fish-/day-work- 等每天使用都会留下的键）+ quote-history 最早日期，取最早者。
  //   刻意排除 cal-YYYY-MM-DD 本体（它正是「查看历史日期就补生成」的伪造源，cal-my- 是
  //   用户真实输入要保留）与 love-start 等手填纪念日（可能远早于建站，会把全部历史误清）。
  //   推断结果持久化 first-use-date；每次加载取 min(已存, 新推断) 自愈——首次推断时若
  //   IndexedDB 恢复未完成漏看了更早痕迹，下次打开自动把首用日前移。只前移不后移：
  //   已按更晚首用日清理过的日期本来就该为空，回填更早首用日不影响它们。
  function normDateStr(s) {
    const p = String(s || '').split('-');
    if (p.length !== 3) return null;
    const y = +p[0], m = +p[1], d = +p[2];
    if (!y || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function inferFirstUse() {
    const cands = [];
    // 键名扫描范围：当前命名空间 + default 桌面的旧版顶层键回退区（defaultStore 回退口径一致）
    try {
      const pref = window.activePrefix() + ':';
      const isDef = window.activePrefix() === 'xy-home-v2:default';
      const re = /(\d{4}-\d{1,2}-\d{1,2})$/;
      const ls = window.localStorage;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i) || '';
        let tail = null;
        if (k.indexOf(pref) === 0) tail = k.slice(pref.length);
        else if (isDef && k.indexOf('xy-home-v2:') === 0) {
          const rest = k.slice('xy-home-v2:'.length);
          if (rest.indexOf(':') < 0) tail = rest; // 迁移前的旧顶层键（无第二段冒号）
        }
        if (!tail || /^cal-\d/.test(tail)) continue;
        const m = re.exec(tail);
        if (m) { const n = normDateStr(m[1]); if (n) cands.push(n); }
      }
    } catch (e) {}
    try {
      const ql = JSON.parse(store.get('quote-history') || '[]');
      (Array.isArray(ql) ? ql : []).forEach(x => { if (x && x.date) { const n = normDateStr(x.date); if (n) cands.push(n); } });
    } catch (e) {}
    if (!cands.length) return null;
    cands.sort();
    return cands[0];
  }
  let _firstUse = null;
  function firstUseDate() {
    if (_firstUse) return _firstUse;
    let saved = null;
    try { saved = normDateStr(store.get('first-use-date') || ''); } catch (e) {}
    const inferred = inferFirstUse();
    _firstUse = (saved && inferred) ? (inferred < saved ? inferred : saved) : (saved || inferred || todayStr());
    if (_firstUse > todayStr()) _firstUse = todayStr(); // 脏数据兜底：首用日不可能在未来
    store.set('first-use-date', _firstUse);
    try { if (window.idbSet) window.idbSet(window.activePrefix() + ':first-use-date', _firstUse); } catch (e) {}
    return _firstUse;
  }
  // 清理历史上误生成的「首用日之前」心情感言条目（进日历页时跑一次，LS+IDB 双扫）
  let _cleanedOld = false;
  function cleanPreFirstEntries() {
    if (_cleanedOld) return;
    _cleanedOld = true;
    const fu = firstUseDate();
    const re = /^cal-(\d{4}-\d{2}-\d{2})$/;
    const tailOf = (k) => {
      try {
        const pref = window.activePrefix() + ':';
        if (k.indexOf(pref) === 0) return k.slice(pref.length);
        if (window.activePrefix() === 'xy-home-v2:default' && k.indexOf('xy-home-v2:') === 0) {
          const rest = k.slice('xy-home-v2:'.length);
          if (rest.indexOf(':') < 0) return rest;
        }
      } catch (e) {}
      return null;
    };
    try {
      const kill = [];
      const ls = window.localStorage;
      for (let i = 0; i < ls.length; i++) {
        const tail = tailOf(ls.key(i) || '');
        const m = tail ? re.exec(tail) : null;
        if (m && m[1] < fu) kill.push(m[1]);
      }
      kill.forEach(ds => { try { store.remove('cal-' + ds); } catch (e) {} });
    } catch (e) {}
    try {
      if (window.idbGetAllKeys && window.idbDelete) {
        window.idbGetAllKeys().then(keys => {
          (keys || []).forEach(k => {
            if (typeof k !== 'string') return;
            const tail = tailOf(k);
            const m = tail ? re.exec(tail) : null;
            if (m && m[1] < fu) { try { window.idbDelete(k); } catch (e) {} }
          });
        }).catch(() => {});
      }
    } catch (e) {}
  }

  // 生成或获取某一日数据（按日期持久化，首次访问该日期时生成并落盘）
  // v3.7.x：抽出 getDayEntry 供「本周日常点击其他日期查看当日内容」复用，
  //   任意日期首次访问都会生成 TA 心情/正在/留言并保存（历史日期也补齐）。
  // v3.7.x bugfix：未来日期不读不写不生成——本周日常点击未来日期会现场随机生成
  //   TA 内容并落盘（"超前显示"），且会污染该日期当天真实的首次生成。
  //   已误生成的未来数据同步清理（LS remove + IDB delete），否则到点当天会被回填复用。
  // v3.12.x：首用日之前的历史日期同样不读不写不生成——从未用过本站的日子不该有
  //   心情感言；该区间残留的旧补齐数据顺手清掉（全量清扫见 cleanPreFirstEntries）。
  function getDayEntry(dateStr) {
    if (!dateStr) return null;
    const p0 = dateStr.split('-');
    const d0 = new Date(+p0[0], +p0[1] - 1, +p0[2]);
    const n0 = new Date();
    if (d0 > new Date(n0.getFullYear(), n0.getMonth(), n0.getDate())) {
      try {
        const k = 'cal-' + dateStr;
        if (store.get(k)) store.remove(k);
        if (window.idbDelete) window.idbDelete(window.activePrefix() + ':' + k);
      } catch (e) {}
      return null;
    }
    if (dateStr < firstUseDate()) {
      try {
        const kb = 'cal-' + dateStr;
        if (store.get(kb)) store.remove(kb);
      } catch (e) {}
      return null;
    }
    const key = 'cal-' + dateStr;
    let entry = null;
    try { entry = JSON.parse(store.get(key) || 'null'); } catch (e) {}
    if (!entry) {
      const m = pick(MOODS);
      entry = {
        mood: m.mood, cat: m.cat, desc: m.desc,
        activity: pick(ACTIVITIES),
        message: genMessage(),
        date: dateStr
      };
      store.set(key, JSON.stringify(entry));
      // 手机端 localStorage 写入失败（空间满/隐私模式）时仍写入 IndexedDB 兜底
      try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + key, JSON.stringify(entry)); } catch (e) {}
    }
    return entry;
  }
  // 今日数据（本会话缓存，避免反复生成导致内容"变来变去"）
  let calCache = null;
  function getToday() {
    const ds = todayStr();
    if (calCache && calCache.date === ds) return calCache;
    calCache = getDayEntry(ds);
    return calCache;
  }
  // 暴露给 p2-features.js 的「本周日常」点击查看其他日期复用
  window.calGetDayEntry = getDayEntry;
  window.calGetMyMessage = function (ds) { return store.get('cal-my-' + ds) || ''; };

  // v3.6.x：多桌面——切换联系人后清掉本会话缓存（calCache 只按日期缓存、不区分
  // 桌面，残留会导致新桌面显示旧桌面的「今日数据」）；viewY/viewM/selDate 同步复位到当前月/今天
  document.addEventListener('contact-switched', function () {
    try { calCache = null; viewY = 0; viewM = -1; selDate = todayStr(); _firstUse = null; _cleanedOld = false; } catch (e) {}
  });

  // 渲染月历（可切换月份）
  let viewY = 0, viewM = -1; // 0=当前月
  // v3.7.x：点选日期查看当日内容——selDate 为当前查看的日期，默认今天
  let selDate = todayStr();
  // v3.12.x：有记录的日期打点（cal-rec）——「我们留言过/做过备忘等记录过信息」的日子与普通日区分，方便回找。
  // 只统计人工留下的内容：我的留言(cal-my-*)、备忘(memo-* / memo-history)、心情(today-mood-* / mood-history)。
  // TA 每日内容(cal-*)与每日情话(quote-history)是每天自动生成的、摸鱼/工作值是使用即累计的计数，
  // 计入会天天有点失去区分度，均不打点；喝水记录已有独立蓝点(cal-water)不重复。
  // memo-history/mood-history 老数据无按日快照，按 ts 落在哪天算哪天（口径同 renderDayNotes 的 histOnDay）。
  function dayRecordSet(y, m) {
    const set = new Set();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      if (store.get('cal-my-' + ds) || store.get('memo-' + ds) || store.get('today-mood-' + ds)) set.add(ds);
    }
    ['memo-history', 'mood-history'].forEach((hk) => {
      try {
        JSON.parse(store.get(hk) || '[]').forEach((x) => {
          if (!(x && x.ts && x.text)) return;
          const dt = new Date(x.ts);
          if (dt.getFullYear() === y && dt.getMonth() === m) {
            set.add(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'));
          }
        });
      } catch (e) {}
    });
    return set;
  }
  function renderGrid() {
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    const now = new Date();
    if (viewM < 0) { viewY = now.getFullYear(); viewM = now.getMonth(); }
    const y = viewY, m = viewM;
    const monthEl = document.getElementById('cal-month-txt');
    if (monthEl) monthEl.textContent = y + ' 年 ' + (m + 1) + ' 月';
    const first = new Date(y, m, 1);
    const days = new Date(y, m + 1, 0).getDate();
    const startWd = first.getDay();
    const wds = ['日', '一', '二', '三', '四', '五', '六'];
    let html = wds.map(w => '<span class="cal-wd">' + w + '</span>').join('');
    for (let i = 0; i < startWd; i++) html += '<span class="cal-cell blank"></span>';
    // 渲染前一次性收集当月有记录的日期（避免逐格扫历史列表）
    let recSet = null;
    try { recSet = dayRecordSet(y, m); } catch (e) { recSet = new Set(); }
    for (let d = 1; d <= days; d++) {
      const isToday = d === now.getDate() && y === now.getFullYear() && m === now.getMonth();
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      // v3.12.x：主日历不再显示经期信息（经期只在第三页「经期记录」独立功能的月历里展示），
      //   原 cal-period-* 着色与长按跳经期页一并移除
      // v3.11.x：喝水记录日打点（p2-features.js 暴露 waterDayHas）
      let wCls = '';
      try { if (window.waterDayHas && window.waterDayHas(ds)) wCls = ' cal-water'; } catch (e) {}
      const rCls = recSet.has(ds) ? ' cal-rec' : '';
      html += '<span class="cal-cell' + wCls + rCls + (isToday ? ' today' : '') + (ds === selDate ? ' sel' : '') + '" data-date="' + ds + '">' + d + '</span>';
    }
    grid.innerHTML = html;
  }
  // v3.7.x：点击日期自选 → 显示该日内容（当日心情 / TA 正在 / TA 留言 / 我的留言）
  // v3.12.x：移除「长按经期日格跳经期页」——主日历不再展示经期信息，经期查看/标记
  //   统一走第三页「经期记录」独立功能（其自带月历支持短按详情/长按标红）
  const calGridEl = document.getElementById('cal-grid');
  if (calGridEl) {
    calGridEl.addEventListener('click', (ev) => {
      const cell = ev.target.closest('.cal-cell');
      if (!cell || cell.classList.contains('blank')) return;
      const ds = cell.getAttribute('data-date');
      if (!ds || ds === selDate) return;
      selDate = ds;
      render();
    });
  }
  // 月份前进/后退
  const calPrev = document.getElementById('cal-prev');
  if (calPrev) calPrev.addEventListener('click', () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderGrid(); });
  const calNext = document.getElementById('cal-next');
  if (calNext) calNext.addEventListener('click', () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderGrid(); });

  // ---- 我的留言（仅今天可编辑）----
  function getMyMessage() {
    const v = store.get('cal-my-' + todayStr());
    return v || '';
  }
  function renderMyMessage() {
    const el = document.getElementById('cal-my-message');
    if (!el) return;
    const msg = store.get('cal-my-' + selDate);
    el.textContent = msg || (selDate === todayStr() ? '今天想说点什么...' : '这一天没有留下留言');
    const btn = document.getElementById('cal-edit-btn');
    if (btn) btn.hidden = selDate !== todayStr();
  }

  // v3.9.x：每日小记（TA 的情话 / 我的备忘 / 我的心情）——按选中日期只读查看。
  // 编辑仍在桌面小组件（今日情话系统生成；备忘/心情点桌面卡片改）；主页记录 tab 已移除，
  // 历史查看统一以日历按天切换为入口。未来日期只显示空态提示（与 getDayEntry 一致）。
  function renderDayNotes(dd, isFuture) {
    const futureTip = '这一天还没有内容';
    // 老版本没有按日快照（memo-YYYY-MM-DD / today-mood-YYYY-MM-DD），用历史列表按 ts 匹配当天
    const histOnDay = function (histKey) {
      try {
        const list = JSON.parse(store.get(histKey) || '[]');
        return list.filter(x => x && x.ts && new Date(x.ts).toDateString() === dd.toDateString())
          .map(x => x.text).filter(Boolean);
      } catch (e) { return []; }
    };
    // TA 的情话：quote-history 每天一条，按 date 字段匹配
    const qEl = document.getElementById('cal-quote');
    if (qEl) {
      if (isFuture) {
        qEl.textContent = futureTip;
      } else {
        let qt = '';
        try {
          const ql = JSON.parse(store.get('quote-history') || '[]');
          const hit = ql.find(x => x && x.date === selDate);
          qt = hit ? hit.text : '';
        } catch (e) {}
        // 当天还没存档（极端情况）：按当天种子现取一句
        if (!qt && selDate === todayStr()) {
          try { qt = (window.getQuoteOfDay && window.getQuoteOfDay()) || ''; } catch (e) {}
        }
        qEl.textContent = (qt || (selDate === todayStr() ? '今天还没有情话' : '这一天没有留下情话'));
        if (qEl.textContent && window.taFit) qEl.textContent = window.taFit(qEl.textContent);
      }
    }
    // 我的备忘 / 我的心情：按日快照优先，回退当天历史（多天多条用；连接）
    const memo = isFuture ? '' : (store.get('memo-' + selDate) || histOnDay('memo-history').join('；'));
    const mood = isFuture ? '' : (store.get('today-mood-' + selDate) || histOnDay('mood-history').join('；'));
    const memoEl = document.getElementById('cal-memo');
    if (memoEl) memoEl.textContent = isFuture ? futureTip : (memo || '这一天没有备忘');
    const moodEl = document.getElementById('cal-mood');
    if (moodEl) moodEl.textContent = isFuture ? futureTip : (mood || '这一天没有记录心情');
    // 摸鱼值 / 工作值（双方当天值）：fish-day-add / work-day-add 按天记录。
    // 注意 fishDayKey 的日期格式是 YYYY-M-D（无补零），需归一化后与 selDate（YYYY-MM-DD）匹配；
    // 今天读实时 day-fish-*/day-work-* 键（与桌面周末面板一致），历史日期读按天记录。
    const statsEl = document.getElementById('cal-stats');
    if (statsEl) {
      statsEl.style.whiteSpace = 'pre-line';
      if (isFuture) {
        statsEl.textContent = futureTip;
      } else {
        const norm = (s) => {
          const p = String(s).split('-');
          if (p.length !== 3) return String(s);
          return p[0] + '-' + String(+p[1]).padStart(2, '0') + '-' + String(+p[2]).padStart(2, '0');
        };
        const myName = store.get('lbl-user') || '我';
        const taName = store.get('lbl-partner') || 'TA';
        const isToday = selDate === todayStr();
        const dayKey = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
        const pickDay = (logKey) => {
          try {
            const list = JSON.parse(store.get(logKey) || '[]');
            return list.find(x => x && norm(x.date) === selDate) || null;
          } catch (e) { return null; }
        };
        let fm = 0, ft = 0, wm = 0, wt = 0;
        if (isToday) {
          const k = dayKey(dd);
          fm = parseInt(store.get('day-fish-' + k) || '0', 10) || 0;
          ft = parseInt(store.get('day-fish-ta-' + k) || '0', 10) || 0;
          wm = parseInt(store.get('day-work-' + k) || '0', 10) || 0;
          wt = parseInt(store.get('day-work-ta-' + k) || '0', 10) || 0;
        } else {
          const f = pickDay('fish-day-add');
          const w = pickDay('work-day-add');
          if (f) { fm = f.mine || 0; ft = f.ta || 0; }
          if (w) { wm = w.mine || 0; wt = w.ta || 0; }
        }
        const lines = [];
        if (fm || ft || isToday) lines.push('摸鱼值　' + myName + ' +' + fm + ' · ' + taName + ' +' + ft);
        if (wm || wt || isToday) lines.push('工作值　' + myName + ' +' + wm + ' · ' + taName + ' +' + wt);
        statsEl.textContent = lines.length ? lines.join('\n') : '这一天没有摸鱼 / 工作记录';
      }
    }
  }

  // 心情日记入口卡（#303）：实时预览「我」与「梦角」今日心情，来自 mood-diary.js 的 moodDiaryToday()
  function renderMoodEntry() {
    const entry = document.getElementById('cal-mood-entry');
    if (!entry) return;
    const mineEl = document.getElementById('mood-entry-mine');
    const taEl = document.getElementById('mood-entry-ta');
    const taLabel = document.getElementById('mood-entry-ta-label');
    let md = null;
    try { md = window.moodDiaryToday ? window.moodDiaryToday() : null; } catch (e) { md = null; }
    const nm = store.get('lbl-partner') || 'TA';
    if (taLabel) taLabel.textContent = nm + '（心情日记）';
    if (mineEl) mineEl.textContent = (md && md.mine) ? (md.mine.e + ' ' + md.mine.n) : '今天还没记心情';
    if (taEl) taEl.textContent = (md && md.ta) ? (md.ta.e + ' ' + md.ta.n) : '今天还没有互动';
  }

  function render() {
    try { ensureFishHeat(); } catch (e) {} // 摸鱼/工作「当日统计」随 selDate 切换刷新
    try { renderMoodEntry(); } catch (e) {}
    const parts = selDate.split('-');
    const dd = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    const n2 = new Date();
    // v3.7.x：未来日期不生成不读取内容，只显示空态提示（与本周日常一致），避免"超前显示"
    const isFuture = dd > new Date(n2.getFullYear(), n2.getMonth(), n2.getDate());
    const e = isFuture ? null : getDayEntry(selDate);
    // v3.12.x：首用日之前的过去日期与未来同口径——隐藏 TA/我卡只留一个空态卡；
    //   文案区分「还没到」与「当时还没开始使用」。小记/摸鱼等数据驱动卡片天然为空，
    //   不需要额外门控。
    const isBefore = !isFuture && !e && selDate < firstUseDate();
    cleanPreFirstEntries();
    // v3.10.x：UI 精简——未来日期隐藏 TA/我卡，只显示一个空态卡（不再 6 张卡各说一遍）
    const taCard = document.getElementById('cal-ta-card');
    const meCard = document.getElementById('cal-me-card');
    const emptyCard = document.getElementById('cal-empty-card');
    const emptyTxt = document.getElementById('cal-empty-txt');
    if (isFuture || isBefore) {
      if (taCard) taCard.hidden = true;
      if (meCard) meCard.hidden = true;
      if (emptyCard) emptyCard.hidden = false;
      if (emptyTxt) emptyTxt.textContent = isFuture ? '这一天还没有内容，等到了那一天再来看看吧' : '开始使用之前的日子，没有留下内容';
      renderGrid();
      return;
    }
    if (taCard) taCard.hidden = false;
    if (meCard) meCard.hidden = false;
    if (emptyCard) emptyCard.hidden = true;
    const dateEl = document.getElementById('cal-today-date');
    if (dateEl) dateEl.textContent = e ? e.date : selDate;
    const catEl = document.getElementById('cal-mood-cat');
    if (catEl) catEl.textContent = e ? e.cat : '未到来';
    const icoEl = document.getElementById('cal-mood-ico');
    if (icoEl) icoEl.innerHTML = MOOD_ICONS[e ? e.cat : '平静'] || MOOD_ICONS['平静'];
    const nameEl = document.getElementById('cal-mood-name');
    if (nameEl) nameEl.textContent = e ? e.mood : '未来';
    const descEl = document.getElementById('cal-mood-desc');
    if (descEl) descEl.textContent = e ? (window.taFit ? window.taFit(e.desc) : e.desc) : '这一天还没有内容';
    const actEl = document.getElementById('cal-activity');
    if (actEl) actEl.textContent = e ? (window.taFit ? window.taFit(e.activity) : e.activity) : '—';
    const msgEl = document.getElementById('cal-message');
    if (msgEl) msgEl.textContent = e ? (window.taFit ? window.taFit(calCleanMsg(e.message)) : calCleanMsg(e.message)) : '这一天还没有留言';
    renderMyMessage();
    renderDayNotes(dd, isFuture);
    renderGrid();
  }

  // ===== 日历页·摸鱼/工作「当日统计」条状图 =====
  // 数据源 fish-day-add / work-day-add（历史通过）+ 当天实时 day-fish-*/day-work-*。
  // 跟随日历选中日期（selDate）：日历上切到哪一天，本卡片就展示那一整天的完整统计。
  // 卡片动态创建、插在 #cal-empty-card 之后；render() 每次进入页面 / 切换日期时刷新。
  let _heatCard = null;
  function heatNorm(s) {
    const p = String(s || '').split('-');
    if (p.length !== 3) return null;
    const y = +p[0], m = +p[1], d = +p[2];
    if (!y || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    return new Date(y, m - 1, d);
  }
  function ensureFishHeat() {
    const emptyCard = document.getElementById('cal-empty-card');
    const meCard = document.getElementById('cal-me-card');
    const anchor = emptyCard || meCard;
    if (!anchor) return;
    if (!_heatCard) {
      _heatCard = document.createElement('div');
      _heatCard.className = 'cal-card glass';
      _heatCard.id = 'cal-fish-heat';
      _heatCard.innerHTML =
        '<div class="cal-sec">' +
          '<div class="cal-sec-head"><div class="cal-sec-title">摸鱼 · 工作（日统计）</div><span class="fh-range" id="fh-range"></span></div>' +
          '<div class="fh-bars" id="fh-wrap"></div>' +
        '</div>';
      anchor.parentNode.insertBefore(_heatCard, anchor.nextSibling);
    }
    const rangeEl = document.getElementById('fh-range');
    const wrap = document.getElementById('fh-wrap');
    if (!wrap) return;
    const parts = selDate.split('-');
    const dd = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    const n2 = new Date();
    const today0 = new Date(n2.getFullYear(), n2.getMonth(), n2.getDate());
    const isFuture = dd > today0;
    const isBefore = !isFuture && selDate < firstUseDate();
    // 空态（未来 / 首用日之前）：与日历其余卡片同口径
    if (isFuture || isBefore) {
      if (rangeEl) rangeEl.textContent = isFuture ? '这一天还没到来' : '开始使用之前没有记录';
      wrap.innerHTML = '<div class="fh-empty">' + (isFuture ? '等到了那一天再来看看吧' : '开始使用之前的日子没有摸鱼 / 工作记录') + '</div>';
      return;
    }
    if (rangeEl) rangeEl.textContent = (dd.getMonth() + 1) + ' 月 ' + dd.getDate() + ' 日 · 完整日统计';
    // 读取当天数值：今天读实时键，历史读按天记录（日期键无补零，需归一化匹配 selDate）
    const isToday = selDate === todayStr();
    const dayKey = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    const norm = (s) => {
      const p = String(s).split('-');
      if (p.length !== 3) return String(s);
      return p[0] + '-' + String(+p[1]).padStart(2, '0') + '-' + String(+p[2]).padStart(2, '0');
    };
    const pickDay = (logKey) => {
      try {
        const list = JSON.parse(store.get(logKey) || '[]');
        return list.find(x => x && norm(x.date) === selDate) || null;
      } catch (e) { return null; }
    };
    let fm = 0, ft = 0, wm = 0, wt = 0;
    if (isToday) {
      const k = dayKey(dd);
      fm = parseInt(store.get('day-fish-' + k) || '0', 10) || 0;
      ft = parseInt(store.get('day-fish-ta-' + k) || '0', 10) || 0;
      wm = parseInt(store.get('day-work-' + k) || '0', 10) || 0;
      wt = parseInt(store.get('day-work-ta-' + k) || '0', 10) || 0;
    } else {
      const f = pickDay('fish-day-add');
      const w = pickDay('work-day-add');
      if (f) { fm = f.mine || 0; ft = f.ta || 0; }
      if (w) { wm = w.mine || 0; wt = w.ta || 0; }
    }
    const myName = store.get('lbl-user') || '我';
    const taName = store.get('lbl-partner') || 'TA';
    if (!fm && !ft && !wm && !wt) {
      wrap.innerHTML = '<div class="fh-empty">这一天没有摸鱼 / 工作记录</div>';
      return;
    }
    const maxV = Math.max(fm, ft, wm, wt, 1);
    const pct = (v) => Math.max(4, Math.round(v / maxV * 100));
    const bars = [
      { label: '摸鱼 · ' + myName, v: fm, cls: 'fish' },
      { label: '摸鱼 · ' + taName, v: ft, cls: 'fish' },
      { label: '工作 · ' + myName, v: wm, cls: 'work' },
      { label: '工作 · ' + taName, v: wt, cls: 'work' }
    ];
    let html = '';
    bars.forEach(b => {
      html += '<div class="fh-bar-row ' + b.cls + '">' +
        '<span class="fh-label">' + b.label + '</span>' +
        '<div class="fh-track"><div class="fh-fill" style="width:' + pct(b.v) + '%"></div></div>' +
        '<span class="fh-val">+' + b.v + '</span>' +
      '</div>';
    });
    wrap.innerHTML = html;
  }

  // 桌面【日历】图标进入
  const calApp = document.querySelector('.app[data-app="calendar"]');
  if (calApp && page) {
    calApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      page.hidden = false;
      // 每次进入回到本月、回到今天
      viewM = -1;
      selDate = todayStr();
      render();
    });
  }
  // 编辑我的留言
  const editBtn = document.getElementById('cal-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      if (window.openModal) {
        window.openModal('编辑我的留言', getMyMessage(), (v) => {
          const val = (v || '').trim();
          if (val) {
            store.set('cal-my-' + todayStr(), val);
            renderMyMessage();
          }
        });
      }
    });
  }
  const calBack = document.getElementById('cal-back');
  if (calBack) {
    calBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const phonePage = document.getElementById('page-phone');
      if (phonePage) phonePage.hidden = false;
    });
  }

  // 打开 mochi 即触发 TA 今日留言（每天一次）
  // v3.5.25 修复"手机端一直触发"：localStorage 写失败（空间满/隐私模式）时旧逻辑每次都弹。
  // 现在：本会话内存标记只弹一次 + 标记双写 IndexedDB（下次加载经 idbRestore 回填，不再重复弹）
  // v3.6.x：由「居中遮罩弹窗」改为「顶部非阻塞横幅」——遮罩弹窗（modal-mask z-index 90 +
  // 全屏锁滚动）在开屏数据加载期间就已弹出，用户点「点击进入」后第一眼就是被遮罩盖住的
  // 桌面：点【聊天】等图标实际点在遮罩上，「什么都点不了」（iPhone Edge 反馈：桌面卡住、
  // 点聊天无反应；iPad 夸克反馈：全部页面卡住）。横幅不锁滚动、不遮操作，
  // 仅停留 8 秒自动收起，点击横幅打开日历页查看完整内容。
  (function () {
    const key = 'greeted-' + todayStr();
    let greeted = false; // 本会话只显示一次
    function openCalPage() {
      const calApp = document.querySelector('.app[data-app="calendar"]');
      if (!calApp || !page) return;
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      page.hidden = false;
      viewM = -1;
      selDate = todayStr();
      render();
    }
    function hideGreetBanner() {
      const el = document.getElementById('daily-greet');
      if (!el) return;
      el.hidden = true;
      clearTimeout(el._timer);
    }
    // FIX 2026-09-16 #587：横幅只属于桌面——它是 fixed 顶部浮层（top:12px、可高到百余 px），
    //   显示前门控本来就写了「仅桌面可见时展示」，但显示期用户切走它仍悬在最上面：实测压住
    //   音乐页顶部整段（「我的音乐库 / 歌单 / 我的收藏」三颗 tab + 返回 + 设置五处全部点不动，
    //   elementFromPoint 命中 daily-greet），与悬浮小框 #587 同族「浮层压住页面自己的按钮」。
    //   这里把同一条规则延续到显示期：离开桌面（#page-phone 隐藏）即收起，8 秒自收逻辑不变。
    (function () {
      const phonePageEl = document.getElementById('page-phone');
      if (!phonePageEl || typeof MutationObserver === 'undefined') return;
      try {
        new MutationObserver(function () { if (phonePageEl.hidden) hideGreetBanner(); })
          .observe(phonePageEl, { attributes: true, attributeFilter: ['hidden'] });
      } catch (e) {}
    })();
    function showGreetBanner(e2, name) {
      let el = document.getElementById('daily-greet');
      if (!el) {
        el = document.createElement('div');
        el.id = 'daily-greet';
        el.style.cssText = 'position:fixed;top:calc(12px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:89;width:min(330px,calc(100% - 24px));box-sizing:border-box;background:rgba(255,255,255,.97);border:1px solid rgba(0,0,0,.1);border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.12);padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;font-family:inherit;text-align:left;';
        const t = document.createElement('div');
        t.style.cssText = 'font-size:12px;font-weight:700;color:var(--ink,#111);margin-bottom:6px;';
        const b = document.createElement('div');
        b.style.cssText = 'font-size:12px;color:#666;line-height:1.6;white-space:pre-line;word-break:break-word;';
        el.appendChild(t); el.appendChild(b);
        el._t = t; el._b = b;
        el.addEventListener('click', () => { hideGreetBanner(); openCalPage(); });
        document.body.appendChild(el);
      }
      el._t.textContent = name + ' 的今日留言';
      // v3.27.x：追加梦角（TA）「心情日记」里今天的情绪（仅当天有交互才有；无则不加行）
      let mdLine = '';
      try {
        const md = window.moodDiaryToday ? window.moodDiaryToday() : null;
        if (md && md.ta) mdLine = '\n梦角（心情日记）：' + md.ta.e + ' ' + md.ta.n;
      } catch (e) { mdLine = ''; }
      const gbody = '今日心情：' + e2.mood + '（' + e2.cat + '）\nTA 正在：' + e2.activity + '\n\nTA 留言：\n' + calCleanMsg(e2.message) + mdLine;
      el._b.textContent = window.taFit ? window.taFit(gbody) : gbody;
      el.hidden = false;
      el.style.transition = 'none';
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(-8px)';
      requestAnimationFrame(() => {
        el.style.transition = 'opacity .25s ease, transform .25s ease';
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
      });
      clearTimeout(el._timer);
      el._timer = setTimeout(hideGreetBanner, 8000);
    }
    function doGreet() {
      // 多桌面：异步轮询期间切换联系人会把横幅/标记写到新桌面 → 捕获 cid 校验
      const myCid = window.__activeCid || 'default';
      greeted = true;
      store.set(key, '1');
      try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + key, '1'); } catch (e) {}
      // 等开屏关闭后再展示：数据加载 + 用户点「点击进入」通常 1-3s，过早弹出会被开屏
      // 盖住，8 秒自动收起多半已过期，用户根本看不到。轮询到开屏隐藏后 1s 再显示。
      const splashEl = document.getElementById('splash');
      const iv = setInterval(() => {
        if ((window.__activeCid || 'default') !== myCid) { try { clearInterval(iv); } catch (e) {} return; }
        if (!splashEl || splashEl.classList.contains('hide')) {
          clearInterval(iv);
          setTimeout(() => {
            if ((window.__activeCid || 'default') !== myCid) return;
            try {
              // 仅桌面可见时展示；聊天/其他页面或已有弹窗打开时不打扰（横幅随时可再进日历看）
              const phonePage = document.getElementById('page-phone');
              if (phonePage && phonePage.hidden) return;
              const mm = document.getElementById('modal-mask');
              const tc = document.getElementById('tc-mask');
              if ((mm && !mm.hidden) || (tc && !tc.hidden)) return;
            } catch (e) {}
            showGreetBanner(getToday(), store.get('lbl-partner') || 'TA');
          }, 1000);
        }
      }, 500);
      setTimeout(() => { try { clearInterval(iv); } catch (e) {} }, 30000); // 30s 兜底停止轮询
    }
    function maybeGreet() {
      if (greeted) return;
      if (store.get(key)) { greeted = true; return; }
      // localStorage 无标记：查 IndexedDB（防止 localStorage 写失败/被清导致每天重复弹）
      if (window.idbGet) {
        const myPrefix = window.activePrefix();
        window.idbGet(myPrefix + ':' + key).then(v => {
          if (window.activePrefix() !== myPrefix) return;
          if (v) { greeted = true; store.set(key, '1'); return; }
          if (greeted) return;
          doGreet();
        }).catch(() => { if (window.activePrefix() !== myPrefix) return; if (!greeted) doGreet(); });
      } else {
        doGreet();
      }
    }
    maybeGreet();
  })();
})();

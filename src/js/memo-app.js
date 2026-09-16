// ===== 备忘录（桌面第三页图标，纯动态注入；独立文件——与 p2-features.js 解耦避免同文件并发改动） =====
// 待办清单式备忘：添加 / 勾选完成 / 点文字多行编辑 / 置顶 / 删除 / 清已完成；
// 完成全部有 TA 夸夸 + 震动；可选「完成后自动发到聊天」（默认关，memo-app-send='1' 开）。
// 数据全局共享（所有桌面联系人互通一份，参照 fish-log/period 先例）：
// 键在 xy-home-v2 根命名空间——memo-app-items = JSON [{id,t,done,pin,ts}]、memo-app-send、
// memo-app-global-migrated（迁移幂等标记）。store.set 自动 LS+IDB 双写。
(function () {
  const GNS = 'xy-home-v2';
  function gStore() { try { return window.xyStore(GNS); } catch (e) { return null; } }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function editingNow() { return Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing')); }
  function toast(msg) {
    // v3.13.x：修复「字飞出页面」——原创建 id=memo-app-toast，而轻提示样式只定义在
    // #cc-toast（chat-pages.css），备忘录的 toast 完全无样式、以裸文本渲染在
    // body 末尾（手机框外右侧竖排大字）。改用全站共享的 #cc-toast（同 chat.js 等）。
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 1800);
  }
  // 与 p2-features 同频/伸手/喝水页同款开页方式：rAF 后隐藏 tabbar/状态栏并加 .full
  function openPage(pg) {
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    pg.hidden = false;
    requestAnimationFrame(() => {
      const tabbar = document.querySelector('.tabbar');
      const phone = document.querySelector('.phone');
      if (tabbar) tabbar.hidden = true;
      if (phone) phone.classList.add('no-statusbar');
      pg.classList.add('full');
    });
  }
  function backHome(pg) {
    if (pg) pg.classList.remove('full');
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const home = document.getElementById('page-phone');
    if (home) home.hidden = false;
  }

  const DEF_MEMO_ALLDONE = ['都做完啦，真棒', '全部完成，说到做到', '清零啦，奖励一个抱抱'];
  const DEF_MEMO_DONE = ['又完成一件，好棒', '进度 +1，继续呀', '完成啦'];
  const DEF_MEMO_ADD = ['记下来啦，我盯着你完成', '嗯，我记着了', '好的，一件一件来'];
  // FIX 2026-09-07 #237 添加备忘触发聊天提问：新增后 TA 在聊天里回应+追问一条
  //（此前聊天侧仅「勾选完成(开关默认关)/手动分享」两通道，新增零联动=用户报障）。
  // {m} = 备忘内容（发送时 memoClip 截断）
  const DEF_MEMO_ASK = [
    '记好啦：「{m}」，打算什么时候做呀？',
    '「{m}」收到了，我先盯着，做完跟我说一声？',
    '又记下一件：「{m}」，什么时候开始？',
    '「{m}」……记下了，可别让我催你哦'
  ];
  // FIX 2026-09-07 #238 备忘提醒：概率触发 TA 在聊天里催备忘（复刻吃饭提醒模式：
  // 开关+触发概率可调、每 4 分钟一掷、命中后至少隔 2 天、23:00–06:00 静默；
  // 间隔由用户反馈「不用提醒太频繁」从每日一次放宽为 2 天）。
  // 催办对象按紧急度挑：过期 > 今日到期 > 积压(>2天) > 普通待办；{m}=内容截断、{n}=过期天数
  const DEF_MEMO_REMIND = ['{m}——还躺在备忘录里哦，什么时候做呀？', '翻到你的备忘：「{m}」，别忘了它', '「{m}」还没完成呢，我先帮你记着', '叮——备忘提醒：「{m}」，要开始了吗？'];
  const DEF_MEMO_REMIND_DUE = ['「{m}」今天到期啦，别忘了', '提醒你：「{m}」就是今天哦', '「{m}」今天截止，来得及，快去吧'];
  const DEF_MEMO_REMIND_OVER = ['「{m}」已经过期 {n} 天了哦，今天补上吧', '「{m}」过期 {n} 天啦，要不清掉或改个日子？', '{n} 天前记的「{m}」，还打算做吗？'];

  // ---- 图标注入第三页 ----
  const host = (document.getElementById('page-phone') || {}).parentNode || document.body;
  const memoApp = document.createElement('div');
  memoApp.className = 'app'; memoApp.setAttribute('data-app', 'memo'); memoApp.setAttribute('data-desk-widget', 'app-memo');
  memoApp.innerHTML =
    '<div class="app-ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4.5h8a2 2 0 012 2V19a2 2 0 01-2 2H8a2 2 0 01-2-2V6.5a2 2 0 012-2z"/><path d="M9.5 3h5v3h-5z"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/></svg></div>' +
    '<div class="app-name">备忘录</div>';
  // 默认进第三页图标组。注意：全新冷启动时序里 buildDeskPages(DESK_PAGE_MIN 收缩) 会先把
  // 第三页整页（含 p3apps 组）短暂移进隐藏池、稍后由 accounting.js 的 ensureP3 找回归位——
  // 所以这里必须无条件 append 进当前网格节点（哪怕它在池里），随组一起回第三页；
  // 不能做「在池里就跳过」的守卫（那会让图标永远孤儿）。装修布局里若已单独摆放过
  // app-memo，随后的 applyDeskLayout 重应用会把节点挪到配置的位置。
  (function placeMemo() {
    const p3 = document.querySelector('.app-grid.p3-grid');
    if (p3) p3.appendChild(memoApp);
    try { if (window.applyDeskLayout) window.applyDeskLayout(); } catch (e) {}
  })();

  // ---- 备忘录页 ----
  const memoPage = document.createElement('div');
  memoPage.className = 'page'; memoPage.id = 'page-memo'; memoPage.hidden = true;
  memoPage.innerHTML =
    '<div class="chat-head"><span class="ch-back" id="memo-back"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span><span class="ch-name">备忘录</span></div>' +
    '<div class="memo-body">' +
      '<div class="memo-input-row"><input class="memo-inp" id="memo-inp" type="text" placeholder="记一件想做的事…" maxlength="200"><button class="memo-add" id="memo-add-btn">添加</button></div>' +
      '<div class="memo-remind-chips" id="memo-remind-chips"><span class="memo-rc" data-r="chat">聊天概率</span><span class="memo-rc" data-r="sysDue">到点弹窗</span><span class="memo-rc" data-r="contact">联系人弹窗</span></div>' +
      '<div class="memo-msg glass" id="memo-msg"></div>' +
      '<div class="memo-toolbar"><span class="memo-count" id="memo-count"></span><button class="memo-cleardone" id="memo-cleardone">清已完成</button></div>' +
      '<div class="memo-list" id="memo-list"></div>' +
      '<div class="memo-empty" id="memo-empty">还没有备忘<br>想做的事、要买的东西、突然的念头<br>都可以写在这里<br><button class="memo-send-btn" id="memo-empty-add" style="margin-top:8px">↓ 在下面输入框写第一条</button></div>' +
      '<div class="memo-manage"><button class="memo-send-btn" id="memo-send">完成发到聊天：关</button>' +
      '<button class="memo-send-btn" id="memo-remind">备忘提醒：开</button>' +
      '<button class="memo-send-btn" id="memo-remind-prob">提醒概率 2%</button></div>' +
    '</div>';
  host.appendChild(memoPage);

  // ---- 数据层：全局根命名空间（所有桌面联系人互通一份） ----
  function memoItems() { const s = gStore(); if (!s) return []; try { const a = JSON.parse(s.get('memo-app-items') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function memoSave(a) { const s = gStore(); if (s) try { s.set('memo-app-items', JSON.stringify(a)); } catch (e) {} }
  // 单条备忘提醒配置：老备忘无 remind 字段 → {chat:1}（保持现有全局催办行为不回归）；
  // 新备忘按新增时勾选写入。chat=聊天概率催办、sysDue=到点必定系统弹窗、contact=概率联系人弹窗。
  function memoRemindOf(it) {
    const r = it && it.remind;
    if (!r || typeof r !== 'object') return { chat: 1, sysDue: 0, contact: 0 };
    return { chat: r.chat ? 1 : 0, sysDue: r.sysDue ? 1 : 0, contact: r.contact ? 1 : 0 };
  }
  function memoSendOn() { const s = gStore(); try { return s.get('memo-app-send') === '1'; } catch (e) { return false; } }
  // #238 提醒配置存单键 JSON（根命名空间随 memo-app-* 全局共享；键名已登记 contacts.js EXCLUDE
  // 防 migrateLegacy 误迁）。en 默认开、prob 默认 2（同吃饭提醒）、last=上次提醒时刻
  //（v1 的 done='YYYY-MM-DD' 日标记自动迁移为该日 23:59:59 的时间戳，老数据不丢间隔起点）
  function memoRemindCfg() {
    const s = gStore(); let o = {};
    try { o = JSON.parse((s && s.get('memo-app-remind')) || '{}') || {}; } catch (e) { o = {}; }
    const p = parseInt(o.prob, 10);
    let last = Number(o.last) || 0;
    if (!last && typeof o.done === 'string' && o.done) { const d = new Date(o.done + 'T23:59:59'); last = isNaN(d.getTime()) ? 0 : d.getTime(); }
    return { en: o.en !== 0, prob: isNaN(p) ? 2 : Math.max(0, Math.min(100, p)), last: last };
  }
  function memoRemindSetCfg(patch) {
    const s = gStore(); if (!s) return;
    try { s.set('memo-app-remind', JSON.stringify(Object.assign(memoRemindCfg(), patch))); } catch (e) {}
  }
  function memoPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function memoClip(t, n) { return (t || '').length > n ? (t || '').slice(0, n) + '…' : (t || ''); }
  function memoDayStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // 临期/过期：due <= 今天（未完成才算）；返回 'overdue' | 'today' | null
  function memoUrgent(it) {
    if (!it || !it.due || it.done) return null;
    const t = memoDayStr(new Date());
    if (it.due < t) return 'overdue';
    if (it.due === t) return 'today';
    return null;
  }
  function memoOverdueDays(due) {
    const d1 = new Date(due + 'T00:00:00'); const d2 = new Date(); d2.setHours(0, 0, 0, 0);
    return Math.max(1, Math.round((d2 - d1) / 86400000));
  }
  function memoFmt(ts) { const d = new Date(ts); const p = (n) => (n < 10 ? '0' + n : '' + n); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function memoShowMsg(t) { const el = document.getElementById('memo-msg'); if (el) { el.classList.add('fade'); setTimeout(() => { el.textContent = t; el.classList.remove('fade'); }, 200); } }

  // ---- 全局共享迁移 + 误迁自愈（全部在本文件完成，不改 contacts.js——对方域） ----
  // ① 存量迁移：把各联系人命名空间（含 default）的 memo-app-* 合并进根键（按 id 去重、
  //    冲突取 ts 新者；发送开关任一桌面开过即全局开），合并后清理各桌面旧键，幂等标记防重跑。
  // ② 误迁自愈：contacts.js migrateLegacy 会把无冒号的根命名空间键当「旧顶层键」拷进
  //    default 桌面并删 LS 根键（memo-app-* 尚未加进其 EXCLUDE 列表）。这里每次启动
  //    检测：根键空而 default 有副本 → 写回根并删副本（与 migrateLegacy 内 bg-keepalive
  //    修复同套路）；根键有值而 default 残留旧副本 → 清掉副本。IDB 根键迁移时保留，
  //    idbRestore 会回填，数据不丢。AI-B 后续把三键加进 EXCLUDE 后自愈逻辑自然闲置。
  function memoMergeById(a, b) {
    const map = {};
    a.forEach(x => { if (x && x.id) map[x.id] = x; });
    b.forEach(x => { if (x && x.id) { const cur = map[x.id]; if (!cur || (x.ts || 0) > (cur.ts || 0)) map[x.id] = x; } });
    return Object.keys(map).map(k => map[k]);
  }
  function memoParseItems(raw) { try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function memoGlobalRepair() {
    const root = gStore(); if (!root) return;
    let def = null; try { def = window.xyStore(GNS + ':default'); } catch (e) {}
    if (!def) return;
    // 只做「LS 根键缺失 → 从 default 副本写回」。必须看裸 localStorage 而不是
    // root.get()——migrateLegacy 只删 LS（memoryCache 仍在），root.get 会被
    // memoryCache 掩盖误判「还有值」，导致 LS 根键永远补不回来。
    // default 命名空间的键既可能是 migrateLegacy 误迁副本（根键被吃），也可能是
    // 未迁移的旧版按桌面存量（合并前）——两种情况都不能在根键有值时贸然删
    // default 键，统一交给下方按 id 幂等合并处理，避免误删存量。
    ['memo-app-items', 'memo-app-send', 'memo-app-global-migrated'].forEach(k => {
      try {
        let lsRoot = null; try { lsRoot = localStorage.getItem(GNS + ':' + k); } catch (e) {}
        if (lsRoot === null) {
          const dv = def.get(k);
          if (dv !== null && dv !== undefined && dv !== '') { root.set(k, dv); }
        }
      } catch (e) {}
    });
  }
  function memoMigrateGlobal() {
    const root = gStore(); if (!root) return;
    memoGlobalRepair();
    try {
      if (root.get('memo-app-global-migrated') === '1') return;
      let merged = memoParseItems(root.get('memo-app-items'));
      let sendOn = root.get('memo-app-send') === '1';
      let touched = false;
      let contacts = [];
      try { contacts = (window.getContacts && window.getContacts()) || []; } catch (e) {}
      if (!contacts.length) contacts = [{ id: 'default' }];
      contacts.forEach(c => {
        const cid = c && c.id; if (!cid) return;
        let s = null; try { s = window.storeFor(cid); } catch (e) {}
        if (!s) return;
        try {
          const raw = s.get('memo-app-items');
          if (raw) {
            const arr = memoParseItems(raw);
            if (arr.length) { merged = memoMergeById(merged, arr); touched = true; }
            s.remove('memo-app-items');
          }
          if (s.get('memo-app-send') === '1') { sendOn = true; touched = true; }
          try { s.remove('memo-app-send'); } catch (e) {}
        } catch (e) {}
      });
      if (touched || merged.length) {
        root.set('memo-app-items', JSON.stringify(merged));
        if (sendOn) root.set('memo-app-send', '1');
      }
      root.set('memo-app-global-migrated', '1');
    } catch (e) {}
  }
  memoMigrateGlobal();
  try {
    // IDB 回填完成后重跑一次：根键/各桌面旧键可能只在 IDB 里（大键或 Edge LS 丢失场景）。
    // 另外 migrateLegacy（contacts.js，未把 memo-app-* 加 EXCLUDE 前）会在 restore-done
    // 后按 idbGet promise 异步逐键把根键拷进 default 并删 LS 根键——时序总晚于本文件
    // 的同步修复，所以再补两个延迟修复点把 LS 根键写回（幂等，纯 LS 补写，开销可忽略），
    // 保证备份导出（按 LS 前缀遍历）能直接带上根键。
    document.addEventListener('mochi-restore-done', function h() {
      document.removeEventListener('mochi-restore-done', h);
      memoMigrateGlobal();
      if (!memoPage.hidden) memoRender();
      [600, 2000].forEach(ms => { try { setTimeout(memoMigrateGlobal, ms); } catch (e) {} });
    });
  } catch (e) {}

  function memoRender() {
    const items = memoItems();
    const list = document.getElementById('memo-list');
    if (!list) return;
    list.innerHTML = '';
    const undone = items.filter(x => !x.done).length;
    const cnt = document.getElementById('memo-count');
    if (cnt) cnt.textContent = items.length ? ('共 ' + items.length + ' 条 · 待办 ' + undone) : '';
    const empty = document.getElementById('memo-empty');
    if (empty) empty.hidden = items.length > 0;
    // 展示顺序：置顶 > 临期/过期(未完成) > 未完成 > 已完成，同组保持原顺序
    const rank = (it) => (it.pin ? 8 : 0) + ((memoUrgent(it) && !it.done) ? 4 : 0) + (it.done ? 0 : 2);
    const rows = items.slice().sort((a, b) => rank(b) - rank(a));
    rows.forEach(it => {
      const row = document.createElement('div');
      row.className = 'memo-item glass' + (it.done ? ' done' : '') + (it.pin ? ' pinned' : '') + (memoUrgent(it) ? ' urgent' : '');
      const chk = document.createElement('span');
      chk.className = 'mm-check';
      chk.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      chk.addEventListener('click', () => {
        if (editingNow()) return;
        const a = memoItems(); const cur = a.find(x => x.id === it.id); if (!cur) return;
        cur.done = !cur.done; memoSave(a);
        if (cur.done) vibrate(8);
        memoRender();
        if (cur.done) {
          const arr = memoItems();
          if (arr.length && arr.every(x => x.done)) { vibrate([60, 40, 60]); memoShowMsg(memoPick(DEF_MEMO_ALLDONE)); }
          else if (Math.random() < 0.35) memoShowMsg(memoPick(DEF_MEMO_DONE));
          if (memoSendOn() && window.chatAddIn) { try { window.chatAddIn('✓ 完成啦：「' + cur.t + '」'); } catch (e) {} }
        }
      });
      const main = document.createElement('div'); main.className = 'mm-main';
      const txt = document.createElement('div'); txt.className = 'mm-text'; txt.textContent = it.t || '';
      txt.addEventListener('click', () => {
        if (editingNow()) return;
        if (!window.openModal) return;
        window.openModal('编辑备忘', it.t, (v) => {
          const val = (v || '').trim(); if (!val) return;
          const a = memoItems(); const cur = a.find(x => x.id === it.id); if (!cur) return;
          cur.t = val.slice(0, 500); cur.ts = Date.now(); memoSave(a); memoRender();
        }, { textarea: true });
      });
      const tm = document.createElement('div'); tm.className = 'mm-time';
      // 时间行：截止信息（过期红/今天橙）+ 原记录时间
      const urg = memoUrgent(it);
      if (it.due && !it.done) {
        if (urg === 'overdue') { tm.textContent = '已过期 ' + memoOverdueDays(it.due) + ' 天 · ' + memoFmt(it.ts || Date.now()); tm.classList.add('due-overdue'); }
        else if (urg === 'today') { tm.textContent = '今天截止 · ' + memoFmt(it.ts || Date.now()); tm.classList.add('due-today'); }
        else tm.textContent = it.due + ' 截止 · ' + memoFmt(it.ts || Date.now());
      } else tm.textContent = memoFmt(it.ts || Date.now());
      main.appendChild(txt); main.appendChild(tm);
      // 提醒方式标志：勾选的显示小图标（聊天气泡/铃铛/联系人），点击进设置改提醒；
      // 老备忘 remind={chat:1} 总显示 chat 标志 → 总能点进设置，不会出现「无入口改提醒」
      const rr = memoRemindOf(it);
      if (rr.chat || rr.sysDue || rr.contact) {
        const rm = document.createElement('div'); rm.className = 'mm-remind-marks';
        const mkMark = (k) => {
          const m = document.createElement('span'); m.className = 'mm-rm ' + k;
          if (k === 'chat') m.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-9 8.5 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.2A8.38 8.38 0 0121 11.5z"/></svg>';
          else if (k === 'sysDue') m.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>';
          else m.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
          m.title = k === 'chat' ? '聊天概率提醒' : (k === 'sysDue' ? '到点弹窗提醒' : '联系人弹窗提醒');
          return m;
        };
        if (rr.chat) rm.appendChild(mkMark('chat'));
        if (rr.sysDue) rm.appendChild(mkMark('sysDue'));
        if (rr.contact) rm.appendChild(mkMark('contact'));
        rm.addEventListener('click', (e) => { e.stopPropagation(); memoEditRemind(it); });
        main.appendChild(rm);
      }
      // 截止日期：pills 快选（今天/明天/后天/周末/清除）
      const dueBtn = document.createElement('button');
      dueBtn.className = 'mm-act mm-due' + (it.due ? ' on' : ''); dueBtn.title = '截止日期';
      dueBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="2.5"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/></svg>';
      dueBtn.addEventListener('click', () => {
        if (editingNow()) return;
        if (!window.openModal) return;
        const d = new Date();
        const fmt = (off) => { const x = new Date(d.getTime() + off * 86400000); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const satOff = ((6 - d.getDay()) + 7) % 7 || 7;
        window.openModal('设置截止日期', '', (v) => {
          if (v === null || v === undefined) return;
          const a = memoItems(); const cur = a.find(x => x.id === it.id); if (!cur) return;
          cur.due = v === 'clear' ? null : v; memoSave(a); memoRender();
          toast(v === 'clear' ? '已清除截止' : '已设置截止');
        }, {
          noInput: true,
          staticText: '「' + memoClip(it.t, 14) + '」' + (it.due ? '当前截止：' + it.due : '未设置截止'),
          pills: [
            { label: '今天', value: fmt(0) }, { label: '明天', value: fmt(1) },
            { label: '后天', value: fmt(2) }, { label: '周末', value: fmt(satOff) },
            { label: '清除', value: 'clear' }
          ]
        });
      });
      // 单条分享到聊天
      const shr = document.createElement('button');
      shr.className = 'mm-act mm-share'; shr.title = window.taFit ? window.taFit('发给TA') : '发给TA';
      shr.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 3.5L10 13.5"/><path d="M21.5 3.5L15 21l-5-7.5-7.5-4z"/></svg>';
      shr.addEventListener('click', () => {
        if (editingNow()) return;
        if (!window.chatAddIn) { toast('聊天未就绪'); return; }
        const dueTxt = it.due ? '（' + it.due + ' 截止）' : '';
        try { window.chatAddIn('备忘 · ' + (it.t || '') + dueTxt); toast('已发送'); } catch (e) {}
      });
      const pin = document.createElement('button');
      pin.className = 'mm-act mm-pin' + (it.pin ? ' on' : ''); pin.textContent = '📌'; pin.title = it.pin ? '取消置顶' : '置顶';
      pin.addEventListener('click', () => {
        if (editingNow()) return;
        const a = memoItems(); const cur = a.find(x => x.id === it.id); if (!cur) return;
        cur.pin = !cur.pin; memoSave(a); vibrate(6); memoRender();
      });
      const del = document.createElement('button');
      del.className = 'mm-act mm-del'; del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'; del.title = '删除';
      del.addEventListener('click', () => {
        if (editingNow()) return;
        if (!window.openModal) { memoSave(memoItems().filter(x => x.id !== it.id)); memoRender(); return; }
        const short = (it.t || '').length > 16 ? (it.t || '').slice(0, 16) + '…' : (it.t || '');
        window.openModal('删除这条备忘？', '', () => { memoSave(memoItems().filter(x => x.id !== it.id)); memoRender(); toast('已删除'); }, { noInput: true, staticText: '「' + short + '」删除后无法恢复。' });
      });
      row.appendChild(chk); row.appendChild(main); row.appendChild(dueBtn); row.appendChild(shr); row.appendChild(pin); row.appendChild(del);
      list.appendChild(row);
    });
  }

  // v3.15.x：桌面第三页「备忘录」状态横幅已按用户要求删除（第三页改由
  // 今日备忘/今天的心情 两张整宽卡补齐三档节奏，与第一/二页对齐）；
  // 备忘录入口保留第三页图标 + 聊天更多功能。

  function memoAddFromInput() {
    if (editingNow()) return;
    const inp = document.getElementById('memo-inp'); if (!inp) return;
    const v = (inp.value || '').trim(); if (!v) { toast('先写点内容吧'); return; }
    const a = memoItems();
    a.unshift({ id: Date.now() + '-' + Math.floor(Math.random() * 1000), t: v.slice(0, 500), done: false, pin: false, due: null, ts: Date.now(), remind: { chat: memoAddRemindState.chat, sysDue: memoAddRemindState.sysDue, contact: memoAddRemindState.contact } });
    memoSave(a); inp.value = ''; memoRender();
    // FIX 2026-09-07 #237 添加备忘触发聊天提问：TA 侧即时回应+追问（带「备忘」来源 chip，
    // chatAddIn 自带未读数+桌面横幅/后台通知联动，不在聊天页也能被提醒；完成/分享通道不变）
    if (window.chatAddIn) { try { window.chatAddIn(memoPick(DEF_MEMO_ASK).replace('{m}', memoClip(v, 16)), { tag: '备忘' }); } catch (e) {} }
    if (Math.random() < 0.25) memoShowMsg(memoPick(DEF_MEMO_ADD));
  }
  // ---- TA 互动：催办（临期/积压）+ 偶尔帮你完成一件 ----
  function memoGreet() {
    const a = memoItems();
    const undone = a.filter(x => !x.done);
    if (!a.length) { memoShowMsg('把想做的事记下来，我帮你记着'); return; }
    // TA 帮完成：待办 ≥2 时 12% 概率帮你勾掉最旧的一条
    if (undone.length >= 2 && Math.random() < 0.12) {
      const target = undone.slice().sort((x, y) => (x.ts || 0) - (y.ts || 0))[0];
      target.done = true; memoSave(a); vibrate([40, 30, 40]); memoRender();
      memoShowMsg('帮你把「' + memoClip(target.t, 12) + '」打勾啦，剩下的加油');
      if (memoSendOn() && window.chatAddIn) { try { window.chatAddIn('✓ TA 帮你完成：「' + target.t + '」'); } catch (e) {} }
      return;
    }
    // 催办：有临期/过期未完成 → 45% 提醒
    const urgent = undone.filter(x => memoUrgent(x));
    if (urgent.length && Math.random() < 0.45) {
      const u = urgent[0];
      memoShowMsg(memoUrgent(u) === 'overdue'
        ? '「' + memoClip(u.t, 12) + '」已经过期了哦，今天补上吧'
        : '「' + memoClip(u.t, 12) + '」今天到期，别忘了');
      return;
    }
    // 积压：超过 2 天未完成的 → 30% 轻轻提一句
    const stale = undone.filter(x => Date.now() - (x.ts || 0) > 2 * 86400000);
    if (stale.length && Math.random() < 0.3) { memoShowMsg('有 ' + stale.length + ' 件事放了很久啦，先挑一件做掉？'); return; }
    if (undone.length) { if (Math.random() < 0.5) memoShowMsg('还有 ' + undone.length + ' 件没做完呢，慢慢来'); }
    else memoShowMsg(memoPick(DEF_MEMO_ALLDONE));
  }

  if (memoApp) memoApp.addEventListener('click', () => { if (editingNow()) return; openPage(memoPage); memoRender(); memoGreet(); setTimeout(memoSysDueCheck, 400); });
  document.getElementById('memo-back').addEventListener('click', () => backHome(memoPage));
  document.getElementById('memo-add-btn').addEventListener('click', memoAddFromInput);
  // 安卓输入框被转成 ce-box 后仍走 input.value / 原生事件代理；Enter 兜底走按钮路径
  try { document.getElementById('memo-inp').addEventListener('keydown', (e) => { if (e && (e.key === 'Enter' || e.keyCode === 13)) { e.preventDefault(); memoAddFromInput(); } }); } catch (e) {}
  document.getElementById('memo-cleardone').addEventListener('click', () => {
    if (editingNow()) return;
    const n = memoItems().filter(x => x.done).length;
    if (!n) { toast('没有已完成的'); return; }
    if (!window.openModal) { memoSave(memoItems().filter(x => !x.done)); memoRender(); return; }
    window.openModal('清掉已完成的？', '', () => { memoSave(memoItems().filter(x => !x.done)); memoRender(); toast('已清理 ' + n + ' 条'); }, { noInput: true, staticText: '将清除 ' + n + ' 条已完成备忘，无法恢复。' });
  });
  const memoSendBtn = document.getElementById('memo-send');
  if (memoSendBtn) {
    memoSendBtn.textContent = '完成发到聊天：' + (memoSendOn() ? '开' : '关');
    memoSendBtn.addEventListener('click', () => {
      const s = gStore(); const on = !memoSendOn();
      if (s) try { s.set('memo-app-send', on ? '1' : '0'); } catch (e) {}
      memoSendBtn.textContent = '完成发到聊天：' + (on ? '开' : '关');
    });
  }
  // ---- #238 备忘提醒（概率催办进聊天）：UI + 引擎 ----
  const memoRemindBtn = document.getElementById('memo-remind');
  const memoRemindProbBtn = document.getElementById('memo-remind-prob');
  function memoRenderRemind() {
    const c = memoRemindCfg();
    if (memoRemindBtn) memoRemindBtn.textContent = '备忘提醒：' + (c.en ? '开' : '关');
    if (memoRemindProbBtn) memoRemindProbBtn.textContent = '提醒概率 ' + c.prob + '%';
  }
  function memoRemindFire() {
    // v3.42.x #422：备忘提醒在自带「备忘提醒」开关/概率之上，追加「其他互动功能字卡」里的
    //   备忘提醒概率门控（dcf-memo，默认 100%＝保持原节奏，0%＝完全不催备忘；随联系人桌面隔离）。
    try { if (Math.random() * 100 >= (window.dcfGet ? window.dcfGet('memo') : 100)) return; } catch (e) {}
    const undone = memoItems().filter(x => !x.done);
    // 只催勾了「聊天概率」或「联系人弹窗」的备忘（老备忘无 remind 视为 chat:1 兼容，行为不回归）
    const cand = undone.filter(x => { const r = memoRemindOf(x); return r.chat || r.contact; });
    if (!cand.length) return;
    const over = cand.filter(x => memoUrgent(x) === 'overdue');
    const due = cand.filter(x => memoUrgent(x) === 'today');
    const stale = cand.filter(x => !memoUrgent(x) && Date.now() - (x.ts || 0) > 2 * 86400000);
    const pool = over.length ? over : (due.length ? due : (stale.length ? stale : cand));
    const it = pool[Math.floor(Math.random() * pool.length)];
    const bank = over.length ? DEF_MEMO_REMIND_OVER : (due.length ? DEF_MEMO_REMIND_DUE : DEF_MEMO_REMIND);
    const text = memoPick(bank).replace('{m}', memoClip(it.t || '', 16)).replace('{n}', String(memoOverdueDays(it.due || memoDayStr(new Date()))));
    // 呈现：只勾 chat→聊天流 chatAddIn；只勾 contact→联系人弹窗；都勾→随机选一种
    const fr = memoRemindOf(it);
    const useContact = fr.contact && (!fr.chat || Math.random() < 0.5);
    if (useContact) memoContactPopup(text);
    else if (window.chatAddIn) { try { window.chatAddIn(text, { tag: '备忘提醒' }); } catch (e) {} }
    vibrate([80, 60, 80]);
    memoRemindSetCfg({ last: Date.now(), done: '' }); // 发出即记录时刻，至少隔 2 天再提醒（#238 用户反馈不用太频繁）
  }
  // ---- 联系人弹窗（区别于 openModal 系统通知样式：居中 + 联系人头像 + 昵称 + 聊天气泡） ----
  function memoContactPopup(text) {
    let old = document.getElementById('memo-contact-mask'); if (old) old.remove();
    const mask = document.createElement('div'); mask.id = 'memo-contact-mask'; mask.className = 'memo-contact-mask';
    const card = document.createElement('div'); card.className = 'memo-contact-card';
    let s = null; try { s = window.activeStore && window.activeStore(); } catch (e) {}
    const name = (s && s.get('lbl-partner')) || (window.taFit ? window.taFit('TA') : 'TA');
    const av = (s && s.get('avatar-partner')) || '';
    const head = document.createElement('div'); head.className = 'mc-head';
    const avEl = document.createElement('div'); avEl.className = 'mc-av' + (av ? '' : ' ph');
    if (av) { avEl.style.backgroundImage = 'url("' + av + '")'; } else avEl.textContent = (name || 'T').slice(0, 1);
    const nm = document.createElement('div'); nm.className = 'mc-name'; nm.textContent = name;
    head.appendChild(avEl); head.appendChild(nm);
    const bubble = document.createElement('div'); bubble.className = 'mc-bubble'; bubble.textContent = text;
    const close = document.createElement('button'); close.className = 'mc-close'; close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    card.appendChild(close); card.appendChild(head); card.appendChild(bubble);
    mask.appendChild(card); document.body.appendChild(mask);
    try { document.body.classList.add('scroll-lock'); } catch (e) {}
    let timer = 0;
    const dismiss = () => { clearTimeout(timer); mask.remove(); try { document.body.classList.remove('scroll-lock'); } catch (e) {} };
    close.addEventListener('click', dismiss);
    mask.addEventListener('click', (e) => { if (e.target === mask) dismiss(); });
    timer = setTimeout(dismiss, 8000);
  }
  // ---- 到点必定触发系统弹窗（sysDue）：到截止当天、未完成、勾了 sysDue、今天未弹过 → openModal 必弹一次 ----
  function memoSysDueCheck() {
    try {
      if (!window.openModal) return;
      const c = memoRemindCfg();
      if (!c.en) return; // 受全局「备忘提醒」总开关控制（关了全不弹）
      const today = memoDayStr(new Date());
      const a = memoItems();
      const hits = a.filter(x => x && !x.done && x.due === today && memoRemindOf(x).sysDue && x.sysDueShown !== today);
      if (!hits.length) return;
      hits.sort((x, y) => (x.ts || 0) - (y.ts || 0)); // 最早记录的先弹
      const it = hits[0];
      it.sysDueShown = today; memoSave(a);
      window.openModal('备忘到点提醒', '', () => {}, { noInput: true, staticText: '「' + memoClip(it.t, 40) + '」今天截止，别忘了做哦' });
      vibrate([60, 40, 60]);
    } catch (e) {}
  }
  // ---- 行内提醒标志点击：弹设置改该条提醒方式（pills 点一项切换其开关） ----
  function memoEditRemind(it) {
    if (editingNow()) return;
    if (!window.openModal) return;
    const r = memoRemindOf(it);
    const labels = { chat: '聊天概率提醒', sysDue: '到点弹窗提醒', contact: '联系人弹窗提醒' };
    const pills = ['chat', 'sysDue', 'contact'].map(k => ({ label: labels[k] + (r[k] ? ' · 开' : ' · 关'), value: k }));
    window.openModal('提醒方式', '', (v) => {
      if (!v) return;
      const a = memoItems(); const cur = a.find(x => x.id === it.id); if (!cur) return;
      const rr = memoRemindOf(cur); rr[v] = rr[v] ? 0 : 1; cur.remind = rr; memoSave(a); memoRender();
      toast(rr[v] ? '已开启' : '已关闭');
    }, { noInput: true, staticText: '「' + memoClip(it.t, 18) + '」  点一项切换开关', pills: pills, pillSubmit: true });
  }
  function memoRemindTick() {
    try {
      const c = memoRemindCfg();
      if (!c.en || c.prob <= 0) return;
      const h = new Date().getHours(); if (h >= 23 || h < 6) return; // 深夜静默，同吃饭提醒
      if (Date.now() - c.last < 2 * 86400000) return; // 至少隔 2 天，不用太频繁（#238 用户反馈）
      if (Math.random() * 100 >= c.prob) return;
      memoRemindFire();
    } catch (e) {}
  }
  memoRenderRemind();
  if (memoRemindBtn) memoRemindBtn.addEventListener('click', () => {
    if (editingNow()) return;
    const on = !memoRemindCfg().en;
    memoRemindSetCfg({ en: on ? 1 : 0 }); memoRenderRemind();
    toast(on ? '已开启：TA 会偶尔在聊天里提醒你的备忘' : '已关闭：TA 不再提醒备忘');
  });
  if (memoRemindProbBtn) memoRemindProbBtn.addEventListener('click', () => {
    if (editingNow()) return;
    if (!window.openModal) return;
    window.openModal('提醒触发概率（%）', String(memoRemindCfg().prob), (v) => {
      if (v === null || v === '') return;
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0 || n > 100) { toast('请输入 0-100 的整数'); return; }
      memoRemindSetCfg({ prob: n }); memoRenderRemind();
      toast(n <= 0 ? '已设置：基本不会触发' : '已设置：每 4 分钟掷一次，命中后至少隔 2 天再提醒');
    });
  });
  // ---- 新增备忘提醒勾选 chip（输入框下方常驻三个，勾选状态带入新备忘） ----
  // 默认 chat 开（保持现有体验）、sysDue/contact 关（新功能按需）；状态跨多次添加保留
  const memoAddRemindState = { chat: 1, sysDue: 0, contact: 0 };
  const chipsEl = document.getElementById('memo-remind-chips');
  function memoRenderChips() {
    if (!chipsEl) return;
    Array.prototype.forEach.call(chipsEl.querySelectorAll('.memo-rc'), el => {
      el.classList.toggle('on', !!memoAddRemindState[el.getAttribute('data-r')]);
    });
  }
  if (chipsEl) {
    chipsEl.addEventListener('click', (e) => {
      const el = e.target.closest('.memo-rc'); if (!el) return;
      if (editingNow()) return;
      const k = el.getAttribute('data-r');
      memoAddRemindState[k] = memoAddRemindState[k] ? 0 : 1;
      memoRenderChips(); vibrate(5);
    });
    memoRenderChips();
  }
  window.memoRemindTickNow = memoRemindTick; // 手动/回归验证触发口（同 triggerTaInviteNow 惯例）
  setTimeout(memoRemindTick, 60000);
  setInterval(memoRemindTick, 240000); // 每 4 分钟一掷（同吃饭提醒），命中且当天未提醒过才发
  setInterval(memoSysDueCheck, 300000); // 到点弹窗每 5 分钟检查（必定触发，打开应用/回前台亦检查）
  document.addEventListener('mochi-fg-resume', function () { setTimeout(memoRemindTick, 2000 + Math.floor(Math.random() * 4000)); setTimeout(memoSysDueCheck, 1500); }); // 回前台补触发（同 ta-ask 通道）
  document.addEventListener('contact-switched', () => { if (!memoPage.hidden) memoRender(); });
})();

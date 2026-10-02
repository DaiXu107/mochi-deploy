// ===== 功能：游乐室（聊天页更多功能 → 小游戏 → 游乐室） =====
// 小游戏聚合成就页 + 每日幸运游戏 + 跨游戏「限定摆件」掉落收藏（#301）。
// 三件事：
//   1) 成就页：聚合各游戏战绩（每联系人桌面 localStorage 现有键，只读不改）+
//      徽章墙 + 拍卖会 🎒 收藏数 + 限定摆件图鉴（_owned_ 高亮 / 未得灰显）。
//   2) 每日幸运游戏：按日期固定种子选一款，当天该游戏奖励 ×2（各游戏发放处调
//      window.arcadeMult(key)；日封顶键照常生效，翻倍的是「这次发放额」）。
//      幸运日实际玩过 → window.arcadeMarkLuckyPlayed(key) 记一笔（幸运星徽章）。
//   3) 跨游戏掉落：胜利时各游戏调 window.arcadeTryDrop(src)——8% 概率掉一枚
//      「限定摆件」进共享收藏（prefix:arcade-drops，只收没收藏过的），返回掉落
//      信息供游戏内气泡/结算展示；没掉返回 null。
// 本文件只读其他游戏的存储键 + 提供上述三个全局助手；不改动任何游戏逻辑。
// 入口绑定在本文件内完成（不改 chat.js），半框容器复用 .poke-card 与 .pong-overlay 组件。
(function () {
  const panel = document.getElementById('chat-arcade-panel');
  if (!panel) return;
  const bodyEl = document.getElementById('arc-body');
  const closeBtn = document.getElementById('arc-close');
  const partnerNameEl = document.getElementById('arc-partner-name');
  // v3.26.x：独立全屏游乐室页（主页页入口卡进入，返回回主页页；渲染复用下方 renderAt）
  const pageEl = document.getElementById('page-arcade');
  const pageBodyEl = document.getElementById('arcade-body');
  const lgPartnerNameEl = document.getElementById('arcade-lg-partner');

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }

  // ---- 幸运游戏（日期固定：同一天全天是同一款） ----
  // FIX 2026-09-16：补入钓鱼/合作扫雷/打砖块（原 8 款漏了这 3 款——幸运池/打卡/战绩聚合都不含它们）
  const LUCKY_KEYS = [
    { k: 'pong', name: 'Pong' }, { k: 'snake', name: '双人贪吃蛇' }, { k: 'c4', name: '四子棋' },
    { k: 'memory', name: '记忆翻牌' }, { k: 'gomoku', name: '五子棋' }, { k: 'linkup', name: '连连看' },
    { k: 'match3', name: '消消乐' }, { k: 'auction', name: '心意币拍卖会' },
    { k: 'fishing', name: '双人钓鱼' }, { k: 'ms', name: '合作扫雷' }, { k: 'brick', name: '双人打砖块' }
  ];
  function luckyKey() {
    const d = today();
    let h = 0;
    for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
    return LUCKY_KEYS[h % LUCKY_KEYS.length].k;
  }
  window.arcadeLuckyKey = luckyKey;
  window.arcadeLuckyName = function () {
    const k = luckyKey();
    const hit = LUCKY_KEYS.filter((x) => x.k === k)[0];
    return hit ? hit.name : k;
  };
  // 各游戏发放处调用：幸运日 ×2（拍卖会特殊——幸运日是「TA 手松」打折，由其自行用 0.8 系数）
  window.arcadeMult = function (key) { return key === luckyKey() ? 2 : 1; };
  const LUCKY_MARK_KEY = () => prefix() + ':arcade-lucky-mark';
  window.arcadeMarkLuckyPlayed = function (key) {
    if (key !== luckyKey()) return;
    try { localStorage.setItem(LUCKY_MARK_KEY(), JSON.stringify({ date: today(), key: key })); } catch (e) {}
  };
  function luckyPlayedToday() {
    try { const v = JSON.parse(localStorage.getItem(LUCKY_MARK_KEY()) || ''); return !!(v && v.date === today() && v.key === luckyKey()); } catch (e) { return false; }
  }

  // ---- 跨游戏限定摆件掉落 ----
  const DROP_POOL = [
    { ico: '🎠', name: '旋转木马' }, { ico: '🎸', name: '小吉他' }, { ico: '🪁', name: '纸鸢' },
    { ico: '🦆', name: '橡皮鸭' }, { ico: '🕯️', name: '香薰蜡烛' }, { ico: '🪴', name: '多肉盆栽' },
    { ico: '🎠', name: '八音盒', _alt: '🎵' }, { ico: '🛼', name: '轮滑鞋' }, { ico: '🧩', name: '千片拼图' },
    { ico: '🪞', name: '复古圆镜' }, { ico: '🎈', name: '告白气球' }, { ico: '🛸', name: '桌面飞碟' }
  ];
  function dropsKey() { return prefix() + ':arcade-drops'; }
  function loadDrops() {
    try { const a = JSON.parse(localStorage.getItem(dropsKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveDrops(a) { try { localStorage.setItem(dropsKey(), JSON.stringify(a)); } catch (e) {} }
  window.arcadeTryDrop = function (src) {
    if (!(window.__arcDebug && window.__arcDebug.forceDrop) && Math.random() >= 0.08) return null;
    const owned = loadDrops().map((d) => d.name);
    const rest = DROP_POOL.filter((d) => owned.indexOf(d.name) < 0);
    if (!rest.length) return null;
    const it = pick(rest);
    const rec = { ico: it._alt || it.ico, name: it.name, src: src || '', ts: Date.now() };
    const a = loadDrops(); a.push(rec); saveDrops(a);
    return rec;
  };
  window.arcadeDrops = loadDrops;

  // ---- 战绩聚合（只读各游戏现有键，缺键显示 —） ----
  function readJson(suf, dft) {
    try {
      const raw = localStorage.getItem(prefix() + ':' + suf);
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign({}, dft, v); }
    } catch (e) {}
    return Object.assign({}, dft);
  }
  function statsRows() {
    const pong = readJson('pong-stats', { win: 0, lose: 0, draw: 0 });
    const c4 = readJson('c4-stats', { w: 0, l: 0, d: 0 });
    const gk = readJson('gomoku-stats', { w: 0, l: 0, d: 0 });
    const mem = readJson('memory-stats', { clears: 0, bestChem: 0 });
    const lk = readJson('linkup-stats', { clears: 0, bestChem: 0 });
    const m3 = readJson('match3-stats', { clears: 0, bestChem: 0 });
    const au = readJson('auction-stats', { sessions: 0, myWins: 0, spentFen: 0 });
    // FIX 2026-09-16：聚合页补钓鱼/合作扫雷/打砖块三行（只读各游戏现有键）
    const fs_ = readJson('fishing-stats', { totalCast: 0, totalEarned: 0 });
    const ms_ = readJson('ms-stats', { play: 0, win: 0 });
    const bk_ = readJson('brick-stats', { plays: 0, layers: 0 });
    const yuan = (f) => '¥' + ((f || 0) / 100).toFixed(2);
    return [
      { ico: '🏓', name: 'Pong', line: pong.win + '胜 · ' + pong.lose + '负 · ' + pong.draw + '平' },
      { ico: '🔵', name: '四子棋', line: c4.w + '胜 · ' + c4.l + '负 · ' + c4.d + '平' },
      { ico: '⚫', name: '五子棋', line: gk.w + '胜 · ' + gk.l + '负 · ' + gk.d + '平' },
      { ico: '🃏', name: '记忆翻牌', line: '通关 ' + mem.clears + ' 局 · 最佳默契 ' + mem.bestChem },
      { ico: '🔗', name: '连连看', line: '清完 ' + lk.clears + ' 局 · 最佳默契 ' + lk.bestChem },
      { ico: '🍬', name: '消消乐', line: '通关 ' + m3.clears + ' 局 · 最佳默契 ' + m3.bestChem },
      { ico: '🔨', name: '心意币拍卖会', line: au.sessions + ' 场 · 拍得 ' + au.myWins + ' 件 · 花了 ' + yuan(au.spentFen) },
      { ico: '🎣', name: '双人钓鱼', line: '抛竿 ' + fs_.totalCast + ' 次 · 累计赚 ' + yuan(fs_.totalEarned) },
      { ico: '💣', name: '合作扫雷', line: '合作 ' + ms_.play + ' 局 · 完成 ' + ms_.win + ' 次' },
      { ico: '🧱', name: '双人打砖块', line: '玩过 ' + bk_.plays + ' 局 · 通关 ' + bk_.layers + ' 层' }
    ];
  }
  function played(k) {
    // FIX 2026-09-16：贪吃蛇战绩键实为 snake-score（snake-stats 全仓无写入者）——
    // 「游戏体验官」徽章原先永远统计不到贪吃蛇
    const m = { pong: 'pong-stats', snake: 'snake-score', c4: 'c4-stats', memory: 'memory-stats', gomoku: 'gomoku-stats', linkup: 'linkup-stats', match3: 'match3-stats', auction: 'auction-stats', fishing: 'fishing-stats', ms: 'ms-stats', brick: 'brick-stats' };
    try { return !!localStorage.getItem(prefix() + ':' + m[k]); } catch (e) { return false; }
  }

  // ---- 徽章 ----
  function badges() {
    const gk = readJson('gomoku-stats', { w: 0, l: 0, d: 0 });
    const mem = readJson('memory-stats', { clears: 0, bestChem: 0 });
    const lk = readJson('linkup-stats', { clears: 0, bestChem: 0 });
    const m3 = readJson('match3-stats', { clears: 0, bestChem: 0 });
    const au = readJson('auction-stats', { myWins: 0, sessions: 0 });
    const drops = loadDrops();
    let bagN = 0;
    try { const a = JSON.parse(localStorage.getItem(prefix() + ':auction-items') || '[]'); if (Array.isArray(a)) bagN = a.length; } catch (e) {}
    const playedN = ['pong', 'snake', 'c4', 'memory', 'gomoku', 'linkup', 'match3', 'auction', 'fishing', 'ms', 'brick'].filter(played).length;
    return [
      { ico: '⚫', name: '五子棋首胜', on: gk.w >= 1 },
      { ico: '🥋', name: '五子棋十胜', on: gk.w >= 10 },
      { ico: '💞', name: '默契满分', on: Math.max(mem.bestChem || 0, lk.bestChem || 0, m3.bestChem || 0) >= 100 },
      { ico: '🔗', name: '连连看×5', on: lk.clears >= 5 },
      { ico: '🍬', name: '消消乐×5', on: m3.clears >= 5 },
      { ico: '🔨', name: '首次拍品', on: au.myWins >= 1 },
      { ico: '🎒', name: '收藏家', on: bagN >= 5 },
      { ico: '🎡', name: '游戏体验官', on: playedN >= 6, tip: '玩过 6 种以上小游戏' },
      { ico: '🌠', name: '第一件摆件', on: drops.length >= 1 },
      { ico: '✨', name: '摆件全收集', on: drops.length >= DROP_POOL.length },
      { ico: '🍀', name: '幸运星', on: luckyPlayedToday(), tip: '在幸运日玩一局幸运游戏' }
    ];
  }

  // ---- 渲染 ----
  function renderAt(elm) {
    if (!elm) return;
    const rows = statsRows();
    const bds = badges();
    const drops = loadDrops();
    const owned = drops.map((d) => d.name);
    let html = '';
    // 幸运横幅
    html += '<div class="arc-lucky' + (luckyPlayedToday() ? ' done' : '') + '">🍀 今日幸运游戏：<b>' + window.arcadeLuckyName() + '</b>（奖励 ×2' + (luckyPlayedToday() ? ' · 今天已打卡' : ' · 快去玩一局') + '）</div>';
    // 战绩行
    html += '<div class="arc-sec">📊 和' + T('TA') + '的战绩</div>';
    html += rows.map((r) => '<div class="arc-row"><span class="arc-ico">' + r.ico + '</span><span class="arc-name">' + r.name + '</span><span class="arc-line">' + r.line + '</span></div>').join('');
    // 徽章
    const got = bds.filter((b) => b.on).length;
    html += '<div class="arc-sec">🏅 徽章 ' + got + ' / ' + bds.length + '</div>';
    html += '<div class="arc-badges">' + bds.map((b) =>
      '<span class="arc-badge' + (b.on ? ' on' : '') + '"' + (b.tip ? ' title="' + b.tip + '"' : '') + '>' + b.ico + ' ' + b.name + '</span>').join('') + '</div>';
    // 摆件图鉴
    html += '<div class="arc-sec">🌠 限定摆件图鉴 ' + drops.length + ' / ' + DROP_POOL.length + '<span class="arc-sub">胜利 8% 概率掉落 · 各游戏互通</span></div>';
    html += '<div class="arc-drops">' + DROP_POOL.map((d) => {
      const has = owned.indexOf(d.name) >= 0;
      return '<span class="arc-drop' + (has ? ' on' : '') + '">' + (has ? (d._alt || d.ico) : '❔') + ' ' + d.name + '</span>';
    }).join('') + '</div>';
    if (drops.length) {
      html += '<div class="arc-sec">🧾 最近掉落</div>';
      html += drops.slice(-4).reverse().map((d) => '<div class="arc-row"><span class="arc-ico">' + d.ico + '</span><span class="arc-name">' + d.name + '</span><span class="arc-line">' + (d.src || '') + '</span></div>').join('');
    }
    elm.innerHTML = html;
  }
  function render() { renderAt(bodyEl); }

  function setNames() {
    let name = T('TA');
    try {
      const s = window.activeStore && window.activeStore();
      name = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || name;
    } catch (e) {}
    if (partnerNameEl) partnerNameEl.textContent = name;
    if (lgPartnerNameEl) lgPartnerNameEl.textContent = name;
  }
  window.openArcadePanel = function () {
    panel.hidden = false;
    try { setNames(); } catch (e) {}
    try { render(); } catch (e) {}
  };
  function closePanel() { if (panel) panel.hidden = true; }
  // FIX 2026-09-11 #308 游乐室 × 关不掉：closeBtn 取到后从未绑 click（全文件唯一挂点在这，别处不代调 closeArcadePanel），任何机型都关不掉＝设备无关的漏绑；stopPropagation 同 chat.js rpCloseBtn 模式（防冒泡触发 more-arcade/more 面板委托）
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  window.closeArcadePanel = closePanel;
  document.addEventListener('contact-switched', () => { try { closePanel(); } catch (e) {} });

  // ---- v3.26.x：独立全屏游乐室打开/关闭（主页页入口卡进入，返回回主页页） ----
  function openArcadePage() {
    if (!pageEl) return;
    // 隐藏所有页，打开游乐室页
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    pageEl.hidden = false;
    try { setNames(); } catch (e) {}
    try { renderAt(pageBodyEl); } catch (e) {}
  }
  function closeArcadePage() {
    if (!pageEl) return;
    pageEl.hidden = true;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const homePage = document.getElementById('page-home');
    if (homePage) homePage.hidden = false;
  }

  // ---- 入口：主页页入口卡 → 打开全屏游乐室；全屏返回键 → 回主页页 ----
  (function bindHomeEntry() {
    const entry = document.getElementById('home-arcade-entry');
    if (entry) entry.addEventListener('click', (e) => {
      // 主页页是 tab 统计页，页内只有这一处入口，无需防冒泡请假；stopPropagation 仅防止误触页面级委托
      e.stopPropagation();
      openArcadePage();
    });
    const back = document.getElementById('arcade-back');
    if (back) back.addEventListener('click', (e) => {
      e.stopPropagation();
      closeArcadePage();
    });
  })();
  window.openArcadePage = openArcadePage;
  window.closeArcadePage = closeArcadePage;

  // 只读调试口（verify 用：强制掉落）
  window.__arcDebug = { forceDrop: false, luckyKey: luckyKey, loadDrops: loadDrops };
})();

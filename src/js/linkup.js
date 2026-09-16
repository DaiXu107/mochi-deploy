// ===== 功能：连连看（聊天页更多功能 → 小游戏） =====
// 和 TA 轮流消除的经典连连看：两张同款图案、连线不超过两个拐角（路径只穿过空格，
// 棋盘外圈算空）即可消除，合作清完整张棋盘，不计输赢、记「默契分」。
// TA 由代码控制（无真 AI）：每回合抽状态——
//   smart 60%  全盘扫一对快速消除；
//   memory 20% 只在自己「记得」的牌里找（记得近期被翻过的位置，找不到就再想想）；
//   wild  20%  随缘乱点两张（可能连不上——点错抖一下，再认真找一对）。
// 附属：提示 ×3（高亮一对可连的牌）、洗牌 ×2（手动重排剩余牌）；
// 剩余牌无可连对时自动洗牌（提示「没有能连的了，自动洗了个牌」）。
// 结算：写聊天记录（special:'linkup'）+ 字卡库 TA 回应 + 默契分 + 心意币奖励（日封顶）。
// 难度：休闲 6×5 / 普通 8×6 / 挑战 10×6（头部下拉，同记忆翻牌交互）。
// 入口绑定在本文件内完成（不改 chat.js），半框容器复用 .poke-card 与 .pong-overlay 组件。
(function () {
  const panel = document.getElementById('chat-linkup-panel');
  if (!panel) return;
  const boardEl = document.getElementById('lk-board');
  const stageEl = document.getElementById('lk-stage');
  const statusEl = document.getElementById('lk-status');
  const infoEl = document.getElementById('lk-info');
  const overlayEl = document.getElementById('lk-overlay');
  const ovTitleEl = document.getElementById('lk-ov-title');
  const ovBodyEl = document.getElementById('lk-ov-body');
  const startBtn = document.getElementById('lk-btn-start');
  const endBtn = document.getElementById('lk-btn-end');
  const hintBtn = document.getElementById('lk-hint');
  const shufBtn = document.getElementById('lk-shuffle');
  const soundBtn = document.getElementById('lk-sound');
  const closeBtn = document.getElementById('lk-close');
  const fsBtn = document.getElementById('lk-fs');

  // ---- #306 全屏：面板 fixed 满屏（共享 .game-fs 类，同 pong-fs 机制）。 ----
  // 重开面板无论上次怎么关的（含兄弟互斥直接 hidden）都先退出，防全屏残留 ----
  let isFs = false;
  function toggleFs() {
    isFs = !isFs;
    panel.classList.toggle('game-fs', isFs);
    if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
    setTimeout(() => { try { if (typeof fitBoard === 'function') fitBoard(); } catch (e) {} }, 60);
  }
  if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
  const diffSel = document.getElementById('lk-diff');
  const partnerNameEl = document.getElementById('lk-partner-name');

  const DIFFS = {
    casual: { rows: 5, cols: 6, kinds: 10, pairPerKind: 3, label: '🌱 休闲 6×5', coin: 520 },
    normal: { rows: 6, cols: 8, kinds: 12, pairPerKind: 2, label: '🌙 普通 8×6', coin: 1314 },
    hard:   { rows: 6, cols: 10, kinds: 15, pairPerKind: 2, label: '⭐ 挑战 10×6', coin: 5200 },
    // #489 大棋盘：rows×cols 必须 = kinds×pairPerKind×2（每款张数为偶）才可清盘；
    // 12 列是窄屏可玩上限（再宽则半框格子 <20px 读不清图案）
    king:   { rows: 7, cols: 12, kinds: 21, pairPerKind: 2, label: '👑 王者 12×7', coin: 13140 },
    legend: { rows: 8, cols: 12, kinds: 24, pairPerKind: 2, label: '🏆 传奇 12×8', coin: 33440 }
  };
  // #301 图案主题包：水果 / 甜品 / 海洋（头部 🎨 循环切换，按联系人桌面记住选择）
  // #489 扩到 24 款（王者 21 / 传奇 24 用）——新图案只许追加在尾部，前 10/12/15 顺序
  // 不能动（休闲/普通/挑战的牌面依赖既有顺序）；同主题内禁止重复图案（重复=异种同形，误配）
  const THEMES = {
    fruit:   { ico: '🍎', kinds: ['🍎', '🍐', '🍇', '🍒', '🍓', '🍑', '🍍', '🥝', '🍉', '🍌', '🧁', '🍰', '🍀', '🌈', '🐬', '🥑', '🍋', '🥭', '🫐', '🥥', '🌰', '🫒', '🎃', '🌻'] },
    dessert: { ico: '🧁', kinds: ['🍰', '🧁', '🍩', '🍪', '🍫', '🍬', '🍭', '🍮', '🍦', '🧇', '🥞', '🍓', '🍯', '🫖', '☕', '🧋', '🥐', '🥨', '🥯', '🧈', '🍞', '🍥', '🍡', '🥮'] },
    ocean:   { ico: '🌊', kinds: ['🐬', '🐟', '🐠', '🦈', '🐙', '🦀', '🐡', '🦐', '🐳', '🐚', '🌊', '⛵', '🪸', '⭐', '🫧', '🦞', '🦑', '🦦', '🦭', '🐢', '⚓', '🎣', '🚤', '💧'] }
  };
  const THEME_ORDER = ['fruit', 'dessert', 'ocean'];
  let themeKey = 'fruit';
  function themeKinds() { return (THEMES[themeKey] || THEMES.fruit).kinds; }
  function themeBtn() { return document.getElementById('lk-theme'); }
  const THINK_LINES = ['TA正在找能连的……', 'TA扫视着棋盘', 'TA歪头想了想'];
  const TURN_MIN = 900, TURN_VAR = 800;

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function fastMul() { return (window.__lkDebug && window.__lkDebug.fast) ? 0.05 : 1; }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---- 音效 ----
  let audioCtx = null, soundOn = true;
  function beep(freq, dur, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // FIX 2026-09-16：iOS 锁屏/切后台后 ctx 挂起，不 resume 则此后连点击音效都永久无声（gomoku 同款）
      if (audioCtx.state === 'suspended' && audioCtx.resume) { const r = audioCtx.resume(); if (r && r.catch) r.catch(function () {}); }
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.value = vol || 0.16;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  const sfxPick = () => beep(500, 0.06, 0.14);
  const sfxMatch = () => { beep(620, 0.08, 0.16); setTimeout(() => beep(830, 0.1, 0.16), 70); };
  const sfxBad = () => beep(180, 0.07, 0.12);
  const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };

  // ---- 对局状态 ----
  let st = null;
  let thinkT = null;
  let hintClearT = null;      // FIX 2026-09-16：提示高亮自动清除定时器
  let narrowTipShown = false; // FIX 2026-09-16：窄屏格宽跌破可读下限的一次性提示

  function newState(diff) {
    const d = DIFFS[diff];
    return {
      diff: diff,
      rows: d.rows, cols: d.cols,
      grid: [],                // grid[r][c] = 种类下标或 -1（已消除）
      turn: 1,                 // 1 玩家 / 2 TA
      over: false,
      lock: false,             // #341 动画链进行中，锁输入
      started: false,
      sel: null,               // 玩家当前选中 [r,c]
      remaining: 0,
      totalPairs: 0,
      myPairs: 0, taPairs: 0, misPicks: 0,
      hints: 3, shuffles: 2,
      seen: [],                // TA 的「记忆」：近期被翻看过的位置（滚动上限）
      mode: 'smart',
      combo: 0, maxCombo: 0    // #301 连击：连续配对次数（点错/提示断连）
    };
  }

  // ---- 战绩（每联系人独立） ----
  function statsKey() { return prefix() + ':linkup-stats'; }
  function loadStats() {
    const d = { clears: 0, bestChem: 0, lastDiff: 'normal' };
    try {
      const raw = localStorage.getItem(statsKey());
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
    } catch (e) {}
    return d;
  }
  function saveStats(s) { try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch (e) {} }

  // ---- 连线规则（纯函数，__lkDebug 复用）：≤2 拐角，路径只过空格，棋盘外算空 ----
  function at(st2, r, c) {
    if (r < 0 || r >= st2.rows || c < 0 || c >= st2.cols) return -1;   // 棋盘外=空
    return st2.grid[r][c];
  }
  function empty(st2, r, c) { return at(st2, r, c) === -1; }
  // 同一直线（r1==r2 或 c1==c2）两端点之间全空（不含端点）
  function lineClear(st2, r1, c1, r2, c2) {
    if (r1 === r2) {
      const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
      for (let c = lo + 1; c < hi; c++) { if (!empty(st2, r1, c)) return false; }
      return true;
    }
    if (c1 === c2) {
      const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
      for (let r = lo + 1; r < hi; r++) { if (!empty(st2, r, c1)) return false; }
      return true;
    }
    return false;
  }
  // #341 两张同款牌的连线路径（≤2 拐角）；可连返回途经点数组（含两端），否则 null——
  // 规则判断与旧 connected 完全一致，只是把「能连」升级成「怎么连」供走线动画用
  function findPath(st2, a, b) {
    const va = at(st2, a[0], a[1]), vb = at(st2, b[0], b[1]);
    if (va < 0 || vb < 0 || va !== vb) return null;
    if (a[0] === b[0] && a[1] === b[1]) return null;
    // 0 拐：同线直达
    if ((a[0] === b[0] || a[1] === b[1]) && lineClear(st2, a[0], a[1], b[0], b[1])) return [a.slice(), b.slice()];
    // 1 拐：两个可能角点
    const c1 = [a[0], b[1]], c2 = [b[0], a[1]];
    if (empty(st2, c1[0], c1[1]) && lineClear(st2, a[0], a[1], c1[0], c1[1]) && lineClear(st2, c1[0], c1[1], b[0], b[1])) return [a.slice(), c1.slice(), b.slice()];
    if (empty(st2, c2[0], c2[1]) && lineClear(st2, a[0], a[1], c2[0], c2[1]) && lineClear(st2, c2[0], c2[1], b[0], b[1])) return [a.slice(), c2.slice(), b.slice()];
    // 2 拐：沿 a 的行/列找一条空线，使其能分别直达 a 与 b
    for (let x = -1; x <= st2.cols; x++) {
      if (empty(st2, a[0], x) && empty(st2, b[0], x) &&
          lineClear(st2, a[0], a[1], a[0], x) && lineClear(st2, a[0], x, b[0], x) && lineClear(st2, b[0], x, b[0], b[1])) return [a.slice(), [a[0], x], [b[0], x], b.slice()];
    }
    for (let y = -1; y <= st2.rows; y++) {
      if (empty(st2, y, a[1]) && empty(st2, y, b[1]) &&
          lineClear(st2, a[0], a[1], y, a[1]) && lineClear(st2, y, a[1], y, b[1]) && lineClear(st2, y, b[1], b[0], b[1])) return [a.slice(), [y, a[1]], [y, b[1]], b.slice()];
    }
    return null;
  }
  function connected(st2, a, b) { return !!findPath(st2, a, b); }
  // 当前所有可连对（TA 扫盘 / 死锁检测 / 提示共用）
  function allPairs(st2) {
    const cells = [];
    for (let r = 0; r < st2.rows; r++) for (let c = 0; c < st2.cols; c++) {
      if (st2.grid[r][c] >= 0) cells.push([r, c]);
    }
    const out = [];
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      if (st2.grid[cells[i][0]][cells[i][1]] !== st2.grid[cells[j][0]][cells[j][1]]) continue;
      if (connected(st2, cells[i], cells[j])) out.push([cells[i], cells[j]]);
    }
    return out;
  }

  // ---- 发牌 / 洗牌 ----
  function dealGrid(d) {
    const kinds = [];
    for (let k = 0; k < d.kinds; k++) {
      for (let p = 0; p < d.pairPerKind * 2; p++) kinds.push(k);
    }
    const total = d.rows * d.cols;
    while (kinds.length < total) kinds.push(kinds.length % d.kinds);   // 兜底（配置不齐时）
    kinds.length = total;
    let grid;
    do {
      shuffle(kinds);
      grid = [];
      for (let r = 0; r < d.rows; r++) grid.push(kinds.slice(r * d.cols, (r + 1) * d.cols));
    } while (allPairs({ rows: d.rows, cols: d.cols, grid: grid }).length === 0);
    return grid;
  }
  // 死锁处理：剩余牌随机重排直到有解（每类牌张数不变）；#341 成功后播「翻乱→摆好」动画
  function reshuffle() {
    const cells = [];
    const kinds = [];
    for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) {
      if (st.grid[r][c] >= 0) { cells.push([r, c]); kinds.push(st.grid[r][c]); }
    }
    let ok = false;
    for (let tries = 0; tries < 80; tries++) {
      shuffle(kinds);
      for (let i = 0; i < cells.length; i++) st.grid[cells[i][0]][cells[i][1]] = kinds[i];
      if (allPairs(st).length > 0) { ok = true; break; }
    }
    if (!ok) { renderBoard(); return false; }
    const s = st;
    s.lock = true;
    const alive = cells.map((p) => tileAt(p[0], p[1])).filter(Boolean);
    alive.forEach((el) => { el.classList.remove('lk-shufin'); el.classList.add('lk-shufout'); });
    setTimeout(() => {
      if (s !== st) return;
      renderBoard();
      const ts = boardEl.querySelectorAll('.lk-tile');
      for (let i = 0; i < ts.length; i++) {
        if (ts[i].classList.contains('lk-gone')) continue;
        ts[i].classList.remove('lk-shufout'); ts[i].classList.add('lk-shufin');
      }
      setTimeout(() => {
        if (s !== st) return;
        const ts2 = boardEl.querySelectorAll('.lk-tile');
        for (let i = 0; i < ts2.length; i++) ts2[i].classList.remove('lk-shufin');
        s.lock = false;
      }, Math.round(220 * fastMul()));
    }, Math.round(180 * fastMul()));
    return true;
  }

  // ---- 渲染 ----
  function buildBoard() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = 'repeat(' + st.cols + ',1fr)';
    for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'lk-tile';
      cell.setAttribute('data-r', String(r));
      cell.setAttribute('data-c', String(c));
      boardEl.appendChild(cell);
    }
  }
  function fitBoard() {
    if (!stageEl || panel.hidden || !st) return;
    const w = stageEl.clientWidth;
    if (!w) return;
    // #306：格子是固定 px 宽，grid 又有 3px gap——cellPx 若只按 w/cols 取整，
    // 实际总宽会多出 (cols-1)*3px 从右缘溢出截断（最右一列被裁掉）。先扣掉 gap 再取整。
    const GAP = 3;
    const byW = Math.floor((w - (st.cols - 1) * GAP) / st.cols);
    // #489 12 列起（王者/传奇）24px 下限在窄屏放不下会把总宽顶溢出右缘——列多时按实宽收格
    const floor24 = Math.min(24, byW);
    let cellPx = Math.max(floor24, Math.min(46, byW));
    // #488 全屏放大布局：半框维持 46px 宽度上限原样；.game-fs 全屏让高度也参与取值、
    // 上限放开到 72px——宽屏/横屏/桌面棋盘真正放大，窄手机仍由宽度约束（配合 CSS 纵向居中）
    if (panel.classList.contains('game-fs')) {
      const h = stageEl.clientHeight;
      cellPx = Math.max(floor24, Math.min(72, byW, h ? Math.floor((h - (st.rows - 1) * GAP) / st.rows) : byW));
    }
    // FIX 2026-09-16：byW<24 破 24px 可读下限（本文件头注释自述 <20px 读不清图案）——
    // 仍按实宽收格保证不溢出，但一次性提示可切低难度
    if (byW < 24 && st && st.started && !st.over && !narrowTipShown) {
      narrowTipShown = true;
      taSay('屏幕偏窄图案较小，可在头部换低难度');
    }
    boardEl.style.width = (cellPx * st.cols + (st.cols - 1) * GAP) + 'px';
    const tiles = boardEl.querySelectorAll('.lk-tile');
    for (let i = 0; i < tiles.length; i++) { tiles[i].style.width = cellPx + 'px'; tiles[i].style.height = cellPx + 'px'; tiles[i].style.fontSize = Math.round(cellPx * 0.52) + 'px'; }
  }
  function tileAt(r, c) {
    return boardEl.children[r * st.cols + c] || null;
  }
  function renderBoard() {
    for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) {
      const el = tileAt(r, c);
      const v = st.grid[r][c];
      el.classList.remove('lk-gone', 'lk-sel', 'lk-hint');
      if (v < 0) { el.classList.add('lk-gone'); el.textContent = ''; }
      else el.textContent = themeKinds()[v];
    }
    updateInfo();
  }
  function updateInfo() {
    if (infoEl) infoEl.innerHTML =
      '<span>剩余 ' + st.remaining + ' 张</span>' +
      '<span>💡 ' + st.hints + '</span>' +
      '<span>🔀 ' + st.shuffles + '</span>' +
      (st.combo >= 2 ? '<span>🔥 连击 ×' + st.combo + '</span>' : '') +
      '<span>💕 ' + chemNow() + '</span>';
  }
  // ---- #341 表现层动画：连线走线 / 消除爆开 / 开局发牌 ----
  const POP_MS = 260;
  let pathSvgT = null;
  // 在棋盘上叠一层 SVG，把 ≤2 拐角的连线画出来（描线动画 + 淡出自删）；棋盘外圈虚拟点按格距外推
  function drawPathLine(path) {
    if (!boardEl || !path || path.length < 2) return;
    try {
      const t0 = tileAt(0, 0);
      if (!t0 || !t0.offsetWidth) return;
      const GAP = 3, cw = t0.offsetWidth, ch = t0.offsetHeight;
      const pt = (p) => (t0.offsetLeft + p[1] * (cw + GAP) + cw / 2) + ',' + (t0.offsetTop + p[0] * (ch + GAP) + ch / 2);
      const old = boardEl.querySelector('.lk-pathline');
      if (old) old.remove();
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'lk-pathline');
      const pl = document.createElementNS(NS, 'polyline');
      pl.setAttribute('points', path.map(pt).join(' '));
      pl.setAttribute('pathLength', '1');
      svg.appendChild(pl);
      boardEl.appendChild(svg);
      clearTimeout(pathSvgT);
      pathSvgT = setTimeout(() => { try { const s = boardEl.querySelector('.lk-pathline'); if (s) s.remove(); } catch (e) {} }, Math.round(480 * fastMul()));
    } catch (e) {}
  }
  // 开局发牌：整盘棋子按对角波次出生
  function dealInAnim() {
    if (!boardEl) return;
    const mult = fastMul();
    const tiles = boardEl.querySelectorAll('.lk-tile');
    let maxD = 0;
    for (let i = 0; i < tiles.length; i++) {
      const el = tiles[i];
      const r = parseInt(el.getAttribute('data-r'), 10) || 0;
      const c = parseInt(el.getAttribute('data-c'), 10) || 0;
      const d = Math.round(Math.min((r + c) * 18, 260) * mult);
      if (d > maxD) maxD = d;
      el.style.animationDelay = d + 'ms';
      el.classList.add('lk-born');
    }
    setTimeout(() => {
      try {
        const ts = boardEl.querySelectorAll('.lk-tile');
        for (let i = 0; i < ts.length; i++) { ts[i].classList.remove('lk-born'); ts[i].style.animationDelay = ''; }
      } catch (e) {}
    }, maxD + Math.round(240 * mult));
  }
  function chemNow() {
    if (!st.totalPairs) return 60;
    const share = st.myPairs / Math.max(1, st.myPairs + st.taPairs);
    const acc = Math.max(0, 1 - st.misPicks / Math.max(4, st.totalPairs));
    // #301 连击加成：本场最高连击折算默契加成（上限 +10）
    const comboBonus = Math.min(10, (st.maxCombo || 0) * 2);
    return Math.max(0, Math.min(100, Math.round(60 + share * 20 + acc * 20 - st.misPicks * 2 + comboBonus)));
  }
  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  // #301 中局 TA 泡泡（同 gomoku 的 DOM 冒泡语义）
  let bubbleT = null;
  function taSay(text) {
    if (!stageEl) return;
    try {
      let b = stageEl.querySelector('.tg-bubble');
      if (!b) { b = document.createElement('div'); b.className = 'tg-bubble'; stageEl.appendChild(b); }
      b.textContent = text;
      b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
      clearTimeout(bubbleT);
      bubbleT = setTimeout(() => { try { b.classList.remove('show'); } catch (e) {} }, 1600);
    } catch (e) {}
  }
  function dot(side) { return '<i class="c4-dot ' + (side === 1 ? 'c4-dot-you' : 'c4-dot-ta') + '"></i>'; }
  function showTurnStatus() {
    if (!statusEl || !st || st.over) return;
    setStatus(st.turn === 1 ? dot(1) + '你的回合：点两张相同的牌' : T(THINK_LINES[0]));
  }

  // ---- 对局流程 ----
  function newGame() {
    clearTimeout(thinkT); thinkT = null;
    clearTimeout(hintClearT);
    narrowTipShown = false;
    const diff = diffSel && DIFFS[diffSel.value] ? diffSel.value : 'normal';
    st = newState(diff);
    st.grid = dealGrid(DIFFS[diff]);
    st.remaining = st.rows * st.cols;
    st.totalPairs = Math.floor(st.remaining / 2);
    st.started = true;
    hideOverlay();
    buildBoard();
    fitBoard();
    renderBoard();
    dealInAnim();
    st.turn = 1;
    setStatus(dot(1) + '你的回合：点两张相同的牌');
  }
  function remember(r, c) {
    st.seen.push([r, c]);
    if (st.seen.length > 12) st.seen.splice(0, st.seen.length - 12);
  }
  function removePair(a, b, byMe) {
    // #341 动画链：画连线 + 爆开 → 动画收尾才清字/交棒。逻辑状态（grid/remaining/计分）
    // 同步更新，期间 st.lock 锁输入；s 捕获本局，防重开后旧链接管新局
    const s = st;
    const ea = tileAt(a[0], a[1]), eb = tileAt(b[0], b[1]);
    drawPathLine(findPath(s, a, b));
    s.lock = true;
    s.grid[a[0]][a[1]] = -1;
    s.grid[b[0]][b[1]] = -1;
    s.remaining -= 2;
    if (byMe) s.myPairs++; else s.taPairs++;
    s.sel = null;
    boardEl.querySelectorAll('.lk-sel').forEach((el) => el.classList.remove('lk-sel'));
    [ea, eb].forEach((el) => { if (el) el.classList.add('lk-pop'); });
    updateInfo();
    setTimeout(() => {
      [ea, eb].forEach((el) => { if (el) { el.classList.remove('lk-pop'); el.classList.add('lk-gone'); el.textContent = ''; } });
      s.lock = false;
      if (s === st) afterClear(byMe);   // 对局已被重开则丢弃这条链
    }, Math.round(POP_MS * fastMul()));
  }
  function playerPick(r, c) {
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    if (st.grid[r][c] < 0) return;
    remember(r, c);
    const el = tileAt(r, c);
    if (st.sel && st.sel[0] === r && st.sel[1] === c) {
      st.sel = null; el.classList.remove('lk-sel'); sfxPick();
      return;
    }
    if (!st.sel) {
      st.sel = [r, c];
      el.classList.add('lk-sel');
      sfxPick();
      return;
    }
    const a = st.sel;
    if (st.grid[a[0]][a[1]] === st.grid[r][c] && connected(st, a, [r, c])) {
      sfxMatch();
      st.combo++;
      if (st.combo > (st.maxCombo || 0)) st.maxCombo = st.combo;
      if (st.combo >= 2) taSay(pick(['连击 ×' + st.combo + '，好默契！', '又连上啦！', '手气不错嘛']));
      removePair(a, [r, c], true);   // #341 清格后流程由动画链尾 afterClear(true) 接管，此处不再直调
    } else {
      st.misPicks++;
      st.combo = 0;
      sfxBad();
      const ea = tileAt(a[0], a[1]);
      if (ea) { ea.classList.remove('lk-shake'); void ea.offsetWidth; ea.classList.add('lk-shake'); }
      if (el) { el.classList.remove('lk-shake'); void el.offsetWidth; el.classList.add('lk-shake'); }
      st.sel = null;
      boardEl.querySelectorAll('.lk-sel').forEach((x) => x.classList.remove('lk-sel'));
      updateInfo();
    }
  }
  function afterClear(byMe) {
    if (st.remaining <= 0) { endGame(); return; }
    if (allPairs(st).length === 0) {
      reshuffle();
      setStatus('🌀 没有能连的了，自动洗了个牌');
      st.turn = 1;   // #341 合并 TA 路径语义：死锁自动洗牌后始终轮回玩家
      return;
    }
    st.turn = byMe ? 2 : 1;
    if (st.turn === 2) scheduleTaTurn(TURN_MIN + Math.random() * TURN_VAR);
    else showTurnStatus();
  }

  // ---- TA 回合 ----
  function rollMode() {
    const r = Math.random();
    if (r < 0.6) return 'smart';
    if (r < 0.8) return 'memory';
    return 'wild';
  }
  function scheduleTaTurn(delay) {
    clearTimeout(thinkT);
    setStatus(T(THINK_LINES[Math.floor(Math.random() * THINK_LINES.length)]));
    thinkT = setTimeout(taTurn, Math.round(delay * fastMul()));
  }
  function taTurn() {
    if (!st || st.over || st.lock || st.turn !== 2) return;
    st.mode = rollMode();
    let pair = null;
    const pairs = allPairs(st);
    if (st.mode === 'smart') {
      pair = pairs.length ? pick(pairs) : null;
      if (pair && Math.random() < 0.3) taSay(pick(['找到一对！', '看我的']));
    } else if (st.mode === 'memory') {
      // 只在「记得」的牌里找一对同款（找不到就再想想，不放空枪）
      const seenAlive = st.seen.filter((p) => st.grid[p[0]][p[1]] >= 0);
      outer:
      for (let i = 0; i < seenAlive.length; i++) for (let j = i + 1; j < seenAlive.length; j++) {
        const a = seenAlive[i], b = seenAlive[j];
        if (st.grid[a[0]][a[1]] === st.grid[b[0]][b[1]] && connected(st, a, b)) { pair = [a, b]; break outer; }
      }
      if (!pair) pair = pairs.length ? pick(pairs) : null;
    } else {
      // wild：随缘乱点两张（30% 直接抽一对；否则可能点错→两张一起抖一下→隔一拍再认真找一对）
      if (pairs.length && Math.random() < 0.3) {
        pair = pick(pairs);
      } else {
        const cells = [];
        for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) {
          if (st.grid[r][c] >= 0) cells.push([r, c]);
        }
        const a = pick(cells), b = pick(cells);
        if (a && b && (a[0] !== b[0] || a[1] !== b[1]) &&
            st.grid[a[0]][a[1]] === st.grid[b[0]][b[1]] && connected(st, a, b)) {
          pair = [a, b];
        } else {
          // #487 点错了：台词只指「这次尝试」，隔一拍才真正落子——旧稿抖一张 + 台词与紧随的
          // 成功连线同帧出现，用户视角＝「TA 明明连上了却弹『连不上』」
          [a, b].forEach((p) => {
            if (p) { const el = tileAt(p[0], p[1]); if (el) { el.classList.remove('lk-shake'); void el.offsetWidth; el.classList.add('lk-shake'); } }
          });
          sfxBad();
          const triedSame = !!(a && b && st.grid[a[0]][a[1]] === st.grid[b[0]][b[1]]);
          taSay(triedSame ? '这两张连不上呀' : '哎呀，点错了…');
          if (a) remember(a[0], a[1]);
          if (b) remember(b[0], b[1]);
          const found = pairs.length ? pick(pairs) : null;
          if (!found) { endGame(); return; }
          const s = st;
          clearTimeout(thinkT);
          thinkT = setTimeout(() => {
            if (s !== st || st.over || st.lock || st.turn !== 2) return;   // 重开/结束/已交棒则丢弃重试链
            remember(found[0][0], found[0][1]); remember(found[1][0], found[1][1]);
            sfxMatch();
            removePair(found[0], found[1], false);
          }, Math.round(700 * fastMul()));
          return;
        }
      }
    }
    if (!pair) { endGame(); return; }
    remember(pair[0][0], pair[0][1]); remember(pair[1][0], pair[1][1]);
    sfxMatch();
    removePair(pair[0], pair[1], false);   // #341 清格/死锁/交棒统一移入动画链尾 afterClear(false)
  }

  // ---- 结束：默契 / 奖励 / 聊天联动 ----
  function endGame() {
    st.over = true; st.turn = 0;
    clearTimeout(thinkT); thinkT = null;
    const chem = chemNow();
    const s = loadStats();
    s.clears = (s.clears || 0) + 1;
    s.bestChem = Math.max(s.bestChem || 0, chem);
    s.lastDiff = st.diff;
    saveStats(s);
    sfxWin();
    taSay(pick(['一起清完啦！', '收工！好默契', '最后几张藏得好深']));
    // 心意币：按难度发放，日封顶 ¥104，双方同步同额（同四子棋口径）；#301 幸运日 ×2
    var coinLine = '';
    var dropLine = '';
    try {
      var COIN_CAP = 10400;
      // FIX 2026-09-16：封顶键 UTC 日期改本地日期（UTC 口径下北京时间 0-8 点记到前一天）
      var dl = new Date();
      var day = dl.getFullYear() + '-' + (dl.getMonth() + 1) + '-' + dl.getDate();
      var ck = prefix() + ':ml2_coin_linkup_' + day;
      var cur = Number(localStorage.getItem(ck)) || 0;
      if (cur < COIN_CAP) {
        var mult = (typeof window.arcadeMult === 'function') ? window.arcadeMult('linkup') : 1;
        var nominal = Math.round(DIFFS[st.diff].coin * mult);
        var real = Math.min(nominal, COIN_CAP - cur);
        try { localStorage.setItem(ck, String(cur + real)); } catch (e2) {}
        if (real > 0 && typeof window.giftWalletChange === 'function') {
          if (window.giftWalletChange(real, real, '连连看')) {
            if (typeof window.arcadeMarkLuckyPlayed === 'function') window.arcadeMarkLuckyPlayed('linkup');
            // FIX 2026-09-16：王者/传奇档标称奖励（¥131.4/¥334.4）超日封顶 ¥104，标称永远发不满——
            // 结算展示实际入账并注明已达上限，不虚标
            coinLine = '🪙 双方心意币各 +¥' + (real / 100).toFixed(2) + (mult > 1 ? '（🍀 幸运 ×2）' : '') + (real < nominal ? '（已达今日上限）' : '');
          }
        }
      }
    } catch (e) {}
    // #301 跨游戏掉落：通关 8% 概率掉限定摆件
    if (typeof window.arcadeTryDrop === 'function') {
      try {
        var dr = window.arcadeTryDrop('linkup');
        if (dr) { dropLine = '<div class="pong-end-stat">🌠 掉落限定摆件「' + dr.ico + ' ' + dr.name + '」！游乐室图鉴 +1</div>'; taSay('哇，掉了「' + dr.name + '」！'); }
      } catch (e) {}
    }
    const body =
      '<div class="pong-end-stat">💕 默契 ' + chem + '</div>' +
      '<div class="pong-end-stat">你 ' + st.myPairs + ' 对 · ' + T('TA') + ' ' + st.taPairs + ' 对 · 点错 ' + st.misPicks + ' 次 · 最高连击 ×' + (st.maxCombo || 0) + '</div>' +
      '<div class="pong-end-stat">累计完成 ' + s.clears + ' 局 · 历史最佳默契 ' + s.bestChem + '</div>' +
      (coinLine ? '<div class="pong-end-stat">' + coinLine + '</div>' : '') +
      dropLine;
    showOverlay('清完整张棋盘！', body, '再来一局');
    if (startBtn) startBtn.textContent = '再来一局';
    if (endBtn) endBtn.hidden = false;
    setStatus('🎉 一起清完了！默契 ' + chem);
    // 写聊天系统消息 + TA 随机回应
    try {
      if (window.chatAddSystem) window.chatAddSystem(T('连连看') + ' · 一起清完 · 默契 ' + chem, { special: 'linkup' });
      const fb = ['一起连完啦。', '好默契呀。', '最后几张好难找。', '再来一局？'];
      const pool = window.getInteractPool ? window.getInteractPool('游戏平局·回应', fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      // FIX 2026-09-16：800ms 内切联系人桌面，回应会发进新桌面——回调前校验命名空间未变
      const cidAtEnd = prefix();
      setTimeout(() => {
        if (prefix() !== cidAtEnd) return;
        try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
      }, 800);
    } catch (e) {}
  }

  // ---- 覆盖层 ----
  function showOverlay(title, body, btnText) {
    if (!overlayEl) return;
    if (ovTitleEl) ovTitleEl.innerHTML = title || '';
    if (ovBodyEl) ovBodyEl.innerHTML = body || '';
    if (startBtn && btnText) startBtn.textContent = btnText;
    overlayEl.hidden = false;
  }
  function showStartOverlay() {
    const s = loadStats();
    showOverlay('连连看',
      '<div class="c4-start-tip">和 ' + T('TA') + ' 轮流点击两张相同的牌<br>连线不超过两个弯就消除，一起清完整张棋盘</div>' +
      '<div class="c4-start-note">🎲 ' + T('TA') + '每回合状态随机——快速找 / 凭记忆 / 随缘点</div>' +
      (s.clears > 0 ? '<div class="pong-end-stat">累计完成 ' + s.clears + ' 局 · 历史最佳默契 ' + s.bestChem + '</div>' : ''),
      s.clears > 0 ? '再来一局' : '开始对局');
    if (endBtn) endBtn.hidden = true;
  }
  function hideOverlay() { if (overlayEl) overlayEl.hidden = true; if (endBtn) endBtn.hidden = true; }

  // ---- 输入 ----
  boardEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const cell = e.target.closest('.lk-tile');
    if (!cell) return;
    playerPick(parseInt(cell.getAttribute('data-r'), 10) || 0, parseInt(cell.getAttribute('data-c'), 10) || 0);
  });
  if (startBtn) startBtn.addEventListener('click', (e) => { e.stopPropagation(); newGame(); });
  if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (diffSel) diffSel.addEventListener('change', () => {
    const s = loadStats(); s.lastDiff = diffSel.value; saveStats(s);
    if (st && st.started && !st.over) { /* 对局中不换难度，下一局生效 */ }
  });
  if (hintBtn) hintBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!st || !st.started || st.over || st.lock || st.turn !== 1 || st.hints <= 0) return;
    const pairs = allPairs(st);
    if (!pairs.length) return;
    st.hints--;
    st.combo = 0;   // #301 提示断连击
    const pr = pick(pairs);
    [pr[0], pr[1]].forEach((p) => {
      const el = tileAt(p[0], p[1]);
      if (el) { el.classList.remove('lk-hint'); void el.offsetWidth; el.classList.add('lk-hint'); }
    });
    // FIX 2026-09-16：提示高亮原先不自清，玩家不按提示配对会一直挂着到洗牌/重开——2.5s 后自动消
    clearTimeout(hintClearT);
    hintClearT = setTimeout(() => {
      try { boardEl.querySelectorAll('.lk-hint').forEach((x) => x.classList.remove('lk-hint')); } catch (e2) {}
    }, 2500);
    updateInfo();
    sfxPick();
  });
  if (shufBtn) shufBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!st || !st.started || st.over || st.lock || st.shuffles <= 0 || st.turn !== 1) return;
    st.shuffles--;
    st.sel = null;
    reshuffle();
    setStatus('🌀 洗了个牌，继续你的回合');
    updateInfo();
    sfxPick();
  });
  if (soundBtn) soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.classList.toggle('pong-sound-off', !soundOn);
  });
  // #301 图案主题循环切换（对局中切换=剩余牌即刻换肤，配对逻辑不受影响）
  const themeBtnEl = themeBtn();
  if (themeBtnEl) themeBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    themeKey = THEME_ORDER[(THEME_ORDER.indexOf(themeKey) + 1) % THEME_ORDER.length];
    try { localStorage.setItem(prefix() + ':linkup-theme', themeKey); } catch (e2) {}
    themeBtnEl.textContent = THEMES[themeKey].ico;
    themeBtnEl.title = '图案主题：' + { fruit: '水果', dessert: '甜品', ocean: '海洋' }[themeKey] + '（点击切换）';
    if (st && st.started) renderBoard();
    beep(520, 0.06, 0.12);
  });

  // ---- 打开 / 关闭 ----
  function setNames() {
    let name = T('TA');
    try {
      const s = window.activeStore && window.activeStore();
      name = (s && (s.get('cs-lbl-partner') || s.get('lbl-partner'))) || name;
    } catch (e) {}
    if (partnerNameEl) partnerNameEl.textContent = name;
  }
  window.openLinkupPanel = function () {
    try { if (isFs) toggleFs(); } catch (e) {}
    // #301 主题恢复（缺省水果）
    try { const t = localStorage.getItem(prefix() + ':linkup-theme'); if (t && THEMES[t]) themeKey = t; } catch (e) {}
    if (themeBtnEl) { themeBtnEl.textContent = THEMES[themeKey].ico; }
    if (!st || !st.started) { try { const s = loadStats(); if (DIFFS[s.lastDiff] && diffSel) diffSel.value = s.lastDiff; } catch (e) {} }
    panel.hidden = false;
    try { setNames(); } catch (e) {}
    try { if (st && st.started) fitBoard(); } catch (e) {}
    // 有进行中的对局 → 接着玩（关面板期间轮到 TA 的补调度；动画链中不补，match3 同款守卫）
    if (st && st.started && !st.over) {
      if (st.turn === 2 && !thinkT && !st.lock) scheduleTaTurn(TURN_MIN + Math.random() * TURN_VAR);
      else if (st.turn === 1) showTurnStatus();
      return;
    }
    showStartOverlay();
    setStatus('点击「开始对局」');
  };
  function closePanel() {
    clearTimeout(thinkT); thinkT = null;
    if (panel) panel.hidden = true;
  }
  window.closeLinkupPanel = closePanel;
  // FIX 2026-09-16：原只关面板不清 st——换联系人后重开走「接着玩」，旧桌面棋局/战绩串档
  document.addEventListener('contact-switched', () => { try { closePanel(); st = null; /* #548v */ } catch (e) {} });
  window.addEventListener('resize', () => { if (!panel.hidden) fitBoard(); });

  // ---- 入口：聊天更多功能 → 小游戏 → 连连看（自绑定，chat.js 不改） ----
  (function bindEntry() {
    const btn = document.getElementById('more-linkup');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      hideSiblingPanels('chat-linkup-panel');
      try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
      try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
      try { openLinkupPanel(); } catch (err) {
        try { panel.hidden = false; showStartOverlay(); setStatus('点击「开始对局」'); } catch (e2) {}
        try { console.error('[linkup] open failed', err); } catch (e2) {}
      }
    });
    try {
      if (window.MutationObserver) {
        const SIBLING_IDS = siblingIds('chat-linkup-panel');
        const mo = new MutationObserver(() => {
          if (panel.hidden) return;
          for (let i = 0; i < SIBLING_IDS.length; i++) {
            const el = document.getElementById(SIBLING_IDS[i]);
            if (el && !el.hidden) { closePanel(); break; }
          }
        });
        SIBLING_IDS.forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
      }
    } catch (e) {}
  })();

  // 半框互斥清单（全部聊天页浮层面板；各游戏文件各自维护一份含其余全部面板的列表）
  function siblingIds(self) {
    return ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-ms-panel', 'chat-fish-panel', 'chat-memory-panel', 'chat-gift-panel', 'chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-auction-panel', 'chat-arcade-panel', 'chat-more-panel'].filter((id) => id !== self);
  }
  function hideSiblingPanels(self) {
    siblingIds(self).forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
  }

  // 只读调试口（供后续 verify 脚本复用）
  window.__lkDebug = {
    st: () => st,
    newGame: newGame,
    connected: connected,
    findPath: findPath,
    allPairs: allPairs,
    fast: false
  };
})();

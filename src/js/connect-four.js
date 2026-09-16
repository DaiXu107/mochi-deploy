// ===== 功能：四子棋（聊天页更多功能 → 小游戏） =====
// 经典 7×6 落子棋盘：玩家 vs 梦角（TA），轮流落子、先连成四子的一方获胜。
// TA 不用真 AI（无 Minimax/搜索/预测），只有一步判断 + 每回合随机抽一种行为状态：
//   正常(50%)  基本随机，偶尔才注意到赢/堵；
//   认真(20%)  自己能赢立刻下；玩家将四连大概率堵上；
//   放水(15%)  明显的好棋（能赢/该堵）有概率故意不下；
//   失误(15%)  人式疏忽：完全随机，偶尔连续几次选相近的列。
// 每回合重新抽状态——不会一整局固定聪明或固定放水。
// 底线保护（随机 ≠ 乱下）：玩家「下一步就四连」的机会连续 3 回合都被无视后，
// 第 4 次必堵——再随机的 TA 也不会一直装看不见。
// 界面不做难度选择，只提示「TA今天的状态是随机的」。
// 其他：战绩按联系人桌面存 localStorage；先手规则=首局玩家先手，之后上一局输家
// 先手（平局随机）；结束写聊天系统消息 + TA 随机回应（复用字卡库 游戏胜利/失败/
// 平局·回应 分组）；音效 Web Audio 合成可静音。入口绑定在本文件内完成（不改 chat.js）。
(function () {
  const panel = document.getElementById('chat-c4-panel');
  if (!panel) return;
  const boardEl = document.getElementById('c4-board');
  const stageEl = document.getElementById('c4-stage');
  const statusEl = document.getElementById('c4-status');
  const overlayEl = document.getElementById('c4-overlay');
  const ovTitleEl = document.getElementById('c4-ov-title');
  const ovBodyEl = document.getElementById('c4-ov-body');
  const startBtn = document.getElementById('c4-btn-start');
  const endBtn = document.getElementById('c4-btn-end');
  const soundBtn = document.getElementById('c4-sound');
  const closeBtn = document.getElementById('c4-close');
  const fsBtn = document.getElementById('c4-fs');

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
  const partnerNameEl = document.getElementById('c4-partner-name');
  const sideNameEl = document.getElementById('c4-side-name');

  const COLS = 7, ROWS = 6;
  const THINK_MIN = 550, THINK_VAR = 600;
  // ---- 难度档（TA 行为权重 / 一步判断概率 / 底线阈值） ----
  // casual 休闲：TA 多放水/失误，轻松玩；daily 日常：像普通人时好时坏；serious 认真：TA 想赢
  const DIFFS = {
    casual: {
      label: '休闲', tip: 'TA 让着你，轻松玩',
      w: { normal: 0.35, serious: 0.05, sandbag: 0.35, blunder: 0.25 },
      take: { serious: 0.7, normal: 0.4, sandbag: 0.2, blunder: 0.25 },
      block: { serious: 0.6, normal: 0.4, sandbag: 0.15, blunder: 0.12 },
      floor: 4
    },
    daily: {
      label: '日常', tip: 'TA 像普通人，时好时坏',
      w: { normal: 0.5, serious: 0.2, sandbag: 0.15, blunder: 0.15 },
      take: { serious: 0.95, normal: 0.6, sandbag: 0.25, blunder: 0.3 },
      block: { serious: 0.9, normal: 0.62, sandbag: 0.22, blunder: 0.18 },
      floor: 3
    },
    serious: {
      label: '认真', tip: 'TA 想赢，有挑战',
      w: { normal: 0.35, serious: 0.55, sandbag: 0.05, blunder: 0.05 },
      take: { serious: 0.98, normal: 0.8, sandbag: 0.4, blunder: 0.5 },
      block: { serious: 0.96, normal: 0.82, sandbag: 0.4, blunder: 0.45 },
      floor: 2
    }
  };
  const DIFF_ORDER = ['casual', 'daily', 'serious'];
  let selDiff = 'daily';

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }

  // ---- 音效（Web Audio 短促合成，v3.15 起全站音量标准 ~0.16） ----
  let audioCtx = null, soundOn = true;
  // v3.26.x：全站音量标准 ~0.16；suspended 时先 resume 再播——
  // TA 先手时第一次 beep 由 taMove 的 setTimeout（非用户手势）触发，
  // 此时 new AudioContext() 创建即 suspended，不 resume 则整局无声。
  function beep(freq, dur, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const play = () => {
        try {
          const o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.frequency.value = freq; o.type = 'sine';
          g.gain.value = vol || 0.16;
          o.connect(g); g.connect(audioCtx.destination);
          const t = audioCtx.currentTime;
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.start(t); o.stop(t + dur);
        } catch (e) {}
      };
      if (audioCtx.state === 'running') { play(); return; }
      const r = audioCtx.resume();
      if (r && r.then) r.then(play).catch(() => play());
      else play();
    } catch (e) {}
  }
  const sfxDropYou = () => beep(340, 0.09, 0.18);
  const sfxDropTa = () => beep(262, 0.09, 0.18);
  const sfxFull = () => beep(180, 0.06, 0.12);
  const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };
  const sfxLose = () => { beep(300, 0.14, 0.18); setTimeout(() => beep(220, 0.2, 0.18), 130); };
  const sfxDraw = () => beep(440, 0.12, 0.16);

  // ---- 对局状态 ----
  let st = null;
  let thinkT = null;
  let cellPx = 44;
  const THINK_LINES = ['TA正在想……', 'TA盯着棋盘看了一会儿', 'TA托着下巴琢磨'];

  function newState() {
    return {
      grid: [],                 // grid[r][c]：0 空 / 1 玩家 / 2 TA（r=0 顶行）
      turn: 1,
      over: false,
      started: false,
      lock: false,
      moves: 0,
      winCells: null,
      mode: 'normal',           // TA 本回合行为状态（每回合重抽）
      lastTaCol: null,
      missedBlocks: 0           // 玩家威胁被无视的连续次数（底线计数）
    };
  }
  function newGrid() {
    const g = [];
    for (let r = 0; r < ROWS; r++) { g.push([0, 0, 0, 0, 0, 0, 0]); }
    return g;
  }

  // ---- 战绩（每联系人独立） ----
  function statsKey() { return prefix() + ':c4-stats'; }
  function loadStats() {
    const d = { w: 0, l: 0, d: 0, nextFirst: 'you', lastDiff: 'daily' };
    try {
      const raw = localStorage.getItem(statsKey());
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
    } catch (e) {}
    return d;
  }
  function saveStats(s) { try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch (e) {} }
  function statsLine() {
    const s = loadStats();
    return '累计战绩 你 ' + s.w + '胜 · ' + T('TA') + ' ' + s.l + '胜 · ' + s.d + '平';
  }

  // ---- 规则：落点 / 胜负（纯函数，__c4Debug 复用） ----
  function dropRow(grid, c) {
    if (c < 0 || c >= COLS || grid[0][c] !== 0) return -1;
    for (let r = ROWS - 1; r >= 0; r--) { if (grid[r][c] === 0) return r; }
    return -1;
  }
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  // 从 (r,c) 出发四方向数连子；≥4 返回连线格子数组（用于高亮），否则 null
  function winLineAt(grid, r, c, side) {
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      const cells = [[r, c]];
      for (let s = -1; s <= 1; s += 2) {
        let rr = r + dr * s, cc = c + dc * s;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[rr][cc] === side) {
          cells.push([rr, cc]);
          rr += dr * s; cc += dc * s;
        }
      }
      if (cells.length >= 4) return cells;
    }
    return null;
  }
  function isFull(grid) {
    for (let c = 0; c < COLS; c++) { if (grid[0][c] === 0) return false; }
    return true;
  }

  // ---- TA 选列（一步判断 + 行为状态；不改动棋盘） ----
  function legalCols(grid) {
    const out = [];
    for (let c = 0; c < COLS; c++) { if (grid[0][c] === 0) out.push(c); }
    return out;
  }
  function winningCols(grid, side) {
    const out = [];
    for (let c = 0; c < COLS; c++) {
      const r = dropRow(grid, c);
      if (r < 0) continue;
      grid[r][c] = side;
      if (winLineAt(grid, r, c, side)) out.push(c);
      grid[r][c] = 0;
    }
    return out;
  }
  function pickTaCol(mode) {
    const grid = st.grid;
    const legal = legalCols(grid);
    if (!legal.length) return -1;
    const randOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const myWins = winningCols(grid, 2);
    const pThreats = winningCols(grid, 1);
    let col = null;

    const take = DIFFS[selDiff].take, blk = DIFFS[selDiff].block;
    if (mode === 'serious') {
      if (myWins.length && Math.random() < take.serious) col = randOf(myWins);
      else if (pThreats.length && Math.random() < blk.serious) col = randOf(pThreats);
    } else if (mode === 'normal') {
      if (myWins.length && Math.random() < take.normal) col = randOf(myWins);
      else if (pThreats.length && Math.random() < blk.normal) col = randOf(pThreats);
    } else if (mode === 'sandbag') {
      // 放水：把「能赢」「该堵」的好棋从候选里剔掉（各自有概率放行一次）
      let pool = legal.slice();
      if (myWins.length && Math.random() < 0.8) pool = pool.filter((c) => myWins.indexOf(c) < 0);
      if (pThreats.length && Math.random() < 0.75) pool = pool.filter((c) => pThreats.indexOf(c) < 0);
      col = pool.length ? randOf(pool) : null;
    } else { // blunder：人式失误，纯随机忽略局势；偶尔连着往相近列下
      if (st.lastTaCol != null && Math.random() < 0.35) {
        const near = [st.lastTaCol - 1, st.lastTaCol, st.lastTaCol + 1].filter((c) => legal.indexOf(c) >= 0);
        if (near.length) col = randOf(near);
      }
    }
    if (col == null) col = randOf(legal);
    return col;
  }
  // 底线（在 taMove 里对选中列应用，pick 本身保持纯函数便于验证）：
  // 这步既没赢也没堵玩家的将四 → 计数；连续 MISS_FLOOR 次被无视后强制堵。
  // 强制堵不重置计数——玩家在同一列顶上继续叠子时威胁仍在，不能又装看不见 3 次；
  // 只有真实堵上（自己选中或随机命中）才清零。
  function applyFloor(col) {
    const pThreats = winningCols(st.grid, 1), myWins = winningCols(st.grid, 2);
    const isBlock = pThreats.indexOf(col) >= 0;
    const isWin = myWins.indexOf(col) >= 0;
    if (!isBlock && !isWin && pThreats.length) {
      st.missedBlocks++;
      if (st.missedBlocks > DIFFS[selDiff].floor) return pThreats[Math.floor(Math.random() * pThreats.length)];
    }
    if (isBlock) st.missedBlocks = 0;
    return col;
  }
  function rollMode() {
    const w = DIFFS[selDiff].w;
    const r = Math.random();
    if (r < w.normal) return 'normal';
    if (r < w.normal + w.serious) return 'serious';
    if (r < w.normal + w.serious + w.sandbag) return 'sandbag';
    return 'blunder';
  }

  // ---- 渲染 ----
  function buildBoard() {
    boardEl.innerHTML = '';
    for (let c = 0; c < COLS; c++) {
      const col = document.createElement('div');
      col.className = 'c4-col';
      col.setAttribute('data-col', String(c));
      for (let r = 0; r < ROWS; r++) {
        const cell = document.createElement('div');
        cell.className = 'c4-cell';
        cell.setAttribute('data-r', String(r));
        col.appendChild(cell);
      }
      boardEl.appendChild(col);
    }
  }
  function fitBoard() {
    if (!stageEl || panel.hidden) return;
    const w = stageEl.clientWidth;
    if (!w) return;
    cellPx = Math.max(30, Math.min(48, Math.floor(w / COLS)));
    boardEl.style.width = (cellPx * COLS) + 'px';
    const cells = boardEl.querySelectorAll('.c4-cell');
    for (let i = 0; i < cells.length; i++) cells[i].style.height = cellPx + 'px';
  }
  function cellAt(r, c) {
    const col = boardEl.children[c];
    return col ? col.children[r] : null;
  }
  function fastMul() { return (window.__c4Debug && window.__c4Debug.fast) ? 0.05 : 1; }

  // 落子动画：棋子从棋盘上方掉进目标格（transform 过渡），结束后回调
  function animateDrop(r, c, side, cb) {
    const cell = cellAt(r, c);
    const disc = document.createElement('span');
    disc.className = 'c4-disc ' + (side === 1 ? 'c4-you' : 'c4-ta');
    const dist = (r + 1) * cellPx;
    const dur = Math.round((110 + r * 42) * fastMul());
    disc.style.transform = 'translateY(-' + dist + 'px)';
    disc.style.transitionDuration = dur + 'ms';
    cell.appendChild(disc);
    requestAnimationFrame(() => { requestAnimationFrame(() => { disc.style.transform = ''; }); });
    setTimeout(() => {
      disc.classList.add('c4-land');
      if (cb) cb();
    }, dur + Math.round(70 * fastMul()) + 20);
  }

  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  // FIX 2026-09-16：状态栏 innerHTML 拼 TA 名字（cs-lbl-partner 用户可控）未转义——名字走 esc 再拼
  function escName() { const n = String(T('TA')); const d = document.createElement('div'); d.textContent = n; return d.innerHTML; }
  function dot(side) { return '<i class="c4-dot ' + (side === 1 ? 'c4-dot-you' : 'c4-dot-ta') + '"></i>'; }
  function showTurnStatus() {
    if (!statusEl) return;
    if (st.over) return;
    setStatus(st.turn === 1 ? dot(1) + '你的回合' : escName() + '正在想……');
  }

  // ---- 对局流程 ----
  function clearBoardDom() {
    boardEl.querySelectorAll('.c4-disc').forEach((d) => d.remove());
    boardEl.querySelectorAll('.c4-wincol').forEach((el) => el.classList.remove('c4-wincol'));
  }
  function newGame() {
    clearTimeout(thinkT); thinkT = null;
    st = newState();
    st.grid = newGrid();
    st.started = true;
    clearBoardDom();
    hideOverlay();
    const s = loadStats();
    st.turn = s.nextFirst === 'ta' ? 2 : 1;
    setStatus(st.turn === 1 ? dot(1) + '你的回合，点击一列落子' : T('TA') + '先手');
    if (st.turn === 2) scheduleTaMove(Math.max(THINK_MIN, 700));
  }
  function scheduleTaMove(delay) {
    clearTimeout(thinkT);
    const line = THINK_LINES[Math.floor(Math.random() * THINK_LINES.length)];
    setStatus(T(line).replace('TA', escName()));
    thinkT = setTimeout(taMove, Math.round(delay * fastMul()));
  }
  function taMove() {
    if (!st || st.over || st.turn !== 2) return;
    st.mode = rollMode();
    let col = pickTaCol(st.mode);
    if (col < 0) return;
    col = applyFloor(col);
    const r = dropRow(st.grid, col);
    if (r < 0) return;
    st.lock = true;
    st.lastTaCol = col;
    st.grid[r][col] = 2;
    st.moves++;
    sfxDropTa();
    animateDrop(r, col, 2, () => {
      const line = winLineAt(st.grid, r, col, 2);
      if (line) { highlightWin(line); endGame(2); return; }
      if (isFull(st.grid)) { endGame(0); return; }
      st.turn = 1; st.lock = false;
      showTurnStatus();
    });
  }
  function playerDrop(c) {
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    const r = dropRow(st.grid, c);
    if (r < 0) {
      sfxFull();
      const colEl = boardEl.children[c];
      if (colEl) { colEl.classList.remove('c4-shake'); void colEl.offsetWidth; colEl.classList.add('c4-shake'); }
      setStatus(dot(1) + '这一列已经满了');
      return;
    }
    st.lock = true;
    st.grid[r][c] = 1;
    st.moves++;
    sfxDropYou();
    animateDrop(r, c, 1, () => {
      const line = winLineAt(st.grid, r, c, 1);
      if (line) { highlightWin(line); endGame(1); return; }
      if (isFull(st.grid)) { endGame(0); return; }
      st.turn = 2;
      // FIX 2026-09-16：关面板后落子动画回调再补调度，会让 TA 在面板隐藏时下完一子
      // （与 closeC4Panel 清 thinkT 的暂停语义矛盾）——隐藏时只置回合，重开面板走补调度
      if (!panel.hidden) scheduleTaMove(THINK_MIN + Math.random() * THINK_VAR);
    });
  }
  function highlightWin(cells) {
    st.winCells = cells;
    for (let i = 0; i < cells.length; i++) {
      const cell = cellAt(cells[i][0], cells[i][1]);
      if (cell) { cell.classList.add('c4-wincol'); const d = cell.querySelector('.c4-disc'); if (d) d.classList.add('c4-win'); }
    }
  }

  // ---- 结束：结果 / 战绩 / 聊天联动 ----
  function endGame(winner) {
    st.over = true; st.lock = false;
    clearTimeout(thinkT); thinkT = null;
    const s = loadStats();
    if (winner === 1) { s.w++; s.nextFirst = 'ta'; }
    else if (winner === 2) { s.l++; s.nextFirst = 'you'; }
    else { s.d++; s.nextFirst = Math.random() < 0.5 ? 'you' : 'ta'; }   // 平局下一局随机先手
    saveStats(s);
    if (winner === 1) sfxWin(); else if (winner === 2) sfxLose(); else sfxDraw();
    // v3.15.x 二调：奖励对齐红包金额体系——胜 80% ¥13.14 / 20% ¥52，平 ¥5.2（日封顶 ¥104）
    // v3.16.x：四子棋改为双方同步同额入账（不再只给赢家），赚钱流水记「四子棋」
    var coinLine4 = '';
    try {
      var COIN_CAP = 10400;
      // FIX 2026-09-16：封顶键 UTC 日期改本地日期（UTC 口径下北京时间 0-8 点记到前一天）
      var d4 = new Date();
      var day4 = d4.getFullYear() + '-' + (d4.getMonth() + 1) + '-' + d4.getDate();
      var ck4 = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':ml2_coin_c4_' + day4;
      var cur4 = Number(localStorage.getItem(ck4)) || 0;
      if (cur4 < COIN_CAP) {
        var c4WinFen = Math.random() < 0.2 ? 5200 : 1314;
        // FIX 2026-09-16：幸运日（游乐室）奖励 ×2，仍受日封顶约束
        var c4Mult = (window.arcadeMult && window.arcadeMult('c4')) || 1;
        var real4 = Math.min((winner === 0 ? 520 : c4WinFen) * c4Mult, COIN_CAP - cur4);
        try { localStorage.setItem(ck4, String(cur4 + real4)); } catch (e2) {}
        if (real4 > 0 && typeof window.giftWalletChange === 'function') {
          if (window.giftWalletChange(real4, real4, '四子棋')) {
            coinLine4 = '🪙 双方心意币各 +¥' + (real4 / 100).toFixed(2);
          }
        }
      }
    } catch (e) {}
    // FIX 2026-09-16：接游乐室三件套——幸运日打卡 + 玩家胜利 8% 掉限定摆件（此前 ×2/掉落经 c4 永不生效）
    var c4Drop = null;
    try {
      if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('c4');
      if (winner === 1 && window.arcadeTryDrop) c4Drop = window.arcadeTryDrop('c4');
    } catch (e) {}
    const title = winner === 1 ? '🏆 你赢了！' : winner === 2 ? T('TA') + '赢了' : '平局';
    const body =
      '<div class="pong-end-stat">本局共 ' + st.moves + ' 手</div>' +
      '<div class="pong-end-stat">' + statsLine() + '</div>' +
      '<div class="pong-end-stat">下一局 ' + (s.nextFirst === 'you' ? '你' : T('TA')) + '先手</div>' +
      (coinLine4 ? '<div class="pong-end-stat">' + coinLine4 + '</div>' : '') +
      (c4Drop ? '<div class="pong-end-stat">🎁 掉落限定摆件「' + c4Drop.name + '」</div>' : '') +
      pillsHtml() +
      '<div class="ms-cur">' + diffHint() + '</div>';
    showOverlay(title, body, '再来一局');
    if (startBtn) startBtn.textContent = '再来一局';
    if (endBtn) endBtn.hidden = false;
    setStatus(winner === 1 ? '🎉 你赢了！' : winner === 2 ? escName() + '赢了这一局' : '这局没有分出胜负');
    // 写聊天系统消息 + TA 随机回应（分组语义同贪吃蛇：输的一方视角）
    try {
      const resTxt = winner === 1 ? '你赢' : winner === 2 ? T('TA') + '赢' : '平局';
      if (window.chatAddSystem) window.chatAddSystem(T('四子棋') + ' · ' + resTxt, { special: 'c4' });
      const grp = winner === 1 ? '游戏失败·回应' : winner === 2 ? '游戏胜利·回应' : '游戏平局·回应';
      const fb = winner === 1 ? ['让你赢啦，再来？'] : winner === 2 ? ['我赢啦，再来一局吗'] : ['平局，再来一局？'];
      const pool = window.getInteractPool ? window.getInteractPool(grp, fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      setTimeout(() => {
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
    showOverlay('四子棋',
      pillsHtml() +
      '<div class="ms-cur" id="c4-cur">' + diffHint() + '</div>' +
      '<div class="c4-start-tip">你执 🔵 · ' + T('TA') + '执 🟡<br>轮流点击一列落子，先连成四子的一方获胜</div>' +
      '<div class="c4-start-note">🎲 ' + T('TA') + '每回合状态随机——认真/正常/放水/失误</div>' +
      (s.w + s.l + s.d > 0 ? '<div class="pong-end-stat">' + statsLine() + '</div>' : ''),
      s.w + s.l + s.d > 0 ? '再来一局' : '开始对局');
    if (endBtn) endBtn.hidden = true;
  }
  function pillsHtml() {
    return '<div class="ms-diffs">' + DIFF_ORDER.map((k) => {
      const d = DIFFS[k];
      return '<button class="ms-diff' + (k === selDiff ? ' on' : '') + '" data-diff="' + k + '" type="button" title="' + d.tip + '">' + d.label + '</button>';
    }).join('') + '</div>';
  }
  function diffHint() { return '当前：' + DIFFS[selDiff].label + ' · ' + DIFFS[selDiff].tip; }
  function hideOverlay() { if (overlayEl) overlayEl.hidden = true; if (endBtn) endBtn.hidden = true; }

  // ---- 输入 ----
  buildBoard();   // 棋盘 DOM 只建一次（newGame 只清棋子不动结构）
  boardEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const colEl = e.target.closest('.c4-col');
    if (!colEl) return;
    playerDrop(parseInt(colEl.getAttribute('data-col'), 10) || 0);
  });

  if (startBtn) startBtn.addEventListener('click', (e) => { e.stopPropagation(); newGame(); });
  if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closeC4Panel(); });
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeC4Panel(); });
  if (ovBodyEl) ovBodyEl.addEventListener('click', (e) => {
    const pill = e.target.closest('.ms-diff');
    if (!pill) return;
    e.stopPropagation();
    const k = pill.getAttribute('data-diff');
    if (!DIFFS[k]) return;
    selDiff = k;
    const stat = loadStats();
    stat.lastDiff = k;
    saveStats(stat);
    const pills = ovBodyEl.querySelectorAll('.ms-diff');
    pills.forEach((p) => { p.classList.toggle('on', p.getAttribute('data-diff') === k); });
    const curEl = document.getElementById('c4-cur');
    if (curEl) curEl.textContent = diffHint();
    else { const c2 = ovBodyEl.querySelector('.ms-cur'); if (c2) c2.textContent = diffHint(); }
  });
  if (soundBtn) soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.classList.toggle('pong-sound-off', !soundOn);
  });

  // ---- 打开 / 关闭 ----
  function setNames() {
    let name = T('TA');
    try {
      const s = window.activeStore && window.activeStore();
      name = (s && (s.get('cs-lbl-partner') || s.get('lbl-partner'))) || name;
    } catch (e) {}
    if (partnerNameEl) partnerNameEl.textContent = name;
    if (sideNameEl) sideNameEl.textContent = name;
  }
  window.openC4Panel = function () {
    try { if (isFs) toggleFs(); } catch (e) {}
    // 先亮面板再做次要初始化：任何一步异常都不影响半框本身弹出
    if (!boardEl.children.length) { try { buildBoard(); } catch (e) {} }
    panel.hidden = false;
    try { const s = loadStats(); if (DIFFS[s.lastDiff]) selDiff = s.lastDiff; } catch (e) {}
    try { setNames(); } catch (e) {}
    try { fitBoard(); } catch (e) {}
    // 有进行中的对局 → 接着玩（关面板期间轮到 TA 的补调度）
    if (st && st.started && !st.over) {
      if (st.turn === 2 && !thinkT) scheduleTaMove(THINK_MIN + Math.random() * THINK_VAR);
      else if (st.turn === 1) showTurnStatus();
      return;
    }
    showStartOverlay();
    setStatus('点击「开始对局」');
  };
  function closeC4Panel() {
    clearTimeout(thinkT); thinkT = null;
    if (panel) panel.hidden = true;
  }
  window.closeC4Panel = closeC4Panel;
  document.addEventListener('contact-switched', () => { try { closeC4Panel(); } catch (e) {} });
  window.addEventListener('resize', () => { if (!panel.hidden) fitBoard(); });

  // ---- 入口：聊天更多功能 → 小游戏 → 四子棋（自绑定，chat.js 不改） ----
  (function bindEntry() {
    const btn = document.getElementById('more-c4');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      // 收起其他半框（与 chat.js 各入口处理一致）
      const hideIds = ['poke-card', 'emoji-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-snake-panel'];
      hideIds.forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
      try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
      try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
      try { openC4Panel(); } catch (err) {
        // 兜底：初始化异常也要把面板亮出来（否则表现为「点了没反应」）
        try { panel.hidden = false; showStartOverlay(); setStatus('点击「开始对局」'); } catch (e2) {}
        try { console.error('[c4] open failed', err); } catch (e2) {}
      }
    });
    // 兄弟浮层互斥兜底：其他入口不知道本面板，它们打开时收起本面板
    try {
      if (window.MutationObserver) {
        const SIBLING_IDS = ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-more-panel'];
        const mo = new MutationObserver(() => {
          if (panel.hidden) return;
          for (let i = 0; i < SIBLING_IDS.length; i++) {
            const el = document.getElementById(SIBLING_IDS[i]);
            if (el && !el.hidden) { closeC4Panel(); break; }
          }
        });
        SIBLING_IDS.forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
      }
    } catch (e) {}
  })();

  // 只读调试口（tools/verify-connect-four.mjs 专用）：确定性用例 + 快速模式
  window.__c4Debug = {
    st: () => st,
    newGame: newGame,
    dropRow: (g, c) => dropRow(g, c),
    winLineAt: (g, r, c, s) => winLineAt(g, r, c, s),
    rollMode: rollMode,
    pick: pickTaCol,                       // 纯函数：按 st.grid 选列（不改棋盘/计数）
    floor: applyFloor,                     // 底线应用（会更新 missedBlocks）
    winningCols: (side) => winningCols(st.grid, side),
    fast: false
  };
})();

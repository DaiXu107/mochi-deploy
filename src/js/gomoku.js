// ===== 功能：五子棋（聊天页更多功能 → 小游戏） =====
// 经典 11×11 落子棋盘（迷你盘，手机半框一屏放得下、对局节奏更快）：玩家 vs 梦角（TA），
// 轮流落子、先连成五子的一方获胜。骨架同四子棋（connect-four.js）：
// TA 不用真搜索 AI，只有「一步判断 + 候选打分」+ 每回合随机抽行为状态：
//   正常(50%)  按打分挑不错的点，偶尔降档；
//   认真(20%)  自己能成五立刻下；玩家将成五大概率堵上；
//   放水(15%)  明显的好棋（能赢/该堵/高分点）有概率故意不下；
//   失误(15%)  人式疏忽：贴着玩家最后一手附近乱下。
// 每回合重新抽状态——不会一整局固定聪明或固定放水。
// 底线保护：玩家「下一步就成五」的点连续 3 回合被无视后，第 4 次必堵。
// 界面不做难度选择外的复杂设置，难度分档（休闲/日常/认真）语义同四子棋。
// 其他：战绩按联系人桌面存 localStorage；先手规则=首局玩家先手，之后上一局输家
// 先手（平局随机）；结束写聊天系统消息 + TA 随机回应（复用字卡库 游戏胜利/失败/
// 平局·回应 分组）；心意币双方同步同额入账（日封顶）；音效 Web Audio 合成可静音。
// 入口绑定在本文件内完成（不改 chat.js），半框容器复用 .poke-card 与 .pong-overlay 组件。
(function () {
  const panel = document.getElementById('chat-gomoku-panel');
  if (!panel) return;
  const boardEl = document.getElementById('gk-board');
  const stageEl = document.getElementById('gk-stage');
  const statusEl = document.getElementById('gk-status');
  const overlayEl = document.getElementById('gk-overlay');
  const ovTitleEl = document.getElementById('gk-ov-title');
  const ovBodyEl = document.getElementById('gk-ov-body');
  const startBtn = document.getElementById('gk-btn-start');
  const endBtn = document.getElementById('gk-btn-end');
  const soundBtn = document.getElementById('gk-sound');
  const undoBtn = document.getElementById('gk-undo');
  const closeBtn = document.getElementById('gk-close');
  const fsBtn = document.getElementById('gk-fs');
  const diffSel = document.getElementById('gk-diff');   // FIX 2026-09-16：头部难度下拉（对局中也可换），原只藏在结算/开始覆盖层的 pills 里

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
  const partnerNameEl = document.getElementById('gk-partner-name');
  const sideNameEl = document.getElementById('gk-side-name');

  const N = 11;                       // 11×11 迷你盘
  const THINK_MIN = 550, THINK_VAR = 700;
  // ---- 难度档（TA 行为权重 / 一步判断概率 / 底线阈值），语义同四子棋 ----
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
  const THINK_LINES = ['TA正在想……', 'TA盯着棋盘看了一会儿', 'TA托着下巴琢磨'];

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function fastMul() { return (window.__gkDebug && window.__gkDebug.fast) ? 0.05 : 1; }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }

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
  const sfxBad = () => beep(180, 0.06, 0.12);
  const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };
  const sfxLose = () => { beep(300, 0.14, 0.18); setTimeout(() => beep(220, 0.2, 0.18), 130); };
  const sfxDraw = () => beep(440, 0.12, 0.16);

  // ---- 对局状态 ----
  let st = null;
  let thinkT = null;
  let ovT = null;               // #341 胜利连线动画播完再弹结果浮层的定时器
  let cellPx = 30;

  function newState() {
    return {
      grid: [],                 // grid[r][c]：0 空 / 1 玩家(🔵黑) / 2 TA(⚪白)
      turn: 1,
      over: false,
      started: false,
      moves: 0,
      winCells: null,
      mode: 'normal',           // TA 本回合行为状态（每回合重抽）
      lastPlayer: null,         // 玩家最后一手（失误状态贴着下）
      lastTaPt: null,
      missedBlocks: 0,          // 玩家成五点被无视的连续次数（底线计数）
      undoUsed: false           // #301 悔棋每局 1 次
    };
  }
  function newGrid() {
    const g = [];
    for (let r = 0; r < N; r++) { g.push(new Array(N).fill(0)); }
    return g;
  }

  // ---- 战绩（每联系人独立） ----
  function statsKey() { return prefix() + ':gomoku-stats'; }
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

  // ---- 规则：胜负（纯函数，__gkDebug 复用） ----
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  function inBoard(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  // 从 (r,c) 已落的 side 子出发数连子；≥5 返回连线格子数组（用于高亮），否则 null
  function winLineAt(grid, r, c, side) {
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      const cells = [[r, c]];
      for (let s = -1; s <= 1; s += 2) {
        let rr = r + dr * s, cc = c + dc * s;
        while (inBoard(rr, cc) && grid[rr][cc] === side) {
          cells.push([rr, cc]);
          rr += dr * s; cc += dc * s;
        }
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }
  function isFull() { return st.moves >= N * N; }

  // ---- TA 选点：一步判断 + 候选打分（不改动棋盘，纯函数便于验证） ----
  // 假设 side 落在 (r,c)：四方向各数「连子数 + 两端开放数」按棋型打分。
  // 成五 >> 活四 >> 冲四/活三 >> ……；防守权重 0.9（自己成五永远优先于堵对方）。
  function lineScore(grid, r, c, side) {
    let score = 0;
    for (let d = 0; d < DIRS.length; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      let cnt = 1, open = 0;
      let rr = r + dr, cc = c + dc;
      while (inBoard(rr, cc) && grid[rr][cc] === side) { cnt++; rr += dr; cc += dc; }
      if (inBoard(rr, cc) && grid[rr][cc] === 0) open++;
      rr = r - dr; cc = c - dc;
      while (inBoard(rr, cc) && grid[rr][cc] === side) { cnt++; rr -= dr; cc -= dc; }
      if (inBoard(rr, cc) && grid[rr][cc] === 0) open++;
      if (cnt >= 5) score += 100000;
      else if (cnt === 4) score += open === 2 ? 50000 : (open === 1 ? 8000 : 0);
      else if (cnt === 3) score += open === 2 ? 6000 : (open === 1 ? 500 : 0);
      else if (cnt === 2) score += open === 2 ? 300 : (open === 1 ? 60 : 0);
      else score += open === 2 ? 20 : 4;
    }
    return score;
  }
  function evalPt(grid, r, c) {
    return lineScore(grid, r, c, 2) + lineScore(grid, r, c, 1) * 0.9;
  }
  // 有子的邻域 2 格内的空点（无子棋盘返回中心）
  function candidates(grid) {
    const out = [];
    let any = false;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (grid[r][c] !== 0) { any = true; break; }
    }
    if (!any) return [[Math.floor(N / 2), Math.floor(N / 2)]];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (grid[r][c] !== 0) continue;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (inBoard(rr, cc) && grid[rr][cc] !== 0) { near = true; break; }
      }
      if (near) out.push([r, c]);
    }
    return out;
  }
  function fivePoints(grid, side, cands) {
    const list = cands || candidates(grid);
    return list.filter((p) => lineScore(grid, p[0], p[1], side) >= 100000);
  }
  function pickTaPt(mode) {
    const grid = st.grid;
    const cands = candidates(grid);
    if (!cands.length) return null;
    const myFive = fivePoints(grid, 2, cands);
    const pFive = fivePoints(grid, 1, cands);
    const take = DIFFS[selDiff].take, blk = DIFFS[selDiff].block;
    let pt = null;

    if (mode === 'serious') {
      if (myFive.length && Math.random() < take.serious) pt = pick(myFive);
      else if (pFive.length && Math.random() < blk.serious) pt = pick(pFive);
    } else if (mode === 'normal') {
      if (myFive.length && Math.random() < take.normal) pt = pick(myFive);
      else if (pFive.length && Math.random() < blk.normal) pt = pick(pFive);
    }
    if (!pt && mode !== 'sandbag' && mode !== 'blunder') {
      // 打分挑点：认真=全局面最佳（带小噪声），正常=前三随机（人式不精确）
      const scored = cands.map((p) => ({ p: p, s: evalPt(grid, p[0], p[1]) }));
      scored.sort((a, b) => b.s - a.s);
      if (mode === 'serious') {
        let best = scored[0];
        for (let i = 1; i < Math.min(3, scored.length); i++) {
          if (scored[i].s > best.s * (0.95 + Math.random() * 0.1)) best = scored[i];
        }
        pt = best.p;
      } else {
        pt = pick(scored.slice(0, Math.min(3, scored.length)).map((x) => x.p));
      }
    }
    if (!pt && mode === 'sandbag') {
      // 放水：剔掉能赢/该堵/打分前三的好棋再随缘选（各自有概率放行一次）
      let pool = cands.slice();
      if (myFive.length && Math.random() < 0.8) pool = pool.filter((p) => myFive.indexOf(p) < 0);
      if (pFive.length && Math.random() < 0.75) pool = pool.filter((p) => pFive.indexOf(p) < 0);
      const scored = pool.map((p) => ({ p: p, s: evalPt(grid, p[0], p[1]) }));
      scored.sort((a, b) => b.s - a.s);
      pool = scored.slice(3).map((x) => x.p);
      pt = pool.length ? pick(pool) : null;
    }
    if (!pt && mode === 'blunder') {
      // 人式失误：贴着玩家最后一手附近乱下
      if (st.lastPlayer && Math.random() < 0.7) {
        const near = [];
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
          const rr = st.lastPlayer[0] + dr, cc = st.lastPlayer[1] + dc;
          if (inBoard(rr, cc) && grid[rr][cc] === 0) near.push([rr, cc]);
        }
        if (near.length) pt = pick(near);
      }
    }
    if (!pt) pt = pick(cands);
    return pt;
  }
  // 底线（在 taMove 里对选中点应用，pick 保持纯函数）：这步既没赢也没堵玩家的成五点
  // → 计数；连续 floor 次被无视后强制堵。只有真实堵上/自己成五才清零。
  function applyFloor(pt) {
    const cands = candidates(st.grid);
    const pFive = fivePoints(st.grid, 1, cands);
    const myFive = fivePoints(st.grid, 2, cands);
    const isBlock = pFive.some((p) => p[0] === pt[0] && p[1] === pt[1]);
    const isWin = myFive.some((p) => p[0] === pt[0] && p[1] === pt[1]);
    if (!isBlock && !isWin && pFive.length) {
      st.missedBlocks++;
      if (st.missedBlocks > DIFFS[selDiff].floor) return pick(pFive);
    }
    if (isBlock) st.missedBlocks = 0;
    return pt;
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
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const cell = document.createElement('div');
      cell.className = 'gk-cell';
      cell.setAttribute('data-r', String(r));
      cell.setAttribute('data-c', String(c));
      boardEl.appendChild(cell);
    }
  }
  function fitBoard() {
    if (!stageEl || panel.hidden) return;
    const w = stageEl.clientWidth;
    if (!w) return;
    cellPx = Math.max(24, Math.min(40, Math.floor(w / N)));
    boardEl.style.width = (cellPx * N) + 'px';
    boardEl.style.height = (cellPx * N) + 'px';
    const cells = boardEl.querySelectorAll('.gk-cell');
    for (let i = 0; i < cells.length; i++) { cells[i].style.width = cellPx + 'px'; cells[i].style.height = cellPx + 'px'; }
  }
  function cellAt(r, c) {
    const i = r * N + c;
    return boardEl.children[i] || null;
  }
  function drawStone(r, c, side) {
    const cell = cellAt(r, c);
    if (!cell) return;
    // #341 先清同格退场中的棋子（悔棋动画未摘除时同点立即落子不残留）
    cell.querySelectorAll('.gk-stone.gk-vanish').forEach((s) => s.remove());
    const s = document.createElement('span');
    // #341 落子动画：压下回弹（纯表现层，逻辑不变）
    s.className = 'gk-stone ' + (side === 1 ? 'gk-you' : 'gk-ta') + ' gk-drop';
    cell.appendChild(s);
  }
  function markLast(r, c) {
    boardEl.querySelectorAll('.gk-last').forEach((el) => el.classList.remove('gk-last'));
    const cell = cellAt(r, c);
    if (cell) { const s = cell.querySelector('.gk-stone'); if (s) s.classList.add('gk-last'); }
  }
  function highlightWin(cells) {
    st.winCells = cells;
    // #341 按连线走向排序逐颗点亮（stagger），棋盘加 gk-dim 让其余子退暗衬托
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 0; i < cells.length; i++) {
      const cell = cellAt(cells[i][0], cells[i][1]);
      if (cell) {
        const s = cell.querySelector('.gk-stone');
        if (s) { s.classList.add('gk-win'); s.style.setProperty('--gk-win-i', String(i)); }
      }
    }
    boardEl.classList.add('gk-dim');
  }

  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  // #301 中局 TA 泡泡：半框棋盘上方冒一句台词，1.6s 自动消散（同打砖块场内泡泡语义）
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
    setStatus(st.turn === 1 ? dot(1) + '你的回合' : T('TA') + '正在想……');
  }

  // ---- 对局流程 ----
  function clearBoardDom() {
    boardEl.querySelectorAll('.gk-stone').forEach((s) => s.remove());
    boardEl.classList.remove('gk-dim');
    boardEl.querySelectorAll('.gk-win').forEach((el) => el.classList.remove('gk-win'));
    boardEl.querySelectorAll('.gk-last').forEach((el) => el.classList.remove('gk-last'));
  }
  function newGame() {
    clearTimeout(thinkT); thinkT = null;
    clearTimeout(ovT);
    st = newState();
    st.grid = newGrid();
    st.started = true;
    clearBoardDom();
    hideOverlay();
    if (undoBtn) undoBtn.classList.remove('gk-undo-used');
    const s = loadStats();
    st.turn = s.nextFirst === 'ta' ? 2 : 1;
    setStatus(st.turn === 1 ? dot(1) + '你的回合，点棋盘落子' : T('TA') + '先手');
    if (st.turn === 2) scheduleTaMove(Math.max(THINK_MIN, 700));
  }
  function scheduleTaMove(delay) {
    clearTimeout(thinkT);
    const line = THINK_LINES[Math.floor(Math.random() * THINK_LINES.length)];
    setStatus(T(line));
    thinkT = setTimeout(taMove, Math.round(delay * fastMul()));
  }
  function taMove() {
    if (!st || st.over || st.turn !== 2) return;
    st.mode = rollMode();
    const picked = pickTaPt(st.mode);
    if (!picked) { endGame(0); return; }
    const pt = applyFloor(picked);
    const forced = pt[0] !== picked[0] || pt[1] !== picked[1];
    st.grid[pt[0]][pt[1]] = 2;
    st.moves++;
    st.lastTaPt = pt;
    sfxDropTa();
    drawStone(pt[0], pt[1], 2);
    markLast(pt[0], pt[1]);
    if (forced) taSay(pick(['这手我不能装没看见～', '堵你！别想连五']));
    const line = winLineAt(st.grid, pt[0], pt[1], 2);
    if (line) { highlightWin(line); endGame(2); return; }
    if (isFull()) { endGame(0); return; }
    st.turn = 1;
    showTurnStatus();
  }
  function playerDrop(r, c) {
    if (!st || !st.started || st.over || st.turn !== 1) return;
    if (st.grid[r][c] !== 0) { sfxBad(); return; }
    st.grid[r][c] = 1;
    st.moves++;
    st.lastPlayer = [r, c];
    sfxDropYou();
    drawStone(r, c, 1);
    markLast(r, c);
    const line = winLineAt(st.grid, r, c, 1);
    if (line) { highlightWin(line); endGame(1); return; }
    if (isFull()) { endGame(0); return; }
    st.turn = 2;
    scheduleTaMove(THINK_MIN + Math.random() * THINK_VAR);
  }
  // #301 悔棋：撤回 TA 的最后一手 + 自己的最后一手，每局 1 次（自己回合才可用）
  function undoMove() {
    if (!st || !st.started || st.over || st.turn !== 1 || st.undoUsed) return;
    if (!st.lastPlayer || !st.lastTaPt) return;
    clearTimeout(thinkT); thinkT = null;
    [st.lastTaPt, st.lastPlayer].forEach((p) => {
      st.grid[p[0]][p[1]] = 0;
      st.moves = Math.max(0, st.moves - 1);
      const cell = cellAt(p[0], p[1]);
      if (cell) {
        const s = cell.querySelector('.gk-stone');
        if (s) {
          // #341 悔棋退场：缩小淡出后再摘除；期间同点落子由 drawStone 兜底先清
          s.classList.add('gk-vanish');
          setTimeout(() => { try { if (s.parentNode) s.parentNode.removeChild(s); } catch (e) {} }, Math.round(190 * fastMul()) + 30);
        }
      }
    });
    st.lastTaPt = null; st.lastPlayer = null; st.winCells = null;
    st.undoUsed = true;
    if (undoBtn) undoBtn.classList.add('gk-undo-used');
    beep(440, 0.08, 0.14);
    boardEl.querySelectorAll('.gk-last').forEach((el) => el.classList.remove('gk-last'));
    setStatus(dot(1) + '已悔棋（每局 1 次），重新想');
  }

  // ---- 结束：结果 / 战绩 / 聊天联动 ----
  function endGame(winner) {
    st.over = true;
    clearTimeout(thinkT); thinkT = null;
    const s = loadStats();
    if (winner === 1) { s.w++; s.nextFirst = 'ta'; }
    else if (winner === 2) { s.l++; s.nextFirst = 'you'; }
    else { s.d++; s.nextFirst = Math.random() < 0.5 ? 'you' : 'ta'; }
    saveStats(s);
    if (winner === 1) sfxWin(); else if (winner === 2) sfxLose(); else sfxDraw();
    // 中局情绪收尾（#301 泡泡）
    if (winner === 1) taSay(pick(['让你赢啦…', '下次没这么容易！']));
    else if (winner === 2) taSay(pick(['五连，赢啦！', '承让承让～']));
    // 奖励对齐红包金额体系：胜 80% ¥13.14 / 20% ¥52，平 ¥5.2（日封顶 ¥104，双方同步同额）
    // #301：幸运游戏日该游戏奖励 ×2（arcade.js 提供 arcadeMult，缺省恒 1）
    var coinLine = '';
    var dropLine = '';
    try {
      var COIN_CAP = 10400;
      // FIX 2026-09-16：封顶键 UTC 日期改本地日期（UTC 口径下北京时间 0-8 点记到前一天）
      var dg = new Date();
      var day = dg.getFullYear() + '-' + (dg.getMonth() + 1) + '-' + dg.getDate();
      var ck = prefix() + ':ml2_coin_gomoku_' + day;
      var cur = Number(localStorage.getItem(ck)) || 0;
      if (cur < COIN_CAP) {
        var mult = (typeof window.arcadeMult === 'function') ? window.arcadeMult('gomoku') : 1;
        var winFen = Math.round((Math.random() < 0.2 ? 5200 : 1314) * mult);
        var real = Math.min(winner === 0 ? Math.round(520 * mult) : winFen, COIN_CAP - cur);
        try { localStorage.setItem(ck, String(cur + real)); } catch (e2) {}
        if (real > 0 && typeof window.giftWalletChange === 'function') {
          if (window.giftWalletChange(real, real, '五子棋')) {
            if (typeof window.arcadeMarkLuckyPlayed === 'function') window.arcadeMarkLuckyPlayed('gomoku');
            coinLine = '🪙 双方心意币各 +¥' + (real / 100).toFixed(2) + (mult > 1 ? '（🍀 幸运 ×2）' : '');
          }
        }
      }
    } catch (e) {}
    // #301 跨游戏掉落：玩家胜利 8% 概率掉限定摆件（arcade.js）
    if (winner === 1 && typeof window.arcadeTryDrop === 'function') {
      try {
        var dr = window.arcadeTryDrop('gomoku');
        if (dr) { dropLine = '<div class="pong-end-stat">🌠 掉落限定摆件「' + dr.ico + ' ' + dr.name + '」！游乐室图鉴 +1</div>'; taSay('哇，掉了「' + dr.name + '」！'); }
      } catch (e) {}
    }
    const title = winner === 1 ? '🏆 你赢了！' : winner === 2 ? T('TA') + '赢了' : '平局';
    const body =
      '<div class="pong-end-stat">本局共 ' + st.moves + ' 手</div>' +
      '<div class="pong-end-stat">' + statsLine() + '</div>' +
      '<div class="pong-end-stat">下一局 ' + (s.nextFirst === 'you' ? '你' : T('TA')) + '先手</div>' +
      (coinLine ? '<div class="pong-end-stat">' + coinLine + '</div>' : '') +
      dropLine +
      pillsHtml() +
      '<div class="ms-cur" id="gk-cur">' + diffHint() + '</div>';
    // #341 有胜利连线时先让连线逐颗点亮（~1s）再弹结果浮层；平局/满盘直接弹
    const showResult = () => {
      showOverlay(title, body, '再来一局');
      if (startBtn) startBtn.textContent = '再来一局';
      if (endBtn) endBtn.hidden = false;
    };
    clearTimeout(ovT);
    if (st.winCells && st.winCells.length) ovT = setTimeout(showResult, Math.round(1000 * fastMul()));
    else showResult();
    setStatus(winner === 1 ? '🎉 你赢了！' : winner === 2 ? T('TA') + '赢了这一局' : '棋盘下满了，平局');
    // 写聊天系统消息 + TA 随机回应（分组语义同四子棋：输的一方视角）
    try {
      const resTxt = winner === 1 ? '你赢' : winner === 2 ? T('TA') + '赢' : '平局';
      if (window.chatAddSystem) window.chatAddSystem(T('五子棋') + ' · ' + resTxt, { special: 'gomoku' });
      const grp = winner === 1 ? '游戏失败·回应' : winner === 2 ? '游戏胜利·回应' : '游戏平局·回应';
      const fb = winner === 1 ? ['让你赢啦，再来？'] : winner === 2 ? ['五连！我赢啦'] : ['平局，再来一局？'];
      const pool = window.getInteractPool ? window.getInteractPool(grp, fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      // FIX 2026-09-16：800ms 内切联系人桌面，TA 回应会发进新桌面的聊天流——回调前校验命名空间未变
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
    showOverlay('五子棋',
      pillsHtml() +
      '<div class="ms-cur" id="gk-cur">' + diffHint() + '</div>' +
      '<div class="c4-start-tip">你执 🔵黑 · ' + T('TA') + '执 ⚪白<br>轮流落子，先连成五子的一方获胜</div>' +
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
    const cell = e.target.closest('.gk-cell');
    if (!cell) return;
    playerDrop(parseInt(cell.getAttribute('data-r'), 10) || 0, parseInt(cell.getAttribute('data-c'), 10) || 0);
  });
  if (startBtn) startBtn.addEventListener('click', (e) => { e.stopPropagation(); newGame(); });
  if (undoBtn) undoBtn.addEventListener('click', (e) => { e.stopPropagation(); undoMove(); });
  if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
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
    const curEl = document.getElementById('gk-cur');
    if (curEl) curEl.textContent = diffHint();
    else { const c2 = ovBodyEl.querySelector('.ms-cur'); if (c2) c2.textContent = diffHint(); }
  });
  if (soundBtn) soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.classList.toggle('pong-sound-off', !soundOn);
  });
  // FIX 2026-09-16：头部难度下拉与覆盖层 pills 双向同步（match3/linkup 同款交互）
  if (diffSel) diffSel.addEventListener('change', () => {
    if (!DIFFS[diffSel.value]) return;
    selDiff = diffSel.value;
    const stat = loadStats();
    stat.lastDiff = selDiff;
    saveStats(stat);
    const curEl = document.getElementById('gk-cur');
    if (curEl) curEl.textContent = diffHint();
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
  window.openGomokuPanel = function () {
    try { if (isFs) toggleFs(); } catch (e) {}
    // 先亮面板再做次要初始化：任何一步异常都不影响半框本身弹出
    if (!boardEl.children.length) { try { buildBoard(); } catch (e) {} }
    panel.hidden = false;
    try { const s = loadStats(); if (DIFFS[s.lastDiff]) selDiff = s.lastDiff; } catch (e) {}
    try { if (diffSel && DIFFS[selDiff]) diffSel.value = selDiff; } catch (e) {}
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
  function closePanel() {
    clearTimeout(thinkT); thinkT = null;
    clearTimeout(ovT);
    if (panel) panel.hidden = true;
  }
  window.closeGomokuPanel = closePanel;
  // FIX 2026-09-16：原只关面板不清 st——换联系人后重开面板走「接着玩」分支，
  // 旧桌面的棋局在新联系人命名空间下打完，战绩/先手/封顶计数全串档
  document.addEventListener('contact-switched', () => { try { closePanel(); st = null; /* #548t */ } catch (e) {} });
  window.addEventListener('resize', () => { if (!panel.hidden) fitBoard(); });

  // ---- 入口：聊天更多功能 → 小游戏 → 五子棋（自绑定，chat.js 不改） ----
  (function bindEntry() {
    const btn = document.getElementById('more-gomoku');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      // 收起其他半框（与 chat.js 各入口处理一致）
      hideSiblingPanels(['chat-gomoku-panel']);
      try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
      try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
      try { openGomokuPanel(); } catch (err) {
        // 兜底：初始化异常也要把面板亮出来（否则表现为「点了没反应」）
        try { panel.hidden = false; showStartOverlay(); setStatus('点击「开始对局」'); } catch (e2) {}
        try { console.error('[gomoku] open failed', err); } catch (e2) {}
      }
    });
    // 兄弟浮层互斥兜底：其他入口不知道本面板，它们打开时收起本面板
    try {
      if (window.MutationObserver) {
        const SIBLING_IDS = siblingIds('chat-gomoku-panel');
        const mo = new MutationObserver(() => {
          if (panel.hidden) return;
          for (let i = 0; i < SIBLING_IDS.length; i++) {
            const el = document.getElementById(SIBLING_IDS[i]);
            // #427：hidden=false 但零渲染盒＝残留态（页面早已切走，视觉上没开着），
            // 不能当「兄弟面板开着」把本面板误关——否则表现为面板刚打开就自动消失回聊天、
            // 反复重开反复被关（刷新才恢复）
            if (el && !el.hidden && el.getClientRects().length > 0) { closePanel(); break; }
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
    siblingIds(self[0]).forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
  }

  // 只读调试口（供后续 verify 脚本复用）：确定性用例 + 快速模式
  window.__gkDebug = {
    st: () => st,
    newGame: newGame,
    winLineAt: winLineAt,
    lineScore: lineScore,
    evalPt: evalPt,
    candidates: candidates,
    fivePoints: fivePoints,
    rollMode: rollMode,
    pick: pickTaPt,                        // 纯函数：按 st.grid 选点（不改棋盘/计数）
    floor: applyFloor,                     // 底线应用（会更新 missedBlocks）
    fast: false
  };
})();

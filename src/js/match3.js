// ===== 功能：消消乐（聊天页更多功能 → 小游戏） =====
// 和 TA 轮流交换的经典三消：点一格再点相邻一格，交换后凑成同款三连即消除，
// 上方补落、连锁连消；两人共用一张棋盘、共同冲目标分，不计输赢、记「默契分」。
// #453 模式拆分（头部下拉，按联系人记住）：简单（默认）＝纯经典三消、不生成任何道具；
//       道具＝经典消消乐道具集——四连直线→↔️/↕️直线道具（被消除时清整行/整列）、
//       L/T 同色交叉（合计≥5格）→💥炸弹（清周围 3×3）、五连及以上→🌈彩虹（换任意色全消、
//       双彩虹随机清两色）；道具被消除时可连锁引爆其他道具。#301 炸弹/彩虹逻辑沿用。
// 彩虹不参与连线匹配；TA 出步枚举不使用彩虹（人式"不会用大招"）。
// TA 由代码控制（无真 AI）：每回合枚举全部可消交换步并打分，再抽行为状态——
//   serious 走最优步 / normal 前五随机（人式不精确）/ sandbag 故意走最差的可消步 /
//   blunder 先点一次无效交换（抖一下「点错了」）再随便走一步。
// 死锁自动洗牌；目标达成通关结算：写聊天记录（special:'match3'）+ 字卡库 TA 回应 +
// 默契分 + 心意币奖励（日封顶，#301 幸运游戏日 ×2）+ 8% 掉落限定摆件（arcade.js）。
// 难度（头部下拉）：休闲 300 / 普通 600 / 挑战 1000 分。
// 入口绑定在本文件内完成（不改 chat.js），半框容器复用 .poke-card 与 .pong-overlay 组件。
(function () {
  const panel = document.getElementById('chat-match3-panel');
  if (!panel) return;
  const boardEl = document.getElementById('m3-board');
  const stageEl = document.getElementById('m3-stage');
  const statusEl = document.getElementById('m3-status');
  const infoEl = document.getElementById('m3-info');
  const overlayEl = document.getElementById('m3-overlay');
  const ovTitleEl = document.getElementById('m3-ov-title');
  const ovBodyEl = document.getElementById('m3-ov-body');
  const startBtn = document.getElementById('m3-btn-start');
  const endBtn = document.getElementById('m3-btn-end');
  const hintBtn = document.getElementById('m3-hint');
  const soundBtn = document.getElementById('m3-sound');
  const closeBtn = document.getElementById('m3-close');
  const fsBtn = document.getElementById('m3-fs');

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
  const diffSel = document.getElementById('m3-diff');
  const modeSel = document.getElementById('m3-mode'); // #453 简单/道具模式
  const partnerNameEl = document.getElementById('m3-partner-name');

  const N = 8, KIND_N = 6;
  const GAP = 3;                 // 格间距（fitBoard 哨兵表达式依赖）
  const SWAP_MS = 170, POP_MS = 220, FALL_MS = 300;  // 交换/消除/下落动画时长
  const KINDS = ['🍓', '🍋', '🍇', '🔔', '⭐', '🎈'];
  const BOMB_BASE = 10;    // 10+c = 该色炸弹（💥，被消除炸 3×3）
  const RAINBOW = 20;      // 彩虹（🌈）
  const LINE_H = 30, LINE_V = 40; // 30+c / 40+c = 该色直线道具（↔️被消除清整行 / ↕️清整列）#453
  const DIFFS = {
    casual: { target: 300, coin: 520, label: '🌱 休闲 · 300 分' },
    normal: { target: 600, coin: 1314, label: '🌙 普通 · 600 分' },
    hard:   { target: 1000, coin: 5200, label: '⭐ 挑战 · 1000 分' }
  };
  const THINK_LINES = ['TA正在找能消的……', 'TA扫视着棋盘', 'TA歪头想了想'];
  const TURN_MIN = 900, TURN_VAR = 800;

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function fastMul() { return (window.__m3Debug && window.__m3Debug.fast) ? 0.05 : 1; }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
  function animMs(x) { return Math.round(x * fastMul()); }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function inBoard(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  // 彩虹没有颜色（不参与连线），炸弹/直线道具按所携带颜色参与匹配
  function colorOf(v) {
    if (v >= LINE_V) return v - LINE_V;
    if (v >= LINE_H) return v - LINE_H;
    if (v >= BOMB_BASE && v < RAINBOW) return v - BOMB_BASE;
    return v >= RAINBOW ? -1 : v;
  }
  // 彩虹判定（值域 20~29；#453 起直线道具 30+/40+ 也 ≥RAINBOW，全站判彩虹必须走这里，
  // 裸写 `>= RAINBOW` 会把直线道具误当彩虹）
  function isRainbow(v) { return v >= RAINBOW && v < LINE_H; }

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
  const sfxSwap = () => beep(380, 0.07, 0.14);
  const sfxClear = (n) => { beep(560 + Math.min(5, n) * 60, 0.09, 0.16); };
  const sfxBoom = () => { beep(120, 0.16, 0.2); setTimeout(() => beep(90, 0.14, 0.16), 60); };
  const sfxBad = () => beep(180, 0.07, 0.12);
  const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };

  // ---- 对局状态 ----
  let st = null;
  let thinkT = null;

  function newState(diff, mode) {
    return {
      diff: diff,
      target: DIFFS[diff].target,
      grid: [],                // grid[r][c]：0..5 颜色 / 10+c 炸弹 / 20 彩虹 / 30+c,40+c 直线道具
      mode: mode === 'item' ? 'item' : 'simple', // #453 简单(默认,无道具)/道具
      taMode: null,            // #301 TA 出手风格 serious/normal/sandbag/blunder（FIX 2026-09-15 #481 与 st.mode 道具开关分家）
      genSpecial: null,        // 最近一次生成的道具（verify 断言用）
      turn: 1,
      over: false,
      started: false,
      lock: false,
      sel: null,
      hints: 3,                // FIX 2026-09-16：提示每局 3 次（linkup 同口径，原先无限提示可刷分）
      score: 0, myScore: 0, taScore: 0,
      misPicks: 0
    };
  }

  // ---- 战绩（每联系人独立） ----
  function statsKey() { return prefix() + ':match3-stats'; }
  function loadStats() {
    const d = { clears: 0, bestChem: 0, lastDiff: 'normal', lastMode: 'simple' };
    try {
      const raw = localStorage.getItem(statsKey());
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
    } catch (e) {}
    return d;
  }
  function saveStats(s) { try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch (e) {} }

  // ---- 三消规则（纯函数，__m3Debug 复用） ----
  // 找出全部 ≥3 同色直线（行/列，彩虹不参与），返回 run 列表
  function findRuns(grid) {
    const runs = [];
    for (let r = 0; r < N; r++) {
      let run = 1;
      for (let c = 1; c <= N; c++) {
        const same = c < N && colorOf(grid[r][c]) >= 0 && colorOf(grid[r][c]) === colorOf(grid[r][c - 1]);
        if (same) { run++; continue; }
        if (run >= 3 && colorOf(grid[r][c - 1]) >= 0) {
          const cells = [];
          for (let k = c - run; k < c; k++) cells.push([r, k]);
          runs.push({ cells: cells, color: colorOf(grid[r][c - 1]), len: run, dir: 'h' });
        }
        run = 1;
      }
    }
    for (let c = 0; c < N; c++) {
      let run = 1;
      for (let r = 1; r <= N; r++) {
        const same = r < N && colorOf(grid[r][c]) >= 0 && colorOf(grid[r][c]) === colorOf(grid[r - 1][c]);
        if (same) { run++; continue; }
        if (run >= 3 && colorOf(grid[r - 1][c]) >= 0) {
          const cells = [];
          for (let k = r - run; k < r; k++) cells.push([k, c]);
          runs.push({ cells: cells, color: colorOf(grid[r - 1][c]), len: run, dir: 'v' });
        }
        run = 1;
      }
    }
    return runs;
  }
  // 兼容旧调用：要消除的格子标记矩阵
  function findMatches(grid) {
    const runs = findRuns(grid);
    if (!runs.length) return null;
    const mark = [];
    for (let r = 0; r < N; r++) mark.push(new Array(N).fill(false));
    runs.forEach((run) => run.cells.forEach((p) => { mark[p[0]][p[1]] = true; }));
    return mark;
  }
  // 从种子格出发的完整消除（含炸弹 3×3 连锁引爆）；返回被清格子列表
  function clearWithSpecials(grid, seeds) {
    const cleared = [];
    const seen = [];
    for (let r = 0; r < N; r++) seen.push(new Array(N).fill(false));
    const queue = seeds.slice();
    seeds.forEach((p) => { seen[p[0]][p[1]] = true; });
    while (queue.length) {
      const p = queue.shift();
      if (!inBoard(p[0], p[1]) || seen[p[0]][p[1]] === 'done') continue;
      seen[p[0]][p[1]] = 'done';
      cleared.push([p[0], p[1]]);
      const v = grid[p[0]][p[1]];
      if (v >= LINE_V) {
        // ↕️ 纵向直线道具：清整列（链式队列让被扫到的其他道具继续引爆）#453
        for (let rr = 0; rr < N; rr++) { if (!seen[rr][p[1]]) { seen[rr][p[1]] = true; queue.push([rr, p[1]]); } }
      } else if (v >= LINE_H) {
        // ↔️ 横向直线道具：清整行 #453
        for (let cc = 0; cc < N; cc++) { if (!seen[p[0]][cc]) { seen[p[0]][cc] = true; queue.push([p[0], cc]); } }
      } else if (v >= BOMB_BASE && v < RAINBOW) {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = p[0] + dr, cc = p[1] + dc;
          if (inBoard(rr, cc) && !seen[rr][cc]) { seen[rr][cc] = true; queue.push([rr, cc]); }
        }
      }
    }
    return cleared;
  }
  // 重力补落：每列非空值下沉、顶部补随机新格（新格全是普通色）
  function collapse(grid) {
    let moved = false;
    for (let c = 0; c < N; c++) {
      let write = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        if (grid[r][c] >= 0) {
          if (write !== r) { grid[write][c] = grid[r][c]; grid[r][c] = -1; moved = true; }
          write--;
        }
      }
      for (let r = write; r >= 0; r--) { grid[r][c] = Math.floor(Math.random() * KIND_N); moved = true; }
    }
    return moved;
  }
  // 在副本上完整结算一段消除链（无特殊生成），返回消除总得分（TA 打分用）
  function simulateClear(gridIn) {
    const g = gridIn.map((row) => row.slice());
    let total = 0, chain = 0;
    for (;;) {
      const m = findMatches(g);
      if (!m) break;
      const seeds = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { if (m[r][c]) seeds.push([r, c]); }
      const cells = clearWithSpecials(g, seeds);
      cells.forEach((p) => { g[p[0]][p[1]] = -1; });
      total += cells.length * (chain + 1);
      collapse(g);
      chain++;
      if (chain > 20) break;
    }
    return total;
  }
  // 枚举全部相邻交换后能产生消除的步（TA 决策 / 死锁检测 / 提示共用）；彩虹不入枚举
  function allMoves(grid) {
    const out = [];
    const dirs = [[0, 1], [1, 0]];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (isRainbow(grid[r][c])) continue;
      for (let d = 0; d < dirs.length; d++) {
        const r2 = r + dirs[d][0], c2 = c + dirs[d][1];
        if (r2 >= N || c2 >= N) continue;
        if (isRainbow(grid[r2][c2])) continue;
        const g = grid.map((row) => row.slice());
        const t = g[r][c]; g[r][c] = g[r2][c2]; g[r2][c2] = t;
        const gain = simulateClear(g);
        if (gain > 0) out.push({ a: [r, c], b: [r2, c2], gain: gain });
      }
    }
    return out;
  }

  // ---- 发牌 / 死锁洗牌 ----
  function dealGrid() {
    let grid;
    do {
      grid = [];
      for (let r = 0; r < N; r++) {
        const row = [];
        for (let c = 0; c < N; c++) row.push(Math.floor(Math.random() * KIND_N));
        grid.push(row);
      }
    } while (findMatches(grid) || allMoves(grid).length === 0);
    return grid;
  }
  // 死锁洗牌动画：值连同棋子一起换位——棋子滑到新格（滑行中轻微缩一下），不再整盘瞬跳重绘
  function reshuffle() {
    if (!st || st.over) return false;
    st.lock = true;   // FIX 2026-09-16：洗牌滑行期间原先可点选，选中高亮会挂在移动中的棋子上（linkup 同款先锁）
    let flat = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) flat.push({ v: st.grid[r][c], id: pidGrid[r][c] });
    for (let tries = 0; tries < 80; tries++) {
      shuffle(flat);
      const g = [], ids = [];
      for (let r = 0; r < N; r++) {
        g.push(flat.slice(r * N, (r + 1) * N).map((x) => x.v));
        ids.push(flat.slice(r * N, (r + 1) * N).map((x) => x.id));
      }
      if (!findMatches(g) && allMoves(g).length > 0) {
        st.grid = g;
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
          const id = ids[r][c];
          pidGrid[r][c] = id;
          const p = pieces.get(id);
          if (p) {
            p.el.style.transitionDuration = '0.32s';
            p.el.style.transitionTimingFunction = 'cubic-bezier(.45,.05,.35,1.2)';
            layoutTile(p.el, r, c);
            const gl = p.el._g;
            if (gl) { gl.classList.remove('m3-shuf'); void gl.offsetWidth; gl.classList.add('m3-shuf'); }
          }
        }
        setTimeout(() => {
          pieces.forEach((p) => { p.el.style.transitionDuration = ''; p.el.style.transitionTimingFunction = ''; });
          st.lock = false;
        }, animMs(360));
        updateInfo();
        return true;
      }
    }
    renderBoard();
    st.lock = false;
    return false;
  }

  // ---- 渲染（棋子层：每颗棋子一个绝对定位元素，交换/下落走 left/top 过渡动画） ----
  let pidGrid = [];              // pidGrid[r][c] = 棋子 id / -1（空位）
  const pieces = new Map();      // id -> { v, el }
  let nextPid = 1;
  let cellPx = 40;
  function setGlyph(el, v) {
    el.classList.remove('m3-bomb', 'm3-line');
    const g = el._g || el;
    if (v >= LINE_V) { g.textContent = '↕️'; el.classList.add('m3-line'); }
    else if (v >= LINE_H) { g.textContent = '↔️'; el.classList.add('m3-line'); }
    else if (v >= RAINBOW) g.textContent = '🌈';
    else if (v >= BOMB_BASE) { g.textContent = '💥'; el.classList.add('m3-bomb'); }
    else g.textContent = KINDS[v];
  }
  // 下落时长按距离计：掉得远耗时长（封顶 0.42s），避免远距离瞬移感
  function fallSec(dist) { return Math.min(0.42, 0.16 + dist * 0.05); }
  // 定位走 transform（合成器动画，低端机不进 layout），缩放/抖动类动画在内层 .m3-glyph 上不冲突
  function layoutTile(el, r, c) {
    el.style.width = cellPx + 'px';
    el.style.height = cellPx + 'px';
    el.style.fontSize = Math.round(cellPx * 0.54) + 'px';
    el.style.transform = 'translate(' + (c * (cellPx + GAP)) + 'px,' + (r * (cellPx + GAP)) + 'px)';
    el._r = r; el._c = c;
  }
  function spawnTile(v, r, c, fromRow, born, fallDist) {
    const el = document.createElement('div');
    el.className = 'm3-tile' + (born ? ' m3-born' : '');
    const id = nextPid++;
    const g = document.createElement('span');
    g.className = 'm3-glyph';
    el.appendChild(g);
    el._g = g;
    setGlyph(el, v);
    el.style.width = cellPx + 'px';
    el.style.height = cellPx + 'px';
    el.style.fontSize = Math.round(cellPx * 0.54) + 'px';
    el.style.transform = 'translate(' + (c * (cellPx + GAP)) + 'px,' + ((fromRow != null ? fromRow : r) * (cellPx + GAP)) + 'px)';
    if (fallDist) { el.style.transitionDuration = fallSec(fallDist) + 's'; el.style.transitionTimingFunction = 'cubic-bezier(.55,0,.75,.45)'; }
    el._r = r; el._c = c;
    boardEl.appendChild(el);
    pieces.set(id, { v: v, el: el });
    pidGrid[r][c] = id;
    if (fromRow != null) requestAnimationFrame(() => { layoutTile(el, r, c); });
    return id;
  }
  function buildBoard() {
    boardEl.innerHTML = '';
    pieces.clear();
    pidGrid = [];
    for (let r = 0; r < N; r++) pidGrid.push(new Array(N).fill(-1));
    nextPid = 1;
    boardEl.classList.add('m3-noanim');
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) spawnTile(st.grid[r][c], r, c, null, false);
    void boardEl.offsetWidth;
    boardEl.classList.remove('m3-noanim');
  }
  function fitBoard() {
    if (!stageEl || panel.hidden || !st) return;
    const w = stageEl.clientWidth;
    if (!w) return;
    // #306：同连连看——格宽固定 px + grid 3px gap，cellPx 不先扣 gap 会溢出右缘截断
    cellPx = Math.max(26, Math.min(46, Math.floor((w - (N - 1) * GAP) / N)));
    boardEl.style.width = (cellPx * N + (N - 1) * GAP) + 'px';
    boardEl.style.height = (cellPx * N + (N - 1) * GAP) + 'px';
    boardEl.classList.add('m3-noanim');
    pieces.forEach((p) => { layoutTile(p.el, p.el._r, p.el._c); });
    void boardEl.offsetWidth;
    boardEl.classList.remove('m3-noanim');
  }
  function tileAt(r, c) {
    const id = pidGrid[r] ? pidGrid[r][c] : -1;
    const p = id >= 0 ? pieces.get(id) : null;
    return p ? p.el : null;
  }
  function renderBoard() { buildBoard(); updateInfo(); }
  // 交换动画：pid 随模型换位，两颗棋子滑到对方位置（清掉下落时长，回到基础过渡速度）
  function swapPid(a, b) {
    const ia = pidGrid[a[0]][a[1]], ib = pidGrid[b[0]][b[1]];
    pidGrid[a[0]][a[1]] = ib; pidGrid[b[0]][b[1]] = ia;
    const pa = pieces.get(ia), pb = pieces.get(ib);
    if (pa) { pa.el.style.transitionDuration = ''; pa.el.style.transitionTimingFunction = 'cubic-bezier(.3,1.35,.55,1)'; layoutTile(pa.el, b[0], b[1]); }
    if (pb) { pb.el.style.transitionDuration = ''; pb.el.style.transitionTimingFunction = 'cubic-bezier(.3,1.35,.55,1)'; layoutTile(pb.el, a[0], a[1]); }
  }
  // 消除动画：棋子缩放爆开后移除（模型已在调用前置 -1）
  function popClear(cells) {
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i][0], c = cells[i][1];
      const id = pidGrid[r][c];
      if (id == null || id < 0) continue;
      pidGrid[r][c] = -1;
      const p = pieces.get(id);
      if (!p) continue;
      pieces.delete(id);
      p.el.classList.remove('m3-sel', 'm3-hint');
      p.el.classList.add('m3-pop');
      setTimeout(((el) => () => { if (el.parentNode) el.parentNode.removeChild(el); })(p.el), animMs(POP_MS) + 60);
    }
  }
  // 消除飘分：在消除质心冒出 +N 上浮淡出
  function floatScore(cells, pts) {
    if (!cells || !cells.length || !pts) return;
    let sr = 0, sc = 0;
    cells.forEach((p) => { sr += p[0]; sc += p[1]; });
    const el = document.createElement('div');
    el.className = 'm3-float';
    el.textContent = '+' + pts;
    el.style.left = ((sc / cells.length + 0.5) * (cellPx + GAP)) + 'px';
    el.style.top = ((sr / cells.length + 0.5) * (cellPx + GAP)) + 'px';
    el.style.fontSize = Math.max(14, Math.round(cellPx * 0.42)) + 'px';
    boardEl.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, animMs(780));
  }
  // 炸弹引爆：棋盘短促震动
  function quakeBoard() {
    boardEl.classList.remove('m3-quake'); void boardEl.offsetWidth; boardEl.classList.add('m3-quake');
    setTimeout(() => { boardEl.classList.remove('m3-quake'); }, animMs(380));
  }
  // 重力下落动画：现有棋子按距离滑到新位，顶部空位生成新棋子从棋盘上方落进；返回本段最大下落距离
  function collapseAnimated() {
    let maxDist = 1;
    for (let c = 0; c < N; c++) {
      let write = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        const id = pidGrid[r][c];
        if (id >= 0) {
          if (write !== r) {
            const p = pieces.get(id);
            pidGrid[write][c] = id; pidGrid[r][c] = -1;
            st.grid[write][c] = st.grid[r][c]; st.grid[r][c] = -1;
            if (p) {
              const dist = write - r;
              if (dist > maxDist) maxDist = dist;
              p.el.style.transitionDuration = fallSec(dist) + 's';
              p.el.style.transitionTimingFunction = 'cubic-bezier(.55,0,.75,.45)';
              layoutTile(p.el, write, c);
            }
          }
          write--;
        }
      }
      const gapN = write + 1;
      if (gapN > maxDist) maxDist = gapN;
      for (let r = write; r >= 0; r--) {
        const v = Math.floor(Math.random() * KIND_N);
        st.grid[r][c] = v;
        spawnTile(v, r, c, r - gapN, true, gapN);
      }
    }
    return maxDist;
  }
  function updateInfo() {
    if (infoEl) infoEl.innerHTML =
      '<span>🎯 ' + st.score + ' / ' + st.target + '</span>' +
      '<span>你 ' + st.myScore + '</span>' +
      '<span>' + T('TA') + ' ' + st.taScore + '</span>' +
      '<span>💕 ' + chemNow() + '</span>';
  }
  function chemNow() {
    const total = st.myScore + st.taScore;
    if (!total) return 60;
    const share = Math.min(st.myScore, st.taScore) / Math.max(1, Math.max(st.myScore, st.taScore));
    return Math.max(0, Math.min(100, Math.round(55 + share * 35 - st.misPicks * 2)));
  }
  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  // #301 中局 TA 泡泡
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
    setStatus(st.turn === 1 ? dot(1) + '你的回合：点一格再点相邻一格交换' : T(THINK_LINES[0]));
  }

  // ---- 对局流程 ----
  let dealT = null;   // FIX 2026-09-16：开局发牌解锁定时器收进句柄（原不跟踪，极端连点/换局重开时旧定时器会把新一局提前解锁）
  function newGame() {
    clearTimeout(thinkT); thinkT = null;
    if (dealT) { clearTimeout(dealT); dealT = null; }
    const diff = diffSel && DIFFS[diffSel.value] ? diffSel.value : 'normal';
    const mode = modeSel && modeSel.value === 'item' ? 'item' : 'simple';
    st = newState(diff, mode);
    try { const s2 = loadStats(); s2.lastMode = mode; saveStats(s2); } catch (e) {}
    st.grid = dealGrid();
    st.started = true;
    hideOverlay();
    buildBoard();
    fitBoard();
    updateInfo();
    // 开局发牌动画：对角波次出生，防整盘瞬现（期间锁输入）
    st.lock = true;
    boardEl.querySelectorAll('.m3-tile').forEach((el) => {
      const gl = el._g;
      if (gl) { gl.style.animationDelay = ((el._r + el._c) * 35) + 'ms'; gl.classList.add('m3-deal'); }
    });
    dealT = setTimeout(() => {
      dealT = null;
      boardEl.querySelectorAll('.m3-tile').forEach((el) => {
        const gl = el._g;
        if (gl) { gl.classList.remove('m3-deal'); gl.style.animationDelay = ''; }
      });
      st.lock = false;
    }, animMs(35 * (2 * N - 2) + 260));
    st.turn = 1;
    setStatus(dot(1) + '你的回合：点一格或滑动相邻格交换');
  }
  // 交换后完整结算：彩虹交换走特殊分支；普通路径四连生成炸弹、五连生成彩虹（仅首段）
  // 动画时序：滑动交换 → 每段「消除爆开 → 下落补位」→ 连锁，全部走完才解锁
  function doSwap(a, b, byMe, cb) {
    // FIX 2026-09-16：整条 setTimeout 链原先引用模块级 st（无快照无守卫）——链中 newGame/换局时
    // 旧链会把消除结果写进新盘。改快照 + 每个异步回调入口校验 st 未换（linkup 的 const s = st 范式）。
    const s = st;
    s.lock = true;
    const va = s.grid[a[0]][a[1]], vb = s.grid[b[0]][b[1]];
    const rbA = isRainbow(va), rbB = isRainbow(vb);
    if (rbA || rbB) { doRainbowSwap(a, b, rbA && rbB, byMe, cb); return; }
    const t = s.grid[a[0]][a[1]];
    s.grid[a[0]][a[1]] = s.grid[b[0]][b[1]];
    s.grid[b[0]][b[1]] = t;
    swapPid(a, b);
    let chain = 0, gained = 0;
    const step = () => {
      if (st !== s) return;   // 链中已换局：丢弃旧链
      const runs = findRuns(s.grid);
      if (!runs.length) {
        if (!chain) {
          // 无效交换：滑回去 + 两格抖一下
          const t2 = s.grid[a[0]][a[1]];
          s.grid[a[0]][a[1]] = s.grid[b[0]][b[1]];
          s.grid[b[0]][b[1]] = t2;
          swapPid(a, b);
          [a, b].forEach((p) => {
            const el = tileAt(p[0], p[1]);
            if (el) { el.classList.add('m3-shake'); setTimeout(((e2) => () => e2.classList.remove('m3-shake'))(el), 320); }
          });
          s.lock = false;
          sfxBad();
          if (cb) cb(false, 0);
          return;
        }
        finish();
        return;
      }
      chain++;
      const seeds = [];
      runs.forEach((run) => run.cells.forEach((p) => seeds.push(p)));
      const cells = clearWithSpecials(s.grid, seeds);
      const hadBoom = cells.some((p) => { const v = s.grid[p[0]][p[1]]; return v >= BOMB_BASE; });
      cells.forEach((p) => { s.grid[p[0]][p[1]] = -1; });
      // #301/#453 特殊生成：仅「道具模式」（s.mode==='item'）且交换引发的首段消除——
      // 优先级 五连+→🌈彩虹 > L/T 同色交叉（合计≥5格）→💥炸弹 > 四连直线→↔️/↕️直线道具；
      // 简单模式（默认）不生成任何道具＝纯经典三消
      let kept = null;
      if (chain === 1 && s.mode === 'item') {
        const best = runs.slice().sort((x, y) => y.len - x.len)[0];
        const atFor = (run) => run.cells.some((p) => p[0] === b[0] && p[1] === b[1]) ? b : run.cells[Math.floor(run.cells.length / 2)];
        // L/T 检测：同色两道直线共享一格、合计 ≥5 格（一个交换同时凑出横竖两道）
        let crossPair = null;
        for (let i = 0; i < runs.length && !crossPair; i++) {
          for (let j = i + 1; j < runs.length; j++) {
            if (runs[i].color !== runs[j].color) continue;
            const at = runs[i].cells.filter((p) => runs[j].cells.some((q) => q[0] === p[0] && q[1] === p[1]))[0];
            if (at && runs[i].len + runs[j].len - 1 >= 5) { crossPair = { at: at, r1: runs[i], r2: runs[j] }; break; }
          }
        }
        if (best.len >= 5) {
          const at2 = atFor(best);
          s.grid[at2[0]][at2[1]] = RAINBOW;
          cells.push([at2[0], at2[1]]);
          kept = at2;
          s.genSpecial = 'rainbow';
          taSay(pick(['🌈 彩虹出现了！', '快用彩虹，超好用']));
        } else if (crossPair) {
          const inCross = crossPair.r1.cells.some((p) => p[0] === b[0] && p[1] === b[1]) || crossPair.r2.cells.some((p) => p[0] === b[0] && p[1] === b[1]);
          const at2 = inCross ? b : crossPair.at;
          s.grid[at2[0]][at2[1]] = BOMB_BASE + crossPair.r1.color;
          cells.push([at2[0], at2[1]]);
          kept = at2;
          s.genSpecial = 'bomb';
          taSay(pick(['💥 L/T 连消，炸弹生成！', '交叉消！收下这个💥']));
        } else if (best.len === 4) {
          // 横四连→↔️（清整行）、竖四连→↕️（清整列），与经典消消乐直线道具同款 #453
          const at2 = atFor(best);
          s.grid[at2[0]][at2[1]] = best.dir === 'h' ? LINE_H + best.color : LINE_V + best.color;
          cells.push([at2[0], at2[1]]);
          kept = at2;
          s.genSpecial = best.dir === 'h' ? 'line-h' : 'line-v';
          taSay(best.dir === 'h' ? pick(['↔️ 横向直线道具！', '四连！整行都清掉！']) : pick(['↕️ 纵向直线道具！', '四连！一列全消！']));
        }
      }
      const pts = cells.length * chain;
      gained += pts;
      s.score += pts;
      if (byMe) s.myScore += pts; else s.taScore += pts;
      popClear(kept ? cells.filter((p) => p[0] !== kept[0] || p[1] !== kept[1]) : cells);
      floatScore(cells, pts);
      if (kept) {
        // 生成特殊棋子：原格变身 + 出生弹跳
        const el = tileAt(kept[0], kept[1]);
        if (el) {
          setGlyph(el, s.grid[kept[0]][kept[1]]);
          el.classList.remove('m3-born'); void el.offsetWidth; el.classList.add('m3-born');
        }
      }
      if (hadBoom) { sfxBoom(); quakeBoard(); }
      sfxClear(chain);
      if (chain >= 3) taSay('连锁 ×' + chain + (byMe ? '，好强！' : '，我也行吧'));
      setTimeout(() => {
        if (st !== s) return;   // 链中已换局：丢弃旧链
        const maxDist = collapseAnimated();   // 下落补位后再等下一轮查连锁
        setTimeout(step, Math.max(animMs(FALL_MS), animMs(fallSec(maxDist) * 1000 + 80)));
      }, animMs(POP_MS));
    };
    const finish = () => {
      updateInfo();
      s.lock = false;
      if (cb) cb(true, gained);
    };
    setTimeout(step, animMs(SWAP_MS));
  }
  // 彩虹交换：单彩虹+色=清全该色；双彩虹=随机清两色。走完照常 collapse+连锁
  function doRainbowSwap(a, b, both, byMe, cb) {
    const s = st;   // FIX 2026-09-16：同 doSwap——异步段快照守卫
    const rbPos = s.grid[a[0]][a[1]] >= RAINBOW ? a : b;
    const other = s.grid[a[0]][a[1]] >= RAINBOW ? b : a;
    const seeds = [[rbPos[0], rbPos[1]]];
    const colors = [];
    if (both) {
      const pool = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5).slice(0, 2);
      pool.forEach((c2) => colors.push(c2));
      seeds.push([other[0], other[1]]);
    } else {
      colors.push(colorOf(s.grid[other[0]][other[1]]));
    }
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (colors.indexOf(colorOf(s.grid[r][c])) >= 0 && colorOf(s.grid[r][c]) >= 0 && !seeds.some((p) => p[0] === r && p[1] === c)) seeds.push([r, c]);
    }
    sfxBoom();
    taSay(both ? '双彩虹！看我的' : '🌈 全消 ' + KINDS[Math.max(0, colors[0])] + '！');
    const cells = clearWithSpecials(s.grid, seeds);
    cells.forEach((p) => { s.grid[p[0]][p[1]] = -1; });
    const pts = cells.length;
    s.score += pts;
    if (byMe) s.myScore += pts; else s.taScore += pts;
    popClear(cells);
    floatScore(cells, pts);
    setTimeout(() => {
      if (st !== s) return;
      const maxDist = collapseAnimated();
      setTimeout(() => {
        if (st !== s) return;
        s.lock = false;
        if (cb) cb(true, pts);
      }, Math.max(animMs(FALL_MS), animMs(fallSec(maxDist) * 1000 + 80)));
    }, animMs(POP_MS));
  }
  function afterMove(byMe) {
    if (st.score >= st.target) { endGame(); return; }
    if (allMoves(st.grid).length === 0) {
      reshuffle();
      setStatus('🌀 没有能消的了，自动洗了个牌');
    }
    st.turn = byMe ? 2 : 1;
    if (st.turn === 2) scheduleTaTurn(TURN_MIN + Math.random() * TURN_VAR);
    else showTurnStatus();
  }
  function playerSwap(a, b) {
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    sfxSwap();
    doSwap(a, b, true, (ok) => {
      if (!ok) { st.misPicks++; updateInfo(); }
      afterMove(true);
    });
  }

  // ---- TA 回合 ----
  function rollMode() {
    const r = Math.random();
    if (r < 0.55) return 'serious';
    if (r < 0.8) return 'normal';
    if (r < 0.93) return 'sandbag';
    return 'blunder';
  }
  function scheduleTaTurn(delay) {
    clearTimeout(thinkT);
    setStatus(T(THINK_LINES[Math.floor(Math.random() * THINK_LINES.length)]));
    thinkT = setTimeout(taTurn, Math.round(delay * fastMul()));
  }
  function taTurn() {
    if (!st || st.over || st.turn !== 2 || st.lock) return;
    // FIX 2026-09-15 #481：出手风格存独立字段 st.taMode，禁止写 st.mode——
    // st.mode 是 #453 的道具开关('item'/'simple')，曾在此被覆写成 serious/normal/sandbag/blunder，
    // TA 第一步后道具门控 st.mode==='item' 永假＝道具模式「消除后不变出道具」
    st.taMode = rollMode();
    const moves = allMoves(st.grid);
    if (!moves.length) { endGame(); return; }
    if (st.taMode === 'serious') {
      moves.sort((x, y) => y.gain - x.gain);
      exec(pick(moves.slice(0, 2)));
    } else if (st.taMode === 'normal') {
      moves.sort((x, y) => y.gain - x.gain);
      exec(pick(moves.slice(0, 5)));
    } else if (st.taMode === 'sandbag') {
      moves.sort((x, y) => x.gain - y.gain);
      exec(pick(moves.slice(0, Math.max(2, Math.ceil(moves.length / 2)))));
    } else {
      // blunder：先点一次无效交换（抖一下），再随便走一步
      const a = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)];
      const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
      const d = pick(dirs);
      const b = [a[0] + d[0], a[1] + d[1]];
      if (b[0] >= 0 && b[0] < N && b[1] >= 0 && b[1] < N) {
        const g2 = st.grid.map((row) => row.slice());
        const t = g2[a[0]][a[1]]; g2[a[0]][a[1]] = g2[b[0]][b[1]]; g2[b[0]][b[1]] = t;
        if (!findMatches(g2)) {
          sfxBad();
          setStatus(T('TA') + '点错了，重新选……');
          taSay(pick(['哎呀手滑', '这格不对……']));
          const ea = tileAt(a[0], a[1]);
          if (ea) { ea.classList.add('m3-shake'); setTimeout(() => ea.classList.remove('m3-shake'), 300); }
          setTimeout(() => {
            if (!st || st.over) return;
            exec(pick(moves));
          }, Math.round(600 * fastMul()));
          return;
        }
      }
      exec(pick(moves));
    }
    function exec(mv) {
      if (!mv) { st.turn = 1; showTurnStatus(); return; }
      sfxSwap();
      doSwap(mv.a, mv.b, false, () => {
        if (st.score >= st.target) { endGame(); return; }
        if (allMoves(st.grid).length === 0) reshuffle();
        st.turn = 1;
        showTurnStatus();
      });
    }
  }

  // ---- 结束：默契 / 奖励 / 聊天联动 ----
  function endGame() {
    st.over = true; st.turn = 0; st.lock = false;
    clearTimeout(thinkT); thinkT = null;
    const chem = chemNow();
    const s = loadStats();
    s.clears = (s.clears || 0) + 1;
    s.bestChem = Math.max(s.bestChem || 0, chem);
    s.lastDiff = st.diff;
    saveStats(s);
    sfxWin();
    taSay(pick(['达标啦，配合不错！', '我们通关咯']));
    // 心意币：按难度发放，日封顶 ¥104，双方同步同额；#301 幸运日 ×2
    var coinLine = '';
    var dropLine = '';
    try {
      var COIN_CAP = 10400;
      // FIX 2026-09-16：封顶键 UTC 日期改本地日期（UTC 口径下北京时间 0-8 点记到前一天）
      var dm = new Date();
      var day = dm.getFullYear() + '-' + (dm.getMonth() + 1) + '-' + dm.getDate();
      var ck = prefix() + ':ml2_coin_match3_' + day;
      var cur = Number(localStorage.getItem(ck)) || 0;
      if (cur < COIN_CAP) {
        var mult = (typeof window.arcadeMult === 'function') ? window.arcadeMult('match3') : 1;
        var real = Math.min(Math.round(DIFFS[st.diff].coin * mult), COIN_CAP - cur);
        try { localStorage.setItem(ck, String(cur + real)); } catch (e2) {}
        if (real > 0 && typeof window.giftWalletChange === 'function') {
          if (window.giftWalletChange(real, real, '消消乐')) {
            if (typeof window.arcadeMarkLuckyPlayed === 'function') window.arcadeMarkLuckyPlayed('match3');
            coinLine = '🪙 双方心意币各 +¥' + (real / 100).toFixed(2) + (mult > 1 ? '（🍀 幸运 ×2）' : '');
          }
        }
      }
    } catch (e) {}
    // #301 跨游戏掉落：通关 8% 概率掉限定摆件
    if (typeof window.arcadeTryDrop === 'function') {
      try {
        var dr = window.arcadeTryDrop('match3');
        if (dr) { dropLine = '<div class="pong-end-stat">🌠 掉落限定摆件「' + dr.ico + ' ' + dr.name + '」！游乐室图鉴 +1</div>'; taSay('哇，掉了「' + dr.name + '」！'); }
      } catch (e) {}
    }
    const body =
      '<div class="pong-end-stat">🎯 达成 ' + st.score + ' / ' + st.target + ' 分</div>' +
      '<div class="pong-end-stat">💕 默契 ' + chem + ' · 你 ' + st.myScore + ' · ' + T('TA') + ' ' + st.taScore + '</div>' +
      '<div class="pong-end-stat">累计通关 ' + s.clears + ' 局 · 历史最佳默契 ' + s.bestChem + '</div>' +
      (coinLine ? '<div class="pong-end-stat">' + coinLine + '</div>' : '') +
      dropLine;
    showOverlay('目标达成！', body, '再来一局');
    if (startBtn) startBtn.textContent = '再来一局';
    if (endBtn) endBtn.hidden = false;
    setStatus('🎉 达成目标！默契 ' + chem);
    // 写聊天系统消息 + TA 随机回应
    try {
      if (window.chatAddSystem) window.chatAddSystem(T('消消乐') + ' · 达成 ' + st.score + ' 分 · 默契 ' + chem, { special: 'match3' });
      const fb = ['通关啦，配合不错。', '我们好默契呀。', '再来一局？'];
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
    const itemMode = !!(modeSel && modeSel.value === 'item');
    showOverlay('消消乐',
      '<div class="c4-start-tip">和 ' + T('TA') + ' 轮流交换相邻两格<br>凑成同款三连就消除，一起冲到目标分</div>' +
      '<div class="c4-start-note">' + (itemMode
        ? '💣 道具模式：↔️↕️ 四连直线→清整行/整列 · L/T 交叉→💥炸弹 · 五连→🌈彩虹'
        : '🌿 简单模式：经典三消、无道具（想出道具就在上方切「💣 道具」）') +
      '<br>🎲 ' + T('TA') + '每回合状态随机——最优步 / 前五挑一 / 放水 / 手滑</div>' +
      (s.clears > 0 ? '<div class="pong-end-stat">累计通关 ' + s.clears + ' 局 · 历史最佳默契 ' + s.bestChem + '</div>' : ''),
      s.clears > 0 ? '再来一局' : '开始对局');
    if (endBtn) endBtn.hidden = true;
  }
  function hideOverlay() { if (overlayEl) overlayEl.hidden = true; if (endBtn) endBtn.hidden = true; }

  // ---- 输入 ----
  // FIX 2026-09-16：补滑动交换——手机三消惯例是滑（原只能点一格再点相邻一格）。
  // 按下滑动位移超过半格即按方向与相邻格交换；随后的合成 click 由 swipeFired 吞掉。
  let swipeBase = null, swipeFired = false;
  boardEl.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.m3-tile');
    if (!cell || typeof cell._r !== 'number') { swipeBase = null; return; }
    swipeBase = { x: e.clientX, y: e.clientY, r: cell._r, c: cell._c };
    swipeFired = false;
  });
  boardEl.addEventListener('pointerup', (e) => {
    if (!swipeBase) return;
    const from = [swipeBase.r, swipeBase.c];
    const dx = e.clientX - swipeBase.x, dy = e.clientY - swipeBase.y;
    swipeBase = null;
    const th = Math.max(12, cellPx / 2);
    if (Math.abs(dx) < th && Math.abs(dy) < th) return;
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? [0, dx > 0 ? 1 : -1] : [dy > 0 ? 1 : -1, 0];
    const r2 = from[0] + dir[0], c2 = from[1] + dir[1];
    if (!inBoard(r2, c2)) return;
    swipeFired = true;
    playerSwap(from, [r2, c2]);
  });
  boardEl.addEventListener('pointercancel', () => { swipeBase = null; });
  boardEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (swipeFired) { swipeFired = false; return; }   // 滑动交换后吞掉合成 click
    const cell = e.target.closest('.m3-tile');
    if (!cell) return;
    const r = typeof cell._r === 'number' ? cell._r : 0;
    const c = typeof cell._c === 'number' ? cell._c : 0;
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    if (st.sel && st.sel[0] === r && st.sel[1] === c) {
      st.sel = null;
      cell.classList.remove('m3-sel');
      sfxPick();
      return;
    }
    if (!st.sel) {
      st.sel = [r, c];
      cell.classList.add('m3-sel');
      sfxPick();
      return;
    }
    const a = st.sel;
    const dr = Math.abs(a[0] - r), dc = Math.abs(a[1] - c);
    const adj = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
    st.sel = null;
    boardEl.querySelectorAll('.m3-sel').forEach((x) => x.classList.remove('m3-sel'));
    if (!adj) {
      st.sel = [r, c];
      cell.classList.add('m3-sel');
      sfxPick();
      return;
    }
    playerSwap(a, [r, c]);
  });
  if (startBtn) startBtn.addEventListener('click', (e) => { e.stopPropagation(); newGame(); });
  if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (diffSel) diffSel.addEventListener('change', () => {
    const s = loadStats(); s.lastDiff = diffSel.value; saveStats(s);
  });
  if (modeSel) modeSel.addEventListener('change', () => {
    const s = loadStats(); s.lastMode = modeSel.value === 'item' ? 'item' : 'simple'; saveStats(s);
  });
  if (hintBtn) hintBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    // FIX 2026-09-16：提示原先无限次（linkup 是 ×3）——补每局 3 次上限
    if (!(st.hints > 0)) { taSay('提示次数用完啦'); sfxBad(); return; }
    st.hints--;
    const moves = allMoves(st.grid);
    if (!moves.length) return;
    moves.sort((x, y) => y.gain - x.gain);
    const mv = moves[0];
    [mv.a, mv.b].forEach((p) => {
      const el = tileAt(p[0], p[1]);
      if (el) { el.classList.remove('m3-hint'); void el.offsetWidth; el.classList.add('m3-hint'); }
    });
    sfxPick();
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
  }
  window.openMatch3Panel = function () {
    try { if (isFs) toggleFs(); } catch (e) {}
    if (!st || !st.started) {
      try {
        const s = loadStats();
        if (DIFFS[s.lastDiff] && diffSel) diffSel.value = s.lastDiff;
        if (modeSel && (s.lastMode === 'item' || s.lastMode === 'simple')) modeSel.value = s.lastMode;
      } catch (e) {}
    }
    panel.hidden = false;
    try { setNames(); } catch (e) {}
    try { if (st && st.started) fitBoard(); } catch (e) {}
    // 有进行中的对局 → 接着玩（关面板期间轮到 TA 的补调度）
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
    // FIX 2026-09-16：关面板时发牌定时器未清——清掉并解除其锁，否则重开面板开局仍锁死
    if (dealT) { clearTimeout(dealT); dealT = null; if (st && st.lock) st.lock = false; }
    if (panel) panel.hidden = true;
  }
  window.closeMatch3Panel = closePanel;
  // FIX 2026-09-16：原只关面板不清 st——换联系人后重开走「接着玩」，旧桌面棋局/战绩串档
  document.addEventListener('contact-switched', () => { try { closePanel(); st = null; /* #548u */ } catch (e) {} });
  window.addEventListener('resize', () => { if (!panel.hidden) fitBoard(); });

  // ---- 入口：聊天更多功能 → 小游戏 → 消消乐（自绑定，chat.js 不改） ----
  (function bindEntry() {
    const btn = document.getElementById('more-match3');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      hideSiblingPanels('chat-match3-panel');
      try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
      try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
      try { openMatch3Panel(); } catch (err) {
        try { panel.hidden = false; showStartOverlay(); setStatus('点击「开始对局」'); } catch (e2) {}
        try { console.error('[match3] open failed', err); } catch (e2) {}
      }
    });
    try {
      if (window.MutationObserver) {
        const SIBLING_IDS = siblingIds('chat-match3-panel');
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

  // 只读调试口（供 verify 脚本复用）
  window.__m3Debug = {
    st: () => st,
    newGame: newGame,
    doSwap: doSwap,
    findRuns: findRuns,
    findMatches: findMatches,
    allMoves: allMoves,
    taTurn: taTurn,
    simulateClear: simulateClear,
    clearWithSpecials: clearWithSpecials,
    reshuffle: reshuffle,
    colorOf: colorOf,
    isRainbow: isRainbow,
    BOMB_BASE: BOMB_BASE,
    RAINBOW: RAINBOW,
    LINE_H: LINE_H,
    LINE_V: LINE_V,
    fast: false
  };
})();

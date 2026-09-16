// ===== 功能：合作扫雷（聊天页更多功能 → 小游戏） =====
// 和传统扫雷的区别（对齐需求）：不是「谁踩雷谁输」，而是你和 TA 共同把一张地图探索完。
// - 轮流挖掘：你点一格 → TA 观察一会儿再挖一格；数字 = 周围雷数，0 连锁自动展开（经典规则保留）。
// - 共用 3 颗❤：谁踩雷都只扣一颗，扣完才算失败——不搞「一踩就结束」。
// - 操作：点击=挖开；长按(约0.45s)/右键=插旗；头部 ⛏️/🚩 按钮可切换「插旗模式」（点按即插旗）；
//   带旗的格子不能直接挖，先取消记号。
// - TA 行为（无真 AI）：每回合抽状态——smart 70% 按已知信息推理 / memory 20% 在已探索边缘挑
//   记得的安全区 / wild 10% 随缘乱选。推理规则把「旗」当作未知数而不是事实：
//     · 某数字周围剩余未知数 = 需要的雷数 → 这些格全是雷 → TA 会插旗提醒（🚩 TA认为这里有雷）；
//     · 某数字周围已凑满雷数 → 其余未知格安全 → TA 直接挖；
//   没把握且感觉危险时也可能猜一面旗（可能错）——你之后挖开验证：「TA 判断错了 / TA 猜对了」。
// - 宝物：🪙心意币(+¥1) / 🎁神秘礼物 / 🌸花朵。TA 挖到礼物会送给你（聊天字卡「这个给你。」），
//   全部收进本游戏的小收藏（头部 🎒 查看）。
// - 心意币：完成 +¥5（轻松模式 +¥2）/ 全程没踩雷额外 +¥3 / 金币格每个 +¥1；
//   日封顶 ¥10（计数键 ml2_coin_ms_日期），走 giftWalletChange 统一入口。
// - 结束写聊天系统消息 + TA 回应；战绩按联系人桌面存 localStorage。
// - 地图懒生成：第一格挖下时才布雷，保证首挖及其周围必安全（开局必有一片连锁展开）。
// - 入口绑定在本文件内完成（不改 chat.js），半框容器复用 .poke-card 与 .pong-overlay 组件。
(function () {
  const panel = document.getElementById('chat-ms-panel');
  if (!panel) return;
  const boardEl = document.getElementById('ms-board');
  const stageEl = document.getElementById('ms-stage');
  const statusEl = document.getElementById('ms-status');
  const livesEl = document.getElementById('ms-lives');
  const progEl = document.getElementById('ms-prog');
  const overlayEl = document.getElementById('ms-overlay');
  const ovTitleEl = document.getElementById('ms-ov-title');
  const ovBodyEl = document.getElementById('ms-ov-body');
  const startBtn = document.getElementById('ms-btn-start');
  const endBtn = document.getElementById('ms-btn-end');
  const soundBtn = document.getElementById('ms-sound');
  const modeBtn = document.getElementById('ms-mode');
  const bagBtn = document.getElementById('ms-bag');
  const closeBtn = document.getElementById('ms-close');
  const fsBtn = document.getElementById('ms-fs');

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
  const partnerNameEl = document.getElementById('ms-partner-name');

  const MAX_LIVES = 3;
  const MS_COIN_CAP = 1000;                       // 心意币日封顶（分）
  const FLAWLESS_BONUS = 300;                     // 有雷模式全程未踩雷的额外奖励
  const DIFFS = {
    chill:  { n: 6, mines: 0,  label: '🌱 轻松', name: '轻松', tip: '6×6 · 无雷 · 一起挖宝' },
    easy:   { n: 5, mines: 3,  label: '🍬 休闲', name: '休闲', tip: '5×5 · 3 雷' },
    normal: { n: 6, mines: 6,  label: '⚙️ 普通', name: '普通', tip: '6×6 · 6 雷' },
    hard:   { n: 8, mines: 12, label: '🔥 挑战', name: '挑战', tip: '8×8 · 12 雷' }
  };
  const NUM_COLORS = ['', '#3a7fd5', '#2e8b57', '#d9534f', '#7a4fd9', '#b7791f', '#2aa198', '#666', '#999'];
  const THINK_LINES = ['TA正在观察雷区……', 'TA托着下巴想了想', 'TA盯着数字琢磨了一会儿'];

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function taName() { try { return window.taWord ? window.taWord() : T('TA'); } catch (e) { return T('TA'); } }
  function fastMul() { return (window.__msDebug && window.__msDebug.fast) ? 0.05 : 1; }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---- 音效（Web Audio 短促合成，v3.15 起全站音量标准 ~0.16） ----
  let audioCtx = null, soundOn = true;
  function beep(freq, dur, vol, type) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // FIX 2026-09-16：iOS 切后台后 ctx 被挂起，不 resume 则后续音效全部静音（connect-four 同款修法）
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = type || 'sine';
      g.gain.value = vol || 0.16;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      o.start(t); g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.stop(t + dur);
    } catch (e) {}
  }
  const sfxDig = () => beep(520, 0.06, 0.14);
  const sfxFlag = () => beep(760, 0.05, 0.12);
  const sfxBoom = () => beep(110, 0.3, 0.22, 'triangle');
  const sfxCoin = () => { beep(880, 0.08, 0.14); setTimeout(() => beep(1174, 0.1, 0.12), 80); };
  const sfxGift = () => { beep(784, 0.08, 0.13); setTimeout(() => beep(1046, 0.12, 0.13), 90); };
  const sfxWin = () => { beep(523, 0.12, 0.18); setTimeout(() => beep(659, 0.12, 0.18), 120); setTimeout(() => beep(784, 0.18, 0.18), 240); };
  const sfxFail = () => { beep(330, 0.16, 0.16); setTimeout(() => beep(247, 0.22, 0.16), 150); };

  // ---- 存储（战绩 / 小收藏 / 今日心意币计数，均按联系人桌面隔离） ----
  function statsKey() { return prefix() + ':ms-stats'; }
  function loadStats() {
    const d = { play: 0, win: 0, fail: 0, lastDiff: 'normal' };
    try {
      const raw = localStorage.getItem(statsKey());
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
    } catch (e) {}
    return d;
  }
  function saveStats(s) { try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch (e) {} }
  function keepsKey() { return prefix() + ':ms-keeps'; }
  function loadKeeps() {
    try {
      const raw = localStorage.getItem(keepsKey());
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function saveKeeps(list) { try { localStorage.setItem(keepsKey(), JSON.stringify(list.slice(-60))); } catch (e) {} }
  // FIX 2026-09-16：封顶键 UTC 日期改本地日期（UTC 口径下北京时间 0-8 点记到前一天）
  function coinDayKey() {
    const d = new Date();
    return prefix() + ':ml2_coin_ms_' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // 心意币统一入口：日封顶内走 giftWalletChange 进双方余额（v3.16.x：我和 TA 同步同额），返回实际入账（分）
  function grantCoin(fen) {
    let cur = 0;
    try { cur = Number(localStorage.getItem(coinDayKey())) || 0; } catch (e) {}
    const real = Math.min(fen, MS_COIN_CAP - cur);
    if (real <= 0) return 0;
    try { localStorage.setItem(coinDayKey(), String(cur + real)); } catch (e2) {}
    try { if (typeof window.giftWalletChange === 'function') window.giftWalletChange(real, real, '合作扫雷'); } catch (e3) {}
    return real;
  }

  // ---- 对局状态 ----
  let st = null;
  let taT = null;
  let selDiff = loadStats().lastDiff;
  if (!DIFFS[selDiff]) selDiff = 'normal';
  let flagMode = false;
  let cellPx = 44;

  function newState(key) {
    const d = DIFFS[key];
    const N = d.n * d.n;
    return {
      diffKey: key, n: d.n, mineTotal: d.mines,
      mine: null, num: null, content: null,       // 懒生成：第一次挖掘才布雷/放宝物
      open: new Array(N).fill(false),
      flag: new Array(N).fill(0),                 // 0 无 / 1 你 / 2 TA
      boom: new Array(N).fill(false),
      taFlagged: {},                              // TA 插过旗的格子（用于「判断错了/猜对了」吐槽）
      judged: {},
      lives: MAX_LIVES, turn: 1,
      started: false, over: false, lock: false,
      firstDig: true,
      digs: { you: 0, ta: 0 },
      minesFound: 0,
      foundList: [],                              // 本局发现的宝物类型序列
      coinEarned: 0                               // 本局实际入账的心意币（分）
    };
  }
  function N() { return st.n * st.n; }
  function neighborsOf(i) {
    const n = st.n, r = Math.floor(i / n), c = i % n, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
    }
    return out;
  }
  function recalcNums() {
    st.num = new Array(N()).fill(0);
    for (let i = 0; i < N(); i++) {
      let m = 0;
      neighborsOf(i).forEach((j) => { if (st.mine[j]) m++; });
      st.num[i] = m;
    }
  }

  // 懒生成：firstIdx 及其周围必无雷（小图兜底只保 firstIdx）；宝物落在安全格
  function generateMap(firstIdx) {
    const total = N();
    if (firstIdx == null || firstIdx < 0) firstIdx = 0;
    st.mine = new Array(total).fill(0);
    st.content = new Array(total).fill(null);
    if (st.mineTotal > 0) {
      let banned = new Set([firstIdx]);
      neighborsOf(firstIdx).forEach((j) => banned.add(j));
      if (total - banned.size < st.mineTotal) { banned = new Set([firstIdx]); }
      const pool = [];
      for (let i = 0; i < total; i++) if (!banned.has(i)) pool.push(i);
      shuffle(pool);
      for (let k = 0; k < st.mineTotal; k++) st.mine[pool[k]] = 1;
    }
    recalcNums();
    const chill = st.mineTotal === 0;
    const safe = [];
    for (let i = 0; i < total; i++) if (!st.mine[i]) safe.push(i);
    shuffle(safe);
    let coins = Math.max(2, Math.min(8, Math.round(safe.length * 0.12)));
    if (chill) coins = Math.min(safe.length, coins * 2);
    const gifts = chill ? 2 : 1, flowers = chill ? 2 : 1;
    let p = 0;
    const take = () => (p < safe.length ? safe[p++] : -1);
    for (let k = 0; k < coins && p < safe.length; k++) st.content[take()] = 'coin';
    for (let k = 0; k < gifts && p < safe.length; k++) st.content[take()] = 'gift';
    for (let k = 0; k < flowers && p < safe.length; k++) st.content[take()] = 'flower';
  }
  function forceMap(mineArr) {
    const total = N();
    st.mine = new Array(total).fill(0);
    for (let i = 0; i < total && i < mineArr.length; i++) st.mine[i] = mineArr[i] ? 1 : 0;
    st.content = new Array(total).fill(null);
    recalcNums();
    // 整局软复位：open/flag/boom 与计数全部归零并重绘（调试场景之间互不污染）
    st.open = new Array(total).fill(false);
    st.flag = new Array(total).fill(0);
    st.boom = new Array(total).fill(false);
    st.taFlagged = {}; st.judged = {};
    st.lives = MAX_LIVES;
    st.digs = { you: 0, ta: 0 };
    st.minesFound = 0; st.foundList = []; st.coinEarned = 0;
    st.firstDig = false;
    st.over = false; st.lock = false; st.turn = 1;
    clearTimeout(taT); taT = null;
    for (let i = 0; i < total; i++) renderCell(i);
    updateHud();
  }

  // ---- TA 推理（纯函数族；旗视为未知数而非事实，因此不会误信玩家的错误旗） ----
  function constraints() {
    const cons = [];
    for (let i = 0; i < N(); i++) {
      if (!st.open[i] || st.mine[i]) continue;
      const nb = neighborsOf(i);
      const free = nb.filter((j) => !st.open[j]);
      if (!free.length) continue;
      let boomAdj = 0;
      nb.forEach((j) => { if (st.boom[j]) boomAdj++; });
      cons.push({ need: st.num[i] - boomAdj, free });
    }
    return cons;
  }
  function deduceSafe() {
    const out = [], seen = {};
    constraints().forEach((c) => {
      if (c.need <= 0) c.free.forEach((j) => { if (!seen[j]) { seen[j] = 1; out.push(j); } });
    });
    return out;
  }
  function deduceMines() {
    const out = [], seen = {};
    constraints().forEach((c) => {
      if (c.need > 0 && c.free.length === c.need) {
        c.free.forEach((j) => { if (!seen[j]) { seen[j] = 1; out.push(j); } });
      }
    });
    return out;
  }
  function estProbs() {
    const p = {};
    constraints().forEach((c) => {
      const share = c.free.length ? Math.max(0, c.need) / c.free.length : 1;
      c.free.forEach((j) => { p[j] = Math.max(p[j] || 0, share); });
    });
    return p;
  }
  function defaultRatio() {
    let hidden = 0;
    for (let i = 0; i < N(); i++) if (!st.open[i]) hidden++;
    return hidden ? Math.max(0, st.mineTotal - st.minesFound) / hidden : 1;
  }
  function rollTaMode() {
    const r = Math.random();
    if (r < 0.7) return 'smart';
    if (r < 0.9) return 'memory';
    return 'wild';
  }
  // 返回 {type:'flag'|'dig', idx, guess?} 或 null（无处可动）
  function taDecide(mode) {
    const hidden = [];
    for (let i = 0; i < N(); i++) if (!st.open[i] && !st.flag[i]) hidden.push(i);
    if (!hidden.length) {
      // 只剩带旗的格子：挑风险最低的旗子格收尾，避免死局
      const flagged = [];
      for (let i = 0; i < N(); i++) if (!st.open[i] && st.flag[i]) flagged.push(i);
      if (!flagged.length) return null;
      const P = estProbs();
      let best = flagged[0], bp = Infinity;
      flagged.forEach((i) => { const q = P[i] != null ? P[i] : defaultRatio(); if (q < bp) { bp = q; best = i; } });
      return { type: 'dig', idx: best };
    }
    const sureMines = deduceMines().filter((i) => !st.flag[i]);
    const safeCells = deduceSafe();   // 含「被旗插着但可证明安全」的格：挖开即顺手纠正错误旗
    if (mode !== 'wild') {
      if (sureMines.length && Math.random() < 0.55) return { type: 'flag', idx: pick(sureMines) };
      if (safeCells.length) return { type: 'dig', idx: pick(safeCells) };
    }
    if (mode === 'wild') return { type: 'dig', idx: pick(hidden) };
    const P = estProbs();
    const ranked = hidden.map((i) => ({ i, p: P[i] != null ? P[i] : defaultRatio() }));
    ranked.sort((a, b) => a.p - b.p);
    if (mode === 'memory') {
      const half = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.5)));
      return { type: 'dig', idx: pick(half).i };
    }
    // smart：最危险的格若感觉危险，有概率先猜一面旗提醒你（可能猜错）
    const worst = ranked[ranked.length - 1];
    if (worst && worst.p >= 0.72 && Math.random() < 0.3) return { type: 'flag', idx: worst.i, guess: true };
    return { type: 'dig', idx: ranked[0].i };
  }

  // ---- 渲染 ----
  function buildBoardDom() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = 'repeat(' + st.n + ', ' + cellPx + 'px)';
    for (let i = 0; i < N(); i++) {
      const cell = document.createElement('div');
      cell.className = 'ms-cell';
      cell.setAttribute('data-i', String(i));
      const face = document.createElement('span');
      face.className = 'ms-face';
      cell.appendChild(face);
      boardEl.appendChild(cell);
    }
    // #349 开局波次发牌：按对角圈层 stagger 浮现；动画结束自清 class/内联延迟（防残留 delay 拖慢后续 ms-shake）
    for (let i = 0; i < N(); i++) {
      const r = Math.floor(i / st.n), c = i % st.n;
      const cell = boardEl.children[i];
      cell.classList.add('ms-born');
      cell.style.animationDelay = Math.min((r + c) * 26, 480) + 'ms';
      cell.addEventListener('animationend', function h(e) {
        if (e.target !== cell || e.animationName !== 'msborn') return;
        cell.classList.remove('ms-born');
        cell.style.animationDelay = '';
        cell.removeEventListener('animationend', h);
      });
    }
    fitBoard();
  }
  function fitBoard() {
    if (!stageEl || panel.hidden || !st) return;
    const w = stageEl.clientWidth;
    if (!w) return;
    cellPx = Math.max(26, Math.min(50, Math.floor((w - 10) / st.n)));
    boardEl.style.gridTemplateColumns = 'repeat(' + st.n + ', ' + cellPx + 'px)';
    const cells = boardEl.children;
    for (let i = 0; i < cells.length; i++) {
      cells[i].style.width = cellPx + 'px';
      cells[i].style.height = cellPx + 'px';
      cells[i].style.fontSize = Math.round(cellPx * 0.46) + 'px';
    }
  }
  function cellAt(i) { return boardEl.children[i] || null; }
  function renderCell(i, pop, delay) {
    const cell = cellAt(i);
    if (!cell) return;
    const gen = st;   // #343 局代币：延迟应用前若已换局（newGame 换 st）则丢弃，防旧局渲染污染新盘
    const apply = function () {
      if (st !== gen) return;
      const face = cell.firstChild;
      let txt = '', cls = 'ms-cell';
      if (st.boom[i]) { cls += ' ms-open ms-boom'; txt = '💥'; }
      else if (st.open[i]) {
        cls += ' ms-open';
        const c = st.content[i];
        if (c === 'coin') { txt = '🪙'; cls += ' ms-tr'; }
        else if (c === 'gift') { txt = '🎁'; cls += ' ms-tr'; }
        else if (c === 'flower') { txt = '🌸'; cls += ' ms-tr'; }
        else if (st.num[i] > 0) {
          txt = String(st.num[i]);
          cls += ' ms-n' + st.num[i];
        }
      } else if (st.flag[i]) {
        txt = '🚩';
        cls += st.flag[i] === 1 ? ' ms-fyou' : ' ms-fta';
      }
      cell.className = cls;
      face.textContent = txt;
      if (pop) { face.classList.remove('ms-pop'); void face.offsetWidth; face.classList.add('ms-pop'); }
    };
    // #343 delay：级联展开的视觉延迟（逻辑已同步开，仅表现层晚到）；测试 fast 倍率下 ≈0
    if (delay) { setTimeout(apply, Math.round(delay * fastMul())); return; }
    apply();
  }
  function heartsStr() { return '❤️'.repeat(st.lives) + '🖤'.repeat(MAX_LIVES - st.lives); }
  function openCount() { let x = 0; for (let i = 0; i < N(); i++) if (st.open[i]) x++; return x; }
  function safeTotal() { return st.mineTotal === 0 ? N() : N() - st.mineTotal; }
  function updateHud() {
    if (livesEl) livesEl.textContent = st.started ? heartsStr() : '';
    if (progEl) progEl.textContent = st.started ? '已探索 ' + openCount() + ' / ' + safeTotal() : '';
  }
  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  // 游戏内说话气泡：TA 在游戏里说的话直接显示在扫雷面板里，不再发到聊天
  const talkEl = document.getElementById('ms-talk');
  let talkHideT = null;
  function taTalk(text) {
    if (!talkEl) return;
    const bubble = talkEl.querySelector('.ms-talk-bubble');
    if (bubble) {
      bubble.innerHTML = '<span class="ms-talk-name">' + taName().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>' + text;
      talkEl.hidden = false;
      bubble.style.animation = 'none';
      void bubble.offsetWidth;
      bubble.style.animation = '';
    }
    clearTimeout(talkHideT);
    talkHideT = setTimeout(() => { if (talkEl) talkEl.hidden = true; }, 4000);
  }
  function shakeCell(i) {
    const cell = cellAt(i);
    if (!cell) return;
    cell.classList.remove('ms-shake'); void cell.offsetWidth; cell.classList.add('ms-shake');
  }

  // ---- 核心流程 ----
  let extraMsg = '';    // 一次性补充说明（如 TA 挪旗吐槽），由 composeStatus 消费
  // #343 改 BFS（原 DFS 栈）：out 顺序＝从起点向外扩散的圈层序，distOut 记录各格圈层
  // （渲染按层加 delay 形成涟漪；打开集合与原实现完全一致，仅顺序不同）
  function floodOpen(start, out, distOut) {
    if (st.mineTotal === 0) { st.open[start] = true; out.push(start); if (distOut) distOut[start] = 0; return; }
    const dist = {};
    dist[start] = 0;
    const queue = [start];
    while (queue.length) {
      const i = queue.shift();
      if (st.open[i] || st.flag[i]) continue;
      st.open[i] = true;
      out.push(i);
      if (st.num[i] === 0) {
        neighborsOf(i).forEach((j) => { if (!st.open[j] && !st.flag[j] && dist[j] == null) { dist[j] = dist[i] + 1; queue.push(j); } });
      }
    }
    if (distOut) Object.keys(dist).forEach((k) => { distOut[k] = dist[k]; });
  }
  function allSafeOpened() {
    for (let i = 0; i < N(); i++) { if (!st.mine[i] && !st.open[i]) return false; }
    return true;
  }
  function scheduleTaGiftChat(kind) {
    setTimeout(() => {
      try {
        // 送礼话术固定走内置池——不接互动字卡分组（游戏胜负回应池是泛用文案，
        // 会把「这个给你」顶成「我赢啦」一类，丢失送礼语义）
        const lines = kind === 'flower'
          ? ['挖到一朵小花，「这个给你。」', '发现了这个，觉得很适合你。']
          : ['挖到了一个小礼物，「这个给你。」', '发现了这个，「送你呀。」'];
        const say = pick(lines) || lines[0];
        // 送礼话术直接显示在游戏面板的说话气泡里，不再发到聊天
        if (say) taTalk(say);
      } catch (e) {}
    }, 700);
  }
  function dig(idx, byYou, allowFlagged) {
    const s = st;
    if (!s || !s.started || s.over || s.lock) return false;
    if (idx == null || idx < 0 || idx >= N() || s.open[idx]) return false;
    if (s.flag[idx] && !allowFlagged) {
      shakeCell(idx);
      setStatus('🚩 这格插着记号，长按取消后再挖');
      return false;
    }
    s.lock = true;
    if (s.firstDig) generateMap(s.mineTotal > 0 ? idx : -1);
    s.firstDig = false;
    const wasTaFlagged = !!s.taFlagged[idx];
    const hadPlayerFlag = s.flag[idx] === 1;
    s.flag[idx] = 0;
    extraMsg = '';

    if (s.mine[idx]) {
      s.open[idx] = true; s.boom[idx] = true;
      s.lives--; s.minesFound++;
      s.digs[byYou ? 'you' : 'ta']++;
      renderCell(idx, true);
      // #343 踩雷：棋盘震屏（CSS ms-quake），局面若终局让爆炸看完再弹结果
      boardEl.classList.remove('ms-quake'); void boardEl.offsetWidth; boardEl.classList.add('ms-quake');
      updateHud();
      // #349 掉心脉冲：❤️ 行缩放闪一下
      if (livesEl) { livesEl.classList.remove('ms-hurt'); void livesEl.offsetWidth; livesEl.classList.add('ms-hurt'); }
      sfxBoom();
      const who = byYou ? '你' : T('TA');
      let msg = '💥 ' + who + '踩到了雷！' + heartsStr();
      if (wasTaFlagged && !s.judged[idx]) { msg += '（不过 ' + T('TA') + ' 的旗没错）'; s.judged[idx] = 1; }
      if (hadPlayerFlag && byYou) msg += '（是你自己插的旗那格…）';
      if (s.lives <= 0) { setStatus(msg); finish(false, 640); return true; }
      setStatus(msg);
      passTurn(byYou, 950);   // 停一拍再让 TA 开口，踩雷提示不会被思考语立刻顶掉
      return true;
    }

    const newly = [], distMap = {};
    floodOpen(idx, newly, distMap);
    let maxDelay = 0;
    const gotIcons = [];
    for (let k = 0; k < newly.length; k++) {
      const i = newly[k];
      s.digs[byYou ? 'you' : 'ta']++;
      // #343 按 BFS 圈层逐格弹出（纯视觉级联，逻辑上已同步全部打开）
      const dly = Math.min((distMap[i] || 0) * 34, 374);
      if (dly > maxDelay) maxDelay = dly;
      renderCell(i, true, dly);
      const c = s.content ? s.content[i] : null;
      if (!c) continue;
      s.foundList.push(c);
      if (c === 'coin') {
        const real = grantCoin(100);
        if (real > 0) s.coinEarned += real;
        gotIcons.push('🪙');
        sfxCoin();
      } else {
        gotIcons.push(c === 'gift' ? '🎁' : '🌸');
        sfxGift();
        const keeps = loadKeeps();
        keeps.push({ t: c, ts: Date.now(), by: byYou ? 'you' : 'ta' });
        saveKeeps(keeps);
        if (!byYou) scheduleTaGiftChat(c);
      }
    }
    updateHud();
    sfxDig();
    let msg;
    if (gotIcons.length) {
      msg = (byYou ? '你发现了 ' : T('TA') + '发现了 ') + gotIcons.join(' ');
      if (gotIcons.indexOf('🪙') >= 0 && s.coinEarned > 0) msg += ' · 心意币 +¥1';
    } else if (byYou) {
      msg = '你挖开了一格';
    } else {
      msg = T('TA') + '挖开了一格';
    }
    if (wasTaFlagged && !s.judged[idx]) { msg += ' —— 这里其实是安全的，' + T('TA') + '判断错了'; s.judged[idx] = 1; }
    if (extraMsg) { msg += '（' + extraMsg + '）'; extraMsg = ''; }
    // #343 通关：等涟漪铺完再弹结算（单格小展开不延迟）
    if (allSafeOpened()) { setStatus(msg); finish(true, newly.length > 2 ? maxDelay + 260 : 0); return true; }
    setStatus(msg);
    passTurn(byYou, gotIcons.length ? 1100 : undefined);   // 有发现时同样停一拍
    return true;
  }
  function playerDig(idx) {
    if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
    if (flagMode) { toggleFlag(idx, 1); return; }
    dig(idx, true, false);
  }
  function toggleFlag(idx, who) {
    const s = st;
    if (!s || !s.started || s.over || s.lock || s.open[idx]) return;
    s.flag[idx] = s.flag[idx] === who ? 0 : who;
    renderCell(idx, true);   // #343 旗子弹出/收回带缩放
    sfxFlag();
  }
  function placeTaFlag(idx) {
    const s = st;
    if (!s || s.open[idx] || s.flag[idx] === 2) return;
    s.taFlagged[idx] = 1;
    s.flag[idx] = 2;
    renderCell(idx, true);   // #343 同上
  }
  function passTurn(byYou, taDelay) {
    const s = st;
    if (s.over) return;
    s.turn = byYou ? 2 : 1;
    if (s.turn === 2) { s.lock = true; scheduleTa(taDelay); }
    else { s.lock = false; showTurnStatus(); }
  }
  function showTurnStatus() {
    if (!st || st.over) return;
    setStatus('轮到你了' + (st.mineTotal === 0 ? '，慢慢挖～' : ''));
  }
  function scheduleTa(extraDelay) {
    clearTimeout(taT); taT = null;
    if (!st || st.over) return;
    const line = THINK_LINES[Math.floor(Math.random() * THINK_LINES.length)];
    const d = typeof extraDelay === 'number' ? extraDelay : 620 + Math.random() * 680;
    // 思考语延迟到行动前一刻才显示——刚挖出的踩雷/宝物提示不会被立刻顶掉
    taT = setTimeout(() => {
      taT = null;
      if (!st || st.over || st.turn !== 2) return;
      setStatus(T(line).replace('TA', T('TA')) + ' ' + heartsStr());
      taTurn();
    }, Math.round(d * fastMul()));
  }
  function taTurn() {
    const s = st;
    if (!s || s.over || !s.started || s.turn !== 2) return;
    const act = taDecide(rollTaMode());
    if (!act) { s.turn = 1; s.lock = false; showTurnStatus(); return; }
    if (act.type === 'flag') {
      placeTaFlag(act.idx);
      sfxFlag();
      setStatus('🚩 ' + T('TA') + (act.guess ? '觉得这里有雷，先做了个记号' : '标记了一颗雷的位置'));
      s.turn = 1; s.lock = false;
      setTimeout(showTurnStatus, Math.round(900 * fastMul()));
      return;
    }
    if (s.flag[act.idx] === 1) extraMsg = T('TA') + '把你的旗轻轻挪开了——下面确实是安全的';
    s.flag[act.idx] = 0;
    renderCell(act.idx);
    s.lock = false;   // dig 入口会重新上锁；TA 的思考期锁在这里解除
    dig(act.idx, false, true);
  }

  // ---- 结束：覆盖层 / 战绩 / 奖励 / 聊天联动 ----
  // #343 overlayDelay：踩雷/通关动画先演完再弹结果浮层；延迟期间关面板或开新局则不再弹
  function finish(win, overlayDelay) {
    const s = st;
    s.over = true; s.lock = false;
    clearTimeout(taT); taT = null;
    const stat = loadStats();
    stat.play++; if (win) stat.win++; else stat.fail++;
    stat.lastDiff = s.diffKey;
    saveStats(stat);
    if (win) {
      const base = s.mineTotal === 0 ? 200 : 500;
      const flawless = (s.mineTotal > 0 && s.lives === MAX_LIVES) ? FLAWLESS_BONUS : 0;
      // FIX 2026-09-16：幸运日（游乐室）奖励 ×2，仍受日封顶约束
      const msMult = (window.arcadeMult && window.arcadeMult('ms')) || 1;
      const real = grantCoin((base + flawless) * msMult);
      if (real > 0) s.coinEarned += real;
      sfxWin();
    } else {
      sfxFail();
    }
    // FIX 2026-09-16：接游乐室三件套——幸运日打卡 + 合作完成 8% 掉限定摆件（此前 ms 完全不在体系内）
    let msDrop = null;
    try {
      if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('ms');
      if (win && window.arcadeTryDrop) msDrop = window.arcadeTryDrop('ms');
    } catch (e) {}
    const gifts = s.foundList.filter((x) => x === 'gift').length;
    const flowers = s.foundList.filter((x) => x === 'flower').length;
    let body = pillsHtml();
    if (win) {
      body +=
        '<div class="pong-end-stat">💣 雷区清理完成！</div>' +
        '<div class="pong-end-stat">你探索 ' + s.digs.you + ' 格 · ' + T('TA') + '探索 ' + s.digs.ta + ' 格</div>' +
        '<div class="pong-end-stat">💣 找到地雷 ' + s.minesFound + '/' + s.mineTotal +
        ' · 🎁 宝物 ' + (gifts + flowers) + '</div>';
      if (s.lives === MAX_LIVES && s.mineTotal > 0) body += '<div class="pong-end-stat">💕 一颗雷都没踩，完美合作</div>';
    } else {
      body +=
        '<div class="pong-end-stat">💥 这次踩到太多雷了。</div>' +
        '<div class="pong-end-stat">你们一起探索了 ' + openCount() + ' 格，还差一点。</div>';
    }
    if (s.coinEarned > 0) body += '<div class="pong-end-stat">🪙 我的心意币 +¥' + (s.coinEarned / 100).toFixed(2) + '</div>';
    if (msDrop) body += '<div class="pong-end-stat">🎁 掉落限定摆件「' + msDrop.name + '」</div>';
    body += '<div class="pong-end-stat ms-quote">「' + (win ? pick(['一起找完了。', '我们配合得不错嘛。', '全部清完啦，开心。']) : pick(['差一点点而已，再来！', '下次小心一点就好。'])) + '」</div>';
    let showDelay = overlayDelay || 0;
    if (!win) {
      // #349 失败揭雷：没挖出的雷逐颗亮出 💣（纯显示层，不动 st.mine/open 逻辑态；正确插旗的雷保持 🚩）
      const gen = st;
      let rvN = 0, rvMax = 0;
      for (let i = 0; i < N(); i++) {
        if (!s.mine[i] || s.boom[i] || s.open[i] || s.flag[i]) continue;
        const dly = 140 + rvN * 90;
        rvN++; if (dly > rvMax) rvMax = dly;
        setTimeout(() => {
          if (st !== gen) return;
          const cell = cellAt(i);
          if (!cell) return;
          cell.classList.add('ms-reveal');
          const face = cell.firstChild;
          face.textContent = '💣';
          face.classList.remove('ms-pop'); void face.offsetWidth; face.classList.add('ms-pop');
        }, Math.round(dly * fastMul()));
      }
      if (rvN) showDelay = Math.max(showDelay, rvMax + 280);
    }
    const showResult = function () {
      // 延迟窗内可能已关面板/再来一局（st 被换/未 over）——此时不再弹结果
      if (!st || !st.over || panel.hidden) return;
      showOverlay(win ? '💣 合作完成' : '💥 差一点', body, '再来一次');
    };
    if (showDelay) setTimeout(showResult, Math.round(showDelay * fastMul()));
    else showResult();
    if (startBtn) startBtn.textContent = '再来一次';
    if (endBtn) endBtn.hidden = false;
    try {
      if (window.chatAddSystem) window.chatAddSystem(T('合作扫雷') + ' · ' + (win ? '完成 ' + DIFFS[s.diffKey].name : '差一点（' + DIFFS[s.diffKey].name + '）'), { special: 'ms' });
      // 合作模式：完成/差一点点都不是「平局」也不是「我赢/你赢」——直接走合作文案，
      // 不再接对抗/平局的互动回应池（避免 TA 说出「平局！」「赢你了」这类不符合合作语境的话）
      const fb = win
        ? ['一起找完了。', '我们配合得不错嘛。', '全部清完啦，开心。', '这一片雷区都清理干净了。']
        : ['差一点点而已，再来！', '下次小心一点就好。', '没事，再来一次？'];
      const say = (fb.length ? pick(fb) : fb[0]) || 'ok';
      // 合作回应直接显示在游戏面板的说话气泡里，不再发到聊天（结束记录仍写入聊天）
      setTimeout(() => { try { if (say) taTalk(say); } catch (e) {} }, 900);
    } catch (e) {}
  }

  // ---- 覆盖层 ----
  function pillsHtml() {
    return '<div class="ms-diffs">' + Object.keys(DIFFS).map((k) => {
      const d = DIFFS[k];
      return '<button class="ms-diff' + (k === selDiff ? ' on' : '') + '" data-diff="' + k + '" type="button" title="' + d.tip + '">' + d.label + '</button>';
    }).join('') + '</div>';
  }
  function showOverlay(title, body, btnText) {
    if (!overlayEl) return;
    if (ovTitleEl) ovTitleEl.innerHTML = title || '';
    if (ovBodyEl) ovBodyEl.innerHTML = body || '';
    if (startBtn && btnText) startBtn.textContent = btnText;
    overlayEl.hidden = false;
  }
  function showStartOverlay() {
    const s = loadStats();
    let body = pillsHtml();
    body += '<div class="ms-cur" id="ms-cur">当前：' + curHint() + '</div>';
    body += '<div class="ms-tip">轮流挖掘 · 你们共用 ' + heartsStrStatic() + '<br>数字 = 周围雷数 · 长按格子插旗<br>🪙🎁🌸 藏在格子里，一起找找看</div>';
    body += '<div class="ms-note">🎲 ' + T('TA') + '会推理也会失误——偶尔也需要你救场</div>';
    if (s.play > 0) body += '<div class="pong-end-stat">合作 ' + s.play + ' 局 · 完成 ' + s.win + ' 次</div>';
    showOverlay('合作扫雷', body, s.play > 0 ? '继续探索' : '开始探索');
    if (endBtn) endBtn.hidden = true;
  }
  function heartsStrStatic() { return '❤️❤️❤️'; }
  // 当前难度提示：把「这局到底有没有雷」讲清楚，避免「感觉挖不倒雷」的困惑
  function curHint() {
    const d = DIFFS[selDiff];
    return d.name + ' · ' + d.n + '×' + d.n
      + (d.mines ? ' · ' + d.mines + ' 颗雷' : ' · 本局无雷，纯挖宝藏');
  }
  function hideOverlay() { if (overlayEl) overlayEl.hidden = true; if (endBtn) endBtn.hidden = true; }

  // ---- 开局 ----
  function newGame() {
    clearTimeout(taT); taT = null;
    st = newState(selDiff);
    st.started = true;
    buildBoardDom();
    hideOverlay();
    updateHud();
    setStatus(st.mineTotal === 0
      ? '✅ 本局没有雷，一起挖宝找🪙🎁🌸'
      : '你的回合 · 本局 ' + st.mineTotal + ' 颗雷，点一格开始探索');
  }

  // 预建棋盘（c4 同款）：面板首开时舞台上就有未翻开的格子撑起高度，
  // 否则 .ms-stage 零高塌缩，开始覆盖层会被裁剪到看不见也没法点
  try {
    st = newState(selDiff);
    buildBoardDom();
  } catch (ePre) {}

  // ---- 小收藏 ----
  function bagText() {
    const keeps = loadKeeps();
    if (!keeps.length) return '还没有收藏。\n一起挖挖看吧，🎁 和 🌸 都藏在地里。';
    let giftN = 0, flowerN = 0;
    keeps.forEach((k) => { if (k.t === 'gift') giftN++; else if (k.t === 'flower') flowerN++; });
    const fmt = (ts) => { const d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
    const recent = keeps.slice(-4).reverse().map((k) => (k.t === 'gift' ? '🎁' : '🌸') + ' ' + fmt(k.ts) + (k.by === 'ta' ? '（' + T('TA') + '送的）' : ''));
    return '🎁 神秘礼物 ×' + giftN + '\n🌸 花朵 ×' + flowerN + '\n\n最近：\n' + recent.join('\n');
  }

  // ---- 输入（点=挖 / 长按或右键=旗 / 头部按钮切插旗模式） ----
  let lpTimer = null, lpFired = false, lastFlagTs = 0;
  boardEl.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.ms-cell');
    if (!cell) return;
    e.stopPropagation();
    lpFired = false;
    // FIX 2026-09-16：开始覆盖层下/终局后长按棋盘，原会 430ms 后震动并置 lpFired，
    // 吞掉松手后的第一次 click——未开局/已终局不起长按定时器
    if (!st || !st.started || st.over) return;
    const idx = parseInt(cell.getAttribute('data-i'), 10) || 0;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      lpFired = true;
      lastFlagTs = Date.now();
      toggleFlag(idx, 1);
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) {}
    }, 430);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    boardEl.addEventListener(ev, () => { clearTimeout(lpTimer); });
  });
  boardEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const cell = e.target.closest('.ms-cell');
    if (!cell) return;
    if (lpFired) { lpFired = false; return; }
    playerDig(parseInt(cell.getAttribute('data-i'), 10) || 0);
  });
  boardEl.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.ms-cell');
    if (!cell) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - lastFlagTs < 700) return;   // 长按后紧跟的 contextmenu 不重复切换
    toggleFlag(parseInt(cell.getAttribute('data-i'), 10) || 0, 1);
  });

  if (startBtn) startBtn.addEventListener('click', (e) => { e.stopPropagation(); newGame(); });
  if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closeMsPanel(); });
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeMsPanel(); });
  if (soundBtn) soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
  });
  if (modeBtn) modeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    flagMode = !flagMode;
    modeBtn.textContent = flagMode ? '🚩' : '⛏️';
    modeBtn.classList.toggle('ms-mode-on', flagMode);
    if (statusEl && flagMode && st && st.started && !st.over) setStatus('插旗模式：点一下格子就是 🚩（再按一次切回挖掘）');
  });
  if (bagBtn) bagBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      if (window.openModal) window.openModal('小收藏', '', function () {}, { noInput: true, staticText: bagText(), pills: [{ label: '好的', value: 'ok' }] });
    } catch (err) {}
  });
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
    const curEl = document.getElementById('ms-cur');
    if (curEl) curEl.textContent = '当前：' + curHint();
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
  window.openMsPanel = function () {
    try { if (isFs) toggleFs(); } catch (e) {}
    panel.hidden = false;
    try { setNames(); } catch (e) {}
    try { fitBoard(); } catch (e) {}
    // 有进行中的对局 → 接着玩（关面板期间轮到 TA 的补调度）
    if (st && st.started && !st.over) {
      if (st.turn === 2 && !taT) scheduleTa();
      else if (st.turn === 1 && !st.lock) showTurnStatus();
      return;
    }
    showStartOverlay();
    setStatus('选择难度开始探索');
  };
  function closeMsPanel() {
    clearTimeout(taT); taT = null;
    if (panel) panel.hidden = true;
  }
  window.closeMsPanel = closeMsPanel;
  document.addEventListener('contact-switched', () => { try { closeMsPanel(); } catch (e) {} });
  window.addEventListener('resize', () => { if (!panel.hidden) fitBoard(); });

  // ---- 入口：聊天更多功能 → 小游戏 → 扫雷（自绑定，chat.js 不改） ----
  (function bindEntry() {
    const btn = document.getElementById('more-ms');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      const hideIds = ['poke-card', 'emoji-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel'];
      hideIds.forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
      try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
      try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
      try { if (window.closeC4Panel) window.closeC4Panel(); } catch (err) {}
      try { openMsPanel(); } catch (err) {
        try { panel.hidden = false; showStartOverlay(); setStatus('选择难度开始探索'); } catch (e2) {}
        try { console.error('[ms] open failed', err); } catch (e2) {}
      }
    });
    // 兄弟浮层互斥兜底：其他入口不知道本面板，它们打开时收起本面板
    try {
      if (window.MutationObserver) {
        const SIBLING_IDS = ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-more-panel'];
        const mo = new MutationObserver(() => {
          if (panel.hidden) return;
          for (let i = 0; i < SIBLING_IDS.length; i++) {
            const el = document.getElementById(SIBLING_IDS[i]);
            if (el && !el.hidden) { closeMsPanel(); break; }
          }
        });
        SIBLING_IDS.forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
      }
    } catch (e) {}
  })();

  // 只读/驯化调试口（tools/verify-coop-mine.mjs 专用）
  window.__msDebug = {
    st: () => st,
    newGame: newGame,
    setDiff: (k) => { if (DIFFS[k]) selDiff = k; },
    dig: (i, you) => dig(i, you !== false, true),
    toggleFlag: (i, w) => toggleFlag(i, w || 1),
    clearFlag: (i) => { if (st) { st.flag[i] = 0; renderCell(i); } },
    placeTaFlag: placeTaFlag,
    forceMap: forceMap,
    setContent: (i, t) => { if (st && st.content) st.content[i] = t; },
    setMine: (i, v) => { if (st && st.mine) st.mine[i] = v ? 1 : 0; },
    setNum: (i, v) => { if (st) st.num[i] = v; },
    setBoom: (i) => { if (st) { st.boom[i] = true; st.open[i] = true; renderCell(i); } },
    openCell: (i) => { if (st) { st.open[i] = true; renderCell(i); } },
    recalcNums: recalcNums,
    deduceSafe: deduceSafe,
    deduceMines: deduceMines,
    probs: estProbs,
    decide: taDecide,
    rollMode: rollTaMode,
    grantCoinRaw: grantCoin,
    stopTa: () => { clearTimeout(taT); taT = null; },
    unlock: () => { if (st) st.lock = false; },
    fast: false
  };
})();

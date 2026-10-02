// ===== 贪吃蛇（聊天更多功能 · 三模式：我 vs TA / 双人同屏对战 / 双人组队 vs TA）=====
// 20×20 地图 / 同屏最多 3 条蛇（P1+P2+TA AI）/ 统一碰撞结算（公平）/ TA=行为池 AI
// 难度（速度）+ 食物数量可选 + 暂停 + 全屏 + 保存/继续对局（localStorage）
(function () {
  'use strict';
  // v3.15.x：地图格数动态化——半框固定 15×15 基准；全屏时按可视区实际剩余空间放大
  // （约 24px 一格，竖屏约 15×31），对局自身尺寸存在 state.gw/gh，跨全屏/半框恢复不丢档。
  // 物理与 AI 一律读 gW()/gH()（进行中对局用 state 尺寸，空闲态用下一局尺寸 GW/GH）。
  let GW = 15, GH = 15;
  const FS_CELL = 21;                  // 全屏地图目标格子尺寸（逻辑 px）——偏小让地图更大
  const INIT_LEN = 3;
  const FOOD_TARGET = 2;               // 默认同屏食物数（可在头部选择器调 2/4/6/8）
  // FIX 2026-09-12 #349 多桌面串名串档根因：此前的 PREFIX/KEY/SAVE_KEY/BEST_KEY/PARTNER_KEY
  // 是【模块加载时冻结】的桌面命名空间——页面加载时在 A 桌面，之后切到 B 桌面开贪吃蛇，
  // 标题昵称/战绩/最高分/存档读写的仍是 A 桌面的键（跨桌面串数据，任何机型浏览器必现）。
  // 改为每次读写动态取 activePrefix()（同 gomoku/linkup/match3 等面板的 prefix() 模式）；
  // 战绩/最高分读侧保留无 cid 的顶层遗留键回退（最早版本数据不丢），写侧只写动态键。
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function keyScore() { return prefix() + ':snake-score'; }
  function keySaved() { return prefix() + ':snake-saved'; }
  function keyBest() { return prefix() + ':snake-best'; }
  function keyMode() { return prefix() + ':snake-mode'; }
  function keyFoodN() { return prefix() + ':snake-foodn'; }

  // 难度：tick 间隔(ms)按时间段 [0-30s, 30-60s, 60-90s, 90s+]
  // 配合 rAF 插值渲染，蛇身视觉连续滑动；逻辑步进间隔可适当放慢以保持可操作性
  const DIFFS = {
    easy:   { ticks: [200, 180, 160, 140] },
    normal: { ticks: [150, 130, 115, 100] },
    hard:   { ticks: [105, 90, 80, 70] }
  };
  const MODES = {
    duo:  { label: '我 vs TA' },
    pvp:  { label: '双人对战' },
    coop: { label: '双人组队' }
  };

  const BEHAVIORS = {
    randomTurn:    { prob: 0.08, cd: 6000 },
    changeTarget:  { prob: 0.06, cd: 7000 },
    contestFood:   { prob: 0.20, cd: 5000 },
    giveUpContest: { prob: 0.10, cd: 5000 },
    chasePlayer:   { prob: 0.05, cd: 8000 },
    avoidPlayer:   { prob: 0.12, cd: 5000 },
    speedUp:       { prob: 0.03, cd: 10000 },
    pause:         { prob: 0.02, cd: 12000 },
    detour:        { prob: 0.07, cd: 7000 }
  };

  let panel, canvas, ctx, scoreEl, hintEl, startBtn, restartBtn, resumeBtn, resultEl, dpadEl, diffSel, modeSel, foodSel, pauseBtn, fsBtn, wallBtn, safeBtn, bestEl;
  let state = null;
  let behavior = null;
  let countdownTimer = null;
  let rafId = null;
  let lastFrameTime = 0, acc = 0;
  let prevPlayerBody = null, prevOppBody = null;
  let touchBase = null, lastTouchDir = null, lockAxis = null;
  let audioCtx = null;
  let paused = false;
  let isFs = false;
  let pauseAt = 0;
  let cssW = 360, cssH = 360, dpr = 1;   // 画布 CSS 尺寸（全屏由 setupCanvas 按剩余空间计算）
  let lastFitBox = null, refitSettle = 0;   // #774 视口抖动闸门：上次铺设照着的可用盒 / 落定定时器
  let particles = [], floaters = [], renderLastTime = 0;
  // 多点触控分轨（双人模式：左半屏=P1、右半屏=P2；经典模式整块画布都归 P1）
  let touchTracks = {};

  // 当前生效的地图格数：进行中对局用自己的尺寸，空闲/下一局用视口推算的 GW/GH
  function gW() { return (state && state.gw) || GW; }
  function gH() { return (state && state.gh) || GH; }
  function curMode() { return (state && state.mode) || (modeSel && modeSel.value) || 'duo'; }
  // 新开局的模式/食物数：一律取头部选择器当前值（state.mode 只代表进行中对局，残留旧值会吞掉新模式选择）
  function nextMode() { return (modeSel && MODES[modeSel.value]) ? modeSel.value : 'duo'; }
  function nextFoodN() { return foodSel ? (parseInt(foodSel.value, 10) || FOOD_TARGET) : FOOD_TARGET; }
  function foodTargetN() { return (state && state.foodTarget) || FOOD_TARGET; }
  // 同屏蛇列表（统一结算/渲染顺序：P1 → P2 → TA）
  function activeSnakes() {
    if (!state) return [];
    const a = [state.player];
    if (state.p2) a.push(state.p2);
    a.push(state.opp);
    return a;
  }
  function humanSnakes() { return activeSnakes().filter(function (s) { return s.ctrl !== 'ai'; }); }
  // 配色：P1 绿 / P2 橙 / TA 蓝（pvp 时对面那条 ctrl='p2' 用 P2 橙）
  function snakeSkin(s) {
    if (s === state.player) return ['#34c759', '#28a745'];
    if (s.ctrl === 'p2') return ['#ff9f0a', '#e08600'];
    return ['#5ac8fa', '#3a9fd6'];
  }
  function snakeLabel(s) {
    if (s === state.player) return 'P1';
    if (s.ctrl === 'p2') return 'P2';
    return (window.taFit ? window.taFit('TA') : 'TA');
  }
  function themeDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

  function vib(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {} }

  function $(id) { return document.getElementById(id); }

  function beep(freq, dur) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // FIX 2026-09-16：iOS 锁屏/来电后 ctx 被系统挂起，不 resume 则此后音效永久哑音（connect-four 同款修法）
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'square'; g.gain.value = 0.14;   // v3.15.x：0.04→0.14，边听音乐边玩时音效清晰
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }
  const SFX = {
    eat: function () { beep(880, 0.07); },
    hit: function () { beep(180, 0.18); },
    win: function () { beep(660, 0.12); setTimeout(function () { beep(880, 0.14); }, 130); }
  };

  function readScore() { const raw = lsGet(keyScore()) || lsGet('xy-home-v2:snake-score'); try { return JSON.parse(raw || '{"w":0,"l":0,"d":0}'); } catch (e) { return { w: 0, l: 0, d: 0 }; } }
  function writeScore(s) { try { localStorage.setItem(keyScore(), JSON.stringify(s)); } catch (e) {} }
  function renderScore() {
    if (!scoreEl) return;
    const s = readScore();
    scoreEl.textContent = '胜 ' + s.w + ' · 负 ' + s.l + ' · 平 ' + s.d;
  }
  function readBest() { const raw = lsGet(keyBest()) || lsGet('xy-home-v2:snake-best'); try { return JSON.parse(raw || '{}'); } catch (e) { return {}; } }
  function writeBest(b) { try { localStorage.setItem(keyBest(), JSON.stringify(b)); } catch (e) {} }
  function renderBest() {
    if (!bestEl) return;
    const b = readBest();
    const diff = (state && state.diff) || (diffSel && diffSel.value) || 'normal';
    const cur = b[diff];
    if (!cur) { bestEl.hidden = true; return; }
    bestEl.textContent = '🏆 ' + (diff === 'easy' ? '慢' : diff === 'hard' ? '快' : '普通') + '档：最高 ' + cur.score + ' 分 · 最长 ' + cur.len;
    bestEl.hidden = false;
  }
  function updateBest(result) {
    try {
      const b = readBest();
      const diff = state.diff || 'normal';
      const cur = b[diff] || { score: 0, len: 0 };
      // 组队模式按队伍合计分（P1+P2）计入最高分，长度仍取 P1
      const ps = Math.floor(state.player.score) + (state.mode === 'coop' && state.p2 ? Math.floor(state.p2.score) : 0);
      const pl = state.player.body.length;
      let changed = false;
      if (result === 'win' && ps > cur.score) { cur.score = ps; changed = true; }
      if (pl > cur.len) { cur.len = pl; changed = true; }
      if (changed) { b[diff] = cur; writeBest(b); }
    } catch (e) {}
  }
  function toggleFlag(name) {
    if (!state) return;
    if (!state.flags) state.flags = { wall: false, safe: false };
    state.flags[name] = !state.flags[name];
    const btn = name === 'wall' ? wallBtn : safeBtn;
    if (btn) btn.classList.toggle('on', state.flags[name]);
    if (name === 'wall' && hintEl && state.status === 'idle') hintEl.textContent = state.flags.wall ? '穿墙已开 · 点开始' : '点开始 · 滑动控制方向';
    if (name === 'safe' && hintEl && state.status === 'idle') hintEl.textContent = state.flags.safe ? '安全模式 · 点开始' : '点开始 · 滑动控制方向';
  }

  // 滚动区可放画布的空间：扣掉同屏兄弟块（计分/最长纪录/提示/结算/按钮/方向键）、
  // 它们之间的 flex gap（.snake-fs 用 gap:min(2vh,2vw)，漏算会让画布顶出屏、按钮被裁）与内边距。
  // 不做"至少 240×260"式的抬高：极矮/横屏下量到多少就用多少，格子 9px 下限 + 可滚动兜底接住。
  function scrollAvail() {
    const sc = panel.querySelector('.poke-card-scroll');
    let availW = (sc && sc.clientWidth) || window.innerWidth || 360;
    let availH = (sc && sc.clientHeight) || window.innerHeight || 360;
    if (sc && sc.clientHeight > 0) {
      const st = getComputedStyle(sc);
      let n = 0;   // 参与布局的兄弟块数；n 块 + 画布共 n+1 项，之间有 n 个 gap
      sc.querySelectorAll('.snake-score,.snake-best,.snake-hint,.snake-result:not([hidden]),.snake-controls,.snake-dpad').forEach(function (el) {
        if (el.hidden || !el.offsetHeight) return;   // display:none / hidden 的块不占空间也没有 gap
        const cs = getComputedStyle(el);
        availH -= el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
        n++;
      });
      availH -= (parseFloat(st.rowGap) || 0) * n;
      availH -= (parseFloat(st.paddingTop) || 0) + (parseFloat(st.paddingBottom) || 0);
      availW -= (parseFloat(st.paddingLeft) || 0) + (parseFloat(st.paddingRight) || 0);
    }
    return { w: Math.max(120, availW), h: Math.max(90, availH) };
  }
  // 按格子边长铺设画布，并用「实际溢出」自我校正：上一步的量算（字号换行、gap 取整、字体渲染）
  // 总有几像素偏差，而全屏滚动区是裁切的——溢出 1px 就是按钮被切一截，所以量 scrollHeight 再收，最多 4 轮。
  function applyCell(cell, minCell) {
    const sc = panel.querySelector('.poke-card-scroll');
    for (let i = 0; i < 4; i++) {
      cell = Math.max(minCell, cell);
      cssW = Math.round(cell * gW()); cssH = Math.round(cell * gH());
      // 位图尺寸「赋同一个值」也会清空画布（HTMLCanvas 语义），清空＝整屏白一下：
      // 只在真的变了才写 style 与位图，同值重铺一律跳过（#774 抖动期白闪的直接来源）
      const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
      if (canvas.style.width !== cssW + 'px') canvas.style.width = cssW + 'px';
      if (canvas.style.height !== cssH + 'px') canvas.style.height = cssH + 'px';
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!sc || !sc.clientHeight) break;          // 面板未布局（隐藏）时量不到，下次打开/resize 会重算
      const over = sc.scrollHeight - sc.clientHeight;
      if (over <= 0 || cell <= minCell) break;
      cell -= over / gH();
    }
    if (sc && sc.clientHeight) lastFitBox = scrollAvail();   // 记下这次是照着哪个可用盒铺的
  }
  // 全屏：按当前地图把画布贴合到剩余空间（不改格数；开始按钮收起/结算块出现后调用）
  function fitCanvasBox() {
    if (!canvas || !isFs || !ctx) return;
    const av = scrollAvail();
    applyCell(Math.min(av.w / gW(), av.h / gH()), 9);
  }
  // 非全屏：画布贴齐滚动区剩余高度，保证「再来一局」按钮下方的方向键在小屏也一屏可见，无需再下拉滚动。
  function fitNonFsCanvas() {
    GW = 15; GH = 15;                // 半框固定 15×15 基准
    const av = scrollAvail();
    applyCell(Math.min(360, Math.max(160, Math.min(av.w, av.h))) / 15, 6);
  }
  function refitNonFs() {
    if (!canvas || !panel || panel.hidden || isFs) return;
    fitNonFsCanvas();
    if (ctx) render(0);
  }
  // 兄弟块显隐（最长纪录 / 结算 / 开始按钮）会改变可放画布的高度 → 按当前模式重铺一次
  function refitAll() {
    refitNonFs();                 // 非全屏：内部已 render
    if (!isFs) return;
    fitCanvasBox();
    render(0);                    // applyCell 改位图尺寸会清空画布
  }
  // #774 视口抖动闸门（iPhone 16 Pro + Safari 实报「玩的时候屏幕和蛇一直弹和闪」）：
  // iOS 独立应用的对局期视口高会在 812↔874 之间反复跳（状态栏/底部横条区被系统改写），
  // 安卓 Chrome 的地址栏收放同理；而画布每响应一次 resize 就是「整张地图换比例 + 位图重建」，
  // 实测 2 秒抖动内地图在 230×388 ↔ 193×326 之间脉冲 16 次＝用户看到的弹＋闪。
  // 改法：视口连续变化期间一律不重铺，等它安静 280ms 再量一次，量出来和上次铺设用的
  // 可用盒一致（<2px）就整条跳过——抖动不再驱动布局，旋转/分屏这类真变化照旧收敛到一次重铺；
  // 极端的「抖着不停且真的放不下」由 .poke-card-scroll 可纵向滚兜底（同既有 overflow 策略）。
  function onViewportChange() {
    clearTimeout(refitSettle);
    refitSettle = setTimeout(function () {
      if (!panel || panel.hidden || !canvas) return;
      const av = scrollAvail();
      if (lastFitBox && Math.abs(av.w - lastFitBox.w) < 2 && Math.abs(av.h - lastFitBox.h) < 2) return;
      refitAll();
    }, 280);
  }
  function setupCanvas() {
    if (!canvas) return;
    // dpr 上限 2：全屏 34×46 格 ×dpr3 位图约 2100×2900，低端安卓每帧填充吃不消，且 2 与 3 肉眼无差
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx = canvas.getContext('2d');   // 幂等，供 applyCell 重设 transform
    if (isFs) {
      // 全屏：空闲/结束态顺便把「下一局」地图按 FS_CELL 放大到接近满屏；
      // 进行中/暂停/倒计时不改格数（蛇身坐标仍有效），只适配画布。
      if (!state || state.status === 'idle' || state.status === 'over') {
        const av0 = scrollAvail();
        GW = Math.max(12, Math.min(34, Math.floor(av0.w / FS_CELL)));
        GH = Math.max(12, Math.min(46, Math.floor(av0.h / FS_CELL)));
      }
      fitCanvasBox();
    } else {
      fitNonFsCanvas();
    }
  }

  function initEls() {
    panel = $('chat-snake-panel');
    if (!panel) return;
    canvas = $('snake-canvas');
    setupCanvas();
    scoreEl = $('snake-score');
    hintEl = $('snake-hint');
    startBtn = $('snake-start');
    restartBtn = $('snake-restart');
    resumeBtn = $('snake-resume');
    resultEl = $('snake-result');
    dpadEl = $('snake-dpad');
    diffSel = $('snake-diff');
    modeSel = $('snake-mode');
    foodSel = $('snake-food');
    pauseBtn = $('snake-pause');
    fsBtn = $('snake-fs');
    wallBtn = $('snake-wall');
    safeBtn = $('snake-safe');
    bestEl = $('snake-best');
    if (startBtn) startBtn.addEventListener('click', function (e) { e.stopPropagation(); startGame(diffSel ? diffSel.value : 'normal'); });
    if (restartBtn) restartBtn.addEventListener('click', function (e) { e.stopPropagation(); startGame(diffSel ? diffSel.value : 'normal'); });
    if (resumeBtn) resumeBtn.addEventListener('click', function (e) { e.stopPropagation(); resumeGame(); });
    if (pauseBtn) pauseBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePause(); });
    if (fsBtn) fsBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleFs(); });
    if (wallBtn) wallBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleFlag('wall'); });
    if (safeBtn) safeBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleFlag('safe'); });
    // 模式偏好：记忆上次选择；空闲态即时按新模式重摆蛇位（对局中不打断，下一局生效）
    if (modeSel) modeSel.addEventListener('change', function (e) {
      e.stopPropagation();
      try { localStorage.setItem(keyMode(), modeSel.value); } catch (er) {}
      if (state && (state.status === 'idle' || state.status === 'over')) {
        const keepDiff = state.diff;
        state = null;
        resetToIdle(keepDiff);
      }
      if (hintEl && state && state.status === 'idle') hintEl.textContent = modeHint();
    });
    // 食物数量偏好：对局中调整也即时补food（下一 tick maintainFood 补齐）
    if (foodSel) foodSel.addEventListener('change', function (e) {
      e.stopPropagation();
      try { localStorage.setItem(keyFoodN(), foodSel.value); } catch (er) {}
      if (state) { state.foodTarget = parseInt(foodSel.value, 10) || FOOD_TARGET; if (state.status !== 'playing') maintainFood(); }
    });
    const closeBtn = $('chat-snake-close');
    if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); closeSnakePanel(); });
    setupInput();
    document.addEventListener('contact-switched', function () { try { closeSnakePanel(); state = null; behavior = null; } catch (e) {} });
    window.addEventListener('resize', function () {
      if (!panel || panel.hidden) return;
      // FIX 2026-09-16：原只处理全屏，半框旋转后画布不重排——refitAll 内部按 isFs 分流
      // #774：不再每个 resize 事件同步重铺（iOS/安卓视口抖动会把地图打成脉冲），改走落定闸门
      onViewportChange();
    });
    // FIX 2026-09-16：切后台自动暂停+存档（原 saveGame 只挂在关面板，iOS Safari 后台杀页面丢进行中对局）
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state && state.status === 'playing') { saveGame(); togglePause(); }
    });
  }

  function modeHint() {
    const m = curMode();
    if (m === 'pvp') return '点开始 · P1 左半屏/方向键 · P2 右半屏/WASD';
    if (m === 'coop') return '点开始 · 组队对抗 TA · P2 用 WASD/右半屏';
    return '点开始 · 滑动控制方向';
  }

  function setupInput() {
    if (!canvas) return;
    // 滑动控制：touchmove 实时识别方向 + 主轴锁定防误触，一次滑动可连续多次转向。
    // 双人（pvp/coop）按 touchstart 落点分轨：左半屏→P1、右半屏→P2；每根手指独立轨迹互不干扰。
    const TH = 12; // 转向触发阈值(px)
    function zoneOf(t) {
      if (curMode() === 'duo') return 'p1';
      const r = canvas.getBoundingClientRect();
      return (t.clientX - r.left) < r.width / 2 ? 'p1' : 'p2';
    }
    canvas.addEventListener('touchstart', function (e) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        touchTracks[t.identifier] = { zone: zoneOf(t), base: { x: t.clientX, y: t.clientY }, lastDir: null, lockAxis: null };
      }
      // 单指场景保留旧全局基点语义（兼容既有单指滑动习惯）
      const t0 = e.touches[0];
      touchBase = { x: t0.clientX, y: t0.clientY };
      lastTouchDir = null;
      lockAxis = null;
    }, { passive: true });
    function trackMove(tr, cx, cy) {
      const dx = cx - tr.base.x, dy = cy - tr.base.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx < TH && ady < TH) return;
      // #221 轴锁可解锁：锁定轴响应转向；另一轴偏移显著反超（>1.5×）时改锁并转向——
      // 原实现一次触摸锁死横/竖轴，L 形拖动（先右后上）必须抬手重滑才能转向＝「按了没反应」；
      // 1.5× 反超门槛让 45° 斜滑仍沿主轴走不抖动。
      let dir = null;
      let lockAxis = tr.lockAxis;
      if (lockAxis === 'h') {
        if (ady >= TH && ady > adx * 1.5) { lockAxis = 'v'; dir = dy > 0 ? 'd' : 'u'; }
        else if (adx >= TH) dir = dx > 0 ? 'r' : 'l';
      } else if (lockAxis === 'v') {
        if (adx >= TH && adx > ady * 1.5) { lockAxis = 'h'; dir = dx > 0 ? 'r' : 'l'; }
        else if (ady >= TH) dir = dy > 0 ? 'd' : 'u';
      } else {
        lockAxis = adx > ady ? 'h' : 'v';
        if (lockAxis === 'h') { if (adx >= TH) dir = dx > 0 ? 'r' : 'l'; }
        else { if (ady >= TH) dir = dy > 0 ? 'd' : 'u'; }
      }
      tr.lockAxis = lockAxis;
      if (!dir) return;
      // #221 无论方向是否变化都把基点跟到当前点：同向重复滑动若不重置基点，
      // 位移在旧基点上持续累积，之后拐弯时另一轴偏移对累计位移的 1.5× 反超
      // 永远不成立 → L 形拖动拐不了弯（无头浏览器复现实测）。
      tr.base = { x: cx, y: cy };
      if (dir === tr.lastDir) return;
      if (dir === 'u') (tr.zone === 'p2' ? setP2Dir : setPlayerDir)(0, -1);
      else if (dir === 'd') (tr.zone === 'p2' ? setP2Dir : setPlayerDir)(0, 1);
      else if (dir === 'l') (tr.zone === 'p2' ? setP2Dir : setPlayerDir)(-1, 0);
      else (tr.zone === 'p2' ? setP2Dir : setPlayerDir)(1, 0);
      tr.lastDir = dir;
      // 单指场景同步旧全局态（调试口/老习惯兼容）
      touchBase = { x: cx, y: cy };
      lastTouchDir = dir;
    }
    canvas.addEventListener('touchmove', function (e) {
      if (!e.changedTouches) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const tr = touchTracks[t.identifier];
        if (tr) trackMove(tr, t.clientX, t.clientY);
      }
    }, { passive: true });
    function trackEnd(e) {
      for (let i = 0; i < e.changedTouches.length; i++) delete touchTracks[e.changedTouches[i].identifier];
      if (!e.touches || !e.touches.length) { touchBase = null; lastTouchDir = null; lockAxis = null; }
    }
    canvas.addEventListener('touchend', trackEnd, { passive: true });
    canvas.addEventListener('touchcancel', trackEnd, { passive: true });
    if (dpadEl) {
      // #221 pointerdown 即时转向：原 click 依赖 touchend 后合成，移动端慢一拍且快速连点
      // 两键时第二次 click 可能不触发；pointerdown 原生即时，click 保留兜底（鼠标/无指针环境）。
      const dpPress = function (e) {
        const btn = e.target.closest('[data-dir]');
        if (!btn) return;
        e.stopPropagation();
        const d = btn.dataset.dir;
        if (d === 'up') setPlayerDir(0, -1);
        else if (d === 'down') setPlayerDir(0, 1);
        else if (d === 'left') setPlayerDir(-1, 0);
        else if (d === 'right') setPlayerDir(1, 0);
      };
      dpadEl.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return;   // 鼠标走 click，避免双触发
        dpPress(e);
      });
      dpadEl.addEventListener('click', dpPress);
    }
    document.addEventListener('keydown', function (e) {
      if (!panel || panel.hidden) return;
      if (!state || state.status !== 'playing') return;
      const k = e.key.toLowerCase();
      const m = curMode();
      let used = true;
      // 双人模式分工：方向键=P1、WASD=P2；经典模式两套键都归 P1
      if (k === 'arrowup' || (m === 'duo' && k === 'w')) setPlayerDir(0, -1);
      else if (k === 'arrowdown' || (m === 'duo' && k === 's')) setPlayerDir(0, 1);
      else if (k === 'arrowleft' || (m === 'duo' && k === 'a')) setPlayerDir(-1, 0);
      else if (k === 'arrowright' || (m === 'duo' && k === 'd')) setPlayerDir(1, 0);
      else if (m !== 'duo' && k === 'w') setP2Dir(0, -1);
      else if (m !== 'duo' && k === 's') setP2Dir(0, 1);
      else if (m !== 'duo' && k === 'a') setP2Dir(-1, 0);
      else if (m !== 'duo' && k === 'd') setP2Dir(1, 0);
      else used = false;
      if (used) e.preventDefault();
    });
  }

  // #221 双槽输入队列通用化：P1/P2 共用同一套入队逻辑（锚点行保持原文本）。
  function setSnakeDir(p, x, y) {
    if (!p || !p.alive) return;
    // #221 双槽输入队列：nextDir 是「下一步」、nextDir2 是「下下一步」，一个 tick 内连给的
    // 两个转向（如急转弯 上→左）不再互相覆盖吞输入——单槽时后给的把先给的挤掉，玩家感知「按了没反应」。
    const last = p.nextDir2 || p.nextDir || p.dir;
    if (x === -last.x && y === -last.y) return;      // 相对「队尾方向」禁止 180° 回头
    if (last.x === x && last.y === y) return;        // 与队尾同向不重复入队
    if (!p.nextDir || (p.nextDir.x === p.dir.x && p.nextDir.y === p.dir.y && !p.nextDir2)) p.nextDir = { x: x, y: y };
    else if (!p.nextDir2) p.nextDir2 = { x: x, y: y };
    else { p.nextDir = p.nextDir2; p.nextDir2 = { x: x, y: y }; }
    vib(8);
  }
  function setPlayerDir(x, y) {
    if (!state || state.status !== 'playing') return;
    setSnakeDir(state.player, x, y);
  }
  function setP2Dir(x, y) {
    if (!state || state.status !== 'playing') return;
    if (state.opp && state.opp.ctrl === 'p2') setSnakeDir(state.opp, x, y);
    else if (state.p2) setSnakeDir(state.p2, x, y);
  }

  function mkSnake(body, dir, ctrl) {
    return { body: body, dir: dir, nextDir: { x: dir.x, y: dir.y }, nextDir2: null, alive: true, score: 0, foodCount: 0, ctrl: ctrl, eatT: 0, _prev: null };
  }

  function newGame(diff) {
    const mode = nextMode();
    const py = Math.floor(GH / 2);
    const prevFlags = state && state.flags || { wall: false, safe: false };
    const playerBody = [];
    for (let i = 0; i < INIT_LEN; i++) playerBody.push({ x: 4 - i, y: py });
    state = {
      diff: diff || 'normal',
      mode: mode,
      gw: GW, gh: GH,
      foodTarget: nextFoodN(),
      player: mkSnake(playerBody, { x: 1, y: 0 }, 'p1'),
      p2: null,
      opp: null,
      foods: [],
      status: 'idle',
      startTime: 0,
      elapsed: 0,
      flags: { wall: prevFlags.wall, safe: prevFlags.safe }
    };
    // 布位：duo 左右对峙（AI 会主动避让不对冲）；pvp/coop 的 P2 错开两行，防开局同排对冲秒死
    if (mode === 'coop') {
      const oppBody = [];
      for (let i = 0; i < INIT_LEN; i++) oppBody.push({ x: Math.floor(GW / 2), y: 3 - i });
      state.opp = mkSnake(oppBody, { x: 0, y: 1 }, 'ai');
      const p2Body = [];
      for (let i = 0; i < INIT_LEN; i++) p2Body.push({ x: (GW - 5) + i, y: Math.min(GH - 2, py + 2) });
      state.p2 = mkSnake(p2Body, { x: -1, y: 0 }, 'p2');
    } else if (mode === 'pvp') {
      const oppBody = [];
      for (let i = 0; i < INIT_LEN; i++) oppBody.push({ x: (GW - 5) + i, y: Math.min(GH - 2, py + 2) });
      state.opp = mkSnake(oppBody, { x: -1, y: 0 }, 'p2');
    } else {
      const oppBody = [];
      for (let i = 0; i < INIT_LEN; i++) oppBody.push({ x: (GW - 5) + i, y: py });
      state.opp = mkSnake(oppBody, { x: -1, y: 0 }, mode === 'pvp' ? 'p2' : 'ai');
    }
    if (wallBtn) wallBtn.classList.toggle('on', state.flags.wall);
    if (safeBtn) safeBtn.classList.toggle('on', state.flags.safe);
    behavior = { current: null, until: 0, stepLeft: 0, cooldowns: {}, targetFood: null, speedUp: false, speedUpUntil: 0 };
    particles = []; floaters = [];
    if (canvas) canvas.classList.remove('snk-die', 'snk-die-red');   // 清上一局死亡反馈
    maintainFood();
  }

  function startGame(diff) {
    if (!panel || panel.hidden) return;
    stopLoop();
    paused = false;
    if (pauseBtn) pauseBtn.textContent = '⏸';
    if (startBtn) { startBtn.hidden = true; startBtn.textContent = '开始'; }
    if (restartBtn) restartBtn.hidden = true;
    if (resumeBtn) resumeBtn.hidden = true;
    if (resultEl) { resultEl.hidden = true; resultEl.innerHTML = ''; }
    newGame(diff);
    refitAll();     // 结算块/开始按钮收起后腾出的空间收归画布（不改格数）
    let n = 3;
    state.status = 'countdown';
    const countdownStep = function () {
      if (!state || state.status !== 'countdown') return;
      if (n > 0) {
        if (hintEl) hintEl.textContent = '准备 · ' + n;
        n--;
        countdownTimer = setTimeout(countdownStep, 700);
      } else {
        if (hintEl) hintEl.textContent = curMode() === 'duo' ? '滑动 / 方向键控制 · 别撞墙' : modeHint();
        state.status = 'playing';
        state.startTime = Date.now();
        startFrame();
      }
    };
    countdownStep();
  }

  // ---- rAF 主循环：累积时间步进 + 插值渲染 ----
  function startFrame() {
    stopFrame();
    lastFrameTime = 0;
    acc = 0;
    snapshotPrev();
    rafId = requestAnimationFrame(frame);
  }
  function stopFrame() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }
  function cloneBody(b) {
    const out = [];
    for (let i = 0; i < b.length; i++) out.push({ x: b[i].x, y: b[i].y });
    return out;
  }
  // 每条蛇步进前的位置快照 = 本步插值起点（渲染层用，不入存档）
  function snapshotPrev() {
    if (!state) return;
    activeSnakes().forEach(function (s) { s._prev = cloneBody(s.body); });
    prevPlayerBody = state.player._prev;
    prevOppBody = state.opp._prev;
  }
  function frame(now) {
    if (!state || state.status !== 'playing') { rafId = null; return; }
    if (!lastFrameTime) lastFrameTime = now;
    // FIX 2026-09-16：切后台回来 rAF 停发、dt 累积成数十秒，guard=3 只限每帧步数不限总量，
    // 蛇会以数十倍速狂奔到撞死——dt 钳到 250ms，后台多久回来都只补一帧的量。
    const dt = Math.min(now - lastFrameTime, 250);
    lastFrameTime = now;
    acc += dt;
    const ti = currentTickInterval();
    // 防止卡顿后追赶过多（如切后台回来），最多补 3 步
    let guard = 3;
    while (acc >= ti && guard > 0) {
      acc -= ti;
      // 保存 step 前位置作为本步插值起点
      snapshotPrev();
      step();
      guard--;
      if (state.status !== 'playing') break;
    }
    if (state.status === 'playing') {
      const curTi = currentTickInterval();
      const alpha = Math.min(1, acc / curTi);
      render(alpha);
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = null;
    }
  }

  function currentTickInterval() {
    const t = state.elapsed;
    const ticks = (DIFFS[state.diff || 'normal'] || DIFFS.normal).ticks;
    let base;
    if (t < 30000) base = ticks[0];
    else if (t < 60000) base = ticks[1];
    else if (t < 90000) base = ticks[2];
    else base = ticks[3];
    if (behavior && behavior.speedUp) base = Math.max(60, base - 35);
    return base;
  }

  function spawnParticles(pos, color) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 0.03 + Math.random() * 0.03;
      particles.push({ x: pos.x + 0.5, y: pos.y + 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 380, maxLife: 380, color: color });
    }
    floaters.push({ x: pos.x + 0.5, y: pos.y + 0.3, text: '+10', life: 700, maxLife: 700 });
  }

  function step() {
    if (!state || state.status !== 'playing') return;
    state.elapsed = Date.now() - state.startTime;
    const snakes = activeSnakes();
    snakes.forEach(function (s) {
      if (s.ctrl === 'ai') aiDecide(s);   // 与旧双蛇版同序：先决策后应用（决策当 tick 生效，晚一步会撞上人类蛇刚占住的格子）
      applyDir(s);
    });
    const moves = resolveCollisions();
    moves.forEach(function (m) {
      const s = m.s;
      if (!m.die) {
        s.body.unshift(m.n);
        if (m.eat) {
          eatFood(m.n); s.score += 10; s.foodCount++; s.eatT = performance.now();
          spawnParticles(m.n, snakeSkin(s)[0]);
          if (s === state.player) { SFX.eat(); vib(12); }
          else if (s.ctrl === 'p2') { SFX.eat(); }
        } else s.body.pop();
      } else {
        s.alive = false;
        if (s === state.player) { SFX.hit(); vib([20, 40, 20]); }
      }
    });
    const ti = currentTickInterval();
    moves.forEach(function (m) { if (!m.die) m.s.score += ti / 1000; });
    checkEnd();
  }

  function applyDir(snake) {
    // #221 每步只消费队列头一格：nextDir 生效后 nextDir2 顶上来，本 tick 给的第二个
    // 转向留给下一个 tick 执行（两个紧凑输入=两步各转一次，不再互相覆盖）。
    const q = snake.nextDir;
    if (q) { snake.nextDir = snake.nextDir2 || null; snake.nextDir2 = null; }
    if (q && (q.x !== -snake.dir.x || q.y !== -snake.dir.y)) snake.dir = q;
  }

  function bodySet(body, dropTail) {
    const s = {};
    const end = dropTail ? body.length - 1 : body.length;
    for (let i = 0; i < end; i++) s[body[i].x + ',' + body[i].y] = true;
    return s;
  }

  // 统一碰撞结算（N 条蛇公平同判）：墙外/自身/互撞/头对头，语义与旧双蛇版一致
  function resolveCollisions() {
    const snakes = activeSnakes();
    const wall = state.flags && state.flags.wall;
    const safe = state.flags && state.flags.safe;
    const moves = snakes.map(function (s) {
      const h = s.body[0];
      let n = { x: h.x + s.dir.x, y: h.y + s.dir.y };
      if (wall) { n.x = (n.x + gW()) % gW(); n.y = (n.y + gH()) % gH(); }
      const eat = state.foods.some(function (f) { return f.x === n.x && f.y === n.y; });
      return { s: s, n: n, eat: eat, die: false };
    });
    const selfSets = moves.map(function (m) { return bodySet(m.s.body, !m.eat); });
    if (!wall) {
      moves.forEach(function (m) {
        if (m.n.x < 0 || m.n.x >= gW() || m.n.y < 0 || m.n.y >= gH()) m.die = true;
      });
    }
    for (let i = 0; i < moves.length; i++) {
      if (!moves[i].die && !safe && selfSets[i][moves[i].n.x + ',' + moves[i].n.y]) moves[i].die = true; // 碰自己身（安全模式跳过）
      for (let j = 0; j < moves.length; j++) {
        if (i === j) continue;
        if (moves[i].n.x === moves[j].n.x && moves[i].n.y === moves[j].n.y) { moves[i].die = true; moves[j].die = true; } // 头对头
        else if (!moves[i].die && selfSets[j][moves[i].n.x + ',' + moves[i].n.y]) moves[i].die = true; // 碰对方身
      }
    }
    return moves;
  }

  function spawnFood() {
    const occ = {};
    activeSnakes().forEach(function (s) { s.body.forEach(function (p) { occ[p.x + ',' + p.y] = true; }); });
    state.foods.forEach(function (f) { occ[f.x + ',' + f.y] = true; });
    const empty = [];
    for (let x = 0; x < gW(); x++) for (let y = 0; y < gH(); y++) if (!occ[x + ',' + y]) empty.push({ x: x, y: y });
    if (!empty.length) return null;
    return empty[Math.floor(Math.random() * empty.length)];
  }
  function maintainFood() {
    while (state.foods.length < foodTargetN()) {
      const f = spawnFood();
      if (!f) break;
      state.foods.push(f);
    }
  }
  function eatFood(pos) {
    for (let i = state.foods.length - 1; i >= 0; i--) {
      if (state.foods[i].x === pos.x && state.foods[i].y === pos.y) { state.foods.splice(i, 1); break; }
    }
    maintainFood();
  }

  // ---- TA 行为池 AI（通用化：target 可为任一人类蛇；候选过滤查所有其他蛇身）----
  function aiDecide(o) {
    if (!o.alive) return;
    behaviorTick();
    const head = o.body[0];
    const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    const humans = humanSnakes();
    const wall = state.flags && state.flags.wall;
    // 预判人类下一格（头对头规避）：取最近的 P1
    const p1 = state.player;
    const pNew = { x: p1.body[0].x + p1.dir.x, y: p1.body[0].y + p1.dir.y };
    if (wall) { pNew.x = (pNew.x + gW()) % gW(); pNew.y = (pNew.y + gH()) % gH(); }
    const candidates = [];
    dirs.forEach(function (d) {
      if (d.x === -o.dir.x && d.y === -o.dir.y) return;
      let nx = head.x + d.x, ny = head.y + d.y;
      if (wall) { nx = (nx + gW()) % gW(); ny = (ny + gH()) % gH(); }
      else if (nx < 0 || nx >= gW() || ny < 0 || ny >= gH()) return;
      const eat = state.foods.some(function (f) { return f.x === nx && f.y === ny; });
      for (let i = 0; i < o.body.length - (eat ? 0 : 1); i++) if (o.body[i].x === nx && o.body[i].y === ny) return;
      let blocked = false;
      humans.forEach(function (h) {
        const lim = h.body.length - 1;   // 人类蛇尾尖本 tick 会移走（不吃了尾也算），与旧双蛇判定一致
        for (let i = 0; i < lim; i++) if (h.body[i].x === nx && h.body[i].y === ny) blocked = true;
      });
      if (blocked) return;
      if (nx === pNew.x && ny === pNew.y) return;
      candidates.push(d);
    });
    if (!candidates.length) { o.nextDir = { x: o.dir.x, y: o.dir.y }; return; }
    const target = currentTarget();
    // 占位表每 tick 建一次复用：蛇身在本次决策内不会移动，原实现每个候选方向都全蛇重扫一遍（4 次/step）
    const blocked = {};
    activeSnakes().forEach(function (s) { s.body.forEach(function (p) { blocked[p.x + ',' + p.y] = true; }); });
    const scored = candidates.map(function (d) { return { d: d, score: scoreDirection(d, target, head, o, blocked) }; });
    scored.sort(function (a, b) { return b.score - a.score; });
    let chosen;
    if ((behavior.current === 'randomTurn' || behavior.current === 'detour') && scored.length >= 2) {
      chosen = scored[1].d;
    } else {
      chosen = scored[0].d;
    }
    o.nextDir = chosen;
  }

  function scoreDirection(d, target, head, o, blocked) {
    const nx = head.x + d.x, ny = head.y + d.y;
    let score = 0;
    if (target) {
      const dist = Math.abs(nx - target.x) + Math.abs(ny - target.y);
      const w = behavior.speedUp ? 4 : 2;
      score += (gW() + gH() - dist) * w;
    }
    score += floodFillSize(nx, ny, blocked) * 0.6;
    for (let i = 1; i < o.body.length; i++) {
      const s = o.body[i];
      const dd = Math.abs(nx - s.x) + Math.abs(ny - s.y);
      if (dd <= 1) score -= 8;
    }
    // 对最近人类蛇的趋避（coop 两条人类都算）
    let nearest = Infinity;
    humanSnakes().forEach(function (h) {
      const pd = Math.abs(nx - h.body[0].x) + Math.abs(ny - h.body[0].y);
      if (pd < nearest) nearest = pd;
    });
    if (nearest === Infinity) return score;
    if (behavior.current === 'avoidPlayer') score -= (12 - nearest) * 3;
    else if (behavior.current === 'chasePlayer') score += (12 - nearest) * 2;
    return score;
  }

  function floodFillSize(sx, sy, blocked) {
    const visited = {};
    const q = [[sx, sy]];
    visited[sx + ',' + sy] = true;
    let count = 0;
    while (q.length && count < 100) {
      const cur = q.shift();
      count++;
      const adj = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (let i = 0; i < 4; i++) {
        const nx = cur[0] + adj[i][0], ny = cur[1] + adj[i][1], k = nx + ',' + ny;
        if (nx < 0 || nx >= gW() || ny < 0 || ny >= gH()) continue;
        if (visited[k] || blocked[k]) continue;
        visited[k] = true; q.push([nx, ny]);
      }
    }
    return count;
  }

  function currentTarget() {
    const o = state.opp;
    if (behavior.current === 'chasePlayer') return state.player.body[0];
    if (behavior.current === 'pause') return null;
    const foods = state.foods;
    if (!foods.length) return null;
    if (behavior.targetFood) {
      const t = foods.find(function (f) { return f.x === behavior.targetFood.x && f.y === behavior.targetFood.y; });
      if (t) return t;
    }
    const h = o.body[0];
    let best = foods[0], bd = Infinity;
    foods.forEach(function (f) { const d = Math.abs(f.x - h.x) + Math.abs(f.y - h.y); if (d < bd) { bd = d; best = f; } });
    return best;
  }

  function behaviorTick() {
    const now = state.elapsed;
    if (behavior.current) {
      if (behavior.stepLeft > 0) behavior.stepLeft--;
      else if (behavior.until > 0 && now < behavior.until) { }
      else clearBehavior();
    }
    if (behavior.speedUp && now >= behavior.speedUpUntil) behavior.speedUp = false;
    if (!behavior.current) {
      const names = Object.keys(BEHAVIORS);
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const cfg = BEHAVIORS[name];
        if (now < (behavior.cooldowns[name] || 0)) continue;
        if (!behaviorCondition(name)) continue;
        if (Math.random() < cfg.prob) { triggerBehavior(name, now); break; }
      }
    }
  }

  function clearBehavior() { behavior.current = null; behavior.until = 0; behavior.stepLeft = 0; }

  function behaviorCondition(name) {
    const o = state.opp, p = state.player;
    const oh = o.body[0], ph = p.body[0];
    const pd = Math.abs(oh.x - ph.x) + Math.abs(oh.y - ph.y);
    if (name === 'randomTurn' || name === 'detour') return true;
    if (name === 'changeTarget') return state.foods.length >= 2;
    if (name === 'contestFood') {
      return state.foods.some(function (f) {
        const od = Math.abs(f.x - oh.x) + Math.abs(f.y - oh.y);
        const ppd = Math.abs(f.x - ph.x) + Math.abs(f.y - ph.y);
        return od <= 5 && ppd <= 5;
      });
    }
    if (name === 'giveUpContest') return behavior.targetFood != null;
    if (name === 'chasePlayer') return pd <= 8;
    if (name === 'avoidPlayer') return pd <= 4;
    if (name === 'speedUp') return true;
    if (name === 'pause') return true;
    return false;
  }

  function triggerBehavior(name, now) {
    behavior.current = name;
    behavior.cooldowns[name] = now + BEHAVIORS[name].cd;
    if (name === 'randomTurn') behavior.stepLeft = 1 + Math.floor(Math.random() * 3);
    else if (name === 'detour') behavior.stepLeft = 2 + Math.floor(Math.random() * 4);
    else if (name === 'avoidPlayer') behavior.stepLeft = 1 + Math.floor(Math.random() * 3);
    else if (name === 'chasePlayer') behavior.until = now + 2000 + Math.floor(Math.random() * 2000);
    else if (name === 'speedUp') { behavior.speedUp = true; behavior.speedUpUntil = now + 2000 + Math.floor(Math.random() * 1000); behavior.until = behavior.speedUpUntil; }
    else if (name === 'pause') behavior.until = now + 500 + Math.floor(Math.random() * 500);
    else if (name === 'changeTarget') { behavior.until = now + 8000; switchTargetFood(); }
    else if (name === 'contestFood') { behavior.until = now + 6000; setContestFood(); }
    else if (name === 'giveUpContest') { behavior.targetFood = null; behavior.until = now + 200; }
  }

  function switchTargetFood() {
    const foods = state.foods;
    if (foods.length < 2) return;
    const h = state.opp.body[0];
    let best = null, bd = Infinity;
    foods.forEach(function (f) {
      if (behavior.targetFood && f.x === behavior.targetFood.x && f.y === behavior.targetFood.y) return;
      const d = Math.abs(f.x - h.x) + Math.abs(f.y - h.y);
      if (d < bd) { bd = d; best = f; }
    });
    if (best) behavior.targetFood = best;
  }

  function setContestFood() {
    const o = state.opp, p = state.player;
    const oh = o.body[0], ph = p.body[0];
    let best = null, bestSum = Infinity;
    state.foods.forEach(function (f) {
      const od = Math.abs(f.x - oh.x) + Math.abs(f.y - oh.y);
      const ppd = Math.abs(f.x - ph.x) + Math.abs(f.y - ph.y);
      if (od <= 5 && ppd <= 5 && od + ppd < bestSum) { bestSum = od + ppd; best = f; }
    });
    if (best) behavior.targetFood = best;
  }

  function checkEnd() {
    const anyDead = activeSnakes().some(function (s) { return !s.alive; });
    if (anyDead) { endGame(); return true; }
    return false;
  }

  // 胜负：撞死的一方输（#604 起）。对局以「任一蛇撞死」收局（checkEnd），撞死=出局这条直觉
  // 优先于分数：原口径「谁分高谁赢」在我方撞死、分数却高于对方时弹「你赢了」（用户报
  // 「我输了显示我赢」，任何机型浏览器必现）。现在按存活判：我死 TA 活=负 / TA 死我活=胜 /
  // 同 tick 一起撞死（头对头）=平；pvp 是 P1 vs P2，coop 是 P1+P2 队伍 vs TA（队友死=队伍输）。
  // 分数只作展示（结算页仍列出），不再决定胜负；两侧都活着（非死亡收局，正常走不到）才退回比分数。
  function endGame() {
    if (!state) return;
    state.status = 'over';
    stopFrame();
    // 最后一帧是 step 前的插值中间态（frame 里 step 后 status 已离开 playing 就不再 render），
    // 收局后补一次整格对齐渲染，冻结画面才能停在真正的死亡位置。
    render(0);
    clearSaved();
    const mode = state.mode || 'duo';
    const psFinal = Math.floor(state.player.score);
    const osFinal = Math.floor(state.opp.score);
    const p2Final = state.p2 ? Math.floor(state.p2.score) : 0;
    const teamFinal = psFinal + (mode === 'coop' ? p2Final : 0);
    const myAlive = !!state.player.alive && !(state.p2 && !state.p2.alive);   // coop：队友死=我方输
    const oppAlive = !!state.opp.alive;
    let result;
    if (!myAlive && oppAlive) result = 'lose';
    else if (myAlive && !oppAlive) result = 'win';
    else if (!myAlive && !oppAlive) result = 'draw';
    else result = (mode === 'coop' ? teamFinal : psFinal) > osFinal ? 'win' : (mode === 'coop' ? teamFinal : psFinal) < osFinal ? 'lose' : 'draw';
    if (result === 'win') SFX.win();
    const d = {
      result: result,
      mode: mode,
      pLen: state.player.body.length,
      oLen: state.opp.body.length,
      pFood: state.player.foodCount,
      oFood: state.opp.foodCount,
      pScore: mode === 'coop' ? teamFinal : psFinal,
      oScore: osFinal,
      p2Score: p2Final,
      time: Math.floor(state.elapsed / 1000)
    };
    const s = readScore();
    if (result === 'win') s.w++; else if (result === 'lose') s.l++; else s.d++;
    writeScore(s);
    // FIX 2026-09-16：接游乐室三件套——幸运日打卡 + 胜利 8% 掉限定摆件（此前 snake 完全不在体系内，
    // 「游戏体验官」徽章经此游戏永远打不上卡；奖励 ×2 在 chat.js sendSnakeResult 发放处接 arcadeMult）
    try {
      if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('snake');
      if (result === 'win' && window.arcadeTryDrop) { const dp = window.arcadeTryDrop('snake'); if (dp) d.drop = dp; }
    } catch (e) {}
    updateBest(result);
    renderScore();
    renderBest();
    // 死亡瞬间先演再结算（#341 五子棋「结果浮层延迟弹出」同款）：冻结的最后一帧画布用
    // CSS 类抖动（我方死加红光外晕），约 700ms 后再弹结算浮层；分数落盘/聊天分享不延迟，
    // 数据照旧先落。700ms 内重开/换局（state 换新或 status 离开 over）则放弃弹层。
    try {
      canvas.classList.remove('snk-die', 'snk-die-red');
      void canvas.offsetWidth;
      canvas.classList.add('snk-die');
      if (!state.player.alive) canvas.classList.add('snk-die-red');
    } catch (e) {}
    if (window.sendSnakeResult) window.sendSnakeResult(d);
    const _endState = state;
    setTimeout(function () {
      if (state !== _endState || _endState.status !== 'over') return;
      showResult(d);
    }, 700);
  }

  function showResult(d) {
    if (!resultEl) return;
    const icon = d.result === 'win' ? '🏆' : d.result === 'lose' ? '💔' : '🤝';
    const taName = window.taFit ? window.taFit('TA') : 'TA';
    let resTxt, rows;
    if (d.mode === 'pvp') {
      resTxt = d.result === 'win' ? 'P1 赢了' : d.result === 'lose' ? 'P2 赢了' : '平局';
      rows = '<div class="snake-res-row"><span>🟢 P1</span><span>长度 ' + d.pLen + ' · 食物 ' + d.pFood + ' · ' + psOf(d) + '分</span></div>' +
        '<div class="snake-res-row"><span>🟠 P2</span><span>长度 ' + d.oLen + ' · 食物 ' + d.oFood + ' · ' + d.oScore + '分</span></div>';
    } else if (d.mode === 'coop') {
      resTxt = d.result === 'win' ? '组队获胜' : d.result === 'lose' ? taName + ' 赢了' : '平局';
      rows = '<div class="snake-res-row"><span>👥 队伍 (P1+P2)</span><span>' + psOf(d) + ' 分</span></div>' +
        '<div class="snake-res-row"><span>🤖 ' + taName + '</span><span>长度 ' + d.oLen + ' · 食物 ' + d.oFood + ' · ' + d.oScore + '分</span></div>';
    } else {
      resTxt = d.result === 'win' ? '你赢了' : d.result === 'lose' ? (window.taFit ? window.taFit('TA 赢了') : 'TA 赢了') : '平局';
      rows = '<div class="snake-res-row"><span>🐍 你</span><span>长度 ' + d.pLen + ' · 食物 ' + d.pFood + ' · ' + psOf(d) + '分</span></div>' +
        '<div class="snake-res-row"><span>🤖 ' + taName + '</span><span>长度 ' + d.oLen + ' · 食物 ' + d.oFood + ' · ' + d.oScore + '分</span></div>';
    }
    if (d.drop) rows += '<div class="snake-res-row"><span>🎁</span><span>掉落限定摆件「' + d.drop.name + '」</span></div>';
    resultEl.innerHTML = '<div class="snake-res-icon">' + icon + '</div>' +
      '<div class="snake-res-title">' + resTxt + '</div>' + rows +
      '<div class="snake-res-time">存活 ' + d.time + ' 秒 · 已分享到聊天 ✓</div>';
    resultEl.hidden = false;
    resultEl.classList.remove('snake-res-pop');
    void resultEl.offsetWidth;
    resultEl.classList.add('snake-res-pop');
    if (restartBtn) restartBtn.hidden = false;
    if (hintEl) hintEl.textContent = '再来一局？';
    refitAll();     // 结算块+再来一局出现后收小画布：半框让方向键一屏可见，全屏防「再来一局」被裁到屏外
  }
  function psOf(d) { return d.pScore; }

  // FIX 2026-09-16：背景网格预渲染到离屏 canvas（全屏 34×46 每帧约 80 次 stroke 是稳定的每帧开销），
  // 尺寸/DPR/明暗/格数任一变化才重建一次，其余帧只 drawImage。
  let gridCv = null, gridKey = '';
  function drawBackground() {
    const dark = themeDark();
    const key = cssW + 'x' + cssH + ':' + dpr + ':' + gW() + 'x' + gH() + ':' + (dark ? 'd' : 'l');
    if (!gridCv || gridKey !== key) {
      gridCv = document.createElement('canvas');
      gridCv.width = Math.max(1, Math.round(cssW * dpr));
      gridCv.height = Math.max(1, Math.round(cssH * dpr));
      const g = gridCv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = cssW, H = cssH;
      g.fillStyle = dark ? '#1b1b22' : '#f6f6f8';
      g.fillRect(0, 0, W, H);
      const cw = W / gW(), ch = H / gH();
      g.strokeStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
      g.lineWidth = 1;
      for (let i = 1; i < gW(); i++) { g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, H); g.stroke(); }
      for (let j = 1; j < gH(); j++) { g.beginPath(); g.moveTo(0, j * ch); g.lineTo(W, j * ch); g.stroke(); }
      gridKey = key;
    }
    ctx.drawImage(gridCv, 0, 0, cssW, cssH);
  }

  function render(alpha) {
    if (!ctx || !state) return;
    if (alpha == null) alpha = 0;
    const W = cssW, H = cssH;
    const cw = W / gW(), ch = H / gH(), cs = Math.min(cw, ch);
    const now = performance.now();
    const dt = renderLastTime ? Math.min(50, now - renderLastTime) : 16;
    renderLastTime = now;
    const dark = themeDark();
    drawBackground();
    // 食物：苹果（呼吸脉动 + 高光 + 叶子）
    const pulse = 1 + 0.12 * Math.sin(now / 220);
    state.foods.forEach(function (f, fi) {
      const fx = f.x * cw + cw / 2, fy = f.y * ch + ch / 2;
      const r = cs * 0.32 * (1 + 0.12 * Math.sin(now / 220 + fi * 1.3));
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath(); ctx.arc(fx, fy + r * 0.08, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(fx - r * 0.35, fy - r * 0.3, r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#34c759';
      ctx.beginPath();
      ctx.ellipse(fx + r * 0.3, fy - r * 1.05 * pulse + r * 0.4, r * 0.34, r * 0.16, -0.6, 0, Math.PI * 2);
      ctx.fill();
    });
    activeSnakes().forEach(function (s) {
      const skin = snakeSkin(s);
      drawSnake(s, alpha, skin[0], skin[1]);
    });
    // 粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt / 16; p.y += p.vy * dt / 16;
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * cw, p.y * ch, cs * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 飘字 +10
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      if (f.life <= 0) { floaters.splice(i, 1); continue; }
      f.y -= dt / 280;
      ctx.globalAlpha = Math.min(1, f.life / 300);
      ctx.fillStyle = dark ? '#ff8a8a' : '#ff6b6b';
      ctx.font = 'bold ' + Math.floor(cs * 0.72) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.text, f.x * cw, f.y * ch);
    }
    ctx.globalAlpha = 1;
  }
  // 蛇渲染：粗线段连续身体（穿墙断开）+ 顺滑高光 + 朝向眼睛 + 吃到食物的头部弹跳
  function drawSnake(snake, alpha, headColor, bodyColor) {
    if (!snake.body.length) return;
    const cw = cssW / gW(), ch = cssH / gH(), cs = Math.min(cw, ch);
    const dead = !snake.alive;
    const dark = themeDark();
    // FIX 2026-09-16 #604：死亡不再把整条蛇刷成中性灰（原先 dead 时头身统一换成灰）——
    // 收局后画布停在冻结的最后一帧，灰化让场上颜色与结算页的 🟢P1 / 🟠P2（pvp）对不上，
    // 两条蛇一起撞死时更是两条全灰（用户报「对局结束时两只蛇的颜色不对」）。
    // 保留本蛇配色，死亡改由 × 眼 + 画布 snk-die 抖动/红晕（#352）表达，冻结帧仍认得出谁是谁。
    const bodyC = bodyColor;
    const headC = headColor;
    const prevBody = snake._prev || null;   // 步进前快照（snapshotPrev 统一维护）
    const interp = !dead && prevBody && alpha > 0 && alpha < 1;
    const pts = [];
    for (let i = 0; i < snake.body.length; i++) {
      const s = snake.body[i];
      let x = s.x, y = s.y;
      // 穿墙跨边界的格不做线性插值：14→0 会在屏上整条"倒车"滑回去，直接落新格
      if (interp && prevBody[i] && Math.abs(s.x - prevBody[i].x) <= 1 && Math.abs(s.y - prevBody[i].y) <= 1) {
        x = prevBody[i].x + (s.x - prevBody[i].x) * alpha;
        y = prevBody[i].y + (s.y - prevBody[i].y) * alpha;
      }
      pts.push({ x: x * cw + cw / 2, y: y * ch + ch / 2 });
    }
    // 身体：粗线段连续绘制（圆角端），穿墙跨边界时断开
    if (pts.length >= 2) {
      ctx.strokeStyle = bodyC;
      ctx.lineWidth = cs * 0.82;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[1].x, pts[1].y);
      for (let i = 2; i < pts.length; i++) {
        const ddx = pts[i].x - pts[i - 1].x, ddy = pts[i].y - pts[i - 1].y;
        if (Math.abs(ddx) > cw * 2 || Math.abs(ddy) > ch * 2) {
          ctx.stroke(); ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y);
        } else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      // 顺滑高光：沿身体中线叠一条浅色细线（暗色环境降透明度）
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = cs * 0.26;
      ctx.beginPath();
      ctx.moveTo(pts[1].x, pts[1].y - cs * 0.14);
      let broken = false;
      for (let i = 2; i < pts.length; i++) {
        const ddx = pts[i].x - pts[i - 1].x, ddy = pts[i].y - pts[i - 1].y;
        if (Math.abs(ddx) > cw * 2 || Math.abs(ddy) > ch * 2) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y - cs * 0.14); broken = true; continue; }
        ctx.lineTo(pts[i].x, pts[i].y - cs * 0.14);
      }
      ctx.stroke();
    }
    // 头：稍大圆 + 吃到食物时的弹跳 + 高光
    let hr = cs * 0.46;
    if (snake.eatT) {
      const k = 1 - (now0() - snake.eatT) / 200;
      if (k > 0) hr *= 1 + 0.28 * k; else snake.eatT = 0;
    }
    ctx.fillStyle = headC;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, hr, 0, Math.PI * 2);
    ctx.fill();
    if (!dead) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(pts[0].x - cs * 0.13, pts[0].y - cs * 0.13, cs * 0.15, 0, Math.PI * 2);
      ctx.fill();
      // 朝向眼睛：白眼球 + 前置瞳孔，随 dir 转动
      const d = snake.dir;
      const px = -d.y, py = d.x;   // 垂直方向
      const fwx = d.x * cs * 0.14, fwy = d.y * cs * 0.14;
      for (let side = -1; side <= 1; side += 2) {
        const ex = pts[0].x + px * side * cs * 0.19 + fwx;
        const ey = pts[0].y + py * side * cs * 0.19 + fwy;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex, ey, cs * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#151515';
        ctx.beginPath(); ctx.arc(ex + fwx * 0.5, ey + fwy * 0.5, cs * 0.065, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // 死亡：× 眼
      ctx.strokeStyle = dark ? '#888' : '#666';
      ctx.lineWidth = Math.max(1, cs * 0.06);
      const e = cs * 0.12;
      [[-0.18, -0.18], [0.18, -0.18]].forEach(function (off) {
        const ex = pts[0].x + off[0] * cs, ey = pts[0].y + off[1] * cs;
        ctx.beginPath();
        ctx.moveTo(ex - e, ey - e); ctx.lineTo(ex + e, ey + e);
        ctx.moveTo(ex + e, ey - e); ctx.lineTo(ex - e, ey + e);
        ctx.stroke();
      });
    }
  }
  function now0() { return performance.now(); }

  // ---- 暂停 / 继续 ----
  function togglePause() {
    if (!state) return;
    if (state.status === 'playing') {
      state.status = 'paused';
      stopFrame();
      pauseAt = Date.now();
      if (pauseBtn) pauseBtn.textContent = '▶';
      if (hintEl) hintEl.textContent = '已暂停 · 点 ▶ 继续';
      render(0); // 暂停时对齐到整格位置
    } else if (state.status === 'paused') {
      state.status = 'playing';
      state.startTime += Date.now() - pauseAt;
      if (pauseBtn) pauseBtn.textContent = '⏸';
      if (hintEl) hintEl.textContent = curMode() === 'duo' ? '滑动 / 方向键控制 · 别撞墙' : modeHint();
      startFrame();
    }
  }

  // ---- 全屏（面板占满视口，canvas 放大） ----
  function toggleFs() {
    isFs = !isFs;
    if (panel) {
      panel.classList.toggle('snake-fs', isFs);
      // 入场/退场过渡：轻微缩放淡入，收敛「瞬间跳变」的生硬感
      panel.classList.remove('snake-fs-in');
      if (isFs) { void panel.offsetWidth; panel.classList.add('snake-fs-in'); }
    }
    if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
    setupCanvas();
    render(0);
  }

  // ---- 保存 / 恢复对局 ----
  function canSave(s) { return s && s.status === 'playing'; }
  function stripPrev(s) {
    const c = s;   // 浅拷贝去渲染层字段（_prev 不入存档）
    const out = {};
    Object.keys(c).forEach(function (k) { if (k !== '_prev') out[k] = c[k]; });
    return out;
  }
  function saveGame() {
    try {
      if (!canSave(state)) { localStorage.removeItem(keySaved()); return; }
      const cp = Object.assign({}, state);
      cp.player = stripPrev(state.player);
      cp.opp = stripPrev(state.opp);
      if (state.p2) cp.p2 = stripPrev(state.p2);
      localStorage.setItem(keySaved(), JSON.stringify(cp));
    } catch (e) {}
  }
  function validCoord(p, w, h) { return p && p.x >= 0 && p.x < w && p.y >= 0 && p.y < h; }
  function validSnake(s, w, h) {
    return s && s.body && Array.isArray(s.body) && s.body.length && s.body.every(function (p) { return validCoord(p, w, h); }) && s.dir;
  }
  function validState(s) {
    if (!s || !s.player || !s.opp) return false;
    // 存档自带地图尺寸（旧档无尺寸按 15×15），坐标必须落在该地图内
    const w = Math.max(10, Math.min(42, s.gw || 15));
    const h = Math.max(10, Math.min(48, s.gh || 15));
    s.gw = w; s.gh = h;
    if (!validSnake(s.player, w, h) || !validSnake(s.opp, w, h)) return false;
    if (s.foods && !s.foods.every(function (p) { return validCoord(p, w, h); })) return false;
    // 旧档（无 mode/p2）按经典双人对待；声称双人模式但缺 P2 蛇则降级，防恢复即崩溃
    if (s.mode === 'pvp' || s.mode === 'coop') {
      if (!validSnake(s.p2, w, h)) { s.mode = 'duo'; s.p2 = null; if (s.opp) s.opp.ctrl = 'ai'; }
    } else { s.mode = 'duo'; s.p2 = null; }
    return true;
  }
  function loadSaved() {
    try {
      const raw = lsGet(keySaved());
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.status !== 'playing') return null;
      if (!validState(s)) { clearSaved(); return null; }
      return s;
    } catch (e) { return null; }
  }
  function clearSaved() { try { localStorage.removeItem(keySaved()); } catch (e) {} }
  function resumeGame() {
    const s = loadSaved();
    if (!s) return false;
    state = s;
    if (!state.flags) state.flags = { wall: false, safe: false };
    if (wallBtn) wallBtn.classList.toggle('on', state.flags.wall);
    if (safeBtn) safeBtn.classList.toggle('on', state.flags.safe);
    if (state.mode === 'pvp' || state.mode === 'coop') { clearSaved(); resetToIdle(state.diff); if (hintEl) hintEl.textContent = '双人存档暂不跨局恢复 · 已回到待开局'; return true; }
    behavior = { current: null, until: 0, stepLeft: 0, cooldowns: {}, targetFood: null, speedUp: false, speedUpUntil: 0 };
    setupCanvas();   // 按存档自带地图尺寸重新适配画布（可能与当前视口推算尺寸不同）
    state.status = 'playing';
    state.startTime = Date.now() - state.elapsed;
    if (startBtn) { startBtn.hidden = true; startBtn.textContent = '开始'; }
    if (restartBtn) restartBtn.hidden = true;
    if (resumeBtn) resumeBtn.hidden = true;
    if (resultEl) { resultEl.hidden = true; resultEl.innerHTML = ''; }
    if (hintEl) hintEl.textContent = '滑动 / 方向键控制 · 别撞墙';
    paused = false;
    if (pauseBtn) pauseBtn.textContent = '⏸';
    render(0);
    startFrame();
    return true;
  }

  // ---- 面板开关 ----
  // 贪吃蛇打开时的默认形态：手机/平板一律全屏（占满视口、地图按屏幕放大更好玩），
  // 真桌面保持半框。判据与 device.js 的窗口级判定同源，不看单一 innerWidth——
  // 详见 openSnakePanel 里的 #604 说明（桌面版网站模式 / 手机横屏两族都栽在宽度上）。
  function wantFullscreenDefault() {
    try {
      const d = window.mochiDevice;
      if (d && (d.isMobile || d.isTablet)) return true;   // 全站唯一设备判定源
    } catch (e) {}
    try { if (document.documentElement.classList.contains('force-mobile')) return true; } catch (e) {}
    if (window.innerWidth < 900) return true;             // 兜底：device.js 未就绪/判定未出
    try {
      // 触摸设备（手机横屏等宽视口）：coarse + hover:none 才算——触摸笔记本带鼠标时
      // hover 为 hover，不受影响（桌面形态不变）
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches) return true;
    } catch (e) {}
    return false;
  }
  function openSnakePanel() {
    if (!panel) return;
    ['poke-card', 'emoji-panel', 'chat-ask-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel'].forEach(function (id) { const el = $(id); if (el) el.hidden = true; });
    if (window.closeAvlib) window.closeAvlib();
    const mp = $('chat-more-panel'); if (mp) mp.hidden = true;
    const nameEl = $('snake-partner-name');
    // FIX 2026-09-12 #349 标题名与全部其他游戏面板同链：activeStore 动态命名空间
    // （cs-lbl-partner || lbl-partner）——曾裸读加载时冻结的 PARTNER_KEY，切桌面后串名
    if (nameEl) {
      let pname = 'TA';
      try {
        const nst = window.activeStore && window.activeStore();
        pname = (nst && (nst.get('lbl-partner') || nst.get('cs-lbl-partner'))) || pname;
      } catch (e) {}
      nameEl.textContent = pname;
    }
    // 恢复上次偏好（模式 / 食物数量）
    if (modeSel) { const m = lsGet(keyMode()); if (m && MODES[m]) modeSel.value = m; }
    if (foodSel) { const fn = parseInt(lsGet(keyFoodN()), 10); if (fn >= 2 && fn <= 8) foodSel.value = String(fn); }
    // 先显示面板再切全屏：隐藏状态下量不到布局尺寸，setupCanvas 会拿到 0
    panel.hidden = false;
    renderScore();
    renderBest();   // 最长纪录行要先落到 DOM：toggleFs 会按当时可见的兄弟块量画布，晚一行就把按钮顶出屏
    // FIX 2026-09-16 #604：默认形态不再只看 window.innerWidth，改与 device.js 的全站设备
    // 判定同源。用户报「好多手机使用这个功能是迷你框，无法正常玩」——两种手机都栽在这条
    // 宽度判断上：①桌面版网站模式（Edge/Via 把 layout viewport 拉到 980，device.js 已用
    // html.force-mobile 兜底成手机形态，innerWidth 却仍是 980）；②手机横屏（视口 ≥900）。
    // 两者都判成「桌面」→ 面板停在半框，视口一矮 applyCell 自查把画布一路收到 6px 格子
    // 下限（实测 980×600 下 176px、横屏 932 下 90px）＝根本没法玩。
    // 手机/平板（含 force-mobile 兜底）或触摸设备一律默认全屏；真桌面（宽屏 + 精细指针）
    // 保持半框（原行为不变）。
    if (wantFullscreenDefault()) { if (!isFs) toggleFs(); }
    else if (isFs) toggleFs();
    paused = false;
    if (pauseBtn) pauseBtn.textContent = '⏸';
    if (canSave(state) && validState(state)) {
      state.status = 'playing';
      state.startTime = Date.now() - state.elapsed;
      setupCanvas();   // 恢复对局可能带自己的地图尺寸，重新适配画布
      if (startBtn) { startBtn.hidden = true; startBtn.textContent = '开始'; }
      if (restartBtn) restartBtn.hidden = true;
      if (resumeBtn) resumeBtn.hidden = true;
      if (resultEl) { resultEl.hidden = true; resultEl.innerHTML = ''; }
      if (hintEl) hintEl.textContent = '滑动 / 方向键控制 · 别撞墙';
      render(0);
      startFrame();
      return;
    }
    const saved = loadSaved();
    if (saved) {
      resetToIdle();
      if (hintEl) hintEl.textContent = '有未完成的对局';
      if (resumeBtn) resumeBtn.hidden = false;
      if (startBtn) { startBtn.hidden = false; startBtn.textContent = '重新开始'; }
    } else {
      resetToIdle();
    }
  }
  function resetToIdle(keepDiff) {
    stopLoop();
    if (keepDiff && diffSel) diffSel.value = keepDiff;
    newGame(diffSel ? diffSel.value : 'normal');
    state.status = 'idle';
    if (startBtn) { startBtn.hidden = false; startBtn.textContent = '开始'; }
    if (restartBtn) restartBtn.hidden = true;
    if (resumeBtn) resumeBtn.hidden = true;
    if (resultEl) { resultEl.hidden = true; resultEl.innerHTML = ''; }
    if (hintEl) hintEl.textContent = modeHint();
    refitAll();     // 最长纪录行/继续上局按钮显隐后再量一次，避免按钮被挤到屏外
    render(0);
  }
  function stopLoop() {
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    stopFrame();
  }
  function closeSnakePanel() {
    if (canSave(state)) saveGame(); else clearSaved();
    stopLoop();
    if (isFs) toggleFs();
    if (panel) panel.hidden = true;
  }

  window.openSnakePanel = openSnakePanel;
  window.closeSnakePanel = closeSnakePanel;
  // 只读调试口（tools 专项验证用：地图尺寸/对局状态/蛇身食物坐标）
  window.__snakeState = function () {
    if (!state) return null;
    return {
      status: state.status, diff: state.diff, mode: state.mode, gw: state.gw, gh: state.gh,
      foodTarget: state.foodTarget,
      running: !!(rafId || countdownTimer),
      player: { body: cloneBody(state.player.body), alive: state.player.alive, score: Math.floor(state.player.score),
        dir: { x: state.player.dir.x, y: state.player.dir.y },
        nextDir: state.player.nextDir ? { x: state.player.nextDir.x, y: state.player.nextDir.y } : null,
        nextDir2: state.player.nextDir2 ? { x: state.player.nextDir2.x, y: state.player.nextDir2.y } : null },
      p2: state.p2 ? { body: cloneBody(state.p2.body), alive: state.p2.alive, score: Math.floor(state.p2.score),
        dir: { x: state.p2.dir.x, y: state.p2.dir.y },
        nextDir: state.p2.nextDir ? { x: state.p2.nextDir.x, y: state.p2.nextDir.y } : null } : null,
      opp: { body: cloneBody(state.opp.body), alive: state.opp.alive, score: Math.floor(state.opp.score), ctrl: state.opp.ctrl,
        dir: { x: state.opp.dir.x, y: state.opp.dir.y },
        nextDir: state.opp.nextDir ? { x: state.opp.nextDir.x, y: state.opp.nextDir.y } : null },
      foods: state.foods.map(function (f) { return { x: f.x, y: f.y }; }),
      elapsed: state.elapsed
    };
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEls);
  else initEls();
})();

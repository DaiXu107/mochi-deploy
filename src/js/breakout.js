// ===== 功能：双人打砖块（聊天页更多功能 → 打砖块） =====
// 合作模式：玩家控制左侧挡板，梦角（TA）由代码控制右侧挡板，双方共同接球清砖。
// 球数量可设 1~3（头部选择框）：1=经典单球；2/3 球同时在场，掉一颗扣 1 命、
// 其余球不中断继续打，稍后按设定数量自动补发（改动在下次发球/补发时生效）。
// 不依赖聊天 AI。梦角 = 落点预测 + 反应间隔 + 移动速度限制 + 锁定式预测误差（每次下落掷一次）
// + 概率放水 + 难度分档 + 本局发挥状态（正常/较好/走神/特殊，开局掷定）。
// 字卡只作低概率反馈：场内 TA 泡泡（接球/险救/清层/丢球）+ 结束后写聊天记录与 TA 回应。
// 音效 Web Audio 生成短 beep，可静音。
(function () {
  const panel = document.getElementById('chat-brick-panel');
  if (!panel) return;
  const canvas = document.getElementById('brick-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('brick-score');
  const comboEl = document.getElementById('brick-combo');
  const livesEl = document.getElementById('brick-lives');
  const levelEl = document.getElementById('brick-level');
  const hintEl = document.getElementById('brick-hint');
  const overlayEl = document.getElementById('brick-overlay');
  const overlayTitleEl = document.getElementById('brick-overlay-title');
  const overlayBodyEl = document.getElementById('brick-overlay-body');
  const overlayBtnEl = document.getElementById('brick-overlay-btn');
  const overlayCloseBtn = document.getElementById('brick-overlay-close');
  const diffSel = document.getElementById('brick-diff');
  const ballsSel = document.getElementById('brick-balls');
  const soundBtn = document.getElementById('brick-sound');
  const pauseBtn = document.getElementById('brick-pause');
  const fsBtn = document.getElementById('brick-fs');
  const closeBtn = document.getElementById('chat-brick-close');
  const partnerNameEl = document.getElementById('brick-partner-name');
  const footNameEl = document.getElementById('brick-foot-name');

  // ---- 逻辑尺寸（物理计算用；Canvas 像素按 DPR 缩放，CSS 拉伸到容器宽） ----
  const W = 400, H = 340;
  const COLS = 8, ROWS = 4;            // 砖块 8 列 × 4 行
  const B_MARGIN = 10, B_GAP = 4, B_TOP = 28, B_H = 15;
  const B_W = (W - B_MARGIN * 2 - (COLS - 1) * B_GAP) / COLS;   // 44
  const PADDLE_W = 62, PADDLE_H = 8;
  const PADDLE_Y = H - 14;             // 挡板顶边 y
  const BALL_R = 5;
  const BALL_HOME_Y = (B_TOP + ROWS * (B_H + B_GAP) + PADDLE_Y) / 2;   // 发球点（砖区与挡板之间居中）
  const PLAYER_HOME_X = W * 0.75, DREAM_HOME_X = W * 0.25;   // 玩家右半场 / 梦角左半场（手机端右手操作更顺手）
  const clampPlayerX = (x) => clamp(x, W / 2 + PADDLE_W / 2, W - PADDLE_W / 2 - 4);
  const clampDreamX = (x) => clamp(x, PADDLE_W / 2 + 4, W / 2 - PADDLE_W / 2);
  const PLAYER_V = 7.2;                // 玩家挡板最大速度（px/tick）
  const FPS = 60;

  // ---- 难度参数（思考间隔 / 移动速度 / 预测误差幅度 / 放水概率） ----
  const DIFFS = {
    easy:   { think: [250, 430], maxV: 2.35, err: 30, fumble: 0.17 },
    normal: { think: [135, 240], maxV: 3.5,  err: 16, fumble: 0.08 },
    hard:   { think: [80, 160],  maxV: 4.8,  err: 8,  fumble: 0.03 }
  };

  // ---- 球数量设置（1~3；改动在下次发球/补发时生效，选择随联系人记忆） ----
  function targetBallCount() {
    const n = parseInt(ballsSel && ballsSel.value, 10);
    return n >= 1 && n <= 3 ? n : 1;
  }
  function ballsPrefKey() { return (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':brick-balls'; }

  // ---- 本局发挥：每局开始掷定一次，只对难度做小幅波动，不覆盖难度 ----
  function rollPerformance() {
    const r = Math.random();
    if (r < 0.02) {
      // 特殊发挥（2%）：二选一的明显临场变化，整局只出现一次
      return Math.random() < 0.5
        ? { kind: 'special', variant: 'hot', used: false }   // 一段「超神」10s：接近上一档的控制力
        : { kind: 'special', variant: 'slip', used: false }; // 一次「大走神」：某次来球必然偏出挡板
    }
    if (r < 0.10) return { kind: 'good' };                   // 状态较好：更稳更准
    if (r < 0.18) return { kind: 'dazed', nextLapseAt: 0 };  // 偶尔走神：周期性短暂反应停摆
    return { kind: 'normal' };
  }

  // ---- TA 场内泡泡文案池（低概率触发，全局冷却 + 分事件冷却） ----
  const SAY_POOLS = {
    catch: ['接到了。', '继续。', '还在。'],
    nearmiss: ['差一点。', '……', '看球。'],
    save: ['漂亮。', '接得好。'],
    clear: ['清完了。', '不错。', '继续？'],
    fail: ['没接住。', '可惜。', '再来。'],
    coop: ['我们配合得不错。'],
    streak: ['还挺顺的。']
  };
  const SAY_COOLDOWN = { catch: 22000, nearmiss: 15000, save: 26000, clear: 12000, fail: 14000, coop: 0, streak: 0 };

  // ---- 音效 ----
  let audioCtx = null, soundOn = true;
  function beep(freq, dur, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // FIX 2026-09-16：iOS 锁屏/来电后 ctx 挂起，不 resume 则此后音效永久哑音（connect-four 同款修法）
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'square';
      g.gain.value = vol || 0.15;   // v3.15.x：默认 0.05→0.15，用户反馈边听音乐边玩时音效听不清
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      o.start(t); g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.06));
      o.stop(t + (dur || 0.06));
    } catch (e) {}
  }
  // v3.15.x：音量整体调大（0.04~0.08 → 0.14~0.2）——用户反馈边听音乐边玩时音效听不清
  function sfxWall()   { beep(360, 0.04, 0.14); }
  function sfxPaddle() { beep(500, 0.05, 0.18); }
  function sfxBrick(hp){ beep(hp > 0 ? 300 : 640 + Math.random() * 120, hp > 0 ? 0.05 : 0.09, 0.18); }
  function sfxLose()   { beep(200, 0.22, 0.2); setTimeout(() => beep(150, 0.26, 0.2), 130); }
  function sfxClear()  { beep(620, 0.1, 0.2); setTimeout(() => beep(830, 0.14, 0.2), 110); }

  // ---- 工具 ----
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  // 三角分布噪声（-σ ~ σ，中间概率高）：预测误差用
  const tri = (sigma) => (Math.random() + Math.random() - 1) * sigma;
  // X 轴镜像折叠：直线外推后折回场地（左右墙反弹的解析式）
  function foldX(x) {
    const lo = BALL_R, span = W - BALL_R * 2;
    let m = ((x - lo) % (2 * span) + 2 * span) % (2 * span);
    return m > span ? (2 * span - m) + lo : m + lo;
  }
  const taName = () => (window.taWord ? window.taWord() : 'TA');
  const T = (x) => (window.taFit ? window.taFit(x) : x);

  // ---- 视觉资源：砖块行渐变色（情侣色阶 粉→紫→蓝→青，[亮顶,暗底]）+ 静态星点 ----
  const ROW_COLORS = [['#ffb3c6', '#ff5f7a'], ['#cbb2ff', '#9d6bff'], ['#96c7ff', '#4a86e8'], ['#79e6cd', '#2fbf9d']];
  const STARS = [];
  for (let si = 0; si < 26; si++) STARS.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.5, p: Math.random() * Math.PI * 2, s: 0.0008 + Math.random() * 0.0016 });
  // 圆角矩形路径（老 WebView 无 ctx.roundRect 的兼容画法）
  function rrPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---- 关卡生成：8×4 基础网格，坚固砖比例随层涨；排列按层号轮换三种 ----
  function buildBricks(level) {
    const sturdyRatio = Math.min(0.10 + 0.07 * (level - 1), 0.45);
    const arr = [];
    const skip = {};   // 排列变化：挖掉少量格子改变阵形
    if (level % 3 === 1 && level >= 4) { skip['0_0'] = 1; skip['0_7'] = 1; }              // 切上角
    else if (level % 3 === 2 && level >= 5) { skip['3_0'] = 1; skip['3_7'] = 1; }         // 切下角
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (skip[r + '_' + c]) continue;
        // 层号轮换：普通排列 / 棋盘加固（坚固砖集中在偶数格）/ 中路加固
        let sturdy = Math.random() < sturdyRatio;
        if (level % 3 === 2 && (r + c) % 2 === 0 && r < 2) sturdy = true;
        if (level % 3 === 0 && c >= 3 && c <= 4 && r < 2) sturdy = Math.random() < sturdyRatio + 0.18;
        arr.push({ x: B_MARGIN + c * (B_W + B_GAP), y: B_TOP + r * (B_H + B_GAP), w: B_W, h: B_H, hp: sturdy ? 2 : 1, maxHp: sturdy ? 2 : 1, row: r });
      }
    }
    return arr;
  }

  // ---- 球速：随层数提高，封顶防后期不可操作 ----
  const levelSpeed = (lv) => Math.min(3.0 + 0.32 * (lv - 1), 5.0);

  // ---- 游戏状态 ----
  let state = null;
  let running = false, paused = false;
  let rafId = null, lastTs = 0, acc = 0;

  function newBallObj() { return { x: W / 2, y: BALL_HOME_Y, vx: 0, vy: 0, trail: [] }; }

  function newState(diffKey) {
    const d = DIFFS[diffKey] || DIFFS.easy;
    const st = {
      diff: diffKey, params: d,
      perf: rollPerformance(),
      ball: null,
      balls: [],                 // 场上所有球；恒有 s.ball === s.balls[0]（调试口/用例依赖）
      respawns: [],              // 掉球补发队列（时间戳，按球数上限补足）
      player: { x: PLAYER_HOME_X, targetX: PLAYER_HOME_X },
      dream: { x: DREAM_HOME_X, targetX: DREAM_HOME_X, nextThinkAt: 0 },
      bricks: buildBricks(1),
      status: 'serve',           // serve | rally | clearing | over
      serveAt: 0,
      score: 0, combo: 0, maxCombo: 0, bricksCleared: 0, level: 1, lives: 3,
      prevVy: 0,
      aiBall: null,              // 梦角当前锁定的目标球（多球时选最快落地的）
      prevAiVy: 0,               // 目标球上一帧 vy（判定「转为下落」）
      dreamErr: 0,               // 锁定式误差：每次球向下飞只掷一次，整段保持
      fumbleOffset: null,        // 放水：本次下落故意偏离（非 null 即武装）
      slipArmed: false,          // 特殊发挥·slip 的必失球
      hotUntil: 0,               // 特殊发挥·hot 生效期
      rallyHits: 0,              // 双方连续接球数（合作默契反馈用）
      floaters: [],              // {x,y,text,until}
      taBubble: null,            // {text,until}
      parts: [],                 // 砖块碎裂粒子
      comboPopUntil: 0, comboPopVal: 0,   // COMBO 中央弹跳动画
      playerFlashAt: 0, dreamFlashAt: 0,  // 挡板命中白闪时刻
      cardLast: {},              // 各类泡泡上次触发时间戳
      cardGlobalAt: 0,
      lastBrickAt: 0,            // 上次碰到砖的时间（防僵局看门狗用，newState 后由 startGame 补齐）
      endReplied: false
    };
    st.ball = newBallObj();
    st.balls.push(st.ball);
    return st;
  }

  // ---- 发球：多球时第 i 颗横向错开 34px、角度分散（2球左右对开 / 3球左中右），避免开局同轨 ----
  function spawnX(i, n) { return clamp(W / 2 + (i - (n - 1) / 2) * 34, BALL_R + 2, W - BALL_R - 2); }
  function launchBall(s, bl, i, n, now) {
    const sp = levelSpeed(s.level);
    let deg;
    if (n <= 1) deg = rand(-38, 38);
    else {
      const t = n === 2 ? (i === 0 ? -1 : 1) : (i - 1);   // 3球：-1/0/1 → 左中右
      deg = t * rand(24, 36);
    }
    let sa = Math.sin(deg * Math.PI / 180);
    const MIN_SX = 0.22;
    if (Math.abs(sa) < MIN_SX) sa = (Math.random() < 0.5 ? -MIN_SX : MIN_SX);   // 与挡板反弹同款防纯垂直
    bl.x = spawnX(i, n); bl.y = BALL_HOME_Y;
    bl.vx = sa * sp;
    bl.vy = -Math.sqrt(Math.max(0, 1 - sa * sa)) * sp;
    bl.trail.length = 0;   // 新球清空旧尾迹
  }
  function serve(s, now) {
    const n = targetBallCount();
    s.balls.length = 1;   // 只保留主球对象，保证 s.ball === s.balls[0] 恒成立
    launchBall(s, s.ball, 0, n, now);
    for (let i = 1; i < n; i++) { const nb = newBallObj(); launchBall(s, nb, i, n, now); s.balls.push(nb); }
    s.prevVy = s.ball.vy;
    s.status = 'rally';
    s.lastBrickAt = now;   // 看门狗重新计时（每次发球=新的无进度窗口）
    s.dreamErr = 0; s.fumbleOffset = null; s.slipArmed = false;
    s.respawns.length = 0;
  }

  // ---- 梦角落点预测：从球态推演到挡板平面的 x（含左右墙反弹折叠） ----
  function predictLandingX(b) {
    if (b.vy <= 0.05) return null;
    const planeY = PADDLE_Y - BALL_R;
    const t = (planeY - b.y) / b.vy;
    if (t < 0 || t > 600) return null;
    return foldX(b.x + b.vx * t);
  }

  // ---- 特殊发挥触发 ----
  function maybeTriggerSpecial(s, now) {
    const pf = s.perf;
    if (!pf || pf.kind !== 'special' || pf.used) return;
    if (pf.variant === 'hot') { pf.used = true; s.hotUntil = now + 10000; }
    // slip 在下一次下落判定时消费（见 planDescent）
  }

  // ---- 梦角决策目标球：多球时选「最快落到挡板平面」的下落球（现任目标带迟滞优势防来回抖动） ----
  function aiTargetBall(s) {
    let best = null, bestT = Infinity;
    for (const b of s.balls) {
      const pred = predictLandingX(b);
      if (pred == null) continue;
      const t = (PADDLE_Y - BALL_R - b.y) / b.vy;
      if (t < 0) continue;
      const w = (b === s.aiBall) ? t * 0.78 : t;
      if (w < bestT) { bestT = w; best = b; }
    }
    return best;
  }

  // ---- 梦角决策（切换目标球或目标球转为下落时掷定误差/放水；周期性思考更新目标） ----
  function planDescent(s, now) {
    const tb = aiTargetBall(s);
    if (!tb) { s.aiBall = null; s.prevAiVy = 0; return; }
    // 新的一次下落（换目标球，或同球 vy 由 ≤0 转 >0）→ 掷本段误差与放水
    if (tb !== s.aiBall || (tb.vy > 0 && s.prevAiVy <= 0)) {
      const pf = s.perf;
      const p = effectiveParams(s, now);
      s.dreamErr = tri(p.err);
      s.fumbleOffset = null;
      maybeTriggerSpecial(s, now);
      // slip：整局一次的明显走神（必偏出可接范围）
      if (pf.kind === 'special' && pf.variant === 'slip' && !pf.used && Math.random() < 0.6) {
        pf.used = true;
        s.slipArmed = true;
        s.fumbleOffset = (PADDLE_W * (0.9 + Math.random() * 0.35)) * (Math.random() < 0.5 ? -1 : 1);
      } else if (Math.random() < p.fumble) {
        s.fumbleOffset = (PADDLE_W * (0.72 + Math.random() * 0.33)) * (Math.random() < 0.5 ? -1 : 1);
      }
      // 走神发挥：安排一次短暂反应停摆
      if (pf.kind === 'dazed') {
        if (!pf.nextLapseAt) pf.nextLapseAt = now + rand(7000, 13000);
        if (now >= pf.nextLapseAt) {
          pf.nextLapseAt = now + rand(9000, 16000);
          s.lapseUntil = now + rand(450, 850);
        }
      }
    }
    s.aiBall = tb;
    s.prevAiVy = tb.vy;
  }
  // 生效参数：难度为基础，叠加本局发挥 / 特殊发挥临场变化
  function effectiveParams(s, now) {
    const base = s.params;
    const pf = s.perf;
    let errMul = 1, vMul = 1, fumbleMul = 1;
    if (pf) {
      if (pf.kind === 'good') { errMul = 0.55; vMul = 1.12; fumbleMul = 0.45; }
      else if (pf.kind === 'dazed') { errMul = 1.25; vMul = 0.92; fumbleMul = 1.35; }
      else if (pf.kind === 'special' && pf.variant === 'hot' && now < s.hotUntil) { errMul = 0.3; vMul = 1.3; fumbleMul = 0; }
    }
    return {
      think: base.think, err: base.err * errMul,
      maxV: base.maxV * vMul, fumble: base.fumble * fumbleMul
    };
  }

  function dreamAI(s, now) {
    const d = s.dream;
    const p = effectiveParams(s, now);
    const pred = s.aiBall ? predictLandingX(s.aiBall) : null;
    const comingDown = !!(s.aiBall && s.aiBall.vy > 0 && pred != null);
    if (comingDown) {
      let target = pred + s.dreamErr + (s.fumbleOffset || 0);
      // 球会落进玩家半场（右）：梦角只压到中线附近待命，不做无意义横穿
      if (pred > W * 0.58) target = W / 2 - PADDLE_W / 2 - 6;
      d.targetX = clampDreamX(target);
    } else {
      // 球远离/上行：缓慢回中路偏左待命（小幅游走，减少无意义移动）
      d.targetX = DREAM_HOME_X + Math.sin(now / 2600) * 12;
    }
    // 移动：限速 + 紧急度加成（球快到跟前时提速）；走神期间大幅减速
    let v = p.maxV;
    const dist = Math.abs(d.targetX - d.x);
    if (dist > 140) v *= 1.18;
    if (s.lapseUntil && now < s.lapseUntil) v *= 0.22;
    const step = clamp(d.targetX - d.x, -v, v);
    d.x = clampDreamX(d.x + step);
  }

  // ---- 字卡泡泡（低概率 + 全局冷却 + 分事件冷却） ----
  function trySay(s, type, prob, now) {
    if (Math.random() > prob) return;
    if (now - s.cardGlobalAt < 9000) return;
    const cd = SAY_COOLDOWN[type] || 0;
    if (cd && now - (s.cardLast[type] || 0) < cd) return;
    s.cardGlobalAt = now;
    s.cardLast[type] = now;
    s.taBubble = { text: pick(SAY_POOLS[type]), until: now + 1500 };
  }

  // ---- 挡板反弹：击中位置决定角度（中央近垂直 / 边缘斜向） ----
  // 防死循环：强制最小水平分量 MIN_SX——纯垂直反弹（hit≈0）会在「已清空列」里被
  // 梦角自动居中接球无限循环（球原地上下弹、挡板看似卡住），这是打砖块经典陷阱；
  // MIN_SX=0.22 时出射角离垂直至少约 12.7°，任何竖直通道都无法维持。
  function bouncePaddle(s, px, isPlayer, now, b) {
    const hit = clamp((b.x - px) / (PADDLE_W / 2 + BALL_R), -1, 1);
    const sp = levelSpeed(s.level);
    const ang = hit * (Math.PI / 3);   // 最大 60°
    let sa = Math.sin(ang);
    const MIN_SX = 0.22;
    if (Math.abs(sa) < MIN_SX) sa = (Math.random() < 0.5 ? -MIN_SX : MIN_SX);   // 近垂直时随机给水平方向
    b.vx = sa * sp;
    b.vy = -Math.sqrt(Math.max(0, 1 - sa * sa)) * sp;   // 保速归一
    b.y = PADDLE_Y - BALL_R - 0.5;
    s.prevVy = b.vy;
    s.dreamErr = 0; s.fumbleOffset = null; s.slipArmed = false;   // 新一段行程
    if (isPlayer) s.playerFlashAt = now; else s.dreamFlashAt = now;   // 命中白闪
    s.rallyHits++;
    sfxPaddle();
    if (isPlayer) {
      // 边缘惊险救球（|hit|>0.72 且球已很贴近底部）→ 低概率夸奖
      const danger = (PADDLE_Y - b.y) < 26;
      if (hit > 0 && danger && Math.abs(hit) > 0.72) trySay(s, 'save', 0.35, now);
    } else {
      // 梦角接住：低概率短句 + 边缘险接 → nearmiss 池
      if (Math.abs(hit) > 0.78) trySay(s, 'nearmiss', 0.3, now);
      else trySay(s, 'catch', 0.10, now);
      // 合作默契反馈：双方连续成功接球较多时极低概率说一次
      if (s.rallyHits >= 10) trySay(s, 'coop', 0.06, now);
    }
  }

  // ---- 砖块碰撞：圆 vs AABB，按穿透小的轴反弹；命中即扣血 ----
  function brickCollide(s, b) {
    for (let i = 0; i < s.bricks.length; i++) {
      const k = s.bricks[i];
      if (k.hp <= 0) continue;
      const cx = clamp(b.x, k.x, k.x + k.w);
      const cy = clamp(b.y, k.y, k.y + k.h);
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
      // 反弹轴：比较球心到砖面的重叠量
      const overlapX = BALL_R - Math.abs(dx), overlapY = BALL_R - Math.abs(dy);
      if (dx === 0 && dy === 0) { b.vy = -b.vy; }
      else if (overlapY <= overlapX) { b.vy = dy < 0 ? -Math.abs(b.vy) : Math.abs(b.vy); b.y = dy < 0 ? k.y - BALL_R : cy + BALL_R; }
      else { b.vx = dx < 0 ? -Math.abs(b.vx) : Math.abs(b.vx); b.x = dx < 0 ? k.x - BALL_R : cx + BALL_R; }
      s.lastBrickAt = performance.now();
      k.hp--;
      if (k.hp <= 0) {
        const nowB = performance.now();
        const pts = k.maxHp >= 2 ? 20 : 10;
        s.score += pts;
        s.combo++;
        s.bricksCleared++;
        if (s.combo > s.maxCombo) s.maxCombo = s.combo;
        if (s.combo >= 2) { s.comboPopUntil = nowB + 750; s.comboPopVal = s.combo; }
        // 碎裂粒子：7 片砖块同色小方块，带重力飞散
        const rc = ROW_COLORS[(k.row || 0) % 4];
        for (let pi = 0; pi < 7; pi++) {
          s.parts.push({ x: k.x + k.w / 2, y: k.y + k.h / 2, vx: rand(-2.4, 2.4), vy: rand(-3.2, -0.4), born: nowB, life: rand(380, 640), sz: rand(2, 4.4), c: Math.random() < 0.5 ? rc[0] : rc[1] });
        }
        s.floaters.push({ x: k.x + k.w / 2, y: k.y + B_H / 2, text: '+' + pts, until: nowB + 750 });
        if (s.combo >= 9) trySay(s, 'streak', 0.08, nowB);
      }
      sfxBrick(k.hp);
      return;   // 每 tick 只处理一块，避免穿角双扣
    }
  }

  // ---- 一步物理更新 ----
  function step(s, now) {
    if (s.status === 'over') return;
    if (s.status === 'serve') {
      if (now >= s.serveAt) serve(s, now);
      return;
    }
    if (s.status === 'clearing') {
      if (now >= s.serveAt) {
        s.level++;
        s.bricks = buildBricks(s.level);
        for (const bl of s.balls) { bl.vx = 0; bl.vy = 0; }
        s.status = 'serve'; s.serveAt = now + 900;
        hintEl.textContent = '第 ' + s.level + ' 层';
      }
      return;
    }
    if (s.status !== 'rally') return;

    // 玩家挡板：键盘持续位移 / 触摸目标追踪
    let pv = 0;
    if (keys.left) pv -= PLAYER_V;
    if (keys.right) pv += PLAYER_V;
    if (pv !== 0) s.player.targetX = clampPlayerX(s.player.targetX + pv);
    const pdx = clamp(s.player.targetX - s.player.x, -PLAYER_V, PLAYER_V);
    s.player.x = clampPlayerX(s.player.x + pdx);

    // 梦角：按思考间隔更新（危险=任一球快速下行时提高频率）
    planDescent(s, now);
    let urgent = false;
    for (const bl of s.balls) { if (bl.vy > 0 && bl.y > H * 0.55) { urgent = true; break; } }
    if (now >= s.dream.nextThinkAt) {
      dreamAI(s, now);
      const p = effectiveParams(s, now);
      const th = urgent ? p.think[0] : rand(p.think[0], p.think[1]);
      s.dream.nextThinkAt = now + th;
    } else {
      dreamAI(s, now);   // 目标不变也要继续朝目标移动（限速在 dreamAI 内）
    }

    // 掉球补发队列：到点按设定球数上限补足（多球局其余球不中断）
    for (let ri = s.respawns.length - 1; ri >= 0; ri--) {
      if (now < s.respawns[ri]) continue;
      s.respawns.splice(ri, 1);
      if (s.status === 'rally' && s.lives > 0 && s.balls.length < targetBallCount()) {
        const nb = newBallObj();
        launchBall(s, nb, s.balls.length, targetBallCount(), now);
        s.balls.push(nb);
      }
    }

    // 各球移动 / 碰撞 / 出界（倒序遍历便于出界移除）
    for (let bi = s.balls.length - 1; bi >= 0; bi--) {
      const b = s.balls[bi];
      b.x += b.vx; b.y += b.vy;

      // 左右墙 / 顶反弹
      if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx); sfxWall(); }
      if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); sfxWall(); }
      if (b.y - BALL_R < 0) { b.y = BALL_R; b.vy = Math.abs(b.vy); sfxWall(); }

      brickCollide(s, b);

      // 挡板碰撞（vy>0 才判，防粘板）；半场守卫防跨边误接（玩家右 / 梦角左）
      if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y - BALL_R <= PADDLE_Y + PADDLE_H + 6) {
        if (Math.abs(b.x - s.player.x) <= PADDLE_W / 2 + BALL_R && b.x > W / 2 - PADDLE_W) bouncePaddle(s, s.player.x, true, now, b);
        else if (Math.abs(b.x - s.dream.x) <= PADDLE_W / 2 + BALL_R && b.x <= W / 2 + PADDLE_W) bouncePaddle(s, s.dream.x, false, now, b);
      }

      // 防僵局看门狗：12s 没碰过任何砖（竖直通道循环 / 砖顶走廊横滑等几何死角）→
      // 轻推球改变方向并保证最小纵向分量，确保对局永远有进展
      // （lastBrickAt 全局共用：任一球碰砖都算进度，触发时对所有球各轻推一次）
      if (now - (s.lastBrickAt || 0) > 12000) {
        s.lastBrickAt = now;
        const sp2 = Math.hypot(b.vx, b.vy) || levelSpeed(s.level);
        const na = Math.atan2(b.vy, b.vx) + (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 20) * Math.PI / 180;
        b.vx = Math.cos(na) * sp2; b.vy = Math.sin(na) * sp2;
        if (Math.abs(b.vy) < 0.3 * sp2) {   // 防转成近水平贴地/贴顶滑行
          b.vy = (b.vy >= 0 ? 1 : -1) * 0.3 * sp2;
          b.vx = (b.vx >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, sp2 * sp2 - b.vy * b.vy));
        }
      }

      // 球掉出场地 → 移除并扣命（可能切到 serve/over 态，即停本帧循环）
      if (b.y - BALL_R > H) loseLife(s, b, now);
      if (s.status !== 'rally') break;
    }
    s.prevVy = s.ball.vy;

    // 清层判定（「这一层完成！」由 render 画布中央大字动画呈现，不走 hint）
    if (s.status === 'rally' && !s.bricks.some(k => k.hp > 0)) {
      s.status = 'clearing';
      s.serveAt = now + 1300;
      hintEl.textContent = '';
      sfxClear();
      trySay(s, 'clear', 0.4, now);
    }
  }

  function loseLife(s, b, now) {
    // 移除该球；同时保持「s.ball === s.balls[0]」恒成立（调试口/既有用例依赖）。
    // 关键：最后一颗球（balls.length===1）永不移除——单球局 serve 等待期球冻结在场内、
    // 始终留在 balls[] 里，避免「status 被强切 rally 但数组为空 → 物理失效」。
    const hadMulti = s.balls.length > 1;
    const idx = s.balls.indexOf(b);
    if (idx >= 0 && hadMulti) {
      if (idx === 0) {
        // 移除的是主球：把剩余球姿态搬进主球对象，再删掉那个对象
        const o = s.balls[1];
        s.ball.x = o.x; s.ball.y = o.y; s.ball.vx = o.vx; s.ball.vy = o.vy; s.ball.trail = o.trail;
        s.balls.splice(1, 1);
      } else {
        s.balls.splice(idx, 1);
      }
    }
    if (s.aiBall && s.balls.indexOf(s.aiBall) < 0) { s.aiBall = null; s.prevAiVy = 0; }
    s.lives--;
    s.combo = 0;
    s.rallyHits = 0;
    sfxLose();
    s.shakeUntil = now + 300; s.shakeMag = 5;   // 丢命震屏（render 内 300ms 线性衰减随机位移）
    // 失误方侧的低概率短句（左半场掉=梦角侧，也含「差点」语义池）
    if (b.x <= W / 2) trySay(s, 'nearmiss', 0.22, now);
    if (s.lives <= 0) {
      endGame(s, now);
      return;
    }
    hintEl.textContent = T('差一点！还剩 ') + s.lives + T(' 次');
    trySay(s, 'fail', 0.3, now);
    if (!hadMulti) {
      // 单球局：经典发球等待（球冻结在原地）
      s.ball.vx = 0; s.ball.vy = 0;
      s.status = 'serve';
      s.serveAt = now + 1000;
    } else {
      // 多球局：即使只剩一颗也走补发，回到设定球数（对局不中断）
      const deficit = targetBallCount() - s.balls.length;
      for (let i = 0; i < deficit; i++) s.respawns.push(now + 1100 + i * 700);
    }
  }

  // ---- 游戏结束：结算面板 + 写入聊天记录 + TA 回应 ----
  function bestKey() { return (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':brick-best'; }
  function loadBest() { try { return Number(localStorage.getItem(bestKey())) || 0; } catch (e) { return 0; } }
  function endGame(s, now) {
    s.status = 'over';
    stopLoop();
    clearSavedBrick();   // 对局已结束，清跨刷新存档
    let best = loadBest();
    const isBest = s.score > best;
    if (isBest) { best = s.score; try { localStorage.setItem(bestKey(), String(best)); } catch (e) {} }
    // 合作评级：按完成层数/得分给 ❤ 评价（3=默契满分 / 2=配合不错 / 1=热身一下）
    const doneLv = s.level - 1;
    const stars = (doneLv >= 4 || s.score >= 600) ? 3 : (doneLv >= 2 || s.score >= 250) ? 2 : 1;
    const rateTxt = ['热身一下', '配合不错', '默契满分'][stars - 1];
    // v3.15.x 二调：奖励对齐红包金额体系——❤评级双方各得 ¥5.2 / ¥13.14 / ¥52（日封顶 ¥156）
    var coinLineBrick = '';
    try {
      var COIN_CAP = 15600;
      // FIX 2026-09-16：封顶键 UTC 日期改本地日期（UTC 口径下北京时间 0-8 点记到前一天）
      var day = (function () { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
      var ck = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':ml2_coin_brick_' + day;
      var cur = Number(localStorage.getItem(ck)) || 0;
      if (cur < COIN_CAP) {
        // FIX 2026-09-16：幸运日（游乐室）奖励 ×2，仍受日封顶约束
        var brickMult = (window.arcadeMult && window.arcadeMult('brick')) || 1;
        var real = Math.min([520, 1314, 5200][stars - 1] * brickMult, COIN_CAP - cur);
        try { localStorage.setItem(ck, String(cur + real)); } catch (e2) {}
        if (real > 0 && typeof window.giftWalletChange === 'function') {
          if (window.giftWalletChange(real, real, '双人打砖块')) {
            coinLineBrick = '🪙 双方心意币各 +¥' + (real / 100).toFixed(2);
          }
        }
      }
    } catch (e) {}
    // FIX 2026-09-16：接游乐室三件套（此前打砖块完全不在体系内）——幸运日打卡；
    // 合作清层无胜负，按「❤≥2（配合不错以上）」视作胜利时刻参与 8% 掉落；战绩入 brick-stats 供聚合页
    var brickDrop = null;
    try {
      if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('brick');
      if (stars >= 2 && window.arcadeTryDrop) brickDrop = window.arcadeTryDrop('brick');
      var bsk = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':brick-stats';
      var bsRaw = localStorage.getItem(bsk);
      var bs = { plays: 0, layers: 0 };
      if (bsRaw) { try { bs = Object.assign(bs, JSON.parse(bsRaw)); } catch (e5) {} }
      bs.plays++; bs.layers += Math.max(0, doneLv);
      localStorage.setItem(bsk, JSON.stringify(bs));
    } catch (e) {}
    const body =
      '<div class="pong-end-score">' + s.score + ' 分</div>' +
      '<div class="brick-rate">' + '❤️'.repeat(stars) + '<span>' + '🤍'.repeat(3 - stars) + '</span> · ' + rateTxt + '</div>' +
      '<div class="pong-end-stat">最高连击 ×' + s.maxCombo + ' · 清除砖块 ' + s.bricksCleared + ' 块</div>' +
      '<div class="pong-end-stat">完成层数 ' + doneLv + ' · 历史最佳 ' + best + ' 分' + (isBest ? ' 🎉新纪录' : '') + '</div>' +
      (coinLineBrick ? '<div class="pong-end-stat">' + coinLineBrick + '</div>' : '') +
      (brickDrop ? '<div class="pong-end-stat">🎁 掉落限定摆件「' + brickDrop.name + '」</div>' : '');
    showOverlay(T('游戏结束'), body, '再来一局');
    if (overlayCloseBtn) { overlayCloseBtn.hidden = false; overlayCloseBtn.textContent = '返回小游戏'; }
    // 写聊天记录（居中小卡片）+ TA 回应（固定发送，语气随机二选一）
    try {
      if (window.chatAddSystem) {
        window.chatAddSystem(T('双人打砖块 · ') + s.score + ' 分 · 最高连击 ×' + s.maxCombo + ' · 完成第 ' + (s.level - 1) + ' 层', { special: 'brick' });
      }
      if (!s.endReplied) {
        s.endReplied = true;
        setTimeout(() => {
          try { if (window.chatAddIn) window.chatAddIn(pick(['还玩吗？', '再来一局？']), { silent: true }); } catch (e) {}
        }, 800);
      }
    } catch (e) {}
  }

  // ---- 渲染 ----
  let _bgGrad = null, _rowGrads = null;
  function render(s, now) {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    // 丢命震屏：300ms 随机位移线性衰减（在 clearRect 之后 translate，背景随之下扩边防露底）
    if (now < (s.shakeUntil || 0)) {
      const _sk = (s.shakeUntil - now) / 300 * (s.shakeMag || 5);
      ctx.translate((Math.random() * 2 - 1) * _sk, (Math.random() * 2 - 1) * _sk);
    }
    // 背景：纵向深空渐变 + 呼吸星点
    if (!_bgGrad) {
      _bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      _bgGrad.addColorStop(0, '#0c1120');
      _bgGrad.addColorStop(0.55, '#101625');
      _bgGrad.addColorStop(1, '#161e34');
    }
    ctx.fillStyle = _bgGrad;
    ctx.fillRect(-9, -9, W + 18, H + 18);
    ctx.fillStyle = '#cfe0ff';
    for (const st of STARS) {
      ctx.globalAlpha = 0.2 + 0.16 * Math.sin(now * st.s + st.p);
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    // 危险预警：任一球下行且落点在玩家半场深处 → 底部泛淡红光提醒补救（取最深的一颗）
    if (s.status === 'rally') {
      let worst = null, worstY = -1;
      for (const bl of s.balls) {
        if (bl.vy <= 0 || bl.y <= H * 0.6) continue;
        const predX = predictLandingX(bl);
        if (predX != null && predX > W * 0.58 && bl.y > worstY) { worstY = bl.y; worst = bl; }
      }
      if (worst) {
        const inten = Math.min(1, (worst.y / H - 0.6) / 0.4);
        const dg = ctx.createLinearGradient(0, H - 36, 0, H);
        dg.addColorStop(0, 'rgba(255,95,122,0)');
        dg.addColorStop(1, 'rgba(255,95,122,' + (0.08 + 0.26 * inten).toFixed(3) + ')');
        ctx.fillStyle = dg;
        ctx.fillRect(0, H - 36, W, 36);
      }
    }
    // 中线（区分左右半场，虚线弱化）
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 9]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);
    // 砖块：按行渐变圆角砖（粉→紫→蓝→青）；坚固砖加白描边，被打一次显裂纹
    if (!_rowGrads) {
      _rowGrads = ROW_COLORS.map((cc, ri) => {
        const y0 = B_TOP + ri * (B_H + B_GAP);
        const g = ctx.createLinearGradient(0, y0, 0, y0 + B_H);
        g.addColorStop(0, cc[0]); g.addColorStop(1, cc[1]);
        return g;
      });
    }
    for (const k of s.bricks) {
      if (k.hp <= 0) continue;
      const sturdy = k.maxHp >= 2;
      ctx.fillStyle = _rowGrads[(k.row || 0) % 4];
      rrPath(ctx, k.x, k.y, k.w, k.h, 3);
      ctx.fill();
      if (sturdy) {
        ctx.strokeStyle = 'rgba(255,255,255,.45)';
        ctx.lineWidth = 1.3;
        rrPath(ctx, k.x + 0.8, k.y + 0.8, k.w - 1.6, k.h - 1.6, 2.4);
        ctx.stroke();
        if (k.hp === 1) {   // 裂纹
          ctx.strokeStyle = 'rgba(40,20,10,.5)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(k.x + k.w * 0.3, k.y + 2); ctx.lineTo(k.x + k.w * 0.5, k.y + k.h * 0.55); ctx.lineTo(k.x + k.w * 0.62, k.y + k.h - 2);
          ctx.stroke();
        }
      }
    }
    // 碎裂粒子
    for (const pt of s.parts) {
      const ag = 1 - (now - pt.born) / pt.life;
      if (ag <= 0) continue;
      ctx.globalAlpha = Math.min(1, ag * 1.5);
      ctx.fillStyle = pt.c;
      ctx.fillRect(pt.x - pt.sz / 2, pt.y - pt.sz / 2, pt.sz, pt.sz);
    }
    ctx.globalAlpha = 1;
    // 球拖尾（渐隐渐小，每球独立一条）
    for (const bl of s.balls) {
      for (let ti = 0; ti < bl.trail.length; ti++) {
        const tp = bl.trail[ti], f = (ti + 1) / bl.trail.length;
        ctx.globalAlpha = f * 0.25;
        ctx.fillStyle = '#ffd9e2';
        ctx.beginPath(); ctx.arc(tp.x, tp.y, BALL_R * (0.35 + 0.65 * f), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // 挡板：玩家右（蓝）/ 梦角左（暖橙），圆角+命中白闪；带小标签帮助识别半场
    ctx.fillStyle = '#6ea8ff';
    rrPath(ctx, s.player.x - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H, 4); ctx.fill();
    if (now - (s.playerFlashAt || 0) < 160) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * (1 - (now - s.playerFlashAt) / 160)).toFixed(3) + ')';
      rrPath(ctx, s.player.x - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H, 4); ctx.fill();
    }
    ctx.fillStyle = '#ffb27d';
    rrPath(ctx, s.dream.x - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H, 4); ctx.fill();
    if (now - (s.dreamFlashAt || 0) < 160) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * (1 - (now - s.dreamFlashAt) / 160)).toFixed(3) + ')';
      rrPath(ctx, s.dream.x - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H, 4); ctx.fill();
    }
    if ((s.rallyHits || 0) < 6 && s.status !== 'over') {
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(110,168,255,0.85)';
      ctx.fillText('你', s.player.x, PADDLE_Y - 5);
      ctx.fillStyle = 'rgba(255,178,125,0.85)';
      ctx.fillText(taName(), s.dream.x, PADDLE_Y - 5);
    }
    // 球（外圈微光）；发球等待期不画实体球，改画各出生点的幽灵球+脉冲指示
    if (s.status !== 'serve') {
      for (const bl of s.balls) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.arc(bl.x, bl.y, BALL_R + 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(bl.x, bl.y, BALL_R, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      const nServe = targetBallCount();
      const pu = 0.5 + 0.5 * Math.sin(now / 170);
      ctx.strokeStyle = 'rgba(110,168,255,' + (0.35 + 0.45 * pu).toFixed(3) + ')';
      ctx.lineWidth = 2;
      for (let i = 0; i < nServe; i++) {
        const hx = spawnX(i, nServe), hy = BALL_HOME_Y;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(hx, hy, BALL_R, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(hx, hy, BALL_R + 6 + 3 * pu, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hx - 7, hy - 15); ctx.lineTo(hx, hy - 22); ctx.lineTo(hx + 7, hy - 15);
        ctx.stroke();
      }
    }
    // 得分漂浮数字
    for (const f of s.floaters) {
      const left = (f.until - now) / 750;
      if (left <= 0) continue;
      ctx.globalAlpha = Math.min(1, left * 1.6);
      ctx.fillStyle = '#ffe08a';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - (1 - left) * 18);
      ctx.globalAlpha = 1;
    }
    s.floaters = s.floaters.filter(f => f.until > now);
    // COMBO 中央弹跳（弹入后缓收，颜色随连击升温 黄→橙红）
    if (now < s.comboPopUntil && s.comboPopVal >= 2) {
      const prog = 1 - (s.comboPopUntil - now) / 750;
      const sc = prog < 0.25 ? 0.7 + (prog / 0.25) * 0.55 : 1.25 - (prog - 0.25) * 0.33;
      const heat = Math.min(1, (s.comboPopVal - 2) / 8);
      ctx.save();
      ctx.translate(W / 2, H * 0.44);
      ctx.scale(sc, sc);
      ctx.globalAlpha = prog > 0.72 ? Math.max(0, (1 - prog) * 3.6) : 1;
      ctx.font = 'bold 21px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgb(255,' + Math.round(224 - heat * 150) + ',' + Math.round(138 - heat * 122) + ')';
      ctx.fillText('COMBO ×' + s.comboPopVal, 0, 0);
      ctx.restore();
    }
    // 清层大字动画（缩放淡入 → 停留 → 淡出）
    if (s.status === 'clearing') {
      const pr = 1 - Math.max(0, s.serveAt - now) / 1300;
      const sc2 = 0.8 + Math.min(1, pr * 3) * 0.32;
      ctx.save();
      ctx.translate(W / 2, H * 0.46);
      ctx.scale(sc2, sc2);
      ctx.globalAlpha = Math.min(1, pr * 6) * (pr > 0.78 ? Math.max(0, (1 - pr) * 4.5) : 1);
      ctx.font = 'bold 23px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe08a';
      ctx.fillText(T('这一层完成！'), 0, 0);
      ctx.restore();
    }
    // TA 泡泡（白色圆角气泡框 + 小尾巴指向梦角挡板）
    if (s.taBubble) {
      if (now < s.taBubble.until) {
        const left = (s.taBubble.until - now) / 1500;
        ctx.save();
        ctx.globalAlpha = Math.min(1, left * 1.6);
        ctx.font = '12px sans-serif';
        const text = s.taBubble.text;
        const tw = ctx.measureText(text).width;
        const bw = tw + 18, bh = 20;
        const bx = clamp(s.dream.x, bw / 2 + 8, W - bw / 2 - 8);
        const by = PADDLE_Y - 24;   // 气泡底边
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        rrPath(ctx, bx - bw / 2, by - bh, bw, bh, 9);
        ctx.fill();
        const tailX = clamp(s.dream.x, bx - bw / 2 + 9, bx + bw / 2 - 9);
        ctx.beginPath();
        ctx.moveTo(tailX - 4, by - 1); ctx.lineTo(tailX + 4, by - 1); ctx.lineTo(clamp(s.dream.x, tailX - 6, tailX + 6), by + 5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3a3f4d';
        ctx.textAlign = 'center';
        ctx.fillText(text, bx, by - 6);
        ctx.restore();
      } else s.taBubble = null;
    }
    ctx.restore();
  }

  function renderInfo(s) {
    if (!scoreEl) return;
    // FIX 2026-09-16：原每帧无脑写 textContent（同值也置脏）——score/combo/level 改 dataset 缓存（lives 同款先例）
    if (scoreEl.dataset.h !== String(s.score)) { scoreEl.textContent = s.score; scoreEl.dataset.h = String(s.score); }
    if (comboEl) {
      const ct = s.combo >= 2 ? '×' + s.combo : '';
      if (comboEl.dataset.h !== ct) { comboEl.textContent = ct; comboEl.dataset.h = ct; }
    }
    if (livesEl) {
      const full = '❤'.repeat(Math.max(0, s.lives));
      const lost = '<span class="brick-hlost">' + '❤'.repeat(Math.max(0, 3 - s.lives)) + '</span>';
      if (livesEl.dataset.h !== full + (3 - s.lives)) { livesEl.innerHTML = full + lost; livesEl.dataset.h = full + (3 - s.lives); }
    }
    if (levelEl) {
      const lt = String(s.level);
      if (levelEl.dataset.h !== lt) { levelEl.textContent = s.level; levelEl.dataset.h = lt; }
    }
  }

  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    if (!paused) {
      acc += dt;
      const frame = 1000 / FPS;
      let guard = 0;
      while (acc >= frame && guard < 5) { step(state, ts); acc -= frame; guard++; }
      // 特效推进（真实帧差，封顶防后台大跳）：粒子重力飞行 + 球尾迹采样
      const fxDt = Math.min(50, dt) / 16.7;
      const nowFx = performance.now();
      if (state.status === 'rally') {
        for (const bl of state.balls) {
          bl.trail.push({ x: bl.x, y: bl.y });
          if (bl.trail.length > 9) bl.trail.shift();
        }
      }
      for (let i = state.parts.length - 1; i >= 0; i--) {
        const pt = state.parts[i];
        pt.vy += 0.16 * fxDt;
        pt.x += pt.vx * fxDt;
        pt.y += pt.vy * fxDt;
        if (nowFx - pt.born > pt.life) state.parts.splice(i, 1);
      }
    }
    render(state, ts);
    renderInfo(state);
    if (!paused && state.status === 'rally' && hintEl.textContent) hintEl.textContent = '';
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ---- Canvas 尺寸适配（DPR 清晰；全屏时按实际剩余空间算最大尺寸保持比例） ----
  // #784（#774 同族根治）：视口抖动期 resize 逐事件同步重铺——给 canvas.width 赋值哪怕同值
  // 也清空位图＝白闪一次，全屏 availH 直接读 innerHeight 又跟着抖动＝画布来回脉冲。
  // 改为「先算几何，与上次铺设一致整条跳过（幂等）」；resize 侧另走 280ms 落定闸门（onViewportChange）。
  let lastFitGeo = '';
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const box = canvas.parentElement;
    let geo, apply;
    if (isFs) {
      // 全屏：按视口扣除头部/信息栏/底注的实际高度（横屏时 info 变侧栏、foot 隐藏，
      // 同一套测量自然适配），并计入安全区 padding
      let used = 26;
      ['.poke-card-head', '.brick-info', '.pong-foot'].forEach(sel => {
        const el = panel.querySelector(sel);
        if (el && el.offsetHeight) used += el.offsetHeight;
      });
      const cs = getComputedStyle(panel);
      const availW = window.innerWidth - 20 - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const availH = Math.max(160, window.innerHeight - used - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - 14);
      // 竖屏：优先按可用高度放大（纵向吃满、横向居中），超宽时回退宽度主导；
      // 横屏：维持宽度主导（横向吃满）。保证画布尽量铺满且不变形。
      let cw, ch;
      if (window.innerHeight >= window.innerWidth) {
        ch = availH; cw = Math.round(ch * W / H);
        if (cw > availW) { cw = availW; ch = Math.round(cw * H / W); }
      } else {
        cw = availW; ch = Math.round(cw * H / W);
        if (ch > availH) { ch = availH; cw = Math.round(ch * W / H); }
      }
      geo = 'fs|' + dpr + '|' + cw + 'x' + ch;
      apply = function () {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        if (box) { box.style.width = cw + 'px'; box.style.height = ch + 'px'; }
      };
    } else {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      geo = 'nf|' + dpr + '|' + rect.width;
      apply = function () {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas.style.width = '';
        canvas.style.height = '';
        if (box) { box.style.width = ''; box.style.height = ''; }
      };
    }
    if (geo === lastFitGeo) return;
    lastFitGeo = geo;
    apply();
  }

  function showOverlay(title, body, btn) {
    if (!overlayEl) return;
    if (overlayTitleEl) overlayTitleEl.innerHTML = title || '';
    if (overlayBodyEl) overlayBodyEl.innerHTML = body || '';
    if (overlayBtnEl) overlayBtnEl.textContent = btn || '开始';
    overlayEl.hidden = false;
  }
  function hideOverlay() { if (overlayEl) overlayEl.hidden = true; }

  // ---- 开始 / 重开（再来一局：全重置、难度保持、重新生成本局发挥） ----
  function startGame() {
    state = newState((diffSel && diffSel.value) || 'easy');
    hideOverlay();
    if (overlayCloseBtn) overlayCloseBtn.hidden = true;
    fitCanvas();
    paused = false;
    if (pauseBtn) pauseBtn.textContent = '⏸';
    if (hintEl) hintEl.textContent = '';
    state.status = 'serve';
    state.serveAt = performance.now() + 900;
    running = true; lastTs = 0; acc = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!state || state.status === 'over' || state.status === 'serve') return;
    paused = !paused;
    if (paused) {
      stopLoop();
      if (pauseBtn) pauseBtn.textContent = '▶';
      if (hintEl) hintEl.textContent = '已暂停';
    } else {
      running = true; lastTs = 0; acc = 0;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
      if (pauseBtn) pauseBtn.textContent = '⏸';
      if (hintEl) hintEl.textContent = '';
    }
  }

  // ---- 全屏：优先真·Fullscreen API（安卓隐藏浏览器栏/系统栏），iOS 等不支持时
  //      自动退级为 CSS 兜底全屏（brick-fs，面板 fixed 铺满视口） ----
  // 与应用级 fullscreen.js 的共存策略（不改对方文件）：
  //  · 元素级 requestFullscreen 会触发全局 fullscreenchange → fullscreen.js 会把
  //    设置页「全屏模式」开关点亮并持久化。进入前记住该开关原状态，退出后延时还原
  //    （避开其 handleFsExit 700ms 决策窗口），不污染用户的全局设置。
  //  · 方向遵循应用竖屏哲学：进真全屏后静音尝试锁 portrait，避免 Via 类浏览器
  //    「网页全屏必横屏」把游戏甩成横屏（其全局监视器会兜底处理）。
  let isFs = false;        // 视觉全屏态（真全屏或 CSS 兜底，控制 brick-fs 类与画布适配）
  let _nativeFs = false;   // 当前处于元素级原生全屏
  function fsApiAvailable() {
    const el = document.documentElement;
    return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
  }
  function isNativeFs() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function requestNativeFs() {
    try {
      const el = panel;
      if (el.requestFullscreen) return el.requestFullscreen({ navigationUI: 'hide' });
      if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    } catch (e) {}
    return null;
  }
  function exitNativeFs() {
    try {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) {}
  }
  // 应用级全屏设置开关状态快照/还原（防游戏全屏污染全局「全屏模式」持久化）
  let _savedAppFs = null;
  function snapshotAppFs() {
    try {
      const el = document.getElementById('sf-fullscreen');
      _savedAppFs = {
        checked: el ? el.checked : null,
        fsKey: localStorage.getItem((window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':fullscreen-enabled'),
        fbKey: localStorage.getItem((window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':fullscreen-fallback')
      };
    } catch (e) { _savedAppFs = null; }
  }
  function restoreAppFs() {
    if (!_savedAppFs) return;
    const snap = _savedAppFs; _savedAppFs = null;
    setTimeout(() => {
      try {
        const pre = window.activePrefix && window.activePrefix() || 'xy-home-v2';
        // 快照为 null（键本不存在）→ 保持删除态，不写 '0' 占位
        if (snap.fsKey === null) localStorage.removeItem(pre + ':fullscreen-enabled');
        else localStorage.setItem(pre + ':fullscreen-enabled', snap.fsKey);
        if (snap.fbKey === null) localStorage.removeItem(pre + ':fullscreen-fallback');
        else localStorage.setItem(pre + ':fullscreen-fallback', snap.fbKey);
        const el = document.getElementById('sf-fullscreen');
        if (el && !isNativeFs()) {
          const target = snap.checked === true || String(snap.fsKey) === '1';
          if (el.checked !== target) el.checked = target;   // 触发其 MutationObserver 回写一致状态
        }
      } catch (e) {}
    }, 1100);   // 避开 fullscreen.js handleFsExit 的 700ms 延迟决策
  }
  function exitFsVisual() {
    isFs = false;
    panel.classList.remove('brick-fs');
    if (fsBtn) fsBtn.textContent = '⛶';
    setTimeout(() => { if (panel && !panel.hidden) fitCanvas(); }, 60);
  }
  function toggleFs() {
    if (isNativeFs()) { exitNativeFs(); return; }   // 真全屏中 → 退出（fullscreenchange 里收尾）
    if (isFs) { exitFsVisual(); return; }           // CSS 兜底全屏中再点 = 退出兜底
    // 进入：先立即套 CSS 视觉（防请求期间闪空），原生成功则无缝续用、失败保持兜底
    isFs = true;
    panel.classList.add('brick-fs');
    if (fsBtn) fsBtn.textContent = '⤢';
    if (fsApiAvailable()) {
      snapshotAppFs();
      const p = requestNativeFs();
      if (p && p.then) {
        p.then(() => {
          _nativeFs = true;
          try { if (screen.orientation && screen.orientation.lock) { const lp = screen.orientation.lock('portrait'); if (lp && lp.catch) lp.catch(() => {}); } } catch (e) {}
        }, () => {});
      }
    }
    setTimeout(() => { if (panel && !panel.hidden) fitCanvas(); }, 80);
  }
  // 系统侧退出真全屏（返回手势/切后台）→ 回到普通半框模式
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(evName => {
    document.addEventListener(evName, () => {
      if (_nativeFs && !isNativeFs()) {
        _nativeFs = false;
        restoreAppFs();
        if (!panel.hidden) exitFsVisual();
        else { isFs = false; panel.classList.remove('brick-fs'); if (fsBtn) fsBtn.textContent = '⛶'; }
      }
    });
  });

  // ---- 输入：触摸 / 鼠标拖动（画面横向拖动控制玩家挡板，仅左半场有效映射） ----
  function inputX(clientX) {
    if (!state || state.status === 'over') return;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * W;
    state.player.targetX = clampPlayerX(x);
  }
  let touching = false;
  canvas.addEventListener('touchstart', (e) => {
    if (!running || paused) return;
    touching = true;
    const t = e.touches[0];
    if (t) inputX(t.clientX);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!running || paused || !touching) return;
    const t = e.touches[0];
    if (t) inputX(t.clientX);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { touching = false; });
  canvas.addEventListener('mousedown', (e) => { if (running && !paused) { touching = true; inputX(e.clientX); } });
  canvas.addEventListener('mousemove', (e) => { if (running && !paused && touching) inputX(e.clientX); });
  window.addEventListener('mouseup', () => { touching = false; });

  // 键盘：A/D 与 ← →
  const keys = { left: false, right: false };
  function keyToDir(k) {
    if (k === 'a' || k === 'arrowleft') return 'left';
    if (k === 'd' || k === 'arrowright') return 'right';
    return null;
  }
  document.addEventListener('keydown', (e) => {
    if (!running || paused || !panel || panel.hidden) return;
    const dir = keyToDir(e.key.toLowerCase());
    if (dir) { keys[dir] = true; e.preventDefault(); }
  });
  document.addEventListener('keyup', (e) => {
    const dir = keyToDir(e.key.toLowerCase());
    if (dir) keys[dir] = false;
  });
  // FIX 2026-09-16：按住方向键切走窗口（来电/alt-tab）keyup 丢失，回来挡板自己漂移到边界——失焦即清键
  window.addEventListener('blur', () => { keys.left = false; keys.right = false; });

  // ---- 按钮 ----
  if (diffSel) diffSel.addEventListener('change', () => {
    // 进行中切换难度即时生效（下次思考起用新参数）；结束后只影响下一局
    if (state && state.status !== 'over') state.params = DIFFS[diffSel.value] || DIFFS.easy;
  });
  if (ballsSel) ballsSel.addEventListener('change', () => {
    const target = targetBallCount();
    // 选择随联系人记忆（下次打开面板恢复）
    try { localStorage.setItem(ballsPrefKey(), String(target)); } catch (e) {}
    // 进行中即时生效（不打断当前对局）：按新目标数补发缺的球 / 剪除多出的球。
    // 只从数组尾部增减、恒不动 balls[0]，维持「s.ball === s.balls[0]」不变量；
    // 剪掉的球若是梦角当前锁定目标则清空，planDescent 下一帧自动重选。
    if (state && state.status === 'rally' && state.lives > 0) {
      while (state.balls.length > target) {
        const extra = state.balls.pop();
        if (state.aiBall === extra) { state.aiBall = null; state.prevAiVy = 0; }
      }
      while (state.balls.length < target) {
        const nb = newBallObj();
        launchBall(state, nb, state.balls.length, target, performance.now());
        state.balls.push(nb);
      }
    }
  });
  if (soundBtn) soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.style.opacity = soundOn ? '' : '.5';
  });
  // 覆盖层主按钮：开始新局 / 恢复进行中对局（resumeFn 非空时优先恢复，一次性）
  let resumeFn = null;
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeBrickPanel(); });
  if (overlayBtnEl) overlayBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (resumeFn) { const f = resumeFn; resumeFn = null; f(); }
    else startGame();
  });
  function armResume(fn) { resumeFn = fn; }
  if (overlayCloseBtn) overlayCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 进行中副按钮 =「新开局」（放弃旧局、按当前选择重开）；初始/结束时 = 关闭面板
    if (resumeFn) { resumeFn = null; startGame(); }
    else closeBrickPanel();
  });
  if (pauseBtn) pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
  if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });

  // 切后台自动暂停（回来自动恢复太突兀，保持暂停由玩家自己继续）
  // FIX 2026-09-16：补 serve/clearing 两态的后台处理——它们的 serveAt 是绝对时间戳，
  // 后台待一阵回场即「已到点」秒发球，玩家毫无准备；回场统一重给 900ms 缓冲；后台期间顺带存档。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (running && !paused && state && state.status !== 'over') {
        if (state.status === 'rally') { saveGame(); togglePause(); }
        else saveGame();
      }
      return;
    }
    if (state && !paused && running && (state.status === 'serve' || state.status === 'clearing')) {
      state.serveAt = performance.now() + 900;
    }
  });

  // ---- 跨刷新存档（FIX 2026-09-16：原只存内存，刷新/后台被杀丢整局；snake/pong 都有 *-saved 同款） ----
  function savedKey() { return (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':brick-saved'; }
  function canPersist(s) { return !!(s && s.status !== 'over' && s.lives > 0 && (s.bricksCleared + s.score > 0)); }
  function saveGame() {
    try {
      if (!canPersist(state)) { localStorage.removeItem(savedKey()); return; }
      const c = JSON.parse(JSON.stringify(state));
      c.floaters = []; c.parts = []; c.taBubble = null;   // 纯视觉瞬时字段不入档
      c.balls.forEach((b) => { b.trail = []; });
      localStorage.setItem(savedKey(), JSON.stringify(c));
    } catch (e) {}
  }
  function loadSavedBrick() {
    try {
      const raw = localStorage.getItem(savedKey());
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.params || !s.player || !s.dream || s.status === 'over' || !(s.lives > 0)) { clearSavedBrick(); return null; }
      return s;
    } catch (e) { return null; }
  }
  function clearSavedBrick() { try { localStorage.removeItem(savedKey()); } catch (e) {} }

  // ---- 入口（供 chat.js 调用） ----
  // 只读调试口（tools/verify-brick.mjs 专用：读取/注入 state 跑确定性用例）
  window.__brickDebug = {
    get state() { return state; },
    get running() { return running; },
    get paused() { return paused; },
    get W() { return W; },
    get H() { return H; }
  };
  window.openBrickPanel = function () {
    if (!panel) return;
    let name = taName();
    try {
      const st = window.activeStore && window.activeStore();
      name = (st && (st.get('lbl-partner') || st.get('cs-lbl-partner'))) || name;
    } catch (e) {}
    if (partnerNameEl) partnerNameEl.textContent = name;
    if (footNameEl) footNameEl.textContent = name;
    if (isFs) toggleFs();
    panel.hidden = false;
    lastFitGeo = '';   // #784 打开必重铺（原实现每次 fitCanvas 都重建位图＝顺带清台，幂等闸门后显式保留该语义）
    fitCanvas();
    stopLoop();
    paused = false;
    if (pauseBtn) pauseBtn.textContent = '⏸';
    if (state && state.status !== 'over' && state.lives > 0 && state.bricksCleared + state.score > 0) {
      // 同一会话内有进行中的对局：直接回到暂停态让玩家选择
      showOverlay(T('双人打砖块'), '<div class="pong-start-tip">进行中 · ' + state.score + ' 分 · 第 ' + state.level + ' 层</div>', '继续');
      armResume(function () {
        hideOverlay();
        if (state.status === 'serve' || state.status === 'clearing') state.serveAt = performance.now() + 900;
        paused = false;
        running = true; lastTs = 0; acc = 0;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(loop);
        if (pauseBtn) pauseBtn.textContent = '⏸';
      });
      // 进行中也可放弃旧局重新开局（球数/难度按当前选择即时生效）
      if (overlayCloseBtn) { overlayCloseBtn.hidden = false; overlayCloseBtn.textContent = '新开局'; }
      return;
    }
    // FIX 2026-09-16：跨刷新存档恢复（内存没有进行中对局时，试 localStorage 的 brick-saved）
    if (!state || state.status === 'over') {
      const sv = loadSavedBrick();
      if (sv) {
        state = sv;
        showOverlay(T('双人打砖块'), '<div class="pong-start-tip">有未完成的对局 · ' + state.score + ' 分 · 第 ' + state.level + ' 层</div>', '继续');
        armResume(function () {
          hideOverlay();
          if (state.status === 'serve' || state.status === 'clearing') state.serveAt = performance.now() + 900;
          else if (state.status === 'rally') state.lastBrickAt = performance.now();   // 看门狗重新计时
          paused = false;
          running = true; lastTs = 0; acc = 0;
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(loop);
          if (pauseBtn) pauseBtn.textContent = '⏸';
        });
        if (overlayCloseBtn) { overlayCloseBtn.hidden = false; overlayCloseBtn.textContent = '新开局'; }
        return;
      }
    }
    const best = loadBest();
    armResume(null);
    // 恢复该联系人记住的球数偏好
    try {
      const savedBalls = Number(localStorage.getItem(ballsPrefKey()));
      if (savedBalls >= 1 && savedBalls <= 3 && ballsSel) ballsSel.value = String(savedBalls);
    } catch (e) {}
    const bn = targetBallCount();
    showOverlay(T('双人打砖块'),
      '<div class="pong-start-tip">你和' + T('TA') + '各守半场共接' + (bn > 1 ? bn + ' 颗球' : '同一颗球') + '<br>清光砖块进入下一层 · 共 3 次失误机会</div>' +
      '<div class="pong-start-ctrl">按住画面左右拖动</div>' +
      (best > 0 ? '<div class="pong-end-stat">历史最佳 ' + best + ' 分</div>' : ''),
      '开始');
    if (overlayCloseBtn) overlayCloseBtn.hidden = true;
  };
  window.closeBrickPanel = function () {
    if (canPersist(state)) saveGame();   // FIX 2026-09-16：跨刷新存档（原关面板只停循环不落盘）
    stopLoop();
    if (isNativeFs()) { exitNativeFs(); }        // 真全屏 → 退出（fullscreenchange 收尾视觉）
    else if (isFs) { exitFsVisual(); }
    if (panel) panel.hidden = true;
  };
  // 切换联系人桌面时关闭（chat.js 会触发 contact-switched）
  document.addEventListener('contact-switched', () => { try { closeBrickPanel(); } catch (e) {} });
  // 窗口尺寸变化时重适配（#784：抖动期不再逐事件重铺，视口安静 280ms 后再量一次）
  let refitSettle = 0;
  function onViewportChange() {
    clearTimeout(refitSettle);
    refitSettle = setTimeout(function () { if (panel && !panel.hidden) fitCanvas(); }, 280);
  }
  window.addEventListener('resize', onViewportChange);
})();

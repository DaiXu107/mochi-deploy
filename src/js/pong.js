// ===== 功能：双人 Pong 小游戏（聊天页更多功能 → Pong） =====
// 玩家控制右侧挡板，TA 由 AI 控制左侧挡板，球在双方之间持续运动。
// （v3.11.x：比分/提示文案与实际操控侧对应——原文案写"左侧"与实现不符）
// AI = 基础预测 + 反应延迟 + 移动速度限制 + 锁定式预测误差（每次进攻掷一次）+ 概率行为池 + 行为冷却。
// 游戏结束后写入聊天记录（special:'pong'）+ TA 随机回应（内置三组字卡池）。
// 不依赖聊天 AI；音效用 Web Audio 生成短促 beep，可静音。
(function () {
  const panel = document.getElementById('chat-pong-panel');
  if (!panel) return;
  const canvas = document.getElementById('pong-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('pong-score');
  const hintEl = document.getElementById('pong-hint');
  const overlayEl = document.getElementById('pong-overlay');
  const overlayTitleEl = document.getElementById('pong-overlay-title');
  const overlayBodyEl = document.getElementById('pong-overlay-body');
  const overlayBtnEl = document.getElementById('pong-overlay-btn');
  const diffSel = document.getElementById('pong-diff');
  const soundBtn = document.getElementById('pong-sound');
  const closeBtn = document.getElementById('pong-close');
  const partnerNameEl = document.getElementById('pong-partner-name');
  const pauseBtn = document.getElementById('pong-pause');
  const fsBtn = document.getElementById('pong-fs');
  const overlayBtn2El = document.getElementById('pong-overlay-btn2');
  const winTipEl = document.getElementById('pong-win-tip');

  // ---- 逻辑尺寸（物理计算用；Canvas 实际像素按 DPR 缩放，CSS 拉伸到容器宽度） ----
  // 挡板高度/球半径/获胜分按难度变化（见 DIFFS），这里只放固定尺寸。
  // v3.9.x：H 240→300 让 canvas 更高（显示增大 25%），手机触摸区更大好操作；低难度挡板同步加长补偿。
  const W = 400, H = 300;
  const PADDLE_W = 8;
  const PADDLE_GAP = 14;            // 挡板距边界
  const INIT_SPEED = 4;
  const SPEED_INC = 0.2;
  const MAX_SPEED = 6.5;
  const PLAYER_MAX_SPEED = 8.5;      // 玩家挡板最大速度（px/tick，提高让玩家更容易接快球）
  const FPS = 60;

  // ---- 难度参数（反应延迟/移动速度/预测误差/失误率/行为概率/物理尺寸/让分） ----
  // v3.9.x：整体降难度——新增休闲档，easy 大幅放宽。球速上限 + 玩家挡板 8.5 让真人跟得上。
  // v3.12.x：用户反馈「都难，赢不了」再降一档——
  //   ① 预测误差改为锁定式：每次球飞向 TA 只掷一次（见 step 的 approachErr/approachMiss）。
  //      原实现每帧重掷噪声，被挡板连续追踪平均掉 → predictErr/missRate 形同虚设、低难档 AI 实际几乎不失误。
  //      本表数值从此等于真实失误率：休闲/简单档 TA 回球率约 5 成/6成半，普通档才有稳定防守。
  //   ② 玩家/TA 挡板高度分离：paddleH=TA 挡板，ppH=玩家挡板（低难档玩家更长更好接，TA 更短更易漏）。
  //   ③ maxBall=每档球速上限（原全局 6.5 对低难档太快）；fumble 放水概率加大；TA 移速再降。
  const DIFFS = {
    casual: { reactDelay: [0.8, 1.2],  maxSpeed: 1.5, predictErr: 56, missRate: 0.30, paddleH: 92, ppH: 120, ballR: 8, winScore: 3, fumble: 0.32, maxBall: 5.0,
              beh: { early: 0.02, slow: 0.18, drift: 0.18, shift: 0.03, miss: 0.18, risky: 0.01 } },
    easy:   { reactDelay: [0.55, 0.85], maxSpeed: 1.85, predictErr: 44, missRate: 0.22, paddleH: 84, ppH: 110, ballR: 7, winScore: 4, fumble: 0.24, maxBall: 5.6,
              beh: { early: 0.03, slow: 0.13, drift: 0.12, shift: 0.04, miss: 0.12, risky: 0.02 } },
    normal: { reactDelay: [0.2, 0.4],  maxSpeed: 3.6, predictErr: 16, missRate: 0.08, paddleH: 70, ppH: 84, ballR: 6, winScore: 5, fumble: 0.06, maxBall: 6.2,
              beh: { early: 0.06, slow: 0.05, drift: 0.05, shift: 0.04, miss: 0.03, risky: 0.08 } },
    hard:   { reactDelay: [0.12, 0.28], maxSpeed: 5.0, predictErr: 8,  missRate: 0.04, paddleH: 70, ppH: 78, ballR: 6, winScore: 5, fumble: 0, maxBall: 6.5,
              beh: { early: 0.07, slow: 0.03, drift: 0.03, shift: 0.03, miss: 0.02, risky: 0.1 } }
  };

  // ---- TA 游戏结束回应字卡池（内置，按难度分语气，不依赖聊天 AI / 用户字卡库） ----
  // 休闲/简单：TA 更宠溺温柔；普通/困难：TA 更认真。
  const POOLS = {
    casual: {
      player_win: ['让你赢啦~', '再来陪你玩', '你厉害呀', '哼，下次赢回来', '好棒好棒'],
      opponent_win: ['没事，再来一局', '让着你还没赢呀', '下次让你先', '别气馁嘛', '哎呀我赢了'],
      draw: ['平手啦', '再来再来', '默契嘛', '一起的']
    },
    easy: {
      player_win: ['你赢了~', '再来一局', '这次你厉害', '差点接住', '你反应挺快'],
      opponent_win: ['我赢了，再来吗', '下次让你', '你差点接住', '加油呀', '还玩吗'],
      draw: ['平局，再来', '一起撞上了', '再来一次', '默契默契']
    },
    normal: {
      player_win: ['赢了？', '再来一局。', '这次你赢。', '还要继续吗？', '你反应挺快。', '差点接住。'],
      opponent_win: ['我赢了。', '还玩吗？', '这次是我赢。', '再来。', '你差点接住。', '下一局加油。'],
      draw: ['一起撞上的。', '算平手。', '再来一次。', '平局，再来。']
    },
    hard: {
      player_win: ['你赢了。', '再来。', '这次你反应快。', '继续？'],
      opponent_win: ['我赢了。', '再来。', '你差点接住。', '下一局。'],
      draw: ['平局。', '再来。']
    }
  };
  // 对局中 TA 偶尔说话泡泡（接球/失误/得分时按概率触发，与表情泡泡叠加）
  const SAY_POOLS = {
    catch: ['接得好', '嘿', '看我的', '嘿咻'],
    miss: ['哎呀', '差点', '哼', '没接住'],
    score: ['哈', '接到啦', '嘿嘿', '得分']
  };

  // ---- 音效（Web Audio 短促 beep，静音开关默认开） ----
  let audioCtx = null, soundOn = true;
  function beep(freq, dur, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // FIX 2026-09-16：iOS 锁屏/来电后 ctx 挂起，不 resume 则此后音效永久哑音（connect-four 同款修法）
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'square';
      g.gain.value = vol || 0.06;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      o.start(t); g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.06));
      o.stop(t + (dur || 0.06));
    } catch (e) {}
  }
  // v3.15.x：音量整体调大（0.04~0.09 → 0.14~0.22）——用户反馈边听音乐边玩时音效听不清
  function sfxWall() { beep(380, 0.04, 0.14); }
  function sfxPaddle() { beep(520, 0.05, 0.18); }
  function sfxScore() { beep(300, 0.12, 0.2); }
  function sfxWin() { beep(660, 0.18, 0.22); setTimeout(() => beep(880, 0.22, 0.22), 140); }

  // ---- 游戏状态 ----
  let state = null;
  let rafId = null, lastTs = 0, acc = 0;
  let running = false;

  function newState(diff) {
    const d = DIFFS[diff] || DIFFS.easy;
    const pH = d.paddleH, ppH = d.ppH || d.paddleH, bR = d.ballR;
    return {
      diff: diff,
      playerScore: 0, opponentScore: 0,
      ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: INIT_SPEED },
      player: { y: H / 2 - ppH / 2, vy: 0, targetY: H / 2 - ppH / 2 },
      opponent: { y: H / 2 - pH / 2, vy: 0, targetY: H / 2 - pH / 2, reactUntil: 0, aiNextAt: 0 },
      status: 'countdown',          // countdown | rally | scored | ended
      countdown: 3, countdownAt: 0,
      scorePauseUntil: 0,
      gameTime: 0, roundStartTs: 0,
      rallyHits: 0,                 // 本回合击球次数（球速随回合递增）
      playerStreak: 0, opponentStreak: 0,
      maxPlayerStreak: 0, maxOpponentStreak: 0,
      totalRounds: 0,
      // 锁定式进攻误差：球飞向 TA 的每段行程只掷一次（vx 由 ≥0 变 <0 时），整段保持
      approachErr: 0, approachMiss: 0, prevVx: 0,
      // AI 概率行为状态
      beh: {
        active: null,               // {type, until}
        cooldown: {},               // {type: ts}
        consecCatch: 0              // TA 连续接球数
      },
      // 视觉反馈
      flashPaddle: 0, flashWall: 0, flashScore: 0,
      lastHit: 0,                   // 上次击球点（-1~1，用于挡板闪光颜色教学）
      taBubble: null,               // {emoji, text, until} TA 表情/说话泡泡
      sayCooldown: 0,               // TA 说话冷却时间戳
      emojiCooldown: 0,             // TA 表情冷却时间戳（接球高频事件防每次都冒）
      serveDir: Math.random() < 0.5 ? -1 : 1,  // 预决定的发球方向（用于发球前预警箭头）
      playerRallyHits: 0,           // 玩家本回合连续接球数（连击奖励用）
      params: d
    };
  }

  // ---- 发球：用预决定方向（serveDir）+ ±15° 上下角度，发球后预决定下次方向 ----
  function serve(s) {
    const dir = s.serveDir || (Math.random() < 0.5 ? -1 : 1);
    const ang = (Math.random() * 30 - 15) * Math.PI / 180;   // -15°~+15°
    const sp = INIT_SPEED;
    s.ball.x = W / 2; s.ball.y = H / 2;
    s.ball.vx = Math.cos(ang) * sp * dir;
    s.ball.vy = Math.sin(ang) * sp;
    s.ball.speed = sp;
    s.rallyHits = 0;
    s.playerRallyHits = 0;
    s.prevVx = 0; s.approachErr = 0; s.approachMiss = 0;   // 发球即新进攻，误差重掷
    s.status = 'rally';
    s.roundStartTs = s.gameTime;
    s.serveDir = Math.random() < 0.5 ? -1 : 1;   // 预决定下次发球方向（供预警箭头）
  }

  // ---- 球轨迹预测：从当前状态推演到 x==targetX 处的 Y（含上下边界反弹） ----
  function predictY(s, targetX) {
    const b = s.ball;
    const bR = s.params.ballR;
    if (b.vx === 0) return b.y;
    const dir = Math.sign(b.vx);
    if ((targetX - b.x) * dir <= 0) return b.y;   // 球不会到达
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy;
    let guard = 0;
    while ((targetX - x) * dir > 0 && guard < 64) {
      guard++;
      const dt = (targetX - x) / vx;     // 直达时间
      // 上下边界反弹推演：y + vy*dt 是否越界
      let nextY = y + vy * dt;
      if (nextY < bR) {
        // 先撞上边界再继续
        const tHit = (bR - y) / vy;
        x += vx * tHit; y = bR; vy = -vy;
        continue;
      }
      if (nextY > H - bR) {
        const tHit = (H - bR - y) / vy;
        x += vx * tHit; y = H - bR; vy = -vy;
        continue;
      }
      return nextY;
    }
    return y;
  }

  // ---- AI 概率行为系统 ----
  // 行为冷却：同类型行为触发后 3~6 秒内不再触发
  const BEH_COOLDOWN = [3000, 6000];
  function behCanTrigger(s, type, now) {
    const last = s.beh.cooldown[type] || 0;
    return now - last > (s._cdLen && s._cdLen[type] || 4000);
  }
  function behTrigger(s, type, now, dur) {
    s.beh.active = { type: type, until: now + dur };
    const cd = BEH_COOLDOWN[0] + Math.random() * (BEH_COOLDOWN[1] - BEH_COOLDOWN[0]);
    s.beh.cooldown[type] = now + cd;
    s._cdLen = s._cdLen || {};
    s._cdLen[type] = cd;
  }
  function behActive(s, now) {
    if (s.beh.active && s.beh.active.until <= now) s.beh.active = null;
    return s.beh.active;
  }

  // ---- TA AI 决策（每次 AI 更新调用） ----
  function opponentAI(s, now) {
    const b = s.ball, o = s.opponent, p = s.params;
    const pH = p.paddleH;
    const taX = PADDLE_GAP + PADDLE_W;
    const ballToTa = b.vx < 0;   // 球正在向 TA（左）移动

    // 危险状态提高 AI 更新频率（已在调用方处理，这里专注决策）
    let targetY = o.y;           // 默认保持

    if (!ballToTa) {
      // 球远离 TA：轻微回到中心 + 小概率「提前改变站位」
      const act = behActive(s, now);
      if (act && act.type === 'shift') {
        targetY = o.targetY;     // 保持上次选的站位
      } else {
        targetY = H / 2 - pH / 2 + (Math.random() * 20 - 10);
      }
    } else {
      // 球向 TA 移动：预测落点
      let predY = predictY(s, taX);
      const predCenter = predY - pH / 2;

      // 概率行为判定（仅当当前无激活行为）
      const act = behActive(s, now);
      if (!act) {
        const r = Math.random();
        const beh = p.beh;
        // ① 提前移动：球较远 + 轨迹明确
        const dist = b.x - taX;
        // ⓪ 放水（低难度专属）：球较近 + 概率命中 → 故意偏离接不到，让玩家得分自然
        if (dist < 130 && dist > 30 && p.fumble > 0 && behCanTrigger(s, 'fumble', now) && r < p.fumble) {
          behTrigger(s, 'fumble', now, 260 + Math.random() * 200);
          // 偏离挡板长度 60%~90%，确保接不到
          const away = pH * (0.6 + Math.random() * 0.3);
          predY += (predY > H / 2 ? -1 : 1) * away;
          if (Math.random() < 0.5) predY = Math.max(p.ballR + 2, Math.min(H - p.ballR - 2, predY));
        }
        else if (dist > 180 && behCanTrigger(s, 'early', now) && r < beh.early) {
          behTrigger(s, 'early', now, 600 + Math.random() * 400);
        }
        // ② 反应慢一点
        else if (behCanTrigger(s, 'slow', now) && r < beh.slow) {
          behTrigger(s, 'slow', now, 200 + Math.random() * 200);
          o.reactUntil = now + 180 + Math.random() * 180;
        }
        // ③ 偏离预测点
        else if (behCanTrigger(s, 'drift', now) && r < beh.drift) {
          behTrigger(s, 'drift', now, 400 + Math.random() * 300);
          predY += (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 10);
        }
        // ④ 提前改变站位（球远时）
        else if (dist > 200 && behCanTrigger(s, 'shift', now) && r < beh.shift) {
          behTrigger(s, 'shift', now, 1000 + Math.random() * 1000);
          o.targetY = Math.max(0, Math.min(H - pH, predCenter + (Math.random() * 80 - 40)));
          targetY = o.targetY;
          return;   // 本帧直接用新站位
        }
        // ⑤ 随机失误
        else if (behCanTrigger(s, 'miss', now) && r < beh.miss) {
          behTrigger(s, 'miss', now, 300);
          predY += (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 15);
        }
        // ⑥ 连续成功后的冒险
        else if (s.beh.consecCatch >= 5 && behCanTrigger(s, 'risky', now) && r < beh.risky) {
          behTrigger(s, 'risky', now, 800 + Math.random() * 600);
          // 冒险：更早移动（预测更激进）或故意偏一点
          predY += (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 8);
        }
      } else {
        // 当前有激活行为：应用持续效果
        if (act.type === 'drift' || act.type === 'miss' || act.type === 'risky' || act.type === 'fumble') {
          // 偏离已在触发时写入 predY，这里不重复加；保持自然追踪
        }
        if (act.type === 'slow') {
          // 反应慢：延迟期间不更新目标
          if (now < o.reactUntil) { targetY = o.targetY; return; }
        }
      }

      // 进攻锁定误差（step 换向时掷定，整段进攻保持）：predictErr=基础误判，missRate=额外明显失准
      predY += (s.approachErr || 0) + (s.approachMiss || 0);

      targetY = predY - pH / 2;
    }

    o.targetY = Math.max(0, Math.min(H - pH, targetY));
  }

  // ---- 挡板移动（受最大速度限制） ----
  // 玩家挡板高度与 TA 分离（DIFFS.ppH；老存档无 ppH 回退同高）
  function playerH(s) { return (s.params && (s.params.ppH || s.params.paddleH)) || 72; }
  function movePaddle(paddle, targetY, maxSpeed, paddleH) {
    const diff = targetY - paddle.y;
    const step = Math.max(-maxSpeed, Math.min(maxSpeed, diff));
    paddle.y += step;
    paddle.vy = step;
    paddle.y = Math.max(0, Math.min(H - paddleH, paddle.y));
  }

  // ---- 球与挡板碰撞 ----
  function checkPaddle(s) {
    const b = s.ball;
    const bR = s.params.ballR, pH = s.params.paddleH, ppH = playerH(s);
    // TA 挡板（左）
    const tx = PADDLE_GAP + PADDLE_W;
    if (b.vx < 0 && b.x - bR <= tx && b.x - bR >= PADDLE_GAP - 4 && b.y >= s.opponent.y && b.y <= s.opponent.y + pH) {
      b.x = tx + bR;
      bouncePaddle(s, s.opponent, false);
    }
    // 玩家挡板（右）
    const px = W - PADDLE_GAP - PADDLE_W;
    if (b.vx > 0 && b.x + bR >= px && b.x + bR <= W - PADDLE_GAP + 4 && b.y >= s.player.y && b.y <= s.player.y + ppH) {
      b.x = px - bR;
      bouncePaddle(s, s.player, true);
    }
  }

  // ---- 反弹角度：根据击球点相对挡板中心位置改变 Y 速度 ----
  function bouncePaddle(s, paddle, isPlayer) {
    const b = s.ball;
    const pH = isPlayer ? playerH(s) : s.params.paddleH;
    const hit = (b.y - (paddle.y + pH / 2)) / (pH / 2);   // -1~1
    s.lastHit = hit;                                       // 记录击球点用于挡板闪光颜色教学
    // 球速递增（每次碰挡板 +0.2，上限按难度分档 maxBall）
    s.rallyHits++;
    // 连击奖励：休闲/简单档玩家连续接球 >=3 次后球速暂停递增，鼓励长回合
    const comboBonus = (s.diff === 'casual' || s.diff === 'easy') && isPlayer && s.playerRallyHits >= 3;
    const newSpeed = comboBonus ? b.speed : Math.min(s.params.maxBall || MAX_SPEED, INIT_SPEED + s.rallyHits * SPEED_INC);
    b.speed = newSpeed;
    const ang = hit * (Math.PI / 3.2);   // 最大约 56°
    b.vx = (isPlayer ? -1 : 1) * Math.cos(ang) * newSpeed;
    b.vy = Math.sin(ang) * newSpeed;
    s.flashPaddle = 1;
    sfxPaddle();
    // 接球振动反馈（随音效开关，困难关关闭）
    if (soundOn && s.diff !== 'hard' && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    if (!isPlayer) {
      // TA 接球成功：连续计数 + 概率行为冒险触发条件 + 表情泡泡 + 偶尔说话
      s.beh.consecCatch++;
      const cc = s.beh.consecCatch;
      const emoji = cc >= 5 ? '🤩' : cc >= 3 ? '😎' : '😊';
      tryTaSay(s, SAY_POOLS.catch, emoji, 0.4, 1500);   // 接球：40% 表情 + 1.5s 冷却（防每次都冒）
    } else {
      // 玩家接球成功：重置 TA 连续计数（玩家打断连击）+ 玩家连击数 +1
      s.beh.consecCatch = 0;
      s.playerRallyHits++;
    }
  }

  // TA 表情/说话泡泡：emojiProb 控制表情触发概率，cooldownMs>0 时启用表情冷却（接球高频事件防每次都冒）。
  // 说话在表情触发前提下再按概率掷，说话概率 30%（原 18% 太低用户反馈"没有说话"）。
  function tryTaSay(s, sayPool, emoji, emojiProb, cooldownMs) {
    const now = performance.now();
    if (cooldownMs > 0 && now < s.emojiCooldown) return;   // 表情冷却中，不触发
    if (Math.random() > emojiProb) return;                  // 未命中表情概率
    if (cooldownMs > 0) s.emojiCooldown = now + cooldownMs;
    let text = null;
    if (Math.random() < 0.3) {
      text = sayPool[Math.floor(Math.random() * sayPool.length)];
    }
    s.taBubble = { emoji: emoji, text: text, until: now + 1200 };
  }

  // ---- 一步物理更新 ----
  function step(s, now) {
    if (s.status === 'ended') return;
    s.gameTime += 1000 / FPS;

    // 倒计时
    if (s.status === 'countdown') {
      if (now >= s.countdownAt) {
        s.countdown--;
        s.countdownAt = now + 700;
        if (s.countdown <= 0) serve(s);
      }
      return;
    }
    // 得分后暂停
    if (s.status === 'scored') {
      if (now >= s.scorePauseUntil) serve(s);
      return;
    }
    if (s.status !== 'rally') return;

    // 玩家挡板：朝 targetY 移动（受最大速度限制）
    movePaddle(s.player, s.player.targetY, PLAYER_MAX_SPEED, playerH(s));

    // TA AI 更新频率：危险状态（球向 TA 且较近）提高频率
    const b = s.ball;
    // 锁定式进攻误差：球刚转向 TA（vx 由 ≥0 变 <0）时一次性掷定本段误差，整段保持。
    // v3.12.x 前是每帧重掷噪声 → 被挡板连续追踪平均掉，predictErr/missRate 实际不产生失误。
    if (b.vx < 0 && !(s.prevVx < 0)) {
      s.approachErr = (Math.random() * 2 - 1) * s.params.predictErr;
      s.approachMiss = Math.random() < s.params.missRate
        ? (20 + Math.random() * 26) * (Math.random() < 0.5 ? -1 : 1)
        : 0;
    } else if (b.vx > 0) {
      s.approachErr = 0; s.approachMiss = 0;
    }
    s.prevVx = b.vx;
    const danger = b.vx < 0 && (b.x - PADDLE_GAP - PADDLE_W) < 220;
    const aiInterval = danger ? 50 : 110;
    if (now >= s.opponent.aiNextAt) {
      opponentAI(s, now);
      s.opponent.aiNextAt = now + aiInterval;
    }
    // TA 挡板移动（受最大速度限制 + 反应延迟由 aiInterval 体现）
    movePaddle(s.opponent, s.opponent.targetY, s.params.maxSpeed, s.params.paddleH);

    // 球移动
    b.x += b.vx; b.y += b.vy;

    // 上下边界反弹
    const bR = s.params.ballR;
    if (b.y - bR < 0) { b.y = bR; b.vy = -b.vy; s.flashWall = 1; sfxWall(); }
    if (b.y + bR > H) { b.y = H - bR; b.vy = -b.vy; s.flashWall = 1; sfxWall(); }

    // 挡板碰撞
    checkPaddle(s);

    // 得分判定
    if (b.x - bR > W) {
      // 球越过右边界 → TA 得分
      s.opponentScore++;
      s.opponentStreak++; s.playerStreak = 0;
      s.maxOpponentStreak = Math.max(s.maxOpponentStreak, s.opponentStreak);
      s.totalRounds++;
      s.beh.consecCatch = 0;
      s.playerRallyHits = 0;
      tryTaSay(s, SAY_POOLS.score, '😤', 0.75, 0);   // TA 得分：75% 表情，无冷却（关键事件）
      onScore(s, now, 'opponent');
    } else if (b.x + bR < 0) {
      // 球越过左边界 → 玩家得分（TA 失误）
      s.playerScore++;
      s.playerStreak++; s.opponentStreak = 0;
      s.maxPlayerStreak = Math.max(s.maxPlayerStreak, s.playerStreak);
      s.totalRounds++;
      s.beh.consecCatch = 0;
      s.playerRallyHits = 0;
      tryTaSay(s, SAY_POOLS.miss, '😅', 0.75, 0);   // TA 失误：75% 表情，无冷却（关键事件）
      onScore(s, now, 'player');
    }

    // 视觉反馈衰减
    if (s.flashPaddle > 0) s.flashPaddle = Math.max(0, s.flashPaddle - 0.08);
    if (s.flashWall > 0) s.flashWall = Math.max(0, s.flashWall - 0.1);
    if (s.flashScore > 0) s.flashScore = Math.max(0, s.flashScore - 0.05);
  }

  function onScore(s, now, who) {
    sfxScore();
    s.flashScore = 1;
    if (s.playerScore >= s.params.winScore || s.opponentScore >= s.params.winScore) {
      endGame(s, now);
    } else {
      s.status = 'scored';
      s.scorePauseUntil = now + 900;
    }
  }

  // ---- 游戏结束 ----
  function endGame(s, now) {
    s.status = 'ended';
    clearSaved();   // 对局已结束，清除保存
    sfxWin();
    const playerWin = s.playerScore > s.opponentScore;
    const draw = s.playerScore === s.opponentScore;
    const sec = Math.round((s.gameTime - 0) / 1000);
    const fmt = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
    // 战绩记录（每联系人独立，存 localStorage）
    const statsKey = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':pong-stats';
    let stats = { win: 0, lose: 0, draw: 0, maxStreak: 0, total: 0 };
    try {
      const raw = localStorage.getItem(statsKey);
      if (raw) stats = Object.assign(stats, JSON.parse(raw));
      if (draw) stats.draw++; else if (playerWin) stats.win++; else stats.lose++;
      stats.maxStreak = Math.max(stats.maxStreak, s.maxPlayerStreak);
      stats.total++;
      localStorage.setItem(statsKey, JSON.stringify(stats));
    } catch (e) {}
    // FIX 2026-09-16：接游乐室三件套——幸运日打卡 + 玩家胜利 8% 掉限定摆件（奖励 ×2 在下方发奖处生效）
    let drop = null;
    try {
      if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('pong');
      if (playerWin && window.arcadeTryDrop) drop = window.arcadeTryDrop('pong');
    } catch (e) {}
    const fit = window.taFit ? window.taFit : function (x) { return x; };
    // v3.15.x 二调：奖励对齐红包金额体系——胜 80% ¥13.14 / 20% ¥52，平 ¥5.2（日封顶 ¥104）
    // v3.16.x：乒乓改为双方同步同额入账（不再只给赢家），赚钱流水记「乒乓」
    var coinLine = '';
    try {
      var COIN_CAP = 10400;
      // FIX 2026-09-16：封顶键 UTC 日期改本地日期（UTC 口径下北京时间 0-8 点记到前一天）
      var day = (function () { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
      var ck = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':ml2_coin_pong_' + day;
      var cur = Number(localStorage.getItem(ck)) || 0;
      if (cur < COIN_CAP) {
        var pongWinFen = Math.random() < 0.2 ? 5200 : 1314;
        // FIX 2026-09-16：①输局原与胜局同额（¥13.14/¥52），与注释「胜 80%/20%、平 ¥5.2」口径不符，
        // 且高于 gomoku/c4 等对战类「仅赢家得奖」——改为负局发平局档 ¥5.2；②幸运日奖励 ×2（游乐室）
        var pongMult = (window.arcadeMult && window.arcadeMult('pong')) || 1;
        var real = Math.min((playerWin ? pongWinFen : 520) * pongMult, COIN_CAP - cur);
        try { localStorage.setItem(ck, String(cur + real)); } catch (e2) {}
        if (real > 0 && typeof window.giftWalletChange === 'function') {
          if (window.giftWalletChange(real, real, '乒乓')) {
            coinLine = '🪙 双方心意币各 +¥' + (real / 100).toFixed(2);
          }
        }
      }
    } catch (e) {}
    const title = draw ? '平局' : (playerWin ? '🏆 你赢了' : fit('TA 赢了'));
    const body =
      '<div class="pong-end-score">' + fit('TA') + ' ' + s.opponentScore + ' : ' + s.playerScore + ' 你</div>' +
      '<div class="pong-end-stat">总回合 ' + s.totalRounds + ' · 用时 ' + fmt(sec) + '</div>' +
      '<div class="pong-end-stat">你的最高连得 ' + s.maxPlayerStreak + ' · ' + fit('TA') + ' 最高连得 ' + s.maxOpponentStreak + '</div>' +
      '<div class="pong-end-stat">累计 ' + stats.win + '胜 ' + stats.lose + '负 ' + stats.draw + '平 · 历史最高连得 ' + stats.maxStreak + '</div>' +
      (coinLine ? '<div class="pong-end-stat">' + coinLine + '</div>' : '') +
      (drop ? '<div class="pong-end-stat">🎁 掉落限定摆件「' + drop.name + '」</div>' : '');
    showOverlay(title, body, '再玩一次');
    // 写入聊天记录 + TA 回应
    try {
      if (window.chatAddSystem) {
        window.chatAddSystem('Pong · 你 ' + s.playerScore + ' : ' + s.opponentScore + ' TA' + (draw ? ' · 平局' : playerWin ? ' · 你赢' : ' · TA赢'), { special: 'pong' });
      }
      // TA 随机回应（按难度分语气）
      const dp = POOLS[s.diff] || POOLS.easy;
      const pool = draw ? dp.draw : (playerWin ? dp.player_win : dp.opponent_win);
      const reply = pool[Math.floor(Math.random() * pool.length)];
      setTimeout(() => {
        try {
          if (window.chatAddIn) window.chatAddIn(reply, { silent: true });
          else if (window.chatSendMsg) window.chatSendMsg(reply);
        } catch (e) {}
      }, 700);
    } catch (e) {}
  }

  // 击球点颜色教学：|hit| 越小（越靠中心）越绿，越大（越靠边角）越红
  function hitColor(hit) {
    const a = Math.abs(hit);
    if (a < 0.25) return '#4ade80';   // 绿
    if (a < 0.5)  return '#facc15';   // 黄
    if (a < 0.75) return '#fb923c';   // 橙
    return '#f87171';                  // 红
  }

  // ---- 渲染 ----
  function render(s, now) {
    const pH = s.params.paddleH, bR = s.params.ballR;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    // 背景
    ctx.fillStyle = '#0f1420';
    ctx.fillRect(0, 0, W, H);
    // 中线（虚线）
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);
    // 挡板：TA 在左，玩家在右。闪光时按击球点位置变色（中心绿/中段黄/边缘橙/边角红）教学
    const flashC = s.flashPaddle > 0 ? hitColor(s.lastHit) : '#e8eefc';
    ctx.fillStyle = flashC;
    ctx.fillRect(PADDLE_GAP, s.opponent.y, PADDLE_W, pH);
    ctx.fillStyle = flashC;
    ctx.fillRect(W - PADDLE_GAP - PADDLE_W, s.player.y, PADDLE_W, playerH(s));
    // 球（碰墙时轻微闪烁）
    const b = s.ball;
    ctx.fillStyle = s.flashWall > 0 ? '#ffe08a' : '#ffffff';
    ctx.beginPath(); ctx.arc(b.x, b.y, bR, 0, Math.PI * 2); ctx.fill();
    // 发球前方向预警箭头（休闲/简单档，发球前 500ms 在球起点显示 ←/→）
    if ((s.diff === 'casual' || s.diff === 'easy') && now != null) {
      let showArrow = false;
      if (s.status === 'countdown' && s.countdown <= 1 && now > s.countdownAt - 500) showArrow = true;
      if (s.status === 'scored' && now > s.scorePauseUntil - 500) showArrow = true;
      if (showArrow) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.serveDir < 0 ? '←' : '→', W / 2, H / 2);
        ctx.restore();
      }
    }
    // TA 表情/说话泡泡（挡板上方，1.2 秒消散，不挡视线）
    if (s.taBubble) {
      if (now != null && now < s.taBubble.until) {
        const left = (s.taBubble.until - now) / 1200;
        ctx.save();
        ctx.globalAlpha = Math.min(1, left * 1.5);
        ctx.textAlign = 'center';
        const bx = PADDLE_GAP + PADDLE_W / 2;
        // 表情 emoji
        ctx.font = '18px sans-serif';
        ctx.textBaseline = 'bottom';
        const by = Math.max(22, s.opponent.y - 6);
        ctx.fillText(s.taBubble.emoji, bx, by);
        // 说话文字（若有，在 emoji 上方）
        if (s.taBubble.text) {
          ctx.font = '11px sans-serif';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillText(s.taBubble.text, bx, by - 18);
        }
        ctx.restore();
      } else if (now != null) {
        s.taBubble = null;
      }
    }
    // 倒计时 / 得分暂停提示
    ctx.restore();
  }

  let scoreCache = { key: '', flash: -1 };
  function renderScore(s) {
    if (!scoreEl) return;
    // FIX 2026-09-16：原每帧重写 innerHTML + cssText（60fps 强制 DOM 重建/布局）——比分只在得分时变，
    // 改脏标记：分数变了才重建 HTML，缩放档位变了才写 transform。
    const key = s.opponentScore + ':' + s.playerScore;
    if (scoreCache.key !== key) {
      scoreCache.key = key;
      // v3.11.x：比分左右位与挡板侧一致——TA 挡板在左显示在左，玩家（你）在右
      scoreEl.innerHTML = '<span class="pong-s-ta">' + s.opponentScore + ' ' + (window.taFit ? window.taFit('TA') : 'TA') + '</span><span class="pong-s-sep">:</span><span class="pong-s-you">你 ' + s.playerScore + '</span>';
    }
    const flash = s.flashScore > 0 ? Math.round(s.flashScore * 20) / 20 : 0;
    if (scoreCache.flash !== flash) {
      scoreCache.flash = flash;
      scoreEl.style.cssText = flash > 0 ? 'transform:scale(' + (1 + flash * 0.3) + ')' : '';
    }
  }

  function renderHint(s, now) {
    if (!hintEl) return;
    if (s.status === 'countdown') {
      hintEl.textContent = s.countdown > 0 ? String(s.countdown) : '开始！';
    } else if (s.status === 'scored') {
      hintEl.textContent = '得分 · 重新发球…';
    } else if (s.status === 'rally') {
      hintEl.textContent = '';
    } else {
      hintEl.textContent = '';
    }
  }

  // ---- 主循环 ----
  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    // FIX 2026-09-16：切后台回来 dt 累积成数十秒，guard=5 只限每帧步数——球会快进到自动打完整局，钳到 250ms
    const dt = Math.min(ts - lastTs, 250);
    lastTs = ts;
    acc += dt;
    applyKeys();
    const frame = 1000 / FPS;
    let guard = 0;
    while (acc >= frame && guard < 5) {
      step(state, ts);
      acc -= frame;
      guard++;
    }
    render(state, ts);
    renderScore(state);
    renderHint(state, ts);
    rafId = requestAnimationFrame(loop);
  }

  // ---- Canvas 尺寸适配（DPR 清晰） ----
  // #784（#774 同族根治）：iOS 独立应用/安卓 Chrome 视口抖动期 resize 逐事件同步重铺——
  // 给 canvas.width 赋值哪怕同值也清空位图＝白闪一次，全屏 availH 又跟着抖动量＝画布来回脉冲。
  // 改为「先算几何，与上次铺设一致整条跳过（幂等）」；resize 侧另走 280ms 落定闸门（onViewportChange）。
  let lastFitGeo = '';
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const box = canvas.parentElement;   // .pong-canvas-box
    let geo, apply;
    if (isFs) {
      // 全屏：按视口计算 canvas 最大尺寸（保持 4:3 比例），显式设置 canvas + canvas-box
      const availW = window.innerWidth - 16;
      // FIX 2026-09-16：高度魔数 innerHeight-200 在头部换行/字号变化时不准——改为逐块量同列兄弟块实高，
      // 量不到（未布局）回退魔数（breakout 同款做法）
      let availH = window.innerHeight - 200;
      if (box && box.parentElement && box.parentElement.clientHeight > 0) {
        let h = box.parentElement.clientHeight;
        Array.prototype.forEach.call(box.parentElement.children, function (el) {
          if (el === box || !el.offsetHeight) return;
          h -= el.offsetHeight;
        });
        if (h >= 120) availH = h;
      }
      let cw = availW;
      let ch = Math.round(cw * H / W);
      if (ch > availH) { ch = availH; cw = Math.round(ch * W / H); }
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
      const chCss = (rect.width * H / W) + 'px';
      geo = 'nf|' + dpr + '|' + rect.width + 'x' + chCss;
      apply = function () {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas.style.width = '';
        canvas.style.height = chCss;
        if (box) { box.style.width = ''; box.style.height = ''; }
      };
    }
    if (geo === lastFitGeo) return;
    lastFitGeo = geo;
    apply();
  }

  // ---- 覆盖层（开始 / 结束） ----
  function showOverlay(title, body, btn) {
    if (!overlayEl) return;
    if (overlayTitleEl) overlayTitleEl.innerHTML = title || '';
    if (overlayBodyEl) overlayBodyEl.innerHTML = body || '';
    if (overlayBtnEl) overlayBtnEl.textContent = btn || '开始';
    overlayEl.hidden = false;
  }
  function hideOverlay() { if (overlayEl) overlayEl.hidden = true; }

  // ---- 开始 / 停止 ----
  function startGame(diff) {
    state = newState(diff || 'easy');
    state.status = 'countdown';
    state.countdown = 3;
    state.countdownAt = performance.now() + 400;
    hideOverlay();
    fitCanvas();
    clearSaved();
    paused = false;
    if (pauseBtn) pauseBtn.textContent = '⏸';
    running = true;
    lastTs = 0; acc = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }
  function stopGame() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ---- 保存 / 恢复对局（localStorage，每联系人独立） ----
  // FIX 2026-09-12 #349 存档键曾冻结在【页面加载时】的桌面 cid——加载后在别的桌面开乒乓，
  // 继续/保存读写的还是加载时那个桌面的存档（跨桌面串档，任何机型必现）。
  // 改为每次读写动态取（同本文件 statsKey 的做法）。
  function saveKey() { return (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':pong-saved'; }
  let paused = false;
  function canSave(s) {
    // 对局已经开始（有比分或球已发）才保存；纯倒计时/已结束不保存
    return s && s.status !== 'ended' && (s.playerScore + s.opponentScore > 0 || s.status === 'rally' || s.status === 'scored');
  }
  function saveGame() {
    try {
      if (!canSave(state)) { localStorage.removeItem(saveKey()); return; }
      const s = state;
      // 清除时间相对字段（恢复时重置）
      const clone = JSON.parse(JSON.stringify(s));
      clone.countdownAt = 0; clone.scorePauseUntil = 0;
      clone.opponent.aiNextAt = 0; clone.opponent.reactUntil = 0;
      clone._cdLen = null;
      localStorage.setItem(saveKey(), JSON.stringify(clone));
    } catch (e) {}
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(saveKey());
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.status === 'ended') return null;
      return s;
    } catch (e) { return null; }
  }
  function clearSaved() { try { localStorage.removeItem(saveKey()); } catch (e) {} }
  function resumeGame() {
    const s = loadSaved();
    if (!s) return false;
    // 恢复：重置时间字段，强制 rally（球位置/速度都在，直接继续）
    s.status = 'rally';
    s.countdownAt = 0; s.scorePauseUntil = 0;
    s.opponent.aiNextAt = 0; s.opponent.reactUntil = 0;
    s.params = DIFFS[s.diff] || DIFFS.easy;
    state = s;
    hideOverlay();
    fitCanvas();
    paused = false;
    if (pauseBtn) pauseBtn.textContent = '⏸';
    running = true;
    lastTs = 0; acc = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    return true;
  }

  // ---- 暂停 / 继续 ----
  function togglePause() {
    if (!state || state.status === 'ended') return;
    paused = !paused;
    if (paused) {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (pauseBtn) pauseBtn.textContent = '▶';
      if (hintEl) hintEl.textContent = '已暂停';
    } else {
      running = true;
      lastTs = 0; acc = 0;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
      if (pauseBtn) pauseBtn.textContent = '⏸';
    }
  }

  // ---- 全屏（游戏面板占满视口，沉浸式） ----
  let isFs = false;
  function toggleFs() {
    isFs = !isFs;
    if (panel) panel.classList.toggle('pong-fs', isFs);
    if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
    // 全屏过渡后重适配 canvas
    setTimeout(() => { if (panel && !panel.hidden) fitCanvas(); }, 60);
  }

  // ---- 输入：触摸 / 鼠标拖动（左半边控制玩家挡板） ----
  function inputY(clientY) {
    if (!state || state.status === 'ended') return;
    const rect = canvas.getBoundingClientRect();
    const y = (clientY - rect.top) / rect.height * H;
    const pH = playerH(state);
    state.player.targetY = Math.max(0, Math.min(H - pH, y - pH / 2));
  }
  let touching = false;
  canvas.addEventListener('touchstart', (e) => {
    if (!running) return;
    touching = true;
    const t = e.touches[0];
    if (t) inputY(t.clientY);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!running || !touching) return;
    const t = e.touches[0];
    if (t) inputY(t.clientY);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { touching = false; });
  canvas.addEventListener('mousedown', (e) => { if (running) { touching = true; inputY(e.clientY); } });
  canvas.addEventListener('mousemove', (e) => { if (running && touching) inputY(e.clientY); });
  window.addEventListener('mouseup', () => { touching = false; });

  // 键盘：↑↓ / WS
  const keys = {};
  document.addEventListener('keydown', (e) => {
    if (!running || !panel || panel.hidden) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w' || k === 'arrowdown' || k === 's') {
      keys[k] = true;
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys[k]) keys[k] = false;
  });
  // FIX 2026-09-16：按住方向键切走窗口（来电/alt-tab）keyup 丢失，回来挡板自己漂移到边界——失焦即清键
  window.addEventListener('blur', () => { Object.keys(keys).forEach((k) => { keys[k] = false; }); });
  // 键盘挡板目标持续移动（并入主循环；FIX 2026-09-16：原模块级 60Hz setInterval 面板关闭后仍空转耗电，已删）
  function applyKeys() {
    if (!running || !state) return;
    let dy = 0;
    if (keys['arrowup'] || keys['w']) dy -= PLAYER_MAX_SPEED;
    if (keys['arrowdown'] || keys['s']) dy += PLAYER_MAX_SPEED;
    if (dy !== 0) {
      const pH = playerH(state);
      state.player.targetY = Math.max(0, Math.min(H - pH, state.player.targetY + dy));
    }
  }

  // ---- 难度选择 / 静音 / 关闭 ----
  function updateWinTip() {
    if (!winTipEl) return;
    const d = (diffSel && diffSel.value) || 'easy';
    const ws = (DIFFS[d] || DIFFS.easy).winScore;
    winTipEl.textContent = '先得 ' + ws + ' 分获胜';
  }
  if (diffSel) {
    diffSel.addEventListener('change', () => {
      updateWinTip();
      if (state && state.status === 'countdown') {
        // 倒计时阶段可改难度
        startGame(diffSel.value);
      } else if (state && (state.status === 'rally' || state.status === 'scored') && hintEl) {
        // FIX 2026-09-16：对局中改难度原先静默无效也不提示，改档提示「下一局生效」
        hintEl.textContent = '难度下一局生效';
      }
    });
  }
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      soundBtn.textContent = soundOn ? '🔊' : '🔇';
      soundBtn.classList.toggle('pong-sound-off', !soundOn);
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePongPanel(); });
  if (overlayBtnEl) overlayBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const diff = (diffSel && diffSel.value) || 'easy';
    startGame(diff);
  });
  if (pauseBtn) pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
  if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
  if (overlayBtn2El) overlayBtn2El.addEventListener('click', (e) => {
    e.stopPropagation();
    resumeGame();
  });

  // ---- 入口（供 chat.js 调用） ----
  window.openPongPanel = function () {
    if (!panel) return;
    if (partnerNameEl) {
      // v3.9.x：双人乒乓从聊天页进入（聊天域）——优先读聊天专用昵称，未设置回退桌面昵称
      try {
        const s = window.activeStore && window.activeStore();
        partnerNameEl.textContent = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || (window.taWord ? window.taWord() : 'TA');
      } catch (e) { partnerNameEl.textContent = window.taWord ? window.taWord() : 'TA'; }
    }
    if (isFs) toggleFs();   // 防上次全屏残留
    panel.hidden = false;
    lastFitGeo = '';   // #784 打开必重铺（原实现每次 fitCanvas 都重建位图＝顺带清台，幂等闸门后显式保留该语义）
    fitCanvas();
    paused = false;
    if (pauseBtn) pauseBtn.textContent = '⏸';
    updateWinTip();   // 按当前难度更新获胜分提示
    // 内存里还有进行中的对局（同会话关闭后重开）→ 直接继续
    if (canSave(state)) {
      state.status = 'rally';
      state.opponent.aiNextAt = 0; state.opponent.reactUntil = 0;
      hideOverlay();
      running = true; lastTs = 0; acc = 0;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
      return;
    }
    // 检查 localStorage 保存的对局（刷新页面后恢复）
    const saved = loadSaved();
    if (saved) {
      showOverlay('双人 Pong', '<div class="pong-start-tip">有未完成的对局<br>你 ' + saved.playerScore + ' : ' + saved.opponentScore + ' TA</div><div class="pong-start-ctrl">手机：按住画面上下拖动<br>电脑：↑↓ 或 W S</div>', '重新开始');
      if (overlayBtn2El) overlayBtn2El.hidden = false;
    } else {
      const curDiff = (diffSel && diffSel.value) || 'easy';
      const ws = (DIFFS[curDiff] || DIFFS.easy).winScore;
      // v3.11.x：提示与实际一致——玩家控制的是右侧挡板（原文案写"左侧"）
      showOverlay('双人 Pong', '<div class="pong-start-tip">你控制右侧挡板<br>先得 ' + ws + ' 分获胜</div><div class="pong-start-ctrl">手机：按住画面上下拖动<br>电脑：↑↓ 或 W S</div>', '开始');
      if (overlayBtn2El) overlayBtn2El.hidden = true;
    }
    stopGame();
  };
  window.closePongPanel = function () {
    if (canSave(state)) saveGame();   // 保存进行中的对局
    stopGame();
    if (isFs) toggleFs();
    if (panel) panel.hidden = true;
  };
  // 切换联系人桌面时关闭（chat.js 会触发 contact-switched）
  document.addEventListener('contact-switched', () => { try { closePongPanel(); } catch (e) {} });
  // FIX 2026-09-16：切后台自动存档+暂停（原只在关面板时存，iOS Safari 后台杀页面丢进行中对局）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running && state && state.status !== 'ended') { saveGame(); togglePause(); }
  });
  // 窗口尺寸变化时重适配（#784：抖动期不再逐事件重铺，视口安静 280ms 后再量一次）
  let refitSettle = 0;
  function onViewportChange() {
    clearTimeout(refitSettle);
    refitSettle = setTimeout(function () { if (panel && !panel.hidden) fitCanvas(); }, 280);
  }
  window.addEventListener('resize', onViewportChange);
})();
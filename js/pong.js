(function () { try {
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
const W = 400, H = 300;
const PADDLE_W = 8;
const PADDLE_GAP = 14;            // 挡板距边界
const INIT_SPEED = 4;
const SPEED_INC = 0.2;
const MAX_SPEED = 6.5;
const PLAYER_MAX_SPEED = 8.5;      // 玩家挡板最大速度（px/tick，提高让玩家更容易接快球）
const FPS = 60;
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
const SAY_POOLS = {
catch: ['接得好', '嘿', '看我的', '嘿咻'],
miss: ['哎呀', '差点', '哼', '没接住'],
score: ['哈', '接到啦', '嘿嘿', '得分']
};
let audioCtx = null, soundOn = true;
function beep(freq, dur, vol) {
if (!soundOn) return;
try {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
function sfxWall() { beep(380, 0.04, 0.14); }
function sfxPaddle() { beep(520, 0.05, 0.18); }
function sfxScore() { beep(300, 0.12, 0.2); }
function sfxWin() { beep(660, 0.18, 0.22); setTimeout(() => beep(880, 0.22, 0.22), 140); }
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
approachErr: 0, approachMiss: 0, prevVx: 0,
beh: {
active: null,               // {type, until}
cooldown: {},               // {type: ts}
consecCatch: 0              // TA 连续接球数
},
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
let nextY = y + vy * dt;
if (nextY < bR) {
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
function opponentAI(s, now) {
const b = s.ball, o = s.opponent, p = s.params;
const pH = p.paddleH;
const taX = PADDLE_GAP + PADDLE_W;
const ballToTa = b.vx < 0;   // 球正在向 TA（左）移动
let targetY = o.y;           // 默认保持
if (!ballToTa) {
const act = behActive(s, now);
if (act && act.type === 'shift') {
targetY = o.targetY;     // 保持上次选的站位
} else {
targetY = H / 2 - pH / 2 + (Math.random() * 20 - 10);
}
} else {
let predY = predictY(s, taX);
const predCenter = predY - pH / 2;
const act = behActive(s, now);
if (!act) {
const r = Math.random();
const beh = p.beh;
const dist = b.x - taX;
if (dist < 130 && dist > 30 && p.fumble > 0 && behCanTrigger(s, 'fumble', now) && r < p.fumble) {
behTrigger(s, 'fumble', now, 260 + Math.random() * 200);
const away = pH * (0.6 + Math.random() * 0.3);
predY += (predY > H / 2 ? -1 : 1) * away;
if (Math.random() < 0.5) predY = Math.max(p.ballR + 2, Math.min(H - p.ballR - 2, predY));
}
else if (dist > 180 && behCanTrigger(s, 'early', now) && r < beh.early) {
behTrigger(s, 'early', now, 600 + Math.random() * 400);
}
else if (behCanTrigger(s, 'slow', now) && r < beh.slow) {
behTrigger(s, 'slow', now, 200 + Math.random() * 200);
o.reactUntil = now + 180 + Math.random() * 180;
}
else if (behCanTrigger(s, 'drift', now) && r < beh.drift) {
behTrigger(s, 'drift', now, 400 + Math.random() * 300);
predY += (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 10);
}
else if (dist > 200 && behCanTrigger(s, 'shift', now) && r < beh.shift) {
behTrigger(s, 'shift', now, 1000 + Math.random() * 1000);
o.targetY = Math.max(0, Math.min(H - pH, predCenter + (Math.random() * 80 - 40)));
targetY = o.targetY;
return;   // 本帧直接用新站位
}
else if (behCanTrigger(s, 'miss', now) && r < beh.miss) {
behTrigger(s, 'miss', now, 300);
predY += (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 15);
}
else if (s.beh.consecCatch >= 5 && behCanTrigger(s, 'risky', now) && r < beh.risky) {
behTrigger(s, 'risky', now, 800 + Math.random() * 600);
predY += (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 8);
}
} else {
if (act.type === 'drift' || act.type === 'miss' || act.type === 'risky' || act.type === 'fumble') {
}
if (act.type === 'slow') {
if (now < o.reactUntil) { targetY = o.targetY; return; }
}
}
predY += (s.approachErr || 0) + (s.approachMiss || 0);
targetY = predY - pH / 2;
}
o.targetY = Math.max(0, Math.min(H - pH, targetY));
}
function playerH(s) { return (s.params && (s.params.ppH || s.params.paddleH)) || 72; }
function movePaddle(paddle, targetY, maxSpeed, paddleH) {
const diff = targetY - paddle.y;
const step = Math.max(-maxSpeed, Math.min(maxSpeed, diff));
paddle.y += step;
paddle.vy = step;
paddle.y = Math.max(0, Math.min(H - paddleH, paddle.y));
}
function checkPaddle(s) {
const b = s.ball;
const bR = s.params.ballR, pH = s.params.paddleH, ppH = playerH(s);
const tx = PADDLE_GAP + PADDLE_W;
if (b.vx < 0 && b.x - bR <= tx && b.x - bR >= PADDLE_GAP - 4 && b.y >= s.opponent.y && b.y <= s.opponent.y + pH) {
b.x = tx + bR;
bouncePaddle(s, s.opponent, false);
}
const px = W - PADDLE_GAP - PADDLE_W;
if (b.vx > 0 && b.x + bR >= px && b.x + bR <= W - PADDLE_GAP + 4 && b.y >= s.player.y && b.y <= s.player.y + ppH) {
b.x = px - bR;
bouncePaddle(s, s.player, true);
}
}
function bouncePaddle(s, paddle, isPlayer) {
const b = s.ball;
const pH = isPlayer ? playerH(s) : s.params.paddleH;
const hit = (b.y - (paddle.y + pH / 2)) / (pH / 2);   // -1~1
s.lastHit = hit;                                       // 记录击球点用于挡板闪光颜色教学
s.rallyHits++;
const comboBonus = (s.diff === 'casual' || s.diff === 'easy') && isPlayer && s.playerRallyHits >= 3;
const newSpeed = comboBonus ? b.speed : Math.min(s.params.maxBall || MAX_SPEED, INIT_SPEED + s.rallyHits * SPEED_INC);
b.speed = newSpeed;
const ang = hit * (Math.PI / 3.2);   // 最大约 56°
b.vx = (isPlayer ? -1 : 1) * Math.cos(ang) * newSpeed;
b.vy = Math.sin(ang) * newSpeed;
s.flashPaddle = 1;
sfxPaddle();
if (soundOn && s.diff !== 'hard' && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
if (!isPlayer) {
s.beh.consecCatch++;
const cc = s.beh.consecCatch;
const emoji = cc >= 5 ? '🤩' : cc >= 3 ? '😎' : '😊';
tryTaSay(s, SAY_POOLS.catch, emoji, 0.4, 1500);   // 接球：40% 表情 + 1.5s 冷却（防每次都冒）
} else {
s.beh.consecCatch = 0;
s.playerRallyHits++;
}
}
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
function step(s, now) {
if (s.status === 'ended') return;
s.gameTime += 1000 / FPS;
if (s.status === 'countdown') {
if (now >= s.countdownAt) {
s.countdown--;
s.countdownAt = now + 700;
if (s.countdown <= 0) serve(s);
}
return;
}
if (s.status === 'scored') {
if (now >= s.scorePauseUntil) serve(s);
return;
}
if (s.status !== 'rally') return;
movePaddle(s.player, s.player.targetY, PLAYER_MAX_SPEED, playerH(s));
const b = s.ball;
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
movePaddle(s.opponent, s.opponent.targetY, s.params.maxSpeed, s.params.paddleH);
b.x += b.vx; b.y += b.vy;
const bR = s.params.ballR;
if (b.y - bR < 0) { b.y = bR; b.vy = -b.vy; s.flashWall = 1; sfxWall(); }
if (b.y + bR > H) { b.y = H - bR; b.vy = -b.vy; s.flashWall = 1; sfxWall(); }
checkPaddle(s);
if (b.x - bR > W) {
s.opponentScore++;
s.opponentStreak++; s.playerStreak = 0;
s.maxOpponentStreak = Math.max(s.maxOpponentStreak, s.opponentStreak);
s.totalRounds++;
s.beh.consecCatch = 0;
s.playerRallyHits = 0;
tryTaSay(s, SAY_POOLS.score, '😤', 0.75, 0);   // TA 得分：75% 表情，无冷却（关键事件）
onScore(s, now, 'opponent');
} else if (b.x + bR < 0) {
s.playerScore++;
s.playerStreak++; s.opponentStreak = 0;
s.maxPlayerStreak = Math.max(s.maxPlayerStreak, s.playerStreak);
s.totalRounds++;
s.beh.consecCatch = 0;
s.playerRallyHits = 0;
tryTaSay(s, SAY_POOLS.miss, '😅', 0.75, 0);   // TA 失误：75% 表情，无冷却（关键事件）
onScore(s, now, 'player');
}
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
function endGame(s, now) {
s.status = 'ended';
clearSaved();   // 对局已结束，清除保存
sfxWin();
const playerWin = s.playerScore > s.opponentScore;
const draw = s.playerScore === s.opponentScore;
const sec = Math.round((s.gameTime - 0) / 1000);
const fmt = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
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
let drop = null;
try {
if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('pong');
if (playerWin && window.arcadeTryDrop) drop = window.arcadeTryDrop('pong');
} catch (e) {}
const fit = window.taFit ? window.taFit : function (x) { return x; };
var coinLine = '';
try {
var COIN_CAP = 10400;
var day = (function () { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
var ck = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':ml2_coin_pong_' + day;
var cur = Number(localStorage.getItem(ck)) || 0;
if (cur < COIN_CAP) {
var pongWinFen = Math.random() < 0.2 ? 5200 : 1314;
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
try {
if (window.chatAddSystem) {
window.chatAddSystem('Pong · 你 ' + s.playerScore + ' : ' + s.opponentScore + ' TA' + (draw ? ' · 平局' : playerWin ? ' · 你赢' : ' · TA赢'), { special: 'pong' });
}
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
function hitColor(hit) {
const a = Math.abs(hit);
if (a < 0.25) return '#4ade80';   // 绿
if (a < 0.5)  return '#facc15';   // 黄
if (a < 0.75) return '#fb923c';   // 橙
return '#f87171';                  // 红
}
function render(s, now) {
const pH = s.params.paddleH, bR = s.params.ballR;
ctx.save();
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = '#0f1420';
ctx.fillRect(0, 0, W, H);
ctx.strokeStyle = 'rgba(255,255,255,0.18)';
ctx.lineWidth = 2;
ctx.setLineDash([6, 8]);
ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
ctx.setLineDash([]);
const flashC = s.flashPaddle > 0 ? hitColor(s.lastHit) : '#e8eefc';
ctx.fillStyle = flashC;
ctx.fillRect(PADDLE_GAP, s.opponent.y, PADDLE_W, pH);
ctx.fillStyle = flashC;
ctx.fillRect(W - PADDLE_GAP - PADDLE_W, s.player.y, PADDLE_W, playerH(s));
const b = s.ball;
ctx.fillStyle = s.flashWall > 0 ? '#ffe08a' : '#ffffff';
ctx.beginPath(); ctx.arc(b.x, b.y, bR, 0, Math.PI * 2); ctx.fill();
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
if (s.taBubble) {
if (now != null && now < s.taBubble.until) {
const left = (s.taBubble.until - now) / 1200;
ctx.save();
ctx.globalAlpha = Math.min(1, left * 1.5);
ctx.textAlign = 'center';
const bx = PADDLE_GAP + PADDLE_W / 2;
ctx.font = '18px sans-serif';
ctx.textBaseline = 'bottom';
const by = Math.max(22, s.opponent.y - 6);
ctx.fillText(s.taBubble.emoji, bx, by);
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
ctx.restore();
}
let scoreCache = { key: '', flash: -1 };
function renderScore(s) {
if (!scoreEl) return;
const key = s.opponentScore + ':' + s.playerScore;
if (scoreCache.key !== key) {
scoreCache.key = key;
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
function loop(ts) {
if (!running) return;
if (!lastTs) lastTs = ts;
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
let lastFitGeo = '';
function fitCanvas() {
const dpr = window.devicePixelRatio || 1;
const box = canvas.parentElement;   // .pong-canvas-box
let geo, apply;
if (isFs) {
const availW = window.innerWidth - 16;
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
function showOverlay(title, body, btn) {
if (!overlayEl) return;
if (overlayTitleEl) overlayTitleEl.innerHTML = title || '';
if (overlayBodyEl) overlayBodyEl.innerHTML = body || '';
if (overlayBtnEl) overlayBtnEl.textContent = btn || '开始';
overlayEl.hidden = false;
}
function hideOverlay() { if (overlayEl) overlayEl.hidden = true; }
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
function saveKey() { return (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':pong-saved'; }
let paused = false;
function canSave(s) {
return s && s.status !== 'ended' && (s.playerScore + s.opponentScore > 0 || s.status === 'rally' || s.status === 'scored');
}
function saveGame() {
try {
if (!canSave(state)) { localStorage.removeItem(saveKey()); return; }
const s = state;
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
let isFs = false;
function toggleFs() {
isFs = !isFs;
if (panel) panel.classList.toggle('pong-fs', isFs);
if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
setTimeout(() => { if (panel && !panel.hidden) fitCanvas(); }, 60);
}
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
window.addEventListener('blur', () => { Object.keys(keys).forEach((k) => { keys[k] = false; }); });
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
startGame(diffSel.value);
} else if (state && (state.status === 'rally' || state.status === 'scored') && hintEl) {
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
window.openPongPanel = function () {
if (!panel) return;
if (partnerNameEl) {
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
if (canSave(state)) {
state.status = 'rally';
state.opponent.aiNextAt = 0; state.opponent.reactUntil = 0;
hideOverlay();
running = true; lastTs = 0; acc = 0;
if (rafId) cancelAnimationFrame(rafId);
rafId = requestAnimationFrame(loop);
return;
}
const saved = loadSaved();
if (saved) {
showOverlay('双人 Pong', '<div class="pong-start-tip">有未完成的对局<br>你 ' + saved.playerScore + ' : ' + saved.opponentScore + ' TA</div><div class="pong-start-ctrl">手机：按住画面上下拖动<br>电脑：↑↓ 或 W S</div>', '重新开始');
if (overlayBtn2El) overlayBtn2El.hidden = false;
} else {
const curDiff = (diffSel && diffSel.value) || 'easy';
const ws = (DIFFS[curDiff] || DIFFS.easy).winScore;
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
document.addEventListener('contact-switched', () => { try { closePongPanel(); } catch (e) {} });
document.addEventListener('visibilitychange', () => {
if (document.hidden && running && state && state.status !== 'ended') { saveGame(); togglePause(); }
});
let refitSettle = 0;
function onViewportChange() {
clearTimeout(refitSettle);
refitSettle = setTimeout(function () { if (panel && !panel.hidden) fitCanvas(); }, 280);
}
window.addEventListener('resize', onViewportChange);
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("pong.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("pong.js"); try { console.error("[JS] pong.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[pong.js] " + String(__e && __e.message || __e)); } })();
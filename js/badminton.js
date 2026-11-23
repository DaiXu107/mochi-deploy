(function () { try {
/* ===== 功能：双人火柴人羽毛球（聊天页更多功能 → 小游戏 → 羽毛球） =====
2026-11-22 新增。玩法：拖动走位 + 点击挥拍；低位起高远球（保证过网）、高位平抽/杀球。
球落地/挂网判分，先到 N 分获胜；结束后写一条 special:'badminton' 记录 + TA 一句回应。
难度按联系人记住（badminton-diff），音效可关；全屏复用 .game-fs。
物理关键：旧参数 vy 只有 -3.5，抛物线最高点仍在网顶以下＝永远挂网（已按反解重定参）。
*/
(function () {
var panel = document.getElementById('chat-badminton-panel');
if (!panel) return;
var canvas = document.getElementById('bam-canvas');
if (!canvas) return;
var ctx = canvas.getContext('2d');
var scoreEl = document.getElementById('bam-score');
var hintEl = document.getElementById('bam-hint');
var overlay = document.getElementById('bam-overlay');
var ovTitle = document.getElementById('bam-overlay-title');
var ovBody = document.getElementById('bam-overlay-body');
var ovBtn = document.getElementById('bam-overlay-btn');
var closeBtn = document.getElementById('bam-close');
var diffSel = document.getElementById('bam-diff');
var soundBtn = document.getElementById('bam-sound');
var pauseBtn = document.getElementById('bam-pause');
var fsBtn = document.getElementById('bam-fs');
var winTip = document.getElementById('bam-win-tip');
var nameEl = document.getElementById('bam-partner-name');
var btnCharm = document.getElementById('bam-charm');
var btnMagic = document.getElementById('bam-magic');
var cdCharmEl = document.getElementById('bam-charm-cd');
var cdMagicEl = document.getElementById('bam-magic-cd');
var charmTag = document.getElementById('bam-charm-stack');
var W = 400, H = 520;
var GROUND = 476, NET_X = 200, NET_TOP = GROUND - 122;
var P_HOME = 74, T_HOME = 326;
var P_LIMIT = [26, NET_X - 26], T_LIMIT = [NET_X + 26, W - 26];
var G = 0.20, DRAG = 0.996, HIT_R = 44;
var DIFF = {
casual: { aiSpeed: 1.5, aiReact: 16, aiErr: 34, win: 3, label: '休闲', missRate: 0.26, confuse: 0.75 },
easy:   { aiSpeed: 2.2, aiReact: 10, aiErr: 20, win: 5, label: '简单', missRate: 0.16, confuse: 0.68 },
normal: { aiSpeed: 3.0, aiReact: 5,  aiErr: 10, win: 5, label: '普通', missRate: 0.08, confuse: 0.60 }
};
var CHARM_CD = 180, MAGIC_CD = 180, CHARM_MIN = 0.45; // 3s（60fps）/ 移速下限
var CHARM_LINES = [
'就让我一球嘛，好不好～',
'哼，你都不让着我。',
'我不管，这球你要接不到才行。',
'拜托拜托，让我赢一次嘛。',
'你今天好厉害…可我有点累了。'
];
var diffKey = 'easy';
var muted = false;
function store() { try { return window.activeStore ? window.activeStore() : null; } catch (e) { return null; } }
function cfgGet(k) { try { var s = store(); return s ? s.get(k) : null; } catch (e) { return null; } }
function cfgSet(k, v) { try { var s = store(); if (s) s.set(k, String(v)); } catch (e) {} }
var S = null;
var rafId = 0, running = false, paused = false, isFs = false;
function newState() {
return {
you: 0, ta: 0, server: 'you', pause: 0, over: false,
P: { x: P_HOME, vx: 0, swing: 0, swingCd: 0 },
T: { x: T_HOME, vx: 0, swing: 0, swingCd: 0, err: 0, planFor: -1, hold: 0 },
sh: { x: P_HOME + 12, y: GROUND - 130, vx: 0, vy: 0, last: null, trail: [] },
decoys: [], magicArmed: false, charm: 0,
cdCharm: 0, cdMagic: 0, taMiss: 0,
rally: 0, maxRally: 0, t0: Date.now()
};
}
function fitCanvas() {
var dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(W * dpr);
canvas.height = Math.round(H * dpr);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
var box = canvas.parentElement;                 // .bam-box
var wrap = box && box.parentElement;            // .bam-wrap
var scroll = panel.querySelector('.poke-card-scroll');
var availW = (box && box.clientWidth) || 320;
var availH = 0;
try {
if (scroll && wrap) {
var cs = getComputedStyle(scroll);
var inner = scroll.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
var used = 0;
Array.prototype.forEach.call(wrap.children, function (el) {
if (el === box) return;
var st = getComputedStyle(el);
used += el.offsetHeight + (parseFloat(st.marginTop) || 0) + (parseFloat(st.marginBottom) || 0);
});
var rg = parseFloat(getComputedStyle(wrap).rowGap) || 8;
availH = inner - used - rg * Math.max(1, wrap.children.length - 1);
}
} catch (e) {}
if (!(availH > 140)) {
availH = panel.classList.contains('game-fs')
? (window.innerHeight - 210)
: Math.min(Math.round((window.innerHeight || 800) * 0.5), 400);
}
var w = Math.min(availW, Math.round(availH * W / H));
if (w < 180) w = Math.min(availW, 180);
canvas.style.width = w + 'px';
canvas.style.height = Math.round(w * H / W) + 'px';
draw();
}
var AC = null;
function beep(f, d) {
if (muted) return;
try {
if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
var o = AC.createOscillator(), g = AC.createGain();
o.type = 'triangle'; o.frequency.value = f;
g.gain.value = 0.05;
o.connect(g); g.connect(AC.destination);
o.start(); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + d);
o.stop(AC.currentTime + d);
} catch (e) {}
}
function racketPos(who) {
var p = who === 'you' ? S.P : S.T;
var t = p.swing > 0 ? (1 - p.swing) : 0;
var base = who === 'you' ? -0.9 : Math.PI + 0.9;
var arc = who === 'you' ? 1.9 : -1.9;
var ang = base + arc * t;
var len = 26;
return { x: p.x + Math.cos(ang) * len, y: GROUND - 66 + Math.sin(ang) * len, ang: ang };
}
function flash(t) {
if (!hintEl) return;
hintEl.textContent = t || '';
clearTimeout(hintEl._t);
if (t) hintEl._t = setTimeout(function () { hintEl.textContent = ''; }, 700);
}
function updateHUD() {
if (!scoreEl || !S) return;
scoreEl.innerHTML = '<span class="pong-s-ta">' + S.ta + ' ' + (window.taFit ? window.taFit('TA') : 'TA') + '</span>' +
'<span class="pong-s-sep">:</span>' +
'<span class="pong-s-you">' + (window.taFit ? window.taFit('你') : '你') + ' ' + S.you + '</span>';
}
function reset(who, first) {
var dir = who === 'you' ? 1 : -1;
S.sh.x = who === 'you' ? S.P.x + 10 : S.T.x - 10;
S.sh.y = GROUND - 130;
S.sh.trail = [];
S.sh.last = null;
S.sh.vx = dir * (3.1 + Math.random() * 0.3);
S.sh.vy = -5.9 - Math.random() * 0.3;
S.rally = 0;
S.decoys = [];
S.msg = first ? '' : (who === 'you' ? '你发球' : (window.taFit ? window.taFit('TA 发球') : 'TA 发球'));
if (!first) flash(S.msg);
}
function score(who) {
if (!S || S.over) return;
S.decoys = []; S.magicArmed = false;
if (who === 'you') S.you++; else S.ta++;
updateHUD();
var d = DIFF[diffKey];
if (S.you >= d.win || S.ta >= d.win) { endGame(); return; }
S.server = who;
S.pause = 42;
flash(who === 'you' ? '你 +1' : (window.taFit ? window.taFit('TA +1') : 'TA +1'));
}
function hitBall(who, r) {
var sh = S.sh;
var dir = who === 'you' ? 1 : -1;
var off = (sh.y - r.y) / 26;
var high = sh.y < GROUND - 168;
if (high) {
sh.vx = dir * (5.0 + Math.random() * 0.5);
sh.vy = -(1.3 + Math.random() * 0.4) + off * 0.8;
} else {
sh.vx = dir * (3.5 + Math.random() * 0.35);
sh.vy = -(5.8 + Math.random() * 0.4) + off * 0.5;
}
sh.last = { x: sh.x, y: sh.y };
if (who === 'you' && S.magicArmed) {
S.magicArmed = false;
S.decoys = [];
for (var di = 0; di < 6; di++) {
var ang = (di / 6) * Math.PI * 2;
S.decoys.push({
x: sh.x, y: sh.y,
vx: sh.vx + Math.cos(ang) * 1.15,
vy: sh.vy + Math.sin(ang) * 0.9,
trail: []
});
}
flash('分身！');
beep(880, 0.08);
}
S.rally++;
if (S.rally > S.maxRally) S.maxRally = S.rally;
if (who === 'you') { beep(660, 0.05); S.P.swing = 0.35; } else { S.T.swing = 0.35; }
}
function swingPlayer() {
if (!running || paused || !S || S.over || S.P.swingCd > 0) return;
S.P.swing = 1; S.P.swingCd = 16;
beep(520, 0.05);
}
function swingTA() {
if (!S || S.over || S.T.swingCd > 0) return;
S.T.swing = 1; S.T.swingCd = 20;
}
function ai() {
var d = DIFF[diffKey], ta = S.T, sh = S.sh;
var incoming = sh.vx > 0.2 && sh.x > 90;
var target;
var speedMul = Math.max(CHARM_MIN, Math.pow(0.9, S.charm || 0));
if (incoming) {
if (ta.planFor !== S.rally) {
ta.planFor = S.rally;
ta.err = (Math.random() - 0.5) * d.aiErr;
ta.willMiss = Math.random() < d.missRate;
ta.goDecoy = false;
ta._missedShot = false;
if (S.decoys && S.decoys.length && Math.random() < d.confuse) {
var dd = S.decoys[Math.floor(Math.random() * S.decoys.length)];
ta.goDecoy = { x: dd.x, y: dd.y };
ta.willMiss = true;
} else {
ta.willMiss = ta.willMiss || false;
}
}
if (ta.goDecoy) {
target = ta.goDecoy.x;
} else {
var t = (GROUND - 30 - sh.y) / Math.max(0.4, sh.vy + 3);
target = sh.x + sh.vx * Math.min(26, t) + ta.err + (ta.willMiss ? 54 : 0); // 接不到＝明显跑偏
}
} else {
target = T_HOME + Math.sin(Date.now() / 700) * 6;
}
target = Math.max(T_LIMIT[0], Math.min(T_LIMIT[1], target));
var dx = target - ta.x, maxv = d.aiSpeed * speedMul;
ta.x += Math.max(-maxv, Math.min(maxv, dx));
var rt = racketPos('ta');
var dist = Math.hypot(sh.x - rt.x, sh.y - rt.y);
if (incoming && !ta.willMiss && dist < HIT_R - 6 && sh.y < GROUND - 10) {
if (ta.hold <= 0) { swingTA(); ta.hold = d.aiReact; } else ta.hold--;
} else if (ta.goDecoy) {
var dd2 = ta.goDecoy;
if (S.decoys && S.decoys.length && Math.hypot(dd2.x - rt.x, dd2.y - rt.y) < HIT_R && ta.swingCd <= 0) {
swingTA();
if (!ta._missedShot) { ta._missedShot = true; S.taMiss = (S.taMiss || 0) + 1; flash(window.taFit ? window.taFit('TA 扑空了') : 'TA 扑空了'); }
}
} else if (ta.hold > 0) ta.hold--;
}
function step() {
if (!S || S.over) return;
if (S.cdCharm > 0) S.cdCharm--;
if (S.cdMagic > 0) S.cdMagic--;
if (S.cdCharm % 6 === 0 || S.cdMagic % 6 === 0) syncActionUI();
if (S.pause > 0) { S.pause--; if (S.pause === 0) reset(S.server); }
var sh = S.sh, p = S.P, ta = S.T;
if (keys.ArrowLeft || keys.a) { p.x -= 3.2; p.vx = -3.2; }
if (keys.ArrowRight || keys.d) { p.x += 3.2; p.vx = 3.2; }
p.x = Math.max(P_LIMIT[0], Math.min(P_LIMIT[1], p.x));
if (p.swing > 0) { p.swing -= 0.075; if (p.swing < 0) p.swing = 0; }
if (p.swingCd > 0) p.swingCd--;
if (ta.swing > 0) { ta.swing -= 0.06; if (ta.swing < 0) ta.swing = 0; }
if (ta.swingCd > 0) ta.swingCd--;
if (S.pause <= 0) {
sh.vy += G; sh.vx *= DRAG; sh.vy *= DRAG;
sh.x += sh.vx; sh.y += sh.vy;
sh.trail.push({ x: sh.x, y: sh.y });
if (sh.trail.length > 9) sh.trail.shift();
if (sh.last && ((sh.last.x < NET_X && sh.x >= NET_X) || (sh.last.x > NET_X && sh.x <= NET_X))) {
if (sh.y > NET_TOP) {
sh.x = NET_X + (sh.vx > 0 ? -4 : 4);
sh.vx = -sh.vx * 0.25;
sh.vy = Math.abs(sh.vy) * 0.3 + 0.6;
beep(180, 0.08);
flash('挂网');
}
}
var rp = racketPos('you');
if (sh.x < NET_X - 2 && Math.hypot(sh.x - rp.x, sh.y - rp.y) < HIT_R && p.swing > 0.15) hitBall('you', rp);
var rt = racketPos('ta');
if (sh.x > NET_X + 2 && Math.hypot(sh.x - rt.x, sh.y - rt.y) < HIT_R && ta.swing > 0.12) hitBall('ta', rt);
if (sh.y >= GROUND - 4) {
sh.y = GROUND - 4;
beep(240, 0.12);
var side = sh.x < NET_X ? 'you' : 'ta';
score(side === 'you' ? 'ta' : 'you');
}
if (sh.x < -20 || sh.x > W + 20) score(sh.x < 0 ? 'ta' : 'you');
sh.last = { x: sh.x, y: sh.y };
for (var dk = 0; dk < S.decoys.length; dk++) {
var dc = S.decoys[dk];
dc.vy += G; dc.vx *= DRAG; dc.vy *= DRAG;
dc.x += dc.vx; dc.y += dc.vy;
dc.trail.push({ x: dc.x, y: dc.y });
if (dc.trail.length > 6) dc.trail.shift();
}
}
ai();
draw();
}
function draw() {
if (!ctx || !S) return;
ctx.clearRect(0, 0, W, H);
var bg = ctx.createLinearGradient(0, 0, 0, H);
bg.addColorStop(0, '#FCFBFD'); bg.addColorStop(1, '#F4F1F7');
ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
ctx.fillStyle = 'rgba(17,17,17,.06)'; ctx.fillRect(0, 14, W, 3);
for (var li = 0; li < 3; li++) {
var lx = 90 + li * 110;
ctx.beginPath(); ctx.arc(lx, 30, 4.5, 0, 7); ctx.fillStyle = 'rgba(255,214,140,.75)'; ctx.fill();
var gl = ctx.createRadialGradient(lx, 34, 2, lx, 34, 70);
gl.addColorStop(0, 'rgba(255,220,160,.16)'); gl.addColorStop(1, 'rgba(255,220,160,0)');
ctx.fillStyle = gl; ctx.fillRect(lx - 70, 34, 140, 140);
}
ctx.strokeStyle = 'rgba(17,17,17,.05)'; ctx.lineWidth = 1;
ctx.beginPath(); ctx.moveTo(NET_X, GROUND); ctx.lineTo(-40, H); ctx.stroke();
ctx.beginPath(); ctx.moveTo(NET_X, GROUND); ctx.lineTo(W + 40, H); ctx.stroke();
ctx.fillStyle = 'rgba(17,17,17,.045)'; ctx.fillRect(0, GROUND, W, H - GROUND);
ctx.strokeStyle = 'rgba(17,17,17,.10)';
ctx.beginPath(); ctx.moveTo(18, GROUND + 12); ctx.lineTo(W - 18, GROUND + 12); ctx.stroke();
ctx.strokeStyle = 'rgba(17,17,17,.12)';
[110, 290].forEach(function (x) { ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x, GROUND + 10); ctx.stroke(); });
ctx.strokeStyle = 'rgba(17,17,17,.34)'; ctx.lineWidth = 2;
ctx.beginPath(); ctx.moveTo(NET_X, NET_TOP); ctx.lineTo(NET_X, GROUND); ctx.stroke();
ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(17,17,17,.14)';
for (var y = NET_TOP + 8; y < GROUND; y += 8) { ctx.beginPath(); ctx.moveTo(NET_X - 5, y); ctx.lineTo(NET_X + 5, y); ctx.stroke(); }
ctx.fillStyle = 'rgba(17,17,17,.5)'; ctx.fillRect(NET_X - 8, NET_TOP - 4, 16, 4);
for (var i = 0; i < S.sh.trail.length; i++) {
var t = S.sh.trail[i], a = (i + 1) / S.sh.trail.length;
ctx.beginPath(); ctx.arc(t.x, t.y, 2.6 * a, 0, 7);
ctx.fillStyle = 'rgba(23,22,29,' + (0.06 + a * 0.1) + ')'; ctx.fill();
}
if (S.decoys && S.decoys.length) {
for (var q = 0; q < S.decoys.length; q++) {
ctx.save();
ctx.globalAlpha = 0.38;
drawShuttleAt(S.decoys[q].x, S.decoys[q].y, S.decoys[q].vx, S.decoys[q].vy);
ctx.restore();
}
}
drawStick('you', S.P, '#3a7fd5');
drawStick('ta', S.T, '#d5763a');
drawShuttle();
drawShadow();
}
function drawShadow() {
var sh = S.sh;
var k = Math.max(0, 1 - (GROUND - sh.y) / 220);
ctx.beginPath(); ctx.ellipse(sh.x, GROUND + 6, 7 * k + 2, 2.4 * k + 0.8, 0, 0, 7);
ctx.fillStyle = 'rgba(20,18,35,' + (0.05 + 0.12 * k) + ')'; ctx.fill();
}
function drawStick(who, p, color) {
var x = p.x, gy = GROUND;
var bob = Math.sin(Date.now() / (who === 'you' ? 220 : 260)) * (Math.abs(p.vx) > 0.4 ? 1.6 : 0.5);
var hipY = gy - 40 + bob, headY = gy - 78 + bob;
ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
ctx.beginPath(); ctx.arc(x, headY, 8.6, 0, 7); ctx.stroke();
ctx.beginPath(); ctx.moveTo(x, headY + 8.6); ctx.lineTo(x, hipY); ctx.stroke();
var spread = Math.min(12, 8 + Math.abs(p.vx) * 1.3);
ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x - spread * 0.7, gy); ctx.stroke();
ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x + spread * 0.7, gy); ctx.stroke();
var sx = x + (who === 'you' ? 8 : -8);
ctx.beginPath(); ctx.moveTo(x, headY + 14); ctx.lineTo(sx, headY + 30); ctx.stroke();
var r = racketPos(who);
ctx.beginPath(); ctx.moveTo(x, headY + 14); ctx.lineTo(r.x, r.y); ctx.stroke();
ctx.save();
ctx.translate(r.x, r.y); ctx.rotate(r.ang);
ctx.beginPath(); ctx.ellipse(9, 0, 9, 6.5, 0, 0, 7); ctx.stroke();
ctx.strokeStyle = 'rgba(23,22,29,.28)'; ctx.lineWidth = 1;
for (var i2 = -1; i2 <= 1; i2++) { ctx.beginPath(); ctx.moveTo(2, i2 * 3); ctx.lineTo(16, i2 * 3); ctx.stroke(); }
ctx.restore();
ctx.fillStyle = who === 'you' ? 'rgba(58,127,213,.85)' : 'rgba(213,118,58,.85)';
ctx.font = '600 8.5px "PingFang SC","Microsoft YaHei",sans-serif';
ctx.textAlign = 'center';
ctx.fillText(who === 'you' ? '你' : (window.taFit ? window.taFit('TA') : 'TA'), x, headY - 15);
ctx.textAlign = 'left';
if (p.swing > 0.05) {
ctx.beginPath(); ctx.arc(x, headY + 14, 32, r.ang - 0.8, r.ang, false);
ctx.strokeStyle = (who === 'you' ? 'rgba(58,127,213,.22)' : 'rgba(213,118,58,.22)');
ctx.lineWidth = 3; ctx.stroke();
}
}
function drawShuttle() {
var sh = S.sh;
drawShuttleAt(sh.x, sh.y, sh.vx, sh.vy);
}
function drawShuttleAt(x, y, vx, vy) {
ctx.save(); ctx.translate(x, y);
ctx.rotate(Math.atan2(vy, vx) + Math.PI / 2);
ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, 7);
ctx.fillStyle = '#f6f4fa'; ctx.strokeStyle = 'rgba(23,22,29,.75)'; ctx.lineWidth = 1.2;
ctx.fill(); ctx.stroke();
ctx.strokeStyle = 'rgba(23,22,29,.55)'; ctx.lineWidth = 1;
for (var i = -1; i <= 1; i++) {
ctx.beginPath(); ctx.moveTo(i * 2.2, -2); ctx.lineTo(i * 5.4, -14); ctx.stroke();
ctx.beginPath(); ctx.moveTo(i * 2.2, -2); ctx.lineTo(i * 1.6, -14); ctx.stroke();
}
ctx.beginPath(); ctx.moveTo(-5.4, -14); ctx.lineTo(5.4, -14); ctx.stroke();
ctx.restore();
}
var acc = 0, lastT = 0;
function loop(t) {
if (!running) return;
rafId = requestAnimationFrame(loop);
if (!lastT) lastT = t;
var dt = Math.min(50, t - lastT); lastT = t;
if (paused) return;
acc += dt;
while (acc >= 16.6667) { step(); acc -= 16.6667; }
}
function startLoop() {
running = true; paused = false;
if (rafId) cancelAnimationFrame(rafId);
lastT = 0; acc = 0;
rafId = requestAnimationFrame(loop);
}
function stopLoop() {
running = false;
if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
}
function showOverlay(title, bodyHtml, btnText) {
if (!overlay) return;
overlay.hidden = false;
if (ovTitle) ovTitle.textContent = title;
if (ovBody) ovBody.innerHTML = bodyHtml || '';
if (ovBtn) ovBtn.textContent = btnText || '开始';
}
function hideOverlay() { if (overlay) overlay.hidden = true; }
function startGame() {
S = newState();
diffKey = (diffSel && diffSel.value) || diffKey;
var d = DIFF[diffKey];
if (winTip) winTip.textContent = '先得 ' + d.win + ' 分';
updateHUD();
hideOverlay();
reset('you', true);
syncActionUI();
startLoop();
}
function endGame() {
if (!S || S.over) return;
S.over = true; stopLoop();
var youWin = S.you > S.ta, draw = S.you === S.ta;
var fit = window.taFit ? window.taFit : function (x) { return x; };
var sec = Math.round((Date.now() - (S.t0 || Date.now())) / 1000);
var mm = String(Math.floor(sec / 60)).padStart(2, '0'), ss = String(sec % 60).padStart(2, '0');
var statsKey = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':badminton-stats';
var stats = { win: 0, lose: 0, total: 0, maxRally: 0 };
try {
var raw = localStorage.getItem(statsKey);
if (raw) stats = Object.assign(stats, JSON.parse(raw));
if (draw) { /* 平局不常见，计 total */ } else if (youWin) stats.win++; else stats.lose++;
stats.total++; stats.maxRally = Math.max(stats.maxRally, S.maxRally || 0);
localStorage.setItem(statsKey, JSON.stringify(stats));
} catch (e) {}
showOverlay(youWin ? '🏆 你赢了' : (draw ? '平局' : fit('TA 赢了')),
'<div class="pong-end-score">' + fit('TA') + ' ' + S.ta + ' : ' + S.you + ' ' + fit('你') + '</div>' +
'<div class="pong-end-stat">最长对拉 ' + (S.maxRally || 0) + ' 拍 · 用时 ' + mm + ':' + ss + '</div>' +
'<div class="pong-end-stat">累计 ' + stats.win + '胜 ' + stats.lose + '负 · 历史最长 ' + stats.maxRally + ' 拍</div>',
'再玩一次');
var POOL = {
win: ['这球路可以啊，我都没接住。', '再来一局，我不信还输。', '你今天手感真好。'],
lose: ['还差一点，下次就能赢我。', '别急，多打几局就顺了。', '我让着你的。'],
draw: ['平局，扯平了。', '再来一局分个胜负？']
};
try {
if (window.chatAddSystem) {
window.chatAddSystem('羽毛球 · 你 ' + S.you + ' : ' + S.ta + ' ' + fit('TA') + (youWin ? ' · 你赢' : draw ? ' · 平局' : ' · ' + fit('TA') + '赢'), { special: 'badminton' });
}
var pool = draw ? POOL.draw : (youWin ? POOL.win : POOL.lose);
var reply = pool[Math.floor(Math.random() * pool.length)];
setTimeout(function () {
try { if (window.chatAddIn) window.chatAddIn(reply, { silent: true }); } catch (e) {}
}, 700);
} catch (e) {}
}
var keys = {};
var drag = null;
function toLogicalX(clientX) {
var r = canvas.getBoundingClientRect();
return (clientX - r.left) / r.width * W;
}
canvas.addEventListener('pointerdown', function (e) {
if (!running || paused) return;
drag = { x0: e.clientX, moved: false };
if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (e2) {} }
});
canvas.addEventListener('pointermove', function (e) {
if (!drag || !S) return;
if (Math.abs(e.clientX - drag.x0) > 6) drag.moved = true;
if (drag.moved) { S.P.x = Math.max(P_LIMIT[0], Math.min(P_LIMIT[1], toLogicalX(e.clientX))); S.P.vx = 0; }
});
canvas.addEventListener('pointerup', function () {
if (!drag) return;
if (!drag.moved) swingPlayer();
drag = null;
});
canvas.addEventListener('pointercancel', function () { drag = null; });
window.addEventListener('keydown', function (e) {
keys[e.key] = true;
if (e.key === ' ' && running && !paused) { e.preventDefault(); swingPlayer(); }
});
window.addEventListener('keyup', function (e) { keys[e.key] = false; });
if (ovBtn) ovBtn.addEventListener('click', startGame);
if (btnCharm) btnCharm.addEventListener('click', doCharm);
if (btnMagic) btnMagic.addEventListener('click', doMagic);
if (closeBtn) closeBtn.addEventListener('click', function () {
stopLoop(); panel.hidden = true;
});
if (diffSel) {
try {
var saved = cfgGet('badminton-diff');
if (saved && DIFF[saved]) diffSel.value = saved;
diffKey = diffSel.value || diffKey;
} catch (e) {}
diffSel.addEventListener('change', function () {
diffKey = diffSel.value;
cfgSet('badminton-diff', diffKey);
if (winTip) winTip.textContent = '先得 ' + DIFF[diffKey].win + ' 分';
});
}
if (soundBtn) soundBtn.addEventListener('click', function () {
muted = !muted;
soundBtn.textContent = muted ? '🔇' : '🔊';
soundBtn.classList.toggle('pong-sound-off', muted);
});
if (pauseBtn) pauseBtn.addEventListener('click', function () {
if (!S || S.over) return;
paused = !paused;
pauseBtn.textContent = paused ? '▶' : '⏸';
flash(paused ? '已暂停' : '');
});
if (fsBtn) fsBtn.addEventListener('click', function () {
isFs = !isFs;
panel.classList.toggle('game-fs', isFs);
fsBtn.textContent = isFs ? '⤢' : '⛶';
setTimeout(fitCanvas, 60);
});
window.addEventListener('resize', function () { if (!panel.hidden) fitCanvas(); });
function syncActionUI() {
if (!S) return;
var cLock = S.cdCharm > 0, mLock = S.cdMagic > 0;
if (btnCharm) btnCharm.classList.toggle('is-cd', cLock);
if (btnMagic) btnMagic.classList.toggle('is-cd', mLock || S.magicArmed);
if (cdCharmEl) cdCharmEl.textContent = cLock ? (S.cdCharm / 60).toFixed(1) : '';
if (cdMagicEl) cdMagicEl.textContent = mLock ? (S.cdMagic / 60).toFixed(1) : (S.magicArmed ? '待发' : '');
if (charmTag) {
charmTag.hidden = !(S.charm > 0);
charmTag.textContent = S.charm > 0 ? ('TA 移速 -' + Math.min(55, S.charm * 10) + '%') : '';
}
}
function doCharm() {
if (!S || S.over || !running || paused || S.cdCharm > 0) {
if (S && S.cdCharm > 0) flash('撒娇冷却中');
return;
}
S.cdCharm = CHARM_CD;
S.charm = (S.charm || 0) + 1;
var line = CHARM_LINES[Math.floor(Math.random() * CHARM_LINES.length)];
beep(700, 0.06);
flash('撒娇 · ' + (window.taFit ? window.taFit('TA') : 'TA') + ' 移速 -' + Math.min(55, S.charm * 10) + '%');
try { if (window.chatAddIn) window.chatAddIn(line, { silent: true }); } catch (e) {}
syncActionUI();
}
function doMagic() {
if (!S || S.over || !running || paused || S.cdMagic > 0 || S.magicArmed) {
if (S && S.cdMagic > 0) flash('魔法冷却中');
return;
}
S.cdMagic = MAGIC_CD;
S.magicArmed = true;
beep(920, 0.09);
flash('魔法待发 · 下一拍带 6 个分身');
syncActionUI();
}
window.__bam = { state: function () { return S; }, start: startGame, end: endGame, diff: function () { return diffKey; } };
window.openBadmintonPanel = function () {
if (nameEl) {
try {
var s = store();
nameEl.textContent = (s && (s.get('cs-lbl-partner') || s.get('lbl-partner'))) || (window.taWord ? window.taWord() : 'TA');
} catch (e) { nameEl.textContent = 'TA'; }
}
if (isFs) { isFs = false; panel.classList.remove('game-fs'); if (fsBtn) fsBtn.textContent = '⛶'; }
panel.hidden = false;
fitCanvas();
if (S && !S.over && running) { hideOverlay(); return; }
var d = DIFF[(diffSel && diffSel.value) || diffKey] || DIFF.easy;
if (winTip) winTip.textContent = '先得 ' + d.win + ' 分';
showOverlay('双人羽毛球',
'<div class="pong-start-tip">拖动身子左右移动，靠近球时点一下挥拍<br>低位起高远球 · 高位平抽，先得 ' + d.win + ' 分获胜</div>' +
'<div class="pong-start-ctrl">手机：按住画面拖动 · 点一下挥拍<br>电脑：← → 移动 · 空格挥拍</div>',
'开始');
if (!S) { S = newState(); updateHUD(); draw(); }
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("badminton.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("badminton.js"); try { console.error("[JS] badminton.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[badminton.js] " + String(__e && __e.message || __e)); } })();
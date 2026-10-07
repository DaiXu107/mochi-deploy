(function () { try {
(function () {
const panel = document.getElementById('chat-flight-panel');
if (!panel) return;
const canvas = document.getElementById('fc-canvas');
const partnerNameEl = document.getElementById('fc-partner-name');
const sideNameEl = document.getElementById('fc-side-name');
const userSideEl = document.getElementById('fc-user-side');
const partnerSideEl = document.getElementById('fc-partner-side');
const overlayEl = document.getElementById('fc-overlay');
const ovTitleEl = document.getElementById('fc-ov-title');
const ovBodyEl = document.getElementById('fc-ov-body');
const startBtn = document.getElementById('fc-btn-start');
const startBtn2 = document.getElementById('fc-btn-start2');
const rollBtn = document.getElementById('fc-roll');
const diceSceneEl = document.getElementById('fc-dice');
const diceCubeEl = document.getElementById('fc-dice-cube');
const statusEl = document.getElementById('fc-status');
const soundBtn = document.getElementById('fc-sound');
const fsBtn = document.getElementById('fc-fs');
const closeBtn = document.getElementById('fc-close');
const T = window.taFit || function (x) { return x; };
const W = 1024;
const H = 993;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d');
const boardImg = new Image();
let boardReady = false;
boardImg.onload = function () { boardReady = true; draw(); };
boardImg.src = 'assets/fc-board.jpg';
const PATH_PX = [
[122, 345], [180, 315], [233, 333], [292, 345], [340, 290],
[340, 235], [343, 179], [352, 128], [399, 101], [457, 101],
[511, 101], [570, 101], [625, 101],
[681, 122], [706, 181], [705, 236], [682, 295], [718, 335],
[789, 339], [843, 339], [918, 335], [920, 403], [920, 458],
[922, 512], [921, 565], [920, 620],
[901, 676], [843, 676], [789, 676], [731, 679], [707, 733],
[705, 787], [687, 843], [695, 910], [622, 922], [567, 922],
[512, 922], [455, 915], [400, 915],
[341, 903], [341, 839], [340, 787], [341, 728], [290, 674],
[233, 674], [180, 674], [121, 674], [100, 620], [100, 565],
[99, 512], [100, 458], [100, 404]
];
const START = [0, 13, 26, 39];
const ENTRY = [49, 10, 23, 36];
const HOME_PX = [
[[181, 512], [235, 512], [290, 512], [345, 512], [400, 512]],
[[512, 179], [512, 235], [512, 290], [512, 344], [512, 400]],
[[843, 511], [788, 512], [735, 512], [679, 512], [623, 512]],
[[512, 843], [512, 789], [512, 734], [512, 679], [512, 623]]
];
const FINISH_PX = [[463, 512], [512, 463], [560, 512], [512, 560]];
const BASE_PX = [
[[103, 104], [188, 104], [103, 187], [187, 187]],
[[836, 101], [920, 103], [837, 188], [921, 188]],
[[835, 837], [921, 837], [835, 920], [922, 921]],
[[103, 836], [187, 835], [103, 922], [187, 921]]
];
const THEMES = [
{ key: 'yellow', label: '星星', emoji: '⭐', main: '#f0a831', light: '#ffe7b3', dark: '#b8770f', base: '#fff4d6' },
{ key: 'blue', label: '海豚', emoji: '🐬', main: '#3d8bfd', light: '#d8e9ff', dark: '#2563c4', base: '#eaf3ff' },
{ key: 'pink', label: '小鱼', emoji: '🐟', main: '#ee7fb5', light: '#ffe0ef', dark: '#c34f86', base: '#ffeaf4' },
{ key: 'green', label: '海草', emoji: '🌿', main: '#43b784', light: '#d6f3e4', dark: '#2f8c61', base: '#e8f8ef' }
];
const PAIRS = [[0, 2], [1, 3]];
const SPECIALS = {
1: 'bump', 4: 'adv2', 5: 'adv3', 7: 'again', 11: 'tempt', 12: 'back1',
17: 'adv2', 19: 'shield', 20: 'back1', 22: 'adv3', 25: 'burn',
27: 'again', 30: 'adv2', 31: 'adv3', 33: 'again', 37: 'horror', 38: 'back1',
41: 'adv3', 43: 'adv2', 45: 'back1', 48: 'again', 50: 'adv3'
};
const HOME_SPECIALS = [
{ 2: 'shield', 3: 'out' },
{ 2: 'tempt', 3: 'out' },
{ 2: 'bump', 3: 'out' },
{ 2: 'horror', 3: 'out' }
];
const SPECIAL_META = {
adv2: { icon: '➡️', label: '前进2' },
adv3: { icon: '➡️', label: '前进3' },
back1: { icon: '⬅️', label: '后退1' },
back2: { icon: '⬅️', label: '后退2' },
again: { icon: '🎲', label: '再来一次' },
out: { icon: '💥', label: '出局' },
bump: { icon: '🚗', label: '碰碰车' },
shield: { icon: '📝', label: '护盾' },
burn: { icon: '🔥', label: '后退2' },
tempt: { icon: '🍰', label: '停一回合' },
horror: { icon: '🎁', label: '恐怖箱' }
};
let st = null;
let pairIdx = 0;
let taTimer = null;
let isFs = false;
let soundOn = true;
let audioCtx = null;
function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
function statsKey() { return prefix() + ':fc-stats'; }
function loadStats() {
const d = { w: 0, l: 0 };
try {
const raw = localStorage.getItem(statsKey());
if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
} catch (e) {}
return d;
}
function saveStats(s) { try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch (e) {} }
function partnerName() {
let name = T('TA');
try {
const s = window.activeStore && window.activeStore();
name = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || name;
} catch (e) {}
return name;
}
function beep(freq, dur, vol) {
if (!soundOn) return;
try {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const play = () => {
try {
const o = audioCtx.createOscillator(), g = audioCtx.createGain();
o.frequency.value = freq; o.type = 'sine';
g.gain.value = vol || 0.14;
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
const sfxRoll = () => beep(520, 0.07, 0.12);
const sfxMove = () => beep(360, 0.08, 0.16);
const sfxCapture = () => { beep(220, 0.08, 0.16); setTimeout(() => beep(180, 0.1, 0.14), 70); };
const sfxWin = () => { beep(660, 0.12, 0.16); setTimeout(() => beep(880, 0.2, 0.16), 120); };
function newState(pair) {
return {
pair: pair,
turn: 0,
pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1]],
shields: [[false, false, false, false], [false, false, false, false]],
skip: [false, false],
finished: [0, 0],
dice: 0,
rolled: false,
busy: false,
movable: [],
over: false,
winner: -1
};
}
function themeIdx(side) { return st ? st.pair[side] : PAIRS[pairIdx][side]; }
function themeOf(side) { return THEMES[themeIdx(side)]; }
function startOf(side) { return START[themeIdx(side)]; }
function entryOf(side) { return ENTRY[themeIdx(side)]; }
function px(point) { return { x: point[0], y: point[1] }; }
function baseCenter(ti, idx) { return px(BASE_PX[ti][idx]); }
function pieceCenter(side, idx) {
const pos = st.pieces[side][idx];
const ti = themeIdx(side);
if (pos === -1) return baseCenter(ti, idx);
if (pos === 200) return px(FINISH_PX[ti]);
if (pos >= 100) return px(HOME_PX[ti][pos - 100]);
return px(PATH_PX[pos]);
}
const DICE_FACE_TF = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 2: [90, 0] };
let diceShown = 1;
let diceAnim = null;
function diceRestTransform(n) {
const f = DICE_FACE_TF[n] || DICE_FACE_TF[1];
return 'rotateX(' + (f[0] - 18) + 'deg) rotateY(' + (f[1] + 24) + 'deg)';
}
function setDice(n) {
if (!diceCubeEl) return;
diceShown = n || 1;
if (diceAnim) { try { diceAnim.cancel(); } catch (e) {} diceAnim = null; }
diceCubeEl.style.transition = 'transform .45s cubic-bezier(.34,1.3,.5,1)';
diceCubeEl.style.transform = diceRestTransform(diceShown);
}
function rollAnim(n, done) {
if (!diceCubeEl || !diceCubeEl.animate) { if (done) done(); return; }
try {
const kfs = [{ transform: diceRestTransform(diceShown), offset: 0 }];
let rx = 0, ry = 0;
for (let i = 0; i < 3; i++) {
rx += 300 + Math.floor(Math.random() * 360);
ry += 300 + Math.floor(Math.random() * 360);
const rz = Math.floor(Math.random() * 180) - 90;
kfs.push({ transform: 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) rotateZ(' + rz + 'deg) scale(1.14)', offset: 0.2 + i * 0.2 });
}
const f = DICE_FACE_TF[n];
const finalRx = f[0] - 18 + (Math.floor(rx / 360) + 2) * 360;
const finalRy = f[1] + 24 + (Math.floor(ry / 360) + 2) * 360;
kfs.push({ transform: 'rotateX(' + finalRx + 'deg) rotateY(' + finalRy + 'deg)', offset: 1 });
const anim = diceCubeEl.animate(kfs, { duration: 950, easing: 'cubic-bezier(.3,.6,.35,1)', fill: 'forwards' });
diceAnim = anim;
if (diceSceneEl) {
diceSceneEl.classList.add('rolling');
setTimeout(() => { try { diceSceneEl.classList.remove('rolling'); } catch (e) {} }, 960);
}
[150, 380, 610].forEach((ms) => setTimeout(() => beep(460 + Math.random() * 140, 0.045, 0.07), ms));
setTimeout(() => beep(300, 0.09, 0.13), 920);
const finish = () => {
try {
diceCubeEl.style.transition = 'none';
diceCubeEl.style.transform = diceRestTransform(n);
if (anim && anim.cancel) anim.cancel();
if (diceAnim === anim) diceAnim = null;
} catch (e) {}
diceShown = n;
if (done) done();
};
if (anim && anim.finished && anim.finished.then) anim.finished.then(finish).catch(finish);
else setTimeout(finish, 970);
} catch (e) { if (done) done(); }
}
function drawBoard() {
ctx.clearRect(0, 0, W, H);
if (boardReady) {
ctx.drawImage(boardImg, 0, 0, W, H);
return;
}
ctx.fillStyle = '#dcecf7';
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = '#7aa8cc';
ctx.font = 'bold 34px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('棋盘加载中…', W / 2, H / 2);
}
function drawPieceAt(ti, x, y, num, shielded, movable, size) {
ctx.save();
if (movable) {
ctx.beginPath();
ctx.arc(x, y, size + 7, 0, Math.PI * 2);
ctx.strokeStyle = '#ffb400';
ctx.lineWidth = 5;
ctx.shadowColor = 'rgba(255,180,0,.75)';
ctx.shadowBlur = 14;
ctx.stroke();
ctx.restore();
ctx.save();
}
ctx.shadowColor = 'rgba(20,40,70,.4)';
ctx.shadowBlur = 6;
ctx.shadowOffsetY = 3;
ctx.beginPath();
ctx.arc(x, y, size, 0, Math.PI * 2);
ctx.fillStyle = THEMES[ti].main;
ctx.fill();
ctx.shadowColor = 'transparent';
ctx.shadowBlur = 0;
ctx.shadowOffsetY = 0;
ctx.lineWidth = 2.5;
ctx.strokeStyle = 'rgba(255,255,255,.95)';
ctx.stroke();
ctx.beginPath();
ctx.arc(x, y, size * 0.66, 0, Math.PI * 2);
ctx.fillStyle = 'rgba(255,255,255,.94)';
ctx.fill();
ctx.font = Math.round(size * 0.78) + 'px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText(THEMES[ti].emoji, x, y + 1);
ctx.beginPath();
ctx.arc(x + size * 0.68, y + size * 0.68, size * 0.34, 0, Math.PI * 2);
ctx.fillStyle = THEMES[ti].dark;
ctx.fill();
ctx.fillStyle = '#fff';
ctx.font = 'bold ' + Math.round(size * 0.4) + 'px sans-serif';
ctx.fillText(String(num), x + size * 0.68, y + size * 0.68 + 0.5);
if (shielded) {
ctx.font = Math.round(size * 0.62) + 'px sans-serif';
ctx.fillText('🛡', x + size * 0.72, y - size * 0.72);
}
ctx.restore();
}
function drawPieces() {
for (let side = 0; side < 2; side++) {
const ti = themeIdx(side);
const groups = {};
for (let idx = 0; idx < 4; idx++) {
const pos = st.pieces[side][idx];
const key = pos === -1 ? 'b' + idx : String(pos);
(groups[key] = groups[key] || []).push(idx);
}
Object.keys(groups).forEach((key) => {
const arr = groups[key];
const offsets = arr.length > 1 ? [[-9, -9], [9, -9], [-9, 9], [9, 9]] : [[0, 0]];
arr.forEach((idx, k) => {
const c = pieceCenter(side, idx);
if (!c) return;
const off = offsets[k % offsets.length];
const movable = side === 0 && st.turn === 0 && st.rolled && !st.busy && st.movable.indexOf(idx) >= 0;
drawPieceAt(ti, c.x + off[0], c.y + off[1], idx + 1, st.shields[side][idx], movable, arr.length > 1 ? 14 : 17);
});
});
}
}
function draw() {
drawBoard();
if (st) drawPieces();
}
function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
function updateControls() {
if (rollBtn) rollBtn.disabled = !(st && !st.over && st.turn === 0 && !st.rolled && !st.busy);
}
function pairLabel(pi) {
const a = THEMES[PAIRS[pi][0]], b = THEMES[PAIRS[pi][1]];
return a.emoji + ' ' + a.label + ' × ' + b.emoji + ' ' + b.label;
}
function showOverlay(title, body, mode) {
if (ovTitleEl) ovTitleEl.textContent = title;
if (ovBodyEl) ovBodyEl.textContent = body;
if (startBtn) { startBtn.hidden = false; startBtn.textContent = mode === 'start' ? pairLabel(0) : '再来一局'; }
if (startBtn2) { startBtn2.hidden = mode !== 'start'; startBtn2.textContent = pairLabel(1); }
if (overlayEl) overlayEl.hidden = false;
}
function hideOverlay() { if (overlayEl) overlayEl.hidden = true; }
function rulesText() {
return '双方各 4 枚棋子，掷 6 才能起飞，落点可把对方撞回基地；同格己方棋子可叠放并一起移动。特殊格按棋盘印刷结算（🍰 美味的诱惑＝停一回合，🎁 恐怖箱＝随机效果），先让 4 枚全部抵达中心获胜。';
}
function showStartOverlay() {
const s = loadStats();
const name = partnerName();
showOverlay('双人飞行棋', rulesText() + '\n累计：你 ' + s.w + ' 胜 · ' + name + ' ' + s.l + ' 胜', 'start');
}
function newGame(pair) {
pairIdx = pair;
st = newState(PAIRS[pair]);
clearTimeout(taTimer);
taTimer = null;
hideOverlay();
setNames();
setStatus('你（' + themeOf(0).emoji + '）先掷骰子');
setDice(0);
updateControls();
draw();
}
function rollDice() { return 1 + Math.floor(Math.random() * 6); }
function canMovePiece(side, idx, dice) {
if (dice <= 0) return false;
const pos = st.pieces[side][idx];
if (pos === 200) return false;
if (pos === -1) return dice === 6;
if (pos >= 100) {
const prog = pos - 100 + 1;
return prog + dice <= 6;
}
const dist = (entryOf(side) - pos + 52) % 52;
if (dist >= dice) return true;
return dice - dist <= 6;
}
function legalMoves(side, dice) {
const out = [];
for (let i = 0; i < 4; i++) if (canMovePiece(side, i, dice)) out.push(i);
return out;
}
function previewMove(side, idx, dice) {
const pos = st.pieces[side][idx];
let to = pos, finished = false;
if (pos === -1) {
to = startOf(side);
} else if (pos >= 100) {
const prog = pos - 100 + 1;
const np = prog + dice;
if (np >= 6) { to = 200; finished = true; }
else to = 100 + np - 1;
} else {
const dist = (entryOf(side) - pos + 52) % 52;
if (dist >= dice) to = (pos + dice) % 52;
else {
const into = dice - dist;
if (into >= 6) { to = 200; finished = true; }
else to = 100 + into - 1;
}
}
return { to: to, finished: finished };
}
function homeSpecialOf(side, cell) {
if (cell < 100 || cell >= 200) return null;
const m = HOME_SPECIALS[themeIdx(side)];
return m ? (m[cell - 100] || null) : null;
}
function specialOf(side, cell) {
if (cell >= 0 && cell < 52) return SPECIALS[cell] || null;
return homeSpecialOf(side, cell);
}
function cellName(side, pos) {
if (pos === -1) return '基地';
if (pos === 200) return '终点';
const eff = specialOf(side, pos);
const tag = eff ? '（' + SPECIAL_META[eff].label + '）' : '';
if (pos >= 100) return '冲刺区 ' + (pos - 100 + 1) + tag;
return '第 ' + (pos + 1) + ' 格' + tag;
}
function piecesAt(side, pos) {
const out = [];
for (let i = 0; i < 4; i++) if (st.pieces[side][i] === pos) out.push(i);
return out;
}
function groupLabel(group) {
if (group.length === 1) return '棋子 ' + (group[0] + 1);
return '棋子 ' + group.map((i) => i + 1).join('+');
}
function moveGroupMain(side, group, delta) {
let finished = 0;
group.forEach((i) => {
const p = st.pieces[side][i];
if (p < 0 || p >= 52) return;
let np;
if (delta > 0) {
const dist = (entryOf(side) - p + 52) % 52;
if (delta > dist) {
const rem = delta - dist;
np = rem >= 6 ? 200 : 100 + rem - 1;
} else {
np = (p + delta) % 52;
}
} else {
np = (p + delta + 52) % 52;
}
st.pieces[side][i] = np;
if (np === 200) { st.finished[side]++; finished++; }
});
return finished;
}
function doBump(side, group) {
const opp = 1 - side;
const candidates = [];
for (let i = 0; i < 4; i++) {
const p = st.pieces[opp][i];
if (p >= 0 && p < 52) candidates.push(i);
}
if (candidates.length) {
const curRaw = st.pieces[side][group[0]];
const cur = (curRaw >= 0 && curRaw < 52) ? curRaw : entryOf(side);
let best = candidates[0], bd = Infinity;
candidates.forEach((i) => {
const p = st.pieces[opp][i];
const d = Math.min(Math.abs(p - cur), 52 - Math.abs(p - cur));
if (d < bd) { bd = d; best = i; }
});
if (st.shields[opp][best]) {
st.shields[opp][best] = false;
sfxCapture();
return { extra: false, skipCollision: true, msg: '碰碰车被对方护盾挡下', finished: 0 };
}
st.pieces[opp][best] = -1;
sfxCapture();
return { extra: false, skipCollision: true, msg: '碰碰车把对方棋子撞回基地', finished: 0 };
}
moveGroupMain(side, group, -2);
return { extra: false, skipCollision: false, msg: '碰碰车空车，自己后退 2 格', finished: 0 };
}
function resolveSpecialEff(side, group, eff, cell) {
switch (eff) {
case 'adv2': {
const f = moveGroupMain(side, group, 2);
return { extra: false, skipCollision: false, msg: '前进 2 格' + (f ? '，抵达终点' : ''), finished: f };
}
case 'adv3': {
const f = moveGroupMain(side, group, 3);
return { extra: false, skipCollision: false, msg: '前进 3 格' + (f ? '，抵达终点' : ''), finished: f };
}
case 'back1':
moveGroupMain(side, group, -1);
return { extra: false, skipCollision: false, msg: '后退 1 格', finished: 0 };
case 'back2':
moveGroupMain(side, group, -2);
return { extra: false, skipCollision: false, msg: '后退 2 格', finished: 0 };
case 'again':
return { extra: true, skipCollision: false, msg: '再来一次 🎲', finished: 0 };
case 'out': {
const sIdx = group.find((i) => st.shields[side][i]);
if (sIdx !== undefined) {
st.shields[side][sIdx] = false;
return { extra: false, skipCollision: false, msg: '护盾抵挡了出局', finished: 0 };
}
group.forEach((i) => { st.pieces[side][i] = -1; });
sfxCapture();
return { extra: false, skipCollision: false, msg: '出局，回到基地', finished: 0 };
}
case 'shield':
group.forEach((i) => { st.shields[side][i] = true; });
return { extra: false, skipCollision: false, msg: '获得护盾 🛡', finished: 0 };
case 'burn':
moveGroupMain(side, group, -2);
return { extra: false, skipCollision: false, msg: '燃烧卡路里，后退 2 格', finished: 0 };
case 'tempt':
st.skip[side] = true;
return { extra: false, skipCollision: false, msg: '被美味诱惑，下回合停一次 🍰', finished: 0 };
case 'bump':
return doBump(side, group);
}
return { extra: false, skipCollision: false, msg: '', finished: 0 };
}
function resolveSpecial(side, group, cell) {
const eff = specialOf(side, cell);
if (!eff) return { extra: false, skipCollision: false, msg: '', finished: 0 };
if (eff === 'horror') {
const inHome = cell >= 100;
const pool = inHome ? ['again', 'shield', 'out'] : ['again', 'shield', 'adv2', 'back2', 'out', 'bump'];
const pick = pool[Math.floor(Math.random() * pool.length)];
const r = resolveSpecialEff(side, group, pick, cell);
r.msg = '🎁 恐怖箱：' + (r.msg || '什么也没有');
return r;
}
return resolveSpecialEff(side, group, eff, cell);
}
function applyCollision(side, pos) {
if (pos < 0 || pos >= 52) return { msg: '' };
const opp = 1 - side;
const hits = piecesAt(opp, pos);
if (!hits.length) return { msg: '' };
let sent = 0, blocked = 0;
hits.forEach((i) => {
if (st.shields[opp][i]) { st.shields[opp][i] = false; blocked++; }
else { st.pieces[opp][i] = -1; sent++; }
});
if (sent || blocked) sfxCapture();
let msg = '';
if (sent) msg = '撞回对方 ' + sent + ' 枚';
if (blocked) msg = (msg ? msg + '，' : '') + '护盾挡下 ' + blocked + ' 枚';
return { msg: msg };
}
function finishGame(side) {
if (st.over) return;
clearTimeout(taTimer);
taTimer = null;
st.over = true;
st.winner = side;
st.busy = false;
const s = loadStats();
if (side === 0) s.w++; else s.l++;
saveStats(s);
sfxWin();
draw();
updateControls();
const name = partnerName();
showOverlay(
side === 0 ? '你赢啦 ✈️' : name + ' 赢啦 ✈️',
side === 0
? '4 枚棋子全部抵达中心。累计：你 ' + s.w + ' 胜 · ' + name + ' ' + s.l + ' 胜'
: name + ' 的 4 枚棋子先到中心。累计：你 ' + s.w + ' 胜 · ' + name + ' ' + s.l + ' 胜',
'result'
);
}
function passTurn(next) {
st.turn = next;
st.rolled = false;
st.busy = false;
st.movable = [];
st.dice = 0;
draw();
updateControls();
if (st.skip[next]) {
st.skip[next] = false;
const nm = next === 0 ? '你' : partnerName();
setStatus(nm + ' 被美味诱惑，停一回合 🍰');
taTimer = setTimeout(() => { if (st && !st.over) passTurn(1 - next); }, 1000);
return;
}
if (next === 0) setStatus('轮到你了');
else { setStatus(partnerName() + ' 的回合'); scheduleTaTurn(800); }
}
function afterMove(side, again) {
if (st.over) return;
st.rolled = false;
st.busy = false;
st.movable = [];
st.dice = 0;
draw();
updateControls();
if (again) {
if (side === 0) setStatus('再掷一次骰子');
else { setStatus(partnerName() + ' 再掷一次'); scheduleTaTurn(800); }
} else {
passTurn(1 - side);
}
}
function executeMove(side, idx, dice) {
if (!st || st.over) return;
const fromPos = st.pieces[side][idx];
const group = fromPos === -1 ? [idx] : piecesAt(side, fromPos);
const prev = previewMove(side, idx, dice);
const name = side === 0 ? '你' : partnerName();
const parts = [];
let extra = false;
group.forEach((i) => { st.pieces[side][i] = prev.to; });
if (prev.finished) {
st.finished[side] += group.length;
parts.push(name + ' 的 ' + groupLabel(group) + ' 抵达终点 🏆');
beep(560, 0.09, 0.16);
} else {
parts.push(name + ' 移动 ' + groupLabel(group) + ' → ' + cellName(side, prev.to));
sfxMove();
}
let skipCollision = false;
if (!prev.finished) {
const res = resolveSpecial(side, group, prev.to);
if (res.extra) extra = true;
if (res.msg) parts.push(res.msg);
if (res.skipCollision) skipCollision = true;
}
const finalPos = st.pieces[side][group[0]];
if (!skipCollision) {
const coll = applyCollision(side, finalPos);
if (coll.msg) parts.push(coll.msg);
}
st.movable = [];
setStatus(parts.join(' · '));
draw();
updateControls();
if (st.finished[side] >= 4) { finishGame(side); return; }
afterMove(side, dice === 6 || extra);
}
function settleRoll(side, d) {
if (!st || st.over || st.turn !== side || st.rolled) return;
st.dice = d;
st.rolled = true;
st.busy = false;
st.movable = legalMoves(side, d);
sfxRoll();
draw();
updateControls();
const name = side === 0 ? '你' : partnerName();
if (st.movable.length === 0) {
setStatus(name + ' 掷出 ' + d + '，没有可移动的棋子');
taTimer = setTimeout(() => {
if (!st || st.over || st.turn !== side || !st.rolled) return;
afterMove(side, d === 6);
}, 800);
return;
}
if (side === 0) {
setStatus('掷出 ' + d + '，点击高亮棋子移动');
} else {
const chosen = chooseAiMove(side, d);
setStatus(name + ' 掷出 ' + d + '，移动棋子 ' + (chosen + 1));
taTimer = setTimeout(() => {
if (!st || st.over || st.turn !== side || !st.rolled) return;
st.busy = true;
executeMove(side, chosen, d);
}, 750);
}
}
function humanRoll() {
if (!st || st.over || st.turn !== 0 || st.rolled || st.busy) return;
st.busy = true;
updateControls();
setStatus('掷骰中…');
const d = rollDice();
rollAnim(d, () => settleRoll(0, d));
}
function chooseAiMove(side, dice) {
const seen = {};
const cands = [];
for (let i = 0; i < st.movable.length; i++) {
const idx = st.movable[i];
const pos = st.pieces[side][idx];
if (seen[pos]) continue;
seen[pos] = true;
cands.push(idx);
}
let best = cands[0], bestScore = -Infinity;
cands.forEach((idx) => {
const pv = previewMove(side, idx, dice);
let score = Math.random() * 12;
if (pv.finished) score += 1000;
const eff = specialOf(side, pv.to);
if (eff === 'shield' || eff === 'again' || eff === 'adv2' || eff === 'adv3') score += 40;
if (eff === 'out' || eff === 'burn' || eff === 'tempt') score -= 60;
if (eff === 'horror') score -= 5;
if (eff === 'bump') score += 10;
if (pv.to >= 0 && pv.to < 52) {
for (let j = 0; j < 4; j++) if (st.pieces[1 - side][j] === pv.to) score += 320;
}
if (st.pieces[side][idx] === -1) score += 18;
if (score > bestScore) { bestScore = score; best = idx; }
});
return best;
}
function taRoll() {
if (!st || st.over || st.turn !== 1 || st.rolled || st.busy) return;
st.busy = true;
updateControls();
setStatus(partnerName() + ' 掷骰中…');
const d = rollDice();
rollAnim(d, () => settleRoll(1, d));
}
function scheduleTaTurn(delay) {
clearTimeout(taTimer);
taTimer = setTimeout(taRoll, delay);
}
function onCanvasDown(e) {
if (!st || st.over || st.turn !== 0 || !st.rolled || st.busy || st.movable.length === 0) return;
const rect = canvas.getBoundingClientRect();
const x = (e.clientX - rect.left) * (W / rect.width);
const y = (e.clientY - rect.top) * (H / rect.height);
let best = -1, bestDist = 40;
for (let i = 0; i < st.movable.length; i++) {
const idx = st.movable[i];
const p = pieceCenter(0, idx);
if (!p) continue;
const d = Math.hypot(x - p.x, y - p.y);
if (d < bestDist) { bestDist = d; best = idx; }
}
if (best >= 0) {
st.busy = true;
st.rolled = false;
executeMove(0, best, st.dice);
}
}
function setNames() {
const name = partnerName();
const pair = st ? st.pair : PAIRS[pairIdx];
const a = THEMES[pair[0]], b = THEMES[pair[1]];
if (userSideEl) {
userSideEl.textContent = a.emoji + ' 你';
userSideEl.style.color = a.dark;
userSideEl.style.background = a.light;
}
if (partnerSideEl) {
partnerSideEl.textContent = b.emoji + ' ' + name;
partnerSideEl.style.color = b.dark;
partnerSideEl.style.background = b.light;
}
if (sideNameEl) sideNameEl.textContent = name;
if (partnerNameEl) partnerNameEl.textContent = name;
}
function toggleFs() {
isFs = !isFs;
panel.classList.toggle('game-fs', isFs);
if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
}
function openPanel() {
try { if (isFs) toggleFs(); } catch (e) {}
panel.hidden = false;
if (!boardReady && !boardImg.src) boardImg.src = 'assets/fc-board.jpg';
setNames();
updateControls();
draw();
if (st && st.over) {
const s = loadStats();
const name = partnerName();
showOverlay(
st.winner === 0 ? '你赢啦 ✈️' : name + ' 赢啦 ✈️',
st.winner === 0
? '4 枚棋子全部抵达中心。累计：你 ' + s.w + ' 胜 · ' + name + ' ' + s.l + ' 胜'
: name + ' 的 4 枚棋子先到中心。累计：你 ' + s.w + ' 胜 · ' + name + ' ' + s.l + ' 胜',
'result'
);
} else if (st && !st.over && st.turn === 1 && !st.busy) {
if (st.rolled && st.dice > 0) {
const mv = legalMoves(1, st.dice);
st.movable = mv;
if (mv.length === 0) {
setStatus(partnerName() + ' 掷出 ' + st.dice + '，没有可移动的棋子');
taTimer = setTimeout(() => { if (st && !st.over && st.turn === 1 && st.rolled) afterMove(1, st.dice === 6); }, 700);
} else {
const chosen = chooseAiMove(1, st.dice);
setStatus(partnerName() + ' 掷出 ' + st.dice + '，移动棋子 ' + (chosen + 1));
taTimer = setTimeout(() => { if (st && !st.over && st.turn === 1 && st.rolled) { st.busy = true; executeMove(1, chosen, st.dice); } }, 700);
}
} else if (!st.rolled) {
setStatus(partnerName() + ' 的回合');
scheduleTaTurn(600);
}
} else if (st && !st.over && st.turn === 0 && !st.busy && st.rolled) {
const mv = legalMoves(0, st.dice);
st.movable = mv;
if (mv.length === 0) {
setStatus('掷出 ' + st.dice + '，没有可移动的棋子');
taTimer = setTimeout(() => { if (st && !st.over && st.turn === 0 && st.rolled) afterMove(0, st.dice === 6); }, 700);
} else {
setStatus('掷出 ' + st.dice + '，点击高亮棋子移动');
draw();
}
} else if (!st || st.over) {
showStartOverlay();
}
}
function closePanel() {
clearTimeout(taTimer);
taTimer = null;
if (isFs) toggleFs();
if (panel) panel.hidden = true;
}
window.openFlightPanel = openPanel;
window.closeFlightPanel = closePanel;
if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
if (startBtn) startBtn.addEventListener('click', () => newGame(0));
if (startBtn2) startBtn2.addEventListener('click', () => newGame(1));
if (rollBtn) rollBtn.addEventListener('click', humanRoll);
if (soundBtn) soundBtn.addEventListener('click', () => {
soundOn = !soundOn;
soundBtn.textContent = soundOn ? '🔊' : '🔇';
});
canvas.addEventListener('pointerdown', onCanvasDown);
canvas.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('contact-switched', () => { try { closePanel(); st = null; } catch (e) {} });
window.addEventListener('resize', () => { if (panel && !panel.hidden) draw(); });
(function bindEntry() {
const btn = document.getElementById('more-flight');
if (!btn) return;
btn.addEventListener('click', (e) => {
e.stopPropagation();
const mp = document.getElementById('chat-more-panel');
if (mp) mp.hidden = true;
const hideIds = ['poke-card', 'emoji-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-snake-panel', 'chat-pong-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-ms-panel', 'chat-memory-panel', 'chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-auction-panel', 'chat-arcade-panel'];
hideIds.forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
try { openPanel(); } catch (err) {
try { panel.hidden = false; showStartOverlay(); } catch (e2) {}
try { console.error('[flight] open failed', err); } catch (e2) {}
}
});
try {
if (window.MutationObserver) {
const SIBLING_IDS = ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-ms-panel', 'chat-memory-panel', 'chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-auction-panel', 'chat-arcade-panel'];
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
window.__fcDebug = {
st: () => st,
newGame: newGame,
legalMoves: legalMoves,
previewMove: previewMove,
executeMove: executeMove,
specialOf: specialOf
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("flight-chess.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("flight-chess.js"); try { console.error("[JS] flight-chess.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[flight-chess.js] " + String(__e && __e.message || __e)); } })();
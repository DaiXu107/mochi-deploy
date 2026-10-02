(function () { try {
(function () {
'use strict';
let GW = 15, GH = 15;
const FS_CELL = 21;                  // 全屏地图目标格子尺寸（逻辑 px）——偏小让地图更大
const INIT_LEN = 3;
const FOOD_TARGET = 2;               // 默认同屏食物数（可在头部选择器调 2/4/6/8）
function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function keyScore() { return prefix() + ':snake-score'; }
function keySaved() { return prefix() + ':snake-saved'; }
function keyBest() { return prefix() + ':snake-best'; }
function keyMode() { return prefix() + ':snake-mode'; }
function keyFoodN() { return prefix() + ':snake-foodn'; }
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
let touchTracks = {};
function gW() { return (state && state.gw) || GW; }
function gH() { return (state && state.gh) || GH; }
function curMode() { return (state && state.mode) || (modeSel && modeSel.value) || 'duo'; }
function nextMode() { return (modeSel && MODES[modeSel.value]) ? modeSel.value : 'duo'; }
function nextFoodN() { return foodSel ? (parseInt(foodSel.value, 10) || FOOD_TARGET) : FOOD_TARGET; }
function foodTargetN() { return (state && state.foodTarget) || FOOD_TARGET; }
function activeSnakes() {
if (!state) return [];
const a = [state.player];
if (state.p2) a.push(state.p2);
a.push(state.opp);
return a;
}
function humanSnakes() { return activeSnakes().filter(function (s) { return s.ctrl !== 'ai'; }); }
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
function applyCell(cell, minCell) {
const sc = panel.querySelector('.poke-card-scroll');
for (let i = 0; i < 4; i++) {
cell = Math.max(minCell, cell);
cssW = Math.round(cell * gW()); cssH = Math.round(cell * gH());
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
function fitCanvasBox() {
if (!canvas || !isFs || !ctx) return;
const av = scrollAvail();
applyCell(Math.min(av.w / gW(), av.h / gH()), 9);
}
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
function refitAll() {
refitNonFs();                 // 非全屏：内部已 render
if (!isFs) return;
fitCanvasBox();
render(0);                    // applyCell 改位图尺寸会清空画布
}
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
dpr = Math.min(window.devicePixelRatio || 1, 2);
ctx = canvas.getContext('2d');   // 幂等，供 applyCell 重设 transform
if (isFs) {
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
onViewportChange();
});
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
const t0 = e.touches[0];
touchBase = { x: t0.clientX, y: t0.clientY };
lastTouchDir = null;
lockAxis = null;
}, { passive: true });
function trackMove(tr, cx, cy) {
const dx = cx - tr.base.x, dy = cy - tr.base.y;
const adx = Math.abs(dx), ady = Math.abs(dy);
if (adx < TH && ady < TH) return;
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
tr.base = { x: cx, y: cy };
if (dir === tr.lastDir) return;
if (dir === 'u') (tr.zone === 'p2' ? setP2Dir : setPlayerDir)(0, -1);
else if (dir === 'd') (tr.zone === 'p2' ? setP2Dir : setPlayerDir)(0, 1);
else if (dir === 'l') (tr.zone === 'p2' ? setP2Dir : setPlayerDir)(-1, 0);
else (tr.zone === 'p2' ? setP2Dir : setPlayerDir)(1, 0);
tr.lastDir = dir;
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
function setSnakeDir(p, x, y) {
if (!p || !p.alive) return;
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
function snapshotPrev() {
if (!state) return;
activeSnakes().forEach(function (s) { s._prev = cloneBody(s.body); });
prevPlayerBody = state.player._prev;
prevOppBody = state.opp._prev;
}
function frame(now) {
if (!state || state.status !== 'playing') { rafId = null; return; }
if (!lastFrameTime) lastFrameTime = now;
const dt = Math.min(now - lastFrameTime, 250);
lastFrameTime = now;
acc += dt;
const ti = currentTickInterval();
let guard = 3;
while (acc >= ti && guard > 0) {
acc -= ti;
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
function aiDecide(o) {
if (!o.alive) return;
behaviorTick();
const head = o.body[0];
const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
const humans = humanSnakes();
const wall = state.flags && state.flags.wall;
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
function endGame() {
if (!state) return;
state.status = 'over';
stopFrame();
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
try {
if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('snake');
if (result === 'win' && window.arcadeTryDrop) { const dp = window.arcadeTryDrop('snake'); if (dp) d.drop = dp; }
} catch (e) {}
updateBest(result);
renderScore();
renderBest();
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
function drawSnake(snake, alpha, headColor, bodyColor) {
if (!snake.body.length) return;
const cw = cssW / gW(), ch = cssH / gH(), cs = Math.min(cw, ch);
const dead = !snake.alive;
const dark = themeDark();
const bodyC = bodyColor;
const headC = headColor;
const prevBody = snake._prev || null;   // 步进前快照（snapshotPrev 统一维护）
const interp = !dead && prevBody && alpha > 0 && alpha < 1;
const pts = [];
for (let i = 0; i < snake.body.length; i++) {
const s = snake.body[i];
let x = s.x, y = s.y;
if (interp && prevBody[i] && Math.abs(s.x - prevBody[i].x) <= 1 && Math.abs(s.y - prevBody[i].y) <= 1) {
x = prevBody[i].x + (s.x - prevBody[i].x) * alpha;
y = prevBody[i].y + (s.y - prevBody[i].y) * alpha;
}
pts.push({ x: x * cw + cw / 2, y: y * ch + ch / 2 });
}
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
function toggleFs() {
isFs = !isFs;
if (panel) {
panel.classList.toggle('snake-fs', isFs);
panel.classList.remove('snake-fs-in');
if (isFs) { void panel.offsetWidth; panel.classList.add('snake-fs-in'); }
}
if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
setupCanvas();
render(0);
}
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
const w = Math.max(10, Math.min(42, s.gw || 15));
const h = Math.max(10, Math.min(48, s.gh || 15));
s.gw = w; s.gh = h;
if (!validSnake(s.player, w, h) || !validSnake(s.opp, w, h)) return false;
if (s.foods && !s.foods.every(function (p) { return validCoord(p, w, h); })) return false;
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
function wantFullscreenDefault() {
try {
const d = window.mochiDevice;
if (d && (d.isMobile || d.isTablet)) return true;   // 全站唯一设备判定源
} catch (e) {}
try { if (document.documentElement.classList.contains('force-mobile')) return true; } catch (e) {}
if (window.innerWidth < 900) return true;             // 兜底：device.js 未就绪/判定未出
try {
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
if (nameEl) {
let pname = 'TA';
try {
const nst = window.activeStore && window.activeStore();
pname = (nst && (nst.get('lbl-partner') || nst.get('cs-lbl-partner'))) || pname;
} catch (e) {}
nameEl.textContent = pname;
}
if (modeSel) { const m = lsGet(keyMode()); if (m && MODES[m]) modeSel.value = m; }
if (foodSel) { const fn = parseInt(lsGet(keyFoodN()), 10); if (fn >= 2 && fn <= 8) foodSel.value = String(fn); }
panel.hidden = false;
renderScore();
renderBest();   // 最长纪录行要先落到 DOM：toggleFs 会按当时可见的兄弟块量画布，晚一行就把按钮顶出屏
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
if (window.__mochiLoaded) window.__mochiLoaded.push("snake-game.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("snake-game.js"); try { console.error("[JS] snake-game.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[snake-game.js] " + String(__e && __e.message || __e)); } })();
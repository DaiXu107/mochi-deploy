(function () { try {
(function () {
const panel = document.getElementById('chat-c4-panel');
if (!panel) return;
const boardEl = document.getElementById('c4-board');
const stageEl = document.getElementById('c4-stage');
const statusEl = document.getElementById('c4-status');
const overlayEl = document.getElementById('c4-overlay');
const ovTitleEl = document.getElementById('c4-ov-title');
const ovBodyEl = document.getElementById('c4-ov-body');
const startBtn = document.getElementById('c4-btn-start');
const endBtn = document.getElementById('c4-btn-end');
const soundBtn = document.getElementById('c4-sound');
const closeBtn = document.getElementById('c4-close');
const fsBtn = document.getElementById('c4-fs');
let isFs = false;
function toggleFs() {
isFs = !isFs;
panel.classList.toggle('game-fs', isFs);
if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
setTimeout(() => { try { if (typeof fitBoard === 'function') fitBoard(); } catch (e) {} }, 60);
}
if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
const partnerNameEl = document.getElementById('c4-partner-name');
const sideNameEl = document.getElementById('c4-side-name');
const COLS = 7, ROWS = 6;
const THINK_MIN = 550, THINK_VAR = 600;
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
const T = window.taFit || function (x) { return x; };
function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
let audioCtx = null, soundOn = true;
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
const sfxFull = () => beep(180, 0.06, 0.12);
const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };
const sfxLose = () => { beep(300, 0.14, 0.18); setTimeout(() => beep(220, 0.2, 0.18), 130); };
const sfxDraw = () => beep(440, 0.12, 0.16);
let st = null;
let thinkT = null;
let cellPx = 44;
const THINK_LINES = ['TA正在想……', 'TA盯着棋盘看了一会儿', 'TA托着下巴琢磨'];
function newState() {
return {
grid: [],                 // grid[r][c]：0 空 / 1 玩家 / 2 TA（r=0 顶行）
turn: 1,
over: false,
started: false,
lock: false,
moves: 0,
winCells: null,
mode: 'normal',           // TA 本回合行为状态（每回合重抽）
lastTaCol: null,
missedBlocks: 0           // 玩家威胁被无视的连续次数（底线计数）
};
}
function newGrid() {
const g = [];
for (let r = 0; r < ROWS; r++) { g.push([0, 0, 0, 0, 0, 0, 0]); }
return g;
}
function statsKey() { return prefix() + ':c4-stats'; }
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
function dropRow(grid, c) {
if (c < 0 || c >= COLS || grid[0][c] !== 0) return -1;
for (let r = ROWS - 1; r >= 0; r--) { if (grid[r][c] === 0) return r; }
return -1;
}
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
function winLineAt(grid, r, c, side) {
for (let d = 0; d < DIRS.length; d++) {
const dr = DIRS[d][0], dc = DIRS[d][1];
const cells = [[r, c]];
for (let s = -1; s <= 1; s += 2) {
let rr = r + dr * s, cc = c + dc * s;
while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[rr][cc] === side) {
cells.push([rr, cc]);
rr += dr * s; cc += dc * s;
}
}
if (cells.length >= 4) return cells;
}
return null;
}
function isFull(grid) {
for (let c = 0; c < COLS; c++) { if (grid[0][c] === 0) return false; }
return true;
}
function legalCols(grid) {
const out = [];
for (let c = 0; c < COLS; c++) { if (grid[0][c] === 0) out.push(c); }
return out;
}
function winningCols(grid, side) {
const out = [];
for (let c = 0; c < COLS; c++) {
const r = dropRow(grid, c);
if (r < 0) continue;
grid[r][c] = side;
if (winLineAt(grid, r, c, side)) out.push(c);
grid[r][c] = 0;
}
return out;
}
function pickTaCol(mode) {
const grid = st.grid;
const legal = legalCols(grid);
if (!legal.length) return -1;
const randOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
const myWins = winningCols(grid, 2);
const pThreats = winningCols(grid, 1);
let col = null;
const take = DIFFS[selDiff].take, blk = DIFFS[selDiff].block;
if (mode === 'serious') {
if (myWins.length && Math.random() < take.serious) col = randOf(myWins);
else if (pThreats.length && Math.random() < blk.serious) col = randOf(pThreats);
} else if (mode === 'normal') {
if (myWins.length && Math.random() < take.normal) col = randOf(myWins);
else if (pThreats.length && Math.random() < blk.normal) col = randOf(pThreats);
} else if (mode === 'sandbag') {
let pool = legal.slice();
if (myWins.length && Math.random() < 0.8) pool = pool.filter((c) => myWins.indexOf(c) < 0);
if (pThreats.length && Math.random() < 0.75) pool = pool.filter((c) => pThreats.indexOf(c) < 0);
col = pool.length ? randOf(pool) : null;
} else { // blunder：人式失误，纯随机忽略局势；偶尔连着往相近列下
if (st.lastTaCol != null && Math.random() < 0.35) {
const near = [st.lastTaCol - 1, st.lastTaCol, st.lastTaCol + 1].filter((c) => legal.indexOf(c) >= 0);
if (near.length) col = randOf(near);
}
}
if (col == null) col = randOf(legal);
return col;
}
function applyFloor(col) {
const pThreats = winningCols(st.grid, 1), myWins = winningCols(st.grid, 2);
const isBlock = pThreats.indexOf(col) >= 0;
const isWin = myWins.indexOf(col) >= 0;
if (!isBlock && !isWin && pThreats.length) {
st.missedBlocks++;
if (st.missedBlocks > DIFFS[selDiff].floor) return pThreats[Math.floor(Math.random() * pThreats.length)];
}
if (isBlock) st.missedBlocks = 0;
return col;
}
function rollMode() {
const w = DIFFS[selDiff].w;
const r = Math.random();
if (r < w.normal) return 'normal';
if (r < w.normal + w.serious) return 'serious';
if (r < w.normal + w.serious + w.sandbag) return 'sandbag';
return 'blunder';
}
function buildBoard() {
boardEl.innerHTML = '';
for (let c = 0; c < COLS; c++) {
const col = document.createElement('div');
col.className = 'c4-col';
col.setAttribute('data-col', String(c));
for (let r = 0; r < ROWS; r++) {
const cell = document.createElement('div');
cell.className = 'c4-cell';
cell.setAttribute('data-r', String(r));
col.appendChild(cell);
}
boardEl.appendChild(col);
}
}
function fitBoard() {
if (!stageEl || panel.hidden) return;
const w = stageEl.clientWidth;
if (!w) return;
cellPx = Math.max(30, Math.min(48, Math.floor(w / COLS)));
boardEl.style.width = (cellPx * COLS) + 'px';
const cells = boardEl.querySelectorAll('.c4-cell');
for (let i = 0; i < cells.length; i++) cells[i].style.height = cellPx + 'px';
}
function cellAt(r, c) {
const col = boardEl.children[c];
return col ? col.children[r] : null;
}
function fastMul() { return (window.__c4Debug && window.__c4Debug.fast) ? 0.05 : 1; }
function animateDrop(r, c, side, cb) {
const cell = cellAt(r, c);
const disc = document.createElement('span');
disc.className = 'c4-disc ' + (side === 1 ? 'c4-you' : 'c4-ta');
const dist = (r + 1) * cellPx;
const dur = Math.round((110 + r * 42) * fastMul());
disc.style.transform = 'translateY(-' + dist + 'px)';
disc.style.transitionDuration = dur + 'ms';
cell.appendChild(disc);
requestAnimationFrame(() => { requestAnimationFrame(() => { disc.style.transform = ''; }); });
setTimeout(() => {
disc.classList.add('c4-land');
if (cb) cb();
}, dur + Math.round(70 * fastMul()) + 20);
}
function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
function escName() { const n = String(T('TA')); const d = document.createElement('div'); d.textContent = n; return d.innerHTML; }
function dot(side) { return '<i class="c4-dot ' + (side === 1 ? 'c4-dot-you' : 'c4-dot-ta') + '"></i>'; }
function showTurnStatus() {
if (!statusEl) return;
if (st.over) return;
setStatus(st.turn === 1 ? dot(1) + '你的回合' : escName() + '正在想……');
}
function clearBoardDom() {
boardEl.querySelectorAll('.c4-disc').forEach((d) => d.remove());
boardEl.querySelectorAll('.c4-wincol').forEach((el) => el.classList.remove('c4-wincol'));
}
function newGame() {
clearTimeout(thinkT); thinkT = null;
st = newState();
st.grid = newGrid();
st.started = true;
clearBoardDom();
hideOverlay();
const s = loadStats();
st.turn = s.nextFirst === 'ta' ? 2 : 1;
setStatus(st.turn === 1 ? dot(1) + '你的回合，点击一列落子' : T('TA') + '先手');
if (st.turn === 2) scheduleTaMove(Math.max(THINK_MIN, 700));
}
function scheduleTaMove(delay) {
clearTimeout(thinkT);
const line = THINK_LINES[Math.floor(Math.random() * THINK_LINES.length)];
setStatus(T(line).replace('TA', escName()));
thinkT = setTimeout(taMove, Math.round(delay * fastMul()));
}
function taMove() {
if (!st || st.over || st.turn !== 2) return;
st.mode = rollMode();
let col = pickTaCol(st.mode);
if (col < 0) return;
col = applyFloor(col);
const r = dropRow(st.grid, col);
if (r < 0) return;
st.lock = true;
st.lastTaCol = col;
st.grid[r][col] = 2;
st.moves++;
sfxDropTa();
animateDrop(r, col, 2, () => {
const line = winLineAt(st.grid, r, col, 2);
if (line) { highlightWin(line); endGame(2); return; }
if (isFull(st.grid)) { endGame(0); return; }
st.turn = 1; st.lock = false;
showTurnStatus();
});
}
function playerDrop(c) {
if (!st || !st.started || st.over || st.lock || st.turn !== 1) return;
const r = dropRow(st.grid, c);
if (r < 0) {
sfxFull();
const colEl = boardEl.children[c];
if (colEl) { colEl.classList.remove('c4-shake'); void colEl.offsetWidth; colEl.classList.add('c4-shake'); }
setStatus(dot(1) + '这一列已经满了');
return;
}
st.lock = true;
st.grid[r][c] = 1;
st.moves++;
sfxDropYou();
animateDrop(r, c, 1, () => {
const line = winLineAt(st.grid, r, c, 1);
if (line) { highlightWin(line); endGame(1); return; }
if (isFull(st.grid)) { endGame(0); return; }
st.turn = 2;
if (!panel.hidden) scheduleTaMove(THINK_MIN + Math.random() * THINK_VAR);
});
}
function highlightWin(cells) {
st.winCells = cells;
for (let i = 0; i < cells.length; i++) {
const cell = cellAt(cells[i][0], cells[i][1]);
if (cell) { cell.classList.add('c4-wincol'); const d = cell.querySelector('.c4-disc'); if (d) d.classList.add('c4-win'); }
}
}
function endGame(winner) {
st.over = true; st.lock = false;
clearTimeout(thinkT); thinkT = null;
const s = loadStats();
if (winner === 1) { s.w++; s.nextFirst = 'ta'; }
else if (winner === 2) { s.l++; s.nextFirst = 'you'; }
else { s.d++; s.nextFirst = Math.random() < 0.5 ? 'you' : 'ta'; }   // 平局下一局随机先手
saveStats(s);
if (winner === 1) sfxWin(); else if (winner === 2) sfxLose(); else sfxDraw();
var coinLine4 = '';
try {
var COIN_CAP = 10400;
var d4 = new Date();
var day4 = d4.getFullYear() + '-' + (d4.getMonth() + 1) + '-' + d4.getDate();
var ck4 = (window.activePrefix && window.activePrefix() || 'xy-home-v2') + ':ml2_coin_c4_' + day4;
var cur4 = Number(localStorage.getItem(ck4)) || 0;
if (cur4 < COIN_CAP) {
var c4WinFen = Math.random() < 0.2 ? 5200 : 1314;
var c4Mult = (window.arcadeMult && window.arcadeMult('c4')) || 1;
var real4 = Math.min((winner === 0 ? 520 : c4WinFen) * c4Mult, COIN_CAP - cur4);
try { localStorage.setItem(ck4, String(cur4 + real4)); } catch (e2) {}
if (real4 > 0 && typeof window.giftWalletChange === 'function') {
if (window.giftWalletChange(real4, real4, '四子棋')) {
coinLine4 = '🪙 双方心意币各 +¥' + (real4 / 100).toFixed(2);
}
}
}
} catch (e) {}
var c4Drop = null;
try {
if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('c4');
if (winner === 1 && window.arcadeTryDrop) c4Drop = window.arcadeTryDrop('c4');
} catch (e) {}
const title = winner === 1 ? '🏆 你赢了！' : winner === 2 ? T('TA') + '赢了' : '平局';
const body =
'<div class="pong-end-stat">本局共 ' + st.moves + ' 手</div>' +
'<div class="pong-end-stat">' + statsLine() + '</div>' +
'<div class="pong-end-stat">下一局 ' + (s.nextFirst === 'you' ? '你' : T('TA')) + '先手</div>' +
(coinLine4 ? '<div class="pong-end-stat">' + coinLine4 + '</div>' : '') +
(c4Drop ? '<div class="pong-end-stat">🎁 掉落限定摆件「' + c4Drop.name + '」</div>' : '') +
pillsHtml() +
'<div class="ms-cur">' + diffHint() + '</div>';
showOverlay(title, body, '再来一局');
if (startBtn) startBtn.textContent = '再来一局';
if (endBtn) endBtn.hidden = false;
setStatus(winner === 1 ? '🎉 你赢了！' : winner === 2 ? escName() + '赢了这一局' : '这局没有分出胜负');
try {
const resTxt = winner === 1 ? '你赢' : winner === 2 ? T('TA') + '赢' : '平局';
const c4Stats = ['本局共 ' + st.moves + ' 手', '累计战绩 你 ' + s.w + '胜 · {ta} ' + s.l + '胜 · ' + s.d + '平',
'下一局 ' + (s.nextFirst === 'you' ? '你' : '{ta}') + '先手'].concat(coinLine4 ? [coinLine4] : []).concat(c4Drop ? ['🎁 掉落限定摆件「' + c4Drop.name + '」'] : []);
if (window.chatAddSystem) window.chatAddSystem(T('四子棋') + ' · ' + resTxt, { special: 'c4', game: {
name: '四子棋',
outcome: winner === 1 ? 'win' : winner === 2 ? 'lose' : 'draw',
result: winner === 1 ? '你赢了！' : winner === 2 ? '{ta}赢了' : '平局',
stats: c4Stats
} });
const grp = winner === 1 ? '游戏失败·回应' : winner === 2 ? '游戏胜利·回应' : '游戏平局·回应';
const fb = winner === 1 ? ['让你赢啦，再来？'] : winner === 2 ? ['我赢啦，再来一局吗'] : ['平局，再来一局？'];
const pool = window.getInteractPool ? window.getInteractPool(grp, fb) : fb;
const say = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''; // #1515 整组停用＝静默（四子棋）
if (say) setTimeout(() => {
try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
}, 800);
} catch (e) {}
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
showOverlay('四子棋',
pillsHtml() +
'<div class="ms-cur" id="c4-cur">' + diffHint() + '</div>' +
'<div class="c4-start-tip">你执 🔵 · ' + T('TA') + '执 🟡<br>轮流点击一列落子，先连成四子的一方获胜</div>' +
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
buildBoard();   // 棋盘 DOM 只建一次（newGame 只清棋子不动结构）
boardEl.addEventListener('click', (e) => {
e.stopPropagation();
const colEl = e.target.closest('.c4-col');
if (!colEl) return;
playerDrop(parseInt(colEl.getAttribute('data-col'), 10) || 0);
});
if (startBtn) startBtn.addEventListener('click', (e) => { e.stopPropagation(); newGame(); });
if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closeC4Panel(); });
if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeC4Panel(); });
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
const curEl = document.getElementById('c4-cur');
if (curEl) curEl.textContent = diffHint();
else { const c2 = ovBodyEl.querySelector('.ms-cur'); if (c2) c2.textContent = diffHint(); }
});
if (soundBtn) soundBtn.addEventListener('click', (e) => {
e.stopPropagation();
soundOn = !soundOn;
soundBtn.textContent = soundOn ? '🔊' : '🔇';
soundBtn.classList.toggle('pong-sound-off', !soundOn);
});
function setNames() {
let name = T('TA');
try {
const s = window.activeStore && window.activeStore();
name = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || name;
} catch (e) {}
if (partnerNameEl) partnerNameEl.textContent = name;
if (sideNameEl) sideNameEl.textContent = name;
}
window.openC4Panel = function () {
try { if (isFs) toggleFs(); } catch (e) {}
if (!boardEl.children.length) { try { buildBoard(); } catch (e) {} }
panel.hidden = false;
try { const s = loadStats(); if (DIFFS[s.lastDiff]) selDiff = s.lastDiff; } catch (e) {}
try { setNames(); } catch (e) {}
try { fitBoard(); } catch (e) {}
if (st && st.started && !st.over) {
if (st.turn === 2 && !thinkT) scheduleTaMove(THINK_MIN + Math.random() * THINK_VAR);
else if (st.turn === 1) showTurnStatus();
return;
}
showStartOverlay();
setStatus('点击「开始对局」');
};
function closeC4Panel() {
clearTimeout(thinkT); thinkT = null;
if (panel) panel.hidden = true;
}
window.closeC4Panel = closeC4Panel;
document.addEventListener('contact-switched', () => { try { closeC4Panel(); } catch (e) {} });
window.addEventListener('resize', () => { if (!panel.hidden) fitBoard(); });
(function bindEntry() {
const btn = document.getElementById('more-c4');
if (!btn) return;
btn.addEventListener('click', (e) => {
e.stopPropagation();
const mp = document.getElementById('chat-more-panel');
if (mp) mp.hidden = true;
const hideIds = ['poke-card', 'emoji-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-snake-panel'];
hideIds.forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
try { openC4Panel(); } catch (err) {
try { panel.hidden = false; showStartOverlay(); setStatus('点击「开始对局」'); } catch (e2) {}
try { console.error('[c4] open failed', err); } catch (e2) {}
}
});
try {
if (window.MutationObserver) {
const SIBLING_IDS = ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-more-panel'];
const mo = new MutationObserver(() => {
if (panel.hidden) return;
for (let i = 0; i < SIBLING_IDS.length; i++) {
const el = document.getElementById(SIBLING_IDS[i]);
if (el && !el.hidden) { closeC4Panel(); break; }
}
});
SIBLING_IDS.forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
}
} catch (e) {}
})();
window.__c4Debug = {
st: () => st,
newGame: newGame,
dropRow: (g, c) => dropRow(g, c),
winLineAt: (g, r, c, s) => winLineAt(g, r, c, s),
rollMode: rollMode,
pick: pickTaCol,                       // 纯函数：按 st.grid 选列（不改棋盘/计数）
floor: applyFloor,                     // 底线应用（会更新 missedBlocks）
winningCols: (side) => winningCols(st.grid, side),
fast: false
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("connect-four.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("connect-four.js"); try { console.error("[JS] connect-four.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[connect-four.js] " + String(__e && __e.message || __e)); } })();
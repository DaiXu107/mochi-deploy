(function () { try {
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
let audioCtx = null, soundOn = true;
function beep(freq, dur, vol, type) {
if (!soundOn) return;
try {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
function coinDayKey() {
const d = new Date();
return prefix() + ':ml2_coin_ms_' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function grantCoin(fen) {
let cur = 0;
try { cur = Number(localStorage.getItem(coinDayKey())) || 0; } catch (e) {}
const real = Math.min(fen, MS_COIN_CAP - cur);
if (real <= 0) return 0;
try { localStorage.setItem(coinDayKey(), String(cur + real)); } catch (e2) {}
try { if (typeof window.giftWalletChange === 'function') window.giftWalletChange(real, real, '合作扫雷'); } catch (e3) {}
return real;
}
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
function taDecide(mode) {
const hidden = [];
for (let i = 0; i < N(); i++) if (!st.open[i] && !st.flag[i]) hidden.push(i);
if (!hidden.length) {
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
const worst = ranked[ranked.length - 1];
if (worst && worst.p >= 0.72 && Math.random() < 0.3) return { type: 'flag', idx: worst.i, guess: true };
return { type: 'dig', idx: ranked[0].i };
}
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
let extraMsg = '';    // 一次性补充说明（如 TA 挪旗吐槽），由 composeStatus 消费
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
const lines = kind === 'flower'
? ['挖到一朵小花，「这个给你。」', '发现了这个，觉得很适合你。']
: ['挖到了一个小礼物，「这个给你。」', '发现了这个，「送你呀。」'];
const say = pick(lines) || lines[0];
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
boardEl.classList.remove('ms-quake'); void boardEl.offsetWidth; boardEl.classList.add('ms-quake');
updateHud();
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
const msMult = (window.arcadeMult && window.arcadeMult('ms')) || 1;
const real = grantCoin((base + flawless) * msMult);
if (real > 0) s.coinEarned += real;
sfxWin();
} else {
sfxFail();
}
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
if (!st || !st.over || panel.hidden) return;
showOverlay(win ? '💣 合作完成' : '💥 差一点', body, '再来一次');
};
if (showDelay) setTimeout(showResult, Math.round(showDelay * fastMul()));
else showResult();
if (startBtn) startBtn.textContent = '再来一次';
if (endBtn) endBtn.hidden = false;
try {
const msStats = ['你探索 ' + s.digs.you + ' 格 · {ta}探索 ' + s.digs.ta + ' 格',
'💣 找到地雷 ' + s.minesFound + '/' + s.mineTotal + ' · 🎁 宝物 ' + (gifts + flowers),
'难度 ' + DIFFS[s.diffKey].name].concat(s.coinEarned > 0 ? ['🪙 我的心意币 +¥' + (s.coinEarned / 100).toFixed(2)] : []).concat(msDrop ? ['🎁 掉落限定摆件「' + msDrop.name + '」'] : []);
if (window.chatAddSystem) window.chatAddSystem(T('合作扫雷') + ' · ' + (win ? '完成 ' + DIFFS[s.diffKey].name : '差一点（' + DIFFS[s.diffKey].name + '）'), { special: 'ms', game: {
name: '合作扫雷',
outcome: win ? 'clear' : 'fail',
result: win ? '雷区清理完成！' : '差一点，雷太多了',
stats: msStats
} });
const fb = win
? ['一起找完了。', '我们配合得不错嘛。', '全部清完啦，开心。', '这一片雷区都清理干净了。']
: ['差一点点而已，再来！', '下次小心一点就好。', '没事，再来一次？'];
const say = (fb.length ? pick(fb) : fb[0]) || 'ok';
setTimeout(() => { try { if (say) taTalk(say); } catch (e) {} }, 900);
} catch (e) {}
}
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
function curHint() {
const d = DIFFS[selDiff];
return d.name + ' · ' + d.n + '×' + d.n
+ (d.mines ? ' · ' + d.mines + ' 颗雷' : ' · 本局无雷，纯挖宝藏');
}
function hideOverlay() { if (overlayEl) overlayEl.hidden = true; if (endBtn) endBtn.hidden = true; }
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
try {
st = newState(selDiff);
buildBoardDom();
} catch (ePre) {}
function bagText() {
const keeps = loadKeeps();
if (!keeps.length) return '还没有收藏。\n一起挖挖看吧，🎁 和 🌸 都藏在地里。';
let giftN = 0, flowerN = 0;
keeps.forEach((k) => { if (k.t === 'gift') giftN++; else if (k.t === 'flower') flowerN++; });
const fmt = (ts) => { const d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
const recent = keeps.slice(-4).reverse().map((k) => (k.t === 'gift' ? '🎁' : '🌸') + ' ' + fmt(k.ts) + (k.by === 'ta' ? '（' + T('TA') + '送的）' : ''));
return '🎁 神秘礼物 ×' + giftN + '\n🌸 花朵 ×' + flowerN + '\n\n最近：\n' + recent.join('\n');
}
let lpTimer = null, lpFired = false, lastFlagTs = 0;
boardEl.addEventListener('pointerdown', (e) => {
const cell = e.target.closest('.ms-cell');
if (!cell) return;
e.stopPropagation();
lpFired = false;
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
function setNames() {
let name = T('TA');
try {
const s = window.activeStore && window.activeStore();
name = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || name;
} catch (e) {}
if (partnerNameEl) partnerNameEl.textContent = name;
}
window.openMsPanel = function () {
try { if (isFs) toggleFs(); } catch (e) {}
panel.hidden = false;
try { setNames(); } catch (e) {}
try { fitBoard(); } catch (e) {}
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
if (window.__mochiLoaded) window.__mochiLoaded.push("coop-mine.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("coop-mine.js"); try { console.error("[JS] coop-mine.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[coop-mine.js] " + String(__e && __e.message || __e)); } })();
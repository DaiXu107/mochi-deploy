(function () { try {
(function () {
const panel = document.getElementById('chat-memory-panel');
if (!panel) return;
const boardEl = document.getElementById('memory-board');
const stageEl = document.querySelector('#chat-memory-panel .mgm-stage');
const overlayEl = document.getElementById('memory-overlay');
const overlayTitleEl = document.getElementById('memory-overlay-title');
const overlayBodyEl = document.getElementById('memory-overlay-body');
const overlayBtnEl = document.getElementById('memory-overlay-btn');
const overlayBtn2El = document.getElementById('memory-overlay-btn2');
const diffSel = document.getElementById('memory-diff');
const soundBtn = document.getElementById('memory-sound');
const closeBtn = document.getElementById('memory-close');
const fsBtn = document.getElementById('memory-fs');
let isFs = false;
function toggleFs() {
isFs = !isFs;
panel.classList.toggle('game-fs', isFs);
if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
setTimeout(() => { try { if (typeof fitBoard === 'function') fitBoard(); } catch (e) {} }, 60);
}
if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
const partnerNameEl = document.getElementById('memory-partner-name');
const turnEl = document.getElementById('memory-turn');
const chemEl = document.getElementById('memory-chem');
const coinEl = document.getElementById('memory-coin');
const hintEl = document.getElementById('memory-hint');
function T(x) { return (window.taFit ? window.taFit(x) : x); }
function partnerName() { return (typeof window.chatPartnerName === 'function') ? window.chatPartnerName() : 'TA'; }
function shuffle(arr) {
const a = arr.slice();
for (let i = a.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
const t = a[i]; a[i] = a[j]; a[j] = t;
}
return a;
}
function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
function todayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function storeKey(suf) { return (window.activePrefix ? window.activePrefix() : 'xy-home-v2:default') + ':' + suf; }
const DIFFS = {
casual: { label: '休闲', opt: '🌱 休闲 3×4',  cols: 4, rows: 3, pairs: 6,  memory: 0.60, pause: [520, 900] },
normal: { label: '普通', opt: '🌙 普通 4×4',  cols: 4, rows: 4, pairs: 8,  memory: 0.80, pause: [460, 780] },
hard:   { label: '挑战', opt: '⭐ 挑战 4×5',  cols: 5, rows: 4, pairs: 10, memory: 0.95, pause: [400, 660] },
king:   { label: '王者', opt: '👑 王者 6×5',  cols: 6, rows: 5, pairs: 15, memory: 0.97, pause: [360, 600] },
legend: { label: '传奇', opt: '🏆 传奇 6×7',  cols: 7, rows: 6, pairs: 21, memory: 0.98, pause: [320, 540] }
};
function curDiff() { return DIFFS[(diffSel && diffSel.value) || 'normal'] || DIFFS.normal; }
function syncDiffSel() {
if (!diffSel) return;
const want = String(diffSel.value || 'normal');
diffSel.innerHTML = '';
for (const k in DIFFS) {
const o = document.createElement('option');
o.value = k; o.textContent = DIFFS[k].opt;
if (k === want) o.selected = true;
diffSel.appendChild(o);
}
if (!DIFFS[want]) diffSel.value = 'normal';
}
syncDiffSel();
const THEMES = {
night:   { ico: '🌙', name: '星夜', faces: ['🌙', '⭐', '🌸', '🍓', '🐟', '🍀', '☁️', '🦋', '🍑', '🌊', '✨', '🔮', '🧸', '🎈', '🍭', '🐰', '🐱', '🦄', '🌈', '💌', '🍩', '🐥', '⛄', '🍬'] },
dessert: { ico: '🧁', name: '甜品', faces: ['🍰', '🧁', '🍩', '🍪', '🍫', '🍬', '🍭', '🍮', '🍦', '🧇', '🥞', '🍓', '🍯', '🫖', '☕', '🧋', '🥐', '🥨', '🥯', '🧈', '🍞', '🍥', '🍡', '🥮'] },
ocean:   { ico: '🌊', name: '海洋', faces: ['🐬', '🐟', '🐠', '🦈', '🐙', '🦀', '🐡', '🦐', '🐳', '🐚', '🌊', '⛵', '🪸', '⭐', '🫧', '🦞', '🦑', '🦦', '🦭', '🐢', '⚓', '🎣', '🚤', '💧'] }
};
const THEME_ORDER = Object.keys(THEMES);
let themeKey = 'night';
function themeFaces() { return (THEMES[themeKey] || THEMES.night).faces; }
function loadTheme() {
try { const t = localStorage.getItem(storeKey('memory-theme')); if (THEMES[t]) themeKey = t; } catch (e) {}
}
const themeBtnEl = (function () {
if (!soundBtn || !soundBtn.parentNode) return null;
const b = document.createElement('button');
b.type = 'button';
b.className = 'snake-icon-btn';
b.id = 'memory-theme';
b.addEventListener('click', (e) => {
e.stopPropagation();
themeKey = THEME_ORDER[(THEME_ORDER.indexOf(themeKey) + 1) % THEME_ORDER.length];
try { localStorage.setItem(storeKey('memory-theme'), themeKey); } catch (e2) {}
syncThemeBtn();
if (!game) buildPreview();   // 未开局换预览牌墙；对局中不换面（防读牌记忆串图案）
beep(520, 0.06, 0.07);
});
soundBtn.parentNode.insertBefore(b, soundBtn);
return b;
})();
function syncThemeBtn() {
if (!themeBtnEl) return;
const th = THEMES[themeKey] || THEMES.night;
themeBtnEl.textContent = th.ico;
themeBtnEl.title = '牌面主题：' + th.name + '（点击切换）';
}
loadTheme();
syncThemeBtn();
const YUAN = 100;
const COIN_CLEAR = 5;      // 完成一局 +5
const COIN_STREAK = 1;     // 连续配对每次 +1
const COIN_ALL = 2;        // 全部完成 +2
const COIN_FIRST = 5;      // 首次通关某难度 +5
const COIN_DAILY_CAP = 30; // 每日奖励上限（元）
function walletGet() {
const s = window.xyStore && window.xyStore('xy-home-v2');
if (!s) return { myBalance: 52000, systemBalance: 52000 };
try {
const w = JSON.parse(s.get('gift-wallet') || '');
if (typeof w.myBalance === 'number' && typeof w.systemBalance === 'number') return w;
} catch (e) {}
let seed = { myBalance: 52000, systemBalance: 52000 }; // v3.15.x：默认对齐 ¥520/¥520
try {
const o = JSON.parse(s.get('rp-wallet') || '');
if (typeof o.myBalance === 'number' && typeof o.systemBalance === 'number') seed = { myBalance: o.myBalance, systemBalance: o.systemBalance };
} catch (e) {}
try { s.set('gift-wallet', JSON.stringify(seed)); } catch (e) {}
return seed;
}
function walletSet(w) { const s = window.xyStore && window.xyStore('xy-home-v2'); if (s) s.set('gift-wallet', JSON.stringify(w)); }
function readDaily() {
try { const o = JSON.parse(localStorage.getItem(storeKey('memory-coin-day')) || ''); if (o && typeof o.total === 'number') return o; } catch (e) {}
return { date: todayKey(), total: 0 };
}
function writeDaily(o) { try { localStorage.setItem(storeKey('memory-coin-day'), JSON.stringify(o)); } catch (e) {} }
function readFirst() {
try { return String(localStorage.getItem(storeKey('memory-first-clears')) || '').split(',').filter(Boolean); } catch (e) { return []; }
}
function writeFirst(list) { try { localStorage.setItem(storeKey('memory-first-clears'), Array.isArray(list) ? list.join(',') : ''); } catch (e) {} }
function readStats() {
try { const o = JSON.parse(localStorage.getItem(storeKey('memory-stats')) || ''); if (o && typeof o === 'object') return Object.assign({ bestChem: 0, clears: 0 }, o); } catch (e) {}
return { bestChem: 0, clears: 0 };
}
function writeStats(o) { try { localStorage.setItem(storeKey('memory-stats'), JSON.stringify(o)); } catch (e) {} }
function grantCoins(yuan) {
const daily = readDaily();
if (daily.date !== todayKey()) { daily.date = todayKey(); daily.total = 0; }
const capFen = COIN_DAILY_CAP * YUAN;
const remain = Math.max(0, capFen - daily.total);
const grantFen = Math.min(Math.round(yuan * YUAN), remain);
if (grantFen > 0) {
daily.total += grantFen;
try { localStorage.setItem(storeKey('memory-coin-day'), JSON.stringify(daily)); } catch (e) { return 0; }
if (window.giftWalletChange) window.giftWalletChange(grantFen, grantFen, '记忆翻牌');
else {
const w = walletGet();
w.myBalance = (w.myBalance || 0) + grantFen;
walletSet(w);
}
}
return grantFen;
}
let audioCtx = null, soundOn = true;
function beep(freq, dur, vol) {
if (!soundOn) return;
try {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
const o = audioCtx.createOscillator(), g = audioCtx.createGain();
o.frequency.value = freq; o.type = 'sine';
g.gain.value = vol || 0.08;
o.connect(g); g.connect(audioCtx.destination);
const t = audioCtx.currentTime;
o.start(t); g.gain.setValueAtTime(g.gain.value, t);
g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
o.stop(t + (dur || 0.08));
} catch (e) {}
}
function sfxFlip() { beep(480, 0.05, 0.07); }
function sfxMatch() { beep(660, 0.1, 0.09); setTimeout(() => beep(880, 0.12, 0.09), 90); }
function sfxMiss() { beep(300, 0.12, 0.06); }
let game = null;
let timers = [];
function newGame(diff) {
const d = DIFFS[diff] || DIFFS.normal;
const faces = shuffle(themeFaces()).slice(0, d.pairs);
const cards = shuffle(faces.concat(faces)).map((face, idx) => ({
id: idx, face: face, matched: false, flipped: false, owner: null
}));
return {
diff: diff || 'normal',
params: d,
cards: cards,
turn: Math.random() < 0.5 ? 'player' : 'ta',
phase: 'idle',          // idle | resolving | ended
first: null, second: null,
myPairs: 0, taPairs: 0,
myFlips: 0, taFlips: 0,
chemistry: 50,
streak: 0, streakOwner: null,
coinFen: 0,             // 连续配对累计（分）
known: {},              // TA 记忆：face -> [id...]
lastPlayerFace: null, lastTaFace: null
};
}
function applyBoardLayout(d) {
if (!boardEl) return;
boardEl.style.gridTemplateColumns = 'repeat(' + d.cols + ', 1fr)';
boardEl.style.setProperty('--mgm-fs', d.cols <= 3 ? '32px' : d.cols === 4 ? '27px' : d.cols === 5 ? '23px' : d.cols === 6 ? '20px' : '18px');
}
function fitBoard() {
if (!boardEl || !panel || panel.hidden || !stageEl) return;
const d = game ? game.params : curDiff();
const COLS = d.cols, ROWS = d.rows, GAP = 7;
const sw = stageEl.clientWidth;
if (isFs && sw > 0) {
let cell = Math.floor((sw - (COLS - 1) * GAP) / COLS);
const sh = stageEl.clientHeight;
if (sh > 0) cell = Math.max(24, Math.min(cell, Math.floor((sh - (ROWS - 1) * GAP) / (ROWS * 1.36))));
boardEl.style.width = (COLS * cell + (COLS - 1) * GAP) + 'px';
boardEl.style.setProperty('--mgm-fs', Math.round(cell * 0.5) + 'px');
} else {
boardEl.style.width = '';
applyBoardLayout(d);
}
}
function makeCardEl(face, idx, withClick) {
const b = document.createElement('button');
b.type = 'button';
b.className = 'mgm-card';
b.dataset.idx = String(idx);
b.setAttribute('aria-label', '第 ' + (idx + 1) + ' 张牌');
b.innerHTML = '<span class="mgm-in"><span class="mgm-back"><i>✦</i></span><span class="mgm-face">' + face + '</span></span>';
if (withClick) b.addEventListener('click', () => onCardClick(idx));
return b;
}
function buildBoard(g) {
if (!boardEl) return;
applyBoardLayout(g.params);
boardEl.innerHTML = '';
g.cards.forEach((card, idx) => boardEl.appendChild(makeCardEl(card.face, idx, true)));
fitBoard();
}
function buildPreview() {
if (!boardEl) return;
const d = curDiff();
const faces = shuffle(themeFaces()).slice(0, d.pairs);
const cards = shuffle(faces.concat(faces));
applyBoardLayout(d);
boardEl.innerHTML = '';
cards.forEach((face, idx) => boardEl.appendChild(makeCardEl(face, idx, false)));
fitBoard();
}
function syncCard(idx) {
const g = game;
if (!g) return;
const card = g.cards[idx];
const el = boardEl.querySelector('.mgm-card[data-idx="' + idx + '"]');
if (!el) return;
el.classList.toggle('flipped', card.flipped || card.matched);
el.classList.toggle('matched', card.matched);
el.classList.toggle('mgm-own-p', card.matched && card.owner === 'player');
el.classList.toggle('mgm-own-t', card.matched && card.owner === 'ta');
}
function renderInfo() {
const g = game;
if (!g) return;
if (turnEl) {
if (g.phase === 'ended') turnEl.textContent = '本局完成';
else if (g.turn === 'player') turnEl.textContent = '轮到你了';
else turnEl.textContent = T('TA') + ' 的回合';
}
if (chemEl) chemEl.textContent = '💕 默契 ' + Math.min(100, Math.round(g.chemistry));
if (coinEl) coinEl.textContent = '心意币 +' + Math.round(g.coinFen / YUAN);
}
function hint(text) { if (hintEl) hintEl.textContent = text || ''; }
function flipCard(card) { card.flipped = true; taObserve(card); }
function taObserve(card) {
const g = game;
if (!g || card.matched) return;
if (Math.random() > g.params.memory) return;      // 这次没记住
if (!g.known[card.face]) g.known[card.face] = [];
const arr = g.known[card.face];
if (arr.indexOf(card.id) < 0) arr.push(card.id);
}
function availableCards(g) { return g.cards.filter(c => !c.matched && !c.flipped); }
function cardById(id) { const g = game; return g ? g.cards[id] : null; }
function findKnownPair(g) {
for (const face in g.known) {
const arr = g.known[face];
if (arr.length >= 2) {
const cards = arr.map(cardById).filter(c => c && !c.matched && !c.flipped);
if (cards.length >= 2) return { a: cards[0], b: cards[1] };
}
}
return null;
}
function findOtherKnown(g, face) {
const arr = g.known[face] || [];
for (const id of arr) {
const c = cardById(id);
if (c && !c.matched && !c.flipped) return c;
}
return null;
}
function taPickFirst(g) {
const avail = availableCards(g);
if (!avail.length) return null;
const knownPair = findKnownPair(g);
if (knownPair) return knownPair.a;                 // ①发现配对 / 记错（第二张决定记没记对）
return pick(avail);                                // ②③随便翻 / 顺着线索碰运气
}
function taPickSecond(g, first) {
const avail = availableCards(g);                   // 已排除 first（flipped=true）
if (!avail.length) return null;
const knownPair = findKnownPair(g);
if (knownPair && knownPair.a === first) {
if (Math.random() < g.params.memory) return knownPair.b;         // 记对
return pick(avail.filter(c => c !== knownPair.b));               // ④记错：选错一张
}
const other = findOtherKnown(g, first.face);
if (other && Math.random() < g.params.memory) return other;        // 记得 first 的另一半
return pick(avail);
}
function fastMode() { return !!(window.__mgmDebug && window.__mgmDebug.fast); }
function randPause() {
if (fastMode()) return 60 + Math.random() * 80;
const p = game ? game.params.pause : [500, 800]; return p[0] + Math.random() * (p[1] - p[0]);
}
function scheduleTa() {
const g = game;
if (!g || g.phase !== 'idle' || g.turn !== 'ta') return;
timers.push(setTimeout(() => {
if (!game || game !== g || g.turn !== 'ta' || g.phase !== 'idle') return;
const first = taPickFirst(g);                    // ③犹豫：翻第一张前等待
if (!first) return;
flipCard(first); g.first = first;
syncCard(first.id);
sfxFlip();
hint(T('TA') + '翻开了 ' + first.face);
if (first.face === g.lastPlayerFace) hint(T('TA') + '记得你刚翻过的 ' + first.face + '…');
timers.push(setTimeout(() => {
if (!game || game !== g || g.turn !== 'ta' || g.phase !== 'idle') return;
const second = taPickSecond(g, first);
if (!second) return;
flipCard(second); g.second = second;
syncCard(second.id);
sfxFlip();
resolveTurn();
}, randPause()));
}, randPause()));
}
function resolveTurn() {
const g = game;
if (!g || !g.first || !g.second) return;
const f = g.first, s = g.second;
const me = g.turn;
const match = f.face === s.face;
if (me === 'player') { g.myFlips += 2; g.lastPlayerFace = f.face; }
else { g.taFlips += 2; g.lastTaFace = f.face; }
g.first = g.second = null;
if (match) {
f.matched = s.matched = true;
f.owner = s.owner = me;
if (me === 'player') g.myPairs++; else g.taPairs++;
g.chemistry += 4;                                 // 配对成功
if (g.streakOwner === me) { g.streak++; g.chemistry += 2; g.coinFen += COIN_STREAK * YUAN; }
else { g.streak = 1; g.streakOwner = me; }
if (me === 'ta' && f.face === g.lastPlayerFace) g.chemistry += 3;   // ⑥TA 找到你刚翻过的
if (me === 'player' && f.face === g.lastTaFace) g.chemistry += 3;   // 你找到 TA 刚翻过的
sfxMatch();
syncCard(f.id); syncCard(s.id);
renderInfo();
if (g.myPairs + g.taPairs >= g.params.pairs) {
endGame();
return;
}
g.phase = 'idle';
setTurn(me);
if (me === 'player') hint('配对成功！再来一次');
else { hint(T('TA') + '又找到一对'); scheduleTa(); }
} else {
g.chemistry = Math.max(0, g.chemistry - 3);       // 翻错：不扣太多
g.streak = 0; g.streakOwner = null;
sfxMiss();
g.phase = 'resolving';
hint('不一样…盖回去了');
timers.push(setTimeout(() => {
if (!game) return;
f.flipped = s.flipped = false;
syncCard(f.id); syncCard(s.id);
g.phase = 'idle';
g.lastPlayerFace = me === 'player' ? f.face : g.lastPlayerFace;
const next = me === 'player' ? 'ta' : 'player';
setTurn(next);
if (next === 'ta') { hint(T('TA') + '的回合'); scheduleTa(); }
else hint('轮到你了');
}, fastMode() ? 120 : 760));
}
}
function setTurn(who) {
const g = game;
if (!g) return;
g.turn = who;
renderInfo();
}
function endGame() {
const g = game;
if (!g || g.phase === 'ended') return;
g.phase = 'ended';
stopTimers();
g.chemistry = Math.max(0, Math.min(100, Math.round(g.chemistry + 5)));   // 全部完成 +5
const firsts = readFirst();
const firstClear = firsts.indexOf(g.diff) < 0;
if (firstClear) { firsts.push(g.diff); writeFirst(firsts); }
const totalYuan = COIN_CLEAR + Math.round(g.coinFen / YUAN) + COIN_ALL + (firstClear ? COIN_FIRST : 0);
const memMult = (window.arcadeMult && window.arcadeMult('memory')) || 1;
const grantedYuan = Math.round(grantCoins(totalYuan * memMult) / YUAN);
let memDrop = null;
try {
if (window.arcadeMarkLuckyPlayed) window.arcadeMarkLuckyPlayed('memory');
if (window.arcadeTryDrop) memDrop = window.arcadeTryDrop('memory');
} catch (e) {}
const stats = readStats();
stats.clears = (stats.clears || 0) + 1;
stats.bestChem = Math.max(stats.bestChem || 0, g.chemistry);
writeStats(stats);
renderInfo();
if (overlayTitleEl) overlayTitleEl.textContent = '🎉 完成！';
if (overlayBodyEl) {
overlayBodyEl.innerHTML =
'<div class="pong-end-score">找到 ' + g.params.pairs + ' / ' + g.params.pairs + ' 对</div>' +
'<div class="pong-end-stat">你　配对 ' + g.myPairs + ' · 翻牌 ' + g.myFlips + ' 次</div>' +
'<div class="pong-end-stat">' + T('TA') + '　配对 ' + g.taPairs + ' · 翻牌 ' + g.taFlips + ' 次</div>' +
'<div class="memory-res-chem">💕 默契 ' + g.chemistry + '</div>' +
'<div class="memory-res-coin">获得心意币 +' + grantedYuan + (grantedYuan < totalYuan * memMult ? '（今日奖励已达上限 +' + COIN_DAILY_CAP + '）' : (firstClear ? '（首次通关' + g.params.label + '）' : '')) + '</div>' +
'<div class="pong-end-stat">累计完成 ' + stats.clears + ' 局 · 历史最佳默契 ' + stats.bestChem + '</div>' +
(memDrop ? '<div class="pong-end-stat">🎁 掉落限定摆件「' + memDrop.name + '」</div>' : '');
}
if (overlayBtnEl) overlayBtnEl.textContent = '再玩一局';
if (overlayBtn2El) { overlayBtn2El.textContent = '返回小游戏'; overlayBtn2El.hidden = false; }
if (overlayEl) overlayEl.hidden = false;
try {
if (window.chatAddSystem) {
window.chatAddSystem('记忆翻牌 · 你 ' + g.myPairs + ' 对 · ' + T('TA') + ' ' + g.taPairs + ' 对 · 默契 ' + g.chemistry, { special: 'memory' });
}
const pool = window.getInteractPool
? window.getInteractPool('游戏平局·回应', ['一起找完了。', '好默契呀。', '差不多嘛。', '再来一局？'])
: ['一起找完了。', '好默契呀。'];
const say = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''; // #1515 整组停用＝静默（记忆翻牌）
if (say) setTimeout(() => {
try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
}, 800);
} catch (e) {}
}
function showStartOverlay() {
const d = curDiff();
if (overlayTitleEl) overlayTitleEl.textContent = '记忆翻牌';
if (overlayBodyEl) {
overlayBodyEl.innerHTML =
'<div class="pong-start-tip">和 ' + T('TA') + ' 一起，把藏起来的牌全部找出来</div>' +
'<div class="pong-start-ctrl">' + d.label + ' · ' + d.cols + '×' + d.rows + ' · ' + d.pairs + ' 对 · 轮流翻两张</div>' +
'<div class="pong-start-ctrl">配对成功再来一次 · 结束记默契与心意币</div>';
}
if (overlayBtnEl) overlayBtnEl.textContent = '开始';
if (overlayBtn2El) overlayBtn2El.hidden = true;
if (overlayEl) overlayEl.hidden = false;
}
function startGame(diff) {
stopTimers();
game = newGame(diff || ((diffSel && diffSel.value) || 'normal'));
buildBoard(game);
renderInfo();
if (overlayEl) overlayEl.hidden = true;
if (game.turn === 'player') hint('轮到你了 · 翻开两张牌');
else { hint(T('TA') + '先开始…'); scheduleTa(); }
}
function stopTimers() {
timers.forEach(t => clearTimeout(t));
timers = [];
}
function onCardClick(idx) {
const g = game;
if (!g || g.phase !== 'idle') return;
if (g.turn !== 'player') { hint(T('TA') + '翻牌中 · 等它翻完'); return; }
const card = g.cards[idx];
if (!card || card.matched || card.flipped) return;
flipCard(card);
sfxFlip();
if (!g.first) {
g.first = card;
hint('再翻一张');
} else {
g.second = card;
resolveTurn();
}
syncCard(idx);
renderInfo();
}
window.openMemoryPanel = function () {
try { if (isFs) toggleFs(); } catch (e) {}
if (!panel) return;
if (partnerNameEl) {
try {
const s = window.activeStore && window.activeStore();
partnerNameEl.textContent = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || (window.taWord ? window.taWord() : 'TA');
} catch (e) { partnerNameEl.textContent = partnerName(); }
}
stopTimers();
game = null;
buildPreview();
if (turnEl) turnEl.textContent = '';
if (chemEl) chemEl.textContent = '💕 默契 —';
if (coinEl) coinEl.textContent = '心意币 +0';
hint('');
showStartOverlay();
panel.hidden = false;
};
window.closeMemoryPanel = function () {
stopTimers();
game = null;
if (panel) panel.hidden = true;
};
if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); window.closeMemoryPanel(); });
if (overlayBtnEl) overlayBtnEl.addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
if (overlayBtn2El) overlayBtn2El.addEventListener('click', (e) => { e.stopPropagation(); window.closeMemoryPanel(); });
if (diffSel) {
diffSel.addEventListener('change', () => {
stopTimers();
game = null;
showStartOverlay();
buildPreview();
});
}
if (soundBtn) {
soundBtn.addEventListener('click', () => {
soundOn = !soundOn;
soundBtn.textContent = soundOn ? '🔊' : '🔇';
soundBtn.classList.toggle('pong-sound-off', !soundOn);
});
}
document.addEventListener('contact-switched', () => { try { window.closeMemoryPanel(); } catch (e) {} });
window.addEventListener('resize', () => { try { if (!panel.hidden) fitBoard(); } catch (e) {} });
if (panel) panel.addEventListener('pointerdown', function () {
try {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
} catch (e) {}
}, { capture: true });
(function bindEntry() {
const btn = document.getElementById('more-memory');
if (!btn) return;
btn.addEventListener('click', (e) => {
e.stopPropagation();
const mp = document.getElementById('chat-more-panel');
if (mp) mp.hidden = true;
const hideIds = ['poke-card', 'emoji-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-snake-panel', 'chat-pong-panel', 'chat-brick-panel', 'chat-fish-panel', 'chat-c4-panel'];
hideIds.forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
try { if (window.closeC4Panel) window.closeC4Panel(); } catch (err) {}
try { if (window.closeFishPanel) window.closeFishPanel(); } catch (err) {}
try { window.openMemoryPanel(); } catch (err) {
try { panel.hidden = false; } catch (e2) {}
try { console.error('[memory] open failed', err); } catch (e2) {}
}
});
try {
if (window.MutationObserver) {
const SIBLING_IDS = ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-fish-panel', 'chat-c4-panel', 'chat-more-panel'];
const mo = new MutationObserver(() => {
if (panel.hidden) return;
for (let i = 0; i < SIBLING_IDS.length; i++) {
const el = document.getElementById(SIBLING_IDS[i]);
if (el && !el.hidden) { window.closeMemoryPanel(); break; }
}
});
SIBLING_IDS.forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
}
} catch (e) {}
})();
window.__mgmDebug = {
st: () => game,
fast: false
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("memory-game.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("memory-game.js"); try { console.error("[JS] memory-game.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[memory-game.js] " + String(__e && __e.message || __e)); } })();
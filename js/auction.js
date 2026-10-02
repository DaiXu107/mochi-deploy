(function () { try {
(function () {
const panel = document.getElementById('chat-auction-panel');
if (!panel) return;
const stageEl = document.getElementById('au-stage');
const itemEl = document.getElementById('au-item');
const lotEl = document.getElementById('au-lot');
const balanceEl = document.getElementById('au-balance');
const statusEl = document.getElementById('au-status');
const overlayEl = document.getElementById('au-overlay');
const ovTitleEl = document.getElementById('au-ov-title');
const ovBodyEl = document.getElementById('au-ov-body');
const startBtn = document.getElementById('au-btn-start');
const endBtn = document.getElementById('au-btn-end');
const bid1Btn = document.getElementById('au-bid1');
const bid5Btn = document.getElementById('au-bid5');
const bid13Btn = document.getElementById('au-bid13');
const passBtn = document.getElementById('au-pass');
const bagBtn = document.getElementById('au-bag');
const soundBtn = document.getElementById('au-sound');
const closeBtn = document.getElementById('au-close');
const fsBtn = document.getElementById('au-fs');
const helpBtn = document.getElementById('au-help-btn');
const helpOverlay = document.getElementById('au-help');
const helpClose = document.getElementById('au-help-close');
const introEl = document.getElementById('au-intro');
const introStepsEl = document.getElementById('au-intro-steps');
const introStatEl = document.getElementById('au-intro-stat');
const introStart = document.getElementById('au-intro-start');
const introHelp = document.getElementById('au-intro-help');
const introExit = document.getElementById('au-intro-exit');
const walletHintEl = document.getElementById('au-wallet-hint');
const historyBtn = document.getElementById('au-history');
const addBtn = document.getElementById('au-add');
function showHelp() { if (helpOverlay) helpOverlay.hidden = false; }
function hideHelp() { if (helpOverlay) helpOverlay.hidden = true; }
function showIntro() { if (introEl) introEl.hidden = false; }
function hideIntro() { if (introEl) introEl.hidden = true; }
if (helpBtn) helpBtn.addEventListener('click', (e) => { e.stopPropagation(); showHelp(); });
if (helpClose) helpClose.addEventListener('click', (e) => { e.stopPropagation(); hideHelp(); });
if (introStart) introStart.addEventListener('click', (e) => { e.stopPropagation(); newSession(); });
if (introHelp) introHelp.addEventListener('click', (e) => { e.stopPropagation(); showHelp(); });
if (introExit) introExit.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
let isFs = false;
function toggleFs() {
isFs = !isFs;
panel.classList.toggle('game-fs', isFs);
if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
setTimeout(() => { try { if (typeof fitBoard === 'function') fitBoard(); } catch (e) {} }, 60);
}
if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
const partnerNameEl = document.getElementById('au-partner-name');
const STEP1 = 100, STEP5 = 500, STEP13 = 1314;      // 加价档（分）
const POOL = [
{ ico: '🌹', name: '永生玫瑰', desc: '不会枯的那种', base: 520, wish: '花会谢，心意不会。' },
{ ico: '🧸', name: 'Mochi 玩偶', desc: '捏起来很解压', base: 900, wish: '想我的时候就捏捏它。' },
{ ico: '🧋', name: '奶茶年卡', desc: '每天一杯半糖去冰', base: 1314, wish: '第一杯请你喝。' },
{ ico: '🎧', name: '降噪耳机', desc: '世界的开关', base: 1990, wish: '戴上就是我的世界。' },
{ ico: '🎮', name: '复古掌机', desc: '内置 520 个小游戏，猜猜是什么', base: 2600, wish: '双人游戏留给你。', mystery: 1 },
{ ico: '📷', name: '拍立得', desc: '把此刻留住', base: 3130, wish: '第一张拍你。' },
{ ico: '⌚', name: '情侣对表', desc: '一对，走时一致，猜猜是什么', base: 5200, wish: '以后时间一起过。', mystery: 1 },
{ ico: '🧣', name: '手织围巾', desc: '织错的针脚都是心意', base: 1314, wish: '歪的地方是我想你。' },
{ ico: '🍰', name: '下午茶券', desc: '双人份，周末有效', base: 520, wish: '周末不见不散。' },
{ ico: '🎫', name: '演唱会门票', desc: '两张，你偶像的，猜猜是什么', base: 3999, wish: '合唱那首你跑调的。', mystery: 1 },
{ ico: '💐', name: '全明星花束', desc: '什么花都有一点', base: 1314, wish: '像你，什么都好。' },
{ ico: '💎', name: '小钻戒', desc: '别紧张，不是那种……大概', base: 9999, wish: '先占个位置。', mystery: 1 }
];
const TA_MODES = {
eager:  { factor: 1.5,  stepPref: [STEP5, STEP13, STEP13], talk: '眼睛亮了，志在必得', calls: ['跟！这件我要定了', '就这点诚意？接着', '休想从我手里抢走'] },
normal: { factor: 1.15, stepPref: [STEP1, STEP5, STEP13],  talk: '掂了掂这件的分量', calls: ['这件我挺喜欢的', '我掂量着值这个价', '那我也加一点'] },
stingy: { factor: 0.7,  stepPref: [STEP1, STEP1, STEP5],   talk: '皱着眉算了算', calls: ['唔……勉强跟一手', '快超预算了呀', '再贵我就撤了'] },
bluff:  { factor: 1.2,  stepPref: [STEP13, STEP5, STEP5],  talk: '一路跟得飞快，像真想要', calls: ['加价不加价？跟', '气势不能输', '谁怕谁呀'] }
};
const TALK_MIN = 850, TALK_VAR = 900;
const LOTS_PER_SESSION = 3;
const T = window.taFit || function (x) { return x; };
function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
function fastMul() { return (window.__auDebug && window.__auDebug.fast) ? 0.05 : 1; }
function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function yuan(fen) { return '¥' + (fen / 100).toFixed(2); }
function yuanC(fen) { const v = fen / 100; return Number.isInteger(v) ? '¥' + v : '¥' + v.toFixed(2); } // #321 整数省略 .00，按钮直白些
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const RARITY = [['普通', 'au-r0'], ['稀有', 'au-r1'], ['SSR', 'au-r2']];
function rarityOf(item) { const r = (item && item.base >= 5000) ? 2 : (item && item.base >= 2600) ? 1 : 0; return { label: RARITY[r][0], cls: RARITY[r][1] }; }
function buzz(p) {
try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
try { window.__auDebug.lastBuzz = p; } catch (e) {}
}
function splitKey(key) {
const i = key.lastIndexOf(':');
return i > 0 ? [key.slice(0, i), key.slice(i + 1)] : ['xy-home-v2', key];
}
function lsGet(key) {
const [p, k] = splitKey(key);
if (typeof window.xyStore === 'function') {
try { return window.xyStore(p).get(k); } catch (e) {}
}
try { return localStorage.getItem(key); } catch (e) { return null; }
}
function persist(key, val) {
const s = typeof val === 'string' ? val : JSON.stringify(val);
const [p, k] = splitKey(key);
if (typeof window.xyStore === 'function') {
try { window.xyStore(p).set(k, s); return true; } catch (e) {}
}
let ok = false;
try { localStorage.setItem(key, s); ok = true; } catch (e) {}
try { if (typeof window.idbSet === 'function') window.idbSet(key, val); } catch (e) {}
return ok;
}
function historyKey() { return prefix() + ':auction-history'; }
function loadHistory() { try { const a = JSON.parse(lsGet(historyKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function recordHistory(item, price, who) {
const h = loadHistory();
h.unshift({ t: Date.now(), ico: item.ico, img: item.img || '', name: item.name, price: price, who: who, rarity: rarityOf(item).label });
if (h.length > 60) h.length = 60;
persist(historyKey(), h);
}
function customKey() { return prefix() + ':auction-custom'; }
function loadCustom() { try { const a = JSON.parse(lsGet(customKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function saveCustom(a) { try { if (a.length > 20) a.length = 20; return persist(customKey(), a); } catch (e) { return false; } }
function activePool() {
return POOL.concat(loadCustom().map((c) => ({ ico: c.ico, img: c.img || '', name: c.name, desc: c.desc, base: c.base, wish: c.wish, mystery: c.mystery || 0, custom: 1 })));
}
let audioCtx = null;
let soundOn = true;
try { soundOn = localStorage.getItem('xy-home-v2:au-sound') !== '0'; } catch (e) {} // #343 音效偏好全局记忆（非联系人维度）
function beep(freq, dur, vol) {
if (!soundOn) return;
try {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume().catch(function () {});
const o = audioCtx.createOscillator(), g = audioCtx.createGain();
o.frequency.value = freq; o.type = 'sine';
g.gain.value = vol || 0.16;
o.connect(g); g.connect(audioCtx.destination);
const t = audioCtx.currentTime;
g.gain.setValueAtTime(g.gain.value, t);
g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
o.start(t); o.stop(t + dur);
} catch (e) {}
}
const sfxBid = () => beep(520, 0.07, 0.15);
const sfxHammer = () => { beep(880, 0.08, 0.18); setTimeout(() => beep(520, 0.12, 0.16), 90); };
const sfxLose = () => beep(300, 0.12, 0.14);
const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };
function walletOk() { return typeof window.giftWalletGet === 'function' && typeof window.giftWalletSet === 'function'; }
function myBalance() {
try { const w = window.giftWalletGet(); return (w && Number(w.myBalance)) || 0; } catch (e) { return 0; }
}
function walletDeduct(fen) {
try {
const w = window.giftWalletGet();
if (!w || (Number(w.myBalance) || 0) < fen) return false;
w.myBalance = (Number(w.myBalance) || 0) - fen;
window.giftWalletSet(w);
return true;
} catch (e) { return false; }
}
function statsKey() { return prefix() + ':auction-stats'; }
function loadStats() {
const d = { sessions: 0, myWins: 0, taWins: 0, spentFen: 0 };
try {
const raw = lsGet(statsKey());
if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
} catch (e) {}
return d;
}
function saveStats(s) { persist(statsKey(), s); }
function bagKey() { return prefix() + ':auction-items'; }
function loadBag() {
try { const a = JSON.parse(lsGet(bagKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function saveBag(a) { persist(bagKey(), a); }
function giftsKey() { return prefix() + ':au-gifts-pending'; }
function loadPending() { try { const a = JSON.parse(lsGet(giftsKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function savePending(a) { persist(giftsKey(), a); }
let giftTimer = null;
function checkGifts() {
const pend = loadPending();
if (!pend.length) return;
const now = Date.now();
let delivered = 0;
const rest = [];
pend.forEach((p) => {
if (p.due <= now) {
const bag = loadBag();
bag.unshift({ ico: p.ico, img: p.img || '', name: p.name, fen: 0, ts: Date.now(), from: 'ta' });
saveBag(bag);
delivered++;
try { if (window.chatAddIn) window.chatAddIn(T('TA') + ' 把之前拍走的「' + p.name + '」寄给你了，纸条上写：拍品该物归原主呀', {}); } catch (e) {}
} else rest.push(p);
});
if (rest.length !== pend.length) savePending(rest);
if (delivered && statusEl && !panel.hidden) setStatus('📬 ' + T('TA') + ' 寄来了 ' + delivered + ' 件拍品，已收进 🎒');
if (delivered && bagOpen) { try { showBag(); } catch (e) {} }
}
let st = null;
let thinkT = null;
let bagOpen = false; // #343/#346 背包覆盖层是否开着（寄到重渲染判定用）
function newState() {
const lots = shuffle(activePool()).slice(0, LOTS_PER_SESSION);
return {
started: false,
over: false,           // 一场是否结束
lots: lots,            // 本场拍品
idx: 0,                // 当前第几件
phase: 'idle',         // idle / bidding / done
cur: 0,                // 当前出价（分）
leader: 'none',        // none / you / ta
mode: 'normal',        // TA 本件状态
limit: 0,              // TA 心理价位（分）
spent: 0, myWins: 0, taWins: 0, passed: 0
};
}
function renderLot() {
const item = st.lots[st.idx];
if (lotEl) lotEl.textContent = '第 ' + (st.idx + 1) + ' / ' + st.lots.length + ' 件';
if (balanceEl) balanceEl.textContent = walletOk() ? '心意币 ' + yuan(myBalance()) : '心意币 —';
if (itemEl) {
let bidTxt;
if (st.leader === 'none') bidTxt = '起拍价 ' + yuan(st.cur);
else if (st.leader === 'you') bidTxt = '你的出价 ' + yuan(st.cur);
else bidTxt = esc(T('TA')) + ' 出价 ' + yuan(st.cur);
const auImg = item.mystery ? '' : auSafeImg(item.img);
const showIco = item.mystery ? '\u{1F381}' : auImg ? '<img class="au-ico-img" src="' + auImg + '" alt="">' : item.ico;
const showName = item.mystery ? '神秘拍品' : esc(item.name);
const leadCls = st.leader === 'you' ? ' au-lead-you' : st.leader === 'ta' ? ' au-lead-ta' : '';
itemEl.innerHTML =
'<div class="au-ico">' + showIco + '</div>' +
'<div class="au-name">' + showName + '</div>' +
'<div class="au-desc">' + esc(item.desc) + '</div>' +
'<div class="au-bid' + leadCls + '">' + bidTxt + '</div>';
}
updateBidBtns();
if (itemEl) { itemEl.classList.remove('au-in'); void itemEl.offsetWidth; itemEl.classList.add('au-in'); }
}
function lotActive() { return st && st.started && !st.over && st.phase === 'bidding'; }
function updateBidBtns() {
const STEPSa = [STEP1, STEP5, STEP13];
const bidBtns = [bid1Btn, bid5Btn, bid13Btn];
const cur = (st && typeof st.cur === 'number') ? st.cur : 0;
bidBtns.forEach((b, i) => { if (b && st) { b.textContent = '出 ' + yuanC(cur + STEPSa[i]); } });
const waiting = lotActive() && st.leader === 'you' && !!thinkT;
const on = lotActive() && !waiting && walletOk() && myBalance() >= st.cur + STEP1;
bidBtns.forEach((b) => { if (b) b.disabled = !on; });
if (passBtn) {
passBtn.disabled = !lotActive() || waiting;
passBtn.textContent = (lotActive() && st.leader === 'you') ? ('落槌 · ' + yuanC(st.cur)) : '放弃这件';
}
bidBtns.forEach((b, i) => {
if (b && on) {
const step = STEPSa[i];
b.disabled = myBalance() < st.cur + step;
}
});
if (walletHintEl) {
const noWallet = lotActive() && !walletOk();
const noBalance = lotActive() && walletOk() && myBalance() < st.cur + STEP1;
walletHintEl.hidden = !(noWallet || noBalance);
walletHintEl.textContent = noWallet
? '心意币账本还没就绪，先去心意集市逛逛吧'
: (noBalance ? '心意币不够出这一价了——去集市补点心意币，或点「放弃这件」' : '');
}
}
function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
let bubbleT = null;
function taSay(text) {
if (!stageEl) return;
try {
let b = stageEl.querySelector('.tg-bubble');
if (!b) { b = document.createElement('div'); b.className = 'tg-bubble'; stageEl.appendChild(b); }
b.textContent = text;
b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
clearTimeout(bubbleT);
bubbleT = setTimeout(() => { try { b.classList.remove('show'); } catch (e) {} }, 1600);
} catch (e) {}
}
function newSession() {
clearTimeout(thinkT); thinkT = null;
st = newState();
st.started = true;
hideOverlay();
hideIntro();   // #321 收掉开场全屏教学，别挡着拍品
hideHelp();   // #321 收掉详细玩法
openLot();
}
function openLot() {
st.phase = 'bidding';
hideOverlay();   // #343 上一件的结果浮层必须收掉——原先漏收，「下一件」后新拍品被结果层盖住点不了
if (endBtn) endBtn.hidden = true;
const r = Math.random();
st.mode = r < 0.25 ? 'eager' : r < 0.6 ? 'normal' : r < 0.85 ? 'stingy' : 'bluff';
const item = st.lots[st.idx];
st.cur = item.base;
st.leader = 'none';
let factor = TA_MODES[st.mode].factor;
st.lucky = (typeof window.arcadeMult === 'function') && window.arcadeMult('auction') === 2;
if (st.lucky) factor *= 0.8;   // #301 幸运拍卖：TA 今天手松，价位打八折
st.limit = Math.max(100, Math.round(item.base * factor / 10) * 10);
renderLot();
if (st.lucky) {
if (typeof window.arcadeMarkLuckyPlayed === 'function') window.arcadeMarkLuckyPlayed('auction');
setStatus('🍀 今日幸运拍卖：' + T('TA') + '今天手松——' + TA_MODES[st.mode].talk + '，你来出价');
} else {
setStatus('槌起！' + T('TA') + TA_MODES[st.mode].talk + '——你来出价');
}
}
function myBid(step) {
if (!lotActive()) return;
placeBid(st.cur + step);
}
function placeBid(newCur) {
if (!lotActive()) return;
const bal = myBalance();
if (!walletOk() || bal < newCur) { setStatus('心意币不够这个价——去心意集市补点吧'); updateBidBtns(); return; }
st.cur = newCur;
st.leader = 'you';
sfxBid();
renderLot();
scheduleTaThink('TA低头想了想……');
}
function customBidModal() {
if (!lotActive() || !walletOk() || typeof window.openModal !== 'function') return;
const minFen = st.cur + STEP1;
const ctl = window.openModal('自定义出价', String(minFen / 100), function (v) {
const fen = Math.round(parseFloat(String(v).replace(/[^\d.]/g, '')) * 100);
if (!fen || fen < minFen) { ctl.stay(); ctl.text(''); ctl.ph('至少要比当前价多 ¥1（≥' + yuanC(minFen) + '）'); return; }
placeBid(fen);
}, { inputmode: 'decimal', placeholder: '直接压上这个价（≥' + yuanC(minFen) + '）' });
try { if (ctl) ctl.okText('压价'); } catch (e) {}
}
function myPass() {
if (!lotActive()) return;
if (st.leader === 'you') {
const price = st.cur;
const item = st.lots[st.idx];
try {
if (typeof window.openModal === 'function') {
const ctl = window.openModal('确认落槌', '', function () { hammer(); }, {
noInput: true,
staticText: '以 ' + yuanC(price) + ' 拍下「' + item.ico + ' ' + esc(item.name) + '」？心意币将真实扣减，落槌不可撤回。'
});
try { if (ctl && ctl.okText) ctl.okText('落槌成交'); } catch (e2) {}
return;
}
} catch (e2) {}
hammer();
return;
}
if (st.limit >= st.cur) { taTake(); return; }
passLot();
}
function scheduleTaThink(line) {
clearTimeout(thinkT);
setStatus(T(line));
updateBidBtns();
thinkT = setTimeout(taThink, Math.round((TALK_MIN + Math.random() * TALK_VAR) * fastMul()));
}
function taThink() {
clearTimeout(thinkT); thinkT = null;
if (!st || !st.started || st.over || st.phase !== 'bidding') return;
const m = TA_MODES[st.mode];
if (st.mode === 'bluff' && st.cur >= st.limit && Math.random() < 0.35) { taFold(); return; }
if (st.cur < st.limit) {
let step = pick(m.stepPref) || STEP1;
let bid = st.cur + step;
if (st.mode !== 'eager' && bid > st.limit) bid = st.limit;
st.cur = Math.max(bid, st.cur + STEP1);
st.leader = 'ta';
sfxBid();
renderLot();
taSay(pick(m.calls));
setStatus(T('TA') + '举牌：' + yuan(st.cur) + '——到你出价了');
updateBidBtns();
} else {
if (st.mode === 'bluff') taSay(pick(['好吧，被你看穿了', '其实……也就那样']));
taFold();
}
}
function taFold() {
if (st.leader === 'you') { hammer('you'); return; }
passLot();
}
function taTake() {
st.phase = 'done';
clearTimeout(thinkT); thinkT = null;
st.taWins++;
sfxLose();
const s = loadStats();
s.taWins = (s.taWins || 0) + 1;
saveStats(s);
const item = st.lots[st.idx];
sfxHammer();
buzz(80);                 // #348 被抢走震动
recordHistory(item, st.cur, 'ta');
try {
const pend = loadPending();
pend.push({ ico: item.ico, img: item.img || '', name: item.name, due: Date.now() + (2 + Math.floor(Math.random() * 3)) * 86400000 });
savePending(pend);
} catch (e) {}
const rt = rarityOf(item);
showOverlay(T('TA') + '拍得了',
'<div class="au-ov-ico">' + item.ico + '</div>' +
'<div class="pong-end-stat"><span class="au-rare ' + rt.cls + '">' + rt.label + '</span> ' + esc(item.name) + ' · ' + yuan(st.cur) + ' 归 ' + esc(T('TA')) + '</div>' +
'<div class="pong-end-stat">📬 不过 TA 拍走的拍品，过几天会寄回给你</div>',
st.idx + 1 < st.lots.length ? '下一件' : '结算', 'ta');
setStatus(esc(T('TA')) + '把「' + esc(item.name) + '」抱走了');
try {
const fb = ['这件归我啦。', '嘿嘿，到手。', '眼光不错吧。'];
const pool = window.getInteractPool ? window.getInteractPool('游戏胜利·回应', fb) : fb;
const say = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''; // #1515 整组停用＝静默（TA 抱走）
const cid1 = prefix();
if (say) setTimeout(() => {
if (prefix() !== cid1) return;
try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
}, 800);
} catch (e) {}
nextLotBtn();
}
function passLot() {
st.phase = 'done';
clearTimeout(thinkT); thinkT = null;
st.passed++;
const item = st.lots[st.idx];
recordHistory(item, st.cur, 'pass');
showOverlay('流拍了',
'<div class="au-ov-ico">' + item.ico + '</div>' +
'<div class="pong-end-stat">' + esc(item.name) + ' 没人要，收回仓库</div>',
st.idx + 1 < st.lots.length ? '下一件' : '结算', 'pass');
setStatus('「' + esc(item.name) + '」流拍了');
try {
const fb = ['这玩意没人要啊。', '亏本了亏本了。'];
const pool = window.getInteractPool ? window.getInteractPool('游戏平局·回应', fb) : fb;
const say = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''; // #1515 整组停用＝静默（流拍）
const cid2 = prefix();
if (say) setTimeout(() => {
if (prefix() !== cid2) return;
try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
}, 800);
} catch (e) {}
nextLotBtn();
}
function hammer() {
if (!st || st.phase !== 'bidding') return;   // FIX 2026-09-16：确认弹窗期间 TA 可能已折价落槌，防二次扣款
st.phase = 'done';
clearTimeout(thinkT); thinkT = null;
const item = st.lots[st.idx];
if (!walletDeduct(st.cur)) {
showOverlay('扣款失败', '<div class="pong-end-stat">心意币余额不够了，这件不算了</div>', st.idx + 1 < st.lots.length ? '下一件' : '结算');
nextLotBtn();
return;
}
st.myWins++;
st.spent += st.cur;
const s = loadStats();
s.myWins = (s.myWins || 0) + 1;
s.spentFen = (s.spentFen || 0) + st.cur;
const bag = loadBag();
bag.push({ ico: item.ico, img: item.img || '', name: item.name, fen: st.cur, ts: Date.now(), rarity: rarityOf(item).label });
if (!persist(bagKey(), bag) || !persist(statsKey(), s)) {
walletDeduct(-st.cur);
st.myWins--; st.spent -= st.cur;
showOverlay('存储失败', '<div class="pong-end-stat">本地存储暂时不可用，这件没拍成，心意币已退回</div>', st.idx + 1 < st.lots.length ? '下一件' : '结算');
nextLotBtn();
return;
}
sfxWin(); sfxHammer();
buzz([30, 40, 80]);       // #348 落槌成交震动
recordHistory(item, st.cur, 'you');
taSay(pick(['被你拍走了…', '亏了亏了', '那件我本来想要来着']));
if (balanceEl) balanceEl.textContent = walletOk() ? '心意币 ' + yuan(myBalance()) : '心意币 —';
const rt = rarityOf(item);
showOverlay('落槌！',
'<div class="au-ov-ico">' + item.ico + '</div>' +
'<div class="pong-end-stat"><span class="au-rare ' + rt.cls + '">' + rt.label + '</span> ' + esc(item.name) + ' · ' + yuan(st.cur) + ' 拍下</div>' +
'<div class="pong-end-stat">💌 ' + esc(item.wish) + '</div>' +
'<div class="pong-end-stat">已收进 🎒 小收藏（剩 ' + yuan(myBalance()) + '）· 可在 🎒 里转赠给 ' + esc(T('TA')) + '</div>',
st.idx + 1 < st.lots.length ? '下一件' : '结算', 'win');
setStatus('「' + esc(item.name) + '」是你的了，花了 ' + yuan(st.cur));
try {
const fb = ['被你拍走了…', '亏了亏了。', '那件本来我想要来着。'];
const pool = window.getInteractPool ? window.getInteractPool('游戏失败·回应', fb) : fb;
const say = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''; // #1515 整组停用＝静默（被拍走）
const cid0 = prefix();
if (say) setTimeout(() => {
if (prefix() !== cid0) return;
try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {}
}, 800);
} catch (e) {}
try {
const auDrop = (typeof window.arcadeTryDrop === 'function') ? window.arcadeTryDrop('auction') : null;
if (auDrop) taSay('还掉了「' + auDrop.name + '」！游乐室图鉴 +1');
} catch (e) {}
nextLotBtn();
}
function nextLotBtn() {
if (startBtn) startBtn.textContent = st.idx + 1 < st.lots.length ? '下一件' : '结算';
if (endBtn) endBtn.hidden = false;
}
function advance() {
if (!st) return;
if (st.idx + 1 < st.lots.length) {
st.idx++;
openLot();
} else {
endSession();
}
}
function endSession() {
st.over = true;
st.phase = 'idle';
const s = loadStats();
s.sessions = (s.sessions || 0) + 1;
saveStats(s);
showSummary();
try {
let txt = T('心意币拍卖会') + ' · ';
if (st.myWins) txt += '拍下 ' + st.myWins + ' 件 ' + yuan(st.spent);
else txt += '空手而归';
if (st.taWins) txt += ' · ' + T('TA') + ' 拍走 ' + st.taWins + ' 件';
const auRes = st.myWins >= st.taWins ? (st.myWins ? '拍下 ' + st.myWins + ' 件！' : '谁也没拍到') : '{ta} 拍走 ' + st.taWins + ' 件';
if (window.chatAddSystem) window.chatAddSystem(txt, { special: 'auction', game: {
name: '心意币拍卖会',
outcome: st.myWins > st.taWins ? 'win' : st.taWins > st.myWins ? 'lose' : 'draw',
result: auRes,
stats: ['我拍下 ' + st.myWins + ' 件 · 花了 ' + yuan(st.spent), '{ta} 拍走 ' + st.taWins + ' 件', '本场 ' + st.lots.length + ' 件拍品 · 累计 ' + s.sessions + ' 场']
} });
} catch (e) {}
}
function showSummary() {
const s = loadStats();
showOverlay('本场结束',
'<div class="pong-end-stat">你拍得 ' + st.myWins + ' 件 · 花了 ' + yuan(st.spent) + '</div>' +
'<div class="pong-end-stat">' + T('TA') + ' 拍走 ' + st.taWins + ' 件 · 流拍 ' + st.passed + ' 件</div>' +
'<div class="pong-end-stat">累计 ' + s.sessions + ' 场 · 🎒 收藏 ' + loadBag().length + ' 件</div>',
'再来一场');
if (startBtn) startBtn.textContent = '再来一场';
if (endBtn) endBtn.hidden = false;
setStatus('本场结束，点击「再来一场」');
}
function bagRarity(it) {
if (it.rarity) return { label: it.rarity, cls: it.rarity === 'SSR' ? 'au-r2' : it.rarity === '稀有' ? 'au-r1' : 'au-r0' };
let src = null;
try { src = POOL.concat(loadCustom()).find((c) => c.name === it.name) || null; } catch (e) {}
const r = rarityOf(src || { base: it.fen || 0 });
return { label: r.label, cls: r.cls };
}
function bagDate(ts) { try { const d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; } catch (e) { return ''; } }
function showBag() {
bagOpen = true;
const bag = loadBag();
let body;
if (!bag.length) {
body = '<div class="au-bag-empty">' +
'<div class="au-bag-empty-ico">🎒</div>' +
'<div class="au-bag-empty-t">还什么都没拍到</div>' +
'<div class="au-bag-empty-s">开一场拍卖会，把第一件宝贝抱回来</div>' +
'<button class="pong-overlay-btn au-bag-empty-btn" type="button">开始拍卖</button></div>';
} else {
const s = loadStats();
let taCnt = 0;
bag.forEach((it) => { if (it.from === 'ta') taCnt++; });
const stat = '共 <b>' + bag.length + '</b> 件 · 累计花费 <b>' + yuan(s.spentFen || 0) + '</b>' +
(taCnt ? ' · ' + esc(T('TA')) + ' 寄回 <b>' + taCnt + '</b> 件' : '');
body = '<div class="au-bag-stat">' + stat + '</div><div class="au-bag-grid">' +
bag.map((it, i) => {
const rt = bagRarity(it);
const frame = rt.cls === 'au-r2' ? ' au-bag-ssr' : rt.cls === 'au-r1' ? ' au-bag-rare' : '';
const foot = it.from === 'ta'
? '<div class="au-bag-meta au-bag-from-ta">📬 ' + esc(T('TA')) + ' 寄来的</div>'
: '<div class="au-bag-meta">' + yuan(it.fen) + ' 拍下 · ' + bagDate(it.ts) + '</div>' +
'<button class="pong-overlay-btn au-send-btn au-bag-send" data-i="' + i + '" type="button">送' + esc(T('TA')) + '</button>';
return '<div class="au-bag-card' + frame + '">' +
'<span class="au-rare ' + rt.cls + ' au-bag-badge">' + rt.label + '</span>' +
'<div class="au-bag-tile">' + (auSafeImg(it.img) ? '<img class="au-bag-img" src="' + auSafeImg(it.img) + '" alt="">' : it.ico) + '</div>' +
'<div class="au-bag-name">' + esc(it.name) + '</div>' + foot + '</div>';
}).join('') + '</div>';
}
showOverlay('🎒 拍品收藏（' + bag.length + '）', body, '返回', '', true);
if (startBtn) startBtn.textContent = '返回'; // #346 统一返回语义：场次中回竞价、结算后回本场汇总
if (endBtn) endBtn.hidden = !(st && st.started && !st.over);
}
function showHistory() {
const h = loadHistory();
const fmt = (t) => { const d = new Date(t); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
const whoTxt = { you: '你拍得', ta: T('TA') + '拍走', pass: '流拍' };
const cls = (r) => r === 'SSR' ? 'au-r2' : r === '稀有' ? 'au-r1' : 'au-r0';
const body = h.length
? h.map((it) => '<div class="pong-end-stat au-hist-row"><span class="au-rare ' + cls(it.rarity) + '">' + (it.rarity || '普通') + '</span> ' + (auSafeImg(it.img) ? '<img class="au-hist-img" src="' + auSafeImg(it.img) + '" alt="">' : it.ico) + ' ' + esc(it.name) + ' · ' + (it.who === 'pass' ? '流拍' : yuan(it.price)) + ' · ' + (whoTxt[it.who] || '') + ' · ' + fmt(it.t) + '</div>').join('')
: '<div class="pong-end-stat">还没拍过任何东西</div>';
showOverlay('📜 拍卖记录（' + h.length + '）', body, '返回', '', true);
if (startBtn) startBtn.textContent = '返回';
if (endBtn) endBtn.hidden = !(st && st.started && !st.over);
}
const ED_ICOS = ['🎁', '💎', '🧸', '🌈', '🏮', '⭐', '🎧', '🎀', '🧿', '🌙', '✈️', '🎫', '🍰', '🕯️', '🎮', '⚽', '🎨', '🍫', '🧶', '🔮', '🍵', '🪁', '🐚', '🌻'];
const edEl = document.getElementById('au-editor');
const edTitleEl = document.getElementById('au-ed-title');
const edPreviewEl = document.getElementById('au-ed-preview');
const edGridEl = document.getElementById('au-ed-grid');
const edImgPrevEl = document.getElementById('au-ed-imgprev');
const edImgBtn = document.getElementById('au-ed-imgbtn');
const edImgClearBtn = document.getElementById('au-ed-imgclear');
const edNameEl = document.getElementById('au-ed-name');
const edDescEl = document.getElementById('au-ed-desc');
const edBaseEl = document.getElementById('au-ed-base');
const edWishEl = document.getElementById('au-ed-wish');
const edMysteryEl = document.getElementById('au-ed-mystery');
const edHintEl = document.getElementById('au-ed-hint');
const edLibEl = document.getElementById('au-ed-lib');
const edDelBtn = document.getElementById('au-ed-del');
const edCancelBtn = document.getElementById('au-ed-cancel');
const edSaveBtn = document.getElementById('au-ed-save');
const edCloseBtn = document.getElementById('au-ed-close');
let ed = null; // { idx:null|number, ico, img, mysteryOn }——文本字段以 DOM 为准，这里只存非文本态
function auSafeImg(s) {
return typeof s === 'string' && s.length <= 1200000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(s) ? s : '';
}
function compressAuImg(src) {
if (!window.mochiImgCompressTo) return Promise.resolve(null);
return window.mochiImgCompressTo(src, { maxSide: 480, quality: 0.85, mime: 'image/jpeg', opaque: true, tag: 'au-img' });
}
function edHint(msg) {
if (!edHintEl) return;
edHintEl.textContent = msg || '';
edHintEl.hidden = !msg;
}
function edVal(el) { return el ? String(el.value || '').trim() : ''; }
function edPreviewHtml() {
const name = edVal(edNameEl) || '拍品名称';
const desc = edVal(edDescEl) || '我们自己才懂的小玩意';
const yuanV = parseFloat(edVal(edBaseEl).replace(/[^\d.]/g, ''));
const img = ed && auSafeImg(ed.img);
const face = !ed ? '🎁' : ed.mysteryOn ? '🎁' : img ? '<img class="au-ed-pimg" src="' + img + '" alt="">' : ed.ico;
return '<div class="au-ed-pface">' + face + '</div>' +
'<div class="au-ed-pinfo"><div class="au-ed-pname">' + esc(ed && ed.mysteryOn ? '神秘拍品' : name) + '</div>' +
'<div class="au-ed-pdesc">' + esc(desc) + '</div>' +
'<div class="au-ed-pbase">起拍 ' + (yuanV > 0 ? '¥' + yuanV : '—') + '</div></div>';
}
function renderEdPreview() { if (edPreviewEl) edPreviewEl.innerHTML = edPreviewHtml(); }
function renderEdGrid() {
if (!edGridEl || !ed) return;
const imgOn = !!auSafeImg(ed.img);
edGridEl.innerHTML = ED_ICOS.map((e) => '<button type="button" class="au-ed-ico' + (e === ed.ico && !imgOn ? ' on' : '') + '" data-ico="' + e + '">' + e + '</button>').join('');
}
function renderEdImg() {
if (!edImgPrevEl || !ed) return;
const img = auSafeImg(ed.img);
edImgPrevEl.innerHTML = img ? '<img src="' + img + '" alt="">' : '🖼️';
if (edImgBtn) edImgBtn.textContent = img ? '换一张' : '上传图片';
if (edImgClearBtn) edImgClearBtn.hidden = !img;
}
function renderEdLib() {
if (!edLibEl) return;
const a = loadCustom();
if (!a.length) { edLibEl.innerHTML = ''; return; }
edLibEl.innerHTML = '<div class="au-ed-lib-t">已有 ' + a.length + '/20 · 点选即改</div>' +
a.map((c, i) => {
const img = auSafeImg(c.img);
return '<button type="button" class="au-ed-chip' + (ed && ed.idx === i ? ' on' : '') + '" data-i="' + i + '">' +
(img ? '<img src="' + img + '" alt="">' : esc(c.ico || '🎁')) + esc(c.name) + '</button>';
}).join('');
}
function openEditor(idx) {
if (!edEl) return;
const a = loadCustom();
if (idx != null && !a[idx]) idx = null;
const c = idx == null ? null : a[idx];
ed = { idx: idx, ico: c ? (c.ico || '🎁') : ED_ICOS[0], img: c ? auSafeImg(c.img) : '', mysteryOn: c ? !!c.mystery : false };
if (edTitleEl) edTitleEl.textContent = c ? '✏️ 编辑「' + c.name + '」' : '✏️ 自制新拍品';
if (edNameEl) edNameEl.value = c ? c.name : '';
if (edDescEl) edDescEl.value = c ? (c.desc || '') : '';
if (edBaseEl) edBaseEl.value = c ? String(c.base / 100) : '';
if (edWishEl) edWishEl.value = c ? (c.wish || '') : '';
if (edMysteryEl) edMysteryEl.checked = !!c && !!c.mystery;
if (edDelBtn) edDelBtn.hidden = idx == null;
edHint('');
renderEdGrid(); renderEdImg(); renderEdLib(); renderEdPreview();
edEl.hidden = false;
}
function closeEditor() { ed = null; if (edEl) edEl.hidden = true; }
function edSave() {
if (!ed) return;
const name = edVal(edNameEl);
if (!name) { edHint('先给拍品起个名称'); return; }
const yuanV = parseFloat(edVal(edBaseEl).replace(/[^\d.]/g, ''));
if (!yuanV || yuanV <= 0) { edHint('底价要大于 0（例：20 或 9.9）'); return; }
const a = loadCustom();
if (a.some((c, i) => i !== ed.idx && c.name === name)) { edHint('已有同名拍品，换个名称（想改它就点下面的库条）'); return; }
if (ed.idx == null && a.length >= 20) { edHint('自制拍品已满 20 个，先删一个再加'); return; }
const item = {
ico: ed.ico, img: auSafeImg(ed.img), name: name,
desc: edVal(edDescEl) || '我们自己才懂的小玩意',
base: Math.max(100, Math.round(yuanV * 100)),
wish: edVal(edWishEl) || '是心意呀。',
mystery: edMysteryEl && edMysteryEl.checked ? 1 : 0
};
if (ed.idx == null) a.push(item); else a[ed.idx] = item;
if (!saveCustom(a)) { edHint('本地存储写不进去（图片太大？），移除图片或少留几件再试'); return; }
taSay(ed.idx == null ? pick(['又上新拍品啦？', '你出的题我接了']) : pick(['这件还改了配方？更期待了']));
closeEditor();
}
function edDelete() {
if (!ed || ed.idx == null) return;
if (typeof window.openModal !== 'function') { closeEditor(); return; }
const a = loadCustom();
const name = a[ed.idx] ? a[ed.idx].name : '';
const target = ed.idx;
const delCtl = window.openModal('删除自制拍品', '', function () {
const cur = loadCustom();
cur.splice(target, 1);
saveCustom(cur);
taSay(pick(['这件……不拍了？', '行吧，收回仓库']));
closeEditor();
}, { staticText: '「' + name + '」将从自制库移除（已拍进 🎒 的不受影响）', noInput: true });
if (delCtl && delCtl.okText) delCtl.okText('删除');
}
if (edGridEl) edGridEl.addEventListener('click', (e) => {
const b = e.target.closest('.au-ed-ico');
if (!b || !ed) return;
e.stopPropagation();
ed.ico = b.getAttribute('data-ico') || '🎁';
ed.img = ''; // 选 emoji 即弃图（图片盖过 emoji，留残图会所见非所得）
renderEdGrid(); renderEdImg(); renderEdPreview();
});
if (edLibEl) edLibEl.addEventListener('click', (e) => {
const b = e.target.closest('.au-ed-chip');
if (!b) return;
e.stopPropagation();
openEditor(parseInt(b.getAttribute('data-i'), 10) || 0);
});
if (edImgClearBtn) edImgClearBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (!ed) return;
ed.img = '';
renderEdImg(); renderEdGrid(); renderEdPreview();
});
if (edImgBtn && typeof window.mochiFilePickSurface === 'function') {
window.mochiFilePickSurface(edImgBtn, {
id: 'au-ed-img-surf', accept: 'image/*', entry: 'au-ed-img',
onFiles: function (files) {
const f = files && files[0];
if (!f || !/^image\//i.test(f.type || '')) return;
if (!window.mochiImgCompressTo) { edHint('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return; }
compressAuImg(f).then(function (data) {
if (!data) { edHint('这张图本机浏览器处理不了，换一张小图试试'); return; }
if (!ed) return;
ed.img = data;
renderEdImg(); renderEdGrid(); renderEdPreview();
});
}
});
} else if (edImgBtn) {
edImgBtn.addEventListener('click', () => edHint('这台浏览器暂不支持在这里选图，先选个 emoji'));
}
[edNameEl, edDescEl, edBaseEl].forEach((el) => { if (el) el.addEventListener('input', renderEdPreview); });
if (edMysteryEl) edMysteryEl.addEventListener('change', () => { if (ed) ed.mysteryOn = edMysteryEl.checked; renderEdPreview(); });
if (edSaveBtn) edSaveBtn.addEventListener('click', (e) => { e.stopPropagation(); edSave(); });
if (edDelBtn) edDelBtn.addEventListener('click', (e) => { e.stopPropagation(); edDelete(); });
if (edCancelBtn) edCancelBtn.addEventListener('click', (e) => { e.stopPropagation(); closeEditor(); });
if (edCloseBtn) edCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeEditor(); });
function giftAway(i) {
const bag = loadBag();
const it = bag[i];
if (!it) return;
const wish = '拍卖会上抢到的，转送给你';
try {
if (typeof window.recordGiftBox === 'function') {
window.recordGiftBox({ id: 'au_' + Date.now(), giftId: '', name: it.name, emoji: it.ico, img: auSafeImg(it.img), price: it.fen / 100, cat: '拍卖会', wish: wish }, 'out', wish);
}
} catch (e) {}
bag.splice(i, 1);
saveBag(bag);
sfxHammer();
taSay(pick(['送给我的？！', '谢谢，我很喜欢！', '怎么突然对我这么好']));
try {
if (window.chatAddSystem) window.chatAddSystem(T('心意币拍卖会') + ' · 转赠 ' + T('TA') + '「' + it.name + '」', { special: 'auction' });
} catch (e) {}
const cid3 = prefix();
setTimeout(() => {
if (prefix() !== cid3) return;
try { if (window.chatAddIn) window.chatAddIn(pick(['收下啦！超喜欢', '你也喜欢就好', '下次拍卖会我让给你一件']), { silent: true }); } catch (e) {}
}, 900);
showBag();
}
function showOverlay(title, body, btnText, mood, fs) {
if (!overlayEl) return;
if (ovTitleEl) ovTitleEl.innerHTML = title || '';
if (ovBodyEl) ovBodyEl.innerHTML = body || '';
if (startBtn && btnText) startBtn.textContent = btnText;
overlayEl.classList.remove('au-ov-win', 'au-ov-ta', 'au-ov-pass');
if (mood) overlayEl.classList.add('au-ov-' + mood);
overlayEl.classList.toggle('au-ov-fs', !!fs);
overlayEl.hidden = false;
updateBidBtns();
}
function showStartOverlay() {
const s = loadStats();
if (introStepsEl) {
introStepsEl.innerHTML =
'<b>怎么玩</b>：和 ' + T('TA') + ' 轮番举牌，抢 3 件宝贝，价高者得。<br>' +
'<b>① 看拍品</b>　每件有起拍价，先掂量值不值。<br>' +
'<b>② 出价</b>　点档位「出 ¥X」就是在当前价上加价、压上你的价。<br>' +
'<b>③ 轮替</b>　你出价后 ' + T('TA') + ' 掂量掂量，轮到你时按钮才亮。<br>' +
'<b>④ 成交</b>　你最高价点「落槌」→按现价买下（真扣心意币、进 🎒）；' + T('TA') + ' 最高价→放弃这件；都不要→流拍。<br>' +
'<b>⑤ 彩蛋</b>　' + T('TA') + ' 拍走的过几天寄回给你。';
}
const statsHtml =
(s.sessions > 0 ? '累计 ' + s.sessions + ' 场 · 你拍得 ' + s.myWins + ' 件 · 花了 ' + yuan(s.spentFen || 0) + '　' : '') +
'当前心意币 ' + (walletOk() ? yuan(myBalance()) : '—');
if (introStatEl) introStatEl.textContent = statsHtml;
showIntro();
hideOverlay(); // 半框覆盖层平时不显示（开场/成交才由流程显示）
setStatus('全屏读玩法：点下方「开始拍卖」，或「详细玩法」');
}
function hideOverlay() { if (overlayEl) { overlayEl.hidden = true; overlayEl.classList.remove('au-ov-fs'); } bagOpen = false; }
if (startBtn) startBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (overlayEl && !overlayEl.hidden) {
const t = startBtn.textContent || '';
if (t === '下一件' || t === '结算') { advance(); return; }
if (t === '返回') {
hideOverlay();
if (st && st.started && !st.over) {
renderLot();
setStatus(lotActive() && st.leader === 'you' && thinkT ? T('TA') + ' 正在掂量你的出价……' : '继续——到你出价了');
} else if (st && st.over) {
showSummary(); // #346 结算后开背包，「返回」= 回到本场结算汇总
} else {
showStartOverlay(); // 防御：无场次回开场教学
}
return;
}
}
newSession();
});
if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
let lpT = null, lpFired = false;
function bindBidBtn(btn, step) {
if (!btn) return;
const start = () => { lpFired = false; clearTimeout(lpT); lpT = setTimeout(() => { lpFired = true; customBidModal(); }, 600); };
const cancel = () => { clearTimeout(lpT); };
btn.addEventListener('touchstart', start, { passive: true });
btn.addEventListener('mousedown', start);
['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach((ev) => btn.addEventListener(ev, cancel));
btn.addEventListener('click', (e) => { e.stopPropagation(); if (lpFired) { lpFired = false; return; } myBid(step); });
}
bindBidBtn(bid1Btn, STEP1);
bindBidBtn(bid5Btn, STEP5);
bindBidBtn(bid13Btn, STEP13);
if (passBtn) passBtn.addEventListener('click', (e) => { e.stopPropagation(); myPass(); });
if (bagBtn) bagBtn.addEventListener('click', (e) => { e.stopPropagation(); showBag(); });
if (historyBtn) historyBtn.addEventListener('click', (e) => { e.stopPropagation(); showHistory(); });
if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditor(null); });
if (ovBodyEl) ovBodyEl.addEventListener('click', (e) => {
if (e.target.closest('.au-bag-empty-btn')) { e.stopPropagation(); hideOverlay(); newSession(); return; }
const sendBtn = e.target.closest('.au-send-btn');
if (!sendBtn) return;
e.stopPropagation();
const i = parseInt(sendBtn.getAttribute('data-i'), 10) || 0;
const it = loadBag()[i];
if (!it) return;
try {
if (typeof window.openModal === 'function') {
const ctl = window.openModal('送出拍品', '', function () { giftAway(i); }, {
noInput: true,
staticText: '把「' + it.ico + ' ' + it.name + '」送给 ' + T('TA') + '？送出后不可撤回。'
});
try { if (ctl && ctl.okText) ctl.okText('送出'); } catch (e2) {}
return;
}
} catch (e2) {}
giftAway(i);
});
if (soundBtn) soundBtn.addEventListener('click', (e) => {
e.stopPropagation();
soundOn = !soundOn;
soundBtn.textContent = soundOn ? '🔊' : '🔇';
soundBtn.classList.toggle('pong-sound-off', !soundOn);
try { localStorage.setItem('xy-home-v2:au-sound', soundOn ? '1' : '0'); } catch (e2) {} // #346 偏好记忆
});
function setNames() {
let name = T('TA');
try {
const s = window.activeStore && window.activeStore();
name = (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || name;
} catch (e) {}
if (partnerNameEl) partnerNameEl.textContent = name;
}
window.openAuctionPanel = function () {
try { if (isFs) toggleFs(); } catch (e) {}
panel.hidden = false;
hideHelp();                                              // #321 重开默认收起玩法说明
if (soundBtn) { soundBtn.textContent = soundOn ? '🔊' : '🔇'; soundBtn.classList.toggle('pong-sound-off', !soundOn); } // #346 图标跟随持久化偏好
try { setNames(); } catch (e) {}
try { checkGifts(); } catch (e) {}   // #301 到期回寄投递
if (st && st.started && !st.over) {
if (st.phase === 'bidding') { renderLot(); if (!thinkT && st.leader === 'you') scheduleTaThink('TA低头想了想……'); else updateBidBtns(); }
return;
}
showStartOverlay();
setStatus('全屏读玩法：点「开始拍卖」或「详细玩法」');
};
function closePanel() {
clearTimeout(thinkT); thinkT = null;
clearInterval(giftTimer); giftTimer = null;
bagOpen = false;
hideIntro(); hideHelp();
closeEditor(); // #1041 编辑台也是面板内全屏层：关面板/切联系人（走 closePanel）必须一并收，防旧 idx 跨桌面残留
if (panel) panel.hidden = true;
}
window.closeAuctionPanel = closePanel;
(function watchGifts() {
const mo = new MutationObserver(() => {
if (panel.hidden) { clearInterval(giftTimer); giftTimer = null; return; }
if (!giftTimer) { try { checkGifts(); } catch (e) {} giftTimer = setInterval(() => { try { checkGifts(); } catch (e) {} }, 30000); }
});
mo.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
})();
setInterval(() => { try { checkGifts(); } catch (e) {} }, 600000);
(function restoreFromIdb() {
['auction-items', 'auction-history', 'au-gifts-pending', 'auction-custom'].forEach((k) => {
try {
const key = prefix() + ':' + k;
if (lsGet(key)) return;
if (typeof window.idbGet !== 'function') return;
Promise.resolve(window.idbGet(key)).then((v) => {
try {
if (v === undefined || v === null) return;
const s = typeof v === 'string' ? v : JSON.stringify(v);
if (!s) return;
const p = JSON.parse(s);
if (Array.isArray(p) && p.length) persist(key, s);
} catch (e) {}
}).catch(() => {});
} catch (e) {}
});
})();
document.addEventListener('contact-switched', () => { try { closePanel(); st = null; } catch (e) {} });
(function bindEntry() {
const btn = document.getElementById('more-auction');
if (!btn) return;
btn.addEventListener('click', (e) => {
e.stopPropagation();
const mp = document.getElementById('chat-more-panel');
if (mp) mp.hidden = true;
hideSiblingPanels('chat-auction-panel');
try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
try { openAuctionPanel(); } catch (err) {
try { panel.hidden = false; showStartOverlay(); setStatus('点击「开场拍卖」'); } catch (e2) {}
try { console.error('[auction] open failed', err); } catch (e2) {}
}
});
try {
if (window.MutationObserver) {
const SIBLING_IDS = siblingIds('chat-auction-panel');
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
function siblingIds(self) {
return ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-ms-panel', 'chat-fish-panel', 'chat-memory-panel', 'chat-gift-panel', 'chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-auction-panel', 'chat-arcade-panel', 'chat-more-panel'].filter((id) => id !== self);
}
function hideSiblingPanels(self) {
siblingIds(self).forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
}
window.__auDebug = {
st: () => st,
newSession: newSession,
myBid: myBid,
loadBag: loadBag,
poolSize: () => activePool().length,
loadCustom: loadCustom,
openEditor: openEditor,
ed: () => ed,
lastBuzz: null,
fast: false
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("auction.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("auction.js"); try { console.error("[JS] auction.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[auction.js] " + String(__e && __e.message || __e)); } })();
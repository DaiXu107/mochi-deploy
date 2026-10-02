(function () { try {
(function () {
const KEY = 'drift-data';
const page = document.getElementById('page-drift');
if (!page) return;
function S() { try { return window.activeStore(); } catch (e) { return null; } }
function pn() {
try { const s = S(); return (s && (s.get('lbl-partner') || s.get('cs-lbl-partner'))) || 'TA'; } catch (e) { return 'TA'; }
}
function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
function todayKey() { const t = new Date(); return t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate(); }
function fmtDay(ts) { const d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
function fmtTime(ts) { const d = new Date(ts); const h = d.getHours(), m = d.getMinutes(); return fmtDay(ts) + ' ' + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
let toastT = null;
function toast(t) {
let el = document.getElementById('cc-toast');
if (!el) { el = document.createElement('div'); el.id = 'cc-toast'; document.body.appendChild(el); }
el.textContent = t; el.className = 'cc-toast'; void el.offsetWidth; el.className = 'cc-toast show';
clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'cc-toast'; }, 2200);
}
function taFit(t) { let s = String(t == null ? '' : t).replace(/\{n\}/g, pn()); try { if (window.taFit) s = window.taFit(s); } catch (e) {} return s; }
function histMsgOk(m) {
if (!m || m.side !== 'in' || m.retracted) return false;
if (m.type && m.type !== 'text') return false;                  // 表情包/图片/语音/拍一拍等整条跳过
if (m.voice || m.img || m.gift) return false;
if (m.special || m.mailNotice) return false;                    // 系统提示 / 来信通知
if (m.askQuestion != null || m.askStatus != null || m.choiceQuestion != null || m.choiceStatus != null ||
m.curiousQuestion != null || m.curiousStatus != null || m.roastStatus != null ||
m.rpAmount != null || m.rpWish != null) return false;       // 提问/选择/好奇/吐槽/红包等互动组件
return true;
}
function candText(t) {
const s = String(t == null ? '' : t).trim();
if (!s || s.length > 100) return '';                            // 超长不装瓶（与放瓶输入上限一致）
if (s.indexOf('|||') >= 0) return '';                           // 语音卡标记
if (window.mochiMediaIsToken && window.mochiMediaIsToken(s)) return ''; // FIX 2026-09-13 #394 媒体池令牌卡不装瓶（存量乱码消息会成为候选）
if (/^(https?:|data:)/i.test(s)) return '';                     // 链接 / 内联图片
return s;
}
function histCandidates() {
try {
const cid = window.__activeCid || 'default';
const raw = localStorage.getItem('xy-home-v2:' + cid + ':chat-msgs');
if (!raw || raw.length > 600000) return [];                   // 超大记录守卫：直接回退字卡库
const arr = JSON.parse(raw);
if (!Array.isArray(arr)) return [];
const out = [];
const scan = Math.min(arr.length, 400);                       // 只看最近约 400 条，够回忆也不卡
for (let i = arr.length - 1; i >= arr.length - scan && out.length < 80; i--) {
const m = arr[i];
if (!histMsgOk(m)) continue;
if (Array.isArray(m.parts) && m.parts.length) {
for (let j = 0; j < m.parts.length && out.length < 80; j++) {
const p = m.parts[j];
if (!p || p.k !== 'text') continue;
const s = candText(p.v);
if (s) out.push(s);
}
} else {
const s = candText(m.text);
if (s) out.push(s);
}
}
return out;
} catch (e) { return []; }
}
function sampleHistLine() {
const cands = histCandidates();
if (!cands.length) return '';
const seen = Array.isArray(d.histSeen) ? d.histSeen : [];
let pool = cands.filter(c => seen.indexOf(c) < 0);              // 近期漂过的先避开，减少连重复
if (!pool.length) pool = cands.slice();
const t = rnd(pool);
d.histSeen = seen.concat([t]).slice(-8);
save();
return t;
}
function myHistMsgOk(m) {
if (!m || m.side !== 'out' || m.retracted) return false;
if (m.type && m.type !== 'text') return false;
if (m.voice || m.img || m.gift) return false;
if (m.special || m.mailNotice) return false;
if (m.askQuestion != null || m.askStatus != null || m.choiceQuestion != null || m.choiceStatus != null ||
m.curiousQuestion != null || m.curiousStatus != null || m.roastStatus != null ||
m.rpAmount != null || m.rpWish != null) return false;
return true;
}
function myHistCandidates() {
try {
const cid = window.__activeCid || 'default';
const raw = localStorage.getItem('xy-home-v2:' + cid + ':chat-msgs');
if (!raw || raw.length > 600000) return [];                   // 超大记录守卫
const arr = JSON.parse(raw);
if (!Array.isArray(arr)) return [];
const out = [];
const scan = Math.min(arr.length, 400);                       // 只看最近约 400 条
for (let i = arr.length - 1; i >= arr.length - scan && out.length < 80; i--) {
const m = arr[i];
if (!myHistMsgOk(m)) continue;
if (Array.isArray(m.parts) && m.parts.length) {
for (let j = 0; j < m.parts.length && out.length < 80; j++) {
const p = m.parts[j];
if (!p || p.k !== 'text') continue;
const s = candText(p.v);
if (s) out.push(s);
}
} else {
const s = candText(m.text);
if (s) out.push(s);
}
}
return out;
} catch (e) { return []; }
}
function mySampleLine() {
const cands = myHistCandidates();
if (!cands.length) return '';
const seen = Array.isArray(d.mySeen) ? d.mySeen : [];
let pool = cands.filter(c => seen.indexOf(c) < 0);              // 近期捡过的先避开
if (!pool.length) pool = cands.slice();
const t = rnd(pool);
d.mySeen = seen.concat([t]).slice(-8);
save();
return t;
}
const FB = {
ta: ['过来一点。', '我在。', '今天也陪着你。', '别急，慢慢来。'],
reply: ['看到了。', '好。等我。', '嗯，收到了。', '我也想你。这句是回礼。'],
sea: ['今天有没有好好休息？', '慢慢来，海不催任何人。', '你已经做得很好了。', '想见的人，总会再见的。']
};
function poolLine(group, fbKey, fit) {
try { if (window.dcfGet && !(Math.random() * 100 < window.dcfGet('drift'))) return ''; } catch (e) {}
let arr = null;
try { arr = window.getLibPool ? window.getLibPool('drift', group, FB[fbKey] || []) : null; } catch (e) {}
if (!arr || !arr.length) arr = FB[fbKey] || [];
else {
try { if (window.isDefaultCardOff) { const f = arr.filter(c => !window.isDefaultCardOff('drift', c)); if (f.length) arr = f; } } catch (e) {}
}
const t = String(rnd(arr));
return fit === false ? t : taFit(t);
}
const ITEMS = [
{ e: '🌸', n: '一朵花' }, { e: '🐚', n: '一个小贝壳' }, { e: '🪶', n: '一根软软的羽毛' },
{ e: '⭐', n: '一颗星星贴纸' }, { e: '🍬', n: '一颗没化掉的糖' }, { e: '🧸', n: '一只迷你小熊' }
];
const EMPTY_LINES = [
'瓶子里什么都没有，只有一点海的味道。',
'空瓶子。软木塞倒是雕了一朵小花。',
'只有一张被海水晕开的白纸。',
'瓶底躺着两粒沙，亮晶晶的。'
];
const ITEM_LINES = [
'瓶子里装着{g}，还有一张小纸条：「给捡到它的人。」',
'摇晃的声响很轻——里面是{g}。',
'{g}躺在瓶底，像特意留下的。'
];
const MINE_CAP = 50, GOT_CAP = 120, THEIRS_CAP = 60, PICK_CD = 20000;
function fresh() {
return {
mine: [], got: [], theirs: [], histSeen: [], mySeen: [], dry: 0,
day: { date: '', picks: 0, coin: 0, taGot: 0 },
lastVisit: 0, cdUntil: 0
};
}
let d = null;
function fix(o) {
if (!Array.isArray(o.mine)) o.mine = [];
if (!Array.isArray(o.got)) o.got = [];
if (!Array.isArray(o.theirs)) o.theirs = [];
if (!Array.isArray(o.histSeen)) o.histSeen = [];
if (!Array.isArray(o.mySeen)) o.mySeen = [];
if (typeof o.dry !== 'number' || o.dry < 0 || !isFinite(o.dry)) o.dry = 0;
if (!o.day || typeof o.day !== 'object') o.day = { date: '', picks: 0, coin: 0, taGot: 0 };
o.mine.forEach(m => { if (typeof m.fav !== 'number') m.fav = 0; });
o.got.forEach(g => { if (typeof g.fav !== 'number') g.fav = 0; });
o.theirs.forEach(g => { if (typeof g.fav !== 'number') g.fav = 0; });
if (!isFinite(o.lastVisit)) o.lastVisit = 0;
if (!isFinite(o.cdUntil)) o.cdUntil = 0;
if (o.mine.length > MINE_CAP) o.mine = o.mine.slice(-MINE_CAP);
if (o.got.length > GOT_CAP) o.got = o.got.slice(-GOT_CAP);
if (o.theirs.length > THEIRS_CAP) o.theirs = o.theirs.slice(-THEIRS_CAP);
}
function load() {
try {
const v = S().get(KEY);
if (v) { const o = JSON.parse(v); if (o && typeof o === 'object') { fix(o); return o; } }
} catch (e) {}
return fresh();
}
function save() {
try { S().set(KEY, JSON.stringify(d)); } catch (e) {}
try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + KEY, JSON.stringify(d)); } catch (e) {}
}
(function restoreIdb() {
try {
const s = S(); if (!s || !window.idbGet || s.get(KEY)) return;
const pf = window.activePrefix();
window.idbGet(pf + ':' + KEY).then(v => {
if (!v || window.activePrefix() !== pf || s.get(KEY)) return;
try {
const o = typeof v === 'string' ? JSON.parse(v) : v;
if (!o || typeof o !== 'object') return;
fix(o);
s.set(KEY, JSON.stringify(o));
const empty = !d || ((!d.mine.length && !d.got.length));
if (!booted || empty) { d = o; if (!page.hidden) renderAll(); }
} catch (e) {}
});
} catch (e) {}
})();
function addCoin(fen) {
if (!fen) return false;
ensureDaily();
if (d.day.coin >= DAILY_COIN_CAP) return false;
const real = Math.min(fen, DAILY_COIN_CAP - d.day.coin);
try {
if (typeof window.giftWalletChange !== 'function') return false;
window.giftWalletChange(real, real, '漂流瓶');
d.day.coin += real;
save();
return true;
} catch (e) { return false; }
}
const FIRST_PICK_COIN = 200, SPECIAL_COIN = 500, DAILY_COIN_CAP = 1000;
function outCountToday() {
try {
const cid = window.__activeCid || 'default';
const raw = localStorage.getItem('xy-home-v2:' + cid + ':chat-msgs');
if (!raw || raw.length > 400000) return 0;
const arr = JSON.parse(raw);
if (!Array.isArray(arr)) return 0;
const tk = todayKey();
let n = 0;
for (let i = arr.length - 1, seen = 0; i >= 0 && seen < 30; i--, seen++) {
const m = arr[i];
if (!m || !m.ts || m.side !== 'out') continue;
const t = new Date(m.ts);
if (tk === t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate()) n++;
}
return n;
} catch (e) { return 0; }
}
let _forceKind = '';
function rollKind() {
if (_forceKind) { const k = _forceKind; _forceKind = ''; return k; }
ensureDaily();
const absentH = d.lastVisit ? (Date.now() - d.lastVisit) / 3600000 : 999;
let taW;
if (absentH >= 48 && d.day.taGot < 1) {
taW = 26;
} else {
const n = outCountToday();
taW = n <= 0 ? 5 : (n <= 5 ? 7 : 9);
const dry = d.dry || 0;
if (dry >= 12) taW += Math.min(40, (dry - 11) * 8);
}
if (d.day.taGot >= 3) taW = 0;
const table = [['normal', Math.max(0, 60 + (5 - taW) - (taW >= 26 ? 16 : 0))], ['item', 25], ['special', 10], ['ta', taW]];
let total = 0; table.forEach(x => total += x[1]);
let r = Math.random() * total;
for (let i = 0; i < table.length; i++) { r -= table[i][1]; if (r < 0) return table[i][0]; }
return 'normal';
}
function settleSchedules() {
ensureDaily();
const now = Date.now();
d.mine.forEach(m => {
if (!m.backed && m.backAt && now >= m.backAt) {
if (Math.random() < 0.7) { m.backed = true; m.pendingBack = true; }
else { m.backAt = now + ri(24, 72) * 3600000; }
}
});
d.mine.forEach(m => {
if (m.willReply && !m.replied && m.replyAt && now >= m.replyAt) {
m.replied = now;
const _dl = poolLine('TA的回应', 'reply');
if (_dl) {
pushGot({ kind: 'reply', from: 'ta', text: _dl, relateId: m.id });
if (!m.noticed) {
m.noticed = true;
notifyChat('🌊 海上好像有什么漂回来了——去漂流瓶看看吧。');
}
}
}
});
}
function takePendingBack() {
for (let i = 0; i < d.mine.length; i++) {
const m = d.mine[i];
if (m.pendingBack) {
m.pendingBack = false; m.backedAt = Date.now(); m.gone = true;
return m;
}
}
return null;
}
function notifyChat(text) {
try { if (window.chatAddIn) window.chatAddIn(text, { tag: '漂流瓶' }); } catch (e) {}
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pushGot(rec) {
rec.id = rec.id || uid();
rec.ts = rec.ts || Date.now();
if (typeof rec.fav !== 'number') rec.fav = 0;
d.got.push(rec);
if (d.got.length > GOT_CAP) d.got = d.got.slice(-GOT_CAP);
save();
return rec;
}
function pushTheirs(rec) {
rec.id = rec.id || uid();
rec.ts = rec.ts || Date.now();
if (typeof rec.fav !== 'number') rec.fav = 0;
d.theirs.push(rec);
if (d.theirs.length > THEIRS_CAP) d.theirs = d.theirs.slice(-THEIRS_CAP);
save();
return rec;
}
const CONTACT_PICK_CHANCE = 0.25;
function maybeContactPick() {
if (Math.random() >= CONTACT_PICK_CHANCE) return null;
const line = mySampleLine();
if (!line) return null;
return pushTheirs({ text: line });
}
function pickBottle() {
if (Date.now() < (d.cdUntil || 0)) { toast('海面还没恢复平静，稍等一下'); return; }
settleSchedules();
ensureDaily();
const backMine = takePendingBack();
let head, note, sig = '', gift = null, kind;
let coinMsg = '';
if (backMine) {
kind = 'back';
head = '🕰 你在海边捡到一个熟悉的瓶子';
note = backMine.text;
sig = '这是你以前写下的话';
} else {
kind = rollKind();
if (kind === 'ta') {
d.dry = 0;                                        // 出了 TA 瓶，软保底计数清零
d.day.taGot++;
head = '💙 ' + pn() + '漂来的瓶子';
note = sampleHistLine() || poolLine('TA的话', 'ta') || rnd(FB.ta);
if (note) sig = '—— ' + pn();
if (Math.random() < 0.2) gift = rnd(ITEMS);
} else if (kind === 'special') {
head = '✨ 一个特别的瓶子';
note = poolLine('海风', 'sea') || rnd(FB.sea);
sig = '瓶身缠着小小的星星绳';
} else if (kind === 'item') {
gift = rnd(ITEMS);
head = '🫙 沉甸甸的小瓶子';
note = rnd(ITEM_LINES).replace(/\{g\}/g, gift.e + ' ' + gift.n);
} else if (kind === 'empty') {
head = '🫙 一只空瓶子';
note = rnd(EMPTY_LINES);
} else {
head = '🫙 你捡到了一个漂流瓶';
note = poolLine('海风', 'sea') || rnd(FB.sea);
}
}
const firstToday = d.day.picks === 0;
let coin = 0;
if (kind === 'special') coin = SPECIAL_COIN;
else if (firstToday) coin = FIRST_PICK_COIN;
if (coin && addCoin(coin)) coinMsg = coin === SPECIAL_COIN ? '🪙 +5 心意币' : '🪙 +2 心意币（今日首捡）';
d.day.picks++;
d.cdUntil = Date.now() + PICK_CD;
const rec = pushGot({ kind: kind, from: kind === 'ta' || kind === 'reply' ? 'ta' : 'sea', text: note, gift: gift ? gift.e + ' ' + gift.n : '', coinFen: coin });
const theirsRec = maybeContactPick();
save();
renderPickAnim(head, note, sig, gift, coinMsg, rec, theirsRec);
renderStats(); renderList();
tickCd();
}
function putBottle() {
if (!window.openModal) return;
window.openModal('写一句话，放进海里', '', function (val) {
const text = String(val == null ? '' : val).trim().slice(0, 100);
if (!text) { toast('空的瓶子漂不远，写点什么吧'); return; }
ensureDaily();
const rec = {
id: uid(), text: text, ts: Date.now(), fav: 0,
backAt: Date.now() + ri(36, 96) * 3600000,
willReply: d.mine.filter(m => m.willReply && !m.replied).length < 2 && Math.random() < 0.45,
replyAt: 0
};
if (rec.willReply) rec.replyAt = Date.now() + ri(6, 40) * 3600000;
d.mine.push(rec);
if (d.mine.length > MINE_CAP) d.mine = d.mine.slice(-MINE_CAP);
save();
vib(18);
toast('瓶子已经放进海里了 🌊');
renderStats(); renderList();
}, { textarea: true, textareaPlaceholder: '今天也很想你。（最多 100 字）', maxlength: 100 });
}
const $ = (id) => document.getElementById(id);
let openRecId = '';
function renderPickAnim(head, note, sig, gift, coinMsg, rec, theirs) {
const box = $('d-open');
if (!box) return;
openRecId = rec.id;
const bob = $('drift-bob');
if (bob) { bob.classList.remove('d-arrive'); void bob.offsetWidth; bob.classList.add('d-arrive'); }
setTimeout(() => {
if (!rec || rec.id !== openRecId) return;
const fav = rec.fav ? ' ♡已收藏' : ' ♡ 收藏';
const theirsHtml = theirs ?
'<div class="do-theirs"><div class="do-theirs-head"></div>' +
'<div class="do-theirs-txt"></div><div class="do-theirs-sig"></div></div>' : '';
box.innerHTML =
'<div class="do-head">' + taFit(head) + '</div>' +
'<div class="do-paper"><div class="do-txt"></div>' +
(sig ? '<div class="do-sig"></div>' : '') + '</div>' +
'<div class="do-extra">' +
(gift ? '<span class="do-gift">' + gift.e + ' ' + taFit(gift.n) + '</span>' : '') +
(coinMsg ? '<span class="do-coin">' + coinMsg + '</span>' : '') +
'</div>' +
theirsHtml +
'<div class="do-btns">' +
(kindCanFav(rec.kind) ? '<button class="do-fav" id="d-fav">' + (rec.fav ? '♥ 已收藏' : '♡ 收藏') + '</button>' : '') +
'<button class="do-ok" id="d-ok">收好</button>' +
'</div>';
box.querySelector('.do-txt').textContent = note;
const sigEl = box.querySelector('.do-sig');
if (sigEl) sigEl.textContent = sig;
if (theirs) {
box.querySelector('.do-theirs-head').textContent = '💌 ' + pn() + '也捡到一个瓶子';
box.querySelector('.do-theirs-txt').textContent = theirs.text;
box.querySelector('.do-theirs-sig').textContent = '—— 你在聊天里说过的话';
}
box.hidden = false;
box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
const favBtn = $('d-fav');
if (favBtn) favBtn.addEventListener('click', () => {
rec.fav = rec.fav ? 0 : 1;
save();
favBtn.textContent = rec.fav ? '♥ 已收藏' : '♡ 收藏';
toast(rec.fav ? '已收进收藏' : '已取消收藏');
renderStats(); renderList();
});
$('d-ok').addEventListener('click', () => { box.hidden = true; openRecId = ''; });
vib(12);
}, 850);
}
function kindCanFav(k) { return k !== 'empty'; }
function renderStats() {
const el = $('d-stats');
if (!el) return;
const taCnt = d.got.filter(g => g.from === 'ta').length;
const favCnt = d.got.filter(g => g.fav).length + d.mine.filter(m => m.fav).length + d.theirs.filter(t => t.fav).length;
el.textContent = '我放入 ' + d.mine.length + ' · ' + pn() + '漂来 ' + taCnt + ' · ' + pn() + '捡到 ' + d.theirs.length + ' · 收藏 ' + favCnt;
}
function renderList() {
const el = $('d-list');
if (!el) return;
const tab = curTab;
el.innerHTML = '';
let rows = [];
if (tab === 'mine') rows = d.mine.slice().reverse().map(m => ({
ts: m.ts, ico: m.replied ? '💙' : (m.backed ? '🕰' : '🌊'),
text: m.text,
sub: m.replied ? pn() + '回应了这个瓶子' : (m.backed ? '这个瓶子漂回来过' : '漂流中'),
key: 'm:' + m.id, rec: m, mine: true
}));
else if (tab === 'got') rows = d.got.slice().reverse().map(g => ({
ts: g.ts, ico: KIND_ICO[g.kind] || '🫙', text: g.text,
sub: (g.from === 'ta' ? '来自 ' + pn() : '海边') + (g.coinFen ? ' · 🪙+' + Math.round(g.coinFen / 100) : ''),
key: 'g:' + g.id, rec: g, mine: false
}));
else if (tab === 'theirs') rows = d.theirs.slice().reverse().map(t => ({
ts: t.ts, ico: '💌', text: t.text,
sub: pn() + '捡到的 · 你聊天里的话',
key: 't:' + t.id, rec: t, mine: false
}));
else rows = d.got.filter(g => g.fav).slice().reverse().map(g => ({
ts: g.ts, ico: KIND_ICO[g.kind] || '🫙', text: g.text,
sub: g.from === 'ta' ? '来自 ' + pn() : '海边',
key: 'gf:' + g.id, rec: g, mine: false
})).concat(d.theirs.filter(t => t.fav).slice().reverse().map(t => ({
ts: t.ts, ico: '💌', text: t.text, sub: pn() + '捡到的', key: 'tf:' + t.id, rec: t, mine: false
}))).concat(d.mine.filter(m => m.fav).slice().reverse().map(m => ({
ts: m.ts, ico: '🌊', text: m.text, sub: '我放入的', key: 'mf:' + m.id, rec: m, mine: true
}))).sort((a, b) => b.ts - a.ts);
if (!rows.length) {
if (window.mochiDataPending && window.mochiDataPending()) { el.innerHTML = window.mochiLoadingHtml('漂流瓶'); return; }
el.innerHTML = '<div class="dl-empty">' + (tab === 'mine' ? '还没有放过的瓶子。写一句话放进海里吧。<br><button class="memo-send-btn" id="dl-empty-put" style="margin-top:8px">写一句话放瓶子</button>' : tab === 'got' ? '还没有捡到的瓶子。去海边捡一个试试。' : tab === 'theirs' ? '还没有捡到过你说的话。多去捡几次，说不定就被 TA 捞起来了。' : '还没有收藏的瓶子。') + '</div>';
return;
}
rows.slice(0, 60).forEach(r => {
const row = document.createElement('div');
row.className = 'dl-row glass';
row.innerHTML =
'<span class="dl-ico">' + r.ico + '</span>' +
'<div class="dl-main"><div class="dl-txt"></div>' +
'<div class="dl-sub">' + fmtTime(r.ts) + ' · ' + taFit(r.sub) + '</div></div>' +
'<button class="dl-fav" title="收藏">' + (r.rec.fav ? '♥' : '♡') + '</button>';
row.querySelector('.dl-txt').textContent = r.text;
const fv = row.querySelector('.dl-fav');
fv.addEventListener('click', (e) => {
e.stopPropagation();
r.rec.fav = r.rec.fav ? 0 : 1;
save();
fv.textContent = r.rec.fav ? '♥' : '♡';
renderStats(); renderList();
});
el.appendChild(row);
});
}
const KIND_ICO = { normal: '🫙', empty: '🫙', item: '🎁', special: '✨', ta: '💙', back: '🕰', reply: '💙' };
function renderSea() {
const night = isNight();
page.classList.toggle('night', night);
const cap = $('drift-sea-cap');
if (cap) cap.textContent = night ? '夜里的海，把声音都藏起来了' : '两个世界之间的海';
}
function isNight() { const h = new Date().getHours(); return h >= 19 || h < 6; }
function renderAll() { renderSea(); renderStats(); renderList(); tickCd(); updateTheirsTab(); }
if (window.mochiOnDataReady) window.mochiOnDataReady(function () {
try {
if (page.hidden) return;
d = load();
renderStats(); renderList();
} catch (e) {}
});
function updateTheirsTab() {
const t = $('d-tab-theirs');
if (t) t.textContent = pn() + '捡到的漂流瓶';
}
function ensureDaily() {
const tk = todayKey();
if (d.day.date !== tk) d.day = { date: tk, picks: 0, coin: 0, taGot: 0 };
}
let cdTimer = null;
function tickCd() {
const btn = $('drift-pick');
if (!btn) return;
clearInterval(cdTimer);
const step = () => {
const left = (d.cdUntil || 0) - Date.now();
if (left > 0) {
btn.disabled = true;
btn.textContent = '海面恢复中… ' + Math.ceil(left / 1000) + 's';
} else {
btn.disabled = false;
btn.textContent = '捡一个';
clearInterval(cdTimer);
}
};
step();
cdTimer = setInterval(step, 500);
}
function infoModal() {
if (!window.openModal) return;
window.openModal('漂流瓶 · 关于这片海', '', function () {}, {
noInput: true,
staticText: '你写下的话会漂到两个世界之间：过几天它可能自己漂回来，也可能收到一句回应。\n\n有时候，也会捡到「' + pn() + '」漂来的瓶子——TA以前在聊天里说过的字卡，都可能单独漂回来；没有合适的话时，才从字卡库的漂流瓶分组里取一句。\n\n我捡瓶的时候，' + pn() + '偶尔也会从我在聊天里说过的话中捞起一句——它们会收进「' + pn() + '捡到的漂流瓶」分类里。\n\n每日首次捡瓶送 2 心意币，特殊瓶 +5（每天最多 10）。瓶子是偶尔的惊喜，不用一直守着海。'
});
}
function openDrift() {
d = load();
ensureDaily();
settleSchedules();
save();
document.querySelectorAll('.page').forEach(p => p.hidden = true);
page.hidden = false;
renderAll();
d.lastVisit = Date.now();
save();
}
function closeDrift(toChat) {
save();
page.hidden = true;
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const target = toChat ? document.getElementById('page-chat') : document.getElementById('page-phone');
if (target) target.hidden = false;
}
function boot() {
d = load();
const back = $('drift-back');
if (back) back.addEventListener('click', function (e) {
e.stopPropagation();
closeDrift(window.__driftFrom === 'chat');
window.__driftFrom = '';
});
const moreBtn = $('more-drift');
if (moreBtn) moreBtn.addEventListener('click', function (e) {
e.stopPropagation();
const mp = $('chat-more-panel');
if (mp) mp.hidden = true;
window.__driftFrom = 'chat';
openDrift();
});
const pick = $('drift-pick');
if (pick) pick.addEventListener('click', function (e) { e.stopPropagation(); pickBottle(); });
const put = $('d-put');
if (put) put.addEventListener('click', function (e) { e.stopPropagation(); putBottle(); });
const info = $('drift-info-btn');
if (info) info.addEventListener('click', function (e) { e.stopPropagation(); infoModal(); });
document.querySelectorAll('#page-drift .d-tab').forEach(tab => {
tab.addEventListener('click', function () {
document.querySelectorAll('#page-drift .d-tab').forEach(t => t.classList.remove('sel'));
tab.classList.add('sel');
curTab = tab.dataset.t || 'mine';
renderList();
});
});
document.addEventListener('contact-switched', function () {
d = load();
if (!page.hidden) { openRecId = ''; const ob = $('d-open'); if (ob) ob.hidden = true; renderAll(); }
});
document.addEventListener('visibilitychange', function () {
if (!document.hidden && !page.hidden) { settleSchedules(); save(); renderAll(); }
});
window.__driftNext = function (k) { _forceKind = k; };
window.__driftState = function () { return JSON.parse(JSON.stringify(d)); };
window.__driftPeek = function () { const f = _forceKind; _forceKind = ''; const k = rollKind(); _forceKind = f; return k; };
booted = true;
}
let booted = false;
let curTab = 'mine';
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("drift-bottle.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("drift-bottle.js"); try { console.error("[JS] drift-bottle.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[drift-bottle.js] " + String(__e && __e.message || __e)); } })();
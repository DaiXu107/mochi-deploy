(function () { try {
(function () {
const uid = window.activePrefix();
const store = window.activeStore();
const page = document.getElementById('page-calendar');
if (!page) return;
const MOODS = [
{ mood: '温柔', cat: '温暖', desc: '今天很温柔。' },
{ mood: '开心', cat: '温暖', desc: '今天心情很好。' },
{ mood: '愉快', cat: '温暖', desc: '今天过得很轻松。' },
{ mood: '满足', cat: '温暖', desc: '今天觉得很满足。' },
{ mood: '放松', cat: '温暖', desc: '今天慢慢放松着。' },
{ mood: '安心', cat: '温暖', desc: '今天很安心。' },
{ mood: '平静', cat: '平静', desc: '今天很平静。' },
{ mood: '安静', cat: '平静', desc: '今天想安静一点。' },
{ mood: '专注', cat: '平静', desc: '今天专注于眼前的事。' },
{ mood: '思考中', cat: '平静', desc: '今天一直在思考。' },
{ mood: '想念', cat: '想念', desc: '今天有些想你。' },
{ mood: '等待', cat: '想念', desc: '今天静静等着与你相遇。' },
{ mood: '期待', cat: '想念', desc: '今天期待着一点惊喜。' },
{ mood: '牵挂', cat: '想念', desc: '今天一直惦记着你。' },
{ mood: '疲惫', cat: '低落', desc: '今天有一点累。' },
{ mood: '孤单', cat: '低落', desc: '今天有些安静。' },
{ mood: '烦恼', cat: '低落', desc: '今天有些事情放不下。' },
{ mood: '精神很好', cat: '活跃', desc: '今天状态很好。' },
{ mood: '兴致高涨', cat: '活跃', desc: '今天充满热情。' },
{ mood: '充满动力', cat: '活跃', desc: '今天想做很多事情。' }
];
const ACTIVITIES = [
'看书', '整理书籍', '写东西', '记录想法', '工作中', '整理资料',
'回复消息', '听音乐', '戴着耳机发呆', '哼着歌', '喝茶', '泡茶中',
'喝点饮料', '吃点心', '吃饭中', '休息中', '小睡一会', '发呆',
'想事情', '思考中', '放空自己', '散步', '看风景', '晒太阳',
'吹吹风', '听雨声', '看夜空', '看照片', '放松中', '创作中',
'整理照片', '看视频', '看电影', '找点事情做', '整理东西', '安静待着',
'看着窗外', '等待中', '想着你', '回忆过去', '想靠近你', '陪着你',
'等你来聊天', '在线中', '忙碌中', '想给你一点惊喜', '静静待着', '在这里等你'
];
const MOOD_ICONS = {
'温暖': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>',
'平静': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
'想念': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
'低落': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
'活跃': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S4.5 15.2 4.5 9.9A4.9 4.9 0 0112 7.1a4.9 4.9 0 017.5 2.8c0 5.3-7.5 10.6-7.5 10.6z"/></svg>'
};
function todayStr() {
const d = new Date();
return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function calTextOnly(c) {
if (typeof c !== 'string' || !c) return false;
if (c.indexOf('data:') === 0) return false;
if (c.indexOf('|||') >= 0) return false;
if (c.indexOf('@@m:') >= 0) return false;
if (/^https?:\/\//i.test(c)) return false;
return true;
}
function calCleanMsg(s) {
if (typeof s !== 'string') return s;
return s.replace(/@@m:[0-9a-f]{32}/g, '[图片]').replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[图片]');
}
function genMessage() {
const cards = [];
const custom = (window.getCustomCards && window.getCustomCards()) || [];
const pokeSet = (function () {
try {
const pk = (window.getPokeCards && window.getPokeCards()) || [];
return pk.length ? new Set(pk) : null;
} catch (e) { return null; }
})();
custom.forEach(c => {
if (pokeSet && pokeSet.has(c)) return;
if (calTextOnly(c)) cards.push(c);
});
const defs = (window.getDefaultCardGroups && window.getDefaultCardGroups('main')) || [];
const dcfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
const catOn = window.defaultCardCat ? window.defaultCardCat('main') : true;
const isOff = window.isDefaultCardOff || null;
if (dcfg.enabled !== false && catOn) {
defs.forEach(([g, arr]) => { if (Array.isArray(arr)) arr.forEach(c => { if (isOff && isOff('main', c)) return; if (!calTextOnly(c)) return; cards.push(c); }); });
}
if (!cards.length) return '今天也想对你说点什么...';
const maxCount = Math.min(8, cards.length);
const minCount = Math.min(3, maxCount);
const count = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
const pool = cards.slice();
const sel = [];
for (let i = 0; i < count && pool.length; i++) {
const idx = Math.floor(Math.random() * pool.length);
sel.push(pool.splice(idx, 1)[0]);
}
return sel.join('  ');
}
function normDateStr(s) {
const p = String(s || '').split('-');
if (p.length !== 3) return null;
const y = +p[0], m = +p[1], d = +p[2];
if (!y || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function inferFirstUse() {
const cands = [];
try {
const pref = window.activePrefix() + ':';
const isDef = window.activePrefix() === 'xy-home-v2:default';
const re = /(\d{4}-\d{1,2}-\d{1,2})$/;
const ls = window.localStorage;
for (let i = 0; i < ls.length; i++) {
const k = ls.key(i) || '';
let tail = null;
if (k.indexOf(pref) === 0) tail = k.slice(pref.length);
else if (isDef && k.indexOf('xy-home-v2:') === 0) {
const rest = k.slice('xy-home-v2:'.length);
if (rest.indexOf(':') < 0) tail = rest; // 迁移前的旧顶层键（无第二段冒号）
}
if (!tail || /^cal-\d/.test(tail)) continue;
const m = re.exec(tail);
if (m) { const n = normDateStr(m[1]); if (n) cands.push(n); }
}
} catch (e) {}
try {
const ql = JSON.parse(store.get('quote-history') || '[]');
(Array.isArray(ql) ? ql : []).forEach(x => { if (x && x.date) { const n = normDateStr(x.date); if (n) cands.push(n); } });
} catch (e) {}
if (!cands.length) return null;
cands.sort();
return cands[0];
}
let _firstUse = null;
function firstUseDate() {
if (_firstUse) return _firstUse;
let saved = null;
try { saved = normDateStr(store.get('first-use-date') || ''); } catch (e) {}
const inferred = inferFirstUse();
_firstUse = (saved && inferred) ? (inferred < saved ? inferred : saved) : (saved || inferred || todayStr());
if (_firstUse > todayStr()) _firstUse = todayStr(); // 脏数据兜底：首用日不可能在未来
store.set('first-use-date', _firstUse);
try { if (window.idbSet) window.idbSet(window.activePrefix() + ':first-use-date', _firstUse); } catch (e) {}
return _firstUse;
}
let _cleanedOld = false;
function cleanPreFirstEntries() {
if (_cleanedOld) return;
_cleanedOld = true;
const fu = firstUseDate();
const re = /^cal-(\d{4}-\d{2}-\d{2})$/;
const tailOf = (k) => {
try {
const pref = window.activePrefix() + ':';
if (k.indexOf(pref) === 0) return k.slice(pref.length);
if (window.activePrefix() === 'xy-home-v2:default' && k.indexOf('xy-home-v2:') === 0) {
const rest = k.slice('xy-home-v2:'.length);
if (rest.indexOf(':') < 0) return rest;
}
} catch (e) {}
return null;
};
try {
const kill = [];
const ls = window.localStorage;
for (let i = 0; i < ls.length; i++) {
const tail = tailOf(ls.key(i) || '');
const m = tail ? re.exec(tail) : null;
if (m && m[1] < fu) kill.push(m[1]);
}
kill.forEach(ds => { try { store.remove('cal-' + ds); } catch (e) {} });
} catch (e) {}
try {
if (window.idbGetAllKeys && window.idbDelete) {
window.idbGetAllKeys().then(keys => {
(keys || []).forEach(k => {
if (typeof k !== 'string') return;
const tail = tailOf(k);
const m = tail ? re.exec(tail) : null;
if (m && m[1] < fu) { try { window.idbDelete(k); } catch (e) {} }
});
}).catch(() => {});
}
} catch (e) {}
}
function getDayEntry(dateStr) {
if (!dateStr) return null;
const p0 = dateStr.split('-');
const d0 = new Date(+p0[0], +p0[1] - 1, +p0[2]);
const n0 = new Date();
if (d0 > new Date(n0.getFullYear(), n0.getMonth(), n0.getDate())) {
try {
const k = 'cal-' + dateStr;
if (store.get(k)) store.remove(k);
if (window.idbDelete) window.idbDelete(window.activePrefix() + ':' + k);
} catch (e) {}
return null;
}
if (dateStr < firstUseDate()) {
try {
const kb = 'cal-' + dateStr;
if (store.get(kb)) store.remove(kb);
} catch (e) {}
return null;
}
const key = 'cal-' + dateStr;
let entry = null;
try { entry = JSON.parse(store.get(key) || 'null'); } catch (e) {}
if (!entry) {
const m = pick(MOODS);
entry = {
mood: m.mood, cat: m.cat, desc: m.desc,
activity: pick(ACTIVITIES),
message: genMessage(),
date: dateStr
};
store.set(key, JSON.stringify(entry));
try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + key, JSON.stringify(entry)); } catch (e) {}
}
return entry;
}
let calCache = null;
function getToday() {
const ds = todayStr();
if (calCache && calCache.date === ds) return calCache;
calCache = getDayEntry(ds);
return calCache;
}
window.calGetDayEntry = getDayEntry;
window.calGetMyMessage = function (ds) { return store.get('cal-my-' + ds) || ''; };
document.addEventListener('contact-switched', function () {
try { calCache = null; viewY = 0; viewM = -1; selDate = todayStr(); _firstUse = null; _cleanedOld = false; } catch (e) {}
});
let viewY = 0, viewM = -1; // 0=当前月
let selDate = todayStr();
function dayRecordSet(y, m) {
const set = new Set();
const daysInMonth = new Date(y, m + 1, 0).getDate();
for (let d = 1; d <= daysInMonth; d++) {
const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
if (store.get('cal-my-' + ds) || store.get('memo-' + ds) || store.get('today-mood-' + ds)) set.add(ds);
}
['memo-history', 'mood-history'].forEach((hk) => {
try {
JSON.parse(store.get(hk) || '[]').forEach((x) => {
if (!(x && x.ts && x.text)) return;
const dt = new Date(x.ts);
if (dt.getFullYear() === y && dt.getMonth() === m) {
set.add(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'));
}
});
} catch (e) {}
});
return set;
}
function renderGrid() {
const grid = document.getElementById('cal-grid');
if (!grid) return;
const now = new Date();
if (viewM < 0) { viewY = now.getFullYear(); viewM = now.getMonth(); }
const y = viewY, m = viewM;
const monthEl = document.getElementById('cal-month-txt');
if (monthEl) monthEl.textContent = y + ' 年 ' + (m + 1) + ' 月';
const first = new Date(y, m, 1);
const days = new Date(y, m + 1, 0).getDate();
const startWd = first.getDay();
const wds = ['日', '一', '二', '三', '四', '五', '六'];
let html = wds.map(w => '<span class="cal-wd">' + w + '</span>').join('');
for (let i = 0; i < startWd; i++) html += '<span class="cal-cell blank"></span>';
let recSet = null;
try { recSet = dayRecordSet(y, m); } catch (e) { recSet = new Set(); }
for (let d = 1; d <= days; d++) {
const isToday = d === now.getDate() && y === now.getFullYear() && m === now.getMonth();
const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
let wCls = '';
try { if (window.waterDayHas && window.waterDayHas(ds)) wCls = ' cal-water'; } catch (e) {}
const rCls = recSet.has(ds) ? ' cal-rec' : '';
html += '<span class="cal-cell' + wCls + rCls + (isToday ? ' today' : '') + (ds === selDate ? ' sel' : '') + '" data-date="' + ds + '">' + d + '</span>';
}
grid.innerHTML = html;
}
const calGridEl = document.getElementById('cal-grid');
if (calGridEl) {
calGridEl.addEventListener('click', (ev) => {
const cell = ev.target.closest('.cal-cell');
if (!cell || cell.classList.contains('blank')) return;
const ds = cell.getAttribute('data-date');
if (!ds || ds === selDate) return;
selDate = ds;
render();
});
}
const calPrev = document.getElementById('cal-prev');
if (calPrev) calPrev.addEventListener('click', () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderGrid(); });
const calNext = document.getElementById('cal-next');
if (calNext) calNext.addEventListener('click', () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderGrid(); });
function getMyMessage() {
const v = store.get('cal-my-' + todayStr());
return v || '';
}
function renderMyMessage() {
const el = document.getElementById('cal-my-message');
if (!el) return;
const msg = store.get('cal-my-' + selDate);
el.textContent = msg || (selDate === todayStr() ? '今天想说点什么...' : calEmptyTxt('这一天没有留下留言'));
const btn = document.getElementById('cal-edit-btn');
if (btn) btn.hidden = selDate !== todayStr();
}
function calEmptyTxt(finalTxt) {
return (window.mochiDataPending && window.mochiDataPending()) ? window.mochiLoadingText() : finalTxt;
}
function renderDayNotes(dd, isFuture) {
const futureTip = '这一天还没有内容';
const histOnDay = function (histKey) {
try {
const list = JSON.parse(store.get(histKey) || '[]');
return list.filter(x => x && x.ts && new Date(x.ts).toDateString() === dd.toDateString())
.map(x => x.text).filter(Boolean);
} catch (e) { return []; }
};
const qEl = document.getElementById('cal-quote');
if (qEl) {
if (isFuture) {
qEl.textContent = futureTip;
} else {
let qt = '';
try {
const ql = JSON.parse(store.get('quote-history') || '[]');
const hit = ql.find(x => x && x.date === selDate);
qt = hit ? hit.text : '';
} catch (e) {}
if (!qt && selDate === todayStr()) {
try { qt = (window.getQuoteOfDay && window.getQuoteOfDay()) || ''; } catch (e) {}
}
qEl.textContent = (qt || calEmptyTxt(selDate === todayStr() ? '今天还没有情话' : '这一天没有留下情话'));
if (qEl.textContent && window.taFit) qEl.textContent = window.taFit(qEl.textContent);
}
}
const memo = isFuture ? '' : (store.get('memo-' + selDate) || histOnDay('memo-history').join('；'));
const mood = isFuture ? '' : (store.get('today-mood-' + selDate) || histOnDay('mood-history').join('；'));
const memoEl = document.getElementById('cal-memo');
if (memoEl) memoEl.textContent = isFuture ? futureTip : (memo || calEmptyTxt('这一天没有备忘'));
const moodEl = document.getElementById('cal-mood');
if (moodEl) moodEl.textContent = isFuture ? futureTip : (mood || calEmptyTxt('这一天没有记录心情'));
const statsEl = document.getElementById('cal-stats');
if (statsEl) {
statsEl.style.whiteSpace = 'pre-line';
if (isFuture) {
statsEl.textContent = futureTip;
} else {
const norm = (s) => {
const p = String(s).split('-');
if (p.length !== 3) return String(s);
return p[0] + '-' + String(+p[1]).padStart(2, '0') + '-' + String(+p[2]).padStart(2, '0');
};
const myName = store.get('lbl-user') || '我';
const taName = store.get('lbl-partner') || 'TA';
const isToday = selDate === todayStr();
const dayKey = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
const pickDay = (logKey) => {
try {
const list = JSON.parse(store.get(logKey) || '[]');
return list.find(x => x && norm(x.date) === selDate) || null;
} catch (e) { return null; }
};
let fm = 0, ft = 0, wm = 0, wt = 0;
if (isToday) {
const k = dayKey(dd);
fm = parseInt(store.get('day-fish-' + k) || '0', 10) || 0;
ft = parseInt(store.get('day-fish-ta-' + k) || '0', 10) || 0;
wm = parseInt(store.get('day-work-' + k) || '0', 10) || 0;
wt = parseInt(store.get('day-work-ta-' + k) || '0', 10) || 0;
} else {
const f = pickDay('fish-day-add');
const w = pickDay('work-day-add');
if (f) { fm = f.mine || 0; ft = f.ta || 0; }
if (w) { wm = w.mine || 0; wt = w.ta || 0; }
}
const lines = [];
if (fm || ft || isToday) lines.push('摸鱼值　' + myName + ' +' + fm + ' · ' + taName + ' +' + ft);
if (wm || wt || isToday) lines.push('工作值　' + myName + ' +' + wm + ' · ' + taName + ' +' + wt);
statsEl.textContent = lines.length ? lines.join('\n') : calEmptyTxt('这一天没有摸鱼 / 工作记录');
}
}
}
function renderMoodEntry() {
const entry = document.getElementById('cal-mood-entry');
if (!entry) return;
const mineEl = document.getElementById('mood-entry-mine');
const taEl = document.getElementById('mood-entry-ta');
const taLabel = document.getElementById('mood-entry-ta-label');
let md = null;
try { md = window.moodDiaryToday ? window.moodDiaryToday() : null; } catch (e) { md = null; }
const nm = store.get('lbl-partner') || 'TA';
if (taLabel) taLabel.textContent = nm + '（心情日记）';
if (mineEl) mineEl.textContent = (md && md.mine) ? (md.mine.e + ' ' + md.mine.n) : calEmptyTxt('今天还没记心情');
if (taEl) taEl.textContent = (md && md.ta) ? (md.ta.e + ' ' + md.ta.n)
: ((md && md.taUnknown) ? (window.mochiLoadingText ? window.mochiLoadingText() : calEmptyTxt('今天还没有互动')) : calEmptyTxt('今天还没有互动'));
}
document.addEventListener('mood-interact-recorded', function () { try { renderMoodEntry(); } catch (e) {} });
function render() {
try { ensureFishHeat(); } catch (e) {} // 摸鱼/工作「当日统计」随 selDate 切换刷新
try { renderMoodEntry(); } catch (e) {}
const parts = selDate.split('-');
const dd = new Date(+parts[0], +parts[1] - 1, +parts[2]);
const n2 = new Date();
const isFuture = dd > new Date(n2.getFullYear(), n2.getMonth(), n2.getDate());
const e = isFuture ? null : getDayEntry(selDate);
const isBefore = !isFuture && !e && selDate < firstUseDate();
cleanPreFirstEntries();
const taCard = document.getElementById('cal-ta-card');
const meCard = document.getElementById('cal-me-card');
const emptyCard = document.getElementById('cal-empty-card');
const emptyTxt = document.getElementById('cal-empty-txt');
if (isFuture || isBefore) {
if (taCard) taCard.hidden = true;
if (meCard) meCard.hidden = true;
if (emptyCard) emptyCard.hidden = false;
if (emptyTxt) emptyTxt.textContent = isFuture ? '这一天还没有内容，等到了那一天再来看看吧' : '开始使用之前的日子，没有留下内容';
renderGrid();
return;
}
if (taCard) taCard.hidden = false;
if (meCard) meCard.hidden = false;
if (emptyCard) emptyCard.hidden = true;
const dateEl = document.getElementById('cal-today-date');
if (dateEl) dateEl.textContent = e ? e.date : selDate;
const catEl = document.getElementById('cal-mood-cat');
if (catEl) catEl.textContent = e ? e.cat : '未到来';
const icoEl = document.getElementById('cal-mood-ico');
if (icoEl) icoEl.innerHTML = MOOD_ICONS[e ? e.cat : '平静'] || MOOD_ICONS['平静'];
const nameEl = document.getElementById('cal-mood-name');
if (nameEl) nameEl.textContent = e ? e.mood : '未来';
const descEl = document.getElementById('cal-mood-desc');
if (descEl) descEl.textContent = e ? (window.taFit ? window.taFit(e.desc) : e.desc) : calEmptyTxt('这一天还没有内容');
const actEl = document.getElementById('cal-activity');
if (actEl) actEl.textContent = e ? (window.taFit ? window.taFit(e.activity) : e.activity) : '—';
const msgEl = document.getElementById('cal-message');
if (msgEl) msgEl.textContent = e ? (window.taFit ? window.taFit(calCleanMsg(e.message)) : calCleanMsg(e.message)) : calEmptyTxt('这一天还没有留言');
renderMyMessage();
renderDayNotes(dd, isFuture);
renderGrid();
}
if (window.mochiOnDataReady) window.mochiOnDataReady(render);
let _heatCard = null;
function heatNorm(s) {
const p = String(s || '').split('-');
if (p.length !== 3) return null;
const y = +p[0], m = +p[1], d = +p[2];
if (!y || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
return new Date(y, m - 1, d);
}
function ensureFishHeat() {
const emptyCard = document.getElementById('cal-empty-card');
const meCard = document.getElementById('cal-me-card');
const anchor = emptyCard || meCard;
if (!anchor) return;
if (!_heatCard) {
_heatCard = document.createElement('div');
_heatCard.className = 'cal-card glass';
_heatCard.id = 'cal-fish-heat';
_heatCard.innerHTML =
'<div class="cal-sec">' +
'<div class="cal-sec-head"><div class="cal-sec-title">摸鱼 · 工作（日统计）</div><span class="fh-range" id="fh-range"></span></div>' +
'<div class="fh-bars" id="fh-wrap"></div>' +
'</div>';
anchor.parentNode.insertBefore(_heatCard, anchor.nextSibling);
}
const rangeEl = document.getElementById('fh-range');
const wrap = document.getElementById('fh-wrap');
if (!wrap) return;
const parts = selDate.split('-');
const dd = new Date(+parts[0], +parts[1] - 1, +parts[2]);
const n2 = new Date();
const today0 = new Date(n2.getFullYear(), n2.getMonth(), n2.getDate());
const isFuture = dd > today0;
const isBefore = !isFuture && selDate < firstUseDate();
if (isFuture || isBefore) {
if (rangeEl) rangeEl.textContent = isFuture ? '这一天还没到来' : '开始使用之前没有记录';
wrap.innerHTML = '<div class="fh-empty">' + (isFuture ? '等到了那一天再来看看吧' : '开始使用之前的日子没有摸鱼 / 工作记录') + '</div>';
return;
}
if (rangeEl) rangeEl.textContent = (dd.getMonth() + 1) + ' 月 ' + dd.getDate() + ' 日 · 完整日统计';
const isToday = selDate === todayStr();
const dayKey = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
const norm = (s) => {
const p = String(s).split('-');
if (p.length !== 3) return String(s);
return p[0] + '-' + String(+p[1]).padStart(2, '0') + '-' + String(+p[2]).padStart(2, '0');
};
const pickDay = (logKey) => {
try {
const list = JSON.parse(store.get(logKey) || '[]');
return list.find(x => x && norm(x.date) === selDate) || null;
} catch (e) { return null; }
};
let fm = 0, ft = 0, wm = 0, wt = 0;
if (isToday) {
const k = dayKey(dd);
fm = parseInt(store.get('day-fish-' + k) || '0', 10) || 0;
ft = parseInt(store.get('day-fish-ta-' + k) || '0', 10) || 0;
wm = parseInt(store.get('day-work-' + k) || '0', 10) || 0;
wt = parseInt(store.get('day-work-ta-' + k) || '0', 10) || 0;
} else {
const f = pickDay('fish-day-add');
const w = pickDay('work-day-add');
if (f) { fm = f.mine || 0; ft = f.ta || 0; }
if (w) { wm = w.mine || 0; wt = w.ta || 0; }
}
const myName = store.get('lbl-user') || '我';
const taName = store.get('lbl-partner') || 'TA';
if (!fm && !ft && !wm && !wt) {
wrap.innerHTML = '<div class="fh-empty">这一天没有摸鱼 / 工作记录</div>';
return;
}
const maxV = Math.max(fm, ft, wm, wt, 1);
const pct = (v) => Math.max(4, Math.round(v / maxV * 100));
const bars = [
{ label: '摸鱼 · ' + myName, v: fm, cls: 'fish' },
{ label: '摸鱼 · ' + taName, v: ft, cls: 'fish' },
{ label: '工作 · ' + myName, v: wm, cls: 'work' },
{ label: '工作 · ' + taName, v: wt, cls: 'work' }
];
let html = '';
bars.forEach(b => {
html += '<div class="fh-bar-row ' + b.cls + '">' +
'<span class="fh-label">' + b.label + '</span>' +
'<div class="fh-track"><div class="fh-fill" style="width:' + pct(b.v) + '%"></div></div>' +
'<span class="fh-val">+' + b.v + '</span>' +
'</div>';
});
wrap.innerHTML = html;
}
const calApp = document.querySelector('.app[data-app="calendar"]');
if (calApp && page) {
calApp.addEventListener('click', () => {
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) return;
document.querySelectorAll('.page').forEach(p => p.hidden = true);
page.hidden = false;
viewM = -1;
selDate = todayStr();
render();
});
}
const editBtn = document.getElementById('cal-edit-btn');
if (editBtn) {
editBtn.addEventListener('click', () => {
if (window.openModal) {
window.openModal('编辑我的留言', getMyMessage(), (v) => {
const val = (v || '').trim();
if (val) {
store.set('cal-my-' + todayStr(), val);
renderMyMessage();
}
});
}
});
}
const calBack = document.getElementById('cal-back');
if (calBack) {
calBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const phonePage = document.getElementById('page-phone');
if (phonePage) phonePage.hidden = false;
});
}
(function () {
const key = 'greeted-' + todayStr();
let greeted = false; // 本会话只显示一次
function openCalPage() {
const calApp = document.querySelector('.app[data-app="calendar"]');
if (!calApp || !page) return;
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) return;
document.querySelectorAll('.page').forEach(p => p.hidden = true);
page.hidden = false;
viewM = -1;
selDate = todayStr();
render();
}
function hideGreetBanner() {
const el = document.getElementById('daily-greet');
if (!el) return;
el.hidden = true;
clearTimeout(el._timer);
}
(function () {
const phonePageEl = document.getElementById('page-phone');
if (!phonePageEl || typeof MutationObserver === 'undefined') return;
try {
new MutationObserver(function () { if (phonePageEl.hidden) hideGreetBanner(); })
.observe(phonePageEl, { attributes: true, attributeFilter: ['hidden'] });
} catch (e) {}
})();
function showGreetBanner(e2, name) {
let el = document.getElementById('daily-greet');
if (!el) {
el = document.createElement('div');
el.id = 'daily-greet';
el.style.cssText = 'position:fixed;top:calc(12px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:89;width:min(330px,calc(100% - 24px));box-sizing:border-box;background:rgba(255,255,255,.97);border:1px solid rgba(0,0,0,.1);border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.12);padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;font-family:inherit;text-align:left;';
const t = document.createElement('div');
t.style.cssText = 'font-size:12px;font-weight:700;color:var(--ink,#111);margin-bottom:6px;';
const b = document.createElement('div');
b.style.cssText = 'font-size:12px;color:#666;line-height:1.6;white-space:pre-line;word-break:break-word;';
el.appendChild(t); el.appendChild(b);
el._t = t; el._b = b;
el.addEventListener('click', () => { hideGreetBanner(); openCalPage(); });
document.body.appendChild(el);
}
el._t.textContent = name + ' 的今日留言';
let mdLine = '';
try {
const md = window.moodDiaryToday ? window.moodDiaryToday() : null;
if (md && md.ta) mdLine = '\n梦角（心情日记）：' + md.ta.e + ' ' + md.ta.n;
} catch (e) { mdLine = ''; }
const gbody = '今日心情：' + e2.mood + '（' + e2.cat + '）\nTA 正在：' + e2.activity + '\n\nTA 留言：\n' + calCleanMsg(e2.message) + mdLine;
el._b.textContent = window.taFit ? window.taFit(gbody) : gbody;
el.hidden = false;
el.style.transition = 'none';
el.style.opacity = '0';
el.style.transform = 'translateX(-50%) translateY(-8px)';
requestAnimationFrame(() => {
el.style.transition = 'opacity .25s ease, transform .25s ease';
el.style.opacity = '1';
el.style.transform = 'translateX(-50%) translateY(0)';
});
clearTimeout(el._timer);
el._timer = setTimeout(hideGreetBanner, 8000);
}
function doGreet() {
const myCid = window.__activeCid || 'default';
greeted = true;
store.set(key, '1');
try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + key, '1'); } catch (e) {}
const splashEl = document.getElementById('splash');
const iv = setInterval(() => {
if ((window.__activeCid || 'default') !== myCid) { try { clearInterval(iv); } catch (e) {} return; }
if (!splashEl || splashEl.classList.contains('hide')) {
clearInterval(iv);
setTimeout(() => {
if ((window.__activeCid || 'default') !== myCid) return;
try {
const phonePage = document.getElementById('page-phone');
if (phonePage && phonePage.hidden) return;
const mm = document.getElementById('modal-mask');
const tc = document.getElementById('tc-mask');
if ((mm && !mm.hidden) || (tc && !tc.hidden)) return;
} catch (e) {}
showGreetBanner(getToday(), store.get('lbl-partner') || 'TA');
}, 1000);
}
}, 500);
setTimeout(() => { try { clearInterval(iv); } catch (e) {} }, 30000); // 30s 兜底停止轮询
}
function maybeGreet() {
if (greeted) return;
if (store.get(key)) { greeted = true; return; }
if (window.idbGet) {
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':' + key).then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v) { greeted = true; store.set(key, '1'); return; }
if (greeted) return;
doGreet();
}).catch(() => { if (window.activePrefix() !== myPrefix) return; if (!greeted) doGreet(); });
} else {
doGreet();
}
}
maybeGreet();
})();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("calendar.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("calendar.js"); try { console.error("[JS] calendar.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[calendar.js] " + String(__e && __e.message || __e)); } })();
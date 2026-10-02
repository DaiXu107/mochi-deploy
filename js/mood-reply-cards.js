(function () { try {
(function () {
const uid = window.activePrefix();
const ls = window.activeStore();
const DATA = (window.MOOD_FOLLOWUP_DATA) || {};
const W = DATA.weights || {};
let emotionStreak = 0;
let emotionLastTs = 0;       // 上次情绪卡触发时间（v3.6.x：聊天间隔较长时重置 streak）
let heartHistory = [];       // 最近触发的具体心意卡
let specialLastTime = 0;     // 特殊心意上次触发时间（24h 冷却）
function hit(p) { return Math.random() * 100 < p; }
function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
function toastCard(txt, off) {
const s = String(txt == null ? '' : txt);
toast((off ? '已关闭：' : '已开启：') + (s.length > 18 ? s.slice(0, 18) + '…' : s));
}
function weightedPick(items) {
const total = items.reduce((a, it) => a + Math.max(0, it[1]), 0);
if (total <= 0) return items.length ? items[0] : null;
let roll = Math.random() * total;
for (const it of items) {
roll -= Math.max(0, it[1]);
if (roll < 0) return it[0];
}
return items[items.length - 1] ? items[items.length - 1][0] : null;
}
const MC_PROB_DEF = { mood: 70, heart: 40, intent: 40 };
function mcProb(type) {
const d = MC_PROB_DEF[type] !== undefined ? MC_PROB_DEF[type] : 100;
try {
const v = ls.get('mc-prob-' + type);
if (v === null || v === undefined || v === '') return d;
const n = Number(v);
return isNaN(n) ? d : Math.max(0, Math.min(100, n));
} catch (e) { return d; }
}
const RCARD_PROB_DEF = 30; // 原 getReplyCard 写死的 30%（与默认字卡 defaultCommonOverallProb 同档）
function rcardProb() {
try {
const v = ls.get('rcard-prob');
if (v === null || v === undefined || v === '') return RCARD_PROB_DEF;
const n = Number(v);
return isNaN(n) ? RCARD_PROB_DEF : Math.max(0, Math.min(100, n));
} catch (e) { return RCARD_PROB_DEF; }
}
function bindProbStepper(boxId, valId, read, write, label) {
const box = document.getElementById(boxId);
const valEl = document.getElementById(valId);
if (!box || !valEl) return null;
const stepBy = function (delta) {
const cur = parseInt(valEl.value, 10);
const nv = Math.max(0, Math.min(100, (isNaN(cur) ? read() : cur) + delta));
valEl.value = String(nv);
try { write(nv); } catch (e) {}
toast(label + '：' + nv + '%');
};
const mn = box.querySelector('.stp-min');
const mx = box.querySelector('.stp-max');
if (mn) mn.addEventListener('click', function () { stepBy(-5); });
if (mx) mx.addEventListener('click', function () { stepBy(5); });
return { box: box, valEl: valEl, refresh: function () { valEl.value = String(read()); } };
}
let syncCardProbUI = function () {};
function addProbUISync(fn) {
const prev = syncCardProbUI;
syncCardProbUI = function () { try { prev(); } catch (e) {} try { fn(); } catch (e) {} };
}
function enabled(k) {
const v = ls.get('mh-' + k);
return v === null ? true : v === '1';
}
function setEnabled(k, v) { ls.set('mh-' + k, v ? '1' : '0'); }
window.moodSystemState = { enabled, setEnabled };
function isCardOff(k, c) { return ls.get(k + ':' + c) === '1'; }
function setCardOff(k, c, off) { ls.set(k + ':' + c, off ? '1' : '0'); }
const PG_ID_MC = { mood: 'mc:mood', heart: 'mc:heart', intent: 'mc:intent' };
let pgIdx = null;   // 内容 -> [分组名,…]：预设数据静态，索引只建一次
function pgGroupsOf(type, content) {
if (!pgIdx) {
pgIdx = {};
['mood', 'heart', 'intent'].forEach(function (k) {
const list = k === 'heart' ? (DATA.heart || []).concat(DATA.specialHeart || [])
: k === 'intent' ? (DATA.intent || []) : (DATA.mood || []);
list.forEach(function (g) {
(g.cards || []).forEach(function (c) {
const id = PG_ID_MC[k] + '\u0000' + c.content;
if (!pgIdx[id]) pgIdx[id] = [];
if (pgIdx[id].indexOf(g.group) < 0) pgIdx[id].push(g.group);
});
});
});
}
return pgIdx[PG_ID_MC[type] + '\u0000' + content] || null;
}
function pgOff(type, content) {
const pg = window.presetGroup;
if (!pg) return false;
const gs = pgGroupsOf(type, content);
if (!gs) return false;
for (let i = 0; i < gs.length; i++) { if (pg.isOff(PG_ID_MC[type], gs[i])) return true; }
return false;
}
function rcOff(cat, t) { return isCardOff('rc-off-' + cat, t) || !!(window.presetGroup && window.presetGroup.isOff('rc', cat)); }
const OFF_KEY = { mood: 'mc-off-mood', heart: 'mc-off-heart', intent: 'mc-off-intent' };
function hasMoodCard(c) {
for (const g of (DATA.mood || [])) {
for (const card of g.cards) if (card.content === c) return true;
}
return false;
}
function typeOff(type, content) {
if (pgOff(type, content)) return true;   // #1315：分组闸先判——单卡「重新打开」也不许越过整组停用
const own = ls.get(OFF_KEY[type] + ':' + content);
if (own !== null && own !== '') return own === '1';
if (type !== 'mood' && !hasMoodCard(content) && ls.get('mc-off-mood:' + content) === '1') return true;
return false;
}
function setTypeOff(type, content, off) {
ls.set(OFF_KEY[type] + ':' + content, off ? '1' : '0');
}
window.moodCardOffState = typeOff;
window.getMoodCard = function () {
if (!enabled('mood')) return null;
if (emotionLastTs && Date.now() - emotionLastTs > 10 * 60000) emotionStreak = 0;
const _mBase = (window.dcpEff ? window.dcpEff(mcProb('mood')) : mcProb('mood')); // #518 套总档
const streakMap = W.moodStreak || { 0: 70, 1: 60, 2: 45, 3: 30, 4: 20 };
const _lvl = emotionStreak >= 4 ? '4' : String(emotionStreak);
const _ref = streakMap['0'] !== undefined ? streakMap['0'] : 70;
const _ratio = (_ref > 0 && streakMap[_lvl] !== undefined) ? (streakMap[_lvl] / _ref) : 1;
let prob = Math.max(0, Math.min(100, _mBase * _ratio));
if (Math.random() * 100 > prob) return null;
const groups = (DATA.mood || [])
.filter(g => !(window.presetGroup && window.presetGroup.isOff(PG_ID_MC.mood, g.group)))   // #1315 整组停用：组直接不进候选
.map(g => ({ ...g, cards: g.cards.filter(c => !isCardOff('mc-off-mood', c.content)) }))
.filter(g => g.cards && g.cards.length);
let moodGroups = groups;
try {
const ps = window.periodStatus && window.periodStatus();
if (ps && ps.inPeriod) {
const downGroups = { '悲伤与低落': 1, '愤怒与不满': 1, '不安与恐惧': 1, '克制与隐藏': 1 };
const upGroups = { '喜悦与正向': 1, '亲近与爱意': 1 };
moodGroups = groups.map(g => {
let w = g.weight || 1;
if (downGroups[g.group]) w *= 3;
else if (upGroups[g.group]) w *= 0.6;
return { ...g, weight: w };
});
}
} catch (e) {}
const g = weightedPick(moodGroups.map(x => [x, x.weight || 1]));
if (!g) return null;
const cards = g.cards;
const rarity = weightedPick(Object.keys(W.rarity || { normal: 80, rare: 15, special: 5 }).map(k => [k, W.rarity[k]]));
let pool = cards.filter(c => c.rarity === rarity);
if (!pool.length) pool = cards;
const card = pick(pool);
if (!card) return null;
emotionStreak++;
emotionLastTs = Date.now();
return { content: card.content, group: g.group, rarity: card.rarity };
};
window.getHeartCard = function (moodCard) {
if (!enabled('heart')) return null;
if (Math.random() * 100 > (window.dcpEff ? window.dcpEff(mcProb('heart')) : mcProb('heart'))) return null; // #518 套总档
const chatCount = Number(ls.get('chat-count') || 0);
if (chatCount >= 20 && (Date.now() - specialLastTime) > 86400000 && Math.random() * 100 < 5) {
specialLastTime = Date.now();
const specials = [];
(DATA.specialHeart || []).forEach(g => g.cards.forEach(c => {
if (typeOff('heart', c.content)) return;
specials.push({ content: c.content, group: g.group, emoji: g.emoji, level: c.level, isSpecial: true });
}));
if (specials.length) {
const recent5 = heartHistory.slice(-5).map(h => h.content);
let pool = specials.filter(c => recent5.indexOf(c.content) === -1);
if (!pool.length) pool = specials;
const picked = pick(pool);
if (picked) { heartHistory.push(picked); return picked; }
}
}
let pool = null;
if (moodCard && moodCard.group && DATA.emotionToHeart && DATA.emotionToHeart[moodCard.group]) {
pool = DATA.emotionToHeart[moodCard.group];
}
if (!pool) pool = DATA.generalHeartPool || [];
const recent3 = heartHistory.slice(-3).map(h => h.group);
const adj = pool.map(p => [p[0], recent3.indexOf(p[0]) >= 0 ? (p[1] || 1) * 0.5 : (p[1] || 1)]);
const selGroup = weightedPick(adj);
if (!selGroup) return null;
const grp = (DATA.heart || []).find(g => g.group === selGroup);
if (!grp || !grp.cards.length) return null;
let cards = grp.cards.filter(c => !typeOff('heart', c.content));
if (!cards.length) return null;
const recent5 = heartHistory.slice(-5).map(h => h.content);
let cooled = cards.filter(c => recent5.indexOf(c.content) === -1);
if (!cooled.length) cooled = cards;
const rarity = weightedPick(Object.keys(W.rarity || { normal: 80, rare: 15, special: 5 }).map(k => [k, W.rarity[k]]));
let rpool = cooled.filter(c => c.rarity === rarity);
if (!rpool.length) rpool = cooled;
const lw = (W.heartLevel && W.heartLevel[rarity]) || (W.heartLevel && W.heartLevel.normal) || { '1': 80, '2': 18, '3': 2 };
const lwItems = rpool.map(c => [c, lw[String(c.level || 1)] !== undefined ? lw[String(c.level || 1)] : lw['1']]);
const picked = weightedPick(lwItems);
if (!picked) return null;
heartHistory.push({ content: picked.content, group: grp.group });
if (heartHistory.length > 10) heartHistory = heartHistory.slice(-10);
return { content: picked.content, group: grp.group, emoji: grp.emoji, level: picked.level, rarity: picked.rarity };
};
window.getIntentCard = function (heartCard) {
if (!enabled('intent')) return null;
if (Math.random() * 100 > (window.dcpEff ? window.dcpEff(mcProb('intent')) : mcProb('intent'))) return null; // #518 套总档
let pool = null;
if (heartCard && heartCard.group && DATA.heartToIntent && DATA.heartToIntent[heartCard.group]) {
pool = DATA.heartToIntent[heartCard.group];
}
if (!pool) pool = (DATA.intent || []).map(g => [g.group, g.weight || 1]);
const selGroup = weightedPick(pool.map(p => [p[0], p[1]]));
if (!selGroup) return null;
const grp = (DATA.intent || []).find(g => g.group === selGroup);
if (!grp || !grp.cards.length) return null;
const cards = grp.cards.filter(c => !typeOff('intent', c.content));
if (!cards.length) return null;
const rarity = weightedPick(Object.keys(W.rarity || { normal: 80, rare: 15, special: 5 }).map(k => [k, W.rarity[k]]));
let pool2 = cards.filter(c => c.rarity === rarity);
if (!pool2.length) pool2 = cards;
const picked = pick(pool2);
if (!picked) return null;
return { content: picked.content, group: grp.group, emoji: grp.emoji, rarity: picked.rarity };
};
window.triggerEmotionChain = function () {
if (!enabled('mood')) return null;
const out = [];
const mood = window.getMoodCard();
if (mood) out.push({ type: 'mood', content: mood.content, meta: mood });
const heart = window.getHeartCard(mood || null);
if (heart) out.push({ type: 'heart', content: heart.content, meta: heart });
const intent = window.getIntentCard(heart || null);
if (intent) out.push({ type: 'intent', content: intent.content, meta: intent });
return out.length ? out : null;
};
window.addChatCount = function () {
ls.set('chat-count', String((Number(ls.get('chat-count') || 0)) + 1));
};
window.resetEmotionStreak = function () { emotionStreak = 0; };
const rcList = document.getElementById('rc-list');
if (rcList) rcList.classList.add('preset-list'); // #1315 分组开关样式锚（与 #926 那四个列表同一份 .preset-list 规则）
const rcEnabled = document.getElementById('rc-enabled');
if (rcList && rcEnabled) {
rcEnabled.checked = (ls.get('rc-enabled') === null) ? true : ls.get('rc-enabled') === '1';
rcEnabled.addEventListener('change', () => ls.set('rc-enabled', rcEnabled.checked ? '1' : '0'));
const rcProbUI = bindProbStepper('rcard-prob', 'rcard-prob-val', rcardProb,
function (v) { ls.set('rcard-prob', String(v)); }, '回应字卡使用概率');
const cfProbUI = bindProbStepper('cf-prob', 'cf-prob-val', function () {
const c = (window.replyCfg && window.replyCfg()) || {};
const n = Number(c['cf-prob']);
return isFinite(n) ? n : 20;
}, function (v) { if (window.saveReplyCfg) window.saveReplyCfg('cf-prob', v); }, '连接词追加概率');
addProbUISync(function () {
if (rcProbUI) rcProbUI.refresh();
if (cfProbUI) cfProbUI.refresh();
});
const CATS = [
['echo', '接话'], ['confirm', '确认'], ['keep', '继续'], ['probe', '轻追问'],
['bridge', '连接'], ['shift', '转折'], ['tone', '停顿'], ['close', '收束']
];
let rcGroup = '';
let rcQ = '';
function renderRCBar() {
const bar = document.getElementById('rc-groups-bar');
if (!bar) return;
bar.innerHTML = '';
const chips = [['', '全部']].concat(CATS.map(c => [c[0], c[1]]));
chips.forEach(([val, label]) => {
const cEl = document.createElement('span');
cEl.className = 'cc-g-chip' + (rcGroup === val ? ' sel' : '');
cEl.textContent = label;
cEl.addEventListener('click', () => { rcGroup = val; renderRCBar(); renderReply(); });
bar.appendChild(cEl);
});
}
function renderReply() {
const followup = DATA.followup || {};
rcList.innerHTML = '';
const cats = rcGroup ? CATS.filter(c => c[0] === rcGroup) : CATS;
cats.forEach(([key, name]) => {
let arr = followup[key] || [];
if (rcQ) arr = arr.filter(t => t.indexOf(rcQ) >= 0);
if (rcQ && !arr.length) return;
const h = document.createElement('div');
const rcGOff = !!(window.presetGroup && window.presetGroup.isOff('rc', key));
h.className = 'cc-group-header' + (rcGOff ? ' off' : '');
h.innerHTML = window.presetGroup
? window.presetGroup.headerHTML('rc', key, name, arr.length)
: '<span class="ccg-name">' + name + '</span><span class="ccg-count">' + arr.length + '</span>';
rcList.appendChild(h);
if (window.presetGroup) window.presetGroup.bind(h, 'rc', key, function (nowOff) {
renderReply();
toast(nowOff ? '已停用分组：' + name + '（本组 ' + arr.length + ' 张字卡不再使用）' : '已启用分组：' + name);
});
arr.forEach(t => {
const off = rcOff(key, t);
const d = document.createElement('div');
d.className = 'cc-item glass' + (off ? ' off' : '');
d.innerHTML = '<div class="cc-txt"><div class="t">' + t + ' <span class="tc-known">系统</span></div></div>' +
'<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
rcList.appendChild(d);
d.querySelector('input').addEventListener('change', () => {
const nowOff = !d.querySelector('input').checked;
setCardOff('rc-off-' + key, t, nowOff);
d.classList.toggle('off', nowOff);
toastCard(t, nowOff);
});
});
});
}
renderRCBar();
renderReply();
const rcSearchInput = document.getElementById('rc-search-input');
if (rcSearchInput) {
rcSearchInput.addEventListener('input', () => {
rcQ = rcSearchInput.value.trim();
renderReply();
});
rcSearchInput.addEventListener('keydown', (e) => {
if (e.key === 'Escape') { rcSearchInput.value = ''; rcQ = ''; renderReply(); rcSearchInput.blur(); }
});
}
const li = document.getElementById('li-reply-cards');
if (li) {
li.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const page = document.getElementById('page-reply-cards');
if (page) page.hidden = false;
});
}
const back = document.getElementById('rc-back');
if (back) {
back.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
}
const mcList = document.getElementById('mc-list');
if (mcList) mcList.classList.add('preset-list'); // #1315 分组开关样式锚（与 #926 那四个列表同一份 .preset-list 规则）
const mcEnabled = document.getElementById('mc-enabled');
if (mcList && mcEnabled) {
mcEnabled.checked = (ls.get('mc-enabled') === null) ? true : ls.get('mc-enabled') === '1';
mcEnabled.addEventListener('change', () => {
ls.set('mc-enabled', mcEnabled.checked ? '1' : '0');
setEnabled('mood', mcEnabled.checked);
setEnabled('heart', mcEnabled.checked);
setEnabled('intent', mcEnabled.checked);
});
const mcProbUI = {};
[['mood', '情绪字卡概率'], ['heart', '心意字卡概率'], ['intent', '交流意图字卡概率']].forEach(function (p) {
mcProbUI[p[0]] = bindProbStepper('mc-prob-' + p[0], 'mc-prob-' + p[0] + '-val',
function () { return mcProb(p[0]); },
function (v) { ls.set('mc-prob-' + p[0], String(v)); }, p[1]);
});
addProbUISync(function () {
Object.keys(mcProbUI).forEach(function (k) { if (mcProbUI[k]) mcProbUI[k].refresh(); });
});
const MC_TYPES = [
{ key: 'mood', name: '情绪' },
{ key: 'heart', name: '心意' },
{ key: 'intent', name: '交流意图' },
];
let mcType = 'mood';
let mcGroup = '';
let mcQ = '';
function typeGroups(key) {
if (key === 'heart') {
return (DATA.heart || []).map(g => ({ ...g, type: 'heart' }))
.concat((DATA.specialHeart || []).map(g => ({ ...g, type: 'heart', special: true })));
}
if (key === 'intent') return (DATA.intent || []).map(g => ({ ...g, type: 'intent' }));
return (DATA.mood || []).map(g => ({ ...g, type: 'mood' }));
}
function renderTypeBar() {
const bar = document.getElementById('mc-type-bar');
if (!bar) return;
bar.innerHTML = '';
MC_TYPES.forEach(t => {
const cEl = document.createElement('span');
cEl.className = 'cc-g-chip' + (mcType === t.key ? ' sel' : '');
cEl.textContent = t.name;
cEl.addEventListener('click', () => { mcType = t.key; mcGroup = ''; renderTypeBar(); renderMCBar(); renderMood(); });
bar.appendChild(cEl);
});
const title = document.getElementById('mc-group-title');
if (title) title.textContent = (MC_TYPES.find(t => t.key === mcType) || MC_TYPES[0]).name + '分组';
const si = document.getElementById('mc-search-input');
if (si) si.placeholder = '搜索' + (MC_TYPES.find(t => t.key === mcType) || MC_TYPES[0]).name + '字卡';
}
function renderMCBar() {
const bar = document.getElementById('mc-groups-bar');
if (!bar) return;
bar.innerHTML = '';
const groups = typeGroups(mcType);
const chips = [['', '全部']].concat(groups.map(g => [g.group, g.group]));
chips.forEach(([val, label]) => {
const cEl = document.createElement('span');
cEl.className = 'cc-g-chip' + (mcGroup === val ? ' sel' : '');
cEl.textContent = label;
cEl.addEventListener('click', () => { mcGroup = val; renderMCBar(); renderMood(); });
bar.appendChild(cEl);
});
}
function renderMood() {
const groups = typeGroups(mcType);
let shown = mcGroup ? groups.filter(g => g.group === mcGroup) : groups;
if (mcQ) {
shown = shown.map(g => ({ ...g, cards: g.cards.filter(c => c.content.indexOf(mcQ) >= 0) })).filter(g => g.cards.length || g.group.indexOf(mcQ) >= 0);
}
mcList.innerHTML = '';
if (!shown.length) { mcList.innerHTML = '<div class="cc-empty">暂无字卡</div>'; return; }
shown.forEach(g => {
const h = document.createElement('div');
const mcId = PG_ID_MC[g.type || mcType] || 'mc:mood';
const mcGOff = !!(window.presetGroup && window.presetGroup.isOff(mcId, g.group));
h.className = 'cc-group-header' + (mcGOff ? ' off' : '');
h.innerHTML = window.presetGroup
? window.presetGroup.headerHTML(mcId, g.group, g.group, g.cards.length,
(g.weight ? '<span class="ccg-count" style="background:rgba(0,0,0,.03)">权重 ' + g.weight + '</span>' : '') +
(g.special ? '<span class="ccg-count" style="background:rgba(0,0,0,.03)">特殊</span>' : ''))
: '<span class="ccg-name">' + g.group + '</span><span class="ccg-count">' + g.cards.length + '</span>' +
(g.weight ? '<span class="ccg-count" style="background:rgba(0,0,0,.03)">权重 ' + g.weight + '</span>' : '') +
(g.special ? '<span class="ccg-count" style="background:rgba(0,0,0,.03)">特殊</span>' : '');
mcList.appendChild(h);
if (window.presetGroup) window.presetGroup.bind(h, mcId, g.group, function (nowOff) {
renderMood();
toast(nowOff ? '已停用分组：' + g.group + '（本组 ' + g.cards.length + ' 张字卡不再使用）' : '已启用分组：' + g.group);
});
g.cards.forEach(c => {
const off = typeOff(g.type || mcType, c.content);
const d = document.createElement('div');
d.className = 'cc-item glass' + (off ? ' off' : '');
d.innerHTML = '<div class="cc-txt"><div class="t">' + c.content + ' <span class="tc-known">系统</span></div></div>' +
'<span class="cc-type">' + (c.rarity === 'rare' ? '稀有' : c.rarity === 'special' ? '特殊' : '普通') + '</span>' +
'<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
mcList.appendChild(d);
d.querySelector('input').addEventListener('change', () => {
const nowOff = !d.querySelector('input').checked;
setTypeOff(g.type || mcType, c.content, nowOff);
d.classList.toggle('off', nowOff);
toastCard(c.content, nowOff);
});
});
});
}
renderTypeBar();
renderMCBar();
renderMood();
const mcSearchInput = document.getElementById('mc-search-input');
if (mcSearchInput) {
mcSearchInput.addEventListener('input', () => {
mcQ = mcSearchInput.value.trim();
renderMood();
});
mcSearchInput.addEventListener('keydown', (e) => {
if (e.key === 'Escape') { mcSearchInput.value = ''; mcQ = ''; renderMood(); mcSearchInput.blur(); }
});
}
const li = document.getElementById('li-mood-cards');
if (li) {
li.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const page = document.getElementById('page-mood-cards');
if (page) page.hidden = false;
});
}
const back = document.getElementById('mc-back');
if (back) {
back.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
}
window.getReplyCard = function () {
if (ls.get('rc-enabled') !== null && ls.get('rc-enabled') !== '1') return '';
if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(rcardProb()) : rcardProb())) return ''; // #518 套总档
const followup = DATA.followup || {};
const cats = Object.keys(followup).filter(k => followup[k] && followup[k].some(t => !rcOff(k, t)));
if (!cats.length) return '';
const cat = cats[Math.floor(Math.random() * cats.length)];
const pool = followup[cat].filter(t => !rcOff(cat, t));
return pool[Math.floor(Math.random() * pool.length)];
};
window.getFollowupWord = function (reply) {
if (ls.get('rc-enabled') !== null && ls.get('rc-enabled') !== '1') return '';
const followup = DATA.followup || {};
let cat = 'echo';
if (/[?？]/.test(reply) || /(什么|哪|怎么|为什么|吗|呢)$/.test(reply)) cat = 'probe';
else if (reply.length <= 4) cat = 'echo';
else if (/[。.]/.test(reply.slice(-1)) && reply.length > 8) cat = Math.random() < 0.5 ? 'bridge' : 'shift';
else if (reply.length > 10) cat = Math.random() < 0.5 ? 'keep' : 'probe';
else cat = Math.random() < 0.5 ? 'echo' : 'confirm';
let pool = (followup[cat] || []).filter(t => !rcOff(cat, t));
if (!pool.length && cat !== 'echo') pool = (followup['echo'] || []).filter(t => !rcOff('echo', t));
if (!pool.length) return '';
return pool[Math.floor(Math.random() * pool.length)];
};
document.addEventListener('contact-switched', function () {
emotionStreak = 0;
emotionLastTs = 0;
heartHistory = [];
specialLastTime = 0;
});
['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(function (ev) {
document.addEventListener(ev, function () { try { syncCardProbUI(); } catch (e) {} });
});
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("mood-reply-cards.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("mood-reply-cards.js"); try { console.error("[JS] mood-reply-cards.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[mood-reply-cards.js] " + String(__e && __e.message || __e)); } })();
(function () { try {
(function () {
const G = 'xy-home-v2';
const store = (typeof window.activeStore === 'function') ? window.activeStore() : null;
if (!store) return;
const PARTNER_KEYS = { type: 'birthday-type', solar: 'birthday-solar', lunar: 'birthday-lunar', leap: 'birthday-lunar-leap' };
const SELF_KEYS = { type: 'birthday-self-type', solar: 'birthday-self-solar', lunar: 'birthday-self-lunar', leap: 'birthday-self-lunar-leap' };
const SELF_CARDS_KEY = 'birthday-cards-self';
const PARTNER_CARDS_KEY = 'birthday-cards-partner';
const LEGACY_CARDS_KEY = 'birthday-cards';
const DEFAULT_SELF_CARDS = [
'生日快乐宝贝。愿你的每个愿望都实现，我每年都会陪在你身边。',
'又陪宝贝长大一岁啦。谢谢你来到我的世界，愿今天所有的甜都奔向你，也愿我永远是你最安心的归处。',
'宝贝生日快乐呀！愿你的笑容永远明亮，而我负责一直爱你、宠你、偏袒你。',
'今天是你生日，也是我最想用力拥抱你的日子。愿你平安喜乐，万事顺意，余生很长，我想一直和你一起走。',
'我的爱人，生日快乐。愿你不止今天快乐，而是每一天都被爱包围。我会努力做那个让你一想到就心安的人。',
'你是我平淡生活里的惊喜，是我所有温柔的理由，谢谢你诞生在这个世上。愿你永远被世界偏爱，也被我深深爱着。',
'又到你的生日啦，想把星星、月亮和所有好运都送给你。可想来想去，最好的礼物大概是我——会一直陪着你的我。',
'旦逢良辰，顺颂时宜。愿卿千万岁，无岁不逢春。',
'生日快乐，我的小朋友。你可以永远撒娇、永远被宠、永远做自己。我会牵着你的手，陪你把每一个明天都过成喜欢的模样。',
'今天许愿的时候，记得留一个关于我们的愿望。生日快乐宝贝，愿我们年年有今日，岁岁有彼此，长长久久不分离。'
];
const DEFAULT_PARTNER_CARDS = [
'今天我生日，宝贝准备送我什么礼物呀？',
'宝贝宝贝，今天要对我说点什么呀？',
'我今年的生日愿望就是永远陪在宝贝说身边，宝贝永远爱我。'
];
const RAIN_EMOJIS = ['🎂', '🎉', '🎈', '🧁', '👑', '✨', '🎁', '🍰'];
const CHAT_COOLDOWN_MS = 12 * 60 * 1000;
const CHAT_PROB = 40;
let currentSection = 'self';
function toast(msg) {
try { if (typeof window.toast === 'function') window.toast(msg); } catch (e) {}
}
function rootStore() {
try { return window.xyStore ? window.xyStore(G) : null; } catch (e) { return null; }
}
function storeForCid(cid) {
try {
if (window.storeForCid) return window.storeForCid(cid || 'default');
return window.xyStore ? window.xyStore(G + ':' + (cid || 'default')) : null;
} catch (e) { return null; }
}
function contacts() {
try {
const a = window.getContacts ? window.getContacts() : null;
if (Array.isArray(a) && a.length) return a;
} catch (e) {}
return [{ id: 'default', name: '默认' }];
}
function readBirthdayFrom(s, keys) {
try {
if (!s) return null;
const type = s.get(keys.type) === 'lunar' ? 'lunar' : 'solar';
const raw = s.get(type === 'lunar' ? keys.lunar : keys.solar) || '';
const parts = String(raw).split('-');
const m = parseInt(parts[0], 10);
const d = parseInt(parts[1], 10);
if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
return { type: type, month: m, day: d, leap: type === 'lunar' && s.get(keys.leap) === '1' };
} catch (e) { return null; }
}
function saveBirthdayTo(s, keys, type, m, d, leap) {
try {
if (!s) return;
const lunar = type === 'lunar';
s.set(keys.type, lunar ? 'lunar' : 'solar');
s.set(lunar ? keys.lunar : keys.solar, String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
s.set(keys.leap, lunar && leap ? '1' : '0');
} catch (e) {}
}
function readSelfBirthday() { return readBirthdayFrom(rootStore(), SELF_KEYS); }
function saveSelfBirthday(type, m, d, leap) { saveBirthdayTo(rootStore(), SELF_KEYS, type, m, d, leap); }
function readPartnerBirthday() { return readBirthdayFrom(store, PARTNER_KEYS); }
function savePartnerBirthday(type, m, d, leap) { saveBirthdayTo(store, PARTNER_KEYS, type, m, d, leap); }
function selfDisplayName() {
try {
const v = String(store.get('cs-lbl-user') || store.get('lbl-user') || '').trim();
if (v && v !== '我') return v;
} catch (e) {}
return '';
}
function partnerDisplayName(cid) {
try {
const s = storeForCid(cid);
if (s) {
const v = String(s.get('cs-lbl-partner') || '').trim();
if (v && v !== 'TA' && v !== '默认') return v;
}
const c = contacts().find(x => x.id === cid);
if (c && c.name && c.name !== '默认') return c.name;
} catch (e) {}
return '';
}
function birthdayDateInYear(b, year) {
if (!b) return null;
if (b.type === 'solar') {
const last = new Date(year, b.month, 0).getDate();
const day = Math.min(b.day, last);
return new Date(year, b.month - 1, day);
}
try {
if (window.mochiLunar && window.mochiLunar.lunarToSolar) {
return window.mochiLunar.lunarToSolar(year, b.month, b.day, !!b.leap);
}
} catch (e) {}
return null;
}
function isSameDay(a, b) {
return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function allEntries() {
const out = [];
const self = readSelfBirthday();
if (self) out.push({ kind: 'self', cid: '', name: selfDisplayName(), b: self });
contacts().forEach(c => {
const b = readBirthdayFrom(storeForCid(c.id), PARTNER_KEYS);
if (b) out.push({ kind: 'partner', cid: c.id, name: partnerDisplayName(c.id), b: b });
});
return out;
}
function todayEntries() {
const now = new Date();
return allEntries().filter(e => isSameDay(birthdayDateInYear(e.b, now.getFullYear()), now));
}
function normalizeCards(raw, defaults) {
try {
if (!Array.isArray(raw)) return null;
if (raw.some(x => typeof x === 'string')) {
return raw.map(x => typeof x === 'string' ? { t: x, def: defaults.indexOf(x) >= 0 } : (x && typeof x.t === 'string' ? { t: x.t, def: !!x.def } : null))
.filter(x => x && x.t);
}
return raw.filter(x => x && typeof x.t === 'string' && x.t).map(x => ({ t: x.t, def: !!x.def }));
} catch (e) { return null; }
}
function getCards(section) {
const isSelf = section === 'self';
const key = isSelf ? SELF_CARDS_KEY : PARTNER_CARDS_KEY;
const defaults = isSelf ? DEFAULT_SELF_CARDS : DEFAULT_PARTNER_CARDS;
const target = isSelf ? rootStore() : store;
try {
const raw = target.get(key);
if (raw) {
const arr = normalizeCards(JSON.parse(raw), defaults);
if (arr) return arr;
}
} catch (e) {}
if (isSelf) {
try {
const legacy = target.get(LEGACY_CARDS_KEY);
if (legacy) {
const arr = normalizeCards(JSON.parse(legacy), defaults);
if (arr) {
try { target.set(key, JSON.stringify(arr)); } catch (e) {}
try { target.remove(LEGACY_CARDS_KEY); } catch (e) {}
return arr;
}
}
} catch (e) {}
}
const seeded = defaults.map(t => ({ t: t, def: true }));
try { target.set(key, JSON.stringify(seeded)); } catch (e) {}
return seeded.slice();
}
function saveCards(section, arr) {
const key = section === 'self' ? SELF_CARDS_KEY : PARTNER_CARDS_KEY;
const target = section === 'self' ? rootStore() : store;
try { target.set(key, JSON.stringify(arr || [])); } catch (e) {}
}
function userNick() {
const n = selfDisplayName();
return n || '宝贝';
}
function titleFor(entry) {
if (entry.kind === 'self') return entry.name ? entry.name + '生日快乐' : '我的生日';
return (entry.name || '宝贝') + '生日快乐';
}
function subFor(entry) {
const who = entry.kind === 'self' ? '我的' : ((entry.name || '宝贝') + '的');
return '今天是' + who + (entry.b.type === 'lunar' ? '农历' : '公历') + '生日，愿这一岁被爱和好运包围。';
}
function pickCardForSection(section, random) {
const cards = getCards(section);
if (!cards.length) return null;
if (random) return cards[Math.floor(Math.random() * cards.length)];
const now = new Date();
const base = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate() + '|' + section;
let hash = 0;
for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
return cards[hash % cards.length];
}
function cardTextForSection(section, random) {
const card = pickCardForSection(section, random);
if (!card) return '';
if (card.def) {
const name = userNick();
if (name !== '宝贝') return String(card.t).split('宝贝').join(name);
}
return card.t;
}
function spawnConfetti(box) {
if (!box || !document.createElement) return;
const colors = ['#ff8aa5', '#ffb27a', '#ffd166', '#a7d8ff', '#c3f2c0', '#e3b7ff'];
for (let i = 0; i < 18; i++) {
const p = document.createElement('span');
p.className = 'bday-confetti';
p.style.left = Math.round(Math.random() * 96) + '%';
p.style.background = colors[Math.floor(Math.random() * colors.length)];
p.style.animationDuration = (1.8 + Math.random() * 1.4).toFixed(2) + 's';
p.style.animationDelay = (Math.random() * 0.9).toFixed(2) + 's';
box.appendChild(p);
(function (el) { setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3400); })(p);
}
}
function renderBanners() {
const entries = todayEntries();
const home = document.getElementById('birthday-home-stack');
const cal = document.getElementById('birthday-cal-stack');
[home, cal].forEach((box, idx) => {
if (!box) return;
box.innerHTML = '';
box.hidden = entries.length === 0;
entries.forEach(entry => {
const banner = document.createElement('div');
banner.className = 'cal-card glass birthday-banner';
const head = document.createElement('div');
head.className = 'birthday-banner-head';
const cake = document.createElement('span');
cake.className = 'birthday-banner-cake';
cake.textContent = '🎂';
const title = document.createElement('span');
title.className = 'birthday-banner-title';
title.textContent = titleFor(entry);
head.appendChild(cake);
head.appendChild(title);
const text = document.createElement('div');
text.className = 'birthday-banner-text';
text.textContent = cardTextForSection(entry.kind === 'self' ? 'self' : 'partner', false);
const sub = document.createElement('div');
sub.className = 'birthday-banner-sub';
sub.textContent = subFor(entry);
banner.appendChild(head);
banner.appendChild(text);
banner.appendChild(sub);
box.appendChild(banner);
if (idx === 0) spawnConfetti(banner);
});
});
}
function applyCalendarMarks() {
const grid = document.getElementById('cal-grid');
if (!grid) return;
const entries = allEntries();
grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
const ds = cell.getAttribute('data-date') || '';
const parts = ds.split('-');
if (parts.length !== 3) return;
const year = parseInt(parts[0], 10);
const m = parseInt(parts[1], 10);
const d = parseInt(parts[2], 10);
let on = false;
for (let i = 0; i < entries.length; i++) {
const target = birthdayDateInYear(entries[i].b, year);
if (target && target.getMonth() + 1 === m && target.getDate() === d) { on = true; break; }
}
cell.classList.toggle('birthday-day', on);
});
}
function setTypeRow(kind, type) {
const row = document.getElementById('bday-' + kind + '-type-row');
if (!row) return;
row.querySelectorAll('.mem-type-pill').forEach(btn => {
btn.classList.toggle('sel', btn.getAttribute('data-bday-type') === type);
});
}
function refreshProfileUI(kind, b) {
const type = b ? b.type : 'solar';
setTypeRow(kind, type);
const leapWrap = document.getElementById('bday-' + kind + '-leap-wrap');
if (leapWrap) leapWrap.hidden = type !== 'lunar';
const mi = document.getElementById('bday-' + kind + '-month');
const di = document.getElementById('bday-' + kind + '-day');
const li = document.getElementById('bday-' + kind + '-leap');
if (mi) mi.value = b ? b.month : '';
if (di) di.value = b ? b.day : '';
if (li) li.checked = !!(b && b.leap);
const status = document.getElementById('bday-' + kind + '-status');
if (status) {
if (!b) {
status.textContent = kind === 'self'
? '尚未设置我的生日。设置一次后，所有桌面的日历都会标记。'
: '尚未设置当前梦角的生日。每个联系人可分别设置。';
} else {
status.textContent = '已设置：' + (b.type === 'lunar' ? '农历' : '公历') + ' ' + b.month + ' 月 ' + b.day + ' 日' + (b.type === 'lunar' && b.leap ? '（闰月）' : '') + '。';
}
}
}
function initProfileUI(kind, readFn, saveFn) {
const row = document.getElementById('bday-' + kind + '-type-row');
if (row) row.addEventListener('click', e => {
const btn = e.target.closest('.mem-type-pill');
if (!btn) return;
const type = btn.getAttribute('data-bday-type') === 'lunar' ? 'lunar' : 'solar';
setTypeRow(kind, type);
const leapWrap = document.getElementById('bday-' + kind + '-leap-wrap');
if (leapWrap) leapWrap.hidden = type !== 'lunar';
const status = document.getElementById('bday-' + kind + '-status');
if (status) status.textContent = '已选择：' + (type === 'lunar' ? '农历' : '公历') + '生日。填好月、日后点保存。';
});
const save = document.getElementById('bday-' + kind + '-save');
if (save) save.addEventListener('click', () => {
const sel = row && row.querySelector('.mem-type-pill.sel');
const type = sel && sel.getAttribute('data-bday-type') === 'lunar' ? 'lunar' : 'solar';
const m = parseInt((document.getElementById('bday-' + kind + '-month') || {}).value, 10);
const d = parseInt((document.getElementById('bday-' + kind + '-day') || {}).value, 10);
const leap = !!((document.getElementById('bday-' + kind + '-leap') || {}).checked);
const maxDay = type === 'lunar' ? 30 : 31;
if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= maxDay)) { toast('请填写有效月、日（' + (type === 'lunar' ? '农历日 1-30' : '公历日 1-31') + '）'); return; }
saveFn(type, m, d, leap);
refreshProfileUI(kind, readFn());
renderBanners();
applyCalendarMarks();
applyAvatarRings();
toast(kind === 'self' ? '我的生日已保存，所有桌面的日历都会标记' : '梦角生日已保存，每年日历都会自动标记');
});
refreshProfileUI(kind, readFn());
}
function initMemoryUI() {
initProfileUI('self', readSelfBirthday, saveSelfBirthday);
initProfileUI('partner', readPartnerBirthday, savePartnerBirthday);
}
function refreshMemoryUI() {
refreshProfileUI('self', readSelfBirthday());
refreshProfileUI('partner', readPartnerBirthday());
}
function renderCardsList() {
const list = document.getElementById('bday-list');
if (!list) return;
list.innerHTML = '';
const cards = getCards(currentSection);
if (!cards.length) {
const empty = document.createElement('div');
empty.className = 'bday-empty';
empty.textContent = '还没有生日字卡，可在上方每行一句添加。';
list.appendChild(empty);
return;
}
cards.forEach((c, i) => {
const row = document.createElement('div');
row.className = 'bday-list-item';
const txt = document.createElement('div');
txt.className = 'bday-list-text';
if (c.def) {
const badge = document.createElement('span');
badge.className = 'bday-def';
badge.textContent = '初始';
txt.appendChild(badge);
}
txt.appendChild(document.createTextNode(c.t));
const del = document.createElement('button');
del.type = 'button';
del.className = 'bday-list-del';
del.textContent = '删除';
del.addEventListener('click', () => {
const cur = getCards(currentSection);
cur.splice(i, 1);
saveCards(currentSection, cur);
renderCardsList();
updateEntryCount();
});
row.appendChild(txt);
row.appendChild(del);
list.appendChild(row);
});
}
function updateEntryCount() {
const el = document.getElementById('cc-birthday-count');
if (el) el.textContent = getCards('self').length + getCards('partner').length;
}
function setCardSection(section) {
currentSection = section === 'partner' ? 'partner' : 'self';
const label = currentSection === 'self' ? '我的生日' : '梦角生日';
const tabs = document.getElementById('bday-card-tabs');
if (tabs) tabs.querySelectorAll('.cc-tab').forEach(btn => {
btn.classList.toggle('sel', btn.getAttribute('data-bday-section') === currentSection);
});
const formTitle = document.getElementById('bday-form-title');
if (formTitle) formTitle.textContent = '添加「' + label + '」祝福（每行一句）';
const listTitle = document.getElementById('bday-list-title');
if (listTitle) listTitle.textContent = label + '字卡列表';
const addBtn = document.getElementById('bday-batch-add');
if (addBtn) addBtn.textContent = '添加到' + label;
const textarea = document.getElementById('bday-batch');
if (textarea) textarea.placeholder = '每行一句，如：\n' + (currentSection === 'self' ? '生日快乐宝贝。' : '今天我生日，宝贝准备送我什么礼物呀？');
renderCardsList();
}
function initCardsPage() {
const tabs = document.getElementById('bday-card-tabs');
if (tabs) tabs.addEventListener('click', e => {
const btn = e.target.closest('.cc-tab');
if (!btn) return;
setCardSection(btn.getAttribute('data-bday-section') === 'partner' ? 'partner' : 'self');
});
const entry = document.getElementById('li-birthday-cards');
const page = document.getElementById('page-birthday-cards');
if (entry && page) entry.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
page.hidden = false;
setCardSection(currentSection);
});
const back = document.getElementById('birthday-cards-back');
if (back) back.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
const add = document.getElementById('bday-batch-add');
const textarea = document.getElementById('bday-batch');
if (add && textarea) add.addEventListener('click', () => {
const lines = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
if (!lines.length) { toast('请先输入生日祝福，每行一句'); return; }
const cur = getCards(currentSection);
lines.forEach(t => cur.push({ t: t, def: false }));
saveCards(currentSection, cur);
textarea.value = '';
renderCardsList();
updateEntryCount();
toast('已添加 ' + lines.length + ' 张生日字卡');
});
setCardSection(currentSection);
updateEntryCount();
}
function registerSearch() {
try {
window.__cardSearchFns = window.__cardSearchFns || [];
window.__cardSearchFns.push({
name: '生日字卡',
fn: function (kw) {
const out = [];
const k = String(kw || '').toLowerCase();
[['self', '我的生日'], ['partner', '梦角生日']].forEach(pair => {
getCards(pair[0]).forEach(c => {
if (!k || c.t.toLowerCase().indexOf(k) >= 0) out.push({ t: c.t, cat: pair[1] });
});
});
return out;
}
});
} catch (e) {}
}
function todayStr() {
const n = new Date();
return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}
function isBirthdayTodayFor(b) {
const now = new Date();
return isSameDay(birthdayDateInYear(b, now.getFullYear()), now);
}
function selfEntryToday() {
const b = readSelfBirthday();
if (!b || !isBirthdayTodayFor(b)) return null;
return { kind: 'self', cid: '', name: selfDisplayName(), b: b };
}
function partnerEntryToday() {
const cid = window.__activeCid || 'default';
const b = readBirthdayFrom(storeForCid(cid), PARTNER_KEYS);
if (!b || !isBirthdayTodayFor(b)) return null;
return { kind: 'partner', cid: cid, name: partnerDisplayName(cid), b: b };
}
function checkChat() {
if (!window.chatAddIn) return;
const h = new Date().getHours();
if (h >= 23 || h < 6) return;
const now = Date.now();
const self = selfEntryToday();
if (self) {
const r = rootStore();
const last = parseInt((r && r.get('birthday-self-chat-last')) || '0', 10);
if (r && (!last || now - last >= CHAT_COOLDOWN_MS) && Math.random() * 100 < CHAT_PROB) {
const text = cardTextForSection('self', true);
if (text) {
try { window.chatAddIn(text, { tag: '生日祝福', nightAllow: true }); } catch (e) {}
try { r.set('birthday-self-chat-last', String(now)); } catch (e) {}
return;
}
}
}
const partner = partnerEntryToday();
if (partner) {
const last = parseInt(store.get('birthday-partner-chat-last') || '0', 10);
if ((!last || now - last >= CHAT_COOLDOWN_MS) && Math.random() * 100 < CHAT_PROB) {
const text = cardTextForSection('partner', true);
if (text) {
try { window.chatAddIn(text, { tag: '生日祝福', nightAllow: true }); } catch (e) {}
try { store.set('birthday-partner-chat-last', String(now)); } catch (e) {}
}
}
}
}
window.birthdayCheckChat = checkChat;
function applyAvatarRings() {
const self = !!selfEntryToday();
const partner = !!partnerEntryToday();
const avUser = document.getElementById('avatar-user');
const avPartner = document.getElementById('avatar-partner');
const chatPartner = document.getElementById('chat-partner-av');
if (avUser) {
avUser.classList.toggle('bday-ring', self);
avUser.classList.toggle('bday-ring-crown', self);
}
if (avPartner) {
avPartner.classList.toggle('bday-ring', partner);
avPartner.classList.toggle('bday-ring-crown', partner);
}
if (chatPartner) {
chatPartner.classList.toggle('bday-ring', partner);
chatPartner.classList.toggle('bday-ring-crown', partner);
}
}
function birthdayEmojiRain() {
if (!selfEntryToday() && !partnerEntryToday()) return;
if (!document.body || !document.createElement) return;
try {
const old = document.getElementById('bday-emoji-rain');
if (old) old.remove();
} catch (e) {}
const layer = document.createElement('div');
layer.id = 'bday-emoji-rain';
layer.className = 'bday-emoji-rain';
for (let i = 0; i < 24; i++) {
const s = document.createElement('span');
s.className = 'bday-emoji';
s.textContent = RAIN_EMOJIS[Math.floor(Math.random() * RAIN_EMOJIS.length)];
s.style.left = Math.round(Math.random() * 100) + '%';
s.style.fontSize = Math.round(16 + Math.random() * 14) + 'px';
s.style.animationDuration = (2.6 + Math.random() * 2.2).toFixed(2) + 's';
s.style.animationDelay = (Math.random() * 0.8).toFixed(2) + 's';
layer.appendChild(s);
}
document.body.appendChild(layer);
setTimeout(() => { try { if (layer.parentNode) layer.parentNode.removeChild(layer); } catch (e) {} }, 5200);
}
function watchHomeReturn() {
const phone = document.getElementById('page-phone');
if (!phone || typeof MutationObserver === 'undefined') return;
let visible = !phone.hidden;
const mo = new MutationObserver(() => {
const nowVisible = !phone.hidden;
if (nowVisible && !visible) {
applyAvatarRings();
birthdayEmojiRain();
}
visible = nowVisible;
});
mo.observe(phone, { attributes: true, attributeFilter: ['hidden'] });
}
function refreshAll() {
renderBanners();
applyCalendarMarks();
applyAvatarRings();
refreshMemoryUI();
updateEntryCount();
}
initMemoryUI();
initCardsPage();
registerSearch();
refreshAll();
watchHomeReturn();
const grid = document.getElementById('cal-grid');
if (grid && typeof MutationObserver !== 'undefined') {
const mo = new MutationObserver(() => applyCalendarMarks());
mo.observe(grid, { childList: true, subtree: false });
}
document.addEventListener('contact-switched', refreshAll);
document.addEventListener('contact-renamed', refreshAll);
document.addEventListener('mochi-fg-resume', function () { try { checkChat(); } catch (e) {} });
setInterval(function () { try { checkChat(); } catch (e) {} }, 300000);
setTimeout(function () { try { checkChat(); } catch (e) {} }, 3000);
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("birthday.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("birthday.js"); try { console.error("[JS] birthday.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[birthday.js] " + String(__e && __e.message || __e)); } })();
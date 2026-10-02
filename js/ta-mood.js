(function () { try {
(function () {
const ls = window.activeStore();
const DATA = window.TA_MOOD_DATA || { groups: [], cards: [] };
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
function enabled() {
const v = ls.get('tm-enabled');
return v === null ? true : v === '1';
}
function isCardOff(g, c) {
if (window.presetGroup && window.presetGroup.isOff('tm', g)) return true;
return ls.get('tm-off-' + g + ':' + c) === '1';
}
function setCardOff(g, c, off) { ls.set('tm-off-' + g + ':' + c, off ? '1' : '0'); }
function getProb() {
const v = ls.get('tm-prob');
return v === null || v === '' ? 15 : Math.max(0, Math.min(100, Number(v) || 0));
}
function getCd() {
const v = ls.get('tm-cd-left');
return v === null || v === '' ? 0 : Math.max(0, Number(v) || 0);
}
function getHistory() {
try {
const v = JSON.parse(ls.get('tm-history') || '[]');
return Array.isArray(v) ? v.slice(-3) : [];
} catch (e) { return []; }
}
window.tryTaMoodShare = function () {
if (!enabled()) return null;
let cd = getCd();
if (cd > 0) {
cd--;
ls.set('tm-cd-left', String(cd));
return null;
}
if (Math.random() * 100 >= (window.dcpEff ? window.dcpEff(getProb()) : getProb())) return null; // #518 套总档（显示读点保持存盘值不动）
const groups = (DATA.groups || []).filter(g => {
return (DATA.cards || []).some(c => c.group === g.group && !isCardOff(g.group, c.content));
});
if (!groups.length) return null;
const history = getHistory();
let pool = groups;
const cooled = groups.filter(g => history.indexOf(g.group) < 0);
if (cooled.length) pool = cooled;
const total = pool.reduce((a, g) => a + Math.max(0, g.weight || 1), 0);
if (total <= 0) return null;
let roll = Math.random() * total;
let sel = pool[pool.length - 1];
for (let i = 0; i < pool.length; i++) {
roll -= Math.max(0, pool[i].weight || 1);
if (roll < 0) { sel = pool[i]; break; }
}
const cards = (DATA.cards || []).filter(c => c.group === sel.group && !isCardOff(sel.group, c.content));
if (!cards.length) return null;
const card = cards[Math.floor(Math.random() * cards.length)];
ls.set('tm-cd-left', '3');
const hist = history.concat(sel.group).slice(-3);
ls.set('tm-history', JSON.stringify(hist));
return { content: card.content, group: sel.group };
};
window.taMoodApi = {
enabled: enabled,
prob: getProb,
cdLeft: getCd,
history: getHistory,
isCardOff: isCardOff
};
const list = document.getElementById('tm-list');
const enabledEl = document.getElementById('tm-enabled');
if (!list || !enabledEl) return;
list.classList.add('preset-list'); // #1315 分组开关样式锚（与 #926 那四个列表同一份 .preset-list 规则）
enabledEl.checked = enabled();
enabledEl.addEventListener('change', () => {
ls.set('tm-enabled', enabledEl.checked ? '1' : '0');
toast(enabledEl.checked ? '已开启：TA 会偶尔分享自己的心情' : '已关闭：TA 不再主动分享心情');
});
const probRow = document.getElementById('tm-prob-val');
if (probRow) {
const stepEl = probRow.closest('.stepper');
probRow.value = String(getProb());
if (stepEl) {
const min = Number(stepEl.dataset.min) || 5;
const max = Number(stepEl.dataset.max) || 30;
const stp = Number(stepEl.dataset.step) || 5;
stepEl.querySelector('.stp-min').addEventListener('click', () => {
const v = Math.max(min, getProb() - stp);
ls.set('tm-prob', String(v));
probRow.value = String(v);
toast('TA 的心情分享概率：' + v + '%');
});
stepEl.querySelector('.stp-max').addEventListener('click', () => {
const v = Math.min(max, getProb() + stp);
ls.set('tm-prob', String(v));
probRow.value = String(v);
toast('TA 的心情分享概率：' + v + '%');
});
}
}
let tmGroup = '';
let tmQ = '';
function renderTMBar() {
const bar = document.getElementById('tm-groups-bar');
if (!bar) return;
bar.innerHTML = '';
const chips = [['', '全部']].concat((DATA.groups || []).map(g => [g.group, g.group]));
chips.forEach(([val, label]) => {
const cEl = document.createElement('span');
cEl.className = 'cc-g-chip' + (tmGroup === val ? ' sel' : '');
cEl.textContent = label;
cEl.addEventListener('click', () => { tmGroup = val; renderTMBar(); renderTM(); });
bar.appendChild(cEl);
});
}
function renderTM() {
const groups = DATA.groups || [];
let shown = groups;
if (tmGroup) shown = shown.filter(g => g.group === tmGroup);
const wMap = {};
(DATA.cards || []).forEach(c => { wMap[c.group] = (wMap[c.group] || []).concat(c); });
const flat = [];
shown.forEach(g => {
const arr = (wMap[g.group] || []).filter(c => !tmQ || c.content.indexOf(tmQ) >= 0);
if (!arr.length && !(tmQ && g.group.indexOf(tmQ) >= 0)) return;
flat.push({ header: true, gname: g.group, weight: g.weight, count: arr.length });
arr.forEach(c => flat.push({ card: c }));
});
list.innerHTML = '';
if (!flat.length) { list.innerHTML = '<div class="cc-empty">暂无心情字卡</div>'; return; }
const frag = document.createDocumentFragment();
flat.forEach(it => {
if (it.header) {
const h = document.createElement('div');
const gOff = !!(window.presetGroup && window.presetGroup.isOff('tm', it.gname));
h.className = 'cc-group-header' + (gOff ? ' off' : '');
const badge = '<span class="ccg-count" style="background:rgba(0,0,0,.03)">权重 ' + it.weight + '</span>';
h.innerHTML = window.presetGroup
? window.presetGroup.headerHTML('tm', it.gname, it.gname, it.count, badge)
: '<span class="ccg-name">' + it.gname + '</span><span class="ccg-count">' + it.count + '</span>' + badge;
frag.appendChild(h);
if (window.presetGroup) window.presetGroup.bind(h, 'tm', it.gname, function (nowOff) {
renderTM();
toast(nowOff ? '已停用分组：' + it.gname + '（本组 ' + it.count + ' 张字卡不再使用）' : '已启用分组：' + it.gname);
});
return;
}
const c = it.card;
const off = isCardOff(c.group, c.content);
const d = document.createElement('div');
d.className = 'cc-item glass' + (off ? ' off' : '');
d.innerHTML = '<div class="cc-txt"><div class="t">' + c.content + ' <span class="tc-known">系统</span></div></div>' +
'<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
frag.appendChild(d);
d.querySelector('input').addEventListener('change', () => {
const nowOff = !d.querySelector('input').checked;
setCardOff(c.group, c.content, nowOff);
d.classList.toggle('off', nowOff);
toastCard(c.content, nowOff);
});
});
list.appendChild(frag);
}
renderTMBar();
renderTM();
const searchInput = document.getElementById('tm-search-input');
if (searchInput) {
searchInput.addEventListener('input', () => {
tmQ = searchInput.value.trim();
renderTM();
});
searchInput.addEventListener('keydown', (e) => {
if (e.key === 'Escape') { searchInput.value = ''; tmQ = ''; renderTM(); searchInput.blur(); }
});
}
const li = document.getElementById('li-ta-mood');
if (li) {
li.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const page = document.getElementById('page-ta-mood');
if (page) page.hidden = false;
});
}
const back = document.getElementById('tm-back');
if (back) {
back.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
window.__cardSearchFns = window.__cardSearchFns || [];
window.__cardSearchFns.push({ name: 'TA的心情', fn: function (kw) {
const out = [];
try {
(DATA.cards || []).forEach(function (c) {
const txt = c && c.content ? c.content : '';
if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: (c.group || '') + (isCardOff(c.group, txt) ? '·已关' : '') });
});
} catch (e) {}
return out;
} });
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("ta-mood.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("ta-mood.js"); try { console.error("[JS] ta-mood.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[ta-mood.js] " + String(__e && __e.message || __e)); } })();
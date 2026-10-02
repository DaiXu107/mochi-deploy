(function () { try {
(function () {
const uid = window.activePrefix();
const store = window.activeStore();
const KEY = 'quote-cards';
const DEF_KEY = 'quote-cards-default';
function getUseDefault() {
const v = store.get(DEF_KEY);
return v === null ? true : v === '1';
}
function isQuoteOff(q) { return store.get('quote-off:' + q) === '1'; }
function setQuoteOff(q, off) { store.set('quote-off:' + q, off ? '1' : '0'); }
const DEFAULT_QUOTES = [
'我偏爱你', '我只对你这样', '过来，让我抱一下', '别走，再陪我一会儿',
'你是我的例外', '今天也很喜欢你', '你在，我就安心', '我舍不得你',
'我想和你待久一点', '你是我想留下的人', '我想把你留在身边', '你可以一直依赖我',
'不用猜，我就是喜欢你', '你对我很重要', '来我身边', '我想一直站在你这边',
'你可以多依赖我一点', '我喜欢你看着我的时候', '我喜欢你待在我身边', '你来了，我就不想走了',
'再靠近一点', '让我抱抱你', '今天也想见你', '我想陪着你',
'我希望你一直在', '你可以把我当成你的归处', '我想成为你最先想到的人', '我想把我的偏爱都给你',
'你不用和任何人比较', '在我这里，你一直是特别的', '我怎么可能舍得丢下你', '你回来，我就高兴',
'我等你，不是因为没事做', '我只是想陪你', '我喜欢你需要我的样子', '你不用一个人撑着',
'累了就来找我', '不管什么时候，你都可以来找我', '我想听你多说一会儿', '我还想和你聊很久',
'今天也想把时间留给你', '我有很多话想告诉你', '其实我一直都在想你', '你不在的时候，我会想你',
'我喜欢你在我身边的感觉', '只要是你，久一点也没关系'
];
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
(function cleanLegacyPresetInCustom() {
try {
const MK = 'quote-mine-clean-v1';
if (store.get(MK) === '1') return;
let raw = null;
try { raw = JSON.parse(store.get(KEY) || 'null'); } catch (e) { raw = null; }
if (Array.isArray(raw)) {
const cleaned = raw.filter(x => {
const t = x && typeof x === 'object' ? x.t : x;
return !(t != null && DEFAULT_QUOTES.indexOf(String(t)) >= 0);
});
if (cleaned.length !== raw.length) store.set(KEY, JSON.stringify(cleaned));
}
store.set(MK, '1');
} catch (e) {}
})();
const GRP_KEY = 'quote-cards-groups';
function getGroups() {
try {
const v = JSON.parse(store.get(GRP_KEY) || 'null');
if (Array.isArray(v)) return v;
} catch (e) {}
return [];
}
function saveGroups(groups) { store.set(GRP_KEY, JSON.stringify(groups)); }
function hasCustom() {
try {
const v = JSON.parse(store.get(KEY) || 'null');
return Array.isArray(v) && v.length > 0;
} catch (e) { return false; }
}
function getQuotes() {
try {
const v = JSON.parse(store.get(KEY) || 'null');
if (Array.isArray(v) && v.length) return v.map(x => typeof x === 'string' ? x : (x && x.t != null ? String(x.t) : null)).filter(Boolean);
} catch (e) {}
return DEFAULT_QUOTES.slice();
}
function getCustom() {
try {
const v = JSON.parse(store.get(KEY) || 'null');
if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? { t: x } : (x && typeof x === 'object' && x.t != null ? x : null)).filter(Boolean);
} catch (e) {}
return [];
}
let qcQueue = [], qcBusy = false, qcTry = 0, qcAuth = false;
function qcFullKey() { return (window.activePrefix ? window.activePrefix() : 'xy-home-v2:default') + ':' + KEY; }
function qcRun() {
const ops = qcQueue; qcQueue = [];
let out = getCustom();
try { ops.forEach(op => { const r = op(out); if (Array.isArray(r)) out = r; }); } catch (e) { return false; }
store.set(KEY, JSON.stringify(out));
try { renderMineList(); updateEntryCount(); } catch (e) {}
return true;
}
function qcFlush() {
if (qcBusy || !qcQueue.length) return;
if (!window.xyPackageEmptyRead || !window.xyPackageEmptyRead(store, KEY) || qcAuth) { qcRun(); return; }
if (!window.idbHydrateKey) { qcRun(); return; } // 没有 IDB 这一层＝同步层就是全部真相
qcBusy = true;
window.idbHydrateKey(qcFullKey()).then(ok => {
qcBusy = false;
if (ok === false) {
if (qcTry < 4) {
qcTry++;
try { window.__qcBlindHold = (window.__qcBlindHold || 0) + 1; } catch (e) {}
setTimeout(qcFlush, 1500 * qcTry);
} else { qcQueue = []; try { window.__qcBlindDrop = (window.__qcBlindDrop || 0) + 1; } catch (e2) {} }
return;
}
qcAuth = true; // true＝库里那一本已灌回同步层；null＝健康连接确认没有——两者之后「空」才是答案
qcTry = 0; qcFlush();
}, () => {
qcBusy = false;
if (qcTry < 4) {
qcTry++;
try { window.__qcBlindHold = (window.__qcBlindHold || 0) + 1; } catch (e) {}
setTimeout(qcFlush, 1500 * qcTry);
} else { qcQueue = []; try { window.__qcBlindDrop = (window.__qcBlindDrop || 0) + 1; } catch (e2) {} }
});
}
function qcWrite(op) {
qcQueue.push(op);
qcFlush();
return !qcQueue.length;
}
window.getQuoteOfDay = function () {
const useDefault = getUseDefault();
const custom = getCustom();
let quotes = null;
if (useDefault) quotes = (custom.length ? custom.map(c => c.t) : DEFAULT_QUOTES.filter(q => !isQuoteOff(q))).filter(q => !isQuoteOff(q));
else quotes = custom.map(c => c.t).filter(q => !isQuoteOff(q)); // 只用自己的
if (!quotes.length) return '';
const d = new Date();
const today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
const seedBase = today + '|' + (window.activePrefix ? window.activePrefix() : 'default');
let hash = 0;
for (let i = 0; i < seedBase.length; i++) hash = (hash * 31 + seedBase.charCodeAt(i)) >>> 0;
return quotes[hash % quotes.length];
};
window.quoteCardCount = function () { return getQuotes().length; };
function isDefaultQuote(q) { return DEFAULT_QUOTES.indexOf(q) >= 0; }
function updateEntryCount() {
const useDefault = getUseDefault();
const custom = getCustom();
const sysN = useDefault ? DEFAULT_QUOTES.filter(q => !isQuoteOff(q)).length : 0;
const cnt = document.getElementById('cc-quote-count');
if (cnt) cnt.textContent = sysN;
const cntM = document.getElementById('cc-quote-count-mine');
if (cntM) cntM.textContent = custom.length;
}
window.quoteCardsRefreshCounts = updateEntryCount;
function renderSysList() {
const el = document.getElementById('cq-sys-list');
if (!el) return;
const useDefault = getUseDefault();
const defEl = document.getElementById('cq-default');
if (defEl) defEl.checked = useDefault;
el.innerHTML = '';
if (!useDefault) {
const tip = document.createElement('div');
tip.className = 'ta-empty';
tip.textContent = '系统预设情话已关闭（桌面今日情话只从「我的添加」里抽取）。开启上方开关即可恢复使用。';
el.appendChild(tip);
return;
}
DEFAULT_QUOTES.forEach(q => {
const off = isQuoteOff(q);
const row = document.createElement('div');
row.className = 'tc-qrow' + (off ? ' off' : '');
row.innerHTML = '<div class="tc-qmain"><div class="tc-qtext">' + esc(q) + ' <span class="tc-known">系统</span></div></div>';
const lab = document.createElement('label');
lab.className = 'toggle ccard-toggle';
lab.innerHTML = '<input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span>';
lab.querySelector('input').addEventListener('change', () => {
const nowOff = !lab.querySelector('input').checked;
setQuoteOff(q, nowOff);
renderSysList();
updateEntryCount();
const s = String(q == null ? '' : q);
toast((nowOff ? '已关闭：' : '已开启：') + (s.length > 18 ? s.slice(0, 18) + '…' : s));
});
row.appendChild(lab);
el.appendChild(row);
});
}
function renderMineList() {
const el = document.getElementById('cq-mine-list');
if (!el) return;
const groups = getGroups();
const custom = getCustom();
let html = '';
html += '<div class="mg-grp-row"><button class="cc-tool mg-grp-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>新建分组</button></div>';
if (!custom.length && !groups.length) {
html += '<div class="ta-empty">暂未添加自定义情话，可在上方批量输入（每行一句）。</div>';
el.innerHTML = html;
bindCqGroupOps();
return;
}
groups.forEach(g => {
const arr = custom.filter(x => x.grp === g.id);
html += '<div class="cal-card glass mg-block">' +
'<div class="cal-card-title mg-title"><span class="mg-name">' + esc(g.name) + '</span><span class="mg-cnt">(' + arr.length + ')</span>' +
'<span class="mg-ops"><button class="mg-op" data-g="' + esc(g.id) + '" data-op="rn" title="重命名">✎</button><button class="mg-op" data-g="' + esc(g.id) + '" data-op="rm" title="删除分组">✕</button></span></div>' +
(arr.length ? arr.map(x => cqItemHtml(x, custom.indexOf(x))).join('') : '<div class="ta-empty">这个分组还没有内容</div>') +
'</div>';
});
const ungrouped = custom.filter(x => !x.grp);
html += '<div class="cal-card glass mg-block mg-ungrouped"><div class="cal-card-title mg-title"><span class="mg-name">未分组</span><span class="mg-cnt">(' + ungrouped.length + ')</span></div>';
if (!ungrouped.length) html += '<div class="ta-empty">暂无未分组情话，可在上方批量输入</div>';
html += ungrouped.map(x => cqItemHtml(x, custom.indexOf(x))).join('');
html += '</div>';
el.innerHTML = html;
el.querySelectorAll('.ta-del').forEach(b => {
b.addEventListener('click', () => {
const target = getCustom()[Number(b.dataset.idx)];
if (!target) return;
const landed = qcWrite(function (arr) {
let gone = false;
return arr.filter(x => {
if (!gone && x.t === target.t && String(x.grp || '') === String(target.grp || '')) { gone = true; return false; }
return true;
});
});
toast(landed ? '已删除' : '正在取回本地库存，稍等会自动删除');
});
});
bindCqGroupOps();
}
function cqItemHtml(x, idx) {
return '<div class="tc-qrow"><div class="tc-qmain"><div class="tc-qtext">' + esc(x.t) + '</div></div>' +
'<button class="ta-del" data-idx="' + idx + '">✕</button></div>';
}
function bindCqGroupOps() {
const wrap = document.getElementById('cq-mine-list');
if (!wrap) return;
wrap.querySelectorAll('.mg-grp-add').forEach(b => {
if (b.__bound) return;
b.__bound = true;
b.addEventListener('click', () => {
const groups = getGroups();
window.cardGroups.addFlow(groups, g => {
if (!g) return;
saveGroups(groups);
refreshGrpSelect();
renderMineList();
toast('已新建分组「' + g.name + '」');
});
});
});
wrap.querySelectorAll('.mg-op').forEach(b => {
if (b.__bound) return;
b.__bound = true;
b.addEventListener('click', () => {
const groups = getGroups();
const gid = b.dataset.g;
const g = groups.find(x => x.id === gid);
if (!g) return;
if (b.dataset.op === 'rn') {
window.cardGroups.renameFlow(g, groups, name => {
if (!name) return;
saveGroups(groups);
refreshGrpSelect();
renderMineList();
toast('分组已重命名');
});
} else if (b.dataset.op === 'rm') {
window.cardGroups.removeFlow(g.name, ok => {
if (!ok) return;
const landed = qcWrite(function (arr) {
arr.forEach(x => { if (x.grp === gid) x.grp = ''; });
return arr;
});
saveGroups(groups.filter(x => x.id !== gid));
refreshGrpSelect();
if (!landed) toast('正在取回本地库存，稍等会自动清除该组内容');
renderMineList();
toast('已删除分组「' + g.name + '」');
});
}
});
});
}
function refreshGrpSelect() {
if (!window.cardGroups) { setTimeout(refreshGrpSelect, 50); return; }
const grpSel = document.getElementById('cq-batch-grp');
if (!grpSel) return;
const groups = getGroups();
grpSel.innerHTML = window.cardGroups.grpOnlyOptsHtml(groups, grpSel.value);
window.cardGroups.bindNewGrp(grpSel, groups, function () { saveGroups(groups); });
}
let curTab = 'sys';
function switchTab(tab) {
curTab = tab;
const tabsWrap = document.getElementById('cq-tabs');
if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
const sysPanel = document.getElementById('cq-sys-panel');
const minePanel = document.getElementById('cq-mine-panel');
if (sysPanel) sysPanel.hidden = tab !== 'sys';
if (minePanel) minePanel.hidden = tab !== 'mine';
if (tab === 'sys') renderSysList(); else renderMineList();
}
const batchAdd = document.getElementById('cq-batch-add');
if (batchAdd) {
refreshGrpSelect();
batchAdd.addEventListener('click', () => {
const ta = document.getElementById('cq-batch');
const raw = ta ? ta.value : '';
const items = raw.split('\n').map(s => s.trim()).filter(Boolean);
if (!items.length) { toast('请输入内容，每行一句'); return; }
const grpSel = document.getElementById('cq-batch-grp');
const parsed = window.cardGroups.parseCatVal(grpSel ? grpSel.value : '');
if (!parsed) { toast('请先选择分组'); return; }
const landed = qcWrite(function (arr) {
items.forEach(it => {
const x = { t: it };
if (parsed.grp) x.grp = parsed.grp;
arr.push(x);
});
return arr;
});
if (ta) ta.value = '';
renderMineList();
updateEntryCount();
toast(landed ? '已添加 ' + items.length + ' 句今日情话' : '正在取回本地库存，稍等会自动添加 ' + items.length + ' 句');
});
}
const cqNewGrp = document.getElementById('cq-new-grp');
if (cqNewGrp) {
cqNewGrp.addEventListener('click', () => {
const groups = getGroups();
window.cardGroups.addFlow(groups, g => {
if (!g) return;
saveGroups(groups);
refreshGrpSelect();
renderMineList();
toast('已新建分组「' + g.name + '」');
});
});
}
const cqDefault = document.getElementById('cq-default');
if (cqDefault) {
cqDefault.addEventListener('change', () => {
store.set(DEF_KEY, cqDefault.checked ? '1' : '0');
renderSysList();
updateEntryCount();
toast(cqDefault.checked ? '系统预设情话已开启' : '系统预设情话已关闭（仅用你添加的情话）');
});
}
const tabsWrap = document.getElementById('cq-tabs');
if (tabsWrap) {
tabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});
}
const liQuote = document.getElementById('li-quote-cards');
const quotePage = document.getElementById('page-quote-cards');
if (liQuote && quotePage) {
liQuote.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
quotePage.hidden = false;
const tw = document.getElementById('cq-tabs'); if (tw) tw.style.display = 'none';
switchTab('sys');
});
}
const liQuoteMine = document.getElementById('li-quote-cards-mine');
if (liQuoteMine && quotePage) {
liQuoteMine.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
quotePage.hidden = false;
const tw = document.getElementById('cq-tabs'); if (tw) tw.style.display = 'none';
switchTab('mine');
});
}
const quoteBack = document.getElementById('quote-cards-back');
if (quoteBack) {
quoteBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
switchTab('sys');
updateEntryCount();
window.__cardSearchFns = window.__cardSearchFns || [];
window.__cardSearchFns.push({ name: '桌面今日情话', fn: function (kw) {
const out = [];
try {
(DEFAULT_QUOTES || []).forEach(function (q) { if (q && String(q).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(q), cat: '系统预设' }); });
(getCustom() || []).forEach(function (x) { const txt = x && x.t ? x.t : ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: '我的添加' }); });
} catch (e) {}
return out;
} });
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("quote-cards.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("quote-cards.js"); try { console.error("[JS] quote-cards.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[quote-cards.js] " + String(__e && __e.message || __e)); } })();
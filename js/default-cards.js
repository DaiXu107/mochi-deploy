(function () { try {
(function () {
try {
for (let i = localStorage.length - 1; i >= 0; i--) {
const k = localStorage.key(i);
if (k && /^xy-home-v2:(?:[^:]+:)?dc-cat-dict$/.test(k)) localStorage.removeItem(k);
}
} catch (e) {}
try {
if (window.idbGetAllKeys && window.idbDelete) {
window.idbGetAllKeys().then(function (keys) {
(keys || []).forEach(function (k) {
if (/^xy-home-v2:(?:[^:]+:)?dc-cat-dict$/.test(k)) { try { window.idbDelete(k); } catch (e) {} }
});
}).catch(function () {});
}
} catch (e) {}
})();
(function () {
(function presetSizeHints() {
const tip = window.mochiPresetSizeTip;
if (!tip) return;
['dc-size-hint', 'dict-size-hint'].forEach(function (id) {
const el = document.getElementById(id);
if (el) el.textContent = tip;
});
})();
const list = document.getElementById('dc-list');
const tabsWrap = document.getElementById('dc-tabs');
const enabledEl = document.getElementById('dc-enabled');
if (!list || !tabsWrap || !enabledEl) return;
const uid = window.activePrefix();
const ls = window.activeStore();
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
const GOFF_KEY = 'dc-groups-off';
let goffRaw = null;   // 单格缓存：读到的原始值没变才复用解析结果（切桌面读到另一桌面的值＝自动重解析）
let goffObj = null;
const goffExp = {};   // 分类 -> { src, names, set }：停用组内文案展开；没有分组停用时不建、不占内存
function groupOffRecord(st) {
let raw = null;
try { raw = st.get(GOFF_KEY); } catch (e) { return null; }
if (raw === goffRaw) return goffObj;
let o = null;
try {
if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) o = p; }
} catch (e) {}
goffRaw = raw; goffObj = o;
return o;
}
function groupOffTexts(cat, names) {
const src = DATA[cat] || [];
const e = goffExp[cat];
if (e && e.src === src && e.names === names) return e.set;
const kill = new Set(names), set = new Set();
src.forEach(g => { if (kill.has(g[0])) (g[1] || []).forEach(c => set.add(c)); });
goffExp[cat] = { src, names, set };
return set;
}
function groupOffFor(cat, c, st) {
const o = groupOffRecord(st);
const names = o && o[cat];
return !!(names && names.length) && groupOffTexts(cat, names).has(c);
}
const PG_KEY = 'pg-groups-off';
let pgRaw = null, pgObj = null;   // 单格缓存：原始值没变才复用解析结果（切桌面＝自动重解析）
function pgRecord(st) {
let raw = null;
try { raw = (st || ls).get(PG_KEY); } catch (e) { return null; }
if (raw === pgRaw) return pgObj;
let o = null;
try {
if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) o = p; }
} catch (e) {}
pgRaw = raw; pgObj = o;
return o;
}
function pgIsOff(id, grp, st) {
const o = pgRecord(st);
const names = o && o[id];
return !!(names && names.indexOf(grp) >= 0);
}
function pgSet(id, grp, off) {
const cur = pgRecord(ls) || {};
const arr = (cur[id] || []).slice();
const i = arr.indexOf(grp);
if (off && i < 0) arr.push(grp);
if (!off && i >= 0) arr.splice(i, 1);
const next = {};
Object.keys(cur).forEach(k => { if (k !== id && Array.isArray(cur[k]) && cur[k].length) next[k] = cur[k].slice(); });
if (arr.length) next[id] = arr;
ls.set(PG_KEY, JSON.stringify(next));
}
function pgNames(id) {
const o = pgRecord(ls);
const names = o && o[id];
return Array.isArray(names) ? names.slice() : [];
}
function pgSwitchHTML(off) {
return '<label class="toggle ccard-toggle ccg-switch" title="' + (off ? '启用该分组' : '停用该分组') + '">' +
'<input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
}
function pgOffTag(off) { return off ? '<em class="ccg-off-tag">已停用</em>' : ''; }
function pgWire(scopeEl, id, grp, onChange) {
if (!scopeEl) return;
const input = scopeEl.querySelector('.ccg-switch input');
if (!input) return;
input.addEventListener('change', () => {
const nowOff = !input.checked;
pgSet(id, grp, nowOff);
if (typeof onChange === 'function') onChange(nowOff, grp);
});
}
function pgCatBar(id, grp, label) {
const off = pgIsOff(id, grp);
return '<div class="set-group glass preset-cat-bar"><div class="gs-row"><span>整组停用「' + label + '」' +
pgOffTag(off) + '</span>' + pgSwitchHTML(off) + '</div></div>';
}
window.presetGroup = {
KEY: PG_KEY,
isOff: pgIsOff,
set: pgSet,
names: pgNames,
switchHTML: pgSwitchHTML,
offTag: pgOffTag,
bind: pgWire,
bindBar: pgWire,   // 分组头与整类停用条用的是同一形态（.ccg-switch），两个名字都给，调用方按语义读
catBar: pgCatBar,
headerHTML: function (id, grp, label, count, extra) {
const off = pgIsOff(id, grp);
return '<span class="ccg-name">' + label + pgOffTag(off) + '</span><span class="ccg-count">' + count + '</span>' +
(extra || '') + pgSwitchHTML(off);
}
};
function apiFor(st) {
const gE = function () { const v = st.get('dc-enabled'); return v === null ? true : v === '1'; };
const gO = function () { const v = st.get('dc-overall'); return v === null ? 30 : Number(v); };
const gOS = function (k) { const v = st.get('dc-overall-' + k); return v === null ? gO() : Number(v); };
const gP = function (k) { const v = st.get('dc-prob-' + k); return v === null ? 25 : Number(v); };
const gU = function (k) { const v = st.get('dc-use-' + k); return v === null ? true : v === '1'; };
const gC = function (k) { const v = st.get('dc-cat-' + k); return v === null ? true : v === '1'; };
const gOff = function (cat, c) {
if (st.get('dc-off-' + cat + ':' + c) === '1') return true;
return groupOffFor(cat, c, st);
};
return {
enabled: gE,
overall: gO,
overallFor: gOS,
prob: gP,
use: gU,
cat: gC,
isOff: gOff,
cfg: function () {
return { enabled: gE(), overall: gO(), overallFor: gOS, probs: { main: gP('main'), kaomoji: gP('kaomoji'), emoji: gP('emoji'), touch: gP('touch') } };
}
};
}
const api = apiFor(ls);
function getEnabled() { return api.enabled(); }
function getOverall() { return api.overall(); }
function getProb(k) { return api.prob(k); }
function getUse(k) { return api.use(k); }
function setUse(k, on) { ls.set('dc-use-' + k, on ? '1' : '0'); }
window.defaultCardUse = function (k) { return getUse(k); };
function getCat(k) { return api.cat(k); }
function setCat(k, on) { ls.set('dc-cat-' + k, on ? '1' : '0'); }
window.defaultCardCat = function (k) { return getCat(k); };
window.defaultCardCfg = function () { return api.cfg(); };
window.defaultCardApiFor = apiFor;
const DATA = (window.DEFAULT_CARD_DATA) || { main: [], kaomoji: [], emoji: [] };
const LOCKED = () => !(window.cardLockOpen && window.cardLockOpen());
function dedupeCardGroups(groups, cross) {
const across = cross ? new Set() : null;
(groups || []).forEach(function (g) {
if (!g || !Array.isArray(g[1])) return;
const seen = across || new Set();
const out = [];
g[1].forEach(function (c) {
if (typeof c !== 'string') { out.push(c); return; }
if (seen.has(c)) return;
seen.add(c);
out.push(c);
});
g[1] = out;
});
return groups;
}
Object.keys(DATA).forEach(function (k) {
if (k !== 'dict' && Array.isArray(DATA[k])) dedupeCardGroups(DATA[k], k === 'main');
});
const DICT_CUST_QKEY = 'dict-custom-quotes';
const DICT_CUST_WKEY = 'dict-custom-words';
const PRESET_DICT = (DATA.dict || []).concat(DATA.dict_ext || []).map(g => [g[0], (g[1] || []).slice()]);
function dictCustRead(key) {
try {
const raw = window.xyStore('xy-home-v2').get(key);
const arr = raw ? JSON.parse(raw) : [];
return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x) : [];
} catch (e) { return []; }
}
function dictCustWrite(key, arr) {
try { window.xyStore('xy-home-v2').set(key, JSON.stringify(arr)); } catch (e) {}
}
function mergeDictCustom() {
try {
const qs = dictCustRead(DICT_CUST_QKEY);
const ws = dictCustRead(DICT_CUST_WKEY);
const base = PRESET_DICT.map(g => [g[0], g[1].slice()]);
const gq = base.find(g => g[0] === '语录');
if (gq) gq[1] = gq[1].concat(qs);
else if (qs.length) base.push(['语录·自建', qs.slice()]);
const gw = base.find(g => g[0].indexOf('词库') === 0);
if (gw) gw[1] = gw[1].concat(ws);
else if (ws.length) base.push(['词库·自建', ws.slice()]);
DATA.dict = dedupeCardGroups(base, true);
window.__dictCustomSet = new Set(qs.concat(ws));
} catch (e) {}
}
mergeDictCustom();
function dictCustomAdd(kind, text) {
const v = String(text == null ? '' : text).replace(/\s+/g, '');
if (!v) return { ok: false, msg: '内容为空，先输入再保存' };
if (v.indexOf('data:') === 0 || v.indexOf('|||') >= 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(v))) return { ok: false, msg: '该内容不能作为词典词条' }; // FIX 2026-09-13 #394 媒体池令牌串不得进词典
const pref = kind === 'quote' ? '语录' : '词库';
const dupPreset = PRESET_DICT.some(g => g[0].indexOf(pref) === 0 && g[1].indexOf(v) >= 0);
if (dupPreset) return { ok: false, msg: '内置词典已有这条' };
const key = kind === 'quote' ? DICT_CUST_QKEY : DICT_CUST_WKEY;
const arr = dictCustRead(key);
if (arr.indexOf(v) >= 0) return { ok: false, msg: '已存在这条自建词条' };
arr.push(v);
dictCustWrite(key, arr);
mergeDictCustom();
try { if (window.quoteSpellResetDict) window.quoteSpellResetDict(); } catch (e) {}
return { ok: true, msg: (kind === 'quote' ? '已存为语录：' : '已存为词：') + v };
}
function dictCustomRemove(text) {
const v = String(text == null ? '' : text).replace(/\s+/g, '');
if (!v) return false;
let n = 0;
[DICT_CUST_QKEY, DICT_CUST_WKEY].forEach(k => {
const arr = dictCustRead(k);
const i = arr.indexOf(v);
if (i >= 0) { arr.splice(i, 1); dictCustWrite(k, arr); n++; }
});
if (n) {
mergeDictCustom();
try { if (window.quoteSpellResetDict) window.quoteSpellResetDict(); } catch (e) {}
}
return n > 0;
}
const FUNC_KEYS = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music'];
const BASE_KEYS = ['main', 'kaomoji', 'emoji', 'touch'];
const ALL_KEYS = BASE_KEYS.concat(FUNC_KEYS);
const TAB_LABELS = (function () {
const m = {};
['dc-tabs', 'fc-tabs'].forEach(function (id) {
const w = document.getElementById(id);
if (!w) return;
w.querySelectorAll('.cc-tab[data-type]').forEach(function (t) { m[t.dataset.type] = t.textContent.trim(); });
});
return m;
})();
function tabLabel(k) { return TAB_LABELS[k] || k; }
function sumKeys(keys) {
let n = 0;
keys.forEach(k => { (DATA[k] || []).forEach(g => { n += Array.isArray(g[1]) ? g[1].length : 0; }); });
return n;
}
function refreshLibCount() {
const el = document.getElementById('dc-lib-count');
if (el) el.textContent = String(sumKeys(BASE_KEYS));
const del = document.getElementById('dc-dict-count');
if (del) del.textContent = String(sumKeys(['dict']));
const fel = document.getElementById('fc-lib-count');
if (fel) fel.textContent = String(sumKeys(FUNC_KEYS));
const dkel = document.getElementById('dk-lib-count');
if (dkel) dkel.textContent = String(sumKeys(['deskcheck']));
}
refreshLibCount();
function isCardOff(cat, c) { return api.isOff(cat, c); }
function setCardOff(cat, c, off) { ls.set('dc-off-' + cat + ':' + c, off ? '1' : '0'); }
window.isDefaultCardOff = function (cat, c) { return isCardOff(cat, c); };
function isGroupOff(cat, gname) {
const o = groupOffRecord(ls);
const names = o && o[cat];
return !!(names && names.indexOf(gname) >= 0);
}
function setGroupOff(cat, gname, off) {
const cur = groupOffRecord(ls) || {};
const arr = (cur[cat] || []).slice();
const i = arr.indexOf(gname);
if (off && i < 0) arr.push(gname);
if (!off && i >= 0) arr.splice(i, 1);
const next = {};
Object.keys(cur).forEach(k => { if (k !== cat && Array.isArray(cur[k]) && cur[k].length) next[k] = cur[k].slice(); });
if (arr.length) next[cat] = arr;
ls.set(GOFF_KEY, JSON.stringify(next));
}
let cur = 'main';
let q = '';
enabledEl.checked = getEnabled();
enabledEl.addEventListener('change', () => {
ls.set('dc-enabled', enabledEl.checked ? '1' : '0');
toast(enabledEl.checked ? '已开启：使用系统预设字卡' : '已关闭：使用系统预设字卡');
});
[['chat', '聊天'], ['mail', '信箱'], ['feed', '朋友圈']].forEach(([k, label]) => {
const el = document.getElementById('dc-use-' + k);
if (!el) return;
el.checked = getUse(k);
el.addEventListener('change', () => {
setUse(k, el.checked);
toast((el.checked ? '已开启' : '已关闭') + '：默认字卡' + label + '使用');
});
});
(function () {
const row = document.getElementById('dc-use-feed');
if (!row) return;
const grp = row.closest('.set-group');
if (!grp || document.getElementById('dc-scope-note')) return;
const note = document.createElement('div');
note.id = 'dc-scope-note';
note.style.cssText = 'margin:8px 12px 10px;font-size:11px;line-height:1.6;color:#999;';
note.textContent = '以上开关按当前桌面对应的联系人独立保存：当当前桌面联系人关闭【聊天使用】，聊天和群聊里这个联系人也无法使用默认字卡（其他联系人不受影响）。\n下方字卡列表里，每个分组标题右侧的开关是「整组停用/启用」——停用后本组字卡全部不再使用，组内每张卡自己的开关一字不改，重新启用分组即恢复原样。';
note.style.whiteSpace = 'pre-line';
grp.parentNode.insertBefore(note, grp.nextSibling);
})();
[['main', '主字卡'], ['kaomoji', '颜文字'], ['emoji', 'emoji'], ['touch', '拍一拍']].forEach(([k, label]) => {
const el = document.getElementById('dc-cat-' + k);
if (!el) return;
el.checked = getCat(k);
el.addEventListener('change', () => {
setCat(k, el.checked);
toast((el.checked ? '已开启' : '已关闭') + '：默认字卡' + label + '使用');
});
});
const DC_OVERALL_DEF = { chat: 30, mail: 30, feed: 100 };
function dcOverallVal(k) { const v = ls.get('dc-overall-' + k); return v === null ? DC_OVERALL_DEF[k] : Number(v); }
function dcOverallSet(k, nv) { ls.set('dc-overall-' + k, String(nv)); }
[['chat', '聊天'], ['mail', '写信'], ['feed', '朋友圈']].forEach(([k, label]) => {
const box = document.getElementById('dc-overall-' + k);
const valEl = document.getElementById('dc-overall-' + k + '-val');
if (!box || !valEl) return;
valEl.value = String(dcOverallVal(k));
box.querySelector('.stp-min').addEventListener('click', () => {
const nv = Math.max(0, (parseInt(valEl.value, 10) || 0) - 5);
valEl.value = String(nv); dcOverallSet(k, nv);
toast('默认字卡' + label + '使用概率：' + nv + '%');
});
box.querySelector('.stp-max').addEventListener('click', () => {
const nv = Math.min(100, (parseInt(valEl.value, 10) || 0) + 5);
valEl.value = String(nv); dcOverallSet(k, nv);
toast('默认字卡' + label + '使用概率：' + nv + '%');
});
});
function dcProbSet(k, nv) { ls.set('dc-prob-' + k, String(nv)); }
[['main', '主字卡'], ['kaomoji', '颜文字'], ['emoji', 'emoji'], ['touch', '拍一拍']].forEach(([k, label]) => {
const box = document.getElementById('dc-prob-' + k);
const valEl = document.getElementById('dc-prob-' + k + '-val');
if (!box || !valEl) return;
valEl.value = String(getProb(k));
box.querySelector('.stp-min').addEventListener('click', () => {
const nv = Math.max(0, (parseInt(valEl.value, 10) || 0) - 5);
valEl.value = String(nv); dcProbSet(k, nv);
toast('默认字卡' + label + '占比：' + nv + '%');
});
box.querySelector('.stp-max').addEventListener('click', () => {
const nv = Math.min(100, (parseInt(valEl.value, 10) || 0) + 5);
valEl.value = String(nv); dcProbSet(k, nv);
toast('默认字卡' + label + '占比：' + nv + '%');
});
});
function mountSetTabs(barId, panelPrefix, keys) {
const bar = document.getElementById(barId);
if (!bar) return;
let openKey = '';
function apply(key) {
openKey = key || '';
keys.forEach(function (k) {
const el = document.getElementById(panelPrefix + k);
if (el) el.hidden = (k !== openKey);
});
bar.querySelectorAll('.dc-set-tab[data-dcset]').forEach(function (b) {
b.classList.toggle('active', b.dataset.dcset === openKey);
});
}
bar.addEventListener('click', function (e) {
const b = e.target && e.target.closest ? e.target.closest('.dc-set-tab[data-dcset]') : null;
if (!b) return;
apply(b.dataset.dcset === openKey ? '' : b.dataset.dcset);
});
apply('');
}
mountSetTabs('dc-set-tabs', 'dc-set-', ['scene', 'prob', 'cat']);
mountSetTabs('dict-set-tabs', 'dict-set-', ['use', 'prob']);
const DCF_DEF = { fish: 35, eat: 35, period: 25, water: 35, garden: 40, sync: 60, reach: 55, cjian: 100, room: 100, piggy: 100, drift: 100, interact: 100, music: 100, deskcheck: 50, checkin: 100, pomo: 100, care: 100, memo: 100, ask: 100 };
const DCF_DEF_NAME = { fish: '摸鱼', eat: '吃饭', period: '经期', water: '喝水', garden: '花园', sync: '同频', reach: '伸手', cjian: '此间', room: '房间', piggy: '存钱罐', drift: '漂流瓶', interact: '互动回应', music: '音乐', deskcheck: '跨桌面查岗', checkin: '寻踪日常', pomo: '番茄钟', care: 'TA的关心', memo: '备忘提醒', ask: 'TA主动提问' };
function dcfEnabled() {
try { const v = window.activeStore().get('dcf-enabled'); return v === null ? true : v === '1'; } catch (e) { return true; }
}
function dcfEnableSet(on) { try { window.activeStore().set('dcf-enabled', on ? '1' : '0'); } catch (e) {} }
window.dcfEnabled = dcfEnabled;
function dcfVal(k) {
if ((FUNC_KEYS.indexOf(k) >= 0 || k === 'checkin' || k === 'pomo' || k === 'care' || k === 'memo' || k === 'ask') && !dcfEnabled()) return 0;
if (!(k in DCF_DEF)) return 100;
try { const v = window.activeStore().get('dcf-' + k); if (v !== null && v !== undefined) { const n = Number(v); if (!isNaN(n)) return Math.max(0, Math.min(100, n)); } } catch (e) {}
return DCF_DEF[k];
}
function dcfEffGet(k) { return window.dcpEff ? window.dcpEff(dcfVal(k)) : dcfVal(k); }
window.dcfGet = dcfEffGet;
(function () {
const el = document.getElementById('dcf-enabled');
if (!el) return;
el.checked = dcfEnabled();
el.addEventListener('change', () => {
dcfEnableSet(el.checked);
toast((el.checked ? '已开启' : '已关闭') + '：使用其他互动功能字卡');
});
})();
(function () {
var bar = document.getElementById('dcf-prob-expander-row');
var box = document.getElementById('dcf-prob-box');
if (!bar || !box) return;
function apply(open) {
box.hidden = !open;
var ar = document.getElementById('dcf-prob-expander-arrow');
if (ar) ar.textContent = open ? '▴' : '▾';
}
var open = false;
try { open = window.activeStore().get('dcf-prob-open') === '1'; } catch (e) {}
apply(open);
bar.addEventListener('click', function () {
open = !open;
apply(open);
try { window.activeStore().set('dcf-prob-open', open ? '1' : '0'); } catch (e) {}
});
})();
function dcfRaw(k) {
if (!(k in DCF_DEF)) return 100;
try {
const v = window.activeStore().get('dcf-' + k);
if (v !== null && v !== undefined && v !== '') {
const n = Number(v);
if (!isNaN(n)) return Math.max(0, Math.min(100, n));
}
} catch (e) {}
return DCF_DEF[k];
}
function dcfSteppers(k) {
const out = [];
const byId = document.getElementById('dcf-prob-' + k);
if (byId) out.push(byId);
document.querySelectorAll('.stepper[data-dcfkey="' + k + '"]').forEach(function (st) {
if (out.indexOf(st) === -1) out.push(st);
});
return out;
}
function dcValEl(st) { return st.querySelector('input.stp-val') || st.querySelector('.stp-val'); }
function dcfRefreshUI(k) {
dcfSteppers(k).forEach(function (st) {
const valEl = dcValEl(st);
if (valEl) valEl.value = String(dcfRaw(k));
});
}
window.dcfRefreshUI = dcfRefreshUI;
function dcfSetVal(k, nv) {
nv = Math.max(0, Math.min(100, parseInt(nv, 10) || 0));
try { window.activeStore().set('dcf-' + k, String(nv)); } catch (e) {}
dcfRefreshUI(k);
toast('字卡使用概率（' + (DCF_DEF_NAME[k] || k) + '）：' + nv + '%');
}
const dcfBoundSteppers = [];
function bindDcfProb() {
Object.keys(DCF_DEF).forEach((k) => {
dcfSteppers(k).forEach(function (st) {
if (dcfBoundSteppers.indexOf(st) >= 0) return;
dcfBoundSteppers.push(st);
const mn = st.querySelector('.stp-min');
const mx = st.querySelector('.stp-max');
const curVal = function () {
const valEl = dcValEl(st);
const n = valEl ? parseInt(valEl.value, 10) : NaN;
return isNaN(n) ? dcfRaw(k) : n;
};
if (mn) mn.addEventListener('click', () => dcfSetVal(k, curVal() - 5));
if (mx) mx.addEventListener('click', () => dcfSetVal(k, curVal() + 5));
});
dcfRefreshUI(k);
});
}
bindDcfProb();
const DCF_DESC = {
fish: '【摸鱼】联系人按你摸鱼/钓鱼的进度，在桌面上飘出「摸鱼浮字」打趣你；点击浮字可抓包，抓包会结算 TA 自上次被抓以来涨的全部摸鱼值（TA 补一份总账、你得同额），并在聊天里回应。\n触发时机：页面在前台时每 60 秒检查一次摸鱼值变化，仅在摸鱼值上涨、距上次 ≥45 分钟、当天不超过 12 次时判定；后台不触发。\n概率 = 每次判定出现浮字的概率（默认 35%），0% = 不出现浮字（本页字卡也可逐张关闭）。',
eat: '【吃饭】到饭点（早 06:30–09:30、午 11:00–13:30、晚 17:00–19:30、夜宵 21:30–23:30）时，联系人主动来聊天提醒你吃饭，并按概率补一句「追问关心」（夜宵时段用夜宵关心话术）。\n触发时机：每 4 分钟判定一次，每个饭点每天只提醒一次，23:00–06:00 静默。主提醒由本功能自带的概率（默认 2%）控制；本项概率只控制提醒之后是否补发追问。\n概率 = 补发追问的概率（默认 35%），0% = 只提醒、不追问。',
period: '【经期·温柔化】处于经期时，联系人的每条文字回复有概率被加上温柔前缀/后缀（如「抱抱」「慢慢来」）。\n触发时机：TA 每生成一条文字回复时判定一次，仅经期生效。\n概率 = 每条回复被温柔化的概率（默认 25%），0% = 不加温柔前缀/后缀。\n拼接时前缀、正文、动作各自是一张字卡，中间空一格（与单气泡拼字同款，不是被粘成一串）。\n（本项属经期专属语态，词典拼字/梦角自由造句全关也只停各自玩法；但「回复设置→多字卡回复」总开关关闭时本项一并不改写——加前缀/动作＝往同一条气泡里拼第二张字卡，归那颗总开关管。想单独停掉温柔语态只认本页概率与逐张开关。）\n（预测期的「梦角关心」是独立的一项「TA的关心」，另见其说明。）',
water: '【喝水】每天 06:00–23:00，联系人会来聊天里催你喝水；当天已打卡达标时改为约 1/4 概率发夸奖。\n触发时机：页面在前台时每 8 分钟判定一次，至少隔 50 分钟、每天最多 4 条；打开喝水页时也可能补发；后台不触发。\n概率 = 每次判定发出催水的概率（默认 35%），0% = 完全不催。',
garden: '【花园】联系人在花园打理植物（播种/浇水/收成/施肥/巡逻）后，可能在花园日志里留一句「梦角悄悄话」。\n触发时机：你与花园互动时有 8% 概率触发 TA 帮忙打理；回到手机桌面或进花园时，TA 也会按后台经过时间打理（每 30 分钟一段、每段 40% 概率）。\n概率 = 每次 TA 打理后追加悄悄话的概率（默认 40%），0% = 只打理、不留悄悄话。\n（TA 摘花送进聊天是另一套 30% 逻辑，不受本项影响。）',
sync: '【同频】在「同频」页长按敲三下（每下长按 0.35 秒、三下需在 5 秒内完成）时，联系人有概率接住并回应你。\n触发时机：靠你主动长按触发，无冷却、无每日上限；回应会发到聊天（可在同频页关掉「发到聊天」）。\n概率 = 敲三下后接住的概率（默认 60%），0% = 永远接不住。',
reach: '【伸手】在「伸手」页长按 0.5 秒时，联系人有概率回应你（温热/微凉/发丝等触感＋悄悄话，会发到聊天，可在该页关掉）。\n触发时机：靠你主动长按触发，无冷却、无每日上限。\n概率 = 主动伸手被回应的概率（默认 55%），0% = 主动伸手时只飘字、不留卡。\n（打开伸手页时 TA 也可能主动碰你（距上次 >6 小时 70%、否则 25%），该被动回应不受本项控制。）',
cjian: '【此间】在「此间」页点「感知」时，联系人有概率补一句气息/落空的话术（只在页内显示，不发聊天）。\n触发时机：靠你点「感知」触发；按钮自带 4 秒防抖，梦角状态最多每 15 分钟变化一次。\n概率 = 每次感知出现话术的概率（默认 100%），0% = 感知不出话术。',
room: '【房间】在「我们的房间」里进屋、用家具、开关灯、点 TA、点窗等互动时，联系人可能冒泡说话（气泡只在房间内显示）。\n触发时机：靠你点击触发，无每日上限；TA 自己走动/做动作不会发字卡。\n概率 = 每次互动冒泡的概率（默认 100%），0% = 点了也不冒泡。',
piggy: '【存钱罐】切到心意币「存钱」页时，TA 可能往存钱罐里塞心意币，并发一条系统消息。\n触发时机：每次切换/打开该页判定一次；距上次越久越容易（>12 小时 45%、>1 小时 25%、否则 12%）。\n概率 = 本次判定是否放行（默认 100%），0% = 不塞币也不发系统消息。\n（真实存钱罐的存/取款关心、TA 取币另有各自的概率，不受本项控制。）',
drift: '【漂流瓶】捞出漂流瓶时，瓶内话术（海风/TA的话/TA的回应）从「漂流瓶」字卡池抽取。\n触发时机：打开漂流瓶页、捡瓶前、从后台切回时结算；捡瓶有 20 秒冷却，TA 瓶每天最多 3 个；TA 回应在发布后 6–40 小时结算（45% 概率会回应，同时最多 2 个）。\n概率 = 抽到字卡话术的概率（默认 100%），0% = 不出字卡（普通瓶仍有内置兜底、不会空白；TA 回应瓶则不再生成）。',
interact: '【互动回应】你主动做的各种小互动（戳一戳 / 拍一拍 / 拉拉手等）时，联系人回应的字卡。\n⚠ 当前版本本项概率尚未接线到回应抽取，调整暂不生效（回应的实际概率由回复设置里的相关项控制）。\n触发时机：你主动互动时。\n概率 = 预留的回应字卡概率（默认 100%），设计意图为 0% = 互动不回应字卡，修复接线后生效。',
music: '【音乐】播放歌曲时，TA 偶尔会「暂停一下再恢复」来逗你。\n触发时机：每开始一首歌判定一次（自带 3% 概率、同一首只触发一次、距上次 ≥10 分钟）；命中后 10–25 秒随机暂停，3.5 秒后恢复。\n概率 = 暂停/恢复时是否附上字卡气泡（默认 100%），0% = 仍有暂停动作和系统消息，但不出字卡。',
checkin: '【寻踪日常】联系人定期更新「TA 的日常」（在哪里 / 在做什么 / 想对你说），并推送到聊天。\n触发机制与时间：首次打开（数据就绪后）立即生成一条；此后每隔 1–8 小时随机更新一次，页面在前台时每 60 秒检查一次；后台不更新，从后台切回后 90 秒冷静期内不更新。\n推送内容：每次更新向聊天发三条——「更新了一条日常」提示 + 日常内容 + 30% 概率的「提醒你来寻踪」。\n概率 = 本次更新是否推送这三条到聊天的概率（默认 100%），0% = 完全不发（寻踪页与历史记录照常生成）。\n想整体停用：设置 → 工具 → 寻踪（TA 的日常）总开关——关闭后连日常生成与记录一起停用、聊天里的寻踪入口收起（桌面【寻踪】图标仍在，进去写明「已禁用」，页里「TA在身边 · 位置感知」照常可用），与本概率是两层东西。',
pomo: '【番茄钟】你用番茄钟完成一段专注时，联系人在聊天里发「去休息一会儿」（如有奖励还会附上摸鱼补偿）的消息。\n触发时机：每完成一段「专注」结算一次（休息段不发），需番茄钟页的「发到聊天」开关也打开。\n概率 = 完成后发这条消息的概率（默认 100%），0% = 不发。',
care: '【TA的关心（经期）】经期中、经前预警日（提前天数见经期页「提醒设置」）、或经期推迟时，联系人主动发消息。v3.42.x #559 起按「语境 × 经期规律」分级：经期中发「经期关心」（附「经期关心」标签，语料=字卡库「经期」tab「经期关心」分组+经期页自管理关心语）；经前预警日/推迟发「经期预警」（附「经期预警」标签）。分级判据=近 3 次周期变异系数 CV<0.2（很规律/较规律）视为预测可信，否则预测仅参考——①经前预警：预测可信按配置预警日发确定口吻（「经前预警」组）；预测仅参考只在最接近的一次预警日发「按记录推算、仅供参考」版（「经前预警·不规律」组）。②推迟：预测可信晚 ≥5 天发「比平时晚了 N 天，你一向很准」（「经期推迟」组），晚 ≥10 天升关注档、措辞带就医建议（「经期推迟·关注」组）；预测仅参考不说「推迟」（预测误差可能比推迟天数还大），晚 ≥10 天才以「距上次经期已经 N 天」间隔口吻轻提（「经期推迟·不规律」组）。各语料 {d} 自动替换为具体天数。\n触发时机：TA 每条文字/表情/图片回复后、打开经期页、保存提醒设置时各判定一次；每个语境每天最多一条；23:00–06:00 深夜静默（不发、也不占当天名额，白天再触发照常）。\n本概率 = 在原有闸门之上统一放行（默认 100%）：经期中第 1–2 天另有 90%、第 3–4 天 70%、第 5+ 天 55%，经前预警/推迟预警 75% 的基数；本项 100% = 保持原节奏，0% = 完全不发。\n与经期页那个「梦角关心」按钮是「与」的关系：本项设 0%、或那边关掉，任一成立就一条都不发（不必两个都关）。被本项拦成 0% 而经期页仍显示「已开启」时，经期页「提醒设置」底部会当场写出这一条与打开方式，不再静默不发。',
memo: '【备忘提醒】你有未完成的备忘时，联系人在聊天里催一件，带「备忘提醒」标签。\n触发时机：启动 60 秒后首次、之后每 4 分钟判定一次、回前台补触发；至少隔 2 天、23:00–06:00 静默。\n本概率 = 在备忘页自带的「备忘提醒」开关/概率（默认 2%）之上是否放行（默认 100%）：100% = 保持原节奏，0% = 完全不催备忘。\n备忘页里自己的开关仍独立有效。',
ask: '【TA主动提问】联系人在聊天里主动发起的问题卡：关心询问 / 小问题 / 好奇卡片 / 互动 / 吐槽，带你作答选项。\n触发时机：五类各自定时判定（首次 60–150 秒、之后每 240–300 秒），各有冷却（30/45/90 分钟），任一互动卡发出后 60 分钟内其余类型不再自动触发；无深夜静默。\n本概率 = 在各类自带的触发概率（询问/小问题/好奇/吐槽默认 5%、TA分享你的字卡默认 4%）与冷却之上是否统一放行（默认 100%）：100% = 保持原节奏，0% = 完全不主动提问。\n#1153 频率整体档：设置 → 回复设置 →「互动卡频率」四档（原频率 / 稍安静 / 安静 / 很安静）可把这五类（以及邀请三类、音乐邀请）的概率、提问卡冷却与 60 分钟跨类型间隔一起整体往下缩放；「原频率」（默认）＝完全保持现在的节奏，没有比它更高的档。\n不影响查岗（查岗走自己的「跨桌面查岗」）。',
deskcheck: '【跨桌面查岗·回应】其他桌面的联系人来查岗、你回答后，TA 是否从「跨桌面查岗」字卡池抽 1–5 张作为回应。\n触发时机：查岗本身由全局「跨桌面查岗频率」控制（原频率：每 60 秒判定、每次 2% 概率、冷却 30 分钟；安静 1% / 3 小时（默认）；更安静 0.5% / 6 小时；最安静 0.2% / 12 小时），本项不控制是否来查岗，只控制回答之后的回应。\n概率 = 回答后抽回应字卡的概率（默认 50%），0% = 只给文字回复、不抽字卡。\n（本项为独立入口，不受「其他互动功能字卡」总开关约束。）'
};
(function () {
function injBox(boxId, ks, idOverride) {
var box = document.getElementById(boxId);
if (!box) return;
ks.forEach(function (k) {
var stp = document.getElementById((idOverride && idOverride[k]) || ('dcf-prob-' + k));
if (!stp) return;
var row = stp.closest('.gs-row');
if (!row) return;
var label = row.querySelector(':scope > span');
if (!label || label.querySelector('.tag')) return;
var tag = document.createElement('span');
tag.className = 'tag';
tag.setAttribute('data-fdesc', k);
tag.setAttribute('data-dname', DCF_DEF_NAME[k] || k);
tag.setAttribute('role', 'button');
tag.setAttribute('tabindex', '0');
tag.textContent = '功能说明';
label.style.cssText += ';display:flex;align-items:center;gap:6px;';
label.appendChild(tag);
});
}
injBox('dcf-prob-box', Object.keys(DCF_DEF).filter(function (k) { return k !== 'deskcheck'; }));
injBox('dcf-prob-box-dk', ['deskcheck']);
injBox('ck-prob-box', ['checkin'], { checkin: 'dcf-prob-checkin-ck' });
})();
document.addEventListener('click', function (e) {
var t = e.target && e.target.closest ? e.target.closest('[data-fdesc]') : null;
if (!t) return;
var k = t.getAttribute('data-fdesc');
var txt = DCF_DESC[k];
if (!txt) return;
var n = dcfRaw(k);
var title = '【' + (t.getAttribute('data-dname') || k) + '】功能说明';
if (window.openModal) {
window.openModal(title, '', function () {}, { noInput: true, staticText: txt + '\n\n当前使用概率：' + n + '%' });
}
});
function syncDcSwitchUI() {
enabledEl.checked = getEnabled();
['chat', 'mail', 'feed'].forEach(function (k) {
const el = document.getElementById('dc-use-' + k);
if (el) el.checked = getUse(k);
});
['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
const el = document.getElementById('dc-cat-' + k);
if (el) el.checked = getCat(k);
});
['chat', 'mail', 'feed'].forEach(function (k) {
const valEl = document.getElementById('dc-overall-' + k + '-val');
if (valEl) valEl.value = String(dcOverallVal(k));
});
['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
const valEl = document.getElementById('dc-prob-' + k + '-val');
if (valEl) valEl.value = String(getProb(k));
});
Object.keys(DCF_DEF).forEach(function (k) {
dcfRefreshUI(k);
});
const deEl = document.getElementById('dcf-enabled');
if (deEl) deEl.checked = dcfEnabled();
}
document.addEventListener('mochi-wrj-heal', function () { try { syncDcSwitchUI(); } catch (e) {} });
['contact-switched', 'mochi-restore-done'].forEach(function (ev) {
document.addEventListener(ev, function () { try { syncDcSwitchUI(); } catch (e) {} });
});
const V_PAD = 0.8;    // 视口上下各多渲染 0.8 屏（重建频率 ≈ 每滚 0.8 屏一次）
const V_MINW = 24;    // 窗口条目数下限（小屏/高条目时兜底，避免窗口过窄）
const V_EST = 55;     // 未实测条目高度初值：.cc-item 13+13 padding + 行高 + 9 margin
function mountCardView(ids, allowedKeys, emptyText, searchKeys) {
const viewList = document.getElementById(ids.list);
const viewTabs = document.getElementById(ids.tabs);
const viewBar = document.getElementById(ids.groupsBar);
const viewSearch = document.getElementById(ids.search);
const pageEl = document.getElementById(ids.page);
if (!viewList || !viewTabs || !viewBar || !viewSearch || !pageEl) return null;
viewList.classList.add('preset-list');
const view = {
keys: allowedKeys.slice(),
searchKeys: (searchKeys || []).slice(),
cur: allowedKeys[0] || '',
q: '',
curGroup: ''
};
let flat = [];                    // 当前列表数据（分组头 + 字卡）
let n = 0;
let hts = new Float64Array(0);    // 每条占位高度（实测或估计）
let offs = new Float64Array(1);   // 前缀和：offs[i]=第 i 条顶部 y，offs[n]=总高
let got = new Uint8Array(0);      // 该条是否已实测
let est = V_EST;                  // 估计高度：随实测均值收敛
let measSum = 0, measCnt = 0;
let winLo = -1, winHi = -1;       // DOM 中已渲染窗口 [winLo, winHi)
let topSpace = null, botSpace = null;
let scroller = null;
function clipsContent(el) {
try {
const oy = getComputedStyle(el).overflowY;
if (oy !== 'auto' && oy !== 'scroll') return false;
return el.scrollHeight > el.clientHeight + 1;
} catch (e) { return false; }
}
function guessScroller() {
if (scroller) return scroller;
try {
let el = viewList;
while (el && el !== document.documentElement) {
if (clipsContent(el)) { scroller = el; return scroller; }
el = el.parentElement;
}
} catch (e) {}
return null;
}
function onScroll(target) {
if (pageEl.hidden) return;
if (target && target.nodeType === 1) {
try { if (target !== viewList && !target.contains(viewList)) return; } catch (e) { return; }
scroller = target;
} else {
const sc = guessScroller();
if (sc && sc !== 'win') return;   // 本页有元素级滚动容器，视口滚动与我们无关
scroller = 'win';
}
requestLayout(false);
}
function scrollY() {
const sc = guessScroller();
if (!sc || sc === 'win') return window.pageYOffset || document.documentElement.scrollTop || 0;
return sc.scrollTop;
}
function setScrollY(v) {
const sc = guessScroller();
if (!sc || sc === 'win') window.scrollTo(0, v); else sc.scrollTop = v;
}
function recomputeOffsets() {
if (offs.length !== n + 1) offs = new Float64Array(n + 1);
let s = 0;
for (let i = 0; i < n; i++) { offs[i] = s; s += hts[i]; }
offs[n] = s;
}
function indexAt(y) {
if (y <= 0) return 0;
if (y >= offs[n]) return Math.max(0, n - 1);
let a = 0, b = n;
while (a < b) { const m = (a + b) >> 1; if (offs[m] <= y) a = m + 1; else b = m; }
return Math.max(0, Math.min(n - 1, a - 1));
}
function groupHeaderHTML(label, count, off) {
return '<span class="ccg-name">' + label + (off ? '<em class="ccg-off-tag">已停用</em>' : '') + '</span>' +
'<span class="ccg-count">' + count + '</span>' +
'<label class="toggle ccard-toggle" title="' + (off ? '启用该分组' : '停用该分组') + '"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
}
function makeNode(it, i) {
const d = document.createElement('div');
if (it.header) {
const goff = isGroupOff(it.cat, it.gname);
d.className = 'cc-group-header' + (goff ? ' off' : '');
d.innerHTML = groupHeaderHTML(it.glabel, it.count, goff);
} else {
const off = isCardOff(it.cat, it.c);
d.className = 'cc-item glass' + (off ? ' off' : '');
d.innerHTML = '<div class="cc-txt"><div class="t">' + it.c + ' <span class="tc-known">' + (window.__dictCustomSet && window.__dictCustomSet.has(it.c) ? '自建' : '系统') + '</span></div></div>' +
'<label class="toggle ccard-toggle"><input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span></label>';
}
d.dataset.idx = i;
return d;
}
function measureAndFix() {
const kids = viewList.children;
const count = kids.length - 2;
if (count < 2) return;
const baseBefore = offs[winLo];
let touched = false;
for (let k = 1; k <= count; k++) {
const i = winLo + k - 1;
const h = kids[k + 1].offsetTop - kids[k].offsetTop;
if (h > 0 && h !== hts[i]) {
if (got[i]) measSum += h - hts[i]; else { got[i] = 1; measSum += h; measCnt++; }
hts[i] = h;
touched = true;
}
}
if (!touched) return;
if (measCnt) est = Math.max(20, measSum / measCnt);
recomputeOffsets();
const delta = offs[winLo] - baseBefore;
topSpace.style.height = offs[winLo] + 'px';
botSpace.style.height = Math.max(0, offs[n] - offs[winHi]) + 'px';
if (Math.abs(delta) >= 1) setScrollY(scrollY() + delta);
}
function layout(force) {
if (!n) { winLo = winHi = -1; return; }
const sc = guessScroller();
const isWin = !sc || sc === 'win';
const vh = isWin ? window.innerHeight : sc.clientHeight;
if (!vh) return;                  // 页面正隐藏：等显示时再排
const y = scrollY();
let a;
if (sc === viewList) a = y;
else a = (isWin ? 0 : sc.getBoundingClientRect().top) - viewList.getBoundingClientRect().top;
const pad = vh * V_PAD;
let lo = indexAt(Math.max(0, a - pad));
let hi = Math.min(n, indexAt(Math.min(offs[n], a + vh + pad)) + 1);
const need = V_MINW - (hi - lo);
if (need > 0) {
hi = Math.min(n, hi + need);
const need2 = V_MINW - (hi - lo);
if (need2 > 0) lo = Math.max(0, lo - need2);
}
if (!force && lo >= winLo && hi <= winHi) return;
winLo = lo; winHi = hi;
if (!topSpace) {
topSpace = document.createElement('div'); topSpace.className = 'cc-vspace';
botSpace = document.createElement('div'); botSpace.className = 'cc-vspace';
}
topSpace.style.height = offs[lo] + 'px';
botSpace.style.height = Math.max(0, offs[n] - offs[hi]) + 'px';
const frag = document.createDocumentFragment();
frag.appendChild(topSpace);
for (let i = lo; i < hi; i++) frag.appendChild(makeNode(flat[i], i));
frag.appendChild(botSpace);
viewList.textContent = '';
viewList.appendChild(frag);
measureAndFix();
}
let rafPending = false, rafForce = false;
function requestLayout(force) {
if (force) rafForce = true;
if (rafPending) return;
rafPending = true;
requestAnimationFrame(() => {
const f = rafForce;
rafPending = false; rafForce = false;
layout(f);
});
}
function setData() {
hts = new Float64Array(n); hts.fill(est);
got = new Uint8Array(n);
recomputeOffsets();
winLo = winHi = -1;
}
function renderGroupsBar() {
viewBar.innerHTML = '';
const grps = DATA[view.cur] || [];
const chips = [['', '全部']].concat(grps.map(g => [g[0], g[0]]));
chips.forEach(([val, label]) => {
const cEl = document.createElement('span');
cEl.className = 'cc-g-chip' + (view.curGroup === val ? ' sel' : '');
cEl.textContent = label;
cEl.addEventListener('click', () => { view.curGroup = val; renderGroupsBar(); render(); });
viewBar.appendChild(cEl);
});
}
function render() {
let shown = (DATA[view.cur] || []).map(g => ({ key: view.cur, gname: g[0], arr: g[1] }));
if (view.q) {
const cross = [];
(view.searchKeys.length ? view.searchKeys : view.keys).forEach(k => {
(DATA[k] || []).forEach(g => {
const arr = (g[1] || []).filter(c => c.indexOf(view.q) >= 0);
if (arr.length || g[0].indexOf(view.q) >= 0) cross.push({ key: k, gname: g[0], arr });
});
});
shown = cross;
} else if (view.curGroup) {
shown = shown.filter(g => g.gname === view.curGroup);
}
const list = [];
shown.forEach(it => {
list.push({ header: true, cat: it.key, gname: it.gname, glabel: (it.key !== view.cur ? '[' + tabLabel(it.key) + '] ' : '') + it.gname, count: it.arr.length });
it.arr.forEach(c => list.push({ header: false, c, cat: it.key }));
});
flat = list; n = list.length;
if (!n) {
topSpace = botSpace = null;
viewList.innerHTML = '<div class="cc-empty">' + emptyText + '</div>';
winLo = winHi = -1;
return;
}
setData();
layout(true);
}
viewList.addEventListener('change', (e) => {
const input = e.target;
if (!input || input.type !== 'checkbox') return;
const head = input.closest('.cc-group-header');
if (head) {
const hrec = flat[Number(head.dataset.idx)];
if (!hrec || !hrec.header) return;
const nowOff = !input.checked;
setGroupOff(hrec.cat, hrec.gname, nowOff);
requestLayout(true);
toast(nowOff ? '已停用分组：' + hrec.gname + '（本组 ' + hrec.count + ' 张字卡不再使用）' : '已启用分组：' + hrec.gname);
return;
}
const item = input.closest('.cc-item');
if (!item) return;
const rec = flat[Number(item.dataset.idx)];
if (!rec || rec.header) return;
const nowOff = !input.checked;
setCardOff(rec.cat || view.cur, rec.c, nowOff);
item.classList.toggle('off', nowOff);
toastCard(rec.c, nowOff);
});
viewTabs.addEventListener('click', (e) => {
const tab = e.target.closest('.cc-tab[data-type]');
if (!tab) return;
if (view.keys.indexOf(tab.dataset.type) < 0) return;
viewTabs.querySelectorAll('.cc-tab').forEach(t => t.classList.remove('sel'));
tab.classList.add('sel');
view.cur = tab.dataset.type;
view.q = '';
view.curGroup = '';
renderGroupsBar();
render();
});
viewSearch.addEventListener('input', () => {
view.q = viewSearch.value.trim();
clearTimeout(view._searchTimer);
view._searchTimer = setTimeout(render, 150);
});
viewSearch.addEventListener('keydown', (e) => {
if (e.key === 'Escape') { viewSearch.value = ''; view.q = ''; render(); viewSearch.blur(); }
});
let renderedOnce = false;
function ensureRendered() {
if (renderedOnce) { requestLayout(true); return; }
renderedOnce = true;
document.addEventListener('scroll', function (e) { onScroll(e.target); }, { passive: true, capture: true });
window.addEventListener('resize', () => requestLayout(true));
if (typeof MutationObserver !== 'undefined') {
try {
new MutationObserver(() => { if (!pageEl.hidden) requestLayout(true); })
.observe(pageEl, { attributes: true, attributeFilter: ['hidden'] });
} catch (e) {}
}
refreshLibCount();
renderGroupsBar();
render();
}
return { view, ensureRendered, render };
}
const dcView = mountCardView({
list: 'dc-list', tabs: 'dc-tabs', groupsBar: 'dc-groups-bar', search: 'dc-search-input', page: 'page-default-cards'
}, BASE_KEYS, '暂无默认字卡', ALL_KEYS);
(function () {
const row = document.getElementById('dc-dict-add');
if (!row || !dcView) return;
const inp = document.getElementById('dc-dict-input');
const sync = function () { try { row.hidden = dcView.view.cur !== 'dict'; } catch (e) {} };
const tabs = document.getElementById('dc-tabs');
if (tabs) tabs.addEventListener('click', function (e) {
const t = e.target.closest('.cc-tab[data-type]');
if (t) setTimeout(sync, 0);
});
const origEnsure = dcView.ensureRendered;
dcView.ensureRendered = function () { const r = origEnsure.apply(null, arguments); sync(); return r; };
const commit = function (kind) {
const r = dictCustomAdd(kind, inp ? inp.value : '');
toast(r.msg);
if (r.ok) {
if (inp) inp.value = '';
if (dcView.render) dcView.render();
}
};
const bq = document.getElementById('dc-dict-add-q');
const bw = document.getElementById('dc-dict-add-w');
if (bq) bq.addEventListener('click', () => commit('quote'));
if (bw) bw.addEventListener('click', () => commit('word'));
const bd = document.getElementById('dc-dict-del');
if (bd) bd.addEventListener('click', () => {
if (!window.openModal) { toast('弹窗组件不可用'); return; }
window.openModal('删除自建词典词条', '', function (v) {
if (v && dictCustomRemove(v)) {
toast('已删除：' + String(v).replace(/\s+/g, ''));
if (dcView.render) dcView.render();
} else toast('未找到这条自建词条（内置词条不可删，可在列表里逐张关闭）');
}, { staticText: '输入要删除的自建语录或词的原文（精确匹配）。内置词条无法删除，但可以在列表里逐张关闭。' });
});
})();
const dictView = mountCardView({
list: 'd2-dict-list', tabs: 'd2-dict-tabs', groupsBar: 'd2-dict-groups-bar', search: 'd2-dict-search', page: 'page-dict-cards'
}, ['dict'], '暂无词典字卡', ['dict']);
(function () {
if (!dictView) return;
const inp = document.getElementById('d2-dict-input');
const commit = function (kind) {
const r = dictCustomAdd(kind, inp ? inp.value : '');
toast(r.msg);
if (r.ok) { if (inp) inp.value = ''; if (dictView.render) dictView.render(); }
};
const bq = document.getElementById('d2-dict-add-q');
const bw = document.getElementById('d2-dict-add-w');
if (bq) bq.addEventListener('click', () => commit('quote'));
if (bw) bw.addEventListener('click', () => commit('word'));
const bd = document.getElementById('d2-dict-del');
if (bd) bd.addEventListener('click', () => {
if (!window.openModal) { toast('弹窗组件不可用'); return; }
window.openModal('删除自建词典词条', '', function (v) {
if (v && dictCustomRemove(v)) {
toast('已删除：' + String(v).replace(/\s+/g, ''));
if (dictView.render) dictView.render();
} else toast('未找到这条自建词条（内置词条不可删，可在列表里逐张关闭）');
}, { staticText: '输入要删除的自建语录或词的原文（精确匹配）。内置词条无法删除，但可以在列表里逐张关闭。' });
});
})();
(function () {
if (!dictView) return;
const st = function () { try { return window.activeStore(); } catch (e) { return null; } };
const gUse = function (k) { const s = st(); const v = s ? s.get('dict-use-' + k) : null; return v === null ? true : v === '1'; };
const sUse = function (k, on) { const s = st(); if (s) s.set('dict-use-' + k, on ? '1' : '0'); };
const DICT_OVERALL_DEF = { chat: 75, mail: 30, feed: 30 };
const gOv = function (k) { const s = st(); const v = s ? s.get('dict-overall-' + k) : null; return v === null ? DICT_OVERALL_DEF[k] : Math.max(0, Math.min(100, Number(v))); };
const sOv = function (k, nv) { const s = st(); if (s) s.set('dict-overall-' + k, String(nv)); };
window.dictUse = function (scene) { return gUse(scene === 'mail' ? 'mail' : scene === 'feed' ? 'feed' : 'chat'); };
window.dictOverall = function (scene) { return gOv(scene === 'mail' ? 'mail' : scene === 'feed' ? 'feed' : 'chat'); };
const lockHint = document.getElementById('dict-lock-hint');
function renderDictLockHint() {
if (!lockHint) return;
let locked = false;
try { locked = !!(window.cardLockOpen && !window.cardLockOpen()); } catch (e) { locked = false; }
if (!locked) { lockHint.hidden = true; lockHint.textContent = ''; return; }
lockHint.hidden = false;
lockHint.textContent = '防未成年人锁定开启中：词典属于系统内置字卡，锁定时聊天 / 写信 / 朋友圈都不会使用词典（下方开关全开也没效果，不是没保存）。到开屏公告区「防未成年人·内置字卡锁定」卡输入密码解锁，解锁后自动恢复，无需改这里任何开关。';
}
renderDictLockHint();
document.addEventListener('mochi-cardlock-open', renderDictLockHint);
document.addEventListener('mochi-cardlock-locked', renderDictLockHint);
[['chat', '聊天'], ['mail', '写信'], ['feed', '朋友圈']].forEach(function (pair) {
const k = pair[0], label = pair[1];
const el = document.getElementById('dict-use-' + k);
if (el) {
el.checked = gUse(k);
el.addEventListener('change', function () {
sUse(k, el.checked);
toast((el.checked ? '已开启' : '已关闭') + '：词典' + label + '使用');
});
}
const box = document.getElementById('dict-overall-' + k);
const valEl = document.getElementById('dict-overall-' + k + '-val');
if (box && valEl) {
valEl.value = String(gOv(k));
const step = function (d) {
const nv = Math.max(0, Math.min(100, (parseInt(valEl.value, 10) || 0) + d));
valEl.value = String(nv); sOv(k, nv);
toast('词典' + label + '使用概率：' + nv + '%');
};
const bMin = box.querySelector('.stp-min');
const bMax = box.querySelector('.stp-max');
if (bMin) bMin.addEventListener('click', function () { step(-5); });
if (bMax) bMax.addEventListener('click', function () { step(5); });
}
});
const ca = document.getElementById('dict-use-closeall');
if (ca) ca.addEventListener('click', function () {
const doClose = function () {
['chat', 'mail', 'feed'].forEach(function (k) {
sUse(k, false);
const el = document.getElementById('dict-use-' + k);
if (el) el.checked = false;
});
toast('已关闭词典全部场景使用');
};
if (!window.openModal) { doClose(); return; }
window.openModal('词典使用的全部关闭', '将同时关闭词典的聊天 / 写信 / 朋友圈三个场景使用（单卡开关不受影响，可随时再逐个打开）。', function () {
doClose();
}, { staticText: '确定执行？' });
});
})();
const liDict = document.getElementById('li-dict-cards');
if (liDict) {
liDict.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const page = document.getElementById('page-dict-cards');
if (page) page.hidden = false;
if (dictView) dictView.ensureRendered();
});
}
const dictBack = document.getElementById('dict-back');
if (dictBack) {
dictBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
const fcView = mountCardView({
list: 'fc-list', tabs: 'fc-tabs', groupsBar: 'fc-groups-bar', search: 'fc-search-input', page: 'page-fun-cards'
}, FUNC_KEYS, '暂无功能触发字卡', ALL_KEYS);
(function () {
const tabs = document.getElementById('fc-tabs');
if (!tabs) return;
const known = Array.prototype.map.call(tabs.querySelectorAll('.cc-tab'), t => t.dataset.type);
FUNC_KEYS.forEach(function (k) {
if (known.indexOf(k) >= 0) return;
const b = document.createElement('button');
b.className = 'cc-tab';
b.dataset.type = k;
b.textContent = k === 'deskcheck' ? '联系人跨桌面查岗' : k;
tabs.appendChild(b);
});
})();
const dkView = mountCardView({
list: 'dk-list', tabs: 'dk-tabs', groupsBar: 'dk-groups-bar', search: 'dk-search-input', page: 'page-deskcheck'
}, ['deskcheck'], '暂无联系人跨桌面查岗字卡', ['deskcheck']);
const li = document.getElementById('li-default-cards');
if (li) {
li.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const page = document.getElementById('page-default-cards');
if (page) page.hidden = false;
if (dcView) dcView.ensureRendered();
});
}
const back = document.getElementById('dc-back');
if (back) {
back.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
const liFun = document.getElementById('li-fun-cards');
if (liFun) {
liFun.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const page = document.getElementById('page-fun-cards');
if (page) page.hidden = false;
if (fcView) fcView.ensureRendered();
});
}
const fcBack = document.getElementById('fc-back');
if (fcBack) {
fcBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
const liDk = document.getElementById('li-deskcheck');
if (liDk) {
liDk.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const page = document.getElementById('page-deskcheck');
if (page) page.hidden = false;
if (dkView) dkView.ensureRendered();
});
}
const dkBack = document.getElementById('dk-back');
if (dkBack) {
dkBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
function drawCards(a, scene, st) {
scene = scene || 'chat';
if (LOCKED()) return []; // #319 锁定＝不抽任何系统预设字卡
if (!a.use(scene)) return [];
const cfg = a.cfg();
if (!cfg.enabled) return [];
let overall = cfg.overallFor ? cfg.overallFor(scene) : cfg.overall;
if (scene === 'chat') overall = (window.dcpEff ? window.dcpEff(overall, st) : overall);
if (Math.random() * 100 >= overall) return [];
const keys = ['main', 'kaomoji', 'emoji', 'touch'];
const weights = keys.map(k => (a.cat(k) ? Math.max(0, cfg.probs[k] || 0) : 0));
const total = weights.reduce((x, y) => x + y, 0);
if (total <= 0) return [];
let roll = Math.random() * total;
let chosen = 'main';
for (let i = 0; i < keys.length; i++) {
roll -= weights[i];
if (roll < 0) { chosen = keys[i]; break; }
}
const grps = (DATA[chosen] || [])
.map(g => [g[0], g[1].filter(c => !a.isOff(chosen, c))])
.filter(g => g[1].length);
if (!grps.length) return [];
const g = grps[Math.floor(Math.random() * grps.length)];
const text = g[1][Math.floor(Math.random() * g[1].length)];
return { text: text, type: chosen === 'touch' ? 'poke' : 'text' };
}
window.getDefaultCardsFor = function (st, scene) { return drawCards(apiFor(st), scene, st); };
window.getDefaultCards = function (scene) { return drawCards(api, scene); };
window.getDefaultCardGroups = function (cat) {
if (LOCKED()) return []; // #319 锁定＝系统预设字卡不存在
return (DATA[cat] || []).slice();
};
window.getLibPool = function (cat, group, fallback, exemptLock) {
if (LOCKED() && !exemptLock) { // #319 锁定＝只回自建功能字卡，内置同源池与 fallback 兜底都不给
try { return (window.getCustomFuncCards && window.getCustomFuncCards(cat)) || []; } catch (e) { return []; }
}
const g = (DATA[cat] || []).find(x => x[0] === group);
let arr = g && Array.isArray(g[1]) && g[1].length ? g[1] : (Array.isArray(fallback) ? fallback : []);
arr = arr.slice();
try { const off = window.isDefaultCardOff; if (off) arr = arr.filter(c => !off(cat, c)); } catch (e) {}
try {
const cf = (window.getCustomFuncCards && window.getCustomFuncCards(cat)) || [];
if (cf.length) arr = arr.concat(cf);
} catch (e) {}
return arr;
};
window.gateCardFallback = function (cat, fallback) {
try {
const arr = Array.isArray(fallback) ? fallback.slice() : [];
const off = window.isDefaultCardOff;
if (!off) return arr;
return arr.filter(c => !off(cat, c));
} catch (e) { return []; }
};
window.getPresetGroupLines = function (group, fallback) {
let arr = [];
try {
const g = ((window.DEFAULT_CARD_DATA || {}).interact || []).find(x => x && x[0] === group);
arr = g && Array.isArray(g[1]) && g[1].length ? g[1].slice() : (Array.isArray(fallback) ? fallback.slice() : []);
} catch (e) { arr = Array.isArray(fallback) ? fallback.slice() : []; }
const off = window.isDefaultCardOff;
return off ? arr.filter(c => !off('interact', c)) : arr;
};
window.getInteractPool = function (name, fallback) {
return window.getLibPool('interact', name, fallback);
};
window.getFishPool = function (name, fallback) {
return window.getLibPool('fish', name, fallback);
};
window.getDeskCheckPool = function (dir, fallback) {
const group = dir === 'meToTa' ? '联系人申请我对联系人查岗' : '联系人对我查岗';
let arr = window.getLibPool('deskcheck', group, fallback);
if (!arr.length && Array.isArray(fallback) && fallback.length) arr = fallback.slice();
return arr.filter(c => !(window.isDefaultCardOff && window.isDefaultCardOff('deskcheck', c)));
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("default-cards.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("default-cards.js"); try { console.error("[JS] default-cards.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[default-cards.js] " + String(__e && __e.message || __e)); } })();
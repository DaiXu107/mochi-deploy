(function () { try {
(function () {
const store = window.activeStore();
const LIB = {
dir: ['在你左边', '在你右边', '在你身后', '在你前面', '离你两步', '抬头就能看到', '在你看不到的地方偷看你'],
dist: ['再近一点', '再远一点', '就停这儿', '马上到你身边', '一直在原地等你'],
state: ['跟在你后面', '陪你走着', '停下来等你', '绕着你转圈', '在你身边'],
sense: ['在你看不到的地方', '隔着世界在你身边', '感觉到了吗', '能摸到我吗', '一直没走远', '隐约在你身旁'],
egg: ['在你心里'],
direct: ['正前方', '右前方', '右侧', '右后方', '后方', '左后方', '左侧', '左前方', '身边', '无法判断'],
rangef: ['很近', '近', '稍远', '很远', '无法判断'],
power: ['明显', '微弱', '若有若无', '消失'],
touch: ['好像碰到了你的手', '有什么轻轻碰了一下你的肩', '耳边好像有气息拂过', '衣角被轻轻拉了一下']
};
const LABEL = { dir: '方位', dist: '距离', state: '状态', sense: '感知', egg: '彩蛋', custom: '自定义', combo: '组合', direct: '方向', rangef: '距离感', power: '感知强度', touch: '触碰' };
const CATS = ['dir', 'dist', 'state', 'sense', 'egg', 'direct', 'rangef', 'power', 'touch'];
const DEF_KEY = 'loc-lib-default';          // 使用系统预设开关（默认开）
const CUSTOM_KEY = 'loc-lib-custom';        // 我的添加（对象数组 [{t,grp}]）
const GRP_KEY = 'loc-lib-groups';           // 我的添加自定义分组
function getUseDefault() {
const v = store.get(DEF_KEY);
return v === null ? true : v === '1';
}
function isOff(cat, text) { return store.get('loc-off-' + cat + ':' + text) === '1' || !!(window.presetGroup && window.presetGroup.isOff('loc', cat)); }
function setOff(cat, text, off) { store.set('loc-off-' + cat + ':' + text, off ? '1' : '0'); }
function getGroups() {
try {
const v = JSON.parse(store.get(GRP_KEY) || 'null');
if (Array.isArray(v)) return v;
} catch (e) {}
return [];
}
function saveGroups(groups) { store.set(GRP_KEY, JSON.stringify(groups)); }
function getCustom() {
try {
const v = JSON.parse(store.get(CUSTOM_KEY) || 'null');
if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? { t: x } : (x && typeof x === 'object' && x.t != null ? x : null)).filter(Boolean);
} catch (e) {}
try {
const old = JSON.parse(store.get('loc-custom') || 'null');
if (Array.isArray(old) && old.length) {
const arr = old.filter(x => typeof x === 'string' && x.trim()).map(x => ({ t: x.trim() }));
store.set(CUSTOM_KEY, JSON.stringify(arr));
return arr;
}
} catch (e) {}
return [];
}
function saveCustom(list) {
const arr = (list || []).map(x => typeof x === 'string' ? { t: x } : x).filter(x => x && x.t != null);
if (window.xyBigWriteBlocked && window.xyBigWriteBlocked(store, CUSTOM_KEY, '位置卡库')) return false;
store.set(CUSTOM_KEY, JSON.stringify(arr));
try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + CUSTOM_KEY, JSON.stringify(arr)); } catch (e) {}
return true;
}
function sysCards(cat) {
if (!getUseDefault()) return [];
const def = LIB[cat] || [];
return def.filter(x => !isOff(cat, x));
}
function customCards() { return getCustom().map(x => x.t).filter(Boolean); }
function getSysAll() {
const out = {};
CATS.forEach(c => { out[c] = sysCards(c); });
return out;
}
function allEnabled() {
return [].concat(sysCards('dir'), sysCards('dist'), sysCards('state'), sysCards('sense'), customCards());
}
function typeOf(text) {
if (LIB.dir.indexOf(text) >= 0) return 'dir';
if (LIB.dist.indexOf(text) >= 0) return 'dist';
if (LIB.state.indexOf(text) >= 0) return 'state';
if (LIB.sense.indexOf(text) >= 0) return 'sense';
if (LIB.egg.indexOf(text) >= 0) return 'egg';
if (LIB.direct.indexOf(text) >= 0) return 'direct';
if (LIB.rangef.indexOf(text) >= 0) return 'rangef';
if (LIB.power.indexOf(text) >= 0) return 'power';
if (LIB.touch.indexOf(text) >= 0) return 'touch';
return 'custom';
}
function senseCards(k) {
return sysCards(k);
}
function senseGroup(k) {
const list = senseCards(k).slice();
if (!list.length) { // 全被关：给一个内置兜底，感知引擎不至于空
const fb = { direct: '无法判断', rangef: '无法判断', power: '若有若无', touch: '好像碰到了你的手' }[k];
if (fb) list.push(fb);
}
return list;
}
function eggText() { return (LIB.egg && LIB.egg[0]) || '在你心里'; }
function eggEnabled() { return getUseDefault() && !isOff('egg', eggText()); }
window.locLibGetSys = getSysAll;
window.locLibGetCustomCards = customCards;
window.locLibGetCustomItems = getCustom;
window.locLibSaveCustom = saveCustom;
window.locLibGetGroups = getGroups;
window.locLibSaveGroups = saveGroups;
window.locLibAllEnabled = allEnabled;
window.locLibTypeOf = typeOf;
window.locLibLabel = function (t) { return LABEL[t] || t || ''; };
window.locLibEggText = eggText;
window.locLibEggEnabled = eggEnabled;
window.locLibIsOff = isOff;
window.locLibTextOff = function (text) {
for (let i = 0; i < CATS.length; i++) {
if ((LIB[CATS[i]] || []).indexOf(text) >= 0 && isOff(CATS[i], text)) return true;
}
return false;
};
window.locLibSetOff = setOff;
window.locLibGetUseDefault = getUseDefault;
window.locLibSenseGroup = senseGroup;
const PAGE = document.getElementById('page-loc-cards');
if (!PAGE) return;
let cat = 'dir';      // 分类 tab
let tab2 = 'sys';     // 系统预设 / 我的添加
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
function updateEntryCount() {
const useDefault = getUseDefault();
let sysN = 0;
CATS.forEach(c => { sysN += useDefault ? (LIB[c] || []).filter(x => !isOff(c, x)).length : 0; });
const cnt = document.getElementById('cc-loc-count');
if (cnt) cnt.textContent = sysN;
}
function renderSysList() {
const listEl = document.getElementById('cloc-sys-list');
const titleEl = document.getElementById('cloc-sys-title');
if (titleEl) titleEl.textContent = LABEL[cat] || '';
if (!listEl) return;
listEl.innerHTML = '';
if (!getUseDefault()) {
const tip = document.createElement('div');
tip.className = 'ta-empty';
tip.textContent = '系统预设位置卡已关闭（位置面板只显示「我的添加」）。开启上方开关即可恢复使用。';
listEl.appendChild(tip);
return;
}
if (window.presetGroup) {
const barBox = document.createElement('div');
barBox.innerHTML = window.presetGroup.catBar('loc', cat, LABEL[cat] || cat);
const bar = barBox.firstElementChild;
if (bar) {
listEl.appendChild(bar);
window.presetGroup.bindBar(bar, 'loc', cat, function () { renderSysList(); updateEntryCount(); });
}
}
(LIB[cat] || []).forEach(x => {
const off = isOff(cat, x);
const row = document.createElement('div');
row.className = 'tc-qrow' + (off ? ' off' : '');
row.innerHTML = '<div class="tc-qmain"><div class="tc-qtext">' + esc(x) + ' <span class="tc-known">系统</span></div></div>';
const lab = document.createElement('label');
lab.className = 'toggle ccard-toggle';
lab.innerHTML = '<input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span>';
lab.querySelector('input').addEventListener('change', () => {
const nowOff = !lab.querySelector('input').checked;
setOff(cat, x, nowOff);
renderSysList();
updateEntryCount();
toast((nowOff ? '已关闭：' : '已开启：') + (x.length > 18 ? x.slice(0, 18) + '…' : x));
});
row.appendChild(lab);
listEl.appendChild(row);
});
}
function renderMineList() {
const listEl = document.getElementById('cloc-mine-list');
const titleEl = document.getElementById('cloc-mine-title');
if (titleEl) titleEl.textContent = LABEL[cat] || '';
if (!listEl) return;
const groups = getGroups();
const custom = getCustom();
let html = '';
html += '<div class="mg-grp-row"><button class="cc-tool mg-grp-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>新建分组</button></div>';
if (!custom.length && !groups.length) {
html += '<div class="ta-empty">暂未添加自定义位置卡，可在上方批量输入（每行一个）。</div>';
listEl.innerHTML = html;
bindGroupOps();
return;
}
groups.forEach(g => {
const arr = custom.filter(x => x.grp === g.id);
html += '<div class="cal-card glass mg-block">' +
'<div class="cal-card-title mg-title"><span class="mg-name">' + esc(g.name) + '</span><span class="mg-cnt">(' + arr.length + ')</span>' +
'<span class="mg-ops"><button class="mg-op" data-g="' + esc(g.id) + '" data-op="rn" title="重命名">✎</button><button class="mg-op" data-g="' + esc(g.id) + '" data-op="rm" title="删除分组">✕</button></span></div>' +
(arr.length ? arr.map(x => itemHtml(x, custom.indexOf(x))).join('') : '<div class="ta-empty">这个分组还没有内容</div>') +
'</div>';
});
const ungrouped = custom.filter(x => !x.grp);
html += '<div class="cal-card glass mg-block mg-ungrouped"><div class="cal-card-title mg-title"><span class="mg-name">未分组</span><span class="mg-cnt">(' + ungrouped.length + ')</span></div>';
if (!ungrouped.length) html += '<div class="ta-empty">暂无未分组位置卡，可在上方批量输入</div>';
html += ungrouped.map(x => itemHtml(x, custom.indexOf(x))).join('');
html += '</div>';
listEl.innerHTML = html;
listEl.querySelectorAll('.ta-del').forEach(b => {
b.addEventListener('click', () => {
const list = getCustom();
list.splice(Number(b.dataset.idx), 1);
if (saveCustom(list) === false) return; // #1520：同上
renderMineList();
toast('已删除');
});
});
bindGroupOps();
}
function itemHtml(x, idx) {
return '<div class="tc-qrow"><div class="tc-qmain"><div class="tc-qtext">' + esc(x.t) + '</div></div>' +
'<button class="ta-del" data-idx="' + idx + '">✕</button></div>';
}
function refreshGrpSelect() {
if (!window.cardGroups) { setTimeout(refreshGrpSelect, 50); return; }
const grpSel = document.getElementById('cloc-batch-grp');
if (!grpSel) return;
const groups = getGroups();
grpSel.innerHTML = window.cardGroups.grpOnlyOptsHtml(groups, grpSel.value);
window.cardGroups.bindNewGrp(grpSel, groups, function () { saveGroups(groups); });
}
function bindGroupOps() {
const wrap = document.getElementById('cloc-mine-list');
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
const list = getCustom();
list.forEach(x => { if (x.grp === gid) x.grp = ''; });
if (saveCustom(list) === false) return; // #1520：拦下＝这一发没落笔，不动分组账也不报成功
saveGroups(groups.filter(x => x.id !== gid));
refreshGrpSelect();
renderMineList();
toast('已删除分组「' + g.name + '」');
});
}
});
});
}
function switchTab2(tab) {
tab2 = tab;
const tabsWrap = document.getElementById('loc-tabs');
if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
const sysPanel = document.getElementById('loc-sys-panel');
const minePanel = document.getElementById('loc-mine-panel');
if (sysPanel) sysPanel.hidden = tab !== 'sys';
if (minePanel) minePanel.hidden = tab !== 'mine';
if (tab === 'sys') renderSysList(); else renderMineList();
}
function renderPage() {
document.querySelectorAll('#page-loc-cards .fav-tab').forEach(tab => {
tab.classList.toggle('sel', tab.dataset.loctab === cat);
});
const defEl = document.getElementById('loc-default');
if (defEl) defEl.checked = getUseDefault();
refreshGrpSelect();
switchTab2(tab2);
updateEntryCount();
}
const defEl = document.getElementById('loc-default');
if (defEl) {
defEl.addEventListener('change', () => {
store.set(DEF_KEY, defEl.checked ? '1' : '0');
renderPage();
toast(defEl.checked ? '系统预设位置卡已开启' : '系统预设位置卡已关闭（仅用你添加的位置卡）');
});
}
document.querySelectorAll('#page-loc-cards .fav-tab').forEach(tab => {
tab.addEventListener('click', () => { cat = tab.dataset.loctab; renderPage(); });
});
const tabsWrap = document.getElementById('loc-tabs');
if (tabsWrap) {
tabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
tab.addEventListener('click', () => { switchTab2(tab.dataset.tab); });
});
}
const batchAdd = document.getElementById('cloc-batch-add');
if (batchAdd) {
refreshGrpSelect();
batchAdd.addEventListener('click', () => {
const ta = document.getElementById('cloc-batch');
const raw = ta ? ta.value : '';
const items = raw.split('\n').map(s => s.trim()).filter(Boolean);
if (!items.length) { toast('请输入内容，每行一个'); return; }
const grpSel = document.getElementById('cloc-batch-grp');
const parsed = window.cardGroups ? window.cardGroups.parseCatVal(grpSel ? grpSel.value : '') : null;
const list = getCustom();
items.forEach(it => {
const x = { t: it };
if (parsed && parsed.grp) x.grp = parsed.grp;
list.push(x);
});
if (saveCustom(list) === false) return; // #1520：拦下＝输入框原样保留（用户才有料可「再点一次」）
if (ta) ta.value = '';
switchTab2('mine');
toast('已添加 ' + items.length + ' 条位置卡');
});
}
const newGrpBtn = document.getElementById('loc-new-grp');
if (newGrpBtn) {
newGrpBtn.addEventListener('click', () => {
const groups = getGroups();
if (!window.cardGroups) { toast('分组功能尚未就绪，请稍后再试'); return; }
window.cardGroups.addFlow(groups, g => {
if (!g) return;
saveGroups(groups);
refreshGrpSelect();
renderMineList();
toast('已新建分组「' + g.name + '」');
});
});
}
const liLoc = document.getElementById('li-loc-cards');
const locPage = document.getElementById('page-loc-cards');
if (liLoc && locPage) {
liLoc.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
locPage.hidden = false;
cat = 'dir';
tab2 = 'sys';
const tw = document.getElementById('loc-tabs'); if (tw) tw.style.display = 'none';
renderPage();
});
}
const back = document.getElementById('loc-cards-back');
if (back) {
back.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
});
}
renderPage();
window.__cardSearchFns = window.__cardSearchFns || [];
window.__cardSearchFns.push({ name: 'TA在身边位置卡', fn: function (kw) {
const out = [];
try {
CATS.forEach(function (c) {
(LIB[c] || []).forEach(function (x) {
if (x && String(x).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(x), cat: LABEL[c] + '·系统' });
});
});
getCustom().forEach(function (item) {
const txt = item && item.t ? String(item.t) : '';
if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: '自定义·我的' });
});
} catch (e) {}
return out;
} });
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("loc-lib.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("loc-lib.js"); try { console.error("[JS] loc-lib.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[loc-lib.js] " + String(__e && __e.message || __e)); } })();
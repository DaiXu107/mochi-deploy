(function () { try {
(function () {
let store; try { store = window.xyStore('xy-home-v2'); } catch (e) { store = null; } // v3.27.x #421b：顶层对 window 急切调用加容错（防加载瞬间未就绪整文件报废；downstream store.get/set 均已自带 try/catch 降级）
let groupDecisionPanelRef = null;
window.openGroupDecision = function () {
return groupDecisionPanelRef ? groupDecisionPanelRef.apply(window, arguments)
: (toast('多人决定加载失败'), false);
};
const MEMBERS_KEY = 'gdec-members';
const HISTORY_KEY = 'gdec-history';
const SETTINGS_KEY = 'gdec-settings';
const MIGRATE_KEY = 'gdec-global-migrated';
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
function fmtDT(ts) {
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function loadMembers() {
try { const v = JSON.parse(store.get(MEMBERS_KEY) || 'null'); if (Array.isArray(v)) return v; } catch (e) {}
return ['成员A', '成员B', '成员C', '成员D', '成员E'];
}
function saveMembers(m) { try { store.set(MEMBERS_KEY, JSON.stringify(m)); } catch (e) {} }
function loadSettings() {
const d = { replyToChat: true, typeaThink: 3, typeaMax: 1, typebThink: 3, typebMax: 1 };
try { return Object.assign(d, JSON.parse(store.get(SETTINGS_KEY) || '{}')); } catch (e) { return d; }
}
function saveSettings(s) { store.set(SETTINGS_KEY, JSON.stringify(s)); }
let histReady = false;
let histPending = null;
function loadHistory() { try { const v = JSON.parse(store.get(HISTORY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function saveHistory(h) {
if (!histReady) {
try { histPending = Array.isArray(h) ? h.slice() : []; } catch (e) {}
return;
}
store.set(HISTORY_KEY, JSON.stringify(h));
}
function flushPendingHist() {
if (!histPending) return;
const pending = histPending;
histPending = null;
if (!pending.length) return;
const finish = (base) => {
try { store.set(HISTORY_KEY, JSON.stringify(base)); } catch (e) {}
try { renderHistory(); } catch (e) {}
};
const merge = (base) => {
const have = {};
base.forEach(x => { if (x && x.ts !== undefined) have[x.ts] = true; });
pending.forEach(x => { if (x && x.ts !== undefined && !have[x.ts]) { base.push(x); have[x.ts] = true; } });
finish(base);
};
if (window.idbGet) {
window.idbGet('xy-home-v2:' + HISTORY_KEY).then(v => {
let base = [];
try { const p = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(p)) base = p; } catch (e) {}
loadHistory().forEach(x => {
if (x && x.ts !== undefined && !base.some(b => b && b.ts === x.ts)) base.push(x);
});
merge(base);
}).catch(() => merge(loadHistory()));
} else {
merge(loadHistory());
}
}
function readJsonLs(lsKey) {
try { const v = localStorage.getItem(lsKey); const p = v == null ? null : JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch (e) { return null; }
}
function migrateGlobalData() {
try {
if (store.get(MIGRATE_KEY)) return Promise.resolve();
const HIST_RE = /^xy-home-v2:[^:]+:gdec-history$/;
const MEM_RE = /^xy-home-v2:[^:]+:gdec-members$/;
const SET_RE = /^xy-home-v2:[^:]+:gdec-settings$/;
const histArrs = [], memArrs = [], setCands = [];
try {
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || k === 'xy-home-v2:' + HISTORY_KEY || k === 'xy-home-v2:' + MEMBERS_KEY || k === 'xy-home-v2:' + SETTINGS_KEY) continue;
if (HIST_RE.test(k)) { const v = readJsonLs(k); if (Array.isArray(v)) histArrs.push({ key: k, arr: v }); }
else if (MEM_RE.test(k)) { const v = readJsonLs(k); if (Array.isArray(v)) memArrs.push({ key: k, arr: v, def: k.indexOf(':default:') >= 0 }); }
else if (SET_RE.test(k)) { const v = readJsonLs(k); if (v && !Array.isArray(v)) setCands.push({ key: k, val: v }); }
}
} catch (e) {}
let scan = Promise.resolve();
if (window.idbGetAllKeys && window.idbGet) {
scan = window.idbGetAllKeys().then(function (keys) {
const want = (keys || []).filter(function (k) {
return typeof k === 'string' && k !== 'xy-home-v2:' + HISTORY_KEY && k !== 'xy-home-v2:' + MEMBERS_KEY && k !== 'xy-home-v2:' + SETTINGS_KEY && (HIST_RE.test(k) || MEM_RE.test(k) || SET_RE.test(k));
});
return want.reduce(function (p, k) {
return p.then(function () {
return Promise.resolve(window.idbGet(k)).then(function (v) {
let parsed = null;
try { parsed = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) {}
if (!parsed) return;
if (HIST_RE.test(k) && Array.isArray(parsed)) histArrs.push({ key: k, arr: parsed });
else if (MEM_RE.test(k) && Array.isArray(parsed)) memArrs.push({ key: k, arr: parsed, def: k.indexOf(':default:') >= 0 });
else if (SET_RE.test(k) && typeof parsed === 'object') setCands.push({ key: k, val: parsed });
}).catch(function () {});
});
}, Promise.resolve());
}).catch(function () {});
}
return scan.then(function () {
const mergedH = {};
loadHistory().forEach(x => { if (x && x.ts !== undefined) mergedH[x.ts] = x; });
histArrs.forEach(h => h.arr.forEach(x => { if (x && x.ts !== undefined && !mergedH[x.ts]) mergedH[x.ts] = x; }));
const outH = Object.keys(mergedH).map(k => mergedH[k]);
outH.sort((a, b) => (b.ts || 0) - (a.ts || 0));
if (outH.length) store.set(HISTORY_KEY, JSON.stringify(outH.slice(0, 1000)));
if (readJsonLs('xy-home-v2:' + MEMBERS_KEY) === null && memArrs.length) {
memArrs.sort(function (a, b) { return (b.def ? 1 : 0) - (a.def ? 1 : 0); });
const seen = {}, union = [];
memArrs.forEach(m => m.arr.forEach(n => {
if (typeof n === 'string' && n.trim() && !seen[n]) { seen[n] = true; union.push(n); }
}));
if (union.length) saveMembers(union);
}
if (readJsonLs('xy-home-v2:' + SETTINGS_KEY) === null) {
setCands.sort(function (a, b) {
return (a.key.indexOf(':default:') >= 0 ? 0 : 1) - (b.key.indexOf(':default:') >= 0 ? 0 : 1);
});
if (setCands[0]) store.set(SETTINGS_KEY, JSON.stringify(setCands[0].val));
}
histArrs.map(h => h.key)
.concat(memArrs.map(m => m.key))
.concat(setCands.map(s => s.key))
.forEach(k => {
try { localStorage.removeItem(k); } catch (e) {}
try { if (window.idbDelete) window.idbDelete(k); } catch (e) {}
});
store.set(MIGRATE_KEY, '1');
});
} catch (e) { return Promise.resolve(); }
}
function onGdHistRestore() {
Promise.resolve(migrateGlobalData()).catch(function () {}).then(function () {
histReady = true;
flushPendingHist();
});
}
try {
if (window.__mochiDataReady) onGdHistRestore();
else document.addEventListener('mochi-restore-done', onGdHistRestore);
} catch (e) {}
document.addEventListener('contact-switched', function () {
histReady = true; flushPendingHist();
try { if (gdCountdownTimer) { clearInterval(gdCountdownTimer); gdCountdownTimer = null; } } catch (e) {}
try { if (gdDecideTimer) { clearTimeout(gdDecideTimer); gdDecideTimer = null; } } catch (e) {}
});
let activeTab = 'typea';
let gdCountdownTimer = null;
let gdDecideTimer = null;
let gdPanelFromGroup = false; // v3.26.x：本面板是否从群聊页打开（是→结果发到群聊，否→发到聊天）
const panel = document.getElementById('chat-gdecision-panel');
const body = document.getElementById('chat-gdecision-body');
function ensureBuilt() {
if (!body || body.dataset.built) return;
body.innerHTML = panelHtml();
bindEvents();
body.dataset.built = '1';
}
function openPanel() {
if (!body || !panel) return;
try { gdPanelFromGroup = !!(window.gcIsVisible && window.gcIsVisible()); } catch (e) { gdPanelFromGroup = false; }
ensureBuilt();
activeTab = 'typea';
document.querySelectorAll('#chat-gdecision-body .dc-tab').forEach(tb => tb.classList.toggle('sel', tb.dataset.dtab === 'typea'));
document.querySelectorAll('#chat-gdecision-body .dc-panel').forEach(p => { p.hidden = p.dataset.dpanel !== 'typea'; });
applySettings();
renderMembers();
panel.hidden = false;
}
function panelHtml() {
return '' +
'<div class="gd-members">' +
'<div class="gd-members-head"><span class="gd-members-label">选择参与决定的成员</span>' +
'<div class="gd-members-actions">' +
'<button class="gd-btn-sm" id="gd-member-add">+ 添加</button>' +
'<button class="gd-btn-sm" id="gd-member-all">全选</button>' +
'<button class="gd-btn-sm" id="gd-member-del">− 删除</button></div></div>' +
'<div class="gd-members-list" id="gd-members-list"></div></div>' +
'<div class="dc-tabs"><button class="dc-tab sel" data-dtab="typea">是/否/半对</button>' +
'<button class="dc-tab" data-dtab="typeb">自定义选项</button>' +
'<button class="dc-tab" data-dtab="history">历史记录</button></div>' +
'<div class="dc-panel" data-dpanel="typea">' +
'<div class="sm-fld"><label>输入你的纠结</label><div class="dec-inp-wrap"><textarea class="tc-input" id="gd-q-a" rows="3" placeholder="例如：我们今晚吃什么？"></textarea><button class="dec-inp-clear" data-clear="gd-q-a" aria-label="清空" title="清空">✕</button></div></div>' +
'<div class="gs-row"><span>思考时间（秒）</span><div class="stepper" id="gd-think-a" data-min="1" data-max="10" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="gd-think-a-val" readonly><button class="stp-max">+</button></div></div>' +
'<div class="gs-row"><span>最多选几个（每人）</span><div class="stepper" id="gd-max-a" data-min="1" data-max="5" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="gd-max-a-val" readonly><button class="stp-max">+</button></div></div>' +
'<button class="ta-add-btn" style="width:100%;margin-top:10px" id="gd-go-a">让群成员决定</button>' +
'<div class="gd-result" id="gd-result-a" hidden></div></div>' +
'<div class="dc-panel" data-dpanel="typeb" hidden>' +
'<div class="sm-fld"><label>输入你的纠结</label><div class="dec-inp-wrap"><textarea class="tc-input" id="gd-q-b" rows="2" placeholder="例如：我们周末去哪玩？"></textarea><button class="dec-inp-clear" data-clear="gd-q-b" aria-label="清空" title="清空">✕</button></div></div>' +
'<div class="sm-fld"><label>输入选项（每行一个）</label><div class="dec-inp-wrap"><textarea class="tc-input" id="gd-opts" rows="4" placeholder="吃火锅&#10;吃烧烤&#10;吃日料"></textarea><button class="dec-inp-clear" data-clear="gd-opts" aria-label="清空" title="清空">✕</button></div></div>' +
'<div class="gs-row"><span>思考时间（秒）</span><div class="stepper" id="gd-think-b" data-min="1" data-max="10" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="gd-think-b-val" readonly><button class="stp-max">+</button></div></div>' +
'<div class="gs-row"><span>最多选几个（每人）</span><div class="stepper" id="gd-max-b" data-min="1" data-max="5" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="gd-max-b-val" readonly><button class="stp-max">+</button></div></div>' +
'<button class="ta-add-btn" style="width:100%;margin-top:10px" id="gd-go-b">让群成员决定</button>' +
'<div class="gd-result" id="gd-result-b" hidden></div></div>' +
'<div class="dc-panel" data-dpanel="history" hidden>' +
'<div class="sm-set-row"><span>结果发送到聊天</span><label class="toggle"><input type="checkbox" id="gd-reply-chat"><span class="tk"></span></label></div>' +
'<div id="gd-history"></div></div>' +
'<div class="dc-credit">多人决定功能参考：小红书@FelixFelicis（9416318007）</div>';
}
function applySettings() {
const s = loadSettings();
const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
setVal('gd-think-a-val', s.typeaThink);
setVal('gd-max-a-val', s.typeaMax);
setVal('gd-think-b-val', s.typebThink);
setVal('gd-max-b-val', s.typebMax);
const rc = document.getElementById('gd-reply-chat');
if (rc) rc.checked = !!s.replyToChat;
}
function renderMembers() {
const list = document.getElementById('gd-members-list');
if (!list) return;
const members = loadMembers();
list.innerHTML = members.length
? members.map((m, i) =>
'<label class="gd-member on"><input type="checkbox" id="gm-' + i + '" checked><span>' + esc(m) + '</span></label>'
).join('')
: '<span class="gd-empty-tip">还没有成员，点「+ 添加」创建</span>';
}
function checkedIndexes() {
const out = [];
document.querySelectorAll('#gd-members-list input[type="checkbox"]').forEach(cb => {
if (cb.checked) out.push(parseInt(cb.id.replace('gm-', ''), 10));
});
return out;
}
function bindEvents() {
const scope = '#chat-gdecision-body';
document.querySelectorAll(scope + ' .dc-tab').forEach(tb => {
tb.addEventListener('click', () => {
activeTab = tb.dataset.dtab;
document.querySelectorAll(scope + ' .dc-tab').forEach(x => x.classList.toggle('sel', x === tb));
document.querySelectorAll(scope + ' .dc-panel').forEach(p => { p.hidden = p.dataset.dpanel !== activeTab; });
if (activeTab === 'history') renderHistory();
});
});
const mList = document.getElementById('gd-members-list');
if (mList) {
mList.addEventListener('change', (e) => {
const cb = e.target;
if (cb && cb.tagName === 'INPUT') cb.closest('.gd-member').classList.toggle('on', cb.checked);
});
}
const addBtn = document.getElementById('gd-member-add');
if (addBtn) addBtn.addEventListener('click', () => {
if (!window.openModal) { toast('弹窗组件未就绪'); return; }
window.openModal('添加成员', '', (v) => {
const name = String(v || '').trim();
if (!name) return;
const members = loadMembers();
if (members.includes(name)) { toast('成员已存在'); return; }
members.push(name);
saveMembers(members);
renderMembers();
toast('成员已添加');
}, { placeholder: '成员名称', maxlength: 12 });
});
const allBtn = document.getElementById('gd-member-all');
if (allBtn) allBtn.addEventListener('click', () => {
const cbs = document.querySelectorAll('#gd-members-list input[type="checkbox"]');
if (!cbs.length) return;
const allChecked = Array.prototype.every.call(cbs, cb => cb.checked);
cbs.forEach(cb => {
cb.checked = !allChecked;
cb.closest('.gd-member').classList.toggle('on', cb.checked);
});
});
const delBtn = document.getElementById('gd-member-del');
if (delBtn) delBtn.addEventListener('click', () => {
const idxs = checkedIndexes();
if (!idxs.length) { toast('请先点选要删除的成员'); return; }
if (!window.openModal) { toast('弹窗组件未就绪'); return; }
window.openModal('删除选中的成员？', '', (v) => {
if (v !== 'ok') return;
const members = loadMembers();
idxs.sort((a, b) => b - a).forEach(i => { members.splice(i, 1); });
saveMembers(members);
renderMembers();
toast('已删除 ' + idxs.length + ' 个成员');
}, { noInput: true, staticText: '将删除 ' + idxs.length + ' 个成员（历史记录保留）' });
});
const sMap = { 'gd-think-a': 'typeaThink', 'gd-max-a': 'typeaMax', 'gd-think-b': 'typebThink', 'gd-max-b': 'typebMax' };
Object.keys(sMap).forEach(id => {
const st = document.getElementById(id);
if (!st) return;
const val = st.querySelector('.stp-val');
const min = parseInt(st.dataset.min, 10), max = parseInt(st.dataset.max, 10);
const save = (v) => { const s = loadSettings(); s[sMap[id]] = v; saveSettings(s); };
st.querySelector('.stp-min').addEventListener('click', () => {
const nv = Math.max(min, parseInt(val.value, 10) - 1);
val.value = nv; save(nv);
});
st.querySelector('.stp-max').addEventListener('click', () => {
const nv = Math.min(max, parseInt(val.value, 10) + 1);
val.value = nv; save(nv);
});
});
const goA = document.getElementById('gd-go-a');
if (goA) goA.addEventListener('click', () => makeGroupDecision('typea'));
const goB = document.getElementById('gd-go-b');
if (goB) goB.addEventListener('click', () => makeGroupDecision('typeb'));
document.querySelectorAll(scope + ' .dec-inp-clear').forEach(btn => {
btn.addEventListener('click', () => {
const id = btn.dataset.clear;
const ta = document.getElementById(id);
if (!ta) return;
const box = ta.__ceBox;
if (box) box.textContent = '';
else ta.value = '';
ta.focus();
toast('已清空');
});
});
const rc = document.getElementById('gd-reply-chat');
if (rc) { rc.addEventListener('change', () => { const s = loadSettings(); s.replyToChat = rc.checked; saveSettings(s); }); }
}
function makeGroupDecision(type) {
if (gdCountdownTimer) { clearInterval(gdCountdownTimer); gdCountdownTimer = null; }
if (gdDecideTimer) { clearTimeout(gdDecideTimer); gdDecideTimer = null; }
const members = loadMembers();
const selectedMembers = checkedIndexes().map(i => members[i]).filter(Boolean);
if (!selectedMembers.length) { toast('请至少选择一个成员'); return; }
const qId = type === 'typea' ? 'gd-q-a' : 'gd-q-b';
const question = ((document.getElementById(qId) || {}).value || '').trim();
if (!question) { toast('请输入你的问题'); return; }
const thinkTime = parseInt(document.getElementById(type === 'typea' ? 'gd-think-a-val' : 'gd-think-b-val').value, 10) || 3;
const maxSelect = parseInt(document.getElementById(type === 'typea' ? 'gd-max-a-val' : 'gd-max-b-val').value, 10) || 1;
let options = null;
if (type === 'typeb') {
const optsText = ((document.getElementById('gd-opts') || {}).value || '').trim();
if (!optsText) { toast('请输入选项'); return; }
options = optsText.split('\n').map(o => o.trim()).filter(Boolean);
if (options.length < 2) { toast('至少需要 2 个选项'); return; }
}
const resultEl = document.getElementById(type === 'typea' ? 'gd-result-a' : 'gd-result-b');
resultEl.hidden = false;
resultEl.classList.remove('done');
resultEl.textContent = selectedMembers.join('、') + ' 正在思考中… ' + thinkTime + ' 秒';
let count = thinkTime;
gdCountdownTimer = setInterval(() => {
count--;
if (count > 0) resultEl.textContent = selectedMembers.join('、') + ' 正在思考中… ' + count + ' 秒';
}, 1000);
const myCid = window.__activeCid || 'default';
gdDecideTimer = setTimeout(() => {
gdDecideTimer = null;
if ((window.__activeCid || 'default') !== myCid) return;
if (gdCountdownTimer) { clearInterval(gdCountdownTimer); gdCountdownTimer = null; }
const pool = type === 'typea'
? ['是', '否', '半对', '这个我不选', '正在忙，暂未回复']
: options.concat(['这个我不选', '正在忙，暂未回复']);
const results = {};
selectedMembers.forEach(m => {
const shuffled = pool.slice().sort(() => Math.random() - 0.5);
const n = Math.floor(Math.random() * maxSelect) + 1;
results[m] = shuffled.slice(0, Math.min(n, shuffled.length)).join('、');
});
const resultStr = selectedMembers.map(m => m + '：' + results[m]).join('\n');
resultEl.textContent = resultStr;
resultEl.classList.add('done');
const gdSettle = () => {
if ((window.__activeCid || 'default') !== myCid) return;
const h = loadHistory();
h.unshift({ id: 'gd_' + Date.now(), type: type, question: question, members: selectedMembers, results: results, options: options, ts: Date.now() });
if (h.length > 1000) h.splice(1000);
saveHistory(h);
if (loadSettings().replyToChat) {
const lines = selectedMembers.map(m => '【' + m + '】' + results[m]);
const replyText = type === 'typeb' && options
? '【多人决定】' + question + '\n选项：\n' + options.map((o, i) => (i + 1) + '. ' + o).join('\n') + '\n' + lines.join('\n')
: '【多人决定】' + question + '\n' + lines.join('\n');
if (gdPanelFromGroup && window.gcSendDecisionText) window.gcSendDecisionText(replyText); // 群聊那一路自己响 playSfxGc('in')，此处不补（补了就是两声）
else if (window.chatAddIn) {
window.chatAddIn(replyText, { enter: true, silent: true, follow: true, dedupExempt: true, rateAllow: true, nightAllow: true }); // FIX 2026-09-15 #492 多人决定结果是用户主动触发，跟底不吃 in 侧钉住闸（chat.js follow 通道）；FIX 2026-09-15 #544 dedupExempt 决定答案豁免收件侧去重（同 decision.js #544 口径）
try { if (window.playSfx) window.playSfx('in'); } catch (e) {} // FIX 2026-09-21 #968 多人决定结果响收消息音效
}
}
toast('多人决定已完成');
};
let gdSettled = false;
const gdRunSettle = () => {
if (gdSettled) return;
gdSettled = true;
try { if (gdIdleId && window.cancelIdleCallback) window.cancelIdleCallback(gdIdleId); } catch (e) {}
clearTimeout(gdSettleT);
gdSettle();
};
let gdIdleId = window.requestIdleCallback ? window.requestIdleCallback(gdRunSettle, { timeout: 600 }) : 0;
const gdSettleT = setTimeout(gdRunSettle, 80);
}, thinkTime * 1000);
}
function fmtDayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function fmtDayLabel(ts) {
const d = new Date(ts); const now = new Date();
const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '年' + md;
}
function histItemHtml(r) {
const resultsStr = (r.members || []).map(m => m + '：' + ((r.results || {})[m] || '')).join('\n');
return '<div class="tc-listitem">' +
'<div class="tc-li-q">' + esc(r.question) + '</div>' +
(r.options && r.options.length ? '<div class="dc-h-options">选项：' + r.options.map((o, i) => (i + 1) + '. ' + esc(o)).join('，') + '</div>' : '') +
'<div class="dc-h-result gd-pre">' + esc(resultsStr) + '</div>' +
'<div class="dc-h-time">' + fmtDT(r.ts) + '</div></div>';
}
function renderHistory() {
const el = document.getElementById('gd-history');
if (!el) return;
const h = loadHistory();
if (!h.length) { el.innerHTML = ((window.mochiDataPending && window.mochiDataPending()) ? window.mochiLoadingHtml('多人决定记录') : '<div class="ta-empty">暂无多人决定记录</div>'); return; }
const today = fmtDayKey(Date.now());
const todayItems = [], pastDays = {}, pastKeys = [];
h.forEach(r => {
if (!r || r.ts === undefined) return;
const k = fmtDayKey(r.ts);
if (k === today) { todayItems.push(r); return; }
if (!pastDays[k]) { pastDays[k] = { label: fmtDayLabel(r.ts), items: [] }; pastKeys.push(k); }
pastDays[k].items.push(r);
});
const pastCount = pastKeys.reduce((n, k) => n + pastDays[k].items.length, 0);
let html = todayItems.length ? todayItems.map(histItemHtml).join('') : '<div class="dc-h-day-empty">今天暂无记录</div>';
if (pastCount) {
html += '<details class="dc-h-more"><summary class="dc-h-more-sum">更早记录<span class="dc-h-more-cnt">' + pastCount + ' 条</span></summary><div class="dc-h-more-body">' +
pastKeys.map(k => '<div class="dc-h-day"><div class="dc-h-day-label">' + pastDays[k].label + '</div>' + pastDays[k].items.map(histItemHtml).join('') + '</div>').join('') +
'</div></details>';
}
el.innerHTML = html;
}
if (window.mochiOnDataReady) window.mochiOnDataReady(function () { try { renderHistory(); } catch (e) {} });
groupDecisionPanelRef = openPanel;
const closeBtn = document.getElementById('chat-gdecision-close');
if (closeBtn) closeBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (panel) panel.hidden = true;
});
if (window.mochiSheetOutsideClose && panel) window.mochiSheetOutsideClose(panel, () => { panel.hidden = true; });
(function bindEntry() {
const btn = document.getElementById('more-gdecide');
if (!btn) return;
btn.addEventListener('click', (e) => {
e.stopPropagation();
const mp = document.getElementById('chat-more-panel');
if (mp) mp.hidden = true;
if (window.openGroupDecision) {
const pc = document.getElementById('poke-card');
if (pc) pc.hidden = true;
const ep = document.getElementById('emoji-panel');
if (ep) ep.hidden = true;
const askClose = document.getElementById('chat-ask-close');
const askP = document.getElementById('chat-ask-panel');
if (askP && !askP.hidden && askClose) askClose.click();
else if (askP) askP.hidden = true;
const cs = document.getElementById('chat-search');
if (cs) cs.hidden = true;
const dv = document.getElementById('chat-divine-panel');
if (dv) dv.hidden = true;
const dp = document.getElementById('chat-decision-panel');
if (dp) dp.hidden = true;
if (window.closeAvlib) window.closeAvlib();
window.openGroupDecision();
} else toast('多人决定加载失败');
});
try {
if (window.MutationObserver) {
const SIBLING_IDS = ['chat-decision-panel', 'chat-divine-panel', 'chat-ask-panel', 'poke-card', 'emoji-panel', 'chat-search', 'chat-more-panel'];
const mo = new MutationObserver(() => {
if (panel.hidden) return;
for (let i = 0; i < SIBLING_IDS.length; i++) {
const el = document.getElementById(SIBLING_IDS[i]);
if (el && !el.hidden) { panel.hidden = true; break; }
}
});
SIBLING_IDS.forEach(id => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
}
} catch (e) {}
})();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("group-decision.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("group-decision.js"); try { console.error("[JS] group-decision.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[group-decision.js] " + String(__e && __e.message || __e)); } })();
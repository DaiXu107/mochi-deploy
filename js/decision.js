(function () { try {
(function () {
let uid; try { uid = window.activePrefix(); } catch (e) { uid = null; } // 历史遗留声明（未使用）；v3.27.x#421b：顶层对 window 的急切调用加容错——原写法若加载瞬间全局未就绪，第一句即抛错、整文件报废、openDecision 永不绑定（用户报「帮我决定加载失败」跨机型反复出现）
let decisionPanelRef = null;
window.openDecision = function () {
return decisionPanelRef ? decisionPanelRef.apply(window, arguments)
: (toast('帮我决定加载失败'), false);
};
const store = window.xyStore('xy-home-v2');
const HISTORY_KEY = 'decision-history';
const SETTINGS_KEY = 'decision-settings';
const MIGRATE_KEY = 'dec-global-migrated';
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
function partnerName() { try { const s = window.activeStore(); return s.get('lbl-partner') || s.get('cs-lbl-partner') || 'TA'; } catch (e) { return 'TA'; } }
function fmtDT(ts) {
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
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
const HIST_RE = /^xy-home-v2:[^:]+:decision-history$/;
const SET_RE = /^xy-home-v2:[^:]+:decision-settings$/;
const histArrs = [], setCands = [];
try {
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || k === 'xy-home-v2:' + HISTORY_KEY || k === 'xy-home-v2:' + SETTINGS_KEY) continue;
if (HIST_RE.test(k)) { const v = readJsonLs(k); if (Array.isArray(v)) histArrs.push({ key: k, arr: v }); }
else if (SET_RE.test(k)) { const v = readJsonLs(k); if (v && !Array.isArray(v)) setCands.push({ key: k, val: v }); }
}
} catch (e) {}
let scan = Promise.resolve();
if (window.idbGetAllKeys && window.idbGet) {
scan = window.idbGetAllKeys().then(function (keys) {
const want = (keys || []).filter(function (k) { return typeof k === 'string' && k !== 'xy-home-v2:' + HISTORY_KEY && k !== 'xy-home-v2:' + SETTINGS_KEY && (HIST_RE.test(k) || SET_RE.test(k)); });
return want.reduce(function (p, k) {
return p.then(function () {
return Promise.resolve(window.idbGet(k)).then(function (v) {
let parsed = null;
try { parsed = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) {}
if (!parsed) return;
if (HIST_RE.test(k) && Array.isArray(parsed)) histArrs.push({ key: k, arr: parsed });
else if (SET_RE.test(k) && typeof parsed === 'object') setCands.push({ key: k, val: parsed });
}).catch(function () {});
});
}, Promise.resolve());
}).catch(function () {});
}
return scan.then(function () {
const merged = {};
loadHistory().forEach(x => { if (x && x.ts !== undefined) merged[x.ts] = x; });
histArrs.forEach(h => h.arr.forEach(x => { if (x && x.ts !== undefined && !merged[x.ts]) merged[x.ts] = x; }));
const out = Object.keys(merged).map(k => merged[k]);
out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
if (out.length) store.set(HISTORY_KEY, JSON.stringify(out.slice(0, 1000)));
if (readJsonLs('xy-home-v2:' + SETTINGS_KEY) === null) {
setCands.sort(function (a, b) {
return (a.key.indexOf(':default:') >= 0 ? 0 : 1) - (b.key.indexOf(':default:') >= 0 ? 0 : 1);
});
if (setCands[0]) store.set(SETTINGS_KEY, JSON.stringify(setCands[0].val));
}
histArrs.concat(setCands.map(s => ({ key: s.key }))).forEach(h => {
try { localStorage.removeItem(h.key); } catch (e) {}
try { if (window.idbDelete) window.idbDelete(h.key); } catch (e) {}
});
store.set(MIGRATE_KEY, '1');
});
} catch (e) { return Promise.resolve(); }
}
function onDecHistRestore() {
Promise.resolve(migrateGlobalData()).catch(function () {}).then(function () {
histReady = true;
flushPendingHist();
});
}
try {
if (window.__mochiDataReady) onDecHistRestore();
else document.addEventListener('mochi-restore-done', onDecHistRestore);
} catch (e) {}
document.addEventListener('contact-switched', function () {
try { histReady = true; flushPendingHist(); } catch (e) {}
try { if (decideTimer) { clearTimeout(decideTimer); decideTimer = null; } } catch (e) {}
try { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } } catch (e) {}
});
function loadSettings() {
const d = { replyToChat: true, thinkA: 3, thinkB: 3, maxB: 1 };
try { return Object.assign(d, JSON.parse(store.get(SETTINGS_KEY) || '{}')); } catch (e) { return d; }
}
function saveSettings(s) { store.set(SETTINGS_KEY, JSON.stringify(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
let activeTab = 'typea';
let countdownTimer = null;
let decideTimer = null; // v3.6.x：结果 setTimeout 句柄——防连点导致历史/聊天消息重复
let panelFromGroup = false; // v3.26.x：本面板是否从群聊页打开（是→结果发到群聊，否→发到聊天）
const panel = document.getElementById('chat-decision-panel');
const body = document.getElementById('chat-decision-body');
function ensureBuilt() {
if (!body || body.dataset.built) return;
body.innerHTML = panelHtml();
bindEvents();
body.dataset.built = '1';
}
function openPanel() {
if (!body || !panel) return;
try { panelFromGroup = !!(window.gcIsVisible && window.gcIsVisible()); } catch (e) { panelFromGroup = false; }
ensureBuilt();
activeTab = 'typea';
document.querySelectorAll('#chat-decision-body .dc-tab').forEach(tb => tb.classList.toggle('sel', tb.dataset.dtab === 'typea'));
document.querySelectorAll('#chat-decision-body .dc-panel').forEach(p => { p.hidden = p.dataset.dpanel !== 'typea'; });
applySettings();
panel.hidden = false;
}
function closePanel() {
if (panel) panel.hidden = true;
}
if (window.mochiSheetOutsideClose) window.mochiSheetOutsideClose(panel, closePanel);
function panelHtml() {
return '' +
'<div class="dc-tabs"><button class="dc-tab sel" data-dtab="typea">是/否/半对</button>' +
'<button class="dc-tab" data-dtab="typeb">自定义选项</button>' +
'<button class="dc-tab" data-dtab="history">历史记录</button></div>' +
'<div class="dc-panel" data-dpanel="typea">' +
'<div class="sm-fld"><label>输入你的纠结</label><div class="dec-inp-wrap"><textarea class="tc-input" id="dec-q-a" rows="3" placeholder="例如：我今晚该吃火锅吗？"></textarea><button class="dec-inp-clear" data-clear="dec-q-a" aria-label="清空" title="清空">✕</button></div></div>' +
'<div class="gs-row"><span>思考时间（秒）</span><div class="stepper" id="dec-think-a" data-min="1" data-max="10" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="dec-think-a-val" readonly><button class="stp-max">+</button></div></div>' +
'<button class="ta-add-btn" style="width:100%;margin-top:10px" id="dec-go-a">让对方决定</button>' +
'<div class="dc-result" id="dec-result-a" hidden></div></div>' +
'<div class="dc-panel" data-dpanel="typeb" hidden>' +
'<div class="sm-fld"><label>输入你的纠结</label><div class="dec-inp-wrap"><textarea class="tc-input" id="dec-q-b" rows="2" placeholder="例如：我今晚该吃什么？"></textarea><button class="dec-inp-clear" data-clear="dec-q-b" aria-label="清空" title="清空">✕</button></div></div>' +
'<div class="sm-fld"><label>输入选项（每行一个）</label><div class="dec-inp-wrap"><textarea class="tc-input" id="dec-opts" rows="4" placeholder="吃火锅&#10;吃烧烤&#10;吃日料"></textarea><button class="dec-inp-clear" data-clear="dec-opts" aria-label="清空" title="清空">✕</button></div></div>' +
'<div class="gs-row"><span>思考时间（秒）</span><div class="stepper" id="dec-think-b" data-min="1" data-max="10" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="dec-think-b-val" readonly><button class="stp-max">+</button></div></div>' +
'<div class="gs-row"><span>最多选几个</span><div class="stepper" id="dec-max-b" data-min="1" data-max="5" data-step="1"><button class="stp-min">−</button><input class="stp-val" id="dec-max-b-val" readonly><button class="stp-max">+</button></div></div>' +
'<button class="ta-add-btn" style="width:100%;margin-top:10px" id="dec-go-b">让对方决定</button>' +
'<div class="dc-result" id="dec-result-b" hidden></div></div>' +
'<div class="dc-panel" data-dpanel="history" hidden>' +
'<div class="sm-set-row"><span>结果发送到聊天</span><label class="toggle"><input type="checkbox" id="dec-reply-chat"><span class="tk"></span></label></div>' +
'<div id="dec-history"></div></div>' +
'<div class="dc-credit">帮我决定功能参考：小红书@FelixFelicis（9416318007）</div>';
}
function applySettings() {
const s = loadSettings();
const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
setVal('dec-think-a-val', s.thinkA);
setVal('dec-think-b-val', s.thinkB);
setVal('dec-max-b-val', s.maxB);
const rc = document.getElementById('dec-reply-chat');
if (rc) rc.checked = !!s.replyToChat;
}
function bindEvents() {
const scope = '#chat-decision-body';
document.querySelectorAll(scope + ' .dc-tab').forEach(tb => {
tb.addEventListener('click', () => {
activeTab = tb.dataset.dtab;
document.querySelectorAll(scope + ' .dc-tab').forEach(x => x.classList.toggle('sel', x === tb));
document.querySelectorAll(scope + ' .dc-panel').forEach(p => { p.hidden = p.dataset.dpanel !== activeTab; });
if (activeTab === 'history') renderHistory();
});
});
const sMap = { 'dec-think-a': 'thinkA', 'dec-think-b': 'thinkB', 'dec-max-b': 'maxB' };
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
const goA = document.getElementById('dec-go-a');
if (goA) goA.addEventListener('click', () => makeDecision('typea'));
const goB = document.getElementById('dec-go-b');
if (goB) goB.addEventListener('click', () => makeDecision('typeb'));
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
const rc = document.getElementById('dec-reply-chat');
if (rc) { rc.addEventListener('change', () => { const s = loadSettings(); s.replyToChat = rc.checked; saveSettings(s); }); }
}
function makeDecision(type) {
if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
if (decideTimer) { clearTimeout(decideTimer); decideTimer = null; }
let question, thinkTime, maxSelect;
if (type === 'typea') {
question = (document.getElementById('dec-q-a').value || '').trim();
thinkTime = parseInt(document.getElementById('dec-think-a-val').value, 10) || 3;
maxSelect = 1; // 是/否/半对：固定单选，最多选几个只用于自定义选项
} else {
question = (document.getElementById('dec-q-b').value || '').trim();
thinkTime = parseInt(document.getElementById('dec-think-b-val').value, 10) || 3;
maxSelect = parseInt(document.getElementById('dec-max-b-val').value, 10) || 1;
}
if (!question) { toast('请输入你的问题'); return; }
let options = null;
if (type === 'typeb') {
const optsText = (document.getElementById('dec-opts').value || '').trim();
if (!optsText) { toast('请输入选项'); return; }
options = optsText.split('\n').map(o => o.trim()).filter(Boolean);
if (options.length < 2) { toast('至少需要 2 个选项'); return; }
}
const resultEl = document.getElementById(type === 'typea' ? 'dec-result-a' : 'dec-result-b');
resultEl.hidden = false;
resultEl.classList.remove('done');
resultEl.textContent = '对方正在思考中… ' + thinkTime + ' 秒';
let count = thinkTime;
countdownTimer = setInterval(() => {
count--;
if (count > 0) resultEl.textContent = '对方正在思考中… ' + count + ' 秒';
}, 1000);
const myCid = window.__activeCid || 'default';
decideTimer = setTimeout(() => {
decideTimer = null;
if ((window.__activeCid || 'default') !== myCid) return;
if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
let result;
if (type === 'typea') {
const pool = ['是', '否', '半对', '这个我不选', '正在忙，暂未回复'];
const shuffled = pool.slice().sort(() => Math.random() - 0.5);
const n = Math.floor(Math.random() * maxSelect) + 1;
result = shuffled.slice(0, Math.min(n, shuffled.length)).join('、');
} else {
const pool = options.slice().concat(['这个我不选', '正在忙，暂未回复']);
const shuffled = pool.slice().sort(() => Math.random() - 0.5);
const n = Math.floor(Math.random() * maxSelect) + 1;
result = shuffled.slice(0, Math.min(n, shuffled.length)).join('、');
}
resultEl.textContent = result;
resultEl.classList.add('done');
const settle = () => {
if ((window.__activeCid || 'default') !== myCid) return;
const h = loadHistory();
h.unshift({ id: 'd_' + Date.now(), type: type, question: question, result: result, options: options, ts: Date.now() });
if (h.length > 1000) h.splice(1000);
saveHistory(h);
if (loadSettings().replyToChat) {
const replyText = type === 'typeb' && options
? '【帮我决定】' + question + '\n选项：\n' + options.map((o, i) => (i + 1) + '. ' + o).join('\n') + '\n→ ' + result
: '【帮我决定】' + question + ' → ' + result;
if (panelFromGroup && window.gcSendDecisionText) window.gcSendDecisionText(replyText); // 群聊那一路自己响 playSfxGc('in')，此处不补（补了就是两声）
else if (window.chatAddIn) {
window.chatAddIn(replyText, { enter: true, silent: true, follow: true, dedupExempt: true, rateAllow: true, nightAllow: true }); // FIX 2026-09-15 #492 帮我决定结果是用户主动触发，跟底不吃 in 侧钉住闸（chat.js follow 通道）；FIX 2026-09-15 #544 dedupExempt 决定答案豁免收件侧去重（快速重跑同问题同文答案被 2500ms 窗静默吞且连锁吞多条，用户视角「联系人消息被吞了几条」。#544 编号顺延：#542 已被并行会话（房间亮度）占用）
try { if (window.playSfx) window.playSfx('in'); } catch (e) {} // FIX 2026-09-21 #968 帮我决定结果响收消息音效
}
}
toast('帮我决定已完成');
};
let settled = false;
const runSettle = () => {
if (settled) return;
settled = true;
try { if (idleId && window.cancelIdleCallback) window.cancelIdleCallback(idleId); } catch (e) {}
clearTimeout(settleT);
settle();
};
let idleId = window.requestIdleCallback ? window.requestIdleCallback(runSettle, { timeout: 600 }) : 0;
const settleT = setTimeout(runSettle, 80);
}, thinkTime * 1000);
}
function fmtDayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function fmtDayLabel(ts) {
const d = new Date(ts); const now = new Date();
const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '年' + md;
}
function histItemHtml(r) {
return '<div class="tc-listitem">' +
'<div class="tc-li-q">' + esc(r.question) + '</div>' +
(r.options && r.options.length ? '<div class="dc-h-options">选项：' + r.options.map((o, i) => (i + 1) + '. ' + esc(o)).join('，') + '</div>' : '') +
'<div class="dc-h-result">→ ' + esc(r.result) + '</div>' +
'<div class="dc-h-time">' + fmtDT(r.ts) + '</div></div>';
}
function renderHistory() {
const el = document.getElementById('dec-history');
if (!el) return;
const h = loadHistory();
if (!h.length) { el.innerHTML = ((window.mochiDataPending && window.mochiDataPending()) ? window.mochiLoadingHtml('决定记录') : '<div class="ta-empty">暂无帮我决定记录</div>'); return; }
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
decisionPanelRef = openPanel;
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("decision.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("decision.js"); try { console.error("[JS] decision.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[decision.js] " + String(__e && __e.message || __e)); } })();
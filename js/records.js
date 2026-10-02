(function () { try {
(function () {
const uid = window.activePrefix();
const store = window.activeStore();
function fmtDT(ts) {
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function dispName() {
return store.get('lbl-partner')
|| store.get('cs-lbl-partner')
|| (window.contactNameFor ? window.contactNameFor(window.__activeCid || 'default') : '')
|| (window.taWord ? window.taWord() : 'TA');
}
function avatarsLoad() {
try { return JSON.parse(store.get('records-avatar') || '[]'); } catch (e) { return []; }
}
function avatarsSave(list) { store.set('records-avatar', JSON.stringify(list.slice(0, 30))); }
window.addAvatarRecord = function (img, text) {
const list = avatarsLoad();
list.unshift({ img: img, text: text || '', ts: Date.now() });
avatarsSave(list);
if (!document.getElementById('page-home').hidden) render();
};
function callsLoad() {
try { return JSON.parse(store.get('records-call') || '[]'); } catch (e) { return []; }
}
function callsSave(list) { store.set('records-call', JSON.stringify(list.slice(0, 50))); }
window.addCallRecord = function (type, text) {
const list = callsLoad();
list.unshift({ type: type, text: text, ts: Date.now() });
callsSave(list);
if (!document.getElementById('page-home').hidden) render();
};
function catchesLoad() {
try { return JSON.parse(store.get('records-fishcatch') || '[]'); } catch (e) { return []; }
}
function catchesSave(list) { store.set('records-fishcatch', JSON.stringify(list)); } // v3.15.x：用户要求保留全部历史，不设上限（事件本身低频，量级可控）
function histKey(x) { return 'k|' + ((x && x.ts) || 0) + '|' + ((x && x.type) || ''); }
window.addFishCatchRecord = function (type, text) {
const list = catchesLoad();
list.unshift({ type: type, text: text || '', ts: Date.now() });
catchesSave(list);
if (!document.getElementById('page-home').hidden) render();
};
function recEmpty(finalHtml) {
return (window.mochiDataPending && window.mochiDataPending()) ? '<div class="ta-empty">' + window.mochiLoadingText() + '</div>' : finalHtml;
}
function renderCatch() {
const el = document.getElementById('home-catch');
if (!el) return;
const name = dispName();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const list = catchesLoad();
el.innerHTML = window.mochiHistFold(list.map((x, n) => ({ ts: Number(x.ts) || 0, html:
'<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' +
(x.type === 'ta'
? '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>' + name + ' 抓到我摸鱼'
: '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' + '抓到 ' + name + ' 摸鱼') +
'</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span>' + window.mochiHistDel(histKey(x), (x.type === 'ta' ? name + ' 抓到我摸鱼' : '抓到 ' + name + ' 摸鱼')) + '</div>' +
(x.text ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(esc(x.text)) : esc(x.text)) + '</div>' : '') +
'</div>'
})), {
key: 'records-catch',
empty: recEmpty('<div class="ta-empty">暂无摸鱼抓包记录（桌面浮字可点击抓包 TA；点太快会被 TA 反向抓包）</div>'),
todayEmpty: '<div class="dc-h-day-empty">今天没有被抓包</div>'
});
window.mochiHistDelBind(el, {
title: '删除这条抓包记录？',
onDel: function (k) {
const arr = catchesLoad();
const p = String(k).split('|');
const ts = Number(p[1]) || 0, ty = p[2] || '';
const i = arr.findIndex(function (x) { return x && (Number(x.ts) || 0) === ts && String(x.type || '') === ty; });
if (i < 0) { if (typeof window.toast === 'function') window.toast('这条已经变了，没有删掉任何内容'); return; }
arr.splice(i, 1);
catchesSave(arr);
render();
if (typeof window.toast === 'function') window.toast('已删除这条抓包记录');
}
});
}
function renderCoinPanel(kind) {
const el = document.getElementById(kind === 'ask' ? 'home-coinask' : 'home-coinearn');
if (!el) return;
const list = (window.giftCoinLedgerLoad ? window.giftCoinLedgerLoad(kind) : []) || [];
const name = dispName();
const myName = store.get('lbl-user') || '我';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
if (!list.length) {
el.innerHTML = recEmpty('<div class="ta-empty">' + (kind === 'ask' ? '暂无申请记录（可点心意币余额行向 Mochi 申请）' : '暂无赚钱记录（玩游戏、种花、钓鱼都能赚心意币）') + '</div>');
return;
}
const yuan = (fen) => (fen / 100).toFixed(2);
el.innerHTML = list.map(x => {
let line;
if (x.myFen && x.taFen && x.myFen === x.taFen) line = '双方各 +¥' + yuan(x.myFen);
else {
const parts = [];
if (x.myFen) parts.push(myName + ' +¥' + yuan(x.myFen));
if (x.taFen) parts.push(name + ' +¥' + yuan(x.taFen));
line = parts.join(' · ') || '—';
}
const src = x.src ? esc(x.src) : (kind === 'ask' ? '向 Mochi 申请' : '赚钱');
return '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">🪙 ' + src + '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
'<div class="tc-li-line">' + line + '</div></div>';
}).join('');
}
window.__renderHomeCoin = function () {
if (htab === 'coinearn') renderCoinPanel('earn');
else if (htab === 'coinask') renderCoinPanel('ask');
};
function renderQuotePanel() {
const el = document.getElementById('home-quotes');
if (!el) return;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let list = [];
try { list = JSON.parse(store.get('quote-history') || '[]'); } catch (e) { list = []; }
if (!Array.isArray(list)) list = [];
const items = list.map((x) => ({ ts: Number(x.ts) || 0, html:
'<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">💬 ' + esc(x.text || '') + '</span><span class="tc-li-time">' + esc(x.date || '') + '</span>' + window.mochiHistDel('q|' + (Number(x.ts) || 0) + '|' + String(x.date || ''), '情话存档 · ' + esc(x.date || '')) + '</div></div>'
}));
el.innerHTML = window.mochiHistFold(items, {
key: 'records-quotes',
empty: recEmpty('<div class="ta-empty">暂无情话存档（主页「今日情话」每天会自动存一条）</div>'),
todayEmpty: '<div class="dc-h-day-empty">今天的情话在主页卡上</div>'
});
window.mochiHistDelBind(el, {
title: '删除这条情话存档？',
onDel: function (k) {
const p = String(k).split('|');
const ts = Number(p[1]) || 0, date = p.slice(2).join('|');
let arr = [];
try { arr = JSON.parse(store.get('quote-history') || '[]'); } catch (e) { arr = []; }
if (!Array.isArray(arr)) arr = [];
const i = arr.findIndex(function (x) { return x && (Number(x.ts) || 0) === ts && String(x.date || '') === date; });
if (i < 0) { if (typeof window.toast === 'function') window.toast('这条已经变了，没有删掉任何内容'); return; }
if (window.xyBigWriteBlocked && window.xyBigWriteBlocked(store, 'quote-history', '情话存档')) return;
arr.splice(i, 1);
try { store.set('quote-history', JSON.stringify(arr)); } catch (e) {}
renderQuotePanel();
if (typeof window.toast === 'function') window.toast('已删除这条情话存档');
}
});
}
function caresLoad() {
try { return JSON.parse(store.get('records-care') || '[]'); } catch (e) { return []; }
}
function caresSave(list) { if (window.xyBigWriteHold && window.xyBigWriteHold(store, 'records-care')) return; store.set('records-care', JSON.stringify(list)); } // #1493 作者「要保存所有记录」＝拆掉 100 条封顶；读不全先让路
window.addCareRecord = function (kind, text, ts) {
const list = caresLoad();
list.unshift({ kind: kind, text: text || '', ts: ts || Date.now() });
caresSave(list);
const hp = document.getElementById('page-home');
if (hp && !hp.hidden && (htab === 'care' || (htab === 'xck' && kind === 'desk-checkin'))) render();
};
window.addCareRecordFor = function (cid, kind, text, ts, res) {
try {
const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
if (window.xyBigWriteHold && window.xyBigWriteHold(s, 'records-care')) return; // #1493 读不全先让路（错过的跨桌面查岗唯一留痕，更不许顶库）
let list = [];
try { list = JSON.parse(s.get('records-care') || '[]'); } catch (e) { list = []; }
if (!Array.isArray(list)) list = [];
list.unshift({ kind: kind, text: text || '', ts: ts || Date.now(), res: res || '' });
s.set('records-care', JSON.stringify(list)); // #1493 拆封顶（错过未回应只落这里＝唯一留痕，不许裁）
if (cid === (window.__activeCid || 'default')) {
const hp = document.getElementById('page-home');
if (hp && !hp.hidden && htab === 'xck') renderXckPanel();
}
} catch (e) {}
};
function cuddleLoad() {
try { const l = JSON.parse(store.get('records-cuddle') || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
function cuddleSaveFor(cid, list) {
try {
const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
s.set('records-cuddle', JSON.stringify(list));
} catch (e) {}
}
function cuddleLoadFor(cid) {
try {
const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
const l = JSON.parse(s.get('records-cuddle') || '[]');
return Array.isArray(l) ? l : [];
} catch (e) { return []; }
}
window.addCuddleRecordFor = function (cid, rec) {
try {
if (!rec || !rec.ts) return false;
const list = cuddleLoadFor(cid);
if (list.some(x => x && x.ts === rec.ts)) return false; // 同一次邀请只记一条
list.unshift({ ts: rec.ts, text: rec.text || '', res: rec.res || 'pending' });
cuddleSaveFor(cid, list);
const hp = document.getElementById('page-home');
if (cid === (window.__activeCid || 'default') && hp && !hp.hidden && htab === 'cuddle') renderCuddlePanel();
return true;
} catch (e) { return false; }
};
window.setCuddleRecordResult = function (cid, ts, res) {
try {
const list = cuddleLoadFor(cid);
let hit = false;
list.forEach(x => { if (x && x.ts === ts) { x.res = res; hit = true; } });
if (!hit) return false;
cuddleSaveFor(cid, list);
const hp = document.getElementById('page-home');
if (cid === (window.__activeCid || 'default') && hp && !hp.hidden && htab === 'cuddle') renderCuddlePanel();
return true;
} catch (e) { return false; }
};
function renderCarePanel() {
const el = document.getElementById('home-care');
if (!el) return;
const name = dispName();
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const KIND_ICON = { period: '🌸', sym: '💊', water: '💧', eat: '🍚', pomo: '🍅' }; // #1474 加 sym
const rows = [];
caresLoad().forEach(r => { if (r.kind === 'pomo') rows.push({ icon: '🍅', main: '番茄钟陪伴', sub: fmtDT(r.ts), ts: r.ts, del: window.mochiHistDel('p|' + (Number(r.ts) || 0), '番茄钟陪伴 · ' + fmtDT(r.ts)) }); }); // #1493 自有数组行可单删（聊天回溯行仍不动＝删原文回聊天页）
let msgs = [];
try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
(msgs || []).forEach(m => {
if (!m) return;
const t = m.ts || 0;
const tag = (m.mood && m.mood[0] && m.mood[0].tag) || '';
if (tag === '经期关心') rows.push({ icon: KIND_ICON.period, main: '经期关心 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
else if (tag === '症状关心') rows.push({ icon: KIND_ICON.sym, main: '症状关心 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t }); // #1474：经期页记了症状后梦角发的那条
else if (tag === '喝水提醒') rows.push({ icon: KIND_ICON.water, main: '提醒喝水 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
else if (tag === '吃饭提醒') rows.push({ icon: KIND_ICON.eat, main: '提醒吃饭 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
});
if (!rows.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无联系人的关心记录（TA 会提醒你喝水吃饭、关心经期与症状、陪你专注；查岗看「联系人对我查岗」与「联系人跨桌面查岗」两栏）</div>'); return; }
rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
el.innerHTML = window.mochiHistFold(rows.map(r => ({ ts: Number(r.ts) || 0, html: '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + r.icon + ' ' + r.main + '</span><span class="tc-li-time">' + r.sub + '</span>' + (r.del || '') + '</div></div>' })), {
key: 'records-care',
todayEmpty: '<div class="dc-h-day-empty">今天暂无关心记录</div>'
});
window.mochiHistDelBind(el, {
title: '删除这条番茄陪伴记录？',
onDel: function (k) {
if (String(k).indexOf('p|') !== 0) return;
const ts = Number(String(k).slice(2)) || 0;
const arr = caresLoad();
const i = arr.findIndex(function (x) { return x && x.kind === 'pomo' && (Number(x.ts) || 0) === ts; });
if (i < 0) { if (typeof window.toast === 'function') window.toast('这条已经变了，没有删掉任何内容'); return; }
if (window.xyBigWriteBlocked && window.xyBigWriteBlocked(store, 'records-care', '关心记录')) return;
arr.splice(i, 1);
caresSave(arr);
render();
if (typeof window.toast === 'function') window.toast('已删除这条番茄陪伴记录');
}
});
}
function renderCkPanel() {
const el = document.getElementById('home-ck');
if (!el) return;
const name = dispName();
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let msgs = [];
try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
const askCardTs = [];
(msgs || []).forEach(o => { if (o && o.special === 'ask-card' && o.askQuestion) askCardTs.push(o.ts || 0); });
askCardTs.sort((a, b) => a - b);
const hasAskCardNear = (t) => {
let lo = 0, hi = askCardTs.length;
const from = t - 30000, to = t + 30000;
while (lo < hi) { const mid = (lo + hi) >> 1; if (askCardTs[mid] <= from) lo = mid + 1; else hi = mid; }
return lo < askCardTs.length && askCardTs[lo] < to;
};
const ckRows = [];
(msgs || []).forEach(m => {
if (!m) return;
const t = m.ts || 0;
if (m.special === 'ask-card' && m.askQuestion && !m.askTs && !m.deskCk) {
ckRows.push({ ts: t, q: '📋 ' + name + ' 查岗 · ' + esc(m.askQuestion), sub: fmtDT(t),
line: m.askAnswer ? '✓ 已回答：' + esc(m.askAnswer) : '还没回答（在聊天里点那张卡作答）' });
} else if (m.special === 'ask-msg' && /查岗/.test(m.text || '')) {
const nearCard = hasAskCardNear(t); // #588：二分查，不再对全表 some()
if (!nearCard) ckRows.push({ ts: t, q: '📋 ' + name + ' 查岗', sub: fmtDT(t), line: '' });
}
});
if (!ckRows.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无查岗记录（TA 按回复设置里的概率与冷却主动来查岗，问你在干嘛/在做什么）</div>'); return; }
ckRows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
el.innerHTML = window.mochiHistFold(ckRows.map(r => ({ ts: Number(r.ts) || 0, html: '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + r.q + '</span><span class="tc-li-time">' + r.sub + '</span></div>' + (r.line ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(r.line) : r.line) + '</div>' : '') + '</div>' })), {
key: 'records-ck', // #1416 那族口径：开合态交给 mochiHistFold 的模块级 map，每张列表一个前缀（不写 key 就全站的月块共用 'hist'，在查岗栏展开「8 月」会顺手掀开别栏）
todayEmpty: '<div class="dc-h-day-empty">今天没有被查岗</div>'
});
}
function renderXckPanel() {
const el = document.getElementById('home-xck');
if (!el) return;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const RES = {
replied: '点了「现在回TA」，卡已在TA桌面的聊天里',
later: '选了稍后，卡留在TA桌面的聊天里',
missed: '错过未回应（没点【确认】，聊天里没有这条）'
};
const xckRows = [];
const cur = window.__activeCid || 'default';
(window.getContacts() || []).forEach(function (c) {
if (!c) return;
const cname = c.name || 'TA';
let care = [];
try {
const s = (c.id && window.storeFor) ? window.storeFor(c.id) : store;
care = JSON.parse(s.get('records-care') || '[]');
} catch (e) { care = []; }
if (!Array.isArray(care)) care = [];
const ckTs = [];
care.forEach(function (r) {
if (!r || r.kind !== 'desk-checkin') return;
const t = Number(r.ts) || 0;
ckTs.push(t);
xckRows.push({ ts: t, q: '🏠 ' + esc(cname) + ' · ' + esc(r.text || ''), sub: fmtDT(t), line: RES[r.res] || '' });
});
if (c.id !== cur) return;
let msgs = [];
try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
(msgs || []).forEach(function (m) {
if (!m || !m.deskCk || m.special !== 'ask-card' || !m.askQuestion) return;
const t = m.ts || 0;
if (ckTs.some(ct => Math.abs(ct - t) <= 90000)) return;
xckRows.push({ ts: t, q: '🏠 ' + esc(cname) + ' · ' + esc(m.askQuestion), sub: fmtDT(t),
line: m.askAnswer ? '✓ 已回答：' + esc(m.askAnswer) : '' });
});
});
if (!xckRows.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无跨桌面查岗记录（其他桌面的 TA 会按「跨桌面查岗频率」来查岗；错过没点【确认】的也记在这里，但不进聊天）</div>'); return; }
xckRows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
el.innerHTML = window.mochiHistFold(xckRows.map(r => ({ ts: Number(r.ts) || 0, html: '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + r.q + '</span><span class="tc-li-time">' + r.sub + '</span></div>' + (r.line ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(r.line) : r.line) + '</div>' : '') + '</div>' })), {
key: 'records-xck', // 同上：每张列表一枚前缀，月块开合态互不串
todayEmpty: '<div class="dc-h-day-empty">今天没有跨桌面查岗</div>'
});
}
function renderCuddlePanel() {
const el = document.getElementById('home-cuddle');
if (!el) return;
const name = dispName();
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const RES = { pending: '待回应', replied: '你接受了', declined: '你拒绝了', missed: '错过未回应' };
const list = cuddleLoad();
if (!list.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无贴贴邀请记录（TA 会按回复设置里的概率发起贴贴邀请；弹窗不自动关，切后台回来还在）</div>'); return; }
const cuItems = list.map((x) => ({ ts: Number(x.ts) || 0, html:
'<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">🫂 ' + esc(name) + ' 邀请贴贴 · ' + esc(x.text || '') + '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span>' + window.mochiHistDel('t' + x.ts, (name + ' 的贴贴邀请 · ' + (x.text || ''))) + '</div>' +
'<div class="tc-li-line">' + (RES[x.res] || '待回应') + '</div></div>'
}));
el.innerHTML = window.mochiHistFold(cuItems, {
key: 'records-cuddle', // 同上：这一栏也会因新邀请整栏重画，开合态得活过重画
empty: recEmpty('<div class="ta-empty">暂无贴贴邀请记录</div>'),
todayEmpty: '<div class="dc-h-day-empty">今天没有贴贴邀请</div>'
});
window.mochiHistDelBind(el, {
title: '删除这条贴贴邀请记录？',
onDel: function (k) {
const ts = Number(String(k).replace(/^t/, ''));
const arr = cuddleLoad();
const left = arr.filter(x => x && Number(x.ts) !== ts);
if (left.length === arr.length) return;
cuddleSaveFor(window.__activeCid || 'default', left);
render();
}
});
}
function renderRpPanel() {
const el = document.getElementById('home-coinrp');
if (!el) return;
const name = dispName();
const myName = store.get('lbl-user') || '我';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let msgs = [];
try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
const list = (msgs || []).filter(m => m && m.special === 'redpacket');
if (!list.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无红包记录（红包也是心意币，快去发一个试试）</div>'); return; }
const stMap = { pending: '待领取', received: '已领取', expired: '已过期·退回', returned: '已退回' };
el.innerHTML = window.mochiHistFold(list.slice().reverse().map(m => {
const out = m.side === 'out';
const st = stMap[m.rpStatus || 'pending'] || '';
const amt = Number(m.rpAmount || 0).toFixed(2);
const sub = (out ? myName + ' 发给 ' + name : name + ' 发给 ' + myName) + ' · ' + (st || '待领取') +
(m.rpWish ? ' · 「' + esc(m.rpWish) + '」' : '');
return { ts: Number(m.rpTs || m.ts) || 0, html: '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + (out ? '🧧 我发红包 ¥' + amt : '🧧 ' + esc(name) + ' 发红包 ¥' + amt) + '</span><span class="tc-li-time">' + fmtDT(m.rpTs || m.ts) + '</span></div>' +
'<div class="tc-li-line">' + sub + '</div></div>' };
}), { key: 'records-rp', todayEmpty: '<div class="dc-h-day-empty">今天没有红包往来</div>' });
}
function renderDivinePanel() {
const el = document.getElementById('home-divine');
if (!el) return;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const list = histList('records-divine');
if (!list.length) {
el.innerHTML = recEmpty('<div class="ta-empty">暂无占卜记录（在「占卜」页选择对象抽牌后，牌面与解读自动存入这里）</div>');
return;
}
el.innerHTML = list.map((h, i) => {
const n = Array.isArray(h.cards) ? h.cards.length : (h.count || 0);
const cardsTxt = Array.isArray(h.cards) ? h.cards.map(c => ((c && c.name) || '') + (c && c.rev ? '(逆)' : '')).join('、') : '';
const title = (h.mode === 'tarot' ? '塔罗' : '雷诺曼') + ' · ' + n + ' 张' + (h.target ? ' · 为 ' + esc(h.target) + ' 占卜' : '');
return '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">🔮 ' + title +
(h.question ? ' · 问：' + esc(h.question) : '') + '</span><span class="tc-li-time">' + fmtDT(h.ts) + '</span></div>' +
(cardsTxt ? '<div class="tc-li-line">' + esc(cardsTxt) + '</div>' : '') +
(h.summary ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(esc(h.summary)) : esc(h.summary)) + '</div>' : '') +
'<button class="div-h-view hd-view" data-di="' + i + '">查看牌面</button></div>';
}).join('');
el.querySelectorAll('.hd-view').forEach(b => b.addEventListener('click', () => {
const h = histList('records-divine')[parseInt(b.dataset.di, 10)];
if (!h || !Array.isArray(h.cards) || !window.divineRenderResult) return;
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const dp = document.getElementById('page-divine');
if (dp) dp.hidden = false;
try { window.divineRenderResult(h.cards, h.mode, h.question || '', h.summary || ''); } catch (e) {}
}));
}
function histList(key) { try { return JSON.parse(store.get(key) || '[]'); } catch (e) { return []; } }
function dayKeyTs(s) {
const p = String(s || '').split('-').map(Number);
return (p.length === 3 && p[0] && p[1] && p[2]) ? new Date(p[0], p[1] - 1, p[2]).getTime() : 0;
}
function delDayHist(key, date) {
let list = [];
try { list = JSON.parse(store.get(key) || '[]'); } catch (e) { return false; }
if (!Array.isArray(list)) return false;
const left = list.filter(function (x) { return x && x.date !== date; });
if (left.length === list.length) return false;
store.set(key, JSON.stringify(left));
return true;
}
function dayValList(el, list, key, name, rowFn, afterDel, headHtml) {
el.innerHTML = (headHtml || '') + window.mochiHistFold(list.map(function (x) {
return { ts: dayKeyTs(x.date), html: '<div class="tc-listitem">' + rowFn(x) + window.mochiHistDel(x.date, x.date + ' 的' + name) + '</div>' };
}), {
key: key,
empty: recEmpty('<div class="ta-empty">暂无' + name + '记录</div>'),
todayEmpty: '<div class="dc-h-day-empty">今天暂无' + name + '</div>'
});
window.mochiHistDelBind(el, {
title: '删除这一天的' + name + '记录？',
onDel: function (date) {
if (delDayHist(key, date)) { afterDel(); if (typeof window.toast === 'function') window.toast('已删除 ' + date + ' 的' + name + '记录（累计不变）'); }
}
});
}
let htab = 'av';
window.renderFishHistory = function () {
const el = document.getElementById('home-fish');
if (!el) return;
const h = (window.getFishHistory && window.getFishHistory()) || [];
const name = dispName();
const myName = store.get('lbl-user') || '我';
const tot = (window.getFishTotals && window.getFishTotals()) || { mine: 0, ta: 0 };
const totalHtml =
'<div class="fish-total">' +
'<span class="ft-item"><b>' + myName + '</b> 累计 ' + (tot.mine || 0) + '</span>' +
'<span class="ft-item"><b>' + name + '</b> 累计 ' + (tot.ta || 0) + '</span>' +
'</div>';
const cb = (window.getFishComboBest && window.getFishComboBest()) || { today: 0, best: 0 };
const comboHtml = (cb && (cb.today > 0 || cb.best > 0))
? '<div class="fish-combo-line">今日最高连击 ×' + (cb.today || 0) + ' · 历史最高 ×' + (cb.best || 0) + '</div>'
: '';
dayValList(el, h, 'fish-day-add', '摸鱼值', function (x) {
return '<div class="tc-li-top"><span class="tc-li-q">' + x.date + '</span></div>' +
'<div class="tc-li-line">' + myName + ' 当天摸鱼：+' + (x.mine || 0) + '</div>' +
'<div class="tc-li-line">' + name + ' 当天摸鱼：+' + (x.ta || 0) + '</div>';
}, window.renderFishHistory, totalHtml + comboHtml);
};
window.renderWorkHistory = function () {
const el = document.getElementById('home-work');
if (!el) return;
const h = (window.getWorkHistory && window.getWorkHistory()) || [];
const name = dispName();
const myName = store.get('lbl-user') || '我';
const tot = (window.getWorkTotals && window.getWorkTotals()) || { mine: 0, ta: 0 };
const totalHtml =
'<div class="fish-total">' +
'<span class="ft-item"><b>' + myName + '</b> 累计 ' + (tot.mine || 0) + '</span>' +
'<span class="ft-item"><b>' + name + '</b> 累计 ' + (tot.ta || 0) + '</span>' +
'</div>';
dayValList(el, h, 'work-day-add', '打工值', function (x) {
return '<div class="tc-li-top"><span class="tc-li-q">' + x.date + '</span></div>' +
'<div class="tc-li-line">' + myName + ' 当天打工：+' + (x.mine || 0) + '</div>' +
'<div class="tc-li-line">' + name + ' 当天打工：+' + (x.ta || 0) + '</div>';
}, window.renderWorkHistory, totalHtml);
};
function render() {
const showOnly = htab;
if (showOnly === 'work') {
window.renderWorkHistory();
}
if (showOnly === 'fish') {
window.renderFishHistory();
}
if (showOnly === 'catch') {
renderCatch();
}
if (showOnly === 'coinearn') {
renderCoinPanel('earn');
}
if (showOnly === 'coinask') {
renderCoinPanel('ask');
}
if (showOnly === 'coinrp') {
renderRpPanel();
}
if (showOnly === 'care') {
renderCarePanel();
}
if (showOnly === 'ck') {
renderCkPanel();
}
if (showOnly === 'xck') {
renderXckPanel();
}
if (showOnly === 'cuddle') {
renderCuddlePanel();
}
if (showOnly === 'divine') {
renderDivinePanel();
}
if (showOnly === 'quotes') {
renderQuotePanel();
}
if (showOnly === 'av') {
const avEl = document.getElementById('home-av');
if (avEl) {
const list = avatarsLoad();
const name = dispName();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
avEl.innerHTML = list.length
? list.map(x =>
'<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + (window.taFit ? window.taFit(esc(x.text || (name + ' 更换了头像'))) : esc(x.text || (name + ' 更换了头像'))) + '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
(x.img ? '<img class="rec-av-img" src="' + x.img + '" alt="头像">' : '') +
'</div>'
).join('')
: recEmpty('<div class="ta-empty">暂无换头像记录</div>');
}
}
if (showOnly === 'call') {
const callEl = document.getElementById('home-call');
if (callEl) {
const list = callsLoad();
const name = dispName();
const icIn = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>';
const icOut = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/><path d="M16 3v6M19 6h-6"/></svg>';
callEl.innerHTML = list.length
? list.map(x => {
const itp = x.ended === 'interrupt';
return '<div class="tc-listitem' + (itp ? ' tc-call-interrupt' : '') + '"><div class="tc-li-top"><span class="tc-li-q">' +
(x.type === 'in' ? icIn + name + ' 来电' : icOut + name + ' 拨打') +
'</span>' + (itp ? '<span class="tc-li-interrupt-tag">中断</span>' : '') + '<span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
(x.text ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(x.text) : x.text) + '</div>' : '') +
'</div>';
}).join('')
: recEmpty('<div class="ta-empty">暂无通话记录</div>');
}
}
}
document.querySelectorAll('#page-home .fav-tab').forEach(tab => {
tab.addEventListener('click', () => {
htab = tab.dataset.htab;
document.querySelectorAll('#page-home .fav-tab').forEach(x => x.classList.toggle('sel', x === tab));
document.querySelectorAll('#page-home .cal-card').forEach(c => { c.hidden = c.dataset.hpanel !== htab && c.dataset.hpanel !== '*'; });
render();
});
});
if (window.mochiOnDataReady) window.mochiOnDataReady(render);
const homeApp = document.querySelector('.app[data-app="home"]');
const homePage = document.getElementById('page-home');
if (homeApp && homePage) {
homeApp.addEventListener('click', () => {
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) return;
render();
document.querySelectorAll('.page').forEach(p => p.hidden = true);
homePage.hidden = false;
});
}
const homeBack = document.getElementById('home-back');
if (homeBack) {
homeBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const phone = document.getElementById('page-phone');
if (phone) phone.hidden = false;
});
}
render();
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':records-avatar').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2) store.set('records-avatar', v);
});
}
} catch (e) {}
document.addEventListener('contact-switched', function () {
try {
const hp = document.getElementById('page-home');
if (hp && !hp.hidden) render();
} catch (e) {}
});
window.__renderHomeCall = function () {
try { if (!document.getElementById('page-home').hidden && htab === 'call') render(); } catch (e) {}
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("records.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("records.js"); try { console.error("[JS] records.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[records.js] " + String(__e && __e.message || __e)); } })();
(function () { try {
/* ===== 主页样式：小手机 / 微信式（2026-11-22）=====
作者定稿：
· 切换入口放「设置 → 外观（界面风格旁边）」；
· 微信式只换**主页外壳**：聊天页不动；底部导航＝聊天 / 字卡 / 设置；
· 每个联系人＝一个会话；长按会话可置顶；记录不进会话（在聊天「更多功能 → 互动 → 记录」）；
· 两种模式共用同一份数据，切换零迁移；小手机模式的桌面排布原样保留。
*/
(function () {
'use strict';
var G = 'xy-home-v2';
var KEY = 'home-style';      // 'phone' | 'wechat'（全局根键，设备级）
var PIN_KEY = 'wx-pinned';   // 置顶顺序：['cid', ...]（全局根键）
function root() { try { return window.xyStore ? window.xyStore(G) : null; } catch (e) { return null; } }
function rget(k) { try { var r = root(); return r ? r.get(k) : localStorage.getItem(G + ':' + k); } catch (e) { return null; } }
function rset(k, v) { try { var r = root(); if (r) r.set(k, String(v)); else localStorage.setItem(G + ':' + k, String(v)); } catch (e) {} }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function toast(t) { try { if (window.toast) window.toast(t); } catch (e) {} }
function esc(s) {
return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function style() {
try { var v = rget(KEY); return v === 'wechat' ? 'wechat' : 'phone'; } catch (e) { return 'phone'; }
}
function isWx() { return style() === 'wechat'; }
function pins() {
try { var a = JSON.parse(rget(PIN_KEY) || '[]'); return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; } catch (e) { return []; }
}
function setPins(a) { try { rset(PIN_KEY, JSON.stringify(a.slice(0, 50))); } catch (e) {} }
function deskStore(cid) {
try { return window.storeForCid ? window.storeForCid(cid) : (window.storeFor ? window.storeFor(cid) : null); } catch (e) { return null; }
}
function lastOf(cid) {
var s = deskStore(cid);
if (!s) return { text: '', ts: 0 };
var tail = [];
try { tail = JSON.parse(s.get('chat-tail') || '[]'); } catch (e) { tail = []; }
var unread = 0;
try { unread = parseInt(s.get('chat-unread'), 10) || 0; } catch (e) {}
var last = null;
if (Array.isArray(tail)) {
for (var i = tail.length - 1; i >= 0; i--) {
var t = tail[i];
if (!t) continue;
if (!last && (t.text || t.special)) last = t;
if (last) break;
}
}
var text = '';
if (last) {
if (last.special === 'read') text = '[已读]';
else if (last.special === 'poke' || last.special === 'ask-msg') text = String(last.text || '').replace(/@@m:[0-9a-f]{32}/g, '[图片]');
else text = String(last.text || '').replace(/@@m:[0-9a-f]{32}/g, '[图片]');
if (!text && last.special) text = '[' + last.special + ']';
}
return { text: text.slice(0, 40), ts: Number(last && last.ts) || 0, unread: unread };
}
function whenText(ts) {
if (!ts) return '';
var d = new Date(ts), now = new Date();
var same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
if (same) return pad(d.getHours()) + ':' + pad(d.getMinutes());
var y = new Date(now.getTime() - 864e5);
if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return '昨天';
if (d.getFullYear() !== now.getFullYear()) return (d.getMonth() + 1) + '/' + d.getDate();
return (d.getMonth() + 1) + '/' + d.getDate();
}
function contacts() { try { return (window.getContacts && window.getContacts()) || []; } catch (e) { return []; } }
function render(q) {
var list = document.getElementById('wx-list');
if (!list) return;
if (typeof q !== 'string') { try { q = String((document.getElementById('wx-q') || {}).value || ''); } catch (e) { q = ''; } }
q = q.trim().toLowerCase();
var cs = contacts();
var pin = pins();
var rows = cs.map(function (c) {
var info = lastOf(c.id);
var nm = String(c.name || c.id || '联系人');
var pi = pin.indexOf(c.id);
return { cid: c.id, name: nm, info: info, pinIdx: pi };
}).filter(function (r) { return r; });
if (q) rows = rows.filter(function (r) { return (r.name + ' ' + r.info.text).toLowerCase().indexOf(q) >= 0; });
rows.sort(function (a, b) {
var pa = a.pinIdx < 0 ? 999 : a.pinIdx, pb = b.pinIdx < 0 ? 999 : b.pinIdx;
if (pa !== pb) return pa - pb;
return (b.info.ts || 0) - (a.info.ts || 0);
});
if (!rows.length) {
list.innerHTML = q
? '<div class="wx-empty">没有匹配的联系人<br><span style="font-size:11px">换个关键词试试</span></div>'
: '<div class="wx-empty">还没有联系人<br>点右上角 ＋ 新建一个桌面</div>';
return;
}
var h = '';
rows.forEach(function (r) {
var initial = esc(r.name.slice(0, 1));
var av = '';
try {
var s = deskStore(r.cid);
var img = s && s.get('cs-avatar-partner');
if (img) av = '<img src="' + esc(img) + '" alt="">';
} catch (e) {}
h += '<div class="wx-conv" data-cid="' + esc(r.cid) + '">' +
'<div class="wx-av">' + (av || initial) + '</div>' +
'<div class="wx-cv">' +
'<div class="wx-nm">' + esc(r.name) + (r.pinIdx >= 0 ? '<span class="wx-pin">置顶</span>' : '') + '</div>' +
'<div class="wx-pv">' + (r.info.text ? esc(r.info.text) : '还没有聊天') + '</div>' +
'</div>' +
'<div class="wx-cm">' +
'<div class="wx-tm">' + esc(whenText(r.info.ts)) + '</div>' +
(r.info.unread ? '<div class="wx-badge">' + (r.info.unread > 99 ? '99+' : r.info.unread) + '</div>' : '') +
'</div>' +
'</div>';
});
list.innerHTML = h;
bindRow();
}
var holdT = 0, held = null, moved = false, suppressClickUntil = 0;
function clearHold() { if (holdT) { clearTimeout(holdT); holdT = 0; } held = null; moved = false; }
function bindRow() {
document.querySelectorAll('#wx-list .wx-conv').forEach(function (el) {
var cid = el.getAttribute('data-cid');
el.addEventListener('pointerdown', function (ev) {
if (ev.pointerType === 'mouse' && ev.button !== 0) return;
moved = false; held = el;
var x0 = ev.clientX, y0 = ev.clientY;
var mv = function (e2) { if (Math.abs(e2.clientX - x0) > 8 || Math.abs(e2.clientY - y0) > 8) moved = true; };
var up = function () {
window.removeEventListener('pointermove', mv);
window.removeEventListener('pointerup', up);
window.removeEventListener('pointercancel', up);
if (holdT) { clearTimeout(holdT); holdT = 0; }
if (!moved && held === el) openChat(cid);
held = null;
};
window.addEventListener('pointermove', mv, { passive: true });
window.addEventListener('pointerup', up);
window.addEventListener('pointercancel', up);
clearTimeout(holdT);
holdT = setTimeout(function () {
holdT = 0;
if (moved) return;
suppressClickUntil = Date.now() + 900; // 长按弹层后别把抬手当点击
try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
openSheet(cid, el);
}, 480);
});
el.addEventListener('click', function () {
if (Date.now() < suppressClickUntil) return;
openChat(cid);
});
});
}
function openChat(cid) {
try {
if (cid !== (window.__activeCid || 'default') && window.setActiveContact) window.setActiveContact(cid);
var chat = document.querySelector('.app[data-app="chat"]');
if (chat) chat.click();
} catch (e) {}
}
function closeSheet() {
var m = document.getElementById('wx-mask'); if (m) m.remove();
var s = document.getElementById('wx-sheet'); if (s) s.remove();
}
function openSheet(cid, el) {
closeSheet();
var c = contacts().filter(function (x) { return x.id === cid; })[0] || { id: cid, name: cid };
var pin = pins();
var pinned = pin.indexOf(cid) >= 0;
var info = lastOf(cid);
var host = document.querySelector('.phone') || document.body;
var mask = document.createElement('div');
mask.className = 'wx-mask'; mask.id = 'wx-mask';
mask.addEventListener('click', closeSheet);
var sh = document.createElement('div');
sh.className = 'wx-sheet'; sh.id = 'wx-sheet';
sh.innerHTML =
'<div class="wx-sheet-ttl">' + esc(c.name || cid) + '</div>' +
'<div class="wx-sheet-hd"><div class="wx-av">' + esc(String(c.name || '?').slice(0, 1)) + '</div>' +
'<div><div class="nm">' + esc(c.name || cid) + '</div>' +
'<div class="sub">' + (info.unread ? info.unread + ' 条未读 · ' : '') + (info.ts ? '最近 ' + whenText(info.ts) : '还没有聊天') + '</div></div></div>' +
'<div class="wx-act" data-op="pin"><span class="ic">' + (pinned ? '↓' : '↑') + '</span>' + (pinned ? '取消置顶' : '置顶到最上面') + '</div>' +
(info.unread ? '<div class="wx-act" data-op="read"><span class="ic">✓</span>标记已读</div>' : '') +
'<div class="wx-cancel" data-op="cancel">取消</div>';
sh.addEventListener('click', function (e) {
var act = e.target.closest('.wx-act, .wx-cancel');
if (!act) return;
var op = act.getAttribute('data-op');
if (op === 'pin') {
var p = pins().filter(function (x) { return x !== cid; });
if (!pinned) p.unshift(cid);
setPins(p);
toast(pinned ? '已取消置顶' : '已置顶「' + (c.name || cid) + '」');
render();
} else if (op === 'read') {
try { var s = deskStore(cid); if (s) s.set('chat-unread', '0'); } catch (e) {}
render();
}
closeSheet();
});
host.appendChild(mask); host.appendChild(sh);
}
function showWxHome() {
var pg = document.getElementById('page-wxhome');
if (!pg) return;
render();
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
pg.hidden = false;
syncTabs('chat');
}
function syncTabs(which) {
document.querySelectorAll('#tabbar-wx .wx-tb').forEach(function (t) {
t.classList.toggle('on', t.getAttribute('data-wx') === which);
});
}
function apply() {
var wx = isWx();
document.body.classList.toggle('home-wx', wx);
var bar = document.getElementById('tabbar-wx');
if (bar) bar.classList.toggle('on', wx);
var oldBar = document.querySelector('.phone > .tabbar') || document.querySelector('.tabbar');
if (oldBar) oldBar.style.display = wx ? 'none' : '';
if (wx) {
var phone = document.getElementById('page-phone');
if (phone && !phone.hidden) showWxHome();
else if (!document.querySelector('.page:not([hidden])')) showWxHome();
} else {
var wxPage = document.getElementById('page-wxhome');
if (wxPage && !wxPage.hidden) {
wxPage.hidden = true;
var phone2 = document.getElementById('page-phone');
if (phone2) phone2.hidden = false;
}
syncTabs('');
}
var v = document.getElementById('home-style-val');
if (v) v.textContent = wx ? '微信式' : '小手机';
var v2 = document.getElementById('sh-home-style-val');
if (v2) v2.textContent = wx ? '微信式' : '小手机';
try { document.dispatchEvent(new CustomEvent('mochi-home-style-changed', { detail: { style: wx ? 'wechat' : 'phone' } })); } catch (e) {}
}
function setStyle(s) {
var nx = s === 'wechat' ? 'wechat' : 'phone';
rset(KEY, nx);
apply();
if (nx === 'wechat') showWxHome();
toast(nx === 'wechat' ? '主页已切换为「微信式」' : '主页已切换为「小手机」');
}
window.mochiSetHomeStyle = setStyle;
window.mochiHomeStyle = function () { return isWx() ? 'wechat' : 'phone'; };
window.mochiOpenHomeStylePicker = function () {
if (!window.openModal) return false;
window.openModal('主页样式', '', function (v) {
if (v) setStyle(v);
}, {
noInput: true, pillSubmit: true, pill: window.mochiHomeStyle(),
staticText: '微信式：会话列表，不用装修桌面；聊天页本身不变。小手机：原来的图标桌面，桌面排布会保留。',
pills: [
{ label: '小手机（图标桌面）', value: 'phone' },
{ label: '微信式（会话列表）', value: 'wechat' }
]
});
return true;
};
function bind() {
document.querySelectorAll('#tabbar-wx .wx-tb').forEach(function (t) {
t.addEventListener('click', function () {
var k = t.getAttribute('data-wx');
if (k === 'chat') { showWxHome(); return; }
var pageId = k === 'cards' ? 'page-chatcard' : 'page-settings-hub';
var pg = document.getElementById(pageId);
if (!pg) return;
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
pg.hidden = false;
syncTabs(k);
});
});
var add = document.getElementById('wx-add');
if (add) add.addEventListener('click', function () {
if (window.openContactsPanel) { try { window.openContactsPanel(); return; } catch (e) {} }
var mgr = document.getElementById('contact-manager');
if (mgr) { mgr.hidden = false; return; }
if (window.setActiveContact) toast('点「切换联系人」可新建桌面');
});
var qEl = document.getElementById('wx-q');
if (qEl) qEl.addEventListener('input', function () { render(qEl.value); });
var row = document.getElementById('row-home-style');
if (row) row.addEventListener('click', function () { window.mochiOpenHomeStylePicker(); });
document.addEventListener('click', function (e) {
var el = e.target && e.target.closest && e.target.closest('[data-act="home-style"]');
if (!el) return;
window.mochiOpenHomeStylePicker();
});
document.addEventListener('mochi-home-style-changed', function () {
var v = document.getElementById('home-style-val'); if (v) v.textContent = isWx() ? '微信式' : '小手机';
});
document.addEventListener('contact-switched', function () {
if (!isWx()) return;
var pg = document.getElementById('page-wxhome');
if (pg && !pg.hidden) render();
});
document.addEventListener('mochi-restore-done', function () {
if (!isWx()) return;
var pg = document.getElementById('page-wxhome');
if (pg && !pg.hidden) render();
});
}
try {
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bind(); apply(); }, { once: true });
else { bind(); apply(); }
setTimeout(apply, 600);
setTimeout(function () { if (isWx()) { var pg = document.getElementById('page-wxhome'); if (pg && !pg.hidden) render(); } }, 1800);
} catch (e) {}
window.__wxHome = { style: window.mochiHomeStyle, set: setStyle, render: render, open: showWxHome, pins: pins };
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("home-wechat.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("home-wechat.js"); try { console.error("[JS] home-wechat.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[home-wechat.js] " + String(__e && __e.message || __e)); } })();
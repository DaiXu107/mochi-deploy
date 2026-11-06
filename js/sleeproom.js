(function () { try {
/* ===== 睡眠小屋 3D（src/js/sleeproom.js）=====
· 入口 1：桌面第二页 .app[data-app="sleep3d"]（应用市场自动收录）
· 入口 2：聊天「更多功能」#more-sleep3d
· 全屏 iframe 打开 sleeproom/index.html，铺满手机壳（含底部 tabbar）
· iframe 内返回按钮通过 postMessage({type:'mochi:sleeproom-close'}) 通知本文件关闭
· 联系人名字从聊天顶栏/桌面昵称带过去；未拿到就用房间默认名
*/
(function () {
'use strict';
var shell = null, frame = null, opened = false, frameUrl = '';
var cardCache = { key: '', at: 0, list: [] };
function $id(id) { return document.getElementById(id); }
function editing() {
try {
return Array.prototype.some.call(document.querySelectorAll('.app-grid'), function (g) {
return g.classList.contains('editing');
});
} catch (e) { return false; }
}
function readName(el) {
var n = el ? String(el.textContent || '').trim() : '';
if (!n || n === 'TA' || n === 'ta') return '';
return n.slice(0, 12);
}
function storeGet(key) {
try {
var s = window.activeStore && window.activeStore();
return s ? s.get(key) : '';
} catch (e) { return ''; }
}
function partnerName() {
try {
var n = window.chatPartnerName ? String(window.chatPartnerName() || '').trim() : '';
if (n && n !== 'TA') return n.slice(0, 12);
} catch (e) {}
return storeGet('lbl-partner') || readName($id('chat-partner-name')) || readName($id('lbl-partner'));
}
function userName() {
return storeGet('lbl-user') || readName($id('lbl-user'));
}
function roomContactName(c) {
if (!c) return '';
try {
var root = window.xyStore && window.xyStore('xy-home-v2');
var raw = root && root.get('gc-profiles');
if (raw) {
var p = JSON.parse(raw);
var prof = p && p[c.id];
var gn = prof && String(prof.name || '').trim();
if (gn) return gn.slice(0, 12);
}
} catch (e) {}
try {
var s = window.storeForCid ? window.storeForCid(c.id)
: (window.xyStore ? window.xyStore('xy-home-v2:' + c.id) : null);
var n = s && (s.get('cs-lbl-partner') || s.get('lbl-partner'));
n = n && String(n).trim();
if (n && n !== 'TA') return n.slice(0, 12);
} catch (e) {}
return String(c.name || '').trim().slice(0, 12);
}
function otherContact() {
var active = 'default';
try { if (window.getActiveContact) active = window.getActiveContact() || 'default'; } catch (e) {}
var list = [];
try { if (window.getContacts) list = window.getContacts() || []; } catch (e) {}
for (var i = 0; i < list.length; i++) {
if (list[i] && list[i].id !== active) return list[i];
}
return null;
}
function safePx(name) {
try {
var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
var n = parseFloat(v);
return isFinite(n) && n > 0 ? Math.round(n) : 0;
} catch (e) { return 0; }
}
/* ---- 便签 ↔ 字卡 ----
房间的便签只从当前联系人的专属文字卡 + 公用文字卡里选，一次只贴一句。
同一发源里的多句卡只取第一句，媒体卡/功能卡跳过；结果按文本去重。 */
function oneSentence(raw) {
var t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
if (!t) return '';
var m = t.match(/^[\s\S]*?[。！？!?…]+[”’"'）)】\]]*/);
if (m) t = m[0].trim();
if (t.length > 80) t = t.slice(0, 79) + '…';
return t;
}
function textGroups(raw) {
if (!raw) return null;
if (typeof raw !== 'string') return Array.isArray(raw) ? raw : (Array.isArray(raw.text) ? raw.text : null);
var s = raw;
if (s.length < 2 * 1024 * 1024) {
try {
var d = JSON.parse(s);
return Array.isArray(d) ? d : (d && Array.isArray(d.text) ? d.text : null);
} catch (e) {}
}
var k = s.indexOf('"text"');
if (k < 0) return null;
var i = s.indexOf(':', k + 6);
if (i < 0) return null;
i++;
while (i < s.length && /\s/.test(s.charAt(i))) i++;
if (s.charAt(i) !== '[') return null;
var start = i, depth = 0, inStr = false, esc = false;
for (; i < s.length; i++) {
var ch = s.charAt(i);
if (inStr) {
if (esc) esc = false;
else if (ch === '\\') esc = true;
else if (ch === '"') inStr = false;
} else if (ch === '"') {
inStr = true;
} else if (ch === '[') {
depth++;
} else if (ch === ']') {
depth--;
if (depth === 0) {
try { return JSON.parse(s.slice(start, i + 1)); } catch (e2) { return null; }
}
}
}
return null;
}
function collectCards(out, seen, raw, scope, meName, taName) {
var groups = textGroups(raw);
if (!groups) return;
groups.forEach(function (grp) {
if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
var groupName = String(grp[0] || '').trim();
grp[1].forEach(function (c) {
if (typeof c !== 'string') return;
var rawText = c.trim();
if (!rawText) return;
if (/^(data:|@@m:|__img__|__voice__)/.test(rawText) || rawText.indexOf('|||') >= 0) return;
var text = oneSentence(rawText);
if (meName) text = text.split('{me}').join(meName);
if (taName) text = text.split('{ta}').join(taName);
if (!text || seen[text]) return;
seen[text] = 1;
out.push({ t: text, g: groupName, scope: scope });
});
});
}
function sleepRoomCards() {
var cid = 'default';
try { if (window.getActiveContact) cid = window.getActiveContact() || 'default'; } catch (e) {}
var now = Date.now();
if (cardCache.key === cid && now - cardCache.at < 10000) return cardCache.list.slice();
var out = [], seen = Object.create(null);
var meName = userName(), taName = partnerName();
try {
var s = window.activeStore && window.activeStore();
if (s) collectCards(out, seen, s.get('cc-groups'), '专属', meName, taName);
} catch (e) {}
try {
var pub = window.xyStore && window.xyStore('xy-home-v2');
if (pub) collectCards(out, seen, pub.get('cc-groups-public'), '公用', meName, taName);
} catch (e) {}
cardCache = { key: cid, at: now, list: out };
return out.slice();
}
window.mochiSleepRoomCards = sleepRoomCards;
function buildUrl() {
var p = new URLSearchParams();
p.set('embed', '1');
p.set('mode', 'single');
var me = userName();
var ta = partnerName();
var c2 = otherContact();
var ta2 = roomContactName(c2);
if (me) p.set('me', me);
if (ta) p.set('name', ta);
p.set('group', c2 ? '1' : '0');
if (ta2) p.set('name2', ta2);
var st = safePx('--mochi-safe-top');
var sb = safePx('--mochi-safe-bottom');
if (st) p.set('safetop', String(st));
if (sb) p.set('safebot', String(sb));
return 'sleeproom/index.html?' + p.toString();
}
function open() {
if (!shell || !frame) return;
cardCache.at = 0; // 每次开房间重新读字卡库（关房期间可能改过卡）
var mp = $id('chat-more-panel');
if (mp) mp.hidden = true;
var url = buildUrl();
if (!frame.getAttribute('src') || frame.getAttribute('src') === 'about:blank' || frameUrl !== url) {
frameUrl = url;
frame.src = url;
}
shell.hidden = false;
opened = true;
try { document.body.classList.add('sleeproom-open'); } catch (e) {}
}
function close() {
if (!shell || !frame) return;
shell.hidden = true;
opened = false;
frameUrl = '';
try { frame.src = 'about:blank'; } catch (e) {}
try { document.body.classList.remove('sleeproom-open'); } catch (e) {}
}
function boot() {
shell = $id('sleeproom-shell');
frame = $id('sleeproom-frame');
if (!shell || !frame) return;
var icon = document.querySelector('.app[data-app="sleep3d"]');
if (icon) {
icon.addEventListener('click', function (e) {
if (editing()) return; // 桌面编辑模式：让个性化菜单接管
e.stopPropagation();
open();
});
}
var more = $id('more-sleep3d');
if (more) {
more.addEventListener('click', function (e) {
e.stopPropagation();
open();
});
}
window.addEventListener('message', function (e) {
if (e.origin !== location.origin) return;
if (!e.data || e.data.type !== 'mochi:sleeproom-close') return;
if (frame && e.source && e.source !== frame.contentWindow) return;
close();
});
document.addEventListener('contact-switched', function () { cardCache.at = 0; });
document.addEventListener('keydown', function (e) {
if (opened && e.key === 'Escape') close();
});
window.openSleepRoom = open;
window.closeSleepRoom = close;
window.__sleepRoomOpened = function () { return opened; };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("sleeproom.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("sleeproom.js"); try { console.error("[JS] sleeproom.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[sleeproom.js] " + String(__e && __e.message || __e)); } })();
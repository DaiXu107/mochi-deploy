(function () { try {
(function () {
const G = 'xy-home-v2';
const EXCLUDE = ['contacts', 'active-contact', 'feed-posts', 'migrated-v1', 'js-errors', 'theme-mode', 'accent-color',
'fish-log', 'fish-log-global-migrated',
'age-confirmed', 'storage-guide-shown',
'incoming-requests', 'desk-checkin-en', 'desk-call-en', 'desk-freq-mode', 'call-hold',
'night-mode-en',
'group-chat-msgs',
'bg-keepalive', 'bg-notify', 'bg-notify-nodedup',
'gift-wallet', 'wallet-global-migrated',
'gc-profiles', 'gc-beauty', 'group-chat-enabled',
'__last-backup', '__last-backup-remind', '__onboard-done', '__guide-done', '__edge-backup-hint-done', '__auto-backup-snapshot',
'__ka-hb',
'period-records', 'period-cfg', 'period-daily', 'period-notify', 'period-migrated',
'cc-groups-public', 'cc-groups-public-off', 'cc-scope-migrated', 'cc-media-names-public',
'cc-scope-notice-done',
'my-emoji-groups', 'mye-global-migrated',
'emoji-recent',
'emoji-recent-kaomoji', 'emoji-recent-emoji',
'__coach-seen',
'media-auto-check',
'piggy-log', 'piggy-goal-name', 'piggy-goal-amt', 'piggy-cards', 'piggy-last-visit',
'piggy-goals', 'piggy-goal-cur', 'piggy-coin-log', 'piggy-coin-goals', 'piggy-coin-goal-cur', 'piggy-coin-last-visit',
'piggy-coin-prob',
'market-custom', 'market-migrated',
'market-migrated-v2', 'market-migrated-v3',
'cjian-roster', 'cjian-state', 'cjian-seeded', 'cjian-rehome-v1',
'cjian-belong-v2',
'feed-notices', 'feed-app-unread', 'feed-cover-bg', 'feed-ta-cover',
'feed-ta-name', 'feed-ta-avatar', 'feed-user-name', 'feed-user-avatar',
'feed-last', 'feed-next', 'feed-day-count',
'psync-snap', 'psync-queue', 'psync-en',
'decision-history', 'decision-settings', 'dec-global-migrated',
'gdec-members', 'gdec-history', 'gdec-settings', 'gdec-global-migrated',
'pomo-cfg', 'pomo-today', 'pomo-total', 'pomo-msgs', 'pomo-send-chat', 'pomo-bell',
'pomo-companion', 'pomo-companion-log', 'pomo-cmp-usecards',
'memo-app-items', 'memo-app-send', 'memo-app-global-migrated', 'memo-app-remind',
'beauty-schemes', 'chat-beauty-schemes', 'hide-ta-sticker',
'hide-tab-kaomoji', 'hide-tab-emoji',
'chat-textcard-direct',
'chat-panel-prewarm',
'full-beauty-schemes', 'beauty-undo-stack', 'ver-update-ack-ts', 'ver-update-notify',
'call-active',
'applock-en', 'applock-pin', 'applock-qa',
'applock-qa-en', 'applock-qalist', 'applock-qaskip',
'cardlock-state',
'cs-font',
'sfx-unified',
'entry-cjian-first', 'entry-default-contact', 'entry-show-list',
'battery-check-run', 'battery-check-last', 'heat-check-last',
'flash-check-last',
'ver-retry',
'fhub-freq', 'fhub-seen',
'age-confirmed'];
function isExcluded(k) {
const r = k.slice(G.length + 1);
if (r.indexOf('__') === 0) return true;
if (EXCLUDE.indexOf(r) >= 0) return true;
if (r.indexOf('splash-seen:') === 0) return true;
if (r.indexOf('reply-gc-') === 0) return true;
if (r.indexOf('music-file:') === 0) return true;
if (r.indexOf('font-blob-') === 0) return true;
if (r.indexOf('narc-') === 0) return true;
if (r.indexOf('myarc') === 0) return true;
if (r.indexOf('screen-adj-') === 0) return true;
const m = r.match(/^([^:]+):/);
if (m) {
const head = m[1];
if (head === 'default' || /^c[0-9a-z]{5,}$/.test(head)) return true;
const bizPrefix = ['dc-off', 'rc-off', 'mc-off', 'ck-off', 'quote-off', 'day-fish', 'greeted', 'cal'];
if (bizPrefix.some(p => head.indexOf(p) === 0)) return false;
return true;
}
return false;
}
let _cid = 'default';
try {
const a = window.xyStore ? window.xyStore(G).get('active-contact') : localStorage.getItem(G + ':active-contact');
if (a) _cid = a;
} catch (e) {}
window.__activeCid = _cid;
window.activePrefix = function () { return G + ':' + (window.__activeCid || 'default'); };
function defaultStore() {
const ns = G + ':default';
return {
get(k) {
let v = null;
try { v = window.xyStore(ns).get(k); } catch (e) {}
if (v !== null) return v;
try { v = window.xyStore(G).get(k); } catch (e) {}
return v;
},
set(k, v) {
window.xyStore(ns).set(k, v);
try { window.xyStore(G).remove(k); } catch (e) {}
},
awaitingBigKey(k) {
try { if (window.xyStore(ns).get(k) !== null) return false; } catch (e3) {}
try { if (window.xyStore(G).get(k) !== null) return false; } catch (e4) {}
try { return window.xyStore(ns).awaitingBigKey(k); } catch (e) { return false; }
},
requestBigKey(k) {
try { window.xyStore(ns).requestBigKey(k); } catch (e) {}
try { window.xyStore(G).requestBigKey(k); } catch (e2) {}
},
whenBigKeyBack(k, cb) {
try {
const s = window.xyStore(ns);
if (s && s.whenBigKeyBack) { s.whenBigKeyBack(k, cb); return; }
} catch (e) {}
try { const r = window.xyStore(G); if (r && r.whenBigKeyBack) { r.whenBigKeyBack(k, cb); return; } } catch (e2) {}
try { if (cb) cb(); } catch (e3) {}
},
remove(k) {
window.xyStore(ns).remove(k);
try { window.xyStore(G).remove(k); } catch (e) {}
}
};
}
window.activeStore = function () {
const dyn = function () {
const cid = window.__activeCid || 'default';
return cid === 'default' ? defaultStore() : window.xyStore(G + ':' + cid);
};
return {
get: (k) => dyn().get(k),
set: (k, v) => dyn().set(k, v),
remove: (k) => dyn().remove(k),
awaitingBigKey: (k) => { const d = dyn(); return !!(d.awaitingBigKey && d.awaitingBigKey(k)); },
requestBigKey: (k) => { const d = dyn(); try { if (d.requestBigKey) d.requestBigKey(k); } catch (e) {} },
whenBigKeyBack: (k, cb) => {
const d = dyn();
if (d.whenBigKeyBack) { d.whenBigKeyBack(k, cb); return; }
try { if (cb) cb(); } catch (e2) {}
}
};
};
window.storeFor = function (cid) { return window.xyStore(G + ':' + cid); };
window.storeForCid = function (cid) { return cid === 'default' ? defaultStore() : window.xyStore(G + ':' + cid); };
window.partnerGenderFor = function (cid) {
try { return window.xyStore(G + ':' + (cid || 'default')).get('partner-gender') || ''; } catch (e) { return ''; }
};
window.taWordFor = function (cid) {
const g = window.partnerGenderFor(cid);
if (g === 'he') return '他';
if (g === 'she') return '她';
return 'TA';
};
window.taWord = function () { return window.taWordFor(window.__activeCid || 'default'); };
window.contactNameFor = function (cid) {
try {
const c = getContacts().find(x => x.id === (cid || 'default'));
return (c && c.name) || '';
} catch (e) { return ''; }
};
window.taFit = function (text, cid) {
if (text === null || text === undefined) return text;
const s = String(text);
if (s.indexOf('他') < 0 && s.indexOf('TA') < 0 && s.indexOf('ta') < 0) return s;
const w = window.taWordFor(cid || window.__activeCid || 'default');
const taw = w === 'TA' ? 'ta' : w;
const segs = s.split(/(<svg[\s\S]*?<\/svg>)/);
for (let i = 0; i < segs.length; i += 2) {
const parts = segs[i].split(/(data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/);
for (let j = 0; j < parts.length; j += 2) {
let p = parts[j].split('其他').join('\u0001').split('TA').join(w).split('他').join(w);
if (taw !== 'ta') p = p.replace(/\bta\b/g, taw);
parts[j] = p.split('\u0001').join('其他');
}
segs[i] = parts.join('');
}
return segs.join('');
};
function regStore() { return window.xyStore(G); }
function getContacts() {
try {
const v = regStore().get('contacts');
if (v) { const a = JSON.parse(v); if (Array.isArray(a) && a.length) return a; }
} catch (e) {}
return [{ id: 'default', name: '默认' }];
}
window.getContacts = getContacts;
window.getActiveContact = function () { return window.__activeCid || 'default'; };
window.createContact = function (name) {
const list = getContacts();
const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
const nm = name || ('联系人' + (list.length));
list.push({ id: id, name: nm });
regStore().set('contacts', JSON.stringify(list));
try { window.xyStore(G + ':' + id).set('lbl-partner', nm); } catch (e) {}
return id;
};
window.renameContact = function (id, name) {
const list = getContacts(); const c = list.find(x => x.id === id);
if (c) {
const oldName = c.name;
c.name = name || c.name;
regStore().set('contacts', JSON.stringify(list));
try {
const s = window.xyStore(G + ':' + id);
const cur = s.get('lbl-partner');
const csLbl = s.get('cs-lbl-partner');
const taWordId = window.taWordFor ? window.taWordFor(id) : 'TA';
const oldEff = csLbl || oldName || taWordId;
if (!cur || cur === oldName) s.set('lbl-partner', c.name);
const newEff = csLbl || c.name || taWordId;
if (newEff !== oldEff) {
if (id === (window.__activeCid || 'default') && window.chatSysNickChanged) {
try { window.chatSysNickChanged(oldEff); } catch (e) {}
} else {
let h = [];
try { const v = JSON.parse(s.get('sysmsg-nick-hist') || '[]'); if (Array.isArray(v)) h = v; } catch (e) {}
if (h.indexOf(oldEff) < 0) { h.push(oldEff); s.set('sysmsg-nick-hist', JSON.stringify(h)); }
}
}
} catch (e) {}
try { document.dispatchEvent(new CustomEvent('contact-renamed', { detail: { id, name: c.name, oldName } })); } catch (e) {}
}
};
window.deleteContact = function (id) {
if (id === 'default') return false;
const list = getContacts().filter(x => x.id !== id);
regStore().set('contacts', JSON.stringify(list));
const prefix = G + ':' + id + ':';
const del = function (k) { try { window.xyStore(prefix).remove(k.slice(prefix.length)); } catch (e) {} };
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (k && k.indexOf(prefix) === 0) del(k);
}
if (window.idbGetAllKeys) {
window.idbGetAllKeys().then(keys => {
(keys || []).forEach(k => { if (typeof k === 'string' && k.indexOf(prefix) === 0) del(k); });
}).catch(() => {});
}
if (window.__activeCid === id) window.setActiveContact('default');
return true;
};
let autoFixingCid = false;   // true=正在执行自动校正，不算用户手动切换
let cidUserSwitched = false; // 本会话用户手动切过桌面 → 校正不再干预
window.setActiveContact = function (id) {
if (id === (window.__activeCid || 'default')) return;
if (!autoFixingCid) cidUserSwitched = true;
try { if (window.chatFlushSave) window.chatFlushSave(); } catch (e) {}
try { if (window.ccFlushSave) window.ccFlushSave(); } catch (e) {}
window.__activeCid = id;
try { regStore().set('active-contact', id); } catch (e) {
try { localStorage.setItem(G + ':active-contact', id); } catch (e2) {}
try { if (window.idbSet) window.idbSet(G + ':active-contact', id); } catch (e3) {}
}
if (window.refreshActiveContactUI) window.refreshActiveContactUI();
try { document.dispatchEvent(new Event('contact-switched')); } catch (e) {}
try {
document.querySelectorAll('.page').forEach(p => { if (!p.hidden) p.hidden = true; }); // FIX #338 同值写也发 mutation（Blink 实测同值 3 连写=3 条记录），44 页全扫=唤醒全部页面观察器
const home = document.getElementById('page-phone'); if (home) home.hidden = false;
} catch (e) {}
};
window.switchContact = window.setActiveContact;
let cidAutoFixTries = 0;   // 已尝试次数（回填挂起时首次可能读不到值，不能一次定死）
function autoFixMomentSafe() {
try {
const sp = document.getElementById('splash');
if (sp && !sp.classList.contains('hide')) return true;
const home = document.getElementById('page-phone');
if (!home || home.hidden) return false;
const pages = document.querySelectorAll('.page');
for (let i = 0; i < pages.length; i++) {
if (pages[i] !== home && !pages[i].hidden) return false;
}
return true;
} catch (e) { return false; }
}
function applyCidCorrection(saved) {
if (!saved || saved === (window.__activeCid || 'default')) return;
if (saved !== 'default') {
let known = false;
try { known = getContacts().some(c => c && c.id === saved); } catch (e) {}
if (!known) return;
}
cidAutoFixTries = 99; // 已生效 → 本会话不再校正
autoFixingCid = true;
try { window.setActiveContact(saved); } catch (e) {}
autoFixingCid = false;
try { console.info('[mochi] 启动校正：localStorage 无 active-contact，已按 IndexedDB 权威值切回桌面 ' + saved); } catch (e) {}
}
function correctCidFromIdb() {
if (cidUserSwitched || cidAutoFixTries >= 3) return;
if (!window.xyStore || !autoFixMomentSafe()) return;
let saved = null;
try { saved = window.xyStore(G).get('active-contact'); } catch (e) { return; }
saved = (saved == null ? '' : String(saved)).trim();
if (!saved && window.idbGet) {
try {
window.idbGet(G + ':active-contact').then(function (v) {
cidAutoFixTries++;
const s = (v == null ? '' : String(v)).trim();
if (!s || cidUserSwitched || cidAutoFixTries > 3) return;
if (!autoFixMomentSafe()) return;
applyCidCorrection(s);
}).catch(function () { cidAutoFixTries++; });
} catch (e) {}
return;
}
cidAutoFixTries++;
applyCidCorrection(saved);
}
try {
if (window.__mochiDataReady) setTimeout(correctCidFromIdb, 0);
else {
document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
correctCidFromIdb();
});
}
document.addEventListener('mochi-wrj-heal', function () { correctCidFromIdb(); });
setTimeout(correctCidFromIdb, 16000);
} catch (e) {}
window.refreshActiveContactUI = function () {
try { if (window.applyAvatars) window.applyAvatars(); } catch (e) {}
try { if (window.renderChatHeader) window.renderChatHeader(); } catch (e) {}
};
function migrateLegacy() {
const def = window.xyStore(G + ':default');
const root = window.xyStore(G);
try {
['bg-keepalive', 'bg-notify', 'bg-notify-nodedup', 'group-chat-enabled'].forEach(function (k) {
const v = def.get(k);
if (v !== null && v !== undefined && v !== '') {
try { if (root.get(k) === null || root.get(k) === undefined) root.set(k, v); } catch (e) {}
try { def.remove(k); } catch (e) {}
}
});
const gcKeys = [];
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (k && k.indexOf(G + ':default:reply-gc-') === 0) gcKeys.push(k.slice((G + ':default:').length));
}
gcKeys.forEach(function (k) {
const v = def.get(k);
if (v !== null && v !== undefined && v !== '') {
try { if (root.get(k) === null || root.get(k) === undefined) root.set(k, v); } catch (e) {}
try { def.remove(k); } catch (e) {}
}
});
} catch (e) {}
['pomo-cfg', 'pomo-today', 'pomo-total', 'pomo-msgs', 'pomo-send-chat', 'pomo-bell',
'pomo-companion', 'pomo-companion-log', 'pomo-cmp-usecards',
'beauty-schemes', 'chat-beauty-schemes', 'hide-ta-sticker', 'desk-freq-mode',
'full-beauty-schemes', 'fhub-freq', 'fhub-seen',
'screen-adj-top', 'screen-adj-bottom', 'screen-adj-h', 'screen-adj-desk',
'screen-adj-shift', 'screen-adj-text', 'screen-adj-side'].forEach(function (k) {
const v = def.get(k);
if (v !== null && v !== undefined && v !== '') {
try { if (root.get(k) === null || root.get(k) === undefined) root.set(k, v); } catch (e) {}
try { def.remove(k); } catch (e) {}
}
});
['age-confirmed', 'storage-guide-shown'].forEach(function (k) {
const v = def.get(k);
if (v !== null && v !== undefined && v !== '') {
try { if (root.get(k) === null || root.get(k) === undefined) root.set(k, v); } catch (e) {}
try { def.remove(k); } catch (e) {}
}
});
try {
const stale = [];
for (let i = 0; i < localStorage.length; i++) {
const kk = localStorage.key(i);
if (kk && kk.indexOf(G + ':default:splash-seen:') === 0) stale.push(kk);
}
stale.forEach(function (kk) { try { localStorage.removeItem(kk); } catch (e2) {} });
} catch (e) {}
const old = [];
const garbage = [];
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k) continue;
if (k.indexOf(G + ':default:default:') === 0) garbage.push(k);
}
garbage.forEach(k => {
try { localStorage.removeItem(k); } catch (e) {}
if (window.idbDelete) try { window.idbDelete(k); } catch (e) {}
});
const sysGarbage = [];
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k) continue;
if (k.indexOf(G + ':default:__') === 0) sysGarbage.push(k);
}
sysGarbage.forEach(k => {
try { localStorage.removeItem(k); } catch (e) {}
if (window.idbDelete) try { window.idbDelete(k); } catch (e) {}
});
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (k && k.indexOf(G + ':') === 0 && !isExcluded(k)) old.push(k);
}
const finish = function () {
try {
if (!regStore().get('contacts')) {
let name = '默认';
try { const n = window.xyStore(G + ':default').get('lbl-partner'); if (n) name = n; } catch (e) {
try { const n = localStorage.getItem(G + ':default:lbl-partner'); if (n) name = n; } catch (e2) {}
}
regStore().set('contacts', JSON.stringify([{ id: 'default', name: name }]));
}
if (!regStore().get('active-contact')) {
const acWrite = function () {
try { if (!regStore().get('active-contact')) regStore().set('active-contact', 'default'); } catch (e) {}
};
if (window.idbHasKey) {
try {
window.idbHasKey(G + ':active-contact').then(function (has) {
if (has === false) acWrite();
}).catch(acWrite);
} catch (e) { acWrite(); }
} else acWrite();
}
localStorage.setItem(G + ':migrated-v1', '1');
} catch (e) {}
window.__contactsMigrated = true;
window.__activeCid = window.__activeCid || 'default';
};
if (!old.length) { finish(); return; }
const step = function (i) {
if (i >= old.length) { finish(); return; }
const k = old[i];
const rest = k.slice(G.length + 1);
const newKey = G + ':default:' + rest;
const next = function () { step(i + 1); };
const isChat = (function () {
const tail = k.slice(G.length + 1);
return tail === 'chat-msgs' || /^[^:]+:chat-msgs$/.test(tail);
})();
const cleanupOld = function () {
try { localStorage.removeItem(k); } catch (e) {}
if (isChat && window.idbDelete) { try { window.idbDelete(k); } catch (e) {} }
};
const settle = function (payload) {
try { window.xyStore(G + ':default').set(rest, payload); } catch (e) {}
const landed = function (durable) { if (durable) cleanupOld(); next(); };
try { if (localStorage.getItem(newKey) !== null) { landed(true); return; } } catch (e) {}
if (window.idbHasKey) {
Promise.resolve(window.idbHasKey(newKey)).then(function (has) {
landed(has === true);
}).catch(function () { landed(false); });
} else landed(false);
};
let v = null; try { v = localStorage.getItem(k); } catch (e) {}
if (v !== null) {
const hasNew = window.xyStore(G + ':default').get(rest);
if (hasNew) { cleanupOld(); next(); return; }
if (window.idbGet) {
window.idbGet(newKey).then(function (existing) {
if (existing) { cleanupOld(); next(); return; }
settle(v);
}).catch(function () { settle(v); });
} else settle(v);
} else if (window.idbGet) {
window.idbGet(k).then(r => {
if (r !== undefined && r !== null) {
const hasNew = window.xyStore(G + ':default').get(rest);
if (hasNew) { cleanupOld(); next(); return; }
window.idbGet(newKey).then(function (existing) {
if (existing) { cleanupOld(); next(); return; }
settle(r);
}).catch(function () { settle(r); });
} else {
cleanupOld();
next();
}
}).catch(next);
} else next();
};
if (window.idbGetAllKeys) {
window.idbGetAllKeys().then(keys => {
(keys || []).forEach(k => {
if (typeof k === 'string' && k.indexOf(G + ':') === 0 && !isExcluded(k) && old.indexOf(k) < 0) old.push(k);
});
step(0);
}).catch(() => step(0));
} else step(0);
}
function runMigrateWhenReady() {
if (window.__mochiDataReady) { migrateLegacy(); return; }
try {
document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
migrateLegacy();
});
} catch (e) { migrateLegacy(); }
}
runMigrateWhenReady();
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function showContactModal(m) { m.style.display = 'flex'; m.hidden = false; }
function hideContactModal(m) { m.style.display = 'none'; m.hidden = true; }
function ensureModal() {
let m = document.getElementById('contact-manager');
if (!m) {
m = el('div'); m.id = 'contact-manager'; m.hidden = true;
m.style.cssText = 'position:fixed;inset:0;z-index:89;align-items:center;justify-content:center;background:rgba(0,0,0,.4)';
document.body.appendChild(m);
m.addEventListener('click', (e) => { if (e.target === m) hideContactModal(m); });
}
if (!document.getElementById('cm-scrollbar-hide')) {
const st = document.createElement('style'); st.id = 'cm-scrollbar-hide';
st.textContent = '.cm-list{scrollbar-width:none;-ms-overflow-style:none}.cm-list::-webkit-scrollbar{display:none}' +
'#cm-fn-explain{display:inline-block;margin-left:4px;font-size:11px;color:var(--muted,#888);font-weight:400;letter-spacing:.2px;border:1px solid rgba(0,0,0,.08);background:rgba(0,0,0,.03);border-radius:9px;padding:2px 9px;cursor:pointer;line-height:1.4}' +
'#cm-fn-explain:hover,#cm-fn-explain:focus-visible{background:rgba(0,0,0,.06);border-color:rgba(0,0,0,.12);outline:none}' +
'[data-theme="dark"] #cm-fn-explain{color:#aaa;border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.06)}' +
'[data-theme="dark"] #cm-fn-explain:hover,[data-theme="dark"] #cm-fn-explain:focus-visible{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2)}';
document.head.appendChild(st);
}
return m;
}
window.openContactManager = function () {
const m = ensureModal();
m.innerHTML = '';
const box = el('div');
box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2)';
box.appendChild(el('div', '', '<div style="font-size:16px;font-weight:600;margin-bottom:4px">联系人 / 桌面</div><div style="font-size:12px;color:var(--muted,#888);margin-bottom:12px">每个联系人数据独立；除朋友圈外，还有部分功能数据在所有桌面共用。<b id="cm-fn-explain">【功能说明】</b><br>「称呼」可设置消息里 TA 的性别叫法（他 / 她 / 不设置）</div>'));
const list = el('div', 'cm-list'); list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0';
getContacts().forEach(c => {
const row = el('div');
row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px';
const dot = el('div');
dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + (c.id === window.__activeCid ? 'var(--ink,#111)' : '#ccc');
const gw = window.taWordFor(c.id);
const gLabel = gw === 'TA' ? '' : (' · 称呼：' + gw);
const nm = el('div', '', '<div style="font-size:14px;font-weight:500">' + (c.name || c.id) + '</div><div style="font-size:11px;color:var(--muted,#999)">' + (c.id === window.__activeCid ? '当前桌面' : '点击切换') + gLabel + '</div>');
nm.style.flex = '1';
row.appendChild(dot); row.appendChild(nm);
if (c.id !== window.__activeCid) {
row.style.cursor = 'pointer';
row.addEventListener('click', () => { window.setActiveContact(c.id); hideContactModal(m); });
}
const acts = el('div'); acts.style.cssText = 'display:flex;gap:6px';
const gen = el('button', '', '称呼');
gen.style.cssText = 'font-size:12px;padding:4px 8px;border:1px solid var(--pill-border,#ddd);border-radius:8px;background:var(--static-bg,#fafafa);color:var(--ink,#111)';
gen.addEventListener('click', (e) => {
e.stopPropagation();
openGenderModal(c, m);
});
acts.appendChild(gen);
const ren = el('button', '', '改名');
ren.style.cssText = 'font-size:12px;padding:4px 8px;border:1px solid var(--pill-border,#ddd);border-radius:8px;background:var(--static-bg,#fafafa);color:var(--ink,#111)';
ren.addEventListener('click', (e) => {
e.stopPropagation();
if (window.openModal) window.openModal('改名', c.name || '', (v) => {
if (v && v.trim()) { window.renameContact(c.id, v.trim()); window.openContactManager(); }
else { try { if (window.toast) window.toast('没有读到名字——请再试一次；反复出现请到设置→关于/诊断导出诊断单报障'); } catch (e0) {} }
});
});
acts.appendChild(ren);
if (c.id !== 'default') {
const del = el('button', '', '删除');
del.style.cssText = 'font-size:12px;padding:4px 8px;border:1px solid rgba(163,45,45,.35);border-radius:8px;background:var(--danger-soft,#fff5f5);color:var(--danger-ink,#a32d2d)';
del.addEventListener('click', (e) => { e.stopPropagation(); confirmDelete(c, m); });
acts.appendChild(del);
}
row.appendChild(acts);
list.appendChild(row);
});
box.appendChild(list);
const add = el('button', '', '+ 添加联系人 / 桌面');
add.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--ink,#111);color:var(--bg-b,#fff);font-size:14px;font-weight:600';
add.addEventListener('click', () => {
if (window.openModal) window.openModal('新建联系人', '', (v) => {
const name = (v || '').trim();
if (!name) { try { if (window.toast) window.toast('还没有输入名字——先点输入框打一个名字'); } catch (e0) {} return; }
const id = window.createContact(name); window.setActiveContact(id); hideContactModal(m);
try { if (window.toast) window.toast('已创建「' + name + '」的桌面，已为你切换'); } catch (e) {}
});
});
box.appendChild(add);
const close = el('button', '', '关闭');
close.style.cssText = 'width:100%;margin-top:8px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
close.addEventListener('click', () => { hideContactModal(m); });
box.appendChild(close);
m.appendChild(box);
document.getElementById('cm-fn-explain') && document.getElementById('cm-fn-explain').addEventListener('click', function (e) { e.stopPropagation(); if (window.openFuncExplain) window.openFuncExplain(); });
showContactModal(m);
};
window.openFuncExplain = function () {
const m = ensureModal();
m.innerHTML = '';
const box = el('div');
box.style.cssText = 'width:min(92vw,420px);max-height:80vh;display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.2);overflow-y:auto';;
const txt =
'<div style="font-size:16px;font-weight:600;margin-bottom:8px">数据互通说明</div>' +
'<div style="font-size:13px;font-weight:600;color:var(--danger-ink,#a32d2d);margin-bottom:6px">所有桌面共用的数据</div>' +
'<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--muted,#666)">' +
'<li>朋友圈（动态、通知、双方昵称/头像/封面）</li>' +
'<li>群聊（消息、成员形象、美化、回复设置、开关）</li>' +
'<li>存钱罐（金额与存钱目标，两人共同金库）</li>' +
'<li>心意币 / 红包 / 市集余额</li>' +
'<li>心意市集自定义商品</li>' +
'<li>我的表情包</li>' +
'<li>字卡库公用字卡</li>' +
'<li>经期记录、摸鱼天数</li>' +
'<li>帮我决定 / 多人决定（历史与设置）</li>' +
'<li>梦角世界·此间（名单与状态）、梦角档案 / 我的档案</li>' +
'<li>音乐文件、后台保活、通知、离线消息提醒</li>' +
'<li>跨桌面「来消息」（查岗 / 来电申请与开关）</li>' +
'</ul>' +
'<div style="font-size:13px;font-weight:600;color:#1a8a5f;margin:12px 0 6px">按桌面独立的数据</div>' +
'<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--muted,#666)">' +
'<li>聊天记录与未读数</li>' +
'<li>字卡库专属字卡 / 专属回复 / 收藏</li>' +
'<li>桌面布局与美化（壁纸 / 气泡 / 字号等）</li>' +
'<li>称呼性别（TA / 他 / 她）</li>' +
'<li>日历、信箱、备忘录</li>' +
'<li>占卜、记录、收藏、统计、记账</li>' +
'</ul>' +
'<div style="font-size:12px;color:var(--muted,#999);margin-top:12px;line-height:1.7">「共用」指切换桌面后数据仍延续；「独立」指各桌面各留一份、互不影响。</div>';
box.appendChild(el('div', '', txt));
const close = el('button', '', '关闭');
close.style.cssText = 'width:100%;margin-top:14px;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
close.addEventListener('click', () => { hideContactModal(m); });
box.appendChild(close);
m.appendChild(box);
showContactModal(m);
};
function openGenderModal(c, m) {
if (!window.openModal) return;
const cur = window.partnerGenderFor(c.id);
window.openModal('称呼设置 · ' + (c.name || c.id), '', function (v) {
if (v !== 'he' && v !== 'she' && v !== '') return;
try { window.xyStore(G + ':' + c.id).set('partner-gender', v); } catch (e) {}
try { document.dispatchEvent(new CustomEvent('ta-word-changed', { detail: { id: c.id } })); } catch (e) {}
if ((window.__activeCid || 'default') === c.id && window.refreshActiveContactUI) window.refreshActiveContactUI();
hideContactModal(m);
}, {
noInput: true,
pill: cur,
staticText: '小字说明：设置后，桌面浮字、聊天、朋友圈、信箱等消息里的「TA／他」会跟随显示为「他」或「她」；选「不设置」则保持默认「TA」。该设置为每个联系人独立保存，只改显示方式，不会改动已保存的消息原文。',
pills: [
{ label: '他（男生）', value: 'he' },
{ label: '她（女生）', value: 'she' },
{ label: '不设置（默认 TA）', value: '' }
]
});
}
function confirmDelete(c, m) {
const m2 = ensureModal();
m2.innerHTML = '';
const box = el('div');
box.style.cssText = 'width:min(88vw,340px);background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:16px;padding:18px;text-align:center';
box.appendChild(el('div', '', '<div style="font-size:15px;font-weight:600;margin-bottom:6px">删除「' + (c.name || c.id) + '」？</div><div style="font-size:12px;color:var(--danger-ink,#a32d2d);margin-bottom:14px">该联系人的全部数据将清空，且不可恢复</div>'));
const row = el('div'); row.style.cssText = 'display:flex;gap:10px';
const ok = el('button', '', '删除');
ok.style.cssText = 'flex:1;padding:10px;border:none;border-radius:10px;background:#a32d2d;color:#fff;font-weight:600';
ok.addEventListener('click', () => { window.deleteContact(c.id); hideContactModal(m2); hideContactModal(m); window.openContactManager(); });
const no = el('button', '', '取消');
no.style.cssText = 'flex:1;padding:10px;border:1px solid var(--card-border,#eee);border-radius:10px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555)';
no.addEventListener('click', () => { hideContactModal(m2); });
row.appendChild(ok); row.appendChild(no); box.appendChild(row);
m2.appendChild(box); showContactModal(m2);
}
function entryCjianFirstOn() {
try { return regStore().get('entry-cjian-first') === '1'; } catch (e) { return false; }
}
function entryShowListOn() {
try { return regStore().get('entry-show-list') === '1'; } catch (e) { return false; }
}
function entryDefaultCid() {
let id = '';
try { id = regStore().get('entry-default-contact') || ''; } catch (e) {}
if (!id) return '';
try { return getContacts().some(c => c && c.id === id) ? id : ''; } catch (e) { return ''; }
}
function closeEntryPicker() {
const ov = document.getElementById('entry-picker');
if (ov) { ov.style.display = 'none'; ov.hidden = true; }
}
function ensureEntryPicker() {
let ov = document.getElementById('entry-picker');
if (!ov) {
ov = el('div'); ov.id = 'entry-picker'; ov.hidden = true;
ov.style.cssText = 'position:fixed;inset:0;z-index:10060;display:none;flex-direction:column;background:var(--bg-b,#fff);color:var(--ink,#111)';
document.body.appendChild(ov);
}
return ov;
}
function openContactPicker(opts) {
opts = opts || {};
const mode = opts.mode === 'setDefault' ? 'setDefault' : 'entry';
const ov = ensureEntryPicker();
const curDef = entryDefaultCid();
ov.innerHTML = '';
const head = el('div'); head.style.cssText = 'padding:22px 20px 6px;font-size:20px;font-weight:700';
head.textContent = mode === 'entry' ? '选择本次进入的桌面' : '默认进入的桌面';
ov.appendChild(head);
const sub = el('div'); sub.style.cssText = 'padding:0 20px 14px;font-size:12px;color:var(--muted,#888);line-height:1.6';
sub.textContent = mode === 'entry'
? (opts.sub || '看完此间了，选一个联系人桌面进入吧。')
: '开启后，每次打开应用直接进入所选桌面；选「关闭」即不设置。';
ov.appendChild(sub);
const wrap = el('div'); wrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 16px 18px;display:flex;flex-direction:column;gap:10px';
const mkCard = function (title, tagText, isCurrent, tagOn) {
const card = el('div');
card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px;border:1px solid var(--card-border,#eee);border-radius:14px;background:var(--card-bg,#fff);cursor:pointer';
const nm = el('div', '', '<div style="font-size:15px;font-weight:600">' + title + '</div>' +
(isCurrent ? '<div style="font-size:11px;color:var(--muted,#999)">当前桌面</div>' : ''));
nm.style.flex = '1';
card.appendChild(nm);
if (tagText) {
const tag = el('div', '', tagText);
tag.style.cssText = 'font-size:11px;padding:2px 9px;border-radius:9px;border:1px solid ' +
(tagOn ? 'rgba(26,138,95,.4);color:#1a8a5f;background:rgba(26,138,95,.08)' : 'rgba(0,0,0,.08);color:var(--muted,#888)');
card.appendChild(tag);
}
return card;
};
if (mode === 'setDefault') {
const off = mkCard('关闭（不设置）', '', false, false);
off.addEventListener('click', function () {
try { regStore().set('entry-default-contact', ''); } catch (e) {}
closeEntryPicker();
if (opts.onDone) opts.onDone();
});
wrap.appendChild(off);
}
getContacts().forEach(function (c) {
const isCurrent = c.id === (window.__activeCid || 'default');
const isDef = c.id === curDef;
const card = mkCard(c.name || c.id, (mode === 'entry' && isDef) ? '默认' : '', isCurrent, false);
card.addEventListener('click', function () {
if (mode === 'setDefault') {
try { regStore().set('entry-default-contact', c.id); } catch (e) {}
closeEntryPicker();
if (opts.onDone) opts.onDone();
} else {
closeEntryPicker();
try { if (c.id !== (window.__activeCid || 'default')) window.setActiveContact(c.id); } catch (e) {}
}
});
wrap.appendChild(card);
});
ov.appendChild(wrap);
if (mode === 'setDefault') {
const cancel = el('button', '', '取消');
cancel.style.cssText = 'margin:0 16px 18px;padding:11px;border:1px solid var(--card-border,#eee);border-radius:12px;background:var(--btn-cancel-bg,#fafafa);color:var(--btn-cancel-ink,#555);font-size:14px';
cancel.addEventListener('click', function () { closeEntryPicker(); if (opts.onDone) opts.onDone(); });
ov.appendChild(cancel);
}
ov.hidden = false; ov.style.display = 'flex';
}
window.__openContactPicker = openContactPicker;
function removeCjianHint() {
const h = document.getElementById('entry-cjian-hint');
if (h && h.parentNode) h.parentNode.removeChild(h);
}
function showCjianHint() {
removeCjianHint();
const page = document.getElementById('page-cjian');
if (!page) return;
const hint = el('div', '', '点每位梦角的【去找TA】直接进入 TA 的桌面；点左上角返回，则选择本次进入哪个桌面。若某位梦角没有状态显示，点下方【感知此间】看看 TA 此刻在哪、在做什么。');
hint.id = 'entry-cjian-hint';
hint.style.cssText = 'margin:8px 12px 0;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.6;color:var(--muted,#666);background:rgba(127,106,216,.08);border:1px solid rgba(127,106,216,.2)';
const head = page.querySelector('.chat-head');
if (head && head.parentNode === page) page.insertBefore(hint, head.nextSibling);
else page.insertBefore(hint, page.firstChild);
}
window.mochiContactEntryFlow = function () {
if (window.__mochiEntryFlowDone) return;
window.__mochiEntryFlowDone = true;
const def = entryDefaultCid();
if (def && def !== (window.__activeCid || 'default')) {
try { window.setActiveContact(def); } catch (e) {}
}
if (!entryCjianFirstOn()) {
if (entryShowListOn()) openContactPicker({ mode: 'entry', sub: '选一个联系人桌面进入吧。' });
return;
}
if (!window.openCjian) { openContactPicker({ mode: 'entry' }); return; }
let page = null;
try { page = document.getElementById('page-cjian'); } catch (e) {}
if (!page) { openContactPicker({ mode: 'entry' }); return; }
let fired = false;
const obs = new MutationObserver(function () {
if (!page.hidden || fired) return;
fired = true;
try { obs.disconnect(); } catch (e) {}
removeCjianHint();
const chat = document.getElementById('page-chat');
if (chat && !chat.hidden) return;
setTimeout(function () { openContactPicker({ mode: 'entry' }); }, 0);
});
try { obs.observe(page, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
try {
window.__cjianFrom = '';
window.openCjian();
showCjianHint();
const chips = document.querySelectorAll('#cj-groups .cj-gchip');
for (let i = 0; i < chips.length; i++) {
if (chips[i].textContent === '全部') { chips[i].click(); break; }
}
} catch (e) {
try { obs.disconnect(); } catch (e2) {}
removeCjianHint();
openContactPicker({ mode: 'entry' });
}
};
function syncEntryModes() {
const hasDef = !!entryDefaultCid();
const cbC = document.getElementById('entry-cjian-first');
const cbL = document.getElementById('entry-show-list');
if (hasDef) {
try {
if (regStore().get('entry-cjian-first') === '1') regStore().set('entry-cjian-first', '0');
if (regStore().get('entry-show-list') === '1') regStore().set('entry-show-list', '0');
} catch (e) {}
if (cbC) cbC.checked = false;
if (cbL) cbL.checked = false;
}
if (cbC) cbC.disabled = hasDef;
if (cbL) cbL.disabled = hasDef;
const rowC = document.getElementById('row-entry-cjian-first');
const rowL = document.getElementById('row-entry-show-list');
if (rowC) rowC.style.opacity = hasDef ? '.5' : '';
if (rowL) rowL.style.opacity = hasDef ? '.5' : '';
let tip = document.getElementById('entry-cjian-first-tip');
if (hasDef) {
if (!tip && rowC && rowC.parentNode) {
tip = el('div', 'gs-sub', '已由「默认进入的桌面」取代：每次打开直接进入所选桌面，不再先进入此间或显示联系人列表。要恢复，请把上面的默认桌面设为「关闭」。');
tip.id = 'entry-cjian-first-tip';
rowC.parentNode.insertBefore(tip, rowC.nextSibling);
}
} else if (tip && tip.parentNode) {
tip.parentNode.removeChild(tip);
}
}
const efCjian = document.getElementById('entry-cjian-first');
if (efCjian) {
try { efCjian.checked = entryCjianFirstOn(); } catch (e) {}
efCjian.addEventListener('change', function () {
const on = efCjian.checked;
try { regStore().set('entry-cjian-first', on ? '1' : '0'); }
catch (e) { efCjian.checked = !on; toastEntry('设置没能保存，请重试'); return; }
toastEntry(on ? '打开时先进入此间 已开启：下次打开应用先进此间'
: '打开时先进入此间 已关闭：下次打开应用不再先进此间');
});
}
const efList = document.getElementById('entry-show-list');
if (efList) {
try { efList.checked = entryShowListOn(); } catch (e) {}
efList.addEventListener('change', function () {
const on = efList.checked;
try { regStore().set('entry-show-list', on ? '1' : '0'); }
catch (e) { efList.checked = !on; toastEntry('设置没能保存，请重试'); return; }
toastEntry(on ? '打开时显示联系人列表 已开启：下次打开应用先列出全部联系人'
: '打开时显示联系人列表 已关闭：下次打开应用不再列出联系人');
});
}
const efDefRow = document.getElementById('row-entry-default-contact');
function refreshEntryDefVal() {
const val = document.getElementById('entry-default-contact-val');
if (!val) return;
const id = entryDefaultCid();
const c = id ? getContacts().find(x => x.id === id) : null;
val.textContent = c ? (c.name || c.id) : '关闭';
}
if (efDefRow) {
refreshEntryDefVal();
efDefRow.addEventListener('click', function () {
openContactPicker({ mode: 'setDefault', onDone: function () { refreshEntryDefVal(); syncEntryModes(); } });
});
}
function toastEntry(msg) { try { if (typeof window.toast === 'function') window.toast(msg); } catch (e) {} }
function syncEntryToggles() {
const cbC = document.getElementById('entry-cjian-first');
if (cbC && !cbC.disabled) cbC.checked = entryCjianFirstOn();
const cbL = document.getElementById('entry-show-list');
if (cbL && !cbL.disabled) cbL.checked = entryShowListOn();
}
function syncEntryUI() {
try { syncEntryModes(); } catch (e) {}
try { syncEntryToggles(); } catch (e) {}
try { refreshEntryDefVal(); } catch (e) {}
}
document.addEventListener('mochi-restore-done', syncEntryUI);
syncEntryModes();
document.addEventListener('contact-switched', syncEntryUI);
const row = document.getElementById('row-contacts');
if (row) {
row.addEventListener('click', () => window.openContactManager());
function refreshContactsVal() {
const val = document.getElementById('contacts-val');
if (!val) return;
const c = getContacts().find(x => x.id === (window.__activeCid || 'default'));
val.textContent = c ? (c.name || c.id) : '';
}
refreshContactsVal();
document.addEventListener('contact-switched', refreshContactsVal);
}
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("contacts.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("contacts.js"); try { console.error("[JS] contacts.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[contacts.js] " + String(__e && __e.message || __e)); } })();
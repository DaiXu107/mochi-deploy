(function () { try {
(function () {
const uid = 'xy-home-v2';
const store = window.xyStore(uid);
(function feedRootRescue() {
const KEYS = ['feed-notices', 'feed-app-unread'];
const DESK_KEYS = ['feed-cover-bg', 'feed-ta-cover', 'feed-ta-name', 'feed-ta-avatar', 'feed-user-name', 'feed-user-avatar'];
function run() {
try {
const root = window.xyStore('xy-home-v2');
const def = window.xyStore('xy-home-v2:default');
KEYS.forEach(function (k) {
let rv = null;
try { rv = root.get(k); } catch (e) {}
if (rv !== null && rv !== undefined && rv !== '') { try { def.remove(k); } catch (e) {} return; }
let dv = null;
try { dv = def.get(k); } catch (e) {}
if (dv !== null && dv !== undefined && dv !== '') {
try { root.set(k, dv); } catch (e) {}
try { def.remove(k); } catch (e) {}
}
});
DESK_KEYS.forEach(function (k) {
let dv = null;
try { dv = def.get(k); } catch (e) {}
if (dv !== null && dv !== undefined && dv !== '') return; // per-cid 现行值：绝不动更不删（#232 根因）
let rv = null;
try { rv = root.get(k); } catch (e) {}
if (rv === null || rv === undefined || rv === '') return;
try {
window.idbHasKey('xy-home-v2:default:' + k).then(function (has) {
if (has === false) { try { def.set(k, rv); } catch (e) {} }
}).catch(function () {});
} catch (e) {}
});
(function deskSchedRescue() {
const today = feedToday();
['feed-last', 'feed-next', 'feed-day-count'].forEach(function (k) {
let rv = null, dv = null;
try { rv = root.get(k); } catch (e) {}
if (rv === null || rv === undefined || rv === '') return;
try { dv = def.get(k); } catch (e) {}
if (dv === null || dv === undefined || dv === '') {
try { def.set(k, rv); } catch (e) {}
} else if (k === 'feed-day-count') {
try {
const ro = JSON.parse(rv), dfo = JSON.parse(dv);
const rn = ro && ro.t === today ? (ro.n || 0) : -1;
const dn = dfo && dfo.t === today ? (dfo.n || 0) : -1;
if (rn > dn) def.set(k, rv);
} catch (e) {}
} else if (k === 'feed-last') {
try { if (parseFloat(rv) > parseFloat(dv)) def.set(k, rv); } catch (e) {}
}
try { root.remove(k); } catch (e) {}
});
})();
try { renderNoticeBadge(); } catch (e) {}
} catch (e) {}
}
if (window.__mochiDataReady) { run(); return; }
try {
document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
run();
});
} catch (e) {}
})();
const KEY = 'feed-posts';
const SNAP_KEY = 'feed-posts-snap';
const LS_BIG_LIMIT = 200 * 1024;
function maxPostTs(arr) { return (Array.isArray(arr) ? arr : []).reduce((m, p) => (p && p.ts > m ? p.ts : m), 0); }
function loadSnap() {
try {
const v = localStorage.getItem('xy-home-v2:default:' + SNAP_KEY);
if (v) { const a = JSON.parse(v); if (Array.isArray(a)) return a; }
} catch (e) {}
return [];
}
const SNAP_MEDIA_RE = /data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+/g;
function stripMediaBody(s) { return String(s == null ? '' : s).replace(SNAP_MEDIA_RE, '[图片]'); }
function isSnapPayload(u) { return typeof u === 'string' && u.indexOf('data:') === 0; }
function stripPostImg(p) {
if (!p || typeof p !== 'object') return p;
const c = Object.assign({}, p);
if (Array.isArray(c.imgs)) c.imgs = c.imgs.filter(u => !isSnapPayload(u));
if (Array.isArray(c.stickers)) {
c.stickers = c.stickers.reduce(function (acc, s) {
if (!s || typeof s !== 'object') { acc.push(s); return acc; }
if (!isSnapPayload(s.src)) { acc.push(s); return acc; }
const s2 = Object.assign({}, s);
s2.src = '';
if (s2.emoji) acc.push(s2);
return acc;
}, []);
}
c.authorAv = '';
c.taAv = '';
if (typeof c.content === 'string') {
c.content = stripMediaBody(c.content);
if (c.content.length > 8192) c.content = c.content.slice(0, 8192) + '…';
}
if (Array.isArray(c.comments)) {
c.comments = c.comments.map(co => {
if (!co || typeof co !== 'object') return co;
const cc = Object.assign({}, co);
if (typeof cc.content === 'string') {
cc.content = stripMediaBody(cc.content);
if (cc.content.length > 8192) cc.content = cc.content.slice(0, 8192) + '…';
}
if (Array.isArray(cc.replies)) {
cc.replies = cc.replies.map(r => {
if (!r || typeof r !== 'object') return r;
const rr = Object.assign({}, r);
if (typeof rr.content === 'string') {
rr.content = stripMediaBody(rr.content);
if (rr.content.length > 8192) rr.content = rr.content.slice(0, 8192) + '…';
}
return rr;
});
}
return cc;
});
}
return c;
}
function partnerName() { return window.activeStore().get('lbl-partner') || 'TA'; }
function partnerAv() { return window.activeStore().get('avatar-partner') || ''; }
function myName() { return window.activeStore().get('lbl-user') || '我'; }
function myAv() { return window.activeStore().get('avatar-user') || ''; }
function taAvFor(owner) {
try {
const o = owner || 'default';
const s = window.storeFor(o);
let v = s.get('feed-ta-avatar') || s.get('avatar-partner') || s.get('cs-avatar-partner') || '';
if (!v && o === 'default') v = store.get('feed-ta-avatar') || store.get('avatar-partner') || store.get('cs-avatar-partner') || '';
if (v && typeof v === 'string' && v.length > 500 * 1024) return '';
return v || '';
} catch (e) { return ''; }
}
function taFeedNameFor(owner) {
try {
const o = owner || 'default';
const s = window.storeFor(o);
let v = s.get('feed-ta-name') || s.get('lbl-partner') || '';
if (!v && o === 'default') v = store.get('feed-ta-name') || store.get('lbl-partner') || '';
if (v) return v;
if (window.getContacts) {
const c = window.getContacts().find(x => x.id === o);
if (c && c.name) return c.name;
}
return 'TA';
} catch (e) { return 'TA'; }
}
function activeMe() {
const s = window.activeStore();
return { role: 'me', owner: window.__activeCid || 'default', authorName: s.get('feed-user-name') || s.get('lbl-user') || '我', authorAv: s.get('feed-user-avatar') || s.get('avatar-user') || '' };
}
function taAuthorOf(p) {
return { role: 'ta', owner: p.owner || 'default', authorName: p.taName || taFeedNameFor(p.owner || 'default'), authorAv: p.taAv || taAvFor(p.owner || 'default') };
}
function taAuthorOfCid(cid) {
const o = cid || 'default';
return { role: 'ta', owner: o, authorName: taFeedNameFor(o), authorAv: taAvFor(o) };
}
function stampAuthor(obj, a) { obj.role = a.role; obj.owner = a.owner; obj.authorName = a.authorName; obj.authorAv = ''; return obj; }
function feedUserAvFor(owner) {
try {
const o = owner || 'default';
const st = window.storeFor(o);
let v = st.get('feed-user-avatar') || st.get('avatar-user') || '';
if (v && typeof v === 'string' && v.length > 500 * 1024) return '';
return v || '';
} catch (e) { return ''; }
}
function feedUserNameFor(owner) {
try {
const o = owner || 'default';
const st = window.storeFor(o);
return st.get('feed-user-name') || st.get('lbl-user') || '我';
} catch (e) { return '我'; }
}
function feedUserName() { return window.activeStore().get('feed-user-name') || store.get('feed-user-name') || myName(); }
function feedUserAv() {
const s = window.activeStore();
let v = s.get('feed-user-avatar') || store.get('feed-user-avatar') || myAv();
if (v && typeof v === 'string' && v.length > 500 * 1024) return '';
return v || '';
}
function sweepFeedNameSnapshots(role, cid, prevName, newName) {
try {
const list = load();
let dirty = false;
const mine = (x) => !!x && (x.role || x.by) === role
&& ((x.owner || 'default') === cid || (role === 'me' && x.owner === 'me'));
const fixTree = (arr) => {
(arr || []).forEach(x => {
if (!x) return;
if (mine(x) && x.authorName && x.authorName !== newName) { x.authorName = newName; dirty = true; }
if (Array.isArray(x.replies)) fixTree(x.replies);
});
};
list.forEach(p => {
if (!p) return;
if (role === 'ta' && (p.owner || 'default') === cid && p.taName === prevName && prevName !== newName) { p.taName = newName; dirty = true; }
fixTree(p.comments);
fixTree(p.stickers);
if (Array.isArray(p.likes) && prevName && prevName !== newName) {
for (let i = 0; i < p.likes.length; i++) {
if (p.likes[i] === prevName) { p.likes[i] = newName; dirty = true; }
}
}
if (mine(p) && p.authorName && p.authorName !== newName) { p.authorName = newName; dirty = true; }
});
if (dirty) save(list);
return dirty;
} catch (e) { return false; }
}
function rerenderFeedAfterRename() {
try { const fa = document.getElementById('page-feed-all'); if (fa && !fa.hidden) { renderFeedAll(); } else render(); } catch (e) {}
try { const ff = document.getElementById('page-feed-friends'); if (ff && !ff.hidden) renderFeedFriends(); } catch (e) {}
}
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
function normPost(p) {
if (p.by && !p.role) { p.role = p.by; if (!p.owner) p.owner = 'default'; }
const dedupArrBy = (arr, keyFn) => {
if (!Array.isArray(arr)) return arr;
const seen = {}, out = [];
for (let i = 0; i < arr.length; i++) {
const o = arr[i];
if (!o || typeof o !== 'object') { out.push(o); continue; }
const k = keyFn(o);
if (k != null && seen[k]) continue;
if (k != null) seen[k] = 1;
out.push(o);
}
return out;
};
if (Array.isArray(p.comments)) {
p.comments = dedupArrBy(p.comments, c => (c && c.ts ? c.ts : 0) + '|' + (c.role || c.by || '') + '|' + (c.authorName || '') + '|' + (c.content || ''));
for (let i = 0; i < p.comments.length; i++) {
const c = p.comments[i];
if (c && Array.isArray(c.replies)) {
c.replies = dedupArrBy(c.replies, r => (r && r.ts ? r.ts : 0) + '|' + (r.role || r.by || '') + '|' + (r.authorName || '') + '|' + (r.content || ''));
}
}
}
return p;
}
let feedDbReady = false;
let feedPending = null;
let feedMem = null;
let feedAuthSeen = false;
let feedAuthWritable = null;   // null=未探测；true=确认可写（权威键确实不存在）；false=权威仍在
let feedAuthRetried = 0;       // 守卫拒写后的权威重读次数上限 2（间隔 10s，防病理存储下无限循环）
let feedSyncCold = false;      // 本轮同步层交不出权威主键（见过权威之后读空＝内存副本被释放）
let feedColdAsking = false;    // 残缺期已发起的权威重读合流标记（同场只问一次）
function feedAskIdb() {
if (feedColdAsking || !window.idbGet) return;
feedColdAsking = true;
const settleCold = () => {
feedColdAsking = false;
if (!feedSyncCold || typeof window.idbHasKey !== 'function') return;
window.idbHasKey(uid + ':' + KEY).then(ok => { if (ok === false) feedSyncCold = false; }, () => {});
};
window.idbGet(uid + ':' + KEY).then(v => {
if (v && typeof v === 'string' && v.length > 2) feedSyncCold = false; // 库把整包交回来了
settleCold();
feedMergeFromIdb(v);   // 合并/重渲染/拒写重试一律走启动那条同款链，不另起第二套口径
try { render(); } catch (e) {}
}, () => { settleCold(); });
}
function feedGuardWrite(raw) {
if (feedSyncCold) {
try { feedPending = mergePosts(feedPending || [], feedMem || []); } catch (e) {}
feedAskIdb();
return Promise.resolve(false);
}
if (feedAuthSeen || store.get(KEY) !== null) {
try { store.set(KEY, raw); } catch (e) {}
return Promise.resolve(true);
}
if (!window.idbHasKey) { try { store.set(KEY, raw); } catch (e) {} return Promise.resolve(true); }
if (feedAuthWritable === null) feedAuthWritable = window.idbHasKey(uid + ':' + KEY).then(ok => ok === false);
return feedAuthWritable.then(writable => {
if (writable) { try { store.set(KEY, raw); } catch (e) {} }
return writable;
});
}
function itemKey(o) { return (o && o.ts ? o.ts : 0) + '|' + (o.role || o.by || '') + '|' + (o.authorName || ''); }
function hasMediaBody(s) {
const t = String(s == null ? '' : s);
return /data:image\//.test(t) || /@@m:[0-9a-f]{32}/.test(t);
}
function deeperList(a, b) {
const byKey = {};
const put = (o) => {
if (!o || typeof o !== 'object') return;
const k = itemKey(o);
const prev = byKey[k];
if (!prev) { byKey[k] = Object.assign({}, o); return; }
if (Array.isArray(o.replies) && o.replies.length) prev.replies = deeperList(prev.replies || [], o.replies);
else if (!Array.isArray(prev.replies) && Array.isArray(o.replies)) prev.replies = o.replies;
const prevImg = hasMediaBody(prev.content);
const oImg = hasMediaBody(o.content);
if (!prevImg && oImg) prev.content = o.content;
};
(a || []).forEach(put);
(b || []).forEach(put);
return Object.keys(byKey).map(k => byKey[k]).sort((x, y) => (x.ts || 0) - (y.ts || 0));
}
function unionStrArr(a, b) {
const out = [], seen = {};
(a || []).concat(b || []).forEach(s => { if (typeof s === 'string' && !seen[s]) { seen[s] = 1; out.push(s); } });
return out;
}
function stkKey(s) {
return (s.ts || 0) + '|' + (s.role || s.owner || '') + '|' + (s.x || 0) + '|' + (s.y || 0) + '|' + (s.emoji || '');
}
function unionStickers(a, b) {
if (!Array.isArray(a) && !Array.isArray(b)) return undefined;
const byKey = {};
const out = [];
[a, b].forEach(function (arr) {
(Array.isArray(arr) ? arr : []).forEach(function (s) {
if (!s || typeof s !== 'object') return;
const k = stkKey(s);
const prev = byKey[k];
if (!prev) { const o = Object.assign({}, s); byKey[k] = o; out.push(o); return; }
if (!prev.src && s.src) prev.src = s.src;   // 载荷择优：剥空的一侧不许盖掉带图的一侧
});
});
return out;
}
function deepMergePost(a, b) {
const newer = (b.ts || 0) >= (a.ts || 0) ? b : a;
const older = newer === a ? b : a;
const out = Object.assign({}, older, newer);
const oMedia = hasMediaBody(older.content), nMedia = hasMediaBody(newer.content);
if (oMedia !== nMedia ? oMedia : (older.content || '').length > (newer.content || '').length) out.content = older.content;
out.imgs = (newer.imgs && newer.imgs.length) ? newer.imgs : (older.imgs || []);
const stkUnion = unionStickers(older.stickers, newer.stickers);
if (stkUnion) out.stickers = stkUnion;
if (!out.authorAv && older.authorAv) out.authorAv = older.authorAv;
if (!out.taAv && older.taAv) out.taAv = older.taAv;
out.likes = unionStrArr(older.likes, newer.likes);
out.comments = deeperList(older.comments, newer.comments);
return out;
}
function mergePosts(a, b) {
const map = {};
const put = p => { if (p && p.id) map[p.id] = map[p.id] ? deepMergePost(map[p.id], p) : p; };
(a || []).forEach(put);
(b || []).forEach(put);
return Object.keys(map).map(k => map[k]).sort((x, y) => (y.ts || 0) - (x.ts || 0));
}
function load() {
let list = [];
if (feedMem) {
list = feedMem;
} else {
const raw = store.get(KEY);
if (raw !== null) {
feedSyncCold = false; // 这一轮同步层交出了权威副本（含清空后的 '[]'）
try {
const a = JSON.parse(raw);
if (Array.isArray(a)) list = a.map(normPost);
} catch (e) {}
} else if (feedAuthSeen || (store.awaitingBigKey && store.awaitingBigKey(KEY))) {
feedSyncCold = true;
feedAskIdb();
}
if (!list.length) {
try {
const v = loadSnap();
if (v.length) list = v.map(normPost);
} catch (e) {}
}
}
if (feedPending && feedPending.length) {
list = mergePosts(list, feedPending);
}
return list;
}
function persistSnap(arr) {
try {
const items = arr.map(stripPostImg);
let snap = JSON.stringify(items);
if (snap.length > LS_BIG_LIMIT) {
const sorted = items.slice().sort((x, y) => (y.ts || 0) - (x.ts || 0));
let budget = LS_BIG_LIMIT - 2;
const keep = [];
for (let i = 0; i < sorted.length; i++) {
const cost = JSON.stringify(sorted[i]).length + 1;
if (budget - cost < 0) break;
budget -= cost;
keep.push(sorted[i]);
}
snap = JSON.stringify(keep);
}
if (snap.length <= LS_BIG_LIMIT) localStorage.setItem('xy-home-v2:default:' + SNAP_KEY, snap);
} catch (e) {}
}
let snapTimer = null, snapPending = null;
function flushSnap() {
if (!snapTimer) return;
clearTimeout(snapTimer); snapTimer = null;
if (snapPending) { try { persistSnap(snapPending); } catch (e) {} snapPending = null; }
}
function scheduleSnap(arr) {
snapPending = arr;
if (snapTimer) return;
snapTimer = setTimeout(() => { flushSnap(); }, 800);
}
try {
window.addEventListener('pagehide', function () { flushFeedWrite(); flushSnap(); });
document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'hidden') {
flushFeedWrite(); flushSnap();
try { feedMem = null; if (window.idbMemoDrop) window.idbMemoDrop('feed-posts'); } catch (e) {}
}
});
} catch (e) {}
const FEED_WRITE_MIN_GAP = 2500;   // 两次实际落盘的最小间隔（ms）
let feedWriteTimer = null;         // 排队中标记（rIdle/timeout）
let feedWritePending = null;       // 待落盘的最新整包（尾随合并，只留最新）
let lastFeedWriteAt = 0;           // 上次实际落盘时间（performance.now()）
function runFeedWrite() {
feedWriteTimer = null;
const arr = feedWritePending;
if (!arr) return;
const wait = FEED_WRITE_MIN_GAP - (performance.now() - lastFeedWriteAt);
if (wait > 0) { feedWriteTimer = setTimeout(runFeedWrite, wait); return; }
feedWritePending = null;
try { feedGuardWrite(JSON.stringify(arr)); scheduleSnap(arr); lastFeedWriteAt = performance.now(); } catch (e) {}
}
function scheduleFeedWrite(arr) {
feedWritePending = arr;
if (feedWriteTimer) return;
if (window.requestIdleCallback) feedWriteTimer = window.requestIdleCallback(runFeedWrite, { timeout: 4000 });
else feedWriteTimer = setTimeout(runFeedWrite, 2500);
}
function flushFeedWrite() {
const arr = feedWritePending;
feedWritePending = null;
feedWriteTimer = null;
if (arr) { try { feedGuardWrite(JSON.stringify(arr)); scheduleSnap(arr); lastFeedWriteAt = performance.now(); } catch (e) {} }
}
const FEED_TOK_PAYLOAD_RE = /data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+/g;
let _feedTokT = null, _feedTokBusy = false, _feedTokInPass = false;
const _feedTokSig = new WeakMap();
function feedTokSig(p) {
const cms = Array.isArray(p.comments) ? p.comments : [];
const stk = Array.isArray(p.stickers) ? p.stickers : [];
const imgs = Array.isArray(p.imgs) ? p.imgs : [];
let repN = 0, repLen = 0, cmtLen = 0;
for (let i = 0; i < cms.length; i++) {
const c = cms[i] || {};
cmtLen += String(c.content || '').length;
const rp = Array.isArray(c.replies) ? c.replies : [];
repN += rp.length;
for (let j = 0; j < rp.length; j++) repLen += String((rp[j] || {}).content || '').length;
}
return imgs.length + '|' + stk.length + '|' + cms.length + '|' + repN + '|' + String(p.content || '').length + '|' + cmtLen + '|' + repLen;
}
const _feedTokMemo = new Map();      // 载荷串 → 令牌（同一份表情包被 20 条动态引用也只哈希一次）
function scheduleFeedTokPass(delay) {
if (!window.mochiMediaTokenize || !window.mochiMediaFlush) return;
clearTimeout(_feedTokT);
_feedTokT = setTimeout(feedNormalizeMediaPass, delay || 1500);
}
async function feedNormalizeMediaPass() {
if (_feedTokBusy) { scheduleFeedTokPass(4000); return; }
if (!feedDbReady) { scheduleFeedTokPass(6000); return; }  // 权威还没交出来＝不改写，等下一轮
if (!feedMem || feedMem.length === 0) { scheduleFeedTokPass(6000); return; }
const list = feedMem;
_feedTokBusy = true;
let changed = 0;
const rollback = [];               // [{o,p,v}]——写池失败时逐格退回原件
const touched = [];                // 本轮改过的动态，回滚时把形状签名抹掉好重试
let cur = null;
const mark = (p) => { if (p && cur !== p) { cur = p; touched.push(p); } };
async function tokSlot(holder, prop, p) {
if (!holder || typeof holder[prop] !== 'string' || holder[prop].length < 1024) return;
const raw = holder[prop];
if (raw.indexOf('data:') !== 0) return;
let t = _feedTokMemo.get(raw);
if (t === undefined) {
try { t = await window.mochiMediaTokenize(raw) || ''; } catch (e) { t = ''; }
if (_feedTokMemo.size > 600) _feedTokMemo.clear();
_feedTokMemo.set(raw, t);
}
if (!t || t === raw) return;
rollback.push({ o: holder, p: prop, v: raw });
holder[prop] = t; changed++; mark(p);
}
async function tokInStr(holder, prop, p) {
const s = holder && holder[prop];
if (typeof s !== 'string' || s.length < 1024 || s.indexOf('data:') < 0) return;
let out = s, n = 0;
const found = s.match(FEED_TOK_PAYLOAD_RE);
if (!found) return;
for (let i = 0; i < found.length; i++) {
const raw = found[i];
if (raw.length < 1024 || out.indexOf(raw) < 0) continue;
let t = _feedTokMemo.get(raw);
if (t === undefined) {
try { t = await window.mochiMediaTokenize(raw) || ''; } catch (e) { t = ''; }
if (_feedTokMemo.size > 600) _feedTokMemo.clear();
_feedTokMemo.set(raw, t);
}
if (!t) continue;
out = out.split(raw).join(t); n++;
}
if (!n || out === s) return;
rollback.push({ o: holder, p: prop, v: s });
holder[prop] = out; changed++; mark(p);
}
try {
for (let i = 0; i < list.length; i++) {
const p = list[i];
if (!p || typeof p !== 'object') continue;
const sg = feedTokSig(p);
if (_feedTokSig.get(p) === sg) continue;   // 这一格形状没变＝整场扫过，不重扫（大库长任务纪律）
_feedTokSig.set(p, sg);
const imgs = Array.isArray(p.imgs) ? p.imgs : [];
for (let j = 0; j < imgs.length; j++) await tokSlot(imgs, j, p);
await tokInStr(p, 'content', p);
const stks = Array.isArray(p.stickers) ? p.stickers : [];
for (let j = 0; j < stks.length; j++) await tokSlot(stks[j], 'src', p);
const cms = Array.isArray(p.comments) ? p.comments : [];
for (let j = 0; j < cms.length; j++) {
await tokInStr(cms[j], 'content', p);
const rp = (cms[j] && Array.isArray(cms[j].replies)) ? cms[j].replies : [];
for (let k = 0; k < rp.length; k++) await tokInStr(rp[k], 'content', p);
}
await new Promise(r => setTimeout(r, 0)); // 整包扫描让出主线程（#441 大库冻结同款纪律）
}
if (!changed) return;
const okPool = await window.mochiMediaFlush(); // 池先落盘，引用后落盘（顺序不可反，#186）
if (okPool === false) {
for (let r = 0; r < rollback.length; r++) { try { rollback[r].o[rollback[r].p] = rollback[r].v; } catch (e) {} }
for (let r = 0; r < touched.length; r++) { try { _feedTokSig.delete(touched[r]); } catch (e) {} }
scheduleFeedTokPass(8000);
return;
}
if (feedMem !== list) { scheduleFeedTokPass(1500); return; }
_feedTokInPass = true;
try { save(list); } finally { _feedTokInPass = false; }
} catch (e) {
for (let r = 0; r < rollback.length; r++) { try { rollback[r].o[rollback[r].p] = rollback[r].v; } catch (e2) {} }
} finally { _feedTokBusy = false; }
}
function save(list) {
const arr = list || [];
feedMem = arr;
if (!_feedTokInPass) scheduleFeedTokPass(); // #1363：任何一写入口带进来的巨型载荷，都在这一处闸换回引用
if (feedSyncCold) { try { feedPending = mergePosts(feedPending || [], arr); } catch (e) {} }
for (let i = 0; i < arr.length; i++) {
const p = arr[i];
if (!p || !Array.isArray(p.comments)) continue;
for (let j = 0; j < p.comments.length; j++) {
const c = p.comments[j];
if (c && c.authorAv) c.authorAv = '';
if (c && Array.isArray(c.replies)) for (let k = 0; k < c.replies.length; k++) { if (c.replies[k] && c.replies[k].authorAv) c.replies[k].authorAv = ''; }
}
}
if (!feedDbReady) {
try { feedPending = arr.slice(); } catch (e) {}
if (arr.length) {
feedGuardWrite(JSON.stringify(arr));
persistSnap(arr);
}
return;
}
if (!arr.length) {
feedWritePending = null;
feedGuardWrite('[]');
try { localStorage.removeItem('xy-home-v2:default:' + SNAP_KEY); } catch (e) {}
if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; snapPending = null; }
return;
}
scheduleFeedWrite(arr);
scheduleSnap(arr);
}
function avHtml(data, cls) {
const c = cls || 'feed-av';
return data
? '<div class="' + c + '"><img src="' + attrEsc(data) + '" alt=""></div>'
: '<div class="' + c + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg></div>';
}
const TA_COMMENT_POOL = ['收到啦~', '我看到了！', '这条动态好可爱', '记住啦', '我也是这么想的', '嗯嗯，说得对'];
function cardPool(cid) {
const cards = cid ? (window.getCustomCardsFor ? window.getCustomCardsFor(cid) : []) : ((window.getCustomCards && window.getCustomCards()) || []);
const pokeSet = (function () {
const pk = cid ? (window.getPokeCardsFor ? window.getPokeCardsFor(cid) : []) : ((window.getPokeCards && window.getPokeCards()) || []);
return pk.length ? new Set(pk) : null;
})();
const text = [], kaomoji = [], emoji = [];
const onlyData = (arr) => (arr || []).filter(s => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))));
const mediaSticker = onlyData(cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'sticker') : []) : ((window.getMediaCards && window.getMediaCards('sticker')) || []));
const mediaImage = onlyData(cid ? (window.getMediaCardsFor ? window.getMediaCardsFor(cid, 'image') : []) : ((window.getMediaCards && window.getMediaCards('image')) || []));
cards.forEach(c => {
if (pokeSet && pokeSet.has(c)) return;
if (typeof c === 'string' && c.indexOf('data:') === 0) return; // dataURL 已按媒体分类
if (typeof c === 'string' && c.indexOf('|||') >= 0) return;
if (c && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return;
if (/^https?:\/\//i.test(c)) return; // 图链卡不进朋友圈文字池
if (/[\uD800-\uDBFF]/.test(c) || /^[😀-🙏🌀-🫿]/u.test(c)) emoji.push(c);
else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) kaomoji.push(c);
else text.push(c);
});
try {
const st = (cid && window.storeFor) ? window.storeFor(cid) : null;
const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
const useFeed = a ? a.use('feed') : (window.defaultCardUse ? window.defaultCardUse('feed') : true);
const en = a ? a.enabled() : ((window.defaultCardCfg && window.defaultCardCfg().enabled) !== false);
let feedOverall = 100;
try { const fv = st ? st.get('dc-overall-feed') : null; if (fv !== null) feedOverall = Math.max(0, Math.min(100, Number(fv))); } catch (e) {}
if (en && useFeed && Math.random() * 100 < feedOverall && window.getDefaultCardGroups) {
const gd = window.getDefaultCardGroups;
const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
if (catOn('main')) (gd('main') || []).forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('main', c)) return; if (typeof c === 'string' && c) text.push(c); }));
if (catOn('kaomoji') && !kaomoji.length) (gd('kaomoji') || []).forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('kaomoji', c)) return; if (typeof c === 'string' && c) kaomoji.push(c); }));
if (catOn('emoji') && !emoji.length) (gd('emoji') || []).forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('emoji', c)) return; if (typeof c === 'string' && c) emoji.push(c); }));
}
} catch (e) {}
try {
if (window.dictUse && window.dictUse('feed') && window.dictQuoteOne
&& Math.random() * 100 < (window.dictOverall ? window.dictOverall('feed') : 30)) {
const dq = window.dictQuoteOne();
if (dq) text.push(dq);
}
} catch (eDictFeed) {}
if (!feedTypeOn(cid, 'kaomoji')) kaomoji.length = 0;
if (!feedTypeOn(cid, 'emoji')) emoji.length = 0;
if (!feedTypeOn(cid, 'sticker')) mediaSticker.length = 0;
if (!feedTypeOn(cid, 'image')) mediaImage.length = 0;
return { text: text, kaomoji: kaomoji, emoji: emoji, sticker: mediaSticker, image: mediaImage };
}
function feedTypeOn(cid, kind) {
try {
const s = window.storeFor ? window.storeFor(cid || 'default') : null;
if (!s) return true;
const v = s.get('reply-fd-' + kind + '-en');
return v === null || v === undefined || v === '' ? true : Number(v) !== 0;
} catch (e) { return true; }
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function attrEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function inlineBody(s, cid) {
const str = String(s || '');
const fitSeg = (seg) => {
seg = String(seg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
return (cid && window.taFit) ? window.taFit(seg, cid) : seg;
};
const RE = /((?:sticker|image):)?(https?:\/\/[^\s"'<>]+|@@m:[0-9a-f]{32}|data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+)/g;
return str.replace(RE, function (all, pre, src) {
if (src.indexOf('http') === 0 && pre !== 'sticker:' && pre !== 'image:') {
return fitSeg(all); // 普通网址（无附图前缀）按文本保留
}
return '<img class="feed-inline-img" src="' + attrEsc(src) + '" alt="表情">';
});
}
function makePicker(arr, noWrap) {
const a = arr.slice();
let i = a.length;
let dealt = false; // 首发的 i=a.length 只是「还没洗过牌」的起点，不算抽过一张（i 的初值即旧语义）
return function () {
if (i >= a.length) {
if (noWrap && dealt) return undefined;
for (let j = a.length - 1; j > 0; j--) {
const k = Math.floor(Math.random() * (j + 1));
const t = a[j]; a[j] = a[k]; a[k] = t;
}
i = 0;
dealt = true;
}
return a[i++];
};
}
function uniqArr(arr) {
const seen = new Set(); const out = [];
arr.forEach(x => { if (!seen.has(x)) { seen.add(x); out.push(x); } });
return out;
}
function feedPresetLines(group, fallback) {
try { if (typeof window.getPresetGroupLines === 'function') return window.getPresetGroupLines(group, fallback); } catch (e) {}
return fallback.slice();
}
function feedFallbackPool() {
return uniqArr(feedPresetLines('朋友圈·TA的点评', TA_COMMENT_POOL).concat(feedPresetLines('朋友圈·TA的回复', TA_REPLY_POOL)));
}
function genMixedCards(cfg, minN, maxN, opts, cid) {
const o = opts || {};
const pool = cardPool(cid);
const fb = feedFallbackPool();
const pick = {
image: makePicker(uniqArr(pool.image), true),
sticker: makePicker(uniqArr(pool.sticker), true),
si: makePicker(uniqArr(pool.sticker.concat(pool.image)), true),
emoji: makePicker(uniqArr(pool.emoji), true),
kaomoji: makePicker(uniqArr(pool.kaomoji), true),
text: makePicker(uniqArr(pool.text), true),
fb: makePicker(fb, true)
};
const want = minN + Math.floor(Math.random() * Math.max(1, maxN - minN + 1));
const room = uniqArr(pool.image.concat(pool.sticker, pool.emoji, pool.kaomoji, pool.text, fb)).length;
const n = Math.max(1, Math.min(want, room));
const parts = [];
for (let i = 0; i < n; i++) {
const r = Math.random() * 100;
let pushed = false;
const take = (f) => { const v = f(); if (v === undefined) return false; parts.push(v); return true; };
if (o.imP > 0 && pool.image.length && r < o.imP && take(pick.image)) pushed = true;
if (!pushed && o.stP > 0 && pool.sticker.length && r < o.stP && take(pick.sticker)) pushed = true;
if (!pushed && o.imgP > 0 && (pool.sticker.length || pool.image.length) && r < o.imgP && take(pick.si)) pushed = true;
if (!pushed && o.emoP > 0 && pool.emoji.length && r < o.emoP && take(pick.emoji)) pushed = true;
if (!pushed && o.kaoP > 0 && pool.kaomoji.length && r < o.kaoP && take(pick.kaomoji)) pushed = true;
if (!pushed && !(take(pick.text) || take(pick.fb))) break;
}
const rcf = window.replyCfgFor ? window.replyCfgFor(cid) : null;
return (window.pyJoinCards && rcf) ? window.pyJoinCards(parts, rcf, rcf['fd-punct-en'] === 1) : parts.join(' ');
}
function genPostContent(cfg, cid) {
const pool = cardPool(cid);
const fb = feedFallbackPool();
const pick = {
image: makePicker(uniqArr(pool.image), true),
sticker: makePicker(uniqArr(pool.sticker), true),
emoji: makePicker(uniqArr(pool.emoji), true),
kaomoji: makePicker(uniqArr(pool.kaomoji), true),
text: makePicker(uniqArr(pool.text), true),
fb: makePicker(fb, true)
};
const want = cfg.minCardsPost + Math.floor(Math.random() * Math.max(1, cfg.maxCardsPost - cfg.minCardsPost + 1));
const room = uniqArr(pool.image.concat(pool.sticker, pool.emoji, pool.kaomoji, pool.text, fb)).length;
const n = Math.max(1, Math.min(want, room));
const textParts = [];
const imgs = [];
for (let i = 0; i < n; i++) {
let pushed = false;
const take = (f, to) => { const v = f(); if (v === undefined) return false; to.push(v); return true; };
if (cfg.postImage > 0 && pool.image.length && Math.random() * 100 < cfg.postImage && take(pick.image, imgs)) pushed = true;
if (!pushed && cfg.postSticker > 0 && pool.sticker.length && Math.random() * 100 < cfg.postSticker && take(pick.sticker, imgs)) pushed = true;
if (!pushed && cfg.postEmoji > 0 && pool.emoji.length && Math.random() * 100 < cfg.postEmoji && take(pick.emoji, textParts)) pushed = true;
if (!pushed && cfg.postKaomoji > 0 && pool.kaomoji.length && Math.random() * 100 < cfg.postKaomoji && take(pick.kaomoji, textParts)) pushed = true;
if (!pushed && !(take(pick.text, textParts) || take(pick.fb, textParts))) break;
}
const rcf = window.replyCfgFor ? window.replyCfgFor(cid) : null;
const body = (window.pyJoinCards && rcf) ? window.pyJoinCards(textParts, rcf, rcf['fd-punct-en'] === 1) : textParts.join(' ');
return { content: body, imgs: imgs };
}
function contentHtmlFor(p) {
let content = String(p.content || '');
const imgs = (p.imgs && p.imgs.length) ? p.imgs.slice() : (p.img ? [p.img] : []);
content = content.replace(/((?:sticker|image):)?(https?:\/\/[^\s"'<>]+|@@m:[0-9a-f]{32}|data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*(?:=[^;,]*)?)*,[^\s"'<>]+)/g, (m, pre, u) => { if (u.indexOf('http') === 0 && pre !== 'sticker:' && pre !== 'image:') return m; imgs.push(u); return ' '; });
const clamp = feedLongBody(content);
let html = '<div class="feed-body' + (clamp ? ' feed-clamp' : '') + '">' + inlineBody(content, (p.role || p.by) === 'me' ? '' : p.owner) + '</div>';
const hasStickers = Array.isArray(p.stickers) && p.stickers.length > 0;
if (imgs.length || hasStickers) {
html += '<div class="feed-imgs' + (imgs.length ? '' : ' feed-imgs-blank') + '">' + imgs.map(u => '<img src="' + attrEsc(u) + '" alt="图片" loading="lazy">').join('') + feedStickersHtml(p) + '</div>';
}
if (clamp) html += '<button class="feed-expand" type="button" data-expand="' + esc(p.id) + '">展开全文</button>';
return html;
}
function feedStickersHtml(p) {
const list = Array.isArray(p.stickers) ? p.stickers : [];
if (!list.length) return '';
return list.map((s, i) => {
const who = s.authorName || ((s.role || s.owner) === 'me' ? feedUserName() : 'TA');
const inner = s.src
? '<img src="' + attrEsc(s.src) + '" alt="贴纸">'
: '<span class="feed-sticker-emoji">' + esc(s.emoji || '❤️') + '</span>';
const del = (s.role || s.owner) === 'me' ? ' data-sticker-del="' + esc(p.id) + '|' + i + '"' : '';
return '<span class="feed-sticker"' + del + ' style="left:' + Number(s.x || 0) + '%;top:' + Number(s.y || 0) + '%" title="' + esc(who) + ' 贴的贴纸">' + inner + '</span>';
}).join('');
}
function commentsHtmlFor(p, name) {
if (!p.comments || !p.comments.length) return '';
return '<div class="feed-comments">' + p.comments.map((c, ci) => {
const cNameRaw = c.authorName || ((c.role || c.by) === 'me' ? feedUserName() : (name || taFeedName()));
const cName = esc(cNameRaw);
const cBody = inlineBody(c.content, (c.role || c.by) === 'me' ? '' : p.owner);
let repliesHtml = '';
if (c.replies && c.replies.length) {
const speakers = [cNameRaw];
repliesHtml = '<div class="feed-replies">' + c.replies.map((r, ri) => {
const rNameRaw = r.authorName || ((r.role || r.by) === 'me' ? feedUserName() : (name || taFeedName()));
let toRaw = (typeof r.to === 'string' && r.to) ? r.to : '';
if (!toRaw) {
for (let i = speakers.length - 1; i >= 0; i--) { if (speakers[i] !== rNameRaw) { toRaw = speakers[i]; break; } }
if (!toRaw) toRaw = cNameRaw !== rNameRaw ? cNameRaw : feedUserName();
}
speakers.push(rNameRaw);
const rBody = inlineBody(r.content, (r.role || r.by) === 'me' ? '' : p.owner);
return '<div class="feed-reply" data-ci="' + ci + '" data-ri="' + ri + '"><b>' + esc(rNameRaw) + '</b><span class="fd-r-sep">回复</span><b>' + esc(toRaw) + '</b>：' + rBody + '</div>';
}).join('') + '</div>';
}
return '<div class="feed-comment" data-c="' + p.id + '" data-ci="' + ci + '">' +
'<div class="feed-c-line"><b>' + cName + '</b>：' + cBody + '</div>' +
repliesHtml + '</div>';
}).join('') + '</div>';
}
function pickReplyContent(cfg, cid) {
const c = cfg || feedCfg();
const maxN = Math.random() * 100 < c.cardProb ? Math.max(1, c.maxCards) : 1;
return genMixedCards(c, 1, maxN, { imgP: c.imageProb, kaoP: 15, emoP: 15 }, cid);
}
function poolReadyFor(cid, cb) {
const cur = window.__activeCid || 'default';
if (cid === cur || !window.hydrateLibForCid) { cb(); return; }
try {
window.hydrateLibForCid(cid).then(function () { cb(); }, function () { cb(); });
} catch (e) { cb(); }
}
const TA_REPLY_POOL = ['哈哈，好呀', '那你呢？', '嗯嗯，说得对', '我记住啦', '跟你分享过的', '被你发现了', '那很好呀', '我也这么觉得'];
function safeBg(v, key, s) {
if (v && typeof v === 'string' && v.length > 500 * 1024) {
try { s.remove(key); } catch (e) {}
return '';
}
return v || '';
}
function coverBg() {
const s = window.activeStore();
const v = s.get('feed-cover-bg');
if (v) return safeBg(v, 'feed-cover-bg', s);
return safeBg(store.get('feed-cover-bg'), 'feed-cover-bg', store);
}
function renderCover() {
const myAvEl = document.getElementById('feed-my-av');
const myNameEl = document.getElementById('feed-my-name');
const myAvStr = feedUserAv();
const myNameStr = feedUserName();
if (myAvEl) {
myAvEl.innerHTML = myAvStr ? '<img src="' + attrEsc(myAvStr) + '" alt="">' : '';
try { if (window.mochiFilePickLabel) window.mochiFilePickLabel(myAvEl, feedAvPickInput); } catch (e) {}
try { if (window.mochiFilePickSurface) window.mochiFilePickSurface(myAvEl, { id: 'feed-myav-tap', accept: 'image/*', owner: feedAvPickInput }); } catch (e) {}
}
if (myNameEl) myNameEl.textContent = myNameStr;
const cover = document.getElementById('feed-cover');
if (cover) {
const bg = coverBg();
if (bg) {
cover.style.backgroundImage = 'url("' + bg + '")';
cover.classList.add('has-bg');
} else {
cover.style.backgroundImage = '';
cover.classList.remove('has-bg');
}
armCoverLayer(cover, 'dev-feed-cover-tap', 'dev-feed-cover-bg', !!bg);
}
}
function compressImage(file, cb) {
if (!window.mochiImgIngest) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); cb(null); return; }
window.mochiImgIngest(file, { maxSide: 800, quality: 0.82, tag: 'feed-800' }).then((r) => {
if (!r || r.st !== 'ok') { toast(window.mochiImgIngestMiss(r, '图片')); cb(null); return; }
cb(r.data);
});
}
function taFeedName() { return window.activeStore().get('feed-ta-name') || store.get('feed-ta-name') || partnerName(); }
function taFeedAv() { return window.activeStore().get('feed-ta-avatar') || store.get('feed-ta-avatar') || partnerAv(); }
function taFeedCover() {
const s = window.activeStore();
const v = s.get('feed-ta-cover');
if (v) return safeBg(v, 'feed-ta-cover', s);
return safeBg(store.get('feed-ta-cover'), 'feed-ta-cover', store);
}
function favFeedHas(p) {
try {
const fav = JSON.parse(window.activeStore().get('fav-msgs') || '[]');
return Array.isArray(fav) && fav.some(f => (f.kind || '') === 'feed' && f.by !== 'ta' && f.ts === (p.ts || 0));
} catch (e) { return false; }
}
function postCardHtml(p, name) {
const isMine = (p.role || p.by) === 'me';
const author = p.authorName || (isMine ? feedUserNameFor(p.owner || 'default') : taFeedNameFor(p.owner || 'default'));
const av = p.authorAv || (isMine ? feedUserAvFor(p.owner || 'default') : taAvFor(p.owner || 'default'));
const avWrap = '<div class="feed-head-av" data-owner="' + esc(p.owner || '') + '" data-role="' + (isMine ? 'me' : 'ta') + '" title="查看' + esc(author) + '的全部朋友圈">' + avHtml(av) + '</div>';
const likes = p.likes && p.likes.length
? '<div class="feed-likes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:-2px;margin-right:5px"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>' + esc(p.likes.join('、')) + ' 觉得很赞</div>'
: '';
const liked = p.likes && p.likes.some(l => l === feedUserName());
const faved = favFeedHas(p);
return '<div class="feed-post" id="feed-post-' + p.id + '"><div class="feed-head">' + avWrap +
'<div class="feed-who"><div class="feed-name">' + esc(author) + '</div><div class="feed-time">' + fmtDT(p.ts) + '</div></div>' +
'<button class="feed-del" data-id="' + p.id + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/></svg></button>' + '</div>' +
'<div class="feed-content">' + contentHtmlFor(p) + '</div>' +
'<div class="feed-actions">' +
'<button class="feed-act' + (liked ? ' liked' : '') + '" data-like="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>赞</button>' +
'<button class="feed-act" data-comment="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8z"/><circle cx="8.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/></svg>评论</button>' +
'<button class="feed-act" data-sticker="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 007 0"/><circle cx="9" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1" fill="currentColor" stroke="none"/></svg>贴纸</button>' +
'<button class="feed-act feed-fav' + (faved ? ' faved' : '') + '" data-fav="' + p.id + '"><svg viewBox="0 0 24 24" fill="' + (faved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/></svg>收藏</button>' +
'</div>' + likes + commentsHtmlFor(p, name) + '</div>';
}
const FEED_WEEK_LABEL = '本周';
const FEED_CLAMP_LINES = 6, FEED_CLAMP_CHARS = 120;
let feedRangeKey = 'week';
let feedRangeBuckets = [];
let feedMainPosts = [];
function feedMainPostEl(pid) {
const l = document.getElementById('feed-list');
return l ? l.querySelector('[id="feed-post-' + pid + '"]') : null;
}
function feedWeekStart(now) {
const d = new Date(now);
d.setHours(0, 0, 0, 0);
d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // getDay() 0＝周日，把周一当一周的第一天
return d.getTime();
}
function feedMonthKeyOf(ts) {
const d = new Date(ts);
return d.getFullYear() + '-' + (d.getMonth() + 1);
}
function feedBucketKeyFor(ts) {
const t = Number(ts) || 0;
if (!t) return 'none'; // #1416：没有 ts 的老动态不猜日期（下面分桶同口径，归「更早」）
return t >= feedWeekStart(Date.now()) ? 'week' : feedMonthKeyOf(t);
}
function feedBuckets(posts) {
const ws = feedWeekStart(Date.now());
const nowY = new Date().getFullYear();
const week = [];
const months = {};
for (let i = 0; i < posts.length; i++) {
const p = posts[i];
const ts = Number(p && p.ts) || 0;
if (ts && ts >= ws) { week.push(p); continue; }
const k = ts ? feedMonthKeyOf(ts) : 'none';
if (!months[k]) {
const d = ts ? new Date(ts) : null;
months[k] = { key: k, y: d ? d.getFullYear() : 0, m: d ? d.getMonth() + 1 : 0, unknown: !d, items: [] };
}
months[k].items.push(p);
}
const out = [{ key: 'week', label: FEED_WEEK_LABEL, items: week }];
const keys = Object.keys(months);
keys.sort((a, b) => (months[b].y - months[a].y) || (months[b].m - months[a].m));
for (let i = 0; i < keys.length; i++) {
const b = months[keys[i]];
out.push({ key: b.key, items: b.items, label: b.unknown ? '更早' : (b.y === nowY ? '' : b.y + '年') + b.m + '月' });
}
return out;
}
function feedLongBody(s) {
const str = String(s || '');
if (str.length > FEED_CLAMP_CHARS) return true;
let lines = 1;
for (let i = 0; i < str.length; i++) {
if (str.charCodeAt(i) !== 10) continue;
lines++;
if (lines > FEED_CLAMP_LINES) return true;
}
return false;
}
function feedSetRange(key) {
if (!key || key === feedRangeKey) return;
feedRangeKey = key;
render();
const sc = document.querySelector('#page-feed .cal-scroll');
if (sc) sc.scrollTop = 0; // 换页从本页第一行看起，别留着上一页的滚动深度
}
function feedRangeBar() {
const listEl = document.getElementById('feed-list');
if (!listEl || !listEl.parentNode) return null;
let bar = document.getElementById('feed-range-bar');
if (!bar) {
bar = document.createElement('div');
bar.id = 'feed-range-bar';
bar.className = 'feed-range-bar glass';
listEl.parentNode.insertBefore(bar, listEl);
bar.addEventListener('click', (e) => {
if (!e.target || !e.target.closest) return;
const pill = e.target.closest('[data-range]');
if (pill) { feedSetRange(pill.getAttribute('data-range')); return; }
const nav = e.target.closest('[data-range-nav]');
if (!nav || nav.disabled) return;
const step = nav.getAttribute('data-range-nav') === 'older' ? 1 : -1;
let idx = -1;
for (let i = 0; i < feedRangeBuckets.length; i++) { if (feedRangeBuckets[i].key === feedRangeKey) { idx = i; break; } }
if (idx < 0) return;
const next = Math.min(feedRangeBuckets.length - 1, Math.max(0, idx + step));
if (next !== idx) feedSetRange(feedRangeBuckets[next].key);
});
}
return bar;
}
function feedRenderRangeBar(buckets) {
feedRangeBuckets = buckets;
const bar = feedRangeBar();
if (!bar) return;
if (buckets.length <= 1) { bar.hidden = true; bar.innerHTML = ''; return; }
let active = 0;
for (let i = 0; i < buckets.length; i++) { if (buckets[i].key === feedRangeKey) { active = i; break; } }
const nav = (dir) => '<button class="feed-range-nav" type="button" data-range-nav="' + (dir < 0 ? 'newer' : 'older') + '"' +
(dir < 0 ? (active <= 0 ? ' disabled' : '') : (active >= buckets.length - 1 ? ' disabled' : '')) +
' title="' + (dir < 0 ? '更新' : '更早') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="' + (dir < 0 ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6') + '"/></svg></button>';
bar.innerHTML = nav(-1) + '<div class="feed-range-pills">' + buckets.map((b, i) =>
'<button class="feed-range-pill' + (i === active ? ' on' : '') + '" type="button" data-range="' + esc(b.key) + '">' +
esc(b.label) + '<span class="feed-range-n">' + b.items.length + '</span></button>'
).join('') + '</div>' + nav(1);
const wrap = bar.querySelector('.feed-range-pills');
const on = bar.querySelector('.feed-range-pill.on');
if (wrap && on) { try { wrap.scrollLeft = on.offsetLeft - (wrap.clientWidth - on.clientWidth) / 2; } catch (e) {} }
}
const FEED_RENDER_MAX = 200, FEED_LOAD_STEP = 100;
let feedShownMain = 0, feedShownAll = 0;
let feedRenderSig = '';
function feedRenderSignature(posts, shown, name, memId, rangeKey) {
const parts = [window.activePrefix(), window.mochiDataPending ? (window.mochiDataPending() ? 'L' : 'F') : 'F', shown, name, memId, rangeKey, posts.length];
for (let i = 0; i < shown; i++) {
const p = posts[i];
if (!p) { parts.push('-'); continue; }
parts.push(p.id, p.ts, (p.content || '').length, (p.likes || []).join('/'),
(p.comments || []).length, (p.stickers || []).length,
((p.imgs && p.imgs.length) || (p.img ? 1 : 0)));
}
return parts.join('|');
}
function feedMoreBtnHtml(remaining) {
return '<button class="feed-more-btn" type="button">查看更早的动态（还有 ' + remaining + ' 条）</button>';
}
function feedBindMoreBtn(listEl) {
const moreBtn = listEl.querySelector('.feed-more-btn');
if (!moreBtn) return;
moreBtn.addEventListener('click', () => {
const isAll = listEl.id === 'feed-all-list';
let posts = isAll ? feedSortedAll() : feedMainPosts;
if (isAll) posts = posts.filter(p => (p.owner || 'default') === feedAllCid);
const shown = isAll ? feedShownAll : feedShownMain;
const end = Math.min(posts.length, shown + FEED_LOAD_STEP);
if (end <= shown) { moreBtn.remove(); return; }
const htmlFn = isAll ? postCardHtmlAll : (p => postCardHtml(p, partnerName()));
moreBtn.remove();
const tmp = document.createElement('div');
tmp.innerHTML = posts.slice(shown, end).map(htmlFn).join('');
const cards = Array.prototype.slice.call(tmp.children);
cards.forEach(function (card) {
listEl.appendChild(card);
try { bindEvents(card); } catch (e) {}
});
const left = posts.length - end;
if (left > 0) {
listEl.insertAdjacentHTML('beforeend', feedMoreBtnHtml(left));
feedBindMoreBtn(listEl); // 新按钮重新挂监听
}
if (isAll) feedShownAll = end; else feedShownMain = end;
});
}
function feedSortedAll() { return load().slice().sort((a, b) => b.ts - a.ts); }
function render(keepShown) {
renderCover();
const listEl = document.getElementById('feed-list');
if (!listEl) return;
const posts = feedSortedAll();
const buckets = feedBuckets(posts);
let bucket = buckets[0];
for (let i = 0; i < buckets.length; i++) { if (buckets[i].key === feedRangeKey) { bucket = buckets[i]; break; } }
feedRangeKey = bucket.key; // 翻到的那个月被删空了就回第一页（本周），不留悬空选择
feedMainPosts = bucket.items;
const wantShown = Math.max(FEED_RENDER_MAX, parseInt(keepShown, 10) || 0);
feedShownMain = Math.min(feedMainPosts.length, wantShown);
const name = partnerName();
const memPost = feedMemoryPost();
const memShown = !!(memPost && !feedMemDismissed()) && bucket.key === 'week';
const memHtml = memShown ? feedMemBannerHtml(memPost) : '';
const sig = feedRenderSignature(feedMainPosts, feedShownMain, name, memShown ? memPost.id : '', bucket.label);
if (sig === feedRenderSig && listEl.firstChild) return;
listEl.innerHTML = memHtml + (feedMainPosts.length
? feedMainPosts.slice(0, feedShownMain).map(p => postCardHtml(p, name)).join('') +
(feedMainPosts.length > feedShownMain ? feedMoreBtnHtml(feedMainPosts.length - feedShownMain) : '')
: (posts.length
? '<div class="ta-empty">' + esc(bucket.label) + '还没有动态<br><span style="font-size:12px">点上面那条胶囊翻更早的月份</span></div>'
: ((feedSyncCold || (window.mochiDataPending && window.mochiDataPending()))
? window.mochiLoadingHtml('朋友圈内容')
: '<div class="ta-empty">还没有动态，TA 会不定期分享生活<br><button class="memo-send-btn" id="feed-empty-pub" style="margin-top:8px">我来发第一条</button></div>')));
feedRenderRangeBar(buckets);
feedRenderSig = sig;
const clearBtn = document.getElementById('feed-head-clear');
if (clearBtn) clearBtn.hidden = !posts.length;
bindEvents(listEl);
}
if (window.mochiOnDataReady) window.mochiOnDataReady(function () {
try { render(); } catch (e) {}
if (feedAllCid) { try { renderFeedAll(); } catch (e) {} }
});
function bindFeedImageClicks(listEl) {
listEl.querySelectorAll('.feed-imgs img, .feed-inline-img').forEach(img => img.addEventListener('click', (e) => {
e.stopPropagation();
if (window.viewChatImage) window.viewChatImage(img.src);
}));
}
function deletePostConfirm(pid) {
if (!window.openModal) return;
window.openModal('删除这条动态？', '', () => {
save(load().filter(x => x.id !== pid));
if (comPid === pid) hideCommentBar();
const fa = document.getElementById('page-feed-all');
if (fa && !fa.hidden) openFeedAll(feedAllCid, feedAllWho); else render();
}, { noInput: true });
}
function renderVisible() {
const fa = document.getElementById('page-feed-all');
if (fa && !fa.hidden) { try { renderFeedAll(); } catch (e) {} } else { render(); }
}
const FEED_STICKER_EMOJI = ['\u2764\ufe0f', '\ud83d\ude18', '\ud83e\udd70', '\ud83d\udc4d', '\ud83d\ude02', '\ud83c\udf08', '\u2728', '\ud83c\udf80', '\ud83d\ude3b', '\ud83e\udd17'];
const stkPoolCache = new Map();
function cachedStkPool(key, compute) {
const rev = feedStickerLibRev();
let cid = 'x';
try { cid = (window.__activeCid || 'default') + ''; } catch (e) {}
const k = key + '@' + cid + '@' + rev;
if (stkPoolCache.has(k)) return stkPoolCache.get(k);
const v = compute();
if (!stkPoolCache.size) {
Promise.resolve().then(function () { stkPoolCache.clear(); stkItemsCache.clear(); });
}
stkPoolCache.set(k, v);
return v;
}
const stkItemsCache = new Map();
function feedStickerLibRev() {
try { if (window.feedStickerLibRev) return window.feedStickerLibRev(); } catch (e) {}
return 0;
}
function feedStickerEmojiPoolBuild() {
const out = [], seen = new Set();
const add = (v) => { if (typeof v === 'string' && v && !seen.has(v)) { seen.add(v); out.push(v); } };
try {
['public', 'own'].forEach(sc => {
((window.getScopedGroups && window.getScopedGroups('emoji', sc)) || []).forEach(g => (g[1] || []).forEach(add));
});
} catch (e) {}
if (!out.length) {
try {
const st = window.storeFor ? window.storeFor(window.__activeCid || 'default') : null;
const a = (window.defaultCardApiFor && st) ? window.defaultCardApiFor(st) : null;
const useFeed = a ? a.use('feed') : (window.defaultCardUse ? window.defaultCardUse('feed') : true);
const en = a ? a.enabled() : ((window.defaultCardCfg && window.defaultCardCfg().enabled) !== false);
if (en && useFeed && window.getDefaultCardGroups) {
const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
if (catOn('emoji')) (window.getDefaultCardGroups('emoji') || []).forEach(g => (g[1] || []).forEach(c => { if (isOff && isOff('emoji', c)) return; add(c); }));
}
} catch (e) {}
}
if (!out.length) FEED_STICKER_EMOJI.forEach(add);
return out;
}
function feedStickerEmojiPool() {
return cachedStkPool('emojiPool', feedStickerEmojiPoolBuild);
}
function feedStickerGroups() {
return cachedStkPool('groups', feedStickerGroupsBuild);
}
function feedStickerGroupsBuild() {
const savedTab = comStickerTab;
let ta = [], mine = [];
try { comStickerTab = 'ta'; ta = comStickerGroups(); } catch (e) { ta = []; }
try { comStickerTab = 'mine'; mine = comStickerGroups(); } catch (e) { mine = []; }
comStickerTab = savedTab;
const out = [];
(ta || []).forEach((g, i) => { if (g && g[1] && g[1].length) out.push({ key: 'ta' + i, label: String(g[0]), kind: 'img', items: g[1] }); });
(mine || []).forEach((g, i) => { if (g && g[1] && g[1].length) out.push({ key: 'mn' + i, label: '\u6211\u7684\u00b7' + String(g[0]), kind: 'img', items: g[1] }); });
out.push({ key: 'em', label: 'emoji \u8d34\u7eb8', kind: 'emoji', items: feedStickerEmojiPool() });
return out;
}
let feedStickerCard = null;
let feedStickerCur = '';
function feedStickerItems() {
let cid = 'x';
try { cid = (window.__activeCid || 'default') + ''; } catch (e) {}
const ck = (feedStickerCur || '') + '@' + cid + '@' + feedStickerLibRev();
if (stkItemsCache.has(ck)) return stkItemsCache.get(ck);
const groups = feedStickerGroups();
let out;
if (!feedStickerCur) {
out = [];
groups.forEach(g => g.items.forEach(v => out.push({ kind: g.kind, v: v })));
} else {
const g = groups.find(x => x.key === feedStickerCur);
out = g ? g.items.map(v => ({ kind: g.kind, v: v })) : [];
}
stkItemsCache.set(ck, out);
return out;
}
function feedRenderStickerBar() {
const bar = document.getElementById('feed-sticker-groups');
if (!bar) return;
bar.innerHTML = '';
const groups = feedStickerGroups();
const total = groups.reduce((n, g) => n + g.items.length, 0);
const chips = [['', '\u5168\u90e8' + total]].concat(groups.map(g => [g.key, g.label + g.items.length]));
chips.forEach(pair => {
const key = pair[0], label = pair[1];
const c = document.createElement('span');
c.className = 'emoji-g-chip' + ((feedStickerCur || '') === key ? ' sel' : '');
c.textContent = label;
c.addEventListener('click', (e) => {
e.stopPropagation();
feedStickerCur = (feedStickerCur === key ? '' : key);
feedRenderStickerBar();
feedRenderStickerList();
});
bar.appendChild(c);
});
bar.hidden = groups.length <= 1;   // 只有 emoji 一组时不显示胶囊栏
}
const feedStickerImgPool = new Map();   // 稳定身份 -> [img 节点]（重写前收、重建时取，跨渲染存活）
const FS_IMG_POOL_MAX = 160, FS_IMG_POOL_PER_KEY = 8;
function feedStickerPoolKey(src) {
try { if (window.ccMediaCardIdent) return window.ccMediaCardIdent(src); } catch (e) {}
return typeof src === 'string' ? src : String(src);
}
function feedStickerTrim() {
let total = 0;
feedStickerImgPool.forEach(list => { total += list.length; });
if (total <= FS_IMG_POOL_MAX) return;
feedStickerImgPool.forEach((list, k) => { if (total > FS_IMG_POOL_MAX) { total -= list.length; feedStickerImgPool.delete(k); } });
}
function feedStickerHarvest(list) {
if (!list) return;
try {
const imgs = list.querySelectorAll('img');
for (let i = 0; i < imgs.length; i++) {
const im = imgs[i];
const k = (im.dataset && im.dataset.emojiKey) || '';
if (!k || im.__pooled) continue;
im.__pooled = true;
let arr = feedStickerImgPool.get(k);
if (!arr) { arr = []; feedStickerImgPool.set(k, arr); }
if (arr.length < FS_IMG_POOL_PER_KEY) arr.push(im);
}
feedStickerTrim();
} catch (e) {}
}
function feedStickerNewImg() {
const img = document.createElement('img');
img.alt = '\u8d34\u7eb8';
img.decoding = 'async';   // #435 口径：大 dataURL 解码不占主线程渲染帧
return img;
}
function feedStickerImg(src) {
const k = feedStickerPoolKey(src);
let img = null;
const arr = feedStickerImgPool.get(k);
if (arr && arr.length) {
img = arr.pop();
if (!arr.length) feedStickerImgPool.delete(k);
img.__pooled = false;
}
if (!img && window.mochiEmojiLazyAdopt) {
try {
const got = window.mochiEmojiLazyAdopt(src);
if (got && got.dataset && got.dataset.emojiKey === k) img = got; // 身份不符＝聊天侧新建的，不要
} catch (e) {}
}
if (!img) img = feedStickerNewImg();
try {
img.dataset.emojiKey = k;
if (img.dataset && img.dataset.src) {
img.__emojiLazySrc = img.dataset.src;
img.removeAttribute('data-src');
}
} catch (e) {}
return img;
}
let feedStickerObserver = null;
let feedStickerObserverOk = false;
function feedStickerEnsureObserver(root) {
if (feedStickerObserverOk) return feedStickerObserver;
feedStickerObserverOk = true;
if (!root || !('IntersectionObserver' in window)) { feedStickerObserver = null; return null; }
try {
feedStickerObserver = new IntersectionObserver((entries) => {
for (let i = 0; i < entries.length; i++) {
const en = entries[i];
if (!en.isIntersecting) continue;
feedStickerLoad(en.target);
}
}, { root, rootMargin: '120px 0px' });
} catch (e) { feedStickerObserver = null; }
return feedStickerObserver;
}
function feedStickerLoad(img) {
if (!img) return;
const src = img.__fsSrc;
if (!src || img.getAttribute('src')) return;
if (window.mochiEmojiLazyEnqueue) {
try { window.mochiEmojiLazyEnqueue(img, src); return; } catch (e) {}
}
try { img.src = src; } catch (e) {}   // 无聊天侧机制：即时补 src 兜底（行为不减）
}
function feedStickerAttach(img, root, src) {
if (!img || img.getAttribute('src')) return;
img.__fsSrc = src;
const ob = feedStickerEnsureObserver(root);
if (ob) { try { ob.observe(img); return; } catch (e) {} }
feedStickerLoad(img);   // 无 IO 的浏览器：即时补 src 兜底（与聊天面板同口径）
}
function feedStickerWarmTokens(items) {
if (!window.mochiEmojiWarmGroupTokens) return;
const arr = [];
for (let i = 0; i < items.length; i++) { if (items[i].kind !== 'emoji') arr.push(items[i].v); }
try { window.mochiEmojiWarmGroupTokens(arr); } catch (e) {}
}
function feedStickerSigTarget(items) {
let cid = 'x';
try { cid = (window.__activeCid || 'default') + ''; } catch (e) {}
let sig = cid + '|' + (feedStickerCur || '') + '|' + items.length;
const ident = (typeof window.ccMediaCardIdent === 'function') ? window.ccMediaCardIdent : null;
let tot = 0, mix = 0;
for (let i = 0; i < items.length; i++) {
const v = items[i].v;
const k = ident ? ident(typeof v === 'string' ? v : String(v)) : String(v);
tot += k.length;
mix = (mix * 31 + k.charCodeAt(0) + k.charCodeAt(k.length - 1)) | 0;   // 逐身份 O(1) 混合：中间某张被换成等长身份也撞不开签名
}
sig += '|' + tot + '|' + mix;
if (items.length) {
const f = items[0].v, l = items[items.length - 1].v;
sig += '|' + (ident ? ident(String(f)) : String(f)) + '|' + (ident ? ident(String(l)) : String(l));
}
return sig;
}
let feedStickerRenderSig = '';
function feedRenderStickerList() {
const list = document.getElementById('feed-sticker-list');
if (!list) return;
const items = feedStickerItems();
const sig = feedStickerSigTarget(items);
const grid0 = list.firstElementChild;
let imgN = 0;
for (let i = 0; i < items.length; i++) { if (items[i].kind !== 'emoji') imgN++; }
if (sig && sig === feedStickerRenderSig && grid0 && grid0.classList.contains('emoji-grid') &&
grid0.childElementCount === items.length && grid0.querySelectorAll('img').length === imgN) {
return;
}
feedStickerHarvest(list);   // #931 整格重写前先把旧 img 收进回收池（同身份节点下一轮直接取回）
list.innerHTML = '';
if (!items.length) {
feedStickerRenderSig = '';
list.innerHTML = '<div class="ta-empty">\u6682\u65e0\u8d34\u7eb8\uff0c\u8bf7\u5230\u81ea\u5b9a\u4e49\u5b57\u5361 \u2192 \u8868\u60c5\u5305 \u4e0a\u4f20</div>';
return;
}
const grid = document.createElement('div');
grid.className = 'emoji-grid';
items.forEach((it, idx) => {
const d = document.createElement('div');
d.className = 'emoji-item';
d.dataset.stkKind = it.kind;
d.dataset.stkIdx = String(idx);
grid.appendChild(d);
if (it.kind === 'emoji') {
const sp = document.createElement('span');
sp.className = 'feed-sticker-emoji';
sp.textContent = it.v;
d.appendChild(sp);
} else {
const img = feedStickerImg(it.v);
d.appendChild(img);
feedStickerAttach(img, list, it.v);
}
});
grid.addEventListener('click', (e) => {
const d = e.target && e.target.closest ? e.target.closest('.emoji-item') : null;
if (!d || !grid.contains(d)) return;
e.stopPropagation();
const pid = feedStickerCard ? feedStickerCard.dataset.pid : '';
const it = items[Number(d.dataset.stkIdx)];
if (!it) return;
if (it.kind === 'emoji') feedPickStickerPos(pid, '', it.v);
else feedPickStickerPos(pid, it.v);
});
list.appendChild(grid);
feedStickerRenderSig = sig;   // #931 只记「确实按本轮 items 建完」的那一次
feedStickerWarmTokens(items);   // #931 令牌交给媒体池批量预热（不等逐图排队单读）
}
function openFeedStickerPanel(pid) {
if (!feedStickerCard) {
feedStickerCard = document.createElement('div');
feedStickerCard.id = 'feed-sticker-card';
feedStickerCard.className = 'poke-card emoji-card';
feedStickerCard.style.position = 'fixed';
feedStickerCard.style.left = '8px';
feedStickerCard.style.right = '8px';
feedStickerCard.style.bottom = '10px';
feedStickerCard.style.maxHeight = '46vh';
feedStickerCard.style.zIndex = '3000';
feedStickerCard.hidden = true;
feedStickerCard.innerHTML =
'<div class="emoji-head">' +
'<div class="emoji-tabs"><span class="emoji-tab sel">选个贴纸贴上去</span></div>' +
'<button class="poke-card-close" data-fsc="1">\u2715</button>' +
'</div>' +
'<div class="emoji-groups" id="feed-sticker-groups"></div>' +
'<div class="poke-card-scroll" style="min-height:100px;max-height:36vh" id="feed-sticker-list"></div>';
document.body.appendChild(feedStickerCard);
feedStickerCard.querySelector('[data-fsc]').addEventListener('click', () => { feedStickerCard.hidden = true; });
feedStickerCard.addEventListener('click', (e) => { if (e.target === feedStickerCard) feedStickerCard.hidden = true; });
}
feedStickerCard.dataset.pid = pid;
feedStickerCard.hidden = false;
feedStickerCur = '';           // 每次打开回「全部」
feedRenderStickerBar();
feedRenderStickerList();
}
function feedRandStickerPos() {
return { x: Math.round(6 + Math.random() * 74), y: Math.round(6 + Math.random() * 70) };
}
let feedPickCtx = null;
function feedCancelPickSticker() {
if (!feedPickCtx) return;
const ctx = feedPickCtx;
feedPickCtx = null;
if (ctx.timer) clearInterval(ctx.timer);
ctx.box.removeEventListener('click', ctx.onPick, true);
ctx.box.classList.remove('feed-sticker-picking');
if (ctx.blank && ctx.box.parentNode) ctx.box.parentNode.removeChild(ctx.box);
if (ctx.hint && ctx.hint.parentNode) ctx.hint.parentNode.removeChild(ctx.hint);
}
function feedEnsureStickerBox(post) {
const got = post.querySelector('.feed-imgs');
if (got) return { box: got, blank: false };
const box = document.createElement('div');
box.className = 'feed-imgs feed-imgs-blank';
const content = post.querySelector('.feed-content');
if (content && content.parentNode) content.parentNode.insertBefore(box, content.nextSibling);
else post.appendChild(box);
return { box: box, blank: true };
}
function feedPickStickerPos(pid, src, emoji) {
feedCancelPickSticker();
const post = feedPostEl(pid);
const made = post ? feedEnsureStickerBox(post) : null;
const box = made ? made.box : null;
if (!box) { addFeedSticker(pid, { src: src, emoji: emoji }); return; }
feedStickerCard.hidden = true;
box.classList.add('feed-sticker-picking');
const hint = document.createElement('div');
hint.className = 'feed-pick-hint';
hint.innerHTML = '<span>📍 点击照片选贴纸位置</span><button type="button">取消</button>';
hint.querySelector('button').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); feedCancelPickSticker(); });
box.parentNode.insertBefore(hint, box);
const onPick = (e) => {
e.preventDefault(); e.stopPropagation();
if (!box.isConnected) { feedCancelPickSticker(); return; }
const r = box.getBoundingClientRect();
const x = Math.round(Math.min(90, Math.max(4, ((e.clientX - r.left) / Math.max(1, r.width)) * 100)));
const y = Math.round(Math.min(90, Math.max(6, ((e.clientY - r.top) / Math.max(1, r.height)) * 100)));
feedCancelPickSticker();
addFeedSticker(pid, { src: src, emoji: emoji, x: x, y: y });
};
box.addEventListener('click', onPick, true);
const timer = setInterval(() => { if (!box.isConnected) feedCancelPickSticker(); }, 250);
feedPickCtx = { box, onPick, hint, timer, blank: made.blank };
}
function addFeedSticker(pid, st) {
const list = load();
const p = list.find(x => x.id === pid);
if (!p) { toast('这条动态不存在了'); return; }
p.stickers = Array.isArray(p.stickers) ? p.stickers : [];
const pos = (st && Number.isFinite(Number(st.x)) && Number.isFinite(Number(st.y)))
? { x: Math.min(92, Math.max(0, Math.round(Number(st.x)))), y: Math.min(92, Math.max(0, Math.round(Number(st.y)))) }
: feedRandStickerPos();
const rec = { src: (st && st.src) || '', emoji: (st && st.emoji) || '', x: pos.x, y: pos.y, ts: Date.now(), role: 'me', owner: 'me', authorName: feedUserName() };
p.stickers.push(rec);
save(list);
refreshPostCard(pid);
feedStickerTokUpgrade(pid, rec);
const cid = p.owner || 'default';
const cfg = feedCfgFor(cid);
if (Math.random() * 100 < cfg.commentProb) {
setTimeout(() => {
const l2 = load();
const p2 = l2.find(x => x.id === pid);
if (!p2) return;
p2.stickers = Array.isArray(p2.stickers) ? p2.stickers : [];
const taSt = feedTaPickSticker();
const pos2 = feedRandStickerPos();
const nm = p2.taName || taFeedNameFor(cid);
const rec2 = { src: taSt.src || '', emoji: taSt.emoji || '', x: pos2.x, y: pos2.y, ts: Date.now(), role: 'ta', owner: cid, authorName: nm };
p2.stickers.push(rec2);
save(l2);
refreshPostCard(pid);
feedStickerTokUpgrade(pid, rec2);
addNotice('comment', pid, nm + ' 在配图上贴了一张贴纸', cid);
}, (cfg.commentSpeedMin + Math.random() * Math.max(1, cfg.commentSpeedMax - cfg.commentSpeedMin)) * 1000);
}
}
function feedStickerTokUpgrade(pid, rec) {
if (!rec || !isSnapPayload(rec.src)) return;
const inline = rec.src;
feedTokImgs([inline]).then(function (tk) {
const t = tk && tk[0];
if (!t || t === inline || rec.src !== inline) return;
rec.src = t;
try {
const l = load();
const p = l.find(function (x) { return x.id === pid; });
if (p) { save(l); refreshPostCard(pid); }
} catch (e) {}
}).catch(function () {});
}
function feedTaPickSticker() {
const saved = comStickerTab;
comStickerTab = 'ta';
const g = comStickerGroups();
comStickerTab = saved;
const srcs = [];
g.forEach(x => (x[1] || []).forEach(s => srcs.push(s)));
if (srcs.length && Math.random() < 0.7) return { src: srcs[Math.floor(Math.random() * srcs.length)] };
const em = feedStickerEmojiPool();
return { emoji: em[Math.floor(Math.random() * em.length)] };
}
function removeFeedSticker(pid, i) {
if (!window.openModal) return;
window.openModal('撤回这张贴纸？', '', () => {
const list = load();
const p = list.find(x => x.id === pid);
if (!p || !p.stickers || !p.stickers[i]) return;
p.stickers.splice(i, 1);
save(list);
refreshPostCard(pid);
}, { noInput: true });
}
function feedMemoryPost() {
const now = new Date();
const mmdd = (now.getMonth() + 1) + '-' + now.getDate();
let best = null;
feedSortedAll().forEach(p => {
const d = new Date(p.ts);
if (d.getFullYear() >= now.getFullYear()) return;
if ((d.getMonth() + 1) + '-' + d.getDate() !== mmdd) return;
if (!best || p.ts > best.ts) best = p;
});
return best;
}
function feedMemDismissed() {
try { return store.get('feed-mem-dismiss') === new Date().toDateString(); } catch (e) { return false; }
}
function feedMemBannerHtml(p) {
const y = new Date(p.ts).getFullYear();
const txt = String(p.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
const th = (p.imgs && p.imgs[0]) || p.img || '';
return '<div class="feed-mem-card glass" id="feed-mem-card" data-pid="' + esc(p.id) + '">' +
'<div class="feed-mem-label">📅 回忆闪回 · ' + y + ' 年的今天</div>' +
'<div class="feed-mem-body">' + (th ? '<img src="' + attrEsc(th) + '" alt="">' : '') + '<span>' + esc(txt || '（图片动态）') + '</span></div>' +
'<button class="feed-mem-dismiss" type="button">✕</button></div>';
}
function revealFeedPost(pid) {
const all = feedSortedAll();
const hit = all.find(p => p.id === pid);
if (!hit) return;
feedRangeKey = feedBucketKeyFor(hit.ts);
render();
const posts = feedMainPosts;
const idx = posts.findIndex(p => p.id === pid);
if (idx < 0) return;
if (idx >= feedShownMain) render(idx + 20);
const el = feedMainPostEl(pid); // #1406：只在主列表里找，别命中隐藏的同名卡片
if (!el) return;
try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
el.classList.add('feed-hl');
setTimeout(() => el.classList.remove('feed-hl'), 2400);
}
function feedPostEl(pid) {
const all = document.getElementById('page-feed-all');
const scope = all && !all.hidden ? document.getElementById('feed-all-list') : document;
return scope ? scope.querySelector('[id="feed-post-' + pid + '"]') : null;
}
function refreshPostCard(pid, preload) {
const el = feedPostEl(pid);
if (!el) { renderVisible(); return; }
const p = (preload && preload.id === pid) ? preload : load().find(x => x.id === pid);
if (!p) { renderVisible(); return; }
const html = el.closest('#feed-all-list') ? postCardHtmlAll(p) : postCardHtml(p, partnerName());
const wrap = document.createElement('div');
wrap.innerHTML = html;
const fresh = wrap.firstElementChild;
if (!fresh || fresh.id !== 'feed-post-' + pid) { renderVisible(); return; }
el.replaceWith(fresh);
bindEvents(fresh);
}
function bindEvents(listEl) {
feedBindMoreBtn(listEl);
listEl.querySelectorAll('.feed-head-av').forEach(av => av.addEventListener('click', (e) => {
e.stopPropagation();
openFeedAll(av.dataset.owner, av.dataset.role === 'me' ? 'me' : 'ta');
}));
bindFeedImageClicks(listEl);
listEl.querySelectorAll('.feed-del').forEach(b => b.addEventListener('click', (e) => {
e.stopPropagation();
deletePostConfirm(b.dataset.id);
}));
listEl.querySelectorAll('.feed-expand').forEach(b => b.addEventListener('click', (e) => {
e.stopPropagation();
const body = b.parentNode ? b.parentNode.querySelector('.feed-body') : null;
if (!body) return;
const clamped = body.classList.toggle('feed-clamp');
body.classList.toggle('feed-open', !clamped);
b.textContent = clamped ? '展开全文' : '收起';
}));
listEl.querySelectorAll('.feed-act[data-like]').forEach(b => b.addEventListener('click', () => {
const list = load();
const p = list.find(x => x.id === b.dataset.like);
if (!p) return;
p.likes = p.likes || [];
const nm = feedUserName();
const i = p.likes.indexOf(nm);
const wasMe = i >= 0;
if (wasMe) p.likes.splice(i, 1); else p.likes.push(nm);
save(list);
refreshPostCard(b.dataset.like, p);
if (!wasMe && (p.role || p.by) === 'me' && Math.random() * 100 < feedCfgFor(p.owner || 'default').likeback) {
const cfg = feedCfgFor(p.owner || 'default');
setTimeout(() => {
const list2 = load();
const p2 = list2.find(x => x.id === p.id);
if (!p2) return;
p2.likes = p2.likes || [];
if (p2.likes.indexOf(p2.taName || taFeedNameFor(p2.owner || 'default')) < 0) p2.likes.push(p2.taName || taFeedNameFor(p2.owner || 'default'));
save(list2);
refreshPostCard(p.id, p2);
addNotice('like', p2.id, (p2.taName || taFeedNameFor(p2.owner || 'default')) + ' 赞了你的动态', p2.owner || 'default');
}, (cfg.likeSpeedMin + Math.random() * Math.max(1, cfg.likeSpeedMax - cfg.likeSpeedMin)) * 1000);
}
}));
listEl.querySelectorAll('.feed-act[data-comment]').forEach(b => b.addEventListener('click', () => {
showCommentBar(b.dataset.comment);
}));
listEl.querySelectorAll('.feed-act[data-sticker]').forEach(b => b.addEventListener('click', (e) => {
e.stopPropagation();
openFeedStickerPanel(b.dataset.sticker);
}));
listEl.querySelectorAll('.feed-sticker[data-sticker-del]').forEach(el2 => el2.addEventListener('click', (e) => {
e.stopPropagation();
const parts = String(el2.dataset.stickerDel).split('|');
removeFeedSticker(parts[0], parseInt(parts[1], 10));
}));
const memCard = listEl.querySelector('.feed-mem-card');
if (memCard) {
memCard.addEventListener('click', (e) => {
if (e.target && e.target.closest && e.target.closest('.feed-mem-dismiss')) return;
revealFeedPost(memCard.dataset.pid);
});
const dis = memCard.querySelector('.feed-mem-dismiss');
if (dis) dis.addEventListener('click', (e) => {
e.stopPropagation();
try { store.set('feed-mem-dismiss', new Date().toDateString()); } catch (err) {}
memCard.remove();
});
}
listEl.querySelectorAll('.feed-act[data-fav]').forEach(b => b.addEventListener('click', () => {
const pid = b.dataset.fav;
const list = load();
const p = list.find(x => x.id === pid);
if (!window.addMyFavItem) { toast('收藏功能暂不可用'); return; }
if (!p) { toast('未找到这条动态'); return; }
const isMine = (p.role || p.by) === 'me';
const ok = window.addMyFavItem({
kind: 'feed',
text: p.content || '',
imgs: (p.imgs || []).slice(),
ts: p.ts || Date.now(),
side: isMine ? 'out' : 'in'
});
toast(ok ? '已收藏这条动态' : '这条动态已收藏过');
refreshPostCard(pid); // 刷新收藏按钮高亮态
}));
listEl.querySelectorAll('.feed-comment').forEach(c => c.addEventListener('click', () => {
const pid = c.dataset.c;
const ci = Number(c.dataset.ci);
const list = load();
const p = list.find(x => x.id === pid);
if (!p || !p.comments || !p.comments[ci] || (p.comments[ci].role || p.comments[ci].by) === 'me') return;
showCommentBar(pid, { pid: pid, ci: ci });
}));
listEl.querySelectorAll('.feed-reply').forEach(rEl => rEl.addEventListener('click', (e) => {
e.stopPropagation();
const wrap = rEl.closest('.feed-comment');
if (!wrap) return;
const pid = wrap.dataset.c;
const ci = Number(rEl.dataset.ci);
const ri = Number(rEl.dataset.ri);
const list = load();
const p = list.find(x => x.id === pid);
const tc = p && p.comments && p.comments[ci];
const tr = tc && tc.replies && tc.replies[ri];
if (!tr || (tr.role || tr.by) === 'me') return;
showCommentBar(pid, { pid: pid, ci: ci, ri: ri });
}));
}
const comBar = document.getElementById('feed-comment-bar');
const comInput = document.getElementById('feed-comment-input');
const comSend = document.getElementById('feed-comment-send');
const comSticker = document.getElementById('feed-comment-sticker');
const comImg = document.getElementById('feed-comment-img');
if (comImg && window.mochiFilePickSurface) window.mochiFilePickSurface(comImg, { id: 'feed-com-tap', accept: 'image/*', owner: 'mochi-com-img-pick' });
if (comInput) comInput.dataset.ceDone = '1';
let comPid = null;
let comReplyTarget = null; // v3.5.58：回复模式 { pid, ci }
let comImgData = []; // 评论携带的图片（dataURL），不塞进输入框文本（避免乱码）
function renderComPv() {
const pv = document.getElementById('feed-comment-pv');
if (!pv) return;
pv.innerHTML = '';
comImgData.forEach((d, i) => {
const span = document.createElement('span');
span.className = 'feed-pv feed-pv-sm';
const img = document.createElement('img');
img.src = d;
img.alt = '';
const delBtn = document.createElement('button');
delBtn.className = 'feed-preview-del';
delBtn.dataset.i = i;
delBtn.textContent = '✕';
span.appendChild(img);
span.appendChild(delBtn);
pv.appendChild(span);
});
pv.hidden = comImgData.length === 0;
pv.querySelectorAll('.feed-preview-del').forEach(b => b.addEventListener('click', () => {
comImgData.splice(parseInt(b.dataset.i, 10), 1);
renderComPv();
}));
}
function feedCommentBarAdopt() {
if (!comBar) return;
const all = document.getElementById('page-feed-all');
const host = all && !all.hidden ? all : document.getElementById('page-feed');
if (!host || comBar.parentNode === host) return;
host.appendChild(comBar);
const panel = document.getElementById('feed-comment-panel');
if (panel) host.appendChild(panel);
}
function showCommentBar(pid, replyTarget) {
feedCommentBarAdopt();
comPid = pid;
comReplyTarget = replyTarget || null;
comImgData = [];
if (comBar) comBar.hidden = false;
if (comInput) {
comInput.value = '';
let rpName = partnerName();
if (replyTarget) {
try {
const lst = load();
const pp = lst.find(x => x.id === pid);
const tc = pp && pp.comments && pp.comments[replyTarget.ci];
if (tc) {
if (tc.authorName) rpName = tc.authorName;
const tr = replyTarget.ri != null && tc.replies ? tc.replies[replyTarget.ri] : null;
if (tr && tr.authorName) rpName = tr.authorName;
}
} catch (e) {}
}
comInput.placeholder = replyTarget ? '回复 ' + rpName + '…' : '评论…';
setTimeout(() => comInput.focus(), 60);
}
renderComPv();
const panel = document.getElementById('feed-comment-panel');
if (panel && !panel.hidden) panel.hidden = true;
}
function hideCommentBar() {
if (comBar) comBar.hidden = true;
if (comInput) { comInput.value = ''; comInput.placeholder = '评论…'; }
comPid = null;
comReplyTarget = null;
comImgData = [];
renderComPv();
const panel = document.getElementById('feed-comment-panel');
if (panel) panel.hidden = true;
}
function compressCommentImg(src, maxSide) {
if (!window.mochiImgCompressTo) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return Promise.resolve(null); }
return window.mochiImgCompressTo(src, { maxSide: maxSide, mime: 'image/png', tag: 'feed-cmt' });
}
let comStickerPanel = null;
let comStickerTab = 'ta';   // 'ta' | 'mine'
let comStickerCur = '';     // 当前分组
function comStickerGroups() {
if (comStickerTab === 'em') return [['emoji \u8868\u60c5', FEED_STICKER_EMOJI]];
const onlyData = (groups) => (groups || [])
.map(([n, a]) => [n, (a || []).filter(s => typeof s === 'string' && (s.indexOf('data:') === 0 || (window.mochiMediaIsToken && window.mochiMediaIsToken(s))))])
.filter(([, a]) => a.length);
if (comStickerTab === 'ta') return onlyData((window.getMediaGroups && window.getMediaGroups('sticker')) || []);
try {
if (window.getMyEmojiGroups) {
const g = window.getMyEmojiGroups();
if (Array.isArray(g) && g.length) return onlyData(g);
}
} catch (e) {}
try {
const v = JSON.parse(window.xyStore('xy-home-v2').get('my-emoji-groups') || 'null');
return Array.isArray(v) ? onlyData(v) : [];
} catch (e) { return []; }
}
function openComStickerPanel() {
const host = document.getElementById('feed-comment-panel');
if (!host) return;
host.hidden = false;
if (!comStickerPanel) {
comStickerPanel = document.createElement('div');
comStickerPanel.className = 'poke-card emoji-card';
comStickerPanel.style.position = 'absolute';
comStickerPanel.style.top = 'auto';
comStickerPanel.style.bottom = '0';
comStickerPanel.style.left = '0';
comStickerPanel.style.right = '0';
comStickerPanel.style.maxHeight = '46vh';
comStickerPanel.style.padding = '12px 14px';
comStickerPanel.innerHTML =
'<div class="emoji-head">' +
'<div class="emoji-tabs">' +
'<button class="emoji-tab sel" data-cs-tab="ta">TA \u7684\u8868\u60c5\u5305</button>' +
'<button class="emoji-tab" data-cs-tab="mine">\u6211\u7684\u8868\u60c5\u5305</button>' +
'<button class="emoji-tab" data-cs-tab="em">emoji \u8868\u60c5</button>' +
'</div>' +
'<button class="poke-card-close" data-cs="1">\u2715</button>' +
'</div>' +
'<div class="emoji-groups" id="com-sticker-groups"></div>' +
'<div class="poke-card-scroll" style="min-height:100px;max-height:34vh" id="com-sticker-list"></div>';
host.appendChild(comStickerPanel);
function closeComSticker() {
comStickerPanel.hidden = true;
host.hidden = true;
}
comStickerPanel.querySelector('[data-cs]').addEventListener('click', (e) => { e.stopPropagation(); closeComSticker(); });
comStickerPanel.addEventListener('click', (e) => { if (e.target === comStickerPanel) closeComSticker(); });
comStickerPanel.querySelectorAll('[data-cs-tab]').forEach(tb => tb.addEventListener('click', (e) => {
e.stopPropagation();
comStickerTab = tb.getAttribute('data-cs-tab');
comStickerCur = '';
comStickerPanel.querySelectorAll('[data-cs-tab]').forEach(x => x.classList.toggle('sel', x === tb));
renderComStickerBar();
renderComStickerList();
try { tb.blur(); } catch (err) {}
}));
}
function renderComStickerBar() {
const groupsBar = document.getElementById('com-sticker-groups');
if (!groupsBar) return;
groupsBar.innerHTML = '';
const groups = comStickerGroups();
if (comStickerCur && !groups.some(g => g[0] === comStickerCur)) comStickerCur = '';
const chips = groups.filter(g => g[1].length).map(g => [g[0], g[0] + g[1].length]);
chips.forEach(([val, label]) => {
const c = document.createElement('span');
c.className = 'emoji-g-chip' + (comStickerCur === val ? ' sel' : '');
c.textContent = label;
c.addEventListener('click', (e) => {
e.stopPropagation();
comStickerCur = (comStickerCur === val ? '' : val);
renderComStickerList();
});
groupsBar.appendChild(c);
});
}
function renderComStickerList() {
const list = document.getElementById('com-sticker-list');
if (!list) return;
list.innerHTML = '';
const groups = comStickerGroups();
if (!groups.length) {
list.innerHTML = '<div class="ta-empty">\u6682\u65e0\u8868\u60c5\u5305\uff0c\u8bf7\u5230\u81ea\u5b9a\u4e49\u5b57\u5361 \u2192 \u8868\u60c5\u5305 \u4e0a\u4f20</div>';
return;
}
const isEmoji = comStickerTab === 'em';
if (!comStickerCur && !isEmoji) {
list.innerHTML = '<div class="emoji-empty">\u70b9\u51fb\u4e0a\u65b9\u5206\u7ec4\u67e5\u770b\u8868\u60c5\u5305</div>';
return;
}
const g = isEmoji ? groups[0] : groups.find(x => x[0] === comStickerCur);
if (!g || !g[1].length) { list.innerHTML = '<div class="ta-empty">\u8be5\u5206\u7ec4\u6682\u65e0\u8868\u60c5\u5305</div>'; return; }
const h = document.createElement('div');
h.className = 'cc-group-header';
h.innerHTML = '<span class="ccg-name">' + esc(g[0]) + '</span><span class="ccg-count">' + g[1].length + '</span>';
list.appendChild(h);
const grid = document.createElement('div');
grid.className = isEmoji ? 'emoji-grid emoji-grid-text emoji-grid-emoji' : 'emoji-grid'; // 复用聊天 4 列网格样式
g[1].forEach(src => {
const d = document.createElement('div');
if (isEmoji) {
d.className = 'emoji-item emoji-text-item';
d.textContent = src;
d.addEventListener('click', (e) => {
e.stopPropagation();
if (comInput) comInput.value = (comInput.value || '') + src;
});
grid.appendChild(d);
return;
}
d.className = 'emoji-item';
const img = document.createElement('img');
img.src = src;
img.alt = '表情';
d.appendChild(img);
d.addEventListener('click', (e) => {
e.stopPropagation();
if (comImgData.length >= 9) { toast('最多附带 9 张图片/表情'); return; }
comImgData.push(src); // 表情包作为图片加入评论（不塞输入框文本）
renderComPv();
comStickerPanel.hidden = true;
const hostEl = document.getElementById('feed-comment-panel');
if (hostEl) hostEl.hidden = true;
if (comInput) comInput.focus();
});
grid.appendChild(d);
});
list.appendChild(grid);
}
let htsHide = false;
try { if (window.xyStore) htsHide = window.xyStore('xy-home-v2').get('hide-ta-sticker') === '1'; } catch (e) {}
const taTabBtn = comStickerPanel.querySelector('[data-cs-tab="ta"]');
if (taTabBtn) taTabBtn.hidden = htsHide;
const defTab = htsHide ? 'mine' : 'ta';
comStickerTab = defTab;
comStickerCur = '';
comStickerPanel.querySelectorAll('[data-cs-tab]').forEach(x => x.classList.toggle('sel', x.getAttribute('data-cs-tab') === defTab));
renderComStickerBar();
renderComStickerList();
comStickerPanel.hidden = false;
}
if (comSticker) comSticker.addEventListener('click', (e) => { e.stopPropagation(); openComStickerPanel(); });
let comImgBusy = false;
if (comImg) {
comImg.addEventListener('click', (e) => {
if (!(e.target && e.target.closest && e.target.closest('input[data-file-pick-surface]'))) e.preventDefault();
e.stopPropagation();
if (comImgBusy) return;
comImgBusy = true;
let settled = false;
const done = () => { if (settled) return; settled = true; comImgBusy = false; };
window.mochiFilePick({
id: 'mochi-com-img-pick', accept: 'image/*',
onFiles: (files) => {
done();
const f = files && files[0];
if (!f) { toast('没有取到图片，请再选一次'); return; }
const reader = new FileReader();
reader.onload = () => {
compressCommentImg(reader.result, 240).then(data => {
if (!data) { toast('图片过大或格式不支持'); return; }
comImgData.push(data);
renderComPv();
if (comInput) comInput.focus();
});
};
reader.onerror = () => toast('图片读取失败，请换一张再试');
reader.readAsDataURL(f);
}
});
});
}
function submitComment() {
const val = comInput ? comInput.value.trim() : '';
const content = (val + (comImgData.length ? (val ? ' ' : '') + comImgData.join(' ') : '')).trim();
if (!content || !comPid) return;
const pid = comPid;
const list = load();
const p = list.find(x => x.id === pid);
if (!p) return;
if (comReplyTarget && p.comments && p.comments[comReplyTarget.ci]) {
const tc = p.comments[comReplyTarget.ci];
tc.replies = tc.replies || [];
const tcOwner = (tc && tc.owner) || p.owner || 'default';
let toName = tc.authorName || (((tc.role || tc.by) === 'me') ? feedUserName() : taFeedNameFor(tcOwner));
if (comReplyTarget.ri != null) {
const tr = tc.replies[comReplyTarget.ri];
if (tr) toName = tr.authorName || ((((tr.role || tr.by) === 'me') ? feedUserName() : taFeedNameFor(tr.owner || tcOwner)));
}
tc.replies.push(stampAuthor({ content: content, ts: Date.now(), to: toName }, activeMe()));
save(list);
const replyCi = comReplyTarget.ci;
hideCommentBar();
refreshPostCard(pid);
const tcfg = feedCfgFor(tcOwner);
if (Math.random() * 100 < tcfg.replyProb) {
const cfg = tcfg;
setTimeout(() => {
poolReadyFor(tcOwner, function () { try {
const list2 = load();
const p2 = list2.find(x => x.id === pid);
if (!p2 || !p2.comments || !p2.comments[replyCi]) return;
p2.comments[replyCi].replies = p2.comments[replyCi].replies || [];
const replyText = pickReplyContent(cfg, tcOwner);
const replies = p2.comments[replyCi].replies;
let myToName = feedUserName();
for (let i = replies.length - 1; i >= 0; i--) {
const x = replies[i];
if ((x.role || x.by) === 'me') { myToName = x.authorName || myToName; break; }
}
replies.push(stampAuthor({ content: replyText, ts: Date.now(), to: myToName }, taAuthorOfCid(tcOwner)));
save(list2);
refreshPostCard(pid);
addNotice('comment', p2.id, taFeedNameFor(tcOwner) + ' 回复了你：' + noticeTextClean(replyText), tcOwner, { ci: replyCi, ri: replies.length - 1 });
} catch (eR) {} });
}, (cfg.replySpeedMin + Math.random() * Math.max(1, cfg.replySpeedMax - cfg.replySpeedMin)) * 1000);
}
return;
}
p.comments = p.comments || [];
const pcfg = feedCfgFor(p.owner || 'default');
const commentText = pickReplyContent(pcfg, p.owner || 'default');
p.comments.push(stampAuthor({ content: content, ts: Date.now(), replies: [] }, activeMe()));
save(list);
hideCommentBar();
refreshPostCard(pid);
if (Math.random() * 100 < pcfg.commentProb) {
const cfg = pcfg;
setTimeout(() => {
poolReadyFor(p.owner || 'default', function () { try {
const list2 = load();
const p2b = list2.find(x => x.id === pid);
if (!p2b) return;
p2b.comments = p2b.comments || [];
const taText = pickReplyContent(cfg, p2b.owner || 'default');
p2b.comments.push(stampAuthor({ content: taText, ts: Date.now(), replies: [] }, taAuthorOf(p2b)));
save(list2);
refreshPostCard(pid);
const taName2 = p2b.taName || taFeedNameFor(p2b.owner || 'default');
const loc = { ci: p2b.comments.length - 1 };
if ((p2b.role || p2.by) === 'me') addNotice('comment', p2b.id, taName2 + ' 评论了你的动态：' + noticeTextClean(taText), p2b.owner || 'default', loc);
else addNotice('comment', p2b.id, taName2 + ' 回复了你的评论：' + noticeTextClean(taText), p2b.owner || 'default', loc);
} catch (eC) {} });
}, (cfg.commentSpeedMin + Math.random() * Math.max(1, cfg.commentSpeedMax - cfg.commentSpeedMin)) * 1000);
}
}
if (comSend) comSend.addEventListener('click', submitComment);
if (comInput) comInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submitComment(); } });
function noticeTextClean(s) {
return String(s || '').replace(/\s*\n\s*/g, ' ').replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[表情包]').replace(/@@m:[0-9a-f]{32}/g, '[表情包]');
}
function notices() { try { return JSON.parse(store.get('feed-notices') || '[]'); } catch (e) { return []; } }
function saveNotices(list) { store.set('feed-notices', JSON.stringify(list)); }
function feedPageVisible() {
return ['page-feed', 'page-feed-all'].some(id => {
const el = document.getElementById(id);
return el && !el.hidden;
});
}
function openFeedPage() {
clearFeedAppUnread();
feedRangeKey = 'week'; // #1406：从桌面进朋友圈先落回「本周」那一页（翻去几个月前是临时的）
render();
renderNoticeBadge();
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const fp = document.getElementById('page-feed');
if (fp) fp.hidden = false;
}
function addNotice(type, pid, text, owner, loc) {
const list = notices();
const item = { type: type, pid: pid, text: text, ts: Date.now(), read: false, owner: owner || '' };
if (loc && loc.ci != null) item.ci = loc.ci;
if (loc && loc.ri != null) item.ri = loc.ri;
list.unshift(item);
if (list.length > 100) list.length = 100;
saveNotices(list);
try { store.set('feed-app-unread', String(feedAppUnread() + 1)); } catch (e) {}
renderNoticeBadge();
if (window.showDeskPopup && !feedPageVisible()) {
const av = owner ? taAvFor(owner) : '';
window.showDeskPopup({ name: '朋友圈', notifyKind: 'feed', text: (window.taFit ? window.taFit(noticeTextClean(text), owner) : noticeTextClean(text)), av: av, avFixed: true, onClick: openFeedPage, isHidden: document.visibilityState === 'hidden' });
} else if (feedPageVisible() && document.visibilityState !== 'hidden') {
let nt = noticeTextClean(text);
if (nt.length > 40) nt = nt.slice(0, 40) + '…';
toast(nt);
}
}
function unreadCount() { return notices().filter(n => !n.read).length; }
function feedAppUnread() { try { return parseInt(store.get('feed-app-unread'), 10) || 0; } catch (e) { return 0; } }
function clearFeedAppUnread() {
try { store.set('feed-app-unread', '0'); } catch (e) {}
renderNoticeBadge();
}
function renderNoticeBadge() {
const b = document.getElementById('feed-badge');
if (b) {
const n = unreadCount();
b.hidden = n === 0;
b.textContent = n > 99 ? '99+' : String(n);
}
const appN = feedAppUnread();
if (window.setDeskBadge) { window.setDeskBadge('feed', appN); }
else {
const ab = document.getElementById('feed-app-badge');
if (ab) {
ab.hidden = appN === 0;
ab.textContent = appN > 99 ? '99+' : String(appN);
}
}
}
function jumpToPost(pid, ci, ri) {
let el = feedMainPostEl(pid);
if (!el) {
const hit = feedSortedAll().find(p => p.id === pid);
if (hit) { feedRangeKey = feedBucketKeyFor(hit.ts); render(); el = feedMainPostEl(pid); }
}
if (!el) return;
let target = el;
if (ci != null && ci !== '') {
const cEl = el.querySelector('.feed-comment[data-ci="' + ci + '"]');
if (cEl) {
const rEl = (ri != null && ri !== '') ? cEl.querySelector('.feed-reply[data-ri="' + ri + '"]') : null;
target = rEl || cEl;
}
}
target.scrollIntoView({ behavior: 'smooth', block: 'center' });
target.classList.remove('feed-flash');
void target.offsetWidth;
target.classList.add('feed-flash');
}
function noticeThumbOf(n, posts) {
try {
if (!n || n.type !== 'comment' || n.ci == null) return '';
const p = (posts || []).find(x => x.id === n.pid);
if (!p || !p.comments || !p.comments[n.ci]) return '';
const src = (n.ri != null && Array.isArray(p.comments[n.ci].replies) && p.comments[n.ci].replies[n.ri])
? p.comments[n.ci].replies[n.ri].content
: p.comments[n.ci].content;
const m = /(?:data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+|@@m:[0-9a-f]{32})/.exec(String(src || ''));
return m ? m[0] : '';
} catch (e) { return ''; }
}
function renderNotices() {
const listEl = document.getElementById('feed-notice-list');
if (!listEl) return;
const list = notices();
const postsForThumbs = load();
const avFor = (n) => { try { const v = n && n.owner ? taAvFor(n.owner) : partnerAv(); return v || ''; } catch (e) { return ''; } };
const avHtml = (data) => data
? '<span class="fn-av"><img src="' + attrEsc(data) + '" alt=""></span>'
: '<span class="fn-av"><svg viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg></span>';
listEl.innerHTML = list.length
? list.map(n => {
const ico = n.type === 'like'
? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>'
: n.type === 'comment'
? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>'
: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
const thumb = noticeThumbOf(n, postsForThumbs);
const thumbHtml = thumb ? '<img class="fn-thumb" src="' + attrEsc(thumb) + '" alt="">' : '';
return '<div class="feed-notice-item' + (n.read ? '' : ' new') + '" data-pid="' + n.pid + '" data-ci="' + (n.ci != null ? n.ci : '') + '" data-ri="' + (n.ri != null ? n.ri : '') + '">' + avHtml(avFor(n)) + '<span class="fn-ico">' + ico + '</span><span class="fn-text">' + (window.taFit ? window.taFit(noticeTextClean(n.text), n.owner) : noticeTextClean(n.text)) + '</span>' + thumbHtml + '<span class="fn-time">' + fmtDT(n.ts) + '</span></div>';
}).join('')
: '<div class="ta-empty">暂时没有新的提醒</div>';
listEl.querySelectorAll('.feed-notice-item').forEach(it => it.addEventListener('click', () => {
document.getElementById('feed-notice-panel').hidden = true;
const ci = it.dataset.ci === '' ? null : Number(it.dataset.ci);
const ri = it.dataset.ri === '' ? null : Number(it.dataset.ri);
jumpToPost(it.dataset.pid, ci, ri);
}));
listEl.querySelectorAll('.fn-thumb').forEach(t => t.addEventListener('click', (e) => {
e.stopPropagation();
if (window.viewChatImage) window.viewChatImage(t.src);
}));
}
const feedInput = document.getElementById('feed-input');
if (feedInput) feedInput.dataset.ceDone = '1';
const pickBtn = document.getElementById('feed-pick-img');
if (pickBtn && window.mochiFilePickSurface) window.mochiFilePickSurface(pickBtn, { id: 'feed-pick-tap', accept: 'image/*', multiple: true, owner: 'dev-feed-pick-img' });
const preview = document.getElementById('feed-preview');
let pickedImgs = [];
const MAX_PICK = 9;
function renderPreview() {
if (!preview) return;
preview.innerHTML = '';
pickedImgs.forEach((d, i) => {
const span = document.createElement('span');
span.className = 'feed-pv';
const img = document.createElement('img');
img.src = d;
img.alt = '';
const delBtn = document.createElement('button');
delBtn.className = 'feed-preview-del';
delBtn.dataset.i = i;
delBtn.textContent = '✕';
span.appendChild(img);
span.appendChild(delBtn);
preview.appendChild(span);
});
preview.hidden = pickedImgs.length === 0;
preview.querySelectorAll('.feed-preview-del').forEach(b => b.addEventListener('click', () => {
pickedImgs.splice(parseInt(b.dataset.i, 10), 1);
renderPreview();
}));
}
if (pickBtn) {
pickBtn.addEventListener('click', () => {
window.mochiFilePick({
id: 'dev-feed-pick-img',
accept: 'image/*',
multiple: true,
onFiles: (files) => {
if (!files.length) return;
if (pickedImgs.length + files.length > MAX_PICK) { toast('最多发布 ' + MAX_PICK + ' 张图片'); }
files.slice(0, MAX_PICK - pickedImgs.length).forEach(f => {
compressImage(f, (dataUrl) => {
if (!dataUrl) return;
pickedImgs.push(dataUrl);
renderPreview();
});
});
}
});
});
}
const coverEl = document.getElementById('feed-cover');
const coverAvEl = document.getElementById('feed-my-av');
const coverNameEl = document.getElementById('feed-my-name');
function pickCoverBg() {
window.mochiFilePick({
id: 'dev-feed-cover-bg',
accept: 'image/*',
onFiles: (files) => {
const f = files && files[0];
if (!f) return;
compressImage(f, (dataUrl) => {
if (!dataUrl) return;
window.activeStore().set('feed-cover-bg', dataUrl);
renderCover();
toast('朋友圈背景已更新');
});
}
});
}
function armCoverLayer(el, layerId, ownerId, hasBg) {
if (!el || !window.mochiFilePickSurface) return;
var layer = null;
try { layer = window.mochiFilePickSurface(el, { id: layerId, accept: 'image/*', owner: ownerId }); } catch (e) {}
if (!layer) return;
try { if (layer.parentNode === el && el.firstChild !== layer) el.insertBefore(layer, el.firstChild); } catch (e) {}
try { layer.style.pointerEvents = hasBg ? 'none' : 'auto'; } catch (e) {}
}
if (coverEl) {
coverEl.addEventListener('click', (e) => {
if (e.target === coverAvEl || coverAvEl && coverAvEl.contains(e.target)) return;
if (e.target === coverNameEl || coverNameEl && coverNameEl.contains(e.target)) return;
if (coverBg()) {
if (window.openModal) {
window.openModal('已设置朋友圈背景', '', (v) => {
if (v === '1') pickCoverBg();
if (v === '2') { window.activeStore().set('feed-cover-bg', ''); renderCover(); toast('已恢复默认背景'); }
}, { noInput: true, pills: [{ label: '更换背景', value: '1' }, { label: '恢复默认', value: '2' }] });
}
} else {
pickCoverBg();
}
});
}
const feedAvPickInput = document.createElement('input');
feedAvPickInput.type = 'file'; feedAvPickInput.accept = 'image/*';
feedAvPickInput.id = 'feed-av-pick';
feedAvPickInput.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:1;margin:0;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
document.body.appendChild(feedAvPickInput);
feedAvPickInput.onchange = () => {
const f = feedAvPickInput.files && feedAvPickInput.files[0];
feedAvPickInput.value = ''; // 允许重选同一文件
if (!f) return;
if (!window.mochiImgIngest) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return; }
window.mochiImgIngest(f, { maxSide: 256, quality: 0.85, tag: 'feed-av' }).then((r) => {
if (!r || r.st !== 'ok') { toast(window.mochiImgIngestMiss(r, '头像')); return; }
window.activeStore().set('feed-user-avatar', r.data);
renderCover();
toast('朋友圈头像已更新');
});
};
if (coverAvEl) {
if (window.mochiFilePickLabel) window.mochiFilePickLabel(coverAvEl, feedAvPickInput);
if (window.mochiFilePickSurface) window.mochiFilePickSurface(coverAvEl, { id: 'feed-myav-tap', accept: 'image/*', owner: feedAvPickInput });
coverAvEl.addEventListener('click', (e) => {
e.stopPropagation();
var _fb = () => { window.mochiFilePickFire(feedAvPickInput, { onFail: () => toast('无法打开相册，请重试') }); };
if (window.mochiFilePickGuard) window.mochiFilePickGuard(feedAvPickInput, _fb);
else _fb();
});
}
if (coverNameEl) {
coverNameEl.addEventListener('click', (e) => {
e.stopPropagation();
if (window.openModal) {
window.openModal('修改朋友圈昵称', window.activeStore().get('feed-user-name') || window.activeStore().get('lbl-user') || '我', (v) => {
const val = (v || '').trim();
if (val) {
const prev = feedUserName();
window.activeStore().set('feed-user-name', val);
sweepFeedNameSnapshots('me', window.__activeCid || 'default', prev, val);
renderCover();
rerenderFeedAfterRename();
toast('朋友圈昵称已更新');
}
}, { maxlength: 12 });
}
});
}
async function feedTokImgs(arr) {
const raw = (arr || []).slice();
if (!raw.length || !window.mochiMediaTokenize) return raw;
const out = [];
let tok = 0;
for (let i = 0; i < raw.length; i++) {
const u = typeof raw[i] === 'string' ? raw[i].trim() : '';
let t = null;
if (u.indexOf('data:') === 0) { try { t = await window.mochiMediaTokenize(u); } catch (e) {} }
if (t) { tok++; out.push(t); } else out.push(raw[i]);
}
if (!tok) return raw;
let ok = false;
try { ok = await window.mochiMediaFlush(); } catch (e) {}
return ok ? out : raw; // 池未持久＝引用绝不先落库，退回内联原件
}
let _feedPubBusy = false;
async function publish() {
const input = document.getElementById('feed-input');
const content = input ? input.value.trim() : '';
if (!content && !pickedImgs.length) { toast('写点什么再发布吧'); return; }
if (_feedPubBusy) return;
_feedPubBusy = true;
const rawImgs = pickedImgs.slice();
pickedImgs = [];
renderPreview();
if (input) input.value = '';
let imgsArr = rawImgs;
try { imgsArr = await feedTokImgs(rawImgs); } catch (e) {}
_feedPubBusy = false;
const list = load();
const id = 'f_' + Date.now();
const me = activeMe();
const cs = window.activeStore();
const taName = cs.get('lbl-partner') || 'TA';
const taAv = cs.get('avatar-partner') || '';
const post = { id: id, role: 'me', owner: me.owner, authorName: me.authorName, authorAv: '', taName: taName, taAv: '', content: content, imgs: imgsArr, ts: Date.now(), likes: [], comments: [] };
list.unshift(post);
save(list);
renderVisible();
if (!document.getElementById('feed-post-' + id)) {
feedGuardWrite(JSON.stringify(list));
renderVisible();
}
toast('已发布');
const pubCardEl = document.getElementById('feed-publish-card');
if (pubCardEl) pubCardEl.hidden = true;
const allContacts = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
allContacts.forEach(ct => {
const cid = ct && ct.id ? ct.id : 'default';
const ccfg = feedCfgFor(cid);
if (Math.random() * 100 < ccfg.likeProb) {
setTimeout(() => {
const list2 = load();
const p2 = list2.find(x => x.id === id);
if (!p2) return;
p2.likes = p2.likes || [];
const nm = taFeedNameFor(cid);
if (p2.likes.indexOf(nm) < 0) p2.likes.push(nm);
save(list2);
refreshPostCard(id);
addNotice('like', p2.id, nm + ' 赞了你的动态', cid);
}, (ccfg.likeSpeedMin + Math.random() * Math.max(1, ccfg.likeSpeedMax - ccfg.likeSpeedMin)) * 1000);
}
if (Math.random() * 100 < ccfg.commentProb) {
setTimeout(() => {
poolReadyFor(cid, function () { try {
const list2 = load();
const p2 = list2.find(x => x.id === id);
if (!p2) return;
p2.comments = p2.comments || [];
p2.comments.push(stampAuthor({ content: pickReplyContent(ccfg, cid), ts: Date.now(), replies: [] }, taAuthorOfCid(cid)));
save(list2);
refreshPostCard(id);
addNotice('comment', p2.id, taFeedNameFor(cid) + ' 评论了你的动态', cid);
} catch (eF) {} });
}, (ccfg.commentSpeedMin + Math.random() * Math.max(1, ccfg.commentSpeedMax - ccfg.commentSpeedMin)) * 1000);
}
});
allContacts.forEach(ct => {
const cid = ct && ct.id ? ct.id : 'default';
const ccfg = feedCfgFor(cid);
if (Math.random() * 100 < favFeedProbFor(cid)) {
setTimeout(() => {
const list2 = load();
const mine = list2.filter(x => (x.role || x.by) === 'me');
if (!mine.length) return;
const pick = mine[Math.floor(Math.random() * mine.length)];
const f = { kind: 'feed', text: pick.content || '', imgs: (pick.imgs || []).slice(), ts: pick.ts || Date.now() };
const s = window.storeFor(cid);
if (window.xyBigWriteHold(s, 'fav-msgs')) return;
let fav = [];
try { fav = JSON.parse(s.get('fav-msgs') || '[]'); } catch (e) { fav = []; }
if (!Array.isArray(fav)) fav = [];
if (fav.some(x => (x.by || 'me') === 'ta' && (x.kind || 'msg') === 'feed' && x.ts === f.ts)) return;
fav.push(Object.assign({ by: 'ta' }, f));
s.set('fav-msgs', JSON.stringify(fav));
if (cid === (window.__activeCid || 'default')) {
toast(window.taFit ? window.taFit('TA 收藏了你的朋友圈动态') : 'TA 收藏了你的朋友圈动态');
}
}, (ccfg.likeSpeedMin + Math.random() * Math.max(1, ccfg.likeSpeedMax - ccfg.likeSpeedMin)) * 1000);
}
});
}
window.feedAddPost = function (text, imgs) {
try {
const content = String(text || '').trim();
if (!content && !(imgs && imgs.length)) return null;
const list = load();
const id = 'f_' + Date.now();
const me = activeMe();
const cs = window.activeStore();
const taName = cs.get('lbl-partner') || 'TA';
const post = { id: id, role: 'me', owner: me.owner, authorName: me.authorName, authorAv: '', taName: taName, taAv: '', content: content, imgs: (imgs || []).slice(), ts: Date.now(), likes: [], comments: [] };
list.unshift(post);
save(list);
renderVisible();
return id;
} catch (e) { return null; }
};
function feedCfgFor(cid) {
const s = window.storeFor(cid || 'default');
const c = {};
['fd-like-prob', 'fd-like-speed-min', 'fd-like-speed-max', 'fd-comment-prob', 'fd-comment-speed-min', 'fd-comment-speed-max',
'fd-reply-prob', 'fd-reply-speed-min', 'fd-reply-speed-max', 'fd-likeback-prob', 'fd-card-prob', 'fd-max-cards', 'fd-image-prob',
'fd-post-prob', 'fd-post-daily-max', 'fd-post-cool', 'fd-min-interval', 'fd-max-interval', 'fd-post-en',
'fd-min-cards-post', 'fd-max-cards-post', 'fd-post-kaomoji', 'fd-post-emoji', 'fd-post-sticker', 'fd-post-image'].forEach(k => {
try {
const v = s.get('reply-' + k);
if (v !== null && v !== undefined && v !== '') { const n = Number(v); if (!isNaN(n)) c[k] = n; }
} catch (e) {}
});
const num = (k, d) => c[k] !== undefined ? c[k] : d;
return {
likeProb: num('fd-like-prob', 60), likeSpeedMin: num('fd-like-speed-min', 1), likeSpeedMax: num('fd-like-speed-max', 60),
commentProb: num('fd-comment-prob', 70), commentSpeedMin: num('fd-comment-speed-min', 1), commentSpeedMax: num('fd-comment-speed-max', 60),
replyProb: num('fd-reply-prob', 60), replySpeedMin: num('fd-reply-speed-min', 1), replySpeedMax: num('fd-reply-speed-max', 60),
likeback: num('fd-likeback-prob', 50),
cardProb: num('fd-card-prob', 80), maxCards: num('fd-max-cards', 5),
imageProb: num('fd-image-prob', 50),
postEn: num('fd-post-en', 1),
postProb: num('fd-post-prob', 40), dailyMax: num('fd-post-daily-max', 5),
postCool: num('fd-post-cool', 30),
minInterval: num('fd-min-interval', 1), maxInterval: num('fd-max-interval', 720),
minCardsPost: num('fd-min-cards-post', 4), maxCardsPost: num('fd-max-cards-post', 15),
postKaomoji: num('fd-post-kaomoji', 10), postEmoji: num('fd-post-emoji', 10),
postSticker: num('fd-post-sticker', 30), postImage: num('fd-post-image', 30)
};
}
function feedCfg() {
return feedCfgFor(window.__activeCid || 'default');
}
function favFeedProbFor(cid) {
try {
const s = window.storeFor(cid);
const v = s.get('fav-ta-feed');
if (v === null || v === undefined || v === '') return 30;
const n = Number(v);
return isNaN(n) ? 30 : n;
} catch (e) { return 30; }
}
function feedToday() {
const d = new Date();
return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function notifyFeedPostToChat(cid, taName) {
const cur = window.__activeCid || 'default';
if (cid === cur) {
if (window.chatAddSystem) window.chatAddSystem(taName + ' 发布了一条朋友圈动态');
return;
}
if (window.chatAppendToDeskMsg) { window.chatAppendToDeskMsg(cid, taName + ' 发布了一条朋友圈动态'); }
}
function maybeAutoPostFor(cid) {
if (window.nightModeActive && window.nightModeActive()) return;
try {
const cs = window.storeFor(cid);
const now = Date.now();
const cfg = feedCfgFor(cid);
if (!cfg.postEn) return;
let last = parseInt(cs.get('feed-last'), 10); if (isNaN(last)) last = 0;
let next = parseFloat(cs.get('feed-next')); if (isNaN(next)) next = 0;
if (last > now || last < 0) { last = 0; next = 0; }
if ((now - last) / 60000 < next) return;
let dayCount = (function () { try { return JSON.parse(cs.get('feed-day-count') || '0'); } catch (e) { return 0; } })();
const today = feedToday();
if (dayCount.t !== today) dayCount = { t: today, n: 0 };
if (dayCount.n >= cfg.dailyMax) { cs.set('feed-next', String(cfg.postCool)); return; }
if (Math.random() * 100 >= cfg.postProb) {
cs.set('feed-next', String(cfg.minInterval + Math.random() * Math.max(1, cfg.maxInterval - cfg.minInterval)));
return;
}
const buildPost = function () {
const g = genPostContent(cfg, cid);
const taName = cs.get('lbl-partner') || 'TA';
const taAv = cs.get('avatar-partner') || '';
const list = load();
const post = { id: 'f_' + Date.now() + '_' + cid, role: 'ta', owner: cid, authorName: taName, authorAv: '', taName: taName, taAv: '', content: g.content, imgs: g.imgs, ts: Date.now(), likes: [], comments: [] };
list.unshift(post);
save(list);
cs.set('feed-last', String(now));
cs.set('feed-next', String(cfg.minInterval + Math.random() * Math.max(1, cfg.maxInterval - cfg.minInterval)));
cs.set('feed-day-count', JSON.stringify({ t: today, n: dayCount.n + 1 }));
notifyFeedPostToChat(cid, taName);
addNotice('post', post.id, taName + ' 发布了一条新动态', cid);
renderVisible();
};
poolReadyFor(cid, function () { try { buildPost(); } catch (eB) {} });
} catch (e) {}
}
function maybeAutoPost() {
const list = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
list.forEach(c => maybeAutoPostFor(c.id));
}
setTimeout(() => {
setInterval(maybeAutoPost, 60000);
maybeAutoPost();
}, (120 + Math.random() * 180) * 1000);
let feedAllCid = 'default';
let feedAllWho = 'ta';
function feedAllStore() { return window.storeFor(feedAllCid); }
function feedAllBg() {
const s = feedAllStore();
if (feedAllWho === 'me') {
const me = s.get('feed-cover-bg');
if (me) return safeBg(me, 'feed-cover-bg', s);
return safeBg(store.get('feed-cover-bg'), 'feed-cover-bg', store);
}
const ta = s.get('feed-ta-cover');
if (ta) return safeBg(ta, 'feed-ta-cover', s);
if (feedAllCid === 'default') return safeBg(store.get('feed-ta-cover'), 'feed-ta-cover', store);
return '';
}
function renderFeedAllCover() {
const cover = document.getElementById('feed-all-cover');
const avEl = document.getElementById('feed-all-av');
const nameEl = document.getElementById('feed-all-name');
if (!cover) return;
const bg = feedAllBg();
if (bg) { cover.style.backgroundImage = 'url("' + bg + '")'; cover.classList.add('has-bg'); }
else { cover.style.backgroundImage = ''; cover.classList.remove('has-bg'); }
armCoverLayer(cover, 'dev-feed-all-cover-tap', 'mochi-feed-cover-pick', !!bg);
if (feedAllWho === 'me') {
if (avEl) { const mav = feedUserAv(); avEl.innerHTML = mav ? '<img src="' + attrEsc(mav) + '" alt="">' : ''; }
if (nameEl) nameEl.textContent = feedUserName();
try { if (avEl && window.mochiFilePickSurface) window.mochiFilePickSurface(avEl, { id: 'feed-allav-tap', accept: 'image/*', owner: 'mochi-feed-allav-pick' }); } catch (e) {}
return;
}
const c = (window.getContacts && window.getContacts().find(x => x.id === feedAllCid)) || { name: feedAllCid };
if (avEl) {
const s = feedAllStore();
let av = s.get('feed-ta-avatar');
if (av) { av = safeBg(av, 'feed-ta-avatar', s); }
if (!av) { av = store.get('feed-ta-avatar'); av = safeBg(av, 'feed-ta-avatar', store); }
if (!av) av = s.get('avatar-partner') || '';
avEl.innerHTML = av ? '<img src="' + attrEsc(av) + '" alt="">' : '';
}
if (nameEl) nameEl.textContent = c.name || feedAllCid;
try { if (avEl && window.mochiFilePickSurface) window.mochiFilePickSurface(avEl, { id: 'feed-allav-tap', accept: 'image/*', owner: 'mochi-feed-allav-pick' }); } catch (e) {}
}
function postCardHtmlAll(p) {
const isMine = (p.role || p.by) === 'me';
const author = p.authorName || (isMine ? feedUserNameFor(p.owner || feedAllCid) : taFeedNameFor(p.owner || feedAllCid));
const av = p.authorAv || (isMine ? feedUserAvFor(p.owner || feedAllCid) : taAvFor(p.owner || feedAllCid));
const likes = p.likes && p.likes.length
? '<div class="feed-likes" style="font-size:11px;color:var(--muted);padding:6px 2px">' + esc(p.likes.join('、')) + ' 觉得很赞</div>'
: '';
const liked = p.likes && p.likes.some(l => l === feedUserName());
const faved = favFeedHas(p);
return '<div class="feed-post" id="feed-post-' + p.id + '"><div class="feed-head">' + avHtml(av) +
'<div class="feed-who"><div class="feed-name">' + esc(author) + '</div><div class="feed-time">' + fmtDT(p.ts) + '</div></div>' +
'<button class="feed-del" data-id="' + p.id + '" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/></svg></button></div>' +
'<div class="feed-content">' + contentHtmlFor(p) + '</div>' +
'<div class="feed-actions">' +
'<button class="feed-act' + (liked ? ' liked' : '') + '" data-like="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0112 6.4a5.3 5.3 0 019.3 5.6c-1.8 4.3-9.3 9-9.3 9z"/></svg>赞</button>' +
'<button class="feed-act" data-comment="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8z"/><circle cx="8.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/></svg>评论</button>' +
'<button class="feed-act" data-sticker="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 007 0"/><circle cx="9" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1" fill="currentColor" stroke="none"/></svg>贴纸</button>' +
'<button class="feed-act feed-fav' + (faved ? ' faved' : '') + '" data-fav="' + p.id + '"><svg viewBox="0 0 24 24" fill="' + (faved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/></svg>收藏</button>' +
'</div>' + likes +
commentsHtmlFor(p, author) + '</div>';
}
function renderFeedAll() {
const listEl = document.getElementById('feed-all-list');
if (!listEl) return;
const isMePage = feedAllWho === 'me';
const inPage = isMePage
? (p) => (p.role || p.by) === 'me'
: (p) => (p.owner || 'default') === feedAllCid && (p.role || p.by) !== 'me';
const title = document.getElementById('feed-all-title');
if (title) {
if (isMePage) title.textContent = '我的朋友圈';
else {
const c = (window.getContacts && window.getContacts().find(x => x.id === feedAllCid)) || { name: feedAllCid };
title.textContent = (c.name || feedAllCid) + ' 的全部朋友圈';
}
}
const posts = load().filter(inPage).sort((a, b) => b.ts - a.ts);
feedShownAll = Math.min(posts.length, FEED_RENDER_MAX);
const allCold = feedSyncCold || !!(window.mochiDataPending && window.mochiDataPending());
listEl.innerHTML = posts.length
? posts.slice(0, feedShownAll).map(p => postCardHtmlAll(p)).join('') +
(posts.length > feedShownAll ? feedMoreBtnHtml(posts.length - feedShownAll) : '')
: (allCold
? window.mochiLoadingHtml(isMePage ? '我的动态' : '该联系人的动态')
: '<div class="ta-empty">还没有动态</div>');
bindEvents(listEl);
renderFeedAllCover();
}
function openFeedAll(cid, who) {
hideCommentBar();
feedAllWho = who === 'me' ? 'me' : 'ta';
feedAllCid = feedAllWho === 'me' ? (window.__activeCid || 'default') : (cid || window.__activeCid || 'default');
renderFeedAll();
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const ap = document.getElementById('page-feed-all');
if (ap) ap.hidden = false;
}
const feedAllBack = document.getElementById('feed-all-back');
if (feedAllBack) {
feedAllBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
feedPage.hidden = false;
render();
});
}
const feedAllCover = document.getElementById('feed-all-cover');
const feedAllAv = document.getElementById('feed-all-av');
const feedAllName = document.getElementById('feed-all-name');
if (feedAllAv && window.mochiFilePickSurface) window.mochiFilePickSurface(feedAllAv, { id: 'feed-allav-tap', accept: 'image/*', owner: 'mochi-feed-allav-pick' });
if (feedAllCover) {
feedAllCover.addEventListener('click', (e) => {
if (feedAllAv && (e.target === feedAllAv || feedAllAv.contains(e.target))) return;
if (feedAllName && (e.target === feedAllName || feedAllName.contains(e.target))) return;
const key = feedAllWho === 'me' ? 'feed-cover-bg' : 'feed-ta-cover';
if (feedAllStore().get(key) || store.get(key)) {
if (window.openModal) {
window.openModal('已设置朋友圈背景', '', (v) => {
if (v === '1') pickCoverFile();
if (v === '2') { feedAllStore().set(key, ''); renderFeedAllCover(); toast('已恢复默认背景'); }
}, { noInput: true, pills: [{ label: '更换背景', value: '1' }, { label: '恢复默认', value: '2' }] });
}
} else {
pickCoverFile();
}
function pickCoverFile() {
window.mochiFilePick({
id: 'mochi-feed-cover-pick', accept: 'image/*',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到图片，请再选一次'); return; }
compressImage(f, (dataUrl) => {
if (!dataUrl) return;
feedAllStore().set(key, dataUrl);
renderFeedAllCover();
toast('朋友圈背景已更新');
});
}
});
}
});
}
if (feedAllAv) {
feedAllAv.addEventListener('click', (e) => {
e.stopPropagation();
const key = feedAllWho === 'me' ? 'feed-user-avatar' : 'feed-ta-avatar';
window.mochiFilePick({
id: 'mochi-feed-allav-pick', accept: 'image/*',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到图片，请再选一次'); return; }
if (!window.mochiImgIngest) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return; }
window.mochiImgIngest(f, { maxSide: 256, quality: 0.85, tag: 'feed-all-av' }).then((r) => {
if (!r || r.st !== 'ok') { toast(window.mochiImgIngestMiss(r, '头像')); return; }
feedAllStore().set(key, r.data);
renderFeedAllCover();
toast('头像已更新');
});
}
});
});
}
if (feedAllName) {
feedAllName.addEventListener('click', (e) => {
e.stopPropagation();
const key = feedAllWho === 'me' ? 'feed-user-name' : 'feed-ta-name';
const cur = feedAllStore().get(key) || store.get(key) || (feedAllWho === 'me'
? (feedAllStore().get('lbl-user') || '我')
: (feedAllStore().get('lbl-partner') || 'TA'));
if (window.openModal) {
window.openModal('修改昵称', cur, (v) => {
const val = (v || '').trim();
if (val) {
feedAllStore().set(key, val);
sweepFeedNameSnapshots(feedAllWho === 'me' ? 'me' : 'ta', feedAllCid, cur, val);
renderFeedAllCover();
rerenderFeedAfterRename();
toast('昵称已更新');
}
}, { maxlength: 12 });
}
});
}
function safeAvStr(v) { if (v && typeof v === 'string' && v.length > 500 * 1024) return ''; return v || ''; }
function avatarIconSvg() {
return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0116 0"/></svg>';
}
function pickAvatarAndSet(st, key) {
window.mochiFilePick({
id: 'mochi-feed-av-pick', accept: 'image/*',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到图片，请再选一次'); return; }
if (!window.mochiImgIngest) { toast('图片处理组件没加载上（缓存过旧或离线），请重新打开页面再试'); return; }
window.mochiImgIngest(f, { maxSide: 256, quality: 0.85, tag: 'feed-friend-av' }).then((r) => {
if (!r || r.st !== 'ok') { toast(window.mochiImgIngestMiss(r, '头像')); return; }
st.set(key, r.data);
renderFeedFriends();
toast('朋友圈头像已更新');
});
}
});
}
function ffRow(person) {
const avHtml = person.deskAv ? '<img src="' + attrEsc(person.deskAv) + '" alt="">' : avatarIconSvg();
const who = person.isMe ? '我（当前桌面）' : ('桌面：' + person.id);
return '<div class="ff-row" data-id="' + esc(person.id) + '" data-is-me="' + (person.isMe ? '1' : '0') + '">' +
'<div class="ff-row-top">' +
'<div class="ff-desktop-av">' + avHtml + '</div>' +
'<div class="ff-id"><div class="ff-desktop-name">' + esc(person.deskName) + '</div><div class="ff-tag">' + esc(who) + '</div></div>' +
'</div>' +
'<div class="ff-edit">' +
'<button class="ff-pill" data-act="avatar" data-key="' + person.avKey + '">' +
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
'<span class="ff-cur">朋友圈头像：' + esc(person.feedAv ? '已设置' : '未设置') + '</span>' +
'</button>' +
'<button class="ff-pill" data-act="name" data-key="' + person.nameKey + '">' +
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z"/></svg>' +
'<span class="ff-cur">朋友圈昵称：' + esc(person.feedName || '未设置') + '</span>' +
'</button>' +
'</div>' +
'</div>';
}
function renderFeedFriends() {
const el = document.getElementById('feed-friends-list');
if (!el) return;
const contacts = (window.getContacts && window.getContacts()) || [{ id: 'default' }];
const as = window.activeStore();
const activeCid = window.__activeCid || 'default';
let html = '<div class="ff-sec">我</div>' + ffRow({
id: activeCid, isMe: true,
deskName: as.get('lbl-user') || '我',
deskAv: as.get('avatar-user') || '',
feedName: as.get('feed-user-name'),
feedAv: safeAvStr(as.get('feed-user-avatar')),
nameKey: 'feed-user-name', avKey: 'feed-user-avatar'
});
html += '<div class="ff-sec">联系人</div>';
contacts.forEach(ct => {
const cid = ct && ct.id ? ct.id : 'default';
const st = window.storeFor(cid);
html += ffRow({
id: cid, isMe: false,
deskName: st.get('lbl-partner') || (ct.name || cid),
deskAv: st.get('avatar-partner') || '',
feedName: st.get('feed-ta-name'),
feedAv: safeAvStr(st.get('feed-ta-avatar')),
nameKey: 'feed-ta-name', avKey: 'feed-ta-avatar'
});
});
el.innerHTML = html;
}
function openFeedFriends() {
const np = document.getElementById('feed-notice-panel'); if (np) np.hidden = true;
renderFeedFriends();
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const fp = document.getElementById('page-feed-friends');
if (fp) fp.hidden = false;
}
const feedFriendsBtn = document.getElementById('feed-friends-btn');
if (feedFriendsBtn) feedFriendsBtn.addEventListener('click', (e) => { e.stopPropagation(); openFeedFriends(); });
const feedFriendsBack = document.getElementById('feed-friends-back');
if (feedFriendsBack) feedFriendsBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const pageFeed = document.getElementById('page-feed');
if (pageFeed) pageFeed.hidden = false;
render();
});
const ffList = document.getElementById('feed-friends-list');
if (ffList) {
ffList.addEventListener('click', (e) => {
const pill = e.target.closest('.ff-pill');
if (!pill) return;
const row = pill.closest('.ff-row');
if (!row) return;
const cid = row.dataset.id;
const isMe = row.dataset.isMe === '1';
const st = isMe ? window.activeStore() : window.storeFor(cid);
const key = pill.dataset.key;
if (pill.dataset.act === 'avatar') {
pickAvatarAndSet(st, key);
} else if (window.openModal) {
const def = isMe ? (st.get('lbl-user') || '我') : (st.get('lbl-partner') || 'TA');
const cur = st.get(key) || def;
window.openModal('修改朋友圈昵称', cur, (v) => {
const val = (v || '').trim();
if (val) {
st.set(key, val);
sweepFeedNameSnapshots(isMe ? 'me' : 'ta', cid, cur, val);
rerenderFeedAfterRename();
toast('朋友圈昵称已更新');
}
}, { maxlength: 12 });
}
});
}
const feedApp = document.querySelector('.app[data-app="feed"]');
const feedPage = document.getElementById('page-feed');
if (feedApp && feedPage) {
feedApp.addEventListener('click', () => {
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) return;
openFeedPage();
});
}
const noticeBtn = document.getElementById('feed-notice-btn');
const noticePanel = document.getElementById('feed-notice-panel');
if (noticeBtn && noticePanel) {
noticeBtn.addEventListener('click', (e) => {
e.stopPropagation();
noticePanel.hidden = !noticePanel.hidden;
if (!noticePanel.hidden) {
const list = notices();
let dirty = false;
list.forEach(n => { if (!n.read) { n.read = true; dirty = true; } });
if (dirty) saveNotices(list);
renderNotices();
renderNoticeBadge();
}
});
document.addEventListener('click', (e) => {
if (!noticePanel.hidden && !noticePanel.contains(e.target) && !noticeBtn.contains(e.target)) {
noticePanel.hidden = true;
}
});
}
const feedBack = document.getElementById('feed-back');
if (feedBack) feedBack.addEventListener('click', () => {
const cb = document.getElementById('feed-comment-bar');
if (cb) cb.hidden = true;
const np = document.getElementById('feed-notice-panel');
if (np) np.hidden = true;
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const phone = document.getElementById('page-phone');
if (phone) phone.hidden = false;
});
const feedPubBtn = document.getElementById('feed-publish-btn');
const feedPubCard = document.getElementById('feed-publish-card');
if (feedPubBtn && feedPubCard) {
feedPubBtn.addEventListener('click', (e) => {
e.stopPropagation();
feedPubCard.hidden = !feedPubCard.hidden;
if (!feedPubCard.hidden) {
const fi = document.getElementById('feed-input');
if (fi) setTimeout(() => fi.focus(), 60);
feedPubCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
});
}
const pubBtn = document.getElementById('feed-publish');
if (pubBtn) pubBtn.addEventListener('click', publish);
const feedClearAll = document.getElementById('feed-clear-all');
if (feedClearAll) {
feedClearAll.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('清除所有朋友圈数据？', '', () => {
save([]);
saveNotices([]);
try { store.set('feed-app-unread', '0'); } catch (e) {}
hideCommentBar();
renderNoticeBadge();
render();
const np = document.getElementById('feed-notice-panel');
if (np && !np.hidden) renderNotices();
toast('朋友圈数据已全部清除');
}, { noInput: true, staticText: '将删除全部动态（我的与 TA 的）、评论、点赞和通知提醒，且无法恢复。确定继续吗？' });
});
}
const feedHeadClear = document.getElementById('feed-head-clear');
if (feedHeadClear) {
feedHeadClear.addEventListener('click', (e) => {
e.stopPropagation();
if (!window.openModal) return;
window.openModal('删除朋友圈动态', '', (v) => {
const mode = v || 'all';
const mine = (p) => (p.role || p.by) === 'me';
const keep = load().filter(p => mode === 'mine' ? !mine(p) : (mode === 'ta' ? mine(p) : false));
save(keep);
if (mode === 'all') {
saveNotices([]);
try { store.set('feed-app-unread', '0'); } catch (e) {}
}
hideCommentBar();
renderNoticeBadge();
render();
toast(mode === 'all' ? '朋友圈动态已全部删除' : (mode === 'mine' ? '我的动态已全部删除' : '联系人的动态已全部删除'));
}, { noInput: true, staticText: '删除后无法恢复。', pill: 'all', pills: [
{ label: '全部删除', value: 'all' },
{ label: '仅我的动态', value: 'mine' },
{ label: '仅联系人的动态', value: 'ta' }
] });
});
}
render();
function feedMergeFromIdb(v) {
try {
const pending = feedPending || [];
let base = [];
const authOk = !!(v && typeof v === 'string' && v.length > 2);
if (authOk) {
feedAuthSeen = true;
const idbArr = JSON.parse(v);
if (Array.isArray(idbArr)) base = idbArr.map(normPost);
}
let cur = [];
let curFromSnap = false;
const raw = store.get(KEY);
if (raw !== null) { try { const a = JSON.parse(raw); if (Array.isArray(a)) cur = a.map(normPost); } catch (e) {} }
if (!cur.length) { const sn = loadSnap(); if (sn.length) { curFromSnap = true; cur = sn.map(normPost); } }
const merged = mergePosts(base, mergePosts(cur, pending));
if (!merged.length) { if (authOk && feedPending === pending) feedPending = null; return; }
const degraded = !authOk && curFromSnap;
if (!degraded) feedMem = merged;
if (!degraded && feedWritePending) feedWritePending = merged;
if (!degraded) scheduleFeedTokPass(2500);
feedGuardWrite(JSON.stringify(merged)).then(written => {
if (written) {
if (feedPending === pending) feedPending = null;
return;
}
if (feedPending === null) feedPending = pending;
else if (feedPending !== pending) feedPending = mergePosts(pending, feedPending);
if (feedAuthRetried >= 2 || !window.idbGet) return;
feedAuthRetried++;
setTimeout(function () {
window.idbGet(uid + ':' + KEY).then(v2 => {
feedMergeFromIdb(v2);
if (v2 && typeof v2 === 'string' && v2.length > 2) render();
});
}, 10000);
});
} catch (e) { /* 解析失败仍置就绪，避免下次启动重复合并 */ }
}
try {
if (window.idbGet) {
window.idbGet(uid + ':' + KEY).then(v => {
feedMergeFromIdb(v);
feedDbReady = true;
render();
});
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':feed-ta-cover').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2 && !window.activeStore().get('feed-ta-cover')) {
window.activeStore().set('feed-ta-cover', v);
renderCover();
renderFeedAllCover();
}
});
window.idbGet(myPrefix + ':feed-cover-bg').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2 && !window.activeStore().get('feed-cover-bg')) {
window.activeStore().set('feed-cover-bg', v);
renderCover();
}
});
window.idbGet(myPrefix + ':avatar-user').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2 && !window.activeStore().get('avatar-user')) {
window.activeStore().set('avatar-user', v);
renderCover();
}
});
window.idbGet(myPrefix + ':feed-ta-avatar').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2 && !window.activeStore().get('feed-ta-avatar')) {
window.activeStore().set('feed-ta-avatar', v);
renderCover();
}
});
}
} catch (e) { feedDbReady = true; }
setTimeout(function () {
if (feedDbReady) return;
try { const all = load(); if (all.length) feedGuardWrite(JSON.stringify(all)); } catch (e) {}
feedDbReady = true;
render();
}, 15000);
document.addEventListener('contact-switched', function () {
try { renderCover(); } catch (e) {}
try { renderFeedAllCover(); } catch (e) {}
});
renderNoticeBadge();
window.feedPoolFor = function (cid) {
try {
const p = cardPool(cid);
return { textN: p.text.length, kaoN: p.kaomoji.length, emojiN: p.emoji.length, stickerN: (p.sticker || []).length, imageN: (p.image || []).length };
} catch (e) { return null; }
};
window.feedPoolHas = function (cid, s) {
try {
const p = cardPool(cid);
return { text: p.text.indexOf(s) >= 0, kaomoji: p.kaomoji.indexOf(s) >= 0, emoji: p.emoji.indexOf(s) >= 0 };
} catch (e) { return null; }
};
window.feedGenProbe = function (cid) {
try {
const g = genPostContent(feedCfgFor(cid), cid);
return { content: String(g.content || ''), imgN: (g.imgs || []).length };
} catch (e) { return null; }
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("feed.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("feed.js"); try { console.error("[JS] feed.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[feed.js] " + String(__e && __e.message || __e)); } })();
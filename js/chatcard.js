(function () { try {
(function () {
const list = document.getElementById('cc-list');
const tabsWrap = document.getElementById('cc-tabs');
const groupsBar = document.getElementById('cc-groups-bar');
if (!list || !tabsWrap) return;
const uid = window.activePrefix();
const store = window.activeStore();
const PUB_PREFIX = 'xy-home-v2';
const PUB_KEY = 'cc-groups-public';
let ccScope = 'own'; // 当前管理页打开的作用域：'own'=专属 | 'public'=公用
function pubStore() { return window.xyStore(PUB_PREFIX); }
function curStore() { return ccScope === 'public' ? pubStore() : store; }
function curKey() { return ccScope === 'public' ? PUB_KEY : 'cc-groups'; }
const PUB_OFF_KEY = 'cc-groups-public-off';
const OFF_KEY = 'cc-groups-off';
let offCache = null; // 当前桌面专属停用集合缓存（切联系人失效）
let pubOffCache = null; // 公用停用集合缓存
function offStore(scope) { return scope === 'public' ? pubStore() : store; }
function offKey(scope) { return scope === 'public' ? PUB_OFF_KEY : OFF_KEY; }
function offLoad(scope) {
const c = scope === 'public' ? pubOffCache : offCache;
if (c) return c;
let o = {};
try {
const v = offStore(scope).get(offKey(scope));
if (v) { const p = JSON.parse(v); if (p && typeof p === 'object') o = p; }
} catch (e) {}
if (scope === 'public') pubOffCache = o; else offCache = o;
return o;
}
function offSave(scope, o) {
try { offStore(scope).set(offKey(scope), JSON.stringify(o)); } catch (e) {}
if (scope === 'public') pubOffCache = o; else offCache = o;
}
function offInvalidate() { offCache = null; pubOffCache = null; }
function isGroupOff(scope, type, gname) {
try { const o = offLoad(scope); return !!(o[type] && o[type].indexOf(gname) >= 0); } catch (e) { return false; }
}
function toggleGroupOff(type, gname) {
const scope = ccScope === 'public' ? 'public' : 'own';
const o = offLoad(scope);
if (!o[type] || !Array.isArray(o[type])) o[type] = [];
const i = o[type].indexOf(gname);
const nowOff = i < 0;
if (nowOff) o[type].push(gname); else o[type].splice(i, 1);
if (!o[type].length) delete o[type];
offSave(scope, o);
return nowOff;
}
function filterGroupsByOff(g, scope) {
try {
const o = offLoad(scope);
let has = false;
for (const t in o) { if ((o[t] || []).length) { has = true; break; } }
if (!has) return g;
const out = {};
Object.keys(g).forEach(t => {
const offs = o[t] || [];
out[t] = (g[t] || []).filter(grp => offs.indexOf(grp[0]) < 0);
});
return out;
} catch (e) { return g; }
}
let pubCache = null;
function pubInvalidate() { pubCache = null; ownPoolCache = null; }
const CC_MEDIA_TOKEN_THRESHOLD = 64 * 1024;
let ccTokRun = 0;
const ccTokGen = { pub: 0, own: 0 };
const ccTokMemo = new Map();
let ccTokMemoChars = 0;
const CC_TOK_MEMO_MAX_CHARS = 8 * 1024 * 1024;
const ccTokMemoRev = new Map();
function ccMediaFrag(body) { return 'M' + body.length + ':' + body.slice(8, 48); }
function ccTokenizeGiantMedia(g, slot) {
if (!window.mochiMediaTokenize) return;
const jobs = [];
['sticker', 'image'].forEach(function (t) {
(g[t] || []).forEach(function (grp) {
if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
grp[1].forEach(function (card, i) {
if (typeof card !== 'string' || card.indexOf('@@m:') >= 0) return;
const bar = card.indexOf('|||');
const body = bar >= 0 ? card.slice(bar + 3) : card;
if (body.length < CC_MEDIA_TOKEN_THRESHOLD || body.indexOf('data:image/') !== 0) return;
jobs.push({ grp: grp, i: i, card: card, bar: bar, body: body });
});
});
});
if (!jobs.length) return;
const sl = slot === 'own' ? 'own' : 'pub';
const gen = ++ccTokGen[sl];
(async function () {
for (let k = 0; k < jobs.length; k++) {
if (gen !== ccTokGen[sl]) return; // 本库缓存已重建/失效，本次 pass 作废（memo 让重跑便宜）
const j = jobs[k];
let tok = ccTokMemo.get(j.body);
if (!tok) {
try { tok = await window.mochiMediaTokenize(j.body, { noCache: true }); } catch (e) { tok = null; }
if (gen !== ccTokGen[sl]) return;
if (tok) {
ccTokMemo.set(j.body, tok); ccTokMemoChars += j.body.length;
ccTokMemoRev.set(tok, ccMediaFrag(j.body)); // #547：token→短指纹，供 ccMediaCardIdent 令牌化前后同身份
while (ccTokMemoChars > CC_TOK_MEMO_MAX_CHARS && ccTokMemo.size) {
const fk = ccTokMemo.keys().next().value;
ccTokMemoChars -= fk.length; ccTokMemo.delete(fk);
}
}
}
await new Promise(function (r) { setTimeout(r, 0); }); // 每张之间让出主线程，UI 可交互
if (gen !== ccTokGen[sl]) return;
if (!tok || j.grp[1][j.i] !== j.card) continue; // 身份守卫：卡原文已变则不覆盖
j.grp[1][j.i] = j.bar >= 0 ? (j.card.slice(0, j.bar + 3) + tok) : tok;
}
})();
}
function pubGroupsRaw() {
if (!pubCache) {
pubCache = buildGroupsFrom(pubStore().get(PUB_KEY));
const _vhp = sanitizeVoiceGroups(pubCache);
if (_vhp.fixed || _vhp.removed) {
try { pubStore().set(PUB_KEY, JSON.stringify(pubCache)); } catch (e) {}
notifyVoiceHeal(_vhp.fixed, _vhp.removed);
}
ccTokenizeGiantMedia(pubCache, 'pub');
}
return pubCache;
}
let ownPoolCache = null;
function ownPoolRaw() {
if (!ownPoolCache) {
ownPoolCache = buildGroupsFrom(store.get('cc-groups'));
ccTokenizeGiantMedia(ownPoolCache, 'own');
}
return ownPoolCache;
}
const CC_TYPES = ['text', 'kaomoji', 'emoji', 'sticker', 'image', 'poke', 'voice', 'status'];
const CC_FUNC_KEYS = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music',
'mjfree']; // #317 梦角自由造句：程序生成的重造句卡（dream-free.js），管理页可查看/删除，不进聊天通用池
const CC_ALL_TYPES = CC_TYPES.concat(CC_FUNC_KEYS);
const CC_FUN_COUNT_KEYS = CC_FUNC_KEYS.filter(k => k !== 'mjfree');
const CC_GIF_MAX_B64 = 512 * 1024;
const CC_CC_TOK_MIN = 4096;
function mergeWithPublic(g) {
const p = pubGroupsRaw();
let has = false;
for (let i = 0; i < CC_ALL_TYPES.length; i++) { if ((p[CC_ALL_TYPES[i]] || []).length) { has = true; break; } }
if (!has) return g;
const out = {};
CC_ALL_TYPES.forEach(t => { out[t] = (g[t] || []).concat(p[t] || []); });
Object.keys(g).forEach(t => { if (!(t in out)) out[t] = g[t]; });
return out;
}
function mergeFiltered(own, pub) {
const ownF = filterGroupsByOff(own, 'own');
const pubF = filterGroupsByOff(pub, 'public');
let hasPub = false;
for (let i = 0; i < CC_ALL_TYPES.length; i++) { if ((pubF[CC_ALL_TYPES[i]] || []).length) { hasPub = true; break; } }
if (!hasPub) return ownF;
const out = {};
CC_ALL_TYPES.forEach(t => { out[t] = (ownF[t] || []).concat(pubF[t] || []); });
Object.keys(ownF).forEach(t => { if (!(t in out)) out[t] = ownF[t]; });
return out;
}
function replyPoolGroups() { return mergeFiltered(ownPoolRaw(), pubGroupsRaw()); }
function replyPoolGroupsFor(cid) {
const raw = (window.storeFor && window.storeFor(cid) || window.xyStore('xy-home-v2:' + cid)).get('cc-groups');
return mergeFiltered(buildGroupsFrom(raw), pubGroupsRaw());
}
const BUILTIN = {
text: [
['日常回应', ['哈哈哈哈哈', '好的好的，收到', '嗯嗯，我在听', '笑死我了', '我支持你', '今天也要开心呀', '没事的，别担心', '想你了']],
['晚安问候', ['晚安，做个好梦', '早点休息呀', '明天见啦', '睡个好觉']]
],
kaomoji: [
['开心', ['(｡♥‿♥｡)', '(◕‿◕)', '(￣▽￣)~*', 'ᕙ(⇀‸↼‶)ᕗ']],
['日常', ['(¬‿¬)', '( ´･･)ﾉ(._.`)', '(ಥ_ಥ)', '(⊙_☉)', '(づ｡◕‿‿◕｡)づ']]
],
emoji: [
['常用', ['😂', '🥰', '😭', '😡', '😳', '🤔', '😴', '🤗', '😘', '🙄']]
],
sticker: [],
image: [],
poke: [
['互动', ['戳一戳', '拍了拍你', '戳了戳你的脸蛋']]
],
voice: []
};
const MEDIA_TYPES = { sticker: '表情包', image: '图片', voice: '语音' };
function audioMimeFromName(name) {
const ext = (name || '').split('.').pop().toLowerCase();
const map = {
mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
ogg: 'audio/ogg', ogx: 'application/ogg', aac: 'audio/aac', amr: 'audio/amr',
flac: 'audio/flac', webm: 'audio/webm', opus: 'audio/ogg', caf: 'audio/x-caf'
};
return map[ext] || '';
}
function normalizeAudioDataURL(dataURL, file) {
if (!dataURL) return dataURL;
const m = /^data:([^;,]*);/.exec(dataURL);
const mime = m ? m[1] : '';
if (mime && mime.indexOf('audio/') === 0) return dataURL; // 已是有效音频 MIME
const comma = dataURL.indexOf(',');
const payload = comma >= 0 ? dataURL.slice(comma + 1) : dataURL;
const extMime = audioMimeFromName(file && file.name) || (file && file.type) || 'audio/mpeg';
return 'data:' + extMime + ';base64,' + payload;
}
const IMG_TYPES = MEDIA_TYPES;
function pickFiles(accept, multiple, onFiles) {
window.mochiFilePick({
id: 'cc-file-pick', accept: accept || '', multiple: !!multiple,
onFiles: (files) => { if (onFiles) onFiles(files); }
});
}
function stripBuiltins(groups) {
let changed = false;
Object.keys(BUILTIN).forEach(cat => {
const gs = groups[cat];
if (!Array.isArray(gs)) return;
BUILTIN[cat].forEach(([gname, arr]) => {
const g = gs.find(x => x[0] === gname);
if (!g || !Array.isArray(g[1])) return;
const before = g[1].length;
g[1] = g[1].filter(c => arr.indexOf(c) < 0);
if (g[1].length !== before) changed = true;
});
const before = gs.length;
groups[cat] = gs.filter(g => Array.isArray(g[1]) && g[1].length);
if (groups[cat].length !== before) changed = true;
});
return changed;
}
const AUDIO_EXT_MIME = {
mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
amr: 'audio/amr', wma: 'audio/x-ms-wma', mid: 'audio/midi', midi: 'audio/midi',
weba: 'audio/webm', caf: 'audio/x-caf'
};
let voiceHealToasted = false;
function notifyVoiceHeal(fixed, removed) {
if (voiceHealToasted || (!fixed && !removed)) return;
voiceHealToasted = true;
const msg = [];
if (fixed) msg.push('修复 ' + fixed + ' 条语音格式');
if (removed) msg.push('清理 ' + removed + ' 条无法播放的视频/坏语音');
try { toast('已自动' + msg.join('，')); } catch (e) {}
}
function sanitizeVoiceGroups(groups) {
let fixed = 0, removed = 0;
const gs = groups && Array.isArray(groups.voice) ? groups.voice : [];
gs.forEach(g => {
if (!Array.isArray(g) || !Array.isArray(g[1])) return;
const kept = [];
g[1].forEach(c => {
if (typeof c !== 'string') { kept.push(c); return; }
const sep = c.indexOf('|||');
if (sep <= 0) { kept.push(c); return; } // 非语音格式（普通文字含 ||| 的不算）
const name = c.slice(0, sep);
let d = c.slice(sep + 3);
if (d.indexOf('data:') !== 0) { kept.push(c); return; }
const m = /^data:([^,;]*)/.exec(d);
const mime = m ? m[1] : '';
if (mime.indexOf('audio/') === 0) { kept.push(c); return; } // 健康
if (mime === '') {
const ext = (name.split('.').pop() || '').toLowerCase();
const good = AUDIO_EXT_MIME[ext];
if (good) {
kept.push(name + '|||' + 'data:' + good + d.slice(5));
fixed++;
return;
}
}
removed++; // video/*、image/*、未知类型——播放空白/报错的元凶
});
g[1] = kept;
});
return { fixed, removed };
}
function loadGroups() {
try {
const saved = JSON.parse(curStore().get(curKey()) || 'null');
if (saved && saved.text) {
if (saved.voice) {
let changed = false;
saved.voice.forEach(g => {
if (!Array.isArray(g) || !Array.isArray(g[1])) return;
const before = g[1].length;
g[1] = g[1].filter(c => c !== '语音1' && c !== '语音2');
if (g[1].length !== before) changed = true;
});
saved.voice = saved.voice.filter(g => Array.isArray(g) && Array.isArray(g[1]) && g[1].length);
if (changed) { try { curStore().set(curKey(), JSON.stringify(saved)); } catch (e) {} }
}
if (stripBuiltins(saved)) { try { curStore().set(curKey(), JSON.stringify(saved)); } catch (e) {} }
const _vh = sanitizeVoiceGroups(saved);
if (_vh.fixed || _vh.removed) {
try { curStore().set(curKey(), JSON.stringify(saved)); } catch (e) {}
notifyVoiceHeal(_vh.fixed, _vh.removed);
}
return saved;
}
} catch (e) {}
return { text: [], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
}
let ownRestoreResolve = null;
const ownRestoreP = new Promise(res => { ownRestoreResolve = res; });
(function () {
if (!window.idbGet) { ownRestoreResolve(); return; }
const myPrefix = window.activePrefix();
const MAX_RETRY = 3;
const cardCount = (g) => {
let n = 0;
try { Object.keys(g).forEach(t => (g[t] || []).forEach(x => n += (Array.isArray(x[1]) ? x[1].length : 0))); } catch (e) {}
return n;
};
function applyRestored(lsKey, st, data) {
stripBuiltins(data);
st.set(lsKey, JSON.stringify(data));
pubInvalidate();
ccAuthMark(lsKey === PUB_KEY ? 'public' : 'own'); // v3.26.x #193：权威库已进内存，写路径放行
if (lsKey === 'cc-groups' && ccScope === 'own' && window.activePrefix() === myPrefix) {
groups = data;
try { renderGroupsBar(); render(); } catch (e) {}
} else if (lsKey === PUB_KEY && ccScope === 'public') {
groups = data;
try { renderGroupsBar(); render(); } catch (e) {}
} else if (lsKey === 'cc-groups' && window.activePrefix() !== myPrefix) {
}
refreshLibCounts(true);
}
function attempt(idbFullKey, lsKey, st, isOwn, state) {
window.idbGet(idbFullKey).then(v => {
if (isOwn && window.activePrefix() !== myPrefix) { ownRestoreResolve(); return; }
if (v === undefined || v === null) {
if (state.retry < MAX_RETRY) { state.retry++; setTimeout(() => attempt(idbFullKey, lsKey, st, isOwn, state), 800 * state.retry); return; }
if (isOwn) ownRestoreResolve();
return;
}
let deferredNow = false;
try { deferredNow = Array.isArray(window.__xyIdbDeferredKeys) && window.__xyIdbDeferredKeys.indexOf(idbFullKey) >= 0; } catch (e0) {}
if (deferredNow) { if (isOwn) ownRestoreResolve(); return; }
try {
const data = typeof v === 'string' ? JSON.parse(v) : v;
if (data && data.text) {
if (idbFullKey === curFullKey()) ccAuthMark();
let localData = null;
try { localData = JSON.parse(st.get(lsKey) || 'null'); } catch (e) {}
const localCount = localData && localData.text ? cardCount(localData) : -1;
if (localCount < 0 || cardCount(data) > localCount) applyRestored(lsKey, st, data);
}
} catch (e) {}
if (isOwn) ownRestoreResolve();
}).catch(() => { if (isOwn) ownRestoreResolve(); });
}
function kick() {
attempt(myPrefix + ':cc-groups', 'cc-groups', store, true, { retry: 0 });
attempt(PUB_PREFIX + ':' + PUB_KEY, PUB_KEY, pubStore(), false, { retry: 0 });
}
if (window.__mochiDataReady) kick();
else {
try {
document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
setTimeout(kick, 0);
});
} catch (e) { kick(); }
}
})();
const ccAuthSeen = { public: false, own: false };
function ccAuthMark(scope) { try { ccAuthSeen[scope || ccScope] = true; } catch (e) {} }
function curFullKey() {
return ccScope === 'public' ? (PUB_PREFIX + ':' + PUB_KEY) : (window.activePrefix() + ':cc-groups');
}
function saveGroups(groups) {
if (!groups) { ccDirty = false; return; }
if (window.xyBigWriteBlocked(curStore(), curKey(), '字卡库')) { ccDirty = true; return; }
if (!ccAuthSeen[ccScope] && window.idbHasKey) {
ccDirty = true;
rescueCcOverwrite();
return;
}
saveGroupsNow(groups);
}
let ccDurableTimer = null;
let ccDurablePending = false;
let ccDurableWarned = false;
function ccEnsureDurable(tries, jsonPre) {
if (!window.idbSet) return;
clearTimeout(ccDurableTimer);
let json = '';
try { json = typeof jsonPre === 'string' ? jsonPre : (groups ? JSON.stringify(groups) : ''); } catch (e0) { return; }
if (!json || json === 'null') return;
window.idbSet(curFullKey(), json).then(ok => {
if (ok) { ccDurablePending = false; ccDurableWarned = false; return; }
ccDurablePending = true;
if (tries < 5) { ccDurableTimer = setTimeout(function () { ccEnsureDurable(tries + 1); }, 1500 * (tries + 1)); return; }
if (!ccDurableWarned) {
ccDurableWarned = true;
try { toast('字卡库暂时没能写入本机存储，稍后回到本页会自动补写；重要字卡请尽快导出备份'); } catch (e1) {}
}
});
}
function saveGroupsNow(groups) {
const ccJson = JSON.stringify(groups);
curStore().set(curKey(), ccJson);
if (ccJson.length > 200 * 1024) ccEnsureDurable(0); // #434：大值 IDB-only，确认落盘
pubInvalidate();
refreshLibCounts(true);
ccDirty = false; // 本次待写已落盘（LS 同步 + IDB 异步发起）
}
function mergeCcGroupsInto(auth, mem) {
Object.keys(mem || {}).forEach(t => {
if (!Array.isArray(auth[t])) auth[t] = [];
(mem[t] || []).forEach(pair => {
const name = pair[0], cards = pair[1] || [];
let g = auth[t].find(p => p[0] === name);
if (!g) { g = [name, []]; auth[t].push(g); }
const have = new Set(g[1]);
cards.forEach(c => { if (!have.has(c)) { g[1].push(c); have.add(c); } });
const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
const memU = uniq(cards);
if (memU.length === cards.length && uniq(g[1]).length === g[1].length) {
const shared = memU.filter(c => g[1].indexOf(c) >= 0);
if (shared.length > 1) {
let k = 0;
for (let i = 0; i < g[1].length; i++) if (shared.indexOf(g[1][i]) >= 0) g[1][i] = shared[k++];
}
}
});
});
return auth;
}
let ccRescueInflight = null;
function rescueCcOverwrite() {
if (ccRescueInflight) return;
const mem = groups; // hydrateCurScope 落定后会用权威库重载 groups，先保住内存增量
ccRescueInflight = Promise.resolve(window.idbHasKey(curFullKey())).then(exists => {
if (exists === false) { ccAuthMark(); saveGroupsNow(groups); return null; }
return hydrateCurScope().then(() => {
if (window.xyBigWriteHold(curStore(), curKey())) { ccDirty = true; return null; }
groups = mergeCcGroupsInto(loadGroups(), mem);
ccAuthMark();
saveGroupsNow(groups);
try { renderGroupsBar(); render(); } catch (e0) {}
return null;
});
}).catch(() => {
return null;
}).then(() => { ccRescueInflight = null; });
}
let groups = null;
function ccPageOpen() {
const p = document.getElementById('page-custom-cards');
return !!p && !p.hidden;
}
let cur = 'text';
let q = '';
let curGroup = ''; // '' = 全部
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) {
t = document.createElement('div');
t.id = 'cc-toast';
document.body.appendChild(t);
}
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
}
function viewImage(src) {
let mask = document.getElementById('img-view-mask');
if (!mask) {
mask = document.createElement('div');
mask.id = 'img-view-mask';
mask.className = 'img-view-mask';
mask.innerHTML = '<img class="img-view-img" alt="大图">';
mask.addEventListener('click', () => { mask.hidden = true; });
document.body.appendChild(mask);
}
mask.querySelector('.img-view-img').src = src;
mask.hidden = false;
}
window.viewChatImage = viewImage;
function totalCount(g) {
let n = 0;
Object.keys(g).forEach(t => g[t].forEach(grp => n += grp[1].length));
return n;
}
window.cardLockCustomCount = function () {
try { return totalCount(ownPoolRaw()) + totalCount(pubGroupsRaw()); }
catch (e) { return 0; }
};
function compressImage(src, maxSide, format, quality) {
if (!window.mochiImgCompressTo) return Promise.resolve(null);
const mime = format === 'image/jpeg' ? 'image/jpeg' : 'image/png';
return window.mochiImgCompressTo(src, {
maxSide: maxSide, mime: mime, quality: quality, opaque: mime === 'image/jpeg', tag: 'cc-img'
});
}
function renderGroupsBar() {
if (!groups) return;
if (!groupsBar) return;
groupsBar.innerHTML = '';
const grps = groups[cur] || [];
const allCount = grps.reduce((s, g) => s + (Array.isArray(g[1]) ? g[1].length : 0), 0);
const chips = [['', '全部', allCount]].concat(grps.map(g => [g[0], g[0], Array.isArray(g[1]) ? g[1].length : 0]));
chips.forEach(([val, label, n]) => {
const c = document.createElement('span');
c.className = 'cc-g-chip' + (curGroup === val ? ' sel' : '');
c.textContent = label + ' (' + n + ')';
c.addEventListener('click', () => {
curGroup = val;
if (manageMode) { selected.clear(); updateCount(); }
renderGroupsBar();
render();
});
groupsBar.appendChild(c);
});
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
const ICON_EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><path d="M14.12 14.12a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
function ccOffScope() { return ccScope === 'public' ? 'public' : 'own'; }
const PUB_NAME_KEY = 'cc-media-names-public';
const NAME_KEY = 'cc-media-names';
let nameCache = {};
function nameStore(scope) { return scope === 'public' ? pubStore() : store; }
function nameKey(scope) { return scope === 'public' ? PUB_NAME_KEY : NAME_KEY; }
function namesFor(scope) {
const k = scope === 'public' ? 'public' : 'own';
if (!nameCache[k]) {
let o = null;
try { const v = nameStore(k).get(nameKey(k)); o = v ? JSON.parse(v) : null; } catch (e) {}
nameCache[k] = (o && typeof o === 'object') ? o : {};
}
return nameCache[k];
}
function namesInvalidate() { nameCache = {}; }
function ccCardName(c) {
try { return namesFor(ccOffScope())[ccPoolKey(c)] || ''; } catch (e) { return ''; }
}
function ccCardNameAny(c) {
try {
const k = ccPoolKey(c);
return namesFor('own')[k] || namesFor('public')[k] || '';
} catch (e) { return ''; }
}
function ccSetCardName(c, name) {
const scope = ccOffScope();
const map = namesFor(scope);
const k = ccPoolKey(c);
const v = String(name == null ? '' : name).trim();
if (v) map[k] = v; else delete map[k];
try { nameStore(scope).set(nameKey(scope), JSON.stringify(map)); } catch (e) {}
}
function ccEditCardName(c) {
if (!window.openModal) return;
const old = ccCardName(c);
window.openModal('编辑图片名称', old, (v) => {
const val = String(v == null ? '' : v).trim();
ccSetCardName(c, val);
if (q) render(); else updateCardDomName(c);
toast(val ? '名称已保存：' + val : '已清除名称');
}, { placeholder: '给这张图起个名字，之后可搜索；留空＝不参与搜索' });
}
function updateCardDomName(c) {
try {
const sig = ccPoolKey(c);
list.querySelectorAll('.cc-item').forEach(el => {
if (el.dataset.ccSig !== sig) return;
const nm = ccCardName(c);
const cap = el.querySelector('.cc-name-cap');
if (nm) {
if (cap) cap.textContent = nm;
else { const d = document.createElement('div'); d.className = 'cc-name-cap'; d.style.cssText = CC_NAME_CAP_CSS; d.textContent = nm; el.appendChild(d); }
} else if (cap) cap.remove();
const b = el.querySelector('.cc-name-edit');
if (b) b.textContent = nm ? '改' : '＋';
});
} catch (e) {}
}
const CC_NAME_CAP_CSS = 'position:absolute;left:4px;right:4px;bottom:4px;padding:2px 6px;border-radius:8px;'
+ 'background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;'
+ 'text-overflow:ellipsis;pointer-events:none;';
const CC_NAME_BTN_CSS = 'position:absolute;right:4px;top:4px;width:22px;height:22px;padding:0;border:0;border-radius:50%;'
+ 'background:rgba(0,0,0,.5);color:#fff;font-size:11px;line-height:22px;text-align:center;cursor:pointer;z-index:2;';
function groupHeaderHtml(gname, count) {
const off = isGroupOff(ccOffScope(), cur, gname);
return '<span class="ccg-name">' + esc(gname) + (off ? '<em class="ccg-off-tag">已停用</em>' : '') + '</span>' +
'<span class="ccg-count">' + count + '</span>' +
'<button type="button" class="ccg-toggle' + (off ? ' off' : '') + '" title="' + (off ? '启用该分组' : '停用该分组') + '">' + (off ? ICON_EYE_OFF : ICON_EYE_ON) + '</button>';
}
function bindGroupToggle(h, gname) {
const tog = h.querySelector('.ccg-toggle');
if (!tog) return;
tog.addEventListener('click', (ev) => {
ev.preventDefault();
ev.stopPropagation();
const off = toggleGroupOff(cur, gname);
refreshGroupHeaderUI(gname);
toast(off ? '已停用分组「' + gname + '」：该分组字卡不再被联系人使用' : '已启用分组「' + gname + '」：该分组字卡恢复使用');
});
}
function refreshGroupHeaderUI(gname) {
const sel = (window.CSS && CSS.escape) ? CSS.escape(String(gname)) : String(gname).replace(/["\\]/g, '\\$&');
const h = list.querySelector('.cc-group-header[data-g="' + sel + '"]');
if (!h) return;
const off = isGroupOff(ccOffScope(), cur, gname);
h.classList.toggle('off', off);
const nm = h.querySelector('.ccg-name');
if (nm) {
const tag = nm.querySelector('.ccg-off-tag');
if (off && !tag) {
const e = document.createElement('em');
e.className = 'ccg-off-tag';
e.textContent = '已停用';
nm.appendChild(e);
} else if (!off && tag) { tag.remove(); }
}
const tog = h.querySelector('.ccg-toggle');
if (tog) {
tog.classList.toggle('off', off);
tog.title = off ? '启用该分组' : '停用该分组';
tog.innerHTML = off ? ICON_EYE_OFF : ICON_EYE_ON;
}
}
function ccCardSplit(c) {
const s = typeof c === 'string' ? c : '';
const bar = s.indexOf('|||');
return bar > 0 ? { name: s.slice(0, bar), body: s.slice(bar + 3) } : { name: '', body: s };
}
function ccCardMedia(c) {
const sp = ccCardSplit(c), b = sp.body;
if (!b) return null;
if (window.mochiMediaIsToken && window.mochiMediaIsToken(b)) return { name: sp.name, src: b, img: true };
const inline = window.chatIsInlineDataSrc ? window.chatIsInlineDataSrc(b) : b.indexOf('data:') === 0;
if (inline) {
if (!(window.chatIsImgSrcLike ? window.chatIsImgSrcLike(b) : b.indexOf('data:image') === 0)) {
return { name: sp.name, src: b, img: false };
}
return { name: sp.name, src: (window.chatFixNoMimeImg && window.chatFixNoMimeImg(b)) || b, img: true };
}
if (!sp.name && /^https?:\/\//i.test(b)) return { name: '', src: b, img: true };
return null;
}
function cardItemHtml(c) {
if (typeof c === 'string' && c.indexOf('|||') > 0) {
const pIdx = c.indexOf('|||');
const src = c.slice(pIdx + 3) || '';
if (src.indexOf('data:audio') === 0) {
const parts = c.split('|||');
const name = (parts[0] || '音频').replace(/\.[^.]+$/, '');
return '<div class="cc-ico" style="background:rgba(0,0,0,.05)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></div>' +
'<div class="cc-txt"><div class="t" style="color:var(--muted)">' + esc(name) + '</div></div>' +
'<button class="cc-play" title="播放">' +
'<span class="cc-play-ico"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>' +
'<span class="cc-play-bars"><i></i><i></i><i></i></span></button>';
}
}
const m = ccCardMedia(c);
if (m) {
if (!m.img) {
const label = (window.chatIsDataAudioSrc && window.chatIsDataAudioSrc(m.src)) ? '[语音]' : '[附件]';
return '<div class="cc-txt"><div class="t" style="color:var(--muted)">' + esc(m.name ? m.name + ' ' + label : label) + '</div></div>';
}
if (window.mochiMediaIsToken && window.mochiMediaIsToken(m.src) && window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(m.src)) {
return '<div class="cc-txt"><div class="t" style="color:var(--muted)">[图片丢失]</div></div>';
}
return '<div class="cc-ico cc-imgbox"><img class="cc-img" data-src="' + esc(m.src) + '" alt="图片" decoding="async"></div>' + ccNameBadgeHtml(c, m.name);
}
return '<div class="cc-txt"><div class="t">' + esc(c) + '</div></div>';
}
function ccNameBadgeHtml(c, fallback) {
try {
if (manageMode) return ''; // 管理模式整格用于勾选，不叠加名称按钮
if (cur !== 'sticker' && cur !== 'image') return '';
const nm = ccCardName(c) || fallback || '';
return '<button type="button" class="cc-name-edit" title="' + (nm ? '编辑名称' : '添加名称') + '" style="' + CC_NAME_BTN_CSS + '">' + (nm ? '改' : '＋') + '</button>'
+ (nm ? '<div class="cc-name-cap" style="' + CC_NAME_CAP_CSS + '">' + esc(nm) + '</div>' : '');
} catch (e) { return ''; }
}
function renderTabCounts() {
tabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
const grps = (groups && groups[tab.dataset.type]) || [];
let n = 0;
grps.forEach(g => { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; });
let em = tab.querySelector('.cc-tab-n');
if (!em) {
em = document.createElement('em');
em.className = 'cc-tab-n';
tab.appendChild(em);
}
em.textContent = n;
em.classList.toggle('zero', n === 0);
});
}
const imgObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
for (let i = 0; i < entries.length; i++) {
const en = entries[i];
if (!en.isIntersecting) continue;
const img = en.target;
if (img && img.dataset && img.dataset.src && !img.getAttribute('src')) {
img.setAttribute('src', img.dataset.src);
img.removeAttribute('data-src');
}
try { imgObserver.unobserve(img); } catch (e) {}
}
}, { root: list, rootMargin: '300px 0px' }) : null;
function attachLazy(img) {
if (!img) return;
if (imgObserver) { try { imgObserver.observe(img); } catch (e) {} }
else {
img.setAttribute('src', img.dataset.src || '');
img.removeAttribute('data-src');
}
}
const audioSrcMap = new WeakMap();
function attachCardData(d, c) {
attachLazy(d.querySelector('img[data-src]'));
const pb = d.querySelector('.cc-play');
if (pb && typeof c === 'string' && c.indexOf('|||') > 0) {
const p = c.indexOf('|||');
const s = c.slice(p + 3);
if (s.indexOf('data:audio') === 0) audioSrcMap.set(pb, s);
}
const nb = d.querySelector('.cc-name-edit');
if (nb && !nb.__ccNameBound) {
nb.__ccNameBound = true;
nb.addEventListener('click', (ev) => {
ev.preventDefault();
ev.stopPropagation();
ccEditCardName(c);
});
}
}
function openEditCard(gname, i) {
if (manageMode) return;
const grps = groups[cur] || [];
const g = grps.find(x => x[0] === gname);
if (!g) return;
const c = g[1][i];
if (typeof c !== 'string' || !c) return;
if (c.indexOf('data:') === 0) return;
if (c.indexOf('|||') > 0 && c.slice(c.indexOf('|||') + 3).indexOf('data:audio') === 0) return;
if (!window.openModal) return;
window.openModal('编辑字卡', c, (v) => {
const val = String(v == null ? '' : v).trim();
if (!val) { toast('字卡内容不能为空'); return; }
if (val === c) return; // 内容未变化，直接关闭
const dup = g[1].find((x, xi) => xi !== i && x === val);
if (dup !== undefined) { toast('该分组已有相同内容'); return; }
g[1][i] = val;
updateCardDom(gname, i, val);
scheduleSave();
toast('字卡已更新');
});
}
function updateCardDom(gname, i, val) {
if (rendering) { renderGroupsBar(); render(); return; }
const sel = (window.CSS && CSS.escape) ? CSS.escape(String(gname)) : String(gname).replace(/["\\]/g, '\\$&');
const node = list.querySelector('.cc-item[data-g="' + sel + '"][data-idx="' + i + '"]');
if (node) {
if (imgObserver) node.querySelectorAll('img[data-src]').forEach(im => { try { imgObserver.unobserve(im); } catch (e) {} });
if (q) {
const terms = window.mochiSearch ? window.mochiSearch.terms(window.mochiSearch.qnorm(q)) : [q.toLowerCase()];
const mt = ccCardMatchText(val);
const matches = !!mt && terms.every(w => mt.indexOf(w) >= 0);
if (matches) {
node.innerHTML = cardItemHtml(val);
attachCardData(node, val);
} else {
node.remove();
const h = list.querySelector('.cc-group-header[data-g="' + sel + '"]');
if (h) {
const cnt = h.querySelector('.ccg-count');
if (cnt) cnt.textContent = Math.max(0, (parseInt(cnt.textContent, 10) || 1) - 1);
if (cnt && parseInt(cnt.textContent, 10) === 0 && gname.indexOf(q) < 0) h.remove();
}
}
} else {
node.innerHTML = cardItemHtml(val);
attachCardData(node, val);
}
}
updateCountsOnly();
}
let editSaveTimer = null;
let ccDirty = false; // v3.29.x：自上次落盘后是否还有未保存变更（离页/切作用域冲刷依据）
function scheduleSave() {
clearTimeout(editSaveTimer);
ccDirty = true;
editSaveTimer = setTimeout(function () {
editSaveTimer = null;
try { saveGroups(groups); } catch (e) {}
}, 120);
}
function flushCcSave() {
if (editSaveTimer) { clearTimeout(editSaveTimer); editSaveTimer = null; }
if (ccDurablePending) ccEnsureDurable(0);
if (!ccDirty) return;
if (!groups) { ccDirty = false; return; }
try { saveGroups(groups); } catch (e) {}
}
window.ccFlushSave = flushCcSave;
window.ccReloadGroupsAfterExternalWrite = function () {
pubInvalidate();
namesInvalidate(); // #680：外部写回可能改了图片/表情包名称，缓存必须失效
libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1;
if (ccPageOpen()) {
try { groups = loadGroups(); } catch (e) {}
try { renderGroupsBar(); render(); } catch (e2) {}
}
refreshLibCounts(true);
};
try {
window.addEventListener('beforeunload', flushCcSave);
window.addEventListener('pagehide', function () { flushCcSave(); poolSrcRelease(); });
document.addEventListener('visibilitychange', function () {
if (document.visibilityState === 'hidden') { flushCcSave(); poolSrcRelease(); }
});
} catch (e) {}
const libCounts = { pub: -1, own: -1, fun: -1, pubFun: -1 };
const NO_SRC = {}; // 初始哨兵：任何真实读数（含 null=键缺失）都不等于它
let poolSrcPub = NO_SRC, poolSrcOwn = NO_SRC;
function poolSrcChanged() {
let rp = NO_SRC, ro = NO_SRC;
try { rp = pubStore().get(PUB_KEY); } catch (e) {}
try { ro = store.get('cc-groups'); } catch (e) {}
const ch = poolSrcPub !== rp || poolSrcOwn !== ro;
poolSrcPub = rp; poolSrcOwn = ro;
return ch;
}
function poolSrcRelease() { poolSrcPub = NO_SRC; poolSrcOwn = NO_SRC; }
function countOf(g) {
let n = 0;
try { Object.keys(g || {}).forEach(t => (g[t] || []).forEach(grp => { if (Array.isArray(grp) && Array.isArray(grp[1])) n += grp[1].length; })); } catch (e) {}
return n;
}
function countOfKeys(g, keys) {
let n = 0;
try { (keys || []).forEach(t => (g[t] || []).forEach(grp => { if (Array.isArray(grp) && Array.isArray(grp[1])) n += grp[1].length; })); } catch (e) {}
return n;
}
function refreshLibCounts(force) {
if (force) { libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1; if (poolSrcChanged()) pubInvalidate(); }
if (libCounts.pub < 0) {
const n = countOf(pubGroupsRaw());
libCounts.pub = n > 0 ? n : -1;
libCounts.pubFun = countOfKeys(pubGroupsRaw(), CC_FUN_COUNT_KEYS);
}
if (libCounts.own < 0 || libCounts.fun < 0) {
const og = ownPoolRaw();
if (libCounts.own < 0) {
const n = countOf(og);
libCounts.own = n > 0 ? n : -1;
}
if (libCounts.fun < 0) libCounts.fun = countOfKeys(og, CC_FUN_COUNT_KEYS);
}
if (libCounts.pubFun < 0) {
libCounts.pubFun = countOfKeys(pubGroupsRaw(), CC_FUN_COUNT_KEYS);
}
const pfe = document.getElementById('cc-fun-count');
if (pfe) { pfe.textContent = String(libCounts.fun < 0 ? 0 : libCounts.fun); pfe.classList.remove('cc-cnt-loading'); } // #575 写回真值即摘掉取回中脉冲态
const pfpe = document.getElementById('cc-fun-pub-count');
if (pfpe) { pfpe.textContent = String(libCounts.pubFun < 0 ? 0 : libCounts.pubFun); pfpe.classList.remove('cc-cnt-loading'); }
const pe = document.getElementById('cc-pub-count');
if (pe) { pe.textContent = libCounts.pub < 0 ? 0 : libCounts.pub; pe.classList.remove('cc-cnt-loading'); }
const oe = document.getElementById('cc-list-count');
if (oe) { oe.textContent = libCounts.own < 0 ? 0 : libCounts.own; oe.classList.remove('cc-cnt-loading'); }
}
function markLibCountsLoading() {
try {
['cc-pub-count', 'cc-list-count', 'cc-fun-count', 'cc-fun-pub-count'].forEach(function (id) {
const el = document.getElementById(id);
if (!el) return;
el.textContent = '…';
el.classList.add('cc-cnt-loading');
});
} catch (e) {}
}
document.addEventListener('mochi-restore-done', function () {
refreshLibCounts(true);
namesInvalidate();
if (ccPageOpen()) { try { renderGroupsBar(); render(); } catch (e) {} }
});
function updateCountsOnly() {
if (!groups) { refreshLibCounts(false); return; }
renderTabCounts();
renderGroupsBar();
const total = totalCount(groups);
const totalEl = document.getElementById('cc-total');
if (totalEl) totalEl.textContent = total + ' 张';
refreshLibCounts(false);
}
function groupBlockNodes(gname) {
const sel = (window.CSS && CSS.escape) ? CSS.escape(String(gname)) : String(gname).replace(/["\\]/g, '\\$&');
const nodes = [];
const header = list.querySelector('.cc-group-header[data-g="' + sel + '"]');
if (header) nodes.push(header);
list.querySelectorAll('.cc-item[data-g="' + sel + '"]').forEach(el => nodes.push(el));
return nodes;
}
const IMG_POOL_MAX = 150;
const ccImgPool = new Map();   // sigKey -> [img,...]
let ccImgPoolN = 0;
let ccPoolT = null;
function ccImgKey(c) {
const s = String(c || '');
let h = 5381;
for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
return s.length + ':' + h;
}
function ccPoolKey(c) {
try {
if (typeof window.ccMediaCardIdent === 'function') {
const k = window.ccMediaCardIdent(c);
if (k) return 'i' + k;
}
} catch (e) {}
return 'r' + ccImgKey(c);
}
function ccPoolRelease() { if (ccPoolT) { clearTimeout(ccPoolT); ccPoolT = null; } ccImgPool.clear(); ccImgPoolN = 0; }
function ccPoolSchedule() {
if (ccPoolT) clearTimeout(ccPoolT);
ccPoolT = setTimeout(ccPoolRelease, 180000); // 闲置 3 分钟整池释放（不长期占着已解码位图）
}
function ccPoolPush(k, im) {
if (!k || !im || !im.nodeType) return;
let a = ccImgPool.get(k);
if (!a) { a = []; ccImgPool.set(k, a); }
a.push(im);
ccImgPoolN++;
ccPoolSchedule();
while (ccImgPoolN > IMG_POOL_MAX) {
const first = ccImgPool.keys().next();
if (first.done) break;
const kk = first.value;
const aa = ccImgPool.get(kk);
ccImgPool.delete(kk);
ccImgPoolN -= (aa ? aa.length : 1);
if (ccImgPoolN < 0) ccImgPoolN = 0;
}
}
function ccPoolTake(k) {
const a = ccImgPool.get(k);
if (!a || !a.length) return null;
const im = a.shift();
ccImgPoolN = Math.max(0, ccImgPoolN - 1);
if (!a.length) ccImgPool.delete(k);
ccPoolSchedule();
return im;
}
function ccPoolHarvest(rootEl) {
if (!rootEl || !rootEl.querySelectorAll) return;
try {
rootEl.querySelectorAll('.cc-item[data-cc-sig]').forEach(d => {
const im = d.querySelector('img.cc-img');
if (!im || !(im.getAttribute('src') || im.dataset.src)) return;
ccPoolPush(d.dataset.ccSig, im);
});
} catch (e) {}
}
function ccPoolAdopt(el, c) {
if (typeof c !== 'string') return;
const isImg = c.indexOf('data:') === 0 || c.indexOf('@@m:') === 0 || /^https?:\/\//i.test(c);
if (!isImg) return;
const _ni = el.querySelector('img.cc-img');
if (!_ni || !_ni.parentNode) return; // 当前不是 img 形态（如令牌缺失走文字占位）→ 不取也不动
const _oi = ccPoolTake(ccPoolKey(c));
if (!_oi) return;
_ni.parentNode.replaceChild(_oi, _ni);
}
function rebuildGroupAfterRemove(gname) {
if (curGroup && curGroup !== gname) return;
groupBlockNodes(gname).forEach(el => {
if (imgObserver) el.querySelectorAll('img[data-src]').forEach(im => { try { imgObserver.unobserve(im); } catch (e) {} });
ccPoolHarvest(el); // FIX #509：移除前回收该分组已解码的图片节点
el.remove();
});
const grps = groups[cur] || [];
const g = grps.find(x => x[0] === gname);
if (!g) return; // 分组整体已删（走删除分组流程，不经过这里）
const h = document.createElement('div');
h.className = 'cc-group-header' + (isGroupOff(ccOffScope(), cur, gname) ? ' off' : '');
h.dataset.g = gname;
h.innerHTML = groupHeaderHtml(gname, g[1].length);
bindGroupToggle(h, gname);
const grpNames = grps.map(x => x[0]);
const nextIdx = grpNames.indexOf(gname) + 1;
const nextSel = (window.CSS && CSS.escape) ? CSS.escape(String(grpNames[nextIdx] || '')) : '';
const anchor = nextIdx < grpNames.length
? list.querySelector('.cc-group-header[data-g="' + nextSel + '"]')
: null;
const frag = document.createDocumentFragment();
frag.appendChild(h);
g[1].forEach((c, i) => {
const d = document.createElement('div');
d.className = 'cc-item glass';
d.dataset.g = gname;
d.dataset.idx = i;
d.innerHTML = cardItemHtml(c);
if (typeof c === 'string') d.dataset.ccSig = ccPoolKey(c); // FIX #508：局部重建的卡同样带指纹（#509 改短键、#617 改令牌稳定身份）
ccPoolAdopt(d, c); // FIX #509：同内容图从池里取回已解码 img（删一张卡不再让整组图片重载）
attachCardData(d, c);
if (manageMode && selected.has(gname + '\u0001' + i)) d.classList.add('sel');
d.addEventListener('click', () => {
if (manageMode) { toggleSelect(d, gname, i); return; }
if (typeof c === 'string' && c.indexOf('@@m:') === 0 && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) {
const v = window.mochiMediaExpand ? window.mochiMediaExpand(c) : null;
viewImage(v || c);
return;
}
if (typeof c === 'string' && (c.indexOf('data:') === 0 || /^https?:\/\//i.test(c))) { viewImage(c); return; }
const cm = ccCardMedia(c);
if (cm && cm.img) {
const v2 = window.mochiMediaExpand ? window.mochiMediaExpand(cm.src) : null;
viewImage(v2 || cm.src);
return;
}
if (cm) return; // 非图片内联载荷：占位格不给开文字编辑器（打开就是几十万字节的 base64，改一下即毁卡）
openEditCard(gname, i);
});
attachCardDrag(d, gname, i);
frag.appendChild(d);
});
if (anchor && anchor.parentNode === list) list.insertBefore(frag, anchor);
else list.appendChild(frag);
}
const RENDER_BATCH = 80;
let renderToken = 0;
let rendering = false; // 分块渲染进行中（局部删除前判断：渲染中改走全量 render，防旧批次复活已删卡片）
const DRAG_CATS = ['text', 'kaomoji', 'emoji', 'sticker'];
function attachCardDrag(el, gname, i) {
if (DRAG_CATS.indexOf(cur) < 0) return;
el.style.setProperty('-webkit-user-select', 'none');
el.style.setProperty('user-select', 'none');
el.style.setProperty('-webkit-touch-callout', 'none');
let pressTimer = null;
let startX = 0, startY = 0;
el.addEventListener('pointerdown', (e) => {
if (manageMode || q || rendering) return;
if (e.button !== 0 && e.pointerType === 'mouse') return;
startX = e.clientX; startY = e.clientY;
pressTimer = setTimeout(() => {
pressTimer = null;
if (manageMode || q || rendering) return;
startCardDrag(e, el, gname, i);
}, 350);
});
el.addEventListener('pointermove', (e) => {
if (pressTimer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) {
clearTimeout(pressTimer); pressTimer = null;
}
});
const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
el.addEventListener('pointerup', cancel);
el.addEventListener('pointercancel', cancel);
}
function startCardDrag(e, el, gname, i) {
const rect = el.getBoundingClientRect();
const offsetY = e.clientY - rect.top;
const clone = el.cloneNode(true);
clone.classList.add('cc-drag-clone');
clone.style.position = 'fixed';
clone.style.left = rect.left + 'px';
clone.style.top = rect.top + 'px';
clone.style.width = rect.width + 'px';
clone.style.zIndex = '1000';
clone.style.pointerEvents = 'none';
document.body.appendChild(clone);
el.classList.add('cc-dragging');
if (navigator.vibrate) try { navigator.vibrate(15); } catch (err) {}
let dropTarget = null;
const stopPan = (ev) => { if (ev.cancelable) ev.preventDefault(); };
const onMove = (ev) => {
ev.preventDefault();
clone.style.top = (ev.clientY - offsetY) + 'px';
dropTarget = computeCardDrop(ev.clientY);
updateCardDropIndicator(dropTarget);
};
const onUp = () => {
document.removeEventListener('touchmove', stopPan);
document.removeEventListener('pointermove', onMove);
document.removeEventListener('pointerup', onUp);
document.removeEventListener('pointercancel', onUp);
clone.remove();
el.classList.remove('cc-dragging');
clearCardDropIndicator();
if (dropTarget) moveCardTo(gname, i, dropTarget);
};
document.addEventListener('touchmove', stopPan, { passive: false });
document.addEventListener('pointermove', onMove, { passive: false });
document.addEventListener('pointerup', onUp);
document.addEventListener('pointercancel', onUp);
}
function computeCardDrop(clientY) {
const items = Array.from(list.querySelectorAll('.cc-item:not(.cc-dragging)'));
for (const item of items) {
const r = item.getBoundingClientRect();
if (clientY < r.top + r.height / 2) {
return { gname: item.dataset.g, idx: parseInt(item.dataset.idx, 10), before: true };
}
}
const headers = Array.from(list.querySelectorAll('.cc-group-header'));
let lastHeader = null;
for (const h of headers) {
if (clientY >= h.getBoundingClientRect().top) lastHeader = h;
}
if (lastHeader) {
const gname = lastHeader.dataset.g;
const grps = groups[cur] || [];
if (grps.find(x => x[0] === gname)) {
const groupItems = items.filter(it => it.dataset.g === gname);
if (groupItems.length) {
const last = groupItems[groupItems.length - 1];
return { gname, idx: parseInt(last.dataset.idx, 10), before: false };
}
return { gname, idx: 0, before: true, empty: true };
}
}
if (items.length) {
const last = items[items.length - 1];
return { gname: last.dataset.g, idx: parseInt(last.dataset.idx, 10), before: false };
}
return null;
}
function updateCardDropIndicator(target) {
clearCardDropIndicator();
if (!target) return;
const sel = (window.CSS && CSS.escape) ? CSS.escape(String(target.gname)) : String(target.gname).replace(/["\\]/g, '\\$&');
const line = document.createElement('div');
line.className = 'cc-drop-line';
if (target.empty) {
const header = list.querySelector('.cc-group-header[data-g="' + sel + '"]');
if (header && header.nextSibling) list.insertBefore(line, header.nextSibling);
else if (header) list.appendChild(line);
return;
}
const ref = list.querySelector('.cc-item[data-g="' + sel + '"][data-idx="' + target.idx + '"]');
if (!ref) return;
if (target.before) list.insertBefore(line, ref);
else if (ref.nextSibling) list.insertBefore(line, ref.nextSibling);
else list.appendChild(line);
}
function clearCardDropIndicator() {
list.querySelectorAll('.cc-drop-line').forEach(el => el.remove());
}
function moveCardTo(fromGname, fromIdx, target) {
const grps = groups[cur] || [];
const fromG = grps.find(g => g[0] === fromGname);
if (!fromG) return;
const card = fromG[1][fromIdx];
if (card === undefined) return;
const toG = grps.find(g => g[0] === target.gname);
if (!toG) return;
let toIdx = target.before ? target.idx : target.idx + 1;
if (fromGname === target.gname) {
if (fromIdx === toIdx || fromIdx === toIdx - 1) return; // 原地未动
fromG[1].splice(fromIdx, 1);
if (fromIdx < toIdx) toIdx -= 1;
fromG[1].splice(toIdx, 0, card);
} else {
fromG[1].splice(fromIdx, 1);
toG[1].splice(toIdx, 0, card);
}
saveGroups(groups);
renderGroupsBar();
render();
toast('字卡已移动');
}
function ccCardMatchText(c, type) {
try {
const t = type || cur;
if (typeof c !== 'string' || !c) return '';
if (t === 'sticker' || t === 'image') return ccCardName(c).toLowerCase();
if (t === 'voice') {
const bar = c.indexOf('|||');
const body = bar > 0 ? c.slice(bar + 3) : '';
if (bar > 0 && (window.chatIsDataAudioSrc ? window.chatIsDataAudioSrc(body) : body.indexOf('data:audio') === 0)) return c.slice(0, bar).toLowerCase();
if (ccCardMedia(c)) return ''; // 变体音频（大写 MIME/前导空白）按名称前缀匹配，载荷不进正文
return c.toLowerCase();
}
if (ccCardMedia(c) || c.indexOf('@@m:') >= 0) return '';
return c.toLowerCase();
} catch (e) { return ''; }
}
function render() {
const token = ++renderToken;
try { if (window.__mochiPhase) window.__mochiPhase('cc-render'); } catch (e0) {}
rendering = true;
try {
var _ccImpSync = document.getElementById('cc-import');
if (_ccImpSync && _ccImpSync.__ccSyncSurface) _ccImpSync.__ccSyncSurface();
} catch (e1) {}
renderTabCounts();
let mediaHelp = document.getElementById('cc-media-help');
const showMediaHelp = cur === 'sticker' || cur === 'image';
if (!mediaHelp && showMediaHelp) {
mediaHelp = document.createElement('div');
mediaHelp.id = 'cc-media-help';
mediaHelp.style.cssText = 'margin:8px 16px;font-size:12px;line-height:1.7;color:var(--muted,#888);';
list.parentNode.insertBefore(mediaHelp, list);
}
if (mediaHelp) {
mediaHelp.style.display = showMediaHelp ? '' : 'none';
mediaHelp.textContent = showMediaHelp
? '支持批量上传：点击「批量导入」可一次选择多张。若无法多选，可能是当前浏览器或系统文件选择器的限制，建议换一个浏览器使用。'
+ (cur === 'sticker' ? '表情包在聊天中以较小尺寸显示，适合发送表情贴纸；图片则以较大尺寸显示。' : '图片在聊天中以较大尺寸显示，适合展示照片或图片细节；表情包则以较小尺寸显示。')
: '';
}
list.classList.toggle('cc-grid', cur === 'sticker');
list.classList.toggle('cc-grid2', cur === 'image');
list.classList.toggle('cc-grid6', cur === 'emoji');
const grps = (groups && groups[cur]) || [];
let shown = grps;
if (curGroup) shown = shown.filter(g => g[0] === curGroup);
if (q) {
const terms = window.mochiSearch ? window.mochiSearch.terms(window.mochiSearch.qnorm(q)) : [q.toLowerCase()];
const kwN = terms.join(' ');
shown = shown
.map(([g, arr]) => [g, arr
.map((c, oi) => { const mt = ccCardMatchText(c); const o = { c: c, oi: oi }; o.rk = window.mochiSearch ? window.mochiSearch.rank(mt, kwN) : 2; return o; })
.filter(x => { const mt = ccCardMatchText(x.c); return !!mt && terms.every(w => mt.indexOf(w) >= 0); })
.sort((a, b) => a.rk - b.rk || a.oi - b.oi)])
.filter(([g, arr]) => arr.length || terms.every(w => g.toLowerCase().indexOf(w) >= 0));
}
updateCountsOnly();
if (imgObserver) list.querySelectorAll('img[data-src]').forEach(im => { try { imgObserver.unobserve(im); } catch (e) {} });
ccPoolHarvest(list);
list.innerHTML = '';
if (!shown.length) {
const isVoice = cur === 'voice';
const emptyTxt = cur === 'sticker' ? '暂无表情包 · 点击右上角批量导入上传图片'
: cur === 'image' ? '暂无图片 · 点击右上角批量导入上传图片'
: cur === 'voice' ? '暂无语音 · 点击右上角批量导入上传音频'
: '暂无字卡';
const impLabel = isVoice ? '批量导入音频' : (cur === 'sticker' || cur === 'image') ? '批量导入图片' : '批量导入字卡';
list.innerHTML = '<div class="cc-empty-wrap" style="grid-column:1/-1">'
+ '<div class="cc-empty">' + emptyTxt + '</div>'
+ '<div class="cc-empty-act" style="display:flex;gap:8px;justify-content:center;padding:0 0 20px">'
+ '<button type="button" class="cc-empty-btn" data-cc-empty="import" style="padding:9px 15px;border:0;border-radius:10px;background:var(--ink,#111);color:var(--card-bg,#fff);font-size:13px;font-weight:700;cursor:pointer">' + impLabel + '</button>'
+ ((cur === 'sticker' || cur === 'image') ? '<button type="button" class="cc-empty-btn" data-cc-empty="link" style="padding:9px 15px;border:0;border-radius:10px;background:rgba(0,0,0,.06);color:var(--ink,#111);font-size:13px;font-weight:700;cursor:pointer">链接导入</button>' : '')
+ '</div></div>';
if (list && !list.__ccEmptyActBound) {
list.__ccEmptyActBound = true;
list.addEventListener('click', (e) => {
const _t = e.target;
if (_t && _t.getAttribute && _t.getAttribute('data-file-pick-surface') === '1') return;
const b = e.target && e.target.closest ? e.target.closest('[data-cc-empty]') : null;
if (!b) return;
e.preventDefault(); e.stopPropagation();
const el = document.getElementById(b.getAttribute('data-cc-empty') === 'link' ? 'cc-import-link' : 'cc-import');
if (el) el.click();
});
}
if (IMG_TYPES[cur]) {
try {
const _ccEmptyBtn = list.querySelector('[data-cc-empty="import"]');
if (_ccEmptyBtn) ccLayImportSurface(_ccEmptyBtn, 'cc-empty-import-surf');
} catch (e2) {}
}
return;
}
const flat = [];
shown.forEach(([gname, arr]) => {
flat.push({ header: true, gname, count: arr.length });
arr.forEach((o, i) => {
flat.push({ header: false, gname, c: q ? o.c : o, i: q ? o.oi : i });
});
});
const frag = document.createDocumentFragment();
let pos = 0;
const build = (el, it) => {
if (it.header) {
el.className = 'cc-group-header' + (isGroupOff(ccOffScope(), cur, it.gname) ? ' off' : '');
el.dataset.g = it.gname;
el.innerHTML = groupHeaderHtml(it.gname, it.count);
bindGroupToggle(el, it.gname);
} else {
el.className = 'cc-item glass';
el.dataset.g = it.gname;
el.dataset.idx = it.i;
el.innerHTML = cardItemHtml(it.c);
if (typeof it.c === 'string') {
el.dataset.ccSig = ccPoolKey(it.c); // FIX #508/#509：内容短指纹，供复用判定（#617 令牌稳定身份）
ccPoolAdopt(el, it.c);             // FIX #509：从池取回同内容的已解码 img（取不到则保持新建）
}
attachCardData(el, it.c);
if (manageMode && selected.has(it.gname + '\u0001' + it.i)) el.classList.add('sel');
el.addEventListener('click', () => {
if (manageMode) { toggleSelect(el, it.gname, it.i); return; }
if (typeof it.c === 'string' && it.c.indexOf('@@m:') === 0 && window.mochiMediaIsToken && window.mochiMediaIsToken(it.c)) {
const v = window.mochiMediaExpand ? window.mochiMediaExpand(it.c) : null;
viewImage(v || it.c);
return;
}
if (typeof it.c === 'string' && (it.c.indexOf('data:') === 0 || /^https?:\/\//i.test(it.c))) {
viewImage(it.c);
return;
}
const cm = ccCardMedia(it.c);
if (cm && cm.img) {
const v2 = window.mochiMediaExpand ? window.mochiMediaExpand(cm.src) : null;
viewImage(v2 || cm.src);
return;
}
if (cm) return;
openEditCard(it.gname, it.i);
});
attachCardDrag(el, it.gname, it.i);
}
};
const IDLE_BATCH = 40;
const scheduleNext = (fn) => {
try {
if (typeof window.requestIdleCallback === 'function') {
window.requestIdleCallback(function () { fn(); }, { timeout: 300 });
return;
}
} catch (e) {}
setTimeout(fn, 60);
};
const step = (batch) => {
if (token !== renderToken) { rendering = false; return; } // 新渲染已开始，废弃本批次
const n = batch || RENDER_BATCH;
const end = Math.min(pos + n, flat.length);
for (; pos < end; pos++) {
const el = document.createElement('div');
build(el, flat[pos]);
frag.appendChild(el);
}
list.appendChild(frag);
if (pos < flat.length) {
if (document.hidden) {
var _onVis = function () {
document.removeEventListener('visibilitychange', _onVis);
if (token !== renderToken) { rendering = false; return; }
scheduleNext(function () { step(IDLE_BATCH); });
};
document.addEventListener('visibilitychange', _onVis);
return;
}
scheduleNext(function () { step(IDLE_BATCH); });
} else rendering = false;
};
step(); // 首批同步跑（小列表一次完成，行为与原一致）
}
tabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
tab.addEventListener('click', () => {
if (manageMode) exitManage();
selected.clear();
tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.remove('sel'));
tab.classList.add('sel');
cur = tab.dataset.type;
syncLinkImportVis();
q = '';
curGroup = '';
const s1 = document.getElementById('cc-search-input');
const s2 = document.getElementById('chatcard-search');
if (s1) s1.value = '';
if (s2) s2.value = '';
renderGroupsBar();
render();
});
});
const searchInput = document.getElementById('cc-search-input');
const searchInput2 = document.getElementById('chatcard-search');
function setupSearchInput(input) {
if (!input) return;
let searchTimer = null;
input.addEventListener('input', () => {
q = input.value.trim();
if (manageMode) { selected.clear(); updateCount(); }
clearTimeout(searchTimer);
searchTimer = setTimeout(render, 120);
});
input.addEventListener('keydown', (e) => {
if (e.key === 'Escape') {
input.value = ''; q = '';
if (manageMode) { selected.clear(); updateCount(); }
clearTimeout(searchTimer);
render();
input.blur();
}
});
}
setupSearchInput(searchInput);
const searchResultEl = document.createElement('div');
searchResultEl.className = 'cc-search-result';
searchResultEl.style.cssText = 'padding:0 12px';
searchResultEl.hidden = true;
(function () { const w = document.querySelector('#page-chatcard .tc-search-wrap'); if (w && w.parentNode) w.parentNode.insertBefore(searchResultEl, w.nextSibling); })();
function renderSearchResult(kw) {
try { if (window.__mochiPhase) window.__mochiPhase('cc-search'); } catch (e0) {}
if (!kw) { searchResultEl.hidden = true; searchResultEl.innerHTML = ''; return; }
searchResultEl.hidden = false;
kw = window.mochiSearch ? window.mochiSearch.qnorm(kw) : kw; // #573 查询侧标点归一：「晚安。」＝「晚安」
if (!kw) { searchResultEl.hidden = true; searchResultEl.innerHTML = ''; return; }
const fns = window.__cardSearchFns || [];
const ms = window.mochiSearch || null;
const terms = ms ? ms.terms(kw) : [String(kw).toLowerCase()];
const anchor = ms ? ms.anchor(terms) : terms[0];
let all = [];
fns.forEach(function (reg) { try { (reg.fn(anchor) || []).forEach(function (r) { all.push({ t: r.t, cat: r.cat, mod: reg.name }); }); } catch (e) {} });
all = all.filter(function (r) { const t = String(r.t || '').toLowerCase(); return terms.every(function (w) { return t.indexOf(w) >= 0; }); });
all.forEach(function (r) { r.__rank = ms ? ms.rank(r.t, kw) : 2; });
all.sort(function (a, b) { return a.__rank - b.__rank; });
if (!all.length) { searchResultEl.innerHTML = '<div class="ta-empty" style="padding:20px 12px">没有找到含「' + esc(kw) + '」的字卡</div>'; return; }
const RANK_NAME = ['精确命中', '开头命中', '包含命中'];
let html = '<div class="cal-card-title" style="padding:10px 2px">找到 ' + all.length + ' 张含「' + esc(kw) + '」的字卡</div>';
for (let rk = 0; rk < 3; rk++) {
const sec = all.filter(function (r) { return r.__rank === rk; });
if (!sec.length) continue;
html += '<div class="cal-card-title" style="padding:8px 2px 4px;font-size:12px;color:var(--muted,#888)">' + RANK_NAME[rk] + ' ' + sec.length + ' 张</div>';
sec.forEach(function (r) {
html += '<div class="tc-qrow"><div class="tc-qmain"><div class="tc-qtext">' + esc(r.t) + '</div><div class="tc-qmeta" style="font-size:11px;color:var(--muted)">' + esc(r.mod) + (r.cat ? ' · ' + esc(r.cat) : '') + '</div></div></div>';
});
}
searchResultEl.innerHTML = html;
}
if (searchInput2) {
const filterEntries = function () {
const kw = String(searchInput2.value || '').trim().toLowerCase();
const customEl = document.getElementById('cc-sect-custom');
const presetEl = document.getElementById('cc-sect-preset');
if (kw) {
if (customEl) customEl.hidden = true;
if (presetEl) presetEl.hidden = true;
renderSearchResult(kw);
} else {
renderSearchResult('');
const cur = document.querySelector('.cc-top-tabs .cc-tab.sel');
const k = cur ? cur.getAttribute('data-ccsect') : 'custom';
if (customEl) customEl.hidden = (k !== 'custom');
if (presetEl) presetEl.hidden = (k !== 'preset');
}
};
let ccSearchTimer = 0, ccSearchPost = 0, ccSearchLast = 0;
const ccSearchRun = function () {
if (ccSearchPost) { clearTimeout(ccSearchPost); ccSearchPost = 0; }
const t0 = Date.now();
filterEntries();
ccSearchLast = Date.now() - t0; // 记本次耗时：够快则下轮不再亮提示，免得每键闪一下
};
const ccSearchInput = function () {
clearTimeout(ccSearchTimer);
if (ccSearchPost) { clearTimeout(ccSearchPost); ccSearchPost = 0; }
if (!String(searchInput2.value || '').trim()) { ccSearchRun(); return; } // 清空＝立即复原分类列表
ccSearchTimer = setTimeout(function () {
if (ccSearchLast < 120) { ccSearchRun(); return; }
searchResultEl.hidden = false;
searchResultEl.innerHTML = '<div class="ta-empty" style="padding:20px 12px">搜索中…</div>';
ccSearchPost = setTimeout(ccSearchRun, 32);
}, 150);
};
searchInput2.addEventListener('input', ccSearchInput);
searchInput2.addEventListener('keydown', function (e) {
if (e.key === 'Escape') {
searchInput2.value = '';
clearTimeout(ccSearchTimer);
if (ccSearchPost) { clearTimeout(ccSearchPost); ccSearchPost = 0; }
filterEntries();
searchInput2.blur();
}
});
const ccPage = document.getElementById('page-chatcard');
if (ccPage) { new MutationObserver(function () { if (!ccPage.hidden && searchInput2.value) { searchInput2.value = ''; filterEntries(); } }).observe(ccPage, { attributes: true, attributeFilter: ['hidden'] }); }
}
window.__cardSearchFns = window.__cardSearchFns || [];
window.__cardSearchFns.push({ name: '自定义聊天字卡', fn: function (kw) {
const out = [];
try {
const groups = mergeWithPublic(ownPoolRaw());
Object.keys(groups).forEach(function (type) {
(groups[type] || []).forEach(function (grp) {
const gname = grp[0]; const cards = grp[1] || [];
cards.forEach(function (c) {
if (typeof c !== 'string' || !c) return;
if (type === 'sticker' || type === 'image') {
const nm = ccCardNameAny(c);
if (nm && nm.toLowerCase().indexOf(kw) >= 0) out.push({ t: nm, cat: gname });
return;
}
if (window.ccTextCardOnly && !window.ccTextCardOnly(c)) {
const bar = c.indexOf('|||');
if (!(bar > 0 && c.slice(bar + 3).indexOf('data:audio') === 0)) return;
}
const txt = c.split('|||')[0] || c;
if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: gname });
});
});
});
} catch (e) {}
return out;
} });
window.__cardSearchFns.push({ name: '默认聊天字卡', fn: function (kw) {
const out = [];
try {
if (window.cardLockOpen && !window.cardLockOpen()) return out; // #319 锁定＝搜不到系统预设字卡
const d = window.DEFAULT_CARD_DATA || {};
Object.keys(d).forEach(function (k) { (d[k] || []).forEach(function (grp) { const gname = grp[0]; const cards = grp[1] || []; cards.forEach(function (c) { if (c && String(c).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(c), cat: gname }); }); }); });
} catch (e) {}
return out;
} });
window.__cardSearchFns.push({ name: '聊天情绪/回应', fn: function (kw) {
const out = [];
try {
const d = window.MOOD_FOLLOWUP_DATA || {};
(d.mood || []).forEach(function (g) { (g.cards || []).forEach(function (c) { const txt = c && c.content ? c.content : ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: '情绪·' + (g.group || '') }); }); });
(d.followup || []).forEach(function (g) { const grp = g.group || g.cat || ''; (g.cards || []).forEach(function (c) { const txt = typeof c === 'string' ? c : (c && c.content) || ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: '回应·' + grp }); }); });
} catch (e) {}
return out;
} });
const ngBtn = document.getElementById('cc-new-group');
if (ngBtn) {
ngBtn.addEventListener('click', openManageGroups);
}
function openManageGroups() {
let mask = document.getElementById('cc-mg-mask');
if (!mask) {
mask = document.createElement('div');
mask.id = 'cc-mg-mask';
mask.className = 'mg-mask';
mask.innerHTML =
'<div class="mg-panel">' +
'<div class="mg-head"><span>管理分组</span><button class="mg-close">✕</button></div>' +
'<div class="mg-list"></div>' +
'<button class="mg-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 5v14M5 12h14"/></svg>新建分组</button>' +
'</div>';
document.body.appendChild(mask);
mask.querySelector('.mg-close').addEventListener('click', () => { mask.hidden = true; });
mask.addEventListener('click', (e) => { if (e.target === mask) mask.hidden = true; });
mask.querySelector('.mg-add').addEventListener('click', () => {
if (window.openModal) {
window.openModal('新建分组', '', (v) => {
const name = (v || '').trim();
if (!name) return;
if (!groups[cur]) groups[cur] = [];
if (groups[cur].some(g => g[0] === name)) { toast('分组「' + name + '」已存在'); return; }
groups[cur].push([name, []]);
saveGroups(groups);
renderGroupsBar();
render();
renderMgList();
mask.hidden = true;
});
}
});
}
function attachGroupRowDrag(row, gi) {
const handle = row.querySelector('.mg-handle');
if (!handle) return;
handle.addEventListener('pointerdown', (e) => {
if (e.button !== 0 && e.pointerType === 'mouse') return;
const listEl = mask.querySelector('.mg-list');
if (!listEl) return;
const rect = row.getBoundingClientRect();
const offsetY = e.clientY - rect.top;
const clone = row.cloneNode(true);
clone.classList.add('mg-drag-clone');
clone.style.position = 'fixed';
clone.style.left = rect.left + 'px';
clone.style.top = rect.top + 'px';
clone.style.width = rect.width + 'px';
clone.style.margin = '0';
document.body.appendChild(clone);
row.classList.add('mg-dragging');
let dropIdx = gi;
const onMove = (ev) => {
ev.preventDefault();
clone.style.top = (ev.clientY - offsetY) + 'px';
const rows = Array.from(listEl.querySelectorAll('.mg-row'));
dropIdx = rows.length;
for (let i = 0; i < rows.length; i++) {
if (rows[i] === row) continue;
const r = rows[i].getBoundingClientRect();
if (ev.clientY < r.top + r.height / 2) { dropIdx = i; break; }
}
listEl.querySelectorAll('.mg-drop-line').forEach(el => el.remove());
const line = document.createElement('div');
line.className = 'mg-drop-line';
if (dropIdx >= rows.length) listEl.appendChild(line);
else listEl.insertBefore(line, rows[dropIdx]);
};
const onUp = () => {
document.removeEventListener('pointermove', onMove);
document.removeEventListener('pointerup', onUp);
document.removeEventListener('pointercancel', onUp);
clone.remove();
row.classList.remove('mg-dragging');
listEl.querySelectorAll('.mg-drop-line').forEach(el => el.remove());
if (dropIdx === gi || dropIdx === gi + 1) return; // 原地未动
const grps = groups[cur] || [];
let target = dropIdx < gi ? dropIdx : dropIdx - 1;
if (target < 0) target = 0;
if (target > grps.length - 1) target = grps.length - 1;
if (target === gi) return;
const [moved] = grps.splice(gi, 1);
grps.splice(target, 0, moved);
saveGroups(groups);
renderGroupsBar();
render();
renderMgList();
toast('分组已移动');
};
document.addEventListener('pointermove', onMove, { passive: false });
document.addEventListener('pointerup', onUp);
document.addEventListener('pointercancel', onUp);
e.preventDefault();
});
}
function renderMgList() {
const listEl = mask.querySelector('.mg-list');
const grps = groups[cur] || [];
if (!grps.length) { listEl.innerHTML = '<div class="mg-empty">暂无分组，点击下方新建</div>'; return; }
listEl.innerHTML = '';
const handleSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const editSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>';
grps.forEach(([gname, arr], gi) => {
const row = document.createElement('div');
row.className = 'mg-row';
row.dataset.gidx = String(gi);
const builtin = (BUILTIN[cur] || []).some(b => b[0] === gname);
row.innerHTML = '<button class="mg-handle" aria-label="拖动排序">' + handleSvg + '</button>' +
'<span class="mg-name">' + esc(gname) + '</span><span class="mg-count">' + arr.length + ' 张</span>' +
(builtin ? '<span class="mg-tag">内置</span>' : '<button class="mg-rn" aria-label="重命名">' + editSvg + '</button><button class="mg-del">✕</button>');
attachGroupRowDrag(row, gi);
if (!builtin) {
const rnBtn = row.querySelector('.mg-rn');
if (rnBtn) rnBtn.addEventListener('click', (e) => {
e.stopPropagation();
if (window.openModal) {
window.openModal('重命名分组', gname, (v) => {
const name = String(v == null ? '' : v).trim();
if (!name) return;
if (name === gname) return;
if ((groups[cur] || []).some(g => g[0] === name)) { toast('分组「' + name + '」已存在'); return; }
const g = groups[cur][gi];
if (!g) return;
const oldName = g[0];
g[0] = name;
if (curGroup === oldName) curGroup = name;
if (selected.size) {
const newSel = new Set();
selected.forEach(k => {
const sep = k.indexOf('\u0001');
if (sep > 0 && k.slice(0, sep) === oldName) newSel.add(name + '\u0001' + k.slice(sep + 1));
else newSel.add(k);
});
selected.clear(); newSel.forEach(k => selected.add(k));
}
saveGroups(groups);
renderGroupsBar();
render();
renderMgList();
toast('已重命名为「' + name + '」');
});
}
});
row.querySelector('.mg-del').addEventListener('click', (e) => {
e.stopPropagation();
if (window.openModal) {
window.openModal('删除分组「' + gname + '」及其全部字卡？', '', () => {
const wasCur = curGroup === gname;
groups[cur] = groups[cur].filter(([g]) => g !== gname);
if (wasCur) curGroup = '';
saveGroups(groups);
if (wasCur || rendering) {
render();
} else if (!q) {
groupBlockNodes(gname).forEach(el => {
if (imgObserver) el.querySelectorAll('img[data-src]').forEach(im => { try { imgObserver.unobserve(im); } catch (e) {} });
el.remove();
});
updateCountsOnly();
} else {
render();
}
renderMgList();
}, { noInput: true });
}
});
}
listEl.appendChild(row);
});
}
mask.hidden = false;
renderMgList();
}
let manageMode = false;
const selected = new Set(); // key: 分组名 + \u0001 + 数组索引
let manageBar = null;
let mgCountEl = null;
function toggleSelect(el, gname, i) {
const k = gname + '\u0001' + i;
if (selected.has(k)) { selected.delete(k); el.classList.remove('sel'); }
else { selected.add(k); el.classList.add('sel'); }
updateCount();
}
function updateCount() {
if (mgCountEl) mgCountEl.textContent = '已选 ' + selected.size + ' 张';
}
function selectedKeys() {
const keys = [];
(groups[cur] || []).forEach(([gname, arr]) => {
if (curGroup && curGroup !== gname) return;
arr.forEach((c, i) => {
if (q) {
const terms = window.mochiSearch ? window.mochiSearch.terms(window.mochiSearch.qnorm(q)) : [q.toLowerCase()];
const mt = ccCardMatchText(c);
if (!mt || !terms.every(w => mt.indexOf(w) >= 0)) return;
}
keys.push(gname + '\u0001' + i);
});
});
return keys;
}
function delSelected() {
let removed = 0;
const touched = new Set(); // 受影响分组名
(groups[cur] || []).forEach(([gname, arr]) => {
for (let i = arr.length - 1; i >= 0; i--) {
if (selected.has(gname + '\u0001' + i)) {
touched.add(gname);
arr.splice(i, 1);
removed++;
}
}
});
if (!removed) return;
selected.clear();
scheduleSave();
if (rendering || q) { render(); updateCount(); toast('已删除 ' + removed + ' 张字卡'); return; }
touched.forEach((gname) => {
rebuildGroupAfterRemove(gname);
});
updateCountsOnly();
updateCount();
toast('已删除 ' + removed + ' 张字卡');
}
function moveSelected(target) {
const mvGroups = [];
(groups[cur] || []).forEach(([gname, arr]) => {
const mv = [];
for (let i = arr.length - 1; i >= 0; i--) {
if (selected.has(gname + '\u0001' + i)) { mv.push(arr[i]); arr.splice(i, 1); }
}
if (mv.length) mvGroups.push(mv);
});
const total = mvGroups.reduce((s, a) => s + a.length, 0);
if (!total) return;
const tg = (groups[cur] || []).find(g => g[0] === target);
if (tg) mvGroups.forEach(a => { tg[1] = tg[1].concat(a); });
selected.clear();
saveGroups(groups);
renderGroupsBar();
render();
updateCount();
toast('已移动 ' + total + ' 张字卡到「' + target + '」');
}
function enterManage() {
manageMode = true;
selected.clear();
render();
list.classList.add('cc-managing');
document.querySelectorAll('.cc-toolbar').forEach(t => { t.style.display = 'none'; });
if (!manageBar) {
manageBar = document.createElement('div');
manageBar.id = 'cc-manage-bar';
manageBar.className = 'cc-manage-bar';
manageBar.innerHTML =
'<span class="cc-m-count">已选 0 张</span>' +
'<button class="cc-m-btn" id="cc-m-all">全选</button>' +
'<button class="cc-m-btn cc-m-del" id="cc-m-del">删除</button>' +
'<button class="cc-m-btn" id="cc-m-move">移动</button>' +
'<button class="cc-m-btn" id="cc-m-exit">退出</button>';
document.body.appendChild(manageBar);
mgCountEl = manageBar.querySelector('.cc-m-count');
manageBar.querySelector('#cc-m-all').addEventListener('click', () => {
const all = selectedKeys();
if (selected.size === all.length && all.length) selected.clear();
else all.forEach(k => selected.add(k));
render();
updateCount();
});
manageBar.querySelector('#cc-m-del').addEventListener('click', () => {
if (!selected.size) { toast('请先勾选字卡'); return; }
if (window.openModal) {
const list = [];
(groups[cur] || []).forEach(([gname, arr]) => {
arr.forEach((c, i) => {
if (!selected.has(gname + '\u0001' + i)) return;
let t = c;
if (typeof t === 'string' && t.indexOf('|||') > 0 && t.slice(t.indexOf('|||') + 3).indexOf('data:audio') === 0) t = '🎵 ' + t.split('|||')[0];
else if (typeof t === 'string' && t.indexOf('data:') === 0) t = '🖼 图片';
list.push(t);
});
});
const MAX_SHOW = 30;
const shown = list.slice(0, MAX_SHOW).join('\n');
const more = list.length > MAX_SHOW ? '\n…等 ' + list.length + ' 张' : '';
window.openModal('删除选中的 ' + selected.size + ' 张字卡？', '', () => delSelected(), { noInput: true, staticText: shown + more });
}
});
manageBar.querySelector('#cc-m-move').addEventListener('click', () => {
if (!selected.size) { toast('请先勾选字卡'); return; }
const mList = (groups[cur] || []).map(g => g[0]);
if (!mList.length) { toast('当前没有分组'); return; }
if (window.openModal) {
window.openModal('移动到分组', '', (v) => moveSelected(v), {
pills: mList.map(n => ({ label: n, value: n })),
pill: mList[0],
noInput: true
});
}
});
manageBar.querySelector('#cc-m-exit').addEventListener('click', exitManage);
}
manageBar.hidden = false;
updateCount();
}
function exitManage() {
manageMode = false;
selected.clear();
list.classList.remove('cc-managing');
document.querySelectorAll('.cc-toolbar').forEach(t => { t.style.display = ''; });
if (manageBar) manageBar.hidden = true;
}
const mcBtn = document.getElementById('cc-manage-cards');
if (mcBtn) mcBtn.addEventListener('click', () => { if (manageMode) exitManage(); else enterManage(); });
function ccCardDupKey(cat, c) {
if (typeof c === 'string') return cat + '|s|' + c;
try {
return cat + '|o|' + JSON.stringify(c, (k, v) => {
if (v && typeof v === 'object' && !Array.isArray(v)) {
const o = {};
Object.keys(v).sort().forEach(k2 => { o[k2] = v[k2]; });
return o;
}
return v;
});
} catch (e) { return cat + '|r|' + Math.random(); } // 序列化失败宁可不删
}
const ccDedupe = document.getElementById('cc-dedupe');
if (ccDedupe) {
ccDedupe.addEventListener('click', () => {
let dup = 0;
Object.keys(groups).forEach(cat => {
const seen = new Set();
(groups[cat] || []).forEach(([, arr]) => {
(arr || []).forEach(c => {
const k = ccCardDupKey(cat, c);
if (seen.has(k)) dup++; else seen.add(k);
});
});
});
if (!dup) { toast('没有发现重复字卡'); return; }
if (window.openModal) {
window.openModal('去重 ' + dup + ' 张重复字卡？', '', () => {
let removed = 0;
Object.keys(groups).forEach(cat => {
const seen = new Set();
(groups[cat] || []).forEach(([, arr]) => {
const kept = [];
(arr || []).forEach(c => {
const k = ccCardDupKey(cat, c);
if (seen.has(k)) { removed++; return; }
seen.add(k); kept.push(c);
});
arr.length = 0;
arr.push.apply(arr, kept);
});
});
saveGroups(groups);
renderGroupsBar();
render();
toast('已去除 ' + removed + ' 张重复字卡');
}, {
noInput: true,
staticText: '将删除当前字卡库内同分类各分组中内容完全相同的重复字卡（跨分组也计重复，每种内容只保留 1 张，保留最先出现的那张），并同步清理各分组的数量显示。'
});
}
});
}
function ccExportExpandTokens(obj) {
const hashes = {};
let hasTok = false;
(function collect(o) {
if (typeof o === 'string') {
if (o.indexOf('@@m:') >= 0) {
hasTok = true;
const re = /@@m:([0-9a-f]{32})/g; let m;
while ((m = re.exec(o))) hashes[m[1]] = null;
}
return;
}
if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) collect(o[i]); return; }
if (o && typeof o === 'object') { Object.keys(o).forEach(k => collect(o[k])); }
})(obj);
if (!hasTok || !window.mochiMediaResolve) return Promise.resolve({ ok: 0, miss: 0 });
const list = Object.keys(hashes);
function pull(i) {
if (i >= list.length) return Promise.resolve();
const batch = list.slice(i, i + 16);
return Promise.all(batch.map(h => window.mochiMediaResolve('@@m:' + h))).then(rs => {
batch.forEach((h, j) => { if (typeof rs[j] === 'string' && rs[j]) hashes[h] = rs[j]; });
return pull(i + 16);
});
}
return pull(0).then(() => {
let ok = 0, miss = 0;
(function replace(o) {
if (Array.isArray(o)) {
for (let i = 0; i < o.length; i++) {
const c = o[i];
if (typeof c !== 'string') { replace(c); continue; }
if (c.indexOf('@@m:') < 0) continue;
if (window.mochiMediaIsToken && window.mochiMediaIsToken(c)) {
const v = hashes[c.slice(4)];
if (v) { o[i] = v; ok++; } else miss++;
} else {
o[i] = c.replace(/@@m:([0-9a-f]{32})/g, (m0, h) => hashes[h] || m0);
}
}
} else if (o && typeof o === 'object') {
Object.keys(o).forEach(k => {
const c = o[k];
if (typeof c !== 'string') { replace(c); return; }
if (c.indexOf('@@m:') < 0) return;
o[k] = c.replace(/@@m:([0-9a-f]{32})/g, (m0, h) => hashes[h] || m0);
});
}
})(obj);
return { ok: ok, miss: miss };
});
}
window.mochiCcPersistTokenize = function (prog) {
return (async function () {
const out = { ok: false, reason: '', images: 0, uniq: 0, saved: 0, written: 0, libs: [] };
if (!window.idbGet || !window.xyStore || !window.mochiMediaTokenize) { out.reason = '接口不可用（需安全上下文 + IndexedDB）'; return out; }
const libs = [{ prefix: PUB_PREFIX, key: PUB_KEY, label: '公用字卡库' }];
try { (window.getContacts ? window.getContacts() : []).forEach(function (c) { if (c && c.id) libs.push({ prefix: PUB_PREFIX + ':' + c.id, key: 'cc-groups', label: (c.name || c.id) + ' · 专属' }); }); } catch (e) {}
libs.push({ prefix: PUB_PREFIX, key: 'cc-groups', label: '旧版顶层字卡库（残留）' });
const yieldUI = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
const re = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
for (let li = 0; li < libs.length; li++) {
const L = libs[li];
let raw = null;
try { raw = await window.idbGet(L.prefix + ':' + L.key); } catch (e) {}
if (typeof raw !== 'string' || !raw) {
try { const v2 = window.xyStore(L.prefix).get(L.key); if (typeof v2 === 'string' && v2) raw = v2; } catch (e2) {}
}
if (typeof raw !== 'string' || raw.indexOf('data:image/') < 0) continue;
const seenTok = new Set();
let outStr = '', last = 0, found = 0, largeTotal = 0, replaced = 0, failed = false;
re.lastIndex = 0;
let m;
while ((m = re.exec(raw))) {
found++;
if ((found & 1023) === 0) await yieldUI();
if (m[0].length < CC_CC_TOK_MIN) continue; // 小图/占位保持内联（阈值口径同旧版）
const url = m[0];
let tok = null;
try { tok = await window.mochiMediaTokenize(url, { noCache: true }); } catch (e) {}
if (!tok) { failed = true; break; }
seenTok.add(tok);
outStr += raw.slice(last, m.index) + tok;
last = m.index + url.length;
largeTotal++;
replaced++;
if (prog) { try { prog(L.label + '：写池', replaced, 0); } catch (eP) {} }
if ((replaced & 15) === 0) await yieldUI();
}
if (failed) { seenTok.clear(); out.libs.push({ label: L.label, skipped: '令牌化不可用，本库未改动' }); continue; }
if (!largeTotal) continue;
let _poolOk = false;
try { _poolOk = await window.mochiMediaFlush(); } catch (e) { _poolOk = false; }
if (_poolOk !== true) { out.libs.push({ label: L.label, skipped: '媒体池写盘失败（存储繁忙），本库保持不变，稍后自动重试' }); continue; }
out.images += largeTotal;
outStr += raw.slice(last);
if (!replaced || outStr.length >= raw.length) continue;
try { window.xyStore(L.prefix).set(L.key, outStr); } catch (eW) { out.libs.push({ label: L.label, skipped: '写回失败' }); continue; }
try { await window.idbSet(L.prefix + ':' + L.key, outStr); } catch (eS) {}
const savedChars = raw.length - outStr.length;
out.saved += savedChars * 2;
out.uniq += seenTok.size;
out.written++;
out.libs.push({ label: L.label, found: largeTotal, uniq: seenTok.size, saved: savedChars * 2 });
if (prog) { try { prog(L.label + '：写回完成', 1, 1); } catch (eP2) {} }
await yieldUI();
}
if (out.written) { try { pubInvalidate(); } catch (eI) {} } // 池视图按令牌化后的原始键重建
out.ok = true;
return out;
})().catch(function (e) { return { ok: false, reason: '迁移异常：' + ((e && e.message) || e), images: 0, uniq: 0, saved: 0, written: 0, libs: [] }; });
};
function ccSaveExportJson(json, fname, title, tip) {
if (window.mochiExportFile) {
Promise.resolve(window.mochiExportFile(json, fname, title)).then(function (r) {
if (tip && r !== 'cancel') { try { toast(tip); } catch (e) {} }
}, function () {});
return true;
}
try {
const blob = new Blob([json], { type: 'application/json' });
const a = document.createElement('a');
const url = URL.createObjectURL(blob);
a.href = url;
a.download = fname;
document.body.appendChild(a);
a.click();
setTimeout(() => { try { a.remove(); } catch (e) {} }, 5000);
setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 300000);
if (tip) { try { toast(tip); } catch (e) {} }
return true;
} catch (e) { try { toast('导出失败'); } catch (e2) {} return false; }
}
const CC_COPY_MAX = 3 * 1024 * 1024;
function ccExportOffer(json, extra) {
const fname = 'mochi字卡库数据.json';
const doFile = function () { ccSaveExportJson(json, fname, 'mochi 字卡库数据', '已导出字卡数据' + extra); };
const doCopy = function () {
const okTip = '字卡数据已复制——发给对方后用 字卡库 →「导入数据 → 粘贴文本导入」贴进去即可';
try {
navigator.clipboard.writeText(json).then(
function () { toast(okTip); },
function () { toast('复制失败，请改用「导出文件」'); });
} catch (e) { toast('复制失败，请改用「导出文件」'); }
};
const canCopy = json.length <= CC_COPY_MAX && !!(navigator.clipboard && navigator.clipboard.writeText) && !!window.openModal;
if (!canCopy) { doFile(); return; }
window.openModal('导出字卡数据', '', function (v) {
if (v === 'copy') doCopy(); else doFile();
}, {
noInput: true, pillSubmit: true,
staticText: (extra ? extra + '\n' : '') + '选择导出方式：\n· 导出文件：自动弹系统分享/保存框（手机浏览器保存文件用这个），不支持时弹窗确认后下载\n· 复制文字：数据不大时可复制，发给对方粘贴导入',
pills: [{ label: '导出文件（推荐）', value: 'file' }, { label: '复制文字', value: 'copy' }],
pill: 'file'
});
}
const ccExport = document.getElementById('cc-export');
if (ccExport) {
const EXPORT_CATS = [
['text', '主字卡'], ['kaomoji', '颜文字'], ['emoji', 'emoji'],
['sticker', '表情包'], ['image', '图片'], ['poke', '拍一拍'], ['voice', '语音'],
['fish', '摸鱼'], ['eat', '吃饭'], ['period', '经期'], ['water', '喝水'], ['garden', '花园'],
['sync', '同频'], ['reach', '伸手'], ['cjian', '此间'], ['room', '房间'], ['piggy', '存钱罐'],
['drift', '漂流瓶'], ['interact', '互动回应'], ['music', '音乐'],
['mjfree', '梦角自由造句']
];
const ceMask = document.getElementById('cc-export-mask');
const ceCats = document.getElementById('ce-cats');
const ceGrps = document.getElementById('ce-grps');
const ceSummary = document.getElementById('ce-summary');
const ceDo = document.getElementById('ce-do');
const ceClose = document.getElementById('ce-close');
let ceState = {};
if (ceMask && ceCats && ceGrps) {
function ceInit() {
ceState = {};
EXPORT_CATS.forEach(([key]) => {
const gs = groups[key] || [];
const st = { on: gs.length > 0, grps: {} };
gs.forEach(([name]) => { st.grps[name] = true; });
ceState[key] = st;
});
}
function ceRender() {
ceCats.innerHTML = '';
EXPORT_CATS.forEach(([key, name]) => {
const gs = groups[key] || [];
const n = gs.reduce((s, g) => s + (Array.isArray(g[1]) ? g[1].length : 0), 0);
const b = document.createElement('span');
b.className = 'cc-g-chip' + (ceState[key] && ceState[key].on ? ' sel' : '');
b.textContent = name + ' ' + n;
b.addEventListener('click', () => {
const st = ceState[key];
st.on = !st.on;
if (st.on) Object.keys(st.grps).forEach(g => { st.grps[g] = true; });
ceRender();
});
ceCats.appendChild(b);
});
ceGrps.innerHTML = '';
const grpCats = EXPORT_CATS.filter(([key]) => ceState[key] && ceState[key].on && (groups[key] || []).length);
if (!grpCats.length) {
const e = document.createElement('div');
e.className = 'cc-empty';
e.textContent = '所选分类暂无分组，请先选择有字卡的分类';
ceGrps.appendChild(e);
} else {
grpCats.forEach(([key, cname]) => {
const gs = groups[key] || [];
const sec = document.createElement('div');
sec.className = 'ce-grp-sec';
const secName = document.createElement('div');
secName.className = 'ce-grp-cat';
secName.textContent = cname;
sec.appendChild(secName);
const chips = document.createElement('div');
chips.className = 'cc-groups-bar';
gs.forEach(([gname, cards]) => {
const n = Array.isArray(cards) ? cards.length : 0;
const b = document.createElement('span');
b.className = 'cc-g-chip' + (ceState[key].grps[gname] ? ' sel' : '');
b.textContent = gname + ' ' + n;
b.addEventListener('click', () => {
ceState[key].grps[gname] = !ceState[key].grps[gname];
ceRender();
});
chips.appendChild(b);
});
sec.appendChild(chips);
ceGrps.appendChild(sec);
});
}
let cards = 0, grps = 0, cats = 0;
EXPORT_CATS.forEach(([key]) => {
const st = ceState[key];
if (!st || !st.on) return;
cats++;
(groups[key] || []).forEach(([gname, cs]) => {
if (st.grps[gname]) { grps++; cards += Array.isArray(cs) ? cs.length : 0; }
});
});
ceSummary.textContent = '已选 ' + cats + ' 个分类 · ' + grps + ' 个分组 · ' + cards + ' 张字卡' +
(cards === 0 ? '（当前没有可导出的字卡：先添加字卡，或确认进的是「公用字卡」还是「专属字卡」— 两个库分开算）' : '');
if (ceDo) ceDo.disabled = cards === 0;
}
function ceOpen() { ceInit(); ceRender(); ceMask.hidden = false; }
function ceCloseFn() { ceMask.hidden = true; }
ccExport.addEventListener('click', ceOpen);
if (ceClose) ceClose.addEventListener('click', ceCloseFn);
ceMask.addEventListener('click', (e) => { if (e.target === ceMask) ceCloseFn(); });
if (ceDo) {
ceDo.addEventListener('click', () => {
try {
const out = {};
CC_ALL_TYPES.forEach(t => { out[t] = []; });
EXPORT_CATS.forEach(([key]) => {
const st = ceState[key];
if (!st || !st.on) return;
(groups[key] || []).forEach(([gname, cs]) => {
if (st.grps[gname]) out[key].push([gname, Array.isArray(cs) ? cs.slice() : []]);
});
});
ccExportExpandTokens(out).then(exp => {
let data = '';
try { data = JSON.stringify(out, null, 2); }
catch (e) { toast('导出失败：数据过大，请减少所选分类/分组后分批导出'); return; }
ceCloseFn();
ccExportOffer(data,
(exp.ok ? '（' + exp.ok + ' 张图片已从媒体池还原进文件）' : '') +
(exp.miss ? '；' + exp.miss + ' 张图片数据缺失无法还原' : ''));
});
} catch (e) { toast('导出失败'); }
});
}
}
}
const ccImportData = document.getElementById('cc-import-data');
if (ccImportData) {
const CAT_NAMES = { text: '主字卡', kaomoji: '颜文字', emoji: 'emoji', sticker: '表情包', image: '图片', poke: '拍一拍', voice: '语音', fish: '摸鱼', eat: '吃饭', period: '经期', water: '喝水', garden: '花园', sync: '同频', reach: '伸手', cjian: '此间', room: '房间', piggy: '存钱罐', drift: '漂流瓶', interact: '互动回应', music: '音乐', mjfree: '梦角自由造句' };
ccImportData.addEventListener('click', () => {
if (window.openModal) {
const curName = CAT_NAMES[cur] || '当前分类';
window.openModal('导入字卡数据', '', (mode) => {
if (mode === 'paste') { pasteImportFile(); return; }
pickImportFile(mode);
}, {
noInput: true,
pickOk: {
entry: 'cc-import-data', accept: window.mochiDataPickAccept, // #1410：留空＝不给类型线索，那批内核按自家默认弹相册（作者直派）；改读单一来源的 json 并集
skipWhen: (m) => m === 'paste',
onFiles: (files, mode) => {
const f = files && files[0];
if (!f) { toast('没有取到文件，请再选一次'); return; }
importFromFile(f, mode);
}
},
staticText: '注意：这里导入的是 json 数据文件，不能选图片；正常上传图片请点击**【批量导入】**即可。\n\n选择导入方式：\n· 追加字卡：保留现有字卡，按分组并入，重复内容自动去除\n· 导入到「' + curName + '」：文件里全部字卡都并入当前分类\n· 替换字卡：清空当前字卡库，完全使用文件内容\n· 粘贴文本导入：文件选不出来时用这个（按「追加字卡」并入）',
staticEmph: true,
pills: [
{ label: '追加字卡（自动去重）', value: 'merge' },
{ label: '导入到「' + curName + '」', value: 'current' },
{ label: '替换字卡', value: 'replace' },
{ label: '粘贴文本导入', value: 'paste' }
],
pill: 'merge'
});
}
});
function pickImportFile(mode) {
pickFiles(window.mochiDataPickAccept, false, (files) => {
const f = files && files[0];
if (!f) return;
importFromFile(f, mode);
});
}
function pasteImportFile() {
if (!window.openModal) return;
window.openModal('粘贴字卡数据', '', (txt) => {
const s = String(txt || '');
if (!s.trim()) { toast('没有粘贴到内容——请把字卡库 json 的全部文本粘进来'); return; }
let bytes = s.length;
try { bytes = new Blob([s]).size; } catch (e) {}
importFromFile({ name: '粘贴的字卡数据.json', size: bytes, _pasteText: s }, 'merge');
}, {
textarea: true, textareaRows: 8,
textareaPlaceholder: '把字卡库 json 的全部内容粘贴到这里（含开头 { 和结尾 }）',
staticText: '文件选择器打不开、或选完文件没反应时用这里：把字卡 json 的全部文本粘进下面的框，点「确定」按「追加字卡（自动去重）」并入当前字卡库（不会清空已有字卡）。'
});
}
function importFromFile(f, mode) {
{
const fname = f.name || '未命名文件';
const fsize = f.size ? Math.max(1, Math.round(f.size / 1024)) + 'KB' : '空文件';
const reader = new FileReader();
let rawHead = ''; // 诊断用文件头（先 slice 再 replace，绝不全文扫描——200MB 级文件全文 replace 本身就是一次 OOM 风险）
const diag = (why) => {
try {
if (window.__jsErrors) window.__jsErrors.push('[字卡导入] ' + why + ' | ' + fname + '·' + fsize + ' | 开头: ' + rawHead);
} catch (e0) {}
};
const oomErr = (e) => /rangeerror|out of memory|memory|内存/i.test(String((e && (e.message || e.name)) || e || ''));
const applyOk = (data) => {
try { applyImportData(data, mode); } catch (e) {
toast(oomErr(e)
? '文件约 ' + Math.max(1, Math.round(f.size / 1048576)) + 'MB，本机内存不足以一次性导入——请先在「查看存储→字卡库瘦身」删掉超大表情/图片分组后重新导出分批导入，或改用「设置→数据备份」整包恢复'
: '导入处理失败：' + ((e && e.message) || '内部错误') + '（' + fname + '）');
diag('applyImportData 异常 ' + ((e && e.message) || e));
}
};
const fail = (why) => { toast('导入失败：' + why + '（' + fname + '·' + fsize + '）'); diag(why); };
const onReadErr = () => toast('导入失败：文件读取失败，请重选文件再试');
const handleText = (raw, recover) => {
let txt = String(raw || '');
txt = txt.replace(/^[\uFEFF\u200B\u200E\u200F]+/, '');
if (!txt.trim()) { fail('文件内容为空——iCloud/网盘文件可能没下载完整，请在「文件」App 点开该文件确认有内容后再导入'); return; }
let data = null, perr = null;
try { data = JSON.parse(txt); } catch (e) { perr = e; }
if (perr) {
if (oomErr(perr)) {
fail('文件约 ' + Math.max(1, Math.round(f.size / 1048576)) + 'MB，本机内存不足以一次性解析导入——请先删掉超大表情/图片分组后重新导出分批导入，或改用「设置→数据备份」整包恢复');
return;
}
if (!recover && /\u0000/.test(txt.slice(0, 400))) {
let odd = 0, even = 0;
for (let i = 0; i < Math.min(txt.length, 400); i++) { if (txt.charCodeAt(i) === 0) { if (i % 2) odd++; else even++; } }
reader.onload = () => handleText(reader.result, 'utf16');
reader.onerror = onReadErr;
reader.readAsText(f, odd >= even ? 'utf-16le' : 'utf-16be');
return;
}
const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
if (!recover && a >= 0 && b > a && (b - a) < 80 * 1024 * 1024) { handleText(txt.slice(a, b + 1), 'trim'); return; }
const isHtml = txt.charAt(0) === '<' || /<html[\s>]/i.test(txt.slice(0, 200));
fail(isHtml
? '文件是网页不是 JSON——请在 milk 里用导出按钮重新导出，分享时选「存储到文件」'
: 'JSON 解析失败：' + ((perr && perr.message) || '内容不是合法 JSON') + (recover ? '（自救 ' + recover + ' 后仍失败）' : ''));
return;
}
if (!data || typeof data !== 'object' || Array.isArray(data)) { fail('文件顶层不是 JSON 对象'); return; }
txt = ''; raw = null;
applyOk(data);
};
if (typeof f._pasteText === 'string') {
rawHead = f._pasteText.slice(0, 300).replace(/\s+/g, ' ').slice(0, 120);
handleText(f._pasteText, 'paste');
return;
}
reader.onload = () => {
const raw = String(reader.result || '');
rawHead = raw.slice(0, 300).replace(/\s+/g, ' ').slice(0, 120);
reader.onload = null; reader.onerror = null;
handleText(raw, '');
};
reader.onerror = onReadErr;
reader.readAsText(f);
}
}
function writeImport(byCat, mode, targetCat) {
let added = 0, dup = 0;
if (mode === 'replace') {
groups = {};
CC_ALL_TYPES.forEach(t => { groups[t] = []; });
Object.keys(byCat).forEach(cat => {
const pairs = byCat[cat];
groups[cat] = pairs.map(([n, cs]) => [n, cs.slice()]);
pairs.forEach(([, cs]) => { added += cs.length; });
});
} else if (mode === 'current' && targetCat) {
if (!groups[targetCat]) groups[targetCat] = [];
Object.keys(byCat).forEach(cat => {
byCat[cat].forEach(([name, cards]) => {
const exist = groups[targetCat].find(x => x[0] === name);
if (!exist) { groups[targetCat].push([name, cards.slice()]); added += cards.length; return; }
const seen = new Set(exist[1]);
cards.forEach(c => {
if (seen.has(c)) { dup++; return; }
seen.add(c); exist[1].push(c); added++;
});
});
});
} else {
Object.keys(byCat).forEach(cat => {
if (!groups[cat]) groups[cat] = [];
byCat[cat].forEach(([name, cards]) => {
const exist = groups[cat].find(x => x[0] === name);
if (!exist) { groups[cat].push([name, cards.slice()]); added += cards.length; return; }
const seen = new Set(exist[1]);
cards.forEach(c => {
if (seen.has(c)) { dup++; return; }
seen.add(c); exist[1].push(c); added++;
});
});
});
}
return { added: added, dup: dup };
}
function applyImportData(data, mode) {
const byCat = {};
let imported = 0;
let fmt = '';
let fromBackup = false; // 全量备份提取标记：字卡计数由下方本应用格式分支统一做，计数后再补标签
if (Array.isArray(data.globalCards)) {
fmt = '（星言格式）';
const starToMochiCat = { custom: 'text', kaomoji: 'kaomoji', emojis: 'emoji', stickers: 'sticker', image: 'image', touch: 'poke', voices: 'voice' };
const groupById = {};
(Array.isArray(data.cardGroups) ? data.cardGroups : []).forEach(g => { if (g && g.id) groupById[g.id] = g; });
const imgs = (data.images && typeof data.images === 'object') ? data.images : {};
const voices = (data.voices && typeof data.voices === 'object') ? data.voices : {};
data.globalCards.forEach(c => {
if (!c || typeof c !== 'object') return;
let content = c.content;
if (typeof content === 'string' && content.indexOf('__img__') === 0) {
content = imgs[c.id] || '';
} else if (typeof content === 'string' && content.indexOf('__voice__') === 0) {
content = voices[c.id] || '';
}
if (typeof content !== 'string' || !content) return;
const cat = starToMochiCat[c.category] || 'text';
let gname = '默认';
if (c.groupId && groupById[c.groupId]) gname = groupById[c.groupId].name || '默认';
else if (c.groupName) gname = c.groupName;
if (!byCat[cat]) byCat[cat] = [];
let g = byCat[cat].find(x => x[0] === gname);
if (!g) { g = [gname, []]; byCat[cat].push(g); }
g[1].push(content);
imported++;
});
}
const milkCards = [
{ cat: 'text',    field: 'customReplies', groups: ['customReplyGroups'] },
{ cat: 'poke',    field: 'customPokes',   groups: ['customPokeGroups'] },
{ cat: 'kaomoji', field: ['customKaomojis', 'customKaomoji', 'kaomojiLibrary'], groups: ['customKaomojiGroups', 'kaomojiGroups'] },
{ cat: 'sticker', field: ['stickerLibrary', 'customStickers'], groups: ['customStickerGroups', 'stickerGroups'] },
{ cat: 'emoji',   field: 'customEmojis', groups: [] }
];
if (!fmt && milkCards.some(mc => {
const f = Array.isArray(mc.field) ? mc.field : [mc.field];
return f.some(k => Array.isArray(data[k])) || mc.groups.some(k => Array.isArray(data[k]));
})) {
fmt = '（milk 格式）';
const pickField = (keys) => {
const arr = Array.isArray(keys) ? keys : [keys];
for (const k of arr) if (Array.isArray(data[k])) return data[k];
return null;
};
const milkGroupPairs = (flat, grpKey) => {
const pairs = [];
const inGroup = new Set();
const grpArr = grpKey ? data[grpKey] : null;
if (Array.isArray(grpArr)) {
grpArr.forEach(g => {
if (!g || typeof g !== 'object') return;
const name = String(g.name || '未分组');
const cards = Array.isArray(g.items) ? g.items.filter(c => typeof c === 'string' && c) : [];
if (!cards.length) return;
cards.forEach(c => inGroup.add(c));
const exist = pairs.find(x => x[0] === name);
if (exist) exist[1] = exist[1].concat(cards);
else pairs.push([name, cards.slice()]);
});
}
if (Array.isArray(flat)) {
const loose = flat.filter(c => typeof c === 'string' && c && !inGroup.has(c));
if (loose.length) pairs.push(['未分组', loose]);
}
return pairs;
};
milkCards.forEach(mc => {
const flat = pickField(mc.field);
const grpKey = mc.groups.find(k => Array.isArray(data[k])) || null;
const pairs = milkGroupPairs(flat, grpKey);
if (!pairs.length) return;
if (!byCat[mc.cat]) byCat[mc.cat] = [];
pairs.forEach(([name, cards]) => { byCat[mc.cat].push([name, cards.slice()]); imported += cards.length; });
});
}
let bag = {}; // v3.26.x #253：从备份提取分支块内提升到函数作用域（仅备份分支填充，尾部 #139 守卫要读）
let fromPubFallback = false; // v3.26.x #253：同上提升（#139 专属页兜底取到「公用库内容」时置位，落盘前防整份复制）
if (!fmt && data && typeof data === 'object' &&
((data.ls && typeof data.ls === 'object') || (data.idb && typeof data.idb === 'object'))) {
bag = {};
['ls', 'idb'].forEach(k => {
if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) Object.assign(bag, data[k]);
});
let raw = '';
if (ccScope === 'public') {
raw = bag[PUB_PREFIX + ':' + PUB_KEY] || '';
} else {
const ap = (typeof window.activePrefix === 'function' && window.activePrefix()) || PUB_PREFIX;
raw = bag[ap + ':cc-groups'] || '';
if (!raw) {
let best = '';
Object.keys(bag).forEach(k => {
if (/^xy-home-v2:.+:cc-groups$/.test(k) && typeof bag[k] === 'string' && bag[k].length > best.length) best = bag[k];
});
raw = best;
}
if (!raw) { raw = bag[PUB_PREFIX + ':' + PUB_KEY] || ''; fromPubFallback = !!raw; }
}
try {
const parsed = JSON.parse(String(raw || ''));
const hasCards = parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
CC_ALL_TYPES.some(t => Array.isArray(parsed[t]) && parsed[t].length);
if (hasCards) { data = parsed; fromBackup = true; }
} catch (e) {}
}
if (!fmt) {
CC_ALL_TYPES.forEach(k => {
const arr = data[k];
if (!Array.isArray(arr)) return;
arr.forEach(g => {
if (!Array.isArray(g) || g.length < 2) return;
const name = String(g[0]);
const cards = Array.isArray(g[1]) ? g[1].filter(c => typeof c === 'string' && c) : [];
if (!cards.length) return;
if (!byCat[k]) byCat[k] = [];
const exist = byCat[k].find(x => x[0] === name);
if (exist) exist[1] = exist[1].concat(cards);
else byCat[k].push([name, cards.slice()]);
imported += cards.length;
});
});
}
if (fromBackup) fmt = fmt || '（全量备份提取）';
const RE_IMG = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]*$/;
const RE_MEDIA_URL = /^https?:\/\/[^\s"'<>]+$/i;
const RE_AUDIO = /^data:audio\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]*$/;
let dropped = 0;
['image', 'sticker'].forEach(cat => {
(byCat[cat] || []).forEach(pair => {
const before = pair[1].length;
pair[1] = pair[1].filter(c => { const s = String(c); return RE_IMG.test(s) || RE_MEDIA_URL.test(s); });
dropped += before - pair[1].length;
});
byCat[cat] = (byCat[cat] || []).filter(pair => pair[1].length);
});
if (byCat.voice) {
byCat.voice.forEach(pair => {
const before = pair[1].length;
pair[1] = pair[1].filter(c => {
const s = String(c);
const p = s.indexOf('|||');
return p > 0 && RE_AUDIO.test(s.slice(p + 3));
});
dropped += before - pair[1].length;
});
byCat.voice = byCat.voice.filter(pair => pair[1].length);
}
if (!imported) { toast('文件里没有可导入的字卡'); return; }
const res = writeImport(byCat, mode, cur);
if (fromPubFallback && ccScope === 'own') {
let newRaw = '';
try { newRaw = JSON.stringify(groups); } catch (e) {}
const pubBagRaw = String(bag[PUB_PREFIX + ':' + PUB_KEY] || '');
if (pubBagRaw && newRaw && newRaw === pubBagRaw) {
pubInvalidate();
renderGroupsBar();
render();
toast('备份的专属字卡库与公用库相同，已跳过写入专属库（公用字卡照常可用）');
return;
}
}
saveGroups(groups);
renderGroupsBar();
render();
if (mode === 'replace') toast('已替换字卡库 · 共 ' + res.added + ' 张字卡' + fmt + (dropped ? '，丢弃 ' + dropped + ' 条非法媒体' : ''));
else if (mode === 'current') toast('已导入 ' + res.added + ' 张字卡到「' + (CAT_NAMES[cur] || '当前分类') + '」' + fmt + (res.dup ? '，自动去重 ' + res.dup + ' 条' : '') + (dropped ? '，丢弃 ' + dropped + ' 条非法媒体' : ''));
else toast('已导入 ' + res.added + ' 张字卡' + fmt + (res.dup ? '，自动去重 ' + res.dup + ' 条' : '') + (dropped ? '，丢弃 ' + dropped + ' 条非法媒体' : ''));
}
}
const CC_FULL_MARK = 'mochi-ccfull';
const CC_FULL_CK_KEYS = ['place', 'action', 'msg'];
const CC_FULL_TA_LIBS = [['taAsk', 'ta-ask'], ['taChoose', 'ta-choose'], ['taCurious', 'ta-curious'], ['taRoast', 'ta-roast'], ['taCheckin', 'ta-checkin'], ['taInvite', 'ta-invite']];
function ccFullWithTimeout(p, ms, fb) {
return new Promise((res) => {
let done = false;
const t = setTimeout(() => { if (!done) { done = true; res(fb); } }, ms);
Promise.resolve(p).then(v => { if (!done) { done = true; clearTimeout(t); res(v); } }, () => { if (!done) { done = true; clearTimeout(t); res(fb); } });
});
}
function ccFullRd(st, k, dft) {
try { const v = JSON.parse(st.get(k) || 'null'); return v == null ? dft : v; } catch (e) { return dft; }
}
function ccFullCardCount(g) {
let n = 0;
try { Object.keys(g || {}).forEach(t => (g[t] || []).forEach(x => { if (Array.isArray(x) && Array.isArray(x[1])) n += x[1].length; })); } catch (e) {}
return n;
}
function ccFullNormCc(o) {
const out = (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
CC_ALL_TYPES.forEach(t => { if (!Array.isArray(out[t])) out[t] = []; });
return out;
}
function ccFullMergeCc(cur, inc) {
const out = ccFullNormCc(cur);
let added = 0;
Object.keys(inc || {}).forEach(t => {
if (!Array.isArray(inc[t])) return;
if (!Array.isArray(out[t])) out[t] = [];
inc[t].forEach(pair => {
if (!Array.isArray(pair) || !pair[0] || typeof pair[0] !== 'string') return;
const name = pair[0];
const cards = Array.isArray(pair[1]) ? pair[1].filter(c => typeof c === 'string' && c) : [];
let g = null;
for (let i = 0; i < out[t].length; i++) { if (Array.isArray(out[t][i]) && out[t][i][0] === name) { g = out[t][i]; break; } }
if (!g) { g = [name, []]; out[t].push(g); }
const have = new Set(g[1]);
cards.forEach(c => { if (!have.has(c)) { g[1].push(c); have.add(c); added++; } });
});
});
return { obj: out, added: added };
}
function ccFullNormItem(x) {
if (typeof x === 'string') return x.trim() ? { t: x.trim() } : null;
if (x && typeof x === 'object' && x.t != null && String(x.t).trim()) {
const o = { t: String(x.t).trim() };
if (x.grp) o.grp = String(x.grp);
return o;
}
return null;
}
function ccFullMergeItems(cur, inc) {
const arr = (Array.isArray(cur) ? cur : []).map(ccFullNormItem).filter(Boolean);
const have = {};
arr.forEach(x => { have[x.t] = true; });
let added = 0;
(Array.isArray(inc) ? inc : []).forEach(x => {
const n = ccFullNormItem(x);
if (n && !have[n.t]) { arr.push(n); have[n.t] = true; added++; }
});
return { list: arr, added: added };
}
function ccFullMergeGrpDefs(cur, inc) {
const arr = (Array.isArray(cur) ? cur : []).filter(g => g && g.id && g.name);
const byId = {}, byName = {};
arr.forEach(g => { byId[g.id] = true; byName[g.name] = true; });
let added = 0;
(Array.isArray(inc) ? inc : []).forEach(g => {
if (!g || !g.id || !g.name) return;
if (byId[g.id] || byName[g.name]) return;
arr.push({ id: g.id, name: g.name });
byId[g.id] = true; byName[g.name] = true; added++;
});
return { list: arr, added: added };
}
function ccFullMergeTa(key, inc) {
const cur = ccFullRd(store, key, null);
const base = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
if (!Array.isArray(base.questions)) base.questions = [];
if (!Array.isArray(base.groups)) base.groups = [];
const haveId = {}, haveText = {};
base.questions.forEach(q => { if (q && typeof q === 'object') { if (q.id) haveId[q.id] = true; if (q.text != null && String(q.text)) haveText[String(q.text)] = true; } });
let added = 0;
(Array.isArray(inc.questions) ? inc.questions : []).forEach(q => {
if (!q || typeof q !== 'object') return;
const t = q.text != null ? String(q.text) : '';
if (!t.trim()) return;
if (q.id && haveId[q.id]) return;
if (haveText[t]) return;
const nq = Object.assign({}, q);
if (!nq.id) nq.id = 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36) + added;
base.questions.push(nq);
haveId[nq.id] = true; haveText[t] = true; added++;
});
base.groups = ccFullMergeGrpDefs(base.groups, inc.groups).list;
store.set(key, JSON.stringify(base));
return added;
}
function ccFullMergeOff(st, key, inc) {
const cur = ccFullRd(st, key, {});
const o = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
Object.keys(inc || {}).forEach(t => {
if (!Array.isArray(inc[t])) return;
if (!Array.isArray(o[t])) o[t] = [];
inc[t].forEach(n => { if (typeof n === 'string' && o[t].indexOf(n) < 0) o[t].push(n); });
});
st.set(key, JSON.stringify(o));
}
const CC_FULL_FUN_TYPES = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music'];
function ccFullPickCc(o, keepFun) {
const out = {};
CC_ALL_TYPES.forEach(t => {
const isFun = CC_FULL_FUN_TYPES.indexOf(t) >= 0;
if (isFun !== keepFun) return;
out[t] = (o && Array.isArray(o[t])) ? o[t] : [];
});
return out;
}
function ccFullPickOff(o, keepFun) {
const out = {};
Object.keys(o || {}).forEach(t => {
const isFun = CC_FULL_FUN_TYPES.indexOf(t) >= 0;
if (isFun !== keepFun) return;
out[t] = o[t];
});
return out;
}
const liCcFullExport = document.getElementById('li-cc-full-export');
if (liCcFullExport) {
liCcFullExport.addEventListener('click', () => {
if (!window.openModal) { ccFullDoExport('all'); return; }
window.openModal('导出自定义字卡', '', (mode) => { if (mode) ccFullDoExport(mode); }, {
noInput: true,
staticText: '选择导出范围（四档）：\n· 公用聊天字卡：全桌面共享（不含互动功能字卡），含分组与停用开关\n· 专属聊天字卡：只含当前桌面联系人的字卡（不含互动功能字卡），含分组与停用开关；寻踪日常 / 今日情话 / TA 六类题库（询问 / 小问题 / 好奇 / 吐槽 / 查岗 / 邀请）随本档导出\n· 互动功能字卡（单独）：摸鱼 / 吃饭 / 经期 / 喝水 / 花园 / 同频 / 伸手 / 此间 / 房间 / 存钱罐 / 漂流瓶 / 互动回应 / 音乐——公用与专属两个库都导，含停用开关；不用这些功能可忽略本档\n· 全量导出：以上全部\n注意：「专属」「互动功能字卡（专属库部分）」换机恢复时，请切到对应联系人桌面再导入；导出文件不代替 设置→数据备份 的整包备份',
pills: [
{ label: '公用聊天字卡', value: 'pub' },
{ label: '专属聊天字卡', value: 'own' },
{ label: '互动功能字卡（单独）', value: 'fun' },
{ label: '全量导出', value: 'all' }
],
pill: 'pub'
});
});
function ccFullDoExport(scope) {
const wantPub = scope === 'all' || scope === 'pub';
const wantOwn = scope === 'all' || scope === 'own';
const wantFun = scope === 'all' || scope === 'fun';
try { toast('正在准备导出…'); } catch (e0) {}
const build = () => {
try {
const data = {};
let nItems = 0, nTa = 0;
if (wantPub || wantFun || scope === 'all') {
const rawPub = ccFullNormCc(ccFullRd(pubStore(), PUB_KEY, null));
if (wantPub) {
data.ccPub = ccFullPickCc(rawPub, false);
data.ccPubOff = ccFullPickOff(ccFullRd(pubStore(), PUB_OFF_KEY, {}), false);
}
if (wantFun) {
data.ccPubFun = ccFullPickCc(rawPub, true);
data.ccPubFunOff = ccFullPickOff(ccFullRd(pubStore(), PUB_OFF_KEY, {}), true);
}
}
if (wantOwn || wantFun) {
const rawOwn = ccFullNormCc(ccFullRd(store, 'cc-groups', null));
if (wantOwn) {
data.ccOwn = ccFullPickCc(rawOwn, false);
data.ccOwnOff = ccFullPickOff(ccFullRd(store, OFF_KEY, {}), false);
}
if (wantFun) {
data.ccOwnFun = ccFullPickCc(rawOwn, true);
data.ccOwnFunOff = ccFullPickOff(ccFullRd(store, OFF_KEY, {}), true);
}
}
if (wantOwn) {
data.checkin = {};
CC_FULL_CK_KEYS.forEach(k => {
data.checkin[k] = {
list: ccFullRd(store, 'checkin-cards-' + k, []),
groups: ccFullRd(store, 'checkin-cards-groups-' + k, [])
};
});
data.quote = {
list: ccFullRd(store, 'quote-cards', []),
groups: ccFullRd(store, 'quote-cards-groups', [])
};
CC_FULL_TA_LIBS.forEach(([name, key]) => {
const d = ccFullRd(store, key, null);
data[name] = (d && typeof d === 'object' && !Array.isArray(d))
? { questions: Array.isArray(d.questions) ? d.questions : [], groups: Array.isArray(d.groups) ? d.groups : [] }
: { questions: [], groups: [] };
});
CC_FULL_CK_KEYS.forEach(k => { nItems += Array.isArray(data.checkin[k].list) ? data.checkin[k].list.length : 0; });
nItems += Array.isArray(data.quote.list) ? data.quote.list.length : 0;
CC_FULL_TA_LIBS.forEach(([name]) => { nTa += Array.isArray(data[name].questions) ? data[name].questions.length : 0; });
}
const out = { app: CC_FULL_MARK, v: 1, scope: scope || 'all', time: Date.now(), data: data };
const expJobs = [];
['ccPub', 'ccPubFun', 'ccOwn', 'ccOwnFun'].forEach(k => { if (data[k]) expJobs.push(ccExportExpandTokens(data[k])); });
const zero = () => ({ ok: 0, miss: 0 });
ccFullWithTimeout(
Promise.all(expJobs).catch(() => expJobs.map(zero)),
8000,
expJobs.map(zero)
).then(rs => {
const okN = rs.reduce((s, r) => s + (r.ok || 0), 0), missN = rs.reduce((s, r) => s + (r.miss || 0), 0);
const scopeName = scope === 'pub' ? '公用聊天字卡' : scope === 'own' ? '专属聊天字卡' : scope === 'fun' ? '互动功能字卡' : '全量字卡';
const fname = scope === 'pub' ? 'mochi自定义字卡-公用.json' : scope === 'own' ? 'mochi自定义字卡-专属.json' : scope === 'fun' ? 'mochi自定义字卡-互动功能.json' : 'mochi自定义字卡全量.json';
const parts = [];
if (wantPub || wantFun) {
const nPub = (wantPub ? ccFullCardCount(data.ccPub) : 0) + (wantFun ? ccFullCardCount(data.ccPubFun) : 0);
if (nPub) parts.push('公用库 ' + nPub + ' 张');
}
if (wantOwn || wantFun) {
const nOwn = (wantOwn ? ccFullCardCount(data.ccOwn) : 0) + (wantFun ? ccFullCardCount(data.ccOwnFun) : 0);
if (nOwn) parts.push('专属库 ' + nOwn + ' 张');
}
if (wantOwn) { parts.push('寻踪/情话 ' + nItems + ' 条'); parts.push('TA 题库 ' + nTa + ' 题'); }
if (!parts.length) parts.push('0 张');
ccSaveExportJson(JSON.stringify(out), fname, 'mochi 自定义字卡（' + scopeName + '）',
'已导出' + scopeName + '：' + parts.join(' · ') +
(okN ? ' · ' + okN + ' 张图片已从媒体池还原进文件' : '') +
(missN ? '；' + missN + ' 张图片数据缺失无法还原' : ''));
});
} catch (e) { toast('导出失败：' + ((e && e.message) || '内部错误')); }
};
ccFullWithTimeout(Promise.resolve(hydrateLibScopes(['public', 'own'])).catch(() => {}), 4000, null).then(build);
}
}
const liCcFullImport = document.getElementById('li-cc-full-import');
if (liCcFullImport) {
liCcFullImport.addEventListener('click', () => {
if (!window.openModal) return;
window.openModal('导入自定义字卡', '', (mode) => { ccFullPickFile(mode); }, {
noInput: true,
pickOk: {
entry: 'li-cc-full-import', accept: window.mochiDataPickAccept, // #1410：同上
onFiles: (files, mode) => {
const f = files && files[0];
if (!f) { toast('没有取到文件，请再选一次'); return; }
ccFullImportFile(f, mode);
}
},
staticText: '导入范围：文件里包含的各库（公用聊天字卡 / 专属聊天字卡 / 互动功能字卡 / 寻踪日常 / 今日情话 / TA 六类题库）——公用、专属、互动功能、全量四种导出文件都支持，文件里没有的部分不动。\n注意：「专属」部分会导入到当前桌面联系人——如文件来自别的桌面，请先切到对应联系人桌面再导入。\n选择导入方式：\n· 追加合并：保留现有字卡，按内容去重并入（推荐）\n· 整包替换：文件里包含的各库清空后完全使用文件内容，未包含在文件里的现有字卡会丢失',
pills: [
{ label: '追加合并（自动去重）', value: 'merge' },
{ label: '整包替换（覆盖现有）', value: 'replace' }
],
pill: 'merge'
});
});
function ccFullPickFile(mode) {
pickFiles(window.mochiDataPickAccept, false, (files) => ccFullImportFile(files && files[0], mode));
}
function ccFullImportFile(f, mode) {
if (!f) return;
const fname = f.name || '未命名文件';
const reader = new FileReader();
const fail = (why) => toast('导入失败：' + why + '（' + fname + '）');
const handleText = (raw, recover) => {
let txt = String(raw || '');
txt = txt.replace(/^[\uFEFF\u200B\u200E\u200F]+/, '');
if (!txt.trim()) { fail('文件内容为空——iCloud/网盘文件可能没下载完整'); return; }
let data = null, perr = null;
try { data = JSON.parse(txt); } catch (e) { perr = e; }
if (perr) {
if (/rangeerror|out of memory|内存/i.test(String((perr && (perr.message || perr.name)) || perr || ''))) { fail('文件过大，本机内存不足以一次性解析导入'); return; }
if (!recover && /\u0000/.test(txt.slice(0, 400))) {
let odd = 0, even = 0;
for (let i = 0; i < Math.min(txt.length, 400); i++) { if (txt.charCodeAt(i) === 0) { if (i % 2) odd++; else even++; } }
reader.onload = () => handleText(reader.result, 'utf16');
reader.onerror = () => fail('文件读取失败');
reader.readAsText(f, odd >= even ? 'utf-16le' : 'utf-16be');
return;
}
const ja = txt.indexOf('{'), jb = txt.lastIndexOf('}');
if (!recover && ja >= 0 && jb > ja && (jb - ja) < 80 * 1024 * 1024) { handleText(txt.slice(ja, jb + 1), 'trim'); return; }
fail('JSON 解析失败：' + ((perr && perr.message) || '内容不是合法 JSON'));
return;
}
txt = ''; raw = null;
const d = (data && typeof data === 'object' && !Array.isArray(data)) ? data.data : null;
if (!d || typeof d !== 'object' || data.app !== CC_FULL_MARK) {
fail('不是「自定义字卡导出」文件——公用/专属聊天字卡请进对应管理页用「导入数据」，整包恢复请用「设置→数据备份」');
return;
}
ccFullWithTimeout(Promise.resolve(hydrateLibScopes(['public', 'own'])).catch(() => {}), 4000, null).then(() => { ccFullApply(d, mode); });
};
reader.onload = () => {
const raw = String(reader.result || '');
reader.onload = null; reader.onerror = null;
handleText(raw, '');
};
reader.onerror = () => toast('导入失败：文件读取失败，请重选文件再试');
reader.readAsText(f);
}
function ccFullApply(d, mode) {
try {
const stat = { cc: 0, items: 0, ta: 0 };
if (mode === 'replace') {
const repCc = (st, key, chatKey, funKey) => {
const incChat = d[chatKey], incFun = d[funKey];
const hasChat = incChat && typeof incChat === 'object', hasFun = incFun && typeof incFun === 'object';
if (!hasChat && !hasFun) return;
const cur = ccFullNormCc(ccFullRd(st, key, {}));
const chatObj = hasChat ? ccFullNormCc(incChat) : null;
const legacyFull = hasChat && CC_FULL_FUN_TYPES.some(t => (chatObj[t] || []).length);
let obj;
if (legacyFull) { obj = chatObj; stat.cc += ccFullCardCount(chatObj); }
else {
obj = hasChat ? ccFullMergeCc(ccFullPickCc(cur, true), chatObj).obj : ccFullPickCc(cur, false);
obj = hasFun ? ccFullMergeCc(obj, ccFullNormCc(incFun)).obj : obj;
if (hasChat) stat.cc += ccFullCardCount(chatObj);
if (hasFun) stat.cc += ccFullCardCount(incFun);
}
st.set(key, JSON.stringify(obj));
};
repCc(pubStore(), PUB_KEY, 'ccPub', 'ccPubFun');
repCc(store, 'cc-groups', 'ccOwn', 'ccOwnFun');
const repOff = (st, key) => {
const cur = ccFullRd(st, key, {});
const srcs = [];
['ccPubOff', 'ccPubFunOff'].forEach(k => { const v = d[k]; if (v && typeof v === 'object' && !Array.isArray(v)) srcs.push(v); });
if (!srcs.length) return;
const incCats = {};
srcs.forEach(s => Object.keys(s).forEach(t => { incCats[t] = true; }));
const o = {};
Object.keys(cur || {}).forEach(t => { if (!incCats[t] && Array.isArray(cur[t])) o[t] = cur[t]; });
srcs.forEach(s => Object.keys(s).forEach(t => { if (Array.isArray(s[t])) o[t] = s[t]; }));
st.set(key, JSON.stringify(o));
};
repOff(pubStore(), PUB_OFF_KEY);
repOff(store, OFF_KEY);
CC_FULL_CK_KEYS.forEach(k => {
const c = d.checkin && d.checkin[k];
if (!c || typeof c !== 'object') return;
store.set('checkin-cards-' + k, JSON.stringify(Array.isArray(c.list) ? c.list : []));
store.set('checkin-cards-groups-' + k, JSON.stringify(Array.isArray(c.groups) ? c.groups : []));
stat.items += Array.isArray(c.list) ? c.list.length : 0;
});
if (d.quote && typeof d.quote === 'object') {
store.set('quote-cards', JSON.stringify(Array.isArray(d.quote.list) ? d.quote.list : []));
store.set('quote-cards-groups', JSON.stringify(Array.isArray(d.quote.groups) ? d.quote.groups : []));
stat.items += Array.isArray(d.quote.list) ? d.quote.list.length : 0;
}
CC_FULL_TA_LIBS.forEach(([name, key]) => {
const inc = d[name];
if (!inc || typeof inc !== 'object') return;
store.set(key, JSON.stringify({
questions: Array.isArray(inc.questions) ? inc.questions : [],
groups: Array.isArray(inc.groups) ? inc.groups : []
}));
stat.ta += Array.isArray(inc.questions) ? inc.questions.length : 0;
});
} else {
if (d.ccPub && typeof d.ccPub === 'object') { const r = ccFullMergeCc(ccFullRd(pubStore(), PUB_KEY, {}), d.ccPub); pubStore().set(PUB_KEY, JSON.stringify(r.obj)); stat.cc += r.added; }
if (d.ccOwn && typeof d.ccOwn === 'object') { const r = ccFullMergeCc(ccFullRd(store, 'cc-groups', {}), d.ccOwn); store.set('cc-groups', JSON.stringify(r.obj)); stat.cc += r.added; }
if (d.ccPubOff && typeof d.ccPubOff === 'object') ccFullMergeOff(pubStore(), PUB_OFF_KEY, d.ccPubOff);
if (d.ccPubFunOff && typeof d.ccPubFunOff === 'object') ccFullMergeOff(pubStore(), PUB_OFF_KEY, d.ccPubFunOff);
if (d.ccOwnOff && typeof d.ccOwnOff === 'object') ccFullMergeOff(store, OFF_KEY, d.ccOwnOff);
if (d.ccOwnFunOff && typeof d.ccOwnFunOff === 'object') ccFullMergeOff(store, OFF_KEY, d.ccOwnFunOff);
CC_FULL_CK_KEYS.forEach(k => {
const c = d.checkin && d.checkin[k];
if (!c || typeof c !== 'object') return;
const r1 = ccFullMergeItems(ccFullRd(store, 'checkin-cards-' + k, []), c.list);
store.set('checkin-cards-' + k, JSON.stringify(r1.list));
store.set('checkin-cards-groups-' + k, JSON.stringify(ccFullMergeGrpDefs(ccFullRd(store, 'checkin-cards-groups-' + k, []), c.groups).list));
stat.items += r1.added;
});
if (d.quote && typeof d.quote === 'object') {
const r1 = ccFullMergeItems(ccFullRd(store, 'quote-cards', []), d.quote.list);
store.set('quote-cards', JSON.stringify(r1.list));
store.set('quote-cards-groups', JSON.stringify(ccFullMergeGrpDefs(ccFullRd(store, 'quote-cards-groups', []), d.quote.groups).list));
stat.items += r1.added;
}
CC_FULL_TA_LIBS.forEach(([name, key]) => {
const inc = d[name];
if (!inc || typeof inc !== 'object') return;
stat.ta += ccFullMergeTa(key, inc);
});
}
pubInvalidate();
refreshLibCounts(true);
if (window.quoteCardsRefreshCounts) { try { window.quoteCardsRefreshCounts(); } catch (e) {} }
if (window.ckCardsRefreshCounts) { try { window.ckCardsRefreshCounts(); } catch (e) {} }
toast(mode === 'replace'
? '已整包替换：聊天字卡 ' + stat.cc + ' 张 · 寻踪/情话 ' + stat.items + ' 条 · TA 题库 ' + stat.ta + ' 题'
: '已合并导入：聊天字卡新增 ' + stat.cc + ' 张 · 寻踪/情话新增 ' + stat.items + ' 条 · TA 题库新增 ' + stat.ta + ' 题');
} catch (e) {
toast('导入处理失败：' + ((e && e.message) || '内部错误'));
try { if (window.__jsErrors) window.__jsErrors.push('[字卡全量导入] ' + ((e && e.message) || e)); } catch (e0) {}
}
}
}
const ccClearAll = document.getElementById('cc-clear-all');
if (ccClearAll) {
ccClearAll.addEventListener('click', () => {
if (window.openModal) {
const total = totalCount(groups);
window.openModal('清除全部字卡？', '', () => {
Object.keys(groups).forEach(t => {
groups[t] = [];
});
if (manageMode) exitManage();
q = '';
curGroup = '';
try { nameStore(ccOffScope()).set(nameKey(ccOffScope()), '{}'); } catch (e0) {}
namesInvalidate();
const si = document.getElementById('cc-search-input');
if (si) si.value = '';
selected.clear();
saveGroups(groups);
renderGroupsBar();
render();
toast('已清除全部字卡与分组');
}, { noInput: true, staticText: '将删除全部 ' + total + ' 张字卡及所有分组（主字卡、颜文字、emoji、表情包、图片、拍一拍、语音及其他互动功能字卡），且无法恢复。确定继续吗？' });
}
});
}
function showImportTopOk() {
const mask = document.getElementById('modal-mask');
const modal = mask ? mask.querySelector('.modal') : null;
const title = document.getElementById('modal-title');
if (!mask || !modal || !title) return;
let bar = document.getElementById('cc-modal-topbar');
if (!bar || bar.parentNode !== modal) {
bar = document.createElement('div');
bar.id = 'cc-modal-topbar';
bar.className = 'cc-modal-topbar';
const btn = document.createElement('button');
btn.id = 'cc-modal-top-ok';
btn.className = 'cc-modal-top-ok';
btn.textContent = '确定';
btn.addEventListener('click', () => {
const ok = document.getElementById('modal-ok');
if (ok) ok.click();
});
bar.appendChild(btn);
modal.insertBefore(bar, title);
bar.insertBefore(title, btn);
}
if (mask && !mask.__ccTopOkWatch) {
mask.__ccTopOkWatch = true;
new MutationObserver(() => {
if (!mask.hidden) return;
const b = document.getElementById('cc-modal-topbar');
if (b && b.parentNode === modal) {
modal.insertBefore(title, b);
b.remove();
}
}).observe(mask, { attributes: true, attributeFilter: ['hidden'] });
}
}
const impBtn = document.getElementById('cc-import');
if (impBtn) {
function ccImportMedia(files) {
if (!files || !files.length) return;
if (!groups[cur]) groups[cur] = [];
let g = null;
if (curGroup) {
g = groups[cur].find(g => g[0] === curGroup);
if (!g) { g = [curGroup, []]; groups[cur].push(g); }
} else {
const defName = IMG_TYPES[cur];
g = groups[cur].find(g => g[0] === defName);
if (!g) { g = [defName, []]; groups[cur].push(g); }
}
let done = 0;
let skipped = 0;
let notAudio = 0;
let badResolve = 0; // 解析/解码失败的图片计数（旧版静默「加载不出来」）
let gifSaved = 0;  // 动图直存（跳过压缩）计数
let cmpSaved = 0;  // 静态图压缩成功计数
const sizeLimit = cur === 'voice' ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
files.forEach((f) => {
const settleOne = () => { if (done === files.length) finishUpload(done - skipped - notAudio - badResolve, skipped, notAudio, badResolve); };
if (f.size > sizeLimit) {
skipped++;
done++;
settleOne();
return;
}
const reader = new FileReader();
reader.onload = () => {
if (cur === 'voice') {
const rvm = /^data:([^;,]*);/.exec(reader.result || '');
const rvMime = rvm ? rvm[1] : '';
const isVideo = (f.type && f.type.indexOf('video/') === 0) || rvMime.indexOf('video/') === 0;
const isAudio = audioMimeFromName(f.name) || (f.type && f.type.indexOf('audio/') === 0) || rvMime.indexOf('audio/') === 0;
if (isVideo || !isAudio) {
notAudio++;
done++;
settleOne();
return;
}
}
const process = (data) => {
const val = cur === 'voice' ? ((f.name || '音频').replace(/\.[^.]+$/, '') + '|||' + data) : data;
const commit = (v) => { g[1].push(v); done++; settleOne(); };
if (cur !== 'voice' && window.mochiMediaTokenize && typeof data === 'string' && data.length >= CC_CC_TOK_MIN) {
try { window.mochiMediaTokenize(data).then((tok) => commit(tok || val)).catch(() => commit(val)); return; } catch (e) { commit(val); return; }
}
commit(val);
};
if (cur === 'voice') process(normalizeAudioDataURL(reader.result, f));
else {
let src = String(reader.result || '');
try { const mime = window.chatFixNoMimeImg ? window.chatFixNoMimeImg(src) : ''; if (mime) src = mime; } catch (e0) {}
const isGif = /image\/gif/i.test(f.type || '') || /\.gif$/i.test(f.name || '') || /^data:image\/gif;/i.test(src);
if (isGif) {
if (String(reader.result || '').length > CC_GIF_MAX_B64) {
skipped++; done++;
settleOne();
toast('GIF「' + ((f && f.name) || '动图') + '」超过 380KB，已跳过');
return;
}
gifSaved++;
process(src); return;
}
const isImg = cur === 'image';
compressImage(src, isImg ? 720 : 480, isImg ? 'image/jpeg' : 'image/png', isImg ? 0.85 : undefined).then((data) => {
if (!data) { badResolve++; done++; settleOne(); return; }
cmpSaved++;
process(data);
});
}
};
reader.onerror = () => { badResolve++; done++; settleOne(); toast('有图片读取失败，已跳过（可换一张再试）'); };
reader.readAsDataURL(f);
});
function finishUpload(ok, skip, skipNotAudio, bad) {
scheduleSave();
renderGroupsBar();
render();
const msgs = [];
if (ok > 0) msgs.push('已上传 ' + ok + ' 个' + (cur === 'voice' ? '音频' : '图片'));
if (gifSaved > 0) msgs.push('动图无法压缩，「' + gifSaved + '」个按原图存入');
if (cmpSaved > 0) msgs.push('已自动压缩 ' + cmpSaved + ' 个静态图');
if (skip > 0) msgs.push('跳过 ' + skip + ' 个超大文件（' + (cur === 'voice' ? '音频>10MB' : '图片>20MB') + '）');
if (skipNotAudio > 0) msgs.push('跳过 ' + skipNotAudio + ' 个视频/非音频（语音分类只支持音频）');
if (bad > 0) msgs.push(bad + ' 个图片无法解析/已跳过（可能是格式不受支持或已损坏）');
if (!msgs.length) msgs.push('没有可上传的文件');
toast(msgs.join('，'));
}
}
function ccLayImportSurface(hostEl, surfId) {
if (!hostEl || !window.mochiFilePickSurface) return null;
const inp = hostEl.querySelector('input[data-file-pick-surface]');
if (inp) {
try { inp.accept = cur === 'voice' ? '' : 'image/*'; inp.multiple = true; } catch (e) {}
return inp; // 已铺，复用（幂等，不随 render 堆积节点）
}
const _ccSurf = window.mochiFilePickSurface(hostEl, {
id: surfId,
accept: cur === 'voice' ? '' : 'image/*',
multiple: true,
onFiles: ccImportMedia
});
try { if (_ccSurf) _ccSurf.accept = cur === 'voice' ? '' : 'image/*'; } catch (e) {}
return _ccSurf;
}
function ccDropImportSurface(hostEl) {
const inp = hostEl && hostEl.querySelector ? hostEl.querySelector('input[data-file-pick-surface]') : null;
if (inp) { try { inp.remove(); } catch (e) {} }
}
function syncCcImportSurface() {
try {
if (!impBtn) return;
if (!IMG_TYPES[cur]) { ccDropImportSurface(impBtn); return; }
ccLayImportSurface(impBtn, 'cc-import-media-surf');
} catch (e) {}
}
impBtn.__ccSyncSurface = syncCcImportSurface;
syncCcImportSurface(); // 初始同步一次（打开页默认文本分类＝撤层）
impBtn.addEventListener('click', () => {
if (IMG_TYPES[cur]) {
pickFiles(cur === 'voice' ? '' : 'image/*', true, (files) => { ccImportMedia(files); });
return;
}
if (window.openModal) {
showImportTopOk();
window.openModal('批量导入字卡（一行一个）', '', (raw, targetGroup) => {
const lines = String(raw || '').split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean);
if (!lines.length) { toast('没有可导入的内容'); return; }
if (!groups[cur]) groups[cur] = [];
let curGrp = null;
let imported = 0;
let dup = 0;
let newGroups = 0;
const seenMap = new Map();
const pushCard = (g, card) => {
let seen = seenMap.get(g);
if (!seen) { seen = new Set(g[1]); seenMap.set(g, seen); }
if (seen.has(card)) { dup++; return false; }
seen.add(card);
g[1].push(card);
return true;
};
if (targetGroup) {
let g = groups[cur].find(g => g[0] === targetGroup);
if (!g) { g = [targetGroup, []]; groups[cur].push(g); }
curGrp = g;
}
lines.forEach(line => {
const m = line.match(/^[【\[](.*?)[】\]](.*)$/);
if (m && m[1].trim()) {
const gname = m[1].trim();
let g = groups[cur].find(g => g[0] === gname);
if (!g) { g = [gname, []]; groups[cur].push(g); newGroups++; }
curGrp = g;
const rest = (m[2] || '').trim();
if (rest && pushCard(g, rest)) imported++;
return;
}
if (curGrp) {
if (pushCard(curGrp, line)) imported++;
} else {
let g = groups[cur].find(g => g[0] === '未分组');
if (!g) { g = ['未分组', []]; groups[cur].push(g); newGroups++; }
if (pushCard(g, line)) imported++;
}
});
scheduleSave();
renderGroupsBar();
render();
toast('已导入 ' + imported + ' 条字卡' + (dup ? '，自动去重 ' + dup + ' 条' : '') + (newGroups ? '，新建 ' + newGroups + ' 个分组' : ''));
}, {
big: true,
textarea: true,
textareaRows: 14,
textareaPlaceholder: '【日常】\n你今天真好看\n我想你了',
txtImport: true,
groups: (groups[cur] || []).map(g => g[0])
});
}
});
}
function syncLinkImportVis() {
const b = document.getElementById('cc-import-link');
if (!b) return;
b.style.display = (cur === 'sticker' || cur === 'image') ? '' : 'none';
}
function splitUrlItems(raw) {
return String(raw || '').split(/\r\n|\r|\n/)
.map(l => l.trim()).filter(Boolean)
.map(line => {
const m = line.match(/^[【\[](.*?)[】\]]\s*(.*)$/);
const rest = m ? (m[2] || '') : line;
const url = rest.trim().replace(/^[<("'\u300a\u201c]+|[>)"'\u300b\u201d]+$/g, '');
return { g: m && m[1].trim() ? m[1].trim() : '', url: url };
})
.filter(x => /^https?:\/\//i.test(x.url));
}
function fetchLinkImage(url, processData) {
const once = (u) => new Promise((resolve) => {
let settled = false;
const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
const timer = setTimeout(() => finish({ st: 'url', v: u }), 12000);
fetch(u, { mode: 'cors' }).then(res => {
if (!res.ok) throw new Error('http' + (res.status || ''));
return res.blob();
}).then(blob => {
if (!/^image\//i.test(blob.type || '')) throw new Error('notimage');
const fr = new FileReader();
fr.onload = () => {
const raw = String(fr.result || '');
if (/image\/gif/i.test(blob.type)) {
finish(raw.length > 8 * 1024 * 1024 ? { st: 'url', v: u } : { st: 'data', v: raw });
return;
}
processData(raw).then(d => finish(d ? { st: 'data', v: d } : { st: 'url', v: u }));
};
fr.onerror = () => finish({ st: 'fail', v: u });
fr.readAsDataURL(blob);
}).catch(err => {
const msg = (err && err.message) || '';
finish(/^notimage|^http/.test(msg) ? { st: 'fail', v: u } : { st: 'url', v: u });
});
});
if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
return once(url.replace(/^http:\/\//i, 'https://')).then(r => r.st === 'data' ? r : once(url));
}
return once(url);
}
function runLinkPool(urls, worker) {
const out = new Array(urls.length);
let i = 0;
function next() {
if (i >= urls.length) return Promise.resolve();
const idx = i++;
return worker(urls[idx]).then((res) => { out[idx] = res; return next(); });
}
return Promise.all([0, 1, 2, 3].map(() => next())).then(() => out);
}
let linkImportBusy = false; // 防重复提交：上一批还在抓取时不允许叠开第二批
const impLinkBtn = document.getElementById('cc-import-link');
if (impLinkBtn) {
impLinkBtn.addEventListener('click', () => {
if (cur !== 'sticker' && cur !== 'image') { toast('链接导入仅支持「表情包」和「图片」分类'); return; }
if (linkImportBusy) { toast('上一批链接还在导入中，请稍等'); return; }
if (!window.openModal) return;
window.openModal('链接导入' + MEDIA_TYPES[cur] + '（一行一个链接）', '', (raw, targetGroup) => {
const items = splitUrlItems(raw);
if (!items.length) { toast('没有可导入的图片链接（需以 http(s):// 开头）'); return; }
linkImportBusy = true;
if (!groups[cur]) groups[cur] = [];
let newGroups = 0;
const buckets = {};
const resolveBucket = (name) => {
if (!buckets[name]) {
let g = groups[cur].find(x => x[0] === name);
if (!g) { g = [name, []]; groups[cur].push(g); newGroups++; }
buckets[name] = { g: g, seen: new Set(g[1]) }; // 分组内去重：已有字卡 + 本次已导入都算重复
}
return buckets[name];
};
const jobs = items.map(it => ({ url: it.url, bucket: resolveBucket(it.g || targetGroup || curGroup || MEDIA_TYPES[cur]) }));
let okData = 0, okUrl = 0, dup = 0, fail = 0, httpSaved = 0;
toast('开始导入 ' + jobs.length + ' 个链接…');
const isImgCat = cur === 'image';
runLinkPool(jobs, (job) => fetchLinkImage(job.url, (dataUrl) =>
compressImage(dataUrl, isImgCat ? 720 : 480, isImgCat ? 'image/jpeg' : 'image/png', isImgCat ? 0.85 : undefined)
)).then(results => {
results.forEach((res, i) => {
const b = jobs[i].bucket;
if (res.st === 'fail') { fail++; return; }
if (b.seen.has(res.v)) { dup++; return; }
b.seen.add(res.v);
b.g[1].push(res.v);
if (res.st === 'data') okData++;
else {
okUrl++;
if (/^http:\/\//i.test(jobs[i].url)) httpSaved++; // 升级 https 抓取也失败才落到这里
}
});
saveGroups(groups);
renderGroupsBar();
render();
linkImportBusy = false;
const got = okData + okUrl;
toast('已导入 ' + got + ' 个' + MEDIA_TYPES[cur] +
(okUrl ? '（其中 ' + okUrl + ' 个按链接保存，需联网显示' + (httpSaved ? '；含 ' + httpSaved + ' 个 http 链接，本站可能拦截不显示' : '') + '）' : '') +
(dup ? '，跳过重复 ' + dup + ' 个' : '') +
(fail ? '，失败 ' + fail + ' 个（非图片地址）' : '') +
(newGroups ? '，新建 ' + newGroups + ' 个分组' : ''));
}, () => {
linkImportBusy = false;
toast('导入出错，请重试');
});
}, {
textarea: true,
textareaPlaceholder: 'https://example.com/sticker.png\n一行一个链接，可粘贴多个批量导入\n可用【分组名】前缀指定分组，如：【日常】https://…\n\n提示：优先尝试转存为本地图片；图床不允许跨域时按链接保存',
groups: (groups[cur] || []).map(g => g[0])
});
});
}
const MAX_AUDIO_VAULT = 16 * 1024 * 1024; // 字符数≈12MB 二进制，高于 10MB 存储上限，合法录音仍可播
let playingAudio = null;
let playingBtn = null;
function stopPlay() {
if (playingAudio) {
try { playingAudio.pause(); } catch (e) {}
try { playingAudio.removeAttribute('src'); playingAudio.load(); } catch (e) {}
try { if (playingAudio.parentNode) playingAudio.parentNode.removeChild(playingAudio); } catch (e) {}
playingAudio = null;
}
if (playingBtn) { playingBtn.classList.remove('playing'); playingBtn = null; }
}
list.addEventListener('click', (e) => {
const btn = e.target.closest('.cc-play');
if (!btn) return;
if (playingBtn === btn) { stopPlay(); return; }
const src = audioSrcMap.get(btn) || '';
if (!src) { stopPlay(); toast('音频数据不可用'); return; }
if (!/^data:audio\//.test(src)) { stopPlay(); toast('该语音数据异常，无法播放'); return; }
if (src.length > MAX_AUDIO_VAULT) { stopPlay(); toast('该语音文件过大，无法播放'); return; }
let nextAudio;
try {
nextAudio = new Audio(src);
} catch (err) {
stopPlay(); toast('该语音无法播放'); return;
}
nextAudio.style.display = 'none';
document.body.appendChild(nextAudio);
stopPlay();
playingAudio = nextAudio;
playingBtn = btn;
btn.classList.add('playing');
playingAudio.addEventListener('ended', stopPlay);
playingAudio.addEventListener('error', stopPlay);
playingAudio.play().catch(() => { stopPlay(); toast('播放失败'); });
});
renderGroupsBar();
render();
function maybeHydrateReplyPool() {
try {
if (window.hydrateLibScopes) window.hydrateLibScopes(['public', 'own']);
} catch (e) {}
}
window.getCustomCards = function () {
maybeHydrateReplyPool();
const g = replyPoolGroups();
const out = [];
Object.keys(g).forEach(t => {
if (CC_FUNC_KEYS.indexOf(t) >= 0 || t === 'status') return;
g[t].forEach(([name, arr]) => arr.forEach(c => out.push(c)));
});
return out;
};
window.getStatusCards = function () {
maybeHydrateReplyPool();
const g = replyPoolGroups();
const out = [];
(g['status'] || []).forEach(([name, arr]) => arr.forEach(c => { if (ccFuncTextOnly(c)) out.push(c); }));
return out;
};
window.getPokeCards = function () {
maybeHydrateReplyPool();
const g = replyPoolGroups();
const out = [];
(g['poke'] || []).forEach(([name, arr]) => arr.forEach(c => { if (ccFuncTextOnly(c)) out.push(c); }));
return out;
};
window.getPokeGroups = function () {
return (replyPoolGroups()['poke'] || []).slice();
};
function isMediaImg(c) {
if (typeof c !== 'string') return false;
if (c.indexOf('data:image') === 0 || /^https?:\/\/[^\s"'<>]+$/i.test(c)) return true;
if (c.indexOf('@@m:') === 0 && window.mochiMediaIsToken && window.mochiMediaIsToken(c)) {
return !(window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(c));
}
return false;
}
window.getMediaCards = function (type) {
maybeHydrateReplyPool();
const g = replyPoolGroups();
const out = [];
(g[type] || []).forEach(([name, arr]) => arr.forEach(c => {
if (type === 'voice') {
if (typeof c === 'string' && c.indexOf('|||') > 0) out.push(c);
} else if (isMediaImg(c)) {
out.push(c);
}
}));
return out;
};
window.getMediaGroups = function (type) {
const g = replyPoolGroups();
return (g[type] || []).map(([name, arr]) => [name, arr.filter(isMediaImg)]);
};
let ccFuncOwnSrc = null, ccFuncOwnMap = null;
function ccFuncTextOnly(c) {
if (typeof c !== 'string' || !c.trim()) return false;
if (c.indexOf('data:') === 0) return false;
if (c.indexOf('|||') >= 0) return false;
if (c.indexOf('@@m:') >= 0) return false;
if (window.mochiMediaIsToken && window.mochiMediaIsToken(c)) return false;
if (/^https?:\/\//i.test(c)) return false;
return true;
}
window.ccTextCardOnly = ccFuncTextOnly;
function ownFuncMap() {
let raw = null;
try { raw = store.get('cc-groups'); } catch (e) {}
if (ccFuncOwnMap && ccFuncOwnSrc === raw) return ccFuncOwnMap;
const map = {};
CC_FUNC_KEYS.forEach(k => { map[k] = []; });
try {
const g = filterGroupsByOff(buildGroupsFrom(raw), 'own');
CC_FUNC_KEYS.forEach(k => (g[k] || []).forEach(grp => {
if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
grp[1].forEach(c => { if (ccFuncTextOnly(c)) map[k].push(c); });
}));
} catch (e) {}
ccFuncOwnMap = map;
ccFuncOwnSrc = raw;
return map;
}
window.getCustomFuncCards = function (cat) {
maybeHydrateReplyPool(); if (CC_FUNC_KEYS.indexOf(cat) < 0) return []; // 取回钩与功能池守卫同行（哨兵锚）
const out = ownFuncMap()[cat].slice();
try {
const pg = filterGroupsByOff(pubGroupsRaw(), 'public');
(pg[cat] || []).forEach(grp => {
if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
grp[1].forEach(c => { if (ccFuncTextOnly(c)) out.push(c); });
});
} catch (e) {}
return out;
};
var SHRINK_EMBED_MAX = 120; // 内联表情包最长边（px）
var SHRINK_EMBED_QUOTA = 16 * 1024; // 超过此字节长度的 dataURL 才值得压（小图直接原样）
window.shrinkMediaUrl = function (src, cb) {
if (typeof src !== 'string' || src.indexOf('data:image') !== 0) { if (cb) cb(src); return; }
if (src.indexOf('base64') < 0 || src.length <= SHRINK_EMBED_QUOTA) { if (cb) cb(src); return; }
try {
var img = new Image();
img.onload = function () {
try {
var maxSide = SHRINK_EMBED_MAX;
var scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
var w = Math.max(1, Math.round((img.width || 1) * scale));
var h = Math.max(1, Math.round((img.height || 1) * scale));
var c = document.createElement('canvas');
c.width = w; c.height = h;
var ctx = c.getContext('2d');
ctx.clearRect(0, 0, w, h);
ctx.drawImage(img, 0, 0, w, h);
var out = c.toDataURL('image/png');
if (out.length < src.length) { if (cb) cb(out); return; }
} catch (e) {}
if (cb) cb(src);
};
img.onerror = function () { if (cb) cb(src); };
img.src = src;
} catch (e) { if (cb) cb(src); }
};
if (!window._shrunkStickerCache) window._shrunkStickerCache = {};
var ccShrinkGen = 0;
function warmShrunkCache() {
try {
const g = replyPoolGroups();
if (!g) return;
const jobs = [];
['sticker', 'image'].forEach(function (t) {
(g[t] || []).forEach(function (entry) {
(entry[1] || []).forEach(function (media) {
if (typeof media !== 'string' || media.indexOf('data:') !== 0) return;
if (window._shrunkStickerCache[media]) return;
jobs.push(media);
});
});
});
if (!jobs.length || typeof window.shrinkMediaUrl !== 'function') return;
const gen = ++ccShrinkGen;
(async function () {
for (let k = 0; k < jobs.length; k++) {
if (gen !== ccShrinkGen) return; // 已有更新的一轮（切了联系人/池已重建），本次作废
const media = jobs[k];
try {
await new Promise(function (res) {
let done = false;
const fin = function () { if (done) return; done = true; res(); };
window.shrinkMediaUrl(media, function (small) {
if (small !== media) { window._shrunkStickerCache[media] = small; }
fin();
});
setTimeout(fin, 3000);
});
} catch (e) { /* 单张失败不中断整轮 */ }
await new Promise(function (res) { setTimeout(res, 0); }); // 让出主线程，UI 可交互
}
})();
} catch (e) {}
}
document.addEventListener('mochi-restore-done', function warmOnce() {
document.removeEventListener('mochi-restore-done', warmOnce);
setTimeout(warmShrunkCache, 600); // 让出主线程再扫，避免启动卡顿
});
document.addEventListener('contact-switched', function warmCid() {
setTimeout(warmShrunkCache, 300);
});
window.getScopedGroups = function (type, scope) {
const src = filterGroupsByOff(
(scope === 'public') ? pubGroupsRaw() : ownPoolRaw(),
scope === 'public' ? 'public' : 'own'
);
const arr = (src[type] || []).slice();
if (type === 'sticker' || type === 'image') {
return arr.map(g => [g[0], (g[1] || []).filter(isMediaImg)]);
}
return arr;
};
window.ccMediaCardIdent = function (card) {
try {
if (typeof card !== 'string') return String(card);
const bar = card.indexOf('|||');
const body = bar >= 0 ? card.slice(bar + 3) : card;
const pre = bar >= 0 ? card.slice(0, bar + 3) : '';
if (body.indexOf('@@m:') === 0) {
const f = ccTokMemoRev.get(body);
return f ? (pre + f) : (pre + body.slice(0, 72));
}
if (body.length >= CC_MEDIA_TOKEN_THRESHOLD && body.indexOf('data:image/') === 0) return pre + ccMediaFrag(body);
return card.length > 120 ? (card.slice(0, 60) + '~' + card.length) : card;
} catch (e) { return String(card); }
};
window.ccAppendCards = function (type, group, cards, scope, _retry) {
try {
if (CC_ALL_TYPES.indexOf(type) < 0 || type === 'sticker' || type === 'image' || type === 'voice') return false;
const arr = (Array.isArray(cards) ? cards : [cards]).filter(c => typeof c === 'string' && c && c.indexOf('data:') !== 0 && c.indexOf('|||') < 0);
if (!arr.length || !group) return false;
const isPub = scope === 'public';
const authorized = _retry === 'asked';
const retry = authorized ? 0 : (_retry || 0);
const again = function (n) { setTimeout(function () { try { window.ccAppendCards(type, group, cards, scope, n); } catch (e0) {} }, 1200 * n); };
const ccHold = function (st, k, full) {
if (authorized) return false;
if (st.get(k) !== null && !window.xyBigWriteHold(st, k)) return false;
if (st.get(k) === null) { try { if (st.requestBigKey) st.requestBigKey(k); } catch (e5) {} }
let asked = 'unknown';
try { if (retry < 4 && window.idbEnsureBigKey) asked = window.idbEnsureBigKey(full); } catch (e3) { asked = 'unknown'; }
Promise.resolve(asked).then(function (state) {
if (state === 'ok' || state === 'absent') { try { window.ccAppendCards(type, group, cards, scope, 'asked'); } catch (e4) {} return; }
if (retry < 4) again(retry + 1);
}, function () { if (retry < 4) again(retry + 1); });
return true;
};
if (isPub) {
if (ccHold(pubStore(), PUB_KEY, PUB_PREFIX + ':' + PUB_KEY)) return false;
const g = buildGroupsFrom(pubStore().get(PUB_KEY));
if (!g[type]) g[type] = [];
let grp = g[type].find(p => p[0] === group);
if (!grp) { grp = [group, []]; g[type].push(grp); }
let added = 0;
arr.forEach(c => { if (grp[1].indexOf(c) < 0) { grp[1].push(c); added++; } });
if (added) {
try { pubStore().set(PUB_KEY, JSON.stringify(g)); } catch (e) {}
pubInvalidate();
libCounts.pub = -1; libCounts.pubFun = -1;
if (cur === type && !document.getElementById('page-custom-cards').hidden) { try { render(); } catch (e) {} }
}
return added > 0;
}
if (!groups) {
if (ccHold(store, 'cc-groups', window.activePrefix() + ':cc-groups')) return false;
const g0 = buildGroupsFrom(store.get('cc-groups'));
if (!g0[type]) g0[type] = [];
let grp0 = g0[type].find(p => p[0] === group);
if (!grp0) { grp0 = [group, []]; g0[type].push(grp0); }
let added0 = 0;
arr.forEach(c => { if (grp0[1].indexOf(c) < 0) { grp0[1].push(c); added0++; } });
if (added0) {
const j0 = JSON.stringify(g0);
try { store.set('cc-groups', j0); } catch (e2) {}
if (j0.length > 200 * 1024) ccEnsureDurable(0, j0); // #434 同款大值确认落盘
pubInvalidate();
libCounts.own = -1; libCounts.fun = -1;
refreshLibCounts(false);
}
return added0 > 0;
}
if (!groups[type]) groups[type] = [];
let g = groups[type].find(p => p[0] === group);
if (!g) { g = [group, []]; groups[type].push(g); }
let added = 0;
arr.forEach(c => { if (g[1].indexOf(c) < 0) { g[1].push(c); added++; } });
if (added) {
scheduleSave();
renderGroupsBar();
if (cur === type && !document.getElementById('page-custom-cards').hidden) { try { render(); } catch (e) {} }
}
return added > 0;
} catch (e) { return false; }
};
function buildGroupsFrom(raw) {
try {
const g = JSON.parse(raw || 'null');
if (g && g.text) return g;
} catch (e) {}
return { text: [], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
}
document.addEventListener('contact-switched', function () {
if (editSaveTimer) { clearTimeout(editSaveTimer); editSaveTimer = null; }
pubInvalidate();
offInvalidate(); // v3.30.x：专属停用集合按联系人隔离，切桌面必须失效缓存
namesInvalidate(); // #680：图片/表情包名称按桌面作用域存，切桌面必须失效缓存
ccAuthSeen.own = false; // v3.26.x #193：新桌面的权威键尚未取回，写守卫重新生效
libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1;
if (ccPageOpen()) { try { groups = loadGroups(); } catch (e) {} }
else groups = null;
refreshLibCounts(false);
if (ccPageOpen()) { try { renderGroupsBar(); render(); } catch (e) {} }
hydrateLibScopes(['public', 'own']);
});
window.getCustomCardsFor = function (cid) {
try { if (window.hydrateLibForCid) window.hydrateLibForCid(cid); } catch (e) {}
const g = replyPoolGroupsFor(cid);
const out = [];
Object.keys(g).forEach(t => {
if (CC_FUNC_KEYS.indexOf(t) >= 0 || t === 'status') return;
(g[t] || []).forEach(([name, arr]) => (arr || []).forEach(c => out.push(c)));
});
return out;
};
window.getPokeCardsFor = function (cid) {
try { if (window.hydrateLibForCid) window.hydrateLibForCid(cid); } catch (e) {}
const g = replyPoolGroupsFor(cid);
const out = [];
(g['poke'] || []).forEach(([name, arr]) => (arr || []).forEach(c => { if (ccFuncTextOnly(c)) out.push(c); }));
return out;
};
window.getMediaCardsFor = function (cid, type) {
try { if (window.hydrateLibForCid) window.hydrateLibForCid(cid); } catch (e) {}
const g = replyPoolGroupsFor(cid);
const out = [];
(g[type] || []).forEach(([name, arr]) => (arr || []).forEach(c => {
if (type === 'voice') {
if (typeof c === 'string' && c.indexOf('|||') > 0) out.push(c);
} else if (isMediaImg(c)) {
out.push(c);
}
}));
return out;
};
(function () {
const gRoot = pubStore();
let started = false;
function run() {
if (started) return;
started = true;
const hold = () => { try { window.__ccMigHold = (window.__ccMigHold || 0) + 1; } catch (e0) {} };
try {
if (gRoot.get('cc-scope-migrated') === '1') return;
const cs = (window.getContacts && window.getContacts()) || [{ id: 'default', name: '默认' }];
if (cs.length > 1) { try { gRoot.set('cc-scope-migrated', '1'); } catch (e) {} return; }
const cid = (cs[0] && cs[0].id) || 'default';
const st = window.storeFor(cid);
const isDefault = cid === 'default';
let local = null;
try { local = buildGroupsFrom(st.get('cc-groups')); } catch (e) {}
if (isDefault && !countOf(local)) {
try { local = buildGroupsFrom(gRoot.get('cc-groups')); } catch (e) {}
}
const pick = function (data, auth) {
if (!auth) { hold(); return; }
if (!countOf(data)) { try { gRoot.set('cc-scope-migrated', '1'); } catch (e0) {} return; }
try {
const json = JSON.stringify(data);
gRoot.set(PUB_KEY, json);
const done = () => {
try { st.remove('cc-groups'); } catch (e2) {} // 迁走即清，防回复池公用+专属重复
if (isDefault) { try { gRoot.remove('cc-groups'); } catch (e2) {} }
pubInvalidate();
libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1;
if (cid === (window.__activeCid || 'default')) {
if (ccScope === 'own' && ccPageOpen()) { groups = loadGroups(); try { renderGroupsBar(); render(); } catch (e2) {} }
else refreshLibCounts(false);
} else refreshLibCounts(false);
try { gRoot.set('cc-scope-migrated', '1'); } catch (e2) {}
};
if (!window.idbSet) { done(); return; }
let p = null;
try { p = window.idbSet(PUB_PREFIX + ':' + PUB_KEY, json); } catch (e4) { p = null; }
if (p && p.then) p.then(ok => { if (ok === true) done(); else hold(); }, hold);
else done();
} catch (e) { hold(); }
};
if (window.idbGet) {
const reads = [PUB_PREFIX + ':' + cid + ':cc-groups'];
if (isDefault) reads.push(PUB_PREFIX + ':cc-groups');
const amb = reads.map(() => ({}));
Promise.all(reads.map((k, i) => window.idbGet(k, amb[i]).catch(() => { amb[i].ambiguous = true; return undefined; }))).then(vals => {
let unread = 0;
vals.forEach((v, i) => {
if (amb[i] && amb[i].ambiguous) { unread++; return; }
try {
const d = typeof v === 'string' ? JSON.parse(v) : v;
if (d && d.text && countOf(d) > countOf(local)) local = d;
} catch (e) {}
});
pick(local, unread === 0);
});
} else pick(local, true);
} catch (e) { hold(); }
}
let restoreReady = !!window.__mochiDataReady;
if (restoreReady) ownRestoreP.then(run);
else {
document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
restoreReady = true;
ownRestoreP.then(run);
});
}
})();
(function () {
const DD_KEY = 'cc-dedupe-v1';
const DD_REWRITE_LIMIT = 15 * 1024 * 1024;
const DD_PARSE_LIMIT = 96 * 1024 * 1024;
function ddLoad() {
try {
const o = JSON.parse(pubStore().get(DD_KEY) || '{}');
return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
} catch (e) { return {}; }
}
function ddSave(o) { try { pubStore().set(DD_KEY, JSON.stringify(o)); } catch (e) {} }
function ddCount(g) {
let n = 0;
try { CC_TYPES.forEach(t => (g[t] || []).forEach(x => n += (Array.isArray(x[1]) ? x[1].length : 0))); } catch (e) {}
return n;
}
function refreshAfter(cid) {
libCounts.own = -1; libCounts.fun = -1;
if (cid === (window.__activeCid || 'default')) {
pubInvalidate();
if (ccScope === 'own' && ccPageOpen()) { groups = loadGroups(); try { renderGroupsBar(); render(); } catch (e2) {} }
else refreshLibCounts(false);
} else refreshLibCounts(false);
}
function run() {
let devGB = 8;
try { devGB = navigator.deviceMemory || 8; } catch (e) {}
if (devGB < 4) return;
if (!window.idbGetAllKeys || !window.idbGet || !window.storeFor) return;
window.idbGetAllKeys().then(function (allKeys) {
const ownKeys = (allKeys || []).map(String).filter(k => /^xy-home-v2:[^:]+:cc-groups$/.test(k));
if (!ownKeys.length) return;
const marks = ddLoad();
let markDirty = false;
const pubFullKey = PUB_PREFIX + ':' + PUB_KEY;
const pubLenIdx = (window.idbBigSize && window.idbBigSize(pubFullKey)) || null;
let allSettled = typeof pubLenIdx === 'number';
if (allSettled) {
for (let z = 0; z < ownKeys.length; z++) {
const fk = ownKeys[z];
const cid0 = fk.slice(PUB_PREFIX.length + 1, fk.length - ':cc-groups'.length);
const ownLen0 = (window.idbBigSize && window.idbBigSize(fk)) || null;
if (typeof ownLen0 !== 'number' ||
!marks[cid0] || marks[cid0][0] !== pubLenIdx || marks[cid0][1] !== ownLen0) { allSettled = false; break; }
}
}
if (allSettled) return;
window.idbGet(pubFullKey).then(function (pubRaw) {
if (typeof pubRaw !== 'string' || pubRaw.length < 1024) return;
let i = 0;
(function step() {
if (i >= ownKeys.length) { if (markDirty) ddSave(marks); return; }
const full = ownKeys[i++];
const cid = full.slice(PUB_PREFIX.length + 1, full.length - ':cc-groups'.length);
const next = function () { setTimeout(step, 0); };
const ownLen = (window.idbBigSize && window.idbBigSize(full)) || null;
if (typeof ownLen !== 'number' || ownLen < 65536) {
if (typeof ownLen === 'number' && typeof pubLenIdx === 'number') { marks[cid] = [pubLenIdx, ownLen]; markDirty = true; }
next(); return;
}
if (marks[cid] && marks[cid][0] === pubRaw.length && marks[cid][1] === ownLen) { next(); return; }
if (pubRaw.length + ownLen > DD_PARSE_LIMIT) {
marks[cid] = [pubRaw.length, ownLen]; markDirty = true; next(); return;
}
window.idbGet(full).then(function (ownRaw) {
try {
if (typeof ownRaw !== 'string' || ownRaw.length < 1024) {
marks[cid] = [pubRaw.length, (typeof ownRaw === 'string' ? ownRaw.length : 0)]; markDirty = true; next(); return;
}
if (ownRaw === pubRaw) {
try { window.storeFor(cid).remove('cc-groups'); } catch (e2) {}
delete marks[cid]; markDirty = true;
try { toast('已清理与公用字卡库完全重复的专属库「' + cid + '」（省 ' + Math.round(ownRaw.length / 1048576) + 'MB）'); } catch (e2) {}
refreshAfter(cid);
next(); return;
}
if (ownRaw.length + pubRaw.length > DD_PARSE_LIMIT) {
marks[cid] = [pubRaw.length, ownRaw.length]; markDirty = true; next(); return;
}
const pubG = buildGroupsFrom(pubRaw);
const ownG = buildGroupsFrom(ownRaw);
const pubIdx = {};
CC_TYPES.forEach(t => {
pubIdx[t] = {};
(pubG[t] || []).forEach(g => { if (Array.isArray(g) && g[0] != null && !(g[0] in pubIdx[t])) pubIdx[t][String(g[0])] = JSON.stringify(g[1] || []); });
});
const reduced = {};
let removedCards = 0;
CC_TYPES.forEach(t => {
reduced[t] = (ownG[t] || []).filter(g => {
if (!Array.isArray(g)) return false;
const key = String(g[0]);
const pubCards = pubIdx[t] && pubIdx[t][key];
if (pubCards != null && pubCards === JSON.stringify(g[1] || [])) { removedCards += (g[1] || []).length; return false; }
return true;
});
});
if (!ddCount(reduced)) {
try { window.storeFor(cid).remove('cc-groups'); } catch (e2) {}
delete marks[cid]; markDirty = true;
try { toast('专属库「' + cid + '」的 ' + removedCards + ' 张字卡与公用库重复，已清理'); } catch (e2) {}
refreshAfter(cid);
next(); return;
}
const newRaw = JSON.stringify(reduced);
if (removedCards > 0 && newRaw.length < DD_REWRITE_LIMIT && newRaw.length < ownRaw.length) {
try { window.storeFor(cid).set('cc-groups', newRaw); } catch (e2) {}
try { toast('专属库「' + cid + '」去重 ' + removedCards + ' 张与公用重复的字卡（省 ' + Math.round((ownRaw.length - newRaw.length) / 1048576) + 'MB）'); } catch (e2) {}
refreshAfter(cid);
marks[cid] = [pubRaw.length, newRaw.length];
} else {
marks[cid] = [pubRaw.length, ownRaw.length];
}
markDirty = true;
next();
} catch (e) { try { marks[cid] = [pubRaw.length, (typeof ownRaw === 'string' ? ownRaw.length : 0)]; markDirty = true; } catch (e2) {} next(); }
}).catch(next);
})();
}).catch(function () {});
}).catch(function () {});
}
let ddKicked = false;
function ddKick() { if (ddKicked) return; ddKicked = true; setTimeout(run, 30000); }
if (window.__mochiDataReady) ownRestoreP.then(ddKick);
else {
document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
ownRestoreP.then(ddKick);
});
}
setTimeout(ddKick, 60000); // restore 挂起/事件丢失兜底（ddKicked 防重入）
})();
(function () {
const gRoot = pubStore();
function done() { try { gRoot.set('cc-scope-notice-done', '1'); } catch (e) {} }
function totalMerged() {
try { return countOf(mergeWithPublic(loadGroups())); } catch (e) { return 0; }
}
function show() {
const mask = document.getElementById('cc-scope-mask');
if (!mask) { done(); return; }
const sum = document.getElementById('csn-summary');
if (sum) sum.textContent = '已检测到你现有的字卡共 ' + totalMerged() + ' 张（公用 + 当前桌面专属）';
const finish = function () { mask.hidden = true; done(); };
const ex = document.getElementById('csn-export');
const ok = document.getElementById('csn-ok');
const cl = document.getElementById('csn-close');
if (ex) ex.addEventListener('click', function () {
const payload = mergeWithPublic(loadGroups());
ccExportExpandTokens(payload).then(function (exp) {
try {
let data = '';
try { data = JSON.stringify(payload, null, 2); }
catch (e) { toast('导出失败：字卡数据过大，请到字卡库分分类导出'); finish(); return; }
ccSaveExportJson(data, 'mochi字卡库备份.json', 'mochi 字卡库备份',
'字卡备份已导出' + (exp.miss ? '；' + exp.miss + ' 张图片数据缺失无法还原' : ''));
} catch (e) { toast('导出失败'); }
finish();
});
});
if (ok) ok.addEventListener('click', finish);
if (cl) cl.addEventListener('click', finish);
mask.addEventListener('click', function (e) { if (e.target === mask) finish(); });
mask.hidden = false;
}
function boot() {
setTimeout(function () {
try {
if (gRoot.get('cc-scope-notice-done') === '1') return;
if (!totalMerged()) { done(); return; } // 全新空库不打扰
show();
} catch (e) { try { done(); } catch (e2) {} }
}, 1200);
}
if (window.__mochiDataReady) boot();
else document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
boot();
});
})();
function hydrateCurScope() {
try { if (window.__mochiPhase) window.__mochiPhase('cc-hydrate'); } catch (e0) {}
if (!window.idbHydrateKey) return Promise.resolve(false);
try { if (curStore().get(curKey())) return Promise.resolve(false); } catch (e) {}
let fk = '';
try { fk = ccScope === 'public' ? (PUB_PREFIX + ':' + PUB_KEY) : (window.activePrefix() + ':cc-groups'); } catch (e) {}
if (!hydAbsent[fk]) { try { toast('字卡较多，正在加载…'); } catch (e) {} }
return hydrateScope(ccScope === 'public' ? 'public' : 'own');
}
function todayKey() {
const d = new Date();
return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function maybeLowCardsRemind() {
try {
if (!(window.activeStore && window.activeStore().get && window.activeStore().set && window.openModal)) return;
if (CC_FUNC_KEYS.indexOf(cur) >= 0) return; // 其他互动功能字卡入口不提醒
let n = 0;
[ownPoolRaw(), pubGroupsRaw()].forEach(src => {
if (!src) return;
CC_TYPES.forEach(t => { ((src[t] || []) || []).forEach(g => { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; }); });
});
if (!(n > 0 && n < 5000)) return;
const dcfg = (window.defaultCardCfg && window.defaultCardCfg()) || {};
if (dcfg.enabled === false) return;
if (window.defaultCardUse && !window.defaultCardUse('chat')) return;
const p = window.activeStore().get('dc-overall-chat');
if (p !== null && Number(p) !== 30) return; // 已调过概率→不提醒
const tk = todayKey();
if (window.activeStore().get('cc-lowcard-remind') === tk) return; // 今天已提醒过
try { window.activeStore().set('cc-lowcard-remind', tk); } catch (e) {}
window.openModal('字卡使用提醒', '', null, {
noInput: true,
staticText: '你现在自建了 ' + n + ' 张聊天字卡，但【默认聊天字卡】的触发概率仍是默认的 30%。\n\n' +
'如果你不再多添加自建字卡、也不把【默认聊天字卡】的触发概率调高，联系人(TA)回复时可能因为自建字卡太少，一直重复使用相同内容的字卡。\n\n' +
'建议：在字卡库里多添加一些自建字卡，或在「预设字卡 → 聊天默认字卡」里把触发概率调高。\n\n' +
'（说明：只有当你完全没添加任何自建字卡时，联系人才会 100% 使用默认聊天字卡。）'
});
} catch (e) {}
}
const CC_BIG_SLIM_THRESHOLD = 16 * 1024 * 1024;
let ccSlimPrompted = false;
function ccLibTooBig() {
try {
const fk = curFullKey();
if (!fk) return 0;
let n = 0;
try { if (window.idbBigSize) n = Number(window.idbBigSize(fk)) || 0; } catch (e) {}
if (!n) { try { const v = curStore().get(curKey()); if (typeof v === 'string') n = v.length; } catch (e2) {} }
return n > CC_BIG_SLIM_THRESHOLD ? n : 0;
} catch (e) { return 0; }
}
function maybeAutoSlimLib() {
return new Promise(function (resolve) {
if (ccSlimPrompted || !window.mochiCcPersistTokenize || !window.openModal) { resolve(); return; }
const bytes = ccLibTooBig();
if (!bytes) { resolve(); return; }
ccSlimPrompted = true;
let running = false, settled = false, guard = null;
const mask = document.getElementById('modal-mask');
const finish = function () {
if (settled) return;
settled = true;
if (guard) clearTimeout(guard);
if (obs) { try { obs.disconnect(); } catch (e) {} }
resolve();
};
const obs = mask ? new MutationObserver(function () { if (!running && mask.hidden) finish(); }) : null;
if (obs) obs.observe(mask, { attributes: true, attributeFilter: ['hidden'] });
guard = setTimeout(finish, 180000); // 兜底：任何异常都不至于把开页永久卡死
const mb = (bytes / 1048576).toFixed(1);
const ctl = window.openModal('字卡库较大，先自动去重缩库？', '', function () {
if (ctl && ctl.stay) ctl.stay();
running = true;
try { if (ctl && ctl.hint) ctl.hint('正在把字卡库内联大图转成媒体池引用…\n\n处理中请勿离开本页。'); } catch (eH) {}
try { if (ctl && ctl.okText) ctl.okText('处理中…'); } catch (eO) {}
Promise.resolve(window.mochiCcPersistTokenize(function (label, dn, total) {
try { if (ctl && ctl.hint) ctl.hint('正在处理：' + label + (total ? ' ' + dn + '/' + total : '') + '\n\n处理中请勿离开本页。'); } catch (eP) {}
})).then(function (rep) {
try {
if (rep && rep.ok && rep.written) toast('字卡库已压缩约 ' + Math.round((rep.saved || 0) / 1048576) + 'MB，添加字卡不会再卡');
else toast('字卡库检查完成');
} catch (eT) {}
try { pubInvalidate(); } catch (eI) {}
try { if (ctl && ctl.close) ctl.close(); } catch (eC) {}
running = false;
finish();
}, function () {
try { if (ctl && ctl.close) ctl.close(); } catch (eC2) {}
running = false;
finish();
});
}, {
noInput: true,
staticText: '当前字卡库约 ' + mb + ' MB，过大时添加字卡容易让 iPhone/iPad 浏览器内存不足而闪退（其他机型大库同样）。\n\n'
+ '建议先做一次「字卡图去重」：把库里内联的大图转成与聊天图片相同的媒体池引用，同一张图只存一份，体积大幅缩小。\n\n'
+ '图片显示、发送完全不变；「导出数据」会自动还原成完整图片。'
});
});
}
function openCcPage(scope, startTab) {
try { if (window.__mochiPhase) window.__mochiPhase('cc-open'); } catch (e0) {}
flushCcSave();
ccScope = scope === 'public' ? 'public' : 'own';
if (poolSrcChanged()) pubInvalidate(); // #1222：原文串没变＝池视图仍新鲜，不重建
namesInvalidate(); // #680：名称缓存分作用域，切作用域必须重读
cur = (startTab && CC_ALL_TYPES.indexOf(startTab) >= 0) ? startTab : 'text';
q = ''; curGroup = '';
const ttl = document.getElementById('cc-page-title');
if (ttl) ttl.textContent = (CC_FUNC_KEYS.indexOf(cur) >= 0)
? '其他互动功能字卡·' + (ccScope === 'public' ? '公用' : '专属')
: (ccScope === 'public' ? '公用字卡' : '专属字卡');
const s1 = document.getElementById('cc-search-input');
if (s1) s1.value = '';
const ccFuncOnly = CC_FUNC_KEYS.indexOf(cur) >= 0;
tabsWrap.querySelectorAll('.cc-tab').forEach(t => {
const isFunc = CC_FUNC_KEYS.indexOf(t.dataset.type) >= 0;
const isMjfree = t.dataset.type === 'mjfree';
t.classList.toggle('sel', t.dataset.type === cur);
t.hidden = ccFuncOnly ? (!isFunc || isMjfree) : (isFunc && !isMjfree);
});
syncLinkImportVis();
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const ccPage = document.getElementById('page-custom-cards');
if (ccPage) ccPage.hidden = false;
try { groups = loadGroups(); } catch (eCcTree) {}
maybeAutoSlimLib().then(function () {
maybeLowCardsRemind(); // v3.32.x：自建聊天字卡很少时提醒默认字卡 30% 概率
try { if (!curStore().get(curKey())) showLibLoadingSoon(); } catch (eL) {}
hydrateCurScope().then(() => {
groups = loadGroups();
try { renderGroupsBar(); render(); } catch (e) {}
clearLibLoadingRow(); // #574：取回落定后无论 render 成败都摘掉加载态，不留残留占位
refreshLibCounts(false); // v3.15.x：懒加载取回后同步刷新列表页两行角标（此前停留 0 像「丢失」）
});
}); // #632 瘦身门收口
}
var libLoadTimer = null; // #574：用 var 避开「函数先于 let 执行」的 TDZ 风险（历史 TDZ 事故族）
function showLibLoadingSoon() {
try { clearTimeout(libLoadTimer); libLoadTimer = setTimeout(showLibLoadingRow, 150); } catch (e) {}
}
function showLibLoadingRow() {
try {
if (!list) return;
list.dataset.ccLoading = '1';
list.innerHTML = '<div class="cc-lib-loading"><span class="cc-spin"></span>正在加载字卡…</div>';
} catch (e) {}
}
function clearLibLoadingRow() {
try { clearTimeout(libLoadTimer); } catch (e0) {}
try {
if (!list || !list.dataset.ccLoading) return;
delete list.dataset.ccLoading;
const row = list.querySelector('.cc-lib-loading');
if (row) row.remove();
} catch (e) {}
}
function leaveCcPageReset() {
flushCcSave();
if (ccScope !== 'public') { groups = null; return; }
ccScope = 'own';
groups = null;
}
const liPub = document.getElementById('li-custom-cards-public');
if (liPub) liPub.addEventListener('click', () => openCcPage('public'));
const li = document.getElementById('li-custom-cards');
if (li) li.addEventListener('click', () => openCcPage('own'));
const liFunMine = document.getElementById('li-fun-cards-mine');
if (liFunMine) liFunMine.addEventListener('click', () => openCcPage('own', 'fish'));
const liFunPub = document.getElementById('li-fun-cards-public');
if (liFunPub) liFunPub.addEventListener('click', () => openCcPage('public', 'fish'));
const ccBack = document.getElementById('cc-back');
if (ccBack) {
ccBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const home = document.getElementById('page-chatcard');
if (home) home.hidden = false;
leaveCcPageReset();
});
}
const ccPageEl = document.getElementById('page-custom-cards');
if (ccPageEl && typeof MutationObserver !== 'undefined') {
new MutationObserver(() => {
if (ccPageEl.hidden) {
leaveCcPageReset();
if (manageMode) exitManage();
}
}).observe(ccPageEl, { attributes: true, attributeFilter: ['hidden'] });
}
const ccSectBtns = document.querySelectorAll('.cc-top-tabs .cc-tab[data-ccsect]');
const ccSectBodies = {
custom: document.getElementById('cc-sect-custom'),
preset: document.getElementById('cc-sect-preset')
};
ccSectBtns.forEach(btn => {
btn.addEventListener('click', () => {
const k = btn.getAttribute('data-ccsect');
ccSectBtns.forEach(b => b.classList.toggle('sel', b === btn));
if (searchInput2) searchInput2.value = '';
if (searchResultEl) searchResultEl.hidden = true;
Object.keys(ccSectBodies).forEach(key => {
const el = ccSectBodies[key];
if (el) el.hidden = (key !== k);
});
try { if (window.__ccRenderTabTotals) window.__ccRenderTabTotals(); } catch (e) {}
});
});
(function ccPresetLockHint() {
const el = document.getElementById('cc-preset-lock-hint');
if (!el || !window.cardLockOpen) return;
function render() {
const open = window.cardLockOpen();
el.textContent = open
? '当前状态：系统预设字卡已解锁（二级验证已通过），联系人回复与各功能可正常取用。'
: '当前状态：系统预设字卡已全部锁定（防未成年人保护，不是 bug），联系人回复与各功能均取不到系统预设字卡。不输密码也能正常使用，密码只管两件事：解锁系统预设字卡、跳过开屏的 2 个问答。注意（#499 豁免说明）：聊天情绪字卡、TA 的心情、聊天回应字卡这三大互动链不受锁定影响，未解锁也照常使用；受影响的只有默认聊天字卡、词典（含词典拼字）等系统预设池。锁定时若自定义字卡（含 mj 字卡）一张都没添加，回复会更单薄（情绪/回应字卡仍在，但少了系统预设内容），建议先在自定义字卡里添加几张；如已成年，请回开屏公告区点「输入密码解锁」输入二级验证密码，解锁后刷新生效。';
}
render();
document.addEventListener('mochi-cardlock-open', render);
document.addEventListener('mochi-cardlock-locked', render);
})();
(function ccTopTabTotals() {
if (!ccSectBtns.length) return;
function sectSum(el) {
if (!el) return 0;
let n = 0;
el.querySelectorAll('.chat-item .t').forEach(t => {
const v = parseInt(String(t.textContent == null ? '' : t.textContent).replace(/[^\d]/g, ''), 10);
if (!isNaN(v) && v > 0) n += v;
});
return n;
}
function renderTotals() {
ccSectBtns.forEach(btn => {
const k = btn.getAttribute('data-ccsect');
let em = btn.querySelector('.cc-tab-n');
if (!em) { em = document.createElement('em'); em.className = 'cc-tab-n'; btn.appendChild(em); }
const n = sectSum(ccSectBodies[k]);
const miss = k === 'preset' && window.defaultCardDataMissing && window.defaultCardDataMissing();
em.textContent = miss ? '—' : n;
em.classList.toggle('zero', !miss && n <= 0);
});
}
window.__ccRenderTabTotals = renderTotals;
let totalsTm = null;
if (typeof MutationObserver !== 'undefined') {
const mo = new MutationObserver(() => {
if (totalsTm) clearTimeout(totalsTm);
totalsTm = setTimeout(renderTotals, 120);
});
Object.keys(ccSectBodies).forEach(key => {
const el = ccSectBodies[key];
if (el) mo.observe(el, { subtree: true, childList: true, characterData: true });
});
}
renderTotals();
document.addEventListener('mochi-restore-done', renderTotals);
})();
const hydInflight = {};
const hydAbsent = {};
function hydFullKey(scope) {
return scope === 'public' ? (PUB_PREFIX + ':' + PUB_KEY) : (window.activePrefix() + ':cc-groups');
}
function hydrateScope(scope, cid) {
if (!window.idbHydrateKey) return Promise.resolve(false);
let fullKey = '', deferred = false;
try {
fullKey = cid ? ('xy-home-v2:' + cid + ':cc-groups') : hydFullKey(scope);
deferred = Array.isArray(window.__xyIdbDeferredKeys) && window.__xyIdbDeferredKeys.indexOf(fullKey) >= 0;
} catch (e) {}
if (!deferred && hydAbsent[fullKey]) return Promise.resolve(false);
var HYDRATE_TRUSTS_MEMORY = true;
if (HYDRATE_TRUSTS_MEMORY) {
let hasData = false;
try {
hasData = cid
? !!(window.storeFor && window.storeFor(cid).get('cc-groups'))
: (scope === 'public' ? !!pubStore().get(PUB_KEY) : !!store.get('cc-groups'));
} catch (e) {}
if (hasData) {
if (fullKey === curFullKey()) ccAuthMark();
return Promise.resolve(false);
}
}
if (hydInflight[fullKey]) return hydInflight[fullKey];
hydInflight[fullKey] = window.idbHydrateKey(fullKey).then(ok => {
delete hydInflight[fullKey];
if (ok === null) {
hydAbsent[fullKey] = true;
if (fullKey === curFullKey()) ccAuthMark();
return false;
}
if (fullKey === curFullKey()) ccAuthMark();
pubInvalidate();
libCounts.pub = -1; libCounts.own = -1; libCounts.fun = -1; libCounts.pubFun = -1;
const scopeLive = (scope === 'public') ? (ccScope === 'public') : (ccScope === 'own');
if (scopeLive && ccPageOpen()) {
try { groups = loadGroups(); renderGroupsBar(); render(); } catch (e) {}
}
refreshLibCounts(false);
return true;
}).catch(() => { delete hydInflight[fullKey]; return false; });
return hydInflight[fullKey];
}
let libHydChain = Promise.resolve();
function hydrateLibScopes(scopes) {
scopes.forEach(s => { libHydChain = libHydChain.then(() => hydrateScope(s)).catch(() => {}); });
return libHydChain;
}
function libScopesDeferred(scopes) {
try {
const list = window.__xyIdbDeferredKeys;
if (!Array.isArray(list)) return false;
return scopes.some(s => list.indexOf(hydFullKey(s)) >= 0);
} catch (e) { return false; }
}
window.hydrateLibScopes = function (scopes, done) {
if (!Array.isArray(scopes) || !scopes.length) scopes = ['public', 'own'];
return hydrateLibScopes(scopes).then(function () {
if (done) { try { done(); } catch (e) {} }
return true;
});
};
window.libScopesDeferred = function (scopes) {
return libScopesDeferred(Array.isArray(scopes) && scopes.length ? scopes : ['public', 'own']);
};
window.hydrateReplyScope = function (scope, done) {
return hydrateScope(scope === 'public' ? 'public' : 'own').then(function (ok) {
if (done) { try { done(ok); } catch (e) {} }
return true;
});
};
window.hydrateLibForCid = function (cid, done) {
const cur = window.__activeCid || 'default';
let p;
if (!cid || cid === cur) {
p = hydrateLibScopes(['public', 'own']);
} else {
libHydChain = libHydChain
.then(() => hydrateScope('public'))
.then(() => hydrateScope('own', cid))
.catch(() => {});
p = libHydChain;
}
return p.then(function () {
if (done) { try { done(); } catch (e) {} }
return true;
});
};
(function () {
const libPage = document.getElementById('page-chatcard');
if (libPage && typeof MutationObserver !== 'undefined') {
new MutationObserver(() => {
if (libPage.hidden) return;
refreshLibCounts(true);
if (libScopesDeferred(['public', 'own'])) {
try { toast('字卡较多，正在加载…'); } catch (e) {}
markLibCountsLoading();
hydrateLibScopes(['public', 'own']).then(function () {
try { refreshLibCounts(true); } catch (e) {}
});
return;
}
hydrateLibScopes(['public', 'own']);
}).observe(libPage, { attributes: true, attributeFilter: ['hidden'] });
}
})();
window.__ccAuditHealth = function () {
const out = { tokens: 0, missing: 0, bigMedia: 0, badVoice: 0 };
function scan(g) {
if (!g) return;
['sticker', 'image'].forEach(function (t) {
(g[t] || []).forEach(function (grp) {
if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
grp[1].forEach(function (c) {
if (typeof c !== 'string') return;
if (c.indexOf('@@m:') === 0) {
out.tokens++;
if (window.mochiMediaTokenMissing && window.mochiMediaTokenMissing(c)) out.missing++;
} else if (c.indexOf('data:image') === 0 && c.length > 512 * 1024) {
out.bigMedia++;
}
});
});
});
(g['voice'] || []).forEach(function (grp) {
if (!Array.isArray(grp) || !Array.isArray(grp[1])) return;
grp[1].forEach(function (c) {
if (typeof c !== 'string' || !c) return;
const i = c.indexOf('|||');
if (i < 0 || c.slice(i + 3).indexOf('data:audio') !== 0) out.badVoice++;
});
});
}
try { scan(ownPoolRaw()); } catch (e) {}
try { scan(pubGroupsRaw()); } catch (e) {}
return out;
};
window.__ccStorageDiag = function () {
const PRE = 'xy-home-v2:';
const BIG = 200 * 1024;
const catRe = /^(cc-groups|cc-groups-public|default-cards|quote-cards|reply-|fav-|ta-mood|poke-|emoji-|my-emoji-groups|rps-score|mh-|rc-enabled|mc-enabled|chat-count)/;
const catOf = function (k) {
const tail = k.indexOf(PRE) === 0 ? k.slice(PRE.length) : k;
const m = /^(?:[^:]+:)?(.*)$/.exec(tail);
const base = m ? m[1] : tail;
return catRe.test(base) ? 'cc' : 'other';
};
const szOf = function (v) {
if (v == null) return 0;
if (v instanceof Blob) return v.size;
if (v instanceof ArrayBuffer) return v.byteLength;
if (typeof v === 'string') return v.length * 2;
try { return JSON.stringify(v).length * 2; } catch (e) { return 0; }
};
const fmt = function (b) {
if (b < 1024) return b + 'B';
if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
return (b / 1048576).toFixed(2) + 'MB';
};
const ls = [];
try {
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || k.indexOf(PRE) !== 0) continue;
ls.push({ k: k, sz: (k.length + (localStorage.getItem(k) || '').length) * 2 });
}
} catch (e) {}
const lsCc = ls.filter(function (x) { return catOf(x.k) === 'cc'; });
const lsCcSum = lsCc.reduce(function (s, x) { return s + x.sz; }, 0);
const tail = function (k) { return k.indexOf(PRE) === 0 ? k.slice(PRE.length) : k; };
return new Promise(function (res) {
if (!window.idbListKeys || !window.idbGetMany) {
res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + '；IDB 接口不可用');
return;
}
window.idbListKeys().then(function (keys) {
if (!keys) { res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + '；IDB 清单读取失败'); return; }
const idbCc = (keys || []).map(String).filter(function (k) { return k.indexOf(PRE) === 0 && catOf(k) === 'cc'; });
if (!idbCc.length) {
res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + ' + IDB 0键');
return;
}
window.idbGetMany(idbCc).then(function (map) {
const idb = idbCc.map(function (k) { return { k: k, sz: szOf(map[k]) }; });
const idbCcSum = idb.reduce(function (s, x) { return s + x.sz; }, 0);
const all = lsCc.concat(idb).sort(function (a, b) { return b.sz - a.sz; });
const lines = [];
lines.push('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + ' + IDB ' + idb.length + '键 ' + fmt(idbCcSum) + ' = ' + (lsCc.length + idb.length) + '键 ' + fmt(lsCcSum + idbCcSum));
lines.push('Top15 大键：');
all.slice(0, 15).forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
const lsBig = lsCc.filter(function (x) { return x.sz > BIG; });
if (lsBig.length) {
lines.push('⚠ LS 残留大键（>200KB，应已迁 IDB，残留=双倍计算）：');
lsBig.forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
}
const emojiLegacy = lsCc.concat(idb).filter(function (x) { return /:[^:]+:my-emoji-groups$/.test(x.k); });
if (emojiLegacy.length) {
lines.push('⚠ 旧各桌面 my-emoji-groups 遗留（应只剩全局一份）：');
emojiLegacy.forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
}
const ownCc = lsCc.concat(idb).filter(function (x) { return /:cc-groups$/.test(x.k); }).sort(function (a, b) { return b.sz - a.sz; });
if (ownCc.length) {
lines.push('各桌面专属 cc-groups：');
ownCc.forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
}
const pubCc = lsCc.concat(idb).filter(function (x) { return x.k.indexOf(':cc-groups-public') >= 0; });
if (pubCc.length) {
lines.push('公用 cc-groups-public：');
pubCc.forEach(function (x) { lines.push('  ' + fmt(x.sz) + '  ' + tail(x.k)); });
}
res(lines.join('\n'));
}).catch(function () {
res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + ' + IDB 读取失败');
});
}).catch(function () {
res('字卡/回复/收藏明细：LS ' + lsCc.length + '键 ' + fmt(lsCcSum) + ' + IDB 清单读取失败');
});
});
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("chatcard.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("chatcard.js"); try { console.error("[JS] chatcard.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[chatcard.js] " + String(__e && __e.message || __e)); } })();
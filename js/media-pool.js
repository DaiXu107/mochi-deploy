(function () { try {
(function () {
const FULL = 'xy-home-v2:media:';
const TOK = '@@m:';
const TOKEN_RE = /^@@m:([0-9a-f]{32})$/;
const OK = typeof crypto !== 'undefined' && crypto.subtle && window.idbGet && window.idbGetMany && window.idbSetAll;
window.mochiMediaExpand = function (s) { return null; };
window.mochiMediaExpandAsync = function (s, cb) { try { cb(null); } catch (e) {} };
window.mochiMediaIsToken = function (s) { return typeof s === 'string' && TOKEN_RE.test(s); };
var KIND_HEAD_RE = /^data:([a-z0-9.+-]+)\/([a-z0-9.+-]+)[;,]/i;
var NOMIME_RE = /^data:;base64,/i;
var B64A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function noMimeImgMime(t) {
const comma = t.indexOf(',');
const b64 = comma >= 0 ? t.slice(comma + 1, comma + 1 + 48) : '';
const out = [];
for (let i = 0; i + 3 < b64.length && out.length < 12; i += 4) {
const a = B64A.indexOf(b64.charAt(i)), b2 = B64A.indexOf(b64.charAt(i + 1));
const c = B64A.indexOf(b64.charAt(i + 2)), d = B64A.indexOf(b64.charAt(i + 3));
if (a < 0 || b2 < 0 || c < 0 || d < 0) break;
out.push((a << 2) | (b2 >> 4), ((b2 & 15) << 4) | (c >> 2), ((c & 3) << 6) | d);
}
if (out.length >= 3 && out[0] === 0xFF && out[1] === 0xD8) return 'image/jpeg';
if (out.length >= 4 && out[0] === 0x89 && out[1] === 0x50 && out[2] === 0x4E && out[3] === 0x47) return 'image/png';
if (out.length >= 3 && out[0] === 0x47 && out[1] === 0x49 && out[2] === 0x46) return 'image/gif';
if (out.length >= 12 && out[0] === 0x52 && out[1] === 0x49 && out[2] === 0x46 && out[3] === 0x46 && out[8] === 0x57 && out[9] === 0x45 && out[10] === 0x42 && out[11] === 0x50) return 'image/webp';
if (out.length >= 2 && out[0] === 0x42 && out[1] === 0x4D) return 'image/bmp';
return '';
}
function mediaPayloadKind(s) {
if (typeof s !== 'string' || !s) return '';
if (window.chatIsDataImgLikeSrc) {
if (window.chatIsDataAudioSrc && window.chatIsDataAudioSrc(s)) return 'audio';
return window.chatIsDataImgLikeSrc(s) ? 'image' : '';
}
let t = s;
for (let i = 0; i < t.length; i++) {
const ch = t.charAt(i);
if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r' && ch !== '\f') { t = t.slice(i); break; }
}
const head = t.length > 64 ? t.slice(0, 64) : t;
if (NOMIME_RE.test(head)) return (window.chatB64ImgMime ? window.chatB64ImgMime(s) : noMimeImgMime(head)) ? 'image' : '';
const m = KIND_HEAD_RE.exec(head);
if (!m) return '';
const k = m[1].toLowerCase();
return k === 'audio' ? 'audio' : (k === 'video' ? '' : 'image');
}
if (!OK) return;
const map = new Map();            // hash -> dataURL（已解析/已落池内容，渲染热缓存）
const missing = new Set();        // hash -> true（idbGet 确认池缺失）
let missReads = 0;
const MISS_READ_MAX = 8;
const TOK_WATCH_MS = 15000;
let missPumpT = null;
function missRetryPump() {
if (missPumpT) return;
missPumpT = setTimeout(function () {
missPumpT = null;
if (missReads >= MISS_READ_MAX) return;
try { scanRoot(document); } catch (e) {}
}, 300);
}
window.mochiMediaTokenMissing = function (s) { const m = TOKEN_RE.exec(s || ''); return !!(m && missing.has(m[1])); };
const markQueue = new Set();
let markT = null;
const MISS_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="100%" height="100%" fill="#ececec"/><text x="50%" y="50%" font-size="14" fill="#9a9a9a" text-anchor="middle" dominant-baseline="middle">图片缺失</text></svg>');
function flushMissingMarks() {
markT = null;
if (!markQueue.size) return;
const list = Array.from(markQueue); markQueue.clear();
let nodes;
try { nodes = document.querySelectorAll('img[src^="' + TOK + '"]'); } catch (e) { nodes = []; }
Array.prototype.forEach.call(nodes, function (el) {
let m; try { m = TOKEN_RE.exec(el.getAttribute('src') || ''); } catch (e2) { m = null; }
if (!m || list.indexOf(m[1]) < 0) return;
try { el.classList.add('media-tok-missing'); el.alt = '图片缺失'; el.src = MISS_PLACEHOLDER; } catch (e3) {}
});
}
function markMissing(h) {
markQueue.add(h);
if (markT) return;
markT = setTimeout(flushMissingMarks, 120);
}
const phReg = new Map();          // hash -> [占位 span（.__mochiImg=原 img）]
window.mochiMediaPhRegister = function (h, ph, img) {
if (!ph || !ph.nodeType || !TOKEN_RE.test(TOK + h)) return;
let list = phReg.get(h);
if (!list) { list = []; phReg.set(h, list); }
if (list.indexOf(ph) < 0) { ph.__mochiImg = img || null; list.push(ph); }
};
window.mochiMediaPhRestore = function (h, v) {
const list = phReg.get(h);
if (!list || typeof v !== 'string' || mediaPayloadKind(v) !== 'image') return; // FIX #948 判据大小写/空白不敏感
phReg.delete(h);
list.forEach(function (ph) {
try {
const im = ph.__mochiImg;
if (im) {
try { ph.replaceWith(im); } catch (e2) {}
im.classList.remove('media-tok-missing');
im.removeAttribute('alt');
im.src = v;
}
} catch (e) {}
});
};
const inflight = {};              // hash -> true（渲染侧单飞取回）
const phImgs = new Map();         // hash -> Set<img>（正显示软占位、待池读回后原位换回）
const softTry = new Map();        // hash -> 已用重试次数
const SOFT_RETRY_MS = [1200, 4000, 10000];
function restorePhImgs(h, v) {
const set = phImgs.get(h);
if (!set) return;
phImgs.delete(h);
set.forEach(function (el) {
try { el.classList.remove('media-tok-missing'); el.removeAttribute('alt'); el.src = v; } catch (e) {}
});
}
function softMissImg(img, h) {
if (img) {
try { img.classList.add('media-tok-missing'); img.alt = '图片缺失'; img.src = MISS_PLACEHOLDER; } catch (e) {}
let set = phImgs.get(h);
if (!set) { set = new Set(); phImgs.set(h, set); }
set.add(img);
}
const n = softTry.get(h) || 0;
if (n >= SOFT_RETRY_MS.length) return;   // 预算用尽：保持占位，等重渲染/下次会话再试
softTry.set(h, n + 1);
setTimeout(function () {
const info = {};
let p;
try { p = window.idbGet(FULL + h, info); } catch (e) { p = null; }
if (!p || !p.then) return;
p.then(function (v) {
if (typeof v === 'string' && mediaPayloadKind(v) === 'image') { // FIX #948
softTry.delete(h);
missing.delete(h);
if (!map.has(h)) map.set(h, v);
restorePhImgs(h, v);
return;
}
if (info.ambiguous) { softMissImg(null, h); return; }   // 仍是读失败：预算内再试
missing.add(h);                                        // 这回读到了「确实没有」→ 原缺失语义
markMissing(h);
}).catch(function () {});
}, SOFT_RETRY_MS[n]);
}
let writeBuf = [];                // 待落池 [{k,v}]
let flushT = null;
window.mochiMediaExpand = function (s) {
const m = TOKEN_RE.exec(s || '');
return m ? (map.get(m[1]) || null) : null;
};
window.mochiMediaExpandAsync = function (s, cb) {
const done = function (v) { try { cb(v); } catch (e) {} };
const m = TOKEN_RE.exec(String(s || ''));
if (!m) { done(null); return; }
const c = map.get(m[1]);
if (typeof c === 'string' && c.indexOf('data:audio/') === 0) { done(c); return; }
window.idbGet(FULL + m[1]).then(function (v) {
done(typeof v === 'string' && v.indexOf('data:audio/') === 0 ? v : null);
}).catch(function () { done(null); });
};
window.mochiMediaResolve = function (s) {
const m = TOKEN_RE.exec(String(s || ''));
if (!m) return Promise.resolve(null);
const c = map.get(m[1]);
if (typeof c === 'string' && c) return Promise.resolve(c);
return window.idbGet(FULL + m[1]).then(function (v) {
return (typeof v === 'string' && v) ? v : null;
}).catch(function () { return null; });
};
const paintWait = new Map();          // hash -> [{ el, done }]
const PAINT_WAIT_MS = 1200;
function paintFinish(el, done, ok) {
try { el.__moPaint = 0; } catch (eC) {}
try { if (done) done(ok); } catch (eD) {}
}
function paintDeliver(h, payload) {
const list = paintWait.get(h);
if (!list) return;
paintWait.delete(h);
for (let i = 0; i < list.length; i++) {
const it = list[i], el = it.el;
let cur = '';
try { cur = el.getAttribute('src') || ''; } catch (eG) {}
if (cur) { paintFinish(el, it.done, false); continue; } // 已被上好图/已被换掉：不插手
try { el.setAttribute('src', payload || (TOK + h)); } catch (eS) {} // 有载荷写真载荷，确缺才写令牌
paintFinish(el, it.done, !!payload);
}
}
window.mochiMediaPaint = function (el, val, done) {
const v = String(val || '');
if (!el || !v) { try { if (done) done(false); } catch (e0) {} return; }
const m = TOKEN_RE.exec(v);
if (!m) {
try { el.setAttribute('src', v); } catch (e1) {}
paintFinish(el, done, true);
return;
}
const h = m[1];
const c = map.get(h);
if (typeof c === 'string' && c) { // 热缓存命中（本会话刚落过池/已预热）＝一次赋值、一发请求都不发
try { el.setAttribute('src', c); } catch (e3) {}
paintFinish(el, done, true);
return;
}
if (missing.has(h)) { // 本会话已确认缺失：当场交回令牌，#397 占位那一路立刻接手（旧语义）
try { el.setAttribute('src', v); } catch (e5) {}
paintFinish(el, done, false);
return;
}
let list = paintWait.get(h);
if (!list) {
list = [];
paintWait.set(h, list);
setTimeout(function () { paintDeliver(h, map.get(h) || null); }, PAINT_WAIT_MS); // 纪律②上限兜底
}
try { el.__moPaint = 1; } catch (eF) {} // 在飞＝这一格此刻既没载荷也没令牌，面板「等图 ready」闸读它
list.push({ el: el, done: done });
if (window.mochiMediaWarmTokens) { try { window.mochiMediaWarmTokens([h]); } catch (eW) {} } // 纪律③
};
window.mochiMediaReplace = function (hash, dataUrl) {
const h = String(hash || '');
if (!TOKEN_RE.test(TOK + h)) return Promise.resolve(false);
if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) return Promise.resolve(false);
try { writeBuf = writeBuf.filter(function (p) { return !(p && p.k === FULL + h); }); } catch (e0) {}
return window.idbSet(FULL + h, dataUrl).then(function (ok) {
if (!ok) return false;
map.set(h, dataUrl);
paintDeliver(h, dataUrl); // #1314 在等这一哈希的格子当场拿新载荷（不经令牌那一趟）
missing.delete(h);
try { window.mochiMediaPhRestore(h, dataUrl); } catch (ePH) {} // #439 原位换回自愈
let nodes;
try { nodes = document.querySelectorAll('img[src="' + TOK + h + '"]'); } catch (e2) { nodes = []; }
Array.prototype.forEach.call(nodes, function (el) { el.src = dataUrl; });
return true;
}).catch(function () { return false; });
};
async function sha256Hex(str) {
const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
const arr = new Uint8Array(buf);
let out = '';
for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, '0');
return out.slice(0, 32); // 128 位十六进制前缀——实际内容寻址撞库概率为 0，键长可控
}
window.mochiMediaFlush = function () {
if (flushT) { clearTimeout(flushT); flushT = null; }
if (!writeBuf.length) return Promise.resolve(true);
const buf = writeBuf.splice(0);
return window.idbSetAll(buf).then(function (ok) {
if (!ok) { writeBuf = buf.concat(writeBuf); scheduleFlush(); }
return ok;
}).catch(function () { writeBuf = buf.concat(writeBuf); scheduleFlush(); return false; });
};
function scheduleFlush() { if (!flushT) flushT = setTimeout(function () { flushT = null; window.mochiMediaFlush(); }, 300); }
try {
document.addEventListener('visibilitychange', function () {
if (document.visibilityState === 'hidden') window.mochiMediaFlush();
});
} catch (e) {}
const lookupQueue = new Map();    // hash -> { data, cbs:[] }
let lookupT = null;
window.mochiMediaTokenize = function (dataUrl, opts) {
return new Promise(function (resolve) {
if (typeof dataUrl !== 'string') { resolve(null); return; }
var payload = dataUrl.trim();
if (payload.length < 1024) { resolve(null); return; }
if (!mediaPayloadKind(payload)) { resolve(null); return; }
sha256Hex(payload).then(function (h) {
if (map.has(h)) { resolve(TOK + h); return; }
let q = lookupQueue.get(h);
if (!q) { q = { data: payload, cbs: [], nc: !!(opts && opts.noCache) }; lookupQueue.set(h, q); }
q.cbs.push(resolve);
if (!lookupT) lookupT = setTimeout(runLookups, 60);
}).catch(function () { resolve(null); });
});
};
async function runLookups() {
lookupT = null;
if (!lookupQueue.size) return;
const entries = Array.from(lookupQueue.entries());
lookupQueue.clear();
let dirty = false;
for (let i = 0; i < entries.length; i += 40) {
const slice = entries.slice(i, i + 40);
let vals = {};
try { vals = (await window.idbGetMany(slice.map(function (e) { return FULL + e[0]; }))) || {}; } catch (e) { vals = {}; }
slice.forEach(function (e) {
const v = vals[FULL + e[0]];
const isImg = mediaPayloadKind(e[1].data) === 'image';
const nc = !!e[1].nc;
if (typeof v === 'string') { if (isImg && !nc) map.set(e[0], v); }          // 池里已有（跨会话/桌面重复）→ 不重写
else { if (isImg && !nc) map.set(e[0], e[1].data); writeBuf.push({ k: FULL + e[0], v: e[1].data }); dirty = true; }
e[1].cbs.forEach(function (cb) { try { cb(TOK + e[0]); } catch (e2) {} });
});
await new Promise(function (r) { setTimeout(r, 0); }); // 分批让出主线程
}
if (dirty) scheduleFlush();
}
function resolveImg(img) {
const m = TOKEN_RE.exec(img.getAttribute('src') || '');
if (!m) return;
const h = m[1];
const v = map.get(h);
if (v) { img.src = v; return; }
if (inflight[h]) return;
try { if (img.dataset && img.dataset.tokTried === h) return; } catch (e) {}
if (missReads >= MISS_READ_MAX) { missRetryPump(); return; }
try { if (img.dataset) img.dataset.tokTried = h; } catch (e) {}
inflight[h] = true;
missReads++;
const __tokSt = { settled: false };
const __tokSettle = function () {
if (__tokSt.settled) return;
__tokSt.settled = true;
clearTimeout(__tokWatch);
delete inflight[h];
missReads = Math.max(0, missReads - 1);
missRetryPump();
};
const __tokWatch = setTimeout(function () { __tokSettle(); }, TOK_WATCH_MS);
const info = {};                 // #665d：idbGet 读失败（超时/连接丢失）→ info.ambiguous
window.idbGet(FULL + h, info).then(function (v2) {
__tokSettle();
if (typeof v2 !== 'string' || mediaPayloadKind(v2) !== 'image') {
let pending = false;
for (let wi = 0; wi < writeBuf.length; wi++) { if (writeBuf[wi] && writeBuf[wi].k === FULL + h) { pending = true; break; } }
if (pending) {
try { if (img.dataset && img.dataset.tokTried === h) delete img.dataset.tokTried; } catch (eTT) {}
missRetryPump();
return;
}
if (info.ambiguous) { softMissImg(img, h); return; }
paintDeliver(h, null); // #1314 确缺＝把令牌交回在等的格子，让观察器＋#397 占位那一路接手（下一行 #387 的语义一字未动）
missing.add(h); markMissing(h); return;
}
missing.delete(h); // 后续读到有效值＝池已补回（导入完整备份等），解除剔除/占位
map.set(h, v2);
try { window.mochiMediaPhRestore(h, v2); } catch (ePH) {} // #439 已换文字占位的原位换回自愈
restorePhImgs(h, v2); // #665d 软占位（读失败）的 img 原位换回真图
softTry.delete(h);
let nodes;
try { nodes = document.querySelectorAll('img[src="' + TOK + h + '"]'); } catch (e) { nodes = []; }
Array.prototype.forEach.call(nodes, function (el) { el.src = v2; });
paintDeliver(h, v2); // #1314 同哈希在登记的格子（src 还空着）一并上好图
}).catch(function () { __tokSettle(); });
}
function scanRoot(root) {
if (!root) return;
let nodes;
try { nodes = root.querySelectorAll ? root.querySelectorAll('img[src^="' + TOK + '"]') : null; } catch (e) { return; }
if (nodes) Array.prototype.forEach.call(nodes, resolveImg);
if (root.tagName === 'IMG') resolveImg(root);
}
try {
const obs = new MutationObserver(function (muts) {
for (let i = 0; i < muts.length; i++) {
const mu = muts[i];
if (mu.type === 'attributes' && mu.target && mu.target.tagName === 'IMG') resolveImg(mu.target);
else if (mu.type === 'childList') {
for (let j = 0; j < mu.addedNodes.length; j++) scanRoot(mu.addedNodes[j]);
}
}
});
obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
} catch (e) {}
try {
document.addEventListener('mochi-restore-done', function () { missing.clear(); });
} catch (e) {}
function bootScan() { scanRoot(document); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootScan);
else bootScan();
const warmSeen = new Set();
const warmQueue = [];
let warmT = null;
function warmPump() {
warmT = null;
const batch = warmQueue.splice(0, 8);
if (!batch.length) return;
window.idbGetMany(batch.map(function (h) { return FULL + h; })).then(function (vals) {
vals = vals || {};
batch.forEach(function (h) {
delete inflight[h];
const v = vals[FULL + h];
if (typeof v !== 'string' || mediaPayloadKind(v) !== 'image') return; // 脏值/缺失：不进 map 不占位（FIX #948 判据大小写/空白不敏感）
missing.delete(h);
if (!map.has(h)) map.set(h, v);
let nodes;
try { nodes = document.querySelectorAll('img[src="' + TOK + h + '"]'); } catch (e) { nodes = []; }
Array.prototype.forEach.call(nodes, function (el) { el.src = v; });
paintDeliver(h, v); // #1314 同上：预热回来先喂登记处，别让格子靠「src 里躺着令牌」才被捞到
});
if (warmQueue.length) warmT = setTimeout(warmPump, 0);
}).catch(function () {
batch.forEach(function (h) { delete inflight[h]; }); // 整批失败：放行观察器原路径自愈
});
}
window.mochiMediaWarmTokens = function (hashes) {
if (!Array.isArray(hashes)) return;
for (let i = 0; i < hashes.length; i++) {
const h = String(hashes[i] || '');
if (!/^[0-9a-f]{32}$/.test(h) || warmSeen.has(h)) continue;
warmSeen.add(h);
if (map.has(h) || missing.has(h) || inflight[h]) continue;
inflight[h] = true;
warmQueue.push(h);
}
if (warmQueue.length && !warmT) warmT = setTimeout(warmPump, 0);
};
window.mochiMediaGC = function () {
const prog = typeof arguments[0] === 'function' ? arguments[0] : null;
return (async function () {
const out = { ok: false, reason: '', orphans: [], bytes: 0, poolN: 0, refN: 0 };
if (!window.idbListKeys || !window.idbGet || !window.idbGetMany) { out.reason = '接口不可用（需安全上下文）'; return out; }
try { await window.mochiMediaFlush(); } catch (e) {}
const keys = await window.idbListKeys();
if (!keys) { out.reason = '键清单读取失败（存储繁忙），本次不清理'; return out; }
const SCAN_RE = /@@m:([0-9a-f]{32})/g;
const keep = new Set();
map.forEach(function (_v, h) { keep.add(h); });
writeBuf.forEach(function (p) { keep.add(String(p.k).slice(FULL.length)); });
Object.keys(inflight).forEach(function (h) { keep.add(h); });
const REFS = /(?:^|:)(?:chat-msgs|chat-blk-idx|chat-blk-[0-9]+|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail|cc-groups(?:-public)?|feed-posts(?:-snap)?|chat-arch)$/;
const refKeys = keys.filter(function (k) { return REFS.test(String(k)); });
try {
for (let li = 0; li < localStorage.length; li++) {
const lk = localStorage.key(li);
if (lk && REFS.test(lk)) refKeys.push('__ls__' + lk);
}
} catch (lErr) { out.reason = 'localStorage 读取失败（存储繁忙），为安全起见本次不清理'; return out; }
out.refN = refKeys.length;
const yieldUI = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
const scanKeep = function (s) { SCAN_RE.lastIndex = 0; let m; while ((m = SCAN_RE.exec(s))) keep.add(m[1]); };
for (let i = 0; i < refKeys.length; i++) {
let v;
if (refKeys[i].indexOf('__ls__') === 0) {
try { v = localStorage.getItem(refKeys[i].slice(6)); } catch (e2) { v = undefined; }
if (v === undefined || v === null) continue; // 该 LS 键刚好被清＝无引用可标，不构成放弃条件
} else {
v = await window.idbGet(refKeys[i]);
if (v === undefined || v === null) { out.reason = '有聊天记录/收藏没读到（存储繁忙？），为安全起见本次不清理'; return out; }
}
try { if (prog) prog(i + 1, refKeys.length, '读取引用'); } catch (eP1) {}
if (typeof v === 'string') { scanKeep(v); }
else if (Array.isArray(v)) {
for (let j = 0; j < v.length; j++) {
const mi = v[j];
let s = '';
try { s = typeof mi === 'string' ? mi : (mi && typeof mi === 'object' ? JSON.stringify(mi) : ''); } catch (e8) { out.reason = '引用数据序列化失败，本次不清理'; return out; }
if (s) scanKeep(s);
if ((j & 127) === 127) await yieldUI();
}
} else {
try { scanKeep(JSON.stringify(v) || ''); } catch (e9) { out.reason = '引用数据序列化失败，本次不清理'; return out; }
}
await yieldUI();
}
const poolKeys = keys.filter(function (k) { return String(k).indexOf(FULL) === 0; });
out.poolN = poolKeys.length;
const orphans = [];
for (let i = 0; i < poolKeys.length; i++) {
if (!keep.has(String(poolKeys[i]).slice(FULL.length))) orphans.push(String(poolKeys[i]));
}
let bytes = 0;
for (let i = 0; i < orphans.length; i += 16) {
const batch = orphans.slice(i, i + 16);
let vals = {};
try { vals = (await window.idbGetMany(batch)) || {}; } catch (e3) {}
batch.forEach(function (k) { const v = vals[k]; if (typeof v === 'string') bytes += v.length * 2; });
}
out.orphans = orphans;
out.bytes = bytes;
out.ok = true;
return out;
})().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), orphans: [], bytes: 0, poolN: 0, refN: 0 }; });
};
window.mochiMediaGCApply = function (orphans) {
return (async function () {
const list = (orphans || []).map(String);
let n = 0;
for (let i = 0; i < list.length; i++) {
let ok = false;
try { ok = await window.idbDelete(list[i]); } catch (e) { ok = false; }
if (ok) { map.delete(list[i].slice(FULL.length)); n++; }
}
return n;
})();
};
window.mochiMediaCoverage = function () {
const prog = typeof arguments[0] === 'function' ? arguments[0] : null;
return (async function () {
const out = { ok: false, reason: '', referenced: 0, inPool: 0, missing: 0, missingSamples: [] };
if (!window.idbListKeys || !window.idbGet || !window.idbGetMany) { out.reason = '接口不可用（需安全上下文/IDB）'; return out; }
const REFS = /(?:^|:)(?:chat-msgs|chat-blk-idx|chat-blk-[0-9]+|fav-msgs|group-chat-msgs|gc-msgs-[0-9A-Za-z_-]+|chat-tail|cc-groups(?:-public)?|feed-posts(?:-snap)?|chat-arch)$/;
const SCAN_RE = /@@m:([0-9a-f]{32})/g;
let keys;
try { keys = await window.idbListKeys(); } catch (e) { out.reason = '键清单读取失败'; return out; }
if (!Array.isArray(keys)) { out.reason = '键清单非法'; return out; }
const refKeys = keys.filter(function (k) { return REFS.test(String(k)); });
try { for (let i = 0; i < localStorage.length; i++) { const lk = localStorage.key(i); if (lk && REFS.test(lk)) refKeys.push('__ls__' + lk); } } catch (e) {}
const refs = new Set();
const yieldUI = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
const scanTokens = function (s) { SCAN_RE.lastIndex = 0; let m; while ((m = SCAN_RE.exec(s))) refs.add(m[1]); };
for (let i = 0; i < refKeys.length; i++) {
let v;
const rk = refKeys[i]; const isLs = rk.indexOf('__ls__') === 0;
try { if (prog) prog(i + 1, refKeys.length, isLs ? '本地快照' : '聊天/收藏'); } catch (eP2) {}
if (isLs) { try { v = localStorage.getItem(rk.slice(6)); } catch (e2) { v = undefined; } }
else { try { v = await window.idbGet(rk); } catch (e2) { v = undefined; } }
if (v === undefined || v === null) continue;
if (typeof v === 'string') { scanTokens(v); }
else if (Array.isArray(v)) {
for (let j = 0; j < v.length; j++) {
const mg = v[j];
let s = '';
try { s = typeof mg === 'string' ? mg : (mg && typeof mg === 'object' ? JSON.stringify(mg) : ''); } catch (e3) { continue; }
if (s) scanTokens(s);
if ((j & 255) === 255) await yieldUI();
}
} else {
try { scanTokens(JSON.stringify(v) || ''); } catch (e4) {}
}
await yieldUI();
}
const uniq = Array.from(refs);
out.referenced = uniq.length;
const bad = [];
for (let i = 0; i < uniq.length; i += 40) {
const batch = uniq.slice(i, i + 40);
let vals = {};
try { vals = (await window.idbGetMany(batch.map(function (h) { return FULL + h; }))) || {}; } catch (e3) { vals = {}; }
batch.forEach(function (h) { const v = vals[FULL + h]; if (typeof v !== 'string' || v.indexOf('data:') !== 0) bad.push(h); });
}
out.inPool = uniq.length - bad.length;
out.missing = bad.length;
out.missingSamples = bad.slice(0, 8);
out.ok = true;
return out;
})().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), referenced: 0, inPool: 0, missing: 0, missingSamples: [] }; });
};
window.mochiMediaRebuild = function () {
const prog = typeof arguments[0] === 'function' ? arguments[0] : null;
return (async function () {
const out = { ok: false, reason: '', poolN: 0, validN: 0, brokenN: 0, foundN: 0, written: 0, alreadyOk: 0, writeFail: 0, bytes: 0 };
const yieldUI = function () { return new Promise(function (r) { setTimeout(r, 0); }); }; // #441 阶段间让出主线程
if (!window.idbListKeys || !window.idbGet || !window.idbGetMany || !window.idbSetAll || !window.idbSet) { out.reason = '接口不可用（需安全上下文/IDB）'; return out; }
try { await window.mochiMediaFlush(); } catch (e) {}
let keys;
try { keys = await window.idbListKeys(); } catch (e) { out.reason = '键清单读取失败'; return out; }
if (!Array.isArray(keys)) { out.reason = '键清单非法'; return out; }
const POOL_RE = /^xy-home-v2:media:[0-9a-f]{32}$/;
const poolKeys = keys.filter(function (k) { return POOL_RE.test(String(k)); });
out.poolN = poolKeys.length;
const valid = new Set();
for (let i = 0; i < poolKeys.length; i += 40) {
const batch = poolKeys.slice(i, i + 40);
let vals = {};
try { vals = (await window.idbGetMany(batch)) || {}; } catch (e) { vals = {}; }
batch.forEach(function (k) {
const v = vals[k];
if (typeof v === 'string' && mediaPayloadKind(v)) valid.add(String(k).slice(FULL.length)); // FIX #948 同口径
});
try { if (prog) prog(Math.min(poolKeys.length, i + 40), poolKeys.length, '核对池内条目'); } catch (eP3) {}
await yieldUI(); // #441 批间让出主线程（池 741+ 条×大值，连读会冻结 UI）
}
out.validN = valid.size;
out.brokenN = poolKeys.length - valid.size;
const DATA_RE = /data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]{1024,}/g;
const found = new Map();
let foundBytes = 0;
function scanString(s) {
if (typeof s !== 'string' || s.length < 1100) return;
DATA_RE.lastIndex = 0;
let m;
while ((m = DATA_RE.exec(s))) {
const d = m[0];
if (!found.has(d)) { found.set(d, true); foundBytes += d.length * 2; }
}
}
function scanValue(v) {
if (typeof v === 'string') { scanString(v); return; }
if (Array.isArray(v)) { // 聊天记录 IDB 直存数组——浅层扫字段（与 device.js sizeOf 同口径）
for (let i = 0; i < v.length; i++) {
const m = v[i];
if (typeof m === 'string') { scanString(m); continue; }
if (!m || typeof m !== 'object') continue;
if (typeof m.text === 'string') scanString(m.text);
if (typeof m.img === 'string') scanString(m.img);
if (typeof m.voice === 'string') scanString(m.voice);
const ps = m.parts;
if (Array.isArray(ps)) { for (let j = 0; j < ps.length; j++) { const p = ps[j]; if (p && typeof p.v === 'string') scanString(p.v); } }
}
}
}
try {
for (let i = 0; i < localStorage.length; i++) {
const lk = localStorage.key(i);
if (!lk) continue;
let v = null;
try { v = localStorage.getItem(lk); } catch (e2) { v = null; }
if (v) scanString(v);
}
} catch (e) { out.reason = 'localStorage 读取失败（存储繁忙），本次只扫了部分来源'; }
const srcKeys = keys.filter(function (k) {
k = String(k);
return !POOL_RE.test(k) && k.indexOf(':music-file:') < 0 && k.indexOf('__wr-j:') < 0;
});
for (let i = 0; i < srcKeys.length; i += 4) { // 批 4 读、逐个扫完即弃（峰值≈4×最大单键）
try { if (prog) prog(i, srcKeys.length, '扫描本机副本'); } catch (eP4) {}
const batch = srcKeys.slice(i, i + 4);
let vals = {};
try { vals = (await window.idbGetMany(batch)) || {}; } catch (e3) { vals = {}; }
batch.forEach(function (k) { scanValue(vals[k]); vals[k] = null; });
await yieldUI(); // #441 批间让出主线程防冻结
}
out.foundN = found.size;
out.bytes = foundBytes;
const fill = [];
const dataList = Array.from(found.keys());
for (let i = 0; i < dataList.length; i++) {
try { if (prog) prog(i, dataList.length, '校验哈希'); } catch (eP5) {}
let h = '';
try { h = await sha256Hex(dataList[i]); } catch (e4) { continue; }
if (valid.has(h)) { out.alreadyOk++; continue; }
fill.push({ k: FULL + h, v: dataList[i] });
if ((i & 15) === 15) await new Promise(function (r) { setTimeout(r, 0); }); // 让出主线程
}
for (let i = 0; i < fill.length; i += 40) {
const batch = fill.slice(i, i + 40);
let ok = false;
try { ok = await window.idbSetAll(batch); } catch (e5) { ok = false; }
if (ok !== true) { // 整批失败退回逐键（idbSet 自带重试）
for (let j = 0; j < batch.length; j++) {
let ok1 = false;
try { ok1 = await window.idbSet(batch[j].k, batch[j].v); } catch (e6) { ok1 = false; }
if (ok1) heal(batch[j]); else out.writeFail++;
}
} else {
batch.forEach(function (p) { heal(p); });
}
}
function heal(p) {
const h = String(p.k).slice(FULL.length);
valid.add(h);
if (mediaPayloadKind(p.v) === 'image') { map.set(h, p.v); try { window.mochiMediaPhRestore(h, p.v); } catch (ePH2) {} } // 音频不进热缓存（#283 内存纪律）；#439 占位原位换回
missing.delete(h);
out.written++;
}
if (out.written) {
try {
const nodes = document.querySelectorAll('img[src^="' + TOK + '"]');
Array.prototype.forEach.call(nodes, function (el) {
const m = TOKEN_RE.exec(el.getAttribute('src') || '');
if (!m) return;
const v = map.get(m[1]);
if (!v) return;
try { el.classList.remove('media-tok-missing'); el.removeAttribute('alt'); } catch (e7) {}
el.src = v;
});
} catch (e8) {}
}
out.ok = true;
return out;
})().catch(function (e) { return { ok: false, reason: '重建异常：' + ((e && e.message) || e), poolN: 0, validN: 0, brokenN: 0, foundN: 0, written: 0, alreadyOk: 0, writeFail: 0, bytes: 0 }; });
};
const AC_KEY = 'media-auto-check';
function acWrite(o) { try { if (window.xyStore) window.xyStore('xy-home-v2').set(AC_KEY, JSON.stringify(o)); } catch (e) {} }
window.mochiMediaAutoShouldRun = function (st, now) {
if (!st || typeof st !== 'object') return true;
if (st.snooze && now < st.snooze) return false;
return !(typeof st.t === 'number' && (now - st.t) < 86400000);
};
window.mochiMediaAutoCheck = function () {
return (async function () {
const out = { ran: false, skipped: '', missing: 0, repaired: 0 };
const now = Date.now();
let st = null;
try { st = JSON.parse((window.xyStore && window.xyStore('xy-home-v2').get(AC_KEY)) || 'null'); } catch (e) { st = null; }
if (!window.mochiMediaAutoShouldRun(st, now)) { out.skipped = '24h节流/免打扰中'; return out; }
if (!window.mochiMediaCoverage || !window.mochiMediaRebuild) { out.skipped = '接口不可用'; return out; }
const rep = await window.mochiMediaCoverage();
if (!rep || !rep.ok) { acWrite({ t: now, missing: -1, snooze: 0 }); out.skipped = '体检未完成：' + ((rep && rep.reason) || ''); return out; }
acWrite({ t: now, missing: rep.missing, snooze: 0 });
out.ran = true;
out.missing = rep.missing;
if (!rep.missing || !window.openModal) return out;
acWrite({ t: now, missing: rep.missing, snooze: now + 72 * 3600000 });
await new Promise(function (res) {
window.openModal('发现 ' + rep.missing + ' 张图片数据缺失', '', function () { res(); }, {
noInput: true, okText: '一键修复',
staticText: '聊天/收藏/字卡库里有 ' + rep.missing + ' 张引用的图片不在媒体池里，会显示「图片丢失」。\n\n现在扫描本机还留存的原图副本（字卡库/收藏/表情分组/头像库/壁纸/备份快照等）自动补回缺失的池条目：\n· 只补缺失/空串条目，不改任何其他数据，不删除任何数据；\n· 补得回多少取决于本机还留有多少原图副本；\n· 扫描需通读本机数据，请保持页面打开。'
});
});
try { if (typeof toast === 'function') toast('正在重建媒体池，请稍候…'); } catch (e) {}
const rb = await window.mochiMediaRebuild();
if (!rb || !rb.ok) {
if (window.openModal) window.openModal('修复未完成', '', null, { noInput: true, staticText: ((rb && rb.reason) || '未知原因') + '\n\n没有改动任何数据，稍后存储空闲时可到 设置→查看存储→媒体池 再试。' });
return out;
}
acWrite({ t: Date.now(), missing: Math.max(0, rep.missing - rb.written), snooze: 0 });
out.repaired = rb.written;
const tpl = rb.written > 0
? ['已修复 ' + rb.written + ' 张！聊天/字卡库里的图片会自动恢复（当前页面的占位图已即时刷新）。']
: ['本机没有可补回的原图副本。'];
if (rb.written === 0) tpl.push('这些图片只能从还有它们的设备上导出「完整备份」（不要选「只备份文字」），再在本机导入恢复。');
if (window.openModal) window.openModal('修复完成', '', null, { noInput: true, staticText: tpl.join('\n') });
return out;
})().catch(function () { return { ran: false, skipped: '异常', missing: 0, repaired: 0 }; });
};
(function acKick(tries) {
if (typeof document === 'undefined') return;
if (!window.__mochiDataReady || document.getElementById('splash')) {
if ((tries || 0) < 600) setTimeout(function () { acKick((tries || 0) + 1); }, 1000);
return;
}
setTimeout(function () {
const go = function () { try { window.mochiMediaAutoCheck(); } catch (e) {} };
if (document.visibilityState !== 'visible') {
const once = function () { document.removeEventListener('visibilitychange', once); go(); };
document.addEventListener('visibilitychange', once);
return;
}
if (document.querySelector('.modal')) {
let n = 0;
const t = setInterval(function () { n++; if (n > 3 || !document.querySelector('.modal')) { clearInterval(t); if (n <= 3) go(); } }, 60000);
return;
}
go();
}, 20000);
})();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("media-pool.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("media-pool.js"); try { console.error("[JS] media-pool.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[media-pool.js] " + String(__e && __e.message || __e)); } })();
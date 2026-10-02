(function () { try {
(function () {
const DB_NAME = 'mochi-db';
const DB_VERSION = 1;
const STORE = 'kv';
let dbPromise = null;
function open() {
if (dbPromise) return dbPromise;
const self = new Promise((resolve, reject) => {
let settled = false;
let hangFired = false;
try {
if (!window.indexedDB) { settled = true; reject(new Error('no idb')); return; }
const req = indexedDB.open(DB_NAME, DB_VERSION);
req.onupgradeneeded = () => {
const db = req.result;
if (!db.objectStoreNames.contains(STORE)) {
db.createObjectStore(STORE);
}
};
req.onblocked = () => {
settled = true;
reject(new Error('idb open blocked'));
};
req.onsuccess = () => {
settled = true;
if (hangFired) { try { req.result.close(); } catch (e0) {} return; }
resolve(req.result);
};
req.onerror = () => { settled = true; reject(req.error); };
} catch (e) { settled = true; reject(e); }
setTimeout(function () {
if (settled) return; // #1227：请求已落地＝本计时器作废，绝不拆健康连接的缓存
hangFired = true;
reject(new Error('idb open hang'));
}, 8000);
});
self.catch(() => { if (dbPromise === self) dbPromise = null; });
dbPromise = self;
return dbPromise;
}
function connLost(e) {
try {
if (!e) return false;
const n = e.name;
if (n === 'InvalidStateError' || n === 'UnknownError' || n === 'InternalError' || n === 'TransactionInactiveError') return true;
const m = String((e && e.message) || e);
return /connection\s+(is\s+)?(closed|lost|closing)|server\s+lost|database\s+connection|indexed\s+database/i.test(m);
} catch (err) { return false; }
}
function armFgIdbReset() {
try {
if (typeof document === 'undefined' || !document.addEventListener) return;
if (!((window.mochiDevice || {}).isIOS)) return;
const resetNow = function () {
try {
if (!dbPromise) return;
dbPromise = null;
open().catch(function () {});
} catch (e) {}
};
document.addEventListener('visibilitychange', function () {
try { if (document.visibilityState === 'visible') resetNow(); } catch (e) {}
});
if (window.addEventListener) window.addEventListener('focus', resetNow);
} catch (e) {}
}
armFgIdbReset();
let _idbFailCnt = 0;
let _idbFailAlerted = false;
let _idbFailLastErr = '';
function _idbFailNotify() {
_idbFailCnt++;
if (_idbFailCnt < 5 || _idbFailAlerted) return;
_idbFailAlerted = true;
try { console.warn('[mochi] IDB 写入连续失败 ' + _idbFailCnt + ' 次（最后错误: ' + (_idbFailLastErr || '超时/挂起') + '），建议立即导出备份'); } catch (e) {}
try {
if (window.openModal) {
const md = window.mochiDevice || {};
const platTip = md.isIOS
? 'iOS 存储紧张时系统可能清空网站数据，且无痕模式下数据不落盘——定期导出是唯一防线。'
: (md.isAndroid ? '安卓的写入配额与手机系统存储挂钩，请确保系统存储有足够剩余空间。' : '');
const ctl = window.openModal('存储异常', '', null, {
noInput: true,
staticText: '近期数据多次写入失败（最后一次内核回执：' + (_idbFailLastErr || '事务超时未落地') + '），数据可能没有存上。建议按顺序处理：\n\n'
+ '① 先导出一份备份（下方「去导出备份」直达；数据量大可改选「只备份文字」，文件更小）\n'
+ '② 查看存储占用并瘦身（下方「查看存储」直达：字卡图去重 / 图片压缩 / 清理本地音乐）\n'
+ (platTip ? '③ ' + platTip + '\n' : '')
+ (platTip ? '④' : '③') + ' 若每次打开都弹：设置 → 设备兼容诊断，一键复制报告反馈',
copyBtn: { label: '去导出备份', fn: function (c) { idbFailAct('#row-export', c, '设置 → 导出数据'); } },
exportBtn: { label: '查看存储', fn: function (c) { idbFailAct('#row-storage-view', c, '设置 → 查看存储'); } }
});
try { if (ctl && ctl.okText) ctl.okText('知道了'); } catch (e0) {}
}
} catch (e) {}
}
function idbFailAct(rowSel, ctl, fallbackTip) {
try {
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
const sp = document.getElementById('page-setting');
if (sp) sp.hidden = false;
const el = document.querySelector(rowSel);
if (!el) throw new Error('row missing');
const sec = el.closest ? el.closest('.them-sec') : null;
if (sec && sec.dataset && sec.dataset.sec) {
const tab = document.querySelector('#set-tabs .them-tab[data-tab="' + sec.dataset.sec + '"]');
if (tab) tab.click();
}
try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}
if (ctl && ctl.close) ctl.close();
} catch (e) {
try { if (ctl && ctl.hint) ctl.hint('入口暂不可达，请手动前往：' + fallbackTip); } catch (e2) {}
}
}
window.idbSet = function (key, value) {
let lateReceipt = null; // Promise<true|false|null>：上一次超时尝试的最终内核回执（null=等满放弃）
function tryOnce() {
const wait = lateReceipt || Promise.resolve(null);
lateReceipt = null;
return wait.then((lateOk) => {
if (lateOk === true) return true; // 上一事务最终写成功＝本值已落盘，不重复排队
return open().then(db => new Promise((resolve) => {
let done = false;
let lateRes = null; // 超时落地后置为回执投递器
let lim = 4000;
try {
let est = 0;
if (typeof value === 'string') est = value.length;
else if (Array.isArray(value)) {
const est950 = (v, d) => {
if (typeof v === 'string') return v.length;
if (!v || typeof v !== 'object') return 32;
if (d > 4) return 64;
let n = 0;
if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) n += est950(v[i], d + 1); return n + 16; }
if (typeof v.text === 'string') n += v.text.length;
if (typeof v.img === 'string') n += v.img.length;
if (typeof v.voice === 'string') n += v.voice.length;
if (Array.isArray(v.parts)) { for (let j = 0; j < v.parts.length; j++) { const p = v.parts[j]; if (p && typeof p.v === 'string') n += p.v.length; } }
return n + 64;
};
for (let i = 0; i < value.length; i++) est += est950(value[i], 0);
}
if (est > 262144) lim = 4000 + Math.min(26000, Math.ceil(est / 262144) * 2000);
} catch (e) {}
const t = setTimeout(function () {
if (done) return; done = true;
dbPromise = null; // 连接疑似挂起，下次 open 重建
lateReceipt = new Promise((res) => {
lateRes = res;
setTimeout(() => res(null), lim); // #1227：再等一个 lim 仍无回执＝按挂起处理（真我/荣耀 Edge 形态）
});
resolve(false);
}, lim);
const deliverLate = (v) => { if (lateRes) { const r = lateRes; lateRes = null; if (v) _idbFailCnt = 0; r(v); } };
try {
const tx = db.transaction(STORE, 'readwrite');
tx.objectStore(STORE).put(value, key);
tx.oncomplete = () => { if (done) { deliverLate(true); return; } done = true; clearTimeout(t); resolve(true); };
tx.onerror = () => { _idbFailLastErr = (tx.error && tx.error.name) || 'error'; if (connLost(tx.error)) dbPromise = null; if (done) { deliverLate(false); return; } done = true; clearTimeout(t); resolve(false); };
tx.onabort = () => { _idbFailLastErr = (tx.error && tx.error.name) || 'abort'; if (connLost(tx.error)) dbPromise = null; if (done) { deliverLate(false); return; } done = true; clearTimeout(t); resolve(false); };
} catch (e) { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (e && e.name) || 'error'; if (connLost(e)) dbPromise = null; resolve(false); }
})).catch(() => false);
});
}
return (async () => {
let ok = await tryOnce();
if (!ok) { await new Promise(r => setTimeout(r, 100)); ok = await tryOnce(); }
if (!ok) { await new Promise(r => setTimeout(r, 100)); ok = await tryOnce(); }
if (ok) { _idbFailCnt = 0; return true; } // v3.26.x：成功即清零——只对连续失败告警
_idbFailNotify();
return false;
})();
};
window.idbSetAll = function (pairs) {
if (!pairs || !pairs.length) return Promise.resolve(true);
return open().then(db => new Promise((resolve) => {
let done = false;
let est = 0;
try { pairs.forEach(p => { const v = p && p.v; est += (typeof v === 'string' ? v.length : 64); }); } catch (e0) {}
const lim = 4000 + (est > 262144 ? Math.min(26000, Math.ceil(est / 262144) * 2000) : 0);
const t = setTimeout(function () {
if (done) return; done = true;
dbPromise = null; // 事务疑似挂起，连接重建交给下一次调用
resolve(false);
}, lim);
try {
const tx = db.transaction(STORE, 'readwrite');
const os = tx.objectStore(STORE);
pairs.forEach(p => { os.put(p.v, p.k); });
tx.oncomplete = () => { if (done) return; done = true; clearTimeout(t); resolve(true); };
tx.onerror = () => { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (tx.error && tx.error.name) || 'error'; if (connLost(tx.error)) dbPromise = null; resolve(false); };
tx.onabort = () => { if (done) return; done = true; clearTimeout(t); _idbFailLastErr = (tx.error && tx.error.name) || 'abort'; if (connLost(tx.error)) dbPromise = null; resolve(false); };
} catch (e) { if (done) return; done = true; clearTimeout(t); resolve(false); }
})).catch(() => false);
};
try { window.__xyIdbBrokeN = window.__xyIdbBrokeN || 0; } catch (e0) {} // #1466：只读计数启动即置 0（诊断单打印用）
function reqResultSafe(rq) {
try { return { ok: true, v: rq.result }; }
catch (eBroke) {
try { window.__xyIdbBrokeN = (window.__xyIdbBrokeN || 0) + 1; } catch (e0) {}
return { ok: false, e: eBroke };
}
}
window.idbGet = function (key, info) {
const ambiable = (info && typeof info === 'object') ? info : null;
const amb = () => { if (ambiable) ambiable.ambiguous = true; };
const LATE_READ_MAX_MS = 180000;
const _late = {};
function lateTake(k, v) {
const e = _late[k];
if (!e || e.done) return;
e.done = true; delete _late[k];
try { e.res(v); } catch (err) {}
}
function lateArm(k, rq) {
const e = _late[k];
if (!e || e.done || !rq || typeof rq.addEventListener !== 'function') return;
try { rq.addEventListener('success', function () { let v; try { v = rq.result; } catch (err2) { v = undefined; } lateTake(k, v); }); } catch (err) {}
try { rq.addEventListener('error', function () { lateTake(k, undefined); }); } catch (err) {}
try { rq.addEventListener('abort', function () { lateTake(k, undefined); }); } catch (err) {}
}
function lateGiveUp(k, rq) {
if (!_late[k]) {
let res;
const pr = new Promise(function (r) { res = r; });
_late[k] = { p: pr, res: res, done: false };
}
lateArm(k, rq);
setTimeout(function () { lateTake(k, undefined); }, LATE_READ_MAX_MS);
}
window.idbLateRead = function (key) {
const e = _late[key];
return (e && !e.done) ? e.p : undefined;
};
const minWait = (ambiable && typeof ambiable.minWaitMs === 'number' && ambiable.minWaitMs > 4000) ? Math.min(60000, ambiable.minWaitMs) : 4000;
return open().then(db => new Promise((resolve) => {
let done = false;
let timer = null;
function finish(val) { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(val); }
function run() {
try {
const tx = db.transaction(STORE, 'readonly');
const prev = req;
req = tx.objectStore(STORE).get(key); // #1360：这发请求提到外层，放弃等待窗之后还要给它加落地监听
if (prev) { try { prev.onsuccess = null; prev.onerror = null; } catch (ePrev) {} }
req.onsuccess = () => {
const _rG = reqResultSafe(req);
if (!_rG.ok) {
if (connLost(_rG.e)) dbPromise = null;
amb();
if (!retried) {
retried = true;
dbPromise = null;
open().then(function (db2) { db = db2; run(); }).catch(function () { finish(undefined); });
return;
}
finish(undefined);
return;
}
finish(_rG.v);
};
req.onerror = () => { if (connLost(req.error)) dbPromise = null; amb(); finish(undefined); };
} catch (e) { if (connLost(e)) dbPromise = null; amb(); finish(undefined); }
}
let req = null; // #1360
let retried = false;
timer = setTimeout(function () {
if (done) return;
if (!retried) {
retried = true;
lateGiveUp(key, req); // #1360：第一次到点也登记这一发（它才是跑得最久的那次）；重试的新事务只是加第二个证人
dbPromise = null;
open().then(function (db2) {
db = db2;
run();
timer = setTimeout(function () { dbPromise = null; amb(); lateGiveUp(key, req); finish(undefined); }, minWait);
}).catch(function () { amb(); finish(undefined); });
return;
}
dbPromise = null;
amb();
lateGiveUp(key, req); // #1360：这一发不再等人，但结果照旧登记，还挂着的人能拿到
finish(undefined);
}, minWait);
run();
})).catch(() => { amb(); return undefined; });
};
window.idbGetMany = function (keys) {
const list = (keys || []).filter(Boolean);
if (!list.length) return Promise.resolve({});
return open().then(db => new Promise((resolve) => {
const out = {};
let done = false;
let timer = null;
let retried = false;
const finish = () => { if (!done) { done = true; if (timer) clearTimeout(timer); resolve(out); } };
function run(ks) {
try {
const tx = db.transaction(STORE, 'readonly');
const os = tx.objectStore(STORE);
let pending = ks.length;
ks.forEach(k => {
const req = os.get(k);
req.onsuccess = () => { const _rM = reqResultSafe(req); if (_rM.ok) out[k] = _rM.v; if (--pending <= 0) finish(); }; // #1466：被打穿的那格按「未返回」处理，交给既有重试腿补读
req.onerror = () => { if (connLost(req.error)) dbPromise = null; if (--pending <= 0) finish(); };
});
tx.onerror = () => { if (connLost(tx.error)) dbPromise = null; finish(); };
tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; finish(); };
} catch (e) { if (connLost(e)) dbPromise = null; finish(); }
}
timer = setTimeout(function () {
if (done) return;
if (!retried) {
retried = true;
const miss = list.filter(k => !(k in out));
if (!miss.length) { finish(); return; }
run(miss);
timer = setTimeout(function () { dbPromise = null; finish(); }, 4000);
return;
}
dbPromise = null;
finish();
}, 4000);
run(list);
})).catch(() => ({}));
};
const IDB_LIST_FAILED = null;
function idbProbe(run) {
return open().then(db => new Promise((resolve) => {
let done = false;
let timer = null;
let retried = false;
function finish(val) { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(val); }
function attempt(conn) {
try { run(conn, finish); } catch (e) { if (connLost(e)) dbPromise = null; finish(IDB_LIST_FAILED); }
}
timer = setTimeout(function () {
if (done) return;
if (!retried) {
retried = true;
dbPromise = null;
open().then(function (db2) {
timer = setTimeout(function () { dbPromise = null; finish(IDB_LIST_FAILED); }, 8000);
attempt(db2);
}).catch(function () { finish(IDB_LIST_FAILED); });
return;
}
dbPromise = null;
finish(IDB_LIST_FAILED);
}, 4000);
attempt(db);
})).catch(() => IDB_LIST_FAILED);
}
window.idbListKeys = function () {
return idbProbe(function (db, finish) {
const tx = db.transaction(STORE, 'readonly');
const req = tx.objectStore(STORE).getAllKeys();
req.onsuccess = () => { const _rL = reqResultSafe(req); finish(_rL.ok ? (_rL.v || []) : IDB_LIST_FAILED); }; // #1466：抛了照 onerror 口径＝「这次没读到」，三态语义不变
req.onerror = () => { if (connLost(req.error)) dbPromise = null; finish(IDB_LIST_FAILED); };
tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; finish(IDB_LIST_FAILED); };
});
};
window.idbHasKey = function (key) {
if (!key) return Promise.resolve(IDB_LIST_FAILED);
return idbProbe(function (db, finish) {
const tx = db.transaction(STORE, 'readonly');
const req = tx.objectStore(STORE).count(key);
req.onsuccess = () => { const _rH = reqResultSafe(req); finish(_rH.ok ? ((_rH.v || 0) > 0) : IDB_LIST_FAILED); }; // #1466：同上，存在性三态不变
req.onerror = () => { if (connLost(req.error)) dbPromise = null; finish(IDB_LIST_FAILED); };
tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; finish(IDB_LIST_FAILED); };
});
};
window.idbGetAllKeys = function () {
return window.idbListKeys().then(function (keys) { return keys || []; });
};
window.idbDelete = function (key) {
function tryOnce() {
return open().then(db => new Promise((resolve) => {
let done = false;
const t = setTimeout(function () {
if (done) return; done = true;
dbPromise = null;
resolve(false);
}, 4000);
try {
const tx = db.transaction(STORE, 'readwrite');
tx.objectStore(STORE).delete(key);
tx.oncomplete = () => { if (done) return; done = true; clearTimeout(t); resolve(true); };
tx.onerror = () => { if (done) return; done = true; clearTimeout(t); if (connLost(tx.error)) dbPromise = null; resolve(false); };
tx.onabort = () => { if (done) return; done = true; clearTimeout(t); if (connLost(tx.error)) dbPromise = null; resolve(false); };
} catch (e) { if (done) return; done = true; clearTimeout(t); if (connLost(e)) dbPromise = null; resolve(false); }
})).catch(() => false);
}
return (async () => {
let ok = await tryOnce();
if (!ok) { await new Promise(r => setTimeout(r, 100)); ok = await tryOnce(); }
if (!ok) { await new Promise(r => setTimeout(r, 100)); ok = await tryOnce(); }
return ok;
})();
};
window.idbClearAll = function () {
return open().then(db => new Promise((resolve) => {
try {
const tx = db.transaction(STORE, 'readwrite');
tx.objectStore(STORE).clear();
tx.oncomplete = () => resolve(true);
tx.onerror = () => { if (connLost(tx.error)) dbPromise = null; resolve(false); };
tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; resolve(false); };
} catch (e) { resolve(false); }
})).catch(() => false);
};
window.idbDestroy = function () {
return new Promise((resolve) => {
let settled = false;
const fin = (ok) => { if (settled) return; settled = true; resolve(ok); };
try {
if (dbPromise) {
dbPromise.then(d => { try { d.close(); } catch (e1) {} }).catch(() => {});
dbPromise = null;
}
if (!window.indexedDB) { fin(false); return; }
const req = indexedDB.deleteDatabase(DB_NAME);
req.onsuccess = () => fin(true);
req.onerror = () => fin(false);
req.onblocked = () => {};
setTimeout(() => fin(false), 6000);
} catch (e) { fin(false); }
});
};
window.idbReplaceAll = function (entries) {
const list = (entries || []).filter(e => e && e.k !== undefined && e.k !== null);
if (!list.length) return window.idbClearAll();
return open().then(db => new Promise((resolve) => {
try {
const tx = db.transaction(STORE, 'readwrite');
const os = tx.objectStore(STORE);
let bad = false;
os.clear();
try {
list.forEach(e => { os.put(e.v, e.k); });
} catch (e) {
bad = true;
try { tx.abort(); } catch (e2) {}
}
tx.oncomplete = () => resolve(!bad);
tx.onerror = () => { if (connLost(tx.error)) dbPromise = null; resolve(false); };
tx.onabort = () => { if (connLost(tx.error)) dbPromise = null; resolve(false); };
} catch (e) { resolve(false); }
})).catch(() => false);
};
const LS_BIG_LIMIT = 200 * 1024;
let memoryCache = null;
const BIG_IDX_KEY = 'xy-home-v2:__big-idx';
function bigIdxLoad() {
try { return JSON.parse(localStorage.getItem(BIG_IDX_KEY) || '{}') || {}; } catch (e) { return {}; }
}
let _bigIdx = bigIdxLoad();
try {
Object.keys(_bigIdx).forEach(function (k) {
try { if (localStorage.getItem(k) !== null) localStorage.removeItem(k); } catch (e) {}
});
} catch (e) {}
let _bigIdxSaveTimer = null;
function bigIdxSave() {
if (_bigIdxSaveTimer) return;
_bigIdxSaveTimer = setTimeout(function () {
_bigIdxSaveTimer = null;
try { localStorage.setItem(BIG_IDX_KEY, JSON.stringify(_bigIdx)); } catch (e) {}
}, 300);
}
function bigIdxTrack(key, v) {
const big = typeof v === 'string' && v.length > LS_BIG_LIMIT;
if (big) {
if (_bigIdx[key] !== v.length) { _bigIdx[key] = v.length; bigIdxSave(); }
} else if (_bigIdx[key] !== undefined) {
delete _bigIdx[key]; bigIdxSave();
}
}
window.idbMemoSet = function (key, value) {
if (!key) return;
if (!memoryCache) memoryCache = {};
memoryCache[key] = value;
try {
let n;
if (typeof value === 'string') n = value.length;
else {
const est = (v, d) => {
if (typeof v === 'string') return v.length;
if (!v || typeof v !== 'object') return 32;
if (d > 4) return 64;
let s = 0;
if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) s += est(v[i], d + 1); return s + 16; }
for (const kk in v) { try { s += est(v[kk], d + 1); } catch (e2) {} }
return s + 64;
};
n = est(value, 0);
}
if (n > LS_BIG_LIMIT) { if (_bigIdx[key] !== n) { _bigIdx[key] = n; bigIdxSave(); } }
else if (_bigIdx[key] !== undefined) { delete _bigIdx[key]; bigIdxSave(); }
} catch (e) {}
};
let _lsWriteDead = null;
function lsWriteDead() {
if (_lsWriteDead !== null) return _lsWriteDead;
_lsWriteDead = false;
const pk = 'xy-home-v2:__ls-alive-probe';
try { localStorage.setItem(pk, 'mochi-ls-alive-probe-1'); } catch (e) { _lsWriteDead = true; }
try { localStorage.removeItem(pk); } catch (e2) {}
return _lsWriteDead;
}
function lsWriteDeadReset() { _lsWriteDead = null; } // #1443c：剥完残留腾出配额后让下一问重新试写
function lsUntrusted(k) {
if (lsWriteDead()) return true;
return !!(_lsDirtyKeys && _lsDirtyKeys.has(k));
}
window.xyLsWriteDead = lsWriteDead; // 只读探针：诊断单与清扫侧共用这一把尺
const LS_DIRTY_KEY = 'xy-home-v2:__ls-dirty';
let _lsDirtyKeys = null;
try {
const s = sessionStorage.getItem(LS_DIRTY_KEY);
if (s) { const arr = JSON.parse(s); if (Array.isArray(arr)) _lsDirtyKeys = new Set(arr); }
} catch (e) {}
function lsDirtySave() {
const arr = _lsDirtyKeys ? Array.from(_lsDirtyKeys) : [];
try { sessionStorage.setItem(LS_DIRTY_KEY, JSON.stringify(arr)); } catch (e) {}
try { if (window.idbSet) window.idbSet(LS_DIRTY_KEY, JSON.stringify(arr)); } catch (e) {}
}
function lsDirtyAdd(k) {
if (!_lsDirtyKeys) _lsDirtyKeys = new Set();
_lsDirtyKeys.add(k);
lsDirtySave();
}
function lsDirtyDel(k) {
if (_lsDirtyKeys && _lsDirtyKeys.delete(k)) lsDirtySave();
}
var _memoBlind = {};            // 键 -> true＝在册待问 / 'fly'＝已踢一趟，不叠发
function bigMissRehydrate(key) {
if (_memoBlind[key] === 'fly') return;
_memoBlind[key] = 'fly';
try {
bigHydAsk(key).then(function (st) {
if (st === 'unknown') delete _memoBlind[key];
}, function () { delete _memoBlind[key]; });
} catch (e) { delete _memoBlind[key]; }
}
const bigHydAbsent = {};     // 完整键名 -> 健康连接确认库里确实没有（本会话不再空读）#1469t：搬到此处的 _memoBlind 之前，同模块内先声明再问，不留 TDZ
function bigKeyBlind(key) { return !!_memoBlind[key] && !bigHydAbsent[key]; }
function bigReadUnconfirmed(key) {
if (memoryCache && (key in memoryCache)) return false;
try { if (localStorage.getItem(key) !== null) return false; } catch (e) { return true; }
if (bigKeyBlind(key)) return true;
var di = window.__xyIdbDeferredKeys;
if (Array.isArray(di) && di.indexOf(key) >= 0) return true;
if (typeof _bigIdx[key] === 'number' && _bigIdx[key] > LS_BIG_LIMIT && !bigHydAbsent[key]) return true;
if (window.mochiDataPending && window.mochiDataPending()) return true;
return false;
}
window.xyBigWriteBlocked = function (store, key, what, forced) {
try {
if (!forced && (!store || typeof store.awaitingBigKey !== 'function' || !store.awaitingBigKey(key))) return false;
} catch (e) { return false; }
try { if (store.requestBigKey) store.requestBigKey(key); } catch (e3) {}
if (window.toast) { try { window.toast((what || '这份数据') + '这次没读全（存储正忙）：等几秒再点一次即可，不需要重新设置'); } catch (e2) {} }
return true;
};
window.xyBigWriteHold = function (store, key) {
try {
if (!store || typeof store.awaitingBigKey !== 'function' || !store.awaitingBigKey(key)) return false;
} catch (e) { return false; }
try { if (store.requestBigKey) store.requestBigKey(key); } catch (e3) {}
return true;
};
window.xyPackageEmptyRead = function (store, key) {
try { return !!store && store.get(key) === null; } catch (e) { return true; }
};
window.__xyBigReadDiag = function () {
try {
var blind = 0, fly = 0;
for (var bk in _memoBlind) {
if (!Object.prototype.hasOwnProperty.call(_memoBlind, bk)) continue;
if (_memoBlind[bk] === 'fly') fly++; else blind++;
}
var di = Array.isArray(window.__xyIdbDeferredKeys) ? window.__xyIdbDeferredKeys.length : -1;
var un = 0;
for (var uk in _memoBlind) {
if (Object.prototype.hasOwnProperty.call(_memoBlind, uk) && bigReadUnconfirmed(uk)) un++;
}
return { blind: blind, asked: fly, deferred: di, unconfirmed: un };
} catch (e) { return null; }
};
window.xyStore = function (prefix) {
return {
get(k) {
const key = prefix + ':' + k;
if (memoryCache && key in memoryCache) return memoryCache[key];
try { const v = localStorage.getItem(key); if (v !== null) return v; } catch (e) {}
if (bigKeyBlind(key)) bigMissRehydrate(key);
return null;
},
awaitingBigKey(k) { return bigReadUnconfirmed(prefix + ':' + k); },
lsStale(k) { return !!(_lsDirtyKeys && _lsDirtyKeys.has(prefix + ':' + k)); },
requestBigKey(k) { try { bigMissRehydrate(prefix + ':' + k); } catch (e) {} },
whenBigKeyBack(k, cb) {
const full = prefix + ':' + k;
let unconfirmed = true;
try { unconfirmed = bigReadUnconfirmed(full); } catch (e) { unconfirmed = false; }
if (!unconfirmed) {
try { if (cb) cb(); } catch (e1) {}
return;
}
try { bigMissRehydrate(full); } catch (e2) {}
try {
Promise.resolve(bigHydAsk(full)).then(function (st) {
if (st !== 'ok') return;
try { if (cb) cb(); } catch (e3) {}
}, function () {});
} catch (e4) {}
},
set(k, v) {
const key = prefix + ':' + k;
if (!memoryCache) memoryCache = {};
memoryCache[key] = v;
try { delete _wrjReplayed[key]; } catch (e0) {}
try { bigIdxTrack(key, v); } catch (e) {}
let _wrjT = null; // FIX 2026-09-25 #1257c：标记不再随写同步落——值事务提交回执到点才补记（见下方 idbSet 处与 wrjRecord 尾注）
try { _wrjT = wrjRecord(key, v); } catch (e) {}
const big = typeof v === 'string' && v.length > LS_BIG_LIMIT;
if (!big) {
try {
localStorage.setItem(key, v);
lsDirtyDel(key); // 写成功 → 清除脏标记
} catch (e) {
lsDirtyAdd(key); // 写失败 → 标记：回填时该键以 IDB 为准
}
} else {
try { if (window.__mochiPhase) window.__mochiPhase('idb-big:' + String(k).slice(0, 18)); } catch (e0) {}
try { localStorage.removeItem(key); } catch (e) {}
}
try {
if (window.idbSet) {
const _p = window.idbSet(key, v);
if (_wrjT && _p && _p.then) _p.then(function (ok) { if (ok) wrjMark(key, _wrjT); }, function () {});
else if (_wrjT) wrjMark(key, _wrjT);
}
} catch (e) {}
},
remove(k) {
const key = prefix + ':' + k;
if (memoryCache) delete memoryCache[key];
try { localStorage.removeItem(key); } catch (e) {}
try { wrjForget(key); } catch (e) {}
if (_bigIdx[key] !== undefined) { delete _bigIdx[key]; bigIdxSave(); }
try { if (window.idbDelete) window.idbDelete(key); } catch (e) {}
}
};
};
window.idbMemoStats = function (topN) {
try {
if (!memoryCache) return { n: 0, bytes: 0, top: [] };
const arr = Object.keys(memoryCache).map(function (k) {
const v = memoryCache[k];
const len = typeof v === 'string' ? v.length : (_bigIdx[k] || -1);
return { k: k, len: len };
});
let total = 0;
arr.forEach(function (e) { if (e.len > 0) total += e.len; });
arr.sort(function (a, b) { return b.len - a.len; });
return { n: arr.length, bytes: total, top: arr.slice(0, topN || 6) };
} catch (e) { return { n: 0, bytes: 0, top: [] }; }
};
window.idbMemoDrop = function (key) {
try {
if (memoryCache) delete memoryCache[key];
if (_bigIdx[key] !== undefined) { delete _bigIdx[key]; bigIdxSave(); }
} catch (e) {}
};
var MEMO_BG_DROP_BYTES = 256 * 1024; // 单键 ≥256KB 即在切后台时放掉；与 lsBig 同一量级
window.idbMemoReleaseBig = function (minBytes) {
try {
if (!memoryCache) return 0;
var lim = (typeof minBytes === 'number' && minBytes > 0) ? minBytes : MEMO_BG_DROP_BYTES;
var dropped = 0;
for (var k in memoryCache) {
if (!Object.prototype.hasOwnProperty.call(memoryCache, k)) continue;
var v = memoryCache[k];
var len = (typeof v === 'string') ? v.length : (_bigIdx[k] || -1);
if (len > 0 && len >= lim) { delete memoryCache[k]; _memoBlind[k] = true; dropped++; }
}
return dropped;
} catch (e) { return 0; }
};
(function () {
var onBg = function () { try { if (window.idbMemoReleaseBig) window.idbMemoReleaseBig(); } catch (e1) {} };
try { document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') onBg(); }); } catch (e2) {}
try { window.addEventListener('pagehide', onBg); } catch (e3) {}
})();
window.idbGetCached = function (key) {
if (memoryCache && Object.prototype.hasOwnProperty.call(memoryCache, key)) return memoryCache[key];
return undefined;
};
function isChatMsgsKey(k) {
if (!k || typeof k !== 'string') return false;
if (k.indexOf('xy-home-v2:') !== 0) return false;
const tail = k.slice('xy-home-v2:'.length);
if (tail === 'chat-arch' || /^[^:]+:chat-arch$/.test(tail)) return true;
return tail === 'chat-msgs' || /^[^:]+:chat-msgs$/.test(tail);
}
function isGroupMsgsKey(k) {
if (!k || typeof k !== 'string') return false;
return k === 'xy-home-v2:group-chat-msgs' || /^xy-home-v2:gc-msgs-.+$/.test(k);
}
const DATA_PENDING_CEILING_MS = 120000;
window.mochiDataState = function () {
if (window.__mochiDataReady) return 'ready';
try {
if (window.__mochiLoadT && Date.now() - window.__mochiLoadT > DATA_PENDING_CEILING_MS) return 'timeout';
} catch (e) {}
try { if (window.__mochiDataSlow) return 'slow'; } catch (e) {}
return 'loading';
};
window.mochiDataPending = function () {
const s = window.mochiDataState();
return s === 'loading' || s === 'slow';
};
window.mochiLoadingText = function () { return '正在读取…'; };
window.mochiLoadingHtml = function (what) {
return '<div class="mochi-data-loading">' + (what || '内容') + '还在读取，稍候会自动刷新</div>';
};
const HIST_FOLD_OPEN = {};
function histFoldRemember(e) {
try {
const el = e.target;
if (!el || el.tagName !== 'DETAILS' || !el.getAttribute) return;
const fk = el.getAttribute('data-hist-fold');
if (!fk) return;
HIST_FOLD_OPEN[fk] = el.open ? 1 : 0;
} catch (err) {}
}
if (!window.__mochiHistFoldBound) {
window.__mochiHistFoldBound = 1;
try { document.addEventListener('toggle', histFoldRemember, true); } catch (err) {}
}
window.mochiHistFold = function (items, opts) {
const o = opts || {};
const list = (Array.isArray(items) ? items : []).filter(x => x && typeof x.html === 'string');
if (!list.length) return o.empty || '';
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
const today = dayKey(Date.now());
const todayItems = [], months = {}, monthKeys = [];
list.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach(x => {
const dk = x.ts ? dayKey(x.ts) : '';
if (dk === today) { todayItems.push(x); return; }
const d = x.ts ? new Date(x.ts) : null;
const mk = d ? d.getFullYear() + '-' + (d.getMonth() + 1) : 'none';
if (!months[mk]) { months[mk] = { label: d ? d.getFullYear() + '年' + (d.getMonth() + 1) + '月' : '更早', rank: d ? d.getFullYear() * 12 + d.getMonth() : -1, days: {}, dayKeys: [] }; monthKeys.push(mk); }
const m = months[mk], key = dk || 'none';
if (!m.days[key]) { m.days[key] = { label: d ? mochiHistDayLabel(d) : '更早', items: [] }; m.dayKeys.push(key); }
m.days[key].items.push(x);
});
monthKeys.sort((a, b) => months[b].rank - months[a].rank);
let html = todayItems.length ? todayItems.map(x => x.html).join('') : (o.todayEmpty || '');
const fkBase = (typeof o.key === 'string' && o.key) ? o.key : 'hist';
return html + monthKeys.map(mk => {
const m = months[mk];
const cnt = m.dayKeys.reduce((n, k) => n + m.days[k].items.length, 0);
const fk = fkBase + '|' + mk;
return '<details class="dc-h-more"' + (HIST_FOLD_OPEN[fk] ? ' open' : '') + ' data-hist-fold="' + fk + '"><summary class="dc-h-more-sum">' + m.label + '<span class="dc-h-more-cnt">' + cnt + ' 条</span></summary><div class="dc-h-more-body">' +
m.dayKeys.map(dk => '<div class="dc-h-day"><div class="dc-h-day-label">' + m.days[dk].label + '</div>' + m.days[dk].items.map(x => x.html).join('') + '</div>').join('') +
'</div></details>';
}).join('');
};
function mochiHistDayLabel(d) {
const now = new Date(), t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const one = 864e5, d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
const diff = Math.round((t - d0) / one);
if (diff === 1) return '昨天';
if (diff === 2) return '前天';
const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '年' + md;
}
window.mochiHistDel = function (key, label) {
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
return '<button type="button" class="hist-del" data-hist-del="' + esc(key) + '" data-hist-label="' + esc(label) + '"' +
' style="float:right;margin:0 0 2px 8px;border:0;background:none;color:inherit;opacity:.42;font-size:11px;font-weight:400;padding:2px 2px;cursor:pointer">删除</button>';
};
window.mochiHistDelBind = function (el, opts) {
const o = opts || {};
if (!el || el.__mochiHistDelBound || typeof o.onDel !== 'function') return;
el.__mochiHistDelBound = 1;
el.addEventListener('click', function (e) {
const btn = e.target && e.target.closest ? e.target.closest('.hist-del') : null;
if (!btn || !el.contains(btn)) return;
e.preventDefault(); e.stopPropagation();
const key = btn.getAttribute('data-hist-del') || '';
const label = btn.getAttribute('data-hist-label') || '';
if (typeof window.mochiDataPending === 'function' && window.mochiDataPending()) {
try { if (typeof window.toast === 'function') window.toast('记录还在读取，稍等一下再删'); } catch (er) {}
return;
}
if (typeof window.openModal !== 'function') { try { o.onDel(key); } catch (er) {} return; }
window.openModal(o.title || '删除这条记录？', '', function (v) {
if (v === 'ok') { try { o.onDel(key); } catch (er) {} }
}, { noInput: true, staticText: label ? ('「' + label + '」') : (o.what || '这一条') });
}, true); // 捕获阶段：心意柜这类「整行本身可点开详情」的列表，必须抢在行自己的 click 之前拦下，
};
window.mochiOnDataReady = function (fn) {
if (window.mochiDataState() === 'ready') {
try { setTimeout(function () { try { fn(); } catch (e) {} }, 0); } catch (e) {}
}
try {
document.addEventListener('mochi-restore-done', function () { try { fn(); } catch (e) {} });
} catch (e) {}
};
window.idbRestore = function (uidPrefix) {
let readySent = false;
const sendReady = function () {
if (readySent) return;
readySent = true;
try { window.__mochiDataReady = true; } catch (e) {}
try { document.dispatchEvent(new Event('mochi-restore-done')); } catch (e) {}
};
let finished = false;
const finish = function () {
if (finished) return;
finished = true;
clearTimeout(safety);
sendReady();
};
const safety = setTimeout(function () {
if (finished) return;
try { window.__mochiDataSlow = true; } catch (e) {}
try { document.dispatchEvent(new Event('mochi-restore-slow')); } catch (e) {}
}, 12000);
let listTries = 0;
const LIST_BACKOFF = [4000, 10000, 20000, 40000, 70000];
const readKeyList = function () {
return window.idbListKeys().then(function (keys) {
if (keys !== null) return keys;
if (finished || listTries >= LIST_BACKOFF.length) return null;
const wait = LIST_BACKOFF[listTries++];
try { if (window.__mochiPhase) window.__mochiPhase('restore-list-retry:' + listTries); } catch (e) {}
return new Promise(function (r) { setTimeout(r, wait); }).then(readKeyList);
});
};
Promise.all([readKeyList(), window.idbGet(LS_DIRTY_KEY)]).then(res => {
const keys = res[0];
try {
const arr = JSON.parse(res[1] || '[]');
if (Array.isArray(arr) && arr.length) {
if (!_lsDirtyKeys) _lsDirtyKeys = new Set();
arr.forEach(k => { if (k) _lsDirtyKeys.add(k); });
try { sessionStorage.setItem(LS_DIRTY_KEY, JSON.stringify(Array.from(_lsDirtyKeys))); } catch (e) {}
}
} catch (e) {}
if (keys === null) return;
if (!keys.length) { finish(); return; }
const need = (keys || []).filter(k =>
k.indexOf(uidPrefix) === 0 &&
k !== LS_DIRTY_KEY && // 脏键索引自身不回填
k.indexOf(uidPrefix + 'music-file:') !== 0 &&
k.indexOf(uidPrefix + 'media:') !== 0 &&
!isChatMsgsKey(k) &&
!isGroupMsgsKey(k) &&
k !== 'xy-home-v2:__auto-backup-snapshot' &&
k.indexOf('__wr-j:') < 0 &&
k !== 'xy-home-v2:call-active' &&
k !== BIG_IDX_KEY);
if (!need.length) { finish(); return; }
const deviceGB = (function () { try { return navigator.deviceMemory || 8; } catch (e) { return 8; } })();
const BIG_BUDGET = (deviceGB <= 4 ? 12 : 24) * 1024 * 1024;
let bigBudgetUsed = 0;
let budgetWarned = false;
window.__xyIdbDeferredKeys = [];
const neverRead = [], knownBig = [], rest = [];
need.forEach(function (k) {
const sz = _bigIdx[k];
if (typeof sz === 'number' && sz > LS_BIG_LIMIT) {
if (sz > BIG_BUDGET) neverRead.push(k);
else knownBig.push(k);
} else rest.push(k);
});
if (neverRead.length) {
budgetWarned = true;
neverRead.forEach(function (k) { window.__xyIdbDeferredKeys.push(k); });
try { console.info('[mochi] 启动回填：' + neverRead.length + ' 个超大键跳过加载（单键超 ' + Math.round(BIG_BUDGET / 1048576) + 'MB 预算），需要时可用 idbHydrateKey(键名) 按需取回'); } catch (e) {}
}
function retainValue(k, v) {
if (v === undefined || v === null) return false;
if (memoryCache && (k in memoryCache)) {
if (!wrjReplayOverride(k)) return false;
}
if (typeof v !== 'string') {
const estObj = (x, d) => {
if (typeof x === 'string') return x.length;
if (!x || typeof x !== 'object') return 32;
if (d > 4) return 64;
let s = 0;
if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) s += estObj(x[i], d + 1); return s + 16; }
for (const kk in x) { try { s += estObj(x[kk], d + 1); } catch (e2) {} }
return s + 64;
};
const nObj = estObj(v, 0);
if (nObj > LS_BIG_LIMIT) {
try { if (_bigIdx[k] !== nObj) { _bigIdx[k] = nObj; bigIdxSave(); } } catch (e0) {}
if (nObj > BIG_BUDGET || bigBudgetUsed + nObj > BIG_BUDGET) {
window.__xyIdbDeferredKeys.push(k);
if (!budgetWarned) { budgetWarned = true; try { console.info('[mochi] 启动回填：大键驻留超预算(' + Math.round(BIG_BUDGET / 1048576) + 'MB)，超出部分本会话挂起，可随时 idbHydrateKey(键名) 按需取回'); } catch (e0) {} }
return false;
}
bigBudgetUsed += nObj;
if (!memoryCache) memoryCache = {};
memoryCache[k] = v;
return true;
}
}
let str = typeof v === 'string' ? v : JSON.stringify(v);
let lsVal = null;
try { lsVal = localStorage.getItem(k); } catch (e) {}
if (lsVal !== null && !lsUntrusted(k)) {
str = lsVal;
}
try { if (str.length > LS_BIG_LIMIT) { if (_bigIdx[k] !== str.length) { _bigIdx[k] = str.length; bigIdxSave(); } } else if (_bigIdx[k] !== undefined) { delete _bigIdx[k]; bigIdxSave(); } } catch (e) {}
if (str.length > LS_BIG_LIMIT) {
if (str.length > BIG_BUDGET || bigBudgetUsed + str.length > BIG_BUDGET) {
window.__xyIdbDeferredKeys.push(k);
if (!budgetWarned) {
budgetWarned = true;
try { console.info('[mochi] 启动回填：大键驻留超预算(' + Math.round(BIG_BUDGET / 1048576) + 'MB)，超出部分本会话挂起，可随时 idbHydrateKey(键名) 按需取回'); } catch (e) {}
}
return false;
}
bigBudgetUsed += str.length;
}
if (!memoryCache) memoryCache = {};
memoryCache[k] = str;
if (str.length > LS_BIG_LIMIT) return true;
try {
if (!localStorage.getItem(k)) localStorage.setItem(k, str);
} catch (e) {}
return true;
}
const soloQueue = knownBig.map(function (k) { return [k]; });
let restIdx = 0;
let curBatch = 1;
let smallStreak = 0;
function takeUnit() {
if (soloQueue.length) return soloQueue.shift();
if (restIdx >= rest.length) return null;
const u = rest.slice(restIdx, restIdx + curBatch);
restIdx += u.length;
return u;
}
function processBatch() {
if (finished) return;
const unit = takeUnit();
if (!unit) { finish(); return; }
window.idbGetMany(unit).then(map => {
let bytes = 0, allSmall = true;
unit.forEach(k => { const v = map[k]; if (typeof v === 'string') { bytes += v.length; if (v.length > 65536) allSmall = false; } });
try { unit.forEach(function (k) { if (!(k in map) && window.__xyIdbDeferredKeys.indexOf(k) < 0) window.__xyIdbDeferredKeys.push(k); }); } catch (e0) {}
unit.forEach(k => { retainValue(k, map[k]); map[k] = null; });
if (bytes > 2 * 1048576) { curBatch = 1; smallStreak = 0; }
else if (allSmall && ++smallStreak >= 10 && curBatch === 1) { curBatch = 4; smallStreak = 0; }
setTimeout(processBatch, 0); // 让出主线程，下一批
}).catch(() => {
try { unit.forEach(function (k) { if (window.__xyIdbDeferredKeys.indexOf(k) < 0) window.__xyIdbDeferredKeys.push(k); }); } catch (e0) {}
setTimeout(processBatch, 0);
});
}
setTimeout(processBatch, 0);
}).catch(() => { finish(); });
};
window.idbHydrateKey = function (key) {
return open().then(db => new Promise((resolve) => {
let done = false;
let timer = null;
function finish(val) { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(val); }
function run() {
try {
const tx = db.transaction(STORE, 'readonly');
const req = tx.objectStore(STORE).get(key);
req.onsuccess = () => {
const _rK = reqResultSafe(req);
if (!_rK.ok) {
if (connLost(_rK.e)) dbPromise = null;
if (!retried) {
retried = true;
dbPromise = null;
open().then(function (db2) { db = db2; run(); }).catch(function () { finish(undefined); });
return;
}
finish(undefined);
return;
}
finish(_rK.v === undefined ? null : _rK.v);
};
req.onerror = () => { if (connLost(req.error)) dbPromise = null; finish(undefined); };
} catch (e) { if (connLost(e)) dbPromise = null; finish(undefined); }
}
let retried = false;
timer = setTimeout(function () {
if (done) return;
if (!retried) {
retried = true;
dbPromise = null;
open().then(function (db2) { db = db2; run(); timer = setTimeout(function () { dbPromise = null; finish(undefined); }, 8000); }).catch(function () { finish(undefined); });
return;
}
dbPromise = null;
finish(undefined);
}, 6000);
run();
})).then(v => {
if (v === null) return null;
if (v === undefined) return false;
if (!(memoryCache && (key in memoryCache)) || wrjReplayUnvouched(key)) {
if (typeof v !== 'string') {
const estObj = (x, d) => {
if (typeof x === 'string') return x.length;
if (!x || typeof x !== 'object') return 32;
if (d > 4) return 64;
let s = 0;
if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) s += estObj(x[i], d + 1); return s + 16; }
for (const kk in x) { try { s += estObj(x[kk], d + 1); } catch (e2) {} }
return s + 64;
};
const nObj = estObj(v, 0);
if (nObj > LS_BIG_LIMIT) {
if (!memoryCache) memoryCache = {};
memoryCache[key] = v;
try { if (_bigIdx[key] !== nObj) { _bigIdx[key] = nObj; bigIdxSave(); } } catch (e0) {}
const di0 = window.__xyIdbDeferredKeys;
if (Array.isArray(di0)) { const i0 = di0.indexOf(key); if (i0 >= 0) di0.splice(i0, 1); }
return true;
}
}
let str = typeof v === 'string' ? v : JSON.stringify(v);
let lsVal = null;
try { lsVal = localStorage.getItem(key); } catch (e) {}
if (lsVal !== null && !lsUntrusted(key)) {
str = lsVal;
}
if (!memoryCache) memoryCache = {};
memoryCache[key] = str;
try { if (str.length > LS_BIG_LIMIT) { if (_bigIdx[key] !== str.length) { _bigIdx[key] = str.length; bigIdxSave(); } } } catch (e) {}
if (str.length <= LS_BIG_LIMIT) { try { if (!localStorage.getItem(key)) localStorage.setItem(key, str); } catch (e) {} }
}
const di = window.__xyIdbDeferredKeys;
if (Array.isArray(di)) { const i = di.indexOf(key); if (i >= 0) di.splice(i, 1); }
return true;
}).catch(() => false);
};
const bigHydInflight = {};   // 完整键名 -> 进行中的取回（同键并发合流，不重复读 MB 级值）
function bigHydAsk(full) {
if (bigHydInflight[full]) return bigHydInflight[full];
if (typeof window.idbHydrateKey !== 'function') return Promise.resolve('unknown');
bigHydInflight[full] = Promise.resolve(window.idbHydrateKey(full)).then((v) => {
delete bigHydInflight[full];
if (v === true) return 'ok';
if (v === null) { bigHydAbsent[full] = true; return 'absent'; }
return 'unknown';
}).catch(() => { delete bigHydInflight[full]; return 'unknown'; });
return bigHydInflight[full];
}
window.idbBigKeyCandidates = function (relKey) {
if (typeof relKey === 'string' && relKey.indexOf('xy-home-v2:') === 0) return [relKey];
let prefix = 'xy-home-v2:default';
try { if (window.activePrefix) prefix = window.activePrefix() || prefix; } catch (e) {}
const out = [prefix + ':' + relKey];
try {
const legacy = 'xy-home-v2:' + relKey;
if ((!window.__activeCid || window.__activeCid === 'default') && out.indexOf(legacy) < 0) out.push(legacy);
} catch (e) {}
return out;
};
window.idbBigIdxSize = function (relKey) {
if (typeof relKey !== 'string' || !relKey) return undefined;
let cands = [];
try { cands = window.idbBigKeyCandidates(relKey) || []; } catch (e) {}
for (let i = 0; i < cands.length; i++) {
const n = _bigIdx[cands[i]];
if (typeof n === 'number' && n > 0) return n;
}
return undefined;
};
window.idbEnsureBigKey = function (relKey) {
if (typeof relKey !== 'string' || !relKey) return Promise.resolve('unknown');
const hyd = window.idbHydrateKey;
if (typeof hyd !== 'function') return Promise.resolve('unknown');
const cands = window.idbBigKeyCandidates(relKey);
let sawAbsent = false, sawUnknown = false;
const step = (i) => {
if (i >= cands.length) return Promise.resolve(sawAbsent && !sawUnknown ? 'absent' : 'unknown');
const full = cands[i];
if (bigHydAbsent[full]) { sawAbsent = true; return step(i + 1); }
const settle = (r) => {
if (r === 'ok') return 'ok';
if (r === 'absent') sawAbsent = true; else sawUnknown = true;
return step(i + 1);
};
if (bigHydInflight[full]) return bigHydInflight[full].then(settle);
return bigHydAsk(full).then(settle);
};
return step(0);
};
window.idbResetBigKeyProbe = function () {
try { for (const k in bigHydAbsent) delete bigHydAbsent[k]; } catch (e) {}
try { for (const k in bigHydInflight) delete bigHydInflight[k]; } catch (e) {}
};
window.idbBigKeyLanded = function (relKey, gap) {
if (typeof relKey !== 'string' || !relKey || typeof window.idbHasKey !== 'function') return Promise.resolve('unknown');
let full = '';
try { full = (window.idbBigKeyCandidates(relKey) || [])[0] || ''; } catch (e) {}
if (!full) return Promise.resolve('unknown');
const lsHeld = (() => {
try { return _bigIdx[full] === undefined && localStorage.getItem(full) !== null && !(_lsDirtyKeys && _lsDirtyKeys.has(full)); } catch (e) { return false; }
})();
if (lsHeld) return Promise.resolve('landed');
const once = () => Promise.resolve(window.idbHasKey(full)).then(
(h) => (h === true ? 'landed' : (h === false ? 'missing' : 'unknown')), () => 'unknown');
return once().then((r) => {
if (r !== 'missing') return r;
return new Promise((res) => { setTimeout(() => res(once()), gap || 1200); });
});
};
const WRJ_KEY = 'xy-home-v2:__wr-journal';
const WRJ_MARK = 'xy-home-v2:__wr-j:';
const WRJ_MAX = 24;              // 条数上限（#960：40→24，覆盖窗口仍远大于 IDB 标记 150ms 冲刷节奏）
const WRJ_BUDGET = 64 * 1024;    // 值+键字符总量上限（#960：128→64KB 且预算计入键名/结构开销——原口径漏算键名，实测「128KB 预算」产出 183.7KB 包；每次小键写入都整包 stringify+同步写 LS，包越大人越容易掉帧）
const WRJ_VAL_LIMIT = 64 * 1024; // 单值超过不记录（大键有自己的恢复路径）
let _wrj = null;                 // [{k, v, t}]，按 key 去重、最新在前
let _wrjTimes = {};              // key -> 最近一次已知写入时间（回放/合并/本会话写入共用）
let _wrjMerged = false;
let _wrjStranded = false;        // 日志这一路落盘被拒过＝这本账冻结了，不再充当权威
let _wrjStrandedN = 0;           // 被拒次数（只给诊断单看现场）
const _wrjReplayed = {};         // key -> true：memoryCache 里这一键来自冻结日志的回放（不是本会话写的）
function wrjReplayUnvouched(key) { return !!(_wrjStranded && _wrjReplayed[key]); }
function wrjReplayOverride(key) {
if (!wrjReplayUnvouched(key)) return false;
delete _wrjReplayed[key]; // 库里的权威值已经接管这一键
return true;
}
window.__wrjDiag = function () {
let n = 0; for (const k in _wrjReplayed) n++;
return { stranded: _wrjStranded, rej: _wrjStrandedN, replayed: n };
};
function wrjLoad(raw) {
try {
const a = JSON.parse(raw || '[]');
return Array.isArray(a) ? a.filter(function (e) { return e && typeof e.k === 'string' && typeof e.v === 'string' && typeof e.t === 'number'; }) : [];
} catch (e) { return []; }
}
function wrjLsRaw() { try { return localStorage.getItem(WRJ_KEY); } catch (e) { return null; } }
let _wrjPersistT = null;
const WRJ_FLUSH_MS = 200, WRJ_BUSY_CAP = 1200;
let _wrjDue = 0, _wrjCap = 0;
function wrjBusy() {
try { return !!(window.__mochiInteracting && window.__mochiInteracting()); } catch (e) { return false; }
}
let _wrjLanded = null;             // 上一次真的写进 localStorage 的那份序列化串
function wrjPersistFlush() {
if (_wrjPersistT) { clearTimeout(_wrjPersistT); _wrjPersistT = null; }
_wrjDue = 0; _wrjCap = 0; // #1206 回看/落盘一并作废，下一次排程重新起表
let s;
try { s = JSON.stringify(_wrj || []); } catch (e0) { return; }
if (s === _wrjLanded) return;    // 内容没变＝库里那份就是它，不必再同步重写一整本
try { if (window.__mochiPhase) window.__mochiPhase('wrj-journal'); } catch (e1) {}
try { localStorage.setItem(WRJ_KEY, s); _wrjLanded = s; } catch (e2) {}
if (_wrjLanded !== s) { _wrjStranded = true; _wrjStrandedN++; }
}
function wrjPersistAt() {
_wrjPersistT = null;
const now = Date.now();
if (wrjBusy() && now < _wrjCap) { _wrjPersistT = setTimeout(wrjPersistAt, 150); return; }
wrjPersistFlush();
}
function wrjPersist() {
if (_wrjPersistT) return;
const now = Date.now();
if (!_wrjDue) _wrjDue = now + WRJ_FLUSH_MS;
if (!_wrjCap) _wrjCap = now + WRJ_BUSY_CAP;
_wrjPersistT = setTimeout(wrjPersistAt, Math.max(0, Math.min(_wrjDue, _wrjCap) - now));
}
const WRJ_MARK_FLUSH_MS = 150;
let _wrjMarkBuf = new Map(); // 完整标记键 -> t
let _wrjMarkT = null;
let _wrjMarkDue = 0, _wrjMarkCap = 0; // #1206 让路用的到期点/硬上限（0＝未排程）
function wrjMarkFlush() {
if (_wrjMarkT) { clearTimeout(_wrjMarkT); _wrjMarkT = null; }
_wrjMarkDue = 0; _wrjMarkCap = 0;
if (!_wrjMarkBuf.size) return;
const pairs = [];
_wrjMarkBuf.forEach(function (t, k) { pairs.push({ k: k, v: t }); });
_wrjMarkBuf.clear();
try {
if (window.idbSetAll) {
window.idbSetAll(pairs).then(function (ok) {
if (ok) return;
pairs.forEach(function (p) { try { if (window.idbSet) window.idbSet(p.k, p.v); } catch (e2) {} });
}).catch(function () {});
return;
}
} catch (e) {}
pairs.forEach(function (p) { try { if (window.idbSet) window.idbSet(p.k, p.v); } catch (e2) {} });
}
function wrjMarkSchedule() {
if (_wrjMarkT) return;
const now = Date.now();
if (!_wrjMarkDue) _wrjMarkDue = now + WRJ_MARK_FLUSH_MS;
if (!_wrjMarkCap) _wrjMarkCap = now + WRJ_BUSY_CAP;
_wrjMarkT = setTimeout(wrjMarkAt, Math.max(0, Math.min(_wrjMarkDue, _wrjMarkCap) - now));
}
function wrjMarkAt() {
_wrjMarkT = null;
const now = Date.now();
if (wrjBusy() && now < _wrjMarkCap) { _wrjMarkT = setTimeout(wrjMarkAt, 150); return; }
wrjMarkFlush();
}
function wrjMark(key, t) {
_wrjMarkBuf.set(WRJ_MARK + key, t);
wrjMarkSchedule();
}
function wrjUnmark(key) {
_wrjMarkBuf.delete(WRJ_MARK + key); // 还没落库的标记直接撤销，省一个删除事务
try { if (window.idbDelete) window.idbDelete(WRJ_MARK + key); } catch (e) {}
}
function wrjRecord(key, v) {
if (!key || key === WRJ_KEY || key.indexOf('__') >= 0) return;
if (isChatMsgsKey(key) || /:chat-meta$/.test(key) || key.indexOf('music-file:') >= 0) return;
if (typeof v === 'string' && v.length > WRJ_VAL_LIMIT) { wrjForget(key); return; }
if (typeof v !== 'string') return;
if (!_wrj) _wrj = wrjLoad(wrjLsRaw());
const t = Date.now();
_wrj = _wrj.filter(function (e) { return e.k !== key; });
_wrj.unshift({ k: key, v: v, t: t });
let chars = 0, cut = _wrj.length;
for (let i = 0; i < _wrj.length; i++) {
chars += _wrj[i].v.length + _wrj[i].k.length + 24; // #960：键名+结构开销一并计入，预算才真实约束产物大小
if (i >= WRJ_MAX || chars > WRJ_BUDGET) { cut = i; break; }
}
if (cut < _wrj.length) _wrj.length = cut;
_wrjTimes[key] = t;
wrjPersist();
return t; // FIX 2026-09-25 #1257b：只报时间戳、不再当场 wrjMark——标记由调用方在值事务提交回执后补记（见 xyStore.set）；删掉这层交接＝「旧值+新标记」自愈反噬复发
}
function wrjForget(key) {
if (!_wrj) _wrj = wrjLoad(wrjLsRaw());
const before = _wrj.length;
_wrj = _wrj.filter(function (e) { return e.k !== key; });
_wrjTimes[key] = Date.now();
if (_wrj.length !== before) wrjPersist();
wrjUnmark(key);
}
try {
document.addEventListener('visibilitychange', function () {
try { if (document.visibilityState === 'hidden') { wrjMarkFlush(); wrjPersistFlush(); } } catch (e) {}
});
} catch (e) {}
try { if (window.addEventListener) window.addEventListener('pagehide', function () { try { wrjMarkFlush(); wrjPersistFlush(); } catch (e) {} }); } catch (e) {}
function wrjReplay(entries) {
if (!entries || !entries.length) return 0;
if (!memoryCache) memoryCache = {};
let n = 0;
let _wrjDirtyTouched = false;
entries.forEach(function (e) {
if ((_wrjTimes[e.k] || 0) >= e.t) return;
_wrjTimes[e.k] = e.t;
if (memoryCache[e.k] === e.v) return;
memoryCache[e.k] = e.v;
if (_wrjStranded) {
_wrjReplayed[e.k] = true;
try {
if (!_lsDirtyKeys) _lsDirtyKeys = new Set();
if (!_lsDirtyKeys.has(e.k)) { _lsDirtyKeys.add(e.k); _wrjDirtyTouched = true; }
} catch (e3) {}
} else {
try { if (e.v.length <= LS_BIG_LIMIT) localStorage.setItem(e.k, e.v); } catch (e2) {}
}
if (!WRJ_REPLAY_NO_IDB) { try { if (window.idbSet) window.idbSet(e.k, e.v); } catch (e2) {} }
n++;
});
if (_wrjDirtyTouched) { try { lsDirtySave(); } catch (e4) {} } // #1335g：整场回放只落一次盘
return n;
}
var WRJ_REPLAY_NO_IDB = true;
function wrjBootCommitProbe() {
const entries = wrjLoad(wrjLsRaw());
_wrj = entries;
let payload = '';
try { payload = JSON.stringify(entries); } catch (e) { return entries; }
if (!payload || payload === '[]') return entries; // 空账本无所谓落不落盘
try {
localStorage.setItem(WRJ_KEY + ':probe', payload);
localStorage.removeItem(WRJ_KEY + ':probe');
} catch (e) { _wrjStranded = true; _wrjStrandedN++; try { localStorage.removeItem(WRJ_KEY + ':probe'); } catch (e2) {} }
return entries;
}
try { wrjReplay(wrjBootCommitProbe()); } catch (e) {}
let _wrjMergeTries = 0;
let _wrjMergeBusy = false;
function wrjMergeRetry() {
_wrjMergeBusy = false; // 各失败路径统一在此解锁，重试才能重新进入
if (_wrjMerged || _wrjMergeTries >= 5) return;
_wrjMergeTries++;
setTimeout(function () { try { wrjMergeFromIdb(); } catch (e) {} }, 10000);
}
function wrjMergeFromIdb() {
if (_wrjMerged || _wrjMergeBusy) return;
if (!window.idbListKeys || !window.idbGetMany) return;
_wrjMergeBusy = true;
window.idbListKeys().then(function (keys) {
if (!keys) { wrjMergeRetry(); return; }
const marked = keys.filter(function (k) { return String(k).indexOf(WRJ_MARK) === 0; });
if (!marked.length) { _wrjMergeBusy = false; _wrjMerged = true; return; }
window.idbGetMany(marked).then(function (marks) {
const cand = marked.filter(function (mk) {
const t = marks[mk];
const full = String(mk).slice(WRJ_MARK.length);
return typeof t === 'number' && t > (_wrjTimes[full] || 0);
});
if (!cand.length) {
const anyTs = marked.some(function (mk) { return typeof marks[mk] === 'number'; });
if (!anyTs) { wrjMergeRetry(); return; } // 有标记却全读不到数值＝这轮没读到，不是真没有
_wrjMergeBusy = false; _wrjMerged = true; // 标记都在但都不比已知写入新＝确实无可修
return;
}
_wrjMergeBusy = false; _wrjMerged = true;
window.idbGetMany(cand.map(function (mk) { return String(mk).slice(WRJ_MARK.length); })).then(function (vals) {
if (!memoryCache) memoryCache = {};
let healed = 0;
cand.forEach(function (mk) {
const full = String(mk).slice(WRJ_MARK.length);
const v = vals[full];
if (typeof v !== 'string' || v.length > WRJ_VAL_LIMIT) return;
_wrjTimes[full] = marks[mk];
if (memoryCache[full] === v) return;
memoryCache[full] = v;
try { if (v.length <= LS_BIG_LIMIT) localStorage.setItem(full, v); } catch (e2) {}
healed++;
});
if (healed > 0) {
try { document.dispatchEvent(new Event('mochi-wrj-heal')); } catch (e2) {}
}
});
});
}).catch(function () { wrjMergeRetry(); });
}
document.addEventListener('mochi-restore-done', wrjMergeFromIdb);
setTimeout(wrjMergeFromIdb, 15000); // restore 整体挂起时的兜底（正常走 mochi-restore-done，_wrjMerged 防重入）
window.__mochiLoadT = Date.now();
try { window.idbRestore('xy-home-v2:'); } catch (e) {}
try {
if (!sessionStorage.getItem('xy-ls-big-migrated')) {
let moved = 0;
const bigKeys = [];
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || k.indexOf('xy-home-v2:') !== 0) continue;
if (isChatMsgsKey(k)) continue;
if (isGroupMsgsKey(k)) continue;
if (k === 'xy-home-v2:__auto-backup-snapshot') continue;
const v = localStorage.getItem(k);
if (v && v.length > LS_BIG_LIMIT) bigKeys.push(k);
}
(async () => {
let moved = 0;
for (const k of bigKeys) {
const v = localStorage.getItem(k);
if (!v) continue;
try {
const ok = await window.idbSet(k, v);
if (ok) {
if (!memoryCache) memoryCache = {};
memoryCache[k] = v;
try { localStorage.removeItem(k); } catch (e) {}
moved++;
} else {
setTimeout(async function () {
try {
const v2 = localStorage.getItem(k);
if (!v2) return;
const ok2 = await window.idbSet(k, v2);
if (ok2) {
if (!memoryCache) memoryCache = {};
memoryCache[k] = v2;
try { localStorage.removeItem(k); } catch (e) {}
}
} catch (e) {}
}, 5000);
}
} catch (e) {}
}
if (moved > 0) { try { sessionStorage.setItem('xy-ls-big-migrated', '1'); } catch (e) {} }
})();
}
} catch (e) {}
window.idbBigSize = function (key) {
try { const s = _bigIdx[key]; return typeof s === 'number' ? s : null; } catch (e) { return null; }
};
let _lsSweepDone = false;
let _lsSweepFail = false;
let _lsSweepTries = 0;
function lsResidueSweep() {
if (_lsSweepDone) return;
_lsSweepDone = true;
_lsSweepFail = false;
if (!window.idbGet || !window.idbSet) return;
const markFail = function () { _lsSweepFail = true; };
let names = [];
try { names = Object.keys(localStorage); } catch (e) { return; }
const cands = names.filter(function (k) {
if (typeof k !== 'string' || k.indexOf('xy-home-v2:') !== 0) return false;
if (isChatMsgsKey(k)) return false;                  // 聊天 LS 快照是唯一备份，绝不动
if (k.indexOf('music-file:') >= 0) return false;     // 音频有专属迁移路径
if (k === BIG_IDX_KEY || k === LS_DIRTY_KEY || k === WRJ_KEY || k.indexOf('__wr-j:') === 0) return false;
if (k === 'xy-home-v2:__auto-backup-snapshot') return false;
let v = null;
try { v = localStorage.getItem(k); } catch (e) { return false; }
const minBytes = lsWriteDead() ? 32 * 1024 : LS_BIG_LIMIT;
return typeof v === 'string' && v.length > minBytes;
});
let i = 0;
(function step() {
if (i >= cands.length) {
try { lsWriteDeadReset(); } catch (eR) {}
if (_lsSweepFail && _lsSweepTries < 2) {
_lsSweepTries++;
_lsSweepDone = false;
setTimeout(lsResidueSweep, 60000);
}
return;
}
const k = cands[i++];
let lsVal = null;
try { lsVal = localStorage.getItem(k); } catch (e) {}
if (typeof lsVal !== 'string' || lsVal.length <= (lsWriteDead() ? 32 * 1024 : LS_BIG_LIMIT)) { setTimeout(step, 0); return; }
window.idbGet(k).then(function (idbVal) {
const next = function () { setTimeout(step, 0); };
if (idbVal && typeof idbVal !== 'string') { next(); return; }
if (typeof idbVal === 'string' && idbVal === lsVal) {
try { if (localStorage.getItem(k) === lsVal) localStorage.removeItem(k); } catch (e) {}
next(); return;
}
if (lsWriteDead()) {
if (typeof idbVal === 'string' && idbVal.length >= lsVal.length) {
if (!memoryCache) memoryCache = {};
if (!(k in memoryCache)) memoryCache[k] = idbVal;
try { if (localStorage.getItem(k) === lsVal) localStorage.removeItem(k); } catch (e0) {}
}
next(); return;
}
window.idbSet(k, lsVal).then(function (ok) {
if (ok) {
let cur = null;
try { cur = localStorage.getItem(k); } catch (e) {}
if (cur === lsVal) {
if (!memoryCache) memoryCache = {};
if (!(k in memoryCache)) memoryCache[k] = lsVal;
try { localStorage.removeItem(k); } catch (e) {}
}
} else { markFail(); } // #721 追平写失败（配额满/事务挂了）：这轮没清掉，稍后重试
next();
}).catch(function () { markFail(); next(); });
}).catch(function () { markFail(); setTimeout(step, 0); });
})();
}
document.addEventListener('mochi-restore-done', function () { setTimeout(lsResidueSweep, 20000); });
setTimeout(lsResidueSweep, 45000); // restore 挂起/事件丢失兜底（_lsSweepDone 防重入）
window.idbLsResidueSweep = lsResidueSweep;
window.addEventListener('storage', function (e) {
try {
if (e && e.key && memoryCache && e.key in memoryCache) delete memoryCache[e.key];
} catch (err) {}
});
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("idb.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("idb.js"); try { console.error("[JS] idb.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[idb.js] " + String(__e && __e.message || __e)); } })();
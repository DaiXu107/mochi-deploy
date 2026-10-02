(function () { try {
(function () {
const G = 'xy-home-v2:';
function libs() {
const out = [{ prefix: G, key: 'cc-groups-public', label: '公用字卡库' }];
try {
(window.getContacts ? window.getContacts() : []).forEach(function (c) {
if (c && c.id) out.push({ prefix: G + c.id + ':', key: 'cc-groups', label: (c.name || c.id) + ' · 专属' });
});
} catch (e) {}
out.push({ prefix: G, key: 'cc-groups', label: '旧版顶层字卡库（残留）' });
return out;
}
function parseLib(raw) {
try {
const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
const g = JSON.parse(s || 'null');
if (g && typeof g === 'object' && g.text) return g;
} catch (e) {}
return null;
}
window.mochiCcSlimScan = function () {
return (async function () {
const out = { ok: false, reason: '', libs: [], groups: [], totalBytes: 0 };
if (!window.idbListKeys || !window.idbGet) { out.reason = '接口不可用'; return out; }
const keys = await window.idbListKeys();
if (!keys) { out.reason = '键清单读取失败（存储繁忙），稍后再试'; return out; }
const keySet = {};
keys.forEach(function (k) { keySet[String(k)] = true; });
const list = libs().filter(function (L) { return keySet[L.prefix + L.key]; });
for (let i = 0; i < list.length; i++) {
const L = list[i];
const raw = await window.idbGet(L.prefix + L.key);
if (raw === undefined || raw === null) { out.reason = '字卡库「' + L.label + '」没读到（存储繁忙），结果可能不全'; continue; }
const g = parseLib(raw);
if (!g) continue;
let libBytes = 0;
Object.keys(g).forEach(function (cat) {
const arr = g[cat];
if (!Array.isArray(arr)) return;
arr.forEach(function (tu) {
if (!Array.isArray(tu) || typeof tu[0] !== 'string') return; // 非二元组结构不认，宁可少列不误删
let bytes = 0;
try { bytes = JSON.stringify(tu).length * 2; } catch (e) { return; }
libBytes += bytes;
out.groups.push({ prefix: L.prefix, key: L.key, label: L.label, cat: cat, name: tu[0], cards: Array.isArray(tu[1]) ? tu[1].length : 0, bytes: bytes });
});
});
out.libs.push({ label: L.label, bytes: libBytes });
out.totalBytes += libBytes;
}
out.groups.sort(function (a, b) { return b.bytes - a.bytes; });
out.ok = true;
return out;
})().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), libs: [], groups: [], totalBytes: 0 }; });
};
window.mochiCcSlimDeleteGroup = function (prefix, key, cat, name) {
return (async function () {
if (!window.idbGet || !window.xyStore) return false;
const pStore = String(prefix).replace(/:$/, '');
let raw = await window.idbGet(prefix + key);
if (raw === undefined || raw === null) return false;
const g = parseLib(raw);
if (!g || !Array.isArray(g[cat])) return false;
const before = g[cat].length;
g[cat] = g[cat].filter(function (tu) { return !(Array.isArray(tu) && tu[0] === name); });
if (g[cat].length === before) return false; // 组名没匹配到 → 不动
let s = '';
try { s = JSON.stringify(g); } catch (e) { return false; }
try { window.xyStore(pStore).set(key, s); } catch (e) { return false; }
try { await window.idbSet(pStore + ':' + key, s); } catch (e2) {}
return true;
})();
};
})();
(function () {
window.mochiPerfLevel = function (totalBytes, bigGroups) {
const mb = (Number(totalBytes) || 0) / 1048576;
const bg = Number(bigGroups) || 0;
if (mb > 16 || bg >= 6) return '重';
if (mb > 5 || bg >= 2) return '中';
return '轻';
};
window.mochiPerfAgg = function (rep) {
const agg = { ok: !!(rep && rep.ok), level: '轻', libs: 0, totalBytes: 0, biggestBytes: 0, bigGroups: 0, reason: (rep && rep.reason) || '' };
if (!rep || !rep.ok) return agg;
((rep.libs) || []).forEach(function (l) { agg.libs += 1; agg.totalBytes += (l.bytes || 0); });
((rep.groups) || []).forEach(function (g) {
const b = g.bytes || 0;
if (b > agg.biggestBytes) agg.biggestBytes = b;
if (b > 1048576) agg.bigGroups += 1; // 单分组 >1MB 通常是整组大图/动图媒体
});
agg.level = window.mochiPerfLevel(agg.totalBytes, agg.bigGroups);
return agg;
};
window.mochiPerfHeal = function (prog) {
return (async function () {
const out = { ok: false, hydrated: 0, warmed: 0, reason: '' };
const step = function (pct, label) { if (typeof prog === 'function') { try { prog(pct, label); } catch (e) {} } };
try {
if (window.hydrateLibScopes) {
try {
step(10, '取回大键库（读取本机存储）…');
await window.hydrateLibScopes(['public', 'own']);
out.hydrated = 2;
step(40, '取回完成');
}
catch (e) { out.reason = '取回:' + ((e && e.message) || e); }
} else { step(40, ''); }
if (window.getCustomCards) {
try {
step(45, '预热回复池（大库需稍等片刻）…');
const cards = window.getCustomCards();
out.warmed = Array.isArray(cards) ? cards.length : 0;
step(100, '预热完成');
}
catch (e) { out.reason = (out.reason ? out.reason + '；' : '') + '预热:' + ((e && e.message) || e); }
} else { step(100, ''); }
out.ok = true;
return out;
} catch (e) { out.reason = (out.reason ? out.reason + '；' : '') + '自愈:' + ((e && e.message) || e); return out; }
})();
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("storage-slim.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("storage-slim.js"); try { console.error("[JS] storage-slim.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[storage-slim.js] " + String(__e && __e.message || __e)); } })();
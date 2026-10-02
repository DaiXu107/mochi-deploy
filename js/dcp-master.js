(function () { try {
(function () {
function dcpAll(st) {
try {
const s = st || window.activeStore();
const v = s.get('reply-dcp-all');
if (v === null || v === undefined || v === '') return 100;
const n = Number(v);
if (isNaN(n)) return 100;
return Math.max(0, Math.min(100, n));
} catch (e) { return 100; }
}
function dcpEff(v, st) {
const n = Number(v);
if (!isFinite(n)) return 0;
let a = 100;
try { a = dcpAll(st); } catch (e) { a = 100; }
if (a >= 100) return Math.max(0, Math.min(100, n));
return Math.max(0, Math.min(100, Math.round(n * a / 100)));
}
window.dcpAll = dcpAll;
window.dcpEff = dcpEff;
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("dcp-master.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("dcp-master.js"); try { console.error("[JS] dcp-master.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[dcp-master.js] " + String(__e && __e.message || __e)); } })();
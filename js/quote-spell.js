(function () { try {
(function () {
function quotePool() {
let quotes = [];
try {
const grps = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
grps.forEach(g => {
(g[1] || []).forEach(q => { if (typeof q === 'string') quotes.push(q); });
});
} catch (e) { quotes = []; }
try {
if (window.isDefaultCardOff) quotes = quotes.filter(q => !window.isDefaultCardOff('dict', q));
} catch (e) {}
return quotes.filter(function (q) {
if (typeof q !== 'string' || !q.trim()) return false;
if (q.indexOf('data:') === 0 || q.indexOf('|||') >= 0) return false;
if (window.mochiMediaIsToken && window.mochiMediaIsToken(q)) return false; // FIX 2026-09-13 #394 媒体池令牌卡不进词典抽卡池
if (/[\uD800-\uDBFF]/.test(q)) return false; // emoji 整卡不拼
return true;
});
}
window.dictQuoteOne = function () {
try {
const p = quotePool();
return p.length ? p[Math.floor(Math.random() * p.length)] : null;
} catch (e) { return null; }
};
window.quoteSpellPick = function (c) {
try {
if (!c || c['qs-en'] !== 1) return null;
if (c['py-en'] !== 1) return null;
if (window.dictUse && window.dictUse('chat') === false) return null;
if (window.dictOverall && Math.random() * 100 >= window.dictOverall('chat')) return null;
const prob = (window.dcpEff ? window.dcpEff(Number(c['qs-prob'])) : Number(c['qs-prob'])); // #518 套总档
if (!isFinite(prob) || prob <= 0 || Math.random() * 100 >= prob) return null;
let pool = quotePool();
if (c['qs-cc'] === 1) {
try {
const p = (window.getPool && window.getPool()) || null;
if (p && p.text && p.text.length) {
pool = pool.concat(p.text.filter(function (s) {
if (typeof s !== 'string' || s.length < 2 || s.length > 26) return false;
if (s.indexOf('data:') === 0 || s.indexOf('|||') >= 0) return false;
if (window.mochiMediaIsToken && window.mochiMediaIsToken(s)) return false; // FIX 2026-09-13 #394 同款守卫（混入池二次校验）
if (/[\uD800-\uDBFF]/.test(s)) return false;
return (s.match(/[\u4e00-\u9fff]/g) || []).length >= 2;
}));
}
} catch (e) {}
}
if (!pool.length) return null;
const oneOn = c['qs-one'] === 1;
const multiOn = c['qs-multi'] === 1;
let one = true;
if (multiOn) one = oneOn ? Math.random() >= 0.2 : false;
const pmin = Math.max(1, Math.min(10, Number(c['qs-min']) || 2));
const pmax = Math.max(pmin, Math.min(10, Number(c['qs-max']) || 5));
let want = pmin + Math.floor(Math.random() * (pmax - pmin + 1));
if (!one && c['qs-noLimit'] === 0) {
const rmax = Math.max(pmin, Math.min(20, Number(c['reply-max']) || 2));
if (want > rmax) want = rmax;
}
const cards = [pool[Math.floor(Math.random() * pool.length)]];
for (let k = 0; k < 30 && cards.length < want; k++) {
const s2 = pool[Math.floor(Math.random() * pool.length)];
if (cards.indexOf(s2) < 0) cards.push(s2);
}
return { segs: cards, one: one };
} catch (e) { return null; }
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("quote-spell.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("quote-spell.js"); try { console.error("[JS] quote-spell.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[quote-spell.js] " + String(__e && __e.message || __e)); } })();
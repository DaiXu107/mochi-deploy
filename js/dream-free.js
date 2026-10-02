(function () { try {
(function () {
const FILL_WORDS = ['想你', '抱抱', '亲亲', '嘿嘿', '哦', '呀', '啦', '嘛', '呢', '哼',
'想你了', '最喜欢你', '晚安', '早安', '嘿嘿嘿', '哼哼', '呜呜', '嘻嘻', '好耶', '喵'];
const SUFFIXES = ['呀', '啦', '哦', '呢', '嘛', '哟', '哈', '嘿嘿'];
let lastSrc = '';     // 连续防复读：上一条造句的源卡不立刻重抽
let segDict = null;   // 切词词典缓存（词库* 分组构建一次）
let segMax = 4;       // 正向最大匹配窗口（随词典最长词增长，上限 8）
const HAN = /[\u4e00-\u9fff]/;
function getSegDict() {
if (segDict) return segDict;
segDict = new Set();
segMax = 4;
try {
((window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || []).forEach(g => {
if (!g || typeof g[0] !== 'string' || g[0].indexOf('词库') !== 0) return;
(g[1] || []).forEach(wd => {
if (typeof wd !== 'string' || wd.length < 2) return;
segDict.add(wd);
if (wd.length > segMax && wd.length <= 8) segMax = wd.length;
});
});
} catch (e) {}
return segDict;
}
function segment(s) {
const str = String(s == null ? '' : s);
const dict = getSegDict();
const out = [];
let i = 0;
while (i < str.length) {
if (!HAN.test(str[i])) {
let j = i;
while (j < str.length && !HAN.test(str[j])) j++;
out.push(str.slice(i, j));
i = j;
continue;
}
let len = 0;
for (let L = Math.min(segMax, str.length - i); L >= 2; L--) {
if (dict.has(str.slice(i, i + L))) { len = L; break; }
}
if (!len) len = 1;
out.push(str.slice(i, i + len));
i += len;
}
return out;
}
const isWordTok = t => HAN.test(t); // 含汉字＝词 token（非汉字 token 视为标点/符号段）
function filterCorpus(list) {
return (list || []).filter(function (s) {
if (typeof s !== 'string') return false;
if (s.length < 4 || s.length > 30) return false;
if (s.indexOf('data:') === 0 || s.indexOf('|||') >= 0) return false;
if (/[\uD800-\uDBFF]/.test(s)) return false;
return (s.match(/[\u4e00-\u9fff]/g) || []).length >= 4;
});
}
function customPool() {
let cards = [];
try { cards = (window.getCustomCards && window.getCustomCards()) || []; } catch (e) { cards = []; }
return filterCorpus(cards);
}
const DEF_CATS = ['main', 'kaomoji', 'emoji', 'touch'];
function defaultPool() {
try {
const all = [];
DEF_CATS.forEach(cat => {
if (window.defaultCardCat && !window.defaultCardCat(cat)) return;
const gs = (window.getDefaultCardGroups && window.getDefaultCardGroups(cat)) || [];
gs.forEach(g => ((g && g[1]) || []).forEach(t => {
if (window.isDefaultCardOff && window.isDefaultCardOff(cat, t)) return;
all.push(t);
}));
});
return filterCorpus(all);
} catch (e) { return []; }
}
function dictPool() {
try {
const gs = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
const all = gs.reduce((a, g) => a.concat((g && g[1]) || []), []);
return filterCorpus(all.filter(t => !(window.isDefaultCardOff && window.isDefaultCardOff('dict', t))));
} catch (e) { return []; }
}
function allCorpus() { return customPool().concat(defaultPool(), dictPool()); }
function pickSourcePool(c) {
const on = k => !(c && c[k] === 0); // 缺省=开（存量升级即得三源全开）
const wt = (k, d) => { const n = Number(c && c[k]); return (isFinite(n) && n > 0) ? n : d; };
const srcs = [];
if (on('mjf-src-cc')) { const p = customPool(); if (p.length) srcs.push({ w: wt('mjf-w-cc', 50), pool: p }); }
if (on('mjf-src-def')) { const p = defaultPool(); if (p.length) srcs.push({ w: wt('mjf-w-def', 25), pool: p }); }
if (on('mjf-src-dict')) { const p = dictPool(); if (p.length) srcs.push({ w: wt('mjf-w-dict', 25), pool: p }); }
if (!srcs.length) return null;
let total = 0;
srcs.forEach(s => { total += s.w; });
if (total <= 0) return srcs[Math.floor(Math.random() * srcs.length)].pool;
let r = Math.random() * total;
for (let i = 0; i < srcs.length; i++) { r -= srcs[i].w; if (r < 0) return srcs[i].pool; }
return srcs[srcs.length - 1].pool;
}
function recallCut(s) {
const str = String(s == null ? '' : s);
const toks = segment(str);
if (toks.length < 3) return null;
const gaps = [];
for (let i = 2; i < toks.length; i++) {
const keep = toks.slice(0, i).join('');
if ((keep.match(/[\u4e00-\u9fff]/g) || []).length >= 4) gaps.push(i);
}
if (!gaps.length) return null;
let total = 0, acc = [];
gaps.forEach(gi => { total += gi; acc.push(total); });
const r = Math.random() * total;
let gi = gaps[gaps.length - 1];
for (let k = 0; k < gaps.length; k++) { if (r < acc[k]) { gi = gaps[k]; break; } }
const out = toks.slice(0, gi).join('').replace(/[，、,\s]+$/, '');
return (out !== str && out.length >= 4) ? out : null;
}
function wordPool(excludeSrc) {
const pool = [];
allCorpus().forEach(card => {
if (card === excludeSrc) return;
segment(card).forEach(t => {
if (t.length >= 2 && isWordTok(t) && pool.indexOf(t) < 0) pool.push(t);
});
});
return pool;
}
function rebuild(s, mode, material) {
const str = String(s == null ? '' : s);
if (mode === 'recall') return recallCut(str);
if (mode === 'suffix') {
const base = str.replace(/[，。！？、…～s]+$/, '');
if (base.length < 3) return null;
const out = base + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
return out !== str ? out : null;
}
if (mode === 'addtail') {
let word = null;
if (material === 'cards') {
const wp = wordPool(str);
if (wp.length) word = wp[Math.floor(Math.random() * wp.length)];
} else {
word = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
}
if (!word) return null;
const base = str.replace(/[，。！？、…～\s]+$/, '');
const out = base + word;
return out !== str ? out : null;
}
if (mode === 'tailcut') {
const base = str.replace(/[，。！？、…～\s]+$/, '');
if (base.length < 4) return null;
const cut = 1 + Math.floor(Math.random() * Math.min(2, base.length - 2));
return base.slice(0, base.length - cut);
}
const toks = segment(str);
if (toks.length < 3) return null;
const gaps = [];
for (let i = 1; i < toks.length; i++) {
if (isWordTok(toks[i - 1]) && isWordTok(toks[i])) gaps.push(i); // 只落在词与词的间隙
}
if (!gaps.length) return null;
const gi = gaps[Math.floor(Math.random() * gaps.length)];
if (mode === 'cutfill') {
const rest = toks.slice(gi);
const wi = Math.floor(Math.random() * rest.length);
let fill;
if (material === 'cards') {
const wp = wordPool(str);
fill = wp.length ? wp[Math.floor(Math.random() * wp.length)] : FILL_WORDS[Math.floor(Math.random() * FILL_WORDS.length)];
} else {
fill = FILL_WORDS[Math.floor(Math.random() * FILL_WORDS.length)];
}
const out = toks.slice(0, gi).join('') + fill + rest.filter((_, k) => k !== wi).join('');
return out !== str ? out : null;
}
const sep = mode === 'comma' ? '，' : ' ';
const out = toks.slice(0, gi).join('') + sep + toks.slice(gi).join('');
return out !== str ? out : null;
}
const END_PUNCT_OK = /[。．！？!?~～…，、,.;；:：）)”’"]/;
const END_PUNCT_DEFAULT = ['。', '。', '。', '~', '！', '……'];
function poolFromSet(rawSet) {
let arr = null;
try { arr = JSON.parse(String(rawSet)); } catch (e) { return null; }
if (!Array.isArray(arr)) return null;
const out = arr.filter(it => it && typeof it.s === 'string' && it.s && it.s.length <= 6 && it.on === 1)
.map(it => it.s).slice(0, 20);
return out.length ? out : null;
}
function endPunctPool(c) {
if (c && Number(c['mjf-punct']) === 0) return null; // 关＝不补标点
if (c && c['mjf-punct-set']) {
const sel = poolFromSet(c['mjf-punct-set']);
if (sel) return sel;
}
const raw = c && c['mjf-punct-pool'] != null ? String(c['mjf-punct-pool']).trim() : '';
if (!raw) return END_PUNCT_DEFAULT;
let arr = raw.split(/[\s|]+/).filter(Boolean);
if (arr.length < 2) arr = Array.from(raw.replace(/[\s|]+/g, ''));
arr = arr.filter(x => x.length <= 6).slice(0, 20);
return arr.length ? arr : END_PUNCT_DEFAULT;
}
function withEndPunct(txt, c) {
const pool = endPunctPool(c);
if (!pool || !txt || typeof txt !== 'string') return txt;
if (END_PUNCT_OK.test(txt.charAt(txt.length - 1))) return txt;
return txt + pool[Math.floor(Math.random() * pool.length)];
}
window.dreamFreePick = function (c) {
try {
if (!c || c['mjf-en'] !== 1) return null;
const prob = Number(c['mjf-prob']);
if (!isFinite(prob) || prob <= 0 || Math.random() * 100 >= prob) return null;
const pool = pickSourcePool(c); // #413 三语料源按开关+权重抽
if (!pool || !pool.length) return null;
let style = Math.max(0, Math.min(2, Number(c['mjf-style']) || 1));
if (c['mjf-mix'] === 1) style = Math.floor(Math.random() * 3);
const pickOf = arr => arr[Math.floor(Math.random() * arr.length)];
for (let t = 0; t < 8; t++) {
const s = pool[Math.floor(Math.random() * pool.length)];
if (s === lastSrc) continue;
let mode, material = 'fixed';
if (style === 1) {
const r = Math.random();
mode = r < 0.5 ? 'recall' : (r < 0.75 ? 'comma' : 'space');
} else if (style === 2) {
material = 'cards';
mode = pickOf(['cutfill', 'comma', 'space', 'addtail', 'tailcut']);
} else {
mode = pickOf(['cutfill', 'comma', 'space', 'suffix', 'tailcut']);
}
const txt = withEndPunct(rebuild(s, mode, material), c);
if (txt && txt !== s) { lastSrc = s; return { text: txt, src: s }; }
}
return null;
} catch (e) { return null; }
};
window.dreamFreeSave = function (txt) {
try {
const v = String(txt == null ? '' : txt);
if (!v || v.indexOf('data:') === 0 || v.indexOf('|||') >= 0) return false;
if (!window.ccAppendCards) return false;
let pubProb = 80;
try {
const c = window.replyCfg && window.replyCfg();
const n = c ? Number(c['mjf-pub']) : NaN;
if (c && c['mjf-pub'] != null && c['mjf-pub'] !== '' && Number.isFinite(n)) pubProb = Math.max(0, Math.min(100, n));
} catch (e) {}
const usePublic = Math.random() * 100 < pubProb;
return !!window.ccAppendCards('mjfree', '梦角自由造句', [v], usePublic ? 'public' : 'own');
} catch (e) { return false; }
};
window.dreamFreeSegment = segment;
window.dreamFreeRebuild = rebuild;
window.dreamFreePunctPool = endPunctPool;
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("dream-free.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("dream-free.js"); try { console.error("[JS] dream-free.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[dream-free.js] " + String(__e && __e.message || __e)); } })();
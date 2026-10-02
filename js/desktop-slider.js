(function () { try {
(function () {
const pages = document.getElementById('desktop-pages');
if (!pages) return;
function getSlides() { return Array.prototype.slice.call(pages.querySelectorAll('.page-slide')); }
function getDots() { return Array.prototype.slice.call(document.querySelectorAll('#desktop-dots .dot')); }
let idx = 0;
let lastUserSwipeTs = 0;   // 最近一次真实用户翻页动作（touchstart/圆点跳页）
let swipeWarmTimer = null; // #1466：滑动期临时提层的收尾计时
function deskIdxKey() {
try {
const p = (typeof window.activePrefix === 'function') ? window.activePrefix() : '';
return p ? (p + ':desk-page-idx') : '';
} catch (e) { return ''; }
}
function deskIdxSave() {
try { const k = deskIdxKey(); if (k) localStorage.setItem(k, String(idx)); } catch (e) {}
}
function deskIdxSaved() {
try {
const k = deskIdxKey(); if (!k) return 0;
const v = parseInt(localStorage.getItem(k), 10);
return isNaN(v) ? 0 : v;
} catch (e) { return 0; }
}
function swipeWarm() {
try {
if (!pages.classList.contains('swipe-warm')) pages.classList.add('swipe-warm');
clearTimeout(swipeWarmTimer);
swipeWarmTimer = setTimeout(function () { pages.classList.remove('swipe-warm'); }, 150);
} catch (e) {}
}
let dotsCache = [];
let gapCache = null;
function refreshCache() {
dotsCache = getDots();
}
function pageStep() {
if (gapCache === null) gapCache = parseFloat(getComputedStyle(pages).columnGap) || 0;
return pages.clientWidth + gapCache;
}
function snapToIdx() {
const want = idx * pageStep();
if (Math.abs(pages.scrollLeft - want) > 1) pages.scrollLeft = want;
}
function paint(cur) {
if (cur === idx) return;
idx = cur;
deskIdxSave(); // #1466：页码落定即持久化（回收重载后回到这一页）
for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
}
function sync() {
if (!pages.clientWidth) return;
const step = pageStep();
if (!(step > 0)) return;
const max = Math.max(dotsCache.length - 1, 0);
paint(Math.max(0, Math.min(max, Math.round(pages.scrollLeft / step))));
}
function go(i) {
refreshCache(); // 圆点可能刚被重建过（点击落在 deskRebuild 之后的首帧）
const slides = getSlides();
idx = Math.max(0, Math.min(slides.length - 1, i));
lastUserSwipeTs = Date.now(); // #1466：圆点点击/外部跳页也是真实翻页动作（恢复闸记账；touchstart 管手势）
deskIdxSave(); // #1466：圆点点击/外部跳页同口径持久化
if (!pages.clientWidth) return;
snapToIdx();
for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
}
const PERF_KEY = 'xy-home-v2:__diag-deskperf';
const PERF_FRAMES = 60;
let awayEdge = false;
try { document.addEventListener('visibilitychange', function () { if (document.hidden) awayEdge = true; }); } catch (e) {}
function awayGap() { if (!awayEdge) return false; awayEdge = false; return true; }
function sampleWitness() {
const w = { sc: '', ph: '' };
try { if (window.__mochiDeskScene) w.sc = window.__mochiDeskScene().txt.slice(0, 160); } catch (e) {}
try {
const l = window.__mochiPhaseLog || [], o = [];
for (let i = Math.max(1, l.length - 6); i < l.length; i++) o.push(l[i].tag + '+' + (l[i].t - l[i - 1].t) + 'ms');
w.ph = o.join('|').slice(0, 220);
} catch (e) {}
return w;
}
let perfOn = false;
let perfScrollAt = 0; // #1467：最近一条翻页 scroll 的时刻＝「手势还活着」的心跳，截短判据用它
function perfSample() {
perfScrollAt = Date.now(); // #1467：每条 scroll 都刷新（本函数只在 scroll 里被调）
if (perfOn) return;
perfOn = true;
const gaps = [];
let last = 0;
let hid = 0;
const finish = () => {
perfOn = false;
gaps.sort((a, b) => a - b);
const sum = gaps.reduce((a, b) => a + b, 0);
try {
const _w690 = sampleWitness();
localStorage.setItem(PERF_KEY, JSON.stringify({
t: Date.now(), n: gaps.length, hid: hid,
mean: Math.round(sum / gaps.length),
p90: Math.round(gaps[Math.floor(gaps.length * 0.9)]),
worst: Math.round(gaps[gaps.length - 1]),
cut: gaps.length < PERF_FRAMES ? 1 : 0, // #1467：1＝翻页已停提前收笔（未采满 60 帧）
pages: dotsCache.length, // 圆点数＝桌面页数（随手可得，不额外查 DOM）
sc: _w690.sc, ph: _w690.ph // #1295 现场快照（诊断行随帧耗时一并读出）
}));
} catch (e) {}
};
const tick = (now) => {
if (awayGap()) { hid++; last = 0; requestAnimationFrame(tick); return; } // #1324：跨挂起边界的那一差不算一帧
if (typeof document !== 'undefined' && document.hidden) {
hid++;
last = 0;
requestAnimationFrame(tick);
return;
}
if (gaps.length && Date.now() - perfScrollAt > 500) { finish(); return; }
if (last) gaps.push(now - last);
last = now;
if (gaps.length < PERF_FRAMES) { requestAnimationFrame(tick); return; }
finish();
};
requestAnimationFrame(tick);
}
const pageScrollGuard = (function () {
function inkBottom(sl, pageTop) {
const stopAt = sl.clientHeight + 1; // 与调用方那句比较共用同一阈值，早退才等价
let maxB = 0;
const all = sl.querySelectorAll('*');
for (let i = 0; i < all.length; i++) {
const el = all[i];
if (el.firstElementChild) continue;
const r = el.getBoundingClientRect();
const b = r.bottom - pageTop;
if (r.height <= 0 || b <= maxB) continue;
const c = getComputedStyle(el);
if (c.display === 'none' || c.visibility === 'hidden') continue;
if (c.position === 'absolute' || c.position === 'fixed') continue;
maxB = b;
if (maxB > stopAt) return maxB; // 已经证明「有看得见的内容越过可视底」＝不用再扫
}
return maxB;
}
const verdicts = new WeakMap();
let timer = null, retries = 0, forceQueued = false;
function later(ms, force) {
if (force) forceQueued = true;
clearTimeout(timer);
timer = setTimeout(function () { const f = forceQueued; forceQueued = false; run(f); }, ms);
}
function run(force) {
const slides = getSlides();
let skipped = false;
for (let i = 0; i < slides.length; i++) {
const sl = slides[i];
if (!sl.clientHeight || getComputedStyle(sl).visibility === 'hidden') { skipped = true; continue; }
const sh = sl.scrollHeight, ch = sl.clientHeight, over = sh - ch;
const seen = verdicts.get(sl);
let blind;
if (!force && seen && seen.sh === sh && seen.ch === ch) {
blind = seen.blind; // 几何没变＝裁决没变，省掉整棵子树
} else {
try { if (window.__mochiPhase) window.__mochiPhase('desk-guard'); } catch (e0) {}
blind = over > 0 && inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop) <= sl.clientHeight + 1;
verdicts.set(sl, { sh: sh, ch: ch, blind: blind });
}
if (blind) {
if (sl.style.overflowY !== 'hidden') sl.style.overflowY = 'hidden';
if (sl.scrollTop) sl.scrollTop = 0;
} else {
if (sl.style.overflowY) sl.style.overflowY = '';   // 回落到 CSS 的 auto
if (over <= 0 && sl.scrollTop) sl.scrollTop = 0;
}
}
if (skipped && retries < 8) { retries++; later(800); } else if (!skipped) retries = 0;
}
return { run: run, later: later };
})();
pageScrollGuard.run(true);
pages.addEventListener('scroll', () => pageScrollGuard.later(300), true);
pages.addEventListener('load', () => pageScrollGuard.later(400), true);
window.addEventListener('resize', () => pageScrollGuard.later(120, true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) pageScrollGuard.later(80); });
const textOnlyChurn = function (muts) {
if (!muts || !muts.length) return false;
for (let i = 0; i < muts.length; i++) {
const m = muts[i];
for (let j = 0; j < m.addedNodes.length; j++) if (m.addedNodes[j].nodeType !== 3) return false;
for (let j = 0; j < m.removedNodes.length; j++) if (m.removedNodes[j].nodeType !== 3) return false;
}
return true;
};
try {
new MutationObserver((muts) => pageScrollGuard.later(400, !textOnlyChurn(muts))).observe(pages, { childList: true, subtree: true });
} catch (e) {}
try { document.addEventListener('mochi-restore-done', () => pageScrollGuard.later(400, true)); } catch (e) {}
pageScrollGuard.later(900, true);
setTimeout(() => pageScrollGuard.run(true), 2600);
const SW_KEY = 'xy-home-v2:__diag-swperf';
const SW_FRAMES = 30;
function swSample() {
if (swOn) return;
const now943 = Date.now();
if (now943 - (swSample.last || 0) < 300000) return;
swSample.last = now943;
swOn = true;
const gaps = [];
let last = 0, hid = 0;
const swT0 = Date.now(); // #1467：切回桌面的墙钟起点
const finish = () => {
swOn = false;
gaps.sort((a, b) => a - b);
const sum = gaps.reduce((a, b) => a + b, 0);
const _w884 = sampleWitness();
try {
localStorage.setItem(SW_KEY, JSON.stringify({
t: Date.now(), n: gaps.length, hid: hid,
mean: Math.round(sum / gaps.length),
p90: Math.round(gaps[Math.floor(gaps.length * 0.9)]),
worst: Math.round(gaps[gaps.length - 1]),
cut: gaps.length < SW_FRAMES ? 1 : 0, // #1467：1＝切页窗口已过提前收笔
sc: _w884.sc, ph: _w884.ph // #1295 现场快照（切回桌面那一刀当时壁纸/模糊/近操作是什么）
}));
} catch (e) {}
};
const tick = (now) => {
if (document.hidden || awayGap()) { hid++; last = 0; requestAnimationFrame(tick); return; } // #1324：同上，挂起期那一段不记进样本
if (gaps.length && Date.now() - swT0 > 2500) { finish(); return; }
if (last) gaps.push(now - last);
last = now;
if (gaps.length < SW_FRAMES) { requestAnimationFrame(tick); return; }
finish();
};
requestAnimationFrame(tick);
}
let swOn = false;
let rafId = 0;
let settleTimer = null;
let swipeBlurTimer = null; // #976：滑页暂停壁纸模糊的收尾计时
let _swBlurPh = null;
function syncFrame() {
rafId = 0;
sync();
}  pages.addEventListener('scroll', () => {
if (!rafId) rafId = requestAnimationFrame(syncFrame);
perfSample(); // #690：翻页现场记一段帧耗时（静止时不跑）
try {
const bph = _swBlurPh || (_swBlurPh = document.querySelector('.phone'));
if (bph && bph.classList.contains('desk-blur-on')) {
document.documentElement.classList.add('desk-swiping');
clearTimeout(swipeBlurTimer);
swipeBlurTimer = setTimeout(function () { document.documentElement.classList.remove('desk-swiping'); }, 150);
}
} catch (e0) {}
clearTimeout(settleTimer);
settleTimer = setTimeout(sync, 80);
}, { passive: true });
pages.addEventListener('touchstart', function () { lastUserSwipeTs = Date.now(); swipeWarm(); }, { passive: true });
document.getElementById('desktop-dots').addEventListener('click', (e) => {
const dot = e.target.closest('.dot');
if (!dot) return;
go(getDots().indexOf(dot));
});
window.addEventListener('resize', () => {
refreshCache();
gapCache = null; // #1301：作废点从 refreshCache 挪到这里——视口变了页宽与媒体查询都可能变
if (pages.clientWidth) snapToIdx();
});
const DESK_COLD_MS = 60000;
let deskColdT = 0;
function setDeskCold(on) {
let cur = false;
try { cur = document.documentElement.classList.contains('desk-layer-cold'); } catch (e0) { return; }
if (cur === !!on) return;
try { document.documentElement.classList.toggle('desk-layer-cold', !!on); } catch (e1) {}
try { if (window.__mochiPhase) window.__mochiPhase(on ? 'desk-layer-cold' : 'desk-layer-warm'); } catch (e2) {}
}
function deskColdArm(arm) {
if (deskColdT) { clearTimeout(deskColdT); deskColdT = 0; }
if (!arm) { setDeskCold(false); return; }
if (typeof document !== 'undefined' && document.hidden) return; // 后台期不计时（见上）
deskColdT = setTimeout(function () { deskColdT = 0; setDeskCold(true); }, DESK_COLD_MS);
}
const phonePage = document.getElementById('page-phone');
if (phonePage) {
const mo = new MutationObserver(() => {
if (phonePage.hidden) { deskColdArm(true); return; }
deskColdArm(false);
if (pages.clientWidth) {
refreshCache();
sync(); // #1466：先按真实落点校正 idx 再落位——回桌面那一刻若 idx 因滚动事件被节流而陈旧，旧序会照陈旧值把 scrollLeft 写回别的页＝「自己弹回去」；sync 只切圆点不写滚动位，先它一步零成本
snapToIdx(); // #1301：已经在位就不写（旧写法每次切回桌面必写一次＝把同步布局压进这一帧）
sync();
pageScrollGuard.later(60); // #989：回桌面复核一次（残留滚动量在进桌面当帧就修掉）
swSample(); // #884：从聊天/其他页切回桌面那一刻现场采一段帧耗时
}
});
mo.observe(phonePage, { attributes: true, attributeFilter: ['hidden'] });
document.addEventListener('visibilitychange', function () {
if (document.hidden) return;
if (phonePage.hidden) deskColdArm(true); else deskColdArm(false);
});
deskColdArm(!!phonePage.hidden);
}
window.deskRebuild = function () {
const slides = getSlides();
if (slides.length && !(lastUserSwipeTs && Date.now() - lastUserSwipeTs < 1200)) {
const want1466 = Math.max(0, Math.min(slides.length - 1, deskIdxSaved()));
if (want1466 !== idx) idx = want1466;
}
idx = Math.max(0, Math.min(Math.max(slides.length - 1, 0), idx));
const dotsBox = document.getElementById('desktop-dots');
if (dotsBox) {
dotsBox.innerHTML = '';
for (let i = 0; i < slides.length; i++) {
const d = document.createElement('span');
d.className = 'dot' + (i === idx ? ' active' : '');
dotsBox.appendChild(d);
}
}
refreshCache();
gapCache = null; // #1301：增删页＝结构性变更点，gap 在此作废（refreshCache 已不再顺手清）
if (pages.clientWidth) {
pages.scrollLeft = idx * pageStep();
sync();
}
};
refreshCache();
sync();
window.deskGo = go;
window.deskIdx = function () { return idx; };
window.__deskSlideDiag = function () {
return { idx: idx, n: Math.max(dotsCache.length, getSlides().length), sl: pages.scrollLeft, warm: pages.classList.contains('swipe-warm') };
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("desktop-slider.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("desktop-slider.js"); try { console.error("[JS] desktop-slider.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[desktop-slider.js] " + String(__e && __e.message || __e)); } })();
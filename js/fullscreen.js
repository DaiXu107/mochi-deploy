(function () { try {
(function () {
const uid = window.activePrefix();
const store = {
get(k){ try { return localStorage.getItem(window.activePrefix() + ':' + k); } catch(e){ return null; } },
set(k, v){ try { localStorage.setItem(window.activePrefix() + ':' + k, v); } catch(e){} }
};
const FS_KEY = 'fullscreen-enabled';
const FB_KEY = 'fullscreen-fallback';
let isIOS = false, isVia = false;
try {
const d = window.mochiDevice;
if (d) { isIOS = !!d.isIOS; isVia = !!d.isVia; }
} catch (e) {}
const _ua = String((navigator && navigator.userAgent) || '');
const isEdgeIOS = isIOS && /edg/i.test(_ua);
const isSafariIOS = isIOS && /safari/i.test(_ua) && !/edg|chrome|opt|fxios|via|quark|micromessenger/i.test(_ua);
const inIosStandalone = isIOS && (
window.navigator.standalone === true ||
(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
);
if (inIosStandalone) document.documentElement.classList.add('ios-pwa-standalone');
function fsSupported() {
return typeof document.documentElement.requestFullscreen === 'function'
|| typeof document.documentElement.webkitRequestFullscreen === 'function';
}
function isFullscreen() {
return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function viewportLandscape() {
if (!(window.innerWidth > window.innerHeight)) return false;
try {
const t = screen.orientation && screen.orientation.type;
if (typeof t === 'string' && t) {
if (/^portrait/i.test(t)) return false;
if (/^landscape/i.test(t)) return true;
}
} catch (e) {}
try {
const o = window.orientation;
if (typeof o === 'number' && !isNaN(o) && Math.abs(o) % 180 === 0) return false;
} catch (e) {}
return true;
}
function fsVisualActive() {
const d = document.documentElement;
return isFullscreen()
|| d.classList.contains('fs-css-active')
|| d.classList.contains('ios-fs-active')
|| !!(window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches);
}
function orientLockable() {
return !!(screen.orientation && typeof screen.orientation.lock === 'function');
}
function lockFsOrient() {
try {
if (screen.orientation && screen.orientation.lock) {
const p = screen.orientation.lock('portrait');
if (p && p.catch) p.catch(() => {});
return true;
}
} catch (e) {}
return false;
}
function unlockFsOrient() {
try {
if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
} catch (e) {}
}
function applyFsCss(on, syncBox) {
document.documentElement.classList.toggle('fs-css-active', on);
store.set(FB_KEY, on ? '1' : '0');
if (syncBox === false) return;
const el = document.getElementById('sf-fullscreen');
if (el) el.checked = on;
}
let _fsTipShown = false;
function showFsFallbackTip() {
if (_fsTipShown) return;
_fsTipShown = true;
const msg = isVia
? 'Via 浏览器的网页全屏会自动转成横屏，本应用已自动保持竖屏，不再横屏。\n\n想真全屏（隐藏浏览器栏）：Via 菜单 → 设置 → 通用 → 开启「全屏模式」，返回即竖屏沉浸全屏。'
: '当前浏览器的网页全屏会自动转成横屏，本应用已自动保持竖屏，不再横屏。\n\n想真全屏（隐藏浏览器栏）请：\n· 浏览器工具栏开启「竖屏锁定」后再开全屏；\n· 或「添加到主屏幕」从桌面图标打开（竖屏全屏）。';
if (window.openModal) {
window.openModal('竖屏全屏提示', '', () => {}, { noInput: true, staticText: msg });
} else {
try { if (window.toast) window.toast(msg.split('\n')[0]); } catch (e) {}
}
}
let _fsFailTipShown = false;
function showFsFailTip() {
if (_fsFailTipShown) return;
_fsFailTipShown = true;
const msg = '当前浏览器未允许进入全屏，已自动关闭该开关。\n\n可重试一次；或使用 Chrome/Edge 并允许全屏权限，或添加到主屏幕后从桌面图标打开。';
if (window.openModal) {
window.openModal('无法进入全屏', '', () => {}, { noInput: true, staticText: msg });
} else {
try { if (window.toast) window.toast('无法进入全屏：当前浏览器未允许，已自动关闭该开关'); } catch (e) {}
}
}
let _rotTipShown = false;
function showRotateTip() {
if (_rotTipShown) return;
_rotTipShown = true;
const msg = '屏幕当前仍是横屏，本应用已尝试自动恢复竖屏。\n\n若未恢复：\n· 打开手机下拉栏的「自动旋转」，竖着拿手机即可转回；\n· 或直接使用浏览器自带的全屏模式（Via 设置 → 通用 → 全屏模式）。';
if (window.openModal) {
window.openModal('请恢复竖屏', '', () => {}, { noInput: true, staticText: msg });
} else {
try { if (window.toast) window.toast('屏幕仍是横屏，本应用已尝试自动恢复竖屏'); } catch (e) {}
}
}
function showSystemFsNote() {
const msg = '全屏模式已关闭，下次启动不会自动进入全屏。\n\n当前应用是以「全屏显示」方式从主屏幕打开的（系统级全屏），浏览器的地址栏/工具栏由系统控制，需退出应用或从主屏幕重新打开后才会显示。';
if (window.openModal) {
window.openModal('全屏模式已关闭', '', () => {}, { noInput: true, staticText: msg });
} else {
try { if (window.toast) window.toast('全屏模式已关闭：当前是系统级全屏，需退出应用重开才显示地址栏'); } catch (e) {}
}
}
function forcePortrait(tries, cb) {
if (window.innerWidth <= window.innerHeight) { if (cb) cb(); return; } // 已竖屏
lockFsOrient();
if (tries > 0) setTimeout(() => forcePortrait(tries - 1, cb), 400);
else if (cb) cb();
}
let _fsMonTimer = null;
function stopFsMonitor() {
if (_fsMonTimer) { clearInterval(_fsMonTimer); _fsMonTimer = null; }
}
function startFsMonitorSafe() { if (isIOS) return; startFsMonitor(); }
function startFsMonitor() {
stopFsMonitor();
let left = 4000;
const tick = () => {
left -= 300;
if (!isFullscreen() && !document.documentElement.classList.contains('fs-active')) { stopFsMonitor(); return; }
if (viewportLandscape()) { onLandscapeDetected(); return; }
if (left <= 0) stopFsMonitor();
};
_fsMonTimer = setInterval(tick, 300);
setTimeout(tick, 250);
}
let _landscapeBusy = false;
function onLandscapeDetected() {
if (_landscapeBusy) return;
_landscapeBusy = true;
let tries = 0;
const attempt = () => {
if (window.innerWidth <= window.innerHeight) { _landscapeBusy = false; return; } // 转回来了
if (!isFullscreen()) { _landscapeBusy = false; handleLandscapeForced(); return; }
lockFsOrient();
if (++tries < 4) setTimeout(attempt, 400);
else { _landscapeBusy = false; handleLandscapeForced(); }
};
attempt();
}
function handleLandscapeForced() {
stopFsMonitor();
exitFs();
applyFsCss(true);
showFsFallbackTip();
forcePortrait(5, showRotateTip);
}
let _fsFlight = null, _fsFlightTimer = 0;
function closeFsFlight() { clearTimeout(_fsFlightTimer); _fsFlight = null; }
function openFsFlight(p) {
_fsFlight = p || true;
clearTimeout(_fsFlightTimer);
_fsFlightTimer = setTimeout(closeFsFlight, 1500);
if (p && p.then) p.then(closeFsFlight, closeFsFlight);
}
function enterFs() {
if (_fsFlight || isFullscreen()) return _fsFlight; // #1282 在途/已全屏＝不再另开一次切换事务
try {
const el = document.documentElement;
let p;
const fsOpts = { navigationUI: 'hide' };
if (el.requestFullscreen) p = el.requestFullscreen(fsOpts);
else if (el.webkitRequestFullscreen) p = el.webkitRequestFullscreen();
const tryLock = () => { lockFsOrient(); startFsMonitorSafe(); };
if (p && p.then) { openFsFlight(p); p.then(tryLock, tryLock); return p; } // #1282 请求落定前挂闸
openFsFlight(null);
setTimeout(tryLock, 300);
} catch (e) {}
return null;
}
function exitFs() {
closeFsFlight(); // #1282 主动退出＝撤闸，别让在途的进入请求挡住随后的恢复
try {
unlockFsOrient();
stopFsMonitor();
if (document.exitFullscreen) {
const p = document.exitFullscreen();
if (p && p.catch) p.catch(() => {});
}
else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
} catch (e) {}
}
let _sysToggle = false;
let _userFsOff = false;
function syncToggle(userIntent) {
const el = document.getElementById('sf-fullscreen');
if (el) {
if (!userIntent) _sysToggle = true;
el.checked = (_userFsOff && !isFullscreen()) ? false : fsVisualActive();
}
if (!userIntent) setTimeout(() => { _sysToggle = false; }, 0);
}
function applyFsInputHacks() {
const fs = isFullscreen();
document.querySelectorAll('input, textarea').forEach(inp => {
if (inp.type === 'checkbox' || inp.type === 'range' || inp.type === 'file' || inp.type === 'color') return;
if (fs) {
if (!inp.dataset.fsAuto) {
inp.dataset.fsAuto = '1';
inp.dataset.fsTplAc = inp.getAttribute('autocomplete') || '';
const ac = inp.getAttribute('autocomplete');
if (ac === 'new-password' || ac === 'current-password') inp.removeAttribute('autocomplete');
inp.setAttribute('autocomplete', 'off');
inp.dataset.fsOrigCorr = inp.getAttribute('autocorrect') || '';
inp.dataset.fsOrigCap = inp.getAttribute('autocapitalize') || '';
inp.dataset.fsOrigSpell = inp.getAttribute('spellcheck') || '';
inp.setAttribute('autocorrect', 'off');
inp.setAttribute('autocapitalize', 'off');
inp.setAttribute('spellcheck', 'false');
}
} else if (inp.dataset.fsAuto !== undefined) {
const tplAc = inp.dataset.fsTplAc;
if (tplAc) inp.setAttribute('autocomplete', tplAc); else inp.removeAttribute('autocomplete');
delete inp.dataset.fsTplAc;
const restore = (key, origKey) => {
const orig = inp.dataset[origKey] || '';
if (orig) inp.setAttribute(key, orig); else inp.removeAttribute(key);
delete inp.dataset[origKey];
};
restore('autocorrect', 'fsOrigCorr');
restore('autocapitalize', 'fsOrigCap');
restore('spellcheck', 'fsOrigSpell');
delete inp.dataset.fsAuto;
}
});
}
function showIosGuide() {
let msg;
if (isFullscreen()) {
msg = '已进入全屏模式，浏览器工具栏已隐藏。\n\niOS 顶部系统状态栏（时间/电量）由系统控制，任何网页都无法隐藏，这是所有 iPhone 网页的共同限制。';
} else if (inIosStandalone) {
msg = '已进入全屏模式。iOS 的系统状态栏（时间/电量）由系统控制，任何网页都无法隐藏，这是所有 iPhone 应用的共同限制。\n\n应用内的模拟状态栏（Mochi/时间/电量）已下移到系统状态栏正下方、两栏不重叠，内容顶满屏幕、屏幕利用更满。';
} else {
msg = '当前浏览器未允许本页进入全屏，开关已回滚。\n\niPhone 上想真正隐藏浏览器栏，只有：\n· 【推荐】改用 Safari 打开本站 → 底部「分享」→「添加到主屏幕」→ 点桌面图标打开，即无浏览器栏的独立应用；'
+ (isEdgeIOS ? '\n· Edge 菜单「添加到主屏幕」只会创建快捷方式，打开后仍是带工具栏的网页（就是现在的状态），这条路拿不到全屏。' : '')
+ '\n\n另外：iOS 顶部系统状态栏（时间/电量）永远无法由网页隐藏。';
}
if (window.openModal) {
window.openModal('iOS 全屏说明', '', () => {}, { noInput: true, staticText: msg });
} else {
try { if (window.toast) window.toast('iOS 全屏说明：推荐 Safari 添加到主屏幕后从桌面图标打开'); } catch (e) {}
}
}
let _iosFsSettled = false;
function iosFsFailed() {
if (_iosFsSettled) return;
_iosFsSettled = true;
if (isFullscreen()) return;
const t = document.getElementById('sf-fullscreen');
if (inIosStandalone) { if (t) t.checked = true; showIosGuide(); return; }
if (t) t.checked = false;
showIosGuide();
}
function iosTryNativeFs() {
_iosFsSettled = false;
let p = null;
try {
const el = document.documentElement;
if (el.requestFullscreen) p = el.requestFullscreen({ navigationUI: 'hide' });
else if (el.webkitRequestFullscreen) p = el.webkitRequestFullscreen();
} catch (e) {}
if (p && p.catch) p.catch(() => { iosFsFailed(); });
syncFsClass();
setTimeout(() => {
if (isFullscreen()) { _iosFsSettled = true; applyFsInputHacks(); return; }
iosFsFailed();
}, 1500);
}
function applyIosFs(on) {
document.documentElement.classList.toggle('ios-fs-active', on);
store.set(FS_KEY, on ? '1' : '0');
const el = document.getElementById('sf-fullscreen');
if (el) el.checked = on;
}
function relabelIosToggle() {
const el = document.getElementById('sf-fullscreen');
if (!el) return;
const row = el.closest('.set-row') || el.closest('.gs-row');
if (!row) return;
const span = row.querySelector('#sf-fullscreen-label') || row.querySelector('span span') || row.querySelector('span');
if (!span) return;
span.textContent = inIosStandalone
? '全屏模式（内容顶满，系统状态栏不可隐藏）'
: // v3.26.x：浏览器标签态现在真的去请求原生全屏（不再一律拒绝），文案照实描述；
'全屏模式（iOS 浏览器全屏，不支持时会弹说明）';
}
const fsToggle = document.getElementById('sf-fullscreen');
if (fsToggle) {
fsToggle.addEventListener('change', () => {
if (fsToggle.checked) {
_userFsOff = false;
if (isIOS) {
if (inIosStandalone) applyIosFs(true);
if (fsSupported()) iosTryNativeFs();
else { if (!inIosStandalone) fsToggle.checked = false; showIosGuide(); }
return;
}
if (viewportLandscape()) {
forcePortrait(4, showRotateTip);
return;
}
if (isVia) {
applyFsCss(true);
showFsFallbackTip();
return;
}
if (!fsSupported()) {
fsToggle.checked = false;
try { if (window.toast) window.toast('当前浏览器不支持全屏：请使用 Chrome/Edge，或添加到主屏幕后从桌面图标打开'); } catch (e) {}
return;
}
if (!orientLockable()) {
applyFsCss(true);
showFsFallbackTip();
return;
}
applyFsCss(false, false);
enterFs();
syncFsClass();
setTimeout(() => {
if (!isIOS && isFullscreen() && viewportLandscape()) {
store.set(FB_KEY, '1');
handleLandscapeForced();
return;
}
const t = document.getElementById('sf-fullscreen');
if (t && t.checked && !fsVisualActive()) {
t.checked = false;
showFsFailTip();
}
}, 1500);
} else {
if (isIOS && inIosStandalone) { applyIosFs(false); return; }
_userFsOff = true;
applyFsCss(false);
exitFs();
syncFsClass();
store.set(FS_KEY, '0');
setTimeout(() => {
if (!_userFsOff) return;
const t = document.getElementById('sf-fullscreen');
const stillSysFs = window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches;
if (t && !t.checked && stillSysFs) showSystemFsNote();
}, 300);
}
});
if (isIOS) { try { relabelIosToggle(); } catch (e) {} }
}
const fsHelp = document.getElementById('sf-fullscreen-help');
if (fsHelp) {
const openFsHelp = function (e) {
if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (er) {} }
showIosGuide();
};
fsHelp.addEventListener('click', openFsHelp);
fsHelp.addEventListener('keydown', function (e) {
if (e.key === 'Enter' || e.key === ' ') openFsHelp(e);
});
}
function syncFsClass() {
const d = document.documentElement;
const _fs = isFullscreen();
d.classList.toggle('fs-active', _fs);
if (isIOS) d.classList.toggle('ios-native-fs', _fs);
}
function fsInPwa() {
try {
return !!(window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
} catch (e) { return false; }
}
let _wentBg = false;
let _lastVisibleAt = Date.now();
function handleFsExit() {
stopFsMonitor();
const d = document.documentElement;
if (!fsInPwa()) {
setTimeout(() => {
if (document.visibilityState !== 'visible') return;            // 已在后台 → 系统行为
if (_wentBg) return;                                           // 复核窗口内切过后台
try { if (d.classList.contains('fs-css-active')) return; } catch (e) {} // 横屏兜底自有状态
if (_lastVisibleAt && Date.now() - _lastVisibleAt < 1500) { reenterFs(); return; } // 回前台补发的系统退出
try { store.set(FS_KEY, '0'); } catch (e) {}
try { store.set(FB_KEY, '0'); } catch (e) {}
try { d.classList.remove('fs-css-active'); } catch (e) {}
}, 700);
}
}
document.addEventListener('fullscreenchange', () => {
syncToggle(false); applyFsInputHacks(); syncFsClass();
if (isFullscreen()) startFsMonitorSafe(); else handleFsExit();
});
document.addEventListener('webkitfullscreenchange', () => {
syncToggle(false); applyFsInputHacks(); syncFsClass();
if (isFullscreen()) startFsMonitorSafe(); else handleFsExit();
});
document.addEventListener('orientationchange', () => {
if (isIOS) return; // FIX 2026-09-05 #189（iOS 无方向锁，转横不纠偏不弹窗）
const d = document.documentElement;
if (!d.classList.contains('fs-active') && !d.classList.contains('fs-css-active')) return;
if (window.innerWidth <= window.innerHeight) return;
if (isFullscreen()) onLandscapeDetected();
else forcePortrait(5, showRotateTip);
});
syncFsClass();
try { syncToggle(false); } catch (e) {}
try { applyFsInputHacks(); } catch (e) {}
let _retryArmed = false;
function disarmRetry() {
if (!_retryArmed) return;
_retryArmed = false;
document.removeEventListener('click', retryClick, true);
document.removeEventListener('touchstart', retryTouch, true);
}
function onFsSwitch(t) {
if (!t || typeof t.closest !== 'function') return false;
if (t.closest('#sf-fullscreen, #cs-fullscreen')) return true;
const lb = t.closest('label');
return !!(lb && (lb.htmlFor === 'sf-fullscreen' || lb.htmlFor === 'cs-fullscreen' ||
lb.querySelector('#sf-fullscreen, #cs-fullscreen')));
}
function retryClick(e) { if (!e.isTrusted || onFsSwitch(e.target)) return; doRetry(); }
function retryTouch(e) { if (!e.isTrusted || onFsSwitch(e.target)) return; doRetry(); }
function doRetry() {
disarmRetry();
if (store.get(FS_KEY) !== '1' || isFullscreen()) return; // 用户已关闭/已全屏 → 放弃
if (store.get(FB_KEY) === '1' && !isVia && orientLockable() && fsSupported()) {
enterFs();
setTimeout(() => {
if (isFullscreen()) { applyFsCss(false, false); return; }
if (!document.documentElement.classList.contains('fs-css-active')) applyFsCss(true);
}, 1500);
return;
}
enterFs();
}
function armRetry() {
if (isIOS) return;
disarmRetry();
_retryArmed = true;
document.addEventListener('click', retryClick, true);
document.addEventListener('touchstart', retryTouch, true);
}
function reenterFs() {
if (isIOS) return;
if (store.get(FS_KEY) !== '1') return;
if (isFullscreen()) return;
if (store.get(FB_KEY) === '1') { applyFsCss(true); try { syncToggle(false); } catch (e) {} armRetry(); return; }
if (isVia || !orientLockable()) { applyFsCss(true); return; }
if (!fsSupported()) return;
enterFs();
armRetry();
}
try {
if (store.get(FS_KEY) === '1') {
if (isIOS && inIosStandalone) applyIosFs(true);
else reenterFs();
}
} catch (e) {}
document.addEventListener('visibilitychange', () => {
if (document.visibilityState !== 'visible') { _wentBg = true; return; }
_wentBg = false;
_lastVisibleAt = Date.now();   // v3.11.x：记录回前台时刻（供 handleFsExit 时序判定）
if (isIOS && inIosStandalone) { if (store.get(FS_KEY) === '1') applyIosFs(true); }
else reenterFs();
});
const obs = new MutationObserver(() => {
if (_sysToggle) return;
const el = document.getElementById('sf-fullscreen');
if (el) store.set(FS_KEY, el.checked ? '1' : '0');
});
const el0 = document.getElementById('sf-fullscreen');
if (el0) { obs.observe(el0, { attributes: true, attributeFilter: ['checked'] }); }
const EG_KEY = 'fs-edge-guard';
let _egLayers = null;
let _egTouchHandler = null;
function edgeGuardEnabled() { return store.get(EG_KEY) === '1'; }
function fsAnyActive() {
const d = document.documentElement;
return isFullscreen() || d.classList.contains('fs-active')
|| d.classList.contains('fs-css-active') || d.classList.contains('ios-fs-active');
}
function enableEdgeGuard() {
if (_egLayers) return;
const css = 'position:fixed;top:0;width:24px;height:100vh;z-index:99999;background:transparent;touch-action:none;pointer-events:auto;';
const left = document.createElement('div');
left.setAttribute('style', css + 'left:0;');
const right = document.createElement('div');
right.setAttribute('style', css + 'right:0;');
document.body.appendChild(left);
document.body.appendChild(right);
_egLayers = [left, right];
_egTouchHandler = (e) => {
const t = e.touches && e.touches[0];
if (!t) return;
if (t.clientX <= 24 || t.clientX >= window.innerWidth - 24) {
try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
}
};
document.addEventListener('touchstart', _egTouchHandler, { passive: false, capture: true });
}
function disableEdgeGuard() {
if (_egLayers) { _egLayers.forEach(l => { try { l.remove(); } catch (err) {} }); _egLayers = null; }
if (_egTouchHandler) { document.removeEventListener('touchstart', _egTouchHandler, true); _egTouchHandler = null; }
}
function applyEdgeGuard() {
if (edgeGuardEnabled() && fsAnyActive()) enableEdgeGuard();
else disableEdgeGuard();
}
let _egTipShown = false;
function showEdgeGuardTip() {
if (_egTipShown) return;
_egTipShown = true;
const msg = '已开启全屏边缘防误触。屏幕左右边缘 24px 内的触摸将被拦截，避免触发部分浏览器的音量/亮度边缘手势。\n\n若仍无效（雨见等浏览器的边缘手势是系统级，网页可能拦不住），最可靠的方法是在浏览器设置 → 手势/全屏中关闭「边缘滑动调节音量/亮度」。';
if (window.openModal) {
window.openModal('全屏边缘防误触', '', () => {}, { noInput: true, staticText: msg });
}
}
const egToggle = document.getElementById('sf-edge-guard');
if (egToggle) {
egToggle.checked = edgeGuardEnabled();
egToggle.addEventListener('change', () => {
store.set(EG_KEY, egToggle.checked ? '1' : '0');
applyEdgeGuard();
if (egToggle.checked) showEdgeGuardTip();
});
}
const _egObs = new MutationObserver(() => applyEdgeGuard());
_egObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
applyEdgeGuard();
function gameFsHasActive() {
var nodes = document.getElementsByClassName('poke-card game-fs');
for (var i = 0; i < nodes.length; i++) { if (!nodes[i].hidden) return true; }
return false;
}
var _gfsPhone = document.querySelector('.phone') || (document.body || document.documentElement);
function applyGameFsElevate() {
try {
if (!_gfsPhone.classList.contains('game-fs-active') && !document.getElementsByClassName('poke-card').length) return;
_gfsPhone.classList.toggle('game-fs-active', gameFsHasActive());
} catch (e) {}
}
var _gfsRaf = 0;
function _gfsSchedule() {
if (_gfsRaf) return;
_gfsRaf = requestAnimationFrame(function () { _gfsRaf = 0; applyGameFsElevate(); });
}
function _gfsHitOne(n, deep) {
if (!n || n.nodeType !== 1) return false;
if (n.classList && n.classList.contains('poke-card')) return true;
if (!deep) return false;
try { return !!n.querySelector('.poke-card'); } catch (e) { return false; }
}
function _gfsHit(muts) {
for (var i = 0; i < muts.length; i++) {
var m = muts[i];
if (m.type === 'attributes') { if (_gfsHitOne(m.target, false)) return true; continue; }
var a = m.addedNodes, r = m.removedNodes, k;
for (k = 0; k < a.length; k++) if (_gfsHitOne(a[k], true)) return true;
for (k = 0; k < r.length; k++) if (_gfsHitOne(r[k], true)) return true;
}
return false;
}
var _gfsObs = new MutationObserver(function (muts) { if (_gfsHit(muts)) _gfsSchedule(); });
_gfsObs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
applyGameFsElevate();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("fullscreen.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("fullscreen.js"); try { console.error("[JS] fullscreen.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[fullscreen.js] " + String(__e && __e.message || __e)); } })();
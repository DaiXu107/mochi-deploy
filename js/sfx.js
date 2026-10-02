(function () { try {
(function () {
const rawStore = window.activeStore();
const gStore = window.xyStore('xy-home-v2');
function sfxUnified() { try { return gStore.get('sfx-unified') === '1'; } catch (e) { return false; } }
window.sfxUnified = sfxUnified;
function isGcKey(k) { return typeof k === 'string' && k.indexOf('sfx-gc-') === 0; }
const store = {
get(k) { if (isGcKey(k)) return gStore.get(k); return (sfxUnified() ? gStore : rawStore).get(k); },
set(k, v) { if (isGcKey(k)) { gStore.set(k, v); return; } (sfxUnified() ? gStore : rawStore).set(k, v); },
remove(k) { if (isGcKey(k)) { gStore.remove(k); return; } (sfxUnified() ? gStore : rawStore).remove(k); }
};
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2200);
}
const KEYS = { ring: 'sfx-ring', in: 'sfx-in', out: 'sfx-out', 'gc-in': 'sfx-gc-in', 'gc-out': 'sfx-gc-out' };
const BKEYS = { ring: 'sfx-ring-b', in: 'sfx-in-b', out: 'sfx-out-b', 'gc-in': 'sfx-gc-in-b', 'gc-out': 'sfx-gc-out-b' };
const NAMES = { ring: '联系人来电铃声', in: '联系人发送和回复消息', out: '我发送和回复消息', 'gc-in': '群聊收消息', 'gc-out': '群聊发消息' };
const PRESET_NAMES = {
bubble: '气泡', ding: '叮咚', bird: '小鸟', drop: '水滴',
piano: '钢琴', tick: '轻叩', 'ring-warm': '温馨铃', 'ring-classic': '经典铃'
};
const PRESET_ORDER = {
ring: ['ring-warm', 'ring-classic'],
in: ['bubble', 'ding', 'bird', 'drop', 'piano', 'tick'],
out: ['bubble', 'ding', 'bird', 'drop', 'piano', 'tick'],
'gc-in': ['bubble', 'ding', 'bird', 'drop', 'piano', 'tick'],
'gc-out': ['bubble', 'ding', 'bird', 'drop', 'piano', 'tick']
};
const PRESET_CONTAINERS = { ring: 'sfx-ring-presets', in: 'sfx-in-presets', out: 'sfx-out-presets', 'gc-in': 'sfx-gcin-presets', 'gc-out': 'sfx-gcout-presets' };
let _ctx = null;
function ensureCtx() {
try {
if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
if (_ctx.state === 'suspended') { const p = _ctx.resume(); if (p && p.catch) p.catch(function () {}); }
return _ctx;
} catch (e) { return null; }
}
function unlockCtx() { ensureCtx(); }
document.addEventListener('touchstart', unlockCtx, { passive: true });
document.addEventListener('click', unlockCtx, { passive: true });
document.addEventListener('keydown', unlockCtx);
function makeBuf(ctx, dur, fill) {
const sr = ctx.sampleRate;
const buf = ctx.createBuffer(1, Math.max(1, Math.ceil(sr * dur)), sr);
fill(buf.getChannelData(0), sr);
return buf;
}
function oscInto(d, sr, t0, dur, f0, f1, k, amp, att) {
const start = Math.max(0, Math.floor(t0 * sr));
const end = Math.min(d.length, Math.ceil((t0 + dur) * sr));
let ph = 0;
for (let i = start; i < end; i++) {
const t = (i / sr) - t0;
const f = f1 + (f0 - f1) * Math.exp(-t * k);
ph += 2 * Math.PI * f / sr;
d[i] += Math.sin(ph) * amp * Math.exp(-t * att);
}
}
function noiseInto(d, sr, t0, dur, amp, att) {
const start = Math.max(0, Math.floor(t0 * sr));
const end = Math.min(d.length, Math.ceil((t0 + dur) * sr));
for (let i = start; i < end; i++) {
const t = (i / sr) - t0;
d[i] += (Math.random() * 2 - 1) * amp * Math.exp(-t * att);
}
}
function synthBubble(ctx) {
return makeBuf(ctx, 0.18, (d, sr) => {
oscInto(d, sr, 0, 0.18, 880, 360, 14, 0.5, 26);
noiseInto(d, sr, 0, 0.05, 0.2, 90);
});
}
function synthDing(ctx) {
return makeBuf(ctx, 0.52, (d, sr) => {
oscInto(d, sr, 0, 0.14, 1568, 1568, 0, 0.4, 26);
oscInto(d, sr, 0, 0.14, 3136, 3136, 0, 0.09, 30);
oscInto(d, sr, 0.2, 0.32, 1046, 1046, 0, 0.42, 13);
oscInto(d, sr, 0.2, 0.32, 2092, 2092, 0, 0.1, 15);
});
}
function synthBird(ctx) {
return makeBuf(ctx, 0.32, (d, sr) => {
oscInto(d, sr, 0, 0.1, 2100, 3300, 22, 0.35, 32);
oscInto(d, sr, 0.155, 0.13, 1700, 2600, 18, 0.3, 26);
});
}
function synthDrop(ctx) {
return makeBuf(ctx, 0.22, (d, sr) => {
oscInto(d, sr, 0, 0.2, 1400, 520, 16, 0.45, 20);
oscInto(d, sr, 0, 0.15, 2800, 1600, 22, 0.1, 34);
});
}
function synthPiano(ctx) {
return makeBuf(ctx, 0.75, (d, sr) => {
const f = 659.25;
oscInto(d, sr, 0, 0.75, f, f, 0, 0.4, 6.5);
oscInto(d, sr, 0, 0.75, f * 2, f * 2, 0, 0.13, 8);
oscInto(d, sr, 0, 0.75, f * 3, f * 3, 0, 0.06, 10);
});
}
function synthTick(ctx) {
return makeBuf(ctx, 0.07, (d, sr) => {
oscInto(d, sr, 0, 0.06, 1200, 850, 50, 0.35, 75);
noiseInto(d, sr, 0, 0.02, 0.12, 120);
});
}
function synthRingNotes(ctx, notes, dur) {
return makeBuf(ctx, dur, (d, sr) => {
let t0 = 0;
notes.forEach(n => {
oscInto(d, sr, t0, n.d, n.f, n.f, 0, 0.42, 5);
oscInto(d, sr, t0, n.d, n.f * 2, n.f * 2, 0, 0.09, 6);
t0 += n.d + (n.gap || 0);
});
});
}
function synthRingWarm(ctx) {
return synthRingNotes(ctx, [
{ f: 523.25, d: 0.45 }, { f: 659.25, d: 0.45 },
{ f: 783.99, d: 0.45 }, { f: 659.25, d: 0.75 }
], 2.1);
}
function synthRingClassic(ctx) {
return synthRingNotes(ctx, [
{ f: 659.25, d: 0.35, gap: 0.12 }, { f: 659.25, d: 0.35, gap: 0.7 }
], 1.52);
}
const SYNTHS = {
bubble: synthBubble, ding: synthDing, bird: synthBird,
drop: synthDrop, piano: synthPiano, tick: synthTick,
'ring-warm': synthRingWarm, 'ring-classic': synthRingClassic
};
const _bufCache = {};
function builtinBuffer(ctx, id) {
if (!_bufCache[id]) {
try { _bufCache[id] = SYNTHS[id](ctx); } catch (e) { return null; }
}
return _bufCache[id];
}
(function unlockIosMedia() {
var unlocked = false;
function tryUnlock() {
if (unlocked) return;
var a = null;
try {
var sr = 8000, n = Math.round(sr * 0.1), buf = new ArrayBuffer(44 + n), v = new DataView(buf);
var ws = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
ws(0, 'RIFF'); v.setUint32(4, 36 + n, true); ws(8, 'WAVE');
ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
ws(36, 'data'); v.setUint32(40, n, true);
var bytes = new Uint8Array(buf), bin = '', i;
for (i = 0; i < n; i++) v.setUint8(44 + i, 128);
for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
a = new Audio();
a.src = 'data:audio/wav;base64,' + btoa(bin);
a.volume = 0.0001;
var p = a.play();
if (p && p.catch) p.catch(function () { unlocked = false; });
unlocked = true;
} catch (e) { unlocked = false; }
}
document.addEventListener('touchstart', tryUnlock, { passive: true });
document.addEventListener('click', tryUnlock, { passive: true });
document.addEventListener('keydown', tryUnlock);
})();
let ringSrc = null;
let ringAudio = null; // 自定义上传铃声的 Audio 单例（长铃循环可停止）
function playBuiltin(id, loop) {
const ctx = ensureCtx();
if (!ctx) return;
const buf = builtinBuffer(ctx, id);
if (!buf) return;
const start = () => {
let src;
try {
src = ctx.createBufferSource();
src.buffer = buf;
src.loop = !!loop;
const g = ctx.createGain();
g.gain.value = 0.9;
src.connect(g);
g.connect(ctx.destination);
src.start();
} catch (e) { return; }
if (loop) {
if (ringSrc) { try { ringSrc.stop(); } catch (e) {} }
ringSrc = src;
}
};
if (ctx.state === 'running') { start(); return; }
try {
const p = ctx.resume();
if (p && p.then) p.then(start).catch(function () {});
else start();
} catch (e) { start(); }
}
const releaseWhenDone = function (el) {
const done = function () { try { el.removeAttribute('src'); el.load(); } catch (e) {} };
el.addEventListener('ended', done);
el.addEventListener('error', done);
};
let ringObjUrl = null; // 通话铃声 blob: URL（stopSfx/替换时回收）
function revokeRingObjUrl() {
if (ringObjUrl) { try { URL.revokeObjectURL(ringObjUrl); } catch (e) {} ringObjUrl = null; }
}
function dataUrlToBlob(dataUrl, cb) {
try {
const p = fetch(dataUrl).then(function (r) { return r.blob(); });
if (p && p.then) p.then(function (b) { cb(b); }, function () { cb(null); });
else cb(null);
} catch (e) { cb(null); }
}
function ringBuiltinFallbackId() {
const bid = store.get(BKEYS.ring);
return (bid && bid !== 'none' && SYNTHS[bid]) ? bid : 'ring-warm';
}
let lastRingCustomFailToast = 0; // 兜底 toast 去重（5 分钟一次，避免每次来电都弹）
function ringCustomFail(wasLoop) {
if (ringAudio) { try { ringAudio.pause(); } catch (e) {} ringAudio = null; }
revokeRingObjUrl();
const now = Date.now();
if (now - lastRingCustomFailToast > 5 * 60 * 1000) {
lastRingCustomFailToast = now;
toast(wasLoop ? '自定义铃声无法播放，已改用内置铃声' : '自定义铃声无法播放');
}
if (wasLoop) playBuiltin(ringBuiltinFallbackId(), true); // 来电兜底：保证不无声
}
function playRingSrc(src, loop) {
if (ringAudio) { try { ringAudio.pause(); } catch (e) {} try { ringAudio.removeAttribute('src'); ringAudio.load(); } catch (e) {} }
ringAudio = new Audio(src);
ringAudio.loop = loop;
ringAudio.volume = 0.9;
let failed = false;
const fail = function () { if (!failed) { failed = true; ringCustomFail(loop); } };
ringAudio.addEventListener('error', fail);
ringAudio.play().catch(fail);
}
function playRingCustom(v, loop) {
if (v.indexOf('data:') === 0) {
dataUrlToBlob(v, function (b) {
if (b) {
try {
const newUrl = URL.createObjectURL(b);
revokeRingObjUrl(); // 先回收旧 URL，再挂新 URL（顺序不可反：先 revoke 会把新 URL 也一起回收）
ringObjUrl = newUrl;
playRingSrc(newUrl, loop);
return;
} catch (e) { revokeRingObjUrl(); }
}
revokeRingObjUrl();
playRingSrc(v, loop); // Blob 不可用（fetch 受限）→ dataURL 直播
});
} else {
revokeRingObjUrl();
playRingSrc(v, loop);
}
}
let ringReadGen = 0;
function siteMusicAudible() {
try { const m = window.__mochiMusic; return !!(m && m.el && m.el.paused === false); } catch (e) { return false; }
}
window.playSfx = function (type, opts) {
try {
if (type !== 'ring' && siteMusicAudible()) return;
const loop = !(opts && opts.loop === false);
const custom = store.get(KEYS[type]);
if (custom && typeof custom === 'string' && custom.length > 10) {
if (type === 'ring') {
playRingCustom(custom, loop);
return;
}
const a = new Audio(custom);
a.volume = 0.9;
releaseWhenDone(a);
a.play().catch(() => {});
return;
}
if (type === 'ring') {
const sst = sfxUnified() ? gStore : rawStore;
let needsAsk = false;
try { needsAsk = !!(sst && sst.awaitingBigKey && sst.awaitingBigKey(KEYS.ring)); } catch (e) {}
if (needsAsk) {
const gen = ++ringReadGen;
let settled = false;
const tryCustom = function () {
if (settled || gen !== ringReadGen) return;
let v = null;
try { v = sst.get(KEYS.ring); } catch (e) {}
if (v && typeof v === 'string' && v.length > 10) { settled = true; playRingCustom(v, loop); }
};
const builtinSeg = function () {
if (settled || gen !== ringReadGen) return;
settled = true;
const bid = store.get(BKEYS.ring);
if (bid !== 'none' && bid && SYNTHS[bid]) playBuiltin(bid, true);
};
tryCustom(); // 回读可能在问证人期间已落地（竞速窗口）
if (!settled) {
try { sst.whenBigKeyBack(KEYS.ring, tryCustom); } catch (e) {}
setTimeout(builtinSeg, 1600); // 确无此键（'absent' 不回调）或问不出结果时按时收场
}
return;
}
}
const bid = store.get(BKEYS[type]);
if (bid !== 'none' && bid && SYNTHS[bid]) playBuiltin(bid, type === 'ring' && loop);
} catch (e) {}
};
window.playSfxGc = function (type) {
const gcType = (type === 'in') ? 'gc-in' : 'gc-out';
const singleType = (type === 'in') ? 'in' : 'out';
try {
const touched = store.get(KEYS[gcType]) || store.get(BKEYS[gcType]);
window.playSfx(touched ? gcType : singleType, { loop: false });
} catch (e) { try { window.playSfx(singleType, { loop: false }); } catch (e2) {} }
};
window.stopSfx = function (type) {
if (type === 'ring') {
ringReadGen++; // #1485b：接听/挂断＝在飞的补读与超时兜底全部作废，不许迟响/双响
if (ringAudio) { try { ringAudio.pause(); } catch (e) {} ringAudio = null; }
revokeRingObjUrl();
if (ringSrc) { try { ringSrc.stop(); } catch (e) {} ringSrc = null; }
}
};
window.playBuiltinSfx = function (id, loop) { playBuiltin(id, loop); };
function sfxState(type) {
const custom = store.get(KEYS[type]);
if (custom && typeof custom === 'string' && custom.length > 10) {
return { custom: true, id: null, label: '自定义' };
}
const bid = store.get(BKEYS[type]);
if (bid === 'none' || !(bid && PRESET_NAMES[bid])) {
return { custom: false, id: 'none', label: '静音' };
}
return { custom: false, id: bid, label: PRESET_NAMES[bid] };
}
function handleUpload(type) {
window.mochiFilePick({
id: 'mochi-sfx-pick', accept: 'audio/*',
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到音频，请再选一次'); return; }
if (f.size > 3 * 1024 * 1024) { toast('音频较大（>3MB），可能占用较多存储空间'); }
toast('正在读取音频…');
const reader = new FileReader();
reader.onload = () => {
store.set(KEYS[type], reader.result);
store.remove(BKEYS[type]); // 切换到自定义，清掉内置选择避免胶囊高亮歧义
renderAllSfx();
toast(NAMES[type] + '已设置为自定义音频');
};
reader.onerror = () => { toast('音频读取失败'); };
reader.readAsDataURL(f);
}
});
}
function handleClear(type) {
store.remove(KEYS[type]);
renderAllSfx();
toast(NAMES[type] + '自定义音频已清除');
}
function renderTools(type, containerId) {
const el = document.getElementById(containerId);
if (!el) return;
el.innerHTML = '';
const st = sfxState(type);
const mk = (cls, label, cb) => {
const b = document.createElement('button');
b.type = 'button';
b.className = cls;
b.textContent = label;
b.addEventListener('click', cb);
el.appendChild(b);
};
if (st.custom) {
mk('cc-tool', '试听自定义', () => { window.playSfx(type, { loop: false }); });
mk('cc-tool cc-tool-danger', '清除自定义', () => handleClear(type));
} else {
mk('cc-tool', '上传自定义音频', () => handleUpload(type));
}
}
function updateVals() {
[['ring', 'sfx-ring-val'], ['in', 'sfx-in-val'], ['out', 'sfx-out-val'], ['gc-in', 'sfx-gcin-val'], ['gc-out', 'sfx-gcout-val']].forEach((pair) => {
const el = document.getElementById(pair[1]);
if (el) el.textContent = sfxState(pair[0]).label;
});
}
function renderPresets(type, containerId) {
const el = document.getElementById(containerId);
if (!el) return;
el.innerHTML = '';
const st = sfxState(type);
const ids = ['none'].concat(PRESET_ORDER[type] || []);
ids.forEach((id) => {
const b = document.createElement('button');
b.type = 'button';
b.className = 'sfx-preset' + ((!st.custom && st.id === id) ? ' on' : '');
b.textContent = (id === 'none') ? '静音' : (PRESET_NAMES[id] || id);
b.addEventListener('click', () => {
if (store.get(KEYS[type])) store.remove(KEYS[type]);
store.set(BKEYS[type], id);
renderAllSfx();
if (id === 'none') toast(NAMES[type] + '音效已静音');
else window.playSfx(type, { loop: false });
});
el.appendChild(b);
});
}
function renderAllSfx() {
renderPresets('ring', PRESET_CONTAINERS.ring);
renderPresets('in', PRESET_CONTAINERS.in);
renderPresets('out', PRESET_CONTAINERS.out);
renderPresets('gc-in', PRESET_CONTAINERS['gc-in']); // #698d：群聊收发两张卡片
renderPresets('gc-out', PRESET_CONTAINERS['gc-out']);
renderTools('ring', 'sfx-ring-tools');
renderTools('in', 'sfx-in-tools');
renderTools('out', 'sfx-out-tools');
renderTools('gc-in', 'sfx-gcin-tools');
renderTools('gc-out', 'sfx-gcout-tools');
updateVals();
}
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
['sfx-ring', 'sfx-in', 'sfx-out', 'sfx-ring-b', 'sfx-in-b', 'sfx-out-b'].forEach(key => {
window.idbGet(myPrefix + ':' + key).then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2 && !store.get(key)) {
store.set(key, v);
}
renderAllSfx();
});
});
}
} catch (e) {}
renderAllSfx();
document.addEventListener('contact-switched', () => {
renderAllSfx();
});
const sfxUniToggle = document.getElementById('sfx-unified');
function syncSfxUniRow() { if (sfxUniToggle) sfxUniToggle.checked = sfxUnified(); }
if (sfxUniToggle) {
sfxUniToggle.addEventListener('change', () => {
const on = !!sfxUniToggle.checked;
try { gStore.set('sfx-unified', on ? '1' : '0'); } catch (e) {}
if (on) {
['sfx-ring', 'sfx-in', 'sfx-out', 'sfx-ring-b', 'sfx-in-b', 'sfx-out-b'].forEach(k => {
const v = rawStore.get(k);
if (v !== null && v !== undefined && v !== '') gStore.set(k, v); else gStore.remove(k);
});
toast('已切换为全部桌面共用（以当前桌面的设置为共用设置）');
} else {
toast('已切换为各桌面各自设置');
}
renderAllSfx();
});
syncSfxUniRow();
}
document.addEventListener('contact-switched', syncSfxUniRow);
document.addEventListener('click', (e) => {
if (e.target && e.target.closest && e.target.closest('#row-sfx-settings')) {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const sp = document.getElementById('page-sfx-settings');
if (sp) sp.hidden = false;
}
});
document.addEventListener('click', (e) => {
if (e.target && e.target.closest && e.target.closest('#sfx-back')) {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const sp = document.getElementById('page-setting');
if (sp) sp.hidden = false;
}
});
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("sfx.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("sfx.js"); try { console.error("[JS] sfx.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[sfx.js] " + String(__e && __e.message || __e)); } })();
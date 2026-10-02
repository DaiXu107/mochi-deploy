(function () { try {
(function () {
const uid = window.activePrefix();
const ls = window.activeStore();
const DEFAULTS = {
'rs-min': 1, 'rs-max': 40,
'reply-min': 1, 'reply-max': 2,
'rl-en': 0, 'rl-win': 5, 'rl-max': 15,
'turn-en': 0,
'rn-prob': 20, 'touch-prob': 5,
'sticker-prob': 10, 'emoji-prob': 5, 'image-prob': 5, 'voice-prob': 10,
'kaomoji-prob': 5, 'quote-prob': 30,
'rc-prob': 25, 'rc-refix': 35, 'rc-en': 1, 'cf-prob': 20,
'py-en': 1, 'py-prob': 50, 'py-min': 2, 'py-max': 5,
'py-punct-en': 1,
'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 1, 'py-punct-ex': 1, 'py-punct-q': 1, 'py-punct-el': 1,
'py-punct-dash': 1,
'py-punct-nl': 0,
'csp-cust': 50,
'dcp-all': 100,
'ic-freq': 0,
'qs-en': 1, 'qs-prob': 25, 'qs-cc': 1, 'qs-one': 1, 'qs-multi': 1, 'qs-noLimit': 1,
'mjf-en': 1, 'mjf-prob': 20, 'mjf-style': 1,
'mjf-src-cc': 1, 'mjf-src-def': 1, 'mjf-src-dict': 1,
'mjf-w-cc': 50, 'mjf-w-def': 25, 'mjf-w-dict': 25,
'mjf-mix': 1,
'mjf-punct': 1,
'mjf-pub': 80,
'as-en': 1, 'as-prob': 30, 'as-min': 5, 'as-max': 10,
'as-count-min': 1, 'as-count-max': 2, 'dnd-en': 0,
'as-badge-heart': 1,
'as-badge': 1,
'as-badge-star': 0, 'as-badge-moon': 0, 'as-badge-spark': 0, 'as-badge-paw': 0,
'as-badge-rand': 1,
'ai-rps-en': 1, 'ai-rps-prob': 8, 'ai-game-en': 1, 'ai-game-prob': 5,
'ai-cuddle-en': 1, 'ai-cuddle-prob': 5,
'ai-cc-en': 1, 'ai-cc-prob': 4,
'rp-thx-en': 1, 'rp-thx-prob': 60, 'rp-thx-mode': 2,
'ckq-en': 1, 'ckq-prob': 2, 'ckq-popup-prob': 70, 'ckq-cool': 30,
'desk-call-prob': 2,
'ml-min-cards': 20, 'ml-max-cards': 50,
'ml-write-prob': 30, 'ml-write-min': 1, 'ml-write-max': 480,
'ml-write-daily-max': 3,
'ml-write-en': 1,
'ml-reply-prob': 80, 'ml-reply-min': 1, 'ml-reply-max': 480,
'ml-kaomoji-en': 1, 'ml-emoji-en': 1, 'ml-sticker-en': 1,
'ml-fish-week-en': 1,
'ml-punct-en': 0,
'fd-like-prob': 60, 'fd-like-speed-min': 1, 'fd-like-speed-max': 60,
'fd-comment-prob': 70, 'fd-comment-speed-min': 1, 'fd-comment-speed-max': 60,
'fd-reply-prob': 60, 'fd-reply-speed-min': 1, 'fd-reply-speed-max': 60,
'fd-likeback-prob': 50,
'fd-card-prob': 80, 'fd-max-cards': 5, 'fd-image-prob': 50,
'fd-post-prob': 40, 'fd-post-daily-max': 5, 'fd-post-cool': 30,
'fd-post-en': 1,
'fd-min-interval': 1, 'fd-max-interval': 720,
'fd-min-cards-post': 4, 'fd-max-cards-post': 15,
'fd-post-kaomoji': 10, 'fd-post-emoji': 10, 'fd-post-sticker': 30, 'fd-post-image': 30,
'fd-kaomoji-en': 1, 'fd-emoji-en': 1, 'fd-sticker-en': 1, 'fd-image-en': 1,
'fd-punct-en': 0,
'call-incoming': 15, 'call-pickup': 70, 'call-busy': 15, 'call-reject': 15, 'call-hangup': 2,
'call-resume': 1,
'call-no-hangup': 0,
'cs-normal': 0, 'cs-trigger-name': 1, 'cs-trigger-bar': 0,
'fish-en': 1, 'work-en': 1,
'fish-grab-en': 1,
'gc-prob': 60, 'gc-rs-min': 1, 'gc-rs-max': 40,
'gc-turn-en': 0,
'gc-reply-min': 1, 'gc-reply-max': 2,
'gc-cs-normal': 0, 'gc-cs-trigger-name': 1, 'gc-cs-trigger-bar': 0,
'gc-touch-prob': 5, 'gc-sticker-prob': 10, 'gc-emoji-prob': 5, 'gc-image-prob': 5, 'gc-voice-prob': 10,
'gc-kaomoji-prob': 5, 'gc-quote-prob': 30, 'gc-rc-prob': 25, 'gc-rc-refix': 35,
'gc-py-en': 1, 'gc-py-prob': 50, 'gc-py-min': 2, 'gc-py-max': 5
};
function gcRead(k) {
try {
const g = window.xyStore('xy-home-v2').get('reply-gc-' + k);
if (g !== null && g !== undefined && g !== '') return g;
} catch (e) {}
try { return ls.get('reply-gc-' + k); } catch (e) { return null; }
}
function gcWrite(k, v) {
try { window.xyStore('xy-home-v2').set('reply-gc-' + k, String(v)); } catch (e) {}
}
function rawNumFrom(store, k) {
try {
const v = store ? store.get(k) : null;
if (v === null || v === undefined || v === '') return null;
const n = Number(v);
return isFinite(n) ? n : null;
} catch (e) { return null; }
}
function spellPairFrom(store, out) {
const ownMin = rawNumFrom(store, 'reply-qs-min');
const ownMax = rawNumFrom(store, 'reply-qs-max');
const baseMin = Math.max(1, Math.min(10, Number(out['py-min']) || 2));
const baseMax = Math.max(baseMin, Math.min(10, Number(out['py-max']) || 5));
let mn = ownMin === null ? baseMin : Math.max(1, Math.min(10, ownMin));
let mx = ownMax === null ? baseMax : Math.max(1, Math.min(10, ownMax));
if (mx < mn) mx = mn;   // 只设过一枚、而另一枚的跟随值比它更小时：把跟随那枚抬上来，区间不许倒挂
return { min: mn, max: mx, own: (ownMin !== null && ownMax !== null) ? 1 : 0, rawMin: ownMin, rawMax: ownMax };
}
function getCfg() {
const out = {};
Object.keys(DEFAULTS).forEach(k => {
const v = k.indexOf('gc-') === 0 ? gcRead(k) : ls.get('reply-' + k);
let n = (v === null || v === undefined || v === '') ? DEFAULTS[k] : Number(v);
if (isNaN(n)) {
n = DEFAULTS[k];
try { if (k.indexOf('gc-') === 0) gcWrite(k, String(n)); else ls.set('reply-' + k, String(n)); } catch (e) {}
}
out[k] = n;
});
const spPair = spellPairFrom(ls, out);
out['qs-min'] = spPair.min;
out['qs-max'] = spPair.max;
out['qs-pair-own'] = spPair.own;
try { out['py-punct-custom'] = String(ls.get('reply-py-punct-custom') || '[]'); } catch (e) { out['py-punct-custom'] = '[]'; }
try { out['as-badge-custom'] = String(ls.get('reply-as-badge-custom') || '[]'); } catch (e) { out['as-badge-custom'] = '[]'; }
try { out['mjf-punct-pool'] = String(ls.get('reply-mjf-punct-pool') || ''); } catch (e) { out['mjf-punct-pool'] = ''; }
try { out['mjf-punct-set'] = String(ls.get('reply-mjf-punct-set') || ''); } catch (e) { out['mjf-punct-set'] = ''; }
return out;
}
window.replyCfg = getCfg;
window.replyCfgFor = function (cid) {
const out = {};
let s = null;
try { s = (cid && window.storeForCid) ? window.storeForCid(cid) : (cid && window.storeFor) ? window.storeFor(cid) : ls; } catch (e) { s = ls; }
Object.keys(DEFAULTS).forEach(k => {
const v = k.indexOf('gc-') === 0 ? gcRead(k) : (s ? s.get('reply-' + k) : null);
let n = (v === null || v === undefined || v === '') ? DEFAULTS[k] : Number(v);
if (isNaN(n)) n = DEFAULTS[k];
out[k] = n;
});
try { out['py-punct-custom'] = String((s || ls).get('reply-py-punct-custom') || '[]'); } catch (e) { out['py-punct-custom'] = '[]'; }
try { out['as-badge-custom'] = String((s || ls).get('reply-as-badge-custom') || '[]'); } catch (e) { out['as-badge-custom'] = '[]'; }
try { out['mjf-punct-pool'] = String((s || ls).get('reply-mjf-punct-pool') || ''); } catch (e) { out['mjf-punct-pool'] = ''; }
try { out['mjf-punct-set'] = String((s || ls).get('reply-mjf-punct-set') || ''); } catch (e) { out['mjf-punct-set'] = ''; }
const spPair2 = spellPairFrom(s || ls, out);
out['qs-min'] = spPair2.min;
out['qs-max'] = spPair2.max;
out['qs-pair-own'] = spPair2.own;
return out;
};
window.groupChatCfg = function () {
try {
const c = getCfg();
const out = {};
Object.keys(DEFAULTS).forEach(k => { if (k.indexOf('gc-') === 0) out[k] = c[k]; });
return out;
} catch (e) { return {}; }
};
const PAIR_SIB = { 'py-min': 'py-max', 'py-max': 'py-min',
'qs-min': 'qs-max', 'qs-max': 'qs-min',
'gc-py-min': 'gc-py-max', 'gc-py-max': 'gc-py-min' };
const isMinSide = (k) => /-min$/.test(k);
function writePairedRange(k, v) {
const sib = PAIR_SIB[k];
if (!sib) return false;
const gc = k.indexOf('gc-') === 0;
const n = Math.round(Number(v));
if (!isFinite(n)) return false;
const base = getCfg();
const other = Math.round(Number(base[sib]));
let lo = isMinSide(k) ? n : (isFinite(other) ? other : n);
let hi = isMinSide(k) ? (isFinite(other) ? other : n) : n;
if (hi < lo) { if (isMinSide(k)) hi = lo; else lo = hi; }   // 谁动收谁的对家
lo = Math.max(1, Math.min(10, lo));
hi = Math.max(lo, Math.min(10, hi));
const minK = isMinSide(k) ? k : sib, maxK = isMinSide(k) ? sib : k;
if (gc) { gcWrite(minK, lo); gcWrite(maxK, hi); }
else { ls.set('reply-' + minK, String(lo)); ls.set('reply-' + maxK, String(hi)); }
[minK, maxK].forEach(refreshStepperVal);
syncSpellPairReadout();
return true;
}
function syncSpellPairReadout() {
const el = document.getElementById('qs-range-readout');
if (!el) return;
try {
const c = getCfg();
const mn = Number(c['qs-min']), mx = Number(c['qs-max']);
if (!isFinite(mn) || !isFinite(mx)) { el.textContent = ''; return; }
let s = '每次拼字：现在 ' + mn + '~' + mx + ' 张';
if (mn === mx) s += '（最少＝最多，命中拼字时固定 ' + mx + ' 张、不再随机）';
s += Number(c['qs-pair-own']) === 1 ? '（本组单设）' : '（跟随上方「多字卡回复」的最少/最多条数；动本组任一格即单独设定）';
el.textContent = s;
} catch (e) {}
}
function refreshStepperVal(k) {
document.querySelectorAll('#page-reply-settings .stepper, #page-chat-settings .stepper, #group-chat-settings .stepper').forEach(st => {
if (st.dataset.k !== k) return;
const val = st.querySelector('input.stp-val');
if (!val) return;
const v = getCfg()[k];
val.value = String(v);
val.setAttribute('value', String(v));
});
}
const sessionSavedKeys = new Set();
window.saveReplyCfg = function (k, v) {
try { sessionSavedKeys.add(k); } catch (e0) {}
if (k.indexOf('gc-') === 0) {
if (PAIR_SIB[k]) writePairedRange(k, v); else gcWrite(k, v);
if (k.indexOf('gc-cs-') === 0) document.dispatchEvent(new Event('gc-continue-say-changed'));
return;
}
if (PAIR_SIB[k]) {
writePairedRange(k, v);
} else {
ls.set('reply-' + k, String(v));
}
if (k === 'as-en' || k === 'as-prob' || k === 'as-min' || k === 'as-max' ||
k === 'as-count-min' || k === 'as-count-max' || k === 'dnd-en') {
try { if (window.rescheduleAutoSend) window.rescheduleAutoSend(); } catch (e) {}
}
};
function showPage(id) {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const el = document.getElementById(id);
if (el) el.hidden = false;
}
const gcContinuePanel = document.querySelector('#page-reply-settings [data-rpanel="group"]');
if (gcContinuePanel && !document.getElementById('gc-cs-normal')) {
const section = document.createElement('div');
section.id = 'gc-continue-settings';
section.innerHTML = '<div class="gs-title">让对方继续说</div><div class="set-group glass">' +
'<div class="gs-row"><span>按正常回复时间</span><label class="toggle"><input type="checkbox" id="gc-cs-normal"><span class="tk"></span></label></div>' +
'<div class="gs-sub">未开启时，点击后联系人立即回复</div>' +
'<div class="gs-row"><span>点顶部昵称触发</span><label class="toggle"><input type="checkbox" id="gc-cs-trigger-name"><span class="tk"></span></label></div>' +
'<div class="gs-row"><span>底部聊天栏按钮触发</span><label class="toggle"><input type="checkbox" id="gc-cs-trigger-bar"><span class="tk"></span></label></div>' +
'<div class="gs-sub">点顶部昵称（群名）/底部按钮会触发新一轮回复，条数仍按上面设置抽取，会叠在正常回复之外；顶部已无独立的继续说按钮（与单聊同口径，只看这两枚开关），开启昵称触发后，切换群聊请用右上角菜单的「切换群聊」。</div></div>';
gcContinuePanel.insertBefore(section, gcContinuePanel.lastElementChild);
}
if (!document.getElementById('fish-grab-en')) {
const workRow = document.getElementById('work-en');
const fishGroup = workRow ? workRow.closest('.set-group') : null;
if (fishGroup) {
fishGroup.insertAdjacentHTML('beforeend',
'<div class="gs-row"><span>摸鱼抓包浮字</span><label class="toggle"><input type="checkbox" id="fish-grab-en"><span class="tk"></span></label></div>' +
'<div class="gs-sub">开启后 TA 摸鱼值上涨时桌面会飘「摸鱼浮字」，6 秒内点「点我抓包」会结算 TA 自上次被抓以来涨的全部摸鱼值（TA 补一份总账、你得同额）＋TA 害羞回应；关闭后不再飘字、也没有抓包（摸鱼值本身照常累计），冷却与每日次数照旧不消耗</div>');
}
}
const RP_THX_MODES = [{ label: '系统预设话术', value: 0 }, { label: '像正常聊天一样回复', value: 1 }, { label: '混合', value: 2 }];
window.rpThxModeList = RP_THX_MODES;
window.rpThxModeLabel = function (v) {
const n = Number(v);
for (let i = 0; i < RP_THX_MODES.length; i++) { if (RP_THX_MODES[i].value === n) return RP_THX_MODES[i].label; }
return '混合';
};
window.rpThxModeSync = function () {
const el = document.getElementById('rp-thx-mode-btn');
if (!el) return;
let v = 2;
try { v = Number((window.replyCfg && window.replyCfg())['rp-thx-mode']); } catch (e) {}
if (v !== 0 && v !== 1) v = 2;
el.textContent = window.rpThxModeLabel(v);
el.dataset.v = String(v);
};
if (!document.getElementById('rp-thx-en')) {
const rpThxPanel = document.querySelector('#page-reply-settings [data-rpanel="other"]');
if (rpThxPanel) {
const rpThxSec = document.createElement('div');
rpThxSec.id = 'rp-thx-settings';
rpThxSec.innerHTML = '<div class="gs-title" style="margin-top:10px">红包互动</div>' +
'<div class="set-group glass">' +
'<div class="gs-row"><span>红包领后捎一句话</span><label class="toggle"><input type="checkbox" id="rp-thx-en"><span class="tk"></span></label></div>' +
'<div class="gs-row"><span>捎话概率</span><div class="stepper" data-k="rp-thx-prob" data-min="0" data-max="100" data-step="5"><button class="stp-min">−</button><input class="stp-val" id="rp-thx-prob-val" readonly><button class="stp-max">+</button></div></div>' +
'<div class="gs-row"><span>捎话内容</span><div class="gs-pick" id="rp-thx-mode-btn" data-v="2">混合</div></div>' +
'</div>' +
'<div class="gs-sub" style="padding:0 14px 14px">我领取 TA 发的红包、或 TA 领取我发的红包后，TA 有概率主动捎来一句话（默认开，概率 60%）。这句话固定只发一条、不受「回复条数最多」限制，也不占正常回复的名额；「捎话内容」三档＝只用系统预设话术 / 和正常聊天一样回复（走字卡与词典管线）/ 混合（约六成预设、四成聊天式）；各联系人独立保存，总开关关闭后两个方向都不再触发</div>';
rpThxPanel.appendChild(rpThxSec);
const rpThxModeBtn = document.getElementById('rp-thx-mode-btn');
if (rpThxModeBtn && window.openModal) {
rpThxModeBtn.addEventListener('click', () => {
window.openModal('红包领后捎话的内容', '', (v) => {
const n = Number(v);
if (n !== 0 && n !== 1 && n !== 2) return;
window.saveReplyCfg('rp-thx-mode', n);
window.rpThxModeSync();
try { toastReply('已设置：捎话内容＝' + window.rpThxModeLabel(n)); } catch (e) {}
}, { noInput: true, pill: rpThxModeBtn.dataset.v || '2', pills: RP_THX_MODES.map(m => ({ label: m.label, value: String(m.value) })) });
});
}
document.addEventListener('contact-switched', window.rpThxModeSync);
window.rpThxModeSync();
}
}
function syncUI() {
const cfg = getCfg();
document.querySelectorAll('#page-reply-settings .stepper, #page-call-settings .stepper').forEach(st => {
const k = st.dataset.k;
if (!k) return; // #518：分类档自定义行无 data-k，由本文件 #518 段自行绑定，这里跳过防写 undefined
const val = st.querySelector('input.stp-val');
if (val) {
const step = parseFloat(st.dataset.step) || 1;
const v = cfg[k] !== undefined ? cfg[k] : DEFAULTS[k];
const str = step < 1 ? Number(v).toFixed(2) : v;
val.value = str;
val.setAttribute('value', str);
}
});
['py-en', 'py-punct-en', 'as-en', 'dnd-en', 'as-badge', 'as-badge-heart', 'as-badge-star', 'as-badge-moon', 'as-badge-spark', 'as-badge-paw', 'as-badge-rand', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-cs-normal', 'gc-cs-trigger-name', 'gc-cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'ml-fish-week-en', 'ml-punct-en', 'fd-post-en', 'fd-punct-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'mjf-punct', 'rc-en', 'rl-en', 'fish-en', 'work-en', 'fish-grab-en', 'rp-thx-en', 'turn-en', 'gc-turn-en'].forEach(k => {
const el = document.getElementById(k);
if (el) el.checked = cfg[k] === 1;
});
try { if (window.rpThxModeSync) window.rpThxModeSync(); } catch (e) {}
syncSpellPairReadout();
}
let callIncomingToastTimer = null;
function toastCallIncoming(v) {
clearTimeout(callIncomingToastTimer);
callIncomingToastTimer = setTimeout(() => {
try { toastReply('来电概率已保存：' + v + '%'); } catch (e) {}
}, 250);
}
document.querySelectorAll('#page-reply-settings .stepper, #page-call-settings .stepper').forEach(st => {
const k = st.dataset.k;
if (!k) return; // #518：分类档自定义行无 data-k，由本文件 #518 段绑定 ±，避免双绑与 reply-undefined 落盘
const intAttr = (name, def) => { const v = parseInt(st.getAttribute(name), 10); return Number.isNaN(v) ? def : v; };
const min = intAttr('data-min', 0);
const max = intAttr('data-max', Infinity);
const step = parseFloat(st.dataset.step) || 1;
const val = st.querySelector('.stp-val');
const fmt = (v) => step < 1 ? v.toFixed(2) : v;
st.querySelector('.stp-min').addEventListener('click', () => {
const cur = parseFloat(val.value);
const nv = Math.max(min, cur - step);
val.value = fmt(nv); window.saveReplyCfg(k, val.value);
if (k === 'call-incoming') toastCallIncoming(fmt(nv));
else { try { const lb = st.closest('.gs-row') ? st.closest('.gs-row').querySelector('span') : null; if (lb) toastSaved(lb.textContent, true); } catch (e) {} }
});
st.querySelector('.stp-max').addEventListener('click', () => {
const cur = parseFloat(val.value);
const nv = Math.min(max, cur + step);
val.value = fmt(nv); window.saveReplyCfg(k, val.value);
if (k === 'call-incoming') toastCallIncoming(fmt(nv));
else { try { const lb = st.closest('.gs-row') ? st.closest('.gs-row').querySelector('span') : null; if (lb) toastSaved(lb.textContent, true); } catch (e) {} }
});
});
document.querySelectorAll('#page-reply-settings .stepper .stp-val, #page-call-settings .stepper .stp-val').forEach(val => {
const st = val.closest('.stepper');
if (!st) return;
const k = st.dataset.k;
if (!k) return;
val.removeAttribute('readonly'); // 转换器跳过 readonly，须先移除
val.setAttribute('inputmode', 'decimal'); // 手机上弹数字键盘（转换器复制到 ce-box）
const intAttr = (name, def) => { const v = parseInt(st.getAttribute(name), 10); return Number.isNaN(v) ? def : v; };
const min = intAttr('data-min', 0);
const max = intAttr('data-max', Infinity);
const step = parseFloat(st.dataset.step) || 1;
const fmt = (v) => step < 1 ? Number(v).toFixed(2) : String(Math.round(Number(v)));
const selectAll = () => {
try {
const box = val.__ceBox;
if (box) {
const r = document.createRange();
r.selectNodeContents(box);
const sel = window.getSelection();
sel.removeAllRanges();
sel.addRange(r);
} else {
val.select();
}
} catch (e) {}
};
val.addEventListener('click', function () {
try { val.focus(); } catch (e) {} // ce-box 聚焦由转换器代理
selectAll();
});
const commit = () => {
let v = parseFloat(val.value);
if (!isFinite(v)) v = min;
v = Math.min(max, Math.max(min, v));
if (step < 1) v = Math.round(v / step) * step;
else v = Math.round(v);
val.value = fmt(v);
window.saveReplyCfg(k, val.value);
if (k === 'call-incoming') toastCallIncoming(fmt(v));
else { try { const lb = st.closest('.gs-row') ? st.closest('.gs-row').querySelector('span') : null; if (lb) toastSaved(lb.textContent, true); } catch (e) {} }
};
val.addEventListener('change', commit);
val.addEventListener('blur', commit);
val.addEventListener('keydown', function (e) {
if (e.key === 'Enter' && !e.isComposing) {
e.preventDefault();
try { val.blur(); } catch (err) {}
}
});
});
const TOGGLE_NAMES = {
'py-en': '多字卡回复', 'py-punct-en': '拼接随机标点', 'as-en': '主动发送', 'dnd-en': '免打扰', 'as-badge': '主动发送标识',
'ml-kaomoji-en': '信箱颜文字', 'ml-emoji-en': '信箱emoji', 'ml-sticker-en': '信箱表情包',
'cs-normal': '让对方继续说', 'cs-trigger-name': '昵称触发继续说', 'cs-trigger-bar': '聊天栏继续说按钮',
'gc-cs-normal': '群聊继续说按正常回复时间', 'gc-cs-trigger-name': '群聊昵称触发继续说', 'gc-cs-trigger-bar': '群聊底部继续说按钮',
'gc-py-en': '群聊多字卡回复', 'ai-rps-en': '猜拳邀请', 'ai-game-en': '游戏邀请', 'ai-cuddle-en': '贴贴邀请',
'ai-cc-en': 'TA分享字卡', 'ckq-en': 'TA主动查岗', 'call-resume': '刷新恢复通话', 'call-no-hangup': '禁止联系人挂断',
'ml-write-en': '联系人主动写信', 'fd-post-en': '联系人主动发朋友圈',
'ml-punct-en': '信件拼接随机标点', 'fd-punct-en': '朋友圈拼接随机标点',
'ml-fish-week-en': '摸鱼小结寄信',
'fd-kaomoji-en': '朋友圈颜文字', 'fd-emoji-en': '朋友圈emoji', 'fd-sticker-en': '朋友圈表情包', 'fd-image-en': '朋友圈图片',
'qs-en': '词典拼字', 'qs-cc': '混用自定义字卡', 'qs-one': '单气泡拼字', 'qs-multi': '多回复逐卡连发',
'qs-noLimit': '逐卡连发不受条数限制', 'mjf-en': '梦角自由造句',
'mjf-src-cc': '造句语料·自定义字卡', 'mjf-src-def': '造句语料·默认聊天字卡', 'mjf-src-dict': '造句语料·词典',
'mjf-mix': '造句混合模式',
'mjf-punct': '造句句尾标点',
'rc-en': '撤回后补发消息',
'rl-en': 'TA 消息限流',
'turn-en': '连发的算一轮',
'gc-turn-en': '连发的算一轮（群聊）',
'fish-en': '摸鱼值累计', 'work-en': '工作值累计', 'fish-grab-en': '摸鱼抓包浮字',
'rp-thx-en': '红包领后捎一句话'
};
function ccToastEnsure() {
let d = null;
try {
d = document.getElementById('cc-toast');
if (!d) { d = document.createElement('div'); d.id = 'cc-toast'; document.body.appendChild(d); }
} catch (e) { return null; }
return d;
}
function toastSaved(label, on) {
try {
const d = ccToastEnsure();
if (!d) return;
d.textContent = '已保存：' + label + '（' + (on ? '开' : '关') + '）';
d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show';
clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 1800);
} catch (e) {}
}
['py-en', 'py-punct-en', 'as-en', 'dnd-en', 'as-badge', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-cs-normal', 'gc-cs-trigger-name', 'gc-cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'ml-fish-week-en', 'ml-punct-en', 'fd-post-en', 'fd-punct-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'mjf-punct', 'rc-en', 'rl-en', 'fish-en', 'work-en', 'fish-grab-en', 'rp-thx-en', 'turn-en', 'gc-turn-en'].forEach(k => {
const el = document.getElementById(k);
if (el) {
el.addEventListener('change', () => {
window.saveReplyCfg(k, el.checked ? 1 : 0);
if (TOGGLE_NAMES[k]) toastSaved(TOGGLE_NAMES[k], el.checked);
if (k === 'cs-trigger-name' || k === 'cs-trigger-bar') {
try { if (window.applyContinueSayUI) window.applyContinueSayUI(); } catch (e) {}
}
});
}
});
(function () {
const POOL = [['py-punct-space', '空格'], ['py-punct-dou', '，'], ['py-punct-per', '。'], ['py-punct-ex', '！'], ['py-punct-q', '？'], ['py-punct-el', '......'], ['py-punct-dash', '——'], ['py-punct-nl', '换行']];
const BUILTIN_VALS = [' ', '，', '。', '！', '？', '......', '——', '\n'];
const CUST_KEY = 'reply-py-punct-custom';
const box = document.getElementById('ppy-chips');
function ppyToast(msg, ms) {
const d = ccToastEnsure();
if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 1800); }
}
function pyCustGet() {
let arr = null;
try { arr = JSON.parse(ls.get(CUST_KEY) || '[]'); } catch (e) {}
if (!Array.isArray(arr)) arr = [];
return arr.filter(it => it && typeof it.s === 'string' && it.s);
}
function pyCustSet(list) { try { ls.set(CUST_KEY, JSON.stringify(list)); } catch (e) {} }
function ppyOtherSel(cfg, skipKey, skipIdx) {
let n = POOL.filter(p => p[0] !== skipKey && cfg[p[0]] === 1).length;
pyCustGet().forEach((it, i) => { if (i !== skipIdx && it && it.on === 1) n++; });
return n;
}
function renderCust() {
if (!box) return;
box.querySelectorAll('.ppy-chip[data-c]').forEach(el => el.remove());
const add = document.getElementById('ppy-add');
const dcfg = getCfg();
const dis = !(dcfg['py-en'] === 1 && dcfg['py-punct-en'] === 1); // #956c
pyCustGet().forEach((it, i) => {
const el = document.createElement('span');
el.className = 'tag ppy-chip ppy-chip-c' + (it.on === 1 ? ' sel' : '') + (dis ? ' dis' : '');
el.dataset.c = String(i);
el.textContent = it.s;
const x = document.createElement('i');
x.className = 'ppy-x';
x.textContent = '×';
el.appendChild(x);
if (add && add.parentNode === box) box.insertBefore(el, add); else box.appendChild(el);
});
}
function ppySync() {
if (!box) return;
const cfg = getCfg();
const pyMasterOn = cfg['py-en'] === 1; // #956b
const en = pyMasterOn && cfg['py-punct-en'] === 1;
box.querySelectorAll('.ppy-chip[data-k]').forEach(ch => {
const k = ch.dataset.k;
if (!k) return;
ch.classList.toggle('sel', cfg[k] === 1);
ch.classList.toggle('dis', !en);
});
const add = document.getElementById('ppy-add');
if (add) add.classList.toggle('dis', !en);
const swEl = document.getElementById('py-punct-en');
const rowPunct = swEl ? swEl.closest('.gs-row') : null;
if (rowPunct) rowPunct.style.opacity = (pyMasterOn && cfg['py-punct-en'] === 1) ? '' : '.45'; // #956d
const rowChips = box.closest ? box.closest('.gs-row') : null;
if (rowChips) rowChips.style.opacity = pyMasterOn ? '' : '.45'; // #956g
renderCust();
}
function ppyAddFlow() {
if (pyCustGet().length >= 8) { ppyToast('自定义拼接符号最多添加 8 个（可删掉不要的再加）', 2400); return; }
if (!window.openModal) return;
window.openModal('添加拼接符号', '', function (v) {
const s = String(v == null ? '' : v).trim();
if (!s) { ppyToast('没有输入符号', 2000); return; }
if (s.length > 6) { ppyToast('符号最长 6 个字符', 2000); return; }
const list = pyCustGet();
if (list.length >= 8) { ppyToast('自定义拼接符号最多添加 8 个（可删掉不要的再加）', 2400); return; }
if (BUILTIN_VALS.indexOf(s) > -1) { ppyToast('这是系统自带符号，点亮对应 chip 即可', 2400); return; }
if (list.some(it => it.s === s)) { ppyToast('该自定义符号已存在', 2000); return; }
list.push({ s: s, on: 1 });
pyCustSet(list);
ppySync();
toastSaved('添加拼接符号 ' + s, true);
}, { maxlength: 6, placeholder: '输入符号，如 ～ / ### / 💕' });
}
if (box) {
box.addEventListener('click', (ev) => {
if (ev.target.closest('#ppy-add')) { ppyAddFlow(); return; }
const ch = ev.target.closest('.ppy-chip');
if (!ch) return;
if (ch.dataset.c != null) {
const i = Number(ch.dataset.c);
const list = pyCustGet();
const it = list[i];
if (!it) return;
const del = !!ev.target.closest('.ppy-x');
if (it.on === 1 && ppyOtherSel(getCfg(), null, i) === 0) {
ppyToast('拼接符号至少保留一个（想回到纯空格请关上方「拼接随机标点」）', 2400);
return;
}
if (del) {
list.splice(i, 1);
pyCustSet(list);
ppySync();
ppyToast('已删除拼接符号 ' + it.s);
} else {
it.on = it.on === 1 ? 0 : 1;
pyCustSet(list);
ppySync();
toastSaved('拼接符号 ' + it.s, it.on === 1);
}
return;
}
const k = ch.dataset.k;
if (!k) return;
const cfg = getCfg();
const on = cfg[k] === 1;
if (on && ppyOtherSel(cfg, k, -1) === 0) {
ppyToast('拼接符号至少保留一个（想回到纯空格请关上方「拼接随机标点」）', 2400);
return;
}
window.saveReplyCfg(k, on ? 0 : 1);
ppySync();
const nm = (POOL.find(p => p[0] === k) || ['', k])[1];
toastSaved('拼接符号 ' + nm, !on);
});
}
ppySync();
const ppyEnEl = document.getElementById('py-punct-en');
if (ppyEnEl) ppyEnEl.addEventListener('change', () => setTimeout(ppySync, 30));
const pyEnEl = document.getElementById('py-en'); // #956e
if (pyEnEl) pyEnEl.addEventListener('change', () => setTimeout(ppySync, 30));
['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(evN => {
document.addEventListener(evN, () => { try { ppySync(); } catch (e) {} });
});
})();
(function () {
const POOL = [['as-badge-heart', '♥', '爱心'], ['as-badge-star', '★', '星星'], ['as-badge-moon', '☾', '月亮'], ['as-badge-spark', '✦', '闪光'], ['as-badge-paw', '🐾', '小爪']];
const BUILTIN_VALS = ['♥', '★', '☾', '✦', '🐾'];
const CUST_KEY = 'reply-as-badge-custom';
const box = document.getElementById('asb-chips');
function asbToast(msg, ms) {
const d = ccToastEnsure();
if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 1800); }
}
function asbCustGet() {
let arr = null;
try { arr = JSON.parse(ls.get(CUST_KEY) || '[]'); } catch (e) {}
if (!Array.isArray(arr)) arr = [];
return arr.filter(it => it && typeof it.s === 'string' && it.s);
}
function asbCustSet(list) { try { ls.set(CUST_KEY, JSON.stringify(list)); } catch (e) {} }
function renderCust() {
if (!box) return;
box.querySelectorAll('.ppy-chip[data-c]').forEach(el => el.remove());
const add = document.getElementById('asb-add');
const dis = getCfg()['as-badge'] !== 1;
asbCustGet().forEach((it, i) => {
const el = document.createElement('span');
el.className = 'tag ppy-chip ppy-chip-c' + (it.on === 1 ? ' sel' : '') + (dis ? ' dis' : '');
el.dataset.c = String(i);
el.textContent = it.s;
const x = document.createElement('i');
x.className = 'ppy-x';
x.textContent = '×';
el.appendChild(x);
if (add && add.parentNode === box) box.insertBefore(el, add); else box.appendChild(el);
});
}
function asbSync() {
if (!box) return;
const cfg = getCfg();
const en = cfg['as-badge'] === 1;
let selN = 0;
box.querySelectorAll('.ppy-chip[data-k]').forEach(ch => {
const k = ch.dataset.k;
if (!k) return;
if (cfg[k] === 1) selN++;
ch.classList.toggle('sel', cfg[k] === 1);
ch.classList.toggle('dis', !en);
});
const add = document.getElementById('asb-add');
if (add) add.classList.toggle('dis', !en);
const randRow = document.getElementById('asb-rand-row');
if (randRow) randRow.hidden = !(en && selN + asbCustGet().filter(it => it.on === 1).length >= 2);
const randEl = document.getElementById('as-badge-rand');
if (randEl) { randEl.checked = cfg['as-badge-rand'] === 1; randEl.disabled = !en; }
renderCust();
}
function asbAddRaw(raw) {
const s = String(raw == null ? '' : raw).trim();
if (!s) return { ok: false, msg: '没有输入标识' };
if (s.length > 4) return { ok: false, msg: '标识最长 4 个字符' };
const list = asbCustGet();
if (list.length >= 8) return { ok: false, msg: '自定义标识最多添加 8 个（可删掉不要的再加）' };
if (BUILTIN_VALS.indexOf(s) > -1) return { ok: false, msg: '这是系统自带标识，点亮对应 chip 即可' };
if (list.some(it => it.s === s)) return { ok: false, msg: '该自定义标识已存在' };
list.push({ s: s, on: 1 });
asbCustSet(list);
asbSync();
return { ok: true, msg: s };
}
function asbAddFlow() {
if (asbCustGet().length >= 8) { asbToast('自定义标识最多添加 8 个（可删掉不要的再加）', 2400); return; }
if (!window.openModal) return;
window.openModal('添加主动发送标识', '', function (v) {
const r = asbAddRaw(v);
if (!r.ok) { asbToast(r.msg, 2400); return; }
toastSaved('标识 ' + r.msg, true);
}, { maxlength: 4, placeholder: '输入标识，如 🌙 / ❀ / 喵' });
}
if (box) {
box.addEventListener('click', (ev) => {
if (ev.target.closest('#asb-add')) { asbAddFlow(); return; }
const ch = ev.target.closest('.ppy-chip');
if (!ch) return;
if (ch.dataset.c != null) {
const i = Number(ch.dataset.c);
const list = asbCustGet();
const it = list[i];
if (!it) return;
const del = !!ev.target.closest('.ppy-x');
if (del) {
list.splice(i, 1);
asbCustSet(list);
asbSync();
asbToast('已删除标识 ' + it.s);
} else {
it.on = it.on === 1 ? 0 : 1;
asbCustSet(list);
asbSync();
toastSaved('标识 ' + it.s, it.on === 1);
}
return;
}
const k = ch.dataset.k;
if (!k) return;
const cfg = getCfg();
const on = cfg[k] === 1;
window.saveReplyCfg(k, on ? 0 : 1);
asbSync();
const nm = (POOL.find(p => p[0] === k) || ['', '', k])[2];
toastSaved('标识 ' + nm, !on);
});
}
asbSync();
const asbEnEl = document.getElementById('as-badge');
if (asbEnEl) asbEnEl.addEventListener('change', () => setTimeout(asbSync, 30));
['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(evN => {
document.addEventListener(evN, () => { try { asbSync(); } catch (e) {} });
});
window.asBadgePool = function (c) {
try {
c = c || {};
const val = (k, d) => { const v = c[k]; return v === undefined ? d : v; };
const out = [];
POOL.forEach(p => { if (val(p[0], p[0] === 'as-badge-heart' ? 1 : 0) === 1) out.push({ s: p[1], builtin: 1 }); });
let arr = null;
try { arr = JSON.parse(c['as-badge-custom'] ? c['as-badge-custom'] : '[]'); } catch (e) {}
if (Array.isArray(arr)) arr.forEach(it => { if (it && it.on === 1 && typeof it.s === 'string' && it.s) out.push({ s: it.s, builtin: 0 }); });
return out;
} catch (e) { return []; }
};
window.asBadgeItems = function () {
const cfg = getCfg();
const out = POOL.map(p => ({ k: p[0], s: p[1], label: p[2], on: cfg[p[0]] === 1, builtin: 1 }));
try { asbCustGet().forEach((it, i) => out.push({ i: i, s: it.s, on: it.on === 1, builtin: 0 })); } catch (e) {}
return out;
};
window.asBadgeToggle = function (it) {
if (!it) return '';
if (it.builtin) {
window.saveReplyCfg(it.k, it.on ? 0 : 1);
asbSync();
return '标识 ' + (it.label || it.s);
}
const list = asbCustGet();
const cur = list[it.i];
if (!cur) return '';
cur.on = cur.on === 1 ? 0 : 1;
asbCustSet(list);
asbSync();
return '标识 ' + cur.s;
};
window.asBadgeAdd = asbAddRaw;
window.asBadgeWrite = function (k, v) { window.saveReplyCfg(k, v); try { asbSync(); } catch (e) {} };
window.asBadgeNode = function (pick) {
const s = String((pick && pick.s) || '');
if (pick && pick.builtin === 1 && s === '♥') {
const w = document.createElement('span');
w.innerHTML = '<svg class="msg-hi-heart" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
return w.firstChild;
}
if (!s) return null;
const mk = document.createElement('span');
mk.className = 'msg-hi-mark';
mk.setAttribute('aria-hidden', 'true');
mk.textContent = s;
return mk;
};
window.asBadgeRefreshMarks = function (host) {
try {
const root = host || document.getElementById('chat-body');
if (!root) return 0;
const cfg = getCfg();
const on = cfg['as-badge'] === 1;
let pool = [];
try { pool = window.asBadgePool(cfg) || []; } catch (e) { pool = []; }
if (!pool.length) pool = [{ s: '♥', builtin: 1 }];
const bubbles = root.querySelectorAll('.msg-bubble');
let n = 0;
for (let i = 0; i < bubbles.length; i++) {
const b = bubbles[i];
const old = b.querySelector('.msg-hi-heart, .msg-hi-mark');
const cur = old ? (old.classList.contains('msg-hi-heart') ? '♥' : String(old.textContent || '')) : String(b.dataset.asMark || '');
if (!cur) continue;
if (old) old.remove();
n++;
if (!on) { b.dataset.asMark = cur; continue; }
delete b.dataset.asMark;
let pick = pool[0];
const keep = pool.filter(p => p.s === cur)[0];
if (keep) pick = keep;
else if (pool.length > 1 && cfg['as-badge-rand'] !== 1) pick = pool[i % pool.length];
const node = window.asBadgeNode(pick);
if (node) b.insertBefore(node, b.firstChild);
}
return n;
} catch (e) { return 0; }
};
const randRow = document.getElementById('asb-rand-row');
if (randRow) {
randRow.addEventListener('click', (ev) => {
const ch = ev.target.closest('[data-asbrand]');
if (!ch) return;
const v = Number(ch.dataset.asbrand);
window.saveReplyCfg('as-badge-rand', v === 1 ? 1 : 0);
asbSync();
toastSaved('标识抽取方式 ' + (v === 1 ? '每次随机' : '按顺序轮换'), true);
});
}
})();
(function () {
const diagEl = document.getElementById('qs-diag');
if (!diagEl) return;
function qsDiagRender() {
try {
const c = window.replyCfg ? window.replyCfg() : {};
const gates = [];
let blocked = null;
function gate(ok, label, detail) { gates.push({ ok: !!ok, label: label, detail: detail || '' }); return !ok; }
const lockOk = !(window.cardLockOpen && !window.cardLockOpen());
if (gate(lockOk, '防未成年人锁', lockOk ? '已解锁' : '锁定中·词典被锁停') && !blocked) blocked = '「防未成年人锁定」开启中：词典属于系统内置字卡，锁定时词典拼字整体停用（下方开关全开也没效果）——到开屏公告区「防未成年人·内置字卡锁定」卡输入密码解锁，解锁后自动恢复';
const useOk = !(window.dictUse && window.dictUse('chat') === false);
const ov = window.dictOverall ? window.dictOverall('chat') : 100;
if (gate(useOk, '词典聊天使用', useOk ? '开（' + ov + '% 概率）' : '关') && !blocked) blocked = '词典「聊天使用」被关（词典独立页里打开）';
if (useOk && !(typeof ov === 'number' && isFinite(ov) && ov > 0) && !blocked) blocked = '词典「聊天使用概率」为 0（词典独立页调高）';
const pyOk = c['py-en'] === 1;
if (gate(pyOk, '多字卡回复总闸', pyOk ? '开' : '关·拼字整体停用') && !blocked) blocked = '「每条消息使用多字卡回复」总开关关着——#1236 起它是词典拼字的总闸，关了就两种形态都不再触发（要拼字就把它打开）';
const enOk = c['qs-en'] === 1;
const prob = Number(c['qs-prob']);
if (gate(enOk, '拼字总开关', enOk ? '开（' + (isFinite(prob) ? prob : 0) + '% 概率）' : '关') && !blocked) blocked = '「词典拼字」总开关被关（本组第一行打开）';
if (enOk && !(isFinite(prob) && prob > 0) && !blocked) blocked = '「拼字概率」为 0（本组第二行调高）';
let poolN = 0;
try {
const grps = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
grps.forEach(g => { (g[1] || []).forEach(q => {
if (typeof q !== 'string' || !q.trim()) return;
if (window.isDefaultCardOff && window.isDefaultCardOff('dict', q)) return;
poolN++;
}); });
} catch (e) {}
if (gate(poolN > 0, '抽卡池', poolN + ' 张') && !blocked) blocked = '词典抽卡池为空（词典独立页把字卡逐张打开）';
const okAll = !blocked;
const html = '<div class="qsdiag-row">' + gates.map(g =>
'<span class="qsdiag-gate ' + (g.ok ? 'qsdiag-ok' : 'qsdiag-bad') + '">' + (g.ok ? '✓' : '✗') + ' ' + g.label + '<em>' + g.detail + '</em></span>'
).join('') + '</div>' +
(okAll
? '<div class="qsdiag-okline">链路正常 · 联系人每条回复约 ' + (isFinite(prob) ? prob : 0) + '% 概率变成词典拼字</div>'
: '<div class="qsdiag-blocked">被挡住：' + blocked + '</div>');
diagEl.innerHTML = html;
} catch (e) {
try { diagEl.innerHTML = '<div class="qsdiag-blocked">链路自检暂不可用</div>'; } catch (e2) {}
}
}
qsDiagRender();
['qs-en', 'qs-one', 'qs-multi', 'qs-cc', 'py-en'].forEach(k => { // #1236：py-en 现在是拼字总闸，翻它必须同步刷新自检
const el = document.getElementById(k);
if (el) el.addEventListener('change', () => setTimeout(qsDiagRender, 50));
});
document.addEventListener('mochi-cardlock-open', qsDiagRender);
document.addEventListener('mochi-cardlock-locked', qsDiagRender);
document.addEventListener('contact-switched', qsDiagRender);
window.__qsDiagRender = qsDiagRender;
(function _qsWaitCardLib() {
if (window.getDefaultCardGroups) { qsDiagRender(); return; }
setTimeout(_qsWaitCardLib, 150);
})();
})();
const asEnEl = document.getElementById('as-en');
if (asEnEl) {
asEnEl.addEventListener('change', () => {
if (!asEnEl.checked) {
const d = ccToastEnsure();
if (d) { d.textContent = '主动发送已关闭，TA 将不再主动发消息'; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 2600); }
}
});
}
const dndEl = document.getElementById('dnd-en');
if (dndEl) {
dndEl.addEventListener('change', () => {
if (dndEl.checked) {
const d = ccToastEnsure();
if (d) { d.textContent = '免打扰已开启，TA 主动发送会大幅减弱（最长 3 小时一次）'; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 3200); }
}
});
}
const mjfEl = document.getElementById('mjf-en');
if (mjfEl) {
mjfEl.addEventListener('change', () => {
let okStore = false;
try {
const st = window.activeStore && window.activeStore();
if (st && st.get && st.set) {
const probe = 'mjf-probe-' + Date.now();
st.set('reply-mjf-probe', probe);
okStore = st.get('reply-mjf-probe') === probe;
try { st.set('reply-mjf-probe', ''); } catch (e) {}
}
} catch (e) { okStore = false; }
const d = ccToastEnsure();
if (!d) return;
const show = (msg) => { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 3200); };
if (mjfEl.checked && okStore) show('梦角自由造句已开启：TA 说话将按概率截字重造句（造出的句子进字卡库「梦角自由造句」分类）');
else if (mjfEl.checked) show('梦角自由造句开启失败：本地存储不可用，请检查浏览器隐私设置后重试');
else show('梦角自由造句已关闭');
});
}
(function () {
const SET_KEY = 'reply-mjf-punct-set';
const LEGACY_KEY = 'reply-mjf-punct-pool';
const POOL = [['sp', ' ', '空格'], ['dou', '，', '，'], ['per', '。', '。'], ['ex', '！', '！'], ['q', '？', '？'], ['el', '......', '......'], ['dash', '——', '——'], ['nl', '\n', '换行'], ['tilde', '~', '~'], ['ell', '……', '……']];
const VAL2P = {}; POOL.forEach(p => { VAL2P[p[1]] = p[0]; });
const labelOf = s => { const p = POOL.find(x => x[1] === s); return p ? p[2] : s; };
const DEF_LIT = ['。', '~', '！', '……'];
const box = document.getElementById('mjf-punct-pool');
if (!box) return;
function mjfpToast(msg, ms) {
const d = ccToastEnsure();
if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 1800); }
}
const valid = it => !!(it && typeof it.s === 'string' && it.s && it.s.length <= 6);
function parseLegacy(raw) {
const s = String(raw == null ? '' : raw).trim();
if (!s) return null;
let arr = s.split(/[\s|]+/).filter(Boolean);
if (arr.length < 2) arr = Array.from(s.replace(/[\s|]+/g, ''));
arr = arr.filter(x => x.length <= 6).slice(0, 20);
return arr.length ? arr : null;
}
function derive() {
let lit = null;
try { lit = parseLegacy(ls.get(LEGACY_KEY) || ''); } catch (e) {}
if (!lit) lit = DEF_LIT;
const set = {}; lit.forEach(x => { set[x] = 1; });
const list = POOL.map(p => ({ s: p[1], on: set[p[1]] ? 1 : 0 }));
Object.keys(set).forEach(v => { if (VAL2P[v] == null) list.push({ s: v, on: 1 }); });
return list;
}
function mjfpGet() {
let arr = null;
try { arr = JSON.parse(ls.get(SET_KEY) || ''); } catch (e) {}
if (Array.isArray(arr)) {
arr = arr.filter(valid);
if (arr.length) return arr;
}
return derive();
}
function mjfpSet(list) { try { ls.set(SET_KEY, JSON.stringify(list)); } catch (e) {} }
const isCust = it => VAL2P[it.s] == null;
const custCount = list => list.filter(isCust).length;
function otherSel(list, skipIdx) {
let n = 0;
list.forEach((it, i) => { if (i !== skipIdx && it.on === 1) n++; });
return n;
}
function mjfpDis() {
return getCfg()['mjf-punct'] !== 1;
}
function renderCust(list, dis) {
box.querySelectorAll('.ppy-chip[data-i]').forEach(el => el.remove());
const add = document.getElementById('mjfp-add');
list.forEach((it, i) => {
if (!isCust(it)) return;
const el = document.createElement('span');
el.className = 'tag ppy-chip ppy-chip-c' + (it.on === 1 ? ' sel' : '') + (dis ? ' dis' : '');
el.dataset.i = String(i);
el.textContent = it.s;
const x = document.createElement('i');
x.className = 'ppy-x';
x.textContent = '×';
el.appendChild(x);
if (add && add.parentNode === box) box.insertBefore(el, add); else box.appendChild(el);
});
}
function sync() {
const list = mjfpGet();
const dis = mjfpDis();
box.querySelectorAll('.ppy-chip[data-p]').forEach(ch => {
const v = (POOL.find(p => p[0] === ch.dataset.p) || [])[1];
if (v == null) return;
const it = list.find(x => x.s === v);
ch.classList.toggle('sel', !!(it && it.on === 1));
ch.classList.toggle('dis', dis);
});
const add = document.getElementById('mjfp-add');
if (add) add.classList.toggle('dis', dis);
const row = document.getElementById('mjf-punct-pool-row');
if (row) row.style.opacity = dis ? '.45' : '';
renderCust(list, dis);
}
function addFlow() {
const cur = mjfpGet();
if (custCount(cur) >= 8) { mjfpToast('自定义句尾标点最多添加 8 个（可删掉不要的再加）', 2400); return; }
if (!window.openModal) return;
window.openModal('添加句尾标点', '', function (v) {
const s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
if (!s) { mjfpToast('没有输入标点', 2000); return; }
if (s.length > 6) { mjfpToast('标点最长 6 个字符', 2000); return; }
const list = mjfpGet();
if (custCount(list) >= 8) { mjfpToast('自定义句尾标点最多添加 8 个（可删掉不要的再加）', 2400); return; }
if (list.some(it => it.s === s)) {
mjfpToast(isCust(list.find(it => it.s === s)) ? '该自定义标点已存在' : '这是系统自带标点，点亮对应 chip 即可', 2200);
return;
}
list.push({ s: s, on: 1 });
mjfpSet(list);
sync();
toastSaved('添加句尾标点 ' + s, true);
}, { maxlength: 6, placeholder: '输入标点，如 ～ / ❗ / !!!' });
}
box.addEventListener('click', (ev) => {
if (ev.target.closest('#mjfp-add')) { addFlow(); return; }
const ch = ev.target.closest('.ppy-chip');
if (!ch) return;
const list = mjfpGet();
let idx = -1;
if (ch.dataset.i != null) idx = Number(ch.dataset.i);
else {
const v = (POOL.find(p => p[0] === ch.dataset.p) || [])[1];
if (v != null) idx = list.findIndex(x => x.s === v);
}
const it = list[idx];
if (!it) return;
const del = !!ev.target.closest('.ppy-x');
if (it.on === 1 && otherSel(list, idx) === 0) {
mjfpToast('句尾标点至少保留一枚（想一枚都不补请关上方「句尾标点」开关）', 2400);
return;
}
if (del) {
list.splice(idx, 1);
mjfpSet(list);
sync();
mjfpToast('已删除句尾标点 ' + it.s);
return;
}
it.on = it.on === 1 ? 0 : 1;
mjfpSet(list);
sync();
toastSaved('句尾标点 ' + labelOf(it.s), it.on === 1);
});
sync();
const swPunct = document.getElementById('mjf-punct');
if (swPunct) swPunct.addEventListener('change', () => setTimeout(sync, 30));
['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(evN => {
document.addEventListener(evN, () => { try { sync(); } catch (e) {} });
});
})();
(function () {
const DCP_ROWS = [
{ k: 'dc-overall-chat', def: 30, name: '默认聊天字卡·聊天使用' },
{ k: 'qs-prob', def: 25, pre: 'reply-', name: '词典拼字' },
{ k: 'mc-prob-mood', def: 70, name: '情绪卡' },
{ k: 'mc-prob-heart', def: 40, name: '心意卡' },
{ k: 'mc-prob-intent', def: 40, name: '意图卡' },
{ k: 'rcard-prob', def: 30, name: '回应字卡·整条替换' },
{ k: 'cf-prob', def: 20, pre: 'reply-', name: '回应字卡·连接词追加' },
{ k: 'tm-prob', def: 15, name: 'TA的心情' },
{ k: 'ta-ask-prob', def: 5, blob: 'ta-ask', name: 'TA的询问' },
{ k: 'tc-prob', def: 5, blob: 'ta-choose', name: 'TA的小问题' },
{ k: 'tcu-prob', def: 5, blob: 'ta-curious', name: 'TA的好奇' },
{ k: 'tr-prob', def: 5, blob: 'ta-roast', name: 'TA的吐槽' },
{ k: 'ckq-prob', def: 2, pre: 'reply-', name: 'TA的查岗' },
{ k: 'ai-rps-prob', def: 8, pre: 'reply-', name: '猜拳邀请' },
{ k: 'ai-game-prob', def: 5, pre: 'reply-', name: '游戏邀请' },
{ k: 'ai-cuddle-prob', def: 5, pre: 'reply-', name: '贴贴邀请' }
];
const dcpSyncFns = [];
function dcpToast(msg) {
try {
const d = ccToastEnsure();
if (!d) return;
d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show';
clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 1800);
} catch (e) {}
}
function dcpRowGet(r) {
try {
if (r.blob) {
let d = null;
try { d = JSON.parse(ls.get(r.blob) || 'null'); } catch (e) { d = null; }
const s = d && d.settings ? d.settings : null;
return (s && typeof s.prob === 'number' && isFinite(s.prob)) ? s.prob : r.def;
}
const v = ls.get((r.pre || '') + r.k);
if (v === null || v === undefined || v === '') return r.def;
const n = Number(v);
return isNaN(n) ? r.def : Math.max(0, Math.min(100, n));
} catch (e) { return r.def; }
}
function dcpRowSet(r, nv) {
nv = Math.max(0, Math.min(100, Math.round(Number(nv) || 0)));
try {
if (r.blob) {
let d = null;
try { d = JSON.parse(ls.get(r.blob) || 'null'); } catch (e) { d = null; }
if (!d || typeof d !== 'object') d = { settings: {} };
if (!d.settings || typeof d.settings !== 'object') d.settings = {};
d.settings.prob = nv;
ls.set(r.blob, JSON.stringify(d));
} else {
ls.set((r.pre || '') + r.k, String(nv));
}
} catch (e) {}
}
function dcpSyncUI() {
DCP_ROWS.forEach(r => {
const val = document.getElementById('dcp-' + r.k + '-val');
if (val) val.value = String(dcpRowGet(r));
document.querySelectorAll('#page-reply-settings .stepper[data-k="' + r.k + '"] input.stp-val').forEach(el => { el.value = String(dcpRowGet(r)); });
});
const tg1 = document.getElementById('dcp-tg-quote');
if (tg1) { try { tg1.checked = ls.get('quote-cards-default') !== '0'; } catch (e) {} }
const tg2 = document.getElementById('dcp-tg-loc');
if (tg2) { try { tg2.checked = ls.get('loc-lib-default') !== '0'; } catch (e) {} }
dcpSyncFns.forEach(fn => { try { fn(); } catch (e) {} });
}
DCP_ROWS.forEach(r => {
const st = document.getElementById('dcp-' + r.k);
if (!st) return;
const mn = st.querySelector('.stp-min');
const mx = st.querySelector('.stp-max');
const cur = function () {
const val = st.querySelector('input.stp-val');
const n = val ? parseInt(val.value, 10) : NaN;
return isNaN(n) ? dcpRowGet(r) : n;
};
if (mn) mn.addEventListener('click', () => { dcpRowSet(r, cur() - 5); dcpSyncUI(); dcpToast('已保存：' + r.name + ' ' + dcpRowGet(r) + '%'); });
if (mx) mx.addEventListener('click', () => { dcpRowSet(r, cur() + 5); dcpSyncUI(); dcpToast('已保存：' + r.name + ' ' + dcpRowGet(r) + '%'); });
});
[['dcp-tg-quote', 'quote-cards-default', '桌面今日情话·系统预设'], ['dcp-tg-loc', 'loc-lib-default', 'TA在身边位置卡·系统预设']].forEach(t => {
const el = document.getElementById(t[0]);
if (!el) return;
el.addEventListener('change', () => {
try { ls.set(t[1], el.checked ? '1' : '0'); } catch (e) {}
dcpToast('已保存：' + t[2] + '（' + (el.checked ? '开' : '关') + '）');
});
});
const expRow = document.getElementById('dcp-fun-expander-row');
const expBox = document.getElementById('dcp-fun-box');
if (expRow && expBox) {
const arrow = document.getElementById('dcp-fun-expander-arrow');
let open = false;
try { open = ls.get('reply-dcp-fun-open') === '1'; } catch (e) {}
const applyOpen = function () {
expBox.hidden = !open;
if (arrow) arrow.textContent = open ? '▴' : '▾';
};
expRow.addEventListener('click', function () {
open = !open;
try { ls.set('reply-dcp-fun-open', open ? '1' : '0'); } catch (e) {}
applyOpen();
});
applyOpen();
}
window.__dcpSyncUI = dcpSyncUI;
dcpSyncUI();
['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(ev => {
document.addEventListener(ev, () => { try { dcpSyncUI(); } catch (e) {} });
});
const genRow = document.getElementById('row-general');
if (genRow) genRow.addEventListener('click', () => { try { dcpSyncUI(); } catch (e) {} });
})();
(function () {
const IC_LABEL = { '0': '原频率', '1': '稍安静', '2': '安静', '3': '很安静' };
const IC_PILLS = [
{ label: '原频率', value: '0' }, { label: '稍安静', value: '1' },
{ label: '安静', value: '2' }, { label: '很安静', value: '3' }
];
const IC_DETAIL = '聊天里 TA 主动发的卡与邀请多久来一次，按这一档整体往下调（没有比「原频率」更高的档）。'
+ '覆盖：五类提问卡（询问 / 小问题 / 好奇 / 吐槽 / 分享你的字卡）、邀请三类（猜拳 / 游戏 / 贴贴）、音乐「一起去听」邀请。'
+ '不影响查岗自己的开关 / 概率 / 冷却，也不影响你自己发的卡。'
+ '\n\n· 原频率：全部 ×1，完全保持现在的节奏（默认）；'
+ '\n· 稍安静：概率 ×0.6、提问卡冷却 ×1.5、跨类型间隔 ×1.5；'
+ '\n· 安静：概率 ×0.4、提问卡冷却 ×2、跨类型间隔 ×2；'
+ '\n· 很安静：概率 ×0.2、提问卡冷却 ×3、跨类型间隔 ×3。'
+ '\n\n「概率」是在各类型自己的触发概率（默认 5%，可在【字卡与概率】子面板或 字卡库 对应页单独调）与「整体概率（总档）」之上再乘一个倍数；'
+ '「跨类型间隔」＝任意一张提问卡发出后、其余类型多久内不再自动触发（基准 60 分钟）。'
+ '原值 ≥1% 时不会被档位抹成 0（选「很安静」也不会变成永不触发）。'
+ '\n\n按联系人桌面独立保存，选档后即时生效。想完全不触发：把【字卡与概率】里的四类概率或总档调到 0，或关掉 字卡库 里对应页的开关。';
function icVal() {
let v = 0;
try { v = Number((window.replyCfg && window.replyCfg())['ic-freq']); } catch (e) {}
return (v >= 0 && v <= 3) ? String(v) : '0';
}
function icSync() {
const btn = document.getElementById('ic-freq-btn');
if (!btn) return;
const v = icVal();
btn.textContent = IC_LABEL[v];
btn.dataset.v = v;
}
function icToast(msg) {
try {
const d = ccToastEnsure();
if (!d) return;
d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show';
clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, 1800);
} catch (e) {}
}
const rpsTabs = document.querySelector('#page-reply-settings .rps-tabs');
const rpsHost = rpsTabs ? rpsTabs.parentNode : null;
if (rpsTabs && rpsHost) {
const tab = document.createElement('button');
tab.type = 'button';
tab.className = 'rps-tab';
tab.setAttribute('data-rps', 'interact');
tab.textContent = '互动频率';
rpsTabs.appendChild(tab);
const panel = document.createElement('div');
panel.className = 'rps-panel';
panel.setAttribute('data-rps', 'interact');
panel.hidden = true;
const group = document.createElement('div');
group.className = 'set-group glass';
group.id = 'ic-freq-group';
const title = document.createElement('div');
title.className = 'gs-title';
title.textContent = '互动卡频率';
group.appendChild(title);
const row = document.createElement('div');
row.className = 'gs-row';
row.id = 'ic-freq-row';
row.innerHTML = '<span>联系人主动发卡/邀请的频率<span class="tag" id="ic-freq-tag" role="button" tabindex="0" aria-haspopup="dialog">功能说明</span></span>'
+ '<div class="gs-pick" id="ic-freq-btn" data-v="0">原频率</div>';
group.appendChild(row);
const sub = document.createElement('div');
sub.className = 'gs-sub';
sub.id = 'ic-freq-sub';
sub.textContent = 'TA 在聊天里主动发的卡与邀请（提问卡五类：询问/小问题/好奇/吐槽/分享你的字卡；邀请三类：猜拳/游戏/贴贴；音乐「一起去听」）整体频率；「原频率」＝完全保持现在的节奏，往右都是调低。各类互动卡的单项概率在【字卡与概率】里逐项调。点右侧档位切换。';
group.appendChild(sub);
panel.appendChild(group);
rpsHost.insertBefore(panel, rpsTabs.nextSibling);
const btn = document.getElementById('ic-freq-btn');
if (btn && window.openModal) {
btn.addEventListener('click', function () {
window.openModal('互动卡频率', '', function (v) {
const n = Number(v);
if (!(n >= 0 && n <= 3)) return;
window.saveReplyCfg('ic-freq', n);
icSync();
icToast('已设置：互动卡频率＝' + IC_LABEL[String(n)]);
}, { noInput: true, pill: icVal(), pills: IC_PILLS });
});
}
const tag = document.getElementById('ic-freq-tag');
if (tag && window.openModal) {
const showDetail = function (e) {
if (e) { e.stopPropagation(); e.preventDefault(); }
window.openModal('互动卡频率', '', function () {}, { noInput: true, staticText: IC_DETAIL });
};
tag.addEventListener('click', showDetail);
tag.addEventListener('keydown', function (e) {
if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(); }
});
}
icSync();
['contact-switched', 'mochi-restore-done', 'mochi-wrj-heal'].forEach(ev => {
document.addEventListener(ev, () => { try { icSync(); } catch (e) {} });
});
const genRow2 = document.getElementById('row-general');
if (genRow2) genRow2.addEventListener('click', () => { try { icSync(); } catch (e) {} });
}
})();
function replyStoreFor(k) {
if (k.indexOf('gc-') === 0) { try { return window.xyStore ? window.xyStore('xy-home-v2') : null; } catch (e) { return null; } }
return ls;
}
function replyFullKey(k) { return (k.indexOf('gc-') === 0 ? 'reply-gc-' : 'reply-') + k; }
function replyKeyUnvouched(k) {
const st = replyStoreFor(k);
try { if (st && typeof st.awaitingBigKey === 'function' && st.awaitingBigKey(replyFullKey(k))) return true; } catch (e) {}
try {
if (!sessionSavedKeys.has(k) && window.mochiDataPending && window.mochiDataPending()) return true;
} catch (e) {}
return false;
}
function replyAskRehydrate(k) {
const st = replyStoreFor(k);
try { if (st && st.requestBigKey) st.requestBigKey(replyFullKey(k)); } catch (e) {}
}
function replyBlockedToast() {
toastReply('部分设置这次没读全（存储正忙），先不覆盖：等几秒再点一次保存即可，不需要重新设置', 3200);
}
function saveCurrentReplyPage() {
const skipped = []; // #1511：读数未确认的键（这格此刻可能是默认/旧账），不拿屏面值顶库
try {
document.querySelectorAll('#page-reply-settings .stepper, #page-call-settings .stepper').forEach(st => {
const k = st.dataset.k;
if (!k) return; // #518：分类档自定义行无 data-k，跳过防 reply-undefined 落盘
const val = st.querySelector('input.stp-val');
if (k && val) {
if (replyKeyUnvouched(k)) { skipped.push(k); return; } // #1511：这格读数未确认，不拿屏面值顶库
const intAttr = (name, def) => { const v = parseInt(st.getAttribute(name), 10); return Number.isNaN(v) ? def : v; };
const min = intAttr('data-min', 0);
const max = intAttr('data-max', Infinity);
let v = parseFloat(val.value);
if (!isFinite(v)) v = min;
v = Math.min(max, Math.max(min, v));
window.saveReplyCfg(k, v);
}
});
['py-en', 'py-punct-en', 'as-en', 'dnd-en', 'as-badge', 'as-badge-heart', 'as-badge-star', 'as-badge-moon', 'as-badge-spark', 'as-badge-paw', 'as-badge-rand', 'ml-kaomoji-en', 'ml-emoji-en', 'ml-sticker-en', 'cs-normal', 'cs-trigger-name', 'cs-trigger-bar', 'gc-cs-normal', 'gc-cs-trigger-name', 'gc-cs-trigger-bar', 'gc-py-en', 'ai-rps-en', 'ai-game-en', 'ai-cuddle-en', 'ai-cc-en', 'ckq-en', 'call-resume', 'call-no-hangup', 'ml-write-en', 'ml-fish-week-en', 'ml-punct-en', 'fd-post-en', 'fd-punct-en', 'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en', 'qs-en', 'qs-cc', 'qs-one', 'qs-multi', 'qs-noLimit', 'mjf-en', 'mjf-src-cc', 'mjf-src-def', 'mjf-src-dict', 'mjf-mix', 'mjf-punct', 'rc-en', 'rl-en', 'fish-en', 'work-en', 'fish-grab-en', 'rp-thx-en', 'turn-en', 'gc-turn-en'].forEach(k => {
const el = document.getElementById(k);
if (el) {
if (replyKeyUnvouched(k)) { if (skipped.indexOf(k) < 0) skipped.push(k); return; } // #1511：同上，读数未确认不落笔
window.saveReplyCfg(k, el.checked ? 1 : 0);
}
});
} catch (e) {}
return skipped;
}
function toastReply(msg, ms) {
const d = ccToastEnsure();
if (d) { d.textContent = msg; d.className = 'cc-toast'; void d.offsetWidth; d.className = 'cc-toast show'; clearTimeout(d._timer); d._timer = setTimeout(() => { d.className = 'cc-toast'; }, ms || 2000); }
}
const saveBtn = document.getElementById('reply-save-btn');
if (saveBtn) {
saveBtn.addEventListener('click', () => {
const skipped = saveCurrentReplyPage();
if (skipped && skipped.length) {
replyAskRehydrate(skipped[0]);
replyBlockedToast();
return;
}
toastReply('已保存全部回复设置');
});
}
function saveAllContactsDo() {
const skipped = saveCurrentReplyPage();
if (skipped && skipped.length) {
replyAskRehydrate(skipped[0]);
replyBlockedToast();
return;
}
let count = 0;
try {
if (window.getContacts && window.storeFor) {
const cfg = getCfg();
const cids = [window.__activeCid || 'default'];
(window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
Object.keys(DEFAULTS).forEach(k => {
if (k.indexOf('gc-') === 0) return;
cids.forEach(cid => {
try { window.storeFor(cid).set('reply-' + k, String(cfg[k])); } catch (e) {}
});
});
count = cids.length;
}
} catch (e) {}
toastReply(count > 1 ? '已保存并同步到全部 ' + count + ' 个桌面联系人' : '已保存全部回复设置', 2400);
}
const saveAllBtn = document.getElementById('reply-save-all-btn');
if (saveAllBtn) {
saveAllBtn.addEventListener('click', () => {
if (!window.openModal) { saveAllContactsDo(); return; }
const ctl = window.openModal('保存全部桌面联系人设置？', '', (v) => {
if (v !== 'ok') return;
saveAllContactsDo();
}, {
noInput: true, pillSubmit: true,
staticText: '将把当前桌面联系人的回复设置（回复概率/速度/各类互动开关等）同步写入全部桌面联系人，各桌面现有的回复设置会被覆盖。',
pills: [{ label: '确定保存', value: 'ok' }]
});
if (ctl && ctl.pills) ctl.pills([{ label: '确定保存', value: 'ok' }], 'ok');
});
}
try {
document.addEventListener('mochi-restore-done', () => {
const page = document.getElementById('page-reply-settings');
if (page && !page.hidden) syncUI();
});
} catch (e) {}
syncUI();
const genRow = document.getElementById('row-general');
if (genRow) {
genRow.addEventListener('click', () => {
syncUI();
showPage('page-reply-settings');
});
}
const rpTab = (k) => {
document.querySelectorAll('#page-reply-settings .fav-tab[data-rp]').forEach(x => x.classList.toggle('sel', x.dataset.rp === k));
document.querySelectorAll('#page-reply-settings .gs-panel').forEach(p => { p.hidden = p.dataset.rpanel !== k; });
};
document.querySelectorAll('#page-reply-settings .fav-tab[data-rp]').forEach(tab => {
tab.addEventListener('click', () => rpTab(tab.dataset.rp));
});
const rpsTab = (k) => {
document.querySelectorAll('#page-reply-settings .rps-tab').forEach(x => x.classList.toggle('sel', x.dataset.rps === k));
document.querySelectorAll('#page-reply-settings .rps-panel').forEach(p => { p.hidden = p.dataset.rps !== k; });
const sc = document.querySelector('#page-reply-settings .gs-scroll');
if (sc) sc.scrollTop = 0;
};
document.querySelectorAll('#page-reply-settings .rps-tab').forEach(tab => {
tab.addEventListener('click', () => rpsTab(tab.dataset.rps));
});
const replyBack = document.getElementById('reply-back');
if (replyBack) {
replyBack.addEventListener('click', () => {
showPage('page-setting');
});
}
const calsBack = document.getElementById('cals-back');
if (calsBack) {
calsBack.addEventListener('click', () => {
showPage('page-setting');
});
}
function migrateCkqProbOld() {
try {
if (!window.getContacts || !window.storeFor) return;
const cids = [window.__activeCid || 'default'];
(window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
let changed = false;
cids.forEach(cid => {
try {
const s = window.storeFor(cid);
if (!s) return;
const v = s.get('reply-ckq-prob');
if (String(v) === '8') { s.set('reply-ckq-prob', '2'); changed = true; }
} catch (e) {}
});
if (changed) {
try { if (window.console && console.log) console.log('[reply-settings] 已迁移跨桌面查岗旧概率 8→2'); } catch (e) {}
}
} catch (e) {}
}
migrateCkqProbOld();
function migrateMailMaxOld() {
try {
if (!window.getContacts || !window.storeFor) return;
const cids = [window.__activeCid || 'default'];
(window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
const pairs = [['reply-ml-write-max', '480'], ['reply-ml-reply-max', '480']];
let changed = false;
cids.forEach(cid => {
try {
const s = window.storeFor(cid);
if (!s) return;
pairs.forEach(([k, nv]) => {
if (String(s.get(k)) === '120') { s.set(k, nv); changed = true; }
});
} catch (e) {}
});
if (changed) {
try { if (window.console && console.log) console.log('[reply-settings] 已迁移信箱最长写信/回信时间旧值 120→480'); } catch (e) {}
}
} catch (e) {}
}
migrateMailMaxOld();
function migrateQsCcOld() {
try {
if (!window.getContacts || !window.storeFor) return;
const cids = [window.__activeCid || 'default'];
(window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
let changed = false;
cids.forEach(cid => {
try {
const s = window.storeFor(cid);
if (!s) return;
if (String(s.get('reply-qs-cc-migrated')) !== '1') return;
if (String(s.get('reply-qs-cc')) === '0') { s.set('reply-qs-cc', '1'); changed = true; }
s.set('reply-qs-cc-migrated', '2');
} catch (e) {}
});
if (changed) {
try { if (window.console && console.log) console.log('[reply-settings] 已反向迁移词典拼字混用自定义字卡 0→1（#310 存量补迁，#388）'); } catch (e) {}
}
} catch (e) {}
}
migrateQsCcOld();
function migrateQsNoLimitOld() {
try {
if (!window.getContacts || !window.storeFor) return;
const cids = [window.__activeCid || 'default'];
(window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
let changed = false;
cids.forEach(cid => {
try {
const s = window.storeFor(cid);
if (!s) return;
if (String(s.get('reply-qs-nl-migrated')) === '1') return;
if (String(s.get('reply-qs-noLimit')) === '1') { s.set('reply-qs-noLimit', '0'); changed = true; }
s.set('reply-qs-nl-migrated', '1');
} catch (e) {}
});
if (changed) {
try { if (window.console && console.log) console.log('[reply-settings] 已迁移逐卡连发不受条数限制旧默认 1→0（#443）'); } catch (e) {}
}
} catch (e) {}
}
migrateQsNoLimitOld();
function migrateQsNoLimitBack() {
try {
if (!window.getContacts || !window.storeFor) return;
const cids = [window.__activeCid || 'default'];
(window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
let changed = false;
cids.forEach(cid => {
try {
const s = window.storeFor(cid);
if (!s) return;
if (String(s.get('reply-qs-nl-migrated')) !== '1') return;
if (String(s.get('reply-qs-noLimit')) === '0') { s.set('reply-qs-noLimit', '1'); changed = true; }
s.set('reply-qs-nl-migrated', '2');
} catch (e) {}
});
if (changed) {
try { if (window.console && console.log) console.log('[reply-settings] 已反向迁移逐卡连发不受条数限制 0→1（#443 存量补迁，#644）'); } catch (e) {}
}
} catch (e) {}
}
migrateQsNoLimitBack();
function migrateMjfOn() {
try {
if (!window.getContacts || !window.storeFor) return;
const cids = [window.__activeCid || 'default'];
(window.getContacts() || []).forEach(c => { if (c.id && cids.indexOf(c.id) === -1) cids.push(c.id); });
const changed = [];
cids.forEach(cid => {
try {
const s = window.storeFor(cid);
if (!s) return;
if (String(s.get('reply-mjf-on-migrated')) === '1') return;
['mjf-en', 'mjf-mix'].forEach(k => {
if (String(s.get('reply-' + k)) === '0') { s.set('reply-' + k, '1'); changed.push(cid + ':' + k); }
});
s.set('reply-mjf-on-migrated', '1');
} catch (e) {}
});
if (changed.length) {
try { if (window.console && console.log) console.log('[reply-settings] 已迁移梦角自由造句/混合模式旧默认 0→1（#513）：' + changed.join(', ')); } catch (e) {}
}
} catch (e) {}
}
migrateMjfOn();
function rgToday() {
const d = new Date();
return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function rgDone() {
try { return ls.get('reply-guide-done') === '1'; } catch (e) { return false; }
}
window.replyGuideHint = function (kind) {
try {
const pg = document.getElementById('page-chat');
if (!pg || pg.hidden) return;
if (rgDone()) return;
let shownDay = '';
try { shownDay = ls.get('reply-guide-day'); } catch (e) {}
if (shownDay === rgToday()) return; // 今天已弹过，同日不再打扰
try { ls.set('reply-guide-day', rgToday()); } catch (e) {}
let bar = document.getElementById('reply-guide-hint');
if (!bar) {
bar = document.createElement('div');
bar.id = 'reply-guide-hint';
bar.innerHTML = '<span class="rgh-txt"></span><span class="rgh-go">去调整</span>';
bar.addEventListener('click', () => {
try { ls.set('reply-guide-done', '1'); } catch (e) {}
clearTimeout(bar._rgT);
bar.classList.remove('show');
const tab = document.querySelector('.tab[data-page="page-setting"]');
if (tab) tab.click();
const genRow = document.getElementById('row-general');
if (genRow) genRow.click();
});
document.body.appendChild(bar);
}
const txt = bar.querySelector('.rgh-txt');
if (txt) {
txt.textContent = kind === 'py' ? 'TA 一次连发多条是随机概率触发的，嫌频繁可在「设置 → 回复设置」调低或关闭'
: kind === 'inv' ? 'TA 的互动邀请是随机概率触发的，可在「设置 → 回复设置」调低或关闭'
: 'TA 的主动消息是随机概率触发的，嫌频繁可在「设置 → 回复设置」调低或关闭';
}
bar.classList.add('show');
clearTimeout(bar._rgT);
bar._rgT = setTimeout(() => { try { bar.classList.remove('show'); } catch (e) {} }, 12000);
} catch (e) {}
};
const rgGenRow = document.getElementById('row-general');
if (rgGenRow) rgGenRow.addEventListener('click', () => { try { ls.set('reply-guide-done', '1'); } catch (e) {} });
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("reply-settings.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("reply-settings.js"); try { console.error("[JS] reply-settings.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[reply-settings.js] " + String(__e && __e.message || __e)); } })();
(function () { try {
(function () {
const G = 'xy-home-v2:';
const MARK = G + '__guide-done';
const SYS = [MARK, G + '__onboard-done', G + '__edge-backup-hint-done', G + '__last-backup', G + '__last-backup-remind', G + '__auto-backup-snapshot'];
function isFreshEnv() {
try {
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || k.indexOf(G) !== 0) continue;
if (SYS.indexOf(k) >= 0) continue;
return false; // 有任何业务数据键 → 老环境
}
return true;
} catch (e) { return false; }
}
function splashGone() {
const s = document.getElementById('splash');
return !s || !s.isConnected || s.classList.contains('hide');
}
function modalOpen() {
try {
const m = document.getElementById('modal-mask');
if (m && !m.hidden) return true;
const qa = document.getElementById('qa-mask');
if (qa && !qa.hidden) return true;
} catch (e) {}
return false;
}
function markDone() { try { localStorage.setItem(MARK, String(Date.now())); } catch (e) {} }
const st = document.createElement('style');
st.textContent =
'.mg-guide-mask{position:fixed;inset:0;z-index:96;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:18px;-webkit-tap-highlight-color:transparent}' +
'.mg-guide-mask[hidden]{display:none}' +
'.mg-guide{width:min(340px,100%);max-height:82vh;overflow-y:auto;background:var(--card-bg,#fff);color:var(--ink,#111);border-radius:18px;padding:18px 16px 16px;box-shadow:0 14px 40px rgba(0,0,0,.3)}' +
'.mg-guide-t{font-size:16px;font-weight:800;text-align:center;margin-bottom:3px}' +
'.mg-guide-sub{font-size:12px;color:var(--muted,#888);text-align:center;margin-bottom:14px}' +
'.mg-guide-step{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-radius:12px;background:rgba(0,0,0,.04);margin-bottom:9px;cursor:pointer}' +
'.mg-guide-step:active{transform:scale(.98)}' +
'.mg-guide-n{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--ink,#111);color:var(--card-bg,#fff);font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px}' +
'.mg-guide-b{flex:1;min-width:0;display:block}' +
'.mg-guide-h{display:block;font-size:13.5px;font-weight:700;margin-bottom:2px}' +
'.mg-guide-d{display:block;font-size:12px;line-height:1.6;color:var(--muted,#777)}' +
'.mg-guide-go{flex:0 0 auto;font-size:12px;font-weight:700;color:#2f6fd0;align-self:center}' +
'.mg-guide-foot{display:flex;gap:9px;margin-top:12px}' +
'.mg-guide-btn{flex:1;text-align:center;padding:11px;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer}' +
'.mg-guide-btn.primary{background:var(--ink,#111);color:var(--card-bg,#fff)}' +
'.mg-guide-btn.ghost{background:rgba(0,0,0,.06);color:var(--ink,#111)}' +
'[data-theme="dark"] .mg-guide-step{background:rgba(255,255,255,.07)}' +
'[data-theme="dark"] .mg-guide-btn.ghost{background:rgba(255,255,255,.1)}' +
'[data-theme="dark"] .mg-guide-go{color:#8fb4ef}' +
'.mg-guide-warn{display:block;margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(214,132,60,.13);color:#9a5520;font-size:11.5px;line-height:1.6}' +
'[data-theme="dark"] .mg-guide-warn{background:rgba(214,132,60,.18);color:#e4ae7f}' +
'.mg-guide-tip{display:block;margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(47,111,208,.1);color:#2f6fd0;font-size:11.5px;line-height:1.6}' +
'[data-theme="dark"] .mg-guide-tip{background:rgba(47,111,208,.16);color:#8fb4ef}';
document.head.appendChild(st);
const STEPS = [
{ n: '1', h: '设置「我」和「TA」', d: '回桌面，点顶部两个头像 / 昵称，即可改名、换头像（这里是桌面那一套）。',
warn: '桌面的昵称 / 头像与聊天里的是<b>两套、互不同步</b>：桌面改完，聊天里仍显示默认「我」「TA」；聊天里的名字和头像要在「聊天页右上角 → 聊天设置 → 形象」里单独设置。',
tip: '聊天头像和聊天昵称另有一条快路：聊天输入栏左边的「更多功能」（⋯）→ 互动类 → <b>头像和昵称互动</b>——头像可上传多张头像库、点库里的图即换；昵称可存多个文字昵称、点名字即换；两边都能开「TA 随机更换 / TA 主动给我换」（每 1-8 小时一次）。',
go: 'name' },
{ n: '2', h: '先添加字卡', d: '底部「字卡库」→ 公用字卡 / 专属字卡 添加或导入；不加字卡，TA 就没有话可说。', go: 'cards' },
{ n: '3', h: '开始聊天', d: '回桌面点「聊天」图标，随便发一条消息试试（TA 会按概率回复）。', go: 'chat' }
];
let mask = null, built = false;
function build() {
if (built) return;
built = true;
mask = document.createElement('div');
mask.className = 'mg-guide-mask';
mask.hidden = true;
const box = document.createElement('div');
box.className = 'mg-guide';
let html = '<div class="mg-guide-t">新手上路 · 3 步就能用</div><div class="mg-guide-sub">点任意一步可直接跳到对应位置</div>';
STEPS.forEach(function (s) {
html += '<div class="mg-guide-step" data-gstep="' + s.go + '">'
+ '<span class="mg-guide-n">' + s.n + '</span>'
+ '<span class="mg-guide-b"><span class="mg-guide-h">' + s.h + '</span><span class="mg-guide-d">' + s.d + '</span>'
+ (s.warn ? '<span class="mg-guide-warn">' + s.warn + '</span>' : '')
+ (s.tip ? '<span class="mg-guide-tip">' + s.tip + '</span>' : '')
+ '</span>'
+ '<span class="mg-guide-go">去 →</span></div>';
});
html += '<div class="mg-guide-foot"><div class="mg-guide-btn primary" data-gact="done">知道了，开始用</div><div class="mg-guide-btn ghost" data-gact="close">以后再说</div></div>';
box.innerHTML = html;
mask.appendChild(box);
document.body.appendChild(mask);
box.addEventListener('click', function (e) {
const t = e.target;
const step = t && t.closest ? t.closest('[data-gstep]') : null;
if (step) { const g = step.getAttribute('data-gstep'); close(); goStep(g); return; }
const act = t && t.closest ? t.closest('[data-gact]') : null;
if (act) close();
});
mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
}
function close() { if (mask) mask.hidden = true; markDone(); }
function goStep(go) {
try {
const phone = document.querySelector('.tab[data-page="page-phone"]');
if (go === 'name') { if (phone) phone.click(); return; }
if (go === 'chat') {
if (phone) phone.click();
const c = document.querySelector('.app[data-app="chat"]');
if (c) c.click();
return;
}
if (go === 'cards') {
const tab = document.querySelector('.tab[data-page="page-chatcard"]');
if (tab) tab.click();
const li = document.getElementById('li-custom-cards-public') || document.getElementById('li-custom-cards');
if (li) li.click();
return;
}
} catch (e) {}
}
window.openMochiGuide = function () { build(); mask.hidden = false; };
let shown = false;
const poll = setInterval(function () {
if (shown) { clearInterval(poll); return; }
if (!window.__mochiDataReady || !splashGone()) return;
if (modalOpen()) return; // 等 pwa.js 的「全新环境·导入备份」弹窗先关闭
shown = true; clearInterval(poll);
setTimeout(function () {
try { if (localStorage.getItem(MARK)) return; } catch (e) {}
if (!isFreshEnv()) return; // 老用户不打扰
window.openMochiGuide();
}, 400);
}, 300);
(function injectSettingRow() {
const about = document.querySelector('#page-setting .them-sec[data-sec="about"]');
const guideRow = document.getElementById('row-guide');
const helpGroup = (guideRow && guideRow.closest) ? guideRow.closest('.set-group') : null;
const host = helpGroup || about || document.querySelector('#page-setting .them-sec[data-sec="tools"]');
if (!host) return;
const row = document.createElement('div');
row.className = 'set-row';
row.id = 'row-guidebook';
row.innerHTML = '<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.7-1.5 1.2-1.5 2.2"/><circle cx="12" cy="17" r=".6" fill="#111111"/></svg></div>'
+ '<div class="txt">新手引导<span class="sub">3 步上手：设置昵称头像（桌面 / 聊天分开设）/ 添加字卡 / 开始聊天</span></div>'
+ '<div class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>';
const guideSub = document.getElementById('guide-sub');
if (helpGroup && guideSub && guideSub.parentNode === host) host.insertBefore(row, guideSub);
else host.appendChild(row);
row.addEventListener('click', function () { window.openMochiGuide(); });
})();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("onboarding.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("onboarding.js"); try { console.error("[JS] onboarding.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[onboarding.js] " + String(__e && __e.message || __e)); } })();
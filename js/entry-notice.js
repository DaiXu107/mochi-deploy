(function () { try {
(function () {
'use strict';
var ACK_KEY = 'mochi-entry-ack-v1';
var ACK_VER = '2026-10-18';
var FORCE = false;
try { FORCE = /(^|[?&])entry=(1|preview)(&|$)/.test(location.search); } catch (e) {}
if (!FORCE) {
try {
if (localStorage.getItem(ACK_KEY)) return;
} catch (e) {}
}
var CSS = [
'.en-mask{position:absolute;inset:0;z-index:9990;background:rgba(10,12,20,.46);display:flex;',
'  align-items:center;justify-content:center;padding:22px;-webkit-tap-highlight-color:transparent;',
'  transition:opacity .24s ease;font-family:inherit;}',
'.en-mask.en-out{opacity:0;pointer-events:none;}',
'.en-card{width:min(310px,100%);max-height:78%;overflow:auto;background:var(--card-bg,#fff);',
'  color:var(--ink,#111);border-radius:18px;padding:19px 17px 15px;',
'  box-shadow:0 18px 52px rgba(0,0,0,.35);animation:enIn .28s ease;}',
'@keyframes enIn{from{transform:translateY(10px) scale(.97);opacity:0}to{transform:none;opacity:1}}',
'.en-tt{font-size:16px;font-weight:800;text-align:center;letter-spacing:1px;margin-bottom:3px;}',
'.en-sub{font-size:11px;text-align:center;color:var(--muted,#8a8a8a);margin-bottom:12px;}',
'.en-p{font-size:12.5px;line-height:1.75;}',
'.en-ul{margin:7px 0 10px;padding-left:17px;font-size:12.5px;line-height:1.8;}',
'.en-ul li{margin:3px 0;}',
'.en-ul b{font-weight:800;}',
'.en-note{font-size:10.5px;line-height:1.65;color:var(--muted,#8a8a8a);margin:8px 0 13px;}',
'.en-btn{width:100%;padding:11px 10px;border:0;border-radius:12px;background:var(--ink,#111);',
'  color:var(--card-bg,#fff);font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer;}',
'.en-btn:active{transform:scale(.985);}'
].join('');
function boot() {
if (document.getElementById('entry-notice')) return;
var host = document.querySelector('.phone') || document.body;
if (!host) { setTimeout(boot, 120); return; }
var style = document.createElement('style');
style.id = 'entry-notice-css';
style.textContent = CSS;
document.head.appendChild(style);
var mask = document.createElement('div');
mask.id = 'entry-notice';
mask.className = 'en-mask';
mask.innerHTML =
'<div class="en-card" role="dialog" aria-modal="true" aria-labelledby="en-tt">' +
'<div class="en-tt" id="en-tt">使用须知</div>' +
'<div class="en-sub">Mochi 字卡传讯 · 二改自用版</div>' +
'<div class="en-p">进入即视为你已确认：</div>' +
'<ul class="en-ul">' +
'<li>本人已年满 <b>18 周岁</b>；</li>' +
'<li>清楚本站是「Mochi 字卡传讯」的<b>二改自用版</b>，并非原作者原版；</li>' +
'<li>二改部分禁止商用，本站禁止倒卖。</li>' +
'</ul>' +
'<div class="en-note">完整免责声明可在「设置 → 安全与关于 → 查看公告与免责声明」随时查看。</div>' +
'<button class="en-btn" id="entry-notice-ok" type="button">我已满 18 周岁 · 进入</button>' +
'</div>';
host.appendChild(mask);
window.__entryNoticeOpen = true;
var btn = document.getElementById('entry-notice-ok');
function close() {
if (!mask.isConnected) return;
try { localStorage.setItem(ACK_KEY, JSON.stringify({ t: Date.now(), v: ACK_VER })); } catch (e) {}
window.__entryNoticeOpen = false;
mask.classList.add('en-out');
setTimeout(function () {
if (mask.parentNode) mask.parentNode.removeChild(mask);
if (style.parentNode) style.parentNode.removeChild(style);
}, 260);
try { document.dispatchEvent(new Event('mochi-entry-ack')); } catch (e) {}
}
btn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); close(); });
}
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 250); });
} else {
setTimeout(boot, 250);
}
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("entry-notice.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("entry-notice.js"); try { console.error("[JS] entry-notice.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[entry-notice.js] " + String(__e && __e.message || __e)); } })();
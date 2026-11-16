(function () { try {
/* ===== 主页应用合并（src/js/app-merge.js）=====
把成对的功能收进一个桌面图标，页内用顶部胶囊切换：
· 记账 ↔ 存钱罐
· 梦角档案 ↔ 我的档案
· 心意市集 ↔ 心意柜
次级图标不删除，只隐藏——各模块的事件监听仍挂在原元素上，胶囊按钮直接 .click()
沿用各模块自己的打开逻辑（动态页面/异步渲染/返回逻辑都不用改）。
加载顺序放在所有模块之后（build.mjs jsFiles 末尾）。
*/
(function () {
'use strict';
var PAIRS = [
{ key: 'money', primary: 'accounting', secondary: 'piggy', primaryName: '账房', primaryLabel: '记账', secondaryLabel: '存钱罐', primaryPage: 'page-accounting', secondaryPage: 'page-piggy' },
{ key: 'arc', primary: 'memo-arc', secondary: 'my-arc', primaryName: '档案', primaryLabel: '梦角档案', secondaryLabel: '我的档案', primaryPage: 'page-memo-arc', secondaryPage: 'page-my-arc' },
{ key: 'gift', primary: 'market', secondary: 'giftbox', primaryName: '心意', primaryLabel: '心意市集', secondaryLabel: '心意柜', primaryPage: 'page-market', secondaryPage: 'page-giftbox' }
];
var refs = {};
var barSeq = 0;
function findApp(id) { return document.querySelector('.app[data-app="' + id + '"]'); }
function makeBar(p, activeIndex) {
var bar = document.createElement('div');
bar.className = 'app-merge-tabs';
bar.dataset.merge = p.key;
bar.setAttribute('role', 'tablist');
[p.primaryLabel, p.secondaryLabel].forEach(function (label, i) {
var b = document.createElement('button');
b.type = 'button';
b.setAttribute('role', 'tab');
b.className = i === activeIndex ? 'on' : '';
b.textContent = label;
b.addEventListener('click', function (e) {
e.stopPropagation();
if (i === activeIndex) return;
var pairRef = refs[p.key];
var target = i === 0 ? (pairRef && pairRef.primary) : (pairRef && pairRef.secondary);
if (!target) target = findApp(i === 0 ? p.primary : p.secondary);
if (target) target.click();
});
bar.appendChild(b);
});
bar.id = 'app-merge-tabs-' + p.key + '-' + (++barSeq);
return bar;
}
function ensureBar(p, pageEl, activeIndex) {
if (!pageEl || !pageEl.querySelector) return;
if (pageEl.querySelector('.app-merge-tabs[data-merge="' + p.key + '"]')) return;
var bar = makeBar(p, activeIndex);
var head = pageEl.querySelector('.chat-head');
if (head && head.parentNode === pageEl) head.insertAdjacentElement('afterend', bar);
else pageEl.insertBefore(bar, pageEl.firstChild);
}
function run() {
var pending = false;
PAIRS.forEach(function (p) {
var pri = findApp(p.primary);
var sec = findApp(p.secondary);
var pp = document.getElementById(p.primaryPage);
var sp = document.getElementById(p.secondaryPage);
if (!pri || !sec || !pp || !sp) { pending = true; return; }
if (!refs[p.key]) refs[p.key] = { primary: pri, secondary: sec };
if (sec.style.display !== 'none') sec.style.display = 'none';
sec.dataset.appMerged = '1';
var nameEl = pri.querySelector('.app-name');
if (nameEl && nameEl.textContent !== p.primaryName) nameEl.textContent = p.primaryName;
ensureBar(p, pp, 0);
ensureBar(p, sp, 1);
});
if (pending) setTimeout(run, 350);
}
setTimeout(run, 300);
setTimeout(run, 1500);
setTimeout(run, 4000);
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("app-merge.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("app-merge.js"); try { console.error("[JS] app-merge.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[app-merge.js] " + String(__e && __e.message || __e)); } })();
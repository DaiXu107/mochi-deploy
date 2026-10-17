(function () { try {
/* ===== 设置中心（新的设置首页）=====
设计依据：docs/设置信息架构-逻辑表.md
· 按「想干什么」分 6 类，不再按代码模块分
· 能力型条目直接在这里改；长尾条目标注作用域并给跳转
· 频率总控 = 三档滑动条（安静/标准/热闹），单项旋钮全部保留
*/
(function () {
'use strict';
var page = document.getElementById('page-settings-hub');
if (!page) return;
var body = document.getElementById('sh-body');
var searchEl = document.getElementById('sh-search');
/* ---------------- 基础读写 ---------------- */
function cfg() { try { return window.replyCfg ? window.replyCfg() : {}; } catch (e) { return {}; } }
function setCfg(k, v) { try { if (window.saveReplyCfg) window.saveReplyCfg(k, String(v)); } catch (e) {} }
function store() { try { return window.activeStore ? window.activeStore() : null; } catch (e) { return null; } }
function getNum(src, key, def) {
var raw;
if (src === 'cfg') { raw = cfg()[key]; }
else { var s = store(); raw = s ? s.get(key) : null; }
if (raw === null || raw === undefined || raw === '') return def === undefined ? 0 : def;
var n = parseInt(raw, 10);
return isNaN(n) ? (def === undefined ? 0 : def) : n;
}
function setNum(src, key, v) {
if (src === 'cfg') setCfg(key, v);
else { var s = store(); if (s) { try { s.set(key, String(v)); } catch (e) {} } }
}
function toast(m) { try { if (window.toast) window.toast(m); else console.log(m); } catch (e) {} }
function go(id) {
var t = document.getElementById(id);
if (!t) return false;
document.querySelectorAll('.page').forEach(function (p) { p.hidden = (p !== t); });
return true;
}
/* ---------------- 频率总控 ---------------- */
var FREQ_DEFS = [
['as-prob', '主动发送概率', '%', 0, 100, 5],
['as-min', '主动发送最短间隔', '分钟', 1, 180, 1],
['as-max', '主动发送最长间隔', '分钟', 1, 240, 1],
['as-count-min', '每次最少条数', '条', 1, 5, 1],
['as-count-max', '每次最多条数', '条', 1, 10, 1],
['ckq-prob', '查岗概率', '%', 0, 100, 1],
['ckq-cool', '查岗冷却', '分钟', 0, 240, 5],
['ai-rps-prob', '猜拳邀请概率', '%', 0, 100, 1],
['ai-game-prob', '游戏邀请概率', '%', 0, 100, 1],
['ai-cuddle-prob', '贴贴邀请概率', '%', 0, 100, 1],
['fd-post-prob', '朋友圈主动发布概率', '%', 0, 100, 1],
['fd-post-cool', '朋友圈发布冷却', '分钟', 0, 720, 10],
['fd-like-prob', '朋友圈点赞概率', '%', 0, 100, 1],
['fd-comment-prob', '朋友圈评论概率', '%', 0, 100, 1],
['call-incoming', '主动来电概率', '%', 0, 100, 1],
['ml-write-prob', '主动写信概率', '%', 0, 100, 1],
['ml-write-daily-max', '每天最多来信', '封', 0, 20, 1]
];
var ORDER = ['quiet', 'normal', 'lively'];
var PRESETS = {
quiet: {
n: '安静', d: '很少来打扰',
v: { 'as-prob': 10, 'as-min': 30, 'as-max': 90, 'as-count-min': 1, 'as-count-max': 1, 'dnd-en': 1,
'ckq-prob': 1, 'ckq-cool': 120, 'ai-rps-prob': 3, 'ai-game-prob': 2, 'ai-cuddle-prob': 2,
'fd-post-prob': 10, 'fd-post-cool': 180, 'fd-like-prob': 30, 'fd-comment-prob': 40,
'call-incoming': 5, 'ml-write-prob': 10, 'ml-write-daily-max': 1 }
},
normal: {
n: '标准', d: '默认节奏',
v: { 'as-prob': 30, 'as-min': 5, 'as-max': 10, 'as-count-min': 1, 'as-count-max': 2, 'dnd-en': 0,
'ckq-prob': 2, 'ckq-cool': 30, 'ai-rps-prob': 8, 'ai-game-prob': 5, 'ai-cuddle-prob': 5,
'fd-post-prob': 40, 'fd-post-cool': 30, 'fd-like-prob': 60, 'fd-comment-prob': 70,
'call-incoming': 15, 'ml-write-prob': 30, 'ml-write-daily-max': 3 }
},
lively: {
n: '热闹', d: '很主动',
v: { 'as-prob': 60, 'as-min': 2, 'as-max': 6, 'as-count-min': 1, 'as-count-max': 3, 'dnd-en': 0,
'ckq-prob': 5, 'ckq-cool': 15, 'ai-rps-prob': 15, 'ai-game-prob': 10, 'ai-cuddle-prob': 10,
'fd-post-prob': 70, 'fd-post-cool': 10, 'fd-like-prob': 80, 'fd-comment-prob': 85,
'call-incoming': 30, 'ml-write-prob': 50, 'ml-write-daily-max': 5 }
}
};
var PRESET_KEYS = Object.keys(PRESETS.normal.v);
var freqOpen = false;
function presetNow() {
var c = cfg(), hit = '';
ORDER.forEach(function (k) {
if (hit) return;
var v = PRESETS[k].v, same = true;
for (var i = 0; i < PRESET_KEYS.length; i++) {
if (Number(c[PRESET_KEYS[i]]) !== Number(v[PRESET_KEYS[i]])) { same = false; break; }
}
if (same) hit = k;
});
return hit;
}
function applyPreset(k) {
var p = PRESETS[k]; if (!p) return;
Object.keys(p.v).forEach(function (key) { setCfg(key, p.v[key]); });
render();
toast('已套用「' + p.n + '」节奏 · 下面的单项还能继续微调');
}
/* ---------------- 小部件 ---------------- */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function badge(scope) {
if (scope === 'g') return '<em class="sh-badge g">全局</em>';
if (scope === 'p') return '<em class="sh-badge">本联系人</em>';
return '';
}
function valText(v, unit) { return esc(v) + (unit || ''); }
function swRow(label, note, src, key, scope, apply) {
var on = !!getNum(src, key, 0);
return '<div class="sh-row" data-q="' + esc(label + ' ' + note) + '">'
+ '<div class="sh-l"><div class="sh-label">' + esc(label) + badge(scope) + '</div>'
+ '<span class="sh-note">' + esc(note) + '</span></div>'
+ '<i class="sh-sw' + (on ? ' on' : '') + '" data-act="sw" data-src="' + src + '" data-key="' + key + '"'
+ ' data-apply="' + (apply || '') + '"><b></b></i></div>';
}
function stepRow(label, note, src, key, min, max, st, unit, scope, apply, def, q) {
var v = getNum(src, key, def);
return '<div class="sh-row" data-q="' + esc(label + ' ' + note + ' ' + (q || '')) + '">'
+ '<div class="sh-l"><div class="sh-label">' + esc(label) + badge(scope) + '</div>'
+ '<span class="sh-note">' + esc(note) + '</span></div>'
+ '<div class="sh-step" data-act="step" data-src="' + src + '" data-key="' + key + '"'
+ ' data-min="' + min + '" data-max="' + max + '" data-st="' + st + '" data-apply="' + (apply || '') + '">'
+ '<button data-d="-1" type="button">−</button>'
+ '<span class="sh-val">' + valText(v, unit) + '</span>'
+ '<button data-d="1" type="button">+</button></div></div>';
}
/* 三段选择：轨道 + 滑动白片 */
function segRow(label, note, key, opts, cur, scope) {
var idx = 0;
for (var i = 0; i < opts.length; i++) { if (opts[i][0] === cur) { idx = i; break; } }
var b = opts.map(function (o, i) {
return '<button type="button" data-v="' + o[0] + '"' + (i === idx ? ' class="sel"' : '') + '>' + esc(o[1]) + '</button>';
}).join('');
return '<div class="sh-row" data-q="' + esc(label + ' ' + note) + '">'
+ '<div class="sh-l"><div class="sh-label">' + esc(label) + badge(scope) + '</div>'
+ '<span class="sh-note">' + esc(note) + '</span></div>'
+ '<div class="sh-seg2" data-act="seg" data-key="' + key + '">'
+ '<i class="sh-seg2-thumb" style="width:calc((100% - 6px) / ' + opts.length + ');transform:translateX(' + (idx * 100) + '%)"></i>'
+ b + '</div></div>';
}
function navRow(label, note, pageId, opt) {
opt = opt || {};
return '<div class="sh-row" data-nav="' + esc(pageId) + '"'
+ (opt.tab ? ' data-tab="' + esc(opt.tab) + '"' : '')
+ (opt.sel ? ' data-sel="' + esc(opt.sel) + '"' : '')
+ (opt.click ? ' data-click="' + esc(opt.click) + '"' : '')
+ ' data-q="' + esc(label + ' ' + note + ' ' + (opt.q || '')) + '">'
+ '<div class="sh-l"><div class="sh-label">' + esc(label) + badge(opt.scope) + '</div>'
+ '<span class="sh-note">' + esc(note) + '</span></div><i class="sh-chev"></i></div>';
}
/* ---------------- 渲染 ---------------- */
function readTheme() { try { var v = localStorage.getItem('xy-home-v2:theme-mode'); return (v === 'dark' || v === 'auto') ? v : 'light'; } catch (e) { return 'light'; } }
function applyTheme(mode) {
try { localStorage.setItem('xy-home-v2:theme-mode', mode); } catch (e) {}
var eff = mode === 'auto' ? ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light') : mode;
if (eff === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
else document.documentElement.removeAttribute('data-theme');
var l = document.getElementById('theme-mode-val');
if (l) l.textContent = mode === 'auto' ? '跟随系统' : (mode === 'dark' ? '已开启' : '已关闭');
try {
var bg = getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim();
var meta = document.querySelector('meta[name="theme-color"]');
if (bg && meta) meta.setAttribute('content', bg);
} catch (e) {}
toast('外观已切换');
}
function applySpecial(kind) {
if (!kind) return;
if (kind === 'chatfont') { try { if (window.applyChatSettings) window.applyChatSettings(); } catch (e) {} return; }
if (kind === 'deskfont') {
var p = getNum('store', 'desk-font-size', 100);
document.documentElement.style.setProperty('--desk-font-scale', String(p / 100));
var l = document.getElementById('desk-font-size-val');
if (l) l.textContent = p === 100 ? '默认' : p + '%';
}
}
function build() {
var H = [];
function sec(t, note) { H.push('<div class="sh-sec"><span>' + esc(t) + '</span>' + (note ? '<i>' + esc(note) + '</i>' : '') + '</div>'); }
function block(fn) { H.push('<div class="sh-block">'); fn(); H.push('</div>'); }
function group(fn) { H.push('<div class="sh-group">'); fn(); H.push('</div>'); }
/* ---- A 外观 ---- */
block(function () {
sec('外观', '长什么样');
group(function () {
H.push(navRow('字体样式', '打开字体选择器（上传字体 / 输入字体名）', 'page-chat-settings',
{ sel: '#cs-font', q: '字体 字型 字体样式' }));
H.push(stepRow('聊天气泡字号', '聊天里文字的大小', 'store', 'cs-font-size', 11, 30, 1, 'px', 'p', 'chatfont', 14, '字体 字号 大小 文字'));
H.push(stepRow('桌面字号', '桌面图标文字大小（仅桌面/大屏生效）', 'store', 'desk-font-size', 85, 120, 1, '%', 'p', 'deskfont', 100, '字体 字号 大小 文字'));
H.push(segRow('深色模式', '切换深色 / 浅色 / 跟随系统', 'theme',
[['light', '浅色'], ['dark', '深色'], ['auto', '跟随系统']], readTheme(), 'g'));
H.push(navRow('聊天气泡与壁纸', '气泡颜色、透明度、圆角、壁纸', 'page-chat-settings', { q: '气泡 壁纸 聊天美化' }));
H.push(navRow('手机桌面美化', '主题色、图标、壁纸、卡片大小', 'page-theme', { q: '桌面 美化 图标 壁纸' }));
});
});
/* ---- B 聊天与回复 ---- */
block(function () {
sec('聊天与回复', 'TA 怎么说话');
group(function () {
H.push(stepRow('回复速度最短', '你发消息后 TA 最快几秒回', 'cfg', 'rs-min', 1, 60, 1, ' 秒', 'p'));
H.push(stepRow('回复速度最长', '最慢几秒回', 'cfg', 'rs-max', 1, 120, 1, ' 秒', 'p'));
H.push(stepRow('回复条数最少', '每条消息至少回几句', 'cfg', 'reply-min', 1, 10, 1, ' 条', 'p'));
H.push(stepRow('回复条数最多', '最多回几句', 'cfg', 'reply-max', 1, 40, 1, ' 条', 'p'));
H.push(stepRow('已读不回概率', '偶尔只读不回', 'cfg', 'rn-prob', 0, 100, 5, '%', 'p'));
H.push(swRow('主动发送', 'TA 不等你开口也会来找你', 'cfg', 'as-en', 'p'));
H.push(stepRow('主动发送概率', '每轮检查时真的发出来的概率', 'cfg', 'as-prob', 0, 100, 5, '%', 'p'));
H.push(swRow('多字卡回复', '一条回复拆成多张字卡', 'cfg', 'py-en', 'p'));
H.push(navRow('字卡与拼字', '自定义占比、系统字卡概率、词典拼字、自由造句', 'page-reply-settings', { q: '字卡 概率 拼字 造句' }));
H.push(navRow('群聊回复', '群聊里每个联系人的回复参数', 'page-reply-settings', { q: '群聊' }));
H.push(navRow('信箱 / 朋友圈 / 查岗 / 邀请', '各场景的主动行为与节奏', 'page-reply-settings', { q: '信箱 朋友圈 查岗 邀请' }));
});
});
/* ---- C 提醒与打扰 ---- */
block(function () {
sec('提醒与打扰', '什么时候找我');
group(function () {
H.push('<div class="sh-row" data-q="频率 总控 安静 标准 热闹 节奏"><div class="sh-l">'
+ '<div class="sh-label">频率总控' + badge('p') + '</div>'
+ '<span class="sh-note">拖动选择整体节奏；套用后单项仍可微调</span></div></div>');
var now = presetNow();
var idx = now ? ORDER.indexOf(now) : 1;
H.push('<div class="sh-preset-slider">'
+ '<input type="range" min="0" max="2" step="1" value="' + idx + '" data-act="preset-range" aria-label="频率档位">'
+ '<div class="sh-preset-labels">'
+ ORDER.map(function (k, i) {
return '<span data-i="' + i + '"' + (i === idx ? ' class="sel"' : '') + '>' + PRESETS[k].n + '</span>';
}).join('')
+ '</div></div>');
H.push('<div class="sh-freq-desc">当前：' + (now ? PRESETS[now].n + ' · ' + PRESETS[now].d : '自定义（你手动调过单项）') + '</div>');
H.push('<div class="sh-freq-more" data-act="freqmore">' + (freqOpen ? '收起单项' : '展开单项（' + FREQ_DEFS.length + ' 项）') + '</div>');
if (freqOpen) {
H.push('<div class="sh-sub">');
FREQ_DEFS.forEach(function (d) { H.push(stepRow(d[1], '', 'cfg', d[0], d[3], d[4], d[5], d[2], 'p')); });
H.push('</div>');
}
H.push(swRow('免打扰', '放慢主动发送（不静音，只是来得少）', 'cfg', 'dnd-en', 'p'));
H.push(navRow('夜间免打扰', '22:00–07:00 不主动打扰（全局设置）', 'page-setting', { tab: 'basic', scope: 'g', q: '夜间 免打扰 睡眠' }));
H.push(navRow('通知与后台保活', '后台通知、逐条弹、离线提醒、保活', 'page-setting', { tab: 'system', q: '通知 保活 离线' }));
});
});
/* ---- D 功能与开关 ---- */
block(function () {
sec('功能与开关', '有哪些功能');
group(function () {
var F = [
['字卡库', 'page-chatcard'], ['词典', 'page-dict-cards'], ['其他互动字卡', 'page-fun-cards'],
['情绪字卡', 'page-mood-cards'], ['回应字卡', 'page-reply-cards'], ['提问记录', 'page-interact'],
['收藏', 'page-fav'], ['音乐', 'page-music'], ['小屋', 'page-room'],
['花园', 'page-garden'], ['经期', 'page-period'], ['记账', 'page-accounting'],
['信箱', 'page-mail'], ['朋友圈', 'page-feed'], ['群聊', 'page-group-chat'],
['通话设置', 'page-call-settings'], ['音效设置', 'page-sfx-settings']
];
F.forEach(function (f) { H.push(navRow(f[0], '', f[1], { q: '功能 ' + f[0] })); });
H.push(navRow('全部功能总览', '按关键词搜功能在哪', 'page-featurehub', { q: '功能大全 总览' }));
});
});
/* ---- E 数据与备份 ---- */
block(function () {
sec('数据与备份', '我的数据');
group(function () {
H.push(navRow('导出数据', '全站备份（文件）', 'page-setting', { tab: 'basic', click: 'row-export', q: '导出 备份' }));
H.push(navRow('导入数据', '从备份文件恢复', 'page-setting', { tab: 'basic', click: 'row-import', q: '导入 恢复 备份' }));
H.push(navRow('查看存储', '占用多少、能清什么', 'page-storage', { q: '存储 占用 清理' }));
H.push(navRow('各功能数据管理', '逐个功能看/清数据', 'page-feature-data', { q: '数据 管理 清理' }));
H.push(navRow('诊断工具', '设备兼容、屏幕适配、卡顿自检', 'page-setting', { tab: 'diag', q: '诊断 卡顿 屏幕' }));
});
});
/* ---- F 安全与关于 ---- */
block(function () {
sec('安全与关于', '锁与说明');
group(function () {
H.push(navRow('应用锁', '打开 App 需要密码', 'page-setting', { tab: 'system', scope: 'g', q: '应用锁 密码' }));
H.push(navRow('开屏公告', '进入前是否显示', 'page-setting', { tab: 'system', scope: 'g', q: '公告 开屏' }));
H.push(navRow('关于 / 隐私 / 帮助', '作者、许可、常见问题', 'page-setting', { tab: 'about', q: '关于 隐私 帮助 问题' }));
H.push(navRow('经典设置（原设置页）', '按原来的分类查看全部设置', 'page-setting', { q: '经典 原设置' }));
});
});
return H.join('');
}
function applyFilter() {
var q = (searchEl ? searchEl.value || '' : '').trim().toLowerCase();
var blocks = body.querySelectorAll('.sh-block');
var any = false;
Array.prototype.forEach.call(blocks, function (blk) {
var rows = blk.querySelectorAll('.sh-row');
var hit = 0;
Array.prototype.forEach.call(rows, function (r) {
var qq = (r.getAttribute('data-q') || '').toLowerCase();
var ok = !q || qq.indexOf(q) >= 0;
r.hidden = !ok;
if (ok) hit++;
});
blk.hidden = hit === 0;
if (hit) any = true;
});
var old = body.querySelector('.sh-empty');
if (old) old.remove();
if (!any) body.insertAdjacentHTML('beforeend', '<div class="sh-empty">没找到相关设置，换个词试试</div>');
}
function render() {
if (!body) return;
var keep = body.scrollTop; // 重渲染后保持原来的滚动位置（切 tab 回来不会跳回顶部）
body.innerHTML = build();
applyFilter();
body.scrollTop = keep;
}
/* ---------------- 交互 ---------------- */
function doNav(el) {
var pageId = el.getAttribute('data-nav');
if (!pageId) return;
if (!go(pageId)) { toast('这个入口暂时打不开'); return; }
var tab = el.getAttribute('data-tab');
if (tab) { var t = document.querySelector('#set-tabs .them-tab[data-tab="' + tab + '"]'); if (t) t.click(); }
var sel = el.getAttribute('data-sel');
if (sel) {
setTimeout(function () {
var x = document.querySelector(sel);
if (!x) return;
try { x.scrollIntoView({ block: 'center' }); } catch (e) { x.scrollIntoView(); }
x.classList.add('sh-hit');
setTimeout(function () { x.classList.remove('sh-hit'); }, 1400);
}, 80);
}
var cid = el.getAttribute('data-click');
if (cid) setTimeout(function () { var x = document.getElementById(cid); if (x) x.click(); }, 120);
}
body.addEventListener('click', function (e) {
var stepBtn = e.target.closest('[data-d]');
if (stepBtn) {
var wrap = stepBtn.closest('[data-act="step"]');
if (!wrap) return;
var key = wrap.getAttribute('data-key'), src = wrap.getAttribute('data-src');
var min = +wrap.getAttribute('data-min'), max = +wrap.getAttribute('data-max'), st = +wrap.getAttribute('data-st');
var dv = +stepBtn.getAttribute('data-d');
var nv = Math.max(min, Math.min(max, getNum(src, key, min) + dv * st));
setNum(src, key, nv);
applySpecial(wrap.getAttribute('data-apply'));
render();
return;
}
var sw = e.target.closest('[data-act="sw"]');
if (sw) {
var k = sw.getAttribute('data-key'), s = sw.getAttribute('data-src');
setNum(s, k, getNum(s, k, 0) ? 0 : 1);
applySpecial(sw.getAttribute('data-apply'));
render();
return;
}
var segBtn = e.target.closest('[data-act="seg"] button');
if (segBtn) {
var segWrap = segBtn.closest('[data-act="seg"]');
if (segWrap.getAttribute('data-key') === 'theme') applyTheme(segBtn.getAttribute('data-v'));
render();
return;
}
var pl = e.target.closest('.sh-preset-labels span');
if (pl) { applyPreset(ORDER[+pl.getAttribute('data-i')]); return; }
var more = e.target.closest('[data-act="freqmore"]');
if (more) { freqOpen = !freqOpen; render(); return; }
var nav = e.target.closest('[data-nav]');
if (nav) { doNav(nav); return; }
});
if (searchEl) searchEl.addEventListener('input', function () { applyFilter(); });
body.addEventListener('input', function (e) {
var r = e.target.closest('[data-act="preset-range"]');
if (!r) return;
var v = +r.value;
Array.prototype.forEach.call(body.querySelectorAll('.sh-preset-labels span'), function (s) {
s.classList.toggle('sel', +s.getAttribute('data-i') === v);
});
});
body.addEventListener('change', function (e) {
var r = e.target.closest('[data-act="preset-range"]');
if (!r) return;
applyPreset(ORDER[+r.value]);
});
try {
new MutationObserver(function () {
if (!page.hidden) setTimeout(render, 0);
}).observe(page, { attributes: true, attributeFilter: ['hidden'] });
} catch (e) {}
document.addEventListener('contact-switched', function () { if (!page.hidden) render(); });
var deskIco = document.querySelector('.app[data-app="settings"]');
if (deskIco) {
deskIco.addEventListener('click', function (e) {
var editing = false;
try {
editing = Array.prototype.some.call(document.querySelectorAll('.app-grid'), function (g) {
return g.classList.contains('editing');
});
} catch (e0) {}
if (editing) {
var grid = deskIco.closest('.app-grid');
if (grid && grid.classList.contains('editing')) return;
if (window.openIconMenu) { e.stopPropagation(); window.openIconMenu(deskIco); }
return;
}
document.querySelectorAll('.page').forEach(function (p) { p.hidden = (p !== page); });
try {
document.querySelectorAll('.tabbar .tab').forEach(function (t) { t.classList.remove('active'); });
} catch (e1) {}
setTimeout(render, 0);
});
}
render();
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("settings-hub.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("settings-hub.js"); try { console.error("[JS] settings-hub.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[settings-hub.js] " + String(__e && __e.message || __e)); } })();
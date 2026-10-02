(function () { try {
(function () {
var G = 'xy-home-v2';
var CID_RE = /^(default|c[0-9a-z]{5,}):(.*)$/; // 联系人 id 生成见 contacts.js：'c' + base36 时间戳 + 随机
var MEDIA_RE = /@@m:([0-9a-f]{32})/g;
var MEDIA_PREFIX = 'media:';
var BLOB_PREFIX = 'font-blob-'; // 上传字体包：全局唯一存储 + 各桌面引用，不属于任何单功能
function parseKey(full) {
if (typeof full !== 'string' || full.indexOf(G + ':') !== 0) return null;
var rest = full.slice(G.length + 1);
if (!rest) return null;
var m = CID_RE.exec(rest);
if (m) return { cid: m[1], suffix: m[2], full: full };
return { cid: null, suffix: rest, full: full };
}
function nsOf(cid) { return cid === null ? G : G + ':' + cid; }
function sharedNsOf(f) { return f.anchor ? G + ':' + f.anchor : G; }
function isSharedNs(f, info) { return info.cid === null || (!!f.anchor && info.cid === f.anchor); }
function whereWord(f) { return f.scope === 'desk' ? '本桌面' : '本机'; }
function curCid() {
try { var c = window.__activeCid; if (c) return c; } catch (e) {}
return 'default';
}
var FEATURES = [
{ id: 'chat', name: '聊天', group: '聊天与社交', scope: 'both', page: 'page-chat', btns: 'cs-export-msgs,cs-import-msgs,cs-clear-msgs',
desc: '聊天记录、聊天设置（气泡/字号/时间轴/输入栏）、表情包与文字库、拍一拍、红包、引用',
res: [/^chat-/, /^cs-(?!avatar-|lbl-)/, /^rp-cover-/, /* #1346: legacy rp-wallet moves to gift; see the chat-row comment block */ /^emoji-last$/, /^emoji-recent/, /^my-emoji-groups$/, /^my-text-groups$/, /^my-invite-groups$/, /^mye-global-migrated$/, /^hide-tab-/, /^hide-ta-sticker$/, /^invite-ask-history$/, /^poke-/, /^rps-score$/, /^scroll-anchor-auto$/, /^sysmsg-/, /^more-tab$/, /^more-cat$/, /^mail-emoji-mode$/, /^qixi-today$/, /^ask-think-secs$/] },
{ id: 'gc', name: '群聊', group: '聊天与社交', scope: 'both', page: 'page-group-chat',
desc: '群聊记录、群分组、群成员资料、群聊美化与设置',
res: [/^gc-/, /^group-chat-msgs$/, /^group-chat-enabled$/] },
{ id: 'cards', name: '字卡库与回复设置', group: '聊天与社交', scope: 'both', page: 'page-custom-cards', btns: 'cc-export,cc-import-data,cc-clear-all',
desc: '自定义/公用/默认字卡、词典、TA 回复字卡、各类概率与开关（回复设置）',
res: [/^cc-/, /^quote-cards/, /^reply-/, /^dc-/, /^dcf-/, /^dict-/, /^rcard-/, /^tm-/, /^rps-/, /^mc-/, /^mh-/, /^rc-/] },
{ id: 'fav', name: '收藏', group: '聊天与社交', scope: 'desk', page: 'page-fav',
desc: '我收藏的消息/字卡/图片与 TA 的收藏',
res: [/^fav-msgs$/, /^fav-img-/, /^fav-media-/, /^fav-settings/, /^fav-ta-/] },
{ id: 'identity', name: '昵称与头像', group: '聊天与社交', scope: 'desk',
desc: '双方当前昵称、头像、聊天页昵称与头像（各功能显示处共用这份资料）',
res: [/^lbl-user$/, /^lbl-partner$/, /^cs-lbl-/, /^avatar-user$/, /^avatar-partner$/, /^cs-avatar-/, /^records-avatar$/, /^partner-gender$/] },
{ id: 'interact', name: '头像和昵称互动', group: '聊天与社交', scope: 'desk', page: 'page-interact',
desc: '头像库/昵称库与其自动更换进度、开关',
res: [/^avatar-lib/, /^avatar-me-lib/, /^nick-lib/, /^nick-me-lib/] },
{ id: 'mail', name: '信箱', group: '聊天与社交', scope: 'desk', page: 'page-mail', btns: 'mail-export,mail-import,mail-clear',
desc: '收信/寄信/回信、待回信计划、信箱设置（含每周摸鱼小结）',
res: [/^mail-/, /^ml-/] },
{ id: 'feed', name: '朋友圈', group: '聊天与社交', scope: 'both', page: 'page-feed', btns: 'feed-clear-all',
desc: '全部动态、评论点赞、通知提醒、封面与昵称头像',
res: [/^feed-/] },
{ id: 'ask', name: 'TA 的提问与问卷', group: '聊天与社交', scope: 'desk', page: 'page-ta-ask',
desc: 'TA 的提问/选择题/好奇/吐槽、问卷作答记录、询问提醒时间',
res: [/^ta-ask$/, /^ta-survey$/, /^ta-choose$/, /^ta-curious$/, /^ta-roast$/, /^ta-cc-state$/, /^ta-checkin$/, /^interact-card-last$/, /^ta-chime:/, /^ti-last-id$/] },
{ id: 'requests', name: '跨桌面查岗 / 来电开关', group: '聊天与社交', scope: 'both',
desc: '跨桌面查岗开关与频率、跨桌面来电、夜间静默模式、待处理请求',
res: [/^incoming-requests$/, /^desk-checkin-en$/, /^desk-call-en$/, /^desk-freq-mode$/, /^desk-msg-en$/, /^night-mode-en$/] },
{ id: 'calendar', name: '日历与每日留言', group: '桌面功能', scope: 'desk', page: 'page-calendar',
desc: '每日留言、心情与语录历史、恋爱开始日、首次使用日、日历标注',
res: [/^cal-/, /^memo-(?!app)/, /^mood-history$/, /^quote-history$/, /^today-mood-/, /^first-use-date$/, /^love-start$/, /^memo$/, /^today-mood$/] },
{ id: 'records', name: '纪念与统计', group: '桌面功能', scope: 'desk', page: 'page-home',
desc: '纪念日、通话记录、关心/摸鱼收获等纪念页数据',
res: [/^records-(?!coin)/] },
{ id: 'divination', name: '占卜', group: '桌面功能', scope: 'both', page: 'page-divine',
desc: '占卜历史、自定义牌面与图鉴、牌面编号开关',
res: [/^divine-/, /^divf-/] },
{ id: 'music', name: '音乐', group: '桌面功能', scope: 'global', anchor: 'default', page: 'page-music',
desc: '本地上传的音乐文件、歌单、收藏、播放顺序与播放记录（所有桌面共用一份）',
res: [/^music-/] },
{ id: 'fish', name: '摸鱼与上班天数', group: '桌面功能', scope: 'both',
desc: '摸鱼累计天数、上班打卡天数、双方各自的摸鱼记录',
res: [/^fish-/, /^work-/, /^day-fish/, /^day-work/, /^weekend-fish/] },
{ id: 'tongpin', name: '同频', group: '桌面功能', scope: 'desk', page: 'page-tongpin',
desc: '同频状态与发送记录',
res: [/^tongpin-/] },
{ id: 'shenshou', name: '伸手', group: '桌面功能', scope: 'desk', page: 'page-shenshou',
desc: '伸手次数、上次伸手时间与字卡',
res: [/^shenshou-/] },
{ id: 'water', name: '喝水', group: '桌面功能', scope: 'desk', page: 'page-water',
desc: '喝水目标与历史、连续天数、提醒语',
res: [/^water-/] },
{ id: 'eat', name: '吃什么', group: '桌面功能', scope: 'desk', page: 'page-eat',
desc: '菜单、抽取历史与提醒开关',
res: [/^eat-/] },
{ id: 'piggy', name: '存钱罐', group: '桌面功能', scope: 'both', page: 'page-piggy',
desc: '存钱目标与流水、心意币两套罐子、来访记录',
res: [/^piggy-/] },
{ id: 'pomo', name: '番茄钟', group: '桌面功能', scope: 'both', page: 'page-pomodoro',
desc: '番茄钟设置、累计次数与今日进度、陪伴记录',
res: [/^pomo-/] },
{ id: 'checkin', name: '打卡与查岗记录', group: '桌面功能', scope: 'desk', page: 'page-checkin',
desc: '打卡记录与历史、查岗卡片状态、连续天数',
res: [/^checkin-/, /^ck-/, /^ck-off-/, /^ckq-/, /^checkin$/] },
{ id: 'loc', name: '定位', group: '桌面功能', scope: 'desk', page: 'page-loc-cards',
desc: '定位历史、气泡与特效开关、自动定位、定位组合',
res: [/^loc-/, /^loc-auto/, /^loc-sense/] },
{ id: 'garden', name: '花园', group: '桌面功能', scope: 'desk', page: 'page-garden',
desc: '种下的花与生长进度、收获记录',
res: [/^garden-/] },
{ id: 'cjian', name: '此间与梦角档案', group: '桌面功能', scope: 'both', page: 'page-cjian',
desc: '此间状态与换家标记、成员名册、梦角档案（含时辰区间）',
res: [/^cjian-/, /^narc-/] },
{ id: 'myarc', name: '我的档案', group: '桌面功能', scope: 'both', page: 'page-my-arc',
desc: '我的档案资料与共享给 TA 的部分',
res: [/^myarc/] },
{ id: 'room', name: '房间', group: '桌面功能', scope: 'desk', page: 'page-room',
desc: '房间摆放与装修、家具位置',
res: [/^room-/] },
{ id: 'drift', name: '漂流瓶', group: '桌面功能', scope: 'desk', page: 'page-drift',
desc: '我扔出/收到的漂流瓶与回复',
res: [/^drift-/] },
{ id: 'memo', name: '备忘录', group: '桌面功能', scope: 'both', page: 'page-memo',  // desk→both：见 pomo 上方 #1325 批注
desc: '备忘录条目、发送记录、全局迁移标记',
res: [/^memo-app-/] },
{ id: 'period', name: '经期记录', group: '桌面功能', scope: 'both', page: 'page-period',
desc: '经期记录与预测、每日状态、关心语与提醒设置',
res: [/^period-/] },
{ id: 'accounting', name: '记账', group: '桌面功能', scope: 'desk', page: 'page-accounting',
desc: '账目记录、分类、预算与心意币记录',
res: [/^accounting-/, /^acc-remind/, /^records-coin/] },
{ id: 'gift', name: '礼物与集市', group: '桌面功能', scope: 'both', page: 'page-market',
desc: '礼物盒、集市商品与自定义、钱包与心愿单、每日购买额度',
res: [/^gift-/, /^market-/, /^giftbox-items$/, /^ml2_/, /^rp-wallet$/, /^wl-/, /^gift-wishlist/] },
{ id: 'decision', name: '抉择', group: '桌面功能', scope: 'global',
desc: '抉择历史与设置（全局，所有桌面共用）',
res: [/^decision-/, /^dec-/] },
{ id: 'gdec', name: '群抉择', group: '桌面功能', scope: 'global',
desc: '群抉择历史、成员与设置（全局，所有桌面共用）',
res: [/^gdec-/] },
{ id: 'mood', name: '心情日记', group: '桌面功能', scope: 'desk', page: 'page-mood',
desc: '心情日记条目与记录',
res: [/^mood-diary$/] },
{ id: 'games', name: '小游戏', group: '桌面功能', scope: 'both',
desc: '各小游戏的音效/动画开关与进行中的局面标记',
res: [/^snake-/, /^snk-/, /^brick-/, /^c4-/, /^ms-(?!g-)/, /^m3-/, /^lk-/, /^gk-/, /^au-/, /^pong-/, /^game-/] },
{ id: 'desktop', name: '桌面布局与美化', group: '桌面与系统', scope: 'desk',
desc: '桌面图标位置/顺序/大小、隐藏图标、壁纸与组件美化、主题色、美化方案',
res: [/^desk-/, /^hidden-icons/, /^page-bg-/, /^card-bg-/, /^ico-/, /^phone-bg/, /^widget-/, /^app-icon/, /^app-name-color$/, /^beauty-/, /^full-beauty-/, /^decor-/, /^home-/, /^p2apps-order/, /^p2icons-/, /^rel-/, /^mem-extras$/, /^no-statusbar$/, /^bg-blur$/, /^bg-mask-op$/, /^loading-/, /^tabbar-/, /^tab-icon-/, /-desk-pin$/] },
{ id: 'lock', name: '二级密码锁', group: '桌面与系统', scope: 'both',  // desk→both：见 pomo 上方 #1325 批注
desc: '应用锁密码、密保问答、锁定开关与字卡锁状态',
res: [/^applock/, /^cardlock/] },
{ id: 'call', name: '通话', group: '桌面与系统', scope: 'both',
desc: '通话背景与来电弹窗背景、通话小框位置与开关、通话中/挂起现场（记录本身在「纪念与统计」里）',
res: [/^call-mini-/, /^call-bg$/, /^call-half-bg$/, /^call-active$/, /^call-hold$/] },
{ id: 'sys', name: '音效与系统设置', group: '桌面与系统', scope: 'both', page: 'page-sfx-settings',
desc: '音效总开关与统一模式、开屏公告已读、引导完成标记、数据备份提醒时间',
res: [/^sfx-/, /^notice-/, /^onboarding/, /^guide-/, /^splash-/, /^backup-/, /^last-export$/, /^install-/, /^theme-mode$/, /^accent-color$/, /^bg-keep/, /^bg-notify/, /^ver-update-notify$/] }
];
var FD_MOUNTS = {
calendar: '.cal-scroll',
records: '.cal-scroll',
interact: '.cal-scroll',
divination: '.div-scroll',
music: '.sm-scroll, .cal-scroll',
tongpin: '.tp-body',
shenshou: '.ss-body',
water: '.water-body',
eat: '.eat-body',
piggy: '.piggy-body',
pomo: '.pomo-body',
checkin: '.cal-scroll',
loc: '.gs-scroll',
garden: '.garden-scroll',
cjian: '#cj-main',
myarc: '.narc-scroll',
drift: '.drift-scroll',
memo: '.memo-body',
period: '.period-scroll',
accounting: '.acc-scroll',
gift: '.market-body',
mood: '.cal-scroll',
fav: '#fav-list',
ask: '.gs-scroll',
sys: '.gs-scroll'
};
var FD_SKIP = { room: 1, gc: 1 };
function featureOfKey(full, cid) {
var info = parseKey(full);
if (!info) return null;
if (info.suffix.indexOf(MEDIA_PREFIX) === 0 || info.suffix.indexOf(BLOB_PREFIX) === 0) return null; // 共享资源池不归属任何功能
for (var i = 0; i < FEATURES.length; i++) {
var f = FEATURES[i];
var hit = false;
for (var j = 0; j < f.res.length; j++) { if (f.res[j].test(info.suffix)) { hit = true; break; } }
if (!hit) continue;
var isTop = info.cid === null;
if (f.scope === 'global') { if (isSharedNs(f, info)) return f; continue; }
if (f.scope === 'both') { if (isSharedNs(f, info) || info.cid === cid) return f; continue; }
if (info.cid === cid || (isTop && cid === 'default')) return f;
}
return null;
}
function featureOfSuffix(f, suffix) {
if (suffix.indexOf(MEDIA_PREFIX) === 0 || suffix.indexOf(BLOB_PREFIX) === 0) return false;
for (var j = 0; j < f.res.length; j++) { if (f.res[j].test(suffix)) return true; }
return false;
}
function allKeys() {
var set = Object.create(null);
try {
for (var i = 0; i < localStorage.length; i++) {
var k = localStorage.key(i);
if (k && k.indexOf(G + ':') === 0) set[k] = 1;
}
} catch (e) {}
function gather(idbKeys) {
(idbKeys || []).forEach(function (k) { if (k && String(k).indexOf(G + ':') === 0) set[String(k)] = 1; });
var out = Object.keys(set);
out.incomplete = idbKeys === null;
return out;
}
if (!window.idbListKeys) return Promise.resolve(gather([]));
return window.idbListKeys().then(function (keys) {
if (keys !== null) return gather(keys);
return new Promise(function (res) { setTimeout(function () { res(window.idbListKeys()); }, 800); })
.then(function (k2) { return gather(k2 === undefined ? null : k2); });
}).catch(function () { return gather(null); });
}
function keysOf(f, cid) {
return allKeys().then(function (all) {
var out = all.filter(function (k) { var o = featureOfKey(k, cid); return o && o.id === f.id; });
out.incomplete = all.incomplete;
return out;
});
}
function readFallback(full) {
var info = parseKey(full);
if (!info) return null;
try {
var v = window.xyStore ? window.xyStore(nsOf(info.cid)).get(info.suffix) : null;
if (v !== null && v !== undefined) return v;
} catch (e) {}
try { return localStorage.getItem(full); } catch (e) { return null; }
}
function readValues(keys) {
var out = {};
var missing = [];
var bin = [], binBytes = 0;
var i = 0;
function take() {
if (i >= keys.length) {
try {
Object.defineProperty(out, 'missing', { value: missing, enumerable: false });
Object.defineProperty(out, 'bodies', { value: bin, enumerable: false });
Object.defineProperty(out, 'bodyBytes', { value: binBytes, enumerable: false });
} catch (e) { out._m = missing; }
return out;
}
var unit = keys.slice(i, i + READ_BATCH); i += READ_BATCH;
var p = (window.idbGetMany ? window.idbGetMany(unit) : Promise.resolve({}));
return Promise.resolve(p).catch(function () { return {}; }).then(function (map) {
unit.forEach(function (k) {
var v = map ? map[k] : null;
if (v === undefined) v = null;
if (v === null) v = readFallback(k);
if (v === null || v === undefined) { missing.push(k); return; }
if (typeof Blob !== 'undefined' && v instanceof Blob) { bin.push(k); binBytes += v.size || 0; return; }
out[k] = v;
});
return take();
});
}
return Promise.resolve(take());
}
var READ_BATCH = 80;                      // 一次 idbGetMany 的键数上限（与 data-backup.js measureProject 同尺）
var INTERNAL_RE = /^__/; // 双下划线开头＝机器自己记的账（写日志 __wr-journal / 每键标记 __wr-j: / 大键索引 __big-idx /
var FILE_BODY_RE = /^music-file:/;        // 本地音频文件体：与 data-backup.js 的 MUSIC_KEY_RE 同一族
var ONE_KEY_MAX = 32 * 1024 * 1024;       // 单键超此值不内联进一个 JSON 字符串（下载/分享上限同量级）
function sizeOfKey(full) {
try { var b = window.idbBigSize ? window.idbBigSize(full) : null; if (typeof b === 'number' && b > 0) return b; } catch (e) {}
try { var s = localStorage.getItem(full); if (s != null) return s.length; } catch (e) {}
return null; // 未知（既不在 LS 也没进索引）＝不得据此断言它小
}
function planKeys(keys) {
var small = [], bodies = [], tooBig = [], bodyBytes = 0, bodyUnknown = 0, bigBytes = 0;
keys.forEach(function (k) {
var info = parseKey(k);
var n = sizeOfKey(k); // 文件体在 IDB 里是 Blob，尺寸索引与 LS 都不认它＝量不出来（n===null）
if (info && FILE_BODY_RE.test(info.suffix)) { bodies.push(k); if (n === null) bodyUnknown++; else bodyBytes += n; return; }
if (n !== null && n > ONE_KEY_MAX) { tooBig.push(k); bigBytes += n; return; }
small.push(k);
});
return { small: small, bodies: bodies, tooBig: tooBig, bodyBytes: bodyBytes, bodyUnknown: bodyUnknown, bigBytes: bigBytes };
}
function statKeys(keys) {
var plan = planKeys(keys);
return readValues(plan.small).then(function (values) {
var st = summarize(values);
if (values.bodies && values.bodies.length) {
plan.bodies = plan.bodies.concat(values.bodies);
plan.bodyBytes += values.bodyBytes || 0;
plan.small = plan.small.filter(function (k) { return values.bodies.indexOf(k) < 0; });
}
return { values: values, plan: plan, total: keys.length,
missing: (values.missing && values.missing.length) || 0, unmeasured: plan.bodyUnknown,
bytes: st.bytes + plan.bodyBytes + plan.bigBytes, items: st.items };
});
}
function carriedLines(plan) {
var lines = [];
if (plan.bodies.length) lines.push('另有 ' + plan.bodies.length + ' 个本地音频文件体' + (plan.bodyUnknown ? '' : '（约 ' + fmtSize(plan.bodyBytes) + '）')
+ ' 不在单功能导出里：二进制文件体只有整机备份带得走（设置 → 通用 → 导出数据，可选「不含音乐文件」）；'
+ '到新设备重新添加音乐文件即可，歌单/收藏/播放记录都会跟着这份文件走。');
if (plan.tooBig.length) lines.push('另有 ' + plan.tooBig.length + ' 项体积过大（约 ' + fmtSize(plan.bigBytes)
+ '）没有打包进来：这一档请用 设置 → 通用 → 导出数据 做整包备份。');
return lines;
}
function mediaRefsOf(values) {
var set = Object.create(null);
Object.keys(values).forEach(function (k) {
var v = values[k];
if (typeof v !== 'string' || v.indexOf('@@m:') < 0) return;
var m; MEDIA_RE.lastIndex = 0;
while ((m = MEDIA_RE.exec(v))) set[m[1]] = 1;
});
return Object.keys(set).map(function (h) { return G + ':' + MEDIA_PREFIX + h; });
}
function byteLen(s) { try { return new Blob([s]).size; } catch (e) { return (s || '').length; } }
function fmtSize(n) {
if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
if (n > 1024) return Math.round(n / 1024) + ' KB';
return n + ' B';
}
function countOf(v) {
var d = v;
if (typeof d === 'string') {
if (d.length > 1048576) return ''; // 超大键不整包 parse（聊天记录/字卡库可达几十 MB）
try { d = JSON.parse(d); } catch (e) { return ''; }
}
if (Array.isArray(d)) return d.length + ' 条';
if (d && typeof d === 'object') return Object.keys(d).length + ' 项';
return '';
}
function summarize(values) {
var keys = Object.keys(values);
var bytes = 0, items = 0, sample = '';
keys.forEach(function (k) {
var v = values[k];
bytes += byteLen(typeof v === 'string' ? v : String(v));
var c = countOf(v);
if (c) { var n = parseInt(c, 10); if (!isNaN(n)) { items += n; if (!sample) sample = c; } }
});
return { keyCount: keys.length, bytes: bytes, items: items, sample: sample };
}
function exportFeature(f, cb) {
var cid = curCid();
keysOf(f, cid).then(function (keys) {
if (!keys.length) { toast(keys.incomplete ? '这次没能读到本机数据库的键清单（数据库可能正被大项占用），不代表没有数据——稍等片刻再导出' : '「' + f.name + '」在' + whereWord(f) + '还没有数据'); if (cb) cb(false); return; }
return statKeys(keys).then(function (st) {
var values = st.values;
var media = mediaRefsOf(values);
return readValues(media).then(function (mv) {
Object.keys(mv).forEach(function (k) { values[k] = mv[k]; });
if (!Object.keys(values).length) {
toast('这次一项值都没读到（本机数据库正被大项占用时会出现），没有出具文件；稍等片刻再导一次，或直接走 设置 → 通用 → 导出数据。');
if (cb) cb(false);
return;
}
var bytes = 0;
Object.keys(values).forEach(function (k) { bytes += byteLen(typeof values[k] === 'string' ? values[k] : String(values[k])); });
var lines = ['将导出「' + f.name + '」的 ' + Object.keys(values).length + ' 项数据' + (st.items ? '（约 ' + st.items + ' 条记录）' : '') +
'，打包体积约 ' + fmtSize(bytes) + '。'];
lines.push('作用范围：' + scopeText(f) + '。');
lines = lines.concat(carriedLines(st.plan));
if (st.missing) lines.push('注意：有 ' + st.missing + ' 项这次没读到值（大项正在被数据库占用时会出现这种读数），它们不在这份文件里——稍等片刻再导一次，或改走 设置 → 通用 → 导出数据。');
if (media.length) lines.push('已附带这些数据里引用到的 ' + media.length + ' 张图片/语音（媒体池条目）。');
lines.push('导出不会改动本机任何数据。');
if (!window.openModal) return;
window.openModal('导出「' + f.name + '」数据？', '', function () {
var json;
try {
var parts = ['{"app":"mochi-feature-data","version":"1.0","feature":' + JSON.stringify(f.id) + ',"featureName":' + JSON.stringify(f.name) + ',"cid":' + JSON.stringify(cid) + ',"exportTime":"' + new Date().toISOString() + '","keys":{'];
var ks = Object.keys(values);
for (var i = 0; i < ks.length; i++) {
if (i) parts.push(',');
parts.push(JSON.stringify(ks[i]) + ':' + JSON.stringify(values[ks[i]]));
}
parts.push('}}');
json = parts.join('');
} catch (e) { toast('导出失败：' + (e && e.message || '未知错误')); return; }
var fname = 'mochi' + f.name.replace(/[\/\\:*?"<>|]/g, '') + '_' + localDate() + '.json';
if (window.mochiExportFile) window.mochiExportFile(json, fname, '导出' + f.name + '数据');
else { toast('导出功能暂不可用'); return; }
if (cb) cb(true);
}, { noInput: true, staticText: lines.join('\n') });
});
});
}).catch(function (e) { toast('导出失败：' + (e && e.message || '未知错误')); if (cb) cb(false); });
}
function localDate() {
var d = new Date();
var p = function (n) { return n < 10 ? '0' + n : '' + n; };
return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function scopeText(f) {
if (f.scope === 'global') return f.anchor ? '所有桌面共用一份（这一份在 ' + f.anchor + ' 桌面命名空间里）' : '全局键，所有桌面共用';
if (f.scope === 'both') return f.anchor ? '当前桌面 + 所有桌面共用的一份（共用那一份在 ' + f.anchor + ' 桌面命名空间里）' : '当前桌面 + 全局键';
return '当前桌面（不影响其他桌面）';
}
function shortScope(f) {
if (f.scope === 'global') return '全局';
if (f.scope === 'both') return '本桌面+全局';
return '本桌面';
}
function extractKeyMap(data) {
if (!data || typeof data !== 'object') return null;
if (data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys)) return data.keys;
var out = Object.create(null), n = 0;
var take = function (obj) {
if (!obj || typeof obj !== 'object') return;
Object.keys(obj).forEach(function (k) { if (k.indexOf(G + ':') === 0) { out[k] = obj[k]; n++; } });
};
if (data.ls || data.idb) { take(data.ls); take(data.idb); return n ? out : null; }
Object.keys(data).forEach(function (k) { if (k.indexOf(G + ':') === 0) { out[k] = data[k]; n++; } });
return n ? out : null;
}
function targetOf(f, srcKey, cid) {
var info = parseKey(srcKey);
if (!info) return null;
if (info.suffix.indexOf(MEDIA_PREFIX) === 0) return { ns: G, suffix: info.suffix };
if (f.scope === 'global' || (f.scope === 'both' && info.cid === null)) return { ns: sharedNsOf(f), suffix: info.suffix };
return { ns: G + ':' + cid, suffix: info.suffix };
}
function importFromFile(f, file, cb) {
readFileText(file).then(function (text) {
var data = null;
try { data = JSON.parse(text || 'null'); } catch (e) {}
if (!data) { toast('文件不是有效的 JSON，无法导入'); if (cb) cb(false); return; }
var map = extractKeyMap(data);
if (!map) { toast('文件里没有数据'); if (cb) cb(false); return; }
var cid = curCid();
var incoming = Object.create(null); // 目标键 → 值
var mediaCount = 0, otherFeature = 0;
Object.keys(map).forEach(function (k) {
var info = parseKey(k);
if (!info) return;
if (info.suffix.indexOf(MEDIA_PREFIX) === 0) { incoming[G + ':' + info.suffix] = map[k]; mediaCount++; return; }
if (info.suffix.indexOf(BLOB_PREFIX) === 0) return; // 字体包不随功能数据搬运
var owner = featureOfSuffix(f, info.suffix);
if (!owner) { otherFeature++; return; }
var t = targetOf(f, k, cid);
if (t) incoming[t.ns + ':' + t.suffix] = map[k];
});
var nKeys = Object.keys(incoming).length - mediaCount;
if (!nKeys) { toast('文件里没有「' + f.name + '」的数据' + (otherFeature ? '（含 ' + otherFeature + ' 项其他功能的数据，已忽略）' : '')); if (cb) cb(false); return; }
var bytes = 0;
Object.keys(incoming).forEach(function (k) { bytes += byteLen(typeof incoming[k] === 'string' ? incoming[k] : String(incoming[k])); });
var lines = ['文件里有「' + f.name + '」的 ' + nKeys + ' 项数据，约 ' + fmtSize(bytes) + '。'];
if (mediaCount) lines.push('含 ' + mediaCount + ' 张图片/语音（媒体池条目，按内容去重写入）。');
if (otherFeature) lines.push('另有 ' + otherFeature + ' 项其他功能的数据，本次不会改动。');
lines.push('导入后页面会自动刷新。');
var re = /^xy-home-v2:(?:default|c[0-9a-z]{5,}):(.+)$/;
var deskKeys = Object.keys(incoming).filter(function (k) { return re.test(k); }).length;
void deskKeys;
if (!window.openModal) return;
window.openModal('导入「' + f.name + '」数据？', '', function (v) {
var replace = (v === 'replace');
var todo = function () {
var pairs = Object.keys(incoming);
if (replace) {
return keysOf(f, cid).then(function (old) {
old.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
return pairs;
});
}
return Promise.resolve(pairs);
};
todo().then(function (pairs) {
pairs.forEach(function (k) {
var i = parseKey(k);
if (!i) return;
try { window.xyStore(nsOf(i.cid)).set(i.suffix, incoming[k]); } catch (e) {}
});
toast(replace ? '已替换为文件数据，正在刷新…' : '已导入，正在刷新…');
scheduleReload();
if (cb) cb(true);
});
}, { noInput: true, staticText: lines.join('\n'), pill: 'merge', pills: [
{ label: '合并（同项以文件为准）', value: 'merge' },
{ label: '清空本功能后导入', value: 'replace' }
] });
});
}
function readFileText(file) {
return new Promise(function (resolve) {
if (file && typeof file.text === 'function') { file.text().then(resolve).catch(function () { viaReader(); }); return; }
viaReader();
function viaReader() {
try {
var r = new FileReader();
r.onload = function () { resolve(String(r.result || '')); };
r.onerror = function () { resolve(''); };
r.readAsText(file, 'utf-8');
} catch (e) { resolve(''); }
}
});
}
function pickFile(f, cb) {
window.mochiFilePick({
id: 'mochi-featuredata-import-pick', accept: window.mochiDataPickAccept, // #1413：与整机导入同一份并集（窄串会让转存后改了类型的备份灰显）
onFiles: function (files) {
var file = files && files[0];
if (!file) { try { toast('没有取到文件，请再选一次'); } catch (e) {} return; }
importFromFile(f, file, cb);
}
});
}
function rmKey(info) {
try { window.xyStore(nsOf(info.cid)).remove(info.suffix); } catch (e) {}
try { if (!window.xyStore) localStorage.removeItem(info.full); } catch (e) {}
}
function scheduleReload() {
if (window.__mochiFdNoReload) return;
setTimeout(function () { try { location.reload(); } catch (e) {} }, 600);
}
function clearFeature(f, cb) {
var cid = curCid();
keysOf(f, cid).then(function (keys) {
if (!keys.length) { toast(keys.incomplete ? '这次没能读到本机数据库的键清单，先不清空——稍等片刻重试' : '「' + f.name + '」在' + whereWord(f) + '没有可清空的数据'); if (cb) cb(false); return; }
return statKeys(keys).then(function (st) {
var lines = ['将删除「' + f.name + '」的 ' + st.total + ' 项数据' + (st.items ? '（约 ' + st.items + ' 条记录）' : '') +
'，约 ' + fmtSize(st.bytes) + (st.unmeasured ? '（另有 ' + st.unmeasured + ' 个音频文件体量不出体积、未计入）' : '') + '，删除后无法恢复。'];
lines.push('作用范围：' + scopeText(f) + '。');
if (st.plan.bodies.length) lines.push('含 ' + st.plan.bodies.length + ' 个本地音频文件体' + (st.plan.bodyUnknown ? '' : '（约 ' + fmtSize(st.plan.bodyBytes) + '）') + '——这些**不在**单功能导出的文件里，删掉只能靠重新上传找回。');
if (st.plan.tooBig.length) lines.push('含 ' + st.plan.tooBig.length + ' 项超大项（约 ' + fmtSize(st.plan.bigBytes) + '）——同样不在单功能导出的文件里，删前先做整包备份。');
lines.push('图片/语音媒体池与其他功能的数据不会被删（属于各功能自己的那条记录会被删掉）。');
lines.push('清空后页面会自动刷新。');
if (!window.openModal) return;
window.openModal('清空「' + f.name + '」数据？', '', function () {
keys.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
var gone = keysOf(f, cid);
Promise.resolve(gone).then(function (left) {
left.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
toast('「' + f.name + '」数据已清空，正在刷新…');
scheduleReload();
if (cb) cb(true);
});
}, { noInput: true, staticText: lines.join('\n') });
});
}).catch(function (e) { toast('清空失败：' + (e && e.message || '未知错误')); if (cb) cb(false); });
}
function toast(msg) {
try {
if (typeof window.toast === 'function') { window.toast(msg); return; }
} catch (e) {}
var t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; t.className = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.classList.add('show');
clearTimeout(toast._t);
toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
var page, bodyEl, pageReady = false;
function deskName() {
var cid = curCid();
var nick = '';
try { nick = window.activeStore().get('lbl-partner') || ''; } catch (e) {}
return (nick ? nick : 'TA') + '（' + cid + '）';
}
function render() {
if (!bodyEl) return;
var groups = [], gi = {};
FEATURES.forEach(function (f) {
if (!gi[f.group]) { gi[f.group] = { name: f.group, items: [] }; groups.push(gi[f.group]); }
gi[f.group].items.push(f);
});
var html = ['<div class="cal-card glass"><div class="fd-intro">',
'这里是<b>每个功能自己的数据</b>：导出＝把这个功能的数据单独存成一个文件；导入＝把文件里的数据放回这个功能；清空＝只删这个功能的数据。',
'当前桌面：<b>' + esc(deskName()) + '</b>；带「全局」标记的功能所有桌面共用一份数据，清空会影响所有桌面。',
'整机级别的「导出数据 / 导入数据」（含全部功能）仍在 设置 → 通用 顶部；聊天记录也有专门的整桌面入口。',
'纯展示的功能（统计、计算器等）没有独立数据，不在此列。',
'</div><div class="fd-legend">按钮含义：<b>导出</b> 下载 JSON；<b>导入</b> 选文件恢复（可选合并或先清空再导入）；<b>清空</b> 只删本功能数据，不可恢复。</div></div>'];
groups.forEach(function (g) {
html.push('<div class="fd-group-title">' + esc(g.name) + '</div>');
html.push('<div class="cal-card glass fd-card">');
g.items.forEach(function (f) {
html.push('<div class="fd-row" data-fid="' + esc(f.id) + '">',
'<div class="fd-main"><div class="fd-head"><span class="fd-name">' + esc(f.name) + '</span>' +
'<span class="fd-scope ' + (f.scope === 'desk' ? 'desk' : 'global') + '">' + esc(shortScope(f)) + '</span></div>',
'<div class="fd-count" data-count="' + esc(f.id) + '">统计中…</div>',
'<div class="fd-desc">' + esc(f.desc) + '</div>',
'<div class="fd-btns">',
'<button class="fd-btn" type="button" data-op="export" data-fid="' + esc(f.id) + '">导出</button>',
'<button class="fd-btn" type="button" data-op="import" data-fid="' + esc(f.id) + '">导入</button>',
'<button class="fd-btn danger" type="button" data-op="clear" data-fid="' + esc(f.id) + '">清空</button>',
'</div></div></div>');
});
html.push('</div>');
});
bodyEl.innerHTML = html.join('');
refreshCounts();
}
function refreshCounts() {
var cid = curCid();
FEATURES.forEach(function (f) {
var el = bodyEl.querySelector('[data-count="' + f.id + '"]');
if (!el) return;
keysOf(f, cid).then(function (keys) {
if (el.dataset.done) return;
el.dataset.done = '1';
if (!keys.length) { el.textContent = keys.incomplete ? '本机数据库未读到 · 稍候重开本页' : '无数据'; if (!keys.incomplete) el.classList.add('empty'); return; }
return statKeys(keys).then(function (st) {
el.textContent = st.total + ' 项 · ' + fmtSize(st.bytes) + (st.items ? ' · 约 ' + st.items + ' 条' : '');
});
});
});
}
function openPage() {
try {
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
page.hidden = false;
render();
var sc = page.querySelector('.cal-scroll');
if (sc) sc.scrollTop = 0;
} catch (e) {}
}
function closePage() {
try {
document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
var s = document.getElementById('page-setting');
if (s) s.hidden = false;
} catch (e) {}
}
function byId(id) { for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].id === id) return FEATURES[i]; return null; }
function fdBarHost(f, pageEl) {
if (f.btns || FD_SKIP[f.id]) return null;
var sel = FD_MOUNTS[f.id];
if (!sel) return null;
var host = pageEl.querySelector(sel);
return host || null;
}
function buildFdBar(f) {
var card = document.createElement('div');
card.className = 'cal-card glass fd-fbar';
card.setAttribute('data-fbar', f.id);
card.innerHTML =
'<div class="fd-fbar-head"><span class="fd-fbar-name">' + esc(f.name) + ' · 数据管理</span>' +
'<button class="fd-fbar-go" type="button" data-op="open" data-fid="' + esc(f.id) + '">全部功能 ›</button></div>' +
'<div class="fd-count" data-fcount="' + esc(f.id) + '">统计中…</div>' +
'<div class="fd-btns">' +
'<button class="fd-btn" type="button" data-op="export" data-fid="' + esc(f.id) + '">导出数据</button>' +
'<button class="fd-btn" type="button" data-op="import" data-fid="' + esc(f.id) + '">导入数据</button>' +
'<button class="fd-btn danger" type="button" data-op="clear" data-fid="' + esc(f.id) + '">清空数据</button>' +
'</div>';
return card;
}
function mountFdBars() {
FEATURES.forEach(function (f) {
if (!f.page) return;
var pageEl = document.getElementById(f.page);
if (!pageEl || pageEl.querySelector('[data-fbar]')) return;
var host = fdBarHost(f, pageEl);
if (!host) return;
host.appendChild(buildFdBar(f));   // 容器末尾：随内容滚动，位于该功能页最下方
watchBarHost(f, host);
});
}
function watchBarHost(f, host) {
if (!window.MutationObserver || host.__fdBarWatch) return;
try {
host.__fdBarWatch = 1;
new MutationObserver(function () {
if (!host.isConnected || host.querySelector('[data-fbar="' + f.id + '"]')) return;
host.appendChild(buildFdBar(f));
fdCount(f);
}).observe(host, { childList: true });
} catch (e) {}
}
function fdBarClick(e) {
var b = e.target.closest ? e.target.closest('.fd-btn, .fd-fbar-go') : null;
if (!b) return;
var f = byId(b.getAttribute('data-fid'));
if (!f) return;
var op = b.getAttribute('data-op');
if (op === 'export') exportFeature(f);
else if (op === 'import') pickFile(f);
else if (op === 'clear') clearFeature(f);
else if (op === 'open') openPage();
}
function fdCount(f) {
var el = document.querySelector('[data-fcount="' + f.id + '"]');
if (!el || el.dataset.done) return;
keysOf(f, curCid()).then(function (keys) {
if (el.dataset.done) return;
el.dataset.done = '1';
if (!keys.length) { el.textContent = keys.incomplete ? '本机数据库未读到 · 稍候重试' : whereWord(f) + '暂无数据'; if (!keys.incomplete) el.classList.add('empty'); return; }
return statKeys(keys).then(function (st) {
el.textContent = st.total + ' 项 · ' + fmtSize(st.bytes) + (st.items ? ' · 约 ' + st.items + ' 条' : '');
});
});
}
function refreshFdCounts() {
FEATURES.forEach(function (f) {
if (!f.page || f.btns) return;
if (!document.querySelector('[data-fcount="' + f.id + '"]')) return;
fdCount(f);
});
}
function refreshPageCount(pageEl) {
FEATURES.forEach(function (f) {
if (!f.page || f.page !== pageEl.id) return;
var el = pageEl.querySelector('[data-fcount="' + f.id + '"]');
if (!el) return;
delete el.dataset.done;
el.classList.remove('empty');
fdCount(f);
});
}
function watchPageVisibility() {
var root = document.querySelector('.phone') || document.body;
if (!root || !window.MutationObserver) return;
try {
new MutationObserver(function (muts) {
for (var i = 0; i < muts.length; i++) {
var t = muts[i].target;
if (!t || !t.classList || !t.classList.contains('page') || t.hidden) continue;
refreshPageCount(t);
}
}).observe(root, { attributes: true, attributeFilter: ['hidden'], subtree: true });
} catch (e) {}
}
function init() {
page = document.getElementById('page-feature-data');
bodyEl = document.getElementById('feature-data-body');
var row = document.getElementById('row-feature-data');
var back = document.getElementById('feature-data-back');
if (!page || !bodyEl) return;
pageReady = true;
if (row) row.addEventListener('click', openPage);
if (back) back.addEventListener('click', closePage);
if (bodyEl) {
bodyEl.addEventListener('click', function (e) {
var b = e.target.closest ? e.target.closest('.fd-btn') : null;
if (!b) return;
var f = byId(b.getAttribute('data-fid'));
if (!f) return;
var op = b.getAttribute('data-op');
if (op === 'export') exportFeature(f);
else if (op === 'import') pickFile(f);
else if (op === 'clear') clearFeature(f);
});
}
var refresh = document.getElementById('feature-data-refresh');
if (refresh) refresh.addEventListener('click', function () {
bodyEl.querySelectorAll('[data-count]').forEach(function (el) { delete el.dataset.done; el.classList.remove('empty'); el.textContent = '统计中…'; });
refreshCounts();
toast('已重新统计');
});
mountFdBars();
document.addEventListener('click', fdBarClick, true);
watchPageVisibility();
setTimeout(mountFdBars, 800);
setTimeout(function () { mountFdBars(); refreshFdCounts(); }, 2500);
document.addEventListener('mochi-restore-done', function () { mountFdBars(); refreshFdCounts(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
try { document.addEventListener('mochi-restore-done', function () { if (pageReady && page && !page.hidden) render(); }); } catch (e) {}
window.mochiFeatureData = {
features: FEATURES,
scopeText: scopeText,
parseKey: parseKey,
featureOfKey: featureOfKey,
keysOf: function (fid) { var f = byId(fid); return f ? keysOf(f, curCid()) : Promise.resolve([]); },
valuesOf: function (fid) { var f = byId(fid); return f ? keysOf(f, curCid()).then(readValues) : Promise.resolve({}); },
exportFeature: function (fid, cb) { var f = byId(fid); return f ? exportFeature(f, cb) : null; },
importFile: function (fid, file, cb) { var f = byId(fid); return f ? importFromFile(f, file, cb) : null; },
clearFeature: function (fid, cb) { var f = byId(fid); return f ? clearFeature(f, cb) : null; },
describe: function (fid) { var f = byId(fid); return f ? { id: f.id, name: f.name, scope: f.scope } : null; },
fdBarOf: function (fid) { var f = byId(fid); return f && f.page && !f.btns && document.querySelector('[data-fbar="' + f.id + '"]') ? true : false; },
overlaps: function () { return allKeys().then(function (keys) { var m = {}; keys.forEach(function (k) { var f = featureOfKey(k, curCid()); if (f) m[k] = f.id; }); return m; }); },
audit: function () {
return allKeys().then(function (keys) {
var cids = ['default', 'czzzzz'];
var nobody = [], fromDefault = [], cur = curCid();
keys.forEach(function (k) {
var info = parseKey(k); if (!info) return;
if (info.suffix.indexOf(MEDIA_PREFIX) === 0 || info.suffix.indexOf(BLOB_PREFIX) === 0) return; // 共享池按设计不登记
if (INTERNAL_RE.test(info.suffix)) return; // 写日志/索引标记不参与体检（机器记的账，不是数据）
var mine = featureOfKey(k, cur);
if (mine) return;
var any = null;
for (var i = 0; i < cids.length; i++) { var o = featureOfKey(k, cids[i]); if (o) { any = o.id; break; } }
if (any) fromDefault.push(k + '←' + any); else nobody.push(k);
});
return { total: keys.length, nobody: nobody, stranded: fromDefault, cid: cur, incomplete: keys.incomplete };
});
},
planKeys: planKeys, sizeOfKey: sizeOfKey, sharedNsOf: sharedNsOf
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("feature-data.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("feature-data.js"); try { console.error("[JS] feature-data.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[feature-data.js] " + String(__e && __e.message || __e)); } })();
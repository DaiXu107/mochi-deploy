(function () { try {
(function () {
const G = 'xy-home-v2:';
const MEDIA_PREFIX = G + 'media:';
const TOKEN_RE = /^@@m:([0-9a-f]{32})$/;
const KIND = {
'cc-img': { maxSide: 720,  format: 'image/jpeg', quality: 0.85, thr: 100 * 1024 }, // 字卡·图片分类
'cc-stk': { maxSide: 480,  format: 'image/png',  quality: 0.85, thr: 100 * 1024 }, // 字卡·表情包分类
wall:     { maxSide: 2880, format: 'image/jpeg', quality: 0.85, thr: 400 * 1024 }, // 手机壁纸/页面背景/聊天壁纸
card:     { maxSide: 1000, format: 'image/jpeg', quality: 0.85, thr: 150 * 1024 }, // 卡片背景
desk:     { maxSide: 1280, format: 'image/jpeg', quality: 0.85, thr: 200 * 1024 }, // 桌面图片组件
avatar:   { maxSide: 256,  format: 'image/jpeg', quality: 0.85, thr: 80 * 1024 },  // 头像/头像库
media:    { maxSide: 720,  format: 'image/jpeg', quality: 0.85, thr: 100 * 1024 }
};
const BEAUTY_RE = /(?:^|:)(?:phone-bg|phone-bg-item-(?!thb-)[A-Za-z0-9_-]+|page-bg-[0-9]+|card-bg-(?!mask-)[A-Za-z0-9_-]+|desk-image-src-[A-Za-z0-9_-]+|cs-bg|cs-bg-item-(?!thb-)[A-Za-z0-9_-]+|cs-avatar-(?:partner|user)|avatar-(?:partner|user))$/;
function kindOf(key) {
const k = String(key);
if (k.indexOf('avatar') >= 0) return 'avatar';
if (k.indexOf('desk-image-src') >= 0) return 'desk';
if (k.indexOf('card-bg') >= 0) return 'card';
if (k.indexOf('phone-bg') >= 0 || k.indexOf('page-bg') >= 0 || k.indexOf('cs-bg') >= 0) return 'wall';
return null;
}
function tokenHash(s) { const m = TOKEN_RE.exec(typeof s === 'string' ? s : ''); return m ? m[1] : null; }
function desktopIds(keys) {
const seen = {}, out = [];
const add = function (cid) { const c = String(cid || ''); if (!c || seen[c]) return; seen[c] = 1; out.push(c); };
try { (window.getContacts ? window.getContacts() : []).forEach(function (c) { if (c && c.id) add(c.id); }); } catch (e) {}
(keys || []).forEach(function (k) {
const m = /^xy-home-v2:([^:]+):(?:cc-groups|avatar-lib|avatar-me-lib)$/.exec(String(k));
if (m) add(m[1]);
});
return out;
}
function nameMap() {
const nm = {};
try { (window.getContacts ? window.getContacts() : []).forEach(function (c) { if (c && c.id) nm[String(c.id)] = c.name || String(c.id); }); } catch (e) {}
return nm;
}
function ccLibs(ids, nm) {
const out = [{ prefix: G, key: 'cc-groups-public', label: '公用字卡库' }];
ids.forEach(function (cid) {
out.push({ prefix: G + cid + ':', key: 'cc-groups', label: (nm[cid] || cid) + ' · 专属' });
});
out.push({ prefix: G, key: 'cc-groups', label: '旧版顶层字卡库（残留）' });
return out;
}
function avatarLibs(ids, nm) {
const out = [];
ids.forEach(function (cid) {
const label = nm[cid] || cid;
out.push({ prefix: G + cid + ':', key: 'avatar-lib', label: label + ' · 头像库' });
out.push({ prefix: G + cid + ':', key: 'avatar-me-lib', label: label + ' · 我的头像库' });
});
out.push({ prefix: G, key: 'avatar-lib', label: '旧版顶层头像库（残留）' });
out.push({ prefix: G, key: 'avatar-me-lib', label: '旧版顶层我的头像库（残留）' });
return out;
}
function parseCc(raw) {
try {
const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
const g = JSON.parse(s || 'null');
if (g && typeof g === 'object' && g.text) return g;
} catch (e) {}
return null;
}
function parseList(raw) {
try {
const a = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw) || 'null');
return Array.isArray(a) ? a : null;
} catch (e) { return null; }
}
function compressible(dataUrl, kind) {
if (typeof dataUrl !== 'string') return false;
if (dataUrl.indexOf('@@m:') === 0) return false;        // 令牌本身不是图；真身由池条目路径单独处理
if (dataUrl.indexOf('data:image/') !== 0) return false; // 只处理本地 base64 图（远程链接/语音不碰）
if (/^data:image\/gif/i.test(dataUrl)) return false;    // 动图重压会丢动画
if (/^data:image\/svg/i.test(dataUrl)) return false;    // SVG 占位/图标走位图重压会失真（且可能变大）
if (dataUrl.length > 8 * 1024 * 1024) return false;     // 超大全站不解码（iOS 解码崩溃红线）
const kd = KIND[kind];
if (!kd) return false;
return dataUrl.length > kd.thr;
}
const CC_CATS = [['image', 'cc-img'], ['sticker', 'cc-stk']];
function walkCcLib(g, onCard) {
CC_CATS.forEach(function (p) {
const arr = g[p[0]];
if (!Array.isArray(arr)) return;
arr.forEach(function (tu) {
if (!Array.isArray(tu) || !Array.isArray(tu[1])) return;
tu[1].forEach(function (card, idx) { onCard(card, p[1], tu[1], idx); });
});
});
}
function ccTargets(g, keySet) {
const inline = [];
const hashes = {};
walkCcLib(g, function (card, kind, arr, idx) {
if (typeof card !== 'string') return;
const h = tokenHash(card);
if (h) { if (keySet[MEDIA_PREFIX + h]) hashes[h] = true; return; }
if (compressible(card, kind)) inline.push({ card: card, kind: kind, arr: arr, idx: idx });
});
return { inline: inline, hashes: hashes };
}
let __webpOk = null;
function webpSupported() {
if (__webpOk !== null) return __webpOk;
try {
const c = document.createElement('canvas');
c.width = 1; c.height = 1;
__webpOk = c.toDataURL('image/webp', 0.8).indexOf('data:image/webp') === 0;
} catch (e) { __webpOk = false; }
return __webpOk;
}
function compressOne(dataUrl, kind) {
return new Promise(function (resolve) {
const kd = KIND[kind];
if (!compressible(dataUrl, kind)) { resolve({ data: null, skip: 'not' }); return; }
const img = new Image();
img.onload = function () {
try {
if (img.width * img.height > 26000000) { resolve({ data: null, skip: 'pixels' }); return; }
const scale = Math.min(1, kd.maxSide / Math.max(img.width, img.height));
const w = Math.max(1, Math.round(img.width * scale));
const h = Math.max(1, Math.round(img.height * scale));
const keepPng = kind === 'cc-stk' || (/^data:image\/png/i.test(dataUrl) && kd.format === 'image/jpeg');
let format = keepPng ? 'image/png' : kd.format;
if (format === 'image/jpeg' && webpSupported()) format = 'image/webp';
const c = document.createElement('canvas');
c.width = w; c.height = h;
const ctx = c.getContext('2d');
if (format === 'image/jpeg' || format === 'image/webp') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
ctx.drawImage(img, 0, 0, w, h);
const out = c.toDataURL(format, kd.quality);
resolve(out ? { data: out, skip: 'ok' } : { data: null, skip: 'encode' });
} catch (e) { resolve({ data: null, skip: 'err' }); }
};
img.onerror = function () { resolve({ data: null, skip: 'decode' }); };
img.src = dataUrl;
});
}
function writeBack(prefix, key, val) {
const p = String(prefix).charAt(String(prefix).length - 1) === ':' ? String(prefix).slice(0, -1) : String(prefix);
window.xyStore(p).set(key, val);
}
function emptyScan() { return { ok: false, reason: '', cc: { n: 0, bytes: 0, pool: 0 }, beauty: { n: 0, bytes: 0 }, avatar: { n: 0, bytes: 0 }, desksN: 0, detail: [] }; }
window.mochiImgScan = function () {
return (async function () {
const out = emptyScan();
if (!window.idbListKeys || !window.idbGet) { out.reason = '接口不可用'; return out; }
const keys = await window.idbListKeys();
if (!keys) { out.reason = '键清单读取失败（存储繁忙），稍后再试'; return out; }
const keySet = {};
keys.forEach(function (k) { keySet[String(k)] = true; });
const ids = desktopIds(keys);
const nm = nameMap();
out.desksN = ids.length;
const poolHashes = {};
const libs = ccLibs(ids, nm).filter(function (L) { return keySet[L.prefix + L.key]; });
for (let i = 0; i < libs.length; i++) {
const L = libs[i];
const raw = await window.idbGet(L.prefix + L.key);
if (raw === undefined || raw === null) {
out.detail.push({ label: L.label, skip: true });
out.reason = out.reason || '字卡库「' + L.label + '」没读到（存储繁忙），结果可能不全';
continue;
}
const g = parseCc(raw);
if (!g) { out.detail.push({ label: L.label, n: 0, bytes: 0, pool: 0 }); continue; }
const t = ccTargets(g, keySet);
let n = 0, bytes = 0;
t.inline.forEach(function (x) { n++; bytes += x.card.length * 2; });
const hs = Object.keys(t.hashes);
hs.forEach(function (h) { poolHashes[h] = true; });
out.cc.n += n; out.cc.bytes += bytes;
out.detail.push({ label: L.label, n: n, bytes: bytes, pool: hs.length });
}
const phList = Object.keys(poolHashes);
for (let i = 0; i < phList.length; i++) {
const v = await window.idbGet(MEDIA_PREFIX + phList[i]);
if (typeof v === 'string' && compressible(v, 'media')) { out.cc.n++; out.cc.bytes += v.length * 2; out.cc.pool++; }
}
const avLibs = avatarLibs(ids, nm).filter(function (L) { return keySet[L.prefix + L.key]; });
for (let i = 0; i < avLibs.length; i++) {
const L = avLibs[i];
const raw = await window.idbGet(L.prefix + L.key);
if (raw === undefined || raw === null) { out.detail.push({ label: L.label, skip: true }); continue; }
const list = parseList(raw);
if (!list) { out.detail.push({ label: L.label, n: 0, bytes: 0 }); continue; }
let n = 0, bytes = 0;
list.forEach(function (u) { if (compressible(u, 'avatar')) { n++; bytes += u.length * 2; } });
out.avatar.n += n; out.avatar.bytes += bytes;
out.detail.push({ label: L.label, n: n, bytes: bytes });
}
let bn = 0, bb = 0;
const beautyKeys = keys.filter(function (k) { return BEAUTY_RE.test(String(k)); });
for (let i = 0; i < beautyKeys.length; i++) {
const k = String(beautyKeys[i]);
const kind = kindOf(k);
if (!kind) continue;
const v = await window.idbGet(k);
if (typeof v !== 'string' || !compressible(v, kind)) continue;
bn++; bb += v.length * 2;
}
out.beauty.n = bn; out.beauty.bytes = bb;
out.ok = true;
return out;
})().catch(function (e) {
const o = emptyScan();
o.reason = '扫描异常：' + ((e && e.message) || e);
return o;
});
};
window.mochiImgCompress = function (source) {
return (async function () {
const out = { ok: false, reason: '', source: source, processed: 0, saved: 0, skipped: 0 };
if (!window.idbListKeys || !window.idbGet || !window.xyStore) { out.reason = '接口不可用'; return out; }
const keys = await window.idbListKeys();
if (!keys) { out.reason = '键清单读取失败（存储繁忙），本次未压缩'; return out; }
const keySet = {};
keys.forEach(function (k) { keySet[String(k)] = true; });
const ids = desktopIds(keys);
const nm = nameMap();
const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
const reasons = [];
if (source === 'all' || source === 'cc') {
const poolHashes = {};
const libs = ccLibs(ids, nm).filter(function (L) { return keySet[L.prefix + L.key]; });
for (let i = 0; i < libs.length; i++) {
const L = libs[i];
const raw = await window.idbGet(L.prefix + L.key);
if (raw === undefined || raw === null) { reasons.push('字卡库「' + L.label + '」没读到，跳过'); continue; }
const g = parseCc(raw);
if (!g) continue;
const t = ccTargets(g, keySet);
Object.keys(t.hashes).forEach(function (h) { poolHashes[h] = true; });
let changed = false;
for (let k = 0; k < t.inline.length; k++) {
const x = t.inline[k];
const r = await compressOne(x.card, x.kind);
if (!r.data) { out.skipped++; continue; }
const oldLen = x.card.length;
const newLen = r.data.length;
if (newLen < oldLen * 0.9) { // 产物至少小 10% 才替换，绝不变大/变糊
x.arr[x.idx] = r.data;
changed = true;
out.processed++;
out.saved += (oldLen - newLen) * 2;
} else { out.skipped++; }
await tick();
}
if (changed) {
let s = '';
try { s = JSON.stringify(g); } catch (e) { reasons.push('字卡库「' + L.label + '」写回序列化失败，跳过'); continue; }
try { writeBack(L.prefix, L.key, s); }
catch (e) { reasons.push('字卡库「' + L.label + '」写回失败：' + ((e && e.message) || e)); }
}
await tick();
}
const phList = Object.keys(poolHashes);
for (let i = 0; i < phList.length; i++) {
const h = phList[i];
const v = await window.idbGet(MEDIA_PREFIX + h);
if (typeof v !== 'string' || !compressible(v, 'media')) { continue; }
const r = await compressOne(v, 'media');
if (!r.data) { out.skipped++; continue; }
if (r.data.length < v.length * 0.9) {
if (!window.mochiMediaReplace) { out.skipped++; reasons.push('媒体池替换接口不可用，池内图片跳过'); }
else {
let ok = false;
try { ok = await window.mochiMediaReplace(h, r.data); } catch (e) { ok = false; }
if (ok) { out.processed++; out.saved += (v.length - r.data.length) * 2; }
else { out.skipped++; reasons.push('媒体池条目写回失败（' + h.slice(0, 8) + '…）'); }
}
} else { out.skipped++; }
await tick();
}
}
if (source === 'all' || source === 'beauty') {
const avLibs = avatarLibs(ids, nm).filter(function (L) { return keySet[L.prefix + L.key]; });
for (let i = 0; i < avLibs.length; i++) {
const L = avLibs[i];
const raw = await window.idbGet(L.prefix + L.key);
if (raw === undefined || raw === null) { reasons.push('头像库「' + L.label + '」没读到，跳过'); continue; }
const list = parseList(raw);
if (!list) continue;
let changed = false;
for (let j = 0; j < list.length; j++) {
const u = list[j];
if (!compressible(u, 'avatar')) continue;
const r = await compressOne(u, 'avatar');
if (!r.data) { out.skipped++; continue; }
if (r.data.length < u.length * 0.9) {
list[j] = r.data;
changed = true;
out.processed++;
out.saved += (u.length - r.data.length) * 2;
} else { out.skipped++; }
await tick();
}
if (changed) {
let s = '';
try { s = JSON.stringify(list); } catch (e) { reasons.push('头像库「' + L.label + '」写回序列化失败，跳过'); continue; }
try { writeBack(L.prefix, L.key, s); }
catch (e) { reasons.push('头像库「' + L.label + '」写回失败：' + ((e && e.message) || e)); }
}
await tick();
}
const beautyKeys = keys.filter(function (k) { return BEAUTY_RE.test(String(k)); });
for (let i = 0; i < beautyKeys.length; i++) {
const k = String(beautyKeys[i]);
const kind = kindOf(k);
if (!kind) continue;
const v = await window.idbGet(k);
if (typeof v !== 'string' || !compressible(v, kind)) continue;
const r = await compressOne(v, kind);
if (!r.data) { out.skipped++; continue; }
const oldLen = v.length;
const newLen = r.data.length;
if (newLen < oldLen * 0.9) {
const k0 = k.slice(0, k.lastIndexOf(':')); // 去尾冒号：xyStore 会自己拼 ':' + bare
const bare = k.slice(k.lastIndexOf(':') + 1);
try { window.xyStore(k0).set(bare, r.data); out.processed++; out.saved += (oldLen - newLen) * 2; }
catch (e) { reasons.push('美化图片「' + bare + '」写回失败：' + ((e && e.message) || e)); }
} else { out.skipped++; }
await tick();
}
}
if (reasons.length) out.reason = reasons.join('；');
out.ok = true;
return out;
})().catch(function (e) { return { ok: false, reason: '压缩异常：' + ((e && e.message) || e), source: source, processed: 0, saved: 0, skipped: 0 }; });
};
function fmtBytes(n) {
n = Number(n) || 0;
if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
return n + ' B';
}
function toast(msg) {
try {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._icT); t._icT = setTimeout(function () { t.className = 'cc-toast'; }, 3600);
} catch (e) {}
}
function totals(rep) {
const cc = (rep && rep.cc) || {}, b = (rep && rep.beauty) || {}, a = (rep && rep.avatar) || {};
return { n: (cc.n || 0) + (b.n || 0) + (a.n || 0), bytes: (cc.bytes || 0) + (b.bytes || 0) + (a.bytes || 0) };
}
function refreshRow(rep) {
const el = document.getElementById('st-img-compress');
if (!el || !rep) return;
const t = totals(rep);
const cc = rep.cc || {}, b = rep.beauty || {}, a = rep.avatar || {};
el.textContent = t.n ? ('字卡库 ' + (cc.n || 0) + ' 张 · 头像库 ' + (a.n || 0) + ' 张 · 美化 ' + (b.n || 0) + ' 张，共约 ' + fmtBytes(t.bytes)) : '无（未发现偏大图片）';
}
function refreshRowAfter(res, source) {
const el = document.getElementById('st-img-compress');
if (!el || !res) return;
const s = source === 'cc' ? '字卡库' : source === 'beauty' ? '头像库+美化' : '字卡库+头像库+美化';
el.textContent = '已压缩 ' + res.processed + ' 张（' + s + '），释放约 ' + fmtBytes(res.saved) + '，可重新扫描';
}
function runCompress(source) {
if (!window.mochiImgCompress) return;
toast('正在压缩图片（图片较多时较慢，请勿离开本页）…');
window.mochiImgCompress(source).then(function (res) {
if (!res || !res.ok) { toast('压缩未完成：' + ((res && res.reason) || '未知原因')); return; }
toast('已压缩 ' + res.processed + ' 张，释放约 ' + fmtBytes(res.saved) + (res.skipped ? '（跳过 ' + res.skipped + ' 张：动图/已较小/压缩后不更小则不替换）' : ''));
refreshRowAfter(res, source);
try { if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite(); } catch (e) {}
try { document.dispatchEvent(new CustomEvent('mochi-img-compressed')); } catch (e) {}
}).catch(function () { toast('压缩异常，请稍后重试'); });
}
function detailLines(rep) {
const d = (rep && rep.detail) || [];
if (!d.length) return [];
const lines = ['已扫描的来源（含 0 张，用于核对每个桌面都扫到了）：'];
const max = 12;
d.slice(0, max).forEach(function (x) {
if (x.skip) { lines.push('· ' + x.label + '：没读到（存储繁忙），本次结果可能不全'); return; }
const extra = x.pool ? '，另有媒体池引用 ' + x.pool + ' 张' : '';
lines.push('· ' + x.label + '：' + (x.n || 0) + ' 张' + extra);
});
if (d.length > max) lines.push('· 其余 ' + (d.length - max) + ' 个来源略（多为 0 张）');
return lines;
}
function scanThenModal() {
if (!window.mochiImgScan || !window.mochiImgCompress || !window.openModal) { toast('当前环境不支持，请在支持 IndexedDB 的设备上使用'); return; }
toast('正在扫描图片（大库较慢，请稍候）…');
window.mochiImgScan().then(function (rep) {
if (!rep || !rep.ok) {
if (window.openModal) window.openModal('扫描未完成', '', null, { noInput: true, staticText: ((rep && rep.reason) || '未知原因') + '\n\n没有改动任何数据，稍后存储空闲时可再试。' });
return;
}
refreshRow(rep);
const cc = rep.cc || {}, b = rep.beauty || {}, a = rep.avatar || {};
const t = totals(rep);
if (!t.n) {
if (window.openModal) window.openModal('压缩图片', '', null, { noInput: true, staticText: '没有可压缩的图片。\n\n已扫描 ' + (rep.desksN || 1) + ' 个桌面（公用字卡库 + 各桌面专属字卡库 + 各桌面头像库 + 美化图片）。\n\n只压缩「明显偏大」的存量图（字卡图片/表情约 >100KB、头像库约 >80KB、壁纸/背景约 >400KB、桌面图片约 >200KB 等）。动图（GIF）、已较小的图、库内图片真身所在的媒体池条目（按聊天发图同标准 720px）都会在别的入口处理。' });
return;
}
const lines = [
'扫描结果（已扫 ' + (rep.desksN || 1) + ' 个桌面）：',
'· 字卡库上传的图片：' + (cc.n || 0) + ' 张，约 ' + fmtBytes(cc.bytes || 0) + (cc.pool ? '（其中媒体池去重条目 ' + cc.pool + ' 张）' : ''),
'· 头像互动的头像库：' + (a.n || 0) + ' 张，约 ' + fmtBytes(a.bytes || 0),
'· 美化里上传的图片：' + (b.n || 0) + ' 张，约 ' + fmtBytes(b.bytes || 0),
'',
'压缩规则：把偏大的存量图按「新上传」相同的清晰标准重压（字卡图片/媒体池图 最长边 720px、表情包 480px、壁纸/背景 2880px、卡片背景 1000px、桌面图片 1280px、头像 256px，质量 0.85）。支持 WebP 的浏览器照片类自动改存 WebP，同清晰度体积更小；表情包仍为 PNG。压缩产物不小于原图时不替换；动图（GIF）与 SVG 图标不动，超大原图（>8MB）为防崩溃不解码。',
'',
'⚠️ 压缩会覆盖原图（替换成更小的版本），原图不留底、不可撤销。建议先导出备份：设置 → 数据备份 → 导出（或云端备份），备份里保留压缩前的原图。',
'',
'压缩后图片依旧清晰，存储占用明显变小；「查看存储」的总占用会同步刷新。',
''
];
lines.push.apply(lines, detailLines(rep));
lines.push('', '选择压缩范围：');
if (window.openModal) window.openModal('压缩图片', '', function (v) {
runCompress(v || 'all');
}, { noInput: true, staticText: lines.join('\n'), pills: [
{ label: '全部压缩', value: 'all' },
{ label: '仅字卡库图片', value: 'cc' },
{ label: '仅头像库+美化', value: 'beauty' }
], pill: 'all' });
}).catch(function () { toast('扫描异常，请稍后重试'); });
}
const row = document.getElementById('row-img-compress');
if (row) row.addEventListener('click', scanThenModal);
const btn = document.getElementById('st-img-compress-btn');
if (btn) btn.addEventListener('click', scanThenModal);
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("img-compress.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("img-compress.js"); try { console.error("[JS] img-compress.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[img-compress.js] " + String(__e && __e.message || __e)); } })();
(function () { try {
(function () {
const LS_HEADROOM = 512 * 1024;
const SNAPSHOT_KEY = 'xy-home-v2:__auto-backup-snapshot';
const IMPORT_LOG_KEY = 'xy-home-v2:__import-log';
function toast(msg) {
let t = document.getElementById('cc-toast');
if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
t.textContent = msg;
t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
clearTimeout(t._timer);
t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2600);
}
function impEl() {
let el = document.getElementById('cc-import-progress');
if (!el) {
el = document.createElement('div');
el.id = 'cc-import-progress';
el.className = 'cc-import-progress';
el.innerHTML = '<div class="cc-ip-box">' +
'<div class="cc-ip-title" id="cc-ip-title">正在导入…</div>' +
'<div class="cc-ip-bar"><div class="cc-ip-fill" id="cc-ip-fill"></div></div>' +
'<div class="cc-ip-sub" id="cc-ip-sub"></div></div>';
document.body.appendChild(el);
}
return el;
}
function impShow(title, sub, pct) {
const el = impEl();
el.hidden = false;
const t = document.getElementById('cc-ip-title');
const s = document.getElementById('cc-ip-sub');
const f = document.getElementById('cc-ip-fill');
if (t) t.textContent = title;
if (s) s.textContent = sub || '';
if (f) f.style.width = (pct == null ? '' : Math.max(0, Math.min(100, pct)) + '%');
}
function impHide() {
const el = document.getElementById('cc-import-progress');
if (el) el.hidden = true;
}
function byteLen(s) {
if (s == null) return 0;
if (typeof s !== 'string') s = JSON.stringify(s);
let n = 0;
for (let i = 0; i < s.length; i++) {
const c = s.charCodeAt(i);
n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0xD800 || c > 0xDFFF ? 3 : 4;
}
return n;
}
function fmtLocalTime(iso) {
if (!iso) return '未知';
const d = new Date(iso);
if (isNaN(d.getTime())) return '未知';
const p = (n) => String(n).padStart(2, '0');
return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function localDateStr(d) {
const p = (n) => String(n).padStart(2, '0');
return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function readFileText(file) {
return new Promise((resolve) => {
const rd = { text: '', err: null, why: '' };
function done(why) { rd.why = why; resolve(rd); }
if (typeof file.text === 'function') {
file.text().then((t) => {
if (t === '' && file.size > 0) readViaReader();
else { rd.text = String(t); done(t === '' ? 'zero-byte' : 'text-ok'); }
}).catch((e) => { rd.err = e; readViaReader(); });
} else readViaReader();
function readViaReader() {
const r = new FileReader();
r.onload = () => {
rd.text = String(r.result || '');
if (rd.text !== '') { rd.err = null; done('reader-ok'); }
else done(rd.err ? 'unreadable' : 'reader-empty');
};
r.onerror = () => {
if (!rd.err) rd.err = new Error('读取失败：FileReader 无法读出文件内容');
done('unreadable');
};
r.readAsText(file, 'utf-8');
}
});
}
function impLog(w) { try { if (window.mochiImportLog) window.mochiImportLog('backup:' + w); } catch (e) {} }
function blobToBase64(blob) {
return blob.arrayBuffer().then((buf) => {
const bytes = new Uint8Array(buf);
const CHUNK = 3 * 5120; // 15360 字节，3 的倍数
let out = '';
for (let i = 0; i < bytes.length; i += CHUNK) {
const end = Math.min(i + CHUNK, bytes.length);
let bin = '';
for (let j = i; j < end; j++) bin += String.fromCharCode(bytes[j]);
out += btoa(bin);
}
return out;
});
}
const PACK_MERGE = 4 * 1024 * 1024;   // 每 ~4MB 合并一次进 Blob（Blob 拼接是引用合并、不复制内存）
const PACK_SLICE = 1 * 1024 * 1024;   // 超长字符串一次转义的分片长度（分片转义拼接＝整体转义）
const PACK_DEPTH = 3;                 // 容器下钻层数：值→元素→子元素；再深才整包 stringify
const PACK_YIELD = 64;                // 每写这么多个片段让出一次主线程（防空屏假死/ANR）
function createJsonPack() {
const parts = [];
let len = 0, since = 0, blob = null;
const flush = () => {
if (!parts.length) return;
blob = new Blob(blob ? [blob].concat(parts) : parts, { type: 'application/json;charset=utf-8' });
parts.length = 0;
len = 0;
};
return {
push(s) { if (!s) return; parts.push(s); len += s.length; if (len >= PACK_MERGE) flush(); },
tick() {
if (++since < PACK_YIELD) return Promise.resolve();
since = 0;
return new Promise((r) => setTimeout(r, 0));
},
finish() { flush(); return blob || new Blob([], { type: 'application/json;charset=utf-8' }); }
};
}
function packString(pack, s) {
if (s.length <= PACK_SLICE) { pack.push(JSON.stringify(s)); return; }
pack.push('"');
let i = 0;
while (i < s.length) {
let end = Math.min(i + PACK_SLICE, s.length);
if (end < s.length && s.charCodeAt(end - 1) >= 0xD800 && s.charCodeAt(end - 1) <= 0xDBFF) end--;
if (end <= i) end = i + 1;
pack.push(JSON.stringify(s.slice(i, end)).slice(1, -1));
i = end;
}
pack.push('"');
}
function isPlainObject(v) {
const p = Object.getPrototypeOf(v);
return p === Object.prototype || p === null;
}
async function packValue(pack, v, depth, cfg, stat) {
if (v === null || v === undefined) { pack.push('null'); return; }
const t = typeof v;
if (t === 'string') {
if (cfg.strip && v.length > 1024 && /^data:[^,]*;base64,/i.test(v.slice(0, 64))) {
stat.stripCnt++; stat.stripChars += v.length;
pack.push('""');
return;
}
packString(pack, v);
return;
}
if (t === 'number') { pack.push(isFinite(v) ? String(v) : 'null'); return; }
if (t === 'boolean') { pack.push(v ? 'true' : 'false'); return; }
if (depth < PACK_DEPTH) {
if (Array.isArray(v)) {
pack.push('[');
for (let i = 0; i < v.length; i++) {
if (i) pack.push(',');
await packValue(pack, v[i], depth + 1, cfg, stat);
if (stat.own) v[i] = null; // 值来自 IDB 读取（本次导出的私有副本）→ 序列化完即释放
if (depth === 0) await pack.tick();
}
pack.push(']');
return;
}
if (t === 'object' && isPlainObject(v)) {
const keys = Object.keys(v);
pack.push('{');
let wrote = false;
for (let i = 0; i < keys.length; i++) {
const child = v[keys[i]];
if (child === undefined || typeof child === 'function') continue;
if (wrote) pack.push(',');
wrote = true;
pack.push(JSON.stringify(keys[i]) + ':');
await packValue(pack, child, depth + 1, cfg, stat);
if (stat.own) { try { delete v[keys[i]]; } catch (e) {} }
if (depth === 0) await pack.tick();
}
pack.push('}');
return;
}
}
const whole = JSON.stringify(v);
pack.push(whole === undefined ? 'null' : whole);
}
function overSmallLimit(v, limit) {
try {
if (typeof v === 'string') return v.length > limit;
if (v instanceof Blob) return v.size > limit;
if (Array.isArray(v)) {
let n = 0;
for (let i = 0; i < v.length; i++) {
const m = v[i];
if (typeof m === 'string') n += m.length;
else if (m && typeof m === 'object') {
if (typeof m.text === 'string') n += m.text.length;
if (typeof m.img === 'string') n += m.img.length;
if (typeof m.voice === 'string') n += m.voice.length;
const ps = m.parts;
if (Array.isArray(ps)) for (let j = 0; j < ps.length; j++) { const p = ps[j]; if (p && typeof p.v === 'string') n += p.v.length; }
n += 64;
} else n += 32;
if (n > limit) return true;
}
return false;
}
if (v && typeof v === 'object') {
const ks = Object.keys(v);
let n = 0;
for (let i = 0; i < ks.length; i++) {
const m = v[ks[i]];
if (typeof m === 'string') n += m.length;
else if (m && typeof m === 'object') n += 2048;
else n += 32;
n += ks[i].length;
if (n > limit) return true;
}
return false;
}
return false;
} catch (e) { return true; }
}
async function jsonToBlobStreaming(meta, readNext, small) {
const pack = createJsonPack();
const cfg = meta.cfg;
const stat = { own: false, stripCnt: 0, stripChars: 0 };
let first = true;
let chunk = '{"version":"1.0","app":"mochi-zika","exportTime":' + JSON.stringify(meta.exportTime) + ',"idb":{';
while (true) {
const ent = await readNext();
if (!ent) break;
chunk += (first ? '' : ',') + JSON.stringify(ent.k) + ':';
first = false;
pack.push(chunk);
chunk = '';
stat.own = ent.own === true;
await packValue(pack, ent.v, 0, cfg, stat);
await pack.tick();
}
pack.push(chunk + '},"ls":{');
const sKeys = Object.keys(small);
for (let i = 0; i < sKeys.length; i++) {
if (i) pack.push(',');
stat.own = false; // 小键值是 localStorage 原串/别处共用的值，一律不动源
pack.push(JSON.stringify(sKeys[i]) + ':');
await packValue(pack, small[sKeys[i]], 1, cfg, stat);
}
pack.push('}}');
pack.stat = stat;
return pack;
}
const LS_SMALL_LIMIT = 20 * 1024;        // ≤ 此体积的键进备份的 ls 段（localStorage），其余进 idb 段
const MODE_IMPORT_WARN = 120 * 1024 * 1024; // 成品文件超过这个体积就如实提示「新设备可能导不回」
const MUSIC_KEY_RE = /:music-file:/;      // 本地上传音乐的文件体：最占体积、且新设备上可重新添加
const MEDIA_POOL_KEY_RE = /^xy-home-v2:media:[0-9a-f]{32}$/;
const CHAT_KEY_RE = /(?:^|:)(?:chat-msgs|chat-blk-idx|chat-blk-[0-9]+)$/;
const GROUP_CHAT_KEY_RE = /^xy-home-v2:(?:group-chat-msgs|gc-msgs-.+)$/;
function isChatMsgKey(k) { return CHAT_KEY_RE.test(k) || GROUP_CHAT_KEY_RE.test(k); }
function isAuthorityKey(k) { return /:chat-msgs$/.test(k) || /:chat-blk-(?:idx|[0-9]+)$/.test(k) || GROUP_CHAT_KEY_RE.test(k) || /:feed-posts$/.test(k); } // #722：块键是 IDB 权威（LS 无副本）
const MEDIA_TOKEN_RE = /@@m:([0-9a-f]{32})/g;
const UTF8_SAMPLE = 512;
function estUtf8Bytes(s, esc) {
const str = String(s == null ? '' : s);
const n = str.length;
if (!n) return 0;
const m = n < UTF8_SAMPLE ? n : UTF8_SAMPLE;
let extra = 0, quoted = 0; // extra＝相对「1 字节/字符」多出的字节；quoted＝转义后会多 1 字节的字符数
for (let i = 0; i < m; i++) {
const c = str.charCodeAt(i);
if (c > 127) extra += c > 2047 ? 2 : 1;
else if (esc && (c === 34 || c === 92 || c < 32)) quoted++;
}
return Math.round(n * (1 + extra / m + (esc ? quoted / m : 0)));
}
function collectMediaHashes(v, out) {
const scan = (s) => {
if (typeof s !== 'string' || s.indexOf('@@m:') < 0) return;
MEDIA_TOKEN_RE.lastIndex = 0;
let m;
while ((m = MEDIA_TOKEN_RE.exec(s))) out.add(m[1]);
};
try {
if (typeof v === 'string') { scan(v); return; }
if (!Array.isArray(v)) return;
for (let i = 0; i < v.length; i++) {
const m = v[i];
if (!m || typeof m !== 'object') continue;
scan(m.text); scan(m.img); scan(m.voice);
if (m.quote && typeof m.quote === 'object') {
scan(m.quote.t);
if (Array.isArray(m.quote.imgs)) for (let j = 0; j < m.quote.imgs.length; j++) scan(m.quote.imgs[j]);
}
if (Array.isArray(m.parts)) for (let j = 0; j < m.parts.length; j++) { const p = m.parts[j]; if (p && typeof p === 'object') scan(p.v); }
}
} catch (e) {}
}
function exportCfg(mode) {
if (mode === 'no-music') return { mode: mode, label: '不含音乐文件', note: '不含本地音乐文件', skip: (k) => MUSIC_KEY_RE.test(k), strip: false };
if (mode === 'text') return { mode: mode, label: '只备份文字', note: '不含图片/语音/音乐附件', skip: (k) => MUSIC_KEY_RE.test(k) || MEDIA_POOL_KEY_RE.test(k), strip: true };
if (mode === 'chat') return { mode: mode, label: '仅聊天记录', note: '只含各桌面聊天与群聊记录', skip: (k) => !isChatMsgKey(k), strip: false, mediaRefs: true };
return { mode: 'full', label: '完整备份', note: '全部数据完整', skip: () => false, strip: false };
}
let expStage = '';
let expKey = '';
let expKeyBytes = 0;
async function doExport(mode) {
const cfg = exportCfg(mode);
try {
await runExport(cfg);
} catch (e) {
impHide();
reportExportError(e, cfg);
}
}
function reportExportError(e, cfg) {
const msg = (e && (e.message || String(e))) || '未知错误';
const isLen = /string length/i.test(msg);
const at = (expStage ? '\n出错环节：' + expStage : '') +
(expKey ? '\n涉及数据：' + expKey + (expKeyBytes ? '（约 ' + fmtSize(expKeyBytes) + '）' : '') : '');
const advice = isLen
? '\n根因：这台设备的数据量已超出浏览器一次能生成的字符串上限，单个文件的完整备份做不到。\n' +
'请重新点「导出数据」改选「不含音乐文件」或「只备份文字」；确实要一份全量备份，' +
'先用「查看存储」清掉不再需要的音乐/图片附件后再导。'
: '\n请重新点「导出数据」再试一次；反复失败时先重启浏览器（释放被占满的内存）再导，' +
'或改选范围更小的备份。';
if (window.openModal) {
window.openModal('导出未完成', '', function () {}, {
noInput: true, okText: '知道了', big: true,
staticText: '「' + cfg.label + '」中途失败。本机数据没有任何改动（导出不写不删业务键），已生成的临时文件会自动释放。\n' +
'原因：' + msg + at + advice
});
} else {
toast('导出未完成：' + msg);
}
}
function measureProject() {
return new Promise((resolve) => {
impShow('正在准备导出…', '正在统计本机数据体积…', 8);
const lsChars = {};   // 键 → 存储口径字符数（×2＝UTF-16 字节）
const lsFile = {};    // 键 → 文件口径字节数（UTF-8），去重减项要用同一口径
let projFile = 0, projStorage = 0, musicFile = 0;
let chatFile = 0;
const poolSize = {};
const mediaRefs = new Set();
try {
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || k.indexOf('xy-home-v2:') !== 0 || k === SNAPSHOT_KEY) continue;
const v = localStorage.getItem(k) || '';
const c = k.length + v.length;
const fbVal = estUtf8Bytes(v, true);
lsChars[k] = v.length;
lsFile[k] = fbVal;
projFile += k.length + fbVal; projStorage += c * 2;
if (isChatMsgKey(k)) { chatFile += k.length + fbVal; collectMediaHashes(v, mediaRefs); }
}
} catch (e) {}
const finish = (ok) => {
if (ok) {
mediaRefs.forEach(function (h) {
const s = poolSize['xy-home-v2:media:' + h];
if (s) chatFile += s;
});
}
resolve({ ok: ok, projFile: projFile, projStorage: projStorage, musicFile: musicFile, chatFile: chatFile });
};
const listFn = window.idbListKeys;
if (!listFn || !window.idbGetMany) { finish(false); return; }
Promise.resolve(listFn()).then(function (keys) {
if (!keys) { finish(false); return; }
const list = keys.filter(function (k) {
const s = String(k || '');
return s.indexOf('xy-home-v2:') === 0 && s !== SNAPSHOT_KEY;
});
const BATCH = 80;
let pos = 0;
const step = function () {
if (pos >= list.length) { finish(true); return; }
const batch = list.slice(pos, pos + BATCH);
pos += batch.length;
window.idbGetMany(batch).then(function (map) {
batch.forEach(function (k) {
const v = map[k];
let c = 0, fb = 0, blob = 0;
try {
if (typeof v === 'string') { c = v.length; fb = estUtf8Bytes(v, true); }
else if (typeof Blob !== 'undefined' && v instanceof Blob) { blob = v.size; fb = Math.round(blob * 4 / 3); }
else if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) { blob = v.byteLength; fb = Math.round(blob * 4 / 3); }
else if (v !== undefined && v !== null) { const js = JSON.stringify(v); c = js.length; fb = estUtf8Bytes(js); }
} catch (e) { c = 0; fb = 0; }
const isMusic = MUSIC_KEY_RE.test(String(k));
const lsC = lsChars[k];
const isChat = isChatMsgKey(String(k));
const keyBytes = String(k).length; // 键名也要进文件（JSON 里每个键都带名字），且只算一次
const auth = isAuthorityKey(String(k));
if (lsC !== undefined && lsC <= LS_SMALL_LIMIT && !auth) { c = 0; fb = 0; blob = 0; }
else if (lsC !== undefined) {
projFile -= keyBytes + (lsFile[k] || 0);
projStorage -= (keyBytes + lsC) * 2;
if (isChat) chatFile -= keyBytes + (lsFile[k] || 0);
} else {
projFile += keyBytes;             // LS 里没有这个键 → 键名只由这里计一次
if (isChat) chatFile += keyBytes;
}
projFile += fb;
projStorage += c * 2 + blob;
if (isMusic) musicFile += fb;
if (isChat) { chatFile += fb; collectMediaHashes(v, mediaRefs); }
if (MEDIA_POOL_KEY_RE.test(String(k))) poolSize[String(k)] = fb + (lsC === undefined ? keyBytes : 0);
});
impShow('正在准备导出…', '正在统计本机数据体积 ' + pos + '/' + list.length, Math.round(pos / Math.max(1, list.length) * 40));
setTimeout(step, 0);
}).catch(function () { setTimeout(step, 0); });
};
step();
}).catch(function () { finish(false); });
});
}
function askExportMode() {
return new Promise((resolve) => {
let settled = false;
const finish = (m) => { if (settled) return; settled = true; resolve(m); };
const ask = (info, usage) => {
impHide();
const bigRef = info ? info.projFile : usage;
if (!window.openModal) { finish('full'); return; }
const head = info
? ('本机数据约 ' + fmtSize(info.projStorage) +
(info.quota ? '（占配额 ' + Math.max(0.1, Math.round(info.projStorage / info.quota * 1000) / 10) + '%）' : '') +
'；预估文件：完整 ' + fmtSize(info.projFile) +
'、不含音乐 ' + fmtSize(Math.max(0, info.projFile - info.musicFile)) +
'、仅聊天记录 ' + fmtSize(info.chatFile || 0) + '、只备份文字更小。\n' +
'两个数口径不同：本机数据按存储占用算（1 字符 2 字节），文件按实际字节算（图片/语音的 base64 约 1 字符 1 字节、汉字 3 字节）——所以附件多时文件约为本机数据的一半，中文文字多时两者接近、文件甚至更大。\n')
: ('本机数据约 ' + fmtSize(usage) + '（整域名占用口径，含同域其他站点，仅供参考）。\n');
window.openModal('选择导出范围', '', function (v) {
finish(v || 'full');
}, {
noInput: true, okText: '开始导出', pill: 'full', lock: true, big: true,
pills: [{ label: '完整备份', value: 'full' }, { label: '不含音乐文件', value: 'no-music' },
{ label: '只备份文字', value: 'text' }, { label: '仅聊天记录', value: 'chat' },
{ label: '取消', value: 'cancel' }],
staticText: head +
'完整备份：全部数据（含音乐/图片/语音），文件最大，超过约 ' + fmtSize(MODE_IMPORT_WARN) + ' 时新设备可能导不回来。\n' +
'不含音乐：跳过本地上传的歌曲；只备份文字：再跳过图片语音——两者其余数据都完整。\n' +
'仅聊天记录：只要聊天——各桌面联系人（含默认桌面）与群聊的记录，消息引用的图片语音一并带走；设置/字卡/朋友圈/音乐不进文件。' +
(info ? '（体积为实测估算，以完成提示为准）' : '')
});
};
let estUsage = 0, estQuota = 0;
const estReady = new Promise((done) => {
try {
if (navigator.storage && navigator.storage.estimate) {
navigator.storage.estimate().then((est) => {
estUsage = (est && est.usage) || 0;
estQuota = (est && est.quota) || 0;
done();
}, () => done());
return;
}
} catch (e) {}
done();
});
measureProject().then((m) => {
return estReady.then(() => {
ask((m && m.ok) ? { projFile: m.projFile, projStorage: m.projStorage, musicFile: m.musicFile, chatFile: m.chatFile, quota: estQuota } : null, estUsage);
});
}).catch(() => { ask(null, estUsage); });
});
}
async function runExport(cfg) {
expStage = '读取本地数据';
expKey = '';
expKeyBytes = 0;
impShow('正在导出…', '正在读取全部数据', 3);
const exportTime = new Date().toISOString();
const small = {};
const cover = exportCoverage();
const lsBig = {};
try {
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || k.indexOf('xy-home-v2:') !== 0) continue;
if (k === SNAPSHOT_KEY) continue; // v3.7.0：副本键不进导出文件（防自包含无限增长）
if (k === IMPORT_LOG_KEY) continue; // #1272：LS 侧跳过导入回执键（本机取证不进备份文件）
if (cfg.skip(k)) continue; // #275 范围外键（文字模式的媒体池等）同样不进小键段，防 strip 剥成空串入库
const v = localStorage.getItem(k);
if (byteLen(v) > LS_SMALL_LIMIT || MEDIA_POOL_KEY_RE.test(k)) lsBig[k] = v; // 大键：留待 IndexedDB 权威读取
else { small[k] = v; cover.see(k, v); }
}
} catch (e) {}
const exportMissing = []; // 权威键降级记录（只剩有损快照或丢失）
let idbKeys = [];
if (window.idbListKeys || window.idbGetAllKeys) {
let listed = null;
try {
listed = window.idbListKeys ? await window.idbListKeys() : ((await window.idbGetAllKeys()) || []);
} catch (e) { listed = null; }
if (listed === null) {
impHide();
if (window.openModal) {
window.openModal('导出未完成', '', function () {}, {
noInput: true, okText: '知道了',
staticText: '没能读到本地数据库清单（浏览器存储繁忙或超时）。\n' +
'为避免生成一份「看着完整其实缺数据」的备份，本次导出已中止。\n' +
'请回到桌面稍等十几秒后再点「导出数据」；若多次失败，重启浏览器再试。'
});
} else {
toast('导出未完成：未能读取本地数据库，请稍候重试');
}
return;
}
idbKeys = listed;
}
function routeValue(k, v, own) {
cover.see(k, v);
if (isAuthorityKey(k)) { try { delete small[k]; } catch (e) {} } // 有损 LS 快照不得混进备份
if (MEDIA_POOL_KEY_RE.test(k)) {
try { delete small[k]; } catch (eSmall) {} // LS 侧若有旧副本（上一次错路由的遗留）一律让位给权威值
return { k: k, v: v, own: own };
}
if (!overSmallLimit(v, LS_SMALL_LIMIT)) { small[k] = v; return null; }
return { k: k, v: v, own: own };
}
const mediaRefs = new Set();
let mediaRefQueue = null, mediaRefCursor = 0;
const mediaRefSeen = {};
const estTotal = Math.max(1, idbKeys.length + Object.keys(lsBig).length);
let cursor = 0;      // idbKeys 游标
let tailKeys = null; // idbKeys 走完后，lsBig 里没被 IDB 收录的键（最终兜底）
let tailCursor = 0;
let skipped = 0;     // 按所选范围排除掉的键数（音乐文件等）
let skippedMedia = 0; // #275 文字模式跳过的媒体池条目数（单列，不混进音乐计数）
const pct = () => 8 + Math.round((idbKeys.length ? Math.min(cursor, idbKeys.length) / idbKeys.length : 1) * 78);
async function readNext() {
while (cursor < idbKeys.length) {
const k = idbKeys[cursor++];
expKey = k;
expKeyBytes = 0;
try {
if (k.indexOf('xy-home-v2:') !== 0) continue;
if (k === SNAPSHOT_KEY) continue; // v3.7.0：副本键不进导出文件
if (k === IMPORT_LOG_KEY) continue; // #1272：IDB 侧同样跳过导入回执键
if (k in small && !isAuthorityKey(k)) continue;
if (cfg.skip(k)) { skipped++; if (MEDIA_POOL_KEY_RE.test(k)) skippedMedia++; continue; } // 所选范围之外的键（本地音乐文件/文字模式媒体池）
impShow('正在导出…', '正在读取并打包 ' + Math.min(cursor, estTotal) + ' / ' + estTotal, pct());
let v = await window.idbGet(k);
if ((v === undefined || v === null) && lsBig[k] === undefined) {
for (let retry = 0; retry < 3 && (v === undefined || v === null); retry++) {
await new Promise(r => setTimeout(r, 200));
v = await window.idbGet(k);
}
}
if (v !== undefined && v !== null) {
expKeyBytes = typeof v === 'string' ? v.length * 2 : (v instanceof Blob ? v.size : 0);
if (cfg.mediaRefs) collectMediaHashes(v, mediaRefs);
if (v instanceof Blob) {
const ent = routeValue(k, 'data:' + (v.type || 'audio/mpeg') + ';base64,' + await blobToBase64(v), true);
delete lsBig[k]; // 已收录 IDB 权威值，不再回落 LS 兜底
if (ent) return ent; // 小值已并进 ls 段 → 继续拉下一个键
continue;
}
const ent = routeValue(k, v, true); // 权威值以 IDB 为准（含最新聊天记录）
delete lsBig[k];
if (ent) return ent;
continue;
} else if (window.idbGetCached && window.idbGetCached(k) !== undefined) {
const cv = window.idbGetCached(k);
expKeyBytes = typeof cv === 'string' ? cv.length * 2 : 0;
const ent = routeValue(k, cv, false);
delete lsBig[k];
if (ent) return ent;
continue;
} else if (lsBig[k] !== undefined) {
const sv = lsBig[k];
delete lsBig[k];
expKeyBytes = typeof sv === 'string' ? sv.length * 2 : 0;
if (isAuthorityKey(k)) exportMissing.push(k);
const ent = routeValue(k, sv, false);
if (ent) return ent;
continue;
} else {
try {
const lsV = localStorage.getItem(k);
if (lsV !== null) { const ent = routeValue(k, lsV, false); if (ent) return ent; }
} catch (e) {}
exportMissing.push(k);
}
} catch (e) {} // 单键失败跳过，继续导出其余键
}
if (cfg.mediaRefs) {
if (mediaRefQueue === null) mediaRefQueue = Array.from(mediaRefs);
while (mediaRefCursor < mediaRefQueue.length) {
const mk = 'xy-home-v2:media:' + mediaRefQueue[mediaRefCursor++];
if (mediaRefSeen[mk]) continue;
mediaRefSeen[mk] = 1;
expKey = mk;
expKeyBytes = 0;
impShow('正在导出…', '正在打包聊天图片/语音 ' + mediaRefCursor + ' / ' + mediaRefQueue.length, pct());
try {
const mv = await window.idbGet(mk);
if (mv === undefined || mv === null) continue;
const ment = routeValue(mk, mv, true);
if (ment) return ment; // 大条目交打包器流式写（小条目已并进 ls 段）
} catch (e) {}
}
}
if (tailKeys === null) tailKeys = Object.keys(lsBig);
while (tailCursor < tailKeys.length) {
const k = tailKeys[tailCursor++];
if (!(k in lsBig)) continue;
expKey = k;
if (cfg.skip(k)) { skipped++; continue; }
const v = lsBig[k];
delete lsBig[k];
expKeyBytes = typeof v === 'string' ? v.length * 2 : 0;
const ent = routeValue(k, v, false);
if (ent) return ent;
}
expKey = '';
expKeyBytes = 0;
return null;
}
impShow('正在导出…', '正在读取并打包数据', 8);
expStage = '打包数据文件';
const pack = await jsonToBlobStreaming({ exportTime: exportTime, cfg: cfg }, readNext, small);
const blob = pack.finish();
let coverText = (cfg.mode === 'full' ? '导出内容（全局全部数据）：\n' : '导出内容（' + cfg.label + '）：\n') + cover.lines().join('\n') + '\n——';
if (skipped) coverText += '\n· 按所选范围跳过本地音乐文件 ' + skipped + ' 个（到新设备重新添加即可）';
if (skippedMedia) coverText += '\n· 按所选范围跳过图片附件（媒体池条目）' + skippedMedia + ' 个（只备份文字＝图片不进文件）';
if (pack.stat.stripCnt) {
coverText += '\n· 按所选范围跳过图片/语音等媒体附件 ' + pack.stat.stripCnt + ' 处（约 ' +
fmtSize(pack.stat.stripChars * 2) + '，文字与设置全部保留）';
}
if (exportMissing.length) {
const nameOf = function (k) {
const tail = k.slice('xy-home-v2:'.length);
if (/:chat-msgs$/.test(k)) return '聊天记录(' + tail + ')';
if (/:feed-posts$/.test(k)) return '朋友圈(' + tail + ')';
if (/:cc-groups$/.test(k)) return '字卡库(' + tail + ')';
if (/:cc-groups-public$/.test(k)) return '公用字卡库(' + tail + ')';
if (/:quote-cards$/.test(k)) return '自定义字卡(' + tail + ')';
if (/:fav-msgs$/.test(k)) return '收藏(' + tail + ')';
if (/:avatar-/.test(k)) return '头像(' + tail + ')';
if (/:music-file:/.test(k)) return '音乐文件(' + tail + ')';
if (/:reply-/.test(k)) return '回复设置(' + tail + ')';
if (/:ta-/.test(k)) return 'TA回复字卡(' + tail + ')';
return tail;
};
const names = exportMissing.map(nameOf);
coverText += '\n⚠ 以下数据可能未完整导出（IDB 读取失败，仅拿到有损快照或丢失）：\n' + names.map(n => '· ' + n).join('\n') + '\n请勿清空原设备数据，建议重启浏览器后重新导出。';
}
if (blob.size > MODE_IMPORT_WARN) {
coverText += '\n⚠ 这个文件约 ' + fmtSize(blob.size) + '，新设备导入时要一次性读入整个文件，' +
'这么大有较大概率导入失败。建议重新点「导出数据」改选「不含音乐文件」或「只备份文字」再做一份。';
}
const fname = (cfg.mode === 'chat' ? 'mochi聊天记录_' : 'mochi数据备份_') + localDateStr(new Date()) + '.json';
const sizeStr = fmtSize(blob.size);
const doneText = '数据已导出（' + sizeStr + '，' + cfg.note + '）';
if (cfg.mode !== 'chat') {
try {
if (window.xyStore) window.xyStore('xy-home-v2').set('__last-backup', String(Date.now()));
else localStorage.setItem('xy-home-v2:__last-backup', String(Date.now()));
} catch (e) {}
}
impShow('正在导出…', '正在准备保存文件', 92);
const saveRes = await saveBackupFile(blob, fname);
impHide();
if (saveRes === 'ok') { toast(doneText); return; }
if (window.openModal) {
window.openModal('备份已打包完成（' + sizeStr + '）', '', () => {
afterDownloadAttempt(blob, fname, undefined, undefined,
doneText, '仍未触发下载。请重新点击「导出数据」并确认保存下载文件——这份文件是你的唯一备份');
}, { noInput: true, big: true, staticText: coverText + '\n数据已经打包好，还没开始保存。\n点「确定」开始下载保存到本机，点「取消」放弃本次保存。\n（请务必确认下载保存成功：本机不再另存副本，这个文件就是唯一备份）' });
} else {
toast('备份已打包（' + sizeStr + '），请重新点击「导出数据」触发下载并保存文件（唯一备份）');
}
}
async function saveBackupFile(blob, fname, shareTitle, saveTypes) {
const file = new File([blob], fname, { type: blob.type || 'application/json;charset=utf-8' });
const brokenFileShare = !!((window.mochiDevice || {}).env || {}).brokenFileShare;
const shareMax = 50 * 1024 * 1024;
if (!brokenFileShare && blob.size <= shareMax && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
try {
await navigator.share({ files: [file], title: shareTitle || 'mochi 数据备份' });
return 'ok';
} catch (e) {
if (e && e.name === 'AbortError') return 'cancel';
}
}
if (window.showSaveFilePicker) {
try {
const handle = await window.showSaveFilePicker({
suggestedName: fname,
types: saveTypes || [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }]
});
const w = await handle.createWritable();
await w.write(blob);
await w.close();
return 'ok';
} catch (e) {
if (e && e.name === 'AbortError') return 'cancel';
}
}
return 'blocked';
}
function anchorDownload(blob, fname) {
try {
const a = document.createElement('a');
const url = URL.createObjectURL(blob);
a.href = url;
a.download = fname;
document.body.appendChild(a);
a.click();
setTimeout(() => { try { if (a.parentNode) a.remove(); } catch (e) {} }, 5000);
setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 300000);
window.addEventListener('pagehide', function h() {
window.removeEventListener('pagehide', h);
try { URL.revokeObjectURL(url); } catch (e) {}
});
return true;
} catch (e) { return false; }
}
function downloadAskEnv() {
return !!((window.mochiDevice || {}).env || {}).downloadAsk;
}
function anchorDownloadDataUrl(blob, fname, cb) {
try {
if (!blob || blob.size > 30 * 1024 * 1024) { cb(false); return; }
const fr = new FileReader();
fr.onload = function () {
try {
const a = document.createElement('a');
a.href = String(fr.result || '');
a.download = fname;
document.body.appendChild(a);
a.click();
setTimeout(function () { try { if (a.parentNode) a.parentNode.removeChild(a); } catch (e) {} }, 5000);
cb(true);
} catch (e) { cb(false); }
};
fr.onerror = function () { cb(false); };
fr.readAsDataURL(blob);
} catch (e) { cb(false); }
}
function altSaveFile(blob, fname, shareTitle, saveTypes) {
const tryDataUrl = function () {
anchorDownloadDataUrl(blob, fname, function (ok) {
if (ok) { toast('已用另一种方式触发下载「' + fname + '」，请到下载列表确认'); return; }
try { if (anchorDownload(blob, fname)) { toast('已再触发一次下载「' + fname + '」，请到下载列表确认；若仍没有文件，把本页网址复制到系统浏览器或 Chrome 的地址栏重新打开再导出'); return; } } catch (e) {}
saveAskHelp(blob, fname);
});
};
const shareCrash = !!((window.mochiDevice || {}).env || {}).shareSheetCrash;
try {
const file = new File([blob], fname, { type: blob.type || 'application/octet-stream' });
if (!shareCrash && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
navigator.share({ files: [file], title: shareTitle || 'mochi 导出文件' }).then(
function () { toast('已通过系统分享保存「' + fname + '」'); },
function () { tryDataUrl(); } // 面板没弹/被系统拒绝 → 换 data: 直下
);
return;
}
} catch (e) {}
tryDataUrl();
}
function saveAskHelp(blob, fname) {
const envLine = 'mochi 导出求救：文件 ' + fname + '（' + fmtSize(blob.size) + '）分享/直下/补发三条保存通道都被拦下'
+ '；UA=' + (function () { try { return navigator.userAgent; } catch (e) { return '?'; } })()
+ '；页面=' + (function () { try { return location.href; } catch (e2) { return '?'; } })();
if (!window.openModal) { toast('这台浏览器拦住了网页下载：请把本页网址复制进系统自带浏览器或 Chrome 的地址栏打开再导出'); return; }
window.openModal('三种保存方式都被拦下了', '', null, {
noInput: true,
staticText: '先确认一件事：你是从桌面图标或浏览器地址栏直接打开本页的吗？\n'
+ '从微信 / QQ / 应用商店等 App 里点进来的页面是「内置小窗」，不是 Chrome 本体，会拦下载。\n\n'
+ '做法：点下面按钮复制网址，粘贴进系统浏览器或 Chrome 的地址栏打开，再导出一次。',
exportBtn: { label: '复制网址和设备信息', fn: function () {
try {
const ta = document.createElement('textarea');
ta.value = envLine;
ta.setAttribute('readonly', '');
ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
document.body.appendChild(ta);
try { ta.select(); } catch (e) {}
let ok = false;
try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
try { if (ta.parentNode) ta.parentNode.removeChild(ta); } catch (e3) {}
toast(ok ? '已复制网址和设备信息：粘贴到浏览器地址栏打开'
: '复制失败，请手动复制上方网址到浏览器打开');
} catch (e4) {}
} }
});
}
function afterDownloadAttempt(blob, fname, shareTitle, saveTypes, doneText, failText) {
let ok = false;
try { ok = anchorDownload(blob, fname); } catch (e) { ok = false; }
toast(ok ? (doneText || '已开始下载') : (failText || '下载未能触发'));
if (!downloadAskEnv()) return; // #815：追问名单外的内核一步到位（桌面 Chrome/Edge/三星等下载可靠零噪音）
setTimeout(function () {
if (!window.openModal) return;
window.openModal('文件已保存了吗？', '', null, {
noInput: true,
staticText: '请到浏览器「下载列表 / 通知栏」确认文件是否已保存：\n' + fname
+ '\n\n如果没看到文件（部分手机浏览器会静默拦下网页下载），点下面的按钮换一种方式保存。',
exportBtn: { label: '没开始下载？换一种方式', fn: function () { try { altSaveFile(blob, fname, shareTitle, saveTypes); } catch (e) {} } }
});
}, 700);
}
window.mochiExportFile = function (json, fname, title) {
let blob;
try { blob = new Blob([json], { type: 'application/json;charset=utf-8' }); } catch (e) { return Promise.resolve('fail'); }
return Promise.resolve(saveBackupFile(blob, fname, title)).then((res) => {
if (res === 'ok') { toast('已保存「' + fname + '」'); return 'ok'; }
if (res === 'cancel') return 'cancel';
if (window.openModal) {
window.openModal('文件已打包（' + fmtSize(blob.size) + '）', '', () => {
afterDownloadAttempt(blob, fname, title, undefined, '已导出「' + fname + '」', '仍未触发下载，请改用复制文字或换系统浏览器重试');
}, { noInput: true, staticText: '点「确定」开始下载保存到本机，点「取消」放弃本次保存。' });
return 'blocked';
}
return 'fail';
}).catch(() => 'fail'); // #758：意外 reject 也退回调用方的兜底链，不再静默死掉
};
window.mochiExportBlob = function (blob, fname, shareTitle, saveTypes) {
if (!(blob instanceof Blob)) return Promise.resolve('fail');
return Promise.resolve(saveBackupFile(blob, fname, shareTitle, saveTypes)).then((res) => {
if (res === 'ok') { toast('已保存「' + fname + '」'); return 'ok'; }
if (res === 'fail') return 'fail';
if (window.openModal) {
window.openModal('文件已打包（' + fmtSize(blob.size) + '）', '', () => {
afterDownloadAttempt(blob, fname, shareTitle, saveTypes, '已开始下载「' + fname + '」', '仍未触发下载，请改用复制文字或换系统浏览器重试');
}, { noInput: true, staticText: '点「确定」开始下载保存到本机，点「取消」放弃本次保存。' });
return 'blocked';
}
return 'fail';
}).catch(() => 'fail'); // #758：意外 reject 也退回调用方的兜底链（docx 走 legacy 裸下载），不再静默死掉
};
function fmtSize(n) {
if (!n) return '0 KB';
if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
if (n >= 1024) return Math.round(n / 1024) + ' KB';
return Math.round(n) + ' B';
}
function exportCoverage() {
const RULES = [
[/:chat-msgs$/, '聊天记录', arr => arr.length + ' 条'],
[/:group-chat-msgs$|:gc-msgs-/, '群聊记录', arr => arr.length + ' 条'],
[/mail-letters/, '信箱', arr => arr.length + ' 封'],
[/feed-posts/, '朋友圈', arr => arr.length + ' 条'],
[/cc-groups/, '字卡库', obj => Object.keys(obj).length + ' 组'],
[/quote-cards/, '自定义字卡', arr => arr.length + ' 张'],
[/fav-msgs/, '收藏', arr => arr.length + ' 条'],
[/:avatar-user$|:avatar-partner$/, '头像', null],
[/music-file:|music-favs/, '音乐', null],
[/divine-history/, '占卜记录', arr => arr.length + ' 条'],
[/cal-my-|records-/, '日历/纪念', null],
[/memo-|myarc/, '备忘录/档案', null],
[/gc-profiles/, '群聊资料', null],
[/period-|cycle-/, '经期记录', null],
[/accounting|expense/, '记账', null],
[/garden-|room-data/, '花园/房间', null],
[/drift-data/, '漂流瓶', null],
[/desk-layout|hidden-icons/, '桌面布局', null]
];
const BIG_STR = 1024 * 1024;
const desc = new Array(RULES.length).fill(null); // null＝该功能还没见到非空数据
const from = new Array(RULES.length).fill('');   // 该描述来自哪个键：同键后来的值（IDB 权威）覆盖前值（LS 快照）
const unwrap = (v) => {
if (typeof v !== 'string') return v;
try { return JSON.parse(v); } catch (e) { return v; }
};
return {
see(k, v) {
if (v === null || v === undefined) return;
const bigStr = typeof v === 'string' && v.length > BIG_STR;
for (let i = 0; i < RULES.length; i++) {
if (desc[i] !== null && from[i] !== k) continue;
if (!RULES[i][0].test(k)) continue;
if (bigStr) { desc[i] = RULES[i][2] ? '✓有（数据较大）' : '✓有'; from[i] = k; continue; }
const parsed = unwrap(v);
if (parsed === null || parsed === undefined || parsed === '') { desc[i] = null; continue; }
try {
const parse = RULES[i][2];
desc[i] = (parse && (Array.isArray(parsed) || typeof parsed === 'object'))
? parse(parsed) : '✓有';
from[i] = k;
} catch (e) { desc[i] = '✓有'; from[i] = k; }
}
},
lines() {
const out = [];
for (let i = 0; i < RULES.length; i++) if (desc[i] !== null) out.push('· ' + RULES[i][1] + '：' + desc[i]);
return out.length ? out : ['· 检查到无数据（备份为空）'];
}
};
}
function backupSummary(data) {
const fmtMB = (n) => (n / 1048576).toFixed(1) + ' MB';
const cnt = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);
const bytesOf = (v) => (v == null ? 0 : byteLen(typeof v === 'string' ? v : JSON.stringify(v)));
let lsB = 0, idbB = 0;
Object.keys(data.ls || {}).forEach(k => { lsB += bytesOf(data.ls[k]); });
Object.keys(data.idb || {}).forEach(k => { idbB += bytesOf(data.idb[k]); });
let chatN = '无';
try {
const all = Object.keys(data.idb || {}).concat(Object.keys(data.ls || {}));
const chats = all.filter(k => /:chat-msgs$/.test(k));
let n = 0;
chats.forEach(k => {
const raw = (data.idb && data.idb[k]) || (data.ls && data.ls[k]);
const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
if (Array.isArray(arr)) n += arr.length;
});
if (n) chatN = n + ' 条';
} catch (e) {}
const allKeys = Object.keys(data.ls || {}).concat(Object.keys(data.idb || {}));
const avMe = !!allKeys.find(k => /:avatar-user$/.test(k));
const avTa = !!allKeys.find(k => /:avatar-partner$/.test(k));
let fish = null;
const fishK = allKeys.find(k => /:fish-total$/.test(k));
if (fishK) fish = (data.ls && data.ls[fishK]) !== undefined ? data.ls[fishK] : (data.idb && data.idb[fishK]);
const lines = [];
lines.push('备份内容（请确认是对的文件）：');
lines.push('· 导出时间：' + fmtLocalTime(data.exportTime));
lines.push('· 小存储 ' + cnt(data.ls) + ' 项（' + fmtMB(lsB) + '）+ 大文件 ' + cnt(data.idb) + ' 项（' + fmtMB(idbB) + '）');
lines.push('· 聊天记录：' + chatN);
lines.push('· 头像：我 ' + (avMe ? '✓有' : '✗无') + '，TA ' + (avTa ? '✓有' : '✗无'));
lines.push('· 摸鱼累计：' + (fish !== null ? fish : '✗无'));
lines.push('若这里显示「聊天记录：无/头像✗」等，说明不是最新完整备份，请勿导入。');
return lines.join('\n');
}
const RETAIN_BATCH = 8; // 一批八键：整库残留键挤同一趟只读事务，几十 MB 必然超 idbGetMany 的 4s+4s
async function readRetainKeys(retain) {
const kept = [];
for (let i = 0; i < retain.length; i += RETAIN_BATCH) {
const slice = retain.slice(i, i + RETAIN_BATCH);
let map = {};
try { map = (await window.idbGetMany(slice)) || {}; } catch (e) { map = {}; }
for (let j = 0; j < slice.length; j++) {
const k = slice[j];
if (k in map) { // 这一格有回执：值就保留，undefined/null 就是库里确实没有
const v = map[k];
if (v !== undefined && v !== null) kept.push({ k: k, v: v });
continue;
}
const one = await readRetainedKey(k);
if (one.unknown) return { abort: true, unknownKey: k }; // 问不出＝未知，绝不清掉
if (one.v !== undefined && one.v !== null) kept.push({ k: k, v: one.v });
}
}
return kept;
}
async function readRetainedKey(key) {
if (typeof window.idbGet !== 'function') return { unknown: true }; // 连问的口子都没有＝未知，不许按「库里没有」清掉
try {
const late = window.idbLateRead && window.idbLateRead(key);
if (late) {
const lv = await late;
if (lv !== undefined && lv !== null) return { v: lv };
return { unknown: true };
}
} catch (e) {}
let size = 0;
try { size = (window.idbBigSize && window.idbBigSize(key)) || 0; } catch (e) {}
const info = { minWaitMs: 4000 + Math.min(28000, Math.ceil(Math.max(size, 1) / 1048576) * 2000) };
let v;
try { v = await window.idbGet(key, info); } catch (e) { v = undefined; }
if (v !== undefined && v !== null) return { v: v };
return info.ambiguous ? { unknown: true } : { none: true };
}
async function doImport(file) {
impShow('正在读取数据文件…', '大备份（上百 MB）解析需要几秒，请稍候', null);
let data;
try {
const rd = await readFileText(file);
impLog('read:' + rd.why + ' size=' + (file && file.size) + ' name=' + ((file && file.name) || '').slice(0, 24));
const text = rd.text;
if (!text && rd.err) throw rd.err;
if (!text) throw new Error('读空：内核回读内容为空（' + (rd.why === 'zero-byte' ? '文件是 0 字节' : '两条读取腿都回空') + '，size=' + (file && file.size) + '）');
data = JSON.parse((text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text) || 'null');
} catch (e) {
impHide();
const msg = (e && (e.message || String(e))) || '';
if (/string length|out of memory|ArrayBuffer length|memory/i.test(msg)) {
impLog('fail:too-large');
if (window.openModal) {
window.openModal('这份备份太大，本机读不进去', '', function () {}, {
noInput: true, okText: '知道了', big: true,
staticText: '文件本身没有坏，是它超过了浏览器一次能读入的体积上限（导入要把整个文件一次读成字符串再解析）。\n' +
'本机数据没有被改动。\n请在原设备上重新点「导出数据」，选择「不含音乐文件」或「只备份文字」再做一份体积更小的备份。'
});
} else {
toast('这份备份太大，本机读不进去——请在原设备上改选更小的备份范围重导一份');
}
return;
}
if (/读空|读取失败/i.test(msg)) {
impLog('fail:empty-read');
if (window.openModal) {
window.openModal('没有从这份文件读出内容', '', function () {}, {
noInput: true, okText: '知道了', big: true,
staticText: '原因：' + msg + '\n\n浏览器从你选的文件里一个字都没读到（多半是传输/下载不完整，或选到了还没写完的空文件）。\n' +
'本机数据没有被改动。\n请回到原设备重新「导出数据」，用云盘/数据线完整传到这台设备（微信发送会压缩改名，容易传坏），再选新文件导入。'
});
} else {
toast('没有从这份文件读出内容，请重新导出并完整传输后再导入');
}
return;
}
if (/unexpected (end of|token)|expected .*json|invalid or unexpected token|invalid character|unterminated/i.test(msg)) {
impLog('fail:syntax');
if (window.openModal) {
window.openModal('这份备份文件读不出来', '', function () {}, {
noInput: true, okText: '知道了', big: true,
staticText: '原因：' + msg + '\n\n多半是文件本身不完整（导出或传输过程被截断/损坏），或选错了文件（不是「导出数据」产生的备份）。\n' +
'本机数据没有被改动。\n建议回到原设备重新「导出数据」，用微信文件/云盘等完整传输一份再导入；数据较大时改选「不含音乐文件」或「只备份文字」。'
});
} else {
toast('备份文件不完整或损坏（' + msg + '），请重新导出并完整传输后再导入');
}
return;
}
impLog('fail:read ' + msg.slice(0, 60));
if (window.openModal) {
window.openModal('读不了这份数据文件', '', function () {}, {
noInput: true, okText: '知道了', big: true,
staticText: '原因：' + msg + '\n\n本机数据没有被改动。请确认选的是「导出数据」产生的备份文件后重试；反复失败可先重启浏览器（释放被占满的内存）再试。'
});
} else {
toast('读不了这份数据文件：' + msg);
}
return;
}
impHide();
if (!data || typeof data !== 'object') {
impLog('reject:not-object');
toast('不是 mochi 导出的数据文件');
return;
}
if (Array.isArray(data) || Array.isArray(data.msgs)) {
impLog('route:chat-file');
if (window.openModal && window.runChatAllImport) {
window.openModal('这份是「聊天记录」备份文件', '', function () { window.runChatAllImport(file); }, {
noInput: true, okText: '去导入这份聊天记录', big: true,
staticText: '它的内容是单个桌面的聊天记录，不是「导出数据 → 完整备份」产生的整包文件，完整备份入口不会导入它。\n' +
'点「去导入这份聊天记录」走「仅聊天记录」通道：先预览条数再确认，只覆盖聊天记录，设置/字卡/音乐都不动。\n' +
'（若想恢复全部数据，请在原设备选「导出数据 → 完整备份」。）'
});
} else {
toast('这份是聊天记录文件，请改用「导入数据 → 仅聊天记录」');
}
return;
}
if (data.ls == null || typeof data.ls !== 'object') data.ls = {};
const MOCHI_PREFIX = 'xy-home-v2:';
const lsLooksMochi =
Object.keys(data.ls).some(k => k.indexOf(MOCHI_PREFIX) === 0) ||
!!(data.idb && typeof data.idb === 'object' && Object.keys(data.idb).some(k => k.indexOf(MOCHI_PREFIX) === 0));
if (data.app && data.app !== 'mochi-zika' && !lsLooksMochi) {
impLog('reject:app-mismatch');
toast('不是 mochi 导出的数据文件');
return;
}
const hasMochiKeys = lsLooksMochi;
function confirmAndImport(d) {
if (!window.openModal) return;
const summary = backupSummary(d);
let adjNote = '';
try {
const adjKeys = Object.keys(d.ls || {}).filter(k => /^xy-home-v2:screen-adj-(top|bottom|h|desk|shift|text|side|kbgap)$/.test(k) && parseInt(d.ls[k], 10));
if (adjKeys.length) adjNote = '\n\n⚠ 这份备份带有屏幕适配偏移（' + adjKeys.length + ' 项，属于原来的那台设备）。换设备恢复后若出现错位/裁切，到 设置→屏幕适配微调 点「全部恢复默认」再重新拖，或用「屏幕适配诊断→一键修正」。';
} catch (eA) {}
window.openModal('确定导入数据？将覆盖当前所有数据，且无法恢复。', '', () => {
impLog('confirm:go');
doImportGo(d);
}, { noInput: true, staticText: summary + adjNote });
}
if (!hasMochiKeys) {
const allKeys = Object.keys(data.ls || {}).concat(Object.keys(data.idb || {}));
if (!allKeys.length) {
impLog('reject:empty-backup');
toast('备份文件是空的（无任何数据键），没有可导入的数据');
return;
}
const firstColon = allKeys[0].indexOf(':');
if (firstColon < 0) {
impLog('reject:key-format');
toast('备份文件键格式异常（无冒号分隔），无法导入');
return;
}
const detectedPrefix = allKeys[0].slice(0, firstColon + 1);
const allSamePrefix = allKeys.every(k => k.indexOf(detectedPrefix) === 0);
if (!allSamePrefix) {
toast('备份文件键前缀混乱（多种前缀），无法自动迁移。样例：' + allKeys.slice(0, 5).join('、'));
return;
}
const mochiKeyTails = [
'chat-msgs', 'cc-groups', 'active-contact', 'contacts', 'fish-total',
'avatar-user', 'avatar-partner', 'desk-image-src', 'music-file:',
'theme-mode', 'accent-color', 'reply-settings', 'chat-settings',
'cs-', 'lbl-', 'avatar-', 'desk-', 'app-icon-', 'widget-',
'phone-bg', 'page-bg-', 'card-bg-', 'hidden-icons', 'ico-radius',
'divine-history', 'divine-send-auto', 'call-mini-', 'records-',
'fav-msgs', 'invite-ask-history',
'gc-profiles', 'gc-beauty', 'checkin-', 'my-emoji-groups', 'poke-',
'reply-', 'feed-', 'music-', 'emoji-last', 'group-chat-enabled',
'quote-history', 'memo-', 'mood-history', 'today-mood-',
'day-fish-', 'day-work-', 'fish-day-add', 'work-day-add',
'work-total', 'love-start', 'rel-cat', 'rel-role', 'avatar-lib', 'avatar-me-lib',
'ck-', 'ckq-', 'rps-score', 'desk-countdowns', 'desk-texts',
'desk-images', 'desk-layout', 'more-tab', 'cal-my-', 'mem-extras',
'fish-log', 'fish-migrated', 'music-global', 'music-favs', 'music-float-pos',
'phone-bg-preset', 'bg-blur', 'bg-mask-op', 'sf-', 'gc-'
];
const tails = allKeys.map(k => k.slice(detectedPrefix.length));
const tailHit = tails.filter(t => mochiKeyTails.some(p => t.indexOf(p) >= 0)).length;
const deskHit = tails.filter(t => /^(default|c\d+):.+/.test(t)).length;
const looksMochi = tailHit >= 1 || deskHit >= 1;
if (!looksMochi) {
toast('备份文件不像 mochi 数据（键尾不匹配）。前缀：' + detectedPrefix + '，样例：' + allKeys.slice(0, 5).join('、'));
return;
}
if (!window.openModal) return;
const sample = allKeys.slice(0, 3)
.map(k => k + '  →  ' + MOCHI_PREFIX + k.slice(detectedPrefix.length)).join('\n');
window.openModal(
'检测到备份键前缀为「' + detectedPrefix + '」\n疑似 mochi 备份（键尾匹配），是否重写为「' + MOCHI_PREFIX + '」后导入？',
'',
() => {
const rewrite = (obj) => {
if (!obj || typeof obj !== 'object') return obj;
const out = {};
Object.keys(obj).forEach(k => {
if (k.indexOf(detectedPrefix) === 0) out[MOCHI_PREFIX + k.slice(detectedPrefix.length)] = obj[k];
else out[k] = obj[k];
});
return out;
};
data.ls = rewrite(data.ls);
data.idb = rewrite(data.idb);
confirmAndImport(data);
},
{ noInput: true, staticText: '键映射样例：\n' + sample + '\n\n点确定重写前缀并导入，点取消放弃。' }
);
return;
}
confirmAndImport(data);
}
function doImportGo(data) {
impLog('write:start idbKeys=' + Object.keys((data && data.idb) || {}).length + ' lsKeys=' + Object.keys((data && data.ls) || {}).length);
try { window.__resetting = true; } catch (e) {}
impShow('正在导入…', '准备中', 2);
function scrubMediaPool(obj) {
if (!obj || typeof obj !== 'object') return;
Object.keys(obj).forEach(function (k) {
if (!MEDIA_POOL_KEY_RE.test(k)) return;
const v = obj[k];
if (typeof v !== 'string' || v.indexOf('data:') !== 0) { try { delete obj[k]; } catch (e) {} }
});
}
scrubMediaPool(data.idb);
scrubMediaPool(data.ls);
const lsPoolKeys = Object.keys((data && data.ls) || {}).filter(k => MEDIA_POOL_KEY_RE.test(k));
if (lsPoolKeys.length) {
if (!data.idb || typeof data.idb !== 'object') { try { data.idb = {}; } catch (eI) {} }
lsPoolKeys.forEach(k => {
try { data.idb[k] = data.ls[k]; delete data.ls[k]; } catch (eM) {}
});
impLog('pool:from-ls=' + lsPoolKeys.length); // 非零才记：这一发是「用户手里那份文件是旧形状」的取证信号
}
let backup = null;
try {
backup = {};
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (k && k.indexOf('xy-home-v2:') === 0) backup[k] = localStorage.getItem(k);
}
} catch (e) { backup = null; }
let retainUnknownKey = ''; // #1359c：有键问不出＝未知 → 这一发中止，并把键名留给回执环与文案（不当「没有」）
const idbRestored = new Promise((resolve) => {
if (!data.idb || typeof data.idb !== 'object') { resolve(true); return; }
const idbKeys = Object.keys(data.idb).filter(k => k.indexOf('xy-home-v2:') === 0 && k !== SNAPSHOT_KEY);
if (!idbKeys.length) { resolve(true); return; }
if (window.idbReplaceAll) {
impShow('正在导入…', '正在原子写入大文件（字卡/聊天/音乐等）…', 8);
const pairs = idbKeys.map(k => ({ k: k, v: data.idb[k] }));
const lsKeySet = {};
try { Object.keys(data.ls || {}).forEach(k => { if (k.indexOf('xy-home-v2:') === 0) lsKeySet[k] = true; }); } catch (e) {}
const backupKeySet = {};
try { idbKeys.forEach(k => { backupKeySet[k] = true; }); } catch (e) {}
const havePorts = !!(window.idbListKeys && window.idbGetMany);
if (!havePorts) { retainUnknownKey = '(no-port)'; }
const retainStep = havePorts
? window.idbListKeys().then(async function (curKeys) {
if (!Array.isArray(curKeys)) return { abort: true };
const retain = curKeys.filter(function (k) {
return k && k.indexOf('xy-home-v2:') === 0 &&
k !== SNAPSHOT_KEY &&
!backupKeySet[k] && !lsKeySet[k];
});
if (!retain.length) return [];
return readRetainKeys(retain).then(function (r) {
if (r && r.abort) {
retainUnknownKey = String(r.unknownKey || '');
impLog('retain:unknown ' + retainUnknownKey.slice(0, 48));
} else {
impLog('retain:kept=' + r.length + '/' + retain.length);
}
return r;
}).catch(function () { return { abort: true }; });
}).catch(function () { return { abort: true }; })
: Promise.resolve({ abort: true }); // #1359d：未知即中止（原因已由上面 havePorts 那格记进 retainUnknownKey）
retainStep.then(function (kept) {
if (kept && kept.abort) { resolve(false); return; } // #440 清单未知＝无法安全替换式导入 → 中止（原数据保留）
const keptPairs = kept || [];
const allPairs = keptPairs.length ? pairs.concat(keptPairs) : pairs;
window.idbReplaceAll(allPairs).then(ok => {
if (ok) impShow('正在导入…', '大文件写入完成' + (keptPairs.length ? '（已保留备份未含的 ' + keptPairs.length + ' 个旧键）' : ''), 60);
else { try { data.idb = {}; } catch (e) {} }
resolve(ok);
});
});
return;
}
if (!window.idbSet) { resolve(true); return; }
const clearFirst = (window.idbClearAll && window.idbClearAll()) || Promise.resolve(true);
clearFirst.then((cleared) => {
if (cleared !== true) { resolve(false); return; }
let p = Promise.resolve();
let failed = 0;
let done = 0;
const total = idbKeys.length;
idbKeys.forEach(k => {
p = p.then(() => window.idbSet(k, data.idb[k])).then(ok => {
try { delete data.idb[k]; } catch (e) {}
done++;
if (!ok) failed++;
impShow('正在恢复大文件（字卡/聊天/音乐等）…', done + ' / ' + total, 5 + Math.round(done / total * 55));
});
});
p.then(() => resolve(failed === 0)).catch(() => resolve(false));
});
});
function clearLs() {
try {
Object.keys(localStorage)
.filter(k => k.indexOf('xy-home-v2:') === 0 && k !== IMPORT_LOG_KEY)
.forEach(k => localStorage.removeItem(k));
} catch (e) {}
}
idbRestored.then((idbOk) => {
impLog('write:idb=' + (!!idbOk ? 'ok' : 'fail'));
if (!idbOk) {
try { window.__resetting = false; } catch (e2) {}
impHide();
if (retainUnknownKey) {
toast('导入已中止：本机有一项大文件这次没能读出来（多半是表情包／字卡这类几十 MB 的库），' +
'为防它被清掉，原有数据一字未动；等手机空闲时再试一次');
} else {
toast('导入失败：大文件写入未成功，原有数据已保留，请重试');
}
return;
}
impShow('正在导入…', '正在写入设置与聊天记录', 62);
const lsKeys = Object.keys(data.ls).filter(k => k.indexOf('xy-home-v2:') === 0 && k !== SNAPSHOT_KEY);
let entries = lsKeys.map(k => ({ k: k, len: byteLen(data.ls[k]) + byteLen(k) }));
let chatMoved = false;
const chatFallback = [];
entries = entries.filter(e => {
if (!/:chat-msgs$/.test(e.k)) return true;
chatMoved = true;
if (data.idb && data.idb[e.k] !== undefined) return false; // IDB 有权威，跳过 LS
chatFallback.push({ k: e.k, v: data.ls[e.k] }); // IDB 无权威，快照写 IDB 兜底
return false;
});
const total = entries.reduce((s, e) => s + e.len, 0);
let quota = 5 * 1024 * 1024;
try {
const probe = 'x'.repeat(1024 * 1024);
localStorage.setItem(window.activePrefix() + ':__quota_probe__', probe);
localStorage.removeItem(window.activePrefix() + ':__quota_probe__');
quota = 10 * 1024 * 1024;
} catch (e) {}
let budget = total;
let dropped = [];
const sorted = entries.slice().sort((a, b) => b.len - a.len);
for (const e of sorted) {
if (budget + LS_HEADROOM <= quota) break;
if (/:chat-msgs$/.test(e.k)) continue;
budget -= e.len;
dropped.push(e);
}
const skipSet = {};
dropped.forEach(e => { skipSet[e.k] = true; });
clearLs();
let writeFailed = [];
const idbFalls = [];
chatFallback.forEach(f => idbFalls.push(f));
for (const e of entries) {
if (skipSet[e.k]) { idbFalls.push({ k: e.k, v: data.ls[e.k] }); continue; }
try {
localStorage.setItem(e.k, data.ls[e.k]);
if (e.len > 200 * 1024) {
try { localStorage.removeItem(e.k); } catch (err2) {}
idbFalls.push({ k: e.k, v: data.ls[e.k] });
}
} catch (err) {
writeFailed.push(e.k);
idbFalls.push({ k: e.k, v: data.ls[e.k] });
}
}
let fallsOk = 0;
let fallsBytes = 0;
const fallsBad = [];
let p = Promise.resolve();
idbFalls.forEach(f => {
p = p.then(() => (window.idbSet ? window.idbSet(f.k, f.v) : Promise.resolve(false)))
.then(ok => {
if (ok) { fallsOk++; fallsBytes += byteLen(f.v); }
else fallsBad.push(f.k);
});
});
p.then(async () => {
impShow('正在导入…', '写入完成，正在核对数据', 95);
let rolledBack = 0;
if (fallsBad.length && backup) {
fallsBad.forEach(k => {
const old = backup[k];
if (old === undefined || old === null) return;
try { localStorage.setItem(k, old); rolledBack++; } catch (e) {
try { if (window.idbMemoSet) window.idbMemoSet(k, old); } catch (e2) {}
}
});
}
const parts = [];
if (idbOk) parts.push('音乐/字卡/查岗等大文件已恢复');
else if (data.idb && Object.keys(data.idb).length) parts.push('⚠ IndexedDB 恢复失败，字卡/音乐/查岗等大文件可能缺失，建议重新导入');
if (chatMoved) parts.push('聊天记录已存入 IndexedDB（不占浏览器小存储）');
if (writeFailed.length) parts.push(writeFailed.length + ' 项写入失败（存储空间满）');
if (fallsOk) {
const mb = (fallsBytes / 1048576).toFixed(1);
parts.push('大文件 ' + fallsOk + ' 项（约 ' + mb + ' MB）已存入 IndexedDB，不占小存储');
}
if (fallsBad.length) {
parts.push('⚠ ' + fallsBad.length + ' 项未能存入 IndexedDB' + (rolledBack ? '（其中 ' + rolledBack + ' 项已还原为导入前的旧数据）' : '（这些键导入前也没有留底）') + '，这部分新数据没导入成功，清出空间后用完整备份重新导入');
}
if (!parts.length) parts.push('导入成功');
let ok = [];
try {
let chatN = 0;
let chatSeen = 0, chatCheckOk = true;
if (window.idbListKeys || window.idbGetAllKeys) {
try {
const keys = window.idbListKeys ? await window.idbListKeys() : await window.idbGetAllKeys();
if (!Array.isArray(keys)) { chatCheckOk = false; }
else {
for (const k of keys) {
if (/:chat-msgs$/.test(k)) {
chatSeen++;
const cv = await window.idbGet(k);
const a = typeof cv === 'string' ? JSON.parse(cv) : cv;
if (Array.isArray(a)) chatN += a.length;
else if (cv === undefined || cv === null) chatCheckOk = false;
}
}
}
} catch (e) { chatCheckOk = false; }
}
if (chatN) ok.push('聊天' + chatN + '条');
if (!chatN && !chatCheckOk) parts.push('⚠ 聊天记录未能核对（数据库繁忙），请打开聊天页确认记录在列后再清理原设备');
else if (!chatN && chatSeen) parts.push('⚠ 聊天键存在但条数读取失败，请打开聊天页确认');
const lsKeys = [];
for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) lsKeys.push(k); }
if (lsKeys.some(k => /:avatar-user$/.test(k))) ok.push('我的头像✓');
const fishK = lsKeys.find(k => /:fish-total$/.test(k));
if (fishK !== undefined) ok.push('摸鱼累计 ' + localStorage.getItem(fishK));
if (localStorage.getItem('xy-home-v2:contacts')) ok.push('联系人✓');
} catch (e) {}
const msg = parts.join('；') + (ok.length ? '；已核对：' + ok.join('、') : '') + '，正在刷新…';
if (!ok.length) {
impShow('⚠ 导入完成但未检测到关键数据', '聊天记录/头像/摸鱼未在存储中找到，刷新后仍缺失请重新导入完整备份', 100);
} else {
impShow('导入完成', msg, 100);
}
setTimeout(() => { impHide(); location.reload(); }, 3500);
});
});
}
function purgeLegacySnapshot(onDone) {
try { localStorage.removeItem(SNAPSHOT_KEY); } catch (e) {}
try { if (window.idbMemoDrop) window.idbMemoDrop(SNAPSHOT_KEY); } catch (e) {}
if (!window.idbDelete) { if (onDone) onDone(false); return; }
let tries = 0;
const attempt = function () {
tries++;
Promise.resolve(window.idbDelete(SNAPSHOT_KEY)).then(function () {
if (!window.idbHasKey) { if (onDone) onDone(false); return; }
setTimeout(function () {
try {
Promise.resolve(window.idbHasKey(SNAPSHOT_KEY)).then(function (has) {
if (has === false) { if (onDone) onDone(true); return; }
if (tries < 5) attempt();
else if (onDone) onDone(false);
}).catch(function () { if (tries < 5) attempt(); else if (onDone) onDone(false); });
} catch (e) { if (onDone) onDone(false); }
}, 1500);
}).catch(function () { if (onDone) onDone(false); });
};
attempt();
}
const SNAP_DEFER_KEY = 'xy-home-v2:__snap-clean-defer';
let _snapPromptShown = false;
function snapCleanPrompt() {
try {
if (_snapPromptShown) return;
if (!window.idbHasKey || !window.openModal || typeof toast !== 'function') return;
let deferred = 0;
try { deferred = Number(localStorage.getItem(SNAP_DEFER_KEY)) || 0; } catch (eF1) {}
if (deferred > 0 && Date.now() - deferred < 3 * 24 * 60 * 60 * 1000) return;
Promise.resolve(window.idbHasKey(SNAPSHOT_KEY)).then(function (has) {
if (_snapPromptShown) return;
if (has !== true) return; // 不在＝已清/从没有＝零打扰
_snapPromptShown = true;
window.openModal('发现旧版备份留底副本', '', function (v) {
if (v !== 'ok') { // 「下次再说」/关掉：3 天内不再问
try { localStorage.setItem(SNAP_DEFER_KEY, String(Date.now())); } catch (eF2) {}
return;
}
purgeLegacySnapshot(function (gone) {
toast(gone
? '已清理完成，这份占用已释放（不影响你现在的任何数据）'
: '这次没删干净（存储忙），下次启动会再试；也可到 设置→查看存储 手动清');
});
}, {
noInput: true, pillSubmit: true,
pills: [{ label: '立即清理', value: 'ok' }, { label: '下次再说', value: 'later' }],
staticText: '检测到一份旧版本程序留下的「备份留底副本」（通常占几十 MB，键名 __auto-backup-snapshot）。\n\n它是某个旧版本在你做备份时顺手复制的全量数据拷贝，早已过期、不再更新。删掉它不影响你现在的任何数据——聊天记录、字卡、图片都存在另外的位置；你真正的备份是「导出数据」保存的那份文件。\n\n点「立即清理」即释放这份占用；清理会自动复核，没删干净下次启动会再提醒。'
});
}).catch(function () {});
} catch (e) {}
}
if (window.__mochiDataReady) { setTimeout(snapCleanPrompt, 12000); }
else {
document.addEventListener('mochi-restore-done', function h() {
document.removeEventListener('mochi-restore-done', h);
setTimeout(snapCleanPrompt, 12000);
});
setTimeout(snapCleanPrompt, 20000);
}
window.runBackupExport = function () {
try { if (window.chatFlushSave) window.chatFlushSave(); } catch (e) {}
Promise.resolve().then(askExportMode).then((mode) => {
if (mode === 'cancel') { toast('已取消导出'); return; }
toast('正在导出，请稍候…');
return doExport(mode);
}).catch((e) => {
impHide();
reportExportError(e, exportCfg('full'));
});
};
window.runChatExport = function () {
try { if (window.chatFlushSave) window.chatFlushSave(); } catch (e) {}
toast('正在导出聊天记录，请稍候…');
return doExport('chat');
};
window.runChatAllExport = function () {
return window.runChatExport();
};
function clearDeskTail(cid) {
try {
const ns = 'xy-home-v2:' + cid;
if (window.xyStore) {
window.xyStore(ns).remove('chat-tail');
window.xyStore(ns).remove('chat-arch');
if (cid === 'default') window.xyStore('xy-home-v2').remove('chat-tail');
return;
}
try { localStorage.removeItem(ns + ':chat-tail'); } catch (e) {}
try { localStorage.removeItem(ns + ':chat-arch'); } catch (e) {}
if (cid === 'default') { try { localStorage.removeItem('xy-home-v2:chat-tail'); } catch (e) {} }
} catch (e) {}
}
function writeDeskChat(cid, arr) {
const key = 'xy-home-v2:' + cid;
clearDeskTail(cid);
try {
if (window.idbListKeys && window.idbDelete) {
window.idbListKeys().then(function (keys) {
(keys || []).forEach(function (k) {
if (typeof k === 'string' && k.indexOf(key + ':chat-blk-') === 0) { try { window.idbDelete(k); } catch (e2) {} }
});
}).catch(function () {});
} else { try { window.idbDelete && window.idbDelete(key + ':chat-blk-idx'); } catch (e2) {} }
} catch (e) {}
let seq = Promise.resolve();
if (window.idbSet) {
seq = seq.then(() => window.idbSet(key + ':chat-msgs', arr.length ? arr : JSON.stringify(arr || null)));
seq = seq.then(() => window.idbSet(key + ':chat-meta', JSON.stringify({ n: arr.length, t: Date.now(), b: arrByteLen(arr) })));
}
try { localStorage.setItem(key + ':chat-msgs', JSON.stringify(arr)); } catch (e) {}
try { localStorage.setItem(key + ':chat-meta', JSON.stringify({ n: arr.length, t: Date.now(), b: arrByteLen(arr) })); } catch (e) {}
return seq;
}
function arrByteLen(arr) {
try { let n = 0; for (let i = 0; i < arr.length; i++) { const m = arr[i]; if (m && typeof m === 'object') { const t = m.text; if (typeof t === 'string') n += t.length; const im = m.img; if (typeof im === 'string') n += im.length; const vc = m.voice; if (typeof vc === 'string') n += vc.length; n += 64; } else n += 32; } return n; } catch (e) { return 0; }
}
window.runChatAllImport = function (file) {
if (file) { chatAllImportRead(file); return; }
window.mochiFilePick({
id: 'mochi-chatall-import-pick', accept: window.mochiDataPickAccept, // #1410：并集里补上 text/plain 与 octet-stream，窄串那两型灰显一并挡掉
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到文件，请再选一次'); return; }
chatAllImportRead(f);
}
});
};
function chatAllImportRead(f) {
const reader = new FileReader();
reader.onload = () => {
let data;
try { data = JSON.parse(String(reader.result || '')); } catch (e) { toast('无效的聊天记录文件'); return; }
if (!data || typeof data !== 'object') { toast('无效的聊天记录文件'); return; }
const chatKeyRe = /^xy-home-v2:(?:chat-msgs|(?:default|c[0-9a-z]{5,}):chat-msgs)$/;
const mediaKeyRe = /^xy-home-v2:media:/;
const lsObj = (data && typeof data.ls === 'object') ? data.ls : {};
const idbObj = (data && typeof data.idb === 'object') ? data.idb : {};
try {
Object.keys(idbObj).forEach(function (k) {
if (!/:chat-blk-idx$/.test(k)) return;
let idx = null;
try { idx = typeof idbObj[k] === 'string' ? JSON.parse(idbObj[k]) : idbObj[k]; } catch (e) { return; }
if (!idx || !Array.isArray(idx.blocks) || !idx.blocks.length) return;
const prefix = k.slice(0, k.length - ':chat-blk-idx'.length);
let full = [];
for (let bi = 0; bi < idx.blocks.length; bi++) {
const rawB = idbObj[prefix + ':' + idx.blocks[bi].k];
let part = null;
try { part = typeof rawB === 'string' ? JSON.parse(rawB) : rawB; } catch (e) { return; }
if (!Array.isArray(part)) return;
full = full.concat(part);
}
const msgKey = prefix + ':chat-msgs';
const nOfRaw = (raw) => {
if (raw === undefined || raw === null) return -1;
try { const a = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(a) ? a.length : -1; } catch (e) { return -1; }
};
const curN = Math.max(nOfRaw(idbObj[msgKey]), nOfRaw(lsObj[msgKey]));
if (full.length >= curN) { idbObj[msgKey] = full; lsObj[msgKey] = full; }
});
} catch (e) {}
const pickRaw = (k) => {
if (lsObj[k] !== undefined) return { v: lsObj[k], from: 'ls' };
if (idbObj[k] !== undefined) return { v: idbObj[k], from: 'idb' };
return null;
};
const allKeys = Object.keys(lsObj).concat(Object.keys(idbObj));
let chatKeys = allKeys.filter(k => chatKeyRe.test(k));
let groupKeys = allKeys.filter(k => GROUP_CHAT_KEY_RE.test(k));
let singleMsgs = null;
if (!chatKeys.length && !groupKeys.length) {
if (Array.isArray(data)) singleMsgs = data;
else if (data.msgs && Array.isArray(data.msgs)) singleMsgs = data.msgs;
else if (data.ls && data.ls['xy-home-v2:chat-msgs'] !== undefined) {
try { const raw = data.ls['xy-home-v2:chat-msgs']; singleMsgs = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { singleMsgs = null; }
}
}
if (!chatKeys.length && !groupKeys.length && !Array.isArray(singleMsgs)) { toast('文件里没有可导入的聊天记录数据'); return; }
const fmt = (t) => t ? new Date(t).toLocaleString() : '未知';
const arrOf = (k) => {
const raw = pickRaw(k);
if (!raw) return [];
try { const a = typeof raw.v === 'string' ? JSON.parse(raw.v) : raw.v; return Array.isArray(a) ? a : []; } catch (e) { return []; }
};
const cidOf = (k) => { const s = k.split(':'); return s.length <= 2 ? 'default' : (s[1] || 'default'); };
const preview = [];
if (chatKeys.length) {
chatKeys.forEach(k => {
const a = arrOf(k);
const cid = cidOf(k);
preview.push('· ' + (cid === 'default' ? '默认桌面' : cid) + '：' + a.length + ' 条' +
(a.length ? '（最早 ' + fmt(a[0] && a[0].ts) + '）' : ''));
});
}
groupKeys.forEach(k => {
const a = arrOf(k);
const gid = k === 'xy-home-v2:group-chat-msgs' ? 'default' : k.slice('xy-home-v2:gc-msgs-'.length);
preview.push('· 群聊' + (gid === 'default' ? '（默认群）' : ' ' + gid) + '：' + a.length + ' 条' +
(a.length ? '（最早 ' + fmt(a[0] && a[0].ts) + '）' : ''));
});
if (!chatKeys.length && !groupKeys.length) {
preview.push('· 当前桌面（默认）：' + singleMsgs.length + ' 条' +
(singleMsgs.length ? '（最早 ' + fmt(singleMsgs[0] && singleMsgs[0].ts) + '）' : ''));
}
const mediaKeys = allKeys.filter(k => mediaKeyRe.test(k));
if (mediaKeys.length) preview.push('· 附带图片/语音 ' + mediaKeys.length + ' 项');
preview.push('导入将覆盖对应桌面/群聊的全部聊天记录（不可恢复），其他数据不受影响。');
if (!window.openModal) return;
window.openModal('确认导入聊天记录？', '', () => {
impLog('chat:go 桌=' + chatKeys.length + ' 群=' + groupKeys.length + ' 媒体=' + mediaKeys.length + ' 单桌=' + (Array.isArray(singleMsgs) ? singleMsgs.length : 0)); // #1359e：这条通路此前在回执环里一行都不留（单桌那格按「是不是数组」取，标准备份那一型里 singleMsgs 恒 null＝不兜会把整个回调打死）
importChatAllGo(chatKeys, groupKeys, singleMsgs, mediaKeys, pickRaw);
}, { noInput: true, staticText: preview.join('\n') });
};
reader.onerror = () => { toast('文件读取失败，请重试'); };
reader.readAsText(f, 'utf-8');
}
function importChatAllGo(chatKeys, groupKeys, singleMsgs, mediaKeys, pickRaw) {
const cur = window.__activeCid || 'default';
const writes = [];
let totalN = 0;
if (singleMsgs) {
if (window.chatImportMsgs) window.chatImportMsgs(singleMsgs);
totalN += singleMsgs.length;
}
chatKeys.forEach(k => {
const raw = pickRaw(k);
if (!raw || raw.v === undefined) return;
let arr;
try { arr = typeof raw.v === 'string' ? JSON.parse(raw.v) : raw.v; } catch (e) { return; }
if (!Array.isArray(arr)) return;
const s = k.split(':');
const cid = s.length <= 2 ? 'default' : (s[1] || 'default');
totalN += arr.length;
if (cid === cur) {
if (window.chatImportMsgs) window.chatImportMsgs(arr);
} else {
writes.push({ kind: 'chat', cid: cid, arr: arr });
}
});
groupKeys.forEach(k => {
const raw = pickRaw(k);
if (!raw || raw.v === undefined) return;
let arr;
try { arr = typeof raw.v === 'string' ? JSON.parse(raw.v) : raw.v; } catch (e) { return; }
if (!Array.isArray(arr)) return;
const gid = k === 'xy-home-v2:group-chat-msgs' ? 'default' : k.slice('xy-home-v2:gc-msgs-'.length);
totalN += arr.length;
writes.push({ kind: 'group', gid: gid, arr: arr });
});
let p = Promise.resolve();
writes.forEach((w) => {
if (w.kind === 'group') {
p = p.then(() => { if (window.gcWriteGroupMsgs) return window.gcWriteGroupMsgs(w.gid, w.arr); });
} else {
p = p.then(() => writeDeskChat(w.cid, w.arr));
}
});
mediaKeys.forEach(k => {
const raw = pickRaw(k);
if (!raw || raw.v === undefined) return;
if (window.idbSet) {
p = p.then(() => window.idbSet(k, raw.v));
}
});
p.then(() => {
toast('聊天记录已导入（' + totalN + ' 条，覆盖对应桌面/群聊）');
}).catch((e) => {
toast('导入失败：' + (e && e.message || '未知错误'));
});
}
const exportRow = document.getElementById('row-export');
if (exportRow) {
exportRow.addEventListener('click', () => { window.runBackupExport(); });
}
const importRow = document.getElementById('row-import');
if (importRow) {
importRow.addEventListener('click', () => {
if (!window.openModal) { pickImportFile(); return; }
window.openModal('选择导入范围', '', (v) => {
if (v === 'chat') { window.runChatAllImport(); return; }
if (v === 'cancel') { toast('已取消导入'); return; }
pickImportFile();
}, {
noInput: true, okText: '开始导入', pill: 'full', lock: true,
pickOk: {
entry: 'row-import', accept: window.mochiDataPickAccept,
skipWhen: (m) => m === 'cancel',
onFiles: (files, mode) => {
const f = files && files[0];
if (!f) { toast('没有取到文件，请再选一次'); return; }
if (mode === 'chat') { window.runChatAllImport(f); return; }
doImport(f);
}
},
pills: [{ label: '完整备份（全部数据）', value: 'full' },
{ label: '仅聊天记录（全部桌面联系人）', value: 'chat' },
{ label: '取消', value: 'cancel' }],
staticText: '完整备份：按备份文件恢复全部数据（会覆盖本机现有数据，含设置 / 字卡 / 朋友圈 / 音乐等）。\n' +
'仅聊天记录：只恢复备份里的聊天记录——全部桌面联系人（含默认桌面）与群聊，' +
'消息里引用到的图片/语音一并恢复；设置、字卡、朋友圈、音乐一律不动。\n' +
'两种都能读「导出数据」产生的备份文件；仅聊天记录还会识别单桌导出的聊天文件。\n' +
'选文件时若弹出来的是相册，请在选择器里切到「文件／存储空间」再选——备份是 .json 文件。'
});
});
}
function pickImportFile() {
window.mochiFilePick({
id: 'mochi-backup-import-pick', accept: window.mochiDataPickAccept, // #1410
onFiles: (files) => {
const f = files && files[0];
if (!f) { toast('没有取到文件，请再选一次'); return; }
doImport(f);
}
});
}
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("data-backup.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("data-backup.js"); try { console.error("[JS] data-backup.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[data-backup.js] " + String(__e && __e.message || __e)); } })();
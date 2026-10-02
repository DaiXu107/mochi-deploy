(function () { try {
(function () {
'use strict';
const FULL_DECODE_PIXELS = 26000000; // 允许一次整幅解码的像素预算（与 #351 桌面壁纸同口径）
const PROBE_BYTES = 64 * 1024;        // 头部嗅探取样字节数：JPEG 的 SOF 段通常在 EXIF 缩略图之后几十 KB 内
const DECODE_WATCHDOG_MS = 20000;     // #1036 解码看门狗：不回调的内核按失败收口，不让 Promise 悬空
const FIT_MIN_SIDE = 320;             // 字节收敛的最低边长（与 compressImageFit 同口径）
const FIT_MAX_STEP = 6;               // 字节收敛最多降 6 档，压到达标仍超限就交最小一版
const ring = [];                      // 最近 8 笔导入取证（诊断【图片导入】读它）
let subCapable = null;                // 本内核是否尊重 createImageBitmap 的 resize 参数
function nowMs() { return (window.performance && performance.now) ? performance.now() : 0; }
function dataUrlToBlob(dataUrl) {
const i = dataUrl.indexOf(',');
if (i < 0 || dataUrl.indexOf(';base64') < 0) return null;
try {
const bin = atob(dataUrl.slice(i + 1));
const bytes = new Uint8Array(bin.length);
for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
return new Blob([bytes], { type: dataUrl.slice(5, i).split(';')[0] || 'image/jpeg' });
} catch (e) { return null; }
}
function asBlob(src) {
if (!src) return null;
if (typeof src === 'string') return dataUrlToBlob(src);
if (typeof Blob !== 'undefined' && src instanceof Blob) return src;
return src && src.size > 0 ? src : null; // File 就是 Blob 的子类，个别内核 instanceof 判不准时按体积认
}
function u16(b, i) { return (b[i] << 8) | b[i + 1]; }
function u24(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16); }
function u32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
async function probePixels(blob) {
try {
if (!blob || !blob.slice || typeof blob.arrayBuffer !== 'function') return null;
const b = new Uint8Array(await blob.slice(0, PROBE_BYTES).arrayBuffer());
if (b.length < 30) return null;
if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && u32(b, 12) === 0x49484452) {
return { fmt: 'png', w: u32(b, 16), h: u32(b, 20) };
}
if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
return { fmt: 'gif', w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
}
if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && u32(b, 8) === 0x57454250) {
const four = u32(b, 12);
if (four === 0x56503858) return { fmt: 'webp', w: u24(b, 24) + 1, h: u24(b, 27) + 1 };
if (four === 0x56503820 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
return { fmt: 'webp', w: u16(b, 26) & 0x3fff, h: u16(b, 28) & 0x3fff };
}
return null; // VP8L 的宽高按位打包在标志位后，不值得为它加一条位流解码
}
if (b[0] === 0xff && b[1] === 0xd8) {
let i = 2;
while (i + 9 < b.length) {
if (b[i] !== 0xff) { i++; continue; }
const m = b[i + 1];
if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
return { fmt: 'jpeg', h: u16(b, i + 5), w: u16(b, i + 7) };
}
if (m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
i += 2 + u16(b, i + 2);
}
return null;
}
} catch (e) {}
return null;
}
function encodeCanvas(draw, w, h, mime, quality, opaque) {
const c = document.createElement('canvas');
c.width = w; c.height = h;
try {
const x = c.getContext('2d');
if (opaque && mime === 'image/jpeg') { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); }
draw(x);
const data = mime === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality);
return data && data.length > 32 && data !== 'data:,' ? data : null;
} catch (e) { return null; } finally { c.width = c.height = 0; }
}
async function subsampleCapable() {
if (subCapable === true || subCapable === false) return subCapable;
if (typeof createImageBitmap !== 'function' || typeof Blob === 'undefined') { subCapable = false; return false; }
try {
const c = document.createElement('canvas');
c.width = 32; c.height = 16;
const x = c.getContext('2d');
x.fillStyle = '#123456'; x.fillRect(0, 0, 32, 16);
const url = c.toDataURL('image/png');
c.width = c.height = 0;
const blob = dataUrlToBlob(url);
const tryOne = (opts) => createImageBitmap(blob, opts);
const bm = await tryOne({ resizeWidth: 8, resizeHeight: 4, resizeQuality: 'high' })
.catch(() => tryOne({ resizeWidth: 8, resizeHeight: 4 }).catch(() => null));
subCapable = !!(bm && bm.width === 8 && bm.height === 4);
if (bm && bm.close) { try { bm.close(); } catch (e) {} }
} catch (e) { subCapable = false; }
return subCapable;
}
async function bitmapAt(blob, tw, th, mime, quality, opaque) {
let bm = null;
try {
bm = await createImageBitmap(blob, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' });
} catch (e) {
try { bm = await createImageBitmap(blob, { resizeWidth: tw, resizeHeight: th }); } catch (e2) { bm = null; }
}
if (!bm) return null;
try {
if (bm.width !== tw || bm.height !== th) return null;
return encodeCanvas((x) => x.drawImage(bm, 0, 0, tw, th), tw, th, mime, quality, opaque);
} finally { if (bm.close) { try { bm.close(); } catch (e3) {} } }
}
function imageDecoded(srcUrl) {
return new Promise((resolve) => {
let settled = false;
const once = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); };
const timer = setTimeout(() => once({ st: 'decode-timeout' }), DECODE_WATCHDOG_MS);
const img = new Image();
img.onload = () => once({ img: img });
img.onerror = () => once({ st: 'decode-failed' });
img.src = srcUrl;
});
}
function fitSides(w, h, maxSide) {
const s = Math.min(1, maxSide / Math.max(w, h));
return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}
function noteOut(r, t0, blob, tag) {
r.ms = Math.round(nowMs() - t0);
if (blob) r.inKB = Math.round((blob.size || 0) / 1024);
if (r.data) r.outKB = Math.round(r.data.length / 1024);
try {
ring.unshift({ t: Date.now(), tag: tag || '', st: r.st, path: r.path || '', srcPx: r.srcPx || '', inKB: r.inKB || 0, outKB: r.outKB || 0, ms: r.ms });
if (ring.length > 8) ring.pop();
} catch (e) {}
return r;
}
window.mochiImgIngest = function (src, opts) {
const o = opts || {};
const maxSide = Math.max(32, Math.round(o.maxSide > 0 ? o.maxSide : 1280));
const mime = o.mime === 'image/png' ? 'image/png' : 'image/jpeg';
const quality = typeof o.quality === 'number' ? o.quality : 0.85;
const byteLimit = o.byteLimit > 0 ? o.byteLimit : 0;
const opaque = o.opaque === true;
const budget = o.maxPixels > 0 ? o.maxPixels : FULL_DECODE_PIXELS;
const t0 = nowMs();
return (async function () {
const blob = asBlob(src);
if (!blob) return noteOut({ st: 'read-failed' }, t0, null, o.tag);
const px = await probePixels(blob);
if (px && px.w > 0 && px.h > 0 && px.w * px.h > budget) {
if (!(await subsampleCapable())) {
return noteOut({ st: 'too-big', srcPx: px.w + 'x' + px.h, path: 'none' }, t0, blob, o.tag);
}
let side = fitSides(px.w, px.h, maxSide);
let last = null;
for (let i = 0; i < FIT_MAX_STEP; i++) {
const data = await bitmapAt(blob, side.w, side.h, mime, quality, opaque);
if (!data) return noteOut({ st: 'decode-failed', srcPx: px.w + 'x' + px.h, path: 'sub' }, t0, blob, o.tag);
last = data;
if (!byteLimit || data.length <= byteLimit || side.w <= FIT_MIN_SIDE) {
return noteOut({ st: 'ok', data: data, srcPx: px.w + 'x' + px.h, path: 'sub', side: side.w + 'x' + side.h }, t0, blob, o.tag);
}
side = fitSides(px.w, px.h, Math.max(FIT_MIN_SIDE, Math.round(side.w * 0.75)));
}
return noteOut({ st: 'ok', data: last, srcPx: px.w + 'x' + px.h, path: 'sub-fit-min', side: side.w + 'x' + side.h }, t0, blob, o.tag);
}
const objectUrl = typeof src === 'string' ? src : (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : null);
if (!objectUrl) return noteOut({ st: 'read-failed', srcPx: px ? px.w + 'x' + px.h : '?' }, t0, blob, o.tag);
const dec = await imageDecoded(objectUrl);
if (typeof src !== 'string') { try { URL.revokeObjectURL(objectUrl); } catch (e) {} }
if (!dec.img) return noteOut({ st: dec.st, srcPx: px ? px.w + 'x' + px.h : '?' }, t0, blob, o.tag);
const img = dec.img;
const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
const srcPx = w + 'x' + h;
if (!px && w * h > budget) return noteOut({ st: 'too-big', srcPx: srcPx, path: 'full' }, t0, blob, o.tag);
let side = fitSides(w, h, maxSide);
let last = null;
for (let i = 0; i < FIT_MAX_STEP; i++) {
const data = encodeCanvas((x) => x.drawImage(img, 0, 0, side.w, side.h), side.w, side.h, mime, quality, opaque);
if (!data) return noteOut({ st: 'decode-failed', srcPx: srcPx, path: 'full' }, t0, blob, o.tag);
last = data;
if (!byteLimit || data.length <= byteLimit || side.w <= FIT_MIN_SIDE) {
return noteOut({ st: 'ok', data: data, srcPx: srcPx, path: 'full', side: side.w + 'x' + side.h }, t0, blob, o.tag);
}
side = fitSides(w, h, Math.max(FIT_MIN_SIDE, Math.round(side.w * 0.75)));
}
return noteOut({ st: 'ok', data: last, srcPx: srcPx, path: 'full-fit-min', side: side.w + 'x' + side.h }, t0, blob, o.tag);
})().catch(() => noteOut({ st: 'read-failed' }, t0, null, o.tag)); // 闸本身永不 reject：调用方只认回执 st，任何意外都要变成一个能说出口的失败
};
window.mochiImgCompressTo = function (src, opts) {
return window.mochiImgIngest(src, opts).then((r) => (r && r.st === 'ok' ? r.data : null));
};
window.mochiImgIngestMiss = function (r, what) {
const st = r && r.st;
if (st === 'too-big') return (what || '图片') + '太大（' + ((r && r.srcPx) || '未知尺寸') + '），本机浏览器无法安全处理，请换一张小图或用系统相机默认尺寸重拍';
if (st === 'decode-timeout') return (what || '图片') + '读取超时（存储或解码正忙），请稍后再点一次，不需要换图';
if (st === 'read-failed') return (what || '图片') + '没能读出来，请重新选一次';
return (what || '图片') + '格式不支持或本机解码失败，请换一张';
};
window.mochiImgIngestLog = function () { return ring.slice(0); };
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("img-ingest.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("img-ingest.js"); try { console.error("[JS] img-ingest.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[img-ingest.js] " + String(__e && __e.message || __e)); } })();
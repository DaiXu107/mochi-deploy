// src/js/img-ingest.js — 图片导入统一解码闸（#1270）
// 需求（iPhone 17 Pro Max／iOS 26.6.1 桌面图标独立应用实报「无法导入任何照片，特别是朋友圈背景
// 和给联系人单独添加的表情包和照片，会严重卡顿白屏，唯一方法只能大退」）：全站 40+ 个上传入口各自
// 手写一条「FileReader → 整幅解码 → canvas 缩放」的链，判据分了两派，而这一代手机主摄就是
// 4800 万像素（实测 8000×6000 高细节 JPEG ≈ 8.0MB 原文件 / 10.6MB base64）——
//   ① 带闸的一派（桌面壁纸 #351、表情包、字卡…：base64 >8MB 或像素 >2600 万直接拒）＝这台手机
//      拍的任何一张照片都过不了闸 → 用户看到的「无法导入任何照片」；
//   ② 没闸的一派（聊天背景 csBgCompress、头像 compressHead 在 v3.26.x 把像素上限整块删掉、
//      朋友圈封面 feed.compressImage）＝ img.src 直接吃 10MB base64，内核为 48MP 分配
//      8000×6000×4B ≈ 192MB 位图（iOS 的 WebContent 进程扛不住）→ 「严重卡顿白屏只能大退」。
// 两派都是「先整幅解码再说」造成的，所以收口只动一件事：**导入不需要整幅解码**。
// 这里放唯一一份判定：先用文件头算出像素尺寸（不解码），超预算的走 createImageBitmap
// 边解边缩（产物只有目标尺寸那一份位图），内核不认这个能力时才退回旧的「拒」——
// 宁可不导入，也不再拿整幅解码去赌进程。零机型／零 UA 分支：判据只有字节数、像素数、能力三态。
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

  // 不解码拿像素尺寸：PNG(IHDR) / GIF(LSD) / WebP(VP8·VP8X) / JPEG(扫段头找 SOFn)。
  // 认不出的格式返回 null，调用方退回旧的「解码后再看像素」口径，不新增失败面。
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
      // JPEG 没有透明通道：不铺白底时透明区会直接落成黑色（v3.7.x 起各入口一直自己铺，
      // 收进闸里由调用方按 mime 决定，语义与旧写法一致）
      if (opaque && mime === 'image/jpeg') { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); }
      draw(x);
      const data = mime === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality);
      // iOS 的 canvas 在超大尺寸下会「不报错但产出空图」（'data:,'），旧链把它当成功存进库＝
      // 用户看到的坏图。这里统一按失败处理，绝不让空产物入库。
      return data && data.length > 32 && data !== 'data:,' ? data : null;
    } catch (e) { return null; } finally { c.width = c.height = 0; }
  }

  // 能力探测（不是 UA 猜测）：造一张 32×16 的小图，要求 resize 到 8×4，量回来的实际尺寸。
  // 尊重参数＝支持边解边缩；不尊重（旧 WebKit 直接忽略参数）＝false，退回旧口径。
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
      // 只画「内核确认按目标尺寸解出来」的那一份；尺寸不对＝参数被忽略，可能正占着整幅位图，直接弃用
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

  // 唯一入口。src = File/Blob（首选，能整条链不产生 base64 大字符串）或 dataURL 字符串。
  // opts = { maxSide, mime, quality, byteLimit, maxPixels, tag }
  // 回执 = { st:'ok'|'too-big'|'decode-failed'|'decode-timeout'|'read-failed', data, srcPx, path }
  // 调用方只允许在 st==='ok' 时入库；'too-big' 与 'decode-*' 说不同的话（见 mochiImgIngestMiss）。
  window.mochiImgIngest = function (src, opts) {
    const o = opts || {};
    const maxSide = Math.max(32, Math.round(o.maxSide > 0 ? o.maxSide : 1280));
    const mime = o.mime === 'image/png' ? 'image/png' : 'image/jpeg';
    const quality = typeof o.quality === 'number' ? o.quality : 0.85;
    const byteLimit = o.byteLimit > 0 ? o.byteLimit : 0;
    // 透明图转 JPEG 会落成黑底——是否先铺白底由调用方决定（chatcard 的字卡一直铺，
    // personalize/chat-settings 的老写法不铺）。默认不铺＝迁移前后产物逐字节一致。
    const opaque = o.opaque === true;
    const budget = o.maxPixels > 0 ? o.maxPixels : FULL_DECODE_PIXELS;
    const t0 = nowMs();
    return (async function () {
      const blob = asBlob(src);
      if (!blob) return noteOut({ st: 'read-failed' }, t0, null, o.tag);
      const px = await probePixels(blob);
      if (px && px.w > 0 && px.h > 0 && px.w * px.h > budget) {
        if (!(await subsampleCapable())) {
          // 老内核没有边解边缩：维持旧的「拒」，但这一次是明确告知，不再拿整幅解码赌渲染进程
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
      // 尺寸在预算内（或格式嗅探不出来）：走原来的「解码 + canvas 缩放」，产物同样要过字节收敛
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

  // 兼容旧签名：只要产物 dataURL，失败给 null（各入口原本就是这个契约，一字不改地接上）
  window.mochiImgCompressTo = function (src, opts) {
    return window.mochiImgIngest(src, opts).then((r) => (r && r.st === 'ok' ? r.data : null));
  };
  // 两种「没导入成功」必须说两种话：图本身超限＝换图；内核没解出来＝重试或换浏览器口径
  window.mochiImgIngestMiss = function (r, what) {
    const st = r && r.st;
    if (st === 'too-big') return (what || '图片') + '太大（' + ((r && r.srcPx) || '未知尺寸') + '），本机浏览器无法安全处理，请换一张小图或用系统相机默认尺寸重拍';
    if (st === 'decode-timeout') return (what || '图片') + '读取超时（存储或解码正忙），请稍后再点一次，不需要换图';
    if (st === 'read-failed') return (what || '图片') + '没能读出来，请重新选一次';
    return (what || '图片') + '格式不支持或本机解码失败，请换一张';
  };
  window.mochiImgIngestLog = function () { return ring.slice(0); };
})();

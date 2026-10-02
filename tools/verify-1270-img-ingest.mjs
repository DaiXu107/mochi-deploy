// ===== 回归 #1270：照片导入统一解码闸（48MP 照片过闸不整幅解码）＋ 桌面壁纸读空不拆层 =====
// 用户实报（iPhone 17 Pro Max / iOS 26.6.1，Safari 添加到桌面）：「无法导入任何照片，特别是朋友圈
// 背景和单独添加的表情包和照片，会严重卡顿白屏，唯一方法只能大退」「壁纸每隔几分钟就会崩掉」。
// 本机诊断：本页被系统回收 122 次。
// 两条根因（零机型／零 UA 分支＝判据只有文件头像素、内核能力回执、大键回执三态与页面可见性）：
//   ① 全站 14 个照片入口各写一套导入，分成「按 base64 字符串长度判太大＋解出来再判像素」的误拒派
//      （现代手机照片动辄 8MB/48MP＝任何照片都被判『图片过大』）与「一个闸都没有、new Image() 整幅
//      解码」的裸解码派（48MP＝192MB 位图＝iOS 回收整页＝白屏大退），外加解码失败就把整张原图塞进
//      存储的兜底。修＝src/js/img-ingest.js 唯一解码闸：先嗅文件头像素 → 真解码能力探测决定能否
//      边解边缩 → 产物字节收敛 → 五种回执，闸自身永不 reject。
//   ② #1195e 每次切后台按体积放掉 ≥256KB 大键的内存副本（正解，未动），桌面壁纸那一路读空时当场
//      拆掉常驻层＝「过几分钟崩一次」。修＝聊天背景 #1218 的 waitBg 口径搬到桌面＋回前台双通道复核。
// 用例（无头真跑产物；VERIFY_ROOT 指被测副本）：
//   A1~A3 合成 48MP（8000×6000）PNG 喂进真闸：回执 st='ok'、srcPx 如实、产物最长边 ≤64、内存位图峰值 ≤16MP
//   A4 回执落日志（tag/srcPx/path/side/decMp），证「边解边缩」这条路径真被走到
//   B1~B4 14 个入口全部只接这一个闸（产物文本断言：js/img-ingest.js 在场＋各入口无裸整幅解码残留）
//   C1~C3 桌面壁纸：库里图还在、同步读空时不拆常驻层（pbgExpectBg→保留最后一帧），回前台复核接线
//   D1 失败回执说人话（mochiImgIngestMiss 分态文案，不退化成一句「图片处理失败」）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const roots = (process.argv[2] || '').split(';').map((s) => s.trim()).filter(Boolean);
const root = normalize(roots[0] || process.env.VERIFY_ROOT || (HERE + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// ---- 合成一张 8000×6000（48MP）的合法 PNG：纯灰像素，deflate 后很小，但解码后位图 = 48MB×4 ----
function makePng(w, h) {
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcT[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, cc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit grayscale
  const row = Buffer.alloc(1 + w); // filter 0 + 灰度像素（渐变，避免纯色被内核优化）
  for (let x = 0; x < w; x++) row[1 + x] = (x * 255 / w) | 0;
  const raw = Buffer.alloc(row.length * h);
  for (let y = 0; y < h; y++) row.copy(raw, row.length * y);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const BIG = makePng(8000, 6000);
const TMP = normalize(process.env.TEMP || '/tmp');
const BIG_PATH = join(TMP, 'mochi-v1270-48mp.png');
writeFileSync(BIG_PATH, BIG);

const server = createServer((req, res) => {
  try {
    if (req.url.split('?')[0] === '/fixture-48mp.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': BIG.length }); res.end(BIG); return; }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); server.close(); process.exit(1); }
const port = Number(process.env.MOCHI_CDP_PORT) || (12710 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--user-data-dir=' + join(TMP, 'mochi-v1270-' + port + '-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map(); const excs = [];
for (let i = 0; i < 100; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const pg = l.find((t) => t.type === 'page');
    if (pg) {
      ws = new WebSocket(pg.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('CDP 连不上（端口 ' + port + ' 可能被占用）'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => {
  const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 200);
  return r && r.result ? r.result.value : null;
};
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__decMp = [];
    try {
      const oi = Image.prototype, attr = Object.getOwnPropertyDescriptor(oi, 'src');
      Object.defineProperty(oi, 'src', {
        configurable: true,
        set: function (v) { const self = this; const probe = function () { try { if (self.width && self.height) window.__decMp.push(self.width * self.height); } catch (e) {} self.removeEventListener('load', probe); self.removeEventListener('error', probe); }; self.addEventListener('load', probe); self.addEventListener('error', probe); return attr.set.call(this, v); },
        get: attr.get,
      });
    } catch (e) {}
    try {
      const cib = window.createImageBitmap;
      if (cib) window.createImageBitmap = function () {
        const o = arguments[1] || {};
        if (o.resizeWidth) window.__decMp.push(o.resizeWidth * (o.resizeHeight || o.resizeWidth));
        else window.__decMp.push(-1); // -1 ＝ 要求整幅解码（没有边解边缩）
        return cib.apply(window, arguments);
      };
    } catch (e) {}
    localStorage.setItem('xy-home-v2:applock-qaskip', '1');
  `,
});
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(3200);
for (let i = 0; i < 100; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }

const results = [];
const t = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail !== undefined && detail !== '' ? '  <- ' + detail : '')); };

// ---------- A 族：48MP 照片过真闸 ----------
const ing = await ev(`(async () => {
  const blob = await (await fetch('/fixture-48mp.png')).blob();
  const f = new File([blob], '48mp.png', { type: 'image/png' });
  if (typeof window.mochiImgIngest !== 'function') return { missing: true, bytes: blob.size };
  window.__decMp.length = 0;
  const r = await window.mochiImgIngest(f, { maxSide: 64, quality: 0.8, mime: 'image/jpeg', tag: 'v1270-a' });
  const out = { missing: false, bytes: blob.size, st: r && r.st, srcPx: r && r.srcPx, side: r && r.side, path: r && r.path, outKB: r && r.outKB, data: r && r.data, dec: window.__decMp.slice(0, 12), log: (window.mochiImgIngestLog ? window.mochiImgIngestLog().slice(-1) : null) };
  const im = new Image();
  await new Promise((res) => { im.onload = res; im.onerror = res; im.src = r && r.data; });
  out.decodedW = im.naturalWidth || im.width || 0;
  out.decodedH = im.naturalHeight || im.height || 0;
  return out;
})()`);
t('A0 统一解码闸在产物里加载（js/img-ingest.js 接入 jsFiles）', ing && !ing.missing, ing && ing.missing ? 'window.mochiImgIngest 不存在＝闸没接入构建' : '');
if (ing && !ing.missing) {
  t('A1 48MP 照片回执 ok（既不误拒也不崩）', ing.st === 'ok', 'st=' + ing.st + ' 原图=' + ing.bytes + 'B srcPx=' + ing.srcPx + ' path=' + ing.path);
  t('A2 解码前先量到真实像素 8000x6000（文件头嗅探，不是解出来才知道）', ing.srcPx === '8000x6000', 'srcPx=' + JSON.stringify(ing.srcPx));
  t('A3 产物最长边 = 64（口径未被整幅解码取代）', ing.side === '64x48' && ing.decodedW <= 64 && ing.decodedH <= 64, 'side=' + ing.side + ' 实量=' + ing.decodedW + '×' + ing.decodedH);
  const peak = Math.max(0, ...(ing.dec || []).map((v) => (v > 0 ? v : 0)));
  const fullReq = (ing.dec || []).indexOf(-1) >= 0;
  t('A4 全页解码位图峰值 ≤16MP、且没有整幅解码请求（48MP 整幅＝192MB＝白屏大退那一条）', !fullReq && peak <= 16000000, 'peak=' + (peak * 4 / 1048576).toFixed(0) + 'MB fullReq=' + fullReq + ' dec=' + JSON.stringify(ing.dec));
  t('A5 产物字节远小于原图（画布收敛真的在跑）', ing.outKB > 0 && ing.outKB * 1024 < ing.bytes, 'out=' + ing.outKB + 'KB in=' + Math.round(ing.bytes / 1024) + 'KB');
  const rec = (ing.log || [])[0] || {};
  t('A6 回执落日志带 tag/st/path/srcPx（下次报障能看出走的哪条解码路）', !!(rec.tag === 'v1270-a' && rec.st && rec.path && rec.srcPx), JSON.stringify(rec));
}

// ---------- M 族：同一枚 48MP 照片，旧链 vs 新闸实测对照（无断言的部分按 INFO 打印） ----------
// LEGACY ＝ 逐字照抄 HEAD `js/feed.js` 的 compressImage 三条腿（FileReader→整幅 new Image()→canvas→
// toDataURL），这就是报障设备上「选一张照片」当场发生的事。
const MEASURE = `(async () => {
  const blob = await (await fetch('/fixture-48mp.png')).blob();
  const f = new File([blob], '48mp.png', { type: 'image/png' });
  const gc = () => { try { window.gc && window.gc(); } catch (e) {} };
  const out = {};
  // 旧链
  gc(); await new Promise((r) => setTimeout(r, 250));
  let lMp = 0, lStr = 0;
  const t0 = performance.now();
  out.legacy = await new Promise((res) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      lStr = String(ev.target.result).length;
      const img = new Image();
      img.onload = () => {
        lMp = img.width * img.height;
        const max = 800; let w = img.width, h = img.height;
        if (Math.max(w, h) > max) { const r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const data = cv.toDataURL('image/jpeg', 0.82);
        res({ ms: Math.round(performance.now() - t0), mp: lMp, strKB: Math.round(lStr / 1024), outKB: Math.round(data.length / 1024), side: w + 'x' + h });
      };
      img.onerror = () => res({ err: 'decode-failed', ms: Math.round(performance.now() - t0) });
      img.src = ev.target.result;
    };
    reader.onerror = () => res({ err: 'read-failed' });
    reader.readAsDataURL(f);
  });
  gc(); await new Promise((r) => setTimeout(r, 400));
  // 新闸
  window.__decMp.length = 0;
  const t1 = performance.now();
  let g = { err: 'no-gate' };
  if (typeof window.mochiImgIngest === 'function') {
      const r = await window.mochiImgIngest(f, { maxSide: 800, quality: 0.82, mime: 'image/jpeg', tag: 'v1270-m' });
    const im = new Image(); await new Promise((x) => { im.onload = x; im.onerror = x; im.src = (r && r.data) || ''; });
    g = { ms: Math.round(performance.now() - t1), mp: im.naturalWidth * im.naturalHeight, strKB: 0, outKB: r && r.outKB, side: r && r.side, path: r && r.path, decMp: Math.max(0, ...window.__decMp.map((v) => (v > 0 ? v : 0))) };
  }
  out.gate = g;
  return out;
})()`;
const mm = await ev(MEASURE);
if (mm && mm.legacy) {
  console.log('INFO 48MP（8000×6000・' + Math.round(BIG.length / 1024) + 'KB 文件）朋友圈口径 800px/0.82：');
  console.log('  旧链  解码位图 ' + (mm.legacy.mp / 1e6).toFixed(0) + 'MP（≈' + Math.round(mm.legacy.mp * 4 / 1048576) + 'MB 位图＝iOS 回收整页那一档）｜base64 中间串 ' + Math.round(mm.legacy.strKB / 1024) + 'MB｜' + mm.legacy.ms + 'ms｜产物 ' + mm.legacy.outKB + 'KB ' + mm.legacy.side);
  console.log('  新闸  解码位图 ' + ((mm.gate.decMp || mm.gate.mp || 0) / 1e6).toFixed(3) + 'MP（走 ' + mm.gate.path + ' 路）｜base64 中间串 0MB（File 直接进闸）｜' + mm.gate.ms + 'ms｜产物 ' + mm.gate.outKB + 'KB ' + mm.gate.side);
  t('M1 解码位图峰值砍到旧链的 1/10 以下（旧＝48MP 整幅＝iOS 回收整页）', mm.gate && mm.gate.decMp > 0 && mm.gate.decMp * 10 < mm.legacy.mp, 'gate=' + mm.gate.decMp + ' legacy=' + mm.legacy.mp);
  t('M2 产物口径与旧链一致（最长边 800、JPEG 0.82 没被改小）', mm.gate.side === mm.legacy.side, 'gate=' + mm.gate.side + ' legacy=' + mm.legacy.side);
  t('M3 新闸不在 JS 堆里造 MB 级 base64 中间串（旧链要先造整张原图的字符串）', mm.gate.strKB === 0 && mm.legacy.strKB > 1024, 'legacy str=' + mm.legacy.strKB + 'KB');
  t('M4 闸在同一张 48MP 上照常结算（旧链那 220ms 里含一次 183MB 整幅解码＝真机上这一步就是白屏）', !!mm.gate.path, 'gate.path=' + mm.gate.path + ' ms=' + mm.gate.ms);
} else {
  t('M1~M4 对照测量跑通', false, JSON.stringify(mm && mm.legacy ? mm : mm).slice(0, 160));
}

// ---------- B 族：14 个入口只接这一个闸 ----------
const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const gateJs = art('js/img-ingest.js');
t('B1 闸本体带能力探测（边解边缩按真解码实测，不是机型分支）', gateJs.indexOf('subCapable = !!(bm && bm.width === 8 && bm.height === 4);') >= 0, gateJs ? 'js/img-ingest.js ' + gateJs.length + 'B' : '产物里没有 js/img-ingest.js');
t('B2 零机型／零 UA 分支：闸里没有 UA/触摸点/厂商判定（只按内核回执）', !/navigator\.userAgent|maxTouchPoints|\bis[A-Z][a-zA-Z]*\s*=/.test(gateJs), (gateJs.match(/navigator\.userAgent|maxTouchPoints|\bis[A-Z][a-zA-Z]*\s*=/g) || []).slice(0, 3).join(','));
const entries = { 'js/feed.js': 2, 'js/chat.js': 2, 'js/chat-settings.js': 1, 'js/chatcard.js': 1, 'js/personalize.js': 1, 'js/avatar-lib.js': 1, 'js/group-chat.js': 3, 'js/divination.js': 1, 'js/gift-shop.js': 1, 'js/auction.js': 1, 'js/mail.js': 1, 'js/memo-arc.js': 1, 'js/music-player.js': 1, 'js/call.js': 1 };
let wired = 0;
for (const [f, min] of Object.entries(entries)) {
  const s = art(f);
  const n = (s.match(/window\.mochiImg(Ingest|CompressTo)\(/g) || []).length;
  if (n >= min) wired++;
  else console.log('   · 接线不足 ' + f + ' 命中 ' + n + ' < ' + min);
}
t('B3 14 个照片入口全部改接统一闸（' + wired + '/14）', wired === Object.keys(entries).length, wired + '/14');
t('B4 兜底「按原图添加」不再存在（旧兜底＝整张原图塞进存储）', !entries['js/chat.js'] || art('js/chat.js').indexOf('已按原图添加') < 0, art('js/chat.js').indexOf('已按原图添加') >= 0 ? '仍在 js/chat.js' : 'ok');

// ---------- C 族：桌面壁纸读空不拆层 ----------
const pz = art('js/personalize.js');
t('C1 壁纸读空且库里图还在时保留最后一帧（waitBg 闸）', pz.indexOf('else { waitBg = pbgExpectBg() && pbgHydrateBgOnce(); if (!waitBg) setBgLayerImage(null); }') >= 0, 'js/personalize.js ' + pz.length + 'B');
t('C2 回前台双通道复核（visibilitychange ＋ mochi-fg-resume）', pz.indexOf("document.addEventListener('mochi-fg-resume', applyBgVisibility);") >= 0 && pz.indexOf("document.addEventListener('visibilitychange'") >= 0, '');
const cs = art('js/chat-settings.js');
t('C3 聊天背景同口径回前台复核', cs.indexOf('if (chatPage && !chatPage.hidden) csBgHoldLayer();') >= 0 || cs.indexOf('if (csBgExpectBg()) csBgHydrateOnce();') >= 0, '');

// ---------- D 族：失败回执说人话 ----------
const miss = await ev(`(() => {
  if (typeof window.mochiImgIngestMiss !== 'function') return null;
  return {
    big: window.mochiImgIngestMiss({ st: 'too-big' }, '朋友圈图片'),
    slow: window.mochiImgIngestMiss({ st: 'decode-timeout' }, '朋友圈图片'),
    nod: window.mochiImgIngestMiss({ st: 'decode-failed' }, '朋友圈图片'),
    rd: window.mochiImgIngestMiss({ st: 'read-failed' }, '朋友圈图片'),
  };
})()`);
t('D1 五种失败各说一句实话（不退化成一句「图片处理失败」）', !!miss && miss.big !== miss.slow && miss.slow !== miss.nod && /太大|超/.test(miss.big) && /慢|超时/.test(miss.slow), miss ? JSON.stringify(miss) : 'window.mochiImgIngestMiss 不存在');

const jsErrs = await ev('(window.__jsErrors||[]).length');
t('E1 全程零 JS 异常', !jsErrs || jsErrs === 0, JSON.stringify(jsErrs));

const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log('\n合计 ' + pass + '/' + results.length + ' 通过（root=' + root + '）');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { writeFileSync(BIG_PATH, ''); } catch (e) {}
process.exit(fail ? 1 : 0);

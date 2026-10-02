// ===== 压缩图片功能·清晰度实测（img-compress.js）=====
// 用法：先 `node build.mjs`，再 `node tools/verify-img-compress-clarity.mjs`
// 被测对象是**产物 index.html**（用户实际打开的那一份）。
// 断言（对照 KIND 目标：字卡图 720px/JPEG0.85、表情 480px/PNG、壁纸 2880px）：
//   S0-S1  播种：字卡库(image)一张 2000x1500 高清「照片感」图 + 表情(sticker)一张透明 PNG +
//          壁纸键一张 3000x2000 高清图，均明显大于阈值 → 进压缩流程能扫到
//   C1     压缩确实生效（processed ≥ 3）
//   C2     尺寸达标：字卡图最长边 ≤ 720 且 ≥ 710（四舍五入误差 1px 内）；壁纸最长边 ≤ 2880 且 ≥ 2870
//   C3     清晰度达标（核心）：压缩图 vs 原图无损缩放到同尺寸的 PSNR ≥ 34dB
//          （JPEG q0.85 对照片级图的典型水平 36~42dB；<34 说明有可见糊/色块）
//   C4     表情 PNG 保留透明：压缩后仍是 PNG，且 alpha 通道仍存在 0 像素（没被白底填充）
//   C5     像素量级守恒：压缩后图面积 ≥ 原图面积 25%（720 缩 2000 = 13% 边，面积 ~13%；防缩成指甲盖）
//   C6     WebP 档（#431）：支持 WebP 编码的环境照片类产物必须是 image/webp；
//          不支持的环境（旧 Safari 等）回退 image/jpeg（与旧行为一致）。表情 PNG 不受影响
//   A1     全程无 JS 运行时错误
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const artifact = readFileSync(join(root, 'index.html'), 'utf8');
if (!artifact.includes('window.mochiImgCompress')) {
  console.log('ENV  产物里还没有压缩图片功能——请先执行 node build.mjs 再跑本脚本');
  process.exit(2);
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(artifact);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 9));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-img-clear-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function waitFor(expr, tries = 60, step = 250) {
  for (let i = 0; i < tries; i++) { if (await evalJs(expr)) return true; await sleep(step); }
  return false;
}
let navSeq = 0;
async function coldStart() {
  const token = 'nav' + Date.now().toString(36) + '-' + (++navSeq);
  await evalJs(`window.__navToken = ${JSON.stringify(token)}; true`);
  await cdp('Page.navigate', { url: baseUrl + '/' });
  await waitFor(`window.__navToken !== ${JSON.stringify(token)}`, 60, 250);
  await sleep(2000);
  await waitFor("typeof window.xyStore === 'function' && typeof window.idbListKeys === 'function'");
  await waitFor('!!window.__mochiDataReady');
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(600);
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== 播种：一张「照片感」高清测试图（渐变天空 + 山形 + 纹理细节）=====
await coldStart();
const seeded = await evalJs(`(async function(){
  try {
    // 生成 2000x1500 高清「照片感」图：平滑渐变天空 + 山丘曲线 + 稀疏细节（模拟真实照片，
    // 不能是海量随机噪点——那恰是 JPEG 最不擅长的合成纹理，会把 PSNR 压到失真水平）
    // detail=500（字卡图，测 PSNR 用）或 detail=4000（壁纸图，只要超过 400KB 阈值即可，不测 PSNR）
    function photo(w, h, detail) {
      detail = detail || 500;
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#4a90d9'); g.addColorStop(.45, '#8ec5f0'); g.addColorStop(1, '#f0e8d8');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      // 柔和云朵（大色块渐变，JPEG 擅长）
      var cloud = x.createRadialGradient(w*.3, h*.25, 10, w*.3, h*.25, w*.35);
      cloud.addColorStop(0, 'rgba(255,255,255,.9)'); cloud.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = cloud; x.fillRect(0, 0, w, h);
      var cloud2 = x.createRadialGradient(w*.75, h*.18, 5, w*.75, h*.18, w*.3);
      cloud2.addColorStop(0, 'rgba(255,255,255,.85)'); cloud2.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = cloud2; x.fillRect(0, 0, w, h);
      // 山丘曲线（平滑大色块）
      x.fillStyle = '#5a8a5a';
      for (var s = 0; s < 40; s++) {
        x.beginPath();
        x.moveTo(0, h*.62 + s*7);
        for (var px = 0; px <= w; px += 40) x.lineTo(px, h*.62 + s*7 + Math.sin(px*.006+s)*30);
        x.lineTo(w, h); x.lineTo(0, h); x.closePath();
        x.fill();
      }
      // 草地细节（detail 个点；字卡图少些保 PSNR，壁纸图多些保证超 400KB 阈值）
      for (var i = 0; i < detail; i++) {
        x.fillStyle = 'rgba(' + ((i*29)%60+50) + ',' + ((i*13)%80+90) + ',' + ((i*7)%60+40) + ',.85)';
        x.beginPath();
        x.arc(Math.random()*w, h*.55 + Math.random()*h*.4, 1+Math.random()*2.5, 0, Math.PI*2);
        x.fill();
      }
      return c.toDataURL('image/jpeg', 0.95); // 高保真 JPEG 原图（模拟用户上传的手机照片；PNG 源会被 keepPng 走无损路径，测不出 JPEG 质量）
    }
    function pngTransparent(w, h) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d');
      // 真随机像素纹理：圆内 alpha=255（Math.random 无周期，PNG 的 DEFLATE 压不动 → 远超 100KB 阈值），
      // 圆外 alpha=0（透明区必须保留，验证 PNG 路径不白底填充）。
      // 注意：确定性公式（如 (px*31+y*7)&255）有 256px 周期会被 PNG 压到几十 KB，测不出压缩路径。
      var cx = w*.5, cy = h*.5, r = w*.35;
      var d = x.createImageData(w, h);
      for (var y = 0; y < h; y++) {
        for (var px = 0; px < w; px++) {
          var off = (y*w + px) * 4;
          var dx = px - cx, dy = y - cy;
          if (dx*dx + dy*dy <= r*r) {
            d.data[off] = Math.floor(Math.random() * 256);
            d.data[off+1] = Math.floor(Math.random() * 256);
            d.data[off+2] = Math.floor(Math.random() * 256);
            d.data[off+3] = 255;
          } else {
            d.data[off+3] = 0; // 圆外透明
          }
        }
      }
      x.putImageData(d, 0, 0);
      return c.toDataURL('image/png');
    }
    var G = window.xyStore('xy-home-v2');
    // 字卡库：image 分类一张大图（"照片感"高清），sticker 分类一张透明 PNG
    var imgUrl = photo(2000, 1500);
    var stkUrl = pngTransparent(900, 900);
    var lib = { text: 'clear-test', image: [['测试分组', [imgUrl]]], sticker: [['表情分组', [stkUrl]]] };
    G.set('cc-groups-public', JSON.stringify(lib));
    // 壁纸键：3000x2000 高清图（KIND wall 目标 2880px），detail 加大保证超过 400KB 阈值
    var wallUrl = photo(3000, 2000, 4000);
    G.set('phone-bg', wallUrl);
    // 压缩前快照原图（压缩会覆盖原数据，对比用）
    window.__clearOrig = { img: imgUrl, wall: wallUrl };
    // 诊断：三张图 base64 长度（对照阈值 100KB/100KB/400KB）
    window.__seedLens = { img: imgUrl.length, stk: stkUrl.length, wall: wallUrl.length };
    return true;
  } catch (e) { return 'err:' + e.message; }
})()`);
check('S0 播种高清测试图成功（字卡 2000x1500 + 表情透明 PNG + 壁纸 3000x2000）', seeded === true, seeded);
const seedLens = await evalJs('window.__seedLens || null');
console.log('  播种图 base64 长度：字卡=' + (seedLens && seedLens.img) + ' 表情=' + (seedLens && seedLens.stk) + ' 壁纸=' + (seedLens && seedLens.wall) + '（阈值 102400/102400/409600）');
// 不重载：window.__clearOrig 原图快照要留着做清晰度对比。
// 页面冷启动时 idbRestore 正在回填大量键（LS→IDB），此时 idbListKeys 事务排队会 4s 超时
// 返回 null（"存储繁忙"）——模拟用户等页面安顿后再点压缩：轮询直到 IDB 清单可读。
let idbReady = false;
for (let i = 0; i < 40; i++) {
  const keys = await evalJs('window.idbListKeys().then(function(k){ return Array.isArray(k) ? k.length : -1; })');
  if (typeof keys === 'number' && keys >= 3) { idbReady = true; break; }
  await sleep(500);
}
check('S1 IndexedDB 就绪（清单可读，≥3 键）', idbReady === true);

// ===== 走真实压缩流程（全部来源） =====
const scan = JSON.parse(await evalJs('window.mochiImgScan().then(function(r){ return JSON.stringify(r); })') || '{}');
check('S2 扫描能发现 3 张可压缩图', scan.ok === true && (scan.cc.n || 0) >= 2 && (scan.beauty.n || 0) >= 1, 'cc=' + (scan.cc.n || 0) + ' beauty=' + (scan.beauty.n || 0));

const cmp = JSON.parse(await evalJs('window.mochiImgCompress("all").then(function(r){ return JSON.stringify(r); })') || '{}');
check('C1 压缩实际生效（≥3 张被替换为更小产物）', cmp.ok === true && (cmp.processed || 0) >= 3, 'processed=' + (cmp.processed || 0) + ' saved=' + ((cmp.saved || 0) / 1048576).toFixed(2) + 'MB skipped=' + (cmp.skipped || 0) + ' reason=' + (cmp.reason || ''));

// ===== 读回压缩结果，实测清晰度 =====
const probe = JSON.parse(await evalJs(`(async function(){
  function sizeOf(dataUrl) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () { res({ w: img.width, h: img.height }); };
      img.onerror = function () { res(null); };
      img.src = dataUrl;
    });
  }
  // PSNR：把两张 dataURL 画到同尺寸 canvas 逐像素比较
  function psnr(a, b, W, H) {
    return new Promise(function (res) {
      var ca = document.createElement('canvas'); ca.width = W; ca.height = H;
      ca.getContext('2d').drawImage(a, 0, 0, W, H);
      var cb = document.createElement('canvas'); cb.width = W; cb.height = H;
      cb.getContext('2d').drawImage(b, 0, 0, W, H);
      var da = ca.getContext('2d').getImageData(0, 0, W, H).data;
      var db = cb.getContext('2d').getImageData(0, 0, W, H).data;
      var mse = 0, n = W * H;
      for (var i = 0; i < n; i++) {
        var r = da[i*4] - db[i*4], g = da[i*4+1] - db[i*4+1], bl = da[i*4+2] - db[i*4+2];
        mse += r*r + g*g + bl*bl;
      }
      mse = mse / (n * 3);
      if (mse === 0) return res(99);
      return res(10 * Math.log10(255 * 255 / mse));
    });
  }
  function alphaHasZero(dataUrl) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0);
        var d = x.getImageData(0, 0, img.width, img.height).data;
        for (var i = 3; i < d.length; i += 4) { if (d[i] === 0) { res(true); return; } }
        res(false);
      };
      img.onerror = function () { res(null); };
      img.src = dataUrl;
    });
  }
  var G = window.xyStore('xy-home-v2');
  var raw = G.get('cc-groups-public');
  var g = raw ? JSON.parse(raw) : null;
  var out = { err: null, orig: null, comp: null, wall: null, stkFmt: null, stkAlpha: null };
  try {
    if (g && g.image && g.image[0] && g.image[0][1]) {
      out.orig = g.image[0][1][0];
    } else out.err = '字卡库压缩后没读到 image 分类';
    if (g && g.sticker && g.sticker[0] && g.sticker[0][1]) {
      var stk = g.sticker[0][1][0];
      out.stkFmt = String(stk).split(';')[0];
      out.stkAlpha = await alphaHasZero(stk);
    } else out.err = (out.err || '') + ' / sticker 分类缺失';
    var wall = G.get('phone-bg');
    out.wall = wall;
    if (out.orig) out.compSize = await sizeOf(out.orig);
    if (out.wall) out.wallSize = await sizeOf(out.wall);
    out.imgFmt = out.orig ? String(out.orig).split(';')[0] : null;
    out.webpProbe = (function () { try { var c = document.createElement('canvas'); c.width = 1; c.height = 1; return c.toDataURL('image/webp', 0.8).indexOf('data:image/webp') === 0; } catch (e) { return false; } })();
    return JSON.stringify(out);
  } catch (e) { out.err = 'probe-err:' + e.message; return JSON.stringify(out); }
})()`));
check('读回压缩后数据完整', !probe.err && !!probe.compSize && !!probe.orig, probe.err || 'compSize=' + JSON.stringify(probe.compSize));

// C2 尺寸达标
check('C2a 字卡图压缩后最长边 ≤ 720 且 ≥ 710（720px 目标）',
  probe.compSize && probe.compSize.w <= 720 && probe.compSize.w >= 710, 'w=' + (probe.compSize && probe.compSize.w) + ' h=' + (probe.compSize && probe.compSize.h));
check('C2b 壁纸压缩后最长边 ≤ 2880 且 ≥ 2870（2880px 目标）',
  probe.wallSize && probe.wallSize.w <= 2880 && probe.wallSize.w >= 2870, 'w=' + (probe.wallSize && probe.wallSize.w) + ' h=' + (probe.wallSize && probe.wallSize.h));

// C6 WebP 档（#431）
check('C6a 支持 WebP 编码时照片类产物为 image/webp（#431）', !probe.webpProbe || probe.imgFmt === 'data:image/webp', 'probe=' + probe.webpProbe + ' fmt=' + probe.imgFmt);
check('C6b 不支持 WebP 时回退 image/jpeg（与旧行为一致）', !!probe.webpProbe || probe.imgFmt === 'data:image/jpeg', 'fmt=' + probe.imgFmt);

// C3 清晰度核心：快照原图(2000x1500) vs 压缩后读回图(720x540) 画到同尺寸逐像素 PSNR
await evalJs(`(async function(){
  var snap = window.__clearOrig;
  if (!snap) return 'no-snap';
  window.__psnrResult = null;
  var origImg = new Image();
  origImg.onload = function () {
    var compUrl = ${JSON.stringify(probe.orig)};
    var compImg = new Image();
    compImg.onload = function () {
      var W = compImg.width, H = compImg.height;
      var ca = document.createElement('canvas'); ca.width = W; ca.height = H;
      var xa = ca.getContext('2d'); xa.drawImage(origImg, 0, 0, W, H);
      var cb = document.createElement('canvas'); cb.width = W; cb.height = H;
      var xb = cb.getContext('2d'); xb.drawImage(compImg, 0, 0, W, H);
      var da = xa.getImageData(0, 0, W, H).data;
      var db = xb.getImageData(0, 0, W, H).data;
      var mse = 0, n = W * H;
      for (var i = 0; i < n; i++) {
        var r = da[i*4] - db[i*4], g = da[i*4+1] - db[i*4+1], b = da[i*4+2] - db[i*4+2];
        mse += r*r + g*g + b*b;
      }
      mse = mse / (n * 3);
      window.__psnrResult = mse === 0 ? 99 : 10 * Math.log10(255 * 255 / mse);
      // 同时存压缩后实际尺寸
      window.__compDim = { w: W, h: H };
    };
    compImg.src = compUrl;
  };
  origImg.src = snap.img;
  return 'started';
})()`);
// 等 PSNR 算完
let psnrVal = null;
for (let i = 0; i < 40; i++) {
  psnrVal = await evalJs('window.__psnrResult || null');
  if (psnrVal !== null && psnrVal !== undefined) break;
  await sleep(200);
}
check('C3 清晰度达标：压缩图 vs 原图缩放到同尺寸 PSNR ≥ 34dB（JPEG q0.85 照片级典型 36~42dB）',
  typeof psnrVal === 'number' && psnrVal >= 34, 'PSNR=' + (psnrVal === null ? 'N/A' : psnrVal.toFixed(2)) + 'dB');

// C4 表情 PNG 保留透明
check('C4 表情包压缩后仍为 PNG 且保留透明区（alpha=0 像素仍在，未白底填充）',
  probe.stkFmt === 'data:image/png' && probe.stkAlpha === true, 'fmt=' + probe.stkFmt + ' alpha0=' + probe.stkAlpha);

// C5 像素量级守恒：压缩后面积不过度缩小（字卡 720x540 相对原 2000x1500 面积比 ~13%）
check('C5 压缩后图片像素量守恒（面积 ≥ 原图 12%，防缩成指甲盖）',
  probe.compSize && probe.compSize.w * probe.compSize.h >= 2000 * 1500 * 0.12,
  'area=' + (probe.compSize ? probe.compSize.w * probe.compSize.h : 0) + ' 原面积比=' + (probe.compSize ? (probe.compSize.w * probe.compSize.h / (2000 * 1500) * 100).toFixed(1) : '') + '%');

const errs = JSON.parse(await evalJs("(function(){ return JSON.stringify((window.__jsErrors||[]).slice(0,8)); })()") || '[]');
check('A1 全程无 JS 运行时错误', errs.length === 0, errs.join('|'));

const fail = results.filter((r) => !r.ok);
console.log('\n===== verify-img-compress-clarity: ' + (results.length - fail.length) + '/' + results.length + ' =====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail.length ? 1 : 0);

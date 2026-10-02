// ===== 回归脚本：#1257 朋友圈发布配图令牌化（无头浏览器真跑发布流，验证产物行为非仅源码锚）=====
// 用法：node build.mjs && node tools/verify-1257-feed-publish-tokenize-e2e.mjs
//       SERVE_ROOT=<已构建副本目录> node tools/verify-1257-feed-publish-tokenize-e2e.mjs（红绿对照）
// 背景：见 verify-1257-feed-publish-tokenize.mjs 头注（红侧＝修复前，发图后主键里存 dataURL）。
// 断言面：E1 发布成功且动态出现；E2 feed-posts 引用为 @@m: 令牌、非 dataURL；E3 池键真落 IDB
//   （先池后引用）；E4 刷新后重读引用仍是令牌（主键恒小键、LS 可读）；E5 全程零 JS 异常。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
if (!existsSync(join(root, 'index.html'))) { console.error('产物不存在，先构建：' + root); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
console.log('serve root = ' + root);

// —— 真 PNG：400×400 渐变+噪声（不可压缩到 <1KB，保证过池的 1024 闸门）——
function crc32(buf) {
  let c, table = crc32.t || (crc32.t = (() => { const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  let s = 0x2f6e2b1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) % 256; };
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = (x * 2 + rnd()) & 255;
      raw[off + 2 + x * 3] = (y * 2 + rnd()) & 255;
      raw[off + 3 + x * 3] = rnd();
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng(400, 400);

let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' —— ' + x : '')); } }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
async function openApp(st) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') st.jsErrors.push('[console] ' + m.text().slice(0, 160)); });
  await page.addInitScript(() => { try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {} });
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
    const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
  });
  await page.waitForTimeout(800);
  return page;
}
const st = { jsErrors: [], chooser: 0 };
let page = await openApp(st);
await page.evaluate(() => { document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-feed'); }); });
await page.waitForTimeout(300);

const pending = [];
page.on('filechooser', (fc) => { pending.push(fc); });
// 无头负载高时首屏渲染会拖过默认 30s 缺省超时（实测整支脚本被 TimeoutError 抛穿＝看不到任何读数）。
// 这里把每一步都收成「断言＋继续」，慢只慢、不崩；重试两次仍不动才判红。
async function tap(fn, what) {
  for (let i = 0; i < 3; i++) {
    try { await fn(); return true; } catch (e) { await page.waitForTimeout(1500); }
  }
  ok(false, what);
  return false;
}
await tap(() => page.evaluate(() => {
  const c = document.getElementById('feed-publish-card'); if (c) c.hidden = false;
  document.getElementById('feed-pick-img').scrollIntoView();
}), 'E0 发布卡片可露出（无头负载/渲染超时）');
await tap(() => page.click('#feed-pick-img', { timeout: 8000 }), 'E0 点「添加图片」有响应');
await page.waitForTimeout(600);
ok(pending.length === 1, 'E0a 点「添加图片」弹出了文件选择器', 'pending=' + pending.length + ' chooser=' + st.chooser);
if (!pending.length) {
  ok(false, 'E1 发布成功且动态出现在列表', '无文件选择器＝后续步骤无从执行');
} else {
  await tap(() => pending[0].setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG }), 'E0b 文件落进选择器');
}
await page.waitForTimeout(1200);
await tap(() => page.fill('#feed-input', 'e2e-1257 发布配图', { timeout: 8000 }), 'E0c 正文可填入');
await tap(() => page.click('#feed-publish', { timeout: 8000 }), 'E0d 点「发布」有响应');
await page.waitForTimeout(2500);

const r1 = await page.evaluate(async () => {
  const out = { posts: null, ids: [], raw: null };
  const list = document.querySelectorAll('#feed-list .feed-post');
  out.nPosts = list.length;
  out.raw = window.xyStore('xy-home-v2').get('feed-posts');
  try { out.stored = JSON.parse(out.raw || '[]').map(p => ({ id: p.id, imgs: (p.imgs || []).map(s => String(s).slice(0, 6)) })); } catch (e) { out.stored = null; }
  return out;
});
ok(r1.nPosts >= 1, 'E1 发布成功且动态出现在列表', 'nPosts=' + r1.nPosts);
const mine = (r1.stored || []).find(p => p.imgs.some(i => i.startsWith('@@m:')) || p.imgs.some(i => i.startsWith('data:')));
ok(!!mine, 'E1b 主键里能找回这条带图动态', JSON.stringify(r1.stored && r1.stored.slice(0, 3)));
ok(!!mine && mine.imgs.every(i => i.startsWith('@@m:')), 'E2 引用为 @@m: 令牌（红侧＝data:）', mine && JSON.stringify(mine.imgs));
const poolKeys = await page.evaluate(async () => {
  const raw = window.xyStore('xy-home-v2').get('feed-posts') || '[]';
  const toks = [...new Set((raw.match(/@@m:[0-9a-f]{32}/g) || []))];
  const res = [];
  for (const t of toks) { const v = await window.idbGet('xy-home-v2:media:' + t.slice(4)); res.push(!!v && String(v).startsWith('data:')); }
  return { n: toks.length, all: res.every(Boolean), res };
});
ok(poolKeys.n > 0 && poolKeys.all, 'E3 令牌对应的池键真在 IDB（先池后引用）', JSON.stringify(poolKeys));

await page.reload();
await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1200);
const r2 = await page.evaluate(() => {
  const raw = window.xyStore('xy-home-v2').get('feed-posts') || '[]';
  return { hasTok: /@@m:[0-9a-f]{32}/.test(raw), hasDataImg: /"imgs":\[[^\]]*data:image/.test(raw), n: (raw.match(/@@m:/g) || []).length };
});
ok(r2.hasTok && !r2.hasDataImg, 'E4 刷新后主键仍是小键令牌（红侧此时读不到/只剩无图快照）', JSON.stringify(r2));
ok(st.jsErrors.length === 0, 'E5 全程零 JS 异常', st.jsErrors.slice(0, 3).join(' | '));
await browser.close();
server.close();
console.log('结果 ' + pass + '/' + fail);
process.exit(fail ? 1 : 0);

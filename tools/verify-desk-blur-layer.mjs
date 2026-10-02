// ===== 验证 #240：背景模糊载体改壁纸层自滤（小米15Pro/Chrome 151 真机 backdrop 采样不生效） =====
// #219 提层后无头样式全对但真机仍无感 → 模糊从 .phone-bg-mask 的 backdrop-filter 改为
// #phone-bg-layer 自身 filter:blur（.desk-blur-on），白遮罩层与 z2 结构不动。
// 用法：node tools/verify-desk-blur-layer.mjs（需先 node build.mjs）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const base = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);
// 种键：default 桌面壁纸（高频棋盘格 dataURL——渐变类图模糊前后差异极小测不出，必须高频纹理）
await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 800;
  const g = c.getContext('2d');
  g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, 400, 800);
  g.fillStyle = '#111111';
  const cell = 10;
  for (let y = 0; y < 800 / cell; y++) for (let x = 0; x < 400 / cell; x++) if ((x + y) % 2 === 0) g.fillRect(x * cell, y * cell, cell, cell);
  const P = 'xy-home-v2:default:';
  localStorage.setItem(P + 'phone-bg', c.toDataURL('image/png'));
  localStorage.setItem(P + 'bg-blur', '12');
  localStorage.setItem(P + 'bg-mask-op', '50');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1800);
await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
await page.waitForTimeout(400);

// B1 .desk-blur-on 挂在 .phone 上
const b1 = await page.evaluate(() => {
  const ph = document.querySelector('.phone');
  return { on: ph.classList.contains('desk-blur-on'), visible: [...document.querySelectorAll('.page')].filter(p => !p.hidden).map(p => p.id) };
});
check('B1 blur=12 时 .desk-blur-on 挂上且桌面页可见', b1.on && b1.visible.indexOf('page-phone') >= 0, JSON.stringify(b1));

// B2/B3 壁纸层 computed filter + 四边外扩
const b2 = await page.evaluate(() => {
  const l = document.getElementById('phone-bg-layer');
  const cs = getComputedStyle(l);
  return { filter: cs.filter, top: cs.top, left: cs.left, opacity: cs.opacity, z: cs.zIndex, bgLen: (l.style.backgroundImage || '').length };
});
check('B2 壁纸层 computed filter=blur(12px)', b2.filter.indexOf('blur(12px)') >= 0, b2.filter);
check('B3 壁纸层四边外扩-24px(防边缘发虚)', b2.top === '-24px' && b2.left === '-24px', JSON.stringify({ t: b2.top, l: b2.left }));
check('B3b 壁纸层可见且载入壁纸', b2.opacity === '1' && b2.bgLen > 100, JSON.stringify({ op: b2.opacity, len: b2.bgLen }));

// B4 白遮罩层与 #219 z2 结构保留
const b4 = await page.evaluate(() => {
  const m = document.querySelector('.phone-bg-mask');
  const cs = getComputedStyle(m);
  return { z: cs.zIndex, bg: cs.backgroundColor, backdrop: cs.backdropFilter };
});
check('B4 白遮罩 z2+50% 生效（#219 结构保留）', b4.z === '2' && b4.bg.indexOf('0.5') >= 0, JSON.stringify(b4));

// B5 模糊开/关截图像素 diff 显著（视觉真生效，不是只有样式）
const shotOn = await page.screenshot({ type: 'png' });
await page.evaluate(() => {
  document.querySelector('.phone').classList.remove('desk-blur-on');
  document.documentElement.style.setProperty('--desk-bg-blur', '0px');
});
await page.waitForTimeout(400);
const shotOff = await page.screenshot({ type: 'png' });
const diff = await page.evaluate(async ([b64on, b64off]) => {
  async function img(b64) { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); return im; }
  const [i1, i2] = await Promise.all([img(b64on), img(b64off)]);
  const w = Math.min(i1.width, i2.width), h = Math.min(i1.height, i2.height);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  function data(im) { g.clearRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; }
  const d1 = data(i1), d2 = data(i2);
  let df = 0;
  for (let i = 0; i < d1.length; i += 4) df += Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]);
  return df / (w * h);
}, [shotOn.toString('base64'), shotOff.toString('base64')]);
check('B5 模糊开/关像素diff显著(视觉生效)', diff > 5, 'avg=' + diff.toFixed(2));

// B6 blur=0 时类摘除、filter 归 none（iOS 卡顿红线：不常驻激活）
const b6 = await page.evaluate(() => {
  const ph = document.querySelector('.phone');
  const l = document.getElementById('phone-bg-layer');
  return { on: ph.classList.contains('desk-blur-on'), filter: getComputedStyle(l).filter };
});
check('B6 blur=0 类摘除+filter归none(红线不激活)', !b6.on && (b6.filter === 'none' || b6.filter === ''), JSON.stringify(b6));

// B7 静态锚
const css = readFileSync(join(root, 'src/css/home.css'), 'utf8');
const js = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');
check('B7 静态锚：home.css 自滤规则+personalize.js 挂类', css.indexOf('.phone.desk-blur-on #phone-bg-layer') >= 0 && js.indexOf("classList.toggle('desk-blur-on', px > 0)") >= 0);

// B8（#765d）壁纸层真被提成独立合成层，且提层不改几何/层序
// （B5/B6 收尾时把 .desk-blur-on 与 --desk-bg-blur 关掉了，这里先恢复 blur 态，
//   几何口径才与 B3 的「外扩 -24 ⇒ 390+48」一致）
await page.evaluate(() => {
  document.querySelector('.phone').classList.add('desk-blur-on');
  document.documentElement.style.setProperty('--desk-bg-blur', '12px');
});
await page.waitForTimeout(300);
const b8 = await page.evaluate(() => {
  const l = document.getElementById('phone-bg-layer');
  const cs = getComputedStyle(l);
  const r = l.getBoundingClientRect();
  return { transform: cs.transform, willChange: cs.willChange, top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), z: cs.zIndex };
});
check('B8 壁纸层 computed transform 已提层（非 none）且几何不变（外扩 -24、z1）', b8.transform !== 'none' && b8.top === -24 && b8.left === -24 && b8.z === '1' && b8.w === 390 + 48, JSON.stringify(b8));

// B9（#765d）静态锚：src 与产物都在（产物形态＝minify 剥注释后的单行）
const builtHtml = readFileSync(join(root, 'index.html'), 'utf8');
check('B9a src/home.css 含提层声明', css.indexOf('#phone-bg-layer { transform:translateZ(0); }') >= 0);
check('B9b 产物含提层声明', builtHtml.indexOf('#phone-bg-layer { transform:translateZ(0); }') >= 0);

await browser.close();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);

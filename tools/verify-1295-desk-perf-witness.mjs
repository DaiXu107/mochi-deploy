// verify-1295-desk-perf-witness.mjs — #1295 iPhone 11／iOS 18.7 桌面卡顿「现场取证」收口
// 症状（实报两份导出件：桌面翻页帧耗时 平均114ms／p90 832／最慢 1665ms，切回桌面 平均236ms／
//   最慢 1667ms，卡顿自检 120s 前台冻结 22 次、最慢帧全落在手机桌面——但聊天数据仅 22KB，
//   persist 一类落盘吃不满 1.7s；旧仪器没有任何一条通道能给「那一刀」定名）。
// 修法（零机型／零 UA 分支＝取证只取计算样式、类名与既有账本三个事实）：
//   ① device.js __mochiDeskScene()：桌面图层现场读数（壁纸形态与 dataURL 纹理体积／#1285 外扩盒
//      倍率／模糊走烘焙还是 CSS 滤镜兜底／整页背景／标签栏毛玻璃），诊断【性能】单独成行；
//   ② desktop-slider.js sampleWitness()：#690/#884 两处帧耗时采样收尾随附 sc/ph 两字段，
//      「平均 114ms」从此带着当时的桌面配置与近操作；
//   ③ personalize.js：壁纸 dataURL 真重绘（bg-paint~NKB）与模糊烘焙失败兜底（bg-blur-fallback）
//      进 __mochiPhase 账本，诊断尾部列「近操作账本」8 条带 Δ；
//   ④ perf-check.js：出报告这一刻读同一现场成行＋blurCss/texKB/zoom/tabBlur 四条可对照 A/B 建议。
// 断言：S1~S6 产物锚；R1 现场函数；R2 存壁纸→重启→图层真重绘进账本（端到端接线）；
//   R3 现场读数对 DOM 计算样式/类名的判据（CSS 滤镜兜底＋外扩盒倍率）；R4 翻页样本带现场；
//   R5 切回桌面样本带现场；R6 诊断单三条新行；Z1 零未捕获异常。
// 用法：node build.mjs && node tools/verify-1295-desk-perf-witness.mjs
//   基线对照：SERVE_ROOT=<纯 HEAD 副本> node tools/verify-1295-desk-perf-witness.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
console.log('serve root = ' + root);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const art = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };

// ===== S 静态锚（产物） =====
console.log('\n== S 产物锚 ==');
const dev = art('device.js'), dsk = art('desktop-slider.js'), per = art('personalize.js'), pfc = art('perf-check.js');
ok(dev.includes('out.texKB = Math.round((bi.length - dpos) / 1024);') && dev.includes('window.__mochiDeskScene = function ('),
  'S1 __mochiDeskScene 现场读数在产物（纹理体积测算＝报告里「多大」那一半）');
ok(dev.includes("L.push('桌面图层现场：'") && dev.includes('（当时现场：') && dev.includes('近操作账本（旧→新'),
  'S2 诊断【性能】三条新行（现场行＋样本随附现场＋近操作账本）都在');
ok(dsk.includes('function sampleWitness()') && dsk.includes('sc: _w690.sc, ph: _w690.ph') && dsk.includes('sc: _w884.sc, ph: _w884.ph'),
  'S3 两处帧耗时样本（翻页／切回桌面）都随附现场快照（漏一处＝另一条路径复发时无从对质）');
const gOpen = per.indexOf('if (l.style.backgroundImage !== want) {'), gMark = per.indexOf("__mochiPhase('bg-paint~'"), gWrite = per.indexOf('l.style.backgroundImage = want;');
ok(gOpen >= 0 && gMark > gOpen && gWrite > gMark && per.includes("__mochiPhase('bg-blur-fallback')"),
  'S4 壁纸重绘点名写在「值变才写」守卫之内（守卫外＝每次刷新灌一条假线索）＋烘焙兜底点名在位');
ok(pfc.includes("if (_ds && _ds.txt !== '读数失败')") && pfc.includes('if (r.janky > 0 && _ds) {') &&
   pfc.includes('_ds.blurCss') && pfc.includes('_ds.texKB') && pfc.includes('_ds.tabBlur'),
  'S5 卡顿自检出报告带桌面现场行＋现场驱动的 A/B 建议（流畅时不开腔）');
const sceneZone = dev.slice(dev.indexOf('window.__mochiDeskScene = function'), dev.indexOf('window.mochiDevice = {'));
ok(!/userAgent|navigator\.vendor|iPhone|iPad|XiaoMi|Redmi/i.test(sceneZone + dsk.slice(dsk.indexOf('function sampleWitness'), dsk.indexOf('let perfOn'))),
  'S6 本批新增逻辑零机型／零 UA 分支', '命中机型判定');

// ===== 运行时 =====
const browser = await chromium.launch({ headless: true });
async function boot() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  // 注意：#modal-mask/.modal 是 openModal 的 load 期单例引用（personalize.js IIFE），删节点＝
  // 之后所有 openModal 静默失效——本脚本 R6 要真开诊断弹窗，只能藏不能删。
  await page.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.remove(); document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach(n => n.remove()); const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true; });
  await page.waitForTimeout(500);
  return { ctx, page, errs };
}
const { ctx, page, errs } = await boot();

console.log('\n== R 运行时 ==');
// R1 现场函数
const r1 = await page.evaluate(() => (window.__mochiDeskScene ? window.__mochiDeskScene() : null));
ok(r1 && typeof r1.txt === 'string' && r1.txt.includes('壁纸=') && r1.txt.includes('DPR='),
  'R1 __mochiDeskScene() 可调用且给出现场串', JSON.stringify(r1 && r1.txt));

// R2 存壁纸→重启→真重绘进账本（端到端：paintBgLayerImage 的守卫分支在启动路径上被走实）
const BIG = 'A'.repeat(9000);
await page.evaluate((b) => { window.activeStore().set('phone-bg', 'data:image/jpeg;base64,' + b); }, BIG);
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1600);
const r2 = await page.evaluate(() => {
  const l = document.getElementById('phone-bg-layer');
  const log = (window.__mochiPhaseLog || []).map((e) => e.tag);
  const s = window.__mochiDeskScene ? window.__mochiDeskScene() : null;
  return { painted: !!(l && l.style.backgroundImage.indexOf('url("data:') === 0), paintTag: log.some((t) => /^bg-paint~\d+KB$/.test(t)), sc: s && s.txt, mode: s && s.mode, texKB: s && s.texKB };
});
ok(r2.painted, 'R2a 重启后壁纸图层真重绘（现场取证的前提）');
ok(r2.paintTag, 'R2b 重绘在 __mochiPhase 账本点名（bg-paint~NKB，带体积）');
ok(r2.mode === '图' && r2.texKB >= 8 && r2.sc.includes('≈'),
  'R2c 现场读数按 DOM 实况报「图 + ≈N KB 纹理」', JSON.stringify(r2));

// R3 现场判据＝计算样式/类名（CSS 滤镜兜底档＋#1285 外扩盒倍率）
const r3 = await page.evaluate(() => {
  if (!window.__mochiDeskScene) return null; // 基线侧无此函数＝本断言红，不炸整条电池
  const ph = document.querySelector('.phone'), l = document.getElementById('phone-bg-layer');
  ph.classList.add('desk-blur-on');
  l.style.setProperty('--desk-bg-blur', '8px');
  l.style.setProperty('width', '150%', 'important');
  l.style.setProperty('height', '150%', 'important');
  const s = window.__mochiDeskScene();
  ph.classList.remove('desk-blur-on');
  l.style.removeProperty('--desk-bg-blur');
  l.style.removeProperty('width'); l.style.removeProperty('height');
  const s2 = window.__mochiDeskScene();
  return { on: s, off: s2 };
});
ok(r3 && r3.on.blurCss === true && r3.on.txt.includes('CSS滤镜8px'),
  'R3a desk-blur-on＝烘焙失败兜底档被点名（合成开销最大的一档，报告必须分清）', JSON.stringify(r3 && r3.on.txt));
ok(r3 && r3.on.zoom > 1.4 && r3.on.txt.includes('外扩盒×'),
  'R3b 外扩盒倍率按真实盒宽量出（#1285 缩放档对纹理栅格化面积的影响可见）', String(r3 && r3.on.zoom));
ok(r3 && r3.off.blurCss === false && r3.off.zoom <= 1.02,
  'R3c 撤掉类/样式即回读关／1.00（读数不粘滞、不吃 store 旧值）', JSON.stringify(r3 && [r3.off.blurCss, r3.off.zoom]));

// R4 翻页样本随附现场（真走 #690 采样收尾：一次 scroll 事件起采 60 帧）
await page.evaluate(() => { document.querySelector('.desktop-pages').dispatchEvent(new Event('scroll')); });
await page.waitForFunction(() => { try { const j = JSON.parse(localStorage.getItem('xy-home-v2:__diag-deskperf') || 'null'); return j && j.n >= 60 && Date.now() - j.t < 15000; } catch (e) { return false; } }, null, { timeout: 15000 }).catch(() => {});
const r4 = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('xy-home-v2:__diag-deskperf') || 'null'); } catch (e) { return null; } });
ok(r4 && typeof r4.sc === 'string' && r4.sc.includes('壁纸=') && 'ph' in r4,
  'R4 「桌面翻页帧耗时」样本带当时现场＋近操作（帧号证慢、现场证为什么慢）', JSON.stringify(r4 && { sc: r4.sc, ph: r4.ph }));

// R5 切回桌面样本随附现场（真走 #884：page-phone 隐藏→可见触发 swSample 30 帧）
await page.evaluate(() => { const p = document.getElementById('page-phone'); p.hidden = true; });
await page.waitForTimeout(350);
await page.evaluate(() => { const p = document.getElementById('page-phone'); p.hidden = false; });
await page.waitForFunction(() => { try { const j = JSON.parse(localStorage.getItem('xy-home-v2:__diag-swperf') || 'null'); return j && j.n >= 30 && Date.now() - j.t < 15000; } catch (e) { return false; } }, null, { timeout: 15000 }).catch(() => {});
const r5 = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('xy-home-v2:__diag-swperf') || 'null'); } catch (e) { return null; } });
ok(r5 && typeof r5.sc === 'string' && r5.sc.includes('壁纸=图') && 'ph' in r5,
  'R5 「切回桌面帧耗时」样本带当时现场（用户主诉那一刀 236ms/1667ms 从此可定责）', JSON.stringify(r5 && { sc: r5.sc }));

// R6 诊断单三条新行（真点 #row-diagnostics，读弹窗正文）
await page.evaluate(() => { const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true; const r = document.getElementById('row-diagnostics'); if (r) r.click(); });
let diagTxt = '';
try {
  await page.waitForFunction(() => {
    const el = document.getElementById('modal-textarea') || document.getElementById('modal-input');
    const t = el ? (el.value || el.textContent || '') : '';
    return t.includes('【性能】');
  }, null, { timeout: 12000 });
} catch (e) {}
diagTxt = await page.evaluate(() => { const el = document.getElementById('modal-textarea') || document.getElementById('modal-input'); return el ? (el.value || el.textContent || '') : ''; });
await page.evaluate(() => { const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true; });
ok(diagTxt.includes('桌面图层现场：壁纸=图'), 'R6a 诊断单【性能】有「桌面图层现场」行且读到当前壁纸态', diagTxt.slice(diagTxt.indexOf('【性能】'), diagTxt.indexOf('【性能】') + 160));
ok(diagTxt.includes('（当时现场：壁纸=图') && diagTxt.includes('近操作账本'),
  'R6b 两条帧耗时样本读出随附现场＋近操作账本成段');
ok(diagTxt.includes('bg-paint~'), 'R6c 壁纸重绘那条在诊断单里可见（账本→单→用户导出件一条线打通）');

ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', JSON.stringify(errs));
await ctx.close();

console.log('\n合计 ' + pass + '/' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);

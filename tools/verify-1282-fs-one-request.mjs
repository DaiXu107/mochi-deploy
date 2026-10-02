// verify-1282-fs-one-request.mjs — #1282 点【全屏模式】闪屏→黑屏 2~3 秒才进全屏
// 症状（红米 K80 + Chrome 实报「点击【全屏模式】会闪屏然后黑屏，后进入全屏模式」，用户明说
//   其他设备型号也有出现、要求不要覆盖式修补）。
// 根因（零机型／零 UA 分支＝判据只取「进行中的全屏请求」「是否已在全屏」「事件落点」三个事实）：
//   同一次点按里 documentElement.requestFullscreen() 被发两次——armRetry 的文档捕获期
//   touchstart/click 手势重入兜底不认目标，用户点开关那一下先被它吃掉发了 enterFs#1，
//   约 116ms 后开关自己的 change 分支又发 enterFs#2。真机上每一发都开一段系统级全屏切换
//   事务（收系统栏＋窗口尺寸重排＋整页重布），两发连着来＝闪一下、黑屏、才进去。
// 修法：src/js/fullscreen.js — enterFs 单点闸（在途／已全屏不再另发，promise 缺失走 1500ms
//   有界释放）＋ exitFs 撤闸 ＋ doRetry 让路闸（事件落在开关或其 label 上交还给 change 流程）。
// 断言：B1 一次点按＝恰 1 次全屏请求（基线 2 次＝症状本体）／B2 修完照常进全屏；
//   C1 没开过全屏的机器一次点按＝1 次（对照）／C2 让路闸不把手势重入整个废掉（点别处仍重入）／
//   C3 关全屏照常关得掉；S1~S5 产物锚与零机型自检；Z1 零未捕获异常。
// 用法：node build.mjs && node tools/verify-1282-fs-one-request.mjs
//   基线对照：SERVE_ROOT=<纯 HEAD 副本> node tools/verify-1282-fs-one-request.mjs
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

// ===== S 静态锚 =====
const fs = art('fullscreen.js');
ok(fs.includes('if (_fsFlight || isFullscreen()) return _fsFlight;'),
  'S1 全屏请求单点闸在产物（删＝一次点按两段全屏切换事务＝红米所见闪屏后黑屏）');
ok(fs.includes('_fsFlightTimer = setTimeout(closeFsFlight, 1500);') && fs.includes('function closeFsFlight() { clearTimeout(_fsFlightTimer); _fsFlight = null; }'),
  'S2 闸有界释放（promise 缺失／落定缺失时最长压 1.5s；删＝闸可能永久挂住，全屏再也开不了）');
ok(fs.includes('function retryTouch(e) { if (!e.isTrusted || onFsSwitch(e.target)) return; doRetry(); }') &&
   fs.includes('function retryClick(e) { if (!e.isTrusted || onFsSwitch(e.target)) return; doRetry(); }'),
  'S3 手势重入两路都认目标让路（只补一路＝另一路仍抢发全屏请求）');
ok(fs.includes("if (t.closest('#sf-fullscreen, #cs-fullscreen')) return true;"),
  'S4 让路判据＝事件落点（开关本体或其 label 装饰层），不是内核名字');
ok(fs.includes('closeFsFlight(); // #1282'),
  'S5 主动退出先撤闸（删＝退出后 1.5s 内的重入被在途闸误挡，切后台回来恢复不上）');
const zone = fs.slice(fs.indexOf('let _fsFlight'), fs.indexOf('function exitFs'));
ok(!/userAgent|MicroMessenger|XiaoMi|Redmi|MiuiBrowser|navigator\.vendor/i.test(zone),
  'S6 本批新增逻辑零机型／零 UA 分支', /userAgent|XiaoMi|Redmi/i.test(zone) ? '命中机型判定' : '');

// ===== 运行时公共夹具 =====
const browser = await chromium.launch({ headless: true });
async function boot(armed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  await page.addInitScript(() => {
    window.__calls = []; window.__ev = [];
    const orig = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (o) {
      const rec = { i: window.__calls.length + 1, t: Math.round(performance.now()), act: navigator.userActivation ? navigator.userActivation.isActive : 'n/a', r: '', fs: false };
      window.__calls.push(rec);
      let p;
      try { p = orig.call(this, o); } catch (e) { rec.r = 'THROW ' + e.name; return; }
      if (p && p.then) p.then(() => { rec.r = 'ok'; rec.fs = !!document.fullscreenElement; }, (e) => { rec.r = 'x ' + e.name; rec.fs = !!document.fullscreenElement; });
      return p;
    };
    document.addEventListener('fullscreenchange', () => window.__ev.push((document.fullscreenElement ? 'IN' : 'OUT') + '@' + Math.round(performance.now())));
  });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1300);
  await page.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.remove(); document.querySelectorAll('.modal, #modal-mask, .backup-remind-bar, .ver-update-bar').forEach(n => n.remove()); });
  await page.waitForTimeout(500);
  await page.evaluate((a) => {
    localStorage.setItem(window.activePrefix() + ':fullscreen-enabled', a ? '1' : '0');
    localStorage.setItem(window.activePrefix() + ':fullscreen-fallback', '0');
  }, armed);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.remove(); document.querySelectorAll('.modal, #modal-mask, .backup-remind-bar, .ver-update-bar').forEach(n => n.remove()); });
  await page.waitForTimeout(500);
  // 把设置页那颗开关露出来可点（真实触摸点在 label 装饰层上＝手指所点的滑块）
  const box = await page.evaluate(() => {
    const el = document.getElementById('sf-fullscreen');
    if (!el) return null;
    let n = el, hops = 0;
    while (n && n !== document.body && hops++ < 30) { n.hidden = false; n = n.parentElement; }
    el.scrollIntoView({ block: 'center' });
    const lb = el.closest('label') || el;
    const r = lb.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const state = () => page.evaluate(() => ({
    calls: window.__calls.map(c => c.i + ':' + c.t + 'ms act=' + c.act + ' => ' + c.r),
    n: window.__calls.length,
    ev: window.__ev.slice(),
    checked: !!(document.getElementById('sf-fullscreen') || {}).checked,
    cls: document.documentElement.className,
    fs: !!document.fullscreenElement,
  }));
  const tap = async (x, y) => { await page.evaluate(() => { window.__calls.length = 0; window.__ev.length = 0; }); await page.touchscreen.tap(x, y); await page.waitForTimeout(2600); return await state(); };
  return { ctx, page, box, errs, state, tap, key: () => page.evaluate(() => localStorage.getItem(window.activePrefix() + ':fullscreen-enabled')) };
}
const errLine = (s) => 'calls=' + s.n + ' ' + JSON.stringify(s.calls) + ' ev=' + JSON.stringify(s.ev) + ' checked=' + s.checked + ' cls=' + s.cls;

// ===== B1/B2 用户现场：开过全屏的机器，点一次「全屏模式」 =====
console.log('\n== B 红米现场（FS_KEY=1：上次开过全屏、本次未在全屏）==');
{
  const f = await boot(true);
  ok(!!f.box, 'B0 设置页开关在位可点');
  const s = await f.tap(f.box.x, f.box.y);
  ok(s.n === 1, 'B1 一次点按＝恰 1 次全屏请求（>1 即内核要跑两段全屏切换＝闪屏后黑屏）', errLine(s));
  ok(s.fs && s.checked && /fs-active/.test(s.cls), 'B2 修完照常进全屏、开关留住（没修坏）', errLine(s));
  ok(s.ev.filter(e => /^IN/.test(e)).length === 1, 'B2b 全屏态变化只发生一次', JSON.stringify(s.ev));
  // C3 关全屏照常关得掉（此刻重入监听已被 doRetry 消费掉）
  const s2 = await f.tap(f.box.x, f.box.y);
  ok(!s2.fs && !s2.checked && !/fs-active/.test(s2.cls), 'C3 再点一次关得掉全屏（本批没挡住正常关闭）', errLine(s2));
  ok(s2.n === 0, 'C3b 关闭这一次不再发全屏请求', errLine(s2));
  ok(f.errs.length === 0, 'Z1 全程零未捕获 JS 异常', JSON.stringify(f.errs));
  await f.ctx.close();
}

// ===== C1 对照：从没开过全屏的机器 =====
console.log('\n== C 对照（未修坏健康路径）==');
{
  const f = await boot(false);
  const s = await f.tap(f.box.x, f.box.y);
  ok(s.n === 1 && s.fs && s.checked, 'C1 没开过全屏的机器：一次点按＝1 次请求且真进全屏（改动前后同形）', errLine(s));
  await f.ctx.close();
}
// ===== C2 对照：让路闸不许把手势重入整个废掉 =====
{
  const f = await boot(true);
  const other = await f.page.evaluate(() => {
    const el = document.getElementById('sf-fullscreen-sub') || document.querySelector('.gs-sub');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + 40), y: Math.round(r.y + 6) };
  });
  const s = await f.tap(other.x, other.y);
  ok(s.n === 1 && s.fs, 'C2 点开关以外的地方，手势重入仍照常发一次全屏请求（让路只让开关那一下）', errLine(s));
  await f.ctx.close();
}

console.log('\n合计 ' + pass + '/' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);

// verify-1197-import-pick-and-memo.mjs — #1197 常驻电池（两件事，一台脚本）
//  ① 「选择导入范围」弹窗的确定层接线（#1014 原形，被 4b052ae/#975 整文件回写抹掉过一次）：
//     静态锚按 build.mjs 里 #1197a/b/c 三根针逐条对拍——**部分覆盖**（只留 entry 行、把 onFiles
//     的分流改回无参 runChatAllImport()/丢掉 doImport(f)）也要当场失守，不再指望 #1014g 那一根。
//     （行为面——顽固内核下点确定弹几次选择器——已由 tools/verify-1014-import-pick-native.mjs
//     的 B1a~B1f 逐条钉住，本脚本不重复跑，只在 S0 断言那份电池仍在仓里。）
//  ② 切后台大键内存通用闸（#1195e；iPhone 实报「ios卡顿」，诊断为内存压力下渲染进程被反复回收
//     而非 JS 长任务）：断言的是**行为**——切后台只丢内存副本、小键不误伤、持久层一字不动、
//     阈值参数与两条事件腿都在、重复触发幂等。零机型/UA 分支。
// 用法：node build.mjs && node tools/verify-1197-import-pick-and-memo.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-1197-import-pick-and-memo.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
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
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + JSON.stringify(x) + ']' : '')); } };
const jsOf = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };
const EV = (p, f) => p.evaluate(f).catch((e) => ({ __err: String((e && e.message) || e).slice(0, 140) }));
const count = (s, needle) => (s.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

// 取某个函数名开头的函数体（按花括号配平）——用于「只看这一个函数里有没有做坏事」
function bodyOf(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const o = src.indexOf('{', i);
  if (o < 0) return '';
  let d = 0;
  for (let k = o; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(o, k + 1); }
  }
  return '';
}

// ================= ① 导入确定层接线（#1197a/b/c 逐针对拍） =================
{
  ok(existsSync(join(here, 'tools', 'verify-1014-import-pick-native.mjs')),
    'S0 顽固内核行为电池仍在仓（行为面由它钉，本脚本只补静态接线）');
  const db = jsOf('data-backup.js');
  ok(count(db, "entry: 'row-import'") === 1, "#1197 前置 导入范围弹窗登记了确定层入口 entry: 'row-import'（命中次数须恰 1，多处＝铺层跑到别的弹窗）", count(db, "entry: 'row-import'"));
  ok(db.includes("if (mode === 'chat') { window.runChatAllImport(f); return; }"),
    '#1197a 「仅聊天记录」把选到的文件直接交进原管线（改回无参 runChatAllImport()＝回到二次程序化激活＝iOS 点了没反应）');
  ok(count(db, 'doImport(f);') >= 1 && db.includes("skipWhen: (m) => m === 'cancel',"),
    '#1197b/#1197c 「完整备份」这条腿收文件 + 「取消」仍走普通确定（缺前者＝文件到手没人读＝本回报障本体；缺后者＝点取消变成弹选择器）');
  // 分流必须是「有文件就走层这条路，没文件才回落到原程序化腿」——不能把 skipWhen 写成恒真
  ok(!/skipWhen:\s*\(\s*m?\s*\)\s*=>\s*true/.test(db), 'skipWhen 没被写成恒真（恒真＝铺层形同虚设，全部退回静默拒绝的程序化激活）');
}

// ================= ② 切后台大键内存闸（#1195e 静态面） =================
{
  const idb = jsOf('idb.js');
  ok(count(idb, 'window.idbMemoReleaseBig = function (minBytes) {') === 1,
    '#1197d 通用闸在位且只有一份（删＝回到 #975 的逐键点名，只有 feed-posts/快照两键会放，其余 MB 级键常驻＝帧冻结+白屏复发）');
  const body = bodyOf(idb, 'window.idbMemoReleaseBig = function (minBytes) {');
  ok(body.length > 80, '闸函数体可读（花括号配平成功，下面的「做没做坏事」断言才有意义）');
  ok(body.includes('delete memoryCache[k]') && !body.includes('idbDelete') && !body.includes('localStorage.removeItem'),
    '闸只丢内存副本，不删持久层（出现 idbDelete/localStorage.removeItem＝把缓存当垃圾清，会真丢用户数据）');
  ok(!/delete _bigIdx\[k\]/.test(body) && !/_bigIdx\s*=\s*\{\}/.test(body) && !body.includes('bigIdxSave()'),
    '闸刻意保留 _bigIdx 体积账（清了它，下次切后台与内存体检就认不出这个键有多大）');
  ok(idb.includes('var MEMO_BG_DROP_BYTES = 256 * 1024;'),
    '默认阈值＝单键 256KB（与 lsBig 同量级；写成 0 ＝每次切后台把全部缓存丢掉，写大＝等于没做）');
  const wire = bodyOf(idb, 'var onBg = function () {');
  ok(wire.includes('idbMemoReleaseBig'), '切后台入口真的调用闸（而不是只定义不调用）');
  ok(idb.includes("if (document.visibilityState === 'hidden') onBg();") && idb.includes("window.addEventListener('pagehide', onBg)"),
    '两条事件腿都在：visibilitychange→hidden（普通切后台）＋ pagehide（iOS 冻结/回收前的最后机会）');
  ok(!/idbMemoReleaseBig[\s\S]{0,200}(navigator\.userAgent|iPhone|iPad)/.test(idb),
    '零机型/UA 分支（判据只有体积）');
}

// ================= ③ 行为面：真把页面切后台，看内存/持久层各发生了什么 =================
async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { jsErrors: [] };
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
  });
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  });
  await page.waitForTimeout(700);
  return { browser, page, st };
}
// 真改可见性（#1181 同款夹具）：覆盖 Document.prototype 的 hidden/visibilityState 再派发事件，
// 让「切后台」这条链由浏览器真的走一遍，而不是我们直接调闸。
const setHidden = (page, v) => page.evaluate((val) => {
  try {
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => val });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (val ? 'hidden' : 'visible') });
  } catch (e) {}
  try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
  return true;
}, v);

{
  const { browser, page, st } = await boot();
  const seed = await EV(page, () => {
    const s = window.xyStore('xy-home-v2');
    s.set('p1197-big', 'x'.repeat(300 * 1024));      // 300KB：过阈值（大键不落 LS，只进内存+IDB）
    s.set('p1197-mid', 'm'.repeat(2 * 1024 * 1024)); // 2MB：也过阈值，用于「一次放掉多个」
    s.set('p1197-small', 'k'.repeat(2048));          // 2KB：不过阈值，必须留着
    const has = (k) => (window.idbMemoStats(2000).top.some((e) => e.k === 'xy-home-v2:' + k));
    return { big: has('p1197-big'), mid: has('p1197-mid'), small: has('p1197-small') };
  });
  ok(seed?.big && seed?.mid && seed?.small, '播种：三把键都进了本会话内存驻留（读侧口径＝idbMemoStats）', seed);

  const direct = await EV(page, () => {
    const has = (k) => window.idbMemoStats(2000).top.some((e) => e.k === 'xy-home-v2:' + k);
    const r1 = window.idbMemoReleaseBig(4 * 1024 * 1024); // 阈值高于全部播种键
    const keep = { n: r1, big: has('p1197-big'), small: has('p1197-small') };
    const r2 = window.idbMemoReleaseBig(256 * 1024);       // 恰为默认阈值
    const dropped = { n: r2, big: has('p1197-big'), mid: has('p1197-mid'), small: has('p1197-small') };
    const r3 = window.idbMemoReleaseBig(256 * 1024);       // 再跑一次＝幂等
    return { keep, dropped, again: r3 };
  });
  ok(direct?.keep?.n === 0 && direct?.keep?.big && direct?.keep?.small,
    'A1 阈值按参数生效：设成 4MB 时 300KB/2MB 两键一个都不放', direct.keep);
  ok(direct?.dropped?.n >= 2 && !direct?.dropped?.big && !direct?.dropped?.mid && direct?.dropped?.small,
    'A2 达阈的大键被放掉、未达阈的小键原地不动（判据只有体积，不认键名白名单）', direct.dropped);
  ok(direct?.again === 0 && !direct.__err, 'A3 重复调用幂等（已经放掉的不再计一次，返回 0）', direct?.again);

  const viaEvent = await page.evaluate(() => {
    const s = window.xyStore('xy-home-v2');
    s.set('p1197-ev', 'e'.repeat(500 * 1024));
    const has = () => window.idbMemoStats(2000).top.some((e) => e.k === 'xy-home-v2:p1197-ev');
    return { before: has() };
  });
  await setHidden(page, true);
  await page.waitForTimeout(250);
  const evRes = await EV(page, () => {
    const has = (k) => window.idbMemoStats(2000).top.some((e) => e.k === 'xy-home-v2:' + k);
    const released = !has('p1197-ev');
    // 闸自己不能把「本键」塞回缓存；同时切回前台后按需重读这条路要活着
    return { released, idbGetAlive: typeof window.idbGet === 'function' };
  });
  ok(viaEvent?.before && evRes?.released, 'A4 只派发 visibilitychange→hidden（不直接调函数）就把大键放掉＝监听真的接在事件上', { viaEvent, evRes });
  await setHidden(page, false);

  const ph = await page.evaluate(() => {
    const s = window.xyStore('xy-home-v2');
    s.set('p1197-ph', 'p'.repeat(500 * 1024));
    return window.idbMemoStats(2000).top.some((e) => e.k === 'xy-home-v2:p1197-ph');
  });
  await page.evaluate(() => { try { window.dispatchEvent(new PageTransitionEvent('pagehide')); } catch (e) { try { window.dispatchEvent(new Event('pagehide')); } catch (e2) {} } });
  await page.waitForTimeout(250);
  const phRes = await EV(page, () => !window.idbMemoStats(2000).top.some((e) => e.k === 'xy-home-v2:p1197-ph'));
  ok(ph && phRes, 'A5 pagehide 这条腿也跑闸（iOS 冻结/回收页面前 visibilityState 未必已翻转）', { ph, phRes });

  const persist = await EV(page, async () => {
    const out = { smallLs: null, bigIdb: null, midIdb: null, err: '' };
    try { out.smallLs = (localStorage.getItem('xy-home-v2:p1197-small') || '').length; } catch (e) { out.err += 'ls:' + e.message; }
    try {
      out.bigIdb = ((await window.idbGet('xy-home-v2:p1197-big')) || '').length;
      out.midIdb = ((await window.idbGet('xy-home-v2:p1197-mid')) || '').length;
    } catch (e) { out.err += 'idb:' + e.message; }
    return out;
  });
  ok(persist?.smallLs === 2048 && persist?.bigIdb === 300 * 1024 && persist?.midIdb === 2 * 1024 * 1024 && !persist?.err,
    'A6 持久层一字未动：放掉内存后 IDB 里仍是原值、小键 LS 快照仍在（回前台首次读自动回填）', persist);

  const refill = await EV(page, async () => {
    try {
      const v = await window.idbGet('xy-home-v2:p1197-big');
      window.xyStore('xy-home-v2').set('p1197-big', v);
      return window.idbMemoStats(2000).top.some((e) => e.k === 'xy-home-v2:p1197-big');
    } catch (e) { return 'err:' + e.message; }
  });
  ok(refill === true, 'A7 回前台按需重读这条路是活的（IDB 取回 → 重新驻留），丢缓存只是多一次往返、不是读不到', refill);

  ok(st.jsErrors.length === 0, 'Z1 全流程零 JS 异常（防修过头）', st.jsErrors.slice(0, 3));
  await browser.close();
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
server.close();
process.exit(fail ? 1 : 0);

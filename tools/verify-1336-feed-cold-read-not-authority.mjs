// ===== 常驻回归脚本 #1336：切后台放掉大键内存副本后，朋友圈把「同步层读空」当成「动态只剩这些」，一次点赞就把库里抹小 =====
// 用法：node tools/verify-1336-feed-cold-read-not-authority.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-27 直派：「EC-PAD01 SE＋chrome浏览器＋朋友圈里联系人发的朋友圈，老是没过一会儿就不见了」，
//   并明说「其他设备型号也有出现」「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现」；
//   诊断单 mochi-diag-2026-09-27-01-05-50…docx：平板／Android 14／Chromium 138／standalone PWA／
//   localStorage 整域 1355 键 ≈10.0MB＝写入失败(QuotaExceededError)、LS 写探针同样被拒、本页被系统回收 27 次）：
//   #975/#1195e 在切后台时按体积放掉 ≥256KB 大键的 memoryCache 副本（那是 iOS/安卓内存压力下的正解，
//   FIX-REGRESSION `## #1270` 勿踩⑤ 明文要求不动），而 feed-posts 一过 200KB 就被 LS 大键线剥走那份副本
//   ⇒ 回前台后 `store.get('feed-posts')` 必然同步读空。旧代码把这一次读空当成「动态只剩剥图快照那些」：
//   纯底本无头实测同一次会话内 屏上 16 条 → 4 条，接一次最正常的点赞整包写回 → 库里 15 条抹成 3 条，
//   而写小的那一发同时删掉 `__big-idx` 条目 ⇒ 事后连旁证都不留（＝那张诊断单 feed 一栏一片正常）。
//   没有快照的那一族更直接：屏上 0 条＋空态当面宣告「还没有动态」，而库里 12 条好好躺着。
//
// 收口判据（零机型／零 UA，只取一个当场可观测的事实）：
//   「本会话已经交出过一次权威整包（feedAuthSeen），这一轮同步层却交不出主键」⇒ 读数残缺，不是数据没了。
//   残缺期：① 这份整包没有写回权威键的资格（增量照旧并入既有 feedPending、仍显示在屏上）；
//          ② 按需回库里问一次（复用启动那条 feedMergeFromIdb 链，不另起第二套合并）；
//          ③ 只有问出「库里确实没有」(idbHasKey===false) 才放开写 ⇒ 全新安装/丢库重建不受影响；
//          ④ 空态不许说「还没有动态」（#1309 同一把尺：没读到 ≠ 没有）。
//   断言：F0~F3 夹具诚实（含 F3＝报障那台机的「LS 整域填满、大值写入必抛、小值照旧写得进」同型）；
//   D1/D2/D2b/D3/D5/D6/D6b/D4/D8/D8b 本批新契约（红侧读数即症状本体：屏上 16→3、库里 15→3、证人被抹、空态说谎）；
//   B1 库里确认没有＝重建期照常写（#187 那条路不许被本批闸挡死）／B2 自愈后写入照旧活着（不是永久禁写）／
//   B3 健康小键整条链路一字未动（#496/#667 领地）；Z1 零未捕获异常。
//   与 #187 的分工：#187 问「本会话见过权威没有」（启动那一轮），本批补「见过之后还会从有变无」（会话内）。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('serve root = ' + root);
if (!existsSync(join(root, 'index.html'))) {
  console.error('✗ 被测根目录没有 index.html（喂错目录了：所有断言会一起红，看起来像"修复没生效"）');
  process.exit(2);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 300) + ']' : '')); } };

const K_MAIN = 'xy-home-v2:feed-posts';
const K_SNAP = 'xy-home-v2:default:feed-posts-snap';
// #1434：朋友圈列表改成「本周＋按月」翻页折叠——种子必须落在默认那一页（本自然周）里，否则尺子量的
//   「屏上条数」会被折到 2023 年 11 月那一页去（数据层断言照旧对、屏幕读数归零＝假红）。本尺测的是
//   「冷读时不许把剥图快照当权威」，与这批数据是哪一年写的无关。
const T = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() + 60000; })();
const mkArr = (n, tag, pad) => Array.from({ length: n }, (_, i) => ({
  id: tag + '_' + i, role: i % 2 ? 'ta' : 'me', owner: 'default',
  authorName: i % 2 ? '小桃' : '我', authorAv: '', taName: '小桃', taAv: '',
  content: tag + '第' + i + '条 ' + 'x'.repeat(pad), imgs: [], stickers: [],
  ts: T + i * 60000, likes: [], comments: [],
}));
const mk = (n, tag, pad) => JSON.stringify(mkArr(n, tag, pad));
const BIG12 = mk(12, 'ta', 26000);   // 315KB：同时过 LS 大键线（200KB）与 #1195e 体积释放线（256KB）
const SNAP3 = mk(3, 'old', 40);
const SMALL6 = mk(6, 'sm', 8000);    // 49KB：留在大键线以内（LS 有副本，#496/#667 那条正常链路）
const nOf = raw => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.length : -2; } catch (e) { return raw == null ? -9 : -3; } };

function initSrc(o) {
  return `(function(){
    if (localStorage.getItem('__v1336seed') === '1') return;
    try { localStorage.clear(); } catch (e) {}
    localStorage.setItem('__v1336seed', '1');
    var hv = false;
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return hv ? 'hidden' : 'visible'; } });
      Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return hv; } });
      window.__bg = function (v) { hv = !!v; document.dispatchEvent(new Event('visibilitychange')); };
    } catch (e) { window.__bg = function (){}; }
    localStorage.setItem(${JSON.stringify(K_SNAP)}, ${JSON.stringify(o.snap)});
    ${o.fullLs ? `var oSet = function (k, v) { return localStorage.setItem(k, v); };
    window.__fill = 0; window.__probeBig = '?'; window.__probeTiny = '?';
    for (var i = 0; i < 400; i++) { try { oSet('zz_v1336_' + i, 'y'.repeat(64 * 1024)); window.__fill++; } catch (e) { break; } }
    // 只腾出约 128KB 的余量：几十字符的小值照旧写得进、快照那一级（200KB）那一发必抛
    //（＝那张诊断单同型：LS 写探针「正常」而站内大值整批被拒 212 次；余量留得比探针还大就会假绿）
    try { localStorage.removeItem('zz_v1336_0'); localStorage.removeItem('zz_v1336_1'); } catch (e) {}
    try { oSet('zz_v1336_probe', 'y'.repeat(200 * 1024)); window.__probeBig = 'ok'; } catch (e) { window.__probeBig = 'THROW:' + e.name; }
    try { localStorage.removeItem('zz_v1336_probe'); } catch (e) {}
    try { oSet('zz_v1336_probe2', 'z'); window.__probeTiny = 'ok'; } catch (e) { window.__probeTiny = 'THROW:' + e.name; }` : ''}
    ${o.lsMain ? `try { localStorage.setItem(${JSON.stringify(K_MAIN)}, ${JSON.stringify(o.lsMain)}); } catch (e) {}` : ''}
    // 只压自动发帖那一发的 60s 轮询（让「没人动手也会写回」这条路在同一场里跑到），别的定时长一律不动
    var oIn = window.setInterval;
    window.setInterval = function (f, d) { return oIn(f, d === 60000 ? 3500 : d); };
    window.__idbseed = 'pending';
    ${o.idb ? `var iv = 0, t = oIn(function () {
      iv++;
      if (window.idbSet) {
        try { window.idbSet(${JSON.stringify(K_MAIN)}, ${JSON.stringify(o.idb)}).then(function (r) { window.__idbseed = r ? 'landed' : 'rejected'; }); }
        catch (e) { window.__idbseed = 'ERR'; }
        clearInterval(t);
      } else if (iv > 900) clearInterval(t);
    }, 5);` : 'window.__idbseed = "none";'}
  })()`;
}

const rawIdb = (page, key) => page.evaluate(k => new Promise(res => {
  let rq; try { rq = indexedDB.open('mochi-db', 1); } catch (e) { return res('ERR'); }
  rq.onsuccess = () => {
    try {
      const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get(k);
      g.onsuccess = () => res(g.result === undefined ? null : g.result);
      g.onerror = () => res('ERR');
    } catch (e) { res('ERR'); }
  };
  rq.onerror = () => res('OPENERR');
}), key);
// 一次读数：屏上条数／空态宣告／同步层读数／大键证人（__big-idx，不受切后台释放影响）／库里
const read = (page) => page.evaluate(() => {
  const o = {};
  o.dom = document.querySelectorAll('#feed-list .feed-post').length;
  o.emptyClaim = !!document.querySelector('#feed-list .ta-empty');
  o.loading = !!document.querySelector('#feed-list .mochi-data-loading');
  try { const v = window.xyStore('xy-home-v2').get('feed-posts'); o.store = v === null ? null : n(v); } catch (e) { o.store = 'ERR'; }
  function n(s) { try { return JSON.parse(s).length; } catch (e) { return -3; } }
  try { o.bigIdx = window.idbBigIdxSize ? window.idbBigIdxSize('feed-posts') : 'no-api'; } catch (e) { o.bigIdx = 'ERR'; }
  try { o.lsMain = localStorage.getItem('xy-home-v2:feed-posts') === null ? null : '有'; } catch (e) { o.lsMain = 'ERR'; }
  return o;
});
const enter = async (page) => {
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('.splash,.splash-notice,.splash-box,.backup-remind-bar,.ver-update-bar').forEach(n => { n.classList.add('hide'); n.style.display = 'none'; });
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await page.waitForTimeout(800);
};
const openFeed = page => page.evaluate(() => { const el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; });
const likeOnce = page => page.evaluate(() => {
  const b = document.querySelector('#feed-list .feed-post .feed-act[data-like]');
  if (!b) return 'no-btn'; b.click(); return 'clicked';
});

const browser = await chromium.launch({ headless: true });
const errs = [];
async function session(o) {
  const ctx = await browser.newContext({ viewport: { width: 941, height: 1449 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 140)));
  await ctx.addInitScript({ content: initSrc(o) });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(page);
  return { ctx, page };
}

// ---------- 主场景：大键只在库里、快照陈旧，切一次后台再回来看一眼 ----------
{
  const { ctx, page } = await session({ idb: BIG12, snap: SNAP3 });
  const seed = await page.evaluate(() => window.__idbseed);
  const idb0 = await rawIdb(page, K_MAIN);
  const r0 = await read(page);
  await openFeed(page); await page.waitForTimeout(1800);
  const a = await read(page); const idbA = nOf(await rawIdb(page, K_MAIN));
  ok(seed === 'landed' && idbA >= 12 && a.dom >= 12 && r0.lsMain === null && (BIG12.length > 256 * 1024),
    'F0 夹具诚实：>256KB 的整包真只在库里（LS 无主键副本）、进页屏上就是这些条（屏上=' + a.dom + ' 库里=' + idbA + '）', { seed, idbA, dom: a.dom, lsMain: r0.lsMain, len: BIG12.length });
  ok(nOf(await page.evaluate(() => localStorage.getItem('xy-home-v2:default:feed-posts-snap'))) === 3,
    'F1 夹具诚实：LS 里真留着那份 3 条的陈旧剥图快照（残缺期顶包的就是它）');

  await page.evaluate(() => window.__bg(true)); await page.waitForTimeout(700);
  const cold = await read(page);
  await page.evaluate(() => window.__bg(false)); await page.waitForTimeout(800);
  ok(cold.store === null && typeof cold.bigIdx === 'number' && cold.bigIdx > 256 * 1024,
    'F2 夹具诚实：切后台真的放掉了内存副本（store.get=NULL）而大键证人照旧在（__big-idx=' + cold.bigIdx + 'B＝库里有、内存没了的铁证）', cold);

  await openFeed(page); await page.waitForTimeout(3000);
  const b = await read(page); const idbB = nOf(await rawIdb(page, K_MAIN));
  ok(b.store !== null && b.store >= idbB, 'D3 回前台再看一眼后，同步层重新交出整包（store.get=' + b.store + ' 条，缺陷侧恒 NULL）', b);
  ok(b.dom >= idbB, 'D1 回前台再进朋友圈：屏上条数不少于库里（屏上=' + b.dom + ' 库里=' + idbB + '；缺陷侧塌成 ' + 4 + ' 条）', { dom: b.dom, idbB });

  await likeOnce(page); await page.waitForTimeout(4200);
  const idbC = await rawIdb(page, K_MAIN);
  ok(nOf(idbC) >= idbB, 'D2 残缺期过一次之后的一次普通点赞，没有把库里写小（库里 ' + idbB + '→' + nOf(idbC) + '；缺陷侧 15→3）', { idbB, now: nOf(idbC) });
  ok(nOf(idbC) !== 3, 'D2b 库里没被顶成快照那 3 条（缺陷侧正是这条形态）', nOf(idbC));
  const c2 = await read(page);
  ok(c2.dom >= nOf(idbC), 'D1b 点赞后屏上仍跟得上库里（屏上=' + c2.dom + '）', c2);
  ok(typeof c2.bigIdx === 'number' && c2.bigIdx > 256 * 1024, 'D5 那一次点赞没顺手抹掉大键证人（__big-idx=' + c2.bigIdx + 'B；缺陷侧整包被写小后这一格变 undefined＝事后连旁证都不留，正是那张诊断单 feed 一栏一片正常的成因）', c2);

  // 残缺期新发一条：增量不许白丢（拒写≠丢弃，仍走既有 feedPending）
  await page.evaluate(() => window.__bg(true)); await page.waitForTimeout(600);
  await page.evaluate(() => window.__bg(false)); await page.waitForTimeout(600);
  const newId = await page.evaluate(() => {
    const el = document.querySelector('.app[data-app="feed"]'); if (el) el.click();
    return window.feedAddPost('残缺期新发的一条 ZZ1336', []);
  });
  await page.waitForTimeout(4500);
  const idbD = await rawIdb(page, K_MAIN);
  ok(typeof newId === 'string' && String(idbD).indexOf(newId) >= 0,
    'D6 残缺期发的那条动态，自愈后落在库里（id=' + newId + '；＝拒写只是不顶包，不是丢增量）', { newId, hit: String(idbD).indexOf(newId) });

  // 自愈之后写入必须还活着，且自愈那一发不得顶掉还在排队的新整包
  //（同一按钮第二次点是取消赞，所以「写没写进去」取库里内容变没变，不取点赞总数）
  await likeOnce(page); await page.waitForTimeout(4200);
  const idbE = await rawIdb(page, K_MAIN);
  ok(String(idbE).indexOf(newId) >= 0,
    'D6b 自愈之后再来一次普通点赞，残缺期发的那条还在库里（＝自愈那一发没有把排队中的整包顶掉；16→15 正是这条竞态的形态）',
    { newId, now: nOf(idbE), hit: String(idbE).indexOf(newId) });
  ok(idbE !== idbD && nOf(idbE) >= nOf(idbD),
    'B2 自愈之后写入照旧生效（库里内容跟着变、条数没写小：' + nOf(idbD) + '→' + nOf(idbE) + '＝残缺闸不是永久禁写）',
    { before: nOf(idbD), after: nOf(idbE), same: idbE === idbD });
  await page.close(); await ctx.close();
}

// ---------- 没有快照的一族：残缺期不许当面说「还没有动态」 ----------
{
  const { ctx, page } = await session({ idb: BIG12, snap: '[]' });
  await openFeed(page); await page.waitForTimeout(1800);
  const a = await read(page);
  await page.evaluate(() => window.__bg(true)); await page.waitForTimeout(700);
  await page.evaluate(() => window.__bg(false)); await page.waitForTimeout(700);
  await openFeed(page); await page.waitForTimeout(3500);
  const b = await read(page);
  ok(a.dom >= 12 && b.dom >= 12 && !b.emptyClaim,
    'D4 库里 12 条时，回前台再进页不许出现「还没有动态」空态（屏上=' + b.dom + ' 空态=' + b.emptyClaim + '；缺陷侧屏上 0 条且当面宣告空态）', { before: a.dom, after: b.dom, emptyClaim: b.emptyClaim });
  await page.close(); await ctx.close();
}

// ---------- 健康对照：小键（LS 有副本）整场链路一字不许变 ----------
{
  const { ctx, page } = await session({ idb: SMALL6, snap: SNAP3, lsMain: SMALL6 });
  await openFeed(page); await page.waitForTimeout(1800);
  const a = await read(page);
  await page.evaluate(() => window.__bg(true)); await page.waitForTimeout(700);
  await page.evaluate(() => window.__bg(false)); await page.waitForTimeout(700);
  await openFeed(page); await page.waitForTimeout(2500);
  await likeOnce(page); await page.waitForTimeout(4200);
  const b = await read(page); const idbB = nOf(await rawIdb(page, K_MAIN));
  ok(a.lsMain === '有' && b.lsMain === '有' && b.dom >= 6 && idbB >= 6,
    'B3 健康小键链路照旧：LS 那份一直在、切后台回前台＋点赞后屏上与库里都没少（LS=' + b.lsMain + ' 屏上=' + b.dom + ' 库里=' + idbB + '）', { lsMain: b.lsMain, dom: b.dom, idbB });
  await page.close(); await ctx.close();
}

// ---------- 重建期：库里确认没有 ⇒ 照常写（#187「确认不存在＝放心写」不许被本批闸挡死） ----------
{
  const { ctx, page } = await session({ idb: null, snap: '[]' });
  await openFeed(page); await page.waitForTimeout(1800);
  const newId = await page.evaluate(() => window.feedAddPost('全新装第一条 ZZ1336R', []));
  await page.waitForTimeout(4500);
  const idbB = await rawIdb(page, K_MAIN);
  ok(typeof newId === 'string' && String(idbB).indexOf(newId) >= 0,
    'B1 库里确实没有时（全新安装/丢库重建）照常落盘，新闸不拦这条路（id=' + newId + '；缺陷侧与修复侧都该绿）', { newId, idbB: String(idbB).slice(0, 80) });
  await page.close(); await ctx.close();
}

// ---------- 报障环境本尊：LS 整域填满（大值写入必抛、小值照旧写得进），剥图快照那一发也落不进去 ----------
{
  const { ctx, page } = await session({ idb: BIG12, snap: SNAP3, fullLs: true });
  const env = await page.evaluate(() => ({ fill: window.__fill, big: window.__probeBig, tiny: window.__probeTiny }));
  ok(env.fill > 0 && String(env.big).indexOf('THROW') === 0 && env.tiny === 'ok',
    'F3 夹具诚实：LS 整域真被填满到「小值写得进、200KB（快照那一级）那一发抛 QuotaExceededError」（fill=' + env.fill + ' 大值=' + env.big + ' 小值=' + env.tiny + '＝那张诊断单同型）', env);
  await openFeed(page); await page.waitForTimeout(1800);
  const idbA = nOf(await rawIdb(page, K_MAIN));
  await page.evaluate(() => window.__bg(true)); await page.waitForTimeout(700);
  await page.evaluate(() => window.__bg(false)); await page.waitForTimeout(700);
  await openFeed(page); await page.waitForTimeout(3200);
  const b = await read(page);
  await likeOnce(page); await page.waitForTimeout(4200);
  const idbB = nOf(await rawIdb(page, K_MAIN));
  const c = await read(page);
  ok(c.dom >= idbB && idbB >= idbA,
    'D8 报障环境（LS 满）下：切后台回前台再进页＋一次普通点赞之后，屏上与库里都没少（屏上=' + c.dom + ' 库里 ' + idbA + '→' + idbB + '；缺陷侧正是「联系人发的朋友圈没过一会儿就不见了」）',
    { dom: c.dom, idbA, idbB, store: b.store });
  ok(!c.emptyClaim, 'D8b 同一环境下当面不许宣告「还没有动态」（空态=' + c.emptyClaim + '）', c);
  await page.close(); await ctx.close();
}

console.log('\n结果：通过 ' + pass + ' · 失败 ' + fail + ' · 未捕获异常 ' + errs.length);
errs.slice(0, 8).forEach(e => console.log('  ! ' + e));
await browser.close();
server.close();
process.exit(fail > 0 || errs.length > 0 ? 1 : 0);

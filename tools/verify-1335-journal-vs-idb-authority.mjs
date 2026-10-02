// ===== 常驻回归脚本 #1335：冻结的小键写日志把旧快照灌回内存，压住库里更新的值（红米 Note12Turbo/Chrome 实报）
// 用法：node tools/verify-1335-journal-vs-idb-authority.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-27 直派：「版本更新后进去，收藏功能里面的所有内容被全部清空，每次都被清空，没有保存我的
// 数据」；设备 23049RAD8C 红米 Note12Turbo／Android 15／Chromium 150；用户明说其他机型也有出现、不要覆盖式修补）：
//   同一台机、同一个构建（ts=1790428258197＝tip 75a35ba）相差 11 小时的两张诊断单：
//   · 09-26 16:04 localStorage 整域 1286 键 ≈4.0MB，fav-msgs 312.6KB（LS＋IDB 双份都在）
//   · 09-27 03:14 整域 1295 键 ≈10.0MB（【非本项目】64 键 ≈3.5MB＝GitHub Pages 同账号兄弟站点与本站共用一份
//     origin 配额），站内大值写入本会话被拒 212 次、单发 118.4KB、现场账【逐条全部】出自 wrjPersistFlush，
//     而 1 字节探针照旧「正常」＝LS 半死：小值写得进、大值写不进
//     ⇒ fav-msgs 掉到 1.2KB，LS 与 IDB 两份一起掉。两份一起掉＝不是「读不到」，是「被写坏的」。
//
// 机制（纯底本实测；判据零机型／零 UA，只取「这一枚 setItem 抛没抛」一个内核事实）：
//   ① `__wr-journal` 只有 localStorage 一份副本，落盘＝整包 setItem。配额满时这一发必抛，而旧写法
//      `catch (e) {}` 吞得一个字不剩 ⇒ 屏上那本日志【永久冻结】在最后一次成功提交的形态上（212 次＝212 次白记）。
//   ② 启动时 wrjReplay 同步回放（排在回填之前是 #339/#226 刻意定的时序，业务模块紧接着就同步读值，不能动）；
//      那一刻 `_wrjTimes` 还是空的 ⇒ 守卫恒不成立 ⇒ 每一条旧值都被无条件当成权威塞进 memoryCache，
//      连库里那份是不是比它新都没问过。
//   ③ idbRestore.retainValue 第一行 `if (k in memoryCache) return false` 本意是「本会话写过的值不许被回填遮蔽」，
//      此刻把【回放的旧值】认成了本会话的新写入 ⇒ 库里那条更新的大值整场会话没人应用；
//      回放顺手写回 LS 的那一发只有几十字符，在「大值写不进」的机器上【照样写得进去】⇒ 旧快照把 LS 那份新鲜值
//      整份换掉，而 retainValue 的下一条规则恰是「LS 有值且没标脏＝LS 最新」⇒ 从此【每一场】都赢＝「每次」。
//   ④ 消费方拿这份旧快照做一次最正常的读-改-写 ⇒ 库里整包被抹。
//   ⑤ 两条自愈链路对本族键结构性失明：值涨过 64KB 记录上限时 wrjRecord 走 wrjForget＝删条目＋wrjUnmark 把
//      IDB 那个时间戳标记【删除】，而 wrjMergeFromIdb 只按「标记比已知新」认权威、且自己写着「值超过
//      WRJ_VAL_LIMIT 就跳过」——两条路都再也看不见这一键。
//
// ⚠ 为什么这一批不收在某个页面里：#1309/#1330 已经把【信箱】【收藏】两个消费方各自上了闸，本批在同一把尺子下
//   实测现 tip 上仍然：fav-msgs 20/20（收藏侧＝#1330 已覆盖）、mail-letters 21/21（信箱侧＝#1309 已覆盖）、
//   feed-posts 屏上 2 条 vs 库里 18 条、cc-groups 屏上 2 条 vs 库里 17 条【照旧被遮蔽】。
//   同一条数据层通路一次喂坏四个页面，逐页补闸＝用户说的「覆盖式修补」；本批在通路上收口，尺子也按通路量。
//
// 收口判据（两条都是当场可观测的事实）：
//   A. 一本连自己落盘都落不进去的账本，不能继续充当「最近一次写入」——回放前先拿同等体积换一个键名试写
//      （原样写回同一枚键在 Chrome 里是 0 字节增量的无操作、配额满也不抛，实测会把探针判成假阴性）。
//   B. 日志只能见证「≤WRJ_VAL_LIMIT 的那一次写入」；未获背书的回放条目让位给库里权威值，并标进既有的
//      「LS 这一份不可信」集合（lsDirtyAdd＝站内那把现成尺子，双份持久化），不另起第二套口径。
//
// 断言：
//   F 组 夹具诚实：F0 库里真灌了那条 >64KB 的新值／F1 大值写入真被拒(QuotaExceededError) 而小值写得进
//     （＝那张单「写入拒绝 212 次」＋「LS 写探针：正常」同型；红＝S 组读数无意义）／F2 开站前站内真留着
//     那一发旧快照与一本按体积落不回去的日志／F3 回填真的开始过
//   S 组 本批新契约（量在【数据层通路】上，不绑任何页面）：S1 四条键开站后 store.get 读到的都必须是库里那份
//     （红＝冻结日志的旧快照压住了权威值）／S2 拿这份读数做一次再正常不过的读-改-写，库里一条不许少／
//     S3 整页重开后库里仍足额（⑤「每次」那一条）／S4 冻结被当场认出：日志落盘被拒过 ⇒ 回放条目全部标成未获背书
//   B 组 旧契约一字不许动（写日志存在的全部理由）：B1 库里那次写失败（值事务没回执）时，日志里更新的小值
//     必须照旧赢——不许把回放一刀切让位（#226/#339）／B1b 回放只救 内存+LS，绝不回写库里（#339 那根针）／
//     B2 收藏侧 #1330 与信箱侧 #1309 的收口不许被本批改红（同一条通路上的两位邻居）
//   C 组 健康对照：C1 LS 里没有陈旧日志时读数照旧／C2 普通小键读写链路没被带坏／C3 LS 写得进的机器上
//     探针不许报冻结（一律 stranded＝把 #226/#339 那族判死）
//   Z1 全程零未捕获 JS 异常
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
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 320) + ']' : '')); } };

const NS = 'xy-home-v2:default';
const K_WRJ = 'xy-home-v2:__wr-journal';
// 尺子量在【数据层通路】上，所以用三把专用夹具键：业务键（收藏／信箱／朋友圈／字卡库）各自有页面级写入方
// 会在这一场里自己改条数（实测纯底本 mail 读到 5 而日志那份是 4＝页面自己并进来的），拿业务键当尺子的绝对
// 条数判据必假。通路本身与键名无关（wrjReplay／retainValue 对所有键同一条码），夹具键只是把噪声摘掉。
// 另：fav-msgs 仍然进夹具（它是报障本体＋#1330 那位邻居的领地），但只按「不低于库里那份」这类相对判据问。
const REL = ['zz1335-alpha', 'zz1335-beta', 'zz1335-gamma'];
const K_FAV = 'fav-msgs';
const T_OLD = 1700000000000;   // 冻结日志那一发的「写入时间」（远早于现在）
const T_NEW = 1700000600000;   // B 组里比日志更旧的那一发库里值用不上，这里给 B1 当新写入的时间
const mk = (n, pad, tag) => JSON.stringify(Array.from({ length: n }, (_, i) => ({
  id: tag + i, by: i % 3 === 0 ? 'ta' : 'me', kind: 'msg', side: i % 2 ? 'out' : 'in', type: 'text',
  ts: T_OLD + 80000000 + i, text: tag + ' 第' + i + '条 ' + 'x'.repeat(pad),
})));
const SEED = {}; REL.forEach((k, i) => { SEED[k] = mk(20 - i * 2, 4200, 'n' + i); });     // 库里＝新，16~20 条、整值 >64KB
SEED[K_FAV] = mk(20, 4200, 'fav');                                                        // 报障本体那一条键也照灌
const STALE = {}; REL.forEach((k) => { STALE[k] = mk(2, 4, 'o' + k.slice(-1)); });        // 日志＋LS＝两小时前的 2 条小快照
STALE[K_FAV] = mk(2, 4, 'fo');
const FROZEN = JSON.stringify(REL.concat([K_FAV]).map((k, i) => ({ k: NS + ':' + k, v: STALE[k], t: T_OLD + i }))
  // 垫一条接近 WRJ_BUDGET(64K 字符) 上限的条目：日志整值必须大过腾出来的那 ~1.2KB 余量，
  // 否则应用自己一回写就成功，冻结根本没造出来（F2 当场判红的那一版垫了 20K，被裁到 21362 字符）
  .concat([{ k: NS + ':zz1335pad', v: JSON.stringify({ p: 'y'.repeat(58000) }), t: T_OLD }]));

const nOf = (raw) => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.length : -2; } catch (e) { return raw == null ? -9 : -3; } };
const short = (arr) => arr.map((k) => k + '=' + nOf(SEED[k]) + '条').join(' ');

const browser = await chromium.launch({ headless: true });
const errs = [];
async function enter(page) {
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const s = document.querySelector('.splash'); if (s) s.remove();
    document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await page.waitForTimeout(400);
}
async function waitReady(page) {
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(7000);
}
const rawIdb = (page, key) => page.evaluate((k) => new Promise((res) => {
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
const memAll = (page) => page.evaluate((rels) => {
  const o = {};
  rels.forEach(function (r) { try { const v = window.xyStore('xy-home-v2:default').get(r); o[r] = typeof v === 'string' ? v : 'NULL'; } catch (e) { o[r] = 'ERR:' + e; } });
  return o;
}, REL.concat(['fav-msgs']));
const lsGet = (page, k) => page.evaluate((key) => { try { return localStorage.getItem(key); } catch (e) { return 'ERR'; } }, k);

// ---------- 主场景：库里=新，LS+冻结日志=旧小快照 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const p1 = await ctx.newPage();
  p1.on('pageerror', (e) => errs.push('S-L1 ' + String(e.message).slice(0, 110)));
  await p1.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p1);
  await p1.waitForTimeout(3500);
  // 只灌库（直接 idbSet，不经 xyStore.set ⇒ 不留日志条目、不留时间戳标记，正是真机那条「涨过上限被 wrjForget 撤标」的形态）
  const SEEDFULL = Object.fromEntries(REL.concat([K_FAV]).map((k) => [NS + ':' + k, SEED[k]]));
  await p1.evaluate((m) => Promise.all(Object.keys(m).map((k) => window.idbSet(k, m[k]))), SEEDFULL);
  await new Promise((r) => setTimeout(r, 1500));
  const pre = {};
  for (const k of REL) pre[k] = await rawIdb(p1, NS + ':' + k);
  ok(REL.every((k) => nOf(pre[k]) === nOf(SEED[k]) && SEED[k].length > 64 * 1024),
    'F0 夹具真把三把 >64KB 的新值灌进了库里（' + REL.map((k) => k + '=' + nOf(SEED[k]) + '条').join(' ') + '）', REL.map((k) => k + '=' + nOf(pre[k])).join(' '));
  await p1.close();

  await ctx.addInitScript({
    content: `(function(){
    var WRJ=${JSON.stringify(K_WRJ)}, NS=${JSON.stringify(NS)}, STALE=${JSON.stringify(STALE)}, FROZEN=${JSON.stringify(FROZEN)};
    window.__f1335 = { filled: 0, lsN: 0, bigWrite: 'ok?!', tinyWrite: 'ok', seedHasFav: false, seedWrjLen: 0 };
    var oSet = function (k, v) { return localStorage.setItem(k, v); };
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('xy-home-v2') === 0) localStorage.removeItem(k); });
      Object.keys(STALE).forEach(function (k) { localStorage.setItem(NS + ':' + k, STALE[k]); });
      localStorage.setItem(WRJ, FROZEN);
      window.__f1335.seedHasFav = (localStorage.getItem(WRJ) || '').indexOf(NS + ':fav-msgs') >= 0;
      window.__f1335.seedWrjLen = (localStorage.getItem(WRJ) || '').length;
      for (var i = 0; i < 2000; i++) {
        try { oSet('ml2_f1335_' + i, 'y'.repeat(64 * 1024)); window.__f1335.filled++; } catch (e) { break; }
      }
      // 只腾出 ~1.2KB：几十字符的小值照旧写得进（＝那张单「LS 写探针：正常」），而那本日志整包（几万字符合
      // 128KB 起）照旧写不进（＝那张单「写入拒绝 212 次、单发 118.4KB」）。留出整条 64K 的话应用会把它自己
      // 那本压到预算内的账成功写回去，冻结根本没造出来。
      try { oSet('ml2_f1335_' + (window.__f1335.filled - 1), 'y'.repeat(64 * 1024 - 600)); } catch (e) {}
      try { oSet('__p1335', 'x'.repeat(150 * 1024)); } catch (e) { window.__f1335.bigWrite = e && e.name; }
      try { localStorage.setItem('__p1335b', '1'); localStorage.removeItem('__p1335b'); } catch (e) { window.__f1335.tinyWrite = e && e.name; }
      window.__f1335.lsN = localStorage.length;
    } catch (e) { window.__f1335.err = String(e).slice(0, 140); }
  })();`,
  });
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errs.push('S-L2 ' + String(e.message).slice(0, 110)));
  await p2.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p2);
  const fx = await p2.evaluate(() => window.__f1335);
  ok(fx.bigWrite === 'QuotaExceededError' && fx.tinyWrite === 'ok',
    'F1 夹具诚实：大值写入被拒(QuotaExceededError) 而小值写得进（＝那张单同型；红＝S 组读数无意义）', JSON.stringify(fx));
  const lsFav = await lsGet(p2, NS + ':fav-msgs');
  ok(nOf(lsFav) === 2 && fx.seedHasFav === true && fx.seedWrjLen > 50000,
    'F2 开站前站内真留着那一发旧快照＋一本按体积落不回去的日志（日志整值 ' + (fx.seedWrjLen || 0) + ' 字符 >50K）',
    'lsFav=' + nOf(lsFav) + ' seed=' + JSON.stringify({ hasFav: fx.seedHasFav, len: fx.seedWrjLen }));
  await waitReady(p2);
  ok(await p2.evaluate(() => !!window.__mochiLoadT), 'F3 回填真的开始过（整页没起来时一切读数无意义）');

  const mem = await memAll(p2);
  const dbNow = {};
  for (const k of REL) dbNow[k] = await rawIdb(p2, NS + ':' + k);
  const bad = REL.filter((k) => nOf(mem[k]) !== nOf(SEED[k]));
  ok(bad.length === 0,
    'S1【症状本体】四条键开站后 store.get 读到的都必须是库里那份，不是冻结日志里的 2 条',
    REL.map((k) => k + '(读' + nOf(mem[k]) + '/库' + nOf(dbNow[k]) + ')').join(' '));

  // 读-改-写：消费方拿到读数以后最正常的一次追加（不绑页面按钮＝量在通路上）
  await p2.evaluate((rels) => {
    rels.forEach(function (r) {
      try {
        const cur = JSON.parse(window.xyStore('xy-home-v2:default').get(r) || '[]');
        cur.push({ id: 'user1335-' + r, ts: Date.now(), text: '用户这一次正常追加' });
        window.xyStore('xy-home-v2:default').set(r, JSON.stringify(cur));
      } catch (e) {}
    });
  }, REL);
  await p2.waitForTimeout(3000);
  const after = {};
  for (const k of REL) after[k] = await rawIdb(p2, NS + ':' + k);
  const hurt = REL.filter((k) => nOf(after[k]) < nOf(SEED[k]));
  ok(hurt.length === 0,
    'S2 拿这份读数做一次再正常不过的读-改-写，库里一条不许少（红＝旧快照被整包写回库里＝永久丢失）',
    hurt.map((k) => k + ' ' + nOf(SEED[k]) + '→' + nOf(after[k]) + '条').join(' ') || REL.map((k) => k + '=' + nOf(after[k])).join(' '));

  const wd = await p2.evaluate(() => (window.__wrjDiag ? window.__wrjDiag() : null));
  ok(!!wd && wd.stranded === true && wd.replayed >= 1,
    'S4 冻结的账本被当场认出：日志落盘被拒过 ⇒ 回放条目全部标成「未获背书」', JSON.stringify(wd));
  await p2.close();

  const p3 = await ctx.newPage();
  p3.on('pageerror', (e) => errs.push('S-L3 ' + String(e.message).slice(0, 110)));
  await p3.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p3);
  await waitReady(p3);
  const re = {};
  for (const k of REL) re[k] = await rawIdb(p3, NS + ':' + k);
  const lost = REL.filter((k) => nOf(re[k]) < nOf(SEED[k]));
  ok(lost.length === 0,
    'S3 整页重开后库里四条键仍足额（⑤「每次都被清空」这一条的尺子）',
    lost.map((k) => k + '=' + nOf(re[k]) + '条').join(' ') || REL.map((k) => k + '=' + nOf(re[k])).join(' '));
  // 同一条通路上的两位邻居：#1330（收藏侧）与 #1309（信箱侧）的收口不许被本批改红（读数取在关掉这一页之前）
  const mem2 = await memAll(p3);
  ok(nOf(mem2[K_FAV]) >= nOf(SEED[K_FAV]),
    'B2 邻居侧收口照旧成立：收藏那一把键(#1330 的领地)在重开那一场里读到的不低于库里那份', K_FAV + '=' + nOf(mem2[K_FAV]) + '/库=' + nOf(SEED[K_FAV]));
  await p3.close();
  await ctx.close();
}

// ---------- B1 组（旧契约）：库里那次写失败 ⇒ 日志里更新的小值必须照旧赢（#226/#339 存在的全部理由） ----------
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const p1 = await ctx.newPage();
  p1.on('pageerror', (e) => errs.push('B-L1 ' + String(e.message).slice(0, 110)));
  await p1.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p1);
  await p1.waitForTimeout(3500);
  await p1.evaluate((m) => Promise.all(Object.keys(m).map((k) => window.idbSet(k, m[k]))), Object.fromEntries(REL.concat([K_FAV]).map((k) => [NS + ':' + k, mk(1, 4, 'old' + k.slice(-1))])));
  await new Promise((r) => setTimeout(r, 1200));
  await p1.close();
  const NEWER = {}; REL.forEach((k, i) => { NEWER[k] = mk(3 + i, 4, 'x' + i); });       // 日志里＝更新的 3~5 条小值（远不到 64KB 上限＝日志有资格见证这一发）
  await ctx.addInitScript({
    content: `(function(){
    var WRJ=${JSON.stringify(K_WRJ)}, NS=${JSON.stringify(NS)}, NEWER=${JSON.stringify(NEWER)};
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('xy-home-v2') === 0) localStorage.removeItem(k); });
      Object.keys(NEWER).forEach(function (k) { localStorage.setItem(NS + ':' + k, NEWER[k]); });
      localStorage.setItem(WRJ, JSON.stringify(Object.keys(NEWER).map(function (k, i) { return { k: NS + ':' + k, v: NEWER[k], t: ${T_NEW} + i }; })));
    } catch (e) {}
  })();`,
  });
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errs.push('B-L2 ' + String(e.message).slice(0, 110)));
  await p2.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p2);
  await waitReady(p2);
  const bm = await memAll(p2);
  const wrong = REL.filter((k) => nOf(bm[k]) !== nOf(NEWER[k])); // 只判夹具键：fav 那侧有 #1330 自己的并集逻辑
  ok(wrong.length === 0, 'B1 库里那次写失败时，日志里更新的小值必须照旧赢（一刀切让位＝#226/#339 回归）',
    wrong.map((k) => k + ' 读' + nOf(bm[k]) + '/应' + nOf(NEWER[k])).join(' '));
  const bid = {};
  for (const k of REL) bid[k] = await rawIdb(p2, NS + ':' + k);
  ok(REL.every((k) => nOf(bid[k]) === 1), 'B1b 回放只救 内存+LS，绝不回写库里（#339 那根 WRJ_REPLAY_NO_IDB 针还在）',
    REL.map((k) => k + '=' + nOf(bid[k])).join(' '));
  await p2.close();
  await ctx.close();
}

// ---------- C 组（健康对照）：LS 写得进、站内没有陈旧日志 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const p1 = await ctx.newPage();
  p1.on('pageerror', (e) => errs.push('C-L1 ' + String(e.message).slice(0, 110)));
  await p1.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p1);
  await p1.waitForTimeout(3500);
  await p1.evaluate((m) => Promise.all(Object.keys(m).map((k) => window.idbSet(k, m[k]))
    .concat([window.idbSet('xy-home-v2:default:zz1335-probe', JSON.stringify({ v: 1335 }))])),
  Object.fromEntries(REL.concat([K_FAV]).map((k) => ['xy-home-v2:default:' + k, SEED[k]])));
  await new Promise((r) => setTimeout(r, 1500));
  await p1.close();
  await ctx.addInitScript({
    content: `(function(){ try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('xy-home-v2') === 0) localStorage.removeItem(k); }); } catch (e) {} })();`,
  });
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errs.push('C-L2 ' + String(e.message).slice(0, 110)));
  await p2.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p2);
  await waitReady(p2);
  const cm = await memAll(p2);
  const cbad = REL.filter((k) => nOf(cm[k]) !== nOf(SEED[k]));
  ok(cbad.length === 0, 'C1 健康对照：LS 里没有陈旧日志时，库里四条键照旧读得到（修复没把正常路径堵死）',
    cbad.map((k) => k + '=' + nOf(cm[k])).join(' '));
  const probe = await rawIdb(p2, NS + ':zz1335-probe');
  ok(probe && String(probe).indexOf('1335') >= 0, 'C2 健康对照：普通小键的读写链路没被改动带坏');
  const cw = await p2.evaluate(() => (window.__wrjDiag ? window.__wrjDiag() : null));
  ok(!!cw && cw.stranded === false, 'C3 健康对照：LS 写得进的机器上探针不许报冻结（一律 stranded＝把 #226/#339 那族判死）', JSON.stringify(cw));
  await p2.close();
  await ctx.close();
}

ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', errs.slice(0, 4).join(' | '));
console.log('\n结果：绿 ' + pass + ' / 红 ' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);

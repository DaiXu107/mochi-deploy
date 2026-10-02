// ===== 常驻回归脚本 #1442：信箱的整包写回闸——判据必须是「这一桌面的主键交不交得出权威读数」，
//        而不是「这一发传没传 cid」
// 用法：node tools/verify-1442-mail-background-writeback-gate.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-29 直派：小米 14 Ultra(24031PN0DC)／Android 14／Edge 153 桌面 PWA
//   「信箱里的信都没有了，几个小时就没有了，莫名其妙丢失信箱的数据」；明说「不要覆盖修改导致不同型号
//   设备浏览器的 bug 反复出现」「这个问题其他设备型号也有出现」。诊断 mochi-diag-2026-09-29-06-55-…：
//   【数据】段逐字写着「localStorage 整域=192 键 ≈10.0 MB（非本项目 191 键 ≈10.0 MB）」
//   「localStorage 写入被拒 3531 次(QuotaExceededError)」「写日志：本会话有 210 次落不回去＝这本账已冻结」
//   「大键读回：切后台放过 10 格 · 此刻读不到值未确认 9 格」＝同账号兄弟站点把整域 LS 吃满，信箱那层
//   「LS 剥图快照」兜底从此恒为 0 字节；而 #1195e 每次切后台照旧按体积放掉大键内存副本。）
//
// 机制（纯 HEAD 产物无头实测；判据零机型／零 UA，只取「这一格现在读不读得到」）：
//   save() 里那两道写闸（#1309b 的 mailWriteOpen／#1358f 的 mailSyncCold）写的都是 `!cid`，而信箱三条
//   后台通路全是 `load(cid) → 改 → save(list, cid)`——显式 cid 一律绕过：
//     · maybeIncomingLetterFor（TA 主动来信）· checkPendingReplyFor（到期回信落地）
//     · fishWeekReportFor（每周摸鱼小结；它还在读之前就烧掉周标记）
//   只要那一格「读空」（两种窗口都算：①启动回填还在排队、②切后台被按体积放掉），load(cid) 交出 []
//   → unshift 一封 → 整包 set ⇒ 库里那一本没了。实测红侧：20 封 → 一班里只剩 1~2 封自动生成的信。
//   并且这台机上 #1361a 那格证人（__big-idx 躺在 localStorage）跟着 LS 一起失效 ⇒ 数据层只剩
//   「本会话被放掉过」名册与回填排队态两把当场证据，**调用方必须自己问一句**；mail.js 没问，闸永不关。
//
// 收口（mail.js 六处，全部借数据层现成那句 #1342d／#1361b xyBigWriteHold，零机型／零 UA 分支）：
//   a mailBlindRead(cid)＝window.xyBigWriteHold(csFor(cid), KEY)（拦下＋顺手请一次库）
//   b save() 的闸改成问「这一桌面交不交得出权威读数」，与传没传 cid 无关；当前桌面那一发仍并入本模块
//     现成的 mailPending 暂存（用户刚写的信不许凭空蒸发），后台三条已在生成前让路，这里兜底
//   c/d/e 三条通路在**生成之前**让路：不烧 last/next/当日上限、不发「寄来了一封信」的通知、
//     不把回信计划吃掉、不烧掉周标记——库里那份读回来的下一班照常落地
//   f 快照那一层（loadSnap/writeSnap）从裸 localStorage 改走同一句柄的 xyStore：键名与 200KB 上限逐字
//     不变，LS 写得进的机器一个字节没少，写不进的机器多一条能活过页面回收的腿（清空时三处一起销账）
//
// 量具自律（三条自己踩过的坑，写在这里免得下一位再踩）：
//   · 测「读空」不许先 get()——xyStore.get 命中空格会当场踢一趟按需取回（#1349a），量具自己把被测量踢回来
//     ⇒ 开枪前的读数只走 blindState()（awaitingBigKey／__xyBigReadDiag，两条都不碰内存格）。
//   · eagerCheck 自带 5s 节流：回前台那一枪可能被吞 ⇒ 来信通路用「切后台→立刻打 focus」这一条时序；
//     回信／周小结两条改走**不限流的公开入口**（openMailPage 内部直调 checkPendingReply、
//     window.fishWeekTick 是 v3.13.x 就给验证脚本留的口）。
//   · 破坏发生后库里可能被迟到的一读「 heal 回去」（夹具里 IDB 读排在写之前，真机不会）⇒ 数量按
//     **整场最低读数**判，不判最后一眼。
//
// 断言（两侧同一把尺串行跑；纯 HEAD 侧应当红的＝甲1/甲2/甲3/乙1/丙3/丙5/丁1/丁2 与 S 组）：
//   甲 启动回填排队窗（公开入口开枪）：甲1 当前桌面 20 封不许顶成小结那一封／甲2 非当前桌面 14 封同一条／
//     甲3 让路那一班不许烧掉还没寄的那一周的周标记／甲4 库里确无这一键的新桌面（cnew3）照旧直接落盘
//   乙 切后台放掉 × 回前台补查来信：E0 健康对照／E1 读空这一发成立（不踢库的读数）／E2 #1195e 照旧按
//     体积放掉（不许拿「不再释放」来修）／E3 数据层那句尺说不许／乙1 来信那一发不许顶掉库里那本／
//     乙2 被放掉那一格当场问库、下一读自愈／乙3 让路之后这封信仍会落地（21 封且旧 id 全在）／
//     乙4 屏上信箱重开看得见那 20 封
//   丙 到期回信与周小结：丙1 健康读数下回信照旧落库／丙2 健康读数下周小结照旧寄出并打上周标记／
//     丙3【症状本体】读空那一发不许吃掉回信计划／丙4 读空那一发不许重放已寄出的那周／
//     丙5【症状本体】读空那一发不许烧掉还没寄的那一周的标记／丙6 读空那一发库里只许多不许少
//   丁 快照那一层在 LS 死透的机器上到底存不存在：丁0 开枪落在读空那一格／丁1【症状本体】快照键真在库里
//     （原实现只躺 LS，这台机整域写不进＝兜底恒 0 字节）／丁2 重开后 20 封旧信一封不少（控制项）／
//     丁3【症状本体】把主键删掉再重开，屏上仍是那些信而不是「还没有收到信」；丁3a 那一删走应用自己那句
//       remove——绕过数据层直接动 IndexedDB 会留下「这一格还等库回话」的假残缺，把 #1469 的「读不全⇒
//       删除/清空按住」永久挡在丁4~丁6 前面，丁6 就量不到它自己要量的东西（实测两侧红绿搬家一次）／
//     丁4 用户亲手清空照旧落库（真要按住也必须给那句提示，不许点了什么都不发生）／丁5 清空后快照要么销账
//       要么不可能再被读到／丁6【用户看得见的那一本】清空后 9 秒库里与屏上同为空态（迟到的读回不许复活）
//     注：读空那一班里用户亲手寄出的那**一封**，从 #1469 起另有一条能活过页面回收的腿（信箱旁路账），
//       那一型由 tools/verify-1469-mail-hold-and-blocked-delete.mjs 的 A 组量；#1442 本批只修「整本被顶掉」。
//   F 组 夹具诚实（双侧同绿控制项）：两本真在库、跨过 256KB、LS 这一场真写不进、回填照旧成功
//   S 组 产物逻辑锚；Z 全程零未捕获 JS 异常
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
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 300) + ']' : '')); } };

const K1 = 'xy-home-v2:default:mail-letters';
const K2 = 'xy-home-v2:cprobe1:mail-letters';
const K3 = 'xy-home-v2:cnew3:mail-letters';
const KPEND = 'xy-home-v2:default:mail-reply-pending';
const SNAP1 = 'xy-home-v2:default:mail-letters-snap';
// 每封正文 ~20KB ⇒ 20 封 ≈400KB、14 封 ≈280KB：两本都跨过 LS_BIG_LIMIT(200KB，xyStore.set 的大键分支
// ＝LS 不留副本) 与 MEMO_BG_DROP_BYTES(256KB，#1195e 切后台按体积放掉内存副本)。两个门槛都够得着，
// 「读空」这一发才是报障机上那一发，不是夹具编出来的（12 封＝240KB 够不着释放闸＝假绿，踩过）。
const mkLetters = (n, tag) => JSON.stringify(Array.from({ length: n }, (_, i) => ({
  id: tag + '_' + i, type: 'received', tt: '旧信' + i, read: true,
  content: '正文' + i + '|'.padEnd(20000, 'x'), tm: 1700000000000 + i * 1000
})));

// 故障注入：删掉站内自己的 LS 键 → 用【非本项目键名】把整域填到连 1KB 都写不进
// ＝复现诊断单那一台（整域 192 键 ≈10MB、非本项目 191 键；前缀沿用报障件里的 ml2_lf_）
function fault(o) {
  const content = `(function(){
  window.__f1442 = { lsProbe: 'ok', filled: 0 };
  ${o.lsDead ? `try {
    var del = function () { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('xy-home-v2') === 0) { try { localStorage.removeItem(k); } catch (e) {} } }); };
    del();
    var fill = function (size, tag) { for (var i = 0; i < 3000; i++) { try { localStorage.setItem('ml2_lf_' + tag + '_' + i, 'x'.repeat(size)); window.__f1442.filled++; } catch (e) { return; } } };
    fill(1024 * 1024, 'a'); fill(200 * 1024, 'b'); fill(16 * 1024, 'c'); fill(1024, 'd'); fill(64, 'e'); fill(8, 'f');
    del();
    try { localStorage.setItem('__probe1442', 'x'.repeat(1024)); } catch (e) { window.__f1442.lsProbe = (e && e.name) || 'throw'; }
    try { localStorage.removeItem('__probe1442'); } catch (e) {}
  } catch (e) { window.__f1442.lsProbe = 'fill-failed:' + e; }` : ''}
})();`;
  return { content };
}

const browser = await chromium.launch({ headless: true });
let page, ctx;
async function newCtx(withFault) {
  ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.__errs = [];
  page.on('pageerror', (e) => page.__errs.push(String(e.message).slice(0, 160)));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter();
  if (withFault) await page.addInitScript(fault({ lsDead: true }));
  return page;
}
const enter = async () => {
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const s = document.querySelector('.splash'); if (s) s.remove();
    document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await page.waitForTimeout(400);
};
const rawGet = (k) => page.evaluate((key) => new Promise((res) => {
  const rq = indexedDB.open('mochi-db', 1);
  rq.onsuccess = () => {
    const tx = rq.result.transaction('kv', 'readonly'), g = tx.objectStore('kv').get(key);
    g.onsuccess = () => { try { rq.result.close(); } catch (e) {} res(g.result === undefined ? null : String(g.result)); };
    g.onerror = () => { try { rq.result.close(); } catch (e) {} res('ERR'); };
  };
  rq.onerror = () => res('ERR');
}), k);
const idsOf = (raw) => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map((x) => x && x.id) : ['(非数组)']; } catch (e) { return ['(坏值:' + String(raw).slice(0, 24) + ')']; } };
const nOf = (raw) => (raw === null ? 0 : raw === 'ERR' ? -9 : idsOf(raw).length);
const keep = (arr, pre, n) => arr.filter((x) => String(x).indexOf(pre + '_') === 0).length >= n;
// 整场最低读数：破坏之后库里也许被迟到的一读 heal 回去（夹具里 IDB 读排在写之前；真机不会），
// 所以数量判「最低」，id 判「最大那一发」。
async function libSeries(k, times, gap) {
  const arr = [];
  for (let i = 0; i < (times || 5); i++) { arr.push(await rawGet(k)); await page.waitForTimeout(gap || 400); }
  let min = 9e9, best = '[]';
  arr.forEach((r) => { const n = nOf(r); if (n >= 0 && n < min) min = n; if (n > nOf(best)) best = r; });
  return { min: min === 9e9 ? -9 : min, ids: idsOf(best), last: nOf(arr[arr.length - 1]) };
}
// 自然写入＝走 xyStore.set（大键分支剥 LS、__big-idx 记证人、内存副本在场＝够得着释放闸）。
// 顺带灌几根「排在被测键前面」的填充键（IDB 键序 xy-home-v2:aafill-* 确在 c*/default 之前）＝启动回填
// 那条流式队列轮到信箱这一键要几秒；报障件写着 chat-msgs 81MB，排队才是常态。
async function seedAll(opts) {
  await page.evaluate((o) => {
    window.xyStore('xy-home-v2').set('contacts', o.contacts);
    window.xyStore('xy-home-v2').set('active-contact', 'default');
    for (let i = 0; i < 10; i++) window.xyStore('xy-home-v2').set('aafill-' + i, 'F' + i + '|'.padEnd(2 * 1024 * 1024, 'y'));
    if (o.mail) o.mail.forEach((m) => window.xyStore(m.p).set('mail-letters', m.r));
    (o.cfg || []).forEach((c) => {
      const s = window.xyStore(c.p);
      s.set('reply-ml-write-en', c.en ? '1' : '0');
      s.set('reply-ml-write-prob', '100');
      s.set('reply-ml-write-min', '1'); s.set('reply-ml-write-max', '2');
      s.set('reply-ml-write-daily-max', '9');
      s.set('mail-letter-last', '0'); s.set('mail-letter-next', '0');
    });
  }, opts);
  await page.waitForTimeout(3500);
}
const setCfgEn = (p, en) => page.evaluate((o) => { window.xyStore(o.p).set('reply-ml-write-en', o.en ? '1' : '0'); }, { p, en });
async function waitLib(k, want, ms) {
  const t0 = Date.now(); let last = -9;
  while (Date.now() - t0 < (ms || 30000)) { last = nOf(await rawGet(k)); if (last === want) return last; await page.waitForTimeout(400); }
  return last;
}
const goHidden = () => page.evaluate(() => new Promise((res) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  setTimeout(() => res(1), 700); // #1195e 的释放挂在切后台这一刻
}));
// 回前台补查＝报障机上真正开枪的那一发（eagerCheck 挂 visibilitychange/pageshow/focus，节流 5s）
const comeBack = () => page.evaluate(() => new Promise((res) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  setTimeout(() => res(1), 300);
}));
const fire = () => page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
// 不限流的公开入口：openMailPage 内部直调 checkPendingReply；fishWeekTick 是 v3.13.x 给验证脚本留的口
const shootPublic = () => page.evaluate(() => {
  try { if (window.openMailPage) window.openMailPage(); } catch (e) {}
  try { if (window.fishWeekTick) window.fishWeekTick(); } catch (e) {}
});
// 开枪前的读数：只问「这一格现在读不读得到」，一律不碰 xyStore.get、也不碰 xyBigWriteHold
// ——两者命中空格都会当场踢一趟按需取回（#1349a／#1361b 的 requestBigKey），量具自己把被测量踢回来
// ＝开枪时读数已在场，症状被量具自己修掉（上一轮的假绿就是这么来的）。awaitingBigKey 只读四格证据，不踢。
const blindState = () => page.evaluate(() => {
  const d = window.__xyBigReadDiag ? window.__xyBigReadDiag() : null;
  let live = 'ok';
  try { localStorage.setItem('__bs1442', 'x'.repeat(1024)); localStorage.removeItem('__bs1442'); } catch (e) { live = (e && e.name) || 'throw'; }
  return {
    live, filled: (window.__f1442 || {}).filled, f: (window.__f1442 || {}).lsProbe,
    await1: window.activeStore().awaitingBigKey('mail-letters'),
    await2: window.storeFor('cprobe1').awaitingBigKey('mail-letters'),
    blind: d && d.blind, unconf: d && d.unconfirmed,
    state: window.mochiDataState ? window.mochiDataState() : '(无)',
    pending: !!(window.mochiDataPending && window.mochiDataPending())
  };
});
const memCount = () => page.evaluate(() => {
  const cnt = (s) => { try { return JSON.parse(s).length; } catch (e) { return s === null ? null : -1; } };
  return { m1: cnt(window.xyStore('xy-home-v2:default').get('mail-letters')), m2: cnt(window.xyStore('xy-home-v2:cprobe1').get('mail-letters')), st: window.mochiDataState ? window.mochiDataState() : '(无)' };
});
const markOf = (wk) => page.evaluate((w) => window.xyStore('xy-home-v2:default').get('fish-week-report:' + w), wk);
const screenIds = () => page.evaluate(() => {
  const el = document.getElementById('mail-in-list');
  return el ? Array.from(el.querySelectorAll('.mail-item')).map((n) => n.dataset.id) : ['(无 #mail-in-list)'];
});
const CT3 = JSON.stringify([{ id: 'default', name: '煜' }, { id: 'cprobe1', name: '小探' }, { id: 'cnew3', name: '新三' }]);
const CT1 = JSON.stringify([{ id: 'default', name: '煜' }]);

// ============ 甲：启动回填还在排队 × 三条后台通路的公开入口 ============
console.log('\n== 甲组：LS 整域写不进 × 启动回填排队 × 后台通路 ==');
{
  await newCtx(true);
  await seedAll({
    contacts: CT3,
    mail: [{ p: 'xy-home-v2:default', r: mkLetters(20, 'seed') }, { p: 'xy-home-v2:cprobe1', r: mkLetters(14, 'p1') }],
    cfg: [{ p: 'xy-home-v2:default', en: true }, { p: 'xy-home-v2:cprobe1', en: true }, { p: 'xy-home-v2:cnew3', en: true }]
  });
  ok(await waitLib(K1, 20) === 20 && await waitLib(K2, 14) === 14, 'F0 夹具真把两本旧账灌进库里（红＝夹具坏，不是产品的锅）', { n1: nOf(await rawGet(K1)), n2: nOf(await rawGet(K2)) });
  const sz = await page.evaluate(() => window.idbBigIdxSize('mail-letters'));
  ok(sz > 256 * 1024, 'F1 信箱主键跨过 256KB（够得着 #1195e 那把按体积放掉内存副本的闸）', 'idx=' + sz);
  await page.reload({ waitUntil: 'load' });
  let shots = 0, samples = [], q = {};
  for (let i = 0; i < 45; i++) {
    q = await blindState();
    if (q.state === 'ready') { samples.push('ready#' + i); break; }
    if (q.pending) { await shootPublic(); await fire(); shots++; samples.push('blind#' + i); }
    await page.waitForTimeout(1200);
  }
  ok(q.live === 'QuotaExceededError' && q.filled > 12, 'F2 这一场 LS 真写不进（复现诊断单：整域 192 键≈10MB 全是兄弟站点，本项目只剩 1 键）', JSON.stringify({ live: q.live, f: q.f, filled: q.filled }));
  ok(shots >= 1, 'F3 至少一枪真落在「启动回填还在排队」那一格（#1361m 那第四格证人；红＝量具没掐住，甲1~甲3 只是自己写给自己看）', JSON.stringify({ st: q.state, pd: q.pending, shots, s: samples.slice(0, 8) }));
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await shootPublic(); // 甲4 走「读数在场」那一班：排队窗里 getContacts 自己还没回填回来，量的是夹具时序不是产品
  await page.waitForTimeout(2500);
  const a1 = await libSeries(K1, 6, 400), a2 = await libSeries(K2, 3, 300), a3 = await libSeries(K3, 3, 300);
  ok(a1.min >= 20 && keep(a1.ids, 'seed', 20), '甲1【症状本体】排队窗里那一班不许把库里 20 封顶成自动生成那一封（整场最低读数）', JSON.stringify({ min: a1.min, last: a1.last, head: a1.ids.slice(0, 2) }));
  ok(a2.min >= 14 && keep(a2.ids, 'p1', 14), '甲2【症状本体】非当前桌面同一条：cprobe1 库里 14 封一封不少', JSON.stringify({ min: a2.min, last: a2.last }));
  const mk = await markOf('9-27');
  ok(mk === null || mk === '1', '甲3 让路那一班不许把「还没寄的这周」的标记烧了又双份寄（要么没烧要么寄成功）', 'mark=' + mk);
  ok(a3.min >= 1, '甲4 库里确无这一键的新桌面（cnew3）在闸下照旧直接落盘（修过头防护）', '库里 ' + a3.min + ' 封');
  ok(page.__errs.length === 0, 'Z1 甲场全程零未捕获 JS 异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ 乙：切后台放掉内存副本 × 回前台补查来信（诊断单「切后台放过 10 格」那一发） ============
console.log('\n== 乙组：切后台放掉大键副本 × 回前台补查来信 ==');
{
  await newCtx(true);
  await seedAll({
    contacts: CT3,
    mail: [{ p: 'xy-home-v2:default', r: mkLetters(20, 'seed') }, { p: 'xy-home-v2:cprobe1', r: mkLetters(14, 'p1') }],
    cfg: [{ p: 'xy-home-v2:default', en: false }, { p: 'xy-home-v2:cprobe1', en: false }, { p: 'xy-home-v2:cnew3', en: false }]
  });
  await page.reload({ waitUntil: 'load' });
  await enter();
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const e0 = await memCount();
  ok(e0.m1 === 20 && e0.m2 === 14 && e0.st === 'ready', 'E0 健康对照：不开枪时两本都在内存（回填照旧成功，本批不许把它弄红）', JSON.stringify(e0));
  await setCfgEn('xy-home-v2:default', true);
  await setCfgEn('xy-home-v2:cprobe1', true);
  await page.waitForTimeout(5300); // 跨过 eagerCheck 的 5s 节流：上一枪（如果有的话）与这一枪之间必须隔开
  await goHidden();
  const e1 = await blindState();
  ok(e1.blind >= 2 && e1.unconf >= 2, 'E1 切一次后台后两本主键确实读空（读数不碰 get＝不把被测量踢回来）', JSON.stringify({ blind: e1.blind, unconf: e1.unconf }));
  ok((e1.blind || 0) >= 2, 'E2 切后台照旧按体积放掉大键内存副本（不许拿「不再释放」来修这个 bug＝iOS 卡顿那一批的回归）', JSON.stringify({ blind: e1.blind }));
  ok(e1.await1 === true && e1.await2 === true, 'E3 落笔那一刻数据层那句尺说不许整包写回（#1342d 的 awaitingBigKey，读数本身不踢库）', JSON.stringify({ a1: e1.await1, a2: e1.await2 }));
  await comeBack();
  const b1 = await libSeries(K1, 4, 400), b2 = await libSeries(K2, 2, 300);
  ok(b1.min >= 20 && keep(b1.ids, 'seed', 20), '乙1【症状本体】回前台补查那一发不许把库里 20 封顶成一封（整场最低读数）', JSON.stringify({ min: b1.min, last: b1.last, head: b1.ids.slice(0, 2) }));
  ok(b2.min >= 14 && keep(b2.ids, 'p1', 14), '乙1b 非当前桌面同一条（同一班枪，两个桌面一起量：14 封一封不少）', JSON.stringify({ min: b2.min, last: b2.last }));
  await page.waitForFunction(() => { const v = window.xyStore('xy-home-v2:default').get('mail-letters'); try { return JSON.parse(v).length >= 20; } catch (e) { return false; } }, null, { timeout: 30000 }).catch(() => {});
  const e4 = await memCount();
  ok(e4.m1 >= 20, '乙2 被放掉那一格当场问库、下一读自愈（#1349a 语义不动）', '内存 ' + e4.m1 + ' 封');
  await page.waitForTimeout(6000);
  await fire();
  await page.waitForTimeout(3000);
  const b3 = await rawGet(K1);
  ok(nOf(b3) >= 21 && keep(idsOf(b3), 'seed', 20), '乙3 让路之后这封信仍会落地：整包回来后下一班补成 21 封且旧 id 全在（拒覆盖≠拒保存）', '库里 ' + nOf(b3) + ' 封');
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(1200);
  const sc = await screenIds();
  ok(keep(sc, 'seed', 20), '乙4 屏上信箱重开看得见那 20 封（用户视角：点进去不是空的）', sc.slice(0, 3).join(','));
  ok(page.__errs.length === 0, 'Z2 乙场全程零未捕获 JS 异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ 丙：同族另外两条（到期回信落地／每周摸鱼小结） ============
console.log('\n== 丙组：到期回信与周小结这两条同族通路 ==');
{
  await newCtx(true);
  await seedAll({ contacts: CT1, mail: [{ p: 'xy-home-v2:default', r: mkLetters(20, 'seed') }], cfg: [{ p: 'xy-home-v2:default', en: false }] });
  await page.evaluate(() => {
    window.xyStore('xy-home-v2:default').set('mail-reply-pending', JSON.stringify([{ id: 'seed_3', content: '第一发取证回信', due: Date.now() - 60000 }]));
    window.__fishWeekNowOverride = () => new Date(2026, 8, 27, 19, 0); // 周小结时钟按死＝今天星期几不影响
  });
  await page.reload({ waitUntil: 'load' });
  await enter();
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await shootPublic();
  await page.waitForTimeout(2500);
  const p1 = await rawGet(K1);
  ok(/第一发取证回信/.test(String(p1)), '丙1 健康读数下到期回信照旧落进库（partnerReply 落地＝闸不许把它挡成「存不进去」）', '库里 ' + nOf(p1) + ' 封');
  ok((await markOf('9-27')) === '1', '丙2 健康读数下周小结照旧寄出并打上周标记', 'mark=' + await markOf('9-27'));
  const p2 = await rawGet(K1);
  ok(/本周（|小结/.test(String(p2)) && keep(idsOf(p2), 'seed', 20), '丙2b 小结那一封落库且旧信一封不少', '库里 ' + nOf(p2) + ' 封');
  // 读空那一班：切后台放掉，再塞一条到期计划＋一份还没寄的周
  await page.evaluate(() => {
    const s = window.xyStore('xy-home-v2:default');
    s.set('mail-reply-pending', JSON.stringify([{ id: 'seed_7', content: '第二发取证回信', due: Date.now() - 60000 }]));
    s.set('mail-letter-last', '0'); s.set('mail-letter-next', '0');
    s.set('reply-ml-fish-week-en', '0'); // 健康阶段不让小结有机会寄出：应用那支 20~60s 无条件钟会抢在举旗之前把标记合法烧掉
  });
  await setCfgEn('xy-home-v2:default', true);
  await page.waitForTimeout(5300);
  await goHidden();
  const c0 = await blindState();
  // 周小结的时钟改到「还没寄的那一周」——必须在切后台之后再拨，早拨的话应用自己那支 20~60s 定时钟
  // 会在读数在场时把这一周的标记合法寄掉一次，丙5 就变成量具自己造出来的假红（踩过）
  await page.evaluate(() => {
    window.__fishWeekNowOverride = () => new Date(2026, 8, 20, 19, 0);
    window.xyStore('xy-home-v2:default').set('reply-ml-fish-week-en', '1'); // 只在这一枪起允许小结
  });
  ok(c0.await1 === true && c0.unconf >= 1, '丙0 这一班确实落在读空那一发（否则丙3~丙6 无意义）', JSON.stringify({ a: c0.await1, u: c0.unconf }));
  // 这一班只打 focus（eagerCheck 直调三条通路，5.3s 前已跨过它的 5s 节流）——不调 openMailPage：
  // 它 render→load→get，而 get 命中空格会当场踢一趟按需取回（#1349a），量具自己把读数取回来，
  // 应用那支 20~60s 的一次性钟再落进来就是「合法寄出」，丙5 的当场读数会红成量具自己造的假红（踩过两轮）
  let mk3 = { m: null, blindAtShot: false, tries: 0 };
  // 丙5＝「读空那一发不许烧掉还没寄的那一周的标记」：开枪必须真落在读空那一格。本批把自救并回做快之后，
  //   隔一次往返读数就可能已落定（实测 blindAtShot:false）——那是 heal 快，不是没让路。
  //   所以每轮重开一次读空窗（再切一次后台放掉副本），并在**同一次求值里**「确认读空 → 打小结 → 立刻读标记」；
  //   只有抓到读空那一格的那一次算数，一次都没抓到＝量具坏，如实红。
  for (let i = 0; i < 5; i++) {
    await goHidden();
    await page.waitForTimeout(5300);
    mk3 = await page.evaluate(() => {
      const blind = (() => { try { return window.activeStore().awaitingBigKey('mail-letters'); } catch (e) { return 'ERR'; } })();
      let m = 'ERR';
      if (blind === true) { try { if (window.fishWeekTick) window.fishWeekTick(); } catch (e0) {} try { m = window.xyStore('xy-home-v2:default').get('fish-week-report:9-20'); } catch (e1) {} }
      return { m: m, blindAtShot: blind, tries: 0 };
    });
    mk3.tries = i + 1;
    if (mk3.blindAtShot === true) break;
  }
  await page.waitForTimeout(2000);
  const after = await libSeries(K1, 4, 400), pend2 = await rawGet(KPEND);
  ok(after.min >= 20, '丙6 读空那一发不许把整本写成回信版／一封信（整场最低读数 ≥20）', JSON.stringify({ min: after.min, last: after.last }));
  const landedBlind = /第二发取证回信/.test(String(await rawGet(K1)));
  const pendStill = /第二发取证回信/.test(String(pend2));
  ok(landedBlind === false ? pendStill : true, '丙3【症状本体】读空那一发不许吃掉回信计划（没落地又不在计划里＝永远不回这封信）', 'pend=' + String(pend2).slice(0, 80));
  ok((await markOf('9-27')) === '1', '丙4 读空那一发不许把已寄出的那周小结重放／顶掉（周标记还在）', 'mark9-27=' + await markOf('9-27'));
  ok(mk3.blindAtShot === true && mk3.m === null, '丙5【症状本体】抓到读空那一格并当场打小结：不许烧掉还没寄的那一周的标记', JSON.stringify(mk3));
  ok(page.__errs.length === 0, 'Z3 丙场全程零未捕获 JS 异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ 丁：读空窗口里用户自己写的那一封信必须活过页面回收 ============
console.log('\n== 丁组：暂存层的第二 home ==');
{
  await newCtx(true);
  await seedAll({ contacts: CT1, mail: [{ p: 'xy-home-v2:default', r: mkLetters(20, 'seed') }], cfg: [{ p: 'xy-home-v2:default', en: false }] });
  // 这一场只量「读空窗口写的那一封」与「清空后快照销账」：关掉每周摸鱼小结的自动寄出，
  //   否则轮询期间它会合法寄进一封信、把快照原样重写，丁5 就读成「没销账」的假红（周一~周三是补发窗口）
  await page.evaluate(() => { window.xyStore('xy-home-v2:default').set('reply-ml-fish-week-en', '0'); });
  await page.reload({ waitUntil: 'load' });
  await enter();
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await goHidden();
  const d0 = await blindState();
  ok(d0.await1 === true, '丁0 开枪这一发落在读空那一格', JSON.stringify({ a: d0.await1, u: d0.unconf }));
  await page.evaluate(() => { const b = document.getElementById('mail-open-write'); if (b) b.click(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const i = document.getElementById('mail-input'); if (!i) return;
    i.value = '丁1取证信这一封'; if (i.__ceBox) i.__ceBox.textContent = '丁1取证信这一封';
  });
  await page.evaluate(() => { const b = document.getElementById('mail-send'); if (b) b.click(); });
  await page.waitForTimeout(2200);
  const snapRaw = await rawGet(SNAP1);
  ok(/丁1取证信这一封/.test(String(snapRaw)), '丁1【症状本体】读空窗口里寄出的那一封有一条落得了盘的路（快照键真在库里，不再只躺 LS）', 'snap=' + String(snapRaw).slice(0, 46));
  await page.reload({ waitUntil: 'load' });
  await enter();
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const fin = await rawGet(K1);
  ok(keep(idsOf(fin), 'seed', 20), '丁2 重开之后 20 封旧信一封不少（写闸不许把「保住库里那本」变成「读不回来」）', '库里 ' + nOf(fin) + ' 封');
  // 丁3 快照这层存在的唯一理由＝库里那一本真没了（v3.7.x 装它就是为了兜「Edge 丢库」）：删掉主键再重开
  //   ——LS 死透的机器上，这一份能不能从库里读回来并把信箱捞起来。
  // 删必须走应用自己那句 remove（#1469 收口时改）：早先这里绕过数据层直接动 IndexedDB，名册（大键索引／
  //   挂起名单）却还留着「这一格库里本该有一份」，数据层从此永远回答「这一发读不回来」＝量具自己造出来的
  //   假残缺读数。它会把 #1469 的「读不全时删除／清空当场按住」永久挡在丁4~丁6 前面，丁6 就从「复活闸」
  //   变成「按住闸」的取证（实测：同一断言纯 HEAD 侧绿、带 #1469 那把闸的侧红，红的是量具不是应用）。
  await page.evaluate(() => { try { window.xyStore('xy-home-v2:default').remove('mail-letters'); } catch (e) {} });
  await page.evaluate(() => new Promise((res) => {
    try { if (!window.idbDelete) { res(0); return; } window.idbDelete('xy-home-v2:default:mail-letters').then(() => res(1), () => res(0)); } catch (e) { res(0); }
  }));
  ok((await rawGet(K1)) === null, '丁3a 主键确实从库里没了（走应用那句 remove＝名册一并撤掉，不留假残缺）', '库里=' + String(await rawGet(K1)).slice(0, 30));
  await page.reload({ waitUntil: 'load' });
  await enter();
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(1600);
  const screen3 = await page.evaluate(() => {
    const el = document.getElementById('mail-in-list');
    return { rows: el ? el.querySelectorAll('.mail-item').length : -1, text: el ? String(el.textContent || '').replace(/\s+/g, ' ').slice(0, 400) : '(无节点)' };
  });
  ok(screen3.rows >= 20 && screen3.text.indexOf('还没有收到信') < 0, '丁3【症状本体】库里那一本没了时，快照那一份把信箱捞回来（屏上仍是那些信，不是当面宣告「还没有」）', JSON.stringify({ rows: screen3.rows, t: screen3.text.slice(0, 60) }));
  ok(String(screen3.text).indexOf('正文') >= 0, '丁3b 捞回来的这一份是正文版（剥图但可读）', JSON.stringify({ t: screen3.text.slice(0, 70) }));
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(900);
  const beforeClr = nOf(await rawGet(K1));
  const snapBeforeClr = await rawGet(SNAP1);
  const screenBeforeClr = await page.evaluate(() => document.querySelectorAll('#mail-in-list .mail-item, #mail-out-list .mail-item').length);
  await page.evaluate(() => { const t = document.getElementById('cc-toast'); if (t) { t.textContent = ''; t.className = 'cc-toast'; } }); // 先清常驻 toast，免得把上一条读成本条（踩过）
  await page.evaluate(() => { const b = document.getElementById('mail-clear'); if (b) b.click(); });
  await page.waitForTimeout(900);
  // 这一发到底走了哪条腿：弹了确认框＝读数完整、允许清空；没弹而给了那句提示＝读不全被当场按住
  //   （#1469 作者口径＝只保新写的信，删除/清空要等读数落定）。两条都算「说了话」，
  //   唯独「既不弹框也不提示、屏上库里全不动」是静默——这一组要拦的就是它。
  const clrSeen = await page.evaluate(() => {
    const m = document.getElementById('modal-mask'), t = document.getElementById('cc-toast');
    return { modal: !!(m && !m.hidden && /清空所有信件/.test(String(m.textContent || ''))), toast: t ? String(t.textContent || '') : '' };
  });
  const heldClr = !clrSeen.modal && /没读全/.test(clrSeen.toast);
  await page.evaluate(() => {
    const m = document.getElementById('modal-mask'); if (!m) return;
    const btns = Array.from(m.querySelectorAll('button, .modal-btn, .mc-btn'));
    const t = btns.find((x) => /确定|确认|删除|清空/.test(x.textContent || '')) || btns[btns.length - 1];
    if (t) t.click();
  });
  await page.waitForTimeout(2200);
  const cleared = await rawGet(K1);
  let snapAfter = await rawGet(SNAP1);
  for (let i = 0; i < 4 && snapAfter !== null; i++) { await page.waitForTimeout(700); snapAfter = await rawGet(SNAP1); } // 只等这一次 IDB 写落定（≤~3.5s）；再往后的重写属于「下一班又写了一遍」，交给丁6 判
  ok(clrSeen.modal ? nOf(cleared) === 0 : heldClr, '丁4 清空那一发必须当场说话：要么弹确认框并落库，要么给那句「没读全」的提示（不许静默＝按了没反应还不吭声）', '库里 ' + nOf(cleared) + ' 封；这一发' + (clrSeen.modal ? '弹框并落地' : heldClr ? '按住并提示' : '既不弹框也不提示 ' + JSON.stringify(clrSeen.toast.slice(0, 40))));
  ok(clrSeen.modal ? (snapAfter === null || nOf(cleared) === 0) : snapAfter === snapBeforeClr, '丁5 清空后快照要么一并销账、要么不可能再被读到；被按住那一发不许偷偷改写任何一本（快照字节照旧）', 'snap=' + String(snapAfter).slice(0, 36) + ' 主键=' + nOf(cleared));
  await page.waitForTimeout(9000);
  const later = await rawGet(K1);
  const lateScreen = await page.evaluate(() => { try { if (window.openMailPage) window.openMailPage(); } catch (e) {} return new Promise((r) => setTimeout(() => r(document.querySelectorAll('#mail-in-list .mail-item, #mail-out-list .mail-item').length), 1300)); });
  // 现场归属：屏上那几封到底从哪一路回来的（内存暂存／旁路账／剥图快照）。普通被测没有这个口，读成 null 不影响判据
  const diag6 = await page.evaluate(() => { try { return window.__xyMailDiag ? window.__xyMailDiag() : null; } catch (e) { return { err: String(e && e.message) }; } });
  ok(clrSeen.modal ? (nOf(later) === 0 && lateScreen === 0)
    : (nOf(later) === beforeClr && lateScreen === screenBeforeClr && snapAfter === snapBeforeClr),
    '丁6【用户看得见的那一本】清空落地后 9 秒：库里与屏上同为空态（迟到的读回不许复活）；若是被按住：库里／屏上／快照三处一律照旧（不许一边说等着、一边偷偷删）', '库里 ' + nOf(later) + ' 封；屏上 ' + lateScreen + ' 条；清前 ' + beforeClr + ' 封／' + screenBeforeClr + ' 条；这一发' + (clrSeen.modal ? '落地' : '按住') + '；归属 ' + JSON.stringify(diag6));
  // 丁7【症状本体】「按住」必须是等一下，不是永远删不掉：重试到读数落定那一轮，清空必须真落空
  //   （与 #1469 尺子 C3 那一型同一条口径，只是这一场的现场是 LS 整域写不进＋主键已被摘掉）
  let landed = clrSeen.modal === true && nOf(later) === 0 && lateScreen === 0;
  let tries7 = landed ? 0 : 1;
  const heldLog = [];
  for (; !landed && tries7 <= 8; tries7++) {
    await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const t = document.getElementById('cc-toast'); if (t) { t.textContent = ''; t.className = 'cc-toast'; } });
    await page.evaluate(() => { const b = document.getElementById('mail-clear'); if (b) b.click(); });
    await page.waitForTimeout(900);
    const s7 = await page.evaluate(() => {
      const m = document.getElementById('modal-mask'), t = document.getElementById('cc-toast');
      return { modal: !!(m && !m.hidden && /清空所有信件/.test(String(m.textContent || ''))), toast: t ? String(t.textContent || '') : '' };
    });
    if (s7.modal) {
      await page.evaluate(() => {
        const m = document.getElementById('modal-mask'); if (!m) return;
        const btns = Array.from(m.querySelectorAll('button, .modal-btn, .mc-btn'));
        const t = btns.find((x) => /确定|确认|删除|清空/.test(x.textContent || '')) || btns[btns.length - 1];
        if (t) t.click();
      });
      await page.waitForTimeout(2400);
      const c7 = await rawGet(K1);
      const sc7 = await page.evaluate(() => { try { if (window.openMailPage) window.openMailPage(); } catch (e) {} return new Promise((r) => setTimeout(() => r(document.querySelectorAll('#mail-in-list .mail-item, #mail-out-list .mail-item').length), 1200)); });
      if (nOf(c7) === 0 && sc7 === 0) landed = true;
      else heldLog.push('第' + tries7 + '轮弹框却仍有货：库里 ' + nOf(c7) + '／屏上 ' + sc7);
    } else {
      const dg = await page.evaluate(() => { try { return window.__xyMailDiag ? window.__xyMailDiag() : null; } catch (e) { return 'err'; } });
      const ask = await page.evaluate(() => { try { return window.__xyMailAskProbe ? window.__xyMailAskProbe() : Promise.resolve('量具外被测没有这一口') } catch (e) { return 'err'; } });
      heldLog.push('第' + tries7 + '轮仍按住 ' + JSON.stringify(dg) + ' 三态=' + ask);
      await page.waitForTimeout(2500); // 这一发的库问话在路上，下一轮再试
    }
  }
  // 「为什么还按着」——逐键读那一问的三条证据，而不是整张表的总数（总数会把别的键算进来＝误导）。
  //   bigBlindWhy 是本批补的只读口（与 bigReadUnconfirmed 逐条同判据）；旧被测没有这一口时退回公开读数。
  const why7 = await page.evaluate(() => {
    const REL = 'mail-letters', K = 'xy-home-v2:default:' + REL;
    const out = { why: 'nofn', deferredAt: 'n/a', idxSize: 'n/a', lsMain: 'throw', lsIdx: 'throw', dataPending: 'n/a', diagTotals: null };
    try { out.why = window.__xyBigBlindWhy ? String(window.__xyBigBlindWhy(K)) : 'nofn'; } catch (e) { out.why = 'throw'; }
    try { out.deferredAt = Array.isArray(window.__xyIdbDeferredKeys) ? window.__xyIdbDeferredKeys.indexOf(K) : 'notarray'; } catch (e) { out.deferredAt = 'throw'; }
    try { out.idxSize = window.idbBigIdxSize ? String(window.idbBigIdxSize(REL)) : 'nofn'; } catch (e) { out.idxSize = 'throw'; }
    try { out.diagTotals = window.__xyBigReadDiag ? window.__xyBigReadDiag() : 'nofn'; } catch (e) { out.diagTotals = 'throw'; }
    try { const v = localStorage.getItem(K); out.lsMain = v === null ? 'null' : String(v.length); } catch (e) { out.lsMain = 'throw:' + (e && e.name); }
    try { out.lsIdx = String(localStorage.getItem('xy-home-v2:__big-idx') || 'null').slice(0, 140); } catch (e) { out.lsIdx = 'throw:' + (e && e.name); }
    try { out.dataPending = !!(window.mochiDataPending && window.mochiDataPending()); } catch (e) { out.dataPending = 'throw'; }
    return out;
  });
  console.log('    · 丁7 归属读数（哪一格证人还在说「库里本该有一份」） ' + JSON.stringify(why7));
  ok(landed, '丁7【症状本体】被按住之后重试到读数落定那一轮，清空必须真落空（库里 0＋屏上 0）＝「按住」是等一下，不是这台机永远删不掉', JSON.stringify({ 重试轮数: tries7, 现场: heldLog.slice(0, 2), 为什么还按着: why7 }));
  ok(page.__errs.length === 0, 'Z4 丁场全程零未捕获 JS 异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ S 组：产物静态锚（防「名字留着、逻辑被改」） ============
console.log('\n== S 组：产物逻辑锚 ==');
{
  const mailSrc = readFileSync(join(root, 'js/mail.js'), 'utf8');
  ok(/xyBigWriteHold\(csFor\(cid\), KEY\)/.test(mailSrc), 'S1 mailBlindRead 借的就是数据层那一句（xyBigWriteHold），没另起第二把尺');
  ok(/mailReadIncomplete\(cid\) \|\| mailBlindRead\(cid\)/.test(mailSrc), 'S2 save() 的闸问「这一桌面交不交得出权威读数」，与传没传 cid 无关');
  ok(/#1442a 来信让路/.test(mailSrc) && /#1442b 回信让路/.test(mailSrc) && /#1442c 小结让路/.test(mailSrc), 'S3 三条后台通路各自在生成前让路（三处都在）');
  ok(/snapStore\(cid\)/.test(mailSrc) && /\.set\(SNAP_KEY, snap\)/.test(mailSrc) && /\.remove\(SNAP_KEY\)/.test(mailSrc), 'S4 快照那一层走同一句柄（LS 写不进时库里还有一份）');
  ok(!/localStorage\.setItem\(snapKey\(cid\)/.test(mailSrc) && !/localStorage\.removeItem\(snapKey\(cid\)/.test(mailSrc), 'S5 产物里没有裸 localStorage 的快照读写（回到旧写法即红）');
}

console.log('\n合计 通过=' + pass + ' 断言失败=' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);

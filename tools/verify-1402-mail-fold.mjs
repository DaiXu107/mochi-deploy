// ===== 常驻回归脚本 #1402：信箱按时间分组（作者直派「写信太多，会写的非常杂；需要打开只显示本周写信，其他时间的信都按月份折叠起来」）
// 用法：node tools/verify-1402-mail-fold.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（2026-09-29 作者直派）：信箱两份列表各自是一条「全量平铺」的时间倒序列（旧 render 直接把整箱
//   信 map 到底），攒几个月就是几十上百行没有层次的长列＝「写的非常杂」。作者点的修法＝打开只见本周，
//   更早按月折叠。
//
// #1417 改口（作者直派）：初版把未读来信抽进列表顶部一个常驻的「未读」分区，作者说「不要因为信未读就收进
//   单独的【未读】里，这样会显得非常乱，需要只按时间折叠起来」。现在未读跟着它自己的时间落进本周／月份组，
//   #1402 那条硬约束（「折叠组是 display:none，未读折进去＝红点亮着而列表里找不到那封信」）改由两条守：
//   含未读的组默认展开 ＋ 组标题挂「N 封未读」。本尺随之改判据（A 组），旧「未读常驻区」一族断言全部退役。
//
// 判据一律零机型／零 UA 分支，只取两个事实：① 墙钟周界＝本周一 00:00（自然周，不是滚动 7 天）；
//   ② 信件自身的 tm／read 字段。寄出的信没有「未读」概念（read 只在对来信置位、徽标也只数 received），
//   那一侧只做「本周＋按月折叠」，不为此新造持久字段。
//
// 读数只问四件事：这一封在不在屏幕上（可见）、它在哪个桶里、红点数与看得见的未读封不封得住、用户手动开合听不听。
//
// 断言：
//   A 组 本批契约（#1402 分组本体；红侧＝纯 HEAD 产物，HEAD 是整箱平铺、没有分组这一层）：
//     A1 上周日那一封不进「本周」（自然周界；滚动 7 天会把它算进来）／A1b 本周三封都在平铺区
//     A2 未读不再抽成常驻区：没有任何「未读」小标题、更早那封未读不落在平铺区（#1417 改口本体）／
//     A3 更早的按月成组、默认收起／A3b 组标题＝「YYYY 年 M 月」＋「N 封」／
//     A4 含未读的组默认展开、不含未读的默认收起（#1417 之后守「红点亮着也看得见」的那一条）／
//     A5 含未读的组标题挂「1 封未读」／A6 屏幕上零条未读被 display:none 盖住／
//     A7 桌面徽标读数 === 屏上看得见的未读封数／
//     A8 用户手动合上含未读的组＝听用户的，且这个开合态活过一次重绘／A8b 再点＝打开／
//     A9 收／寄两侧各折各的（同一个月不互相顶掉）／A10 月份条新→旧／
//     A11 一封都不吞（折叠＝看不见，不是没渲染）＋一封信只落一个桶
//   B 组 旧契约一字不许动（两侧皆绿）：B1 本周区内仍按时间倒序／B2 空库照旧如实宣告空态／
//     B3 点开折叠组里的信仍走开信弹层／B4 读过一封未读之后徽标跟着掉／
//     B5 列表条数＝库内该侧封数（红米 K80 那条 innerHTML 重试的判据面）／
//     B6 整箱都是本周＝不加任何分组标题／B7 tab 切换照旧（#93）
//   S 组 产物静态锚（本批新代码真在产物里；⚠ JS 已外置，判的是 js/mail.js 与 index.html 两处，不是内联）＋
//     S3 删除型：旧「未读常驻区」那一支不得回流
//   Z 组 全程零未捕获 JS 异常
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || here));
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

const DAY = 86400000;
// 周界与夹具共用同一条算法（本周一 00:00），断言里再单独验「上周日」那一发不落本周
const weekStart = () => { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - dow); return d.getTime(); };
const L = (id, type, tm, read) => ({ id, type, tt: '信 ' + id, content: '正文 ' + id, tm, read: !!read });
const mkLetters = () => {
  const w = weekStart();
  const lastSunday = w - DAY;                       // 上周日＝自然周界的外侧那一发
  const m1 = new Date(w); m1.setDate(1); if (m1.getTime() >= w) m1.setMonth(m1.getMonth() - 1);
  const m1t = m1.getTime();                         // 本月 1 日（本周之前那一截月尾）
  const m2t = m1t - 32 * DAY;                       // 再往前一个月
  return [
    L('wa', 'received', w + 3000, true),
    L('wb', 'received', w + 2000, true),
    L('wc', 'received', w + 1000, false),           // 本周·未读
    L('sa', 'sent', w + 5000, true),
    L('sb', 'sent', w + 4000, true),
    L('p0', 'received', lastSunday, true),          // 上周日的来信（界外）
    L('ps', 'sent', lastSunday, true),              // 上周日的寄信
    L('a1', 'received', m1t + DAY, true),
    L('a2', 'received', m1t + 2 * DAY, true),
    L('au', 'received', m1t + 3 * DAY, false),      // 更早那个月的未读＝「折叠会不会把红点藏掉」的真靶子
    L('as', 'sent', m1t + 4 * DAY, true),
    L('b1', 'received', m2t + DAY, true),
    L('bs', 'sent', m2t + 2 * DAY, true),
  ];
};

const browser = await chromium.launch({ headless: true });
const errs = [];
async function enter(page) {
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const s = document.querySelector('.splash'); if (s) s.remove();
    document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await page.waitForTimeout(300);
}
async function waitReady(page) {
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
}
// 真实进页入口（render 只在信箱页可见时干活，硬把 page 显出来列表是空的）
async function openMail(page) {
  await page.evaluate(() => { window.openMailPage(); });
  await page.waitForTimeout(350);
}
async function seed(page, letters) {
  await page.evaluate((v) => { window.xyStore('xy-home-v2:default').set('mail-letters', JSON.stringify(v)); }, letters);
  await openMail(page);
}
async function tab(page, mtab) {
  await page.evaluate((m) => { const t = document.querySelector('.fav-tab[data-mtab="' + m + '"]'); if (t) t.click(); }, mtab);
  await page.waitForTimeout(250);
}
const dump = (page) => page.evaluate(() => {
  const vis = (n) => !!(n.offsetParent || n.getClientRects().length);
  const rows = (lid) => {
    const box = document.getElementById(lid);
    if (!box) return { err: 'NO-BOX', total: -1, flat: [], folds: [], labels: [], dup: 0, hiddenUnread: 0, visibleUnread: [] };
    const all = Array.from(box.querySelectorAll('.mail-item'));
    const folds = Array.from(box.querySelectorAll('.mail-fold')).map((f) => {
      const head = f.querySelector('.mail-fold-head');
      const items = Array.from(f.querySelectorAll('.mail-item'));
      return {
        key: f.getAttribute('data-mail-fold') || '',
        title: (f.querySelector('.mail-fold-title') || {}).textContent || '',
        count: (f.querySelector('.mail-fold-count') || {}).textContent || '',
        unreadBadge: (f.querySelector('.mail-fold-unread') || {}).textContent || '',
        openCls: f.classList.contains('open'),
        aria: head ? String(head.getAttribute('aria-expanded')) : '',
        bodyHidden: getComputedStyle(f.querySelector('.mail-fold-body')).display === 'none',
        ids: items.map((n) => n.dataset.id),
        unreadIn: items.filter((n) => /新来信/.test(n.textContent)).length,
      };
    });
    const flat = all.filter((n) => !n.closest('.mail-fold')).map((n) => ({ id: n.dataset.id, vis: vis(n), txt: n.textContent }));
    return {
      total: all.length,
      labels: Array.from(box.querySelectorAll('.mail-sec-label')).map((n) => n.textContent),
      flat, folds,
      dup: all.length - new Set(all.map((n) => n.dataset.id)).size,
      hiddenUnread: all.filter((n) => /新来信/.test(n.textContent) && !vis(n)).length,
      visibleUnread: all.filter((n) => /新来信/.test(n.textContent) && vis(n)).map((n) => n.dataset.id),
    };
  };
  const badgeEl = document.getElementById('mail-badge');
  return {
    in: rows('mail-in-list'), out: rows('mail-out-list'),
    badgeHidden: badgeEl ? badgeEl.hidden : 'NO-EL',
    badgeTxt: badgeEl ? String(badgeEl.textContent) : '',
    pageShown: (() => { const x = document.getElementById('page-mail'); return !!x && !x.hidden; })(),
  };
});
// 徽标读数（#mail-badge 在 setDeskBadge 缺席时才走，站内正是这一形态）
const badgeN = (d) => (d.badgeHidden ? 0 : (parseInt(d.badgeTxt, 10) || 0));
// 点某一封所在那个月份组的组头（不靠下标＝夹具随日期漂移也点得准）；红侧没有组头＝如实报没点到，不崩
async function clickFoldOf(page, boxId, targetId) {
  return page.evaluate(([bid, tid]) => {
    const box = document.getElementById(bid);
    if (!box) return { hit: false, n: 0, why: 'NO-BOX' };
    const folds = Array.from(box.querySelectorAll('.mail-fold'));
    const f = folds.find((x) => Array.from(x.querySelectorAll('.mail-item')).some((i) => i.dataset.id === tid));
    if (!f) return { hit: false, n: folds.length, why: 'NO-FOLD-FOR-' + tid };
    const h = f.querySelector('.mail-fold-head');
    if (!h) return { hit: false, n: folds.length, why: 'NO-HEAD' };
    h.click();
    return { hit: true, n: folds.length, key: f.getAttribute('data-mail-fold') };
  }, [boxId, targetId]);
}

const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 110)));
await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
await enter(p); await waitReady(p);
await seed(p, mkLetters());

let d = await dump(p);
ok(d.pageShown && d.in.total === 8 && d.out.total === 5, '夹具诚实：信箱按真实入口进页、两份列表都读得到信（红绿两侧共用这一发）', JSON.stringify({ in: d.in.total, out: d.out.total }));

// ===== A 组 本批契约 =====
const flatIds = d.in.flat.map((r) => r.id);
ok(!flatIds.includes('p0'), 'A1 上周日那一封不进「本周」（自然周界；滚动 7 天会把它算进来）', 'flat=' + JSON.stringify(flatIds));
ok(['wa', 'wb', 'wc'].every((x) => flatIds.includes(x)), 'A1b 本周三封都在平铺区（两侧同分＝这一条是旧契约：本周的信本来就该看得见）', 'flat=' + JSON.stringify(flatIds));
ok(d.in.folds.length >= 2, 'A3 更早的按月成组（红侧＝整箱平铺、一条月份组都没有）', JSON.stringify(d.in.folds.map((f) => f.key)));
ok(d.in.folds.length > 0 && d.in.folds.every((f) => /^\d{4} 年 \d{1,2} 月$/.test(f.title) && /^\d+ 封$/.test(f.count)), 'A3b 组标题＝「YYYY 年 M 月」＋「N 封」（红侧根本没有组标题可问）', JSON.stringify(d.in.folds.map((f) => f.title + '|' + f.count)));

// A2 未读不再抽成常驻区（#1417 改口本体）
ok(!d.in.labels.includes('未读'), 'A2 不再有「未读」常驻分区小标题（作者直派「不要因为信未读就收进单独的【未读】里、只按时间折叠」）', 'labels=' + JSON.stringify(d.in.labels));
ok(!flatIds.includes('au'), 'A2b 更早那封未读不落在平铺区（它跟着自己的时间落进月份组，不再被抽到列表最前）', 'flat=' + JSON.stringify(flatIds));

// A4/A5 含未读的组默认展开＋组标题挂未读数（#1417 之后守「红点亮着也看得见」的那一条）
const fu = d.in.folds.find((f) => f.ids.includes('au')) || null;
const others = d.in.folds.filter((f) => !f.ids.includes('au'));
ok(!!fu && fu.openCls === true && fu.bodyHidden === false, 'A4 含未读的组默认展开（未读落在它自己的时间组里，默认看得见）', JSON.stringify(fu && { key: fu.key, open: fu.openCls, hid: fu.bodyHidden }));
ok(others.length > 0 && others.every((f) => !f.openCls && f.bodyHidden), 'A4b 不含未读的组默认收起（新鲜用户不该先看见满屏展开的旧信）', JSON.stringify(others.map((f) => f.key + '/open' + f.openCls)));
ok(!!fu && /^1 封未读$/.test(String(fu.unreadBadge).trim()), 'A5 含未读的组标题挂「N 封未读」（哪一组里有红点信一眼可见）', fu ? JSON.stringify(fu.unreadBadge) : 'NO-FOLD');

// A6/A7 未读看得见、封数＝徽标数
ok(d.in.hiddenUnread === 0, 'A6 屏幕上零条「新来信」被 display:none 盖住（红点说有，列表就得看得见）', 'hidden=' + d.in.hiddenUnread + ' folds=' + JSON.stringify(d.in.folds.map((f) => f.key + '/unread' + f.unreadIn)));
ok(d.in.visibleUnread.slice().sort().join(',') === 'au,wc', 'A6b 看得见的未读恰是 wc（本周那封）＋au（更早那月那封）', JSON.stringify(d.in.visibleUnread));
ok(badgeN(d) === d.in.visibleUnread.length, 'A7 桌面徽标读数 === 屏上看得见的未读封数（同一把尺的两端，分叉＝红点与列表各说一套）', 'badge=' + badgeN(d) + ' vis=' + d.in.visibleUnread.length);

// A8 用户手动合上含未读的组＝听用户的，且活过一次重绘
const c1 = await clickFoldOf(p, 'mail-in-list', 'au');
await p.waitForTimeout(250);
await openMail(p); // 重绘：开合态只在 DOM 上就当场收回
d = await dump(p);
const fu2 = d.in.folds.find((f) => f.ids.includes('au')) || { openCls: 'NO-FOLD', bodyHidden: 'NO-FOLD' };
ok(c1.hit && fu2.openCls === false && fu2.bodyHidden === true, 'A8 用户手动合上含未读的组＝听用户的，且这个开合态活过一次重绘（只写 DOM class 就被收回）', JSON.stringify({ hit: c1.hit, key: c1.key, c: fu2.openCls, h: fu2.bodyHidden }));
const c2 = await clickFoldOf(p, 'mail-in-list', 'au');
await p.waitForTimeout(200);
d = await dump(p);
const fu3 = d.in.folds.find((f) => f.ids.includes('au')) || { openCls: 'NO-FOLD', aria: 'NO-FOLD' };
ok(c2.hit && fu3.openCls === true && fu3.aria === 'true', 'A8b 再点＝打开（开合是同一个开关，aria-expanded 跟着走）', JSON.stringify({ hit: c2.hit, c: fu3.openCls, a: fu3.aria }));
ok(d.in.hiddenUnread === 0, 'A6c 重新打开后依旧没有任何未读被藏起来', 'hidden=' + d.in.hiddenUnread);

// A9 收／寄两侧独立
await tab(p, 'out');
d = await dump(p);
ok(d.out.folds.length >= 2, 'A9a 寄出的信同样按月份折叠（作者原话「联系人和我写信太多」＝两侧都要收住）', JSON.stringify(d.out.folds.map((f) => f.key + '|' + f.count)));
ok(d.out.folds.length > 0 && d.out.folds.every((f) => f.key.indexOf('out|') === 0 && !f.openCls), 'A9b 两侧开合态互不顶掉（in 侧展开过的同一个月不许把 out 侧也带开）', JSON.stringify(d.out.folds.map((f) => f.key + ':' + f.openCls)));
await tab(p, 'in');

// A10 月份新→旧 ／ A11 一封都不吞
d = await dump(p);
const mk = d.in.folds.map((f) => f.key.split('|')[1]);
ok(mk.length >= 2 && mk.join(',').localeCompare(mk.slice().sort().reverse().join(',')) === 0, 'A10 月份条按新→旧排（最近的月在最上面）', JSON.stringify(mk));
const L2 = mkLetters();
ok(d.in.total === L2.filter((x) => x.type === 'received').length && d.out.total === L2.filter((x) => x.type === 'sent').length, 'A11a 一封都不许折丢（折叠＝看不见，不是没渲染）', 'in=' + d.in.total + ' out=' + d.out.total);
ok(d.in.dup === 0 && d.out.dup === 0, 'A11b 一封信只落一个桶（未读不再抽走，也就不会在两处各冒一次）', 'dupIn=' + d.in.dup + ' dupOut=' + d.out.dup);

// ===== B 组 旧契约不许动 =====
const wkOrder = d.in.flat.filter((r) => ['wa', 'wb'].includes(r.id)).map((r) => r.id);
ok(wkOrder.join(',') === 'wa,wb', 'B1 本周区内仍按时间倒序（分组不许把顺序打乱）', JSON.stringify(wkOrder));
await seed(p, []);
d = await dump(p);
const emptyTxt = await p.evaluate(() => (document.getElementById('mail-in-list') || {}).textContent || '');
ok(d.in.total === 0 && /还没有收到信/.test(emptyTxt), 'B2 空库照旧如实宣告空态（#1309/#1358 那两把尺的口径没被分组改写弄坏）', JSON.stringify({ t: d.in.total, txt: emptyTxt.slice(0, 24) }));
await seed(p, mkLetters());

// B3 点开列表里的信（红侧点在平铺行；绿侧点开 b1 那一组里的行——委托不许被月份条抢掉）
const c3 = await clickFoldOf(p, 'mail-in-list', 'b1');
await p.waitForTimeout(250);
const openedIds = await p.evaluate(() => Array.from(document.querySelectorAll('.mail-fold.open .mail-item')).map((n) => n.dataset.id));
ok(c3.hit && openedIds.length > 0, 'B3a 组内信件在屏上（本批结构面＝红侧根本没有可展开的组，这一发红侧必红；开信靶子由 B3 两侧同分）', JSON.stringify({ hit: c3.hit, ids: openedIds }));
const targetId = openedIds.length ? openedIds[0] : await p.evaluate(() => { const n = Array.from(document.querySelectorAll('.mail-item')).find((x) => x.offsetParent || x.getClientRects().length); return n ? n.dataset.id : ''; });
await p.evaluate((id) => { const n = document.querySelector('.mail-item[data-id="' + id + '"]'); if (n) n.click(); }, targetId);
await p.waitForTimeout(500);
const letterOpen = await p.evaluate(() => { const tc = document.getElementById('tc-mask'); return { shown: !!tc && !tc.hidden, txt: tc ? String(tc.textContent || '').slice(0, 18) : '' }; });
ok(letterOpen.shown, 'B3 点开一封信仍走开信弹层（两侧同分＝旧契约：绿侧点的是刚展开那一组里的行，红侧点的是平铺行）', JSON.stringify({ targetId, shown: letterOpen.shown, txt: letterOpen.txt }));
await p.evaluate(() => { const tc = document.getElementById('tc-mask'); if (tc) tc.hidden = true; });
await p.waitForTimeout(200);

// B4 读过一封未读之后：徽标跟着掉、看得见的未读少一封
const beforeBadge = badgeN(await dump(p));
await p.evaluate(() => { const n = document.querySelector('.mail-item[data-id="au"]'); if (n) n.click(); });
await p.waitForTimeout(500);
await p.evaluate(() => { const tc = document.getElementById('tc-mask'); if (tc) tc.hidden = true; });
await openMail(p);
d = await dump(p);
ok(beforeBadge === 2 && badgeN(d) === 1 && d.in.visibleUnread.join(',') === 'wc', 'B4 读过更早那月的未读之后：徽标 2→1、看得见的未读只剩 wc', 'before=' + beforeBadge + ' after=' + badgeN(d) + ' vis=' + JSON.stringify(d.in.visibleUnread));
ok(d.in.hiddenUnread === 0, 'B4b 读过之后依旧没有任何未读被藏起来', 'hidden=' + d.in.hiddenUnread);
const storeN = await p.evaluate(() => JSON.parse(window.xyStore('xy-home-v2:default').get('mail-letters')).filter((x) => x.type === 'received').length);
ok(d.in.total === storeN, 'B5 列表条数＝库内该侧封数（红米 K80 那条 innerHTML 重试的判据面）', 'got=' + d.in.total + ' store=' + storeN);

// B6 整箱都是本周：不该出现任何分组标题
await seed(p, [L('z1', 'received', weekStart() + 1000, true), L('z2', 'received', weekStart() + 2000, true)]);
d = await dump(p);
ok(d.in.folds.length === 0 && d.in.labels.length === 0 && d.in.total === 2, 'B6 整箱都是本周的信＝不加任何分组标题（新鲜用户不该先看见两层壳）', JSON.stringify({ f: d.in.folds.length, l: d.in.labels, t: d.in.total }));

// B7 tab 切换（#93 旧契约）
await tab(p, 'out');
const panelOut = await p.evaluate(() => { const x = document.querySelector('[data-mpanel="out"]'); return x && !x.hidden ? 'OK' : 'PANEL-HIDDEN'; });
ok(panelOut === 'OK', 'B7 tab 切换照旧（#93 那支针管的行为面）', panelOut);

// ===== S 组 产物静态锚（本批代码真在产物里；JS 已外置＝判 js/mail.js，index.html 里只有 CSS） =====
const mailJs = readFileSync(join(root, 'js/mail.js'), 'utf8');
const cssOut = readFileSync(join(root, 'index.html'), 'utf8');
const anchors = [
  ["function mailIsUnread(l) { return l.type === 'received' && !l.read && !l.myReply; }", '未读判定只有一个写入方'],
  ["const open = (foldKey in mailFoldOpen) ? !!mailFoldOpen[foldKey] : (unreadN > 0);", '含未读的组默认展开、用户手动开合优先（#1417 之后守「红点亮着也看得见」的一条）'],
  ["const un = (dir === 'in' && mailIsUnread(l)) ? 1 : 0;", '未读跟着自己的时间落进本周／月份组（不再抽进常驻区）'],
  ["'<span class=\"mail-fold-unread\">' + unreadN + ' 封未读</span>'", '组标题挂未读封数'],
  ['if (tm && tm >= wkStart) { week.push(l); return; }', '本周平铺、更早才按月归组（#1416 起这一行前面多问一句「带没带 tm」，锚收到分支本体）'],
  ['const dow = (d.getDay() + 6) % 7;', '周界＝本周一 00:00 的自然周'],
  ['mailFoldOpen[key] = open;', '折叠态存模块级 map'],
  ["const open = !sec.classList.contains('open');", '开合态问 DOM 要当前值（含未读的组默认开着，第一次点击也点得动）'],
];
anchors.forEach(([n, label]) => ok(mailJs.indexOf(n) >= 0, 'S 产物锚 js/mail.js：' + label, 'needle=' + n));
ok(mailJs.indexOf('pin.push(l)') < 0, 'S3 删除型：旧「未读抽进常驻区」那一支不得回流（回流＝作者说的「非常乱」在原地复活）', 'pin.push 又出现了');
ok(cssOut.indexOf('.mail-fold:not(.open) > .mail-fold-body { display:none; }') >= 0, 'S 产物锚 index.html：折叠条收起时盖住正文那条规则在位', '');
ok(cssOut.indexOf('.mail-fold-unread { font-size:10px;') >= 0, 'S 产物锚 index.html：组标题未读数那枚样式在位', '');

ok(errs.length === 0, 'Z 全程零未捕获 JS 异常', JSON.stringify(errs.slice(0, 3)));

console.log('\n#1402 信箱按时间分组：' + pass + ' 通过 / ' + fail + ' 失败');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
// ===== 常驻回归脚本 #1406：朋友圈「本周＋按月」翻页折叠 ＋ 长信折叠 =====
// 用法：node build.mjs && node tools/verify-1406-feed-range-fold.mjs [被测根目录]（或 MOCHI_ROOT=…）
//   ⚠ 必须伺服**整目录**：js 已外置成 js/*.js，只递 index.html 会让 feed.js 缺席＝整组假红。
//
// 现场（作者 2026-09-29 直派：「朋友圈功能里当联系人和我写信太多，会显得的非常杂，还能怎么优化？需要打开
//   滑动翻页只显示本周朋友圈，其他时间的信都按月份折叠起来。需要手动去切换」）：
//   列表此前没有任何时间断点——feed.js 只把最新 200 条按 ts 倒序平铺进一根无限长滚动，每张卡片只在角落
//   写「X月X日 HH:MM」，几百字＋配图的长信整屏铺开＝「杂」的实感（与机型无关＝零机型／零 UA 分支）。
// 改法（判据只取 ts 与正文行数/字数）：分桶＝本自然周（周一起）＋每个往月一页，一条动态恰好属于一个桶；
//   顶部 .feed-range-bar 胶囊条只画选中的那一页，胶囊与 ‹ › 手动切，横向滚动只发生在胶囊自己那一条里
//   （列表区保持纯纵向滚动＝不与安卓上下滑打架，这是作者挑的那一档）；正文超 6 行／120 字收成 6 行，
//   「展开全文」就地放开，配图区与评论区是 .feed-body 的兄弟节点、不跟着裁。
// 判别力口径：红侧＝没有本批的纯底本副本——翻页条整个不存在（S 组）、长信整屏铺开（L 组）、点往月通知
//   与回忆卡找不到节点（J 组）＝读数逐字就是症状本体。每支断言都写成「读得到就判、读不到就报缺席」，
//   不留「脚本一崩就没读数」的空档。
// 断言 33 条：F1 夹具诚实 · S1~S12 分桶与翻页（含单页不画条、换页复位、200 条窗口）· S13~S17 本周为空
//   那一档与翻页条钉住 · L1~L5 长文折叠 · J1~J4 跨页定位 · R1~R3 旧契约不许动 · Z1~Z3 三个场景各量零异常
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.MOCHI_ROOT || process.env.SERVE_ROOT || here));
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
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + JSON.stringify(x).slice(0, 320) + ']' : '')); } };

// ---- 种子：Node 侧算好每一条的 ts，期望分桶在 Node 侧独立复算一遍＝不拿被测代码当尺子 ----
const DAY = 86400000;
const NOW = Date.now();
const SMALL_IMG = 'data:image/png;base64,' + 'QUJD'.repeat(120); // 502B＜1024＝不进媒体池，保持内联
const LONG_TEXT = Array.from({ length: 9 }, (_, i) => '第' + (i + 1) + '段 这一封信很长，写了九段每一段都占一行').join(String.fromCharCode(10));
const mk = (id, ts, content, extra) => Object.assign({
  id: id, role: 'ta', owner: 'default', authorName: '小桃', taName: '小桃', authorAv: '', taAv: '',
  content: content, imgs: [], stickers: [], comments: [], likes: [], ts: ts
}, extra || {});
// 重月那一档锚在正午、只往回摊 210 分钟＝不管跑测几点都不会跨过日界／月界
const heavyNoon = new Date(NOW - 40 * DAY); heavyNoon.setHours(12, 0, 0, 0);
const lastYear = new Date(NOW); lastYear.setFullYear(lastYear.getFullYear() - 1);
const POSTS = [];
POSTS.push(mk('wk_a', NOW - 60000, '本周第一条 短动态'));
POSTS.push(mk('wk_long', NOW - 120000, LONG_TEXT, { role: 'me', authorName: '我', imgs: [SMALL_IMG],
  comments: [{ role: 'me', owner: 'me', authorName: '我', authorAv: '', content: '这一条评论在折叠区外面，不该被折掉', ts: NOW - 110000, replies: [] }] }));
POSTS.push(mk('wk_b', NOW - 180000, '本周第二条 短动态'));
for (let i = 0; i < 210; i++) POSTS.push(mk('mm_' + i, heavyNoon.getTime() - i * 60000, '重月第' + i + '条'));
POSTS.push(mk('ms_1', NOW - 70 * DAY, '更早那个月的动态一'));
POSTS.push(mk('ms_2', NOW - 71 * DAY, '更早那个月的动态二'));
POSTS.push(mk('mem_1', lastYear.getTime(), '去年今天写下的那条'));

// 期望分页（与站内同一口径：本自然周从周一 00:00 起，其余按「年-月」）
const weekStartOf = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const monthKeyOf = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1); };
const WEEK_START = weekStartOf(NOW);
const EXPECT = { week: [] };
POSTS.forEach(p => {
  if (p.ts >= WEEK_START) { EXPECT.week.push(p.id); return; }
  const k = monthKeyOf(p.ts);
  (EXPECT[k] = EXPECT[k] || []).push(p.id);
});
const PAGE_KEYS = Object.keys(EXPECT).sort((a, b) => {
  if (a === 'week') return -1;
  if (b === 'week') return 1;
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return (pb[0] - pa[0]) || (pb[1] - pa[1]);
});
const HEAVY = PAGE_KEYS.find(k => k !== 'week' && EXPECT[k].length > 200);
const NOTICES = [{ type: 'comment', pid: 'mm_5', text: '小桃 评论了你的动态', ts: NOW - 40 * DAY, read: false, owner: 'default' }];
const sorted = a => (a || []).slice().sort();
const same = (a, b) => sorted(a).join(',') === sorted(b).join(',');

// ---- 起一场会话：装种子 → 收开屏 → 进朋友圈 ----
async function session(posts, notices) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  ctx.on('page', p => {
    p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    p.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 160)); });
  });
  await ctx.addInitScript((data) => {
    // init 脚本每个文档都跑一遍，about:blank 这类不透明源读 localStorage 直接 SecurityError＝Z 组假红
    try {
      if (localStorage.getItem('__v1406seed') === '1') return;
      localStorage.clear();
      localStorage.setItem('__v1406seed', '1');
      localStorage.setItem('xy-home-v2:feed-posts', JSON.stringify(data.posts));
      localStorage.setItem('xy-home-v2:feed-notices', JSON.stringify(data.notices));
      // 关 TA 自动发帖并把调度推后一小时——跑测这几秒里不许凭空多出一条，条数期望才站得住
      var S = 'xy-home-v2:default:';
      localStorage.setItem(S + 'reply-fd-post-en', '0');
      localStorage.setItem(S + 'feed-next', String(Date.now() + 3600000));
    } catch (e) {}
  }, { posts, notices });
  const page = await ctx.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    document.querySelectorAll('.splash,.splash-notice,.ver-update-bar,.backup-remind-bar').forEach(n => { n.classList.add('hide'); n.style.display = 'none'; });
    const s = document.querySelector('.splash'); if (s) s.remove();
    const mm = document.getElementById('modal-mask'); if (mm) { mm.hidden = true; mm.style.display = 'none'; }
  });
  await page.waitForTimeout(600);
  const entered = await page.evaluate(() => { const el = document.querySelector('.app[data-app="feed"]'); if (!el) return false; el.click(); return true; });
  await page.waitForTimeout(1200);
  return { browser, ctx, page, errs, entered };
}

// ---- 页面侧读数（读不到就返回缺席标记，不许让断言因取数失败而没读数）----
const readBar = page => page.evaluate(() => {
  const bar = document.getElementById('feed-range-bar');
  const listEl = document.getElementById('feed-list');
  if (!bar || !listEl) return { has: false, bar: !!bar, list: !!listEl };
  const navs = {};
  [].slice.call(bar.querySelectorAll('.feed-range-nav')).forEach(n => { navs[n.getAttribute('data-range-nav')] = !!n.disabled; });
  return {
    has: true, hidden: !!bar.hidden, beforeList: !!(bar.compareDocumentPosition(listEl) & 4),
    pills: [].slice.call(bar.querySelectorAll('.feed-range-pill')).map(p => ({ k: p.getAttribute('data-range'), on: p.classList.contains('on') })),
    navs, count: bar.querySelectorAll('.feed-range-pill').length
  };
});
const readCards = page => page.evaluate(() => [].slice.call(document.querySelectorAll('#feed-list .feed-post'))
  .map(n => n.id.slice('feed-post-'.length)));
// 把本页剩下的动态全接出来（重月 210 条要先走完 200 窗口才谈得上「这一页等于那一档」）
const drainPage = page => page.evaluate(() => {
  let guard = 0;
  for (; guard < 30; guard++) {
    const b = document.querySelector('#feed-list .feed-more-btn');
    if (!b) break;
    b.click();
  }
  return { ids: [].slice.call(document.querySelectorAll('#feed-list .feed-post')).map(n => n.id.slice('feed-post-'.length)), clicks: guard };
});
const clickPill = (page, k) => page.evaluate((key) => {
  const p = document.querySelector('.feed-range-pill[data-range="' + key + '"]');
  if (!p) return false;
  p.click();
  return true;
}, k);
const activePill = page => page.evaluate(() => {
  const on = document.querySelector('.feed-range-pill.on');
  return on ? on.getAttribute('data-range') : null;
});

// ================= 主场景：本周＋多个往月 =================
{
  const { browser, page, errs, entered } = await session(POSTS, NOTICES);
  ok(entered, 'F1 夹具诚实：桌面【朋友圈】图标点得进去', { entered });

  const bar = await readBar(page);
  ok(bar.has && bar.hidden === false, 'S1 翻页条在位且没藏着（本周页与往月页共存时才该画出来）', bar);
  ok(bar.beforeList === true, 'S2 翻页条排在列表之前（切换入口在动态上面，不是垫在最底）', bar);
  ok(same(bar.pills && bar.pills.map(p => p.k), PAGE_KEYS), 'S3 胶囊正好是「本周＋有内容的那几个月」，从新到旧，不多一格不少一格',
    { got: bar.pills && bar.pills.map(p => p.k), want: PAGE_KEYS });

  const wkCards = await readCards(page);
  ok(same(wkCards, EXPECT.week), 'S4 默认打开就是本周页：只画本周那几条（往月一条都不许混进来）',
    { got: wkCards, want: EXPECT.week });
  ok(bar.pills && bar.pills[0] && bar.pills[0].on === true, 'S5 默认选中的胶囊是本周（on 态跟着默认页，不靠下标猜）', bar.pills && bar.pills[0]);
  ok(bar.navs && bar.navs.newer === true && bar.navs.older === false, 'S6 边界闸门：本周页「更新」置灰、还有更早时「更早」可点', bar.navs);

  // 逐页翻：每页只画自己那一份（重月先走完窗口再对数）
  const union = [];
  let pagesOk = true, badPage = null;
  for (const k of PAGE_KEYS) {
    if (!(await clickPill(page, k))) { pagesOk = false; badPage = { k, why: '胶囊点不到' }; break; }
    await page.waitForTimeout(120);
    const got = await drainPage(page);
    union.push(...got.ids);
    if (!same(got.ids, EXPECT[k])) {
      pagesOk = false;
      badPage = { k, got: got.ids.length, want: EXPECT[k].length, leaked: got.ids.filter(i => EXPECT[k].indexOf(i) < 0).slice(0, 6) };
      break;
    }
  }
  ok(pagesOk, 'S7 手动翻到每一页都只显示那一档的动态（含 210 条的重月被折成一页）', badPage);
  ok(pagesOk && new Set(union).size === POSTS.length && POSTS.every(p => union.indexOf(p.id) >= 0),
    'S8 各页并起来＝全部动态，一条不丢也不重复（本周与往月不重叠）', { union: new Set(union).size, seeded: POSTS.length });
  const lastNav = await readBar(page);
  ok(lastNav.navs && lastNav.navs.older === true, 'S9 翻到最早那一页时「更早」置灰（不许点出一个空页）', lastNav.navs);

  // 切页要回到顶
  await clickPill(page, PAGE_KEYS[0]);
  await page.waitForTimeout(200);
  const scrollBack = await page.evaluate(async () => {
    const sc = document.querySelector('#page-feed .cal-scroll');
    const listEl = document.getElementById('feed-list');
    if (!sc || !listEl) return { has: false };
    sc.scrollTop = 500;
    await new Promise(r => setTimeout(r, 60));
    const mid = sc.scrollTop;
    const pill = document.querySelector('.feed-range-pill:not(.on)');
    if (!pill) return { has: false, mid };
    pill.click();
    await new Promise(r => setTimeout(r, 250));
    return { has: true, mid, after: sc.scrollTop };
  });
  ok(scrollBack.has && scrollBack.mid > 0 && scrollBack.after === 0, 'S10 换页从本页第一行看起（不带着上一页的滚动深度）', scrollBack);

  // 长文折叠（wk_long 是九段长信，配图＋评论）
  await clickPill(page, 'week');
  await page.waitForTimeout(300);
  const clampBefore = await page.evaluate(() => {
    const card = document.getElementById('feed-post-wk_long');
    if (!card) return { has: false };
    const body = card.querySelector('.feed-body');
    const btn = card.querySelector('.feed-expand');
    const cmt = card.querySelector('.feed-comments');
    return {
      has: true, clamped: !!(body && body.classList.contains('feed-clamp')), btn: btn ? btn.textContent.trim() : null,
      h: body ? Math.round(body.getBoundingClientRect().height) : -1, sh: body ? body.scrollHeight : -1,
      imgsOutside: !!(card.querySelector('.feed-imgs') && !card.querySelector('.feed-body .feed-imgs')),
      cmtOutside: !!cmt && !card.querySelector('.feed-body .feed-comments'),
      cmtText: cmt ? cmt.textContent : ''
    };
  });
  ok(clampBefore.has && clampBefore.clamped === true && clampBefore.btn === '展开全文' && clampBefore.h > 0 && clampBefore.h < clampBefore.sh,
    'L1 长信收进 6 行（量得到高度差，按钮写着「展开全文」）', clampBefore);
  ok(clampBefore.imgsOutside === true && clampBefore.cmtOutside === true && clampBefore.cmtText.indexOf('不该被折掉') >= 0,
    'L2 配图区与评论区在折叠层之外：信收起来时图还在、评论读得到', clampBefore);
  const shortClean = await page.evaluate(() => {
    const card = document.getElementById('feed-post-wk_a');
    if (!card) return { has: false };
    const body = card.querySelector('.feed-body');
    return { has: true, hasBtn: !!card.querySelector('.feed-expand'),
      clamped: !!(body && body.classList.contains('feed-clamp')) };
  });
  ok(shortClean.has && shortClean.hasBtn === false && shortClean.clamped === false,
    'L3 短动态不画展开按钮也不收（不许把两行字也折起来）', shortClean);
  const expanded = await page.evaluate(() => {
    const card = document.getElementById('feed-post-wk_long');
    const btn = card && card.querySelector('.feed-expand');
    if (!btn) return { has: false };
    const before = card.querySelector('.feed-body').getBoundingClientRect().height;
    btn.click();
    const body = card.querySelector('.feed-body');
    return { has: true, clamped: body.classList.contains('feed-clamp'), opened: body.classList.contains('feed-open'),
      text: btn.textContent.trim(), before: Math.round(before), after: Math.round(body.getBoundingClientRect().height) };
  });
  ok(expanded.has && expanded.clamped === false && expanded.opened === true && expanded.text === '收起' && expanded.after > expanded.before,
    'L4 点「展开全文」就地放开（类去掉、文字改「收起」、高度真的变大，不重建卡片）', expanded);
  const collapsed = await page.evaluate(() => {
    const card = document.getElementById('feed-post-wk_long');
    const btn = card && card.querySelector('.feed-expand');
    if (!btn) return { has: false };
    btn.click();
    const body = card.querySelector('.feed-body');
    return { has: true, clamped: body.classList.contains('feed-clamp'), text: btn.textContent.trim() };
  });
  ok(collapsed.has && collapsed.clamped === true && collapsed.text === '展开全文',
    'L5 再点「收起」折回去（同一颗按钮来回切，不留半开状态）', collapsed);

  const sticky = await page.evaluate(async () => {
    const sc = document.querySelector('#page-feed .cal-scroll');
    const bar = document.getElementById('feed-range-bar');
    if (!sc || !bar) return { has: false };
    const before = Math.round(bar.getBoundingClientRect().top);
    const scTop = Math.round(sc.getBoundingClientRect().top);
    sc.scrollTop = 500;
    await new Promise(r => setTimeout(r, 120));
    const after = Math.round(bar.getBoundingClientRect().top);
    const scrolled = sc.scrollTop;
    sc.scrollTop = 0;
    return { has: true, before, scTop, after, scrolled };
  });
  // 判据不是「before==after」：本周页最顶压着封面，翻页条的自然位本来就在封面下方（before 是它没被钉住的
  // 那一档），滚下去之后它该钉在【滚动容器上沿】＝after≈scTop；不 sticky 的写法会跟着流走＝before-scrolled。
  ok(sticky.has && sticky.scrolled > 0 &&
    Math.abs(sticky.after - sticky.scTop) <= 2 &&
    sticky.after - (sticky.before - sticky.scrolled) > 2,
    'S17 翻页条滚下去仍钉在滚动容器上沿（跟着内容流走＝手动切页要先滚回顶）', sticky);

  // 「查看更早」必须在当前这一页里增量
  const heavyOk = !!HEAVY && await clickPill(page, HEAVY);
  await page.waitForTimeout(400);
  const moreA = await page.evaluate(() => ({
    n: document.querySelectorAll('#feed-list .feed-post').length,
    btn: (document.querySelector('#feed-list .feed-more-btn') || {}).textContent || null
  }));
  ok(heavyOk && moreA.n === 200 && !!moreA.btn && /还有\s*10\s*条/.test(moreA.btn),
    'R1 重月页仍守 200 条窗口，按钮尾数按本页算（不是全站尾数）', { ok: heavyOk, n: moreA.n, btn: moreA.btn });
  const moreB = await page.evaluate(() => {
    const b = document.querySelector('#feed-list .feed-more-btn');
    if (!b) return { has: false };
    b.click();
    const ids = [].slice.call(document.querySelectorAll('#feed-list .feed-post')).map(x => x.id.slice('feed-post-'.length));
    return { has: true, n: ids.length, stillBtn: !!document.querySelector('#feed-list .feed-more-btn'), ids: ids };
  });
  ok(moreB.has && moreB.n === (HEAVY ? EXPECT[HEAVY].length : -1) && moreB.stillBtn === false && same(moreB.ids, EXPECT[HEAVY]),
    'R2 点「查看更早」只把本页剩下的接上（别页一条也不许趁机挤进来）', { n: moreB.n, want: HEAVY ? EXPECT[HEAVY].length : -1, stillBtn: moreB.stillBtn });

  const liked = await page.evaluate(() => {
    const card = document.getElementById('feed-post-wk_b');
    const btn = card && card.querySelector('.feed-act[data-like]');
    if (!btn) return { has: false };
    btn.click();
    const fresh = document.getElementById('feed-post-wk_b');
    return { has: true, likedNow: !!(fresh && fresh.querySelector('.feed-act.liked')) };
  });
  ok(liked.has && liked.likedNow === true, 'R3 点赞照旧可用（局部刷新没被翻页改造打断：点一下那颗就变已赞）', liked);

  // 回忆闪回：卡只挂本周，点它要跨到去年那一月并定位
  await clickPill(page, 'week');
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => !!document.querySelector('#feed-list .feed-mem-card'))) === true,
    'J1 回忆闪回卡挂在本周页（默认那一页才给入口）');
  const memJump = await page.evaluate(() => {
    const card = document.querySelector('#feed-list .feed-mem-card');
    if (!card) return { has: false };
    card.click();
    const on = document.querySelector('.feed-range-pill.on');
    const target = document.querySelector('#feed-list [id="feed-post-mem_1"]');
    return { has: true, active: on ? on.getAttribute('data-range') : null, inDom: !!target, hl: !!(target && target.classList.contains('feed-hl')) };
  });
  ok(memJump.has && memJump.active === monthKeyOf(lastYear.getTime()) && memJump.inDom === true && memJump.hl === true,
    'J2 点回忆卡自动翻到那一年那一月并高亮那条（旧写法在本周页里根本找不到＝点了没反应）',
    { active: memJump.active, want: monthKeyOf(lastYear.getTime()), inDom: memJump.inDom, hl: memJump.hl });
  ok((await page.evaluate(() => !!document.querySelector('#feed-list .feed-mem-card'))) === false,
    'J3 闪回卡不跟着每个月重复画（翻到月份页就该收掉）');

  // 通知点旧动态：先切页再定位
  const noticeJump = await page.evaluate(async () => {
    const btn = document.getElementById('feed-notice-btn');
    if (!btn) return { has: false };
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    const item = document.querySelector('#feed-notice-list .feed-notice-item[data-pid="mm_5"]');
    if (!item) return { has: false, panelHidden: !!(document.getElementById('feed-notice-panel') || {}).hidden };
    item.click();
    await new Promise(r => setTimeout(r, 300));
    const on = document.querySelector('.feed-range-pill.on');
    // 只认主列表里那一份：全站同名节点可能有几份（「全部朋友圈」页平时也在后台被预渲染着）
    const target = document.querySelector('#feed-list [id="feed-post-mm_5"]');
    const flashed = document.querySelector('#feed-list .feed-post.feed-flash');
    return { has: true, active: on ? on.getAttribute('data-range') : null, inDom: !!target,
      flash: !!(target && target.classList.contains('feed-flash')), flashedIsTarget: flashed === target,
      dup: document.querySelectorAll('[id="feed-post-mm_5"]').length };
  });
  ok(noticeJump.has && noticeJump.active === HEAVY && noticeJump.inDom === true && noticeJump.flash === true && noticeJump.flashedIsTarget === true,
    'J4 点往月那条动态的通知＝自动切到那一页、点亮主列表里那一份（旧写法命中隐藏页的同名卡片＝闪了但用户看不见）', noticeJump);

  ok(errs.length === 0, 'Z1 全程零 JS 异常', errs.slice(0, 4));
  await page.close(); await browser.close();
}

// ================= 副场景：动态全落在本周（没有可翻的对象）=================
{
  const { browser, page, errs } = await session(POSTS.filter(p => p.ts >= WEEK_START), []);
  const cards = await readCards(page);
  ok(same(cards, EXPECT.week), 'S11 只有本周动态时列表照常被画出来（不是靠翻页条撑着才看得见）', { got: cards, want: EXPECT.week });
  const bar = await readBar(page);
  ok(bar.has === false || bar.hidden === true || bar.count === 0,
    'S12 只剩一页＝不画翻页条（不留一条只有「本周」的空骨架）', bar);
  ok(errs.length === 0, 'Z2 副场景零 JS 异常', errs.slice(0, 4));
  await page.close(); await browser.close();
}

// ================= 副场景：本周一条没有、更早的都在月份里（新用户/挂机几周）=================
{
  const { browser, page, errs } = await session(POSTS.filter(p => p.ts < WEEK_START), NOTICES);
  const cards = await readCards(page);
  const empty = await page.evaluate(() => {
    const e = document.querySelector('#feed-list .ta-empty');
    return { text: e ? e.textContent.replace(/\s+/g, '') : null, pills: [].slice.call(document.querySelectorAll('.feed-range-pill')).map(p => p.getAttribute('data-range')) };
  });
  ok(cards.length === 0, 'S13 本周没有动态时，默认那一页就是空的（不许把往月的混进来充数）', { n: cards.length });
  ok(!!empty.text && empty.text.indexOf('还没有动态') >= 0 && empty.text.indexOf('胶囊') >= 0,
    'S14 空那一页要说清楚「是本周空」并指得出路（说「还没有动态」＝谎，用户以为动态丢了）', empty);
  ok(empty.pills.length > 1, 'S15 这时候翻页条照常在（月份胶囊一个不少，用户点得到）', empty);
  // 从空本周点进有内容的那个月，动态要真的出来
  const jumped = await page.evaluate(async () => {
    const pill = document.querySelectorAll('.feed-range-pill')[1];
    if (!pill) return { has: false };
    pill.click();
    await new Promise(r => setTimeout(r, 250));
    return { has: true, k: pill.getAttribute('data-range'), n: document.querySelectorAll('#feed-list .feed-post').length };
  });
  ok(jumped.has && jumped.n > 0, 'S16 从空的本周页点月份胶囊＝真的翻出那一档的动态', jumped);
  ok(errs.length === 0, 'Z3 本周空场景零 JS 异常', errs.slice(0, 4));
  await page.close(); await browser.close();
}

console.log('\n#1406 朋友圈翻页折叠＝' + pass + ' 绿 / ' + fail + ' 红');
server.close();
process.exit(fail ? 1 : 0);

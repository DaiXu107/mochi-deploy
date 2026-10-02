// ===== 常驻回归：#1411 字卡库列表页「一页只许有一根滚动轴」（作者 2026-09-29 OPPO Reno6 5G/雨见 直派）=====
// 症状（原话）：「自定义字卡（公用专属字卡）只有字卡列表能翻动能翻动，其它地方翻动不了」
//   ＋「字卡库里所有页面内的翻动设计有问题，总是有页面跟随屏幕一起固定」＋「这个问题其他设备型号也有出现」。
// 根因（零机型／零 UA 分支，只问几何）：.page{overflow-y:auto} 里再放一个 .card-list{flex:1;overflow-y:auto}
//   ＝一页两根轴。头部（返回条＋tab＋两排工具条＋分组条＋搜索框＋说明）按内容把内层列表压成窄条，
//   而 .page 的 scrollHeight==clientHeight＝整页零滚动区间，于是屏上除那条窄列表外全都钉死。
//   报障机 360×663 实测（本尺子红侧读数）：cc 列表 148px / mc 6px / tm 84px / rc 103px，四页页面可滚区间全是 0。
//   base.css 那组 .card-list{overscroll-behavior:contain} 又掐断滚动链＝窄列表滚到底也接不上外层。
// 同族病此前修过两次、每次都按页面 id 补一条（#239→dc/fc/dk，#350→dict），漏了 cc/mc/tm/rc 四页所以再度报回来。
// 本批改口径不看 id 看类：.card-list 一律随内容自然生长，滚动只由 .page 承担——新增字卡页不必再登记 per-id 规则。
// 断言：
//   S 组＝锚（红侧必红）：S1 类级新默认在 src 与产物同时在位；S2 产物里旧默认（flex:1+overflow-y:auto）已绝迹；
//            S3 本批那一行零机型／零 UA 分支、且不依赖 :has()
//   A 组＝行为面（红侧必红；360×663 逐页 ×8 页 / 9 个入口，含自定义字卡的公用与专属两个作用域）：
//            1 列表自身不再是第二根轴（overflowY 非 auto/scroll 且自身可滚区间 0）
//            2 页面是唯一那根轴且有真滚动区间（>200）
//            3 第一条字卡可达（把列表顶对齐到页面顶，首条 .cc-item 必在页面框内）
//            4 一路滚到底后屏上仍是看得见的非空字卡（不是虚拟窗口的空白垫）
//            5 末条字卡可达——只判非虚拟窗口那四页（cc/mc/tm/rc；dc/dict/fc/dk 走 C 组口径）
//   B 组＝圈边界（两侧同过）：字卡库里 .gs-scroll 那族（头部只一枚返回条、列表拿到 472~600px＝没被挤窄）
//            与四处非字卡库设置页 .gs-scroll 未被本批波及。⚠ 若将来某批决定把这一族也整页滚，这几条会红＝
//            那是另一个口径决定，请连同本段与 WORKLOG 一起改，不要当误红掐掉。
//   C 组＝邻居回归（两侧同过）：预设字卡页虚拟窗口在新滚动容器下照常推进（default-cards.js 按「谁真在裁剪
//            内容」选容器，列表不再裁剪时走 .page）；四张虚拟页逐张判「跳到底并落定后屏上有真字卡」
//   F 组＝夹具诚实：两作用域的种子字卡真渲染进了列表（否则 A 组会因空列表假绿）
//   Z 组＝全程零未捕获 JS 异常
// 夹具注记：专属作用域必须用 addInitScript 在页面脚本之前把裸键写进 localStorage——chatcard.js 在模块初始化时
//   就把 store=window.activeStore() 捕获成常量，事后从外部再 new 一份同前缀 xyStore 写进去，它那份 memoryCache
//   看不见（同 verify-reset-via-activestore-not-localstorage 那条坑）。公用走 pubStore() 每次现取故无此问题。
// 用法：node tools/verify-1411-card-page-flat-scroll.mjs
//       MOCHI_SERVE_ROOT（或 SERVE_DIR）=产物目录 做红绿对照；缺省回退仓库根产物——对照时务必显式传。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = normalize(process.env.MOCHI_SERVE_ROOT || process.env.SERVE_DIR || (here + '/..'));
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
const base = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
function J(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && detail !== null && !ok ? '  [' + detail + ']' : ''));
}

// ---------- S 组：锚 ----------
const NEW_ANCHOR = '.card-list { flex:0 0 auto; overflow:visible; min-height:0; -webkit-overflow-scrolling:auto; overscroll-behavior:auto;';
const artifact = readFileSync(join(root, 'index.html'), 'utf8');
let cssSrc = '';
try { cssSrc = readFileSync(join(root, 'src', 'css', 'chat-pages.css'), 'utf8'); } catch (e) { /* 副本里可能没有 src */ }
J('S1 类级新默认在产物里在位（列表不自己成轴，交页面整根滚）', artifact.indexOf(NEW_ANCHOR) >= 0, '产物 0 命中');
if (cssSrc) J('S1b 同一条在 src/css/chat-pages.css 里在位', cssSrc.indexOf(NEW_ANCHOR) >= 0, 'src 0 命中');
// 旧默认（.card-list 自己是滚动容器）。带空格的选择器形态＝只数规则本身，避开模板注释里那串无空格引用
J('S2 产物里旧默认已绝迹（.card-list { flex:1; overflow-y:auto …）', (artifact.match(/\.card-list \{ flex:1; overflow-y:auto/g) || []).length === 0, '仍有 ' + (artifact.match(/\.card-list \{ flex:1; overflow-y:auto/g) || []).length + ' 处');
const myLine = cssSrc.split('\n').find((l) => l.startsWith('.card-list { flex:0 0 auto')) || '';
J('S3 本批那一行零机型／零 UA 分支且不靠 :has()', !!myLine && !/force-mobile|tablet|ios|android|:has\(/i.test(myLine), myLine.slice(0, 60) || '(没找到这一行)');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 663 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
// 种子：公用 40 条（xy-home-v2:cc-groups-public）／专属 30 条（xy-home-v2:default:cc-groups）——形状同 verify-cc-auto-slim.mjs
const SEED_SRC = (function () {
  const mk = (n, tag) => Array.from({ length: n }, (_, i) => ['组' + (Math.floor(i / 6) + 1), [tag + '第' + (i + 1) + '条']]);
  const shell = { kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
  return {
    'xy-home-v2:cc-groups-public': JSON.stringify(Object.assign({ text: mk(40, '公') }, shell)),
    'xy-home-v2:default:cc-groups': JSON.stringify(Object.assign({ text: mk(30, '专') }, shell))
  };
})();
await ctx.addInitScript({ content: 'try{' + Object.keys(SEED_SRC).map((k) => 'localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(SEED_SRC[k]) + ');').join('') + '}catch(e){}' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
await page.goto(base + '/index.html', { waitUntil: 'load' });
for (let i = 0; i < 80; i++) { if (await page.evaluate(() => !!window.__mochiDataReady).catch(() => false)) break; await page.waitForTimeout(200); }
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const s = document.getElementById('splash'); if (s) s.remove();
  document.querySelectorAll('.modal-mask,.toast').forEach((n) => n.remove());
  document.body.classList.remove('scroll-lock');
  try {
    const d = new Date();
    window.activeStore().set('cc-lowcard-remind', d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  } catch (e) {}
});
await page.waitForTimeout(300);

// 回 hub（应用自己的导航：字卡库入口都挂在 #page-chatcard 的 .chat-item 上）
async function toHub() {
  await page.evaluate(() => { document.querySelectorAll('.page').forEach((p) => (p.hidden = true)); const h = document.getElementById('page-chatcard'); if (h) h.hidden = false; });
  await page.waitForTimeout(150);
}
async function openBy(entryId, settle) {
  await toHub();
  const ok = await page.evaluate((id) => { const n = document.getElementById(id); if (!n) return false; n.click(); return true; }, entryId);
  if (!ok) return null;
  await page.waitForTimeout(settle || 900);
  await page.evaluate(() => { document.querySelectorAll('.modal-mask').forEach((n) => n.remove()); document.body.classList.remove('scroll-lock'); });
  return true;
}
// 静态读数（不滚）：谁是那根轴
function AT_TOP(listId) {
  var pg = null; document.querySelectorAll('.page').forEach(function (p) { if (!p.hidden && !pg) pg = p; });
  if (!pg) return { none: true };
  var li = document.getElementById(listId);
  var cs = li ? getComputedStyle(li) : null;
  return {
    pageId: pg.id, pageRange: pg.scrollHeight - pg.clientHeight, pageClient: pg.clientHeight,
    listH: li ? li.clientHeight : -1, listRange: li ? (li.scrollHeight - li.clientHeight) : -1,
    listOvf: cs ? cs.overflowY : '(缺)', listItems: li ? li.querySelectorAll('.cc-item').length : -1,
    vspace: li ? li.querySelectorAll('.cc-vspace').length : -1
  };
}
// 把列表顶对齐到页面顶 → 首条字卡必须在页面框内（可达）
function FIRST_REACHABLE(listId) {
  var pg = null; document.querySelectorAll('.page').forEach(function (p) { if (!p.hidden && !pg) pg = p; });
  var li = document.getElementById(listId); if (!pg || !li) return { none: true };
  var pr = pg.getBoundingClientRect();
  pg.scrollTop += (li.getBoundingClientRect().top - pr.top);
  var it = li.querySelector('.cc-item'); if (!it) return { noItem: true };
  var r = it.getBoundingClientRect();
  return { top: Math.round(r.top), prTop: Math.round(pr.top), prBottom: Math.round(pr.bottom), in: r.top >= pr.top - 1 && r.top < pr.bottom && r.height > 0 };
}
// 一路滚到底 → 落定后屏上仍要有非空字卡
function AT_BOTTOM(listId) {
  var pg = null; document.querySelectorAll('.page').forEach(function (p) { if (!p.hidden && !pg) pg = p; });
  var li = document.getElementById(listId); if (!pg || !li) return { none: true };
  pg.scrollTop = 99999;
  return { jumped: true };
}
function READ_AFTER_SETTLE(listId) {
  var pg = null; document.querySelectorAll('.page').forEach(function (p) { if (!p.hidden && !pg) pg = p; });
  var li = document.getElementById(listId); if (!pg || !li) return { none: true };
  var pr = pg.getBoundingClientRect();
  var its = li.querySelectorAll('.cc-item');
  var inView = 0, nonEmpty = 0;
  Array.prototype.forEach.call(its, function (it) {
    var r = it.getBoundingClientRect();
    if (r.height > 0 && r.bottom > pr.top && r.top < pr.bottom) { inView++; if ((it.textContent || '').trim().length > 0) nonEmpty++; }
  });
  var last = its.length ? its[its.length - 1] : null;
  var lr = last ? last.getBoundingClientRect() : null;
  return {
    scrollTop: pg.scrollTop, range: pg.scrollHeight - pg.clientHeight,
    atBottom: pg.scrollTop >= pg.scrollHeight - pg.clientHeight - 2,
    inView: inView, nonEmpty: nonEmpty, dom: its.length,
    lastVisible: lr ? (lr.top < pr.bottom && lr.bottom > pr.top && lr.height > 0) : false
  };
}

// 8 张 .card-list 页 / 9 个入口。virtual:true ＝走 default-cards.js 的 mountCardView（首尾 .cc-vspace 撑高）
const CARD_PAGES = [
  ['page-custom-cards', 'li-custom-cards-public', 'cc-list', '公用字卡', false],
  ['page-custom-cards', 'li-custom-cards', 'cc-list', '专属字卡', false],
  ['page-mood-cards', 'li-mood-cards', 'mc-list', '情绪字卡', false],
  ['page-ta-mood', 'li-ta-mood', 'tm-list', 'TA的心情', false],
  ['page-reply-cards', 'li-reply-cards', 'rc-list', '回应字卡', false],
  ['page-default-cards', 'li-default-cards', 'dc-list', '预设字卡', true],
  ['page-dict-cards', 'li-dict-cards', 'd2-dict-list', '词典字卡', true],
  ['page-fun-cards', 'li-fun-cards', 'fc-list', '互动功能字卡', true],
  ['page-deskcheck', 'li-deskcheck', 'dk-list', '查岗字卡', true]
];
const openedPages = {};
const itemsByTag = {};
for (const [pageId, entry, listId, tag, virtual] of CARD_PAGES) {
  if (!(await openBy(entry, virtual ? 1700 : 1000))) { J('A0 入口 ' + entry + ' 存在', false, 'hub 里找不到这枚入口'); continue; }
  const t = await page.evaluate(AT_TOP, listId);
  if (!t || t.none) { J('A0 ' + tag + ' 页面已打开', false, '无可见页'); continue; }
  openedPages[pageId] = 1;
  itemsByTag[tag] = t.listItems;
  J('A1/' + tag + ' 列表自身不再是第二根轴（overflowY=' + t.listOvf + ' 列表可滚区间=' + t.listRange + ' 列表高=' + t.listH + '）',
    t.pageId === pageId && (t.listOvf === 'visible' || t.listOvf === 'hidden') && t.listRange <= 2, JSON.stringify(t));
  J('A2/' + tag + ' 页面是唯一那根轴且有真滚动区间（区间=' + t.pageRange + '）', t.pageRange > 200, t.pageRange);
  const f = await page.evaluate(FIRST_REACHABLE, listId);
  J('A3/' + tag + ' 第一条字卡可达（首条 top=' + (f && f.top) + ' 页面框 ' + (f && f.prTop) + '~' + (f && f.prBottom) + '）', !!f && f.in === true, JSON.stringify(f));
  await page.evaluate(AT_BOTTOM, listId);
  await page.waitForTimeout(virtual ? 900 : 250);
  const b = await page.evaluate(READ_AFTER_SETTLE, listId);
  J('A4/' + tag + ' 滚到底落定后屏上仍是非空字卡（可见 ' + (b && b.inView) + ' 张／其中 ' + (b && b.nonEmpty) + ' 张有文字）', !!b && b.nonEmpty > 0, JSON.stringify(b));
  if (virtual) {
    J('A5/' + tag + ' 虚拟窗口页跳到底后 DOM 里只挂窗口（dom=' + (b && b.dom) + ' <1500）', !!b && b.dom > 0 && b.dom < 1500, b && b.dom);
  } else {
    J('A5/' + tag + ' 末条字卡真的滚到了可达（lastVisible=' + (b && b.lastVisible) + '）', !!b && b.lastVisible === true, JSON.stringify(b));
  }
}

// ---------- F 组：夹具诚实（直接取 A 组单次开页的快照；重复点同一枚入口会撞上字卡页自己的作用域缓存） ----------
J('F1 公用作用域 40 条种子真进了列表（读到 ' + itemsByTag['公用字卡'] + ' 张）', (itemsByTag['公用字卡'] || 0) >= 40, itemsByTag['公用字卡']);
J('F2 专属作用域 30 条种子真进了列表（读到 ' + itemsByTag['专属字卡'] + ' 张）', (itemsByTag['专属字卡'] || 0) >= 30, itemsByTag['专属字卡']);
J('F3 八张 .card-list 页全部走到（漏页＝A 组漏测）', Object.keys(openedPages).length >= 8, Object.keys(openedPages).join(','));

// ---------- B 组：圈边界（本批有意不动 .gs-scroll 那族） ----------
for (const [pageId, entry] of [['page-ta-ask', 'li-ta-ask-mine'], ['page-checkin-cards', 'li-checkin-cards-mine'], ['page-loc-cards', 'li-loc-cards']]) {
  if (!(await openBy(entry, 900))) { J('B0 入口 ' + entry + ' 存在', false); continue; }
  const g = await page.evaluate(() => {
    let pg = null; document.querySelectorAll('.page').forEach((p) => { if (!p.hidden && !pg) pg = p; });
    const sc = pg && pg.querySelector('.gs-scroll');
    if (!sc) return { none: true };
    const r = sc.getBoundingClientRect();
    return { pageId: pg.id, ovf: getComputedStyle(sc).overflowY, h: Math.round(r.height), avail: pg.clientHeight, range: sc.scrollHeight - sc.clientHeight };
  });
  J('B1/' + pageId.replace('page-', '') + ' 该族仍是「短头部＋列表自己滚」且列表没被挤窄（高 ' + (g && g.h) + '/可用 ' + (g && g.avail) + '）＝本批未越圈',
    !!g && g.ovf === 'auto' && g.h >= g.avail * 0.6, JSON.stringify(g));
}
for (const pid of ['page-call-settings', 'page-sfx-settings', 'page-fav-settings']) {
  await toHub();
  const ok = await page.evaluate((id) => {
    document.querySelectorAll('.page').forEach((p) => (p.hidden = true));
    const pg = document.getElementById(id); if (!pg) return null;
    pg.hidden = false;
    const sc = pg.querySelector('.gs-scroll'); if (!sc) return { none: true };
    return { ovf: getComputedStyle(sc).overflowY };
  }, pid);
  await page.waitForTimeout(250);
  J('B2/' + pid.replace('page-', '') + ' 非字卡库设置页的 .gs-scroll 未被本批波及（仍 auto）', !!ok && ok.ovf === 'auto', JSON.stringify(ok));
}

// ---------- C 组：虚拟窗口在 .page 这根轴上照常推进 ----------
await toHub();
if (await openBy('li-default-cards', 1800)) {
  const c1 = await page.evaluate(() => {
    const pg = document.getElementById('page-default-cards'), li = document.getElementById('dc-list');
    if (!pg || !li) return { none: true };
    return { dom0: li.querySelectorAll('.cc-item').length, vspace: li.querySelectorAll('.cc-vspace').length };
  });
  await page.evaluate(() => {
    const pg = document.getElementById('page-default-cards');
    pg.scrollTop = Math.round((pg.scrollHeight - pg.clientHeight) * 0.6);
  });
  await page.waitForTimeout(900);
  const c2 = await page.evaluate(() => {
    const pg = document.getElementById('page-default-cards'), li = document.getElementById('dc-list');
    const its = li.querySelectorAll('.cc-item');
    let inVp = 0;
    Array.prototype.forEach.call(its, (it) => { const r = it.getBoundingClientRect(); if (r.height > 0 && r.bottom > 0 && r.top < innerHeight && (it.textContent || '').trim()) inVp++; });
    return { dom: its.length, inVp: inVp, scrolled: pg.scrollTop };
  });
  J('C1 预设字卡页窗口在 .page 这根轴上照常推进（60% 处屏上有 ' + c2.inVp + ' 张真字卡）', c2.inVp > 3, JSON.stringify({ c1, c2 }));
  J('C2 虚拟窗口仍在（首尾占位块撑起总高、DOM 只挂窗口）', c1.vspace >= 1 && c2.dom > 0 && c2.dom < 2000, JSON.stringify({ vspace: c1.vspace, dom: c2.dom }));
  J('C3 滚过之后页面确实离开了顶部（scrollTop>1000）', c2.scrolled > 1000, c2.scrolled);
} else {
  J('C0 入口 li-default-cards 存在', false);
}

// ---------- Z 组 ----------
await toHub();
J('Z1 全程零未捕获 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '));

console.log('\n合计 ' + pass + ' 绿 / ' + fail + ' 红   （产物=' + root + '）');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);

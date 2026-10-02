// ===== 常驻回归脚本 #1390：媒体池那一格必须落在「有人读的那一侧」（备份导出/导入的落点错配） =====
// 用法：node tools/verify-1390-media-pool-storage-home.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-29 直派：「小米REDMI Note 15 pro/自带浏览器。导入数据备份后之前朋友圈发的表情包都没了。
//   导入的数据丢失朋友圈动态数据和图片。帮我修复，并且不要覆盖修改导致不同型号设备浏览器的 bug 反复出现。
//   这个问题其他设备型号也有出现。并且帮我检查所有导出数据和导出数据功能是否有异常」；
//   随附 mochi-diag-2026-09-27-15-55-0061459ed60000000002.docx：MiuiBrowser 20.28／Chrome 135／Android 16，
//   关键读数＝【能力】「媒体池条目：54 条」对【内存体检】「img 元素=126（data: 125／坏图 1）」，
//   最近错误里逐字躺着 `资源加载失败 <img> https://…/mochi/@@m:6bbea2957fd87e3ebe074a256b361e79`
//   ＝@@m: 令牌在池里解不出时被内核当相对 URL 发了一次真请求；【数据导入回执】=「无」而用户明说导入过）
//
// 根因（零机型／零 UA 分支＝只取「这一格按归属归哪个存储」这一个代码事实）：
//   媒体池按 #142 的归属是 **IndexedDB 独有**：media-pool.js 取池只走 window.idbGet/idbGetMany(FULL+h)，
//   全文没有一条按池键读 localStorage 的路；而 idb.js 的启动回填 idbRestore 又**显式跳过** media: 键
//   （「不回填——几百个图片键回填进 memoryCache/LS 等于把去重省下的内存加倍吃回去」）。
//   备份文件却纯按**体积**分栏：runExport 的 routeValue 把 ≤LS_SMALL_LIMIT(20KB) 的值写进 ls 段、
//   其余写进 idb 段。表情包/贴纸/小图正好是「小」那一族 ⇒ 它们整批被记进 ls 段。导入侧两跳都踩空：
//     ① doImportGo 照着 ls 段把值 setItem 回 localStorage＝写进一个没有任何人读的地方；
//     ② 该键出现在 data.ls 里会让 #118/#1359 的 retain 清单把它判成「备份已带、无需保留」，
//        而 idbReplaceAll 是单事务 clear＋批量 put ⇒ **本机原本还能正常显示的那条池记录被 clear 掉**。
//   合起来＝用户所见「导入备份之后之前发的表情包都没了」，而引用它的 @@m: 令牌原样留在 feed-posts／
//   chat-msgs 里 ⇒ 渲染只能报「图片缺失」，池核对跟着计 missing，内核还多发一次注定 404 的请求。
//   同一条不变量在同一份文件里被「仅聊天记录」那条通路守着（importChatAllGo 注释原文：「媒体池：静默写
//   IDB（@@m: 令牌解码），不写 LS（media-pool.js 只认 IDB）」），被「完整备份」这条通路破着——
//   所以「其他设备型号也有出现」：每台设备导完整备份都走同一条路，只是小池条目占比高的用户先中招。
//   同案此前三次各修了别的落点：#1359（retain 把「读不出」当「库里没有」）、#1363（≥1024 载荷进池、
//   主键只留令牌）、#1371（一次性迁移盲读＋删源）；**「池键被记进 ls 段」这一格三批都没碰过**。
//
// 收口（三处，全在 src/js/data-backup.js；只动「归属」那一维，体积那一维一字未改）：
//   ① LS 扫描：池键不按体积进小键段，一律交回下面的 IDB 权威读（lsBig 那一支）；
//   ② routeValue：池键一律走流式 idb 段（并剥掉 LS 侧可能残留的旧副本）；
//   ③ doImportGo：把备份 ls 段里的池键**搬进 idb 段**再走导入（顺序排在 scrubMediaPool 之后＝脏空串先被
//      丢掉），于是它进的是 idbReplaceAll 的 pairs＝和其余大键同一发原子事务，要么整包落成、要么原样
//      不动。①②修「今后生成的文件」，③救「用户手里已经那一份」——报障那台的备份文件早就是旧形状了，
//      只改导出侧等于让他再丢一次。非零才记 pool:from-ls=N 进 #1272 那条持久回执环。
//   ⚠ ③ 最初写成「事务之后的非原子 idbFalls 补一次 idbSet」，被本尺的写路推演否掉：retain 因为
//     lsKeySet 有这把键而不保它，clear 先删掉本机活条目，补写那一发返回 false 时图就真没了，收尾只剩
//     一句「N 项未能存入 IndexedDB」＝把数据丢在一句提示里。搬进段内才是正解。
//
// 断言（本批尺子的尺＝「这一格此刻在不在被读的那一侧」，不问机型）：
//   P 组 前提诚实（两侧皆绿）：P1 池值取路只认 idbGet(FULL+h)、无按池键读 LS 那一条；P2 idbRestore 确实跳过 media: 键；
//     P3 同文件那条「仅聊天记录」通路早就写对（本批据此对齐口径，不是新造判据）；P4 尺子本身量得出——
//     池在时核对 missing=0、把池摘掉就报 missing=1（先证明这把握尺能读出症状，再拿它量本批）
//   A 组 本批新契约（红侧读数＝症状本体）：A0 导入那一发真跑到终态（没跑到＝库里全是播种态，下面几支
//     一律不许发绿——本尺第一版就假绿在这一发上）／A1 导出件里小池条目落在 idb 段（红侧逐字＝躺在 ls 段、idb 段没有）／
//     A2 旧形状文件导入后那格在 IDB 里活着（红侧＝被 clear 掉了）／A3 导入后 LS 里不许有池键（红侧＝有，
//     且是唯一副本＝写进没人读的地方）／A4 导入后池核对 referenced≥1 且 missing=0（红侧＝missing=1＝那张
//     表情包解不出＝用户所见）／A5 本机导出→清干净→再导入这一整圈走完后图还能解出（红侧＝同一圈走下来就丢）／
//     A6 回执环记下 pool:from-ls（红侧逐字＝这一行根本没有，同案那张单【数据导入回执】为「无」的另一半来路）
//   B 组 没修过头（两侧皆绿）：B1 小的**非池**键仍进 ls 段（没把路由整体搬走）／B2 大池条目（>20KB）两侧本来就进 idb 段／
//     B3 chat-msgs 的「LS 段有、IDB 段无 ⇒ 兜底写 IDB」那一路没被池分支抢先／B4 备份不含的普通 IDB 键仍被
//     retain 保住（#118/#1359 语义没被削弱）／B5 备份不含的**另一条**池键也照常保住（本批没牵连其余池条目）／
//     B6 「只备份文字」档仍整本跳过媒体池（作者 2026-09-28 明选的产品口径，本批一字不动）
//   S 组 静态锚（红侧缺＝登记表要钉的那几行）　Z 组 全程零未捕获异常
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
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 被测产物（S 组锚点按被测根目录读，红侧自然缺）
const backupSrc = readFileSync(join(root, 'js/data-backup.js'), 'utf8');
const idbSrc = readFileSync(join(root, 'js/idb.js'), 'utf8');
const poolSrc = readFileSync(join(root, 'js/media-pool.js'), 'utf8');

// ===== 夹具：一条朋友圈动态引用一张「小」表情包（≤20KB＝旧路由会把它记进 ls 段那一档） =====
const TOK_HASH = 'c0ffee1390' + '0'.repeat(22);              // 32 位十六进制＝池令牌形状
const TOK = '@@m:' + TOK_HASH;
const POOL_KEY = 'xy-home-v2:media:' + TOK_HASH;
const POOL_VAL = 'data:image/png;base64,' + 'A'.repeat(1800); // 1.8KB：够格进池（≥1024）又够小（≤20480）
const POOL_BIG_KEY = 'xy-home-v2:media:' + 'b'.repeat(32);
const POOL_BIG_VAL = 'data:image/png;base64,' + 'B'.repeat(24000); // >20KB：两侧本来就该进 idb 段
const K_FEED = 'xy-home-v2:default:feed-posts';
const FEED_VAL = JSON.stringify([{ id: 'p1390', text: '看这张表情包 ' + TOK, imgs: [TOK], ts: Date.now() }]);
const K_SMALLPLAIN = 'xy-home-v2:mochi1390-small-plain';      // 小的非池键：B1 用它证「没把路由整体搬走」
const SMALLPLAIN_VAL = JSON.stringify({ a: 'x'.repeat(1200) });
const K_RETAIN = 'xy-home-v2:mochi1390-plain-not-in-backup';  // 备份不含、且不是池键：B4 量 retain
const K_POOL_OTHER = 'xy-home-v2:media:' + 'd'.repeat(32);    // 备份不含的另一条池条目：B5 量「没牵连其余」
const K_CHAT_LS = 'xy-home-v2:default:chat-msgs';
const CHAT_LS_VAL = JSON.stringify([{ from: 'me', text: 'B3 只有 ls 段带它', ts: Date.now() }]);

// 旧形状（＝HEAD 那台导出件的真实分栏：池键在 ls 段、feed 权威在 idb 段）——A2/A3/A4/A6 喂这一份
const OLD_SHAPE = JSON.stringify({
  version: '1.0', app: 'mochi-zika', exportTime: new Date().toISOString(),
  ls: {
    'xy-home-v2:theme-mode': 'dark',
    [POOL_KEY]: POOL_VAL,            // ← 本批判据的正主：被按体积误分栏的池条目
    [K_CHAT_LS]: CHAT_LS_VAL,        // B3：IDB 段没有 chat-msgs，走既有兜底那一路
  },
  idb: {
    [K_FEED]: FEED_VAL,              // 动态本体在（用户那句「朋友圈动态数据」＝这一格）
    'xy-home-v2:default:chat-meta': JSON.stringify({ n: 1, t: Date.now(), b: 10 }),
  },
});

async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 394, height: 806 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { jsErrors: [] };
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    try { localStorage.setItem('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
    // 媒体池自动体检（#450 那一路）会在就绪 20s 后弹「发现 N 张图片数据缺失」——红侧那台必弹
    // （missing=1 正是本批量），那张层会吃掉我要按的钮。本尺自己会直接调 mochiMediaCoverage，
    // 不需要它代劳，这里把它的免打扰窗推到一年（写 LS 那一发即被 xyStore.get 读到）。
    try { localStorage.setItem('xy-home-v2:media-auto-check', JSON.stringify({ t: Date.now(), missing: 0, snooze: Date.now() + 365 * 86400000 })); } catch (e) {}
    // 全站弹窗是**单例**（#modal-ok/#modal-mask 共用一张层）。#1250 引导层与池缺失体检层一旦开着，
    // 就会抢走我要按的那颗钮——两轮实测都栽在这。注意「开着再撤」是错的：storage-guide.js:76 的
    // 让路判据读的是 `mask.hidden`，我把 mask 藏起来＝恰好替它放行（它随即 showGuide 再开一次）。
    // 正确做法＝在窗口层面根本不让那两张层被打开，其余弹窗（范围选择／覆盖确认）照常走真路。
    (function guardOpenModal() {
      if (!window.openModal) { setTimeout(guardOpenModal, 30); return; }
      if (window.__mmGuard1390) return;
      const real = window.openModal;
      window.openModal = function (title) {
        const t2 = String(title || '');
        if (t2.indexOf('存储修复引导') >= 0 || t2.indexOf('图片数据缺失') >= 0) return { okText: function () {} };
        return real.apply(window, arguments);
      };
      window.__mmGuard1390 = true;
    })();
    setInterval(function () {
      try {
        const t = String((document.getElementById('modal-title') || {}).textContent || '');
        if (t.indexOf('存储修复引导') > -1 || t.indexOf('张图片数据缺失') > -1) {
          const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
          const c = document.getElementById('modal-cancel'); if (c && !c.hidden) c.click();
        }
      } catch (e) {}
    }, 400);
  });
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await page.evaluate(() => {
    try { if (window.idbSet) window.idbSet('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
    // 保存路径的两个原生入口在头less里会改变导出走的那一支；剥掉，逼它走 anchorDownload（本尺在那里挂钩子）
    try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {}
    try { window.showSaveFilePicker = undefined; } catch (e) {}
    window.__armed1390 = 1;
  });
  await page.waitForTimeout(700);
  return { browser, page, st };
}

// 原生库直读直写（绕开被测页的任何缓存与仿真＝「库里到底还有没有这一格」由内核说了算）
const rawPut = (page, pairs) => page.evaluate((ps) => new Promise((res) => {
  const db = indexedDB.open('mochi-db');
  db.onsuccess = () => {
    const tx = db.result.transaction('kv', 'readwrite');
    ps.forEach(([k, v]) => tx.objectStore('kv').put(v, k));
    tx.oncomplete = () => { db.result.close(); res(true); };
    tx.onerror = () => { db.result.close(); res(false); };
  };
  db.onerror = () => res(false);
}), pairs);
const rawGet = (page, key) => page.evaluate((k) => new Promise((res) => {
  const db = indexedDB.open('mochi-db');
  db.onsuccess = () => {
    const tx = db.result.transaction('kv', 'readonly');
    const rq = tx.objectStore('kv').get(k);
    rq.onsuccess = () => { const v = rq.result; db.result.close(); res(v === undefined ? null : v); };
    rq.onerror = () => { db.result.close(); res(null); };
  };
  db.onerror = () => res(false === true ? null : null);
}), key);
const rawDel = (page, keys) => page.evaluate((ks) => new Promise((res) => {
  const db = indexedDB.open('mochi-db');
  db.onsuccess = () => {
    const tx = db.result.transaction('kv', 'readwrite');
    ks.forEach((k) => tx.objectStore('kv').delete(k));
    tx.oncomplete = () => { db.result.close(); res(true); };
    tx.onerror = () => { db.result.close(); res(false); };
  };
  db.onerror = () => res(false);
}), keys);
const lsGet = (page, key) => page.evaluate((k) => { try { const v = localStorage.getItem(k); return v === null ? null : v; } catch (e) { return 'ERR'; } }, key);

// 应用自己的那把握尺（设置→查看存储→媒体池 核对用的就是它）：本批不另造判据
async function readCoverage(page) {
  await page.evaluate(() => {
    window.__cov1390 = null;
    try { window.mochiMediaCoverage().then((r) => { window.__cov1390 = r; }).catch((e) => { window.__cov1390 = { ok: false, reason: 'throw:' + e }; }); }
    catch (e) { window.__cov1390 = { ok: false, reason: 'no-api:' + e }; }
  });
  await page.waitForFunction(() => !!window.__cov1390, null, { timeout: 90000 }).catch(() => {});
  const r = await page.evaluate(() => window.__cov1390 || null);
  return r || { ok: false, reason: 'no-reading', referenced: -1, inPool: -1, missing: -1 };
}

// 收开屏：#splash-enter 起手是 hidden（template.html:395「请滑到底部后进入」），只点它等于什么都没做，
// 开屏那张 .splash-footcard 会一直压在 tabbar 上（实测命中读数 over="splash-footcard"）。
// 所以照 verify-1359:121-122 那两行一起做：能点就点，点不到就把 splash 本身收掉。
// 导入收尾是 location.reload()＝开屏会再来一次 ⇒ 每一发 UI 前都要收，不能只在 boot 收一次。
const dismissSplash = (page) => page.evaluate(() => {
  const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
  const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
  const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
});
// 每一发点按前先做命中测试：rect 非零 **且** elementFromPoint(中心) 落在这一行里，才真按。
// 上一版在这里吃了两次教训——先用 hidden 属性硬摆设置页（结果那一发按到了别页压着的用户卡，
// 弹出「修改昵称」），再之前被 #1250 引导层抢走点按。判据一律是「这一发真的落在这一格上」这个几何事实。
async function hitClick(page, sel) {
  let g = null;
  for (let t = 0; t < 4; t++) {
    g = await page.evaluate((s) => {
      const el = document.querySelector(s) || document.getElementById(s);
      if (!el) return { miss: 'no-el' };
      let n = el; while (n && n !== document.body) { if (n.hidden) n.hidden = false; n = n.parentElement; }
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return { w: Math.round(r.width), h: Math.round(r.height), cx: cx, cy: cy,
        in: !!(hit && (hit === el || el.contains(hit))), over: hit ? String(hit.id || hit.className).slice(0, 28) : 'none' };
    }, sel);
    if (g.miss) return { err: g.miss + '@' + sel };
    if (g.in && g.w > 1 && g.h > 1) { await page.mouse.click(g.cx, g.cy); return { ok: true }; }
    await sleep(350);
  }
  return { err: 'not-hittable@' + sel + ' ' + JSON.stringify(g) };
}
const dismissModal = (page) => page.evaluate(() => {
  const c = document.getElementById('modal-cancel'); if (c && !c.hidden) c.click();
  const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
});
// 走真入口：tabbar「设置」→ 通用 tab →（导出：#row-export｜导入：#row-import）→ 范围弹窗 → 投文件 → 覆盖确认
async function openSettingRow(page, rowId, modalTitle) {
  await page.evaluate(() => {
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    const t = document.getElementById('cc-toast'); if (t) t.textContent = '';
  });
  await dismissSplash(page); // 刷页之后开屏会回来，这一发不带它＝永远按不到 tabbar
  await page.waitForTimeout(300);
  let r = await hitClick(page, '.tabbar .tab[data-page="page-setting"]'); // tabs.js 认 dataset.page＝用户走的那一级
  if (r.err) return r;
  await page.waitForTimeout(500);
  r = await hitClick(page, '#set-tabs .them-tab[data-tab="basic"]');
  if (r.err) return r;
  await page.waitForTimeout(400);
  let stray = '';
  for (let t = 0; t < 3; t++) {
    r = await hitClick(page, rowId);
    if (r.err) return r;
    const got = await page.waitForFunction((mt) => String((document.getElementById('modal-title') || {}).textContent || '').indexOf(mt) === 0, modalTitle, { timeout: 12000 }).then(() => true).catch(() => false);
    if (got) return { ok: true };
    stray = await page.evaluate(() => String((document.getElementById('modal-title') || {}).textContent || '(无弹窗)').slice(0, 24));
    await dismissModal(page); // 挂着的层不是我要那张（引导层／体检层／抢位卡）——撤掉再来一发，别把这一发给错的层
    await sleep(400);
  }
  return { err: 'no-modal:' + stray };
}
const clickOk = async (page) => {
  const o = await page.evaluate(() => {
    const b = document.getElementById('mochi-modal-pick') || document.getElementById('modal-ok');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (!o) return false;
  await page.mouse.click(o.cx, o.cy);
  return true;
};

// 导出：从 URL.createObjectURL 那一发把成品 Blob 抓下来读成文本（真入口走到哪一步都只认这一发产物）
async function runExportCapture(page) {
  await page.evaluate(() => {
    window.__cap1390 = null;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) {
      try { if (!window.__cap1390 && b && b.text) b.text().then((t) => { window.__cap1390 = t; }).catch(() => {}); } catch (e) {}
      return real(b);
    };
  });
  const op = await openSettingRow(page, 'row-export', '选择导出范围');
  if (op.err) return { err: op.err };
  await clickOk(page); // 默认那颗胶囊＝完整备份
  // 保存那一级是真闸：navigator.share／showSaveFilePicker 被我剥掉后，runExport 会停在
  // 「备份已打包完成」那张确认层，**只有点「确定」才真的走 anchorDownload**（＝createObjectURL＝我能拿到 Blob）。
  // 不等它就取文件＝拿不到产物，所以这里边等边替用户点那一发，而不是放宽判据。
  let got = false;
  for (let i = 0; i < 240 && !got; i++) {
    got = await page.evaluate(() => !!window.__cap1390);
    if (got) break;
    const t = await page.evaluate(() => String((document.getElementById('modal-title') || {}).textContent || ''));
    if (t.indexOf('备份已打包完成') === 0) await clickOk(page);
    await sleep(500);
  }
  if (!got) return { err: 'no-captured-blob' };
  const txt = await page.evaluate(() => String(window.__cap1390 || ''));
  // 收尾：导出完成后那张「备份已打包完成」/结果 toast 留在屏上，撤干净再进下一发
  await page.evaluate(() => {
    const c = document.getElementById('modal-cancel'); if (c && !c.hidden) c.click();
    const o = document.getElementById('modal-ok'); if (o && !o.hidden) o.click();
  }).catch(() => {});
  await sleep(300);
  let parsed = null;
  try { parsed = JSON.parse(txt); } catch (e) { return { err: 'bad-json:' + String(e).slice(0, 60) }; }
  return { text: txt, data: parsed };
}

async function runImport(page, fileText, fileName) {
  await page.evaluate(() => { window.__armed1390 = 1; });
  const op = await openSettingRow(page, 'row-import', '选择导入范围');
  if (op.err) return { err: op.err };
  if (!await clickOk(page)) return { err: 'no-range-button' }; // 完整备份那一档（默认胶囊）
  let chooser = null;
  for (let t = 0; t < 3 && !chooser; t++) {
    const fc = page.waitForEvent('filechooser', { timeout: 9000 }).catch(() => null);
    await clickOk(page); // 选图门那一族的补装有时赶不上第一发点按（#1323/#1348 同条事实）——重投而不是放宽判据
    chooser = await fc;
    if (!chooser) await sleep(500);
  }
  if (!chooser) {
    const why = await page.evaluate(() => String((document.getElementById('modal-title') || {}).textContent || '(无弹窗)').slice(0, 24));
    return { err: 'no-chooser@' + why };
  }
  await chooser.setFiles({ name: fileName, mimeType: 'application/json', buffer: Buffer.from(fileText, 'utf8') });
  await page.waitForTimeout(1800);
  const preview = await page.evaluate(() => String((document.getElementById('modal-title') || {}).textContent || ''));
  if (preview.indexOf('确定导入数据') !== 0) return { err: 'no-preview:' + preview.slice(0, 24) };
  await clickOk(page);
  // 终态信号＝那一发真的刷了页（doImportGo 收尾是 location.reload）；没刷＝中途停了，读数一律不作数
  const reloaded = await page.waitForFunction(() => window.__armed1390 === undefined, null, { timeout: 90000 }).then(() => true).catch(() => false);
  if (reloaded) await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return { ok: true, reloaded };
}
const readLog = (page) => page.evaluate(() => {
  try { return String(localStorage.getItem('xy-home-v2:__import-log') || ''); } catch (e) { return ''; }
});

// ===== 播种：本机原本「朋友圈一条动态 + 它的表情包都能正常显示」 =====
const { browser, page, st } = await boot();
try {
  await rawPut(page, [
    [POOL_KEY, POOL_VAL],
    [POOL_BIG_KEY, POOL_BIG_VAL],
    [K_POOL_OTHER, 'data:image/png;base64,' + 'C'.repeat(1500)],
    [K_FEED, FEED_VAL],
    [K_SMALLPLAIN, SMALLPLAIN_VAL],
    [K_RETAIN, JSON.stringify({ hi: 1 })],
  ]);
} catch (e) { console.log('  ! 播种失败：' + e); }

console.log('\n[P] 前提诚实（两侧皆绿＝这把尺子的刻度是真的）');
ok(/window\.idbGet\(FULL \+ h/.test(poolSrc) && !/localStorage\.getItem\(FULL/.test(poolSrc),
  'P1 池值取路只认 idbGet(FULL+h)，没有一条按池键读 localStorage 的路（本批判据的第一半）');
ok(idbSrc.includes("k.indexOf(uidPrefix + 'media:') !== 0"),
  'P2 idbRestore 确实跳过 media: 键（落错侧就没人搬回来＝本批判据的第二半）');
ok(/mediaKeys\.forEach/.test(backupSrc) && backupSrc.includes('window.idbSet(k, raw.v)'),
  'P3 「仅聊天记录」那条通路早就把池静默写 IDB（本批口径对齐它，不是新造判据）');

let covBase = { ok: false, referenced: -1, missing: -1 };
try { covBase = await readCoverage(page); } catch (e) { covBase = { ok: false, reason: 'throw', referenced: -1, missing: -1 }; }
ok(covBase.ok === true && covBase.referenced >= 1 && covBase.missing === 0,
  'P4a 播种态下池核对读出 referenced≥1 且 missing=0（那张贴图此刻确实能解出来）', JSON.stringify(covBase));
await rawDel(page, [POOL_KEY]);
let covNeg = { ok: false, referenced: -1, missing: -1 };
try { covNeg = await readCoverage(page); } catch (e) { covNeg = { ok: false, reason: 'throw', referenced: -1, missing: -1 }; }
ok(covNeg.ok === true && covNeg.missing === 1,
  'P4b 把那条池摘掉，核对就报 missing=1（先证明这把握尺量得出「表情包丢了」）', JSON.stringify(covNeg));
await rawPut(page, [[POOL_KEY, POOL_VAL]]);

console.log('\n[A1/B1/B2] 导出：那一格落在哪一栏');
const exp = await runExportCapture(page);
if (exp.err) console.log('  ! 导出这一发没跑完：' + exp.err + '（下面 A1/B1/B2 直接计红，不让它假绿）');
const els = (exp.data && exp.data.ls) || {};
const eid = (exp.data && exp.data.idb) || {};
const poolInSection = { ls: els[POOL_KEY] !== undefined, idb: eid[POOL_KEY] !== undefined };
ok(exp.data && poolInSection.idb && !poolInSection.ls,
  'A1 导出件把小的池条目放在 idb 段（红侧逐字＝它在 ls 段、idb 段没有）', JSON.stringify(poolInSection));
ok(exp.data && els[K_SMALLPLAIN] !== undefined && eid[K_SMALLPLAIN] === undefined,
  'B1 小的**非池**键仍进 ls 段（没把「按体积分栏」整条搬走——B 组两侧皆绿＝没修过头）',
  exp.data ? 'ls=' + (els[K_SMALLPLAIN] !== undefined) + ' idb=' + (eid[K_SMALLPLAIN] !== undefined) : 'no-file');
ok(exp.data && eid[POOL_BIG_KEY] !== undefined,
  'B2 大池条目（>20KB）本来就落在 idb 段', exp.data ? 'idb=' + (eid[POOL_BIG_KEY] !== undefined) : 'no-file');

console.log('\n[A2~A4,A6] 导入旧形状文件（池键在 ls 段＝用户手里那份的形状）');
// 先把本机恢复成「原本能正常显示」那一态（上面 P4b 摘过又补回来了），再喂这份文件
let imp1 = { err: 'skipped' };
try { imp1 = await runImport(page, OLD_SHAPE, 'mochi数据备份_1390_oldshape.json'); } catch (e) { imp1 = { err: 'throw:' + String(e).slice(0, 80) }; }
if (imp1.err) console.log('  ! 导入这一发没跑完：' + imp1.err + '（下面几支直接计红）');
const idbAfter = await rawGet(page, POOL_KEY).catch(() => null);
const lsAfter = await lsGet(page, POOL_KEY).catch(() => 'ERR');
const lsPlain = await lsGet(page, K_RETAIN).catch(() => 'ERR');
let covAfter = { ok: false, referenced: -1, missing: -1 };
try { covAfter = await readCoverage(page); } catch (e) { covAfter = { ok: false, reason: 'throw', referenced: -1, missing: -1 }; }
const logAfter = await readLog(page).catch(() => '');
const idbValSame = typeof idbAfter === 'string' && idbAfter.indexOf('data:') === 0 && idbAfter.length === POOL_VAL.length;
// 终态闸：这一发没真刷页＝库里全是播种态，下面几支会集体假绿（本尺实测踩过一次，就这么钉住）
ok(imp1.ok === true && imp1.reloaded === true,
  'A0 导入这一发跑到终态（页面刷了）——没跑到不给下面任何一支发绿', imp1.err || 'reloaded=' + imp1.reloaded);
const T1 = imp1.ok === true && imp1.reloaded === true;
ok(T1 && !!idbAfter, 'A2 导入后那一格在 IndexedDB 里活着（红侧逐字＝被 clear 掉了，本机原本还能显示的图没了）', 'idb=' + (idbAfter ? '有' : '无'));
ok(T1 && idbValSame, 'A2b 落回 IDB 的就是备份里那一份值（不是残留旧副本顶上的）', 'len=' + (typeof idbAfter === 'string' ? idbAfter.length : typeof idbAfter));
ok(T1 && lsAfter === null, 'A3 导入后 localStorage 里不该有池键（红侧逐字＝有，而且是唯一副本＝写进没人读的地方）', 'ls=' + (lsAfter === null ? 'null' : String(lsAfter).slice(0, 20)));
ok(T1 && covAfter.ok === true && covAfter.referenced >= 1 && covAfter.missing === 0,
  'A4 导入后池核对读出 missing=0（＝那条朋友圈表情包还解得出＝用户所见的那件事）', JSON.stringify(covAfter));
ok(T1 && /pool:from-ls=/.test(logAfter), 'A6 回执环记下 pool:from-ls（红侧逐字＝这一行根本没有）',
  logAfter ? 'len=' + logAfter.length : '空');

console.log('\n[B3/B4/B5] 没把别的东西碰坏（两侧皆绿）');
const idbChat = await rawGet(page, K_CHAT_LS).catch(() => null);
ok(!!idbChat, 'B3 chat-msgs「只有 ls 段带着 ⇒ 兜底写 IDB」那一路没被池分支抢先（既有 v3.26.x 语义）', 'chat=' + (idbChat ? '有' : '无'));
const idbRetain = await rawGet(page, K_RETAIN).catch(() => null);
ok(!!idbRetain && lsPlain === null, 'B4 备份不含的普通 IDB 键仍被 retain 保住，且它没被写进 LS（#118/#1359 语义未削弱）',
  'idb=' + (idbRetain ? '有' : '无') + ' ls=' + lsPlain);
const idbOtherPool = await rawGet(page, K_POOL_OTHER).catch(() => null);
ok(!!idbOtherPool, 'B5 备份不含的另一条池条目也照常保住（本批没牵连其余池条目）', 'other=' + (idbOtherPool ? '有' : '无'));
const textCfgNeedle = /MUSIC_KEY_RE\.test\(k\) \|\| MEDIA_POOL_KEY_RE\.test\(k\), strip: true/;
ok(textCfgNeedle.test(backupSrc),
  'B6 「只备份文字」档仍整本跳过媒体池＋strip 载荷（作者 2026-09-28 明选的产品口径，本批一字未动）');

console.log('\n[A5] 本机导出 → 清干净那两格 → 再导回来：整圈走完图还在（＝换机/清库重来那一型）');
// 拿本机导出的那一份真文件回灌：红侧它本身就是旧形状，所以这一圈走下来照样丢
try { await rawDel(page, [POOL_KEY, POOL_BIG_KEY, K_FEED]); } catch (e) {}
await page.evaluate(() => { try { localStorage.removeItem(POOL_KEY); localStorage.removeItem(K_FEED); } catch (e) {} }).catch(() => {});
let imp2 = { err: 'skipped' };
if (exp.text) {
  try { imp2 = await runImport(page, exp.text, 'mochi数据备份_1390_roundtrip.json'); } catch (e) { imp2 = { err: 'throw:' + String(e).slice(0, 80) }; }
} else console.log('  ! 没有可回灌的导出件（A5 计红）');
let covRt = { ok: false, referenced: -1, missing: -1 };
try { covRt = await readCoverage(page); } catch (e) { covRt = { ok: false, reason: 'throw', referenced: -1, missing: -1 }; }
const idbRtPool = await rawGet(page, POOL_KEY).catch(() => null);
ok(!imp2.err && covRt.ok === true && covRt.referenced >= 1 && covRt.missing === 0 && !!idbRtPool,
  'A5 自己导的那份文件回灌后，那条表情包仍在 IDB 且核对 missing=0（红侧＝同一圈走下来就丢）',
  (imp2.err ? imp2.err + ' ' : '') + JSON.stringify(covRt) + ' idb=' + (idbRtPool ? '有' : '无'));

console.log('\n[S] 静态锚（按**产物形态**写：js/data-backup.js 会剥注释，绿侧各命中 1／底本全 0，已实测）');
ok(backupSrc.includes('MEDIA_POOL_KEY_RE.test(k)) lsBig[k] = v'),
  'S1 LS 扫描把池键交给 IDB 权威读（体积那一维让给归属那一维·导出口①）');
ok(backupSrc.includes('MEDIA_POOL_KEY_RE.test(k)) {') && backupSrc.includes('catch (eSmall)'),
  'S2 routeValue 里池键无条件走流式 idb 段＋剥 LS 旧副本（导出口②）');
ok(backupSrc.includes('const lsPoolKeys = Object.keys'), 'S3 导入侧把 ls 段池键点名（导入口③）');
ok(backupSrc.includes('data.idb[k] = data.ls[k]') && backupSrc.includes('delete data.ls[k]'),
  'S4 搬进 idb 段＝让它进 idbReplaceAll 的 pairs 受原子事务保护（不是在事务外补写一次）');
ok(/impLog\('pool:from-ls=/.test(backupSrc), 'S5 非零才记的取证行（用户那份文件是不是旧形状，下次不用再猜）');

console.log('\n[Z] 全程零未捕获异常');
ok(st.jsErrors.length === 0, 'Z1 无未捕获异常（红侧那次「@@m: 当相对 URL」的内核错误不算 pageerror）', st.jsErrors.slice(0, 2).join(' | '));

console.log('\n结果：' + pass + ' 绿 / ' + fail + ' 红');
await browser.close().catch(() => {});
server.close();
process.exit(fail ? 1 : 0);

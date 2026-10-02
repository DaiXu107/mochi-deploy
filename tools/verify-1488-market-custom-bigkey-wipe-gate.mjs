// ===== 常驻回归脚本 #1488：心意市集自定义商品库（market-custom）的大键冷读闸——
//        「没读到」不许当「没有」，空读整包写回＝把库里整本商品顶掉
// 用法：node tools/verify-1488-market-custom-bigkey-wipe-gate.mjs [被测根目录]（首行打印被测根目录，防喂错产物）
//
// 现场（作者 2026-09-30 直派：iPhone 15（MTLY3LL/A）/iOS 18.6.2 Safari，添加心意市集物品、
//   刷新重新打开后消失；作者明说「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现」「这个问题
//   其他设备型号也有出现」。诊断单：LS 整域 4.85MB 近满、本页被系统回收 3 次、大键读回机制在位
//   ＝回收/切后台后 market-custom 同步读空是常态而不是意外。）
//
// 机制（判据零机型／零 UA，只取「这一格现在读不读得到」）：
//   market-custom 带图后 >200KB＝IDB-only 大键（xyStore.set 大键分支主动摘掉 LS 副本）。
//   冷启动回填未轮到／切后台被 #1195e 按体积放掉／iOS 回收重开时，同步读就是 null——
//   那是「没读到」不是「没有」；gift-shop 原先六个写点全拿空账整包写回：上传保存／编辑保存／
//   删除／导入／恢复默认／迁移与救援 ⇒ 库里整本被顶成空或只剩新一件，用户视角＝「上传的商品
//   刷新后全消失，再传一次还是消失」（顶库→读空→再顶库的死循环）。渲染侧同理：把「没读到」
//   画成「还没上传过商品」＝诱导重传。#1342/#1349/#1358/#1442/#1469 同族收口：写点全过
//   xyBigWriteBlocked（拦下＋请库＋人话提示），迁移/救援读不全不落笔不落标记；渲染空读显示
//   加载态并 whenBigKeyBack 补渲。
//
// 断言（两侧同一把尺串行跑；纯 HEAD 侧应当红的＝S1~S10、E2、E3、E4、P1，恰 14 条）：
//   S1~S10 产物逻辑锚（helper 声明＋六个写点闸＋渲染三件套＋两处诚实文案）
//   F1 种库自证：market-custom JSON >200KB（真大键，不是夹具编出来的）
//   F2 大键分支剥 LS 副本：种完 xy-home-v2:market-custom 不在 localStorage
//   F3/E0 健康对照：冷启动回填后 3 件种子商品照常可见（修法不破坏正常读写）
//   E1 切后台放掉后 awaitingBigKey=true（数据层事实，两侧同绿）
//   E2【症状本体】读空那一发保存不许顶库（库里 3 件种子，按整场最低读数判）
//   E3【症状本体】被按住那一发必须给「没读全」的人话提示
//   E4【症状本体】值回来后市集页自动补渲（不许把「没读到」画成「没有」直到重开）
//   E5' 值回来后健康保存照旧落库（3 种子＋1 新＝4；红侧 E4 已红按结构性跳过计，不作判准）
//   P1 作者症状原样：重开页面后种子商品还在（红侧库已被顶掉＝种子不见）
//   Z 全程零未捕获 JS 异常
//   （启动排队窗的同两句契约由 S3/S4/S8/S9 静态锚＋数据层 #1442 甲组动态覆盖；预算式挂起
//     夹具在无头机不可靠——实测 24MB 预算掐点差 3 字节、285KB 的 market-custom 恰进余量＝假窗。）
// 量具自律（#1442 同款）：开枪前的读数一律走 awaitingBigKey/__xyBigReadDiag（不踢库）；
//   库读数走 rawGet（直读 IndexedDB，不经过 xyStore.get——它命中空格会当场请库，把被测量踢回来）；
//   破坏判「整场最低读数」（迟到的一读可能把库里旧值 heal 回内存，真机没有这一腿）；
//   种库后必须等 idbListKeys 收齐再 reload（idbSet 是 fire-and-forget，固定等待会半途丢尾）。
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

let pass = 0, fail = 0, skip = 0;
const ok = (c, n, x) => { if (c === 'skip') { skip++; console.log('  ~ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 200) + ']' : '')); } else if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 300) + ']' : '')); } };

const MK = 'xy-home-v2:market-custom';
// 3 件种子、每件图 ~95KB base64 ⇒ JSON ≈286KB：跨过 LS_BIG_LIMIT(204800，大键分支剥 LS)
// 与 #1195e 切后台释放阈值(256KB)——「读空」这一发才是报障机上那一发，不是夹具编出来的。
const mkGoods = () => JSON.stringify([1, 2, 3].map((i) => ({
  id: 'g_custom_seed_' + i, name: '旧品' + '甲乙丙'[i - 1], emoji: '🧸',
  img: 'data:image/jpeg;base64,' + 'A'.repeat(95000), price: 10 + i, cat: '关怀', wish: '旧' + i
})));
const SEED_NAMES = ['旧品甲', '旧品乙', '旧品丙'];

const browser = await chromium.launch({ headless: true });
let page, errs = [];
async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.__errs = [];
  page.on('pageerror', (e) => page.__errs.push(String(e.message).slice(0, 160)));
  return page;
}
async function gotoApp() {
  errs = page.__errs;
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
}
// 开屏闸旁路＝把 splash 节点整棵摘掉（#1442 同款；不碰 splash 的门控状态机）
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
// 整场最低读数：破坏之后库里也许被迟到的一读 heal 回去（夹具里 IDB 读排在写之前；真机不会）
async function libMin(k, times, gap) {
  let min = 9e9;
  for (let i = 0; i < (times || 4); i++) { const n = nOf(await rawGet(k)); if (n >= 0 && n < min) min = n; await page.waitForTimeout(gap || 400); }
  return min === 9e9 ? -9 : min;
}
const openMarket = async () => {
  await page.evaluate(() => { const b = document.querySelector('.app[data-app="market"]'); if (b) b.click(); });
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const p = document.getElementById('page-market');
    return { hidden: p ? p.hidden : 'no-page', names: Array.from(document.querySelectorAll('#market-grid .gift-item-name')).map((x) => x.textContent) };
  });
};
const seedAll = async (goods, fillers) => {
  await page.evaluate((o) => {
    window.xyStore('xy-home-v2').set('contacts', JSON.stringify([{ id: 'default', name: '煜' }]));
    window.xyStore('xy-home-v2').set('active-contact', 'default');
    window.xyStore('xy-home-v2').set('market-custom', o.goods);
    (o.fillers || []).forEach((f, i) => window.xyStore('xy-home-v2').set('aafill-' + i, 'F' + i + '|' + 'y'.repeat(f)));
  }, { goods, fillers });
  // idbSet 是 fire-and-forget：大种子要数秒才落完，固定等待会半途 reload＝后几位没落库。
  // 等 idbListKeys 收齐＋__big-idx 持久化（大键证人躺在 LS，冷启动的 leg③ 靠它）。
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const done = await page.evaluate((o) => new Promise((res) => {
      try {
        window.idbListKeys().then((keys) => {
          if (!Array.isArray(keys)) { res(false); return; }
          const want = (o.fillers || []).length;
          let n = 0;
          for (let i = 0; i < want; i++) if (keys.indexOf('xy-home-v2:aafill-' + i) >= 0) n++;
          if (n < want || keys.indexOf('xy-home-v2:market-custom') < 0) { res(false); return; }
          let idx = {};
          try { idx = JSON.parse(localStorage.getItem('xy-home-v2:__big-idx') || '{}'); } catch (e) {}
          res(!!idx['xy-home-v2:market-custom']);
        }, () => res(false));
      } catch (e) { res(false); }
    }), { fillers });
    if (done) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
};
// 切后台→回前台（#1195e 的释放挂在切后台这一刻；iOS 上传相册就是这一时序）
const goHidden = () => page.evaluate(() => new Promise((res) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  setTimeout(() => res(1), 700);
}));
const comeBack = () => page.evaluate(() => new Promise((res) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  setTimeout(() => res(1), 300);
}));
// 开枪前的读数：只问「这一格现在读不读得到」，绝不碰 xyStore.get（命中空格会当场请库＝把被测量踢回来）
const blindAwait = () => page.evaluate(() => {
  let a = null;
  try { a = window.xyStore('xy-home-v2').awaitingBigKey('market-custom'); } catch (e) { a = 'ERR:' + e; }
  return { awaitK: a, diag: window.__xyBigReadDiag ? window.__xyBigReadDiag() : null };
});
// 保存一发（读空窗口里开枪的那一手）：开表单→填名→点保存
const saveOne = async (nm) => {
  const opened = await page.evaluate(() => {
    const b = document.getElementById('market-mine-add'); if (!b) return 'no-btn';
    b.click(); return 'ok';
  });
  await page.waitForTimeout(500);
  await page.evaluate((n) => { const i = document.getElementById('gm-name'); if (i) i.value = n; }, nm);
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => {
    const okb = document.getElementById('gm-ok'); if (!okb) return 'no-form';
    okb.click(); return 'fired';
  });
  await page.waitForTimeout(700);
  const still = await page.evaluate(() => !!document.getElementById('gm-ok'));
  return { opened, st, still };
};
const gridHas = (nm) => page.evaluate((n) => Array.from(document.querySelectorAll('#market-grid .gift-item-name')).some((x) => x.textContent === n), nm);
const waitGrid = async (nm, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await gridHas(nm)) return true; await page.waitForTimeout(300); }
  return false;
};
const waitReady = async () => {
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => !!window.__mochiDataReady)) return true; await page.waitForTimeout(300); }
  return false;
};

// ============ S 组：产物逻辑锚（js/gift-shop.js 外置产物） ============
console.log('\n== S 组：产物逻辑锚 ==');
{
  let src = '';
  try { src = readFileSync(join(root, 'js', 'gift-shop.js'), 'utf8'); } catch (e) { console.error('  (读 js/gift-shop.js 失败:' + e.message + ')'); }
  const needles = [
    ['S1 冷读未确认判据（删＝空读被当「没有」，商品库冷启动/切后台后整包顶掉）', 'function customReadUnconfirmed()'],
    ['S2 删除商品先过闸（删＝读不全时删除把库里整本顶掉）', 'function deleteGift(id) { if (customWriteBlocked()) return;'],
    ['S3 迁移读不全不落笔不落标记（删＝restore-done 空读把 market-custom 写成 []）', 'if (!GSTORE || GSTORE.get(MIGRATE_KEY)) return; if (customReadUnconfirmed()) return;'],
    ['S4 默认商品救援读不全不动（删＝空读把 rescue 标记落了、真救援那场永不跑）', 'if (!GSTORE || GSTORE.get(mark)) return; if (customReadUnconfirmed()) return;'],
    ['S5 导入先过闸（删＝计划按空账算，落笔顶掉真库）', 'if (customWriteBlocked()) return; // #1488 读不全先按住：这一发读出来的计划必是错的'],
    ['S6 上传/编辑保存先过闸＋请库补渲（删＝iOS 相册切后台放掉大键后，保存把商品库顶成只剩新一件）', 'if (customWriteBlocked()) { customAwaitBack(marketRerenderBoth); return; } customSave(customs);'],
    ['S7 恢复默认先过闸（删＝读不全时整包写回）', 'if (customWriteBlocked()) return; customSave(customLoad().filter('],
    ['S8 大键没取回同显加载态并请库补渲（删＝把「没读到」画成「还没有商品」诱导重传）', 'if (customReadUnconfirmed()) customAwaitBack(marketRerenderBoth);'],
    ['S9 我的商品块读取中诚实文案（删＝读取窗口谎报「还没上传过商品」）', '商品库读取中'],
    ['S10 导出读不全诚实提示（删＝空读导出空包当备份）', '商品库还没读全']
  ];
  for (const [n, nd] of needles) ok(src.indexOf(nd) >= 0, n, src.indexOf(nd) < 0 ? 'needle 不在产物' : '');
}

// ============ E 组：切后台放掉（iOS 上传相册的那一时序） ============
console.log('\n== E 组：切后台放掉 × 读空保存 ==');
let e4ok = false;
{
  await newCtx();
  await gotoApp();
  await enter();
  const goods = mkGoods();
  ok(goods.length > 204800, 'F1 种库自证：market-custom JSON 跨过 200KB 大键线', goods.length);
  await seedAll(goods, null);
  const lsCopy = await page.evaluate(() => localStorage.getItem('xy-home-v2:market-custom'));
  ok(lsCopy === null, 'F2 大键分支剥 LS 副本（IDB-only 形态成立）', lsCopy === null ? 'ok' : String(lsCopy).slice(0, 40));

  // 重开一场＝冷启动：回填把大键驻回内存 ⇒ 健康对照
  await gotoApp();
  await enter();
  await waitReady();
  const m0 = await openMarket();
  ok(!m0.hidden && SEED_NAMES.every((n) => m0.names.indexOf(n) >= 0), 'F3/E0 健康对照：回填后 3 件种子照常可见', JSON.stringify(m0.names).slice(0, 120));

  await goHidden();
  await comeBack();
  const b1 = await blindAwait();
  ok(b1.awaitK === true, 'E1 切后台放掉后 awaitingBigKey=true（数据层事实）', JSON.stringify(b1));

  // 【症状本体】读空那一发保存
  const sv = await saveOne('新传甲');
  const minN = await libMin(MK, 4, 400);
  ok(minN === 3, 'E2 读空那一发保存不许顶库（种子 3 件按整场最低读数判）', 'min=' + minN + ' save=' + JSON.stringify(sv));
  const toastSeen = await page.waitForFunction(() => (document.body && document.body.innerText || '').indexOf('没读全') >= 0, null, { timeout: 2500 }).then(() => true, () => false);
  ok(toastSeen, 'E3 被按住那一发给「没读全」的人话提示', String(toastSeen));

  // 值回来后自动补渲（不许谎报「还没有」到重开）
  e4ok = await waitGrid('旧品甲', 8000);
  ok(e4ok, 'E4 值回来后市集页自动补渲出种子商品', String(e4ok));

  if (e4ok) {
    // 健康保存照旧落库（表单还开着＝再点一次保存即可；关了就重开一张）
    if (!(await page.evaluate(() => !!document.getElementById('gm-ok')))) await saveOne('新传甲');
    else { await page.evaluate(() => { const i = document.getElementById('gm-name'); if (i) i.value = '新传甲'; }); await page.evaluate(() => { const b = document.getElementById('gm-ok'); if (b) b.click(); }); await page.waitForTimeout(800); }
    const raw = await rawGet(MK);
    const ids = idsOf(raw);
    ok(nOf(raw) === 4 && SEED_NAMES.every((_, i) => ids.indexOf('g_custom_seed_' + (i + 1)) >= 0), "E5' 值回来后健康保存照旧落库（3 种子＋1 新＝4）", JSON.stringify(ids).slice(0, 140));
  } else {
    ok('skip', "E5' 值回来后健康保存照旧落库（红侧结构性跳过，不作判准）");
  }

  // 作者症状原样：重开页面
  await gotoApp();
  await enter();
  await waitReady();
  const m1 = await openMarket();
  const seedsBack = SEED_NAMES.every((n) => m1.names.indexOf(n) >= 0);
  ok(seedsBack, 'P1 重开页面后种子商品还在（作者症状：刷新重新打开后消失）', JSON.stringify(m1.names).slice(0, 140));
}

console.log('\n== Z 组：全程零未捕获 JS 异常 ==');
ok(errs.length === 0, 'Z1 无 pageerror', errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\n通过 ' + pass + ' / 断言失败 ' + fail + ' / 跳过 ' + skip + (fail ? '  ✗ 有红' : '  ✓ 全绿'));
process.exit(fail ? 1 : 0);

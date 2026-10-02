// ===== 常驻回归脚本 #1342：大键「同步读空」被当成答案，于是整本账被一页空纸顶掉 ＋ 弹窗确定那一发永远只剩合成腿
// 用法：node tools/verify-1342-bigread-writeback-gate.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-27 直派：iPhone 12 Pro Max／iOS 16.6／自带 Safari／添加到桌面的 PWA，实报
// 「自定义桌面卡片无法导入图片，美化方案无法保存，重新刷新过后数据会被清除」＋「ios 卡顿问题」；
// 用户明说「不同型号不同 ios 系统可能出现不同问题，帮我修复，并且不要覆盖修改导致不同型号设备浏览器的
// bug 反复出现。这个问题其他设备型号也有出现」；随附 mochi-diag-2026-09-27-09-05-…docx）：
//   · 【数据】localStorage 整域 665 键 ≈4.1MB、LS 写探针「正常」（＝小值写得进，跟「数据没了」无关）
//   · 【内存体检】驻留最大那几格全在同一段体积：card-bg-deco 425KB、feed-cover-bg 229KB、phone-bg 201KB、
//     cs-bg-item 197KB —— 而【保活现场】「本页被系统回收过 70 次」＋环境变化 13 分钟里 10 次前后台
//   · 【文件选择取证】mochi-card-bg-pick/leg:fire ＋ srf:0 ＋ fb:onscreen 两发，一条 files=N 都没回来
//   · 【最近错误】TypeError: undefined is not an object (evaluating 'h.mode') ← divination histRowHtml
//
// 机制（三条，各自一处收口，判据一律零机型／零 UA 分支）：
//   ① >LS_BIG_LIMIT 的值【从不落 localStorage】（xyStore.set 大键分支还主动 removeItem，#907 启动再扫一遍），
//      而 `xyStore.get` 是同步口＝内存缓存→LS→null，**从不问库**（#1218 批注自陈过）。让内存里没有这一格
//      的闸门有两条，都与库里有没有数据无关：启动回填驻留预算（#975）／切后台释放大键内存副本（#1195e，
//      ≥256KB 当场删，其批注许诺「回来按需从 IDB 重读」——那条路只有异步调用方走得到）。iOS 天天触发。
//   ② 消费方按老习惯做读-改-写：`JSON.parse(store.get(K) || '[]')` → push → `store.set(K, 整本)`
//      ⇒ 库里那本被这一格空账整本顶掉＝「美化方案无法保存／每次刷新都被清空」，而且这一次保存当场写没。
//      四本方案账同形：beauty-schemes／full-beauty-schemes／chat-beauty-schemes／gc-beauty-schemes。
//   ③ 「点弹窗确定之后才弹选择器」这一族入口（桌面卡片背景＝用户点名那一发）手指落在全站【共用】的
//      「确定」按钮上，#1323 那套自学门面对它必然判「同一格多宿主」而永久剔除 ⇒ 这一族永远只剩合成腿
//      （showPicker／click 打 sr-only input），iOS 静默拒绝、不抛异常＝用户所见「点了没反应」。
//
// 收口判据（都是当场可观测的事实）：
//   A. 一次没问过库的读空不是答案：get 读空＋「这格本该有一份大值」⇒ 标未确认＋踢一趟现成的
//      idbEnsureBigKey（#1218 那一份，不另起第二套取回）；未确认期间**不许整包写回**（数据层一句
//      window.xyBigWriteBlocked，四本账共用一句判据与一句文案）。本会话写过即摘标。
//   B. 把「这一档＝选文件」写进胶囊，层由 openModal→mochiModalPickOk（#1014 现成模具）铺在确定按钮上；
//      其余档位 preventDefault 取消默认动作、把这发点按原样交回入口逻辑＝既有弹窗行为逐字不变。
//
// ⚠ 尺子为什么量在夹具键上：业务键（beauty-schemes 等）各有页面级写入方会在同一场里自己改条数，
//   拿它当绝对条数判据必假（#1335 同一课）。业务侧的接线由哨兵 #1342h/j/k 罩着。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { resolve, normalize, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('被测根目录：' + root);

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

const GK = 'xy-home-v2';                 // 全局根键前缀（四本方案账都挂在这里）
const FIX = 'zz1342-list';               // 夹具键：一本 >256KB 的「整本账」
const KFIX = GK + ':' + FIX;
const mkList = (n, pad) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: '方案' + i, data: { blob: 'x'.repeat(pad) } })));
const SEED = mkList(20, 14000);          // 20 条 ≈ 290KB ⇒ 大键（不落 LS，只进 IDB＋内存）
const nOf = (raw) => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.length : -2; } catch (e) { return raw == null ? -9 : -3; } };

const browser = await chromium.launch({ headless: true });
const errs = [];
async function enter(page) {
  page.on('pageerror', (e) => errs.push(String(e && e.message).slice(0, 200)));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 40000 });
  for (let i = 0; i < 90; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await new Promise((r) => setTimeout(r, 200)); }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s){s.click();if(!s.classList.contains('hide'))s.classList.add('hide');}return 1;})()");
  await new Promise((r) => setTimeout(r, 600));
}
const rawIdb = (page, key) => page.evaluate((k) => new Promise((res) => {
  try {
    const req = indexedDB.open('mochi-db');            // 不带版本号：按更高版本 open 会被判 VersionError
    req.onsuccess = () => {
      const db = req.result;
      let store;
      try { store = db.transaction('kv', 'readonly').objectStore('kv'); } catch (e) { res('NOSTORE'); return; }
      const g = store.get(k);
      g.onsuccess = () => res(g.result === undefined ? null : g.result);
      g.onerror = () => res('ERR');
    };
    req.onerror = () => res('NOOPEN');
  } catch (e) { res('ERR'); }
}), key);
// 库里到底是几条（不经过任何内存层，直接问 IndexedDB）
const idbCount = async (page) => nOf(await rawIdb(page, KFIX));
// 真实一次「切后台」：走产品自己那对 visibilitychange/pagehide 监听（＝#1195e 释放的现场）
const goBackground = (page, hidden) => page.evaluate((h) => {
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  } catch (e) {}
  document.dispatchEvent(new Event('visibilitychange'));
  if (h) window.dispatchEvent(new Event('pagehide'));
  return document.visibilityState;
}, hidden);

// ───────────────────────── S 组：本批新契约（量在数据层通路上） ─────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await enter(page);

  // 灌库：整本 20 条写进 IDB（大键不落 LS），等它真的落盘
  const seeded = await page.evaluate(async (payload) => {
    const st = window.xyStore('xy-home-v2');
    st.set('zz1342-list', payload);
    for (let i = 0; i < 40; i++) {
      try { const v = await window.idbGet('xy-home-v2:zz1342-list'); if (v && String(v).length > 100000) return 'landed'; } catch (e) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    return 'timeout';
  }, SEED);
  ok(seeded === 'landed' && SEED.length > 256 * 1024,
    'S0 夹具诚实：这本账真 >256KB（切后台会放掉它）且真落进了库里', seeded + ' len=' + SEED.length);

  await goBackground(page, true);
  await new Promise((r) => setTimeout(r, 150));
  await goBackground(page, false);

  // 一次同步任务里做完：读空 → 问闸 → 想写回（异步取回不可能在这个任务里插进来，读数才是确定的）
  const S = await page.evaluate(() => {
    const st = window.xyStore('xy-home-v2');
    const raw = st.get('zz1342-list');                       // 被放掉之后：两台机器都读空
    const list = JSON.parse(raw || '[]');                    // ← 消费方的老习惯：空账当成没有
    list.push({ name: '用户新存的方案' });
    const blocked = !!(window.xyBigWriteBlocked && window.xyBigWriteBlocked(st, 'zz1342-list', '美化方案'));
    if (!blocked) st.set('zz1342-list', JSON.stringify(list));
    return {
      readNull: raw === null,
      readLen: list.length,
      blocked: blocked,
      awaiting: typeof st.awaitingBigKey === 'function' ? st.awaitingBigKey('zz1342-list') : 'NOAPI',
      hasDiag: typeof window.__xyBigReadDiag === 'function'
    };
  });
  ok(S.readNull === true, 'S1a 释放之后同步读口确实读空（＝症状本体；红侧读得到值＝本组无意义）');
  ok(S.awaiting === true, 'S1b 这一次读空被当场认成「没问完的问话」（awaitingBigKey），而不是「库里没有」', S.awaiting);
  ok(S.blocked === true, 'S2a 未确认期间整包写回被拒（旧形态＝拿这一格空账 push 一条写回去）', JSON.stringify(S));
  ok(S.hasDiag === true, 'S5 数据层给了「大键读回」取证出口（诊断【数据】段才点得出是谁在拒）');

  const afterBlocked = await idbCount(page);
  ok(afterBlocked === 20, 'S2b 被拦下这一次写回之后，库里那本仍 20 条（＝用户的数据没被一页空纸顶掉）', '库里=' + afterBlocked + '条');

  // 取回落地：读口自己回到 20 条，此后写回放行
  const back = await page.evaluate(async () => {
    const st = window.xyStore('xy-home-v2');
    for (let i = 0; i < 100; i++) {
      const v = st.get('zz1342-list');
      if (v && String(v).length > 100000) return { n: JSON.parse(v).length, awaiting: st.awaitingBigKey('zz1342-list'), blocked: !!(window.xyBigWriteBlocked && window.xyBigWriteBlocked(st, 'zz1342-list', 'x')) };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { n: -1 };
  });
  ok(back.n === 20, 'S3a 闸放行之后读口自己拿回库里那 20 条（红＝那一本被顶成一格空账之后，这一场再也读不回 20 条）', '读到=' + back.n + '条');
  ok(back.awaiting === false && back.blocked === false, 'S3b 值回来之后写回放行（一律拦＝把防丢闸变成写不进去）', JSON.stringify(back));

  // 重开整页：库里仍是 20 条（＝「每次刷新都被清空」不许再成立）
  await page.reload({ waitUntil: 'load' });
  await enter(page);
  const afterReload = await idbCount(page);
  ok(afterReload === 20, 'S4 整页重开之后库里仍 20 条', '重开后库里=' + afterReload + '条');
  await ctx.close();
}

// ───────────────────────── P 组：弹窗确定＝真·可点选图门（openModal 模具） ─────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await enter(page);

  await page.evaluate(() => {
    window.__t1342 = { files: -1, okVal: 'none', mode: 'none' };
    // 一次模具、两种开法：P3 与 P4 各开一扇（前一扇会被自己那发点按消费掉），控制组才有可比性
    window.__openT1342 = function () {
      window.openModal('桌面卡片设置', '', (v) => { window.__t1342.okVal = v; }, {
        noInput: true,
        pills: [
          { label: '更换图片', value: '1', pick: { accept: 'image/*', entry: 't1342-card', onFiles: (fs) => { window.__t1342.files = (fs && fs.length) || 0; } } },
          { label: '清除图片', value: '2' }
        ]
      });
    };
    window.__openT1342();
  });
  await new Promise((r) => setTimeout(r, 300));

  const geom = await page.evaluate(() => {
    const lay = document.getElementById('mochi-modal-pick');
    const okb = document.getElementById('modal-ok');
    if (!okb) return { layer: false, okBtn: false };
    const b = okb.getBoundingClientRect();
    // 落点一律取「确定」按钮的中心：绿侧这一格被真层盖住＝手指落在 INPUT 上；
    // 红侧没有层＝落在 BUTTON 上＝只剩合成腿。两边走同一个坐标，读数才可比。
    const out = {
      layer: !!lay, surface: lay ? lay.getAttribute('data-file-pick-surface') : null,
      cx: b.left + b.width / 2, cy: b.top + b.height / 2,
      hitIt: ((document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) || {}).tagName) || '',
      cover: -1
    };
    if (lay) {
      const a = lay.getBoundingClientRect();
      const ov = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      out.cover = Math.round(ov / Math.max(1, b.width * b.height) * 100);
      out.w = Math.round(a.width); out.h = Math.round(a.height);
    }
    return out;
  });
  ok(geom.layer === true && geom.surface === '1', 'P1 这一发确定按钮上真铺着一张可点 file input（红＝这一格只剩合成腿，正是 srf:0＋fb:onscreen 那两发）', JSON.stringify(geom));
  ok(geom.hitIt === 'INPUT' && geom.cover >= 80 && geom.w >= 24 && geom.h >= 20,
    'P2 手指落在「确定」那一格时先碰到的是真 input（层没飘去盖住别的控件、也没小得点不中）', JSON.stringify(geom));

  // 选中「更换图片」那一档 → 手指落在层上＝原生弹选择器 → 文件回到入口管线
  await page.click('#modal-pills .pill >> nth=0');
  let chooser = 0;
  page.on('filechooser', async (fc) => { chooser++; try { await fc.setFiles(join(root, 'icon-192.png')); } catch (e) {} });
  if (typeof geom.cx === 'number') await page.mouse.click(geom.cx, geom.cy);
  await new Promise((r) => setTimeout(r, 1200));
  ok(chooser === 1 && (await page.evaluate(() => window.__t1342.files)) === 1,
    'P3 点确定真的弹了选择器、选完图真的回到这一档自己的管线（files=1）', 'chooser=' + chooser + ' got=' + JSON.stringify(await page.evaluate(() => window.__t1342)));

  // 换到「清除图片」档：同一格点按不得弹选择器，且必须原样交回确定按钮自己的逻辑
  //（另开一扇：上一扇已被 P3 那发点按消费掉＝控制组两边都要能跑到这一格，读数才可比）
  await page.evaluate(() => { window.__t1342.okVal = 'none'; window.__openT1342(); });
  await new Promise((r) => setTimeout(r, 300));
  chooser = 0;
  await page.click('#modal-pills .pill >> nth=1');
  const g4 = await page.evaluate(() => {
    const b = document.getElementById('modal-ok').getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  });
  await page.mouse.click(g4.cx, g4.cy);
  await new Promise((r) => setTimeout(r, 900));
  const r2 = await page.evaluate(() => window.__t1342);
  ok(chooser === 0 && r2.okVal === '2',
    'P4 其余档位照旧走确定按钮自己的逻辑（没被这层吃掉＝既有弹窗行为逐字不变）', 'chooser=' + chooser + ' okVal=' + r2.okVal);

  const gone = await page.evaluate(() => {
    const mask = document.getElementById('modal-mask');
    const c = document.getElementById('modal-cancel');
    if (c) c.click(); else if (mask) mask.click();
    return new Promise((res) => setTimeout(() => res(!document.getElementById('mochi-modal-pick')), 400));
  });
  ok(gone === true, 'P5 弹窗关掉之后层撤干净（绝不残留到下一个弹窗）');
  await ctx.close();
}

// ───────────────────────── D 组：占卜历史分页上界 ─────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await enter(page);
  const e0 = errs.length;
  const seeded = await page.evaluate(() => {
    const rec = (i) => ({ mode: 'lenormand', count: 3, ts: Date.now() - i * 1000, question: 'q' + i, cards: [{ name: '船', rev: false, meaning: 'm' }] });
    const st = window.activeStore();
    st.set('divine-history', JSON.stringify([rec(1), rec(2), rec(3)]));   // 只有 3 条，远少于 HIST_PAGE=30
    const ic = document.querySelector('.app[data-app="divination"]');
    return !!ic;
  });
  ok(seeded === true, 'D0 夹具诚实：桌面占卜入口在（红＝本组读数无意义）');
  // 开屏后可能挂着别的弹窗（备份提醒/引导…），先按产品自己的取消路径收干净，再走图标开页
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      const mask = document.getElementById('modal-mask');
      if (!mask || mask.hidden) break;
      const c = document.getElementById('modal-cancel');
      if (c) c.click(); else { try { mask.click(); } catch (e) {} }
    }
    return 1;
  });
  await new Promise((r) => setTimeout(r, 300));
  // 走产品自己那条开页路径（图标 click → renderHistOnOpen → renderHistory），不手工改 hidden
  await page.click('.app[data-app="divination"]');
  await new Promise((r) => setTimeout(r, 700));
  const rows = await page.evaluate(() => document.querySelectorAll('#div-history .div-h-item').length);
  ok(rows === 3, 'D1 记录少于 30 条时整块占卜历史真渲染出来（红＝renderHistory 抛在 innerHTML 之前＝一片空白）', '渲染行数=' + rows);
  const mine = errs.slice(e0).filter((m) => /h\.mode|histRowHtml|divination/.test(m));
  ok(mine.length === 0, 'D2 这一段不再因 h.mode 抛错（报障件【最近错误】那唯一一条）', mine.slice(0, 2).join(' | '));
  await ctx.close();
}

// ───────────────────────── T 组：健康机器上行为逐字不许变 ─────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await enter(page);
  const T = await page.evaluate(() => {
    const st = window.xyStore('xy-home-v2');
    const never = st.get('zz1342-never-written');                       // 从没写过的一本账
    const neverAwaiting = typeof st.awaitingBigKey === 'function' ? st.awaitingBigKey('zz1342-never-written') : false;
    const neverBlocked = !!(window.xyBigWriteBlocked && window.xyBigWriteBlocked(st, 'zz1342-never-written', 'x'));
    st.set('zz1342-never-written', '["第一次就存进去"]');                // 首存必须照旧成功
    const wroteBack = st.get('zz1342-never-written');
    const small = JSON.stringify([{ a: 1 }]);                           // <200KB：落 LS 的小账
    st.set('zz1342-small', small);
    const smallRead = st.get('zz1342-small');
    const rel = window.idbBigKeyCandidates('zz1342-rel');               // #1218 那把尺子的旧口径
    const full = window.idbBigKeyCandidates('xy-home-v2:beauty-schemes'); // #1342a 的新口径
    const diag = window.__xyBigReadDiag ? window.__xyBigReadDiag() : null;
    return { neverAwaiting, neverBlocked, wroteBack, smallOk: smallRead === small, rel, full, diag };
  });
  ok(T.neverAwaiting === false && T.neverBlocked === false && T.wroteBack === '["第一次就存进去"]',
    'T1 从没写过的一本账：读空不算未确认、首存照旧成功（不把修复变成新的「存不进去」）', JSON.stringify({ a: T.neverAwaiting, b: T.neverBlocked, w: T.wroteBack }));
  ok(T.smallOk === true, 'T2 ≤200KB 的小账读写链路没被带坏（LS 那份本就是落盘证据）');
  ok(Array.isArray(T.rel) && T.rel.length >= 1 && T.rel[0] === 'xy-home-v2:default:zz1342-rel' && T.rel.indexOf('xy-home-v2:zz1342-rel') >= 0,
    'T3 相对键名的候选口径一字不变（#1218／#1335 那条旧顶层键回退还在）', JSON.stringify(T.rel));
  ok(Array.isArray(T.full) && T.full.length === 1 && T.full[0] === 'xy-home-v2:beauty-schemes',
    'T4 完整键名照原样认（全局根键不再被拼成一个不存在的位置＝三态尺子对全局键不再结构性失明）', JSON.stringify(T.full));
  ok(T.diag && typeof T.diag.unconfirmed === 'number' && typeof T.diag.deferred === 'number',
    'T5 取证出口只读、口径全部取现成名册（#1349 的放掉名册＋#975 挂起名单，不自记第二本账）', JSON.stringify(T.diag));
  await ctx.close();
}

ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', errs.slice(0, 4).join(' | '));
console.log('\n结果：绿 ' + pass + ' / 红 ' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);

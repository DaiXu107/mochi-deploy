// ===== 常驻回归脚本 #1360：聊天记录的「尾部」被当成「全量」（账本／空库判定／搜索／备份恢复／迟到读）
// 用法：node tools/verify-1360-tail-not-whole.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-28 直派：OPPO K13 Turbo Pro(PLE110)／Edge 153／桌面 PWA，实报「聊天记录乱跳，一会显示
// 以前的聊天记录一会显示现在的」「聊天记录一天比一天少，昨天刚备份今天又弹出来需要备份，聊天记录莫名其妙被吞，
// 消失了很多。在搜索聊天记录里搜也搜不出来」；明说「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现，
// 这个问题其他设备型号也有出现」；随附 mochi-diag-2026-09-27-16-28-…docx）：
//   · 【IndexedDB 大键明细】default:chat-msgs=102.0MB —— 【最大键】localStorage 同一格只剩 2.2MB 有损尾巴
//   · 【内存体检】内存聊天条数=10367；【保活现场】本页被系统回收过 59 次；长任务 951/1637/1632/1626ms
//   · 【数据导入回执】23:36 backup:read:text-ok size=78189738 name=mochi聊天记录_2026-09-18.json（用户在拿旧备份救数据）
//   · 在册聊天键只有 chat-msgs / chat-meta / chat-tail——一把 chat-blk-* 都没有＝这桌还停在整包格式
//
// 五件事（无头真跑产物量出来的；判据一律零机型／零 UA 分支，只看「库里到底有多少条」「这一发完成没有」）：
//  ① chatBlkRewriteTail 把索引的全量账 total 写成「内存这一段的条数」——头块一个字节没动，账却短一截；
//     读侧 headN=total-热片 归零 ⇒ chatColdDone=true ⇒ 更早的记录**永不再被取回**，账本/统计/导出/搜索跟着少。
//     实测：一场之内 900 条报成 303，第二次打开只剩 306。
//  ② 「这个桌面没有历史」只问 chat-msgs 与 chat-arch 两把键——#722 之后大历史两把都不存（改住 chat-blk-idx
//     + chat-blk-<seq>）⇒ 分块桌面的热片一读不成＝两票全过＝当场确认空库，把内存那条尾巴整包写回 IDB、
//     账本对齐成尾巴条数。实测：库里 900 条被写成 2 条整包＋chat-meta.n=2。
//  ③ 搜索扫的是内存 msgs（分块桌面在上滑到头之前只有热片、整包读不成的设备只有 LS 尾巴），库里的旧消息
//     与「这条没说过」同形，界面上还写「没有找到」。实测：库里 3 条含针，搜索只命中 1 条。
//  ④ 备份恢复拿「字符串谁长」当尺子（把整本数组 join 起来对对象恒等于每条 "[object Object]"＝15 字符），
//     而分块桌面那份 chat-msgs 只可能是 LS 的有损尾巴 ⇒ 尾巴永远赢；且 lsObj/idbObj 声明在组装段**之后**
//     ＝TDZ ReferenceError 被外层 catch 吞掉＝分块备份的组装整段静默不跑。实测：900 条的库恢复一份自带
//     尾巴的备份之后屏上只剩尾巴、块键全被删光＝用户口径的「刚备份完记录反而更少／被吞」。
//  ⑤ idbGet 的等待窗到点只 resolve(undefined) 并把**还在内核里跑的那一发真读丢掉**：上层据此每 5~15s 重发
//     一整包（102MB 级＝同一份数据读第二遍第三遍＝堆尖峰，看着就是「卡＋被回收」），而 #722 的分块迁移只挂在
//     「整包读成功」上＝包越大越读不成、读不成永远分不了块＝永久锁死。现在放弃那一刻把落地结果登记成可等的
//     口子（idb.js 的 idbLateRead），同一把键只要有还挂着的一发就附议等它，绝不另起第二发。
//
// 尺子为什么这么放：A 组量「账与隔场可达」，B 组量「搜索口径＋真跳转」，C 组量「读不成 ≠ 没有」，
// D 组把一份真实形态的备份文件喂进产品自己的导入入口，E 组用 CDP 20× 节流把一发 12MB 整包读推到等待窗之外
// （S5 先证它确实被放弃过＝夹具诚实），R 组是旧契约（两侧皆绿才证明这不是把别的东西改坏）。
// 读数一律取自 IndexedDB（不经任何内存层）与产物 DOM/文案，不取耗时；每组用独立浏览器档案，跑挂也记一条红
// （崩了没读数＝假绿，见 #1326 那一课）。
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { resolve, normalize, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('被测根目录：' + root);
if (!existsSync(join(root, 'js', 'chat.js'))) { console.log('✗ 被测根目录里没有 js/chat.js（喂错目录了）'); process.exit(2); }

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
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 260) + ']' : '')); } };

const PFX = 'xy-home-v2:default';
const ND_HEAD = '只在冷头的扎针';
const ND_HOT = '只在热片的扎针';
const ND_WHOLE = '只在整包深处的扎针';
const tagOf = root.replace(/[^a-zA-Z0-9]/g, '').slice(-14);
const errs = [];

async function launch(tag) {
  const dir = normalize(join(root, '..', 'ev1360-' + tag + '-' + tagOf));
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 360, height: 747 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
}
async function rev(page, fn, arg, tries = 10) {
  let last = '';
  for (let i = 0; i < tries; i++) { try { return await page.evaluate(fn, arg); } catch (e) { last = String(e && e.message).slice(0, 80); await new Promise((r) => setTimeout(r, 300)); } }
  throw new Error('页面求值重试耗尽：' + last);
}
async function boot(ctx, opts) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    const st = String((e && e.stack) || '');
    const where = st.split(String.fromCharCode(10)).slice(1, 3).join(' <- ').replace(/https?:\/\/[^)\s]*/g, 'F').slice(0, 150);
    errs.push(String((e && e.message) || e).slice(0, 120) + ' @ ' + where);
  });
  if (opts && opts.countPkgReads) await page.addInitScript(() => {
    window.__pkg = {};
    const t = setInterval(() => {
      if (!window.idbGet || window.__on) return;
      window.__on = 1; clearInterval(t);
      const o = window.idbGet;
      window.idbGet = function (k) { try { if (String(k).split(':').pop() === 'chat-msgs') window.__pkg.n = (window.__pkg.n || 0) + 1; } catch (e) {} return o.apply(window, arguments); };
    }, 2);
  });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 240; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await new Promise((r) => setTimeout(r, 200)); }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s){s.click();if(!s.classList.contains('hide'))s.classList.add('hide');}return 1;})()");
  await new Promise((r) => setTimeout(r, 600));
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enterChat = (page) => rev(page, async () => {
  for (let i = 0; i < 40; i++) {
    const t = Array.from(document.querySelectorAll('.tab')).find((x) => /聊天/.test(x.textContent || ''));
    if (t) t.click();
    await new Promise((r) => setTimeout(r, 250));
    const pg = document.getElementById('page-chat');
    if (pg && (pg.classList.contains('active') || pg.classList.contains('show'))) return 'chat-page';
    if (t) return 'clicked-no-class';
  }
  return 'no-tab';
});
const sendOnce = (page, text) => rev(page, ({ t }) => {
  const i = document.getElementById('chat-input');
  if (!i) return 'noinput';
  if (i.isContentEditable) i.textContent = t; else i.value = t;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  const b = document.getElementById('chat-send');
  if (b) b.click();
  return b ? 'sent' : 'nobutton';
}, { t: text });
const rawIdb = (page, key) => rev(page, (k) => new Promise((res) => {
  const q = indexedDB.open('mochi-db');
  q.onsuccess = () => {
    let t;
    try { t = q.result.transaction('kv', 'readonly'); } catch (e) { res('NOSTORE'); return; }
    const g = t.objectStore('kv').get(k);
    g.onsuccess = () => res(g.result === undefined ? null : g.result);
    g.onerror = () => res(null);
  };
  q.onerror = () => res(null);
}), key);
const listIdb = (page, re) => rev(page, ({ re: r2 }) => new Promise((res) => {
  const q = indexedDB.open('mochi-db');
  q.onsuccess = () => {
    let t;
    try { t = q.result.transaction('kv', 'readonly'); } catch (e) { res([]); return; }
    const g = t.objectStore('kv').getAllKeys();
    g.onsuccess = () => res(g.result.map(String).filter((k) => new RegExp(r2).test(k)).sort());
    g.onerror = () => res([]);
  };
  q.onerror = () => res([]);
}), { re: re });
// 读数一律在页内解析、只回传数字（把整包字符串或几百条消息数组原样跨进程送回会被判成不可序列化＝
// undefined，尺子一旦读到 undefined 就什么都证不了——这一条是「两侧同尺」的前提）。
async function readProj(page, key, proj) {
return rev(page, ({ k, p: what }) => new Promise((res) => {
  try {
    const q = indexedDB.open('mochi-db');
    q.onerror = () => res(-9);
    q.onsuccess = () => {
      let t;
      try { t = q.result.transaction('kv', 'readonly'); } catch (e) { res(-1); return; }
      const g = t.objectStore('kv').get(k);
      g.onsuccess = () => {
        const v = g.result;
        if (v === undefined) { res(-1); return; }
        let o = v;
        try { if (typeof v === 'string') o = JSON.parse(v); } catch (e) { res(-3); return; }
        if (what === 'total') res(o && typeof o.total === 'number' ? o.total : -4);
        else if (what === 'metaN') res(o && typeof o.n === 'number' ? o.n : -4);
        else res(Array.isArray(o) ? o.length : -5);
      };
      g.onerror = () => res(-6);
      setTimeout(() => res(-7), 8000);
    };
  } catch (e) { res(-8); }
}), { k: key, p: proj });
}
const countIdb = (page, key) => readProj(page, key, 'count');
const totalIdb = (page, key) => readProj(page, key, 'total');
const metaIdb = (page, key) => readProj(page, key, 'metaN');
const fullCount = (page) => rev(page, () => (window.getChatMsgs ? (window.getChatMsgs() || []).length : -1));
const hasNd = (page, nd) => rev(page, ({ x }) => (window.getChatMsgs ? (window.getChatMsgs() || []).some((m) => m && String(m.text || '').indexOf(x) >= 0) : false), { x: nd });
const truthInIdb = (page, key, nd) => rev(page, ({ k, x }) => new Promise((res) => {
  const q = indexedDB.open('mochi-db');
  q.onsuccess = () => {
    let t;
    try { t = q.result.transaction('kv', 'readonly'); } catch (e) { res(false); return; }
    const g = t.objectStore('kv').get(k);
    g.onsuccess = () => res(String(g.result == null ? '' : (typeof g.result === 'string' ? g.result : JSON.stringify(g.result))).indexOf(x) >= 0);
    g.onerror = () => res(false);
  };
  q.onerror = () => res(false);
}), { k: key, x: nd });
const doSearch = (page, nd, waitMs) => rev(page, async ({ x, w }) => {
  const more = document.getElementById('more-search');
  if (!more) return { err: 'no-entry' };
  more.click();
  await new Promise((r) => setTimeout(r, 500));
  const inp = document.getElementById('chat-search-input');
  if (!inp) return { err: 'no-input' };
  inp.value = x;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const go = document.getElementById('chat-search-go');
  if (go) go.click();
  await new Promise((r) => setTimeout(r, w));
  const box = document.getElementById('chat-search-results');
  const li = box.querySelector('.tc-listitem');
  return { hits: box.querySelectorAll('.tc-listitem').length, txt: String(box.textContent || '').slice(0, 70), li: String(li ? li.textContent : '') };
}, { x: nd, w: waitMs });

// 分块桌面：blk-0/blk-1＝600 条冷头（一条扎针只在 blk-0），blk-2＝300 条热片（另一条只在热片）
const seedChunked = (page) => rev(page, ({ PFX, ND_HEAD, ND_HOT }) => {
  const mkIn = (n, tag, nd) => Array.from({ length: n }, (_, i) => ({ ts: 1700000000000 + i * 1000, side: i % 2 ? 'out' : 'in', text: tag + '-' + i + (i === 7 ? ' ' + nd : '') }));
  const idx = { v: 1, blocks: [{ k: 'chat-blk-0', bytes: 900000, n: 300 }, { k: 'chat-blk-1', bytes: 900000, n: 300 }, { k: 'chat-blk-2', bytes: 900000, n: 300 }], total: 900, nextSeq: 3 };
  const data = [[PFX + ':chat-blk-0', mkIn(300, 'head0', ND_HEAD)], [PFX + ':chat-blk-1', mkIn(300, 'head1', '没有针')], [PFX + ':chat-blk-2', mkIn(300, 'hot', ND_HOT)],
    [PFX + ':chat-blk-idx', JSON.stringify(idx)], [PFX + ':chat-meta', JSON.stringify({ n: 900, t: Date.now(), b: 84000 })]];
  return new Promise((res) => {
    const q = indexedDB.open('mochi-db');
    q.onsuccess = () => {
      let t;
      try { t = q.result.transaction('kv', 'readwrite'); } catch (e) { res('notx:' + e.name); return; }
      data.forEach((d) => t.objectStore('kv').put(d[1], d[0]));
      t.oncomplete = () => res('ok');
      t.onerror = () => res('txerr');
    };
    q.onerror = () => res('noopen');
  });
}, { PFX, ND_HEAD, ND_HOT });

const mk = (n, tag, nd) => Array.from({ length: n }, (_, i) => ({ ts: 1700000000000 + i * 1000, side: i % 2 ? 'out' : 'in', text: tag + '-' + i + (i === 7 ? ' ' + nd : '') }));

// ═════════ 组 1：全量账与隔场可达 ═════════
async function groupA() {
  const ctx = await launch('a');
  try {
    const page = await boot(ctx);
    ok(await seedChunked(page) === 'ok', 'S1 夹具诚实：900 条分块历史真落进了库里');
    const t0 = await totalIdb(page, PFX + ':chat-blk-idx');
    await enterChat(page);
    let f1 = 0;
    for (let i = 0; i < 24; i++) { f1 = await fullCount(page); if (f1 >= 300) break; await wait(1000); }
    ok(f1 >= 300, 'S2 进聊天读到了东西（热片装载；两侧皆绿＝夹具真跑产物）', '全量=' + f1);
    await sendOnce(page, '本批测试发的一条');
    await wait(13000);
    const t1 = await totalIdb(page, PFX + ':chat-blk-idx');
    const m1 = await metaIdb(page, PFX + ':chat-meta');
    ok(t0 === 900, 'S3 尾块重写之前索引的全量账是 900（尺子的底数）', 'total=' + t0);
    ok(t1 >= 900, 'A1 发一条消息之后，索引的全量账仍是 900+（旧＝被写成内存那一段＝实测 303）', 'total 现在=' + t1);
    ok(m1 >= 900, 'A2 条数账本 chat-meta 仍是 900+（旧＝跟着短＝#90 缩水守卫的尺子自己变短，之后真丢数据判不出来）', 'chat-meta.n=' + m1);
    ok(await hasNd(page, ND_HEAD), 'A3 本场冷头那条记录在全量口径里可达（旧＝headN 归零判成没头部）');
    await page.close();
    const page2 = await boot(ctx); // ＝用户第二天再打开
    await enterChat(page2);
    await wait(9000);
    const f2 = await fullCount(page2);
    ok(f2 >= 900, 'A4 第二次打开这一桌：全量仍是 900+（旧＝只剩热片＝用户所见「记录一天比一天少」）', '全量=' + f2);
    ok(await hasNd(page2, ND_HEAD), 'A5 第二次打开：冷头那条还在（旧＝永不再被取回）');
    const keysA = await listIdb(page2, 'chat-blk-');
    ok(keysA.indexOf(PFX + ':chat-blk-0') >= 0 && keysA.indexOf(PFX + ':chat-blk-1') >= 0, 'R1 头块物理上还在（尾块重写没顺手删头＝旧契约不动）', keysA.join(','));
  } finally { await ctx.close(); }
}

// ═════════ 组 2：搜索口径与真跳转 ═════════
async function groupB() {
  const ctx = await launch('b');
  try {
    const page = await boot(ctx);
    await seedChunked(page);
    await enterChat(page);
    await wait(14000);
    ok(await truthInIdb(page, PFX + ':chat-blk-0', ND_HEAD) === true, 'S4 那条扎针确实只在头块里（＝不在内存热片上，红侧才量得出「搜不出来」）');
    const sB = await doSearch(page, ND_HEAD, 6000);
    ok(sB.err === undefined && sB.hits >= 1, 'B1 搜冷头里的关键词命中 ≥1 条（旧＝只扫内存 msgs＝用户报的「在搜索聊天记录里搜也搜不出来」）', JSON.stringify(sB));
    ok(/只在冷头的扎针/.test(sB.li), 'B2 命中项就是冷头那条本身（不是热片里的巧合）', String(sB.li).slice(0, 60));
    const jumped = await rev(page, async () => {
      const li = document.getElementById('chat-search-results').querySelector('.tc-listitem');
      if (!li) return 'no-item';
      li.click();
      await new Promise((r) => setTimeout(r, 2500));
      return String((document.getElementById('chat-body') || {}).textContent || '').indexOf('只在冷头的扎针') >= 0 ? 'on-screen' : 'not-on-screen';
    });
    ok(jumped === 'on-screen', 'B3 点搜索结果能真的跳到那条老记录（并入冷头之后的下标不能错位）', jumped);
    const sHot = await doSearch(page, ND_HOT, 1500);
    ok(sHot.hits >= 1, 'R2 现网常用路径没坏：热片里的关键词照旧命中', JSON.stringify(sHot));
  } finally { await ctx.close(); }
}

// ═════════ 组 3：读不成 ≠ 这个桌面没有历史 ═════════
async function groupC() {
  const ctx = await launch('c');
  try {
    const page = await boot(ctx);
    // 现场：这桌只有分块键与账本（没有 chat-msgs、没有 chat-arch），而首读发生在种子之前＝这一发热片读不成
    await seedChunked(page);
    await enterChat(page);
    await wait(28000);
    const wn = await countIdb(page, PFX + ':chat-msgs');
    const mn = await metaIdb(page, PFX + ':chat-meta');
    ok(wn === -1 || wn >= 900, 'C1 这一桌没被「确认空库」写成一条只有几条的整包（旧＝实测被写成 2 条整包＝永久丢失）', 'chat-msgs 条数=' + wn);
    ok(mn === -1 || mn >= 900, 'C2 账本没被对齐成尾巴条数（旧＝实测 n=2，之后连缩水守卫都拦不住了）', 'chat-meta.n=' + mn);
    ok(await fullCount(page) >= 900, 'C3 读不成之后照旧按读取失败重试，最终仍拿回全量（不谎报、也不永久空白）', '全量=' + await fullCount(page));
  } finally { await ctx.close(); }
}

// ═════════ 组 4：备份恢复以拼出来的整本为准 ═════════
async function groupD() {
  const fileOf = (withTail) => {
    const idx = { v: 1, blocks: [{ k: 'chat-blk-0', bytes: 900000, n: 300 }, { k: 'chat-blk-1', bytes: 900000, n: 300 }, { k: 'chat-blk-2', bytes: 900000, n: 300 }], total: 900, nextSeq: 3 };
    const idb = {
      [PFX + ':chat-blk-idx']: JSON.stringify(idx),
      [PFX + ':chat-blk-0']: mk(300, 'head0', ND_HEAD),
      [PFX + ':chat-blk-1']: mk(300, 'head1', '没有针'),
      [PFX + ':chat-blk-2']: mk(300, 'hot', '没有针')
    };
    // withTail＝今天的产品自己会写进文件的那一格：分块桌面的 LS 有损尾巴快照（整包键在 #722 落盘时已删）
    if (withTail) idb[PFX + ':chat-msgs'] = JSON.stringify(mk(3, '尾巴', '没有针'));
    return JSON.stringify({ app: 'mochi', mode: 'chat', ls: { 'xy-home-v2:active-contact': 'default' }, idb: idb });
  };
  const runImport = async (tag, text) => {
    const ctx = await launch(tag);
    try {
      const page = await boot(ctx);
      await seedChunked(page);
      const r = await rev(page, async (t) => {
        const f = new File([t], 'mochi聊天记录_2026-09-18.json', { type: 'application/json' });
        if (!window.runChatAllImport) return { err: '没有导入入口' };
        window.runChatAllImport(f);
        for (let i = 0; i < 300; i++) { const m = document.getElementById('modal-mask'); if (m && !m.hidden) break; await new Promise((rr) => setTimeout(rr, 100)); }
        const pre = document.getElementById('modal-static') || document.getElementById('modal-text') || {};
        const preview = String(pre.textContent || '').slice(0, 200);
        const okb = document.getElementById('modal-ok');
        if (!okb) return { err: '没有确认按钮', preview: preview };
        okb.click();
        await new Promise((rr) => setTimeout(rr, 11000));
        const all = window.getChatMsgs ? (window.getChatMsgs() || []) : [];
        return { preview: preview, n: all.length, needle: all.some((m) => m && String(m.text || '').indexOf('只在冷头的扎针') >= 0) };
      }, text);
      return r;
    } finally { await ctx.close(); }
  };
  const a = await runImport('d', fileOf(true));
  const pvN = Number((String(a.preview || '').match(/：(\d+) 条/) || [])[1] || -1);
  ok(pvN >= 900, 'D1 预览报的条数＝拼出来的整本（旧＝按那条有损尾巴报 3 条，用户看见的「有几个字」也是谎）', '预览=' + String(a.preview).replace(/\n/g, ' / '));
  ok(a.n >= 900, 'D2 恢复之后这一桌仍是整本（旧＝被有损尾巴顶掉＝实测屏上只剩尾巴那几条）', '恢复后=' + a.n + ' err=' + (a.err || ''));
  ok(a.needle === true, 'D3 恢复之后冷头那条记录还在（旧＝块键被删光、老历史永久没了）');
  const b = await runImport('d2', fileOf(false));
  ok(b.n >= 900, 'D4 一份「只有块键、没有整包键」的备份也照样恢复成全量（旧＝lsObj/idbObj 的 TDZ 让整段组装静默不跑）', '恢复后=' + b.n + ' err=' + (b.err || '') + ' 预览=' + String(b.preview).slice(0, 70));
}

// ═════════ 组 5：等待窗到点 ≠ 这一发没读出来 ═════════
async function groupE() {
  const ctx = await launch('e');
  try {
    const page = await boot(ctx);
    const N = 12000;
    const seededN = await rev(page, ({ PFX, N, ND }) => {
      const arr = Array.from({ length: N }, (_, i) => ({ ts: 1690000000000 + i * 1000, side: 'in', text: '整包里的第' + i + '条' + (i === 3 ? ' ' + ND : '') + '，填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充填充' }));
      const tail = Array.from({ length: 300 }, (_, i) => ({ ts: 1700000000000 + i * 1000, side: 'in', text: '尾巴第' + i + '条' }));
      try { localStorage.setItem(PFX + ':chat-msgs', JSON.stringify(tail)); } catch (e) {}
      return new Promise((res) => {
        const q = indexedDB.open('mochi-db');
        q.onsuccess = () => {
          const t = q.result.transaction('kv', 'readwrite');
          t.objectStore('kv').put(JSON.stringify(arr), PFX + ':chat-msgs');
          t.objectStore('kv').put(JSON.stringify({ n: N, t: Date.now(), b: 12 * 1024 * 1024 }), PFX + ':chat-meta');
          t.oncomplete = () => res(N);
          t.onerror = () => res(-1);
        };
        q.onerror = () => res(-2);
      });
    }, { PFX, N, ND: ND_WHOLE });
    ok(seededN === N, 'S5 夹具诚实：库里一份 12000 条整包（≈12MB），localStorage 里另有一份 300 条尾巴（＝报障机 IDB 102MB vs LS 2.2MB 那两格的形状）', 'N=' + seededN);
    // 「等待窗到点」这件事不该靠真机器慢到什么程度这种运气：把 setTimeout 的延时当场压成 0，
    // 上层立刻拿到 undefined＝这一发被放弃是确定的事实，而 IDB 那一发请求照旧还在内核里跑。
    // 然后问两句：①被放弃的那一发有没有留下一个可等的口子；②口子后来给出的是不是库里那份真值。
    const late = await rev(page, ({ PFX }) => {
      const key = PFX + ':chat-msgs';
      const realST = window.setTimeout;
      window.setTimeout = function (fn, ms) { return realST.call(window, fn, (typeof ms === 'number' && ms >= 3000 && ms <= 60000) ? 0 : ms); };
      const p = window.idbGet(key, { minWaitMs: 4000 });
      return p.then(function (v) {
        const gaveUp = (v === undefined || v === null);
        const slot = (typeof window.idbLateRead === 'function') ? window.idbLateRead(key) : null;
        window.setTimeout = realST;
        if (!slot || typeof slot.then !== 'function') return { gaveUp: gaveUp, hasSlot: false, n: -1, needle: false };
        return slot.then(function (lv) {
          window.setTimeout = realST;
          let a = lv;
          try { if (typeof lv === 'string') a = JSON.parse(lv); } catch (e) {}
          return { gaveUp: gaveUp, hasSlot: true, n: Array.isArray(a) ? a.length : -2, needle: Array.isArray(a) ? a.some((m) => m && String(m.text || '').indexOf('只在整包深处的扎针') >= 0) : false };
        }, function () { window.setTimeout = realST; return { gaveUp: gaveUp, hasSlot: true, n: -3, needle: false }; });
      });
    }, { PFX });
    ok(late.gaveUp === true, 'S6 夹具诚实：这一发整包读的等待窗当场到点了（上层拿到的是 undefined＝旧行为下「读不到」的那一格）', JSON.stringify(late).slice(0, 120));
    ok(late.hasSlot === true, 'E1 窗到点之后，被放弃的那一发还留着一个可等的口子（旧＝结果被丢掉，上层只能重发一整包）', JSON.stringify(late).slice(0, 120));
    ok(late.n >= N && late.needle === true, 'E2 附议等下去拿到的就是库里那一份真值（旧＝这一发的结果永远没人能再拿到＝102MB 那份永远读不成、越小越读不成）', JSON.stringify(late).slice(0, 160));
  } finally { await ctx.close(); }
}

// ═════════ 组 6：旧契约 ═════════
async function groupR() {
  const ctx = await launch('r1');
  try {
    const page = await boot(ctx);
    await rev(page, ({ PFX }) => {
      const arr = Array.from({ length: 120 }, (_, i) => ({ ts: 1700000000000 + i * 1000, side: i % 2 ? 'out' : 'in', text: '小历史第' + i + '条 needle-small-hist' }));
      return new Promise((res) => {
        const q = indexedDB.open('mochi-db');
        q.onsuccess = () => {
          const t = q.result.transaction('kv', 'readwrite');
          t.objectStore('kv').put(JSON.stringify(arr), PFX + ':chat-msgs');
          t.objectStore('kv').put(JSON.stringify({ n: 120, t: Date.now(), b: 6000 }), PFX + ':chat-meta');
          t.oncomplete = () => res('ok');
        };
      });
    }, { PFX });
    await enterChat(page);
    let fr = 0;
    for (let i = 0; i < 20; i++) { fr = await fullCount(page); if (fr >= 120) break; await wait(1000); }
    ok(fr >= 120, 'R3 小历史（未分块）整包读路径一字没变', '全量=' + fr);
    await sendOnce(page, '小历史里新发的一条');
    await wait(11000);
    ok(await countIdb(page, PFX + ':chat-msgs') >= 121, 'R4 小历史照旧整包落盘（没被误升级成分块格式）', '整包=' + await countIdb(page, PFX + ':chat-msgs'));
    const blk = await listIdb(page, ':chat-blk-');
    ok(blk.length === 0, 'R5 这个桌面没有被无故分块（分块门仍只在 >4MB 时开）', blk.join(','));
  } finally { await ctx.close(); }
  const ctx2 = await launch('r2');
  try {
    const p2 = await boot(ctx2);
    await enterChat(p2);
    await wait(15000);
    const freshN = await countIdb(p2, PFX + ':chat-msgs');
    ok(freshN === -1 || freshN <= 60, 'R6 全新桌面（无账本）确认空库路径照旧：没被写出几百条的脏整包', 'chat-msgs=' + freshN);
  } finally { await ctx2.close(); }
}

const GROUPS = [['A 尾块重写的全量账／账本／隔场可达', groupA], ['B 搜索口径与真跳转', groupB], ['C 热片读不成 ≠ 没有历史', groupC], ['D 备份恢复以整本为准', groupD], ['E 迟到落地的整包读', groupE], ['R 旧契约（两侧皆绿）', groupR]];
const ONLY = (process.env.MOCHI_1360_ONLY || '').split(',').map(s2 => s2.trim()).filter(Boolean);
for (const [name, fn] of GROUPS) {
  if (ONLY.length && ONLY.indexOf(name.charAt(0)) < 0) { console.log('（跳过 ' + name + '）'); continue; }
  console.log('\n〔' + name + '〕');
  try { await fn(); } catch (e) { ok(false, '本组跑挂＝记一条红（崩了没读数＝假绿）：' + name, String(e && (e.stack || e.message) || e).slice(0, 200)); }
}

// ═════════ 逻辑锚（针落在修复面上） ═════════
console.log('\n〔S〕逻辑锚：产物里必须是本批的判据，不是名字');
try {
  const chatJs = readFileSync(join(root, 'js', 'chat.js'), 'utf8');
  const idbJs = readFileSync(join(root, 'js', 'idb.js'), 'utf8');
  const dbJs = readFileSync(join(root, 'js', 'data-backup.js'), 'utf8');
  ok(/total: headCnt \+ arr\.length/.test(chatJs), 'S-a1 全量账＝头块条数＋尾段条数（删＝尾块重写又把自己报短）');
  ok(/const ledgerN = \(chatBlkIdx && typeof chatBlkTotal === 'number'/.test(chatJs), 'S-a2 账本也按全量记（#90 的尺子不再自己变短）');
  ok(/r\[0\] === false && r\[1\] === false && r\[2\] === false/.test(chatJs), 'S-a3 「没有历史」要整包／增量日志／分块索引一起作证');
  ok(/window\.idbGet\(idbIdxKey\)/.test(chatJs), 'S-a4 二次复核同样把分块索引当证人（#358 那把复尺不再只问旧两键）');
  ok(/const src = chatSearchSource\(\);/.test(chatJs) && /chatColdHead\.length\) chatRebaseCold\(\)/.test(chatJs), 'S-a5 搜索的尺子＝全量口径（已取回的头先并入）');
  ok(/更早的记录还在取回/.test(chatJs), 'S-a6 还没取回的那一截不写「没有找到」（不把读不到谎报成没有）');
  ok(/chatReadAwaitable\(myPrefix \+ ':chat-msgs'/.test(chatJs) && /chatWholeReadKey === _pkgKey/.test(chatJs), 'S-a7 整包读走「附议在飞那一发」的入口＋在飞让路闸');
  ok(/window\.idbLateRead = function \(key\) \{/.test(idbJs), 'S-b1 数据层给出「迟到但读成」那一发一个可等的口子');
  ok(/if \(full\.length >= curN\) \{ idbObj\[msgKey\] = full; lsObj\[msgKey\] = full; \}/.test(dbJs), 'S-c1 恢复以拼出来的整本为准，两段一起对齐');
  ok(dbJs.indexOf("full.join('") < 0, 'S-c2 旧那把「按字符串长度比」的尺子已整块撤掉（不是加宽：复活＝尾巴又赢）');
  const lsObjAt = dbJs.indexOf("const lsObj = (data && typeof data.ls === 'object')");
  // 比较对象＝分块组装那一段自己（不是文件顶部 CHAT_KEY_RE 里也提到 chat-blk-idx 的那一行）
  const asmAt = dbJs.indexOf("if (!/:chat-blk-idx$/.test(k)) return;");
  ok(lsObjAt >= 0 && asmAt >= 0 && lsObjAt < asmAt, 'S-c3 lsObj/idbObj 声明在分块组装之前（TDZ 静默不跑那条洞已堵）', 'lsObj@' + lsObjAt + ' 组装@' + asmAt);
} catch (e) { ok(false, '逻辑锚读取失败', String(e && e.message).slice(0, 160)); }
console.log('\n未捕获异常：' + (errs.length ? errs.slice(0, 5).join(' | ') : '无'));
ok(errs.length === 0, 'Z1 全程零未捕获异常（修坏不是读崩）', errs.slice(0, 3).join(' | '));
console.log('\n读数：通过 ' + pass + ' ／ 断言失败 ' + fail);
server.close();
process.exit(fail ? 1 : 0);

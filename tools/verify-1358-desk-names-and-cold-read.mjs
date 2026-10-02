// ===== 常驻回归脚本 #1358：主页昵称/称呼那一格的绘制时机 ＋ 信箱/朋友圈的「冷读那一发」（OPPO Reno14／Edge 153 实报）
// 用法：node tools/verify-1358-desk-names-and-cold-read.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-28 直派：「主页昵称退出就会刷新成原始状态，然后昵称小字 TA 他 她 设置了但是没用，
//   每次都是TA」＋「信箱 朋友圈前一秒还有后一秒点进去突然没了，没有刷新或者更新，就是突然消失了」；
//   设备 PLA110／Android 16／Edge 153 桌面 PWA；随附 mochi-diag-2026-09-27-14-43-…docx；
//   用户明说「不同型号不同浏览器可能出现不同问题，不要覆盖修改导致 bug 反复出现，这个问题其他设备型号也有出现」）：
//   那张诊断单的上游事实＝localStorage 整域在本机永久写不进去（LS 写探针 QuotaExceededError、本会话 2251 次
//   写入被拒；整域 202 键 ≈10MB，其中【非本项目】143 键 ≈10MB 是 GitHub Pages 同源兄弟站点占的）。
//   这台机器上「每一格都只剩 IndexedDB 一份」，于是三件各自独立的事一起露头（判据一律零机型／零 UA 分支）。
//
// 三件事（无头真跑产物量出来的，红侧读数逐字附在每条断言里）：
//   ① 主页那两格昵称（#lbl-partner／#lbl-user）只在脚本执行期拿一次同步读数画过（bindLabel），之后只有
//      contact-switched 重画。库里那一份要等异步回填才进内存 ⇒ 那一发读到 null，界面整场停在 template 的
//      字面量「TA／我」＝「退出就刷新成原始状态」。同一条「回填完成后重绘」清单（v3.5.113／#265／
//      v3.5.116／#769）里的桌面摸鱼值标签同场已经画对——实测红侧：store='宝贝'、摸鱼小字='宝贝 摸鱼值'，
//      而 #lbl-partner 仍是 'TA'，切一次桌面才归位（＝只差没进那份清单，不是数据没落库）。
//   ② 那两格的回退值是写死的 'TA' 字面量，从不问 window.taWord()（称呼存 partner-gender，他/她/TA）。
//      实测红侧：partner-gender='she'、taWord()='她'，主页那一格照旧 'TA'＝「设置了但是没用，每次都是TA」。
//   ③ 信箱／朋友圈的主键是「>200KB 只进库」的大键，#1195e 切后台按体积放掉其内存副本＝正解；回来之后
//      那一发同步读交不出主键，页面把「没读到」陈述成「没有」：实测红侧屏上 0 封＋「还没有收到信，等等
//      TA 吧」，而同一条键下一读＝20 封、库里 20 封完好，且没人再画一次（朋友圈同型：0 条＋「还没有动态」）。
//      #1336 给朋友圈上的是【写回侧】的闸（且只在「本会话见过权威」那一支）；信箱侧连读侧带写侧都没有这一尺。
//
// 收口（三处共用层，逐页零改动）：
//   idb.js：给 xyStore 加 whenBigKeyBack(k, cb)——问一趟并等它回来；只认 bigHydAsk 的 'ok'，
//     'absent'（库里确无此键）与 'unknown'（这次问不出）都不回调＝既不把「没读到」讲成「没有」，
//     也不替「没有」作证；踢趟与合流复用 #1349 的单次飞行闸，不新挂第二脚。
//   personalize.js：桌面两格昵称的「读数＋回退」收成一个 paintDeskNames（TA 侧回退问 taWord()），
//     列进既有那份回填后重绘清单，并监听 ta-word-changed 当场跟随。
//   mail.js／feed.js：读数那一发用数据层现成的尺（#1342 awaitingBigKey）判「残缺」——信箱补 #1336
//     同款三件事（空态不说「没有」＋残缺读数没有整包写回资格＋回来重画），朋友圈把判据从「见过权威」
//     放宽成「见过权威 或 数据层说库里本该有」。
//
// 断言：
//   A 组 本批新契约（红侧＝纯 HEAD 读数）：A1 主页 TA 侧昵称＝库里那份（红侧逐字 'TA'）／
//     A2 我侧同理（红侧 '我'）／A3 未设昵称时那一格跟随称呼（红侧 'TA' vs taWord '她'）／
//     A4 改称呼当场跟随（不切桌面）／A5 信箱冷读之后那一屏重画成 20 封（红侧 0）／
//     A6 冷读那一发信箱空态不许陈述「还没有收到信」（红侧逐字谎报）／A7 冷读那一发里最正常的一发
//     寄信不许把库里 20 封顶成 1 封（独立会话，红侧整包顶包）／A8 朋友圈冷读之后重画 20 条／
//     A9 冷读那一发朋友圈空态不许陈述「还没有动态」
//   B 组 旧契约一字不许动（两侧皆绿）：B1 库里确实没有＝照旧如实宣告空态（不许挂死「正在读取」）／
//     B2 LS 健康会话里改昵称当场生效／B4 #1336 的写回闸门照旧（放掉副本后点赞，库里条数不减）／
//     B5 朋友圈同口径：全新空库照旧宣告「还没有动态」
//   A3b 优先序不许被新回退改错：设过昵称时那一格用昵称、称呼只在没昵称时顶上（红侧因 A1 的绘制缺失连带红）
//   C 组 数据层那只新口：C1 库里确无此键一声都不叫（'absent' 不回调）／C2 同键两次只问库一趟、两次回调都兑现／
//     C3 此刻读得到的键不空等
//   S 组 产物静态锚（本批新代码真在产物里）
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

const G = 'xy-home-v2';
const NS = G + ':default';
const K_FEED = G + ':feed-posts';
const K_MAIL = NS + ':mail-letters';
const pad = (n) => 'x'.repeat(n);
// 夹具值与「种进库里的值」刻意不同名（昵称＝宝贝／摸鱼小字里的名字应跟着它），且每条正文都够大：
// 单键 >256KB 才会被 #1195e 在切后台时放掉内存副本（＝症状③的触发条件本身）
const mkFeed = (n, tag) => JSON.stringify(Array.from({ length: n }, (_, i) => ({
  id: tag + '_' + i, role: 'me', owner: 'default', authorName: '测试者', authorAv: '', taName: '宝贝', taAv: '',
  content: '动态 ' + tag + ' 第' + i + ' ' + pad(14000), imgs: [], ts: Date.now() - i * 60000, likes: [], comments: [],
})));
const mkMail = (n, tag) => JSON.stringify(Array.from({ length: n }, (_, i) => ({
  id: tag + '_' + i, type: i % 2 ? 'sent' : 'received', title: '信 ' + tag + i,
  content: '正文 ' + tag + ' 第' + i + ' ' + pad(14000), tm: Date.now() - i * 60000, read: false,
})));
const nOf = (raw) => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.length : -2; } catch (e) { return raw == null ? 'NULL' : -3; } };
// 把 localStorage 打成「整域写不进去」＝报障那张单的「LS 写探针：写入失败(QuotaExceededError) ＋
// 本会话写入被拒 2251 次」形态。两步：①真的往配额墙上撞（LS 里因此留着站内外的旧键，形态与真机一致）；
// ②把 setItem 钉成每次必抛——Chromium 的配额是动态按磁盘算的，光撞墙在快机上不一定能让 1 字节探针也抛，
// 而这台机器上「每一格都只剩库里一份」这件事才是症状的上游，判据取「这一发 setItem 抛没抛」（#1335 那把尺）。
const KILL_LS = `(() => {
  const ladder = [262144, 65536, 16384, 4096, 1024, 256, 64, 16, 4, 2, 1];
  let i = 0, rounds = 0, progress = true, written = 0;
  while (progress && rounds < 60) { progress = false; rounds++;
    for (const s of ladder) { try { localStorage.setItem('f' + (i++), 'y'.repeat(s)); written++; progress = true; } catch (e) {} } }
  window.__lsReject = 0;
  localStorage.setItem = function () {
    window.__lsReject++;
    const err = new Error('QuotaExceededError: simulated full origin quota');
    err.name = 'QuotaExceededError';
    throw err;
  };
  let tiny = 'ok'; try { localStorage.setItem('__p', '1'); localStorage.removeItem('__p'); } catch (e) { tiny = e && e.name; }
  return { written, tiny, reject: window.__lsReject, lsN: localStorage.length };
})()`;

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
  await page.waitForTimeout(5000);
}
// 只灌库（不经 xyStore.set ⇒ LS／写日志都不留＝这台机器上「只剩库里一份」那一族的真实形态）
async function seedIdb(page, pairs) {
  await page.evaluate((m) => Promise.all(Object.keys(m).map((k) => window.idbSet(k, m[k]))), pairs);
  await page.waitForTimeout(2000);
}
const rawIdb = (page, key) => page.evaluate((k) => new Promise((res) => {
  let rq; try { rq = indexedDB.open('mochi-db', 1); } catch (e) { return res('ERR'); }
  rq.onsuccess = () => { try {
    const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get(k);
    g.onsuccess = () => res(g.result === undefined ? null : g.result); g.onerror = () => res('ERR');
  } catch (e) { res('ERR'); } };
  rq.onerror = () => res('OPENERR');
}), key);
const desk = (page) => page.evaluate(() => ({
  lbl: (document.getElementById('lbl-partner') || {}).textContent,
  lblUser: (document.getElementById('lbl-user') || {}).textContent,
  nick: (() => { try { return window.xyStore('xy-home-v2:default').get('lbl-partner'); } catch (e) { return 'ERR'; } })(),
  fish: (document.querySelector('#weekend-ta-name .pair i') || {}).textContent,
  taWord: window.taWord ? window.taWord() : 'NOFN',
  state: window.mochiDataState ? window.mochiDataState() : '?',
})).catch((e) => ({ err: String(e).slice(0, 80) }));
const mailView = (page) => page.evaluate(() => ({
  items: document.querySelectorAll('.mail-item').length,
  txt: ((document.getElementById('mail-in-list') || {}).textContent || '').slice(0, 30),
  store: (() => { try { return JSON.parse(window.xyStore('xy-home-v2:default').get('mail-letters')).length; } catch (e) { return window.xyStore('xy-home-v2:default').get('mail-letters') === null ? 'NULL' : 'X'; } })(),
}));
const feedView = (page) => page.evaluate(() => ({
  cards: document.querySelectorAll('#feed-list .feed-post').length,
  txt: ((document.getElementById('feed-list') || {}).textContent || '').slice(0, 30),
  store: (() => { try { return JSON.parse(window.xyStore('xy-home-v2').get('feed-posts')).length; } catch (e) { return 'NULL'; } })(),
}));
async function releaseCopies(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return window.__mochiHidden ? 'hidden' : 'visible'; } });
    window.__mochiHidden = true; document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__mochiHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(60);
}
async function goHome(page) {
  await page.evaluate(() => { document.querySelectorAll('.page').forEach((x) => { x.hidden = true; }); const h = document.getElementById('page-phone'); if (h) h.hidden = false; });
  await page.waitForTimeout(400);
}

// ========== 会话 1：昵称／称呼（症状 ①②）==========
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('S1 ' + String(e.message).slice(0, 110)));
  await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p); await waitReady(p);
  // 症状①的尺子不赌时序：无头实测里 bindLabel 那一次同步读有时排在回填之前（此时那一格整场停在
  // 模板字面量，实测读数 store='宝贝'／lbl='TA'，切一次桌面才归位），有时排在之后（看着没事）。
  // 契约本身是结构事实＝「回填完成」那次重绘清单里有没有这两格 ⇒ 按同一事件问一次。
  const s1 = await p.evaluate(async () => {
    const s = window.xyStore('xy-home-v2:default');
    s.remove('lbl-partner'); s.remove('lbl-user'); s.remove('partner-gender');
    const before = { lbl: document.getElementById('lbl-partner').textContent, mine: document.getElementById('lbl-user').textContent };
    // 值此刻才进存储层（＝回填把库里那一份交出来的同一时刻），而那一格早在回填之前画过了
    s.set('lbl-partner', '宝贝'); s.set('lbl-user', '测试者'); s.set('partner-gender', 'she');
    document.dispatchEvent(new Event('mochi-restore-done'));
    await new Promise((r) => setTimeout(r, 900));
    const after = { lbl: document.getElementById('lbl-partner').textContent, mine: document.getElementById('lbl-user').textContent };
    return { before, after, store: s.get('lbl-partner') };
  });
  ok(s1.store === '宝贝' && s1.before.lbl === 'TA', 'S1 夹具诚实：那一格先按空值画成模板字面量，之后值才交出来', JSON.stringify(s1));
  ok(s1.after.lbl === '宝贝', 'A1 回填完成那一次重绘里，主页 TA 侧昵称＝库里那一份（红侧 ' + s1.after.lbl + '）', JSON.stringify(s1));
  ok(s1.after.mine === '测试者', 'A2 我侧同理（红侧 ' + s1.after.mine + '）', JSON.stringify(s1));
  const d1 = await desk(p);
  // A3／B3：设过昵称时仍显示昵称（不被称呼顶掉）
  ok(d1.lbl === '宝贝' && d1.taWord === '她', 'A3b 设过昵称＝那一格用昵称，且称呼本身也真的生效（taWord=' + d1.taWord + '）', JSON.stringify(d1));
  // A3：新建一个从未设过昵称的桌面、只设称呼＝「设置了但是没用，每次都是TA」那一格的真形态
  await p.evaluate(() => {
    const id = window.createContact('1358无昵称桌面');
    window.xyStore('xy-home-v2:' + id).set('partner-gender', 'she');
    window.setActiveContact(id);
  });
  await p.waitForTimeout(1500);
  const d2 = await desk(p);
  ok(d2.taWord === '她' && d2.lbl === '她', 'A3 未设昵称时那一格跟随称呼（红侧 ' + d2.lbl + '，而 taWord()=' + d2.taWord + '＝用户口径「设置了但是没用，每次都是TA」）', JSON.stringify(d2));
  // A4：在这个从未设过昵称的桌面上改称呼 ⇒ 不切桌面也要当场跟随
  await p.evaluate(() => {
    const cid = window.__activeCid || 'default';
    window.xyStore('xy-home-v2:' + cid).set('partner-gender', 'he');
    try { document.dispatchEvent(new CustomEvent('ta-word-changed', { detail: { id: cid } })); } catch (e) {}
  });
  await p.waitForTimeout(800);
  const d3 = await desk(p);
  ok(d3.taWord === '他' && d3.lbl === '他', 'A4 改称呼当场跟随（不切桌面；红侧 ' + d3.lbl + '）', JSON.stringify(d3));
  await p.evaluate(() => { window.setActiveContact('default'); });
  await p.waitForTimeout(1200);
  // B2：LS 健康会话里，改昵称当场生效（bindLabel 那一次直写 textContent 的旧行为不许被改坏）
  await p.evaluate(() => { const e = document.getElementById('lbl-partner'); if (e) e.click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const i = document.querySelector('#modal-mask input'); const ce = document.querySelector('#modal-mask .ce-box');
    if (i) { i.value = '昵称改了'; i.dispatchEvent(new Event('input', { bubbles: true })); }
    if (ce) ce.textContent = '昵称改了';
    const b = document.getElementById('modal-ok'); if (b) b.click();
  });
  await p.waitForTimeout(1000);
  const d4 = await desk(p);
  ok(d4.lbl === '昵称改了' && d4.nick === '昵称改了', 'B2 真点昵称改完当场生效（读数与那一格一起=' + d4.lbl + '）', JSON.stringify(d4));
  await p.close();
}

// ========== 会话 2：信箱／朋友圈冷读（症状 ③）＋ 空态不许说谎 ==========
// 现场形状＝报障那台机器：LS 整域写不进去（剥图快照落不回＝兜底层归零），主键只剩库里一份，
// 而那一发同步读交不出它（#975 启动预算挂起／切后台放掉内存副本＝#1349 名册在册，两种都由
// 数据层那句 awaitingBigKey 说「库里本该有一份」）。
// ⚠ 夹具纪律：判「有没有说谎」要在那一发 render 之后立刻读 DOM，中间不要去 get 那两条主键——
//   xyStore.get 撞上名册会当场补踢一趟，值回来把谎报窗口抹平＝两侧同绿（假绿）。
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('S2 ' + String(e.message).slice(0, 110)));
  await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p); await waitReady(p);
  const kill = await p.evaluate(KILL_LS);
  ok(kill.tiny === 'QuotaExceededError', 'S2a 夹具诚实：LS 整域写不进去（1 字节探针 QuotaExceededError＝诊断单同型，剥图快照这一层在这台机器上恒空）', JSON.stringify(kill));
  await seedIdb(p, { [K_MAIL]: mkMail(20, 'seed'), [K_FEED]: mkFeed(20, 'seed') });
  // 这两格此刻的状态＝「启动回填把它挂起／内存副本已被放掉」：内存与 LS 双双为空，库里那一份好好躺着
  const st = await p.evaluate(() => {
    window.__xyIdbDeferredKeys = ['xy-home-v2:feed-posts', 'xy-home-v2:default:mail-letters'];
    const s = window.xyStore('xy-home-v2'), m = window.xyStore('xy-home-v2:default');
    return { awaitingFeed: s.awaitingBigKey('feed-posts'), awaitingMail: m.awaitingBigKey('mail-letters'),
      memFeed: s.get('feed-posts') === null ? 'NULL' : 'HAS', memMail: m.get('mail-letters') === null ? 'NULL' : 'HAS',
      lsSnapMail: (localStorage.getItem('xy-home-v2:default:mail-letters-snap') || '').length,
      lsSnapFeed: (localStorage.getItem('xy-home-v2:feed-posts-snap') || '').length };
  });
  ok(st.awaitingFeed && st.awaitingMail && st.memFeed === 'NULL' && st.memMail === 'NULL' && st.lsSnapMail === 0 && st.lsSnapFeed === 0,
    'S2b 夹具诚实：两格都是「同步层交不出、数据层说库里本该有、LS 剥图快照为空」（红侧据此画空态＝用户那句「点进去突然没了」）', JSON.stringify(st));
  await p.evaluate(() => { const a = document.querySelector('.app[data-app="feed"]'); if (a) a.click(); });
  await p.waitForTimeout(150);
  const fCold = await p.evaluate(() => ({ cards: document.querySelectorAll('#feed-list .feed-post').length,
    txt: ((document.getElementById('feed-list') || {}).textContent || '').slice(0, 30) }));
  ok(!/还没有动态/.test(fCold.txt), 'A9 冷读那一发朋友圈不许当面宣告「还没有动态」（红侧逐字＝「还没有动态，TA 会不定期分享生活」而库里 20 条）', JSON.stringify(fCold));
  await p.waitForTimeout(5000);
  const f2 = await feedView(p);
  ok(f2.cards === 20, 'A8 朋友圈：库里那一份交回来之后这一屏重画成 20 条（红侧屏上 ' + f2.cards + ' 条）', JSON.stringify(f2));
  await goHome(p);
  await p.evaluate(() => { const a = document.querySelector('.app[data-app="mail"]'); if (a) a.click(); });
  await p.waitForTimeout(150);
  const mCold = await p.evaluate(() => ({ items: document.querySelectorAll('.mail-item').length,
    txt: ((document.getElementById('mail-in-list') || {}).textContent || '').slice(0, 30) }));
  ok(!/还没有收到信/.test(mCold.txt), 'A6 冷读那一发信箱不许当面宣告「还没有收到信」（红侧逐字＝「还没有收到信，等等 TA 吧」而库里 20 封）', JSON.stringify(mCold));
  await p.waitForTimeout(5000);
  const m2 = await mailView(p);
  ok(m2.items === 20, 'A5 信箱：库里那一份交回来之后这一屏重画成 20 封（红侧屏上 ' + m2.items + ' 封）', JSON.stringify(m2));
  // B4：#1336 写回闸门照旧——值回到内存之后再切后台放掉一次，然后做一次最正常的点赞
  await goHome(p);
  await releaseCopies(p);
  await p.evaluate(() => { const a = document.querySelector('.app[data-app="feed"]'); if (a) a.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(() => { const b = document.querySelector('#feed-list .feed-post .feed-like'); if (b) b.click(); });
  await p.waitForTimeout(3500);
  ok(nOf(await rawIdb(p, K_FEED)) === 20, 'B4 #1336 那条「残缺读数没有整包写回资格」照旧（放掉副本后点一次赞，库里仍 20 条）', 'db=' + nOf(await rawIdb(p, K_FEED)));
  await p.close();
}

// ========== 会话 3：冷读那一发里的寄信不许顶掉库里那 20 封（A7，独立会话）==========
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('S3 ' + String(e.message).slice(0, 110)));
  await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p); await waitReady(p);
  await seedIdb(p, { [K_MAIL]: mkMail(20, 'keep') });
  ok(nOf(await rawIdb(p, K_MAIL)) === 20, 'S3 夹具诚实：库里 20 封（寄信之前）');
  // 报障那台机器的上游条件：LS 整域写不进去（剥图快照也落不回）⇒ 冷读那一发没有任何兜底
  const kill = await p.evaluate(KILL_LS);
  ok(kill.tiny === 'QuotaExceededError', 'S3a 夹具诚实：LS 整域写不进去（快照兜底层归零）', JSON.stringify(kill));
  await p.evaluate(() => { window.__xyIdbDeferredKeys = ['xy-home-v2:default:mail-letters']; });
  await goHome(p);
  // 冷读那一发里最正常的一发：点进信箱（这一发的同步读数交不出主键）后【同一个同步回合】立刻寄信
  await p.evaluate(() => {
    const a = document.querySelector('.app[data-app="mail"]'); if (a) a.click();
    const w = document.getElementById('mail-open-write'); if (w) w.click();
    const t = document.getElementById('mail-input');
    if (t) { t.value = '冷读那一发里寄出的信'; t.dispatchEvent(new Event('input', { bubbles: true })); }
    const s = document.getElementById('mail-send'); if (s) s.click();
  });
  await p.waitForTimeout(6000);
  const after = nOf(await rawIdb(p, K_MAIL));
  ok(after >= 20, 'A7 冷读那一发的寄信不许把库里 20 封整包顶掉（红侧读数 db=' + after + '＝用户口径「点进去没了，之后真的没了」）', 'db=' + after);
  await p.close();
}

// ========== 会话 4：旧契约——库里确实没有时不许挂「正在读取」（B1）＋ C 组那只新口 ==========
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('S4 ' + String(e.message).slice(0, 110)));
  await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(p); await waitReady(p);
  await p.evaluate(() => { const a = document.querySelector('.app[data-app="mail"]'); if (a) a.click(); });
  await p.waitForTimeout(2500);
  const empty = await mailView(p);
  ok(empty.items === 0 && /还没有收到信/.test(empty.txt), 'B1 库里确实没有＝照旧如实宣告空态（不许改成永久「正在读取」）', JSON.stringify(empty));
  await goHome(p);
  await p.evaluate(() => { const a = document.querySelector('.app[data-app="feed"]'); if (a) a.click(); });
  await p.waitForTimeout(2500);
  const emptyF = await feedView(p);
  ok(emptyF.cards === 0 && /还没有动态/.test(emptyF.txt), 'B5 朋友圈同口径：全新空库照旧宣告「还没有动态」', JSON.stringify(emptyF));
  // C 组：whenBigKeyBack 只认 'ok'，且不叠发、读得到时不空等
  const cRes = await p.evaluate(async () => {
    const out = { has: typeof window.xyStore('xy-home-v2').whenBigKeyBack, cbAbsent: 0, ready: 'nope', calls: 0, cbArrive: 0, awaiting: 'nope' };
    const s = window.xyStore('xy-home-v2');
    if (out.has === 'function') {
      // C3 此刻读得到的键 ⇒ 不空等，直接按同一口径叫一声
      s.set('zz1358-small', '1');
      s.whenBigKeyBack('zz1358-small', function () { out.ready = 'not-awaited'; });
      // 造两格「被 #1195e 放掉过」的键（≥256KB ⇒ idbMemoReleaseBig 会按体积放掉并登进名册）
      s.set('zz1358-big', 'y'.repeat(300 * 1024));
      s.set('zz1358-gone', 'y'.repeat(300 * 1024));
      await new Promise((r) => setTimeout(r, 1500));
      window.idbMemoReleaseBig(256 * 1024);
      out.awaiting = s.awaitingBigKey('zz1358-big') ? 'blind' : 'not-blind';
      // C1 库里那一份随后真没了（别的通道清的）⇒ 'absent' ⇒ 一声都不叫（不替「没有」作证，也不空重画）
      try { window.idbDelete('xy-home-v2:zz1358-gone'); } catch (e0) {}
      await new Promise((r) => setTimeout(r, 600));
      s.whenBigKeyBack('zz1358-gone', function () { out.cbAbsent++; });
      // C2 同键两次 ⇒ 合流成一次真读，且值回来时两次回调都兑现
      const orig = window.idbHydrateKey; let n = 0;
      window.idbHydrateKey = function () { n++; return orig.apply(window, arguments); };
      s.whenBigKeyBack('zz1358-big', function () { out.cbArrive++; });
      s.whenBigKeyBack('zz1358-big', function () { out.cbArrive++; });
      await new Promise((r) => setTimeout(r, 2500));
      out.calls = n;
      window.idbHydrateKey = orig;
      try { s.remove('zz1358-small'); s.remove('zz1358-big'); s.remove('zz1358-gone'); } catch (e) {}
    }
    await new Promise((r) => setTimeout(r, 1200));
    return out;
  });
  ok(cRes.has === 'function', 'S2 数据层那只新口在产物里（xyStore.whenBigKeyBack）', JSON.stringify(cRes));
  ok(cRes.has === 'function' && cRes.cbAbsent === 0, 'C1 问出「库里确无此键」＝不回调（不把「没读到」讲成「没有」，也不空重画一次）', JSON.stringify(cRes));
  ok(cRes.ready === 'not-awaited', 'C3 此刻读得到的键不空等（直接按同口径叫一声）', JSON.stringify(cRes));
  ok(cRes.awaiting === 'blind', 'C2a 夹具诚实：idbMemoReleaseBig 放掉过的那一格，awaitingBigKey 说「库里本该有」', JSON.stringify(cRes));
  ok(cRes.calls === 1 && cRes.cbArrive === 2, 'C2b 同键两次只问库一趟（合流复用 #1349/#1218 那一只单次飞行闸），且值回来时两次回调都兑现', JSON.stringify(cRes));
  await p.close();
}

// ========== S 组：产物静态锚（本批新代码真在产物里，不在别处）==========
{
  const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
  const idbJs = read('js/idb.js') + read('index.html');
  const perJs = read('js/personalize.js');
  const mailJs = read('js/mail.js');
  const feedJs = read('js/feed.js');
  ok(/whenBigKeyBack\(k, cb\) \{/.test(idbJs), 'S3 whenBigKeyBack 的定义在产物里');
  ok(/if \(st !== 'ok'\) return;/.test(idbJs), 'S4 只认「ok」那道闸在产物里');
  ok(/function paintDeskNames\(\) \{/.test(perJs), 'S5 桌面两格昵称的共用绘制在产物里');
  ok(/paintDeskNames\(\); \} catch \(e\) \{\} \/\/ #1358a/.test(perJs), 'S5b 这一格真在「回填完成后重绘」清单里（删掉那一行＝库里那份昵称整场不上屏）');
  ok(/return key === 'lbl-partner' \? \(window\.taWord \? window\.taWord\(\) : 'TA'\) : '我';/.test(perJs), 'S6 TA 侧回退问 taWord() 那句在产物里（红侧＝写死「TA」）');
  ok(/addEventListener\('ta-word-changed'/.test(perJs), 'S7 称呼变更当场重绘的监听在产物里');
  ok(/awaitingBigKey: \(k\) => \{ const d = dyn\(\); return !!\(d\.awaitingBigKey && d\.awaitingBigKey\(k\)\); \}/.test(read('js/contacts.js')), 'S11 那三句问话从 activeStore 门面也转出来（缺＝走门面的那页够不到这把尺）');
  ok(/mailSyncCold = true;/.test(mailJs), 'S8 信箱残缺读数旗在产物里');
  ok(/if \(!cid && mailSyncCold\) \{/.test(mailJs), 'S9 信箱残缺期整包写回闸门在产物里');
  ok(/feedAuthSeen \|\| \(store\.awaitingBigKey && store\.awaitingBigKey\(KEY\)\)/.test(feedJs), 'S10 朋友圈判据放宽那一句在产物里');
}

ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', errs.slice(0, 4).join(' | '));
console.log('\n===== 读数：' + pass + ' 绿 / ' + fail + ' 红 =====');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);

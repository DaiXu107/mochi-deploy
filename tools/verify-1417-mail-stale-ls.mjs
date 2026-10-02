// ===== 回归脚本 #1417：信箱「后台说有回信、点进信箱找不到」＋自救恢复按钮（作者直派直派「并且也需要新增自救的恢复按钮」）=====
// 用法：node tools/verify-1417-mail-stale-ls.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 报障（红米 K80 Chrome 首报，作者明说其他机型同现）：后台通知弹窗说 20:21 联系人回了一封信，点进信箱找不到。
//   #1454 只读取证件逐字读数：那封信**就在 IndexedDB 里**（库直读 150 封／带 TA 回信 6 封／最近 09/29 20:21），
//   而报障机 localStorage 写不进去（本会话 213 次写入被拒）⇒ 同一格停在 09/26 的旧账（145 封）。
//   xyStore.get 的读序是「内存 → LS」、从不读 IDB ⇒ 页面被系统回收后重开读到的都是那份旧账，那封信就「不见了」；
//   更危险的是写回侧：残缺旗 mailSyncCold 原来只在「读空」时落下（读到旧值不落）⇒ 下一次再正常不过的寄信会把
//   库里那整包（含那封回信）换成这页旧账＝永久丢失。
//
// 本批收口三件事：① 读侧认旧账（数据层 cs.lsStale 第五格证据）；② 写侧判据合一（mailReadIncomplete）；
//   ③ 自救恢复（mailRescueRun／列表上方提示条按钮／信件数据页常驻按钮）。
//
// 无头环境的诚实边界：报障的前提是「localStorage 真写失败」，无头里塞不满配额、复现不出「同步口读到旧账」那一刻
//   （idbRestore 会把库里那份灌进 memoryCache，同步口就不是旧账了）。所以本尺不去伪造存储满，而是直接验**本批新增的
//   恢复内核**（window.mailRescueRun＝提示条按钮与常驻按钮共同走的那一条）：LS 145 / 库 150 时问库→字段级合并→
//   写回→屏上 150；本地独有那封不被库版顶掉（并集语义）；库里没有该键时如实报 absent 不假装成功。真实存储满场景由
//   #1454 只读取证口在真机复核。
//
// 断言：
//   A 组 恢复内核（本批新增，红侧＝纯 HEAD 产物没有这一族函数，window.mailRescueRun 不存在）：
//     A1 window.mailRescueRun 是个函数／A1b 直读库的 window.idbGet 在位（前置能力）
//     A2 LS 145 / 库 150 → 一问库就合并：ok=true、before=145、after=150
//     A3 合并后同步口（xyStore.get）也读到 150——库那份真写回本地了，不是只在内存里画一次
//     A4 并集语义：本地独有（库里没有）那一封不被库版顶掉（after=151）
//     A5 带 TA 回信计数如实报到（rp＝库里那几封 partnerReply 的信）
//     A6 库里没有这一格 → 如实报 absent，不假装成功
//     A7 合并后屏上列表条数＝合并后条数（重绘这一口接上了）
//   B 组 作者直派的「自救恢复按钮」两处落点（静态 DOM 常驻，任何时刻可点）：
//     B1 信件数据页常驻入口 #mail-rescue-data 在 DOM 里（红侧也没有这一枚）
//     B2 点它触发一次恢复尝试（toast 报读数；不抛异常、不改数据）
//     B3 列表上方那张提示条里的按钮形态在产物里（静态锚；提示条只在「读不全」时出现，无头里造不出那一刻）
//   S 组 产物静态锚（本批新代码真在产物里；JS 已外置，判 js/mail.js）
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
// 库里那份（150 封）：前 145 封与「同步口读到的旧账」逐 id 相同，尾上 5 封是这台机没读到的（含 2 封带 TA 回信）
const base = (n, from) => {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: 'm' + (from + i), type: 'received', tt: '信 m' + (from + i), content: '正文 m' + (from + i), tm: Date.now() - (from + i) * DAY, read: true });
  }
  return arr;
};
const LS_145 = base(145, 0);
const IDB_150 = base(145, 0).concat([
  { id: 'm145', type: 'received', tt: '信 m145', content: '正文 m145', tm: Date.now() - 145 * DAY, read: false },
  { id: 'm146', type: 'received', tt: '信 m146', content: '正文 m146', tm: Date.now() - 146 * DAY, read: true, partnerReply: '收到啦' },
  { id: 'm147', type: 'received', tt: '信 m147', content: '正文 m147', tm: Date.now() - 147 * DAY, read: true, partnerReply: '好呀' },
  { id: 'm148', type: 'sent', tt: '信 m148', content: '正文 m148', tm: Date.now() - 148 * DAY, read: true },
  { id: 'm149', type: 'sent', tt: '信 m149', content: '正文 m149', tm: Date.now() - 149 * DAY, read: true },
]);

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
  await page.waitForTimeout(3000);
}
// 同步口那页（LS）：走业务自己的 store，set 会双写（LS 同步、IDB 异步）——等异步落地再去铺库里那份
async function seedLs(page, arr) {
  await page.evaluate((v) => { window.xyStore(window.activePrefix()).set('mail-letters', JSON.stringify(v)); }, arr);
  await page.waitForTimeout(700);
}
// 库里那份（只在 IDB）：直接 idbSet，绝不再碰 LS
async function seedIdb(page, arr) {
  await page.evaluate(async (v) => { await window.idbSet(window.activePrefix() + ':mail-letters', JSON.stringify(v)); }, arr);
  await page.waitForTimeout(700);
}
const storeLen = (page) => page.evaluate(() => { try { return JSON.parse(window.xyStore(window.activePrefix()).get('mail-letters') || '[]').length; } catch (e) { return -1; } });
const runRescue = (page, cid) => page.evaluate((c) => new Promise((res) => {
  if (!window.mailRescueRun) { res({ missing: true }); return; }
  const timer = setTimeout(() => res({ timeout: true }), 8000);
  window.mailRescueRun(c === undefined ? undefined : c, (r) => { clearTimeout(timer); res(r || {}); });
}), cid);

const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 110)));
await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
await enter(p); await waitReady(p);

// A1/A1b 前置能力
const hasFn = await p.evaluate(() => typeof window.mailRescueRun);
const hasIdbGet = await p.evaluate(() => typeof window.idbGet);
ok(hasFn === 'function', 'A1 产物里 window.mailRescueRun 是个函数（提示条按钮与信件数据页按钮共同走这一条；红侧＝纯 HEAD 产物没有这一族）', hasFn);
ok(hasIdbGet === 'function', 'A1b 直读本地库的 window.idbGet 在位（恢复内核的前置能力）', hasIdbGet);
if (hasFn !== 'function') {
  console.log('\n#1417 信箱读到旧账与自救恢复：' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close(); server.close(); process.exit(1);
}

// A2/A3/A5 一问库就合并 + 真写回 + 如实报读数
await seedLs(p, LS_145);
await seedIdb(p, IDB_150);
const beforeLen = await storeLen(p);
const r1 = await runRescue(p);
const afterLen = await storeLen(p);
ok(beforeLen === 145, 'A2 夹具诚实：同步口起初读到的是那页旧账 145 封', beforeLen);
ok(r1.ok === true && r1.before === 145 && r1.after === 150, 'A2b 问一次库即字段级合并：ok=true、屏上 145 → 150（那 5 封没读到的信问回来了，含当天那封回信）', JSON.stringify(r1));
ok(afterLen === 150, 'A3 合并后同步口（xyStore.get）也读到 150——库那份真写回本地了，不是只在内存里画一次', afterLen);
ok(r1.rp === 2, 'A5 带 TA 回信计数如实报到（库里那 2 封 partnerReply 的信）', r1.rp);

// A4 并集：本地独有那封不许被库版顶掉
const LS_146 = LS_145.concat([{ id: 'localOnly', type: 'sent', tt: '本地独有', content: '只在 LS 里', tm: Date.now(), read: true }]);
await seedLs(p, LS_146);
await seedIdb(p, IDB_150);
const r2 = await runRescue(p);
const afterLen2 = await storeLen(p);
ok(r2.ok === true && r2.after === 151, 'A4 并集语义：本地独有（库里没有）那一封不被库版顶掉（145＋本地 1 → 并 150 → 151）', JSON.stringify({ r: r2, len: afterLen2 }));
ok(afterLen2 === 151, 'A4b 写回的正是并集那份（151 封），不是拿库版整包换掉本地', afterLen2);

// A6 库里没有这一格：如实报 absent
const r3 = await runRescue(p, '__noexist_desktop');
ok(r3.ok === false && r3.why === 'absent', 'A6 库里没有这一格时如实报 absent（不假装成功、不把屏上那份当答案）', JSON.stringify(r3));

// A7 合并后重绘：屏上列表条数＝合并后条数
await p.evaluate(() => { window.openMailPage(); });
await p.waitForTimeout(400);
const domRows = await p.evaluate(() => document.querySelectorAll('#mail-in-list .mail-item').length);
const storeNow = await storeLen(p);
const recvNow = await p.evaluate(() => { try { return JSON.parse(window.xyStore(window.activePrefix()).get('mail-letters') || '[]').filter((x) => x.type === 'received').length; } catch (e) { return -1; } });
ok(domRows === recvNow, 'A7 合并后屏上列表条数＝库内该侧封数（重绘这一口接上了）', 'dom=' + domRows + ' recv=' + recvNow + ' store=' + storeNow);

// B 组 作者直派的「自救恢复按钮」
const btn = await p.evaluate(() => {
  const b = document.getElementById('mail-rescue-data');
  return { exists: !!b, txt: b ? String(b.textContent || '').trim() : '' };
});
ok(btn.exists, 'B1 信件数据页常驻自救入口 #mail-rescue-data 在 DOM 里（作者直派「新增自救的恢复按钮」的固定落点；红侧＝纯 HEAD 产物没有这一枚）', JSON.stringify(btn));
// B2 点它＝触发一次恢复尝试（不抛异常；读数如实）
const click = await p.evaluate(() => {
  const b = document.getElementById('mail-rescue-data');
  if (!b) return { clicked: false };
  try { b.click(); return { clicked: true }; } catch (e) { return { clicked: false, err: String(e && e.message) }; }
});
await p.waitForTimeout(1200);
const clickLen = await storeLen(p);
ok(click.clicked && clickLen === 151, 'B2 点常驻按钮＝当场问一次库并合并（151 封原样、不抛异常、不改坏数据）', JSON.stringify({ c: click, len: clickLen }));

// ===== S 组 产物静态锚（本批新代码真在产物里；JS 已外置＝判 js/mail.js） =====
const mailJs = readFileSync(join(root, 'js/mail.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
ok(mailJs.indexOf('window.mailRescueRun = mailRescueRun;') >= 0, 'S1 恢复内核对外出口在位（window.mailRescueRun）', '');
ok(mailJs.indexOf('mailRescueRun(cid, function () { mailAuthOk = true; mailDbReady = true; after(); });') >= 0, 'S2 权威重试耗尽那一刻先合并库里那份再开门（旧实现只开门不合并＝屏上永远停在旧账）', '');
ok(mailJs.indexOf('<button class="cc-tool" id="mail-rescue">从本地库找回</button>') >= 0, 'B3 列表上方提示条里的自救按钮形态在产物里（提示条只在「读不全」时出现，无头里造不出那一刻）', '');
ok(mailJs.indexOf('if (mailReadIncomplete(cid) || mailBlindRead(cid)) {') >= 0, 'S3 写回闸判据合一：残缺读数（读空／读到旧账／数据层交不出权威读数 #1442）都没有整包写回资格', '');
ok(html.indexOf('id="mail-rescue-data"') >= 0, 'S4 信件数据页常驻自救入口在产物 index.html 里', '');
ok(html.indexOf('.mail-rescue-tip { display:flex;') >= 0, 'S5 提示条与按钮的样式规则在产物 index.html 里', '');

ok(errs.length === 0, 'Z 全程零未捕获 JS 异常', JSON.stringify(errs.slice(0, 3)));

console.log('\n#1417 信箱读到旧账与自救恢复：' + pass + ' 通过 / ' + fail + ' 失败');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
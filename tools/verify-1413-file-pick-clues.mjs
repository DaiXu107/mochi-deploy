// verify-1413-file-pick-clues.mjs — #1413「选文件时递出去的线索」全站尺
// 立项（作者 2026-09-29 在 #1410 之后说「具体我也不知道，你帮我多检查」）。本尺不重复 #1410 那一条
// （那颗按钮只弹相册），它管全站这一族：把「**调用方没提 accept**」与「**调用方有意给空串**」在模具
// 里分开，并把剩下的手写串收进单一来源。
// 本机量得到的事实（判据零机型／零 UA）：
//   ① 三处模具此前都写 `o.accept || 'image/*'`／`(o.accept != null && o.accept !== '')`——空串与「没提」
//     同形，于是任何非图片入口只要传过空串，就会被偷偷铺成相册、或清不掉上一个分类留下的 image/*；
//   ② 实测这一条不是假设：字卡库先看「表情包」再切到「语音」点批量导入，合成腿真的弹在常驻 input
//     cc-file-pick 上、accept 仍是上一次的 `image/*`＝语音文件全灰显（#1040d 当年只补了层、没补宿主）；
//   ③ 另有六处 json 导入手写窄串 `.json,application/json`（少 octet-stream／text/plain＝转存后改了
//     类型的备份会被按 MIME 过滤的壳灰显），一处手抄的 `.txt,.json,text/plain,application/json`。
// 本尺两侧都要跑：改动侧全绿；底本侧只允许红在本批新契约上。
// 用法：node tools/verify-1413-file-pick-clues.mjs       （RED／隔离根：SERVE_ROOT=<目录> 同命令）
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
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
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 190) + ']' : '')); } };
const jsOf = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };
const cnt = (s, needle) => s.split(needle).length - 1;
const DOC = '.json,application/json,text/plain,application/octet-stream';

// ================= S 组：模具与串的手写面（产物源码级） =================
{
  const dev = jsOf('device.js'), pers = jsOf('personalize.js');
  ok(cnt(dev, "input.accept = typeof o.accept === 'string' ? o.accept : 'image/*';") === 1,
    'S1 层模具改成「只有没提才兜底成图片」（旧写法＝入口有意传的空串被换成相册）', 'count=' + cnt(dev, "typeof o.accept === 'string'"));
  ok(cnt(dev, "accept: typeof o.accept === 'string' ? o.accept : ((host && host.accept) || 'image/*'),") === 1,
    'S2 门模具同一判据（宿主是空串＝这一格不限制类型）');
  ok(cnt(pers, "accept: typeof first.accept === 'string' ? first.accept : 'image/*',") === 1,
    'S3 弹窗胶囊声明的 pick 同一判据');
  ok(cnt(dev, "input.accept = ('accept' in o) ? String(o.accept == null ? '' : o.accept) : (input.accept || '');") === 1,
    'S4 统一入口把「没提这一项」与「提了空串」分开（裸登记仍保留宿主口径＝#1230e 原意不变）');
  ok(cnt(dev, "input.accept = (o.accept != null && o.accept !== '') ? o.accept : (input.accept || '');") === 0,
    'S5 旧的那行不残留（它表达不出「显式清空」）');
  const files = ['chat-settings.js', 'divination.js', 'feature-data.js', 'gift-shop.js', 'group-chat.js', 'mail.js', 'data-backup.js', 'chatcard.js'];
  const narrow = files.reduce((a, f) => a + cnt(jsOf(f), "'.json,application/json'"), 0);
  ok(narrow === 0, 'S6 全站不再有手写的窄串 .json,application/json（少 octet-stream 与 text/plain＝转存后改了类型的备份会被灰显）', '残留=' + narrow);
  const users = files.filter((f) => cnt(jsOf(f), 'window.mochiDataPickAccept') >= 1).length;
  ok(users >= 6, 'S7 常量被当作唯一来源复用（读它的外置件数）', 'files=' + users);
  ok(jsOf('personalize.js').indexOf("window.mochiDataPickAccept + ',.txt'") >= 0,
    'S8 通用弹窗那颗「选文件」由常量派生并另收 .txt（不再手抄第四串）');
}

// ================= 夹具与真点 =================
async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: [], jsErrors: [], fixture: null };
  page.on('filechooser', async (fc) => {
    let acc = '(读不到)', id = '';
    try { const el = await fc.element(); acc = String(await el.getAttribute('accept') || ''); id = await el.evaluate((e) => e.id || '(无 id)'); } catch (e) {}
    st.chooser.push({ accept: acc, id });
    if (st.fixture) { try { await fc.setFiles({ name: st.fixture.name, mimeType: st.fixture.mime, buffer: Buffer.from(st.fixture.body, 'utf8') }); } catch (e) {} }
  });
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); localStorage.setItem('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
  });
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.hidden = true; q.style.display = 'none'; }
  });
  await page.waitForTimeout(900);
  return { browser, page, st };
}
const ev = (page, expr) => page.evaluate(expr);
async function showPage(page, pid, tabSel) {
  await page.evaluate(([id, ts]) => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== id); });
    if (ts) { const t = document.querySelector(ts); if (t) t.click(); }
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
  }, [pid, tabSel || null]);
  await page.waitForTimeout(420);
}
async function forceReveal(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return;
    let n = el;
    while (n && n !== document.body) {
      if (n.hidden) n.hidden = false;
      try { if (getComputedStyle(n).display === 'none') n.style.setProperty('display', 'block', 'important'); } catch (e) {}
      n = n.parentElement;
    }
    el.scrollIntoView({ block: 'center' });
  }, sel);
}
const catOf = (page) => ev(page, "(function(){var t=document.querySelector('.cc-tab[data-type].sel');return t?t.dataset.type:'?';})()");
async function clickJs(page, sel, ms) { await ev(page, `(function(){var b=document.querySelector(${JSON.stringify(sel)});if(b)b.click();return !!b;})()`); await page.waitForTimeout(ms || 600); }
// 物理点按（手指落在真层上＝浏览器原生默认动作）
async function tapPhys(page, st, sel, settle) {
  await ev(page, `(function(){var b=document.querySelector(${JSON.stringify(sel)});if(b)b.scrollIntoView({block:'center'});})()`);
  await page.waitForTimeout(300);
  const geo = await ev(page, `(function(){var b=document.querySelector(${JSON.stringify(sel)});if(!b)return{err:'no-el'};var r=b.getBoundingClientRect();if(!r.width||!r.height)return{err:'zero'};return {cx:r.x+r.width/2,cy:r.y+r.height/2};})()`);
  if (geo.err) return geo;
  st.chooser = [];
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(settle || 700);
  return { chooser: st.chooser };
}
const closeModals = (page) => ev(page, "(function(){var m=document.getElementById('modal-mask');if(m)m.hidden=true;return 1;})()");

const { browser, page, st } = await boot();

// ---- A 段①：字卡库「先看图档、再切语音」——常驻 input 不许把上一个分类的过滤器带给下一个 ----
await showPage(page, 'page-chatcard', null);
await clickJs(page, '#li-custom-cards', 900);
{
  const cat0 = await catOf(page);
  ok(cat0 !== '?', 'A0 前置：进了自定义字卡页且分类页签可判当前档', 'cat=' + cat0);
  await clickJs(page, '.cc-tab[data-type="sticker"]', 800);
  const g1 = await tapPhys(page, st, '#cc-import', 800);
  const c1 = (g1.chooser || [])[0] || {};
  ok(g1.chooser && g1.chooser.length === 1 && c1.accept === 'image/*',
    'A1 表情包档：递给选择器的仍是 image/*（本批不许把图片档放宽＝#753 那族反向症状）', JSON.stringify(g1.chooser));
  await closeModals(page);
  await clickJs(page, '.cc-tab[data-type="voice"]', 800);
  const cat2 = await catOf(page);
  st.chooser = [];
  await clickJs(page, '#cc-import', 900); // 合成腿（JS click＝走统一入口，不落在层上）
  const c2 = st.chooser[0] || {};
  ok(cat2 === 'voice' && st.chooser.length === 1 && c2.accept === '',
    'A2 切到语音档后走合成腿：线索必须是「不限制」，不许留着上一档的 image/*（留着＝amr/silk/无扩展名全灰显＝「语音传不上去」）',
    'cat=' + cat2 + ' chooser=' + JSON.stringify(st.chooser));
  // 物理腿同一判据（层与宿主两条路不该分叉）
  const g3 = await tapPhys(page, st, '#cc-import', 800);
  const c3 = (g3.chooser || [])[0] || {};
  ok(g3.chooser && g3.chooser.length === 1 && c3.accept === '',
    'A3 语音档物理点真层：同一份「不限制」（#1040d 当年只能靠事后补写，现在模具本身就守得住）', JSON.stringify(g3.chooser));
  await closeModals(page);
  // 再切回图片档：放宽不许赖着不走
  await clickJs(page, '.cc-tab[data-type="sticker"]', 800);
  st.chooser = [];
  await clickJs(page, '#cc-import', 900);
  ok(((st.chooser[0] || {}).accept) === 'image/*',
    'A4 回图片档又必须收窄（分开两态之后仍然收得回来＝本批没把入口做成永远全文件）', JSON.stringify(st.chooser));
  await closeModals(page);
}
// ---- A 段⑤：#1410 那颗按钮没被本批带偏 ----
await showPage(page, 'page-setting', '#set-tabs .them-tab[data-tab="basic"]');
await forceReveal(page, '#row-import');
{
  await clickJs(page, '#row-import', 700);
  st.chooser = [];
  const g = await tapPhys(page, st, '#modal-ok', 900);
  const c = (g.chooser || [])[0] || {};
  ok(c.accept === DOC, 'A5 设置→通用「导入数据」仍递那份文档并集（#1410 复测）', JSON.stringify(g.chooser));
  await closeModals(page);
}
// ---- A 段⑥：被收进常量的六处之一，真点一次（占卜牌库「导入数据」） ----
await showPage(page, 'page-divine', null);
await forceReveal(page, '#divf-import');
{
  st.chooser = []; // 不复位就会读到上一发（A5）的残留＝底本侧照样绿，是假绿
  const has = await ev(page, "(function(){var b=document.getElementById('divf-import');if(!b)return 0;b.click();return 1;})()");
  await page.waitForTimeout(900);
  const c = st.chooser[st.chooser.length - 1] || {};
  ok(has === 1 && st.chooser.length >= 1 && c.accept === DOC,
    'A6 占卜「导入数据」这发真点：窄串已换成同一份并集（其余五处由 S6 逐字钉住＝全站不再留手写串）',
    'btn=' + has + ' 弹了几次=' + st.chooser.length + ' chooser=' + JSON.stringify(st.chooser));
  await closeModals(page);
}
// ---- A 段⑦：聊天发图对照面 ----
{
  const img = await ev(page, "(function(){var i=document.getElementById('chat-img-pick');return i?String(i.accept):'(不在)';})()");
  ok(img === 'image/*', 'A7 聊天发图仍 image/*（对照面）', 'accept=' + img);
}
ok(st.jsErrors.length === 0, 'Z1 全流程零 JS 异常', st.jsErrors.join(' | ').slice(0, 200));

await browser.close();
server.close();
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

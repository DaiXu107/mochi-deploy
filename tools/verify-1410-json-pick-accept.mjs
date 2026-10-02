// verify-1410-json-pick-accept.mjs — #1410「点【导入数据】只弹相册、到不了文件管理」的 accept 口径尺
// 立项（作者 2026-09-29 直派「为什么有的手机浏览器，点击【导入数据】只弹出手机的相册，没有弹出手机的
//   文件管理。帮我修复，并且不要覆盖修改导致不同型号设备浏览器的 bug 反复出现。这个问题其他设备型号
//   也有出现。」）。
// 病灶（零机型／零 UA 分支，判据只取「我们递给选择器的那串类型线索」这一条自己能量的事实）：数据导入
//   那几处把 accept 刻意留空（v3.9.x／v3.23.x 为躲「部分安卓 ROM 按 .json 过滤把备份文件灰显掉」那次
//   回退）。空 accept 在那批内核里不是「什么文件都要」，是「不给任何线索」——手机浏览器/内嵌 WebView
//   收到无线索的上传请求就按自家默认走，这一族默认正是相册，于是 .json 备份连候选页都到不了。
// 本尺把两个历史极端同时钉住（谁再往任何一边甩就当场红，这才是「不要反复出现」的落点）：
//   · 退回空串／通配 ＝ 无线索 ＝ 弹相册那一型（A2/A3/A5/A6 的「非空且不含 image」）；
//   · 退回窄串 '.json,application/json' ＝ 按 MIME 过滤的壳把转存后改了类型的备份灰显掉那一型（A4）。
// 另钉两条不被误伤：图片入口必须仍是 image/*（改成非图片＝#753「相册不在候选」复发），以及投递 json
//   之后原管线照常走通（放宽 accept 没把导入本身弄坏）。
// 用法：node build.mjs && node tools/verify-1410-json-pick-accept.mjs
//   RED 基线／隔离根：SERVE_ROOT=<目录> node tools/verify-1410-json-pick-accept.mjs
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
// 外置 js 与内联件（device.js 留在 index.html）都按产物侧真实形态读
const jsOf = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };
const count = (s, needle) => s.split(needle).length - 1;

// 本批要的口径（判据＝这一串线索本身的形状，不引用常量名，红侧才有读数可比）
const DOC_LIST = '.json,application/json,text/plain,application/octet-stream';
function clueShape(a) {
  const s = String(a == null ? '' : a);
  return {
    present: s.trim() !== '' && s !== '*/*',           // 递了线索（不是空串、不是全通配）
    noImage: !/image/.test(s) && !/video/.test(s),     // 不含图片/视频类型＝相册那批 intent filter 不该命中
    byExt: s.indexOf('.json') >= 0,                    // 只认扩展名的壳也认得它
    byMime: s.indexOf('application/json') >= 0,        // 按 MIME 过滤的（MediaStore）认得它
    broad: s.indexOf('octet-stream') >= 0 && s.indexOf('text/plain') >= 0, // 转存后改了类型也不灰显
  };
}

// ================= S 组：产物源码级（两侧同尺，红侧＝HEAD） =================
{
  const dev = jsOf('device.js'), db = jsOf('data-backup.js'), cc = jsOf('chatcard.js');
  ok(count(dev, "window.mochiDataPickAccept = '" + DOC_LIST + "';") === 1,
    'S1 数据文件 accept 的单一来源常量在位且逐字为此值（逐入口手抄＝本族每漏一处下一张「换个型号又坏了」的报障）',
    'count=' + count(dev, 'window.mochiDataPickAccept'));
  const sh = clueShape(DOC_LIST);
  ok(sh.present && sh.noImage && sh.byExt && sh.byMime && sh.broad,
    'S2 常量本身同时挡住两型：非空非通配·不含 image/video·含 .json 与 application/json·含 text/plain 与 octet-stream');

  ok(count(db, "entry: 'row-import', accept: ''") === 0 && count(db, "entry: 'row-import', accept: window.mochiDataPickAccept") === 1,
    'S3 设置→通用「导入数据」的确定层不再留空（留空＝作者直派的那一型）', 'old=' + count(db, "entry: 'row-import', accept: ''") + ' new=' + count(db, "entry: 'row-import', accept: window.mochiDataPickAccept"));
  ok(count(db, "id: 'mochi-chatall-import-pick', accept: '.json,application/json'") === 0 && count(db, "id: 'mochi-chatall-import-pick', accept: window.mochiDataPickAccept") === 1,
    'S4 「仅聊天记录」导入从窄串换成并集（窄串＝v3.23.x 灰显那一型）', 'old=' + count(db, "accept: '.json,application/json'"));
  ok(count(db, "id: 'mochi-backup-import-pick', accept: ''") === 0 && count(db, "id: 'mochi-backup-import-pick', accept: window.mochiDataPickAccept") === 1,
    'S5 整机导入的 JS 腿（弹窗不可用时）与确定层同一口径＝两条路不会分叉', 'old=' + count(db, "id: 'mochi-backup-import-pick', accept: ''"));
  ok(count(cc, "entry: 'cc-import-data', accept: ''") === 0 && count(cc, "entry: 'li-cc-full-import', accept: ''") === 0
    && count(cc, 'pickFiles(window.mochiDataPickAccept') === 2,
    'S6 字卡库「导入数据」与「完整导入」两个确定层＋两条 JS 腿全收进同一常量',
    'left=' + (count(cc, "entry: 'cc-import-data', accept: ''") + count(cc, "entry: 'li-cc-full-import', accept: ''")) + ' legs=' + count(cc, 'pickFiles(window.mochiDataPickAccept'));
  ok(count(cc, "cur === 'voice' ? '' : 'image/*'") >= 1 && count(jsOf('chat.js'), "fi.accept = 'image/*'; fi.multiple = true;") === 1,
    'S7 媒体/图片那批口径一字未动（语音仍放开、聊天发图仍 image/*）——本批不越界去改别人的族');
  ok(count(dev, 'accept: String(input.accept).slice(0, 64)') === 1 && count(dev, 'accept: String(input.accept).slice(0, 40)') === 0,
    'S8 自学门台账给 accept 留 64 字符（按 40 截＝并集被截半截，台账与宿主永不相等→这一格被永久剔门）');
}

// ================= 夹具：真开无头 Chrome，顽固内核仿真（同 #991/#1014 口径） =================
const BACKUP_JSON = JSON.stringify({ app: 'mochi-zika', ls: { 'xy-home-v2:theme-mode': 'dark' }, idb: {} });
async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, jsErrors: [], fixture: null, last: null };
  page.on('filechooser', async (fc) => {
    // 读数只问「浏览器这一刻真的拿到的那个元素的 accept」——不是我们代码里以为写上去的值
    let acc = '(读不到)', id = '';
    try {
      const el = await fc.element();
      acc = await el.getAttribute('accept');
      id = await el.evaluate((e) => e.id || '(无 id)');
    } catch (e) { acc = '(读失败:' + String(e.message).slice(0, 40) + ')'; }
    st.chooser++;
    st.last = { accept: acc == null ? '' : acc, id: id };
    if (!st.fixture) return; // 不投递＝保持选择器打开（只测「有没有弹」的用例）
    try { await fc.setFiles({ name: st.fixture.name, mimeType: st.fixture.mime, buffer: Buffer.from(st.fixture.body, 'utf8') }); } catch (e) {}
  });
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    try { localStorage.setItem('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
  });
  await page.addInitScript(() => {
    document.addEventListener('click', (e) => {
      try { if (e.target && e.target.closest && e.target.closest('label[data-file-pick-for]')) e.preventDefault(); } catch (x) {}
    }, true);
    try { HTMLInputElement.prototype.showPicker = function () { throw new Error('NotAllowedError'); }; } catch (e) {}
    const raw = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () { try { if (this && this.tagName === 'INPUT' && this.type === 'file') return; } catch (e) {} return raw.apply(this, arguments); };
  });
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  });
  await page.waitForTimeout(900);
  return { browser, page, st };
}
const ev = (page, expr) => page.evaluate(expr);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
// 物理点按元素中心（真层只有被手指落在上面才走浏览器原生默认动作）
async function tapSel(page, st, sel, { settle = 700 } = {}) {
  await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.scrollIntoView({ block: 'center' }); }, sel);
  await page.waitForTimeout(300);
  const geo = await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return { err: 'no-el' };
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return { err: 'zero-rect' };
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, sel);
  if (geo.err) return geo;
  st.chooser = 0; st.last = null;
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(settle);
  geo.chooser = st.chooser;
  geo.last = st.last;
  return geo;
}
async function pickPill(page, text) {
  // 按「包含」匹配：胶囊标签带括号补语与全角括号，逐字等值在渲染文本里不稳（A7a 实测就是被这条卡住的）
  return ev(page, `(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(String(ps[i].textContent).indexOf(${JSON.stringify(text)})>=0){ps[i].click();return String(ps[i].textContent);}}return '';})()`);
}
async function closeModal(page) {
  await page.evaluate(() => {
    const c = document.getElementById('modal-cancel');
    const m = document.getElementById('modal-mask');
    if (c && !c.hidden && m && !m.hidden) c.click();
    if (m) m.hidden = true;
  });
  await page.waitForTimeout(220);
}
// accept 读数判定：这一发浏览器真的拿到的线索，必须同时挡住两型
function clueOk(g) {
  if (!g || !g.last) return { pass: false, why: '没弹选择器（chooser=' + (g && g.chooser) + '）', sh: null };
  const sh = clueShape(g.last.accept);
  return { pass: sh.present && sh.noImage && sh.byExt && sh.byMime && sh.broad, why: 'accept=' + JSON.stringify(g.last.accept), sh: sh };
}

const { browser, page, st } = await boot();

// ---- A 段①：设置→通用→「导入数据」→完整备份（用户点名那一发） ----
await showPage(page, 'page-setting', '#set-tabs .them-tab[data-tab="basic"]');
await forceReveal(page, '#row-import');
{
  const g0 = await tapSel(page, st, '#row-import', { settle: 600 });
  const title = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  ok(title === '选择导入范围', 'A1 前置：点「导入数据」弹的是范围弹窗（确认步骤没被铺层跳过）', String(title) + ' / ' + JSON.stringify(g0));
  // #753 判据：线索必须在「点按之前」就落在元素上（迟到＝首次激活按内核默认走）
  const before = await ev(page, "(function(){var i=document.getElementById('mochi-modal-pick');return i?String(i.accept):'(层还没铺)';})()");
  ok(clueShape(before).present && clueShape(before).noImage,
    'A2 点确定**之前**层上的线索已落定，且不含图片类型（迟到＝内核按自家默认弹相册）', 'accept=' + JSON.stringify(before));
  st.fixture = { name: 'mochi-backup.json', mime: 'application/json', body: BACKUP_JSON };
  const g1 = await tapSel(page, st, '#modal-ok', { settle: 900 });
  const c1 = clueOk(g1);
  ok(g1.chooser === 1, 'A3 物理点「确定」弹出选择器恰 1 次', JSON.stringify(g1).slice(0, 150));
  ok(c1.pass, 'A4 这一发递给浏览器的线索＝非空·不含 image·既按扩展名又按 MIME 认 json·且宽到不灰显（作者直派那一型的正面判据）',
    c1.why + ' | by=' + (g1.last && g1.last.id) + ' | ' + JSON.stringify(c1.sh));
  // 与 A2 同一次点按**之前**那份快照比（层在 change 后会被撤下，事后再读量的是别的层）
  const constVal = await ev(page, "(typeof window.mochiDataPickAccept==='undefined'?'NO-CONST':String(window.mochiDataPickAccept))");
  ok(constVal === before, 'A5 层上那份就是常量本身（单一来源，不是逐入口手抄的第二串；红侧＝旧版没有这个常量）', 'const=' + String(constVal).slice(0, 70) + ' layer=' + JSON.stringify(before));
  const t2 = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  ok(String(t2).indexOf('确定导入数据') === 0, 'A6 投递的 json 真进了原导入管线（出现覆盖确认弹窗＝放宽 accept 没弄坏管线）', String(t2).slice(0, 40));
  st.fixture = null;
  await closeModal(page);
}
// ---- A 段②：同一弹窗换胶囊到「仅聊天记录」，线索不得跟着换档丢掉 ----
{
  await tapSel(page, st, '#row-import', { settle: 600 });
  let peek = await ev(page, "(function(){return {title:(document.getElementById('modal-title')||{}).textContent||'', n:document.querySelectorAll('#modal-pills .pill').length};})()");
  // 上一段投递文件后开的是「确定导入数据？」那张窗：它没收干净就会吃掉这一发（点行＝点到遮罩）＝先如实关掉再点
  if (String(peek.title) !== '选择导入范围') {
    await closeModal(page);
    await tapSel(page, st, '#row-import', { settle: 600 });
    peek = await ev(page, "(function(){return {title:(document.getElementById('modal-title')||{}).textContent||'', n:document.querySelectorAll('#modal-pills .pill').length};})()");
  }
  const pk = await pickPill(page, '仅聊天记录');
  ok(String(peek.title) === '选择导入范围' && String(pk).indexOf('仅聊天记录') >= 0, 'A7a 前置：范围弹窗重开且里面有「仅聊天记录」这一档（换档测试的前提）', 'title=' + String(peek.title) + ' pills=' + peek.n + ' pill=' + String(pk));
  st.fixture = { name: 'mochi-chat.json', mime: 'application/json', body: JSON.stringify({ app: 'mochi-chatall', data: {} }) };
  const g = await tapSel(page, st, '#modal-ok', { settle: 900 });
  const c = clueOk(g);
  ok(g.chooser === 1 && c.pass, 'A7b 换档后点确定，层上仍是同一份非图片线索（两档共用一条层＝口径不该分叉）', c.why);
  st.fixture = null;
  await closeModal(page);
}
// ---- A 段③：「取消」档不得弹选择器（存量活路，两侧应同绿） ----
{
  await tapSel(page, st, '#row-import', { settle: 600 });
  const pkC = await pickPill(page, '取消');
  const g = await tapSel(page, st, '#modal-ok', { settle: 700 });
  const hidden = await ev(page, "(function(){var m=document.getElementById('modal-mask');return !!m&&m.hidden;})()");
  // 前提一起判：范围弹窗没开着的话「不弹选择器」是空转出来的假绿
  ok(String(pkC).indexOf('取消') >= 0 && g.chooser === 0 && hidden === true, 'A8 「取消」点确定：不弹选择器、弹窗照原样关闭（本批没收走不需要文件的那两条活路）', 'pill=' + String(pkC) + ' ' + JSON.stringify(g).slice(0, 120) + ' hidden=' + hidden);
  await closeModal(page);
}
// ---- A 段④：字卡库「导入数据」与「完整导入」----
await showPage(page, 'page-chatcard', null);
{
  await forceReveal(page, '#cc-import-data');
  const g0 = await tapSel(page, st, '#cc-import-data', { settle: 600 });
  const title = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  ok(title === '导入字卡数据', 'A9a 前置：字卡库「导入数据」弹窗打开', String(title) + ' / ' + JSON.stringify(g0));
  st.fixture = { name: 'mochi-cards.json', mime: 'application/json', body: '{}' };
  const g1 = await tapSel(page, st, '#modal-ok', { settle: 900 });
  const c1 = clueOk(g1);
  ok(g1.chooser === 1 && c1.pass, 'A9b 字卡库「导入数据」这一发的线索同一份非图片并集（同一个词【导入数据】的另一个入口，不能只修一处）', c1.why);
  st.fixture = null;
  await closeModal(page);
  // 粘贴档仍不弹（选择器打不开的机型唯一活路）
  await forceReveal(page, '#cc-import-data');
  await tapSel(page, st, '#cc-import-data', { settle: 600 });
  await pickPill(page, '粘贴文本导入');
  const g2 = await tapSel(page, st, '#modal-ok', { settle: 700 });
  const t2 = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  ok(g2.chooser === 0 && t2 === '粘贴字卡数据', 'A9c 「粘贴文本导入」仍不弹选择器、原位打开粘贴框', JSON.stringify(g2).slice(0, 120) + ' ' + String(t2));
  await closeModal(page);
}
{
  await forceReveal(page, '#li-cc-full-import');
  const g0 = await tapSel(page, st, '#li-cc-full-import', { settle: 600 });
  const title = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  st.fixture = null;
  const g1 = await tapSel(page, st, '#modal-ok', { settle: 900 });
  const c1 = clueOk(g1);
  ok(title === '导入自定义字卡' && g1.chooser === 1 && c1.pass, 'A10 「完整导入」确定这一发同样递非图片并集', String(title) + ' ' + c1.why);
  await closeModal(page);
}
// ---- A 段⑪：对照面——图片入口必须仍是 image/*（本批不许把「非图片」蔓延过去） ----
{
  const img = await ev(page, `(function(){var i=document.getElementById('chat-img-pick');return i?String(i.accept):'(不在)';})()`);
  ok(img === 'image/*', 'A11 聊天发图的宿主 input 仍 image/*（改成非图片＝#753「相册不在候选」那一族复发）', 'accept=' + img);
  const av = await ev(page, `(function(){var i=document.getElementById('mochi-avatar-pick');return i?String(i.accept):'(不在)';})()`);
  ok(av === 'image/*' || av === '(不在)', 'A12 头像入口未被本批动过（仍 image/*，或该入口在本构建里不存在）', 'accept=' + av);
}
// ---- Z 组：零异常 ----
ok(st.jsErrors.length === 0, 'Z1 全流程零 JS 异常（防修过头）', st.jsErrors.join(' | ').slice(0, 200));

await browser.close();
server.close();
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

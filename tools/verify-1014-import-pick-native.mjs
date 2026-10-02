// verify-1014-import-pick-native.mjs — #1014 全部「导入」入口不再依赖程序化激活（常驻）
// 立项（用户 2026-09-22 iOS Safari 实报「导入不了字卡文件和数据」，明说其他设备型号也有、
//   要求「不要覆盖修改导致不同型号设备浏览器的bug反复出现」）。
// 根因（零机型分支）：这批入口（数据导入 / 字卡库导入数据 / 字卡库完整导入 / 导入聊天记录 /
//   导入全部桌面聊天记录）与 #991/#1002 那两波铺了「真·可点 input 层」的入口不同——它们要么
//   先弹确认弹窗、要么直接点按，选文件全靠点按之后的程序化激活（showPicker / click / label 转发）。
//   这三条腿都得指望内核乐意执行我们的 JS：被静默无视时，用户看到的就是「点了确定/点了导入，
//   什么都没发生」（不报错、不弹窗、不提示）——这正是本族 #603/#677/#717/#738/#753/#755/#756/
//   #813/#877/#920 反复复发的形状。#1002 当时明确把「先弹确认」的入口留白（铺层会跳过确认步骤）。
// 修法：把层铺在**确定按钮的兄弟位**（不是子节点，按钮内的 input 会被部分内核把点击重定向给按钮），
//   手指物理点按真 file input ⇒ 选择器由浏览器原生默认动作弹出；模式胶囊仍在弹窗里先选，
//   弹窗与确认步骤一字未改；该模式本来不需要文件时（取消 / 粘贴文本导入）撤掉默认动作、把点按
//   交回确定按钮原处理器。另给两个直接选文件的导入行铺 #991/#1002 那套入口层（一行接入）。
// 断言：①源码锚（三层结构都在位、层没被写成不可见、没被塞进按钮里）；
//   ②顽固内核（label 被吞 + showPicker 抛错 + file input 的合成 click() no-op）下逐个真实点按
//   ＝选择器恰弹 1 次、文件真的进了原有管线（确认弹窗 / 字卡落库）；
//   ③「不需要文件」的两个模式（取消 / 粘贴）点确定**不得**弹选择器（活路不被本波收走）；
//   ④零 JS 异常。
// 用法：node build.mjs && node tools/verify-1014-import-pick-native.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-1014-import-pick-native.mjs
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
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const jsOf = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };
const count = (s, needle) => (s.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

// ================= ① 源码锚：三层结构在位（改名/换实现即失守） =================
{
  const dev = jsOf('device.js');
  ok(dev.includes('window.mochiModalPickOk = function (cfg) {') && dev.includes('window.mochiModalPickOkClear = function () {'),
    'S1 弹窗确定层单点实现存在（mochiModalPickOk / mochiModalPickOkClear）——整族入口共用一份，不再逐入口手抄');
  ok(dev.includes('var host = okBtn && okBtn.parentNode;') && !dev.includes('okBtn.appendChild(input)'),
    'S2 层铺在确定按钮的**兄弟位**（父容器内），不塞进 <button> 里——塞进去会被部分内核把点击重定向给按钮，等于白铺');
  ok(/input\.style\.cssText = 'position:absolute;[^']*appearance:none/.test(dev) && dev.includes("input.setAttribute('data-modal-pick', '1')") && !/data-modal-pick[\s\S]{0,400}opacity:0/.test(dev),
    'S3 层保持「元素可见、外观不可见」（appearance:none + 透明前景），没有退回 display:none/opacity:0（#717/#738 那族被内核拒绝激活的写法）');
  ok(dev.includes('if (typeof o.skipWhen === \'function\' && o.skipWhen(mode))') && dev.includes('try { ev.preventDefault(); } catch (e5) {}'),
    'S4 「该模式不需要文件」时撤掉弹选择器的默认动作（取消 / 粘贴文本导入两条活路靠它保住）');
  ok(dev.includes('window.mochiPickLog = function (entry, step) {') && dev.includes('文件选择取证（旧→新）'),
    'S5 文件选择取证环 + 诊断报告取证行（下次报障能直接看出是入口没点中 / 腿没弹 / 文件没回来）');

  const pers = jsOf('personalize.js');
  ok(pers.includes('opts.pickOk && okBtn && window.mochiModalPickOk') && count(pers, 'mochiModalPickOkClear()') >= 2,
    'S6 openModal 打开时铺层、关窗时撤层（绝不跨弹窗残留到下一个弹窗的确定上）');

  const db = jsOf('data-backup.js');
  ok(db.includes("entry: 'row-import'") && db.includes("skipWhen: (m) => m === 'cancel'") && db.includes('window.runChatAllImport(f)'),
    'S7 数据导入接上确定层（取消模式跳过、两个模式仍走原来那两条路）');

  const cc = jsOf('chatcard.js');
  ok(cc.includes("entry: 'cc-import-data'") && cc.includes("skipWhen: (m) => m === 'paste'"),
    'S8 字卡库「导入数据」接上确定层（粘贴模式跳过）');
  ok(cc.includes("entry: 'li-cc-full-import'") && count(cc, 'function ccFullImportFile(f, mode) {') === 1 && count(cc, 'ccFullImportFile(') === 3,
    'S9 字卡库「完整导入」接上确定层：解析/自救管线抽成一份 (f, mode) 实现，两条路汇入同一条（不新增第二条管线）');
  // 备注：两个「导入…聊天记录」行（#cs-import-msgs / #cs-import-all）的入口层接线**不在本批**——
  // 那两行要铺 #991/#1002 的入口层，而该 base 的 device.js 尚未含 mochiFilePickSurface（见交付说明）。
  // 本批只覆盖「先弹确认再选文件」的三个入口 + 数据导入，等待恢复批把 surface 链补回后再接那两行。
}

// ================= 顽固内核仿真 + 夹具 =================
const CARD_JSON = JSON.stringify({
  text: [['原生选择器组', ['原生选择器进来的第一句', '原生选择器进来的第二句']]],
  kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: []
});
const FULL_JSON = JSON.stringify({ app: 'mochi-ccfull', data: { ccPub: { text: [['全量原生组', ['全量原生选择器句']]] } } });
const BACKUP_JSON = JSON.stringify({ app: 'mochi-zika', ls: { 'xy-home-v2:theme-mode': 'dark' }, idb: {} });

async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, jsErrors: [], fixture: null, setFilesErr: '' };
  page.on('filechooser', async (fc) => {
    st.chooser++;
    if (!st.fixture) return; // 不投递＝保持选择器打开（只测「有没有弹」的用例）
    try { await fc.setFiles({ name: st.fixture.name, mimeType: st.fixture.mime, buffer: Buffer.from(st.fixture.body, 'utf8') }); }
    catch (e) { st.setFilesErr = String(e.message || e); }
  });
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    // #1263 夹具收口：#1250「存储修复引导」在数据就绪 +4s 无条件 openModal——弹窗是单例
    // （#modal-mask/#modal-ok 全站共用），本脚本跑数十秒、中途停在任意用户弹窗时都可能被引导
    // 抢走那一层，造成跨断言的时序不确定。夹具预置送达键让引导全程静默＝保持确定性；
    // 产品侧「让路不抢」闸本身由 verify-1263 独立断言。（注：B2 在含/不含引导抑制下都恒红，
    // 经探针实证是「取消」模式下确定按钮物理命中/关闭的存量问题，与本抑制无关，见 WORKLOG。）
    try { localStorage.setItem('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
  });
  await page.addInitScript(() => {
    // 顽固内核仿真（同 #991/#1002 口径）：label 转发被吞 + showPicker 抛 NotAllowedError +
    // file input 的合成 click() 无效。三条程序化腿全废 ⇒ 只有「手指物理点在真 input 上」能弹选择器。
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
// 物理点按某元素中心：返回命中元素描述（surface 层会显示 [surface]）
async function tapSel(page, st, sel, { settle = 700 } = {}) {
  await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.scrollIntoView({ block: 'center' }); }, sel);
  await page.waitForTimeout(300);
  const geo = await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return { err: 'no-el' };
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return { err: 'zero-rect' };
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const desc = (el) => el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.getAttribute && el.getAttribute('data-file-pick-surface') ? '[surface]' : '')) : 'null';
    return { cx, cy, hit: desc(document.elementFromPoint(cx, cy)) };
  }, sel);
  if (geo.err) return geo;
  st.chooser = 0;
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(settle);
  geo.chooser = st.chooser;
  return geo;
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

// ================= ② 行为断言 =================
const { browser, page, st } = await boot();
await ev(page, `(function(){ try { localStorage.setItem('xy-home-v2:screen-adj-top','0'); } catch(e){} return 1; })()`);

// ---- B 段①：数据导入（先弹确认再选文件的那一类） ----
await showPage(page, 'page-setting', '#set-tabs .them-tab[data-tab="basic"]');
await forceReveal(page, '#row-import');
{
  const g0 = await tapSel(page, st, '#row-import', { settle: 600 });
  const title = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  ok(title === '选择导入范围', 'B1a 点「导入数据」弹确认弹窗（前置：确认步骤没被铺层跳过）', title + ' / ' + JSON.stringify(g0));
  const geo = await ev(page, `(function(){
    var ok=document.getElementById('modal-ok'), ca=document.getElementById('modal-cancel');
    if(!ok) return {err:'no-ok'};
    var r=ok.getBoundingClientRect(), s=document.getElementById('mochi-modal-pick');
    var sr=s?s.getBoundingClientRect():null;
    var cx=r.x+r.width/2, cy=r.y+r.height/2;
    var cr=ca?ca.getBoundingClientRect():null;
    var desc=function(el){return el?(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.getAttribute&&el.getAttribute('data-file-pick-surface')?'[surface]':'')):'null';};
    return { okHit:desc(document.elementFromPoint(cx,cy)),
             cancelHit: (cr && cr.width > 0)? desc(document.elementFromPoint(cr.x+cr.width/2, cr.y+cr.height/2)) : 'no-cancel-visible',
             cancelHidden: !!(cr && (!cr.width || cr.width === 0)),
             dx: sr?Math.abs(sr.x-r.x):-1, dy: sr?Math.abs(sr.y-r.y):-1,
             dw: sr?Math.abs(sr.width-r.width):-1, dh: sr?Math.abs(sr.height-r.height):-1 };
  })()`);
  ok(String(geo.okHit).indexOf('mochi-modal-pick[surface]') > -1,
    'B1b 「确定」这一格上真的躺着可点 file input（手指物理点按＝浏览器原生动作）', JSON.stringify(geo));
  ok(geo.dx <= 2 && geo.dy <= 2 && geo.dw <= 2 && geo.dh <= 2,
    'B1c 层与「确定」按钮几何对齐（≤2px）——错位＝点不到或整屏透明层吃掉全页点击', JSON.stringify(geo));
  ok(geo.cancelHidden === true || String(geo.cancelHit).indexOf('modal-cancel') === 0,
    'B1d 层只盖住「确定」：取消按钮可见时仍可点中；被 lock 隐藏时（本弹窗）以「层没越界」为准', JSON.stringify(geo));
  // 投递一份合法备份 → 应真的走到「确定导入数据？」预览弹窗（＝文件进了原管线）
  st.fixture = { name: 'mochi-backup.json', mime: 'application/json', body: BACKUP_JSON };
  const g1 = await tapSel(page, st, '#modal-ok', { settle: 900 });
  ok(g1.chooser === 1, 'B1e 顽固内核下点「确定」弹出文件选择器恰 1 次（修前：0 次＝点了什么也没发生）', JSON.stringify(g1));
  const t2 = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  ok(String(t2).indexOf('确定导入数据') === 0 || String(t2).indexOf('导入数据') >= 0,
    'B1f 选完文件真的进了导入管线（出现覆盖确认弹窗，不是「选完什么都没发生」）', String(t2).slice(0, 40));
  st.fixture = null;
  await closeModal(page);
}
// ---- B 段②：数据导入的「取消」模式不得弹选择器（活路） ----
{
  await tapSel(page, st, '#row-import', { settle: 600 });
  await ev(page, `(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent==='取消'){ps[i].click();return 1;}}return 0;})()`);
  await sleep(250);
  const g = await tapSel(page, st, '#modal-ok', { settle: 700 });
  const hidden = await ev(page, "(function(){var m=document.getElementById('modal-mask');return !!m&&m.hidden;})()");
  ok(g.chooser === 0 && hidden === true,
    'B2 「取消」模式点确定：不弹选择器、弹窗照原样关闭（不需要文件的模式不被本波收走）', JSON.stringify(g) + ' hidden=' + hidden);
  await closeModal(page);
}
// ---- B 段③：字卡库「导入数据」----
await showPage(page, 'page-chatcard', null);
{
  const g0 = await forceReveal(page, '#cc-import-data');
  await tapSel(page, st, '#cc-import-data', { settle: 600 });
  const title = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  ok(title === '导入字卡数据', 'B3a 字卡库点「导入数据」弹确认弹窗（前置）', title + ' / ' + JSON.stringify(g0));
  st.fixture = { name: 'mochi-cards.json', mime: 'application/json', body: CARD_JSON };
  const g1 = await tapSel(page, st, '#modal-ok', { settle: 1200 });
  ok(g1.chooser === 1, 'B3b 顽固内核下点「确定」弹出文件选择器恰 1 次', JSON.stringify(g1));
  // 判据＝文件真的抵达字卡导入管线：要么已落库（含新建分组），要么管线对本夹具给出带文件名的回执。
  //（夹具是「裸 cc-groups 形态」，末段写库要求当前库作用域已就绪，本脚本不铺那个前置；真正的
  //  落库成功由 B5c 断言——全量导入走的是同一条投递路径。「回执带文件名」＝不再是静默丢弃。）
  const pipe = await ev(page, `(function(){
    var landed='';
    for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(!/cc-groups($|-public$)/.test(k))continue;var s;try{s=JSON.parse(localStorage.getItem(k)||'{}');}catch(e){continue;}
      var g=(s.text||[]).filter(function(x){return x[0]==='原生选择器组';});if(g.length)landed=g[0][1].join(',');}
    var toast=(document.getElementById('cc-toast')||{}).textContent||'';
    var got=((window.__mochiPickLog||[]).map(function(x){return String(x.s);}).join(',')||'').indexOf('files=1')>=0;
    return JSON.stringify({landed:landed, toast:toast, got:got});
  })()`);
  const pj = JSON.parse(pipe);
  ok(pj.got === true && (String(pj.landed).indexOf('原生选择器进来的第一句') >= 0 || String(pj.toast).indexOf('mochi-cards.json') >= 0),
    'B3c 原生选择器选来的文件真的进了字卡导入管线（落库、或管线带文件名回执）', JSON.stringify(pj).slice(0, 140));
  st.fixture = null;
  await closeModal(page);
}
// ---- B 段④：「粘贴文本导入」模式不得弹选择器（选择器打不开的机型唯一活路） ----
{
  await forceReveal(page, '#cc-import-data');
  await tapSel(page, st, '#cc-import-data', { settle: 600 });
  await ev(page, `(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent==='粘贴文本导入'){ps[i].click();return 1;}}return 0;})()`);
  await sleep(250);
  const g = await tapSel(page, st, '#modal-ok', { settle: 700 });
  const title = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  const ta = await ev(page, "(function(){var t=document.getElementById('modal-textarea');return !!(t&&!t.hidden);})()");
  ok(g.chooser === 0 && title === '粘贴字卡数据' && ta === true,
    'B4 「粘贴文本导入」点确定：不弹选择器、原位打开粘贴框（选择器不可用的机型仍有活路）', JSON.stringify(g) + ' ' + title);
  await closeModal(page);
}
// ---- B 段⑤：字卡库「完整导入」----
{
  const g0 = await tapSel(page, st, '#li-cc-full-import', { settle: 600 });
  const title = await ev(page, "(document.getElementById('modal-title')||{}).textContent");
  ok(title === '导入自定义字卡', 'B5a 点「自定义字卡·全量导入」弹确认弹窗（前置）', title + ' / ' + JSON.stringify(g0));
  st.fixture = { name: 'mochi-ccfull.json', mime: 'application/json', body: FULL_JSON };
  const g1 = await tapSel(page, st, '#modal-ok', { settle: 1400 });
  ok(g1.chooser === 1, 'B5b 顽固内核下点「确定」弹出文件选择器恰 1 次', JSON.stringify(g1));
  const pub = await ev(page, `(function(){try{var s=JSON.parse((window.activeStore().get('cc-groups-public')||'{}'));var g=(s.text||[]).filter(function(x){return x[0]==='全量原生组';});return g.length?g[0][1].join(','):'';}catch(e){return 'ERR '+e.message;}})()`);
  ok(String(pub).indexOf('全量原生选择器句') >= 0, 'B5c 完整导入的文件真的落进公用字卡库', String(pub).slice(0, 50));
  st.fixture = null;
  await closeModal(page);
}
// ---- B 段⑥：两个「导入…聊天记录」行（入口层）—— 留给恢复批 ----
// 本批不接这两行：它们要铺 #991/#1002 的入口层，而该 base 的 device.js 尚无 mochiFilePickSurface。
// 待 surface 链恢复到位后，本脚本再补 B6/B7 两段（判据同 B1b/B1e：命中层、选择器恰弹 1 次）。
// ---- Z 段：零 JS 异常 ----
ok(st.jsErrors.length === 0, 'Z1 全流程零 JS 异常（防修过头）', st.jsErrors.join(' | ').slice(0, 200));

await browser.close();
server.close();
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

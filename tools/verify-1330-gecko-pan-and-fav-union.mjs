// ===== 常驻回归脚本 #1330：荣耀 50se + 雨见浏览器实报两件事
//   ① 「主页面的状态栏会连带着页面一起掉下来」
//   ② 「收藏几百条被突然清空」（用户特别点出：只有收藏被单独清空，聊天 2608 条完好）
// 用法：node tools/verify-1330-gecko-pan-and-fav-union.mjs [被测根目录]（或 SERVE_ROOT=…）
// 首行打印被测根目录＝防喂错产物（喂错时所有断言一起红，看起来像「修复没生效」）
//
// 同一份诊断单里两件事各自的实锤（零机型／零 UA 分支，判据一律取现场事实）：
//
// ① 状态栏掉下来：_aPanComp 那条 `.phone.style.top = vv.offsetTop` 只在「内核只平移视觉视口、
//   布局视口一动没动」时才是填缝（我们发的 meta 是 interactive-widget=resizes-visual；#141 注释
//   原文「innerHeight 即布局视口高，不随键盘收缩」就是这个假设的书面形态）。这台机的内核把
//   **布局视口**一起缩掉了：环境变化实测 inner 915→595、836→544（缩幅＝键盘高度），报警现场
//   `inner=595 phone底=595`（壳已经贴着可视底、没有缝要填）而 `diff=320` 与键盘同值。此时再叠
//   一个 top:320 不是填缝，是把整页——连 .phone 第一行那个状态栏——往下推 320px＝症状本体。
//   夹具＝把 innerHeight / visualViewport.height / offsetTop 三个读数按两种内核形态真造出来，
//   断言只取「.phone 被推下去多少」与「状态栏那一行在不在可视顶」两个几何事实。
//   ⚠️ 夹具纪律：A2 是对照组（Chromium 形态：innerHeight 不缩、只有 vv 缩）——修复必须**照旧**
//   在那一路补出 top:320，否则本批就是「把别人的修复打回去」的覆盖式修补。
//
// ② 收藏被清空：#1309 那把写闸只看「本次权威读回没回话」，回话之后本地那一包是什么没人核。
//   这台机 LS 整域 4127 键 ≈10.0MB（＝Gecko 系单源配额上限），于是本地快照就是最后一次同步写
//   成功的那份旧包——诊断单里同一个键两个读数（9.1KB / 4.3KB）即两侧已经不一致。两半合起来：
//   (i) 15838 那条补灌刻意「只在本地无收藏时补」⇒「本地有但比库里少」这一格永不修复＝用户视角
//   「收藏凭空少几百条」；(ii) restore-done／45s 兜底把 favDrainAll 放掉时传给 favDrain 的
//   idbRaw 恒为 null＝拿「没回话」当「库里没有」，基包退成那份残缺本地包，而下一次 saveFav
//   把这一包整份 idbSet 回库＝库里全量当场没了、不可追回。
//   夹具纪律：库里 3 条 / 本地 1 条必须是**两个不同内容**且本地那条是库里的子集，否则「并回来」
//   与「没并」看不出差别；B3 专门量屏上读数（只保住不丢不等于看得见）。
//   ⚠️ 本支不覆盖的那一格（如实记，别当已收口）：若权威那一发在 drain 之后才回话（delayOpen
//   那类连接堵住的时序），drain 当场无库包可用、仍是旧语义——留同一族 verify-1309 的 D 组继续
//   看着，本批不据以声称修好了那一路。
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('serve root = ' + root);
if (!existsSync(join(root, 'index.html'))) {
  console.error('✗ 被测根目录没有 index.html（喂错目录了）');
  process.exit(2);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (extname(p) === '') p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const reds = [];
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; reds.push(n); console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); }
};

// ---------------- S 组：锚点（产物＋src 双查；删除型须在旧形态命中） ----------------
console.log('\n== S 组：#1330 七针 ==');
const NEEDLES = [
  ['1330a', 'js/mobile-adapt.js', 'var _voidPan = (_aIH - (window.innerHeight || 0)) > 60;', 'src/js/mobile-adapt.js'],
  ['1330b', 'js/mobile-adapt.js', 'if (o > 0 && !_voidPan) {', 'src/js/mobile-adapt.js'],
  ['1330c', 'js/chat.js', 'const raw = idbRaw || favAuthRaw[cid] || null;', 'src/js/chat.js'],
  ['1330d', 'js/chat.js', 'favUnion(favUnion(cur, curLib), pend)', 'src/js/chat.js'],
  ['1330e', 'js/chat.js', 'if (favTouched[cid] || !idbRaw || idbRaw.length <= 2) return false;', 'src/js/chat.js'],
  ['1330f', 'js/chat.js', 'if (ii < 0 || (li >= 0 && ii <= li)) return false;', 'src/js/chat.js'],
];
const hits = (f, n) => { try { return readFileSync(join(root, f), 'utf8').split(n).length - 1; } catch (e) { return -1; } };
for (const [id, f, n, src] of NEEDLES) {
  const c = hits(f, n), s = hits(src, n);
  ok(c === 1 && s === 1, id + ' 在产物与 src 各恰命中 1 次', 'product=' + c + ' src=' + s);
}
ok(hits('js/chat.js', 'favDrain(c, null)') === 0, '#1330g 删除型：favDrainAll 不再把 null 当权威传给 drain', '命中 ' + hits('js/chat.js', 'favDrain(c, null)'));

// ---------------- 夹具公共 ----------------
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const K_FAV = 'xy-home-v2:default:fav-msgs';

// 视口形态伪造：__vpf = {ih 布局视口高, vh 视觉视口高, ot 视觉视口顶偏移}
// 只改这三个读数＋补发 resize，不碰 CSS 单位（dvh/svh 仍按真窗口）＝断言只取 JS 读到的几何。
function viewportFault() {
  return { content: `(function(){
    // 只伪造三个读数：布局视口高（innerHeight）、视觉视口高、视觉视口顶偏移。
    // 原生 getter 必须一次性抓到手里——定义属性之后再读 window.innerHeight 就是自己（递归），
    // 而在 document_start 取快照又拿到的是 meta viewport 生效前的缩放值（实测 2166），
    // 所以基线一律在「调用那一刻」经原生 getter 现取。
    var vv = window.visualViewport || null;
    var dIH = Object.getOwnPropertyDescriptor(window, 'innerHeight') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'innerHeight');
    var realIH = function () { try { return dIH && dIH.get ? dIH.get.call(window) : 0; } catch (e) { return 0; } };
    var dVH = null;
    try { dVH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vv), 'height'); } catch (e) {}
    var realVH = function () { try { return dVH && dVH.get ? dVH.get.call(vv) : realIH(); } catch (e) { return realIH(); } };
    var F = window.__vpf = { ih: 0, vh: 0, ot: 0, on: false };
    function fire() {
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
      try { if (vv) vv.dispatchEvent(new Event('resize')); } catch (e) {}
      try { if (vv) vv.dispatchEvent(new Event('scroll')); } catch (e) {}
    }
    // mode='content' ＝这台机的形态：键盘把布局视口一起缩掉（inner 与 vv 同缩＝resizes-content）
    // mode='visual'  ＝Chromium 那一路对照形态：innerHeight 恒等基线，只有视觉视口缩
    // mode='off'     ＝键盘收起，读数回基线
    window.__vpKb = function (mode, d) {
      var rih = realIH(), rvh = realVH();
      d = d || 320;
      if (mode === 'off') { F.on = false; F.ih = rih; F.vh = rvh; F.ot = 0; fire(); return { ih: rih, vh: rvh, ot: 0 }; }
      F.ih = mode === 'content' ? rih - d : rih;
      F.vh = rvh - d;
      F.ot = d;
      F.on = true;
      F.baseIH = rih; F.baseVH = rvh;
      fire();
      return { ih: F.ih, vh: F.vh, ot: F.ot, baseIH: rih, baseVH: rvh };
    };
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: function () { return F.on ? F.ih : realIH(); } });
    if (vv) {
      Object.defineProperty(vv, 'height', { configurable: true, get: function () { return F.on ? F.vh : realVH(); } });
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: function () { return F.on ? F.ot : 0; } });
      vv.scrollTo = function () { window.__vpScroll = (window.__vpScroll || 0) + 1; };
    }
  })();` };
}

async function newPage(opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 414, height: 915 }, deviceScaleFactor: 2.7, isMobile: true, hasTouch: true }, (opts && opts.ctx) || {}));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  page.__errs = errs;
  if (opts && opts.init) await page.addInitScript(opts.init);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const s = document.querySelector('.splash'); if (s) s.remove();
    document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await page.waitForTimeout(500);
  return { ctx, page };
}
const rawGet = (page, key) => page.evaluate((k) => {
  return new Promise((res) => {
    try {
      const rq = indexedDB.open('mochi-db');
      rq.onsuccess = () => {
        const db = rq.result;
        const nm = db.objectStoreNames.item(0);
        if (!nm) { res('ERR-NOSTORE'); return; }
        const g = db.transaction(nm, 'readonly').objectStore(nm).get(k);
        g.onsuccess = () => res(typeof g.result === 'string' ? g.result : JSON.stringify(g.result === undefined ? null : g.result));
        g.onerror = () => res('ERR');
      };
      rq.onerror = () => res('ERR-OPEN');
    } catch (e) { res('ERR:' + e.message); }
  });
}, key);
const parseLen = (s) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a.length : -1; } catch (e) { return -2; } };
const hasText = (s, t) => typeof s === 'string' && s.indexOf(t) >= 0;

// ================= A 组：状态栏连带页面掉下来 =================
// 主页面＝首页那一屏（.statusbar 是 .phone 的第一行，不是 fixed）；聊天输入框只是「把键盘
// 会话真造出来」的把手（mobile-adapt 的焦点判据只看 activeElement，不看它在不在当前屏上）。
async function kbPage() {
  const { ctx, page } = await newPage({ init: viewportFault() });
  const fok = await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'text';
    i.id = 'zz1330-in';
    i.style.cssText = 'position:fixed;left:8px;top:120px;width:200px;height:32px';
    document.body.appendChild(i);
    i.focus();
    i.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // 焦点判据取「这一发落在不在可编辑框上」这一个事实：安卓那一路 mobile-adapt 会把 input
    // 转成 .ce-box（contenteditable），原 input 变幽灵锚点＝activeElement 是 DIV 才是对的
    var ae = document.activeElement;
    return (ae && (ae.isContentEditable === true || ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type === 'text')))
      ? 'focused' : ('active=' + (ae ? (ae.tagName + '.' + (ae.className || '') + '.edit=' + !!(ae.isContentEditable)) : 'null'));
  });
  await page.waitForTimeout(900);
  return { ctx, page, fok };
}
const geom = (page) => page.evaluate(() => {
  const p = document.querySelector('.phone');
  const sb = document.querySelector('.statusbar');
  const cs = sb ? getComputedStyle(sb) : null;
  return {
    top: p ? (p.style.top || '') : '(无.phone)', h: p ? (p.style.height || '') : '',
    inner: window.innerHeight, vvH: window.visualViewport ? Math.round(window.visualViewport.height) : -1,
    ot: window.visualViewport ? window.visualViewport.offsetTop : -1,
    sbTop: sb ? Math.round(sb.getBoundingClientRect().top) : -999,
    sbShown: !!(cs && cs.display !== 'none' && cs.visibility !== 'hidden'),
    kb: !!(window.__mochiKbDiag && window.__mochiKbDiag),
  };
});
console.log('\n== A 组：键盘期整页下坠（.phone 被推下去多少）==');
{
  const { ctx, page, fok } = await kbPage();
  const a0 = await page.evaluate(() => ({
    phone: !!document.querySelector('.phone'), vv: !!window.visualViewport,
    sb: !!document.querySelector('.statusbar'), baseTop: document.querySelector('.phone').style.top || '',
    ih: window.innerHeight,
  }));
  ok(a0.phone && a0.vv && a0.sb && a0.ih === 915 && fok === 'focused',
    'A0 夹具在场（.phone / .statusbar 取得到、真窗口高 915、文本焦点真落上＝否则本组读数为假）', JSON.stringify({ a0, fok }));
  // 【症状本体】这台机的形态：键盘把布局视口一起缩掉（inner 915→595）而内核仍报 offsetTop=320
  const s1 = await page.evaluate(() => window.__vpKb('content'));
  await page.waitForTimeout(1500);
  const a1 = await geom(page);
  ok(s1.ih === s1.baseIH - 320 && s1.ot === 320 && a1.sbShown && a1.inner === s1.ih,
    'A1a 现场真造出来了：布局视口矮了 320 而 offsetTop 照报 320（红＝夹具没成形，A1 是空跑）', JSON.stringify({ s1, a1 }));
  ok(a1.top === '' || a1.top === '0px', 'A1【症状本体】布局视口自己矮了＝无缝可补，.phone 不许被推下去', 'style.top=' + JSON.stringify(a1.top));
  ok(a1.sbTop <= 1, 'A1b 主页面那一行状态栏仍在可视顶（掉下来＝它跟着整页往下走了多少像素）', 'statusbar rect.top=' + a1.sbTop);
  ok(page.__errs.length === 0, 'Z1a A1 全程零未捕获异常', page.__errs.join(' | '));
  await ctx.close();
}
{
  // 对照组：Chromium 形态（innerHeight 恒等基线、只有视觉视口缩）——填缝补偿必须照旧生效。
  // 单开一屏＝基线 _aIH 没被上一档的键盘会话污染过（同页连测会把对照组测成假红）
  const { ctx, page } = await kbPage();
  const s2 = await page.evaluate(() => window.__vpKb('visual'));
  await page.waitForTimeout(1500);
  const a2 = await geom(page);
  ok(s2.ih === s2.baseIH && s2.ot === 320 && a2.inner === s2.baseIH && a2.vvH <= a2.inner - 300,
    'A2a 对照组现场（布局视口没缩＝真·视觉平移；红＝夹具没成形，A2 是空跑）', JSON.stringify({ s2, a2 }));
  ok(a2.top === '320px', 'A2【不许修过头】视觉视口被平移那一档，补偿照旧要写 top:320px', 'style.top=' + JSON.stringify(a2.top));
  await page.evaluate(() => { window.__vpKb('off'); });
  await page.waitForTimeout(1800);
  const a3 = await geom(page);
  ok(a3.top === '' || a3.top === '0px', 'A3 键盘收起后 .phone 内联 top 必须为空（残留＝掉下来永远不恢复）', JSON.stringify(a3));
  ok(a3.sbTop <= 1, 'A3b 收起后状态栏回到可视顶', 'rect.top=' + a3.sbTop);
  ok(page.__errs.length === 0, 'Z1b A2/A3 全程零未捕获异常', page.__errs.join(' | '));
  await ctx.close();
}

// ================= B 组：收藏「本地残缺快照 × 库里全量」 =================
console.log('\n== B 组：收藏几百条被突然清空（本地残缺快照那半）==');
const LIB = JSON.stringify([
  { side: 'in', text: '旧收藏1', type: 'text', ts: 1700000000001, by: 'ta' },
  { side: 'out', text: '旧收藏2', type: 'text', ts: 1700000000002, by: 'me' },
  { side: 'in', text: '旧收藏3', type: 'text', ts: 1700000000003, by: 'ta' },
]);
const STALE = JSON.stringify([{ side: 'out', text: '旧收藏2', type: 'text', ts: 1700000000002, by: 'me' }]);
async function seedBoth(page, key, libVal, lsVal) {
  await page.evaluate(async (a) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('mochi-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const st = db.transaction(db.objectStoreNames.item(0), 'readwrite').objectStore(db.objectStoreNames.item(0));
    await new Promise((res) => { const q = st.put(a.lib, a.key); q.onsuccess = res; q.onerror = res; });
    try { localStorage.setItem(a.key, a.ls); } catch (e) {}
    db.close();
  }, { key, lib: libVal, ls: lsVal });
}
{
  const { ctx, page } = await newPage();
  await seedBoth(page, K_FAV, LIB, STALE);
  const b0 = await rawGet(page, K_FAV);
  ok(parseLen(b0) === 3 && hasText(b0, '旧收藏1') && hasText(b0, '旧收藏3'),
    'B0 夹具真把 3 条灌进库里（红＝夹具坏，不是产品的锅）', '库里 ' + parseLen(b0) + ' 条');
  const b0b = await page.evaluate((k) => ({ ls: (localStorage.getItem(k) || '').slice(0, 40), lsN: (JSON.parse(localStorage.getItem(k) || '[]') || []).length }), K_FAV);
  ok(b0b.lsN === 1, 'B0b LS 侧那份真是残缺快照（1 条 ⊂ 库里 3 条＝诊断单同一键两个读数 9.1KB/4.3KB 的形状）', JSON.stringify(b0b));
  // 重载＝走真实启动链路（回填以 LS 为准 → 库里那一发稍后回答）
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.remove(); document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove()); });
  await page.waitForTimeout(2500);
  const b1 = await page.evaluate(() => { try { return { n: JSON.parse(window.xyStore('xy-home-v2:default').get('fav-msgs') || '[]').length }; } catch (e) { return { n: -9 }; } });
  ok(b1.n === 3, 'B1 库里那 3 条要真的补回本地（只保住不丢不等于看得见；旧写法「只在本地无收藏时补」＝这一格永不修复）', '本地读数=' + b1.n);
  // 用户此刻收藏一条新的（＝那台机的下一个动作）
  let werr = '';
  try { await page.evaluate(() => { window.addMyFavItem({ side: 'out', text: '新收藏一条', type: 'text', ts: Date.now() }); }); } catch (e) { werr = String(e.message).slice(0, 80); }
  ok(!werr, 'B1b 真收藏入口跑得起来（红＝这一组没写到数据，后面的断言不算数）', werr);
  await page.waitForTimeout(3500);
  const after = await rawGet(page, K_FAV);
  ok(hasText(after, '旧收藏1') && hasText(after, '旧收藏3'),
    'B2【症状本体】本地是残缺快照时的一次收藏，不许把库里那几条整包顶掉（丢了就永久救不回来）', '库里 ' + parseLen(after) + ' 条；' + String(after).slice(0, 70));
  ok(hasText(after, '新收藏一条'), 'B3 新收藏自己必须落盘（拒覆盖≠拒保存）', String(after).slice(0, 70));
  const cnt = parseLen(after);
  ok(cnt === 4, 'B4 并回来的是 3 旧＋1 新，一条不多一条不少（重复＝favItemKey 那把尺子失效）', '库里 ' + cnt + ' 条');
  ok(page.__errs.length === 0, 'Z1b B 组全程零未捕获异常', page.__errs.join(' | '));
  await ctx.close();
}
// 健康对照：本地已经＝库里（无残缺）时，修复不许凭空多写、更不许把库里的顺序/条数打乱
{
  const { ctx, page } = await newPage();
  await seedBoth(page, K_FAV, LIB, LIB);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.remove(); document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove()); });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { window.addMyFavItem({ side: 'out', text: '健康对照一条', type: 'text', ts: Date.now() }); });
  await page.waitForTimeout(2500);
  const h = await rawGet(page, K_FAV);
  ok(parseLen(h) === 4 && hasText(h, '旧收藏1') && hasText(h, '健康对照一条'),
    'C1 本地与库里一致时＝只多这一发新收藏（修复没把「并集」做成重排／翻倍）', '库里 ' + parseLen(h) + ' 条');
  ok(page.__errs.length === 0, 'Z1c C 组全程零未捕获异常', page.__errs.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n结果：绿 ' + pass + ' / 红 ' + fail);
if (reds.length) console.log('红条清单：\n  ' + reds.join('\n  '));
process.exit(fail ? 1 : 0);

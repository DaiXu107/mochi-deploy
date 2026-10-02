// verify-1351-ccimport-tree-window.mjs — #1351 字卡库「页面已画出、编辑树还在取回途中」那一发，与「选完文件之后抛掉的那一口」
//
// 立项（用户 2026-09-28 直派，iPhone 15／iOS 17.6.1 实报「上次的大部分需要添加图片的功能都已修复，
//   但表情包和图片，以及通话背景还是无法添加」，并明说「不要覆盖修改导致不同型号设备浏览器的 bug
//   反复出现，这个问题其他设备型号也有出现」；附 mochi-diag-2026-09-27-17-58-…docx）：
//   无头真跑（顽固内核仿真＝showPicker 抛错＋file input 合成 click 无效＋label 转发被吞，剩唯一
//   能弹的路＝手指物理落在真层上）量到的三条互不相同的事实：
//     ① 门是好的：#cc-import（表情包/图片批量导入）与 #call-bg-row（通话背景）两格在报障机型视口下
//        第一发就 surf:hit＋surf:files=1；通话背景在「LS 每一发都抛」的机器上照样落库、重载仍在。
//        而那张诊断单自己写着：本机构建 13:28／线上部署 23:26＝落后约 10 小时（#1323/#1343/#1348 三批
//        的门都还没进这台手机）＝「修好了但对这台手机等于没修过」。
//     ② 真病灶：openCcPage 是 `ccPage.hidden=false` 先画整页，`groups`（编辑树）要等
//        maybeAutoSlimLib().then(hydrateCurScope().then(...)) 两跳 promise 才被赋值；#455 的批注立的
//        规矩是「所有读 groups 的路径必须先判空」，可这一页画出来那一刻就【可点】，而 #574 自己量过
//        这一段「iOS 挂后台杀 IDB 连接后单次读最长 6s、重试链最长 14s」。窗口期里 ccImportMedia 第一行
//        groups[cur] 无判空 ⇒ TypeError 被选择器层的空 catch 吞掉。取证读数逐字：页面可见＋本地读
//        0 字节＋列表亮「正在加载字卡…」时点那一发＝chooser=1、surfIn=1、
//        err="Cannot read properties of null (reading 'sticker')"、toast 零条＝用户所见
//        「点了没反应，没有显示成功和失败，无变化」。
//     ③ 黑洞本身：三条腿（真层 surface／统一入口／弹窗确定）的 `try { onFiles(files) } catch {}`
//        把异常吞在离屏幕最近的地方——诊断【最近错误】段零条，报障只剩「无法添加」两个字。
//   改法（判据零机型／零 UA，只取三个当场事实）：①「这一格现在有没有编辑树」→ 画页这一刻先按本地
//   读数把树立起来（loadGroups 恒返回对象；本机没有＝空壳、不解析大串＝零成本），把 #455 那条规矩
//   变成事实上的不变量「页可见期间树必非空」；此时 ccAuthSeen 未置＝写回照旧走 #193/#455 的
//   rescueCcOverwrite 按分组合并进权威库，绝不整包顶掉。②「这一发回调抛没抛」→ 三条腿都如实出账
//   （取证环 cb:err＋__jsErrors＋一句人话 toast），只加反馈不改任何一条腿的行为。③「线上 ts 比本页
//   新不新」→ 判出的那一刻请一次 registration.update()（全站此前没有一处），换版【落地】时机一字
//   未动（#965 待换版登记／#992 保活闸门／手动更新条照旧）。
//
// 断言（同一把尺子在「tip＋仅本批」与「纯 tip」两侧各跑一遍；实测读数＝绿侧 34 绿/0 红 · 红侧 20 绿/14 红）：
//   A 组＝症状本体（真产物＋真入口 #li-custom-cards＋顽固内核仿真＋把「从库里取回这一趟」放慢 6 秒）：
//         页面已画出／本地这一格读不到且取回还在路上／加载态一字未改／这一格确实躺着可命中的真层（两侧
//         皆然＝门不是本批的账）／第一发就弹且文件换得回来（两侧皆然）／回调不再抛／库里真多出这一张／
//         界面真画出一行／原有旧卡一张没少
//   B 组＝黑洞本身（夹具层必抛，走产品同一个模具）：取证环 cb:err＋用户看得见一句人话＋__jsErrors 一条
//         （红侧三条皆零＝异常吞在离屏幕最近的地方，诊断与用户两头都看不见）
//   C 组＝送达：判出线上有新版 ⇒ registration.update() 当场请一次（红侧全站 0 次）；且保活开着时
//         本批没把「后台自动落地」放出去（#992 那道闸门原样在位）
//   D 组＝健康对照：正常开页路径照旧加得进、一次一颗不双开、旧契约（有层就不走合成腿）不动
//   S 组＝七支逻辑锚；Z 组＝全程零未捕获异常
//
// 用法：node build.mjs && node tools/verify-1351-ccimport-tree-window.mjs
//       SERVE_ROOT=<产物目录> 做红绿对照（对照时务必显式传）
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here);
console.log('被测根目录 = ' + root);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
let verTick = 0; // version.json 的 ts 每次 fetch 递增＝天然「线上比这一页新」
const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u.endsWith('/version.json')) {
      verTick++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ts: 1700000000000 + verTick * 1000, info: 'verify-1351' }));
      return;
    }
    let p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/index.html';

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n + (x !== undefined ? '  [' + x + ']' : '')); } else { fail++; console.log('  FAIL  ' + n + '  [' + (x === undefined ? '' : x) + ']'); } };
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbOzwzQAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');
const KEY = 'xy-home-v2:default:cc-groups';

// ===== S 组：逻辑锚 =====
console.log('[S] 逻辑锚');
const inl = read('index.html');
const cc = read('js/chatcard.js');
const pw = read('index.html'); // pwa.js 与 device.js 同族＝内联件，产物里没有单独的 js/pwa.js
ok(cc.includes('try { groups = loadGroups(); } catch (eCcTree) {}'), 'S1 字卡库画页这一刻先把编辑树立起来（删＝窗口期那一发落在 null 树上＝用户所见「点了没反应、无变化」）');
ok(inl.includes('window.mochiPickCbFail = function (entry, e, nFiles) {'), 'S2 选完文件之后那一步的异常有人报（空 catch 吞在离屏幕最近的地方＝诊断与用户两头都看不见）');
ok(inl.includes("(btn && btn.id) || input.id || 'surf', eCb, files.length"), 'S3 真层（surface）那条腿接入出账（只修统一入口＝铺了门的这一族仍旧静默）');
ok(inl.includes("(input && input.id) || 'pick', eCb2, files.length"), 'S4 统一入口那条腿接入出账');
ok(inl.includes("o.entry || 'modal-ok', e9, files.length"), 'S5 弹窗「确定」那条腿接入出账');
ok(pw.includes("if (r && typeof r.update === 'function') r.update();"), 'S6 判出线上有新版就去请 sw.js 重装（全站此前没有一处 registration.update()＝新包只能等浏览器自己的 24h 更新检查）');
ok(pw.includes('if (ts > baseTs) askSwUpdate();'), 'S7 冷启动/重进那一发同样请一次（只在轮询请＝几天不重新导航的会话仍然收不到包）');

// ===== 公共夹具 =====
const SIM = ([opt]) => {
  const o = opt || {};
  try {
    localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
    localStorage.setItem('xy-home-v2:__guide-done', '1');
    localStorage.setItem('xy-home-v2:__onboard-done', '1');
    localStorage.removeItem('xy-home-v2:default:cc-groups');
  } catch (e) {}
  if (o.keepAlive) { try { localStorage.setItem('xy-home-v2:bg-keepalive', '1'); } catch (e) {} }
  if (o.lsDead) {
    const r0 = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (/__last-backup-remind|__guide-done|__onboard-done|bg-keepalive|__big-idx|__probe|__ls-dirty|chat-msgs|cc-groups|__pick-doors/.test(String(k))) return r0.call(this, k, v);
      throw new DOMException('quota', 'QuotaExceededError');
    };
  }
  document.addEventListener('click', (e) => {
    try { if (e.target && e.target.closest && e.target.closest('label[data-file-pick-for]')) e.preventDefault(); } catch (x) {}
  }, true);
  try { HTMLInputElement.prototype.showPicker = function () { throw new Error('NotAllowedError'); }; } catch (e) {}
  const raw = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () { try { if (this && this.tagName === 'INPUT' && this.type === 'file') return; } catch (e) {} return raw.apply(this, arguments); };
  window.__toasts = []; window.__reloads = 0;
  const hookT = () => { if (!window.toast || window.__toastHooked) return; window.__toastHooked = 1; const f = window.toast; window.toast = function (m) { try { window.__toasts.push(String(m).slice(0, 120)); } catch (e) {} return f.apply(this, arguments); }; };
  hookT(); setInterval(hookT, 150);
  try { Object.defineProperty(Location.prototype, 'reload', { value: function () { window.__reloads++; }, configurable: true }); } catch (e) {}
  // C 组尺子：数 registration.update() 请了几次
  try {
    window.__swUpdates = 0;
    const g = navigator.serviceWorker && navigator.serviceWorker.getRegistration && navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker);
    if (g) {
      navigator.serviceWorker.getRegistration = function () {
        return g().then((r) => ({ waiting: r && r.waiting, active: r && r.active, installing: r && r.installing,
          update: function () { window.__swUpdates++; return Promise.resolve(); },
          unregister: function () { return Promise.resolve(false); } }));
      };
    }
  } catch (e) {}
  // 窗口期尺子：把「从库里取回这一趟」放慢（＝#574 批注里 iOS 挂后台杀 IDB 后实测的 6s/14s 形态）
  const hookH = () => {
    if (!window.idbHydrateKey || window.__hHooked) return;
    window.__hHooked = 1;
    const orig = window.idbHydrateKey;
    window.idbHydrateKey = function (k) {
      const r = orig.apply(this, arguments);
      if (String(k).indexOf('cc-groups') < 0) return r;
      window.__hydrated = (window.__hydrated || 0) + 1;
      return new Promise((res) => setTimeout(() => { Promise.resolve(r).then((v) => res(v)); }, o.hydrateDelay || 0));
    };
  };
  hookH(); setInterval(hookH, 100);
};

async function boot(opt) {
  const o = opt || {};
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, lastChooser: 0, errs: [], ring: [] };
  page.on('filechooser', async (fc) => { st.chooser++; st.lastChooser = Date.now(); try { await fc.setFiles({ name: 'v1351.png', mimeType: 'image/png', buffer: PNG }); } catch (e) {} });
  page.on('pageerror', (e) => st.errs.push(String(e.message).slice(0, 200)));
  await page.addInitScript(SIM, [o]);
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s && s.parentNode) s.parentNode.removeChild(s);
    const q = document.getElementById('qa-mask'); if (q) { q.style.display = 'none'; q.hidden = true; }
    ['modal-mask', 'pc-sheet-mask', 'backup-remind-bar', 'daily-greet'].forEach((id) => { const x = document.getElementById(id); if (x) { x.hidden = true; x.style.display = 'none'; } });
  });
  st.setup = () => page.evaluate(() => {
    ['modal-mask', 'pc-sheet-mask', 'backup-remind-bar', 'daily-greet'].forEach((id) => { const x = document.getElementById(id); if (x) x.hidden = true; });
    document.querySelectorAll('[id$="-mask"]').forEach((m) => { if (m.id !== 'tc-mask' && !m.hidden) m.hidden = true; });
    document.body.classList.remove('scroll-lock');
  });
  st.quiet = async (ms) => { for (let i = 0; i < 45; i++) { if (Date.now() - st.lastChooser > (ms || 1200)) return; await page.waitForTimeout(150); } };
  st.xy = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; try { el.scrollIntoView({ block: 'center' }); } catch (e) {} const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, sel);
  st.tap = async (selOrPos, settle) => {
    const pos = typeof selOrPos === 'string' ? await st.xy(selOrPos) : selOrPos;
    if (!pos) return -1;
    await st.setup(); await st.quiet(settle === undefined ? 1300 : settle); st.chooser = 0;
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(1500); await st.quiet(1300);
    return st.chooser;
  };
  st.ring = () => page.evaluate(() => (window.__mochiPickLog || []).map((x) => x.e + '/' + x.s).join(' , '));
  st.toasts = () => page.evaluate(() => (window.__toasts || []).slice(-6));
  st.jsErr = () => page.evaluate(() => (window.__jsErrors || []).filter((x) => /选图导入/.test(String(x))).length);
  // 用产品自己的释放口把「本机这一格」清成读不到（＝#1195e 切后台／页面回收后的真实形态）
  st.dropLocal = () => page.evaluate((k) => { try { localStorage.removeItem(k); } catch (e) {} if (window.idbMemoDrop) window.idbMemoDrop(k); }, KEY);
  st.seed = () => page.evaluate(async (k) => {
    const j = JSON.stringify({ text: [['老分组', ['旧卡一', '旧卡二']]], sticker: [['表情包默认', ['@@m:000000000000000000000000000000aa']]] });
    const w = await Promise.resolve(window.idbSet(k, j));
    return { wrote: w, idb: ((await Promise.resolve(window.idbGet(k))) || '').toString().length };
  }, KEY);
  st.openCc = async (drop) => {
    await page.evaluate(() => { document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== 'page-chatcard'; }); });
    await page.waitForTimeout(220);
    await page.evaluate(() => { const li = document.getElementById('li-custom-cards'); if (li) li.click(); });
    await page.waitForTimeout(240);
    if (drop !== false) await st.dropLocal();
    // 加载态要在「点分类 tab 之前」量：tab 的 click 会调 render() 把加载行覆掉
    st.snap = await page.evaluate(() => ({
      visible: !document.getElementById('page-custom-cards').hidden,
      localRead: ((window.xyStore('xy-home-v2:default') || {}).get('cc-groups') || '').length,
      loading: (document.getElementById('cc-list') || {}).textContent.indexOf('正在加载字卡') >= 0,
      hydrate: window.__hydrated || 0
    }));
    await page.evaluate(() => { const t = document.querySelector('.cc-tab[data-type="sticker"]'); if (t) t.click(); });
    await page.waitForTimeout(320);
    st.door = await page.evaluate(() => {
      const b = document.getElementById('cc-import');
      const L = b && b.querySelector(':scope > input[data-file-pick-surface]');
      const rb = b ? b.getBoundingClientRect() : null;
      const rl = L ? L.getBoundingClientRect() : null;
      const u = rb && rb.width ? document.elementFromPoint(Math.round(rb.x + rb.width / 2), Math.round(rb.y + rb.height / 2)) : null;
      return {
        btn: rb ? [Math.round(rb.width), Math.round(rb.height)] : 'none',
        layer: L ? (L.id + ' ' + Math.round(rl.width) + 'x' + Math.round(rl.height)) : 'NO-LAYER',
        hit: u ? (u.id || u.tagName) : 'none',
        listTxt: ((document.getElementById('cc-list') || {}).textContent || '').slice(0, 16)
      };
    });
  };
  // 在真层上挂一道「文件回来了」的记录环，专门量这一发到底抛没抛（不改产品行为）
  st.hookOnFiles = () => page.evaluate(() => {
    const L = document.getElementById('cc-import-media-surf');
    if (!L || !L.__mochiSurface || typeof L.__mochiSurface.onFiles !== 'function') return 'no-layer';
    if (L.__v1351) return 'already';
    L.__v1351 = 1;
    const orig = L.__mochiSurface.onFiles;
    window.__surfErr = ''; window.__surfIn = 0;
    L.__mochiSurface.onFiles = function (fs) { window.__surfIn = (fs || []).length; try { orig(fs); } catch (e) { window.__surfErr = String((e && e.message) || e).slice(0, 140); } };
    return 'hooked';
  });
  st.surfState = () => page.evaluate(() => ({ err: window.__surfErr || '', files: window.__surfIn || 0 }));
  st.readLib = () => page.evaluate(async (k) => {
    const cnt = (raw) => { let n = 0, old = 0; try { const o = JSON.parse(raw || '{}'); Object.keys(o).forEach((t) => (o[t] || []).forEach((g) => { (g[1] || []).forEach((c) => { n++; if (String(c).indexOf('旧卡') >= 0) old++; }); })); } catch (e) {} return { n, old }; };
    const own = String((await Promise.resolve(window.idbGet(k))) || '');
    const pub = String((await Promise.resolve(window.idbGet('xy-home-v2:cc-groups-public'))) || '');
    return { ownLen: own.length, ownCards: cnt(own), pubCards: cnt(pub), grid: document.querySelectorAll('#cc-list .cc-card, #cc-list img').length };
  }, KEY);
  st.ctx = ctx; st.page = page;
  return st;
}
const browser = await chromium.launch({ headless: true });

// ===== A 组：症状本体（顽固内核＋取回慢 6 秒的窗口期） =====
console.log('[A] 窗口期那一发（字卡库画好了、树还在库里那条路上）');
{
  const st = await boot({ hydrateDelay: 6000 });
  const seed = await st.seed();
  ok(seed.idb > 40, 'A0 种库里真有一本（红绿两侧同尺子的前提）', JSON.stringify(seed));
  await st.openCc();
  const vis = st.snap;
  ok(vis.visible === true, 'A1 整页已画出（可点状态＝用户眼里这就是字卡库）', JSON.stringify(vis));
  ok(vis.localRead === 0 && vis.hydrate >= 1, 'A2 本机这一格读不到、取回确实还在路上（窗口真造出来了，不是自造旁路）', 'local=' + vis.localRead + ' hydrate=' + vis.hydrate);
  ok(vis.loading === true, 'A3 列表仍亮「正在加载字卡…」（#574 那格加载态一字未改）');
  const hk = await st.hookOnFiles();
  const before = await st.readLib();
  ok(hk === 'hooked' && st.door.hit === 'cc-import-media-surf' && st.door.layer.indexOf('NO-LAYER') < 0, 'A4 这一格确实躺着真层、落点命中的就是它（两侧皆然＝门不是本批的账：#1323 修「有没有层」、#1343 修「层是不是 0×0 死层」、#1348 修「层赶不赶得上一发点按」，三件事都已在这格成立）', JSON.stringify(st.door) + ' hook=' + hk);
  const ch = await st.tap('#cc-import');
  const ringA = await st.ring();
  ok(ch === 1 && /surf:hit/.test(ringA) && /surf:files=1/.test(ringA), 'A5 顽固内核仿真下第一发就弹、文件换得回来（两侧皆然；报障那台 iPhone 跑的是这三批之前的旧包——那张诊断单自己写着本机构建 13:28／线上部署 23:26＝落后约 10 小时）', 'chooser=' + ch + ' ' + ringA.slice(-90));
  const sp = await st.surfState();
  ok(sp.files === 1, 'A6 选中的文件回到入口原有管线（原生腿换回了真文件；A5/A6 两侧皆绿＝本批没动门，红的恰是门之后那一步）', JSON.stringify(sp));
  ok(sp.err === '', 'A7 这一发不再抛（红侧逐字＝"Cannot read properties of null (reading \'sticker\')"＝整页画好了、树还在库里那条路上，而 ccImportMedia 第一行就是 groups[cur]，异常被层的空 catch 吞在离屏幕最近的地方）', JSON.stringify(sp));
  await st.page.waitForTimeout(6000 + 3500);
  const lib = await st.readLib();
  ok(lib.ownCards.n + lib.pubCards.n > before.ownCards.n + before.pubCards.n, 'A8 库里真的多出这一张（红侧读数逐字＝own 0 张、新增 0 张＝用户那句「没有显示成功和失败，无变化」）', 'before=' + JSON.stringify(before) + ' after=' + JSON.stringify(lib));
  ok(lib.grid >= 1, 'A9 界面也真的画出了一行（红侧 grid=0＝「无变化」的反面）', 'grid=' + lib.grid);
  ok(lib.ownCards.old + lib.pubCards.old >= before.ownCards.old + before.pubCards.old, 'A10 原有旧卡一张没少（窗口期写回照旧走 #193/#455 的按分组合并，绝不拿空树整包顶掉权威键＝本批没把覆盖防线改松）', JSON.stringify(lib));
  ok(st.errs.length === 0, 'Z1 A 组零未捕获异常', JSON.stringify(st.errs.slice(0, 3)));
  await st.ctx.close();
}

// ===== B 组：黑洞本身（夹具层必抛＝三条腿之外，证明「抛了」这件事现在看得见） =====
console.log('[B] 回调抛错如实出账（夹具层必抛）');
{
  const st = await boot({});
  const built = await st.page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'b1351-stage';
    box.style.cssText = 'position:fixed;left:14px;top:120px;width:220px;height:52px;z-index:99998;background:#223;';
    box.innerHTML = '<div id="b1351-btn" style="position:relative;width:200px;height:48px;line-height:48px;color:#fff">选一选</div>';
    document.body.appendChild(box);
    const btn = document.getElementById('b1351-btn');
    window.mochiFilePickSurface(btn, {
      id: 'b1351-surf', accept: 'image/*',
      onFiles: function () { throw new Error('夹具：这一发就是要抛'); }
    });
    return !!btn.querySelector('input[data-file-pick-surface]');
  });
  ok(built, 'B0 夹具层铺上了（走产品同一个模具 mochiFilePickSurface）');
  const ch = await st.tap('#b1351-btn');
  await st.page.waitForTimeout(800);
  const ring = await st.ring();
  const toasts = await st.toasts();
  const je = await st.jsErr();
  ok(ch === 1, 'B1 夹具那一发弹了选择器并换回文件', 'chooser=' + ch);
  ok(/cb:err/.test(ring), 'B2 取证环出现 cb:err（真机诊断单【文件选择取证】从此看得见这一族）', ring.slice(-120));
  ok(toasts.some((t) => /没走完/.test(t)), 'B3 用户看得见一句人话（红侧＝toast 零条＝「点了没反应」）', JSON.stringify(toasts.slice(-3)));
  ok(je >= 1, 'B4 __jsErrors 落了一条[选图导入]（红侧＝整份诊断零异常＝写坏不是读崩也查不到）', 'jsErrors=' + je);
  ok(st.errs.length === 0, 'Z2 B 组零未捕获异常（异常仍被兜住，只是不再无人知道）', JSON.stringify(st.errs.slice(0, 3)));
  await st.ctx.close();
}

// ===== C 组：送达（判出新版就去请包；落地时机不动） =====
console.log('[C] 知道有线上新版 ⇒ 当场请一次 sw.js（本机诊断实证落后约 10 小时）');
{
  const st = await boot({ keepAlive: true });
  await st.page.waitForTimeout(1500);
  const u0 = await st.page.evaluate(() => window.__swUpdates || 0);
  // 让轮询走到「线上 ts 比本页基线新」那一支：baseTs 取首次 fetch，第二次起每次都比上一次新
  await st.page.waitForTimeout(18000);
  const c1 = await st.page.evaluate(() => window.__swUpdates || 0);
  ok(c1 > u0, 'C1 判出新版的这一刻请了 update()（红侧＝全站 0 次，新包永远等浏览器自己那发 ≤24h 的检查）', 'updates ' + u0 + '→' + c1);
  const barOrReload = await st.page.evaluate(() => ({ reloads: window.__reloads || 0, bar: !!(document.getElementById('ver-update-bar') && !document.getElementById('ver-update-bar').hidden) }));
  ok(barOrReload.reloads === 0, 'C2 保活开着时本批没把「自动落地」放出去（#992 那道闸门原样在位；条照旧由用户挑时机）', JSON.stringify(barOrReload));
  ok(st.errs.length === 0, 'Z3 C 组零未捕获异常', JSON.stringify(st.errs.slice(0, 3)));
  await st.ctx.close();
}

// ===== D 组：健康对照（正常开页路径与安卓形态一字不变） =====
console.log('[D] 健康对照（正常开页／内核配合）');
{
  const st = await boot({ hydrateDelay: 0 });
  // 健康对照＝本机读得到这一格（不走取回那条路）：种子直接写进当前作用域的读数里
  await st.page.evaluate((k) => {
    const j = JSON.stringify({ text: [['老分组', ['旧卡一', '旧卡二']]], sticker: [['表情包默认', ['@@m:000000000000000000000000000000aa']]] });
    try { window.xyStore('xy-home-v2:default').set('cc-groups', j); } catch (e) {}
    return Promise.resolve(window.idbSet(k, j));
  }, KEY);
  await st.openCc(false);
  const hk = await st.hookOnFiles();
  const d1 = await st.tap('#cc-import');
  const sp = await st.surfState();
  await st.page.waitForTimeout(2500);
  const lib = await st.readLib();
  ok(d1 === 1 && sp.err === '', 'D1 正常开页路径照旧加得进（一次一颗、回调不抛）', 'chooser=' + d1 + ' ' + JSON.stringify(sp) + ' hook=' + hk);
  ok(lib.ownCards.n + lib.pubCards.n >= 4, 'D2 这一发确实落库（种子 3 张＋新增 1 张都读得回来）', JSON.stringify(lib));
  ok(lib.ownCards.old + lib.pubCards.old >= 2, 'D2b 原有旧卡一张没少（健康对照＝本批没把覆盖防线改松）', JSON.stringify(lib));
  const ring = await st.ring();
  ok(!/leg:fire/.test(ring), 'D3 有层的那一发根本不该再走合成腿', ring.slice(-120));
  const d4 = await st.tap('#cc-import');
  ok(d4 === 1, 'D4 第二发仍是一颗（不双开）', 'chooser=' + d4);
  ok(st.errs.length === 0, 'Z4 D 组零未捕获异常', JSON.stringify(st.errs.slice(0, 3)));
  await st.ctx.close();
}

await browser.close();
server.close();
console.log('\n结果：' + pass + ' 绿 / ' + fail + ' 红');
process.exit(fail ? 1 : 0);

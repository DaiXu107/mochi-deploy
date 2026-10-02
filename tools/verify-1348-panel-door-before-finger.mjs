// verify-1348-panel-door-before-finger.mjs — #1348 面板里现画出来的那颗上传按钮，门必须赶在手指落下之前就在
//
// 立项（用户 2026-09-27 直派，iPhone 16／iOS 26.4／存到桌面＋Safari 实报「无法导入本地下载好的音乐……
//   点击上传后软件没有反应，没有显示成功和失败，无变化」，并明说「不同型号不同 iOS 系统可能出现不同问题，
//   不要覆盖修改导致不同型号设备浏览器的 bug 反复出现。这个问题其他设备型号也有出现」）：
//   同一把尺子在真机诊断单上量到的 A/B（全部零机型／零 UA 分支，只取「这一发有没有换回文件」一个事实）——
//     iOS 4 张单 6 发：mochi-mochi-music-local-pick／mochi-featuredata-import-pick／mochi-card-bg-pick／
//       mochi-call-bg-pick 全是 leg:fire ＋ srf:0 ＋ fb:onscreen，**一条 files=N 都没回来**；
//     安卓 2 张单：mochi-sfx-pick 同一条 fb:onscreen 之后 fb:files=1 → files=1（同一格在 Chromium 活得很好）；
//     iOS 同设备：avlib-upload／cc-import／feed-my-av 走 surf:hit 的全部 surf:files=N 成功。
//   ⇒ 病灶不是机型，是「这一发手指落在的是不是一个真 file input」。#1323 已经把这条做成通用模具＋自学台账，
//   但它补装的时机是**下一次点按的 pointerdown**：同一发的 click 事件按 mousedown 靶与 mouseup 靶的最近
//   共同祖先重新定靶，层是 mousedown 之后才出现的 ⇒ 靶回到按钮本身、这一发仍走合成腿（无头实测取证环
//   leg:fire＋srf:1＋fb:onscreen、一次 surf:hit 都没有）。而 `openTCPanel` 这类面板每次打开都 innerHTML
//   整块重画 ＝ 刚学到的层跟着旧按钮一起没了 ⇒ 「面板里的上传按钮」这一族**每一发都是死的**，
//   学费交多少次都交不完。本地音乐导入正是这一族（#sm-local-ok 画在「添加本地音乐」面板里）。
//   第二件事：#1323i 那条「不落盘＝每扇门每次回收重新交一发学费」在这些机器上根本没兑现——门台账只有
//   localStorage 一份副本，而报障这台 iPhone 的诊断单写着「LS 写探针：写入失败(QuotaExceededError)」
//   （整域 6.1MB，连 1 字节探针都抛），iOS 又每隔几分钟回收一次页面（同一张单实测 50 次）＝台账永远清零。
//
// 断言（同一把尺子在「tip＋仅本批」与「纯 tip」两侧各跑一遍；红侧读数即症状本体）：
//   A 组＝用户点名的那一格：面板画好就有层／第一发就弹／文件回到管线／不双开／「新建歌单」那一发不被吃掉
//   B 组＝面板这一族通用（夹具格走真 openTCPanel＋真 mochiFilePick＋真补装与闸）：重开面板后手指落下**之前**
//         层已在 ⇒ 第一发弹选择器；红侧＝层只在这一发的 pointerdown 出现、click 定靶回按钮＝0 次
//   C 组＝台账落得了盘：LS 每发都抛的机器上重载后仍从库里读回门记录，于是重载后第一发仍弹
//   D 组＝健康对照：内核配合时行为逐字不变（一颗、不双开），取消按钮仍只关面板
//   Z 组＝全程零未捕获异常
//
// 用法：node build.mjs && node tools/verify-1348-panel-door-before-finger.mjs
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
const BASE = 'http://127.0.0.1:' + server.address().port + '/index.html';

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n + (x !== undefined ? '  [' + x + ']' : '')); } else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };

// ===== S 组：逻辑锚（先证这三条通路本身在产物里，后面的行为断言才不是测了个寂寞） =====
console.log('[S] 逻辑锚');
const ta = read('js/ta-ask.js');
const mp = read('js/music-player.js');
const inl = read('index.html');
ok(ta.includes('if (window.mochiPickDoorSweep) { try { window.mochiPickDoorSweep(true); } catch (eS) {} }'), 'S1 openTCPanel 在换届这一刻就补装门（删＝面板按钮只等下一次 pointerdown，而那一发的 click 已定靶回按钮）');
ok(mp.includes("id: 'mochi-door-sm-local-ok', owner: 'mochi-music-local-pick',"), 'S2 本地音乐那颗面板按钮在面板画好时就铺门（用户点名的那一格不必先交一发学费）');
ok(inl.includes('try { if (window.idbSet) window.idbSet(PICK_DOOR_KEY, s); } catch (e2) {}'), 'S3 门台账第二份副本走 IDB（LS 全抛的机器上台账不再是内存孤本）');
ok(inl.includes('_pickDoorLsDead = 0; } catch (e) { _pickDoorLsDead = 1; }'), 'S4 LS 抛没抛被如实记下（恒 0＝看不出这本账其实没落盘）');
ok(inl.includes('if (!cur || (Number(n.t) || 0) > (Number(cur.t) || 0)) { d[k] = n; ch++; }'), 'S5 并回库里那份时逐条按 t 取新（恒以库为权威＝把 LS 里更新的一条打回去＝#1335 那一族在这本账上复发）');
ok(inl.includes('选图门台账：在册'), 'S6 #1323n 诊断出账那一行仍在（在册与有层拉开＝这条自愈线咬合过没有；本批改的是同一本账的落盘，不许把它删掉）');
ok(inl.includes("if (window.mochiPickDoorSweep) window.mochiPickDoorSweep();"), 'S7 #1323e 点按起手那一扫仍在（本批是提前到换届，不是把它换掉）');

const browser = await chromium.launch({ headless: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbOzwzQAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');

// 顽固内核仿真＝iPhone 那台机器的形态：label 转发被吞＋showPicker 抛错＋file input 的合成 click 无效。
// 剩下唯一能弹选择器的路＝手指物理落在真 file input 上（原生默认动作）。
const SIM = ([stubborn, lsDead, healthy]) => {
  try {
    localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
    localStorage.setItem('xy-home-v2:__guide-done', '1');
    localStorage.setItem('xy-home-v2:__onboard-done', '1');
  } catch (e) {}
  if (lsDead) {
    // 真机形态之一（本机诊断实证「LS 写探针：写入失败(QuotaExceededError)」——整域配额被吃满时
    // 连 1 字节都写不进）：这里让除引导键以外的一切 setItem 抛
    const raw = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (/__last-backup-remind|__guide-done|__onboard-done|__probe/.test(String(k))) return raw.call(this, k, v);
      throw new DOMException('quota', 'QuotaExceededError');
    };
  }
  if (!stubborn) return;
  document.addEventListener('click', (e) => {
    try { if (e.target && e.target.closest && e.target.closest('label[data-file-pick-for]')) e.preventDefault(); } catch (x) {}
  }, true);
  try { HTMLInputElement.prototype.showPicker = function () { throw new Error('NotAllowedError'); }; } catch (e) {}
  const raw = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () { try { if (this && this.tagName === 'INPUT' && this.type === 'file') return; } catch (e) {} return raw.apply(this, arguments); };
  if (healthy) { /* 对照组另开上下文，不打这三条 */ }
};

async function boot(opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, lastChooser: 0, errs: [], files: [] };
  page.on('filechooser', async (fc) => {
    st.chooser++; st.lastChooser = Date.now();
    try { await fc.setFiles({ name: 'v1348.m4a', mimeType: 'audio/mp4', buffer: Buffer.from('ftypM4A ' + 'B'.repeat(2048)) }); st.files.push('set'); } catch (e) { st.files.push('fail'); }
  });
  page.on('pageerror', (e) => st.errs.push(String(e.message).slice(0, 200)));
  await page.addInitScript(SIM, [o.stubborn !== false, !!o.lsDead, !!o.healthy]);
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2600);
  st.page = page; st.ctx = ctx;
  // 每次加载（含 reload＝iOS 回收一次页面）都要重做一遍开场清理：不重做，splash／引导遮罩会盖住
  // 整屏，elementFromPoint 量到的是遮罩、page.mouse.click 点的是空气＝整组假红。
  st.setup = () => page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s && s.parentNode) s.parentNode.removeChild(s);
    const q = document.getElementById('qa-mask'); if (q) { q.style.display = 'none'; q.hidden = true; }
    ['modal-mask', 'pc-sheet-mask', 'backup-remind-bar', 'daily-greet'].forEach((id) => { const x = document.getElementById(id); if (x) { x.hidden = true; x.style.display = 'none'; } });
    document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== 'page-music'; });
    return true;
  });
  await st.setup();
  st.quiet = async (ms) => { for (let i = 0; i < 40; i++) { if (Date.now() - st.lastChooser > (ms || 1100)) return; await page.waitForTimeout(150); } };
  st.clear = () => page.evaluate(() => {
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    document.querySelectorAll('[id$="-mask"]').forEach((m) => { if (m.id !== 'tc-mask' && !m.hidden) m.hidden = true; });
    document.body.classList.remove('scroll-lock');
  });
  st.xy = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return null;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, sel);
  // 一发点按＝清场→等安静→计数归零→点→等回执。返回这一发换来几颗选择器。
  st.tap = async (selOrPos, settle) => {
    const pos = typeof selOrPos === 'string' ? await st.xy(selOrPos) : selOrPos;
    if (!pos) return -1;
    await st.clear(); await st.quiet(settle === undefined ? 1200 : settle);
    st.chooser = 0;
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(1500); await st.quiet(1200);
    return st.chooser;
  };
  st.ring = () => page.evaluate(() => (window.__mochiPickLog || []).map((x) => x.e + '/' + x.s).join(' , '));
  st.door = (btnSel) => page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return { err: 'no-btn' };
    const L = b.querySelector(':scope > input[data-file-pick-surface]');
    const r = b.getBoundingClientRect();
    const hit = r.width ? document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)) : null;
    return { has: !!L, hit: hit ? (hit.id || hit.tagName) : 'none', veto: !!(L && L.__mochiSurface && L.__mochiSurface.veto) };
  }, btnSel);
  st.fix = () => page.evaluate(() => {
    window.openTCPanel('t1348 夹具面板', '<button class="cc-tool" id="t1348x" style="width:180px;height:44px">选一张图</button>');
    document.getElementById('t1348x').addEventListener('click', () => {
      window.mochiFilePick({ id: 't1348-host', accept: 'image/*', onFiles: () => { window.__t1348Got = 1; } });
    });
    return !!document.getElementById('t1348x');
  });
  return st;
}
const reload = async (st) => { await st.page.reload(); await st.page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 40000 }).catch(() => {}); await st.page.waitForTimeout(3200); await st.setup(); await st.page.waitForTimeout(1200); };

// ===== A 组：用户点名的那一格（本地音乐导入） =====
console.log('[A] 本地音乐导入（iPhone 16／iOS 26 实报那一格）');
{
  const st = await boot({});
  const a1 = await st.tap('#music-upload');
  ok(a1 === 0, 'A0 点「上传音乐」本身不该弹选择器（只开面板）', 'chooser=' + a1);
  const g1 = await st.door('#sm-local-ok');
  ok(g1.has === true && g1.hit === 'mochi-door-sm-local-ok', 'A1 面板一画好，手指第一下落点就是真 file input（红侧＝这一格从来只有合成腿＝用户所见「点了没反应」）', JSON.stringify(g1));
  ok(g1.veto === true, 'A1b 这扇门带闸（不带＝选「新建歌单」那一发会被文件选择器劫走）', JSON.stringify(g1));
  const a2 = await st.tap('#sm-local-ok');
  ok(a2 === 1, 'A2 顽固内核仿真下第一发点按就弹选择器（红侧＝0 颗＝与 iOS 4 张真机单里那 6 发同形）', 'chooser=' + a2);
  const ringA = await st.ring();
  ok(/surf:hit/.test(ringA) && /surf:files=1/.test(ringA), 'A3 选中的文件回到入口原有管线（原生腿回执＋files=1）', ringA.slice(-120));
  const libN = await st.page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('xy-home-v2:default:music-library') || '[]') || []).length; } catch (e) { return -1; } });
  const memN = await st.page.evaluate(() => document.querySelectorAll('#page-music .sm-song, #page-music .sm-list-row, #page-music .sm-song-ico').length);
  ok(libN >= 1 || memN >= 1, 'A4 上传真的落了库／渲染了（用户那句「没有显示成功和失败，无变化」的反面）', 'lib=' + libN + ' nodes=' + memN);
  // 「新建歌单」那一发：入口走的是 openModal 那条分支、这一发并不请求选择器 ⇒ 闸必须取消原生动作
  await st.page.evaluate(() => { document.getElementById('tc-mask').hidden = false; });
  await st.tap('#music-upload');
  const setNew = await st.page.evaluate(() => { const s = document.getElementById('sm-local-pl'); if (!s) return false; s.value = '__new__'; s.dispatchEvent(new Event('change')); return s.value === '__new__'; });
  const a5 = await st.tap('#sm-local-ok');
  const modalOpen = await st.page.evaluate(() => { const m = document.getElementById('modal-mask'); return !!m && !m.hidden; });
  ok(setNew && a5 === 0 && modalOpen, 'A5 选「新建歌单」时这一发 0 颗选择器、且新建弹窗照常打开（门没吃掉入口另一条分支＝不是恒铺层的旧病）', 'chooser=' + a5 + ' modal=' + modalOpen);
  ok(st.errs.length === 0, 'Z1 A 组全程零未捕获异常', JSON.stringify(st.errs.slice(0, 3)));
  await st.ctx.close();
}

// ===== B 组：面板这一族通用（夹具格走真模具：真 openTCPanel＋真 mochiFilePick＋真补装与闸） =====
console.log('[B] 面板里现画按钮的通用通路（夹具格＝本批未点名的那一族的等价形态）');
{
  const st = await boot({});
  // 先把「这一格要用 mochiFilePick 选图」记进台账（＝真机上第一发学费换来的那条记录）
  const seeded = await st.page.evaluate(() => {
    try { localStorage.setItem('xy-home-v2:__pick-doors', JSON.stringify({ t1348x: { owner: 't1348-host', accept: 'image/*', multiple: false, t: Date.now() } })); } catch (e) { return 'ls-fail'; }
    return 'ok';
  });
  ok(seeded === 'ok', 'B0 夹具台账写得进（健康机先排除 LS 因素）', seeded);
  await reload(st);
  const built = await st.fix();
  ok(built, 'B0b 夹具面板与入口真接上了（走的是产品同一套 openTCPanel／mochiFilePick，不是自造旁路）');
  const gb = await st.door('#t1348x');
  ok(gb.has === true && gb.hit === 'mochi-door-t1348x', 'B1 面板画好这一刻层就已躺在落点上（红侧＝层只在这一发的 pointerdown 才出现，click 按最近共同祖先定靶回按钮＝这一发仍走合成腿）', JSON.stringify(gb));
  const b2 = await st.tap('#t1348x');
  ok(b2 === 1, 'B2 于是面板重开后的第一发就弹选择器（红侧＝0 颗＝iOS 单里那 6 发的形状；这一族修的是通路而不是某一页）', 'chooser=' + b2);
  ok(st.errs.length === 0, 'Z2 B 组全程零未捕获异常', JSON.stringify(st.errs.slice(0, 3)));
  await st.ctx.close();
}

// ===== C 组：台账落得了盘（LS 每发都抛的机器） =====
console.log('[C] LS 全抛的机器（本机诊断实证「LS 写探针：写入失败(QuotaExceededError)」，且 iOS 实测回收页面 50 次）');
{
  const st = await boot({ lsDead: true });
  const built = await st.fix();
  ok(built, 'C0 夹具格接上（这一格不带人工门＝只能靠自学台账活下来，正对着报障这台机器的形态）');
  const c1 = await st.tap('#t1348x');
  ok(c1 === 0, 'C1 夹具格第一发＝交学费（顽固内核下合成腿换不来选择器；两侧皆然＝夹具真）', 'chooser=' + c1);
  await st.page.waitForTimeout(2200); // pickDoorSave 的 600ms 防抖 ＋ idbSet 落库
  const persisted = await st.page.evaluate(() => new Promise((res) => {
    try { Promise.resolve(window.idbGet('xy-home-v2:__pick-doors')).then((v) => res(v ? String(v).slice(0, 160) : '')).catch(() => res('err')); } catch (e) { res('throw'); }
  }));
  ok(/t1348x/.test(String(persisted)), 'C2 学到的门在库里有第二份（红侧＝只有 localStorage 一份、这台机器每发都抛＝账本永远落不了盘）', String(persisted).slice(0, 110));
  await reload(st);
  const census = await st.page.evaluate(() => (window.mochiPickDoorCensus ? window.mochiPickDoorCensus() : null));
  ok(!!census && census.total >= 1, 'C3 页面重载（＝iOS 回收一次）后台册仍读得回来（红侧 total=0＝自学随回收清零）', JSON.stringify(census));
  await st.fix();
  const gc = await st.door('#t1348x');
  const c4 = await st.tap('#t1348x');
  ok(gc.has === true, 'C4 回收后重开面板，手指落下之前层已在（#1348a 换届补装 × #1348b 落得了盘 两条合起来才成立的这一格）', JSON.stringify(gc));
  ok(c4 === 1, 'C5 于是回收后的第一发仍然弹（红侧＝退回「每次回收重新交一发学费」＝用户那句「点了没反应」会一直跟着他）', 'chooser=' + c4);
  const ringC = await st.ring();
  ok(/surf:hit/.test(ringC), 'C6 这一发走的仍是原生腿（与 iOS 真单里 avlib-upload surf:hit＋surf:files=1 成功那一族同形）', ringC.slice(-110));
  ok(st.errs.length === 0, 'Z3 C 组全程零未捕获异常', JSON.stringify(st.errs.slice(0, 3)));
  await st.ctx.close();
}

// ===== D 组：健康对照（内核配合时行为逐字不变） =====
console.log('[D] 健康对照（不打顽固补丁＝安卓 Chromium 的形态）');
{
  const st = await boot({ stubborn: false });
  await st.tap('#music-upload');
  const d1 = await st.tap('#sm-local-ok');
  ok(d1 === 1, 'D1 内核配合时一发只弹一颗（铺层不会与原生腿叠成双开）', 'chooser=' + d1);
  const ringD = await st.ring();
  ok(!/leg:fire/.test(ringD.split(' , ').slice(-3).join(' ')), 'D2 有层的那一发根本不该再走合成腿', ringD.slice(-120));
  const d3 = await st.tap('#music-upload');
  await st.page.evaluate(() => { document.getElementById('tc-mask').hidden = false; });
  const d4 = await st.tap('#sm-local-cancel');
  ok(d3 === 0 && d4 === 0, 'D3 取消按钮仍只关面板（层没把别的按钮吃掉）', 'd3=' + d3 + ' d4=' + d4);
  ok(st.errs.length === 0, 'Z4 D 组全程零未捕获异常', JSON.stringify(st.errs.slice(0, 3)));
  await st.ctx.close();
}

await browser.close();
server.close();
console.log('\n结果：' + pass + ' 绿 / ' + fail + ' 红');
process.exit(fail ? 1 : 0);

// verify-1311-desk-text-tick-and-cover-surface.mjs — #1311 一、桌面纯文本滴答不再强制全量走树；
//   二、朋友圈封面背景入口接进「真·可点 input 层」（含画序/开关三件事）＋合成腿留证
//
// 立项（用户 2026-09-26 直派，iPhone 17 Pro Max / iOS 26.6.1「添加到桌面」实报两件事：
//   「朋友圈壁纸无法添加」＋「听音乐时会整体卡顿」，明说其他型号/其他 iOS 也有出现、要求不要覆盖式修补）：
//   A 组现场＝同批 perfcheck：掉帧 88/119 帧集中在「手机桌面」、前台冻结 91 次、冻结前序操作
//     desk-guard ×59（距冻结起点中位 2ms＝紧邻高危）。桌面音乐组件每 500ms 写一次 mw-cur/mw-dur 的
//     textContent，而 `el.textContent = 串`＝「删旧文本节点＋插新文本节点」＝一次 childList 变异，
//     落进 #989/#1013 那条桌面结构 observer 就被当「结构变了」带 force 重扫 ⇒ #1201 的按页记忆化整层
//     被绕过，播放期间每半秒一次全量走树（#1201 实测默认小桌面一趟＝380 次 getComputedStyle＋356 次
//     getBoundingClientRect）。判据只问「这一批变异动没动结构」，不问「是哪个组件」＝零组件名白名单。
//   B 组现场＝同批诊断单【文件选择取证】只有 dev-feed-cover-bg/leg:fire ＋ fb:onscreen 两笔、一条
//     files=N 都没有＝选择器根本没回来过。本文件其余六个图片入口都铺了 #991/#1002 那层，唯独封面
//     背景这一路没有＝只剩「JS 合成激活」一条腿，而本族七波在真机上量到的是合成腿会被内核静默拒绝
//     （不抛异常＝JS 探不到失败）。故这不是机型问题，是这个入口从没接进唯一被真机验证过的那条腿。
// 断言（同一把尺子在「HEAD＋仅本批」与「纯 HEAD」两侧各跑一遍；红侧读数即症状本体）：
//   S 组＝逻辑锚（外置产物 js/desktop-slider.js·js/feed.js ＋ 内联 index.html）
//   A 组＝桌面行为：A0/A0b 夹具真（桌面页可见＋每页塞出**真竖向溢出**＋强制档确实被尺子数到——
//     inkBottom 被 `over > 0 &&` 短路，默认桌面不溢出时「零次走树」会在两侧同时假绿）／
//     A1 滴答确实以「全文本节点」的 childList 批次抵达那条 observer／
//     A2 纯文本滴答零次全量走树（红侧＝每轮都扫）／A3 真换节点照样重扫（防修过头）／
//     A4 force 跨「叠队」存活一次（红侧＝后到的非强制那次把已排队的强制降级）
//   B 组＝封面行为（顽固内核仿真：label 被吞＋showPicker 抛错＋file input 的合成 click 无效）：
//     B1 无背景时层在场且可命中／B2 画序四处各归各（中心＋右上圆环＝封面层，头像中心＝头像那层，
//     昵称中心＝昵称自己）／B3 真点按恰弹 1 次选择器（红侧＝0 次＝用户所见「点了没反应」；同时证明
//     不会双开）／B3b 原生腿回执 surf:hit 在环里／B4 选完真落库／B5 已有背景时那层让路＋面板照旧／
//     B6 恢复默认后重新武装／B7 头像与昵称两条路没被吞／B8 全部朋友圈页封面同一条路／B9 srf 取证
//   Z 组＝全程零未捕获异常
// 用法：node build.mjs && node tools/verify-1311-desk-text-tick-and-cover-surface.mjs
//       SERVE_ROOT=<产物目录> 做红绿对照（对照时务必显式传）
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
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
const baseUrl = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n + (x !== undefined ? '  [' + x + ']' : '')); } else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const jsOf = (f) => { const ext = read('js/' + f); return ext || read('index.html'); };

// ===== S 组：逻辑锚 =====
console.log('[S] 逻辑锚');
{
  const slider = jsOf('desktop-slider.js');
  ok(slider.includes('new MutationObserver((muts) => pageScrollGuard.later(400, !textOnlyChurn(muts)))'),
    'S1 桌面结构 observer 的 force 由「这批变异动没动结构」决定（退回恒 true＝A 组症状回来；恒 false＝组件增删后照抄旧裁决）');
  ok(slider.includes('if (force) forceQueued = true;'),
    'S2 强制档能跨叠队存活一次（删＝后到的非强制那次把已排队的强制降级）');
  ok(slider.includes('if (m.addedNodes[j].nodeType !== 3) return false;'),
    'S3 结构判据＝有没有非文本节点（退化成按组件名点名＝下一个每半秒重写读数的控件又来一遍）');
  ok(!slider.includes('new MutationObserver(() => pageScrollGuard.later(400, true))'),
    'S4 旧的「任何 childList 都强制重扫」不得回流（回流＝本批整块被旧缓冲打回）');
  const feed = jsOf('feed.js');
  ok(/function armCoverLayer\(el, layerId, ownerId, hasBg\)/.test(feed), 'S5 两处封面共用一个武装口（逐入口手抄正是这一族反复复发的原因）');
  ok((feed.match(/armCoverLayer\(cover, '/g) || []).length === 2 && feed.includes("'dev-feed-cover-tap'") && feed.includes("'dev-feed-all-cover-tap'"),
    'S6 主封面与全部朋友圈页封面各接一处（少一处＝那条路仍只剩合成腿）', String((feed.match(/armCoverLayer\(cover, '/g) || []).length));
  ok(feed.includes("try { layer.style.pointerEvents = hasBg ? 'none' : 'auto'; } catch (e) {}"),
    'S7 已有背景时那层让路（恒 auto＝点封面再也开不出「更换背景／恢复默认」面板）');
  ok(feed.includes('try { if (layer.parentNode === el && el.firstChild !== layer) el.insertBefore(layer, el.firstChild); } catch (e) {}'),
    'S8 层挪成第一个子节点（absolute 层压在静态流内的头像/昵称之上＝#821 同形，点头像变成换背景）');
  const idx = read('index.html');
  ok(idx.includes('.feed-cover-name { position:relative; z-index:1;'), 'S9 封面昵称抬到层之上（按 #821 桌面昵称同一口径）');
  ok(idx.includes("border:1px solid rgba(255,255,255,.15); border-radius:50%;\npointer-events:none;"), 'S10 封面右上装饰圆环不吃命中（否则那一块 120×120 又走回合成腿＝修复留盲区）');
  ok(idx.includes("'srf:' + window.mochiFilePickSurfaceAll(input).length"), 'S11 合成腿当场留证「这个入口有没有那张层」（旧诊断单两笔 leg:fire 只能让人猜）');
  ok((feed.match(/mochiFilePickSurface\(/g) || []).length === 8, 'S12 feed.js 铺层调用数＝8（#1002 的六处＋本批封面武装口内一处，另一处经共用口）', String((feed.match(/mochiFilePickSurface\(/g) || []).length));
}

// ===== 浏览器 =====
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbMzwzQAAAAAAAAAAAAAAAAAAOAvnTMAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=", 'base64');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const st = { chooser: 0, jsErrors: [], setFilesErr: '' };
page.on('filechooser', async (fc) => {
  st.chooser++;
  try { await fc.setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG }); } catch (e) { st.setFilesErr = e.message; }
});
page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 180)));
await page.addInitScript(() => {
  try {
    localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
    localStorage.setItem('xy-home-v2:__guide-done', '1');
    localStorage.setItem('xy-home-v2:__onboard-done', '1');
  } catch (e) {}
  // 走树计数器：只数护栏自己那一样（桌面页上的全子树遍历），与 verify-1201 同一把尺
  window.__c = { walk: 0 };
  const q = Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll = function (s) {
    if (s === '*' && this.classList && this.classList.contains('page-slide')) window.__c.walk++;
    return q.apply(this, arguments);
  };
  // 顽固内核仿真（同 #991/#920/#1002 口径）：label 转发被吞＋showPicker 抛错＋file input 的合成 click 无效
  document.addEventListener('click', (e) => {
    try { if (e.target && e.target.closest && e.target.closest('label[data-file-pick-for]')) e.preventDefault(); } catch (x) {}
  }, true);
  try { HTMLInputElement.prototype.showPicker = function () { throw new Error('NotAllowedError'); }; } catch (e) {}
  const raw = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () { try { if (this && this.tagName === 'INPUT' && this.type === 'file') return; } catch (e) {} return raw.apply(this, arguments); };
});
await page.goto(baseUrl + '/index.html');
await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
await page.evaluate(() => {
  const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
  // 开屏必须摘节点（base.css 的 `.splash:not(.hide) ~ .phone{visibility:hidden}` 只看兄弟关系，
  // 留着整页不可见 → 护栏按设计跳过该页 → A 组全部假绿（同 verify-1201 的教训）
  const s = document.getElementById('splash'); if (s && s.parentNode) s.parentNode.removeChild(s);
  const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  ['modal-mask', 'pc-sheet-mask', 'backup-remind-bar', 'daily-greet'].forEach((id) => { const x = document.getElementById(id); if (x) { x.hidden = true; try { x.style.display = 'none'; } catch (e2) {} } });
});
await page.waitForTimeout(4200); // 启动期那几发 force（later(900,true) 与 2600ms 的 run(true)）全部落定
const clearOverlays = () => page.evaluate(() => {
  const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
  const m = document.getElementById('modal-mask'); if (m && !m.hidden) m.hidden = true;
  ['cs-bg-panel', 'phone-bg-gallery-panel', 'icon-fit-panel'].forEach((id) => { const x = document.getElementById(id); if (x) { try { x.style.display = 'none'; } catch (e) {} } });
});
const walkNow = () => page.evaluate(() => window.__c.walk);

// ===== A 组：桌面纯文本滴答 =====
console.log('[A] 桌面结构 observer 的力档判据');
// 尺子的前提（本电池第一版在这里假绿过，教训写进注释）：全量走树这一发只发生在 inkBottom 里，
// 而它被 `over > 0 &&` 短路——**默认桌面（393×873）三页的 scrollHeight 恰等于 clientHeight，
// over=0 ⇒ 两侧谁都不扫子树 ⇒ 「纯文本滴答零次走树」这条红线在 HEAD 上也是绿的（假绿）**。
// 所以先按 verify-1201 的口径把每页塞出真溢出（整块克隆后 visibility:hidden：溢出全部来自看不见
// 的内容＝#989 的原始形状，盒仍占位、仍被逐个量），再用 A0b 证明「强制档确实被尺子数到」，
// A0b 若为 0 则本组一切读数无意义（红侧/绿侧同一条前提）。
const deskVisible = await page.evaluate(() => {
  const pp = document.getElementById('page-phone');
  const slides = Array.prototype.slice.call(document.querySelectorAll('#desktop-pages .page-slide'));
  const measurable = slides.filter((s) => s.clientHeight > 0 && getComputedStyle(s).visibility !== 'hidden').length;
  return JSON.stringify({ phoneShown: !!pp && pp.hidden === false, slides: slides.length, measurable });
});
ok(/"phoneShown":true/.test(deskVisible) && JSON.parse(deskVisible).measurable >= 1,
  'A0 前置：桌面页可见且至少一页量得出几何（整页不可见时护栏按设计跳过该页＝A2 的零扫描会退化成假绿）', deskVisible);
const seeded = await page.evaluate(() => {
  const per = [];
  [].forEach.call(document.querySelectorAll('#desktop-pages .page-slide'), (sl) => {
    const kids = sl.children; let src = null;
    for (let k = 0; k < kids.length; k++) { if (kids[k].querySelectorAll('*').length > 3) { src = kids[k]; break; } }
    if (!src) { per.push(0); return; }
    for (let g2 = 0; g2 < 40; g2++) { const c = src.cloneNode(true); c.style.pointerEvents = 'none'; c.style.visibility = 'hidden'; sl.appendChild(c); }
    per.push(sl.scrollHeight - sl.clientHeight);
  });
  return JSON.stringify(per);
});
await page.waitForTimeout(1800); // 种子＝结构变更 ⇒ 至少一轮 force 重扫落定
// A0b：视口事件走的是 force 档（resize 接线未动），量得出说明「溢出＋尺子＋力档」三件事都在
const rulerLive = await page.evaluate(async () => {
  const before = window.__c.walk;
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 900));
  return JSON.stringify({ delta: window.__c.walk - before, over: [].map.call(document.querySelectorAll('#desktop-pages .page-slide'), (s) => s.scrollHeight - s.clientHeight).join('/') });
});
ok(JSON.parse(rulerLive).delta >= 1,
  'A0b 尺子是活的：强制档一趟确实被数到（＝溢出真存在、inkBottom 真会走树；这一条为 0 时 A2 的「零次」毫无意义）', rulerLive + ' 种子后 over=' + seeded);
await page.waitForTimeout(1200); // 排空 A0b 那一轮
await clearOverlays();
const a1 = await page.evaluate(() => {
  window.__mo = { n: 0, textOnly: 0, sample: '' };
  const pages = document.getElementById('desktop-pages');
  new MutationObserver((ms) => {
    window.__mo.n++;
    let allText = ms.length > 0;
    for (const m of ms) {
      for (const x of m.addedNodes) if (x.nodeType !== 3) allText = false;
      for (const x of m.removedNodes) if (x.nodeType !== 3) allText = false;
    }
    if (allText) window.__mo.textOnly++;
  }).observe(pages, { childList: true, subtree: true });
  // 找一个「直接挂着文本子节点」的桌面元素当滴答源（同串重写＝几何必不变，只换文本节点）
  const slide = pages.querySelector('.page-slide');
  if (!slide) return { el: null };
  const els = slide.querySelectorAll('*');
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (el.firstChild && el.firstChild.nodeType === 3 && /\S/.test(el.firstChild.nodeValue || '')) {
      window.__tickHost = el;
      return { el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + (el.className || '')) };
    }
  }
  return { el: null };
});
const tick = () => page.evaluate(() => {
  const el = window.__tickHost; if (!el) return false;
  const t = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.nodeValue : (el.textContent || '');
  el.textContent = t; // 同一串：几何不变、结构不变，只是「删旧文本节点＋插新文本节点」
  return true;
});
const structural = () => page.evaluate(() => {
  const slide = document.querySelector('#desktop-pages .page-slide');
  const d = document.createElement('div');
  d.style.cssText = 'height:0;width:0;margin:0;padding:0;border:0;overflow:hidden;visibility:hidden';
  slide.appendChild(d);
  return true;
});
ok(a1.el !== null, 'A1a 夹具：桌面页里找得到「直接挂文本子节点」的元素当滴答源', String(a1.el));
await tick(); await page.waitForTimeout(150);
{
  const mo = await page.evaluate(() => window.__mo);
  ok(a1.el !== null && mo.n >= 1 && mo.textOnly >= 1,
    'A1b 夹具真：这一发确实以「整批都是文本节点」的 childList 批次抵达 observer（判据看的与 observer 看的是同一件事）',
    JSON.stringify(mo));
}
// A2：连续三轮纯文本滴答 ⇒ 零次全量走树
let a2walks = 0;
{
  await page.waitForTimeout(900); // 排空 A1 那一批
  const w0 = await walkNow();
  for (let i = 0; i < 3; i++) { await tick(); await page.waitForTimeout(700); }
  const w1 = await walkNow();
  a2walks = w1 - w0;
  ok(a2walks === 0, 'A2 核心：三轮纯文本滴答＝零次全量走树（红侧＝每轮都被强制重扫，播放期间每半秒一次）', 'walk+' + a2walks);
}
// A3：真换节点照样重扫（防修过头）
{
  await page.waitForTimeout(900);
  const w0 = await walkNow();
  await structural();
  await page.waitForTimeout(900);
  const w1 = await walkNow();
  ok((w1 - w0) >= 1, 'A3 真·结构变更仍然重扫子树（记忆化没把护栏变成空转；#989/#1013 的复核入口未废）', 'walk+' + (w1 - w0));
}
// A4：force 跨叠队存活一次
let a4walks = -1;
{
  await page.waitForTimeout(900);
  const w0 = await walkNow();
  await structural();          // 强制档入队（400ms 后跑）
  await page.waitForTimeout(150);
  await tick();                // 150ms 后来一发纯文本滴答：旧写法 clearTimeout 会把强制一起丢
  await page.waitForTimeout(900);
  const w1 = await walkNow();
  a4walks = w1 - w0;
  ok(a4walks >= 1, 'A4 核心2：叠在后面的非强制那次不得吃掉已排队的强制那次（红侧＝结构变更被降级成零扫描＝旧裁决钉死）', 'walk+' + a4walks);
}

// ===== B 组：朋友圈封面 =====
console.log('[B] 朋友圈封面背景入口（顽固内核仿真）');
const showFeed = () => page.evaluate(() => {
  // 走 App 自己的入口（.app[data-app="feed"] 的 click → openFeedPage() → render()）：手工把
  // #page-feed 摘掉 hidden 时 render() 根本没跑过，列表里一条动态也没有＝B8 的「没有前置」是夹具问题
  const app = document.querySelector('.app[data-app="feed"]');
  if (app) app.click();
  return !!app;
});
ok(await showFeed() === true, 'B0a 前置：朋友圈走的是 App 自己的入口（openFeedPage→render 跑过才有封面与动态）');
await page.waitForTimeout(900);
await clearOverlays();
const geo = (pid) => page.evaluate((coverId) => {
  const cover = document.getElementById(coverId); if (!cover) return { err: 'no-cover' };
  const av = cover.querySelector('.feed-cover-av'), nm = cover.querySelector('.feed-cover-name');
  const d = (el) => el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList && el.classList.contains('feed-cover-name') ? '[name]' : '') + (el.getAttribute && el.getAttribute('data-file-pick-surface') ? '[surface]' : '')) : 'null';
  const P = (x, y) => d(document.elementFromPoint(x, y));
  const r = cover.getBoundingClientRect();
  if (!r.width || !r.height) return { err: 'zero-rect' };
  const layerId = coverId === 'feed-cover' ? 'dev-feed-cover-tap' : 'dev-feed-all-cover-tap';
  const layer = document.getElementById(layerId);
  const ra = av ? av.getBoundingClientRect() : null, rn = nm ? nm.getBoundingClientRect() : null;
  return {
    layerId, has: !!layer,
    pe: layer ? (layer.style.pointerEvents || getComputedStyle(layer).pointerEvents) : 'no-layer',
    cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
    ax: ra ? Math.round(ra.x + ra.width / 2) : -1, ay: ra ? Math.round(ra.y + ra.height / 2) : -1,
    nx: rn ? Math.round(rn.x + rn.width / 2) : -1, ny: rn ? Math.round(rn.y + rn.height / 2) : -1,
    ringX: Math.round(r.right - 40), ringY: Math.round(r.top + 40),
    hitCenter: P(r.x + r.width / 2, r.y + r.height / 2),
    hitRing: P(r.right - 40, r.top + 40),
    hitAv: ra ? P(ra.x + ra.width / 2, ra.y + ra.height / 2) : 'no-av',
    hitName: rn ? P(rn.x + rn.width / 2, rn.y + rn.height / 2) : 'no-name',
  };
}, pid);
const tapXY = async (x, y, settle) => {
  await clearOverlays();
  st.chooser = 0;
  await page.mouse.click(x, y);
  await page.waitForTimeout(settle === undefined ? 2600 : settle);
  return st.chooser;
};
const modal = () => page.evaluate(() => {
  const m = document.getElementById('modal-mask');
  const t = document.getElementById('modal-title');
  const pills = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill')).map((b) => b.textContent);
  return { open: !!m && !m.hidden, title: t ? (t.textContent || '') : '', pills };
});
const lsLen = (key) => page.evaluate((k) => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (full === k || full.endsWith(':' + k)) return (localStorage.getItem(full) || '').length;
    }
  } catch (e) {}
  return 0;
}, key);
const pickLog = () => page.evaluate(() => (window.__mochiPickLog || []).map((x) => x.e + '/' + x.s).join(' , '));

const g0 = await geo('feed-cover');
ok(g0.err === undefined, 'B0 前置：封面页可量（' + JSON.stringify(g0) + '）');ok(g0.has === true && g0.pe === 'auto', 'B1 核心：没有背景时封面入口上就躺着那张真·可点层且可命中（红侧＝has=false，本入口只剩合成腿）', 'has=' + g0.has + ' pe=' + g0.pe);
ok(/input#dev-feed-cover-tap\[surface\]/.test(g0.hitCenter) && /input#dev-feed-cover-tap\[surface\]/.test(g0.hitRing),
  'B2a 画序：封面中心与右上装饰圆环那一块都落在那张层上（红侧＝圆环/中心命中 div#feed-cover＝又走回合成腿）', g0.hitCenter + ' / ' + g0.hitRing);
ok(/feed-myav-tap/.test(g0.hitAv), 'B2b 画序：头像中心仍命中头像自己那层（点头像≠换背景）', g0.hitAv);
ok(/\[name\]/.test(g0.hitName), 'B2c 画序：昵称中心仍命中昵称自己（点昵称≠选图片；不抬层就会被整层盖住）', g0.hitName);
const c3 = await tapXY(g0.cx, g0.cy);
ok(c3 === 1, 'B3 核心：三条腿全废的内核下点封面即弹选择器，且恰一次（红侧＝0＝「朋友圈壁纸无法添加」本体；两次＝与合成腿双开）', 'chooser=' + c3 + ' ' + st.setFilesErr);
ok(/surf:hit/.test(await pickLog()) && /surf:files=1/.test(await pickLog()),
  'B3b 原生腿自己留了回执（下一张诊断单能直接分辨「没点到/点了没弹/选完没回来」）', await pickLog());
ok((await lsLen('feed-cover-bg')) > 100, 'B4 选完真落库（不是「弹了但图被丢弃」）', 'len=' + (await lsLen('feed-cover-bg')));
const g1 = await geo('feed-cover');
ok(g1.has === true && g1.pe === 'none', 'B5a 已有背景时那层让路（恒 auto＝再也开不出「更换背景／恢复默认」面板）', 'pe=' + g1.pe);
const c5 = await tapXY(g1.cx, g1.cy, 900);
const m5 = await modal();
ok(c5 === 0 && m5.open && /已设置朋友圈背景/.test(m5.title), 'B5b 已有背景时点封面开的是面板、不是选择器（产品功能没被层吃掉）', 'chooser=' + c5 + ' ' + JSON.stringify(m5));
await page.evaluate(() => {
  const b = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill')).find((x) => /恢复默认/.test(x.textContent || ''));
  if (b) b.click();
  const o = document.getElementById('modal-ok') || Array.prototype.slice.call(document.querySelectorAll('.modal button')).find((x) => /确定|好/.test(x.textContent || ''));
  if (o) o.click();
});
await page.waitForTimeout(900);
ok((await lsLen('feed-cover-bg')) === 0, 'B6a 「恢复默认」真的清掉了背景（面板那条路没被改坏）');
const g2 = await geo('feed-cover');
ok(g2.pe === 'auto', 'B6b 清掉后那层重新武装＝下一次点封面又能直接添加', 'pe=' + g2.pe);
const c6 = await tapXY(g2.cx, g2.cy);
ok(c6 === 1, 'B6c 重新武装后点封面再弹一次选择器（红侧＝0；这一发同时证明不是「只有第一次能弹」）', 'chooser=' + c6);
await lsLen('feed-cover-bg'); // 让上一发的文件走完管线
await page.waitForTimeout(1200);
// B7 头像/昵称两条路没被吞（先清背景→重新武装的状态下量）
const g3 = await geo('feed-cover');
const c7a = await tapXY(g3.ax, g3.ay);
ok(c7a === 1, 'B7a 点头像仍弹头像的选择器（铺层没吞掉兄弟控件）', 'chooser=' + c7a);
await clearOverlays();
const g4 = await geo('feed-cover');
const c7b = await tapXY(g4.nx, g4.ny, 900);
const m7 = await modal();
ok(c7b === 0 && m7.open && /修改.*昵称/.test(m7.title), 'B7b 点昵称开的是改昵称弹窗、不是选择器（标题按 App 自己的原文「修改朋友圈昵称」量，别拿手抄的短标题当尺子）', 'chooser=' + c7b + ' ' + JSON.stringify(m7));
await page.evaluate(() => { const m = document.getElementById('modal-mask'); if (m) m.hidden = true; });
// B8 全部朋友圈页封面（同一个入口族的两处之一）——先进 App 自己的入口，列表里没动态时
// 用现成的 window.feedAddPost 补一条（新开张桌面上朋友圈本来就是空的，没有作者头像可点）
// 另外：B6c 又上传了一次背景，而这两页封面读的是同一枚键 ⇒ 先走面板「恢复默认」清干净，
// 否则 B8 量到的是「已有背景 → 那层让路」的 pe:none（那是 B5a 的断言，不是这一条的前提）。
const postSeed = await page.evaluate(() => {
  if (document.querySelector('#page-feed .feed-head-av[data-owner]')) return 'already';
  return window.feedAddPost ? String(window.feedAddPost('#1311 夹具动态')) : 'no-feedAddPost';
});
await page.waitForTimeout(700);
await clearOverlays();
{
  const gc = await geo('feed-cover');
  if (gc.pe === 'none') {
    await tapXY(gc.cx, gc.cy, 900);
    await page.evaluate(() => {
      const b = Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill')).find((x) => /恢复默认/.test(x.textContent || ''));
      if (b) b.click();
      const o = document.getElementById('modal-ok') || Array.prototype.slice.call(document.querySelectorAll('.modal button')).find((x) => /确定|好/.test(x.textContent || ''));
      if (o) o.click();
    });
    await page.waitForTimeout(900);
  }
}
await clearOverlays();
const allOk = await page.evaluate(() => {
  const av = document.querySelector('#page-feed .feed-head-av[data-owner]');
  if (!av) return { err: 'no-post' };
  const owner = av.getAttribute('data-owner'), role = av.getAttribute('data-role');
  av.click();
  return { owner, role, shown: !(document.getElementById('page-feed-all') || { hidden: true }).hidden };
});
ok(allOk.err === undefined && allOk.shown === true, 'B8a 前置：进得去「全部朋友圈」页（renderFeedAllCover 跑过才有那一层）', 'post=' + postSeed + ' ' + JSON.stringify(allOk));
await page.waitForTimeout(600);
await clearOverlays();
const g5 = await geo('feed-all-cover');
const c8 = g5.err ? -1 : await tapXY(g5.cx, g5.cy);
ok(g5.has === true && g5.pe === 'auto' && c8 === 1, 'B8 全部朋友圈页封面同一条路（同族「逐入口手抄必漏」两处一起收口才算收口）', JSON.stringify({ has: g5.has, pe: g5.pe, chooser: c8, hit: g5.hitCenter }));
// B9 合成腿取证：这一族过去只能看见 leg:fire，看不见「入口到底有没有那张层」
{
  const seen = await page.evaluate(() => {
    if (!window.mochiFilePickFire) return 'no-fire';
    var probe = document.createElement('input'); probe.type = 'file'; probe.id = 'dev-1311-probe';
    document.body.appendChild(probe);
    var raw = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () { return; }; // 只留证、不弹（合成腿在本机本来就无效）
    try { window.mochiFilePickFire(probe, {}); } catch (e) {}
    HTMLElement.prototype.click = raw;
    probe.remove();
    return (window.__mochiPickLog || []).map((x) => x.e + '/' + x.s).join(' , ');
  });
  ok(/dev-1311-probe\/srf:0/.test(seen), 'B9 取证：没有层的入口走合成腿时当场记下 srf:0（红侧＝只有 leg:fire，两种修法在诊断里长得一样）', seen);
}
ok(st.jsErrors.length === 0, 'Z1 全程零未捕获 JS 异常', JSON.stringify(st.jsErrors.slice(0, 3)));

await browser.close();
try { server.close(); } catch (e) {}
console.log('\n== verify-1311 桌面文本滴答力档判据 + 朋友圈封面真·可点层: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail === 0 ? 0 : 1);

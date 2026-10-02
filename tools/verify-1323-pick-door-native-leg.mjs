// verify-1323-pick-door-native-leg.mjs — #1323 「门＝层」：照片入口的真·可点层不再靠每个入口自己记得铺
//
// 立项（用户 2026-09-27 直派，iPhone 17 Pro Max / iOS 26.6.1 / Safari 加到桌面＝standalone PWA：
//   「大部分照片无法添加，包括朋友圈壁纸、通话壁纸；朋友圈壁纸也无法上传图片、更换图片」，并明说
//   「不同型号不同 iOS 系统可能出现不同问题，不要覆盖式修补导致不同型号设备浏览器的 bug 反复出现」）：
//   随附诊断单【文件选择取证】给了同一台设备、同一分钟里的 A/B——
//     00:03:15 / 00:03:35  mochi-call-bg-pick/leg:fire ＋ fb:onscreen（两发，一条 files=N 都没有＝选择器
//       根本没回来过；这一族十一波在真机上量到的正是「iOS 对合成激活静默拒绝、且不抛异常＝JS 探不到」）
//     00:03:25 / 00:03:28  avlib-upload/surf:hit ＋ surf:files=1（手指物理落在真 file input 上＝成功）
//   ⇒ 症状与机型无关，判据只有一条事实：**手指这一下落在的是不是一个真 file input**。而 #991/#1002/#1311
//   把「铺层」做成了**逐入口 opt-in**（统一入口 mochiFilePick 自己激活的仍是 sr-only clip 的合成腿），
//   漏一个入口＝那一格永久静默失败——这就是「修了一处、下一处在别处复发」的结构性原因（#755 注释自陈）。
//   本批把 opt-in 换成共用模具（mochiFilePickDoor）＋现场自学台账（A 档当场换门/B 档落盘补装）＋闸
//   （这一发入口自己没请求选择器＝preventDefault 取消原生弹层，不吃入口的其它分支）。
//
// 断言（同一把尺子在「HEAD＋仅本批」与「纯 HEAD」两侧各跑一遍；红侧读数即症状本体）：
//   S 组＝逻辑锚（内联 index.html ＋ 外置 js/call.js·js/gift-shop.js）＋ 邻批旧锚一字未动
//   B 组＝用户点名的那四行通话壁纸门：首帧就有真层／手指落在真 input 上／恰弹 1 次不双开／
//         原生腿回执／选完真落库／半框那行写自己的键／移除行没被层吃掉／市集商品图同一趟
//   L 组＝自学机制（夹具门＝本批未点名的那一族的等价形态）：第一发当场换门留证→第二发走原生腿→
//         文件仍走入口自己的管线→台账落盘并跨重载→闸把「这一发不该弹选择器」的点按原样交回入口→
//         同格换口径的变体门被剔除（绝不自动铺成错类型的选择器）
//   M 组＝诊断出账：选图门台账行＋DOM 节点分解行（那 20272 个节点历史上从来只是一个总数）
//   P 组＝夹具真（顽固内核仿真下无层入口第一发确实 0 次选择器）＋旧腿契约未动
//   Z 组＝全程零未捕获异常
//
// 用法：node build.mjs && node tools/verify-1323-pick-door-native-leg.mjs
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
const baseUrl = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  PASS  ' + n + (x !== undefined ? '  [' + x + ']' : '')); } else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };
const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const jsOf = (f) => { const ext = read('js/' + f); return ext || read('index.html'); };
const inline = read('index.html');

// ===== S 组：逻辑锚 =====
console.log('[S] 逻辑锚');
const dev = inline;
ok(dev.includes('window.mochiFilePickDoor = function (el, o)'), 'S1 铺层模具在位（逐入口手抄模具＝本族十一波的公因式，收到一个函数里才算收口）');
ok(dev.includes("if (!host && typeof o.onFiles !== 'function') return null;"), 'S2 没有管线就绝不铺层（改成恒铺＝弹了选择器、选完图静默丢掉＝surf:nopipe 那一族）');
ok(dev.includes("host = window.mochiFilePickBindHost(owner);"), 'S3 预建宿主时不传按钮（传了会再插一张 label 覆盖层、画序压在真层上面＝手指落在 label 上，本批这条原生路径白铺）');
ok(!dev.includes('window.mochiFilePickBindHost(owner, el)'), 'S3b 上一条的反面：带按钮的预建形态不得回流');
ok(dev.includes('if (layer.parentNode === el && el.firstChild !== layer)'), 'S4 画序：层挪成第一个子节点（否则入口内另有定位兄弟把那块点按抢回合成腿＝#1311 的圆环同形）');
ok(dev.includes("var PICK_DOOR_KEY = 'xy-home-v2:__pick-doors';"), 'S5 自学台账落盘键在位（iOS 每隔几分钟回收一次页面，不落盘＝每次回收后每扇门重新丢一发点按）');
ok(dev.includes('window.__mochiPickAskSeq = window.__mochiGestureSeq;'), 'S6 每次手势的请求戳（Fire 与统一入口两处都盖，闸据此放行原生默认动作）');
ok(dev.includes('window.mochiFilePickLearnDoor(input);'), 'S7 合成腿当场记门（srf:0 从此不再只是一句取证，它当场变成下一发的真层）');
ok(dev.includes('if (window.mochiPickDoorSweep) window.mochiPickDoorSweep();'), 'S8 点按起手按台账补装（整块重画把层带走是常态）');
ok(dev.includes('if (window.__mochiPickAskSeq === window.__mochiGestureSeq) {'), 'S9 闸的放行判据＝本次手势入口真的请求过选择器（恒放行＝状态门那一格再也开不出自己的面板；恒取消＝本批症状原样留着）');
ok(dev.includes('if (!rec || !rec.veto) return;'), 'S10 闸只收自学装上的层（既有 20 扇人工铺好的门行为逐字不变＝本批零回归的前提）');
const call = jsOf('call.js');
ok(call.includes("['call-bg-row', 'call-bg-edit-row', 'call-half-bg-row', 'call-half-bg-edit-row'].forEach("), 'S11 用户点名的四行通话壁纸门全部接进模具（少一行＝那一行照旧只剩合成腿）');
ok(call.includes("window.mochiFilePickDoor(door, { owner: 'mochi-call-bg-pick', accept: 'image/*' })"), 'S12 四行共用同一个宿主与入口管线（第二份上传实现＝走偏的两条路，#1230 同一课）');
const gs = jsOf('gift-shop.js');
ok(gs.includes('window.mochiFilePickDoor(pick, { owner: gmImgInput })'), 'S13 市集商品图按钮在绑定处幂等补装（这颗全站只有合成腿、连 label 都没有，且每次重渲重新绑一遍）');
ok(dev.includes('setTimeout(function () { window.mochiPickDoorSweep(true); }, 0)'), 'S13b 启动补装一次（静态锚那批不必等用户先丢一发点按当学费）');
ok(dev.includes("if (cur.namespaceURI && cur.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;"), 'S19 爬格时跳过 SVG/mathml 命名空间（往 svg 里塞 input＝不渲染＝白铺还留一个游离节点）');
ok(dev.includes("if (tag === 'BUTTON' || tag === 'A') return { el: cur, face: null };"), 'S20 整格覆盖只认 button/a（规范禁止其内有交互元素）【#1342 随判据改尺重锚：climb 现在交 {el,face}，容器那一型改按落点那一格铺】');
ok(dev.includes('if (face && pickDoorHostable(cur)) return { el: cur, face: face };') && dev.includes('if (!pickDoorFitLayer(layer, el, o.face)) return null;'), 'S21 容器只按「手指那一格」的盒子铺，且铺完当场复核命中（#1342 收窄：旧口径「非叶子容器一律不铺」把全站「格子＝一张图」的入口判成了没法铺——往 <img> 里塞 input 是 0×0 死层；新口径改成只盖住落点那一格＋复核不过就撤层，于是既不吃兄弟也不再留假门）');
ok(dev.includes('if (!oh || oh === window.__mochiPickAskHost) return;'), 'S13c 闸放行还得对得上宿主（同格换宿主＝弹错类型的选择器比「没反应」更难报障，两层保险都要过）');
ok(dev.includes("'door:mix'"), 'S13d 口径不一致那一发当场留证＋拆层记 bad（不猜用户要选图片还是音频）');
ok(dev.includes("'选图门台账：在册 '"), 'S14 诊断出台账行（在册/此刻有层的差＝自愈有没有在真机咬合过，不用靠猜）');
ok(dev.includes("'· 节点分解（*=这一份此刻在屏上可见"), 'S15 诊断出 DOM 节点分解（【内存体检】那个总数历史上从来只是一个数，卡顿那几批都只能对着它猜）');
// 邻批锚：本批刻意不动的三条，回流即说明被覆盖式修补打回
ok(dev.includes("'srf:' + window.mochiFilePickSurfaceAll(input).length"), 'S16 #1311i 合成腿留证 srf: 一字未动');
ok(dev.includes("btn.insertBefore(label, surf)"), 'S17 #1002 label 必须插在 surface 之前 一字未动');
ok(jsOf('feed.js').includes("armCoverLayer(cover, 'dev-feed-cover-tap', 'dev-feed-cover-bg', !!bg);"), 'S18 #1311c 朋友圈封面那扇人工门一字未动');

// ===== 起浏览器 =====
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbMzwzQAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const st = { chooser: 0, lastChooser: 0, jsErrors: [], setFilesErr: '' };
page.on('filechooser', async (fc) => {
  st.chooser++;
  st.lastChooser = Date.now();
  try { await fc.setFiles({ name: 'p1323.png', mimeType: 'image/png', buffer: PNG }); } catch (e) { st.setFilesErr = e.message; }
});
page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 180)));
await page.addInitScript(() => {
  try {
    localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now()));
    localStorage.setItem('xy-home-v2:__guide-done', '1');
    localStorage.setItem('xy-home-v2:__onboard-done', '1');
  } catch (e) {}
  // 顽固内核仿真（与 #991/#920/#1002/#1230/#1311 同一口径）：label 转发被吞＋showPicker 抛错＋
  // file input 的合成 click 无效——剩下唯一能弹选择器的路＝手指物理落在真 file input 上（原生默认动作）。
  // 这正是 iPhone 26.6 的真机形态；红侧（纯 HEAD）那四行通话壁纸门在这台机器上就是这么死的。
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
  const s = document.getElementById('splash'); if (s && s.parentNode) s.parentNode.removeChild(s);
  const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  ['modal-mask', 'pc-sheet-mask', 'backup-remind-bar', 'daily-greet'].forEach((id) => { const x = document.getElementById(id); if (x) { x.hidden = true; try { x.style.display = 'none'; } catch (e2) {} } });
});
await page.waitForTimeout(2600);

const clearOverlays = () => page.evaluate(() => {
  const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
  // 这一族面板（openTCPanel／通话半框／模态／抽屉）会在长跑中途自己冒出来盖住整屏：
  // 盖住之后 elementFromPoint 量到的是遮罩（实测随机读出 DIV.tc-opt／tc-mask）＝整组假红。
  document.querySelectorAll('[id$="-mask"]').forEach((m) => { if (!m.hidden) m.hidden = true; });
  ['chat-call-panel', 'cs-bg-panel', 'phone-bg-gallery-panel', 'icon-fit-panel', 'pc-sheet'].forEach((id) => {
    const x = document.getElementById(id); if (x) { x.hidden = true; try { x.style.display = 'none'; } catch (e) {} }
  });
  document.body.classList.remove('scroll-lock');
});
// 取证环读法（e＝入口/按钮 id，s＝这一拍走了哪条腿）
const ring = () => page.evaluate(() => (window.__mochiPickLog || []).map((x) => x.e + '/' + x.s).join(' , '));
// 每一发点按之后等「选择器安静下来」再取数：#1230 那条搬层腿在上一发里可能还挂着一次迟到的
// filechooser（Playwright 的 setFiles 是异步的），不等就把上一发的计数算到这一发头上＝假绿。
const quiet = async (ms) => {
  const need = ms || 900;
  for (let i = 0; i < 40; i++) {
    if (Date.now() - st.lastChooser > need) return;
    await page.waitForTimeout(200);
  }
};
const tapXY = async (x, y, settle) => {
  await clearOverlays();
  await quiet(settle === undefined ? 900 : settle);
  st.chooser = 0;
  await page.mouse.click(x, y);
  await page.waitForTimeout(1200);
  await quiet(900);
  return st.chooser;
};
// 把某一页单独摆上屏（通话那四行是 template.html 里的静态锚、铺层在 call.js 初始化那一刻就做完了，
// 与这一页开没开无关——所以这里只需要几何可见，不参与任何渲染判据）
const showOnly = (id) => page.evaluate((pid) => {
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== pid; });
  const t = document.getElementById(pid);
  if (t) t.hidden = false;
  return !!t;
}, id);
// 量之前先把它滚进视口：设置页是一列长行，通话那一组在折叠线以下——不滚的话 getBoundingClientRect
// 给的是视口外的坐标，elementFromPoint＝null、page.mouse.click 点空气＝整组假红（第一版就红在这）。
// fx/fy＝在门内取哪一处下指（默认正中）；角落那一处用来把「谁服务了这一发」与 #1230 搬层留下的
// 那张 120×44 覆盖层分开（搬层永远停在上一发的中心坐标上）。
const doorProbe = async (sel, fx, fy) => {
  await clearOverlays();
  return page.evaluate(({ s, a, b }) => {
  const el = document.querySelector(s);
  if (!el) return { err: 'no-el' };
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { err: 'zero-rect' };
  const layer = el.querySelector(':scope > input[data-file-pick-surface]');
  const tx = r.x + r.width * a, ty = r.y + r.height * b;
  const hit = document.elementFromPoint(tx, ty);
  return {
    has: !!layer, layerId: layer ? (layer.id || '') : '',
    accept: layer ? (layer.accept || '') : '',
    veto: layer && layer.__mochiSurface ? !!layer.__mochiSurface.veto : false,
    cx: Math.round(tx), cy: Math.round(ty),
    hitId: hit ? (hit.id || hit.tagName + '.' + String(hit.className || '').slice(0, 16)) : 'none',
  };
}, { s: sel, a: fx === undefined ? 0.5 : fx, b: fy === undefined ? 0.5 : fy });
};

// ===== P 组：夹具真／旧腿契约 =====
console.log('[P] 夹具与旧腿');
{
  const p = await page.evaluate(() => {
    const probe = document.createElement('input');
    probe.type = 'file'; probe.id = 'dev-1323-probe'; probe.accept = 'image/*';
    document.body.appendChild(probe);
    const before = (window.__mochiPickLog || []).length;
    window.mochiFilePickFire(probe, {});
    const steps = (window.__mochiPickLog || []).slice(before).map((x) => x.s).join(',');
    probe.remove();
    return { steps, api: { door: typeof window.mochiFilePickDoor, learn: typeof window.mochiFilePickLearnDoor, sweep: typeof window.mochiPickDoorSweep } };
  });
  ok(/leg:fire/.test(p.steps) && /srf:0/.test(p.steps), 'P1 没有层的入口走合成腿时仍留 leg:fire＋srf:0（#1311i 契约未动）', p.steps);
  // 顽固仿真是否真的生效＝合成腿一颗选择器都换不来（这条一绿就说明下面所有「chooser=1」都只能来自
  // 物理落点，不是测试自己走的旁路；这条一红说明夹具在骗人）
  await page.evaluate(() => {
    const probe = document.createElement('input');
    probe.type = 'file'; probe.id = 'dev-1323-probe2'; probe.accept = 'image/*';
    document.body.appendChild(probe);
    window.mochiFilePickFire(probe, {});
    probe.remove();
  });
  await page.waitForTimeout(1200);
  await quiet(900);
  ok(st.chooser === 0, 'P2 仿真生效：合成腿（showPicker 抛错＋file input 的 click 无效＋label 被吞）0 次选择器＝红侧那四行通话壁纸就是这个形状', 'chooser=' + st.chooser);
  ok(await page.evaluate(() => typeof window.mochiFilePickSurface === 'function' && typeof window.mochiFilePick === 'function'), 'P3 既有三腿模具本身在位（本批是加一条原生路，不是换掉旧的）');
  const api = await page.evaluate(() => ({ door: typeof window.mochiFilePickDoor, learn: typeof window.mochiFilePickLearnDoor, sweep: typeof window.mochiPickDoorSweep, census: typeof window.mochiPickDoorCensus }));
  ok(api.door === 'function' && api.learn === 'function' && api.sweep === 'function' && api.census === 'function', 'P4 模具/记门/补装/出账四件套都在产物里挂着（挂在别处＝下一位照旧找不到）', JSON.stringify(api));
}

// ===== B 组：用户点名的四行通话壁纸 =====
console.log('[B] 通话壁纸四行（诊断单里 leg:fire＋fb:onscreen、一条 files=N 都没有的那两发）');
let callOk = false;
{
  callOk = await showOnly('page-call-settings');
  await page.waitForTimeout(300);
  if (!callOk) console.log('  SKIP  B 组：找不到 #page-call-settings（环境不满足，不算回归）');
  const row = await doorProbe('#call-bg-row');
  ok(row.err === undefined, 'B0 前提：通话背景那一行真的在屏上且有几何', JSON.stringify(row).slice(0, 90));
  callOk = callOk && row.err === undefined;
  if (callOk) {
    ok(row.has && row.layerId === 'mochi-door-call-bg-row', 'B1 首帧就铺着真·可点层（红侧＝这一格压根没有层＝只剩合成腿＝用户所见「点了没反应」）', row.layerId || 'no-layer');
    ok(row.hitId === 'mochi-door-call-bg-row', 'B2 手指这一发落在的位置＝真 file input 本身（同设备同分钟的 A/B：头像库那扇 surf:hit＋surf:files=1 成功、这两发只有 leg:fire）', row.hitId);
    ok(row.accept === 'image/*', 'B3 层的 accept 与入口一致（iOS 按 accept 过滤，漏了＝相册不在候选＝#753 判据）', row.accept);
    ok(row.veto === false, 'B4 人工铺的门不带闸（既有门行为逐字不变＝本批零回归）');
    const c1 = await tapXY(row.cx, row.cy, 2800);
    const r1 = await ring();
    ok(c1 === 1, 'B5 真点一下＝恰弹 1 次选择器（红侧＝0 次＝症状本体；若是 2 次＝双开＝把合成腿也走了）', 'chooser=' + c1);
    ok(/call-bg-row\/surf:hit/.test(r1) && !/fb:files=/.test(r1), 'B6 原生腿回执 surf:hit 在环里、且这一发不是借 #1230 搬层那格换到的选择器充数（合成 click 不派发 pointerdown＝surf:hit 只能来自物理落点）', r1.slice(-90));
    const store = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/:call-bg$/.test(k)) out[k] = (localStorage.getItem(k) || '').slice(0, 22); }
      return out;
    });
    ok(Object.keys(store).length >= 1 && Object.values(store).some((v) => v.indexOf('data:') === 0), 'B7 选完的图真进了入口原有管线（写进 call-bg 键＝不是只弹了个窗）', JSON.stringify(store).slice(0, 80));
    const val = await page.evaluate(() => { const v = document.getElementById('call-bg-val'); return v ? v.textContent : ''; });
    ok(/已设置/.test(val || ''), 'B8 行内回显跟着变「已设置」（同一份事实的第二个读数）', val);
    // 半框那行：四行共用一个宿主 input，各自写各自的键
    const half = await doorProbe('#call-half-bg-row');
    ok(half.has && half.hitId === 'mochi-door-call-half-bg-row', 'B9 通话半框那一行同样首帧就有真层（少铺一行＝那一行照旧死在合成腿上）', half.hitId || JSON.stringify(half).slice(0, 60));
    if (half.has) {
      const c2 = await tapXY(half.cx, half.cy, 2800);
      const keys = await page.evaluate(() => {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/:call-half-bg$/.test(k)) out.push(k); }
        return out;
      });
      ok(c2 === 1 && keys.length >= 1, 'B10 半框那行点一次弹一次、且写的是自己的键（四行共用宿主而闭包不串＝pickCallBg 那一条管线没被分成两份）', 'chooser=' + c2 + ' keys=' + JSON.stringify(keys));
    }
    // 兄弟行没被整层吃掉：移除行是**另一行**（同级），点它不该弹选择器
    const rm = await doorProbe('#call-bg-remove');
    if (rm.err === undefined) {
      const c3 = await tapXY(rm.cx, rm.cy, 1600);
      const after = await page.evaluate(() => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/:call-bg$/.test(k)) out[k] = localStorage.getItem(k) || ''; }
        return out;
      });
      ok(c3 === 0 && Object.values(after).every((v) => !v || v.length === 0), 'B11 「移除通话背景」那一行照旧是自己的动作（0 次选择器＋键被清空＝铺层没把兄弟吃掉）', 'chooser=' + c3);
    } else console.log('  SKIP  B11：移除行当下不可见（刚设过背景才出现），不计');
    // 上传/移除之后再点一次＝同一格第二次仍走原生腿（重画没把层带走）
    const re = await doorProbe('#call-bg-row');
    ok(re.has, 'B12 走完一趟上传后这层还在（层随门一起被重画掉＝又回到只剩合成腿）');
  }
}

// ===== L 组：自学机制（本批未点名那一族的等价形态） =====
console.log('[L] 自学台账：第一发换门 → 第二发原生腿 → 闸 → 落盘 → 变体剔除');
{
  await page.evaluate(() => {
    window.__t1323 = { files: 0, alt: 0, wantPick: true, host: 't1323-pick' };
    const d = document.createElement('div');
    d.id = 't1323-door';
    d.textContent = 'T1323DOOR';
    d.style.cssText = 'position:fixed;left:30px;top:150px;width:220px;height:64px;background:#e8e8ee;z-index:99999';
    d.addEventListener('click', () => {
      if (!window.__t1323.wantPick) { window.__t1323.alt++; return; }
      window.mochiFilePick({ id: window.__t1323.host, accept: 'image/*', onFiles: (fs) => { window.__t1323.files += (fs || []).length; } });
    });
    document.body.appendChild(d);
    try { localStorage.removeItem('xy-home-v2:__pick-doors'); } catch (e) {}
    if (window.mochiPickDoorSweep) window.mochiPickDoorSweep(true);
    return true;
  });
  const q0 = await doorProbe('#t1323-door');
  ok(q0.err === undefined && q0.has === false, 'L0 前提：这扇夹具门本来就没有层（与那四行修前的形态同形；若这里已有层＝夹具假）', JSON.stringify(q0).slice(0, 70));
  const c1 = await tapXY(q0.cx, q0.cy);
  const r1 = await ring();
  ok(c1 === 0 && /leg:fire/.test(r1), 'L1 夹具门第一发＝合成腿、顽固内核下 0 次选择器＝用户所见那句「点了没反应」（两侧皆然＝夹具真）', 'chooser=' + c1);
  ok(/door:learn/.test(r1) && !/door:now/.test(r1), 'L2 第一发当场把这格换成真层＋落账，并且**只留一笔**取证（A 档与 B 档各记一笔会把 #1014 那口全站共享的 6 格环挤爆——实测顶掉过 verify-1230 的 leg:fire＝邻居假红）', r1.slice(-100));
  const q1 = await doorProbe('#t1323-door');
  ok(q1.has && /mochi-door-x-/.test(q1.layerId), 'L3 夹具门上此刻铺着真层（红侧＝永远不铺）', q1.layerId || 'no-layer');
  ok(q1.veto === true, 'L4 自学装上的层带闸（人工铺的不带＝两套语义分开，别把 #1311 那些门一并改掉）');
  // 第二发刻意落在门的**左沿**：上一发 #1230 那条搬层留下的覆盖层永远停在中心坐标上，从中心点按
  // 就分不清「是我的层服务了这一发」还是「搬层那格恰好接住了」（＝假绿，第一版在这里绿得没道理）。
  const q2 = await doorProbe('#t1323-door', 0.06, 0.5);
  const c2 = await tapXY(q2.cx, q2.cy);
  const r2 = await ring();
  ok(c2 === 1, 'L5 同一格的第二发＝恰 1 次选择器（红侧＝第二发仍旧 0 次＝用户只能刷新）', 'chooser=' + c2);
  ok(/surf:hit/.test(r2) && /surf:files=1/.test(r2) && !/fb:files=/.test(r2), 'L6 第二发由这一层自己服务（surf:hit＋surf:files=1，且没有 fb: 搬层计数＝不是借上一发残留的覆盖层充数）', r2.slice(-110));
  const got = await page.evaluate(() => window.__t1323.files);
  ok(got >= 1, 'L7 选完的文件仍交回**入口自己的管线**（onFiles 计数；铺层若把管线接错＝弹了窗图片却丢了＝surf:nopipe 那一族）', 'files=' + got);
  // 闸：这一发入口不请求选择器（同格在不同状态下开面板那一族＝#1311 hasBg 的通用形态）
  await page.evaluate(() => { window.__t1323.alt = 0; window.__t1323.wantPick = false; });
  const c3 = await tapXY(q2.cx, q2.cy);
  const r3 = await ring();
  const alt = await page.evaluate(() => window.__t1323.alt);
  ok(c3 === 0, 'L8 这一发入口没请求选择器＝原生弹层被取消（恒放行＝这一格再也开不出自己的面板＝吃掉产品功能）', 'chooser=' + c3);
  ok(alt === 1, 'L9 入口自己的分支照跑（两侧皆绿＝自愈没有反过来吃掉这一格）', 'alt=' + alt);
  ok(/door:veto/.test(r3), 'L10 取消这一发有留证 door:veto（红侧＝没有闸这个概念）', r3.slice(-100));
  await page.evaluate(() => { window.__t1323.wantPick = true; });
  const led = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('xy-home-v2:__pick-doors') || '{}'); } catch (e) { return {}; }
  });
  ok(led['t1323-door'] && led['t1323-door'].owner === 't1323-pick' && led['t1323-door'].accept === 'image/*', 'L11 台账落盘（页面被系统回收后下一场还在；本机诊断实测回收 148 次）', JSON.stringify(led['t1323-door'] || {}));
  const cen = await page.evaluate(() => (window.mochiPickDoorCensus ? window.mochiPickDoorCensus() : null));
  ok(cen && cen.total >= 1 && cen.armed >= 1, 'L12 台账出账可对『此刻真铺着几扇』计数（在册与有层拉开＝这一页刚被重画过，下一发当场补装）', JSON.stringify(cen));
  // 变体：同一格把请求发给另一个宿主＝自动铺层猜不出该弹哪一类，必须拆掉而不是猜（错类型比没反应更难报障）
  await page.evaluate(() => { window.__t1323.host = 't1323-pick-b'; });
  const c4 = await tapXY(q2.cx, q2.cy);
  const r4 = await ring();
  const led2 = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('xy-home-v2:__pick-doors') || '{}'); } catch (e) { return {}; }
  });
  const q3 = await doorProbe('#t1323-door', 0.06, 0.5);
  ok(/door:mix/.test(r4) && led2['t1323-door'] && led2['t1323-door'].bad === 1, 'L15 同格换宿主＝这扇门被剔除并留证 door:mix（绝不替用户猜要选图片还是音频；宁可退回本批之前的路径）', r4.slice(-90));
  ok(q3.has === false && c4 === 0, 'L16 剔除时那层当场拆掉、且这一发没有弹出任何错类型的选择器', 'has=' + q3.has + ' chooser=' + c4);
  const cen2 = await page.evaluate(() => (window.mochiPickDoorCensus ? window.mochiPickDoorCensus() : null));
  ok(cen2 && cen2.bad >= 1, 'L17 剔除数在诊断台账里可见（看不见＝下次又要靠猜）', JSON.stringify(cen2));
  // 护栏：自动铺层只准铺「点了不会吃掉别人」的那一格。容器（里面另有自己的按钮）与 SVG 内部都不准。
  await page.evaluate(() => {
    window.__t1323box = { pick: 0, inner: 0 };
    const box = document.createElement('div');
    box.id = 't1323-box';
    box.style.cssText = 'position:fixed;left:30px;top:250px;width:260px;height:120px;background:#ddd;z-index:99999';
    box.innerHTML = '<span id="t1323-inner" style="display:inline-block;width:80px;height:30px;background:#888">内层按钮</span><div id="t1323-empty" style="height:40px">空白处</div>';
    box.addEventListener('click', () => { window.__t1323box.pick++; window.mochiFilePick({ id: 't1323-box-pick', accept: 'image/*', onFiles: () => {} }); });
    document.body.appendChild(box);
    document.getElementById('t1323-inner').addEventListener('click', (e) => { e.stopPropagation(); window.__t1323box.inner++; });
    const wrap = document.createElement('button');
    wrap.id = 't1323-icon';
    wrap.style.cssText = 'position:fixed;left:30px;top:400px;width:56px;height:56px;z-index:99999';
    wrap.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path id="t1323-path" d="M4 4h16v16H4z"/></svg>';
    wrap.addEventListener('click', () => { window.mochiFilePick({ id: 't1323-icon-pick', accept: 'image/*', onFiles: () => {} }); });
    document.body.appendChild(wrap);
    return true;
  });
  const boxQ = await doorProbe('#t1323-empty', 0.5, 0.5);
  const boxTap = await tapXY(boxQ.cx, boxQ.cy);
  const boxState = await page.evaluate(() => ({
    onBox: !!document.querySelector('#t1323-box > input[data-file-pick-surface]'),
    onEmpty: !!document.querySelector('#t1323-empty > input[data-file-pick-surface]'),
    pick: window.__t1323box.pick, inner: 0,
  }));
  const innerQ = await doorProbe('#t1323-inner', 0.5, 0.5);
  const innerTap = await tapXY(innerQ.cx, innerQ.cy);
  boxState.inner = await page.evaluate(() => window.__t1323box.inner);
  ok(boxState.onBox === false, 'L18 容器那一格不被自动铺层（点在容器空白处走了合成腿，也不把 100%×100% 的透明 input 浮到里面的按钮之上＝修一处不吃另一处）', JSON.stringify(boxState));
  ok(boxState.inner === 1 && innerTap === 0, 'L19 里面那颗自己的按钮照旧归它自己（点它＝计数 1、且不弹选择器；被层吃掉的话这里会是 0）', JSON.stringify(boxState) + ' chooser=' + innerTap);
  ok(boxState.onEmpty === true, 'L19b 但被点到的那一格（叶子「空白处」）当场换成了真层（护栏不是「一律不铺」，是「只铺盖不到别人的那一格」）');
  const iconQ = await doorProbe('#t1323-path', 0.5, 0.5);
  const iconTap = await tapXY(iconQ.cx, iconQ.cy);
  const iconState = await page.evaluate(() => ({
    inSvg: !!document.querySelector('#t1323-icon svg input, #t1323-path > input'),
    onButton: !!document.querySelector('#t1323-icon > input[data-file-pick-surface]'),
  }));
  ok(iconState.inSvg === false && iconState.onButton === true, 'L20 图标按钮：不往 SVG 里塞 input（塞了不渲染＝白铺还留游离节点），爬到外面那颗 `<button>` 上铺（规范禁止 button 内有交互元素＝整格覆盖安全）', JSON.stringify(iconState));
  await page.evaluate(() => { ['t1323-door', 't1323-box', 't1323-icon'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }); });
}

// ===== R 组：重载之后（iOS 每几分钟回收一次页面＝落盘的价值正在这） =====
console.log('[R] 台账跨重载');
{
  await page.reload();
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const led3 = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('xy-home-v2:__pick-doors') || '{}'); } catch (e) { return {}; }
  });
  ok(led3['t1323-door'] && led3['t1323-door'].bad === 1, 'R1 重载后台账还在（内存里那份随回收清零＝#1272 同一课）', JSON.stringify(led3['t1323-door'] || {}));
  await page.evaluate(() => {
    window.__t1323 = { files: 0, alt: 0, wantPick: true, host: 't1323-pick' };
    const d = document.createElement('div');
    d.id = 't1323-door';
    d.textContent = 'T1323DOOR';
    d.style.cssText = 'position:fixed;left:30px;top:150px;width:220px;height:64px;background:#e8e8ee;z-index:99999';
    d.addEventListener('click', () => { window.mochiFilePick({ id: window.__t1323.host, accept: 'image/*', onFiles: (fs) => { window.__t1323.files += (fs || []).length; } }); });
    document.body.appendChild(d);
    // 红侧（纯 HEAD）没有这套 API：一律按「不存在」取值继续跑，绝不因为脚本一崩而让后面整组没有读数
    return typeof window.mochiPickDoorSweep === 'function' ? window.mochiPickDoorSweep(true) : 0;
  });
  const badQ = await doorProbe('#t1323-door', 0.06, 0.5);
  ok(badQ.has === false, 'R2 被剔除的门不会被补装回来（bad 是永久裁决；恒补＝下一场又回到猜错类型那一发）');
  const armed = await page.evaluate(() => {
    const d = {};
    d['t1323-door'] = { owner: 't1323-pick', accept: 'image/*', multiple: false, t: Date.now() };
    d['call-half-open'] = { owner: 't1323-pick', accept: 'image/*', multiple: false, t: Date.now() };
    localStorage.setItem('xy-home-v2:__pick-doors', JSON.stringify(d));
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);
  // R3 验的是真生命周期：静态锚（template.html 里那些行）在 deferred 脚本跑完就已存在，启动那一次
  // 扫装就该把它们补回来——**一发点按都不用先丢**。这条与 A 档「当场换」的分工就是：落盘那批不交学费，
  // 当场那批要等这一发走完。
  const bootArm = await page.evaluate(() => {
    const el = document.getElementById('call-half-open');
    const layer = el ? el.querySelector(':scope > input[data-file-pick-surface]') : null;
    return { elExists: !!el, armed: !!layer, host: !!document.getElementById('t1323-pick'), census: window.mochiPickDoorCensus ? window.mochiPickDoorCensus() : null };
  });
  ok(bootArm.elExists && bootArm.armed, 'R3 启动补装：台账里那扇静态锚在任何点按之前就已经是真层（落盘的价值＝下一场不必重新交学费）', JSON.stringify(bootArm.census));
  ok(bootArm.host, 'R3b 补装时按 #1230 同一口径把宿主预建好（不预建＝选完图没管线可交＝surf:nopipe 那一族）');
  // R4 这一发教的是本批的**边界**：重画出来的门（夹具在重载后才建）靠起手那一次扫装补回，但起手补装
  // 来不及改变已经按下的一发（click 目标取按下/抬起两点的共同祖先＝门，不是新插入的层）＝这一发仍
  // 走合成腿；同一格的下一发才是原生腿。写成「第一发就该成」是给不存在的魔法断言。
  await page.evaluate(() => {
    window.__t1323 = { files: 0, alt: 0, wantPick: true, host: 't1323-pick' };
    const d = document.createElement('div');
    d.id = 't1323-door';
    d.textContent = 'T1323DOOR';
    d.style.cssText = 'position:fixed;left:30px;top:150px;width:220px;height:64px;background:#e8e8ee;z-index:99999';
    d.addEventListener('click', () => { window.mochiFilePick({ id: window.__t1323.host, accept: 'image/*', onFiles: (fs) => { window.__t1323.files += (fs || []).length; } }); });
    document.body.appendChild(d);
    return true;
  });
  const rq = await doorProbe('#t1323-door', 0.5, 0.5);
  const rc1 = await tapXY(rq.cx, rq.cy);
  const rq2 = await doorProbe('#t1323-door', 0.5, 0.5);
  const rc2 = await tapXY(rq2.cx, rq2.cy);
  const rr = await ring();
  ok(rq2.has && rq2.hitId === rq2.layerId, 'R4 起手扫装把这扇刚被重画出来的门补回了真层（下一指的落点＝真 input）', 'hit=' + rq2.hitId);
  ok(rc2 === 1 && /surf:files=1/.test(rr), 'R4b 补装之后同一格的下一发走原生腿（红侧＝永远补不回来，每一发都只有 leg:fire）', 'chooser 第一发=' + rc1 + ' 第二发=' + rc2);
  await page.evaluate(() => { const e = document.getElementById('t1323-door'); if (e) e.remove(); });
}

// ===== 邻批人工门零回归 =====
console.log('[N] 既有人工铺好的门没被本批改道');
{
  const av = await page.evaluate(() => {
    const btn = document.getElementById('avlib-upload');
    if (!btn) return { err: 'no-btn' };
    const kids = [].slice.call(btn.children).filter((c) => c.getAttribute('data-file-pick-surface') === '1');
    return { err: undefined, n: kids.length, veto: kids.map((k) => !!((k.__mochiSurface || {}).veto)) };
  });
  ok(av.err === 'no-btn' || (av.n === 1 && av.veto.every((x) => x === false)), 'N1 #1002 头像库那扇门还是恰好一层、且不带闸（红侧同读数＝本批没去动人工门）', JSON.stringify(av));
  const lab = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[data-file-pick-surface]').forEach((s) => {
      const p = s.parentElement;
      if (!p) return;
      const l = p.querySelector('label[data-file-pick-for]');
      if (l && !(p.compareDocumentPosition(l) & 0x04)) out.push(p.id || '?'); // label 在层之后＝画序压住真层
    });
    return out;
  });
  ok(lab.length === 0, 'N2 没有任何一扇门上的 label 压在真层上面（#1002 那条画序契约全站成立）', JSON.stringify(lab).slice(0, 90));
}

// ===== M 组：诊断出账 =====
console.log('[M] 诊断报告');
{
  await showOnly('page-setting');
  await page.waitForTimeout(200);
  const got = await page.evaluate(() => {
    const row = document.getElementById('row-diagnostics');
    if (row) row.click();
    return !!row;
  });
  let text = '';
  for (let i = 0; i < 40; i++) {
    text = await page.evaluate(() => { const ta = document.getElementById('modal-textarea'); return ta ? (ta.value || '') : ''; });
    if (text.length > 1200) break;
    await page.waitForTimeout(500);
  }
  ok(got && text.length > 1200, 'M0 诊断报告真的生成（这一段要在报告里出账，不然下一轮还是靠猜）', 'len=' + text.length);
  ok(/选图门台账：在册 \d+ 扇 · 此刻真铺着层 \d+ 扇/.test(text), 'M1 台账行出账', (text.match(/选图门台账：[^\n]*/) || [''])[0].slice(0, 70));
  ok(/节点分解/.test(text), 'M2 节点分解行出账（20272 那一类总数第一次能被拆开问「谁占的」）', (text.match(/· 节点分解[^\n]*/) || [''])[0].slice(0, 150));
  ok(/文件选择取证/.test(text), 'M3 旧的取证环仍在位（本批两行新读尺与它同场出账；door: 那几笔活在 6 格环里会被后续点按滚掉＝不断言此刻还在）', (text.match(/文件选择取证[^\n]*/) || [''])[0].slice(0, 120));
}

// ===== G 组：合作内核（安卓／桌面那一路）＝本批不能把它们弄坏 =====
console.log('[G] 合作内核不双开（用户原话：这个问题其他设备型号也有出现＝收口必须两头都不坏）');
{
  // 第二个上下文＝**不打**顽固补丁：showPicker/click/label 全都照常工作，正是安卓 Chrome 的形态。
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p2 = await ctx2.newPage();
  let c2 = 0;
  p2.on('filechooser', async (fc) => { c2++; try { await fc.setFiles({ name: 'g1323.png', mimeType: 'image/png', buffer: PNG }); } catch (e) {} });
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(String(e.message).slice(0, 160)));
  await p2.goto(baseUrl + '/index.html');
  await p2.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
  await p2.evaluate(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s && s.parentNode) s.parentNode.removeChild(s);
    document.querySelectorAll('[id$="-mask"]').forEach((m) => { m.hidden = true; });
    document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== 'page-call-settings'; });
  });
  await p2.waitForTimeout(2200);
  const gClear = () => p2.evaluate(() => {
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    document.querySelectorAll('[id$="-mask"]').forEach((m) => { if (!m.hidden) m.hidden = true; });
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
    document.body.classList.remove('scroll-lock');
  });
  const gState = () => p2.evaluate(() => {
    const el = document.getElementById('call-bg-row');
    if (!el) return { err: 'no-el' };
    el.scrollIntoView({ block: 'center' });
    const q = el.getBoundingClientRect();
    const layer = el.querySelector(':scope > input[data-file-pick-surface]');
    const hit = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
    return { cx: Math.round(q.x + q.width / 2), cy: Math.round(q.y + q.height / 2), has: !!layer, hit: hit ? (hit.id || hit.tagName) : 'none' };
  });
  const gProbe = async () => { await gClear(); return gState(); };
  const gTap = async (x, y) => {
    await gClear();
    const hit = await p2.evaluate((p) => { const h = document.elementFromPoint(p.x, p.y); return h ? (h.id || h.tagName) : 'none'; }, { x, y });
    c2 = 0;
    await p2.mouse.click(x, y);
    await p2.waitForTimeout(2200);
    return { c: c2, hit };
  };
  const gp = await gProbe();
  ok(gp.err === undefined && gp.has && gp.hit === 'mochi-door-call-bg-row', 'G0 前提：合作内核这一侧那一行同样首帧就有真层', JSON.stringify(gp).slice(0, 90));
  // 两发之间不摘遮罩就会把「遮罩盖住了这一行」读成「点了没反应」（第一版就红在这里：读出 hit＝modal-static）。
  // 所以每一发都先摘浮层、并把**落点读数**当成前提一起断言——前提不成立时绝不算进修复的红。
  const g1 = gp.err === undefined ? await gTap(gp.cx, gp.cy) : { c: -1, hit: 'skipped' };
  const g2 = g1.hit === 'skipped' ? { c: -1, hit: 'skipped' } : await gTap(gp.cx, gp.cy);
  ok(/^mochi-door-call-bg-row$|^call-bg-row$/.test(g1.hit) && /^mochi-door-call-bg-row$|^call-bg-row$/.test(g2.hit), 'H1 前提：两发的落点都真的在这一行上（没有被别的浮层接走）', g1.hit + ' / ' + g2.hit);
  ok(g1.c === 1, 'G1 合作内核＋真层＝第一发恰弹 1 次（原生默认动作负责；合成腿那条路被 #991/#1002 的 surfaceTap 让路闸掐掉）', 'chooser=' + g1.c);
  ok(g2.c === 1, 'G2 连续两发各 1 次、不双开也不失灵（双开＝原生与合成各弹一遍，安卓用户会看到两次相册；这条两侧皆绿＝安全性判据，不是本批新契约）', 'chooser=' + g2.c);
  ok(errs2.length === 0, 'G3 合作内核全程零未捕获异常', JSON.stringify(errs2.slice(0, 2)));
  await ctx2.close();
}

ok(st.jsErrors.length === 0, 'Z1 全程零未捕获 JS 异常', JSON.stringify(st.jsErrors.slice(0, 3)));

await browser.close();
try { server.close(); } catch (e) {}
console.log('\n== verify-1323 照片门走原生腿: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail === 0 ? 0 : 1);

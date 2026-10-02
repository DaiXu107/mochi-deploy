// verify-1343-img-cell-door-anchor.mjs — #1343 「格子＝一张图」那批图片入口的门：判据改尺＋当场复核＋结构锚
//
// 立项（用户 2026-09-27 直派，iPhone 15 / iOS 17.6.1：「朋友圈背景，表情包，大部分需要添加图片的功能都已
//   卡死失效，无法添加」，并明说「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现，这个问题其他设备型号
//   也有出现」）：#1323 把「真·可点层」收进共用模具＋自学台账，方向对，但它的门判据是
//   `if (!cur.children || cur.children.length === 0) return cur;`——把「这一格没有元素子节点」当成
//   「这一格装得下一个子节点」。这两件事在**替换元素**上不成立：<img>／<canvas>／<input>／<video> 的子节点
//   按 HTML 规范不参与渲染。于是往 <img> 里 appendChild 一张 file input：节点确实在 DOM 里、
//   getBoundingClientRect 是 0×0、elementFromPoint 永远命不中它＝**死层**。而全站「格子＝一张图」的入口
//   （朋友圈封面/背景、好友头像、表情包、壁纸预览、商品图）恰好全是这个形状——无头复现（本尺 A1/A2 量的是
//   同一形态在红侧的读数）：真鼠标落在那一格 → 铺出的层 parent=IMG／w=0／h=0，第二发照旧走合成腿
//   ＝iOS 对合成激活静默拒绝那一族症状原样留着，而【诊断】的「此刻真铺着层 M」把它算成已修＝谎报。
//   同族还有第二件：#1323 的 B 档要求那一格有 id 才落盘，而 JS 现渲的图片格子基本没 id，iOS 每隔几分钟
//   回收一次页面（本机诊断实证「被系统回收过 100 次」）＝每场都要重交一发学费＝用户口径的「每次进来都点不动」。
//
// 本批改的是判据本身（零机型／零 UA 分支，一行页面代码都不动）：
//   ① 装不出子节点的叶子不当门 → 记下那一格的盒子继续往上爬；
//   ② 爬到容器时**只按手指那一格的盒子**铺（同格里别的子元素仍命中自己＝#1323 ④ 那条勿踩担心的事不发生）；
//   ③ 铺完当场 elementFromPoint 复核，命不中＝撤层返回 null（宁可退回合成腿，也不留第二类假门）；
//   ④ 无 id 的门按结构锚（最近带 id 祖先＋一路子序号）落盘，扫装时解析回去，解析不中＝什么都不铺；
//   ⑤ 台账把「命得中」与「命不中」分开数，死层不再算已修。
//
// 断言（同一把尺在「tip＋仅本批」与「纯 tip」两侧各跑一遍；红侧读数即症状本体）：
//   S 组＝逻辑锚（内联 index.html，含 #1323/#1311/#1002 邻批旧锚一字未动）
//   A 组＝症状本体：img 格子里铺出来的层有没有盒子、命不命中得到（红侧＝parent=IMG／0×0）
//   B 组＝修好之后：第一发即换门→第二发物理落在真 input（surf:hit·无 fb 借道·恰弹 1 次不双开）→
//         setFiles 真进入口管线→同格兄弟元素没被吃掉（它自己的 handler 跑、不弹选择器）
//   C 组＝复核不过＝撤层＋计数（绝不留第二类假门）；人工门（不带 veto）行为逐字不变
//   D 组＝死层不再算「已修」：手植一张 0×0 层进台账，census 报 dead 不报 armed
//   L 组＝结构锚：无 id 格子第一发落盘（fp: 键）→ 重载后启动补装当场就有命得中的层（不再交第二次学费）
//         → 锚解析不中时不铺（绝不在猜错的格子上铺门）→ #1323 的 variant/bad 永久剔除语义未动
//   P 组＝旧口径健康对照：有 id 的叶子格仍铺在自己身上（face=null）；夹具真（无层入口第一发确实 0 次选择器）
//   Z 组＝全程零未捕获异常
//
// 用法：node build.mjs && node tools/verify-1343-img-cell-door-anchor.mjs
//       红绿对照＝ SERVE_ROOT=<纯 tip 副本根> node tools/verify-1343-img-cell-door-anchor.mjs
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
const inline = read('index.html');
const dev = inline;

// ===== S 组：逻辑锚（本批六条新契约＋邻批旧锚一字未动） =====
console.log('[S] 逻辑锚');
ok(dev.includes('if (!pickDoorHostable(el) || !window.mochiFilePickSurface) return null;'), 'S1 模具拒收「装不出渲染子节点」的宿主（替换元素里铺 input＝0×0 死层）');
ok(dev.includes('if (leaf) { face = face || cur; continue; }'), 'S2 装不出子节点的叶子不当门，记下那一格的盒子继续往上爬');
ok(dev.includes('if (face && pickDoorHostable(cur)) return { el: cur, face: face };'), 'S3 容器当门的前提＝这一发确实从那种叶子上爬上来');
ok(dev.includes('if (!pickDoorFitLayer(layer, el, o.face)) return null;'), 'S4 收完盒子必须当场复核命中，复核不过＝撤层');
ok(dev.includes("'fp:' + _anchor.root"), 'S5 无 id 的门按结构锚落盘（旧口径要求 tgt.id＝每场重交学费）');
ok(dev.includes('if (_f && !el.contains(_f)) _f = null;'), 'S6 锚解析到别处就什么都不铺');
ok(dev.includes('if (b && b.width && b.height) armed++; else dead++;'), 'S7 台账分开数「命得中／命不中」（死层不再算已修）');
// 邻批旧锚一字未动（模具本身＋闸＋画序＋取证出账）
ok(dev.includes('window.mochiFilePickDoor = function (el, o)'), 'S8 #1323a 铺层模具仍是唯一模具（本批没另起第二套）');
ok(dev.includes("if (!host && typeof o.onFiles !== 'function') return null;"), 'S9 #1323b 没有管线就绝不铺层');
ok(dev.includes("window.mochiFilePickLearnDoor(input);"), 'S10 #1323d 合成腿当场记门');
ok(dev.includes('if (!oh || oh === window.__mochiPickAskHost) return;'), 'S11 #1323g 闸的放行同时对手势序号与宿主');
ok(dev.includes('if (!rec || !rec.veto) return;'), 'S12 #1323h 闸只收自学装上的层（人工门语义不变）');
ok(dev.includes("if (cur.namespaceURI && cur.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;"), 'S13 #1323p SVG/mathml 跳过未动');
ok(dev.includes("if (tag === 'BUTTON' || tag === 'A') return { el: cur, face: null };"), 'S14 #1323q 重锚后仍在（button/a 整格覆盖安全）');
ok(dev.includes('if (o.face && o.face !== el && el.contains(o.face))'), 'S15 #1323r 重锚后仍在（容器不整格铺＝只按那一格）');
ok(dev.includes("'选图门台账：在册 '"), 'S16 #1323n 台账出账那一行未动');
ok(dev.includes("data-file-pick-surface"), 'S17 #991 真层的存在性标记未换口径');
ok(dev.includes('window.mochiPickDoorSweep'), 'S18 起手/启动补装这条路还在');

// ===== 浏览器侧夹具 =====
const browser = await chromium.launch();
const ctxOpts = { viewport: { width: 390, height: 844 } };
const PAGEerrors = [];
async function boot() {
  const page = await browser.newPage(ctxOpts);
  page.on('pageerror', (e) => PAGEerrors.push(String(e && e.message).slice(0, 160)));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    // 顽固内核仿真（P 组用）：合成激活一律不成＝任何 chooser>0 只能来自物理落点
    window.__chooserCount = 0;
    const box = document.createElement('div');
    box.id = 'p1343-stage';
    box.style.cssText = 'position:fixed;left:12px;top:48px;width:220px;height:300px;z-index:99998;background:#1b1f2a;';
    // 三种格子：① 一张 img 铺满（本批改的形状）② 同格里另有一个不重叠的兄弟按钮 ③ 有 id 的纯 div 叶子格（旧口径）
    box.innerHTML =
      '<div id="p1343-cell" style="position:relative;width:200px;height:120px;margin-bottom:8px">' +
      '<img id="p1343-face" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width:100%;height:100%">' +
      '<button id="p1343-sib" style="position:absolute;left:0;bottom:0;width:36px;height:20px">删</button>' +
      '</div>' +
      '<div id="p1343-leaf" style="width:60px;height:60px;background:#394"></div>';
    document.body.appendChild(box);
    window.__hits = { cell: 0, sib: 0, leaf: 0, files: [] };
    document.getElementById('p1343-cell').addEventListener('click', () => {
      window.__hits.cell++;
      window.mochiFilePick({ id: 'p1343-img-pick', accept: 'image/*', onFiles: (fs) => { window.__hits.files.push('cell:' + fs.length); } });
    });
    document.getElementById('p1343-sib').addEventListener('click', (e) => { e.stopPropagation(); window.__hits.sib++; });
    document.getElementById('p1343-leaf').addEventListener('click', () => {
      window.__hits.leaf++;
      window.mochiFilePick({ id: 'p1343-leaf-pick', accept: 'image/*', onFiles: (fs) => { window.__hits.files.push('leaf:' + fs.length); } });
    });
  });
  return page;
}
const center = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
const state = (page) => page.evaluate(() => {
  const layers = Array.from(document.querySelectorAll('#p1343-stage input[data-file-pick-surface]'));
  return {
    layers: layers.map((l) => {
      const r = l.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const u = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight ? document.elementFromPoint(cx, cy) : null;
      return { id: l.id, parent: l.parentNode.tagName + '#' + (l.parentNode.id || ''), w: Math.round(r.width), h: Math.round(r.height), hit: u === l ? 'SELF' : (u ? u.tagName + '#' + (u.id || '') : 'off'), veto: !!(l.__mochiSurface && l.__mochiSurface.veto) };
    }),
    hits: window.__hits,
    ring: (window.__mochiPickLog || []).map((x) => x.e + '/' + x.s),
    census: window.mochiPickDoorCensus ? window.mochiPickDoorCensus() : null,
    nofit: window.__mochiDoorNoFit || 0,
    ledger: (() => { try { return JSON.parse(localStorage.getItem('xy-home-v2:__pick-doors') || '{}'); } catch (e) { return {}; } })()
  };
});

// ===== A 组：症状本体（红侧＝这一发铺出的是死层） =====
console.log('[A] 症状本体：img 格子那一下铺到哪儿');
let page = await boot();
let c = await center(page, '#p1343-face');
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(320);
let st = await state(page);
const mine = st.layers.filter((l) => l.parent.indexOf('IMG') === 0 || l.id.indexOf('mochi-door') === 0);
ok(st.layers.length > 0, 'A1 第一发（走合成腿）之后这一格上确实出现了一张层', JSON.stringify(st.layers.map(l => l.parent + ' ' + l.w + 'x' + l.h)));
const lay0 = st.layers.find((l) => l.parent.indexOf('IMG') === 0);
ok(!lay0, 'A2 层没有铺进 <img> 里面（红侧＝parent=IMG／0×0 的死层，本批改的就是这条判据）', lay0 ? lay0.parent + ' ' + lay0.w + 'x' + lay0.h : 'no-dead-layer');
const onCell = st.layers.find((l) => l.parent.indexOf('DIV#p1343-cell') === 0);
ok(!!onCell && onCell.w > 0 && onCell.h > 0, 'A3 层改铺在能装子节点的宿主上且有真实盒子', onCell ? onCell.w + 'x' + onCell.h : 'none');
ok(!!onCell && onCell.hit === 'SELF', 'A4 层的中心 elementFromPoint 命中它自己＝手指这一下真的落在真 file input 上', onCell && onCell.hit);
ok(!!onCell && onCell.veto, 'A5 自学铺的层带闸（#1323 ③ 语义未动＝这一发入口没请求选择器就取消原生弹层）');

// ===== B 组：修好之后这一族真的能用 =====
console.log('[B] 第二发走原生腿');
let choosers = 0;
page.on('filechooser', async (fc) => { choosers++; try { await fc.setFiles([{ name: 'p1343.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154785e6360000002000001010000', 'hex') }]); } catch (e) {} });
// 取证环只有 6 格且全站共享（#1014）：清空一次再看，B2/B3 量的才是「第二发这一发」而不是上一发的残留
await page.evaluate(() => { try { window.__mochiPickLog.length = 0; } catch (e) {} });
c = await center(page, '#p1343-face');
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(420);
st = await state(page);
ok(choosers === 1, 'B1 第二发恰弹 1 次选择器（不双开：原生腿与合成腿没有各弹一次）', 'chooser=' + choosers);
ok(st.ring.some((x) => /surf:hit/.test(x)), 'B2 取证里有 surf:hit＝这一发是手指物理落在真 input 上', st.ring.slice(-4).join(' | '));
ok(!st.ring.some((x) => /fb:onscreen/.test(x)), 'B3 没有再借道搬层兜底（fb:onscreen＝红侧那条走不通的合成腿）');
ok(st.hits.cell >= 2, 'B4 层的点按仍冒泡回入口自己的 handler（没吃掉入口逻辑）', 'cell=' + st.hits.cell);
const gotFile = await page.evaluate(() => (window.__hits.files || []).some((s) => /^cell:1$/.test(s)));
ok(gotFile, 'B5 选完的文件真进了入口原有管线（onFiles 收到 1 个 File＝不是弹了个没处交的选择器）', JSON.stringify((await state(page)).hits.files));
// 同格兄弟元素没被吃掉
const sibBefore = st.hits.sib;
c = await center(page, '#p1343-sib');
const choosersBefore = choosers;
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(320);
st = await state(page);
ok(st.hits.sib === sibBefore + 1, 'B6 同一格里那个不重叠的兄弟按钮仍命中自己（层只盖住手指那一格＝没「修一处吃另一处」）', 'sib=' + st.hits.sib);
ok(choosers === choosersBefore, 'B7 点兄弟按钮没有顺手弹出图片选择器（层的盒子没扩到整格）', 'chooser=' + choosers);
const faceBox = await page.evaluate(() => { const r = document.getElementById('p1343-face').getBoundingClientRect(); const l = Array.from(document.querySelectorAll('#p1343-cell input[data-file-pick-surface]'))[0]; const q = l ? l.getBoundingClientRect() : null; return q ? [Math.round(r.width - q.width), Math.round(r.height - q.height)] : null; });
ok(faceBox && Math.abs(faceBox[0]) <= 2 && Math.abs(faceBox[1]) <= 2, 'B8 层的盒子＝手指那一格（img）的盒子，不是宿主的整格', JSON.stringify(faceBox));
await page.close();

// ===== C 组：复核不过＝撤层；人工门行为逐字不变 =====
console.log('[C] 撤层与人工门');
page = await boot();
const cres = await page.evaluate(() => {
  const host = document.getElementById('p1343-cell');
  const face = document.getElementById('p1343-face');
  const before = (window.__mochiDoorNoFit || 0);
  // 造一个「中心被绝对定位兄弟盖住、抬层也救不回」的形态：盖住的那格本身就是别的入口的按钮
  const cover = document.createElement('button');
  cover.id = 'p1343-cover';
  cover.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:5;';
  host.appendChild(cover);
  const r1 = window.mochiFilePickDoor(host, { owner: 'p1343-img-pick', id: 'p1343-test-nofit', veto: 1, face: face });
  const stillThere = !!document.getElementById('p1343-test-nofit');
  const after = (window.__mochiDoorNoFit || 0);
  cover.remove();
  // 人工门（不带 veto、不带 face）＝旧行为：铺上去就留下，不因盒子判据被撤
  const r2 = window.mochiFilePickDoor(document.getElementById('p1343-leaf'), { owner: 'p1343-leaf-pick', id: 'p1343-test-manual' });
  return { r1: !!r1, stillThere, delta: after - before, r2: !!r2, manualKept: !!document.getElementById('p1343-test-manual') };
});
ok(!cres.r1 && !cres.stillThere, 'C1 复核不过＝返回 null 且不留层（宁可退回合成腿，也不留第二类「看起来修好了」的门）');
ok(cres.delta >= 1, 'C2 撤层当场计数（__mochiDoorNoFit）＝这类格子在诊断里可见，不再是静默失败', 'delta=' + cres.delta);
ok(cres.r2 && cres.manualKept, 'C3 人工门（不带 veto）行为逐字不变＝#991/#1002/#1311 三代验过的门没被本批改道');
await page.close();

// ===== D 组：死层不再算「已修」 =====
console.log('[D] 台账不再把死层算成已修');
page = await boot();
const dseed = await page.evaluate(() => {
  // 手植一张 #1323 旧口径的死层（把 input append 进 <img>）＋按旧写法记进台账
  const face = document.getElementById('p1343-face');
  const input = document.createElement('input');
  input.type = 'file'; input.id = 'p1343-dead-layer'; input.setAttribute('data-file-pick-surface', '1');
  input.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;';
  face.appendChild(input);
  const d = JSON.parse(localStorage.getItem('xy-home-v2:__pick-doors') || '{}');
  d['p1343-face'] = { owner: 'p1343-img-pick', accept: 'image/*', multiple: false, t: Date.now() };
  localStorage.setItem('xy-home-v2:__pick-doors', JSON.stringify(d));
  return true;
});
// 台账在内存里有一份缓存（pickDoorLoad），必须重载之后 census 才读到我刚种的那一条
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2400);
const dres = await page.evaluate(() => {
  const box = document.createElement('div');
  box.id = 'p1343-stage';
  box.style.cssText = 'position:fixed;left:12px;top:48px;width:220px;height:300px;z-index:99998;background:#1b1f2a;';
  box.innerHTML = '<div id="p1343-cell" style="position:relative;width:200px;height:120px"><img id="p1343-face" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width:100%;height:100%"></div>';
  document.body.appendChild(box);
  const face = document.getElementById('p1343-face');
  const input = document.createElement('input');
  input.type = 'file'; input.id = 'p1343-dead-layer'; input.setAttribute('data-file-pick-surface', '1');
  input.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;';
  face.appendChild(input);
  const cs = window.mochiPickDoorCensus();
  return { cs };
});
ok(dres.cs && dres.cs.total >= 1, 'D0 夹具真：台账里确实有那一条（读不到＝下面两条判据没有底）', JSON.stringify(dres.cs));
ok(dres.cs && dres.cs.dead >= 1 && dres.cs.armed === 0, 'D1 0×0 的层计入 dead、不计入 armed（红侧 census 把它算成「已修」＝这句谎的来源）', JSON.stringify(dres.cs));
await page.close();

// ===== L 组：结构锚跨重载 =====
console.log('[L] 结构锚（无 id 的格子）');
page = await boot();
// 再搭一格「容器与图都没有 id」的夹具＝JS 现渲的图片格子的真实形状（#1323 的 B 档对这种格子结构性失明）
const buildFpFixture = () => page.evaluate(() => {
  const s = document.createElement('div');
  s.id = 'p1343-stage2';                       // 只有最外层锚点有 id（页面级容器都是这样）
  s.style.cssText = 'position:fixed;left:12px;top:360px;width:220px;height:130px;z-index:99998;background:#20263a;';
  s.innerHTML = '<div style="position:relative;width:200px;height:120px"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width:100%;height:100%"></div>';
  document.body.appendChild(s);
  window.__fp = { taps: 0, files: [] };
  s.querySelector('div').addEventListener('click', () => {
    window.__fp.taps++;
    window.mochiFilePick({ id: 'p1343-fp-pick', accept: 'image/*', onFiles: (fs) => { window.__fp.files.push(fs.length); } });
  });
  return true;
});
const readFp = () => page.evaluate(() => {
  const s = document.getElementById('p1343-stage2');
  const cell = s && s.querySelector('div');
  const l = cell && cell.querySelector('input[data-file-pick-surface]');
  let laid = null;
  if (l) {
    const r = l.getBoundingClientRect();
    const u = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    laid = { w: Math.round(r.width), h: Math.round(r.height), hit: u === l ? 'SELF' : (u ? u.tagName : 'off'), veto: !!(l.__mochiSurface && l.__mochiSurface.veto) };
  }
  let d = {};
  try { d = JSON.parse(localStorage.getItem('xy-home-v2:__pick-doors') || '{}'); } catch (e) {}
  return { laid, keys: Object.keys(d) };
});
await buildFpFixture();
c = await center(page, '#p1343-stage2 img');
await page.mouse.click(c.x, c.y);
// 台账落盘是 600ms 防抖（pickDoorDirty）——等过它再读，否则量到的是「还没写」而不是「没记」
await page.waitForTimeout(1100);
let f1 = await readFp();
ok(f1.keys.some((k) => k.indexOf('fp:') === 0), 'L1 没有 id 的图片格子第一发后就落盘（红侧＝#1323 的 B 档要求 tgt.id，这种格子永远学不会）', JSON.stringify(f1.keys));
ok(!!f1.laid && f1.laid.hit === 'SELF', 'L2 第一发当场换的那扇门自己也命得中（不是死层）', JSON.stringify(f1.laid));
// 重载：启动补装应当把这一格直接铺回来——不再让用户每场重交一发学费（iOS 每几分钟回收一次页面）
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2400);
await buildFpFixture();
await page.waitForTimeout(500);
// 起手扫的触发条件是「任意一次 pointerdown」（#1323e），所以在同屏的空白处按一下就能量到补装，
// 而不必让用户再点一次那一格（L5 断言的正是这一发没落到入口的 handler 上）
await page.mouse.click(12 + 210, 360 + 40);
await page.waitForTimeout(400);
let f2 = await readFp();
ok(!!f2.laid, 'L3 重载后由结构锚补装当场就有层，且这一发之前用户一次都没点过', JSON.stringify(f2.laid));
ok(!!f2.laid && f2.laid.w > 0 && f2.laid.h > 0 && f2.laid.hit === 'SELF', 'L4 补装出来的层有盒子且命得中（红侧补装出来的可能就是那张 0×0 死层）', JSON.stringify(f2.laid));
const tapsAfterRelay = await page.evaluate(() => window.__fp.taps);
ok(tapsAfterRelay === 0, 'L5 补装这一步没有把入口的 handler 代跑一遍（层只是在那儿等着，不替用户点）', 'taps=' + tapsAfterRelay);
// 锚解析不中＝一张都不铺
const f6 = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('xy-home-v2:__pick-doors') || '{}');
  const k = Object.keys(d).find((x) => x.indexOf('fp:') === 0);
  if (!k) return { skipped: true };
  d[k] = Object.assign({}, d[k], { a: { root: 'p1343-no-such-root', idx: [], ok: 1 } });
  localStorage.setItem('xy-home-v2:__pick-doors', JSON.stringify(d));
  try { window.__pickDoorsInMemory = 1; } catch (e) {}
  const before = document.querySelectorAll('#p1343-stage2 input[data-file-pick-surface]').length;
  window.mochiPickDoorSweep(true);
  return { before, after: document.querySelectorAll('#p1343-stage2 input[data-file-pick-surface]').length };
});
ok(f6.skipped || f6.after === f6.before, 'L6 锚解析不中时一张都不铺（绝不在猜错的格子上铺门）', JSON.stringify(f6));
// 旧契约：被判「口径不一致」的门永久剔除，补装不得把它铺回来
// （台账在内存里有一份缓存＝pickDoorLoad，改完 localStorage 必须重载，否则量到的是缓存而不是账本）
const f7k = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('xy-home-v2:__pick-doors') || '{}');
  const k = Object.keys(d)[0];
  if (!k) return { skipped: true };
  d[k] = { bad: 1, t: Date.now() };
  localStorage.setItem('xy-home-v2:__pick-doors', JSON.stringify(d));
  return { k };
});
let f7 = { skipped: true };
if (!f7k.skipped) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2400);
  await buildFpFixture();
  await page.mouse.click(12 + 210, 360 + 40);
  await page.waitForTimeout(400);
  const laid7 = await page.evaluate(() => document.querySelectorAll('#p1343-stage2 input[data-file-pick-surface]').length);
  f7 = { laid: laid7 };
}
ok(f7.skipped || f7.laid === 0, 'L7 #1323j 的 bad 永久剔除语义未动（改成恒补＝把弹错类型的选择器盖回用户手指上）', JSON.stringify(f7));
await page.close();

// ===== P 组：旧口径健康对照 =====
console.log('[P] 旧口径与夹具真');
page = await boot();
// 有 id 的纯 div 叶子格＝旧行为：铺在这张叶子自己身上（face=null）
c = await center(page, '#p1343-leaf');
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(320);
st = await state(page);
const leafLay = st.layers.find((l) => l.parent.indexOf('DIV#p1343-leaf') === 0);
ok(!!leafLay && leafLay.w > 0 && leafLay.hit === 'SELF', 'P1 能装子节点的叶子仍铺在自己身上（旧行为一字未改）', leafLay ? leafLay.parent + ' ' + leafLay.w + 'x' + leafLay.h : 'none');
// 夹具真：把门关掉（清台账＋删层）后第一发确实一次选择器都不弹——需要顽固内核仿真才成立，
// Chromium 的合成腿会弹，所以这里量的是「这一发的取证里出现了 leg:fire（＝没走原生腿）」
const clean = await page.evaluate(() => {
  localStorage.removeItem('xy-home-v2:__pick-doors');
  document.querySelectorAll('#p1343-stage input[data-file-pick-surface]').forEach((l) => l.remove());
  window.__mochiSurfaceTapAt = 0;
  return true;
});
let ch2 = 0;
page.on('filechooser', () => { ch2++; });
c = await center(page, '#p1343-face');
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(300);
st = await state(page);
ok(clean && st.ring.some((x) => /leg:fire/.test(x)), 'P2 没有层的这一发确实走了合成腿（leg:fire 在场＝夹具真：原生腿没参与）', st.ring.slice(-3).join(' | '));
await page.close();

console.log('[Z] 未捕获异常');
ok(PAGEerrors.length === 0, 'Z1 全程零未捕获异常', PAGEerrors.slice(0, 3).join(' | '));
await browser.close();
server.close();
console.log('\n结果：' + pass + ' 绿 / ' + fail + ' 红（被测根目录＝' + root + '）');
process.exitCode = fail ? 1 : 0;

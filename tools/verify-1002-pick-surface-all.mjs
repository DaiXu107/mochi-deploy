// verify-1002-pick-surface-all.mjs — #1002 第九波续：「真·可点 input 层」推广到其余上传入口（常驻）
// 立项（用户 2026-09-21 直派「你帮我补。」＝把 #991 只在四个头像入口铺的那层，补到其余上传图片的地方；
//   同批背景：红米 Note 9 Pro + 手机自带浏览器 MiuiBrowser 实报「导入图片点不了」，明说其他型号也有）。
// 根因同 #991：三条激活腿（label 转发 / JS 合成 click / showPicker）全靠内核乐意执行我们的 JS；
//   三条同时被无视＝点了彻底没反应。修法＝在**单一用途的常驻入口**内铺一层有真实尺寸、手指能直接落在
//   上面的真 file input（opacity 保持 1，靠 appearance:none + font-size:0 + 透明前景色 + CSS
//   ::file-selector-button{display:none} 藏外观），选择器由浏览器**原生默认动作**弹出；
//   选完文件按 owner（宿主 input，可写 id 字符串）转交并派发 change ⇒ 各入口原有压缩/落库管线一字未改。
// 断言：①静态锚（每个入口的铺层行按精确条数在位；容器里还有别的按钮的入口必须**没有**铺层）；
//   ②顽固内核（label 被吞 + showPicker 抛错 + file input 的 click() no-op）下逐个真实点按＝选择器恰弹
//   1 次且真图落库/生效；③零 JS 异常。
// 用法：node build.mjs && node tools/verify-1002-pick-surface-all.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> 或 MOCHI_SERVE_ROOT=<目录> node tools/verify-1002-pick-surface-all.mjs
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
const cssAll = () => { try { return readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };

// ===== ① 静态锚：每个入口的铺层行按精确条数在位 =====
const installOf = (f) => (jsOf(f).match(/mochiFilePickSurface\(/g) || []).length;
{
  // 铺层点＝入口绑定/渲染处一行（feed 含 3 处「重渲染后幂等补挂」＋#1311 封面共用的一个武装口；
  // personalize＝桌面头像+页面背景行+手机壁纸面板）
  const want = [['avatar-lib.js', 1], ['feed.js', 8], ['chat.js', 4], ['group-chat.js', 3], ['personalize.js', 3], ['chat-settings.js', 4]];
  const bad = want.filter(([f, n]) => installOf(f) !== n).map(([f, n]) => f + '=' + installOf(f) + '(期望' + n + ')');
  ok(bad.length === 0, 'S1 六个文件里各上传入口的「真·可点 input 层」铺层行按精确条数在位', bad.join(' '));
}
ok(jsOf('device.js').includes('window.mochiFilePickSurfaceAll = function (input) {'),
  'S2 一个宿主 input 可对应多个触发按钮（聊天壁纸＝设置页面板 + 边看边调抽屉两处），点按时把回调接到全部同宿主的层上');
ok(jsOf('device.js').includes("if (typeof owner === 'string') { try { owner = document.getElementById(owner); } catch (e2) { owner = null; } }"),
  'S3 owner 可写 id 字符串（统一入口的 input 点按时才建，绑定/渲染时只登记 id）——删＝那些入口选完文件无回调（图被静默丢弃）');
ok(cssAll().includes('input.mochi-pick-surface::-webkit-file-upload-button { display:none; }') || /mochi-pick-surface::-webkit-file-upload-button/.test(cssAll()),
  'S4 surface 层原生「选择文件」按钮仍由 CSS 藏掉（防入口上浮出原生按钮破相）');
// 封面容器：旧结论「容器里还有别的可点元素就不铺」在 #1311 收窄——不铺＝这一路只剩 JS 合成腿，
// iOS 26/多家壳内核对合成激活静默拒绝（实报「朋友圈壁纸无法添加」那张诊断单只有 leg:fire＋fb:onscreen）。
// 现在允许铺，但必须走那个把三件事一起做完的武装口（挪画序＋按背景开关可命中性＋owner 交回原管线）；
// 行为判据（四处命中各归各、面板没被吞、恢复默认后重新武装）在 tools/verify-1311 的 B 组。
{
  const feed = jsOf('feed.js');
  const bad = [];
  if (!/function armCoverLayer\(el, layerId, ownerId, hasBg\)/.test(feed)) bad.push('封面没走统一武装口');
  if (!/el\.insertBefore\(layer, el\.firstChild\)/.test(feed)) bad.push('缺「挪成第一个子节点」＝absolute 层压在静态流内的头像/昵称之上＝吞掉兄弟控件');
  if (!/layer\.style\.pointerEvents = hasBg \? 'none' : 'auto';/.test(feed)) bad.push('缺「按背景开关可命中性」＝已有背景时开不出「更换背景／恢复默认」面板');
  if (/mochiFilePickSurface\(feedAllCover/.test(feed) || /mochiFilePickSurface\(coverEl/.test(feed)) bad.push('直接对封面容器铺层（绕过画序/开关那两件事）');
  ok(bad.length === 0, 'S5 封面容器可铺层，但只能经 armCoverLayer（画序＋开关＋交回原管线三件事齐做）', bad.join(' | '));
}

// 64×64 不透明 PNG（走真选择器投递＝change→FileReader/压缩→落库全链路）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbMzwzQAAAAAAAAAAAAAAAAAAOAvnTMAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');

async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, jsErrors: [] };
  page.on('filechooser', async (fc) => {
    st.chooser++;
    try { await fc.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG }); } catch (e) { st.setFilesErr = e.message; }
  });
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
  });
  await page.addInitScript(() => {
    // 顽固内核仿真（同 #991/#920 口径）：label 转发被吞 + showPicker 抛 NotAllowedError +
    // file input 的合成 click() 无效。三条腿全废 ⇒ 只剩「手指物理点在真 input 上」能弹选择器。
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
const clearOverlays = (page) => page.evaluate(() => {
  const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
  const m = document.getElementById('modal-mask'); if (m && !m.hidden) m.hidden = true;
  // 面板类浮层（body 级、跨页面残留会盖住后续用例的目标）
  ['cs-bg-panel', 'phone-bg-gallery-panel', 'icon-fit-panel'].forEach((id) => {
    const x = document.getElementById(id); if (x) { try { x.style.display = 'none'; } catch (e) {} }
  });
});
async function showPage(page, pid, tabSel) {
  await page.evaluate(([id, ts]) => {
    document.querySelectorAll('.page').forEach((p) => { if (!p.hidden) p.hidden = true; });
    const t = document.getElementById(id); if (t) { t.hidden = false; t.style.removeProperty('display'); }
    if (ts) { const tab = document.querySelector(ts); if (tab) tab.click(); }
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    const m = document.getElementById('modal-mask'); if (m && !m.hidden) m.hidden = true;
  }, [pid, tabSel]);
  await page.waitForTimeout(420);
}
// 目标藏在浮层/隐藏面板里时：逐级解除 hidden/display:none 并滚到视口内（同 #920 harness 口径）
async function forceReveal(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return null;
    let n = el;
    while (n && n !== document.body) {
      if (n.hidden) n.hidden = false;
      try { if (getComputedStyle(n).display === 'none') n.style.setProperty('display', 'block', 'important'); } catch (e) {}
      n = n.parentElement;
    }
    el.scrollIntoView({ block: 'center' });
    return true;
  }, sel);
}
async function tapSel(page, st, sel, { settle = 2600, reveal = false } = {}) {
  if (reveal) await forceReveal(page, sel);
  await clearOverlays(page);
  // 先滚到位、**等一帧再读 rect**：页面容器带平滑滚动时，scrollIntoView 后立刻读到的还是滚动前的
  // 位置，点按就会落空/落到别人身上（实测把「手机壁纸上传行」的点击打到了页面背景行的补挂层上）。
  await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.scrollIntoView({ block: 'center' }); }, sel);
  await page.waitForTimeout(300);
  const geo = await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return { err: 'no-el' };
    b.scrollIntoView({ block: 'center' });
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
  return { ...geo, chooser: st.chooser, setFilesErr: st.setFilesErr || '' };
}
// 面板内按文字找按钮点按（壁纸面板「＋ 上传新图（可多选）」等动态节点）
async function tapIn(page, st, panelSel, needle, { settle = 2600 } = {}) {
  await page.waitForTimeout(200); // 同上：面板刚开时先等它稳定再量 rect
  // 注意：这里**不能**清 #cs-bg-panel/#phone-bg-gallery-panel（要点的就是面板里的按钮），
  // 只收掉与本次无关的全屏浮层（留言横幅 / 弹窗）。
  await page.evaluate(() => {
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    const m = document.getElementById('modal-mask'); if (m && !m.hidden) m.hidden = true;
  });
  const geo = await page.evaluate(([ps, nt]) => {
    const panel = document.querySelector(ps); if (!panel) return { err: 'no-panel:' + ps };
    const b = Array.prototype.slice.call(panel.querySelectorAll('button')).find((x) => (x.textContent || '').indexOf(nt) >= 0 && x.getBoundingClientRect().width > 0);
    if (!b) return { err: 'no-btn:' + nt };
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return { cx, cy, hit: hit ? (hit.tagName.toLowerCase() + (hit.getAttribute && hit.getAttribute('data-file-pick-surface') ? '[surface]' : '')) : 'null' };
  }, [panelSel, needle]);
  if (geo.err) return geo;
  st.chooser = 0;
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(settle);
  return { ...geo, chooser: st.chooser, setFilesErr: st.setFilesErr || '' };
}
const line = (r) => r.err || ('hit=' + r.hit + ' chooser=' + r.chooser + (r.setFilesErr ? ' ' + r.setFilesErr : ''));
const lsLen = (page, key) => page.evaluate((k) => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (full === k || full.endsWith(':' + k)) return (localStorage.getItem(full) || '').length;
    }
  } catch (e) {}
  return 0;
}, key);

// ===== ①b 每个 surface 层都必须落在它自己的入口内（不得变成整屏透明层） =====
// 踩过：入口是「游离态创建、之后才挂文档」时，若没给入口补 position:relative，这层 100%×100%
// 会以初始包含块为基准＝整屏透明 input，把页面所有点击都吃掉（面板/页面当场废掉）。
async function checkSurfaceBounds(page, tag) {
  const bad = await page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    Array.prototype.slice.call(document.querySelectorAll('input[data-file-pick-surface]')).forEach((i) => {
      const p = i.parentElement; if (!p) { out.push(i.id + ':no-parent'); return; }
      const r = i.getBoundingClientRect(), pr = p.getBoundingClientRect();
      if (!r.width && !r.height) return; // 未布局（页面隐藏）＝跳过
      if (r.width > vw - 4 && r.height > vh - 4) { out.push(i.id + ':全屏 ' + Math.round(r.width) + 'x' + Math.round(r.height)); return; }
      if (r.width > pr.width + 2 || r.height > pr.height + 2) { out.push(i.id + ':超出入口 ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' > ' + Math.round(pr.width) + 'x' + Math.round(pr.height)); }
    });
    return out;
  });
  ok(bad.length === 0, 'B0 surface 层都不大于自己的入口（' + tag + '；超限＝整屏透明层吃掉页面点击）', bad.join(' | '));
}

// ===== ② 顽固内核下的行为 =====
{
  const { browser, page, st } = await boot();
  // 桌面：头像池两处「添加头像 / 添加我的头像」
  await showPage(page, 'page-phone', null);
  await checkSurfaceBounds(page, '桌面页');
  const av1 = await tapSel(page, st, '#avlib-upload', { reveal: true });
  ok(av1.chooser === 1 && !av1.err, 'B1 头像池「添加头像」：三条腿全废的内核下点按即弹选择器（HEAD＝0＝无反应）', line(av1));
  const av2 = await tapSel(page, st, '#avlib-me-upload', { reveal: true });
  ok(av2.chooser === 1 && !av2.err, 'B2 头像池「添加我的头像」：点按即弹选择器', line(av2));
  // 聊天输入栏「插入图片」
  await showPage(page, 'page-chat', null);
  const ch1 = await tapSel(page, st, '#chat-img-btn');
  ok(ch1.chooser === 1 && !ch1.err, 'B3 聊天输入栏「插入图片」：点按即弹选择器', line(ch1));
  // 朋友圈：封面头像 + 发布框「添加图片」
  const fd1 = await tapSel(page, st, '#feed-my-av', { reveal: true });
  ok(fd1.chooser === 1 && !fd1.err, 'B4 朋友圈封面头像：点按即弹选择器', line(fd1));
  const fd2 = await tapSel(page, st, '#feed-pick-img', { reveal: true });
  ok(fd2.chooser === 1 && !fd2.err, 'B5 朋友圈发布框「添加图片」：点按即弹选择器', line(fd2));
  const fd3 = await tapSel(page, st, '#feed-comment-img', { reveal: true });
  ok(fd3.chooser === 1 && !fd3.err, 'B6 朋友圈评论「图片」：点按即弹选择器', line(fd3));
  const fd4 = await tapSel(page, st, '#feed-all-av', { reveal: true });
  ok(fd4.chooser === 1 && !fd4.err, 'B7 全部朋友圈页头像：点按即弹选择器', line(fd4));
  // 群聊输入栏「插入图片」
  await showPage(page, 'page-group-chat', null);
  const gc1 = await tapSel(page, st, '#gc-img-btn');
  ok(gc1.chooser === 1 && !gc1.err, 'B3b 群聊输入栏「插入图片」：点按即弹选择器', line(gc1));
  // 聊天壁纸：设置 → 美化 → 壁纸行开面板 → 「＋ 上传新图（可多选）」
  await showPage(page, 'page-chat-settings', '#cs-tabs .them-tab[data-tab="beautify"]');
  await checkSurfaceBounds(page, '聊天设置页/壁纸面板');
  const w1row = await tapSel(page, st, '#cs-bg-upload');
  ok(w1row.chooser === 0 && !w1row.err, 'B8a 状态前置：聊天壁纸「上传」行只开面板、不直接弹选择器', line(w1row));
  const w1 = await tapIn(page, st, '#cs-bg-panel', '上传新图');
  ok(w1.chooser === 1 && !w1.err, 'B9 聊天壁纸面板「＋ 上传新图（可多选）」：点按即弹选择器', line(w1));
  ok((await lsLen(page, 'cs-bg')) > 100, 'B9b 聊天壁纸：选完真的落库（不是「弹了但图被丢弃」）', 'cs-bg len=' + (await lsLen(page, 'cs-bg')));
  // 手机壁纸：设置 → 壁纸与图标 → 壁纸行开面板 → 「＋ 上传新图（可多选）」
  await showPage(page, 'page-theme', '#them-tabs .them-tab[data-tab="wall"]');
  const w2row = await tapSel(page, st, '#row-bg-upload');
  ok(w2row.chooser === 0 && !w2row.err, 'B10a 状态前置：手机壁纸「上传」行只开面板、不直接弹选择器', line(w2row));
  const w2 = await tapIn(page, st, '#phone-bg-gallery-panel', '上传新图');
  ok(w2.chooser === 1 && !w2.err, 'B11 手机壁纸面板「＋ 上传新图（可多选）」：点按即弹选择器', line(w2));
  ok((await lsLen(page, 'phone-bg-item-')) >= 0 && (await page.evaluate(() => { try { return Object.keys(localStorage).filter((k) => /phone-bg-item-/.test(k)).length; } catch (e) { return 0; } })) > 0,
    'B11b 手机壁纸：选完真的进图库（不是「弹了但图被丢弃」）');
  // 页面背景行（设置页动态渲染的 set-row）
  // 页面背景行（设置 → 壁纸与图标 → 「首页 / 第 N 页背景图」动态行）
  await showPage(page, 'page-theme', '#them-tabs .them-tab[data-tab="wall"]');
  await checkSurfaceBounds(page, '设置→壁纸与图标');
  const pbRes = await page.evaluate(() => {
    // 行内的 .val 在未设图时是空 div（宽高都是 0），点按要对准**整行**（.set-row），
    // 故这里用容器选择器取第一行（＝首页背景图行），并用 val 的 id 自检身份
    const row = document.querySelector('#desk-page-bgs .set-row');
    const v = row ? row.querySelector('.val') : null;
    if (!row || !v) return { err: 'no-row' };
    if (v.id !== 'page-bg-val-0') return { err: 'unexpected-row:' + v.id };
    const hasSurf = !!row.querySelector('input[data-file-pick-surface]');
    row.scrollIntoView({ block: 'center' });
    const r = row.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { hasSurf, w: Math.round(r.width), hit: hit ? (hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (hit.getAttribute && hit.getAttribute('data-file-pick-surface') ? '[surface]' : '')) : 'null' };
  });
  ok(pbRes.hasSurf === true && pbRes.w > 0, 'B12 页面背景行（首页背景图）铺了真·可点 input 层且可见', JSON.stringify(pbRes));
  const pb2 = await tapSel(page, st, '#desk-page-bgs .set-row');
  ok(pb2.chooser === 1 && !pb2.err, 'B13 页面背景行：点按即弹选择器', line(pb2));
  ok((await lsLen(page, 'page-bg-0')) > 100, 'B13b 页面背景：选完真的落库', 'page-bg-0 len=' + (await lsLen(page, 'page-bg-0')));
  await page.screenshot({ path: join(here, 'tools', '_992-after.png') }).catch(() => {});
  ok(st.jsErrors.length === 0, 'Z 全程零 JS 异常', JSON.stringify(st.jsErrors.slice(0, 3)));
  await browser.close();
}

console.log('\n== verify-1002 其余上传入口「真·可点 input 层」: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail === 0 ? 0 : 1);

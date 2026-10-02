// #920 全站图片上传「点了无反应」第八波——激活腿单点统一（mochiFilePickFire）行为验证
// 立项（用户 2026-09-20 小米14 自带浏览器 MiuiBrowser 20.27 / Android16 / Chrome135 内核实报
//   「照片、壁纸上传不了，所有上传图片的地方上传无反应」，明说其他机型也有；#677/#717/#738/
//   #753/#755/#756/#813/#877 同族第八波）：
// 根因（零机型分支）：#877 只把聊天设置两行头像的兜底腿升级成三条，其余入口（45 处统一入口
//   mochiFilePick 调用 ＋ 10 处 guard/手写兜底，且多数入口压根没接 label）仍是「label 转发 ＋
//   裸 click()」两条腿。#738 已实锤小米系对 JS 合成 click 静默不弹（不报错/不弹窗/不抛异常），
//   在「label 不转发或没接 label」的内核上整族无声＝用户所报「所有上传图片的地方都无反应」。
//   修法（本波不逐入口手抄——手抄必漏是本族反复复发的结构性原因）：device.js 单点实现
//   window.mochiFilePickFire（showPicker→click→onFail，顺序双走、零机型分支），mochiFilePick
//   公共激活路径与 10 处手写兜底全部改走它。
// 本脚本两部分：
//   ① 静态锚（S1~S4）：单点实现/第三条腿/公共激活路径在产物；7 个手写兜底文件各按精确条数命中。
//   ② 行为（顽固内核仿真：捕获阶段吞 label 转发＋prototype.click 换 no-op）：对 5 个真实入口
//      发场点击——聊天壁纸 / 桌面背景 / 桌面头像 / 头像池添加（#920 新收口）＋ 聊天设置头像
//      （#877 对照，两条腿基线都该弹）。断言每入口经 showPicker 腿恰好弹 1 次（不双开）＋零异常。
// 判别力：纯 HEAD（无 mochiFilePickFire）上 S1~S4 恰红、B1~B4 恰红（chooser=0＝用户所见「点了
//   没反应」），B0 对照两侧同绿（#877 已在 HEAD 上落 3 条腿）。
// 用法：node build.mjs && node tools/verify-pick-fire-all.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-pick-fire-all.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

// ===== ① 静态锚（按产物池核：device.js 属 3 件内联系统件走 index.html，其余按 js/<file>） =====
const jsPath = (f) => join(root, 'js', f);
const artOf = (f) => {
  try { return readFileSync(existsSync(jsPath(f)) ? jsPath(f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; }
};
const dev = artOf('device.js');
ok(dev.includes('window.mochiFilePickFire = function (input, opts) {'),
  'S1 激活腿单点实现 mochiFilePickFire 在产物（删＝全站入口回退两腿＝小米系整族无反应复发）');
ok(dev.includes('try { input.showPicker(); fired = true; } catch (e) {}'),
  'S2 第三条腿（showPicker）在产物且与 click 顺序双走（改回「成功即 return」＝不可观测内核被短路）');
ok(dev.includes('window.mochiFilePickFire(input, { onFail: function () { if (o.onError) { try { o.onError(); } catch (x) {} } } });'),
  'S3 mochiFilePick 公共激活路径改走三腿（45 处统一入口全体升级的支点）');
{
  // 10 处手写兜底的逐文件精确条数（多删/漏抄都当场红）
  const expect = [['chat.js', 1], ['personalize.js', 1], ['avatar-lib.js', 1], ['feed.js', 1], ['group-chat.js', 3], ['gift-shop.js', 1], ['memo-arc.js', 2]];
  let bad = [];
  for (const [f, n] of expect) {
    const c = (artOf(f).match(/mochiFilePickFire\(/g) || []).length;
    if (c !== n) bad.push(f + '=' + c + '(期望' + n + ')');
  }
  ok(bad.length === 0, 'S4 七文件手写兜底各按精确条数改走三腿（合计 10 处）', bad.join(' '));
}

// 64×64 不透明 PNG（B3 走全链路落库：change→FileReader→压缩→store）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbMzwzQAAAAAAAAAAAAAAAAAAOAvnTMAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const st = { chooser: 0, jsErrors: [] };
page.on('filechooser', async (fc) => {
  st.chooser++;
  try { if (st.deliver) await fc.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG }); } catch (e) { st.setFilesErr = e.message; }
});
page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 160)));
await page.addInitScript(() => {
  // 顽固内核仿真（与 #877 同口径）：
  // ①label 转发缺失（捕获阶段 preventDefault 吞 label 点击默认行为＝#756 实况）
  document.addEventListener('click', (e) => {
    try { if (e.target && e.target.closest && e.target.closest('label[data-file-pick-for]')) e.preventDefault(); } catch (x) {}
  }, true);
  // ②legacy JS click() 被内核无视（小米系实况，#738：静默不弹、不抛错）
  HTMLInputElement.prototype.click = function () { window.__clickNoop = (window.__clickNoop || 0) + 1; };
  // ③记录 showPicker 调用（第三条腿是否被走到）
  const sp = HTMLInputElement.prototype.showPicker;
  if (sp) HTMLInputElement.prototype.showPicker = function () { window.__spCalls = (window.__spCalls || 0) + 1; return sp.apply(this, arguments); };
});
await page.goto(baseUrl + '/index.html');
await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
await page.evaluate(() => {
  const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
  const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
  const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
});
await page.waitForTimeout(600);

// 显示指定页面并切到指定 tab（与 #877 harness 同法；页面由 JS 渲染，直接解除 hidden）
async function showPage(pageId, tabSel) {
  await page.evaluate(([pid, tsel]) => {
    document.querySelectorAll('.page').forEach((p) => { if (!p.hidden) p.hidden = true; });
    const t = document.getElementById(pid);
    if (t) { t.hidden = false; t.style.removeProperty('display'); }
    if (tsel) { const tab = document.querySelector(tsel); if (tab) tab.click(); }
    const m = document.getElementById('modal-mask'); if (m && !m.hidden) m.style.setProperty('display', 'none', 'important');
    // 图库面板是 body 级浮层，跨用例残留会挡住后续点按
    for (const pid2 of ['cs-bg-panel', 'phone-bg-gallery-panel']) { const x = document.getElementById(pid2); if (x) x.style.display = 'none'; }
  }, [pageId, tabSel]);
  await page.waitForTimeout(500);
}
// 目标元素若藏在 overlay（如 avlib-card 半框）里：逐级解除 hidden/display:none 再滚到视口内
async function forceReveal(sel) {
  return await page.evaluate((s) => {
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
// 兜底：把挡住目标中心、又不属于目标祖先/子孙的浮层逐层藏掉（真实点按必须落在目标上）
async function uncover(sel) {
  await page.evaluate((s) => {
    const t = document.querySelector(s); if (!t) return;
    t.scrollIntoView({ block: 'center' });
    for (let i = 0; i < 6; i++) {
      const r = t.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!el || el === t || t.contains(el) || el.contains(t)) break;
      el.style.setProperty('display', 'none', 'important');
    }
  }, sel);
}
const snap = async (spBefore) => ({
  chooser: st.chooser,
  spDelta: (await page.evaluate(() => window.__spCalls || 0)) - spBefore,
  clickNoop: await page.evaluate(() => window.__clickNoop || 0),
  toastTxt: await page.evaluate(() => { const t = document.querySelector('.toast, #toast, .mochi-toast'); return t ? t.textContent : ''; }),
  setFilesErr: st.setFilesErr
});
async function tap(sel, { deliver = false, reveal = false } = {}) {
  st.chooser = 0; st.deliver = !!deliver; st.setFilesErr = '';
  if (reveal) await forceReveal(sel);
  const spBefore = await page.evaluate(() => window.__spCalls || 0);
  const geo = await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height };
  }, sel);
  if (!geo || !geo.w || !geo.h) return { err: 'no-el', spBefore };
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(2600);
  return await snap(spBefore);
}
// 面板内按文字找按钮点按（壁纸图库「上传新图」等动态节点无稳定 id）
async function tapIn(panelSel, textNeedle) {
  st.chooser = 0; st.deliver = false; st.setFilesErr = '';
  const spBefore = await page.evaluate(() => window.__spCalls || 0);
  const geo = await page.evaluate(([ps, nt]) => {
    const panel = document.querySelector(ps); if (!panel) return null;
    const b = Array.from(panel.querySelectorAll('button')).find((x) => (x.textContent || '').indexOf(nt) >= 0 && x.getBoundingClientRect().width > 0);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, [panelSel, textNeedle]);
  if (!geo) return { err: 'no-btn:' + textNeedle };
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(2600);
  return await snap(spBefore);
}
const line = (r) => 'chooser=' + r.chooser + ' spΔ=' + r.spDelta + ' noop=' + r.clickNoop + ' ' + (r.setFilesErr || '') + (r.err ? ' ' + r.err : '');

// ===== ② 行为：6 个真实入口（顽固内核仿真下，选择器只能经 showPicker 腿弹出） =====
// B0 对照：#877 已在 HEAD 落三腿的聊天设置头像行（两侧同绿＝harness 基线）
await showPage('page-chat-settings', '#cs-tabs .them-tab[data-tab="function"]');
const b0 = await tap('#cs-avatar-partner', { deliver: false });
ok(b0.chooser === 1, 'B0 对照：聊天设置联系人头像行（#877 三腿）顽固内核下恰弹 1 次', line(b0));

// B1 聊天壁纸（用户报障入口之一）：行开图库面板 → 「上传新图」走 #920 统一入口
await showPage('page-chat-settings', '#cs-tabs .them-tab[data-tab="beautify"]');
const b1row = await tap('#cs-bg-upload', { deliver: false });
ok(b1row.chooser === 0, 'B1a 状态前置：聊天壁纸「上传行」只开图库面板、不直接弹选择器', line(b1row));
const b1 = await tapIn('#cs-bg-panel', '上传新图');
ok(b1.chooser === 1, 'B1b 聊天壁纸「上传新图」：顽固内核下选择器经 showPicker 腿恰弹 1 次（HEAD=0＝「点了没反应」）', line(b1));
ok(String(b1.toastTxt).indexOf('相册没能打开') < 0 && String(b1.toastTxt).indexOf('无法打开') < 0,
  'B1c 未误报失败提示（第三条腿成功时不打扰）', 'toast=[' + b1.toastTxt + ']');

// B2 桌面背景图片（用户报障入口之二）：行开图库面板 → 「上传新图（可多选）」
await showPage('page-theme', '#them-tabs .them-tab[data-tab="wall"]');
const b2row = await tap('#row-bg-upload', { deliver: false });
ok(b2row.chooser === 0, 'B2a 状态前置：桌面「上传手机背景图片」行只开图库面板', line(b2row));
const b2 = await tapIn('#phone-bg-gallery-panel', '上传新图');
ok(b2.chooser === 1, 'B2b 桌面背景「上传新图」：顽固内核下选择器恰弹 1 次（HEAD=0）', line(b2));

// B3 桌面「我」的头像（#717 家族原入口；personalize 手写兜底改走三腿 + 真图全链路落库）
await showPage('page-phone', null);
await uncover('#avatar-user');
const b3 = await tap('#avatar-user', { deliver: true, reveal: true });
ok(b3.chooser === 1, 'B3 桌面头像：顽固内核下选择器恰弹 1 次（HEAD=0）', line(b3));
await page.waitForTimeout(800);
const avStored = await page.evaluate(() => Object.keys(localStorage).some((k) => /avatar-user$/.test(k) && String(localStorage.getItem(k)).indexOf('data:image') === 0));
ok(avStored, 'B3b 真图经 showPicker 腿全链路落库（change→读→压→store 不断）', '');

// B4 头像池「添加头像」「添加我的头像」（avatar-lib 手写兜底改走三腿；半框 overlay 内）
const rev = await forceReveal('#avlib-upload');
const b4 = rev ? await tap('#avlib-upload', { deliver: true }) : { err: 'no-reveal', chooser: 0, spDelta: 0, clickNoop: 0 };
ok(b4.chooser === 1, 'B4 头像池「添加头像」：顽固内核下选择器恰弹 1 次（HEAD=0）', line(b4));
const b5 = await tap('#avlib-me-upload', { deliver: false, reveal: true });
ok(b5.chooser === 1, 'B5 头像池「添加我的头像」：同款顽固内核下选择器恰弹 1 次', line(b5));

ok(st.jsErrors.length === 0, 'Z 全程零 JS 异常', JSON.stringify(st.jsErrors.slice(0, 3)));

await browser.close();
server.close();
console.log('\n== 全站激活腿单点收口 #920（顽固内核仿真）: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);

// #877 聊天设置两行头像「点击无反应」第七波——第三条激活腿（showPicker）行为验证
// 立项（用户 2026-09-20 小米14 Edge 实报「更换联系人头像和我的头像点击无反应」，明说其他设备
//   型号也有；#677/#717/#738/#753/#755/#756/#813 同族第七波）：
// 根因（零机型分支）：激活链一直只有两条腿——①原生 label 转发（多数内核）；②JS 合成 click()
//   兜底。#738 已实锤小米系对 JS 合成 click 静默不弹（不报错、不弹窗、不抛异常）；某内核两条腿
//   同时失效（label 不转发＋click 被无视）时彻底无声＝「点击无反应」。修法＝兜底腿升级
//   「showPicker() → click() → 可诊断 toast」三级：showPicker 是标准 API（Chromium/Edge 99+、
//   Safari 16.3+），用户手势窗口内直接弹系统选择器，不依赖 label 转发也不走合成事件路径。
// 本脚本仿真「顽固内核」实况（label 转发缺失＋legacy click 被无视）做行为断言：
//   B1 联系人头像：点按 → 选择器经 showPicker 腿恰好弹 1 次 → 真图落库 → 行回显「已设置」
//   B2 我的头像：点按 → 选择器恰好弹 1 次（激活腿通）
//   P0 每次点按 guard 恰好武装一次（seq +1，双绑/双开哨兵）；S1/S2 产物锚；Z 零 JS 异常
// 判别力：纯 HEAD（无第三条腿）上 B1/B2/S1/S2 恰红（chooser=0＝无声复现），P0/Z 红绿同值。
// label 转发正常 / label 被拦截两条常规路径的端到端覆盖在 verify-avatar-upload-e2e.mjs（#813）。
// 用法：node build.mjs && node tools/verify-avatar-thirdleg.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-avatar-thirdleg.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync, readdirSync } from 'node:fs';
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

// S1/S2 产物锚（js/chat-settings.js 属 35 外置，按全产物池核，与 #425 同口径）
const srcOk = (function () {
  try {
    let pool = readFileSync(join(root, 'index.html'), 'utf8');
    const jsDir = join(root, 'js');
    for (const f of readdirSync(jsDir)) if (f.endsWith('.js')) pool += '\n' + readFileSync(join(jsDir, f), 'utf8');
    return pool;
  } catch (e) { return ''; }
})();
ok(srcOk.includes('try { headInput.showPicker(); opened = true; } catch (e) {}'),
  'S1 兜底第三条腿 showPicker 在产物（删＝label 不转发＋click 被无视的内核回到点击无声）', '');
ok(srcOk.includes('相册没能打开：请换系统浏览器或 Chrome 打开再试'),
  'S2 三条腿全失效时不再无声（可反馈现场提示在产物）', '');

// 64×64 不透明 PNG（经 showPicker 腿真投递＝change→FileReader→压缩→落库全链路）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbMzwzQAAAAAAAAAAAAAAAAAAOAvnTMAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const st = { chooser: 0, jsErrors: [] };
page.on('filechooser', async (fc) => {
  st.chooser++;
  try { if (st.deliver) await fc.setFiles({ name: 'av.png', mimeType: 'image/png', buffer: PNG }); } catch (e) { st.setFilesErr = e.message; }
});
page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 160)));
await page.addInitScript(() => {
  // 顽固内核仿真：①label 转发缺失（捕获阶段 preventDefault 吞掉 label 点击默认行为＝#756 实况）
  document.addEventListener('click', (e) => {
    try { if (e.target && e.target.closest && e.target.closest('label[data-file-pick-for]')) e.preventDefault(); } catch (x) {}
  }, true);
  // ②legacy JS click() 被内核无视（小米系实况，#738：静默不弹、不抛错）
  HTMLInputElement.prototype.click = function () { window.__clickNoop = (window.__clickNoop || 0) + 1; };
  // ③记录 showPicker 调用次数（第三条腿是否被走到）
  const sp = HTMLInputElement.prototype.showPicker;
  if (sp) HTMLInputElement.prototype.showPicker = function () { window.__spCalls = (window.__spCalls || 0) + 1; return sp.apply(this, arguments); };
});
await page.goto(baseUrl + '/index.html');
await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
await page.evaluate(() => {
  const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
  const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
  const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  document.querySelectorAll('.page').forEach((p) => { if (!p.hidden) p.hidden = true; });
  const t = document.getElementById('page-chat-settings'); if (t) t.hidden = false;
  const tab = document.querySelector('#cs-tabs .them-tab[data-tab="function"]'); if (tab) tab.click();
});
await page.waitForTimeout(900);
await page.evaluate(() => { const m = document.getElementById('modal-mask'); if (m && !m.hidden) m.style.setProperty('display', 'none', 'important'); });

async function tapRow(sel, deliver) {
  st.chooser = 0; st.deliver = !!deliver; st.setFilesErr = '';
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) { if (/cs-avatar/.test(k)) localStorage.removeItem(k); } });
  const seqBefore = await page.evaluate(() => window.__mochiPickArmed ? window.__mochiPickArmed.seq : 0);
  const geo = await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, sel);
  if (!geo) return { err: 'no-el', seqBefore };
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(2600);
  return {
    chooser: st.chooser,
    spCalls: await page.evaluate(() => window.__spCalls || 0),
    clickNoop: await page.evaluate(() => window.__clickNoop || 0),
    seqDelta: (await page.evaluate(() => window.__mochiPickArmed ? window.__mochiPickArmed.seq : 0)) - seqBefore,
    toastTxt: await page.evaluate(() => { const t = document.querySelector('.toast, #toast, .mochi-toast'); return t ? t.textContent : ''; }),
    setFilesErr: st.setFilesErr
  };
}

// B1 联系人头像：showPicker 腿弹 1 次 + 真图全链路落库 + 行回显
const b1 = await tapRow('#cs-avatar-partner', true);
ok(b1.chooser === 1, 'B1a 联系人头像：顽固内核（label 缺失＋click 被无视）下选择器经 showPicker 腿恰好弹 1 次（HEAD=0＝用户看到的「点击无反应」）', 'chooser=' + b1.chooser + ' sp=' + b1.spCalls + ' noop=' + b1.clickNoop + ' ' + (b1.setFilesErr || ''));
ok(b1.seqDelta === 1, 'B1b 每次点按 guard 恰好武装一次（seq +1；双绑/双开哨兵）', 'seqDelta=' + b1.seqDelta);
const b1ui = await page.evaluate(() => (document.getElementById('cs-avatar-partner-val') || {}).textContent || '');
ok(String(b1ui).indexOf('已设置') >= 0, 'B1c 真图经 showPicker 腿落库、设置行回显「已设置」（全链路不断）', 'ui=[' + b1ui + ']');
ok(String(b1.toastTxt).indexOf('相册没能打开') < 0, 'B1d 未误报兜底失败提示（第三条腿成功时不打扰）', 'toast=[' + b1.toastTxt + ']');

// B2 我的头像：showPicker 腿弹 1 次
const b2 = await tapRow('#cs-avatar-user', false);
ok(b2.chooser === 1, 'B2a 我的头像：同款顽固内核下选择器恰好弹 1 次', 'chooser=' + b2.chooser + ' sp=' + b2.spCalls + ' noop=' + b2.clickNoop);
ok(b2.seqDelta === 1, 'B2b guard 恰好武装一次', 'seqDelta=' + b2.seqDelta);

ok(st.jsErrors.length === 0, 'Z 全程零 JS 异常', JSON.stringify(st.jsErrors.slice(0, 3)));

await browser.close();
server.close();
console.log('\n== 头像第三条激活腿（顽固内核仿真）: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);

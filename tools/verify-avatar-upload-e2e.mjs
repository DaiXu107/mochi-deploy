// #813 头像上传端到端验证（WebKit＝iOS Safari 同引擎 / Chromium＝安卓 Chrome 系）
// 立项（用户 2026-09-19 iPhone 16 Pro + Safari 实报「头像上传无反应，一直是默认头像」，
//   并强调「其他设备型号也有出现，不要覆盖式修补导致跨机型反复」）。
// 根因（零机型分支）：chat-settings.js 把「武装回调 headCb」写在 mochiFilePickGuard 的 onMiss
//   兜底里 ⇒ 凡是原生 label 转发成功的内核（WebKit/Blink）guard 判定「已弹出」→ onMiss 不跑
//   → headCb 恒 null → 选择器开了、图也选了，change 里 `if (cb) cb(data)` 静默丢弃。
//   只有国产内核（label 不转发、走 JS 兜底）才「恰好能用」＝按机型时好时坏的形状。
// 本脚本的判据＝**端到端不变量**：真实手指点按 → 系统选择器真的弹出（且只弹一次）→ 真的选了一张图
//   → 数据真的落库。既有 verify-file-pick-* 只测「激活路径形态」，测不出「弹了但没接线」这一类，
//   所以本族才会一次次「修好一条路、另一条形同虚设」。两条激活路径都跑：
//   · label 转发正常（iOS Safari / Chrome / Edge 等绝大多数内核）
//   · label 被拦截（国产内核实况，#756 那一路径）——保证本轮修复不把另一族设备修回归。
// 用法：node build.mjs && node tools/verify-avatar-upload-e2e.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-avatar-upload-e2e.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, chromium } from 'playwright';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const ONLY = (process.env.MOCHI_E2E_ENGINES || 'webkit,chromium').split(',').filter(Boolean);
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

// 64×64 不透明 PNG（走真选择器投递＝change→FileReader→压缩→落库全链路）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbMzwzQAAAAAAAAAAAAAAAAAAOAvnTMAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');

async function boot(launcher, blockLabel) {
  const browser = await launcher.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, jsErrors: [] };
  page.on('filechooser', async (fc) => {
    st.chooser++;
    try { await fc.setFiles({ name: 'av.png', mimeType: 'image/png', buffer: PNG }); } catch (e) { st.setFilesErr = e.message; }
  });
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 160)));
  if (blockLabel) {
    await page.addInitScript(() => {
      document.addEventListener('click', (e) => {
        try { if (e.target && e.target.closest && e.target.closest('label[data-file-pick-for]')) e.preventDefault(); } catch (x) {}
      }, true);
    });
  }
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  });
  await page.waitForTimeout(900);
  return { browser, ctx, page, st };
}
async function goto(page, pid, tabSel) {
  await page.evaluate((id) => {
    document.querySelectorAll('.page').forEach((p) => { if (!p.hidden) p.hidden = true; });
    const t = document.getElementById(id); if (t) t.hidden = false;
  }, pid);
  await page.waitForTimeout(350);
  if (tabSel) { await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); }, tabSel); await page.waitForTimeout(350); }
  // 开屏横幅类弹窗会整屏盖住命中区：测点前压掉（只改显示，不删节点，避免打断 openModal 自身状态）
  await page.evaluate(() => { const m = document.getElementById('modal-mask'); if (m && !m.hidden) { m.style.setProperty('display', 'none', 'important'); } });
}
// 真实手指点按一次入口，返回「弹了几次选择器」与点按后 localStorage 快照
async function tapOnce(page, st, sel) {
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) { if (/avatar/.test(k)) localStorage.removeItem(k); } });
  st.chooser = 0;
  const geo = await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return { err: 'no-el' };
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return { cx, cy, w: r.width, h: r.height, onLabel: !!(hit && hit.closest && hit.closest('label[data-file-pick-for]')), inTarget: !!(hit && b.contains(hit)) };
  }, sel);
  if (geo.err) return { err: geo.err };
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(2600);
  const after = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/avatar-(user|partner)$|cs-avatar-(user|partner)$/.test(k)) o[k.replace(/^.*:/, '')] = (localStorage.getItem(k) || '').length; }
    o.__uiUser = (document.getElementById('cs-avatar-user-val') || {}).textContent || '';
    o.__uiPartner = (document.getElementById('cs-avatar-partner-val') || {}).textContent || '';
    o.__ring = !!document.querySelector('#avatar-user .ring img');
    return o;
  });
  return { chooser: st.chooser, geo, after, setFilesErr: st.setFilesErr || '' };
}

const CASES = [
  { id: 'cs-avatar-user', name: '聊天设置·我的头像', page: 'page-chat-settings', tab: '#cs-tabs .them-tab[data-tab="function"]', sel: '#cs-avatar-user', key: 'cs-avatar-user' },
  { id: 'cs-avatar-partner', name: '聊天设置·联系人头像', page: 'page-chat-settings', tab: '#cs-tabs .them-tab[data-tab="function"]', sel: '#cs-avatar-partner', key: 'cs-avatar-partner' },
  { id: 'avatar-user', name: '桌面·我的头像（对照入口）', page: 'page-phone', tab: null, sel: '#avatar-user', key: 'avatar-user' },
  { id: 'avatar-partner', name: '桌面·TA的头像（对照入口）', page: 'page-phone', tab: null, sel: '#avatar-partner', key: 'avatar-partner' },
];

for (const [engName, launcher] of [['WebKit(Safari 引擎)', webkit], ['Chromium', chromium]]) {
  if (!ONLY.includes(engName === 'WebKit' ? 'webkit' : 'chromium') && !(engName.startsWith('WebKit') ? ONLY.includes('webkit') : ONLY.includes('chromium'))) continue;
  for (const [modeName, blockLabel] of [['label 转发正常（iOS Safari/Chrome 实况）', false], ['label 被拦截（国产内核实况）', true]]) {
    console.log('\n== ' + engName + ' · ' + modeName + ' ==');
    const { browser, st, page } = await boot(launcher, blockLabel);
    for (const c of CASES) {
      await goto(page, c.page, c.tab);
      const r = await tapOnce(page, st, c.sel);
      if (r.err) { ok(false, c.name + ' 入口不可点', r.err); continue; }
      ok(r.geo.w > 0 && (r.geo.onLabel || r.geo.inTarget), c.name + '：点按命中入口自身', JSON.stringify(r.geo));
      ok(r.chooser === 1, c.name + '：选择器真的弹出且只弹一次（0＝点了没反应，≥2＝双开）', 'chooser=' + r.chooser + ' ' + (r.setFilesErr || ''));
      ok(Number(r.after[c.key] || 0) > 100, c.name + '：选完图真的写进存储（#813 本体＝选择器开了但回调没武装，图被静默丢弃）', c.key + '=' + JSON.stringify(r.after[c.key]));
      if (c.key === 'cs-avatar-user') ok(/已设置/.test(r.after.__uiUser), c.name + '：设置行回显「已设置」', JSON.stringify(r.after.__uiUser));
      if (c.key === 'cs-avatar-partner') ok(/已设置/.test(r.after.__uiPartner), c.name + '：设置行回显「已设置」', JSON.stringify(r.after.__uiPartner));
      if (c.key === 'avatar-user') ok(r.after.__ring === true, c.name + '：桌面圆圈真的换成图片', JSON.stringify(r.after.__ring));
    }
    ok(st.jsErrors.length === 0, 'Z ' + engName + '/' + (blockLabel ? 'block' : 'label') + ' 全程零 JS 异常', JSON.stringify(st.jsErrors.slice(0, 3)));
    await browser.close();
  }
}
try { readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { /* 仅 SERVE_ROOT 校验 */ }
console.log('\n== 头像上传端到端（点按→弹选择器→真选图→落库）: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);

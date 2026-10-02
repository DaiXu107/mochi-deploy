// verify-991-avatar-tap-surface.mjs — #991 第九波「导入图片点不了 / 一直换不了头像」真·可点 input 层（常驻）
// 立项（用户 2026-09-21 红米 Note 9 Pro + 手机自带浏览器 MiuiBrowser 20.23 / Android12 / Chrome135 内核
//   实报「导入图片点不了、一直换不了头像」，并明说其他设备型号也有出现、要求不要覆盖式修补）。
// 根因（零机型分支）：前八波（#677 input 要挂文档 → #717 去 display:none → #738 加 label → #753 accept
//   前置 → #755 统一入口 → #756 label 早退反噬 → #813 武装时机 → #877 showPicker → #920 三腿单点）
//   修的都是「怎么把那个 1px、看不见的 sr-only input 激活起来」——三条腿全都依赖内核乐意执行我们的 JS：
//   ①label 转发 ②JS 合成 click() ③showPicker()。三条腿同时被无视时＝点了彻底没反应（不报错、不提示）。
// 修法：device.js 新增 window.mochiFilePickSurface(btn, opts)，在常驻入口节点内铺一层**有真实尺寸、
//   手指能直接落在上面**的 file input（透明但占位，不是 sr-only clip）——选择器由浏览器**原生默认动作**
//   弹出，不经过标签转发、也不经过任何合成事件；三腿在 guard/Fire 里探测到本次手势是 surface 点按即让路
//   （不双开）。本批铺到 4 个头像入口：桌面 avatar-user / avatar-partner、聊天设置 cs-avatar-user /
//   cs-avatar-partner；并修「装修模式下点桌面头像被卡片背景菜单吞掉」。
// 断言：①静态锚（单点实现/让路/四入口接线）；②**三条腿全被无视的内核**下，物理点按四个入口＝选择器
//   恰弹 1 次且真图落库（HEAD 基线 chooser=0＝用户所见「点了没反应」）；③昵称仍可点（#821 不被新层压住）；
//   ④装修模式下点桌面头像＝开选择器而不是弹卡片菜单；⑤零 JS 异常。
// 用法：node build.mjs && node tools/verify-991-avatar-tap-surface.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> 或 MOCHI_SERVE_ROOT=<目录> node tools/verify-991-avatar-tap-surface.mjs
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

// ===== ① 静态锚 =====
const dev = jsOf('device.js');
ok(dev.includes('window.mochiFilePickSurface = function (btn, opts) {'),
  'S1 单点实现 mochiFilePickSurface 在产物（删＝四个头像入口退回「全靠内核配合」的三腿）');
ok(dev.includes("input.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;outline:none;background:transparent;color:transparent;font-size:0;appearance:none;-webkit-appearance:none;cursor:pointer;z-index:0;';"),
  'S2 surface 层是可命中、有真实尺寸、opacity 仍为 1 的常驻 input（退回 opacity:0 / 1px / clip / display:none＝#717/#738 那族「不可见 input 拒绝激活」写法）');
ok(dev.includes("input.className = 'mochi-pick-surface';") && /mochi-pick-surface::file-selector-button/.test(jsOf('base.css')),
  'S2b 原生「选择文件」按钮由 CSS 藏掉（漏了＝入口上浮出一个原生按钮破相）');
ok(dev.includes('if (window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) { cleanup(); settled = true; return; }'),
  'S3 guard 探测 surface 点按后让路（删＝surface 与三腿各弹一次＝双开）');
ok(dev.includes('if (window.mochiFilePickSurfaceTap && window.mochiFilePickSurfaceTap()) return true;'),
  'S4 Fire 探测 surface 点按后让路（45 处统一入口/手写兜底同吃）');
ok(jsOf('personalize.js').includes("id: 'mochi-avatar-tap-' + id,"),
  'S5 桌面两个头像盒铺 surface（删＝用户报障入口回到「点了没反应」）');
ok(jsOf('personalize.js').includes("if (e.target.closest('.deco-avatar')) return;"),
  'S6 装修模式不再把头像区的点击吞成「卡片背景」菜单（删＝装修模式下换不了头像）');
const cs = jsOf('chat-settings.js');
ok((cs.match(/mochiFilePickSurface\(csA[pu], \{/g) || []).length === 2,
  'S7 聊天设置两行头像各铺一次 surface（#738 起的历史报障入口）');

// 64×64 不透明 PNG（走真选择器投递＝change→FileReader→压缩→落库全链路）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAm0lEQVR4nO3WMQ6CQBBR4Rfe3uAKCm/A3s7gDQnG0BFDQqKlcDDs/j8Eq0m+mbMzwzQAAAAAAAAAAAAAAAAAAOAvnTMAAAAAAAAAAAAAAAAAAOAvJ3QCJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACJ3ACf+0F0V6C9lDLmNgAAAAASUVORK5CYII=', 'base64');

// 顽固内核仿真（同 #877/#920 口径，再加一条：连 showPicker 也抛错）——
// 三条腿全被无视：①label 转发被吞 ②JS 合成 click() 无效 ③showPicker() 抛 NotAllowedError。
// 这正是「不报错、不弹窗、点了没反应」的内核形态；唯一还能通的只有「手指直接点真 input」。
async function boot(hostile) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { chooser: 0, jsErrors: [], setFilesErr: '' };
  page.on('filechooser', async (fc) => {
    st.chooser++;
    try { await fc.setFiles({ name: 'av.png', mimeType: 'image/png', buffer: PNG }); } catch (e) { st.setFilesErr = e.message; }
  });
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  // 定期备份提醒弹窗（pwa.js，产品功能）会在开屏消失后弹并盖住桌面目标：本脚本只测头像入口，
  // 先在 init 阶段写它的冷却键（等价于「今日已提醒过」），避免它中途冒出来干扰点击命中。
  await page.addInitScript(() => { try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {} });
  if (hostile) {
    await page.addInitScript(() => {
      document.addEventListener('click', (e) => {
        try { if (e.target && e.target.closest && e.target.closest('label[data-file-pick-for]')) e.preventDefault(); } catch (x) {}
      }, true);
      try { HTMLInputElement.prototype.showPicker = function () { throw new Error('NotAllowedError'); }; } catch (e) {}
      const raw = HTMLElement.prototype.click;
      HTMLElement.prototype.click = function () { try { if (this && this.tagName === 'INPUT' && this.type === 'file') return; } catch (e) {} return raw.apply(this, arguments); };
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
  return { browser, page, st };
}
async function showPage(page, pid, tabSel) {
  await page.evaluate(([id, ts]) => {
    document.querySelectorAll('.page').forEach((p) => { if (!p.hidden) p.hidden = true; });
    const t = document.getElementById(id); if (t) { t.hidden = false; t.style.removeProperty('display'); }
    if (ts) { const tab = document.querySelector(ts); if (tab) tab.click(); }
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    const m = document.getElementById('modal-mask'); if (m && !m.hidden) m.hidden = true;
  }, [pid, tabSel]);
  await page.waitForTimeout(400);
}
// 真实点按一次（返回命中链 + chooser 次数 + 点按后存储/界面状态）
async function tap(page, st, sel, { settle = 2400 } = {}) {
  await page.evaluate((s) => {
    // 与本批无关、但会盖住桌面目标的浮层先收掉（都不是被测对象）：
    //  · #daily-greet ＝「TA 的今日留言」横幅（calendar.js，fixed 顶部 z-index:89、显示 8 秒、点了开日历＝
    //    产品既定行为，不在本批范围）——它横在桌面上方会挡住头像命中；
    //  · #modal-mask ＝别的弹窗（如备份提醒）打开时点它会先关弹窗而不是点头像。
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    const m = document.getElementById('modal-mask'); if (m && !m.hidden) m.hidden = true;
    const b = document.querySelector(s); if (b) b.scrollIntoView({ block: 'center' });
  }, sel);
  const geo = await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b) return { err: 'no-el' };
    const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const desc = (el) => el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (el.getAttribute && el.getAttribute('data-file-pick-surface') ? '[surface]' : '')) : 'null';
    return { cx, cy, w: Math.round(r.width), h: Math.round(r.height), hit: desc(document.elementFromPoint(cx, cy)), stack: document.elementsFromPoint(cx, cy).slice(0, 4).map(desc) };
  }, sel);
  if (geo.err) return geo;
  st.chooser = 0;
  await page.mouse.click(geo.cx, geo.cy);
  await page.waitForTimeout(settle);
  const after = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/:(avatar-(user|partner)|cs-avatar-(user|partner))$/.test(k)) o[k.replace(/^.*:/, '')] = (localStorage.getItem(k) || '').length;
    }
    o.ringUser = !!document.querySelector('#avatar-user .ring img');
    o.ringPartner = !!document.querySelector('#avatar-partner .ring img');
    o.uiUser = ((document.getElementById('cs-avatar-user-val') || {}).textContent || '');
    o.uiPartner = ((document.getElementById('cs-avatar-partner-val') || {}).textContent || '');
    o.modalTitle = ((document.querySelector('#modal-mask .modal-title') || {}).textContent || '');
    return o;
  });
  return { ...geo, chooser: st.chooser, after, setFilesErr: st.setFilesErr };
}
const short = (r) => r.err || ('hit=' + r.hit + ' stack=' + JSON.stringify(r.stack) + ' chooser=' + r.chooser + ' keys=' + JSON.stringify(r.after && (r.after['avatar-user'] || r.after['avatar-partner'] || r.after['cs-avatar-user'] || r.after['cs-avatar-partner'])) + (r.setFilesErr ? ' ' + r.setFilesErr : ''));

// ===== ② 三条腿全被无视的内核：四个头像入口物理点按必须弹选择器且真落库 =====
{
  const { browser, page, st } = await boot(true);
  // 桌面「我」的头像
  const d1 = await tap(page, st, '#avatar-user');
  ok(d1.chooser === 1, 'B1 桌面 我的头像：三条腿全废的内核下选择器恰弹 1 次（HEAD＝0＝用户所见「点了没反应」）', short(d1));
  ok(Number(d1.after['avatar-user'] || 0) > 100 && d1.after.ringUser === true,
    'B2 桌面 我的头像：真选图后端到端落库并显示（不是「弹了但结果被丢弃」）', 'len=' + d1.after['avatar-user'] + ' ring=' + d1.after.ringUser);
  // 桌面「TA」的头像
  const d2 = await tap(page, st, '#avatar-partner');
  ok(d2.chooser === 1, 'B3 桌面 TA 的头像：选择器恰弹 1 次', short(d2));
  ok(Number(d2.after['avatar-partner'] || 0) > 100 && d2.after.ringPartner === true, 'B4 桌面 TA 的头像：真选图后端到端落库', 'len=' + d2.after['avatar-partner']);
  // 昵称：新层不得压住它（#821 不许回归）
  await tap(page, st, '#avatar-user .lbl', { settle: 700 });
  const lbl = await page.evaluate(() => {
    const m = document.getElementById('modal-mask');
    const t = document.querySelector('#modal-mask .modal-title');
    return { open: !!(m && !m.hidden), title: t ? t.textContent : '' };
  });
  ok(lbl.open && /昵称|头像/.test(lbl.title), 'B5 桌面头像昵称仍可点（#821 不被新铺的 surface 层压住）', JSON.stringify(lbl));
  // 聊天设置两行头像
  await showPage(page, 'page-chat-settings', '#cs-tabs .them-tab[data-tab="function"]');
  const c1 = await tap(page, st, '#cs-avatar-partner');
  ok(c1.chooser === 1, 'B6 聊天设置 联系人头像行：选择器恰弹 1 次', short(c1));
  ok(/已设置/.test(c1.after.uiPartner) && Number(c1.after['cs-avatar-partner'] || 0) > 100,
    'B7 聊天设置 联系人头像行：行回显「已设置」＋落库', JSON.stringify(c1.after.uiPartner));
  const c2 = await tap(page, st, '#cs-avatar-user');
  ok(c2.chooser === 1, 'B8 聊天设置 我的头像行：选择器恰弹 1 次', short(c2));
  ok(/已设置/.test(c2.after.uiUser), 'B9 聊天设置 我的头像行：行回显「已设置」', JSON.stringify(c2.after.uiUser));
  ok(st.jsErrors.length === 0, 'Z1 顽固内核全程零 JS 异常', JSON.stringify(st.jsErrors.slice(0, 3)));
  await browser.close();
}

// ===== ③ 装修模式：点桌面头像＝开选择器，不再被「点卡片设背景」吞掉 =====
{
  const { browser, page, st } = await boot(false);
  await showPage(page, 'page-phone', null);
  await page.evaluate(() => {
    const phone = document.getElementById('page-phone');
    if (phone) phone.classList.add('decor-on');
    document.querySelectorAll('.app-grid').forEach((g) => g.classList.add('editing'));
    const bar = document.getElementById('decor-bar'); if (bar) bar.hidden = false;
  });
  await page.waitForTimeout(300);
  const r = await tap(page, st, '#avatar-user');
  ok(r.chooser === 1, 'B10 装修模式下点桌面头像＝照常弹选择器（HEAD＝0 且弹出「纪念日卡设置」菜单）', short(r));
  ok(!/纪念日卡/.test(r.after.modalTitle), 'B11 装修模式下点头像不再弹「卡片背景」菜单', JSON.stringify(r.after.modalTitle));
  ok(st.jsErrors.length === 0, 'Z2 装修模式全程零 JS 异常', JSON.stringify(st.jsErrors.slice(0, 3)));
  await browser.close();
}

console.log('\n== verify-991 头像/导入图片「真·可点 input」层: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail === 0 ? 0 : 1);

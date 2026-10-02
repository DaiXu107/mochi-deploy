// verify-1541-add-contact-desk-react.mjs — #1541「添加联系人 桌面无反应」行为回归
// 两个根因两张断言：
//   A. 抢屏守卫——联系人管理面板（自绘 #contact-manager，不占 #modal-mask）开着时，
//      存储修复引导（storage-guide）与备份提醒（pwa）不得抢开全站单例弹窗顶掉用户
//      正在操作的层；面板关闭后放行。守卫＝device.js window.mochiOverlayBusy()。
//   B. 添加反馈——createContact 落 lbl-partner（桌面圆签当场显示新名，不再恒「TA」
//      ＝与默认桌面视觉无差）＋添加成功 toast「已创建「X」的桌面，已为你切换」。
// 用法（绿侧＝缺省读本仓根，需先 node build.mjs）：node tools/verify-1541-add-contact-desk-react.mjs
// 红侧（纯基线，断言 A 观察窗翻红＋B 的 toast/lbl 翻红；注册表/切换两条为控制项仍绿）：
//   mkdir ../mochi-red1541 && git archive origin/main | tar -x -C ../mochi-red1541
//   node tools/verify-1541-add-contact-desk-react.mjs --root ../mochi-red1541
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : dflt;
}
const root = opt('--root', normalize(dirname(fileURLToPath(import.meta.url)) + '/..'));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const results = [];
function T(name, ok, detail) { results.push([name, !!ok, detail || '']); }

const GUIDE_TITLE = '更新完成 · 存储修复引导';
const BACKUP_TITLE = '数据会被自动清空 · 备份提醒';
const GUIDE_ID = '1250';
const D = 864e5;

async function newSeededPage(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript((s) => {
    try {
      localStorage.setItem('xy-home-v2:age-confirmed', JSON.stringify({ t: Date.now(), v: '2026-09-30' }));
      localStorage.setItem('xy-home-v2:storage-guide-shown', s.guideFlag);
      if (s.lastBackup) localStorage.setItem('xy-home-v2:__last-backup', String(Date.now() - s.lastBackup));
      if (s.lastRemind) localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now() - s.lastRemind));
    } catch (e) {}
  }, seed);
  return { ctx, page };
}

async function bypassSplash(page) {
  await page.evaluate(() => {
    const s = document.getElementById('splash');
    if (s) s.classList.add('hide'); // 等价 finishEnter 的 hide()（.splash.hide = display:none）
  });
  await page.waitForTimeout(300);
}

// modal-mask 当前标题（关着返回 ''）
const modalTitleFn = () => {
  const m = document.getElementById('modal-mask');
  if (!m || m.hidden || getComputedStyle(m).display === 'none') return '';
  const t = document.getElementById('modal-title');
  return t ? t.textContent : '';
};

const browser = await chromium.launch({ headless: true });

// ---------- Phase A：面板开着时不抢屏、关后放行（两场景隔离，避免双弹窗竞速） ----------
// 场景公用的「面板开着→观察→关→放行」流程
async function guardScene(page, label, stealTitle) {
  await page.evaluate(() => window.openContactManager());
  await page.waitForTimeout(300);
  const mgrOpen = await page.evaluate(() => {
    const cm = document.getElementById('contact-manager');
    return !!cm && getComputedStyle(cm).display !== 'none';
  });
  T(label + ' 管理面板已打开', mgrOpen);
  const busyOpen = await page.evaluate(() => window.mochiOverlayBusy && window.mochiOverlayBusy());
  T(label + ' mochiOverlayBusy() 面板开＝true', busyOpen === true, 'got ' + busyOpen);

  // 观察窗 8s：目标弹窗不得抢开（守卫让路）
  let stole = '';
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const t = await page.evaluate(modalTitleFn);
    if (t === stealTitle) { stole = t; break; }
  }
  T(label + ' 面板开着 8s 内不抢屏', !stole, stole ? '被顶：' + stole : '');

  await page.evaluate(() => {
    const cm = document.getElementById('contact-manager');
    if (cm) { cm.style.display = 'none'; cm.hidden = true; }
  });
  const busyClosed = await page.evaluate(() => window.mochiOverlayBusy && window.mochiOverlayBusy());
  T(label + ' mochiOverlayBusy() 面板关＝false', busyClosed === false, 'got ' + busyClosed);

  // 放行窗 14s：目标弹窗应弹出（或备份顶部条兜底形态）
  let released = '';
  for (let i = 0; i < 28; i++) {
    await page.waitForTimeout(500);
    const t = await page.evaluate(modalTitleFn);
    if (t === stealTitle) { released = t; break; }
    if (stealTitle === BACKUP_TITLE) {
      const bar = await page.evaluate(() => { const b = document.getElementById('backup-remind-bar'); return !!b && !b.hidden && b.getClientRects().length > 0; });
      if (bar) { released = BACKUP_TITLE + '(bar)'; break; }
    }
  }
  T(label + ' 关面板后放行弹出', released === stealTitle, 'released=' + (released || '（14s 内无）'));
}

{
  // 场景 A-backup：引导已确认不弹（flag=本版ID），备份提醒 8 天未备必弹
  const { ctx, page } = await newSeededPage(browser, { guideFlag: GUIDE_ID, lastBackup: 8 * D, lastRemind: 0 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await bypassSplash(page);
  await guardScene(page, 'A-bk', BACKUP_TITLE);
  T('A-bk 零页面错误', errs.length === 0, errs.slice(0, 3).join('|'));
  await ctx.close();
}
{
  // 场景 A-guide：引导 flag=旧版ID必弹；备份 1 小时前刚备（due=false）不参与
  const { ctx, page } = await newSeededPage(browser, { guideFlag: '1249', lastBackup: 1 * 36e5, lastRemind: 0 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await bypassSplash(page);
  await guardScene(page, 'A-gd', GUIDE_TITLE);
  T('A-gd 零页面错误', errs.length === 0, errs.slice(0, 3).join('|'));
  await ctx.close();
}

// ---------- Phase B：添加成功 toast + 圆签立即显示新名 ----------
{
  const { ctx, page } = await newSeededPage(browser, { guideFlag: GUIDE_ID, lastBackup: 0, lastRemind: 0 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await bypassSplash(page);

  await page.evaluate(() => window.openContactManager());
  await page.waitForTimeout(300);
  await page.locator('button', { hasText: '+ 添加联系人 / 桌面' }).last().click();
  await page.waitForTimeout(400);
  const modalUp = await page.evaluate(modalTitleFn);
  T('B1 输入弹窗可见（标题=新建联系人）', modalUp === '新建联系人', 'got ' + JSON.stringify(modalUp));

  const NAME = '验证联系人甲';
  await page.evaluate((n) => {
    const input = document.getElementById('modal-input');
    const ceBox = input.parentNode.querySelector('.ce-box[data-for="modal-input"]');
    if (ceBox) { ceBox.textContent = n; ceBox.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    else { input.value = n; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }, NAME);
  await page.waitForTimeout(200);
  await page.locator('#modal-ok').click();
  await page.waitForTimeout(700);

  const after = await page.evaluate((n) => ({
    toast: (document.getElementById('cc-toast') || {}).textContent || '',
    lbl: document.getElementById('lbl-partner') ? document.getElementById('lbl-partner').textContent : '',
    cid: window.__activeCid || 'default',
    inReg: (window.getContacts() || []).some(c => c.name === n),
    lblKey: (() => { try { return window.xyStore('xy-home-v2:' + (window.__activeCid || '')).get('lbl-partner'); } catch (e) { return 'ERR'; } })(),
  }), NAME);
  T('B2 toast 点名已切换', after.toast.indexOf('已创建「' + NAME + '」的桌面') === 0 && after.toast.indexOf('已为你切换') > 0, 'got=' + JSON.stringify(after.toast));
  T('B3 桌面圆签立即显示新名（不再恒「TA」）', after.lbl === NAME, 'got=' + JSON.stringify(after.lbl));
  T('B4 lbl-partner 键已落库', after.lblKey === NAME, 'got=' + JSON.stringify(after.lblKey));
  T('B5 注册表含新联系人（控制项，红侧应仍绿）', after.inReg);
  T('B6 已切换到新桌面（控制项，红侧应仍绿）', after.cid !== 'default');
  T('B7 Phase B 零页面错误', errs.length === 0, errs.slice(0, 3).join('|'));
  await ctx.close();
}

// ---------- Phase C：系统标记键挡迁移 + 存量副本回收（#1541f） ----------
{
  const { ctx, page } = await newSeededPage(browser, { guideFlag: GUIDE_ID, lastBackup: 0, lastRemind: 0 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // 种根键（现值）＋ default 副本（修复前误迁产生的存量）
  await page.addInitScript(() => {
    try {
      localStorage.setItem('xy-home-v2:default:age-confirmed', JSON.stringify({ t: 1700000000000, v: '2026-09-30' }));
      localStorage.setItem('xy-home-v2:default:storage-guide-shown', '1250');
    } catch (e) {}
  });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(4500); // migrateLegacy 在数据就绪后跑，等它落地
  const c = await page.evaluate(() => ({
    ageRoot: localStorage.getItem('xy-home-v2:age-confirmed'),
    guideRoot: localStorage.getItem('xy-home-v2:storage-guide-shown'),
    ageCopy: localStorage.getItem('xy-home-v2:default:age-confirmed'),
    guideCopy: localStorage.getItem('xy-home-v2:default:storage-guide-shown'),
  }));
  T('C1 age-confirmed 根键未被迁移删掉', c.ageRoot !== null, 'got ' + JSON.stringify(c.ageRoot));
  T('C2 storage-guide-shown 根键未被迁移删掉', c.guideRoot === GUIDE_ID, 'got ' + JSON.stringify(c.guideRoot));
  T('C3 age-confirmed 存量副本已回收', c.ageCopy === null, 'got ' + JSON.stringify(c.ageCopy));
  T('C4 storage-guide-shown 存量副本已回收', c.guideCopy === null, 'got ' + JSON.stringify(c.guideCopy));
  T('C5 Phase C 零页面错误', errs.length === 0, errs.slice(0, 3).join('|'));
  await ctx.close();
}

await browser.close();
server.close();

const pass = results.filter(r => r[1]).length;
const fail = results.filter(r => !r[1]).length;
for (const [name, ok, detail] of results) {
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail && !ok ? ' —— ' + detail : ''));
}
console.log(`\nverify-1541：通过 ${pass} / 断言失败 ${fail}（root=${root === normalize(dirname(fileURLToPath(import.meta.url)) + '/..') ? '本仓' : root}）`);
process.exit(fail ? 1 : 0);

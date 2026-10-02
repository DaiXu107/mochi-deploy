// #351 桌面装修图标摆放行为断言：跨页拖动重进不回原位 / 脏数据自愈 / 新页自带网格 /
//      新页图标重进不丢 / 删页图标归还默认页 / 页内顺序不回归（#265 同款守护）/
//      装修模式编辑态覆盖新页网格且可弹图标菜单。
// 用法：node tools/verify-desk-icon-place.mjs [页面.html | --tmp]
//      默认打 index.html（需先构建）；--tmp = 从 src 临时拼装完整页免构建验证（不写产物）。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let tmpPage = null;
async function resolveTarget() {
  const arg = process.argv[2];
  if (arg !== '--tmp') return (/^https?:/.test(arg || '') ? arg : pathToFileURL(arg || 'index.html').href);
  // ---- 从 src 拼装完整验证页（template + 全量 css/js，按 build.mjs 同序，不压缩不写产物） ----
  const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cssList = Function('"use strict";return ' + buildSrc.match(/const cssFiles = (\[[^\]]+\]);/)[1])();
  const jsList = Function('"use strict";return ' + buildSrc.match(/const jsFiles = (\[[^\]]+\]);/)[1])();
  let tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  const css = cssList.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const js = jsList.map(f => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n;\n');
  if (tpl.indexOf('/*__STYLES__*/') >= 0) tpl = tpl.replace('/*__STYLES__*/', () => css);
  else tpl = tpl.replace('</head>', () => '<style>' + css + '</style></head>');
  if (tpl.indexOf('/*__SCRIPTS__*/') >= 0) tpl = tpl.replace('/*__SCRIPTS__*/', () => js);
  else tpl = tpl.replace('</body>', () => '<script>' + js + '</scr' + 'ipt></body>');
  tmpPage = join(root, 'tmp-351-desk-page.html');
  writeFileSync(tmpPage, tpl);
  return pathToFileURL(tmpPage).href;
}

const url = await resolveTarget();
const browser = await chromium.launch();
const errors = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
// 每场景一颗独立 page：addInitScript 在任何页面脚本前清空本项目的 LS 并写入场景种子
async function scenario(name, seed, fn) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  await page.addInitScript((seed) => {
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('xy-home-v2:') === 0) kill.push(k); }
      kill.forEach(k => localStorage.removeItem(k));
      Object.keys(seed || {}).forEach(k => localStorage.setItem('xy-home-v2:default:' + k, seed[k]));
    } catch (e) {}
  }, seed);
  await page.goto(url);
  await page.waitForFunction(() => !!window.__deskIconDebug, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600); // ensureP3 等 50ms 级启动尾巴
  console.log('· ' + name);
  try { await fn(page); } catch (e) { check(name + '（异常）', false, String(e && e.message || e)); }
  await page.close();
}
const gridOf = (page, key) => page.evaluate((k) => {
  const n = document.querySelector('.app[data-desk-widget="' + k + '"]');
  const g = n && n.closest('.app-grid');
  return { grid: g ? g.dataset.app : null, inPool: !!(n && n.closest('#desk-widget-pool')), idx: n && g ? Array.prototype.indexOf.call(g.querySelectorAll('.app'), n) : -1 };
}, key);

// S1 基线：无装修数据，模板默认排布
await scenario('S1 基线（count=3 无布局）', { 'desk-page-count': '3' }, async (page) => {
  const r = await gridOf(page, 'app-calendar');
  check('S1 无数据时图标留模板默认页', r.grid === 'main' && !r.inPool, JSON.stringify(r));
  const slides = await page.evaluate(() => document.querySelectorAll('#desktop-pages .page-slide').length);
  check('S1 页数=3', slides === 3, 'slides=' + slides);
});

// S2 修复核心：跨页顺序数组启动归位（修前图标回原位）
await scenario('S2 跨页持久化（order-p3 认领 app-calendar）', { 'desk-page-count': '3', 'app-icon-order-p3': '["calendar"]' }, async (page) => {
  const r = await gridOf(page, 'app-calendar');
  check('S2 图标归入第三页网格', r.grid === 'p3' && !r.inPool, JSON.stringify(r));
  check('S2 落在记录位（第 0 格）', r.idx === 0, 'idx=' + r.idx);
});

// S3 脏数据自愈：新旧两页数组同时认领（旧版只写目标页的残留），非默认页胜出+源页清盘
await scenario('S3 脏数据自愈（main+p3 同时认领）', { 'desk-page-count': '3', 'app-icon-order-main': '["calendar"]', 'app-icon-order-p3': '["calendar"]' }, async (page) => {
  const r = await gridOf(page, 'app-calendar');
  check('S3 非默认页认领胜出', r.grid === 'p3' && !r.inPool, JSON.stringify(r));
  const lsMain = await page.evaluate(() => localStorage.getItem('xy-home-v2:default:app-icon-order-main'));
  check('S3 源页脏条目已清盘落盘', lsMain !== null && JSON.parse(lsMain).indexOf('calendar') < 0, lsMain);
});

// S4 新页自带图标网格 + 空网格不遮页面提示
await scenario('S4 新页 pg* 网格（count=4）', { 'desk-page-count': '4' }, async (page) => {
  const r = await page.evaluate(() => {
    const slides = document.querySelectorAll('#desktop-pages .page-slide');
    const s4 = slides[3];
    const g = s4 && s4.querySelector('.app-grid');
    const hint = s4 && s4.querySelector('.desk-page-hint');
    return { n: slides.length, has: !!g, gid: g ? g.dataset.app : null, wid: g ? g.getAttribute('data-desk-widget') : null, hintShow: hint ? hint.style.display !== 'none' : false };
  });
  check('S4 页数=4', r.n === 4, 'n=' + r.n);
  check('S4 第四页自带 4 列网格（pg3）', r.has && r.gid === 'pg3' && r.wid === 'pg3', JSON.stringify(r));
  check('S4 空网格不算内容（页面提示仍显示）', r.hintShow);
});

// S5 新页放图标重进不丢（修前独立竖排且丢/或回原位）
await scenario('S5 新页图标持久化（order-pg3 认领 app-mail）', { 'desk-page-count': '4', 'app-icon-order-pg3': '["mail"]' }, async (page) => {
  const r = await gridOf(page, 'app-mail');
  check('S5 图标在新页网格内（4 列排版非独立竖排）', r.grid === 'pg3' && !r.inPool, JSON.stringify(r));
});

// S6 删除页：pg* 网格就地解散，图标归还模板默认页（不再随池隐身）
await scenario('S6 删页归还（count 4→3）', { 'desk-page-count': '4', 'app-icon-order-pg3': '["mail"]' }, async (page) => {
  const before = await gridOf(page, 'app-mail');
  check('S6 前置：图标在 pg3', before.grid === 'pg3', JSON.stringify(before));
  await page.evaluate(() => {
    localStorage.setItem('xy-home-v2:default:desk-page-count', '3');
    window.__deskIconDebug.buildDeskPages();
  });
  await page.waitForTimeout(150);
  const after = await gridOf(page, 'app-mail');
  check('S6 删页后图标归还默认网格 main', after.grid === 'main' && !after.inPool, JSON.stringify(after));
  const lsPg = await page.evaluate(() => localStorage.getItem('xy-home-v2:default:app-icon-order-pg3'));
  check('S6 pg3 顺序键已清', lsPg === null, String(lsPg));
  const slides = await page.evaluate(() => document.querySelectorAll('#desktop-pages .page-slide').length);
  check('S6 页数收缩为 3', slides === 3, 'slides=' + slides);
});

// S7 页内顺序不回归（#265 能力守护）
await scenario('S7 页内顺序（order-main 全量数组）', { 'desk-page-count': '3', 'app-icon-order-main': '["mail","chat","home","feed","calendar","memory","divination","note"]' }, async (page) => {
  const r = await gridOf(page, 'app-mail');
  check('S7 mail 提到首页网格首位', r.grid === 'main' && r.idx === 0, JSON.stringify(r));
});

// S8 装修模式编辑态覆盖 pg* 网格 + 图标可弹设置菜单
await scenario('S8 装修模式（编辑态+图标菜单）', { 'desk-page-count': '4', 'app-icon-order-pg3': '["mail"]' }, async (page) => {
  await page.evaluate(() => { document.querySelectorAll('.page').forEach(p => p.hidden = (p.id !== 'page-set')); });
  await page.evaluate(() => { const r = document.getElementById('row-custom-icon'); if (r) r.click(); });
  await page.waitForTimeout(200);
  const editing = await page.evaluate(() => ({
    grids: document.querySelectorAll('.app-grid.editing').length,
    pg: !!document.querySelector('.app-grid[data-desk-widget="pg3"].editing'),
    decor: document.getElementById('page-phone').classList.contains('decor-on')
  }));
  check('S8 编辑态覆盖 pg* 网格', editing.grids >= 4 && editing.pg, JSON.stringify(editing));
  check('S8 装修模式已开启', editing.decor);
  const menu = await page.evaluate(() => {
    const app = document.querySelector('.app-grid[data-desk-widget="pg3"] .app[data-desk-widget="app-mail"]');
    app.click();
    const t = document.getElementById('modal-title');
    return t ? t.textContent : '';
  });
  await page.waitForTimeout(120);
  check('S8 新页网格图标弹「图标设置」菜单', menu === '图标设置', 'title=' + menu);
  await page.evaluate(() => { const c = document.getElementById('modal-cancel'); if (c) c.click(); });
});

// S9 反向红绿对照（对 HEAD 产物或旧页跑会红的断言在 S2/S3/S5/S6 已覆盖，这里查零报错）
check('全程零 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n结果: ' + pass + ' 过 / ' + fail + ' 败' + (tmpPage ? '（--tmp 拼装页）' : '（真实 index.html）'));
if (tmpPage) { try { unlinkSync(tmpPage); } catch (e) {} }
await browser.close();
process.exit(fail ? 1 : 0);

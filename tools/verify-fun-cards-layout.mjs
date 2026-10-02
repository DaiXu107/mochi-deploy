// ===== 验证 #239：互动功能字卡页列表被「使用概率」框挤没（小米15Pro/Chrome 报障） =====
// #132 概率框（13 行 stepper ~794px）插在 fc 页头部 + .card-list{flex:1;overflow-y:auto}
// 的 flex 最小尺寸归 0 → 列表压成 6px、首屏全在视口外=「字卡看不到了，点击没内容」。
// 修复：概率框移到列表下方（template.html）+ fc/dk 页整页滚动规则（chat-pages.css）。
// v3.42.x #444：概率框移回页顶默认折叠（用户报「概率位置太靠后看不到」）——F2/F2b/S3 改为
// 「在列表上方·默认折叠·展开栏可切换·展开后可达」，#239 的核心约束（首屏字卡列表可见、列表不塌缩）由 F1/F3 继续守。
// v3.26.513 复发（2026-09-07 OPPO Reno6 5G/雨见 报障「下面无法滑动显示字卡」）：
// 实为该机停留旧版 513（修复于 516）——同根因跨机型复发，S 段补 OPPO 同款 360×658
// 小屏+滚动行为断言（往下滑必须能滚出更多字卡+概率框可滚入视口），SERVE_DIR 支持红绿对照。
// 用法：node tools/verify-fun-cards-layout.mjs（需先 node build.mjs；SERVE_DIR=目录 可指向旧产物对照）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SERVE_DIR
  ? normalize(process.env.SERVE_DIR)
  : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const base = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 384, height: 808 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
await page.waitForTimeout(200);

// F1 打开 fc 页：首屏（视口内）存在可见字卡条目
const f1 = await page.evaluate(() => {
  document.getElementById('li-fun-cards').click();
  const vpH = innerHeight;
  const items = [...document.querySelectorAll('#fc-list .cc-item')];
  const inVp = items.filter(it => { const r = it.getBoundingClientRect(); return r.top < vpH && r.bottom > 0 && r.height > 0; });
  return { total: items.length, inVp: inVp.length, firstTop: items.length ? Math.round(items[0].getBoundingClientRect().top) : -1 };
});
check('F1 打开fc页首屏存在可见字卡条目', f1.total > 0 && f1.inVp > 0, JSON.stringify(f1));

// F2 概率框位置（v3.42.x #444 改版）：概率框在列表之前（DOM 序）且默认折叠、展开栏存在；
//   16 行俱全（13 分类 + #422 checkin/pomo/care）。#239 的核心约束=首屏仍是字卡列表由 F1 保证。
const f2 = await page.evaluate(() => {
  const box = document.getElementById('dcf-prob-box'), list = document.getElementById('fc-list');
  const bar = document.getElementById('dcf-prob-expander-row');
  if (!box || !list || !bar) return { ok: false };
  return {
    ok: !!(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) && box.hidden === true,
    rows: box.querySelectorAll('.gs-row').length
  };
});
check('F2 概率框在列表上方(DOM序)且默认折叠16行俱全', f2.ok && f2.rows === 16, JSON.stringify(f2));

// F2b 点展开栏：概率框展开可见、再点收起
const f2b = await page.evaluate(async () => {
  const bar = document.getElementById('dcf-prob-expander-row'), box = document.getElementById('dcf-prob-box');
  bar.click();
  const opened = box.hidden === false;
  bar.click();
  const closed = box.hidden === true;
  return { opened, closed };
});
check('F2b 展开栏点击切换概率框显隐', f2b.opened && f2b.closed, JSON.stringify(f2b));

// F3 列表不再塌缩（高度远大于修复前的 6px）
const f3 = await page.evaluate(() => {
  const el = document.getElementById('fc-list');
  return { rectH: Math.round(el.getBoundingClientRect().height), scrollH: el.scrollHeight, pageScrollH: document.getElementById('page-fun-cards').scrollHeight };
});
check('F3 fc列表高度不再塌缩(>200px)', f3.rectH > 200, JSON.stringify(f3));

// F4 点分组 chip 列表内容即时变化
const f4 = await page.evaluate(() => {
  const bar = document.getElementById('fc-groups-bar');
  const chips = [...bar.children];
  const before = document.getElementById('fc-list').querySelectorAll('.cc-item').length;
  if (chips.length < 2) return { ok: false };
  chips[1].click();
  return { ok: true, chips: chips.length, before };
});
await page.waitForTimeout(300);
const f4b = await page.evaluate(() => ({ after: document.getElementById('fc-list').querySelectorAll('.cc-item').length }));
check('F4 点分组chip列表内容变化(有反馈)', f4.ok && f4b.after > 0 && f4b.after !== f4.before, JSON.stringify(f4) + '→' + JSON.stringify(f4b));

// F5 tab 切换正常
const f5 = await page.evaluate(() => {
  const tab = document.querySelector('#fc-tabs .cc-tab[data-type="eat"]');
  if (!tab) return { ok: false };
  tab.click();
  return { ok: true };
});
await page.waitForTimeout(300);
const f5b = await page.evaluate(() => {
  const items = [...document.querySelectorAll('#fc-list .cc-item')];
  const r = items.length ? items[0].getBoundingClientRect() : null;
  return { n: items.length, firstTop: r ? Math.round(r.top) : -1 };
});
check('F5 切吃饭tab列表正常渲染', f5.ok && f5b.n > 0, JSON.stringify(f5b));

// F6 dc 页不回归（dc 页本就是「设置区高、整页滚动」设计——判据是列表不塌缩+页面可滚到列表，不判首屏）
const f6 = await page.evaluate(() => {
  document.getElementById('fc-back').click();
  const li = document.getElementById('li-default-cards');
  if (!li) return { ok: false };
  li.click();
  return { ok: true };
});
await page.waitForTimeout(400);
const f6b = await page.evaluate(() => {
  const list = document.getElementById('dc-list');
  const r = list.getBoundingClientRect();
  const items = list.querySelectorAll('.cc-item');
  return { n: items.length, rectH: Math.round(r.height), scrollH: list.scrollHeight, pageScrollH: document.getElementById('page-default-cards').scrollHeight, pageClientH: document.getElementById('page-default-cards').clientHeight };
});
check('F6 dc页列表不回归(不塌缩+整页可滚到列表)', f6.ok && f6b.n > 0 && f6b.rectH > 200 && f6b.pageScrollH > f6b.pageClientH, JSON.stringify(f6b));

// F7 静态锚：chat-pages.css 整页滚动规则 + dk 页同构
const f7css = readFileSync(join(root, 'src/css/chat-pages.css'), 'utf8');
check('F7 静态锚：fc/dk 整页滚动规则在源', f7css.indexOf('#page-fun-cards #fc-list { flex:0 0 auto; overflow:visible; min-height:0;') >= 0 && f7css.indexOf('#page-deskcheck #dk-list { flex:0 0 auto; overflow:visible; min-height:0;') >= 0);

// ===== S 段（v3.26.513 复发加固）：OPPO Reno6 5G/雨见 同款 360×658 小屏 =====
// 用户报障「【其他功能字卡】页下面无法滑动显示字卡」——其设备停在 v3.26.513（#239 修复
// 上线于 516），症状=同根因复发。此段在 OPPO 视口下验证：①首屏有字卡可点；②页面
// 确实可滚（scrollHeight>clientHeight）；③手势滑动后 scrollTop 推进、能滚出首屏外的新
// 字卡（修复前 6px 塌缩列表+概率框占满首屏，滑不出任何新内容=红）。
const ctx2 = await browser.newContext({ viewport: { width: 360, height: 658 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page2 = await ctx2.newPage();
await page2.goto(base + '/index.html', { waitUntil: 'load' });
await page2.waitForTimeout(1500);
await page2.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
await page2.waitForTimeout(200);

const s1 = await page2.evaluate(() => {
  document.getElementById('li-fun-cards').click();
  const vpH = innerHeight;
  const items = [...document.querySelectorAll('#fc-list .cc-item')];
  const inVp = items.filter(it => { const r = it.getBoundingClientRect(); return r.top < vpH && r.bottom > 0 && r.height > 0; });
  const pg = document.getElementById('page-fun-cards');
  return { total: items.length, inVp: inVp.length, listH: Math.round(document.getElementById('fc-list').getBoundingClientRect().height), pageScrollH: pg.scrollHeight, pageClientH: pg.clientHeight };
});
check('S1 [360x658] 打开fc页首屏有可见字卡且页面可滚', s1.total > 0 && s1.inVp > 0 && s1.pageScrollH > s1.pageClientH, JSON.stringify(s1));

// S2 触摸手势下滑：scrollTop 推进 + 滚出首屏外的新字卡（用户报障的直接行为断言）
// 用 CDP dispatchTouchEvent 模拟真实滑屏（mouse 拖拽不走触摸平移路径）
const cdp = await page2.context().newCDPSession(page2);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 500 }] });
for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 500 - i * 35 }] }); await page2.waitForTimeout(16); }
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page2.waitForTimeout(500);
const s2b = await page2.evaluate(() => {
  const pg = document.getElementById('page-fun-cards');
  const vpH = innerHeight;
  const items = [...document.querySelectorAll('#fc-list .cc-item')];
  const visN = items.filter(it => { const r = it.getBoundingClientRect(); return r.top < vpH && r.bottom > 0 && r.height > 0; }).length;
  const outAtFirst = items.filter(it => it.getBoundingClientRect().top >= vpH).length;
  return { st1: pg.scrollTop, visN, outAtFirst };
});
check('S2 [360x658] 手势下滑滚动推进并滚出新字卡', s2b.st1 > 50 && s2b.visN > 0 && s2b.outAtFirst > 0, JSON.stringify({ st0: 0 }) + '→' + JSON.stringify(s2b));

// S3 概率框可滚入视口（#444 后在页顶展开栏下、默认折叠——展开后可达）
const s3 = await page2.evaluate(() => {
  const bar = document.getElementById('dcf-prob-expander-row'), box = document.getElementById('dcf-prob-box');
  bar.click();
  box.scrollIntoView();
  const r = box.getBoundingClientRect();
  const vpH = innerHeight;
  const visible = r.top < vpH && r.bottom > 0;
  bar.click();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), vpH, visible };
});
check('S3 [360x658] 概率框展开后可滚入视口', s3.visible, JSON.stringify(s3));

await ctx2.close();

await browser.close();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);

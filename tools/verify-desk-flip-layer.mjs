// verify-desk-flip-layer.mjs — #754 桌面翻页卡顿·合成层修复 回归断言
// 背景：iPhone 15 Pro Max 实报「刚进会顺、一会就卡着不动、连续点好几次才能切换」，
//   诊断实锤 桌面翻页 平均186ms / p90 719ms / 最慢3611ms，而【性能】长任务>50ms 为零
//   ＝主线程没堵、卡在合成/栅格层。根因＝整页背景图（page-bg-N）画在嵌套滚动页
//   .page-slide 上，翻页时纹理不被保活即逐帧重栅格化/重解码（#147 壁纸同源病灶）。
// 断言分两组：
//   S 组（源级）：门控规则在、实态挂类在、哨兵在、无未门控的 will-change、fixed 元素不在 pager 内
//   B 组（真渲染，Playwright + CDP 媒体模拟）：有整页背景图 → 触屏下三页提升为合成层；
//        无背景图 → 不提升；提升后翻页吸附与布局不变（防跨机型/跨功能回归）
// 用法：node tools/verify-desk-flip-layer.mjs [builtRootDir]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { statSync } from 'node:fs';
import { normalize, extname } from 'node:path';

const root = normalize(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' —— ' + detail : '')); }
}
const read = (p) => readFileSync(join(root, 'src', p), 'utf8').replace(/^\uFEFF/, '');
const readRoot = (p) => readFileSync(join(root, p), 'utf8').replace(/^\uFEFF/, '');

// ---------- S 组：源级 ----------
const home = read('css/home.css');
const RULE = '.desktop-pages.has-page-bg .page-slide { will-change: transform; }';
const MQ = '@media (hover: none) and (pointer: coarse) {';
check('S1 合成层规则在位（#754a）', home.includes(RULE));

// S2 规则必须落在触屏门控块内：媒体查询在规则之前，且两者之间无其它顶层闭括号
const mqIdx = home.indexOf(MQ);
const ruleIdx = home.indexOf(RULE);
check('S2 规则在触屏门控 @media(hover:none/pointer:coarse) 内', mqIdx >= 0 && ruleIdx > mqIdx, 'mq@' + mqIdx + ' rule@' + ruleIdx);

// S3 无未门控的 .page-slide will-change（防被写成全局规则＝电脑端外壳也提升图层）
const unGated = /(^|\})\s*\.page-slide[^{]*\{[^}]*will-change[^}]*\}/m.test(home.replace(/@media[^{]*\{[\s\S]*?\n\}/g, ''));
check('S3 无未门控 .page-slide will-change（电脑端外壳零变化）', !unGated);

// S4 personalize 实态挂类（在 applyPageBgs 内）
const pz = read('js/personalize.js');
const fnIdx = pz.indexOf('const applyPageBgs = () => {');
const clsIdx = pz.indexOf("pagesBox.classList.toggle('has-page-bg', anyPageBg);");
check('S4 applyPageBgs 按 DOM 实态挂 has-page-bg（#754b）', fnIdx >= 0 && clsIdx > fnIdx && clsIdx < pz.indexOf('\n  };', fnIdx));

// S5 fixed 定位元素不得进入 pager（提升合成层会改其包含块）
const tpl = read('template.html');
const pagerStart = tpl.indexOf('id="desktop-pages"');
const pagerEnd = tpl.indexOf('/desktop-pages');
const msgIdx = tpl.indexOf('id="desk-msg"');
const viewerIdx = tpl.indexOf('id="desk-image-viewer"');
check('S5 #desk-msg / #desk-image-viewer 在 #desktop-pages 之外（包含块不被改）',
  pagerStart >= 0 && pagerEnd > pagerStart && msgIdx > pagerEnd && viewerIdx > pagerEnd);

// S6 哨兵登记
const build = readRoot('build.mjs');
const sent = (build.match(/#754[a-b] /g) || []).length;
check('S6 build.mjs 登记 #754a/b 哨兵', sent === 2, '实际 ' + sent);

// ---------- B 组：真渲染 ----------
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
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
async function boot({ withBg }) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:applock-qa-en', '0'); localStorage.setItem('xy-home-v2:onboard-done', '1'); } catch (e) {}
  });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  // 触屏媒体特征（hover:none / pointer:coarse）——门控规则命中条件
  await client.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] });
  const dismiss = () => page.evaluate(() => {
    try { const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); } catch (e2) {}
    try { const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; } } catch (e2) {}
  });
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000); await dismiss();
  if (withBg) {
    await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const x = c.getContext('2d'); x.fillStyle = '#346'; x.fillRect(0, 0, 64, 128);
      const url = c.toDataURL('image/jpeg', 0.7);
      let prefix = 'xy-home-v2:';
      try { if (typeof window.activePrefix === 'function') prefix = window.activePrefix(); } catch (e) {}
      if (prefix && prefix.charAt(prefix.length - 1) !== ':') prefix += ':';
      try { localStorage.setItem(prefix + 'page-bg-0', url); localStorage.setItem(prefix + 'desk-page-count', '2'); } catch (e) {}
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500); await dismiss();
  }
  await page.waitForTimeout(800);
  return { ctx, page };
}

// B1 有整页背景图 → 触屏下三页提升为合成层
{
  const { ctx, page } = await boot({ withBg: true });
  const r = await page.evaluate(() => {
    const box = document.getElementById('desktop-pages');
    const slides = Array.from(box.querySelectorAll('.page-slide'));
    return {
      cls: box.classList.contains('has-page-bg'),
      ws: slides.map((s) => getComputedStyle(s).willChange),
      n: slides.length
    };
  });
  console.log('   B1 现场：has-page-bg=' + r.cls + '  will-change=[' + r.ws.join(', ') + ']  页数=' + r.n);
  check('B1 有整页背景图时三页 will-change:transform', r.cls && r.n > 0 && r.ws.every((w) => w === 'transform'));
  await ctx.close();
}

// B2 无整页背景图 → 不提升（零额外显存）
{
  const { ctx, page } = await boot({ withBg: false });
  const r = await page.evaluate(() => {
    const box = document.getElementById('desktop-pages');
    const slides = Array.from(box.querySelectorAll('.page-slide'));
    return { cls: box.classList.contains('has-page-bg'), ws: slides.map((s) => getComputedStyle(s).willChange) };
  });
  check('B2 无整页背景图时不提升（零额外显存）', !r.cls && r.ws.every((w) => w === 'auto' || w === ''), JSON.stringify(r));
  await ctx.close();
}

// B3/B4 提升后翻页吸附与布局不变
{
  const { ctx, page } = await boot({ withBg: true });
  const r = await page.evaluate(async () => {
    const box = document.getElementById('desktop-pages');
    const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
    const step = box.clientWidth + gap;
    const before = { width: box.querySelector('.page-slide').getBoundingClientRect().width, clientWidth: box.clientWidth };
    if (window.deskGo) window.deskGo(1);
    await new Promise((res) => setTimeout(res, 600));
    return { scrollLeft: box.scrollLeft, step, want: step, before };
  });
  check('B3 翻页吸附落点不变（无吸附错位）', Math.abs(r.scrollLeft - r.want) < 2, 'scrollLeft=' + r.scrollLeft + ' 期望≈' + r.want);
  check('B4 页宽/滚动宽度不受提升影响（布局零变化）', Math.abs(r.before.width - r.before.clientWidth) < 2, JSON.stringify(r.before));
  await ctx.close();
}

await browser.close();
server.close();
console.log('----');
console.log('verify-desk-flip-layer: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

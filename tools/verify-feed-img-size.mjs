// ===== 验证：朋友圈动态图片格宽统一（FIX-REGRESSION #95）=====
// 用法：node tools/verify-feed-img-size.mjs（无需先构建，直接读 src/css）
// 390×844 下测 1/2/3/4/9 张图的格宽与高宽比；反向对照把已删除的单图/双图特判
// 规则追加回样式末尾（同特异性后者胜出），确认不一致会重现。
import { readFileSync } from 'node:fs';
import { normalize, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const baseCss = read('src/css/base.css');
const feedCss = read('src/css/chat-pages.css');
// 修复前（v3.5.94 起存在，#95 删除）的按张数特判规则
const LEGACY = `
.feed-imgs:has(img:only-of-type) { max-width:66%; }
.feed-imgs img:only-of-type { aspect-ratio:auto; }
.feed-imgs:has(img:nth-of-type(2):last-of-type) { grid-template-columns:repeat(2, 1fr); max-width:80%; }
`;

const shot = (w, h) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#88a"/></svg>`);
const PORTRAIT = shot(600, 900); // 非正方形，用于暴露「单图随原图比例自由变高」

function fixture(css) {
  const posts = [1, 2, 3, 4, 9].map((n) => {
    const imgs = Array.from({ length: n }, () => '<img src="' + PORTRAIT + '" alt="图片">').join('');
    return '<div class="feed-post"><div class="feed-content">动态正文<div class="feed-imgs">' + imgs + '</div></div></div>';
  }).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><style>' + baseCss + '</style><style>' + css +
    '</style></head><body><div class="phone"><div class="app"><div class="page" id="page-feed"><div id="feed-list">' +
    posts + '</div></div></div></div></body></html>';
}

const MEASURE = `(() => [...document.querySelectorAll('.feed-post')].map((post) => {
  const box = post.querySelector('.feed-content').getBoundingClientRect();
  const imgs = [...post.querySelectorAll('.feed-imgs img')].map((im) => {
    const r = im.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  });
  return { n: imgs.length, contentW: +box.width.toFixed(1), imgs };
}))()`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
async function run(label, css) {
  await page.setContent(fixture(css), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const rows = await page.evaluate(MEASURE);
  console.log('\n== ' + label + ' ==');
  for (const r of rows) {
    console.log('  ' + r.n + ' 图：格宽 ' + r.imgs[0].w + 'px（正文宽 ' + r.contentW + 'px 的 ' +
      ((r.imgs[0].w / r.contentW) * 100).toFixed(1) + '%），格高 ' + r.imgs[0].h + 'px，高宽比 ' +
      (r.imgs[0].h / r.imgs[0].w).toFixed(2));
  }
  return rows;
}
const legacy = await run('反向对照（把已删除的特判规则加回）', feedCss + LEGACY);
const cur = await run('当前源码', feedCss);
await browser.close();

let pass = 0, fail = 0;
const check = (desc, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); };
const widths = (rows) => rows.map((r) => r.imgs[0].w);
const ratios = (rows) => rows.map((r) => +(r.imgs[0].h / r.imgs[0].w).toFixed(2));

check('反向对照能重现不一致（1/2/3 图格宽互不相等）',
  new Set(widths(legacy.slice(0, 3))).size === 3, widths(legacy.slice(0, 3)).join('/'));
check('反向对照单图非正方形（aspect-ratio:auto 生效）',
  Math.abs(ratios(legacy)[0] - 1) > 0.3, String(ratios(legacy)[0]));
check('当前 1/2/3/4/9 图首格宽度全部相等',
  new Set(widths(cur)).size === 1, widths(cur).join('/'));
check('当前每格都是 1:1 正方形',
  ratios(cur).every((x) => Math.abs(x - 1) < 0.02), ratios(cur).join('/'));
check('当前格宽 = 多图九宫格口径（1/3 正文宽，扣 2 个 6px 间距）',
  Math.abs(cur[0].imgs[0].w - (cur[2].contentW - 12) / 3) < 1.5,
  cur[0].imgs[0].w + ' vs ' + ((cur[2].contentW - 12) / 3).toFixed(1));
check('同一动态内所有格宽一致（4 图第二行不缩胀）',
  cur[3].imgs.every((i) => Math.abs(i.w - cur[3].imgs[0].w) < 0.5), cur[3].imgs.map((i) => i.w).join('/'));
console.log('\n' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);

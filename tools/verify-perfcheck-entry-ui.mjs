// verify-perfcheck-entry-ui.mjs — #908 卡顿自检入口「红字警示＋默认 2 分钟」真实渲染验证（常驻）
// 支持 node tools/verify-perfcheck-entry-ui.mjs --live 直接对线上站点复验（干净上下文无 SW 缓存）
// 无头实机流程：开屏进入 → 设置页 → 点「卡顿自检」行 → 断言
//   ①弹窗带 modal--warn（红框）②说明块含红色 .modal-static-key 且文字含「时长太短没用」
//   ③「2 分钟」胶囊默认选中 ④点确定后实测窗口≈120 秒（读顶部浮条倒数）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const LIVE = process.argv[2] === '--live';
const base = LIVE ? 'https://ling233330-star.github.io/mochi' : ('http://127.0.0.1:' + srv.address().port);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  [' + x + ']' : '')); } };

await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 40000 }).catch(() => {});
await sleep(1200);
// 过开屏
await page.evaluate(() => { const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click(); const s = document.getElementById('splash'); if (s) s.hidden = true; });
await sleep(800);
// 进设置页（底部 tab 的 page-setting）
await page.evaluate(() => { const t = document.querySelector('.tabbar .tab[data-page="page-setting"]') || document.querySelector('.tabbar .tab'); if (t) t.click(); });
await sleep(900);
const entered = await page.evaluate(() => { const p = document.getElementById('page-setting'); return !!p && !p.hidden; });
ok(entered, 'A0 已进入设置页（page-setting 可见）');

// 点「卡顿自检」行
const clicked = await page.evaluate(() => { const r = document.getElementById('row-perf-check'); if (!r) return false; r.click(); return true; });
ok(clicked, 'A1 找到并点击 #row-perf-check');
await sleep(800);

const st = await page.evaluate(() => {
  const box = document.querySelector('.modal');
  const staticEl = document.getElementById('modal-static');
  const keys = staticEl ? staticEl.querySelectorAll('.modal-static-key') : [];
  const colors = [];
  keys.forEach((k) => colors.push(getComputedStyle(k).color));
  const pills = Array.from(document.querySelectorAll('#modal-pills .pill'));
  const onPill = pills.filter((p) => p.classList.contains('on')).map((p) => p.textContent.trim());
  return {
    modalVisible: !!box && !(document.querySelector('#modal-mask') || {}).hidden,
    warnCls: box ? box.classList.contains('modal--warn') : false,
    staticText: staticEl ? staticEl.textContent : '',
    keyCount: keys.length,
    keyColors: colors,
    pillLabels: pills.map((p) => p.textContent.trim()),
    onPill: onPill,
    staticBg: staticEl ? getComputedStyle(staticEl).backgroundColor : '',
    staticBorder: staticEl ? getComputedStyle(staticEl).borderLeftColor : ''
  };
});

ok(st.modalVisible, 'A2 卡顿自检弹窗已打开');
ok(st.warnCls, 'A3 弹窗带 modal--warn（红框警示形态生效）', st.warnCls ? '' : 'class 缺失');
ok(st.staticText.indexOf('时长太短没用') >= 0, 'A4 说明含红字警告文案「时长太短没用」');
ok(st.keyCount >= 2 && st.keyColors.some((c) => /201,\s*42,\s*31|232,\s*56,\s*44/.test(c)), 'A5 红色重点字渲染成 .modal-static-key 且颜色为红', JSON.stringify(st.keyColors));
ok(/232,\s*56,\s*44/.test(st.staticBg) || /232,\s*56,\s*44/.test(st.staticBorder), 'A6 说明块底色/描边为红（警示形态完整）', st.staticBg + ' | ' + st.staticBorder);
ok(JSON.stringify(st.pillLabels) === JSON.stringify(['10 秒', '30 秒', '60 秒', '2 分钟', '5 分钟']), 'A7 五档时长胶囊齐全', JSON.stringify(st.pillLabels));
ok(st.onPill.length === 1 && st.onPill[0] === '2 分钟', 'A8 默认选中「2 分钟」', JSON.stringify(st.onPill));

// 点确定 → 实测窗口应≈120 秒（读浮条倒数）
await page.evaluate(() => { const b = document.getElementById('modal-ok'); if (b) b.click(); });
await sleep(1100);
const bar = await page.evaluate(() => { const b = document.getElementById('perf-check-bar'); return b ? { txt: b.textContent, top: getComputedStyle(b).top, pe: getComputedStyle(b).pointerEvents } : null; });
ok(!!bar && /剩\s*(119|120|118)\s*秒/.test(bar.txt), 'A9 点确定后实测窗口＝2 分钟（浮条倒数 118~120 秒）', bar ? bar.txt : 'no bar');
ok(!!bar && parseFloat(bar.top) <= 60 && bar.pe === 'none', 'A10 浮条在顶部且点按穿透（不挡按钮）', bar ? bar.top + ' / ' + bar.pe : 'no bar');

await ctx.close();
await browser.close();
srv.close();
console.log(fail === 0 ? '\n#908 探针：ALL PASS ' + pass + '/' + pass : '\n#908 探针：' + pass + ' 过 / ' + fail + ' 挂');
process.exit(fail ? 1 : 0);

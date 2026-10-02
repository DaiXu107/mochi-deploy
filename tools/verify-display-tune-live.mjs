// verify-display-tune-live.mjs — #764 屏幕适配微调·行为层验证（真浏览器，Playwright）
// 对产物 index.html 跑真浏览器断言：LS→劫持层→CSS 变量→计算字号 四环 + 面板交互 + 复位 + 返回键。
// 立项取证：源级脚本抓不到的「base.css .phone [contenteditable=16px] 特异性截胡」由此层实锤（P1b 首跑判红）。
// 用法：构建后 `node tools/verify-display-tune-live.mjs`（MOCHI_ARTIFACT 可指隔离产物）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = process.env.MOCHI_ARTIFACT || join(root, 'index.html');
const html = readFileSync(artifactPath);
if (!html.includes('screen-adj-text')) {
  console.log('ENV  产物里没有 #764 文字轴（screen-adj-text）——请先 node build.mjs 或用 MOCHI_ARTIFACT 指向含本批的构建');
  process.exit(2);
}
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n); } };

const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await page.addInitScript(() => { if (localStorage.getItem('xy-home-v2:screen-adj-text') === null) localStorage.setItem('xy-home-v2:screen-adj-text', '6'); });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.evaluate(() => { const s = document.getElementById('splash'); if (s && !s.classList.contains('hide')) s.click(); });
await page.waitForTimeout(600);

const g = async (fn, arg) => page.evaluate(fn, arg);

console.log('[P1] \u542f\u52a8\u81ea\u52a8\u843d\u5c42\uff08LS \u9884\u7f6e text=6\uff09');
ok(await g(() => document.documentElement.style.getPropertyValue('--mochi-text-adj') === '6px'), 'P1a \u53d8\u91cf\u5199\u5165 :root\uff08applyText \u8bfb\u76d8\u5373\u843d\uff0c\u65e0\u9700\u6253\u5f00\u9762\u677f\uff09');
ok(await g(() => { const el = document.querySelector('.chat-input'); return el && Math.abs(parseFloat(getComputedStyle(el).fontSize) - 21) < .01; }), 'P1b .chat-input \u8ba1\u7b97\u5b57\u53f7 15\u219221px\uff08CSS \u6d88\u8d39\u751f\u6548\uff09');
ok(await g(() => { const el = document.querySelector('.set-row .txt'); return el && Math.abs(parseFloat(getComputedStyle(el).fontSize) - 20) < .01; }), 'P1c \u8bbe\u7f6e\u884c\u6807\u9898 14\u219220px');
ok(await g(() => { const el = document.querySelector('.set-row .txt .sub'); return el && Math.abs(parseFloat(getComputedStyle(el).fontSize) - 17.5) < .01; }), 'P1d \u8bbe\u7f6e\u884c\u526f\u6807\u9898 11.5\u219217.5px');

console.log('[P2] \u9762\u677f\u6253\u5f00\u4e0e\u6ed1\u6746');
await g(() => document.getElementById('row-screen-adj').click());
ok(await g(() => !!document.getElementById('screen-adj-panel')), 'P2a \u5165\u53e3\u70b9\u51fb\u5f00\u9762\u677f');
ok(await g(() => document.querySelectorAll('#screen-adj-panel input[type=range]').length === 6), 'P2b \u516d\u6839\u6ed1\u6746\u9f50\u5168');
ok(await g(() => { const s = document.querySelector('[data-adj-slider="text"]'); return s && s.value === '6'; }), 'P2c \u6587\u5b57\u8f74\u521d\u503c\u56de\u8bfb LS=6\uff08\u4e0d\u662f\u96f6\uff0c\u4e5f\u4e0d\u4f1a undefined\uff09');
ok(await g(() => { const s = document.querySelector('[data-adj-slider="desk"]'); const v = document.querySelector('[data-adj-val="desk"]'); return s && s.value === '0' && v && v.textContent === '0px'; }), 'P2d \u684c\u9762\u8f74\u65e0 undefinedpx\uff08all() \u4e09\u8f74\u65e7\u4f24\u5df2\u4fee\uff09');
ok(await g(() => {
  const s = document.querySelector('[data-adj-slider="text"]');
  s.value = '2'; s.dispatchEvent(new Event('input', { bubbles: true }));
  return document.documentElement.style.getPropertyValue('--mochi-text-adj') === '2px'
    && localStorage.getItem('xy-home-v2:screen-adj-text') === '2'
    && Math.abs(parseFloat(getComputedStyle(document.querySelector('.chat-input')).fontSize) - 17) < .01;
}), 'P2e \u62d6\u6ed1\u6746\uff1a\u53d8\u91cf+LS+\u8ba1\u7b97\u5b57\u53f7\u4e09\u8f6e\u540c\u6b65\u5230 2/17px\uff08\u8fb9\u62d6\u8fb9\u770b\uff09');
await g(() => { const s = document.querySelector('[data-adj-slider="top"]'); s.value = '10'; s.dispatchEvent(new Event('input', { bubbles: true })); });
ok(await g(() => localStorage.getItem('xy-home-v2:screen-adj-top') === '10' && window.mochiScreenAdj.all().top === 10), 'P2f \u9876\u90e8\u8f74\u843d LS\uff08\u53cc\u5c42\u504f\u79fb\u5b58\u50a8\uff0c\u5934\u8111\u65e0\u5199\u5165\u8005\u65f6\u4e0d\u53ef\u89c6\uff1d\u8bbe\u8ba1\u5982\u6b64\uff09');
const bounds = await g(() => window.mochiScreenAdj.set('text', 99) === false && window.mochiScreenAdj.set('text', -5) === false && window.mochiScreenAdj.set('top', 999) === false);
ok(bounds, 'P2g \u8d8a\u754c\u62d2\u6536\uff1atext \u53ea\u6536 0~12\u3001\u504f\u79fb\u8f74\u53ea\u6536 \u00b180\uff08RANGE \u9010\u8f74\u751f\u6548\uff09');
ok(await g(() => { const s = document.querySelector('[data-adj-slider="text"]'); s.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return window.mochiScreenAdj.all().text === 0 && !localStorage.getItem('xy-home-v2:screen-adj-text') && document.documentElement.style.getPropertyValue('--mochi-text-adj') === ''; }), 'P2h \u53cc\u51fb\u6ed1\u6746\u590d\u4f4d\uff1a\u503c\u5f52 0\u3001LS \u952e\u5220\u9664\u3001\u5185\u8054\u53d8\u91cf\u64a4\u56de');

console.log('[P3] \u4e00\u952e\u8fd8\u539f\u4e0e\u8fd4\u56de\u952e');
ok(await g(() => { const bs = document.querySelectorAll('#screen-adj-panel button'); bs[bs.length - 1].click();
  return window.mochiScreenAdj.all().top === 0 && !localStorage.getItem('xy-home-v2:screen-adj-top'); }), 'P3a \u300c\u5168\u90e8\u6062\u590d\u9ed8\u8ba4\u300d\u516d\u8f74\u5f52\u96f6');
await g(() => history.pushState({}, ''));
await g(() => window.dispatchEvent(new PopStateEvent('popstate')));
ok(await g(() => { const p = document.getElementById('screen-adj-panel'); return p && p.hidden === false; }), 'P3b1 \u6d4f\u89c8\u5668\u6807\u7b7e\u6a21\u5f0f\uff1a\u8fd4\u56de\u4ea4\u8fd8\u6d4f\u89c8\u5668\u3001\u9762\u677f\u4e0d\u52a8\uff08tabs.js inPwa \u95e8\u63a7\u8bbe\u8ba1\u5982\u6b64\uff09');
await g(() => { const p = document.getElementById('screen-adj-panel'); if (p) p.remove(); });
await page.addInitScript(() => { const mm = window.matchMedia; window.matchMedia = (q) => (/display-mode/.test(q) ? { matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm.call(window, q)); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.evaluate(() => { const s = document.getElementById('splash'); if (s && !s.classList.contains('hide')) s.click(); });
await page.waitForTimeout(400);
await g(() => document.getElementById('row-screen-adj').click());
await g(() => { for (let i = 0; i < 6; i++) { history.pushState({}, ''); window.dispatchEvent(new PopStateEvent('popstate')); } });
ok(await g(() => { const p = document.getElementById('screen-adj-panel'); return p && p.hidden === true && getComputedStyle(p).display === 'none'; }), 'P3b2 \u5b89\u88c5\u6001\uff08standalone \u6a21\u62df\uff09\u8fd4\u56de\u952e\u8fde\u6309\u5148\u6e05\u5f39\u5c42\uff1a\u9762\u677f\u771f\u9690\u85cf\uff08[hidden]!important \u538b\u8fc7\u5185\u8054 flex\uff1b\u9996\u51e0\u4e0b\u88ab\u684c\u9762\u4e0a\u5df2\u5f00\u7684 desk-msg \u7b49\u66f4\u9ad8\u5c42\u6d88\u8017\u5c5e\u6e05\u5355\u65e2\u6709\u987a\u5e8f\uff09');
ok(await g(() => { document.getElementById('row-screen-adj').click(); const p = document.getElementById('screen-adj-panel'); return p && !p.hidden && getComputedStyle(p).display !== 'none'; }), 'P3c \u5173\u95ed\u540e\u91cd\u65b0\u6253\u5f00\u590d\u6d3b\uff08\u65e0 zombie \u9762\u677f\uff09');

console.log('[P4] \u5237\u65b0\u6301\u4e45\u5316 + \u96f6\u8fd0\u884c\u65f6\u9519\u8bef');
await g(() => { const s = document.querySelector('[data-adj-slider="text"]'); s.value = '4'; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
ok(await g(() => document.documentElement.style.getPropertyValue('--mochi-text-adj') === '4px' && Math.abs(parseFloat(getComputedStyle(document.querySelector('.chat-input')).fontSize) - 19) < .01), 'P4a \u5237\u65b0\u540e\u8bfb\u76d8\u81ea\u52a8\u843d\u5c42 4px/19px\uff08\u672c\u673a\u6c38\u4e45\u4fdd\u5b58\uff09');
ok(errs.length === 0, 'P4b \u5168\u7a0b\u65e0 JS \u8fd0\u884c\u65f6\u9519\u8bef' + (errs.length ? '\uff1a' + errs.slice(0, 3).join(' | ') : ''));

await browser.close();
server.close();
console.log('\n\u7ed3\u679c\uff1a' + pass + '/' + (pass + fail) + (fail ? ' \u5931\u8d25 ' + fail : ' \u5168\u7eff'));
process.exit(fail ? 1 : 0);

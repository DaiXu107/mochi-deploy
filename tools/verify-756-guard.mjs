import fs from 'fs';
import path from 'path';
import http from 'http';
import { chromium } from 'playwright';

// #756 验证：对比「旧产物（fromLabel 早退）」与「新产物（guard 兜底）」在
// 「内核不转发 label 原生激活」这一国产内核实况下的行为差异。
const ROOT = process.env.MOCHI_ROOT || process.cwd();
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html;charset=utf-8' : 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const results = [];
async function run(label, blockLabelNative) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16; V2458A; wv) AppleWebKit/537.36 Chrome/140.0.7339.0 Mobile Safari/537.36 baiduboxapp/15.76.0.10',
  });
  const page = await ctx.newPage();
  let fc = 0;
  page.on('filechooser', () => { fc++; });
  await page.addInitScript((block) => {
    try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e) {}
    window.__calls = [];
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this && this.type === 'file') window.__calls.push({ via: 'js-click', id: this.id });
      try { return orig.apply(this, arguments); } catch (e) { window.__calls.push({ via: 'js-click', threw: String(e && e.message) }); }
    };
    if (block) {
      // 模拟国产内核实况：label 存在但内核不转发激活（也不报错）
      document.addEventListener('click', (e) => {
        const lb = e.target && e.target.closest && e.target.closest('label[data-file-pick-for]');
        if (lb) { e.preventDefault(); window.__calls.push({ via: 'label-blocked', for: lb.htmlFor }); }
      }, true);
    }
  }, blockLabelNative);
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const b = document.querySelector('.splash-box'); if (b) b.scrollTop = b.scrollHeight;
    const btn = [...document.querySelectorAll('.splash-box *')].find(e => /进入|开始/.test(e.textContent || '') && e.children.length === 0);
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.querySelectorAll('.qa-mask,.tc-mask,.call-mask,.splash').forEach(e => { e.classList.add('hide'); e.remove(); });
    document.querySelectorAll('.modal-mask').forEach(e => e.hidden = true);
    document.body.classList.remove('scroll-lock');
  });
  await page.waitForTimeout(500);
  const geo = await page.evaluate(() => {
    const box = document.getElementById('avatar-user');
    const br = box.getBoundingClientRect();
    return { cx: br.x + br.width / 2, cy: br.y + br.height / 2 };
  });
  await page.evaluate(() => { window.__calls = []; });
  fc = 0;
  await page.touchscreen.tap(geo.cx, geo.cy);
  await page.waitForTimeout(1200);
  const calls = await page.evaluate(() => window.__calls);
  await browser.close();
  results.push({ label, blockLabelNative, calls, fc, ok: fc > 0 || calls.some(c => c.via === 'js-click') });
}

await run('旧行为模拟（label 被拦）', true);
await run('修复后（label 被拦）', true);
await run('修复后（label 正常）', false);
srv.close();

console.log('\n================ #756 验证结果 ================');
for (const r of results) {
  console.log('\n[' + r.label + ']  label被拦=' + r.blockLabelNative);
  console.log('  调用轨迹:', JSON.stringify(r.calls));
  console.log('  filechooser 次数:', r.fc);
  console.log('  →', r.ok ? '✅ 选择器已打开（用户可见相册）' : '❌ 完全没反应');
}

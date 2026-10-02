// verify-1263-guide-modal-yield.mjs — #1263 存储修复引导「让路不抢弹窗」行为回归
// 立项（用户 2026-09-25 直派「iPhone 15 Pro Max Safari 备份导入无反应」取证途中的无头实测）：
// 全站弹窗是单例（#modal-mask/#modal-ok 共用一套 DOM）。#1250 引导在「数据就绪 +4s + IDB 复核」
// 这一拍**无条件** openModal——如果用户此刻正停在某个弹窗里（最典型＝「导入数据 → 选择导入范围」，
// 它的确定按钮上铺着 #1014/#1197 的真·可点文件层），引导会把那层连流程一起抢走：用户再点
// 「确定」打在换上的按钮上＝导入中断，无头读数与「弹窗没关、点了没反应」同形（verify-1014 B2
// 在含 #1250 的产物上即被这样抢掉，红的是夹具、暴露的是真缺陷）。
// 修法（storage-guide.js proceed 一处）：弹窗开着 ⇒ 2.5s 后重试，绝不抢占；空了才弹，仍只弹一次。
// 零机型／零 UA 分支：判据只有一个 DOM 事实——#modal-mask 是否可见。
// 用法：node build.mjs && node tools/verify-1263-guide-modal-yield.mjs
//   RED 基线：SERVE_ROOT=<纯 HEAD 副本> node tools/verify-1263-guide-modal-yield.mjs
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sg = (f) => { try { return readFileSync(existsSync(join(root, 'js', f)) ? join(root, 'js', f) : join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } };

// ===== S 组：产物侧源码锚 =====
{
  const dev = sg('storage-guide.js');
  ok(dev.includes("if (mask && !mask.hidden) { setTimeout(proceed, 2500); return; }"),
    'S1 让路闸在位（弹窗开着＝2.5s 重试，绝不抢占用户正在操作的弹窗）');
  ok(dev.includes("const mask = document.getElementById('modal-mask');"),
    'S2 判据只取单例弹窗的可见性（DOM 事实，零机型／零 UA 分支）');
  ok((dev.match(/doneThisSession = true;/g) || []).length === 3,
    'S3 会话内只弹一次的账没被让路闸改坏（LS 命中／IDB 命中／真弹出 三处，让路分支不自置）');
}

// ===== B 组：真浏览器时序 =====
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(String(e.message).slice(0, 200)));
await page.addInitScript(() => {
  try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
});
await page.goto(baseUrl + '/index.html');
await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
await page.evaluate(() => {
  const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
  const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
  const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
});
await sleep(600);

const guideSeen = () => page.evaluate(() => {
  const m = document.getElementById('modal-mask');
  const t = document.getElementById('modal-title');
  return { open: !!m && !m.hidden, title: t ? String(t.textContent).slice(0, 24) : '' };
});

// B0/B1 用户弹窗先开并一直停着 → 引导到点（数据就绪 +4s 起）不得抢占
const opened = await page.evaluate(() => {
  if (!window.openModal) return false;
  window.openModal('用户流程弹窗（不得被抢）', '', () => {}, { noInput: true, lock: true, staticText: '模拟正停在范围弹窗里选文件' });
  const m = document.getElementById('modal-mask');
  return !!m && !m.hidden;
});
ok(opened === true, 'B0 前置：用户弹窗已打开（引导尚未到点）');
await sleep(13500);
const at14 = await guideSeen();
ok(at14.open && at14.title.indexOf('用户流程弹窗') === 0,
  'B1 引导到点后看见弹窗开着 ⇒ 让路不抢（13.5s ≈ 到点+3 个重试拍，标题仍是用户弹窗）', JSON.stringify(at14));

// B2 用户关掉弹窗后，引导应在后续拍内补上
await page.evaluate(() => {
  const c = document.getElementById('modal-cancel'); if (c && !c.hidden) c.click();
  const m = document.getElementById('modal-mask'); if (m) m.hidden = true; // lock 弹窗的兜底收口
});
let buTan = null;
for (let i = 0; i < 8; i++) {
  await sleep(700);
  const s = await guideSeen();
  if (s.open && s.title.indexOf('存储修复引导') > -1) { buTan = s; break; }
}
ok(!!buTan, 'B2 弹窗一空，引导立刻补位（不丢这次善后指引）', JSON.stringify(await guideSeen()));

// B3 引导弹过即记账——只收窗不点「立即自愈」（避免顺带跑重建），再等 3 个重试拍不得复弹
await page.evaluate(() => {
  const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
});
await sleep(6500);
const after = await guideSeen();
ok(!after.open || after.title.indexOf('存储修复引导') === -1,
  'B3 引导弹过本会话不再第二次弹出', JSON.stringify(after));

// B4 引导送达后 LS 键已落（跨启动不重复）
const flag = await page.evaluate(() => { try { return localStorage.getItem('xy-home-v2:storage-guide-shown'); } catch (e) { return 'err'; } });
ok(flag === '1250', 'B4 引导确认后 storage-guide-shown=1250 落盘（下次启动静默）', String(flag));

ok(jsErrors.length === 0, 'Z 全流程零 JS 异常（防修过头）', JSON.stringify(jsErrors.slice(0, 3)));

console.log(`\n通过 ${pass} / 失败 ${fail}`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);

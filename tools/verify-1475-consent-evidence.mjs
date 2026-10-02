// verify-1475-consent-evidence.mjs — #1475 免责声明同意存证＋标准条款批（常驻）
// 判据面：
//   A 静态锚（构建产物 js/clock.js / index.html / README.md）：存证三件套（版本常量/JSON 写入/版本比对闸）
//     ＋免责卡新增条款在位＋四处同源同步＋旧措辞退场。
//   B 行为面（无头 Chromium 真跑开屏闸门）：
//     B1 空记录＝未勾；B2 旧格式 '1'＝未勾（视为旧版同意，本版重确认）；B3 旧版本 JSON＝未勾；
//     B4 当前版本 JSON＝自动勾上；B5 勾选动作落库存证 JSON（v＝当前版本、t＝时间戳）；
//     B6 免责卡条数＝12 段（首段＋1~11 条）。
// 用法：node tools/verify-1475-consent-evidence.mjs（MOCHI_SERVE_ROOT= 指定仓外副本根）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || here);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

const AGE_KEY = 'xy-home-v2:age-confirmed';
const AGE_VER = '2026-09-30';

console.log('\n== A 静态锚 ==');
let clk = '';
try { clk = readFileSync(join(root, 'js/clock.js'), 'utf8'); } catch (e) {}
ok(clk.includes("const AGE_VER = '2026-09-30';"), 'A1 clock.js 声明版本常量在位（＝免责卡「最后更新」日期）');
ok(clk.includes('JSON.stringify({ t: Date.now(), v: AGE_VER })'), 'A2 同意存证写入口（勾选时间戳＋版本，不再是裸 1）');
ok(clk.includes('ageOk = !!(obj && obj.v === AGE_VER);'), 'A3 版本比对闸（改版后旧确认自动失效）');
ok(!clk.includes("localStorage.getItem(AGE_KEY) === '1'"), 'A4 旧裸 1 判据已退役');

let idx = '';
try { idx = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
ok(idx.includes('勾选确认时，本站会在你自己的设备浏览器本地记录确认时间与本声明版本'), 'A5 免责卡首段存证披露在位');
ok(idx.includes('由使用者本人自行承担、自行负责'), 'A6 「后果由使用者本人自行承担、自行负责」强化措辞在位');
ok(idx.includes('无论基于何种原因或理由（包括但不限于违约、侵权或其他事由）'), 'A7 「无论基于何种原因」最大范围免责在位');
ok(idx.includes('作者未因你的使用收取任何费用或获取任何对价'), 'A8 免费无对价情节在位');
ok(idx.includes('不作任何形式的明示或默示保证，包括但不限于持续可用'), 'A9 「按现状提供＋无担保」条款在位');
ok(idx.includes('因第三方托管服务（如 GitHub Pages）'), 'A10 第三方托管免责在位');
ok(idx.includes('本声明任何条款被认定全部或部分无效的，不影响其余条款的效力'), 'A11 可分割性条款在位');
ok(idx.includes('11. 本免责声明最后更新：2026-09-30。'), 'A12 最后更新日期推进到 2026-09-30');
ok(!idx.includes('9. 本免责声明最后更新：2026-09-29。'), 'A13 旧条号＋旧日期已退役');
ok(idx.includes('本站将在你的设备浏览器本地记录确认时间与声明版本，不上传'), 'A14 设置→关于同源存证披露在位');
ok(idx.includes('不作任何形式的明示或默示保证（持续可用'), 'A15 设置→关于「按现状无担保」镜像条在位');

let rd = '';
try { rd = readFileSync(join(root, 'README.md'), 'utf8'); } catch (e) {}
ok(rd.includes('无论基于何种原因（包括但不限于违约、侵权或其他事由）'), 'A16 README 同源：最大范围免责在位');
ok(rd.includes('本站按「现状」与「当前可用性」提供'), 'A17 README 同源：无担保条在位');
ok(rd.includes('本免责声明最后更新：2026-09-30。'), 'A18 README 同源：最后更新日期同步');
ok(rd.includes('不影响其余条款的效力'), 'A19 README 同源：可分割性在位');

let ct = '';
try { ct = readFileSync(join(root, 'js/contacts.js'), 'utf8'); } catch (e) {}
ok(ct.includes("'age-confirmed']"), 'A20 同意记录根键在 migrateLegacy EXCLUDE 名单（漏登记＝每次启动被迁进 default 并删根键）');

console.log('\n== B 行为面（无头真跑开屏闸门）==');
const browser = await chromium.launch();
const mk = async (seed) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  // 种子必须「先落域 → evaluate 写入 → reload」：addInitScript 在 document-start 跑，
  // 该阶段 localStorage 在部分 Chromium 上不可用（静默异常＝种子丢失，B 组全变假读数）。
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  if (seed !== undefined) await page.evaluate(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} }, [AGE_KEY, seed]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  return { ctx, page, errs };
};

// B6 免责卡条数（首段＋1~11 条＝12 段）
{
  const { ctx, page, errs } = await mk();
  const n = await page.evaluate(() => document.querySelectorAll('#splash-disclaimer p').length);
  ok(n === 12, 'B6 免责卡 12 段（首段＋1~11 条）', 'n=' + n);
  ok(errs.length === 0, 'B6a 加载零 JS 异常', errs.join('|').slice(0, 120));
  // B1 空记录＝未勾
  const b1 = await page.evaluate((k) => {
    const el = document.getElementById('splash-age-check');
    return el ? el.checked : null;
  }, AGE_KEY);
  ok(b1 === false, 'B1 空记录＝未勾选（进不去）', String(b1));
  await ctx.close();
}
// B2 旧格式 '1'＝未勾（改版重确认）
{
  const { ctx, page } = await mk('1');
  const b2 = await page.evaluate((k) => document.getElementById('splash-age-check').checked, AGE_KEY);
  ok(b2 === false, "B2 旧格式 '1'＝本版未勾（重新确认一次）", String(b2));
  await ctx.close();
}
// B3 旧版本 JSON＝未勾
{
  const { ctx, page } = await mk(JSON.stringify({ t: 1700000000000, v: '2026-09-29' }));
  const b3 = await page.evaluate((k) => document.getElementById('splash-age-check').checked, AGE_KEY);
  ok(b3 === false, 'B3 旧版本 JSON（2026-09-29）＝本版未勾', String(b3));
  await ctx.close();
}
// B4 当前版本 JSON＝自动勾上
{
  const { ctx, page } = await mk(JSON.stringify({ t: 1700000000000, v: AGE_VER }));
  const b4 = await page.evaluate((k) => document.getElementById('splash-age-check').checked, AGE_KEY);
  ok(b4 === true, 'B4 当前版本 JSON＝自动勾上（不重复打断）', String(b4));
  await ctx.close();
}
// B5 勾选动作落库存证 JSON
{
  const { ctx, page } = await mk();
  await page.check('#splash-age-check');
  await page.waitForTimeout(200);
  const stored = await page.evaluate((k) => localStorage.getItem(k), AGE_KEY);
  let parsed = null;
  try { parsed = JSON.parse(stored); } catch (e) {}
  ok(!!parsed && parsed.v === AGE_VER && typeof parsed.t === 'number' && parsed.t > 1700000000000,
    'B5 勾选后落库存证 JSON（v＝当前版本、t＝真实时间戳）', String(stored).slice(0, 80));
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' verify-1475-consent-evidence: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

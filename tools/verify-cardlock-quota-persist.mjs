// ===== 回归验证：#404 米15夸克 LS 配额满 → 二级密码解锁刷新即回锁 =====
// 背景（FIX-REGRESSION #404）：小米15 + 夸克诊断显示 LS 写探针 QuotaExceededError
// （同域 ml2_* 他方键占满 20MB 配额）。旧流程解锁成功后盲等 900ms 就 location.reload()——
// xyStore 的 IDB 权威值/写标记是异步落库的，夸克等内核 reload 杀进程会中止在途 IDB 事务；
// LS 配额满设备上项目 LS 键恒空、IDB 是唯一凭证，值没提交成功刷新即回锁。
// 修复：clock.js 解锁/重锁改走 cardLockConfirmPersisted（轮询 idbGet 确认权威值已落库
// 再刷新，200ms×15=3s 兜底）；device.js 诊断体检补 cardlock-state 全局根键三层值。
// 本脚本把 localStorage.setItem 全量 stub 成抛 QuotaExceededError（getItem/removeItem
// 正常，模拟配额满持久状态），走真实流程断言解锁/重锁双向跨刷新保持。
// 用法：node tools/verify-cardlock-quota-persist.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 模拟 LS 配额满：setItem 一律抛 QuotaExceededError（跨 reload 持续）
const QUOTA_STUB = `(function(){
  try {
    const ls = window.localStorage;
    Object.defineProperty(ls, 'setItem', { configurable: true, writable: false, value: function(k, v) {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    }});
  } catch (e) {}
})();`;

const { chromium } = await import('playwright');
const browser = await chromium.launch(process.env.BROWSER === 'chrome' ? { channel: 'chrome' } : undefined);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await ctx.addInitScript(QUOTA_STUB);

async function boot() {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate('!!window.__mochiDataReady')) break;
    await sleep(300);
  }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(800);
  await sleep(1500);
}

async function idbGetRaw(k) {
  return page.evaluate(`(async function(){
    try { return (window.idbGet) ? await window.idbGet(${JSON.stringify(k)}) : '(no idbGet)'; } catch (e) { return '(err)' + e.message; }
  })()`);
}

async function waitDataReady() {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate('!!window.__mochiDataReady')) break;
    await sleep(300);
  }
  // 给 wrjMergeFromIdb / mochi-wrj-heal 一点时间（restore-done 后异步）
  await sleep(2500);
}

// ---------- 会话 A：解锁 + 落库确认 ----------
await boot();
check('A0 开屏就绪无 JS 错误', pageErrors.length === 0, pageErrors[0] || '');

const qok = await page.evaluate("(function(){ try { localStorage.setItem('xy-probe','1'); return 'write-ok'; } catch (e) { return e.name; } })()");
check('A0.1 LS setItem 已被配额满拦截', qok === 'QuotaExceededError', qok);

check('A1 初始为锁定态', (await page.evaluate('window.cardLockOpen()')) === false);
check('A1.1 落库确认接口已挂载', await page.evaluate('typeof window.cardLockConfirmPersisted === "function"'));

const ur = await page.evaluate("(function(){ try { return window.cardLockTryUnlock('990815'); } catch (e) { return { ok:false, msg:'throw:'+e.message }; } })()");
check('A2 解锁接口返回成功', ur && ur.ok === true, JSON.stringify(ur));
check('A3 解锁后本会话立即可见', (await page.evaluate('window.cardLockOpen()')) === true);

// #404 核心断言：cardLockConfirmPersisted 等 IDB 权威值真的变成 'open' 才回调
const confirmRes = await page.evaluate(`(function(){
  return new Promise(function (resolve) {
    const t0 = Date.now();
    window.cardLockConfirmPersisted('open', function () { resolve({ ms: Date.now() - t0 }); });
    setTimeout(function () { resolve({ timeout: true }); }, 6000);
  });
})()`);
check('A4 落库确认回调已触发（未超时）', confirmRes && !confirmRes.timeout, JSON.stringify(confirmRes));
const idbVal = await idbGetRaw('xy-home-v2:cardlock-state');
check('A5 IDB 权威值=open', idbVal === 'open', JSON.stringify(idbVal));
// A6：写标记走 150ms 微批缓冲（wrjMarkFlush），轮询等它落库
let idbMark = null;
for (let i = 0; i < 25; i++) {
  idbMark = await idbGetRaw('xy-home-v2:__wr-j:xy-home-v2:cardlock-state');
  if (typeof idbMark === 'number' && idbMark > 0) break;
  await sleep(200);
}
check('A6 IDB 写标记已落库', typeof idbMark === 'number' && idbMark > 0, JSON.stringify(idbMark));

// ---------- 会话 B：刷新后（模拟用户解锁→刷新） ----------
await page.reload({ waitUntil: 'load', timeout: 25000 }).catch(() => {});
await waitDataReady();

check('B1 #1511 持久化还原：刷新后不回锁（解锁态跨刷新保留）', (await page.evaluate('window.cardLockOpen()')) === true);
const lockUi1 = await page.evaluate("(function(){ const a=document.getElementById('splash-cardlock-actions'); if(!a) return '(no card)'; const btn=a.querySelector('.cardlock-btn'); return btn ? btn.textContent : '(no btn)'; })()");
check('B2 开屏锁卡显示已解锁（重新上锁按钮）', lockUi1 === '重新上锁', JSON.stringify(lockUi1));

// ---------- 会话 C：重锁 → 落库确认 → 刷新后恢复锁定（未成年人保护方向同样不丢） ----------
const rr = await page.evaluate("(function(){ try { window.cardLockRelock(); return window.cardLockOpen() === false; } catch (e) { return 'throw:' + e.message; } })()");
check('C1 重锁后本会话立即锁定', rr === true, JSON.stringify(rr));
const confirmRes2 = await page.evaluate(`(function(){
  return new Promise(function (resolve) {
    const t0 = Date.now();
    window.cardLockConfirmPersisted('locked', function () { resolve({ ms: Date.now() - t0 }); });
    setTimeout(function () { resolve({ timeout: true }); }, 6000);
  });
})()`);
check('C2 重锁落库确认回调已触发（未超时）', confirmRes2 && !confirmRes2.timeout, JSON.stringify(confirmRes2));

await page.reload({ waitUntil: 'load', timeout: 25000 }).catch(() => {});
await waitDataReady();

check('C3 刷新后 cardLockOpen()=false（重锁保持）', (await page.evaluate('window.cardLockOpen()')) === false);
const lockUi2 = await page.evaluate("(function(){ const a=document.getElementById('splash-cardlock-actions'); if(!a) return '(no card)'; const btn=a.querySelector('.cardlock-btn'); return btn ? btn.textContent : '(no btn)'; })()");
check('C4 开屏锁卡恢复锁定（输入密码解锁按钮）', lockUi2 === '输入密码解锁', JSON.stringify(lockUi2));
check('C5 全程无 JS 错误', pageErrors.length === 0, pageErrors[0] || '');

const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
browser.close().catch(() => {});
process.exit(pass === results.length ? 0 : 1);

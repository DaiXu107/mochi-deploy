// ===== 回归验证：摸鱼天数回退（v3.16.x 修复，2026-08-26） =====
// 背景：idbSet 异步 fire-and-forget，页面被杀/快速退出时 IDB 事务可能未完成 →
// IDB 的 fish-log 落后于 localStorage。idbRestore 回填用 IDB 旧值写 memoryCache
// （get 优先读 memoryCache）→ 桌面「已摸鱼 N 天」显示旧天数（如玩 4 天显示 2），
// 且后续 logFish 基于旧值追加 → 真实丢数据（vivo X 浏览器实测反馈）。
// 修复：retainValue/idbHydrateKey 中 LS 有值且未标记「LS 写失败」→ 以 LS 为准；
//       LS 写失败键记入 __ls-dirty（持久化 IDB），回填时信 IDB（保留 v3.16.x 语义）。
// 用法：node tools/verify-fish-days-restore.mjs   （BROWSER=webkit 可选）
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

const engine = process.env.BROWSER || 'chromium';
const channel = process.env.CHANNEL || undefined;
const { chromium, webkit } = await import('playwright');
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch(channel ? { channel } : undefined);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function boot() {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate('!!window.__mochiDataReady')) break;
    await sleep(300);
  }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
  // 回填是异步分批的，等它跑完（小键瞬间完成，多等一拍确保 retainValue 已执行）
  await sleep(1500);
}

async function seedFish(lsArr, idbArr, dirtyKeys, defArr) {
  if (!defArr) defArr = [];
  await page.evaluate(`(async function(){
    const KEY = 'xy-home-v2:fish-log';
    const DEF = 'xy-home-v2:default:fish-log';
    const DIRTY = 'xy-home-v2:__ls-dirty';
    const put = async (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} if (window.idbSet) await window.idbSet(k, v); };
    // 场景间隔离：清掉上一场景残留的脏标记与 default 副本（真实使用中由迁移/合并逻辑管理）
    if (window.idbDelete) await window.idbDelete(DIRTY);
    try { sessionStorage.removeItem(DIRTY); } catch (e) {}
    try { localStorage.removeItem(DIRTY); } catch (e) {}
    if (window.idbDelete) await window.idbDelete(DEF);
    try { localStorage.removeItem(DEF); } catch (e) {}
    await put(KEY, ${JSON.stringify(JSON.stringify(lsArr))});
    if (window.idbSet) await window.idbSet(KEY, ${JSON.stringify(JSON.stringify(idbArr))});
    if (${JSON.stringify(dirtyKeys)}.length) {
      if (window.idbSet) await window.idbSet(DIRTY, ${JSON.stringify(JSON.stringify(dirtyKeys))});
      try { sessionStorage.setItem(DIRTY, ${JSON.stringify(JSON.stringify(dirtyKeys))}); } catch (e) {}
    }
    if (${JSON.stringify(defArr)}.length) {
      if (window.idbSet) await window.idbSet(DEF, ${JSON.stringify(JSON.stringify(defArr))});
      try { localStorage.setItem(DEF, ${JSON.stringify(JSON.stringify(defArr))}); } catch (e) {}
    }
    return true;
  })()`);
  await sleep(800); // 等 idbSet 事务落地
}

async function readState() {
  return page.evaluate(`(async function(){
    const g = window.xyStore('xy-home-v2');
    const raw = g.get('fish-log');
    let arr = [];
    try { arr = JSON.parse(raw || '[]'); } catch (e) {}
    const el = document.getElementById('fish-days');
    let idb = null;
    if (window.idbGet) idb = await window.idbGet('xy-home-v2:fish-log');
    let dirty = null;
    if (window.idbGet) dirty = await window.idbGet('xy-home-v2:__ls-dirty');
    return { n: arr.length, ui: el ? el.textContent : null, raw: raw, idb: idb, dirty: dirty };
  })()`);
}

const D4 = ['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26'];
const D2 = ['2026-08-25', '2026-08-26'];
const D3 = ['2026-08-24', '2026-08-25', '2026-08-26'];

// ===== 场景 1（核心 bug）：IDB 落后于 LS（模拟杀后台导致 IDB 事务未完成）=====
await boot();
await seedFish(D4, D2, []);
await page.reload({ waitUntil: 'load', timeout: 25000 });
await sleep(1800);
let st = await readState();
check('场景1: IDB 落后 → 回填后摸鱼天数显示 4（修复前为 2）', st.ui === '4' && st.n === 4, 'ui=' + st.ui + ' n=' + st.n);

// 再模拟用户当天玩一次（logFish 读-改-写），确认基于正确值追加为 5 天、不丢历史
await page.evaluate(`(function(){ if (window.logFish) window.logFish(); return true; })()`);
await sleep(600);
st = await readState();
check('场景1: 修复后 logFish 追加不丢历史（4→5 天）', st.ui === '5' && st.n === 5, 'ui=' + st.ui + ' n=' + st.n);

// ===== 场景 2（脏键场景）：LS 写失败残留旧值、IDB 是新值 → 回填信 IDB =====
// 用联系人命名空间普通键验证（不受 migrateLegacy/migrateFishLogGlobal 业务合并影响）：
// dirty 标记 → retainValue 跳过 LS 用 IDB 值；fish-log 本身被 migrateFishLogGlobal
// 用 LS 抢先覆盖，此机制专为头像/字卡等无合并逻辑的键兜底。
await page.evaluate(`(async function(){
  const K = 'xy-home-v2:default:test-dirty-key';
  const DIRTY = 'xy-home-v2:__ls-dirty';
  try { localStorage.setItem(K, 'old-value'); } catch (e) {}
  if (window.idbSet) await window.idbSet(K, 'new-value');
  if (window.idbSet) await window.idbSet(DIRTY, JSON.stringify([K]));
  try { sessionStorage.setItem(DIRTY, JSON.stringify([K])); } catch (e) {}
  return true;
})()`);
await sleep(800);
await page.reload({ waitUntil: 'load', timeout: 25000 });
await sleep(1800);
const st2 = await page.evaluate(`(async function(){
  const v = window.xyStore('xy-home-v2:default').get('test-dirty-key');
  let idb = null; if (window.idbGet) idb = await window.idbGet('xy-home-v2:default:test-dirty-key');
  return { v: v, idb: idb };
})()`);
check('场景2: 脏键 → 回填信 IDB 显示新值', st2.v === 'new-value', 'v=' + st2.v + ' idb=' + st2.idb);
// 清理脏标记，避免污染后续场景
await page.evaluate(`(async function(){
  const DIRTY = 'xy-home-v2:__ls-dirty';
  if (window.idbDelete) await window.idbDelete(DIRTY);
  try { sessionStorage.removeItem(DIRTY); } catch (e) {}
  try { localStorage.removeItem(DIRTY); } catch (e) {}
  if (window.idbDelete) await window.idbDelete('xy-home-v2:default:test-dirty-key');
  try { localStorage.removeItem('xy-home-v2:default:test-dirty-key'); } catch (e) {}
  return true;
})()`);
await sleep(500);

// ===== 场景 3（正常一致）：LS = IDB = 3 条，无 default 残留 =====
await seedFish(D3, D3, [], []);
await page.reload({ waitUntil: 'load', timeout: 25000 });
await sleep(1800);
st = await readState();
check('场景3: LS 与 IDB 一致 → 显示 3', st.ui === '3' && st.n === 3, 'ui=' + st.ui + ' n=' + st.n);

// ===== 场景 4（用户真实场景）：default 残留旧值不得覆盖全局新值 =====
// 用户玩 4 天 → 全局 fish-log=4 条；default:fish-log 是早期 migrateLegacy 留下的 2 条旧值。
// 修复前：migrateLegacy 幂等检查命中 default 旧值 → 直接删全局 4 条 → 合并回 2 条 → 显示 2。
// 修复后（fish-log 加入 EXCLUDE）：全局 4 条不被迁移 → 显示 4。
await seedFish(D4, D4, [], D2);
await page.reload({ waitUntil: 'load', timeout: 25000 });
await sleep(1800);
st = await readState();
const dbg4 = await page.evaluate(`(function(){
  return {
    lsRaw: (function(){ try { return localStorage.getItem('xy-home-v2:fish-log'); } catch (e) { return null; } })(),
    defRaw: (function(){ try { return localStorage.getItem('xy-home-v2:default:fish-log'); } catch (e) { return null; } })()
  };
})()`);
check('场景4: default 旧值残留不覆盖全局 → 显示 4（修复前为 2）', st.ui === '4' && st.n === 4, 'ui=' + st.ui + ' n=' + st.n + ' ls=' + dbg4.lsRaw);

if (pageErrors.length) {
  console.log('页面 JS 异常 ' + pageErrors.length + ' 条：');
  pageErrors.slice(0, 5).forEach((e) => console.log('  - ' + String(e).slice(0, 200)));
}
const failed = results.filter((r) => !r.ok);
console.log('\n结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);

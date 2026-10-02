// ===== 验证脚本：#560 全新浏览器冷启动桌面第三页组件顺序（行为级） =====
// 症状（用户原话）：「从新的浏览器打开网页，桌面第三页不是小组件在上图标按钮在下，现在反了」，
// 多设备机型随机复现（时序竞态，非机型分支）。
// 根因：0ms buildDeskPages 收缩把第三页三组件扫进隐藏池 → 50ms ensureP3 先放回 p3apps
// → mochi-restore-done(~秒级) 回放 applyDeskLayout 时 restoreTemplateDesk 旧版逐个
// appendChild 到页尾 → 小组件排到图标组后面。谁先谁后不可控＝随机。
// 本脚本断言：全新存储冷启动后第三页顶层组件相对顺序恒为
//   desk-period(经期卡) → memo-row(备忘/心情行) → p3apps(功能图标组)，
// 连续多个全新 profile 加载以覆盖竞态；另含产物静态锚点断言（防「名字在、逻辑改坏」）。
// 环境变量：MOCHI_P3_ROOT=被测根目录（默认本仓库根，供临时副本收口前验证）；MOCHI_P3_LOADS=加载次数（默认 3）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_P3_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const LOADS = Math.max(1, Number(process.env.MOCHI_P3_LOADS || 3));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH（环境不满足）'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（环境不满足）'); process.exit(2); }

// ---- 静态断言：产物含 #560 修复逻辑锚点（ personalize.js 内唯一表达式） ----
let staticOk = true;
const assertNeedle = (label, file, needle) => {
  let hit = false;
  try {
    const src = readFileSync(join(root, file), 'utf8');
    const built = readFileSync(join(root, 'index.html'), 'utf8');
    const inSrc = src.includes(needle);
    const inBuilt = built.includes(needle);
    hit = inSrc && inBuilt;
    if (!inBuilt) console.log('  ✗ 产物缺锚点: ' + label + (inSrc ? '（src 在＝产物未接入，查 jsFiles）' : '（src 也没有＝修复丢失）'));
  } catch (e) { console.log('  ✗ 读取失败: ' + e.message); }
  if (hit) console.log('  ✓ ' + label);
  else staticOk = false;
};
assertNeedle('S1 #560 按快照分页归位（顺序重排主逻辑）', 'src/js/personalize.js',
  '(byPage[it.page] = byPage[it.page] || []).push(it.wid)');
assertNeedle('S2 #560 已在位且顺序一致则整体跳过（幂等零抖动）', 'src/js/personalize.js',
  'return i === 0 || idx > Array.prototype.indexOf.call(slide.children, nodes[i - 1]);');
assertNeedle('S3 #560 归位按快照原序依次插入', 'src/js/personalize.js',
  'if (addBtn) slide.insertBefore(n, addBtn); else slide.appendChild(n);');
if (!staticOk) { console.log('verify-desk-p3-fresh-order: FAIL（静态锚点缺失）'); process.exit(1); }

// ---- 行为断言：无头 Chrome 全新 profile 冷启动 ----
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
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = process.env.MOCHI_CDP_PORT ? Number(process.env.MOCHI_CDP_PORT) : (10400 + Math.floor(Math.random() * 400));

async function coldLoadOnce() {
  // FIX #560 配套：C 盘容量紧张（ENOSPC 事故后约定）——每轮用独立临时档案目录（保证全新
  // 冷启动语义）且 finally 即删，不遗留 %TEMP% 垃圾。
  const profileDir = join(process.env.TEMP || '/tmp', 'mochi-p3-fresh-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=' + cdpPort, 'about:blank'
  ], { stdio: 'ignore' });
  try {
    let ws = null; const pend = new Map(); let msgId = 0;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
        const page = list.find((t) => t.type === 'page');
        if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); break; }
      } catch (e) {}
      await sleep(150);
    }
    if (!ws) throw new Error('无法连接无头浏览器');
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
    const send = (method, params) => { const id = ++msgId; return new Promise((r) => { pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); }); };
    await send('Page.enable', {});
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(4000); // 晚于 ensureP3(50ms) 与 mochi-restore-done 回放（秒级）两条时序终点
    const r = await send('Runtime.evaluate', {
      returnByValue: true, awaitPromise: true,
      expression: `(function(){
        var box = document.getElementById('desktop-pages');
        var slides = box ? Array.prototype.slice.call(box.querySelectorAll('.page-slide')) : [];
        var p3 = slides[2] || null;
        var pool = document.getElementById('desk-widget-pool');
        var widOrder = p3 ? Array.prototype.slice.call(p3.children).map(function(n){ return n.getAttribute && n.getAttribute('data-desk-widget') || null; }).filter(Boolean) : null;
        var poolStrays = ['desk-period','memo-row','p3apps'].filter(function(w){
          var n = document.querySelector('[data-desk-widget="' + w + '"]');
          return !n || (pool && n.parentNode === pool);
        });
        var smoke = JSON.stringify({ slides: slides.length, p3order: widOrder, poolStrays: poolStrays });
        // T 系列（确定性）：把经期卡/备忘心情行打回隐藏池，再走 applyDeskLayout 无布局
        // 分支（restoreTemplateDesk）——复现「池内小组件 vs 已在位 p3apps」的归位场景，
        // 与冷启动竞态无关：旧逻辑逐个 appendChild 必排到图标组后，#560 逻辑按快照序归位。
        if (!p3 || !pool) return smoke + '|T:-no-p3';
        var dp = p3.querySelector('[data-desk-widget="desk-period"]');
        var mr = p3.querySelector('[data-desk-widget="memo-row"]');
        if (dp) pool.appendChild(dp);
        if (mr) pool.appendChild(mr);
        try { window.applyDeskLayout(); } catch (e) { return smoke + '|T:-throw'; }
        return new Promise(function (res) {
          setTimeout(function () {
            var order = Array.prototype.slice.call(p3.children).map(function (n) { return n.getAttribute('data-desk-widget'); }).filter(Boolean);
            res(smoke + '|T:' + order.join(','));
          }, 300);
        });
      })()`
    });
    try { ws.close(); } catch (e) {}
    const idx = String(r.result.value).indexOf('|T:');
    return { smoke: JSON.parse(String(r.result.value).slice(0, idx)), tOrder: String(r.result.value).slice(idx + 3) };
  } finally {
    try { chrome.kill(); } catch (e) {}
    try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
  }
}

let pass = 0, fail = 0;
const expect = ['desk-period', 'memo-row', 'p3apps'];
const orderOkArr = (arr) => Array.isArray(arr) && expect.every((w) => arr.indexOf(w) >= 0) &&
  expect.every((w, k) => k === 0 || arr.indexOf(w) > arr.indexOf(expect[k - 1]));
for (let i = 1; i <= LOADS; i++) {
  let snap;
  try { snap = await coldLoadOnce(); } catch (e) {
    console.log('  ✗ 第' + i + '次冷启动环境失败（不算回归）: ' + e.message);
    continue;
  }
  const smokeOk = snap.smoke.slides >= 3 && orderOkArr(snap.smoke.p3order) && snap.smoke.poolStrays.length === 0;
  const tOk = snap.tOrder === expect.join(',');
  if (smokeOk) { pass++; console.log('  ✓ 第' + i + '次冷启动冒烟：第三页顺序 ' + snap.smoke.p3order.join(',') + '（页数 ' + snap.smoke.slides + '）'); }
  else { fail++; console.log('  ✗ 第' + i + '次冷启动冒烟：顺序=' + JSON.stringify(snap.smoke.p3order) + ' 页数=' + snap.smoke.slides + ' 池残留=' + JSON.stringify(snap.smoke.poolStrays)); }
  if (tOk) { pass++; console.log('  ✓ T 第' + i + '次：池内组件归位走 restoreTemplateDesk 后顺序 ' + snap.tOrder); }
  else { fail++; console.log('  ✗ T 第' + i + '次：restoreTemplateDesk 归位后顺序=' + JSON.stringify(snap.tOrder) + '（期望 经期卡→备忘心情→图标组）'); }
}
server.close();
console.log('verify-desk-p3-fresh-order: ' + pass + ' 过 / ' + fail + ' 败（共 ' + LOADS + ' 次全新冷启动×冒烟+T）');
process.exit(fail > 0 ? 1 : (pass > 0 ? 0 : 2));

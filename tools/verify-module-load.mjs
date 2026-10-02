// ===== 回归：#527 模块加载体检（诊断「启动文件异常」带文件名 + 语法错致整段未加载可自查）=====
// 用法：node build.mjs && node tools/verify-module-load.mjs
// 背景：每个功能文件包在 (function(){try{...}catch})() 里，但语法错误在 parse 期抛出，
//   包内 try/catch 兜不住（__jsErrors 永远看不到），且每个 500KB script 块内任一文件
//   语法错会整块不执行——「启动文件异常：无」与「功能整块没了」因此能并存。
// 修复：build 期注入 __mochiJsFiles（=jsFiles 期望）+ 每文件包内 try 末行登记 __mochiLoaded
//   （整段跑完才到），catch 里 __jsErrors 追加文件名；运行期差集定位整段未加载的文件。
// 断言：
//   A1 产物注入了 __mochiJsFiles，且等于 build.mjs 的 jsFiles（构建↔源码一致）
//   A2 正常加载后 __mochiLoaded 覆盖全部期望文件（missing 为空）
//   A3 window.mochiModuleCheck() 可用且给出缺失清单
//   A4 判别力：从 __mochiLoaded 摘掉一个文件后，mochiModuleCheck 能报出它（差集真的在算）
//   A5 静态：产物含 __mochiLoaded.push 与带文件名的 __jsErrors.push
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const mJs = /const jsFiles = \[([\s\S]*?)\];/.exec(buildSrc);
const expectFiles = mJs ? (mJs[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)) : null;
if (!expectFiles || !expectFiles.length) { console.error('无法从 build.mjs 解析 jsFiles'); process.exit(1); }

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-527-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
for (let i = 0; i < 40; i++) {
  const ok = await evalJs("!!(window.__mochiJsFiles && Array.isArray(window.__mochiLoaded) && window.__mochiLoaded.length)");
  if (ok) break;
  await sleep(200);
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// A1 期望清单 = build.mjs jsFiles
const pageExpect = await evalJs('JSON.stringify(window.__mochiJsFiles || null)');
const pageExpectArr = pageExpect ? JSON.parse(pageExpect) : null;
check('A1 产物注入 __mochiJsFiles 且等于 build.mjs jsFiles',
  Array.isArray(pageExpectArr) && JSON.stringify(pageExpectArr) === JSON.stringify(expectFiles),
  'page=' + (pageExpectArr ? pageExpectArr.length : 'null') + ' src=' + expectFiles.length);

// A2 全部加载
const mc = JSON.parse(await evalJs('JSON.stringify(window.mochiModuleCheck ? window.mochiModuleCheck() : null)') || 'null');
check('A2 正常加载后无缺失文件（__mochiLoaded 覆盖全部期望）',
  mc && Array.isArray(mc.missing) && mc.missing.length === 0,
  mc ? ('loaded=' + mc.loaded.length + '/' + mc.expected.length + ' missing=' + JSON.stringify(mc.missing)) : 'null');
check('A3 mochiModuleCheck 可用', !!(mc && mc.expected && mc.loaded), '');

// A4 判别力：摘掉 chat.js 后必须报出来
const probe = JSON.parse(await evalJs(`(function(){
  try {
    if (!window.__mochiLoaded) return 'null';
    var i = window.__mochiLoaded.indexOf('chat.js');
    var saved = i >= 0 ? window.__mochiLoaded.splice(i, 1)[0] : null;
    var r = window.mochiModuleCheck();
    if (saved) window.__mochiLoaded.push(saved);
    return JSON.stringify({ missing: r ? r.missing : null, restored: !!saved });
  } catch (e) { return JSON.stringify({ err: e.message }); }
})()`) || '{}');
check('A4 摘掉 chat.js 后 mochiModuleCheck 能报出（差集判别力）',
  !!probe && Array.isArray(probe.missing) && probe.missing.indexOf('chat.js') >= 0 && probe.restored === true,
  JSON.stringify(probe));

// A5 静态：产物含加载登记与带文件名的错误登记
const product = readFileSync(join(root, 'index.html'), 'utf8');
check('A5 产物含 __mochiLoaded.push 登记', product.includes('window.__mochiLoaded.push('), '');
check('A5 产物含带文件名的 __jsErrors.push', product.includes('window.__jsErrors.push("['), '');

const failed = results.filter(r => !r.ok);
console.log('\n===== 回归结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);

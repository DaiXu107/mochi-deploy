// ===== 验证脚本：#279 自动升级防打断——重载落地前复核用户活动 =====
// 用法：node build.mjs && node tools/verify-auto-upgrade-guard.mjs
//   （跑的是仓库根目录产物 index.html；未构建时本脚本会红，红的是产物不是源码）
//
// 复现目标（用户报 iQOO12 Chrome「不清楚问题的bug」＝诊断实证「页面在使用中途自己重载回
//   开屏、问答门被迫重答」，用户明说其他设备型号也有）：#273 冷加载自动升级 tryAutoUpgrade
//   → refreshNow() 的 reload 在 PRECACHE_NOW 预取完成那一刻无条件落地，弱网预取 3.6MB+
//   index.html 可耗时几十秒，正好砸进用户已开始的会话（打字/切页/正答问答门）。
// 修复：pwa.js 捕获级记录本页面首次交互（touchstart/pointerdown/mousedown/keydown），
//   自动重载落地前 autoReloadAllowed() 复核——用户已操作且前台时放弃重载、退回常驻更新条；
//   页面 hidden 或零交互放行（保留 #273「冷加载一跳进新版」快路径）。
//
// P1 全新加载零交互 → __pwaAutoUpgradeTest.allowed() === true（快路径保留）
// P2 派发真实 mousedown → allowed() === false（自动重载会让路）
// P3 重新加载后派发 touchstart（真机主路径）→ allowed() === false
// P4 产物接线静态锚：守卫表达式 + 探针 + pageshow 传 ts（与 build.mjs 哨兵互为补充）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// P4：静态接线（读产物，防「修复在 src、产物没接上」）
const html = readFileSync(join(root, 'index.html'), 'utf8');
const statics = [
  ['守卫表达式', 'auto && !autoReloadAllowed()'],
  ['活动探针', '__pwaAutoUpgradeTest'],
  ['pageshow 传 ts（放弃时能带版本退回更新条）', '!tryAutoUpgrade(ts)'],
].map(([desc, needle]) => ({ desc, needle, ok: html.includes(needle) }));
statics.forEach((s) => console.log((s.ok ? 'PASS' : 'FAIL') + '  [静态] ' + s.desc + '  [' + s.needle + ']'));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node 21+（内置 WebSocket），当前 Node ' + process.version);
  process.exit(1);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-auto-upgrade-guard-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  eval 异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function waitProbe() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 40; i++) {
    if (await evalJs('!!window.__pwaAutoUpgradeTest')) return true;
    await sleep(300);
  }
  return false;
}
async function allowed() { return evalJs('window.__pwaAutoUpgradeTest ? window.__pwaAutoUpgradeTest.allowed() : null'); }

const results = [];
function check(desc, ok) {
  results.push(!!ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc);
}

// P1：全新加载、零交互（不派发任何输入事件）→ 自动重载放行（#273 快路径保留）
if (await waitProbe()) {
  const a1 = await allowed();
  check('P1 全新加载零交互 allowed()=true（got ' + JSON.stringify(a1) + '）', a1 === true);

  // P2：派发真实 mousedown（capture 级监听应捕获）→ 拦截自动重载
  await evalJs("document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
  const a2 = await allowed();
  check('P2 派发 mousedown 后 allowed()=false（got ' + JSON.stringify(a2) + '）', a2 === false);
} else {
  check('P1 页面加载（探针 __pwaAutoUpgradeTest 出现）', false);
  check('P2 （前置失败跳过）', false);
}

// P3：重新加载（探针状态随新页面重置）→ 派发 touchstart（真机主路径）→ 拦截
if (await waitProbe()) {
  const fresh = await allowed();
  const a3r = await evalJs("document.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }))");
  const a3 = await allowed();
  check('P3 重载后零交互 allowed()=true 且 touchstart 后 allowed()=false（got ' + JSON.stringify([fresh, a3]) + ' touchEv=' + a3r + '）', fresh === true && a3 === false);
} else {
  check('P3 页面重新加载', false);
}

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const staticOk = statics.every((s) => s.ok);
const allOk = results.every(Boolean) && staticOk;
console.log(allOk ? '✅ 全部通过（P1-P4）' : '❌ 存在失败项');
process.exit(allOk ? 0 : 1);

// ===== 验证：#146 删除「一键随机美化」+ widget-opacity 小数脏值自愈 =====
// 回归背景（用户反馈）：
//   1) 点【随机美化】后桌面小组件全透明 —— 随机美化把 widget-opacity 写成小数（如 "0.9"/"1"），
//      读取点 parseInt 按百分比解析 → parseInt("0.9")=0 → --widget-opacity:0。
//   2) 【恢复默认布局】救不回来 —— 该键属美化键，恢复默认布局只清 desk-layout。
// 修复：
//   a) 「一键随机美化」功能整体删除（row-beauty-random / dq-random 入口与处理块）。
//   b) opacityRawToPct 统一解析（≤1 按 ×100 换算）+ 启动时历史脏值改写为百分比存储。
// 用法：node tools/verify-widget-opacity.mjs（需先 node build.mjs，需本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-widgetop-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: String(r.exceptionDetails.text || '') };
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function waitReady() {
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
  await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(800);
}
async function load() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
}
// 预置脏值后刷新（走 activeStore 联系人命名空间，与真实写入路径一致）
async function seedAndReload(key, val) {
  await ev('(function(){var s=window.activeStore();s.set(' + JSON.stringify(key) + ',' + JSON.stringify(val) + ');return true;})()');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
}
const storedOp = "(function(){return window.activeStore().get('widget-opacity');})()";
const appliedOp = "(function(){return document.documentElement.style.getPropertyValue('--widget-opacity')||'(unset)';})()";
const cardOpacity = "(function(){var c=document.querySelector('.mini-card');return c?getComputedStyle(c).opacity:'(no card)';})()";

// ============ 用例 1：历史脏值 "0.9" → 启动自愈为 90%，小组件可见 ============
console.log('\n===== 用例1 脏值 "0.9" 自愈 =====');
await load();
await seedAndReload('widget-opacity', '0.9');
check('启动后存储值已改写为百分比 90', (await ev(storedOp)) === '90', 'stored=' + String(await ev(storedOp)));
check('--widget-opacity 应用为 0.9（不是 0）', (await ev(appliedOp)) === '0.9', 'applied=' + String(await ev(appliedOp)));
const cop1 = await ev(cardOpacity);
check('小组件 computed opacity=0.9（可见，不再全透明）', cop1 === '0.9', 'computed=' + String(cop1));

// ============ 用例 2：历史脏值 "1" → 自愈为 100% 不透明 ============
console.log('\n===== 用例2 脏值 "1" 自愈 =====');
await seedAndReload('widget-opacity', '1');
check('启动后存储值已改写为 100', (await ev(storedOp)) === '100', 'stored=' + String(await ev(storedOp)));
const cop2 = await ev(cardOpacity);
check('小组件 computed opacity=1（完全可见）', cop2 === '1', 'computed=' + String(cop2));

// ============ 用例 3：正常百分比 "80" 不被误改（回归守护） ============
console.log('\n===== 用例3 正常值 "80" 不受影响 =====');
await seedAndReload('widget-opacity', '80');
check('存储值保持 80', (await ev(storedOp)) === '80', 'stored=' + String(await ev(storedOp)));
check('--widget-opacity 应用为 0.8', (await ev(appliedOp)) === '0.8', 'applied=' + String(await ev(appliedOp)));

// ============ 用例 4：随机美化入口已删除 ============
console.log('\n===== 用例4 功能删除 =====');
const gone = await ev("(function(){return JSON.stringify({row:!!document.getElementById('row-beauty-random'),btn:!!document.getElementById('dq-random')});})()");
check('row-beauty-random 与 dq-random 均已不存在', gone === '{"row":false,"btn":false}', String(gone));

const passN = results.filter(r => r.ok).length;
console.log('\n===== 结果: ' + passN + '/' + results.length + ' =====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(passN === results.length ? 0 : 1);

// verify-bg-notify-settle.mjs —— #614 后台通知发送链「永不落地」加固
// 症状（用户报障，红米K80 Chrome，明说其他机型也有）：后台通知「点测试没反应」+ 后台弹窗不再弹。
// 根因：showSysNotification 唯一等 navigator.serviceWorker.ready 的 .then 才发通知/出结果；
//   SW 被系统回收 / 弱网注册失败 / active worker 不可用时，ready 永远 pending（无 catch 可兜）
//   ⇒ 测试按钮无任何反馈、后台通知永远发不出去。
// 断言：
//   A 静态锚：kaWithTimeout / kaSWReady 存在；ready 与 showNotification 都接超时；
//            ready 拿不到现役 SW 时走 pageFallback；测试按钮点击即时反馈文案在位。
//   B0 正常路径：点测试 → 8s 内出「测试结果」且含「测试通知已发送（Service Worker）」。
//   B1 SW 不可用（ready 恒 pending 的桩）：点测试 1s 内先出「正在检查通知环境…」，
//      8s 内仍必出「测试结果」（修复前恒无结果＝RED）。
//   B2 点击即时反馈；B3 全程 0 JS 异常。
// 用法：node build.mjs && node tools/verify-bg-notify-settle.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(process.env.VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = 10800 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-nst-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails); return r && r.result ? r.result.value : null; };
let pass = 0, fail = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) { pass++; console.log('PASS  ' + n + (extra ? '  [' + extra + ']' : '')); } else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); console.log('FAIL  ' + n + (extra ? '  [' + extra + ']' : '')); } };

// ---------- A 静态锚 ----------
const src = readFileSync(join(root, 'src/js/bg-keep.js'), 'utf8');
A('A1 kaWithTimeout 超时助手在位', src.includes('function kaWithTimeout(p, ms) {'));
A('A2 kaSWReady 自愈就绪助手在位', src.includes('function kaSWReady() {'));
A('A3 ready 接超时', src.includes('kaWithTimeout(navigator.serviceWorker.ready, 4000)'));
A('A4 ready 空值单通道（#1291 换锚：隐藏态只挂补发队列、不再同时走页面通道；前台仍走 pageFallback）', src.includes("if (hidden) { swNotifyLater(title, opts, chanOut); note('none'); resolve(false); } else { pageFallback(); }"));
A('A5 showNotification 接超时（#673 改 thunk 形态、#705 修 kaWithTimeout 兼容）', src.includes('kaWithTimeout(function () { return reg.showNotification(title, attempt); }, 4000)'));
A('A6 测试按钮即时反馈文案在位', src.includes("toast('正在检查通知环境…');"));

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function load(swStub) {
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: swStub ? `Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: true, get: function () { return window.__swStub; } });
window.__swStub = { controller: null, ready: new Promise(function () {}), getRegistration: function () { return Promise.resolve({ active: null, installing: null, waiting: null, addEventListener: function () {}, showNotification: function () { return Promise.reject(new Error('no-sw')); } }); }, register: function () { return Promise.resolve(null); }, addEventListener: function () {}, removeEventListener: function () {}, getRegistrations: function () { return Promise.resolve([]); } };` : 'void 0;'
  });
  await cdp('Page.navigate', { url: base + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
}
const toastText = () => ev("(function(){var t=document.getElementById('cc-toast'); return t ? (t.textContent||'') : '';})()");

// ---------- B0 正常路径 ----------
await load(false);
A('B0.0 测试按钮在位', await ev("!!document.getElementById('bg-notify-test')"));
await ev("document.getElementById('bg-notify-test').click()");
let tt = '';
for (let i = 0; i < 16; i++) { await sleep(500); tt = await toastText(); if (tt.indexOf('测试结果') >= 0 || tt.indexOf('环境检查') >= 0) break; }
A('B0.1 正常路径 8s 内出结果', tt.indexOf('测试结果') >= 0 || tt.indexOf('环境检查') >= 0, tt.split('\n')[0]);
A('B0.2 正常路径经 SW 发送成功', tt.indexOf('测试通知已发送') >= 0, (tt.match(/(?:✓|✗)[^\n]*通知已发送[^\n]*/) || [''])[0]);
A('B1 正常路径 0 JS 异常', (await ev('(window.__jsErrors&&window.__jsErrors.length)||0')) === 0);

// ---------- B1 SW 不可用（ready 恒 pending）----------
await load(true);
await ev("document.getElementById('bg-notify-test').click()");
await sleep(700);
const early = await toastText();
A('B2.0 点击后 0.7s 即有即时反馈', early.indexOf('正在检查通知环境') >= 0 || early.indexOf('测试结果') >= 0 || early.indexOf('环境检查') >= 0, early.split('\n')[0]);
tt = '';
for (let i = 0; i < 20; i++) { await sleep(500); tt = await toastText(); if (tt.indexOf('测试结果') >= 0 || tt.indexOf('环境检查') >= 0) break; }
A('B2.1 SW 不可用时仍必然出结果（修复核心；修前恒无）', tt.indexOf('测试结果') >= 0 || tt.indexOf('环境检查') >= 0, tt.split('\n')[0]);
A('B2.2 SW 不可用时无 JS 异常', (await ev('(window.__jsErrors&&window.__jsErrors.length)||0')) === 0);

console.log('\n' + pass + ' pass / ' + fail + ' fail');
if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n'));
ws.close(); chrome.kill(); server.close();
process.exit(fail ? 1 : 0);

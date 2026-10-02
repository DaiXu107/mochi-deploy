// 冒烟：diag-storage.html 无报错且各表格填充
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return readFileSync(p); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

let ws = null, msgId = 0;
const pend = new Map();
const errors = [];
const cdpPort = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-diagtest-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || ''));
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
      };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr, awaitPromise = false) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  return r && r.result ? r.result.value : null;
}

await cdp('Page.enable');
await cdp('Runtime.enable');
// 预置一点数据让 IDB 扫描有东西可读
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
await evalJs(`window.idbSet && window.idbSet('xy-home-v2:test-key', 'x'.repeat(50000))`, true);
await sleep(800);

await cdp('Page.navigate', { url: baseUrl + '/diag-storage.html' });
await sleep(4000);

const checks = [];
function check(name, ok) { checks.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); }
check('无 JS 异常', errors.length === 0);
if (errors.length) console.log('  异常: ' + errors.join(' | ').slice(0, 300));
const devRows = await evalJs(`document.getElementById('t-dev').children.length`);
check('设备表有行', devRows > 0);
const estBig = await evalJs(`document.getElementById('est-big').textContent`);
check('storage.estimate 有值', !!estBig && estBig !== '…' && estBig !== '不可用');
const lsRows = await evalJs(`document.querySelectorAll('#t-ls tr').length`);
check('localStorage 表有行', lsRows >= 2);
const idbRows = await evalJs(`document.querySelectorAll('#t-idb tr').length`);
check('IndexedDB 表有行（含 test-key）', idbRows >= 3);
const testKeyShown = await evalJs(`document.getElementById('t-idb').textContent.indexOf('test-key') >= 0`);
check('扫到预置键 test-key', testKeyShown);
const swRows = await evalJs(`document.getElementById('t-sw').children.length`);
check('SW/缓存表有行', swRows > 0);
await evalJs(`document.getElementById('btn-copy').click(); 1`);
await sleep(300);
const repLen = await evalJs(`(function(){var ta=document.getElementById('report');return ta.value.length;})()`);
check('报告文本已生成', repLen > 100);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = checks.filter(c => !c).length;
console.log('\n结果：' + (checks.length - fails) + '/' + checks.length + ' 通过');
process.exit(fails ? 1 : 0);

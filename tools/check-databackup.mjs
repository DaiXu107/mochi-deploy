// ===== 验证脚本：无头 Chrome 检查数据备份功能（导出/导入入口）是否正常 =====
// 用法：node build.mjs && node tools/check-databackup.mjs
// 检查：页面无未捕获 JS 异常、activePrefix/runBackupExport 存在、
//       row-export/row-import 已绑定、模拟点击导出/导入不抛异常。
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
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，设置 CHROME_PATH'); process.exit(1); }

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

const cdpPort = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dbcheck-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const pageErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails;
            pageErrors.push('exception: ' + (d.exception && d.exception.description || d.text));
          }
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            pageErrors.push('console.error: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
async function cdpSend(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return await new Promise((res) => { pend.set(id, res); });
}
async function evalJs(expr) {
  const r = await cdpSend('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result ? r.result.value : undefined;
}

await cdpConnect();
await cdpSend('Runtime.enable');
await cdpSend('Page.enable');
await cdpSend('Page.navigate', { url: baseUrl + '/index.html' });

// 等开屏数据就绪（最多 30s）
let ready = false;
for (let i = 0; i < 200; i++) {
  await sleep(150);
  ready = await evalJs('!!window.__mochiDataReady');
  if (ready) break;
}
console.log('数据就绪: ' + (ready ? 'YES' : 'NO (超时)'));

const checks = {
  'activePrefix 存在': await evalJs('typeof window.activePrefix === "function"'),
  'runBackupExport 存在': await evalJs('typeof window.runBackupExport === "function"'),
  'row-export 元素': await evalJs('!!document.getElementById("row-export")'),
  'row-import 元素': await evalJs('!!document.getElementById("row-import")')
};
// 监听器无法直接枚举，用"点击后出范围选择弹窗"间接验证绑定
// （v3.36.x #577 起：点「导出数据」先弹「选择导出范围」——完整备份/不含音乐/只备份文字/
//  仅聊天记录/取消，不再像原来那样直接开导，所以这里断言弹窗与胶囊，而不是 toast）
const before = pageErrors.length;
await evalJs('(function(){var el=document.getElementById("row-export");if(el){el.click();return true;}return false;})()');
await sleep(2500);
const toastText = await evalJs('(function(){var t=document.getElementById("cc-toast");return t ? (t.textContent + "|" + t.className) : "NO_TOAST";})()');
const modalOpen = await evalJs('(function(){var m=document.getElementById("modal-mask");return !!m && !m.hidden;})()');
const pillText = await evalJs('(function(){var p=document.getElementById("modal-pills");return p ? p.textContent : "";})()');
checks['点击导出弹出范围选择（含「仅聊天记录」）'] =
  !!modalOpen && String(pillText).indexOf('仅聊天记录') >= 0 && String(pillText).indexOf('完整备份') >= 0;
checks['导出流程无新增 JS 异常'] = pageErrors.length === before;

// 导入：模拟点击（无头环境文件选择器不弹，但不应抛异常）
const before2 = pageErrors.length;
await evalJs('(function(){var el=document.getElementById("row-import");if(el){el.click();return true;}return false;})()');
await sleep(1500);
const impPillText = await evalJs('(function(){var p=document.getElementById("modal-pills");return p ? p.textContent : "";})()');
checks['点击导入弹出范围选择（含「仅聊天记录（全部桌面联系人）」）'] =
  String(impPillText).indexOf('仅聊天记录') >= 0;
checks['点击导入无新增 JS 异常'] = pageErrors.length === before2;

let pass = 0, fail = 0;
for (const [k, v] of Object.entries(checks)) {
  const ok = !!v;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + k + (ok ? '' : '  [' + JSON.stringify(v) + ']'));
  ok ? pass++ : fail++;
}
if (toastText !== 'NO_TOAST') console.log('INFO  toast=' + toastText);
if (pageErrors.length) { console.log('--- 页面 JS 异常 ---'); pageErrors.forEach(e => console.log('  ' + e)); }
console.log('结果：' + pass + '/' + (pass + fail) + ' 通过');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);

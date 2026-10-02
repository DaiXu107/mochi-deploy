// ===== 验证：feedRootRescue——存量用户 default: 滞留副本搬回根命名空间 =====
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-feedrescue-' + Date.now()),
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}

// 存量受害用户状态：根键已被 migrateLegacy 删掉，default: 有滞留副本
const boot = `
(function () {
  var notices = JSON.stringify([{ type: 'comment', pid: 'p1', text: '小桃 回复了你：在呀', ts: Date.now() - 1000, read: false, owner: 'default' }]);
  localStorage.setItem('xy-home-v2:default:feed-notices', notices);
  localStorage.setItem('xy-home-v2:default:feed-app-unread', '2');
  localStorage.setItem('xy-home-v2:default:feed-user-name', '阿珍');
  localStorage.removeItem('xy-home-v2:feed-notices');
  localStorage.removeItem('xy-home-v2:feed-app-unread');
  localStorage.removeItem('xy-home-v2:feed-user-name');
})();
`;
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(2000);
const r = await evalJs(`(function(){
  return JSON.stringify({
    rootNotices: (localStorage.getItem('xy-home-v2:feed-notices') || 'null').slice(0, 120),
    rootUnread: localStorage.getItem('xy-home-v2:feed-app-unread'),
    rootUserName: localStorage.getItem('xy-home-v2:feed-user-name'),
    defNotices: localStorage.getItem('xy-home-v2:default:feed-notices'),
    defUnread: localStorage.getItem('xy-home-v2:default:feed-app-unread'),
    badgeHidden: (function(){ var b = document.getElementById('feed-badge'); return b ? b.hidden : 'nobadge'; })()
  });
})()`);
console.log('回收后: ' + r);
const ok = (() => { try { const o = JSON.parse(r); return o.rootNotices.indexOf('在呀') >= 0 && o.rootUnread === '2' && o.rootUserName === '阿珍' && o.defNotices === null && o.defUnread === null && o.badgeHidden === false; } catch (e) { return false; } })();
console.log(ok ? '✅ 回收通过' : '❌ 回收失败');
chrome.kill(); server.close();
process.exit(ok ? 0 : 1);

// ===== 验证：人在朋友圈页内，TA 回复评论 → 页内 cc-toast 轻提示 =====
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-feedtoast-' + Date.now()),
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
const boot = `
(function () {
  var T = Date.now();
  var post = { id: 'f_toast_test', role: 'me', owner: 'default', authorName: '我', authorAv: '', taName: '小桃', taAv: '', content: '正文', imgs: [], ts: T - 60000, likes: [], comments: [
    { role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', content: 'TA的评论', ts: T - 30000, replies: [] }
  ] };
  localStorage.setItem('xy-home-v2:feed-posts', JSON.stringify([post]));
  localStorage.setItem('xy-home-v2:default:feed-posts-snap', JSON.stringify([post]));
  var s = 'xy-home-v2:default:';
  localStorage.setItem(s + 'reply-fd-reply-prob', '100');
  localStorage.setItem(s + 'reply-fd-reply-speed-min', '1.2');
  localStorage.setItem(s + 'reply-fd-reply-speed-max', '1.5');
  localStorage.setItem(s + 'lbl-partner', '小桃');
  localStorage.setItem('xy-home-v2:feed-notices', '[]');
  localStorage.setItem('xy-home-v2:feed-app-unread', '0');
})();
`;
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);
await evalJs(`(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return !!b;})()`);
await sleep(300);
await evalJs(`(function(){var s=document.getElementById('splash');if(s&&!s.hidden)s.hidden=true;return true;})()`);
await sleep(200);
await evalJs(`(function(){var a=document.querySelector('.app[data-app="feed"]');if(a)a.click();return !!a;})()`);
await sleep(900);
await evalJs(`(function(){var c=document.querySelector('#feed-list .feed-comment');if(c)c.click();return !!c;})()`);
await sleep(300);
await evalJs(`(function(){var i=document.getElementById('feed-comment-input');if(i)i.value='好呀好呀';var b=document.getElementById('feed-comment-send');if(b)b.click();return true;})()`);
await sleep(3500); // 停在朋友圈页内等回复
const r = await evalJs(`(function(){
  var t = document.getElementById('cc-toast');
  var badge = document.getElementById('feed-badge');
  return JSON.stringify({ toastShown: !!(t && t.classList.contains('show')), toastText: t ? t.textContent : '', badge: badge && !badge.hidden ? badge.textContent : 'none' });
})()`);
console.log('页内回复后: ' + r);
let ok = false;
try { const o = JSON.parse(r); ok = o.toastShown && o.toastText.indexOf('小桃 回复了你') >= 0 && o.badge !== 'none'; } catch (e) {}
console.log(ok ? '✅ 页内轻提示通过' : '❌ 页内轻提示失败');
chrome.kill(); server.close();
process.exit(ok ? 0 : 1);

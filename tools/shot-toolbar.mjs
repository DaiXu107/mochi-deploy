import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });

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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-shot-' + Date.now()),
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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }); return r && r.result ? r.result.value : null; }

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

for (const [label, w, h] of [['390x844', 390, 844], ['360x640', 360, 640]]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  await evalJs(`document.getElementById('splash-confirm-ok')?.click()`);
  await sleep(800);
  await evalJs(`document.querySelector('.app[data-app="garden"]')?.click()`);
  await sleep(1200);

  const layout = await evalJs(`(() => {
    const tb = document.getElementById('garden-toolbar');
    if (!tb) return 'no toolbar';
    const rect = tb.getBoundingClientRect();
    const btns = [...tb.querySelectorAll('.garden-tool')].map(b => {
      const r = b.getBoundingClientRect();
      return { label: b.querySelector('.garden-tool-label')?.textContent, x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width) };
    });
    const vw = window.innerWidth;
    const scrollW = tb.scrollWidth;
    return JSON.stringify({ tbX: Math.round(rect.x), tbRight: Math.round(rect.right), tbW: Math.round(rect.width), vw, scrollW, overflow: rect.right > vw, btns });
  })()`);
  console.log(`[${label}]`, layout);

  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`tools/shot-tb-${w}.png`, Buffer.from(shot.result.data, 'base64'));
}

ws.close();
chrome.kill();
server.close();
process.exit(0);

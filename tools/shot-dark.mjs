// 深色模式视觉抽检截图：node tools/shot-dark.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
let chromePath = process.env.CHROME_PATH;
if (!chromePath) {
  for (const p of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']) {
    try { if (statSync(p).isFile()) { chromePath = p; break; } } catch (e) {}
  }
}
const cdpPort = 9950 + Math.floor(Math.random() * 49);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-shot-dark-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true }); return r && r.result ? r.result.value : null; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(1500);
await evalJs("(function(){try{localStorage.setItem('xy-home-v2:theme-mode','dark')}catch(e){};return 1})()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var ok=document.getElementById('splash-confirm-ok');if(ok)ok.click();}c=document.getElementById('splash-confirm');if(c)c.hidden=true;return 1;})()");
await sleep(1000);
mkdirSync(join(root, 'tools'), { recursive: true });
async function shot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(root, 'tools', name), Buffer.from(r.data, 'base64'));
  console.log('saved', name);
}
await shot('shot-dark-home.png');
// 聊天页（直接显示，不点返回）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return 1;})()");
await sleep(800);
await shot('shot-dark-chat.png');
// 点返回后出现的页面（识别 id）
const vis = await evalJs("(function(){var b=document.getElementById('ch-back');if(b)b.click();return 1;})()");
await sleep(800);
console.log('visible pages:', await evalJs("(function(){var v=[];document.querySelectorAll('.page').forEach(function(p){if(!p.hidden)v.push(p.id)});var d=document.querySelector('.phone');return v.join(',')+' | phone children vis:'+Array.prototype.map.call(d.children,function(c){return c.id+(c.hidden?'(h)':'(v)')}).join(',');})()"));
await shot('shot-dark-after-back.png');
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(0);

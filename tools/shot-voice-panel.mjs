import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2] || process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
const { spawn } = await import('node:child_process');
const { createServer } = await import('node:http');
const { rmSync } = await import('node:fs');
const { normalize, extname } = await import('node:path');
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
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
const cdpPort = 9800 + Math.floor(Math.random() * 100);
const tmpProfile = join(process.env.TEMP || '/tmp', 'mochi-vshot-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + tmpProfile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {} });
let ws = null, msgId = 0;
const pend = new Map();
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result ? r.result.value : null;
}
async function shot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(process.env.TEMP, 'opencode', name), Buffer.from(r.data, 'base64'));
  console.log('saved ' + name);
}
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();var c=document.getElementById('splash-confirm-ok');if(c)c.click();return 1;})()");
await sleep(800);
await evalJs("(function(){try{window.enterChat();}catch(e){}return 1;})()");
await sleep(700);
await evalJs("(function(){window.activeStore().set('cs-voice-send','1');document.dispatchEvent(new Event('voice-send-changed'));return 1;})()");
await sleep(300);
await shot('voice-1-idle-inputrow.png');
await evalJs("(function(){document.getElementById('chat-mic-btn').click();return 1;})()");
await sleep(400);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(2200);
await shot('voice-2-recording.png');
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(1200);
await shot('voice-3-preview.png');
await evalJs("(function(){document.getElementById('voice-send-btn').click();return 1;})()");
await sleep(900);
await shot('voice-4-sent-bubble.png');
// 深色模式
await evalJs("(function(){try{localStorage.setItem('xy-home-v2:theme-mode','dark');document.documentElement.setAttribute('data-theme','dark');window.activeStore().set('cs-voice-send','1');document.dispatchEvent(new Event('voice-send-changed'));document.getElementById('chat-mic-btn').click();return 1;}catch(e){return String(e);}})()");
await sleep(500);
await shot('voice-5-dark.png');
chrome.kill();
try { server.close(); } catch (e) {}
process.exit(0);

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'docs', 'room-preview');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome/edge'); process.exit(1); }

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
const base = 'http://127.0.0.1:' + server.address().port;
const port = 9700 + Math.floor(Math.random() * 80);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-preview-' + Date.now()),
  '--remote-debugging-port=' + port, 'about:blank'
], { stdio: 'ignore' });

let ws, id = 0;
const pend = new Map();
for (let i = 0; i < 100; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const tab = list.find((t) => t.type === 'page');
    if (tab) {
      ws = new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('no ws'); process.exit(1); }
const cdp = (method, params = {}) => { const i = ++id; return new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) console.error('JSERR', r.result.exceptionDetails.text);
  return r.result && r.result.result ? r.result.result.value : null;
}
async function clearModals() {
  await js(`(function(){
    for (let i = 0; i < 6; i++) {
      const entry = document.getElementById('entry-notice-ok');
      if (entry && entry.getBoundingClientRect().width) { entry.click(); continue; }
      const m = document.getElementById('modal-mask');
      if (m && !m.hidden) {
        const c = document.getElementById('modal-cancel');
        if (c && c.getBoundingClientRect().width) c.click();
        else m.hidden = true;
        continue;
      }
      const en = document.getElementById('entry-notice');
      if (en) en.remove();
      break;
    }
    return true;
  })()`);
  await sleep(280);
}
async function shot(name) {
  await clearModals();
  await sleep(450);
  await js("(function(){const b=document.getElementById('bubble');if(b)b.hidden=true;const t=document.getElementById('toast');if(t)t.classList.remove('rv-show');const h=document.getElementById('hintline');if(h)h.classList.remove('rv-show');return true})()");
  await sleep(250);
  const r = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const data = r.result && r.result.data;
  if (!data) { console.error('capture failed', name); return; }
  writeFileSync(join(outDir, name), Buffer.from(data, 'base64'));
  console.log('saved', name, Buffer.from(data, 'base64').length, 'bytes');
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(4200);
// 预览会话：隐藏首次须知 / 备份提醒 / 更新引导等遮罩，避免截图被挡
await js("(function(){const st=document.createElement('style');st.id='preview-hide-modals';st.textContent='#modal-mask,#qa-mask,#tc-mask,#call-mask,#cc-export-mask,#cc-scope-mask,#dl-picker-mask,#entry-notice,#backup-remind-bar,.modal-mask{display:none !important}';document.head.appendChild(st);try{document.getElementById('modal-mask').hidden=true}catch(e){};try{document.getElementById('entry-notice').remove()}catch(e){};return true})()");
// 首次进入的「使用须知」+ 备份提醒：先关掉，否则截图全是遮罩
await js("(function(){const b=document.getElementById('entry-notice-ok');if(b)b.click();return true})()");
await sleep(500);
await js("(function(){const m=document.getElementById('modal-mask');if(m&&!m.hidden){const c=document.getElementById('modal-cancel');if(c)c.click();}return true})()");
await sleep(500);
console.log('cid', await js("window.__activeCid||'default'"), 'openRoom', await js('typeof window.openRoom'));

const styles = [
  { file: '01-cream.png', id: 'cream', name: '奶油原木', wall: 'cream', L: '#F7EFE2', R: '#EADCC8', floor: 'wood', fcol: '#D9B78F', accent: '#B98A5E', night: 'd' },
  { file: '02-mist.png', id: 'mist', name: '雾蓝晨光', wall: 'mist', L: '#E8EFF6', R: '#D7E3EE', floor: 'stone', fcol: '#C9C4B8', accent: '#6E8CA8', night: 'd' },
  { file: '03-rose.png', id: 'rose', name: '暮色玫瑰', wall: 'rose', L: '#F4DFE3', R: '#E8CBD2', floor: 'wood', fcol: '#C99A8F', accent: '#C07D8C', night: 'd' },
  { file: '04-sage.png', id: 'sage', name: '苔原森居', wall: 'sage', L: '#E6EDE0', R: '#D5E0CC', floor: 'tatami', fcol: '#A8906E', accent: '#7C9670', night: 'd' },
  { file: '05-clay.png', id: 'clay', name: '陶土黄昏', wall: 'clay', L: '#EFE1D2', R: '#E1CDB9', floor: 'wood', fcol: '#B78A5F', accent: '#B5734E', night: 'd' },
  { file: '06-night.png', id: 'night', name: '午夜星蓝', wall: 'star', L: '#3C406B', R: '#31355A', floor: 'stone', fcol: '#8A7FA0', accent: '#8A7BD8', night: 'n' }
];

function makeData(s) {
  const now = Date.now();
  return {
    schema: 6, cols: 7, rows: 5, wallH: 160,
    walls: { L: { c: s.L, a: null }, R: { c: s.R, a: null }, F1: null, F2: null },
    wall: s.wall, floor: s.floor, fcol: s.fcol, style: s.id, accent: s.accent,
    fx: [
      { i: 'w1', t: 'win_arch', x: 1, y: 0, r: 0, w: 1, d: 1, wp: { side: 'L', t: 1.4 }, s: 1.05, hs: 1.05, bot: 42 },
      { i: 'w2', t: 'win_rect', x: 4, y: 0, r: 0, w: 1, d: 1, wp: { side: 'L', t: 4.4 }, s: 1, hs: 1, bot: 34 },
      { i: 'w3', t: 'win_round', x: 0, y: 0, r: 0, w: 1, d: 1, wp: { side: 'R', t: 1.8 }, s: 1, hs: 1, bot: 54 },
      { i: 'door1', t: 'door', x: 1, y: 0, r: 0, w: 1, d: 1, wp: { side: 'L', t: 6.2 }, sc: 1 },
      { i: 'paint1', t: 'painting', x: 0, y: 0, r: 0, w: 1, d: 1, wp: { side: 'R', t: 3.7 } },
      { i: 'bed1', t: 'bed', x: 5, y: 0, r: 0, w: 1, d: 1, vs: 1 },
      { i: 'shelf1', t: 'shelf', x: 0, y: 0, r: 0, w: 1, d: 1 },
      { i: 'plant1', t: 'plant', x: 1, y: 1, r: 0, w: 1, d: 1 },
      { i: 'lamp1', t: 'desklamp', x: 0, y: 2, r: 0, w: 1, d: 1 },
      { i: 'rug1', t: 'rug', x: 3, y: 1, r: 0, w: 1, d: 1 },
      { i: 'chair1', t: 'chair', x: 3, y: 3, r: 0, w: 1, d: 1 },
      { i: 'sofa1', t: 'sofa', x: 1, y: 4, r: 0, w: 1, d: 1 },
      { i: 'radio1', t: 'radio', x: 6, y: 4, r: 0, w: 1, d: 1 }
    ],
    inv: {}, pts: 120, lv: 3, lit: { lamp1: true },
    vaseFlower: false, night: s.night, followSys: false,
    stack: false, hudMin: false, bright: 1,
    fcells: {}, look: { skin: '#FFE3CF', hair: '#5B4A68', style: 'short', top: '#8E7CC3', bottom: '#6B5B95', h: 1 },
    lookArt: {}, customFurn: {}, hints: {},
    ta: { x: 3, y: 2, tx: 3, ty: 2, act: 'idle', nextAt: now + 3600000 }
  };
}

for (const s of styles) {
  await js("(function(d){try{window.closeRoom();window.storeFor(window.__activeCid||'default').set('room-data',JSON.stringify(d));}catch(e){}window.openRoom();return true})(" + JSON.stringify(makeData(s)) + ")");
  await sleep(3200);
  console.log('state', s.id, await js("window.__room.state().style"), await js("window.__room.state().cols+'x'+window.__room.state().rows"), await js("window.__room.state().walls.L.c"));
  await shot(s.file);
}

const gallery = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>房间美术预览</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f5efe6;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#3b3029}
.wrap{max-width:1280px;margin:0 auto;padding:34px 30px 46px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:.5px}p.sub{margin:0 0 24px;color:#8b7b6b;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
figure{margin:0;background:#fffdf8;border:1px solid rgba(80,55,35,.12);border-radius:20px;overflow:hidden;box-shadow:0 16px 40px rgba(70,45,25,.12)}
figure img{display:block;width:100%;height:auto;background:#e9e3d8}
figcaption{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;font-size:14px}
figcaption b{font-weight:650}figcaption span{font-size:11px;color:#a2937f}
@media (max-width:900px){.wrap{padding:20px 14px 34px}.grid{grid-template-columns:1fr;gap:18px}h1{font-size:21px}p.sub{font-size:12px;margin-bottom:18px}}
</style></head><body><div class="wrap">
<h1>房间美术 · 六套整体风格</h1>
<p class="sub">同一套等距几何，换墙 / 地板 / 点缀色与光；截图为 390×844 手机视口。</p>
<div class="grid">
${styles.map((s, i) => `<figure><img src="${s.file}" alt="${s.name}"><figcaption><b>${s.name}</b><span>0${i + 1}</span></figcaption></figure>`).join('\n')}
</div></div></body></html>`;
writeFileSync(join(outDir, 'index.html'), gallery);

// 画廊用「另一个端口」的静态服务：跨源即绕开应用 Service Worker 对同源导航的接管
const galleryServer = createServer((req, res) => {
  try {
    let p = normalize(join(outDir, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(outDir)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => galleryServer.listen(0, '127.0.0.1', r));
const galleryUrl = 'http://127.0.0.1:' + galleryServer.address().port + '/index.html';
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: galleryUrl });
await sleep(1400);
const full = await cdp('Page.getLayoutMetrics');
const h = Math.ceil(full.result.cssContentSize.height || 1100);
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: h, deviceScaleFactor: 1, mobile: false });
await sleep(400);
const sheet = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
if (sheet.result && sheet.result.data) {
  writeFileSync(join(outDir, 'preview-sheet.png'), Buffer.from(sheet.result.data, 'base64'));
  console.log('saved preview-sheet.png');
}
chrome.kill();
server.close();
try { galleryServer.close(); } catch (e) {}
process.exit(0);

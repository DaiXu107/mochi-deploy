// ===== 桌面外观恢复验证（荣耀200Pro Edge 反馈：退出重进后卡片背景/头像丢失变白板） =====
// 场景：大图键（>200KB 只存 IndexedDB）冷启动时 idbRestore 回填完成前后界面是否补渲染；
//       渲染防护不再误删数据；rescueDeskVisuals 直读兜底生效。
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-desk-visual-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(800);
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 第 1 次加载：模拟上一会话写入的数据形态 ----
await gotoApp();
const seeded = await evalJs(`(async () => {
  // 大图（>200KB，xyStore.set 会跳过 LS 只写 IDB——与大壁纸/大卡片背景同形态）；
  // 卡片背景渲染阈值 500KB，种子图需落在 205KB~480KB 才是「正常可渲染大键」路径
  const mkNoise = (w, h, q) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const id = x.createImageData(w, h);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i] = Math.random() * 255; id.data[i + 1] = Math.random() * 255;
      id.data[i + 2] = Math.random() * 255; id.data[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    return c.toDataURL('image/jpeg', q);
  };
  let big = null;
  for (const [w, h, q] of [[760, 950, .72], [640, 800, .68], [520, 650, .62], [430, 540, .58]]) {
    const d = mkNoise(w, h, q);
    if (d.length >= 205 * 1024 && d.length <= 480 * 1024) { big = d; break; }
    if (!big || Math.abs(d.length - 320 * 1024) < Math.abs(big.length - 320 * 1024)) big = d;
  }
  const small = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d'); x.fillStyle = '#e05555'; x.fillRect(0, 0, 64, 64);
    return c.toDataURL('image/jpeg', 0.85);
  })();
  await window.idbSet('xy-home-v2:default:card-bg-deco', big);
  await window.idbSet('xy-home-v2:default:page-bg-0', big);
  // 略超渲染阈值(500KB)但未到硬上限的存量图——验证不再被删除
  await window.idbSet('xy-home-v2:default:card-bg-quote', mkNoise(900, 1200, .85));
  localStorage.setItem('xy-home-v2:default:avatar-user', small);
  await window.idbSet('xy-home-v2:default:avatar-user', small);
  return { bigLen: big.length };
})()`);
console.log('seed 大图长度: ' + (seeded && seeded.bigLen));

// ---- 第 2 次加载：退出重进（冷启动，memoryCache 清空）----
await gotoApp();
// 给回填批次 + rescue 直读兜底足够时间
for (let i = 0; i < 20; i++) {
  const decoBg = await evalJs(`(document.querySelector('[data-card-bg="deco"]')||{style:{}}).style.backgroundImage || ''`);
  if (decoBg.indexOf('data:image') >= 0) break;
  await sleep(500);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const decoBg = await evalJs(`(document.querySelector('[data-card-bg="deco"]')||{style:{}}).style.backgroundImage || ''`);
check('A: 冷启动后纪念日卡背景已恢复(dataURL)', decoBg.indexOf('data:image') >= 0, decoBg.slice(0, 40));
const quoteKept = await evalJs(`(async () => !!(await window.idbGet('xy-home-v2:default:card-bg-quote')))()`);
check('B: 超阈值存量图未被删除(仍可从 IDB 读回)', quoteKept === true, 'kept=' + quoteKept);
const avatarImg = await evalJs(`!!(document.querySelector('#avatar-user .ring img'))`);
check('C: 冷启动后「我」的头像已恢复', avatarImg === true, 'img=' + avatarImg);

// ---- 第 3 次加载：再进一次，确认页面背景也恢复 + 数据仍在 ----
await gotoApp();
await sleep(3000);
const pageBg = await evalJs(`(document.querySelectorAll('.page-slide')[0]||{style:{}}).style.backgroundImage || ''`);
check('D: 冷启动后首页(page-bg-0)背景已恢复', pageBg.indexOf('data:image') >= 0, pageBg.slice(0, 40));
const decoStill = await evalJs(`(async () => !!(await window.idbGet('xy-home-v2:default:card-bg-deco')))()`);
check('E: 多次重进后数据仍在(IDB 权威层)', decoStill === true, 'kept=' + decoStill);

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

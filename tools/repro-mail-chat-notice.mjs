// ===== 复现脚本：聊天显示「给你寄来了一封信」但信箱列表为空 =====
// 用法：node tools/repro-mail-chat-notice.mjs
// 场景：模拟来信机制 maybeIncomingLetterFor 落盘后，信箱 render()/load() 能否读到。
//   来信写入走 csFor(cid)=storeFor(cid)=xyStore('xy-home-v2:'+cid)；
//   信箱渲染走 load()=activeStore()（default 桌面 = defaultStore，新键优先、回退旧顶层键）。
//   对 default 联系人，验证写入键与读取键是否一致；再直接验证来信后信箱列表可见。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-repro-mail-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 步骤 1：确认 default 桌面来信写入键 vs 信箱读取键 ----
const keyInfo = JSON.parse(await evalJs(`(function(){
  const out = {};
  // 来信写入侧：csFor('default') = storeFor('default')
  try {
    const sf = window.storeFor('default');
    sf.set('__repro_probe__', 'probe-value');
    const ls = localStorage.getItem('xy-home-v2:default:__repro_probe__');
    const lsOld = localStorage.getItem('xy-home-v2:__repro_probe__');
    out.storeForWriteKey = 'xy-home-v2:default:__repro_probe__';
    out.storeForWroteNewNs = ls === 'probe-value';
    out.storeForWroteOldNs = lsOld === 'probe-value';
    sf.remove('__repro_probe__');
  } catch(e) { out.storeForErr = String(e); }
  // 信箱读取侧：activeStore().get 读哪个键（default 桌面）
  try {
    window.xyStore('xy-home-v2:default').set('__repro_probe2__', 'new-ns');
    window.xyStore('xy-home-v2').set('__repro_probe2__', 'old-ns');
    const v = window.activeStore().get('__repro_probe2__');
    out.activeStorePrefers = v;
    window.xyStore('xy-home-v2:default').remove('__repro_probe2__');
    window.xyStore('xy-home-v2').remove('__repro_probe2__');
  } catch(e) { out.activeStoreErr = String(e); }
  return JSON.stringify(out);
})()`) || '{}');
console.log('  [键信息]', JSON.stringify(keyInfo));
check('来信写入侧 storeFor(default) 落新命名空间键', keyInfo.storeForWroteNewNs === true, JSON.stringify(keyInfo));
check('信箱读取侧 activeStore(default) 优先读新命名空间键', keyInfo.activeStorePrefers === 'new-ns', JSON.stringify(keyInfo));

// ---- 步骤 2：模拟来信落盘（与 maybeIncomingLetterFor 同款路径：csFor(cid) 写入） ----
const seedLetter = await evalJs(`(function(){
  try {
    const cid = 'default';
    const letter = { id: 'l_' + Date.now() + '_repro', type: 'received', tt: '复现测试信', content: '这是一封复现测试来信', tm: Date.now() };
    const KEY = 'mail-letters';
    const cs = window.storeFor(cid);
    let list = [];
    try { list = JSON.parse(cs.get(KEY) || '[]'); } catch(e) {}
    if (!Array.isArray(list)) list = [];
    list.unshift(letter);
    cs.set(KEY, JSON.stringify(list));
    return JSON.stringify({ wrote: true, id: letter.id, newNsKey: localStorage.getItem('xy-home-v2:' + cid + ':' + KEY) !== null });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`);
const seed = JSON.parse(seedLetter || '{}');
console.log('  [写入来信]', JSON.stringify(seed));
check('来信按 csFor(cid) 路径落盘', seed.wrote === true && !!seed.id, JSON.stringify(seed));

// ---- 步骤 3：信箱 load() 能否读到这封信（用户视角：列表可见） ----
const readBack = JSON.parse(await evalJs(`(function(){
  try {
    const raw = window.activeStore().get('mail-letters');
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch(e) {}
    const found = list.find(x => x && x.id === ${JSON.stringify(seed.id)});
    const viaSnap = (localStorage.getItem('xy-home-v2:default:mail-letters-snap') || '').indexOf('复现测试来信') >= 0;
    return JSON.stringify({ rawLen: (raw||'').length, listLen: list.length, found: !!found, viaSnap: viaSnap });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [信箱读取]', JSON.stringify(readBack));
check('信箱 load() 能读到来信', readBack.found === true, JSON.stringify(readBack));

// ---- 步骤 4：打开信箱页，列表里是否显示这封信 ----
const ui = JSON.parse(await evalJs(`(function(){
  try {
    if (window.openMailPage) window.openMailPage();
    const items = Array.from(document.querySelectorAll('#mail-in-list .mail-item')).map(it => it.textContent);
    const found = items.some(t => t.indexOf('复现测试来信') >= 0);
    return JSON.stringify({ items: items.length, found: found });
  } catch(e) { return JSON.stringify({ err: String(e) }); }
})()`) || '{}');
console.log('  [信箱列表]', JSON.stringify(ui));
check('信箱「收到的信」列表显示该来信', ui.found === true, JSON.stringify(ui));

const failed = results.filter(r => !r.ok);
console.log('\n===== 复现结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);

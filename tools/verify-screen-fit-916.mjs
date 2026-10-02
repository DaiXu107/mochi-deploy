// ===== 专项验证：#916 顶部白条/显示不全+聊天闪动（Edge 工具条显隐 dvh 滞留族）+ 错误环红点只增 =====
// 用户直派（OPPO Find X8s + Edge，多机型同现）：①顶部白条/显示不全、刷新才恢复；②聊天界面偶尔闪动；
// ③设备兼容诊断红点每次刷新递增。修法：① mobile-adapt.js 安卓 1s 看门狗补「稳态高度对账」
// （.phone 底边 vs innerHeight 偏差>8px 连续两拍→内联钉高，回正→摘除）；② device.js sdRingPush
// [屏幕适配] 条目同签名 24h 去重（c+1 复用，不再新增条目）。
// 用法：node tools/verify-screen-fit-916.mjs（需先 node build.mjs；MOCHI_ROOT 可指仓外副本）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const target = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : root;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

// ---- S 组：静态锚 ----
let jsMa = '', jsDev = '';
try { jsMa = readFileSync(join(target, 'js', 'mobile-adapt.js'), 'utf8'); } catch (e) {}
try { jsDev = readFileSync(join(target, 'js', 'device.js'), 'utf8'); } catch (e) {}
ok('S1 #916a 两拍确认钉高在 js/mobile-adapt.js', jsMa.includes('if (_aFitPend === _aExpB) {'));
ok('S2 #916a 偏差回正摘钉在 js/mobile-adapt.js', jsMa.includes('if (_aFitPin) { _aPhone.style.height = \'\'; _aFitPin = false; _aPanComp(); }'));
const _idxHtml = (() => { try { return readFileSync(join(target, 'index.html'), 'utf8'); } catch (e) { return ''; } })();
ok('S3 #916b 错误环同签名去重在产物（device.js 内联件）', _idxHtml.includes("_sdSig = '[屏幕适配] ' + String(names).split('｜')[0];") && _idxHtml.includes('arr[_sdDup].c = (arr[_sdDup].c || 1) + 1;'));

// ---- B 组：无头行为 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(target, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(target)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fit916-' + Date.now()),
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
  throw new Error('CDP 连接失败');
}
const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  // 安卓手机形态（pointer:coarse 是 #916a 对账闸门之一）
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);

  const ih = await evalJs('window.innerHeight');
  // B1 健康稳态：对账零写入（.phone 无内联高）
  ok('B1 健康稳态零写入（.phone 无内联高）', (await evalJs('document.querySelector(".phone").style.height')) === '');
  // B2 模拟 dvh 滞留（注入 .phone 定高 699px，≈错误环「底部少填 26px」现场）→ 两拍后对账钉高到 innerHeight
  await evalJs(`
    const st = document.createElement('style'); st.id = 'fit916-sim';
    st.textContent = '.phone{height:699px !important}';
    document.head.appendChild(st); true`);
  await sleep(4500); // 两拍确认（1s 节拍×2）+ vv 稳定 1.2s 闸门
  const pinned = await evalJs('document.querySelector(".phone").style.height');
  ok('B2 对账钉高到 innerHeight（' + pinned + ' vs ' + ih + '）', pinned === ih + 'px' || pinned === Math.round(ih) + 'px');
  // B3 dvh 恢复（撤掉模拟）→ 对账摘钉回落 CSS
  await evalJs(`document.getElementById('fit916-sim').remove(); true`);
  await sleep(3500);
  ok('B3 回正后摘钉（.phone 无内联高）', (await evalJs('document.querySelector(".phone").style.height')) === '');
  // B4 键盘会话闸门：模拟聚焦不成立（headless 无真键盘），改为验证 dev<8 时不写入已由 B1/B3 覆盖
  // Z 零异常
  const errs = await evalJs('window.__jsErrors ? window.__jsErrors.length : -1');
  ok('Z 页面零 JS 异常（__jsErrors=' + errs + '）', errs === 0 || errs === -1);
} catch (e) {
  fail++;
  console.error('❌ B 组执行异常：' + (e && e.message));
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}

console.log('\n#916 verify-screen-fit-916：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

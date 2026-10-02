// ===== 回归：保活 WebRTC 锚点「启动延迟 + 断连自愈窗 + 重建退避」（bg-keep.js #433） =====
// 用户报障（vivo Y78 自带浏览器，明说其他设备型号也有）：「一进网站就非常卡」——实测帧率
// 2fps、每 ~2.2s 一个 2.1~2.4s 长任务。无头 CPU 采样探针实锤：new RTCPeerConnection() 构造
// 本身是重主线程操作（6x 节流桌面核单次阻塞 ~1.5s，低端安卓核放大到 ~2-2.5s），#260 原来
// 在 startKeepAlive 里同步建一对＝开屏关键路径叠加两个秒级长任务；且瞬态 'disconnected'
// 也被当死亡立即拆+30s 固定重建＝抖动机型反复支付构造成本。
// 修复（锚点能力不删，只改时机与节奏）：①启动 10s 后延迟建锚（音频主锚点不受影响）；
// ②'disconnected' 先给 8s 自愈观察窗；③重建间隔指数退避 30s→…→15min 封顶、稳定 5min 才
// 复位；④回前台补建走 3s 延迟。
// 用例：
//   T1 启动后 5s 内不构造 RTCPeerConnection（旧代码此时已建完一对＝本用例红绿判别点）
//   T2 启动 ~14s 后锚点建成（pcNew ≥ 2 且 __kaProbe().pc !== 'off'）
//   T3 __kaProbe().pcNext 字段在（诊断契约：0=无排期重建）
//   T4 源码：'disconnected' 分支有 8s 自愈观察窗
//   T5 源码：重建走指数退避（30s 起步、900000 封顶）
//   T6 源码：kaWebrtcStop 清理 boot/disc/timer 三个定时器
//   T7 源码：healKeepAlive 回前台补建走 kaWebrtcDeferredStart(3000)
//   T8 全程零 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 160) + ']' : ''));
}

// ---- 源码断言（T4/T5/T6/T7：真机断连状态无法在无头环境稳定复现，走逻辑锚点断言） ----
const src = readFileSync(join(root, 'src/js/bg-keep.js'), 'utf8');
check('T4 disconnected 分支有 8s 自愈观察窗', /st === 'disconnected'[\s\S]{0,400}?kaWebrtcDiscTimer = setTimeout[\s\S]{0,400}?\}, 8000\)/.test(src));
check('T5 重建指数退避 30s 起步 900000 封顶', src.includes("kaWebrtcRebuildDelay = kaWebrtcRebuildDelay ? Math.min(kaWebrtcRebuildDelay * 2, 900000) : 30000;"));
check('T6 kaWebrtcStop 清理 boot/disc/rebuild 三个定时器', /function kaWebrtcStop\(\) \{[\s\S]{0,600}?kaWebrtcBootTimer[\s\S]{0,600}?kaWebrtcDiscTimer[\s\S]{0,600}?kaPc1 = kaPc2 = null;/.test(src));
check('T7 回前台补建走 3s 延迟且不抢排程', src.includes('if (!kaPc1 && !kaWebrtcTimer && !kaWebrtcBootTimer) kaWebrtcDeferredStart(3000);'));
check('T7b 开屏建锚走 10s 延迟（不再同步构造）', src.includes('kaWebrtcDeferredStart(10000);') && !/锚点同步建立\s*\n\s*kaWebrtcStart\(\);/.test(src));

// ---- 浏览器行为断言（T1/T2/T3/T8） ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!browserPath) { console.log('SKIP  无 Chrome/Edge，跳过行为用例'); process.exit(results.every((r) => r.ok) ? 0 : 1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = 27000 + Math.floor(Math.random() * 2000);
const browser = spawn(browserPath, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-ka429-' + Date.now()),
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return { __err: String(r.exceptionDetails.text) };
  return r && r.result ? r.result.value : undefined;
}

await cdpConnect();
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 654, deviceScaleFactor: 3, mobile: true });
// 预置：保活开（gGet('bg-keepalive')==='1' 即建锚）+ RTCPeerConnection 构造计数器
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){
    try { if (location.pathname.indexOf('index.html') >= 0) localStorage.setItem('xy-home-v2:bg-keepalive', '1'); } catch (e) {}
    try {
      const P = window.RTCPeerConnection;
      window.__pcNew = 0;
      window.RTCPeerConnection = function (...a) { window.__pcNew++; return new P(...a); };
      window.RTCPeerConnection.prototype = P.prototype;
    } catch (e) {}
  })();`
});
await cdp('Page.enable');
await cdp('Page.navigate', { url: baseUrl + '/index.html' });

// T1：5s 内（旧代码 1~2s 时已同步建完一对）
await sleep(5000);
const t1 = await evalJs(`({ pcNew: window.__pcNew })`);
check('T1 启动 5s 内不构造 RTCPeerConnection', t1 && t1.pcNew === 0, t1);

// T2/T3：10s 延迟 + 构造耗时余量
await sleep(9000);
const t2 = await evalJs(`(function(){ try { const p = window.__kaProbe ? window.__kaProbe() : null; return { pcNew: window.__pcNew, pc: p ? p.pc : 'no-probe', pcNext: p ? (typeof p.pcNext) : 'missing' }; } catch (e) { return { __err: String(e && e.message || e) }; } })()`);
check('T2 启动 ~14s 后锚点建成', t2 && t2.pcNew >= 2 && t2.pc !== 'off' && t2.pc !== 'no-probe', t2);
check('T3 __kaProbe().pcNext 字段在', t2 && t2.pcNext === 'number', t2);

// T8：零 JS 异常
const t8 = await evalJs(`({ n: (window.__jsErrors || []).length })`);
check('T8 全程零 JS 异常', t8 && t8.n === 0, t8);

browser.kill();
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('---- ' + pass + '/' + results.length + ' ----');
process.exit(pass === results.length ? 0 : 1);

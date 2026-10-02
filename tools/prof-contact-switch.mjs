// ===== 诊断：切换联系人/桌面卡顿耗时归因（只读剖析，不改应用数据结构） =====
// 方法：种两个桌面的重度数据（大图键/字卡/朋友圈/查岗记录等）→ 冷启动回填稳定后
//       反复 setActiveContact，用注入探针统计：
//       ① setActiveContact 同步总耗时；② 每个 'contact-switched' 监听器耗时；
//       ③ 切换后 2.5s 内 longtask 长任务；④ JS 堆变化。
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-prof-switch-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
}

// 探针：任何页面脚本运行前挂上——计时每个 contact-switched 监听器 + longtask 收集。
// 注意：包装会改变监听器引用，本工具仅为诊断用，不进构建产物。
const PROBE = `(function(){
  window.__prof = { listeners: [], longtasks: [], dispatchTotal: 0 };
  try {
    const po = new PerformanceObserver(function(l){
      l.getEntries().forEach(function(e){ window.__prof.longtasks.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); });
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch (e) {}
  const orig = Document.prototype.addEventListener;
  Document.prototype.addEventListener = function(type, fn, opts){
    if (type === 'contact-switched' && typeof fn === 'function') {
      const wrapped = function(){
        const t0 = performance.now();
        try { return fn.apply(this, arguments); }
        finally {
          let label = ''; try { label = String(fn).replace(/\\s+/g, ' ').slice(0, 110); } catch (e) {}
          window.__prof.listeners.push({ label: label, ms: +(performance.now() - t0).toFixed(1) });
        }
      };
      return orig.call(this, type, wrapped, opts);
    }
    return orig.call(this, type, fn, opts);
  };
})();`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 第 1 次加载：建第二个联系人并种重度数据 ----
await gotoApp();
const seeded = await evalJs(`(async () => {
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
  const cid2 = window.createContact('剖析二号');
  const G = 'xy-home-v2';
  const pairs = [];
  const small = (() => { const c = document.createElement('canvas'); c.width = 96; c.height = 96;
    const x = c.getContext('2d'); x.fillStyle = '#7a5cff'; x.fillRect(0,0,96,96); return c.toDataURL('image/jpeg', .85); })();
  // 每个桌面：头像×2 + 页面背景×3(~400KB) + 卡片背景×4(~300KB) ≈ 2.5MB 大键
  for (const cid of ['default', cid2]) {
    const p = G + ':' + cid;
    pairs.push({ k: p + ':avatar-user', v: small });
    pairs.push({ k: p + ':avatar-partner', v: small });
    for (let i = 0; i < 3; i++) pairs.push({ k: p + ':page-bg-' + i, v: mkNoise(720, 1280, .55) });
    for (const t of ['deco', 'quote', 'anniv', 'photo']) pairs.push({ k: p + ':card-bg-' + t, v: mkNoise(620, 820, .6) });
    // 字卡库 300 张、查岗记录 400 条、日历留言 90 条
    const cards = []; for (let i = 0; i < 300; i++) cards.push({ t: '字卡内容' + i + '，这是一条用于性能剖析的中等长度文本。', g: '日常' });
    pairs.push({ k: p + ':cc-groups', v: JSON.stringify([{ name: '剖析组', cards: cards }]) });
    const ck = []; for (let i = 0; i < 400; i++) ck.push({ tm: Date.now() - i * 3600e3, q: '今天过得怎么样？', a: '还不错，吃了好吃的。' });
    pairs.push({ k: p + ':checkin-history', v: JSON.stringify(ck) });
    const cal = {}; for (let i = 0; i < 90; i++) cal['2026-08-' + String((i % 28) + 1).padStart(2, '0')] = '每日留言' + i;
    pairs.push({ k: p + ':cal-notes', v: JSON.stringify(cal) });
  }
  // 全局朋友圈 60 条动态
  const posts = []; for (let i = 0; i < 60; i++) posts.push({ id: 'p' + i, owner: 'default', role: 'me', text: '朋友圈动态内容' + i, tm: Date.now() - i * 60e3, likes: [], comments: [] });
  pairs.push({ k: G + ':feed-posts', v: JSON.stringify(posts) });
  await window.idbSetAll(pairs);
  return { cid2: cid2, count: pairs.length, totalKB: Math.round(pairs.reduce((s, p) => s + p.v.length, 0) / 1024) };
})()`);
console.log('种子完成:', JSON.stringify(seeded));

// ---- 第 2 次加载：冷启动，等回填稳定 ----
await gotoApp();
await sleep(5000);
const heap0 = await evalJs(`performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1`);

// ---- 连续切换 8 次，逐次采集 ----
const runs = [];
for (let i = 0; i < 8; i++) {
  const target = i % 2 === 0 ? seeded.cid2 : 'default';
  const r = await evalJs(`(async () => {
    const p = window.__prof;
    p.listeners.length = 0; p.longtasks.length = 0; p.dispatchTotal = 0;
    const memBefore = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const t0 = performance.now();
    window.setActiveContact(${JSON.stringify(target)});
    const syncMs = +(performance.now() - t0).toFixed(1);
    await new Promise(res => setTimeout(res, 2200));
    const memAfter = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const lt = p.longtasks.filter(e => e.s >= t0 - 5);
    return {
      to: ${JSON.stringify(target)}, syncMs: syncMs,
      listeners: p.listeners.slice().sort((a, b) => b.ms - a.ms).slice(0, 8),
      listenerSumMs: +p.listeners.reduce((s, x) => s + x.ms, 0).toFixed(1),
      listenerCount: p.listeners.length,
      longtasks: lt.map(e => ({ s: e.s - Math.round(t0), d: e.d })),
      heapDeltaMB: +((memAfter - memBefore) / 1048576).toFixed(1)
    };
  })()`);
  runs.push(r);
  console.log('切换#' + (i + 1) + ' → ' + r.to + '  同步 ' + r.syncMs + 'ms  监听器合计 ' + r.listenerSumMs + 'ms(' + r.listenerCount + '个)  长任务 ' + JSON.stringify(r.longtasks) + '  堆Δ' + r.heapDeltaMB + 'MB');
  const top = r.listeners.slice(0, 3).map((l) => '    ' + l.ms + 'ms  ' + l.label);
  top.forEach((t) => console.log(t));
}

console.log('\n堆基线: ' + heap0 + 'MB');
const syncs = runs.map((r) => r.syncMs).sort((a, b) => a - b);
console.log('同步耗时 中位 ' + syncs[3] + 'ms / 最小 ' + syncs[0] + 'ms / 最大 ' + syncs[7] + 'ms');
// 跨全部轮次聚合最贵监听器
const agg = await evalJs(`(async () => { const p = window.__prof; return { pending: p.listeners.length }; })()`);
console.log('剩余未计监听器: ' + JSON.stringify(agg));
chrome.kill(); server.close();
process.exit(0);

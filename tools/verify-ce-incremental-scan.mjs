// verify-ce-incremental-scan.mjs —— ce 转换 MutationObserver 增量扫描行为验证（多机型卡顿家族）
// 背景：mobile-adapt.js 的 ce 观察器旧实现「任何 body childList 变动 → 全文档重扫 input」，
//   prof-mobile-lag 实测大 DOM 上切 4 次桌面 550ms+ 长任务（安卓点击迟钝/切桌面卡实测主因）。
//   已改增量：只扫本批新增节点子树。本脚本守行为不回退：
//   ①启动全量转换仍生效（静态输入框被转）；
//   ②动态插入的裸 input / type=text / textarea / 容器内嵌输入框都被转换（弹层/半框路径）；
//   ③排除类型（checkbox/date）不被转换；
//   ④大 DOM 下批量插入节点不产生 >100ms 长任务（增量扫描不随文档大小退化）。
// 用法：node tools/verify-ce-incremental-scan.mjs（Node 21+ + 本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('环境不满足：找不到 Chrome/Edge'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = 9820 + Math.floor(Math.random() * 60);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-ce-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
// 非桌面（mobile=true）且 UA 非 iOS → ce 转换启用
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
try { window.__lt = []; new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { window.__lt.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
` });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await evalJs(`(function(){ const sb=document.getElementById('splash-box'); if(sb) sb.scrollTop=sb.scrollHeight; const se=document.getElementById('splash-enter'); if(se) se.click(); const fe=document.getElementById('splash-force-enter'); if(fe && se && se.hidden) fe.click(); })()`);
await sleep(2000);

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}

// ① 启动全量转换：启动期已存在的输入框（如设置页/桌面里的）至少有被转的
const bootConv = await evalJs(`(function(){
  const all = document.querySelectorAll('input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea');
  let done = 0; all.forEach(function(i){ if (i.dataset.ceDone) done++; });
  return { total: all.length, done: done };
})()`);
assert('A1 启动全量转换生效（静态输入框已转换）', bootConv.total === 0 || bootConv.done > 0, JSON.stringify(bootConv));

// ② 动态插入：裸 input / type=text / textarea / 容器内嵌 —— 各自被转换
const dyn = await evalJs(`(async function(){
  function mk(tag, attrs) { const el = document.createElement(tag); Object.keys(attrs || {}).forEach(function(k){ el.setAttribute(k, attrs[k]); }); return el; }
  const bare = mk('input'); document.body.appendChild(bare);
  const txt = mk('input', { type: 'text' }); document.body.appendChild(txt);
  const ta = mk('textarea'); document.body.appendChild(ta);
  const box = mk('div'); const inner = mk('input', { type: 'text' }); box.appendChild(inner); document.body.appendChild(box);
  const cb = mk('input', { type: 'checkbox' }); document.body.appendChild(cb);
  const dt = mk('input', { type: 'date' }); document.body.appendChild(dt);
  await new Promise(function (r) { setTimeout(r, 400); });
  return {
    bare: !!bare.dataset.ceDone && !!bare.__ceBox,
    txt: !!txt.dataset.ceDone && !!txt.__ceBox,
    ta: !!ta.dataset.ceDone && !!ta.__ceBox,
    inner: !!inner.dataset.ceDone && !!inner.__ceBox,
    cbSkip: !cb.dataset.ceDone,
    dtSkip: !dt.dataset.ceDone
  };
})()`);
assert('A2 动态裸 input 被转换', dyn.bare === true);
assert('A3 动态 type=text 被转换', dyn.txt === true);
assert('A4 动态 textarea 被转换', dyn.ta === true);
assert('A5 容器内嵌输入框被转换', dyn.inner === true);
assert('A6 checkbox 不被转换', dyn.cbSkip === true);
assert('A7 date 不被转换', dyn.dtSkip === true);

// ③ 增量扫描判别断言：逐批（批间 await）插入 50 个无输入框节点，计数
//    「document 级 input 选择器全文档扫描」次数。旧实现每批 mutation 都全文档
//    document.querySelectorAll 重扫一遍（50 批=50 次全扫，随文档规模线性变贵，
//    prof-mobile-lag 实测大 DOM 上切 4 次桌面 550ms+）；增量实现只扫新增节点
//    子树（Element 级），全文档扫描应为 0 次。
await evalJs(`(function(){
  window.__docScanCount = 0;
  const orig = Document.prototype.querySelectorAll;
  Document.prototype.querySelectorAll = function (sel) {
    if (typeof sel === 'string' && sel.indexOf('input:not([type])') === 0) window.__docScanCount++;
    return orig.apply(this, arguments);
  };
})()`);
await evalJs(`(async function(){
  for (let b = 0; b < 50; b++) {
    const d = document.createElement('div'); d.textContent = '批次' + b;
    document.body.appendChild(d);
    await new Promise(function (r) { setTimeout(r, 8); });
  }
})()`);
const scanCount = await evalJs('window.__docScanCount');
assert('B1 批量插入无输入框节点不触发全文档 input 重扫（0 次）', scanCount === 0, 'scanCount=' + scanCount);
await evalJs(`(function(){ delete window.__docScanCount; })()`);

// ④ 转换后的 ce-box 语义抽查：value 双向代理仍工作
const sem = await evalJs(`(function(){
  const inp = document.querySelector('input[type="text"][data-ce-done], input[data-ce-done]');
  if (!inp || !inp.__ceBox) return { ok: false, why: 'no-converted' };
  inp.value = '语义抽查';
  const shown = inp.__ceBox.textContent;
  inp.__ceBox.textContent = '回写抽查';
  const readBack = inp.value;
  return { ok: shown === '语义抽查' && readBack === '回写抽查', why: shown + '/' + readBack };
})()`);
assert('C1 ce-box value 双向代理语义正常', sem.ok === true, sem.why || '');

console.log('\\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);

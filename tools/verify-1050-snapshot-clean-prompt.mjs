// ===== 常驻回归：#1050 遗留备份快照「当面清」提示（owner 直派「提醒用户，修复弹窗点击后自动清理」） =====
// 背景：旧版程序把全量数据复制进 IDB 的留底副本（__auto-backup-snapshot，实测 33.9MB～700MB+）
// 写入早已下线，只剩清理；但旧实现是「启动静默删」，在部分内核（iOS WebKit 实测，用户机 33.9MB
// 跨多版本仍在）反复删不干净、用户也永远不知道有这份占用。#1050 改为：启动后探测键仍在 →
// openModal 说明 + 点「立即清理」走「删→复核→重试」链并 toast 回告；「下次再说」记 3 天冷却。
// 断言（390×844，全新 profile；先种键再重开模拟存量设备）：
//  S1 前提：种键成功、重开后键在（IDB 权威）
//  S2 ★主判据：启动 ~20s 内出现「发现旧版备份留底副本」弹窗（纯 HEAD 静默删＝永不弹＝红）
//  S3 点「立即清理」→ 键被删净（idbHasKey=false，最多等 ~20s 覆盖 5×1.5s 复核链）
//  S4 清理结果回告 toast（含「已清理」）
//  D1 「下次再说」→ 弹窗关；重开（冷却 3 天内）不再弹
//  Z1 全程零未捕获异常
// 用法：node tools/verify-1050-snapshot-clean-prompt.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SNAP = 'xy-home-v2:__auto-backup-snapshot';
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
let ws = null, msgId = 0, pend = new Map(), chrome = null, cdpPort = 0;
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r && r.exceptionDetails) return null;
  return r && r.result ? r.result.value : null;
}
async function withFreshBrowser(fn) {
  cdpPort = 9930 + Math.floor(Math.random() * 40);
  msgId = 0; pend = new Map(); ws = null;
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'mochi-1049-')),
    '--remote-debugging-port=' + cdpPort, 'about:blank'
  ], { stdio: 'ignore' });
  let connected = false;
  for (let i = 0; i < 80; i++) {
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
        connected = true; break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!connected) throw new Error('无法连接无头浏览器');
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Runtime.evaluate', { expression: `window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String((e&&e.message)||'err').slice(0,160))});window.addEventListener('unhandledrejection',function(e){window.__errs.push('rej:'+String((e&&e.reason)||'').slice(0,120))});`, awaitPromise: false });
  try { return await fn(); } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(300);
  }
}
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s)s.remove();return 1;})()");
  await sleep(600);
}
async function seedSnap() {
  await evalJs(`(function(){ window.__seedDone=0; try{ localStorage.setItem('${SNAP}','legacy'); }catch(e){}
    Promise.resolve(window.idbSet('${SNAP}','S'.repeat(300000))).then(function(){ window.__seedDone=1; },function(){ window.__seedDone=-1; });
    return 1; })()`);
  for (let i = 0; i < 40; i++) { if (await evalJs('window.__seedDone')) break; await sleep(250); }
  return await evalJs('window.__seedDone');
}
const keyInIdb = async () => {
  await evalJs(`(function(){ window.__hasSnap=null; Promise.resolve(window.idbHasKey('${SNAP}')).then(function(r){ window.__hasSnap=r; },function(){ window.__hasSnap='err'; }); return 1; })()`);
  for (let i = 0; i < 40; i++) {
    const v = await evalJs('window.__hasSnap');
    if (v !== null) return v;
    await sleep(250);
  }
  return 'timeout';
};
// 弹窗「开着」判据＝存在可见（display 非 none）且含标题的 .modal-mask。
// 注意不能查 .modal 内盒：close() 后 mask 隐藏、内盒连同标题文本仍留在 DOM（display:block）。
const modalUp = async () => await evalJs("(function(){\
  var ms=document.querySelectorAll('.modal-mask');\
  for (var i=0;i<ms.length;i++){\
    var cs=getComputedStyle(ms[i]);\
    if (cs.display==='none'||cs.visibility==='hidden') continue;\
    if ((ms[i].textContent||'').indexOf('发现旧版备份留底副本')>=0) return 1;\
  }\
  return 0;})()");
const clickPill = (label) => evalJs(`(function(){
  var want = ${JSON.stringify(label)};
  var els = document.querySelectorAll('.modal-pill,.modal-btn,button,div,span');
  for (var i = els.length - 1; i >= 0; i--) {
    if ((els[i].textContent || '').trim() === want) { els[i].click(); return 1; }
  }
  return 0;
})()`);

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

// ---- 场景 1：种键 → 重开 → 弹窗 → 立即清理 ----
const r1 = await withFreshBrowser(async () => {
  await boot();
  const seeded = await seedSnap();
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  await boot();
  const has = await keyInIdb();
  let modal = 0;
  for (let i = 0; i < 60; i++) { modal = await modalUp(); if (modal) break; await sleep(500); } // 最多 30s（首拍 +12s、保险丝 +20s）
  const errsBefore = JSON.parse(await evalJs('JSON.stringify(window.__errs.slice(0,5))') || '[]');
  let gone = null, toastTxt = '';
  if (modal) {
    await clickPill('立即清理');
    for (let i = 0; i < 60; i++) { gone = await keyInIdb(); if (gone === false) break; await sleep(500); }
    for (let i = 0; i < 12; i++) { // toast 在复核链 onDone（≥1.5s）后才弹，轮询等
      toastTxt = await evalJs("(function(){var t=document.getElementById('cc-toast');return t?(t.textContent||''):'';})()") || '';
      if (toastTxt.indexOf('已清理') >= 0) break;
      await sleep(500);
    }
  }
  const errs = JSON.parse(await evalJs('JSON.stringify(window.__errs.slice(0,5))') || '[]');
  return { seeded, has, modal, gone, toastTxt, errs, errsBefore };
});
check('S1 前提：种键成功且重开后键在（IDB 权威）', r1.seeded === 1 && r1.has === true, 'seed=' + r1.seeded + ' has=' + r1.has);
check('S2 ★主判据：出现「发现旧版备份留底副本」弹窗（纯 HEAD 静默删＝永不弹）', r1.modal === 1, 'modal=' + r1.modal);
check('S3 点「立即清理」→ 键删净（idbHasKey=false）', r1.gone === false, 'has=' + r1.gone);
check('S4 结果回告 toast 含「已清理」', r1.toastTxt.indexOf('已清理') >= 0, r1.toastTxt.slice(0, 40));
check('Z1 场景1零未捕获异常', r1.errs.length === 0, JSON.stringify(r1.errs));

// ---- 场景 2：下次再说 → 3 天冷却内重开不再弹 ----
const r2 = await withFreshBrowser(async () => {
  await boot();
  await seedSnap();
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  await boot();
  let modal = 0;
  for (let i = 0; i < 60; i++) { modal = await modalUp(); if (modal) break; await sleep(500); }
  let closed = 0;
  if (modal) {
    await clickPill('下次再说');
    await sleep(600);
    closed = await modalUp();
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(2500);
    await boot();
  }
  let modal2 = 0;
  for (let i = 0; i < 60; i++) { modal2 = await modalUp(); if (modal2) break; await sleep(500); }
  const errs = JSON.parse(await evalJs('JSON.stringify(window.__errs.slice(0,5))') || '[]');
  return { modal, closedAfter: closed, modal2, errs };
});
check('D1a 首次重开弹窗在（冷却前）', r2.modal === 1, 'modal=' + r2.modal);
check('D1b 点「下次再说」后弹窗关', r2.closedAfter === 0, 'visible=' + r2.closedAfter);
check('D1c 冷却 3 天内重开不再弹', r2.modal2 === 0, 'modal=' + r2.modal2);
check('Z2 场景2零未捕获异常', r2.errs.length === 0, JSON.stringify(r2.errs));

try { server.close(); } catch (e) {}
console.log(pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

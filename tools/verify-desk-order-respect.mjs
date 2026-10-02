// ===== 验证：#405 布局迁移一次性语义——用户排序不再被 ensure* 强制改回 =====
// 回归 v3.26.x #405（#380/#393/#400「迁移/自动逻辑覆盖用户显式操作」同族第三批，无头实证）：
//   A. ensureDeskPeriodP3Order 每次启动把第三页经期卡强制排到备忘卡前面——用户装修调换
//      两卡顺序后刷新/切桌面被打回；修复=有布局一律尊重（#380 先例）；
//   B. ensureP2AppsBelowWeekend 每次启动无条件改写存储把 p2apps 换到摸鱼卡下方——用户
//      挪到上方后刷新被改回；修复=有布局首跑落标记 p2apps-order-mig=1（含首跑恰逢顺序
//      正确的场景），换序迁移只跑一次，此后尊重用户排序；
//   C. ensureP2SecondRowIcons p3→p2 图标救回无一次性语义；修复=首跑落标记 p2icons-p3-mig=1。
// 用法：node tools/verify-desk-order-respect.mjs（需先 node build.mjs）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 400));
const userDataDir = join(process.env.TEMP || '/tmp', 'mochi-dordr-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + userDataDir,
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return null;
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) { results.push(!!ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const getStore = (k) => evalJs(`(function(){ try { return window.activeStore().get('${k}') || ''; } catch(e){ return 'ERR'; } })()`);
const setStore = (k, v) => evalJs(`(function(){ try { window.activeStore().set('${k}', ${JSON.stringify(v)}); return 1; } catch(e){ return 0; } })()`);
// DOM 内两组件先后序：返回 'A-first'|'B-first'|'MISSING'
const domOrder = (selA, selB) => evalJs(`(function(){
  var a=document.querySelector('${selA}'), b=document.querySelector('${selB}');
  if(!a||!b) return 'MISSING';
  var pool=document.getElementById('desk-widget-pool');
  if(pool&&(a.parentNode===pool||b.parentNode===pool)) return 'POOL';
  if(a.closest('.page-slide')!==b.closest('.page-slide')) return 'DIFF-PAGE';
  var s=a.parentNode;
  return Array.prototype.indexOf.call(s.children,a)<Array.prototype.indexOf.call(s.children,b)?'A-first':'B-first';
})()`);
const layHasOrder = (before, after) => evalJs(`(function(){
  try {
    var v=window.activeStore().get('desk-layout'); if(!v) return 'NOLAY';
    var lay=JSON.parse(v);
    for (var i=0;i<lay.length;i++){ var pg=lay[i]||[];
      var bi=pg.indexOf('${before}'), ai=pg.indexOf('${after}');
      if(bi>=0&&ai>=0) return bi<ai?'A-first':'B-first';
    }
    return 'NOT-SAME-PAGE';
  } catch(e){ return 'ERR'; }
})()`);

const nav = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(400);
  await evalJs("(function(){var c=document.getElementById('splash-confirm-ok');if(c&&!c.hidden)c.click();return 1;})()");
  await sleep(400);
  await evalJs("(function(){var s=document.getElementById('splash');if(s)s.classList.add('hide');return 1;})()");
  await sleep(900);
};

console.log('== 准备：首航（无布局）+ 写入模拟用户已保存的排序 ==');
await nav();
// 3 页桌面；page1: weekend → p2apps（「正确」默认序）；page2: memo-row → desk-period（用户调换后的序：经期卡在备忘卡之后）
const L1 = JSON.stringify([['deco', 'quote-row', 'checkin', 'apps'], ['music', 'weekend', 'p2apps'], ['memo-row', 'desk-period']]);
await setStore('desk-page-count', '3');
await setStore('desk-layout', L1);

console.log('== A+B 第一航：有布局首跑（B 首跑恰逢顺序正确 → 只落标记不换序；A 直接尊重） ==');
await nav();
check('P1 B 首跑标记已落盘（顺序正确也要落，保证后续挪动受尊重）', await getStore('p2apps-order-mig') === '1', 'v=' + await getStore('p2apps-order-mig'));
check('P2 C 首跑标记已落盘', await getStore('p2icons-p3-mig') === '1', 'v=' + await getStore('p2icons-p3-mig'));
check('A1 经期卡在备忘卡之后（存储序被 DOM 尊重，不被 ensureDeskPeriodP3Order 打回）', await domOrder('[data-desk-widget="memo-row"]', '[data-desk-widget="desk-period"]') === 'A-first', await domOrder('[data-desk-widget="memo-row"]', '[data-desk-widget="desk-period"]'));
check('B1 p2apps 仍在摸鱼卡之后（首跑顺序正确不改写存储）', await layHasOrder('weekend', 'p2apps') === 'A-first', await layHasOrder('weekend', 'p2apps'));

console.log('== A+B 第二航：模拟用户把 p2apps 挪到摸鱼卡上方后刷新 ==');
const L2 = JSON.stringify([['deco', 'quote-row', 'checkin', 'apps'], ['music', 'p2apps', 'weekend'], ['memo-row', 'desk-period']]);
await setStore('desk-layout', L2);
await nav();
check('B2 存储未被改回（p2apps 保持在摸鱼卡之前）', await layHasOrder('p2apps', 'weekend') === 'A-first', await layHasOrder('p2apps', 'weekend'));
check('B3 DOM 尊重用户排序（p2apps 在摸鱼卡之前）', await domOrder('[data-desk-widget="p2apps"]', '[data-desk-widget="weekend"]') === 'A-first', await domOrder('[data-desk-widget="p2apps"]', '[data-desk-widget="weekend"]'));
check('A2 经期卡仍在备忘卡之后（多次刷新持续尊重）', await domOrder('[data-desk-widget="memo-row"]', '[data-desk-widget="desk-period"]') === 'A-first', await domOrder('[data-desk-widget="memo-row"]', '[data-desk-widget="desk-period"]'));
check('B4 布局其余部分未被 ensureDeskPeriod 擅自改动（desk-period 仍在布局内）', (await getStore('desk-layout')).indexOf('desk-period') >= 0);

chrome.kill();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 断言通过');
process.exit(pass === results.length ? 0 : 1);

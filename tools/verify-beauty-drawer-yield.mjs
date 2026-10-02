// ===== 回归 #804：桌面「边看边调」抽屉两处同病（聊天版 #783 同族）=====
//   ① 抽屉 cssText 内联 z-index:95 压过 openModal 的 .modal-mask(90)——抽屉里走 openModal 的
//      弹层（手输色值等）被盖在背后＝「点了没反应」；修法＝240ms 让位轮询（有可见浮层→压到
//      最低浮层-1，全收起→回基本层 95）。
//   ② 抽屉是 body 级固定层，离开桌面页自己不收——切页后仍占屏底并盖住 z-index:2 的底部导航；
//      修法＝同轮询里「page-phone 隐藏＝就地收起」，不做导航。
// 断言（绿基线全过；纯 HEAD 红基线恰红 B2/B4＝缺陷本体）：
//   B1 开抽屉 → #beauty-drawer 可见、基本层 95、桌面页在show
//   B2 植入可见 .modal-mask(90) → 700ms 内抽屉让位到 89（弹层浮到抽屉之上）   （HEAD 红）
//   B3 浮层收起 → 抽屉回基本层 95
//   B4 离开桌面页（page-phone hidden）→ 抽屉就地收起（display none，不导航）  （HEAD 红）
//   B5 再开 → 抽屉重建可见、回基本层 95（cssText 每次重写＝基本层事实源）
//   B6 全程零 JS 报错
// 用法：node tools/verify-beauty-drawer-yield.mjs
//       仓外副本验证：SERVE_DIR=<构建目录> node tools/verify-beauty-drawer-yield.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_DIR || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 90));
const profile = join(process.env.TEMP || '/tmp', 'mochi-804dy-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 260)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
};
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + JSON.stringify(detail) + ']'));
}

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html?d804dy=' + Date.now() });
for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);
await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
await sleep(700);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
await sleep(300);

// B1 开抽屉（#dq-drawer 点击 → openBeautyDrawer 自导航到桌面页）
await evalJs("(function(){var b=document.getElementById('dq-drawer');if(b)b.click();return 1;})()");
await sleep(500);
const B1 = await evalJs("(function(){var d=document.getElementById('beauty-drawer');var p=document.getElementById('page-phone');if(!d)return 'no-drawer';var cs=getComputedStyle(d);return [d.style.display, cs.zIndex, p && !p.hidden ? 1 : 0].join(',');})()");
check('B1 开抽屉 → #beauty-drawer 可见、基本层 95、桌面页在show', B1 === 'flex,95,1', B1);

// B2 植入可见 .modal-mask(90) → 抽屉让位到 89
await evalJs("(function(){window.__m=document.createElement('div');window.__m.className='modal-mask';window.__m.style.cssText='position:fixed;inset:0;z-index:90;display:flex;background:rgba(0,0,0,.3)';document.body.appendChild(window.__m);return 1;})()");
await sleep(800);
const B2 = await evalJs("(function(){var d=document.getElementById('beauty-drawer');return d?d.style.zIndex:'no-drawer';})()");
check('B2 植入可见 .modal-mask(90) → 700ms 内抽屉让位到 89（弹层浮到抽屉之上）', B2 === '89', B2);

// B3 浮层收起 → 抽屉回基本层 95
await evalJs("(function(){if(window.__m)window.__m.style.display='none';return 1;})()");
await sleep(800);
const B3 = await evalJs("(function(){var d=document.getElementById('beauty-drawer');return d?d.style.zIndex:'no-drawer';})()");
check('B3 浮层收起 → 抽屉回基本层 95（cssText 的 z-index:95 是唯一事实源，不置空漂移）', B3 === '95', B3);

// B4 离开桌面页 → 抽屉就地收起
await evalJs("(function(){var p=document.getElementById('page-phone');if(p)p.hidden=true;return 1;})()");
await sleep(800);
const B4 = await evalJs("(function(){var d=document.getElementById('beauty-drawer');return d?d.style.display:'no-drawer';})()");
check('B4 离开桌面页（page-phone hidden）→ 抽屉就地收起（display none，不导航拽人）', B4 === 'none', B4);

// B5 再开 → 重建可见、回基本层
await evalJs("(function(){var b=document.getElementById('dq-drawer');if(b)b.click();return 1;})()");
await sleep(500);
const B5 = await evalJs("(function(){var d=document.getElementById('beauty-drawer');var p=document.getElementById('page-phone');if(!d)return 'no-drawer';return [d.style.display, getComputedStyle(d).zIndex, p && !p.hidden ? 1 : 0].join(',');})()");
check('B5 再开 → 抽屉重建可见、回基本层 95、桌面页在show', B5 === 'flex,95,1', B5);

// B6 零报错
const jsErrs = await evalJs("(window.__jsErrors||[]).slice(0,4).join(' | ')");
check('B6 全程零 JS 报错', !jsErrs, jsErrs);

const pass = results.filter((r) => r.ok).length;
console.log('— 合计 ' + pass + '/' + results.length + ' —');
await cdp('Browser.close').catch(() => {});
chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
server.close();
process.exit(pass === results.length ? 0 : 1);

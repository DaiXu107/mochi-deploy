// ===== 回归脚本：词典页「点进去上下滑不了页面」（#350，v3.26.x 修复） =====
// 用法：node build.mjs && node tools/verify-dict-scroll.mjs
// 背景（用户反馈：荣耀畅玩40 Plus/夸克 报障，明说其他设备型号也有）：v3.36.x 词典页在
//   #d2-dict-list 上方插入「场景开关 + 使用概率」两组设置块（~660px）后，漏加 #239 同款
//   「整页滚动」规则——.card-list{flex:1;overflow-y:auto} 的 overflow 非 visible 使 flex
//   自动最小尺寸归 0：列表被压成 29px（423×853）/6px（360×640，且 top=762 整个在屏外），
//   页面 scrollH==clientH 无可滚＝上下滑不了（纯 CSS 布局，全机型必现，与设备无关）。
// 修复：chat-pages.css 加 #page-dict-cards{overflow-y:auto} +
//   #page-dict-cards #d2-dict-list{flex:0 0 auto;overflow:visible;...}（同 fc/dk 页双保险）。
// 验证（无头 Chrome 触摸仿真，真实点击 #li-dict-cards 走渲染链）：修复前 A2/A3/A4 红；
//   修复后全绿——列表回到文档流随页滚动、首屏可见、设置块滚动可达、零 JS 报错。
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) p = join(root, 'index.html');
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9750 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dictscroll-' + Date.now()),
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

async function openDictPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 20; i++) {
    const ok = await evalJs(`!!document.getElementById('li-dict-cards') && document.readyState === 'complete'`);
    if (ok) break;
    await sleep(400);
  }
  const opened = await evalJs(`(function(){
    const li = document.getElementById('li-dict-cards');
    if (!li) return false;
    li.click();
    return !!document.getElementById('page-dict-cards') && !document.getElementById('page-dict-cards').hidden;
  })()`);
  // 等虚拟列表渲染稳定
  let n0 = -1;
  for (let i = 0; i < 20; i++) {
    await sleep(350);
    const n = await evalJs(`document.getElementById('d2-dict-list') ? document.getElementById('d2-dict-list').getElementsByTagName('*').length : 0`);
    if (n > 0 && n === n0) break;
    n0 = n;
  }
  return opened;
}

const MEASURE = `(function(){
  const page = document.getElementById('page-dict-cards');
  const list = document.getElementById('d2-dict-list');
  if (!page || !list) return null;
  const lcs = getComputedStyle(list);
  const lr = list.getBoundingClientRect();
  return {
    pageClientH: page.clientHeight, pageScrollH: page.scrollHeight,
    listFlex: lcs.flex, listOvy: lcs.overflowY,
    listTop: Math.round(lr.top), listH: Math.round(lr.height),
    innerH: window.innerHeight,
    nodes: list.getElementsByTagName('*').length
  };
})()`;

async function runViewport(label, w, h) {
  console.log('\n[' + label + ' ' + w + 'x' + h + ']');
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  const opened = await openDictPage();
  check('A0 词典入口可点、页面打开', opened === true);
  const m = await evalJs(MEASURE);
  check('A1 列表已渲染（虚拟窗口在位）', !!m && m.nodes > 20, m ? 'nodes=' + m.nodes : 'null');
  check('A2 列表脱离 flex 挤压（flex 0 0 auto + overflow visible）', !!m && m.listFlex.indexOf('0 0 auto') === 0 && m.listOvy === 'visible', m ? 'flex=' + m.listFlex + ' ovy=' + m.listOvy : 'null');
  check('A3 页面可滚（scrollH > clientH）', !!m && m.pageScrollH > m.pageClientH + 100, m ? m.pageScrollH + ' vs ' + m.pageClientH : 'null');
  // A4：列表可达且高度充足——设置块本身可能高于小屏视口，断言「滚动后进入视口」而非「首屏」
  const a4 = await evalJs(`(function(){
    const page = document.getElementById('page-dict-cards');
    const list = document.getElementById('d2-dict-list');
    const top0 = Math.round(list.getBoundingClientRect().top);
    if (top0 >= 0 && top0 < window.innerHeight) return { vis: true, h: Math.round(list.getBoundingClientRect().height) };
    page.scrollTop = top0 - 80;
    const r = list.getBoundingClientRect();
    const vis = r.top >= -10 && r.top < window.innerHeight;
    page.scrollTop = 0;
    return { vis: vis, h: Math.round(r.height) };
  })()`);
  check('A4 列表滚动可达且高度充足（>300px）', !!a4 && a4.vis && a4.h > 300, a4 ? 'vis=' + a4.vis + ' h=' + a4.h : 'null');
  const a5 = await evalJs(`(function(){ const p = document.getElementById('page-dict-cards'); p.scrollTop = 800; const t = p.scrollTop; p.scrollTop = 0; return t; })()`);
  check('A5 滚动容器响应（scrollTop 可设置）', !!a5 && a5 > 0, 'took=' + a5);
  const sc = await evalJs(`(function(){
    const page = document.getElementById('page-dict-cards');
    const st = document.getElementById('dict-overall-chat');
    if (!st) return null;
    const r0 = st.getBoundingClientRect();
    const docTop = Math.round(r0.top + page.scrollTop);
    page.scrollTop = Math.max(0, docTop - 80);
    const r = st.getBoundingClientRect();
    const vis = r.top >= -10 && r.top < window.innerHeight;
    page.scrollTop = 0;
    return { vis: vis, top: Math.round(r.top) };
  })()`);
  check('A6 设置块滚动可达（stepper 进入视口）', !!sc && sc.vis, sc ? 'vis=' + sc.vis + ' top=' + sc.top : 'null');
  const errs = await evalJs(`(window.__jsErrors||[]).length`);
  check('A7 零 JS 报错', errs === 0, 'errs=' + errs);
}

await runViewport('荣耀畅玩40 Plus/夸克 现场', 423, 853);
await runViewport('小屏机', 360, 640);

chrome.kill();
server.close();
console.log('\n结果: ' + pass + ' 过 / ' + fail + ' 败');
process.exit(fail ? 1 : 0);

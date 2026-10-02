// ===== 回归脚本：聊天记录滚动跳动/闪烁——解钉动态开回浏览器滚动锚定（v3.31.x #316 修复） =====
// 用法：node build.mjs && node tools/verify-chat-anchor.mjs
// 背景（用户反馈：红米 K80 Chrome 聊天页「聊天记录一直跳、一直闪」，明说其他设备型号也有）：
//   #199 为治 Gecko 锚定与 #162 贴底钉住对打，给 .chat-body 无差别加了 overflow-anchor:none——
//   Chromium 原生滚动锚定被一并关掉。浏览图片较多的历史时，视口上方消息里的图片异步解码撑高
//   （.msg-img 最高 260px/张）再无任何补偿 → 看的内容一次次被推走＝「一直跳、一直闪」。
// 修复：解钉（用户手动触摸/滚轮滚动 chat-body）时挂 .scroll-anchor-auto 开回锚定，由内核原生
//   保持视口稳定；回钉贴底（scrollChatBottom）时摘除——#199 防对打只涉及钉住态，语义不变。
// 验证（无头 Chrome 390×844 触摸仿真）：进聊天默认钉住=锚定 none / 视口上方插入 200px 内容
//   参照消息被推走（修复前形态，证明断言有牙）/ 触摸解钉后类挂上+锚定 auto / 同样插入参照
//   消息不再移动（锚定接管=修复生效）。
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
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9550 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-chatachor-' + Date.now()),
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
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

// 种 60 条文本消息（足够撑出滚动）
await evalJs(`(function(){
  var msgs = [];
  for (var i = 0; i < 60; i++) msgs.push({ side: i % 2 ? 'in' : 'out', text: '滚动锚定验证消息 ' + i + '，内容用于撑起消息区滚动', ts: 1700000000000 + i * 60000 });
  try { localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(msgs)); } catch (e) { return 'ERR:' + e.message; }
  return 'ok:' + msgs.length;
})()`);
await cdp('Page.reload', { ignoreCache: false });
await sleep(4000);
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// 模拟「视口上方图片解码撑开」：先在滚动区顶部放一个 0 高元素（同图片未加载态），
// 滚到中段后把它长高 200px，返回参照消息（视口内第一条）相对视口顶的位移。
// 注：必须用【已有元素尺寸增长】而非插入新节点——Chromium 对 flex 容器的节点插入
// 无视 overflow-anchor 也会原生补偿（实测），只有尺寸增长才区分 none/auto。
const probeExpr = `(async function(){
  var cb = document.getElementById('chat-body');
  var grow = document.createElement('div');
  grow.style.cssText = 'height:0;flex:none';
  cb.insertBefore(grow, cb.firstChild);
  cb.scrollTop = Math.round(cb.scrollHeight * 0.5); // 滚到中段
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  var ref = null;
  for (var k = 0; k < cb.children.length; k++) {
    var r = cb.children[k].getBoundingClientRect();
    if (r.top >= 0 && r.bottom > 0) { ref = cb.children[k]; break; }
  }
  if (!ref) { grow.remove(); return JSON.stringify({ err: 'no-ref' }); }
  var before = ref.getBoundingClientRect().top;
  grow.style.height = '200px'; // 上方内容撑高 200px（模拟上方图片解码完成）
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  var after = ref.getBoundingClientRect().top;
  grow.remove();
  await new Promise(function(r){ requestAnimationFrame(r); });
  return JSON.stringify({ drift: Math.round(after - before) });
})()`;

// A) 初始钉住态：锚定必须仍是 none（#199 语义不变），类未挂
const a = JSON.parse(await evalJs(`JSON.stringify({
  cls: document.getElementById('chat-body').classList.contains('scroll-anchor-auto'),
  oa: getComputedStyle(document.getElementById('chat-body')).overflowAnchor
})`));
chk('A1 初始钉住态未挂锚定类', a.cls === false, JSON.stringify(a));
chk('A2 初始钉住态 overflow-anchor=none（#199 不回归）', a.oa === 'none', JSON.stringify(a));

// B) 修复前形态对照：钉住态（锚定关）上方撑高 200px → 参照消息被推走（证明断言有牙）
const b = JSON.parse(await evalJs(probeExpr));
chk('B1 锚定关时上方撑高 200px 参照消息被推走（修复前形态）', b.drift >= 150, JSON.stringify(b));

// C) 触摸解钉：类挂上、锚定开回
await evalJs(`(function(){
  var cb = document.getElementById('chat-body');
  cb.dispatchEvent(new Event('touchstart', { bubbles: true }));
  return 1;
})()`);
await sleep(100);
const c = JSON.parse(await evalJs(`JSON.stringify({
  cls: document.getElementById('chat-body').classList.contains('scroll-anchor-auto'),
  oa: getComputedStyle(document.getElementById('chat-body')).overflowAnchor
})`));
chk('C1 触摸解钉后挂上锚定类', c.cls === true, JSON.stringify(c));
chk('C2 解钉后 overflow-anchor=auto', c.oa === 'auto', JSON.stringify(c));

// D) 修复生效：解钉态上方撑高 200px，参照消息不再被推走（原生锚定接管）
const d = JSON.parse(await evalJs(probeExpr));
chk('D1 锚定开启时上方撑高 200px 视口稳定（修复生效）', Math.abs(d.drift) <= 10, JSON.stringify(d));

{ // 隔离对照：合成滚动容器验证本 Chrome 锚定能力
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  const iso = JSON.parse(await evalJs(`(async function(){
    document.body.innerHTML = '<div id=s style=height:300px;overflow-y:auto><div style=height:100px>top</div><div style=height:800px>fill</div></div>';
    var s = document.getElementById('s');
    s.scrollTop = 200;
    await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
    var fill = s.children[1];
    var before = fill.getBoundingClientRect().top;
    var pad = document.createElement('div'); pad.style.height = '200px';
    s.insertBefore(pad, s.firstChild);
    await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
    var after = fill.getBoundingClientRect().top;
    return JSON.stringify({ drift: Math.round(after - before), oa: getComputedStyle(s).overflowAnchor });
  })()`));
  console.log('isolated-anchoring:', JSON.stringify(iso));
}
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill();
process.exit(fail ? 1 : 0);

// #417 聊天/群聊「每次点滑动自动往最新消息最底下跳」行为断言
// （红米 K80 Chrome 实报，多机型同现；设备无关纯逻辑）
// 断言：
//  C1) 单聊：触摸解钉 + 上翻到离底 ~100px 停稳 → 不回钉（scrollTop 保持、scroll-anchor-auto 类保持）
//      ——修复前 120px 容差把「上翻读最新一条停下」当回钉、直接拽回最底（红）
//  C2) 单聊：滚回真正贴底停稳 → 回钉（类摘除，自动跟底恢复）
//  C3) 单聊：离底 ~100px 时轻点（位移<10px）→ 不回钉（修复前一点气泡就被拽回最底）
//  C4) 单聊：真正贴底时轻点 → 回钉（类摘除，#378 轻点回跟语义不回归）
//  G1) 群聊：touchstart + 上翻到离底 ~100px 停稳 → 接管保持（类仍在、scrollTop 保持）
//      ——修复前第一个 scroll 事件（离底<150px）就清掉接管，下一条成员回复 followGcBottom 拽回最底（红）
//  G2) 群聊：滚回真正贴底停稳 → 接管解除（类摘除，自动跟底恢复）
//  G3) 群聊：离底 ~100px 轻点 → 接管保持；真正贴底轻点 → 接管解除
// 用法：node tools/verify-near-bottom-no-yank.mjs（对产物 index.html）
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
const cdpPort = 9660 + Math.floor(Math.random() * 80);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vnb-' + Date.now()),
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
  if (r && r.exceptionDetails) { console.error('JS exception:', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// 种 600 条（LS 直写 + IDB 双写 + reload 原子化）
await cdp('Page.navigate', { url: 'about:blank' });
await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await passMandatory();
await sleep(400);
const seeded = await evalJs(`(function(){
  try {
    var N = 600, seed = [], t0 = 1700000000000;
    for (var i = 0; i < N; i++) seed.push({ side: i % 2 ? 'in' : 'out', text: '贴底回钉验证' + i + '，用于撑起滚动', ts: t0 + i * 60000 });
    localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(seed));
    localStorage.setItem('xy-home-v2:group-chat-msgs', JSON.stringify(seed));
    localStorage.setItem('xy-home-v2:default:chat-meta', JSON.stringify({ n: N, b: 3000000 }));
    return Promise.all([
      window.idbSet('xy-home-v2:default:chat-msgs', JSON.stringify(seed)),
      window.idbSet('xy-home-v2:group-chat-msgs', JSON.stringify(seed)),
      window.idbSet('xy-home-v2:default:chat-meta', JSON.stringify({ n: N, b: 3000000 }))
    ]).then(function(){ location.reload(); return 'ok'; });
  } catch (e) { return 'err:' + String(e); }
})()`);
await sleep(3500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await passMandatory();
await sleep(800);

// #384 强制公告：点 splash 后必须滑到底 + 点确认才真正进入
async function passMandatory() {
  for (let i = 0; i < 10; i++) {
    const r = await evalJs(`(function(){
      var m = document.getElementById('splash-mandatory');
      if (!m || m.hidden) return 'none';
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var en = document.getElementById('splash-mandatory-enter');
      if (en && !en.classList.contains('is-disabled')) { en.click(); return 'entered'; }
      return 'wait';
    })()`);
    if (r === 'entered' || r === 'none') return r;
    await sleep(250);
  }
  return 'timeout';
}

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

function touchStartExpr(id, clientY) {
  return `(function(){
    var b = document.getElementById('${id}');
    try {
      var t = new Touch({ identifier: 1, target: b, clientX: 100, clientY: ${clientY} });
      b.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    } catch (e) { b.dispatchEvent(new Event('touchstart', { bubbles: true })); }
    return 1;
  })()`;
}
function touchEndExpr(id, dy) {
  return `(function(){
    var b = document.getElementById('${id}');
    try {
      var t1 = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 400 });
      var t2 = new Touch({ identifier: 1, target: b, clientX: 100, clientY: ${400 + dy} });
      b.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], targetTouches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
      b.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
    } catch (e) {}
    return 1;
  })()`;
}
async function bodyState(id) {
  return JSON.parse(await evalJs(`JSON.stringify((function(){
    var b = document.getElementById('${id}');
    return { st: Math.round(b.scrollTop), max: Math.round(b.scrollHeight - b.clientHeight), cls: b.classList.contains('scroll-anchor-auto') };
  })())`));
}

// ---- 单聊 ----
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="chat"]'); if (ic) ic.click(); return !!ic; })()`);
await sleep(1800);

// C1 触摸解钉 + 上翻到离底 ~100px 停稳 → 不回钉
await evalJs(touchStartExpr('chat-body', 700));
await evalJs(`(function(){ var b = document.getElementById('chat-body'); b.scrollTop = Math.max(0, b.scrollHeight - b.clientHeight - 100); return Math.round(b.scrollTop); })()`);
await sleep(450);
{
  const s = await bodyState('chat-body');
  const up = s.max - s.st;
  chk('C1 单聊上翻离底~100px 停稳不回钉（scrollTop 保持 + 锚定类保持）', s.cls === true && up >= 80 && up <= 130, JSON.stringify(s));
}

// C2 滚回真正贴底停稳 → 回钉
await evalJs(`(function(){ var b = document.getElementById('chat-body'); b.scrollTop = b.scrollHeight; return 1; })()`);
await sleep(450);
{
  const s = await bodyState('chat-body');
  chk('C2 单聊滚回贴底停稳后回钉（类摘除=自动跟底恢复）', s.cls === false && s.st >= s.max - 2, JSON.stringify(s));
}

// C3 离底~100px 轻点 → 不回钉
await evalJs(touchStartExpr('chat-body', 700));
await evalJs(`(function(){ var b = document.getElementById('chat-body'); b.scrollTop = Math.max(0, b.scrollHeight - b.clientHeight - 100); return 1; })()`);
await sleep(450);
await evalJs(touchEndExpr('chat-body', 5));
await sleep(350);
{
  const s = await bodyState('chat-body');
  const up = s.max - s.st;
  chk('C3 单聊离底~100px 轻点不回钉（类保持、位置保持）', s.cls === true && up >= 80 && up <= 130, JSON.stringify(s));
}

// C4 真正贴底轻点 → 回钉（#378 轻点回跟不回归）
await evalJs(`(function(){ var b = document.getElementById('chat-body'); b.scrollTop = b.scrollHeight; return 1; })()`);
await sleep(200);
await evalJs(touchEndExpr('chat-body', 5));
await sleep(350);
{
  const s = await bodyState('chat-body');
  chk('C4 单聊真正贴底轻点回钉（类摘除，#378 语义不回归）', s.cls === false && s.st >= s.max - 2, JSON.stringify(s));
}

// ---- 群聊 ----
await evalJs(`(function(){ var bk = document.getElementById('chat-back'); if (bk) bk.click(); return 1; })()`);
await sleep(700);
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="group-chat"]'); if (ic) ic.click(); return !!ic; })()`);
await sleep(2000);

// G1 touchstart + 上翻到离底 ~100px 停稳 → 接管保持
await evalJs(touchStartExpr('gc-body', 700));
await evalJs(`(function(){ var b = document.getElementById('gc-body'); b.scrollTop = Math.max(0, b.scrollHeight - b.clientHeight - 100); return Math.round(b.scrollTop); })()`);
await sleep(500);
{
  const s = await bodyState('gc-body');
  const up = s.max - s.st;
  chk('G1 群聊上翻离底~100px 停稳接管保持（类保持、位置保持）', s.cls === true && up >= 80 && up <= 130, JSON.stringify(s));
}

// G2 滚回真正贴底停稳 → 接管解除
await evalJs(`(function(){ var b = document.getElementById('gc-body'); b.scrollTop = b.scrollHeight; return 1; })()`);
await sleep(500);
{
  const s = await bodyState('gc-body');
  chk('G2 群聊滚回贴底停稳后解除接管（类摘除=自动跟底恢复）', s.cls === false && s.st >= s.max - 2, JSON.stringify(s));
}

// G3 离底~100px 轻点 → 接管保持；真正贴底轻点 → 接管解除
await evalJs(touchStartExpr('gc-body', 700));
await evalJs(`(function(){ var b = document.getElementById('gc-body'); b.scrollTop = Math.max(0, b.scrollHeight - b.clientHeight - 100); return 1; })()`);
await sleep(500);
await evalJs(touchEndExpr('gc-body', 5));
await sleep(350);
{
  const s = await bodyState('gc-body');
  const up = s.max - s.st;
  chk('G3a 群聊离底~100px 轻点接管保持（类保持、位置保持）', s.cls === true && up >= 80 && up <= 130, JSON.stringify(s));
}
await evalJs(`(function(){ var b = document.getElementById('gc-body'); b.scrollTop = b.scrollHeight; return 1; })()`);
await sleep(200);
await evalJs(touchEndExpr('gc-body', 5));
await sleep(350);
{
  const s = await bodyState('gc-body');
  chk('G3b 群聊真正贴底轻点接管解除（类摘除，自动跟底恢复）', s.cls === false && s.st >= s.max - 2, JSON.stringify(s));
}

console.log('\nseed=' + seeded + '  通过 ' + pass + ' / 失败 ' + fail);
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);

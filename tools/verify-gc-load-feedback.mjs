// ===== 回归脚本：#710 群聊「进群白屏干等无加载反馈」（#703 同族收尾，用户确认补） =====
// 用法：node tools/verify-gc-load-feedback.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// 背景：enterGroupChat→loadMsgs 先渲 LS 快照（可能为空/只有尾部），再 IDB 异步读群消息大键，
//   大群/LS 空窗口整屏空白零提示——群聊页此前连进度条元素都没有。
// 修复：template 群聊页加 #gc-loading（复用单聊 .chat-loading 同款样式类）；
//   loadMsgs 读库前置位、落定/切群/兜底 12s 即收起（gcLoadSeq 作废旧等待）。
// 判据：
//   A 轴（源码锚）：模板锚点 / 显隐条件 / 落定收起函数。
//   B 轴（真实产物 390×844，Android UA，CPU 4× 节流，IDB 只种大包、LS 不种＝真实空白窗口）：
//     B1 点群聊图标后进度条 400ms 内出现（修前无元素恒隐藏）
//     B2 进度条最终收起（不挂死）
//     B3 功能不回归：权威群记录真的渲染出来
//     B4 空库群（IDB/LS 都没数据）：进度条也会收起（#710 无权威数据路径），不无限转
//   Z 轴：全程零 JS 异常。
// RED 基线（HEAD 的 template.html + group-chat.js）：B1 红（#gc-loading 不存在）、B4 红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)));
const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();
const root = normalize(process.env.MOCHI_ROOT || argRoot || join(here, '..'));

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- A 轴：源码锚 ----------
console.log('A 轴（源码作用域）   root=' + root);
let tplSrc = '', gcSrc = '';
try { tplSrc = readFileSync(join(root, 'src/template.html'), 'utf8'); } catch (e) {}
try { gcSrc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8'); } catch (e) {}
chk('A1 群聊页加载条模板锚点（#710a）', tplSrc.includes('id="gc-loading"'));
chk('A2 进度条显隐绑「页面可见且权威在途」（#710b）', gcSrc.includes('gcLoadingEl.hidden = !(page && !page.hidden && gcAuthPending);'));
chk('A3 读库落定收起＋切群作废旧等待（#710c）', gcSrc.includes('function gcLoadSettle(seq)'));

// ---------- B 轴：真实产物 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }
if (!existsSync(join(root, 'index.html'))) { console.error('no index.html in ' + root); process.exit(1); }

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
const profile = join(process.env.TEMP || '/tmp', 'mochi-v710-' + Date.now());
const cdpPort = 9300 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
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
  if (r && r.exceptionDetails) {
    const ex = r.exceptionDetails;
    console.error('JS exception:', (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text);
    return null;
  }
  return r && r.result ? r.result.value : null;
}
function cleanup(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(code);
}

const mkImg = (n) => 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="hsl(' + (n * 41) + ',70%,55%)"/><text x="20" y="100" font-size="64" fill="white">' + n + '</text><!--' + 'y'.repeat(7000) + '--></svg>').toString('base64');

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2.75, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(600);

// 种子：默认群消息大包只进 IDB（150 条含 40 图 ≈0.6MB）、LS 不种＝进群真实空白读库窗口
const seed = await evalJs(`(async function(){
  var IMG = ${JSON.stringify(Array.from({ length: 20 }, (_, i) => mkImg(i)))};
  var out = []; var now = Date.now();
  for (var i = 0; i < 150; i++) {
    var w = i % 3 !== 2;
    out.push(w ? {side:'in',ts:now-(150-i)*60000,text:IMG[i%IMG.length],parts:[{k:'img',v:IMG[i%IMG.length]}],user:'成员甲'}
               : {side:'out',ts:now-(150-i)*60000,text:'群消息 '+i,parts:[{k:'text',v:'群消息 '+i}]});
  }
  if (window.idbSet) { try { await window.idbSet('xy-home-v2:group-chat-msgs', out); } catch (e) { return 'ERR ' + e.message; } }
  return 'seeded ' + out.length;
})()`);
await sleep(1000);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1200);

// ---- B1~B3 点群聊图标：进度条出现 + 收起 + 记录渲染 ----
const r1 = await evalJs(`(async function(){
  var t0 = performance.now();
  var b = document.querySelector('.app[data-app="group-chat"]'); if (b) b.click();
  var firstShow = -1, lastShown = -1, endMsgs = 0, tEnd = 0;
  for (var i = 0; i < 70; i++) {
    var el = document.getElementById('gc-loading');
    var shown = !!(el && !el.hidden);
    if (shown && firstShow < 0) firstShow = Math.round(performance.now() - t0);
    if (shown) lastShown = Math.round(performance.now() - t0);
    endMsgs = document.querySelectorAll('#gc-body .msg').length;
    tEnd = Math.round(performance.now() - t0);
    if (i > 8 && endMsgs >= 150 && !shown) break;
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  return JSON.stringify({ firstShow: firstShow, lastShown: lastShown, msgs: endMsgs, t: tEnd });
})()`);
const j1 = r1 ? JSON.parse(r1) : {};
chk('B1 点群聊图标：进度条 400ms 内出现（修前连元素都没有＝主诉）', j1.firstShow >= 0 && j1.firstShow <= 400, r1);
chk('B2 进度条最终收起（不挂死；权威渲染完成后不再显示）', j1.msgs >= 150 && j1.lastShown >= 0 && j1.lastShown < j1.t, r1);
chk('B3 功能不回归：权威 150 条群记录渲染出来', j1.msgs >= 150, 'msgs=' + j1.msgs);

// ---- B4 空库群（切到无数据的自定义群语义：直接清库重进默认群）——进度条也收起不挂死 ----
await evalJs("(function(){var b=document.getElementById('gc-back');if(b)b.click();return 1;})()");
await sleep(500);
const del = await evalJs(`(async function(){
  if (window.idbDelete) { try { await window.idbDelete('xy-home-v2:group-chat-msgs'); } catch (e) {} }
  try { localStorage.removeItem('xy-home-v2:group-chat-msgs'); } catch (e) {}
  return 1; })()`);
await sleep(400);
const r2 = await evalJs(`(async function(){
  var t0 = performance.now();
  var b = document.querySelector('.app[data-app="group-chat"]'); if (b) b.click();
  var firstShow = -1, endHidden = false;
  for (var i = 0; i < 40; i++) {
    var el = document.getElementById('gc-loading');
    var shown = !!(el && !el.hidden);
    if (shown && firstShow < 0) firstShow = Math.round(performance.now() - t0);
    if (firstShow >= 0 && !shown) { endHidden = true; break; }
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  return JSON.stringify({ firstShow: firstShow, endHidden: endHidden });
})()`);
const j2 = r2 ? JSON.parse(r2) : {};
chk('B4 空库进群：进度条出现后也会收起（#710 无权威数据路径，不无限转）', j2.firstShow >= 0 && j2.endHidden, r2);

// ---- Z 零异常 ----
const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
chk('Z1 全程零 JS 异常', errs === '[]', String(errs));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
cleanup(fail ? 1 : 0);

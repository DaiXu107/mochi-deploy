// ===== v3.26.x 验证脚本：#522 聊天「长按消息→【编辑】无法编辑」（vivo X200s Edge 等多机型同报） =====
// 用法：node tools/verify-edit-modal-touch.mjs   （默认服务仓库根；可 SERVE_DIR=<产物目录>）
// 根因：#480 touch 直驱在 msgActions 的 touchend 里同步执行 maRunAction → openModal 打开【编辑消息】弹窗；
//       健康内核随后补发这次轻点的合成 click，click 按「弹窗已打开」的新布局命中 #modal-mask
//       （z-index 90 > #msg-actions 80）→ 触发遮罩 click→close，弹窗瞬间关闭＝编辑无反应。
//       几何相关：弹窗居中，动作按钮落在弹窗外侧时必现、落在弹窗框内时偶发，故「不同机型都报」。
// 修复：①chat.js msgActions touchend 取消默认行为（引擎层抑制本次合成 click，吞 click 族内核本就不发 click）；
//       ②personalize.js 遮罩 click 忽略「打开弹窗那次触摸 350ms 内补发的 click」（弹层通用兜底，任何直驱开弹窗都受保护）。
// 断言：S* 静态锚（src 直查）；R* 运行时（无头 Chrome 走真实产物 + CDP 真实触摸序列，会触发内核合成 click）：
//   R1 长按气泡→点【编辑】→ 弹窗保持打开、标题=编辑消息、输入框=原消息（修复前：弹窗被遮罩 click 立刻关掉）
//   R2 打开 350ms 后真实点遮罩 → 弹窗正常关闭（守卫不阻断用户主动关闭）
//   R3 全程零未捕获异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const serveDir = normalize(process.env.SERVE_DIR || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push(!!ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && detail !== '' ? '  [' + String(detail).slice(0, 240) + ']' : ''));
}

// ---- S 组：静态锚（src 直查） ----
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const persSrc = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');
check('S1 聊天消息菜单 touchend 取消默认行为（抑制补发 click）',
  /msgActions\.addEventListener\('touchend',[\s\S]{0,900}e\.preventDefault\(\);[\s\S]{0,80}maClickGuard = Date\.now\(\) \+ 600;[\s\S]{0,80}maRunAction\(btn\);/.test(chatSrc));
check('S2 弹窗遮罩忽略打开弹窗那次触摸补发的 click（350ms 守卫）',
  /if \(Date\.now\(\) - _openedAt < 350\) return;[\s\S]{0,40}close\(\);/.test(persSrc));
check('S3 openModal 打开时记录 _openedAt', /_openSeq\+\+;[\s\S]{0,60}_openedAt = Date\.now\(\);/.test(persSrc));

// ---- R 组：运行时 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(serveDir, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(serveDir)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9550 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-emt-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

let ws = null, msgId = 0;
const pend = new Map();
async function connect() {
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
        return;
      }
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('CDP 连接失败');
}
async function cdp(method, params) {
  return new Promise((resolve) => { const id = ++msgId; pend.set(id, resolve); ws.send(JSON.stringify({ id, method, params: params || {} })); });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'EVAL-ERR ' + JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300);
  return r && r.result ? r.result.value : null;
}
async function touchStart(x, y, id) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: Date.now() / 1000, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id }] });
}
async function touchEnd() {
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: Date.now() / 1000 + 0.05, touchPoints: [] });
}

await connect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 用户现场机型：vivo X200s（V2458A）/ Edge Android（Chromium 152）
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36 EdgA/152.0.0.0' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 3.5, mobile: true });

await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
  window.__v = { errs: [], ghostClicks: [] };
  window.addEventListener('error', function (e) { window.__v.errs.push(String(e.message || e)); });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'modal-mask') window.__v.ghostClicks.push(Date.now());
  }, true);
  return true;
})()` });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

// 关开屏
let closed = false;
for (let i = 0; i < 40 && !closed; i++) {
  const s = await evalJs(`(function(){
    var mm=document.getElementById('splash-mandatory');
    if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men&&!men.classList.contains('is-disabled')){men.click();return 'm';}return 'mw';}
    var sp=document.getElementById('splash'); if(!sp||sp.classList.contains('hide'))return 'closed';
    var sb=document.getElementById('splash-box'); if(sb)sb.scrollTop=sb.scrollHeight;
    var se=document.getElementById('splash-enter'); if(se&&!se.disabled){se.click();return 'c';} return 'w';
  })()`);
  closed = s === 'closed';
  if (!closed) await sleep(300);
}
if (!closed) { await evalJs(`(function(){var mm=document.getElementById('splash-mandatory');if(mm)mm.hidden=true;var sp=document.getElementById('splash');if(sp){sp.classList.add('hide');sp.hidden=true;}return true;})()`); await sleep(500); }
await sleep(800);

// 包装 openModal 记录调用
await evalJs(`(function(){ var _o = window.openModal; window.__v.opens = []; window.openModal = function(t,v,fn,opts){ try{ window.__v.opens.push(t); }catch(e){} return _o.apply(this, arguments); }; return typeof window.openModal; })()`);

await evalJs('window.enterChat(); true');
await sleep(1200);
await evalJs("window.chatSendMsg('这条是我发出去可以编辑的消息'); true");
await sleep(1000);

async function outBubble() {
  return evalJs(`(function(){
    var br=document.getElementById('backup-remind-bar'); if(br) br.hidden=true;
    var list = document.querySelectorAll('.msg-out .msg-bubble');
    var b = list[list.length - 1]; if (!b) return null;
    var r = b.getBoundingClientRect();
    var it = b.closest('.msg');
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: (b.textContent||'').slice(0,40), idx: it.dataset.idx };
  })()`);
}
let bub = null;
for (let i = 0; i < 10; i++) { const r = await outBubble(); if (r && r.x) { bub = r; break; } await sleep(200); }
check('R0 前置：聊天内定位到我发出的可编辑消息', !!bub, JSON.stringify(bub));

// 长按气泡弹菜单（重试直到菜单打开且【编辑】按钮可点中；位置受渲染时序影响，重试保证可复现）
async function pressBubble() {
  await touchStart(bub.x, bub.y, 2); await sleep(650); await touchEnd(); await sleep(350);
}
let editPt = null;
for (let attempt = 0; bub && attempt < 8 && !editPt; attempt++) {
  await evalJs("(function(){var m=document.getElementById('msg-actions');if(m)m.hidden=true;return true;})()");
  await sleep(150);
  await pressBubble();
  const info = await evalJs(`(function(){
    var m = document.getElementById('msg-actions');
    if (!m || m.hidden) return { open:false };
    var eb = m.querySelector('.ma-btn[data-act=edit]');
    if (!eb || eb.hidden) return { open:false };
    var r = eb.getBoundingClientRect();
    var x = Math.round(r.left + r.width/2), y = Math.round(r.top + r.height/2);
    var pt = document.elementFromPoint(x, y);
    return { open:true, x:x, y:y, hit: !!(pt && (eb === pt || eb.contains(pt))) };
  })()`);
  if (info.open && info.hit) editPt = info;
}
check('R1a 长按气泡→动作菜单打开且【编辑】按钮可点中', !!editPt, JSON.stringify(editPt));

if (editPt) {
  await evalJs('window.__v.opens.length = 0; window.__v.ghostClicks.length = 0; true');
  await touchStart(editPt.x, editPt.y, 3); await sleep(40); await touchEnd();
  await sleep(150);
  const at150 = await evalJs(`(function(){var m=document.getElementById('modal-mask');return {hidden:m?m.hidden:null,val:(document.getElementById('modal-input')||{}).value,title:(document.getElementById('modal-title')||{}).textContent,opens:window.__v.opens.slice(),ghosts:window.__v.ghostClicks.length};})()`);
  await sleep(550);
  const at700 = await evalJs(`(function(){var m=document.getElementById('modal-mask');return {hidden:m?m.hidden:null,val:(document.getElementById('modal-input')||{}).value,title:(document.getElementById('modal-title')||{}).textContent,opens:window.__v.opens.slice()};})()`);
  check('R1b 点【编辑】→ openModal 以「编辑消息」打开', Array.isArray(at700.opens) && at700.opens.indexOf('编辑消息') >= 0, JSON.stringify(at150));
  check('R1c 弹窗 150ms 后仍打开（修复前：被遮罩补发 click 立刻关掉）', at150.hidden === false, JSON.stringify(at150));
  check('R1d 弹窗 700ms 后仍打开且标题/原文正确', at700.hidden === false && at700.title === '编辑消息' && at700.val === bub.text, JSON.stringify(at700));
  check('R1e 合成 click 已在引擎层被抑制（无落到遮罩的补发 click）', at150.ghosts === 0, 'ghostClicks=' + at150.ghosts);

  // R2：守卫窗口过后，真实点遮罩仍能关闭弹窗
  await sleep(450);
  const maskPt = await evalJs(`(function(){
    var pt = document.elementFromPoint(12, 400);
    return { isMask: pt && pt.id === 'modal-mask', at: pt ? (pt.tagName + '.' + String(pt.className).slice(0,30)) : null };
  })()`);
  if (maskPt && maskPt.isMask) {
    await touchStart(12, 400, 4); await sleep(40); await touchEnd(); await sleep(400);
    const afterMask = await evalJs(`(function(){var m=document.getElementById('modal-mask');return m?m.hidden:null;})()`);
    check('R2 打开 350ms 后点遮罩 → 弹窗正常关闭（守卫不阻断主动关闭）', afterMask === true, 'hidden=' + afterMask);
  } else {
    check('R2 打开 350ms 后点遮罩 → 弹窗正常关闭（守卫不阻断主动关闭）', false, '遮罩定位失败 ' + JSON.stringify(maskPt));
  }
}

const errs = await evalJs('window.__v.errs');
check('R3 全程零未捕获异常', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

const pass = results.filter(Boolean).length;
console.log('\n== ' + pass + '/' + results.length + ' 通过 ==');
server.close();
try { chrome.kill(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

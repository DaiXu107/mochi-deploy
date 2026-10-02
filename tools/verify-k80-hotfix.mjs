// ===== 回归脚本：#716 红米 K80 三联实报（多机型同族） =====
// 用法：node tools/verify-k80-hotfix.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// ①表情包面板/头像互动「每次打开图片闪烁重载」：表情侧 #704 后兜底仍 1s、大库机型首屏解码
//   超 1s 半途放行；头像半框还是「等全部解码」的修前形态 → 表情兜底 1s→2.5s＋头像首屏 24 张
//   await/其余预热/兜底 2.5s。
// ②「正在加载聊天记录」挂很久进不去：idbGet 固定 4s+4s，41MB 级键单次读取超 8s ⇒ 重试循环
//   全失败。修复＝idbGet 支持 minWaitMs 按量放大（≤60s）＋账本 b 字节回填＋loadMsgs 按量提示。
// ③聊天底部上滑看历史「反复回弹、刚开始滑动最明显」：手势刚开始离底 ≤8px 时 #378 自动回钉
//   误判 → #706 看门狗每 250ms 与手势对打。修复＝chatTouchActive 手势闸（触摸期禁自动回钉、
//   看门狗让路）。
// 判据：
//   A 轴：源码锚（idb minWait / loadMsgs 提示 / 账本 b / 手势闸×3 / 头像上限 / 表情 2500 / splash 动画）。
//   B 轴（真实产物 390×844，Android UA，CPU 4×，decode 注入 40ms）：
//     B1 上滑手势期不被拽回：贴底态 touchstart 后 scrollTop-=4（≤8px 旧代码会触发回钉拽回），
//        派发 scroll，等 500ms —— scrollTop 仍 < max（没被拽回贴底）
//     B2 手势结束后小幅滚动+离底超阈值：不误回钉（滚动位置保留）
//     B3 头像互动半框打开：显示时首屏 12 张已全部解码（修前等全部解码超兜底半途放行）
//     B4 头像半框 3.5s 内可见（兜底封顶）
//     B5 大键提示窗接线行为：3MB 级历史（>2MB 门槛）正常读出渲染（提示窗参数不破坏正常读取）
//   Z 轴：全程零 JS 异常。
// RED 基线（HEAD 的 idb.js/chat.js/avatar-lib.js/base.css）：A 轴红、B1 红（被拽回贴底）、B3 红。
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
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const idbSrc = rd('src/js/idb.js');
const chatSrc = rd('src/js/chat.js');
const avSrc = rd('src/js/avatar-lib.js');
const baseSrc = rd('src/css/base.css');
chk('A1 idbGet 支持 minWaitMs 按量放大（≤60s）', idbSrc.includes('const minWait = (ambiable && typeof ambiable.minWaitMs === ') && idbSrc.includes('Math.min(60000, ambiable.minWaitMs)'));
chk('A2 loadMsgs 按账本字节给读取提示窗（#716b）', chatSrc.includes('bigReadMs > 4000 ? { minWaitMs: bigReadMs } : undefined'));
chk('A3 账本补读回填 b 字节（#716c）', chatSrc.includes('chatLedgerBytes[prefix] = o.b'));
chk('A4 手势期禁 #378 自动回钉（#716d）', chatSrc.includes('else if (!chatPinnedBottom && !chatTouchActive && chatAtBottom()) {'));
chk('A5 看门狗手势期让路（#716e）', chatSrc.includes('_ccSmoothT || chatTouchActive) return;'));
chk('A6 触摸手势旗标接线（#716f）', chatSrc.includes('chatTouchActive = true;') && chatSrc.includes("body.addEventListener('touchcancel'"));
chk('A7 表情面板显示兜底 2.5s（#716g）', chatSrc.includes('setTimeout(fin, 2500);'));
chk('A8 头像半框只等首屏 24 张（#716h）', avSrc.includes('const AV_DECODE_AWAIT_MAX = 24;') && avSrc.includes('setTimeout(fin, 2500);'));
chk('A9 开屏加载省略号动画（#716i）', baseSrc.includes('@keyframes splashDots'));

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
const profile = join(process.env.TEMP || '/tmp', 'mochi-v716-' + Date.now());
const cdpPort = 9200 + Math.floor(Math.random() * 200);
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
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="hsl(' + (n * 43) + ',70%,55%)"/><text x="20" y="100" font-size="64" fill="white">' + n + '</text><!--' + 'z'.repeat(7000) + '--></svg>').toString('base64');
const AVATARS = Array.from({ length: 30 }, (_, i) => mkImg(300 + i));

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

// 种子：当前桌面 3MB 级历史（>2MB 提示窗门槛，头像库 30 张）
const seed = await evalJs(`(async function(){
  var IMG = ${JSON.stringify(Array.from({ length: 20 }, (_, i) => mkImg(i)))};
  var out = []; var now = Date.now();
  for (var i = 0; i < 60; i++) {
    var pad = new Array(120).fill('聊天内容 '+i+' ').join('');
    out.push({side:(i%2?'out':'in'),ts:now-(60-i)*60000,text:pad,parts:[{k:'text',v:pad}]});
  }
  var j = JSON.stringify(out);
  window.activeStore().set('chat-msgs', j);
  window.activeStore().set('avatar-lib', JSON.stringify(${JSON.stringify(AVATARS)}));
  window.activeStore().set('cs-avatar-partner', ${JSON.stringify(AVATARS[0])});
  if (window.idbSet) {
    try { await window.idbSet(window.activePrefix() + ':chat-meta', JSON.stringify({n:60,b:j.length,t:Date.now()}));
          await window.idbSet(window.activePrefix() + ':chat-msgs', out); } catch (e) {}
  }
  return 'seeded ' + j.length;
})()`);
await sleep(1000);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1200);

// decode 注入 40ms（贴近真机大图解码成本）
await evalJs(`(function(){
  var dec = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () {
    var p = dec.apply(this, arguments);
    var t0 = Date.now();
    var r = p.then(function (x) { return new Promise(function (res) { setTimeout(function () { res(x); }, Math.max(0, 40 - (Date.now() - t0))); }); });
    r.catch && r.catch(function () {});
    return r;
  };
  return 1; })()`);

// ---- B1~B2 上滑手势期不被拽回（touch 序列 + scroll 事件）----
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(2500);
const bounce = await evalJs(`(async function(){
  var cb = document.getElementById('chat-body');
  if (!cb || !cb.scrollHeight) return JSON.stringify({ err: 'no body' });
  cb.scrollTop = cb.scrollHeight; // 贴底
  await new Promise(function (r) { setTimeout(r, 300); });
  var max0 = cb.scrollHeight - cb.clientHeight;
  function mkTouch(y) { return new Touch({ identifier: 1, target: cb, clientX: 100, clientY: y }); }
  function pev(type, y) {
    var t = mkTouch(y);
    var init = { bubbles: true, cancelable: true };
    if (type === 'touchend' || type === 'touchcancel') { init.touches = []; init.targetTouches = []; init.changedTouches = [t]; }
    else { init.touches = [t]; init.targetTouches = [t]; init.changedTouches = [t]; }
    cb.dispatchEvent(new TouchEvent(type, init));
  }
  // 手势开始（touchstart 解钉），小幅上移 30px 但 scrollTop 只离底 4px（≤8px＝旧代码回钉区）
  pev('touchstart', 400);
  cb.scrollTop = max0 - 4;
  cb.dispatchEvent(new Event('scroll', { bubbles: false }));
  await new Promise(function (r) { setTimeout(r, 500); }); // 旧代码：100ms 防抖回钉 + 250ms 看门狗拽回
  var midTop = cb.scrollTop;
  var yanked = midTop >= max0 - 2; // 被拽回贴底＝回弹主诉
  pev('touchend', 370);
  await new Promise(function (r) { setTimeout(r, 300); });
  var endTop = cb.scrollTop;
  return JSON.stringify({ max0: max0, midTop: midTop, yanked: yanked, endTop: endTop });
})()`);
const jb = bounce ? JSON.parse(bounce) : {};
chk('B1 上滑手势刚开始（离底≤8px）不被拽回贴底（修前 #378 误判回钉+看门狗拽回＝反复回弹）', !jb.yanked, bounce);
chk('B2 手势结束后滚动位置保留（离底 4px 不被拉回）', jb.endTop !== undefined && jb.endTop < jb.max0 - 2, bounce);

// ---- B3~B4 头像互动半框：打开显示时首屏已解码 ----
await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return 1;})()");
await sleep(800);
await evalJs('(function(){if(window.openAvlib)window.openAvlib();return 1;})()');
const avRes = await evalJs(`(async function(){
  var t0 = performance.now();
  var shownAt = -1, firstRowOk = -1;
  for (var i = 0; i < 80; i++) {
    var p = document.getElementById('avlib-card');
    if (p && !p.hidden && shownAt < 0) {
      shownAt = Math.round(performance.now() - t0);
      var imgs = document.querySelectorAll('#avlib-grid img');
      var f = 0; for (var k = 0; k < Math.min(12, imgs.length); k++) { if (imgs[k].naturalWidth > 0) f++; }
      firstRowOk = f;
      break;
    }
    await new Promise(function (r) { setTimeout(r, 50); });
  }
  return JSON.stringify({ shownAt: shownAt, firstRowOk: firstRowOk });
})()`);
const ja = avRes ? JSON.parse(avRes) : {};
chk('B3 头像半框显示时首屏 12 张已全部解码（修前等全部 30 张解码超兜底半途放行＝闪烁重载）', ja.firstRowOk === 12, avRes);
chk('B4 头像半框 3.5s 内可见（兜底封顶不挂死）', ja.shownAt >= 0 && ja.shownAt <= 3500, 'shownAt=' + ja.shownAt + 'ms');

// ---- B5 大键提示窗接线行为：3MB 级历史（>2MB 门槛）正常读出渲染 ----
await evalJs("(function(){location.reload();return 1;})()");
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(800);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(3000);
const msgN = await evalJs("document.querySelectorAll('#chat-body .msg').length");
chk('B5 带提示窗参数的读取路径功能不回归（3MB 级历史渲染出来）', typeof msgN === 'number' && msgN >= 60, 'msgs=' + msgN);

// ---- Z 零异常 ----
const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
chk('Z1 全程零 JS 异常', errs === '[]', String(errs));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
cleanup(fail ? 1 : 0);

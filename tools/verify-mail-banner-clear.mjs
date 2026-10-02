// ===== 回归脚本：#795 信箱回信后回聊天页「屏幕闪一下」（桌面横幅盖顶栏后自动消失） =====
// 用法：node tools/verify-mail-banner-clear.mjs（MOCHI_ROOT 可指到仓外隔离副本的构建产物根）
// 用户实报（2026-09-19，红米 K80 Chrome，明说其他机型也有）：聊天页点「写了一封信」系统消息
// 进信箱→回信→关闭信箱回聊天，屏幕闪一下。
// 根因：回信落「你给 X 回了一封信」进聊天时聊天页正隐藏（用户在信箱）→ addRec 走 showDeskMsg
// 弹桌面横幅（#desk-msg 是 body 级固定层，6s 自动消失）。用户随后关信箱回聊天——桌面图标
// （enterChat）与返回键直显（tabs.js popstate）两条路都不经过任何横幅清理，横幅正好盖在聊天页
// 顶栏上，几秒后自动消失＝「闪一下」。修复＝桌面页（page-phone）一隐藏就收走横幅（hideDeskMsg）。
// 验证：
//   B1 现状锚：桌面可见时弹横幅→横幅可见（showDeskPopup 主链路仍工作）。
//   B2 修复面·enterChat 路径：信箱页弹横幅→enterChat→横幅必须收走。
//   B3 修复面·返回键直显路径：信箱页弹横幅→PAGES 直显 page-chat（popstate 等价）→横幅必须收走。
//   B4 桌面行为不变：桌面可见时同值写 hidden（Blink 发 mutation，#338）→横幅不误收。
//   B5 其他页面覆盖：桌面弹横幅→openMailPage（page-phone 隐藏）→横幅必须收走。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize((process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..'));
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
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9890 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mail-banner-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
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
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 240)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const KEY = 'xy-home-v2:default:chat-msgs';
const TAIL = 'xy-home-v2:default:chat-tail';
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
// 横幅可见性（el.hidden 直读）
const BANNER = `(function(){ var el = document.getElementById('desk-msg'); return el && !el.hidden ? 1 : 0; })()`;
async function showBanner() {
  return evalJs(`(function(){
    if (!window.showDeskPopup) return 'no-api';
    window.showDeskPopup({ name: 'TA', text: '横幅回归测试' });
    var el = document.getElementById('desk-msg');
    return el && !el.hidden ? 1 : 0;
  })()`);
}

// ---- 开屏（先写种子再走完整加载） ----
{
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1800);
  await evalJs(`(async function(){
    try {
      var recs = [];
      for (var i = 0; i < 20; i++) recs.push({ side: i % 2 ? 'in' : 'out', text: '历史#' + i, ts: ${Date.now() - 1200000} + i * 30000 });
      var s = JSON.stringify(recs);
      localStorage.setItem('${KEY}', s);
      await window.idbSet('${KEY}', s);
      localStorage.removeItem('${TAIL}');
      if (window.idbDelete) await window.idbDelete('${TAIL}');
      return true;
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs(`(function(){
    try {
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
        var me = document.getElementById('splash-mandatory-enter'); if (me && !me.hidden) me.click();
        mm.hidden = true;
      }
      var sp = document.getElementById('splash');
      if (sp) { sp.classList.add('hide'); sp.hidden = true; }
      var mask = document.getElementById('modal-mask');
      if (mask && !mask.hidden) mask.hidden = true;
    } catch (e) {}
    return 1;
  })()`);
  await sleep(500);
}

// ---- B1 现状锚：桌面可见时横幅主链路仍工作 ----
{
  await evalJs("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
  await sleep(400);
  await evalJs("(function(){ var b=document.getElementById('chat-back'); if(b) b.click(); return 1; })()");
  await sleep(400);
  const on = await showBanner();
  check('B1 桌面可见时弹横幅＝横幅可见（主链路不回归）', on === 1, 'banner=' + on);
}

// ---- B2 修复面：报障流程·信箱页弹横幅被 show 闸拦截 → enterChat 回聊天全程无横幅 ----
{
  await evalJs("(function(){ window.openMailPage(); return 1; })()");
  await sleep(300);
  const on = await showBanner();
  await evalJs("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
  await sleep(350);
  const after = await evalJs(BANNER);
  check('B2 信箱页弹横幅被拦截→enterChat 回聊天全程无横幅（桌面图标路径·报障流程）', on === 0 && after === 0, 'before=' + on + ' after=' + after);
}

// ---- B3 修复面：报障流程·返回键直显 page-chat（popstate 等价）全程无横幅 ----
{
  await evalJs("(function(){ window.openMailPage(); return 1; })()");
  await sleep(300);
  const on = await showBanner();
  await evalJs(`(function(){
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = p.id !== 'page-chat'; });
    return 1;
  })()`);
  await sleep(350);
  const after = await evalJs(BANNER);
  check('B3 信箱页弹横幅被拦截→返回键直显聊天全程无横幅（返回手势路径·报障流程）', on === 0 && after === 0, 'before=' + on + ' after=' + after);
}

// ---- B3b hide-on-leave：桌面弹横幅→返回键直显聊天＝横幅收走 ----
{
  await evalJs("(function(){ var b=document.getElementById('chat-back'); if(b) b.click(); return 1; })()");
  await sleep(300);
  const on = await showBanner();
  await evalJs(`(function(){
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = p.id !== 'page-chat'; });
    return 1;
  })()`);
  await sleep(350);
  const after = await evalJs(BANNER);
  check('B3b 桌面已弹横幅→返回键直显聊天＝横幅收走（hide-on-leave·返回手势路径）', on === 1 && after === 0, 'before=' + on + ' after=' + after);
}

// ---- B3c hide-on-leave：桌面弹横幅→enterChat＝横幅收走 ----
{
  await evalJs("(function(){ var b=document.getElementById('chat-back'); if(b) b.click(); return 1; })()");
  await sleep(300);
  const on = await showBanner();
  await evalJs("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
  await sleep(350);
  const after = await evalJs(BANNER);
  check('B3c 桌面已弹横幅→enterChat 回聊天＝横幅收走（hide-on-leave·桌面图标路径）', on === 1 && after === 0, 'before=' + on + ' after=' + after);
}

// ---- B4 桌面行为不变：桌面可见时同值写 hidden 不误收横幅 ----
{
  await evalJs("(function(){ var b=document.getElementById('chat-back'); if(b) b.click(); return 1; })()");
  await sleep(300);
  const on = await showBanner();
  await evalJs(`(function(){
    var pp = document.getElementById('page-phone');
    pp.hidden = false; // 同值写也发 mutation（#338 实测）——守卫必须挡住「桌面可见」态
    return 1;
  })()`);
  await sleep(350);
  const after = await evalJs(BANNER);
  check('B4 桌面可见态的 hidden 同值写不误收横幅（桌面行为零变化）', on === 1 && after === 1, 'before=' + on + ' after=' + after);
}

// ---- B5 其他页面覆盖：桌面弹横幅 → openMailPage（page-phone 隐藏）→ 横幅必须收走 ----
{
  const on = await showBanner();
  await evalJs("(function(){ window.openMailPage(); return 1; })()");
  await sleep(350);
  const after = await evalJs(BANNER);
  check('B5 桌面弹横幅→进信箱＝横幅收走（横幅不浮在任何非桌面页之上）', on === 1 && after === 0, 'before=' + on + ' after=' + after);
}

// ---- S1 静态锚：修复逻辑在产物（内联 core 或外置 js/chat.js）中在位且唯一 ----
{
  const NEEDLE = 'if (pp.hidden && deskMsgEl && !deskMsgEl.hidden) window.hideDeskMsg();';
  let hits = -1, where = '';
  try {
    const { readFileSync: rf } = await import('node:fs');
    const ext = rf(join(root, 'js', 'chat.js'), 'utf8');
    hits = ext.split(NEEDLE).length - 1;
    where = 'js/chat.js';
  } catch (e) { /* 无外置文件，走内联 */ }
  if (hits < 0) {
    const cnt = await evalJs(`(function(){
      var n = 0, scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].textContent || '';
        if (t.indexOf('${'if (pp.hidden && deskMsgEl && !deskMsgEl.hidden) window.hideDeskMsg();'}') >= 0) n++;
      }
      return n;
    })()`);
    hits = Number(cnt) || 0;
    where = 'index.html 内联';
  }
  check('S1 修复逻辑锚在产物（' + where + '）在位且唯一', hits === 1, 'hit=' + hits);
}

chrome.kill();
server.close();
const fail = results.filter((r) => !r.ok).length;
console.log(fail ? 'RESULT: ' + (results.length - fail) + '/' + results.length + '（红）' : 'RESULT: ' + results.length + '/' + results.length + '（绿）');
process.exit(fail ? 1 : 0);

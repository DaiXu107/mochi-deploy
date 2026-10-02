// ===== 回归脚本：聊天设置「时间轴样式-时间分隔线」（微信式居中时间胶囊） =====
// 用法：node build.mjs && node tools/verify-time-divider.mjs
// 验证（无头 Chrome，390×844 手机视口）：
//   1. 注入 6 条间隔不同的消息（3天前/1分钟/2小时/30分钟/1分钟/10分钟）→ divider 模式下
//      进聊天页：间隔 ≥5 分钟处插分隔条（4 条：首条必插 + 2h/1.7h/19min 三处），
//      #chat-body 的 .msg-time 全部隐藏，首条分隔条文案为「8月18日」式日期。
//   2. 增量追加：新消息与上一条间隔 10 分钟 → 自动补插第 5 条分隔条（贴底不炸）。
//   3. 默认（under-av）模式下无分隔条；切到 divider 后 chatReRenderTime 即时重渲染补插。
//   4. 从 divider 切回 under-av：已插入的分隔条被 CSS 隐藏（display:none，不占布局）。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-div-' + Date.now()),
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
}
const settle = async () => { await sleep(150); await evalJs('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});'); await sleep(350); };
async function enterChat() {
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
  await settle();
}
// 消息列表快照：分隔条数量 / msg-time 数量与隐藏数 / 首条分隔条文案
const snap = () => evalJs(`(function(){
  var cb = document.getElementById('chat-body');
  if (!cb) return JSON.stringify({ err: 'no chat-body' });
  var ds = cb.querySelectorAll('.msg-time-divider');
  var times = cb.querySelectorAll('.msg-time');
  var hidden = 0;
  times.forEach(function(t){ if (getComputedStyle(t).display === 'none') hidden++; });
  var first = ds.length ? ds[0].textContent.trim() : '';
  return JSON.stringify({ dividers: ds.length, times: times.length, hiddenTimes: hidden, first: first, child: cb.children.length });
})()`);
// 注入 6 条间隔不同的消息 + 样式
const injectMsgs = (style) => evalJs(`(async function(){
  var now = Date.now(), D = 86400000, H = 3600000, M = 60000;
  var msgs = [
    { side:'in',  text:'三天前的消息', ts: now - 3*D },
    { side:'out', text:'一分钟后的回复', ts: now - 3*D + M },
    { side:'in',  text:'两小时前的消息', ts: now - 2*H },
    { side:'out', text:'半小时前的消息', ts: now - 30*M },
    { side:'in',  text:'29分钟前的消息', ts: now - 29*M },
    { side:'out', text:'十分钟前的消息', ts: now - 10*M }
  ];
  var pre = window.activePrefix();
  var store = window.activeStore();
  store.set('chat-msgs', JSON.stringify(msgs));
  if (window.idbSet) await window.idbSet(pre + ':chat-msgs', JSON.stringify(msgs));
  store.set('cs-time-style', '${style}');
  return true;
})()`);

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 1. divider 模式：进聊天页，间隔 ≥5 分钟处插入分隔条，msg-time 全部隐藏 ----
await gotoApp();
await injectMsgs('divider');
await gotoApp();
await enterChat();
let s = JSON.parse(await snap() || '{}');
check('divider 模式插入 4 条分隔条（首条必插 + 2h/1.7h/19min 三处）', s.dividers === 4, 'dividers=' + s.dividers);
check('聊天页全部 msg-time 隐藏', s.hiddenTimes === s.times && s.times === 6, 'hidden=' + s.hiddenTimes + '/' + s.times);
check('首条分隔条为日期文案（3天前 → 「8月18日」式）', /月\d+日/.test(s.first), 'text=' + s.first);

// ---- 2. 增量追加：新消息与上一条间隔 10 分钟 → 自动补插第 5 条分隔条 ----
await evalJs("window.chatSendMsg('现在发的消息（与上一条间隔十分钟）');");
await settle();
s = JSON.parse(await snap() || '{}');
check('增量追加补插分隔条（4→5）', s.dividers === 5, 'dividers=' + s.dividers);

// ---- 3. under-av 模式：无分隔条，msg-time 恢复显示 ----
await evalJs("window.activeStore().set('cs-time-style','under-av'); if(window.applyChatSettings)window.applyChatSettings();");
await settle();
s = JSON.parse(await snap() || '{}');
check('切回头像下方：分隔条 DOM 仍在（等待 CSS 隐藏断言）', s.dividers === 5, 'dividers(DOM)=' + s.dividers);
const disp = await evalJs(`(function(){
  var d = document.querySelector('#chat-body .msg-time-divider');
  var t = document.querySelector('#chat-body .msg-time');
  return JSON.stringify({ d: d ? getComputedStyle(d).display : 'none-el', t: t ? getComputedStyle(t).display : 'none-el' });
})()`);
let dd = JSON.parse(disp || '{}');
check('under-av：分隔条 display:none，msg-time 恢复显示', dd.d === 'none' && dd.t !== 'none', 'd=' + dd.d + ' t=' + dd.t);

// ---- 4. 默认 under-av 进入聊天 → 切到 divider 即时重渲染补插（弹窗回调路径） ----
await gotoApp();
await injectMsgs('under-av');
await gotoApp();
await enterChat();
s = JSON.parse(await snap() || '{}');
check('under-av 模式无分隔条', s.dividers === 0 && s.hiddenTimes === 0, 'dividers=' + s.dividers);
await evalJs("window.activeStore().set('cs-time-style','divider'); if(window.applyChatSettings)window.applyChatSettings(); if(window.chatReRenderTime)window.chatReRenderTime();");
await settle();
s = JSON.parse(await snap() || '{}');
check('切到 divider 即时重渲染补插 4 条分隔条', s.dividers === 4, 'dividers=' + s.dividers);

// ---- 5. 收藏页/群聊隔离：CSS 只隐藏 #chat-body 内的时间 ----
const iso = await evalJs(`(function(){
  var fav = document.querySelectorAll('#fav-list .msg-time').length;
  var gc = document.querySelectorAll('#gc-body .msg-time').length;
  var css = Array.prototype.slice.call(document.styleSheets).some(function(sh){
    try { return Array.prototype.slice.call(sh.cssRules || []).some(function(r){ return r.selectorText && r.selectorText.indexOf('#chat-body .msg-time') >= 0; }); }
    catch (e) { return false; }
  });
  return JSON.stringify({ fav: fav, gc: gc, cssChatOnly: css });
})()`);
let isoR = JSON.parse(iso || '{}');
check('分隔线隐藏规则仅作用于 #chat-body（收藏/群聊不受影响）', isoR.cssChatOnly === true, 'css=' + isoR.cssChatOnly);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

// ===== 回归脚本：发送聊天消息后未自动滚动到最新（用户反馈「有时候发送聊天消息，没有自动把位置到最底最新」） =====
// 用法：node build.mjs && node tools/verify-chat-scroll-bottom.mjs
// 复现路径（无头 Chrome，390×844 手机视口）：
//   1. 进入聊天页并发送若干条消息撑出滚动高度。
//   2. 用户轻微上翻（模拟翻旧消息/惯性滚动残留）→ scrollTop 停在距底 >120px。
//      （此前 maybeScrollChatBottom 的贴底守卫 chatNearBottom 阈值 120px 在此返回 false）
//   3. 再次发送消息（side:out）：
//      - 未修复：守卫直接 return，新消息停在视口外 → 没有自动滚到最新。
//      - 修复后：我发送的消息一律贴底 → scrollTop === scrollHeight - clientHeight。
//   4. 翻旧消息（把 scrollTop 拉回中部）时 TA 消息进来 → 不打断阅读位置（守卫仍生效）。
//   5. 表情包面板打开 → 贴底保持最新可见。
//   6. 带图消息（图片延迟 400ms 加载）→ 图片解码后 scrollHeight 变化，onload 补滚贴底。
//   7. 翻旧消息时带图消息图片加载完成 → 仍不打断（in 消息贴底守卫 + 时间窗过滤）。
//   前置：禁用自动回复（rs-min/max=9999s、rn-prob=0、as-en=0）——否则 scheduleReply 的
//   「正在输入」行在 1~40s 内随机占位/消失（hideTyping 滚底）会与断言产生时间竞态。
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
    // v3.9.x：延迟图片端点——模拟真机图片异步解码（400ms 后才返回），
    // 用于验证「图片加载完成后消息高度变化 → 自动补滚到底」的补偿逻辑
    // /slow2.png 是 #416 同款端点：图消息去重窗（img 型 60000ms）会吞掉同 URL 的
    // 第二条消息，翻历史场景需用唯一 URL 才能真实渲染出「图消息进来」的效果
    if (req.url.indexOf('/slow') === 0) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); }, 400);
      return;
    }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-scroll-' + Date.now()),
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

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 禁用自动回复（rs-min/max=9999s、已读不回=0、主动发送=0）——否则发送消息后
// scheduleReply 的「正在输入」行会在 1~40s 内随机占位/消失（hideTyping 滚底），
// 与"翻旧消息不打断/贴底"的断言产生时间竞态，导致用例不稳定
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 消息区滚动状态快照
// FIX 2026-09-15 #516：打字行与 #chat-body 是兄弟 flex 行——行可见时它压掉 chat-body 的
// clientHeight，于是 scrollHeight − clientHeight 是「行显示态最大值」，比真·贴底位置高整整一行。
// 产品现在的贴底目标（chatScrollMax）是**行隐藏态**的位置（＝最后一条消息离 chat-body 底边保留
// 产品自己的 padding-bottom 留白，且行显/隐全程零位移——否则行一隐藏就被内核钳回＝下弹一行高）。
// 故「是否贴底」一律拿 maxReal 判：行隐藏时 maxReal === max，行可见时 maxReal === max − 行高。
const snap = () => evalJs(`(function(){
  var cb = document.getElementById('chat-body');
  if (!cb) return JSON.stringify({ err: 'no chat-body' });
  var t = document.getElementById('chat-typing');
  var tv = !!(t && !t.hidden), rh = tv ? t.offsetHeight : 0;
  return JSON.stringify({
    top: cb.scrollTop,
    max: cb.scrollHeight - cb.clientHeight,
    maxReal: cb.scrollHeight - (cb.clientHeight + rh),
    typing: tv, rowH: rh,
    h: cb.scrollHeight, ch: cb.clientHeight,
    near: (cb.scrollHeight - cb.scrollTop - cb.clientHeight) < 120
  });
})()`);
// 等待滚动稳定（rAF 双帧 + 400ms 兜底滚动结束后再取快照）
const settle = async () => { await sleep(150); await evalJs('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});'); await sleep(350); };

// ---- 1. 进入聊天页，连发 40 条消息撑出足够滚动高度 ----
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await settle();
for (let i = 1; i <= 40; i++) {
  await evalJs(`window.chatSendMsg('消息第${i}条，这是一条用来撑高聊天区域滚动内容的测试消息，内容稍微长一点。');`);
}
await settle();
let s = JSON.parse(await snap() || '{}');
check('初始发送 40 条后自动贴底', s.max > 600 && Math.abs(s.top - s.maxReal) < 2, 'top=' + s.top + ' maxReal=' + s.maxReal + '（打字行=' + (s.typing ? '显示 ' + s.rowH + 'px' : '隐藏') + '）');

// ---- 2. 轻微上翻（距底 >120px），再发送消息 —— 必须仍自动滚到最新 ----
await evalJs("(function(){var cb=document.getElementById('chat-body');cb.scrollTop=Math.max(0,cb.scrollHeight-cb.clientHeight-260);return cb.scrollTop;})()");
await sleep(80);
s = JSON.parse(await snap() || '{}');
check('轻微上翻后距底 >120px（守卫应失效场景）', !s.near, '距底=' + Math.round(s.h - s.top - s.ch) + 'px');
await evalJs(`window.chatSendMsg('上翻后再发一条，应该自动滚回底部');`);
await settle();
s = JSON.parse(await snap() || '{}');
check('上翻后发送消息 → 自动滚动到最新', Math.abs(s.top - s.maxReal) < 2, 'top=' + s.top + ' maxReal=' + s.maxReal + '（打字行=' + (s.typing ? '显示 ' + s.rowH + 'px' : '隐藏') + '）');

// ---- 3. 大幅上翻（回看旧消息），TA 消息进来 —— 不打断阅读位置 ----
// FIX #416：真实用户上翻必然先触摸（touchstart 解钉挂锚定）再拖动；旧脚本直接
// 程序化 scrollTop=0 不派发触摸＝钉住态保持，TA 消息按「贴底钉住」正常跟底被误判
// 为打断。补触摸模拟后才符合「用户已接管滚动」的真实语义（#378 钉住标记契约）。
await evalJs(`(function(){
  var b = document.getElementById('chat-body');
  try {
    var t = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 700 });
    b.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  } catch (e) { b.dispatchEvent(new Event('touchstart', { bubbles: true })); }
  b.scrollTop = 0;
  return b.scrollTop;
})()`);
await sleep(80);
await evalJs("window.chatAddIn && window.chatAddIn('TA 的回复消息（此时在翻旧消息，不应被打断）');");
await settle();
s = JSON.parse(await snap() || '{}');
check('翻旧消息时 TA 消息进来不打断位置', Math.abs(s.top - s.max) >= 300, 'top=' + s.top + ' max=' + s.max);

// ---- 4. 表情包面板打开 → 贴底保持最新可见 ----
await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();var ep=document.getElementById('emoji-panel');if(ep)ep.hidden=false;return true;})()");
await sleep(120);
s = JSON.parse(await snap() || '{}');
check('表情包面板打开后贴底', Math.abs(s.top - s.maxReal) < 2, 'top=' + s.top + ' maxReal=' + s.maxReal + '（打字行=' + (s.typing ? '显示 ' + s.rowH + 'px' : '隐藏') + '）');
// 关闭表情包面板，避免遮挡后续断言
await evalJs("(function(){var ep=document.getElementById('emoji-panel');if(ep)ep.hidden=true;return true;})()");
await sleep(100);

// ---- 5. 贴底状态发送带图消息（图片延迟 400ms 加载）→ 加载完成后仍贴底 ----
// 同步滚动发生在图片撑开高度之前；若无 onload 补滚，图片解码后 scrollHeight 变大，
// 最新消息会被顶出视口（「有时候没滚到底」的图片场景）
await evalJs("window.chatAddIn('/slow.png', { img: '/slow.png' });");
await sleep(180); // 图片尚未返回，此刻应停在同步滚动的位置（可贴底/差一点）
s = JSON.parse(await snap() || '{}');
await sleep(600); // 等图片返回 + 解码 + onload 补滚
s = JSON.parse(await snap() || '{}');
check('带图消息图片延迟加载完成后自动贴底', Math.abs(s.top - s.maxReal) < 2, 'top=' + s.top + ' maxReal=' + s.maxReal + '（打字行=' + (s.typing ? '显示 ' + s.rowH + 'px' : '隐藏') + '）');

// ---- 6. 翻旧消息时带图消息进来 → 不打断阅读位置（守卫仍生效） ----
// 同 #3：先触摸模拟「用户已接管滚动」；图用 /slow2.png（唯一 URL）避免被 #256
// 图消息去重窗（60000ms）吞掉——旧脚本第二条 /slow.png 被静默去重不渲染＝假通过。
await evalJs(`(function(){
  var b = document.getElementById('chat-body');
  try {
    var t = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 700 });
    b.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  } catch (e) { b.dispatchEvent(new Event('touchstart', { bubbles: true })); }
  b.scrollTop = 0;
  return b.scrollTop;
})()`);
await sleep(80);
await evalJs("window.chatAddIn('/slow2.png', { img: '/slow2.png' });");
await sleep(600); // 等图片加载完成——即使图片触发 onload，in 消息贴底守卫也应拦住
s = JSON.parse(await snap() || '{}');
check('翻旧消息时带图消息图片加载后仍不打断', Math.abs(s.top - s.max) >= 300, 'top=' + s.top + ' max=' + s.max);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

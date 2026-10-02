// ===== 回归脚本：#642 聊天/群聊操作条跟随锚点 + #643 键盘收起后贴底回钉 =====
// 用法：node tools/verify-chat-actionbar-follow.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-chat-actionbar-follow.mjs   （测临时构建副本，红绿对照）
// 用户报障（2026-09-16，iPhone 17 Pro Edge 等多机型，要求勿致跨机型回归）：
//   ①「聊天里点击消息出现的【引用消息的按钮这一行的框框】会乱跑，飞到距离消息气泡很远的地方」
//     ＝操作条 position:fixed 只在打开瞬间定位一次；键盘开合动画 / Edge iOS vv 平移 /
//     来消息贴底滚动 / 图片撑高后，气泡被挪走而操作条留在原地坐标。
//   ②「在聊天里发消息是消息和屏幕都上移，最新消息不在最底部，跑到屏幕上半部分」
//     ＝键盘收起恢复 .phone 高度后无人回钉（#466 只挂 vv resize，iOS 漏派发/时序竞态）。
// 断言：
//   A 轴（源码锚）：跟随助手在位；误差自校正逻辑在位；单聊/群聊均接入；RO 回钉在位；
//                   旧「一次性定位」块已移除（absent）。
//   B 轴（真实产物）：点气泡开操作条＝贴着气泡（垂直缝隙 ≤40px）；滚动消息列表＝操作条实时跟随
//                   （无修复时距离 ≈ 滚动量 380px，判别点明确）；锚点气泡被删＝下次几何变化时
//                   菜单自动关闭；贴底态内容长高后 .phone 压缩→恢复（键盘期来消息形态）＝
//                   回钉贴底（无修复时 scrollTop 停旧值、恢复后 dist≈ΔH≈60px 离底，判别点明确）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚 ----------
let chatSrc = '', gcSrc = '';
try { chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8'); } catch (e) {}
try { gcSrc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8'); } catch (e) {}
check('A1 跟随锚点助手在位（chat.js，单聊群聊共用）',
  chatSrc.includes('window.mochiFollowActionBar = function (bar, anchor, onClose) {'));
check('A2 操作条定位误差自校正在位（不假设 fixed 包含块语义）',
  chatSrc.includes('const _maDx = x - m.left, _maDy = y - m.top;'));
check('A3 单聊打开即挂跟随并立即定位',
  chatSrc.includes('window.mochiFollowActionBar(msgActions, b, closeMsgActions)'));
check('A4 群聊接入同一跟随助手',
  gcSrc.includes('window.mochiFollowActionBar(gcMsgActions, bk, closeGcMsgActions)'));
check('A5 chat-body 盒尺寸 ResizeObserver 回钉在位（#643）',
  chatSrc.includes("if (!cb643 || typeof ResizeObserver === 'undefined') return;"));
check('A6 回钉受 chatPinnedBottom 闸约束（#162 解钉不拽底契约不变；#868 起该校正在 chatRepinStep 里）',
  chatSrc.includes('if (!chatVisible() || !chatPinnedBottom) return;')
  && chatSrc.includes('if (cb868 && chatScrollMax() - cb868.scrollTop > 8) scrollChatBottom();'));
check('A7 旧「一次性定位」块已移除（absent：单聊直接写 style.top）',
  !chatSrc.includes("msgActions.style.top = y + 'px';"));
check('A8 旧「一次性定位」块已移除（absent：群聊直接写 style.top）',
  !gcSrc.includes("gcMsgActions.style.top = y + 'px';"));
if (results.some(r => !r.ok)) {
  console.log('----');
  console.log('A 轴有 FAIL：源码锚缺失（修复被覆盖或未接入）——继续跑 B 轴取行为级 RED 对照');
}

// ---------- B 轴：真实浏览器行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  process.exit(2);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-642-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
          }
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
      jsErrors.push((r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 200));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function bootToReady() {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(500);
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 首次进入建立 origin → 清库 + 种 40 条普通文本消息（default 桌面）→ 重载走真实启动
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(1800);
await evalJs(`(async function(){
  try { indexedDB.deleteDatabase('xy-home-v2'); } catch (e) {}
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  var arr = [];
  var t0 = Date.now() - 7200000;
  for (var i = 0; i < 40; i++) {
    arr.push({ side: (i % 2 ? 'in' : 'out'), ts: t0 + i * 60000, text: '测试消息 ' + i + '，' + (i % 2 ? '来自 TA 的长一点的内容用来撑起气泡宽度与高度。' : '我自己发的消息，同样稍微长一点。') });
  }
  localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(arr));
  await window.idbSet('xy-home-v2:default:chat-msgs', JSON.stringify(arr));
  return 'seeded';
})()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2400);
await bootToReady();

// 打开聊天页
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return 1;})()");
await sleep(2000);

const env = await evalJs(`(function(){
  var cb = document.getElementById('chat-body');
  if (!cb) return JSON.stringify({ err: 'no chat-body' });
  return JSON.stringify({
    bubbles: cb.querySelectorAll('.msg-bubble').length,
    st: cb.scrollTop, sh: cb.scrollHeight, ch: cb.clientHeight,
    pinnedNearBottom: (cb.scrollHeight - cb.scrollTop - cb.clientHeight) <= 8
  });
})()`);
let envObj = {}; try { envObj = JSON.parse(env || '{}'); } catch (e) {}
check('B0 聊天页打开、消息渲染且初始贴底', (envObj.bubbles || 0) >= 10 && envObj.pinnedNearBottom === true,
  'bubbles=' + envObj.bubbles + ' nearBottom=' + envObj.pinnedNearBottom);

// 通用量测：操作条与气泡的垂直缝隙（相邻 ≤ 40px 判「贴着」）
const GAP_PX = 40;
async function measurePair(sel) {
  return evalJs(`(function(){
    try {
      var bar = document.getElementById('msg-actions');
      var bub = ${sel};
      if (!bar || bar.hidden || !bub) return JSON.stringify({ err: 'bar/bub missing', hidden: bar ? bar.hidden : null });
      var r1 = bar.getBoundingClientRect(), r2 = bub.getBoundingClientRect();
      var gap = Math.min(Math.abs(r1.bottom - r2.top), Math.abs(r2.bottom - r1.top));
      return JSON.stringify({ gap: Math.round(gap), barTop: Math.round(r1.top), bubTop: Math.round(r2.top) });
    } catch (e) { return JSON.stringify({ err: String(e) }); }
  })()`);
}

// B1 点气泡（contextmenu 长按路径）开操作条 → 贴着气泡
const pickIdx = Math.max(0, (envObj.bubbles || 2) - 4);
await evalJs(`(function(){
  var b = document.querySelectorAll('#chat-body .msg-bubble')[${pickIdx}];
  if (!b) return 0;
  b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  return 1;
})()`);
await sleep(200);
const b1 = await measurePair(`document.querySelectorAll('#chat-body .msg-bubble')[${pickIdx}]`);
let b1o = {}; try { b1o = JSON.parse(b1 || '{}'); } catch (e) {}
check('B1 点气泡弹操作条：操作条贴着气泡（缝隙 ≤' + GAP_PX + 'px）',
  !b1o.err && b1o.gap <= GAP_PX, 'gap=' + b1o.gap + ' ' + JSON.stringify(b1o));

// B2 滚动消息列表 → 操作条实时跟随（无修复时气泡移开 ≈380px 而操作条不动）
await evalJs(`(function(){
  var cb = document.getElementById('chat-body');
  cb.scrollTop = cb.scrollTop - 380;
  return cb.scrollTop;
})()`);
await sleep(250);
const b2 = await measurePair(`document.querySelectorAll('#chat-body .msg-bubble')[${pickIdx}]`);
let b2o = {}; try { b2o = JSON.parse(b2 || '{}'); } catch (e) {}
check('B2 滚动 380px 后操作条仍贴着同一气泡（实时跟随）',
  !b2o.err && b2o.gap <= GAP_PX && Math.abs((b2o.bubTop || 0) - (b1o.bubTop || 0)) >= 150,
  'gap=' + b2o.gap + ' bubbleMoved=' + Math.round((b2o.bubTop || 0) - (b1o.bubTop || 0)));

// B3 锚点气泡被删（重渲/撤回场景）→ 下一次几何变化菜单自动关闭
await evalJs(`(function(){
  var it = document.querySelectorAll('#chat-body .msg-bubble')[${pickIdx}];
  var msg = it && it.closest('.msg');
  if (msg) msg.remove();
  var cb = document.getElementById('chat-body');
  cb.scrollTop = cb.scrollTop - 5; // 触发一次几何变化
  return 1;
})()`);
await sleep(250);
const b3hidden = await evalJs(`(function(){ var m = document.getElementById('msg-actions'); return m ? !!m.hidden : null; })()`);
check('B3 锚点气泡被删后菜单自动关闭', b3hidden === true, 'hidden=' + b3hidden);

// B4 .phone 压缩→恢复 × 内容长高（模拟「键盘开着时来消息/图片撑高」的真实形态）：
// 贴底态先追加一条消息（内容高 +ΔH，视图离底 ΔH 且此刻无人回钉），随后压缩 .phone（键盘开）
// 再恢复（键盘收）。有 RO 回钉＝压缩帧内 scrollTop 就跟到新 max、恢复后贴底（dist≤8）；
// 无修复＝scrollTop 停在旧值 H1−F，恢复后 dist≈ΔH 离底（判别点，基线实测 ≈60px）
const phoneH = await evalJs(`(function(){
  var cb = document.getElementById('chat-body');
  cb.scrollTop = cb.scrollHeight; // 先回到贴底
  var m = document.createElement('div');
  m.className = 'msg msg-out';
  m.innerHTML = '<div class="msg-bubble">键盘期长高的消息</div>';
  cb.appendChild(m); // 内容长高、视图离底（真实形态：键盘期来消息/图片撑高）
  var ph = document.querySelector('.phone');
  ph.style.height = Math.round(window.innerHeight * 0.66) + 'px'; // 键盘压下（此刻 RO 应回钉）
  return ph.style.height;
})()`);
await sleep(250);
await evalJs("(function(){var ph=document.querySelector('.phone'); ph.style.height=''; return 1;})()"); // 键盘收起恢复
await sleep(400);
const b4 = await evalJs(`(function(){
  try {
    var cb = document.getElementById('chat-body');
    var d = cb.scrollHeight - cb.scrollTop - cb.clientHeight;
    var last = document.querySelectorAll('#chat-body .msg-bubble');
    var lb = last[last.length - 1].getBoundingClientRect();
    var cbr = cb.getBoundingClientRect();
    return JSON.stringify({ dist: Math.round(d), lastBottom: Math.round(lb.bottom), cbBottom: Math.round(cbr.bottom) });
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`);
let b4o = {}; try { b4o = JSON.parse(b4 || '{}'); } catch (e) {}
check('B4 .phone 高度压缩→恢复后回钉贴底（距底 ≤8px，最新消息在底部可视区内）',
  !b4o.err && b4o.dist <= 8 && b4o.lastBottom <= b4o.cbBottom + 2,
  'dist=' + b4o.dist + ' lastBottom=' + b4o.lastBottom + '/cbBottom=' + b4o.cbBottom + ' (phoneH=' + phoneH + ')');

check('B5 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

chrome.kill();
server.close();
const fails = results.filter(r => !r.ok).length;
console.log('----');
console.log('通过 ' + (results.length - fails) + '/' + results.length + (fails ? ' （FAIL ' + fails + '）' : ''));
process.exit(fails ? 1 : 0);

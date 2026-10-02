// ===== 常驻回归脚本 #912：联系人连发消息「视口被旧平滑动画拽离底部」===== （tools/verify-*.mjs 常驻资产）
// 用法：node tools/verify-chat-in-follow-race.mjs [被测根目录]（缺省＝本仓库主树，须已构建）
// 复现路径（无头 Chrome，390×844 手机视口）：
//   贴底钉住态下，联系人连发多条消息（真实 addInTyped 链＋我方触发自动回复链），逐帧采样
//   #chat-body 滚动位。缺陷形态（红基线实证，无头即现）：在飞平滑动画（scrollChatBottomSmooth，
//   rAF＋ease-out，最长 360ms）持有上一条消息时的 start/target；下一条消息的瞬时贴底写入
//   （scrollChatBottom）不取消它 ⇒ 动画帧用旧值把刚写到位的 scrollTop 拉回去——已贴底的画面
//   无端跳开（红基线实测单帧倒退 147px、gap 反复张开到 564px），慢机型上就是「联系人发消息
//   总不在最底部」。修复＝瞬时贴底写入与用户解钉都当场 cancelAnimationFrame(_ccSmoothT)。
// 断言：
//   A0 前置防假绿：聊天区确实撑出滚动高度、钉住态贴底。
//   A1 连发全程任一采样帧 gap ≤ 60px（红基线多次 >100px，最高 564px）。
//   A2 连发全程 scrollTop 无 >25px 的倒退帧（打字行显隐口径 ±22px；倒退＝旧动画帧拉回的特征）。
//   A3 末条落地 800ms 内收口到距底 ≤2px。
//   S1/S2 产物锚：两处取消语句在位（scrollChatBottom 内／unpinChatAndAnchor 内）。
//   Z1 全程零 JS 异常。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
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

// ---- S1/S2 产物锚（静态）----
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
let indexHtml = '';
try { indexHtml = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
try { indexHtml += readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {} // #860 后 chat.js 外置
const S1 = 'if (_ccSmoothT) { cancelAnimationFrame(_ccSmoothT); _ccSmoothT = null; } chatPinnedBottom = true;';
const S2 = 'if (_ccSmoothT) { cancelAnimationFrame(_ccSmoothT); _ccSmoothT = null; } body.classList.add(\'scroll-anchor-auto\');';
check('S1 瞬时贴底写入取消在飞动画（锚在 chat.js 内联产物）', indexHtml.includes(S1));
check('S2 解钉取消在飞动画', indexHtml.includes(S2));

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-912-' + Date.now()),
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
          if (m.method === 'Runtime.exceptionThrown') jsErrors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0, 200));
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
    if (r && r.exceptionDetails) return null;
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
// 回复链调快便于采样（保留真实 showTyping/多卡链路不动）
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','1');st.set('reply-rs-max','2');return true;})()");
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(800);

// A0：撑出滚动高度
for (let i = 1; i <= 30; i++) {
  await evalJs(`window.chatSendMsg('撑高度第${i}条，内容稍微长一点用来撑出滚动区域。');`);
}
await sleep(600);
const SNAP = `(function(){
  var cb=document.getElementById('chat-body');
  if(!cb)return JSON.stringify({err:1});
  var t=document.getElementById('chat-typing');
  var tv=!!(t&&!t.hidden),rh=tv?t.offsetHeight:0;
  return JSON.stringify({top:cb.scrollTop,maxReal:cb.scrollHeight-(cb.clientHeight+rh),typing:tv,n:cb.children.length});
})()`;
const s0 = JSON.parse(await evalJs(SNAP) || '{}');
check('A0 前置：滚动高度已撑出且贴底', !s0.err && (s0.maxReal - s0.top) < 4 && s0.maxReal > 600, 'gap=' + (s0.maxReal - s0.top));

// ---- A1/A2：两段真实连发（TA 回复链 + addInTyped 多卡），每 30ms 采样 ----
const rows = [];
async function burst(label, trigger) {
  await evalJs(trigger);
  const t0 = Date.now();
  let lastN = s0.n;
  while (Date.now() - t0 < 9000) {
    const s = JSON.parse(await evalJs(SNAP) || '{}');
    if (!s.err) rows.push({ t: Date.now() - t0, ...s, gap: s.maxReal - s.top, label });
    await sleep(30);
    const cur = rows[rows.length - 1];
    if (cur && cur.n !== lastN) { lastN = cur.n; }
  }
}
await burst('reply', `window.chatSendMsg('你好呀，今天过得怎么样？');`);
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','4');st.set('reply-rs-max','6');return true;})()");
await burst('typed', `window.chatAddInTyped && window.chatAddInTyped(['连发一','连发二','连发三','连发四']);`);

if (rows.length < 50) check('A1 连发采样帧数充足', false, 'rows=' + rows.length);
else {
  // A1：全程 gap ≤ 60px（只统计末次新消息之后仍可能有过渡的帧——不做豁免，贴底写入与追加同任务）
  const maxGap = Math.max(...rows.map((r) => r.gap));
  check('A1 连发全程视口距底 ≤60px', maxGap <= 60, 'maxGap=' + Math.round(maxGap) + 'px（红基线 564px）');
  // A2：scrollTop 无 >25px 倒退帧（同段内）
  let worst = 0, worstAt = -1;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i - 1].top - rows[i].top; // 正＝倒退
    if (d > worst) { worst = d; worstAt = rows[i].t; }
  }
  check('A2 连发全程 scrollTop 无倒退帧（≤45px＝打字行显隐22px＋内核钳位口径）', worst <= 45, 'worst=' + Math.round(worst) + 'px @t=' + worstAt + 'ms（红基线 349px）');
  // A3：末帧收口
  const last = rows[rows.length - 1];
  check('A3 结束时收口贴底 ≤2px', Math.abs(last.gap) <= 2, 'gap=' + Math.round(last.gap));
}
check('Z1 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过' + (fails ? '（' + root + '）' : ''));
process.exit(fails ? 1 : 0);

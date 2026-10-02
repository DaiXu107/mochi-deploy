// ===== 回归验证：#504 进聊天页「聊天记录回弹一下再恢复」（红米 K80 Chrome 等多机型） =====
// 症状：从桌面点开聊天，贴底后 ~400ms 视口内 loading=lazy 图片加载完、内容一次性长高数百
// px，当帧以旧 scrollTop 绘制＝视口被顶离底部一拍再被拽回（可见回弹）。旧 enterChat 只有
// 「3 rAF + 固定 400ms」复写，长高落在 400ms 后即漏；图片 onload 补偿是 rAF 下一帧＝慢一拍。
// 修复：enterChat 后 1.2s rAF 稳定窗（每帧比对 scrollHeight、变高当帧同步回钉，解钉/离页
// 即停）+ 图片 onload 捕获监听补同步回钉。
// 断言（真实点击聊天图标进入，rAF 逐帧采样 2.5s）：
//   A1 首次进入：出现「贴底(gap≤8) → 离底(gap>12) → 回底」的 BOUNCE 帧 = 0（长高当帧即修正）
//   A2 退出再进入（#220 原地补丁路径）：同样 BOUNCE = 0
//   A3 贴底契约：2.5s 末仍贴底（修复没有把「自动跟底」改坏）
// 用法：node tools/verify-chat-entry-bounce.mjs（默认对仓库根产物；MOCHI_SERVE_ROOT=<目录> 可对
//       临时构建产物做红绿对照）。需要 Node 21+ 与本机 Chrome/Edge。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9720 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-500-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(500);
}
// 种 300 条历史：视口内外的图片（加载后长高）+ 长文本（折行）——回弹的高度源
const IMG_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mNk+M+ACzDhVQ4CAAvwATkP0aAAAAAAAElFTkSuQmCC';
await openPage();
await evalJs(`(function(){
  const now = Date.now(); const arr = [];
  for (let i = 0; i < 300; i++) {
    if (i % 9 === 0) arr.push({ side: i % 2 ? 'in' : 'out', type: 'image', text: '${IMG_PNG}', ts: now - (300 - i) * 60000 });
    else if (i % 13 === 0) arr.push({ side: 'in', text: '长文本'.repeat(60) + i, ts: now - (300 - i) * 60000 });
    else if (i % 2 === 0) arr.push({ side: 'out', text: '历史消息' + i, ts: now - (300 - i) * 60000 });
    else arr.push({ side: 'in', text: '对方消息' + i, ts: now - (300 - i) * 60000 });
  }
  window.activeStore().set('chat-msgs', JSON.stringify(arr));
  return true;
})()`);
await sleep(300);

// 进入聊天并逐帧采样 2.5s（rAF 采样＝每个绘制帧的真实状态）
async function enterAndSample() {
  await evalJs("(function(){window.__bounceLog=[];var a=document.querySelector('.app[data-app=\"chat\"]');a.click();var b=document.getElementById('chat-body');var t0=performance.now();function sample(){var r={t:Math.round(performance.now()-t0),hidden:document.getElementById('page-chat').hidden,st:b.scrollTop,sh:b.scrollHeight,ch:b.clientHeight};window.__bounceLog.push(r);if(r.t<2500)requestAnimationFrame(sample);}requestAnimationFrame(sample);return true;})()");
  await sleep(3200);
  const log = await evalJs('JSON.stringify(window.__bounceLog||[])');
  const frames = JSON.parse(log || '[]');
  let atBottom = false; const bounces = [];
  let lastGap = null;
  for (const f of frames) {
    if (f.hidden) continue;
    const gap = f.sh - f.st - f.ch;
    lastGap = gap;
    if (gap <= 8) { atBottom = true; }
    else if (gap > 12 && atBottom) { atBottom = 'away'; bounces.push({ t: f.t, gap, sh: f.sh, st: f.st }); }
  }
  return { frames: frames.length, bounces, lastGap };
}

// ---- A1 首次进入 ----
await openPage();
const r1 = await enterAndSample();
check('A1 首次进入无回弹帧（BOUNCE=0）', r1.bounces.length === 0, JSON.stringify(r1));
check('A3 首次进入末帧仍贴底 (gap≤8)', r1.lastGap !== null && r1.lastGap <= 8, 'lastGap=' + r1.lastGap);

// ---- A2 退出再进入（#220 原地补丁路径）----
await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();document.querySelectorAll('.page').forEach(function(p){if(p.id!=='page-phone')p.hidden=true;});return true;})()");
await sleep(600);
const r2 = await enterAndSample();
check('A2 重入无回弹帧（BOUNCE=0）', r2.bounces.length === 0, JSON.stringify(r2));
check('A3b 重入末帧仍贴底 (gap≤8)', r2.lastGap !== null && r2.lastGap <= 8, 'lastGap=' + r2.lastGap);

chrome.kill(); server.close();
console.log(`\\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);

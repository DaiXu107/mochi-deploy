// ===== 回归：通话时长从「接听时刻」起算，不含响铃/拨出等待 =====
// 复现用户反馈：来电响铃一段时间后点接通，时长会卡在 00:00 一下，
//   随后直接从第 1 秒蹦到约等于响铃等待秒数（响铃末尾接听直接蹦到 30 秒）。
// 根因（v3.13.x 修复前）：updateDur / userHangup 用 startTime（响铃/拨出起点）计时，
//   把响铃等待时长计入了通话。修复后统一用 connectedTime（接听/接通时刻）。
// 用例：
//   A. 来电响铃 3s 后接听 → 接通瞬间 durEl=00:00（不再卡 0 秒）
//   B. 接通 +1.2s → durEl=00:01（旧版会算成 00:04，把 3s 响铃算进去）
//   C. 自动最小化后 miniTime 秒数 <= 3（旧版约 5）
//   D. 挂断 → records-call 记录时长秒数 <= 3（旧版约 5）
//   E. 去电接通：时长也从接通时刻起算（旧版计入拨出等待 ~2-3s）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-call-dur-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await waitReady();
await sleep(1200);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
// 读取时长元素显示秒数（'MM:SS' → 秒）
async function durSec(elId) {
  const t = await evalJs(`(function(){ const el=document.getElementById('${elId}'); return el ? el.textContent : null; })()`);
  if (t == null) return -1;
  const m = String(t).match(/(\d+):(\d+)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

await evalJs(`window.activeStore().set('call-mini-enabled', '1'); true;`);

// ---- A. 来电响铃 3s 后接听 ----
await evalJs(`window.triggerIncomingCall(); true;`);
await sleep(3000);
const durRinging = await durSec('call-duration');
console.log('== A: 响铃 3s 后接听 == 响铃中 durEl=' + durRinging);
check('A: 响铃中时长显示 00:00', durRinging === 0, 'durEl=' + durRinging);
await evalJs(`document.getElementById('call-answer-btn').click(); true;`);
const durAt0 = await durSec('call-duration');
console.log('== A: 接通瞬间 durEl=' + durAt0);
check('A: 接通瞬间立即显示 00:00（不再卡 0 秒）', durAt0 === 0, 'durEl=' + durAt0);

// ---- B. 接通 +1.2s（面板仍在，未最小化）----
await sleep(1200);
const durAt1 = await durSec('call-duration');
console.log('== B: 接通 +1.2s durEl=' + durAt1);
check('B: 接通 1.2s 后显示 00:01（不含 3s 响铃，旧版为 00:04）', durAt1 === 1, 'durEl=' + durAt1);

// ---- C. 自动最小化后（接通 +2.7s）小框时长 ----
await sleep(1500);
const miniAt = await durSec('call-mini-time');
console.log('== C: 接通 +2.7s（已最小化）miniTime=' + miniAt);
check('C: 小框时长 <= 3s（旧版约 5s）', miniAt >= 1 && miniAt <= 3, 'miniTime=' + miniAt);

// ---- D. 挂断 → 通话记录时长按接听时刻 ----
await evalJs(`window.hangupCall(); true;`);
await sleep(400);
const recText = await evalJs(`(function(){ const l=JSON.parse(window.activeStore().get('records-call')||'[]'); return l[0] && l[0].text ? l[0].text : ''; })()`);
const recSec = (() => { const m = String(recText).match(/（(\d+):(\d+)）/); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; })();
console.log('== D: 挂断记录文本=' + recText + ' 秒数=' + recSec);
check('D: 通话记录时长 <= 3s（旧版约 5s）', recSec >= 0 && recSec <= 3, 'recSec=' + recSec);

// ---- E. 去电接通：时长也从接通时刻起算（旧版计入拨出等待 ~2-3s）----
// 强制接通概率，避免随机忙线/拒绝导致测不到接通路径
await evalJs(`window.__callDurCfgSave = window.replyCfg; window.replyCfg = () => ({ 'call-pickup': 100, 'call-busy': 0, 'call-reject': 0, 'call-hangup': 0 }); true;`);
await evalJs(`window.placeCall(); true;`);
await sleep(5000);
const outSec = await durSec('call-duration');
console.log('== E: 去电拨出 5s 后 durEl=' + outSec);
check('E: 去电时长 <= 4s（旧版按拨出起点约 5s）', outSec >= 1 && outSec <= 4, 'durEl=' + outSec);
await evalJs(`window.hangupCall(); window.replyCfg = window.__callDurCfgSave; true;`);
await sleep(300);

const failed = results.filter(r => !r.ok);
console.log('\n==== 结果：' + results.length + ' 项检查，' + failed.length + ' 项失败 ====');
if (failed.length) { failed.forEach(f => console.log('  FAIL:', f.desc)); process.exitCode = 1; }
else console.log('全部通过');
chrome.kill();
server.close();
process.exit(process.exitCode || 0);

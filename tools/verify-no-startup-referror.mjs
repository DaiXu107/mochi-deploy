// ===== 验证：启动期无 ReferenceError 类被吞异常（未定义标识符 / TDZ 家族） =====
// 回归 #493/#494（2026-09-15）：chat.js 顶层 mochi-fg-resume 监听引用 scheduleReply/replyOnce
// 函数内局部 const sameCid＝每次回前台 ReferenceError 被行内 catch 吞、trySystemAskMochi 回前台
// 补触发通道失效；personalize.js deskLayout const 定义在 buildDeskPages 顶层调用之后＝冷启动
// TDZ、删页收缩落盘判断被吞。同族前科：#456 RP_COVER_KEY、#453 renderTabCounts null 树。
// 手法：CDP Debugger.setPauseOnExceptions('all') 抓启动期全部异常（含被 try/catch 静默吞掉的，
// 普通 __jsErrors/console 永远看不到），断言其中无 ReferenceError（JSON.parse 空串等已知噪音
// 白名单放行）。修同类「未定义引用/TDZ 被吞」时此脚本应保持绿。
// 用法：node tools/verify-no-startup-referror.mjs（需 node 21+ 原生 WebSocket 与本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chromium', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 200));
const udd = join(process.env.TEMP || '/tmp', 'mochi-vsr-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); server.close(); rmSync(udd, { recursive: true, force: true }); } catch (e) {} });

let ws = null, msgId = 0;
const pend = new Map();
const events = [];
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
          else if (m.method) events.push(m);
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }); if (r && r.exceptionDetails) return null; return r && r.result ? r.result.value : null; } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Debugger.enable');
await cdp('Debugger.setPauseOnExceptions', { state: 'all' });

const caught = [];
const uncaught = [];
const scriptUrls = {};
const PAUSE_MAX = 120;
let pausing = true;
(async () => {
  while (pausing) {
    const ev = events.splice(0, events.length);
    for (const m of ev) {
      if (m.method === 'Debugger.scriptParsed') { scriptUrls[m.params.scriptId] = m.params.url || ''; continue; }
      if (m.method === 'Debugger.paused' && caught.length < PAUSE_MAX) {
        const d = m.params.data;
        const f0 = m.params.callFrames[0] || {};
        const loc = f0.location || {};
        caught.push({
          msg: (d && (d.description || d.text) || '').split('\n')[0].slice(0, 160),
          at: (f0.functionName || '(anon)') + '@' + (scriptUrls[loc.scriptId] || 'script#' + loc.scriptId).split('/').pop() + ':' + (loc.lineNumber + 1)
        });
        cdp('Debugger.resume').catch(() => {});
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        uncaught.push(((d.exception && (d.exception.description || d.exception.value)) || d.text || '').split('\n')[0].slice(0, 160));
      }
    }
    await sleep(50);
  }
})();

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(8000);
await evalJs("try{localStorage.setItem('xy-home-v2:age-confirmed','1')}catch(e){}");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(8000);
await cdp('Debugger.setPauseOnExceptions', { state: 'none' }).catch(() => {});
pausing = false;
await sleep(200);

// JSON.parse 空串/损坏属既定 try/catch 兜底口径（gift-shop parseRaw 等），不算未定义引用
const NOISE = [/^SyntaxError: (Unexpected end of JSON|Unterminated string)/];
const badCaught = caught.filter((c) => /^ReferenceError:/.test(c.msg));
const badUncaught = uncaught.filter((m) => /^ReferenceError:/.test(m.msg));

console.log('== 启动期被吞异常清单（参考，含已知噪音）==');
for (const c of caught) console.log('  · ' + c.msg + '  @ ' + c.at);
let fail = 0;
if (badCaught.length) { fail++; console.log('FAIL  被吞异常含 ReferenceError（未定义标识符/TDZ 家族——参照 #493/#494 修法定位定义缺失）：'); for (const c of badCaught) console.log('  × ' + c.msg + '  @ ' + c.at); }
if (badUncaught.length) { fail++; console.log('FAIL  未捕获异常含 ReferenceError：'); for (const m of badUncaught) console.log('  × ' + m); }
if (!fail) console.log('PASS  启动期（裸加载+年龄闸门后重载）caught/uncaught 均无 ReferenceError（caught ' + caught.length + ' 条、uncaught ' + uncaught.length + ' 条）');
process.exit(fail ? 1 : 0);

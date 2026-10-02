// ===== 回归验证 #359→#437：表情包重复发送两组口径（摩托罗拉 G100 / 华为 P50E 多机型 → 用户 #437 确认可有意重发同内容） =====
// #359 原口径（旧代码）：发件侧媒体去重窗 8000ms——同表情 8s 内重发一律吞（B1/C1 旧版=1 红）。
// #437 新口径（2026-09-14 用户拍板「同一时间发同样的内容必须能发出去」，多机型同报）：
//   ①机械双派发（150ms 双 click）仍合并只出 1 条（A1，#359 防线不丢）；
//   ②发完重开面板再点同一条（>800ms）＝有意重发，2 条全入库且刷新不回吞（B1/B2/C1，旧 8000ms 窗=1 红）；
//   ③命中吞并时给 toast 反馈，不再静默（A2，旧代码无 toast=红）。
// 刷新归一化 collapseRapidDups/normCollapseRange 与 addRec 同用 dupGapMs（#256 屏上所见即刷新后所见）。
// 用法：node tools/verify-sticker-double-send.mjs（对构建后产物 index.html）
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!res.headersSent) res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { if (!res.headersSent) res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
const watchdog = setTimeout(() => { console.log('WATCHDOG: 强制退出'); try { chrome.kill(); } catch (e) {} process.exit(2); }, 120000);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = 9930 + Math.floor(Math.random() * 60);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dup-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; }
  } catch (e) {}
  await sleep(150);
}
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 400)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail) {
  results.push(!!ok);
  if (ok) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, detail || ''); }
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, isMobile: true, hasTouch: true });

await cdp('Page.navigate', { url: 'about:blank' });
await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
// #384 强制公告放行
const SPLASH_PASS = `(function(){
  var m = document.getElementById('splash-mandatory');
  if (m && !m.hidden) {
    var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
    var en = document.getElementById('splash-mandatory-enter'); if (en) en.click();
  } else { var s = document.getElementById('splash'); if (s) s.click(); }
  return 1;
})()`;
await evalJs(SPLASH_PASS);
await sleep(600);
// 禁自动回复干扰断言（TA 回复是 side 'in' 本就不计数，双保险）
await evalJs(`(function(){ try{ localStorage.setItem('xy-home-v2:reply-rs-min','9999'); localStorage.setItem('xy-home-v2:reply-rs-max','9999'); }catch(e){} return 1; })()`);
// 种 1 张我的表情包（>1KB dataURL，触发令牌化窗口语义）
await evalJs("(function(){ var src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; src=src+'AAAAAAAA'.repeat(60); localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['测试组',[src]]])); localStorage.setItem('xy-home-v2:default:emoji-last', JSON.stringify({mode:'mine',mine:'测试组'})); return 1; })()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs(SPLASH_PASS);
await sleep(1000);
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="chat"]'); if (ic) ic.click(); return !!ic; })()`);
await sleep(1000);

const countOutSticker = `JSON.stringify({
  recs: (window.getChatMsgs() || []).filter(m => m.side === 'out' && (m.type === 'sticker' || (m.parts || []).some(p => p.k === 'img'))).map(m => ({ t: String(m.text || '').slice(0, 24), ty: m.type || '', ts: m.ts })),
  bubbles: document.querySelectorAll('#chat-body .msg-out').length,
  toast: (function(){ var t = document.getElementById('cc-toast'); return t && t.className.indexOf('show') >= 0 ? String(t.textContent || '') : ''; })()
})`;
const openPanel = `(function(){ var b=document.getElementById('chat-emoji-btn'); if(b) b.click(); return !!b; })()`;
const tapFirst = `(function(){ var it=document.querySelector('#emoji-panel .emoji-item'); if(it) it.click(); return !!it; })()`;

// ===== 形态 A：打开表情面板，同一条目 150ms 双 click（移动端双派发模拟）=====
await evalJs(openPanel);
await sleep(800);
const panelInfo = await evalJs(`JSON.stringify({ items: document.querySelectorAll('#emoji-panel .emoji-item').length })`);
check('S1 表情面板就绪(种我的表情包+mine 模式)', JSON.parse(panelInfo).items >= 1, panelInfo);
await evalJs(`(function(){ var it=document.querySelector('#emoji-panel .emoji-item'); if(!it) return 0; it.click(); setTimeout(function(){ try { it.click(); } catch(e){} }, 150); return 1; })()`);
await sleep(1200);
const A = JSON.parse(await evalJs(countOutSticker));
check('A1 150ms 机械双派发仍只出 1 条(#359 防线不丢)', A.recs.length === 1, JSON.stringify(A));
check('A2 吞并时有 toast 反馈不再静默(#437)', A.toast.indexOf('同样的内容') >= 0, 'toast=' + JSON.stringify(A.toast));

// ===== 形态 B：关面板等 ~3.5s（>800ms 窗），重开再点同一条目＝有意重发 =====
await sleep(1800);
await evalJs(openPanel);
await sleep(600);
await evalJs(tapFirst);
await sleep(1200);
const B = JSON.parse(await evalJs(countOutSticker));
check('B1 >800ms 重发同表情=2 条都发出(#437 旧 8000ms 窗=1 红)', B.recs.length === 2, JSON.stringify(B));
check('B2 屏上气泡数=记录数', B.bubbles === B.recs.length, 'bubbles=' + B.bubbles + ' recs=' + B.recs.length);

// ===== 形态 C：等整包落盘防抖冲净（轮询 IDB 权威库到 2 条，#180 低频整包落盘+尾巴日志不回放媒体
// 消息＝发送后立刻刷新会撞落盘竞态，属既有设计非本修复口径），再刷新重进看归一化是否回吞 =====
let persisted = null;
for (let i = 0; i < 40; i++) {
  persisted = await evalJs(`(async function(){ try { var a = await window.idbGet('xy-home-v2:default:chat-msgs'); if (typeof a === 'string') a = JSON.parse(a); a = a || []; return a.filter(function(m){ return m.side === 'out' && (m.type === 'sticker' || (m.parts || []).some(function(p){ return p.k === 'img'; })); }).length; } catch (e) { return -1; } })()`);
  if (persisted >= 2) break;
  await sleep(500);
}
check('C0 两 条均已落盘 IDB(权威库)', persisted >= 2, 'idb out-sticker=' + persisted);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs(SPLASH_PASS);
await sleep(1000);
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="chat"]'); if (ic) ic.click(); return 1; })()`);
await sleep(1000);
const C = JSON.parse(await evalJs(countOutSticker));
check('C1 刷新后数据层仍 2 条(归一化同口径不回吞)', C.recs.length === 2, JSON.stringify(C));

clearTimeout(watchdog);
chrome.kill();
server.close();
const fails = results.filter(x => !x).length;
console.log(fails ? 'FAIL ' + fails + '/' + results.length : 'PASS ' + results.length + '/' + results.length);
process.exit(fails ? 1 : 0);

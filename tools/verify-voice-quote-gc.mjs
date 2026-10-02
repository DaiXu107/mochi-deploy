// ===== 群聊语音引用防 base64 霸屏验证（v3.26.x，用户反馈：群聊语音被引用时整串代码霸屏） =====
// 场景：群聊历史/导入数据里 rec.quote 存的是原始语音文本「名称|||data:audio;base64,…」
// （早期版本成员回复引用直接存 userText 原文）→ gcQuoteHtml 字符串分支 escTxtBr 直出 → 霸屏。
// 修复：gcQuoteTextSafe 清理（与聊天页 quoteTextSafe 同构）；新数据（[语音] 名称）原样通过不误伤。
// 用法：node tools/verify-voice-quote-gc.mjs（需先 node build.mjs）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vqgc-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + String(detail).slice(0, 120) + ']' : ''));
}

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
}

// 语音原文（名称|||data:audio;base64,…）——dataURL 用短伪串即可（>120 字符触发清理分支）
const B64 = 'data:audio/wav;base64,' + 'U'.repeat(200);
const VOICE_RAW = '语音 3″|||' + B64;
// 新数据格式（gcQuoteSnapOf 生成）：[语音] 名称
const VOICE_NEW = '[语音] 语音 3″';
const TXT_QUOTE = '想你了';

// 群聊历史消息：A = 坏数据字符串引用；B = 坏数据对象引用（{t, imgs}）；C = 新数据引用；D = 普通文本引用
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GC_MSGS = [
  { side: 'in', cid: 'default', name: 'ta', text: '回复内容A', quote: VOICE_RAW, ts: Date.now() - 5000 },
  { side: 'in', cid: 'default', name: 'ta', text: '回复内容B', quote: { t: VOICE_RAW, imgs: [IMG] }, ts: Date.now() - 4000 },
  { side: 'in', cid: 'default', name: 'ta', text: '回复内容C', quote: VOICE_NEW, ts: Date.now() - 3000 },
  { side: 'in', cid: 'default', name: 'ta', text: '回复内容D', quote: TXT_QUOTE, ts: Date.now() - 2000 },
  { side: 'out', text: '我发的消息', ts: Date.now() - 1000 },
];

await openPage();
// 注入群聊消息（全局键 xy-home-v2:group-chat-msgs，非 per-cid 命名空间）+ 点击桌面「群聊」图标进入
await evalJs("(function(){localStorage.setItem('xy-home-v2:group-chat-msgs', JSON.stringify(" + JSON.stringify(GC_MSGS) + "));return true;})()");
await sleep(200);
await openPage();
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"group-chat\"]'); if(a) a.click(); return !!a;})()");
await sleep(800);

const read = await evalJs(`(function(){
  const qs = Array.from(document.querySelectorAll('.msg-quote'));
  const out = qs.map(function(q){
    const t = q.querySelector('.msg-quote-text');
    const img = q.querySelector('.msg-quote-img');
    return {
      text: t ? t.textContent : null,
      hasImg: !!img,
      // 整串 base64 霸屏检测：文本里出现长 data:audio 段
      leakB64: (t && t.textContent.indexOf('data:audio') >= 0) || (t && t.textContent.indexOf('U'.repeat(80)) >= 0)
    };
  });
  return JSON.stringify(out);
})()`);
let arr = [];
try { arr = JSON.parse(read || '[]'); } catch (e) {}
check('历史坏引用（字符串）渲染成可读标签，不出现 base64', arr[0] && arr[0].text === '[语音] 语音 3″' && !arr[0].leakB64, read);
check('历史坏引用（对象 {t,imgs}）同样清理，不出现 base64', arr[1] && arr[1].text === '[语音] 语音 3″' && arr[1].hasImg && !arr[1].leakB64, read);
check('新数据引用（[语音] 名称）原样通过不误伤', arr[2] && arr[2].text === '[语音] 语音 3″' && !arr[2].leakB64, read);
check('普通文本引用不受影响', arr[3] && arr[3].text === '想你了' && !arr[3].leakB64, read);
check('4 条引用全部渲染且无任何 base64 泄漏', arr.length === 4 && arr.every(x => x && !x.leakB64), 'count=' + arr.length);

// 聊天页（chat.js）回归：同坏数据在主聊天页也安全（键为 per-cid 命名空间，走 activeStore）
const CHAT_MSGS = [
  { side: 'in', text: 'TA回复', quote: VOICE_RAW, qside: 'out', ts: Date.now() - 3000 },
  { side: 'in', text: 'TA回复2', quote: VOICE_NEW, qside: 'out', ts: Date.now() - 2000 },
];
await evalJs("(function(){var st=window.activeStore();st.set('chat-msgs', JSON.stringify(" + JSON.stringify(CHAT_MSGS) + "));return true;})()");
await sleep(200);
await openPage();
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return !!a;})()");
await sleep(800);
const chatRead = await evalJs(`(function(){
  const qs = Array.from(document.querySelectorAll('.msg-quote'));
  return JSON.stringify(qs.map(function(q){
    const t = q.querySelector('.msg-quote-text');
    const s = t ? t.textContent : '';
    return { text: s, leakB64: s.indexOf('data:audio') >= 0 || s.indexOf('U'.repeat(80)) >= 0 };
  }));
})()`);
let carr = [];
try { carr = JSON.parse(chatRead || '[]'); } catch (e) {}
check('聊天页历史坏引用同样清理（quoteTextSafe 回归）', carr[0] && carr[0].text === '[语音] 语音 3″' && !carr[0].leakB64, chatRead);
check('聊天页新数据引用不误伤', carr[1] && carr[1].text === '[语音] 语音 3″' && !carr[1].leakB64, chatRead);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

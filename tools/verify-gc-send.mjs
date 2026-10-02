// ===== 验证脚本：群聊批量发送 / 语音面板 链路（构建后无头 Chrome） =====
// 用法：node build.mjs && node tools/verify-gc-send.mjs
// 检查项：①点击群聊「批量发送」按钮打开批量面板（复用聊天页面板）
//         ②批量面板添加文字条目 → 发送全部 → 群聊消息落库（batchSendTarget 接 gcSendBatch）
//         ③点击群聊「麦克风」按钮打开录音面板（复用聊天页语音面板）
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
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node 21+（内置 WebSocket），当前 Node ' + process.version);
  process.exit(1);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gc-send-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  eval 异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 打开群聊页 + 开启批量/语音设置显示按钮
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});try{var st=window.activeStore();st.set('cs-batch-send','1');st.set('cs-voice-send','1');}catch(e){}document.dispatchEvent(new Event('batch-send-changed'));document.dispatchEvent(new Event('voice-send-changed'));return true;})()");
await sleep(400);

// ① 点击群聊批量按钮 → 批量面板打开
const batchOpen = await evalJs("(function(){" +
  "var btn=document.getElementById('gc-batch-btn');" +
  "var panel=document.getElementById('batch-panel');" +
  "if(!btn||!panel)return 'missing';" +
  "btn.click();" +
  "return JSON.stringify({btnDisplay:getComputedStyle(btn).display,panelHidden:panel.hidden});" +
  "})()");
await sleep(300);
const bs = JSON.parse(batchOpen || '{}');
check('点击群聊批量按钮打开批量面板', bs.panelHidden === false && bs.btnDisplay !== 'none', batchOpen);

// ② 添加文字条目 → 发送全部 → 群聊消息落库
const sendTest = await evalJs("(function(){" +
  "var txt=document.getElementById('batch-text');" +
  "if(!txt)return JSON.stringify({err:'no batch-text'});" +
  "txt.value='群聊批量测试';" +
  "document.getElementById('batch-text-add').click();" +
  "var list=document.getElementById('batch-list');" +
  "var listText=list?list.innerText.slice(0,60):'';" +
  "document.getElementById('batch-send-all').click();" +
  "var msgs=JSON.parse(localStorage.getItem('xy-home-v2:group-chat-msgs')||'[]');" +
  "var last=msgs.length?msgs[msgs.length-1]:null;" +
  "return JSON.stringify({listText:listText,lastText:last?last.text:null,lastSide:last?last.side:null,panelClosed:document.getElementById('batch-panel').hidden});" +
  "})()");
await sleep(400);
const ss = JSON.parse(sendTest || '{}');
check('批量面板添加文字条目', (ss.listText || '').indexOf('群聊批量测试') >= 0, sendTest);
check('批量发送全部 → 群聊消息落库（text/side=out）', ss.lastText === '群聊批量测试' && ss.lastSide === 'out', sendTest);
check('批量发送后面板关闭', ss.panelClosed === true, 'closed=' + ss.panelClosed);

// ③ 点击群聊麦克风按钮 → 录音面板打开
const voiceOpen = await evalJs("(function(){" +
  "var btn=document.getElementById('gc-mic-btn');" +
  "var panel=document.getElementById('voice-panel');" +
  "if(!btn||!panel)return 'missing';" +
  "btn.click();" +
  "return JSON.stringify({btnDisplay:getComputedStyle(btn).display,panelHidden:panel.hidden});" +
  "})()");
await sleep(300);
const vs = JSON.parse(voiceOpen || '{}');
check('点击群聊麦克风按钮打开录音面板', vs.panelHidden === false && vs.btnDisplay !== 'none', voiceOpen);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

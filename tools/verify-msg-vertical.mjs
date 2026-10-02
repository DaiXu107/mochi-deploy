// ===== 验证脚本：#817 发出消息「变竖排（一字一行）」修复（无头 Chrome，构建后产物） =====
// 用法：node build.mjs && node tools/verify-msg-vertical.mjs
//   红对照（未含本批的旧产物）：MOCHI_VERIFY_ROOT=<旧产物目录> node tools/verify-msg-vertical.mjs
//   期望旧产物恰红 A1/A2/B1/B3（内容层空格保护＋撤规则契约面）；B2/B4/B5 双侧同绿（横排/溢出/换行零回退）。
// 断言设计：
//   A1/A2 fs 级锚点：产物 js/chat.js 有 escTxtBr 多空格→&nbsp; 转义；index.html 无气泡 span 全局 pre-wrap 规则。
//   B1 双空格消息渲染后 innerHTML 含 &nbsp;&nbsp;（空格保护在内容层、不靠 CSS）。
//   B2 短消息气泡横排不塌：宽>高、Range 行数=1（竖排=宽塌成一字高堆多行，必红）。
//   B3 气泡正文 span 计算样式 white-space 不再是 pre-wrap（撤销全局规则的契约面）。
//   B4 长英文 token（无空格 60+ 字符）仍在气泡内换行不溢出（word-break 保护零回退）。
//   B5 含 \n 的多行消息仍逐行渲染（escTxtBr \n→<br> 语义零回退）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_VERIFY_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 220) + ']' : ''));
}

// ---------- A：fs 级锚点 ----------
let html = '';
try { html = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
// chat.js 属内联 core（不在 35 外置清单）——兼容读 js/chat.js，读不到就用 index.html 本体
let chatJs = '';
try { chatJs = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
if (!chatJs) chatJs = html;
check('A1 内容层空格保护在位（escTxtBr 多空格→等量 &nbsp;）', chatJs.includes(".replace(/ {2,}/g, m => '&nbsp;'.repeat(m.length))"));
check('A2 气泡正文 span 全局 pre-wrap 规则已撤（absent 型，回流即红）', html.length > 0 && !html.includes('.msg-bubble > span { white-space:pre-wrap; }'));

// ---------- 浏览器夹具（同 verify-chat-send-btn 口径） ----------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-msg-vertical-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  console.error('无法连接无头浏览器'); process.exit(1);
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  eval 异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 200)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 721, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
await evalJs(`(function(){
  document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});
  try{var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('rn-prob','0');st.set('as-en','0');st.set('chat-msgs','[]');}catch(e){}
  return true;
})()`);
await sleep(500);

async function send(text) {
  await evalJs(`(function(){
    var inp=document.getElementById('chat-input');
    inp.textContent=${JSON.stringify(text)};
    var btn=document.getElementById('chat-send');
    btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
    btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
    btn.click();
    return true;
  })()`);
  await sleep(800);
  return await evalJs(`(function(){
    var list=document.querySelectorAll('#chat-body .msg-out, .msg.msg-out');
    var last=list[list.length-1];
    if(!last) return JSON.stringify({err:'no out msg'});
    var b=last.querySelector('.msg-bubble'); if(!b) return JSON.stringify({err:'no bubble'});
    var sp=b.querySelector('span')||b;
    var rng=document.createRange(); rng.selectNodeContents(sp);
    var tops={}; Array.prototype.forEach.call(rng.getClientRects(),function(r){ if(r.width>0&&r.height>0) tops[Math.round(r.top)]=1; });
    var cs=window.getComputedStyle(sp);
    return JSON.stringify({
      textContent: sp.textContent,
      innerHTML: sp.innerHTML.slice(0, 200),
      bubW: Math.round(b.getBoundingClientRect().width), bubH: Math.round(b.getBoundingClientRect().height),
      lines: Object.keys(tops).length, ws: cs.whiteSpace,
      overflowX: b.scrollWidth - b.clientWidth
    });
  })()`);
}

// B1：双空格消息——渲染 HTML 应含 &nbsp;&nbsp;（内容层保护；旧版直出普通空格靠 CSS 防折叠，红）
const r1 = JSON.parse(await send('你好吗  谢谢') || '{}');
check('B1 双空格发出后按内容层转义为不间断空格对（innerHTML 含 &nbsp;&nbsp;）', /(&nbsp;){2}/.test(r1.innerHTML || ''), JSON.stringify(r1).slice(0, 160));
// B2：横排不塌——宽>高、单行（竖排＝宽塌到一字、行数=字数，必红）
check('B2 短消息气泡横排（宽>高 且 单行，不是一字一行）', r1.bubW > r1.bubH && r1.lines === 1, JSON.stringify(r1).slice(0, 160));
// B3：契约面——气泡正文 span 不再被全局 pre-wrap
check('B3 气泡正文 span 计算样式 white-space 不再是 pre-wrap', !!r1.ws && r1.ws !== 'pre-wrap', r1.ws);
await sleep(2300);
// B4：长英文 token 溢出保护零回退（word-break/anywhere 家族仍在）
const r4 = JSON.parse(await send('https://example.com/very/long/path/' + 'A'.repeat(48)) || '{}');
check('B4 长 URL 消息在气泡内换行不横向溢出（scrollWidth<=clientWidth）', r4.lines >= 2 && r4.overflowX <= 2, JSON.stringify(r4).slice(0, 160));
await sleep(2300);
// B5：\n→<br> 多行语义零回退
const r5 = JSON.parse(await send('第一行\n第二行') || '{}');
check('B5 含换行符消息仍两行渲染', r5.lines === 2 && /第一行[\s\S]*第二行/.test(r5.textContent || ''), JSON.stringify(r5).slice(0, 160));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

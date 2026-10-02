// ===== 常驻回归脚本 #930：回前台聊天贴底复核闸（Vivo Y35/摩托罗拉 G100 等报「回到应用停在几分钟前的消息」）=====
// 用法：node tools/verify-chat-resume-repin.mjs [被测根目录]
// 缺陷形态（零机型分支）：保活应用常驻数天，回前台不经过 enterChat（#742 复位只在点图标进聊天时触发）——
// ①后台期间贴底写入被内核冻结节流丢失；②离场前在历史位（解钉态）的用户重开应用永远停在旧位置。
// 修法：visibilitychange/pageshow 回场分档——离场>60s 视同重新进聊天（复位钉住回底）；≤60s 仅在
// 仍钉住且落定后离底>8px 时补一枪；#162（用户翻历史不打扰）零改动。
// 断言：
//   A0 前置：聊天页贴底。
//   A1 短离场＋解钉态回场：不被拽回（#162 契约保持，仍在历史位）。
//   A2 长离场（override 65s）＋解钉态回场：350ms 落定后回底＝本批修复面。
//   A3 长离场＋钉住态离底（模拟后台丢写）：回场补钉到底。
//   A4 短离场＋钉住贴底：保持贴底零折腾。
//   S1/S2 产物锚（js/chat.js）。
//   Z1 全程零 JS 异常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : '')); }
let product = '';
try { product = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { product += readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
check('S1 回场复核闸声明在位', product.includes('function chatResumeRepin()'));
check('S2 回场分派（visibilitychange）在位', product.includes("else chatResumeRepin();"));

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-924-' + Date.now()), '--remote-debugging-port=' + (Number(process.env.MOCHI_CDP_PORT) || 9317), 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsErrors = [];
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort() + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErrors.push(String(m.params.exceptionDetails.text || '').slice(0, 120)); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('no cdp');
}
function cdpPort() { return Number(process.env.MOCHI_CDP_PORT) || 9317; }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 160)); return null; }
  return r && r.result ? r.result.value : null;
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 772, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: 6 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(1000);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(800);
// 静音备份提醒/版本条（回前台事件会真实触发它们）
await evalJs("(function(){var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}return true;})()");

// 种 320 条历史（含少量图＝常见形态）
await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return true;})()");
await sleep(300);
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(300);
await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(800);
await evalJs("(function(){var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));st.set('cs-rp-auto-prob','0');const now=Date.now();const arr=[];for(let i=0;i<320;i++){const r={side:i%2?'in':'out',text:'记录'+String(i).padStart(3,'0'),ts:now-(320-i)*60000};if(i>=314)r.img='/s'+i+'.png';arr.push(r);}st.set('chat-msgs',JSON.stringify(arr));return true;})()");
await sleep(400);
// 进聊天
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
await sleep(3000);
// 进入/回场驱动器：覆写 visibilityState（恢复原描述符）后派发事件＝事件契约的等效注入
const GO = (state, ageMs) => `(function(){
  try {
    if (${JSON.stringify(state)} === 'hidden') { window.__origVS = Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') || Object.getOwnPropertyDescriptor(document,'visibilityState'); }
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return ${JSON.stringify(state)};}});
    window.__chatHiddenAgeMs = ${ageMs === null ? 'null' : ageMs};
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const BACK = `(function(){
  try {
    if (window.__origVS) { Object.defineProperty(document,'visibilityState',window.__origVS); window.__origVS = null; }
    else { delete document.visibilityState; }
    document.dispatchEvent(new Event('visibilitychange'));
    delete window.__chatHiddenAgeMs; // 派发之后再清＝产品在 visible 分支读 override
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const SNAP = `(function(){
  var b=document.getElementById('chat-body');
  if(!b)return JSON.stringify({err:1});
  return JSON.stringify({top:Math.round(b.scrollTop),gap:Math.round(b.scrollHeight-b.scrollTop-b.clientHeight),sh:b.scrollHeight,ch:b.clientHeight});
})()`;
const atBottom = () => sleep(800); const settleLong = () => sleep(6500); // 6x 节流下 350ms 定时器实测 >2.1s；#976 起回场写入改走「几何落定锁」（350+120ms 两跳 ≈2.8~3.5s），窗口随之放宽——落定后回底的断言意图不变

// A0
let s = JSON.parse(await evalJs(SNAP) || '{}');
check('A0 前置：聊天页在贴底', !s.err && Math.abs(s.gap) <= 8, 'gap=' + s.gap);

// A1 短离场＋解钉：上翻到中部 → hidden 2s → visible → 不拽回
// #976 注：必须补 touchend——touchstart 会把 chatTouchActive 置真（#716 手势闸），真机上手指必然
// 抬起（touchend/touchcancel 到达），脚本不补就是永久卡真的伪影态；#976 起回场写入改走「几何落定
// 锁」（chatRepinQuietEnough 含 !chatTouchActive），卡真会让 A2/A3 的落定枪永远让路。dy=0 且不在底
// ⇒ touchend 的轻点回底写不触发，A1 断言语义不变。
await evalJs(`(function(){
  var b=document.getElementById('chat-body');
  try { var t=new Touch({identifier:1,target:b,clientX:100,clientY:600}); b.dispatchEvent(new TouchEvent('touchstart',{touches:[t],targetTouches:[t],changedTouches:[t],bubbles:true,cancelable:true})); } catch(e){ b.dispatchEvent(new Event('touchstart',{bubbles:true})); }
  b.scrollTop = Math.max(0, b.scrollHeight - b.clientHeight - 800);
  try { var t2=new Touch({identifier:1,target:b,clientX:100,clientY:600}); b.dispatchEvent(new TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[t2],bubbles:true,cancelable:true})); } catch(e){ b.dispatchEvent(new Event('touchend',{bubbles:true})); }
  return true;
})()`);
await sleep(200);
await evalJs(GO('hidden', null));
await sleep(2000);
await evalJs(BACK);
await atBottom();
s = JSON.parse(await evalJs(SNAP) || '{}');
check('A1 短离场＋解钉态回场不被拽底（#162 保持）', !s.err && s.gap > 300, 'gap=' + s.gap);

// A2 长离场＋解钉态：hidden（age 65s）→ visible → 落定后回底＝修复面
await evalJs(GO('hidden', 65000));
await sleep(500);
await evalJs(BACK);
await settleLong();
s = JSON.parse(await evalJs(SNAP) || '{}');
check('A2 长离场回场视同重新进聊天＝回底', !s.err && Math.abs(s.gap) <= 8, 'gap=' + s.gap);

// A3 长离场＋钉住态离底（后台丢写形态）：置回中部（钉住保持）→ hidden(age 65s) → visible → 回底
await evalJs("(function(){var b=document.getElementById('chat-body');b.scrollTop=Math.max(0,b.scrollHeight-b.clientHeight-800);return true;})()");
await sleep(150);
await evalJs(GO('hidden', 65000));
await sleep(500);
await evalJs(BACK);
await settleLong();
s = JSON.parse(await evalJs(SNAP) || '{}');
check('A3 长离场钉住态离底回场补钉', !s.err && Math.abs(s.gap) <= 8, 'gap=' + s.gap);

// A4 短离场＋钉住贴底：零折腾
await evalJs(GO('hidden', null));
await sleep(800);
await evalJs(BACK);
await atBottom();
s = JSON.parse(await evalJs(SNAP) || '{}');
check('A4 短离场钉住贴底零折腾', !s.err && Math.abs(s.gap) <= 8, 'gap=' + s.gap);

check('Z1 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

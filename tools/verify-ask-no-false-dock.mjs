// ===== 验证：问问TA面板打开（触摸后程序化聚焦）是否误触发 _aProvDock 假停靠 =====
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-askdock-' + Date.now()),
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 600)); return null; }
  return r && r.result ? r.result.value : null;
}
async function touchAt(x, y) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const ph = () => evalJs(`(function(){var p=document.querySelector('.phone');var r=p.getBoundingClientRect();return JSON.stringify({h:p.style.height||'(none)',rectH:Math.round(r.height),align:p.style.alignSelf||'(none)'});})()`);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);
await evalJs(`(function(){var b=document.getElementById('splash-confirm-ok')||document.getElementById('splash-enter');if(b)b.click();return !!b;})()`);
await sleep(400);
// #384 强制公告：滑到底 + 确认（splash 若已被兜底隐藏则此层随隐藏，循环立即 none）
for (let i = 0; i < 20; i++) {
  const r = await evalJs(`(function(){
    var m = document.getElementById('splash-mandatory');
    if (!m || m.hidden) return 'none';
    var sc = document.getElementById('splash-mandatory-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
    var en = document.getElementById('splash-mandatory-enter');
    if (en && !en.classList.contains('is-disabled')) { en.click(); return 'entered'; }
    return 'wait';
  })()`);
  if (r === 'entered' || r === 'none') break;
  await sleep(250);
}
await sleep(300);
// #129 修正：开屏隐藏走应用自己的 .hide class（clock.js 口径）——hidden 属性会被作者 CSS
// 覆盖（同 .cc-tab[hidden] 教训），残留 splash-box 盖住全页致输入框矩形为 0、触摸打在开屏上
await evalJs(`(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}return true;})()`);
await sleep(200);
// #129 修正：联系人选择遮罩（cc-scope-mask）不点掉会拦住后续一切真实触摸（同 wallet-edit loadApp 先例）
await evalJs(`(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();return 'mask-ok';}return 'no-mask';})()`);
await sleep(300);

console.log('初始 .phone: ' + await ph());

// #129 修正：导航三跳（聊天页→更多→问问TA）改程序化 click——被测行为是「输入框聚焦且无键盘时
// 真实触摸触发保底停靠」，不是 UI 导航；真实触摸链在无头里过脆弱（更多面板未开时 more-ask 矩形为 0）
await evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return true;})()`);
await sleep(900);
await evalJs(`(function(){var b=document.getElementById('more-ask');if(b)b.click();return true;})()`);
await sleep(500);
// 兜底聚焦（应用自身会在触摸后程序化聚焦，此处保险补一拍）
await evalJs(`(function(){var i=document.getElementById('chat-ask-input');if(i&&i.focus)i.focus();return true;})()`);
console.log('打开面板后 .phone: ' + await ph());
console.log('聚焦元素: ' + await evalJs(`(function(){var a=document.activeElement;return a?a.tagName+'#'+(a.id||''):'none';})()`));

// 等 _aProvCheck 的 950/1700ms 复查拍过去
await sleep(1600);
const dockState1 = await evalJs(`(function(){var p=document.querySelector('.phone');return p.style.height || '(none)';})()`);
console.log('1.6s后 .phone（无键盘场景，应保持满高）: ' + dockState1);

// 再模拟：真实触摸问题框（已聚焦的框再点一下）→ 仍无键盘
const r2p = await evalJs(`(function(){var i=document.getElementById('chat-ask-input');var b=(i.__ceBox||i).getBoundingClientRect();return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)});})()`);
const rc2 = JSON.parse(r2p);
await touchAt(rc2.x, rc2.y);
await sleep(1400);
const dockState2 = await evalJs(`(function(){var p=document.querySelector('.phone');return p.style.height || '(none)';})()`);
console.log('触摸问题框1.4s后 .phone: ' + dockState2);

// 对照：真实键盘路径——touch 聚焦后 vv 收缩（正常内核），应正常收缩且恢复
await evalJs(`(function(){var vv=window.visualViewport;if(!vv.__patched){var h=vv.height;Object.defineProperty(vv,'height',{get:function(){return h;},configurable:true});window.__setVvHeight=function(v){h=v;vv.dispatchEvent(new Event('resize'));};vv.__patched=1;}return true;})()`);
await evalJs('window.__setVvHeight(430)');
await sleep(600);
const dockState3 = await evalJs(`(function(){var p=document.querySelector('.phone');return p.style.height || '(none)';})()`);
console.log('模拟键盘430px后 .phone: ' + dockState3);
await evalJs('window.__setVvHeight(844)');
await sleep(600);
const dockState4 = await evalJs(`(function(){var p=document.querySelector('.phone');return p.style.height || '(none)';})()`);
console.log('键盘收起后 .phone: ' + dockState4);

// ===== 判定 =====
// 修复口径：①打开面板（触摸按钮→程序化聚焦，无键盘）.phone 必须保持满高（修复前 1.6s 后被假收缩到 490）；
//          ②用户直接触摸输入框（无软键盘环境）不盲推停靠（#387 实测被盖闸；悬浮键盘真停靠由 verify-kb-prov-covered 断言）；
//          ③真实键盘 vv 收缩原机制接管 430；④收起恢复满高。
const r1 = dockState1 === '(none)';
const r2 = dockState2 === '(none)';
const r3 = dockState3 === '430px';
const r4 = dockState4 === '(none)';
console.log((r1 ? 'PASS' : 'FAIL') + '  面板程序化聚焦不假停靠（.phone=' + dockState1 + '）');
console.log((r2 ? 'PASS' : 'FAIL') + '  直接触摸输入框无键盘不盲推停靠（.phone=' + dockState2 + '，#387 实测被盖闸契约；真停靠见 verify-kb-prov-covered）');
console.log((r3 ? 'PASS' : 'FAIL') + '  真实 vv 收缩原机制接管（.phone=' + dockState3 + '）');
console.log((r4 ? 'PASS' : 'FAIL') + '  键盘收起恢复满高（.phone=' + dockState4 + '）');
const pass = r1 && r2 && r3 && r4;
console.log('\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + [r1, r2, r3, r4].filter(Boolean).length + '/4');
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);

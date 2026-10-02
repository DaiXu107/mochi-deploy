// ===== #1504 界面级回归：顶住只限打字中（收起键盘 ≤1.2s 回底）＋键盘间隙轴 ±80 =====
// 背景（作者实报＋截图，2026-09-30 晚）：#1486「实测在场必顶住」在这族 Edge（GT7/K80/OPPO Find X8s）
// 上＝收起键盘后页面被按在停靠高度数秒（Edge 收起不发任何信号、vk 也停在旧值）＝「输入栏消失几秒/
// 白屏」回归；本批把顶住收紧为「打字中」（_aLastAct<1200ms），一停手即收口回底。轴 ±40→±80。
// 判别核心：B3 停止触摸后 ≤2.5s 必须收口（纯 #1486 永久顶住＝必红）＋B4 轴 80 生效（纯 #1486 RANGE
// 拒收＝必红）。夹具：假 vv 全高＝innerHeight＝844；假 vk；触摸+keydown(229) 续期 _aLastAct。
// 用法：node tools/verify-1504-kb-close-fast.mjs（量当前产物）；MOCHI_ROOT=<副本> 量别版
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const PAGE = '/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 200) + ']' : ''));
}

function rd(p) { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } }
const jsMA = rd('js/mobile-adapt.js');
const jsPe = rd('js/personalize.js');
check('S1 打字活动窗口·主链（900/650 皆认）', jsMA.includes('_aUserTypos < 900)) { var _hHold') || jsMA.includes('_aUserTypos < 650)) { var _hHold'));
check('S2 vk 归零绕过毛刺窗', jsMA.includes('&& !(_aVkHonest && _aVkH >= 0 && _aVkH < 80))'));
check('S3 轴量程 ±80·装载钳', jsMA.includes('kbgap: [-240, 240]'));
check('S4 轴量程 ±80·安卓消费钳', jsMA.includes('return a ? Math.max(-240, Math.min(240, Math.round(+a.kbgap || 0))) : 0;'));
check('S5 轴量程 ±80·面板滑杆', jsPe.includes("min: -240, max: 240,"));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const fail2 = (msg) => { try { require('node:fs').writeSync(2, msg + '\n'); } catch (e) {} };
if (!browserPath) { fail2('找不到 Edge/Chrome，请设置 CHROME_PATH'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (30700 + Math.floor(Math.random() * 300));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1504-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const EVAL_ERRS = [];
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
  fail2('无法连接无头浏览器'); process.exit(2);
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      const d = String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 240);
      EVAL_ERRS.push(d);
      console.log('  [eval err] ' + d);
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const FAKE_VV = `(function(){
  var vv = { height: 844, width: 390, scale: 1, offsetTop: 0, offsetLeft: 0, _ls: {},
    addEventListener: function (t, f) { (vv._ls[t] = vv._ls[t] || []).push(f); },
    removeEventListener: function () {},
    scrollTo: function () {},
    dispatch: function (t) { (vv._ls[t] || []).slice().forEach(function (f) { try { f(); } catch (e) {} }); } };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: function () { return vv; } });
  window.__fakeVV = vv;
  return 1;
})()`;

const FAKE_VK = `(function(){
  var vk = { overlaysContent: false, boundingRect: { x: 0, y: 488, width: 390, height: 356 }, _ls: {},
    addEventListener: function (t, f) { (vk._ls[t] = vk._ls[t] || []).push(f); },
    removeEventListener: function () {},
    dispatch: function () { (vk._ls.geometrychange || []).slice().forEach(function (f) { try { f({}); } catch (e) {} }); } };
  try { Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, get: function () { return vk; } }); } catch (e) {}
  window.__fakeVK = vk;
  return 1;
})()`;

async function boot() {
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_VV });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_VK });
  await cdp('Page.navigate', { url: baseUrl + PAGE });
  await sleep(2500);
  for (let i = 0; i < 90; i++) {
    const ok = await evalJs("(function(){return typeof window.mochiScreenAdj==='object' && !!window.__fakeVV && !!window.__fakeVK && !!document.querySelector('.phone');})()");
    if (ok) return true;
    await sleep(300);
  }
  return false;
}

async function pollH(expect, timeoutMs) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < (timeoutMs || 6000)) {
    last = await evalJs("(function(){var p=document.querySelector('.phone');return p?p.style.height:null;})()");
    if (last === expect) return true;
    await sleep(150);
  }
  console.log('  [poll timeout] 期望 ' + expect + '，实际 ' + last);
  return false;
}
const H = "(function(){var p=document.querySelector('.phone');return p?p.style.height:null;})()";

await cdpConnect();
const booted = await boot();
if (!booted) { fail2('页面未就绪'); browser.kill(); process.exit(2); }
await cdp('Page.bringToFront');
await sleep(300);
await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
// 夹具：编辑框＋「打字续期」定时器（touchstart＋keydown 229 双保险续 _aLastAct）
await evalJs("(function(){var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='v1504-ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('v1504-ed');if(!t)return;if(document.activeElement!==t){try{t.focus();}catch(e2){}}},400);return 1;})()");

// ---- B1 overlay 会话开启＋实测停靠：360 开 → 844 全高（顶住）→ vk 356 → 488 ----
await evalJs("(function(){window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const b1a = await pollH('360px', 6000);
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(600);
const b1b = await evalJs(H);
await evalJs("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
const b1 = await pollH('488px', 4000);
check('B1 打字中：实测停靠 488px 稳定顶住（两侧同绿）', b1a && b1b === '360px' && b1, { open: b1a, hold: b1b, vk: b1 });

// ---- B2 打字中不收口：显式 3 连按键后 800ms（<900ms 窗）仍停靠 ----
await evalJs("(function(){var t=document.getElementById('v1504-ed');if(!t)return 2;for(var i=0;i<3;i++){try{t.dispatchEvent(new KeyboardEvent('keydown',{keyCode:229,bubbles:true}));}catch(e){}}return 1;})()");
await sleep(500);
const b2 = await evalJs(H);
check('B2 按键后 500ms 仍停靠（打字窗口内不误收）', b2 === '488px', b2);

// ---- B3 停手即收：清定时器＋1.4s 后必须已收口（纯 #1486 永久顶住＝必红） ----
await evalJs("(function(){clearInterval(window.__arm);window.__arm=null;return 1;})()");
const b3 = await pollH('', 3000);
check('B3 停止交互后 ≤2.5s 收口回底（白屏/输入栏消失数秒的回归根除；纯 #1486 必红）', b3);

// ---- B4 轴 ±80：重开会话，set(80) 生效 dock=568（纯 #1486 RANGE 拒收＝必红） ----
await evalJs("(function(){var t=document.getElementById('v1504-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__arm=setInterval(function(){var t2=document.getElementById('v1504-ed');if(!t2)return;try{t2.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e3){}if(document.activeElement!==t2){try{t2.focus();}catch(e4){}}},600);window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const b4a = await pollH('360px', 6000);
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(400);
await evalJs("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
const b4b = await pollH('488px', 4000);
const b4c = await evalJs("(function(){return window.mochiScreenAdj.set('kbgap',80);})()");
const b4 = await pollH('568px', 3000);
check('B4 kbgap=80 生效 dock 568px（±80 扩程；纯 #1486 拒收停 488＝必红）', b4a && b4b && b4c === true && b4, { open: b4a, vk: b4b, set: b4c });

// ---- B5 负向 −80 → 408（两侧同绿：绿侧生效；红侧 −80 同样拒收＝B4 已判别） ----
await evalJs("(function(){window.mochiScreenAdj.set('kbgap',-80);return 1;})()");
const b5 = await pollH('408px', 3000);
check('B5 kbgap=-80 生效 dock 408px', b5);

// ---- B6 失焦即收（两侧同绿） ----
await evalJs("(function(){window.mochiScreenAdj.set('kbgap',0);var d=document.getElementById('v1504-ed');if(d&&d.blur)d.blur();return 1;})()");
const b6 = await pollH('', 3000);
check('B6 失焦即收口复原', b6);

// ---- B7 点页面不续期：打字建立会话后只触摸（无按键）→ 2s 后应已收口（纯 #1492 触摸也续期＝必红） ----
await evalJs("(function(){var t=document.getElementById('v1504-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(1200);
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(300);
await evalJs("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
await sleep(800);
await evalJs("(function(){window.__arm=setInterval(function(){var t=document.getElementById('v1504-ed');if(!t)return;try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}},500);return 1;})()");
await sleep(2000);
const b7 = await evalJs(H);
check('B7 只触摸不按键＝不续期：2s 后已收口（纯 #1492 触摸续期必红）', b7 === '', b7);
await evalJs("(function(){clearInterval(window.__arm);window.__arm=null;return 1;})()");

// ---- B8 vk 实测归零＝收起铁证快收（纯 #1492 还要吃 800ms 毛刺窗＝必红） ----
await evalJs("(function(){var t=document.getElementById('v1504-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
await pollH('360px', 6000);
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(300);
await evalJs("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();var t=document.getElementById('v1504-ed');if(t){try{t.dispatchEvent(new KeyboardEvent('keydown',{keyCode:229,bubbles:true}));}catch(e){}}return 1;})()");
await pollH('488px', 4000);
const t8 = Date.now();
await evalJs("(function(){window.__fakeVK.boundingRect.height=0;window.__fakeVK.dispatch();return 1;})()");
const b8 = await pollH('', 3000);
check('B8 vk 归零快收：≤1s 收口（纯 #1492 吃 800ms 毛刺窗＝必红）', b8 && Date.now() - t8 <= 1000, { closed: b8, ms: Date.now() - t8 });

check('Z1 全程零 JS 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 2));

const pass = results.filter((x) => x.ok).length;
console.log('\n#1504 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
browser.kill();
server.close();
process.exit(results.length - pass === 0 ? 0 : 1);

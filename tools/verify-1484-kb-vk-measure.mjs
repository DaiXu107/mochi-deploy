// ===== #1484 界面级回归：overlay 会话 VirtualKeyboard 实测尺＋迟滞按交互自适应（GT7 Edge 153 复报批） =====
// 背景（GT7 第二轮诊断单，2026-09-30 14:03）：#1481 后快照环 4×[open,1,640,284px]——会话开着、内核
// 把可视视口弹回全高且**持续**全高（不是毛刺，是 overlay 模型）：弹出瞬时报一次收缩（284＝真实键盘
// 上沿），随后全高覆盖、键盘继续可见。#1481 的 800ms 迟滞把「持续全高」判成收键盘＝拆会话＝输入栏
// 沉回键盘下（遮挡）；用户再点 → 重开 → 顶住 → 800ms → 又拆……＝「空白↔遮挡反复切换」的残余节奏。
// 修法（mobile-adapt.js，判据零机型）：①overlay 签名（会话中回弹全高且仍聚焦）→ 武装 VirtualKeyboard
// 实测尺（overlaysContent＋geometrychange，Chromium 94+），钉高/对账改用「base−实测高度」＝精确停靠、
// 随输入法工具栏伸缩实时跟随；实测 <80px＝键盘真收（走迟滞复原），会话收口解除武装；②双稳态内核
// （_aOsc：全高回弹后又见过收缩读数）的迟滞按交互自适应——用户仍在交互（_aLastAct<2500ms）不拆会话。
// 无头要点：假 vv 全高＝innerHeight＝844；假 VirtualKeyboard 可派 geometrychange；bringToFront 先行
// （无焦点吞 focusin，verify-1472/1481 同课）。
// 用法：node tools/verify-1484-kb-vk-measure.mjs（量当前产物）；MOCHI_ROOT=<副本> 量别版
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
check('S1 实测高度取值口（删＝overlay 会话继续猜）', jsMA.includes('_aKbStableH = _mv; _aFullSince = 0; return _mv;'));
check('S2 实测尺武装（删＝GT7 类内核永远在猜）', jsMA.includes('_aVkHonest = true;'));
check('S3 实测归零即时真收信号（删＝关闭回弹拖 800ms 不及时）', jsMA.includes('else if (_aVkH < 80 && _aVkSeen && !_aFullSince) _aFullSince = 1;'));
check('S4 overlay 签名武装实测尺（删＝GT7 类内核永远在猜）', jsMA.includes('if (_aFullReads >= 3 && !_aHonestSession) _aKbVkArm();'));
check('S5 主链收口解除武装（删＝overlaysContent 残留）', jsMA.includes("navigator.virtualKeyboard.removeEventListener('geometrychange', _aVkListener)"));
check('S6 轮询腿收口解除武装（删＝overlaysContent 残留）', jsMA.includes('_aVkListener = _applyVk;'));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (30100 + Math.floor(Math.random() * 300));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1484-' + Date.now()),
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
// 无窗口焦点时 Chromium 吞 focusin（verify-1472/1481 同课）——先带前台再动夹具
await cdp('Page.bringToFront');
await sleep(300);
await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
await evalJs("(function(){var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='v1484-ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('v1484-ed');if(!t)return;try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}if(document.activeElement!==t){try{t.focus();}catch(e2){}}},600);return 1;})()");

// ---- U1 overlay 签名＋实测停靠：开启 360 → 回弹 844（毛刺顶住）→ 实测尺报 356 → 钉 488（纯 HEAD 无实测＝必红） ----
await evalJs("(function(){window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const u0 = await pollH('360px', 6000);
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(600);
const u0b = await evalJs(H);
await evalJs("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
const u1 = await pollH('488px', 4000);
check('U1 overlay 签名武装＋实测停靠 488px（844−356；纯 HEAD 停 360＝必红；#1522 起武装当场读一次实测高度，瞬时 360 不再是契约）', u0 && u1, { open: u0, hold: u0b, vk: u1 });

// ---- U2 实测尺随高跟随：输入法工具栏展开 356→420 → 424px（纯 HEAD 必红） ----
await evalJs("(function(){window.__fakeVK.boundingRect.height=420;window.__fakeVK.dispatch();return 1;})()");
const u2 = await pollH('424px', 4000);
check('U2 实测高度实时跟随 424px（844−420；纯 HEAD 必红）', u2);

// ---- U3 实测归零＝键盘真收：≤3s 复原（两侧同绿；新版实测信号走迟滞） ----
await evalJs("(function(){window.__fakeVK.boundingRect.height=0;window.__fakeVK.dispatch();return 1;})()");
const t0u3 = Date.now();
const u3 = await pollH('', 1500);
check('U3 实测归零即时真收：1.5s 内复原（关闭回弹及时；两侧同绿）', u3, { ms: Date.now() - t0u3 });

// ---- U4 会话收口解除武装（overlaysContent 还原 false，两侧同绿） ----
const u4 = await evalJs("(function(){return {oc: window.__fakeVK.overlaysContent, h: document.querySelector('.phone').style.height};})()");
check('U4 收口解除武装：overlaysContent 还原 false（两侧同绿）', u4 && u4.oc === false, u4);

check('Z1 全程零 JS 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 2));

const pass = results.filter((x) => x.ok).length;
console.log('\n#1484 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
browser.kill();
server.close();
process.exit(results.length - pass === 0 ? 0 : 1);

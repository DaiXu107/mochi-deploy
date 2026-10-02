// ===== #1506 界面级回归：顶住只限打字中（收起键盘 ≤1.2s 回底）＋键盘间隙轴 ±80 =====
// 背景（作者实报＋截图，2026-09-30 晚）：#1486「实测在场必顶住」在这族 Edge（GT7/K80/OPPO Find X8s）
// 上＝收起键盘后页面被按在停靠高度数秒（Edge 收起不发任何信号、vk 也停在旧值）＝「输入栏消失几秒/
// 白屏」回归；本批把顶住收紧为「打字中」（_aLastAct<1200ms），一停手即收口回底。轴 ±40→±80。
// 判别核心：B3 停止触摸后 ≤2.5s 必须收口（纯 #1486 永久顶住＝必红）＋B4 轴 80 生效（纯 #1486 RANGE
// 拒收＝必红）。夹具：假 vv 全高＝innerHeight＝844；假 vk；触摸+keydown(229) 续期 _aLastAct。
// 用法：node tools/verify-1506-kb-tapout-close.mjs（量当前产物）；MOCHI_ROOT=<副本> 量别版
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
check('S1 点消息区＝收口意图（删＝收起后空白要等超时）', jsMA.includes("_aKbCloseNow('tap-out')"));
check('S2 vk 归零绕过毛刺窗仍在（#1521 收敛后＝实测尺三态：≥80 顶住／<80 且本会话实测过＝真收口／未实测到过＝等它报）', jsMA.includes('return _aVkHonest ? (_aVkH >= 80 || !_aVkSeen) : !_aHonestSession;'));
check('S3 收口取证写点', jsMA.includes('window.__mochiKbClose = { path: path'));
check('S4 轴量程 ±240·安卓消费钳（#1527 从 ±80 放宽）', jsMA.includes('return a ? Math.max(-240, Math.min(240, Math.round(+a.kbgap || 0))) : 0;'));
check('S5 轴 ±80 面板仍在', jsPe.includes('min: -80, max: 80,'));

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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1506-' + Date.now()),
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
await evalJs("(function(){var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='v1506-ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('v1506-ed');if(!t)return;if(document.activeElement!==t){try{t.focus();}catch(e2){}}},400);return 1;})()");

// ---- B1 overlay 会话开启＋实测停靠：360 开 → 844 全高（顶住）→ vk 356 → 488 ----
await evalJs("(function(){window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const b1a = await pollH('360px', 6000);
// overlay 内核的正确模型＝瞬时收缩后立刻全高（会话 <400ms，不判诚实）→ B 型顶住 → 实测尺接管
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
const b1b = await evalJs(H);
await evalJs("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
const b1 = await pollH('488px', 4000);
check('B1 overlay 内核（瞬时收缩后全高、vk 接管）：实测停靠 488px 稳定顶住', b1a && b1b === '360px' && b1, { open: b1a, hold: b1b, vk: b1 });

// ---- U1 打字中点消息区＝立即收口（红侧无此监听＝仍停靠必红）
// 注：目标取 firstElementChild —— firstChild 是空白文本节点，事件派上去 closest 不存在，监听永不匹配（旧码靠 650ms 窗口过期误绿，收敛后暴露）----
await evalJs("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();var t=document.getElementById('v1506-ed');if(t){try{t.dispatchEvent(new KeyboardEvent('keydown',{keyCode:229,bubbles:true}));}catch(e){}}return 1;})()");
const u1a = await pollH('488px', 4000);
const t0u = Date.now();
await evalJs("(function(){var cb=document.getElementById('chat-body');if(!cb)return 'no-chatbody';var t=document.getElementById('v1506-ed');var prox=(t&&t.parentNode)?null:cb;var tgt=cb.firstElementChild||cb;try{tgt.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}return 'tapped';})()");
const u1 = await pollH('', 1500);
check('U1 打字中点消息区：当场收口（页面侧同步；红侧无监听靠窗口过期＝必红）', u1a && u1, { docked: u1a, closed: u1, ms: Date.now()-t0u });
const u2 = await evalJs("(function(){return window.__mochiKbClose?JSON.stringify(window.__mochiKbClose):'none';})()");
check('U2 收口取证读数（path=tap-out）', u2 && u2.indexOf('tap-out') >= 0, u2);

// ---- U3 诚实内核收敛契约：会话内持续收缩＞400ms 后全高读数＝真收口 → ≤2s 回位（纯 tip 必红） ----
await evalJs("(function(){var t=document.getElementById('v1506-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const u3a = await pollH('360px', 6000);
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(700);
await evalJs("(function(){var t=document.getElementById('v1506-ed');if(t){try{t.dispatchEvent(new KeyboardEvent('keydown',{keyCode:229,bubbles:true}));}catch(e){}}return 1;})()");
const u3b = await pollH('', 2500);
check('U3 诚实内核（会话内持续收缩＞400ms）：全高读数＝真收口，≤2s 回位（#1521 收敛契约；纯 tip 必红）', u3a && u3b, { open: u3a, closed: u3b });

// ---- U3b 零信号内核（B 型）：持续全高 1.2s 仍顶住不展开，失焦后回位 ----
await evalJs("(function(){var t=document.getElementById('v1506-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const u3c = await pollH('360px', 6000);
await sleep(1400);
const u3d = await evalJs(H);
const u3blur = await evalJs("(function(){var d=document.getElementById('v1506-ed');if(d&&d.blur)d.blur();var b=document.getElementById('__focOut');if(!b){b=document.createElement('button');b.id='__focOut';b.style.cssText='position:fixed;left:-99px;top:0;opacity:0';document.body.appendChild(b);}b.focus();var ae=document.activeElement;return ae?(ae.id||ae.tagName):'none';})()");
const u3e = await pollH('', 5000); // 时序余量：本条只断言「失焦后回位」这一语义，最坏路径约 1.3s（滞留焦点对账 2 拍 + 读数冻结 1.2s）；快回位的时序由 verify-1524 单独钉
check('U3b 零信号内核（B 型）：全高 1.2s 仍顶住不展开（用户明选 B 型），失焦后回位', u3c && u3d === '360px' && u3e, { open: u3c, held: u3d, blurred: u3e, focusAfter: u3blur });

// ---- U4 停手 650ms 窗过期收口（两侧同绿，红侧 900ms 窗也 ≤2.5s） ----
const u4 = await pollH('', 2500);
check('U4 停手后 ≤2.5s 收口（窗口过期路径）', u4);

check('Z1 全程零 JS 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 2));

const pass = results.filter((x) => x.ok).length;
console.log('\n#1506 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
browser.kill();
server.close();
process.exit(results.length - pass === 0 ? 0 : 1);

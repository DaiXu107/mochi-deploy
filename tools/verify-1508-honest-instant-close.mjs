// ===== #1508 界面级回归：顶住只限打字中（收起键盘 ≤1.2s 回底）＋键盘间隙轴 ±80 =====
// 背景（作者实报＋截图，2026-09-30 晚）：#1486「实测在场必顶住」在这族 Edge（GT7/K80/OPPO Find X8s）
// 上＝收起键盘后页面被按在停靠高度数秒（Edge 收起不发任何信号、vk 也停在旧值）＝「输入栏消失几秒/
// 白屏」回归；本批把顶住收紧为「打字中」（_aLastAct<1200ms），一停手即收口回底。轴 ±40→±80。
// 判别核心：B3 停止触摸后 ≤2.5s 必须收口（纯 #1486 永久顶住＝必红）＋B4 轴 80 生效（纯 #1486 RANGE
// 拒收＝必红）。夹具：假 vv 全高＝innerHeight＝844；假 vk；触摸+keydown(229) 续期 _aLastAct。
// 用法：node tools/verify-1508-honest-instant-close.mjs（量当前产物）；MOCHI_ROOT=<副本> 量别版
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
check('S1 诚实内核收起即收·主链（删＝顶住判据整条消失＝秒收回归；#1521 收敛后判据＝实测尺三态／诚实判位，无时间引信）', jsMA.includes('function _aHoldNow() {'));
check('S2 诚实内核轮询腿同秒收', jsMA.includes('if (_focNow && _aHoldNow()) return;'));
check('S3 武装只在顶住成立时（诚实收起不被污染；#1521-36 起计数由收缩记账行清零，不受收口抑制窗影响）', jsMA.includes('if (_aFullReads >= 3 && !_aHonestSession) _aKbVkArm();'));
check('S4 轴量程 ±240·安卓消费钳（#1527 从 ±80 放宽）', jsMA.includes('return a ? Math.max(-240, Math.min(240, Math.round(+a.kbgap || 0))) : 0;'));
check('S5 轴 ±240 面板仍在（#1527）', jsPe.includes('min: -240, max: 240,'));

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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1508-' + Date.now()),
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
await evalJs("(function(){var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='v1508-ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('v1508-ed');if(!t)return;if(document.activeElement!==t){try{t.focus();}catch(e2){}}},400);return 1;})()");

// ---- H1 诚实开启：恒缩 360（无 vk）→ 钉 360 ----
// #1521：本组四例（H1~H4）建模的是诚实内核——尺子必须沉默（boundingRect 恒 0）。
// 原夹具的尺子无条件报 356，等于给诚实内核也塞了一把 overlay 尺，武装一次就把场景
// 变成 overlay（本尺 H4 期望 360 而实测 488 就是这么来的）→ 与被测语义自相矛盾。
await evalJs("(function(){window.__fakeVK.boundingRect.height=0;return 1;})()");
await evalJs("(function(){var t=document.getElementById('v1508-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const h1 = await pollH('360px', 6000);
check('H1 诚实会话钉 360px', h1);
await evalJs("(function(){clearInterval(window.__arm);window.__arm=null;return 1;})()"); // #1512 前置：停触摸泵（永动触摸编辑框＝真机不存在的形态，会误触发保底停靠）

// ---- H2 打字中收起（vv→844）：≤1.2s 收口 ----
await sleep(900); // #1521：诚实内核的忠实建模——收缩读数要「持续存在」（连续≥2拍且跨度>400ms）才判得出诚实；原夹件收缩后立刻发全高，压根没给内核说话的时间
await evalJs("(function(){var t=document.getElementById('v1508-ed');if(t){try{t.dispatchEvent(new KeyboardEvent('keydown',{keyCode:229,bubbles:true}));}catch(e){}}window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
const h2 = await pollH('', 2000);
check('H2 诚实收起即收：≤1.2s 内收口（红侧 800ms 窗＋tick 也会过，判别靠 H3）', h2);

// ---- H3 停笔 400ms 后收起：必须 ≤700ms 收口（红侧 800ms 窗吃满＝必红） ----
await evalJs("(function(){var t=document.getElementById('v1508-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
await pollH('360px', 6000);
await evalJs("(function(){var t=document.getElementById('v1508-ed');if(t){try{t.dispatchEvent(new KeyboardEvent('keydown',{keyCode:229,bubbles:true}));}catch(e){}}return 1;})()");
await sleep(900); // #1521：同 H2，诚实判据要求收缩持续存在（连续≥2拍且跨度>400ms），450ms 在 250ms 轮询口径下只有 1 拍
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');var t0=Date.now();window.__t0h3=t0;return 1;})()");
const t3=Date.now();
const h3 = await pollH('', 1500);
check('H3 停笔 400ms＋收起：≤900ms 收口＝秒收（纯 #1506 吃满 800ms 窗＋采样＝必红）', h3 && Date.now()-t3 <= 900, { closed: h3, ms: Date.now()-t3 });

// ---- H4 打字不停（恒缩＋连按键 1s）不误收 ----
await evalJs("(function(){var t=document.getElementById('v1508-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
await pollH('360px', 6000);
await evalJs("(function(){window.__k3=setInterval(function(){var t=document.getElementById('v1508-ed');if(!t)return;try{t.dispatchEvent(new KeyboardEvent('keydown',{keyCode:229,bubbles:true}));}catch(e){}},350);return 1;})()");
await sleep(1100);
const h4 = await evalJs(H);
check('H4 持续按键 1.1s 仍钉 360px（打字不误收）', h4 === '360px', h4);
await evalJs("(function(){clearInterval(window.__k3);return 1;})()");

check('Z1 全程零 JS 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 2));

const pass = results.filter((x) => x.ok).length;
console.log('\n#1508 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
browser.kill();
server.close();
process.exit(results.length - pass === 0 ? 0 : 1);

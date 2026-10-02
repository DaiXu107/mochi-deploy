// ===== #1481 界面级回归：安卓键盘会话「双稳态读数」过滤（GT7 Edge 实证批） =====
// 作者转报（2026-09-30，真我 GT7／Edge）：「输入栏和输入法中间一片空白」与「输入法遮挡输入栏」
// **两态反复切换**，所有输入法位置都有。诊断单铁证：键盘期快照 {kb:1, vvH:640(=全高), ph:"640px",
// gap:0} ＝会话开着时内核把可视视口瞬时弹回全高，钉高/对账照单全收（输入栏沉回键盘下＝遮挡），
// 读数缩回又贴回（空白）＝页面每拍忠实跟随设备的两态读数。
// 修法（mobile-adapt.js，判据零机型）：会话内钉高/对账一律用「稳态收缩高度」_aKbStableH（本会话
// 最后一次真实收缩读数），瞬时全高读数不采用；收键盘改判「持续全高 ≥800ms」才拆会话（毛刺顶住）。
// 失焦路径（400ms 复查）不迟滞＝真收键盘回底不慢半拍。device.js 诊断加「键盘期快照环」（4 条环形
// 毛刺序列），GT7 复测拿它直接看抖动。
// 本尺：S 组静态锚×6；B 组行为——诚实开启/贴随（两侧同绿）；resize 毛刺顶住＋轮询毛刺顶住
// （纯 HEAD 必红＝新契约）；持续全高真复原、失焦真复原（两侧同绿＝真收键盘不回退）。
// 无头要点：假 vv 全高＝innerHeight＝844（真实设备 vv 全高＝inner；不相等会被收起钳回防护当成收缩＝幽灵会话夹具伪影，探针实证）；夹具 contenteditable 放 .phone 内随停靠上移
// （避开 _aProvDeepen 越收越深）；**Page.bringToFront 必须先行**——无窗口焦点时 Chromium 吞
// focusin，而整条键盘链挂在 focusin 处理器上（verify-1472 同课）。
// 用法：node tools/verify-1481-kb-bistable-hold.mjs（量当前产物）；MOCHI_ROOT=<副本> 量别版
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
const idx = rd('index.html');
check('S1 会话稳态高度采集（删＝毛刺读数照进钉高）', jsMA.includes('if (cur < _aH - 60) { _aKbStableH = cur; _aFullSince = 0; _aFullReads = 0; return cur; }'));
check('S2 钉高改用稳态高度（删＝会话期瞬时全高被照写）', jsMA.includes('var _hv = _aKbFeedH(); // #1481'));
check('S3 对账同用稳态高度（删＝对账环把毛刺当真残差）', jsMA.includes('var visB = o + _hv;'));
check('S4 主链复原迟滞（删＝收键盘毛刺直接拆会话）', jsMA.includes('var _hHold = Math.round(_aKbStableH)'));
check('S5 打字中顶住·轮询腿（#1492 起形态）', jsMA.includes('if (_focNow && _aHoldNow()) return;'));
check('S6 诊断打印键盘期快照环（删＝毛刺序列拍不进诊断单）', idx.includes('键盘期快照环='));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (29800 + Math.floor(Math.random() * 300));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1481-' + Date.now()),
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

async function boot() {
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_VV });
  await cdp('Page.navigate', { url: baseUrl + PAGE });
  await sleep(2500);
  for (let i = 0; i < 90; i++) {
    const ok = await evalJs("(function(){return typeof window.mochiScreenAdj==='object' && !!window.__fakeVV && !!document.querySelector('.phone');})()");
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
// 无窗口焦点时 Chromium 吞 focusin（verify-1472 同课）——先带前台再动夹具
await cdp('Page.bringToFront');
await sleep(300);
await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
await evalJs("(function(){var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='v1481-ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('v1481-ed');if(!t)return;try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}if(document.activeElement!==t){try{t.focus();}catch(e2){}}},600);return 1;})()");

// ---- T1 诚实开启：vv 700→360 → 钉高 360（两侧同绿，零改动基准） ----
await evalJs("(function(){window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const t1 = await pollH('360px', 6000);
check('T1 诚实开启钉高 360px（两侧同绿）', t1);

// ---- T4 收缩贴随：360→330 → 钉高跟到 330（真实收缩读数照用，两侧同绿） ----
await evalJs("(function(){window.__fakeVV.height=330;window.__fakeVV.dispatch('resize');return 1;})()");
const t4 = await pollH('330px', 4000);
check('T4 真实收缩贴随 330px（两侧同绿）', t4);

// ---- T2a resize 毛刺顶住：330→700 一发（键盘期瞬时全高）→ 600ms 时必须仍是 330px（纯 HEAD 已拆会话＝必红） ----
await evalJs("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(600);
const t2aH = await evalJs(H);
check('T2a 全高毛刺顶住：600ms 时仍 330px（键盘还开着；纯 HEAD 已复原＝必红）', t2aH === '330px', t2aH);

// ---- T2b B 型契约（#1521）：无 vk 会话持续全高也不自动收口，聚焦就顶住；点消息区才回位 ----
const t2bHold = await sleep(3000).then(() => evalJs(H));
check('T2b B 型：无 vk 会话持续全高 3s 仍顶住不自动收口（#1521 删掉 800ms 时间引信后的契约）', t2bHold === '330px', t2bHold);
await evalJs("(function(){var cb=document.getElementById('chat-body');if(!cb)return 0;var tgt=cb.firstElementChild||cb;try{tgt.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}return 1;})()");
const t2b = await pollH('', 3000);
check('T2b 点消息区＝当场回位（B 型的回位口，纯 HEAD 无此监听＝必红）', t2b);

// ---- T3 轮询毛刺顶住：重开 360 后，不发事件直接改 700（只有 250ms 轮询看得见）→ 600ms 时仍 360px（纯 HEAD 必红） ----
await evalJs("(function(){window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const t3open = await pollH('360px', 6000);
await evalJs("(function(){window.__fakeVV.height=844;return 1;})()");
await sleep(600);
const t3aH = await evalJs(H);
check('T3a 轮询毛刺顶住：600ms 时仍 360px（纯 HEAD 轮询腿拆会话＝必红）', t3open && t3aH === '360px', t3aH);
await evalJs("(function(){var t=document.getElementById('v1481-ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const t3openB = await pollH('360px', 6000);
await evalJs("(function(){window.__fakeVV.height=844;return 1;})()");
await sleep(700);
await evalJs("(function(){var cb=document.getElementById('chat-body');if(!cb)return 0;var tgt=cb.firstElementChild||cb;try{tgt.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}return 1;})()");
const t3b = await pollH('', 3000);
check('T3b 轮询腿自带会话：点消息区当场回底（B 型回位口，两侧同绿）', t3openB && t3b);

// ---- T5 失焦真复原不受迟滞影响：重开后 blur＋全高 → ≤2.5s 复原（两侧同绿） ----
await evalJs("(function(){window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
await pollH('360px', 6000);
await evalJs("(function(){window.__fakeVV.height=844;var d=document.getElementById('v1481-ed');if(d&&d.blur)d.blur();return 1;})()");
const t5 = await pollH('', 2500);
check('T5 失焦真复原不迟滞（400ms 复查路径，两侧同绿）', t5);

check('Z1 全程零 JS 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 2));

const pass = results.filter((x) => x.ok).length;
console.log('\n#1481 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
browser.kill();
server.close();
process.exit(results.length - pass === 0 ? 0 : 1);

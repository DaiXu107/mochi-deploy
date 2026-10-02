// ===== #1472 界面级回归：键盘间隙轴×三条盲猜保底停靠路 =====
// 体检（2026-09-30）：kbgap 只在 vv 诚实收缩主路径生效（安卓 _aPinHeight／iOS syncIosKb steady+open），
// 三条盲猜保底路（安卓 _aProvDock 58%盲猜/平移实测、_aProvVkRuler VirtualKeyboard 实测尺、iOS _iProvDock）
// 全部裸写高度不吃轴＝最需要自救的机型（键盘不给几何信号的）拖轴无效；且保底态下 __mochiKbReconNow
// 被对账闸（!_aKb）整个挡住，会话中拖轴不重停靠＝「边拖边看」失灵。本尺三组：
//   S 组·静态锚：五处改点在产物各恰 1 次（iOS 两条行为面在无头被 syncVvFit/验收自愈夹具互锁，按
//         verify-1463 S7 先例走静态锚）。
//   B 组·安卓盲猜行为（假 vv 恒 700 不收缩＝纯悬浮键盘内核、无平移）：58% 停靠 406；拖轴即时重停靠
//         ±轴值；归 0 回自动停靠；VirtualKeyboard 实测尺吃轴；kbH=80+轴40 恰触上钳 660；超程 set 拒收。
//         默认 0 断言两侧同绿＝零改动语义；±轴断言纯 HEAD 必红＝判别力。
//   Z 组·全程零 JS 异常。
// 夹具要点：假 vv 恒 700（基 700＝min(700,inner844)）⇒ 诚实路（h<_aH-60）永不触发，只走保底；
//   测试可编辑元素放 .phone 内部（position:relative）随停靠上移＝不被 _aProvDeepen 越收越深；
//   用 contenteditable div（避开安卓 input→ce-box 转换换走焦点）；触摸闸（kbLastTouchAt/kbTouchArmed）
//   由 600ms 定时往夹具上派 touchstart＋保焦满足。
// 用法：node tools/verify-1472-kb-gap-prov-dock.mjs                （量当前产物）
//       MOCHI_ROOT=<仓外副本> 跑另一版；纯 HEAD 对照直接跑（±轴契约必红）
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

// ---- S 组·静态锚（产物文件直读） ----
function rd(p) { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } }
const jsMA = rd('js/mobile-adapt.js');
check('S1 安卓保底停靠叠加键盘间隙轴（删＝悬浮键盘/不平移内核拖轴无效）', jsMA.includes('Math.min(ph + _aKbGap(), base - 40)'));
check('S2 VirtualKeyboard 实测尺叠加键盘间隙轴（删＝overlaysContent 内核实测精停不吃轴）', jsMA.includes('b2 - Math.max(kbH, 40) + _aKbGap()'));
check('S3 iOS 保底停靠叠加键盘间隙轴（删＝iOS 盲猜 58% 机型拖轴无效）', jsMA.includes("_setPhoneH(ph + _kbGapPx(), 'prov')"));
check('S4 安卓保底态拖轴当场重停靠（删＝会话中拖轴要收起重开键盘才生效）', jsMA.includes('if (_aProv && !_aKb && !_aClosing) { _aProvDock(); return; }'));
check('S5 iOS 保底态拖轴当场重停靠（删＝iOS 保底态同样要重开键盘）', jsMA.includes('if (_iProv && !_kbActive) { _iProvDock(); return; }'));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (29400 + Math.floor(Math.random() * 400));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1472-' + Date.now()),
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
  fail2("无法连接无头浏览器"); process.exit(2);
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

// 假 visualViewport：恒 700 不收缩、零平移、scrollTo no-op＝「纯悬浮键盘」内核（#337 族）。
// 必须在应用脚本求值前装好（addInitScript）。
const FAKE_VV = `(function(){
  var vv = { height: 700, width: 390, scale: 1, offsetTop: 0, offsetLeft: 0, _ls: {},
    addEventListener: function (t, f) { (vv._ls[t] = vv._ls[t] || []).push(f); },
    removeEventListener: function () {},
    scrollTo: function () {},
    dispatch: function (t) { (vv._ls[t] || []).slice().forEach(function (f) { try { f(); } catch (e) {} }); } };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: function () { return vv; } });
  window.__fakeVV = vv;
  return 1;
})()`;

// 假 VirtualKeyboard：geometrychange 可手动派发（真实 Chromium 该 API 依赖 overlaysContent 生效时机，假件保证确定性）
const FAKE_VK = `(function(){
  var ls = [];
  var vk = { overlaysContent: false, boundingRect: { x: 0, y: 544, width: 390, height: 300 },
    addEventListener: function (t, f) { ls.push(f); }, removeEventListener: function () {},
    dispatch: function () { ls.slice().forEach(function (f) { try { f({}); } catch (e) {} }); } };
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

// 轮询直到 .phone 内联高等于期望值（保底停靠由 250ms watch 驱动，固定 sleep 会脆）
async function pollH(expect, timeoutMs) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < (timeoutMs || 6000)) {
    last = await evalJs("(function(){var p=document.querySelector('.phone');return p?p.style.height:null;})()");
    if (last === expect) return true;
    await sleep(200);
  }
  console.log('  [poll timeout] 期望 ' + expect + '，实际 ' + last);
  return false;
}

const connected = await cdpConnect();
const booted = await boot();
if (!booted) { fail2("页面未就绪（mochiScreenAdj/.phone 缺位）"); browser.kill(); process.exit(2); }
// 无头页面无窗口焦点时 Chromium 吞掉 focusin（实测：activeElement 已换、focus 事件零派发），
// 而保底停靠整条链（_aFocusAt 盖章/watch 启动/950+1700ms 探针）都挂在 focusin 处理器里——
// 先把页面带到前台再动夹具（probe 实证 bringToFront 后 focusin 恢复、snap 落笔）。
await cdp('Page.bringToFront');
await sleep(300);
await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");

// 夹具：.phone 内底部可编辑元素 + 触摸闸续期（kbLastTouchAt<1500 / kbTouchArmed）
await evalJs("(function(){var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='v1472-ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('v1472-ed');if(!t)return;try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}if(document.activeElement!==t){try{t.focus();}catch(e2){}}},600);return 1;})()");

// ---- B1·盲猜停靠默认 0＝逐位不变：58% 停靠 406（round(700*0.58)，基= min(700, 844)） ----
const b1 = await pollH('406px', 8000);
let r = await evalJs("(function(){var p=document.querySelector('.phone');return {h:p.style.height,al:p.style.alignSelf,prov:(window.__mochiKbSnap&&window.__mochiKbSnap.prov)||0};})()");
check('B1 盲猜停靠默认 0：.phone=406px＋顶对齐＋prov 现场（零改动语义，两侧同绿）', b1 && r && r.al === 'flex-start' && r.prov === 1, r);

// ---- B2·拖轴 -30：保底态即时重停靠（对账闸 !_aKb 不再吞掉保底态） ----
await evalJs("(function(){return window.mochiScreenAdj.set('kbgap',-30);})()");
const b2 = await pollH('376px', 4000);
check('B2 kbgap=-30 即时重停靠 376px（406-30；纯 HEAD 停在 406＝必红）', b2);

// ---- B3·拖轴 +40：即时重停靠 446px ----
await evalJs("(function(){return window.mochiScreenAdj.set('kbgap',40);})()");
const b3 = await pollH('446px', 4000);
check('B3 kbgap=+40 即时重停靠 446px（406+40；纯 HEAD 必红）', b3);

// ---- B4·归 0＝回自动停靠值 ----
await evalJs("(function(){return window.mochiScreenAdj.set('kbgap',0);})()");
const b4 = await pollH('406px', 4000);
check('B4 kbgap=0 回 58% 自动停靠 406px（默认 0＝零改动语义，两侧同绿）', b4);

// ---- B5·VirtualKeyboard 实测尺（轴 0）：kbH=300 → 700-300=400（实测尺本体不受本批影响） ----
await evalJs("(function(){window.__fakeVK.boundingRect.height=300;window.__fakeVK.dispatch();return 1;})()");
const b5 = await pollH('400px', 4000);
check('B5 实测尺轴 0＝400px（kbH=300；尺本体零改动，两侧同绿）', b5);

// ---- B6·实测尺吃轴＋上钳：轴 40 → 重停靠 446；kbH=80 → 700-80+40=660 恰触上钳 base-40 ----
await evalJs("(function(){return window.mochiScreenAdj.set('kbgap',40);})()");
const b6a = await pollH('446px', 4000);
await evalJs("(function(){window.__fakeVK.boundingRect.height=80;window.__fakeVK.dispatch();return 1;})()");
const b6b = await pollH('660px', 4000);
check('B6 实测尺吃轴：轴40 重停靠 446px；kbH=80 落 660px（700-80+40 恰触上钳；纯 HEAD 620＝必红）', b6a && b6b, { redock: b6a, ruler: b6b });

// ---- B7·超程拒收：±200 超出 [-40,40] 登记 RANGE，set 返回 false 且高度不被越界写（与尾态无关，两侧同绿） ----
const hBefore = await evalJs("(function(){return document.querySelector('.phone').style.height;})()");
const b7 = await evalJs("(function(){var a=window.mochiScreenAdj.set('kbgap',200);var b=window.mochiScreenAdj.set('kbgap',-200);return {a:a,b:b,h:document.querySelector('.phone').style.height};})()");
check('B7 超程 set 拒收（false/false、高度保持原值不被越界写）', b7 && b7.a === false && b7.b === false && b7.h === hBefore, b7);

// ---- B8·轴归 0＝回自动停靠值（用户「双击滑杆回 0」路径：set(0) 经即时重停靠落回 58% 值；纯 HEAD 无重停靠＝确定性必红） ----
await evalJs("(function(){window.mochiScreenAdj.set('kbgap',0);return 1;})()");
const b8a = await pollH('406px', 4000);
await evalJs("(function(){window.__fakeVK.boundingRect.height=300;window.__fakeVK.dispatch();return 1;})()");
const b8b = await pollH('400px', 4000);
check('B8 轴归 0 回自动停靠 406px＋实测尺 400px（纯 HEAD 停在拖轴态＝必红）', b8a && b8b);

// ---- Z 组·零异常 ----
check('Z1 全程零 JS 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 2));

const pass = results.filter((x) => x.ok).length;
console.log('\n#1472 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
try { clearInterval(); } catch (e) {}
browser.kill();
server.close();
process.exit(results.length - pass === 0 ? 0 : 1);

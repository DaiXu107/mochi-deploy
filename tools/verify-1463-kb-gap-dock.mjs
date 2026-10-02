// ===== #1463 界面级回归：键盘停靠对账＋键盘间隙轴＋安卓键盘取证 =====
// 作者两台实报（2026-09-29，真我 GT7／红米 K80 均 Edge）：「聊天页面，底部输入栏点击输入文字，
// 输入法弹窗弹出后，底部输入栏和输入法弹窗中间会有一片空白的位置」——同族 #236/#530/#1330。
// 本尺三组判据（判据零机型／零 UA 分支，只取几何事实）：
//   A 组·取证链：键盘会话自动快照（__mochiKbSnap）落笔、诊断打印行（键盘期快照=／安卓探针）在产物。
//   B 组·对账：键盘会话期「可视带底边(offsetTop+height) vs .phone 实测底边」差 >12px 即对账——
//         用假 visualViewport 模拟「平移不可归零」的残留内核（scrollTo noop），看钉高是否贴回可视底边。
//   C 组·第 8 轴：kbgap 默认 0＝钉高逐位不变；set('kbgap',20) 即时把对账目标下压 20px；
//         顶部轴在「无基准形态」（env=0）落 calc(env+偏移)；面板渲染 kbgap 滑杆。
// 用法：node tools/verify-1463-kb-gap-dock.mjs                （量当前产物）
//       MOCHI_ROOT=<仓外副本> 跑另一版；纯 HEAD 对照直接跑（本批新契约必红）
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
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 240) + ']' : ''));
}

// ---- S 组·静态锚（产物文件直读） ----
function rd(p) { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } }
const jsMA = rd('js/mobile-adapt.js');
const jsPers = rd('js/personalize.js');
const idx = rd('index.html');
check('S1 对账目标式在产物（删＝键盘期可视区再扩一拍时钉高不跟）', jsMA.includes('var err = (visB + _aKbGap()) - pb;'));
check('S2 键盘期快照落笔在产物（删＝键盘弹起几何拍不进诊断单）', jsMA.includes('window.__mochiKbSnap = s;'));
check('S3 诊断打印键盘期快照行（删＝取证链断在最后一米）', idx.includes('键盘期快照='));
check('S4 诊断键盘残留行接安卓探针（删＝安卓恒 n/a）', idx.includes('安卓探针: kbActive'));
check('S5 面板第 8 轴登记（删＝键盘间隙轴消失）', jsPers.includes("k: 'kbgap', name: '键盘间隙'"));
check('S6 顶部轴 env 叠加形态（删＝普通安卓顶部轴恒摘除）', jsMA.includes("calc(env(safe-area-inset-top, 0px) + '"));
check('S7 iOS 键盘会话高度叠加键盘间隙轴', jsMA.includes("_setPhoneH(_safeH + _kbGapPx(), 'steady');"));
check('S8 页面高度轴平台标记接线（#964 行级标记）', jsPers.includes('iOS 专用（安卓上此轴无落点'));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (26000 + Math.floor(Math.random() * 2000));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1463-' + Date.now()),
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

// 假 visualViewport：可编程高度/平移；scrollTo 故意 no-op＝「平移不可归零」残留内核（#236 族），
// 停靠对账正是为这一族兜底。必须在应用脚本求值前装好（addInitScript）。
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

const READ = `(function(){
  var ph = document.querySelector('.phone');
  var r = ph ? ph.getBoundingClientRect() : null;
  var vv = window.__fakeVV;
  return {
    h: ph ? ph.style.height : null,
    alignSelf: ph ? ph.style.alignSelf : null,
    pb: r ? Math.round(r.bottom) : null, top: r ? Math.round(r.top) : null,
    vvH: vv ? Math.round(vv.height) : null, off: vv ? vv.offsetTop : null,
    visB: vv ? (vv.offsetTop + Math.round(vv.height)) : null,
    snap: (function(){ var s = window.__mochiKbSnap; return s ? { kb: s.kb, prov: s.prov, ev: s.ev, ph: s.ph, gap: s.gap, vvH: s.vvH, offTop: s.offTop } : null; })(),
    snaps: (window.__mochiKbSnaps || []).length,
    safeTop: document.documentElement.style.getPropertyValue('--mochi-safe-top') || '',
    kbgap: (window.mochiScreenAdj && window.mochiScreenAdj.all && window.mochiScreenAdj.all().kbgap) || 0
  };
})()`;

const connected = await cdpConnect();

const booted = await boot();
if (!booted) { fail2("页面未就绪（mochiScreenAdj/.phone 缺位）"); browser.kill(); process.exit(2); }
await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");

// ---- B1·开会话：文本聚焦 + vv 收缩 ≥60 → _aKb 钉高 = vv.height（kbgap 默认 0＝逐位不变） ----
await evalJs("(function(){var ta=document.createElement('textarea');ta.id='v1463-ta';ta.style.cssText='position:fixed;left:0;bottom:0;width:200px;height:40px';document.body.appendChild(ta);ta.focus();return !!document.activeElement&&document.activeElement.id;})()");
await sleep(350);
await evalJs("(function(){window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(1300);
let r = await evalJs(READ);
check('B1 键盘会话钉高=vv.height（默认 0 轴不改变自动停靠值）', r && r.h === '360px', r && { h: r.h, alignSelf: r.alignSelf, pb: r.pb });
check('B2 键盘期快照已落笔（kb=1、ph=钉高、gap 有读数）', r && r.snap && r.snap.kb === 1 && r.snap.ph === '360px' && typeof r.snap.gap === 'number', r && r.snap);

// ---- B3·对账不变式：可视带底边因平移残留/内核扩拍高于钉高低边 → 输入栏贴回可视底边 ----
await evalJs("(function(){window.__fakeVV.offsetTop=80;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(1300);
r = await evalJs(READ);
check('B3 对账不变式：.phone 底边贴住可视带底边（残留 80 被对账/平移补偿收口）', r && r.visB != null && r.pb != null && Math.abs(r.pb - r.visB) <= 12 && r.h === '360px', r && { h: r.h, visB: r.visB, pb: r.pb, off: r.off });

// ---- C1·键盘间隙轴：+20＝在对账目标上再下压 20（pb 应到 visB+20） ----
await evalJs("(function(){return window.mochiScreenAdj.set('kbgap',20);})()");
await sleep(800);
r = await evalJs(READ);
check('C1 kbgap=20 即时生效：输入栏底边压到可视底边+20（会话中拖滑杆下一拍就到）', r && r.visB != null && r.pb != null && Math.abs(r.pb - (r.visB + 20)) <= 8, r && { h: r.h, pb: r.pb, visB: r.visB, kbgap: r.kbgap });

// ---- C2·kbgap 归 0＝回到纯对账值 ----
await evalJs("(function(){return window.mochiScreenAdj.set('kbgap',0);})()");
await sleep(800);
r = await evalJs(READ);
check('C2 kbgap=0 回到对账值（默认 0＝零改动语义）', r && r.visB != null && r.pb != null && Math.abs(r.pb - r.visB) <= 12 && r.h === '360px', r && { h: r.h, pb: r.pb, visB: r.visB });

// ---- C3·顶部轴在「无基准形态」（env=0、非覆盖）落 calc(env+偏移) ----
await evalJs("(function(){return window.mochiScreenAdj.set('top',15);})()");
await sleep(500);
r = await evalJs(READ);
check('C3 顶部轴 +15 落 calc(env+15px)（安卓无基准形态不再是死轴）', r && r.safeTop === 'calc(env(safe-area-inset-top, 0px) + 15px)', r && { safeTop: r.safeTop });
await evalJs("(function(){return window.mochiScreenAdj.set('top',0);})()");
await sleep(400);
r = await evalJs(READ);
check('C4 顶部轴归 0＝摘除回落 env()（与修前逐字一致）', r && r.safeTop === '', r && { safeTop: r.safeTop });

// ---- B4·收会话：vv 回基准＋失焦 → 复原清内联高＋close 快照 ----
await evalJs("(function(){window.__fakeVV.height=700;window.__fakeVV.offsetTop=0;window.__fakeVV.dispatch('resize');var ta=document.getElementById('v1463-ta');if(ta)ta.blur();if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();return 1;})()");
await sleep(1400);
r = await evalJs(READ);
check('B5 收会话复原：内联高清空（样式表高度接管）', r && r.h === '', r && { h: r.h, vvH: r.vvH });
check('B6 快照环形留存（≥2 条：会话期＋close）', r && r.snaps >= 2, r && { snaps: r.snaps });

// ---- C5·面板渲染第 8 轴滑杆 ----
await evalJs("(function(){try{window.mochiOpenScreenAdj();}catch(e){}return 1;})()");
await sleep(600);
r = await evalJs("(function(){var s=document.querySelector('[data-adj-slider=\"kbgap\"]');var v=document.querySelector('[data-adj-val=\"kbgap\"]');return {has:!!s,min:s?s.min:null,max:s?s.max:null,val:v?v.textContent:null};})()");
check('C7 面板渲染 kbgap 滑杆（min=-80 max=80、当前值 0；量程 ±40→±80 见 #1487f/g 与 #1497）', r && r.has && r.min === '-80' && r.max === '80' && (r.val === '0' || r.val === '0px'), r);
await evalJs("(function(){var b=document.querySelector('#screen-adj-panel .awk-done, #screen-adj-panel button');if(b)b.click();return 1;})()");

// ---- 零异常 ----
check('Z1 全程零 JS 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 2));

const pass = results.filter((x) => x.ok).length;
console.log('\\n#1463 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
browser.kill();
server.close();
process.exit(results.length - pass === 0 ? 0 : 1);

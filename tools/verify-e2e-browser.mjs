// ===== 回归脚本：#719 e2e 浏览器形态（OPPO Find X9 Pro + Edge「桌面和聊天上下缘遮挡」，多机型同族） =====
// 用法：node tools/verify-e2e-browser.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// 背景：Android 15+ edge-to-edge 浏览器（Edge 实报）viewport-fit=cover 下页面顶进系统状态栏/
//   手势条区，而 env() 恒报 0——#236（HeyTapBrowser env≥40 走 coverBrowser）的姊妹形态。
//   现场签名 inner=400×810 / screen=360×785 / DPR 2.699≈0.9×3.0（810×0.9=729=785−56=整屏−Edge
//   底部工具条），页面顶到物理屏顶＝Mochi 行钻状态栏、tabbar/输入栏贴手势条。修复=共享判定器
//   mochiViewportForm 新增 e2e-browser 形态（inner 超出整屏 [3,64] ＋ 缩放渲染证据 innerW>screenW
//   ＋ env<20 ＋ andr ＋ 非全屏/非 standalone → 顶部 28/z、底部 16/z 自动避让；window.__mochiE2eLatch
//   闩住 Edge 工具条隐匿瞬间 overH≈87 的带外波动），复用既有 mochi-cover-top/--mochi-safe-bottom
//   消费链，CSS 零改动。
// 本脚本 CDP 真实产物验证：
//   S  静态：判定器形态门/安卓执行器接线/键盘收起回落三锚点在产物中在位。
//   B1 行为（Find X9 Pro + Edge 几何仿真 400×810/screen360×785/DPR2.699/Android Edge UA）：
//      判定器=e2e-browser、safeTop=31/safeBottom=18、html 挂 mochi-cover-top、
//      --mochi-safe-top=31px / --mochi-safe-bottom=18px 落盘、状态栏 computed padding-top=45px、
//      .phone 贴 inner 不超（文档零滚动量）、闩置位。
//   B2 行为（普通安卓机 390×844/screen390×844/Chrome UA 回归守卫）：零 class、零内联变量、
//      判定器=plain——防「修 A 机坏 B 机」复发。
//   B3~B5 单元守卫：#278 screen 坏值家族（screen<inner 达 535）不误判 e2e；闩语义
//      （带内自动进门 / 带外闩维持 / 横屏负 overH 不判）；iOS standalone 形态不受影响。
//   Z  全程无新增 JS 异常。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArgIdx = process.argv.indexOf('--root');
const root = normalize((rootArgIdx > -1 ? process.argv[rootArgIdx + 1] : dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-e2e-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Network.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ===== S 静态锚 =====
const built = readFileSync(join(root, 'index.html'), 'utf8');
check('S1a 产物含判定器 e2e-browser 形态门', built.includes('e2eBrowser = e2eBase && (e2eOverH <= 64 || !!sig.e2eLatch);'));
check('S1b 产物含安卓执行器 e2e 顶避让接线（宽度信号+闩）', built.includes('if (_fc.e2eBrowser && !window.__mochiE2eLatch) window.__mochiE2eLatch = true;'));
check('S1c 产物含键盘收起回落 e2e 底避让', built.includes("_next = _kbOn ? '0px' : ((_fcB && _fcB.e2eBrowser && _fcB.safeBottom) ? _fcB.safeBottom + 'px' : '');"));

// ===== B1 行为：Find X9 Pro + Edge 几何仿真 =====
await cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 810, deviceScaleFactor: 2.699, mobile: true, screenWidth: 360, screenHeight: 785, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; OPPO Find X9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0' });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 30; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(2600); // 等 1s 对账循环至少跑两拍（syncSafeBottomA 落 --mochi-safe-bottom）
const geo = await evalJs(`(function(){
  var d = document.documentElement, st = d.style;
  var ph = document.querySelector('.phone');
  var pr = ph ? ph.getBoundingClientRect() : null;
  var sb = document.querySelector('.statusbar');
  var sbPad = sb ? getComputedStyle(sb).paddingTop : null;
  var F = window.mochiViewportForm({ standalone: false, envTop: 0, innerH: window.innerHeight || 0, screenH: (window.screen && window.screen.height) || 0, innerW: window.innerWidth || 0, screenW: (window.screen && window.screen.width) || 0, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false });
  return JSON.stringify({
    innerW: window.innerWidth, innerH: window.innerHeight, scrW: screen.width, scrH: screen.height,
    form: F.form, safeTop: F.safeTop, safeBottom: F.safeBottom, e2e: !!F.e2eBrowser,
    cls: d.classList.contains('mochi-cover-top'),
    varTop: st.getPropertyValue('--mochi-safe-top') || '',
    varBottom: st.getPropertyValue('--mochi-safe-bottom') || '',
    sbPad: sbPad, phoneBottom: pr ? Math.round(pr.bottom) : null,
    latch: !!window.__mochiE2eLatch
  });
})()`);
const g = JSON.parse(geo || '{}');
check('B1a 仿真几何生效（inner 400×810 / screen 360×785）', g.innerW === 400 && g.innerH === 810 && g.scrW === 360 && g.scrH === 785, geo);
check('B1b 判定器=e2e-browser', g.form === 'e2e-browser' && g.e2e === true, 'form=' + g.form);
check('B1c 顶部避让估式 28/0.9→31px、底部 16/0.9→18px', g.safeTop === 31 && g.safeBottom === 18, 'top=' + g.safeTop + ' bottom=' + g.safeBottom);
check('B1d html.mochi-cover-top 类已挂', g.cls === true, 'cls=' + g.cls);
check('B1e --mochi-safe-top=31px 落盘', g.varTop === '31px', 'var=' + g.varTop);
check('B1f --mochi-safe-bottom=18px 落盘（1s 对账回路）', g.varBottom === '18px', 'var=' + g.varBottom);
check('B1g 状态栏 computed padding-top=45px（14+31，Mochi 行撤出系统状态栏区）', g.sbPad === '45px', 'pad=' + g.sbPad);
check('B1h .phone 贴 inner 不超（页面零文档滚动量，#199 同语义）', g.phoneBottom != null && Math.abs(g.phoneBottom - 810) <= 4, 'bottom=' + g.phoneBottom);
check('B1i e2e 闩已置位（工具条隐匿带外波动不掉避让）', g.latch === true, 'latch=' + g.latch);

// ===== B2 行为：普通安卓机回归守卫（390×844，screen==inner 家族）=====
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
await cdp('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 30; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(1600);
const plain = await evalJs(`(function(){
  var d = document.documentElement, st = d.style;
  var F = window.mochiViewportForm({ standalone: false, envTop: 0, innerH: window.innerHeight || 0, screenH: (window.screen && window.screen.height) || 0, innerW: window.innerWidth || 0, screenW: (window.screen && window.screen.width) || 0, iosMajor: 0, safMajor: 0, andr: true, safeTopForce: false });
  return JSON.stringify({ form: F.form, cls: d.classList.contains('mochi-cover-top'), varTop: st.getPropertyValue('--mochi-safe-top') || '', varBottom: st.getPropertyValue('--mochi-safe-bottom') || '' });
})()`);
const p2 = JSON.parse(plain || '{}');
check('B2a 普通机判定器=plain（零误判）', p2.form === 'plain', plain);
check('B2b 普通机零 class/零内联变量（零视觉变化）', p2.cls === false && p2.varTop === '' && p2.varBottom === '', plain);

// ===== B3~B5 单元守卫（判定器纯函数，不依赖页面几何）=====
const unit = await evalJs(`(function(){
  var F = window.mochiViewportForm;
  var bad = F({ standalone: false, envTop: 0, innerH: 1331, screenH: 796, innerW: 400, screenW: 360, iosMajor: 0, safMajor: 0, andr: true }); // #278 畅享70Pro 家族：screen 坏值，overH=535
  var latchOn = F({ standalone: false, envTop: 0, innerH: 866, screenH: 785, innerW: 400, screenW: 360, iosMajor: 0, safMajor: 0, andr: true, e2eLatch: true }); // Edge 工具条隐匿态（overH=81 带外）+闩
  var latchOff = F({ standalone: false, envTop: 0, innerH: 866, screenH: 785, innerW: 400, screenW: 360, iosMajor: 0, safMajor: 0, andr: true }); // 同几何无闩＝不判（防 80% 缩放非 e2e 闯入）
  var land = F({ standalone: false, envTop: 0, innerH: 338, screenH: 400, innerW: 872, screenW: 785, iosMajor: 0, safMajor: 0, andr: true, e2eLatch: true }); // 横屏 overH<0
  var ios = F({ standalone: true, envTop: 62, innerH: 812, screenH: 874, iosMajor: 18, safMajor: 26 }); // iOS standalone 覆盖形态
  return JSON.stringify({
    badForm: bad.form, badTop: bad.safeTop,
    latchOnForm: latchOn.form, latchOnTop: latchOn.safeTop,
    latchOffForm: latchOff.form,
    landForm: land.form,
    iosForm: ios.form, iosE2e: !!ios.e2eBrowser
  });
})()`);
const u = JSON.parse(unit || '{}');
check('B3 #278 screen 坏值家族不误判 e2e（铺满 inner 原语义不变）', u.badForm !== 'e2e-browser' && u.badTop === 0, unit);
check('B4a 带外+闩=维持 e2e（Edge 工具条隐匿不掉避让）', u.latchOnForm === 'e2e-browser' && u.latchOnTop === 31, unit);
check('B4b 带外无闩=不判（80% 缩放非 e2e 浏览器不误判）', u.latchOffForm !== 'e2e-browser', unit);
check('B4c 横屏 overH<0 不判 e2e', u.landForm !== 'e2e-browser', unit);
check('B5 iOS standalone 形态不受影响（不判 e2e）', u.iosForm !== 'e2e-browser' && u.iosE2e === false, unit);

// ===== Z 异常 =====
const errs = await evalJs('(window.__jsErrors||[]).length');
check('Z 全程无新增 JS 异常', errs === 0, 'errors=' + errs);

server.close();
chrome.kill();
const pass = results.filter(r => r.ok).length;
console.log('---');
console.log('通过 ' + pass + '/' + results.length);
process.exit(pass === results.length ? 0 : 1);

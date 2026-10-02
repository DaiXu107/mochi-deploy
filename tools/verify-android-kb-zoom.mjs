// ===== 回归脚本（#810）：安卓键盘弹出「整个页面被顶上去+画面缩小+两边和底部大面积留白+严重卡顿」 =====
// 用户实报（华为 nova 10 SE 华为系统自带浏览器，明说其他机型同现、要求勿致跨机型回归）：
//   设置自定义背景铺满后，点输入框弹键盘 → 页面被内核整体 zoom-out（可视视口 scale<1）：
//   文档外区域露 body 底色＝两侧/底部留白、内容整体变小；叠加键盘期逐帧 .phone 高度跟随＝卡顿。
// 修复＝mobile-adapt.js syncAndroidKb 顶部：聚焦/键盘会话内 vv.scale<0.95 时交替重写 viewport meta
//   （强制内核重新解析、按 initial-scale=1 吸附回原大；≤3 次/4s 防循环；串保持 resizes-visual）。
// 本脚本用「可编程 visualViewport 桩」在真产物上复刻该内核行为：
//   B1 正常内核（scale=1）聚焦+resize → 不触发自愈（零跨机型回归的另一半：不该治的别治）
//   B2 缩小型内核（scale=0.85）聚焦+resize → meta 被重写＋window.__mochiKbZoomFix 记账 n=1
//   B3 4s 限频窗内再触发 → 不加射（防循环）
//   B4 失焦后同样读数 → 不触发（只治键盘/聚焦期，不碰用户闲时手动缩放）
//   B5 重写串必须保持 interactive-widget=resizes-visual（绝不在键盘会话中途换键盘模型）
// 用法：node tools/verify-android-kb-zoom.mjs   （对仓库根产物 index.html；MOCHI_ROOT=目录 可指向隔离副本）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
// verify-suite:timeout=90000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，设 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kbzoom-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接 CDP');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('  JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 240)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// 可编程 visualViewport 桩：必须在应用脚本之前装（mobile-adapt 启动时把 window.visualViewport 抓进闭包）。
const VV_STUB = `
(function () {
  var vv = {
    width: 390, height: 844, scale: 1, offsetTop: 0, offsetLeft: 0, pageLeft: 0, pageTop: 0, onresize: null,
    _ls: {},
    addEventListener: function (t, f) { (this._ls[t] = this._ls[t] || []).push(f); },
    removeEventListener: function (t, f) { var a = this._ls[t] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchResize: function () { var a = (this._ls.resize || []).slice(); for (var i = 0; i < a.length; i++) { try { a[i]({}); } catch (e) {} } },
    scrollTo: function (x, y) { this.offsetTop = y; }
  };
  try { Object.defineProperty(window, 'visualViewport', { get: function () { return vv; }, configurable: true }); }
  catch (e) { window.visualViewport = vv; }
  window.__vvStub = vv;
})();
`;

await cdpConnect();
await cdp('Page.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: VV_STUB });
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 12; HUAWEI nova 10 SE) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.92 Mobile Safari/537.36 HuweiBrowser/14.0.5.310' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
try { await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch (e) {}
await cdp('Page.navigate', { url: baseUrl });
await sleep(3000); // 开屏 + defer 链

// 前置：应用必须按手机形态启用 mobile-adapt，且桩在位
const pre = await evalJs(`(function(){
  return {
    mobile: !!(window.mochiDevice && window.mochiDevice.isMobile),
    stub: !!(window.__vvStub && window.__vvStub.dispatchResize),
    meta0: (document.querySelector('meta[name="viewport"]')||{}).content || ''
  };
})()`);
if (!pre || !pre.stub) { console.error('环境不满足：visualViewport 桩未装上'); process.exit(1); }
if (!pre.mobile) { console.error('环境不满足：未按手机形态启用（mochiDevice.isMobile=false），安卓分支没跑'); process.exit(1); }
console.log('前置 OK：mobile=' + pre.mobile + '，meta 初始含 resizes-visual=' + /resizes-visual/.test(pre.meta0));

// 聚焦载体：注入一个 contenteditable（安卓适配对原生 input 会做 ce-box 转换，自造免纠缠）
await evalJs(`(function(){
  var d = document.createElement('div');
  d.id = 'kbzoom-probe';
  d.contentEditable = 'true';
  d.style.cssText = 'position:fixed;left:10px;bottom:10px;width:200px;height:32px;background:#eee;z-index:99999;';
  document.body.appendChild(d);
  return true;
})()`);
const focusProbe = `document.getElementById('kbzoom-probe').focus(); !!document.activeElement && document.activeElement.id === 'kbzoom-probe'`;
const metaNow = `((document.querySelector('meta[name="viewport"]')||{}).content || '')`;
const fixNow = `(function(){ var z = window.__mochiKbZoomFix; return z ? (z.n + '@' + z.scale) : ''; })()`;

console.log('\nB1 正常内核（scale=1）聚焦+resize：不该触发自愈');
await evalJs(`window.__vvStub.scale = 1; window.__vvStub.dispatchResize(); true`);
await evalJs(focusProbe);
await evalJs(`window.__vvStub.dispatchResize(); true`);
await sleep(700);
check('B1a scale=1 不写记账', (await evalJs(fixNow)) === '', '记账=' + await evalJs(fixNow));
check('B1b meta 未被改写', (await evalJs(metaNow)) === pre.meta0);

console.log('\nB2 缩小型内核（scale=0.85）聚焦+resize：自愈必须触发');
await evalJs(`window.__vvStub.scale = 0.85; window.__vvStub.dispatchResize(); true`);
await sleep(700);
const fix2 = await evalJs(fixNow);
check('B2a 记账 n=1', fix2.indexOf('1@0.85') === 0, '记账=' + fix2);
const meta2 = await evalJs(metaNow);
check('B2b meta 真被重写（≠原串）', meta2 !== pre.meta0);
check('B2c 重写串吸附 initial-scale=1', meta2.indexOf('initial-scale=1') >= 0, meta2);

console.log('\nB3 限频：4s 窗内再触发不加射');
await evalJs(`window.__vvStub.dispatchResize(); true`);
await sleep(500);
check('B3 记账仍 n=1', (await evalJs(fixNow)).indexOf('1@') === 0, '记账=' + await evalJs(fixNow));

console.log('\nB4 失焦后同样读数：不触发（不碰用户闲时缩放）');
await evalJs(`try { document.activeElement.blur(); } catch (e) {} window.__vvStub.dispatchResize(); true`);
await sleep(500);
check('B4 记账仍 n=1', (await evalJs(fixNow)).indexOf('1@') === 0, '记账=' + await evalJs(fixNow));

console.log('\nB5 键盘模型保持：重写串必须仍是 resizes-visual');
const meta5 = await evalJs(metaNow);
check('B5 resizes-visual 在位', /interactive-widget=resizes-visual/.test(meta5), meta5);
check('B5b 限缩上限 maximum-scale=1 在位', /maximum-scale=1(\.0)?,/.test(meta5), meta5);

console.log('\n===== ' + pass + ' 过 / ' + fail + ' 挂（#810 键盘期页面缩小自愈，产物：' + root + '）=====');
try { chrome.kill(); } catch (e) {}
process.exit(fail ? 1 : 0);

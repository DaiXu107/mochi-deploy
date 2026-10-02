// ===== 回归脚本（#1043）：iOS 页面被系统缩到 scale<1 之后无人自愈（Safari 浏览器形态） =====
// 用户实报（iPhone 15 / iOS 18.7 / **Safari 浏览器形态**，同族 iPhone 13 mini 亦现；明说其他
// 型号也有、要求不要覆盖式修补）：切页面最卡（手机桌面、字卡库切回尤甚），随附诊断 docx 的
// 结论里同时挂着「页面缩放 scale=0.85 / 底部少填 58px 白带 / 底部导航栏悬空 76px」三条。
//
// 根因（零机型/零 UA 分支，三处口径不一致，唯一缺的一处正好只在 iOS 生效）：
//   ① template.html 的 viewport 声明带 minimum-scale=1.0；
//   ② device.js 的 viewportMetaContent() 也带（它只在「UA 不像手机、靠触摸信号救回」或用户
//      手动强制手机布局时才写）；
//   ③ **mobile-adapt.js 的 iOS 分支把整串手写重写了一遍，独独漏掉 minimum-scale=1.0**——
//      而它按 jsFiles 顺序在 device.js 之后执行，于是 iOS 上把②写好的缩放下限又抹掉。
//   iOS 自 iOS 10 起忽略 user-scalable=no（Safari 明确不支持），唯一还认的缩放下限就是
//   minimum-scale ⇒ 页面可被系统缩到 0.85，.phone 仍按布局像素撑高 ⇒ 底部白带/导航栏悬空/
//   整页缩小三条同源；而 #174 的缩放自愈当时只挂在 ios-pwa-standalone 上，**Safari 浏览器
//   形态零自愈**，于是永久停在缩小态。
//
// 本脚本用「可编程 visualViewport 桩」在真产物上复刻该形态：
//   S1/S2 产物锚：iOS 启动串含 minimum-scale=1.0、且仍是 resizes-content（键盘模型不换）
//   A1/A2 启动后 live meta 同时含 minimum-scale 与 resizes-content（HEAD 上 A1 必红）
//   B1    scale=1 不触发（不误治正常内核）
//   B2    scale=0.85 且无键盘/无聚焦 → 自愈触发、meta 真被重写
//   B3    重写串仍含 minimum-scale（自愈之后仍有下限，否则下一轮又会被缩）
//   B4    4s 限频窗内再触发不加射
//   B5    隔窗再触发 → 第二次重写串与第一次**逐字不同**（A/B 交替；否则 setAttribute 不是
//         真实变更、Safari 不重新解析＝自愈空转——启动串补上 minimum-scale 后必须靠它）
//   B6    文本聚焦 + scale=0.85 → 不触发（键盘/聚焦期让路，与 #810 不打架）
//   B7    会话上限 3 次后不再重写
//   Z     零 window 报错
// 用法：node tools/verify-1042-ios-zoom-floor.mjs   （对仓库根产物；MOCHI_ROOT=目录 可指向隔离副本）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
// verify-suite:timeout=150000
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 45));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ioszoom-' + Date.now()),
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

// 可编程 visualViewport 桩 + meta 变更账本，必须在应用脚本之前装
//（mobile-adapt 启动时把 window.visualViewport 抓进闭包；账本用来数「meta 被真实重写了几次」）。
const VV_STUB = `
(function () {
  var vv = {
    width: 393, height: 852, scale: 1, offsetTop: 0, offsetLeft: 0, pageLeft: 0, pageTop: 0, onresize: null,
    _ls: {},
    addEventListener: function (t, f) { (this._ls[t] = this._ls[t] || []).push(f); },
    removeEventListener: function (t, f) { var a = this._ls[t] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchResize: function () { var a = (this._ls.resize || []).slice(); for (var i = 0; i < a.length; i++) { try { a[i]({}); } catch (e) {} } },
    scrollTo: function (x, y) { this.offsetTop = y; }
  };
  try { Object.defineProperty(window, 'visualViewport', { get: function () { return vv; }, configurable: true }); }
  catch (e) { window.visualViewport = vv; }
  window.__vvStub = vv;
  window.__metaLog = [];
  function arm() {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) { setTimeout(arm, 30); return; }
    window.__metaLog.push(m.getAttribute('content') || '');
    try {
      new MutationObserver(function () { window.__metaLog.push(m.getAttribute('content') || ''); })
        .observe(m, { attributes: true, attributeFilter: ['content'] });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm); else arm();
})();
`;

await cdpConnect();
await cdp('Page.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: VV_STUB });
// 报障机形态：iPhone / iOS 18.7 / Safari 浏览器（非主屏幕）
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
try { await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch (e) {}
await cdp('Page.navigate', { url: baseUrl });
await sleep(3200); // 开屏 + defer 链（mobile-adapt 在末位）

const pre = await evalJs(`(function(){
  return {
    ios: !!(window.mochiDevice && window.mochiDevice.isIOS),
    mobile: !!(window.mochiDevice && window.mochiDevice.isMobile),
    standalone: document.documentElement.classList.contains('ios-pwa-standalone'),
    stub: !!(window.__vvStub && window.__vvStub.dispatchResize),
    log: (window.__metaLog || []).length,
    meta: (document.querySelector('meta[name="viewport"]')||{}).content || ''
  };
})()`);
if (!pre || !pre.stub) { console.error('环境不满足：visualViewport 桩未装上'); process.exit(1); }
if (!pre.ios) { console.error('环境不满足：未判成 iOS（mochiDevice.isIOS=false），iOS 分支没跑'); process.exit(1); }
if (pre.standalone) { console.error('环境不满足：被判成主屏幕形态，本脚本要的是 Safari 浏览器形态'); process.exit(1); }
console.log('前置 OK：iOS=' + pre.ios + ' mobile=' + pre.mobile + ' standalone=' + pre.standalone);

// ===== S 轴：产物锚（HEAD 上 S1 必红＝本批修复本体） =====
const prodSrc = (() => { try { return readFileSync(join(root, 'js/mobile-adapt.js'), 'utf8'); } catch (e) { return ''; } })();
console.log('\nS 产物锚');
check('S1 iOS 启动串含 minimum-scale=1.0 缩放下限（删＝iOS 缩放下限被自愈链自己抹掉）',
  /initial-scale=1\.0, minimum-scale=1\.0, maximum-scale=1\.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content/.test(prodSrc));
check('S2 自愈重写仍保持 resizes-content（换掉＝键盘会话中途换键盘模型）',
  /minimum-scale=1(\.0)?, maximum-scale=1(\.0)?, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content/.test(prodSrc));

// ===== A 轴：启动后 live meta =====
console.log('\nA 启动后 live meta');
check('A1 live meta 含 minimum-scale（HEAD 红＝被 iOS 整串手写重写抹掉）', /minimum-scale=1/.test(pre.meta), pre.meta);
check('A2 live meta 仍是 resizes-content（iOS 键盘模型不变）', /interactive-widget=resizes-content/.test(pre.meta), pre.meta);
check('A3 live meta 未含 resizes-visual（安卓口径没串进 iOS）', !/resizes-visual/.test(pre.meta), pre.meta);

const metaNow = `((document.querySelector('meta[name="viewport"]')||{}).content || '')`;
const logNow = `(window.__metaLog || []).slice()`;

// ===== B1：scale=1 不触发 =====
console.log('\nB1 正常内核（scale=1）：不该触发自愈');
await evalJs(`window.__vvStub.scale = 1; window.__vvStub.dispatchResize(); true`);
await sleep(700);
check('B1 scale=1 时 meta 零改写', (await evalJs(logNow)).length === pre.log, '账本长度=' + (await evalJs(logNow)).length);

// ===== B2/B3：scale=0.85 无键盘无聚焦 → 自愈触发 =====
console.log('\nB2/B3 缩小型内核（scale=0.85，无键盘无聚焦）：自愈必须触发');
await evalJs(`window.__vvStub.scale = 0.85; window.__vvStub.dispatchResize(); true`);
await sleep(800);
const log2 = await evalJs(logNow);
const meta2 = await evalJs(metaNow);
check('B2a meta 真被重写（账本 +1）', log2.length > pre.log, '账本=' + log2.length + ' 初始=' + pre.log);
check('B2b 重写串 ≠ 启动串（真实内容变更）', meta2 !== pre.meta);
check('B3 重写串仍含 minimum-scale（自愈后仍有缩放下限）', /minimum-scale=1/.test(meta2), meta2);
check('B3b 重写串仍是 resizes-content', /interactive-widget=resizes-content/.test(meta2), meta2);
const firstFix = meta2, nAfterFirst = log2.length;

// ===== B4：4s 限频窗内不加射 =====
console.log('\nB4 限频：4s 窗内再触发不加射');
await evalJs(`window.__vvStub.dispatchResize(); true`);
await sleep(600);
check('B4 账本未再增长', (await evalJs(logNow)).length === nAfterFirst, '账本=' + (await evalJs(logNow)).length);

// ===== B5：隔窗再触发 → A/B 交替＝逐字不同 =====
console.log('\nB5 隔窗再触发：重写串必须与上一次逐字不同（否则 setAttribute 不是真实变更）');
await sleep(4200);
await evalJs(`window.__vvStub.dispatchResize(); true`);
await sleep(800);
const meta5 = await evalJs(metaNow);
check('B5a 第二次重写发生（账本继续增长）', (await evalJs(logNow)).length > nAfterFirst);
check('B5b 第二次重写串 ≠ 第一次（A/B 交替生效）', meta5 !== firstFix, 'first=' + firstFix.slice(0, 60) + ' | now=' + String(meta5).slice(0, 60));
check('B5c 交替后仍含 minimum-scale', /minimum-scale=1/.test(meta5), meta5);

// ===== B6：文本聚焦期让路 =====
console.log('\nB6 文本聚焦 + scale=0.85：不该触发（键盘/聚焦期合法缩放，与 #810 不打架）');
await evalJs(`(function(){
  var d = document.createElement('div');
  d.id = 'ioszoom-probe';
  d.contentEditable = 'true';
  d.style.cssText = 'position:fixed;left:10px;bottom:10px;width:200px;height:32px;background:#eee;z-index:99999;';
  document.body.appendChild(d);
  d.focus();
  return document.activeElement && document.activeElement.id === 'ioszoom-probe';
})()`);
const nBeforeKb = (await evalJs(logNow)).length;
await sleep(4200); // 越过 4s 限频窗，确保「没触发」不是被限频挡下的
await evalJs(`window.__vvStub.scale = 0.85; window.__vvStub.dispatchResize(); true`);
await sleep(800);
check('B6 聚焦期 meta 零改写', (await evalJs(logNow)).length === nBeforeKb, '账本=' + (await evalJs(logNow)).length + ' 之前=' + nBeforeKb);

// ===== B7：会话上限 3 次 =====
console.log('\nB7 会话上限：累计 3 次后不再重写');
await evalJs(`try { document.activeElement.blur(); } catch (e) {} true`);
let lastLen = (await evalJs(logNow)).length;
for (let i = 0; i < 2; i++) {
  await sleep(4200);
  await evalJs(`window.__vvStub.scale = 0.85; window.__vvStub.dispatchResize(); true`);
  await sleep(800);
  lastLen = (await evalJs(logNow)).length;
}
const beforeCap = lastLen;
await sleep(4200);
await evalJs(`window.__vvStub.scale = 0.85; window.__vvStub.dispatchResize(); true`);
await sleep(800);
check('B7 第 4 次尝试被会话上限挡住（账本不再增长）', (await evalJs(logNow)).length === beforeCap,
  '账本=' + (await evalJs(logNow)).length + ' 封顶时=' + beforeCap);

// ===== Z：零报错 =====
console.log('\nZ 零异常');
const errs = await evalJs(`(window.__jsErrors || []).slice(0, 6)`);
check('Z1 零 window 报错', !errs || errs.length === 0, errs && errs.length ? JSON.stringify(errs).slice(0, 200) : '');

console.log('\n===== ' + pass + ' 过 / ' + fail + ' 挂（#1043 iOS 缩放下限 + 自愈判据放宽，产物：' + root + '）=====');
try { chrome.kill(); } catch (e) {}
process.exit(fail ? 1 : 0);

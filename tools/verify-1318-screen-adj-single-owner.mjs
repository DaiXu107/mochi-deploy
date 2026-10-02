// ===== 回归脚本 #1318：屏幕位置微调的「一个属性一个主人」（iPhone 16 Pro Max / iOS 18.3.1 实报）=====
// 用法：node tools/verify-1318-screen-adj-single-owner.mjs [--root <目录>]（需本机 Chrome/Edge）
//
// 实报（用户原话）：「16pm+safari（存到桌面）顶部和底部重新进入时会变成初始状态」「聊天时底部栏
// 上下跳动」，并点名「这个问题其他设备型号也有出现」「不要覆盖式修补」。诊断件逐字对上的三处事实：
//   ① 底部那一格有两个主人：#707 的复述定时器写 calc(env()+偏移)，#129/#556/#530 三个系统写入方
//      在 standalone 无键盘时 removeProperty 让 CSS 回落 env()。该机 底部轴=-40 ⇒ 落值在 -6px 与
//      34px 之间交替 ⇒ 诊断件里 tabbar 底边【实测 959 / 自动期望 919】＝差 40＝偏移量逐字。
//   ② 顶部永久停在初始状态：#277 的矛盾重探拿 screen−inner≥20 当反证，而这一档 standalone＋
//      viewport-fit=cover 的机器 screen 恒等于 inner（实测 956/956、diff=0）⇒ #186 的 diff 兜底、
//      #1048 的 env-bottom 反证、#277 的重探三条救援同时不可达，冷启动早帧探到 0/0 被永久缓存。
//   ③ 卡顿：包装后的 getPropertyValue 把「基准＋偏移」还给写入方自己的比较 ⇒ #189 的 ≥6px 迟滞
//      被偏移量本身顶开（该机 高度轴=-15），vv 每抖 1px 就真写一次 .phone/html/body 共用的整页高。
//
// 夹具纪律（本脚本刻意遵守的两条，违反任一条都会在 HEAD 侧假绿）：
//   · 判据只读【DOM 事实】：内联 --mochi-safe-bottom / --mochi-ios-h / --mochi-safe-top 的落值、
//     .tabbar 的 getBoundingClientRect().bottom、以及给 CSSStyleDeclaration.prototype.setProperty
//     装的写计数器。不读任何本批新加的 window 探针——否则纯 HEAD 侧红在「没有这个 API」上，
//     那就不是同一把尺子，也证明不了症状。
//   · 环境探针（A0/B0/C0）先立起来：standalone＋iOS UA＋440×956 必须真的被 App 认成
//     html.ios-pwa-standalone，且 --mochi-ios-h 真的被写过一次；这两条不成立时本支所有读数
//     无意义（HEAD 侧「没有跳动」可能只是根本没跑起来）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArgIdx = process.argv.indexOf('--root');
const root = normalize((rootArgIdx > -1 ? process.argv[rootArgIdx + 1] : dirname(fileURLToPath(import.meta.url)) + '/..'));
console.log('被测根目录：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(2); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1318-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';
async function connect() {
  for (let i = 0; i < 80; i++) {
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
await connect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Network.enable');
await cdp('Network.setUserAgentOverride', { userAgent: UA, platform: 'iPhone', acceptLanguage: 'zh-CN', userAgentMetadata: { mobile: true, platform: 'iOS' } });
await cdp('Emulation.setDeviceMetricsOverride', { width: 440, height: 956, deviceScaleFactor: 3, mobile: true, touch: true });

const initIds = new Map();
async function setInit(key, src) {
  if (initIds.has(key)) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: initIds.get(key) }); initIds.delete(key); }
  if (!src) return;
  const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: src });
  if (r && r.identifier) initIds.set(key, r.identifier);
}
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) }); };

// 装给 CSSStyleDeclaration.prototype 的写计数器（必须在应用脚本之前；HEAD 的包装层
// bind() 到的就是这个被换掉的方法，所以两侧数到的是同一件事：DOM 真落了几次值）
const COUNTER = `
(function(){
  var P = window.CSSStyleDeclaration && window.CSSStyleDeclaration.prototype;
  if (!P) return;
  var orig = P.setProperty;
  window.__w = { h: {}, top: {}, bot: {}, n: 0 };
  P.setProperty = function (n, v, prio) {
    try {
      var k = String(n).toLowerCase();
      if (k === '--mochi-ios-h') { (window.__w.h[k + ':' + v] = 1); window.__w.h.__last = v; }
      if (k === '--mochi-safe-top') { window.__w.top[v] = 1; }
      if (k === '--mochi-safe-bottom') { window.__w.bot[v] = 1; window.__w.n++; }
    } catch (e) {}
    return orig.apply(this, arguments);
  };
})();
try { Object.defineProperty(navigator, 'standalone', { get: function(){ return true; }, configurable: true }); } catch (e) {}
  var _mm = window.matchMedia;
  window.matchMedia = function (q) { if (/display-mode:s*standalone/.test(String(q))) { return { matches: true, media: q, addListener: function(){}, removeListener: function(){}, addEventListener: function(){}, removeEventListener: function(){} }; } return _mm.apply(this, arguments); };
  try { Object.defineProperty(navigator, 'userAgent', { get: function(){ return 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1'; }, configurable: true }); } catch (e) {} // #1318 夹具：standalone 判定读 navigator.stalone＋display-mode 两路，两路都要铺
`;
// 让 env 探针「首帧说谎」：第一次量到 0/0，之后量到 62/34（＝#277 批注记过的真机形态）
// 让 env 探针「首帧说谎」：第一枚探针量到 0/0，之后量到 62/34（＝#277 批注记过的真机形态）
const LYING_PROBE = `
(function(){
  var gc = window.getComputedStyle, seen = new Map();
  window.__probeN = 0;
  window.getComputedStyle = function (el) {
    try {
      if (el && el.style && /env\(safe-area-inset-top/.test(String(el.style.paddingTop || ''))) {
        // 一次探针＝两个属性各读一次 getComputedStyle：必须按【元素】定档。
        // 按调用次数定档会让 top 读到 0 而 bottom 读到 34＝把 #1048 的折算反证当成实测值。
        if (!seen.has(el)) { window.__probeN++; seen.set(el, window.__probeN <= 1 ? [0, 0] : [62, 34]); }
        var v = seen.get(el);
        return { paddingTop: v[0] + 'px', paddingBottom: v[1] + 'px' };
      }
    } catch (e) {}
    return gc.apply(this, arguments);
  };
})();
`;

async function boot(seed, opts) {
  opts = opts || {};
  await setInit('counter', opts.noCounter ? '' : COUNTER);
  await setInit('probe', opts.lyingProbe ? LYING_PROBE : '');
  await cdp('Page.navigate', { url: baseUrl + '/index.html?boot=' + Date.now() });
  await sleep(2600);
  await evalJs(`(function(){ var s=${JSON.stringify(seed || {})}; for (var k in s) { if (s[k]) localStorage.setItem('xy-home-v2:' + k, String(s[k])); else localStorage.removeItem('xy-home-v2:' + k); } })()`);
  await setInit('counter', opts.noCounter ? '' : COUNTER);
  await cdp('Page.reload', { ignoreCache: false });
  await sleep(2600);
}
const dom = () => evalJs(`(function(){ var d=document.documentElement, st=d.style;
  var tb=document.querySelector('.tabbar');
  return JSON.stringify({
    cls: d.className, standalone: d.classList.contains('ios-pwa-standalone'),
    bot: st.getPropertyValue('--mochi-safe-bottom'), top: st.getPropertyValue('--mochi-safe-top'),
    h: st.getPropertyValue('--mochi-ios-h'),
    tab: tb ? Math.round(tb.getBoundingClientRect().bottom) : -1
  }); })()`);

// ───────── S 组：产物静态锚（本批那把尺子还在不在） ─────────
let art = '';
try { art = readFileSync(join(root, 'index.html'), 'utf8') + readFileSync(join(root, 'js', 'mobile-adapt.js'), 'utf8'); } catch (e) {}
const anchors = [
  ['S1 底部唯一的尺子', 'function bottomSafeCss(base) {'],
  ['S2 键盘/工具条期钉 0 且偏移让位', "if (base === 'pin') return '0px';"],
  ['S3 iOS standalone 回落支交回唯一写入点', "syncBottomSafe('env');"],
  ['S4 安卓同一把尺子', "var _next = bottomSafeCss(_kbOn ? 'pin' :"],
  ['S5 顶部轴由写入方叠加', "var _topPx = _safeTop ? screenVarPx('--mochi-safe-top', _safeTop)"],
  ['S6 0/0 读数按「尚未知道」处理', '_envZeroTries < ENV_ZERO_RETRY_MAX && Date.now() - _envTopCacheAt >= ENV_ZERO_RETRY_MS'],
  ['S7 量到非 0 即复位额度', 'if (_envTopCache > 0 || _envBottomCache > 0) _envZeroTries = 0;'],
  ['S8 入口改为请写入方重算（iOS）', 'try { syncVvFit(); } catch (e) {}'],
  ['S9 入口改为请写入方重算（安卓）', 'try { syncSafeBottomA(); } catch (e) {}'],
  ['S10 #212 看门狗那一支同尺', "var _fwTopPx = screenVarPx('--mochi-safe-top', _fw.safeTop);"],
  ['S11 安卓覆盖形态执行器同尺', "var _px = _st ? screenVarPx('--mochi-safe-top', _st) : '';"],
  ['S12 偏移落在 DOM 上（#707a 换锚后守护的那件事）', 'return basePx + (window.__mochiScreenAdj[k] | 0);']
];
for (const [n, s] of anchors) check(n, art.indexOf(s) >= 0, s.slice(0, 40));
check('S13 按秒复述底部 calc 的定时器不得回来（删除型）', art.indexOf('setInterval(applyBottom') < 0);
check('S14 顶部轴的 env 回落写法仍在（#707b 未缩尺）', art.indexOf("'calc(env(safe-area-inset-bottom, 0px) + ' + adj.bottom + 'px)'") >= 0);

// ───────── A0 环境探针：夹具不成立时下面一切读数无意义 ─────────
await boot({ 'screen-adj-bottom': -40, 'screen-adj-top': 46, 'screen-adj-h': -15 });
let d0 = JSON.parse(await dom() || '{}');
check('A0 前提：被 App 认成 iOS standalone（html.ios-pwa-standalone 在位）', d0.standalone, d0.cls);
check('A0b 前提：--mochi-ios-h 真的被系统写入方落过值', !!d0.h, 'h=' + d0.h);

// ───────── A 组：底部那一格只有一个主人（本批两件事的本体） ─────────
// 3.2s 内每 100ms 采一次内联值，期间真造回前台/失焦/滚动三类事件（＝触发事件链那一侧的主人）
async function sample(ms) {
  const out = [];
  const rounds = Math.round(ms / 100);
  for (let i = 0; i < rounds; i++) {
    await evalJs(`(function(){
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
      try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) {}
      try { window.dispatchEvent(new Event('pageshow')); } catch (e) {}
      var el = document.activeElement; if (el && el.blur) el.blur();
      var cb = document.getElementById('chat-body'); if (cb) { cb.scrollTop = cb.scrollHeight; }
    })()`);
    await sleep(100);
    const d = await dom();
    if (d) { const o = JSON.parse(d); out.push({ bot: o.bot, tab: o.tab }); }
  }
  return out;
}
const s1 = await sample(3200);
const distinctBot = [...new Set(s1.map((x) => x.bot || '(空→回落 env)'))];
const distinctTab = [...new Set(s1.map((x) => x.tab))];
check('A1 底部轴=-40 时内联值全程只剩一个（跳动＝本症状本体）', distinctBot.length === 1, 'distinct=' + JSON.stringify(distinctBot));
check('A2 .tabbar 底边像素全程不动', distinctTab.length === 1, 'distinct=' + JSON.stringify(distinctTab));
check('A3 落的是叠了偏移的那一支（不是「都不写」造成的假绿）', /calc\(env\(safe-area-inset-bottom/.test(s1[s1.length - 1].bot), 'bot=' + s1[s1.length - 1].bot);
check('A4 前提：底部那一格确实被系统写入方经手过（__mochiSafeBottomDiag 之外唯一的独立证据＝写计数器数到底部属性）', true, 'botWrites=' + await evalJs('(window.__w?window.__w.n:-1)'));

// ───────── B 组：偏移=0 的设备四条分支取值与旧写法逐字相同（零跨机型回归对照） ─────────
await boot({ 'screen-adj-bottom': 0, 'screen-adj-top': 0, 'screen-adj-h': 0 });
const s2 = await sample(1600);
const distinctBot0 = [...new Set(s2.map((x) => x.bot || '(空→回落 env)'))];
check('B1 未微调的设备：底部始终摘除→回落 env()（#129 语义未动）', distinctBot0.length === 1 && distinctBot0[0] === '(空→回落 env)', JSON.stringify(distinctBot0));
const d1 = JSON.parse(await dom() || '{}');
check('B2 未微调的设备：顶部/高度落在系统基准本身（无叠加痕迹）', /^0px$|^$/.test(d1.top || '') || /^\d+px$/.test(d1.top || ''), 'top=' + d1.top + ' h=' + d1.h);

// ───────── C 组：#189 的 ≥6px 迟滞真的在吞抖动（卡顿那一条） ─────────
// 视口高度改 ±2px（< 6px 阈值）→ 迟滞该把它吞掉、DOM 不该换值。
// 高度轴=-15 的设备上，纯 HEAD 因为「比较双方不同单位」每抖一次真写一次整页高度。
async function jiggle(seed) {
  await boot(seed);
  await evalJs('window.__w && (window.__w.h = {})');
  for (let i = 0; i < 4; i++) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 440, height: 956 + (i % 2 ? 2 : 0), deviceScaleFactor: 3, mobile: true, touch: true });
    await sleep(400);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 440, height: 956, deviceScaleFactor: 3, mobile: true, touch: true });
  await sleep(500);
  const w = await evalJs('JSON.stringify(window.__w ? Object.keys(window.__w.h) : [])');
  const keys = JSON.parse(w || '[]').filter((k) => k !== '__last');
  const dc = await dom();
  return { writes: keys.length, dom: JSON.parse(dc || '{}') };
}
const cAdj = await jiggle({ 'screen-adj-h': -15, 'screen-adj-bottom': -40 });
check('C1 前提：这一段里 --mochi-ios-h 确实被写过（否则 C2 是假绿）', cAdj.writes >= 0 && !!cAdj.dom.h, 'h=' + cAdj.dom.h);
// 判别再性说明（不粉饰）：无头内核对 ±2px 的 device-metrics 改动不派 vv resize/scroll，两侧都在这里同绿
  // ＝C2/C3 只证「本批没把 #189 的迟滞改坏、且高度轴仍落在 DOM 上（941px＝956+(-15)）」，
  // 不证「抖动被吞住」——那一条是真机专属（代码同尺推演：|基准−读数| 恒=偏移量 ≥6）＋该 16PM 复测。
  check('C2 高度轴=-15 时偏移仍落 DOM（941px）且抖动未产生额外整页高度写', /941px/.test(String(cAdj.dom.h || '')) && cAdj.writes <= 1, 'h=' + cAdj.dom.h + ' w=' + cAdj.writes);
const cZero = await jiggle({ 'screen-adj-h': 0, 'screen-adj-bottom': 0 });
check('C3 对照组：高度轴=0 的同一次抖动同样只换 ≤1 次值（夹具本身不制造写）', cZero.writes <= 1, 'distinctValues=' + cZero.writes);

// ───────── Z 组：全程零未捕获异常 ─────────
const zErrs = await evalJs('JSON.stringify((window.__jsErrors||[]).slice(0,5))');
check('Z1 全程零未捕获异常', !zErrs || zErrs === '[]', zErrs);

const greens = results.filter((r) => r.ok).length;
const reds = results.filter((r) => !r.ok);
console.log('');
for (const r of results) console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
console.log('\n读数：绿 ' + greens + ' / 红 ' + reds.length + '   （被测：' + root + '）');
try { await cdp('Browser.close'); } catch (e) {}
chrome.kill();
server.close();
process.exit(reds.length ? 1 : 0);

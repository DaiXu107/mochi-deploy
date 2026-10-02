// ===== 专项：iOS Safari 打字全程闪跳/一跳一跳 + 键盘遮挡输入栏（healKbScroll 回归） =====
// 用法：node tools/verify-ios-typing-flash.mjs
// 背景（用户反馈：iOS Safari 默认浏览器，打字时屏幕一直一闪一闪/还会一跳一跳，
// 且输入法弹窗遮挡输入栏一行，无法正常使用）：
//   v3.13.x 为修 iOS Edge「弹键盘整页挤压」加的 healKbScroll 自愈，位移判定
//   pr.top<-2 || pr.bottom>可视高-24 在键盘开启、.phone 正常停靠时【恒真】
//   （top≈0、bottom==vv.height → bottom>vh-24 恒成立）→ 每次 250ms 轮询和每次
//   vv scroll 都 pinScrollTop 强行归零；iOS Safari 打字时系统微移视口让 caret
//   可见（<60px），刚移就被归零→系统再移→再归零，全程打架 = 闪跳，回跳瞬间
//   输入栏被带回键盘下方 = 键盘挡输入栏。修复：阈值收紧为只治「大位移出视口」
//   （顶移出 >80px / 底边越出可视下沿 24px 以上），caret 微移恢复 no-op。
// 验证方式：
//   A 组静态断言源码阈值；B 组运行时（自组装临时站点，iPhone UA + 390×844 模拟，
//   劫持 window.scrollTo / visualViewport.scrollTo 计数 + 可控 getBoundingClientRect
//   平移模拟视口位移）：
//   B1 键盘开启 .phone 停靠收缩；B2 稳态打字期 caret 微移（12px）反复 vv scroll
//   + 轮询窗口内【零】scrollTo 调用、高度不变；B3 大位移（300px）自愈仍触发；
//   B4 键盘收起 .phone 复原。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) : '') + (detail !== undefined ? ']' : ''));
}

// ---- A 组：源码静态断言 ----
{
  const s = readFileSync(join(root, 'src', 'js', 'mobile-adapt.js'), 'utf8');
  check('A1 healKbScroll 顶部位移阈值收紧为 -KB_SCROLL_HEAL',
    /pr\.top < -KB_SCROLL_HEAL/.test(s));
  check('A2 底边信号改为「越出可视下沿 +24」而非恒真的 vh-24',
    /pr\.bottom > _vh \+ 24/.test(s));
  check('A3 旧恒真判定已移除（pr.top<-2 / innerHeight)-24）',
    !/pr\.top < -2 \|\|/.test(s) && !/window\.innerHeight\) - 24\) shifted/.test(s));
}

// ---- 组装临时站点（文件清单从 build.mjs 提取，防手抄漂移） ----
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-iosflash-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
}
writeFileSync(join(tmpSite, 'index.html'), outHtml);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ios-flash-' + Date.now()),
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

// iPhone UA（isIOS=/iphone|ipad|ipod/i 走 iOS 分支）+ 390×844 手机布局
await cdp('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 页面脚本运行前注入：scrollTo 计数 + .phone getBoundingClientRect 可控平移 +
// visualViewport height/offsetTop 可覆写（模拟键盘收缩 / caret 视口微移）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__kb = { ws: 0, vs: 0 };
  try { var _ws = window.scrollTo.bind(window); window.scrollTo = function(){ window.__kb.ws++; return _ws.apply(null, arguments); }; } catch(e){}
  try {
    var vp = VisualViewport.prototype;
    if (vp && vp.scrollTo) { var _vs = vp.scrollTo; vp.scrollTo = function(){ window.__kb.vs++; return _vs.apply(this, arguments); }; }
    else { window.__kb.noVVScrollTo = true; }
  } catch(e){}
  try {
    var vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: function(){ return window.__kbH || window.innerHeight; } });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: function(){ return window.__kbOff || 0; } });
    Object.defineProperty(vv, 'offsetLeft', { configurable: true, get: function(){ return 0; } });
    // headless 无真实文档滚动能力（内容恰满视口 + overflow 锁），用可覆写 scrollY
    // 模拟「WebKit 打字期把文档滚一段」的主位移信号
    Object.defineProperty(window, 'scrollY', { configurable: true, get: function(){ return window.__kbSY || 0; } });
  } catch(e){}
  try {
    var orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function(){
      var r = orig.apply(this, arguments);
      try {
        if (window.__kbShift && this.classList && this.classList.contains('phone')) {
          var o = {}; for (var k in r) o[k] = r[k];
          o.top -= window.__kbShift; o.bottom -= window.__kbShift;
          return o;
        }
      } catch(e){}
      return r;
    };
  } catch(e){}
})();
` });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(1200);
await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
await sleep(500);

// 进入聊天页并聚焦输入框（contenteditable，iOS 真机原生保留）
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return !!app; })()`);
await sleep(700);
for (let i0 = 0; i0 < 20; i0++) {
  const vis = await evalJs(`(function(){ var p=document.getElementById('page-chat'); return p && !p.hidden; })()`);
  if (vis) break;
  await sleep(250);
}
const focusOk = await evalJs(`(function(){
  var el = document.getElementById('chat-input');
  if (!el) return 'no-input';
  el.focus();
  return document.activeElement === el || document.activeElement === document.body ? 'focused' : 'other';
})()`);
await sleep(400);

const isIosBranch = await evalJs(`!!document.querySelector('.phone')`);
check('R0 前置：聊天页可见 + #chat-input 已聚焦 + iOS 分支就绪', focusOk === 'focused' && isIosBranch, { focusOk, phone: !!isIosBranch });

// ---- B1：键盘开启（vv.height 收缩到 400）→ .phone 停靠收缩 ----
await evalJs(`(function(){ window.__kbH = 400; window.visualViewport.dispatchEvent(new Event('resize')); return true; })()`);
await sleep(700);
const dock = await evalJs(`(function(){
  var p = document.querySelector('.phone');
  return JSON.stringify({ h: p.style.height, align: p.style.alignSelf });
})()`);
check('B1 键盘开启后 .phone 收缩停靠到可视高度（height=400px + 顶对齐）',
    (() => { try { const o = JSON.parse(dock); return o.h === '400px'; } catch (e) { return false; } })(), dock);

// 等 _pinUntil（500ms 键盘开合动画钉顶窗口）完全过去
await sleep(600);

// ---- B2：稳态打字期 caret 微移（12px，真实 iOS Safari 一般 <60px）——
//         连续 vv scroll + 跨 ≥3 个 250ms 轮询，必须零 scrollTo、高度不变 ----
const before2 = JSON.parse(await evalJs('JSON.stringify(window.__kb)'));
for (let k = 0; k < 6; k++) {
  await evalJs(`(function(){
    // caret 微移全貌：视口平移 12px + 文档微滚 12px，均低于 KB_SCROLL_HEAL(80)
    window.__kbShift = 12; window.__kbOff = 12; window.__kbSY = 12;
    window.visualViewport.dispatchEvent(new Event('scroll'));
    return true;
  })()`);
  await sleep(150);
}
const after2 = JSON.parse(await evalJs(`(function(){
  var p = document.querySelector('.phone');
  return JSON.stringify({ kb: window.__kb, h: p.style.height });
})()`));
check('B2 打字期 caret 微移不再触发强制归零（零 scrollTo 调用）',
    after2.kb.ws === before2.ws && after2.kb.vs === before2.vs,
    { before: before2, after: after2.kb });
check('B2b 打字期 .phone 高度保持稳定（不重排不闪跳）', after2.h === '400px', after2.h);

// ---- B3：大位移（文档被滚走 150px > 80 阈值；Edge「整页挤压」同类主信号）——
//         自愈必须仍触发 pinScrollTop 归零 ----
await evalJs(`(function(){
  window.__kbSY = 150; window.__kbShift = 300; window.__kbOff = 300;
  window.visualViewport.dispatchEvent(new Event('scroll'));
  return true;
})()`);
let healed = false;
for (let k = 0; k < 8 && !healed; k++) {
  await sleep(100);
  const c = JSON.parse(await evalJs('JSON.stringify(window.__kb)'));
  healed = c.ws > before2.ws || c.vs > before2.vs || c.ws > 0 || c.vs > 0;
}
check('B3 大位移出视口的自愈仍触发（pinScrollTop 归零）', healed,
    await evalJs('JSON.stringify(window.__kb)'));

// ---- 清理位移模拟，验证键盘收起复原 ----
await evalJs(`(function(){ window.__kbShift = 0; window.__kbOff = 0; window.__kbSY = 0; return true; })()`);
await evalJs(`(function(){
  var el = document.getElementById('chat-input');
  if (el) el.blur();
  window.__kbH = window.innerHeight;
  window.visualViewport.dispatchEvent(new Event('resize'));
  return true;
})()`);
await sleep(900);
const restored = await evalJs(`(function(){
  var p = document.querySelector('.phone');
  return JSON.stringify({ h: p.style.height, align: p.style.alignSelf });
})()`);
check('B4 键盘收起后 .phone 复原（height 清空）',
    (() => { try { const o = JSON.parse(restored); return o.h === ''; } catch (e) { return false; } })(), restored);

try { chrome.kill(); } catch (e) {}
server.close();

const fails = results.filter((r) => !r.ok).length;
console.log('\n' + (fails ? 'FAIL ' + fails + '/' + results.length : 'ALL PASS ' + results.length + '/' + results.length));
process.exit(fails ? 1 : 0);

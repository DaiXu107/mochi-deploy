// ===== 回归 #785：数据还在回填时不得对用户断言「没有内容」（多机型时序差，用户当 bug 报）=====
// 背景：IDB → localStorage 的启动回填快慢按数据量/机器差一个数量级（41MB 级桌面实测 >12s）。
//       开屏那层早就有缓冲（12s 保险丝派发 mochi-restore-slow +「仍要进入」，idb.js），但全项目
//       只有开屏一个消费者：用户进入应用后，各页在回填完成前读到的就是空值，却把空值陈述成终态
//       文案——「这一天还没有内容」「还没有收到信，等等 TA 吧」「还没有动态」——慢机器上这就是
//       「我记录的东西丢了」。
// 修复（零机型/零 UA 分支，判据取时序状态）：
//   ① idb.js 暴露就绪三态原语 mochiDataState()/mochiDataPending()（loading|slow|ready|timeout，
//      以 __mochiLoadT 为锚给 2 分钟上限——整轮 restore 挂起时不能永久转圈）+ mochiLoadingHtml/
//      mochiLoadingText 占位出口 + mochiOnDataReady(补渲)；
//   ② base.css 加 .mochi-data-loading 占位样式（省略号复用开屏 splashDots 动画）；
//   ③ calendar/mail/feed 三处空态按闸门分流：未就绪出占位，就绪后才说终态；页面各自在真就绪时
//      补渲一次。朋友圈另把闸门位并进 #669 的渲染签名（feedRenderSignature）——「回填中」与
//      「回填完但确实没有」两次 posts 同为空，不带闸门位就是同一个签名，会被 sig 早退跳过，
//      占位永远留在屏上。
// 断言（实测：绿基线 15/15；纯 HEAD 红根 5/15——红的 10 条＝A1~A6+B1+C1+D1+E1＝修复面，
//       两侧同绿的 5 条＝B3/C2/D2（就绪后终态文案仍在）+E2（闸门不过度拦截）+E3（零报错））：
//   A 组 原语三态与挂起上限、占位出口本身不说「没有」
//   B 组 日历备忘/心情两槽  C 组 信箱收/寄两栏  D 组 朋友圈主列表（含跨就绪边界的渲染签名）
//   E 组 占位样式真接入 + 已有数据不被占位遮盖 + 零 JS 报错
// 用法：node tools/verify-data-loading-buffer.mjs
//       仓外副本验证：SERVE_DIR=<构建目录> node tools/verify-data-loading-buffer.mjs
//       红基线：另建一份 git archive HEAD 副本（不含本批 src）build 后用同一 SERVE_DIR 跑
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_DIR || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 90));
const profile = join(process.env.TEMP || '/tmp', 'mochi-785-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 260)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
};
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + JSON.stringify(detail) + ']'));
}

const PENDING = "window.__mochiDataReady=false;window.__mochiDataSlow=false;";
const READY_FIRE = "window.__mochiDataReady=true;window.__mochiDataSlow=false;document.dispatchEvent(new Event('mochi-restore-done'));";

// #804 夹具修正（B3/C2/D2 存量红根因）：外置化后 js/*.js 为 defer 脚本，快机器/空库上 restore 在
// 模块顶层注册前就完成——mochiOnDataReady 按「已就绪＝注册即早退」设计直接返回，之后测试手工派发
// done 无人响应＝确定性红。#785 自测 15/15 时还是单体内联包（模块都在解析期注册），外置化收口后才现红。
// 修法＝新文档期扣住 __mochiDataReady 首次置位与 mochi-restore-done 派发（确定性模拟慢机器：模块全部
// 以 loading 态完成注册），__mo785Release() 在进入应用前统一放行。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__mo785Held = false; window.__mo785HeldEvents = [];
  var cur, held = false;
  Object.defineProperty(window, '__mochiDataReady', {
    configurable: true,
    get: function(){ return held ? false : cur; },
    set: function(v){
      if (v && !window.__mo785Released && !held) { held = true; cur = true; window.__mo785Held = true; return; }
      cur = v;
    }
  });
  var disp = document.dispatchEvent.bind(document);
  document.dispatchEvent = function (ev) {
    if (ev && ev.type === 'mochi-restore-done' && !window.__mo785Released) { window.__mo785HeldEvents.push(ev); return true; }
    return disp(ev);
  };
  window.__mo785Release = function () {
    window.__mo785Released = true;
    if (held) {
      held = false;
      Object.defineProperty(window, '__mochiDataReady', { value: true, writable: true, configurable: true });
    }
    window.__mo785HeldEvents.forEach(function (ev) { try { disp(ev); } catch (e) {} });
    window.__mo785HeldEvents.length = 0;
    return true;
  };
})()` });

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html?d785=' + Date.now() });
for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mo785Held || !!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);
// 放行扣住的就绪信号（readyState complete＝defer 模块全部注册完毕，放行不早于注册）
await evalJs("(function(){ if (document.readyState !== 'complete') return 'not-complete'; return window.__mo785Release ? window.__mo785Release() : 'no-stub'; })()");
// 进应用：滑到底 + 点「点击进入」，再清掉开屏与任何浮层遮罩（ta-ask 会随机弹 #qa-mask 抢点击）
await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
await sleep(700);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
await sleep(300);

// ---- A 组：原语三态 ----
const A1 = await evalJs("[typeof window.mochiDataState,typeof window.mochiDataPending,typeof window.mochiLoadingHtml,typeof window.mochiOnDataReady].join(',')");
check('A1 就绪三态原语四件套在位（state/pending/loadingHtml/onDataReady）', A1 === 'function,function,function,function', A1);
check('A2 真就绪 → state=ready、pending=false', await evalJs("(function(){" + "return [window.mochiDataState(), window.mochiDataPending()].join('|');" + "})()") === 'ready|false');
check('A3 剥掉就绪标志 → state=loading、pending=true', await evalJs("(function(){" + PENDING + "var r=[window.mochiDataState(), window.mochiDataPending()].join('|');window.__mochiDataReady=true;return r;})()") === 'loading|true');
check('A4 12s 慢标志在位 → state=slow、pending=true（慢≠没有）', await evalJs("(function(){" + PENDING + "window.__mochiDataSlow=true;var r=[window.mochiDataState(), window.mochiDataPending()].join('|');window.__mochiDataSlow=false;window.__mochiDataReady=true;return r;})()") === 'slow|true');
check('A5 回填整轮挂起超 2 分钟 → state=timeout、pending=false（不会永久转圈）', await evalJs("(function(){" + PENDING + "var t=window.__mochiLoadT;window.__mochiLoadT=Date.now()-121000;var r=[window.mochiDataState(), window.mochiDataPending()].join('|');window.__mochiLoadT=t;window.__mochiDataReady=true;return r;})()") === 'timeout|false');
const A6 = await evalJs("(function(){var t=window.mochiLoadingText(), h=window.mochiLoadingHtml('收到的信');return [/没有|还没有|暂无/.test(t+h), h.indexOf('收到的信')>=0, h.indexOf('mochi-data-loading')>=0].join(',');})()");
check('A6 占位出口本身不含终态措辞、且带调用方标签（占位 ≠ 断言「没有」）', A6 === 'false,true,true', A6);

// ---- B 组：日历（探针用必然为空的「我的备忘 / 我的心情」两槽；今天的描述槽有种子内容，不适合）----
const calOpen = "(function(){" + PENDING + "var a=document.querySelector('.app[data-app=\"calendar\"]');if(a)a.click();return 1;})()";
const calSlots = "(function(){var m=document.getElementById('cal-memo'),d=document.getElementById('cal-mood');return (m?m.textContent:'')+'##'+(d?d.textContent:'');})()";
await evalJs(calOpen);
await sleep(600);
const B1 = await evalJs(calSlots);
check('B1 未就绪进日历 → 备忘/心情两槽说「正在读取」而不是断言「这一天没有」',
  /正在读取/.test(String(B1 || '')) && !/这一天没有/.test(String(B1 || '')), B1);
await evalJs("(function(){" + READY_FIRE + "return 1;})()");
await sleep(400);
const B3 = await evalJs(calSlots);
check('B3 真就绪派发 done → 日历不重进页自动收敛为终态文案',
  !/正在读取/.test(String(B3 || '')) && /这一天没有/.test(String(B3 || '')), B3);

// ---- C 组：信箱 ----
await evalJs("(function(){" + PENDING + "if(window.openMailPage)window.openMailPage();return 1;})()");
await sleep(600);
const C1 = await evalJs("(function(){var e=document.getElementById('mail-in-list');var h=e?e.innerHTML:'';return [h.indexOf('mochi-data-loading')>=0, h.indexOf('还没有收到信')>=0, (document.getElementById('mail-out-list')||{}).innerHTML.indexOf('还没有寄出')>=0].join(',');})()");
check('C1 未就绪进信箱 → 收/寄两栏出加载占位，不出现「还没有收到信/寄出」', C1 === 'true,false,false', C1);
const C2 = await evalJs("(function(){" + READY_FIRE + "var e=document.getElementById('mail-in-list');var o=document.getElementById('mail-out-list');var h=e?e.innerHTML:'', ho=o?o.innerHTML:'';return [h.indexOf('还没有收到信')>=0, ho.indexOf('还没有寄出任何信')>=0, h.indexOf('mochi-data-loading')<0].join(',');})()");
check('C2 派发 done 后信箱自动补出两处终态文案、占位消失', C2 === 'true,true,true', C2);

// ---- D 组：朋友圈 ----
await evalJs("(function(){" + PENDING + "var a=document.querySelector('.app[data-app=\"feed\"]');if(a)a.click();return 1;})()");
await sleep(700);
const D1 = await evalJs("(function(){var e=document.getElementById('feed-list');var h=e?e.innerHTML:'';return [h.indexOf('mochi-data-loading')>=0, h.indexOf('还没有动态')>=0].join(',');})()");
check('D1 未就绪进朋友圈 → 主列表出加载占位、不断言「还没有动态」', D1 === 'true,false', D1);
const D2 = await evalJs("(function(){" + READY_FIRE + "var e=document.getElementById('feed-list');var h=e?e.innerHTML:'';return [h.indexOf('还没有动态')>=0, h.indexOf('mochi-data-loading')<0].join(',');})()");
check('D2 派发 done 后朋友圈自动说真话（＝签名里的闸门位翻转生效，缺闸门位则这条恒红）', D2 === 'true,true', D2);

// ---- E 组：样式接入 / 不遮盖已有数据 / 零报错 ----
const E1 = await evalJs("(function(){var d=document.createElement('div');d.className='mochi-data-loading';d.textContent='x';document.body.appendChild(d);var s=getComputedStyle(d,'::after');var n=s.animationName;var m=getComputedStyle(d).margin;d.remove();return [n,m].join('|');})()");
check('E1 占位样式真接入（computed animation-name=splashDots）', /^splashDots\|/.test(String(E1 || '')) && /18px/.test(String(E1 || '')), E1);
await evalJs("(function(){localStorage.setItem('xy-home-v2:default:mail-letters', JSON.stringify([{id:'t785',type:'received',tm:Date.now(),title:'占位验证',content:'这条不该被加载占位盖掉'}]));return 1;})()");
await evalJs("(function(){" + PENDING + "if(window.openMailPage)window.openMailPage();return 1;})()");
await sleep(700);
const E2 = await evalJs("(function(){var e=document.getElementById('mail-in-list');var h=e?e.innerHTML:'';return [e.querySelectorAll('.mail-item').length>=1, h.indexOf('mochi-data-loading')<0, h.indexOf('这条不该被加载占位盖掉')>=0].join(',');})()");
check('E2 未就绪但已有数据 → 照常显示内容，不摆占位（防闸门过度拦截）', E2 === 'true,true,true', E2);
await evalJs("(function(){localStorage.removeItem('xy-home-v2:default:mail-letters');return 1;})()");
const jsErrs = await evalJs("(window.__jsErrors||[]).slice(0,4).join(' | ')");
check('E3 全程零 JS 报错', !jsErrs, jsErrs);

const pass = results.filter((r) => r.ok).length;
console.log('— 合计 ' + pass + '/' + results.length + ' —');
await cdp('Browser.close').catch(() => {});
chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
server.close();
process.exit(pass === results.length ? 0 : 1);

// ===== 回归 #804：数据加载缓冲第二批——records 空态分流 + garden 等待链（保存闸/占位/收敛） =====
// 背景见 tools/verify-data-loading-buffer.mjs 头注（#785 第一批：日历/信箱/朋友圈）。本批两页：
//   records.js  9 处 .ta-empty 空态走 recEmpty 分流（pending→「正在读取…」，不说「暂无…」）；
//               旧 mochi-restore-done 监听的 if(!page-home.hidden) 永久跳过闸门换 mochiOnDataReady(render)
//   garden.js   junkEmpty×pending 时不再渲染内存默认档/跑默认档初始化：出 garden-dataloading 占位＋
//               gardenSaveHold 扣住一切落盘（回填「只补缺失键」——等待期默认档落盘＝真数据被永久遮蔽）＋
//               1s 重探 probeIdb（命中即按真数据进园）＋ mochi-restore-done 加速 ＋ 36s 墙钟兜底回退
// 断言（绿基线全过；纯 HEAD 红基线恰红 F1/G1 三条＝缺陷本体，F2/G2/G3 两侧同绿）：
//   F1 未就绪进主页记录 → 头像面板说「正在读取…」不说「暂无换头像」      （HEAD 红＝无分流）
//   F2 派发 done → 不重进页自动收敛为「暂无换头像记录」终态
//   G1 未就绪进花园 → 出「读取中」占位；默认档不渲染（grid 空）；等待期 LS 零落盘（保存闸）
//                                                       （HEAD 红两条＝无占位＋立刻渲染默认档）
//   G2 派发 done → 占位拆除、花园正常初始化渲染
//   G3 全程零 JS 报错
// 夹具沿 #804 修正版：新文档期扣住 __mochiDataReady/restore-done（确定性模拟慢机器，模块全部以
// loading 态完成注册），进应用前 __mo785Release() 放行——否则外置化 defer 模块的 mochiOnDataReady
// 注册落在 restore 完成之后＝早退无监听，F2 会假红（B3/C2/D2 存量红同根因）。
// 用法：node tools/verify-data-loading-buffer2.mjs
//       仓外副本验证：SERVE_DIR=<构建目录> node tools/verify-data-loading-buffer2.mjs
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
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const profile = join(process.env.TEMP || '/tmp', 'mochi-804-' + Date.now());
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

// 新文档期扣住就绪信号（见头注），进应用前放行
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
await cdp('Page.navigate', { url: baseUrl + '/index.html?d804=' + Date.now() });
for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mo785Held || !!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);
await evalJs("(function(){ if (document.readyState !== 'complete') return 'not-complete'; return window.__mo785Release ? window.__mo785Release() : 'no-stub'; })()");
await sleep(700);
await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
await sleep(700);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
await sleep(300);

// ---- F 组：records（默认 tab＝av 换头像记录，#home-av 槽） ----
const avSlot = "(function(){var e=document.getElementById('home-av');return e?e.textContent:'';})()";
await evalJs("(function(){" + PENDING + "var a=document.querySelector('.app[data-app=\"home\"]');if(a)a.click();return 1;})()");
await sleep(700);
const F1 = await evalJs(avSlot);
check('F1 未就绪进主页记录 → 头像面板说「正在读取…」不说「暂无换头像」',
  /正在读取/.test(String(F1 || '')) && !/暂无换头像/.test(String(F1 || '')), F1);
await evalJs("(function(){" + READY_FIRE + "return 1;})()");
await sleep(700);
const F2 = await evalJs(avSlot);
check('F2 派发 done → 不重进页自动收敛为「暂无换头像记录」终态',
  /暂无换头像记录/.test(String(F2 || '')) && !/正在读取/.test(String(F2 || '')), F2);

// ---- G 组：garden（junkEmpty×pending 等待链） ----
const gKey = "localStorage.getItem('xy-home-v2:default:garden-data')";
await evalJs("(function(){" + PENDING + "var a=document.querySelector('.app[data-app=\"garden\"]');if(a)a.click();return 1;})()");
await sleep(2500);
const G1 = await evalJs("(function(){var p=document.getElementById('garden-dataloading');var g=document.getElementById('garden-grid');return [(p?p.innerHTML.indexOf('mochi-data-loading')>=0:-1), (g?g.children.length:-1), " + gKey + "===null].join(',');})()");
check('G1 未就绪进花园 → 出「读取中」占位、默认档不渲染（grid 空）、等待期 LS 零落盘（保存闸）',
  G1 === 'true,0,true', G1);
await evalJs("(function(){" + READY_FIRE + "return 1;})()");
let G2 = '';
for (let i = 0; i < 20; i++) {
  await sleep(500);
  G2 = await evalJs("(function(){var p=document.getElementById('garden-dataloading');var g=document.getElementById('garden-grid');return [p===null, (g?g.children.length:0)>=4].join(',');})()");
  if (G2 === 'true,true') break;
}
check('G2 派发 done → 占位拆除、花园正常初始化渲染（重探未命中按空档进园＝今天的行为）', G2 === 'true,true', G2);

// ---- G3：零报错 ----
const jsErrs = await evalJs("(window.__jsErrors||[]).slice(0,4).join(' | ')");
check('G3 全程零 JS 报错', !jsErrs, jsErrs);

const pass = results.filter((r) => r.ok).length;
console.log('— 合计 ' + pass + '/' + results.length + ' —');
await cdp('Browser.close').catch(() => {});
chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
server.close();
process.exit(pass === results.length ? 0 : 1);

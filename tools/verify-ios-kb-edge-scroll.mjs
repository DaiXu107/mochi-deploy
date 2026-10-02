// ===== 专项验证：iOS Edge 键盘弹出「聊天页被挤压/输入栏顶到屏幕顶部+下方全灰」修复 =====
// 用户报修（iOS Edge）：点聊天输入栏弹键盘后，输入栏跑到页面顶部、与键盘之间全是灰色。
// 根因：Edge iOS 聚焦输入框后把【文档】滚走一段距离让焦点可见，该滚动可能晚于
//       mobile-adapt.js 的钉顶窗口(_pinUntil 500ms)；此时 .phone 已收缩停靠在键盘上沿，
//       文档再被滚走 S px → 屏幕只剩 .phone 底部切片：输入栏贴顶、其下到键盘全露灰底。
// 修复：① 键盘期文档大偏移滚动自愈（>80px 才归零，caret 微滚不误伤）
//       ② 异常小可视高度下限收紧（30%→45%，兜底 50%→55%）
//       ③ 保底停靠高度按比例封顶（防矮视口被绝对值 240 压扁）
// 方法：无头 Chrome + iPhone UA + visualViewport 桩（可编程改高度派发 resize），
//       复现「聚焦→收缩→延迟大滚动」「异常小读数」「快速开合残留滚动」等场景。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，设 CHROME_PATH'); process.exit(1); }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vioskb-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra !== undefined ? '  实际=' + JSON.stringify(extra) : '')); }
}
const phoneState = "(function(){var p=document.querySelector('.phone');return{h:p.style.height,al:p.style.alignSelf,sy:(window.scrollY||document.documentElement.scrollTop||document.body.scrollTop||0),ov:(getComputedStyle(document.documentElement).overflow||'')};})()";
const FOCUS_IN = "(function(){var i=document.getElementById('chat-input');if(!i)return null;i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));i.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));return true;})()";
const BLUR_IN = "(function(){var i=document.getElementById('chat-input');if(i){i.blur();i.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));}return true;})()";

try {
  await cdpConnect();
  await cdp('Page.enable');
  // iPhone + Edge iOS UA：让 mobile-adapt.js 走 isIOS 键盘分支
  await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 EdgiOS/125.2490.66' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // visualViewport 桩：真实内核键盘行为无法在桌面无头环境复现，用可编程桩替代
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    (function(){
      if (window.__mochiVvStub) return;
      var listeners = {};
      var vv = {
        width: 390, height: 844, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
        addEventListener: function(t, fn){ (listeners[t] = listeners[t] || []).push(fn); },
        removeEventListener: function(t, fn){ var a = listeners[t] || []; var i = a.indexOf(fn); if (i > -1) a.splice(i, 1); },
        dispatchEvent: function(ev){ (listeners[ev.type] || []).slice().forEach(function(f){ try { f.call(vv, ev); } catch (e) {} }); return true; }
      };
      try { Object.defineProperty(window, 'visualViewport', { configurable: true, get: function(){ return vv; } }); } catch (e) {}
      window.__vvSet = function(h){ vv.height = h; vv.dispatchEvent({ type: 'resize' }); };
      window.__vvScrollEvt = function(){ vv.dispatchEvent({ type: 'scroll' }); };
    })();
  ` });

  const unlock = async () => {
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(4200);
    await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
    await sleep(300);
    await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
    await sleep(400);
    await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chat\"]');if(t)t.click();return true;})()");
    await sleep(400);
  };

  console.log('== 组A：正常开合 + Edge 延迟滚动自愈 ==');
  await unlock();

  await evalJs(FOCUS_IN); await sleep(120);
  await evalJs('window.__vvSet(500)'); await sleep(200);
  let st = await evalJs(phoneState);
  check('A1 键盘弹出 .phone 收缩停靠(vv 500→height 500px)', st && st.h === '500px', st);
  check('A1b 顶对齐生效', st && st.al === 'flex-start', st);
  check('A1c 文档根已禁滚动(overflow=hidden,想滚也滚不走)', st && st.ov === 'hidden', st);

  // 钉顶窗口(500ms)结束后 Edge 才发生的延迟文档滚动 → 根已锁死,页面无法被平移露灰
  await sleep(700); // 越过 _pinUntil 窗口
  await evalJs('window.scrollTo(0, 320); window.__vvScrollEvt();');
  await sleep(450);
  st = await evalJs(phoneState);
  check('A2 根锁后外部滚动被吞掉(scrollY 保持 0)', st && st.sy === 0, st);
  check('A2b 锁滚动不动 .phone 高度', st && st.h === '500px', st);

  await evalJs('window.scrollTo(0, 40); window.__vvScrollEvt();');
  await sleep(400);
  st = await evalJs(phoneState);
  check('A3 键盘期任意滚动都被锁住,无灰底可露(scrollY 保持 0)', st && st.sy === 0, st);

  await evalJs('window.scrollTo(0,0); window.__vvSet(180);'); await sleep(250);
  st = await evalJs(phoneState);
  check('A4 异常小读数(<基准45%)兜底 55% 基准(height 464px)', st && st.h === '464px', st);
  await evalJs('window.__vvSet(500)'); await sleep(200);

  await evalJs(BLUR_IN); await sleep(100);
  await evalJs('window.__vvSet(844)'); await sleep(900);
  st = await evalJs(phoneState);
  check('A5 键盘收起完全复原(height 清空)', st && st.h === '' && st.al === '', st);
  check('A5b 复原后文档滚动归零', st && st.sy === 0, st);
  check('A5c 复原后文档根解锁(overflow 非 hidden)', st && st.ov !== 'hidden', st);

  console.log('== 组B：悬浮键盘推定停靠比例封顶 + 快速开合残留清理 ==');
  await unlock();

  // 触摸后立即手势聚焦、vv 全程不变 → 950ms 后保底停靠应按【比例】收缩
  await evalJs("(function(){document.dispatchEvent(new Event('touchstart'));var i=document.getElementById('chat-input');i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));return true;})()");
  await sleep(1500);
  st = await evalJs(phoneState);
  check('B1 保底停靠高度=min(max(58%,240),62%)=490px(不被绝对值压扁)', st && st.h === '490px', st);

  await evalJs(BLUR_IN); await sleep(1300);
  st = await evalJs(phoneState);
  check('B2 失焦保底停靠复原', st && st.h === '', st);

  // 快速开合：vv 从未收缩(_kbActive 未置位)、Edge 已滚文档 → 失焦后 650ms 自愈归零
  await evalJs("(function(){document.dispatchEvent(new Event('touchstart'));var i=document.getElementById('chat-input');i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));window.scrollTo(0,300);setTimeout(function(){i.blur();i.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));},60);return true;})()");
  await sleep(1700);
  st = await evalJs(phoneState);
  check('B3 快速开合残留文档滚动被清理(scrollY→0)', st && st.sy === 0, st);
  check('B3b 该路径不误写 .phone 高度', st && st.h === '', st);
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

console.log('\\n== 静态断言：修复代码在源码与构建产物中 ==');
const srcOk = readFileSync(join(root, 'src/js/mobile-adapt.js'), 'utf8').includes('KB_SCROLL_HEAL');
let builtOk = false;
try { builtOk = readFileSync(join(root, 'index.html'), 'utf8').includes('KB_SCROLL_HEAL'); } catch (e) {}
check('S1 src/js/mobile-adapt.js 含自愈逻辑', srcOk);
check('S2 index.html 构建产物已包含(需先 node build.mjs)', builtOk);

console.log('\\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

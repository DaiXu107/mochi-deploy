// ===== 回归脚本（#538）：iOS 上「信件 / 向他提问」输入框打字时一直上弹 + 每个字符闪字 =====
// 用户报障（iPhone 17 Safari，明说其他设备型号也有、要求不要覆盖修改引发跨机型回归）：
//   ①「向他提问」板块的输入框一直上弹，无法拉到顶部停留输入问题；
//   ②信件板块输入框输入文字后一直上弹，且每一个字符输入都会闪字。
//
// 三条根因（全部零机型分支＝按能力/结果判定，不按设备型号）：
//   RC-1 device.js 输入轨迹遥测：每敲一个字符同步 localStorage.setItem（读+parse+stringify+写）
//        并读 3 个布局值。iOS WebKit 同步存储写会阻塞主线程，正好卡在输入法合成提交那一刻
//        → 每字一次卡顿/闪烁，严重时丢字。属诊断遥测，不在业务热路径上。
//   RC-2 chat.js 问问TA 半框的「合成层刷新」（_applyAskComposeLayers / startAskKbRefresh）本是
//        安卓 ce-box 专用（安卓把输入框转 contenteditable，半框被平移时文字合成层停旧位）；
//        实现未做平台/能力门控，iOS 也照跑：给**聚焦中的原生 input** 反复 toggle
//        transform + void offsetHeight 强制整页 reflow（挂在 vv.resize 与 .phone 样式变更上）
//        → 输入框被提为独立合成层、与布局脱同步＝「一直上弹」+ 逐字闪。
//   RC-3 mobile-adapt.js nudgeInputVisible 的几何记忆键含滚动容器底边（sr.bottom）——
//        iOS 输入法候选条显隐会改可视高→容器底边变→记忆失效→看门狗每 tick 重写
//        scroller.scrollTop 把用户滚动位拽回「输入框可见」位＝「无法拉到顶部停留」。
//
// 用法：node tools/verify-ios-input-no-bounce.mjs   （对产物 index.html）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vinosb-' + Date.now()),
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
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   实际=' + JSON.stringify(extra) : '')); }
}

// 探针：统计 (a) 同步 localStorage.setItem 次数（遥测写盘）
//        (b) 指定滚动容器上由 JS 写入 scrollTop 的次数（含调用栈）
//        (c) 目标输入框自身 style 变更（transform 层翻转）
const SPY = `
window.__storeWrites = 0;
window.__storeT0 = 0;
(function(){
  var si = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(k, v){ window.__storeWrites++; return si(k, v); };
})();
window.__spy = function(scrollerSel, inputSel){
  var sc = document.querySelector(scrollerSel);
  var inp = document.querySelector(inputSel);
  var st = { scrollWrites: [], inpStyleMuts: [], storeWrites: 0, t0: 0 };
  window.__s = st;
  Object.defineProperty(st, 'sc', { value: sc, writable: true, enumerable: false });
  if (sc) {
    var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    var store = new WeakMap();
    if (!Element.prototype.__stPatched) {
      Object.defineProperty(Element.prototype, 'scrollTop', {
        configurable: true, enumerable: true,
        get: function(){ return store.has(this) ? store.get(this) : desc.get.call(this); },
        set: function(v){
          var before = desc.get.call(this);
          store.set(this, v); desc.set.call(this, v);
          var after = desc.get.call(this);
          if (window.__s && Math.abs(after - before) > 0.5) {
            var frames = ((new Error()).stack || '').split('\\n').slice(2, 5).map(function(l){ return l.trim().replace(/.*?at\\s+/, '').slice(0, 60); });
            var isThis = (this === window.__s.sc);
            window.__s.scrollWrites.push({ t: Math.round(performance.now()), mine: isThis,
              el: (this.id ? '#' + this.id : (typeof this.className === 'string' && this.className ? '.' + this.className.split(/\\s+/)[0] : this.tagName)),
              from: Math.round(before), to: Math.round(after), stack: frames });
          }
        }
      });
      Element.prototype.__stPatched = true;
    }
    if (inp && !inp.__styleSpied) {
      inp.__styleSpied = true;
      new MutationObserver(function(ms){
        ms.forEach(function(m){
          var t = window.__s && window.__s.inp;
          if (t && m.target === t) window.__s.inpStyleMuts.push({ t: Math.round(performance.now()), tf: m.target.style.transform, wc: m.target.style.willChange });
        });
      }).observe(inp, { attributes: true, attributeFilter: ['style'] });
    }
    if (inp) st.inp = inp;
  }
  return 'ok';
};
window.__spyStart = function(){ window.__s.scrollWrites = []; window.__s.inpStyleMuts = []; window.__s.storeWrites = 0; window.__storeWrites = 0; };
window.__spyReport = function(){
  return { scrollWrites: window.__s.scrollWrites.length,
    scrollWritesMine: window.__s.scrollWrites.filter(function(w){ return w.mine; }).length,
    mineDetail: window.__s.scrollWrites.filter(function(w){ return w.mine; }).slice(0, 4),
    otherWrites: window.__s.scrollWrites.filter(function(w){ return !w.mine; }).length,
    inpStyleMuts: window.__s.inpStyleMuts.length, inpStyleDetail: window.__s.inpStyleMuts.slice(0, 4),
    storeWrites: window.__storeWrites };
};
window.__type = function(inpSel, n){
  var i = document.querySelector(inpSel);
  for (var k = 0; k < n; k++) {
    if (i.tagName === 'INPUT' || i.tagName === 'TEXTAREA') i.value += '\\u5b57';
    else i.textContent += '\\u5b57';
    i.dispatchEvent(new InputEvent('input', { bubbles: true, data: '\\u5b57', inputType: 'insertText' }));
    if (window.__imеJitterOn) {}
    window.__imeJitter();
  }
  return n;
};
`;

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    (function(){
      if (window.__mochiVvStub) return;
      var listeners = {};
      var vv = { width: 402, height: 714, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
        addEventListener: function(t, fn){ (listeners[t] = listeners[t] || []).push(fn); },
        removeEventListener: function(t, fn){ var a = listeners[t] || []; var i = a.indexOf(fn); if (i > -1) a.splice(i, 1); },
        dispatchEvent: function(ev){ (listeners[ev.type] || []).slice().forEach(function(f){ try { f.call(vv, ev); } catch (e) {} }); return true; },
        scrollTo: function(x, y){ vv.offsetTop = y || 0; vv.dispatchEvent({ type: 'scroll' }); } };
      try { Object.defineProperty(window, 'visualViewport', { configurable: true, get: function(){ return vv; } }); } catch (e) {}
      window.__vv = vv;
      window.__vvSet = function(h){ vv.height = h; vv.dispatchEvent({ type: 'resize' }); };
      // iOS 中文输入法候选条逐字显隐 → 可视高抖动（真机常见，正是几何记忆被击穿的诱因）
      window.__imeJitter = function(){
        vv.height = 376; vv.dispatchEvent({ type: 'resize' });
        setTimeout(function(){ vv.height = 420; vv.dispatchEvent({ type: 'resize' }); }, 40);
      };
    })();
  ` });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(300);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(500);
  await evalJs(SPY);

  // ======================= 场景 1：信件板块（写信页） =======================
  console.log('');
  console.log('== 场景 1：信件板块 · 写信页（输入框在 .cal-scroll 内）==');
  await evalJs("(function(){var t=document.querySelector('.tab[data-page=\\'page-phone\\']');if(t)t.click();return true;})()");
  await sleep(500);
  await evalJs("(function(){if(window.openMailPage)window.openMailPage();return true;})()");
  await sleep(900);
  await evalJs("(function(){var b=document.getElementById('mail-open-write');if(b)b.click();return true;})()");
  await sleep(700);
  const mailGeom = await evalJs(`(function(){
    var i=document.getElementById('mail-input'), sc=document.querySelector('#page-mail-write .cal-scroll');
    if(!i||!sc) return null; var r=i.getBoundingClientRect(), s=sc.getBoundingClientRect();
    return { inputH: Math.round(r.height), over: Math.round(sc.scrollHeight - sc.clientHeight), inputInScroller: sc.contains(i) };
  })()`);
  chk('S1.0 写信页输入框确实在 .cal-scroll 滚动容器内（本 bug 前提）', mailGeom && mailGeom.inputInScroller === true, mailGeom);

  // 聚焦 → 弹键盘（必须先聚焦再缩 vv，否则基线被吸收＝键盘判定不成立）
  await evalJs("(function(){var i=document.getElementById('mail-input');i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));return true;})()");
  await sleep(150);
  await evalJs('window.__vvSet(420)');
  await sleep(900);
  await evalJs("window.__spy('#page-mail-write .cal-scroll', '#mail-input')");
  await sleep(50);

  // S1.1 用户把信纸往上滚（读上面内容）→ 看门狗不得拽回
  // 用真实手指手势（touchmove）把内容滚到顶——这正是用户「拉到顶部停留」的动作
  await evalJs(`(function(){
    var sc=document.querySelector('#page-mail-write .cal-scroll');
    sc.scrollTop = 60;
    sc.dispatchEvent(new TouchEvent('touchmove', { bubbles: true }));
    sc.scrollTop = 0;
    return true;
  })()`);
  await evalJs('window.__spyStart()');
  await sleep(1100); // 跨 ≥4 个 250ms tick
  let r1 = await evalJs('window.__spyReport()');
  chk('S1.1 用户滚到顶部后看门狗不拽回（修复前每 tick 重写 scrollTop＝「无法拉到顶部停留」）',
    r1 && r1.scrollWritesMine === 0, r1 && { mine: r1.scrollWritesMine, detail: r1.mineDetail });

  // S1.2 逐字输入（含候选条抖动）→ 不得重写滚动位、不得每字同步写盘
  await evalJs('window.__spyStart()');
  await evalJs('window.__type("#mail-input", 6)');
  await sleep(700);
  let r2 = await evalJs('window.__spyReport()');
  chk('S1.2 打字（含候选条抖动）不重写滚动位＝不上弹', r2 && r2.scrollWritesMine === 0, r2 && { mine: r2.scrollWritesMine, detail: r2.mineDetail });
  chk('S1.3 打字不触发逐字同步 localStorage 写盘（RC-1，修复前 6 字≈6 次）',
    r2 && r2.storeWrites <= 2, r2 && { storeWrites: r2.storeWrites });

  // S1.4 连打 10 字后滚动位仍停在顶部（用户诉求：能拉到顶部并停留输入）
  let st1 = await evalJs("(function(){var sc=document.querySelector('#page-mail-write .cal-scroll');return Math.round(sc.scrollTop);})()");
  chk('S1.4 连续输入后滚动位仍停在用户所拉的顶部（不被打字弹走）', st1 !== null && st1 <= 12, { scrollTop: st1 });

  // ======================= 场景 2：向他提问半框 =======================
  console.log('');
  console.log('== 场景 2：问问TA / 向他提问半框 ==');
  await evalJs("(function(){var i=document.getElementById('mail-input');if(i)i.blur();window.__vvSet(714);return true;})()");
  await sleep(700);
  await evalJs("(function(){var b=document.getElementById('mail-write-back');if(b)b.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('mail-back');if(b)b.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var t=document.querySelector('.tab[data-page=\\'page-chat\\']');if(t)t.click();return true;})()");
  await sleep(600);
  await evalJs("(function(){var b=document.getElementById('chat-more-btn')||document.getElementById('chat-plus');if(b)b.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('more-ask');if(b)b.click();return true;})()");
  await sleep(900);
  const askGeom = await evalJs(`(function(){
    var p=document.getElementById('chat-ask-panel'), sc=document.querySelector('#chat-ask-panel .chat-ask-body'), i=document.getElementById('chat-ask-input');
    if(!p||!sc||!i) return null;
    return { panelOpen: !p.hidden, ceBox: !!i.__ceBox, scCanScroll: sc.scrollHeight > sc.clientHeight + 10,
      scOver: Math.round(sc.scrollHeight - sc.clientHeight) };
  })()`);
  console.log('  半框现场=' + JSON.stringify(askGeom));
  chk('S2.0 半框已打开且输入框为原生输入（iOS 不转 ce-box）', askGeom && askGeom.panelOpen === true && askGeom.ceBox === false, askGeom);

  await evalJs('window.__vvSet(420)');
  await sleep(900);
  await evalJs("window.__spy('#chat-ask-panel .chat-ask-body', '#chat-ask-input')");
  await sleep(50);

  // S2.1 iOS 上不得给聚焦输入框反复 toggle transform（安卓 ce-box 专用手段）
  await evalJs('window.__spyStart()');
  await evalJs('window.__type("#chat-ask-input", 6)');
  await sleep(700);
  let r3 = await evalJs('window.__spyReport()');
  chk('S2.1 iOS 上不把聚焦输入框提成独立合成层/逐字翻转（RC-2＝「一直上弹+闪字」）',
    r3 && r3.inpStyleMuts === 0, r3 && { muts: r3.inpStyleMuts, detail: r3.inpStyleDetail });
  chk('S2.2 半框打字不重写面板滚动位＝不上弹', r3 && r3.scrollWritesMine === 0, r3 && { mine: r3.scrollWritesMine, detail: r3.mineDetail });
  chk('S2.3 半框打字不触发逐字同步 localStorage 写盘（RC-1）', r3 && r3.storeWrites <= 2, r3 && { storeWrites: r3.storeWrites });

  // S2.4 用户把半框滚到顶 → 看门狗不得拽回
  await evalJs("(function(){var sc=document.querySelector('#chat-ask-panel .chat-ask-body');sc.scrollTop=0;return true;})()");
  await evalJs('window.__spyStart()');
  await sleep(1100);
  let r4 = await evalJs('window.__spyReport()');
  chk('S2.4 用户滚到顶部后看门狗不拽回（「无法拉到顶部停留」）', r4 && r4.scrollWritesMine === 0, r4 && { mine: r4.scrollWritesMine, detail: r4.mineDetail });

  // ======================= 场景 3：原始职责不得修死 =======================
  // 「键盘弹起后聚焦输入框被盖住 → 滚进视野」必须保留：把输入框整个滚出容器可视区后，
  // 一次几何变化（键盘收缩）应把它带回可见范围。
  console.log('');
  console.log('== 场景 3：原始职责保留（输入框被滚出视野仍会被带回）==');
  await evalJs("(function(){var sc=document.querySelector('#chat-ask-panel .chat-ask-body');sc.scrollTop=sc.scrollHeight;return true;})()");
  await sleep(300);
  // 用键盘尺寸变化（真实几何变化）触发一次补位
  await evalJs('window.__vvSet(340)');
  await sleep(900);
  const dock = await evalJs(`(function(){
    var sc=document.querySelector('#chat-ask-panel .chat-ask-body'), i=document.getElementById('chat-ask-input');
    var r=i.getBoundingClientRect(), s=sc.getBoundingClientRect();
    return { visible: r.bottom > s.top && r.top < s.bottom, inTop: r.top, scTop: Math.round(s.top), scBottom: Math.round(s.bottom), st: Math.round(sc.scrollTop) };
  })()`);
  chk('S3.1 键盘几何变化后输入框被带回可见范围（防「修死补位」）', dock && dock.visible === true, dock);
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

console.log('');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

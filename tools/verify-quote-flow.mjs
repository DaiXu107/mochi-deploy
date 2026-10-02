// ===== 回归脚本：聊天「引用消息」全链路（单聊 + 群聊）=====
// 背景（用户报障 #480，红米 K70 + Via 等内嵌壳多机型同现：「聊天里无法引用消息」）：
//   引用链路三段都可能在「合成 click 被吞」族内核（Via/夸克等 WebView 壳，与 #129/#G1 同族）上断掉：
//   ① 轻点气泡开菜单只有 click 一条路；② 菜单里【引用】按钮只有 click 一条路；
//   ③ 群聊长按未同步 #G2（touchmove 一动就取消 + contextmenu 只 preventDefault 不开菜单）。
// 修复（src/js/chat.js + src/js/group-chat.js，零机型分支）：气泡 touchend 轻点直驱开/关菜单、
//   菜单按钮 touchend 直驱执行动作（程序化调用共享动作函数，不依赖内核合成 click）、群聊补齐
//   12px 微移容错 + contextmenu 开菜单兜底 + 轻点直驱。
// 验证（无头 Chrome 412x915 DPR2.625 + CDP 真实输入管线 + 合成 TouchEvent 模拟「click 被吞」内核）：
//   A 系列 真实触屏管线全链路：点气泡→菜单→引用→预览→发送→消息带引用块；长按→菜单→引用。
//   T 系列 合成 TouchEvent（浏览器不会为脚本事件补发 click＝精确模拟 click 被吞内核）：
//     T1 轻点气泡→菜单开；T2 轻点菜单【引用】按钮→预览出现；T3 群聊长按中 5px 微移→菜单仍开；
//     T4 群聊轻点气泡→菜单开。修复前 T1-T4 必红（判别力基线）。
// 用法：node build.mjs && node tools/verify-quote-flow.mjs；SERVE_ROOT=<隔离构建目录> 可验未收口产物。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9750 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-qrepro-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') jsErrors++; };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
// 红米 K70：412x915，DPR 2.625，移动触摸
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// —— 关开屏（与 verify-chat-gestures 同款）——
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
      return 'mwait';
    }
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box');
    if (sb) sb.scrollTop = sb.scrollHeight;
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
if (!splashClosed) {
  await evalJs(`(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men)men.click();mm.hidden=true;}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()`);
  await sleep(500);
}
await sleep(500);

async function enterChat() {
  await evalJs('window.enterChat(); true');
  await sleep(1200);
  // 无论有无历史消息，总注入一条可识别的测试消息（A4 断言按内容匹配被引消息）
  await evalJs("window.chatAddIn('联系人发来的引用测试消息'); true");
  await sleep(900);
  return evalJs("document.querySelectorAll('.msg-in .msg-bubble').length");
}
const inCount = await enterChat();
chk('前置 聊天有收到的消息气泡', inCount > 0, 'count=' + String(inCount));

async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t + 0.08, touchPoints: [] });
}
async function holdPress(x, y, durMs) {
  const t0 = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 2 }] });
  await sleep(durMs);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: Date.now() / 1000 + 0.05, touchPoints: [] });
}
const state = () => evalJs(`(function(){
  var m=document.getElementById('msg-actions');
  var q=document.getElementById('chat-draft-quote');
  var d=document.getElementById('chat-draft');
  var mr=m?m.getBoundingClientRect():null;
  var qr=q&&!q.hidden?q.getBoundingClientRect():null;
  return {menuHidden:m?m.hidden:null,menuRect:mr?{x:Math.round(mr.x),y:Math.round(mr.y),w:Math.round(mr.width),h:Math.round(mr.height)}:null,
    quoteHidden:q?q.hidden:null,draftHidden:d?d.hidden:null,
    quoteRect:qr?{x:Math.round(qr.x),y:Math.round(qr.y),w:Math.round(qr.width),h:Math.round(qr.height)}:null,
    quoteText:q&&!q.hidden?(q.textContent||'').slice(0,40):null};
})()`);
async function closeMenu() { await evalJs("(function(){var m=document.getElementById('msg-actions');if(m)m.hidden=true;return true;})()"); }

// 找可弹菜单的收件文字气泡中心
const bub = await evalJs(`(function(){
  var list=document.querySelectorAll('.msg-in .msg-bubble'),i,el;
  for(i=0;i<list.length;i++){var b=list[i];
    if(b.querySelector('.msg-quote'))continue;
    var it=b.closest('.msg'); if(!it||it.classList.contains('msg-poke'))continue;
    if(b.querySelector('.msg-poke-seg'))continue;
    var txt=(b.textContent||'').trim(); if(txt.length<2||txt.indexOf('撤回了一条消息')>=0||txt.indexOf('已读不回')>=0)continue;
    el=b;}
  if(!el)return null;
  var r=el.getBoundingClientRect();
  return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
})()`);
chk('前置 找到可弹菜单气泡', !!bub, JSON.stringify(bub));

// 引用按钮中心
const quoteBtn = () => evalJs(`(function(){
  var m=document.getElementById('msg-actions'); if(!m||m.hidden)return null;
  var b=m.querySelector('.ma-btn[data-act=quote]'); if(!b||b.hidden)return null;
  var r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
})()`);

// —— 路径 A：轻点气泡 → 菜单 → 引用 → 预览 → 发送 ——
if (bub) {
  await closeMenu();
  await tap(bub.x, bub.y);
  await sleep(500);
  let st = await state();
  chk('A1 轻点气泡→动作菜单打开', st.menuHidden === false, JSON.stringify(st));
  const qb = await quoteBtn();
  chk('A2 菜单内引用按钮可见可点', !!qb, JSON.stringify(qb));
  if (qb) {
    await tap(qb.x, qb.y);
    await sleep(500);
    st = await state();
    chk('A3 点引用→预览条出现', st.quoteHidden === false && st.draftHidden === false, JSON.stringify(st));
    chk('A4 预览条内容=被引消息', (st.quoteText || '').indexOf('引用测试消息') >= 0, JSON.stringify(st));
    // 填入文字并发送（真实触摸点发送）
    await evalJs(`(function(){var i=document.getElementById('chat-input');if(!i)return false;i.focus();i.textContent='引用回复测试';i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await sleep(200);
    const sendBtn = await evalJs(`(function(){var b=document.getElementById('chat-send');if(!b)return null;var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    if (sendBtn) {
      await tap(sendBtn.x, sendBtn.y);
      await sleep(900);
      const sent = await evalJs(`(function(){
        var outs=document.querySelectorAll('.msg-out'); if(!outs.length)return {n:0};
        var last=outs[outs.length-1]; var q=last.querySelector('.msg-quote');
        return {n:outs.length,hasQuote:!!q,quoteText:q?(q.textContent||'').slice(0,40):null};
      })()`);
      chk('A5 发送后我的消息带引用块', !!sent && sent.hasQuote === true, JSON.stringify(sent));
    } else chk('A5 发送按钮定位', false, 'no send btn');
  }
}

// —— 路径 B：长按气泡 → 菜单 → 引用 ——
if (bub) {
  await closeMenu();
  await holdPress(bub.x, bub.y, 650);
  await sleep(400);
  let st = await state();
  chk('B1 长按气泡→动作菜单打开', st.menuHidden === false, JSON.stringify(st));
  const qb2 = await quoteBtn();
  if (qb2) {
    await tap(qb2.x, qb2.y);
    await sleep(500);
    st = await state();
    chk('B2 长按路径点引用→预览条出现', st.quoteHidden === false, JSON.stringify(st));
  }
}

// —— T 系列：合成 TouchEvent（无引擎 click 合成＝模拟「click 被吞」内核，修复前必红）——
// 合成 TouchEvent 用法与 verify-chat-gestures T1/T2 同款：dispatchEvent 不触发引擎输入管线，
// 页面里只有 touch 直驱监听能响应＝T 通过当且仅当 touch 直驱路存在。
const mkTouch = `(function(){
  window.__mkTouch = function(type, el, ox, oy){
    var r = el.getBoundingClientRect();
    var cx = Math.round(r.left + r.width/2) + (ox||0), cy = Math.round(r.top + r.height/2) + (oy||0);
    var t = new Touch({identifier: 77, target: el, clientX: cx, clientY: cy});
    return new TouchEvent(type, {bubbles:true, cancelable:true, touches: type==='touchend'?[]:[t], changedTouches:[t]});
  };
  return true;
})()`;
await evalJs(mkTouch);

async function synthTap(sel) {
  return evalJs(`(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'no-el';
    el.dispatchEvent(__mkTouch('touchstart', el));
    el.dispatchEvent(__mkTouch('touchend', el));
    return 'ok';
  })()`);
}

// T1 轻点气泡 → 菜单开（touch 直驱路；旧版只有 click＝合成事件下必红）
let stT = null;
if (bub) {
  await closeMenu();
  await evalJs(`(function(){
    var list=document.querySelectorAll('.msg-in .msg-bubble'),i,el=null;
    for(i=0;i<list.length;i++){var b=list[i];
      if(b.querySelector('.msg-quote'))continue;
      var it=b.closest('.msg'); if(!it||it.classList.contains('msg-poke'))continue;
      if(b.querySelector('.msg-poke-seg'))continue;
      var txt=(b.textContent||'').trim(); if(txt.length<2||txt.indexOf('撤回了一条消息')>=0||txt.indexOf('已读不回')>=0)continue;
      el=b;}
    if(el) el.dispatchEvent(__mkTouch('touchstart', el));
    return !!el;
  })()`);
  await sleep(150);
  await evalJs(`(function(){
    var list=document.querySelectorAll('.msg-in .msg-bubble'),i,el=null;
    for(i=0;i<list.length;i++){var b=list[i];
      if(b.querySelector('.msg-quote'))continue;
      var it=b.closest('.msg'); if(!it||it.classList.contains('msg-poke'))continue;
      if(b.querySelector('.msg-poke-seg'))continue;
      var txt=(b.textContent||'').trim(); if(txt.length<2||txt.indexOf('撤回了一条消息')>=0||txt.indexOf('已读不回')>=0)continue;
      el=b;}
    if(el) el.dispatchEvent(__mkTouch('touchend', el));
    return true;
  })()`);
  await sleep(400);
  let stT = await state();
  chk('T1 合成轻点气泡→动作菜单打开（touch 直驱，click 被吞内核唯一入口）', stT.menuHidden === false, JSON.stringify(stT));
  await closeMenu();
}

// T2 菜单开 → 合成轻点【引用】按钮 → 预览条出现（按钮 touch 直驱路；旧版按钮只有 click＝必红）
if (bub) {
  await closeMenu();
  // 先清掉 B2 残留的预览条并断言已清，防污染 T2 断言
  await evalJs(`(function(){var x=document.querySelector('.chat-draft-quote-x');if(x)x.click();var d=document.getElementById('chat-draft');if(d)d.hidden=true;var q=document.getElementById('chat-draft-quote');if(q)q.hidden=true;return true;})()`);
  await sleep(200);
  const preQ = await state();
  chk('T2前置 预览条已清（防残留假绿）', preQ.quoteHidden === true && preQ.draftHidden === true, JSON.stringify(preQ));
  const bubF = await evalJs(`(function(){
    var list=document.querySelectorAll('.msg-in .msg-bubble'),i,el=null;
    for(i=0;i<list.length;i++){var b=list[i];
      if(b.querySelector('.msg-quote'))continue;
      var it=b.closest('.msg'); if(!it||it.classList.contains('msg-poke'))continue;
      if(b.querySelector('.msg-poke-seg'))continue;
      var txt=(b.textContent||'').trim(); if(txt.length<2||txt.indexOf('撤回了一条消息')>=0||txt.indexOf('已读不回')>=0)continue;
      el=b;}
    if(!el)return null;
    var r=el.getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
  })()`);
  if (!bubF) { console.log('  ⚠ SKIP T2（找不到气泡）'); }
  else {
  await tap(bubF.x, bubF.y); // 真实管线开菜单（这条在 A1 已验）
  await sleep(400);
  await synthTap('#msg-actions .ma-btn[data-act=quote]');
  await sleep(400);
  stT = await state();
  chk('T2 合成轻点菜单【引用】按钮→预览条出现（按钮 touch 直驱）', stT.quoteHidden === false && stT.draftHidden === false, JSON.stringify(stT));
  // 清理预览条，防污染后续断言
  await evalJs(`(function(){var x=document.querySelector('.chat-draft-quote-x');if(x)x.click();var d=document.getElementById('chat-draft');if(d)d.hidden=true;var q=document.getElementById('chat-draft-quote');if(q)q.hidden=true;return true;})()`);
  await sleep(200);
  }
}

// —— 群聊：T3 长按中微移不取消长按（#G2 补齐）；T4 轻点气泡 touch 直驱开菜单；T5 按钮 touch 直驱 ——
// 群聊无 window 级「发普通文字消息」API，gcSendDecisionText 造的是 special:system 居中条（非气泡）。
// 处理：groupChatClear 清场 + gcSendDecisionText 造一条真实 rec（msgs[0]），再挂一个标准
// .msg.msg-in>.msg-bubble 假气泡（data-gc-idx=0 指向该 rec）。被测对象是 #gc-body 上的委托手势
// 处理器与 #gc-msg-actions 按钮动作，假气泡即合法靶子。
const gcShown = await evalJs(`(function(){
  var p = document.getElementById('page-group-chat');
  if (!p) return 'no-page';
  document.querySelectorAll('.page').forEach(function(x){ x.hidden = true; });
  p.hidden = false;
  try {
    window.groupChatClear();
    window.gcSendDecisionText('群聊引用测试消息');
    var gb = document.getElementById('gc-body');
    var m = document.createElement('div');
    m.className = 'msg msg-in';
    m.dataset.gcIdx = '0';
    m.innerHTML = '<div class="msg-side"><div class="msg-av"></div></div><div class="msg-bubble"><span>群聊引用测试消息</span></div>';
    gb.appendChild(m);
  } catch (e) { return 'err:' + e.message; }
  var b = document.querySelector('#gc-body .msg-in .msg-bubble');
  return b ? 'ok' : 'no-bubble:gcMsgs=' + (window.groupChatGetMsgs ? window.groupChatGetMsgs().length : '?');
})()`);
chk('前置 群聊页打开且有成员气泡', gcShown === 'ok', String(gcShown));
if (gcShown) {
  // T3：touchstart → 200ms 后 touchmove 5px → 等 500ms（长按定时器 500ms 应仍在跑）→ 菜单开
  await evalJs(`(function(){
    var m=document.getElementById('gc-msg-actions'); if(m) m.hidden=true; return true;
  })()`);
  await evalJs(`(function(){
    var list=document.querySelectorAll('#gc-body .msg-in .msg-bubble'),i,el=null;
    for(i=0;i<list.length;i++){var b=list[i];
      if(b.querySelector('.msg-quote'))continue;
      var it=b.closest('.msg'); if(!it||it.classList.contains('msg-poke'))continue;
      var txt=(b.textContent||'').trim(); if(txt.length<2||txt.indexOf('撤回了一条消息')>=0)continue;
      el=b;}
    if(!el) return false;
    window.__gcT = el;
    el.dispatchEvent(__mkTouch('touchstart', el));
    return true;
  })()`);
  await sleep(200);
  await evalJs(`(function(){ if(window.__gcT) window.__gcT.dispatchEvent(__mkTouch('touchmove', window.__gcT, 5, 0)); return true; })()`);
  await sleep(600);
  const gcMenu1 = await evalJs(`(function(){var m=document.getElementById('gc-msg-actions');return m?!m.hidden:null;})()`);
  chk('T3 群聊长按中 5px 微移→菜单仍打开（微移容错，旧版 touchmove 即清定时器＝必红）', gcMenu1 === true, 'open=' + String(gcMenu1));
  await evalJs(`(function(){var m=document.getElementById('gc-msg-actions');if(m)m.hidden=true;if(window.__gcT)window.__gcT.dispatchEvent(__mkTouch('touchend', window.__gcT));return true;})()`);
  await sleep(200);

  // T4：合成轻点群聊气泡 → 菜单开（touch 直驱路）
  await evalJs(`(function(){
    var m=document.getElementById('gc-msg-actions'); if(m) m.hidden=true;
    var el=window.__gcT; if(!el) return false;
    el.dispatchEvent(__mkTouch('touchstart', el));
    el.dispatchEvent(__mkTouch('touchend', el));
    return true;
  })()`);
  await sleep(400);
  const gcMenu2 = await evalJs(`(function(){var m=document.getElementById('gc-msg-actions');return m?!m.hidden:null;})()`);
  chk('T4 群聊合成轻点气泡→菜单打开（touch 直驱）', gcMenu2 === true, 'open=' + String(gcMenu2));

  // T5：菜单开 → 合成轻点群聊【引用】按钮 → 群聊预览条出现（按钮 touch 直驱）
  if (gcMenu2) {
    await synthTap('#gc-msg-actions .ma-btn[data-act=quote]');
    await sleep(400);
    const gcQ = await evalJs(`(function(){var q=document.getElementById('gc-quote-bar');return q?!q.hidden:null;})()`);
    chk('T5 群聊合成轻点【引用】按钮→预览条出现（按钮 touch 直驱）', gcQ === true, 'open=' + String(gcQ));
  }
}

// —— 终态异常 ——
const jsErrCount = await evalJs('(window.__jsErrors && __jsErrors.length) || 0');
chk('终态 无未捕获 JS 异常', jsErrCount === 0 && jsErrors === 0, 'cdp=' + String(jsErrors) + ' app=' + String(jsErrCount));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

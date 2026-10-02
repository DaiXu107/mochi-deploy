// ===== 回归脚本：聊天顶部头像打开的「寻踪半框」(#ck-panel) 关闭路径（#529）=====
// 背景（用户报障 2026-09-15，多机型同现）：
//   「在聊天里点击联系人顶部栏的头像，打开的页面，再次点击顶部栏头像或点击屏幕其他地方，无法关闭」。
// 根因（零机型分支，非设备相关）：
//   ① #ck-panel 是唯一没有 document 层「点外关闭」的聊天底部半框——拍一拍 #poke-card、表情包
//      #emoji-panel、更多功能 #chat-more-panel、消息菜单 #msg-actions 都各有 document click 关闭器，
//      寻踪半框从建起就没有 → 「点屏幕其他地方」根本没有关闭路径；
//   ② 头像入口 chat.js 只调 window.openCkPanel()，而 openCkPanel 恒 `panel.hidden = false`
//      → 再次点顶部头像＝又开一次，面板纹丝不动。
// 修复（src/js/p2-features.js + src/js/chat.js，最小改动）：
//   p2-features.js 补 window.closeCkPanel / window.toggleCkPanel（开着则关）+ document 点外关闭；
//   chat.js 顶部头像入口改走 toggleCkPanel（头像自身 stopPropagation，点外关闭器收不到它）。
// 验证（无头 Chrome 412x915 真实触屏管线 + 鼠标 click 路；修复前 S2/S3/S6 必红）：
//   S1 点头像→面板打开；S2 点面板外→关闭（touch）；S2b 同款鼠标 click；S3 再点头像→关闭（toggle）；
//   S4 点面板内部→不关闭；S5 ✕→关闭；S6 关掉后能再开（不粘死）；S7 面板内「TA在身边」入口仍能
//   全屏打开位置面板并收起半框。
// 用法：node build.mjs && node tools/verify-ck-panel-close.mjs；SERVE_ROOT=<隔离构建目录> 可验未收口产物。
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
const cdpPort = 9970 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ckpanel-' + Date.now()),
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
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// —— 关开屏（与 verify-panel-outside-close 同款）——
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
  await evalJs(`(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men&&!men.classList.contains('is-disabled'))men.click();mm.hidden=true;}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()`);
  await sleep(500);
}
await sleep(500);
// 干净档案下会挡住聊天头部的三样「本次改动无关」的东西：定期备份提醒条、新消息横幅（6s 自动
// 隐藏）、以及首次进应用弹出的「数据备份提醒」模态（#modal-mask，z90 压在头像上）。本脚本
// 只测寻踪半框，不测这些；为坐标与命中确定性，持续压制（不计入断言，也不改任何产品逻辑）。
await evalJs(`(function(){
  function hush(){
    try{
      var b=document.getElementById('backup-remind-bar'); if(b){b.hidden=true;b.style.display='none';}
      var d=document.getElementById('desk-msg'); if(d){d.hidden=true;d.style.display='none';}
      var m=document.getElementById('modal-mask'); if(m && !m.hidden) m.hidden=true;
    }catch(e){}
  }
  hush();
  window.__ckHush = hush;
  setInterval(hush, 120);
  return true;
})()`);

await evalJs('window.enterChat(); true');
await sleep(1200);
await evalJs("window.chatAddIn('寻踪半框关闭测试消息'); true");
await sleep(900);

async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t + 0.08, touchPoints: [] });
}
async function mouseClick(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const ckOpen = () => evalJs("(function(){var p=document.getElementById('ck-panel');return p? !p.hidden : null;})()");
const locOpen = () => evalJs("(function(){var p=document.getElementById('loc-panel');return p? !p.hidden : null;})()");
// 相位间的起点归位（不算断言）：直接置 hidden，让每条断言都从「已知关闭」出发
const forceClose = () => evalJs("(function(){var p=document.getElementById('ck-panel');if(p)p.hidden=true;return true;})()");

// 顶部头像中心（先压掉顶部横幅，并确认该点真的命中头像——否则后面的「点头像」会打在横幅上）
const avPoint = () => evalJs(`(function(){
  try{ if(window.__ckHush) window.__ckHush(); }catch(e){}
  var a=document.getElementById('chat-partner-av'); if(!a)return null;
  var r=a.getBoundingClientRect(); if(!r.width||!r.height)return null;
  var x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
  var el=document.elementFromPoint(x,y);
  return {x:x, y:y, hit: el ? !!el.closest('#chat-partner-av') : false};
})()`);
let av = null;
for (let i = 0; i < 12; i++) {
  av = await avPoint();
  if (av && av.hit) break;
  await sleep(300);
}
chk('前置 顶部头像可见且可命中', !!av && av.hit === true, JSON.stringify(av));
// 面板外空白点：聊天消息区顶部（不在气泡/面板/按钮/头部上）
const blank = await evalJs(`(function(){
  var list=document.getElementById('chat-body'); if(!list)return null;
  var r=list.getBoundingClientRect();
  var cands=[[r.left+r.width/2, r.top+Math.min(40,r.height*0.08)],[r.left+r.width*0.5, r.top+r.height*0.15],[r.left+30, r.top+r.height*0.12],[r.left+r.width-30, r.top+r.height*0.2]];
  for(var i=0;i<cands.length;i++){var x=Math.round(cands[i][0]),y=Math.round(cands[i][1]);
    var el=document.elementFromPoint(x,y);
    if(el&&!el.closest('.msg-bubble')&&!el.closest('#ck-panel')&&!el.closest('button')&&!el.closest('.chat-input-row')&&!el.closest('.chat-head'))return {x:x,y:y};}
  return null;
})()`);
chk('前置 找到面板外空白点', !!blank, JSON.stringify(blank));

if (av && blank) {
  // —— S1/S2：点头像打开 → 点面板外（touch）关闭。修复前 S2 必红 ——
  await forceClose();
  await tap(av.x, av.y);
  await sleep(600);
  chk('S1 点顶部头像→寻踪半框打开', (await ckOpen()) === true);
  await tap(blank.x, blank.y);
  await sleep(500);
  chk('S2 点屏幕其他地方(touch)→寻踪半框关闭', (await ckOpen()) === false);

  // —— S2b：同款鼠标 click 路（桌面/鼠标用户）——
  await forceClose();
  await tap(av.x, av.y);
  await sleep(600);
  chk('S2b-1 点头像→打开', (await ckOpen()) === true);
  await mouseClick(blank.x, blank.y);
  await sleep(500);
  chk('S2b-2 点屏幕其他地方(mouse)→寻踪半框关闭', (await ckOpen()) === false);

  // —— S3：再点顶部头像 → 关闭（toggle）。修复前 S3b 必红 ——
  await forceClose();
  await tap(av.x, av.y);
  await sleep(600);
  chk('S3a 点头像→打开', (await ckOpen()) === true);
  await tap(av.x, av.y);
  await sleep(600);
  chk('S3b 再次点顶部头像→关闭', (await ckOpen()) === false);

  // —— S4：点面板内部不关闭 ——
  await forceClose();
  await tap(av.x, av.y);
  await sleep(600);
  const inPanel = await evalJs(`(function(){
    var h=document.querySelector('#ck-panel .poke-card-head'); if(!h)return null;
    var r=h.getBoundingClientRect(); if(!r.width)return null;
    var x=Math.round(r.left+r.width*0.3), y=Math.round(r.top+r.height/2);
    var el=document.elementFromPoint(x,y);
    if(!el||!el.closest('#ck-panel'))return null;
    return {x:x,y:y};
  })()`);
  if (inPanel) {
    await tap(inPanel.x, inPanel.y);
    await sleep(400);
    chk('S4 点面板内部→不关闭', (await ckOpen()) === true, JSON.stringify(inPanel));
  } else {
    chk('S4 点面板内部→不关闭', false, 'no in-panel point');
  }

  // —— S5/S6：✕ 关闭 + 关掉后能再开（不粘死）——
  const closeBtn = await evalJs(`(function(){
    var b=document.getElementById('ck-panel-close'); if(!b)return null;
    var r=b.getBoundingClientRect(); if(!r.width)return null;
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
  })()`);
  if (closeBtn) {
    await tap(closeBtn.x, closeBtn.y);
    await sleep(400);
    chk('S5 点 ✕ →关闭', (await ckOpen()) === false);
    await tap(av.x, av.y);
    await sleep(600);
    chk('S6 关闭后能再次打开（不粘死）', (await ckOpen()) === true);
  } else {
    chk('S5 点 ✕ →关闭', false, 'no close btn point');
    chk('S6 关闭后能再次打开（不粘死）', false, 'no close btn point');
  }

  // —— S7：面板内「TA在身边 · 看看 TA 在哪」入口 → 全屏位置面板打开 + 半框收起 ——
  await forceClose();
  await tap(av.x, av.y);
  await sleep(600);
  const locEntry = await evalJs(`(function(){
    var b=document.getElementById('ck-loc-entry'); if(!b)return null;
    var r=b.getBoundingClientRect(); if(!r.width)return null;
    var x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
    var el=document.elementFromPoint(x,y);
    if(!el||!el.closest('#ck-loc-entry'))return null;
    return {x:x,y:y};
  })()`);
  if (locEntry) {
    await tap(locEntry.x, locEntry.y);
    await sleep(800);
    chk('S7a 面板内入口→位置面板打开且半框收起', (await locOpen()) === true && (await ckOpen()) === false, JSON.stringify({ loc: await locOpen(), ck: await ckOpen() }));
    const locBack = await evalJs(`(function(){
      var b=document.getElementById('loc-back'); if(!b)return null;
      var r=b.getBoundingClientRect(); if(!r.width)return null;
      return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
    })()`);
    if (locBack) {
      await tap(locBack.x, locBack.y);
      await sleep(500);
      chk('S7b 位置面板返回→关闭', (await locOpen()) === false);
    } else {
      chk('S7b 位置面板返回→关闭', false, 'no loc-back point');
    }
  } else {
    chk('S7a 面板内入口→位置面板打开且半框收起', false, 'no ck-loc-entry point');
    chk('S7b 位置面板返回→关闭', false, 'skipped');
  }
}

chk('页面零未捕获异常', jsErrors === 0, 'jsErrors=' + jsErrors);

console.log(fail === 0 ? 'ALL PASS ' + pass + '/' + (pass + fail) : 'FAILED ' + fail + '/' + (pass + fail));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail === 0 ? 0 : 1);


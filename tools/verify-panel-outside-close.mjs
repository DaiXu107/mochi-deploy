// ===== 回归脚本：聊天「更多功能/表情包」面板点外关闭（#481）=====
// 背景（用户报障 #481，红米 K80 + Chrome，多机型同现）：聊天里打开【更多功能】/【表情包】面板后，
//   点其他地方面板关不掉。根因（全机型回归，#480 引入）：#480 轻点 touch 直驱在 touchend 里对
//   【任意位置的轻点】无条件布 800ms msgSuppressClickUntil，body 的 click 里 preventDefault+
//   stopPropagation 吞掉——而面板点外关闭全挂在 document 层 click（morePanel/emojiPanel/pokeCard/
//   batchPanel/voicePanel），事件在 body 层就被吞，document 永远收不到＝点外不关。
// 修复（src/js/chat.js，零机型分支）：吞 click 窗口只在「本次轻点真的开了/关了消息菜单」时布点；
//   与消息菜单无关的普通轻点 click 照常放行（#480 的「click 被吞内核」行为不变：那些内核本就不补发
//   click，touch 直驱路径不受影响）。
// 验证（无头 Chrome 412x915 真实触屏管线）：修复前 A1/A2 必红（点外面板不关）；A3/A4 守 #480
//   不回退（轻点气泡开菜单、点外 touch 直驱关菜单）。
// 用法：node build.mjs && node tools/verify-panel-outside-close.mjs；SERVE_ROOT=<隔离构建目录> 可验未收口产物。
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
const cdpPort = 9870 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-poc-close-' + Date.now()),
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
// 红米 K80：412x915，移动触摸
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// —— 关开屏（与 verify-quote-flow 同款）——
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

await evalJs('window.enterChat(); true');
await sleep(1200);
await evalJs("window.chatAddIn('面板点外关闭测试消息'); true");
await sleep(900);

async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t + 0.08, touchPoints: [] });
}
const panels = () => evalJs(`(function(){
  var m=document.getElementById('chat-more-panel'),e=document.getElementById('emoji-panel'),a=document.getElementById('msg-actions');
  return {more:m?!m.hidden:null,emoji:e?!e.hidden:null,menu:a?!a.hidden:null};
})()`);
// 找「空白点」：消息区顶部、不在气泡/面板/任何按钮上的可点位置
const blank = await evalJs(`(function(){
  var list=document.getElementById('chat-body'); if(!list)list=document.querySelector('.chat-main');
  if(!list)return null;
  var r=list.getBoundingClientRect();
  var cands=[[r.left+r.width/2, r.top+Math.min(40,r.height*0.08)],[r.left+r.width*0.5, r.top+r.height*0.15],[r.left+30, r.top+r.height*0.12],[r.left+r.width-30, r.top+r.height*0.2]];
  for(var i=0;i<cands.length;i++){var x=Math.round(cands[i][0]),y=Math.round(cands[i][1]);
    var el=document.elementFromPoint(x,y);
    if(el&&!el.closest('.msg-bubble')&&!el.closest('#chat-more-panel')&&!el.closest('#emoji-panel')&&!el.closest('button')&&!el.closest('.ch-input-bar'))return {x:x,y:y};}
  return null;
})()`);
chk('前置 找到空白点', !!blank, JSON.stringify(blank));
const moreBtn = await evalJs(`(function(){var b=document.getElementById('chat-more-btn');if(!b)return null;var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
const emojiBtn = await evalJs(`(function(){var b=document.getElementById('chat-emoji-btn');if(!b)return null;var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
chk('前置 更多/表情按钮定位', !!moreBtn && !!emojiBtn, JSON.stringify({ moreBtn, emojiBtn }));
// 可弹菜单气泡中心（A3/A4 用）
const bub = await evalJs(`(function(){
  var list=document.querySelectorAll('.msg-in .msg-bubble'),i,el;
  for(i=0;i<list.length;i++){var b=list[i];
    if(b.querySelector('.msg-quote'))continue;
    var it=b.closest('.msg'); if(!it||it.classList.contains('msg-poke'))continue;
    var txt=(b.textContent||'').trim(); if(txt.length<2||txt.indexOf('撤回了一条消息')>=0)continue;
    el=b;}
  if(!el)return null;
  var r=el.getBoundingClientRect();
  return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
})()`);
chk('前置 找到可弹菜单气泡', !!bub, JSON.stringify(bub));

// —— A1：更多功能面板，点外关闭（修复前必红：轻点任意处布 800ms 吞 click 窗口，document 关闭器收不到）——
if (moreBtn && blank) {
  await tap(moreBtn.x, moreBtn.y);
  await sleep(900); // 等 800ms guard 窗口过期，隔离「开面板那一击」的残留
  let st = await panels();
  chk('A1a 点更多按钮→面板打开', st.more === true, JSON.stringify(st));
  await tap(blank.x, blank.y);
  await sleep(500);
  st = await panels();
  chk('A1b 点空白→更多面板关闭', st.more === false, JSON.stringify(st));
}

// —— A2：表情包面板，点外关闭（同族）——
if (emojiBtn && blank) {
  await tap(emojiBtn.x, emojiBtn.y);
  await sleep(900);
  let st = await panels();
  chk('A2a 点表情按钮→面板打开', st.emoji === true, JSON.stringify(st));
  await tap(blank.x, blank.y);
  await sleep(500);
  st = await panels();
  chk('A2b 点空白→表情面板关闭', st.emoji === false, JSON.stringify(st));
}

// —— A3/A4：#480 不回退——轻点气泡开菜单；菜单开着时点空白 touch 直驱关菜单 ——
if (bub && blank) {
  await tap(bub.x, bub.y);
  await sleep(500);
  let st = await panels();
  chk('A3 轻点气泡→消息菜单打开（#480）', st.menu === true, JSON.stringify(st));
  await tap(blank.x, blank.y);
  await sleep(500);
  st = await panels();
  chk('A4 菜单开着点空白→菜单关闭（#480 touch 直驱路）', st.menu === false, JSON.stringify(st));
}

chk('页面零未捕获异常', jsErrors === 0, 'jsErrors=' + jsErrors);

console.log(fail === 0 ? 'ALL PASS ' + pass + '/' + (pass + fail) : 'FAILED ' + fail + '/' + (pass + fail));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail === 0 ? 0 : 1);

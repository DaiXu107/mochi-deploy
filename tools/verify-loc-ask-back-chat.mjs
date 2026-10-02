// #620 「TA在身边」位置面板底部「问 TA 一声『你在哪？』」点了不返回聊天页（用户 2026-09-16 直派）。
// 两个入口都要覆盖：①聊天页 → 寻踪半框「TA在身边 · 看看 TA 在哪」；②桌面寻踪页同款按钮。
// 旧行为：只发消息 + toast，全屏位置面板不退、聊天页还隐藏着（桌面入口）= 用户看不到任何结果。
// 期望：点完立刻收面板并落到聊天页，能看到刚发出的「你在哪？」且贴底（TA 的回应随后落在同一条线上）。
// 用法：node tools/verify-loc-ask-back-chat.mjs （需已构建 index.html；CHROME_PATH 可指定浏览器）
// RED 基线复跑：MOCHI_PAGE=/tools/tmp-red-index.html —— 指向「把 backToChatAfterAsk() 调用去掉」的
// 产物副本，这样复现旧行为时不必改 index.html（多会话并行构建会随时把它覆盖回新版，原地改产物不可靠）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const PAGE = process.env.MOCHI_PAGE || '/index.html';
let SW_SEEN = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 220) + ']' : ''));
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!browserPath) { console.error('找不到 Edge/Chrome，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (26000 + Math.floor(Math.random() * 2000));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-loc-ask-' + Date.now()),
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
      console.log('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 250));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function tap(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
// 与本用例无关、但会在空库首启后自动弹出并吃掉点击的系统浮层（TA 主动提问的回答弹层等）
async function quiet() {
  await evalJs("(function(){['modal-mask','qa-mask','tc-mask'].forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return 1;})()");
}
// 真实点击：先滚进视口、验命中再按坐标点（位置面板底部按钮默认在滚动区外）
async function tapEl(sel) {
  await quiet();
  const r = await evalJs(`(function(){var e=document.querySelector('${sel}');if(!e||e.hidden)return {vis:false,why:'missing'};e.scrollIntoView({block:'center'});var b=e.getBoundingClientRect();var t=document.elementFromPoint(Math.round(b.left+b.width/2),Math.round(b.top+b.height/2));return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2),vis:b.width>0&&b.height>0&&b.top>=0&&b.bottom<=innerHeight,hit:!!(t&&(t===e||e.contains(t))),hitEl:t?(t.id||String(t.className).split(' ')[0]):null};})()`);
  if (!r || !r.vis || !r.hit) { console.log('  [tap 未命中]', sel, JSON.stringify(r)); return false; }
  await tap(r.x, r.y);
  await sleep(400);
  return true;
}
// 面板状态 + 聊天页状态快照
const SNAP = `(function(){
  var loc=document.getElementById('loc-panel');
  var ck=document.getElementById('ck-panel');
  var chat=document.getElementById('page-chat');
  var pg=document.getElementById('page-checkin');
  var body=document.getElementById('chat-body');
  var out=Array.prototype.slice.call(document.querySelectorAll('#chat-body .msg-out .msg-bubble'))
    .map(function(b){return (b.textContent||'').trim();});
  return {
    locHidden: !loc || loc.hidden,
    ckHidden: !ck || ck.hidden,
    chatVisible: !!chat && !chat.hidden,
    checkinVisible: !!pg && !pg.hidden,
    lock: document.body.classList.contains('scroll-lock'),
    askedCount: out.filter(function(t){return t==='你在哪？'||t.indexOf('你在哪')>=0;}).length,
    lastOut: out.length ? out[out.length-1] : null,
    atBottom: !body ? null : (body.scrollHeight - body.scrollTop - body.clientHeight) <= 4
  };
})()`;

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + PAGE });
  await sleep(2500);
  for (let i = 0; i < 80; i++) {
    const ok = await evalJs("(function(){return !!window.__mochiDataReady && typeof window.enterChat === 'function' && !!document.getElementById('loc-panel');})()");
    if (ok) break;
    await sleep(300);
  }
  // 第二次起必须确认没被 Service Worker 接管：sw.js 对「导航文档」有回退
  // `caches.match('./index.html')`，SW 一接管，后续导航会拿到缓存里的 index.html——
  // RED 基线跑在副本上时会被换回真 index.html＝假绿（本脚本踩过）。见 S0 的 noSW 断言。
  SW_SEEN = SW_SEEN || (await evalJs("(function(){return !!(navigator.serviceWorker&&navigator.serviceWorker.controller);})()"));
  await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
  await sleep(700);
  // 全新 profile 会弹「数据备份提醒」全屏弹窗（产品功能，受保护）——它盖住落点会让点击全部失效，
  // 逐次点「稍后」关掉（不绕过提醒逻辑本身，只是让被它挡住的坐标可达）
  for (let i = 0; i < 6; i++) {
    const vis = await evalJs("(function(){var m=document.getElementById('modal-mask');return !!m&&!m.hidden;})()");
    if (!vis) break;
    await evalJs("(function(){var m=document.getElementById('modal-mask');var btns=m.querySelectorAll('.modal-btns button,.modal-pills button,.modal-pill');if(!btns.length)return 0;btns[btns.length-1].click();return btns.length;})()");
    await sleep(600);
  }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:applock-qa-en','0');localStorage.setItem('xy-home-v2:applock-en','0');localStorage.setItem('xy-home-v2:__last-backup-remind',String(Date.now()));}catch(e){}" });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36' });
// 关键：挡掉 Service Worker。sw.js 的导航分支是「缓存优先且与 URL 无关」——
// `req.mode==='navigate'` 时直接 `caches.match('./index.html')`，于是本脚本第二次 boot() 会被
// 喂回缓存里的 index.html（而不是 MOCHI_PAGE 指定的那份副本）＝RED 基线假绿（本脚本踩过）。
// 双保险：CDP 层 bypass + 页面层把 register 变成不装 SW 的桩（桩对象必须带 showNotification，
// 否则 bg-keep 的通知链会在 .then 里抛错）。S4 断言 controller 全程为 null 作为自证闸门。
await cdp('Network.enable');
await cdp('Network.setBypassServiceWorker', { bypass: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{if(!navigator.serviceWorker)return;var reg={scope:'/',update:function(){return Promise.resolve();},unregister:function(){return Promise.resolve(false);},addEventListener:function(){},showNotification:function(){return Promise.resolve();},getNotifications:function(){return Promise.resolve([]);},installing:null,waiting:null,active:null};navigator.serviceWorker.register=function(){return Promise.resolve(reg);};Object.defineProperty(navigator.serviceWorker,'ready',{get:function(){return Promise.resolve(reg);}});}catch(e){}})()" });

// ================= S0 环境闸门 =================
await boot();
const ready = await evalJs("(function(){return {data:!!window.__mochiDataReady, panel:!!document.getElementById('loc-panel'), entry:!!document.getElementById('ck-loc-entry'), entryDesk:!!document.getElementById('ck-loc-entry-desk')};})()");
check('S0 环境闸门：数据就绪 + 位置面板与两个入口锚点都在', !!(ready && ready.data && ready.panel && ready.entry && ready.entryDesk), ready);

// ================= S1 聊天页入口：寻踪半框 →「TA在身边 · 看看 TA 在哪」→ 问 TA 一声 =================
await evalJs("(function(){window.enterChat();return 1;})()");
await sleep(700);
const inChat = await evalJs("!document.getElementById('page-chat').hidden");
check('S1-1 已进聊天页（从聊天入口出发）', inChat === true);
await evalJs("(function(){window.openCkPanel();return 1;})()");
await sleep(450);
await tapEl('#ck-loc-entry');
await sleep(650);
const open1 = await evalJs("(function(){var p=document.getElementById('loc-panel');return {open:!p.hidden, btn:!!document.getElementById('loc-ask-btn')};})()");
check('S1-2 位置面板已打开且底部「问 TA 一声」按钮在', !!(open1 && open1.open && open1.btn), open1);
const before1 = await evalJs(SNAP);
await tapEl('#loc-ask-btn');
await sleep(600);
const after1 = await evalJs(SNAP);
check('S1-3 点「问 TA 一声」后位置面板收起（用户报的「点了没反应」）', !!(before1 && !before1.locHidden && after1 && after1.locHidden), after1);
check('S1-4 停留在聊天页（聊天入口）', !!(after1 && after1.chatVisible), after1);
check('S1-5 聊天里落下了刚问的「你在哪？」（末条我方消息就是它）', !!(after1 && after1.lastOut === '你在哪？' && after1.askedCount === before1.askedCount + 1), { before: before1 && before1.askedCount, after: after1 && after1.askedCount, lastOut: after1 && after1.lastOut });
check('S1-6 聊天贴底（看得到新消息与 TA 的回应）', !!(after1 && after1.atBottom === true), after1);
check('S1-7 面板收起后滚动锁解除', !!(after1 && after1.lock === false), after1);

// ================= S2 桌面寻踪页入口：同款按钮（旧实现聊天页仍隐藏 = 完全看不到结果） =================
await boot(); // 重置（避免「你在哪？」撞 addRec 同文去重窗口）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-checkin');});return 1;})()");
await sleep(500);
const inCk = await evalJs("!document.getElementById('page-checkin').hidden");
check('S2-1 已打开桌面寻踪页（聊天页此时是隐藏的）', !!(inCk && (await evalJs("document.getElementById('page-chat').hidden")) === true));
await tapEl('#ck-loc-entry-desk');
await sleep(650);
const open2 = await evalJs("(function(){var p=document.getElementById('loc-panel');return {open:!p.hidden, btn:!!document.getElementById('loc-ask-btn')};})()");
check('S2-2 位置面板已打开（桌面寻踪页入口）', !!(open2 && open2.open && open2.btn), open2);
const before2 = await evalJs(SNAP);
await tapEl('#loc-ask-btn');
await sleep(600);
const after2 = await evalJs(SNAP);
check('S2-3 点「问 TA 一声」后位置面板收起', !!(before2 && !before2.locHidden && after2 && after2.locHidden), after2);
check('S2-4 从桌面寻踪页切到了聊天页（旧实现：寻踪页也不退、聊天页仍隐藏）', !!(after2 && after2.chatVisible && after2.checkinVisible === false), after2);
// 注：进聊天页前 #chat-body 是空窗（未渲染），before 计数恒 0，故按「末条我方消息」判定
check('S2-5 聊天里落下了刚问的「你在哪？」（末条我方消息就是它）', !!(after2 && after2.lastOut === '你在哪？'), { lastOut: after2 && after2.lastOut, after: after2 && after2.askedCount });
check('S2-6 聊天贴底', !!(after2 && after2.atBottom === true), after2);
check('S2-7 寻踪半框未残留（聊天入口路径的面板已收）', !!(after2 && after2.ckHidden === true), after2);

// ================= S3 无 JS 错误污染 =================
const errs = await evalJs("(function(){return (window.__jsErrors||[]).filter(function(e){return /loc-panel|loc-ask|askWhere|enterChat|chatSendMsg/i.test(String((e&&e.message)||e));}).length;})()");
check('S3 相关路径零 JS 错误', errs === 0, errs);
// 自证闸门：全程没被 SW 接管（否则第二次 boot 可能测的不是 MOCHI_PAGE 指定的那份文档＝假绿）
const swNow = await evalJs("(function(){return !!(navigator.serviceWorker&&navigator.serviceWorker.controller);})()");
check('S4 自证闸门：全程未被 Service Worker 接管（否则可能测到缓存里的 index.html）', SW_SEEN === false && swNow === false, { boot: SW_SEEN, end: swNow });

browser.kill();
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);

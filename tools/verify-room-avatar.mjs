// ===== 专项验证：房间 TA 头像随联系人桌面隔离（切换联系人后头像/剪影必须跟着换） =====
// 用户反馈：【房间】数据没分开，显示的是上一个联系人头像。
// 根因（修复前）：room.js taAvatarNode() 创建 .r-ta-av 后 if(old) return 短路，
//   头像 URL 只在首次渲染时读取一次，之后切联系人永不更新 → 房间一直挂上一个联系人的头像。
// 用法：node tools/verify-room-avatar.mjs（需先 node build.mjs）
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-roomav-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

async function readyPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
}

await readyPage();

// ---- 准备两个联系人：default(A, 红头像, 床摆设) / B(蓝头像, 沙发+绿植摆设) ----
// 头像用 canvas 生成两张必然不同的有效 PNG dataURL
const setupRes = await evalJs(`(async function(){
  try {
    function mk(color){
      var c=document.createElement('canvas');c.width=8;c.height=8;
      var x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,8,8);
      return c.toDataURL('image/png');
    }
    var avA=mk('#e53935'), avB=mk('#1e88e5');
    // A（default）：头像 + 独立房间档（只有床）
    var sA=window.storeFor('default');
    sA.set('cs-avatar-partner', avA);
    var tk=new Date(); var day=tk.getFullYear()+'-'+(tk.getMonth()+1)+'-'+tk.getDate();
    sA.set('room-data', JSON.stringify({fx:[{i:'a1',t:'bed',x:4,y:0,r:0}],inv:{},pts:11,lv:1,wall:'cream',floor:'wood',day:day,lit:{},earn:{day:day,n:0,ta:0},ta:{x:2,y:1,act:'idle',tx:2,ty:1,faint:false,nextAt:Date.now()+60000}}));
    // B：新建联系人 + 头像 + 独立房间档（沙发+绿植）
    var cidB=window.createContact('乙');
    window.setActiveContact(cidB);
    var sB=window.storeFor(cidB);
    sB.set('cs-avatar-partner', avB);
    sB.set('lbl-partner','小乙');
    sB.set('room-data', JSON.stringify({fx:[{i:'b1',t:'sofa',x:2,y:2,r:0},{i:'b2',t:'plant',x:1,y:1,r:0}],inv:{},pts:22,lv:1,wall:'cloud',floor:'light',day:day,lit:{},earn:{day:day,n:0,ta:0},ta:{x:2,y:1,act:'idle',tx:2,ty:1,faint:false,nextAt:Date.now()+60000}}));
    window.setActiveContact('default');
    return JSON.stringify({ok:true, avA:avA.slice(-24), avB:avB.slice(-24), cidB:cidB});
  } catch(e) { return JSON.stringify({ok:false, err:String(e)}); }
})()`);
let setup = {};
try { setup = JSON.parse(setupRes); } catch (e) {}
check('S1 准备双联系人（A红/B蓝头像 + 各自房间档）', setup.ok && setup.avA !== setup.avB, setupRes);

async function openRoomOn(cid) {
  return evalJs("(function(){try{window.closeRoom&&window.closeRoom();window.setActiveContact(" + JSON.stringify(cid) + ");document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var h=document.getElementById('page-phone');if(h)h.hidden=false;window.openRoom();return true;}catch(e){return String(e);}})()");
}
async function roomProbe() {
  return evalJs(`(function(){
    var av=document.querySelector('#room-ta .r-ta-av');
    var cs=av?getComputedStyle(av):null, r=av?av.getBoundingClientRect():null;
    return JSON.stringify({
      bg: av ? (av.style.backgroundImage||'').slice(-30) : null,
      sil: av ? av.classList.contains('r-ta-sil') : null,
      avW: r ? +r.width.toFixed(1) : null,
      avOpacity: cs ? cs.opacity : null,
      avFilter: cs ? String(cs.filter) : null,
      avFaint: document.getElementById('room-ta').classList.contains('r-faint'),
      furnN: document.querySelectorAll('#room-floor .r-furn').length,
      pts: (document.getElementById('room-chip-pt').textContent||''),
      wall: document.getElementById('room-wall').className
    });
  })()`);
}

// ---- C 组：同一次页面会话内 A → B → A 来回切，头像与摆设必须各自跟随 ----
await openRoomOn('default');
await sleep(600);
let pA = {}; try { pA = JSON.parse(await roomProbe()); } catch (e) {}
check('C1 桌面A进房：头像=A红', pA.bg.indexOf(setup.avA) >= 0 && pA.sil === false, JSON.stringify(pA));
check('C2 桌面A进房：摆设=A档（1件床 · pts11）', pA.furnN === 1 && pA.pts.indexOf('11') >= 0, JSON.stringify(pA));

await openRoomOn(setup.cidB);
await sleep(600);
let pB = {}; try { pB = JSON.parse(await roomProbe()); } catch (e) {}
check('C3 切桌面B进房：头像=B蓝（非上一联系人红）', (pB.bg.indexOf(setup.avB) >= 0 && pB.bg.indexOf(setup.avA) < 0) && pB.sil === false, JSON.stringify(pB));
check('C4 切桌面B进房：摆设=B档（2件 · pts22 · 云朵墙）', pB.furnN === 2 && pB.pts.indexOf('22') >= 0 && pB.wall.indexOf('wall-cloud') >= 0, JSON.stringify(pB));

await openRoomOn('default');
await sleep(600);
let pA2 = {}; try { pA2 = JSON.parse(await roomProbe()); } catch (e) {}
check('C5 切回桌面A进房：头像回到A红', pA2.bg.indexOf(setup.avA) >= 0 && pA2.sil === false, JSON.stringify(pA2));

// ---- D 组：B 移除头像后进房 → 必须变剪影且不留任何人的图片 ----
// （显式从 B 的命名空间删；当前激活联系人此时是 A，不能取 __activeCid）
await evalJs("(function(){var s=window.storeFor(" + JSON.stringify(setup.cidB) + ");s.remove('cs-avatar-partner');s.remove('avatar-partner');return true;})()");
await openRoomOn(setup.cidB);
await sleep(600);
let pD = {}; try { pD = JSON.parse(await roomProbe()); } catch (e) {}
check('D1 B移除头像后进房：显示剪影且无残留图片', pD.sil === true && !pD.bg, JSON.stringify(pD));

// ---- E 组：contact-switched 广播路径（房间开着时切人也要即时换头像）----
// （D 组删过 B 头像，这里先给 B 补回一张蓝头像，tail 以本次生成值为准）
const reB = await evalJs("(function(){var c=document.createElement('canvas');c.width=8;c.height=8;var x=c.getContext('2d');x.fillStyle='#1e88e5';x.fillRect(0,0,8,8);var u=c.toDataURL('image/png');window.storeFor(" + JSON.stringify(setup.cidB) + ").set('cs-avatar-partner',u);return u.slice(-24);})()");
await openRoomOn('default');
await sleep(500);
await evalJs("(function(){window.setActiveContact(" + JSON.stringify(setup.cidB) + ");return true;})()");
await sleep(400);
// setActiveContact 会把所有 page 收起回桌面；此时房间页已 hidden，重开后不得沿用旧头像节点
await evalJs("(function(){window.openRoom();return true;})()");
await sleep(500);
let pE = {}; try { pE = JSON.parse(await roomProbe()); } catch (e) {}
check('E1 切换广播后重进房：头像=B蓝', (pE.bg.indexOf(reB) >= 0 && pE.bg.indexOf(setup.avA) < 0) && pE.sil === false, JSON.stringify(pE));

// ---- G 组：观感面（用户直派「房间功能里联系人的头像很模糊看不清」）----
// 房间有 14% 概率把 TA 掷成「隐约」态（自带 opacity .16＋blur），先摘回常态再探针，重试到确认非隐约
let pG = {};
for (let g = 0; g < 10; g++) {
  await evalJs("(function(){var t=document.getElementById('room-ta');if(t)t.classList.remove('r-faint');return true;})()");
  await sleep(120);
  try { pG = JSON.parse(await roomProbe()); } catch (e) {}
  if (pG.avFaint === false && pG.sil === false) break;
  await sleep(300);
}
check('G0 探针落在常态（非隐约态、且头像是真图片非剪影）', pG.avFaint === false && pG.sil === false, JSON.stringify(pG));
check('G1 头像实际渲染尺寸 >=44 CSS px（34px 时真人照片认不出是谁）', pG.avW !== null && pG.avW >= 44, 'avW=' + pG.avW);
check('G2 头像不透明度为 1（.92 时暖光晕从底下透上来把脸洗淡）', pG.avOpacity === '1', 'opacity=' + pG.avOpacity);
check('G3 常态下头像不带任何模糊滤镜（计算 filter 为 none）', pG.avFilter === 'none', 'filter=' + pG.avFilter);

// ---- F 组：无 JS 异常 ----
const jsErr = await evalJs('(window.__jsErrors||[]).filter(function(e){return String(e).indexOf("room")>=0 || String(e).indexOf("activeStore")>=0;}).length');
check('F1 无 room/store 相关 JS 运行时异常', jsErr === 0, 'errors=' + jsErr);

chrome.kill();
server.close();
const fail = results.filter(r => !r.ok).length;
console.log('\n===== verify-room-avatar: ' + (results.length - fail) + '/' + results.length + ' passed' + (fail ? ' ===== FAIL' : ' ===== ALL GREEN'));
process.exit(fail ? 1 : 0);

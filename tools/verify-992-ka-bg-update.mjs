// verify-992-ka-bg-update.mjs —— #992「后台换版重载打断后台保活/后台通知」
// 用户实报：「后台保活和后台通知功能还是出问题了。但是浏览器网页没多久就自动刷新了，后台保活功能失效。」
// 根因（零机型分支，无头取证）：#965 的待换版落地时刻选在「页面转入后台那一刻」（切走/回桌面/锁屏
//   即 reload），而「后台保活/后台通知」的存在意义正是页面在后台继续运行 ⇒ 一开保活、切走就被重载：
//   运行中的保活音频被拆掉（__kaProbe().ev.died +1）、页面重新回到开屏问答门，后台期间消息与通知全停，
//   用户回来只看到「页面自己刷新了」。
// 修法：换版落地前先看这两个开关（全局键 bg-keepalive / bg-notify）——开着就只弹更新条、后台不落地；
//   手动点「刷新使用新版」不受限；等用户哪次关掉开关再切后台（或下次冷启动）自然换版。
// 断言：
//   S1~S3 源码/产物锚点（闸门在位、#965 既有形态未被改坏）
//   B1 保活开着 + 待换版 + 切后台 → 不重载、保活音频仍在播、ev.died 不增
//   B2 两个开关都关 + 待换版 + 切后台 → 照常重载（#965 行为保持，防修过头）
//   B3 保活开着先不换版 → 关掉保活后再切后台 → 换版落地（延迟换版仍会来）
//   B4 只开后台通知（保活关）→ 同样不重载
//   Z 全程 0 JS 异常
// 用法：node tools/verify-992-ka-bg-update.mjs
//   红对照：仓外副本只把 src/js/pwa.js 换回 HEAD 版再构建，同脚本应 B1/B4 红、B2/B3 绿。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('SKIP 未找到 Chrome/Edge'); process.exit(0); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = 9900 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-992-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return 'ERR:' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description).slice(0, 200); return r && r.result ? r.result.value : null; };
let pass = 0, fail = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) pass++; else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); } };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 文档加载计数器（存 sessionStorage：跨 reload 存活，用来判「到底重载了没有」）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try{sessionStorage.setItem('__v992Loads',String((Number(sessionStorage.getItem('__v992Loads'))||0)+1));}catch(e){}` });

const srcPwa = readFileSync(join(root, 'src/js/pwa.js'), 'utf8');
const prodPwa = (() => { try { return readFileSync(join(root, 'js/pwa.js'), 'utf8'); } catch (e) { try { return readFileSync(join(root, 'index.html'), 'utf8'); } catch (e2) { return ''; } } })();
A('S1 保活/通知开关作为换版闸门在位', srcPwa.indexOf('function bgLivenessOn()') >= 0 && srcPwa.indexOf('if (bgLivenessOn()) return;') >= 0);
A('S2 自动通道「已在后台也不换版」分支在位', prodPwa.indexOf('if (auto && bgLivenessOn())') >= 0);
A('S3 #965 既有形态未被改坏（已交互仍登记待换版）', prodPwa.indexOf('if (auto && !autoReloadAllowed()) { armAutoReloadWhenHidden(); showVerBar(autoTs); return; }') >= 0);

async function openRow() {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await cdp('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(2900);
  await ev(`(function(){var c=document.getElementById('splash-age-check'); if(c){c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));} var b=document.getElementById('splash-confirm-ok'); if(b) b.click(); return 'ok';})()`);
  await sleep(1200);
  await ev(`(function(){['modal-mask','modal-box'].forEach(function(id){var e=document.getElementById(id); if(e) e.hidden=true;});
    var p=document.getElementById('page-setting'); if(p) p.hidden=false;
    var sp=document.querySelector('.splash'); if(sp&&sp.parentNode) sp.parentNode.removeChild(sp);
    var t=document.querySelector('#set-tabs .them-tab[data-tab="system"]'); if(t) t.click(); return 'ok';})()`);
  await sleep(600);
}
// 每次点按前现算坐标（两个开关同屏：一次算两个 rect 会因 scrollIntoView 互相顶偏——实测踩过）
async function rowRect(id) {
  await ev(`(function(){var b=document.getElementById('${id}'); if(b) b.closest('label.toggle').scrollIntoView({block:'center'}); return 'ok';})()`);
  await sleep(300);
  return JSON.parse(await ev(`(function(){var b=document.getElementById('${id}'); if(!b) return JSON.stringify({err:'no'});
    var r=b.closest('label.toggle').querySelector('.tk').getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`));
}
async function tapToggle(id) {
  const p = await rowRect(id);
  await clearOverlay(p);
  await mtap(p);
  await sleep(2200);
}
const mtap = async (p) => { await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(50); await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); };
// 清掉挡在开关上的浮层（备份提醒/半框等）
async function clearOverlay(p) {
  for (let i = 0; i < 10; i++) {
    const hit = await ev(`(function(){var e=document.elementFromPoint(${p.x},${p.y}); if(!e) return 'none';
      if(e.closest&&e.closest('label.toggle')) return 'ok';
      var t=e; while(t&&t.parentElement&&t.parentElement.tagName!=='BODY'){ if(t.id||/mask|panel|popup|toast|bar/.test(t.className||'')) break; t=t.parentElement; }
      (t||e).style.display='none'; return 'hid';})()`);
    if (hit === 'ok') return;
    await sleep(200);
  }
}
// 模拟切后台（无头没有真 hidden：覆写 visibilityState/hidden + 派发事件，只影响本页 JS 判定）
const goHidden = () => ev(`(function(){
  try { Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get:function(){return 'hidden';}}); } catch(e){}
  try { Object.defineProperty(Document.prototype,'hidden',{configurable:true,get:function(){return true;}}); } catch(e){}
  window.__v992Mark='alive';
  if (window.__pwaAutoUpgradeTest) window.__pwaAutoUpgradeTest.arm();
  document.dispatchEvent(new Event('visibilitychange'));
  return 'ok';})()`);
const probe = async () => JSON.parse(await ev(`JSON.stringify({
  loads: Number((function(){try{return sessionStorage.getItem('__v992Loads');}catch(e){return -1;}})())||0,
  mark: window.__v992Mark || null,
  keepStored: (function(){try{return window.xyStore('xy-home-v2').get('bg-keepalive');}catch(e){return 'ERR';}})(),
  notifyStored: (function(){try{return window.xyStore('xy-home-v2').get('bg-notify');}catch(e){return 'ERR';}})(),
  audio: (function(){try{var k=window.__kaProbe?window.__kaProbe():null; return k&&k.audio? {paused:k.audio.paused} : null;}catch(e){return null;}})(),
  died: (function(){try{var k=window.__kaProbe?window.__kaProbe():null; return k&&k.ev? k.ev.died : null;}catch(e){return null;}})(),
  errs: (window.__jsErrors||[]).length
})`));

// ---- B1 保活开着 + 待换版 + 切后台：不重载 ----
await openRow();
let before = await probe();
await tapToggle('bg-keepalive');                  // 开保活
const on1 = await probe();
await goHidden(); await sleep(3500);
let s = await probe();
A('B1 保活开着时后台不换版（未重载、保活音频仍在播）',
  s.loads === on1.loads && s.mark === 'alive' && s.audio && s.audio.paused === false && s.died === 0,
  'loads ' + before.loads + '→' + s.loads + ' | ' + JSON.stringify(s));

// ---- B2 两个开关都关 + 待换版 + 切后台：照常重载（#965 行为保持） ----
await openRow();
before = await probe();
await goHidden(); await sleep(3500);
s = await probe();
A('B2 开关都关时后台照常换版（#965 行为保持）',
  s.loads === before.loads + 1, 'loads ' + before.loads + '→' + s.loads + ' | ' + JSON.stringify(s));

// ---- B3 先开保活不换版 → 关掉保活再切后台 → 换版落地 ----
await openRow();
await tapToggle('bg-keepalive');                  // 开保活
await goHidden(); await sleep(2500);                // 第一次转后台：不落地
let afterHide = await probe();
await ev(`(function(){try{Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get:function(){return 'visible';}});}catch(e){}
  try{Object.defineProperty(Document.prototype,'hidden',{configurable:true,get:function(){return false;}});}catch(e){}
  document.dispatchEvent(new Event('visibilitychange')); return 'ok';})()`);
await sleep(600);
await tapToggle('bg-keepalive');                  // 关掉保活
const offState = await probe();
await goHidden(); await sleep(3500);                // 第二次转后台：换版落地
s = await probe();
A('B3 关掉保活后的那次转后台换版照常落地（延迟换版不会丢）',
  offState.keepStored === '0' && afterHide.loads === offState.loads && s.loads === offState.loads + 1,
  'hide1 ' + afterHide.loads + ' → off ' + offState.loads + ' → hide2 ' + s.loads + ' | ' + JSON.stringify(s));

// ---- B4 只开后台通知（保活关）：同样不重载 ----
await openRow();
before = await probe();
await tapToggle('bg-notify');                     // 开后台通知（权限 default：新语义下开关保持开启）
const on2 = await probe();
await goHidden(); await sleep(3500);
s = await probe();
A('B4 后台通知开着时后台也不换版',
  on2.notifyStored === '1' && s.loads === on2.loads && s.mark === 'alive',
  'notify ' + on2.notifyStored + ' loads ' + before.loads + '→' + s.loads + ' | ' + JSON.stringify(s));
A('Z 全程 0 JS 异常', s.errs === 0, 'errs=' + s.errs);

console.log('PASS', pass, 'FAIL', fail);
if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n'));
try { ws.close(); } catch (e) {}
chrome.kill(); server.close(); process.exit(fail ? 1 : 0);

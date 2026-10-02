// verify-983-notify-first-tap.mjs —— #988「后台通知」开关点第一下被拦回去、点第二下才开
// 用户实报（红米 K80 Chrome，明说其他设备型号也有）：「打开后台通知的功能会被拦截一下，
// 然后点击第二次才打开」。
// 根因：旧实现把 requestNotifyPermission 的回调当成成/败二值——resolve 不是 'granted' 就走
// 失败分支（toast＋notifyEnabled=false＋开关弹回关闭）；而安卓 Chrome / 国产 ROM 上「系统授权
// 弹窗已弹出、用户还没点允许」时 requestPermission 先 resolve 成 'default'（＝还没决定，不是
// 拒绝）⇒ 用户那一下被吃掉、开关自己弹回；第二下时权限已在系统弹窗里被允许 ⇒「第二下才开」。
// 断言：
//   S 组：源码/产物锚点（新判据＋待决分支在产物里在位；旧「未获得通知权限」回弹提示为删除型）
//   B1 待决(default) 一次真点按：开关不回弹、落 '1'（#988 本体；纯 HEAD 必红）
//   B2 待决(default)→2.5s 后授权：一次点按走完全程（开关开＋自动联动保活；纯 HEAD 必红）
//   B3 已授权(granted)：一次点按即开＋自动联动（回归，HEAD 同绿）
//   B4 明确被拒(denied)：回弹关闭＋落 '0'（#975/#802 既有口径，HEAD 同绿）
//   B5 唤醒重载伪 change（无任何真实输入）：不得翻开关/写 '1'（#921f 防线，HEAD 同绿）
//   B6 内核 userActivation 读数异常（hasBeenActive 恒 false）时真点按仍生效（#988 判据改造；HEAD 必红）
//   Z 全程 0 JS 异常
// 用法：node tools/verify-983-notify-first-tap.mjs
//   红对照：先在仓外副本里只把 src/js/bg-keep.js 换成 HEAD 版再构建，再跑本脚本（期望 B1/B2/B6 红）。
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-983-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true }); if (r && r.exceptionDetails) return 'ERR:' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description); return r && r.result ? r.result.value : null; };
let pass = 0, fail = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) pass++; else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); } };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== S 组：源码 / 产物锚点 =====
const srcBk = readFileSync(join(root, 'src/js/bg-keep.js'), 'utf8');
const outHtml = readFileSync(join(root, 'index.html'), 'utf8');
const prodBk = (() => { try { return readFileSync(join(root, 'js/bg-keep.js'), 'utf8'); } catch (e) { return ''; } })();
const product = prodBk || outHtml;
A('S1 手势闸以「近期真实输入」为主判据', srcBk.indexOf('if (Date.now() - kaInputAt <= 1200) return true;') >= 0);
A('S2 输入标记忽略脚本合成事件', srcBk.indexOf('if (e && e.isTrusted === false) return;') >= 0 && srcBk.indexOf('kaInputAt = Date.now();') >= 0);
A('S3 待决分支在产物里在位（授权结果收口）', product.indexOf('nbApplyOn(my);') >= 0 && product.indexOf('nbSettleStart(my, false);') >= 0);
A('S4 待决轮询/重试接线在位', product.indexOf('function nbArmRetry(') >= 0 && product.indexOf('NB_SETTLE_MS') >= 0 && product.indexOf('fail(\'pending\')') >= 0);
A('S5 删除型：旧「未获得通知权限」回弹提示不得回流', srcBk.indexOf("toast('未获得通知权限，后台消息无法弹窗')") < 0 && product.indexOf("toast('未获得通知权限，后台消息无法弹窗')") < 0);

// ===== 无头行为组 =====
let stubId = null;
async function setStub(source) {
  if (stubId) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId }); stubId = null; }
  if (source) { const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source }); stubId = r && r.identifier; }
}
const STUB_SILENT_DEFAULT = `(function(){var n=window.Notification; if(n){n.requestPermission=function(){return Promise.resolve('default');};}})();`;
const STUB_SLOW_GRANT = `(function(){var n=window.Notification; if(n){n.requestPermission=function(){return new Promise(function(r){setTimeout(function(){try{Object.defineProperty(n,'permission',{value:'granted',configurable:true});}catch(e){}r('granted');},2500);});};}})();`;
const STUB_DENIED = `(function(){var n=window.Notification; if(n){try{Object.defineProperty(n,'permission',{value:'denied',configurable:true});}catch(e){} n.requestPermission=function(){return Promise.resolve('denied');};}})();`;
const STUB_BAD_UA = `(function(){try{Object.defineProperty(navigator,'userActivation',{configurable:true,get:function(){return {isActive:false,hasBeenActive:false};}});}catch(e){}})();`;
const probe = async () => JSON.parse(await ev(`JSON.stringify({
  notify: (document.getElementById('bg-notify')||{}).checked,
  notifyStored: (function(){try{return window.xyStore('xy-home-v2').get('bg-notify');}catch(e){return 'ERR';}})(),
  keep: (document.getElementById('bg-keepalive')||{}).checked,
  keepStored: (function(){try{return window.xyStore('xy-home-v2').get('bg-keepalive');}catch(e){return 'ERR';}})(),
  perm: ('Notification' in window) ? Notification.permission : 'none',
  rec: window.__v983Rec||null,
  errs: (window.__jsErrors||[]).length
})`));
// 打开设置页系统段、点掉挡路浮层，返回开关的屏幕坐标（真点按用）
async function openRow(grant) {
  // 场景隔离：每个场景都从「干净存储」开始（否则上一场留下的 bg-notify='1' 会让本场的
  // 点按变成「关掉开关」——实测踩过，B2/B5 假红全是这个原因）
  await cdp('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  // 场景隔离：先离开页面再清存储（页面活着时清，IndexedDB 的挂起批写会把 '1' 写回来——
  // 实测踩过：清了存储下一场开局仍是「开关已开」，那一下点按反被当成关掉）
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  await cdp('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  await cdp('Page.navigate', { url: base + '/index.html' });
  await sleep(2800);
  if (grant) await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
  else await cdp('Browser.resetPermissions', {});
  await ev(`(function(){var c=document.getElementById('splash-age-check'); if(c){c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));} var b=document.getElementById('splash-confirm-ok'); if(b) b.click();})()`);
  await sleep(1200);
  await ev(`(function(){window.__v983Rec=[]; var b=document.getElementById('bg-notify'); if(b){b.addEventListener('change',function(e){var ua={}; try{ua=navigator.userActivation||{};}catch(er){} window.__v983Rec.push({trusted:e.isTrusted,hasBeenActive:ua.hasBeenActive,checked:b.checked});},true);} return 'ok';})()`);
  await ev(`(function(){['modal-mask','modal-box'].forEach(function(id){var e=document.getElementById(id); if(e) e.hidden=true;});
    var p=document.getElementById('page-setting'); if(p) p.hidden=false;
    var sp=document.querySelector('.splash'); if(sp&&sp.parentNode) sp.parentNode.removeChild(sp);
    var t=document.querySelector('#set-tabs .them-tab[data-tab="system"]'); if(t) t.click(); return 'ok';})()`);
  await sleep(600);
  const rect = JSON.parse(await ev(`(function(){var b=document.getElementById('bg-notify'); if(!b) return JSON.stringify({err:'no-btn'});
    b.closest('label.toggle').scrollIntoView({block:'center'}); var r=b.closest('label.toggle').querySelector('.tk').getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:r.width,h:r.height});})()`));
  for (let i = 0; i < 10; i++) {
    const hit = await ev(`(function(){var e=document.elementFromPoint(${rect.x},${rect.y}); if(!e) return 'none';
      if(e.id==='bg-notify'||(e.closest&&e.closest('label.toggle'))) return 'ok';
      var t=e; while(t&&t.parentElement&&t.parentElement.tagName!=='BODY'){ if(t.id||/mask|panel|popup|toast|bar/.test(t.className||'')) break; t=t.parentElement; }
      (t||e).style.display='none'; return 'hid';})()`);
    if (hit === 'ok') break;
    await sleep(200);
  }
  return rect;
}
const preProbe = async (tag) => { const q = await probe(); console.log("[" + tag + " 点按前]", JSON.stringify(q)); };
const mtap = async (x, y) => {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(50);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

// ---- B1 待决(default) ＋ 请求返回 'default'：一次点按不回弹 ----
await setStub(STUB_SILENT_DEFAULT);
let r = await openRow(false);
await mtap(r.x, r.y); await sleep(3000);
let s = await probe();
A('B1 待决时一次点按不回弹（开关开＋落 1）', s.notify === true && s.notifyStored === '1' && s.perm === 'default', JSON.stringify(s));
A('B1b change 事件带真实手势（判据不是被 API 读数拦掉）', !!(s.rec && s.rec.length && s.rec[0].trusted === true), JSON.stringify(s.rec));

// ---- B2 待决(default) → 2.5s 后授权：一只手势走完全程 ----
await setStub(STUB_SLOW_GRANT);
r = await openRow(false);
await preProbe('B2');
await mtap(r.x, r.y);
await sleep(4500);
s = await probe();
A('B2 系统弹窗里点允许后一只手势收口（开关开＋自动开保活）', s.notify === true && s.notifyStored === '1' && s.perm === 'granted' && s.keep === true && s.keepStored === '1', JSON.stringify(s));

// ---- B3 已授权：一次点按即开（回归） ----
await setStub(null);
r = await openRow(true);
await mtap(r.x, r.y); await sleep(1200);
s = await probe();
A('B3 已授权时一次点按即开＋自动联动保活', s.notify === true && s.notifyStored === '1' && s.keep === true, JSON.stringify(s));

// ---- B4 明确被拒：#1014 起口径翻转为「保住用户意图」（不再回弹关闭、不再写 '0'） ----
//   用户实报「首次打开还是显示被浏览器拒绝，我第二次打开才有反应」「开启后切后台会自动关闭」：
//   一次 denied 读数被当成用户的最终决定（写死存储 + 关开关），而浏览器在首次授权被安静提示 UI
//   挡掉 / 授权框被切后台打断 / 丢弃重载后读到的也都是 denied，网页分不出「用户拒绝」与
//   「浏览器没让用户看见这个问题」⇒ 改为保住意图＋行下标红如实说明＋权限到位自动生效。
await setStub(STUB_DENIED);
r = await openRow(false);
await mtap(r.x, r.y); await sleep(1200);
s = await probe();
A('B4 权限被拒时保住意图（开关仍开＋落 1，不再自动关闭）', s.notify === true && s.notifyStored === '1', JSON.stringify(s));

// ---- B5 唤醒重载伪 change（无任何真实输入）：不得翻开关/写 1 ----
await setStub(null);
r = await openRow(true);
const pseudo = await ev(`(function(){var res=[];['bg-notify','bg-keepalive'].forEach(function(id){var b=document.getElementById(id); if(!b) return;
  b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true})); res.push({id:id,checked:b.checked});}); return JSON.stringify(res);})()`);
await sleep(900);
s = await probe();
A('B5 无输入证据的伪 change 被拦（两开关都不翻、不写存储）', s.notify === false && s.notifyStored === null && s.keep === false && s.keepStored === null, JSON.stringify(s) + ' | ' + pseudo);

// ---- B7 待决(default) → 3s 后系统弹窗里点了允许：只用一只手势就收口（不再需要点第二下） ----
const STUB_DEFAULT_THEN_GRANT = `(function(){var n=window.Notification; if(n){n.requestPermission=function(){setTimeout(function(){try{Object.defineProperty(n,'permission',{value:'granted',configurable:true});}catch(e){}},3000); return Promise.resolve('default');};}})();`;
await setStub(STUB_DEFAULT_THEN_GRANT);
r = await openRow(false);
await mtap(r.x, r.y);
await sleep(6000);
s = await probe();
A('B7 待决→稍后授权：一只手势收口（无需第二下）', s.notify === true && s.notifyStored === '1' && s.perm === 'granted' && s.keep === true, JSON.stringify(s));

// ---- B6 内核 userActivation 读数异常时真点按仍生效 ----
await setStub(STUB_BAD_UA);
r = await openRow(true);
await mtap(r.x, r.y); await sleep(1200);
s = await probe();
A('B6 userActivation 报「从未激活」时真点按仍生效', s.notify === true && s.notifyStored === '1', JSON.stringify(s));
A('Z 全程 0 JS 异常', s.errs === 0, 'errs=' + s.errs);
await setStub(null);

console.log('PASS', pass, 'FAIL', fail);
if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n'));
try { ws.close(); } catch (e) {}
chrome.kill(); server.close(); process.exit(fail ? 1 : 0);

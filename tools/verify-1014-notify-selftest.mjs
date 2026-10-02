// verify-1011-notify-selftest.mjs —— #1014「后台弹窗」自测与开关三处根治
// 用户实报（红米 K80 Chrome；同一族第三次）：
//   ①「后台弹窗自测功能还是不完整，而且点测试有延迟」
//   ②「首次打开后台通知功能，还是会显示被浏览器拒绝，我第二次打开才有反应」
//   ③「后台通知功能开启后，切后台会自动关闭」
// 根因（纯 HEAD 无头实测取证，判据全是读数与计时，零机型/内核分支）：
//   ①结果 toast 被两件与本测试无关的事 gate：线上 version.json 的网络往返（实测正常网络 26ms 出结果；
//     把 version.json 拖慢 3000ms ⇒ 结果 3025ms 才出）＋ SW 队列回读里写死的 500ms；且旧测试只测
//     「现在能不能发出一条通知」，从不报「后台通知开关本身开没开」（开关关着也照样报链路全通＝误导）、
//     不报权限/后台服务/保活锚点，更测不到用户真正关心的那一半（旧文案自己让用户「按 Home 切后台再测一次」）。
//   ②③原实现把**一次** Notification.permission 读数当成用户的最终决定：启动/回填读到 'denied' 就
//     notifyEnabled=false 且把存储写死 '0'（实测：存量 '1' 自此永久为 '0'，权限随后 granted 也回不来
//     ＝「开启后切后台会自动关闭、要重新开一次」）；点开关时请求被弹回 'denied' 也当场回弹关闭
//     ＝「第一次显示被浏览器拒绝」。而 #921g 已在同一设备族实测过「丢弃重载/回前台」这类时机的权限
//     读数是失真的。
// 断言：
//   S 源/产物锚点（含两条删除型防回流）
//   B1 存量意图不被一次瞬态 denied 读数吃掉，且权限到位自动生效（纯 HEAD 必红）
//   B2 点「测试」的结果不再被 version.json 网络往返拖时间（纯 HEAD 必红）
//   B3 结果报出「后台通知开关」本身的状态（纯 HEAD 必红）
//   B4 开关打开时请求被弹回也不丢意图＋行下标红如实说明（纯 HEAD 必红）
//   B5 第二段·后台阶段：隐藏态真发一条、回前台给结论（纯 HEAD 无此流程，必红）
//   Z 全程 0 JS 异常（防修过头闸，两侧同绿）
// 用法：node tools/verify-1011-notify-selftest.mjs [rootDir]（缺省＝仓库根；传纯 HEAD 导出树＝RED 基线）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('SKIP 未找到 Chrome/Edge'); process.exit(0); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1011-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const pg = l.find((t) => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (evt) => { const m = JSON.parse(evt.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };
let pass = 0, fail = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) pass++; else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); } };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
let stubId = null;
const setStub = async (source) => {
  if (stubId) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId }); stubId = null; }
  if (source) { const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source }); stubId = r && r.identifier; }
};
const ERRWATCH = `(function(){ window.__errs = 0; window.addEventListener('error', function(){ window.__errs++; }); window.addEventListener('unhandledrejection', function(){ window.__errs++; }); })();`;
const boot = async (extraStub) => { await setStub(ERRWATCH + (extraStub || '')); await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(4200); };
// 场景隔离＋进场（存储一律先清干净，避免上一场的 bg-notify='1' 让本场的点按变成「关掉开关」——
//   verify-988 实测踩过这个坑；且清存储必须「先离开页面再清」，否则 IDB 的挂起批写会把 '1' 写回来）
const fresh = async (extraStub) => {
  await cdp('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await cdp('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  await boot(extraStub);
};
const passSplash = async () => {
  await ev(`(function(){ var c=document.getElementById('splash-age-check'); if(c){c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));} var b=document.getElementById('splash-confirm-ok'); if(b) b.click(); })()`);
  await sleep(1000);
};
const probe = async () => JSON.parse(await ev(`JSON.stringify({
  notify: (document.getElementById('bg-notify')||{}).checked,
  notifyStored: (function(){try{return window.xyStore('xy-home-v2').get('bg-notify');}catch(e){return 'ERR';}})(),
  perm: ('Notification' in window) ? Notification.permission : 'unsupported',
  keep: (document.getElementById('bg-keepalive')||{}).checked,
  warnShown: (function(){var e=document.getElementById('bg-notify-perm-warn'); return !!(e && !e.hidden && e.textContent);})(),
  warnText: (function(){var e=document.getElementById('bg-notify-perm-warn'); return e ? e.textContent : '';})(),
  toast: (function(){var e=document.getElementById('cc-toast'); return e ? e.textContent : '';})(),
  errs: window.__errs || 0
})`) || '{}');
// 真实鼠标点按（#921f 需要输入证据）：按 verify-988 的口径——先离开开屏、打开设置页系统段、把开关
//   滚进视口，再用 elementFromPoint 复核目标确实是这个开关（否则「点 (0,0) 打空」会让断言假绿）
const openRow = async () => {
  await ev(`(function(){['modal-mask','modal-box'].forEach(function(id){var e=document.getElementById(id); if(e) e.hidden=true;});
    var p=document.getElementById('page-setting'); if(p) p.hidden=false;
    var sp=document.querySelector('.splash'); if(sp&&sp.parentNode) sp.parentNode.removeChild(sp);
    var t=document.querySelector('#set-tabs .them-tab[data-tab="system"]'); if(t) t.click(); return 'ok'; })()`);
  await sleep(600);
  const rect = JSON.parse(await ev(`(function(){var b=document.getElementById('bg-notify'); if(!b) return JSON.stringify({err:'no-btn'});
    b.closest('label.toggle').scrollIntoView({block:'center'});
    var r=b.closest('label.toggle').querySelector('.tk').getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}); })()`));
  for (let i = 0; i < 10; i++) {
    const hit = await ev(`(function(){var e=document.elementFromPoint(${rect.x},${rect.y}); if(!e) return 'none';
      if(e.id==='bg-notify'||(e.closest&&e.closest('label.toggle'))) return 'ok';
      var t=e; while(t&&t.parentElement&&t.parentElement.tagName!=='BODY'){ if(t.id||/mask|panel|popup|toast|bar/.test(t.className||'')) break; t=t.parentElement; }
      (t||e).style.display='none'; return 'hid'; })()`);
    if (hit === 'ok') break;
    await sleep(200);
  }
  return rect;
};
const mtap = async (x, y) => {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const setVis = async (v) => ev(`(function(){ try { Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return '${v}';}}); Object.defineProperty(document,'hidden',{configurable:true,get:function(){return ${v === 'hidden'};}}); } catch(e){}
  try { document.dispatchEvent(new Event('visibilitychange')); } catch(e){} return 'ok'; })()`);
const clickTest = async () => ev(`(function(){ var b=document.getElementById('bg-notify-test'); if(!b) return 'no-btn'; b.click(); return 'ok'; })()`);

// ============ S 组：源 / 产物锚点 ============
console.log('【S 源锚点】');
const srcBk = readFileSync(join(root, 'src/js/bg-keep.js'), 'utf8');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const product = (() => { try { return readFileSync(join(root, 'js/bg-keep.js'), 'utf8'); } catch (e) { return ''; } })();
A('S1 启动恢复只读用户意图、不再看权限读数', srcBk.includes("notifyEnabled = saved === '1';"));
A('S2 权限没到位时保住意图的收口在位（nbHoldOn）', srcBk.includes('function nbHoldOn(my, why) {'));
A('S3 权限状态标红行渲染器＋模板锚点都在位', srcBk.includes('function nbSyncPermWarn() {') && tpl.includes('id="bg-notify-perm-warn"'));
A('S4 权限到位自动生效（不需要点第二次开关）', srcBk.includes("if (nbWaitingGrant && notifyEnabled && nbPermState() === 'granted')"));
A('S5 删除型：旧「权限被回收→自动关闭通知」的回写不得回流', !srcBk.includes("toast('通知权限已被回收，已自动关闭通知')") && !product.includes("toast('通知权限已被回收，已自动关闭通知')"));
A('S6 删除型：旧启动判定（带 permission 的赋值）不得回流', !srcBk.includes("notifyEnabled = saved === '1' && 'Notification' in window"));
A('S7 自测报出「后台通知开关」本身的状态', srcBk.includes("'✓ 后台通知开关：已开启'"));
A('S8 自测第二段·后台阶段在位（隐藏态真发一条＋入口）', srcBk.includes("'后台通知测试（后台阶段）'") && srcBk.includes("'现在测（切后台）'"));
A('S9 结果先出、后续证据原地补行（不再被网络 gate）', srcBk.includes('if (resultShown) showResult();'));
A('S10 追问只在 SW 通道真成功时才提供', srcBk.includes("if (testChan === 'sw') offerPhase2();"));
A('S12 #1017 点按重试单例＋每轮至多一次（删＝一次点按多次 requestPermission／每次都再弹授权框）', srcBk.includes('nbRetryTap = onTap;') && srcBk.includes('if (nbRetryUsed === my) return;') && srcBk.includes('nbRetryUsed = my;'));
A('S13 #1017 点按重试只在「还没决定」时挂起', srcBk.includes("!notifyEnabled || nbPermState() !== 'default') return;"));
A('S14 #1017 第二段结论以「发送已落定」为前提', srcBk.includes('!bgT2.done || bgT2.reported') && srcBk.includes('bgT2.done = true;'));
A('S15 #1017 权限被挡时也有当面提示＋诊断补通知通道', srcBk.includes('但浏览器还挡着本站的通知权限') && (() => { try { return readFileSync(join(root, 'src/js/device.js'), 'utf8').includes('最近通知通道='); } catch (e) { return false; } })());
A('S11 说明同口径（功能说明胶囊＋行下说明都改了）', (() => { try { const h = readFileSync(join(root, 'src/js/settings-help.js'), 'utf8'); return h.includes('不用再点第二次开关') && h.includes('第二段（后台阶段）'); } catch (e) { return false; } })() && tpl.includes('现在测（切后台）'));

// ============ B1：一次瞬态 denied 读数不得吃掉存量意图（且权限到位自动生效） ============
console.log('【B1 意图不被一次失真读数吃掉＋自动生效】');
const STUB_TRANSIENT = `(function(){
  localStorage.setItem('xy-home-v2:bg-notify','1');
  var denied = true; setTimeout(function(){ denied = false; }, 1500);
  try { Object.defineProperty(Notification,'permission',{ configurable:true, get:function(){ return denied ? 'denied' : 'granted'; } }); } catch(e){}
  try { Notification.requestPermission = function(){ return Promise.resolve('granted'); }; } catch(e){}
})();`;
await fresh(STUB_TRANSIENT); await passSplash();
await sleep(1600);
let s = await probe();
A('B1 载入 1.6s（权限仍读 denied）：开关保持开＋存储仍是 1', s.notify === true && s.notifyStored === '1', JSON.stringify(s));
await sleep(6500);
s = await probe();
A('B1b 权限转为 granted 后自动生效（无需再点开关）', s.perm === 'granted' && s.notify === true && s.notifyStored === '1', JSON.stringify(s));

// ============ B2/B3：点测试的结果不再被网络拖时间，且报出开关状态 ============
console.log('【B2/B3 点「测试」的延迟与结果内容】');
const STUB_SLOW_VER = `(function(){
  var f = window.fetch;
  window.fetch = function(u, o){ var s = String(u); if (s.indexOf('version.json') >= 0) return new Promise(function(res){ setTimeout(function(){ res(f(u,o)); }, 3000); }); return f(u,o); };
  try { Object.defineProperty(Notification,'permission',{ configurable:true, get:function(){ return 'granted'; } }); } catch(e){}
  try { Notification.requestPermission = function(){ return Promise.resolve('granted'); }; } catch(e){}
})();`;
await fresh(STUB_SLOW_VER); await passSplash();
await ev(`(function(){ window.__t0=0; window.__first=-1; window.__seen='';
  var el=document.getElementById('cc-toast');
  window.__ti=setInterval(function(){ var e=document.getElementById('cc-toast'); if(!e) return; var t=e.textContent||'';
    if (t.indexOf('测试结果') >= 0 && window.__first < 0) { window.__first = Math.round(performance.now()-window.__t0); window.__seen=t; } }, 20); })()`);
await ev(`(function(){ var b=document.getElementById('bg-notify-test'); window.__t0=performance.now(); if(b) b.click(); })()`);
await sleep(6000);
const first = await ev('window.__first'), seen = await ev('window.__seen');
A('B2 version.json 慢 3s 时结果仍 ≤1200ms 出现（不再被网络往返 gate）', first >= 0 && first <= 1200, 'first=' + first + 'ms');
A('B3 结果里报出「后台通知开关」状态行', String(seen || '').includes('后台通知开关'), JSON.stringify(String(seen || '').slice(0, 80)));
A('B3b 结果里报出「通知权限」状态行', String(seen || '').includes('通知权限'), '');
await sleep(3500);
const seen2 = await ev(`(function(){ var e=document.getElementById('cc-toast'); return e? e.textContent : ''; })()`);
A('B3c 版本行随后补进同一条结果（不阻塞但也不丢）', String(seen2 || '').includes('版本'), JSON.stringify(String(seen2 || '').slice(-90)));

// ============ B4：请求被弹回也不丢意图（不再「第一次被拒绝」） ============
console.log('【B4 请求被弹回也不丢意图】');
const STUB_DENIED_REQ = `(function(){
  try { Object.defineProperty(Notification,'permission',{ configurable:true, get:function(){ return window.__p || 'default'; } }); } catch(e){}
  try { Notification.requestPermission = function(){ window.__p='denied'; return Promise.resolve('denied'); }; } catch(e){}
})();`;
await fresh(STUB_DENIED_REQ); await passSplash();
let r = await openRow();
await mtap(r.x, r.y);
await sleep(2500);
s = await probe();
A('B4 请求被弹回后开关不自己关、存储不写 0', s.notify === true && s.notifyStored === '1', JSON.stringify(s));
A('B4b 行下标红如实说明缺哪一步（开关开着也不是「已生效」）', s.warnShown === true && /挡着|还没给|记成「屏蔽」/.test(s.warnText), JSON.stringify(s.warnText.slice(0, 80)));
await ev(`(function(){ window.__p='granted'; })()`);
await sleep(7000);
s = await probe();
A('B4c 权限到位后自动生效（不用再点第二次开关）', s.notify === true && s.warnShown === false, JSON.stringify({ notify: s.notify, warnShown: s.warnShown }));

// ============ B5：第二段·后台阶段（隐藏态真发一条 + 回前台给结论） ============
console.log('【B5 第二段·后台阶段】');
const STUB_SW = `(function(){
  try { localStorage.removeItem('xy-home-v2:bg-notify'); localStorage.removeItem('xy-home-v2:bg-keepalive'); } catch(e){}   // 本场要干净起点（同一浏览器档案跨场景保留存储）
  try { Object.defineProperty(Notification,'permission',{ configurable:true, get:function(){ return 'granted'; } }); } catch(e){}
  try { Notification.requestPermission = function(){ return Promise.resolve('granted'); }; } catch(e){}
  window.__notif = [];
  try {
    var reg = {
      active: { state: 'activated' },
      showNotification: function(title, opts){ window.__notif.push({ title: title, hidden: !!document.hidden }); return Promise.resolve(); },
      getNotifications: function(){ return Promise.resolve(window.__notif.map(function(n){ return { title: n.title }; })); }
    };
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { configurable: true, value: function(){ return Promise.resolve(reg); } });
  } catch (e) {}
})();`;
await fresh(STUB_SW); await passSplash();
// 记录这一场里出现过的所有 toast（#cc-toast 是同一个元素，回前台时别的处理器也会弹 toast，
//   只看「最后一句话」会把被盖掉的结论判成没出——所以记历史再判包含）
await ev(`(function(){ window.__tlog=[]; var seen=''; setInterval(function(){ var e=document.getElementById('cc-toast'); if(!e) return; var t=e.textContent||''; if (t && t!==seen) { seen=t; window.__tlog.push(t); } }, 60); })()`);
await clickTest();
await sleep(2500);
const modal1 = await ev(`JSON.stringify({ open: !(document.getElementById('modal-mask')||{}).hidden, pills: Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill, #modal-pills button'), function(b){return b.textContent;}) })`);
const m1 = JSON.parse(modal1 || '{}');
A('B5 第一段成功后提供「第二段·后台阶段」入口', /切后台/.test((m1.pills || []).join('|')), JSON.stringify(m1));
const clicked = await ev(`(function(){ var arr=[].slice.call(document.querySelectorAll('#modal-pills .pill, #modal-pills button')); var b=arr.filter(function(x){return /切后台/.test(x.textContent);})[0]; if(!b) return 'no-pill'; b.click(); return 'ok'; })()`);
A('B5b 入口可点（选「现在测」）', clicked === 'ok', String(clicked));
await sleep(600);
await setVis('hidden');
await sleep(6500);
const notifHidden = JSON.parse((await ev('JSON.stringify(window.__notif || [])')) || '[]');
A('B5c 页面在后台（隐藏态）真的发出了第二条测试通知', notifHidden.some((n) => n.hidden && String(n.title).indexOf('后台阶段') >= 0), JSON.stringify(notifHidden));
await setVis('visible');
await sleep(2600);
const tlog = JSON.parse((await ev('JSON.stringify(window.__tlog || [])')) || '[]');
A('B5d 回前台给出「第二段（后台阶段）结果」结论', tlog.some((t) => String(t).includes('第二段（后台阶段）结果')), JSON.stringify(tlog.map((t) => String(t).slice(0, 40))));

// ============ B6（#1017）：一记点按只产生一次「再请求」，不得随收口次数翻倍 ============
console.log('【B6 待决(default) 下点按重试不多发请求】');
const STUB_PENDING = `(function(){
  window.__req = 0;
  try { Object.defineProperty(Notification,'permission',{ configurable:true, get:function(){ return 'default'; } }); } catch(e){}
  try { Notification.requestPermission = function(){ window.__req++; return Promise.resolve('default'); }; } catch(e){}
})();`;
await fresh(STUB_PENDING); await passSplash();
r = await openRow();
await mtap(r.x, r.y);
await sleep(13000);                       // 等过 12s 待决窗（窗末会挂一次点按重试）
const req0 = await ev('window.__req');
for (let i = 0; i < 3; i++) { await mtap(60, 300 + i * 40); await sleep(400); }
await sleep(800);
const req1 = await ev('window.__req');
// 旧实现：一记点按被 2 份监听同时接住＝多出 2 次请求，且待决窗结束会再挂一份（每点一下又弹一次）
A('B6 待决时连点 3 下，额外请求 ≤1 次（一记点按至多一次）', (req1 - req0) <= 1, 'req0=' + req0 + ' req1=' + req1);

// ============ B7（#1017）：第二段发送未落定就回前台，不得给出错误结论 ============
console.log('【B7 第二段：未落定不下结论】');
const STUB_SW_SLOW = `(function(){
  try { localStorage.removeItem('xy-home-v2:bg-notify'); } catch(e){}
  try { Object.defineProperty(Notification,'permission',{ configurable:true, get:function(){ return 'granted'; } }); } catch(e){}
  try { Notification.requestPermission = function(){ return Promise.resolve('granted'); }; } catch(e){}
  window.__notif = [];
  try {
    var reg = { active: { state:'activated' },
      showNotification: function(t){ window.__notif.push(t); return new Promise(function(res){ setTimeout(res, 1500); }); },
      getNotifications: function(){ return Promise.resolve([]); } };
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { configurable:true, value: function(){ return Promise.resolve(reg); } });
  } catch(e){}
})();`;
await fresh(STUB_SW_SLOW); await passSplash();
await ev(`(function(){ window.__tlog=[]; var seen=''; setInterval(function(){ var e=document.getElementById('cc-toast'); var t=e?e.textContent:''; if(t&&t!==seen){seen=t;window.__tlog.push(t);} },60); })()`);
await clickTest();
await sleep(3000);
const p2 = await ev(`(function(){ var ps=document.querySelectorAll('#modal-pills .pill, #modal-pills button'); for(var i=0;i<ps.length;i++){ if(/切后台/.test(ps[i].textContent)) { ps[i].click(); return 1; } } return 0; })()`);
A('B7 第二段入口可点', p2 === 1, 'pillClick=' + p2);
await sleep(700);
await setVis('hidden');
await sleep(5200);                        // 后台 5s 后发送，此刻 showNotification 仍差 ~1.3s 落定
await setVis('visible');
await sleep(1000);
const early = JSON.parse((await ev('JSON.stringify(window.__tlog || [])')) || '[]');
const falseNeg = early.some((t) => String(t).indexOf('第二段（后台阶段）结果') >= 0 && String(t).indexOf('✗') >= 0);
A('B7b 发送未落定时不得报「没能发出」（实测旧版此处误报 ✗）', falseNeg === false, JSON.stringify(early.map((t) => String(t).slice(0, 34))));
await sleep(2500);
const settled = JSON.parse((await ev('JSON.stringify(window.__tlog || [])')) || '[]');
const okLine = settled.filter((t) => String(t).indexOf('第二段（后台阶段）结果') >= 0 && String(t).indexOf('✓') >= 0);
A('B7c 落定后给出正确结论（已提交系统）', okLine.length > 0, JSON.stringify(settled.map((t) => String(t).slice(0, 34))));

// ============ Z：零 JS 异常 ============
s = await probe();
A('Z 全程 0 JS 异常', (s.errs || 0) === 0, 'errs=' + s.errs);
await setStub(null);

console.log('RESULT ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail));
if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n'));
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

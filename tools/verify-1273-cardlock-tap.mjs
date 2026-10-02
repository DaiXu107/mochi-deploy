// ===== 回归 #1273：开屏二级密码「输入密码解锁」在部分手机型号上点不动 =====
// 用户实报：「开屏的二级密码【点击密码解锁】的功能，还是有手机型号点击不了……这个问题其他设备型号
// 也有出现」，并明令不得因覆盖式修改让不同型号浏览器的 bug 反复出现。
// 零机型／零 UA 分支：判据只取①事件形态（真触摸派发，不吃合成 click）②组件在场与否。
// 无头真跑（CDP Input.dispatchTouchEvent，不是 element.click()）实测到三条互相独立的死法：
//   ① 按钮只绑 click —— 内核吞掉这一次合成 click（长按起选字／滚动回弹／点按期重渲染）时手指真的点了、
//      界面零反馈；收口＝device.js 的 mochiTapOn 三路（touch／pointer／click）＋800ms 共用防重入闸。
//   ② 入口压根没渲染 —— 旧写法 `if (!card || !window.cardLockOpen) return;` 让 js/card-lock.js 没执行成功
//      （外置包首拉失败、#802 自愈没补回来）时整张卡一个按钮都不出；收口＝状态问不到按默认锁定态渲染。
//   ③ 渲染了但静默 —— promptCardUnlock 开头「任一组件缺失就 return」，删掉 window.openModal 后 click 到了
//      处理函数、弹窗零次、屏幕上一句反馈都没有；收口＝缺哪个组件就在卡上讲哪句真话＋有界复核。
//   ④（#1460 第四腿）内核接管手势去滚动 —— 按在按钮上后位移几像素，内核判定要滚动、接管这一次手势，
//      丢一发 touchcancel/pointercancel 且不补发 click；#1273 三路里 cancel 只清布点、click 又没了 ⇒ 三点
//      同时失效、手指真的点了界面零反馈（无头真跑：位移 3px 后 touchCancel ⇒ 解锁弹窗 0 次）；收口＝
//      给 touch/pointer 各加一条 cancel 腿 + 位移跟踪，复用 tapIsTap 判据（真滑动/长按仍不触发）。
// 用例（VERIFY_ROOT／位置参数指被测副本；两侧同一把尺子）：
//   S1~S12 源锚／产物锚（三路原语、轻点判据、状态探测、缺件真话、容器禁选、cancel 腿＋位移跟踪）
//   B1 正常设备真触摸 → 解锁弹窗恰开 1 次
//   B2 吞掉 click 的内核 → 仍然开弹窗（RED＝零反馈＝症状本体）
//   B3 无 PointerEvent 且吞 click → 仍然开弹窗（RED＝零反馈）
//   B4 长按 900ms 再抬手 → 弹窗恰开 1 次（对照组：两侧皆绿，防把长按修成不响应）
//   B5 一次手势只开一个弹窗（对照组：防三路各自触发＝双开）
//   B6 缺 openModal → 卡上出现「没加载成功」真话（RED＝静默）
//   B7 缺 cardLockTryUnlock → 同上（RED＝静默）
//   B8 js/card-lock.js 整件没加载 → 按钮仍然出现（RED＝一个按钮都不出）
//   B9 按钮生效样式：touch-action:manipulation ＋ 禁选（RED＝auto/可长按选中）
//   B10 全程零 JS 异常（对照组）
//   C1 小位移被内核接管（touchCancel）→ 仍开弹窗（RED＝#1459 症状本体）
//   C2 真滑动 40px 被内核接管 → 不触发（对照组：滚动不受影响）
//   C3 长按 700ms 后被内核接管 → 不触发（对照组）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = normalize(process.argv[2] || process.env.VERIFY_ROOT || (here + '/..'));
try { if (!statSync(join(root, 'index.html')).isFile()) throw new Error('no index.html'); } catch (e) {
  console.error('被测根目录缺 index.html：' + root + '（本脚本量的是构建产物，请先构建再跑）'); process.exit(2);
}
console.log('被测根目录 = ' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
let BLOCK = [];
const server = createServer((req, res) => {
  try {
    const rawUrl = decodeURIComponent(req.url.split('?')[0]);
    if (BLOCK.some((b) => rawUrl.indexOf(b) >= 0)) { res.writeHead(404); res.end('blocked'); return; }
    let p = normalize(join(root, rawUrl));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = Number(process.env.MOCHI_CDP_PORT) || (12730 + Math.floor(Math.random() * 180));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1273-' + port + '-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
if (!ws) { console.error('CDP 连不上（端口 ' + port + ' 可能被占用）'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(2); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
// 任何一次 CDP 往返都要有上限：页内挂了＝这支尺子整串静默挂死（实测 setBypassServiceWorker 之后
// B6 那一趟再没回来），报 FAIL 比不报数有用。
const cap = (p, ms, tag) => Promise.race([p, sleep(ms).then(() => ({ __timeout: tag }))]);
// 累计整程的未捕获异常（Page.navigate 会清掉页内 __jsErrors，跨场景只能靠 CDP 事件收）
const pageExcs = [];
const baseOnMsg = ws.onmessage;
ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') { const d = (m.params || {}).exceptionDetails || {}; pageExcs.push(String((d.exception && d.exception.description) || d.text || '').slice(0, 160)); } } catch (x) {} if (baseOnMsg) baseOnMsg(e); };
const ev = async (e) => { const r = await cap(cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }), 25000, 'ev'); if (r && r.__timeout) return '__TO__'; if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
// 让路：#1250「更新完成 · 存储修复引导」是加载期自弹的单例弹窗——它一开就把开屏按钮的落点盖住、
// 并把 openModal 计数污染成 2（无头实测＝B2/B8 假象同形）。仅设 localStorage 一次性闸不够（引导闸
// 还有 IDB 复核＋让路重试），故在任何页面脚本之前先把这几张引导类弹窗在源头拦掉：拦住的那几张
// 返回一套空 ctl，其余弹窗（含被测的「二级验证」）原样放行并如实计数。
const PRELUDE = [
  "try{localStorage.setItem('xy-home-v2:storage-guide-shown','1250');}catch(e){}",
  'window.__mo=0;window.__moTitles=[];',
  "(function(){var real=null;",
  "Object.defineProperty(window,'openModal',{configurable:true,",
  "get:function(){if(typeof real!=='function')return undefined;",
  "return function(t){if(typeof t==='string'&&/存储修复引导|图片自愈结果|重建异常/.test(t)){return {hint:function(){},stay:function(){},okText:function(){},close:function(){}};}",
  "window.__mo++;window.__moTitles.push(String(t==null?'':t).slice(0,12));return real.apply(this,arguments);};},",
  "set:function(v){real=v;}});})();"
].join('\n');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const results = []; const t = (name, ok, detail) => { results.push({ name, ok }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail === undefined ? '' : '  <- ' + JSON.stringify(detail))); };
const srcOf = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };
const artOf = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };

// ===== S 组：源锚／产物锚 =====
const dev = srcOf('js/device.js'), clk = srcOf('js/clock.js'), css = srcOf('css/base.css');
t('S1 三路轻点原语出口在（删＝又没有单点实现，回到每入口手抄两条腿＝本族反复复发的结构性原因）', dev.includes('window.mochiTapOn = function (el, fn) {'));
t('S2 轻点判据＝位移≤12px 且时长≤450ms', dev.includes('function tapIsTap(dx, dy, dt) { return dt <= 450 && dx * dx + dy * dy <= 144; }'));
t('S3 click 腿只兜底不补枪（防重入闸）', dev.includes('if (Date.now() < tapGuard) { e.preventDefault(); e.stopPropagation(); return; }'));
t('S4 解锁按钮走三路原语（改回裸 addEventListener(click)＝吞 click 的内核上零反馈）', clk.includes('cardLockTap(unlock, function () {'));
t('S5 渲染走状态探测（改回裸调 window.cardLockOpen()＝闸门缺席时一个按钮都不出）', clk.includes('const open = cardLockStateKnown();'));
t('S6 缺件真话（改回「任一缺失就静默 return」＝点了像没反应）', clk.includes("const miss = !window.cardLockTryUnlock ? 'js/card-lock.js'"));
t('S7 产物侧：内联底座已接入 mochiTapOn', artOf('index.html').includes('window.mochiTapOn = function (el, fn) {'));
t('S8 产物侧：外置 js/clock.js 已接入', artOf('js/clock.js').includes('cardLockTap(unlock, function () {'));
t('S9 容器禁选在（src 与产物同一形态）', css.includes('.cardlock-actions { margin-top:9px; display:flex; gap:8px; flex-wrap:wrap; user-select:none;') && artOf('index.html').includes('.cardlock-actions { margin-top:9px; display:flex; gap:8px; flex-wrap:wrap; user-select:none;'));
t('S10 cancel 腿在（删＝内核接管手势去滚动时 touchcancel/pointercancel 只清布点，本批症状原样复发）', dev.includes('function tapCancel(d) {') && dev.includes('if (!tapIsTap(Math.sqrt(d.mx || 0), 0, Date.now() - d.t)) return;'));
t('S11 两路位移跟踪在（删＝cancel 判据恒见最大位移 0，真滑动被接管时也误开弹窗）', dev.includes('if (m > tDown.mx) tDown.mx = m;') && dev.includes('if (m > pDown.mx) pDown.mx = m;'));
t('S12 产物侧：内联底座已接入 cancel 腿', artOf('index.html').includes('function tapCancel(d) {'));

// ===== 无头真触摸 =====
const SEL = '#splash-cardlock-actions .cardlock-btn';
async function boot(pre) {
  // 每一趟都先把 SW 与缓存清干净：前面几个场景会把 sw.js 装起来并预缓存 js/card-lock.js，
  // 之后 B8 在服务端拦那件文件就拦了个空（无头实测：window.cardLockTryUnlock 照样是 function）。
  await ev("(async function(){try{var rs=await navigator.serviceWorker.getRegistrations();for(var i=0;i<rs.length;i++){await rs[i].unregister();}}catch(e){}" +
    "try{var ks=await caches.keys();for(var j=0;j<ks.length;j++){await caches.delete(ks[j]);}}catch(e){}return 1;})()");
  await cdp('Page.navigate', { url: base + '/index.html' });
  await sleep(3400);
  await ev("(function(){var m=document.getElementById('modal-mask');if(m)m.hidden=true;" +
    "var b=document.querySelector('" + SEL + "');if(b)b.scrollIntoView({block:'center'});return 1;})()");
  await sleep(400);
  if (pre) { await ev(pre); await sleep(150); }
  await ev("(function(){var m=document.getElementById('modal-mask');if(m)m.hidden=true;var b=document.querySelector('" + SEL + "');if(b)b.scrollIntoView({block:'center'});return 1;})()");
  await sleep(250);
}
async function btnRect() {
  return await ev("(function(){var b=document.querySelector('" + SEL + "');if(!b)return null;var r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
}
async function aim() {
  const p = await btnRect();
  if (!p) return { bad: 'nobtn' };
  // 落点必须真是这颗按钮（被别的层盖住时不硬测，免得把「盖住了」记成「点不动」）
  const covered = await ev("(function(){var b=document.querySelector('" + SEL + "');var h=document.elementFromPoint(" + ((p.x) | 0) + "," + ((p.y) | 0) + ");return !(h===b||(b&&b.contains(h)));})()");
  return covered ? { bad: 'covered' } : { p };
}
async function tapBtn(hold) {
  const a = await aim(); if (a.bad) return a.bad;
  await cap(cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.p.x, y: a.p.y, id: 1 }] }), 25000, 'touchStart');
  if (hold) await sleep(hold);
  await cap(cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }), 25000, 'touchEnd');
  await sleep(800);
  return 'tapped';
}
// #1459 第四腿要接住的那一发：按在按钮上 → 位移几像素（内核判定要滚动、接管手势）→ touchCancel
//（内核接管后不补发 click）。位移仍在轻点判据内的应认成「点到了」；超出判据的真滑动／长按不触发。
async function cancelBtn(dx, dy, hold) {
  const a = await aim(); if (a.bad) return a.bad;
  await cap(cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.p.x, y: a.p.y, id: 1 }] }), 25000, 'touchStart');
  if (dx || dy) await cap(cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.p.x + dx, y: a.p.y + dy, id: 1 }] }), 25000, 'touchMove');
  if (hold) await sleep(hold);
  await cap(cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }), 25000, 'touchCancel');
  await sleep(800);
  return 'tapped';
}
const seen = () => ev("(function(){return {n:window.__mo|0,titles:window.__moTitles||[]};})()");
const unlockHits = (s) => (s.titles || []).filter((x) => /二级验证/.test(String(x))).length;
const stateText = () => ev("(function(){var s=document.querySelector('#splash-cardlock-actions .cardlock-state');return s?String(s.textContent):null;})()");
const btnFacts = () => ev("(function(){var b=document.querySelector('" + SEL + "');if(!b)return null;" +
  "var cs=getComputedStyle(b);return {touchAction:cs.touchAction,userSelect:cs.userSelect||cs.webkitUserSelect,callout:cs.webkitTouchCallout||'n/a'};})()");
const SWALLOW = "(function(){document.addEventListener('click',function(e){e.stopPropagation();},true);})()";
const NOPTR = "(function(){try{delete window.PointerEvent;}catch(e){}})()";

// B1 正常设备
await boot();
{ const ok = await tapBtn(0); const s = await seen();
  t('B1 正常设备真触摸 → 解锁弹窗打开', ok === 'tapped' && unlockHits(s) === 1, { ok, s }); }
// B2 吞掉 click
await boot(SWALLOW);
{ const ok = await tapBtn(0); const s = await seen();
  t('B2 内核吞掉这一次合成 click → 仍然开弹窗（RED＝手指点了界面零反馈＝症状本体）', ok === 'tapped' && unlockHits(s) >= 1, { ok, s }); }
// B3 无 PointerEvent 且吞 click
await boot(NOPTR + ';' + SWALLOW);
{ const ok = await tapBtn(0); const s = await seen();
  t('B3 无 PointerEvent 且吞 click → touch 腿仍开弹窗', ok === 'tapped' && unlockHits(s) >= 1, { ok, s }); }
// B4 长按（对照组：两侧都该绿，防修成不响应）
await boot();
{ const ok = await tapBtn(900); const s = await seen();
  t('B4 长按 900ms 抬手 → 弹窗仍开（对照组）', ok === 'tapped' && unlockHits(s) >= 1, { ok, s }); }
// B5 一次手势只开一个窗（对照组：绿侧三路只放行一次，红侧单路也是一次）
await boot();
{ const ok = await tapBtn(0); const s = await seen();
  t('B5 一次手势解锁弹窗恰开 1 次（对照组：防三路各自触发＝双开）', ok === 'tapped' && unlockHits(s) === 1, { ok, s }); }
// B6 缺 openModal
await boot('delete window.openModal');
{ const ok = await tapBtn(0); const s = await stateText();
  t('B6 缺 js/personalize.js（openModal 不在）→ 卡上给真话', ok === 'tapped' && /没加载成功/.test(String(s)), { ok, s }); }
// B7 缺 cardLockTryUnlock
await boot('delete window.cardLockTryUnlock');
{ const ok = await tapBtn(0); const s = await stateText();
  t('B7 缺 cardLockTryUnlock → 卡上给真话（点名 js/card-lock.js）', ok === 'tapped' && /card-lock/.test(String(s)), { ok, s }); }
// B8 整件外置包没加载
BLOCK = ['js/card-lock.js'];
await boot();
{ const p = await btnRect(); const s0 = await seen(); let note = null, note2 = null, tap = 'nobtn';
  if (p) {
    tap = await tapBtn(0);
    note = await stateText();
    // 真话还得扛得住一次整卡重渲染：setupCardLockCard 是 actions.innerHTML=''，远程公告回写／状态
    // 事件都会重跑它——不留底的实现到这里就又变成「点了没反应」。
    await ev("document.dispatchEvent(new Event('mochi-cardlock-locked'))");
    await sleep(400);
    note2 = await stateText();
  }
  BLOCK = [];
  t('B8 js/card-lock.js 拉不到 → 按钮仍然出现（RED＝一个按钮都不出）', !!p && s0.n === 0, { btn: !!p, s0 });
  t('B8b js/card-lock.js 拉不到 → 点它给真话而不是沉默', tap === 'tapped' && /card-lock/.test(String(note)), { tap, s: note });
  t('B8c 那句真话扛得住一次整卡重渲染（防「写了又被打回空」＝症状换个形态回来）', /card-lock/.test(String(note2)), { s: note2 }); }
await boot();
// B9 生效样式
{ const f = await btnFacts();
  t('B9 按钮生效样式 touch-action:manipulation ＋ 禁选（防长按选中/双击缩放等待吞掉这一下）', !!f && f.touchAction === 'manipulation' && f.userSelect === 'none', f); }
// B10 零 JS 异常（对照组）
{ t('B10 全程零未捕获异常（对照组）', pageExcs.length === 0, pageExcs.slice(0, 2)); }

// ===== C 组：#1460 第四腿——内核接管手势（touchCancel）时不丢这一下点按 =====
// C1 小位移（3px）→ 内核判定要滚动、接管手势、丢 touchCancel、且不补发 click → 仍开弹窗
//（RED＝三点同时失效：touchcancel 只清布点 + click 被内核接管吞掉 ⇒ 手指真的点了界面零反馈）
await boot();
{ const ok = await cancelBtn(3, 2, 0); const s = await seen();
  t('C1 小位移被内核接管（touchCancel）→ 仍然开弹窗（RED＝#1460 症状本体）', ok === 'tapped' && unlockHits(s) >= 1, { ok, s }); }
// C2 对照组：真滑动（40px）→ cancel 腿不触发（页面滚动不受影响，防把翻页修成误点）
await boot();
{ const ok = await cancelBtn(40, 0, 0); const s = await seen();
  t('C2 真滑动 40px 被内核接管 → 不触发解锁（对照组：滚动不受影响）', ok === 'tapped' && unlockHits(s) === 0, { ok, s }); }
// C3 对照组：长按（700ms）后被内核接管 → 不触发（防把长按修成点按）
await boot();
{ const ok = await cancelBtn(0, 0, 700); const s = await seen();
  t('C3 长按 700ms 后被内核接管 → 不触发解锁（对照组：防长按被误判成点按）', ok === 'tapped' && unlockHits(s) === 0, { ok, s }); }

const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log('合计 ' + pass + '/' + results.length + '（失败 ' + fail + '）');
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

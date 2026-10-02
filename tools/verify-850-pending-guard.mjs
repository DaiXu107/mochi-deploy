// ===== 回归 #850：my-arc/cjian 回填期「读空覆盖」根治（加载占位全域审计·批1）=====
// 背景（与机型无关的时序差）：idbRestore 未完成时 xyStore 读到空 ≠ 真没数据。
//   · my-arc.js：ensureArcFor 读空即建档并 saveFor 整包落盘（空档顶掉真实档案、毒化
//     arcCache 整会话）；absorbSharedOnce 把「共享档读空」误判成没内容直接 remove 根键；
//   · cjian.js：seedIfEmpty 见 cjian-seeded 读空即播种 → saveRoster 整包覆盖真实梦角名单
//     （LS 失效/回填迟到设备必现＝用户数据真丢）。
// 修法＝#797 范式：pending 出占位、占位期不写不播种不删键；mochi-restore-done 后幂等补跑。
// 夹具手法：正常加载就绪后，①手工把 __mochiDataReady 扣回 false（mochiDataPending 立即为真）；
//   ②把 myarc/cjian-roster/cjian-seeded 从 localStorage+memoryCache 抹掉、只留 IDB 权威值
//   （＝「LS 失效/回填迟到」的真实形态，xyStore.get 回回读空）。
// 断言（绿产物全过；纯 HEAD 红：M1 M2 M5 C1 C2 C4 恰落缺陷面，余为非判别守护）：
//   M 组 my-arc：占位/不落盘不毒缓存/回填期不删共享根键/就绪后真数据回显/共享吸收补跑
//   C 组 cjian：占位/不播种不覆盖名单/就绪后名单回显/IDB 名单全链路未被顶掉
//   Z 组 零新增 JS 异常
// 用法：node tools/verify-850-pending-guard.mjs
//       仓外副本验证：SERVE_DIR=<构建目录> node tools/verify-850-pending-guard.mjs
//       红基线：另建一份 git archive HEAD 副本（不含本批 src）build 后用同一 SERVE_DIR 跑
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_DIR || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 80));
const profile = join(process.env.TEMP || '/tmp', 'mochi-850-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 260)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
};
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + JSON.stringify(detail) + ']'));
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 785 同款「扣住就绪」夹具：空库快恢复时 restore 在 defer 模块注册前就完成——HEAD 版
// mochiOnDataReady「已就绪即早退」，boot 补渲/补吸收监听根本不挂（#785b 两层版尚在另一会话
// 在途）。扣住 __mochiDataReady 首次置位与 done 派发，让全部模块以 pending 态完成注册，
// 再统一放行＝确定性复现「慢机器」时序（本批守护的正是这条链）。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__mo850Held = false; window.__mo850HeldEvents = [];
  var cur, held = false;
  Object.defineProperty(window, '__mochiDataReady', {
    configurable: true,
    get: function(){ return held ? false : cur; },
    set: function(v){
      if (v && !window.__mo850Released && !held) { held = true; cur = true; window.__mo850Held = true; return; }
      cur = v;
    }
  });
  var disp = document.dispatchEvent.bind(document);
  document.dispatchEvent = function (ev) {
    if (ev && ev.type === 'mochi-restore-done' && !window.__mo850Released) { window.__mo850HeldEvents.push(ev); return true; }
    return disp(ev);
  };
  window.__mo850Release = function () {
    window.__mo850Released = true;
    if (held) {
      held = false;
      Object.defineProperty(window, '__mochiDataReady', { value: true, writable: true, configurable: true });
    }
    window.__mo850HeldEvents.forEach(function (ev) { try { disp(ev); } catch (e) {} });
    window.__mo850HeldEvents.length = 0;
    return true;
  };
})()` });
await cdp('Page.navigate', { url: baseUrl + '/index.html?d850=' + Date.now() });
await sleep(2200);
for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mo850Held || !!window.__mochiDataReady')) break; await sleep(300); }
// 放行（defer 模块全部注册完毕后才 ready——M5 done 补吸收链的注册前提）
await evalJs("(function(){ if (document.readyState !== 'complete') return 'not-complete'; return window.__mo850Release ? window.__mo850Release() : 'no-stub'; })()");
await sleep(600);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(800);
await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
await sleep(700);
await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");

const errBase = await evalJs("((window.__jsErrors||[]).length)");
const P = 'xy-home-v2:default';

// ---- 合成「真实形态」权威数据直灌 IDB（故意不调用 open 渲染：模块缓存保持干净，
// 红基线的 pending 落盘路径才不被物化期的缓存命中掩盖）----
const ARC = JSON.stringify({ created: 1700000000000, tastes: [{ id: 'tg1', v: '吃葡萄吃葡萄' }], habits: [], things: [], selfs: [], dreams: [], ifchanges: [], who: { f: {} }, relate: { f: {}, notes: [] }, ifw: {} });
const ROS = JSON.stringify([{ id: 'r850', name: '阿松', offsetMin: 0, cid: 'default', manual: 1 }]);
const mat = await evalJs(`(async function(){
  try {
    var arcK='${P}:myarc', rosK='${P}:cjian-roster';
    var d=window.xyStore('${P}');
    d.remove('myarc'); d.remove('cjian-roster'); d.remove('cjian-seeded');
    await window.idbSet(arcK, ${JSON.stringify(ARC)});
    await window.idbSet(rosK, ${JSON.stringify(ROS)});
    var idbOK = false;
    for (var w = 0; w < 30; w++) {
      if ((await window.idbGet(arcK)) === ${JSON.stringify(ARC)} && (await window.idbGet(rosK)) === ${JSON.stringify(ROS)}) { idbOK = true; break; }
      await new Promise(function(r){setTimeout(r,300);});
    }
    return JSON.stringify({ err: null, idbOK: idbOK,
      lsArc: localStorage.getItem(arcK), lsRos: localStorage.getItem(rosK),
      mcArc: window.idbGetCached(arcK), mcRos: window.idbGetCached(rosK) });
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`);
let mo = {}; try { mo = JSON.parse(mat || '{}'); } catch (e) {}
check('M0/C0 夹具就位：IDB 有权威值、LS+memoryCache 读空（回填迟到形态复现）',
  !mo.err && mo.idbOK === true && mo.lsArc === null && mo.lsRos === null && mo.mcArc == null && mo.mcRos == null,
  mo.err || mo);
if (mo.err) { chrome.kill(); server.close(); process.exit(1); }
const rosName = '阿松';

// ---- 扣回 pending（mochiDataState 全靠 __mochiDataReady 标志，时序判据零机型分支）----
const pendState = await evalJs("window.__mochiDataReady=false;window.__mochiDataSlow=false;[window.mochiDataState(),window.mochiDataPending()].join('|')");
check('P1 扣回就绪标志 → pending=true（夹具通道有效）', pendState === 'loading|true', pendState);

// ===== M 组：my-arc =====
await evalJs(`(function(){ window.openMyArc(); return 1; })()`);
await sleep(700); // 给 HEAD 缺陷形态的异步落盘（idbSet）留窗口
const m1 = await evalJs(`(function(){
  var r=document.getElementById('myarc-root');
  return JSON.stringify({ ph: !!r && r.textContent.indexOf('还在读取') >= 0 && r.textContent.indexOf('我的档案') >= 0,
    chips: !!r && !!r.querySelector('.narc-chip') });
})()`);
let m1o = {}; try { m1o = JSON.parse(m1); } catch (e) {}
check('M1 回填期打开我的档案＝整体加载占位（HEAD 红：当场渲染出建档后的正文）', m1o.ph === true && m1o.chips === false, m1o);
const m2 = await evalJs(`(async function(){
  var d=window.xyStore('${P}');
  return JSON.stringify({ ls: localStorage.getItem('${P}:myarc'), mc: window.idbGetCached('${P}:myarc') == null,
    idbSame: (await window.idbGet('${P}:myarc')) === ${JSON.stringify(ARC)} });
})()`);
let m2o = {}; try { m2o = JSON.parse(m2); } catch (e) {}
check('M2 占位期不落盘不毒缓存：LS 仍空、memoryCache 无该键（红在 M2b 终判）',
  m2o.ls === null && m2o.mc === true, m2o);
// 回填期派发 done（模拟备份导入/迟到派发）：#850c 保证吸收链让位、不删共享根键
const m3 = await evalJs(`(function(){
  window.xyStore('xy-home-v2').set('myarc-shared', '{"created":1}');
  document.dispatchEvent(new Event('mochi-restore-done'));
  return window.xyStore('xy-home-v2').get('myarc-shared');
})()`);
check('M3 回填期共享档读空不误删根键（守护：done 迟到派发时吸收链整体让位）', m3 !== null && m3 !== undefined, m3);

// ===== C 组：cjian（同一 pending 窗口）=====
await evalJs(`(function(){ window.closeMyArc(); window.openCjian(); return 1; })()`);
await sleep(700);
const c1 = await evalJs(`(function(){
  var l=document.getElementById('cj-list'), e=document.getElementById('cj-empty');
  return JSON.stringify({ ph: !!l && l.textContent.indexOf('梦角名单还在读取') >= 0,
    fakeEmpty: !!l && (l.textContent.indexOf('还没有梦角') >= 0 || (e && !e.hidden && e.textContent.indexOf('还没有梦角') >= 0)) });
})()`);
let c1o = {}; try { c1o = JSON.parse(c1); } catch (e) {}
check('C1 回填期打开此间＝名单加载占位，不说「还没有梦角」（HEAD 红：假空态/建档种子）', c1o.ph === true && c1o.fakeEmpty === false, c1o);
const c2 = await evalJs(`(async function(){
  return JSON.stringify({ lsR: localStorage.getItem('${P}:cjian-roster'), lsS: localStorage.getItem('${P}:cjian-seeded'),
    mcR: window.idbGetCached('${P}:cjian-roster') == null,
    idbSame: (await window.idbGet('${P}:cjian-roster')) === ${JSON.stringify(ROS)} });
})()`);
let c2o = {}; try { c2o = JSON.parse(c2); } catch (e) {}
check('C2 占位期不播种不覆盖：LS 仍空、种子标记未写、memoryCache 未毒（红在 M2b 终判）',
  c2o.lsR === null && c2o.lsS === null && c2o.mcR === true, c2o);
// IDB 侧的覆盖写要排会话积压落盘队列（聊天大包同 store），限时轮询取终判：
// 绿＝权威档案/名单全链路未被动过；红＝落盘迟到也会到达＝恰在此翻红
const m2b = await evalJs(`(async function(){
  var arc0 = ${JSON.stringify(ARC)}, ros0 = ${JSON.stringify(ROS)};
  var a = await window.idbGet('${P}:myarc'), r = await window.idbGet('${P}:cjian-roster');
  for (var w = 0; w < 20; w++) {
    if (a !== arc0 || r !== ros0) break;
    await new Promise(function(x){setTimeout(x,300);});
    a = await window.idbGet('${P}:myarc'); r = await window.idbGet('${P}:cjian-roster');
  }
  return JSON.stringify({ arcSame: a === arc0, rosSame: r === ros0, rosHead: String(r).slice(0, 50) });
})()`);
let m2bo = {}; try { m2bo = JSON.parse(m2b); } catch (e) {}
check('M2b 占位期两模块均未整包覆盖 IDB 权威值（HEAD 红：建档落盘/种子名单已顶掉真值）',
  m2bo.arcSame === true && m2bo.rosSame === true, m2bo);

// ---- 放行就绪：restore 的真实语义＝小键只回填 localStorage、不碰 memoryCache
// （idbRestore 直接 setItem LS；若走 xyStore.set 会连 IDB 一起复原＝替红基线擦屁股）----
const fire = await evalJs(`(async function(){
  localStorage.setItem('${P}:myarc', ${JSON.stringify(ARC)});
  localStorage.setItem('${P}:cjian-roster', ${JSON.stringify(ROS)});
  window.__mochiDataReady=true; window.__mo850Fired=true;
  document.dispatchEvent(new Event('mochi-restore-done'));
  await new Promise(function(r){setTimeout(r,300);});
  return 1;
})()`);
await sleep(600);
// 重新放一份「有内容」共享档（M3 那份是空档；吸收后根键应被清、条目并入 default 档案）
const m5b = await evalJs(`(async function(){
  window.xyStore('xy-home-v2').set('myarc-shared', '{"created":1,"tastes":[{"id":"sh9","v":"共享吸收条目"}]}');
  document.dispatchEvent(new Event('mochi-restore-done'));
  await new Promise(function(r){setTimeout(r,400);});
  var g=window.xyStore('xy-home-v2');
  var idbArc = await window.idbGet('${P}:myarc');
  return JSON.stringify({ sharedGone: g.get('myarc-shared') === null, absorbed: !!idbArc && idbArc.indexOf('sh9') >= 0,
    st: window.mochiDataState(), sharedRaw: String(g.get('myarc-shared')).slice(0,40), rootLen: (document.getElementById('myarc-root')||{}).textContent ? document.getElementById('myarc-root').textContent.length : -1 });
})()`);
let m5bo = {}; try { m5bo = JSON.parse(m5b); } catch (e) {}
check('M5 就绪后补跑一次性吸收：带内容共享档并入 default 档案且根键清除（HEAD 红：done 无监听器、吸收永不补跑）',
  m5bo.sharedGone === true && m5bo.absorbed === true, m5bo);
await evalJs("(function(){ window.closeCjian(); window.openMyArc(); return 1; })()");
await sleep(600);
const m4 = await evalJs(`(function(){
  var r=document.getElementById('myarc-root');
  return JSON.stringify({ ph: !!r && r.textContent.indexOf('还在读取') >= 0, has: !!r && r.textContent.length > 40 });
})()`);
let m4o = {}; try { m4o = JSON.parse(m4); } catch (e) {}
check('M4 就绪后档案页渲染真数据、无占位残留', m4o.ph === false && m4o.has === true, m4o);
await evalJs("(function(){ window.closeMyArc(); window.openCjian(); return 1; })()");
await sleep(800);
const c3 = await evalJs(`(function(){
  var l=document.getElementById('cj-list');
  return JSON.stringify({ txt: !!l && l.textContent.indexOf(${JSON.stringify(rosName)}) >= 0,
    ph: !!l && l.textContent.indexOf('还在读取') >= 0 });
})()`);
let c3o = {}; try { c3o = JSON.parse(c3); } catch (e) {}
if (!c3o.txt) console.log('C3 dump:', JSON.stringify(await evalJs("(function(){var l=document.getElementById('cj-list');return l?l.textContent.slice(0,160):'nf';})()")));
check('C3 就绪后名单回显真实梦角（HEAD 红：种子名单曾写进 memoryCache 顶住回填值，名单变成本尊种子）', c3o.txt === true && c3o.ph === false, c3o);
const c4 = await evalJs(`(async function(){
  var ros = await window.idbGet('${P}:cjian-roster');
  return JSON.stringify({ same: ros === ${JSON.stringify(ROS)}, seeded: localStorage.getItem('${P}:cjian-seeded'), ros: String(ros).slice(0, 120) });
})()`);
let c4o = {}; try { c4o = JSON.parse(c4); } catch (e) {}
check('C4 全链路结束 IDB 名单仍是原权威值（HEAD 红：pending 期播种整包覆盖后无人复原）',
  c4o.same === true && c4o.seeded === '1', c4o);
const z = await evalJs(`(function(){ return JSON.stringify(((window.__jsErrors||[]).slice(${errBase}))); })()`);
let zArr = []; try { zArr = JSON.parse(z || '[]'); } catch (e) {}
check('Z 全程零新增 JS 异常', zArr.length === 0, zArr.slice(0, 2));

const fails = results.filter((r) => !r.ok);
console.log('\n===== #850 回填期读空覆盖根治：' + (results.length - fails.length) + '/' + results.length + ' =====');
fails.forEach((f) => console.log('FAIL: ' + f.desc));
try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch (e) {}
chrome.kill(); server.close();
process.exit(fails.length ? 1 : 0);

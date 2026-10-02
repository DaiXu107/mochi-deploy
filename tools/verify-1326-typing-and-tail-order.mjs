// ===== 常驻回归脚本 #1326：聊天「对方正在输入中」不出消息 ＋ 构建期到达的新消息被挂到列表头部 =====
// 用法：node tools/verify-1326-typing-and-tail-order.mjs [被测根目录]
// 症状（用户实报 2026-09-27，一加 12／Via 浏览器＋诊断单 mochi-diag-2026-09-27-02-57-30…docx）：
//   「对方主动发消息这一块弹出会有问题，显示『对方正在输入中』，但是不出消息，退出以后再进去才会显现」
//   ＋「这个问题其他设备型号也有出现，不要覆盖修改导致不同型号设备浏览器的 bug 反复出现」。
// 两件事没有共同成因，各自一处收口，判据一律零机型／零 UA 分支：
// ① 位置（无头实测＝症状本体）：#1004 给「构建在飞时迟到的那一格」暂存进 batchDefer.q，判据是
//   「节点下标 ≥ 本轮开轮条数」。可 `renderMsg` 各分支在建节点时一律预写 `msgs.length-1`，调用方
//   要到 **函数返回之后**才覆盖成真实下标，而挂载（appendMsg）在函数内部就先跑了 ⇒ 分帧整窗构建
//   期间每挂一格都被读成「迟到」（provisional 下标恒 ≥ 开轮条数），整批改道进 q，连真迟到的那条
//   一起按到达顺序排在最前＝新消息落在列表**头部**（屏上贴底时它在视口外一万一千像素之上，
//   实测 head=[300] tail=[…,299]）；窗口凭据又被对齐成「已追平」⇒ 怎么等都不自愈，只有整窗重建
//   （退出聊天再进来）才显现。修法＝真实下标由调用方在挂载之前交给这一格（renderMsg(rec, atIdx)）。
// ② 承诺：「对方正在输入」此前**没有期限**——投递用 setTimeout(fn, 设定的回复时长)，页面被整页冻结／
//   深度节流时那一发几十分钟不回来（随附诊断单实测：回复时间=1~15s，而 回复实测=12.6s|61.2s|388.3s），
//   行就一直挂着；enterChat 还照旧按 typingOn 把它重新点亮＝每进一次聊天页把这句谎重说一遍。
//   修法＝showTyping 当场登记到期时刻（上界从设定里读：rs-max＋本文件其它链路自有的最长等待＋余地），
//   到期复核同时挂在自选看门狗与「回前台三通道／进聊天页」上（冻结期连看门狗一起冻住）。
// 断言：
//   S1~S17 静态锚（src 与产物各一条；S17 为删除型：分支不得再各写 provisional 下标）
//   B0 前提：300 条历史进聊天页＝分帧整窗轮跑完、屏上贴底有内容
//   B1 【判别核心·①】构建在飞时到达的新消息落在列表**尾部**且在视口内
//   B2 该消息在屏上只有一格（不重复）
//   B3 屏上 data-idx 序列单调递增（没有「新的排在旧的前面」）
//   B4 本轮整窗的每一格都还在屏上（改道进队列的节点没被丢掉）
//   B5 #1313 那一面（0ms 自续链被吞＋构建期来消息）看门狗接管后同样落在尾部可见
//   B6 对照：没有构建在飞时，普通收发的新消息照旧在尾部可见（旧契约零变化）
//   C0 前提：真实回复链确实点亮了「对方正在输入」行
//   C1 承诺窗口内不得提前收（诚实的等待不许被砍）
//   C2 窗口内退出重进照旧仍在（对照组，两侧皆绿）
//   C3 【判别核心·②】那一发被冻住且已过期 → 重进聊天页把行收掉
//   C4 收行不得吃消息：msgs 一条不少、解冻后消息照常落地且行收起
//   C5 现场留证 __chatTypingExpired 有读数（迟到多久、从哪条路复核到的）
//   C6 看门狗自己就能收（不依赖任何进出页事件）
//   Z1 全程零未捕获 JS 异常
// RED 基线（纯 HEAD 副本）：S1~S17 缺锚＋B1/B3/B4/B5＋C3/C5/C6 红，其余两侧皆绿。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
console.log('被测根目录 =', root, '（index.html ' + (statSync(join(root, 'index.html'), { throwIfNoEntry: false }) ? '在' : '缺') + '）');
if (!statSync(join(root, 'index.html'), { throwIfNoEntry: false })) { console.error('被测根目录没有产物 index.html＝没构建／铺错目录，判环境不满足'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 320) : '')); } };

console.log('静态断言:');
let srcTxt = '', prodTxt = '';
try { srcTxt = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { prodTxt = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
if (!prodTxt) { console.error('SKIP: 读不到产物 js/chat.js'); process.exit(2); }
const cnt = (txt, s) => txt.split(s).length - 1;
const NEEDLES = [
  ['S1', 'S2', '真实下标在挂载前落定（renderMsg 的 atIdx 口径）', 'const __msgAt = Number.isFinite(atIdx) ? atIdx : msgs.length - 1;'],
  ['S3', 'S4', '两条整窗路径把 i 交给这一格', 'const m = renderMsg(_rm, i);', 2],
  ['S5', 'S6', '上翻／补尾两条增量路径同样交 i', 'const m = renderMsg(msgs[i], i);', 2],
  ['S7', 'S8', '点亮这一行就登记到期时刻', 'typingDueAt = Date.now() + chatTypingHorizonMs();'],
  ['S9', 'S10', '到期判据只取「承诺过期了没有」', 'if (!typingOn || !typingDueAt || Date.now() < typingDueAt) return false;'],
  ['S11', 'S12', '兑现／作废时期限一并撤掉', 'typingDueAt = 0; // #1326'],
  ['S13', 'S14', '进聊天页先复核承诺', "chatTypingReconcile('enter');"],
  ['S15', 'S16', '回前台通道也复核（冻结期看门狗一起冻住）', "document.addEventListener('mochi-fg-resume', function () { chatTypingReconcile('fg'); });"],
];
for (const [tagSrc, tagProd, label, needle, times] of NEEDLES) {
  const want = times || 1;
  A_(tagSrc + ' ' + label + '（源）', cnt(srcTxt, needle) === want, { got: cnt(srcTxt, needle), want });
  A_(tagProd + ' ' + label + '（产物）', cnt(prodTxt, needle) === want, { got: cnt(prodTxt, needle), want });
}
// S17 删除型：分支不得再各写「当前最后一条的下标」当自己的身份（＝①那一族的尺子来源）
A_('S17 分支不再各写 provisional 下标（产物 0 次）', cnt(prodTxt, 'm.dataset.idx = msgs.length - 1;') === 0, { got: cnt(prodTxt, 'm.dataset.idx = msgs.length - 1;') });
A_('S17b 同上（src 0 次）', cnt(srcTxt, 'm.dataset.idx = msgs.length - 1;') === 0, { got: cnt(srcTxt, 'm.dataset.idx = msgs.length - 1;') });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9811 + (process.pid % 40);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '.', 'mochi-1326-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

function mkClient(wsUrl) {
  const c = { pend: new Map(), id: 0, errors: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl); c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String((m.params.exceptionDetails || {}).text || (m.params.exceptionDetails.exception || {}).description || '').slice(0, 160)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  c.evalJs = async (expr) => {
    try {
      const r = await c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) return null;
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  c.snap = async (mark) => JSON.parse(await c.evalJs(SNAP(mark)) || '{"err":1}');
  return c;
}
const listTargets = async () => (await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json());
async function waitCdp() { for (let i = 0; i < 80; i++) { try { await listTargets(); return; } catch (e) { await sleep(200); } } throw new Error('no cdp'); }

// 夹具：停存定时器。z＝吞「链式让帧」的 0ms 自续链（#1313 那一面）；[min,max]＝只吞落在区间的延时器
//（真机整页冻结／深度节流＝那一发投递定时器不再到点的等价形态；max 用来「只冻投递、留看看门狗」）
const PARK = `(function(){
  if (window.__p) return 'already';
  window.__p = { raw: window.setTimeout, q: [], on: false, z: false, min: 1e9, max: 1e9 };
  window.setTimeout = function (fn, ms) {
    var v = (ms === undefined ? 0 : ms);
    var hit = typeof fn === 'function' && (v === 0 ? window.__p.z : (v >= window.__p.min && v <= window.__p.max));
    if (window.__p.on && hit) { window.__p.q.push([v, fn]); return 999; }
    return window.__p.raw.apply(window, arguments);
  };
  return 'ok';
})()`;
const park = (o) => `(function(){ window.__p.z = ${o.z ? 'true' : 'false'}; window.__p.min = ${o.min === undefined ? 1e9 : o.min}; window.__p.max = ${o.max === undefined ? 1e9 : o.max}; window.__p.on = true; return 'on'; })()`;
const unpark = `(function(){ window.__p.on = false; window.__p.z = false; window.__p.min = 1e9; window.__p.max = 1e9; return 'off'; })()`;
const thaw = `(function(){ var q = window.__p.q.splice(0, window.__p.q.length); q.forEach(function (it) { try { it[1](); } catch (e) {} }); return q.length; })()`;

// 现场读数：以「屏上最后一个带下标的格子」与「命中文本的那一格」为准（结构＋几何，不读内部变量）
const SNAP = (mark) => `(function(){
  var mark = ${JSON.stringify(mark || '')};
  var b = document.getElementById('chat-body'), t = document.getElementById('chat-typing');
  var kids = b ? [].slice.call(b.children) : [], idxs = [], hit = null, hitN = 0;
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i], v = (k.dataset && k.dataset.idx !== undefined) ? parseInt(k.dataset.idx, 10) : NaN;
    if (isFinite(v)) idxs.push(v);
    if (mark && (k.textContent || '').indexOf(mark) >= 0) { hit = k; hitN++; }
  }
  var o = { count: kids.length, n: window.getChatMsgs ? window.getChatMsgs().length : -1, idxN: idxs.length,
    rowHidden: t ? !!t.hidden : null, st: b ? Math.round(b.scrollTop) : -1,
    max: b ? Math.round(b.scrollHeight - b.clientHeight) : -1, parked: window.__p ? window.__p.q.length : -1,
    exp: window.__chatTypingExpired ? window.__chatTypingExpired.slice(-1)[0] : null,
    expN: window.__chatTypingExpiredN || 0,
    pump: window.__chatPumpDiag ? window.__chatPumpDiag() : null,
    lastIdx: idxs.length ? idxs[idxs.length - 1] : -1, asc: 0, dupIdx: 0 };
  for (var j = 1; j < idxs.length; j++) { if (idxs[j] <= idxs[j - 1]) o.asc++; }
  var seen = {}; idxs.forEach(function (v) { if (seen[v]) o.dupIdx++; seen[v] = 1; });
  if (hit) {
    var r = hit.getBoundingClientRect(), br = b.getBoundingClientRect();
    var pos = -1; for (var q2 = 0; q2 < kids.length; q2++) { if (kids[q2] === hit) { pos = q2; break; } }
    o.hit = { pos: pos, last: pos === kids.length - 1, op: getComputedStyle(hit).opacity,
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      inView: r.top >= br.top - 2 && r.bottom <= br.bottom + 2 && r.bottom > br.top };
    o.hitN = hitN;
  } else o.hit = null;
  return JSON.stringify(o);
})()`;

let C = null;
try {
  await waitCdp();
  C = mkClient((await listTargets()).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await C.connect();
  await C.cdp('Page.enable'); await C.cdp('Runtime.enable');
  await C.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 792, deviceScaleFactor: 3, mobile: true });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  await C.cdp('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await C.cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,service_workers' });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await C.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return 1;})()");
  await sleep(500);
  // 关掉会与断言抢计时的随机链（主动发送／撤回／无回应／拍一拍／多字卡），并把回复窗口压到 3s
  //（→ 承诺期限＝max(3000,2600)+5000 = 8s，尺子里 C 组按这个数等）
  await C.evalJs(`(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}['ta-ask','ta-choose','ta-curious','ta-roast','ta-tacc'].forEach(function(k){try{var s2=window.activeStore();var r=s2.get(k);var d=r?JSON.parse(r):{};d.settings=d.settings||{};d.settings.enabled=false;s2.set(k,JSON.stringify(d));}catch(e){}});try{var s3=window.activeStore();['as-en','rc-prob','rn-prob','touch-prob','py-en','quote-prob'].forEach(function(k){s3.set('reply-'+k,'0');});s3.set('reply-rs-min','3');s3.set('reply-rs-max','3');}catch(e){}return 1;})()`);
  await sleep(500);
  await C.evalJs(PARK);
  await C.evalJs(`(function(){ var now=Date.now(), arr=[]; for (var i=0;i<300;i++) arr.push({side:i%2?'in':'out',text:'历史'+String(i).padStart(3,'0'),ts:now-(300-i)*60000}); return window.chatImportMsgs(arr); })()`);
  await sleep(2500);
  await C.evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return 1;})()`);
  await sleep(4000);

  console.log('\n行为断言 ①（构建期到达的新消息落在哪）:');
  const b0 = await C.snap('');
  A_('B0 前提：300 条进聊天页后屏上有内容、贴底、整窗轮零事故（夹具真跑起了分帧轮）', b0.count >= 150 && b0.st === b0.max && !(b0.pump && b0.pump.flying) && b0.asc === 0, b0);
  // 整窗重建在飞的那一拍里来一条消息（正常轮：不吞任何定时器＝真机上「构建那几百毫秒」的等价形态）
  await C.evalJs(`(function(){ window.chatImportMsgs(window.chatExportMsgs()); window.chatAddIn('一三二六甲·构建期到达', {initiative:true}); return 1; })()`);
  await sleep(3000);
  const b1 = await C.snap('一三二六甲');
  A_('B1 【核心】构建在飞时到达的消息落在列表尾部、可见、不透明', !!b1.hit && b1.hit.last === true && b1.hit.inView === true && Number(b1.hit.op) === 1, b1);
  A_('B2 该消息在屏上只有一格', b1.hitN === 1, { hitN: b1.hitN });
  A_('B3 屏上 data-idx 序列单调递增（没有「新的排在旧的前面」）', b1.asc === 0, { asc: b1.asc, count: b1.count, lastIdx: b1.lastIdx });
  A_('B4 本轮整窗的每一格都还在屏上（改道队列的节点没被丢）', b1.count >= 200 && b1.dupIdx === 0, { count: b1.count, dupIdx: b1.dupIdx, n: b1.n });
  // #1313 那一面：0ms 自续链被吞＋构建期来消息 → 看门狗接管换装后同样要在尾部可见
  await C.evalJs(park({ z: true }));
  await C.evalJs(`(function(){ return window.chatImportMsgs(window.chatExportMsgs()); })()`);
  await sleep(400);
  const b5a = await C.snap('');
  await C.evalJs(`(function(){ window.chatAddIn('一三二六乙·吞链期到达', {initiative:true}); return 1; })()`);
  await sleep(4200);
  const b5 = await C.snap('一三二六乙');
  A_('B5a 前提：那条 0ms 自续链确实没回来（屏上就停在「整窗被清空、构建在飞」那一瞬）', b5a.count < 50 && b5a.pump && b5a.pump.flying === true, b5a);
  A_('B5 看门狗接管换装后，那条消息同样在尾部可见（#1313 与本批共用一把尺子）', !!b5.hit && b5.hit.last === true && b5.hit.inView === true && b5.asc === 0, b5);
  A_('B5b 接管确实发生过（留证在场＝这一发真走了看门狗）', b5.pump && b5.pump.incidents && b5.pump.incidents.length > 0, b5.pump);
  await C.evalJs(unpark);
  await C.evalJs(thaw);
  await sleep(1500);
  // 对照：无构建在飞的普通收发
  await C.evalJs(`(function(){ window.chatAddIn('一三二六丙·普通收发', {initiative:true}); return 1; })()`);
  await sleep(1500);
  const b6 = await C.snap('一三二六丙');
  A_('B6 对照：普通收发的新消息照旧在尾部可见（旧契约零变化）', !!b6.hit && b6.hit.last === true && b6.hit.inView === true, b6);
  // 构建在飞期间连续来 6 条＝真机「整页冻结后解冻、积压的那几发一口气落地」的等价形态：
  // 迟到队列按到达顺序补挂，因此**第一批**迟到的就会占住队首，旧写法下整批被挂到列表头部。
  await C.evalJs(park({ z: true }));
  await C.evalJs(`(function(){ return window.chatImportMsgs(window.chatExportMsgs()); })()`);
  await sleep(500);
  for (let k = 0; k < 6; k++) {
    await C.evalJs(`(function(){ window.chatAddIn('一三二六丁' + (${k}) + '·构建期连发', {initiative:true}); return 1; })()`);
    await sleep(140);
  }
  await C.evalJs(unpark);
  await C.evalJs(thaw);
  await sleep(3000);
  const b9 = await C.snap('一三二六丁');
  A_('B9 构建期连发六条：六条全在屏上、按序排在末尾、最后一条在视口里（解冻补投那一口气）', b9.hitN === 6 && !!b9.hit && b9.hit.last === true && b9.hit.inView === true && b9.asc === 0 && b9.dupIdx === 0, b9);

  console.log('\n行为断言 ②（「对方正在输入」的承诺要有期限）:');
  // 冻住投递那一发（3s）与自家看门狗（8s）＝真机整页冻结的等价形态
  const cfgChk = JSON.parse(await C.evalJs(`(function(){var c=(window.replyCfg&&window.replyCfg())||{};return JSON.stringify({rsMax:c['rs-max'],asEn:c['as-en'],hor:Math.max((c['rs-max']||0)*1000,2600)+5000});})()`) || '{}');
  A_('C0a 前提：夹具设定的回复窗口真的被读到（种子写错＝这把尺子失明）', Number(cfgChk.rsMax) === 3 && Number(cfgChk.asEn) === 0 && Number(cfgChk.hor) === 8000, cfgChk);
  await C.evalJs(park({ min: 2000 }));
  await C.evalJs(`(function(){ try { window.replyCfg && window.replyCfg(); } catch (e) {} window.chatAddInTyped(['一三二六丁·在途'], {initiative:true}, 3000); return 1; })()`);
  await sleep(1500);
  const nAtC0 = (await C.snap('')).n;
  const c0 = await C.snap('');
  A_('C0 前提：真实回复链确实点亮了「对方正在输入」行', c0.rowHidden === false, c0);
  A_('C1 承诺窗口内不得提前收（1.5s < 8s＝诚实的等待不许被砍）', c0.rowHidden === false, c0);
  // 窗口内退出重进：不得误收（两侧都该绿＝修过头的对照组）
  await C.evalJs(`(function(){var b=document.getElementById('chat-back');if(b)b.click();return 1;})()`);
  await sleep(700);
  await C.evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return 1;})()`);
  await sleep(1200);
  const c2 = await C.snap('');
  A_('C2 窗口内退出重进：行照旧在（复核不得把没到期的承诺提前收掉）', c2.rowHidden === false && (c2.expN || 0) === 0, c2);
  // 过期后再进聊天页＝用户口径的「退出以后再进去」
  await sleep(7000);
  await C.evalJs(`(function(){var b=document.getElementById('chat-back');if(b)b.click();return 1;})()`);
  await sleep(700);
  await C.evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return 1;})()`);
  await sleep(1500);
  const c3 = await C.snap('');
  A_('C3 【核心】那一发被冻住且已过期 → 重进聊天页把行收掉（旧写法一直挂着）', c3.rowHidden === true, c3);
  A_('C4 收行不吃消息：过期收表之后 msgs 只增不减、屏上一格不少（迟到不是丢失，收表也不许顺手删）', c3.n >= nAtC0 && c3.count >= 200 && c3.dupIdx === 0, { n: c3.n, at: nAtC0, count: c3.count, dupIdx: c3.dupIdx });
  A_('C5 现场留证：__chatTypingExpired 记到「从哪条路复核、迟到了多久」', (c3.expN || 0) >= 1 && !!c3.exp && String(c3.exp.why || '').length > 0 && Number(c3.exp.overMs) > 0, c3.exp);
  // 看门狗自己就能收：只冻投递那一发（2000~4000ms），放过 8000ms 的看门狗
  await C.evalJs(unpark);
  await C.evalJs(park({ min: 2000, max: 4000 }));
  await C.evalJs(`(function(){ window.chatAddInTyped(['一三二六戊·只冻投递'], {initiative:true}, 3000); return 1; })()`);
  await sleep(1500);
  const c6a = await C.snap('');
  await sleep(8000);
  const c6b = await C.snap('');
  A_('C6 看门狗自己就能收表（不依赖任何进出页事件；期间没有任何复核被调用）', c6a.rowHidden === false && c6b.rowHidden === true, { before: c6a.rowHidden, after: c6b.rowHidden });
  await C.evalJs(unpark);
  await C.evalJs(thaw);
  await sleep(2000);
  const c7 = await C.snap('一三二六丁');
  A_('C7 对照：解冻后消息照常落地、行收起（修复没把消息一起摁掉）', c7.n > c3.n && c7.rowHidden === true, { n: c7.n, was: c3.n, rowHidden: c7.rowHidden });
  A_('Z1 全程零未捕获 JS 异常', C.errors.length === 0, C.errors.slice(0, 3));
} catch (e) {
  console.error('脚本自身异常（无读数＝不可当回归结论）:', e && e.message || e);
  process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}
console.log('\n合计: ' + pass + ' 绿 / ' + fail + ' 红');
if (fail) process.exitCode = 1;

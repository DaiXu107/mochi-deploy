// ===== 常驻回归脚本 #1476：回场贴底枪三处丢失口（#978 同族第五次复报的「枪没了没人补」面）=====
// 用法：node tools/verify-1476-resume-realign-gun.mjs [被测根目录]
// 症状（用户实报 2026-09-30，与 #1313 的第四次复报逐字同族）：「把浏览器挂着后台一段时间，然后回来，
//   聊天里依旧不显示现在回来后新发的聊天消息一片空白并且旧消息位置跑到了屏幕上半屏，没有紧贴底部输入栏，
//   要重新刷新网页才恢复正常」＝#978 撕裂态（视觉滚动树停旧偏移、scrollTop 读数假绿、#706 看门狗失明）
//   停留到刷新。
// 根因（零机型分支）：回场贴底复核枪 chatResumeRealign 有三处丢失口——
//   ① #1202 只把「重读子弹」搬进了复核状态机，350ms 回调里的贴底枪仍被 batchRendering 早退吞掉
//     （真机回场最常撞的就是构建在飞，#1202 注释原话「重读＋贴底一起作废」只修了一半）；
//   ② 枪挂上后 3s 死线——回场几何风暴＋大历史媒体解码可拖过 3s（#841h 实证解码 2s+）＝放弃；
//   ③ 复核④ chatResumeReconcileHeal 的「屏上已追平」分支直接 return＝最需要贴底枪的时刻反而不补枪。
//   三处叠加＝撕裂态无任何救兵，唯一出口是刷新。修法＝batchRendering 不再吞枪（realign 自带静默轮询，
//   清了就写）、heal 两个早退分支补枪、死线 3s→8s（写只发生在静默后，宽死线只有成本没有撕裂风险）、
//   取证环留痕（realign/realign-miss/realign-drop 三去向进 __chatWinRing，下份诊断单直接可见）。
// 夹具纪律（同 verify-1202）：PARK 停存 setTimeout(fn,0)＝真机冻结/深度节流的等价形态；影子
//   visibilityState＋__chatHiddenAgeMs 注入离场时长；后台期静音 A 的收消息/写库入口防写侧竞态。
// 用例：
//   S1~S6 静态锚（源/产物：why 参数、heal 补枪、8s 死线、取证留痕、350ms 回调新形态）
//   P0~P2 前提：320 条历史贴底渲染 ＋ 整窗构建停在飞
//   R1 【判别核心·洞①③】长离场回场时构建在飞：350ms 枪被吞后，泵清（1.5s）＋静默后贴底枪必须自己落写
//     （绿侧＝realign 落写；红侧＝350ms 吞＋heal 不补＝全程无 realign）
//   R2 【洞②】同形态但泵清拖到 4.5s（>旧 3s 死线）：8s 死线内仍须落写（红侧两头丢）
//   C1 回场后仍贴底（#930/#416 语义未被打回）
//   N1 【契约】解钉态回场绝不拽底（#162）
//   N2 【契约】短离场（2s）零重读（#1067 C1）
//   Z1 全程零 JS 异常
// RED 基线（纯 HEAD）：S1~S6 缺锚；R1/R2 红（无 realign 落写）；C1/N1/N2/Z1 两侧同绿。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, budgetMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 >= budgetMs) return { ok: false, ms: Date.now() - t0 };
    await sleep(stepMs || 250);
  }
}
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 300) : '')); } };

console.log('静态断言:');
let src = '', prod = '';
try { src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { prod = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
A_('S1 源：贴底枪带挂枪来源（chatResumeRealign(why)）', /function chatResumeRealign\(why\)/.test(src));
A_('S2 源：heal「已追平」分支补枪（#1476 洞③）', /lastIdx >= len - 1 && !windowStale\) \{ chatResumeRealign\('heal-even'\); return; \}/.test(src));
A_('S3 源：回场贴底枪死线 8s（#1476 洞②）', /_rsResumeDeadline = Date\.now\(\) \+ 8000/.test(src));
A_('S4 源：取证环留痕（realign 落写／死线放弃／丢弃三去向）', /_rk\('realign'\)/.test(src) && /_rk\('realign-miss'\)/.test(src) && /_rk\('realign-drop'\)/.test(src));
A_('S5 源：350ms 回调不再拿 batchRendering 吞枪（#1476 洞①）', /if \(!chatVisible\(\) \|\| !chatPinnedBottom\) return; \/\/ 回场期用户已翻页/.test(src) && !/!chatPinnedBottom \|\| batchRendering\) return; \/\/ 回场期用户已翻页/.test(src));
A_('S6 产物：heal 补枪与取证在位（外置 js 产物同步）', /'heal-even'/.test(prod) && /_rk\('realign'\)/.test(prod));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9911 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1476-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

function mkClient(wsUrl, tag) {
  const c = { tag, pend: new Map(), id: 0, errors: [], ws: null };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl);
    c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String(m.params.exceptionDetails.text || '').slice(0, 120)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  c.evalJs = async (expr) => {
    try {
      const r = await c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) { console.error('  [' + tag + ' eval err]', String((r.exceptionDetails.exception || {}).description || '').slice(0, 200)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  return c;
}
async function listTargets() { return (await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json()); }
async function waitCdp() {
  for (let i = 0; i < 80; i++) { try { await listTargets(); return; } catch (e) { await sleep(200); } }
  throw new Error('CDP 端口未就绪: ' + cdpPort);
}

const GO = (state) => `(function(){
  try {
    if (${JSON.stringify(state)} === 'hidden') { window.__origVS = Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') || Object.getOwnPropertyDescriptor(document,'visibilityState'); }
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return ${JSON.stringify(state)};}});
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const RESUME = (ageMs) => `(function(){
  try {
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'visible';}});
    window.__chatHiddenAgeMs = ${ageMs};
    document.dispatchEvent(new Event('visibilitychange'));
    window.__chatHiddenAgeMs = null;
    if (window.__origVS) { Object.defineProperty(document,'visibilityState',window.__origVS); window.__origVS = null; }
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;

// 停存链式让帧定时器（真机冻结/深度节流的等价形态）＋ 后台期静音写入口
const PARK = `(function(){
  if (window.__parkRaw) return 'already';
  window.__parkRaw = window.setTimeout;
  window.__parked = [];
  window.__parkOn = false;
  window.setTimeout = function (fn, ms) {
    if (window.__parkOn && (ms === undefined || ms === 0) && typeof fn === 'function') { window.__parked.push(fn); return 1; }
    return window.__parkRaw.apply(window, arguments);
  };
  return 'ok';
})()`;
const PARK_SET = (on) => `(function(){
  window.__parkOn = ${on ? 'true' : 'false'};
  if (!${on ? 'true' : 'false'} && window.__parked && window.__parked.length) {
    var q = window.__parked.slice(); window.__parked.length = 0;
    q.forEach(function (f) { try { f(); } catch (e) { window.__parkErr = String(e && e.message || e); } });
  }
  return (window.__parked || []).length;
})()`;
const MUTE = `(function(){
  try {
    window.__fixt = { inW: window.chatAddIn, sysW: window.chatAddSystem, typedW: window.chatAddInTyped, setW: window.idbSet, setAllW: window.idbSetAll };
    window.chatAddIn = function(){ return null; };
    window.chatAddSystem = function(){ return null; };
    if (window.chatAddInTyped) window.chatAddInTyped = function(){};
    window.idbSet = function(){ return Promise.resolve(); };
    if (window.idbSetAll) window.idbSetAll = function(){ return Promise.resolve(); };
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const UNMUTE = `(function(){
  try { var f = window.__fixt || {}; if (f.inW) window.chatAddIn = f.inW; if (f.sysW) window.chatAddSystem = f.sysW;
    if (f.typedW) window.chatAddInTyped = window.chatAddInTyped; if (f.setW) window.idbSet = f.setW; if (f.setAllW) window.idbSetAll = f.setAllW;
    window.__fixt = null; } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const ARM_COUNT = `(function(){
  window.__histReads = [];
  if (!window.__idbGetRaw) { window.__idbGetRaw = window.idbGet; }
  var raw = window.__idbGetRaw;
  window.idbGet = function(k, o) { try { if (/chat-(msgs|blk-idx|arch|blk-)/.test(String(k))) window.__histReads.push(String(k)); } catch (e) {} return raw.apply(this, arguments); };
  return true;
})()`;
const RING = `(function(){
  try { var r = window.__chatWinRing ? window.__chatWinRing() : null; return JSON.stringify(r ? { backs:r.backs, ring:r.ring, cur:r.cur } : null); } catch (e) { return 'ERR:' + e.message; }
})()`;
const GAP = `(function(){
  var b=document.getElementById('chat-body'); if(!b) return 99999;
  return Math.round(b.scrollHeight-b.scrollTop-b.clientHeight);
})()`;

// 造「整窗构建停在飞」：PARK 停存后自导入一次（renderWindow 分帧链全被停存＝batchRendering 挂在飞）
const INFLY = `(function(){
  try { window.__parkOn = false; var r = window.chatImportMsgs(window.chatExportMsgs()); window.__parkOn = true;
    var b = document.getElementById('chat-body');
    return JSON.stringify({ ok: !!r, kids: b ? b.children.length : -1 }); } catch (e) { return 'ERR:' + e.message; }
})()`;

let A = null;
try {
  await waitCdp();
  let page = (await listTargets()).find((t) => t.type === 'page');
  A = mkClient(page.webSocketDebuggerUrl, 'A'); await A.connect();
  await A.cdp('Page.enable'); await A.cdp('Runtime.enable');
  await A.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 772, deviceScaleFactor: 2, mobile: true });
  await A.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await A.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await A.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(500);
  await A.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}return true;})()") ;
  await A.evalJs(`(function(){
    try { var st = window.activeStore(); st.set('cs-rp-auto-prob', '0'); } catch (e) {}
    ['ta-ask','ta-choose','ta-curious','ta-roast','ta-tacc'].forEach(function(k){
      try { var st = window.activeStore(); var d = null; try { d = JSON.parse(st.get(k) || 'null'); } catch (e) { d = null; }
        if (!d || typeof d !== 'object') d = {}; if (!d.settings || typeof d.settings !== 'object') d.settings = {};
        d.settings.enabled = false; st.set(k, JSON.stringify(d)); } catch (e) {}
    });
    return true;
  })()`);
  await A.evalJs(PARK);

  const seeded = await A.evalJs(`(function(){
    try {
      var now = Date.now(), arr = [];
      for (var i = 0; i < 320; i++) arr.push({ side: i % 2 ? 'in' : 'out', text: '记录' + String(i).padStart(3, '0'), ts: now - (320 - i) * 60000 });
      return window.chatImportMsgs(arr) ? 'true' : 'false';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  A_('P0 前提：320 条历史导入成功', seeded === 'true', seeded);
  await sleep(2500);
  await A.evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(3500);
  const gap0 = await A.evalJs(GAP);
  A_('P1 前提：聊天页已渲染且贴底', Math.abs(Number(gap0)) <= 8, { gap0 });
  await sleep(2500);

  // ---------- R1：长离场回场时构建在飞，泵 1.5s 后清 → 贴底枪必须自己落写 ----------
  await A.evalJs(MUTE);
  await A.evalJs(ARM_COUNT);
  const inflight = JSON.parse((await A.evalJs(INFLY)) || '{}');
  A_('P2 前提：整窗构建停在飞（屏上已清空）', inflight.ok === true && inflight.kids === 0, inflight);
  await A.evalJs(GO('hidden'));
  const resume1At = Date.now();
  await A.evalJs(RESUME(65000)); // 长离场：回场即挂复核闸＋350ms 贴底复核（此刻构建仍在飞＝红侧把枪吞掉）
  await sleep(1500);
  await A.evalJs(PARK_SET(false)); // 泵清（红侧 350ms 已被吞、heal 不补＝无救兵；绿侧 repin350 枪在膛等静默／heal-even 兜）
  const gun1 = await waitFor(async () => {
    const r = JSON.parse((await A.evalJs(RING)) || 'null');
    return !!r && (r.ring || []).some((e) => e && e.k === 'realign' && e.t > resume1At);
  }, 12000, 300);
  const ring1 = JSON.parse((await A.evalJs(RING)) || 'null');
  const kinds1 = ring1 ? (ring1.ring || []).map((e) => e.k + (e.w ? ':' + e.w : '')).join(',') : '';
  A_('R1 长离场回场（构建在飞→1.5s 泵清）：贴底枪自己落写（#1476 洞①③判别核心）', gun1.ok, { waitedMs: gun1.ms, kinds1 });
  const gap1 = Number(await A.evalJs(GAP));
  A_('C1 泵清＋贴底枪落写后回场仍贴底（#930/#416 语义未被打回）', Math.abs(gap1) <= 8, { gap1 });
  await sleep(4500); // 拉开与 R2 的 _rcArmAt 5s 去重窗

  // ---------- R2：同形态但泵清拖到 4.5s（>旧 3s 死线）→ 8s 死线内仍须落写 ----------
  await A.evalJs('window.__histReads.length = 0');
  await A.evalJs(GO('hidden'));
  const inflight2 = JSON.parse((await A.evalJs(INFLY)) || '{}');
  A_('P2b 前提：第二轮构建停在飞', inflight2.ok === true && inflight2.kids === 0, inflight2);
  const resume2At = Date.now();
  await A.evalJs(RESUME(65000));
  await sleep(4500); // 拖过旧 3s 死线再泵清（红侧：枪要么被吞、要么 3s 放弃＝两头丢）
  await A.evalJs(PARK_SET(false));
  const gun2 = await waitFor(async () => {
    const r = JSON.parse((await A.evalJs(RING)) || 'null');
    return !!r && (r.ring || []).some((e) => e && e.k === 'realign' && e.t > resume2At);
  }, 12000, 300);
  const ring2 = JSON.parse((await A.evalJs(RING)) || 'null');
  const kinds2 = ring2 ? (ring2.ring || []).map((e) => e.k + (e.w ? ':' + e.w : '')).join(',') : '';
  A_('R2 泵清拖过旧 3s 死线（4.5s）：8s 死线内贴底枪仍落写（#1476 洞②）', gun2.ok, { waitedMs: gun2.ms, kinds2 });
  await A.evalJs(UNMUTE);
  await sleep(1500);

  // ---------- N1 契约：解钉态回场绝不拽底（#162） ----------
  // 造真解钉：派发 wheel（body 的解钉监听 #874e＝真实入口之一，程序化 scrollTop 不算滚动意图会被 #706 拽回）
  // ＋滚动到离底 600px；N1 用**短离场**——长离场语义本就是「视同重新进聊天＝合法回底」（#930），测不出 #162。
  await A.evalJs("(function(){var b=document.getElementById('chat-body');b.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));b.scrollTop=Math.max(0,b.scrollHeight-b.clientHeight-600);return true;})()");
  await sleep(700); // scroll 防抖＋看门狗一拍：确认真的停在离底 600（若被回钉本条前提立刻暴露）
  const unpinnedGap = Number(await A.evalJs(GAP));
  A_('P3 前提：已造解钉态（离底 600px）', unpinnedGap > 300, { unpinnedGap });
  await A.evalJs(GO('hidden'));
  await A.evalJs(RESUME(2000)); // 短离场：解钉态回场短离场路只判 #162＝零动作
  await sleep(3000);
  const gapN1 = Number(await A.evalJs(GAP));
  A_('N1 解钉态回场不被拽底（#162 契约一字不动）', gapN1 > 300, { gapN1 });
  await A.evalJs("(function(){var b=document.getElementById('chat-body');b.scrollTop=b.scrollHeight;return true;})()"); // 滚回底部（scroll 回钉判据自己接管）恢复贴底
  await sleep(1200);

  // ---------- N2 契约：短离场零重读（#1067 C1） ----------
  await A.evalJs('window.__histReads.length = 0');
  await A.evalJs(GO('hidden'));
  await sleep(400);
  await A.evalJs(RESUME(2000));
  await sleep(2500);
  const shortReads = await A.evalJs('JSON.stringify(window.__histReads)');
  A_('N2 短离场（2s）回场不强制重读权威（≤60s 行为零变化）', shortReads === '[]', shortReads);

  A_('Z1 主标签页零 JS 异常', A.errors.length === 0, A.errors.slice(0, 3));
  console.log('\n结果：绿 ' + pass + ' / 红 ' + fail);
} catch (e) {
  console.error('脚本异常：', e && e.message || e);
  fail++;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
process.exit(fail ? 1 : 0);

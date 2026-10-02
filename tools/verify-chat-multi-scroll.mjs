// ===== 回归脚本 #514：联系人连发多条消息时聊天记录「一直闪、一直回弹」 =====
// 用法：node build.mjs && node tools/verify-chat-multi-scroll.mjs
// 报障（红米 K80 Chrome 等多机型，用户明说其他机型也有）：TA 发消息时视图滑到最新位置，
//   当 TA 连发多条，滑动会一直闪 + 一直回弹。
// 根因（几何，零机型/内核分支）：#chat-typing 是 #chat-body 的**兄弟**节点（#page-chat 的 flex 行）——
//   显示它只吃 chat-body 的 clientHeight，「可滚最大 = scrollHeight − clientHeight」反而被抬高 T≈22px，
//   scrollHeight 一点没动。旧 showTyping 在钉住态写 scrollTop = scrollHeight（钳位目标＝行显示态最大值）；
//   紧随其后的 hideTyping 把行隐藏，最大值当场回落 T px → 内核把 scrollTop 钳掉 T px ＝ 内容凭空
//   下弹 T px，紧接着新消息又被平滑滚回底部 → 每来一条「上跳 22px + 下弹 22px」，连发＝一直闪+一直回弹。
// 断言组：
//   S 结构前提（行仍是 chat-body 兄弟、行高 ≤ chat-body 下留白、产品暴露连发真链路钩子）
//   R 根因复现（RED 基线：手工复刻旧写法 → 必然出现「抬 T px 再被钳回 T px」的位移）
//   G 连发行为（真身链路 chatAddInTyped：**落地瞬间即已贴底**、无多帧滑动、逐帧零回退、占位不遮最后一条）
//     G6/G7 是 #516 的判据（用户 2026-09-15 追加报障「除了第一条有优化，其他消息还是飞出来的」）：
//     旧 in 侧跟底走 scrollChatBottomSmooth，气泡插入时底边落在消息区视口下方 +38.7px，再用 ~200ms
//     滑上来＝肉眼一条条「飞出来」；改为插入帧内同步贴底后，落地那一刻 over ≤ 0 且 top≈max，
//     全程不存在连续两帧以上的位移（不是滑动过程）。旧实现跑 G6 会得到 over=+38.7、G7 得到 ~12 帧段。
//   P 相邻契约不回归（TA 单条仍跟底 / 解钉态不抢滚动权 #334·#378·#416 / 零异常）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-multiscroll-' + Date.now()),
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
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 关自动回复，避免 scheduleReply 的随机打字行与本脚本自驱的连发互相干扰
await ev("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
const settle = async () => { await sleep(150); await ev('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});'); await sleep(400); };
const snap = () => ev(`(function(){
  var b=document.getElementById('chat-body'), t=document.getElementById('chat-typing');
  return JSON.stringify({ top:Math.round(b.scrollTop*100)/100, sh:b.scrollHeight, ch:b.clientHeight,
    max:Math.round((b.scrollHeight-b.clientHeight)*100)/100, typing:t?!t.hidden:null });
})()`);
const stateOf = async () => JSON.parse(await snap() || '{}');

// 撑高聊天区
for (let i = 1; i <= 40; i++) {
  await ev(`window.chatSendMsg('消息第${i}条，这是一条用来撑高聊天区域滚动内容的测试消息，内容稍微长一点。');`);
}
await settle();

// ---------- S 组：结构前提（本修复的几何基础，动了就要重审 #514 注释） ----------
const struct = JSON.parse(await ev(`(function(){
  var b=document.getElementById('chat-body'), t=document.getElementById('chat-typing');
  var pad = parseFloat(getComputedStyle(b).paddingBottom) || 0;
  return JSON.stringify({
    sameParent: !!(b && t && b.parentElement === t.parentElement),
    parentId: t && t.parentElement ? (t.parentElement.id || t.parentElement.className) : null,
    rowH: t ? t.offsetHeight : -1,
    padBottom: pad,
    hook: typeof window.chatAddInTyped === 'function'
  });
})()`));
check('S1 #chat-typing 仍是 #chat-body 的兄弟节点（行只吃 clientHeight 的前提）', struct.sameParent, 'parent=' + struct.parentId);
check('S2 打字行高 ≤ chat-body 下留白（占位期间不遮最后一条消息）', struct.rowH > 0 && struct.rowH <= struct.padBottom, '行高=' + struct.rowH + 'px ≤ padding-bottom=' + struct.padBottom + 'px');
check('S3 产品暴露「连发多条」真链路钩子（脚本驱动产品函数而非复刻实现）', struct.hook === true);
if (!struct.hook) {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  console.log('\n产物未含 #514 钩子——请先 node build.mjs');
  process.exit(1);
}

// ---------- R 组：根因复现（RED 基线：手工复刻旧 showTyping/hideTyping 写法） ----------
// 旧写法：显示行后写 scrollTop = scrollHeight（钳到「行显示态」最大值）；隐藏行 → 最大值回落 → 被钳回。
await ev('(function(){var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
await settle();
const rBase0 = await ev('(function(){var t=document.getElementById("chat-typing");if(t)t.hidden=true;var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
await settle();
const rBase = await stateOf();
check('R0 归零态：打字行已隐藏且视图贴底（R1 的起点必须成立）',
  rBase.typing === false && Math.abs(rBase.top - rBase.max) <= 2, 'typing=' + rBase.typing + ' top=' + rBase.top + ' max=' + rBase.max + (rBase0 ? '' : ' [eval 失败]'));
const rShown = JSON.parse(await ev(`(function(){
  var b=document.getElementById('chat-body'), t=document.getElementById('chat-typing');
  t.hidden=false;
  var maxShown = b.scrollHeight - b.clientHeight;   // 行显示态最大值（= 旧写法的钳位目标）
  b.scrollTop = b.scrollHeight;                     // 旧 showTyping：钉住态写到底
  return JSON.stringify({ top:Math.round(b.scrollTop*100)/100, maxShown:Math.round(maxShown*100)/100 });
})()`) || '{}');
check('R1 打字行显示会把「可滚最大」抬高一行高（＝旧写法的钳位目标被抬高）',
  rShown.maxShown - rBase.max >= 10, '行显示态 max=' + rShown.maxShown + ' vs 行隐藏态 max=' + rBase.max);
check('R2 旧写法确实把 scrollTop 顶到了被抬高的那份最大值（本次报障的触发条件）',
  Math.abs(rShown.top - rShown.maxShown) <= 1.5, 'top=' + rShown.top + ' maxShown=' + rShown.maxShown);
const rHidden = JSON.parse(await ev(`(function(){
  var b=document.getElementById('chat-body'), t=document.getElementById('chat-typing');
  t.hidden=true;
  return JSON.stringify({ top:Math.round(b.scrollTop*100)/100, sh:b.scrollHeight, ch:b.clientHeight });
})()`) || '{}');
check('R3 行一隐藏 scrollTop 就被内核钳掉一行高＝内容当场下弹（旧写法的「回弹」实锤）',
  rShown.top - rHidden.top >= 10, '钳掉 ' + Math.round((rShown.top - rHidden.top) * 100) / 100 + 'px');
await ev('(function(){var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
await settle();

// ---------- G 组：连发行为（走产品真链路 addInTyped） ----------
await ev(`(function(){
  var b = document.getElementById('chat-body');
  window.__msTrace = []; window.__msIns = []; window.__msOn = true;
  var t0 = performance.now(), lastN = b.children.length;
  // #516：记录每条气泡**插入那一瞬间**的几何——over>0 表示气泡底边落在消息区视口下方
  // （必须先滚上来才看得见＝用户报的「消息飞出来」）。insert 时刻打字行刚被 hideTyping 收掉，
  // 故这里的 max 就是「行隐藏态最大值」，top≈max 即「落地即贴底」。
  new MutationObserver(function(muts){
    muts.forEach(function(mu){
      Array.prototype.forEach.call(mu.addedNodes, function(n){
        if (n.nodeType !== 1 || !n.classList || !n.classList.contains('msg')) return;
        var br = b.getBoundingClientRect(), r = n.getBoundingClientRect();
        window.__msIns.push({ over: Math.round((r.bottom - br.bottom)*10)/10,
          top: Math.round(b.scrollTop*100)/100,
          max: Math.round((b.scrollHeight - b.clientHeight)*100)/100 });
      });
    });
  }).observe(b, { childList: true });
  (function loop(){
    if (!window.__msOn) return;
    window.__msTrace.push([Math.round(performance.now()-t0), Math.round(b.scrollTop*100)/100]);
    requestAnimationFrame(loop);
  })();
  return true;
})()`);
const before = await ev("document.querySelectorAll('#chat-body .msg').length");

// 连发第 1 条：先只起链路，等打字行显示 → 做「占位不遮最后一条消息 / 不越过行隐藏态最大值」的点检查
await ev("window.chatAddInTyped(['TA 连发第一条：测试消息内容。','TA 连发第二条：又发了一条。','TA 连发第三条：连发第三条。'], {}, 500);");
await sleep(220);
const during = JSON.parse(await ev(`(function(){
  var b=document.getElementById('chat-body'), t=document.getElementById('chat-typing');
  var rowH = t ? t.offsetHeight : 0;
  var maxHidden = b.scrollHeight - (b.clientHeight + (t && !t.hidden ? rowH : 0)); // 行隐藏态最大值
  var lm = null;
  for (var i=b.children.length-1;i>=0;i--) { if (b.children[i].classList && b.children[i].classList.contains('msg')) { lm=b.children[i]; break; } }
  var over = lm ? Math.round((lm.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom)*10)/10 : null;
  return JSON.stringify({ typing: t ? !t.hidden : null, top:Math.round(b.scrollTop*100)/100,
    maxHidden:Math.round(maxHidden*100)/100, over: over, rowH: rowH });
})()`) || '{}');
check('G1 连发链路里「对方正在输入」行确实显示过（用例有效性）', during.typing === true, 'typing=' + during.typing);
check('G2 占位期间 scrollTop 不越过「行隐藏态最大值」（不写过界＝不会有后续钳位）',
  during.top <= during.maxHidden + 1.5, 'top=' + during.top + ' ≤ maxHidden=' + during.maxHidden);
check('G3 占位期间最后一条消息仍完整可见（行只吃底部留白，不遮消息）',
  during.over !== null && during.over <= 1, '超出消息区底边 ' + during.over + 'px');

// 等三条全部落地
let msgCount = before;
for (let i = 0; i < 40; i++) {
  const n = await ev("document.querySelectorAll('#chat-body .msg').length");
  if (typeof n === 'number') { msgCount = n; if (n >= before + 3) break; }
  await sleep(300);
}
await sleep(1200);
await ev('window.__msOn=false;');
const trace = JSON.parse(await ev('JSON.stringify(window.__msTrace)') || '[]');
check('G4 三条连发全部落地', msgCount >= before + 3, '新增 ' + (msgCount - before) + ' 条');

// 逐帧位移统计：回退阈值取 4px——旧写法的回弹是每轮「整整一行高 ≈22px」，量级差一个数量级，
// 既不会把亚像素/1~2px 的取值噪声误判成回归，也能把报障现象（22px 下弹）稳稳拦下
let back = 0, maxBack = 0, maxBackAt = '', fwdMax = 0, prev = null, prevT = 0;
for (const row of trace) {
  const top = row[1];
  if (prev !== null) {
    const d = top - prev;
    if (d < maxBack) { maxBack = d; maxBackAt = 't=' + row[0] + 'ms ' + prev + '→' + top; }
    if (d < -4) back++;
    if (d > fwdMax) fwdMax = d;
  }
  prev = top; prevT = row[0];
}
check('G5 连发全程无逐帧回退（旧写法此处每轮下弹整整一行高 ~22px）', back === 0,
  '采样 ' + trace.length + ' 帧；最大回退 ' + Math.round(-maxBack * 10) / 10 + 'px' + (maxBack < -0.05 ? ' @' + maxBackAt : '') );
// FIX 2026-09-15 #516：契约变更——旧断言是「跟底必须走平滑、不允许一次性大跳」（为治
// 「瞬时 scrollTop=scrollHeight 咻地一跳」而立的）。用户随后报「消息还是飞出来」（新气泡先在
// 视口下方 ~39px 渲染、再用 ~200ms 滑上来），in 侧跟底已改为「插入帧内同步贴底」，
// 判据随之换成下面两条（互补：一个守「落地即到位」，一个守「不是滑动过程」）。
const ins = JSON.parse(await ev('JSON.stringify(window.__msIns)') || '[]');
const landed = ins.filter((r) => r.over <= 1 && Math.abs(r.top - r.max) <= 2);
check('G6 连发每条气泡**落地瞬间即已贴底**（#516 核心：不再先在视口下方渲染再滑上来＝「消息飞出来」；旧平滑实现此处 over=+38.7px）',
  ins.length >= 3 && landed.length === ins.length,
  (ins.map((r) => 'over=' + r.over).join(' / ') || '无插入记录') + ' → ' + landed.length + '/' + ins.length + ' 条落地即贴底');

let run = 0, maxRun = 0;
for (let i = 1; i < trace.length; i++) {
  if (Math.abs(trace[i][1] - trace[i - 1][1]) >= 2) { run++; if (run > maxRun) maxRun = run; } else run = 0;
}
check('G7 连发全程不存在「多帧滑动过程」（连续位移帧段长 ≤1；旧平滑实现为 ~12 帧连续小位移＝肉眼看到的飞入）',
  maxRun <= 1, '最长连续位移帧段 ' + maxRun + ' 帧；单帧最大前移 ' + Math.round(fwdMax * 10) / 10 + 'px');

const gEnd = await stateOf();
check('G8 连发结束后仍贴底（最新一条在视口内）',
  Math.abs(gEnd.top - gEnd.max) <= 2 || Math.abs(gEnd.top - gEnd.max) <= (struct.rowH + 2),
  'top=' + gEnd.top + ' max=' + gEnd.max + ' 打字行=' + (gEnd.typing ? '显示' : '隐藏'));

// ---------- P 组：相邻契约不回归 ----------
// P1：TA 单条（非连发）仍自动跟底（去掉 typing 的滚动后跟底职责全在 maybeScrollChatBottom）
await ev("window.chatAddIn('TA 单条消息：应当自动滚到最新。');");
await settle();
const p1 = await stateOf();
check('P1 TA 单条消息仍自动跟底（#162/#378 契约）', Math.abs(p1.top - p1.max) <= 2, 'top=' + p1.top + ' max=' + p1.max);

// P2：解钉（触摸上翻）后 TA 文本消息不抢滚动权（#416/#378）
await ev(`(function(){
  var b = document.getElementById('chat-body');
  try {
    var t = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 700 });
    b.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  } catch (e) { b.dispatchEvent(new Event('touchstart', { bubbles: true })); }
  b.scrollTop = 0;
  return b.scrollTop;
})()`);
await sleep(80);
const p2Top = (await stateOf()).top;
await ev("window.chatAddIn('TA 消息（你在读历史，不应被打断）');");
await sleep(700);
const p2 = await stateOf();
check('P2 解钉态 TA 消息不打断阅读位置（#416/#378 契约）', Math.abs(p2.top - p2Top) <= 4, 'top ' + p2Top + '→' + p2.top);

// P3：#334 加强——解钉态下打字行显示/隐藏全程零位移（旧形态的「复写守钉」升级为「一个 scrollTop 都不写」）
const p3a = (await stateOf()).top;
await ev("window.chatAddInTyped(['TA 连发（此刻你在读历史）第一条：不应被拽到底。','TA 连发（此刻你在读历史）第二条：仍不应被拽到底。'], {}, 400);");
await sleep(3800);
const p3b = (await stateOf()).top;
check('P3 解钉态连发全程不被打字行/新消息拽回底部（#334 守钉加强版）', Math.abs(p3b - p3a) <= 4, 'top ' + p3a + '→' + p3b);

const errs = await ev('JSON.stringify(window.__jsErrors || [])');
check('P4 无 JS 异常', !errs || errs === '[]', String(errs).slice(0, 120));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

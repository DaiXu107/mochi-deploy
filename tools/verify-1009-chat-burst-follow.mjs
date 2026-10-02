// ===== 常驻回归脚本 #1009：聊天里联系人「同时发来多条消息」时视图闪跳／不跟底 =====
// 用法：node build.mjs && node tools/verify-1009-chat-burst-follow.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-1009-chat-burst-follow.mjs   （红绿对照）
//
// 报障（红米 K80 Chrome，用户原话「聊天里联系人同时发送多条聊天消息的时候会闪屏」，并点名
//   其他设备型号也有、要求「不要覆盖修改导致不同型号设备浏览器的bug反复出现」）。
//
// 事故记录（本脚本存在的原因）：#998 批（3716269）为这一型缺陷补的三处逻辑——
//   ①贴底判据与写方同尺（chatAtBottom ⇒ chatScrollMax，扣掉「对方正在输入」行高）
//   ②来消息跟底闸补「视口此刻就在真底部」几何事实（钉住标记可过期）
//   ③看门狗 250ms 解钉态周期复核（用户自己滚回真底部即恢复自动跟底）
//   被 #1002 批（cc8f2a6）在改同文件时**整块回退**（该提交只讲上传图片 input 层，三处逻辑
//   连同注释一起消失），线上 23:25 部署产物经 curl 实证三处锚点全缺。用户看到的正是：
//   打字行（每条来消息落地前显示 0.4~1.4s）显示期做一次同样的轻点，裸口径把「真贴底」读成
//   「离底一行高 ≈22px > 8」＝假解钉态 ⇒ 轻点回钉与滚动落定回钉两条恢复路一起失效，
//   钉住态永久丢失；此后**每条**来消息都不跟底：无头实测 gap 0 → 134 → 268px 单调累积、
//   气泡底边落在消息区下方 +48 → +115 → +249px（整条在视口外），直到某次时机凑巧恢复时
//   视图一次跳回最底——连发多条时就是用户报的「闪」。
//
// 断言组：
//   S 产物锚（三处修复逻辑在位 ＋ 旧裸口径不得回流）
//   R 根因判据自检（打字行显示期真贴底：新旧两把尺子必须给出相反结论；改口径时重审本组）
//   P 对照对（本脚本相对 #998 脚本新增的核心判据）：**同一记轻点**在
//     P1「打字行隐藏期」与 P2「打字行显示期」必须得到同一结果——两次都要继续跟底；
//     P3 P2 之后再连发两条仍跟底（旧版此处 gap 累积 100px+ ＝「不跟到底」）
//   B 连发形态（新增）：B1 同一 tick 连发 3 条、B2 逐条连发 3 条（真链路 chatAddInTyped）
//     —— 全部落地即贴底、末态 gap ≤8、无累积漂移
//   Z 全程零 JS 异常
//
// 零机型/内核分支：判据只有几何与标记，与设备型号、浏览器内核无关。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(resolve(process.env.MOCHI_ROOT)) : (process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- S 组：产物锚（#860 后 chat.js 外置，index.html + js/chat.js 两处都读） ----------
let prod = '';
try { prod = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
try { prod += readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
check('S1 贴底判定与写方同尺（chatAtBottom ＝ chatScrollMax() − scrollTop ≤8；#998①）',
  prod.includes('return chatScrollMax() - cb.scrollTop <= 8;'));
check('S2 来消息跟底闸含几何事实（钉住标记 OR 视口此刻就在真底部；#998②）',
  prod.includes('!chatPinnedBottom && !chatAtBottom()) return;'));
check('S3 看门狗解钉态周期复核在位（用户滚回真底部即恢复自动跟底；#998③）',
  prod.includes("chatPinnedBottom = true; cb706.classList.remove('scroll-anchor-auto'); chatScrollRealignQuiet();"));
check('S4 旧裸口径不得回流（裸 scrollHeight−clientHeight 当尺子＝打字行期假解钉态复发）',
  !prod.includes('return cb.scrollHeight - cb.scrollTop - cb.clientHeight <= 8;'));
check('S5 旧跟底闸不得回流（只认钉住标记＝标记一失真就永久不跟底）',
  !prod.includes('if (!out && !userFollow && !chatPinnedBottom) return;'));

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9300 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1009-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') jsErrors.push(((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 873, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 关自动回复随机排程，避免与本脚本自驱的来消息互相干扰（产品真链路钩子照常可用）
await ev("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(600);
for (let i = 1; i <= 40; i++) {
  await ev(`window.chatSendMsg('撑高消息 ${i}，这是一条用来撑出滚动高度的测试消息内容，稍微长一点。');`);
}
await sleep(1400);

if ((await ev('typeof window.chatAddInTyped')) !== 'function') {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  console.log('\n产物未含 chatAddInTyped 真链路钩子——请先 node build.mjs');
  process.exit(1);
}

// 采样口径：gap ＝ chatScrollMax() − scrollTop（与产品写方同尺）；over ＝ 最新一条气泡底边 − 消息区底边
// （over > 1 ＝ 最新一条落在视口下方，用户必须自己滑到底 ＝ 报障直接形态）
const STATE = `(function(){
  var b=document.getElementById('chat-body'), t=document.getElementById('chat-typing');
  var rowH=(t&&!t.hidden)?t.offsetHeight:0;
  var max=b.scrollHeight-(b.clientHeight+rowH);
  var lm=null;
  for(var i=b.children.length-1;i>=0;i--){var c=b.children[i];if(c.classList&&c.classList.contains('msg')){lm=c;break;}}
  var br=b.getBoundingClientRect();
  return JSON.stringify({
    anchor:b.classList.contains('scroll-anchor-auto'),
    gap:Math.round((max-b.scrollTop)*10)/10,
    rawGap:Math.round((b.scrollHeight-b.scrollTop-b.clientHeight)*10)/10,
    typing:!!(t&&!t.hidden),
    over:lm?Math.round((lm.getBoundingClientRect().bottom-br.bottom)*10)/10:null,
    n:b.querySelectorAll('.msg').length
  });
})()`;
const state = async () => JSON.parse((await ev(STATE)) || '{}');
// 打字行显隐：与产品 showTyping/hideTyping 同形（写 textContent + 切 hidden；行高固定 22px）
const setTyping = (on) => ev(`(function(){var t=document.getElementById('chat-typing');if(!t)return false;
  if(${on}){ t.textContent='联系人 正在输入…'; t.hidden=false; } else { t.hidden=true; } return true;})()`);
const TOUCH = (phase, y) => `(function(){
  var b=document.getElementById('chat-body');
  var mk=function(t){return new Touch({identifier:1,target:b,clientX:200,clientY:t,pageX:200,pageY:t});};
  var e=new TouchEvent('${phase}',{touches:${phase === 'touchend' ? '[]' : '[mk(' + y + ')]'},targetTouches:${phase === 'touchend' ? '[]' : '[mk(' + y + ')]'},changedTouches:[mk(${y})],bubbles:true,cancelable:true});
  b.dispatchEvent(e); return true; })()`;
// 一记「轻点」：位移 0（真机最常见形态：点一下屏幕/点气泡）
const tap = async () => { await ev(TOUCH('touchstart', 400)); await sleep(60); await ev(TOUCH('touchend', 400)); };
async function reset() {
  await ev('(function(){window.enterChat&&window.enterChat();return true;})()'); // #742 进页复位钉住
  await sleep(700);
  await setTyping(false); // 归位前先收掉打字行（行显示期最大虚高一行高，#516）
  await ev('(function(){var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
  await sleep(500);
}
const burstSameTick = (tag, n) => ev(`(function(){var a=[];for(var i=1;i<=${n};i++)a.push('${tag} 第'+i+'条联系人消息。');
  for(var k=0;k<a.length;k++) window.chatAddIn(a[k]); return true;})()`);
const burstTyped = (tag, n, delay) => ev(`(function(){var a=[];for(var i=1;i<=${n};i++)a.push('${tag} 第'+i+'条联系人消息。');
  window.chatAddInTyped(a, {}, ${delay}); return true;})()`);
async function waitQuiet(ms) { await sleep(ms); }

// ---------- A0 前置 ----------
await reset();
const base = await state();
check('A0 前置：聊天区已撑出滚动高度且停在贴底钉住态',
  base.gap <= 2 && base.anchor === false && base.typing === false,
  'gap=' + base.gap + ' anchor=' + base.anchor + ' typing=' + base.typing);

// ---------- R 组：根因判据自检 ----------
await reset();
await ev("(function(){var b=document.getElementById('chat-body');b.scrollTop=b.scrollHeight-b.clientHeight;return true;})()");
await sleep(200);
await setTyping(true);
await sleep(150);
const rowState = await state();
check('R1 打字行显示期「真贴底」：新旧两把尺子必须给出相反结论（根因判据仍在，改口径时重审）',
  rowState.typing === true && Math.abs(rowState.gap) <= 2 && rowState.rawGap > 8,
  'gap=' + rowState.gap + '（真尺） rawGap=' + rowState.rawGap + '（旧裸尺）');
await setTyping(false);
await sleep(400);

// ---------- P 组：对照对（同一记轻点，两种时刻必须同一结果） ----------
// P1 打字行隐藏期轻点 → 连发两条全部落地即贴底
await reset();
await setTyping(false);
await sleep(80);
await tap();
await sleep(500);
const p1tap = await state();
await burstSameTick('P1', 2);
await waitQuiet(1600);
const p1 = await state();
check('P1 打字行隐藏期轻点后连发两条：全部落地即贴底（对照组，两种时刻都该如此）',
  p1.gap <= 8 && p1.over !== null && p1.over <= 1,
  'gap=' + p1.gap + ' over=' + p1.over + ' anchor=' + p1.anchor + '（轻点后 anchor=' + p1tap.anchor + '）');

// P2 打字行显示期同一记轻点 → 连发两条仍全部落地即贴底
//    （旧版红：裸口径把真贴底读成离底 22px ⇒ 轻点回钉失败 ⇒ 钉住态丢失 ⇒ 两条都落在视口外）
await reset();
await setTyping(true);
await sleep(120);
await tap();
await sleep(500);
const p2tap = await state();
await setTyping(false);
await sleep(300);
await burstSameTick('P2', 2);
await waitQuiet(1600);
const p2 = await state();
check('P2 打字行显示期同一记轻点后连发两条：同样全部落地即贴底（本次报障的直接判据）',
  p2.gap <= 8 && p2.over !== null && p2.over <= 1,
  'gap=' + p2.gap + ' over=' + p2.over + '（轻点后 anchor=' + p2tap.anchor + '，旧版此处 gap≈134、over≈+48）');

// P3 紧接着再连发两条：不得累积漂移
await burstSameTick('P3', 2);
await waitQuiet(1600);
const p3 = await state();
check('P3 P2 之后再连发两条：仍跟到底且无累积漂移（旧版红：gap 0→134→268 单调累积）',
  p3.gap <= 8 && p3.over !== null && p3.over <= 1,
  'gap=' + p3.gap + ' over=' + p3.over + '（旧版此处 gap≈268、over≈+182）');

// ---------- B 组：连发形态 ----------
// B1 同一 tick 连发 3 条
await reset();
await burstSameTick('B1', 3);
await waitQuiet(1800);
const b1 = await state();
check('B1 同一 tick 连发 3 条：全部落地即贴底、末态 gap ≤8',
  b1.gap <= 8 && b1.over !== null && b1.over <= 1,
  'gap=' + b1.gap + ' over=' + b1.over + ' n=' + b1.n);

// B2 逐条连发（真链路 chatAddInTyped，条间打字行显隐）
await reset();
await burstTyped('B2', 3, 400);
await waitQuiet(7000);
const b2 = await state();
check('B2 逐条连发 3 条（chatAddInTyped 真链路）：全部落地即贴底、末态 gap ≤8',
  b2.gap <= 8 && b2.over !== null && b2.over <= 1,
  'gap=' + b2.gap + ' over=' + b2.over + ' n=' + b2.n);

// ---------- Z 组 ----------
check('Z1 全程零 JS 异常', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0, 2).join(' | ') : '');

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(passed === results.length ? 0 : 1);

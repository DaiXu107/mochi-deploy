// ===== 回归验证：#871 iPhone 12 Pro Max Safari「展开撤回消息再收起／贴底轻划／点撤回字卡明细再
//       打开，气泡和头像错位」（用户直派，注明多机型同现；零机型分支） =====
// 根因面（无头实证 DOM 几何逐像素复原＝错位不在布局层，出自 WebKit 表现层滚动偏移撕裂）：
//   ①滚动容器内高度突变（撤回气泡就地展开/收起、两组「撤回 N 条字卡▾」明细开合）后，程序化
//     scrollTop 修正要么缺席（解钉态零接管）、要么迟到（钉住态等 250ms 看门狗＝最后一行先被推出
//     屏再弹回）；②#162 图片 onload 双写是唯一没接 #716/#765 让路闸的 scrollTop 写手＝手势/惯性
//     进行中与用户滑动对打。
// 修复：三处开合收尾统一走 chatRetractToggleAfter（钉住态立即贴底＋#861 落定锁复核；解钉态静默
//   后显式钳回真实 max＋同值重落＝强制滚动树对新几何重对齐），#162 补滚接让路闸（静默态保持
//   #504 双写快路）。
// 断言（428×926 DPR3 触摸仿真＋iOS UA＝按报障机型形态驱动产品真链路）：
//   S1~S3 静态锚：修复面三段逻辑锚在 src/js/chat.js
//   A1 钉住态展开立即贴底：+90ms 时最后一行已回到底（修复前等 250ms 看门狗＝此刻仍悬空）
//   A2 钉住态收起同样立即贴底（不回弹）
//   B1 解钉态收起上方内容：落定后 scrollTop ≤ 真实 max（超界不再依赖内核钳位时机）且 gapBelow ≥ 0
//   B2 解钉态收起是同值/钳回写而非贴底拽底（解钉契约 #162：绝不把用户拽回底）
//   D1 图片 onload 在滚动进行中不再当场写 scrollTop（滚动静默后才由落定锁补钉）
//   D2 静默态图片 onload 仍走 #504 双写快路（同步贴底不回退）
//   Z1 全程零 JS 异常
// 用法：node tools/verify-chat-retract-resync.mjs（默认对仓库根产物；MOCHI_SERVE_ROOT=<目录> 可对
//       临时构建产物做红绿对照）。需要 Node 21+ 与本机 Chrome/Edge。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

// ---- S 组：静态锚（对 src/js/chat.js，覆盖在产物构建之前） ----
const src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
check('S1 #871a 开合收尾助手在位', src.includes('function chatRetractToggleAfter(kind)'));
check('S2 #871b/#871c 解钉态落定重落（入口＋钳回/同值重落）在位',
  src.includes('else chatResyncScrollQuiet(kind);') && src.includes('cb.scrollTop = Math.min(cb.scrollTop, realMax);'));
check('S3 #871d 图片 onload 补滚让路闸在位',
  src.includes("if (Date.now() - _chatScrollActTs < 200 || chatTouchActive) { chatRepinAfterSettle(); return; }"));
check('S4 #871e/f/g 三处开合入口接钩在位',
  src.includes("chatRetractToggleAfter('toggle');") && src.includes("chatRetractToggleAfter('rc');") && src.includes("chatRetractToggleAfter('rcm');"));

// ---- 无头浏览器（真实产品链路） ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9720 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-868v-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
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
// iPhone 12 Pro Max 形态（报障设备）：428×926 @3x 触摸仿真＋iOS UA（mobile-adapt 走 iOS 分支：
// chat-body 内联 transform:none 豁免——与真机同构）
await cdp('Emulation.setDeviceMetricsOverride', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
// 关开屏与「数据备份提醒」启动弹窗（占住 #modal-mask 会吃掉点击）
await ev("(function(){var s=document.querySelector('.splash');if(s)s.classList.add('hide');var q=document.getElementById('qa-close');if(q)q.click();return true;})()");
await sleep(500);
await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}return true;})()");
await ev("(function(){var bar=document.getElementById('backup-remind-bar');if(bar)bar.remove();return true;})()");
await sleep(400);
// 关自动回复，避免随机回复/打字行干扰几何断言
await ev("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(800);

// 种消息：常规若干＋撤回一条（in 侧）＋常规若干（撤回条上方要有内容，收起时才存在「上方缩短」）
for (let i = 1; i <= 25; i++) await ev(`window.chatAddIn('常规消息第${i}条，撑一撑上下文。');`);
await ev(`window.chatAddGift({ side:'in', text:'这是被撤回的原文内容，展开之后这条气泡会明显变高，收起再变矮。', ts: Date.now()-30000, retracted:true });`);
for (let i = 26; i <= 35; i++) await ev(`window.chatAddIn('常规消息第${i}条。');`);
await sleep(600);

// 工具：触摸按下-抬起同点（贴底时）＝走 #716 契约回钉（无头里唯一不动产品内部状态的重钉路）
const repinTouch = `(function(){
  var b=document.getElementById('chat-body');
  var y=b.getBoundingClientRect().bottom-40;
  var t1=new Touch({identifier:1,target:b,clientX:200,clientY:y});
  b.dispatchEvent(new TouchEvent('touchstart',{touches:[t1],changedTouches:[t1],bubbles:true,cancelable:true}));
  b.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[t1],bubbles:true,cancelable:true}));
  return String(window.chatPinnedBottom);
})()`;

// 工具：找撤回气泡（塌缩态按文案、展开态按 showing 标记），返回 click() 前后的同步几何
const clickTomb = ` (function(){
  var b=document.getElementById('chat-body');
  var rows=b.querySelectorAll('.msg');
  for (var i=rows.length-1;i>=0;i--){ var bb=rows[i].querySelector('.msg-bubble'); if (!bb) continue; var isTomb = typeof bb.dataset.showing !== 'undefined'; if (!isTomb) { var s0=bb.querySelector('span'); isTomb = !!s0 && /撤回了一条消息/.test(s0.textContent); } if (isTomb) { var h0=b.scrollHeight; bb.click(); return JSON.stringify({h0:h0,h1:b.scrollHeight,show:String(bb.dataset.showing)}); } }
  return 'notfound';
})()`;
const gapBelow = `(function(){
  var b=document.getElementById('chat-body');
  var rows=b.querySelectorAll('.msg');
  var last=rows[rows.length-1];
  var br=last.getBoundingClientRect(), bodyR=b.getBoundingClientRect();
  return JSON.stringify({ gap: Math.round((b.scrollHeight-b.scrollTop-b.clientHeight)*10)/10, over: Math.round((b.scrollTop-(b.scrollHeight-b.clientHeight))*10)/10, lastVsBody: Math.round((br.bottom-bodyR.bottom)*10)/10 });
})()`;

const arm = JSON.parse(await ev('Promise.resolve(' + gapBelow + ')') || '{}');
check('A0 前置：贴底且收起态（展开断言的起点必须成立）', arm && Math.abs(arm.gap) <= 2 && arm.lastVsBody < 0, JSON.stringify(arm));

// ---- A 组：钉住态 展开→立即贴底（修复前：innerHTML 置换后无人写 scrollTop，最后一行被推出屏，
//      等 250ms 看门狗才弹回＝+90ms 时 gap≈dH 悬空） ----
await ev('(function(){var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
await sleep(250);
const aExp = JSON.parse(await ev('Promise.resolve(' + clickTomb + ')') || '{}');
await sleep(90);
const a1 = JSON.parse(await ev('Promise.resolve(' + gapBelow + ')') || '{}');
check('A1 展开确实长高了（+12px 量级）', aExp.h1 - aExp.h0 >= 8, 'dH=' + (aExp.h1 - aExp.h0));
check('A1 钉住态展开 +90ms 已贴底（立即贴底，不等看门狗）', a1 && Math.abs(a1.gap) <= 2, 'gap=' + (a1 && a1.gap));
await sleep(400);
const a2 = JSON.parse(await ev('Promise.resolve(' + clickTomb + ')') || '{}');
await sleep(90);
const a3 = JSON.parse(await ev('Promise.resolve(' + gapBelow + ')') || '{}');
check('A2 收起确实缩回（对称 dH）', a2.h1 - a2.h0 <= -8, 'dH=' + (a2.h1 - a2.h0));
check('A2 钉住态收起 +90ms 已贴底（不回弹）', a3 && Math.abs(a3.gap) <= 2, 'gap=' + (a3 && a3.gap));

// ---- B 组：解钉态收起「视口上方」的撤回条（内容缩短 dH）——落定后不得超界、不得被拽回底 ----
await ev('(function(){var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
await sleep(200);
await ev(`(function(){
  var b=document.getElementById('chat-body');
  var rows=b.querySelectorAll('.msg');
  for (var i=rows.length-1;i>=0;i--){ var bb=rows[i].querySelector('.msg-bubble'); if (bb && typeof bb.dataset.showing !== 'undefined') { bb.click(); return 'expanded'; } }
  return 'notfound';
})()`);
await sleep(150);
// 上翻到中段（解钉：wheel 事件走 #316 unpinChatAndAnchor）
await ev(`(function(){
  var b=document.getElementById('chat-body');
  b.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
  b.scrollTop = Math.max(0, b.scrollHeight - b.clientHeight - 160);
  return true;
})()`);
await sleep(200);
const b0 = JSON.parse(await ev('Promise.resolve(' + gapBelow + ')') || '{}');
check('B0 前置：解钉上翻已站住（gap ≥ 100；站不住＝环境抖动，重跑）',
  b0 && b0.gap >= 100, 'gap=' + (b0 && b0.gap));
const bCol = JSON.parse(await ev('Promise.resolve(' + clickTomb + ')') || '{}');
await sleep(1600); // 越过落定锁 1200ms 死线
const b1 = JSON.parse(await ev('Promise.resolve(' + gapBelow + ')') || '{}');
check('B1 解钉态收起上方内容：收起确实缩短（dH<0）且落定后不超界（scrollTop ≤ 真实 max）',
  bCol.h1 - bCol.h0 <= -8 && b1 && b1.over <= 0.5, 'dH=' + (bCol.h1 - bCol.h0) + ' over=' + (b1 && b1.over));
check('B2 解钉契约：落定后没有被拽回贴底（gap 保持正的富余，≠0）',
  b1 && b1.gap > 4, 'gap=' + (b1 && b1.gap) + '（收起前 gap=' + (b0 && b0.gap) + '）');

// ---- D 组：图片 onload 补滚让路闸（#162 修 #871 后口径） ----
// 先走 #716 契约回钉（贴底同点触摸＝touchend dy<10 且 chatAtBottom → scrollChatBottom）
await ev('(function(){var b=document.getElementById("chat-body");b.scrollTop=b.scrollHeight;return true;})()');
await sleep(200);
await ev('Promise.resolve(' + repinTouch + ')');
// D1：滚动进行中（_chatScrollActTs 持续保鲜）→ 不得当场写 scrollTop。造「可观测的写」：显示打字行
//     （chatScrollMax 比「行隐藏态真实 max」小一行高）→ 把 scrollTop 顶到真实 max → 每 60ms 派发
//     scroll 事件保鲜（同时压住看门狗/落定锁，隔离出纯 onload 写手）→ 若 onload 当场写（修复前
//     行为），scrollTop 在测量窗内立刻被拉低一行高；修复后由静默后的补钉路径接管。
await ev('(function(){var t=document.getElementById("chat-typing");if(t)t.hidden=false;return true;})()');
await ev(`(function(){
  var b=document.getElementById('chat-body');
  b.scrollTop=b.scrollHeight;
  window.__spamOn=true;
  (function spam(){ if(!window.__spamOn) return; b.dispatchEvent(new Event('scroll')); setTimeout(spam,60); })();
  return true;
})()`);
await sleep(200);
const d0 = JSON.parse(await ev(`(function(){
  var b=document.getElementById('chat-body');
  return JSON.stringify({ top: Math.round(b.scrollTop*10)/10, realMax: Math.round((b.scrollHeight-b.clientHeight)*10)/10 });
})()`) || '{}');
await ev(`(function(){
  var b=document.getElementById('chat-body');
  b.scrollTop=b.scrollHeight; // 顶回真实 max（保鲜期内看门狗无法拉低）
  var rows=b.querySelectorAll('.msg');
  var last=rows[rows.length-1];
  var img=document.createElement('img');
  last.querySelector('.msg-bubble').appendChild(img);
  img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // 先挂后设 src＝load 必异步派发（先设 src 的 data: 图同步解码完成、load 永不再发＝断言空转）
  return 'img-appended';
})()`);
await sleep(100); // load 事件窗口内、保鲜仍在持续＝看门狗/落定锁全被压住，只测 onload 写手本身
const d1 = JSON.parse(await ev(`(function(){
  var b=document.getElementById('chat-body');
  window.__spamOn=false;
  return JSON.stringify({ top: Math.round(b.scrollTop*10)/10, moved: Math.round(Math.abs(b.scrollTop-(${d0.realMax}))*10)/10 });
})()`) || '{}');
check('D1 滚动进行中 onload 未当场写 scrollTop（100ms 内偏离真实 max <2px；修复前≈一行高）',
  d1 && d1.moved < 2, 'moved=' + (d1 && d1.moved));
await ev('(function(){var t=document.getElementById("chat-typing");if(t)t.hidden=true;return true;})()');
await sleep(1800); // 保鲜停止后越过落定锁/看门狗：静默后应已贴底
const d2 = JSON.parse(await ev('Promise.resolve(' + gapBelow + ')') || '{}');
check('D2 滚动静默后落定锁补钉到位（贴底）', d2 && Math.abs(d2.gap) <= 2, 'gap=' + (d2 && d2.gap));
// D3：静默态 onload 仍走 #504 双写快路。造「不贴底起点」：把 scrollTop 抬离底部一行高（模拟内核
//     丢弃首写/迟到位），onload 快路必须当场把它拽回（修复前后行为一致＝#504 契约不回退的守卫）。
//     打字行显示态下 chatScrollMax 比真实 max 小一行高：先停保鲜、把 scrollTop 顶到真实 max，
//     快路一写就回到 chatScrollMax＝120ms 内位移一行高且贴底。
await ev('(function(){var t=document.getElementById("chat-typing");if(t)t.hidden=false;return true;})()');
await sleep(2500); // 让上一轮落定锁/看门狗全部冷却（_rsyncT/#861 无在膛）
await ev(`(function(){
  var b=document.getElementById('chat-body');
  b.scrollTop=b.scrollHeight; // 贴底（真实 max 口径，快路写目标在下方一行高）
  return true;
})()`);
await sleep(600); // 写入自身 scroll 事件冷却（>200ms），快路闸才判「静默」
await ev(`(function(){
  var b=document.getElementById('chat-body');
  var rows=b.querySelectorAll('.msg');
  var last=rows[rows.length-1];
  var img=document.createElement('img');
  last.querySelector('.msg-bubble').appendChild(img);
  img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // 同 D1：先挂后设＝load 必异步派发
  return true;
})()`);
await sleep(120);
const d3 = JSON.parse(await ev('Promise.resolve(' + gapBelow + ')') || '{}');
// 打字行可见时「贴底」有两个合法口径（真实 max／#514 行隐藏口径，差一行高 ≤22px，被 24px
// 呼吸区吸收）——守的应是「末行完整可见、视图不悬空」，不是某个具体 scrollTop 值。
check('D3 静默态 onload 后末行完整可见、视图不悬空（#504 快路契约不回退）',
  d3 && d3.gap <= 24 && d3.lastVsBody < 0, 'gap=' + (d3 && d3.gap) + ' lastVsBody=' + (d3 && d3.lastVsBody));

// ---- Z 组：零 JS 异常 ----
const errs = await ev('JSON.stringify((window.__jsErrors||[]).length)');
check('Z1 全程零 JS 异常', errs === '0', 'errors=' + errs);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const failed = results.filter(r => !r.ok).length;
console.log('\n通过 ' + (results.length - failed) + '/' + results.length + (failed ? '  ← 有断言失败' : ''));
process.exit(0);

// ===== 常驻回归脚本 #1023：点「让对方继续说」后聊天记录不自动滑到最新消息 =====
// 用法：node build.mjs && node tools/verify-1023-continue-follow.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-1023-continue-follow.mjs   （红绿对照）
//
// 报障（用户原话，单聊与群聊同现）：「点击【让对方继续说】的功能，聊天记录没有自动滑动。
//   聊天和群聊里都这样。」
//
// 根因（零机型/内核分支）：点「继续说」是**用户当刻主动要的回应**，但它产出的是一条 in 侧
//   消息，只吃「TA 自发消息不打扰」的钉住闸——单聊 maybeScrollChatBottom 的
//   `if (!out && !userFollow && !chatPinnedBottom) return;`、群聊 followGcBottom 的
//   `if (!force && gcUserGcScrollTouched) return;`。用户上翻看过历史＝解钉/接管态时，TA 的
//   回复气泡落在视口下方，永远不滑过来（无头实测：单聊 gap 400→486px、气泡底边在消息区
//   下方 +458px；群聊 gap 400→507px）。贴底态本就在底部，所以只在「看历史时点继续说」这类
//   场景暴露——与 #492（帮我决定结果发到聊天）、拍一拍（2026-09-17）同族，那两处当年已按
//   「用户主动通道」修过，继续说这条漏了。
//
// 修法（对称两处，都用现成的用户主动通道，不新增机制）：
//   · 单聊 chat.js continueChat：每条回复投递前置一次性跟底标记 chatUserFollowScroll
//     （#492 的既有通道，maybeScrollChatBottom 消费后即清）。
//   · 群聊 group-chat.js：memberReply 把 continuation（＝「这是用户点继续说要的回应」）透
//     传给 gcDeliverReply，由它调 followGcBottom(!!forceFollow) 强制贴底；跨群/TA 自发回复
//     照旧走无 force 的原路径。
//
// 断言组：
//   S 产物锚（两处修复逻辑在位 ＋ 「唯一 force 来源＝继续说」的口径不被扩大）
//   A 单聊·贴底态点继续说：落地即贴底（对照项，两版都该过）
//   B 单聊·上翻态点继续说：落地仍贴底（判别项；旧版 gap 400+、气泡在视口下方）
//   B2 单聊·上翻态【对照】：TA 自发消息（chatAddIn 不带 follow）仍然不跟底——证明没把
//      「不打扰」契约改成「什么都跟着跳」（该项两版都必须过）
//   C 群聊·贴底态点继续说：落地即贴底（对照项）
//   D 群聊·上翻态点继续说：落地仍贴底（判别项）
//   D2 群聊·上翻态【对照】：成员自发回复（用户发消息触发的那条，非继续说）仍然不跟底
//   Z 全程零 JS 异常
//
// 判据口径：gap ＝（与产品写方同尺的最大 scrollTop）− scrollTop；over ＝最新一条气泡底边 −
//   消息区底边（over > 1 ＝ 最新消息落在视口下方＝用户得自己滑到底＝报障直接形态）。
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

// ---------- S 组：产物锚（#860 后 chat.js / group-chat.js 外置，index.html + js/*.js 两处都读） ----------
let prod = '';
try { prod = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
let prodChat = '';
try { prodChat = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
let prodGc = '';
try { prodGc = readFileSync(join(root, 'js', 'group-chat.js'), 'utf8'); } catch (e) {}
if (!prodChat) prodChat = prod;
if (!prodGc) prodGc = prod;

check('S1 单聊继续说置一次性跟底标记（删＝上翻态点继续说后 TA 回复落在视口下方不滑过来＝报障复发；#1023a）',
  prodChat.includes('chatUserFollowScroll = true; // #1023'), '');
check('S2 群聊 gcDeliverReply 收 forceFollow 并透传 followGcBottom（删＝群聊侧强制贴底失效；#1023b）',
  prodGc.includes('function gcDeliverReply(gid, rec, sfx, forceFollow)') && prodGc.includes('followGcBottom(!!forceFollow);'), '');
check('S3 群聊成员回复把 continuation（用户点继续说）带进投递（删＝群聊侧强制贴底永不触发；#1023c）',
  prodGc.includes("const myIdx = gcDeliverReply(gid, rec, 'in', continuation);"), '');
check('S4 force 的唯一来源是「继续说」：自动回复链的 memberReply 调用不带 continuation（改成恒 force＝每次自动回复都把看历史的用户拽回最底）',
  prodGc.includes("setTimeout(() => memberReply(cid, userText, gid), i * (1200 + Math.random() * 1600));")
  && prodGc.includes("setTimeout(() => memberReply(cid, '', gid, true), gap);"), '');
check('S5 单聊跟底闸本身未被放宽（userFollow 之外仍要过「钉住态或真贴底」闸：TA 自发消息在解钉态不抢滚动权）',
  prodChat.includes('if (!out && !userFollow && !chatPinnedBottom) return;')
  || prodChat.includes('if (!out && !userFollow && !chatPinnedBottom && !chatAtBottom()) return;'), '');

// ---------- 无头装置 ----------
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1023-' + Date.now()),
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
          if (m.method === 'Runtime.exceptionThrown') jsErrors.push(String((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
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
    if (r && r.exceptionDetails) { jsErrors.push('eval:' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 160)); return null; }
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
// 开屏节点整个摘除（不是点它加 .hide）：留着 `.splash:not(.hide) ~ .phone{visibility:hidden}`
// 会在部分时序下让整页不可见，而且 z-999 的开屏会把所有真实点按吞掉（命中测试落点是 splash）
await ev("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return true;})()");
await sleep(700);

const STATE = (sel) => `(function(){
  var b=document.querySelector('${sel}');
  if(!b) return JSON.stringify({missing:true});
  var t=document.querySelector('${sel === '#chat-body' ? '#chat-typing' : '#gc-typing'}');
  var rowH=(t&&!t.hidden)?t.offsetHeight:0;
  var max=b.scrollHeight-(b.clientHeight+rowH);
  var lm=null;
  for(var i=b.children.length-1;i>=0;i--){var c=b.children[i];if(c.classList&&c.classList.contains('msg')){lm=c;break;}}
  var br=b.getBoundingClientRect();
  return JSON.stringify({
    anchor:b.classList.contains('scroll-anchor-auto'),
    gap:Math.round((max-b.scrollTop)*10)/10,
    typing:!!(t&&!t.hidden),
    over:lm?Math.round((lm.getBoundingClientRect().bottom-br.bottom)*10)/10:null,
    n:b.querySelectorAll('.msg').length
  });})()`;
const state = async (sel) => JSON.parse((await ev(STATE(sel))) || '{}');
const TOUCH = (sel, phase, y) => `(function(){
  var b=document.querySelector('${sel}');
  var mk=function(t){return new Touch({identifier:1,target:b,clientX:200,clientY:t,pageX:200,pageY:t});};
  var e=new TouchEvent('${phase}',{touches:${phase === 'touchend' ? '[]' : '[mk(' + y + ')]'},targetTouches:${phase === 'touchend' ? '[]' : '[mk(' + y + ')]'},changedTouches:[mk(${y})],bubbles:true,cancelable:true});
  b.dispatchEvent(e); return true; })()`;
// 上翻一段（真机形态：触摸拖动 >10px 后抬手）＝解钉/接管态
async function scrollUp(sel, px) {
  await ev(TOUCH(sel, 'touchstart', 500));
  await sleep(40);
  await ev(`(function(){var b=document.querySelector('${sel}');b.scrollTop=b.scrollTop-${px};return true;})()`);
  await sleep(120);
  await ev(TOUCH(sel, 'touchend', 500 - px));
  await sleep(400);
}
async function toBottom(sel) {
  await ev(`(function(){var b=document.querySelector('${sel}');b.scrollTop=b.scrollHeight;return true;})()`);
  await sleep(500);
}
// 站内弹层让路：本轮批量发消息与常规启动流程会触发「数据会被自动清空 · 备份提醒」等
// #modal-mask 弹层，它盖住整页（含输入栏），真实鼠标点按会被它吞掉（命中测试落点是遮罩）。
// 它属产品正常行为（真人会点掉），与本次判据无关 ⇒ 每次点按钮前先按产品自己的关闭路径
//（点遮罩，#522 要求打开满 350ms）让它退场；关不掉（lock 型弹层）则如实记在断言详情里。
// 站内浮层让路：批量发消息与回复链会随机触发站内浮层——「数据会被自动清空 · 备份提醒」
// （#modal-mask）与 TA 来电面板（#call-mask，continueChat 里 callMaybeTrigger 的排期）——它们
// 盖住输入栏、真实鼠标点按会被吞（命中测试落点是遮罩）。真人会自己点掉，与本次判据无关 ⇒
// 每次点按钮前走产品自己的关闭路径让它退场（来电侧同时把「来电概率」置 0 断源），
// 关不掉则如实记进断言详情（不静默掩盖）。
async function clearOverlays(tag) {
  const info = await ev(`(function(){
    var out=[];
    var m=document.getElementById('modal-mask');
    if(m&&!m.hidden){var ti=document.getElementById('modal-title');out.push('modal-mask「'+((ti?ti.textContent:'')||'').slice(0,40)+'」');}
    var c=document.getElementById('call-mask');
    if(c&&!c.hidden)out.push('call-mask「'+((document.getElementById('call-status')||{}).textContent||'')+'」');
    return JSON.stringify(out);})()`);
  let arr = [];
  try { arr = JSON.parse(info || '[]'); } catch (e) {}
  if (arr.length) {
    console.log('    · [' + tag + '] 先让站内浮层退场（真人会自己点掉，与判据无关）：' + arr.join(' | '));
    await sleep(450); // #522：弹层打开 350ms 内的合成 click 会被产品忽略
    await ev("(function(){" +
      "var m=document.getElementById('modal-mask');if(m&&!m.hidden)m.click();" +
      "var c=document.getElementById('call-mask');if(c&&!c.hidden){var r=document.getElementById('call-reject-btn');if(r&&!r.hidden){r.click();return true;}var h=document.getElementById('call-hang-btn');if(h&&!h.hidden){h.click();}}" +
      "return true;})()");
    await sleep(450);
  }
  return arr;
}
async function measureBtn(id) {
  return JSON.parse((await ev(`(function(){var b=document.getElementById('${id}');if(!b)return JSON.stringify({ok:false});
    var x=b.getBoundingClientRect();var cx=Math.round(x.left+x.width/2),cy=Math.round(x.top+x.height/2);
    if(!cx&&!cy)return JSON.stringify({ok:false,display:getComputedStyle(b).display});
    var hit=document.elementFromPoint(cx,cy);
    var hd=hit?(hit.id?('#'+hit.id):(hit.className?('.'+String(hit.className).split(' ')[0]):hit.tagName)):'null';
    return JSON.stringify({ok:true,x:cx,y:cy,display:getComputedStyle(b).display,hit:hd,hitIsSelf:hit===b||!!(hit&&b.contains(hit))});})()`)) || '{}');
}
async function clickBtn(id) {
  await clearOverlays(id);
  let r = await measureBtn(id);
  if (r.ok && !r.hitIsSelf) { await sleep(500); await clearOverlays(id); r = await measureBtn(id); } // 浮层/重排的偶发遮挡给它一拍再量
  if (!r.ok) return r;
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await sleep(40);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  return r;
}
// 点击后采样到「新消息落地」并再跟 800ms（跟底三连写是 sync + rAF + 120ms，#998 家族看门狗 250ms）
async function watchLanding(sel, nBefore, ms) {
  const t0 = Date.now();
  let landedAt = -1, landed = null, last = null;
  while (Date.now() - t0 < ms) {
    const s = await state(sel);
    last = s;
    if (landedAt < 0 && s.n > nBefore) { landedAt = Date.now() - t0; landed = s; }
    if (landedAt >= 0 && Date.now() - t0 - landedAt > 800) break;
    await sleep(100);
  }
  return { landedAt, landed, last };
}

// ---------- 设置：单聊继续说＝点了就回 1 条纯文字，其余自动回复一律关掉（防互相干扰） ----------
await ev(`(function(){var st=window.activeStore();
  st.set('reply-cs-trigger-bar','1'); st.set('reply-cs-normal','0'); st.set('reply-py-en','0');
  st.set('reply-rs-min','9999'); st.set('reply-rs-max','9999'); st.set('reply-rn-prob','0'); st.set('reply-rc-prob','0');
  // 断掉「TA 来电」这条排期（continueChat 尾部会 callMaybeTrigger）：来电面板 #call-mask 会盖住
  // 输入栏、真实点按被吞（实测就是它让群聊两段时红时绿；真人会自己点掉，与判据无关）
  st.set('reply-call-incoming','0'); st.set('reply-call-pickup','0');
  try{var g=window.xyStore('xy-home-v2');
    g.set('reply-gc-gc-cs-trigger-bar','1'); g.set('reply-gc-gc-cs-normal','0'); g.set('reply-gc-gc-py-en','0');
    g.set('reply-gc-gc-touch-prob','0'); g.set('reply-gc-gc-rc-prob','0'); g.set('reply-gc-gc-reply-min','1'); g.set('reply-gc-gc-reply-max','1'); g.set('reply-gc-gc-rs-min','1'); g.set('reply-gc-gc-rs-max','1');
  }catch(e){}
  if(window.applyContinueSayUI)window.applyContinueSayUI();
  document.dispatchEvent(new Event('continue-say-changed')); document.dispatchEvent(new Event('gc-continue-say-changed'));
  return true;})()`);
await sleep(300);
const cfg1 = JSON.parse((await ev("(function(){var c=window.replyCfg?window.replyCfg():{};var b=document.getElementById('chat-continue-btn');return JSON.stringify({normal:c['cs-normal'],py:c['py-en'],bar:c['cs-trigger-bar'],display:b?getComputedStyle(b).display:'missing'});})()")) || '{}');
check('前置 单聊「继续说」按钮已可见（回复设置→聊天栏继续说按钮＝开）', cfg1.bar === 1 && cfg1.display !== 'none' && cfg1.display !== 'missing', JSON.stringify(cfg1));

await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(600);
for (let i = 1; i <= 40; i++) await ev(`window.chatSendMsg('撑高消息 ${i}，这是一条用来撑出滚动高度的测试消息内容，稍微长一点。');`);
await sleep(1500);

// ---------- A 单聊·贴底态 ----------
await clearOverlays('单聊');
await toBottom('#chat-body');
let sA = await state('#chat-body');
let rA = await clickBtn('chat-continue-btn');
let wA = await watchLanding('#chat-body', sA.n, 7000);
check('A0 前置：单聊已撑出滚动高度、停在贴底钉住态、按钮真实可点（命中测试落在自己身上）',
  sA.gap <= 2 && sA.anchor === false && rA.hitIsSelf === true,
  'gap=' + sA.gap + ' anchor=' + sA.anchor + ' hitIsSelf=' + rA.hitIsSelf + ' hit=' + rA.hit);
check('A1 单聊·贴底态点「继续说」：TA 回复落地即贴底（对照项）',
  wA.landedAt >= 0 && wA.last && wA.last.gap <= 8,
  '落地=' + wA.landedAt + 'ms 末态gap=' + (wA.last && wA.last.gap) + ' over=' + (wA.last && wA.last.over));

// ---------- B 单聊·上翻态（判别项） ----------
await scrollUp('#chat-body', 400);
let sB = await state('#chat-body');
let rB = await clickBtn('chat-continue-btn');
let wB = await watchLanding('#chat-body', sB.n, 7000);
// 判据用 over 为主（最新一条气泡底边是否落在消息区内＝用户是否看得见最新消息），gap 只作
// 兜底量级闸（≤24px＝一行以内）：贴底三连写之后仍可能有迟到的几何变化把视口顶开一二十像素，
// 那是 #998 家族（来消息跟底看门狗）的存量面，不在本批范围；本批要证的是「用户点了继续说，
// 视图必须跟着走到最新」，旧版这里是 gap 400+ / over +300（最新消息整个在视口外）。
const FOLLOWED = (s) => !!s && s.gap <= 24 && s.over <= 1;
check('B0 前置：单聊已上翻＝解钉/接管态（gap 明显 > 100）',
  sB.gap > 100 && sB.anchor === true, 'gap=' + sB.gap + ' anchor=' + sB.anchor);
check('B1 单聊·上翻态点「继续说」：TA 回复落地也滑到最新（旧版此处 gap 400+、气泡在视口下方＝报障本体）',
  wB.landedAt >= 0 && FOLLOWED(wB.last),
  '落地=' + wB.landedAt + 'ms 末态gap=' + (wB.last && wB.last.gap) + ' over=' + (wB.last && wB.last.over));

// ---------- B2 单聊·上翻态【对照】：TA 自发消息仍不打扰 ----------
await toBottom('#chat-body');
await sleep(300);
await scrollUp('#chat-body', 400);
let sB2 = await state('#chat-body');
await ev("(function(){window.chatAddIn('TA 自发的测试消息，不是用户主动触发的（不打扰契约对照）。');return true;})()");
let wB2 = await watchLanding('#chat-body', sB2.n, 3000);
check('B2 对照：上翻态下 TA 自发消息仍然不跟底（不打扰契约未被本批放宽）',
  wB2.landedAt >= 0 && wB2.last && wB2.last.gap > 100,
  '落地=' + wB2.landedAt + 'ms 末态gap=' + (wB2.last && wB2.last.gap));

// ---------- 群聊 ----------
for (let i = 1; i <= 30; i++) {
  await ev(`(function(){var k='xy-home-v2:group-chat-msgs';var a=JSON.parse(localStorage.getItem(k)||'[]');a.push({side:'out',text:'群聊撑高消息 ${i}，内容稍微长一点用来撑出滚动高度。',ts:Date.now()+${i}});localStorage.setItem(k,JSON.stringify(a));return true;})()`);
}
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-phone');});return true;})()");
await sleep(400);
await ev("(function(){var a=document.querySelector('.app[data-app=\"group-chat\"]');if(a)a.click();return !!a;})()");
await sleep(1600);

// ---------- C 群聊·贴底态 ----------
await clearOverlays('群聊');
await toBottom('#gc-body');
let sC = await state('#gc-body');
let rC = await clickBtn('gc-continue-btn');
let wC = await watchLanding('#gc-body', sC.n, 7000);
check('C0 前置：群聊已撑出滚动高度、停在贴底态、按钮真实可点',
  sC.gap <= 2 && sC.n > 5 && rC.hitIsSelf === true,
  'gap=' + sC.gap + ' n=' + sC.n + ' hitIsSelf=' + rC.hitIsSelf + ' hit=' + rC.hit);
check('C1 群聊·贴底态点「继续说」：成员回复落地即贴底（对照项）',
  wC.landedAt >= 0 && wC.last && wC.last.gap <= 8,
  '落地=' + wC.landedAt + 'ms 末态gap=' + (wC.last && wC.last.gap) + ' over=' + (wC.last && wC.last.over));

// ---------- D 群聊·上翻态（判别项） ----------
await scrollUp('#gc-body', 400);
let sD = await state('#gc-body');
let rD = await clickBtn('gc-continue-btn');
let wD = await watchLanding('#gc-body', sD.n, 7000);
check('D0 前置：群聊已上翻＝接管态（gap 明显 > 100）',
  sD.gap > 100 && sD.anchor === true, 'gap=' + sD.gap + ' anchor=' + sD.anchor);
check('D1 群聊·上翻态点「继续说」：成员回复落地也滑到最新（旧版此处 gap 400+＝报障本体）',
  wD.landedAt >= 0 && FOLLOWED(wD.last),
  '落地=' + wD.landedAt + 'ms 末态gap=' + (wD.last && wD.last.gap) + ' over=' + (wD.last && wD.last.over));

// ---------- D2 群聊·上翻态【对照】：用户发消息触发的自动回复仍不打扰 ----------
// 真链路：发一条 → 排期成员回复（gc-rs-min/max 调成 3s 好留出上翻窗口）→ 立刻上翻 → 回复落地时不该拽回
await ev("(function(){var g=window.xyStore('xy-home-v2');g.set('reply-gc-gc-rs-min','3');g.set('reply-gc-gc-rs-max','3');g.set('reply-gc-gc-prob','100');g.set('reply-gc-gc-py-en','0');return true;})()");
await sleep(200);
await toBottom('#gc-body');
let sD2 = await state('#gc-body');
await ev("(function(){var i=document.getElementById('gc-input');i.textContent='对照用：这是用户自己发的消息（会触发成员自动回复）';document.getElementById('gc-send').click();return true;})()");
await sleep(250);
await scrollUp('#gc-body', 400);
let sD2b = await state('#gc-body');
let wD2 = await watchLanding('#gc-body', sD2b.n, 8000);
check('D2 对照：上翻后成员自动回复落地仍然不跟底（不打扰契约未被本批放宽；旧版/新版同值）',
  sD2b.gap > 100 && wD2.landedAt >= 0 && wD2.last && wD2.last.gap > 100,
  '上翻gap=' + sD2b.gap + ' 落地=' + wD2.landedAt + 'ms 末态gap=' + (wD2.last && wD2.last.gap));

check('Z 全程零 JS 异常', jsErrors.length === 0, JSON.stringify(jsErrors.slice(0, 3)));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

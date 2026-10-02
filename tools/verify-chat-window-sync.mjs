// ===== 回归脚本：聊天分页窗口失步导致联系人消息/卡片显示两条 =====
// 用法：node build.mjs && node tools/verify-chat-window-sync.mjs
// 用户反馈（2026-08-25）：「联系人发送的消息和联系人发送的卡片，显示都变成2个，
// 重复了，但是我发送消息后又回复成正常的1个消息的显示了」。
//
// 根因：addRec 增量追加只 renderMsg 到 DOM 末尾、不推进渲染窗口终点 renderEnd
//（renderEnd 仅在整窗重建/上下增量加载时更新）→ 每收一条联系人消息就产生
// renderEnd < msgs.length 的窗口失步；聊天页贴底状态下任意一次 scroll 事件
// （自动贴底/用户轻扫/发送后补偿滚动）命中 loadNewerIncremental，把
// [renderEnd, msgs.length) 原样重画一遍 → 同一条消息/卡片出现两个气泡。
// 我方发送常走 renderWindow 整窗重建把重复冲掉 = 「我一发消息就恢复1个」。
//
// 验证：
//   A. 常规会话（历史 ≤ RENDER_MAX，renderStart=0）：注入 TA 文本消息 / 系统卡片后
//      轻扫滚动（贴底 wiggle），断言 DOM 中各自只出现 1 个节点；再发我方消息复查。
//   B. 深翻历史（历史 > WINDOW_MAX 触发裁尾）：翻到顶 → 注入 TA 消息（脱尾 append）
//      → 跳回底部触发缺口补画，断言不重画已存在节点且先旧后新时序正确。
//   C. 全局不变量：#chat-body 内 .msg[data-idx] 无重复下标。
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9970 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-chat-winsync-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const KEY = 'xy-home-v2:default:chat-msgs';
const TAIL = 'xy-home-v2:default:chat-tail'; // #180 同步尾巴日志（整包换种子时必须一并清零）
// 种子：n 条纯文本历史（唯一文案「历史#i」，out/in 交替），无图片避免 LS 有损剥离干扰
function seed(n) {
  const t = Date.now() - n * 60000;
  const recs = [];
  for (let i = 0; i < n; i++) {
    recs.push({ side: i % 2 ? 'in' : 'out', text: '历史#' + i, ts: t + i * 30000 });
  }
  return JSON.stringify(recs);
}

async function bootWithSeed(n) {
  // 先开一次页面写种子（LS+IDB），再刷新走完整加载链路
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1800);
  const s = seed(n);
  const ok = await evalJs(`(async function(){
    try {
      localStorage.setItem('${KEY}', ${JSON.stringify(s)});
      await window.idbSet('${KEY}', ${JSON.stringify(s)});
      // 整包换成种子时，上一次运行留在尾巴日志里的消息必须一并清零：那是产品「未落盘」台账，
      // 留着它＝权威读库后 chatTailMerge 如实回放上一轮的消息 ⇒ A0 数到的条数天然大于种子数。
      localStorage.removeItem('${TAIL}');
      if (window.idbDelete) await window.idbDelete('${TAIL}');
      return true;
    } catch (e) { return false; }
  })()`);
  if (!ok) { console.error('种子写入失败'); process.exit(1); }
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
  await sleep(600);
}

async function openChat() {
  await evalJs("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
  await sleep(700);
}
// 统计某文本在聊天流中出现的气泡数（.msg/.msg-ask 一并覆盖普通消息与卡片）
function countTextJs(text) {
  return `(function(){
    var body=document.getElementById('chat-body'); if(!body) return -1;
    var n=0; var esc=${JSON.stringify(text)};
    body.querySelectorAll('.msg,.msg-ask,.msg-poke').forEach(function(el){ if((el.textContent||'').indexOf(esc)>=0) n++; });
    return n;
  })()`;
}
// 全局不变量：data-idx 不得重复且自上而下递增；失败时带回断点前后值辅助定位
const INVARIANT = `(function(){
  var body=document.getElementById('chat-body'); if(!body) return JSON.stringify({err:'no body'});
  var seen={}, dup=[], last=-1, mono=true, brk=null;
  var idxs=[];
  body.querySelectorAll('.msg[data-idx]').forEach(function(el){ idxs.push(parseInt(el.dataset.idx,10)); });
  for (var i=0;i<idxs.length;i++){
    var k=idxs[i]; seen[k]=(seen[k]||0)+1;
    if(k<last && mono){ mono=false; brk={at:i,prev:last,cur:k}; }
    last=k;
  }
  Object.keys(seen).forEach(function(k){ if(seen[k]>1) dup.push(k); });
  var head=idxs.slice(0,8), tail8=idxs.slice(-8), around=null;
  if(brk){ around=idxs.slice(Math.max(0,brk.at-3), brk.at+4); }
  return JSON.stringify({ dupIdx: dup, mono: mono, brk: brk,
    head: head, tail8: tail8, around: around,
    first: idxs[0], lastN: idxs[idxs.length-1], nodes: idxs.length });
})()`;
// 贴底轻扫：上移 30px 再回底，各派发 scroll（触发节流后的处理器）
const WIGGLE = `(function(){
  var b=document.getElementById('chat-body'); if(!b) return 0;
  b.scrollTop=b.scrollHeight-800; b.scrollTop=b.scrollHeight;
  return 1;
})()`;

// ---- A. 常规会话：TA 文本消息 / 卡片注入后贴底轻扫不出现双条 ----
{
  await bootWithSeed(120); // ≤ RENDER_MAX(200)：进入后 renderStart=0，收消息走增量追加路径
  await openChat();
  // 产品开屏会往聊天里注入「当日提醒」（拍一拍 + 日常状态各一条，一天一次），整包条数天然大于种子数；
  // A0 要证的是「历史一条不少、一条不多」，因此按种子文案逐条数，而不是比总长。
  const base = JSON.parse(await evalJs(`(function(){
    var a=window.getChatMsgs(), seen={}, dup=0, hit=0;
    a.forEach(function(m){ var t=String((m&&m.text)||''); if(t.indexOf('历史#')!==0) return; if(seen[t])dup++; else{seen[t]=1;hit++;} });
    return JSON.stringify({total:a.length, hit:hit, dup:dup, kinds:Object.keys(seen).length});
  })()`) || '{}');
  check('A0 历史加载完整（种子 120 条各在位一次，无丢失无重复）', base.hit === 120 && base.kinds === 120 && base.dup === 0, JSON.stringify(base));

  // A1 TA 文本消息：注入（自动贴底滚动即产生 scroll 事件）+ 显式轻扫
  await evalJs(`window.chatAddIn('TA测试消息甲')`);
  await sleep(500);
  await evalJs(WIGGLE);
  await sleep(500);
  const a1 = await evalJs(countTextJs('TA测试消息甲'));
  check('A1 TA 文本消息只显示 1 条（注入+贴底轻扫后）', a1 === 1, 'count=' + a1);

  // A2 系统提示类（拍一拍 special）：同场景不双条
  await evalJs(`window.chatAddSystem('拍了拍你一下')`);
  await sleep(500);
  await evalJs(WIGGLE);
  await sleep(500);
  const a2 = await evalJs(countTextJs('拍了拍你一下'));
  check('A2 系统提示消息只显示 1 条', a2 === 1, 'count=' + a2);

  // A3 互动卡片（ask-msg 引导条 + ask-card 卡片，ta-ask 同款注入方式）不双条
  // 引导条文本必须自带夹具标记：产品文案「TA想问你一个问题。」由 ta-ask.js 随机询问注入，
  // 撞进同一测试窗口就多出一条同文本的 ask-msg＝按文本计数的判据不成立（实测 tip=2 偶发红）。
  await evalJs(`window.chatAddSystem('A3夹具引导条·勿改此文本',{special:'ask-msg'})`);
  await evalJs(`window.chatAddSystem('今晚吃什么好呢?',{special:'ask-card',askQuestion:'今晚吃什么好呢?',askOptions:null,askType:'text'})`);
  await sleep(500);
  await evalJs(WIGGLE);
  await sleep(500);
  const a3a = await evalJs(countTextJs('A3夹具引导条·勿改此文本'));
  const a3b = await evalJs(countTextJs('今晚吃什么好呢?'));
  check('A3 互动卡片只显示 1 张（引导条+卡片）', a3a === 1 && a3b === 1, 'tip=' + a3a + ' card=' + a3b);

  // A4 我方发送后复查：此前各条仍为 1；我方这条也为 1
  await evalJs(`window.chatSendMsg('我的回复测试')`);
  await sleep(900);
  const a4 = await evalJs(`JSON.stringify({
    ta: (function(){var n=0;document.querySelectorAll('#chat-body .msg').forEach(function(e){if(e.textContent.indexOf('TA测试消息甲')>=0)n++;});return n;})(),
    me: (function(){var n=0;document.querySelectorAll('#chat-body .msg').forEach(function(e){if(e.textContent.indexOf('我的回复测试')>=0)n++;});return n;})()
  })`);
  let o4 = {}; try { o4 = JSON.parse(a4); } catch (e) {}
  check('A4 发送我方消息后全部保持单条', o4.ta === 1 && o4.me === 1, 'ta=' + o4.ta + ' me=' + o4.me);

  const invA = JSON.parse(await evalJs(INVARIANT));
  check('C-A data-idx 无重复且时序递增', (!invA.err) && invA.dupIdx.length === 0 && invA.mono, JSON.stringify(invA));
}

// ---- B. 深翻历史裁尾：脱尾 append 后跳回底部补画，不重画、时序正确 ----
{
  await bootWithSeed(900); // > WINDOW_MAX(400)：向上翻页会触发 pruneWindowBottom 裁尾
  await openChat();
  await sleep(300);
  // 连续翻到顶：每次置顶触发 loadOlderIncremental（100 条/次），900 条需 ~9 次
  for (let r = 0; r < 14; r++) {
    await evalJs(`(function(){var b=document.getElementById('chat-body');b.scrollTop=10;b.dispatchEvent(new Event('scroll'));return 1;})()`);
    await sleep(260);
  }
  const topInfo = JSON.parse(await evalJs(`(function(){
    var b=document.getElementById('chat-body');
    var first=Infinity,last=-1;
    b.querySelectorAll('.msg[data-idx]').forEach(function(e){var k=parseInt(e.dataset.idx,10);if(k<first)first=k;if(k>last)last=k;});
    return JSON.stringify({first:first,last:last,len:window.getChatMsgs().length});
  })()`));
  check('B0 深翻后窗口已扩至顶部', topInfo.first === 0 || topInfo.first <= 100, JSON.stringify(topInfo));

  // 置顶状态注入 2 条 TA 消息（远离底部 → 走增量 append 成"脱尾"）
  await evalJs(`window.chatAddIn('深翻测试消息一')`);
  await sleep(250);
  await evalJs(`window.chatAddSystem('B1夹具提问·勿改此文本',{special:'ask-msg'})`);
  await sleep(250);
  // 跳回底部 + 派发 scroll → 触发 loadNewerIncremental 补画缺口
  await evalJs(`(function(){var b=document.getElementById('chat-body');b.scrollTop=b.scrollHeight;b.dispatchEvent(new Event('scroll'));return 1;})()`);
  await sleep(600);
  await evalJs(WIGGLE);
  await sleep(500);
  const b1 = await evalJs(countTextJs('深翻测试消息一'));
  const b2 = await evalJs(countTextJs('B1夹具提问·勿改此文本'));
  check('B1 裁尾补画后脱尾消息不重画', b1 === 1 && b2 === 1, 'm=' + b1 + ' card=' + b2);

  const invB = JSON.parse(await evalJs(INVARIANT));
  check('C-B data-idx 无重复且时序递增', (!invB.err) && invB.dupIdx.length === 0 && invB.mono, JSON.stringify(invB));

  // B2 补画后回到底部，最后一条应是最新消息（时序未乱）
  const tailOk = JSON.parse(await evalJs(`(function(){
    var b=document.getElementById('chat-body');
    var ms=[].slice.call(b.querySelectorAll('.msg[data-idx]'));
    var lastIdx=parseInt(ms[ms.length-1].dataset.idx,10);
    return JSON.stringify({lastIdx:lastIdx,len:window.getChatMsgs().length});
  })()`));
  check('B2 补画后窗口终点对齐最新消息', tailOk.lastIdx >= tailOk.len - 3, JSON.stringify(tailOk));
}

chrome.kill();
server.close();
const pass = results.filter(r => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);

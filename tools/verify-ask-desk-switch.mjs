// ===== 回归脚本 #489：问问TA/邀请TA 回应落地时已切桌面＝回应被 sameCid() 永久取消 =====
// 用法：node tools/verify-ask-desk-switch.mjs
//       SERVE_ROOT=<隔离构建目录> node tools/verify-ask-desk-switch.mjs （预收口验证隔离构建）
// 复现路径（用户反馈「发送问问TA文字题，联系人已回答，切桌面再切回变成显示未回复」）：
//   发出文字题 → TA 回应在 1.5~4s 延迟 setTimeout 里落地 → 旧实现 if (!sameCid()) return
//   直接把回答取消：只要用户在延迟窗内切去别的联系人桌面，回答永远不来，卡片永远
//   「等待 TA 回答…」；邀请TA 同族（接受/拒绝/未回应决定同样被取消）。
//   修复：落地时已不在原桌面 → chatDeskCardReply 跨桌面补投递（按 ts 定位原桌面
//   pending 卡落 answered + 补回应气泡 + 提问记录补写）；发送时当场抽定回应内容
//   （防异桌面抽错联系人字卡池）；内存链路加 saveMsgsNow + 按 ts 重定位卡片。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root); // SERVE_ROOT=隔离构建目录；normalize 统一 Windows 分隔符，否则 403
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 70));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ask-desk-' + Date.now()),
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
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
// 打开聊天页并等待消息区就绪
async function enterChat() {
  await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return true; })()`);
  await sleep(900);
  for (let i = 0; i < 30; i++) { if (await evalJs(`(function(){try{return document.getElementById('chat-body').children.length>0;}catch(e){return false;}})()`)) break; await sleep(300); }
  await sleep(700);
}
// 读指定桌面 IDB 里互动卡的作答状态与回应气泡（ask 卡按 askQuestion、invite 卡按 inviteContent 匹配）
async function idbAskState(cid, q) {
  return JSON.parse(await evalJs(`(function(){
    return new Promise(function(resolve){
      window.idbGet('xy-home-v2:' + ${JSON.stringify(cid)} + ':chat-msgs').then(function(v){
        try {
          var arr = typeof v === 'string' ? JSON.parse(v) : (v || []);
          var card = null, bubble = false;
          for (var i = 0; i < arr.length; i++) {
            var m = arr[i];
            if (m && (m.askQuestion === ${JSON.stringify(q)} || m.inviteContent === ${JSON.stringify(q)})) {
              card = { status: m.askStatus || m.inviteStatus, a: m.askAnswer || m.inviteAnswer, invite: !!m.inviteContent };
            }
            if (card && card.a && m && m.side === 'in' && m.text === card.a) bubble = true;
          }
          resolve(JSON.stringify({ ok: true, card: card, bubble: bubble }));
        } catch (e) { resolve(JSON.stringify({ ok: false, err: e.message })); }
      }).catch(function(e){ resolve(JSON.stringify({ ok: false, err: String(e) })); });
    });
  })()`) || '{}');
}
// 屏上卡片状态（按题干匹配）
async function domCardState(q) {
  return JSON.parse(await evalJs(`(function(){
    var body = document.getElementById('chat-body');
    if (!body) return JSON.stringify({ none: true });
    var cards = body.querySelectorAll('.msg-ask');
    for (var i = 0; i < cards.length; i++) {
      var qEl = cards[i].querySelector('.msg-ask-q');
      if (qEl && qEl.textContent.indexOf(${JSON.stringify(q)}) >= 0) {
        return JSON.stringify({
          answered: !!cards[i].querySelector('.msg-ask-card.answered'),
          tip: (cards[i].querySelector('.msg-ask-tip') || {}).textContent || ''
        });
      }
    }
    return JSON.stringify({ none: true });
  })()`) || '{}');
}
// 通过半框发出一个问题/邀请，并在回应延迟窗内切去别的桌面
async function sendViaAskPanel(mode, text) {
  return await evalJs(`(function(){
    try {
      var more = document.getElementById(${JSON.stringify(mode)});
      if (!more) return 'no btn';
      more.click();
      var panel = document.getElementById('chat-ask-panel');
      if (!panel || panel.hidden) return 'panel hidden';
      var inp = document.getElementById('chat-ask-input');
      inp.value = ${JSON.stringify(text)};
      document.getElementById('chat-ask-ok').click();
      return 'sent';
    } catch (e) { return 'err:' + e.message; }
  })()`);
}

// ============ 场景 A（核心·修复前必红）：发出文字题 → 延迟窗内切走 → 切回应显示已回答 ============
{
  const cid = await evalJs(`window.createContact('问TA甲');`);
  check('A0 种子：创建联系人', !!cid, String(cid));
  await evalJs(`window.setActiveContact(${JSON.stringify(cid)}); true`);
  await sleep(500);
  await enterChat();
  const q = '切桌面丢失测试题';
  const sent = await sendViaAskPanel('more-ask', q);
  check('A1 发出文字题', sent === 'sent', String(sent));
  await sleep(300); // 立刻切走（远小于 1.5s 最低回应延迟 ⇒ 落地时必不在原桌面）
  await evalJs(`window.setActiveContact('default'); true`);
  await sleep(6000); // 越过整个 1.5~4s 延迟窗
  await evalJs(`window.setActiveContact(${JSON.stringify(cid)}); true`);
  await sleep(500);
  await enterChat();
  // 补投递是异步写（含读改写重试），切回后轮询等它落库上屏（上限 10s）；
  // 被修的 bug 是「永远未回复」，秒级延迟不判红
  const dom = await (async function pollA() {
    for (let i = 0; i < 33; i++) { const st = await domCardState(q); if (st.answered) return st; await sleep(300); }
    return domCardState(q);
  })();
  check('A2 切回后卡片显示已回答（旧版：永远等待 TA 回答…）', dom.answered === true, JSON.stringify(dom));
  const idb = await idbAskState(cid, q);
  check('A3 IDB 卡片已落 answered', idb.ok === true && idb.card && idb.card.status === 'answered', JSON.stringify(idb));
  check('A4 回应气泡已补投递到原桌面', idb.ok === true && idb.bubble === true, 'bubble=' + idb.bubble);
  const hist = JSON.parse(await evalJs(`(function(){ try { var l = JSON.parse(localStorage.getItem('xy-home-v2:' + ${JSON.stringify(cid)} + ':invite-ask-history') || '[]'); return JSON.stringify({ n: l.length, hit: l.some(function(x){ return x && x.q === ${JSON.stringify(q)} && x.a; }) }); } catch(e){ return '{}'; } })()`) || '{}');
  check('A5 提问记录已补写', hist && hist.hit === true, JSON.stringify(hist));
}

// ============ 场景 B（内存链路防回归）：发出 → 不切桌面 → 回答照常落地 ============
{
  const cid = await evalJs(`window.createContact('问TA乙');`);
  check('B0 种子：创建联系人', !!cid, String(cid));
  await evalJs(`window.setActiveContact(${JSON.stringify(cid)}); true`);
  await sleep(500);
  await enterChat();
  const q = '原地回答测试题';
  const sent = await sendViaAskPanel('more-ask', q);
  check('B1 发出文字题', sent === 'sent', String(sent));
  let answered = false;
  for (let i = 0; i < 25; i++) { const st = await domCardState(q); if (st.answered) { answered = true; break; } await sleep(300); }
  check('B2 原地等待回答照常落地', answered === true, JSON.stringify(await domCardState(q)));
}

// ============ 场景 C（同族·修复前必红）：邀请TA 发出 → 延迟窗内切走 → 切回应有决定 ============
{
  const cid = await evalJs(`window.createContact('邀TA丙');`);
  check('C0 种子：创建联系人', !!cid, String(cid));
  await evalJs(`window.setActiveContact(${JSON.stringify(cid)}); true`);
  await sleep(500);
  await enterChat();
  const q = '切桌面丢失邀请测试';
  const sent = await sendViaAskPanel('more-invite', q);
  check('C1 发出邀请', sent === 'sent', String(sent));
  await sleep(300);
  await evalJs(`window.setActiveContact('default'); true`);
  await sleep(6000);
  await evalJs(`window.setActiveContact(${JSON.stringify(cid)}); true`);
  await sleep(500);
  await enterChat();
  // 同 A2：轮询等补投递落库上屏（上限 10s）
  const dom = await (async function pollC() {
    for (let i = 0; i < 33; i++) { const st = await domCardState(q); if (st.answered) return st; await sleep(300); }
    return domCardState(q);
  })();
  check('C2 切回后邀请卡显示结果（旧版：永远等待 TA 回应…）', dom.answered === true, JSON.stringify(dom));
  const idbC = await idbAskState(cid, q);
  check('C3 IDB 邀请卡已落 answered（未回应形态无气泡属正常）', idbC.ok === true && idbC.card && idbC.card.status === 'answered', JSON.stringify(idbC));
}

// ============ 场景 D（双路防回归）：切走后快速切回（仍在延迟窗内）→ 回答照常落地 ============
{
  const cid = await evalJs(`window.createContact('问TA丁');`);
  check('D0 种子：创建联系人', !!cid, String(cid));
  await evalJs(`window.setActiveContact(${JSON.stringify(cid)}); true`);
  await sleep(500);
  await enterChat();
  const q = '快速切回测试题';
  const sent = await sendViaAskPanel('more-ask', q);
  check('D1 发出文字题', sent === 'sent', String(sent));
  await sleep(300);
  await evalJs(`window.setActiveContact('default'); true`);
  await sleep(700); // 仍在 1.5s 最低延迟窗内切回 ⇒ 落地时已在原桌面，走内存链路
  await evalJs(`window.setActiveContact(${JSON.stringify(cid)}); true`);
  await sleep(500);
  let answered = false;
  for (let i = 0; i < 25; i++) { const st = await domCardState(q); if (st.answered) { answered = true; break; } await sleep(300); }
  check('D2 快速切回后回答照常落地', answered === true, JSON.stringify(await domCardState(q)));
}

console.log('\n结果: PASS=' + pass + ' FAIL=' + fail + (process.env.SERVE_ROOT ? '（作用域：SERVE_ROOT=' + process.env.SERVE_ROOT + '）' : '（作用域：仓库根目录产品）'));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);

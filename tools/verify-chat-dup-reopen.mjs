// ===== 复现：iQOO Neo9 + Chrome（多机型同族）「同一条消息重复成多条」 =====
// 用户流程复述：聊天里同一条消息（我方发 + 联系人发）显示成多条；切换联系人再退出重进
// 就没了；但如果只是「退出聊天页面（回桌面）再进去」就又有。＝每次走权威读库 / 尾巴日志
// 回放链再复制一份。
// 本脚本在真实产物上按用户流程走，直接数 msgs 与屏上气泡：
//   A. 种入历史 → 进入聊天 → 退出聊天页（回桌面）→ 再进入 …重复 N 轮，观察条数是否增长
//   B. 种入「正文与尾巴日志不一致」的历史（归一化改写形态），看回放是否造出重复
// 用法：MOCHI_ROOT=<构建目录> node tools/verify-chat-dup-reopen.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('环境不满足：找不到 Chrome/Edge'); process.exit(2); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10010 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dupopen-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 400)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 801, deviceScaleFactor: 3.5, mobile: true });

const KEY = 'xy-home-v2:default:chat-msgs';

async function enterPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(600);
  const diag = await evalJs("(function(){return JSON.stringify({url:location.href.slice(0,60),ready:!!window.__mochiDataReady,idbSet:typeof window.idbSet,getChat:typeof window.getChatMsgs,splash:!!document.getElementById('splash')});})()");
  console.log('  [diag]', diag);
}

// 进聊天页 / 回桌面（用户「退出聊天页面再进去」），不重载页面
const goChat = `(function(){
  try { var app = document.querySelector('.app[data-app="chat"]'); if (app) { app.click(); return 'ok'; } return 'no-app'; }
  catch(e){ return 'err:'+e; }
})()`;
const goHome = `(function(){
  try { var b = document.getElementById('chat-back'); if (b) { b.click(); return 'ok'; } return 'no-back'; }
  catch(e){ return 'err:'+e; }
})()`;

// 统计：msgs 条数 / DOM 气泡数 / 同 ts+side+text 重复组
const stat = `(function(){
  try {
    var m = window.getChatMsgs() || [];
    var body = document.getElementById('chat-body');
    var domN = 0, liteN = 0;
    body.querySelectorAll('.msg').forEach(function(el,i){});
    // 只数消息节点（.msg 元素），时间分隔线/占位行不计
    try { domN = body.querySelectorAll('[data-idx]').length; } catch(e){}
    var seen = {}, dup = [];
    for (var i=0;i<m.length;i++){
      var r = m[i]; if(!r) continue;
      var k = (r.ts||0)+'|'+(r.side||'')+'|'+String(r.text||'').slice(0,60)+'|'+(r.special||'');
      if (seen[k]) { dup.push(k); } else seen[k]=1;
    }
    var seenD = {}, dupDom = [];
    try {
      var nodes = body.querySelectorAll('[data-idx]');
      for (var j=0;j<nodes.length;j++){
        var el=nodes[j]; var kk = (el.dataset.idx||'')+'|'+(el.className||'');
        if (seenD[kk]) dupDom.push(kk); else seenD[kk]=1;
      }
    } catch(e){}
    return JSON.stringify({ n: m.length, domN: domN, dup: dup.length, dupSample: dup.slice(0,3), dupDom: dupDom.length });
  } catch(e){ return JSON.stringify({ err: String(e) }); }
})()`;

async function doFlow(label) {
  const r = await evalJs(stat) || '{}';
  return JSON.parse(r);
}

// ===== 种子：历史 + 尾巴日志（模拟真机残留形态）=====
function seed(n) {
  const t = Date.now() - 600000;
  const recs = [];
  for (let i = 0; i < n; i++) {
    recs.push({ ts: t + i * 3000, side: i % 2 ? 'in' : 'out', text: '消息 ' + i });
  }
  return recs;
}

// ---------- 场景 A：普通历史，反复「退出聊天页→再进入」----------
await cdp('Page.navigate', { url: 'about:blank' });
await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
await enterPage();
{
  const recs = seed(1333);
  const okSeed = await evalJs(`(async function(){
    try {
      localStorage.setItem('${KEY}', ${JSON.stringify(JSON.stringify(recs))});
      await window.idbSet('${KEY}', ${JSON.stringify(JSON.stringify(recs))});
      return 'ok';
    } catch(e){ return 'err:'+e; }
  })()`);
  console.log('  种子写入:', okSeed);
}
await enterPage();

const counts = [];
let aDupFinal = null;
for (let round = 1; round <= 5; round++) {
  await evalJs(goChat); await sleep(1400);
  const s1 = await doFlow('enter' + round);
  counts.push(s1.n);
  aDupFinal = s1;
  console.log(`  第 ${round} 轮进入聊天: msgs=${s1.n} DOM=${s1.domN} 重复组=${s1.dup}`);
  await evalJs(goHome); await sleep(900);
}
// 注意：不能在流程中途判定「条数必须恒定」——TA 自动回复/定时消息会在任意一轮真实追加
// 合法新消息（实测同一构建多次跑得到 1335/1336/1341 三个不同的基线）。那不是重复 bug。
// 真正的不变量有两条：
//   ① 任意两轮之间**只增不减**（回放型 bug 会让条数停滞不降，但重复组会爆炸）；
//   ② 每一轮的**重复组必须为 0**（同 ts|side|text|special 在本轮不得出现第二条）。
//     ——这才是用户报的「只发了一条却显示成多条」。
const mono = counts.every((c, i) => i === 0 || c >= counts[i - 1]);
check('A1 反复进出聊天页条数只增不减（合法新消息可增；重复回放会叠加重复组）',
  mono, 'counts=' + JSON.stringify(counts));
check('A2 反复进出聊天页无重复组累积（末轮重复=0）',
  aDupFinal && aDupFinal.dup === 0, JSON.stringify(aDupFinal));

// ---------- 场景 B：正文被归一化改写（尾巴日志签名漂移）----------
// 真实形态：poke/图标类消息正文经 normCell 改写后，尾巴日志里的旧签名与 msgs 对不上
await cdp('Page.navigate', { url: 'about:blank' });
await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
await enterPage();
{
  const t = Date.now() - 300000;
  const bell = '<svg class="st-ico" viewBox="0 0 24 24"></svg>';
  // msgs（权威）里正文是「已改写」形态；尾巴日志里是「旧形态」——签名必然不含
  const msgsArr = [
    { ts: t + 1000, side: 'out', text: '早安' },
    { ts: t + 2000, side: 'in', text: 'ICON_TEL 拍了拍你', special: 'poke' },
    { ts: t + 3000, side: 'out', text: '在干嘛' },
    { ts: t + 4000, side: 'in', text: 'ICON_TEL 拍了拍你', special: 'poke' }
  ];
  const tailArr = [
    { ts: t + 2000, side: 'in', special: 'poke', text: '\u2709\uFE0F 拍了拍你', x: null },
    { ts: t + 4000, side: 'in', special: 'poke', text: '\u2709\uFE0F 拍了拍你', x: null }
  ];
  const okSeed = await evalJs(`(async function(){
    try {
      localStorage.setItem('${KEY}', ${JSON.stringify(JSON.stringify(msgsArr))});
      localStorage.setItem('xy-home-v2:default:chat-tail', ${JSON.stringify(JSON.stringify(tailArr))});
      await window.idbSet('${KEY}', ${JSON.stringify(JSON.stringify(msgsArr))});
      return 'ok';
    } catch(e){ return 'err:'+e; }
  })()`);
  console.log('  场景B 种子写入:', okSeed);
}
await enterPage();
const bCounts = [];
let bDupFinal = null;
for (let round = 1; round <= 4; round++) {
  await evalJs(goChat); await sleep(1500);
  const s = await doFlow('B' + round);
  bCounts.push(s.n);
  bDupFinal = s;
  console.log(`  场景B 第 ${round} 轮: msgs=${s.n} 重复组=${s.dup}`);
  await evalJs(goHome); await sleep(900);
}
// 场景B 是纯种子（无自动回复参与的固定 4 条），这里才允许要求「严格恒定」：
// 该场景的 msgs 不含任何会被归一化改写的正文吗——不，poke 正文就是 ICON_TEL 形态，
// 正是 #749 要拦的漂移源。若回放判重仍比正文，这里会从 4 涨到 6/8。
check('B1 签名漂移的历史不得在重进时回放重复（条数严格恒定）',
  bCounts.every(c => c === bCounts[0]), 'counts=' + JSON.stringify(bCounts));
check('B2 场景B 末轮无重复组', bDupFinal && bDupFinal.dup === 0, JSON.stringify(bDupFinal));

chrome.kill();
server.close();
console.log('----');
const pass = results.filter(r => r.ok).length;
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);

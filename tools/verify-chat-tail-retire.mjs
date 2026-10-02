// ===== 回归脚本 #766：聊天「一条消息莫名其妙变多条」=====
// 用法：node build.mjs && node tools/verify-chat-tail-retire.mjs
// 用户反馈（2026-08-25 首报、2026-09-18 再报）：「我和 TA 发的消息总会一条显示成多条，点发送那
// 一刻就两条，刷新还在，全部类型都有，有的手机有有的没有」。
//
// 两条独立根因（同一症状的两个来源，缺一仍复发）：
// ① 数据级＝尾巴日志（#180 <cid>:chat-tail）从不退休：条目即便早已随整包落进库，也永远留在日志
//    里；一旦某次「内存 msgs 比日志短」（#722 热片只装载尾部、某热块读失败留空洞、慢内核读超时退回
//    LS 有损快照、异步链里切了联系人而日志读的是对方命名空间、导入顶掉历史），chatTailMerge 就把
//    「不在内存」当成「不在库」再补一份，随后 saveMsgs 把它固化进库＝刷新还在。
//    修复＝命中即回收（chatTailRetire 走 store 层，同时更新内存/LS/IDB 三副本）＋早于装载窗口的
//    条目一律不回放（winFrom 闸门）＋日志与 msgs 必须同命名空间（forPrefix 闸门）。
// ② 渲染级＝renderMsg 的 data-idx 身份锚只在部分分支写（invite/ask/红包写了，poke·ask-msg/call/
//    rps/pong/brick/memory/snake 等提前 return 的分支从未写过），而缺口补画的幂等守卫查的是
//    `.msg[data-idx]`——这类节点既无 data-idx、类名又不是 .msg，双重查不到 ⇒ 同一条被原样再画一遍。
//    修复＝身份锚在创建节点时统一写入，所有按身份定位的选择器改纯属性形式（与类名彻底解耦）。
//
//  断言：
//  A 数据级：加几条消息→落盘→重载→再重载，逐身份（ts|side|special）比对条数不增份（日志被回收，
//    不会二次回放）。基线在首次重载后取，之后每次重载只允许「条数不变」，多一条即红。
//  B 寿命：一次成功权威读库后，chat-tail 里不应再留有「已在历史中」的条目（LS 与 IDB 两副本都空）。
//  C 渲染级：窗口内没有任何一个消息节点缺 data-idx（含 msg-poke/msg-rps/msg-center 等非 .msg 类节点，
//    时间分隔线除外），且深翻→脱尾→回底补画后各不重复（本脚本自带最小复现，不依赖 verify-chat-window-sync）。
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9820 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-tail-retire-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function connect() {
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await connect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const PFX = 'xy-home-v2:default';
const KEY = PFX + ':chat-msgs';
const TAIL = PFX + ':chat-tail';
function seed(n) {
  const t = Date.now() - n * 60000; const r = [];
  for (let i = 0; i < n; i++) r.push({ side: i % 2 ? 'in' : 'out', text: '历史#' + i, ts: t + i * 30000 });
  return JSON.stringify(r);
}
// 整体替换历史时，尾巴日志一并清零＝与本脚本的断言口径对齐（真实产品里这一步由导入流程负责）
async function bootWithSeed(n) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1800);
  const s = seed(n);
  const ok = await ev(`(async function(){ try {
    localStorage.setItem('${KEY}', ${JSON.stringify(s)});
    localStorage.removeItem('${TAIL}');
    await window.idbSet('${KEY}', ${JSON.stringify(s)});
    if (window.idbDelete) await window.idbDelete('${TAIL}');
    return true; } catch (e) { return false; } })()`);
  if (!ok) { console.error('种子写入失败'); process.exit(1); }
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await ev("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
  await sleep(600);
}
const tailLens = `(async function(){
  var lsN=0, idbN=-1;
  try { lsN = (JSON.parse(localStorage.getItem('${TAIL}')||'[]')||[]).length; } catch(e){ lsN=-2; }
  try { var v = await window.idbGet('${TAIL}'); var a = typeof v==='string'?JSON.parse(v||'[]'):v; idbN = Array.isArray(a)?a.length:0; } catch(e){ idbN=-2; }
  return JSON.stringify({ls:lsN, idb:idbN});
})()`;
// 整份历史的身份分布（ts|side|special → 条数），供 A3 做「重载前后逐身份比对」基线
const HIST = `(function(){
  var a = window.getChatMsgs ? window.getChatMsgs() : [], h = {};
  a.forEach(function(m){ var k = ((m&&m.ts)||0) + '|' + ((m&&m.side)||'') + '|' + ((m&&m.special)||''); h[k] = (h[k]||0)+1; });
  return JSON.stringify(h);
})()`;

// 某串文本在「数据」里有几条、在「DOM」里有几个节点
function occOf(txt) {
  return `(function(){ var t=${JSON.stringify(txt)};
    var d = window.getChatMsgs().filter(function(m){ return String(m&&m.text||'').indexOf(t)>=0; }).length;
    var dom = 0;
    var b=document.getElementById('chat-body');
    if (b) b.querySelectorAll('*').forEach(function(e){ if (e.parentElement===b && (e.textContent||'').indexOf(t)>=0) dom++; });
    return JSON.stringify({data:d, dom:dom});
  })()`;
}

// ---- A/B：尾巴日志寿命（命中即回收，不再二次回放） ----
await bootWithSeed(60);
await ev("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
await sleep(700);
const T1 = '回收测试甲' + Date.now(), T2 = '回收测试乙' + Date.now();
await ev(`window.chatAddIn(${JSON.stringify(T1)})`);
await ev(`window.chatAddOut ? window.chatAddOut(${JSON.stringify(T2)}) : window.chatSendMsg(${JSON.stringify(T2)})`);
await sleep(2500); // 等整包落盘（尾巴日志的条目此时已随历史进库）
const tAfterAdd = JSON.parse(await ev(tailLens) || '{}');
await cdp('Page.navigate', { url: baseUrl + '/index.html' }); // 重载＝跑一次权威读库 + chatTailMerge
await sleep(2400);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
await sleep(600);
await ev("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
await sleep(900);
const tAfterLoad = JSON.parse(await ev(tailLens) || '{}');
check('B1 权威读库后已落盘的日志条目被回收（LS 与 IDB 两副本都清）',
  tAfterLoad.ls === 0 && tAfterLoad.idb === 0, 'add后=' + JSON.stringify(tAfterAdd) + ' 读库后=' + JSON.stringify(tAfterLoad));
const o1 = JSON.parse(await ev(occOf(T1)) || '{}'), o2 = JSON.parse(await ev(occOf(T2)) || '{}');
check('A1 重载一次：两条测试消息各只有一条（数据与 DOM 都是 1）',
  o1.data === 1 && o1.dom === 1 && o2.data === 1 && o2.dom === 1, '甲=' + JSON.stringify(o1) + ' 乙=' + JSON.stringify(o2));
// 基线＝A1 之后（此刻历史里每条消息的条数分布已定型），下面再重载两次后逐身份比对
const hist0 = JSON.parse(await ev(HIST) || '{}');
// 再重载两次：回收过的日志不得再把任何条目回放成第二份
for (let r = 0; r < 2; r++) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2400);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await ev("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
  await sleep(500);
  await ev("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
  await sleep(700);
}
const o3 = JSON.parse(await ev(occOf(T1)) || '{}'), o4 = JSON.parse(await ev(occOf(T2)) || '{}');
check('A2 反复重载不增量成多条（旧缺陷：命中条目不退休→每次读库再回放一份）',
  o3.data === 1 && o3.dom === 1 && o4.data === 1 && o4.dom === 1, '甲=' + JSON.stringify(o3) + ' 乙=' + JSON.stringify(o4));
// A3＝按身份（ts|side|special）逐条比对「有没有比基线多一份」。
// 不用「全库无重复身份」这种绝对判据：产品自己会在开屏注入当日提醒，两条注入项可以同身份，
// 绝对判据会把正常产品行为误报成回归。#766 要证的是重载不会把已在库里的消息再复制一份。
const hist1 = JSON.parse(await ev(HIST) || '{}');
const grew = Object.keys(hist0).filter((k) => (hist1[k] || 0) > hist0[k]).map((k) => k + ' ' + hist0[k] + '→' + hist1[k]);
check('A3 重载后没有任何一条消息比基线多出副本（按 ts|side|special 身份逐条比对）',
  grew.length === 0, '身份数=' + Object.keys(hist1).length + ' 增多=' + JSON.stringify(grew.slice(0, 4)));

// ---- C：渲染级身份锚（非 .msg 类的特殊消息也要能被幂等守卫查到） ----
await bootWithSeed(900);
await ev("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
await sleep(500);
for (let r = 0; r < 14; r++) {
  await ev("(function(){var b=document.getElementById('chat-body');b.scrollTop=10;b.dispatchEvent(new Event('scroll'));return 1;})()");
  await sleep(260);
}
const TSYS = '锚点测试·系统提示' + Date.now();
const TTEXT = '锚点测试·文本' + Date.now();
await ev(`window.chatAddIn(${JSON.stringify(TTEXT)})`);
await sleep(250);
await ev(`window.chatAddSystem(${JSON.stringify(TSYS)},{special:'ask-msg'})`); // msg-poke：旧实现不带 data-idx
await sleep(250);
const noIdx = await ev(`(function(){
  var b=document.getElementById('chat-body'), n=0, cls=[];
  for (var i=0;i<b.children.length;i++){ var e=b.children[i];
    if (e.classList && e.classList.contains('msg-time-divider')) continue; // 唯一合法无下标节点
    if (!e.dataset || e.dataset.idx===undefined) { if (cls.indexOf(e.className||'(none)')<0) cls.push(e.className||'(none)'); n++; }
  }
  return JSON.stringify({noIdx:n, cls:cls.slice(0,6)});
})()`);
const nj = JSON.parse(noIdx || '{}');
check('C1 窗口内每个消息节点都带 data-idx 身份锚（时间分隔线除外；旧版 msg-poke 类节点无锚＝补画守卫查不到）', nj.noIdx === 0, JSON.stringify(nj));
await ev("(function(){var b=document.getElementById('chat-body');b.scrollTop=b.scrollHeight;b.dispatchEvent(new Event('scroll'));return 1;})()");
await sleep(600);
await ev("(function(){var b=document.getElementById('chat-body');b.scrollTop=b.scrollHeight-800;b.scrollTop=b.scrollHeight;return 1;})()");
await sleep(500);
const c2a = JSON.parse(await ev(occOf(TSYS)) || '{}');
const c2b = JSON.parse(await ev(occOf(TTEXT)) || '{}');
check('C2 脱尾补画后不重画（特殊消息旧版因无锚被画两遍＝用户看到的「一条变两条」）',
  c2a.dom === 1 && c2a.data === 1 && c2b.dom === 1 && c2b.data === 1, '系统提示=' + JSON.stringify(c2a) + ' 文本=' + JSON.stringify(c2b));
const dupIdx = await ev(`(function(){
  var b=document.getElementById('chat-body'), seen={}, dup=[];
  b.querySelectorAll('[data-idx]').forEach(function(e){ var k=e.getAttribute('data-idx'); seen[k]=(seen[k]||0)+1; });
  Object.keys(seen).forEach(function(k){ if(seen[k]>1) dup.push(k); });
  return JSON.stringify(dup);
})()`);
check('C3 DOM 内无任何 data-idx 重复', (() => { try { return JSON.parse(dupIdx).length === 0; } catch (e) { return false; } })(), 'dup=' + dupIdx);

chrome.kill(); server.close();
const pass = results.filter((r) => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);

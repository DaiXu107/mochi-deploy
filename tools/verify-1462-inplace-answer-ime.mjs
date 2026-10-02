// ===== 验证（#1462）：聊天互动卡「就地作答」提交前必须先收输入法 =====
// 症状（作者报，红米 K80 Chrome，明说其他机型也有）：在聊天里点开联系人发来的提问卡，
// 输入文字作答提交后，输入法自动收起得很慢（键盘位那半边灰底要晾很久才复原）。
// 根因：就地作答框 .ip-input（安卓已转 .ce-box）提交时刻持有焦点，chatAskReply 随后把
//   整张卡 el.innerHTML 换成「已回答」＝聚焦中的可编辑元素被「元素移除」带走，而不是
//   「失焦收起」——一批内核/输入法不为这种移除派 focusout、也不派 visualViewport.resize
//   → 移动适配收键盘链拿不到证据 → .phone 内联收缩高停在键盘期数值，只能等 2.2s 看门狗。
//   #512（问问TA/邀请TA半框）、#542（通用弹窗 close）已修前两处，就地作答这条路漏了。
// 修复契约（断言口径）：点【回答】后——
//   A1【核心】换「已回答」那一刻作答框已不持焦（blur 先于元素摘除；用 el.innerHTML
//      自有 setter 在设置瞬间同步读 activeElement，无微任务时序歧义）；
//   A2 提交后无文本元素持焦（键盘确已开始收起）；
//   A3 卡片照常变「已回答」且回答上屏（作答行为零回归）；
//   A4 向移动适配层报备过一次（mochiKbDismiss 恰被武装，#512 第二道口径同款）；
//   B1 键盘期（vv 收到 430 且此后不回基准）提交后 .phone 仍在有界窗口内复原满高（无灰底残留）。
// RED/GREEN 判别力：纯 HEAD 产物上 A1/A4 必红（旧代码既不 blur 也不报备）；B1 在无头环境
//   对 RED 可能假绿（无头内核在元素移除时会补派 focusout，真机问题内核不派——这正是要修的
//   内核差异本身，无头无法复刻），故 RED 判别以 A1/A4 为准，B1 只作 GREEN 无灰底端到端佐证。
// 手法：同 verify-ask-kb-dismiss——真实 visualViewport 实例盖可写 height＋焦点仿真；
//   作答提交用程序化 click（最坏情形：焦点不会因点击被内核带走）。
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
// RED 基线用：MOCHI_ARTIFACT=<其它 index.html 路径> 时改服务该产物（其余文件仍走工作区）
const ARTIFACT = process.env.MOCHI_ARTIFACT || '';
const server = createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (ARTIFACT && (urlPath === '/' || urlPath === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(ARTIFACT));
      return;
    }
    let p = normalize(join(root, urlPath));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1462-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS  ' + name + (extra ? '  [' + extra + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } }

await cdp('Page.enable'); await cdp('Runtime.enable');
// 无头 Chrome 默认「窗口无焦点」，blur() 不会派发 blur/focusout——焦点仿真打开后事件链与真机一致
try { await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) {}
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1000);
await evalJs(`(function(){var b=document.getElementById('splash-confirm-ok')||document.getElementById('splash-enter');if(b)b.click();return !!b;})()`);
await sleep(400);
for (let i = 0; i < 20; i++) {
  const r = await evalJs(`(function(){
    var m=document.getElementById('splash-mandatory'); if(!m||m.hidden) return 'none';
    var sc=document.getElementById('splash-mandatory-scroll'); if(sc) sc.scrollTop=sc.scrollHeight;
    var en=document.getElementById('splash-mandatory-enter');
    if(en&&!en.classList.contains('is-disabled')){en.click();return 'entered';} return 'wait';})()`);
  if (r === 'entered' || r === 'none') break;
  await sleep(250);
}
await evalJs(`(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}return true;})()`);
await evalJs(`(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()`);
await sleep(300);
// 页面级零异常计数
await evalJs(`(function(){ window.__errs=[]; window.addEventListener('error',function(e){window.__errs.push(String(e.message||e));}); return true;})()`);
// vv 补丁（键盘模拟）——真实实例盖可写 height，身份不变
await evalJs(`(function(){var vv=window.visualViewport;if(!vv.__patched){var h=vv.height;Object.defineProperty(vv,'height',{get:function(){return h;},configurable:true});window.__setVvHeight=function(v){h=v;vv.dispatchEvent(new Event('resize'));};vv.__patched=1;}return true;})()`);
// 报备计数器：包一层 mochiKbDismiss（真身照常执行）
await evalJs(`(function(){window.__realKbD=window.mochiKbDismiss;window.__dismissCalls=0;window.mochiKbDismiss=function(){window.__dismissCalls++;return window.__realKbD.apply(this,arguments);};return true;})()`);
// focusout 计数（对照用）
await evalJs(`(function(){window.__foCount=0;document.addEventListener('focusout',function(){window.__foCount++;},true);return true;})()`);

// 进聊天页
await evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return true;})()`);
await sleep(900);

// 种一张 TA 文字提问卡（同 ta-ask.js pushAsk 的注入形状：special 'ask-card' + askType 'text'）
async function seedCard(txt) {
  return evalJs(`(function(){
    var el=window.chatAddSystem('${txt}', { special:'ask-card', askQuestion:'${txt}', askOptions:null, askType:'text', askTs:Date.now() });
    return el?Number(el.dataset.idx):-1;})()`);
}
// 点卡就地展开，等作答框持焦
async function expandAndWaitFocus() {
  await evalJs(`(function(){
    var cards=document.querySelectorAll('.msg-ask');
    var el=cards[cards.length-1]; if(!el) return false;
    var c=el.querySelector('.msg-ask-card'); if(!c) return false;
    c.click(); return true;})()`);
  for (let i = 0; i < 15; i++) {
    const ok = await evalJs(`(function(){
      var w=document.querySelector('.msg-inplace'); if(!w) return false;
      var i=w.querySelector('input.ip-input'); if(!i) return false;
      var box=i.__ceBox||i; return document.activeElement===box;})()`);
    if (ok) return true;
    await evalJs(`(function(){var i=document.querySelector('.msg-inplace input.ip-input');if(i){var box=i.__ceBox||i;try{box.focus();}catch(e){}}return true;})()`);
    await sleep(120);
  }
  return false;
}

// 赋值带读回校验（ce-box value 代理偶发首拍未同步时重试，消首轮启动竞态假红）
async function setInputValue(v) {
  for (let i = 0; i < 10; i++) {
    await evalJs(`(function(){var i=document.querySelector('.msg-inplace input.ip-input');if(i)i.value='${v}';return true;})()`);
    const ok = await evalJs(`(function(){var i=document.querySelector('.msg-inplace input.ip-input');return !!i&&i.value==='${v}';})()`);
    if (ok) return true;
    await sleep(150);
  }
  return false;
}

// ============ A 组：契约核心（blur 先于元素摘除） ============
const idxA = await seedCard('验证1462的问题：今天过得怎么样');
check('A-1 前置：提问卡已种进聊天（ask-card 上屏）', idxA >= 0, 'idx=' + idxA);
const expA = await expandAndWaitFocus();
check('A0 前置：点卡就地展开且作答框（ce-box）持有焦点', expA,
  JSON.stringify(await evalJs(`(function(){var i=document.querySelector('.msg-inplace input.ip-input');return {has:!!i,ce:!!(i&&i.__ceBox),ae:document.activeElement?(document.activeElement.tagName+(document.activeElement.isContentEditable?'[ce]':'')):'none'};})()`)));
// 在作答卡 el 上挂自有 innerHTML setter：设置瞬间同步读 activeElement（无微任务歧义）
await evalJs(`(function(){
  var cards=document.querySelectorAll('.msg-ask'); var el=cards[cards.length-1];
  var d=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  window.__swapFocus='';
  Object.defineProperty(el,'innerHTML',{configurable:true,
    set:function(v){ try{var a=document.activeElement;window.__swapFocus=(a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable))?'focused':'blurred';}catch(e){window.__swapFocus='err';} d.set.call(this,v); },
    get:function(){ return d.get.call(this); }});
  return true;})()`);
check('A0-2 前置：回答文本写入并读回一致（ce-box value 代理通路）', await setInputValue('验证1462的回答文本'));
await evalJs('window.__dismissCalls=0; window.__foCount=0; true');
await evalJs(`(function(){var b=document.querySelector('.msg-inplace .ip-send');if(b)b.click();return !!b;})()`);
await sleep(500);
check('A1【核心】换「已回答」那一刻作答框已不持焦（blur 先于元素摘除）', await evalJs(`window.__swapFocus==='blurred'`), 'swap 时=' + await evalJs('window.__swapFocus||"(未触发)"'));
check('A2 提交后没有任何文本元素持有焦点（键盘确已开始收起）', await evalJs(`(function(){var a=document.activeElement;if(!a||a===document.body)return true;return !(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable);})()`), await evalJs(`(function(){var a=document.activeElement;return a?a.tagName:'none';})()`));
check('A3 卡片照常变「已回答」且回答上屏（作答零回归）', await evalJs(`(function(){var cards=document.querySelectorAll('.msg-ask');var el=cards[cards.length-1];return el&&el.innerHTML.indexOf('已回答')>=0&&el.innerHTML.indexOf('验证1462的回答文本')>=0;})()`));
check('A4 向移动适配层报备过一次（mochiKbDismiss 恰被武装）', await evalJs('window.__dismissCalls>=1'), 'calls=' + await evalJs('window.__dismissCalls'));

// ============ B 组：键盘期提交（vv 收缩不回基准）→ .phone 有界复原 ============
await seedCard('验证1462键盘期的问题');
const expB = await expandAndWaitFocus();
check('B0 前置：第二张卡就地展开且作答框持焦', expB);
check('B0-1 前置：键盘期回答文本写入并读回一致', await setInputValue('验证1462键盘期的回答'));
await evalJs('window.__setVvHeight(430)');
await sleep(650); // 键盘期读数先稳住（复原判据要求 vv 近期无变化）
const shrunkB = await evalJs(`document.querySelector('.phone').style.height||'(none)'`);
check('B0-2 键盘弹出（vv=430）时 .phone 收缩到键盘期高度', shrunkB === '430px', String(shrunkB));
await evalJs('window.__dismissCalls=0; window.__foCount=0; true');
await evalJs(`(function(){var b=document.querySelector('.msg-inplace .ip-send');if(b)b.click();return !!b;})()`);
await sleep(1600); // 越过 focusout 400ms 复查 / 兜底网 800ms 判定点＋一次 400ms 复查
const afterB = JSON.parse(await evalJs(`(function(){var p=document.querySelector('.phone');return JSON.stringify({h:p.style.height||'(none)',align:p.style.alignSelf||'(none)'});})()`));
check('B1 键盘期提交后 .phone 复原满高（内联收缩高已清＝键盘位无灰底残留）', afterB.h === '(none)' && afterB.align === '(none)', JSON.stringify(afterB) + ' fo=' + await evalJs('window.__foCount'));

// ============ E) 零异常 ============
const errs = JSON.parse((await evalJs('JSON.stringify(window.__errs)')) || '[]');
check('E1 全流程零脚本异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

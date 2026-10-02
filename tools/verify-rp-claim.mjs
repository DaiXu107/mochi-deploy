// #230 领取红包闪屏 行为验证（无头 Chrome，测构建产物 index.html）
// 立项：用户报障「领取红包会闪屏」，明说其他设备型号也有。
// 根因（src/js/chat.js）：领取/退回/TA领取/TA退回/自动领取五处红包状态流转一律
// renderWindow 整窗重建——body.innerHTML='' 后全部气泡（img 重新解码）＝肉眼整屏闪一下，
// #211/#220 同根因家族的最后一条未收口路径；领红包必经此处＝所有机型每次必闪
// （与机型、历史条数无关，#211/#220 的窗口闸都拦不到它）。
// 修复：新增 rpPatchStatusInPlace 原地补丁（只改该卡 opened/expired class+状态文案，
// 卡片尺寸不变无布局跳动），卡片不在渲染窗口时回退原整窗渲染。
// 判别器（与历史条数无关）：①点击前给 .msg-rp-card 节点打 __rpMark，领取后仍是同一节点
// ＝原地补丁；整窗重建会换成新节点（旧节点被移除）＝红。②MutationObserver 按「同一次
// 回调批次内既有移除又有新增」判整窗重建（原地补丁只改 class/text，childList 零事件；
// 后续 addIn 走 #211 增量追加只有新增）。
// 用法：node build.mjs && node tools/verify-rp-claim.mjs
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

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

const cdpPort = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vrp-' + Date.now()),
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 423, height: 896, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(800);

// —— 种入 30 条文字 + 1 张 TA 发的待领取红包（短历史同样复现：旧代码领取必整窗重建）——
const seeded = await evalJs(`(function(){
  if (!window.chatImportMsgs) return 'no-fn';
  var arr=[];var t=Date.now()-40*60000;
  for(var i=0;i<30;i++) arr.push({side:i%2?'in':'out',type:'text',text:'历史消息'+i,ts:t+i*60000});
  arr.push({side:'in',special:'redpacket',text:'',rpAmount:5.2,rpWish:'测试红包',rpStatus:'pending',rpTs:Date.now()});
  return String(window.chatImportMsgs(arr));
})()`);
ok(seeded === 'true', 'S0 种入 30 条文字 + 1 张待领取红包', String(seeded));
await sleep(2000);

// —— 冷启动重进（IDB/LS 已有种子），进聊天页 ——
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(600);
const entered = await evalJs('(function(){window.enterChat();return true;})()');
ok(entered === true, 'S1 进入聊天页', String(entered));
await sleep(1500);

// —— 观测器：#chat-body childList 按回调批次聚合（同批既有移除又有新增=整窗重建签名）
//    + 给红包卡片节点打 __rpMark（领取后同一节点=原地补丁；换节点=重建）——
const armRes = await evalJs(`(function(){
  var body=document.getElementById('chat-body');
  var card=body&&body.querySelector('.msg-rp-card');
  if(!card) return 'no-card';
  card.__rpMark=true;
  window.__vrp={rebuildBatches:0,addOnlyBatches:0,events:[]};
  var mo=new MutationObserver(function(recs){
    var add=0,rem=0;
    for(var k=0;k<recs.length;k++){add+=recs[k].addedNodes.length;rem+=recs[k].removedNodes.length;}
    if(rem>0&&add>0)window.__vrp.rebuildBatches++;
    if(rem===0&&add>0)window.__vrp.addOnlyBatches++;
    window.__vrp.events.push({add:add,rem:rem});
  });
  mo.observe(body,{childList:true,subtree:false});
  return 'ok';
})()`);
ok(armRes === 'ok', 'S2 观测器安装+卡片打标', String(armRes));

// —— #517 布防：把 #cc-toast 置为「干净未显示」态并记录它在领取瞬间的每一次变化 ——
// 用户要求「领取联系人发送的心意币红包，不需要显示黑色的红包提示弹窗」＝领取分支不再 toast。
// 采样必须贴着点击：老代码的 toast 2s 后自行隐藏，晚采样会采到已隐藏态＝假绿（本脚本踩过）。
await evalJs(`(function(){
  var t=document.getElementById('cc-toast');
  if(!t){t=document.createElement('div');t.id='cc-toast';document.body.appendChild(t);}
  t.className='cc-toast'; t.textContent='__unused__';
  window.__toastLog=[];
  var snap=function(tag){var e=document.getElementById('cc-toast');
    window.__toastLog.push(tag+' | '+(e?e.className:'absent')+' | '+(e?String(e.textContent||'').slice(0,34):''));};
  snap('arm');
  var mo=new MutationObserver(function(){snap('mut');});
  mo.observe(t,{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});
  [0,30,80,150,300,700,1400,2200,3000].forEach(function(ms){setTimeout(function(){snap('t+'+ms);},ms);});
  return true;
})()`);

// —— S3 点击领取红包 ——
await evalJs("(function(){var c=document.querySelector('.msg-rp-card');if(c)c.click();return true;})()");
await sleep(3000);

const st = await evalJs("(function(){var c=document.querySelector('.msg-rp-card');if(!c)return 'no-card';var s=c.querySelector('.msg-rp-status');return s?s.textContent:'';})()");
ok(st === '已领取', 'S3 领取后状态文案=已领取（行为正确性）', String(st));
const sameNode = await evalJs("(function(){var c=document.querySelector('.msg-rp-card');return !!(c&&c.__rpMark);})()");
ok(sameNode === true, 'S3 卡片节点未被重建（原地补丁=#230 核心；旧代码此处必红）', String(sameNode));
const vrp = JSON.parse(await evalJs('JSON.stringify(window.__vrp)') || '{}');
ok((vrp.rebuildBatches || 0) === 0, 'S3 领取零整窗重建（同批增删=0 批）', JSON.stringify(vrp.events || []).slice(0, 300));
ok((vrp.addOnlyBatches || 0) >= 1, 'S3 后续「你领取了红包」回执走增量追加（只有新增）', JSON.stringify(vrp.events || []).slice(0, 300));

// —— S4 静态断言：五处红包状态流转全部受原地补丁守卫，助手与 CSS 状态类在位 ——
const chatSrc = readFileSync(new URL('../src/js/chat.js', import.meta.url), 'utf8');
const cssSrc = readFileSync(new URL('../src/css/chat-main.css', import.meta.url), 'utf8');
ok(chatSrc.includes('function rpPatchStatusInPlace(idx)'), 'S4 原地补丁助手 rpPatchStatusInPlace 在位');
const guarded = ['rpPatchStatusInPlace(msgs.indexOf(rpRec))', 'rpPatchStatusInPlace(rpIdx)', 'rpPatchStatusInPlace(idx)'];
ok(guarded.every((g) => chatSrc.includes(g)), 'S4 领取/退回/TA领取/TA退回/自动领取五处全部走守卫');
ok(chatSrc.includes("if (!rpPatchStatusInPlace(rpIdx)) renderWindow(true, true);"), 'S4 用户领取路径守卫（报障主路径）');
ok(cssSrc.includes('.msg-rp-card.opened') && cssSrc.includes('.msg-rp-card.expired'), 'S4 CSS 状态类 opened/expired 在位（补丁目标）');

// —— S5（FIX 2026-09-15 #517）领取全程 #cc-toast 不得进入显示态，也不得被写入领取文案 ——
// 判别力实证（2026-09-15）：把 `toast('已领取' + amtTxt);` 临时塞回产物副本 → 本两条红，轨迹实录
// `mut | cc-toast show | 已领取（心意币 ¥5.20）`（＝用户报的黑浮层）；#517 后轨迹全程 `cc-toast | __unused__`。
const toastLog = await evalJs('JSON.stringify(window.__toastLog||[])');
const logArr = JSON.parse(toastLog || '[]');
const vShow = logArr.filter((x) => /\bshow\b/.test(x));
const vTxt = logArr.filter((x) => /已领取/.test(x));
console.log('  · #cc-toast 轨迹（前 5 帧）: ' + JSON.stringify(logArr.slice(0, 5)));
ok(vShow.length === 0, 'S5 领取全程 #cc-toast 未进入显示态（#517：黑浮层已移除）', JSON.stringify(vShow.slice(0, 3)));
ok(vTxt.length === 0, 'S5 领取全程未向 #cc-toast 写入「已领取…」文案', JSON.stringify(vTxt.slice(0, 3)));

console.log(fail ? ('FAIL ' + pass + '/' + (pass + fail)) : ('ALL PASS ' + pass + '/' + (pass + fail)));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);

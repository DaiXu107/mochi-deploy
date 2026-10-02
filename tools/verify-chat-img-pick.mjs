// #677 聊天页「插入图片」链路验证（无头 Chrome，测构建产物 index.html）
// 立项（用户 2026-09-17 报障，iPhone 13 Pro Max Safari＋主屏幕打开，明说其他机型也出现）：
//   「聊天页面发不了图片：添加了图片，但是会消失，无法发送到聊天里」。
// 根因（零机型分支的两处静默）：
//   ① file input 从未挂进文档就 click()——iOS Safari 对未挂载的 file input 不保证派发 change /
//      不保证带上 files（同文件「批量发送→图片」一直是挂到 body 再用，多机型正常）；
//   ② 失败面全静默：没有 reader.onerror、img 既不 onload 也不 onerror 时无超时、空 FileList 直接
//      return——读取/解码/没选到文件都表现为「什么都没有，控制台也没报错」。
// ===== #753（2026-09-18，同族第四波）新增 C 组断言 =====
// 用户（iPhone 13 Pro Max + Safari）复报：「聊天界面发不了图片，点插入图片打开的不是相册，是文件夹
// 管理页面」，明说其他设备型号也有。#677 只解决了「挂文档」；#717/#738 给头像五入口补了
// display:none→sr-only 与原生 label 兜底，**但两个聊天图片入口都没接上**。三个叠加原因：
//   ① 单聊仍写 display:none（#717/#738 点名要消灭的写法）；② 无 label 原生激活层；
//   ③ accept 未落在 click 之前——iOS 首次激活时 accept 尚未生效，退回通用文档选择器（Files），
//      相册不在候选里＝用户看到的「打开的文件夹管理页面」。C 组断言专盯这三条 + 双入口同口径。
// 用法：node build.mjs && node tools/verify-chat-img-pick.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-chat-img-pick.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vcip-' + Date.now()),
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 428, height: 926, deviceScaleFactor: 2, mobile: true });
// FIX 2026-09-21 #992：createElement 捕获钩子必须在**文档创建时**就装好——#992 起「插入图片」的
// 常驻 input 在绑定时机（脚本加载期）就建好，页面加载完才装的钩子抓不到它，B1~B5 会误报 no-input。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "window.__capIn=[];var _oce=document.createElement.bind(document);document.createElement=function(t){var el=_oce(t);if(String(t).toLowerCase()==='input')window.__capIn.push(el);return el;};" });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(400);

// 捕获 app 内部创建的 file input（钩子已在文档创建时装好，见上）
const baseInputs = J(await evalJs(`(function(){return JSON.stringify({n:document.querySelectorAll('body > input[type=file]').length});})()`));

// B1 点「插入图片」→ input 必须挂进文档（旧实现 detached）
await evalJs("(function(){document.getElementById('chat-img-btn').click();return true;})()");
await sleep(500);
const cap = J(await evalJs(`(function(){var inp=document.getElementById('chat-img-pick');var a=window.__capIn||[];return JSON.stringify({created:a.length,n:a.length,attached:!!(inp&&inp.parentNode),inBody:!!(inp&&inp.parentNode===document.body)});})()`));
ok(cap.created >= 1 && cap.inBody === true, 'B1 插入图片的常驻 file input 已在页面加载期/首次点按时建好并挂进文档（旧实现 detached ⇒ iOS 选完图不派发 change）', JSON.stringify(cap));

// B2 真图（1600×1200 JPEG）→ 压缩后进草稿条
const b2 = J(await evalJs(`(async function(){
  var inp=document.getElementById('chat-img-pick');if(!inp)return JSON.stringify({err:'no-input'});
  var c=document.createElement('canvas');c.width=1600;c.height=1200;
  var g=c.getContext('2d');var gr=g.createLinearGradient(0,0,1600,1200);gr.addColorStop(0,'#f00');gr.addColorStop(1,'#00f');
  g.fillStyle=gr;g.fillRect(0,0,1600,1200);
  var blob=await new Promise(function(r){c.toBlob(r,'image/jpeg',0.9);});
  var f=new File([blob],'photo.jpg',{type:'image/jpeg'});
  var dt=new DataTransfer();dt.items.add(f);
  inp.files=dt.files;
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(function(r){setTimeout(r,3000);});
  var items=document.querySelectorAll('#chat-draft-items .chat-draft-item');
  var src=items.length?items[0].querySelector('img').getAttribute('src'):'';
  return JSON.stringify({fileKB:Math.round(f.size/1024),items:items.length,srcLen:src.length,isJpeg:src.indexOf('data:image/jpeg')===0,draftHidden:document.getElementById('chat-draft').hidden});
})()`));
ok(b2.items === 1 && b2.isJpeg === true && b2.draftHidden === false, 'B2 选图后压缩进草稿条（真 JPEG → 720px 内 jpeg dataURL）', JSON.stringify(b2));

// B3 点发送 → 消息里带图片部件
const b3 = J(await evalJs(`(async function(){
  document.getElementById('chat-send').click();
  await new Promise(function(r){setTimeout(r,1500);});
  var msgs=window.getChatMsgs?window.getChatMsgs():[];
  var last=msgs.length?msgs[msgs.length-1]:null;
  var imgs=last&&last.parts?last.parts.filter(function(p){return p.k==='img';}):[];
  return JSON.stringify({msgsN:msgs.length,imgParts:imgs.length,draftItems:document.querySelectorAll('#chat-draft-items .chat-draft-item').length,bubbles:document.querySelectorAll('#chat-body .msg').length});
})()`));
ok(b3.imgParts >= 1 && b3.draftItems === 0, 'B3 发送后消息带图片部件、草稿条清空', JSON.stringify(b3));

// B4 空 FileList（iOS 选完没带上文件）→ 必须可见提示（旧实现静默 return）
const b4 = J(await evalJs(`(async function(){
  var inp=document.getElementById('chat-img-pick');if(!inp)return JSON.stringify({err:'no-input'});
  var t=document.getElementById('cc-toast');if(t)t.textContent='';
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(function(r){setTimeout(r,300);});
  var tt=document.getElementById('cc-toast');
  return JSON.stringify({toast:tt?tt.textContent:''});
})()`));
ok((b4.toast || '').indexOf('没有取到图片') >= 0, 'B4 没取到文件时给可见提示（旧实现静默无反应）', JSON.stringify(b4));

// B5 选到坏图（声明 image/png 但内容非法）→ 必须有可见提示；#1270 起「绝不静默丢图」不再等于
//   「把整张原图塞进草稿」：解码失败的图就此不进草稿（旧兜底＝照片越用越坏＋存储被撑爆同源复发）。
//   B5a 提示＝对照组（两侧皆绿，防把「如实说话」修没了）；B5b 不落草稿＝#1270 新契约（旧侧红）。
const b5 = J(await evalJs(`(async function(){
  var inp=document.getElementById('chat-img-pick');if(!inp)return JSON.stringify({err:'no-input'});
  var t=document.getElementById('cc-toast');if(t)t.textContent='';
  var f=new File([new Uint8Array([1,2,3,4,5,6,7,8,9,10])],'bad.png',{type:'image/png'});
  var dt=new DataTransfer();dt.items.add(f);inp.files=dt.files;
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  var tt=null;
  for(var i=0;i<40;i++){ await new Promise(function(r){setTimeout(r,150);}); tt=document.getElementById('cc-toast'); if(tt&&tt.textContent)break; }
  var items=document.querySelectorAll('#chat-draft-items .chat-draft-item');
  return JSON.stringify({toast:tt?tt.textContent:'',items:items.length});
})()`));
ok((b5.toast || '').length > 0, 'B5a 图片解码失败给可见提示（绝不静默丢图）', JSON.stringify(b5));
ok(b5.items === 0, 'B5b 解码失败这张不进草稿＝不再「按原图添加」兜底（#1270：旧兜底＝整张原图入库）', JSON.stringify(b5));

// B6 选择器不随点按堆积（常驻单个隐藏 input；基线含其他模块启动时就挂着的 file input）
await sleep(1500);
const b6b = J(await evalJs(`(function(){return JSON.stringify({leftover:document.querySelectorAll('body > input[type=file]').length});})()`));
ok(Number(b6b.leftover) <= Number(baseInputs.n) + 1, 'B6 点三次图片按钮后也只多一个常驻选择器（不随点按堆积）', JSON.stringify({ base: baseInputs.n, after: b6b.leftover }));

// ===== #753 C 组：原生 label 激活 + sr-only 形态 + accept 前置（相册 vs 文件管理器）=====
// 用独立的常驻选择器 id 精确定位（不再靠 __capIn 捕获顺序），并记录「激活那一刻的 accept」
const c2 = J(await evalJs(`(function(){
  var i=document.getElementById('chat-img-pick');
  if(!i)return JSON.stringify({err:'no-input'});
  var btn=document.getElementById('chat-img-btn');
  var l=btn?btn.querySelector('label[data-file-pick-for="chat-img-pick"]'):null;
  return JSON.stringify({
    has:true, conn:i.isConnected, accept:String(i.accept||''), multiple:!!i.multiple,
    disp:i.style.display||'', clip:String(i.style.clip||'').indexOf('rect')===0,
    opacity:i.style.opacity||'', cls:!!l, forId:l?l.htmlFor:'',
    nLabel: btn?btn.querySelectorAll('label[data-file-pick-for]').length:-1
  });
})()`));
ok(c2.has === true && c2.conn === true && c2.disp !== 'none' && c2.clip === true && c2.opacity === '1',
  'C1 单聊选择器常驻挂文档且为 sr-only clip 形态（display:none／opacity:0＝部分内核对不可见 input 拒绝激活；detached＝iOS 选完不派发 change）', JSON.stringify(c2));
ok(String(c2.accept) === 'image/*' && c2.multiple === true,
  'C2 单聊选择器 accept=image/* 且 multiple（accept 空/缺失＝弹出通用文件管理器，相册不在候选里）', JSON.stringify(c2));
ok(c2.cls === true && c2.forId === 'chat-img-pick' && c2.nLabel === 1,
  'C3 单聊图片按钮内有唯一原生 label 激活层指向该 input（无 label＝小米系分叉内核忽略 JS click 时点了没反应）', JSON.stringify(c2));

// C4 行为：真实点 label → 内核原生转发激活 input，且事件方跳过 JS 兜底（恰一次，不双开）
//   并在捕获监听里校验「激活那一刻 accept 已生效」——这正是 #753「弹出文件管理器而非相册」的判据
const probe = J(await evalJs(`(function(){
  window.__ci = { clicks: [] };
  if(!window.__ciHooked){
    window.__ciHooked = true;
    document.addEventListener('click', function(e){
      try{
        var t=e.target;
        if(t && t.tagName==='INPUT' && String(t.type).toLowerCase()==='file'){
          window.__ci.clicks.push({id:t.id||'',isFile:true,connected:!!t.isConnected,accept:String(t.accept||''),disp:t.style.display||'',clip:String(t.style.clip||'').indexOf('rect')===0});
        }
      }catch(err){}
    }, true);
  }
  return JSON.stringify({hooked:true});
})()`));
await evalJs(`(function(){
  var b=document.getElementById('chat-img-btn');
  var l=b&&b.querySelector('label[data-file-pick-for="chat-img-pick"]');
  if(l) l.click();
  return true;
})()`);
await sleep(320);
const afterClk = J(await evalJs(`(function(){var c=window.__ci.clicks;return JSON.stringify({n:c.length,last:c[c.length-1]||null});})()`));
ok(probe.hooked === true && afterClk.n === 1 && afterClk.last && afterClk.last.id === 'chat-img-pick'
  && afterClk.last.isFile === true && afterClk.last.connected === true,
  'C4 点 label → 原生转发激活单聊选择器（恰一次，事件方跳过 JS click 兜底＝同手势不双开）', JSON.stringify(afterClk));
ok(afterClk.last && String(afterClk.last.accept) === 'image/*',
  'C5【#753 核心】激活那一刻 accept 已生效为 image/*（accept 在 click 之后才设＝首次激活带空 accept 去问系统，iOS 退回文件管理器＝用户报「打开的是文件夹管理页面」）',
  JSON.stringify(afterClk.last));

// C6 群聊入口同口径（同一套模具，防止只修单聊）
const c6 = J(await evalJs(`(function(){
  var b=document.getElementById('gc-img-btn');
  if(!b)return JSON.stringify({err:'no-btn'});
  b.click();
  var i=document.getElementById('gc-img-pick');
  if(!i)return JSON.stringify({err:'no-input'});
  var l=b.querySelector('label[data-file-pick-for="gc-img-pick"]');
  return JSON.stringify({
    has:true, conn:i.isConnected, accept:String(i.accept||''), multiple:!!i.multiple,
    disp:i.style.display||'', clip:String(i.style.clip||'').indexOf('rect')===0,
    cls:!!l, forId:l?l.htmlFor:'', nLabel:b.querySelectorAll('label[data-file-pick-for]').length
  });
})()`));
await sleep(320);
ok(c6.has === true && c6.conn === true && String(c6.accept) === 'image/*' && c6.multiple === true
  && c6.disp !== 'none' && c6.clip === true && c6.cls === true && c6.forId === 'gc-img-pick' && c6.nLabel === 1,
  'C6 群聊图片选择器同口径（常驻挂文档 + sr-only clip + accept 前置 + 唯一 label 激活层）', JSON.stringify(c6));

// C7 行为：点群聊 label → 原生激活对应 input（恰一次）且 accept 已生效
const beforeG = J(await evalJs(`(function(){return JSON.stringify({n:(window.__ci.clicks||[]).length});})()`)).n;
await evalJs(`(function(){
  var b=document.getElementById('gc-img-btn');
  var l=b&&b.querySelector('label[data-file-pick-for="gc-img-pick"]');
  if(l) l.click();
  return true;
})()`);
await sleep(320);
const gcClk = J(await evalJs(`(function(){var c=window.__ci.clicks;return JSON.stringify({n:c.length,last:c[c.length-1]||null});})()`));
ok(gcClk.n === beforeG + 1 && gcClk.last && gcClk.last.id === 'gc-img-pick' && String(gcClk.last.accept) === 'image/*',
  'C7 点群聊 label → 原生转发激活对应选择器且 accept 已生效（恰一次）', JSON.stringify(gcClk));

// C8 幂等：反复点按钮不堆节点（每个入口恒 1 个 input + 1 个 label）
const c8 = J(await evalJs(`(function(){
  var b=document.getElementById('chat-img-btn');
  for(var i=0;i<5;i++) b.click();
  var g=document.getElementById('gc-img-btn');
  for(var j=0;j<5;j++) g.click();
  return JSON.stringify({
    chatInp:document.querySelectorAll('input[type=file]#chat-img-pick').length,
    gcInp:document.querySelectorAll('input[type=file]#gc-img-pick').length,
    chatLabel:b.querySelectorAll('label[data-file-pick-for]').length,
    gcLabel:g.querySelectorAll('label[data-file-pick-for]').length
  });
})()`));
await sleep(250);
ok(c8.chatInp === 1 && c8.gcInp === 1 && c8.chatLabel === 1 && c8.gcLabel === 1,
  'C8 两入口各连点 5 次仍只有 1 个选择器 + 1 个 label（防节点堆积、防 label 重复 insert）', JSON.stringify(c8));

const errs2 = await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()");
ok(String(errs2) === '[]' || String(errs2) === 'null', 'Z2 全程零 JS 异常（含 #753 C 组）', errs2);

const errs = await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()");
ok(String(errs) === '[]' || String(errs) === 'null', 'Z 全程零 JS 异常', errs);

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 聊天插入图片链路验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);

// #717 换头像「点导入图片没反应」链路验证（无头 Chrome，测构建产物 index.html）
// 立项（用户 2026-09-18 报障，小米8 实报、明说其他设备型号也有；#677 同族收尾）：
//   换头像时点「导入图片/添加头像」毫无反应、连系统相册都不弹。
// 根因（零机型分支）：头像导入还有三处是「点击时动态创建 input、未挂进文档就 click()」的
//   旧写法——红米/真我等 Android Edge 系对这种用法静默忽略（不弹选择器＝点了没反应）、
//   iOS Safari 对未挂载 input 不保证派发 change（#677 实锤）：桌面头像 personalize.js
//   bindAvatar、群聊头像 group-chat.js pickAvatarFile、朋友圈头像 feed.js coverAvEl；
//   另头像互动面板 avatar-lib.js bindPoolUpload 虽常驻挂 body 但用 display:none（老
//   WebView 对它同样可能不弹）且 click 无 try/catch（失败全静默）。
// 修复口径：四处统一到全站已验证套路（chat-settings.js headInput / chatcard.js pickFiles
//   同款）——常驻单个 input 永久挂 body、移出屏幕可见、复用前清 value、click 包 try/catch。
// 用法：node build.mjs && node tools/verify-avatar-pick-attached.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-avatar-pick-attached.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vapa-' + Date.now()),
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
// 在 app 脚本运行前装探针：登记每个创建的 input（createElement 时 type 还是空，点击时再判）
// + 记录每次程序化 click 的形态
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__fpick = { list: [], clicks: [] };
  var origCE = document.createElement.bind(document);
  document.createElement = function(t){
    var el = origCE(t);
    try{
      if (el && String(t).toLowerCase()==='input'){ el.__fpIdx = window.__fpick.list.length; el.__fpStack = String(new Error().stack||'').split('\\n').slice(1,3).join(' | '); window.__fpick.list.push(el); }
    }catch(e){}
    return el;
  };
  var origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function(){
    try{
      window.__fpick.clicks.push({
        idx: window.__fpick.list.indexOf(this),
        id: this.id || '',
        isFile: String(this.type).toLowerCase() === 'file',
        connected: !!this.isConnected,
        left: (this.style && this.style.left) || '',
        clip: (this.style && this.style.clip) || '',
        display: (this.style && this.style.display) || ''
      });
    }catch(e){}
    return origClick.call(this);
  };
})();
` });
await cdp('Emulation.setDeviceMetricsOverride', { width: 428, height: 926, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);

// 基线：加载期创建的 input 数（修复后含各模块常驻选择器；点击 idx < base = 加载期已存在＝常驻）
const base = J(await evalJs(`(function(){return JSON.stringify({n:window.__fpick.list.length, fileN:window.__fpick.list.filter(function(e){return String(e.type).toLowerCase()==='file';}).length, dom:document.querySelectorAll('input[type=file]').length});})()`));
ok(base.fileN >= 1, 'P0 加载期已有常驻 file input（修复前头像三处都是点击时才创建）', JSON.stringify(base));

// A1 桌面头像（#avatar-partner）：点的是加载期常驻、挂文档、移出屏幕（非 display:none）的 input
await evalJs("(function(){var e=document.getElementById('avatar-partner');if(e)e.click();return true;})()");
await sleep(300);
const a1 = J(await evalJs(`(function(){var c=window.__fpick.clicks;var r=c[c.length-1];return JSON.stringify(r||{none:true});})()`));
// #739 起 offscreen(-9999px) 换标准 sr-only clip 写法：位置断言二选一（旧离屏 or 新 clip+opacity:1）
const offOrSr = (r) => r.connected === true && r.display !== 'none' && (r.left === '-9999px' || (r.left === '0px' && String(r.clip).indexOf('rect') === 0));

ok(a1.idx != null && a1.idx >= 0 && a1.idx < base.n && a1.isFile === true && offOrSr(a1),
  'A1 桌面头像点击走「常驻+挂文档+移出屏幕」选择器（旧实现＝点击时新建 detached input ⇒ 红米/真我 Edge 不弹、iOS 不派发 change）', JSON.stringify({ click: a1, base: base.n }));

// A2 头像互动面板两个「添加头像」按钮：各自走常驻 offscreen 池选择器（id 按按钮唯一、可见形态非 display:none）
await evalJs("(function(){var a=document.getElementById('avlib-upload');if(a)a.click();return true;})()");
await sleep(250);
const a2a = J(await evalJs(`(function(){var c=window.__fpick.clicks;return JSON.stringify(c[c.length-1]||{none:true});})()`));
await evalJs("(function(){var a=document.getElementById('avlib-me-upload');if(a)a.click();return true;})()");
await sleep(250);
const a2b = J(await evalJs(`(function(){var c=window.__fpick.clicks;return JSON.stringify(c[c.length-1]||{none:true});})()`));
ok(a2a.id === 'avlib-upload-file-pick' && a2a.idx >= 0 && a2a.idx < base.n && a2a.isFile === true && offOrSr(a2a),
  'A2a 头像互动「添加头像」走常驻 offscreen 池选择器（旧实现 display:none ⇒ 老 WebView 点了没反应）', JSON.stringify(a2a));
ok(a2b.id === 'avlib-me-upload-file-pick' && a2b.idx >= 0 && a2b.idx < base.n && a2b.isFile === true && offOrSr(a2b) && a2b.idx !== a2a.idx,
  'A2b 「添加我的头像」同样走自己的常驻 offscreen 池选择器（两池各自常驻、不随点按新建）', JSON.stringify({ a2a: a2a.idx, a2b: a2b.idx }));

// A3 朋友圈头像（#feed-my-av）：常驻挂文档（旧实现点击时新建 detached input）
await evalJs("(function(){var e=document.getElementById('feed-my-av');if(e)e.click();return true;})()");
await sleep(300);
const a3 = J(await evalJs(`(function(){var c=window.__fpick.clicks;return JSON.stringify(c[c.length-1]||{none:true});})()`));
ok(a3.idx != null && a3.idx >= 0 && a3.idx < base.n && a3.isFile === true && offOrSr(a3),
  'A3 朋友圈头像点击走「常驻+挂文档+移出屏幕」选择器（旧实现 detached）', JSON.stringify({ click: a3, base: base.n }));

// A4 群聊头像 pickAvatarFile 是动态面板按钮（GUI 路径太深）→ 产物源断言：常驻挂文档初始化在位
// #860（PERF-PLAN 阶段 1b）：core 全外置后群聊头像初始化在 js/group-chat.js——
// 「产物含」判据改走全产物池（index.html + js/*.js），否则假红。
const srcOk = (function(){ try {
  let pool = readFileSync(join(root, 'index.html'), 'utf8');
  const jsDir = join(root, 'js');
  for (const f of readdirSync(jsDir)) if (f.endsWith('.js')) pool += '\n' + readFileSync(join(jsDir, f), 'utf8');
  return pool;
} catch (e) { return ''; } })();
ok(srcOk.includes('document.body.appendChild(gcAvatarPickInput);') && srcOk.includes("input.id = (btn.id || 'avlib') + '-file-pick';"),
  'A4 产物含群聊头像常驻选择器初始化 + 池选择器身份（#717b/#717d 锚点）', '');

// A5 点按不堆积：三轮点击后 DOM 里 file input 总数不涨（旧实现 feed 每点一次永久多一个 detached input）
const domAfter = J(await evalJs(`(function(){return JSON.stringify({dom:document.querySelectorAll('input[type=file]').length});})()`));
ok(Number(domAfter.dom) === Number(base.dom), 'A5 三轮头像点击后 file input 数量不涨（常驻复用，不随点按堆积）', JSON.stringify({ before: base.dom, after: domAfter.dom }));

// A6 管线不回归：给桌面头像选择器喂真 JPEG → 压缩落库 + 桌面圆圈出图（改选择器壳不能碰坏压缩管线）
// （用 64×64 小图：断言的是 change→FileReader→压缩→落库的接线；无头环境对大图解码可能挂起，与机型行为无关）
const a6 = J(await evalJs(`(async function(){
  var box=document.getElementById('avatar-partner');if(box)box.click(); // 重设一次回调（与 A1 同路径）
  await new Promise(function(r){setTimeout(r,200);});
  var cl=window.__fpick.clicks;var rec=cl[cl.length-1];
  var inp=(rec&&rec.idx>=0)?window.__fpick.list[rec.idx]:null;if(!inp)return JSON.stringify({err:'no-input',rec:rec});
  var cv=document.createElement('canvas');cv.width=64;cv.height=64;
  var g=cv.getContext('2d');var gr=g.createLinearGradient(0,0,64,64);gr.addColorStop(0,'#f0a');gr.addColorStop(1,'#0af');
  g.fillStyle=gr;g.fillRect(0,0,64,64);
  var blob=await new Promise(function(r){cv.toBlob(r,'image/jpeg',0.9);});
  var dt=new DataTransfer();dt.items.add(new File([blob],'av.jpg',{type:'image/jpeg'}));
  inp.files=dt.files;
  var preLen=inp.files.length;
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  var postLen=inp.files.length;
  window.__rej=[];
  window.addEventListener('unhandledrejection', function(ev){ window.__rej.push(String((ev.reason&&ev.reason.stack)||ev.reason).slice(0,400)); });
  window.__tdr=[];
  try{
    var otdr=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=function(){window.__tdr.push(String(arguments[0]||'')+':'+String(arguments[1]||''));return otdr.apply(this,arguments);};
  }catch(e){}
  await new Promise(function(r){setTimeout(r,3000);});
  var img=document.querySelector('#avatar-partner .ring img');
  var ring=document.querySelector('#avatar-partner .ring');
  var boxNow=document.getElementById('avatar-partner');
  return JSON.stringify({preLen:preLen,postLen:postLen,tdr:window.__tdr,ringImg:!!img,srcLen:img?img.getAttribute('src').length:0,
    boxN:document.querySelectorAll('#avatar-partner').length,boxConn:boxNow?boxNow.isConnected:null,ringIsInBox:!!(boxNow&&ring&&boxNow.contains(ring)),
    ringHtml:ring?ring.innerHTML.slice(0,150):'(no-ring)',rej:window.__rej});
})()`));
ok(a6.ringImg === true && a6.srcLen > 100, 'A6 选真图后压缩落库、桌面头像圆圈出图（管线不回归）', JSON.stringify(a6));

const errs = await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()");
ok(String(errs) === '[]' || String(errs) === 'null', 'Z 全程零 JS 异常', errs);

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 头像图片选择器常驻挂文档验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);

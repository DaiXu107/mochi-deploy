// #739 头像导入「点了没反应」第三波根治验证——原生 label 激活（无头 Chrome，测构建产物 index.html）
// 立项（用户 2026-09-18 小米17 Pro MiuiBrowser 20.21 实报，三入口全灭、明说其他机型也有；#677/#717 同族）：
//   #717 的「常驻挂文档 input + 程序化 click()」在小米系分叉内核上仍被静默忽略——线上 08:16 包
//   已含 #717 仍复现，实锤 JS 合成 click 路径在该类内核不灵。
// 修复口径：device.js 共享助手 mochiFilePickLabel——透明 <label for=inputId> 铺满触发按钮内部，
//   用户物理点在 label 上由内核按 HTML 原生行为转发激活 input；JS click 保留兜底
//   （事件来自 label 时 mochiFilePickFromLabel 跳过，防同一手势双开）；input 统一 sr-only clip 样式。
// 用法：node build.mjs && node tools/verify-file-pick-label.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-file-pick-label.mjs
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vfpl-' + Date.now()),
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
// 探针：label 原生转发激活＝在 input 上「派发 click 事件」（不走 prototype.click 方法调用），
// JS 合成 click 则两者皆有——统一用 document 捕获监听记录「到达 file input 的 click 事件」，
// 两条路径都能被看到；label 转发事件的冒泡路径是 body→document（input 挂 body），不经过触发按钮。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__lbl = { clicks: [] };
  document.addEventListener('click', function(e){
    try{
      var t = e.target;
      if (t && t.tagName === 'INPUT' && String(t.type).toLowerCase()==='file') {
        window.__lbl.clicks.push({ id: t.id || '', isFile: true, connected: !!t.isConnected, t: Date.now() });
      }
    }catch(e){}
  }, true);
})();
` });
await cdp('Emulation.setDeviceMetricsOverride', { width: 428, height: 926, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);

const snap = `(function(){return JSON.stringify({n:window.__lbl.clicks.length,last:window.__lbl.clicks[window.__lbl.clicks.length-1]||null});})()`;

// B1 桌面头像框内存在 label 激活层：htmlFor 指向常驻 input、铺满按钮（helper 幂等不重复插）
const b1 = J(await evalJs(`(function(){
  var box=document.getElementById('avatar-partner');if(!box)return JSON.stringify({err:'no-box'});
  var ls=box.querySelectorAll('label[data-file-pick-for]');
  var l=ls[0];if(!l)return JSON.stringify({err:'no-label',n:ls.length});
  var inp=document.getElementById('mochi-avatar-pick');
  return JSON.stringify({n:ls.length,forId:l.htmlFor,hasInp:!!inp,inpConn:inp?inp.isConnected:null,
    op:inp?inp.style.opacity:'',clip:inp?String(inp.style.clip).indexOf('rect')===0:false,disp:inp?inp.style.display:''});
})()`));
ok(b1.n === 1 && b1.forId === 'mochi-avatar-pick' && b1.hasInp === true && b1.inpConn === true,
  'B1 桌面头像框内 label 激活层唯一且指向常驻 input（无 label＝小米系分叉内核点了没反应回归）', JSON.stringify(b1));
ok(b1.op === '1' && b1.clip === true && b1.disp !== 'none',
  'B2 常驻 input 为 sr-only clip 形态（opacity:1+clip，非 display:none/opacity:0——「不可见元素拒绝激活」类启发式免疫）', JSON.stringify(b1));

// B3 行为断言：真实点击 label（最顶层接收点按的元素）→ 内核原生转发激活 input，且事件方跳过 JS 兜底（恰好一次激活）
const before3 = J(await evalJs(snap)).n;
const b3 = J(await evalJs(`(async function(){
  var box=document.getElementById('avatar-partner');if(!box)return JSON.stringify({err:'no-box'});
  var l=box.querySelector('label[data-file-pick-for]');if(!l)return JSON.stringify({err:'no-label'});
  l.click();
  await new Promise(function(r){setTimeout(r,250);});
  var top=document.elementFromPoint?null:null;
  return JSON.stringify({ok:true});
})()`));
const after3 = J(await evalJs(snap));
ok(b3.ok === true && after3.n === before3 + 1 && after3.last && after3.last.isFile === true && after3.last.connected === true && String(after3.last.id) === 'mochi-avatar-pick',
  'B3 点 label → 内核原生转发激活 file input（恰一次，事件方跳过 JS click 兜底＝同手势不双开）', JSON.stringify({ before: before3, after: after3 }));

// B4 头像互动池两按钮 + 朋友圈头像：各含自己的 label 层；点 label 同样原生激活对应 input
const b4 = J(await evalJs(`(function(){
  function probe(btnId, forId){
    var btn=document.getElementById(btnId);if(!btn)return {err:'no-btn:'+btnId};
    var l=btn.querySelector('label[data-file-pick-for="'+forId+'"]');if(!l)return {err:'no-label:'+btnId};
    return {btn:btnId,forId:l.htmlFor};
  }
  return JSON.stringify([
    probe('avlib-upload','avlib-upload-file-pick'),
    probe('avlib-me-upload','avlib-me-upload-file-pick'),
    (function(){var el=document.getElementById('feed-my-av');if(!el)return {err:'no-feed-av'};
      var l=el.querySelector('label[data-file-pick-for="feed-av-pick"]');if(!l)return {err:'no-feed-label'};
      return {btn:'feed-my-av',forId:l.htmlFor};})()
  ]);
})()`));
const b4arr = Array.isArray(b4) ? b4 : [];
ok(b4arr.length === 3 && b4arr.every((x) => x.btn && x.forId && !x.err),
  'B4 头像互动两池按钮＋朋友圈头像各含自己的 label 激活层（for 按按钮唯一）', JSON.stringify(b4));

const before5 = J(await evalJs(snap)).n;
await evalJs("(function(){var a=document.getElementById('avlib-upload');var l=a&&a.querySelector('label[data-file-pick-for]');if(l)l.click();return true;})()");
await sleep(250);
const after5 = J(await evalJs(snap));
ok(after5.n === before5 + 1 && after5.last && after5.last.id === 'avlib-upload-file-pick' && after5.last.isFile === true && after5.last.connected === true,
  'B5 点「添加头像」的 label → 原生激活对应池选择器（常驻、挂文档）', JSON.stringify({ before: before5, after: after5 }));

// B6 开屏「安卓·请勿使用自带浏览器」指引在位（用户直派「安卓不建议自带浏览器」）
// 2026-10-01 用户直派「收进【Mochi字卡 · 开屏说明】新增目录」：原必读组警示卡撤除，内容改由公告目录第 4 章
//   「浏览器兼容提醒（安卓用户必读）」承载（在线 notice.json 与模板静态兜底两份同标题），本断言改判目录章在位
//   （原断言在 #splash-notice 里找必读组卡，#976 搬卡起即失配属存量红，本次随卡退役一并转正）
const b6 = J(await evalJs(`(function(){
  var secs=[].slice.call(document.querySelectorAll('.splash-sec-wrap > .splash-sec'));
  var h=secs.filter(function(s){return s.textContent.indexOf('浏览器兼容提醒')>=0;})[0];
  if(!h)return JSON.stringify({err:'no-sec'});
  var body=h.parentNode.textContent||'';
  return JSON.stringify({title:h.textContent.trim(),hasTip:body.indexOf('自带浏览器')>=0&&body.indexOf('Chrome')>=0});
})()`));
ok(b6.title && b6.title.indexOf('浏览器兼容提醒') >= 0 && b6.hasTip === true,
  'B6 开屏公告目录第 4 章「浏览器兼容提醒（安卓用户必读）」在位且含自带浏览器/Chrome 指引', JSON.stringify(b6));

const errs = await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()");
ok(String(errs) === '[]' || String(errs) === 'null', 'Z 全程零 JS 异常', errs);

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 文件选择器原生 label 激活验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);

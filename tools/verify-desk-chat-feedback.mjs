// ===== 回归脚本：#703 聊天冷进「没有加载缓冲动画、卡几秒」+ #704 表情包面板大库「每次打开所有图片重新加载」 =====
// 用法：node tools/verify-desk-chat-feedback.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// #703 背景（用户直派）：切桌面后点开聊天，没有加载缓冲动画、看起来卡几秒。
//   根因：切桌面后 LS 尾部快照先把 msgs 填上几条 → updateChatLoading 的「!msgs.length」前置把
//   进度条压掉；权威大包继续读数秒，到达时 200 气泡+百张图集中渲染解码（无头 4× 节流实证：
//   进度条全程未显示、803ms 长任务）＝零反馈的「卡几秒」。
//   修复：进度条条件去掉 msgs 前置（聊天页可见且权威未就绪即显示）；enterChat 先置位再 loadMsgs；
//   权威读库收尾补一次收起。
// #704 背景（用户直派）：表情包面板 #662/#692 后真机每次打开仍「所有图片重新加载」。
//   根因：emojiShowWhenDecoded 对面板全部 img[src] await decode，大库几十上百张在低内存机型
//   隐藏期被回收位图，总解码远超 1s 兜底＝兜底放行后剩余图逐张冒出（1s 兜底在大库机型是常规
//   路径而非保险）。修复：首屏优先——前 16 张 data-src 同步补 src；按 DOM 序前 24 张 await
//   decode 后即显示；其余 fire-and-forget 预热不挡显示。
// 判据：
//   A 轴（源码锚）：进度条条件 / enterChat 顺序 / 权威收尾收起 / 首屏解码上限与预热分支。
//   B 轴（真实产物 390×844，Android UA，CPU 4× 节流，decode 注入 40ms 人工延迟）：
//     B1 切桌面→点聊天：进度条在 400ms 内出现（修前全程不显示）
//     B2 权威渲染完成后（200 气泡在屏）进度条最终收起（不挂死）
//     B3 功能不回归：权威记录真的渲染出来（200 条）
//     B4 【#704 判别力核心】首开面板（img 只带 data-src）：显示时首屏 12 张已全部解码
//        （修后显示即完整；修前立即显示、首屏经 50ms/4 张懒加载泵逐张冒出＝「所有图片重新加载」）
//     B5 首开面板 2.5s 内可见（解码等待有 1s 兜底封顶）
//     B6 大库关→重开：节点零替换、零 load（#457/#662 回收池未回退）
//   Z 轴：全程零 JS 异常。
// RED 基线（HEAD 的 src/js/chat.js）：B1 红（进度条全程不显示）、B5 红（首屏空图）、B6 可能红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)));
const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();
const root = normalize(process.env.MOCHI_ROOT || argRoot || join(here, '..'));

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- A 轴：源码锚 ----------
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
console.log('A 轴（源码作用域）   root=' + root);
chk('A1 进度条条件去掉「msgs 为空」前置（#703）', chatSrc.includes('chatLoadingEl.hidden = !(chatVisible() && !chatDbReady && !chatKnownEmpty);'));
chk('A2 enterChat 先置位进度条再 loadMsgs（#703）', chatSrc.includes('updateChatLoading(); // #703：先于 loadMsgs 置位'));
chk('A3 权威读库收尾收起进度条（#703）', chatSrc.includes('// #703：权威就绪即收起进度条'));
chk('A4 面板显示只等首屏解码（#704 EMOJI_DECODE_AWAIT_MAX）', chatSrc.includes('const EMOJI_DECODE_AWAIT_MAX = 24;'));
chk('A5 首屏外图 fire-and-forget 预热不挡显示（#704）', chatSrc.includes('im.decode().catch(function () {}); } catch (e) {} // #704：首屏外只预热不等待'));

// ---------- B 轴：真实产物 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }
if (!existsSync(join(root, 'index.html'))) { console.error('no index.html in ' + root); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const profile = join(process.env.TEMP || '/tmp', 'mochi-v703-' + Date.now());
const cdpPort = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) {
    const ex = r.exceptionDetails;
    console.error('JS exception:', (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text);
    return null;
  }
  return r && r.result ? r.result.value : null;
}
function cleanup(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(code);
}

const mkImg = (n) => 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="hsl(' + (n * 37) + ',70%,55%)"/><text x="20" y="100" font-size="64" fill="white">' + n + '</text><!--' + 'x'.repeat(7000) + '--></svg>').toString('base64');
const G1 = Array.from({ length: 60 }, (_, i) => mkImg(i));

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2.75, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(600);

// 种子：桌面 c2 = 200 条（100 图）+ LS 尾部快照 6 条；字卡库 G1=60 张（大库形态）
const seed = await evalJs(`(async function(){
  var IMG = ${JSON.stringify(Array.from({ length: 20 }, (_, i) => mkImg(100 + i)))};
  var out = []; var now = Date.now();
  for (var i = 0; i < 200; i++) {
    var w = i % 2 === 0;
    out.push(w ? {side:'out',ts:now-(200-i)*60000,text:IMG[i%IMG.length],parts:[{k:'img',v:IMG[i%IMG.length]}]}
               : {side:'in',ts:now-(200-i)*60000,text:'回复 '+i,parts:[{k:'text',v:'回复 '+i}]});
  }
  var jmsg = JSON.stringify(out);
  var g = {text:[],kaomoji:[],emoji:[],sticker:[['G1',${JSON.stringify(G1)}]],image:[],poke:[],voice:[]};
  var jg = JSON.stringify(g);
  window.xyStore('xy-home-v2').set('contacts', JSON.stringify([{id:'default',name:'默认'},{id:'c2',name:'桌面B'}]));
  window.xyStore('xy-home-v2').set('cc-scope-migrated', '1');
  window.xyStore('xy-home-v2:c2:').set('cc-groups', jg);
  window.xyStore('xy-home-v2:c2:').set('chat-meta', JSON.stringify({n:200,b:jmsg.length}));
  window.xyStore('xy-home-v2:c2:').set('chat-msgs', jmsg);
  window.xyStore('xy-home-v2').set('emoji-last', JSON.stringify({mode:'ta',ta:'G1',mine:'',pub:'',cat:'sticker'}));
  if (window.idbSet) {
    try { await window.idbSet('xy-home-v2:c2:cc-groups', jg);
          await window.idbSet('xy-home-v2:c2:chat-meta', JSON.stringify({n:200,b:jmsg.length}));
          await window.idbSet('xy-home-v2:c2:chat-msgs', jmsg); } catch (e) {}
  }
  try { localStorage.setItem('xy-home-v2:c2:chat-msgs', JSON.stringify(out.slice(-6))); } catch (e) {}
  return 'seeded';
})()`);
await sleep(1200);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1200);

// 注入：decode 人工延迟 40ms（贴近真机大图解码成本；无注入时无头 decode 近零成本测不出 #704）
await evalJs(`(function(){
  var dec = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () {
    var p = dec.apply(this, arguments);
    var t0 = Date.now();
    var r = p.then(function (x) { return new Promise(function (res) { setTimeout(function () { res(x); }, Math.max(0, 40 - (Date.now() - t0))); }); });
    r.catch && r.catch(function () {});
    return r;
  };
  window.__v = { loads: 0 };
  document.addEventListener('load', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.closest && t.closest('#emoji-list')) window.__v.loads++;
  }, true);
  return 1; })()`);

// ---- B1~B3 切桌面 → 点聊天：进度条出现 + 最终收起 + 记录渲染 ----
await evalJs("(function(){window.setActiveContact('c2');return 1;})()");
await sleep(80);
const tl = await evalJs(`(async function(){
  var t0 = performance.now();
  var b = document.querySelector('.app[data-app="chat"]'); if (b) b.click();
  var firstShow = -1, lastShown = -1, endMsgs = 0, tEnd = 0;
  for (var i = 0; i < 60; i++) {
    var el = document.getElementById('chat-loading');
    var shown = !!(el && !el.hidden);
    if (shown && firstShow < 0) firstShow = Math.round(performance.now() - t0);
    if (shown) lastShown = Math.round(performance.now() - t0);
    endMsgs = document.querySelectorAll('#chat-body .msg').length;
    tEnd = Math.round(performance.now() - t0);
    if (i > 8 && endMsgs >= 200 && !shown) break;
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  return JSON.stringify({ firstShow: firstShow, lastShown: lastShown, msgs: endMsgs, t: tEnd });
})()`);
const j1 = tl ? JSON.parse(tl) : {};
chk('B1 切桌面→点聊天：进度条在 400ms 内出现（修前全程不显示＝主诉）', j1.firstShow >= 0 && j1.firstShow <= 400, tl);
chk('B2 权威渲染完成后进度条收起（不挂死）', j1.msgs >= 200 && j1.lastShown >= 0 && j1.lastShown < j1.t, tl);
chk('B3 功能不回归：权威 200 条记录渲染出来', j1.msgs >= 200, 'msgs=' + j1.msgs);

// ---- B4~B6 表情包面板（60 张大库 + decode 延迟注入） ----
// B4【#704 判别力核心】首开：面板所有 img 只带 data-src（懒加载泵 50ms/4 张补 src）。
//   修前：显示不等解码（无 img[src] → 立即 show）＝面板开着、首屏逐张冒出（decode 排队
//   在泵后面）＝用户看到的「每次打开所有图片重新加载」；修后：首屏 16 张同步补 src、
//   await 前 24 张 decode 后才显示＝显示即首屏完整。
await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return 1;})()");
const first = await evalJs(`(async function(){
  var t0 = performance.now();
  var shownAt = -1, firstRowOk = -1;
  for (var i = 0; i < 40; i++) {
    var p = document.getElementById('emoji-panel');
    if (p && !p.hidden && shownAt < 0) {
      shownAt = Math.round(performance.now() - t0);
      var imgs = document.querySelectorAll('#emoji-list img');
      var f = 0; for (var k = 0; k < Math.min(12, imgs.length); k++) { if (imgs[k].naturalWidth > 0) f++; }
      firstRowOk = f;
      break;
    }
    await new Promise(function (r) { setTimeout(r, 50); });
  }
  return JSON.stringify({ shownAt: shownAt, firstRowOk: firstRowOk });
})()`);
const jf = first ? JSON.parse(first) : {};
chk('B4 【#704 核心】首开面板显示时首屏 12 张已全部解码（修后显示即完整；修前立即显示、首屏逐张冒出）', jf.firstRowOk === 12, first);
chk('B5 首开面板 2.5s 内可见（解码等待有 1s 兜底封顶）', jf.shownAt >= 0 && jf.shownAt <= 2500, 'shownAt=' + jf.shownAt + 'ms');

// ---- B5~B6 关→重开：回收池零重建零 load（#457/#662 未回退） ----
await sleep(2500); // 等首开的懒加载泵把视口外图 src 排空，再重置计数
await evalJs("(function(){document.querySelectorAll('#emoji-list img').forEach(function(im,n){im.__v703='s'+n;});window.__v.loads=0;return 1;})()");
await evalJs("(function(){var c=document.getElementById('emoji-close');if(c)c.click();return 1;})()");
await sleep(500);
await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return 1;})()");
await sleep(2000);
const reopen = await evalJs(`(function(){
  var imgs = document.querySelectorAll('#emoji-list img');
  var kept = 0, replaced = 0; imgs.forEach(function (im) { if (im.__v703) kept++; else replaced++; });
  return JSON.stringify({ kept: kept, replaced: replaced, loads: window.__v.loads, n: imgs.length });
})()`);
const j2 = reopen ? JSON.parse(reopen) : {};
chk('B6 大库关→重开：img 节点零替换 / 零 load（#457/#662 回收池未回退）', j2.kept === 60 && j2.replaced === 0 && j2.loads === 0, reopen);

// ---- Z 零异常 ----
const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
chk('Z1 全程零 JS 异常', errs === '[]', String(errs));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
cleanup(fail ? 1 : 0);

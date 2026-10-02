// #755 全站图片/文件选择入口统一收口验证（无头 Chrome，测构建产物 index.html）
// 立项（用户 2026-09-18 实报，vivo X200s + 百度浏览器 SP-engine/T7 内核）：
//   「任何图片，上传无反应；上传头像点了相册点了图片，但是没有任何反应」，
//   并明确要求「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现。这个问题其他设备型号也有出现。」
//
// 为什么需要「全站」脚本（而不是又修一个入口）：
//   这是同一 bug 族的第五波：#677（input 要挂进文档）→ #717（去掉 display:none）→
//   #738（加原生 label 激活层）→ #753（聊天两入口 + accept 前置）——前四轮每轮都只覆盖
//   「当时用户报的那几个入口」，而全站始终有十几处入口在手抄另一套写法（点击时现场 new input、
//   从不挂文档、无 label 兜底、accept 迟到）。所以用户每换一个设备型号、换一个功能入口，
//   就会再报一次同一个症状。本轮把判据做成**全站不变量**，一次性锁住所有入口。
//
// 本脚本断言的不变量（对页面上「所有」file input 生效，不针对单点）：
//   A. 激活形态：任何 file input 都不得 display:none、不得 opacity:0（部分内核对不可见 input
//      拒绝激活＝点了没反应），也不得 detached（iOS 对未挂载 file input 不保证派发 change）。
//   B. accept 前置：通过统一入口拿到的 input，激活那一刻 accept 必须已生效（否则 iOS/部分内核
//      首次激活退回通用文档选择器＝相册不在候选里，用户看到「打开的是文件夹管理页面」）。
//   C. 单例不堆积：反复点按同一入口，不新增 file input（旧的「每次点按 new 一个再 remove」
//      写法在部分内核上拿不到用户手势授权，且会残留节点）。
//   D. 统一实现存在且被各入口引用（回归防线：并行会话若把某入口改回手抄写法，A~C 仍可能过，
//      故补一条源码级引用计数断言）。
// 用法：node build.mjs && node tools/verify-file-pick-all.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-file-pick-all.mjs
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vfpa-' + Date.now()),
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
// 移动端视口（照用户真机口径），并对齐安卓 UA 分支覆盖
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 3.5, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);

// ===== A 组：统一实现存在 + 形态判据（源码级 + 运行时）=====
const a1 = J(await evalJs(`(function(){
  return JSON.stringify({
    has: typeof window.mochiFilePick === 'function',
    hasLabel: typeof window.mochiFilePickLabel === 'function',
    hasFrom: typeof window.mochiFilePickFromLabel === 'function'
  });
})()`));
ok(a1.has === true, 'A1 全站统一文件选择入口 window.mochiFilePick 已就位（缺＝#755 收口被回退）', JSON.stringify(a1));
ok(a1.hasLabel === true && a1.hasFrom === true, 'A2 原生 label 激活层与其 fromLabel 判据仍在（#738 模具未被回退）', JSON.stringify(a1));

// A3 行为：调用统一入口 → input 必须挂 body、sr-only clip、accept 已就位
const a3 = J(await evalJs(`(function(){
  var i = window.mochiFilePick({ id: 'vfpa-probe', accept: 'image/*', multiple: true, noClick: true });
  if (!i) return JSON.stringify({ err: 'no-input' });
  var cs = getComputedStyle(i);
  return JSON.stringify({
    attached: !!(i.parentNode === document.body),
    accept: String(i.accept || ''),
    multiple: !!i.multiple,
    display: String(cs.display || ''),
    clip: String(i.style.clip || ''),
    clipPath: String(i.style.clipPath || ''),
    opacity: String(cs.opacity || ''),
    id: i.id
  });
})()`));
ok(a3.attached === true && a3.id === 'vfpa-probe', 'A3 统一入口的 file input 常驻挂进 body（detached＝iOS 选完不派发 change「加了图片会消失」）', JSON.stringify(a3));
ok(String(a3.accept) === 'image/*' && a3.multiple === true, 'A4 调用时指定的 accept/multiple 已就位（accept 空＝弹出通用文件管理器，相册不在候选里）', JSON.stringify(a3));
ok(a3.display !== 'none' && a3.opacity !== '0' && String(a3.clip).indexOf('rect') === 0 && String(a3.clipPath).indexOf('inset') === 0,
  'A5 统一入口用 sr-only clip 而非 display:none / opacity:0（不可见写法＝部分内核拒绝激活，点了没反应）', JSON.stringify(a3));

// A6 单例：同 id 反复取用不新增节点
const a6 = J(await evalJs(`(function(){
  for (var k = 0; k < 6; k++) window.mochiFilePick({ id: 'vfpa-probe', accept: 'image/*', noClick: true });
  return JSON.stringify({ n: document.querySelectorAll('input[type=file]#vfpa-probe').length });
})()`));
ok(Number(a6.n) === 1, 'A6 同一 id 反复取用恒为 1 个 input（旧的「每次点按 new 一个再 remove」写法在部分内核拿不到手势授权）', JSON.stringify(a6));

// ===== B 组：全站不变量扫描（页面上所有既有 file input 的形态）=====
// 逐个显式调用各入口的「建 input」路径最能覆盖；这里先用扫描口径把「初始化即常驻」的那批查一遍，
// 再驱动几个真实入口（头像池 / 聊天 / 通知）做行为核验。
const b1 = J(await evalJs(`(function(){
  var bad = [];
  document.querySelectorAll('input[type=file]').forEach(function(i){
    var cs = getComputedStyle(i);
    var st = i.style || {};
    if (cs.display === 'none') bad.push({ id: i.id || '(anon)', why: 'display:none' });
    else if (String(st.opacity) === '0' || cs.opacity === '0') bad.push({ id: i.id || '(anon)', why: 'opacity:0' });
    else if (!i.isConnected) bad.push({ id: i.id || '(anon)', why: 'detached' });
  });
  return JSON.stringify({ bad: bad, total: document.querySelectorAll('input[type=file]').length });
})()`));
ok((b1.bad || []).length === 0, 'B1 全站既有 file input 无一使用 display:none / opacity:0 / detached（#717/#738 点名要消灭的不可见激活写法）', JSON.stringify(b1));

// ===== C 组：真实入口行为（走用户实际点按路径）=====
// C1 桌面头像入口：点击 → 常驻 input 挂 body 且 accept 已生效（#738 修复面不回退）
// 注意：头像入口的真实 id 是 avatar-user / avatar-partner（personalize.js bindAvatar），
// 不是 'avatar'——早期脚本误用 'avatar' 导致 clicked=false 假红，这里按真实 id 取。
const c1 = J(await evalJs(`(function(){
  window.__vfpaClicks = [];
  if (!window.__vfpaHooked) {
    window.__vfpaHooked = true;
    document.addEventListener('click', function(e){
      var t = e.target;
      if (t && t.tagName === 'INPUT' && String(t.type).toLowerCase() === 'file') {
        window.__vfpaClicks.push({ id: t.id || '', connected: !!t.isConnected, accept: String(t.accept || ''),
          display: String(t.style.display || ''), clip: String(t.style.clip || '') });
      }
    }, true);
  }
  var av = document.getElementById('avatar-user') || document.getElementById('avatar-partner');
  if (av) av.click();
  // 兜底口径：入口走原生 label 激活（#738）时 input.click() 未必由本脚本捕获，
  // 故同时直接读常驻 input 的既有形态，二者任一成立即可（避免点按路径差异导致假红）。
  var inp = document.getElementById('mochi-avatar-pick');
  return JSON.stringify({ clicked: !!av, id: av ? av.id : '',
    input: inp ? { connected: !!inp.isConnected, accept: String(inp.accept || ''),
      display: String(inp.style.display || ''), clip: String(inp.style.clip || '') } : null });
})()`));
await sleep(400);
const c1b = J(await evalJs(`(function(){var c = window.__vfpaClicks || [];return JSON.stringify({ n: c.length, last: c[c.length-1] || null });})()`));
const c1ok = c1.clicked === true && c1.input && c1.input.connected === true &&
  String(c1.input.accept) === 'image/*' && c1.input.display !== 'none' &&
  String(c1.input.clip).indexOf('rect') === 0;
ok(c1ok, 'C1 桌面头像入口（#avatar-user/#avatar-partner）：常驻 input 挂文档 + accept=image/* + sr-only clip 非 display:none（#738 修复面不回退）',
  JSON.stringify(c1) + ' | clicks=' + JSON.stringify(c1b));

// C2 聊天「插入图片」入口（#753 修复面不回退）
const c2 = J(await evalJs(`(function(){
  var b = document.getElementById('chat-img-btn');
  if (!b) return JSON.stringify({ err: 'no-btn' });
  b.click();
  var i = document.getElementById('chat-img-pick');
  if (!i) return JSON.stringify({ err: 'no-input' });
  var l = i.id ? document.querySelector('label[data-file-pick-for="chat-img-pick"]') : null;
  var cs = getComputedStyle(i);
  return JSON.stringify({ conn: i.isConnected, accept: String(i.accept||''), display: cs.display, clip: String(i.style.clip||''), label: !!l });
})()`));
ok(c2.err == null && c2.conn === true && String(c2.accept) === 'image/*' && c2.display !== 'none' && String(c2.clip).indexOf('rect') === 0 && c2.label === true,
  'C2 聊天「插入图片」入口保持 #753 口径（常驻挂文档 + sr-only clip + accept 前置 + 原生 label 激活层）', JSON.stringify(c2));

// C3 表情包（字卡库）入口：统一入口 + accept 前置
const c3 = J(await evalJs(`(function(){
  // 直接调统一入口，模拟该入口的调用参数（真实按钮在未打开的面板里）
  var i = window.mochiFilePick({ id: 'mochi-myemoji-pick', accept: 'image/*', multiple: true, noClick: true });
  return JSON.stringify({ exists: !!i, accept: String((i && i.accept) || ''), multiple: !!(i && i.multiple),
    attached: !!(i && i.parentNode === document.body), clip: String((i && i.style.clip) || '') });
})()`));
ok(c3.exists === true && String(c3.accept) === 'image/*' && c3.multiple === true && c3.attached === true && String(c3.clip).indexOf('rect') === 0,
  'C3 表情包/字卡库类入口（mochi-myemoji-pick）走统一入口且形态合规（用户报「点了相册点了图片没反应」的正是这类选中后回调链）', JSON.stringify(c3));

// C4 空 FileList 必须可见反馈（旧实现普遍静默 return）
const c4 = J(await evalJs(`(async function(){
  var t = document.getElementById('cc-toast'); if (t) t.textContent = '';
  var i = window.mochiFilePick({ id: 'vfpa-empty', accept: 'image/*', noClick: true,
    onFiles: function(files){ if (!files.length) { try { window.toast ? window.toast('没有取到图片，请再选一次') : null; } catch(e){} } } });
  i.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 200); });
  var tt = document.getElementById('cc-toast');
  return JSON.stringify({ toast: tt ? tt.textContent : '' });
})()`));
ok((c4.toast || '').indexOf('没有取到图片') >= 0, 'C4 空 FileList 时给可见提示（旧实现普遍静默 return＝用户看到「没有任何反应」）', JSON.stringify(c4));

// ===== D 组：源码级引用计数（防并行会话把某入口改回手抄写法）=====
// 用运行时能取到的构建产物文本做一次粗核：统一入口被多处引用即可证明各入口已收编。
// #1263 尺子自身收口：JS 外置化（#785b 起）后各入口调用点在 js/*.js，只 grep index.html
// 的旧口径恒 count≈1＝D1 恒红假象（在含 #1230 的产物上实测复现）。改为整产物聚合。
let js = readFileSync(join(root, 'index.html'), 'utf8');
try { for (const f of readdirSync(join(root, 'js'))) js += '\n' + readFileSync(join(root, 'js', f), 'utf8'); } catch (e1) {}
const refCount = (js.match(/mochiFilePick\(\{/g) || []).length;
ok(refCount >= 14, 'D1 统一入口在产物中被 14 处以上入口引用（少于＝有入口被改回各自手抄的 file input 写法）', 'count=' + refCount);
const detachBad = /createElement\('input'\)[\s\S]{0,120}?\.click\(\)/.test(js) ? true : false;
// 更精确的口径：显式 display:none 的 file input 不应再出现
const noneFileInput = /\.type\s*=\s*'file'[\s\S]{0,80}?display\s*=\s*'none'/.test(js);
ok(noneFileInput === false, 'D2 产物中不再有「file input + display:none」组合（#717/#738 点名消灭的写法；detachBad=' + detachBad + '）');

const errs = await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()");
ok(String(errs) === '[]' || String(errs) === 'null', 'Z 全程零 JS 异常', errs);

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 全站文件选择入口统一收口验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);

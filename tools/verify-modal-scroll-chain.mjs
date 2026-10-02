// ===== 回归脚本：弹窗内多行框「框内滚到底后手指落在框上，整个弹窗滚不动」=====
// 背景（用户报障 2026-09-16，vivo V2528A / vivo S50 + Edge，用户明说其他机型也有）：
//   字卡库 → 公用字卡/专属字卡 → 【表情包】→ 链接导入 → 弹窗「没办法下滑导入」；其他界面正常。
// 根因（零机型分支，纯 CSS 滚动链）：.modal 内有两个「子滚动容器」——
//   .modal-textarea.ce-box（安卓 textarea 被 mobile-adapt 转成 contenteditable，38vh 限高 + 框内滚）
//   与 .modal-group-chips（目标分组胶囊行，36vh 限高 + 行内滚）。
//   两者都写着 overscroll-behavior:contain。按规范，contain 会在「子容器已滚到边界」时把滚动链
//   一并拦断 → 用户把链接粘满多行框（框内已到底）后，手指自然落在框上起滑，手势被框独吞，
//   外层 .modal（overflow-y:auto，正是承载「目标分组」与「确定」的部分）永远收不到滚动
//   ⇒ 看不到底部、无法完成导入。
// 同族史（本次是第 4 次）：v3.23.x modal-textarea → v3.25.x 选项框限高 → #295 dec-opts/gd-opts（已改 auto）
//   → 本次。dec-opts/gd-opts 早已是 auto，本脚本盯的就是漏网的两处。
// 修复（src/css/base.css 两行，单属性）：两个容器 contain → auto。
//   框内溢出时仍先在框内滚（v3.23.x 的限高+框内滚动不回退）；只在「到边界」时放行给 .modal。
//
// 无头实证（本脚本原型的原始观测，CDP 真实触摸管线 Input.dispatchTouchEvent）：
//   落点 = 多行框（框内已滚到底）：scroll 事件日志只有 ce-box，.modal.scrollTop 恒 0  ← 用户症状
//   落点 = 多行框（同位置，仅把 contain 改 auto）：日志 ce-box → modal 2,19,…,102（滚到 103 上限）
//   落点 = 标题（非输入区，对照组）：.modal 直接滚到 102/103 ⇒ 弹窗本身可滚、手势管线有效
//   （对照组不可省：没有它，A2 的 0 无法区分「被拦断」与「弹窗本来没得滚」）
//
// 用法（收口后）：node build.mjs && node tools/verify-modal-scroll-chain.mjs
// 用法（RED 基线，对照 HEAD 产物）：SERVE_ROOT=<纯净 HEAD 工作树> node tools/verify-modal-scroll-chain.mjs
// 说明：视口特意取 390×620（矮视口）——真机键盘弹出后可用高度骤减，弹窗必然要滚；
//   桌面全高下弹窗内容可能整屏放得下＝测不出症状（假绿）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9410 + Math.floor(Math.random() * 80);
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 15; V2528A Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0';
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-msc-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank',
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try {
    const j = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
    const page = j.find((t) => t.type === 'page');
    if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch (e) {}
  await sleep(250);
}
if (!wsUrl) { console.error('no cdp'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => { ws.onopen = r; });
let msgId = 0; const pending = new Map(); const jsErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') { try { jsErrors.push(String(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 160)); } catch (e) { jsErrors.push('exception'); } }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') { jsErrors.push(String(m.params.entry.text).slice(0, 160)); }
};
const cdp = (method, params) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, (m) => m.error ? rej(new Error(method + ' ' + JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id, method, params: params || {} })); });
const evalJs = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; };

await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 620, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setUserAgentOverride', { userAgent: CHROME_UA });
// 预置：公用字卡库「表情包」14 个分组（让目标分组胶囊行触及 36vh 上限＝真实多分组弹窗高度）
// 越过开屏问答门（全局根键 applock-qaskip=1）——否则 #applock-mask 吃掉所有手势＝假阴性（首版踩过）
const SEED = JSON.stringify({
  text: [], kaomoji: [], emoji: [], image: [], poke: [], voice: [],
  sticker: Array.from({ length: 14 }, (_, i) => ['分组' + (i + 1), ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==']]),
});
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.setItem("xy-home-v2:cc-groups-public", ' + JSON.stringify(SEED) + ');localStorage.setItem("xy-home-v2:applock-qaskip","1");localStorage.setItem("xy-home-v2:applock-qa-en","0");}catch(e){}' });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3000);

const results = [];
const ok = (name, cond, extra) => { results.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) }); };

async function swipe(x, y, dy, steps, ms) {
  const t0 = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0, touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', timestamp: t0 + (i / steps) * (ms / 1000), touchPoints: [{ x, y: y + (dy * i) / steps, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
    await sleep(ms / steps);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t0 + ms / 1000 + 0.02, touchPoints: [] });
  await sleep(460);
}

// ---------- 进入真实 UI 路径 ----------
for (let i = 0; i < 25; i++) {
  const st = await evalJs("(function(){var s=document.getElementById('splash');return s? (s.classList.contains('hide')?'hide':'show') : 'none';})()");
  if (st === 'hide' || st === 'none') break;
  await evalJs("(function(){var b=document.getElementById('splash-start')||document.querySelector('#splash .splash-btn');if(b)b.click();return 1;})()");
  await sleep(400);
}
await sleep(700);
await evalJs("(function(){var s=document.getElementById('splash');if(s)s.remove();document.documentElement.classList.remove('splash-open');document.body.classList.remove('splash-open');return 1;})()");
await sleep(300);
const path = [];
path.push(await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(!t)return 'no-tab';t.click();return 'ok';})()"));
await sleep(800);
path.push(await evalJs("(function(){var li=document.getElementById('li-custom-cards-public');if(!li)return 'no-li';li.click();return 'ok';})()"));
await sleep(1000);
path.push(await evalJs("(function(){var tabs=document.querySelectorAll('#cc-tabs .cc-tab');for(var i=0;i<tabs.length;i++){if(tabs[i].dataset.type==='sticker'){tabs[i].click();return 'ok';}}return 'no-sticker-tab';})()"));
await sleep(600);
path.push(await evalJs("(function(){var b=document.getElementById('cc-import-link');if(!b)return 'no-btn';b.click();return 'ok';})()"));
await sleep(600);
ok('S0 真实路径可达：字卡库→公用字卡→表情包→链接导入 弹窗已开', path.every((v) => v === 'ok') && await evalJs("(function(){var m=document.getElementById('modal-mask');return !!m && !m.hidden;})()"), path.join('/'));

// ---------- 前置：填满多行框（模拟用户粘贴一批链接）----------
await evalJs("(function(){var box=document.querySelector('.modal-textarea.ce-box');var ta=document.getElementById('modal-textarea');var txt='';for(var i=1;i<=30;i++)txt+='https://example.com/sticker'+i+'.png\\n';if(box){box.innerHTML='';box.appendChild(document.createTextNode(txt));}if(ta)ta.value=txt;return 1;})()");
await sleep(300);

const reset = () => evalJs("(function(){['#modal-mask .modal','.modal-textarea.ce-box','#modal-group-chips'].forEach(function(s){var e=document.querySelector(s);if(e)e.scrollTop=0;});return 1;})()");
const read = () => evalJs("(function(){function q(s){var e=document.querySelector(s);return e?Math.round(e.scrollTop):null;}return {modal:q('#modal-mask .modal'),ce:q('.modal-textarea.ce-box'),chips:q('#modal-group-chips')};})()");
const geo = (sel) => evalJs("(function(){var e=document.querySelector('" + sel + "');if(!e)return null;return {sh:e.scrollHeight,ch:e.clientHeight,osb:getComputedStyle(e).overscrollBehaviorY,ovf:getComputedStyle(e).overflowY};})()");
const ptOn = (sel) => evalJs("(function(){var e=document.querySelector('" + sel + "');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height*0.8)};})()");

const gModal = await geo('#modal-mask .modal');
const gCe = await geo('.modal-textarea.ce-box');
const gChips = await geo('#modal-group-chips');
ok('S1 前置：多行框存在且为安卓转换后的 .ce-box（限高+框内滚）', !!gCe && gCe.ovf === 'auto');
ok('S2 前置：弹窗内容确实溢出（真机键盘期/矮视口下必须能滚，否则本用例测不出症状）', !!gModal && gModal.sh - gModal.ch > 20, 'modal 可滚量=' + (gModal ? gModal.sh - gModal.ch : 'n/a'));
ok('S3 前置：多行框内容也溢出（框内可滚，v3.23.x 的框内滚动不回退）', !!gCe && gCe.sh - gCe.ch > 20, 'ce 可滚量=' + (gCe ? gCe.sh - gCe.ch : 'n/a'));
// 修复面 A：两个容器不得再用 contain
ok('A1 多行框 overscroll-behavior 已放行（contain→auto，含改回即回归）', gCe && gCe.osb === 'auto', 'ce.osb=' + (gCe ? gCe.osb : 'n/a'));
ok('A2 目标分组胶囊行 overscroll-behavior 已放行（同批收口）', gChips && gChips.osb === 'auto', 'chips.osb=' + (gChips ? gChips.osb : 'n/a'));

// ---------- 用例①：框内未到底时先框内滚（框内滚动不得回退）----------
await reset(); await sleep(280);
let pt = await ptOn('.modal-textarea.ce-box');
await swipe(pt.x, pt.y, -240, 14, 380);
const u1 = await read();
ok('B1 手指在框上滑动：框内仍先自己滚（v3.23.x 框内滚动未回退）', u1.ce > 0, 'ce=' + u1.ce);

// ---------- 用例②：真实用户流——手指始终落在多行框上连续上滑（不程序化改 scrollTop）----------
// 注意（踩过的坑）：不要用 `ce.scrollTop = ce.scrollHeight` 造边界再滑一次——程序化改滚动位置
//   不会同步内核侧「本容器还能不能再滚」的边界状态，紧随其后的一次手势仍被判给内层＝假红。
//   真机用户是「反复上滑」把框推到尽头，故必须按同法采样。
await reset(); await sleep(280);
await swipe(pt.x, pt.y, -240, 14, 380);   // 第 1 次：框内滚（真实流的第一步）
const u2a = await read();
let chainedAt = 0, u2 = u2a;
for (let n = 2; n <= 9; n++) {
  await swipe(pt.x, pt.y, -240, 14, 380);
  u2 = await read();
  if (u2.modal > 0) { chainedAt = n; break; }
}
ok('B2 【用户症状】手指始终落在多行框上连续上滑：框内滚到尽头后能带动弹窗滚下去',
  u2.modal > 0, '第 ' + chainedAt + ' 次滑动起 modal=' + u2.modal + '（修前 contain：滑到第 9 次仍恒 0）');
ok('B2b 框内滚动在链式前未被跳过（先框内滚、后带动外层）', u2a.ce > 0 && u2.ce > u2a.ce, 'ce ' + u2a.ce + ' → ' + u2.ce);

// ---------- 对照组：手指落在非输入区（弹窗本身可滚、手势管线有效的证据）----------
await reset(); await sleep(280);
const ptTitle = await evalJs("(function(){var t=document.getElementById('modal-title');var r=t.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
await swipe(ptTitle.x, ptTitle.y, -240, 14, 380);
const u3 = await read();
ok('C0 对照组：手指落在标题（非输入区）时弹窗可滚到底（仪器有效性闸门）', u3.modal > 0 && u3.modal >= (gModal ? gModal.sh - gModal.ch : 999) - 8, 'modal=' + u3.modal + ' / 上限=' + (gModal ? gModal.sh - gModal.ch : '?'));

// ---------- 用例③：胶囊行到尽头后放行（同族第二处）----------
// 手势粒度说明：胶囊行可滚量只有几十 px，大位移快滑（≥120px/300ms）在本无头管线里会被当
//   fling、不参与链式判定（实测 dy=-120/-240/-400 恒不带动；dy=-80 稳定带动 modal 31→73）。
//   故此处用小位移多次滑动（真机用户碎步上滑即此形态）。
await reset(); await sleep(280);
const gChips2 = await geo('#modal-group-chips');
const ptChips = await evalJs("(function(){var e=document.querySelector('#modal-group-chips');var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height*0.5)};})()");
let chainedChips = 0, u4 = { modal: 0, chips: 0 };
if (gChips2 && gChips2.sh > gChips2.ch) {
  for (let n = 1; n <= 6; n++) {
    await swipe(ptChips.x, ptChips.y, -80, 14, 380);
    u4 = await read();
    if (u4.modal > 0) { chainedChips = n; break; }
  }
}
ok('B3 胶囊行滚到尽头后继续上滑：弹窗滚动链放行（同族第二处）',
  u4.modal > 0, '第 ' + chainedChips + ' 次滑动起 modal=' + u4.modal + ' chips=' + u4.chips);

// ---------- 用例④：弹窗关闭后不得残留（同一 .modal 是全站共用元素）----------
await evalJs("(function(){var c=document.getElementById('modal-cancel');if(c)c.click();return 1;})()");
await sleep(500);
ok('D1 关闭弹窗后遮罩隐藏（无残留）', await evalJs("(function(){var m=document.getElementById('modal-mask');return !!m && m.hidden;})()"));
ok('D2 零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

// ---------- 输出 ----------
const pass = results.filter((r) => r.pass).length;
console.log('');
for (const r of results) console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
console.log('\n' + pass + '/' + results.length + ' 通过' + (pass === results.length ? '（全绿）' : '（有红项）'));
console.log('SERVE_ROOT=' + root);

try { ws.close(); } catch (e) {}
chrome.kill();
server.close();
process.exit(pass === results.length ? 0 : 1);

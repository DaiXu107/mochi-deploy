// ===== 验证脚本：#479 窗口级改尺寸（Edge/Chrome 自由小窗、分屏）与键盘深缩甄别 =====
// 用法：node tools/verify-smallwindow-resize.mjs（构建后跑；修复未构建时 S0 红=属预期）
// 需要：Node 21+（内置 fetch / WebSocket）+ 本机 Chrome/Edge（CHROME_PATH 可指定）
//
// 背景（FIX-REGRESSION #479）：用户报障（OPPO 一加 Ace3 + Edge，多机型同现）——
// 浏览器缩成小窗（自由窗口）时聊天顶部名称栏和输入框一起消失，之前正常。根因：
// 小窗把【布局视口 inner 与 vv 一起永久改小】，视口签名与键盘弹出全同；基线
// _aH/_aIH/_aFullIH 只涨不跌 → ①旧判据 h<_aH-60 无聚焦也置位 _aKb 幽灵会话；
// ②#369 残留自愈把 .phone 钉回旧全屏高（诊断实锤 phone底=668/752 vs inner=584），
// 钉高释放条件 inner≥基线在小窗永不成立 → 顶栏与输入栏一起被推出窗外。
// 修复：真键盘必然在文本聚焦期弹出（focusin 先于 vv 收缩）——「inner≈vv 一起深缩+
// 无文本聚焦」=窗口被改小 → 三基线全体重锚；打字期深缩记 _aShrinkHadFoc=#369 原语义
// 保留；另加钉高前提失败阀（钉高 10s 后内核不回全屏高+用户有新交互→放弃钉高）。
//
// 场景：
//   S0 逻辑锚点：产物含 #479 修复表达式（哨兵同源；未构建时红=预期）
//   A1 前置健康路径：聚焦+视口收缩=键盘停靠；还原=复原（主路径零回归）
//   A2 【本 bug】无聚焦缩成小窗（360×584）→ 无幽灵会话、.phone 贴合窗口、顶栏+输入栏在窗内
//   A3 小窗稳态 6s（看门狗 6+ 拍）→ 不被 #369 钉回旧全屏高（旧产物必红=本 bug 现场）
//   A4 小窗内打字（焦点+收缩）→ 正常停靠（小窗里的键盘仍可用）
//   A5 小窗展开回全屏 → 基线跟随复原
//   B1 【#369 不回归】打字期深缩后失焦、inner/vv 同停 455（VivoBrowser 残留形）→ 钉回全屏高
//   B2 钉高前提失败阀：钉后 >10s 用户在深缩态有新交互 → 放弃钉高、重锚到现实（455）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..')); // SERVE_ROOT=隔离构建目录；normalize 统一 Windows 分隔符，否则 403
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- S0：逻辑锚点（与 build.mjs 哨兵同源）----
const NEEDLES = [
  'var open = (!_aVvStale && h < _aH - 60 && _focNow);',
  'if (_ihN < _aFullIH) _aFullIH = _ihN;',
  '(_aVvShrunkSeen || _aPanSeen >= 80) && _aShrinkHadFoc',
  'if (_aVpPin && _aVpPinAt > 0 && Date.now() - _aVpPinAt > 10000'
];
let built = '';
try { built = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
NEEDLES.forEach((n, i) => {
  check('S0.' + (i + 1) + ' 产物含 #479 逻辑锚点', built.includes(n), built.includes(n) ? '在' : '缺（修复未构建属预期）');
});

// ---- 找浏览器 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

// ---- 静态服务器 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

// ---- 无头 Chrome + CDP ----
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 500));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-smallwin-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdp('Page.enable');
// ⚠ 真机自由小窗不改物理屏（screen.width/height 恒定）；CDP metrics override 默认会连
// screen.* 一起改写 → 旧代码 #369 的「屏幕尺寸键变化=重置」分支会意外兜住、RED 失真。
// 故每次 override 都固定 screenWidth/screenHeight=412×915（小窗=物理屏不变、窗口变小）。
const SCR = { screenWidth: 412, screenHeight: 915 };
async function gotoApp(w, h) {
  // 无头环境 pointer:coarse/hover:none 不随 mobile:true 变真（#369/#479 的 coarse 闸
  // 会永远挡路）→ 页面脚本运行前补 matchMedia 补丁模拟触屏机（只拦这两个查询，其余透传）。
  if (!gotoApp._patched) {
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){var orig=window.matchMedia.bind(window);window.matchMedia=function(q){var m=orig(q);if(!m.matches&&(q==='(pointer:coarse)'||q==='(hover:none)')){try{var o=Object.create(m);Object.defineProperty(o,'matches',{get:function(){return true;}});o.addEventListener=function(){};o.addListener=function(){};return o;}catch(e){return m;}}return m;};})();" });
    gotoApp._patched = true;
  }
  await cdp('Emulation.setDeviceMetricsOverride', Object.assign({ width: w, height: h, deviceScaleFactor: 2.625, mobile: true }, SCR));
  await cdp('Page.navigate', { url: baseUrl + '/index.html?ts=' + Date.now() });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(900);
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(600);
}
// 现场采集：.phone 内联样式/几何 + 输入行/顶栏几何 + 键盘状态探针
const STATE_JS = `(function(){
  var ph = document.querySelector('.phone');
  var pr = ph.getBoundingClientRect();
  var ir = document.querySelector('#page-chat .chat-input-row');
  var hd = document.querySelector('#page-chat .chat-head');
  var irr = ir ? ir.getBoundingClientRect() : null;
  var hdr = hd ? hd.getBoundingClientRect() : null;
  var kb = window.__mochiAndroidKb ? window.__mochiAndroidKb() : null;
  return JSON.stringify({ inlineH: ph.style.height || '', inlineAS: ph.style.alignSelf || '',
    phoneTop: Math.round(pr.top), phoneBottom: Math.round(pr.bottom),
    inputBottom: irr ? Math.round(irr.bottom) : -1, inputTop: irr ? Math.round(irr.top) : -1,
    headTop: hdr ? Math.round(hdr.top) : -1, headBottom: hdr ? Math.round(hdr.bottom) : -1,
    inner: innerHeight, vv: Math.round(visualViewport.height),
    kbActive: kb ? !!kb.kbActive : null, prov: kb ? !!kb.prov : null });
})()`;
async function state() { return JSON.parse(await evalJs(STATE_JS) || '{}'); }
async function resize(w, h) {
  await cdp('Emulation.setDeviceMetricsOverride', Object.assign({ width: w, height: h, deviceScaleFactor: 2.625, mobile: true }, SCR));
}
async function focusInput() {
  return evalJs("(function(){var i=document.getElementById('chat-input');if(!i)return 'no-input';i.focus();return document.activeElement===i||document.activeElement&&document.activeElement.isContentEditable?'focused':'not-focused';})()");
}
async function blurAll() {
  return evalJs("(function(){if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();return true;})()");
}

// ================= Phase A：小窗公共路径 =================
await gotoApp(412, 915);

// ---- A1 前置健康路径：聚焦+收缩=键盘停靠；还原=复原 ----
const focA = await focusInput();
check('A1 前提：聊天输入框可聚焦', focA === 'focused', focA);
await resize(412, 455); await sleep(900);
let s = await state();
check('A1 键盘会话：.phone 停靠到可视高（主路径零回归）', s.kbActive === true && Math.abs(s.phoneBottom - 455) <= 4,
  'kbActive=' + s.kbActive + ' bottom=' + s.phoneBottom + '/455');
await resize(412, 915); await sleep(900);
s = await state();
check('A1 键盘收起：复原贴底、无内联残留', !s.inlineH && !s.inlineAS && Math.abs(s.phoneBottom - 915) <= 4,
  'inlineH=' + JSON.stringify(s.inlineH) + ' bottom=' + s.phoneBottom + '/915');

// ---- A2 【本 bug】无聚焦缩成小窗 360×584 ----
await blurAll(); await sleep(400);
await resize(360, 584);
let a2ok = false, a2s = null;
for (let i = 0; i < 12; i++) { await sleep(400); a2s = await state(); if (!a2s.inlineH && !a2s.inlineAS && Math.abs(a2s.phoneBottom - 584) <= 4) { a2ok = true; break; } }
check('A2 小窗进入：无幽灵键盘会话', a2s.kbActive === false && a2s.prov === false, 'kbActive=' + a2s.kbActive + ' prov=' + a2s.prov);
check('A2 小窗进入：.phone 无停靠残留、贴合窗口', a2ok, 'inlineH=' + JSON.stringify(a2s.inlineH) + ' bottom=' + a2s.phoneBottom + '/584');
check('A2 顶部名称栏在窗内', a2s.headTop >= -2 && a2s.headBottom > 0, 'head=' + a2s.headTop + '..' + a2s.headBottom);
check('A2 输入栏在窗内（贴底）', Math.abs(a2s.inputBottom - 584) <= 4, 'inputBottom=' + a2s.inputBottom + '/584');

// ---- A3 小窗稳态 6s：不被 #369 钉回旧全屏高（旧产物必红）----
await sleep(6000);
s = await state();
check('A3 小窗稳态：.phone 不被钉回旧全屏高（915）', !s.inlineH && Math.abs(s.phoneBottom - 584) <= 4,
  'inlineH=' + JSON.stringify(s.inlineH) + ' bottom=' + s.phoneBottom + '/584');
check('A3 顶栏+输入栏仍在窗内', s.headTop >= -2 && Math.abs(s.inputBottom - 584) <= 4,
  'head=' + s.headTop + ' inputBottom=' + s.inputBottom);

// ---- A4 小窗内打字：焦点+收缩=正常停靠 ----
await focusInput();
await resize(360, 416); await sleep(900);
s = await state();
check('A4 小窗内键盘：正常停靠到可视高', s.kbActive === true && Math.abs(s.phoneBottom - 416) <= 6,
  'kbActive=' + s.kbActive + ' bottom=' + s.phoneBottom + '/416');
await resize(360, 584); await sleep(900);
s = await state();
check('A4 小窗内收键盘：复原贴 584', Math.abs(s.phoneBottom - 584) <= 4, 'bottom=' + s.phoneBottom + '/584');
await blurAll(); await sleep(300);

// ---- A5 展开回全屏：基线跟随复原 ----
await resize(412, 915); await sleep(900);
s = await state();
check('A5 展开回全屏：贴合 915、无内联', !s.inlineH && Math.abs(s.phoneBottom - 915) <= 4,
  'inlineH=' + JSON.stringify(s.inlineH) + ' bottom=' + s.phoneBottom + '/915');

// ================= Phase B：VivoBrowser #369 不回归 + 失败阀 =================
await gotoApp(412, 915);
// B1：打字期深缩（焦点在场）→ 失焦后 inner/vv 同停 455（内核残留形）→ #369 钉回全屏高
await focusInput();
await resize(412, 455); await sleep(900);
let sb1 = await state();
check('B1 前提：键盘会话停靠 455', sb1.kbActive === true && Math.abs(sb1.phoneBottom - 455) <= 6, JSON.stringify({ kb: sb1.kbActive, b: sb1.phoneBottom }));
await blurAll();
let pin = false, sb2 = null;
const t0 = Date.now();
while (Date.now() - t0 < 12000) {
  await sleep(500);
  sb2 = await state();
  if (sb2.inlineH && parseInt(sb2.inlineH, 10) >= 900) { pin = true; break; }
}
check('B1 【#369 不回归】残留形钉回全屏高 915', pin && sb2 && parseInt(sb2.inlineH, 10) === 915,
  'inlineH=' + (sb2 && sb2.inlineH) + ' bottom=' + (sb2 && sb2.phoneBottom));
// B2：钉高前提失败阀——钉后 >10s，用户在深缩态有新交互 → 放弃钉高、重锚到 455
if (pin) {
  const waited = Date.now() - t0;
  if (waited < 10500) await sleep(10500 - waited);
  await evalJs("(function(){document.dispatchEvent(new Event('touchstart'));return true;})()");
  let vok = false, sv2 = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 6000) {
    await sleep(500);
    sv2 = await state();
    if (!sv2.inlineH && Math.abs(sv2.phoneBottom - 455) <= 4) { vok = true; break; }
  }
  check('B2 钉高前提失败阀：放弃钉高、基线重锚到现实（455）', vok,
    'inlineH=' + (sv2 && sv2.inlineH) + ' bottom=' + (sv2 && sv2.phoneBottom));
} else {
  check('B2 钉高前提失败阀', false, 'B1 未钉高，跳过（B1 已红）');
}

chrome.kill(); server.close();
const fails = results.filter((r) => !r.ok).length;
console.log('----\n' + (results.length - fails) + '/' + results.length + ' 通过');
process.exit(fails ? 1 : 0);

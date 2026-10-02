// ===== 专项验证 #267：安卓「平移型键盘内核」停靠与卡死自愈（荣耀 X50 自带浏览器族） =====
// 用法：node tools/verify-kb-pan-dock.mjs（构建后跑；修复未构建时 S0/M1/M2/M5 红=属预期）
// 需要：Node 21+（内置 fetch/WebSocket）+ 本机 Chrome/Edge（CHROME_PATH 可指定）
//
// 反馈现场（v3.26.529，荣耀 X50 ALI-AN00 + HonorBrowser/Chrome116）：
//   ①「点开键盘没有输入框」②「点开输入框会出现一部分空白」③「输入法弹窗完全遮挡
//   输入栏这一行，无法正常打字发送」。诊断签名：键盘弹出时 visualViewport.height 不缩
//   （664 与 254 两种读数在同一会话交替出现）、gap=274 空白、kb=1 常驻。
// 根因（两处确定性缺陷，与机型无关，任何「靠平移而非收缩露焦点」的内核都会命中）：
//   R1 syncAndroidKb 的 `open && !_aKb` 接管时不清 _aProv → _aKb 与 _aProv 并存，
//      看门狗 `if (_aKb && !_aProv)` 与 `if (_aKb || _aProv) return` 全被堵死，
//      四条复原路一条都走不到 → .phone 永久停在键盘期内联收缩高＝输入栏下方一整块空白。
//   R2 该类内核唯一的键盘高度证据是「浏览器为露焦点平移了多少」（vv.offsetTop/scrollY），
//      而 _aPinPan 每次都在归零前把它丢掉 → 保底停靠只能盲猜 58%：IME 高于 42%（该机约
//      62%）时输入栏整行仍在键盘下面（看不见、打不出、发不了），矮于 42% 时又缩出大片空白。
// 修复（src/js/mobile-adapt.js）：_aPinPan 在 _aKb/_aProv 均未接管时把平移量记进
//   _aPanSeen（取最大值，focusin 重置）；_aProvDock 有新鲜实测（≥80px 且 1.5s 内）就按
//   base−平移 停靠，无实测仍走 58% 保底（纯悬浮又不平移的 X5/旧夸克零行为变化）；
//   syncAndroidKb 接管时 _aProvClear()；1s 看门狗补两条卡死自愈（视口侧：vv+inner 双回
//   基准且活焦点不在文本框 → 立即复原；焦点侧：_aKb/_aProv 任一在顶 + 活焦点不在文本框
//   + 静默 >2.2s + vv 读数已稳 → 复原并按需置 #236 残留闩）。
//   埋点（device.js）：诊断行新增「本键盘会话实测平移」「焦点框被挡」，错误现场新增
//   i=/p=/cov= —— 下次陌生内核报障一次粘贴即可分案。
//
// 场景（内核模型）：
//   S0 逻辑锚点：产物含 #267 六处修复表达式（与 build.mjs 哨兵同源）
//   S1 只读探针：__mochiAndroidKb().panSeen / mochiVvDiag().focusCovered 已接入
//   M1 平移不收缩内核（荣耀X50 族）→ 按实测平移停靠，输入栏落在键盘上沿之上
//   M2 无焦点停靠 + 收键盘不再派 resize（视口侧自愈）→ ≤3.5s 贴底
//   M3 纯悬浮且不平移（X5/旧夸克）→ 仍按 58% 保底停靠，panSeen=0（零回归）
//   M4 迟到真实收缩信号接管 → 停靠交回主链路且 _aProv 必须已清（防 R1 并存堵死）
//   M5 vv 读数滞留收缩值 + 焦点已交回（焦点侧自愈）→ ≤4.2s 清停靠并闩住残留读数；
//      再触摸聚焦必须解除闩并重新停靠（防「一次自愈把后续键盘全锁死」）
//   M6 真在打字（焦点保留 + 收缩态）→ 看门狗绝不误清；焦点交回后主链路照常复原
//   M7 平移量不足（40px caret 微滚级）→ 不采信实测，仍走 58% 保底
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- S0：逻辑锚点（needle 与 build.mjs FIX_SENTINELS 同源）----
const NEEDLES = [
  ['实测平移记档（_aPinPan → _aPanSeen）', 'src/js/mobile-adapt.js', 'if (_panPx > 8) {'],
  ['有实测按实测停靠（_aProvDock 门槛）', 'src/js/mobile-adapt.js', '_aPanSeen >= 80 && Date.now() - _aPanSeenAt < 1500'],
  ['接管时清推顶（防 kb+prov 并存）', 'src/js/mobile-adapt.js', 'kbDockPanels(); _aProvClear(); }'],
  ['卡死停靠自愈·视口侧（vv+inner 回基准 + 活焦点闸门）', 'src/js/mobile-adapt.js', 'if (_vN > 0 && _vN >= _aH - 12 && _iN >= _aIH - 12 && !_aIsText(document.activeElement)) {'],
  ['卡死停靠自愈·焦点侧（静默 2.2s + vv 稳 1.2s + 活焦点闸门）', 'src/js/mobile-adapt.js', 'if ((_aKb || _aProv) && !_aIsText(document.activeElement) && Date.now() - _aLastAct > 2200 && Date.now() - _aVvChgAt > 1200) {'],
  ['安卓键盘探针导出 panSeen', 'src/js/mobile-adapt.js', 'panSeen: Math.round(_aPanSeen)'],
  ['诊断算焦点框是否被键盘挡住', 'src/js/device.js', 'out.focusCovered = ar.bottom > (vv.offsetTop || 0) + vv.height + 2 ? 1 : 0;'],
];
let missingSrc = [];
for (const [label, file, needle] of NEEDLES) {
  let inSrc = false, inBuild = false;
  try { inSrc = readFileSync(join(root, file), 'utf8').includes(needle); } catch (e) {}
  try { inBuild = readFileSync(join(root, 'index.html'), 'utf8').includes(needle); } catch (e) {}
  if (!inBuild) missingSrc.push(label);
  check('S0 ' + label + ' 锚点在产物', inBuild, 'src=' + (inSrc ? '有' : '无') + ' 产物=' + (inBuild ? '有' : '无（修复未构建属预期）'));
}

// ---- 浏览器 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kbpan-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank',
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
async function evalJson(expr) {
  const s = await evalJs('(function(){try{return JSON.stringify(' + expr + ')}catch(e){return null}})()');
  return s ? JSON.parse(s) : null;
}

await cdp('Page.enable');
await cdp('Runtime.enable');
// visualViewport 垫片：实例属性遮蔽 height/offsetTop 原型 getter（对象身份不变），
// scrollTo 归零平移（与真内核同语义）；__setVv(h, offsetTop, 是否派 resize) 三种内核
// 模型全靠它编排——fire=false 即「该内核收键盘不再派 visualViewport.resize」的现场。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  // document-start 时 viewport meta 尚未生效，vv.height 读到的是 980px 布局视口换算值
  // （本例 2121 而非 emulate 的 844）→ 冻结它会让 mobile-adapt 的 _aH 基线整体错位。
  // 故未显式设置前透传原型 getter 的真实读数，__setVv 传过值之后才用伪造值。
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vv), 'height');
  let h = null, off = 0;
  try {
    Object.defineProperty(vv, 'height', { get: () => (h === null ? (d && d.get ? d.get.call(vv) : 0) : h), configurable: true });
    Object.defineProperty(vv, 'offsetTop', { get: () => off, configurable: true });
    vv.scrollTo = function () { off = 0; window.__panZeroCalls = (window.__panZeroCalls || 0) + 1; };
    window.__setVv = (nh, noff, fire) => {
      if (nh != null) h = nh;
      if (noff !== undefined) off = noff;
      if (fire) vv.dispatchEvent(new Event('resize'));
    };
    window.__vvNow = () => Math.round(h === null ? (d && d.get ? d.get.call(vv) : 0) : h);
    window.__vvOff = () => Math.round(off);
  } catch (e) {}
  // 前置状态（不是被测逻辑）：预置「用户已永久跳过开屏问答门」，否则 qa-mask 盖住
  // 整屏 → CDP 触摸命中的是遮罩而非输入框 → kbTouchArmed 永远不成立 → 保底停靠不触发
  try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e2) {}
  // 可选模拟「focusout 漏派」内核（荣耀/红米实测过的事件丢失族）：捕获阶段吞掉，
  // 应用侧 focusout 监听（document 冒泡阶段）再也收不到，_aTextFocused 于是滞留。
  document.addEventListener('focusout', function (e) {
    if (window.__dropFocusout) e.stopImmediatePropagation();
  }, true);
})();
` });

const W = 390, H = 844;
async function loadApp(tag) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html?b=' + tag });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  // 开屏（v3.26.x 起只能滑到底点【我已阅读并知晓】进入，点整屏无效、二次确认层已删）。
  // 坑：按钮只要数据就绪就 un-hide，但没滑到底时挂 .is-disabled、点了不生效——必须每轮
  // 先滚动 + 等类名去掉再点，否则 #splash 一直挡整屏（触摸命中的是 .splash-footcard，
  // 键盘场景的触摸武装条件 kbTouchArmed 永远不成立，整批场景假红）。
  let entered = false;
  for (let i = 0; i < 24 && !entered; i++) {
    await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;return true;})()");
    await sleep(250);
    if (!(await evalJs("(function(){var e=document.getElementById('splash-enter');return !!(e&&!e.hidden&&!e.classList.contains('is-disabled'));})()"))) continue;
    await evalJs("(function(){var e=document.getElementById('splash-enter');if(e)e.click();return true;})()");
    await sleep(600);
    entered = !(await evalJs("(function(){var s=document.getElementById('splash');return !!(s&&!s.hidden);})()"));
  }
  if (!entered) console.log('WARN  开屏未能进入 → 触摸前置条件不成立，遮挡=' + await evalJson(`(function(){var e=document.getElementById('chat-input');if(!e)return 'no-input';var r=e.getBoundingClientRect();var t=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));return t?String(t.tagName)+'#'+String(t.id)+'.'+String(t.className).slice(0,24):'null';})()`));
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(300);
  // 与本场景无关的全屏弹层偶发自动挂上来（问问TA 问答面板 #qa-mask 等，进聊天页后触发）
  // → 触摸命中的是遮罩而不是输入框，键盘链路的触摸武装条件永不成立。遮罩清掉后「触摸
  // 真打到输入框」仍由 tapChatInput 的命中测试担保，不糊前置条件；清了什么如实打一行。
  const blockers = await evalJson("(function(){var ids=['qa-mask','applock-mask','modal-mask','tc-mask','call-mask'];var open=[];ids.forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)open.push(id);});open.forEach(function(id){document.getElementById(id).hidden=true;});return open;})()");
  if (blockers && blockers.length) console.log('NOTE  ' + tag + ' 清掉无关遮罩：' + blockers.join(','));
}
// 真实触摸点按聊天输入栏：走输入管线 → touchstart（武装保底停靠的手势条件）→ 原生聚焦。
// 先做命中测试：被遮罩挡住时触摸落在遮罩上，kbTouchArmed 永远不成立（旧脚本就此假红）。
// 不做程序化 focus 兜底——自动聚焦本来就过不了手势闸门，兜底只会把前置条件糊过去。
async function tapChatInput() {
  const pos = await evalJson(`(function(){var el=document.getElementById('chat-input');if(!el)return null;var r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  if (!pos) return { ok: false, why: '无 #chat-input' };
  const top = await evalJson(`(function(){var el=document.getElementById('chat-input');var t=document.elementFromPoint(${pos.x},${pos.y});return {hit:t?String(t.tagName)+'#'+String(t.id)+'.'+String(t.className).slice(0,24):'null',inside:!!(t&&el.contains(t))};})()`);
  if (!top || !top.inside) return { ok: false, why: '输入栏被遮挡 onPoint=' + (top ? top.hit : 'null') };
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(140);
  const foc = await evalJs("(function(){var i=document.getElementById('chat-input');return !!(i&&document.activeElement===i);})()");
  return { ok: !!foc, why: foc ? 'hit=' + top.hit : '触摸后未聚焦' };
}
let tapWhy = '';
async function tap() { const r = await tapChatInput(); tapWhy = r.why || ''; return r.ok; }
const kb = () => evalJson('(window.__mochiAndroidKb && window.__mochiAndroidKb()) || null');
const geom = () => evalJson(`(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var ir=document.querySelector('#page-chat .chat-input-row');var rr=ir?ir.getBoundingClientRect():null;return {inlineH:ph.style.height||'',inlineAS:ph.style.alignSelf||'',phoneBottom:Math.round(pr.bottom),inputBottom:rr?Math.round(rr.bottom):-1,inner:innerHeight,vvNow:Math.round((window.visualViewport||{height:0}).height),active:(document.activeElement||{}).tagName||''};})()`);
async function waitCleared(ms, want) {
  const t0 = Date.now();
  let g = null, k = null;
  while (Date.now() - t0 < ms) {
    g = await geom(); k = await kb();
    const cleared = g && !g.inlineH && !g.inlineAS && (!k || (want === 'prov' ? !k.prov : (!k.kbActive && !k.prov)));
    if (cleared) return { ok: true, g, k, ms: Date.now() - t0 };
    await sleep(250);
  }
  return { ok: false, g, k, ms: Date.now() - t0 };
}

const GUESS = Math.max(240, Math.round(H * 0.58));
const PAN = Math.round(H * 0.62);
const MEAS = Math.round(H - PAN);

// ---------- S1：只读探针已接入 ----------
await loadApp('s1');
const s1 = await kb();
check('S1 安卓键盘探针可用且导出 panSeen', !!s1 && s1.panSeen !== undefined, s1 ? Object.keys(s1).length + ' 字段' : 'null');
const s1v = await evalJson('(window.mochiVvDiag && window.mochiVvDiag()) || null');
check('S1 mochiVvDiag 导出 focusCovered 字段', !!s1v && 'focusCovered' in s1v, s1v ? 'cov=' + s1v.focusCovered : 'null');

// ---------- M1：平移不收缩内核 → 按实测停靠 ----------
await loadApp('m1');
check('M1-准备 触摸聚焦聊天输入栏', await tap(), tapWhy);
await evalJs('window.__setVv && window.__setVv(null,' + PAN + ',false)');
await sleep(1500);
const m1k = await kb();
const m1g = await geom();
const m1h = m1g && m1g.inlineH ? parseInt(m1g.inlineH, 10) : 0;
check('M1 平移量在归零前被记档（panSeen≈' + PAN + '）', !!m1k && m1k.panSeen >= PAN - 6, m1k ? 'panSeen=' + m1k.panSeen + ' ' + m1k.panSeenAgo + 'ms前' : 'null');
check('M1 停靠走推定保底链路（prov=1、主链路无收缩信号）', !!m1k && m1k.prov === true && m1k.kbActive === false, m1k ? 'prov=' + m1k.prov + ' kb=' + m1k.kbActive : 'null');
check('M1 .phone 按实测平移停靠（≈' + MEAS + 'px，非盲猜 ' + GUESS + 'px）', Math.abs(m1h - MEAS) <= 4, 'height=' + (m1g || {}).inlineH);
check('M1 停靠结果明显高于 58% 盲猜值（键盘上沿之上）', m1h > 0 && m1h <= GUESS - 40, 'ph=' + m1h + ' guess=' + GUESS);
check('M1 输入栏落在键盘上沿（' + MEAS + '）之上', !!m1g && m1g.inputBottom > 0 && m1g.inputBottom <= MEAS + 8, m1g ? 'input.bottom=' + m1g.inputBottom : 'null');

// ---------- M2：无焦点卡死停靠 → 看门狗自愈 ----------
await loadApp('m2');
// 交互续期（keydown → 本模块 _aBump 把 _aLastAct 拉回当下）：焦点侧自愈要「静默 >2.2s」，
// 这里持续把它挡住，本场景才测得到视口侧那条自愈（vv+inner 双回基准即立即复原）。
const bump = () => evalJs("document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:65,bubbles:true}))");
await evalJs('window.__setVv && window.__setVv(400,0,true)');
await bump();
await sleep(600);
const m2a = await kb();
const m2ag = await geom();
check('M2-前提 无聚焦的纯 vv 收缩把停靠置位', !!m2a && m2a.kbActive === true && m2ag.inlineH === '400px', m2a ? 'kb=' + m2a.kbActive + ' h=' + m2ag.inlineH : 'null');
// 键盘已收、vv 读数回到基准，但该内核不再派 resize → 主链路/轮询全无人再跑。
// 取样必须贴着静默还原那一拍做（不能先 sleep）：1s 看门狗随时可能落进睡眠窗口，
// 新产物会「已经治好了」→ 前置断言假红；旧产物无论何时取样都卡死（无人复检）。
await evalJs('window.__setVv && window.__setVv(' + H + ',0,false)');
await bump();
const m2b = await geom();
check('M2-前提 收缩态无事件驱动自愈（旧产物即此态）', m2b.inlineH === '400px', 'inlineH=' + m2b.inlineH + ' bottom=' + m2b.phoneBottom + '/' + m2b.inner);
const m2w = await waitCleared(3500, 'kb');
const m2c = await geom();
check('M2 卡死停靠被视口侧自愈清掉（≤1.8s，静默门还挡着→非焦点侧分支）', m2w.ok && m2w.ms <= 1800, m2c.inlineH + '@' + m2w.ms + 'ms');
check('M2 .phone 贴回视口底（输入栏不再悬空）', !!m2c && Math.abs(m2c.phoneBottom - m2c.inner) <= 2, 'bottom=' + m2c.phoneBottom + ' inner=' + m2c.inner);

// ---------- M3：纯悬浮且不平移（X5/旧夸克）→ 58% 保底零变化 ----------
await loadApp('m3');
check('M3-准备 触摸聚焦聊天输入栏', await tap(), tapWhy);
await sleep(1600);
const m3k = await kb();
const m3g = await geom();
const m3h = m3g && m3g.inlineH ? parseInt(m3g.inlineH, 10) : 0;
check('M3 无任何视口证据时仍触发保底停靠', !!m3k && m3k.prov === true, m3k ? 'prov=' + m3k.prov : 'null');
check('M3 无实测平移（panSeen=0）', !!m3k && m3k.panSeen === 0, m3k ? 'panSeen=' + m3k.panSeen : 'null');
check('M3 停靠高度仍是 58% 保底值（这批机型行为零变化）', Math.abs(m3h - GUESS) <= 4, 'height=' + (m3g || {}).inlineH + ' 期望=' + GUESS + 'px');

// ---------- M4：迟到的真实收缩信号接管 → prov 必须已清 ----------
await loadApp('m4');
check('M4-准备 触摸聚焦聊天输入栏', await tap(), tapWhy);
await sleep(1300);
const m4p = await kb();
check('M4-前提 保底停靠已生效（vv 尚未报收缩）', !!m4p && m4p.prov === true, m4p ? 'prov=' + m4p.prov : 'null');
await evalJs('window.__setVv && window.__setVv(400,0,true)');
await sleep(700);
const m4k = await kb();
const m4g = await geom();
check('M4 真实 vv 收缩后主链路接管（400px）', m4g.inlineH === '400px', 'height=' + m4g.inlineH);
check('M4 接管后 _aKb 与 _aProv 不并存（否则四条复原路全堵死）', !!m4k && m4k.kbActive === true && m4k.prov === false, m4k ? 'kb=' + m4k.kbActive + ' prov=' + m4k.prov : 'null');

// ---------- M5：vv 读数滞留收缩值 + 焦点已交回 → 焦点侧自愈 ----------
const STALE = Math.round(H * 0.30); // 荣耀现场收键盘瞬间的 254 读数（此后不再补派 resize）
await loadApp('m5');
check('M5-准备 触摸聚焦聊天输入栏', await tap(), tapWhy);
await sleep(1400);
const m5p = await kb();
const m5pg = await geom();
const m5ph = m5pg && m5pg.inlineH ? parseInt(m5pg.inlineH, 10) : 0;
check('M5-前提 vv 始终不缩的悬浮内核走 58% 保底停靠', !!m5p && m5p.prov === true && Math.abs(m5ph - GUESS) <= 4, m5p ? 'prov=' + m5p.prov + ' h=' + m5pg.inlineH : 'null');
await evalJs('window.__setVv && window.__setVv(' + STALE + ',0,false)');
await evalJs("(function(){var i=document.getElementById('chat-input');if(i)i.blur();return true;})()");
await sleep(450);
const m5a = await kb();
const m5ag = await geom();
// 焦点正常交回（focusout 派了）→ _aTextFocused 清空、250ms 轮询停表；而 _aProvCheck 的
// !tgt 清理要求 vv 已回基准（滞留读数 253 不满足）→ 主链路/focusout/#209 全进不去
check('M5-前提 无焦点 + vv 滞留收缩读数 → 停靠卡死（旧产物即此态）', !!m5a && m5ag.inlineH !== '' && (m5a.kbActive || m5a.prov),
  m5a ? 'kb=' + m5a.kbActive + ' prov=' + m5a.prov + ' watch=' + m5a.watching + ' h=' + m5ag.inlineH : 'null');
const m5w = await waitCleared(4600, 'kb');
const m5k = await kb();
check('M5 静默 >2.2s 后停靠被清（软键盘必依附焦点）', m5w.ok && !!m5k && !m5k.prov && !m5k.kbActive,
  m5w.g ? 'h=' + JSON.stringify(m5w.g.inlineH) + '@' + m5w.ms + 'ms' : 'null');
check('M5 .phone 贴回视口底（空白消失）', !!m5w.g && Math.abs(m5w.g.phoneBottom - m5w.g.inner) <= 2, m5w.g ? 'bottom=' + m5w.g.phoneBottom + '/' + m5w.g.inner : 'null');
check('M5 仍称有键盘的读数被 #236 闩抑制（防立刻又被 253 抽回键盘下）', !!m5k && m5k.staleVv === true, m5k ? 'staleVv=' + m5k.staleVv : 'null');
// 反向保护：闩只能被真实交互解除——再点一次输入栏必须重新停靠（否则一次自愈锁死后续会话）
check('M5b 重新触摸聚焦聊天输入栏', await tap(), tapWhy);
await sleep(1600);
const m5b = await kb();
const m5bg = await geom();
check('M5b 触摸解除残留闩并重新停靠（自愈不会锁死下一次键盘会话）', !!m5b && m5b.staleVv === false && !!m5bg.inlineH,
  m5b ? 'staleVv=' + m5b.staleVv + ' h=' + m5bg.inlineH : 'null');

// ---------- M6：真在打字（焦点保留 + 收缩态）→ 不误清停靠 ----------
await loadApp('m6');
check('M6-准备 触摸聚焦聊天输入栏', await tap(), tapWhy);
await evalJs('window.__setVv && window.__setVv(400,0,true)');
await sleep(700);
const m6a = await geom();
for (let i = 0; i < 13; i++) { await bump(); await sleep(250); }
const m6b = await geom();
const m6k = await kb();
check('M6 焦点保留且持续键入时停靠不被误清（3.2s 后仍 400px）', m6a.inlineH === '400px' && m6b.inlineH === '400px' && !!m6k && m6k.kbActive === true,
  'h=' + m6b.inlineH + ' kb=' + (m6k || {}).kbActive);
// 返回键/手势收键盘不派 focusout、DOM 焦点保留（#141 前提）；此时 vv 读数仍称有键盘：
// 应用没有任何可靠证据说键盘已收，必须继续停靠（放宽自愈不能反向打破 #89/#141）
await evalJs('window.__dropFocusout = true');
await sleep(3000);
const m6c = await geom();
const m6k2 = await kb();
check('M6 读数仍称有键盘时不停摆也不误清（3s 静默后仍 400px）', m6c.inlineH === '400px' && !!m6k2 && m6k2.kbActive === true && m6k2.staleVv === false,
  'h=' + m6c.inlineH + ' kb=' + (m6k2 || {}).kbActive + ' staleVv=' + (m6k2 || {}).staleVv);
// 键盘真收：vv 静默回基准（仍不派 resize）。活焦点仍在输入框 → 焦点侧分支让路，
// 由滞留 _aTextFocused 撑着的轮询走主链路复原——证明在用量闸门不是永久挡箭牌
await evalJs('window.__setVv && window.__setVv(' + H + ',0,false)');
const m6w = await waitCleared(2000, 'kb');
check('M6 视口回基准后主链路照常复原（≤2s 贴底）', m6w.ok && !!m6w.g && Math.abs(m6w.g.phoneBottom - m6w.g.inner) <= 2,
  m6w.g ? 'h=' + JSON.stringify(m6w.g.inlineH) + ' bottom=' + m6w.g.phoneBottom + '/' + m6w.g.inner + '@' + m6w.ms + 'ms' : 'null');

// ---------- M7：平移量不足（caret 微滚级 40px）→ 不采信实测 ----------
await loadApp('m7');
check('M7-准备 触摸聚焦聊天输入栏', await tap(), tapWhy);
await evalJs('window.__setVv && window.__setVv(null,40,false)');
await sleep(1500);
const m7k = await kb();
const m7g = await geom();
const m7h = m7g && m7g.inlineH ? parseInt(m7g.inlineH, 10) : 0;
check('M7 小平移记档但不入尺（panSeen=40 < 80px 阈值）', !!m7k && m7k.panSeen >= 30 && m7k.panSeen < 80, m7k ? 'panSeen=' + m7k.panSeen : 'null');
check('M7 仍按 58% 保底停靠（不因 40px 平移缩到 804px）', Math.abs(m7h - GUESS) <= 4, 'height=' + (m7g || {}).inlineH);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok);
if (missingSrc.length) console.log('未构建的锚点：' + missingSrc.join('、'));
console.log('----\n' + (results.length - fails.length) + '/' + results.length + ' 通过');
for (const f of fails) console.log('FAILED: ' + f.desc);
process.exit(fails.length ? 1 : 0);

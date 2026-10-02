// ===== 回归脚本（#657）：信箱写信页「滑动屏幕整页飞出去 / 只显示手机上半屏」=====
// 用户报障（vivo X200S + Edge，明说其他设备型号也有、要求不要覆盖修改引发跨机型回归）：
//   信箱 → 打开写信页面 → 滑动屏幕，页面飞出去、只显示手机上半屏。
//
// 根因（零机型分支；无头 CDP 复现）：软键盘收缩靠 visualViewport 读数，而安卓收键盘/滑动
//   【不 blur】——焦点仍留在写信页输入框（.ce-box）上时，四条兄弟复原路全被挡住：
//     · #209/#236 视口闸：要「vv 回基准」或残留落在浅带（13~22%）；
//     · #267 活焦点闸 / #542 焦点闸：要「无文本元素持活焦点」。
//   读数为滞留小值时 _dK 落在深缩带（≥22%）⇒ 绕开 #236 残留带判定、其余三条全进不去
//   ⇒ .phone 内联收缩高永久停在键盘期数值（实测 414/740＝只显示上半屏），用户往下滑
//   （滑的正是半屏下方的空白区）也不回来；同一现场还会留下「平移补偿成孤儿」的变体：
//   _aPanComp 写下的 .phone 内联 top 失去依据（读数已归零）⇒ 整壳被按旧偏移推下，
//   同样表现为「飞出去 + 只显示上半屏」。
//
// 修复（两条，均零机型分支、纯几何/算术证据；健康设备恒不命中）：
//   RC-1 几何反证复原：可视视口底边以下那块区域若真被软键盘占据，浏览器不会把触摸派发给
//        页面——页面收到落在视口底边以下的真实触摸点 ⇒ 键盘必不在场。命中即按
//        #209/#236/#542 同款动作复原，并置 _aKbMute 闩（读数真的变化/回基准才解除）
//        防残留读数每 250ms 把 .phone 抽回去。
//   RC-2 平移补偿恒等式：_aPanComp 的补偿量恒等于当时读到的残留平移 ⇒ 读数归零而 .phone
//        仍带内联 top 即孤儿，1s 看门狗按恒等式清掉（键盘会话期不参与，避免打断动画期契约）。
//
// 断言（对产物 index.html + 可编程 visualViewport 桩，360×740 Android Edge 形态）：
//   A 轴 源码锚 4 条（修复逻辑在位）
//   B0 设计行为不回归：键盘真在场（读数收缩）时 .phone 仍按可视高收缩
//   B1 【RED 判别点】键盘读数滞留（键盘已收、读数不动）+ 焦点仍在输入框 + 用户在半屏下方
//      空白区滑动 → .phone 必须回到全高（修复前永久停在 414px＝用户报障现场）
//   B2 闩生效：复原后读数仍是滞留小值的静默期内，250ms 轮询不得把 .phone 再抽回（防抽动）
//   B3 防修死：随后真键盘再弹出（读数真的变化）仍照旧收缩
//   B4 零误触发：触摸落在输入框自身（用户去点输入框）不得触发复原
//   B5 【RED 判别点之二】平移补偿孤儿：无会话 + .phone 带内联 top + 读数归零 → 看门狗清掉
//   B6 零 JS 异常
// 用法：node tools/verify-mail-write-kb-stuck.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = normalize(process.env.MOCHI_ROOT ? process.env.MOCHI_ROOT : here + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，设 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9300 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || process.env.TMP || '/tmp', 'mochi-v657kb-' + process.pid + '-' + Date.now()),
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const W = 360, H = 740;
const readSrc = (rel) => readFileSync(join(root, rel), 'utf8');

// ===== A 轴：源码锚（修复逻辑在位；整块删掉即红）=====
console.log('\n== A 轴：源码锚 ==');
{
  const src = readSrc('src/js/mobile-adapt.js');
  chk('A1 几何反证判定在位（触摸点落在可视视口底边以下 ≥24px）',
    /t\.clientY > Math\.round\(\(_aVV\.offsetTop \|\| 0\) \+ _aVV\.height\) \+ 24/.test(src));
  chk('A2 反证命中后的复原动作在位（清内联高/顶对齐 + _aPanComp + kbUndockPanels）',
    /_aKbMute = true; _aVvStale = true;/.test(src) && /_aPhone\.style\.alignSelf = '';\s*\n\s*_aPanComp\(\);\s*\n\s*kbUndockPanels\(\);/.test(src));
  chk('A3 静音闩参与键盘弹出判定（残留读数不得再据它收缩）',
    /var open = \(!_aVvStale && !_aKbMute && h < _aH - 60 && _focNow\)/.test(src)
    && /_aKbMute = false;/.test(src));
  chk('A4 平移补偿恒等式在位（读数归零而 .phone 仍带内联 top＝孤儿，看门狗清掉）',
    /if \(!_aKb && !_aProv && !_aClosing && _aPhone\.style\.top\s*\n\s*&& Math\.abs\(Math\.round\(_aVV\.offsetTop \|\| 0\)\) <= 4\) _aPhone\.style\.removeProperty\('top'\);/.test(src));
  chk('A5 几何反证同样管住悬浮键盘保底停靠（否则复原瞬间被 _aProvDock 按 58% 重新收缩）',
    (src.match(/!_aKb && !_aProv && !_aKbMute/g) || []).length >= 2);
}

// ===== 预置：可编程 visualViewport 桩（resizes-visual：vv 缩、inner 不动）=====
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36 EdgA/152.0.0.0',
  platform: 'Linux armv81',
  userAgentMetadata: { mobile: true, platform: 'Android', platformVersion: '10', architecture: '', model: 'V2458A', brand: 'Edge' }
});
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3.5, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__jsErrors = [];
  window.addEventListener('error', function(e){ window.__jsErrors.push(String(e.message || e)); });
  var L = {};
  var vv = { width: ${W}, height: ${H}, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
    addEventListener: function(t, f){ (L[t] = L[t] || []).push(f); },
    removeEventListener: function(t, f){ var a = L[t] || []; var i = a.indexOf(f); if (i > -1) a.splice(i, 1); },
    dispatchEvent: function(ev){ (L[ev.type] || []).slice().forEach(function(f){ try { f.call(vv, ev); } catch (e) {} }); return true; },
    scrollTo: function(x, y){ var n = (y || 0); if (vv.offsetTop !== n) { vv.offsetTop = n; vv.dispatchEvent({ type: 'scroll' }); } } };
  try { Object.defineProperty(window, 'visualViewport', { configurable: true, get: function(){ return vv; } }); } catch (e) {}
  window.__vv = vv;
  window.__vvSet = function(h){ vv.height = h; vv.dispatchEvent({ type: 'resize' }); };   // 真实读数变化事件
  window.__vvPan = function(o){ vv.offsetTop = o; vv.dispatchEvent({ type: 'scroll' }); };
})();
` });
await cdp('Page.navigate', { url: 'about:blank' });
await evalJs("(function(){ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} return 1; })()");

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(600);
  for (let i = 0; i < 12; i++) {
    const r = await evalJs(`(function(){var m=document.getElementById('splash-mandatory'); if(!m||m.hidden) return 'none'; var sc=document.getElementById('splash-mandatory-scroll'); if(sc) sc.scrollTop=sc.scrollHeight; var en=document.getElementById('splash-mandatory-enter'); if(en&&!en.classList.contains('is-disabled')){en.click();return 'entered';} return 'wait';})()`);
    if (r === 'entered' || r === 'none') break;
    await sleep(250);
  }
  await evalJs("(function(){var s=document.getElementById('splash'); if(s){s.classList.add('hide'); s.style.display='none';} return 1;})()");
  // 关 TA 主动写信（#296 总开关裸读 0）：防列表里混入新来信把写信页流程带偏
  await evalJs("(function(){ localStorage.setItem('xy-home-v2:default:ml-write-en','0'); return window.idbSet('xy-home-v2:default:ml-write-en','0'); })()");
  await sleep(300);
}
async function openWritePage() {
  await evalJs('window.openMailPage()');
  await sleep(700);
  await evalJs("(function(){ var b = document.getElementById('mail-open-write'); if (b) b.click(); return !!b; })()");
  await sleep(700);
}
async function touchSwipe(y0, y1, x = 180) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / 8 }] });
    await sleep(16);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}
// 聚焦写信输入框（真机＝点输入框弹键盘）
async function focusLetterBox() {
  await evalJs("(function(){ var t=document.getElementById('mail-input'); var b=t&&(t.__ceBox||t); if(!b) return 0; b.focus(); b.dispatchEvent(new FocusEvent('focusin',{bubbles:true})); return 1; })()");
  await sleep(200);
}
const STATE = `JSON.stringify((function(){
  var ph = document.querySelector('.phone'); var r = ph.getBoundingClientRect();
  var pg = document.getElementById('page-mail-write');
  var ae = document.activeElement;
  var kb = (window.__mochiAndroidKb && window.__mochiAndroidKb()) || {};
  return { vvH: Math.round(window.__vv.height), inner: window.innerHeight,
    h: ph.style.height, align: ph.style.alignSelf, pos: ph.style.position, top: ph.style.top,
    rectH: Math.round(r.height), rectBottom: Math.round(r.bottom),
    full: Math.abs(Math.round(r.height) - window.innerHeight) <= 12,
    writeOpen: !!(pg && !pg.hidden), focus: ae ? (ae.id || ae.tagName) : null,
    kbOn: !!kb.kbActive, mutedStale: !!kb.staleVv };
})())`;
const st = async () => JSON.parse((await evalJs(STATE)) || 'null');

await boot();
await openWritePage();

console.log('\n== B 轴：写信页键盘现场行为 ==');
{
  const s = await st();
  chk('B0a 写信页已打开且初始 .phone 铺满视口', s && s.writeOpen && s.full, JSON.stringify(s));
}

// 键盘真在场：聚焦 + 读数收缩 → 设计行为＝按可视高收缩（防「把设计收缩当 bug」误改）
await focusLetterBox();
await evalJs('window.__vvSet(414)');            // 键盘弹起（读数缩、无平移）
await sleep(1000);
{
  const s = await st();
  chk('B0b 键盘真在场时 .phone 仍按可视高收缩（设计行为未被改坏）', s && s.kbOn && s.h === '414px', JSON.stringify(s));
}

// B1 【RED 判别点】键盘读数滞留 + 焦点仍在输入框 + 用户在半屏下方空白区滑动 → 必须复原
await sleep(1400);                                // 会话稳定（≥1200ms）且读数已静（≥400ms）
await touchSwipe(650, 560);                       // 触点 clientY 650 >> vv 底边 414 ⇒ 键盘必不在场
await sleep(500);
{
  const s = await st();
  chk('B1 键盘读数滞留时，半屏下方滑动即复原（修复前永久停在 414px＝用户报障「只显示上半屏」）',
    s && s.h === '' && s.align === '' && s.full, JSON.stringify(s));
}

// B2 静音闩：读数仍是滞留小值的静默期内，250ms 轮询不得把 .phone 抽回去
await sleep(900);
{
  const s = await st();
  chk('B2 复原后残留读数不得再把 .phone 抽回（静音闩生效，防缩↔撑抽动）', s && s.h === '' && s.full, JSON.stringify(s));
}

// B3 防修死：真键盘再弹出（读数真的变化）仍照旧收缩
await evalJs('window.__vvSet(740)');
await sleep(400);
await evalJs('window.__vvSet(414)');
await sleep(1000);
{
  const s = await st();
  chk('B3 真键盘再次弹出（读数真的变化）仍照旧收缩（原始职责未修死）', s && s.kbOn && s.h === '414px', JSON.stringify(s));
}

// B4 零误触发：触摸落在输入框自身（用户去点输入框）不得触发复原
await sleep(1200);
{
  const before = await st();
  await touchSwipe(180, 170);                     // 触点落在输入框上（在可视视口内）
  await sleep(500);
  const s = await st();
  chk('B4 触摸落在输入框上不误判（用户去点输入框→不得复原）',
    before && before.h === '414px' && s && s.h === '414px', JSON.stringify(before) + ' -> ' + JSON.stringify(s));
}

// 收键盘（读数回基准＝健康路径）后是干净状态
await evalJs('window.__vvSet(740)');
await sleep(1000);
{
  const s = await st();
  chk('B5a 读数回基准的常规收键盘路径照常复原（未回归）', s && s.h === '' && s.full, JSON.stringify(s));
}

// B5 【RED 判别点之二】平移补偿孤儿：无会话 + .phone 带内联 top + 读数归零 → 看门狗清掉
await evalJs("(function(){ var ph = document.querySelector('.phone'); ph.style.position='relative'; ph.style.top='120px'; return 1; })()");
{
  const s0 = await st();
  await sleep(1400);                              // 1s 看门狗跑过一拍
  const s = await st();
  chk('B5b 平移补偿成孤儿（读数已归零仍带内联 top）被清掉——修复前整壳被推下＝「飞出去」',
    s0 && s0.top === '120px' && s && !s.top, JSON.stringify(s0) + ' -> ' + JSON.stringify(s));
}

// 健康态不回归：平移补偿恒等于读数——读数非零时不得出现「无补偿的孤儿」也不得留下孤儿补偿
await focusLetterBox();
await evalJs("(function(){ window.__vvPan(150); var ph=document.querySelector('.phone'); ph.style.position='relative'; ph.style.top='150px'; return 1; })()");
await sleep(1400);                                // 250ms 轮询 + 1s 看门狗各跑过
{
  const s = await st();
  const off = await evalJs('Math.round(window.__vv.offsetTop || 0)');
  const consistent = !s.top || Math.abs(parseInt(s.top, 10) - off) <= 1;
  chk('B5c 平移读数非零时补偿与读数保持一致（恒等式不误伤真实补偿、也不留孤儿）',
    consistent, JSON.stringify(s) + ' vvOff=' + off);
  await evalJs('window.__vvPan(0); window.__vvSet(740);');
  await sleep(900);
}

{
  const errs = await evalJs('JSON.stringify(window.__jsErrors)');
  chk('B6 全程零 JS 异常', errs === '[]', String(errs).slice(0, 200));
}

console.log('\n-----');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

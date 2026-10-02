// #399 回信页「滑不动 / 一直弹来弹去」行为断言（用户实报，多机型同族）
// 根因：安卓 ceConvert 退场锚点（.ce-ghost）未真正脱离布局流——页面级 min-height 反压
//   height:1px!important，且 absolute 无定位＝沿用流内静态位置；回信页原信越长锚点落得
//   越深，把 .phone（overflow:hidden）的可滚动溢出撑到上千 px，内核「把聚焦元素滚进视野」
//   连带滚走整个手机壳（无复位）＝整壳上移后弹回、页面像滑不动。
// 断言（对产物 index.html，Blink 移动仿真）：
//  A) 幽灵锚点零布局足迹：回信/写信输入框 rect 高 ≤1px（修复前 220px），top/left 在包含块角上
//  B) 回信页（30 行长原信）`.phone` 幻影可滚动溢出 == 0（修复前 1317px）
//  C) 回信页 `.cal-scroll` 仍可滚动（内容超高 + scrollTop 赋值生效）——防「修死滚动」
//  D) 聚焦/滚动到输入框后 `.phone.scrollTop` 仍 0（修复前被内核滚到 234 且无处复位）
//  E) 触摸滑动仍能滚 `.cal-scroll`，且 `.phone.scrollTop` 保持 0
//  F) 写信页同样幻影 0（同源缺陷一并覆盖）
//  G) 聊天页不回归：`.phone` 幻影 0 且 `.chat-body` 仍能滚（overflow:clip 未误伤聊天滚动）
//  H) #497 键盘看门狗（聚焦期 250ms 轮询）不再拽回用户滚动位；几何变化（键盘收缩）仍补位一次
// 用法：node tools/verify-mail-reply-scroll.mjs（对产物 index.html）
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vmrs-' + Date.now()),
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
async function passMandatory() {
  for (let i = 0; i < 12; i++) {
    const r = await evalJs(`(function(){
      var m = document.getElementById('splash-mandatory');
      if (!m || m.hidden) return 'none';
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var en = document.getElementById('splash-mandatory-enter');
      if (en && !en.classList.contains('is-disabled')) { en.click(); return 'entered'; }
      return 'wait';
    })()`);
    if (r === 'entered' || r === 'none') return r;
    await sleep(250);
  }
  return 'timeout';
}
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await passMandatory();
  await sleep(600);
  // 无头环境开屏遮罩定位不稳（会挡住 elementFromPoint），诊断脚本统一强制收起
  await evalJs("(function(){var s=document.getElementById('splash'); if(s){s.classList.add('hide'); s.style.display='none';} return 1;})()");
}
async function touchSwipe(y0, y1) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: y0, id: 1 }] });
  for (let i = 1; i <= 12; i++) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: y0 + (y1 - y0) * i / 12 }] });
    await sleep(16);
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}
const geom = (sel) => evalJs(`JSON.stringify((function(){
  var pg = document.getElementById(${JSON.stringify(sel)});
  if (!pg) return null;
  var ph = document.querySelector('.phone');
  var cs = pg.querySelector('.cal-scroll');
  return { phoneSh: ph.scrollHeight, phoneCh: ph.clientHeight, phonePhantom: ph.scrollHeight - ph.clientHeight,
    phoneSt: Math.round(ph.scrollTop),
    calSh: cs ? cs.scrollHeight : null, calCh: cs ? cs.clientHeight : null, calSt: cs ? Math.round(cs.scrollTop) : null };
})())`);

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: 'about:blank' });
await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);

// 种一封 30 行长信（越长的原信＝修复前幻影溢出越大）；同时关 TA 主动写信（ml-write-en=0，
// #296 总开关裸读 0 生效）——无头环境 TA 自动写信会随机插入短信心且排在列表首位，
// 点错信会让 A0~H2 全部在短内容上空转（H1 假绿实锤过）
await boot();
await evalJs(`(function(){
  var body = [];
  for (var i = 0; i < 30; i++) body.push('第' + (i + 1) + '行：这是一封很长的信，用于撑起回信页的滚动内容，让原信占据大量高度。');
  var list = [{ id: 'L1', type: 'received', tt: '好久不见', content: body.join('\\n'), tm: Date.now() - 3600000, read: true }];
  localStorage.setItem('xy-home-v2:default:mail-letters', JSON.stringify(list));
  localStorage.setItem('xy-home-v2:default:ml-write-en', '0');
  var msgs = [], t0 = 1700000000000;
  for (var j = 0; j < 200; j++) msgs.push({ side: j % 2 ? 'in' : 'out', text: '回信页滚动验证 ' + j + '，用于撑起聊天滚动区', ts: t0 + j * 60000 });
  localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(msgs));
  localStorage.setItem('xy-home-v2:default:chat-meta', JSON.stringify({ n: 200, b: 1200000 }));
  return Promise.all([
    window.idbSet('xy-home-v2:default:mail-letters', JSON.stringify(list)),
    window.idbSet('xy-home-v2:default:ml-write-en', '0'),
    window.idbSet('xy-home-v2:default:chat-msgs', JSON.stringify(msgs)),
    window.idbSet('xy-home-v2:default:chat-meta', JSON.stringify({ n: 200, b: 1200000 }))
  ]);
})()`);
await boot();

// 打开信箱 → 信详情 → 提笔回信（按种子文本选信，防列表混入其他信件）
await evalJs('window.openMailPage()');
await sleep(700);
await evalJs("(function(){ var items = [].slice.call(document.querySelectorAll('#mail-in-list .mail-item')); var it = items.filter(function(x){ return (x.textContent || '').indexOf('第1行') >= 0; })[0] || items[0]; if (it) it.click(); return !!it; })()");
await sleep(600);
await evalJs("(function(){ var b = document.getElementById('mail-reply-btn'); if (b) b.click(); return !!b; })()");
await sleep(800);

// A) 幽灵锚点零布局足迹
{
  const a0 = await evalJs("(function(){ var b = document.querySelector('#page-mail-reply .mail-paper-body'); return b ? b.innerText.length : -1; })()");
  chk('A0 回信页装载的是 30 行长信种子（防 TA 自动写信插入短信心致后续断言空转）', a0 > 800, 'bodyTxt=' + a0);
}
{
  const g = JSON.parse((await evalJs(`JSON.stringify((function(){
    var ta = document.getElementById('mail-reply-input');
    var r = ta.getBoundingClientRect(); var c = getComputedStyle(ta);
    return { h: Math.round(r.height), cls: ta.className, ghost: ta.classList.contains('ce-ghost'),
      pos: c.position, minH: c.minHeight, top: Math.round(r.top), left: Math.round(r.left) };
  })())`)) || 'null');
  chk('A1 回信输入框仍是退场幽灵锚点（安卓 ceConvert 语义未变）', g && g.ghost === true, JSON.stringify(g));
  chk('A2 幽灵锚点高度 ≤1px（修复前被 min-height 反压成 220px）', g && g.h <= 1, JSON.stringify(g));
  chk('A3 幽灵锚点定位钉在包含块角上（top/left 0，不再沿用流内静态位置）', g && g.pos === 'absolute' && g.top <= 1 && g.left <= 1, JSON.stringify(g));
}

// B) 回信页 .phone 幻影溢出
const reply0 = JSON.parse((await geom('page-mail-reply')) || 'null');
chk('B1 回信页 `.phone` 无幻影可滚动溢出（修复前 30 行长信 = 1317px）', reply0 && reply0.phonePhantom === 0, JSON.stringify(reply0));

// C) .cal-scroll 仍可滚
{
  const c = JSON.parse((await evalJs(`JSON.stringify((function(){
    var cs = document.getElementById('page-mail-reply').querySelector('.cal-scroll');
    cs.scrollTop = 300;
    return { st: Math.round(cs.scrollTop), sh: cs.scrollHeight, ch: cs.clientHeight };
  })())`)) || 'null');
  chk('C1 回信页滚动容器仍可滚动（内容超高且 scrollTop 生效，未修死）', c && c.sh > c.ch && c.st > 0, JSON.stringify(c));
}
await evalJs("(function(){ document.getElementById('page-mail-reply').querySelector('.cal-scroll').scrollTop = 0; return 1; })()");

// D) 聚焦 + scrollIntoView 不再滚走手机壳
{
  const d = JSON.parse((await evalJs(`JSON.stringify((function(){
    var ph = document.querySelector('.phone');
    var box = document.getElementById('mail-reply-input').__ceBox;
    var before = Math.round(ph.scrollTop);
    if (box) { box.focus(); box.scrollIntoView({ block: 'center' }); }
    return { before: before, after: Math.round(ph.scrollTop) };
  })())`)) || 'null');
  chk('D1 聚焦/滚动到输入框后手机壳未被滚走（修复前 .phone.scrollTop=234 且无处复位）', d && d.after === 0, JSON.stringify(d));
}

// E) 触摸滑动
{
  await evalJs("(function(){ document.getElementById('page-mail-reply').querySelector('.cal-scroll').scrollTop = 0; document.querySelector('.phone').scrollTop = 0; return 1; })()");
  await sleep(200);
  await touchSwipe(560, 200);
  const e = JSON.parse((await evalJs(`JSON.stringify((function(){
    var ph = document.querySelector('.phone');
    var cs = document.getElementById('page-mail-reply').querySelector('.cal-scroll');
    return { calSt: Math.round(cs.scrollTop), phoneSt: Math.round(ph.scrollTop) };
  })())`)) || 'null');
  chk('E1 触摸滑动仍滚得动回信页内容', e && e.calSt > 0, JSON.stringify(e));
  chk('E2 触摸滑动期间手机壳保持不动（整壳不弹）', e && e.phoneSt === 0, JSON.stringify(e));
}

// H) #497 键盘看门狗（聚焦期 250ms 轮询 nudgeInputVisible）不再拽回用户滚动位：
//    回信输入框在 .cal-scroll 内部，修复前几何不变也每 tick 补位＝用户下滑必被拉回「输入框可见」位
{
  await evalJs("(function(){var ta=document.getElementById('mail-reply-input');var b=ta.__ceBox||ta;b.focus();return 1;})()");
  await sleep(650); // 覆盖 focusin 一次性补位（+300ms）与 ≥2 个看门狗 tick，几何记忆落位
  await evalJs("(function(){document.getElementById('page-mail-reply').querySelector('.cal-scroll').scrollTop=0;return 1;})()");
  await sleep(800); // 跨 ≥3 个 250ms tick：几何不变＝现状出自用户滚动，不得改写
  const h1 = JSON.parse((await evalJs(`JSON.stringify((function(){
    var cs = document.getElementById('page-mail-reply').querySelector('.cal-scroll');
    return { st: Math.round(cs.scrollTop) };
  })())`)) || 'null');
  chk('H1 聚焦输入框后看门狗不再拽回用户滚动位（修复前 250ms 轮询恒拉回 ~106＝「下滑拉回」）', h1 && h1.st <= 12, JSON.stringify(h1));
}
{
  // H2 几何变化（模拟键盘收缩视口）仍补位一次＝「输入法挡住输入栏」原始职责保留（防修死）
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 520, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  const h2 = JSON.parse((await evalJs(`JSON.stringify((function(){
    var cs = document.getElementById('page-mail-reply').querySelector('.cal-scroll');
    var ta = document.getElementById('mail-reply-input');
    var box = ta.__ceBox || ta;
    var br = box.getBoundingClientRect(), sr = cs.getBoundingClientRect();
    return { st: Math.round(cs.scrollTop), gap: Math.round(sr.bottom - br.bottom) };
  })())`)) || 'null');
  chk('H2 几何变化后补位仍生效：输入框回到滚动容器可见区（gap≥-8 或滚动位被调整）', h2 && (h2.gap >= -8 || h2.st > 12), JSON.stringify(h2));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
}

// F) 写信页
await evalJs("(function(){ var b = document.getElementById('mail-reply-back'); if (b) b.click(); return !!b; })()");
await sleep(400);
await evalJs("(function(){ var b = document.getElementById('mail-open-write'); if (b) b.click(); return !!b; })()");
await sleep(600);
{
  const f = JSON.parse((await geom('page-mail-write')) || 'null');
  chk('F1 写信页 `.phone` 同样无幻影溢出（同源缺陷一并覆盖）', f && f.phonePhantom === 0, JSON.stringify(f));
}
await evalJs("(function(){ var b = document.getElementById('mail-write-back'); if (b) b.click(); return !!b; })()");
await sleep(300);

// G) 聊天页不回归
await evalJs("(function(){ var a = document.querySelector('.app[data-app=\"chat\"]'); if (a) a.click(); return !!a; })()");
await sleep(1400);
{
  const g = JSON.parse((await evalJs(`JSON.stringify((function(){
    var ph = document.querySelector('.phone');
    var b = document.getElementById('chat-body');
    if (!b) return null;
    var before = Math.round(b.scrollTop);
    b.scrollTop = 100;
    return { phonePhantom: ph.scrollHeight - ph.clientHeight, phoneSt: Math.round(ph.scrollTop),
      bodySh: b.scrollHeight, bodyCh: b.clientHeight, bodyMoved: Math.round(b.scrollTop) !== before };
  })())`)) || 'null');
  chk('G1 聊天页 `.phone` 无幻影溢出（overflow:clip 未造新溢出）', g && g.phonePhantom === 0, JSON.stringify(g));
  chk('G2 聊天消息区仍可滚动（overflow:clip 未误伤 .chat-body）', g && g.bodySh > g.bodyCh && g.bodyMoved, JSON.stringify(g));
}

console.log('\n-----');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

// ===== 验证（#1466）：桌面页码持久化/恢复＋滑动期提层＋Safari 冻结事务态读守卫＋聊天取证环 =====
// 症状（作者报，iPhone 15 Pro Max／iOS 18.7 Safari，诊断单 mochi-diag-2026-09-29-13-56；
// 明说其他设备型号也有出现、要求不要覆盖式修补）：
//   ① 「聊天记录乱跳一会显示以前的聊天记录一会显示现在的」——#1357 同症状第三次报；
//     同机诊断【最近错误】实证 idbGet 的 onsuccess 里 finish(req.result) 在 Safari 冻结事务态
//     抛 InvalidStateError（@js/idb.js:237）＝读既不成功也不失败、干等等待窗，上层拿旧账渲染；
//     #1357 的取证环当年没落库，本批补上（只读）。
//   ② 「桌面切换123页…过了一会又弹回前面的首页」——本页被系统回收 116 次＝重载后页码不持久；
//   ③ 「滑动桌面时别的页面屏幕只显示一半」——#754 提层只覆盖开了整页背景的桌面，其余桌面
//     翻页时新页瓦片现场栅格化（同机诊断切回桌面最慢 5539ms）。
// 契约（断言口径）：
//   D1 开机恢复上次停留页（钳到实际页数）；D2 翻页落定即持久化；D3 越界钳制；
//   D4 touchstart 起手挂 .swipe-warm 提层、落定 150ms 后摘除（computed will-change 跟随）；
//   D5 __deskSlideDiag 读数；C1~C4 聊天窗口取证环（存在/条数/换装轨迹/窗口起点回挪计数）；
//   I1 __xyIdbBrokeN 只读计数在位；S1~S6 产物锚；E1 全流程零脚本异常。
// RED/GREEN 判别力：纯 HEAD 底本上 S1~S6 全红；D1/D3 因无恢复逻辑落 0 页而红（页数≥2 时）；
//   D2/D4/D5/C1~C4/I1 无对应物必红。⚠ 无头环境复刻不出 Safari 冻结事务态本身（这正是要修的
//   内核差异），idb 守卫以产物锚＋计数在位判，行为侧由真机诊断单的「IDB读异常拦截=N」复核。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(root, urlPath));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1466-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS  ' + name + (extra ? '  [' + extra + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } }
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };

// ============ S 组：产物锚 ============
const idbP = rd('js/idb.js'), chatP = rd('js/chat.js'), sliderP = rd('js/desktop-slider.js'), indexP = rd('index.html');
check('S1 idb 读结果守卫助手（reqResultSafe）', (idbP.match(/function reqResultSafe\(rq\)/g) || []).length === 1);
check('S2 五处事务性 onsuccess 全部过守卫（_rG/_rM/_rL/_rH/_rK）',
  idbP.includes('const _rG = reqResultSafe(req);') && idbP.includes('const _rM = reqResultSafe(req); if (_rM.ok) out[k] = _rM.v;') &&
  idbP.includes('_rL.ok ? (_rL.v || []) : IDB_LIST_FAILED') && idbP.includes("_rH.ok ? ((_rH.v || 0) > 0) : IDB_LIST_FAILED") &&
  idbP.includes('const _rK = reqResultSafe(req);'));
check('S3 聊天取证环（tick/读数口/win 轨迹）',
  (chatP.match(/function chatWinRingTick\(\)/g) || []).length === 1 && chatP.includes('window.__chatWinRing = function') && chatP.includes("chatWinRingMark('win', start, len);"));
check('S4 桌面页码持久化（键名/恢复闸/提层）',
  sliderP.includes("':desk-page-idx'") && sliderP.includes('if (slides.length && !(lastUserSwipeTs && Date.now() - lastUserSwipeTs < 1200)) {') && sliderP.includes("pages.classList.add('swipe-warm');"));
check('S5 诊断「聊天窗口取证」＋「桌面翻页现场」两行',
  indexP.includes("聊天窗口取证：共='") && indexP.includes("桌面翻页现场：页='") && indexP.includes('__deskSlideDiag'));
check('S6 滑动期提层 CSS 规则进产物', /swipe-warm\s*\.page-slide\s*\{\s*will-change:\s*transform/.test(indexP));

// ============ 启动（第 1 次导航：种页码 2＋种 300 条聊天记录） ============
const SEED_MSGS = [];
{ let t = Date.now() - 300 * 60000;
  for (let i = 0; i < 300; i++) { t += 60000; SEED_MSGS.push({ ts: t, side: i % 3 === 0 ? 'out' : 'in', type: 'text', text: '验证1466 第' + i + '条：' + (i % 7 === 0 ? '以前的记录' : '滚动取证') }); } }
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source:
  `try{if(!localStorage.getItem('xy-home-v2:default:desk-page-idx'))localStorage.setItem('xy-home-v2:default:desk-page-idx','2');}catch(e){}
   try{localStorage.setItem('xy-home-v2:default:chat-msgs',${JSON.stringify(JSON.stringify(SEED_MSGS))});}catch(e){}` });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(800);
  await evalJs(`(function(){var b=document.getElementById('splash-confirm-ok')||document.getElementById('splash-enter');if(b)b.click();return !!b;})()`);
  await sleep(300);
  for (let i = 0; i < 20; i++) {
    const r = await evalJs(`(function(){var m=document.getElementById('splash-mandatory');if(!m||m.hidden)return 'none';var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var en=document.getElementById('splash-mandatory-enter');if(en&&!en.classList.contains('is-disabled')){en.click();return 'entered';}return 'wait';})()`);
    if (r === 'entered' || r === 'none') break;
    await sleep(250);
  }
  await evalJs(`(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}var m=document.getElementById('splash-mandatory');if(m)m.hidden=true;return true;})()`);
  await evalJs(`(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()`);
  await sleep(400);
}
await evalJs(`(function(){window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message||e));});return true;})()`);
await boot();

const deskState = async () => evalJs(`(function(){var p=document.getElementById('desktop-pages');var d=document.querySelectorAll('#desktop-dots .dot').length;return JSON.stringify({idx:(window.deskIdx?window.deskIdx():-1),n:d,sl:p?Math.round(p.scrollLeft):-1,cw:p?p.clientWidth:0});})()`);
const st0 = JSON.parse(await deskState());
const NPAGES = st0.n;
const EXP = Math.max(0, Math.min(2, NPAGES - 1));
check('D0 前置：桌面页数读数可得（页数<2 时 D1/D3 退化为钳 0，判定按退化口径）', NPAGES >= 1, '页数=' + NPAGES + ' 现场=' + JSON.stringify(st0));
check('D1【核心】开机恢复上次停留页（种 2 → 恢复到钳制后页）', st0.idx === EXP && (EXP === 0 || st0.sl > (EXP - 0.5) * st0.cw), '期望页=' + EXP + ' 实际=' + JSON.stringify(st0));

// D4：touchstart 起手提层（dispatch＋读数同一次求值＝不被 150ms 摘除计时器赛掉；在切去聊天前先做）
const warmOn = await evalJs(`(function(){var p=document.getElementById('desktop-pages');try{p.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){return JSON.stringify({err:String(e)});}var s=document.querySelector('.page-slide');return JSON.stringify({cls:!!p.classList.contains('swipe-warm'),wc:s?getComputedStyle(s).willChange:'(no slide)'});})()`);
await sleep(450);
const warmOff = await evalJs(`(function(){var p=document.getElementById('desktop-pages');var s=document.querySelector('.page-slide');return JSON.stringify({cls:!!p.classList.contains('swipe-warm'),wc:s?getComputedStyle(s).willChange:'(no slide)'});})()`);
check('D4a touchstart 起手挂 .swipe-warm 且页提层（will-change=transform）', warmOn && JSON.parse(warmOn).cls === true && JSON.parse(warmOn).wc === 'transform', String(warmOn));
check('D4b 落定 150ms 后摘层（will-change 回落）', warmOff && JSON.parse(warmOff).cls === false && JSON.parse(warmOff).wc !== 'transform', String(warmOff));
const diag = await evalJs(`(function(){return window.__deskSlideDiag?JSON.stringify(window.__deskSlideDiag()):'(none)';})()`);
check('D5 __deskSlideDiag 读数（字段齐：页码/页数/滚动位/提层态）',
  diag !== '(none)' && (function () { try { const o = JSON.parse(diag); return typeof o.idx === 'number' && typeof o.n === 'number' && typeof o.sl === 'number' && typeof o.warm === 'boolean'; } catch (e) { return false; } })(),
  String(diag));
{ const di = await evalJs('window.deskIdx?window.deskIdx():-9'); let o = null; try { o = JSON.parse(diag && diag !== '(none)' ? diag : '{}'); } catch (e) {}
  check('D5b __deskSlideDiag.idx 与 deskIdx() 同值', o && o.idx === di, 'diag=' + (o && o.idx) + ' deskIdx=' + di); }

// D2：翻页落定即持久化
await evalJs('if(window.deskGo)window.deskGo(0);true');
await sleep(300);
const saved0 = await evalJs(`localStorage.getItem('xy-home-v2:default:desk-page-idx')`);
let saved1 = null;
if (NPAGES >= 2) { await evalJs('if(window.deskGo)window.deskGo(1);true'); await sleep(300); saved1 = await evalJs(`localStorage.getItem('xy-home-v2:default:desk-page-idx')`); }
check('D2【核心】翻页落定即写命名空间键（deskGo(0)→"0"' + (NPAGES >= 2 ? '；deskGo(1)→"1"' : '') + '）',
  saved0 === '0' && (NPAGES < 2 || saved1 === '1'), 'saved0=' + saved0 + ' saved1=' + saved1);

// D3：越界钳制（种 9 → 恢复到最后一页）
await evalJs(`localStorage.setItem('xy-home-v2:default:desk-page-idx','9')`);
await boot();
const st2 = JSON.parse(await deskState());
check('D3【核心】越界页码钳到实际最后一页（种 9 → 第 ' + (NPAGES - 1) + ' 页）', st2.idx === NPAGES - 1, '实际=' + JSON.stringify(st2));

// ============ C 组：聊天窗口取证环 ============
await evalJs('if(window.deskGo)window.deskGo(0);true');
await sleep(200);
await evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return true;})()`);
await sleep(1400);
let ring = await evalJs(`(function(){return window.__chatWinRing?JSON.stringify(window.__chatWinRing()):'(none)';})()`);
check('C1 取证环读数口在位（backs/progPx/ring/cur）', ring !== '(none)' && (function () { try { const o = JSON.parse(ring); return typeof o.backs === 'number' && typeof o.progPx === 'number' && Array.isArray(o.ring) && !!o.cur; } catch (e) { return false; } })(), ring === '(none)' ? '(none)' : '');
let r0 = null; try { r0 = JSON.parse(ring); } catch (e) {}
let nMsgs = r0 ? r0.cur.n : -1;
for (let i = 0; i < 20 && nMsgs < 300; i++) { await sleep(250); ring = await evalJs(`window.__chatWinRing?JSON.stringify(window.__chatWinRing()):'(none)'`); try { r0 = JSON.parse(ring); nMsgs = r0.cur.n; } catch (e) {} }
check('C2 种 300 条后 cur.n 反映数据条数（读库进内存）', nMsgs >= 300, 'n=' + nMsgs);
check('C3 换装轨迹含 win 节点（进聊天整窗渲染被记录）', !!(r0 && (r0.ring || []).some((e) => e.k === 'win')), 'ring=' + JSON.stringify((r0 && r0.ring) || []).slice(0, 220));
// C4：滚到顶 → 向上加载 → 窗口起点回挪 → back 计数
const loBefore = r0 ? r0.cur.lo : -1;
for (let k = 0; k < 3; k++) {
  await evalJs(`(function(){var b=document.getElementById('chat-body');if(!b)return false;b.scrollTop=0;b.dispatchEvent(new Event('scroll'));return true;})()`);
  await sleep(600);
}
let backs = -1, loAfter = -1;
for (let i = 0; i < 24; i++) {
  ring = await evalJs(`window.__chatWinRing?JSON.stringify(window.__chatWinRing()):'(none)'`);
  try { const o = JSON.parse(ring); backs = o.backs; loAfter = o.cur.lo; if (backs >= 1) break; } catch (e) {}
  await sleep(300);
}
check('C4【核心】窗口起点回挪 >20 条被记为 back（上翻加载更早一段）', backs >= 1 && (loBefore < 0 || loAfter < loBefore), 'lo ' + loBefore + '→' + loAfter + ' backs=' + backs);

// I 组：idb 守卫计数
check('I1 __xyIdbBrokeN 只读计数在位（守卫助手登记）', (await evalJs('typeof window.__xyIdbBrokeN')) === 'number');

// E 组：零异常
const errs = JSON.parse((await evalJs('JSON.stringify(window.__errs)')) || '[]');
check('E1 全流程零脚本异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

// ===== 回归 #1301：切页面那一帧不再被两个「无关也在跑」的观察器/缓存咬住 =====
// 用户实报（iPhone 15 / iOS 18.6.2，桌面图标、切页面最卡，perfcheck＋功能诊断两份）：
// 掉帧 91% 集中在手机桌面，而长任务通道在 iOS 没有观测口（#1226 那条诚实口径），报告读不出
// 主线程到底在干什么。无头 6× 节流把 20 次真触摸切页逐帧归因，抓到两处**与用户动作无关**的常驻成本：
//   ① fullscreen.js 的 #320 全屏游戏抬层观察器挂在 **document.body 整棵子树**
//      （class/hidden/childList），每来一批变更就 rAF 评估一次，而评估开头就是
//      `document.getElementsByClassName('poke-card')` —— 一次**全文档**活集合取长；
//      本应用 91% 的 DOM 住在隐藏页里（实测 16405/18040 节点），切页/渲染每次都把这批
//      记录推进来。#338/#970 已经把「每次评估」压到很低，但**触发评估的条件**从未收窄。
//   ② desktop-slider.js 的「切回桌面」闭包（page-phone 的 hidden 翻回 false 那一帧）：
//      refreshCache() 顺手把 gapCache 清空 ⇒ 下一次 pageStep() 必做一次 getComputedStyle；
//      且无条件写 `pages.scrollLeft`，而刚 display:none→block 的容器上这次写必然把一次
//      同步布局＋滚动位置突变压进用户正看着的那一帧——绝大多数时候位置本来就是对的。
// 修法（零机型／零 UA 分支，判据只取 MutationRecord 里的类名与「读数与目标值差多少」）：
//   ① 先在记录上判「这一批有没有碰 .poke-card」，真碰到才排评估；属性记录只看被改元素自身，
//      childList 只进那棵被插入/移除的子树做局部 querySelector；评估逻辑一字未动。
//   ② refreshCache 只管圆点数组；gap 缓存的作废点挪到真会改它的 resize 与 deskRebuild；
//      落位收成 snapToIdx()，|scrollLeft − 目标| > 1px 才写。
// 用例（无头 CDP 真跑产物，VERIFY_ROOT 指被测副本；断言只取**调用次数**，不取耗时——耗时随机器负载漂移）：
//   S1~S3 产物锚（记录过滤函数／条件落位／refreshCache 不再顺手清 gap）
//   B1 与游戏面板无关的一批 DOM 变更：全文档 getElementsByClassName 调用 0 次（RED 本体①）
//   B2 真触摸切页 ×12：对 #desktop-pages 的 getComputedStyle 0 次（RED 本体②前半）
//   B3 真触摸切页 ×12：#desktop-pages 的 scrollLeft 写入 ≤1 次（RED 本体②后半）
//   B4 对照组：.poke-card 挂 game-fs 仍抬层、撤掉仍还原（证明①没把该管的过滤掉）
//   B5 对照组：点圆点翻页真的落位、scrollLeft 与圆点索引一致（证明②没把该写的省掉）
//   B6 对照组：resize 之后 gap 缓存照旧作废重读（证明作废点只是挪走、没被删掉）
//   Z1 页面零 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
console.log('被测根目录：' + root);
if (!existsSync(join(root, 'index.html')) || !existsSync(join(root, 'js', 'desktop-slider.js'))) {
  console.error('SKIP: 被测根目录没有构建产物（index.html / js/desktop-slider.js）');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const results = []; const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  <- ' + detail : '')); };

// ---- S 组：产物锚（读构建产物本体，不读 src） ----
const fsArt = readFileSync(join(root, 'js', 'fullscreen.js'), 'utf8');
const dsArt = readFileSync(join(root, 'js', 'desktop-slider.js'), 'utf8');
t('S1 产物：抬层观察器改为先在 MutationRecord 上判类名', /_gfsHit\(muts\)/.test(fsArt) && /new MutationObserver\(function \(muts\)/.test(fsArt), '');
t('S2 产物：桌面落位只在真的不在位时写 scrollLeft', /Math\.abs\(pages\.scrollLeft - want\) > 1/.test(dsArt), '');
const rcBlock = (dsArt.split('function refreshCache() {')[1] || '').split('}')[0];
t('S3 产物：refreshCache 只管圆点，不再顺手作废 gap 缓存', rcBlock.includes('dotsCache = getDots();') && !rcBlock.includes('gapCache'), JSON.stringify(rcBlock).slice(0, 60));
t('S4 产物：gap 的作废点仍在（resize＋deskRebuild 两处，没被删成永不失效）', (dsArt.match(/gapCache = null;/g) || []).length >= 2, 'gapCache=null ×' + (dsArt.match(/gapCache = null;/g) || []).length);

// ---- 起浏览器 ----
const port = Number(process.env.MOCHI_CDP_PORT) || (13010 + Math.floor(Math.random() * 180));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1301-' + port + '-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((x) => x.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
if (!ws) { console.error('CDP 连不上（端口 ' + port + ' 可能被占用）'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: Number(process.env.MOCHI_CPU || 4) });
// 计数桩：装在文档脚本之前（本 app 的功能件是 defer 外置脚本，晚于它）——只数、不改行为。
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__c1301 = { ebcn: 0, gcsDesk: 0, slWrite: 0 };
    try {
      localStorage.setItem('xy-home-v2:__guide-done', '1');
      localStorage.setItem('xy-home-v2:__onboard-done', '1');
    } catch (e) {}
    try {
      var dpe = Document.prototype;
      var _o = dpe.getElementsByClassName;
      dpe.getElementsByClassName = function () { window.__c1301.ebcn++; return _o.apply(this, arguments); };
      var _gcs = window.getComputedStyle;
      window.getComputedStyle = function (el) { try { if (el && el.id === 'desktop-pages') window.__c1301.gcsDesk++; } catch (e) {} return _gcs.apply(this, arguments); };
      var sl = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
      Object.defineProperty(Element.prototype, 'scrollLeft', { configurable: true, get: sl.get, set: function (v) { try { if (this.id === 'desktop-pages') window.__c1301.slWrite++; } catch (e) {} return sl.set.call(this, v); } });
    } catch (e) { window.__c1301PatchFail = String(e); }
  `,
});
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(1200);
await ev(`(function(){try{var f=[].slice.call(document.querySelectorAll('script[src]'));return f.length}catch(e){return -1}})()`);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady') === true) break; await sleep(250); }
await sleep(1200);
// 开屏摘节点＋常见遮罩撤除（同 verify-1201 口径）：整页在 splash 未收时不可点，
// 真触摸会全部落在 .splash-btns 上——那样 B2/B3/B5 就是在量「没切页」的空跑。
await ev(`(function(){var sp=document.getElementById('splash');if(sp&&sp.parentNode)sp.parentNode.removeChild(sp);['modal-mask','qa-mask','pc-sheet-mask','backup-remind-bar'].forEach(function(id){var e=document.getElementById(id);if(e){e.hidden=true;e.style.display='none';}});return true})()`);
await sleep(400);
t('P0 桩已装上（计数可用）', await ev('window.__c1301 && typeof window.__c1301.ebcn === "number" && !window.__c1301PatchFail') === true, String(await ev('window.__c1301PatchFail || ""')));
if (await ev('(document.getElementById("page-phone")||{}).hidden') !== false) { console.error('环境不满足：开屏后桌面页没可见'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }

const snap = () => ev('JSON.stringify(window.__c1301)');
const delta = (a, b) => { const x = JSON.parse(a), y = JSON.parse(b); return { ebcn: y.ebcn - x.ebcn, gcsDesk: y.gcsDesk - x.gcsDesk, slWrite: y.slWrite - x.slWrite }; };
const twoFrames = () => ev('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){r(1)})})})');

async function tap(selector) {
  const box = await ev(`(function(){var e=document.querySelector(${JSON.stringify(selector)});if(!e)return '';e.scrollIntoView();var r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0))return '';return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`);
  if (!box || String(box).startsWith('__EXC__')) return false;
  const b = JSON.parse(box);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
  await sleep(60);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return true;
}
// 当前可见页（真触摸到底切没切页的独立证据，不让 B2/B3 变成空跑）
const visPage = () => ev(`(function(){var p=document.querySelector('.page:not([hidden])');return p?p.id:'-'})()`);
async function swipeDesk(dx) {
  const geo = await ev(`(function(){var r=document.getElementById('desktop-pages').getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height-90})})()`);
  const g = JSON.parse(geo);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.x, y: g.y }] });
  const steps = 8;
  for (let i = 1; i <= steps; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g.x + dx * i / steps, y: g.y }] }); await sleep(24); }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}

// ---- B1 与游戏面板无关的一批 DOM 变更：零全文档类名扫描 ----
// 在隐藏页里插入 200 个节点 + 分批 class 切换（没有任何 .poke-card 参与）。
await ev(`(function(){var host=document.getElementById('page-featurehub')||document.querySelector('.page[hidden]');window.__b1host=host;host.querySelectorAll('.b1t').forEach(function(n){n.remove()});return !!host})()`);
let a = await snap();
await ev(`(function(){var h=window.__b1host;var ns=[];for(var i=0;i<200;i++){var d=document.createElement('div');d.className='b1t b1'+(i%3);h.appendChild(d);ns.push(d)}window.__b1ns=ns;return ns.length})()`);
await twoFrames();
for (let k = 0; k < 6; k++) {
  await ev(`(function(){var ns=window.__b1ns||[];for(var i=${k * 20};i<${k * 20 + 20}&&i<ns.length;i++){ns[i].classList.toggle('b1x')}return 1})()`);
  await twoFrames();
}
const d1 = delta(a, await snap());
t('B1 无关变更批次里全文档 getElementsByClassName 0 次（RED①：旧写法每批一次整树扫描）', d1.ebcn === 0, 'ebcn=' + d1.ebcn);

// ---- B2/B3 真触摸切页 ×12：桌面返回帧不再读样式、不再无条件写滚动位置 ----
await ev('window.__c1301.ebcn=0;window.__c1301.gcsDesk=0;window.__c1301.slWrite=0;1');
a = await snap();
let backToDesk = 0, switched = 0;
const seq = ['page-chatcard', 'page-setting', 'page-phone', 'page-chatcard', 'page-phone'];
for (let i = 0; i < 4; i++) {
  for (const pg of seq) {
    await tap('.tab[data-page="' + pg + '"]'); await sleep(360);
    if (await visPage() === pg) switched++; else t('__tapmiss', false, '点 [' + pg + '] 后可见页=' + await visPage());
    if (pg === 'page-phone') backToDesk++;
  }
}
const d23 = delta(a, await snap());
t('P1 真触摸切页全部到位（20 次点按 × 可见页读数，B2/B3 不是空跑）', switched === 20, 'switched=' + switched + '/20 回桌面=' + backToDesk);
t('B2 切页全程对 #desktop-pages 的 getComputedStyle 0 次（RED②前半：旧写法每次回桌面一次强制样式重算）', d23.gcsDesk === 0, 'gcsDesk=' + d23.gcsDesk + ' 回桌面=' + backToDesk);
t('B3 切页全程 #desktop-pages 的 scrollLeft 写入 ≤1 次（RED②后半：旧写法=每次回桌面写一次）', d23.slWrite <= 1, 'slWrite=' + d23.slWrite + ' 回桌面=' + backToDesk);
const idxAfter = await ev('(function(){var d=document.querySelectorAll("#desktop-dots .dot"),k=0;for(var i=0;i<d.length;i++)if(d[i].classList.contains("active"))k=i;return JSON.stringify({dot:k,sl:Math.round(document.getElementById("desktop-pages").scrollLeft)})})()');
t('B3b 对照组：省掉冗余写入后桌面仍在原位（圆点索引与 scrollLeft 一致）', JSON.parse(idxAfter).sl <= 2 && JSON.parse(idxAfter).dot === 0, idxAfter);

// ---- B4 对照组：过滤没把该管的挡掉——game-fs 面板真的仍会抬层/还原 ----
const b4 = await ev(`new Promise(function(res){
  var card=document.createElement('div');card.className='poke-card game-fs';card.id='b1301-card';
  document.getElementById('page-chat').appendChild(card);
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    var on=document.querySelector('.phone').classList.contains('game-fs-active');
    card.hidden=true;
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      var off=document.querySelector('.phone').classList.contains('game-fs-active');
      card.remove();res(JSON.stringify({on:on,off:off}));
    })});
  })});
})`);
t('B4 对照组：.poke-card.game-fs 在场仍抬层、隐藏后仍还原（①没过滤过头）', b4 === '{"on":true,"off":false}', String(b4));

// ---- B5 对照组：该写的仍写得进去——点圆点真的翻页并落位 ----
const stepPx = Number(await ev(`(function(){var p=document.getElementById('desktop-pages');var g=parseFloat(getComputedStyle(p).columnGap)||0;return p.clientWidth+g})()`));
await ev('document.getElementById("desktop-pages").scrollLeft=0;1'); await twoFrames();
const tapDot = await tap('#desktop-dots .dot:nth-child(2)'); await sleep(600);
const b5a = await ev(`JSON.stringify({sl:Math.round(document.getElementById('desktop-pages').scrollLeft),dot:(function(){var d=document.querySelectorAll('#desktop-dots .dot');for(var i=0;i<d.length;i++)if(d[i].classList.contains('active'))return i;return -1})(),idx:window.deskIdx?window.deskIdx():-9})`);
t('B5 对照组：点第 2 颗圆点真的落到第 2 页（②没省掉该写的）', tapDot === true && Math.abs(JSON.parse(b5a).sl - stepPx) <= 2 && JSON.parse(b5a).dot === 1, 'tap=' + tapDot + ' ' + b5a + ' step=' + Math.round(stepPx));
// 真触摸横滑回第 1 页（scroll-snap 吸附 + 圆点每帧跟随仍在）
await swipeDesk(stepPx * 0.75);
await ev('1'); await sleep(300);
const b5b = await ev(`JSON.stringify({sl:Math.round(document.getElementById('desktop-pages').scrollLeft),dot:(function(){var d=document.querySelectorAll('#desktop-dots .dot');for(var i=0;i<d.length;i++)if(d[i].classList.contains('active'))return i;return -1})()})`);
t('B5b 对照组：真触摸横滑回第 1 页并吸附落位（原生翻页未被条件写入卡住）', JSON.parse(b5b).sl <= 2 && JSON.parse(b5b).dot === 0, b5b);

// ---- B6 对照组：resize 之后 gap 缓存照旧作废（作废点只是挪走，没被删） ----
await ev('window.__c1301.gcsDesk=0;1');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 720, deviceScaleFactor: 3, mobile: true });
await sleep(700);
const d6 = Number(await ev('window.__c1301.gcsDesk'));
t('B6 对照组：resize 后步长重算发生（gap 缓存被作废过一次）', d6 >= 1, 'gcsDesk=' + d6);
const b6pos = await ev(`(function(){var p=document.getElementById('desktop-pages');var g=parseFloat(getComputedStyle(p).columnGap)||0;return JSON.stringify({sl:Math.round(p.scrollLeft),want:Math.round(0*(p.clientWidth+g))})})()`);
t('B6b 对照组：resize 后仍在当前页位（重设逻辑没坏）', JSON.parse(b6pos).sl <= 2, b6pos);
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
await sleep(500);

// ---- Z1 零异常 ----
const errs = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('Z1 页面零 JS 异常', errs === 0, 'jsErrors=' + errs + ' ' + JSON.stringify(await ev('(window.__jsErrors||[]).slice(0,3)')).slice(0, 200));

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('==== verify-1301-switch-cost: ' + pass + '/' + results.length + ' ====');
process.exit(pass === results.length ? 0 : 1);

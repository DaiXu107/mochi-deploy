// ===== 回归脚本 #1012：字卡库「长按拖动字卡调整顺序」（公用字卡 / 专属字卡两库）=====
// 用法：node build.mjs && node tools/verify-1012-cc-drag-touch.mjs
// 用户实报：「字卡库里公用字卡和专属字卡。长按拖动字卡无法调整顺序了」
// 两个根因（都是零机型分支、都在本脚本里有判别点）：
//   ①【拖不动】长按 350ms 抓起本来就能成（clone/.cc-dragging 都在），但手机端拖不过第一次
//     移动：.card-list 可纵向滚动，手指一移动浏览器就把这次触摸判成「滚动列表」并当场派发
//     pointercancel，文档级 onUp 立刻摘掉克隆、落点为空＝顺序一张不变（桌面鼠标没有这个
//     手势，所以一直正常）。修法＝拖拽存续期按住 touchmove＋卡片行不长按选字（长按期间
//     系统选字手势会接管这次触摸，走同一条 pointercancel 路径）。
//   ②【拖了不留】写守卫的营救合并（mergeCcGroupsInto）只并集卡片、顺序一律取权威库，
//     于是「权威库尚未进内存」时（大库被启动回填挂起 ⇒ ccAuthSeen 整会话不解除）每次拖动
//     都被整段还原。修法＝并集之后把内存侧相对顺序回填到「两边都有的位置」上，权威独有卡
//     原位不动（#193 防覆盖语义不变）。
// 覆盖：S 源锚 8 / P 夹具前提 3 / U 营救合并单元断言 5 / A 公用库触屏拖动 5 /
//       B 专属库触屏拖动 2 / C 不回归 3（350ms 内滑动不抓手势、鼠标拖动、轻点仍打开编辑）/ Z 零异常 1
// 需要：Node 21+（全局 WebSocket）＋本机 Chrome/Edge（CHROME_PATH 可指定）
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
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// ---------- S 源锚（修复本体是否还在 src 里） ----------
const src = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8').replace(/\r\n/g, '\n');
check('S1 拖拽期挂 touchmove 守卫（passive:false）', src.includes("document.addEventListener('touchmove', stopPan, { passive: false });"));
check('S2 松手/取消摘掉守卫', src.includes("document.removeEventListener('touchmove', stopPan);"));
check('S3 守卫行为本体＝拦截可取消的 touchmove', src.includes("stopPan = (ev) => { if (ev.cancelable) ev.preventDefault(); };"));
check('S4 可拖卡片行不长按选字（标准形态）', src.includes("el.style.setProperty('user-select', 'none');"));
check('S5 同上的 WebKit 形态', src.includes("el.style.setProperty('-webkit-user-select', 'none');"));
check('S6 系统长按浮标关闭（iOS callout）', src.includes("el.style.setProperty('-webkit-touch-callout', 'none');"));
check('S7 营救合并保住内存侧相对顺序', src.includes('const shared = memU.filter(c => g[1].indexOf(c) >= 0);'));
check('S8 顺序只回填「两边都有的位置」', src.includes('for (let i = 0; i < g[1].length; i++) if (shared.indexOf(g[1][i]) >= 0) g[1][i] = shared[k++];'));

// ---------- U 营救合并单元断言（直接抽 src 里的函数跑夹具，不依赖浏览器） ----------
const mSrc = src.match(/function mergeCcGroupsInto\(auth, mem\) \{[\s\S]*?\n  \}/);
check('U0 能从 src 抽出 mergeCcGroupsInto', !!mSrc);
let M = null;
if (mSrc) { try { M = new Function('return (' + mSrc[0] + ')')(); } catch (e) { M = null; } }
const g0 = (t) => (t && t.text && t.text[0] && t.text[0][1]) || null;
function mergeT(authText, memText) { return g0(M({ text: [['G', authText.slice()]] }, { text: [['G', memText.slice()]] })); }
if (M) {
  check('U1 内存侧顺序（拖动结果）在合并后保留', JSON.stringify(mergeT(['A', 'B', 'C'], ['C', 'A', 'B'])) === JSON.stringify(['C', 'A', 'B']), mergeT(['A', 'B', 'C'], ['C', 'A', 'B']));
  check('U2 权威侧独有的卡原地不动、顺序回填绕开它', JSON.stringify(mergeT(['A', 'D', 'B', 'C'], ['C', 'A', 'B'])) === JSON.stringify(['C', 'D', 'A', 'B']), mergeT(['A', 'D', 'B', 'C'], ['C', 'A', 'B']));
  check('U3 内存侧独有的卡照样并入（并集语义不回归）', JSON.stringify(mergeT(['A', 'B', 'C'], ['C', 'NEW', 'A', 'B'])) === JSON.stringify(['C', 'NEW', 'A', 'B']), mergeT(['A', 'B', 'C'], ['C', 'NEW', 'A', 'B']));
  const keep = M({ text: [['G', ['A', 'B', 'C']], ['H', ['X']]] }, { text: [['G', ['C', 'B', 'A']]] });
  check('U4 权威库其他分组与其他分类一张不丢（#193 防覆盖语义）', !!keep && keep.text.length === 2 && JSON.stringify(keep.text[1][1]) === JSON.stringify(['X']) && keep.text[0][1].length === 3, keep && keep.text);
  check('U5 同分组有重复卡时退回旧口径（不动顺序）', JSON.stringify(mergeT(['A', 'A', 'B'], ['B', 'A', 'A'])) === JSON.stringify(['A', 'A', 'B']), mergeT(['A', 'A', 'B'], ['B', 'A', 'A']));
} else {
  ['U1 内存侧顺序（拖动结果）在合并后保留', 'U2 权威侧独有的卡原地不动、顺序回填绕开它', 'U3 内存侧独有的卡照样并入（并集语义不回归）', 'U4 权威库其他分组与其他分类一张不丢（#193 防覆盖语义）', 'U5 同分组有重复卡时退回旧口径（不动顺序）'].forEach((d) => check(d, false, 'mergeCcGroupsInto 抽取失败'));
}

// ---------- 浏览器夹具 ----------
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1012-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__vEv = [];
  ['pointerdown','pointercancel','touchcancel','contextmenu','click','selectstart'].forEach(function (t) {
    document.addEventListener(t, function () { if (window.__vEv.length < 200) window.__vEv.push(t); }, true);
  });
` });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  // 开屏有「勾选年龄 + 滑到底 + 点进入」三道闸；无头里直接摘掉节点
  //（.splash:not(.hide) ~ .phone 会隐藏整页，留着会让所有落点都打在开屏上）
  await evalJs("(function(){var s=document.getElementById('splash');if(!s)return 'gone';s.classList.add('hide');setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s);},30);return 'hidden';})()");
  await sleep(2200);
  await killMasks();
}
async function killMasks() {
  await evalJs(`(function(){
    ['modal-mask','qa-mask','tc-mask','cc-scope-mask','cc-export-mask'].forEach(function(id){
      var m=document.getElementById(id); if(!m) return; m.hidden=true; m.style.display='none';
    });
    document.body.classList.remove('scroll-lock');
    return true;
  })()`);
  await sleep(120);
}
async function openLib(which) {
  await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return !!t;})()");
  await sleep(450);
  await killMasks();
  await evalJs("(function(){var li=document.getElementById('" + which + "');if(li)li.click();return !!li;})()");
  await sleep(650);
  await killMasks();
}
const itemsExpr = `(function(){
  return Array.from(document.querySelectorAll('#cc-list .cc-item')).map(function(d){
    var t=d.querySelector('.cc-txt .t')||d.querySelector('.cc-txt');
    return t?t.textContent.trim():'?';
  });
})()`;
function lsExpr(key) {
  return `(function(){try{var g=JSON.parse(localStorage.getItem('${key}'));var out={};Object.keys(g).forEach(function(t){(g[t]||[]).forEach(function(grp){out[grp[0]]=grp[1].slice();});});return out;}catch(e){return 'err';}})()`;
}
const PUB = 'xy-home-v2:cc-groups-public';
const OWN = 'xy-home-v2:default:cc-groups';

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(1200);
const seeded = await evalJs(`(async function(){
  try{
    var today=new Date(), p=function(n){return n<10?'0'+n:''+n;};
    localStorage.setItem('xy-home-v2:contacts',JSON.stringify([{id:'default',name:'默认'}]));
    localStorage.setItem('xy-home-v2:active-contact','default');
    localStorage.setItem('xy-home-v2:cc-scope-migrated','1');
    localStorage.setItem('xy-home-v2:cc-scope-notice-done','1');
    localStorage.setItem('xy-home-v2:age-confirmed','1');
    localStorage.setItem('xy-home-v2:splash-seen:'+today.getFullYear()+'-'+p(today.getMonth()+1)+'-'+p(today.getDate()),'1');
    var pub=JSON.stringify({text:[['公用组',['A一','B二','C三']]]});
    var own=JSON.stringify({text:[['专属组',['D四','E五']]]});
    localStorage.setItem('${PUB}',pub);
    localStorage.setItem('${OWN}',own);
    if(window.idbSet){ await window.idbSet('${PUB}',pub); await window.idbSet('${OWN}',own); }
    return true;
  }catch(e){ return 'err:'+e.message; }
})()`);
check('P1 字卡种子写入成功（公用 3 张 / 专属 2 张）', seeded === true, seeded);

// ---------- 拖动工具 ----------
async function surfaces() { return await evalJs("({clone:document.querySelectorAll('.cc-drag-clone').length, drag:document.querySelectorAll('.cc-item.cc-dragging').length, line:document.querySelectorAll('#cc-list .cc-drop-line').length})"); }
async function topY() { return await evalJs("(function(){var l=document.getElementById('cc-list');var r=l.getBoundingClientRect();return Math.round(r.top+6);})()"); }
async function startPoint(idx) {
  return JSON.parse(await evalJs("(function(){var it=document.querySelectorAll('#cc-list .cc-item')[" + idx + "];var b=it.getBoundingClientRect();return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)});})()") || 'null');
}
// 落点被弹层挡住时会吃掉 pointerdown（测出来是假红）——先确认最上层就是目标卡片
async function ensureHittable(x, y) {
  for (let i = 0; i < 3; i++) {
    const ok = await evalJs("(function(){var e=document.elementFromPoint(" + x + ',' + y + ");return !!(e&&e.closest&&e.closest('#cc-list .cc-item'));})()");
    if (ok) return true;
    await killMasks();
  }
  return false;
}
// 落库是异步的（写守卫命中时先走营救合并再落盘）——轮询到期望顺序为止
async function waitOrder(key, group, expected, ms) {
  const t0 = Date.now();
  let last = null, dom = null;
  while (Date.now() - t0 < ms) {
    const ls = await evalJs(lsExpr(key));
    last = ls && ls[group] ? ls[group] : null;
    dom = await evalJs(itemsExpr);
    if (last && JSON.stringify(last) === JSON.stringify(expected)) return { ok: true, ls: last, dom, waited: Date.now() - t0 };
    await sleep(250);
  }
  return { ok: false, ls: last, dom, waited: Date.now() - t0 };
}
async function touchDragToTop(idx) {
  await evalJs('window.__vEv.length=0');
  const P = await startPoint(idx);
  const hit = await ensureHittable(P.x, P.y);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: P.x, y: P.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
  await sleep(500); // 长按 350ms 抓起
  const grabbed = await surfaces();
  const ty = await topY();
  for (let i = 1; i <= 8; i++) {
    const y = Math.round(P.y + (ty - P.y) * i / 8);
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: P.x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
    await sleep(55);
  }
  const mid = await surfaces();
  const evs = await evalJs('window.__vEv.join(",")');
  const lineIdx = await evalJs("(function(){var l=document.querySelector('#cc-list .cc-drop-line');return l&&l.parentNode?Array.prototype.indexOf.call(l.parentNode.children,l):-1;})()");
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(600);
  const after = await surfaces();
  return { hit, grabbed, mid, evs: String(evs || ''), lineIdx, after };
}

// ---------- A 公用字卡库（触屏） ----------
await loadApp();
await openLib('li-custom-cards-public');
const titlePub = await evalJs("(function(){var t=document.getElementById('cc-page-title');return t?t.textContent:'';})()");
const pubBefore = await evalJs(itemsExpr);
check('P2 进入公用字卡库＝3 张且顺序 A一,B二,C三 原样', titlePub === '公用字卡' && JSON.stringify(pubBefore) === JSON.stringify(['A一', 'B二', 'C三']), titlePub + ' ' + JSON.stringify(pubBefore));

const A = await touchDragToTop(2); // 拖第 3 张到最前
check('A1 长按 350ms 抓起成功（克隆 + .cc-dragging）', A.grabbed.clone === 1 && A.grabbed.drag === 1, A.grabbed);
check('A2 拖动中无 pointercancel 且落点指示出现在第一张之前', !A.evs.includes('pointercancel') && A.mid.line === 1 && A.lineIdx === 1, { evs: A.evs, mid: A.mid, lineIdx: A.lineIdx });
const pubWait = await waitOrder(PUB, '公用组', ['C三', 'A一', 'B二'], 6000);
check('A3 公用库落库顺序＝C三,A一,B二（含营救路径异步落盘）', pubWait.ok, pubWait);
check('A4 公用库列表 DOM 同步为 C三,A一,B二', JSON.stringify(pubWait.dom) === JSON.stringify(['C三', 'A一', 'B二']), pubWait.dom);
check('A5 松手后无残留（克隆/拖拽态/落点线都清）', A.after.clone === 0 && A.after.drag === 0 && A.after.line === 0, A.after);

// ---------- B 专属字卡库（触屏，同一条代码路径） ----------
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return !!b;})()");
await sleep(500);
await openLib('li-custom-cards');
const titleOwn = await evalJs("(function(){var t=document.getElementById('cc-page-title');return t?t.textContent:'';})()");
const ownBefore = await evalJs(itemsExpr);
check('P3 进入专属字卡库＝2 张且顺序 D四,E五 原样', titleOwn === '专属字卡' && JSON.stringify(ownBefore) === JSON.stringify(['D四', 'E五']), titleOwn + ' ' + JSON.stringify(ownBefore));
const Bd = await touchDragToTop(1); // 拖第 2 张到最前
const ownWait = await waitOrder(OWN, '专属组', ['E五', 'D四'], 6000);
check('B1 专属库落库顺序＝E五,D四', ownWait.ok, { ls: ownWait.ls, waited: ownWait.waited, grabbed: Bd.grabbed });
check('B2 专属库列表 DOM 同步为 E五,D四', JSON.stringify(ownWait.dom) === JSON.stringify(['E五', 'D四']), ownWait.dom);

// ---------- C 不回归 ----------
// C1 350ms 内就滑动＝用户的滚动意图：不该被抓成拖拽（守卫只在拖拽存续期挂载）
const Pc = await startPoint(1);
await ensureHittable(Pc.x, Pc.y);
const scrollBefore = await evalJs("(function(){var l=document.getElementById('cc-list');return Math.round(l.scrollTop);})()");
await evalJs('window.__vEv.length=0');
await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Pc.x, y: Pc.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
for (let i = 1; i <= 5; i++) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Pc.x, y: Pc.y - 20 * i, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
  await sleep(28);
}
await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(600);
const c1 = await surfaces();
const scrollAfter = await evalJs("(function(){var l=document.getElementById('cc-list');return Math.round(l.scrollTop);})()");
check('C1 350ms 内滑走＝不抢手势（未抓起克隆；滚动位移作参考）', c1.clone === 0 && c1.drag === 0, { surfaces: c1, scrollTop: [scrollBefore, scrollAfter] });

// C2 桌面鼠标长按拖动仍生效（同一套 pointer 路径）
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return !!b;})()");
await sleep(400);
await openLib('li-custom-cards-public');
await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
const before2 = await evalJs(lsExpr(PUB));
const Pm = await startPoint(2);
await ensureHittable(Pm.x, Pm.y);
const tym = await topY();
await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: Pm.x, y: Pm.y, button: 'left', clickCount: 1, buttons: 1 });
await sleep(500);
for (let i = 1; i <= 8; i++) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Pm.x, y: Math.round(Pm.y + (tym - Pm.y) * i / 8), buttons: 1 });
  await sleep(55);
}
await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Pm.x, y: tym, button: 'left', clickCount: 1, buttons: 0 });
await sleep(700);
const after2 = await evalJs(lsExpr(PUB));
check('C2 桌面鼠标长按拖动仍生效（顺序被改写）', JSON.stringify(after2 && after2['公用组']) !== JSON.stringify(before2 && before2['公用组']), { before: before2 && before2['公用组'], after: after2 && after2['公用组'] });

// C3 轻点卡片仍打开编辑弹窗（改动没吞掉点击）
const Pt = await startPoint(0);
await ensureHittable(Pt.x, Pt.y);
await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Pt.x, y: Pt.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
await sleep(90);
await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(700);
const modal = await evalJs("(function(){var m=document.getElementById('modal-mask');var t=document.getElementById('modal-title');return (m&&!m.hidden?t?t.textContent:'open':'closed');})()");
check('C3 轻点卡片仍打开「编辑字卡」弹窗', modal === '编辑字卡', modal);

const errs = await evalJs('JSON.stringify((window.__jsErrors||[]).slice(0,3))');
check('Z1 全程无 JS 异常', errs === '[]', errs);

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

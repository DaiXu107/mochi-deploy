// ===== 常驻回归：#989 桌面页竖向滚动护栏（用户 2026-09-21 红米 K80 Chrome 实报，浏览器模式非全屏：
//   「桌面的第一页和第二页的图标按钮和文字还是没有完全对齐，但是我看第二页按钮和文字和第三页的
//     图标按钮和文字是完全对齐的」，随后追报「我发现现在第三页也没有对齐了」＝错位会换页出现）=====
// 根因（无头实证，零机型分支）：桌面页内容高 636px（页底 18px 留白 + 图标组尾部 6+8px），
//   浏览器模式（地址栏占高）下桌面区只有 ~610px ⇒ 每页都成了可竖向滚动容器，而溢出的 26px
//   **全是不可见尾垫**（最深实心盒下沿 604，滚下去什么也看不到）。翻页时手指斜滑被内核轴锁判成
//   竖向 ⇒ 滚动量落在「起手那一页」上且无人复位 ⇒ 该页图标+文字整块上移，与另两页错开（无头实证
//   page0.scrollTop=20 ⇒ 行 y 427.3/537.3 vs 另两页 447.3/557.3，Δ=20 精确等于残留滚动量）。
//   旧验证全跑 390×844（桌面区 714 > 内容 636）⇒ 桌面页根本不可滚，本 bug 在验证里结构性不可见。
// 断言：
//   S 组＝产物源锚（红侧必红）：护栏代码在 src 与产物（index.html / js/desktop-slider.js）在位
//   B 组＝行为面（真浏览器；B1/B2/B3 红侧必红）：
//     B1 矮视口（桌面区 610 < 内容 636）每页都不再是可竖滚容器（内联 overflow-y:hidden）
//     B2 矮视口下人为留 20px 滚动量 → 护栏复核后自愈，三页图标行 Δ=0（红侧 Δ=20）
//     B3 同上但落在第三页（用户追报「第三页也没有对齐了」）→ 自愈、三页 Δ=0
//   C 组＝防修过头（两侧同过）：
//     C1 高视口（无溢出）不得加任何内联 overflow（零视觉/零行为变化）
//     C2 真溢出（页里加 200px 组件、图标被顶到折下）仍可竖滚（不得吞掉用户要看的内容）
//        —— #1013 教训：本条只「写完立刻读再归零」＝恰好绕开「停不住」那一半，
//           「滚到底被弹回顶部」就是在这里全绿上线的，落定后还在不在底部交给 D1 判
//     C3 矮视口默认态三页图标行本来就对齐（护栏不得把好状态弄坏）
//     C4 横向翻页仍可用（护栏不得破坏桌面分页：deskGo 翻页 + 圆点跟随）
//   D 组＝#1013 真机症状面（vivo S30 / Edge 实报「在桌面滑动屏幕会回拉，无法滑到下面」）：
//     D1 真溢出页滚到底后，连续再滚第二次仍不回弹（用户反复下滑＝反复被拉回顶部）
//     D2 异步内容晚到（桌面图片组件解码前高 0px、那一拍被误判裁掉）在图片到位后必须自动解锁
//     D3 上述自动解锁不得顺手把另两页的 #989 裁决改回去（另两页仍 hidden）
//   Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-989-desk-page-scroll.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// #1013 D3 夹具：延迟 1.4s 才回包的 1×1 PNG（＝桌面图片组件「解码前高 0px」那一拍）
const SLOW_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const server = createServer((req, res) => {
  try {
    if (req.url.indexOf('/__slow.png') === 0) {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); res.end(SLOW_PNG); }, 1400);
      return;
    }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9880 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-989-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            const desc = (d && ((d.exception && d.exception.description) || d.text)) || 'err';
            jsExcepts.push(String(desc).split('\n').slice(0, 2).join(' | ').slice(0, 180));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r && r.result ? r.result.value : null;
}

async function waitFor(expr, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await evalJs(expr);
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await sleep(120);
  }
}
let pass = 0, fail = 0;
const check = (d, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } else { fail++; console.log('  FAIL  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } };

// ---------- S 组：产物源锚（红侧必红）----------
console.log('[S] 源锚（src + 产物双查）');
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };
const readProd = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
const srcSlider = readSrc('js/desktop-slider.js');
const prodIndex = readProd('index.html');
const prodSlider = readProd('js/desktop-slider.js');
// 逻辑锚（不是名字）：判据整行 + 归零整行 + 事件接线整行
const NEEDLES = [
  ['S1 判据：溢出为 0 或「翻下去什么也看不到」才裁（删＝护栏失效，残留滚动量又留在页上）',
    "blind = over > 0 && inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop) <= sl.clientHeight + 1;"], // #1201 起该行改成先 `let blind;` 再赋值（记忆化两条分支共用一个变量），故锚去掉 `const ` 前缀＝两侧同一判据本体
  ['S7 #1013 判据基准＝未滚动内容坐标（缺 − scrollTop＝页越滚到底越像「看不到东西」，滚到底被弹回顶部）',
    'inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop)'],
  ['S8 #1013 异步载荷到位后复核（缺＝图片组件解码前那一拍被误裁，之后没人再复核＝有内容却滚不动）',
    "pages.addEventListener('load', () => pageScrollGuard.later(400), true);"],
  ['S2 落刀：该页设 overflow-y:hidden 并归零滚动量（删＝页面仍是可竖滚容器）',
    "if (sl.style.overflowY !== 'hidden') sl.style.overflowY = 'hidden';"],
  ['S3 防修过头：真溢出回落 auto（删＝用户加满组件的页再也滚不到底部内容）',
    "if (sl.style.overflowY) sl.style.overflowY = '';   // 回落到 CSS 的 auto"],
  ['S4 滚动落定后复核（删＝斜滑留下的滚动量没人复位）',
    "pages.addEventListener('scroll', () => pageScrollGuard.later(300), true);"],
  ['S5 回桌面当帧复核（删＝进桌面时残留错位仍在）',
    'pageScrollGuard.later(60); // #989：回桌面复核一次']
];
NEEDLES.forEach(([n, needle]) => {
  check(n + '（src）', srcSlider.indexOf(needle) >= 0);
  // 产物侧查外置那份（#860 起 core 全外置，浏览器实载的就是它；index.html 里没有这段）
  check(n + '（产物 js/desktop-slider.js）', prodSlider.indexOf(needle) >= 0);
});
check('S6 外置产物 js/desktop-slider.js 含护栏（#860 外置后浏览器实载那份）',
  prodSlider.indexOf('pageScrollGuard') >= 0 && prodSlider.indexOf('inkBottom') >= 0);

// ---------- 浏览器 ----------
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
const setVp = (w, h) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
const boot = async () => {
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('xy-home-v2:__guide-done','1');localStorage.setItem('xy-home-v2:__onboard-done','1');}catch(e){}"
  });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  // 关开屏/备份提醒/弹窗遮罩（只影响可见性，不动布局）。
  // ⚠️ 开屏必须**摘掉节点**而不是 hidden/display:none——base.css 的
  // `.splash:not(.hide) ~ .phone{visibility:hidden}` 只看 DOM 兄弟关系，留着节点整页仍是
  // visibility:hidden，页内每个盒子都被量成「不可见」（护栏会因此跳过该页 → B 组假红）。
  await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&sp.parentNode)sp.parentNode.removeChild(sp);['modal-mask','qa-mask','pc-sheet-mask','backup-remind-bar'].forEach(function(id){var e=document.getElementById(id);if(e){e.hidden=true;e.style.display='none';}});return true;})()");
  await sleep(400);
};
// 三页图标行（相对各自页顶的 y）与跨页「从底部数」误差
const rowsProbe = `(function(){
  var slides=document.querySelectorAll('#desktop-pages .page-slide');
  var out=[];
  slides.forEach(function(sl){
    var g=sl.querySelector('.app-grid'); if(!g){out.push([]);return;}
    var top=sl.getBoundingClientRect().top, ys=[];
    Array.prototype.forEach.call(g.querySelectorAll('.app'),function(a){
      if(a.hasAttribute('hidden')||getComputedStyle(a).display==='none')return;
      var y=Math.round((a.getBoundingClientRect().top-top)*10)/10;
      if(ys.indexOf(y)<0)ys.push(y);
    });
    ys.sort(function(a,b){return a-b;}); out.push(ys);
  });
  return JSON.stringify(out);
})()`;
const crossDelta = (rows) => {
  const max = Math.max.apply(null, rows.map((r) => r.length));
  let worst = 0, detail = [];
  for (let fb = 1; fb <= max; fb++) {
    const vals = rows.map((r) => (r.length - fb >= 0 ? r[r.length - fb] : null)).filter((v) => v !== null);
    if (vals.length < 2) continue;
    const d = Math.round((Math.max.apply(null, vals) - Math.min.apply(null, vals)) * 10) / 10;
    detail.push('倒数第' + fb + '行Δ=' + d);
    if (d > worst) worst = d;
  }
  return { worst: worst, detail: detail.join(' ') };
};
const inlineOY = () => evalJs(`(function(){return [].map.call(document.querySelectorAll('#desktop-pages .page-slide'),function(s){return s.style.overflowY||'(none)';}).join(',');})()`);
const scrollInfo = (i) => evalJs(`(function(){var s=document.querySelectorAll('#desktop-pages .page-slide')[${i}];return s.scrollHeight+'-'+s.clientHeight+'='+(s.scrollHeight-s.clientHeight)+' top='+s.scrollTop;})()`);

// ---------- B 组：矮视口（浏览器模式：桌面区 610 < 内容 636）----------
console.log('[B] 行为面（矮视口 393×740＝浏览器模式桌面区 610 < 内容 636）');
await setVp(393, 740);
await boot();
check('B0 前置：矮视口下桌面页确实溢出（否则本组无判别力）',
  /=\d+ top=/.test(String(await scrollInfo(0))) && !/=0 top=/.test(String(await scrollInfo(0))), await scrollInfo(0));
// 护栏在开屏收起后可能有界重试（最多 8×800ms），给足等待再断言
await waitFor("(function(){return [].every.call(document.querySelectorAll('#desktop-pages .page-slide'),function(s){return s.style.overflowY==='hidden';});})()", 4000);
check('B1 每页都不再是可竖滚容器（内联 overflow-y:hidden）',
  String(await inlineOY()) === 'hidden,hidden,hidden', String(await inlineOY()));
// 人为留残留滚动量（＝用户斜滑翻页留下的那一份），等护栏复核
await evalJs("(function(){var s=document.querySelectorAll('#desktop-pages .page-slide');s[0].scrollTop=20;return s[0].scrollTop;})()");
await sleep(900);
const r1 = JSON.parse(await evalJs(rowsProbe) || '[]');
const d1 = crossDelta(r1);
check('B2 第一页残留 20px 自愈、三页图标行对齐（红侧 Δ=20）', d1.worst <= 0.6, d1.detail + ' | ' + await scrollInfo(0));
await evalJs("(function(){var s=document.querySelectorAll('#desktop-pages .page-slide');s[2].scrollTop=20;return s[2].scrollTop;})()");
await sleep(900);
const r2 = JSON.parse(await evalJs(rowsProbe) || '[]');
const d2 = crossDelta(r2);
check('B3 第三页残留 20px 同样自愈（用户追报「第三页也没有对齐了」）', d2.worst <= 0.6, d2.detail + ' | ' + await scrollInfo(2));
// 先把上面两条人为留的滚动量清干净，再看默认态本身是否对齐（两侧同过＝防修过头）
await evalJs("(function(){[].forEach.call(document.querySelectorAll('#desktop-pages .page-slide'),function(s){s.scrollTop=0;});return true;})()");
await sleep(500);
check('B4 矮视口默认态本就对齐（护栏没把好状态弄坏）', crossDelta(JSON.parse(await evalJs(rowsProbe) || '[]')).worst <= 0.6);

// ---------- C 组：防修过头 ----------
console.log('[C] 防修过头（两侧同过）');
// C1 高视口（桌面区 744 > 内容 636）：不得加任何内联 overflow
await setVp(393, 873);
await boot();
check('C1 高视口无溢出：三页都不加内联 overflow（零变化）',
  String(await inlineOY()) === '(none),(none),(none)', String(await inlineOY()));
check('C1b 高视口三页图标行对齐', crossDelta(JSON.parse(await evalJs(rowsProbe) || '[]')).worst <= 0.6);
// C2 真溢出：矮视口给第一页塞 200px 组件 → 图标被顶到折下，必须仍可竖滚
await setVp(393, 740);
await boot();
await evalJs("(function(){var sl=document.querySelectorAll('#desktop-pages .page-slide')[0];var g=sl.querySelector('.app-grid');var d=document.createElement('div');d.className='desk-clock glass';d.setAttribute('data-desk-widget','desk-clock');d.style.height='200px';d.style.margin='0 0 14px';sl.insertBefore(d,g);return true;})()");
await waitFor("(function(){return document.querySelectorAll('#desktop-pages .page-slide')[0].style.overflowY!=='hidden';})()", 3000);
const c2Info = String(await scrollInfo(0));
const c2Inline = String(await inlineOY());
const c2Writable = await evalJs("(function(){var s=document.querySelectorAll('#desktop-pages .page-slide')[0];var m=s.scrollHeight-s.clientHeight;s.scrollTop=m;var got=s.scrollTop;s.scrollTop=0;return m>0&&got>0;})()");
check('C2 真溢出（加 200px 组件）仍可竖滚、不被吞内容', c2Inline.split(',')[0] !== 'hidden' && c2Writable === true,
  'overflowY=' + c2Inline.split(',')[0] + ' 可滚=' + c2Writable + ' ' + c2Info);
// C3 横向翻页仍可用
await setVp(393, 740);
await boot();
const goRes = await evalJs("(function(){var dp=document.getElementById('desktop-pages');var before=dp.scrollLeft;window.deskGo(2);return JSON.stringify({before:before,after:dp.scrollLeft,idx:window.deskIdx(),w:dp.clientWidth});})()");
const goObj = (() => { try { return JSON.parse(goRes); } catch (e) { return {}; } })();
check('C3 横向翻页仍可用（deskGo 翻到第三页、圆点跟随）',
  goObj.idx === 2 && goObj.after > goObj.before && goObj.after >= goObj.w * 2 - 4, goRes);
check('C4 翻页后三页图标行仍对齐', crossDelta(JSON.parse(await evalJs(rowsProbe) || '[]')).worst <= 0.6);

// ---------- D 组：#1013 真机症状面（vivo S30 / Edge 实报「在桌面滑动屏幕会回拉，无法滑到下面」）----------
console.log('[D] #1013 滚到底不回弹 / 异步图片晚到自动解锁');
const injectTall1013 = (i, h) => evalJs("(function(){var sl=document.querySelectorAll('#desktop-pages .page-slide')[" + i + "];var g=sl.querySelector('.app-grid');var d=document.createElement('div');d.className='desk-clock glass';d.setAttribute('data-desk-widget','desk-clock');d.style.height='" + h + "px';d.style.margin='0 0 14px';sl.insertBefore(d,g||sl.firstChild);return true;})()");
// 量「写完滚动量、等护栏复核落定之后」的态：top 仍停在底部且没被重新裁成 hidden
const stayProbe = (i) => evalJs("(function(){var s=document.querySelectorAll('#desktop-pages .page-slide')[" + i + "];return JSON.stringify({max:s.scrollHeight-s.clientHeight,top:Math.round(s.scrollTop),oy:s.style.overflowY||'-'});})()");
const scrollToBottom = (i) => evalJs("(function(){var s=document.querySelectorAll('#desktop-pages .page-slide')[" + i + "];s.scrollTop=s.scrollHeight-s.clientHeight;return s.scrollTop;})()");
const stays = (o) => { try { const j = JSON.parse(o); return j.max > 100 && j.top >= j.max - 2 && j.oy !== 'hidden'; } catch (e) { return false; } };
await setVp(393, 740);
await boot();
await injectTall1013(0, 260);
await waitFor("(function(){return document.querySelectorAll('#desktop-pages .page-slide')[0].style.overflowY!=='hidden';})()", 4000);
const q0 = JSON.parse(await stayProbe(0) || '{}');
check('D0 前置：真溢出成立（该页可滚量 > 100px，否则本组无判别力）', q0.max > 100, await stayProbe(0));
await scrollToBottom(0);
await sleep(1600); // 护栏＝滚动后 300ms 防抖复核 + 80ms 吸附兜底，这里等过两轮
const q1 = await stayProbe(0);
check('D1 真溢出页滚到底、落定后仍停在底部（红侧＝弹回 top=0＝用户所见「回拉」）', stays(q1), q1);
await scrollToBottom(0); // 用户不信邪再来一次
await sleep(1600);
const q2 = await stayProbe(0);
check('D2 第二次滚到底同样不回弹', stays(q2), q2);
// D3 异步载荷：桌面图片组件解码前高 0px（那一拍被 #989 裁成 hidden），到位后必须自动解锁
await setVp(393, 740);
await boot();
await waitFor("(function(){return [].every.call(document.querySelectorAll('#desktop-pages .page-slide'),function(s){return s.style.overflowY==='hidden';});})()", 4000);
await evalJs("(function(){var sl=document.querySelectorAll('#desktop-pages .page-slide')[1];var d=document.createElement('div');d.className='desk-image-widget';d.setAttribute('data-desk-widget','desk-image');var im=document.createElement('img');im.src='/__slow.png';d.appendChild(im);sl.appendChild(d);return true;})()");
await sleep(3200); // 延迟回包 1.4s + 解码 + 护栏 400ms 复核
const q3info = await evalJs("(function(){var P=[].slice.call(document.querySelectorAll('#desktop-pages .page-slide'));return JSON.stringify({overs:P.map(function(s){return s.scrollHeight-s.clientHeight;}),oy:P.map(function(s){return s.style.overflowY||'-';})});})()");
const q3 = (() => { try { return JSON.parse(q3info); } catch (e) { return {}; } })();
check('D3a 前置：图片到位后该页确实真溢出（>150px）', (q3.overs || [])[1] > 150, q3info);
check('D3b 图片到位后该页自动解锁（红侧＝停在 hidden，有内容在下方却再也滚不动）',
  (q3.oy || [])[1] !== 'hidden', q3info);
await scrollToBottom(1);
await sleep(1600);
const q3d = await stayProbe(1);
check('D3c 解锁后确实能滚到图片底部并停住', stays(q3d), q3d);
const q3e = await evalJs("(function(){var P=[].slice.call(document.querySelectorAll('#desktop-pages .page-slide'));return P[0].style.overflowY+'|'+P[2].style.overflowY;})()");
check('D3d #989 裁决未被顺手改坏（另两页不可见尾垫仍裁掉）', q3e === 'hidden|hidden', q3e);
check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.join(' | '));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过' + (fail ? '（' + fail + ' 项失败）' : ''));
process.exit(fail ? 1 : 0);

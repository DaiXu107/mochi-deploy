// ===== 常驻回归：#1201 桌面滚动护栏的「每次交互全量遍历子树」开销（iPhone 17 / iOS 26.4 实报
//   「切页面、滑动时最卡」，同批 perfcheck：桌面翻页帧耗时 平均 91ms·最慢 1513ms、切回桌面 p90 702ms）=====
// 根因（无头实证，零机型分支）：#989/#1013 那条护栏挂在桌面每一次「滚动落定 / 切回桌面 / 回前台」上，
//   旧写法每次 run 都把三页子树整个走一遍，页内**每个叶子**都调一次 getComputedStyle ＋ 一次
//   getBoundingClientRect（两者都会强制样式/布局回流）。实测规模：默认小桌面 1 次 run＝380 cs＋356 rect；
//   把每页塞到用户那种量级（1000~2200 子孙）后＝**1 次滚动落定 2030 次 getComputedStyle ＋ 1658 次
//   getBoundingClientRect ＋ 3 次全子树遍历**，且连续三次落定每次都照扫（无记忆）。桌面越满越贵——
//   这正是「滑动/切页最卡」而「空闲不卡」的原因：开销只落在交互那几拍上。
// 修法＝按页记忆化裁决（几何没变＝照抄上次结论、不碰子树）＋ inkBottom 早退（已经证明「有看得见的内容
//   越过可视底」就停），组件增删/图标注入/图片解码/restore/resize 这些内容真到位的触发点带 force 强制重扫。
// 断言（判别力＝纯 HEAD 副本必红 B2/B3 的 walks=0 半边）：
//   S 组＝逻辑锚（src ＋ 外置产物双查）：记忆化判定/写回/早退/force 档位 各在位，且 #989 判据整行、
//        #1013 的「未滚动内容坐标」基准、两条事件接线一字未动。
//   B 组＝真浏览器（393×740 矮视口，桌面页真溢出）：
//     B1 结构变更（MutationObserver force）仍然真的扫子树（记忆化没把护栏变成空转）
//     B2 几何不变的连续三次滚动落定＝**零次**子树遍历（红侧＝每次 3 遍、cs 各 ~2000）
//     B3 记忆化路径上 #989 仍然生效：盲页人为留 20px 滚动量 → 落定后归零，且这一下没扫子树
//     B4 几何一变（晚到的真溢出）立刻失效重扫并解锁（红侧＝同样解锁，两侧同过＝防修过头）
//     B5 resize 带 force＝重扫一次
//   Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1201-desk-guard-walk.mjs
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9620 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1201-' + Date.now()),
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

// ---------- S 组：逻辑锚（红侧必红）----------
console.log('[S] 逻辑锚（src + 外置产物双查）');
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };
const srcSlider = readSrc('js/desktop-slider.js');
const prodSlider = (() => { try { return readFileSync(join(root, 'js', 'desktop-slider.js'), 'utf8'); } catch (e) { return ''; } })();
const NEEDLES = [
  ['S1 按页记忆化裁决（删＝每次交互都重新遍历整棵子树＝本批要修的卡顿原样回来）',
    'if (!force && seen && seen.sh === sh && seen.ch === ch) {'],
  ['S2 裁决随几何写回（缺＝没有可复用的上次结论，记忆化形同虚设）',
    'verdicts.set(sl, { sh: sh, ch: ch, blind: blind });'],
  ['S3 inkBottom 早退（删＝已证明真溢出仍要把整棵子树扫完）',
    'if (maxB > stopAt) return maxB;'],
  ['S4 结构变更档＝强制重扫（删＝组件增删后照抄旧裁决＝#989/#1013 都可能被旧结论钉死）',
    // #1311 重锚：这一档从「任何 childList 都 force」收成「这批变异里有非文本节点才 force」——
    // 音乐/时钟每 500ms 重写自己读数（textContent＝删旧文本节点＋插新文本节点）过去被当成结构变了，
    // 把上面那把记忆化整层绕过。needle 取新的力档判据行；行为判据（滴答零扫描 vs 换节点照样扫）在
    // tools/verify-1311-desk-text-tick-and-cover-surface.mjs 的 A 组。
    'new MutationObserver((muts) => pageScrollGuard.later(400, !textOnlyChurn(muts)))'],
  ['S5 resize 档＝强制重扫（几何随视口变，裁决必须作废）',
    "window.addEventListener('resize', () => pageScrollGuard.later(120, true));"],
  ['S6 取证口径：只有真扫子树才打点（删＝下份 perfcheck 再也分辨不出护栏是否在咬人）',
    "window.__mochiPhase('desk-guard')"],
  ['S7 #989 判据整行未动（护栏仍在量「最深实心盒下沿」）',
    'inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop) <= sl.clientHeight + 1'],
  ['S8 #1013 基准＝未滚动内容坐标（缺 − scrollTop＝滚到底被弹回顶部复发）',
    'inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop)'],
  ['S9 #989 落刀未动（该页裁成 overflow-y:hidden ＋归零滚动量）',
    "if (sl.style.overflowY !== 'hidden') sl.style.overflowY = 'hidden';"],
  ['S10 真溢出回落 auto 未动（防修过头：不吞用户内容）',
    "if (sl.style.overflowY) sl.style.overflowY = '';"],
  ['S11 滚动落定复核接线未动',
    "pages.addEventListener('scroll', () => pageScrollGuard.later(300), true);"],
  ['S12 异步载荷到位复核接线未动',
    "pages.addEventListener('load', () => pageScrollGuard.later(400), true);"],
  ['S13 回桌面当帧复核接线未动',
    'pageScrollGuard.later(60); // #989：回桌面复核一次']
];
NEEDLES.forEach(([n, needle]) => {
  check(n + '（src）', srcSlider.indexOf(needle) >= 0);
  check(n + '（产物 js/desktop-slider.js）', prodSlider.indexOf(needle) >= 0);
});

// ---------- 浏览器 ----------
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
const setVp = (w, h) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
// 计数器：只数「护栏自己那三样」——桌面页上的全子树遍历、getComputedStyle、getBoundingClientRect
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__c = { walk: 0, cs: 0, br: 0 };
  var g = window.getComputedStyle;
  window.getComputedStyle = function(){ window.__c.cs++; return g.apply(window, arguments); };
  var b = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function(){ window.__c.br++; return b.apply(this, arguments); };
  var q = Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll = function(s){
    if (s === '*' && this.classList && this.classList.contains('page-slide')) window.__c.walk++;
    return q.apply(this, arguments);
  };
  try{ localStorage.setItem('xy-home-v2:__guide-done','1'); localStorage.setItem('xy-home-v2:__onboard-done','1'); }catch(e){}
})();` });
const CNT = '(function(){return JSON.stringify(window.__c);})()';
const cnt = async () => { try { return JSON.parse(await evalJs(CNT)); } catch (e) { return { walk: -1, cs: -1, br: -1 }; } };
const boot = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  // 开屏必须摘节点（base.css 的 `.splash:not(.hide) ~ .phone{visibility:hidden}` 只看兄弟关系，
  // 留着整页不可见 → 护栏按设计跳过该页 → 本电池全部假红）
  await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&sp.parentNode)sp.parentNode.removeChild(sp);['modal-mask','qa-mask','pc-sheet-mask','backup-remind-bar'].forEach(function(id){var e=document.getElementById(id);if(e){e.hidden=true;e.style.display='none';}});return true;})()");
  await sleep(400);
};
// 把每页塞到用户那种量级：克隆页内一个有内容的整块若干次，**并整块置 visibility:hidden**。
// 为什么用 hidden 而不是可见克隆：判据要的是「溢出全部来自看不见的内容」＝#989 的原始几何
// （最深实心盒下沿 604 < 可视底 610，溢出 26px 全是看不见的尾垫）；可见克隆会造出真溢出⇒三页
// 都不该被裁⇒B0/B3 前提全崩。而 visibility:hidden 的盒**仍占位、仍被 inkBottom 逐个量**（量完
// 才 continue），所以「每次落定都要遍历多少叶子」这个开销与用户桌面同步放大——两侧同一份种子。
const seed = () => evalJs("(function(){var sl=document.querySelectorAll('#desktop-pages .page-slide');var per=[];for(var i=0;i<sl.length;i++){var kids=sl[i].children,src=null;for(var k=0;k<kids.length;k++){if(kids[k].querySelectorAll('*').length>3){src=kids[k];break;}}if(!src){per.push(0);continue;}for(var g2=0;g2<40;g2++){var c=src.cloneNode(true);c.style.pointerEvents='none';c.style.visibility='hidden';sl[i].appendChild(c);}per.push(sl[i].querySelectorAll('*').length);}return JSON.stringify(per);})()");
const inlineOY = () => evalJs(`(function(){return [].map.call(document.querySelectorAll('#desktop-pages .page-slide'),function(s){return s.style.overflowY||'(none)';}).join(',');})()`);
const slideInfo = (i) => evalJs(`(function(){var s=document.querySelectorAll('#desktop-pages .page-slide')[${i}];return 'over='+(s.scrollHeight-s.clientHeight)+' top='+s.scrollTop+' oy='+(s.style.overflowY||'-');})()`);
const settle = (i, px) => evalJs(`(function(){var s=document.querySelectorAll('#desktop-pages .page-slide')[${i}];s.scrollTop=${px};return s.scrollTop;})()`);
const injectTall = (i, h) => evalJs("(function(){var sl=document.querySelectorAll('#desktop-pages .page-slide')[" + i + "];var g=sl.querySelector('.app-grid');var d=document.createElement('div');d.className='desk-clock glass';d.setAttribute('data-desk-widget','desk-clock');d.style.height='" + h + "px';d.style.margin='0 0 14px';sl.insertBefore(d,g||sl.firstChild);return true;})()");

console.log('[B] 行为面（393×740 矮视口＋隐藏尾垫种子＝每页都被判「翻下去看不见东西」，护栏必须逐页量）');
await setVp(393, 740);
await boot();
await seed();
await sleep(1500);
console.log('  种子后每页子孙数: ' + await evalJs("(function(){return JSON.stringify([].map.call(document.querySelectorAll('#desktop-pages .page-slide'),function(s){return s.querySelectorAll('*').length;}));})()"));
// 开屏收起后护栏有界重试；等三页都裁好＝护栏真的跑过并裁决了
await waitFor("(function(){return [].every.call(document.querySelectorAll('#desktop-pages .page-slide'),function(s){return s.style.overflowY==='hidden';});})()", 6000);
check('B0 前置：矮视口＋足量桌面下三页都被判为「不可见尾垫溢出」并裁掉',
  String(await inlineOY()) === 'hidden,hidden,hidden', String(await inlineOY()));

// ---- B1 结构变更＝force 重扫（记忆化没把护栏变成空转）----
await sleep(1200); // 先让种子触发的 force 重扫落定，否则窗口被上一次 run 的余波污染
let c0 = await cnt();
await injectTall(2, 260);
await sleep(1200); // 护栏＝childList → later(400,true)，给足一轮
await waitFor("(function(){return document.querySelectorAll('#desktop-pages .page-slide')[2].style.overflowY!=='hidden';})()", 4000);
let c1 = await cnt();
check('B1 组件级结构变更仍然真的扫子树（该页解锁＝裁决随内容更新）',
  (c1.walk - c0.walk) >= 3 && String(await inlineOY()).split(',')[2] !== 'hidden',
  'walk+' + (c1.walk - c0.walk) + ' cs+' + (c1.cs - c0.cs) + ' ' + String(await inlineOY()));

// ---- B2 几何不变的连续三次滚动落定＝零遍历（本批判别力的核心）----
const marks = [];
let zeroWalks = true;
await settle(0, 4);
await sleep(1200); // 排空：种子/注入期挂着的最后一轮 force 不能算进测量窗口
for (let r = 0; r < 3; r++) {
  const b0 = await cnt();
  await settle(0, 8 + r * 6);
  await sleep(900); // 护栏＝滚动后 300ms 防抖，等两轮落定
  const b1 = await cnt();
  marks.push('walk+' + (b1.walk - b0.walk) + '/cs+' + (b1.cs - b0.cs) + '/rect+' + (b1.br - b0.br));
  if (b1.walk !== b0.walk) zeroWalks = false;
}
check('B2 连续三次「滚动落定」在几何不变时零次子树遍历（红侧＝每次 3 遍、cs 每次 ~1000+）',
  zeroWalks, marks.join('  '));

// ---- B3 记忆化路径上 #989 仍然生效（裁决照抄 ≠ 不做事）----
await settle(1, 20);
const b2 = await cnt();
await sleep(1000);
const b3 = await cnt();
const s1 = String(await slideInfo(1));
check('B3 盲页残留 20px 滚动量在记忆化路径上照样归零（红侧＝也归零，但走的是整树重扫）',
  /top=0/.test(s1), s1 + ' | walk+' + (b3.walk - b2.walk));
check('B3b 这一下确实没扫子树（证明 heal 走的是缓存而非重扫）',
  (b3.walk - b2.walk) === 0, 'walk+' + (b3.walk - b2.walk) + ' cs+' + (b3.cs - b2.cs));

// ---- B4 几何一变＝缓存失效并解锁（防修过头：两侧同过）----
await injectTall(0, 300);
await waitFor("(function(){return document.querySelectorAll('#desktop-pages .page-slide')[0].style.overflowY!=='hidden';})()", 4000);
const s0 = String(await slideInfo(0));
check('B4 晚到的真溢出立刻失效重扫并解锁（不得被旧「裁掉」结论钉死）',
  /oy=hidden/.test(s0) === false, s0);
const writable = await evalJs("(function(){var s=document.querySelectorAll('#desktop-pages .page-slide')[0];var m=s.scrollHeight-s.clientHeight;s.scrollTop=m;var got=s.scrollTop;s.scrollTop=0;return m>100&&got>0;})()");
check('B4b 解锁后确实可滚（不吞用户内容＝#1013 口径）', writable === true, String(writable));

// ---- B5 resize＝force 档重扫一次 ----
await setVp(393, 700);
const c2 = await cnt();
await sleep(1200);
const c3 = await cnt();
check('B5 视口变化后走 force 档重扫（几何变了必须作废缓存）',
  (c3.walk - c2.walk) >= 3, 'walk+' + (c3.walk - c2.walk) + ' cs+' + (c3.cs - c2.cs));

check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.join(' | '));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过' + (fail ? '（' + fail + ' 项失败）' : ''));
process.exit(fail ? 1 : 0);

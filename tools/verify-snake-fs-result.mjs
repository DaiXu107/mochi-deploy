// ===== 回归：贪吃蛇全屏结算「再来一局」按钮必须完整可见且可点（小米15Pro Chrome 反馈）=====
// 背景：全屏（.snake-fs）滚动区是 overflow 裁切，结算块 + 再来一局出现后画布从不收小，
//       地图仍按空闲尺寸铺满整屏 → 内容溢出约 200px → 按钮被裁到屏外（用户需"缩小"才点得到）。
// 验证（384×752 用户机 / 360×640 / 390×844 / 412×892 / 752×384 横屏）：
//   A. 结算后「再来一局」完整落在可视区内（不需要滚动、不需要缩小）
//   B. 按钮中心 elementFromPoint 命中按钮本体（真的点得到，没被遮挡）
//   C. 画布收小后仍重绘出终局画面（改 canvas 尺寸会清空内容）
//   D. 结算地图格子小于空闲地图格子（证明确实是"缩小让位"而不是裁掉）
//   E. 点它确实能开新局，且新局画布回到空闲尺寸
//   F. 兜底：万一仍溢出（极矮/横屏 9px 格子下限），滚到底就能完整看到按钮
// 用法：node tools/verify-snake-fs-result.mjs（临时副本验证：SERVE_DIR=<构建目录> node tools/verify-snake-fs-result.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_DIR || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-snake-fs-result-' + Date.now()),
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
      const ed = r.exceptionDetails;
      console.error('JS 异常:', (ed.exception && (ed.exception.description || ed.exception.className)) || ed.text || JSON.stringify(ed).slice(0, 500));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
// 站内弹窗（openModal 的 #tc-mask）会盖住整屏：TA 好奇/吐槽等随机弹层与贪吃蛇布局无关，
// 量几何前先关掉，避免 elementFromPoint 命中到遮罩。
async function clearModals() {
  await evalJs(`(function(){document.querySelectorAll('#tc-mask,#modal-mask,.tc-mask,.modal-mask,.qa-mask').forEach(function(m){m.hidden=true;});return true;})()`);
}
async function geom() {
  await clearModals();
  const g = await evalJs(GEOM);
  if (!g) return { err: 'probe 返回 null（页面异常或不可序列化）' };
  return g;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 量一次几何：可视区、画布、结算块、按钮、按钮命中、溢出、格子边长、画布是否有内容
const GEOM = `(function(){ try {
  const panel=document.getElementById('chat-snake-panel');
  const sc=panel.querySelector('.poke-card-scroll');
  const btn=document.getElementById('snake-restart');
  const cv=document.getElementById('snake-canvas');
  const r=(el)=>{ const b=el.getBoundingClientRect(); return {t:b.top,b:b.bottom,h:b.height,w:b.width,l:b.left}; };
  const scr=r(sc), bgr=r(btn);
  const s=window.__snakeState&&window.__snakeState();
  const cx=bgr.l+bgr.w/2, cy=bgr.t+bgr.h/2;
  const hitAt=(el)=>{ if(!el||el.hidden) return 'n/a'; const b=el.getBoundingClientRect();
    const x=b.left+b.width/2, y=b.top+b.height/2;
    if (!isFinite(x)||!isFinite(y)) return 'n/a';
    if (y < 0 || y > innerHeight) return 'offscreen';
    const top=document.elementFromPoint(x,y);
    return top ? (top.id || top.className || top.tagName) : 'none'; };
  const sb=document.getElementById('snake-start');
  const hit=hitAt(btn), startHit=hitAt(sb);
  let ink=0;
  try {
    const ctx=cv.getContext('2d'), d=ctx.getImageData(0,0,cv.width,cv.height).data;
    for(let i=0;i<d.length;i+=4){ if(Math.abs(d[i]-246)>8||Math.abs(d[i+1]-246)>8||Math.abs(d[i+2]-248)>8) ink++; }
  } catch (e) { ink=-1; }
  const kids=[...sc.children].map(c=>c.getBoundingClientRect()).filter(b=>b.height>0);
  return {
    fs: panel.classList.contains('snake-fs'),
    scTop:scr.t, scBottom:scr.b, scH:scr.h,
    btnTop:bgr.t, btnBottom:bgr.b, btnH:bgr.h, btnHidden:btn.hidden,
    startTop:(function(){const b=sb.getBoundingClientRect();return b.top;})(),
    startBottom:(function(){const b=sb.getBoundingClientRect();return b.bottom;})(),
    startHidden: sb.hidden,
    hit: hit, startHit: startHit,
    canvasH:r(cv).h, canvasW:r(cv).w,
    resultH:r(document.getElementById('snake-result')).h,
    cell: s ? r(cv).w/s.gw : null, gw:s&&s.gw, gh:s&&s.gh, status:s&&s.status,
    hint: document.getElementById('snake-hint').textContent,
    overflow: kids.length ? Math.max.apply(null, kids.map(b=>b.bottom)) - scr.b : 0,
    ink: ink, scrollTop: sc.scrollTop, scrollH: sc.scrollHeight, clientH: sc.clientHeight
  };
} catch (e) { return { err: String(e && e.message || e) }; } })()`;

async function boot(w, h, fsMode) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html?b=' + w + 'x' + h + Date.now() });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(900);
  // 开屏公告盖在全站之上（z-index 高于面板），不关掉会污染 elementFromPoint 命中判定。
  // 关闭流程与 clock.js 一致：整页滚到底 → 点「进入」→ 400ms 后自行移除；仍残留就直接摘掉。
  await evalJs(`(function(){
    var box=document.getElementById('splash-box'); if(box) box.scrollTop=box.scrollHeight;
    var e=document.getElementById('splash-enter'); if(e) e.click();
    return true;
  })()`);
  await sleep(700);
  await evalJs(`(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return true;})()`);
  await sleep(300);
  await evalJs(`(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()`);
  await evalJs(`window.openSnakePanel && window.openSnakePanel(); true;`);
  await sleep(500);
  // 手机端默认全屏；需要半框对照时把全屏切掉
  if (!fsMode) await evalJs(`document.getElementById('snake-fs').click(); true;`);
  await sleep(300);
}
async function playToResult() {
  await evalJs(`document.getElementById('snake-start').click(); true;`);
  await sleep(2500);                                   // 倒计时 3×0.7s
  for (let i = 0; i < 80; i++) {                        // 玩家蛇默认向右 → 撞墙终局
    if (await evalJs(`document.getElementById('snake-restart').hidden===false`)) break;
    await sleep(300);
  }
  await sleep(400);
}

const VIEWPORTS = [
  { w: 384, h: 752, tag: '384×752（小米15Pro 用户机）', strict: true },
  { w: 360, h: 640, tag: '360×640（小屏安卓）', strict: true },
  { w: 390, h: 844, tag: '390×844（iPhone 级）', strict: true },
  { w: 412, h: 892, tag: '412×892（大屏安卓）', strict: true },
  { w: 752, h: 384, tag: '752×384（横屏，兜底可滚）', strict: false }
];

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : 'NaN');

for (const vp of VIEWPORTS) {
  await boot(vp.w, vp.h, true);
  const idle = await geom();
  check(vp.tag + ' 进入即全屏', idle.fs === true, 'fs=' + idle.fs + (idle.err ? ' err=' + idle.err : ''));
  if (vp.strict) {
    check(vp.tag + ' 空闲态【开始】按钮完整可见且命中（不是"显示不完全"）',
      idle.startHidden === false && idle.startTop >= idle.scTop - 0.5 && idle.startBottom <= idle.scBottom + 0.5 &&
      idle.startHit === 'snake-start',
      'btn ' + num(idle.startTop) + '~' + num(idle.startBottom) + ' 可视底=' + num(idle.scBottom) + ' hit=' + idle.startHit);
  } else {
    await evalJs(`(function(){const sc=document.getElementById('chat-snake-panel').querySelector('.poke-card-scroll');sc.scrollTop=sc.scrollHeight;return true;})()`);
    await sleep(120);
    const idleS = await geom();
    await evalJs(`(function(){const sc=document.getElementById('chat-snake-panel').querySelector('.poke-card-scroll');sc.scrollTop=0;return true;})()`);
    check(vp.tag + ' 空闲态【开始】按钮：首屏放不下时滚到底可完整点按',
      idleS.startTop >= idleS.scTop - 0.5 && idleS.startBottom <= idleS.scBottom + 0.5 && idleS.startHit === 'snake-start',
      'btn ' + num(idleS.startTop) + '~' + num(idleS.startBottom) + ' 可视底=' + num(idleS.scBottom) + ' hit=' + idleS.startHit);
  }
  await playToResult();
  const over = await geom();
  if (vp.strict) {
    check(vp.tag + ' A 结算后「再来一局」完整可见（无需滚动）',
      over.btnHidden === false && over.btnTop >= over.scTop - 0.5 && over.btnBottom <= over.scBottom + 0.5,
      'btn ' + num(over.btnTop) + '~' + num(over.btnBottom) + ' 可视 ' + num(over.scTop) + '~' + num(over.scBottom) + ' 溢出 ' + num(over.overflow) + 'px' + (over.err ? ' err=' + over.err : ''));
    check(vp.tag + ' B 按钮中心命中按钮本体（点得到）', over.hit === 'snake-restart', 'hit=' + over.hit);
  } else {
    console.log('INFO  ' + vp.tag + ' 结算内容确实放不下（首屏溢出 ' + num(over.overflow) + 'px，hit=' + over.hit + '）→ 只验兜底可达');
  }
  check(vp.tag + ' C 画布收小后仍重绘终局画面（非空白）', over.ink > 50, 'ink=' + over.ink + ' 画布 ' + num(over.canvasW) + '×' + num(over.canvasH));
  check(vp.tag + ' D 结算地图小于空闲地图（缩小让位而非裁切）',
    over.canvasH < idle.canvasH || over.cell < idle.cell,
    '格子 ' + num(idle.cell) + '→' + num(over.cell) + 'px 画布高 ' + num(idle.canvasH) + '→' + num(over.canvasH));
  if (vp.strict) {
    check(vp.tag + ' F 结算内容不需要滚动', over.overflow <= 1, '溢出 ' + num(over.overflow) + 'px');
  } else {
    await evalJs(`(function(){const sc=document.getElementById('chat-snake-panel').querySelector('.poke-card-scroll');sc.scrollTop=sc.scrollHeight;return true;})()`);
    await sleep(150);
    const after = await geom();
    check(vp.tag + ' F 兜底：溢出时滚到底可完整看到按钮',
      after.btnTop >= after.scTop - 0.5 && after.btnBottom <= after.scBottom + 0.5,
      '溢出 ' + num(over.overflow) + 'px scrollTop=' + num(after.scrollTop) + ' btnBottom=' + num(after.btnBottom) + ' 可视底=' + num(after.scBottom));
  }
  // E 点按钮真能开新局（同 tick 读结果：startGame 会同步收起结算块并进入倒计时；
  // 双蛇同一行相对而行，小地图 ~2s 又会结束，不能用固定延时等「滑动」提示）
  const again = await evalJs(`(function(){
    document.getElementById('snake-restart').click();
    return { resultHidden: document.getElementById('snake-result').hidden,
             btnHidden: document.getElementById('snake-restart').hidden,
             hint: document.getElementById('snake-hint').textContent };
  })()`);
  check(vp.tag + ' E 点「再来一局」真的重开一局',
    again && again.resultHidden === true && again.btnHidden === true && String(again.hint).indexOf('准备') >= 0,
    JSON.stringify(again));
  await evalJs(`window.closeSnakePanel && window.closeSnakePanel(); true;`);
  await sleep(200);
}

// ---- G. 半框（非全屏）对照：结算后按钮同样不能被裁 ----
await boot(384, 752, false);
const idleH = await geom();
check('G 半框：已退出全屏', idleH.fs === false, 'fs=' + idleH.fs);
await playToResult();
const overH = await geom();
check('G 半框结算：按钮完整可见且命中可点',
  overH.btnTop >= overH.scTop - 0.5 && overH.btnBottom <= overH.scBottom + 0.5 && overH.hit === 'snake-restart',
  'btn ' + num(overH.btnTop) + '~' + num(overH.btnBottom) + ' 可视底=' + num(overH.scBottom) + ' hit=' + overH.hit);
check('G 半框结算：画布仍有内容', overH.ink > 50, 'ink=' + overH.ink);

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill();
server.close();
process.exit(passed === results.length ? 0 : 1);

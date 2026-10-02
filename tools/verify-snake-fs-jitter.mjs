// ===== 回归 #774：贪吃蛇对局期视口抖动不得把地图打成脉冲（iPhone 16 Pro + Safari 实报）=====
// 背景：iOS 独立应用玩贪吃蛇时布局视口在 812↔874 之间反复跳（诊断时间线里那条 Δ+62），
//       安卓 Chrome 地址栏收放同理。原实现每次 resize 都同步重铺画布，而"重铺"＝
//       整张地图换比例（蛇跳一下）+ 给 canvas.width 赋值（哪怕同值也清空位图＝白闪）
//       + applyCell 自查最多 4 轮强制重排。实测 2 秒抖动内地图在 230×388 ↔ 193×326
//       之间脉冲 16 次＝用户报的「屏幕一直弹和闪，蛇也一直弹和闪」。
// 修复三处（零机型分支，全靠幂等 + 落定闸门）：
//   ① .snake-fs 高度改用全站小游戏同一条 min(var(--mochi-ios-h,100dvh),100dvh)；
//   ② applyCell 只在尺寸真的变了才写 style / 位图（同值不再清空画布）；
//   ③ resize 不再同步重铺：等视口安静 280ms 再量，可用盒与上次铺设一致（<2px）整条跳过。
// 断言（实测：修复后 10/10；未修复的纯 HEAD 副本 7/10，红的恰是 A1/A2/A8＝修复面，
//       A3/A4/A5/A6/A7 两版都绿＝破坏面没有扩大；A6 是同值幂等护栏，红版也不触发，
//       因为 Chrome 对「完全相同的 setDeviceMetricsOverride」不发 resize 事件）：
//   A0 采样有效性（面板已开、地图已铺）
//   A1 抖动期画布尺寸零变化（地图不再脉冲）A2 抖动期位图零重建（零白闪）
//   A3 视口真变化（停住 900ms）仍重铺一次且地图跟着收小
//   A4 重铺后内容不溢出、不需要滚动（原「再来一局被裁」契约不回归）
//   A6 可用盒没变时重复 resize 不再重铺（applyCell 幂等，同值不清位图）
//   A5 回到原视口画布回到开局尺寸（无累积漂移）
//   A7 旋转横屏仍重铺（闸门没把真变化吞掉）
//   A8 对局中抖动同样零脉冲（用户实报场景）A9 全程零 JS 报错
// 用法：node tools/verify-snake-fs-jitter.mjs（仓外副本验证：SERVE_DIR=<构建目录> node tools/verify-snake-fs-jitter.mjs）
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-snake-jitter-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const W = 402, H = 874;   // iPhone 16 Pro 报障机 CSS 视口
async function boot() {
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html?jitter=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(900);
  await evalJs(`(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()`);
  await sleep(700);
  await evalJs(`(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()`);
  await sleep(300);
  await evalJs(`(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return 1;})()`);
  await evalJs(`(function(){document.querySelectorAll('#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()`);
  await evalJs('window.openSnakePanel && window.openSnakePanel(); true;');
  await sleep(600);
  // 埋点：钩住位图尺寸赋值（赋值＝清空画布＝白闪一次），并逐帧记录画布/容器几何
  await evalJs(`(function(){
    var cv=document.getElementById('snake-canvas'), proto=Object.getPrototypeOf(cv);
    window.__fx={sets:0,same:0,resizes:0,rows:[]};
    ['width','height'].forEach(function(k){
      var d=Object.getOwnPropertyDescriptor(proto,k);
      Object.defineProperty(cv,k,{configurable:true,get:d.get,set:function(v){
        if(v===d.get.call(this)) window.__fx.same++; else window.__fx.sets++;
        d.set.call(this,v);
      }});
    });
    window.addEventListener('resize',function(){window.__fx.resizes++;});
    var panel=document.getElementById('chat-snake-panel');
    function sibH(){
      var o={};
      ['.snake-score','.snake-best','.snake-hint','.snake-result','.snake-controls','.snake-dpad'].forEach(function(sel){
        var el=panel.querySelector(sel); o[sel]= el && !el.hidden && el.offsetHeight ? el.offsetHeight : 0;
      });
      return o;
    }
    function tick(){
      var sc=panel.querySelector('.poke-card-scroll'), b=cv.getBoundingClientRect(), s=sc.getBoundingClientRect();
      var kids=[].slice.call(sc.children).map(function(c){return c.getBoundingClientRect();}).filter(function(x){return x.height>0;});
      var h=sibH();
      window.__fx.rows.push([Math.round(b.width*100)/100, Math.round(b.height*100)/100, Math.round(s.height*100)/100,
        kids.length?Math.round(Math.max.apply(null,kids.map(function(x){return x.bottom;}))-s.bottom)*1:0, innerHeight,
        panel.classList.contains('snake-fs'), h['.snake-score'], h['.snake-best'], h['.snake-hint'], h['.snake-result'], h['.snake-controls'], h['.snake-dpad'],
        (window.__snakeState&&window.__snakeState())?window.__snakeState().status:'-']);
      if(performance.now()<120000) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return 1;
  })()`);
  // 几何实验一律在「待开局（idle）」做：开局后蛇约 2s 撞墙收尾，endGame→showResult 会
  // 合法地重铺一次（结算块出现＝可用盒真的变了），那会把「闸门是否吞掉抖动」淹在噪声里。
  // idle 走的是同一条 resize→onViewportChange→refitAll 路径，且兄弟块显隐恒定。
  await evalJs(`(function(){try{var ks=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&/snake-(saved|score|best|mode|foodn)$/.test(k))ks.push(k);}ks.forEach(function(k){localStorage.removeItem(k);});}catch(e){}return 1;})()`);
  await evalJs(`(function(){var b=document.getElementById('chat-snake-close');if(b)b.click();return 1;})()`);
  await sleep(250);
  await evalJs(`window.openSnakePanel && window.openSnakePanel(); true;`);
  await sleep(700);
}
async function snakeStatus() {
  return await evalJs(`(function(){var s=window.__snakeState&&window.__snakeState();return s?s.status:'none';})()`);
}
function reset() { return evalJs(`(function(){window.__fx.sets=0;window.__fx.same=0;window.__fx.resizes=0;window.__fx.rows.length=0;return 1;})()`); }
async function stats() {
  const f = await evalJs(`(function(){var f=window.__fx,rows=f.rows;var chg=0;
    for(var i=1;i<rows.length;i++){ if(rows[i][0]!==rows[i-1][0]||rows[i][1]!==rows[i-1][1]) chg++; }
    var last=rows[rows.length-1]||[0,0,0,0,0,false,0,0,0,0,0,0,'-'];
    return {sets:f.sets,same:f.same,resizes:f.resizes,frames:rows.length,chg:chg,
      stFirst:(rows[0]||['-'])[12],stLast:last[12],stKinds:rows.map(function(r){return r[12];}).filter(function(v,i,a){return a.indexOf(v)===i;}).join('/'),
      cw:last[0],ch:last[1],scH:last[2],over:last[3],ih:last[4],fs:last[5],
      sib:'score='+last[6]+' best='+last[7]+' hint='+last[8]+' result='+last[9]+' ctrl='+last[10]+' dpad='+last[11],
      minW:Math.min.apply(null,rows.map(function(r){return r[0];})),maxW:Math.max.apply(null,rows.map(function(r){return r[0];}))};})()`);
  return f || { sets: -1, same: -1, resizes: -1, frames: 0, chg: -1, cw: 0, ch: 0, scH: 0, over: 0, ih: 0, minW: 0, maxW: 0, stFirst: '-', stLast: '-', stKinds: '-' };
}
const setMetrics = (w, h) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true });

const isIdle = (s) => s.stKinds === 'idle';
const resultHidden = (s) => /(^| )result=0( |$)/.test(s.sib);
async function jitter(times, ms) {
  for (let i = 0; i < times; i++) { await setMetrics(W, 812); await sleep(ms); await setMetrics(W, H); await sleep(ms); }
}
async function toIdle() {
  await evalJs(`(function(){try{var ks=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&/snake-saved$/.test(k))ks.push(k);}ks.forEach(function(k){localStorage.removeItem(k);});}catch(e){}return 1;})()`);
  await evalJs(`(function(){var b=document.getElementById('chat-snake-close');if(b)b.click();return 1;})()`);
  await sleep(250);
  await evalJs(`window.openSnakePanel && window.openSnakePanel(); true;`);
  await sleep(700);
  for (let i = 0; i < 20; i++) { if (await snakeStatus() === 'idle') break; await sleep(150); }
}

await boot();
await toIdle();
await reset();
await sleep(400);
const base = await stats();
check('A0 面板已开、地图已铺满且稳定处于待开局（采样有效）',
  base.frames > 10 && base.cw > 100 && isIdle(base) && resultHidden(base) && base.chg === 0,
  '帧=' + base.frames + ' 画布=' + base.cw + '×' + base.ch + ' status=' + base.stKinds + ' 尺寸变化=' + base.chg + ' ' + base.sib);

// ===== A1/A2：待开局期视口抖动——画布必须一动不动（与对局中同一条 resize→refit 路径）=====
await reset();
await jitter(8, 120);
await sleep(120);
const jit = await stats();
check('A1 抖动 16 次 resize 内画布尺寸零变化（地图不再脉冲）',
  jit.frames > 10 && jit.chg === 0 && jit.resizes >= 8 && isIdle(jit),
  'resize=' + jit.resizes + ' 帧内尺寸变化=' + jit.chg + ' 画布宽取值=' + jit.minW + '~' + jit.maxW +
  ' 容器高=' + jit.scH + ' fs=' + jit.fs + ' status=' + jit.stKinds + ' ' + jit.sib);
check('A2 抖动期位图零重建（一次白闪都不该有）', jit.frames > 10 && jit.sets === 0 && jit.same === 0,
  '赋值(真变化)=' + jit.sets + ' 赋值(同值)=' + jit.same);

// ===== A3/A4：真变化（视口停住）仍要重铺，且内容放得下 =====
await reset();
await setMetrics(W, 812);
await sleep(900);
const s812 = await stats();
check('A3 视口真的压到 812 并停住 → 重铺一次且地图跟着收小', s812.sets >= 1 && s812.ch < base.ch && isIdle(s812),
  '重铺赋值=' + s812.sets + ' 画布 ' + base.cw + '×' + base.ch + '→' + s812.cw + '×' + s812.ch + ' status=' + s812.stKinds);
check('A4 重铺后内容不溢出、不需要滚动（「再来一局」不被裁）', s812.over <= 1,
  '溢出=' + s812.over + 'px 同值赋值=' + s812.same);

// ===== A6：停在同一尺寸再触发 resize → 幂等，绝不再清位图 =====
await reset();
for (let i = 0; i < 4; i++) { await setMetrics(W, 812); await sleep(60); await setMetrics(W, 812); await sleep(60); }
await sleep(700);
const idem = await stats();
check('A6 可用盒没变时重复 resize 不再重铺（同值不清位图）', idem.frames > 10 && idem.sets === 0 && idem.same === 0 && idem.chg === 0,
  '赋值=' + idem.sets + '/' + idem.same + ' 尺寸变化=' + idem.chg);

// ===== A5：回到原视口 → 画布回到开局尺寸（无累积漂移）=====
await reset();
await setMetrics(W, H);
await sleep(900);
const back = await stats();
check('A5 回原视口后画布回到开局尺寸（无累积漂移）', back.cw === base.cw && back.ch === base.ch && isIdle(back),
  '画布 ' + base.cw + '×' + base.ch + ' → ' + back.cw + '×' + back.ch + ' status=' + back.stKinds);

// ===== A7：横屏真变化仍要重铺（旋转不被闸门吞掉）=====
await reset();
await setMetrics(874, 402);
await sleep(900);
const land = await stats();
check('A7 旋转横屏仍重铺（闸门没把真变化吞掉）', land.sets >= 1 && land.scH > 0 && isIdle(land),
  '赋值=' + land.sets + ' 容器高=' + land.scH + ' status=' + land.stKinds);
await setMetrics(W, H);
await sleep(900);

// ===== A8：对局中抖动（用户实报场景）——开「穿墙＋安全模式」把死亡概率压到最低，
//          并且只在每一帧都确实是 playing 的窗口里下结论；中途收局（合法重铺）则重开再试。
let play = null, playSt = '-', tries = 0;
while (tries++ < 3) {
  await toIdle();
  await evalJs(`(function(){var w=document.getElementById('snake-wall'),s=document.getElementById('snake-safe');
    if(w&&!w.classList.contains('on'))w.click(); if(s&&!s.classList.contains('on'))s.click();
    var d=document.getElementById('snake-diff'); if(d){d.value='easy';d.dispatchEvent(new Event('change',{bubbles:true}));} return 1;})()`);
  await sleep(200);
  await evalJs(`document.getElementById('snake-start').click(); true;`);
  for (let i = 0; i < 40; i++) { if (await snakeStatus() === 'playing') break; await sleep(150); }
  await reset();
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'})); true;`);   // 立刻离开 TA 那一行，避开对冲
  await jitter(5, 110);
  play = await stats();
  playSt = await snakeStatus();
  if (play.stKinds === 'playing') break;
  await toIdle();
}
check('A8 对局中抖动仍零脉冲（画布尺寸一帧没变、位图没重建）',
  play && playSt === 'playing' && play.stKinds === 'playing' && play.frames > 10 && play.chg === 0 && play.sets === 0 && play.same === 0,
  'status=' + playSt + '/采样=' + (play ? play.stKinds : '-') + ' 尝试=' + tries + ' resize=' + (play ? play.resizes : 0) +
  ' 尺寸变化=' + (play ? play.chg : -1) + ' 赋值=' + (play ? play.sets + '/' + play.same : '-'));

const jsErr = await evalJs(`(window.__jsErrors||[]).slice(0,3).join(' | ')`);
check('A9 全程零 JS 报错', !jsErr, jsErr || '');

const pass = results.filter((r) => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
server.close(); chrome.kill(); process.exit(pass === results.length ? 0 : 1);

// ===== 回归 #784：Pong / 打砖块 全屏期视口抖动不得把画布打成脉冲（#774 贪吃蛇同族）=====
// 背景：iOS 独立应用（iPhone 16 Pro + Safari 实报形态）与安卓 Chrome 地址栏收放期间，
//       布局视口高度会来回跳（812↔874）。snake 已由 #774 收口；pong/breakout 的 resize
//       仍是「每事件同步 fitCanvas」——给 canvas.width 赋值哪怕同值也清空位图＝白闪，
//       全屏 availH 又跟着抖动量＝画布尺寸来回脉冲。
// 修复三处（零机型分支，与 #774 同配方）：
//   ① .pong-fs/.brick-fs 高度改用全站小游戏同一条 min(var(--mochi-ios-h,100dvh),100dvh)；
//   ② fitCanvas 先算几何，与上次铺设一致时整条跳过（同值不再清位图）；
//   ③ resize 不再同步重铺：等视口安静 280ms 再量一次。
// 断言（实测：修复后 15/15；未修复的纯 HEAD 构建 13/15，红的恰是 Pong/Brick 各自 x2＝修复面
//       ——抖动期 32 次位图同值写入＝32 次白闪。x1 两版同绿：两游戏全屏画布均宽度主导，
//       高度抖动本就不改几何；x4 两版同绿：Chrome 对完全相同的 setDeviceMetricsOverride
//       不发 resize（与 verify-snake-fs-jitter A6 同注））：
//   每组（P=pong，B=brick）：
//   x0 全屏已开、画布已铺且稳定（采样有效）
//   x1 抖动 16 次 resize 内画布 CSS 尺寸零变化（不再脉冲）
//   x2 抖动期位图零写入（含同值写入＝一次白闪都不该有）
//   x3 视口真的收窄到 360 并停住 → 画布跟着收小（真变化不被吞）
//   x4 停在同一尺寸再触发 resize → 幂等，绝不再清位图
//   x5 回原视口后画布回到开局尺寸（无累积漂移）
//   x6 旋转横屏仍重铺（闸门没把真变化吞掉）
//   Z1 全程零 JS 报错
// 用法：node tools/verify-pong-brick-fs-jitter.mjs
//       仓外副本验证：SERVE_DIR=<构建目录> node tools/verify-pong-brick-fs-jitter.mjs
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pongbrick-jitter-' + Date.now()),
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

const W = 402, H = 874;   // iPhone 16 Pro 报障机 CSS 视口（#774 同款）
async function boot() {
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html?jitter784=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(900);
  await evalJs(`(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()`);
  await sleep(700);
  await evalJs(`(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()`);
  await sleep(300);
  await evalJs(`(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return 1;})()`);
  await evalJs(`(function(){document.querySelectorAll('#tc-mask,#modal-mask,.tc-mask,.modal-mask,#qa-mask').forEach(function(m){m.hidden=true;});return 1;})()`);
}

const setMetrics = (w, h) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true });
async function jitter(times, ms) {
  for (let i = 0; i < times; i++) { await setMetrics(W, 812); await sleep(ms); await setMetrics(W, H); await sleep(ms); }
}
function reset(tag) { return evalJs(`(function(){var f=window.__fx${tag};if(!f)return 0;f.sets=0;f.same=0;f.resizes=0;f.rows.length=0;return 1;})()`); }
async function stats(tag) {
  const f = await evalJs(`(function(){var f=window.__fx${tag};if(!f||!f.rows.length)return null;var rows=f.rows,chg=0;
    for(var i=1;i<rows.length;i++){ if(rows[i][0]!==rows[i-1][0]||rows[i][1]!==rows[i-1][1]) chg++; }
    var last=rows[rows.length-1];
    return {sets:f.sets,same:f.same,resizes:f.resizes,frames:rows.length,chg:chg,cw:last[0],ch:last[1],
      minW:Math.min.apply(null,rows.map(function(r){return r[0];})),maxW:Math.max.apply(null,rows.map(function(r){return r[0];}))};})()`);
  return f || { sets: -1, same: -1, resizes: -1, frames: 0, chg: -1, cw: 0, ch: 0, minW: 0, maxW: 0 };
}

// 打开面板 → 点 ⛶ 进 CSS 全屏 → 埋点（钩 canvas.width/height 赋值＝位图重建计数；rAF 采样画布几何）
async function openFs(tag, openFn, canvasId, fsBtnId) {
  await evalJs(`${openFn} && ${openFn}(); true;`);
  await sleep(500);
  await evalJs(`document.getElementById('${fsBtnId}').click(); true;`);
  await sleep(600);
  const ok = await evalJs(`(function(){
    var cv=document.getElementById('${canvasId}');
    if(!cv) return 'nocanvas';
    var proto=Object.getPrototypeOf(cv);
    window.__fx${tag}={sets:0,same:0,resizes:0,rows:[]};
    ['width','height'].forEach(function(k){
      var d=Object.getOwnPropertyDescriptor(proto,k);
      Object.defineProperty(cv,k,{configurable:true,get:d.get,set:function(v){
        if(v===d.get.call(this)) window.__fx${tag}.same++; else window.__fx${tag}.sets++;
        d.set.call(this,v);
      }});
    });
    window.addEventListener('resize',function(){window.__fx${tag}.resizes++;});
    function tick(){
      var b=cv.getBoundingClientRect();
      window.__fx${tag}.rows.push([Math.round(b.width*100)/100, Math.round(b.height*100)/100, innerHeight]);
      if(performance.now()<240000) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return 1;
  })()`);
  return ok;
}
async function closePanel(closeSel) {
  await evalJs(`(function(){var b=document.querySelector('${closeSel}');if(b)b.click();return 1;})()`);
  await sleep(250);
}

// 一组七断言（前缀 P=pong / B=brick）。画布只在全屏开、开局前（覆盖层挡着）做几何实验，
// 与 #774 同理：避免「合法重铺」（开局/结算块显隐）把闸门判据淹在噪声里。
async function suite(tag, name, openFn, canvasId, fsBtnId, closeSel) {
  const ok = await openFs(tag, openFn, canvasId, fsBtnId);
  if (ok !== 1) { check(name + ' x0 面板/画布/埋点就绪', false, 'openFs=' + ok); return; }
  await reset(tag); await sleep(400);
  const base = await stats(tag);
  check(name + ' x0 全屏已开、画布已铺且稳定（采样有效）',
    base.frames > 10 && base.cw > 100 && base.chg === 0,
    '帧=' + base.frames + ' 画布=' + base.cw + '×' + base.ch + ' 尺寸变化=' + base.chg);

  await reset(tag);
  await jitter(8, 120);
  await sleep(150);
  const jit = await stats(tag);
  check(name + ' x1 抖动 16 次 resize 内画布尺寸零变化（不再脉冲）',
    jit.frames > 10 && jit.chg === 0 && jit.resizes >= 8,
    'resize=' + jit.resizes + ' 帧内尺寸变化=' + jit.chg + ' 画布宽取值=' + jit.minW + '~' + jit.maxW);
  check(name + ' x2 抖动期位图零写入（含同值写入＝一次白闪都不该有）',
    jit.frames > 10 && jit.sets === 0 && jit.same === 0,
    '赋值(真变化)=' + jit.sets + ' 赋值(同值)=' + jit.same);

  // 注：x3「真变化」用**宽度**触发（402→360）——两游戏全屏画布皆宽度主导（4:3/比例下 812 的
  // 可用高仍高于按宽所算之值），压高度而画布不动是**正确行为**，不能当重铺判据。
  await reset(tag);
  await setMetrics(360, H);
  await sleep(900);
  const s360 = await stats(tag);
  // 无头 rAF 采样稀疏时跳变可能落在两帧之间，判据只认「停住后画布真的收小」，不数跳变。
  check(name + ' x3 视口真的收窄到 360 并停住 → 画布跟着收小（真变化不被闸门吞掉）',
    s360.cw < base.cw && s360.ch < base.ch,
    '画布 ' + base.cw + '×' + base.ch + '→' + s360.cw + '×' + s360.ch);

  await reset(tag);
  for (let i = 0; i < 4; i++) { await setMetrics(360, H); await sleep(60); await setMetrics(360, H); await sleep(60); }
  await sleep(700);
  const idem = await stats(tag);
  check(name + ' x4 可用盒没变时重复 resize 不再重铺（同值不清位图）',
    idem.frames > 10 && idem.sets === 0 && idem.same === 0 && idem.chg === 0,
    '赋值=' + idem.sets + '/' + idem.same + ' 尺寸变化=' + idem.chg);

  await reset(tag);
  await setMetrics(W, H);
  await sleep(900);
  const back = await stats(tag);
  check(name + ' x5 回原视口后画布回到开局尺寸（无累积漂移）',
    back.cw === base.cw && back.ch === base.ch,
    '画布 ' + base.cw + '×' + base.ch + ' → ' + back.cw + '×' + back.ch);

  await reset(tag);
  await setMetrics(874, 402);
  await sleep(900);
  const land = await stats(tag);
  check(name + ' x6 旋转横屏仍重铺（闸门没把真变化吞掉）', (land.cw !== base.cw || land.ch !== base.ch) && land.cw > 0,
    '画布=' + land.cw + '×' + land.ch + '（开局 ' + base.cw + '×' + base.ch + '）');
  await setMetrics(W, H);
  await sleep(900);
  await closePanel(closeSel);
}

await boot();
await suite('p', 'Pong', 'window.openPongPanel', 'pong-canvas', 'pong-fs', '#pong-close');
// 上一组收尾时 pong 若留着全屏类，openPongPanel 自带退出逻辑（if (isFs) toggleFs()），无需手清
await suite('b', 'Brick', 'window.openBrickPanel', 'brick-canvas', 'brick-fs', '#chat-brick-close');

const jsErr = await evalJs(`(window.__jsErrors||[]).slice(0,3).join(' | ')`);
check('Z1 全程零 JS 报错', !jsErr, jsErr || '');

const pass = results.filter((r) => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
server.close(); chrome.kill(); process.exit(pass === results.length ? 0 : 1);

// ===== 验证脚本：#541 开屏期遮挡被完全盖住的桌面（修 iPhone 各机型开屏滑动/停留卡顿） =====
// 用法：node build.mjs && node tools/verify-splash-occlusion.mjs
//   需要：Node 21+（内置 fetch/WebSocket）+ 本机 Chrome/Edge（CHROME_PATH 可指定）
// 背景（用户，iPhone 15 Pro Max + Safari PWA；明说其他机型也有、要求不要覆盖修改引发跨机型回归）：
//   开屏（每日首次强制展开全文，公告高 11000+px，须滑到底才能进入）期间滑动/停留明显卡顿。
//   根因：开屏是整屏【不透明】层（position:fixed/z-index:999/background:var(--card-bg)），
//   视觉上完全盖住 .phone，但 WebKit 未按 z 序裁剪被盖住的层，仍逐帧合成其下的 .phone
//   （14k 节点 + 壁纸层 + 三页合成层）。无头 WebKit 实测：置 .phone 为 visibility:hidden 后
//   开屏滚动帧耗时 mean 137→96ms、空闲 p90 122→78ms；同环境等价平凡长列表稳定 60fps，
//   即这笔开销是「被盖住仍在付费」，不是开屏自身内容成本。
// 修复：纯 CSS 兄弟选择器 `.splash:not(.hide) ~ .phone { visibility:hidden; }`。
// 断言口径（行为，不是代码存在性——哨兵另在 build.mjs #541）：
//   A 组（静态）：src 与产物都含该规则；「隐藏 .phone」的规则必须全部带 :not(.hide) 守卫。
//   B 组（行为，无头真实产物）：
//     B1 开屏在位 → .phone 计算 visibility=hidden 且选择器恰当命中、盒尺寸非 0（布局未塌）
//     B2 布局不受影响：hidden 期间与临时 visible 的盒尺寸/位置逐项一致（visibility 不进布局）
//     B3 淡出窗口不残留：加 .hide（clock.js hide() 第一步）→ .phone 当帧恢复 visible，且开屏仍在 DOM
//     B4 真正走完进入流程 → 桌面可见、尺寸正常（启动/进入未被遮挡规则破坏）
//   RED 基线：未含本修复的产物上 B1 失败（现场 vis=visible）——已实测。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
function J(name, cond) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}

// ---- A 组：静态断言 ----
console.log('静态断言:');
const baseCss = read('src/css/base.css');
const RULE = '.splash:not(.hide) ~ .phone { visibility:hidden; }';
const hasRule = baseCss.includes(RULE);
J('A1 base.css 含开屏期遮挡规则（兄弟选择器 + visibility:hidden）', hasRule);
// A2：遮挡必须是条件式——把「隐藏 .phone」的规则块取出来，每条选择器都要带 .splash:not(.hide)；
//     出现无条件隐藏 .phone 的规则＝进了桌面就再也看不见。
const hideBlocks = baseCss.split('}').filter((blk) => /visibility\s*:\s*hidden/.test(blk) && /\.phone\b/.test(blk));
const a2ok = hideBlocks.length >= 1 && hideBlocks.every((b) => b.includes('.splash:not(.hide)'));
J('A2 隐藏 .phone 的规则全部是条件式（:not(.hide) 守卫；无条件隐藏＝桌面永久不可见）', a2ok);
if (!a2ok) console.log('  A2 命中块: ' + JSON.stringify(hideBlocks.map((b) => b.trim().slice(0, 90))));

if (!existsSync(join(root, 'index.html'))) { console.log('\n无产物，跳过 B 组（先 node build.mjs）'); process.exit(fail ? 1 : 0); }
J('A3 产物中含该规则（漏接入 cssFiles 或样式被删即报警）', read('index.html').includes(RULE));

// ---- B 组：行为断言 ----
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
if (!chromePath) { console.log('\n无 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }
if (typeof WebSocket !== 'function') { console.log('\n需 Node 21+（内置 WebSocket）'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9990 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-splash-occl-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}

try {
  await cdpConnect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 100; i++) { try { if (await evalJs('!!window.__mochiDataReady')) break; } catch (e) {} await sleep(200); }
  await sleep(900);

  console.log('\n行为断言:');

  // B1 开屏在位 → .phone 应被遮挡
  const b1 = await evalJs(`(function(){
    var sp=document.getElementById('splash'), ph=document.querySelector('.phone');
    if(!sp||!ph) return {err:'锚点缺失'};
    var r=ph.getBoundingClientRect();
    return { splashOn: !sp.classList.contains('hide') && getComputedStyle(sp).display!=='none',
             vis: getComputedStyle(ph).visibility,
             hits: document.querySelectorAll('.splash:not(.hide) ~ .phone').length,
             w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  const b1ok = !!(b1 && b1.splashOn && b1.vis === 'hidden' && b1.hits === 1 && b1.w > 0 && b1.h > 0);
  J('B1 开屏在位：.phone 被遮挡（visibility=hidden）、选择器命中 1 个、盒尺寸非 0（布局未塌）', b1ok);
  if (!b1ok) console.log('  B1 现场值: ' + JSON.stringify(b1));

  // B2 visibility 不进布局
  const b2 = await evalJs(`(function(){
    var ph=document.querySelector('.phone');
    var r1=ph.getBoundingClientRect();
    var old=ph.style.visibility; ph.style.visibility='visible';
    var r2=ph.getBoundingClientRect();
    ph.style.visibility=old;
    return { hidden:{w:Math.round(r1.width),h:Math.round(r1.height),t:Math.round(r1.top),l:Math.round(r1.left)},
             shown:{w:Math.round(r2.width),h:Math.round(r2.height),t:Math.round(r2.top),l:Math.round(r2.left)} };
  })()`);
  const b2ok = !!(b2 && JSON.stringify(b2.hidden) === JSON.stringify(b2.shown));
  J('B2 visibility 不影响布局（hidden 与 visible 的盒尺寸/位置逐项一致）', b2ok);
  if (!b2ok) console.log('  B2 现场值: ' + JSON.stringify(b2));

  // B3 淡出窗口不残留（加 .hide 后当帧恢复可见，开屏仍在 DOM）
  const b3 = await evalJs(`(function(){
    var sp=document.getElementById('splash'), ph=document.querySelector('.phone');
    sp.classList.add('hide');
    var v=getComputedStyle(ph).visibility;
    var hits=document.querySelectorAll('.splash:not(.hide) ~ .phone').length;
    var stillConnected=!!sp.parentNode;
    sp.classList.remove('hide');
    return { vis:v, hits:hits, stillConnected:stillConnected };
  })()`);
  const b3ok = !!(b3 && b3.vis === 'visible' && b3.hits === 0 && b3.stillConnected === true);
  J('B3 开屏开始隐藏（.hide）后 .phone 立即恢复可见、无残留隐藏态（淡出正常露出桌面）', b3ok);
  if (!b3ok) console.log('  B3 现场值: ' + JSON.stringify(b3));

  // B4 走完真实进入流程（开屏 → 桌面）。开屏门控：需已勾年满18 + 滑到底。
  //    2026-10-01 #1536 同批收口两处存量债（纯 origin/main 副本实测同红＝非本批引入）：
  //    ① d88075d「开屏改1页」删了 #splash-mandatory 独立层＝点进入即收场，原两阶段重试随流程退役；
  //    ② #1475 起同意存证改版本化 JSON（旧裸 '1' 不认），改为页面内直接勾选（dispatch change）＝跨声明版本稳。
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 100; i++) { try { if (await evalJs('!!window.__mochiDataReady')) break; } catch (e) {} await sleep(200); }
  await sleep(900);
  await evalJs(`(function(){ var c=document.getElementById('splash-age-check');
    if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  // 滑到底 + 点「点击进入」（重试至开屏消失；带重试避免某一次点击时按钮还在 is-disabled）
  let gone = false;
  for (let i = 0; i < 15 && !gone; i++) {
    await evalJs(`(function(){ var b=document.getElementById('splash-box'); if(b) b.scrollTop=b.scrollHeight+9999;
      var e=document.getElementById('splash-enter'); if(e && !e.classList.contains('is-disabled')) e.click(); })()`);
    await sleep(400);
    gone = await evalJs(`(function(){ var sp=document.getElementById('splash');
      return !sp || sp.classList.contains('hide') || getComputedStyle(sp).display==='none'; })()`);
  }
  await sleep(1200);
  const b4 = await evalJs(`(function(){
    var ph=document.querySelector('.phone');
    var r=ph.getBoundingClientRect();
    var sp=document.getElementById('splash');
    var home=document.getElementById('page-phone');
    return { vis:getComputedStyle(ph).visibility, w:Math.round(r.width), h:Math.round(r.height),
             splashGone: !sp || sp.classList.contains('hide') || getComputedStyle(sp).display==='none',
             homeVisible: !!(home && !home.hidden),
             hits: document.querySelectorAll('.splash:not(.hide) ~ .phone').length };
  })()`);
  const b4ok = !!(b4 && b4.vis === 'visible' && b4.w > 0 && b4.h > 0 && b4.splashGone && b4.homeVisible && b4.hits === 0);
  J('B4 走完进入流程后：开屏收场、.phone 可见且尺寸正常、桌面页可见（启动/进入不受影响）', b4ok);
  if (!b4ok) console.log('  B4 现场值: ' + JSON.stringify(b4));
} catch (e) {
  console.log('\n❌ B 组执行异常：' + (e && e.message));
  fail++;
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

// ===== 回归脚本：#707 屏幕位置微调（设置 → 信息诊断三行，mobile-adapt.js mochiScreenAdj 双层值包装） =====
// 用法：node tools/verify-screen-adj.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// 背景（用户直派）：跨设备屏幕适配修不完，给用户本机永久手动三轴偏移（顶部/底部/页面高度 ±80px）。
//   实现要点＝包装 documentElement.style 的 set/remove/get：系统写入方照常写基准值，DOM 落的恒为
//   「基准+偏移」；写入方的 getPropertyValue 比较拿到的也是偏移后值（会多调一次同值 setProperty，
//   对样式无效＝零重排零抖动）。底部 iOS 侧无人写 → 偏移≠0 直写 calc(env()+偏移)。
// 本脚本用 CDP 真实产物插桩验证：
//   B1 静态：包装层/底部 calc/设置接线三要素在产物中在位。
//   B2 行为：种 LS screen-adj-h=24 后加载 → documentElement 内联 --mochi-ios-h 比无偏移基线恰大 24px
//      （覆盖写入方（syncVvFit）跑过之后仍保持偏移＝双层包装生效）。
//   B3 行为：种 screen-adj-top=12 → 内联 --mochi-safe-top 恰大 12px。
//   B4 行为：种 screen-adj-bottom=16 → 内联 --mochi-safe-bottom 为 calc(env(...)+16px)。
//   B5 行为：运行时 window.mochiScreenAdj.set('h', 0) → 高度立即回到基线（0=恢复默认，无需刷新）。
//   Z 全程无新增 JS 异常。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArgIdx = process.argv.indexOf('--root');
const root = normalize((rootArgIdx > -1 ? process.argv[rootArgIdx + 1] : dirname(fileURLToPath(import.meta.url)) + '/..'));
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
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-scradj-' + Date.now()),
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// B1 静态
const built = readFileSync(join(root, 'index.html'), 'utf8');
check('B1a 产物含双层值包装 get 覆写', built.includes("if (NAMES[n] !== undefined && base[n] !== undefined) return (base[n] + adj[NAMES[n]]) + 'px';"));
check('B1b 产物含底部 calc(env) 偏移写入', built.includes("'calc(env(safe-area-inset-bottom, 0px) + ' + adj.bottom + 'px)'"));
check('B1c 产物含统一面板接线 applyAxis', built.includes('function applyAxis(ax, nv, silent) {'));
check('B1d 产物含桌面轴消费规则（#desktop-pages padding-top var）', built.includes('#desktop-pages { padding-top: var(--mochi-desk-adj, 0px); }'));

// 加载一轮：基线（无偏移）
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 30; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
const baseVals = await evalJs(`(function(){
  var st = document.documentElement.style;
  return JSON.stringify({ h: st.getPropertyValue('--mochi-ios-h') || null, top: st.getPropertyValue('--mochi-safe-top') || null, hasAdj: !!window.mochiScreenAdj });
})()`);
const baseV = JSON.parse(baseVals || '{}');
check('B0 基线加载且微调层在位（mochiScreenAdj 暴露）', !!baseV.hasAdj, baseVals);

// 种偏移重载
await evalJs(`(function(){
  localStorage.setItem('xy-home-v2:screen-adj-h', '24');
  localStorage.setItem('xy-home-v2:screen-adj-top', '12');
  localStorage.setItem('xy-home-v2:screen-adj-bottom', '16');
  return true;
})()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 30; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(1500); // 等 syncVvFit 至少跑过一轮（写入方写入后仍须保持偏移）
const adjVals = await evalJs(`(function(){
  var st = document.documentElement.style;
  return JSON.stringify({ h: st.getPropertyValue('--mochi-ios-h'), top: st.getPropertyValue('--mochi-safe-top'), bottom: st.getPropertyValue('--mochi-safe-bottom') });
})()`);
const av = JSON.parse(adjVals || '{}');
const sim = await evalJs(`(function(){
  var st = document.documentElement.style;
  var out = {};
  st.setProperty('--mochi-ios-h', '800px');
  out.h = st.getPropertyValue('--mochi-ios-h');
  st.setProperty('--mochi-safe-top', '62px');
  out.top = st.getPropertyValue('--mochi-safe-top');
  st.removeProperty('--mochi-ios-h');
  out.afterRemove = st.getPropertyValue('--mochi-ios-h');
  return JSON.stringify(out);
})()`);
const sv = JSON.parse(sim || '{}');
// B2/B3 换锚（2026-09-27 #1318）：旧两支测的是「#707 包装 documentElement.style 的 set/get，
//   于是谁写 800px 都落 824px」这一【机制】。#1318 把那层包装删了——包装后的 getPropertyValue
//   把「基准＋偏移」原样还给写入方自己的比较，#189 的 ≥6px 迟滞因此被偏移量本身顶开（该机
//   高度轴=-15 ⇒ |基准−读数| 恒为 15），等于每抖 1px 就真写一次 .phone/html/body 共用的整页
//   高度；同一层包装对底部那一格完全够不着，只好再补一条按秒复述 calc 的定时器＝一个属性两个
//   主人。现在偏移由写入方在落 DOM 时叠加（screenVarPx / bottomSafeCss），机制换路、行为契约
//   不变 ⇒ 同名换 needle＝合法重锚，不算缩尺。这里改测两侧都成立的契约：轴改值后 all() 与 LS
//   同步、无需刷新即生效。至于「偏移确实体现在系统写入方那一次写值上」的可判别强断言，挪到
//   tools/verify-1318-screen-adj-single-owner.mjs 的 A3/C2（那边把 standalone＋iOS UA＋440×956
//   铺成 16PM 那一档几何；本脚本没铺，硬断言只会把环境缺口报成回归——本仓规矩：SKIP 不算红）。
const ax = await evalJs('(function(){ return JSON.stringify(window.mochiScreenAdj.all()); })()');
const axo = JSON.parse(ax || '{}');
check('B2 高度轴改值后 all() 与 LS 同步（面板即时生效，不依赖刷新）', axo.h === 24, 'all=' + ax);
check('B3 顶部轴改值后 all() 与 LS 同步', axo.top === 12, 'all=' + ax);
check('B3b 写入方 removeProperty 后偏移层一并摘除（不留幽灵值）', sv.afterRemove === '', sim);
const deskv = await evalJs("(function(){ localStorage.setItem('xy-home-v2:screen-adj-desk','30'); location.reload(); return true; })()");
await sleep(3000);
const deskAfter = await evalJs("(function(){ return document.documentElement.style.getPropertyValue('--mochi-desk-adj') || ''; })()");
check('B4b 桌面轴 +30px 落 var（#desktop-pages 随之有 padding-top）', deskAfter === '30px', 'desk=' + deskAfter);
const shiftAfter = await evalJs("(function(){ var st=document.documentElement.style; st.setProperty('--mochi-shift-adj','-12px'); var ph=getComputedStyle(document.querySelector('.phone')).top; st.removeProperty('--mochi-shift-adj'); return ph; })()");
check('B4c 整体位移轴 -12px → .phone computed top=-12px（相对位移生效）', shiftAfter === '-12px', 'top=' + shiftAfter);
check('B4 底部偏移 calc(env)+16px 写入', /calc\(env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*16px\)/.test(av.bottom || ''), 'bottom=' + av.bottom);

// B5 运行时归零
const b5 = await evalJs(`(function(){
  window.mochiScreenAdj.set('h', 0);
  var st = document.documentElement.style;
  return JSON.stringify({ h: st.getPropertyValue('--mochi-ios-h'), ls: localStorage.getItem('xy-home-v2:screen-adj-h') });
})()`);
if (baseV.h) {
  const dh5 = parseFloat(JSON.parse(b5).h) - parseFloat(baseV.h);
  check('B5 运行时恢复默认（0）立即生效且 LS 已清', Math.abs(dh5) <= 2 && JSON.parse(b5).ls === null, b5 + ' Δ=' + dh5);
} else {
  check('B5 运行时恢复默认（0）立即生效且 LS 已清', JSON.parse(b5).ls === null, b5);
}

// Z 异常
const errs = await evalJs('(window.__jsErrors||[]).length');
check('Z 全程无新增 JS 异常', errs === 0, 'errors=' + errs);

server.close();
chrome.kill();
const pass = results.filter(r => r.ok).length;
console.log('---');
console.log('通过 ' + pass + '/' + results.length);
process.exit(pass === results.length ? 0 : 1);

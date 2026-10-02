// ===== 验证脚本：手机壳 DOM 结构守卫——.phone 必须完整包住 tabbar/悬浮层，壳不许被解析器提前闭合 =====
// 用法：node tools/verify-dom-shell.mjs   （跑的是仓库根目录产物 index.html；未构建时本脚本会红，红的是产物不是源码）
//
// 背景（#301，2026-09-11 用户报「手机端 UI 完全乱了、底部导航不见了」）：
//   template.html 红包注释漏写 `-->`（结尾误成 `*/}`），注释吞到下一个 `-->`，
//   净少吃一个 set-group 开标签 → 后续 </div> 连锁把 them-sec → #page-chat-settings
//   → .phone 全部提前闭合。tabbar/sm-float/tc-mask/desk-msg 落成 body 直接子节点；
//   html/body 是 display:flex 横排居中，手机壳(390px)与 tabbar(min 118px) 并排坐，
//   居中后整壳被推左出屏 ~59px、tabbar 挤出屏右、右侧露 body 灰底＝整页 UI 错乱。
//   该事故 div 总数恰好配平（别处有补偿），肉眼/普通 div 计数查不出——只能用真解析器验。
// 断言两层：
//   L1 纯解析（禁 JS）：tabbar/sm-float/tc-mask 的父节点必须是 .phone；设置页数据分区必须还在设置页里。
//   L2 运行时（开 JS，390×844）：.phone 左缘必须贴住视口（x=0），tabbar 必须完整落在视口内。
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node 21+（内置 WebSocket），当前 Node ' + process.version);
  process.exit(1);
}

// 产物新旧先报一句：红的时候别让人以为是行为回归（源码层见 build.mjs 注释配平守卫 + #301 哨兵）
try {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  if (!/cs-rp-auto-prob -->/.test(html)) {
    console.log('⚠️  产物 index.html 仍是旧版（红包注释未闭合＝#301 修复未入库）——请先 node build.mjs 再看本脚本结果');
  }
} catch (e) {}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9890 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dom-shell-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  eval 异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ===== L1 纯解析层（禁 JS）：结构不被解析器自动纠正打碎 =====
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setScriptExecutionDisabled', { value: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
const l1 = await evalJs(`(function(){
  function parentName(sel){ var el=document.querySelector(sel); if(!el) return null; var p=el.parentElement; if(!p) return 'no-parent'; return (p.id?'#'+p.id:(p.className&&typeof p.className==='string')?'.'+p.className.trim().split(/\\s+/)[0]:'<'+p.tagName+'>'); }
  var ph=document.querySelector('.phone');
  return JSON.stringify({
    tabbarParent: parentName('.tabbar'),
    smFloatParent: parentName('#sm-float'),
    tcMaskParent: parentName('#tc-mask'),
    deskMsgParent: parentName('#desk-msg'),
    dataSecParent: (function(){ var s=document.querySelector('.them-sec[data-sec=\\"data\\"]'); return s&&s.parentElement?(s.parentElement.id||s.parentElement.className):null; })(),
    phoneKids: ph?ph.children.length:0
  });
})()`);
let d1 = {};
try { d1 = JSON.parse(l1); } catch (e) {}
check('L1 纯解析：.tabbar 父节点是 .phone（#301 主断言，坏则底部导航落 body 层被 flex 挤出屏）', d1.tabbarParent === '.phone', '实际 ' + d1.tabbarParent);
check('L1 纯解析：#sm-float 父节点是 .phone', d1.smFloatParent === '.phone', '实际 ' + d1.smFloatParent);
check('L1 纯解析：#tc-mask 父节点是 .phone', d1.tcMaskParent === '.phone', '实际 ' + d1.tcMaskParent);
check('L1 纯解析：#desk-msg 父节点是 .phone', d1.deskMsgParent === '.phone', '实际 ' + d1.deskMsgParent);
check('L1 纯解析：设置页「数据」分区父节点是 #page-chat-settings', d1.dataSecParent === 'page-chat-settings', '实际 ' + d1.dataSecParent);

// ===== L2 运行时层（开 JS）：壳贴住视口、底部导航完整可见 =====
await cdp('Emulation.setScriptExecutionDisabled', { value: false });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4000);
const l2 = await evalJs(`(function(){
  var ph=document.querySelector('.phone'), tb=document.querySelector('.tabbar');
  var pr=ph?ph.getBoundingClientRect():null, tr=tb?tb.getBoundingClientRect():null;
  return JSON.stringify({
    phoneX: pr?Math.round(pr.x):null,
    phoneW: pr?Math.round(pr.width):null,
    tabLeft: tr?Math.round(tr.left):null,
    tabRight: tr?Math.round(tr.right):null,
    vw: innerWidth,
    bodySW: document.body.scrollWidth
  });
})()`);
let d2 = {};
try { d2 = JSON.parse(l2); } catch (e) {}
check('L2 运行时：.phone 左缘贴住视口（x=0；#301 现场=-59＝整壳出屏）', d2.phoneX === 0, '实际 x=' + d2.phoneX + ' w=' + d2.phoneW);
check('L2 运行时：.tabbar 完整落在视口内（#301 现场=[331,449]＝被挤出屏右）', d2.tabLeft !== null && d2.tabLeft >= 0 && d2.tabRight <= d2.vw, '实际 [' + d2.tabLeft + ',' + d2.tabRight + '] 视口 ' + d2.vw);
check('L2 运行时：body 无水平滚动溢出（scrollWidth ≤ 视口宽）', d2.bodySW <= d2.vw, '实际 ' + d2.bodySW + ' vs ' + d2.vw);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fail = results.filter(r => !r.ok).length;
console.log(fail ? '\n✗ ' + fail + '/' + results.length + ' 断言失败' : '\n✓ ' + results.length + '/' + results.length + ' 断言全过');
process.exit(fail ? 1 : 0);

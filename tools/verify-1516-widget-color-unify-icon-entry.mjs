// ===== #1516 小组件颜色统一全部组件＋单组件独立颜色＋图标入口前置 =====
// 背景（荣耀畅玩40 Plus／夸克实报）：「设置了【小组件颜色】，桌面小组件颜色没有任何变化」
// ＋「没有全部小组件统一颜色、也不能单独调整某个小组件」＋「自定义手机桌面图标入口太靠后」。
// 根因：.week-card/.desk-clock/.desk-cal/.desk-timer/.desk-anniv/.desk-period 六类只有 .glass
// 的 --glass-bg 底，未接 --widget-bg/--widget-border/--widget-opacity ＝三个全局设置对它们无效。
// 判别核心（红侧＝纯修复前必红）：
//   H1 全局统一——写入 widget-bg-color=纯红后，.week-card／.desk-clock（隐藏池里也算数）的
//      computed background-color 必须跟随（修复前它们停留在 glass 半透明白＝必红）；
//   H2 单组件覆盖——widget-bg-deco=纯蓝后 .deco-widget 变蓝、.week-card 仍是全局红＝两键互不干扰。
// 用法：node tools/verify-1514-widget-color-unify-icon-entry.mjs（量当前产物）；MOCHI_ROOT=<副本> 量别版
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const PAGE = '/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 200) + ']' : ''));
}

function rd(p) { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } }
const idx = rd('index.html');
const jsPe = rd('js/personalize.js');
// ---- S 静态锚（产物级） ----
check('S1 六类组件外观三件套规则在产物（删＝六类不吃全局小组件颜色/边框/透明度）', idx.includes('.desk-anniv,.desk-period{background-color:var(--widget-bg);border:1px solid var(--widget-border);opacity:var(--widget-opacity)}'));
check('S2 单组件独立颜色存取在产物（删＝装修模式点卡片没有「组件颜色」）', jsPe.includes("const widgetBgKey = (type) => 'widget-bg-' + type;"));
check('S3 独立颜色随启动/切桌面重应用（删＝重启/换桌面独立色蒸发）', jsPe.includes('applyAllWidgetTexts, applyAllWidgetOpacities, applyAllWidgetBgs'));
check('S4 图标与页面组提到壁纸组之前（入口前置）', (() => { const a = idx.indexOf('id="row-custom-icon"'); const b = idx.indexOf('id="row-bg-upload"'); return a > 0 && b > 0 && a < b; })());
check('S5 快捷面板「图标」直达钮＋绑定（删＝美化页快捷条没有图标入口）', idx.includes('id="dq-icon"') && jsPe.includes("bind('dq-icon', 'row-custom-icon');"));
check('S6 独立颜色/独立透明度随美化方案走（BEAUTY_KEYS 补登记）', jsPe.includes("BEAUTY_KEYS.push('widget-bg-' + t, 'widget-opacity-' + t);"));

if (!idx || !jsPe) {
  console.log('\n结果: ' + results.filter(r => r.ok).length + '/' + results.length + '（产物缺失＝环境不满足，先构建）');
  process.exit(2);
}
// S 段失败也继续跑 H 段：无头行为判别（H1a/H1b/H2a）才是「修复前必红」的直接证据

// ---- H 无头段 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const fail2 = (msg) => { try { require('node:fs').writeSync(2, msg + '\n'); } catch (e) {} };
if (!browserPath) { fail2('找不到 Edge/Chrome，请设置 CHROME_PATH'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (31300 + Math.floor(Math.random() * 300));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1516-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const EVAL_ERRS = [];
const pend = new Map();
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
  fail2('无法连接无头浏览器'); process.exit(2);
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      const d = String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 240);
      EVAL_ERRS.push(d);
      console.log('  [eval err] ' + d);
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

async function navigate() {
  await cdp('Page.navigate', { url: baseUrl + PAGE });
  for (let i = 0; i < 100; i++) {
    const ok = await evalJs("(function(){return !!document.querySelector('[data-card-bg=\"week\"]') && !!document.querySelector('.desk-clock') && typeof window.activeStore==='function';})()");
    if (ok) return true;
    await sleep(300);
  }
  return false;
}
const bgOf = (sel) => evalJs("(function(){var el=document.querySelector(" + JSON.stringify(sel) + ");return el?getComputedStyle(el).backgroundColor:'(missing)';})()");

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });

  // H1 全局统一：写全局小组件颜色＝纯红 → 周卡/时钟（隐藏池）/迷你卡全部跟随
  await navigate();
  await evalJs("window.activeStore().set('widget-bg-color', '#ff0000'); 'ok'");
  await navigate();
  const wk = await bgOf('.week-card');
  const dc = await bgOf('.desk-clock');
  const mc = await bgOf('.mini-card[data-card-bg="quote"]');
  check('H1a 全局色后 .week-card 跟随（修复前停 glass 白＝本尺判别点）', wk === 'rgb(255, 0, 0)', wk);
  check('H1b 全局色后 .desk-clock（隐藏池）跟随', dc === 'rgb(255, 0, 0)', dc);
  check('H1c 全局色后 .mini-card 跟随（原有行为不回归）', mc === 'rgb(255, 0, 0)', mc);

  // H2 单组件覆盖：deco=纯蓝 → 纪念日卡蓝、周卡仍红（两键互不干扰）
  await evalJs("window.activeStore().set('widget-bg-deco', '#0000ff'); 'ok'");
  await navigate();
  const dco = await bgOf('.deco-widget');
  const wk2 = await bgOf('.week-card');
  check('H2a 单组件色后 .deco-widget 独立变蓝', dco === 'rgb(0, 0, 255)', dco);
  check('H2b .week-card 不被单组件键波及（仍全局红）', wk2 === 'rgb(255, 0, 0)', wk2);
  check('Z 无头零 eval 异常', EVAL_ERRS.length === 0, EVAL_ERRS.slice(0, 3));
} finally {
  try { browser.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const pass = results.filter(r => r.ok).length;
console.log('\n结果: ' + pass + '/' + results.length);
process.exit(pass === results.length ? 0 : 1);

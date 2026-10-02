// ===== 验证（#140）：安卓「返回键/手势收键盘」路径——焦点保留、focusout 不来 =====
// 症状（红米 K80 / 小米15Pro / 其他安卓 Chrome 通用）：聊天输入栏打字后按系统返回
// 收键盘，输入栏下方灰色块几秒才收起。根因：#89 的 _aClosing 闸门只挂在 focusout
// （点发送失焦收起路径）；返回键收起时内核保留焦点，收起动画期每帧 vv.resize 照旧
// 跑 _aPinPan()/nudgeInputVisible() 的强制布局读取（读 offsetTop/scrollY/
// getBoundingClientRect），重聊天页单帧 reflow ~100ms 积压 → .phone 高度跟不上
// 键盘收起 → 下方露 body 灰底数秒。
// 修复断言：syncAndroidKb 顶部「h 上升且键盘开着=收起动画」探测置 _aClosing，
//   收起动画期（h 在 [_aH-60, _aH-12) 区间）只写 height 跟随、跳过 _aPinPan；
//   复原时 _aH 钳回 innerHeight、.phone 恢复满高。
// 手法：无头 Chrome + vv.height 补丁逐帧回升模拟收起动画；用 PerformanceObserver
//   统计动画窗口内 layout 操作数对比「有/无 _aClosing 旁路」两个产物版本。
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kbclose-' + Date.now()),
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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(400);
await evalJs("(function(){var c=document.getElementById('splash-confirm-ok');if(c&&!c.hidden)c.click();return true;})()");
await sleep(600);
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});})()");
await sleep(300);

// 安装 vv.height 补丁（模拟键盘弹出/收起，焦点全程保留在输入框——返回键收起语义）
await evalJs(`(function(){
  var vv=window.visualViewport;
  if(!vv.__patched){
    var h=vv.height;
    Object.defineProperty(vv,'height',{get:function(){return h;},configurable:true});
    window.__setVvHeight=function(v){h=v;vv.dispatchEvent(new Event('resize'));};
    vv.__patched=1;
  }
  return true;})()`);

// 1) 键盘弹出：844 → 430，.phone 应收缩（原 v3.10.x 语义）
await evalJs('window.__setVvHeight(430)');
await sleep(600);
const shrunk = await evalJs("(function(){var ph=document.querySelector('.phone');return ph.style.height;})()");
check('键盘弹出后 .phone 收缩到可视高度', shrunk === '430px', String(shrunk));

// 2) 返回键收键盘（焦点保留、无 focusout）：vv 高度逐帧回升模拟 ~400ms 收起动画。
//    修复后：动画窗口内 _aClosing 置位，_aPinPan 被跳过（其特征=读 visualViewport.offsetTop）。
//    用「offsetTop 读取探针」计数——_aPinPan 每次执行必读它，动画窗口内读数应为 0。
//    （iOS 专属自愈在无头安卓 UA 下不装，Android 分支 _aPinPan 是唯一 offsetTop 读取方；
//    250ms 轮询在动画窗口内最多跑 2 次，其中 _aPinPan 受 _aClosing 拦截。）
await evalJs(`(function(){
  var vv=window.visualViewport;
  window.__offTopReads=0;
  var cur=vv.offsetTop||0;
  Object.defineProperty(vv,'offsetTop',{get:function(){window.__offTopReads++;return cur;},configurable:true});
  return true;})()`);
// 逐帧回升：430 → 500 → 570 → 640 → 710 → 780（每帧 <_aH-12，动画区间内），最后 844 复原
const frames = [500, 570, 640, 710, 780];
for (const f of frames) {
  await evalJs('window.__setVvHeight(' + f + ')');
  await sleep(50);
}
const midReads = await evalJs('window.__offTopReads');
const midH = await evalJs("(function(){var ph=document.querySelector('.phone');return ph.style.height;})()");
check('收起动画期（焦点保留）不跑 _aPinPan 的 offsetTop 强制读取', midReads === 0, 'reads=' + midReads);
check('收起动画期 .phone 高度跟随 vv 平滑上浮（不提前撑满）', midH === '780px', String(midH));

// 3) 复原：844 → .phone 恢复满高、inline 清空（v3.27.x 语义保持）
await evalJs('window.__setVvHeight(844)');
await sleep(600);
const restored = await evalJs("(function(){var ph=document.querySelector('.phone');return JSON.stringify({h:ph.style.height||'(none)',align:ph.style.alignSelf||'(none)'});})()");
check('键盘收起后 .phone 恢复自然高度（inline 清空）', restored === '{"h":"(none)","align":"(none)"}', String(restored));

// 4) 复原后键盘可再次正常弹出（基准未被收起期污染：_aH 钳回 innerHeight）
await evalJs('window.__setVvHeight(430)');
await sleep(600);
const reshrunk = await evalJs("(function(){var ph=document.querySelector('.phone');return ph.style.height;})()");
check('复原后再次弹键盘仍正常收缩（_aH 基线健康）', reshrunk === '430px', String(reshrunk));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

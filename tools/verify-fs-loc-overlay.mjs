// #427/#428 全屏浮层双修回归——vivo S60 自带浏览器报障（用户明说其他机型同现）：
//   #427 五子棋「点全屏自动回退聊天、刷新才能再开」：键盘停靠(kbDockPanels)给面板写内联
//        position:absolute/bottom/left/right/top/max-height，国产内核 vv 收起事件不可靠时
//        kbUndockPanels 不执行 → 内联残留压过 .game-fs 规则。修复=全屏规则 !important 四长手
//        （.poke-card.game-fs / pong-fs / snake-fs / brick-fs）+ gomoku 兄弟互斥只认真可见面板。
//   #428 寻踪「看看TA在哪页面卡死只能刷新」：备份提醒条(#backup-remind-bar z-998)盖住
//        全屏位置面板(z 原 78)的返回按钮 → 面板关不掉+滚动锁。修复=.loc-panel.loc-full z-9999。
// 无头 Chromium/Edge + vivo 形态视口（360×796，Android UA + 触摸），真实命中测试（elementFromPoint）。
// 用法：node tools/verify-fs-loc-overlay.mjs （需已构建 index.html；CHROME_PATH 可指定浏览器）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 200) + ']' : ''));
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!browserPath) { console.error('找不到 Edge/Chrome，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (24000 + Math.floor(Math.random() * 2000));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fs-loc-' + Date.now()),
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
      console.log('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 250));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function tap(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function tapEl(sel) {
  const r = await evalJs(`(function(){var e=document.querySelector('${sel}');if(!e)return null;var b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2),vis:!e.hidden&&b.width>0&&b.height>0};})()`);
  if (!r || !r.vis) return false;
  await tap(r.x, r.y);
  await sleep(350);
  return true;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 探针环境关问答门/应用锁（真实用户已答过；UA 覆盖会掩盖无头检测）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:applock-qa-en','0');localStorage.setItem('xy-home-v2:applock-en','0');}catch(e){}" });
// vivo S60 形态
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 796, deviceScaleFactor: 1.5, mobile: true, screenWidth: 360, screenHeight: 796 });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; V2318A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36' });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 60; i++) {
  const ok = await evalJs("(function(){return !!window.__mochiDataReady && typeof window.openGomokuPanel === 'function';})()");
  if (ok) break;
  await sleep(300);
}
await evalJs("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
await sleep(800);

// 强制备份提醒条显形（复现用户现场：距上次导出超 2 天 #355）
const barShown = await evalJs("(function(){var b=document.getElementById('backup-remind-bar');if(!b)return false;b.hidden=false;return !b.hidden && b.getClientRects().length>0;})()");
check('P0 前置：备份提醒条已显形（z-998 顶部条，用户现场）', barShown === true);

// ================= S1 #428 寻踪「看看TA在哪」：全屏面板返回按钮不被提醒条盖住 =================
// 直接切页（同 device.js restoreDesk 模式，避免桌面图标点击竞态）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-checkin');});return 1;})()");
await sleep(500);
const pg1 = await evalJs("!document.getElementById('page-checkin').hidden");
check('S1-1 寻踪页已打开', pg1 === true);
await tapEl('#ck-loc-entry-desk');
await sleep(600);
const loc = await evalJs(`(function(){
  var p=document.getElementById('loc-panel');
  var back=document.getElementById('loc-back');
  if(!p||p.hidden||!back) return {open:false};
  var b=back.getBoundingClientRect();
  var top=document.elementFromPoint(Math.round(b.left+b.width/2),Math.round(b.top+b.height/2));
  var r=p.getBoundingClientRect();
  return {open:true,full:r.width>=innerWidth-2&&r.height>=innerHeight-2,
    backHitInPanel:!!(top&&p.contains(top)),
    topIsBar:!!(top&&top.closest&&top.closest('#backup-remind-bar')),
    z:getComputedStyle(p).zIndex};
})()`);
check('S1-2 位置面板全屏打开且 z=9999（#428 抬层生效）', !!(loc && loc.open && loc.full && loc.z === '9999'), loc);
check('S1-3 返回按钮可被点中（不被提醒条遮挡）', !!(loc && loc.backHitInPanel && !loc.topIsBar), loc);
const closed = await evalJs("(function(){var b=document.getElementById('loc-back');var r=b.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)];})()");
await tap(closed[0], closed[1]);
await sleep(450);
const locClosed = await evalJs("document.getElementById('loc-panel').hidden");
check('S1-4 点返回关闭面板（修复前点不动=卡死）', !!(loc && loc.open && locClosed === true), locClosed);
const lockOff = await evalJs("!document.body.classList.contains('scroll-lock')");
check('S1-5 关闭后滚动锁解除（不再整页卡死）', lockOff === true);

// ================= S2 #427 五子棋：键盘停靠内联残留下全屏仍生效、可退出、可重开 =================
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return 1;})()");
await sleep(500);
// 模拟 kbDockPanels 残留（与 mobile-adapt 写入的内联属性一致；国产内核 vv 收起事件丢失时 kbUndockPanels 不执行）
const poisoned = await evalJs("(function(){var p=document.getElementById('chat-gomoku-panel');p.style.position='absolute';p.style.left='18px';p.style.right='18px';p.style.top='auto';p.style.bottom='calc(96px + 0px)';p.style.maxHeight='calc(100% - 104px)';return true;})()");
check('S2-1 已注入键盘停靠内联残留（kbUndock 丢失现场）', poisoned === true);
await evalJs("(function(){window.openGomokuPanel();return 1;})()");
await sleep(400);
await tapEl('#gk-fs');
await sleep(500);
const fs1 = await evalJs(`(function(){
  var p=document.getElementById('chat-gomoku-panel');
  var r=p.getBoundingClientRect();
  var cs=getComputedStyle(p);
  var close=document.getElementById('gk-close');
  var cb=close.getBoundingClientRect();
  var top=document.elementFromPoint(Math.round(cb.left+cb.width/2),Math.round(cb.top+cb.height/2));
  return {pos:cs.position,top:cs.top,cls:p.className,
    covers:r.width>=innerWidth-2&&r.height>=innerHeight-2&&r.top<=1,
    closeHittable:!!(top&&p.contains(top)),
    phoneLift:document.querySelector('.phone').classList.contains('game-fs-active')};
})()`);
check('S2-2 内联残留下点全屏仍 fixed 满屏（#427 !important 生效）', !!(fs1 && fs1.pos === 'fixed' && fs1.covers && String(fs1.cls).indexOf('game-fs') >= 0), fs1);
check('S2-3 全屏面板关闭按钮可点中（头部不被盖/不错位）', !!(fs1 && fs1.closeHittable), fs1);
check('S2-4 .phone game-fs-active 抬层已挂（#320 生效）', !!(fs1 && fs1.phoneLift), fs1);
const csPos = await evalJs("(function(){var b=document.getElementById('gk-close').getBoundingClientRect();return [Math.round(b.left+b.width/2),Math.round(b.top+b.height/2)];})()");
await tap(csPos[0], csPos[1]);
await sleep(400);
const closed1 = await evalJs("document.getElementById('chat-gomoku-panel').hidden");
check('S2-5 全屏内点 ✕ 正常关闭', closed1 === true);
await evalJs("(function(){window.openGomokuPanel();return 1;})()");
await sleep(400);
const reopen = await evalJs("(function(){var p=document.getElementById('chat-gomoku-panel');return {hidden:p.hidden,rects:p.getClientRects().length};})()");
check('S2-6 关闭后可直接重开（无需刷新）', !!(reopen && !reopen.hidden && reopen.rects > 0), reopen);
// 全屏退出后 .phone 抬层还原
await evalJs("(function(){var p=document.getElementById('chat-gomoku-panel');p.hidden=true;p.classList.remove('game-fs');return 1;})()");
await sleep(300);
const liftOff = await evalJs("!document.querySelector('.phone').classList.contains('game-fs-active')");
check('S2-7 退出全屏后 .phone 抬层还原（提醒条恢复可见）', liftOff === true);

// ================= S3 无 JS 错误污染 =================
const errs = await evalJs("(function(){return (window.__jsErrors||[]).filter(function(e){return /gomoku|loc-panel|backup-remind|chat-pages/i.test(String(e&&e.message||e));}).length;})()");
check('S3 相关路径零 JS 错误', errs === 0, errs);

browser.kill();
server.close();
const okN = results.filter((x) => x.ok).length;
console.log('\n' + okN + '/' + results.length + ' passed');
process.exit(okN === results.length ? 0 : 1);

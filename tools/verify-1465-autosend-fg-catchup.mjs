// ===== 验证（#1465）：联系人主动发送「回前台补掷一轮」 =====
// 症状（作者转报）：有用户把主动发送概率设 60%，一整天没触发；另一台设备正常，疑机型/浏览器差异。
// 根因：主动发送整链＝页面内 setTimeout（scheduleAutoSend→tryAutoSend），ta-ask 互动卡/备忘录/
//   经期关心/心意币申请都有回前台补触发通道，唯独主动发送没有——后台冻结/页面被丢弃（Edge 睡眠
//   标签页/Chrome 内存节省程序/ROM 省电/iOS 挂起）期间错过的轮次永远丢失，回前台还要重新等满间隔
//   才掷第一签；页面死多久就欠多久。
// 修复契约（断言口径）：
//   A6  回复设置未就绪：当场不掷、1.5s 重试等就绪后再掷（重试不被 5 秒合并窗吞掉；先跑＝它需要
//       asCatchupAt 还是初值 0，合并窗判据才天然通过）；
//   A1【核心】真见过 hidden → 长离场（≥当前口径最短间隔）→ 回可见：恰补掷一轮（tryAutoSend 恰 +1），
//      且 hidden 印记被消费（state.hiddenAt 归 0）；
//   A2  短离场（< 最短间隔）回场：不补（正常定时器还挂着，不抢）；
//   A3  长离场但上一轮刚开掷过（后台节流迟到的旧定时器先跑）：不补＝回场瞬间不双掷；
//   A4  一次回场多通道报到／probe 连发两枪：5 秒合并窗内只算一次；
//   A5  主动发送总开关关闭：不补掷（也不清挂起定时器）；
//   A7  页面被浏览器丢弃后回载（document.wasDiscarded=true）：hiddenAt=0 也补掷一轮＝长离场视同；
//   A7b 无 hidden 且非丢弃回载（手动刷新形态）：不掷；
//   Z1  全程零页面异常。
// 时钟编排：各场景走「递增虚拟时钟」（Date.now 局部桩，偏移 +400s/+410s/…/+2500s，同步分发包住、
//   无 await）——相邻场景间隔 ≥5s 避开合并窗、补掷后的场景与上一轮开掷间隔 ≥ 最短间隔(5min)避开
//   lastTry 闸，谁也不吃谁的判据。RED/GREEN 判别力：纯 HEAD 产物上 __asCatchupProbe 不存在＝
//   A1/A4/A5/A6/A7 族必红（补掷能力整体缺失），A2/A3/A7b 在 RED 侧「碰巧绿」（旧代码本来就不补）
//   ＝它们守「补掷不越权」契约，防将来把补掷写成无条件。故 RED 判别以 A1 为核心，绿侧要求全绿。
// 手法：document 实例 defineProperty 影子 visibilityState（盖原型 getter）＋合成分发真实
//   visibilitychange（整条监听链照跑，含 bg-keep 的 mochi-fg-resume 二次报到＝真实双通道）；
//   tryAutoSend 开掷计数＝包一层 console.log 数 '[mochi-auto] tryAutoSend called'。
// 用法：node tools/verify-1465-autosend-fg-catchup.mjs（默认服务仓内构建产物）
//       MOCHI_ARTIFACT=<其它 index.html> 跑 RED 基线。
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
const ARTIFACT = process.env.MOCHI_ARTIFACT || '';
const server = createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (ARTIFACT && (urlPath === '/' || urlPath === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(ARTIFACT));
      return;
    }
    let p = normalize(join(root, urlPath));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1465-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS  ' + name + (extra ? '  [' + extra + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } }

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1000);
await evalJs(`(function(){var b=document.getElementById('splash-confirm-ok')||document.getElementById('splash-enter');if(b)b.click();return !!b;})()`);
await sleep(400);
for (let i = 0; i < 20; i++) {
  const r = await evalJs(`(function(){
    var m=document.getElementById('splash-mandatory'); if(!m||m.hidden) return 'none';
    var sc=document.getElementById('splash-mandatory-scroll'); if(sc) sc.scrollTop=sc.scrollHeight;
    var en=document.getElementById('splash-mandatory-enter');
    if(en&&!en.classList.contains('is-disabled')){en.click();return 'entered';} return 'wait';})()`);
  if (r === 'entered' || r === 'none') break;
  await sleep(250);
}
await evalJs(`(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}return true;})()`);
await evalJs(`(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()`);
await sleep(300);
// 页面级零异常计数
await evalJs(`(function(){ window.__errs=[]; window.addEventListener('error',function(e){window.__errs.push(String(e.message||e));}); return true;})()`);
// tryAutoSend 开掷计数：包一层 console.log（真身照常执行）
await evalJs(`(function(){window.__tryCalls=0;var ol=console.log;console.log=function(){try{if(String(arguments[0]||'').indexOf('tryAutoSend called')>=0)window.__tryCalls++;}catch(e){}return ol.apply(console,arguments);};return true;})()`);
// 影子 visibilityState＋合成事件驱动器；虚拟时钟＝把 Date.now 桩到 realNow()+offset 秒
await evalJs(`(function(){
  Object.defineProperty(document,'visibilityState',{get:function(){return document.__shadowVis||'visible';},configurable:true});
  window.__fakeVis=function(v){document.__shadowVis=v;document.dispatchEvent(new Event('visibilitychange'));return document.visibilityState;};
  window.__clockAt=function(sec){ if(!window.__realNow) window.__realNow=Date.now; Date.now=function(){ return window.__realNow() + (sec==null?0:sec*1000); }; };
  return true;})()`);
await sleep(500);

const probeAlive = await evalJs(`!!(window.__asCatchupProbe && window.__asCatchupProbe.fire)`);
check('P0  #1465 补掷探针在场（window.__asCatchupProbe）', probeAlive === true);

// ---- A6（先跑：需要 asCatchupAt 仍是初值 0 或已过期）replyCfg 未就绪 → 重试就绪后落 ----
await sleep(5300); // 让开机 pageshow／focus 通道盖下的合并窗戳（真实时刻）过期，A6 不吃它的合并
{
  const r = await evalJs(`(function(){
    try {
      var realCfg = window.replyCfg;
      var before = window.__tryCalls;
      window.__clockAt(-3*3600);
      window.__fakeVis('hidden');
      window.__clockAt(null);
      window.replyCfg = undefined;          // 未就绪
      window.__fakeVis('visible');          // 当场不掷、挂 1.5s 重试
      window.replyCfg = realCfg;            // 恢复＝重试那一刻已就绪
      return { immediate: window.__tryCalls - before, before: before };
    } catch (e) { return { err: String(e) }; }
  })()`);
  await sleep(2600);                        // 等重试落地
  const fired = await evalJs('window.__tryCalls - ' + (r && r.before != null ? r.before : 'NaN'));
  check('A6  replyCfg 未就绪当场不掷', r && r.immediate === 0, r && ('immediate=' + r.immediate));
  check('A6b 1.5s 重试在就绪后落到（不被合并窗吞）', fired === 1, 'fired=' + fired);
}
// ---- A1【核心】长离场(3h)回场＝恰补掷一轮（虚拟时钟 +400s）----
{
  const r = await evalJs(`(function(){
    try {
      var before = window.__tryCalls;
      window.__clockAt(-3*3600);
      window.__fakeVis('hidden');
      window.__clockAt(400);
      window.__fakeVis('visible');          // away≈3h ≥5min；距 A6 开掷 ≈398s ≥300s → 补掷
      window.__clockAt(null);
      var st = window.__asCatchupProbe.state();
      return { fired: window.__tryCalls - before, hiddenAt: st.hiddenAt };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('A1  长离场(3h)回场＝恰补掷一轮', r && r.fired === 1, r && ('fired=' + r.fired + (r.err ? ' err=' + r.err : '')));
  check('A1b hidden 印记补掷后被消费', r && r.hiddenAt === 0, r && ('hiddenAt=' + r.hiddenAt));
}
// ---- A2 短离场不补（+405s 藏 → +410s 回）----
{
  const r = await evalJs(`(function(){
    try {
      var before = window.__tryCalls;
      window.__clockAt(405);
      window.__fakeVis('hidden');           // 5 秒前才藏
      window.__clockAt(410);
      window.__fakeVis('visible');          // away=5s <5min → 不补
      window.__clockAt(null);
      return { fired: window.__tryCalls - before };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('A2  短离场回场＝不补掷', r && r.fired === 0, r && ('fired=' + r.fired));
}
// ---- A3 长离场但上一轮刚开掷过＝不双掷（+420s）----
{
  const r = await evalJs(`(function(){
    try {
      var before = window.__tryCalls;
      window.__clockAt(-3*3600);
      window.__fakeVis('hidden');
      window.__clockAt(420);                // lastTry=A1 的 +400s → 20s <5min → 让位
      document.__shadowVis = 'visible';     // 用户已回前台（只切影子不派事件＝不触发真实监听链）
      window.__asCatchupProbe.fire();
      window.__clockAt(null);
      return { fired: window.__tryCalls - before };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('A3  上一轮刚开掷（迟到旧定时器先跑）＝不双掷', r && r.fired === 0, r && ('fired=' + r.fired));
}
// ---- A4 5 秒合并窗：连发两枪只补一轮（+900s）----
{
  const r = await evalJs(`(function(){
    try {
      var before = window.__tryCalls;
      window.__clockAt(-3*3600);
      window.__fakeVis('hidden');
      window.__clockAt(900);                // 距 A1 开掷 500s ≥300s → 第一枪补
      document.__shadowVis = 'visible';     // 用户已回前台（只切影子不派事件）
      window.__asCatchupProbe.fire();
      var first = window.__tryCalls - before;
      window.__asCatchupProbe.fire();       // 同一刻第二枪 → 合并
      window.__clockAt(null);
      return { first: first, total: window.__tryCalls - before };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('A4  多通道报到 5 秒合并＝只补一轮', r && r.first === 1 && r.total === 1, r && ('first=' + r.first + ' total=' + r.total));
}
// ---- A5 总开关关闭不补掷（+1200s）----
{
  const r = await evalJs(`(function(){
    try {
      var cid = (window.__activeCid || 'default');
      localStorage.setItem('xy-home-v2:' + cid + ':reply-as-en', '0');
      var before = window.__tryCalls;
      window.__clockAt(-3*3600);
      window.__fakeVis('hidden');
      window.__clockAt(1200);
      window.__fakeVis('visible');          // 开关关 → 不补（虚拟时钟也越过合并窗）
      window.__clockAt(null);
      var fired = window.__tryCalls - before;
      localStorage.removeItem('xy-home-v2:' + cid + ':reply-as-en');
      return { fired: fired };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('A5  主动发送总开关关＝不补掷', r && r.fired === 0, r && ('fired=' + r.fired));
}
// ---- A7 页面被丢弃回载（wasDiscarded）＝hiddenAt=0 也补掷（+2400s，距 A4 开掷 ≥5min）----
{
  const r = await evalJs(`(function(){
    try {
      var before = window.__tryCalls;
      Object.defineProperty(document,'wasDiscarded',{get:function(){return true;},configurable:true});
      window.__clockAt(2400);
      window.__asCatchupProbe.fire();       // hiddenAt=0 且 wasDiscarded → 视同长离场补掷
      window.__clockAt(null);
      var fired = window.__tryCalls - before;
      delete document.wasDiscarded;
      return { fired: fired };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('A7  被丢弃回载（wasDiscarded）＝补掷一轮', r && r.fired === 1, r && ('fired=' + r.fired));
  const r2 = await evalJs(`(function(){
    try {
      var before = window.__tryCalls;
      window.__clockAt(2500);
      window.__asCatchupProbe.fire();       // wasDiscarded 已删＋hiddenAt=0 → 手动刷新形态不掷
      window.__clockAt(null);
      return { fired: window.__tryCalls - before };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('A7b 无 hidden 且非丢弃回载（手动刷新形态）＝不掷', r2 && r2.fired === 0, r2 && ('fired=' + r2.fired));
}
// ---- Z1 零页面异常 ----
const errs = await evalJs(`window.__errs || []`);
check('Z1  全程零页面异常', Array.isArray(errs) && errs.length === 0, errs && errs.slice(0, 3).join(' | '));

console.log('\n==== verify-1465-autosend-fg-catchup: ' + pass + ' PASS / ' + fail + ' FAIL ====');
console.log(ARTIFACT ? ('（RED 基线产物：' + ARTIFACT + '）——预期 A1/A4/A5/A6/A7 族红（probe 缺失＝补掷能力缺失）、A2/A3/A7b/Z1 绿') : '（GREEN：本批产物）——要求全绿');
chrome.kill();
server.close();
process.exit(fail === 0 ? 0 : 1);

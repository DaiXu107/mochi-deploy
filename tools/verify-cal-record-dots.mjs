// ===== 日历「有记录日打点 + 主日历去经期化」验证 =====
// 需求：①日历上留言过/做过备忘等记录过信息的日期加圆点标识，与无记录日期区分；
//      ②主日历不再显示经期信息（着色/长按跳转），经期只在第三页「经期记录」独立功能的月历里展示。
// 背景：period.js 曾在 v3.10.x 批量提交中被整文件清空（模板/CSS/桌面组件/聊天守卫调用均在，
//      WORKLOG 无移除记录，判定误删），本批次从 e8e56fe^ 恢复——D 组同时回归独立经期页可用性。
// 覆盖：
//   A 组 打点出现：我的留言(cal-my-*)/备忘(memo-*)/心情(today-mood-*) 当日快照 → cal-rec
//   B 组 历史列表回退：memo-history/mood-history 按 ts 落点跨月打点（切上月验证）
//   C 组 主日历去经期：种入经期记录后月历格仍无 cal-period-* 类
//   D 组 独立经期功能恢复：periodDayPhase 可用 / 独立月历经期日 ph-period 红格
//   E 组 交互回归：点日格切换查看当日内容正常；右键(原长按跳转路径)不再跳经期页；
//        喝水蓝点+记录琥珀点同日并存（双伪元素并排）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-calrec-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('DOM.enable'); await cdp('CSS.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await gotoApp();

// ---- 种数据（走应用自身 activeStore 命名空间；今天=当月 25 日附近，动态取日期）----
const D = await evalJs(`(function(){
  var n=new Date();
  function ds(d){return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
  var pm=new Date(n.getFullYear(),n.getMonth()-1,1);
  function pds(d){return pm.getFullYear()+'-'+String(pm.getMonth()+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
  return { today:ds(n.getDate()), d5:ds(5), d8:ds(8), d12:ds(12), d10:ds(10), pd15:pds(15), pd18:pds(18), pd20:pds(20), month:n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0'), pmonth:pm.getFullYear()+'-'+String(pm.getMonth()+1).padStart(2,'0'), todayDate:n.getDate() };
})()`);
const seedRes = await evalJs(`(function(){
  try{
    var s=window.activeStore();
    s.set('cal-my-${D.today}','今天也要加油呀');
    s.set('memo-${D.d5}','给TA准备生日礼物');
    s.set('today-mood-${D.d8}','开心');
    var mh=JSON.parse(s.get('memo-history')||'[]'); mh.push({ts:new Date('${D.pd15}T12:00:00').getTime(),text:'旧备忘一条'}); s.set('memo-history',JSON.stringify(mh));
    var oh=JSON.parse(s.get('mood-history')||'[]'); oh.push({ts:new Date('${D.pd20}T12:00:00').getTime(),text:'平静'}); s.set('mood-history',JSON.stringify(oh));
    return 'seeded';
  }catch(e){return 'ERR:'+e.message;}
})()`);
check('S0 种子数据写入成功', seedRes === 'seeded', String(seedRes));

// 打开日历页（进入即重置本月+今天并 render）
const opened = await evalJs(`(function(){
  var app=document.querySelector('.app[data-app="calendar"]');
  app.click();
  var pg=document.getElementById('page-calendar');
  return pg && !pg.hidden ? 'open':'not-open';
})()`);
await sleep(500);
check('S1 日历页打开', opened === 'open', String(opened));

// ---- A 组：当日快照打点 ----
async function cellHasCls(ds, cls) {
  return evalJs(`(function(){
    var c=document.querySelector('#cal-grid .cal-cell[data-date="${ds}"]');
    return c ? c.classList.contains('${cls}') : null;
  })()`);
}
check('A1 今天有「我的留言」→ 打点', (await cellHasCls(D.today, 'cal-rec')) === true);
check('A2 备忘日(${D.d5}) → 打点'.replace('${D.d5}', D.d5), (await cellHasCls(D.d5, 'cal-rec')) === true);
check('A3 心情日(${D.d8}) → 打点'.replace('${D.d8}', D.d8), (await cellHasCls(D.d8, 'cal-rec')) === true);
check('A4 无记录日(${D.d12}) → 无打点'.replace('${D.d12}', D.d12), (await cellHasCls(D.d12, 'cal-rec')) === false);

// ---- B 组：历史列表 ts 回退（切上月）----
await evalJs(`document.getElementById('cal-prev').click()`);
await sleep(400);
check('B1 memo-history 按ts落点(${D.pd15}) 上月 → 打点'.replace('${D.pd15}', D.pd15), (await cellHasCls(D.pd15, 'cal-rec')) === true);
check('B2 mood-history 按ts落点(${D.pd20}) 上月 → 打点'.replace('${D.pd20}', D.pd20), (await cellHasCls(D.pd20, 'cal-rec')) === true);
check('B3 上月无记录日(${D.pd18}) → 无打点'.replace('${D.pd18}', D.pd18), (await cellHasCls(D.pd18, 'cal-rec')) === false);

// ---- C 组：主日历去经期 ----
const noPeriodCls = await evalJs(`(function(){
  var bad=document.querySelectorAll('#cal-grid .cal-cell[class*="cal-period"]');
  return { badCount:bad.length, htmlNoMark: document.getElementById('cal-grid').innerHTML.indexOf('cal-period')<0 };
})()`);
check('C1 本月历无任何 cal-period-* 类', noPeriodCls && noPeriodCls.badCount === 0 && noPeriodCls.htmlNoMark === true, JSON.stringify(noPeriodCls));

// B 组切过上月，先回到本月再做交互回归
await evalJs(`document.getElementById('cal-next').click()`);
await sleep(400);

// ---- E1（先在未种经期时做交互回归）：点备忘日切换查看 ----
// 注意：render 会整体重建 #cal-grid，点击后须重新查询节点取新类名
const selRes = await evalJs(`(function(){
  try{
    var c=document.querySelector('#cal-grid .cal-cell[data-date="${D.d5}"]');
    if(!c) return { err:'no-cell' };
    c.click();
    var c2=document.querySelector('#cal-grid .cal-cell[data-date="${D.d5}"]');
    var memoTxt=(document.getElementById('cal-memo')||{}).textContent||'';
    return { sel:c2 ? c2.classList.contains('sel') : false, memoTxt:memoTxt };
  }catch(e){ return { err:String(e && e.message || e), stack:String(e && e.stack || '').slice(0,300) }; }
})()`);
await sleep(300);
check('E1 点日格选中并显示该日备忘内容', selRes && selRes.sel && String(selRes.memoTxt).indexOf('生日礼物') >= 0, JSON.stringify(selRes));

// ---- 种经期区间 + 喝水记录 → 刷新走第二阶段 ----
// 注意：恢复后的 period.js 用全局根命名空间 xy-home-v2（v3.10.x 经期数据多桌面互通），
// 必须经 window.xyStore('xy-home-v2') 种 period-records，种到桌面命名空间读不到。
const seedP = await evalJs(`(function(){
  try{
    var g=window.xyStore('xy-home-v2');
    g.set('period-records',JSON.stringify([{id:'t1',start:'${D.d10}',end:'${D.d12}'}]));
    var s=window.activeStore();
    var wh={}; try{wh=JSON.parse(s.get('water-history')||'{}')||{};}catch(e){}
    wh['${D.d5}']=250; s.set('water-history',JSON.stringify(wh));
    return 'ok';
  }catch(e){return 'ERR:'+e.message;}
})()`);
check('S2 经期区间+喝水记录种子写入', seedP === 'ok', String(seedP));

await gotoApp(); // 整页刷新：period.js 内存 recs 重新从存储加载
await evalJs(`(function(){
  window.__errs=[]; window.addEventListener('error',function(e){window.__errs.push(String(e.message));});
  var app=document.querySelector('.app[data-app="calendar"]'); app.click();
  return 'open';
})()`);
await sleep(500);

// C2：种入经期后主月历仍无经期类
const stillClean = await evalJs(`(function(){
  var bad=document.querySelectorAll('#cal-grid .cal-cell[class*="cal-period"]');
  return bad.length;
})()`);
check('C2 有经期数据时主月历仍无 cal-period-* 类', stillClean === 0, String(stillClean));

// D1：恢复的 period.js 暴露 periodDayPhase 且区间内判为 period（用区间中间日 11 号）
const phaseRes = await evalJs(`(function(){
  var n=new Date();
  var mid=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-11';
  return { fn: typeof window.periodDayPhase, mid: window.periodDayPhase ? window.periodDayPhase(mid) : null };
})()`);
check('D1 period.js 已恢复（periodDayPhase 函数且经期日内判 period）', phaseRes.fn === 'function' && phaseRes.mid === 'period', JSON.stringify(phaseRes));

// D2：独立经期页月历正常渲染且经期日标红
const perRes = await evalJs(`(function(){
  var app=document.querySelector('.app[data-app="period"]');
  app.click();
  var pg=document.getElementById('page-period');
  if(!pg||pg.hidden) return {open:false};
  var cell=document.querySelector('#period-grid .pc-cell[data-date="'+(function(){var n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-10';})()+'"]');
  var cells=document.querySelectorAll('#period-grid .pc-cell').length;
  return { open:true, cells:cells, red:!!(cell&&cell.classList.contains('ph-period')), hist:(document.getElementById('period-history')||{}).textContent||'' };
})()`);
await sleep(400);
check('D2 独立经期页打开、月历有格子', perRes && perRes.open && perRes.cells > 27, JSON.stringify(perRes && { open: perRes.open, cells: perRes.cells }));
check('D3 经期日在独立月历标红(ph-period)', !!(perRes && perRes.red));
check('D4 历史记录卡显示本次经期', !!(perRes && /进行中|~/.test(String(perRes.hist))), String(perRes && perRes.hist).slice(0, 60));

// 回到日历页做 E2/E3
await evalJs(`(function(){
  document.getElementById('period-back').click();
  var app=document.querySelector('.app[data-app="calendar"]'); app.click();
  return 'back';
})()`);
await sleep(400);

// E2：右键（原长按跳经期页的事件路径）不再导航到经期页
await evalJs(`(function(){
  var c=document.querySelector('#cal-grid .cal-cell[data-date="${D.d10}"]');
  c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
  return 'dispatched';
})()`);
await sleep(400);
const navState = await evalJs(`(function(){
  var pg=document.getElementById('page-period');
  var cal=document.getElementById('page-calendar');
  return { periodHidden:!pg||pg.hidden, calVisible:cal&&!cal.hidden };
})()`);
check('E2 右键经期日不再跳转经期页（留在日历）', navState && navState.periodHidden && navState.calVisible, JSON.stringify(navState));

// E3：备忘日+喝水记录同日 → cal-water 与 cal-rec 并存，两个伪元素都有内容
const dual = await evalJs(`(function(){
  var c=document.querySelector('#cal-grid .cal-cell[data-date="${D.d5}"]');
  if(!c) return null;
  var hasW=c.classList.contains('cal-water'), hasR=c.classList.contains('cal-rec');
  var ca=getComputedStyle(c,'::after').content, cb=getComputedStyle(c,'::before').content;
  return { hasW:hasW, hasR:hasR, after:ca, before:cb };
})()`);
check('E3 同日喝水+记录双类并存', !!(dual && dual.hasW && dual.hasR), JSON.stringify(dual));
check('E4 双伪元素均渲染（after/before content 生效）', !!(dual && dual.after !== 'none' && dual.before !== 'none'), JSON.stringify(dual && { after: dual.after, before: dual.before }));

// 无 JS 异常
const errs = await evalJs('window.__errs || []');
check('Z0 全程无 JS 异常', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

await chrome.kill();
server.close();
const fails = results.filter((r) => !r.ok);
console.log('\\n== ' + (results.length - fails.length) + '/' + results.length + ' 通过 ==');
process.exit(fails.length ? 1 : 0);

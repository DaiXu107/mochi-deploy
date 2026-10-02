// ===== 冒烟：日历页日期点击自选（AI-A v3.7.x） =====
// 场景：
//   1. 进入日历页：默认显示今天、今天格有 today/sel 类、编辑按钮可见
//   2. 点历史日期（如本月 5 号）：上方卡片切到该日内容（日期/心情/TA正在/TA留言），
//      该格 sel 高亮、编辑按钮隐藏、我的留言区空态「这一天没有留下留言」
//   3. 点未来日期（下月 1 号）：显示空态「这一天还没有内容」、不落盘 cal-*
//   4. 点回今天：恢复今天内容 + 编辑按钮可见
// 用法：node tools/smoke-cal-select.mjs
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = 9900 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-smoke-calsel-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 90) + ']' : ''));
}

const now = new Date();
const dayStr = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const todayDs = dayStr(now);
const todayD = now.getDate();

// ---- 进入日历页 ----
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"calendar\"]');if(a){a.click();}return true;})()");
await sleep(600);
let st = await evalJs("(function(){var p=document.getElementById('page-calendar');return {hidden:p.hidden, date:document.getElementById('cal-today-date').textContent, cells:document.querySelectorAll('#cal-grid .cal-cell:not(.blank)').length, todaySel:document.querySelectorAll('#cal-grid .cal-cell.today').length, editHidden:document.getElementById('cal-edit-btn').hidden};})()");
check('进入日历页（页面可见）', st && st.hidden === false, JSON.stringify(st));
check('默认显示今天日期', st && st.date === todayDs, st && st.date);
check('今天格子有 today 类（且有高亮）', st && st.todaySel === 1, JSON.stringify(st));
check('今天是今天时编辑按钮可见', st && st.editHidden === false, 'hidden=' + st && st.editHidden);

// ---- 点历史日期（本月 5 号，若今天<=5 则用 1 号）----
const histDay = todayD > 5 ? 5 : 1;
const histDs = todayDs.slice(0, 8) + String(histDay).padStart(2, '0');
const cellSel = await evalJs("(function(){var c=document.querySelector('#cal-grid .cal-cell[data-date=\"" + histDs + "\"]');if(!c)return null;c.click();return true;})()");
await sleep(500);
st = await evalJs("(function(){return {date:document.getElementById('cal-today-date').textContent, mood:document.getElementById('cal-mood-name').textContent, act:document.getElementById('cal-activity').textContent, msg:document.getElementById('cal-message').textContent, mine:document.getElementById('cal-my-message').textContent, editHidden:document.getElementById('cal-edit-btn').hidden, selCells:document.querySelectorAll('#cal-grid .cal-cell.sel').length, selDate:document.querySelector('#cal-grid .cal-cell.sel')?document.querySelector('#cal-grid .cal-cell.sel').getAttribute('data-date'):''};})()");
check('点历史日期后上方日期切换为该日', st && st.date === histDs, st && st.date);
check('该日心情/TA正在/TA留言已显示（非空）', st && st.mood && st.act && st.msg.length > 5, st && st.mood + '/' + st.act);
check('该日格被 sel 高亮且 data-date 正确', st && st.selCells === 1 && st.selDate === histDs, st && st.selDate);
check('非今天日期编辑按钮隐藏', st && st.editHidden === true, 'hidden=' + st && st.editHidden);
check('非今天无留言显示空态', st && st.mine === '这一天没有留下留言', st && st.mine);

// ---- 点未来日期（下月 1 号）----
const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
const nextY = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
const futDs = nextY + '-' + String(nextMonth + 1).padStart(2, '0') + '-01';
await evalJs("(function(){var n=document.getElementById('cal-next');if(n)n.click();return true;})()");
await sleep(300);
await evalJs("(function(){var c=document.querySelector('#cal-grid .cal-cell[data-date=\"" + futDs + "\"]');if(!c)return null;c.click();return true;})()");
await sleep(400);
st = await evalJs("(function(){return {date:document.getElementById('cal-today-date').textContent, name:document.getElementById('cal-mood-name').textContent, desc:document.getElementById('cal-mood-desc').textContent, act:document.getElementById('cal-activity').textContent, msg:document.getElementById('cal-message').textContent};})()");
const calFut = await evalJs("(function(){try{return localStorage.getItem('xy-home-v2:default:cal-" + futDs + "');}catch(e){return 'ERR';}})()");
check('点未来日期显示空态（未到来/无内容）', st && st.name === '未来' && st.desc.indexOf('还没有内容') >= 0, st && st.name + '/' + st.desc);
check('未来日期 TA 留言为空态', st && st.msg === '这一天还没有留言', st && st.msg);
check('未来日期不落盘 cal-*', calFut === null, String(calFut));

// ---- 切回本月并点回今天 ----
await evalJs("(function(){var p=document.getElementById('cal-prev');if(p)p.click();return true;})()");
await sleep(300);
await evalJs("(function(){var c=document.querySelector('#cal-grid .cal-cell.today');if(!c)return null;c.click();return true;})()");
await sleep(400);
st = await evalJs("(function(){return {date:document.getElementById('cal-today-date').textContent, editHidden:document.getElementById('cal-edit-btn').hidden, selCells:document.querySelectorAll('#cal-grid .cal-cell.sel').length};})()");
check('点回今天恢复今天内容+编辑按钮', st && st.date === todayDs && st.editHidden === false, JSON.stringify(st));
check('今天格恢复 sel 高亮', st && st.selCells === 1, 'sel=' + st && st.selCells);

// ---- 无 JS 异常 ----
const jsErr = await evalJs("(function(){try{return localStorage.getItem('xy-home-v2:js-errors')||'';}catch(e){return '';}})()");
check('页面无 JS 异常', !jsErr, String(jsErr).slice(0, 80));

try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? failed.length + ' FAILED / ' + results.length : 'ALL PASS ' + results.length);
process.exit(failed.length ? 1 : 0);
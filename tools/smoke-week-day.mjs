// ===== 冒烟：本周日常点击其他日期查看（历史回退 / 未来日期不超前显示） =====
// 场景（今天 2026-08-20 周四）：本周 = 8/16(日) ~ 8/22(六)
//   1. 老版本数据只有历史列表（mood-history/memo-history 无按日快照）：
//      点 8/18 弹窗必须回退显示当天心情/备忘（此前显示"没有记录"）
//   2. 点未来日期 8/22：不生成 TA 内容、显示空态提示、不落盘 cal-*（此前超前显示）
//   3. 点无数据的历史日期 8/16：显示空态（日历记录允许当天生成）
//   4. 点今天 8/20：不弹窗
// 用法：node tools/smoke-week-day.mjs
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

const cdpPort = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-smoke-week-' + Date.now()),
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
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 本周日期（页面与 Node 同机同时区）----
const now = new Date();
const todayIdx = now.getDay();
const wsD = new Date(now);
wsD.setDate(now.getDate() - todayIdx);
const dayStr = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const weekDates = [];
for (let i = 0; i < 7; i++) { const d = new Date(wsD); d.setDate(wsD.getDate() + i); weekDates.push(dayStr(d)); }
const todayDs = dayStr(now);
const d18 = weekDates[2], d16 = weekDates[0], futureDs = weekDates[6]; // 8/18(周二) / 8/16(周日) / 8/22(周六)
const tsOn = (ds, h, m) => new Date(+ds.split('-')[0], +ds.split('-')[1] - 1, +ds.split('-')[2], h, m).getTime();

// ---- 渲染检查：7 天 data-date 正确 ----
const rendered = await evalJs("(function(){return Array.from(document.querySelectorAll('#week-days .week-day')).map(function(c){return c.getAttribute('data-date');});})()");
check('本周日常渲染 7 天且 data-date 正确', JSON.stringify(rendered) === JSON.stringify(weekDates), JSON.stringify(rendered));

// ---- 注入老版本数据（只有历史列表，无按日快照）----
const seed = "(function(){var ns='xy-home-v2:default:';" +
  "localStorage.setItem(ns+'mood-history',JSON.stringify([" +
    "{text:'心情超好的一天',ts:" + tsOn(d18, 10, 0) + "}," +
    "{text:'晚上有点累',ts:" + tsOn(d18, 21, 30) + "}]));" +
  "localStorage.setItem(ns+'memo-history',JSON.stringify([" +
    "{text:'备忘：给 TA 买了礼物',ts:" + tsOn(d18, 9, 15) + "}]));" +
  "return true;})()";
await evalJs(seed);

const clickDay = async (ds) => {
  await evalJs("(function(){var c=document.querySelector('#week-days .week-day[data-date=\"" + ds + "\"]');if(!c)return false;c.click();return true;})()");
  await sleep(400);
  return evalJs("(function(){var s=document.getElementById('modal-static');var m=document.getElementById('modal-mask');if(!s)return '';return (m&&!m.hidden)?s.textContent:'';})()");
};

// ---- 场景 1：点 8/18（老数据只有历史）→ 回退显示当天心情/备忘 ----
let txt = await clickDay(d18);
check('点 8/18 弹窗打开且首行日期正确', !!txt && txt.indexOf('8 月 18 日') >= 0, (txt || '').slice(0, 30));
check('8/18 心情历史回退显示（两条合并）', txt.indexOf('心情超好的一天') >= 0 && txt.indexOf('晚上有点累') >= 0, (txt || '').slice(0, 120));
check('8/18 备忘历史回退显示', txt.indexOf('备忘：给 TA 买了礼物') >= 0, (txt || '').slice(0, 120));
await evalJs("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var c=document.getElementById('modal-cancel');if(c)c.click();}return true;})()");
await sleep(300);

// ---- 场景 2：点未来日期 8/22 → 空态提示 + 不生成 cal-* ----
txt = await clickDay(futureDs);
check('点未来日期显示空态提示', txt.indexOf('未来的日子还没有内容') >= 0, (txt || '').slice(0, 60));
check('未来日期不显示 TA 内容', txt.indexOf('【TA 留言】') < 0 && txt.indexOf('【今日心情】') < 0, (txt || '').slice(0, 120));
const calFuture = await evalJs("(function(){try{return localStorage.getItem('xy-home-v2:default:cal-" + futureDs + "');}catch(e){return 'ERR';}})()");
check('未来日期不落盘 cal-' + futureDs, calFuture === null, String(calFuture));
await evalJs("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var c=document.getElementById('modal-cancel');if(c)c.click();}return true;})()");
await sleep(300);

// ---- 场景 3：点无数据历史日期 8/16 → 空态 + 日历记录当天生成 ----
txt = await clickDay(d16);
check('点 8/16 显示日历空态（TA 内容允许生成）', txt.indexOf('这一天没有日历记录') < 0 || txt.indexOf('【今日心情】') >= 0, (txt || '').slice(0, 60));
check('8/16 无心情显示空态文案', txt.indexOf('（这一天没有记录心情）') >= 0, (txt || '').slice(0, 120));
await evalJs("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var c=document.getElementById('modal-cancel');if(c)c.click();}return true;})()");
await sleep(300);

// ---- 场景 4：点今天不弹窗 ----
const todayClicked = await evalJs("(function(){var c=document.querySelector('#week-days .week-day.today');if(!c)return 'no-today-cell';c.click();var m=document.getElementById('modal-mask');return m.hidden?'hidden':'shown';})()");
check('点今天不弹窗', todayClicked === 'hidden', String(todayClicked));

// ---- 无 JS 异常 ----
const jsErr = await evalJs("(function(){try{return localStorage.getItem('xy-home-v2:js-errors')||'';}catch(e){return '';}})()");
check('页面无 JS 异常', !jsErr, String(jsErr).slice(0, 80));

try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? failed.length + ' FAILED / ' + results.length : 'ALL PASS ' + results.length);
process.exit(failed.length ? 1 : 0);
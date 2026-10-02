// ===== 喝水页升级功能冒烟验证 =====
// 覆盖：发到聊天 / TA 提醒 / 达标彩蛋 / 近7天柱状图 / 连续达标 / 单次容量(ml) / 日历打点
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-water-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
async function gotoApp(hash) {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (hash || '') });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const snap = `(() => {
  var pg = document.getElementById('page-water');
  return {
    pageOpen: !!pg && !pg.hidden,
    num: (document.getElementById('water-num') || {}).textContent || '',
    unit: (document.getElementById('water-unit') || {}).textContent || '',
    fillW: document.getElementById('water-fill') ? parseFloat(document.getElementById('water-fill').style.width || '0') : -1,
    cupsCount: document.querySelectorAll('#water-cups .water-cup').length,
    cupsOn: document.querySelectorAll('#water-cups .water-cup.on').length,
    weekCols: document.querySelectorAll('#water-week .water-col').length,
    weekTodayHit: !!(document.querySelector('#water-week .water-col.today.hit') || document.querySelector('#water-week .water-col.today.ok')),
    streak: (document.getElementById('water-streak') || {}).textContent || '',
    msg: (document.getElementById('water-msg') || {}).textContent || '',
    sendBtn: !!document.getElementById('water-send'),
    taBtn: !!document.getElementById('water-ta'),
    sizeBtn: !!document.getElementById('water-set-size'),
    cardDone: !!(document.querySelector('#page-water .water-card.done'))
  };
})()`;
const clickBtn = (id) => evalJs(`(function(){ var b=document.getElementById('${id}'); if(!b) return 'no-btn'; b.click(); return 'ok'; })()`);
const lsGet = (k) => evalJs(`localStorage.getItem('${k}')`);
const lsSet = (k, v) => evalJs(`localStorage.setItem('${k}', '${v}')`);
const lsClear = () => evalJs(`(function(){ Object.keys(localStorage).filter(function(k){return k.indexOf('xy-home-v2:default:water')===0;}).forEach(function(k){localStorage.removeItem(k);}); return 'ok'; })()`);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- A 组：基础渲染 + 达标彩蛋 ----
await lsClear();
await gotoApp();
await evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-water"]'); if(i) i.click(); return 'ok'; })()`);
await sleep(500);
let s = await evalJs(snap);
check('A1 打开喝水页', s.pageOpen, '');
check('A2 初始 0 杯 / 8 杯 / 0ml 显示', s.num === '0' && s.unit.indexOf('0 ml') >= 0 && s.unit.indexOf('8 杯') >= 0, s.unit);
check('A3 近7天柱状图渲染 7 列', s.weekCols === 7, 'cols=' + s.weekCols);
check('A4 发到聊天/TA提醒/单次量 按钮存在', s.sendBtn && s.taBtn && s.sizeBtn, '');

// +1 八次达标
for (let i = 0; i < 8; i++) { await clickBtn('water-plus'); await sleep(120); }
s = await evalJs(snap);
check('A5 达标后 8 杯 + 进度 100%', s.num === '8' && s.fillW >= 99.9, s.num + '/' + s.fillW);
check('A6 点亮水杯 8 个全 on', s.cupsCount === 8 && s.cupsOn === 8, s.cupsOn + '/' + s.cupsCount);
check('A7 连续达标显示 1 天', s.streak.indexOf('1') >= 0 && s.streak.indexOf('连续') >= 0, s.streak);
check('A8 达标彩蛋 card.done 类触发过', s.cardDone, '');
const todayRaw = await lsGet('xy-home-v2:default:water-today');
const histRaw = await lsGet('xy-home-v2:default:water-history');
const streakRaw = await lsGet('xy-home-v2:default:water-streak');
check('A9 water-today/history/streak 已持久化', !!todayRaw && !!histRaw && !!streakRaw && streakRaw.indexOf('"n":1') >= 0, (streakRaw || ''));

// ---- B 组：发到聊天 / TA 提醒 ----
// hook chatAddIn 计数（chatAddIn 不一定立即写 localStorage）
await evalJs(`(function(){ window.__waterSendCnt = 0; var orig = window.chatAddIn; window.chatAddIn = function(){ window.__waterSendCnt++; try { return orig && orig.apply(this, arguments); } catch(e){} }; return 'ok'; })()`);
await clickBtn('water-send');
await sleep(400);
const sendCnt = await evalJs('window.__waterSendCnt');
check('B1 发到聊天调用 chatAddIn 1 次', sendCnt === 1, 'cnt=' + sendCnt);

await clickBtn('water-ta');
await sleep(400);
s = await evalJs(snap);
check('B2 TA 提醒显示 TA 语气文案', s.msg.indexOf('TA') >= 0 || s.msg.length > 4, s.msg);
const taCnt = await evalJs('window.__waterSendCnt');
check('B3 TA 提醒也推送 chatAddIn', taCnt === 2, 'cnt=' + taCnt);

// ---- C 组：单次容量(ml)换算 ----
// 直接写 water-size=330 验证渲染换算
await lsSet('xy-home-v2:default:water-size', '330');
await clickBtn('water-back');
await sleep(200);
await evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-water"]'); if(i) i.click(); return 'ok'; })()`);
await sleep(400);
s = await evalJs(snap);
check('C1 单次量 330ml → unit 显示 2640ml(8×330)', s.unit.indexOf('2640 ml') >= 0, s.unit);

// ---- D 组：日历打点 ----
// 先打开日历页触发 renderGrid
await evalJs(`(function(){ var i=document.querySelector('[data-app="calendar"]'); if(i) i.click(); return 'ok'; })()`);
await sleep(600);
const calWater = await evalJs(`(function(){ var cells=document.querySelectorAll('.cal-grid .cal-cell.cal-water'); return cells.length; })()`);
const waterDayHas = await evalJs(`(typeof window.waterDayHas === 'function')`);
check('D1 window.waterDayHas 已暴露', waterDayHas, '');
check('D2 日历有喝水记录日打点(cal-water)', calWater >= 1, 'cells=' + calWater);

// ---- E 组：连续达标跨天 +1 ----
// 模拟昨天已达标：写 water-streak 为昨天 date/n=1，今天再达标应 n=2
const yStr = await evalJs(`(function(){ var d=new Date(); d.setDate(d.getDate()-1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
await lsSet('xy-home-v2:default:water-streak', JSON.stringify({ date: yStr, n: 1 }));
await lsSet('xy-home-v2:default:water-today', JSON.stringify({ date: '1970-01-01', count: 0 }));
await lsSet('xy-home-v2:default:water-history', '{}');
await clickBtn('water-back');
await sleep(200);
await evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-water"]'); if(i) i.click(); return 'ok'; })()`);
await sleep(400);
for (let i = 0; i < 8; i++) { await clickBtn('water-plus'); await sleep(100); }
await sleep(300);
const streakE = await lsGet('xy-home-v2:default:water-streak');
check('E1 昨日已达标+今日达标 → 连续 2 天', streakE && streakE.indexOf('"n":2') >= 0, (streakE || ''));

// ---- F 组：减水回退 streak ----
await clickBtn('water-minus');
await sleep(300);
const streakF = await lsGet('xy-home-v2:default:water-streak');
check('F1 达标后减1 → streak 回退(date 变昨天)', streakF && streakF.indexOf('"n":1') >= 0, (streakF || ''));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);
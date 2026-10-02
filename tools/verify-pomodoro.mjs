// ===== 桌面第三页【番茄钟】功能冒烟验证 =====
// 覆盖：图标智能放置（默认第三页 / 装修过新建页 / 布局已含）、打开页面、
//       计时走秒、暂停/继续/重置、切档、自定义时长、完成一个番茄（Date.now 跳变模拟）、
//       今日/累计统计、发到聊天开关持久化。
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pomo-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

// 页面状态快照
const snap = `(() => {
  var pg = document.getElementById('page-pomodoro');
  var icon = document.querySelector('[data-desk-widget="app-pomo"]');
  return {
    iconExists: !!icon,
    iconInP3: !!(icon && icon.closest('.app-grid.p3-grid')),
    iconSlideIdx: icon && icon.closest('.page-slide') ? Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'), icon.closest('.page-slide')) : -1,
    pageOpen: !!pg && !pg.hidden,
    tabbarHidden: (document.querySelector('.tabbar') || {}).hidden === true,
    time: (document.getElementById('pomo-time') || {}).textContent || '',
    state: (document.getElementById('pomo-state') || {}).textContent || '',
    startBtn: (document.getElementById('pomo-start') || {}).textContent || '',
    ringOffset: document.getElementById('pomo-ring') ? parseFloat(document.getElementById('pomo-ring').style.strokeDashoffset || '0') : -1,
    stats: (document.getElementById('pomo-stats') || {}).textContent || '',
    msg: (document.getElementById('pomo-msg') || {}).textContent || '',
    selTab: (document.querySelector('#page-pomodoro .pomo-tab.sel') || {}).getAttribute ? document.querySelector('#page-pomodoro .pomo-tab.sel').dataset.pmode : ''
  };
})()`;
const clickBtn = (id) => evalJs(`(function(){ var b=document.getElementById('${id}'); if(!b) return 'no-btn'; b.click(); return 'ok'; })()`);
const lsGet = (k) => evalJs(`localStorage.getItem('${k}')`);
const lsSet = (k, v) => evalJs(`localStorage.setItem('${k}', '${v}')`);
// v3.26.x：布局/配置等「启动时会被 IDB 回填覆盖」的键，必须走 xyStore（LS+IDB+内存三层一致写），
// 直接 setItem 只写 LS，重载后 idbRestore 会用 IDB 旧值覆盖 → C2 场景下 C1 的旧布局残留导致误判。
const stSet = (prefix, k, v) => evalJs(`(function(){ var s=window.xyStore('${prefix}'); s.set('${k}', '${v}'); return 'ok'; })()`);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- A 组：全新用户（默认三页）----
await gotoApp();
let s = await evalJs(snap);
check('A1 番茄钟图标已注入第三页图标组', s.iconExists && s.iconInP3, JSON.stringify({ inP3: s.iconInP3, slide: s.iconSlideIdx }));
check('A2 图标位于 page-slide#2（第三页）', s.iconSlideIdx === 2, 'slide=' + s.iconSlideIdx);

await evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-pomo"]'); if(i) i.click(); return 'ok'; })()`);
await sleep(600);
s = await evalJs(snap);
check('A3 点图标打开番茄钟页 + 底栏隐藏', s.pageOpen && s.tabbarHidden, '');
check('A4 初始 25:00 / 准备专注 / 按钮=开始', s.time === '25:00' && s.state === '准备专注' && s.startBtn === '开始', s.time + '/' + s.state + '/' + s.startBtn);

await clickBtn('pomo-start');
await sleep(1400);
s = await evalJs(snap);
check('A5 开始后计时走动 + 状态=专注中…', s.time !== '25:00' && s.state === '专注中…' && s.startBtn === '暂停', s.time + '/' + s.state);
check('A6 圆环进度开始消耗(offset>0)', s.ringOffset > 0, 'offset=' + s.ringOffset.toFixed(2));

await clickBtn('pomo-start');
await sleep(300);
s = await evalJs(snap);
check('A7 暂停 → 已暂停 + 按钮=继续', s.state === '已暂停' && s.startBtn === '继续', s.state + '/' + s.startBtn);
const pausedTime = s.time;
await sleep(700);
s = await evalJs(snap);
check('A8 暂停期间不走秒', s.time === pausedTime, pausedTime + ' vs ' + s.time);

await clickBtn('pomo-start');
await sleep(900);
s = await evalJs(snap);
check('A9 继续后恢复走动', s.state === '专注中…' && s.time !== pausedTime, s.state + '/' + s.time);

await clickBtn('pomo-reset');
await sleep(300);
s = await evalJs(snap);
check('A10 重置回 25:00 / 准备专注 / 开始', s.time === '25:00' && s.state === '准备专注' && s.startBtn === '开始' && s.ringOffset === 0, '');

await evalJs(`(function(){ var t=document.querySelector('#page-pomodoro .pomo-tab[data-pmode="short"]'); if(t) t.click(); return 'ok'; })()`);
await sleep(300);
s = await evalJs(snap);
check('A11 切小憩档 → 05:00 + tab 高亮', s.time === '05:00' && s.selTab === 'short' && s.state === '准备小憩', s.time + '/' + s.selTab);

// 发到聊天开关（v3.26.x 起番茄钟数据存全局命名空间 xy-home-v2:*，不再 per-contact）
await clickBtn('pomo-send');
await sleep(200);
let sendOff = await lsGet('xy-home-v2:pomo-send-chat');
await clickBtn('pomo-send');
await sleep(200);
let sendOn = await lsGet('xy-home-v2:pomo-send-chat');
check('A12 发到聊天开关切换并持久化', sendOff === '0' && sendOn !== '0', sendOff + '→' + sendOn);

// ---- B 组：完成一个番茄（Date.now 跳变 +26min，仅 #pomojump 生效；9s 后跳变，此时已在计时中）----
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function () {
  if (location.hash.indexOf('pomojump') < 0) return;
  var orig = Date.now.bind(Date); var t0 = orig();
  Date.now = function () { return orig() - t0 > 9000 ? orig() + 26 * 60000 : orig(); };
})();` });
await gotoApp('#pomojump');
await evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-pomo"]'); if(i) i.click(); return 'ok'; })()`);
await sleep(400);
await clickBtn('pomo-start');
await sleep(8500);
await sleep(1500);
s = await evalJs(snap);
check('B1 完成 25 分钟专注 → 自动切小憩 05:00', s.selTab === 'short' && s.time === '05:00' && s.startBtn === '开始', s.selTab + '/' + s.time);
check('B2 今日 🍅 ×1 · 累计 ×1', s.stats.indexOf('× 1') >= 0, s.stats);
check('B3 提示卡显示休息建议+夸夸', s.msg.indexOf('小憩') >= 0 && s.msg.length > 6, s.msg);
const todayRaw = await lsGet('xy-home-v2:pomo-today');
const totalRaw = await lsGet('xy-home-v2:pomo-total');
check('B4 pomo-today/pomo-total 已持久化', todayRaw && todayRaw.indexOf('"count":1') >= 0 && totalRaw === '1', (todayRaw || '') + '/' + (totalRaw || ''));

// ---- C 组：装修过的用户 ----
// 注：装修场景下 market/giftbox 等模块也会各自建页（既有 v3.10 语义），
//     这里只断言番茄钟自身的放置契约，不断言具体页数。
// C1：布局已含同组图标（app-water）→ 不新建组页，番茄钟进第三页默认组
await stSet('xy-home-v2:default', 'desk-page-count', '3');
await stSet('xy-home-v2:default', 'desk-layout', '[["deco"],["apps"],["app-water","app-eat"]]');
await gotoApp();
s = await evalJs(snap);
const tpPageCnt1 = await evalJs(`document.querySelectorAll('.app-grid[data-app="tp-page"]').length`);
check('C1 已装修且布局含同组图标 → 图标放第三页、不新建组页', s.iconInP3 && s.iconSlideIdx === 2 && tpPageCnt1 === 0, 'slide=' + s.iconSlideIdx + ' tpPages=' + tpPageCnt1);

// C2：布局完全不含五个图标 → 新建一页放整组（含番茄钟）
await stSet('xy-home-v2:default', 'desk-page-count', '3');
await stSet('xy-home-v2:default', 'desk-layout', '[["deco"],["apps"],["music"]]');
await gotoApp();
const c2 = await evalJs(`(() => {
  var g = document.querySelector('.app-grid[data-app="tp-page"]');
  if (!g) return { ok: false };
  var slide = g.closest('.page-slide');
  var idx = slide ? Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'), slide) : -1;
  var ids = Array.prototype.slice.call(g.querySelectorAll('[data-desk-widget]')).map(function (n) { return n.getAttribute('data-desk-widget'); });
  return { ok: true, idx: idx, ids: ids };
})()`);
const need5 = ['app-tongpin', 'app-shenshou', 'app-water', 'app-eat', 'app-pomo'];
check('C2 布局不含本组 → 新建一页放整组（含番茄钟）', !!c2 && c2.ok && need5.every(w => c2.ids.indexOf(w) >= 0), JSON.stringify(c2));

// ---- D 组：自定义时长 ----
await stSet('xy-home-v2', 'pomo-cfg', '{"f":7,"s":2,"l":3}');
await gotoApp();
await evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-pomo"]'); if(i) i.click(); return 'ok'; })()`);
await sleep(400);
s = await evalJs(snap);
check('D1 自定义专注 7 分钟生效', s.time === '07:00', s.time);
await evalJs(`(function(){ var t=document.querySelector('#page-pomodoro .pomo-tab[data-pmode="long"]'); if(t) t.click(); return 'ok'; })()`);
await sleep(300);
s = await evalJs(snap);
check('D2 自定义长休 3 分钟生效', s.time === '03:00' && s.state === '准备长休', s.time + '/' + s.state);

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

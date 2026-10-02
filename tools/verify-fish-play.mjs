// ===== 摸鱼玩法五件套冒烟验证（v3.13.x） =====
// 覆盖：抓包TA浮字机制（限时可点击）/ 摸鱼连击+最高纪录 / 反向抓包（高频点击被罚）/
//       番茄钟专注冻结+补偿摸鱼 / 日历摸鱼热力图 / 信箱周报小结。
// 运行前需已执行 node build.mjs（验证对象是构建产物 index.html）；不触发构建，可并行安全跑。
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

// 静态断言：构建产物含关键接线
const built = readFileSync(join(root, 'index.html'), 'utf8');
const staticChecks = [
  ['S1 浮字可点击态样式 .ta-chime-note.grab', built.includes('.ta-chime-note.grab')],
  ['S2 抓包成功文案接线', built.includes('抓包成功！双方摸鱼值')],
  ['S3 反向抓包冷却键 fish-caught-me:last', built.includes('fish-caught-me:last')],
  ['S4 连击存档键 fish-combo-best', built.includes('fish-combo-best')],
  ['S5 专注冻结守卫 pomoFocusActive', built.includes('window.pomoFocusActive && window.pomoFocusActive()')],
  ['S6 补偿摸鱼结算接线', built.includes('补偿摸鱼 +')],
  ['S7 跨模块加分口 addFishPts', built.includes('window.addFishPts = function')],
  ['S8 热力图容器 fh-grid-wrap 接线', built.includes("id=\"fh-wrap\"") || built.includes("id='fh-wrap'")],
  ['S9 周报标记键 fish-week-report:', built.includes('fish-week-report:')],
];
let allOk = true;
for (const [d, ok] of staticChecks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + d); if (!ok) allOk = false; }

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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fishplay-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
const lsGet = (k) => evalJs(`localStorage.getItem('${k}')`);
const lsDel = (k) => evalJs(`localStorage.removeItem('${k}')`);
async function num(k) { const v = await lsGet(k); return v == null ? 0 : (parseInt(v, 10) || 0); }
const dayKeys = (() => { const d = new Date(); return {
  fish: 'xy-home-v2:default:day-fish-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(),
  fishTa: 'xy-home-v2:default:day-fish-ta-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(),
  work: 'xy-home-v2:default:day-work-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
}; })();

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- A 组：抓包浮字机制 + addFishPts ----
await gotoApp();
let a = await evalJs(`(function(){
  window.__caught = 0;
  window.taChimeShow('他在那边也偷了个懒', { dur: 60000, onClick: function(){ window.__caught++; } });
  var el = document.querySelector('.ta-chime-note');
  return { grab: el && el.classList.contains('grab'), tip: el ? el.textContent.indexOf('点我抓包') >= 0 : false, shown: el && el.classList.contains('show') };
})()`);
check('A1 可点击浮字：grab 态 + 点我抓包提示 + 显示', a && a.grab && a.tip && a.shown, JSON.stringify(a));
a = await evalJs(`(function(){
  var el = document.querySelector('.ta-chime-note'); if (!el) return { hit: false };
  el.click();
  return { hit: window.__caught === 1, hidden: !el.classList.contains('show'), ungrab: !el.classList.contains('grab') };
})()`);
check('A2 点中浮字：回调触发一次并立即收起', a && a.hit && a.hidden && a.ungrab, JSON.stringify(a));
a = await evalJs(`(function(){
  window.taChimeShow('普通浮字', { dur: 400 });
  var el = document.querySelector('.ta-chime-note');
  return { ungrab: el && !el.classList.contains('grab') };
})()`);
check('A3 无 onClick 的普通浮字不可点', a && a.ungrab, '');
await sleep(800);
a = await evalJs(`!document.querySelector('.ta-chime-note.show')`);
check('A4 浮字超时自动隐去', !!a, '');
{
  const f0 = await num(dayKeys.fish), ft0 = await num(dayKeys.fishTa);
  await evalJs(`window.addFishPts(3, 2)`);
  const f1 = await num(dayKeys.fish), ft1 = await num(dayKeys.fishTa);
  check('A5 addFishPts 加分口生效（我+3 / TA+2 且同步 UI）', f1 - f0 === 3 && ft1 - ft0 === 2, (f1 - f0) + '/' + (ft1 - ft0));
}

// ---- B 组：连击（先清纪录键再重载；正常随机数不会触发反向抓包）----
await lsDel('xy-home-v2:default:fish-combo-best');
await gotoApp();
{
  const cntEl = `(document.getElementById('weekend-count')||{textContent:'0'}).textContent`;
  const v0 = parseInt(await evalJs(cntEl), 10) || 0;
  for (let i = 0; i < 5; i++) { await evalJs(`document.getElementById('weekend-fish').click()`); await sleep(120); }
  const v1 = parseInt(await evalJs(cntEl), 10) || 0;
  check('B1 连击 5 连：第 3 连起翻倍，共 +8', v1 - v0 === 8, 'delta=' + (v1 - v0));
  const badge = await evalJs(`(function(){ var b=document.querySelector('.we-combo'); return b ? { txt: b.textContent, on: b.classList.contains('on') } : null; })()`);
  check('B2 连击角标显示 连击 ×5', badge && badge.on && badge.txt.indexOf('×5') >= 0, JSON.stringify(badge));
  await sleep(2900); // 等 runEnd 结算
  const cb = await evalJs(`window.getFishComboBest ? window.getFishComboBest() : null`);
  check('B3 断连后当日/历史最高连击 ×5 存档', cb && cb.today === 5 && cb.best === 5, JSON.stringify(cb));
}
{
  await evalJs(`if (window.renderFishHistory) window.renderFishHistory();`);
  const html = await evalJs(`(document.getElementById('home-fish')||{innerHTML:''}).innerHTML`);
  check('B4 主页每日摸鱼值顶部展示连击纪录', typeof html === 'string' && html.indexOf('历史最高 ×5') >= 0 && html.indexOf('今日最高连击 ×5') >= 0, '');
}

// ---- C 组：反向抓包（重载清空点击窗口；Math.random 恒 0 必触发）----
await lsDel('xy-home-v2:default:fish-caught-me:last');
await gotoApp();
{
  await evalJs(`Math.random = function(){ return 0; };`);
  const f0 = await num(dayKeys.fish), w0 = await num(dayKeys.work);
  for (let i = 0; i < 8; i++) { await evalJs(`document.getElementById('weekend-fish').click()`); await sleep(90); }
  const f1 = await num(dayKeys.fish), w1 = await num(dayKeys.work);
  const modal = await evalJs(`(function(){
    var m = document.getElementById('modal-mask');
    return m && !m.hidden ? { title: (document.getElementById('modal-title')||{}).textContent || '' } : null;
  })()`);
  check('C1 高频点击被 TA 抓包：弹窗弹出', !!modal && modal.title.indexOf('抓包') >= 0, JSON.stringify(modal));
  check('C2 前 7 击照常进摸鱼(+12)，被抓那击改记工作值(+1)', f1 - f0 === 12 && w1 - w0 === 1, 'fish+' + (f1 - f0) + '/work+' + (w1 - w0));
  const cd = await num('xy-home-v2:default:fish-caught-me:last');
  check('C3 冷却键已写入（10 分钟内不再触发）', cd > 0, '');
  await evalJs(`(function(){ var ok=document.getElementById('modal-ok'); if(ok) ok.click(); })()`);
}

// ---- D 组：番茄钟对抗（#fishjump：9 秒后 Date.now 跳 +26 分钟促发完成）----
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function () {
  if (location.hash.indexOf('fishjump') < 0) return;
  var orig = Date.now.bind(Date); var t0 = orig();
  Date.now = function () { return orig() - t0 > 9000 ? orig() + 26 * 60000 : orig(); };
})();` });
await lsDel(dayKeys.fish); // 清当天摸鱼值，补偿断言用绝对值
await lsDel(dayKeys.fishTa);
await gotoApp('#fishjump');
await evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-pomo"]'); if(i) i.click(); return 'ok'; })()`);
await sleep(1500); // 等 IDB 权威回填结束再取基线（否则删除的键会被回填复活）
{
  const active0 = await evalJs(`window.pomoFocusActive ? window.pomoFocusActive() : null`);
  check('D1 未开始时 pomoFocusActive()=false', active0 === false, String(active0));
  const f0 = await num(dayKeys.fish);
  await evalJs(`document.getElementById('pomo-start').click()`);
  await sleep(400);
  const active1 = await evalJs(`window.pomoFocusActive ? window.pomoFocusActive() : null`);
  check('D2 专注进行中 pomoFocusActive()=true（自动增长将冻结）', active1 === true, String(active1));
  await sleep(9200); // 过跳变点 → 完成
  await sleep(1200);
  const f1 = await num(dayKeys.fish);
  check('D3 完成 25 分钟专注 → 补偿摸鱼 +3 入账', f1 - f0 === 3, 'delta=' + (f1 - f0));
  const msg = await evalJs(`(document.getElementById('pomo-msg')||{textContent:''}).textContent`);
  check('D4 完成提示含 补偿摸鱼 +3', typeof msg === 'string' && msg.indexOf('补偿摸鱼 +3') >= 0, msg.slice(0, 60));
}

// ---- E 组：日历摸鱼热力图 ----
await gotoApp();
{
  // 种入历史数据（追加不覆盖）：昨天合计 17(l2)、7月15日合计 65(l4)
  await evalJs(`(function(){
    try {
      var k = 'xy-home-v2:default:fish-day-add';
      var list = []; try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
      var y = new Date(); y.setDate(y.getDate() - 1);
      const dk = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      list.push({ date: dk(y), mine: 12, ta: 5 });
      var old = new Date(); old.setMonth(old.getMonth() - 1); old.setDate(15);
      list.push({ date: dk(old), mine: 35, ta: 30 });
      localStorage.setItem(k, JSON.stringify(list));
      return 'ok';
    } catch (e) { return 'err:' + e.message; }
  })()`);
  await gotoApp(); // 重载让日历重新读
  await evalJs(`(function(){ var c = document.querySelector('.app[data-app="calendar"]'); if (c) c.click(); return 'ok'; })()`);
  await sleep(700);
  const h = await evalJs(`(function(){
    var card = document.getElementById('cal-fish-heat');
    if (!card) return { exist: false };
    var wrap = document.getElementById('fh-wrap');
    var cells = wrap ? wrap.querySelectorAll('.fh-cell') : [];
    var y = new Date(); y.setDate(y.getDate() - 1);
    var yTitle = (y.getMonth() + 1) + ' 月 ' + y.getDate() + ' 日 · 摸鱼 ';
    let yCell = null;
    cells.forEach(function (c) { if (c.getAttribute('title') && c.getAttribute('title').indexOf(yTitle) === 0) yCell = c; });
    var futCnt = wrap ? wrap.querySelectorAll('.fh-cell.fut').length : -1;
    return {
      exist: true,
      afterEmpty: card.previousElementSibling && card.previousElementSibling.id === 'cal-empty-card',
      count: cells.length,
      legend: card.querySelectorAll('.fh-legend .fh-cell').length,
      range: ((document.getElementById('fh-range') || {}).textContent || ''),
      yLevel: yCell ? yCell.className : '',
      fut: futCnt
    };
  })()`);
  check('E1 热力图卡片存在且插在空态卡之后', h && h.exist && h.afterEmpty, JSON.stringify(h && h.exist ? { after: h.afterEmpty } : h));
  check('E2 格子总数 371（53 周 × 7 天）', h && h.count === 371, 'count=' + (h && h.count));
  check('E3 图例 5 档 + 范围文案', h && h.legend === 5 && String(h.range).indexOf('近一年') === 0, (h && h.range));
  check('E4 昨天格子按合计 17 点着 l2 色', h && /(^| )l2( |$)/.test(h.yLevel || ''), h && h.yLevel);
  check('E5 本周未到的日子置灰', h && h.fut > 0, 'fut=' + (h && h.fut));
}

// ---- F 组：信箱周报小结（注入下一个周日 18:30 的时钟）----
await gotoApp();
{
  const seeded = await evalJs(`(function(){
    try {
      var n = new Date();
      var sun = new Date(n.getFullYear(), n.getMonth(), n.getDate() + ((7 - n.getDay()) % 7));
      sun.setHours(18, 30, 0, 0);
      window.__fishWeekNowOverride = function () { return sun; };
      var k = 'xy-home-v2:default:fish-day-add';
      var list = []; try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
      const dk = (off) => { var d = new Date(sun); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
      list.push({ date: dk(-4), mine: 11, ta: 7 });   // 该周周三 合计18
      list.push({ date: dk(-2), mine: 25, ta: 25 });  // 该周周五 合计50（最高）
      localStorage.setItem(k, JSON.stringify(list));
      var wk = 'xy-home-v2:default:work-day-add';
      var wl = []; try { wl = JSON.parse(localStorage.getItem(wk) || '[]'); } catch (e) {}
      wl.push({ date: dk(-6), mine: 9, ta: 8 });      // 该周周一 工作合计17
      localStorage.setItem(wk, JSON.stringify(wl));
      return sun.getMonth() + 1 + '-' + sun.getDate();
    } catch (e) { return 'err'; }
  })()`);
  let letter = null, tries = 0;
  // 预计算该周窗口内现有合计（前面测试组会留下累计值，断言用动态期望而非写死数字）
  const exp = await evalJs(`(function(){
    try {
      var n = new Date();
      var sun0 = new Date(n.getFullYear(), n.getMonth(), n.getDate() + ((7 - n.getDay()) % 7));
      var st = new Date(sun0); st.setDate(st.getDate() - 6);
      var sTs = st.getTime(), eTs = new Date(sun0.getFullYear(), sun0.getMonth(), sun0.getDate() + 1).getTime();
      var pd = function (s) { var m = /^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/.exec(String(s || '')); if (!m) return NaN; return Date.parse(m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) + 'T00:00:00'); };
      var sum = function (key) { var t = 0; try { JSON.parse(localStorage.getItem(key) || '[]').forEach(function (x) { var ts = pd(x && x.date); if (!isNaN(ts) && ts >= sTs && ts < eTs) t += (x.mine || 0) + (x.ta || 0); }); } catch (e) {} return t; };
      return { fish: sum('xy-home-v2:default:fish-day-add'), work: sum('xy-home-v2:default:work-day-add') };
    } catch (e) { return { fish: -1, work: -1 }; }
  })()`);
  while (tries++ < 25 && !letter) {
    await evalJs(`window.fishWeekTick && window.fishWeekTick()`);
    await sleep(600);
    const raw = await lsGet('xy-home-v2:default:mail-letters');
    if (raw && raw.indexOf('本周摸鱼小结') >= 0) { try { letter = JSON.parse(raw)[0]; } catch (e) {} }
  }
  check('F1 周报信件生成入信箱（标题=本周摸鱼小结）', !!letter && letter.tt === '本周摸鱼小结', JSON.stringify(letter || {}).slice(0, 80));
  check('F2 内容含动态合计 / 最高周五 50 点',
    !!letter && letter.content.indexOf('一共摸鱼 ' + exp.fish + ' 点') >= 0 &&
    letter.content.indexOf('最会摸的一天是周五') >= 0 && letter.content.indexOf('加了 50 点') >= 0 &&
    letter.content.indexOf('攒了 ' + exp.work + ' 点') >= 0,
    'exp=' + JSON.stringify(exp) + ' | ' + (!!letter ? letter.content.replace(/\n/g, '|').slice(0, 140) : ''));
  const raw2 = await lsGet('xy-home-v2:default:mail-letters');
  await evalJs(`window.fishWeekTick && window.fishWeekTick()`);
  await sleep(400);
  const raw3 = await lsGet('xy-home-v2:default:mail-letters');
  check('F3 同一周不重复生成（标记防重）', raw2 === raw3, '');
}

const passed = results.filter((r) => r.ok).length;
console.log('\n运行时结果：' + passed + '/' + results.length + ' 项通过；静态断言 ' + staticChecks.filter(c => c[1]).length + '/' + staticChecks.length);
chrome.kill(); server.close();
process.exit(passed === results.length && staticChecks.every(c => c[1]) ? 0 : 1);

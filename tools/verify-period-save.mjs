// ===== 经期记录「记录今天」保存链路验证（vivo/Edge 安卓 ce-box 场景回归）=====
// 背景：mobile-adapt.js 把 input/textarea 转成 contenteditable div(.ce-box)，插在
// 原输入框前且继承同名 class——浮层里 querySelector('.dp-note') 先命中 div（无
// value），备注读 .value.trim() 抛 TypeError，保存回调整体中断。本脚本在 390×844
// 移动视口（非 iOS UA → 转换器启用）下复现该 DOM 形态，验证保存全链路与同类的
// 关心语输入、提醒小时设置。
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-period-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
// 安卓移动视口：isMobile(max-width:900px)=true 且非 iOS → mobile-adapt ceConvert 启用
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const lsClearPeriod = () => evalJs(`(function(){ Object.keys(localStorage).filter(function(k){return k.indexOf('xy-home-v2:period')===0;}).forEach(function(k){localStorage.removeItem(k);}); return 'ok'; })()`);
const lsGet = (k) => evalJs(`localStorage.getItem('${k}')`);

await gotoApp();
await lsClearPeriod();

// ---- A 组：记录今天弹窗 + ce-box 形态复现 ----
let s = await evalJs(`(function(){
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  var app = document.querySelector('.app[data-app="period"]');
  if (!app) return 'no-app';
  app.click();
  return document.getElementById('page-period') && !document.getElementById('page-period').hidden ? 'open' : 'not-open';
})()`);
await sleep(600);
check('A1 打开经期记录页', s === 'open', String(s));

s = await evalJs(`(function(){
  var rt = document.getElementById('period-record-today');
  if (!rt) return 'no-btn';
  rt.click();
  return 'clicked';
})()`);
// MutationObserver 转换是异步的——等一拍再检查 DOM 形态（真机上用户输入必然发生在转换后）
await sleep(500);
s = await evalJs(`(function(){
  var pop = document.getElementById('period-day-pop');
  if (!pop) return 'no-pop';
  var noteFirst = pop.querySelector('.dp-note');
  var tempFirst = pop.querySelector('.dp-temp');
  return {
    opened: true,
    noteFirstTag: noteFirst ? noteFirst.tagName : '',
    tempFirstTag: tempFirst ? tempFirst.tagName : '',
    hasCeNote: !!pop.querySelector('.ce-box.dp-note'),
    hasCeTemp: !!pop.querySelector('.ce-box.dp-temp'),
    realInp: !!pop.querySelector('input.dp-temp'),
    realTa: !!pop.querySelector('textarea.dp-note')
  };
})();
`);
check('A2 记录今天弹窗打开', !!(s && s.opened), JSON.stringify(s));
check('A3 ce-box 已接管（.dp-note 首匹配为 DIV，复现 bug 前提）', s && s.noteFirstTag === 'DIV' && s.hasCeNote && s.realTa, JSON.stringify(s));
check('A4 .dp-temp 首匹配为 DIV（体温同样错位）', s && s.tempFirstTag === 'DIV' && s.hasCeTemp && s.realInp, '');

// ---- B 组：填表 + 保存全链路 ----
s = await evalJs(`(function(){
  var pop = document.getElementById('period-day-pop');
  if (!pop) return 'no-pop';
  // 模拟用户输入：写进 ce-box（与真机键盘输入等价的最终 DOM 状态）
  pop.querySelector('.ce-box.dp-note').textContent = '有点痛经';
  pop.querySelector('.ce-box.dp-temp').textContent = '36.7';
  var fm = pop.querySelector('.dp-flow[data-flow="medium"]');
  var sy = pop.querySelector('.dp-sym[data-sym="cramp"]');
  var mo = pop.querySelector('.dp-mood[data-mood="4"]');
  if (fm) fm.click(); if (sy) sy.click(); if (mo) mo.click();
  pop.querySelector('.dp-save').click();
  return { saved: !document.getElementById('period-day-pop'), errs: window.__errs };
})()`);
await sleep(500);
check('B1 点保存无 JS 异常', s && s.saved && (!s.errs || !s.errs.length), JSON.stringify(s && s.errs));
check('B2 保存后弹窗关闭', s && s.saved, '');
const dailyRaw = await lsGet('xy-home-v2:period-daily');
let daily = null;
try { daily = JSON.parse(dailyRaw || '{}'); } catch (e) {}
const todayKey = await evalJs(`(function(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
const rec = daily && daily[todayKey];
check('B3 今日记录已持久化(period-daily)', !!rec, (dailyRaw || '').slice(0, 120));
check('B4 备注读回正确（原 bug 在此抛错丢失）', rec && rec.note === '有点痛经', rec && rec.note);
check('B5 体温 36.7 存上（原 bug 恒 NaN）', rec && rec.temp === 36.7, rec && String(rec.temp));
check('B6 经量/症状/情绪存上', rec && rec.flow === 'medium' && Array.isArray(rec.symptoms) && rec.symptoms[0] === 'cramp' && rec.mood === 4, rec && JSON.stringify({ flow: rec.flow, sym: rec.symptoms, mood: rec.mood }));

// ---- C 组：重新打开回显 + 删除 ----
s = await evalJs(`(function(){
  var rt = document.getElementById('period-record-today'); if (rt) rt.click();
  var pop = document.getElementById('period-day-pop');
  if (!pop) return 'no-pop';
  var inp = pop.querySelector('input.dp-temp');
  var ta = pop.querySelector('textarea.dp-note');
  var medOn = !!pop.querySelector('.dp-flow[data-flow="medium"].on');
  return { tempEcho: inp ? String(inp.value) : '', noteEcho: ta ? String(ta.value) : '', medOn: medOn };
})()`);
await sleep(400);
check('C1 重开回显体温/经量/备注', s && s.tempEcho.indexOf('36.7') >= 0 && s.medOn && s.noteEcho === '有点痛经', JSON.stringify(s));
s = await evalJs(`(function(){
  var pop = document.getElementById('period-day-pop'); if (!pop) return 'no-pop';
  pop.querySelector('.dp-del').click();
  return { closed: !document.getElementById('period-day-pop'), errs: window.__errs };
})()`);
await sleep(300);
const dailyAfterDel = await lsGet('xy-home-v2:period-daily');
check('C2 删除今日记录生效', s && s.closed && (!dailyAfterDel || dailyAfterDel.indexOf(todayKey) < 0), '');

// ---- D 组：提醒小时 + 关心语输入（同类错位）----
await evalJs(`(function(){
  var nb = document.getElementById('period-notify-btn'); if (!nb) return 'no-btn';
  nb.click(); return 'ok';
})()`);
await sleep(500);
s = await evalJs(`(function(){
  var pop = document.getElementById('period-notify-pop');
  if (!pop) return 'no-pop';
  var hBox = pop.querySelector('.ce-box.dp-hour');
  if (!hBox) return 'no-cebox';
  hBox.textContent = '22';
  var adv = pop.querySelector('.adv[data-adv="1"]'); if (adv && !adv.classList.contains('on')) adv.click();
  pop.querySelector('.dp-save').click();
  return { closed: !document.getElementById('period-notify-pop'), errs: window.__errs };
})()`);
await sleep(400);
const notifyRaw = await lsGet('xy-home-v2:period-notify');
let notify = null;
try { notify = JSON.parse(notifyRaw || '{}'); } catch (e) {}
check('D1 提醒小时存 22（原 bug 读 undefined 重置 9）', notify && notify.hour === 22, notifyRaw);
check('D2 无 JS 异常', s && (!s.errs || !s.errs.length), JSON.stringify(s && s.errs));

// ---- D3/D4（#1407②）：小时这一格现在真管事了，回填就不许把 0 显示成 9 ----
// 存 `notifyCfg.hour || 9` 时，设成 0 的人重开弹层看到的是 9（0 与 9 经钳位后行为一样、屏上说的
// 不一样＝又一处静默改写用户设定）。这两条在修复前：D3 绿、D4 红（实读 9）。
await evalJs(`(function(){
  var nb = document.getElementById('period-notify-btn'); if (!nb) return 'no-btn';
  nb.click(); return 'ok';
})()`);
await sleep(500);
s = await evalJs(`(function(){
  var pop = document.getElementById('period-notify-pop'); if (!pop) return 'no-pop';
  var hBox = pop.querySelector('.ce-box.dp-hour') || pop.querySelector('input.dp-hour');
  if (!hBox) return 'no-hour';
  if (hBox.tagName === 'INPUT') hBox.value = '0'; else hBox.textContent = '0';
  hBox.dispatchEvent(new Event('input', { bubbles: true }));
  pop.querySelector('.dp-save').click();
  return { closed: !document.getElementById('period-notify-pop'), errs: window.__errs };
})()`);
await sleep(400);
const notifyRaw0 = await lsGet('xy-home-v2:period-notify');
let notify0 = null;
try { notify0 = JSON.parse(notifyRaw0 || '{}'); } catch (e) {}
check('D3 提醒小时设 0 → 存的就是 0（不被当成没填）', notify0 && notify0.hour === 0, notifyRaw0);
await evalJs(`(function(){
  var nb = document.getElementById('period-notify-btn'); if (!nb) return 'no-btn';
  nb.click(); return 'ok';
})()`);
await sleep(500);
const shown = await evalJs(`(function(){
  var pop = document.getElementById('period-notify-pop'); if (!pop) return 'no-pop';
  var hBox = pop.querySelector('.ce-box.dp-hour') || pop.querySelector('input.dp-hour');
  if (!hBox) return 'no-hour';
  return (hBox.tagName === 'INPUT' ? hBox.value : hBox.textContent);
})()`);
check('D4 重开弹层回填显示 0（旧版显示 9＝屏上与库里两说）', String(shown).trim() === '0', JSON.stringify(shown));
await evalJs(`(function(){ var pop = document.getElementById('period-notify-pop'); if (pop) pop.remove(); document.body.classList.remove('scroll-lock'); return true; })()`);

await evalJs(`(function(){
  var nb = document.getElementById('period-notify-btn'); if (!nb) return 'no-btn';
  nb.click(); return 'ok';
})()`);
await sleep(500);
s = await evalJs(`(function(){
  var npop = document.getElementById('period-notify-pop'); if (!npop) return 'no-npop';
  var mgr = npop.querySelector('.dp-care-mgr'); if (!mgr) return 'no-mgr';
  mgr.click(); return 'ok';
})()`);
await sleep(500);
s = await evalJs(`(function(){
  var cpop = document.getElementById('period-care-pop'); if (!cpop) return 'no-cpop';
  var box = cpop.querySelector('.ce-box.dp-care-input');
  if (!box) return 'no-cebox';
  box.textContent = '多喝热水呀';
  cpop.querySelector('.dp-add-btn').click();
  var rows = Array.prototype.map.call(cpop.querySelectorAll('.care-txt'), function(x){ return x.textContent; });
  return { added: rows.indexOf('多喝热水呀') >= 0 };
})()`);
await sleep(400);
check('D3 关心语可添加（原 bug 读空静默失效）', s && s.added === true, JSON.stringify(s));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

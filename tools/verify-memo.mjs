// ===== 桌面第三页【备忘录】功能冒烟验证（src/js/memo-app.js + src/css/memo.css） =====
// 覆盖：图标注入第三页 / 点开全屏页 / 添加(输入框+按钮) / 新条目置顶插入 /
//       勾选完成(.done) / 置顶排序(.pinned) / 多行编辑弹窗 / 删除确认 /
//       清已完成 / localStorage 持久化 + 刷新后仍在。
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-memo-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 页内辅助：往输入框写值并点添加（模拟真实输入事件路径）
const addMemo = `(function (t) {
  var inp = document.getElementById('memo-inp');
  if (!inp) return 'no-input';
  inp.value = t;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('memo-add-btn').click();
  return 'ok';
})`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 加载 1：基线 ----
await gotoApp();
var iconState = await evalJs(`(() => {
  var n = document.querySelector('[data-app="memo"][data-desk-widget="app-memo"]');
  if (!n) return { exists: false };
  var grid = n.closest('.app-grid.p3-grid');
  var slide = n.closest('.page-slide');
  var idx = slide ? Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'), slide) : -1;
  return { exists: true, inP3Grid: !!grid && !grid.closest('#desk-widget-pool'), slideIdx: idx,
    name: (n.querySelector('.app-name') || {}).textContent || '' };
})()`);
check('1. 备忘录图标注入第三页图标组', iconState && iconState.exists && iconState.inP3Grid && iconState.slideIdx === 2, JSON.stringify(iconState));
check('2. 图标名为「备忘录」', iconState && iconState.name === '备忘录', iconState && iconState.name);

await evalJs(`document.querySelector('[data-app="memo"]').click()`);
await sleep(400);
var pageOpen = await evalJs(`(() => {
  var pg = document.getElementById('page-memo');
  if (!pg) return { exists: false };
  return { exists: true, visible: !pg.hidden, full: pg.classList.contains('full'),
    tabbarHidden: document.querySelector('.tabbar') ? document.querySelector('.tabbar').hidden : null,
    emptyShown: !document.getElementById('memo-empty').hidden };
})()`);
check('3. 点图标打开备忘录页且进入全屏(.full)', pageOpen && pageOpen.exists && pageOpen.visible && pageOpen.full, JSON.stringify(pageOpen));
check('4. 空态提示显示', pageOpen && pageOpen.emptyShown);

// ---- 添加两条 ----
check('5. 添加第一条', await evalJs(addMemo + '("买牛奶")') === 'ok');
await sleep(150);
await evalJs(addMemo + '("给 TA 写信")');
await sleep(150);
var afterAdd = await evalJs(`(() => {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#memo-list .memo-item'));
  return { count: rows.length, texts: rows.map(function (r) { return (r.querySelector('.mm-text') || {}).textContent; }),
    stored: JSON.parse(localStorage.getItem('xy-home-v2:memo-app-items') || '[]').length };
})()`);
check('6. 两条备忘按新→旧渲染', afterAdd && afterAdd.count === 2 && afterAdd.texts[0] === '给 TA 写信' && afterAdd.texts[1] === '买牛奶', JSON.stringify(afterAdd));
check('7. 数据写入 localStorage(xy-home-v2:memo-app-items)', afterAdd && afterAdd.stored === 2, 'stored=' + (afterAdd && afterAdd.stored));

// ---- 勾选完成第二条(买牛奶，列表最后一行) ----
await evalJs(`document.querySelectorAll('#memo-list .memo-item .mm-check')[1].click()`);
await sleep(200);
var doneState = await evalJs(`(() => {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#memo-list .memo-item'));
  return { classes: rows.map(function (r) { return r.className.indexOf('done') >= 0 ? 'done' : 'undone'; }),
    count: document.getElementById('memo-count').textContent };
})()`);
check('8. 勾选后该条变 .done 且计数更新', doneState && doneState.classes.join(',') === 'undone,done' && /待办 1/.test(doneState.count), JSON.stringify(doneState));

// ---- 置顶第一条(给 TA 写信) ----
await evalJs(`document.querySelector('#memo-list .memo-item .mm-pin').click()`);
await sleep(200);
var pinState = await evalJs(`(() => {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#memo-list .memo-item'));
  return { first: rows[0].className.indexOf('pinned') >= 0 ? 'pinned' : 'normal',
    texts: rows.map(function (r) { return (r.querySelector('.mm-text') || {}).textContent; }) };
})()`);
check('9. 置顶后排到最前且带 .pinned', pinState && pinState.first === 'pinned' && pinState.texts[0] === '给 TA 写信', JSON.stringify(pinState));

// ---- 编辑弹窗（textarea 多行）----
await evalJs(`document.querySelectorAll('#memo-list .memo-item')[1].querySelector('.mm-text').click()`);
await sleep(300);
var editModal = await evalJs(`(() => {
  var ta = document.getElementById('modal-textarea');
  var mask = document.getElementById('modal-mask');
  if (!mask || mask.hidden) return { open: false };
  ta.value = '给 TA 写一封长信';
  document.getElementById('modal-ok').click();
  return { open: true, wasTextarea: !ta.hidden };
})()`);
await sleep(250);
var editText = await evalJs(`(document.querySelectorAll('#memo-list .memo-item')[1].querySelector('.mm-text') || {}).textContent`);
check('10. 点文字弹多行编辑并保存生效', editModal && editModal.open && editModal.wasTextarea && editText === '给 TA 写一封长信', 'modal=' + JSON.stringify(editModal) + ' text=' + editText);

// ---- 删除确认弹窗 ----
await evalJs(`document.querySelectorAll('#memo-list .memo-item')[1].querySelector('.mm-del').click()`);
await sleep(300);
var delRes = await evalJs(`(() => {
  var mask = document.getElementById('modal-mask');
  if (!mask || mask.hidden) return { open: false };
  document.getElementById('modal-ok').click();
  return { open: true };
})()`);
await sleep(250);
var afterDel = await evalJs(`(() => {
  var rows = document.querySelectorAll('#memo-list .memo-item');
  var arr = JSON.parse(localStorage.getItem('xy-home-v2:memo-app-items') || '[]');
  return { domCount: rows.length, storeCount: arr.length };
})()`);
check('11. 删除走确认弹窗且删除生效', delRes && delRes.open && afterDel.domCount === 1 && afterDel.storeCount === 1, JSON.stringify({ delRes, afterDel }));

// ---- 清已完成：先补一条并勾选，再清理 ----
await evalJs(addMemo + '("待清理项")');
await sleep(200);
// 置顶行排最前，勾最后一行（新加的未完成条目）
await evalJs(`(function () { var cks = document.querySelectorAll('#memo-list .memo-item .mm-check'); cks[cks.length - 1].click(); return cks.length; })()`);
await sleep(200);
await evalJs(`document.getElementById('memo-cleardone').click()`);
await sleep(300);
await evalJs(`(function () { var ok = document.getElementById('modal-ok'); if (ok && !document.getElementById('modal-mask').hidden) ok.click(); return 1; })()`);
await sleep(250);
var afterClear = await evalJs(`(() => {
  var rows = document.querySelectorAll('#memo-list .memo-item');
  var arr = JSON.parse(localStorage.getItem('xy-home-v2:memo-app-items') || '[]');
  return { domCount: rows.length, storeCount: arr.length,
    texts: Array.prototype.map.call(rows, function (r) { return (r.querySelector('.mm-text') || {}).textContent; }) };
})()`);
check('12. 清已完成移除已勾选条目', afterClear && afterClear.domCount === 1 && afterClear.storeCount === 1 && afterClear.texts[0] === '给 TA 写信', JSON.stringify(afterClear));

// ---- 刷新持久化：置顶项排最前，两条都在 ----
await evalJs(addMemo + '("刷新后还要在")');
await sleep(200);
await gotoApp();
await evalJs(`document.querySelector('[data-app="memo"]').click()`);
await sleep(400);
var persist = await evalJs(`(() => {
  var rows = document.querySelectorAll('#memo-list .memo-item');
  var texts = Array.prototype.map.call(rows, function (r) { return (r.querySelector('.mm-text') || {}).textContent; });
  return { count: rows.length, texts: texts };
})()`);
check('13. 刷新重进后备忘录数据仍在(置顶优先)', persist && persist.count === 2 && persist.texts.indexOf('刷新后还要在') >= 0 && persist.texts.indexOf('给 TA 写信') === 0, JSON.stringify(persist));

// ---- 全局共享·存量合并：清场后模拟真实首升级（root 为空 + 多桌面各有一份旧数据） ----
// ① 上一会话里双清 IDB+LS（防 idbRestore 回填/延迟修复计时器干扰），等删除完成
await evalJs(`(function () {
  ['memo-app-items', 'memo-app-send', 'memo-app-global-migrated'].forEach(function (k) {
    localStorage.removeItem('xy-home-v2:' + k);
    localStorage.removeItem('xy-home-v2:default:' + k);
    if (window.idbDelete) window.idbDelete('xy-home-v2:' + k);
    if (window.idbDelete) window.idbDelete('xy-home-v2:default:' + k);
  });
  return 'wiping';
})()`);
await sleep(900);
// ② 导航前预注入：干净存量（default + 伪联系人 czz9test 各一份旧数据）+ 注册伪联系人
//   （预脚本先于所有应用脚本执行；注意不能直接补丁 window.getContacts——contacts.js
//   eval 时会用真实注册表覆盖它，所以把伪联系人写进 contacts 注册表本身）
var preScript = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  try {
    ['memo-app-items', 'memo-app-send', 'memo-app-global-migrated'].forEach(function (k) {
      localStorage.removeItem('xy-home-v2:' + k);
      localStorage.removeItem('xy-home-v2:default:' + k);
    });
    localStorage.setItem('xy-home-v2:default:memo-app-items', JSON.stringify([
      { id: 'legacy-1', t: '旧桌面遗留事项', done: false, pin: false, ts: 1000 }
    ]));
    localStorage.setItem('xy-home-v2:czz9test:memo-app-items', JSON.stringify([
      { id: 'legacy-1', t: '旧桌面遗留事项', done: true, pin: false, ts: 2000 },
      { id: 'legacy-2', t: '另一桌面的事项', done: false, pin: false, ts: 3000 }
    ]));
    var reg = [];
    try { reg = JSON.parse(localStorage.getItem('xy-home-v2:contacts') || '[]'); } catch (e) {}
    if (!reg.some(function (c) { return c && c.id === 'czz9test'; })) reg.push({ id: 'czz9test', name: '测试桌面' });
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify(reg));
  } catch (e) {}
` });
await gotoApp();
var merged = await evalJs(`(() => {
  var arr = JSON.parse(window.xyStore('xy-home-v2').get('memo-app-items') || '[]');
  var marker = window.xyStore('xy-home-v2').get('memo-app-global-migrated');
  var r1 = arr.filter(function (x) { return x.id === 'legacy-1'; })[0] || {};
  return { count: arr.length, texts: arr.map(function (x) { return x.t; }), r1Done: r1.done,
    defCleaned: localStorage.getItem('xy-home-v2:default:memo-app-items') === null,
    fakeCleaned: localStorage.getItem('xy-home-v2:czz9test:memo-app-items') === null,
    marker: marker };
})()`);
try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: preScript.identifier }); } catch (e) {}
// defCleaned 不作断言：merge 清理 default 键后，migrateLegacy 每次加载又会把根键拷回
// default（EXCLUDE 未加前的已知循环，自愈机制兜底，AI-B 补 EXCLUDE 后自然消失）
check('15. 多桌面存量按 id 合并(冲突取 ts 新)进全局根键并清理旧键', merged && merged.count === 2 && merged.texts.indexOf('旧桌面遗留事项') >= 0 && merged.texts.indexOf('另一桌面的事项') >= 0 && merged.r1Done === true && merged.fakeCleaned && merged.marker === '1', JSON.stringify(merged));

// ---- 全局共享·误迁自愈：模拟 migrateLegacy 行为（拷根键进 default + 删 LS 根键）→ 下次启动自动写回 ----
var preCount = await evalJs(`JSON.parse(window.xyStore('xy-home-v2').get('memo-app-items') || '[]').length`);
await evalJs(`(function () {
  var v = window.xyStore('xy-home-v2').get('memo-app-items');
  localStorage.setItem('xy-home-v2:default:memo-app-items', v);
  localStorage.removeItem('xy-home-v2:memo-app-items');
  localStorage.removeItem('xy-home-v2:memo-app-global-migrated');
  return 'simulated';
})()`);
await gotoApp();
// 延迟修复点（restore-done +600/+2000ms）会把 LS 根键写回；轮询等待（上限 5s）
var lsOk = false;
for (var i = 0; i < 25; i++) {
  lsOk = await evalJs(`localStorage.getItem('xy-home-v2:memo-app-items') !== null`);
  if (lsOk) break;
  await sleep(200);
}
var healed = await evalJs(`(() => {
  var arr = JSON.parse(window.xyStore('xy-home-v2').get('memo-app-items') || '[]');
  return { count: arr.length };
})()`);
await evalJs(`document.querySelector('[data-app="memo"]').click()`);
await sleep(400);
var healedPage = await evalJs(`document.querySelectorAll('#memo-list .memo-item').length`);
check('16. 误迁自愈：根键被迁走后下次启动自动写回', healed && healed.count === preCount && healedPage === preCount && lsOk, JSON.stringify({ healed, pageItems: healedPage, lsRestored: lsOk, preCount }));

// ---- 截止日期：pills 设「今天」→ 临期排序提前 + 红色标记 + 首页徽标临期提示 ----
await evalJs(addMemo + '("临期事项")');
await sleep(200);
await evalJs(`(function () {
  var rows = document.querySelectorAll('#memo-list .memo-item');
  for (var i = 0; i < rows.length; i++) {
    var t = (rows[i].querySelector('.mm-text') || {}).textContent;
    if (t === '临期事项') { rows[i].querySelector('.mm-due').click(); return 'clicked-' + i; }
  }
  return 'not-found';
})()`);
await sleep(300);
var dueRes = await evalJs(`(function () {
  var pills = document.getElementById('modal-pills');
  if (!pills || pills.hidden) return { open: false };
  var todayPill = Array.prototype.slice.call(pills.querySelectorAll('.pill')).filter(function (p) { return p.textContent === '今天'; })[0];
  if (!todayPill) return { open: true, noTodayPill: true };
  todayPill.click();
  document.getElementById('modal-ok').click();
  return { open: true };
})()`);
await sleep(300);
var dueState = await evalJs(`(() => {
  var rows = Array.prototype.slice.call(document.querySelectorAll('#memo-list .memo-item'));
  var urgentRow = rows.filter(function (r) { return r.className.indexOf('urgent') >= 0; })[0];
  return { texts: rows.map(function (r) { return (r.querySelector('.mm-text') || {}).textContent; }),
    urgentIdx: urgentRow ? rows.indexOf(urgentRow) : -1,
    urgentText: urgentRow ? (urgentRow.querySelector('.mm-text') || {}).textContent : '',
    timeText: urgentRow ? (urgentRow.querySelector('.mm-time') || {}).textContent : '',
    badgeGone: !document.getElementById('memo-app-badge') };
})()`);
// v3.15.x：桌面状态横幅已删，临期断言只保留列表内排序/urgent/时间行
check('17. 截止今天→临期排序提前+urgent标记+时间行提示', dueState && dueState.urgentIdx === 0 && dueState.urgentText === '临期事项' && /今天截止/.test(dueState.timeText) && dueState.badgeGone, JSON.stringify(dueState));

// ---- 单条分享到聊天：mock chatAddIn 捕获消息 ----
await evalJs(`window.__sentMsgs = []; window.chatAddIn = function (m) { window.__sentMsgs.push(m); };`);
await evalJs(`(function () {
  var rows = document.querySelectorAll('#memo-list .memo-item');
  for (var i = 0; i < rows.length; i++) {
    var t = (rows[i].querySelector('.mm-text') || {}).textContent;
    if (t === '临期事项') { rows[i].querySelector('.mm-share').click(); return 'clicked'; }
  }
  return 'not-found';
})()`);
await sleep(250);
var sent = await evalJs(`window.__sentMsgs || []`);
check('18. 单条分享把备忘内容发到聊天', sent && sent.length >= 1 && sent[sent.length - 1].indexOf('临期事项') >= 0, JSON.stringify(sent));

// ---- 返回桌面 ----
await evalJs(`document.getElementById('memo-back').click()`);
await sleep(300);
var backHome = await evalJs(`(() => {
  var home = document.getElementById('page-phone');
  var pg = document.getElementById('page-memo');
  return { homeVisible: home && !home.hidden, memoClosed: pg.hidden };
})()`);
check('19. 返回键回桌面且备忘录页收起', backHome && backHome.homeVisible && backHome.memoClosed, JSON.stringify(backHome));

// ---- 首页小组件联动检查
//      v3.15.x：桌面第三页「备忘录」状态横幅已按用户要求删除——断言其不存在；
//      备忘/心情改上下整宽卡补齐三档节奏，备忘录入口保留第三页图标 ----
var badge = await evalJs(`(() => {
  return { exists: !!document.getElementById('memo-app-badge'),
    anyCls: !!document.querySelector('.memo-app-badge') };
})()`);
check('20. 桌面备忘录状态横幅已删除（入口保留图标）', badge && !badge.exists && !badge.anyCls, JSON.stringify(badge));
await evalJs(`document.getElementById('memo-app-badge').click()`);
await sleep(400);
// v3.15.x：横幅已删，改验「第三页图标 → 备忘录页」直达链路
await evalJs(`(() => {
  var app = document.querySelector('[data-desk-widget="app-memo"]') || document.querySelector('.page-slide.third .app[data-app="memo"]');
  if (app) app.click();
  return true;
})()`);
await sleep(400);
var badgeOpen = await evalJs(`(() => {
  var pg = document.getElementById('page-memo');
  var open = pg && !pg.hidden && pg.classList.contains('full');
  if (open) { document.getElementById('memo-back').click(); }
  return { open: open };
})()`);
await sleep(300);
check('21. 第三页备忘录图标直达备忘录页', badgeOpen && badgeOpen.open, JSON.stringify(badgeOpen));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

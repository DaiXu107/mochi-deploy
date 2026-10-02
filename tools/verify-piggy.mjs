// ===== 桌面第三页【存钱罐】功能冒烟验证 =====
// 覆盖：图标智能放置（默认第三页 / 装修过留第三页 / 布局不含时整组建新页）、打开页面、
//       空罐取出拦截、存入（金额+留言两步弹窗）、取出、超额拦截、设目标进度条、
//       攒够目标庆祝、TA 塞硬币纯彩蛋不入账（页内 Math.random 桩确定性命中）、
//       数据持久化、全局根命名空间（所有联系人桌面互通一份金库）。
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-piggy-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (hash || '') });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
// 等待条件成立（桌面布局迁移是异步级联，直接断言会踩到中间态，需轮询稳定）
async function waitFor(expr, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs(expr);
    if (v) return true;
    await sleep(250);
  }
  return false;
}

// 页面状态快照
const snap = `(() => {
  var pg = document.getElementById('page-piggy');
  var icon = document.querySelector('[data-desk-widget="app-piggy"]');
  var rows = document.querySelectorAll('#piggy-hist .piggy-row');
  var newRow = rows.length ? rows[0] : null;
  var slide = icon && icon.closest('.page-slide');
  return {
    iconExists: !!icon,
    iconInP3: !!(icon && icon.closest('.app-grid.p3-grid')),
    iconSlideIdx: slide ? Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'), slide) : -1,
    slideWidgetIds: slide ? Array.prototype.slice.call(slide.querySelectorAll('[data-desk-widget]')).map(function(n){return n.getAttribute('data-desk-widget');}) : [],
    pageOpen: !!pg && !pg.hidden,
    tabbarHidden: (document.querySelector('.tabbar') || {}).hidden === true,
    bal: (document.getElementById('piggy-bal') || {}).textContent || '',
    goalName: (document.getElementById('piggy-goal-name') || {}).textContent || '',
    sub: (document.getElementById('piggy-sub') || {}).textContent || '',
    fillW: document.getElementById('piggy-fill') ? document.getElementById('piggy-fill').style.width : '',
    msg: (document.getElementById('piggy-msg') || {}).textContent || '',
    rowCount: rows.length,
    newRowTxt: newRow ? newRow.textContent : '',
    histHasEmpty: !!(document.querySelector('#piggy-hist .piggy-empty')),
    toast: (document.getElementById('cc-toast') || {}).textContent || '',
    modalOpen: !(document.getElementById('modal-mask') || {}).hidden,
    modalTitle: (document.getElementById('modal-title') || {}).textContent || '',
    replyOpen: !(document.getElementById('piggy-reply') || {}).hidden,
    careQ: (document.getElementById('piggy-reply-q') || {}).textContent || '',
    months: document.querySelectorAll('#piggy-hist .pr-month').length,
    subs: document.querySelectorAll('#piggy-hist .pr-sub').length,
    moreTxt: (document.getElementById('piggy-more') || {}).textContent || '',
    goalRows: document.querySelectorAll('#piggy-goals .pg-row').length,
    curGoalName: (document.querySelector('#piggy-goals .pg-row.cur .pg-nm') || {}).textContent || '',
    shareOpen: !(document.getElementById('piggy-share') || {}).hidden
  };
})()`;
const clickBtn = (id) => evalJs(`(function(){ var b=document.getElementById('${id}'); if(!b) return 'no-btn'; b.click(); return 'ok'; })()`);
// 全局弹窗输入：直接设值后点确定（fire 读 input.value，无需 input 事件）
const modalFill = (v) => evalJs(`(function(){ var i=document.getElementById('modal-input'); if(!i) return 'no-input'; i.value='${v}'; return 'ok'; })()`);
const modalOk = () => clickBtn('modal-ok');
const openPiggy = () => evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-piggy"]'); if(i) i.click(); return 'ok'; })()`);
const lsGet = (k) => evalJs(`localStorage.getItem('${k}')`);
const lsSet = (k, v) => evalJs(`localStorage.setItem('${k}', '${v}')`);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 准备：全新用户 + 种子化（清历史数据 + 屏蔽 TA 彩蛋，保证 A 组从零开始）----
await gotoApp();
await evalJs(`(function(){
  ['piggy-log','piggy-goal-name','piggy-goal-amt','piggy-cards','piggy-last-visit'].forEach(function(k){ localStorage.removeItem('xy-home-v2:' + k); });
  Math.random = function () { return 0.998; };
})();`);

// ---- A 组：全新用户 ----
let s = await evalJs(snap);
check('A1 存钱罐图标已注入第三页图标组', s.iconExists && s.iconInP3, JSON.stringify({ inP3: s.iconInP3, slide: s.iconSlideIdx }));
check('A2 图标位于 page-slide#2（第三页）', s.iconSlideIdx === 2, 'slide=' + s.iconSlideIdx);

await openPiggy();
await sleep(600);
s = await evalJs(snap);
check('A3 点图标打开存钱罐页 + 底栏隐藏 + 初始 ¥0.00', s.pageOpen && s.tabbarHidden && s.bal === '¥0.00' && s.histHasEmpty, s.bal + '/' + s.tabbarHidden);

// 空罐取出拦截
await clickBtn('piggy-out');
await sleep(250);
s = await evalJs(snap);
check('A4 空罐取出被拦截（toast 提示，不弹窗）', !s.modalOpen && s.toast.indexOf('空') >= 0, s.toast);

// 存入：金额 → 留言 两步弹窗
await clickBtn('piggy-in');
await sleep(350);
s = await evalJs(snap);
check('A5 存一笔弹出金额弹窗', s.modalOpen && s.modalTitle.indexOf('存入金额') >= 0, s.modalTitle);
await modalFill('5.2'); await modalOk();
await sleep(400);
s = await evalJs(snap);
check('A6 金额确定后弹出留言弹窗（可不填）', s.modalOpen && s.modalTitle.indexOf('跟TA说一句') >= 0, s.modalTitle);
await modalFill('给你买糖'); await modalOk();
await sleep(400);
s = await evalJs(snap);
check('A7 存入后余额 ¥5.20 + 记录行含金额与留言', s.bal === '¥5.20' && s.rowCount === 1 && s.newRowTxt.indexOf('+¥5.20') >= 0 && s.newRowTxt.indexOf('给你买糖') >= 0, s.bal + '/' + s.newRowTxt);
let logRaw = await lsGet('xy-home-v2:piggy-log');
check('A8 piggy-log 全局根键持久化（type/amt/note）', !!logRaw && logRaw.indexOf('"type":"in"') >= 0 && logRaw.indexOf('"amt":5.2') >= 0 && logRaw.indexOf('给你买糖') >= 0, (logRaw || '').slice(0, 120));

// 超额取出拦截
await clickBtn('piggy-out');
await sleep(300);
s = await evalJs(snap);
check('A9 取出弹窗显示可用余额', s.modalOpen && s.modalTitle.indexOf('可用 5.20') >= 0, s.modalTitle);
await modalFill('99999'); await modalOk();
await sleep(300);
s = await evalJs(snap);
check('A10 超额取出被拦截 + 余额不变', !s.modalOpen && s.toast.indexOf('没有这么多') >= 0 && s.bal === '¥5.20', s.toast + '/' + s.bal);

// 正常取出（金额 → 用途 两步弹窗，用途留空）
await clickBtn('piggy-out');
await sleep(300);
await modalFill('1'); await modalOk();
await sleep(400);
s = await evalJs(snap);
check('A11a 取出金额确定后弹用途弹窗', s.modalOpen && s.modalTitle.indexOf('用在哪啦') >= 0, s.modalTitle);
await modalOk();
await sleep(500);
s = await evalJs(snap);
check('A11 取出 ¥1.00 后余额 ¥4.20 + 最新记录 −¥1.00', s.bal === '¥4.20' && s.rowCount === 2 && s.newRowTxt.indexOf('\u2212¥1.00') >= 0 && !s.modalOpen, s.bal + '/' + s.newRowTxt);

// 设目标（名称 → 金额 → 监督人 三步）
await clickBtn('piggy-set-goal');
await sleep(300);
await modalFill('一起去看海'); await modalOk();
await sleep(400);
s = await evalJs(snap);
check('A12 设目标第二步弹金额弹窗', s.modalOpen && s.modalTitle.indexOf('目标金额') >= 0, s.modalTitle);
await modalFill('100'); await modalOk();
await sleep(400);
s = await evalJs(snap);
check('A12b 第三步监督人选择卡出现', s.shareOpen, '');
await evalJs("(function(){ var c=document.querySelector('#piggy-share-chips .pg-chip[data-cid=\"*\"]'); if(c) c.click(); return 'ok'; })()");
await clickBtn('piggy-share-ok');
await sleep(500);
s = await evalJs(snap);
check('A13 目标生效：名称/进度文案/进度条 4%', s.goalName === '小目标 · 一起去看海' && s.sub.indexOf('已存 4.20 / 100.00') >= 0 && s.sub.indexOf('4%') >= 0 && s.fillW === '4%', s.goalName + '/' + s.sub + '/' + s.fillW);

// 攒够目标庆祝
await clickBtn('piggy-in');
await sleep(300);
await modalFill('95.8'); await modalOk();
await sleep(400);
await modalOk(); // 留言留空直接确定
await sleep(600);
s = await evalJs(snap);
check('A14 攒够目标：余额 ¥100.00 + 进度 100% + 庆祝字卡', s.bal === '¥100.00' && s.fillW === '100%' && (s.msg.indexOf('存够啦') >= 0 || s.msg.indexOf('目标达成') >= 0 || s.msg.indexOf('想好怎么花了吗') >= 0), s.bal + '/' + s.fillW + '/' + s.msg);

// ---- B 组：TA 塞硬币纯彩蛋（页内随机桩归零必命中；13h 未访高概率档；不入真实账目）----
await clickBtn('piggy-back');
await sleep(400);
await evalJs('(function(){ Math.random = function(){ return 0; }; })()');
await lsSet('xy-home-v2:piggy-last-visit', String(Date.now() - 13 * 3600000));
await openPiggy();
await sleep(900);
s = await evalJs(snap);
check('B1 彩蛋不入账：余额仍 ¥100.00', s.bal === '¥100.00', s.bal);
check('B2 不产生新记录行（仍 3 条，最新为 A14 那笔）', s.rowCount === 3 && s.newRowTxt.indexOf('+¥95.80') >= 0, 'rows=' + s.rowCount + ' top=' + s.newRowTxt);
check('B3 字卡提示 TA 塞钱并引导存入', s.msg.indexOf('偷偷塞了一点') >= 0 && s.msg.indexOf('¥0.52') >= 0 && s.msg.indexOf('替TA存进去') >= 0, s.msg);

// ---- C 组：持久化（重开应用数据还在；重载后重新屏蔽彩蛋避免污染断言）----
await gotoApp();
await evalJs('(function(){ Math.random = function(){ return 0.998; }; })()');
await openPiggy();
await sleep(600);
s = await evalJs(snap);
check('C1 重开后余额/目标/进度仍在（A14 已标记达成）', s.bal === '¥100.00' && s.goalName === '已达成 · 一起去看海' && s.fillW === '100%', s.bal + '/' + s.goalName + '/' + s.fillW);

// ---- D 组：装修过的用户 ----
await lsSet('xy-home-v2:default:desk-page-count', '3');
await lsSet('xy-home-v2:default:desk-layout', '[["deco"],["apps"],["app-water","app-eat"]]');
await gotoApp();
s = await evalJs(snap);
check('D1 已装修且布局含同组图标 → 图标留在第三页不新建页', s.iconInP3 && s.iconSlideIdx === 2, 'slide=' + s.iconSlideIdx + ' inP3=' + s.iconInP3);

await lsSet('xy-home-v2:default:desk-page-count', '3');
await lsSet('xy-home-v2:default:desk-layout', '[["deco"],["apps"],["music"]]');
await gotoApp();
s = await evalJs(snap);
const grp = ['app-tongpin', 'app-shenshou', 'app-water', 'app-eat', 'app-pomo', 'app-piggy'];
const samePage = grp.every(w => s.slideWidgetIds.indexOf(w) >= 0);
const cntAfter = await lsGet('xy-home-v2:default:desk-page-count');
check('D2 布局不含本组 → 整组六图标一起进新页（含存钱罐）', !s.iconInP3 && s.iconSlideIdx >= 3 && samePage && parseInt(cntAfter, 10) >= 4, 'slide=' + s.iconSlideIdx + ' cnt=' + cntAfter + ' samePage=' + samePage);

// ---- F 组：里程碑庆祝 / 多心愿单 / 取款关心回复 / 心愿监督人 ----
await gotoApp();
await evalJs('(function(){ Math.random = function(){ return 0.998; }; })()');
await openPiggy();
await sleep(600);

// F1 添加第二个心愿「奶茶基金」200，监督人保持默认（仅当前桌面）
await clickBtn('piggy-set-goal'); await sleep(300);
await modalFill('奶茶基金'); await modalOk(); await sleep(400);
await modalFill('200'); await modalOk(); await sleep(500);
s = await evalJs(snap);
check('F1a 第三步监督人选择卡出现', s.shareOpen, '');
const chipCnt = await evalJs("document.querySelectorAll('#piggy-share-chips .pg-chip').length");
const meChipOn = await evalJs("(function(){ var c=document.querySelector('#piggy-share-chips .pg-chip.on'); return c ? c.getAttribute('data-cid') : 'none'; })()");
check('F1b chips=全部+联系人，默认勾选 default', chipCnt >= 2 && meChipOn === 'default', 'chips=' + chipCnt + ' on=' + meChipOn);
await clickBtn('piggy-share-ok'); await sleep(500);
s = await evalJs(snap);
check('F1 心愿添加并切换为当前：奶茶基金 50%', s.goalRows === 2 && s.curGoalName === '奶茶基金' && !s.shareOpen && s.fillW === '50%' && s.sub.indexOf('/ 200.00') >= 0, s.curGoalName + '/' + s.fillW + '/' + s.sub);
let goalsRaw = await lsGet('xy-home-v2:piggy-goals');
check('F1c 监督范围持久化 by=["default"]', !!goalsRaw && goalsRaw.indexOf('"by":["default"]') >= 0, (goalsRaw || '').slice(0, 200));

// F2 存 1 元跨过 50% → 里程碑庆祝字卡
await clickBtn('piggy-in'); await sleep(300);
await modalFill('1'); await modalOk(); await sleep(400);
await modalOk(); await sleep(500);
s = await evalJs(snap);
check('F2 跨过50%触发里程碑庆祝', s.msg.indexOf('过半啦') >= 0 && s.rowCount === 4, s.msg + '/' + s.rowCount);

// F3 再存 99 攒满心愿 → 达成庆祝 + done 标记
await clickBtn('piggy-in'); await sleep(300);
await modalFill('99'); await modalOk(); await sleep(400);
await modalOk(); await sleep(600);
s = await evalJs(snap);
goalsRaw = await lsGet('xy-home-v2:piggy-goals');
const doneCnt = (goalsRaw.match(/"done":true/g) || []).length;
check('F3 达成心愿：庆祝字卡 + 两个心愿均标记 done', (s.msg.indexOf('攒够了') >= 0 || s.msg.indexOf('目标达成') >= 0 || s.msg.indexOf('存够啦') >= 0) && doneCnt === 2, s.msg + '/done×' + doneCnt);

// F4 取 1 元 → TA 关心追问框
await clickBtn('piggy-out'); await sleep(300);
await modalFill('1'); await modalOk(); await sleep(400);
await modalOk(); await sleep(500);
s = await evalJs(snap);
check('F4 取款后弹出 TA 关心追问', s.replyOpen === true && s.careQ.indexOf('TA：') === 0, s.careQ);

// F5 回复一句发送到聊天，追问框收起
await evalJs("(function(){ var i=document.getElementById('piggy-reply-in'); if(i) i.value='给你买了个小惊喜'; return 'ok'; })()");
await clickBtn('piggy-reply-send'); await sleep(400);
s = await evalJs(snap);
check('F5 回复已发送 + 追问框收起', s.toast.indexOf('已回复') >= 0 && !s.replyOpen, s.toast + '/' + s.replyOpen);

// F6 删除临时心愿（确认弹窗；不动两个固定 fixture）
await clickBtn('piggy-set-goal'); await sleep(300);
await modalFill('临时愿望'); await modalOk(); await sleep(400);
await modalFill('5'); await modalOk(); await sleep(400);
await clickBtn('piggy-share-ok'); await sleep(500);
s = await evalJs(snap);
check('F6a 临时心愿已添加', s.goalRows === 3, 'rows=' + s.goalRows);
await evalJs("(function(){ var d=document.querySelectorAll('#piggy-goals .pg-del'); var b=d[d.length-1]; if(b) b.click(); return 'ok'; })()");
await sleep(400);
s = await evalJs(snap);
check('F6b 删除需确认弹窗', s.modalOpen && s.modalTitle.indexOf('删除心愿') >= 0, s.modalTitle);
await modalOk(); await sleep(500);
s = await evalJs(snap);
check('F6 删除生效回到 2 个心愿', s.goalRows === 2 && !s.modalOpen, 'rows=' + s.goalRows);

// ---- G 组：全部记录（展开 + 按月分组小计）----
await clickBtn('piggy-more'); await sleep(400);
s = await evalJs(snap);
check('G1 展开全部记录：6 条全显 + 月份分组 + 小结', s.moreTxt === '只看最近' && s.rowCount === 6 && s.months >= 1 && s.subs >= 1, s.moreTxt + '/rows=' + s.rowCount + '/months=' + s.months + '/subs=' + s.subs);
await clickBtn('piggy-more'); await sleep(400);
s = await evalJs(snap);
check('G2 收起恢复最近视图', s.moreTxt === '全部记录' && s.rowCount <= 6 && s.months === 0, s.moreTxt + '/rows=' + s.rowCount);

// ---- E 组：跨桌面互通 + 心愿可见性过滤 ----
await gotoApp();
await evalJs('(function(){ Math.random = function(){ return 0.998; }; })()');
const cid2 = await evalJs(`(function(){ try { var id = window.createContact('测试二号'); window.setActiveContact(id); return id || 'no-id'; } catch (e) { return 'ERR'; } })()`);
await sleep(1500);
await openPiggy();
await sleep(600);
s = await evalJs(snap);
goalsRaw = await lsGet('xy-home-v2:piggy-goals');
check('E1 切到新桌面：余额/目标互通（全局一份数据）', /^c[0-9a-z]+/.test(String(cid2)) && s.pageOpen && s.bal === '¥199.00' && s.goalName === '已达成 · 一起去看海', String(cid2) + '/' + s.bal + '/' + s.goalName);
check('E2 可见性过滤：default 专属心愿在此桌面隐藏，数据仍完整保留', s.goalRows === 1 && s.curGoalName.indexOf('一起去看海') >= 0 && !!goalsRaw && goalsRaw.indexOf('奶茶基金') >= 0, 'rows=' + s.goalRows + ' cur=' + s.curGoalName);

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

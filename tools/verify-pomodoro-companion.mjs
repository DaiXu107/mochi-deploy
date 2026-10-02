// ===== 番茄钟 · 陪伴模式 冒烟验证（v3.x：专属聊天窗重构后） =====
// 覆盖：入口按钮、进入【独立陪伴聊天窗】而非普通聊天、开场白只进专属窗不进普通聊天记录、
//       窗内发消息 TA 回应（普通聊天不受影响）、暂停/继续、菜单回番茄钟页、
//       提前结束（弹窗+TA回应进窗）、完成时祝贺只进专属窗+自动收条（Date.now 跳变模拟）、
//       关闭期间完成的补记（进窗）、刷新接续恢复（普通聊天页状态条仍可用）。
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pmp-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

const GREET = ['好，我陪着你', '去吧，我在这等你', '专注吧，我不吵你', '嗯，一起加油'];
// 页面/消息快照：win=专属陪伴窗；chat=普通聊天页与记录
const winSnap = `(() => {
  var win = document.getElementById('page-pmp-chat');
  var chatPg = document.getElementById('page-chat');
  var list = document.getElementById('pmp-c-list');
  var bubbles = list ? Array.prototype.map.call(list.querySelectorAll('.pmp-c-bub'), function(b){return b.textContent;}) : [];
  var msgs = (window.getChatMsgs ? window.getChatMsgs() : []).map(function(x){return x.text||'';});
  return {
    winOpen: !!win && !win.hidden,
    chatOpen: !!chatPg && !chatPg.hidden,
    time: (document.getElementById('pmp-cd-time') || {}).textContent || '',
    label: (document.getElementById('pmp-cd-label') || {}).textContent || '',
    toggle: (document.getElementById('pmp-cd-toggle') || {}).textContent || '',
    bubbles: bubbles,
    lastBubble: bubbles.length ? bubbles[bubbles.length - 1] : '',
    chatLast: msgs.length ? msgs[msgs.length - 1] : '',
    chatHasGreet: msgs.some(function(t){ return ${JSON.stringify(GREET)}.indexOf(t) >= 0; }),
    chatCount: msgs.length,
    sessionAlive: !!localStorage.getItem('xy-home-v2:default:pomo-companion')
  };
})()`;
const logTexts = `(() => { try { return (JSON.parse(localStorage.getItem('xy-home-v2:default:pomo-companion-log')||'[]')).map(function(x){return x.t;}); } catch(e) { return []; } })()`;
const openPomo = () => evalJs(`(function(){ var i=document.querySelector('[data-desk-widget="app-pomo"]'); if(i) i.click(); return 'ok'; })()`);
const openChatApp = () => evalJs(`(function(){ var a=document.querySelector('.app[data-app="chat"]'); if(a){a.click(); return 'ok';} if(window.enterChat){try{window.enterChat();}catch(e){} return 'enterChat';} return 'no'; })()`);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- A 组：开启陪伴模式 → 独立窗口 ----
await gotoApp();
await openPomo();
await sleep(400);
let goTxt = await evalJs(`(document.getElementById('pomo-companion')||{}).textContent||''`);
check('A1 番茄钟页有「陪伴模式」按钮', goTxt.indexOf('陪伴模式') >= 0, goTxt);
await evalJs(`document.getElementById('pomo-companion').click()`);
await sleep(600);
let s = await evalJs(winSnap);
check('A2 进入【专属陪伴窗】且不在普通聊天页', s.winOpen === true && s.chatOpen === false, JSON.stringify({ win: s.winOpen, chat: s.chatOpen }));
check('A3 陪伴会话已建立（记录持久化）', s.sessionAlive === true);
const noQuiet = await evalJs(`window.__pomoCompanionQuiet === undefined`);
check('A3b 陪伴期间无勿扰标记（普通聊天照常）', noQuiet === true);
check('A4 开场白在专属窗气泡里', s.lastBubble !== '' && GREET.indexOf(s.lastBubble) >= 0, s.lastBubble);
check('A5 开场白没有写进普通聊天记录', s.chatHasGreet === false, 'chatCount=' + s.chatCount);
check('A6 窗内倒计时在走（≤25:00 · 专注中）', /^2[0-5]:\d{2}$/.test(s.time) && s.label.indexOf('专注中') >= 0, s.time + '/' + s.label);
const t6 = s.time;
await sleep(1300);
s = await evalJs(winSnap);
check('A7 时间在减少', s.time !== t6, t6 + '→' + s.time);

// ---- B 组：窗内收发消息 ----
const chatCountBefore = s.chatCount;
await evalJs(`(function(){ var i=document.getElementById('pmp-c-in'); i.value='有点累'; var b=document.getElementById('pmp-c-send'); b.click(); })()`);
await sleep(400);
s = await evalJs(winSnap);
check('B1 我方消息进专属窗（右侧气泡）', s.bubbles.length >= 2 && s.bubbles[s.bubbles.length - 1] === '有点累', JSON.stringify(s.bubbles.slice(-2)));
await sleep(2100);
s = await evalJs(winSnap);
check('B2 TA 在窗内回应', s.bubbles.length >= 3 && s.bubbles[s.bubbles.length - 1] !== '有点累', s.lastBubble);
check('B3 窗内对话没有写进普通聊天记录', s.chatCount === chatCountBefore, 'count ' + chatCountBefore + '→' + s.chatCount);

// 暂停 / 继续（专属窗条）
await evalJs(`document.getElementById('pmp-cd-toggle').click()`);
await sleep(250);
s = await evalJs(winSnap);
check('B4 暂停 → 标签=已暂停 · 按钮=继续', s.label === '已暂停' && s.toggle === '继续', s.label + '/' + s.toggle);
const tp = s.time;
await sleep(700);
s = await evalJs(winSnap);
check('B5 暂停期间不走秒', s.time === tp, tp);
await evalJs(`document.getElementById('pmp-cd-toggle').click()`);
await sleep(900);
s = await evalJs(winSnap);
check('B6 继续后恢复走动', s.label.indexOf('专注中') >= 0 && s.time !== tp, s.time);

// 菜单：回番茄钟页 + 再返回专属窗
await evalJs(`document.getElementById('pmp-cd-more').click()`);
await sleep(200);
await evalJs(`var b=document.querySelector('#pmp-c-menu button[data-pmpc="page"]'); if(b) b.click();`);
await sleep(400);
let pomoOpen = await evalJs(`!document.getElementById('page-pomodoro').hidden`);
goTxt = await evalJs(`(document.getElementById('pomo-companion')||{}).textContent||''`);
check('B7 菜单「回番茄钟页」生效 + 按钮变「陪伴中」', pomoOpen === true && goTxt.indexOf('陪伴中') >= 0, goTxt);
await evalJs(`document.getElementById('pomo-companion').click()`);
await sleep(400);
s = await evalJs(winSnap);
check('B8 陪伴中再点按钮回到专属窗（历史还在）', s.winOpen === true && s.chatOpen === false && s.bubbles.length >= 3, '');

// 提前结束（专属窗菜单）
await evalJs(`document.getElementById('pmp-cd-more').click()`);
await sleep(200);
await evalJs(`var b=document.querySelector('#pmp-c-menu button[data-pmpc="quit"]'); if(b) b.click();`);
await sleep(500);
const modalShown = await evalJs(`!!(document.getElementById('modal-mask') && !document.getElementById('modal-mask').hidden)`);
check('B9 提前结束弹出确认弹窗', modalShown === true);
await evalJs(`(function(){ var pills=document.getElementById('modal-pills'); if(!pills||pills.hidden) return; var arr=pills.querySelectorAll('.pill'); for(var i=0;i<arr.length;i++){ if(arr[i].textContent.indexOf('结束')>=0){ arr[i].click(); break; } } })()`);
await sleep(250);
await evalJs(`var ok=document.getElementById('modal-ok'); if(ok&&!ok.hidden) ok.click();`);
await sleep(700);
s = await evalJs(winSnap);
let quitLog = await evalJs(logTexts);
check('B10 结束后：会话清除 + 回番茄钟页 + TA 回应进窗', s.sessionAlive === false && !!(await evalJs(`!document.getElementById('page-pomodoro').hidden`)) && quitLog[quitLog.length - 1] === '没事，休息一下也可以', JSON.stringify({ alive: s.sessionAlive, last: quitLog[quitLog.length - 1] }));

// ---- C 组：完成一个番茄（陪伴中）—— Date.now 跳变 ----
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function () {
  if (location.hash.indexOf('pmpjump') < 0) return;
  var orig = Date.now.bind(Date); var t0 = orig();
  Date.now = function () { return orig() - t0 > 9000 ? orig() + 26 * 60000 : orig(); };
})();` });
await gotoApp('#pmpjump');
await openPomo();
await sleep(300);
await evalJs(`document.getElementById('pomo-companion').click()`);
await sleep(600);
await sleep(9200);
s = await evalJs(winSnap);
check('C1 完成后陪伴会话自动清除', s.sessionAlive === false);
const doneLog = await evalJs(logTexts);
check('C2 TA 完成祝贺只进专属窗记录（🍅）', doneLog.some(t => typeof t === 'string' && t.indexOf('🍅') >= 0), JSON.stringify(doneLog.slice(-2)));
s = await evalJs(winSnap);
check('C3 祝贺没有写进普通聊天记录', s.chatHasGreet === false && !(s.chatLast || '').includes('🍅'), s.chatLast);
await openPomo();
await sleep(400);
const stats = await evalJs(`(document.getElementById('pomo-stats')||{}).textContent||''`);
const selTab = await evalJs(`JSON.stringify({ sel: (document.querySelector('#page-pomodoro .pomo-tab.sel')||{dataset:{}}).dataset.pmode || '', st: (document.getElementById('pomo-state')||{}).textContent || '', tabs: Array.prototype.map.call(document.querySelectorAll('#page-pomodoro .pomo-tab'), function(t){return t.dataset.pmode+':'+t.classList.contains('sel');}) })`);
check('C4 今日 🍅 计入 ×1 + 自动切小憩', stats.indexOf('× 1') >= 0 && (selTab.indexOf('"sel":"short"') >= 0 || selTab.indexOf('小憩') >= 0), stats + '/' + selTab);

// ---- D 组：关闭期间完成的补记 ----
// 注意：此时页面可能仍带 C 组的 Date.now 跳变钩子，种子时间一律用 performance 时间轴
await evalJs(`(function(){ var now = Math.floor(performance.timeOrigin + performance.now()); localStorage.setItem('xy-home-v2:default:pomo-companion', JSON.stringify({mode:'focus',totalMs:1500000,endAt:now-10000,startedAt:now-1510000,paused:0,remainMs:0,enc:1,nextEncAt:0})); })()`);
await gotoApp();
await sleep(2000);
let restoredLog = await evalJs(logTexts);
let recGone = await evalJs(`!localStorage.getItem('xy-home-v2:default:pomo-companion')`);
let todayCnt = await evalJs(`(JSON.parse(localStorage.getItem('xy-home-v2:default:pomo-today')||'{}').count)||0`);
check('D1 关闭期间完成 → 补记祝贺进专属窗 + 会话记录清除', recGone === true && ((restoredLog || []).some(t => String(t).indexOf('完成了一个专注') >= 0)) && todayCnt >= 2, JSON.stringify({ log: (restoredLog || []).slice(-1), recGone: recGone, today: todayCnt }));

// ---- E 组：进行中刷新 → 接续恢复（普通聊天页状态条仍可用） ----
await evalJs(`(function(){ var now = Math.floor(performance.timeOrigin + performance.now()); localStorage.setItem('xy-home-v2:default:pomo-companion', JSON.stringify({mode:'focus',totalMs:1500000,endAt:now+60000,startedAt:now,paused:0,remainMs:0,enc:0,nextEncAt:0})); })()`);
await gotoApp();
await openChatApp();
await sleep(600);
const barSnap = `(() => {
  var pg = document.getElementById('page-chat');
  var bar = document.getElementById('pmp-bar');
  return {
    chatOpen: !!pg && !pg.hidden,
    barVisible: !!bar && !bar.hidden,
    time: (document.getElementById('pmp-bar-time') || {}).textContent || '',
    label: (document.getElementById('pmp-bar-label') || {}).textContent || ''
  };
})()`;
s = await evalJs(barSnap);
check('E1 刷新接续：普通聊天页状态条恢复 ≤01:00', s.chatOpen && s.barVisible && /^0[0-1]:\d{2}$/.test(s.time), s.time + '/' + s.barVisible);
goTxt = await evalJs(`(document.getElementById('pomo-companion')||{}).textContent||''`);
check('E2 恢复的会话记录仍在 + 按钮为「陪伴中」', (await evalJs(`!!localStorage.getItem('xy-home-v2:default:pomo-companion')`)) === true && goTxt.indexOf('陪伴中') >= 0, goTxt);

// 清理：从普通聊天页状态条提前退出（验证旧入口仍可用），不留状态给其他用例
await evalJs(`document.getElementById('pmp-bar-more') && document.getElementById('pmp-bar-more').click()`);
await sleep(150);
await evalJs(`var b=document.querySelector('.pmp-menu button[data-pmp="quit"]'); if(b) b.click();`);
await sleep(450);
await evalJs(`(function(){ var pills=document.getElementById('modal-pills'); if(!pills||pills.hidden) return; var arr=pills.querySelectorAll('.pill'); for(var i=0;i<arr.length;i++){ if(arr[i].textContent.indexOf('结束')>=0){ arr[i].click(); break; } } })()`);
await sleep(200);
await evalJs(`var ok=document.getElementById('modal-ok'); if(ok&&!ok.hidden) ok.click();`);
await sleep(400);
const cleaned = await evalJs(`!localStorage.getItem('xy-home-v2:default:pomo-companion')`);
check('E3 普通聊天页状态条的提前结束仍可用', cleaned === true, '');

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

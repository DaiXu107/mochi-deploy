// ===== 信箱「寄出的信」点击查看 + 回信标记 全链路验证（OPPO Reno16 Edge/Via 用户反馈回归）=====
// 反馈：自己寄出去的信没办法点击查看、也看不到有没有回信。
// 本脚本在 390×844 移动视口（安卓 ce-box 转换启用）下走完整链路：
//   写信 → 寄出（应自动跳回「寄出的信」）→ 点信件 → 详情弹层可见；
//   openTCPanel 缺失时 openModal 兜底可看；聊天里信件通知可点击直达信箱；
//   TA 回信落地后列表出现「对方已回信」标签、详情里能看到回信信纸。
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': '.css', '.json': 'application/json' };
types['.css'] = 'text/css';
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mailsent-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await gotoApp();
await evalJs(`(function(){
  Object.keys(localStorage).filter(function(k){return k.indexOf(':mail-letters')>=0||k.indexOf('mail-letter')>=0;}).forEach(function(k){localStorage.removeItem(k);});
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  return 'cleared';
})()`);

// ---- A 组：写信 → 寄出 → 应自动跳回信箱页「寄出的信」 ----
let s = await evalJs(`(function(){
  var app = document.querySelector('.app[data-app="mail"]');
  if (!app) return 'no-app';
  app.click();
  var pg = document.getElementById('page-mail');
  if (!pg || pg.hidden) return 'not-open';
  var tab = document.querySelector('#page-mail .fav-tab[data-mtab="write"]');
  if (!tab) return 'no-tab';
  tab.click();
  var btn = document.getElementById('mail-open-write');
  if (!btn) return 'no-btn';
  btn.click();
  var wp = document.getElementById('page-mail-write');
  return wp && !wp.hidden ? 'write-page' : 'not-open';
})()`);
await sleep(500);
check('A1 进入写信页', s === 'write-page', String(s));

// 模拟真实输入：写进 ce-box（与真机键盘输入等价的最终 DOM 状态）
s = await evalJs(`(function(){
  var ta = document.getElementById('mail-input');
  if (!ta) return 'no-input';
  var box = document.querySelector('.ce-box[data-for="mail-input"]');
  if (box) box.textContent = '亲爱的，最近好想你，给你写第一封信。';
  else ta.value = '亲爱的，最近好想你，给你写第一封信。';
  var send = document.getElementById('mail-send');
  if (!send) return 'no-send';
  send.click();
  return { errs: window.__errs, toast: (document.getElementById('cc-toast')||{}).textContent || '' };
})()`);
await sleep(700);
check('A2 点寄出无 JS 异常', s && !s.errs.length, JSON.stringify(s && s.errs));
check('A3 提示信件已寄出', s && /已寄出/.test(String(s.toast)), String(s && s.toast));

s = await evalJs(`(function(){
  var mp = document.getElementById('page-mail');
  var outCard = document.querySelector('#page-mail .cal-card[data-mpanel="out"]');
  var outTab = document.querySelector('#page-mail .fav-tab[data-mtab="out"]');
  var list = document.getElementById('mail-out-list');
  return {
    mailPageShown: !!(mp && !mp.hidden),
    outCardShown: !!(outCard && !outCard.hidden),
    outTabSel: !!(outTab && outTab.classList.contains('sel')),
    items: list ? list.querySelectorAll('.mail-item').length : 0
  };
})()`);
check('A4 寄出后自动跳回信箱页并选中「寄出的信」', s && s.mailPageShown && s.outCardShown && s.outTabSel, JSON.stringify(s));
check('A5 寄出的信列表有 1 封', s && s.items === 1, JSON.stringify(s));

// ---- B 组：点击查看详情 ----
s = await evalJs(`(function(){
  var it = document.querySelector('#mail-out-list .mail-item');
  if (!it) return 'no-item';
  it.click();
  var mask = document.getElementById('tc-mask');
  var body = document.getElementById('tc-body');
  if (!mask) return 'no-mask';
  return {
    maskShown: !mask.hidden,
    hasPaper: !!(body && body.querySelector('.mail-paper')),
    paperText: body ? (body.querySelector('.mail-paper-body')||{}).textContent || '' : '',
    title: (document.getElementById('tc-panel-title')||{}).textContent || ''
  };
})()`);
await sleep(400);
check('B1 点击寄出的信打开详情弹层', s && s.maskShown, JSON.stringify(s));
check('B2 详情含完整信纸正文', s && s.hasPaper && String(s.paperText).indexOf('最近好想你') >= 0, String(s && s.paperText).slice(0, 40));

// ---- C 组：openTCPanel 缺失时 openModal 兜底 ----
s = await evalJs(`(function(){
  var m = document.getElementById('tc-mask'); if (m) m.hidden = true;
  window.__savedOTCP = window.openTCPanel;
  window.openTCPanel = undefined; // 模拟上游模块在该设备抛错导致未定义
  var it = document.querySelector('#mail-out-list .mail-item');
  if (!it) return 'no-item';
  it.click();
  var modal = document.querySelector('.modal-mask:not([hidden]) .modal-static');
  var mask2 = document.getElementById('tc-mask');
  window.openTCPanel = window.__savedOTCP;
  return {
    modalShown: !!modal,
    modalText: modal ? modal.textContent : '',
    tcNotShown: !!(mask2 && mask2.hidden)
  };
})()`);
await sleep(400);
check('C1 openTCPanel 缺失时详情退回 openModal 展示', s && s.modalShown && s.tcNotShown, JSON.stringify({ shown: s && s.modalShown }));
check('C2 兜底弹窗含信件正文', s && String(s.modalText).indexOf('最近好想你') >= 0, String(s && s.modalText).slice(0, 50));
await evalJs(`(function(){ var mm=document.querySelector('.modal-mask'); if(mm) mm.hidden=true; return 'ok'; })()`);
await sleep(200);

// ---- D 组：TA 回信落地后「对方已回信」可见 ----
s = await evalJs(`(function(){
  try {
    var store = window.activeStore();
    var raw = store.get('mail-letters');
    var arr = raw ? JSON.parse(raw) : [];
    if (!arr.length) return 'empty';
    arr[0].partnerReply = { content: '收到你的信啦，我也很想你。', tm: Date.now() };
    store.set('mail-letters', JSON.stringify(arr));
    try { window.idbSet(window.activePrefix()+':mail-letters', JSON.stringify(arr)); } catch(e){}
    return 'injected';
  } catch(e) { return 'err:' + e.message; }
})()`);
await sleep(300);
check('D1 注入 TA 回信数据', s === 'injected', String(s));

s = await evalJs(`(function(){
  // 重进信箱页触发重渲染（模拟用户重新打开）
  document.querySelectorAll('.page').forEach(function(p){ p.hidden = true; });
  document.getElementById('page-phone').hidden = false;
  var app = document.querySelector('.app[data-app="mail"]');
  app.click();
  var outTab = document.querySelector('#page-mail .fav-tab[data-mtab="out"]');
  outTab.click();
  var list = document.getElementById('mail-out-list');
  var tag = list.querySelector('.mail-tag');
  var it = list.querySelector('.mail-item');
  if (it) it.click();
  var mask = document.getElementById('tc-mask');
  var body = document.getElementById('tc-body');
  var papers = body ? Array.prototype.map.call(body.querySelectorAll('.mail-paper'), function(x){ return x.textContent; }) : [];
  return {
    maskShown: mask && !mask.hidden,
    tag: tag ? tag.textContent : '',
    paperCount: papers.length,
    hasReply: papers.some(function(t){ return t.indexOf('收到你的信啦') >= 0; }),
    errs: window.__errs
  };
})()`);
await sleep(400);
check('D2 列表出现「对方已回信」标签', s && s.tag.indexOf('对方已回信') >= 0, String(s && s.tag));
check('D3 详情弹层再次打开且含对方回信信纸', s && s.maskShown && s.paperCount >= 2 && s.hasReply, JSON.stringify({ n: s && s.paperCount }));
check('D4 全程无 JS 异常', s && (!s.errs || !s.errs.length), JSON.stringify(s && s.errs));
await evalJs(`(function(){ var m=document.getElementById('tc-mask'); if(m) m.hidden=true; return 'ok'; })()`);

// ---- E 组：聊天里的信件通知可点击直达信箱 ----
s = await evalJs(`(function(){
  try {
    document.querySelectorAll('.page').forEach(function(p){ p.hidden = true; });
    if (window.enterChat) window.enterChat();
    var cb = document.getElementById('chat-body');
    if (!cb) return 'no-chat-body';
    var notices = cb.querySelectorAll('.msg-poke.mail-notice');
    var target = null;
    for (var i = notices.length - 1; i >= 0; i--) {
      if (notices[i].textContent.indexOf('写了一封信') >= 0) { target = notices[i]; break; }
    }
    if (!target) return { found: false, total: notices.length };
    target.click();
    var mp = document.getElementById('page-mail');
    return { found: true, opened: !!(mp && !mp.hidden) };
  } catch(e) { return 'err:' + e.message; }
})()`);
await sleep(500);
check('E1 聊天里「写了一封信」通知带可点击样式', s && s.found, JSON.stringify(s));
check('E2 点击通知直达信箱页', s && s.found && s.opened, JSON.stringify(s));

// ---- F 组：收到的信仍可正常打开（回归）----
s = await evalJs(`(function(){
  try {
    document.querySelectorAll('.page').forEach(function(p){ p.hidden = true; });
    document.getElementById('page-phone').hidden = false;
    var store = window.activeStore();
    var arr = JSON.parse(store.get('mail-letters') || '[]');
    arr.unshift({ id: 'l_test_in', type: 'received', tt: '想你了', content: '这是TA写来的信。', tm: Date.now() });
    store.set('mail-letters', JSON.stringify(arr));
    document.querySelector('.app[data-app="mail"]').click();
    var inTab = document.querySelector('#page-mail .fav-tab[data-mtab="in"]');
    inTab.click();
    var it = document.querySelector('#mail-in-list .mail-item');
    if (!it) return 'no-in-item';
    it.click();
    var mask = document.getElementById('tc-mask');
    var body = document.getElementById('tc-body');
    return { shown: mask && !mask.hidden, ok: !!(body && body.textContent.indexOf('这是TA写来的信') >= 0) };
  } catch(e) { return 'err:' + e.message; }
})()`);
await sleep(400);
check('F1 收到的信可打开（回归）', s && s.shown && s.ok, JSON.stringify(s));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

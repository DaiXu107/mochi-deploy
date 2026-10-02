// ===== 红包金额与心意集市心意币统一账本验证 =====
// 用户需求：①红包里的钱与心意集市的「心意币」共用同一个数值，红包侧文案也改叫心意币
//          ②余额行改为「向 Mochi 申请心意币」申请制——打款累加入账，非直接改数值
// 覆盖：①老数据迁移——gift-wallet 缺失时首次读取继承 rp-wallet 余额并落盘
//      ②红包面板读共用账本 gift-wallet，忽略旧 rp-wallet 残值
//      ③红包面板余额行 →「向 Mochi 申请心意币」双胶囊连填，打款累加写 gift-wallet 且 rp-wallet 不动
//      ④发红包扣减共用账本 myBalance；消息卡片标签「红包 · 心意币」
//      ⑤TA 领取/退回消息为新格式「（心意币 ¥..）」
//      ⑥非法金额拦截 / 留空确定关闭
//      ⑦构建产物静态断言（旧「直接修改」文案已清除）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-unifiedwallet-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
async function walletRaw() {
  return evalJs(`(function(){
    return {
      gift: JSON.parse(localStorage.getItem('xy-home-v2:gift-wallet') || 'null'),
      rp: JSON.parse(localStorage.getItem('xy-home-v2:default:rp-wallet') || 'null')
    };
  })()`);
}
async function openRpPanel() {
  return evalJs(`(function(){
    var a = document.querySelector('.app[data-app="chat"]');
    if (a) a.click();
    var mp = document.getElementById('chat-more-panel'); if (mp) mp.hidden = false;
    var mr = document.getElementById('more-rp');
    if (mr) mr.click();
    var p = document.getElementById('chat-rp-panel');
    return !!(p && !p.hidden);
  })()`);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await gotoApp();

// ---- D 组：新用户默认金额 + 老占位巨款一次性迁移 ----
await evalJs(`(function(){
  localStorage.removeItem('xy-home-v2:gift-wallet'); localStorage.removeItem('xy-home-v2:wallet-global-migrated');
  localStorage.removeItem('xy-home-v2:default:rp-wallet');
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  return 'cleared';
})()`);
await gotoApp();
await openRpPanel();
await sleep(500);
let sD = await evalJs(`document.getElementById('rp-balance') ? document.getElementById('rp-balance').textContent : ''`);
check('D1 新用户默认心意币双方各 ¥520（我爱你起步价）', sD && sD.indexOf('心意币 ¥520.00') >= 0 && sD.indexOf('¥520.00 · 向 Mochi 申请心意币') >= 0, JSON.stringify(sD));
let wD = await walletRaw();
check('D2 默认值落盘 gift-wallet（52000/52000 分）', wD && wD.gift && wD.gift.myBalance === 52000 && wD.gift.systemBalance === 52000, JSON.stringify(wD));
await evalJs(`localStorage.setItem('xy-home-v2:gift-wallet', JSON.stringify({ myBalance: 99999999, systemBalance: 99999999 })); 'seeded'`);
await gotoApp();
await openRpPanel();
await sleep(500);
sD = await evalJs(`document.getElementById('rp-balance') ? document.getElementById('rp-balance').textContent : ''`);
check('D3 老占位巨款（¥999999.99×2，从未动过钱包）自动迁移为 ¥520/¥520', sD && sD.indexOf('¥520.00') >= 0 && sD.indexOf('999999') < 0, JSON.stringify(sD));
wD = await walletRaw();
check('D4 迁移结果落盘（52000/52000 分）', wD && wD.gift && wD.gift.myBalance === 52000 && wD.gift.systemBalance === 52000, JSON.stringify(wD));

// ---- M 组：老数据一次性迁移（gift-wallet 缺失 → 继承 rp-wallet） ----
await evalJs(`(function(){
  // 全局账本时代：清根键 + 迁移标记（xyStore 三清），ns 的 rp-wallet 用 LS 直接种
  try { var st = window.xyStore('xy-home-v2'); if (st) { st.remove('gift-wallet'); st.remove('wallet-global-migrated'); } } catch (e) {}
  try { var stn = window.activeStore(); if (stn) stn.remove('rp-wallet'); } catch (e) {}
  localStorage.setItem('xy-home-v2:default:rp-wallet', JSON.stringify({ myBalance: 12345, systemBalance: 67890 }));
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  return 'seeded';
})()`);
await sleep(600);
await gotoApp();
await openRpPanel();
await sleep(500);
let s = await evalJs(`(function(){
  var bal = document.getElementById('rp-balance');
  return bal ? bal.textContent : '';
})()`);
check('M1 老用户迁移：红包余额行显示继承自 rp-wallet 的 123.45/678.90（心意币口径）', s && s.indexOf('心意币 ¥123.45') >= 0 && s.indexOf('¥678.90') >= 0, JSON.stringify(s));
let w = await walletRaw();
check('M2 迁移已落盘 gift-wallet（12345/67890 分）', w && w.gift && w.gift.myBalance === 12345 && w.gift.systemBalance === 67890, JSON.stringify(w));

// ---- U 组：红包读共用账本，忽略 rp-wallet 残值 ----
await evalJs(`(function(){
  window.xyStore('xy-home-v2').set('gift-wallet', JSON.stringify({ myBalance: 50000, systemBalance: 60000 }));
  window.activeStore().set('rp-wallet', JSON.stringify({ myBalance: 1, systemBalance: 2 }));
  var c = document.getElementById('chat-rp-close'); if (c) c.click();
  return 'reset';
})()`);
await sleep(200);
await openRpPanel();
await sleep(400);
s = await evalJs(`document.getElementById('rp-balance') ? document.getElementById('rp-balance').textContent : ''`);
check('U1 红包面板显示共用账本值 500.00/600.00，不受旧 rp-wallet(0.01/0.02) 影响', s && s.indexOf('¥500.00') >= 0 && s.indexOf('¥600.00') >= 0 && s.indexOf('¥0.01') < 0, JSON.stringify(s));

// ---- E 组：余额行弹窗为「向 Mochi 申请心意币」申请制（打款累加，非直接改数值） ----
s = await evalJs(`(function(){
  document.getElementById('rp-balance').click();
  var mask = document.getElementById('modal-mask');
  var title = document.getElementById('modal-title');
  var okBtn = document.getElementById('modal-ok');
  var pills = Array.prototype.map.call(document.querySelectorAll('#modal-pills .pill'), function(p){ return p.textContent; });
  return { visible: !!(mask && !mask.hidden), title: title ? title.textContent : '', okTxt: okBtn ? okBtn.textContent : '', pills: pills };
})()`);
await sleep(300);
check('E1 弹窗标题「向 Mochi 申请心意币」+ 确认键【申请】+ 双胶囊', s && s.visible && s.title === '向 Mochi 申请心意币' && s.okTxt === '申请' && s.pills.length === 2 && s.pills[0] === '我的心意币' && String(s.pills[1]).indexOf('的心意币') > 0, JSON.stringify(s));
s = await evalJs(`(function(){
  document.getElementById('modal-input').value = '66.66';
  document.getElementById('modal-ok').click();
  return 'ok1';
})()`);
await sleep(400);
s = await evalJs(`(function(){
  var mask = document.getElementById('modal-mask');
  var input = document.getElementById('modal-input');
  var taVisible = !!(mask && !mask.hidden);
  var toastEl = document.getElementById('cc-toast');
  if (!taVisible) return { taVisible: false };
  input.value = '88.88';
  document.getElementById('modal-ok').click();
  return { taVisible: true, toast: toastEl ? toastEl.textContent : '' };
})()`);
await sleep(400);
w = await walletRaw();
check('E2 申请制入账：50000+6666=56666 / 60000+8888=68888，rp-wallet 保持不动', w && w.gift && w.gift.myBalance === 56666 && w.gift.systemBalance === 68888 && w.rp && w.rp.myBalance === 1 && w.rp.systemBalance === 2, JSON.stringify(w));
s = await evalJs(`(function(){
  var mask = document.getElementById('modal-mask');
  var toastEl = document.getElementById('cc-toast');
  var stillOpen = !!(mask && !mask.hidden);
  var t = toastEl ? toastEl.textContent : '';
  if (stillOpen) { document.getElementById('modal-input').value = ''; document.getElementById('modal-ok').click(); }
  return { stillOpen: stillOpen, toast: t };
})()`);
await sleep(400);
let closed = await evalJs(`!(document.getElementById('modal-mask') && !document.getElementById('modal-mask').hidden)`);
check('E3 第二次打款提示「TA的心意币 +¥88.88」，留空点完成后弹窗关闭', s && s.stillOpen && s.toast === 'Mochi 已打款，TA的心意币 +¥88.88' && closed, JSON.stringify({ s, closed }));

// ---- N 组：非法金额拦截（申请需 >0） ----
s = await evalJs(`(function(){
  document.getElementById('rp-balance').click();
  document.getElementById('modal-input').value = '-5';
  document.getElementById('modal-ok').click();
  return 'neg';
})()`);
await sleep(400);
w = await walletRaw();
closed = await evalJs(`!(document.getElementById('modal-mask') && !document.getElementById('modal-mask').hidden)`);
check('N1 非法金额被拦截不落库并提示「申请金额需大于 0」，弹窗直接关闭', w && w.gift.myBalance === 56666 && w.gift.systemBalance === 68888 && closed, JSON.stringify({ w, closed }));

// ---- S 组：发红包走共用账本 + 卡片标签 ----
await evalJs(`(function(){
  var c = document.getElementById('chat-rp-close'); if (c) c.click();
  return 'panel-closed';
})()`);
await sleep(200);
await openRpPanel();
await sleep(400);
const bodyTextBefore = await evalJs(`(function(){
  var btn = document.querySelector('#chat-rp-panel .rp-amt[data-rpamt="5.20"]');
  if (btn) btn.click();
  var send = document.getElementById('rp-send-btn');
  if (send) send.click();
  var b = document.getElementById('chat-body') || document.querySelector('#page-chat');
  return b ? b.textContent.slice(-600) : '';
})()`);
await sleep(600);
w = await walletRaw();
s = await evalJs(`(function(){
  var cards = document.querySelectorAll('.msg-rp-card');
  var card = cards[cards.length - 1];
  if (!card) return null;
  return { label: card.querySelector('.msg-rp-label') ? card.querySelector('.msg-rp-label').textContent : '', amt: card.querySelector('.msg-rp-amt') ? card.querySelector('.msg-rp-amt').textContent : '' };
})()`);
check('S1 发红包后共用账本 myBalance 扣 5.20（56666→56146 分），rp-wallet 不动', w && w.gift.myBalance === 56146 && w.rp.myBalance === 1, JSON.stringify(w));
let gk = await evalJs(`({ root: !!localStorage.getItem('xy-home-v2:gift-wallet'), nsDef: localStorage.getItem('xy-home-v2:default:gift-wallet') })`);
check('S3 全局根键生效：读写走 xy-home-v2:gift-wallet，default 命名空间副本不再生成（跨桌面同一本账）', gk && gk.root && gk.nsDef === null, JSON.stringify(gk));
check('S2 红包消息卡片标签为「红包 · 心意币」+ 金额 ¥5.20', s && s.label === '红包 · 心意币' && s.amt === '¥5.20', JSON.stringify({ s, tail: String(bodyTextBefore).slice(-160) }));

// ---- R 组：TA 领取/退回消息为（心意币 ¥..）新格式 ----
let got = '';
for (let i = 0; i < 50; i++) {
  got = await evalJs(`(function(){
    var b = document.getElementById('chat-body') || document.querySelector('#page-chat');
    if (!b) return '';
    var t = b.textContent;
    var m1 = t.indexOf('TA 领取了你的红包（心意币 ¥5.20）');
    var m2 = t.indexOf('TA 退回了你的红包（心意币 ¥5.20）');
    if (m1 >= 0) return 'received';
    if (m2 >= 0) return 'returned';
    return '';
  })()`);
  if (got) break;
  await sleep(250);
}
check('R1 3~10 秒内出现新格式系统消息（TA 领取/退回 + 心意币 ¥5.20）', got === 'received' || got === 'returned', 'got=' + got);

// ---- K 组：TA 向 Mochi 申请 + 聊天记录两个流水区块 ----
await evalJs(`(function(){
  window.chatAddIn('', { special: 'askcoin', askFen: 1314, askTs: Date.now() });
  window.chatAddIn('', { special: 'redpacket', rpAmount: 66, rpWish: '测试', rpStatus: 'received', rpTs: Date.now() });
  return 'injected';
})()`);
await sleep(600);
let bodyHas = await evalJs(`(function(){
  var b = document.getElementById('chat-body') || document.querySelector('#page-chat');
  return b ? b.textContent.indexOf('向 Mochi 申请了心意币 ¥13.14') >= 0 : false;
})()`);
check('K2 聊天流出现 askcoin 居中卡（TA 向 Mochi 申请了心意币 ¥13.14）', bodyHas === true, String(bodyHas));
s = await evalJs(`(function(){
  var app = document.querySelector('.app[data-app="stats"]');
  if (!app) return { icon: false };
  app.click();
  var page = document.getElementById('page-stats');
  return { icon: true, pageHidden: page ? page.hidden : null };
})()`);
await sleep(800);
await evalJs(`(function(){
  var tab = document.querySelector('#page-stats .fav-tab[data-stab="chat"]');
  if (tab) tab.click();
  return 'tab';
})()`);
await sleep(500);
s = await evalJs(`(function(){
  var el = document.getElementById('st-chat-content');
  if (!el) return null;
  var t = el.textContent || '';
  return {
    // v3.16.x 重构：红包明细移至主页「心意币红包记录」，聊天记录页改为「我/联系人 发红包」双向摘要（累计心意币+次数）
    hasRpSec: t.indexOf('发红包') >= 0 && t.indexOf('累计心意币') >= 0,
    hasAskSec: t.indexOf('申请心意币记录') >= 0,
    rpRow: t.indexOf('¥66.00') >= 0,
    askRow: t.indexOf('+¥13.14') >= 0
  };
})()`);
check('K3 聊天记录页含「我/联系人 发红包」双向摘要 + 「联系人申请心意币记录」且两条注入可见', s && s.hasRpSec && s.hasAskSec && s.rpRow && s.askRow, JSON.stringify(s));

// ---- F 组：构建产物静态断言 ----
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  check('F1 产物含「向 Mochi 申请心意币」「红包 · 心意币」「输入金额（心意币）」', html.indexOf('向 Mochi 申请心意币') >= 0 && html.indexOf('红包 · 心意币') >= 0 && html.indexOf('输入金额（心意币）') >= 0, '');
  check('F2 产物已无旧「直接修改数值」口径文案', html.indexOf('修改钱包金额（元）') < 0 && html.indexOf('我的钱包金额（元）') < 0 && html.indexOf('修改心意币（元）') < 0 && html.indexOf('的钱包金额已更新') < 0, '');
  check('F3 TA自动申请已打包 + 聊天记录流水区块已打包（v3.16 摘要口径锚点）', html.indexOf('ml2_ask_daily_') >= 0 && html.indexOf('trySystemAskMochi') >= 0 && html.indexOf('statsFoldSection') >= 0 && html.indexOf('累计心意币') >= 0, '');
}

const errs = await evalJs('JSON.stringify(window.__errs || [])');
check('Z1 全程无 JS 异常', errs === '[]', String(errs));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

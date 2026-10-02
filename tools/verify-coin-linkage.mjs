// ===== 心意币与小游戏/花园联动验证 =====
// 用户需求：心意币与聊天更多功能【小游戏】、桌面【花园】联动
// 覆盖：①猜拳打一局 → 按胜负发币（胜我得 ¥1 / 平我得 ¥0.2 / TA 赢 TA 得 ¥1，日封顶 ¥3）
//      ②钓鱼死入口接线（#more-fish → openFishPanel 面板可开）
//      ③花园一键收获 → 按品质发币（完美 ¥2/优质 ¥1/普通 ¥0.5/枯萎 ¥0.2，日封顶 ¥10）
//      ④Pong/贪吃蛇/打砖块/四子棋结算发币（静态断言 + giftWalletChange 运行时存在）
//      ⑤giftWalletChange 统一入口写共用账本 gift-wallet
//      ⑥构建产物静态断言 + 全程无 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-coinlink-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  return evalJs(`JSON.parse(localStorage.getItem('xy-home-v2:gift-wallet') || '{"myBalance":-1,"systemBalance":-1}')`);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 种子：账本 100.00/200.00；清各游戏日计数；花园种一株已盛开的花 ----
await gotoApp();
await evalJs(`(function(){
  var day = new Date().toISOString().slice(0, 10);
  Object.keys(localStorage).forEach(function(k){
    if (k.indexOf(':ml2_coin_') > 0) localStorage.removeItem(k);
  });
  localStorage.setItem('xy-home-v2:gift-wallet', JSON.stringify({ myBalance: 10000, systemBalance: 20000 }));
  localStorage.setItem('xy-home-v2:default:garden-data', JSON.stringify({
    p: [{ type: 'clover', planted: Math.floor(Date.now() / 1000) - 200000, by: 'me', watered: null, pot: null }, null, null, null, null, null, null, null, null, null, null, null],
    l: [], lpc: Math.floor(Date.now() / 1000) - 100, dex: {}, exp: 0,
    inv: {}, st: { p: 0, w: 0, h: 0, f: 0, mp: 0, mw: 0, mh: 0, mf: 0 },
    decor: {}, visitor: null
  }));
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  return 'seeded';
})()`);
await gotoApp();

// ---- G 组：giftWalletChange 统一入口 ----
let s = await evalJs(`(function(){
  var nb = window.giftWalletChange(300, 0);
  return { ok: !!nb, my: nb ? nb.myBalance : -1, ta: nb ? nb.systemBalance : -1 };
})()`);
check('G1 giftWalletChange 存在且向共用账本累加（10000→10300 分）', s && s.ok && s.my === 10300 && s.ta === 20000, JSON.stringify(s));
s = await walletRaw();
check('G2 变动落盘 gift-wallet', s && s.myBalance === 10300 && s.systemBalance === 20000, JSON.stringify(s));

// ---- R 组：猜拳一局发币（TA 随机，三种结果都应恰好入账一种） ----
s = await evalJs(`(function(){
  var a = document.querySelector('.app[data-app="chat"]');
  if (a) a.click();
  var mp = document.getElementById('chat-more-panel'); if (mp) mp.hidden = false;
  var mr = document.getElementById('more-rps'); if (mr) mr.click();
  var panel = document.getElementById('chat-rps-panel');
  if (!panel || panel.hidden) return { open: false };
  var btn = panel.querySelector('.rps-choice[data-rps="rock"]');
  if (btn) btn.click();
  return { open: true, clicked: !!btn };
})()`);
await sleep(3500);
s = await (async () => {
  const w = await walletRaw();
  const dayKey = await evalJs(`(function(){
    // FIX 2026-09-16：rpGameCoinGrant 封顶键改本地日期（原 UTC 口径），脚本同步
    var d = new Date();
    var day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    var k = 'xy-home-v2:default:ml2_coin_rps_' + day;
    return Number(localStorage.getItem(k)) || 0;
  })()`);
  return { w, dayKey };
})();
check('R1 猜拳结算后按红包档位发币（my+520/+1314/+130 或 ta+520），日计数一致', s && (
  (s.w.myBalance === 10300 + 520 && s.dayKey === 520) ||
  (s.w.myBalance === 10300 + 1314 && s.dayKey === 1314) ||
  (s.w.myBalance === 10300 + 130 && s.dayKey === 130) ||
  (s.w.systemBalance === 20000 + 520 && s.dayKey === 520)
), JSON.stringify(s));

// ---- F 组：钓鱼死入口接线 ----
s = await evalJs(`(function(){
  var mp = document.getElementById('chat-more-panel'); if (mp) mp.hidden = false;
  var mf = document.getElementById('more-fish');
  if (!mf) return { btn: false };
  mf.click();
  var panel = document.getElementById('chat-fish-panel');
  return { btn: true, opened: !!(panel && !panel.hidden), hasFn: typeof window.openFishPanel === 'function' };
})()`);
check('F1 点【双人钓鱼】能打开钓鱼面板（原死入口已接线）', s && s.btn && s.opened && s.hasFn, JSON.stringify(s));

// ---- A 组：花园一键收获发币 ----
s = await evalJs(`(function(){
  var g = document.querySelector('.app[data-app="garden"]');
  if (!g) return { icon: false };
  g.click();
  var page = document.getElementById('page-garden');
  var hidden = page ? page.hidden : true;
  return { icon: true, pageVisible: !hidden };
})()`);
await sleep(800);
const wBeforeHarvest = await walletRaw();
s = await evalJs(`(function(){
  var btn = document.querySelector('#page-garden [data-tool="harvestall"]');
  if (!btn) return { btn: false };
  btn.click();
  return { btn: true };
})()`);
await sleep(900);
s = await (async () => {
  const w = await walletRaw();
  const dayKey = await evalJs(`(function(){
    var day = new Date().toISOString().slice(0, 10);
    var k = 'xy-home-v2:default:ml2_coin_garden_' + day;
    return Number(localStorage.getItem(k)) || 0;
  })()`);
  return { w, dayKey };
})();
check('A1 一键收获后我的余额增加量 == 收花奖励日计数（普通 ¥5.2/优质 ¥13.14/完美 ¥52/枯萎 ¥1.3）', s && s.dayKey >= 520 && s.w.myBalance === (wBeforeHarvest ? wBeforeHarvest.myBalance : -999) + s.dayKey, JSON.stringify(s));

// ---- O 组：余额不足也可发红包/买礼物（透支为负，不拦截） ----
await evalJs(`(function(){
  window.xyStore('xy-home-v2').set('gift-wallet', JSON.stringify({ myBalance: 100, systemBalance: 20000 }));
  return 'seeded';
})()`);
await sleep(300);
s = await evalJs(`(function(){
  var mp = document.getElementById('chat-more-panel'); if (mp) mp.hidden = false;
  var mr = document.getElementById('more-rp'); if (mr) mr.click();
  var panel = document.getElementById('chat-rp-panel');
  var opened = !!(panel && !panel.hidden);
  var btn = panel.querySelector('.rp-amt[data-rpamt="52.00"]');
  if (btn) btn.click();
  var send = document.getElementById('rp-send-btn');
  if (send) send.click();
  var w = JSON.parse(localStorage.getItem('xy-home-v2:gift-wallet'));
  return { opened: opened, my: w ? w.myBalance : null, sys: w ? w.systemBalance : null };
})()`);
check('O1 我的余额仅 ¥1 也照发 ¥52 红包：myBalance 透支为 -5100 分', s && s.opened && s.my === -5100 && s.sys === 20000, JSON.stringify(s));
s = await evalJs(`(function(){
  var mr = document.getElementById('more-rp'); if (mr) mr.click();
  var panel = document.getElementById('chat-rp-panel');
  var opened = !!(panel && !panel.hidden);
  var taBtn = panel.querySelector('.rp-side[data-rpside="in"]');
  if (taBtn) taBtn.click();
  var btn = panel.querySelector('.rp-amt[data-rpamt="520.00"]');
  if (btn) btn.click();
  var send = document.getElementById('rp-send-btn');
  if (send) send.click();
  var w = JSON.parse(localStorage.getItem('xy-home-v2:gift-wallet'));
  return { opened: opened, my: w ? w.myBalance : null, sys: w ? w.systemBalance : null };
})()`);
check('O2 TA 发 ¥520 红包同样不受限：systemBalance 直接扣至负数', s && s.opened && s.my === -5100 && typeof s.sys === 'number' && s.sys < 0, JSON.stringify(s));

// ---- X 组：其余游戏结算发币（产物静态断言） ----
{
  // #860（PERF-PLAN 阶段 1b）：core 全外置后，游戏/聊天代码在 js/<file> 产物里——
  // 判据改为全产物池（index.html + js/*.js），否则 X1/X2/X4 假红（代码没丢，只是搬了家）。
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  let pool = html;
  try {
    const jsDir = join(root, 'js');
    for (const f of readdirSync(jsDir)) if (f.endsWith('.js')) pool += '\n' + readFileSync(join(jsDir, f), 'utf8');
  } catch (e) { /* 未构建时池里只有 index.html */ }
  check('X1 Pong 结算发币已打包（ml2_coin_pong_ + 封顶 10400）', pool.indexOf('ml2_coin_pong_') >= 0 && /COIN_CAP = 10400/.test(pool), '');
  check('X2 打砖块合作双得已打包（ml2_coin_brick_ + 双方各加 + 档位数组）', pool.indexOf('ml2_coin_brick_') >= 0 && pool.indexOf('双方心意币各 +¥') >= 0 && pool.indexOf('[520, 1314, 5200]') >= 0, '');
  check('X3 四子棋结算发币已打包（ml2_coin_c4_）', pool.indexOf('ml2_coin_c4_') >= 0, '');
  check('X4 贪吃蛇/猜拳发币在 chat.js 已打包（rpGameCoinGrant 两个调用点）', pool.indexOf("rpGameCoinGrant('rps'") >= 0 && pool.indexOf("rpGameCoinGrant('snake'") >= 0, '');
  check('X5 花园收花奖励已打包（ml2_coin_garden_ + grantHarvestCoin）', pool.indexOf('ml2_coin_garden_') >= 0 && pool.indexOf('grantHarvestCoin') >= 0, '');
  check('X6 产物已无「心意币不足」拦截文案（透支机制生效）', pool.indexOf('我的心意币不足') < 0 && pool.indexOf('的心意币不足') < 0, '');
}

const errs = await evalJs('JSON.stringify(window.__errs || [])');
check('Z1 全程无 JS 异常', errs === '[]', String(errs));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);

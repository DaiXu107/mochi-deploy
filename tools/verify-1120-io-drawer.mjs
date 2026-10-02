// ===== 回归脚本：#1120 输入栏按钮位置 = 「边看边调」底部抽屉（+ #1052 面板图标剥隐形激活层）=====
// 用法：node tools/verify-1120-io-drawer.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-1120-io-drawer.mjs   （测临时构建副本，红绿对照）
// 需求（用户原话口径）：「输入栏按钮位置」原来那个面板是罩住整个设置页的居中弹层，改 ←/→
// 时根本看不到聊天输入栏＝不能边看边调。#1120 把它改成与「聊天美化」同款的底部抽屉：点开＝
// 切到聊天页（真实输入栏就是预览）、抽屉停在输入栏上方不盖住它、改一下就当场重排并高亮那一格、
// 离页自动收起、浮层让位由 csDrawerLayerTick 统一处理。
// #1052：面板图标是从聊天页真按钮 innerHTML 复制来的，device.js 的图片按钮里挂着
//   mochiFilePickLabel 造的 `label[data-file-pick-for]`（1px 裁剪、opacity:0 的隐形文件选择
//   激活层）——整份复制等于把「点一下弹相册」的击穿层带进面板。现改为克隆后剥掉该层再取图标。
// 断言面（全部为行为断言，A 轴只做静态接线）：
//   B1 点设置行开抽屉：抽屉在位（display:flex / !hidden）+ 列表 7 项 + 已切到聊天页
//   B2 抽屉不盖住真实输入栏（底边 ≤ 输入栏顶），也就是「边看边调」看得见的那一半
//   B3 改一次顺序：聊天页那排当场重排（order 值即时变）+ 刚移动的那格高亮 + 存档写入
//   B4 抽屉开着时背景锁住，且锁的就是这个抽屉（FLOAT_SELECTORS 登记跟着改名）
//   B5 抽屉内零枚隐形文件选择激活层，同时真输入栏那枚仍在（证明是「剥掉」不是「本来就没有」）
//   B6 离开聊天页 → 轮询自动收起抽屉并解锁（泛化到 io-order-drawer 的那条链路）
//   B7 点「完成」关抽屉 → 回到打开前的页面
//   B8 全程零 JS 异常
// RED 判别（HEAD 旧产物＝居中遮罩面板）：B1 拿不到 #io-order-drawer、B2 无停靠几何、
//   B3 面板内改完不即时重排且不高亮、B4 锁里登记的是旧遮罩 id、B5 面板图标里带 label 激活层、
//   B6 无轮询接管不收、B7 关面板不回页 → 逐条转红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const rd = (p) => { try { return readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };
const cs = rd('src/js/chat-settings.js'), ma = rd('src/js/mobile-adapt.js');

// ---- A 轴：静态接线（不 gate B 轴，红侧也要把行为差异跑出来）----
check('A1 抽屉挂进 csDrawerLayerTick 的泛化轮询（离页收起＋浮层让位共用一条链）',
  cs.includes("['chat-beauty-drawer', 'io-order-drawer'].forEach((id) => {"));
check('A2 滚动锁登记跟着改名到抽屉', ma.includes("'#io-order-drawer',"));
check('A3 面板图标剥掉隐形文件选择激活层', cs.includes("ic.querySelectorAll('label[data-file-pick-for]').forEach((l) => l.remove());"));
check('A4 落位＝键盘抬升与拖动偏移合并（抽屉不被键盘盖住、也不遮住输入栏）',
  cs.includes('const bot = Math.max(0, Math.max(ioDockBot, lift) + ioDragBot);'));

// ---- B 轴：真实浏览器行为 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  console.log('verify-1120-io-drawer: ' + results.filter(r => r.ok).length + '/' + results.length + '（A 轴）+ 环境不满足');
  process.exit(2);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10400 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1120v-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
          }
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      jsErrors.push((r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 200));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function bootToReady() {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(500);
  // 备份提醒条/弹窗会挂 scroll-lock，先收掉再测（同 verify-input-order 口径）
  await evalJs(`(function(){
    var m=document.getElementById('modal-mask');
    if (m && getComputedStyle(m).display !== 'none') {
      var c=document.getElementById('modal-cancel');
      if (c && !c.hidden) c.click(); else { var o=document.getElementById('modal-ok'); if (o) o.click(); }
    }
    var b=document.getElementById('backup-remind-bar'); if (b) { var x=b.querySelector('button'); if (x) x.click(); }
    return 1;
  })()`);
  await sleep(400);
}
// 开抽屉：聊天 app → 聊天设置 → 「消息」子标签 → 输入栏按钮位置行（真实入口链）
async function openDrawer() {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return 1;})()");
  await sleep(700);
  await evalJs("(function(){var s=document.getElementById('chat-settings-btn'); if(s) s.click(); return 1;})()");
  await sleep(450);
  await evalJs("(function(){var r=document.getElementById('cs-input-order'); if(r) r.click(); return 1;})()");
  // 抽屉的滚动锁靠 mobile-adapt 的巡检补挂（hidden 无变化不触发观察器），给足 1.3s
  await sleep(1300);
}
const PROBE = `(function(){
  var d=document.getElementById('io-order-drawer');
  var bar=document.querySelector('#page-chat > .chat-input-row');
  var br=bar?bar.getBoundingClientRect():null;
  var dr=d?d.getBoundingClientRect():null;
  var chat=document.getElementById('page-chat');
  var rows=d?d.querySelectorAll('[data-io-row]'):[];
  var order=function(row){ return Array.prototype.map.call(row?row.querySelectorAll('[data-io]'):[], function(e){ return e.getAttribute('data-io')+':'+e.style.order; }).join(','); };
  return JSON.stringify({
    open: !!(d && d.style.display === 'flex' && !d.hidden),
    onChat: !!(chat && !chat.hidden),
    n: rows.length,
    seq: Array.prototype.map.call(rows, function(r){ return r.getAttribute('data-io-row'); }).join(','),
    barVisible: !!(br && br.width > 0 && br.height > 0),
    dockClear: !!(dr && br && dr.bottom <= br.top + 2),
    drawerH: dr ? Math.round(dr.height) : -1,
    barTop: br ? Math.round(br.top) : -1,
    rowOrder: order(bar),
    // 高亮判定用计算后的背景色：border 简写会把每行的 style.borderColor 都填上（非高亮行也
    // 非空），只有高亮那一格才有那条浅蓝底 → 拿它当「跟着走」的凭据
    hl: Array.prototype.map.call(rows, function(r){ return r.getAttribute('data-io-row') + (getComputedStyle(r).backgroundColor.indexOf('74, 144, 217') >= 0 ? '*' : ''); }).join(','),
    pickLabels: d ? d.querySelectorAll('label[data-file-pick-for]').length : -1,
    srcLabels: bar && bar.querySelector('[data-io="img"]') ? bar.querySelector('[data-io="img"]').querySelectorAll('label[data-file-pick-for]').length : -1,
    lock: document.body.classList.contains('scroll-lock'),
    openList: (window.scrollLockInfo ? (window.scrollLockInfo() || {}).open || [] : []).join(','),
    perCid: localStorage.getItem('xy-home-v2:default:cs-input-order')
  });
})()`;

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1500);
  await evalJs("(function(){ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()");
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2300);
  await bootToReady();

  await openDrawer();
  let raw = await evalJs(PROBE);
  let o = null; try { o = JSON.parse(raw); } catch (e) {}
  check('B1 点设置行开的是「边看边调」抽屉：抽屉在位、已切到聊天页、列表 7 项',
    !!o && o.open === true && o.onChat === true && o.n === 7 &&
    o.seq === 'mic,continue,more,emoji,input,img,batch', raw);
  check('B2 抽屉停在真实输入栏上方（底边≤输入栏顶）且输入栏可见＝改哪看哪',
    !!o && o.barVisible === true && o.dockClear === true, raw);

  // B3 在抽屉里把「插入图片」左移一次：聊天页那排当场重排 + 高亮跟着走 + 存档写入
  await evalJs(`(function(){var r=document.querySelector('#io-order-drawer [data-io-row="img"] [data-io-move="-1"]'); if(r){r.click(); return 1;} return 0;})()`);
  await sleep(400);
  raw = await evalJs(PROBE);
  o = null; try { o = JSON.parse(raw); } catch (e) {}
  // 默认序 mic,continue,more,emoji,input,img,batch（order 10…70）→ img 与 input 换位：
  // img 下标 4＝50、input 下标 5＝60（chat.js applyInputBtnOrder 的 10+下标*10 口径）
  check('B3 抽屉内点一次左移：聊天页输入栏即时重排（img/input 的 order 当场互换）',
    !!o && /(^|,)img:50(,|$)/.test(o.rowOrder) && /(^|,)input:60(,|$)/.test(o.rowOrder), raw);
  check('B3b 刚移动的那一格高亮（看得见跟着走），其余格不高亮',
    !!o && o.hl === 'mic,continue,more,emoji,img*,input,batch', raw);
  check('B3c 顺序落进每联系人存档 cs-input-order',
    !!o && o.perCid === '["mic","continue","more","emoji","img","input","batch"]', raw);

  const b4 = await evalJs(`(function(){
    var d=document.getElementById('io-order-drawer');
    return JSON.stringify({ open: !!(d && d.style.display==='flex' && !d.hidden),
      lock: document.body.classList.contains('scroll-lock'),
      overflow: getComputedStyle(document.body).overflow,
      openList: (window.scrollLockInfo ? (window.scrollLockInfo() || {}).open || [] : []).join(',') });
  })()`);
  o = null; try { o = JSON.parse(b4); } catch (e) {}
  check('B4 抽屉开着时背景锁住，且锁清单里登记的是这个抽屉',
    !!o && o.open === true && o.lock === true && o.overflow === 'hidden' && o.openList.indexOf('#io-order-drawer') >= 0, b4);

  raw = await evalJs(PROBE);
  o = null; try { o = JSON.parse(raw); } catch (e) {}
  check('B5 抽屉图标剥掉隐形文件选择激活层（面板内 0 枚），真输入栏那枚仍在（≥1＝证明确实剥过）',
    !!o && o.pickLabels === 0 && o.srcLabels >= 1, raw);

  // 「收起」只在抽屉确实开着时才算数：先记下 B5 时它是否开着（否则红侧拿「元素根本不存在」
  // 也能混过 display!=='flex' 这条）
  const openedBefore = !!(o && o.open === true);
  // B6 离页自动收起：抽屉是挂 body 的固定层，切页不会跟着隐藏——csDrawerLayerTick 的 240ms
  //     轮询按「page-chat 是否可见」收它。这里复现用户走开后的页面状态（隐藏聊天页、显示桌面页）。
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-home');}); return 1;})()");
  await sleep(900);
  const b6 = await evalJs(`(function(){
    var d=document.getElementById('io-order-drawer');
    return JSON.stringify({ display: d?d.style.display:'gone', lock: document.body.classList.contains('scroll-lock'),
      page: (function(){ var p=document.querySelector('.page:not([hidden])'); return p?p.id:'none'; })() });
  })()`);
  o = null; try { o = JSON.parse(b6); } catch (e) {}
  // 解锁走 mobile-adapt 的巡检（display 变化不是观察器口径），给足 1.3s 再判
  await sleep(1300);
  const b6b = await evalJs(`(function(){ return JSON.stringify({ lock: document.body.classList.contains('scroll-lock'),
    openList: (window.scrollLockInfo ? (window.scrollLockInfo() || {}).open || [] : []).join(',') }); })()`);
  let o6b = null; try { o6b = JSON.parse(b6b); } catch (e) {}
  check('B6 切走聊天页后抽屉自动收起（不留盖在桌面上的僵尸层）',
    openedBefore === true && !!o && (o.display === 'none' || o.display === 'gone'), b6);
  // 断言口径＝「锁清单里不再有这个抽屉」而不是「body 不再锁」：底层可能另有常驻浮层
  //（如无头环境里偶尔开着的 #qa-mask）合法持锁，那种情况要求整页解锁是误判。
  check('B6b 收起后该抽屉从滚动锁清单里摘掉（不留残留锁）',
    !!o6b && o6b.openList.indexOf('#io-order-drawer') < 0, b6b);

  // B7 点「完成」：关抽屉并回到打开前的页面（聊天设置）
  await openDrawer();
  const b7 = await evalJs(`(function(){
    var d=document.getElementById('io-order-drawer');
    if (!d || d.style.display!=='flex') return 'drawer-not-open';
    var bs=d.querySelectorAll('button'), hit=false;
    for (var i=0;i<bs.length;i++){ if (bs[i].textContent==='完成'){ bs[i].click(); hit=true; break; } }
    return JSON.stringify({ hit: hit,
      page: (function(){ var p=document.querySelector('.page:not([hidden])'); return p?p.id:'none'; })() });
  })()`);
  o = null; try { o = JSON.parse(b7); } catch (e) {}
  check('B7 点「完成」关抽屉并回到打开前的页（聊天设置），不是停在聊天页',
    !!o && o.hit === true && o.page === 'page-chat-settings', b7);

  check('B8 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('B 轴执行异常：' + (e && e.message), false);
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const pass = results.filter(r => r.ok).length;
console.log('----');
console.log('verify-1120-io-drawer: ' + pass + '/' + results.length + (pass === results.length ? ' 全绿' : ' 有 FAIL'));
process.exit(pass === results.length ? 0 : 1);

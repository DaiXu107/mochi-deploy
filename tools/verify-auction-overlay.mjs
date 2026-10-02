// ===== 回归脚本：拍卖会「按钮没用+页面卡死」——#au-intro/#au-help 全屏浮层 hidden 救援（v3.26.x #331 修复） =====
// 用法：node build.mjs && node tools/verify-auction-overlay.mjs
// 背景（用户反馈：iQOO Neo10 Pro+ 雨见浏览器拍卖会按钮没用+页面卡死，明说其他设备型号也有）：
//   #321 全屏教学浮层用 ID 选择器 #au-intro,#au-help{display:flex;position:fixed;inset:0}——
//   ID 特异性压过 UA 的 [hidden]{display:none} 与 .pong-overlay[hidden] 救援 → hidden 属性失效，
//   不透明黑罩永远盖屏拦掉全站点击＝按钮全没用、页面像卡死（纯 CSS，全机型必现）。
// 修复：chat-pages.css 加 #au-intro[hidden], #au-help[hidden] { display:none; }（特异性 1,1,0 反压）。
// 验证（无头 Chrome 390×844 触摸仿真）：修复前产物 A2/B1 红（hidden=true 但 computed display 仍
//   flex、点击被浮层拦）；修复后全绿——开场只显教学层、点「开始拍卖」真收起、出价按钮点击生效、
//   详细玩法可开可关、关面板重开不残留。
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = 9750 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-auov-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

// 关开屏（clock.js 门控：滑到底 + 点「点击进入」）——不关它会盖在一切之上，命中断言全打到 splash 上
let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    // #384 强制公告：点进入后先滑到底 + 点确认才真正关闭 splash
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
      return 'mwait';
    }
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box');
    if (sb) sb.scrollTop = sb.scrollHeight;
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
const splashDiag = await evalJs(`(function(){
  var sp = document.getElementById('splash');
  var mm = document.getElementById('splash-mandatory');
  return { splashExists: !!sp, hasHide: sp ? sp.classList.contains('hide') : null,
           spHidden: sp ? sp.hidden : null, disp: sp ? getComputedStyle(sp).display : null,
           mandHidden: mm ? mm.hidden : null, mandExists: !!mm };
})()`);
chk('A0 开屏已关闭（否则命中断言全打到 splash）', splashClosed || splashDiag.disp === 'none' || splashDiag.spHidden === true, JSON.stringify(splashDiag));
await sleep(600);

// 进聊天页 → 种足心意币（防余额 0 把出价按钮 disabled）→ 从「更多功能」入口打开拍卖会
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1200);
await evalJs(`(function(){ try { window.giftWalletSet({ myBalance: 999900, systemBalance: 999900 }); } catch (e) { return 'ERR:' + e.message; } return 'ok'; })()`);
const opened = await evalJs(`(function(){
  var b = document.getElementById('more-auction');
  if (b) { b.click(); return 'btn'; }
  if (window.openAuctionPanel) { window.openAuctionPanel(); return 'api'; }
  return 'no-entry';
})()`);
await sleep(800);

const disp = (id) => `(function(){ var el = document.getElementById(${JSON.stringify(id)}); return el ? getComputedStyle(el).display : 'no-el'; })()`;
// 取元素中心点的实际命中元素（可判「有没有被浮层拦住点击」）
// 注意：不要 scrollIntoView——面板浮层是 position:fixed，滚动文档会造成坐标错位的测试假象
const hitAt = (id) => `(function(){
  var el = document.getElementById(${JSON.stringify(id)});
  if (!el || el.hidden) return 'no-el';
  var r = el.getBoundingClientRect();
  var hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return hit ? (hit.id || hit.className || hit.tagName) : 'none';
})()`;

// A) 开场：教学层显示、帮助层必须真隐藏（坏产物里 help 盖在 intro 上层＝用户看到的是死页面）
// 长跑期间 TA 主动行为（查岗 tc-mask/互动 qa-mask/来电 call-mask）会随机弹层抢 elementFromPoint——
// 每次命中断言前统一清场（直接 hidden，不走各模块关闭动画）
async function clearRandomMasks() {
  await evalJs(`(function(){
    ['tc-mask','qa-mask','call-mask','msg-actions','modal-mask'].forEach(function(id){
      var m = document.getElementById(id); if (m && !m.hidden) m.hidden = true;
    });
    var tp = document.getElementById('tc-panel'); if (tp) tp.hidden = true;
    return 1;
  })()`);
  await sleep(120);
}
const aIntro = await evalJs(disp('au-intro'));
const aHelp = await evalJs(disp('au-help'));
const aHelpAttr = await evalJs(`(function(){ var el = document.getElementById('au-help'); return el ? String(el.hidden) : 'no-el'; })()`);
chk('A1 打开拍卖会开场教学层显示', aIntro !== 'none' && aIntro !== 'no-el', 'display=' + aIntro);
chk('A2 帮助层 hidden=true 时 computed display=none（本修复核心；坏产物 flex=盖屏卡死）', aHelpAttr === 'true' && aHelp === 'none', 'hidden=' + aHelpAttr + ' display=' + aHelp);
await clearRandomMasks();
const aHit = await evalJs(hitAt('au-intro-start'));
const modalDiagA = await evalJs(`(function(){var m=document.getElementById('modal-mask');if(!m||m.hidden)return 'no-modal';var t=m.querySelector('.modal-title,cc-modal-title,.modal-box');return 'modal-open:'+(m.querySelector('.modal-title')?m.querySelector('.modal-title').textContent:(t?t.className:'?'));})()`);
chk('A3 教学层「开始拍卖」按钮可命中（不被别的层拦）', typeof aHit === 'string' && aHit.indexOf('au-intro-start') >= 0, 'hit=' + aHit + ' ' + modalDiagA);

// F) #341 「先不玩」出口：教学浮层盖住了头部 ✕，必须有自己的关闭出口
await clearRandomMasks();
const fHit = await evalJs(hitAt('au-intro-exit'));
chk('F1 「先不玩」按钮在教学中可命中', typeof fHit === 'string' && fHit.indexOf('au-intro-exit') >= 0, 'hit=' + fHit);
await evalJs(`(function(){ var b = document.getElementById('au-intro-exit'); if (b) b.click(); return 1; })()`);
await sleep(250);
const fClosed = await evalJs(`(function(){ var p = document.getElementById('chat-auction-panel'); return p ? String(p.hidden) : 'no-el'; })()`);
chk('F2 点「先不玩」直接收摊关面板', fClosed === 'true', 'panel.hidden=' + fClosed);
await evalJs(`(function(){ if (window.openAuctionPanel) window.openAuctionPanel(); return 1; })()`);
await sleep(400);
const fIntro = await evalJs(disp('au-intro'));
chk('F3 重开面板教学层照常出现', fIntro === 'flex', 'display=' + fIntro);

// B) 点「开始拍卖」：教学层必须真收起（坏产物 hidden 属性变了但视觉不动＝后续全点不到）
await evalJs(`(function(){ var b = document.getElementById('au-intro-start'); if (b) b.click(); return 1; })()`);
await sleep(300);
const bIntro = await evalJs(disp('au-intro'));
chk('B1 点开始拍卖后教学层 computed display=none（真收起）', bIntro === 'none', 'display=' + bIntro);
await clearRandomMasks();
const bHit = await evalJs(hitAt('au-bid1'));
chk('B2 出价按钮不被浮层拦截（elementFromPoint 命中自身）', typeof bHit === 'string' && bHit.indexOf('au-bid1') >= 0, 'hit=' + bHit);
const bDisabled = await evalJs(`(function(){ var b = document.getElementById('au-bid1'); return b ? String(b.disabled) : 'no-el'; })()`);
if (bDisabled === 'false') {
  await evalJs(`(function(){ var b = document.getElementById('au-bid1'); if (b) b.click(); return 1; })()`);
  await sleep(200);
  const st = await evalJs(`(function(){ var s = window.__auDebug && window.__auDebug.st(); return s ? JSON.stringify({ leader: s.leader, cur: s.cur, phase: s.phase }) : 'no-st'; })()`);
  let ok = false; try { const o = JSON.parse(st); ok = o.leader === 'you' && o.cur > 0; } catch (e) {}
  chk('B3 点「出 ¥x」出价生效（leader=you，按钮真的能用）', ok, 'st=' + st);
} else {
  chk('B3 点「出 ¥x」出价生效（leader=you，按钮真的能用）', false, 'bid1 disabled=' + bDisabled + '（钱包/场次态异常）');
}

// C) 详细玩法：可开可关（hidden 切换对两个浮层都必须生效）
await evalJs(`(function(){ var b = document.getElementById('au-help-btn'); if (b) b.click(); return 1; })()`);
await sleep(150);
const cOpen = await evalJs(disp('au-help'));
await evalJs(`(function(){ var b = document.getElementById('au-help-close'); if (b) b.click(); return 1; })()`);
await sleep(150);
const cClose = await evalJs(disp('au-help'));
chk('C1 详细玩法能打开', cOpen === 'flex', 'display=' + cOpen);
chk('C2 详细玩法能关上（点「知道啦」真收起）', cClose === 'none', 'display=' + cClose);

// D) 关面板重开：浮层不残留、直接回到可操作的竞价半框
await evalJs(`(function(){ if (window.closeAuctionPanel) window.closeAuctionPanel(); return 1; })()`);
await sleep(150);
await evalJs(`(function(){ if (window.openAuctionPanel) window.openAuctionPanel(); return 1; })()`);
await sleep(400);
const dIntro = await evalJs(disp('au-intro'));
const dHelp = await evalJs(disp('au-help'));
await clearRandomMasks();
const dHit = await evalJs(hitAt('au-pass'));
chk('D1 重开后教学/帮助层都不残留', dIntro === 'none' && dHelp === 'none', 'intro=' + dIntro + ' help=' + dHelp);
chk('D2 重开后「放弃这件」可命中（半框可直接继续操作）', typeof dHit === 'string' && dHit.indexOf('au-pass') >= 0, 'hit=' + dHit);

// E) #341 全屏真满屏：68% 半框规则用 :not(.game-fs) 限定后，⛶ 全屏高度必须回到视口高
await evalJs(`(function(){ var b = document.getElementById('au-fs'); if (b) b.click(); return 1; })()`);
await sleep(400);
const eFs = JSON.parse(await evalJs(`(function(){
  var p = document.getElementById('chat-auction-panel');
  var r = p.getBoundingClientRect();
  return JSON.stringify({ hasFs: p.classList.contains('game-fs'), maxH: getComputedStyle(p).maxHeight, h: Math.round(r.height), vh: innerHeight });
})()`));
chk('E1 全屏态挂 .game-fs', eFs.hasFs === true, JSON.stringify(eFs));
chk('E2 全屏态 max-height=none（坏产物 68%=半截屏；本修复核心断言）', eFs.maxH === 'none', 'maxH=' + eFs.maxH);
chk('E3 全屏高度占满视口（≥95%vh）', eFs.h >= Math.round(eFs.vh * 0.95), 'h=' + eFs.h + '/' + eFs.vh);
await evalJs(`(function(){ var b = document.getElementById('au-fs'); if (b) b.click(); return 1; })()`);
await sleep(400);
const eBack = await evalJs(`(function(){ var p = document.getElementById('chat-auction-panel'); return getComputedStyle(p).maxHeight; })()`);
chk('E4 退出全屏恢复 68% 半框', eBack === '68%', 'maxH=' + eBack);

// G1) #346 结算后开🎒「返回」= 回到本场结算汇总（旧版被背包顶掉后回不去）
await evalJs(`(function(){ var s = window.__auDebug && window.__auDebug.st(); if (s) { s.over = true; s.phase = 'idle'; } return 1; })()`);
await evalJs(`(function(){ var b = document.getElementById('au-bag'); if (b) b.click(); return 1; })()`);
await sleep(200);
const g1Btn = await evalJs(`(function(){ var b = document.getElementById('au-btn-start'); return b ? b.textContent : 'no-el'; })()`);
await evalJs(`(function(){ var b = document.getElementById('au-btn-start'); if (b) b.click(); return 1; })()`);
await sleep(250);
const g1Title = await evalJs(`(function(){ var t = document.getElementById('au-ov-title'); var o = document.getElementById('au-overlay'); return (t ? t.textContent : '') + '|' + (o ? String(o.hidden) : '?'); })()`);
chk('G1 结算后背包按钮统一为「返回」', g1Btn === '返回', 'btn=' + g1Btn);
chk('G1 返回后回到「本场结束」结算汇总', g1Title.indexOf('本场结束') >= 0 && g1Title.indexOf('false') > 0, 'got=' + g1Title);

// G2) #346 音效开关持久化
await evalJs(`(function(){ var b = document.getElementById('au-sound'); if (b) b.click(); return 1; })()`);
await sleep(100);
const g2a = await evalJs(`(function(){ try { return localStorage.getItem('xy-home-v2:au-sound'); } catch (e) { return 'ERR'; } })()`);
await evalJs(`(function(){ var b = document.getElementById('au-sound'); if (b) b.click(); return 1; })()`);
await sleep(100);
const g2b = await evalJs(`(function(){ try { return localStorage.getItem('xy-home-v2:au-sound'); } catch (e) { return 'ERR'; } })()`);
chk('G2 音效开关写入偏好（关=0 开=1）', g2a === '0' && g2b === '1', 'after=' + g2a + '/' + g2b);

// G3) #346 转赠先弹全站确认，确认后才真送出
await evalJs(`(function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  localStorage.setItem(pre + ':auction-items', JSON.stringify([{ ico: '🌹', name: '测试玫瑰', fen: 520, ts: Date.now() }]));
  return 1;
})()`);
await evalJs(`(function(){ var b = document.getElementById('au-bag'); if (b) b.click(); return 1; })()`);
await sleep(250);
await evalJs(`(function(){ var b = document.querySelector('#au-overlay .au-send-btn'); if (b) b.click(); return 1; })()`);
await sleep(300);
const g3Modal = JSON.parse(await evalJs(`(function(){
  var m = document.getElementById('modal-mask');
  var s = document.getElementById('modal-static');
  return JSON.stringify({ open: !!m && !m.hidden, text: s ? s.textContent : '' });
})()`));
await evalJs(`(function(){ var b = document.getElementById('modal-ok'); if (b) b.click(); return 1; })()`);
await sleep(400);
const g3Bag = await evalJs(`(function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  try { return JSON.parse(localStorage.getItem(pre + ':auction-items') || '[]').length; } catch (e) { return -1; }
})()`);
chk('G3 送TA先弹确认弹窗（含拍品名）', g3Modal.open === true && g3Modal.text.indexOf('测试玫瑰') >= 0, g3Modal);
chk('G3 确认后拍品真移出收藏', g3Bag === 0, 'bagLen=' + g3Bag);
// 收尾清场：关掉可能残留的全站弹窗、退回竞价主视图（au-bag 是 toggle，盲点会把已关的背包又打开盖住出价键）
await evalJs(`(function(){
  var m = document.getElementById('modal-mask');
  if (m && !m.hidden) { var c = document.getElementById('modal-cancel') || document.getElementById('modal-close'); if (c) c.click(); }
  var s = document.getElementById('au-btn-start'); if (s) s.click();
  return 1;
})()`);
await sleep(300);

// G4) #346 余额不足给提示行（不再静默置灰）
await evalJs(`(function(){ var b = document.getElementById('au-btn-start'); if (b) b.click(); return 1; })()`);
await sleep(250); // 背包「返回」→ 回到本场汇总
await evalJs(`(function(){ var b = document.getElementById('au-btn-start'); if (b) b.click(); return 1; })()`);
await sleep(300); // 汇总「再来一场」→ 开新场进入竞价
await evalJs(`(function(){ try { window.giftWalletSet({ myBalance: 100, systemBalance: 100 }); } catch (e) {} return 1; })()`);
await evalJs(`(function(){ if (window.openAuctionPanel) window.openAuctionPanel(); return 1; })()`);
await sleep(300);
const g4a = JSON.parse(await evalJs(`(function(){
  var h = document.getElementById('au-wallet-hint');
  return JSON.stringify({ exists: !!h, hidden: h ? !!h.hidden : null, text: h ? h.textContent : '' });
})()`));
await evalJs(`(function(){ try { window.giftWalletSet({ myBalance: 999900, systemBalance: 999900 }); } catch (e) {} return 1; })()`);
await evalJs(`(function(){ if (window.openAuctionPanel) window.openAuctionPanel(); return 1; })()`);
await sleep(300);
const g4b = await evalJs(`(function(){ var h = document.getElementById('au-wallet-hint'); return h ? String(!!h.hidden) : 'no-el'; })()`);
chk('G4 余额不足时提示行出现（含指引文案）', g4a.exists === true && g4a.hidden === false && g4a.text.indexOf('心意币不够') >= 0, g4a);
chk('G4 余额恢复后提示行收起', g4b === 'true', 'hidden=' + g4b);

// G5) #346 TA 掂量中从背包返回，文案按真实回合态
await evalJs(`(function(){ var b = document.getElementById('au-bid1'); if (b) b.click(); return 1; })()`);
await sleep(120);
await evalJs(`(function(){ var b = document.getElementById('au-bag'); if (b) b.click(); return 1; })()`);
await sleep(100);
await evalJs(`(function(){ var b = document.getElementById('au-btn-start'); if (b) b.click(); return 1; })()`);
await sleep(100);
const g5 = await evalJs(`(function(){ var s = document.getElementById('au-status'); return s ? s.textContent : ''; })()`);
chk('G5 TA 掂量中返回＝「正在掂量你的出价」文案', g5.indexOf('掂量') >= 0, 'status=' + g5);

// G6) #346 矮屏（横屏）半框提到 82%
await cdp('Emulation.setDeviceMetricsOverride', { width: 844, height: 430, deviceScaleFactor: 2, mobile: true });
await sleep(400);
const g6 = await evalJs(`(function(){
  var p = document.getElementById('chat-auction-panel');
  var r = p.getBoundingClientRect();
  return JSON.stringify({ h: Math.round(r.height), vh: innerHeight, ratio: +(r.height / innerHeight).toFixed(2) });
})()`);
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
chk('G6 矮屏半框高度占比 ≥78%（旧版 68% 太挤）', (() => { try { return JSON.parse(g6).ratio >= 0.78; } catch (e) { return false; } })(), g6);

// H1) #348 长按出价键弹自定义出价，确认后直接压价
// 确定性：开 fast 模式（TA 思考 42~87ms），压价值取「TA 心理价位+¥5」→ TA 必立即放手，
// leader 保持 you、cur 精确等于压价值（taThink 两个分支都不改 cur）
// 前置保证：G 组跑完后本场可能已落槌（phase=done，出价键失效＝间歇红根因）——重试循环内
// 每次先确保在竞价中（不在就 newSession），长按后校验弹窗；失败清按住态再试（最多 3 次）
let h1modal = null;
for (let attempt = 0; attempt < 3; attempt++) {
  await evalJs(`(function(){
    window.__auDebug.fast = true;
    var s = window.__auDebug.st();
    if (!s || !s.started || s.over || s.phase !== 'bidding') window.__auDebug.newSession();
    return (window.__auDebug.st() || {}).phase;
  })()`);
  await sleep(600); // 等新一场首件拍品进入 bidding
  await evalJs(`(function(){ var b = document.getElementById('au-bid1'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return 1; })()`);
  await sleep(800);
  h1modal = await evalJs(`(function(){
    var m = document.getElementById('modal-mask');
    var t = document.getElementById('modal-title');
    return JSON.stringify({ open: !!m && !m.hidden, title: t ? t.textContent : '' });
  })()`);
  let opened = false;
  try { const o = JSON.parse(h1modal); opened = o.open && o.title.indexOf('自定义出价') >= 0; } catch (e) {}
  if (opened) break;
  // 清按住态与残留弹窗后重试
  await evalJs(`(function(){
    var b = document.getElementById('au-bid1'); if (b) b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    var m = document.getElementById('modal-mask'); if (m && !m.hidden) { var c = document.getElementById('modal-cancel') || document.getElementById('modal-close'); if (c) c.click(); }
    return 1;
  })()`);
  await sleep(300);
}
const h1before = await evalJs(`(function(){
  var s = window.__auDebug.st();
  var fen = Math.max(s.limit, s.cur + 100) + 500;
  document.getElementById('modal-input').value = (fen / 100).toFixed(2);
  document.getElementById('modal-ok').click();
  return fen;
})()`);
await sleep(600);
const h1st = await evalJs(`(function(){ var s = window.__auDebug.st(); return JSON.stringify({ cur: s.cur, leader: s.leader, phase: s.phase }); })()`);
chk('H1 长按出价键弹出「自定义出价」', (() => { try { const o = JSON.parse(h1modal); return o.open === true && o.title.indexOf('自定义出价') >= 0; } catch (e) { return false; } })(), h1modal);
chk('H1 确认后价格压到自定义价且 leader=you', (() => { try { const o = JSON.parse(h1st); return o.leader === 'you' && o.cur === h1before; } catch (e) { return false; } })(), h1st + ' wantCur=' + h1before);

// H2) #348 自制拍品：编辑台添加 → 奖池合并 → idb 双写 → 库条删除（#1041 起三步纯文字弹窗退役，改走全屏编辑台）
await evalJs(`(function(){ var b = document.getElementById('au-add'); if (b) b.click(); return 1; })()`);
await sleep(250);
await evalJs(`(function(){
  var n = document.getElementById('au-ed-name'); if (!n) return 0;
  n.value = '自定义拍品A'; n.dispatchEvent(new Event('input', { bubbles: true }));
  var d = document.getElementById('au-ed-desc'); d.value = '一句话介绍'; d.dispatchEvent(new Event('input', { bubbles: true }));
  var p = document.getElementById('au-ed-base'); p.value = '12.34'; p.dispatchEvent(new Event('input', { bubbles: true }));
  var w = document.getElementById('au-ed-wish'); w.value = '测试彩蛋'; w.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('au-ed-save').click(); return 1;
})()`);
await sleep(400);
const h2a = JSON.parse(await evalJs(`(async function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  var loc = JSON.parse(localStorage.getItem(pre + ':auction-custom') || '[]').length;
  var idbN = -1;
  try { var v = await window.idbGet(pre + ':auction-custom'); idbN = Array.isArray(v) ? v.length : -1; } catch (e) {}
  return JSON.stringify({ loc: loc, idb: idbN, pool: window.__auDebug.poolSize() });
})()`));
// 再开编辑台 → 点库条 chip 进编辑态 → 删除 → 确认弹窗点「删除」
await evalJs(`(function(){ var b = document.getElementById('au-add'); if (b) b.click(); return 1; })()`);
await sleep(250);
await evalJs(`(function(){ var c = document.querySelector('#au-ed-lib .au-ed-chip'); if (c) c.click(); return 1; })()`);
await sleep(200);
await evalJs(`(function(){ var d = document.getElementById('au-ed-del'); if (d) d.click(); return 1; })()`);
await sleep(300);
await evalJs(`(function(){ var b = document.getElementById('modal-ok'); if (b) b.click(); return 1; })()`);
await sleep(300);
const h2b = JSON.parse(await evalJs(`(function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  return JSON.stringify({ loc: JSON.parse(localStorage.getItem(pre + ':auction-custom') || '[]').length, pool: window.__auDebug.poolSize() });
})()`));
chk('H2 自制拍品编辑台添加成功（本地+idb 双写+奖池 12→13）', h2a.loc === 1 && h2a.idb === 1 && h2a.pool === 13, JSON.stringify(h2a));
chk('H2 库条点选删除（确认后奖池回落 12）', h2b.loc === 0 && h2b.pool === 12, JSON.stringify(h2b));

// H3) #348 拍卖记录页：评级标签 + 明细渲染
await evalJs(`(function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  localStorage.setItem(pre + ':auction-history', JSON.stringify([
    { t: Date.now(), ico: '💎', name: '小钻戒', price: 9999, who: 'you', rarity: 'SSR' },
    { t: Date.now() - 86400000, ico: '🌹', name: '永生玫瑰', price: 520, who: 'pass', rarity: '普通' }
  ]));
  var b = document.getElementById('au-history');
  if (b) b.click();
  return 1;
})()`);
await sleep(300);
const h3 = JSON.parse(await evalJs(`(function(){
  var o = document.getElementById('au-overlay');
  var t = document.getElementById('au-ov-title');
  var b = document.getElementById('au-ov-body');
  return JSON.stringify({ open: !!o && !o.hidden, title: t ? t.textContent : '', body: b ? b.textContent : '' });
})()`));
chk('H3 记录页打开（标题含拍卖记录）', h3.open === true && h3.title.indexOf('拍卖记录') >= 0, h3.title);
chk('H3 记录明细含评级与条目（SSR/小钻戒/流拍）', h3.body.indexOf('SSR') >= 0 && h3.body.indexOf('小钻戒') >= 0 && h3.body.indexOf('流拍') >= 0, h3.body.slice(0, 80));

console.log('入口=' + opened + '  结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);

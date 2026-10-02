// ===== 回归脚本：聊天里打开占卜「抽牌时半框自动退出」（#1207）=====
// 报障（用户实报 2026-09-24）：「聊天里打开占卜功能会在抽牌的时候自动退出」。
// 根因：#906 给占卜半框挂了「点半框外关闭」分派器 window.mochiSheetOutsideClose，判据是事件冒泡到
//   document 那刻实时读 panel.contains(e.target)。而抽牌的牌背点击处理器（divination.js 共用引擎
//   startDivineDraw 的 pick）在同一次派发里就把被点的牌背移出 DOM（增量 removeChild；#1044 之前是
//   整堆 innerHTML='' 重建，同样会摘走被点节点）⇒ 冒泡到 document 时 contains 恒为假 ⇒
//   「点牌背抽一张」被误判成「点半框外」，整框当场收掉。400ms「刚开即关」闩拦不住：牌堆最早 1750ms 后出现。
// 修法：点外判定改按事件派发时的路径 e.composedPath()（不含运行期 DOM 变更的影响），路径缺失时回落 contains。
//   一处收口＝占卜/问问TA/聊天记录/猜拳/红包/帮我决定/多人决定/送礼/头像互动全族同修。
// 判别力：红侧＝纯 HEAD 产物（A 组抽牌断言必红）；绿侧＝带 #1207 修复的构建。
//   B 组是「防修过头」闸（真点框外仍要关、面板内其它元素不关），两侧同绿。
// 用法：node build.mjs && node tools/verify-1207-divine-draw-close.mjs
//      SERVE_ROOT=<隔离构建目录> 指定被测产物
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end(); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9870 + Math.floor(Math.random() * 100);
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-1207-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'
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
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// —— S 组：产物锚点（core 外置后 chat.js 落点是 js/<file>，与内联旧形态并集查找）——
const artifact = readFileSync(join(root, 'index.html'), 'utf8');
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const chatText = rd('js/chat.js') + artifact;
chk('S0 产物含点外关闭分派器（#906 前提）', chatText.includes('window.mochiSheetOutsideClose = function (panel, close)'), '');
// 修复的逻辑锚点：按派发时路径判内外，而不是只读实时 contains
chk('S1 点外判定走事件派发路径 composedPath', chatText.includes('composedPath'), '');
chk('S2 仍保留 contains 兜底（无 composedPath 的内核）', /panel\.contains\(t\)/.test(chatText), '');
// 共用抽牌引擎确实存在（本批不动它，只做取证前提）
chk('S3 抽牌引擎为两处共用且牌背按增量摘除', (rd('js/divination.js') + artifact).includes('pileEls.splice(idx, 1)'), '');

// —— 清场：开屏 / 首启模态 / 备份提醒条 ——
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
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
await evalJs(`(function(){
  var mm=document.getElementById('splash-mandatory'); if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men)men.click();mm.hidden=true;}
  var sp=document.getElementById('splash'); if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}
  var qm=document.getElementById('qa-mask'); if(qm)qm.hidden=true;
  var bk=document.getElementById('backup-remind-bar'); if(bk)bk.hidden=true;
  var md=document.getElementById('modal-mask'); if(md){md.hidden=true;}
  return true;})()`);
await sleep(600);
await evalJs('window.enterChat(); true');
await sleep(1200);

const sweepMasks = () => evalJs(`(function(){
  document.querySelectorAll('.modal-mask').forEach(function(m){m.hidden=true;});
  var qm=document.getElementById('qa-mask'); if(qm)qm.hidden=true;
  var bk=document.getElementById('backup-remind-bar'); if(bk)bk.hidden=true;
  try{document.body.classList.remove('scroll-lock');}catch(e){}
  return true;})()`);
const isOpen = (id) => evalJs(`(function(){var e=document.getElementById(${JSON.stringify(id)});return e?!e.hidden:null;})()`);

async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t + 0.08, touchPoints: [] });
}
// 真点某个选择器的第 index 个元素：滚进视野 → 量中心点 → 确认 elementFromPoint 命中它或其后代 → 派发真实 touch
async function tapEl(sel, index) {
  const b = await evalJs(`(function(){
    var els=document.querySelectorAll(${JSON.stringify(sel)}); if(!els.length) return null;
    var el=els[${index || 0}];
    try{ el.scrollIntoView({block:'center'}); }catch(e){}
    var r=el.getBoundingClientRect();
    if(!r.width||!r.height) return null;
    return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};
  })()`);
  if (!b) return null;
  await sleep(120);
  const hit = await evalJs(`(function(){
    var el=document.elementFromPoint(${b.x},${b.y});
    var target=document.querySelectorAll(${JSON.stringify(sel)})[${index || 0}];
    return !!(el&&target&&(el===target||target.contains(el)||el.contains(target)));
  })()`);
  if (!hit) return null;
  await tap(b.x, b.y);
  return b;
}

// 等牌库就绪（半框抽牌读 window.__TAROT__）
let deckReady = false;
for (let i = 0; i < 40 && !deckReady; i++) {
  deckReady = await evalJs('(function(){return !!(window.__TAROT__&&window.__TAROT__.length>=78);})()') === true;
  if (!deckReady) await sleep(250);
}
chk('前置 塔罗 78 张牌库就绪', deckReady, '');

// —— A 组：用户报障本体（真入口开半框 → 抽牌 → 逐张点牌背）——
await sweepMasks();
await evalJs("(function(){var b=document.getElementById('more-divine');if(b){b.click();return true;}return false;})()");
await sleep(800); // 越过「刚开 400ms」闩
const opened = await isOpen('chat-divine-panel');
chk('A1 聊天「更多」→占卜，半框已打开', opened === true, JSON.stringify(opened));

const drawTap = await tapEl('#div-chat-draw', 0);
chk('A2 前置 抽牌按钮可真点', !!drawTap, JSON.stringify(drawTap));
if (!drawTap) {
  await evalJs("(function(){var b=document.getElementById('div-chat-draw');if(b)b.click();return true;})()");
}
await sleep(300);
chk('A3 洗牌动画期间半框不关', await isOpen('chat-divine-panel') === true, '');

// 等牌堆出现（引擎：1750ms 后建两行牌背）
let pileN = 0;
for (let i = 0; i < 30 && !pileN; i++) {
  pileN = await evalJs("(function(){return document.querySelectorAll('#div-chat-result .div-pile-card').length;})()") || 0;
  if (!pileN) await sleep(250);
}
chk('A4 牌堆已铺开（牌背出现）且半框仍在', pileN > 0 && await isOpen('chat-divine-panel') === true, 'pileN=' + pileN);

// 逐张真点牌背：默认 3 张牌阵
const drawn = [], pileLeft = [];
for (let k = 0; k < 3; k++) {
  const t = await tapEl('#div-chat-result .div-pile-card', 0);
  if (!t) { drawn.push(null); pileLeft.push(null); break; }
  await sleep(220);
  const st = await evalJs(`(function(){
    var p=document.getElementById('chat-divine-panel');
    return {open: p ? !p.hidden : null,
      drawnN: document.querySelectorAll('#div-chat-result .div-drawn-card').length,
      pileN: document.querySelectorAll('#div-chat-result .div-pile-card').length,
      page: (function(){var v='';document.querySelectorAll('.page').forEach(function(x){if(!x.hidden)v=x.id;});return v;})()};
  })()`);
  drawn.push(st); pileLeft.push(st);
}
const third = drawn[2];
chk('A5 点第 1 张牌背后半框不关（用户报「抽牌时自动退出」）', drawn[0] && drawn[0].open === true, JSON.stringify(drawn[0]));
chk('A6 三张牌背逐张点完，半框始终不关', drawn.length === 3 && drawn.every((s) => s && s.open === true), JSON.stringify(drawn));
chk('A7 已抽张数如实推进到 3', third && third.drawnN === 3, JSON.stringify(third));
chk('A8 牌堆按增量减少（抽 3 张少 3 张）', pileN > 3 && third && third.pileN === pileN - 3, 'pileN=' + pileN + ' → ' + JSON.stringify(third && third.pileN));
chk('A9 抽牌全程停在聊天页（没被切去别的页/桌面）', drawn.every((s) => s && s.page === 'page-chat'), JSON.stringify(drawn.map((s) => s && s.page)));

await sleep(900); // onDone：550ms 后渲染结果
const res = await evalJs(`(function(){
  var p=document.getElementById('chat-divine-panel');
  var r=document.getElementById('div-chat-result');
  return {open: p ? !p.hidden : null, minis: r ? r.querySelectorAll('.div-mini').length : -1,
    hasSummary: !!(r && r.querySelector('.div-summary')), copyBtn: !!(r && r.querySelector('#div-chat-copy-btn'))};
})()`);
chk('A10 抽满后结果就地渲染（3 张牌面＋综合＋复制键）', res.minis === 3 && res.hasSummary && res.copyBtn, JSON.stringify(res));
chk('A11 结果渲染后半框仍在（自动发送/存记录都没把框收掉）', res.open === true, JSON.stringify(res));

// —— B 组：防修过头闸（真·点框外仍要关；面板内其它元素不关）——
await sweepMasks();
await sleep(150);
const blank = await evalJs(`(function(){
  var list=document.getElementById('chat-body')||document.querySelector('.chat-main');
  if(!list)return null;
  var r=list.getBoundingClientRect();
  var cands=[[r.left+r.width/2,r.top+Math.min(40,r.height*0.08)],[r.left+r.width*0.5,r.top+r.height*0.15],[r.left+30,r.top+r.height*0.12],[r.left+r.width-30,r.top+r.height*0.2]];
  for(var i=0;i<cands.length;i++){var x=Math.round(cands[i][0]),y=Math.round(cands[i][1]);
    var el=document.elementFromPoint(x,y);
    if(el&&!el.closest('.msg-bubble')&&!el.closest('.poke-card')&&!el.closest('.modal-mask')&&!el.closest('button')&&!el.closest('.ch-input-bar'))return {x:x,y:y};}
  return null;
})()`);
chk('B1 前置 找到半框外空白点', !!blank, JSON.stringify(blank));
if (blank) {
  await tap(blank.x, blank.y);
  await sleep(400);
  chk('B2 真点半框外空白 → 占卜半框关闭（#906 能力不得丢）', await isOpen('chat-divine-panel') === false, JSON.stringify(blank));
}

// B3 通用判据（分派器级，与占卜解耦）：自注册一枚探针半框，其内部按钮点一下就把自己移出 DOM
const probe = await evalJs(`(function(){
  if (typeof window.mochiSheetOutsideClose !== 'function') return null;
  var panel=document.createElement('div');
  panel.id='probe-1207-panel'; panel.className='poke-card'; panel.style.cssText='position:fixed;left:0;right:0;bottom:0;height:220px;z-index:99998;background:#fff';
  var btn=document.createElement('button'); btn.id='probe-1207-btn'; btn.textContent='抽一张';
  btn.style.cssText='width:120px;height:60px;margin:60px auto;display:block';
  panel.appendChild(btn); document.body.appendChild(panel);
  window.__probe1207={closed:0};
  window.mochiSheetOutsideClose(panel, function(){ window.__probe1207.closed++; panel.hidden=true; });
  panel.hidden=false;
  var r=btn.getBoundingClientRect();
  return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};
})()`);
chk('B3 前置 探针半框已挂载（走分派器注册）', !!probe, JSON.stringify(probe));
if (probe) {
  await sleep(500);
  // 处理器里同步摘掉被点节点＝与抽牌牌背同一形态
  await evalJs(`(function(){
    var b=document.getElementById('probe-1207-btn');
    b.addEventListener('click', function(){ b.parentNode.removeChild(b); });
    return true;
  })()`);
  await tap(probe.x, probe.y);
  await sleep(400);
  chk('B4 点「会自我摘除的面板内元素」→ 探针半框不关（根因判据）', await evalJs('(function(){return window.__probe1207.closed;})()') === 0, '');
  await sweepMasks();
  // 点外坐标要复核命中：A 组在红/绿两侧走到的界面状态不同（红侧第一记就把框关了），
  // 固定偏移的坐标可能正落在气泡/按钮上（那里有各自的 stopPropagation），会假红
  const out = await evalJs(`(function(){
    var panel=document.getElementById('probe-1207-panel');
    var list=document.getElementById('chat-body')||document.querySelector('.chat-main');
    if(!panel||!list)return null;
    var r=list.getBoundingClientRect();
    var cands=[[r.left+r.width/2,r.top+Math.min(40,r.height*0.08)],[r.left+r.width*0.5,r.top+r.height*0.15],[r.left+30,r.top+r.height*0.12],[r.left+r.width-30,r.top+r.height*0.2],[r.left+r.width/2,r.top+6]];
    for(var i=0;i<cands.length;i++){var x=Math.round(cands[i][0]),y=Math.round(cands[i][1]);
      var el=document.elementFromPoint(x,y);
      if(!el||el.closest('.poke-card')||el.closest('#probe-1207-panel')||el.closest('.msg-bubble')||el.closest('.modal-mask')||el.closest('button')||el.closest('.ch-input-bar'))continue;
      return {x:x,y:y,hit:(el.tagName||'')+'.'+(el.className||'')};}
    return null;
  })()`);
  chk('B5 前置 找到探针半框外空白点', !!out, JSON.stringify(out));
  if (out) await tap(out.x, out.y);
  await sleep(400);
  chk('B5 点探针半框之外 → 仍会关闭', await evalJs('(function(){return window.__probe1207.closed;})()') === 1, JSON.stringify(out));
  await evalJs("(function(){var p=document.getElementById('probe-1207-panel');if(p)p.remove();return true;})()");
}

// B6 面板内其它元素（模式页签）真点 → 不关
await evalJs("(function(){var p=document.getElementById('chat-divine-panel');if(p)p.hidden=false;return true;})()");
await sleep(600);
const tabTap = await tapEl('#chat-divine-panel .div-mode', 0);
if (!tabTap) chk('B6 前置 半框内页签可定位', false, '');
else {
  await sleep(300);
  chk('B6 点半框内页签 → 不关闭', await isOpen('chat-divine-panel') === true, JSON.stringify(tabTap));
}
await evalJs("(function(){var p=document.getElementById('chat-divine-panel');if(p)p.hidden=true;return true;})()");

console.log('\n== verify-1207-divine-draw-close: 通过 ' + pass + ' / 失败 ' + fail + ' ==');
try { server.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(fail ? 1 : 0);

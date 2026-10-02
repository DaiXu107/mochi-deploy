// ===== 回归脚本：聊天底部半框「点半框外关闭」缺网补齐（#906）=====
// 背景（用户报障 #906）：【帮我决定】【群聊决定（多人决定）】打开后「点击屏幕其他地方无法关闭功能页面」，
//   并要求核查其他功能按钮是否有同问题。核查结论：同族 .poke-card 底半框里，拍一拍/表情包/更多功能/批量/
//   语音/寻踪/消息菜单/群聊两菜单各自早挂了 document click 点外关闭（#481/#529），而帮我决定、多人决定、
//   占卜、问问TA、聊天记录搜索、猜拳、红包、送礼、头像互动这九枚从来没有——点外没有任何关闭路径，只能点 ✕。
// 修法：src/js/chat.js 收一份分派器 window.mochiSheetOutsideClose(panel, close)（刚开 400ms 内不算点外＝防
//   「刚开即关」；落在 .modal-mask 上不算点外＝防点弹窗把底下半框连带收掉；点面板内部不关），
//   聊天页五枚在 chat.js 接入，帮我决定/多人决定/送礼/头像互动在各自文件接入。
//   刻意不接入：通话半框 #chat-call-panel 与小游戏对局半框（长按气泡弹消息菜单的一点就把通话关掉/对局弃掉）。
// 判别力（SERVE_ROOT 指向纯 HEAD 红副本实测）：红的正是用户报的缺陷面（T1/T3b/T4/T6~T11 点外不关），
//   T2/T3a/T5/T12 两侧同绿＝它们是「防修过头」闸（面板内点击、刚开即关、弹窗遮罩、通话半框排除）。
// 用法：node build.mjs && node tools/verify-sheet-outside-close.mjs
//      SERVE_ROOT=<隔离构建目录> 可验未收口产物（绿/红对照都用它）
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
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-sheet-close-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') jsErrors++; };
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
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// —— S 组：产物锚点（PERF 阶段 1b 起 core 全外置：chat.js/avatar-lib.js 落点是 js/<file>，
//    而旧产物曾把它们内联进 index.html——两侧并集查找，锚点语义不变，只兼容落点迁移）——
const artifact = readFileSync(join(root, 'index.html'), 'utf8');
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const chatText = rd('js/chat.js') + artifact;
chk('S1 产物含点外关闭分派器', chatText.includes('window.mochiSheetOutsideClose = function (panel, close)'), '');
chk('S2 产物含聊天五枚半框接入表', chatText.includes("[['chat-divine-panel', () => { if (chatDivinePanel)"), '');
chk('S3 帮我决定接线在产物中', rd('js/decision.js').includes('window.mochiSheetOutsideClose(panel, closePanel)'), '');
chk('S4 多人决定接线在产物中', rd('js/group-decision.js').includes('window.mochiSheetOutsideClose(panel'), '');
chk('S5 送礼半框接线在产物中', rd('js/gift-shop.js').includes("mochiSheetOutsideClose(document.getElementById('chat-gift-panel')"), '');
// 同上：外置/内联两种落点任一命中即可
chk('S6 头像互动半框接线在产物中', (rd('js/avatar-lib.js') + artifact).includes("mochiSheetOutsideClose(document.getElementById('avlib-card')"), '');

// —— 关开屏 + 压制干扰层（备份提醒条 / qa-mask / 首启模态）——
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
await evalJs("window.chatAddIn('半框点外关闭测试消息'); true");
await sleep(900);

async function tap(x, y) {
  const t = Date.now() / 1000;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t, touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await sleep(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t + 0.08, touchPoints: [] });
}
const SHEETS = ['chat-decision-panel', 'chat-gdecision-panel', 'chat-divine-panel', 'chat-ask-panel', 'chat-search', 'chat-rps-panel', 'chat-rp-panel', 'chat-gift-panel', 'avlib-card', 'chat-call-panel', 'chat-more-panel'];
// 清场：首启模态（备份提醒/欢迎）在 enterChat 之后才弹出、遮罩铺满全屏，会把「半框外」的命中全吃掉
const sweepMasks = () => evalJs(`(function(){
  document.querySelectorAll('.modal-mask').forEach(function(m){m.hidden=true;});
  var qm=document.getElementById('qa-mask'); if(qm)qm.hidden=true;
  try{document.body.classList.remove('scroll-lock');}catch(e){}
  return true;})()`);
async function closeAll() {
  await sweepMasks();
  await evalJs(`(function(){${JSON.stringify(SHEETS)}.forEach(function(id){var e=document.getElementById(id);if(e)e.hidden=true;});return true;})()`);
  await sleep(120);
}
const isOpen = (id) => evalJs(`(function(){var e=document.getElementById(${JSON.stringify(id)});return e?!e.hidden:null;})()`);
// 点「本面板之外」：每轮先扫掉重新弹出的首启模态（备份提醒/欢迎弹窗会在数据就绪后再冒出来，
// 遮罩铺满全屏时任何点外判定都不成立），再按当前几何重找空白点，最后回读面板状态
async function tapOutside(id) {
  await sweepMasks();
  await sleep(150);
  const b = await findBlank();
  if (!b) { chk('前置 打开 ' + id + ' 后仍有点外空白', false, ''); return null; }
  await tap(b.x, b.y);
  await sleep(400);
  return isOpen(id);
}
async function openDirect(id) {
  await evalJs(`(function(){var e=document.getElementById(${JSON.stringify(id)});if(e)e.hidden=false;return true;})()`);
  await sleep(600); // 越过「刚开 400ms 不关」闩，隔离出真正的点外判定
}
// 空白点：聊天消息区上部，不在气泡/半框/按钮/输入栏/遮罩上
await sweepMasks();
await sleep(200);
const findBlank = () => evalJs(`(function(){
  var list=document.getElementById('chat-body')||document.querySelector('.chat-main');
  if(!list)return null;
  var r=list.getBoundingClientRect();
  var cands=[[r.left+r.width/2,r.top+Math.min(40,r.height*0.08)],[r.left+r.width*0.5,r.top+r.height*0.15],[r.left+30,r.top+r.height*0.12],[r.left+r.width-30,r.top+r.height*0.2],
    [r.left+r.width/2,r.top+6],[r.left+10,r.top+6],[r.left+r.width-10,r.top+6],[r.left+r.width/2,r.top+18]];
  for(var i=0;i<cands.length;i++){var x=Math.round(cands[i][0]),y=Math.round(cands[i][1]);
    var el=document.elementFromPoint(x,y);
    if(el&&!el.closest('.msg-bubble')&&!el.closest('.poke-card')&&!el.closest('.modal-mask')&&!el.closest('button')&&!el.closest('.ch-input-bar'))return {x:x,y:y};}
  return null;
})()`);
const blank = await findBlank();
chk('前置 找到半框外空白点', !!blank, JSON.stringify(blank));
const centerOf = (sel) => evalJs(`(function(){var b=document.querySelector(${JSON.stringify(sel)});if(!b)return null;var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);

// —— T1 帮我决定：点空白关闭（用户报障本体，红基线必红）——
if (blank) {
  await closeAll();
  await evalJs('window.openDecision(); true');
  await sleep(600);
  chk('T1a 帮我决定已打开', await isOpen('chat-decision-panel') === true, '');
  chk('T1b 点半框外→帮我决定关闭', await tapOutside('chat-decision-panel') === false, '用户报「点屏幕其他地方无法关闭」');
}

// —— T2 面板内点击不关（防修过头：点字卡/输入框不该收面板）——
if (blank) {
  await closeAll();
  await evalJs('window.openDecision(); true');
  await sleep(600);
  const inPanel = await centerOf('#chat-decision-panel .dc-tabs');
  if (!inPanel) chk('T2 前置 面板内页签可定位', false, '');
  else {
  await tap(inPanel.x, inPanel.y);
  await sleep(400);
  chk('T2 点面板内（页签）→不关闭', await isOpen('chat-decision-panel') === true, JSON.stringify(inPanel));
  }
}

// —— T3 「刚开即关」判别：入口漏 stopPropagation（同一击冒泡到 document）时不得把刚开的面板关掉 ——
if (blank) {
  await closeAll();
  const made = await evalJs(`(function(){
    var t=document.createElement('div'); t.id='probe-open-decide';
    t.style.cssText='position:fixed;left:8px;top:8px;width:64px;height:64px;z-index:99999;background:rgba(0,0,0,.01)';
    // 刻意不 e.stopPropagation()＝最坏入口形态：这一击会继续冒泡到 document 的点外关闭器
    t.addEventListener('click', function(){ try { window.openDecision(); } catch (e) {} });
    document.body.appendChild(t);
    var r=t.getBoundingClientRect();
    return {ok:true, x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};
  })()`);
  if (!made || !made.ok) chk('T3 前置 探针入口挂载', false, JSON.stringify(made));
  else {
  await tap(made.x, made.y);
  await sleep(250); // 仍在 400ms「刚开」闩窗口内
  chk('T3a 入口漏 stop 的同一击不关掉刚开的面板', await isOpen('chat-decision-panel') === true, JSON.stringify(made));
  await sleep(400);
  chk('T3b 越过闩窗口后点空白→关闭', await tapOutside('chat-decision-panel') === false, '');
  await evalJs("(function(){var t=document.getElementById('probe-open-decide');if(t)t.remove();return true;})()");
  }
}

// —— T4 多人决定：点空白关闭（同批报障）——
if (blank) {
  await closeAll();
  await evalJs('window.openGroupDecision(); true');
  await sleep(600);
  chk('T4a 多人决定已打开', await isOpen('chat-gdecision-panel') === true, '');
  chk('T4b 点半框外→多人决定关闭', await tapOutside('chat-gdecision-panel') === false, '');
}

// —— T5 点上层弹窗遮罩只关弹窗，不把底下半框连带收掉（多人决定 添加/删除成员走 openModal）——
if (blank) {
  await closeAll();
  await evalJs('window.openGroupDecision(); true');
  await sleep(400);
  await evalJs("window.openModal('添加成员','',(v)=>{},{}); true");
  await sleep(500);
  const mask = await evalJs(`(function(){
    var m=document.getElementById('modal-mask'); if(!m||m.hidden) return null;
    var r=m.getBoundingClientRect();
    var cands=[[r.left+12,r.top+12],[r.left+r.width-12,r.top+12],[r.left+12,r.top+r.height-12],[r.left+r.width/2,r.top+12]];
    for(var i=0;i<cands.length;i++){var x=Math.round(cands[i][0]),y=Math.round(cands[i][1]);
      var el=document.elementFromPoint(x,y);
      if(el&&el.classList.contains('modal-mask'))return {x:x,y:y};}
    return null;
  })()`);
  if (!mask) chk('T5 前置 找到遮罩空白点', false, JSON.stringify(mask));
  else {
  await tap(mask.x, mask.y);
  await sleep(500);
  const modalOpen = await evalJs("(function(){var m=document.getElementById('modal-mask');return m?!m.hidden:null;})()");
  chk('T5a 点遮罩→弹窗关闭', modalOpen === false, JSON.stringify({ modalOpen, mask }));
  chk('T5b 点遮罩→底下多人决定半框不关', await isOpen('chat-gdecision-panel') === true, '防「点弹窗把半框一起收」的修过头');
  }
}

// —— T6~T11 同族其余半框：点外关闭（核查出的同类缺口）——
const SIBLINGS = [
  ['T6', 'chat-divine-panel', '占卜', null],
  ['T7', 'chat-search', '聊天记录搜索', null],
  ['T8', 'chat-rps-panel', '猜拳', null],
  ['T9', 'chat-rp-panel', '红包', null],
  // 送礼面板的关闭函数读的是 openGiftPanel 里才赋值的 giftPanel 变量，必须走真打开入口
  ['T10', 'chat-gift-panel', '送礼', 'window.openGiftPanel && window.openGiftPanel()'],
  ['T11', 'avlib-card', '头像互动', null],
];
for (const [tag, id, label, opener] of SIBLINGS) {
  if (!blank) break;
  await closeAll();
  if (opener) { await evalJs(opener + '; true'); await sleep(600); }
  else await openDirect(id);
  chk(tag + 'a ' + label + '已打开', await isOpen(id) === true, id);
  chk(tag + 'b 点空白→' + label + '关闭', await tapOutside(id) === false, id);
}

// —— T12 通话半框刻意不接入（长按气泡弹菜单的一点就把通话关掉，代价大于便利）——
if (blank) {
  await closeAll();
  await openDirect('chat-call-panel');
  chk('T12 通话半框点外保持打开（排除项，防修过头）', await tapOutside('chat-call-panel') === true, '');
}

chk('Z 全程零 JS 异常', jsErrors === 0, 'jsErrors=' + jsErrors);
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' 通过 / ' + fail + ' 失败  [root=' + root + ']');
try { ws && ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { statSync(profileDir) && (await import('node:fs')).rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
process.exit(fail ? 1 : 0);

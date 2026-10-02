// ===== 专项验证：四子棋（connect-four.js，聊天更多功能→小游戏）=====
// 用法：node tools/verify-connect-four.mjs
// 不依赖仓库根构建产物——从当前 src/ 临时组装页面（镜像 build.mjs 顺序），
// 避免与并行会话的官方构建互相干扰。跑完自清理临时目录。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readSrc = (f) => readFileSync(join(root, 'src', f), 'utf8');
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ================= A 组：静态断言（直接读源文件） =================
const tpl = readSrc('template.html');
const builder = readFileSync(join(root, 'build.mjs'), 'utf8');
const mAdapt = readSrc('js/mobile-adapt.js');
const c4css = readSrc('css/chat-pages.css');

check('A1 更多面板有小游戏入口 #more-c4（data-mcat=game，文案「四子棋」）',
  /id="more-c4"[^>]*data-mcat="game"/.test(tpl) && /id="more-c4"[\s\S]{0,700}<span>四子棋<\/span>/.test(tpl));
const needIds = ['chat-c4-panel', 'c4-partner-name', 'c4-sound', 'c4-close', 'c4-stage', 'c4-board', 'c4-overlay', 'c4-ov-title', 'c4-ov-body', 'c4-btn-start', 'c4-btn-end', 'c4-side-name', 'c4-status'];
check('A2 半框面板及全部锚点 id 齐全（' + needIds.length + ' 个）', needIds.every((id) => tpl.indexOf('id="' + id + '"') >= 0));
const bi = builder.indexOf("'connect-four.js'");
const bb = builder.indexOf("'breakout.js'");
check('A3 build.mjs jsFiles 已注册 connect-four.js（紧跟 breakout.js 之后）', bi > 0 && bb > 0 && bi > bb && bi - bb < 40);
check('A4 mobile-adapt 两处浮层列表均登记 #chat-c4-panel', (mAdapt.match(/'#chat-c4-panel'/g) || []).length === 2);
check('A5 样式齐备且无整页 zoom（红线）', ['.c4-board {', '.c4-overlay', '@keyframes c4win', '.c4-status'].every((s) => c4css.indexOf(s) >= 0)
  && !/\.c4-wrap[\s\S]*?zoom\s*:/.test(c4css));

// ================= 从 src 组装临时页面 =================
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => readSrc(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = readSrc(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} window.__jsErrors = window.__jsErrors || []; window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-c4');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.16.x-verify');
const stamp = Date.now();
const tmpHtml = join(tmpdir(), 'mochi-c4-verify-' + stamp + '.html');
writeFileSync(tmpHtml, html);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    if (req.url === '/' || req.url.split('?')[0] === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const profileDir = join(tmpdir(), 'mochi-c4-profile-' + stamp);
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9520 + Math.floor(Math.random() * 160));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir,
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 关自动回复/主动发送，避免异步回复行干扰聊天消息尾部断言；开快速模式（缩短动画/思考时长）
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');window.__c4Debug.fast=true;return true;})()");
// 进入聊天页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(700);

// ================= B 组：运行时 =================
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// B1 入口打开半框 + 开始覆盖层
await evalJs("(function(){document.getElementById('chat-more-panel').hidden=false;var b=document.getElementById('more-c4');if(b)b.click();return true;})()");
await sleep(400);
let r = J(await evalJs("(function(){var p=document.getElementById('chat-c4-panel');var ov=document.getElementById('c4-overlay');return JSON.stringify({open:!p.hidden,ovShown:!ov.hidden,startTxt:(document.getElementById('c4-btn-start')||{}).textContent||'',note:(document.getElementById('c4-ov-body')||{}).textContent||''});})()"));
check('B1 点 #more-c4 打开半框，覆盖层含「开始对局」与随机状态提示', r.open && r.ovShown && /开始|继续/.test(r.startTxt || '') && /随机/.test(r.note || ''), JSON.stringify(r));

// B2 开始对局：棋盘 7×6、玩家先手
await evalJs("(function(){document.getElementById('c4-btn-start').click();return true;})()");
await sleep(250);
r = J(await evalJs("(function(){var d=window.__c4Debug,s=d.st();return JSON.stringify({cols:document.querySelectorAll('#c4-board .c4-col').length,cells:document.querySelectorAll('#c4-board .c4-cell').length,ovHidden:document.getElementById('c4-overlay').hidden,turn:s.turn,started:s.started,status:(document.getElementById('c4-status')||{}).textContent||''});})()"));
check('B2 开始对局后棋盘 7 列 42 格、玩家先手、状态「你的回合」', r.cols === 7 && r.cells === 42 && r.ovHidden === true && r.turn === 1 && /你的回合/.test(r.status || ''), JSON.stringify(r));

// B3 玩家落子：动画期锁输入 → TA 思考回手 → 回到玩家回合
r = J(await evalJs("(function(){var c=document.querySelector('#c4-board .c4-col[data-col=\"3\"]');c.click();var s=window.__c4Debug.st();return JSON.stringify({lockNow:s.lock,turnNow:s.turn});})()"));
check('B3a 点击中列立即锁定输入', r.lockNow === true && r.turnNow === 1, JSON.stringify(r));
let landed = null;
for (let i = 0; i < 60; i++) {
  const x = J(await evalJs("(function(){var s=window.__c4Debug.st();return JSON.stringify({turn:s.turn,you:document.querySelectorAll('#c4-board .c4-you').length,ta:document.querySelectorAll('#c4-board .c4-ta').length});})()"));
  if (x.you >= 1 && x.ta >= 1 && x.turn === 1) { landed = x; break; }
  await sleep(120);
}
check('B3b 双方各落一子后回到玩家回合（你🔵/TA🟡 各 1 枚）', !!landed && landed.you === 1 && landed.ta === 1, JSON.stringify(landed));
r = J(await evalJs("(function(){var s=window.__c4Debug.st();var bot=document.querySelector('#c4-board .c4-col[data-col=\"3\"] .c4-cell[data-r=\"5\"] .c4-disc');return JSON.stringify({bottomHasDisc:!!bot,lock:s.lock});})()"));
check('B3c 棋子落在该列最底部空位、输入解锁', r.bottomHasDisc === true && r.lock === false, JSON.stringify(r));

// B4 满列点击：不落子 + 提示已满
await evalJs("(function(){var s=window.__c4Debug.st();for(var i=0;i<6;i++)s.grid[i][0]=1;s.turn=1;s.lock=false;return true;})()");
r = J(await evalJs("(function(){document.querySelector('#c4-board .c4-col[data-col=\"0\"]').click();return JSON.stringify({status:(document.getElementById('c4-status')||{}).textContent||'',discs:document.querySelectorAll('#c4-board .c4-disc').length});})()"));
check('B4 点满列不落子并提示「已经满了」', /满/.test(r.status || ''), JSON.stringify(r));

// B5 行为引擎纯逻辑（确定性构造局面）
await evalJs("(function(){window.__c4Debug.newGame();return true;})()");
await sleep(100);
// T5a 认真：能赢必下
r = J(await evalJs("(function(){var d=window.__c4Debug,s=d.st();s.grid[5]=[2,2,2,0,1,1,0];var n=0;for(var i=0;i<60;i++){if(d.pick('serious')===3)n++;}return JSON.stringify({hit:n});})()"));
check('B5a 认真状态：自己将四连时几乎必赢（≥55/60）', r.hit >= 55, 'hit=' + r.hit);
// T5b 正常：多数时候会赢但不追求最优
r = J(await evalJs("(function(){var d=window.__c4Debug,s=d.st();var n=0;for(var i=0;i<80;i++){if(d.pick('normal')===3)n++;}return JSON.stringify({hit:n});})()"));
check('B5b 正常状态：能赢时约六成会下（30~68/80，非必胜机器）', r.hit >= 30 && r.hit <= 68, 'hit=' + r.hit);
// T5c 认真：堵玩家的将四
await evalJs("(function(){var d=window.__c4Debug,s=d.st();s.grid[5]=[0,0,0,0,0,0,0];s.grid[5]=[1,1,1,0,2,2,0];s.missedBlocks=0;return true;})()");
r = J(await evalJs("(function(){var d=window.__c4Debug,n=0;for(var i=0;i<60;i++){if(d.pick('serious')===3)n++;}return JSON.stringify({block:n});})()"));
check('B5c 认真状态：玩家将四连大概率被堵（≥50/60）', r.block >= 50, 'block=' + r.block);
// T5d 放水：明显该堵的棋有概率不下
r = J(await evalJs("(function(){var d=window.__c4Debug,n=0;for(var i=0;i<100;i++){if(d.pick('sandbag')===3)n++;}return JSON.stringify({block:n});})()"));
check('B5d 放水状态：明显堵点大多放掉（≤45/100）', r.block <= 45, 'block=' + r.block);
// T5e 失误：基本无视危险
r = J(await evalJs("(function(){var d=window.__c4Debug,n=0;for(var i=0;i<100;i++){if(d.pick('blunder')===3)n++;}return JSON.stringify({block:n});})()"));
check('B5e 失误状态：基本无视危险（≤40/100）', r.block <= 40, 'block=' + r.block);
// T5f 底线：被无视满 3 次后的下一次机会，无论何种状态都必堵（逐次重置计数模拟连续无视后的一手）
r = J(await evalJs("(function(){var d=window.__c4Debug,s=d.st();s.grid[5]=[1,1,1,0,2,2,0];var n=0;for(var i=0;i<40;i++){s.missedBlocks=3;if(d.floor(d.pick('blunder'))===3)n++;}return JSON.stringify({force:n});})()"));
check('B5f 底线保护：无视 3 次后的第 4 次必堵（40/40）', r.force === 40, 'force=' + r.force);
// T5g 权重分布
r = J(await evalJs("(function(){var d=window.__c4Debug,m={normal:0,serious:0,sandbag:0,blunder:0};for(var i=0;i<4000;i++){m[d.rollMode()]++;}return JSON.stringify(m);})()"));
check('B5g 行为权重约 50/20/15/15（±6%）',
  Math.abs(r.normal - 2000) < 240 && Math.abs(r.serious - 800) < 180 && Math.abs(r.sandbag - 600) < 160 && Math.abs(r.blunder - 600) < 160, JSON.stringify(r));
// T5h 胜负判断：横/竖/斜四连与非连
r = J(await evalJs("(function(){var d=window.__c4Debug;function mk(){var g=[];for(var i=0;i<6;i++)g.push([0,0,0,0,0,0,0]);return g;}var v=mk();for(var i=2;i<6;i++)v[i][2]=1;var h=mk();h[5]=[0,0,0,1,1,1,1];var dg=mk();dg[0][0]=1;dg[1][1]=1;dg[2][2]=1;dg[3][3]=1;return JSON.stringify({v:(d.winLineAt(v,5,2,1)||[]).length,h:(d.winLineAt(h,5,5,1)||[]).length,d:(d.winLineAt(dg,3,3,1)||[]).length,n:(d.winLineAt(mk(),0,0,1)||[]).length});})()"));
check('B5h 四连判定：纵/横/斜可判胜、孤立子不胜', r.v >= 4 && r.h >= 4 && r.d >= 4 && r.n === 0, JSON.stringify(r));

// B6 完整真实对局（快速模式）：必然分出胜负或平局，写战绩 + 聊天系统消息
const statsBefore = J(await evalJs("(function(){var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':c4-stats';return localStorage.getItem(k)||'{}';})()"));
await evalJs("(function(){window.__c4Debug.fast=true;window.__c4Debug.newGame();return true;})()");
await sleep(150);
let done = null;
for (let i = 0; i < 220; i++) {
  const x = J(await evalJs("(function(){var d=window.__c4Debug,s=d.st();if(!s.over){if(s.turn===1&&!s.lock&&s.started){var legal=[];for(var c=0;c<7;c++){if(d.dropRow(s.grid,c)>=0)legal.push(c);}if(legal.length){var col=legal[Math.floor(Math.random()*legal.length)];var el=document.querySelector('#c4-board .c4-col[data-col=\"'+col+'\"]');if(el)el.click();}}s=d.st();}return JSON.stringify({over:s.over,moves:s.moves});})()"));
  if (x && x.over) { done = x; break; }
  await sleep(110);
}
check('B6a 快速模式完整对局可正常结束', !!done, JSON.stringify(done));
r = J(await evalJs("(function(){var s=window.__c4Debug.st();var ov=document.getElementById('c4-overlay');return JSON.stringify({over:s.over,ovShown:!ov.hidden,title:(document.getElementById('c4-ov-title')||{}).textContent||'',againBtn:(document.getElementById('c4-btn-start')||{}).textContent||'',endBtnHidden:document.getElementById('c4-btn-end').hidden,discs:document.querySelectorAll('#c4-board .c4-disc').length});})()"));
check('B6b 结束显示结果覆盖层（再来一局/结束游戏按钮、棋盘保留）', r.ovShown === true && /再来一局/.test(r.againBtn || '') && r.endBtnHidden === false && r.discs > 0, JSON.stringify(r));
const statsAfter = J(await evalJs("(function(){var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':c4-stats';return localStorage.getItem(k)||'{}';})()"));
const delta = (statsAfter.w - (statsBefore.w || 0)) + (statsAfter.l - (statsBefore.l || 0)) + (statsAfter.d - (statsBefore.d || 0));
check('B6c 战绩累计恰好 +1 局', delta === 1, JSON.stringify({ before: statsBefore, after: statsAfter }));
// 聊天消息落盘是防抖异步——轮询最多 6s
let chatTail = '';
for (let i = 0; i < 12 && !chatTail; i++) {
  await sleep(500);
  chatTail = (await evalJs("(function(){try{var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':chat-msgs';var arr=JSON.parse(localStorage.getItem(k)||'[]');for(var i=arr.length-1;i>=0;i--){if(arr[i]&&arr[i].text&&String(arr[i].text).indexOf('四子棋 · ')===0)return String(arr[i].text);}return '';}catch(e){return '';}})()")) || '';
}
check('B6d 聊天记录写入「四子棋 · …」结果消息', chatTail.indexOf('四子棋 · ') === 0, chatTail);

// B7 再来一局：清盘重开（按战绩 nextFirst 先手）——点击后同 tick 读数，避免快速模式下 TA 抢跑
r = J(await evalJs("(function(){document.getElementById('c4-btn-start').click();var s=window.__c4Debug.st();var nf=JSON.parse(localStorage.getItem((window.activePrefix&&window.activePrefix()||'xy-home-v2')+':c4-stats')||'{}').nextFirst;return JSON.stringify({discs:document.querySelectorAll('#c4-board .c4-disc').length,started:s.started,over:s.over,turn:s.turn,nextFirst:nf});})()"));
check('B7a 再来一局清盘重开，先手符合上一局输家规则', r.discs === 0 && r.started === true && r.over === false && ((r.nextFirst === 'you' && r.turn === 1) || (r.nextFirst === 'ta' && r.turn === 2)), JSON.stringify(r));
let taFirst = null;
if (r.nextFirst === 'ta') {
  for (let i = 0; i < 40; i++) {
    const x = J(await evalJs("(function(){var s=window.__c4Debug.st();return JSON.stringify({turn:s.turn,ta:document.querySelectorAll('#c4-board .c4-ta').length});})()"));
    if (x.ta >= 1 && x.turn === 1) { taFirst = x; break; }
    await sleep(120);
  }
  check('B7b TA 先手局：TA 确实先落子并交回回合', !!taFirst, JSON.stringify(taFirst));
  results[results.length - 1].desc = results[results.length - 1].desc;
} else {
  check('B7b （本局玩家先手，跳过 TA 先手落子验证）', true);
}
// B7c 确定性覆盖「TA 先手开局」分支（与上局结果无关，直接置 nextFirst 后重开）
r = J(await evalJs("(function(){var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':c4-stats';var s=JSON.parse(localStorage.getItem(k)||'{}');s.nextFirst='ta';localStorage.setItem(k,JSON.stringify(s));window.__c4Debug.newGame();var st=window.__c4Debug.st();return JSON.stringify({turn:st.turn,discs:document.querySelectorAll('#c4-board .c4-disc').length});})()"));
check('B7c TA 先手开局：轮次直接是 TA 且尚未落子（思考中）', r.turn === 2 && r.discs === 0, JSON.stringify(r));
let taOpened = null;
for (let i = 0; i < 40; i++) {
  const x = J(await evalJs("(function(){var s=window.__c4Debug.st();return JSON.stringify({turn:s.turn,ta:document.querySelectorAll('#c4-board .c4-ta').length});})()"));
  if (x.ta >= 1 && x.turn === 1) { taOpened = x; break; }
  await sleep(120);
}
check('B7d TA 先手确实自动落子并交回回合', !!taOpened, JSON.stringify(taOpened));

// B8 关闭/重开保持对局 + 兄弟浮层互斥
await evalJs("(function(){window.closeC4Panel();return true;})()");
await sleep(120);
let closed = J(await evalJs("(function(){return JSON.stringify({hidden:document.getElementById('chat-c4-panel').hidden});})()"));
await evalJs("(function(){window.openC4Panel();return true;})()");
await sleep(150);
r = J(await evalJs("(function(){var p=document.getElementById('chat-c4-panel');var s=window.__c4Debug.st();return JSON.stringify({visible:!p.hidden,stillPlaying:s.started&&!s.over});})()"));
check('B8a 关闭后半框隐藏，重开后继续未完成的对局', closed.hidden === true && r.visible === true && r.stillPlaying === true, JSON.stringify({ closed, r }));
await evalJs("(function(){document.getElementById('poke-card').hidden=false;return true;})()");
await sleep(350);
r = J(await evalJs("(function(){return JSON.stringify({c4Hidden:document.getElementById('chat-c4-panel').hidden});})()"));
await evalJs("(function(){document.getElementById('poke-card').hidden=true;return true;})()");
check('B8b 兄弟浮层打开时自动收起本面板（互斥兜底）', r.c4Hidden === true, JSON.stringify(r));

// B10 难度选择：开始覆盖层有三档胶囊 + 切换后持久化 + 影响权重
await evalJs("(function(){window.closeC4Panel();var s=window.__c4Debug.st();if(s){s.over=true;s.started=false;}window.openC4Panel();return true;})()");
await sleep(150);
r = J(await evalJs("(function(){var pills=Array.prototype.map.call(document.querySelectorAll('#c4-ov-body .ms-diff'),function(p){return p.getAttribute('data-diff')+(p.classList.contains('on')?'*':'');});var cur=document.getElementById('c4-cur');return JSON.stringify({pills:pills,cur:cur?cur.textContent:''});})()"));
check('B10a 开始覆盖层有三档难度胶囊（休闲/日常/认真），日常默认选中', Array.isArray(r.pills) && r.pills.length === 3 && r.pills.indexOf('daily*') >= 0 && r.pills.indexOf('casual') >= 0 && r.pills.indexOf('serious') >= 0, JSON.stringify(r));
// 切到认真 → 应持久化到 stats.lastDiff
await evalJs("(function(){var p=document.querySelector('#c4-ov-body .ms-diff[data-diff=\"serious\"]');if(p)p.click();return true;})()");
await sleep(80);
r = J(await evalJs("(function(){var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':c4-stats';var s=JSON.parse(localStorage.getItem(k)||'{}');var on=document.querySelector('#c4-ov-body .ms-diff.on');var cur=document.getElementById('c4-cur');return JSON.stringify({lastDiff:s.lastDiff,on:on?on.getAttribute('data-diff'):'',cur:cur?cur.textContent:''});})()"));
check('B10b 切到「认真」后持久化到 stats.lastDiff 且胶囊高亮/提示更新', r.lastDiff === 'serious' && r.on === 'serious' && /认真/.test(r.cur), JSON.stringify(r));
// 认真档权重：rollMode 4000 次，serious 应 ≥40%（DIFFS.serious.w.serious=0.55）
r = J(await evalJs("(function(){var c={normal:0,serious:0,sandbag:0,blunder:0};for(var i=0;i<4000;i++){c[window.__c4Debug.rollMode()]++;}return JSON.stringify(c);})()"));
check('B10c 认真档 rollMode 权重偏向 serious（≥40%/4000）', r.serious >= 1600, JSON.stringify(r));
// 切到休闲 → 权重应偏向 sandbag+blunder
await evalJs("(function(){var p=document.querySelector('#c4-ov-body .ms-diff[data-diff=\"casual\"]');if(p)p.click();return true;})()");
await sleep(80);
r = J(await evalJs("(function(){var c={normal:0,serious:0,sandbag:0,blunder:0};for(var i=0;i<4000;i++){c[window.__c4Debug.rollMode()]++;}return JSON.stringify(c);})()"));
check('B10d 休闲档 rollMode 权重偏向 sandbag+blunder（≥50%/4000）', (r.sandbag + r.blunder) >= 2000, JSON.stringify(r));
// 重开面板应恢复上次选的难度（休闲）
await evalJs("(function(){window.closeC4Panel();return true;})()");
await sleep(120);
await evalJs("(function(){window.openC4Panel();return true;})()");
await sleep(150);
r = J(await evalJs("(function(){var on=document.querySelector('#c4-ov-body .ms-diff.on');return JSON.stringify({on:on?on.getAttribute('data-diff'):''});})()"));
check('B10e 关闭重开恢复上次难度（休闲）', r.on === 'casual', JSON.stringify(r));
// 结束覆盖层也应有难度胶囊（再来一局前可换档）
await evalJs("(function(){document.getElementById('c4-btn-start').click();return true;})()");
await sleep(100);
// 快速模式下一局打完
await evalJs("(function(){window.__c4Debug.fast=true;return true;})()");
for (let i = 0; i < 60; i++) {
  const x = J(await evalJs("(function(){var s=window.__c4Debug.st();return JSON.stringify({over:s.over});})()"));
  if (x.over) break;
  await evalJs("(function(){var b=document.querySelectorAll('#c4-board .c4-col');if(b.length){b[Math.floor(Math.random()*b.length)].click();}return true;})()");
  await sleep(60);
}
r = J(await evalJs("(function(){var ov=document.getElementById('c4-overlay');var pills=document.querySelectorAll('#c4-ov-body .ms-diff');return JSON.stringify({ovShown:!ov.hidden,pills:pills.length});})()"));
check('B10f 结束覆盖层也显示难度胶囊（3 个）', r.ovShown === true && r.pills === 3, JSON.stringify(r));
await evalJs("(function(){window.__c4Debug.fast=false;return true;})()");

// 无 JS 异常
const errs = J(await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()"));
check('B9 全程无 JS 运行时异常', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

// ---- 收尾 ----
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
try { rmSync(tmpHtml, { force: true }); } catch (e) {}
const pass = results.filter((x) => x.ok).length;
console.log('\n==== 四子棋验证：' + pass + '/' + results.length + ' 通过 ====');
process.exit(pass === results.length ? 0 : 1);

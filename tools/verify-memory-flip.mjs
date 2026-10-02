// ===== 专项验证：记忆翻牌（memory-game.js，聊天更多功能→小游戏）=====
// 用法：node tools/verify-memory-flip.mjs
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
const memCss = readSrc('css/chat-pages.css');
const memJs = readSrc('js/memory-game.js');

check('A1 更多面板有小游戏入口 #more-memory（data-mcat=game，文案「记忆翻牌」）',
  /id="more-memory"[^>]*data-mcat="game"/.test(tpl) && /id="more-memory"[\s\S]{0,700}<span>记忆翻牌<\/span>/.test(tpl));
const needIds = ['chat-memory-panel', 'memory-partner-name', 'memory-diff', 'memory-sound', 'memory-close', 'memory-turn', 'memory-chem', 'memory-coin', 'memory-board', 'memory-overlay', 'memory-overlay-title', 'memory-overlay-body', 'memory-overlay-btn', 'memory-overlay-btn2', 'memory-hint'];
check('A2 半框面板及全部锚点 id 齐全（' + needIds.length + ' 个）', needIds.every((id) => tpl.indexOf('id="' + id + '"') >= 0));
const bi = builder.indexOf("'memory-game.js'");
const fb = builder.indexOf("'fishing.js'");
check('A3 build.mjs jsFiles 已注册 memory-game.js（紧跟 fishing.js 之后）', bi > 0 && fb > 0 && bi > fb && bi - fb < 40);
check('A4 mobile-adapt 两处浮层列表均登记 #chat-memory-panel', (mAdapt.match(/'#chat-memory-panel'/g) || []).length === 2);
check('A5 样式齐备且无整页 zoom（红线）', ['.memory-board {', '.mgm-card {', '.mgm-in {', '.mgm-back {', '.mgm-face {', '[data-theme="dark"] .mgm-face'].every((s) => memCss.indexOf(s) >= 0)
  && !/\.mgm-wrap[\s\S]*?zoom\s*:/.test(memCss));
check('A6 牌类名已与纪念页 .mem-card 解耦（改用 mgm-*，避免样式串味）',
  memJs.indexOf("b.className = 'mgm-card'") >= 0 && memJs.indexOf(".mem-card") < 0 && memJs.indexOf('mem-card-inner') < 0);
check('A7 钱包语义对齐：缺 gift-wallet 时先继承旧键 rp-wallet（v3.15.x 口径）',
  /缺 gift-wallet[\s\S]{0,80}rp-wallet/.test(memJs) && /s\.get\('rp-wallet'\)/.test(memJs));

// ================= 从 src 组装临时页面 =================
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'fishing.js', 'memory-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => readSrc(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = readSrc(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} window.__jsErrors = window.__jsErrors || []; window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-mgm');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.16.x-verify');
const stamp = Date.now();
const tmpHtml = join(tmpdir(), 'mochi-mgm-verify-' + stamp + '.html');
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
const profileDir = join(tmpdir(), 'mochi-mgm-profile-' + stamp);
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9720 + Math.floor(Math.random() * 160));
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
// 关自动回复/主动发送，避免异步回复行干扰聊天消息尾部断言；开快速模式（缩短翻牌等待）
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');window.__mgmDebug.fast=true;return true;})()");
// 进入聊天页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(700);

// ================= B 组：运行时 =================
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// B1 入口打开半框 + 开始覆盖层
await evalJs("(function(){document.getElementById('chat-more-panel').hidden=false;var b=document.getElementById('more-memory');if(b)b.click();return true;})()");
await sleep(400);
let r = J(await evalJs("(function(){var p=document.getElementById('chat-memory-panel');var ov=document.getElementById('memory-overlay');return JSON.stringify({open:!p.hidden,ovShown:!ov.hidden,startTxt:(document.getElementById('memory-overlay-btn')||{}).textContent||'',tip:(document.getElementById('memory-overlay-body')||{}).textContent||''});})()"));
check('B1 点 #more-memory 打开半框，覆盖层含「开始」与合作提示', r.open && r.ovShown && /开始/.test(r.startTxt || '') && /一起/.test(r.tip || ''), JSON.stringify(r));

// B2 三档难度棋盘张数：休闲 12 / 普通 16 / 挑战 20
// 首手随机——重开直到玩家先手，保证后续断言确定性（改难度即重置到开始覆盖层）
async function startPlayerFirst(diff) {
  for (let t = 0; t < 15; t++) {
    await evalJs("(function(){var sel=document.getElementById('memory-diff');sel.value='" + diff + "';sel.dispatchEvent(new Event('change'));document.getElementById('memory-overlay-btn').click();return true;})()");
    await sleep(140);
    const tr = J(await evalJs("(function(){var g=window.__mgmDebug.st();return JSON.stringify({turn:g?g.turn:'?',flipped:document.querySelectorAll('#memory-board .mgm-card.flipped').length,n:document.querySelectorAll('#memory-board .mgm-card').length,cols:(document.getElementById('memory-board').style.gridTemplateColumns||'').trim()});})()"));
    if (tr.turn === 'player') return tr;
  }
  return {};
}
r = await startPlayerFirst('casual');
check('B2a 休闲 4×3：12 张牌、4 列网格', r.n === 12 && /^repeat\(4,/.test(r.cols || ''), JSON.stringify(r));
r = await startPlayerFirst('hard');
check('B2b 挑战 5×4：20 张牌、5 列网格', r.n === 20 && /^repeat\(5,/.test(r.cols || ''), JSON.stringify(r));
r = await startPlayerFirst('normal');
check('B2c 普通 4×4：16 张牌、开局全部背面、覆盖层隐藏', r.n === 16 && /^repeat\(4,/.test(r.cols || '') && r.flipped === 0, JSON.stringify(r));
r = J(await evalJs("(function(){var g=window.__mgmDebug.st();var down=document.querySelectorAll('#memory-board .mgm-card:not(.flipped)').length;var faces=g.cards.map(function(c){return c.face;});var uniq={};faces.forEach(function(f){uniq[f]=(uniq[f]||0)+1;});var pairsOk=Object.keys(uniq).every(function(k){return uniq[k]===2;});return JSON.stringify({down:down,pairKinds:Object.keys(uniq).length,pairsOk:pairsOk});})()"));
check('B2d 8 对牌面各出现恰好两次，初始全部背面朝上', r.down === 16 && r.pairKinds === 8 && r.pairsOk === true, JSON.stringify(r));

// B3 玩家翻两张不同牌：短暂展示后盖回，换 TA 回合
r = J(await evalJs("(function(){var g=window.__mgmDebug.st();var c=g.cards;var a=-1,b=-1;for(var i=0;i<c.length&&b<0;i++){if(c[i].matched)continue;if(a<0){a=i;}else if(c[i].face!==c[a].face){b=i;}}window.__mgmPick=[a,b];document.querySelector('#memory-board .mgm-card[data-idx=\"'+a+'\"]').click();document.querySelector('#memory-board .mgm-card[data-idx=\"'+b+'\"]').click();return JSON.stringify({turn:g.turn,phase:'clicked'});})()"));
check('B3a 玩家回合可连续翻两张', r.turn === 'player', JSON.stringify(r));
let missed = null;
for (let i = 0; i < 30; i++) {
  const x = J(await evalJs("(function(){var g=window.__mgmDebug.st();return JSON.stringify({turn:g.turn,phase:g.phase,flipped:document.querySelectorAll('#memory-board .mgm-card.flipped').length});})()"));
  if (x.turn === 'ta') { missed = x; break; }
  await sleep(90);
}
check('B3b 翻错盖回后换 TA 回合（先短暂两张翻开）', !!missed, JSON.stringify(missed));

// B4 TA 自动行动：会在限时内翻两张并把回合交回
let taDone = null;
for (let i = 0; i < 60; i++) {
  const x = J(await evalJs("(function(){var g=window.__mgmDebug.st();return JSON.stringify({turn:g.turn,myF:g.myFlips,taF:g.taFlips,matchedN:g.cards.filter(function(c){return c.matched;}).length});})()"));
  if (x.turn === 'player' && x.taF >= 2) { taDone = x; break; }
  await sleep(110);
}
check('B4 TA 自动翻过两张并交回回合（TA 翻牌数 ≥2）', !!taDone && taDone.taF >= 2, JSON.stringify(taDone));

// B5 合作打完整局：玩家多数回合配对成功、每 3 回合故意翻错一次给 TA 机会，
// 直至 phase==='ended'（保证双方都有收获、连击/换手/TA 记忆等分支都真实走到）
const chatLenBefore = J(await evalJs("(function(){try{var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':chat-msgs';return JSON.stringify({n:JSON.parse(localStorage.getItem(k)||'[]').length});}catch(e){return'{n:0}';}})()"));
const walletBefore = J(await evalJs("(function(){try{return window.activeStore().get('gift-wallet')||'{}';}catch(e){return '{}';}})()"));
let finished = null;
for (let i = 0; i < 1200; i++) {
  const x = J(await evalJs("(function(){var g=window.__mgmDebug.st();if(!g)return '{}';if(g.phase==='ended')return JSON.stringify({ended:true,myP:g.myPairs,taP:g.taPairs,chem:g.chemistry});if(g.phase!=='idle'||g.turn!=='player')return JSON.stringify({ended:false});window.__mgmAct=(window.__mgmAct||0)+1;var miss=window.__mgmAct%3===0;var un=g.cards.map(function(c,i){return{id:i,face:c.face,ok:!c.matched&&!c.flipped};}).filter(function(c){return c.ok;});var by={};un.forEach(function(c){(by[c.face]=by[c.face]||[]).push(c.id);});if(miss){var ks=Object.keys(by);if(ks.length>=2){document.querySelector('#memory-board .mgm-card[data-idx=\"'+by[ks[0]][0]+'\"]').click();document.querySelector('#memory-board .mgm-card[data-idx=\"'+by[ks[1]][0]+'\"]').click();return JSON.stringify({ended:false,miss:true});}}for(var f in by){if(by[f].length>=2){document.querySelector('#memory-board .mgm-card[data-idx=\"'+by[f][0]+'\"]').click();document.querySelector('#memory-board .mgm-card[data-idx=\"'+by[f][1]+'\"]').click();break;}}return JSON.stringify({ended:false});})()"));
  if (x && x.ended) { finished = x; break; }
  await sleep(70);
}
check('B5a 快速模式合作完整通关（双方都有配对收获）', !!finished && finished.myP >= 1 && finished.taP >= 1, JSON.stringify(finished));
r = J(await evalJs("(function(){var ov=document.getElementById('memory-overlay');return JSON.stringify({ovShown:!ov.hidden,title:(document.getElementById('memory-overlay-title')||{}).textContent||'',body:(document.getElementById('memory-overlay-body')||{}).textContent||'',again:(document.getElementById('memory-overlay-btn')||{}).textContent||'',backHidden:document.getElementById('memory-overlay-btn2').hidden,matched:document.querySelectorAll('#memory-board .mgm-card.matched').length,ownP:document.querySelectorAll('#memory-board .mgm-own-p').length,ownT:document.querySelectorAll('#memory-board .mgm-own-t').length});})()"));
check('B5b 结算覆盖层：完成标题 + 双方配对/翻牌统计 + 默契 + 心意币行 + 再玩一局/返回按钮', r.ovShown && /完成/.test(r.title || '') && /配对/.test(r.body || '') && /默契/.test(r.body || '') && /心意币/.test(r.body || '') && /再玩一局/.test(r.again || '') && r.backHidden === false && r.matched === 16 && r.ownP >= 2 && r.ownT >= 2, JSON.stringify(r));
const chemShown = J(await evalJs("(function(){return JSON.stringify({chem:(document.getElementById('memory-chem')||{}).textContent||'',coin:(document.getElementById('memory-coin')||{}).textContent||''});})()"));
check('B5c 信息栏显示本局默契（≤100）与心意币累计', /默契 \d+$/.test((chemShown.chem || '').trim()) && parseInt((chemShown.coin || '').replace(/\D/g, ''), 10) > 0, JSON.stringify(chemShown));
// 心意币到账：余额增加且写入每日计数键（基础5+全完成2+首次5+连击≥1）
const walletAfter = J(await evalJs("(function(){try{return window.activeStore().get('gift-wallet')||'{}';}catch(e){return '{}';}})()"));
const deltaFen = (walletAfter.myBalance || 0) - (walletBefore.myBalance || 0);
r = J(await evalJs("(function(){var pre=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':';var k=null;for(var i=0;i<localStorage.length;i++){var kk=localStorage.key(i);if(kk.indexOf(':memory-coin-day')>0)k=kk;}if(!k)return{found:false};return JSON.stringify({found:true,v:JSON.parse(localStorage.getItem(k))});})()"));
check('B5d 心意币入账（≥800 分）并落每日计数键', deltaFen >= 800 && r.found && r.v.total >= deltaFen, JSON.stringify({ deltaFen, day: r }));

// B6 聊天系统消息 + TA 回应字卡
let sysMsg = '';
for (let i = 0; i < 12 && !sysMsg; i++) {
  await sleep(500);
  sysMsg = (await evalJs("(function(){try{var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':chat-msgs';var arr=JSON.parse(localStorage.getItem(k)||'[]');for(var i=arr.length-1;i>=0;i--){if(arr[i]&&arr[i].text&&String(arr[i].text).indexOf('记忆翻牌 · ')===0)return String(arr[i].text);}return '';}catch(e){return '';}})()")) || '';
}
check('B6a 聊天记录写入「记忆翻牌 · …」结算消息', sysMsg.indexOf('记忆翻牌 · ') === 0, sysMsg);
// B6b 结算后 TA 从字卡库取一句回应（以开局前消息数为基线，文本须 ∈ 游戏回应池）
let taReply = '';
for (let i = 0; i < 10 && !taReply; i++) {
  await sleep(400);
  taReply = (await evalJs("(function(){try{var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':chat-msgs';var arr=JSON.parse(localStorage.getItem(k)||'[]');var pool=window.getInteractPool?window.getInteractPool('游戏平局·回应',[]):[];for(var i=" + (chatLenBefore.n || 0) + ";i<arr.length;i++){if(arr[i]&&arr[i].text&&arr[i].text.indexOf('记忆翻牌 · ')!==0){if(!pool.length||pool.indexOf(String(arr[i].text))>=0)return String(arr[i].text);}}return '';}catch(e){return '';}})()")) || '';
}
check('B6b 结算后 TA 从字卡库取一句游戏回应', taReply.length > 0, taReply);

// B7 再玩一局：清盘重开（同样等玩家先手，避免 TA 抢翻干扰读数）
r = {};
for (let t = 0; t < 15; t++) {
  await evalJs("(function(){document.getElementById('memory-overlay-btn').click();return true;})()");
  await sleep(130);
  const x = J(await evalJs("(function(){var g=window.__mgmDebug.st();return JSON.stringify({ovHidden:document.getElementById('memory-overlay').hidden,n:document.querySelectorAll('#memory-board .mgm-card').length,flipped:document.querySelectorAll('#memory-board .mgm-card.flipped').length,turn:g?g.turn:'?'});})()"));
  if (x.turn === 'player') { r = x; break; }
}
check('B7 再玩一局清盘重开（16 张全新背面、覆盖层隐藏）', r.ovHidden === true && r.n === 16 && r.flipped === 0, JSON.stringify(r));

// B8 关闭后重开回到开始覆盖层；兄弟浮层互斥兜底
await evalJs("(function(){window.closeMemoryPanel();return true;})()");
await sleep(120);
let closed = J(await evalJs("(function(){return JSON.stringify({hidden:document.getElementById('chat-memory-panel').hidden,g:!!window.__mgmDebug.st()});})()"));
await evalJs("(function(){window.openMemoryPanel();return true;})()");
await sleep(150);
r = J(await evalJs("(function(){var p=document.getElementById('chat-memory-panel');var ov=document.getElementById('memory-overlay');return JSON.stringify({visible:!p.hidden,startOv:!ov.hidden,cards:document.querySelectorAll('#memory-board .mgm-card').length});})()"));
check('B8 关闭即中止本局；重开显示开始覆盖层', closed.hidden === true && closed.g === false && r.visible === true && r.startOv === true, JSON.stringify({ closed, r }));
await evalJs("(function(){document.getElementById('poke-card').hidden=false;return true;})()");
await sleep(350);
r = J(await evalJs("(function(){return JSON.stringify({memHidden:document.getElementById('chat-memory-panel').hidden});})()"));
await evalJs("(function(){document.getElementById('poke-card').hidden=true;return true;})()");
check('B9 兄弟浮层打开时自动收起本面板（互斥兜底）', r.memHidden === true, JSON.stringify(r));

// 无 JS 异常
const errs = J(await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()"));
check('B10 全程无 JS 运行时异常', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

// ---- 收尾 ----
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
try { rmSync(tmpHtml, { force: true }); } catch (e) {}
const pass = results.filter((x) => x.ok).length;
console.log('\n==== 记忆翻牌验证：' + pass + '/' + results.length + ' 通过 ====');
process.exit(pass === results.length ? 0 : 1);

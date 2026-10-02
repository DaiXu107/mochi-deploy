// ===== 专项验证：小游戏四连丰富度（#301：gomoku/linkup/match3/auction + arcade）=====
// 用法：node tools/verify-new-games.mjs
// 骨架镜像 tools/verify-connect-four.mjs：从当前 src/ 临时组装页面（不依赖官方构建产物），
// 无头 Chrome 跑行为断言，跑完自清理。
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

// ================= A 组：静态断言 =================
const tpl = readSrc('template.html');
const builder = readFileSync(join(root, 'build.mjs'), 'utf8');
const mAdapt = readSrc('js/mobile-adapt.js');
const css = readSrc('css/chat-pages.css');
const chatJs = readSrc('js/chat.js');
const p2 = readSrc('js/p2-features.js');
const arcJs = readSrc('js/arcade.js');

const entries = ['more-gomoku', 'more-linkup', 'more-match3', 'more-auction', 'more-arcade'];
check('A1 五个入口按钮均在且属 game 分类', entries.every((id) => new RegExp('id="' + id + '"[^>]*data-mcat="game"').test(tpl)), entries.join(','));
const needIds = ['chat-gomoku-panel', 'gk-board', 'gk-undo', 'chat-linkup-panel', 'lk-board', 'lk-theme', 'chat-match3-panel', 'm3-board', 'chat-auction-panel', 'au-bid1', 'au-bid5', 'au-bid13', 'au-pass', 'au-bag', 'chat-arcade-panel', 'arc-body'];
check('A2 面板及关键控件 id 齐全（' + needIds.length + ' 个）', needIds.every((id) => tpl.indexOf('id="' + id + '"') >= 0));
check('A3 build.mjs jsFiles 已登记五份新文件（auction 之后是 arcade）', builder.indexOf("'gomoku.js'") > builder.indexOf("'memory-game.js'") && builder.indexOf("'arcade.js'") > builder.indexOf("'auction.js'"));
const floatMiss = ['chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-auction-panel', 'chat-arcade-panel'].filter((id) => (mAdapt.match(new RegExp("'#" + id + "'", 'g')) || []).length !== 2);
check('A4 mobile-adapt 两处浮层清单各登记 5 个新面板', floatMiss.length === 0, floatMiss.join(','));
check('A5 样式齐备（气泡/炸弹环/游乐室）且无整页 zoom 红线', ['.tg-bubble', '.m3-tile.m3-bomb', '.arc-badge', '.gk-board {', '.lk-board {'].every((s) => css.indexOf(s) >= 0) && !/\.arc-wrap[\s\S]{0,200}zoom\s*:/.test(css));
check('A6 TA 邀请池扩到 6 款 + 面板直达接线', (chatJs.match(/kind: 'gomoku'|kind: 'linkup'|kind: 'match3'|kind: 'auction'/g) || []).length === 4 && chatJs.indexOf("if (kind === 'gomoku') { if (window.openGomokuPanel)") >= 0 && chatJs.indexOf("if (kind === 'auction') { if (window.openAuctionPanel)") >= 0);
check('A7 小游戏记录识别含新四款', p2.indexOf("gomoku: '五子棋'") >= 0 && p2.indexOf("auction: '心意币拍卖会'") >= 0);
check('A8 arcade 暴露幸运/掉落助手', ['window.arcadeMult', 'window.arcadeTryDrop', 'window.arcadeMarkLuckyPlayed', 'window.arcadeLuckyKey'].every((s) => arcJs.indexOf(s) >= 0));
// A9 #306：全屏按钮九连 + 共享全屏类 + 头部防挤压样式 + 棋盘 gap 修复锚
const fsBtnIds = ['rps-fs', 'fish-fs', 'c4-fs', 'ms-fs', 'memory-fs', 'gk-fs', 'lk-fs', 'm3-fs', 'au-fs'];
check('A9a 九个游戏面板均有全屏按钮（⛶，#306）', fsBtnIds.every((id) => tpl.indexOf('id="' + id + '"') >= 0));
check('A9b 共享全屏容器 .game-fs + 头部标题 nowrap 防竖排（#306）', css.indexOf('.poke-card.game-fs {') >= 0 && css.indexOf('height:min(var(--mochi-ios-h, 100dvh), 100dvh)') >= 0 && readSrc('css/chat-main.css').indexOf('.poke-card-head > span { white-space:nowrap; }') >= 0);
check('A9c linkup/match3 fitBoard 扣 grid gap（删则最右列溢出截断，#306）', readSrc('js/linkup.js').indexOf('Math.floor((w - (st.cols - 1) * GAP) / st.cols)') >= 0 && readSrc('js/match3.js').indexOf('Math.floor((w - (N - 1) * GAP) / N)') >= 0);

// ================= 从 src 组装临时页面（镜像 build.mjs 顺序） =================
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css', 'applock.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'applock.js', 'media-pool.js', 'storage-slim.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'quote-spell.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'incoming-requests.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'gomoku.js', 'linkup.js', 'match3.js', 'auction.js', 'arcade.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'feature-hub.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => readSrc(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = readSrc(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} window.__jsErrors = window.__jsErrors || []; window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-new-games');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.26.x-verify');
const stamp = Date.now();
const tmpHtml = join(tmpdir(), 'mochi-ngames-verify-' + stamp + '.html');
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
const profileDir = join(tmpdir(), 'mochi-ngames-profile-' + stamp);
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
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');if(window.__gkDebug)window.__gkDebug.fast=true;if(window.__lkDebug)window.__lkDebug.fast=true;if(window.__m3Debug)window.__m3Debug.fast=true;if(window.__auDebug)window.__auDebug.fast=true;return true;})()");
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(700);
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };
const openGame = async (btnId) => {
  await evalJs("(function(){document.getElementById('chat-more-panel').hidden=false;var b=document.getElementById('" + btnId + "');if(b)b.click();return true;})()");
  await sleep(350);
};

// ================= B 组：运行时 =================
// B0 #309：未开局时棋盘为空，stage 必须有最小高度——否则「开始对局」覆盖层被压成一条横线＝面板像打不开
await openGame('more-linkup');
await sleep(250);
const r0 = J(await evalJs("(function(){var s=document.getElementById('lk-stage'),b=document.getElementById('lk-btn-start');if(!s||!b)return 'missing';var br=b.getBoundingClientRect();return JSON.stringify({stageH:Math.round(s.getBoundingClientRect().height),btnH:Math.round(br.height)});})()"));
check('B0 未开局舞台≥150px 且开始按钮≥30px（不被压成横线）', r0 !== 'missing' && r0.stageH >= 150 && r0.btnH >= 30, JSON.stringify(r0));
await evalJs("(function(){var p=document.getElementById('chat-linkup-panel');if(p)p.hidden=true;return true;})()");
// B1 五子棋：开面板 → 11×11 棋盘 + 下一手 + 悔棋
await openGame('more-gomoku');
let r = J(await evalJs("(function(){var p=document.getElementById('chat-gomoku-panel');return JSON.stringify({open:!p.hidden});})()"));
check('B1 点 more-gomoku 打开五子棋半框', r.open === true);
await evalJs("(function(){document.getElementById('gk-btn-start').click();return true;})()");
await sleep(250);
r = J(await evalJs("(function(){var cells=document.querySelectorAll('#gk-board .gk-cell').length;var c=document.querySelectorAll('#gk-board .gk-cell')[60];if(c)c.click();return JSON.stringify({cells:cells});})()"));
check('B2 五子棋棋盘 11×11=121 格且可落子', r.cells === 121);
await sleep(1400);
r = J(await evalJs("(function(){var d=window.__gkDebug,s=d.st();var before=s.moves;var btn=document.getElementById('gk-undo');btn.click();var s2=d.st();return JSON.stringify({before:before,after:s2.moves,undo:s2.undoUsed,turn:s2.turn});})()"));
check('B3 悔棋撤回两手且每局 1 次生效', r.before >= 2 && r.after === r.before - 2 && r.undo === true && r.turn === 1, JSON.stringify(r));

// B4 连连看：开局 48 张 + 连线判定 + 主题切换
await openGame('more-linkup');
await evalJs("(function(){document.getElementById('lk-btn-start').click();return true;})()");
await sleep(300);
r = J(await evalJs("(function(){var d=window.__lkDebug,st=d.st();var tiles=document.querySelectorAll('#lk-board .lk-tile').length;var pairs=d.allPairs(st);var anyConnect=pairs.length>0;var oneOk=false;if(anyConnect){var pr=d.connected(st,pairs[0][0],pairs[0][1]);oneOk=pr===true;}var diffNot=null;for(var i=0;i<st.cols-1;i++){if(st.grid[0][i]>=0&&st.grid[0][i+1]>=0&&st.grid[0][i]!==st.grid[0][i+1]){diffNot=!d.connected(st,[0,i],[0,i+1]);break;}}return JSON.stringify({tiles:tiles,anyConnect:anyConnect,oneOk:oneOk,diffNot:diffNot});})()"));
check('B4 连连看 8×6=48 张，局面存在可连同款对且判定为真、异款为假', r.tiles === 48 && r.anyConnect === true && r.oneOk === true && r.diffNot === true, JSON.stringify(r));
await evalJs("(function(){var b=document.getElementById('lk-theme');b.click();return true;})()");
r = J(await evalJs("(function(){var b=document.getElementById('lk-theme');return JSON.stringify({ico:b.textContent});})()"));
check('B5 连连看主题按钮切换（🍎→🧁）', String(r.ico).indexOf('🧁') >= 0, JSON.stringify(r));

// B6 消消乐：开局 64 格 + 特殊棋子纯函数
await openGame('more-match3');
await evalJs("(function(){document.getElementById('m3-btn-start').click();return true;})()");
await sleep(300);
r = J(await evalJs("(function(){var d=window.__m3Debug,st=d.st();var g=[];for(var i=0;i<8;i++)g.push(new Array(8).fill(0));g[2][1]=1;g[2][2]=1;g[2][3]=1;var m=d.findMatches(g);var g2=[];for(var i2=0;i2<8;i2++)g2.push(new Array(8).fill(0));for(var rr=2;rr<=4;rr++)for(var cc=2;cc<=4;cc++)g2[rr][cc]=9;g2[3][3]=d.BOMB_BASE+2;var cells=d.clearWithSpecials(g2,[[3,3]]);return JSON.stringify({tiles:document.querySelectorAll('#m3-board .m3-tile').length,matched:!!m,boomCells:cells.length,colorOf:d.colorOf(d.BOMB_BASE+2),rb:d.colorOf(20)});})()"));
check('B6 消消乐 64 格；三连可判；炸弹引爆 3×3=9 格；颜色映射正确', r.tiles === 64 && r.matched === true && r.boomCells === 9 && r.colorOf === 2 && r.rb === -1, JSON.stringify(r));

// B7 拍卖会：模拟钱包 → 开拍 → 一口价压过 TA → 落槌扣款进收藏
await evalJs("(function(){window.__mockWallet={myBalance:500000,systemBalance:100000};window.giftWalletGet=function(){return JSON.parse(JSON.stringify(window.__mockWallet));};window.giftWalletSet=function(w){window.__mockWallet=w;};return true;})()");
await openGame('more-auction');
await evalJs("(function(){document.getElementById('au-btn-start').click();return true;})()");
await sleep(400);
r = J(await evalJs("(function(){var d=window.__auDebug,st=d.st();if(!st||!st.started)return JSON.stringify({err:'nosession'});var step=st.limit-st.cur+100;d.myBid(step);return JSON.stringify({cur0:st.cur,limit:st.limit,mystery:!!st.lots[0].mystery});})()"));
await sleep(1200);
r = J(await evalJs("(function(){var d=window.__auDebug,st=d.st();var bag=d.loadBag();return JSON.stringify({phase:st.phase,myWins:st.myWins,bal:window.__mockWallet.myBalance,bagN:bag.length,bagName:bag.length?bag[0].name:'',leader:st.leader});})()"));
check('B7 拍卖会压过 TA 心理价位即落槌：扣款真实发生、拍品进 🎒', r.phase === 'done' && r.myWins === 1 && r.bal < 500000 && r.bagN === 1 && r.bagName, JSON.stringify(r));

// B8 游乐室：幸运键稳定 + 强制掉落 + 面板渲染
await evalJs("(function(){window.__arcDebug.forceDrop=true;return true;})()");
r = J(await evalJs("(function(){var k1=window.arcadeLuckyKey();var k2=window.arcadeLuckyKey();var m=window.arcadeMult('zzz');var d=window.arcadeTryDrop('verify');var n=window.arcadeDrops().length;return JSON.stringify({k1:k1,k2:k2,m:m,drop:!!d,drops:n});})()"));
check('B8 幸运键同日稳定、异款倍率 1、强制掉落入图鉴', r.k1 && r.k1 === r.k2 && r.m === 1 && r.drop === true && r.drops === 1, JSON.stringify(r));
await openGame('more-arcade');
r = J(await evalJs("(function(){var p=document.getElementById('chat-arcade-panel');var b=document.getElementById('arc-body');return JSON.stringify({open:!p.hidden,hasLucky:(b.textContent||'').indexOf('幸运')>=0,hasBadge:(b.textContent||'').indexOf('徽章')>=0,hasDrop:(b.textContent||'').indexOf('摆件')>=0});})()"));
check('B9 游乐室半框渲染（幸运横幅/徽章/图鉴）', r.open === true && r.hasLucky === true && r.hasBadge === true && r.hasDrop === true, JSON.stringify(r));

// B10 #306 棋盘不溢出：格子固定 px + grid gap，fitBoard 必须把两者都算进总宽
await openGame('more-linkup');
await sleep(200);
r = J(await evalJs("(function(){var b=document.getElementById('lk-board'),s=document.getElementById('lk-stage');var last=b.children[b.children.length-1].getBoundingClientRect();return JSON.stringify({scrollW:b.scrollWidth,stageW:s.clientWidth,lastRight:last.right,stageRight:s.getBoundingClientRect().right});})()"));
check('B10 连连看棋盘含 gap 总宽不溢出 stage（最右列不被截断，≤1px 亚像素容差）', r.scrollW <= r.stageW && r.lastRight - r.stageRight <= 1, JSON.stringify(r));
await openGame('more-match3');
await sleep(200);
r = J(await evalJs("(function(){var b=document.getElementById('m3-board'),s=document.getElementById('m3-stage');var last=b.children[b.children.length-1].getBoundingClientRect();return JSON.stringify({scrollW:b.scrollWidth,stageW:s.clientWidth,lastRight:last.right,stageRight:s.getBoundingClientRect().right});})()"));
check('B10b 消消乐棋盘含 gap 总宽不溢出 stage（≤1px 亚像素容差）', r.scrollW <= r.stageW && r.lastRight - r.stageRight <= 1, JSON.stringify(r));

// B11 #306 拍卖会「不拍了」在白卡上必须可见（前景色不得是纯白）
await openGame('more-auction');
await sleep(200);
r = J(await evalJs("(function(){var b=document.getElementById('au-pass');if(!b)return 'missing';var cs=getComputedStyle(b);return JSON.stringify({color:cs.color,bg:cs.backgroundColor});})()"));
check('B11 不拍了按钮前景色非纯白（白卡上可见）', r !== 'missing' && r.color !== 'rgb(255, 255, 255)', JSON.stringify(r));

// B12 #306 九个全屏按钮：点击 → 面板挂 .game-fs + 图标⤢，再点还原
const fsPairs = [['more-rps', 'rps-fs', 'chat-rps-panel'], ['more-fish', 'fish-fs', 'chat-fish-panel'], ['more-c4', 'c4-fs', 'chat-c4-panel'], ['more-ms', 'ms-fs', 'chat-ms-panel'], ['more-memory', 'memory-fs', 'chat-memory-panel'], ['more-gomoku', 'gk-fs', 'chat-gomoku-panel'], ['more-linkup', 'lk-fs', 'chat-linkup-panel'], ['more-match3', 'm3-fs', 'chat-match3-panel'], ['more-auction', 'au-fs', 'chat-auction-panel']];
let fsOk = 0, fsFail = [];
for (const [moreId, btnId, panelId] of fsPairs) {
  await openGame(moreId);
  await sleep(120);
  const rr = J(await evalJs("(function(){var b=document.getElementById('" + btnId + "'),p=document.getElementById('" + panelId + "');if(!b||!p)return 'missing';b.click();var on=p.classList.contains('game-fs');var ico=b.textContent;b.click();var off=!p.classList.contains('game-fs');return JSON.stringify({on:on,ico:String(ico),off:off});})()"));
  await sleep(80);
  if (rr && rr.on === true && rr.off === true && String(rr.ico).indexOf('\u2922') >= 0) fsOk++;
  else fsFail.push(btnId + ':' + JSON.stringify(rr));
}
check('B12 九个游戏全屏按钮往返切换 .game-fs（' + fsOk + '/9）', fsOk === 9, fsFail.join(' '));
// B12b 全屏态棋盘重排：连连看进全屏后棋盘仍不溢出 stage
await openGame('more-linkup');
await sleep(150);
await evalJs("(function(){document.getElementById('lk-fs').click();return true;})()");
await sleep(250);
r = J(await evalJs("(function(){var b=document.getElementById('lk-board'),s=document.getElementById('lk-stage'),p=document.getElementById('chat-linkup-panel');var fs=p.classList.contains('game-fs');var ok=b.scrollWidth<=s.clientWidth+1;document.getElementById('lk-fs').click();return JSON.stringify({fs:fs,fit:ok});})()"));
check('B12b 全屏态棋盘重排不溢出', r.fs === true && r.fit === true, JSON.stringify(r));
await evalJs("(function(){['chat-rps-panel','chat-fish-panel','chat-c4-panel','chat-ms-panel','chat-memory-panel','chat-gomoku-panel','chat-linkup-panel','chat-match3-panel','chat-auction-panel','chat-more-panel'].forEach(function(id){var p=document.getElementById(id);if(p)p.hidden=true;});return true;})()");

// C 组：页面零未捕获错误
const errs = J(await evalJs('JSON.stringify(window.__jsErrors || [])'));
check('C1 运行期零未捕获 JS 错误', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs).slice(0, 300));

// ================= 收尾 =================
const pass = results.filter((x) => x.ok).length;
console.log('\n==== verify-new-games: ' + pass + '/' + results.length + ' 通过 ====');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(tmpHtml, { force: true }); } catch (e) {}
try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

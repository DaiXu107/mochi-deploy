// ===== 专项验证：合作扫雷（coop-mine.js，聊天更多功能→小游戏）=====
// 用法：node tools/verify-coop-mine.mjs
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
const msCss = readSrc('css/chat-pages.css');
const msJs = readSrc('js/coop-mine.js');

check('A1 更多面板有小游戏入口 #more-ms（data-mcat=game，文案「扫雷」）',
  /id="more-ms"[^>]*data-mcat="game"/.test(tpl) && /id="more-ms"[\s\S]{0,700}<span>扫雷<\/span>/.test(tpl));
const needIds = ['chat-ms-panel', 'ms-partner-name', 'ms-mode', 'ms-bag', 'ms-sound', 'ms-close', 'ms-stage', 'ms-board', 'ms-overlay', 'ms-ov-title', 'ms-ov-body', 'ms-btn-start', 'ms-btn-end', 'ms-lives', 'ms-prog', 'ms-status'];
check('A2 半框面板及全部锚点 id 齐全（' + needIds.length + ' 个）', needIds.every((id) => tpl.indexOf('id="' + id + '"') >= 0));
const bi = builder.indexOf("'coop-mine.js'");
const bc4 = builder.indexOf("'connect-four.js'");
check('A3 build.mjs jsFiles 已注册 coop-mine.js（紧跟 connect-four.js 之后）', bi > 0 && bc4 > 0 && bi > bc4 && bi - bc4 < 40);
check('A4 mobile-adapt 两处浮层列表均登记 #chat-ms-panel', (mAdapt.match(/'#chat-ms-panel'/g) || []).length === 2);
check('A5 样式齐备且无整页 zoom（红线）', ['.ms-board {', '.ms-cell {', '.ms-diff {', '@keyframes mspop', '.ms-status'].every((s) => msCss.indexOf(s) >= 0)
  && !/\.ms-wrap[\s\S]*?zoom\s*:/.test(msCss));
check('A6 核心规则在源码中：共用3命/懒生成保首挖安全/TA三态随机/无雷轻松模式/完美奖励',
  msJs.indexOf('MAX_LIVES = 3') >= 0
  && msJs.indexOf('generateMap(firstIdx)') >= 0 && msJs.indexOf('banned') >= 0
  && msJs.indexOf("rollTaMode") >= 0 && msJs.indexOf("r < 0.7") >= 0 && msJs.indexOf("return 'smart'") >= 0
  && msJs.indexOf('chill') >= 0 && msJs.indexOf('FLAWLESS_BONUS = 300') >= 0);
check('A7 心意币走统一入口 giftWalletChange 且日封顶计数键 ml2_coin_ms_',
  msJs.indexOf('giftWalletChange') >= 0 && msJs.indexOf("ml2_coin_ms_") >= 0 && msJs.indexOf('MS_COIN_CAP = 1000') >= 0);

// ================= 从 src 组装临时页面 =================
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => readSrc(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = readSrc(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} window.__jsErrors = window.__jsErrors || []; window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-ms');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.16.x-verify');
const stamp = Date.now();
const tmpHtml = join(tmpdir(), 'mochi-ms-verify-' + stamp + '.html');
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
const profileDir = join(tmpdir(), 'mochi-ms-profile-' + stamp);
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
// 无头环境「报修须知确认卡」残留会盖住全屏（WORKLOG 已知坑），命中测试前先确认掉
await evalJs("(function(){var k=document.getElementById('splash-confirm-ok');if(k)k.click();return true;})()");
await sleep(900);
// 关自动回复/主动发送；开快速模式（缩短 TA 思考时长）
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');window.__msDebug.fast=true;return true;})()");
// 进入聊天页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(700);

// ================= B 组：运行时 =================
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// B0 环境预检：组装页依赖的跨模块入口必须健在（并行会话半截文件时此处会明确暴露，
// 而不是让下游用例以假象失败——WORKLOG 已知坑：保存瞬间读到半截 chat.js/gift-shop.js）
const env0 = J(await evalJs("(function(){return JSON.stringify({giftChange:typeof window.giftWalletChange,addSys:typeof window.chatAddSystem,addIn:typeof window.chatAddIn,pool:typeof window.getInteractPool,modal:typeof window.openModal});})()"));
check('B0 环境预检：giftWalletChange/chatAddSystem/chatAddIn/getInteractPool/openModal 均可用',
  env0.giftChange === 'function' && env0.addSys === 'function' && env0.addIn === 'function' && env0.pool === 'function' && env0.modal === 'function', JSON.stringify(env0));

// B1 入口打开半框 + 开始覆盖层（难度胶囊）
await evalJs("(function(){document.getElementById('chat-more-panel').hidden=false;var b=document.getElementById('more-ms');if(b)b.click();return true;})()");
await sleep(400);
let r = J(await evalJs("(function(){var p=document.getElementById('chat-ms-panel');var ov=document.getElementById('ms-overlay');return JSON.stringify({open:!p.hidden,ovShown:!ov.hidden,startTxt:(document.getElementById('ms-btn-start')||{}).textContent||'',pills:document.querySelectorAll('#ms-ov-body .ms-diff').length});})()"));
check('B1 点 #more-ms 打开半框，覆盖层含「开始探索」与 4 个难度胶囊', r.open && r.ovShown && /探索/.test(r.startTxt || '') && r.pills === 4, JSON.stringify(r));

// B1b 开局几何（回归哨兵：舞台不得零高塌缩导致覆盖层被裁剪——预建棋盘撑高）
await sleep(200);
r = J(await evalJs("(function(){var p=document.getElementById('chat-ms-panel');var stage=document.getElementById('ms-stage');var ov=document.getElementById('ms-overlay');var btn=document.getElementById('ms-btn-start');var cells=document.querySelectorAll('#ms-board .ms-cell');var pr=p.getBoundingClientRect();var sr=stage.getBoundingClientRect();var br=btn.getBoundingClientRect();var hit=document.elementFromPoint(br.x+br.width/2,br.y+br.height/2);return JSON.stringify({cells:cells.length,cellW:cells[0]?Math.round(cells[0].getBoundingClientRect().width):0,stageH:Math.round(sr.height),panelH:Math.round(pr.height),ovDisplay:getComputedStyle(ov).display,btnHit:hit===btn||(btn.contains(hit)),btnRect:{w:Math.round(br.width),h:Math.round(br.height)}});})()"));
check('B1b 首开几何正常：棋盘已预建、舞台有高度、开始按钮在视口内且 elementFromPoint 可命中',
  r.cells === 36 && r.cellW >= 26 && r.stageH >= 170 && r.panelH >= 320 && r.ovDisplay === 'flex' && r.btnHit === true && r.btnRect.w > 60, JSON.stringify(r));

// B2 选普通难度开局：棋盘 6×6=36 格、❤️×3、进度 0/30、玩家先手
await evalJs("(function(){var p=document.querySelector('#ms-ov-body .ms-diff[data-diff=\"normal\"]');if(p)p.click();return true;})()");
await sleep(100);
await evalJs("(function(){document.getElementById('ms-btn-start').click();return true;})()");
await sleep(250);
r = J(await evalJs("(function(){var d=window.__msDebug,s=d.st();return JSON.stringify({cells:document.querySelectorAll('#ms-board .ms-cell').length,n:s.n,mines:s.mineTotal,lives:(document.getElementById('ms-lives')||{}).textContent||'',prog:(document.getElementById('ms-prog')||{}).textContent||'',ovHidden:document.getElementById('ms-overlay').hidden,status:(document.getElementById('ms-status')||{}).textContent||''});})()"));
check('B2 普通局：36 格 · 6 雷 · ❤️❤️❤️ · 已探索 0/30 · 玩家先手',
  r.cells === 36 && r.n === 6 && r.mines === 6 && (r.lives || '').indexOf('🖤') < 0 && (r.lives || '').split('❤️').length === 4 && /0\s*\/\s*30/.test(r.prog || '') && r.ovHidden === true && /你的回合/.test(r.status || ''), JSON.stringify(r));

// B3 玩家挖一格 → 轮到 TA → TA 自动挖 → 回到玩家回合；首挖及周围必无雷
r = J(await evalJs("(function(){var d=window.__msDebug,st=d.st();var safe=[];for(var i=0;i<36;i++){if(!st.open[i])safe.push(i);}d.dig(safe[0],true);var s2=d.st();return JSON.stringify({lock:s2.lock,turn:s2.turn,digsYou:s2.digs.you,firstDig:s2.firstDig,gened:!!s2.mine});})()"));
check('B3a 玩家挖下第一格：地图已懒生成、输入锁定、轮到 TA', r.gened === true && r.lock === true && r.turn === 2 && r.digsYou >= 1, JSON.stringify(r));
let taBack = null;
for (let i = 0; i < 50; i++) {
  const x = J(await evalJs("(function(){var s=window.__msDebug.st();return JSON.stringify({turn:s.turn,openN:s.open.filter(Boolean).length,over:s.over});})()"));
  if (x && x.turn === 1 && !x.over) { taBack = x; break; }
  if (x && x.over) break;
  await sleep(120);
}
check('B3b TA 在快速模式下自动挖了一格并交回回合', !!taBack && taBack.openN >= 2, JSON.stringify(taBack));
r = J(await evalJs("(function(){var d=window.__msDebug,st=d.st();var bad=0;for(var i=0;i<36;i++){if(st.open[i]&&st.num[i]!==undefined){var n=st.n,r=Math.floor(i/n),c=i%n,m=0;for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;var rr=r+dr,cc=c+dc;if(rr>=0&&rr<n&&cc>=0&&cc<n&&st.mine[rr*n+cc])m++;}if(st.num[i]!==m)bad++;}}return JSON.stringify({badNum:bad,openN:st.open.filter(Boolean).length});})()"));
check('B3c 数字=周围雷数（已开格全量校验零误差）', r.badNum === 0 && r.openN >= 2, JSON.stringify(r));

// B4 零连锁：构造 5×5 无雷图，挖一角应展开清盘（flood 生效）；顺带产出完整胜利结算
await evalJs("(function(){var d=window.__msDebug;d.setDiff('easy');d.newGame();d.forceMap(new Array(25).fill(0));return true;})()");
await sleep(120);
r = J(await evalJs("(function(){var d=window.__msDebug;d.dig(0,true);var s=d.st();return JSON.stringify({openN:s.open.filter(Boolean).length,over:s.over});})()"));
check('B4 数字0连锁展开：无雷图挖一角直接清盘获胜（>20 格一次打开）', r.openN > 20 && r.over === true, JSON.stringify(r));
// 覆盖层应显示胜利结算（#343 起结算延迟到涟漪演完再弹——fast 模式 ≈14ms，轮询等它换内容，防读到上一局的旧浮层）
let r4 = null;
for (let i = 0; i < 15; i++) {
  r4 = J(await evalJs("(function(){return JSON.stringify({title:(document.getElementById('ms-ov-title')||{}).textContent||'',body:(document.getElementById('ms-ov-body')||{}).textContent||''});})()"));
  if (/合作完成/.test(r4.title || '')) break;
  await sleep(100);
}
check('B4b 胜利覆盖层：合作完成 + 探索统计 + 心意币行', /合作完成|清理完成/.test(r4.title || '') && /你探索/.test(r4.body || '') && /心意币/.test(r4.body || ''), JSON.stringify(r4));
// 关闭覆盖层继续下一组用例
await evalJs("(function(){document.getElementById('ms-btn-start').click();return true;})()");
await sleep(200);

// B5 轻松模式：无雷 · 无连锁（刮卡式逐格挖宝）、完成奖励 ¥2
await evalJs("(function(){var d=window.__msDebug;d.setDiff('chill');d.newGame();return true;})()");
await sleep(150);
r = J(await evalJs("(function(){var d=window.__msDebug,s=d.st();return JSON.stringify({n:s.n,mines:s.mineTotal});})()"));
check('B5a 轻松局：6×6 · 0 雷', r.n === 6 && r.mines === 0, JSON.stringify(r));
let chillDone = null;
for (let i = 0; i < 400; i++) {
  const x = J(await evalJs("(function(){var d=window.__msDebug,s=d.st();if(s.over)return JSON.stringify({over:true});if(s.turn===1&&!s.lock&&s.started){var idx=-1;for(var i2=0;i2<36;i2++){if(!s.open[i2]){idx=i2;break;}}if(idx>=0)d.dig(idx,true);}return JSON.stringify({over:false,openN:s.open.filter(Boolean).length});})()"));
  if (x && x.over) { chillDone = x; break; }
  await sleep(90);
}
check('B5b 轻松局可完整挖完并触发胜利结算', !!chillDone, JSON.stringify(chillDone));
r = J(await evalJs("(function(){var d=window.__msDebug,s=d.st();var dt=new Date();var day=dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate();var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':ml2_coin_ms_'+day;return JSON.stringify({over:s.over,coinDay:Number(localStorage.getItem(k))||0,found:s.foundList.length});})()"));
check('B5c 完成入账：日计数 ≥¥2（完成奖励）、宝物已发现若干', r.over === true && r.coinDay >= 200 && r.found >= 1, JSON.stringify(r));

// B6 金币格：+¥1 即时入账（forceMap 在 6/7 放两颗雷，让 12 格数字>0 不触发连锁，单格可控）
const MS_MAP_CONTAINED = '[0,0,0,0,0, 1,1,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0]';
// 心意币自 v3.15.x 起为全局一本账（根键 xy-home-v2:gift-wallet，不按桌面隔离——gift-shop.js wstore）
const numProbe = "(function(){try{var v=JSON.parse(localStorage.getItem('xy-home-v2:gift-wallet')||'{}');return typeof v.myBalance==='number'?v.myBalance:-1;}catch(e){return -1;}})()";
await evalJs("(function(){var d=window.__msDebug;d.setDiff('easy');d.newGame();d.forceMap(" + MS_MAP_CONTAINED + ");d.setContent(12,'coin');var dt=new Date(),day=dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate();localStorage.removeItem((window.activePrefix&&window.activePrefix()||'xy-home-v2')+':ml2_coin_ms_'+day);return true;})()");
await sleep(120);
const walletBeforeCoin = (await evalJs(numProbe)) || 0;
r = J(await evalJs("(function(){var d=window.__msDebug;d.dig(12,true);var s=d.st();var dt=new Date(),day=dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate();var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':ml2_coin_ms_'+day;return JSON.stringify({coinEarned:s.coinEarned,found:s.foundList[0],day:Number(localStorage.getItem(k))||0,face:(document.querySelectorAll('#ms-board .ms-cell')[12]||{}).textContent||''});})()"));
// 钱包可能被无关异步写（如 TA 自动红包调度）插队——轮询等待 +100 到账，最多 2s
let walletAfterCoin = 0;
for (let i = 0; i < 8; i++) {
  await sleep(250);
  walletAfterCoin = (await evalJs(numProbe)) || 0;
  if (walletAfterCoin - walletBeforeCoin === 100) break;
}
check('B6 🪙金币格：挖开显示🪙、coinEarned+100、日计数+100、钱包余额+100（统一入口）',
  r.face === '🪙' && r.coinEarned === 100 && r.found === 'coin' && r.day >= 100 && walletAfterCoin - walletBeforeCoin === 100,
  JSON.stringify(r) + ' walletΔ=' + (walletAfterCoin - walletBeforeCoin));

// B7 🎁礼物收藏 + TA 挖到礼物发聊天字卡
await evalJs("(function(){var d=window.__msDebug;d.forceMap(" + MS_MAP_CONTAINED + ");d.setContent(13,'gift');return true;})()");
await sleep(80);
r = J(await evalJs("(function(){var d=window.__msDebug;d.dig(13,false);var s=d.st();var keeps=JSON.parse(localStorage.getItem((window.activePrefix&&window.activePrefix()||'xy-home-v2')+':ms-keeps')||'[]');return JSON.stringify({foundLast:s.foundList[s.foundList.length-1],keeps:keeps.length,lastBy:keeps.length?keeps[keeps.length-1].by:''});})()"));
check('B7a TA 挖到🎁：进入小收藏（by=ta）', r.foundLast === 'gift' && r.keeps >= 1 && r.lastBy === 'ta', JSON.stringify(r));
let giftChat = '';
for (let i = 0; i < 14 && !giftChat; i++) {
  await sleep(500);
  giftChat = (await evalJs("(function(){try{var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':chat-msgs';var arr=JSON.parse(localStorage.getItem(k)||'[]');for(var i=arr.length-1;i>=0;i--){var t=String((arr[i]&&arr[i].text)||'');if(arr[i]&&arr[i].side==='in'&&(t.indexOf('给你')>=0||t.indexOf('送你')>=0))return t;}return '';}catch(e){return '';}})()")) || '';
}
check('B7b TA 送礼字卡写入聊天（含「这个给你/送你呀」送礼语义）', /给你|送你/.test(giftChat || ''), giftChat);
// 🎒 小收藏弹窗
await evalJs("(function(){document.getElementById('ms-bag').click();return true;})()");
await sleep(500);
r = J(await evalJs("(function(){var m=document.getElementById('modal-mask');return JSON.stringify({modal:!m.hidden,txt:(m.textContent||'')});})()"));
check('B7c 🎒 打开小收藏弹窗，列出礼物统计', r.modal === true && /神秘礼物/.test(r.txt || ''), String(r.modal) + '/' + String((r.txt || '').indexOf('神秘礼物') >= 0));
await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();else{var m=document.getElementById('modal-mask');if(m)m.hidden=true;}return true;})()");
await sleep(300);

// B8 共用生命：连踩 3 颗雷 → 失败结算（温和文案）；TA 的旗插对了的吐槽
await evalJs("(function(){var d=window.__msDebug;d.setDiff('easy');d.newGame();d.forceMap([1,1,1,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0]);return true;})()");
await sleep(120);
r = J(await evalJs("(function(){var d=window.__msDebug;d.placeTaFlag(0);d.dig(0,true);var s=d.st();return JSON.stringify({lives:s.lives,hearts:(document.getElementById('ms-lives')||{}).textContent||'',status:(document.getElementById('ms-status')||{}).textContent||''});})()"));
check('B8a 踞第一颗雷：共用生命 3→2、状态含「TA 的旗没错」',
  r.lives === 2 && (r.hearts || '').indexOf('🖤') >= 0 && /旗没错/.test(r.status || ''), JSON.stringify(r));
// 剩余两颗雷由玩家连踩（停 TA 计时器+解锁后直挖，绕开回合交替做确定性失败）
await evalJs("(function(){var d=window.__msDebug;d.stopTa();d.unlock();d.dig(1,true);d.stopTa();d.unlock();d.dig(2,true);return true;})()");
// #343 起失败结算延迟弹出（震屏/揭雷演完再弹，fast 模式 ≈32ms）——轮询等它换内容，防读到上一局的旧浮层
let r8 = null;
for (let i = 0; i < 15; i++) {
  r8 = J(await evalJs("(function(){var s=window.__msDebug.st();return JSON.stringify({lives:s.lives,over:s.over,title:(document.getElementById('ms-ov-title')||{}).textContent||'',body:(document.getElementById('ms-ov-body')||{}).textContent||'',againBtn:(document.getElementById('ms-btn-start')||{}).textContent||''});})()"));
  if (/差一点/.test(r8.title || '')) break;
  await sleep(100);
}
check('B8b 三颗❤耗尽：失败结算（踩到太多雷/还差一点/再来一次），不搞惩罚文案',
  r8.lives <= 0 && r8.over === true && /差一点/.test(r8.title || '') && /还差一点/.test(r8.body || '') && /再来一次/.test(r8.againBtn || ''), JSON.stringify(r8));
let failChat = '';
for (let i = 0; i < 10 && !failChat; i++) {
  await sleep(400);
  failChat = (await evalJs("(function(){try{var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':chat-msgs';var arr=JSON.parse(localStorage.getItem(k)||'[]');for(var i=arr.length-1;i>=0;i--){if(arr[i]&&arr[i].text&&String(arr[i].text).indexOf('合作扫雷 · ')===0)return String(arr[i].text);}return '';}catch(e){return '';}})()")) || '';
}
check('B8c 聊天记录写入「合作扫雷 · …」结果消息', failChat.indexOf('合作扫雷 · ') === 0, failChat);

// B9 战绩累计
r = J(await evalJs("(function(){var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':ms-stats';var s=JSON.parse(localStorage.getItem(k)||'{}');return JSON.stringify(s);})()"));
check('B9 战绩落盘：play≥3 且 win/fail 都有累计', (r.play || 0) >= 3 && (r.win || 0) >= 1 && (r.fail || 0) >= 1, JSON.stringify(r));

// B10 TA 推理引擎（确定性构造局面：14 号格周围只留 19/20/21 三个未知邻格）
// 布局A：num(14)=3 → 三格全是雷；其余已开格数字均不构成结论（无污染）
await evalJs("(function(){var d=window.__msDebug;d.setDiff('normal');d.newGame();d.forceMap(new Array(36).fill(0));d.openCell(14);d.setNum(14,3);d.openCell(7);d.setNum(7,1);d.openCell(8);d.setNum(8,1);d.openCell(9);d.setNum(9,1);d.openCell(13);d.setNum(13,1);d.openCell(15);d.setNum(15,1);return true;})()");
let b10 = J(await evalJs("(function(){var d=window.__msDebug;var m=d.deduceMines().slice().sort();return JSON.stringify({mines:m,safe:d.deduceSafe(),p21:d.probs()[21]});})()"));
check('B10a 约束推理：数字3仅剩三个未知邻格 → 全部判定为雷、无安全误判',
  JSON.stringify(b10.mines) === '[19,20,21]' && (b10.safe || []).length === 0 && b10.p21 === 1, JSON.stringify(b10));
// smart 行为在该局面下：插旗必指向雷组、挖掘绝不碰雷组（40 次抽行为验证逻辑一致性）
b10 = J(await evalJs("(function(){var d=window.__msDebug;var flags=0,badFlag=0,badDig=0;for(var k=0;k<40;k++){var a=d.decide('smart');if(!a)return JSON.stringify({err:1});if(a.type==='flag'){flags++;if([19,20,21].indexOf(a.idx)<0)badFlag++;}else if(a.type==='dig'){if([19,20,21].indexOf(a.idx)>=0)badDig++;}}return JSON.stringify({flags:flags,badFlag:badFlag,badDig:badDig});})()"));
check('B10b 行动一致性：旗子只插在雷组（≥20/40 次机会）、挖掘绝不踩雷组',
  b10.badFlag === 0 && b10.badDig === 0 && b10.flags >= 20, JSON.stringify(b10));
// 布局B：7 号格是已爆的雷（boom 计入已凑雷数）→ num(14)=1 已满足 → 19/20/21 全安全，行动必是挖掘
// 注意相邻格数字要与「已爆 1 雷」自洽（8/13 与 7 相邻，num 需含已爆那份），否则会推出大片假安全
b10 = J(await evalJs("(function(){var d=window.__msDebug;d.forceMap(new Array(36).fill(0));d.setMine(7,1);d.setBoom(7);d.openCell(14);d.setNum(14,1);d.openCell(8);d.setNum(8,2);d.openCell(9);d.setNum(9,1);d.openCell(13);d.setNum(13,2);d.openCell(15);d.setNum(15,1);var safe=d.deduceSafe().slice().sort();var act=d.decide('smart');return JSON.stringify({safe:safe,mines:d.deduceMines(),act:act});})()"));
check('B10c 需要的雷已凑满（含已爆雷）→ 其余未知邻格判安全且行动是挖掘',
  JSON.stringify(b10.safe) === '[19,20,21]' && (b10.mines || []).length === 0 && b10.act && b10.act.type === 'dig' && [19, 20, 21].indexOf(b10.act.idx) >= 0, JSON.stringify(b10));
// 行为权重分布
r = J(await evalJs("(function(){var d=window.__msDebug,m={smart:0,memory:0,wild:0};for(var i=0;i<4000;i++){m[d.rollMode()]++;}return JSON.stringify(m);})()"));
check('B10d TA 行为权重约 70/20/10（±6%）',
  Math.abs(r.smart - 2800) < 240 && Math.abs(r.memory - 800) < 170 && Math.abs(r.wild - 400) < 130, JSON.stringify(r));

// B11 TA 判断错了 / 插旗渲染
await evalJs("(function(){var d=window.__msDebug;d.forceMap(new Array(36).fill(0));d.placeTaFlag(14);return true;})()");
await sleep(100);
r = J(await evalJs("(function(){var d=window.__msDebug;var cell=document.querySelectorAll('#ms-board .ms-cell')[14];var cls=cell.className;var txt=(cell.firstChild||{}).textContent||'';d.clearFlag(14);d.dig(14,true);var s=d.st();return JSON.stringify({cls:cls,txt:txt,status:(document.getElementById('ms-status')||{}).textContent||''});})()"));
check('B11 TA旗渲染🚩；玩家挖开安全格提示「TA判断错了」',
  r.cls.indexOf('ms-fta') >= 0 && r.txt === '🚩' && /判断错了/.test(r.status || ''), JSON.stringify(r));

// B12 带旗格子不能直接挖（抖动提示），长按可插旗/取消
await evalJs("(function(){var d=window.__msDebug;d.setDiff('normal');d.newGame();d.forceMap(new Array(36).fill(0));return true;})()");
await sleep(120);
r = J(await evalJs("(function(){var cell=document.querySelectorAll('#ms-board .ms-cell')[10];cell.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true;})()"));
await sleep(600);
r = J(await evalJs("(function(){var d=window.__msDebug;var cell=document.querySelectorAll('#ms-board .ms-cell')[10];var flagged=cell.className.indexOf('ms-fyou')>=0&&(cell.firstChild||{}).textContent==='🚩';cell.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return JSON.stringify({flagged:flagged,open:d.st().open[10]});})()"));
check('B12a 长按(430ms)插旗成功且未挖开', r.flagged === true && r.open === false, JSON.stringify(r));
r = J(await evalJs("(function(){var cell=document.querySelectorAll('#ms-board .ms-cell')[10];cell.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));cell.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return true;})()"));
await sleep(80);
r = J(await evalJs("(function(){var cell=document.querySelectorAll('#ms-board .ms-cell')[10];cell.click();var d=window.__msDebug,s=d.st();return JSON.stringify({status:(document.getElementById('ms-status')||{}).textContent||'',open:s.open[10]});})()"));
check('B12b 点击带旗格子被拦截（提示先取消记号）', r.open === false && /取消/.test(r.status || ''), JSON.stringify(r));
r = J(await evalJs("(function(){var cell=document.querySelectorAll('#ms-board .ms-cell')[10];cell.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true;})()"));
await sleep(600);
r = J(await evalJs("(function(){var d=window.__msDebug;var cell=document.querySelectorAll('#ms-board .ms-cell')[10];var cleared=!cell.className.split(' ').some(function(c){return c==='ms-fyou'||c==='ms-fta';});cell.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return JSON.stringify({cleared:cleared});})()"));
check('B12c 再次长按取消旗帜', r.cleared === true, JSON.stringify(r));

// B13 插旗模式切换按钮
r = J(await evalJs("(function(){var btn=document.getElementById('ms-mode');btn.click();var on=btn.classList.contains('ms-mode-on')&&btn.textContent==='🚩';btn.click();var off=btn.textContent==='⛏️';return JSON.stringify({on:on,off:off});})()"));
check('B13 ⛏️/🚩 插旗模式按钮可切换', r.on === true && r.off === true, JSON.stringify(r));

// B14 完整真实对局（休闲 5×5·3雷，快速模式）：必然出结果 + 结算层完整
await evalJs("(function(){var d=window.__msDebug;d.setDiff('easy');d.newGame();return true;})()");
await sleep(150);
let gameDone = null;
for (let i = 0; i < 400; i++) {
  const x = J(await evalJs("(function(){var d=window.__msDebug,s=d.st();if(s.over)return JSON.stringify({over:true,win:s.lives>0});if(s.turn===1&&!s.lock&&s.started){var cand=[];for(var i2=0;i2<25;i2++){if(!s.open[i2])cand.push(i2);}if(cand.length){d.dig(cand[Math.floor(Math.random()*cand.length)],true);}}return JSON.stringify({over:false,lives:s.lives});})()"));
  if (x && x.over) { gameDone = x; break; }
  await sleep(90);
}
check('B14a 快速完整对局可正常结束（胜/负都可能）', !!gameDone, JSON.stringify(gameDone));
r = J(await evalJs("(function(){var s=window.__msDebug.st();var ov=document.getElementById('ms-overlay');return JSON.stringify({over:s.over,ovShown:!ov.hidden,bodyLen:((document.getElementById('ms-ov-body')||{}).textContent||'').length,pills:document.querySelectorAll('#ms-ov-body .ms-diff').length,endBtnHidden:document.getElementById('ms-btn-end').hidden,cells:document.querySelectorAll('#ms-board .ms-cell').length});})()"));
check('B14b 结束显示结果覆盖层（再来一次/结束游戏按钮、难度胶囊、棋盘保留）',
  r.ovShown === true && r.pills === 4 && r.endBtnHidden === false && r.cells === 25, JSON.stringify(r));

// B15 关闭/重开保持对局 + 兄弟浮层互斥
await evalJs("(function(){window.__msDebug.setDiff('normal');window.__msDebug.newGame();return true;})()");
await sleep(120);
await evalJs("(function(){window.closeMsPanel();return true;})()");
await sleep(120);
let closed = J(await evalJs("(function(){return JSON.stringify({hidden:document.getElementById('chat-ms-panel').hidden});})()"));
await evalJs("(function(){window.openMsPanel();return true;})()");
await sleep(150);
r = J(await evalJs("(function(){var p=document.getElementById('chat-ms-panel');var s=window.__msDebug.st();return JSON.stringify({visible:!p.hidden,resume:s.started&&!s.over});})()"));
check('B15a 关闭后半框隐藏，重开后继续未完成的对局', closed.hidden === true && r.visible === true && r.resume === true, JSON.stringify({ closed, r }));
await evalJs("(function(){document.getElementById('poke-card').hidden=false;return true;})()");
await sleep(350);
r = J(await evalJs("(function(){return JSON.stringify({msHidden:document.getElementById('chat-ms-panel').hidden});})()"));
await evalJs("(function(){document.getElementById('poke-card').hidden=true;return true;})()");
check('B15b 兄弟浮层打开时自动收起本面板（互斥兜底）', r.msHidden === true, JSON.stringify(r));

// B16 刷新持久化：战绩仍在
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 30; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
r = J(await evalJs("(function(){var k=(window.activePrefix&&window.activePrefix()||'xy-home-v2')+':ms-stats';return localStorage.getItem(k)||'{}';})()"));
check('B16 刷新后战绩持久化（play≥3）', (r.play || 0) >= 3, JSON.stringify(r));

// 无 JS 异常
const errs = J(await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()"));
check('B17 全程无 JS 运行时异常', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

// ---- 收尾 ----
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
try { rmSync(tmpHtml, { force: true }); } catch (e) {}
const pass = results.filter((x) => x.ok).length;
console.log('\n==== 合作扫雷验证：' + pass + '/' + results.length + ' 通过 ====');
process.exit(pass === results.length ? 0 : 1);

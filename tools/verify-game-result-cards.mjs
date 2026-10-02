// ===== 回归验证：#891「五子棋游戏结束没有卡片显示输赢，只有发送聊天消息；四子棋等其他小游戏一并检查」（用户直派，零机型分支） =====
// 根因：chat.js renderMsg 对 special 'gomoku' / 'c4' / 'ms' / 'linkup' / 'match3' / 'auction' 一个卡片
//   分支都没有（pong/brick/memory/snake/rps 早有），这六款游戏的结算消息全部掉进函数末尾的通用气泡
//   分支＝用户所见「只有聊天消息，没有输赢卡片」。
// 修复：①chat.js 新增 GAME_CHAT_CARDS 名册 + 统一结算卡片分支（结论行按 win/lose/draw/clear/fail 上色、
//   下接本局数据行）；②chatAddSystem 转发白名单补 game 字段（漏挑＝负载被就地吞掉，同 #673 教训）；
//   ③六款游戏结算时随正文带出结构化负载（文案用 {ta} 占位，渲染侧按当前昵称展开，不写死旧名）。
// 断言：
//   S1~S9 静态锚（src 侧）：卡片分支 / game 白名单 / 六款游戏负载 / 卡片样式
//   B1 五子棋真下出五连 → 聊天里是卡片（⚫ 五子棋 + 「你赢了！」绿色 + 数据行 ≥3），且只一张
//   B2 四子棋真下出四连 → 卡片（🔵 四子棋 + 你赢了！绿色）
//   B3 历史消息降级：只有正文没有 game 字段时仍是卡片（旧记录不退回气泡）
//   B4 合作/失败/平局三类结论各自上色（clear 绿 / fail 红 / draw 灰）
//   B5 {ta} 占位按当前联系人昵称展开，卡面不残留字面量 "{ta}"
//   B6 既有卡片不受累：pong special 仍渲染 .msg-pong-card
//   Z1 全程零 JS 异常
// 用法：node tools/verify-game-result-cards.mjs（默认仓库根；MOCHI_SERVE_ROOT=<目录> 指向红/绿副本产物做对照）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- S 组：静态锚（读 src，产物是否重建不影响判据） ----
const srcChat = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
check('S1 chat.js 小游戏结算卡片渲染分支在位', srcChat.includes('if (GAME_CHAT_CARDS[rec.special]) {'));
check('S2 chatAddSystem 转发白名单含 game 字段（漏挑＝负载在 addIn 入口就被吞）', srcChat.includes('game: opts.game, askQuestion:'));
check('S10 addIn→addRec 持久化白名单含 game 字段（漏挑＝负载落库前被吞，卡片永远只剩正文降级）', srcChat.includes('game: opts.game, quote:'));
const gameAnchors = [
  ['S3 五子棋结算带结构化负载', 'gomoku.js', 'game: gPayload'],
  ['S4 四子棋结算带结构化负载', 'connect-four.js', 'stats: c4Stats'],
  ['S5 合作扫雷结算带结构化负载', 'coop-mine.js', 'stats: msStats'],
  ['S6 连连看结算带结构化负载', 'linkup.js', 'stats: lkStats'],
  ['S7 消消乐结算带结构化负载', 'match3.js', 'stats: m3Stats'],
  ['S8 拍卖会结算带结构化负载', 'auction.js', 'result: auRes'],
];
for (const [name, file, needle] of gameAnchors) {
  check(name, readFileSync(join(root, 'src', 'js', file), 'utf8').includes(needle), file);
}
check('S9 结算卡片样式（结论行输赢上色）在位',
  readFileSync(join(root, 'src', 'css', 'chat-pages.css'), 'utf8').includes('.msg-game-card'));

// ---- 无头浏览器（真实产品链路） ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9820 + Math.floor(Math.random() * 40));
const profile = join(process.env.TEMP || '/tmp', 'mochi-891v-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const boot = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await ev("(function(){var s=document.querySelector('.splash');if(s)s.classList.add('hide');var q=document.getElementById('qa-close');if(q)q.click();return true;})()");
  await sleep(500);
  await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}var bar=document.getElementById('backup-remind-bar');if(bar)bar.remove();return true;})()");
  await sleep(400);
  await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
  await sleep(800);
  // 关夜间完全静默总闸（全局根键，走 incoming-requests 的 setter）：否则本批直发的那几条结算消息会被 addRec 收件闸丢掉
  await ev("(function(){ if (window.setNightModeEn) window.setNightModeEn(false); return true; })()");
};
await boot();

// 取 #chat-body 内最后一张结算卡片的观测值（含同刻新增张数）
const probeCard = `(function(n){
  var b=document.getElementById('chat-body'); if(!b) return JSON.stringify({nb:1});
  var all=Array.prototype.slice.call(b.querySelectorAll('.msg-game'));
  var t=all.length;
  var el=all[t-1];
  var out={ total:t, added:t-(typeof n==='number'?n:0) };
  if(!el) return JSON.stringify(out);
  var res=el.querySelector('.msg-game-result');
  out.label=(el.querySelector('.msg-pong-label')||{}).textContent||'';
  out.result=res?res.textContent.trim():'';
  out.color=res?getComputedStyle(res).color:'';
  out.stats=Array.prototype.slice.call(el.querySelectorAll('.msg-game-stat')).map(function(x){return x.textContent.trim();});
  out.cls=el.className;
  return JSON.stringify(out);
})`;
const card = async (prev) => JSON.parse((await ev('Promise.resolve(' + probeCard + '(' + prev + '))')) || '{}');

// ---- B1 五子棋：真下出五连（同一次 evaluate 内开局＋摆盘＋落子，杜绝 TA 定时器插手） ----
await ev(`(function(){
  if (window.openGomokuPanel) window.openGomokuPanel();
  window.__gkDebug.fast = true;
  window.__gkDebug.newGame();
  var st = window.__gkDebug.st();
  st.started = true; st.over = false; st.turn = 1;
  for (var r=0;r<11;r++) for (var c=0;c<11;c++) st.grid[r][c] = 0;
  [[5,1],[5,2],[5,3],[5,4]].forEach(function(p){ st.grid[p[0]][p[1]] = 1; });
  var cell = document.querySelector('#gk-board .gk-cell[data-r="5"][data-c="5"]');
  if (cell) cell.click();
  return !!cell;
})()`);
await sleep(1500);
let c1 = await card(0);
check('B1 五子棋五连 → 聊天里是结算卡片（⚫ 五子棋 / 你赢了！ / 绿），且本局数据行 ≥3',
  /msg-game/.test(c1.cls || '') && /五子棋/.test(c1.label) && c1.result === '你赢了！' &&
  c1.color === 'rgb(31, 157, 85)' && c1.stats.length >= 3 && c1.added === 1, JSON.stringify(c1));

// ---- B2 四子棋：真下出四连 ----
await ev(`(function(){
  if (window.openC4Panel) window.openC4Panel();
  window.__c4Debug.fast = true;
  window.__c4Debug.newGame();
  var st = window.__c4Debug.st();
  st.started = true; st.over = false; st.lock = false; st.turn = 1;
  for (var r=0;r<6;r++) for (var c=0;c<7;c++) st.grid[r][c] = 0;
  [[5,1],[5,2],[5,3]].forEach(function(p){ st.grid[p[0]][p[1]] = 1; });
  var col = document.querySelector('#c4-board .c4-col[data-col="4"]');
  if (col) col.click();
  return !!col;
})()`);
await sleep(2000);
let c2 = await card(c1.total || 0);
check('B2 四子棋四连 → 结算卡片（🔵 四子棋 / 你赢了！ / 绿）',
  /四子棋/.test(c2.label) && c2.result === '你赢了！' && c2.color === 'rgb(31, 157, 85)' &&
  c2.stats.length >= 3 && c2.added === 1, JSON.stringify(c2));

// ---- B3 历史消息降级：没有 game 字段的旧结算消息（本批之前入库）也必须是卡片，不能退回气泡 ----
const prev3 = c2.total || 0;
await ev(`window.chatAddSystem('消消乐 · 达成 900 分 · 默契 80', { special: 'match3', nightAllow: true });`);
await sleep(600);
let c3 = await card(prev3);
check('B3 无结构化负载的旧结算正文仍渲染成卡片（结论取正文「 · 」之后）',
  /消消乐/.test(c3.label) && c3.result === '达成 900 分 · 默契 80' && c3.added === 1, JSON.stringify(c3));

// ---- B4 合作完成 / 失败 / 平局 三档结论上色 ----
const prev4 = c3.total || 0;
await ev(`window.chatAddSystem('合作扫雷 · 完成 普通', { special: 'ms', nightAllow: true, game: { name:'合作扫雷', outcome:'clear', result:'雷区清理完成！', stats:['你探索 12 格 · {ta}探索 9 格'] } });`);
await sleep(500);
await ev(`window.chatAddSystem('合作扫雷 · 差一点（普通）', { special: 'ms', nightAllow: true, game: { name:'合作扫雷', outcome:'fail', result:'差一点，雷太多了', stats:['💣 找到地雷 3/10'] } });`);
await sleep(500);
await ev(`window.chatAddSystem('五子棋 · 平局', { special: 'gomoku', nightAllow: true, game: { name:'五子棋', outcome:'draw', result:'平局', stats:['本局共 121 手'] } });`);
await sleep(700);
const b4 = JSON.parse((await ev(`(function(){
  var b=document.getElementById('chat-body');
  var all=Array.prototype.slice.call(b.querySelectorAll('.msg-game'));
  return JSON.stringify({ n: all.length, last3: all.slice(-3).map(function(el){
    var res=el.querySelector('.msg-game-result');
    return { label:(el.querySelector('.msg-pong-label')||{}).textContent||'', result:res.textContent.trim(), color:getComputedStyle(res).color, stat:(el.querySelector('.msg-game-stat')||{}).textContent||'' };
  }) });
})()`)) || {});
const b4l = b4.last3 || [];
check('B4a 合作完成＝绿结论行', b4l[0] && /合作扫雷/.test(b4l[0].label) && b4l[0].result === '雷区清理完成！' && b4l[0].color === 'rgb(31, 157, 85)', JSON.stringify(b4l[0]));
check('B4b 合作差一点＝红结论行', b4l[1] && b4l[1].result === '差一点，雷太多了' && b4l[1].color === 'rgb(217, 72, 72)', JSON.stringify(b4l[1]));
check('B4c 平局＝灰结论行', b4l[2] && b4l[2].result === '平局' && b4l[2].color === 'rgb(138, 138, 138)', JSON.stringify(b4l[2]));
check('B4d 三条结算消息各画出一张卡（不被去重层误吞、也不重复画）', b4.n === prev4 + 3, 'before=' + prev4 + ' after=' + b4.n);

// ---- B5 {ta} 占位按当前联系人昵称展开 ----
check('B5 负载里的 {ta} 渲染成当前联系人昵称（卡面无字面 {ta} 残留）',
  /探索/.test(b4l[0] && b4l[0].stat) && String(b4l[0].stat).indexOf('{ta}') < 0, b4l[0] && b4l[0].stat);

// ---- B6 既有结算卡不受累 ----
await ev(`window.chatAddSystem('Pong · 你 7 : 3 TA · 你赢', { special: 'pong', nightAllow: true });`);
await sleep(600);
const b6 = JSON.parse((await ev(`(function(){
  var b=document.getElementById('chat-body');
  var all=b.querySelectorAll('.msg-pong:not(.msg-game)');
  var el=all[all.length-1];
  return JSON.stringify({ n:all.length, txt: el?el.textContent.trim():'' });
})()`)) || {});
check('B6 Pong 结算仍是原卡片形态（本批只补分支、未改既有卡）', b6.n >= 1 && /Pong/.test(b6.txt), JSON.stringify(b6));

// ---- Z1 零 JS 异常 ----
const errs = await ev('JSON.stringify((window.__jsErrors||[]).slice(0,3))');
check('Z1 全程零 JS 异常', !errs || errs === '[]', errs);

chrome.kill();
server.close();
try { rmSync(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch (e) {}
const fails = results.filter((r) => !r.ok);
console.log('\n==== ' + (fails.length ? fails.length + ' FAILED / ' : 'ALL PASS ') + results.length + ' checks (root=' + root + ') ====');
process.exit(fails.length ? 1 : 0);

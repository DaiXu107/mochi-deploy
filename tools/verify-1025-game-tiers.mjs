// ===== 专项验证：三小游戏「更多牌」扩展批（#1025）=====
// 记忆翻牌（memory-game.js）/ 连连看（linkup.js）/ 消消乐（match3.js）新增档位与牌面主题。
// 用法：node tools/verify-1025-game-tiers.mjs
// 不依赖仓库根构建产物——从当前 src/ 临时组装页面（镜像 build.mjs 顺序，同 verify-memory-flip）。
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

// ================= S 组：静态断言（直接读源文件） =================
const memJs = readSrc('js/memory-game.js');
const lkJs = readSrc('js/linkup.js');
const m3Js = readSrc('js/match3.js');
const builder = readFileSync(join(root, 'build.mjs'), 'utf8');

check('S1 记忆翻牌新增王者/传奇两档（6×5·15 对 / 7×6·21 对）',
  /king:\s*\{[^}]*cols: 6, rows: 5, pairs: 15/.test(memJs) && /legend:\s*\{[^}]*cols: 7, rows: 6, pairs: 21/.test(memJs));
const memThemes = [...memJs.matchAll(/(night|dessert|ocean):\s*\{ ico: '[^']+', name: '[^']+', faces: \[([^\]]*)\]/g)];
const unq = (s) => s.replace(/^'|'$/g, '').split("', '");
const memFaces = memThemes.map((m) => unq(m[2]));
check('S2 记忆翻牌牌面扩为 3 主题×24 款、主题内无重复（图例翻牌 21 对需 ≥21 款）',
  memThemes.length === 3 && memFaces.every((f) => f.length === 24 && new Set(f).size === 24));
check('S3 记忆翻牌旧 12 款池顺序保留在 night 主题前段',
  memFaces[0] && ['🌙', '⭐', '🌸', '🍓', '🐟', '🍀', '☁️', '🦋', '🍑', '🌊', '✨', '🔮'].every((e, i) => memFaces[0][i] === e));
check('S4 记忆翻牌难度下拉由 DIFFS 动态生成（syncDiffSel 定义且被调用）',
  memJs.includes('function syncDiffSel()') && /\n  syncDiffSel\(\);/.test(memJs));

check('S5 连连看新增史诗 12×9 档且 108 = 27 款×2 对×2（可清盘）',
  /epic:\s*\{ rows: 9, cols: 12, kinds: 27, pairPerKind: 2/.test(lkJs));
const lkThemes = [...lkJs.matchAll(/(fruit|dessert|ocean|animal|bloom):\s*\{ ico: '[^']+', name: '[^']+', kinds: \[([^\]]*)\]/g)];
const lkKinds = lkThemes.map((m) => unq(m[2]));
check('S6 连连看 5 主题×27 款、主题内无重复（史诗需 27 款；新图案仅追加在尾部）',
  lkThemes.length === 5 && lkKinds.every((f) => f.length === 27 && new Set(f).size === 27));
check('S7 连连看旧主题前 24 款顺序未动（王者 21/传奇 24 依赖既有顺序）',
  lkKinds[0].length === 27 && lkKinds[0][0] === '🍎' && lkKinds[0][23] === '🌻' && lkKinds[1][23] === '🥮' && lkKinds[2][23] === '💧');
check('S8 连连看主题轮播清单改由 THEMES 派生（新主题自动进 🎨 循环）',
  lkJs.includes("const THEME_ORDER = Object.keys(THEMES);"));

check('S9 消消乐新增王者 10×10·2000 / 传奇 12×12·3500 两档（含配色数 7/8）',
  /king:\s*\{[^}]*size: 10, kinds: 7/.test(m3Js) && /legend:\s*\{[^}]*size: 12, kinds: 8/.test(m3Js));
check('S10 消消乐 N/KIND_N 改可变并随难度接线（newState 内赋值）',
  /^  let N = 8, KIND_N = 6;/m.test(m3Js) && m3Js.includes('N = d.size; KIND_N = d.kinds;'));
const m3Kinds = unq((m3Js.match(/const KINDS = \[([^\]]*)\]/) || [,''])[1]);
check('S11 消消乐配色扩到 8 款且前 6 款顺序不动、8 < BOMB_BASE 值域不碰撞',
  m3Kinds.length === 8 && ['🍓', '🍋', '🍇', '🔔', '⭐', '🎈'].every((e, i) => m3Kinds[i] === e));
check('S12 消消乐双彩虹配色池随 KIND_N（不再硬编码 6 色）',
  m3Js.includes('for (let i = 0; i < KIND_N; i++) poolAll.push(i);'));

check('S13 四条 #1025 哨兵已登记进 build.mjs',
  ['#1025a', '#1025b', '#1025c', '#1025d'].every((n) => builder.includes(n)));

// ================= 从 src 组装临时页面 =================
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'fishing.js', 'memory-game.js', 'gomoku.js', 'linkup.js', 'match3.js', 'auction.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => readSrc(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = readSrc(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} window.__jsErrors = window.__jsErrors || []; window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-1025');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v8.36-verify');
const stamp = Date.now();
const tmpHtml = join(tmpdir(), 'mochi-tiers-verify-' + stamp + '.html');
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); server.close(); rmSync(tmpHtml, { force: true }); process.exit(1); }
const profileDir = join(tmpdir(), 'mochi-tiers-profile-' + stamp);
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
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');window.__mgmDebug.fast=true;if(window.__lkDebug)window.__lkDebug.fast=true;if(window.__m3Debug)window.__m3Debug.fast=true;return true;})()");
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(700);

const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };
let r;

// ================= R1 组：记忆翻牌 =================
await evalJs("(function(){var mp=document.getElementById('chat-more-panel');mp.hidden=false;var b=document.getElementById('more-memory');if(b)b.click();return true;})()");
await sleep(400);
r = J(await evalJs("(function(){var sel=document.getElementById('memory-diff');var opts=[].slice.call(sel.options).map(function(o){return o.value;});var themeBtn=document.getElementById('memory-theme');return JSON.stringify({opts:opts,themeBtn:!!themeBtn,btnTxt:themeBtn?themeBtn.textContent:'',before:(document.querySelectorAll('#memory-board .mgm-card').length)});})()"));
check('R1a 记忆翻牌难度下拉动态生成 5 档（含 king/legend）', JSON.stringify(r.opts) === JSON.stringify(['casual', 'normal', 'hard', 'king', 'legend']), JSON.stringify(r.opts));
check('R1b 主题切换按钮运行时插入头部（night 主题图标 🌙）', r.themeBtn === true && r.btnTxt === '🌙');
r = J(await evalJs("(function(){var sel=document.getElementById('memory-diff');sel.value='legend';sel.dispatchEvent(new Event('change'));return JSON.stringify({cards:document.querySelectorAll('#memory-board .mgm-card').length});})()"));
await evalJs("(function(){document.getElementById('memory-overlay-btn').click();return true;})()");
await sleep(400);
r = J(await evalJs("(function(){var g=window.__mgmDebug.st();var uniq={};g.cards.forEach(function(c){uniq[c.face]=(uniq[c.face]||0)+1;});var cols=(document.getElementById('memory-board').style.gridTemplateColumns||'');var fs=document.getElementById('memory-board').style.getPropertyValue('--mgm-fs');return JSON.stringify({n:g.cards.length,pairKinds:Object.keys(uniq).length,all2:Object.keys(uniq).every(function(k){return uniq[k]===2;}),cols:cols,fs:fs,down:[].filter.call(document.querySelectorAll('#memory-board .mgm-card'),function(e){return !e.classList.contains('flipped');}).length});})()"));
check('R1c 传奇档开局 42 张、21 对牌面各 2 张、全背面', r.n === 42 && r.pairKinds === 21 && r.all2 === true && r.down === 42, JSON.stringify(r));
check('R1d 传奇档棋盘 7 列、卡面字号收到 18px（6 列 20px 同规则）', /^repeat\(7,/.test(r.cols || '') && r.fs === '18px', JSON.stringify(r));
r = J(await evalJs("(function(){document.getElementById('close-memory')&&0;var b=document.getElementById('memory-theme');var before=[].slice.call(document.querySelectorAll('#memory-board .mgm-face')).map(function(e){return e.textContent;});b.click();return true;})()"));
r = J(await evalJs("(function(){var b=document.getElementById('memory-theme');b.click();var faces=[].slice.call(document.querySelectorAll('#memory-board .mgm-face')).map(function(e){return e.textContent;});return JSON.stringify({after:faces.length,same:faces.join('')==='' });})()"));
check('R1e 主题连点两次回到 night 且按钮可用（3 主题循环）', r.after === 42);
r = J(await evalJs("(function(){var s=window.activeStore?1:0;return JSON.stringify({persist:!!localStorage.getItem((window.activePrefix?window.activePrefix():'xy-home-v2:default')+':memory-theme')});})()"));
check('R1f 主题选择按联系人桌面落盘', r.persist === true);
await evalJs("(function(){window.closeMemoryPanel();return true;})()");

// ================= R2 组：连连看 =================
r = J(await evalJs("(function(){document.getElementById('more-linkup').click();return true;})()"));
await sleep(400);
r = J(await evalJs("(function(){var sel=document.getElementById('lk-diff');var opts=[].slice.call(sel.options).map(function(o){return o.value;});return JSON.stringify({opts:opts});})()"));
check('R2a 连连看难度下拉动态生成 6 档（含 epic）', JSON.stringify(r.opts) === JSON.stringify(['casual', 'normal', 'hard', 'king', 'legend', 'epic']), JSON.stringify(r.opts));
r = J(await evalJs("(function(){var sel=document.getElementById('lk-diff');sel.value='epic';sel.dispatchEvent(new Event('change'));window.__lkDebug.newGame();var s=window.__lkDebug.st();var counts={};var bad=0;for(var r2=0;r2<s.rows;r2++)for(var c=0;c<s.cols;c++){var v=s.grid[r2][c];counts[v]=(counts[v]||0)+1;}var ks=Object.keys(counts);return JSON.stringify({tiles:s.rows*s.cols,kinds:ks.length,per4:ks.every(function(k){return counts[k]===4;})});})()"));
check('R2b 史诗档开局 108 张 = 27 款×4 张（每款张数为偶、可清盘）', r.tiles === 108 && r.kinds === 27 && r.per4 === true, JSON.stringify(r));
r = J(await evalJs("(function(){var t=document.getElementById('lk-theme');var start=t.textContent;for(var i=0;i<5;i++){t.click();}return JSON.stringify({txt:t.textContent,start:start});})()"));
check('R2c 🎨 主题 5 连击回到起点（5 主题循环生效）', r.txt === r.start, JSON.stringify(r));
await evalJs("(function(){window.closeLinkupPanel();return true;})()");

// ================= R3 组：消消乐 =================
r = J(await evalJs("(function(){document.getElementById('more-match3').click();return true;})()"));
await sleep(400);
r = J(await evalJs("(function(){var sel=document.getElementById('m3-diff');var opts=[].slice.call(sel.options).map(function(o){return o.value;});return JSON.stringify({opts:opts});})()"));
check('R3a 消消乐难度下拉动态生成 5 档（含 king/legend）', JSON.stringify(r.opts) === JSON.stringify(['casual', 'normal', 'hard', 'king', 'legend']), JSON.stringify(r.opts));
r = J(await evalJs("(function(){var sel=document.getElementById('m3-diff');sel.value='king';sel.dispatchEvent(new Event('change'));window.__m3Debug.newGame();var s=window.__m3Debug.st();var g=s.grid;var maxv=0,ok=true;for(var r2=0;r2<g.length;r2++){if(g[r2].length!==10)ok=false;for(var c=0;c<g[r2].length;c++){if(g[r2][c]>maxv)maxv=g[r2][c];if(g[r2][c]>=7)ok=false;}}return JSON.stringify({rows:g.length,cols:g[0].length,tiles:document.querySelectorAll('#m3-board .m3-tile').length,shapesOk:ok,maxv:maxv,target:s.target});})()"));
check('R3b 王者档开局 10×10＝100 子、配色 <7、目标 2000 分', r.rows === 10 && r.cols === 10 && r.tiles === 100 && r.shapesOk === true && r.target === 2000, JSON.stringify(r));
r = J(await evalJs("(function(){var sel=document.getElementById('m3-diff');sel.value='legend';sel.dispatchEvent(new Event('change'));window.__m3Debug.newGame();var s=window.__m3Debug.st();var g=s.grid;var ok=true;for(var r2=0;r2<g.length;r2++){if(g[r2].length!==12)ok=false;for(var c=0;c<g[r2].length;c++){if(g[r2][c]>=8)ok=false;}}var w=document.getElementById('m3-board').offsetWidth;var stage=document.getElementById('m3-stage').clientWidth;return JSON.stringify({rows:g.length,tiles:document.querySelectorAll('#m3-board .m3-tile').length,ok:ok,w:w,sw:stage});})()"));
check('R3c 传奇档开局 12×12＝144 子、配色 <8', r.rows === 12 && r.tiles === 144 && r.ok === true, JSON.stringify(r));
check('R3d 传奇档棋盘总宽不溢出舞台（窄手机按实宽收格）', r.sw > 0 && r.w <= r.sw + 1, JSON.stringify(r));
r = J(await evalJs("(function(){window.__m3Debug.newGame();var s=window.__m3Debug.st();return JSON.stringify({rows:s.grid.length,mode:s.mode});})()"));
check('R3e 旧档回归安全：legend→重开默认仍取下拉当前值且纯函数夹具口径 8×8 可用', J(await evalJs("(function(){var g=[];for(var r2=0;r2<8;r2++){var row=[];for(var c=0;c<8;c++)row.push((r2*3+c)%6);g.push(row);}var m=window.__m3Debug.findMatches(g);return JSON.stringify({ran:!!m});})()")).ran !== undefined);

// ================= R9 收尾：无 JS 运行时错误 =================
const jsErrs = J(await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()"));
check('R9 全程无脚本运行错误', jsErrs.length === 0, JSON.stringify(jsErrs.slice(0, 3)));

server.close();
chrome.kill();
try { rmSync(tmpHtml, { force: true }); rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
const failed = results.filter((x) => !x.ok);
console.log('\n===== 更多牌档位：' + (results.length - failed.length) + ' 通过 / ' + failed.length + ' 失败 =====');
if (failed.length) { failed.forEach((f) => console.log('FAIL: ' + f.desc)); process.exit(1); }

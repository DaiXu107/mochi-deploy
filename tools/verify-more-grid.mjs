// ===== 专项验证：聊天「更多功能」固定每行 4 个按钮（不同屏宽表现一致） =====
// 用法：node tools/verify-more-grid.mjs
// 历史问题：.more-grid 原为 flex-wrap + 64px 固定宽 → 窄屏(320/360)每行 3 个、
// 宽屏(390+)每行 4 个，不同手机显示不一（用户反馈）。改为 4 列 grid 后：
// 任何屏宽第一行都是 4 个、且所有项同一行 y 对齐、grid 轨道恰好 4 条。
// 与其他 verify 脚本同款：从当前 src/ 临时组装页面，不依赖仓库构建产物。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');

const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css', 'drift-bottle.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'incoming-requests.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => read(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = read(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-more-grid');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.26.x-verify');
const tmpHtml = join(tmpdir(), 'mochi-mg-verify-' + Date.now() + '.html');
writeFileSync(tmpHtml, html);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-mg-' + Date.now()),
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

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
  await evalJs("(function(){try{var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');}catch(e){}document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(600);
}
const openMore = async () => { await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()"); await sleep(350); };

// 返回 fun 网格可见项：每项 id + 相对网格顶部的 top（四舍五入），以及网格列定义
const gridInfo = async () => J(await evalJs("(function(){var g=document.getElementById('more-grid-fun');if(!g)return'{}';var cs=getComputedStyle(g);var items=[];var gTop=g.getBoundingClientRect().top;g.querySelectorAll('.more-item').forEach(function(it){if(!it.hidden){var r=it.getBoundingClientRect();items.push({id:it.id,top:Math.round(r.top-gTop)});}});return JSON.stringify({display:cs.display,cols:cs.gridTemplateColumns.split(' ').length,rows:items});})()"));

let lastGrid = null;
for (const w of [320, 360, 390, 430]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
  await boot();
  await openMore();
  const g = await gridInfo();
  if (!g || !g.rows) { check(w + 'px 更多面板可打开', false, JSON.stringify(g)); continue; }
  // 第一行 = 与首个项 top 相同的可见项
  const t0 = g.rows[0].top;
  const firstRow = g.rows.filter((r) => r.top === t0);
  const perRow = g.rows.reduce((m, r) => { m[r.top] = (m[r.top] || 0) + 1; return m; }, {});
  check(w + 'px 更多功能第一行 = 4 个按钮', firstRow.length === 4, JSON.stringify(firstRow.map((x) => x.id)) + ' 各行分布=' + JSON.stringify(perRow));
  check(w + 'px grid 轨道恰为 4 列', g.cols === 4, 'cols=' + g.cols);
  check(w + 'px grid 生效（display=grid）', g.display === 'grid', g.display);
  lastGrid = g;
  await evalJs("(function(){var p=document.getElementById('chat-more-panel');if(p)p.hidden=true;return true;})()");
}

// ask 网格（5 项）：第一行 4 个 + 第二行 1 个，同样 4 列
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await boot();
await openMore();
await evalJs("(function(){var t=document.querySelector('#more-tabs .more-tab[data-mcat=ask]');if(t)t.click();return true;})()");
await sleep(250);
const ask = J(await evalJs("(function(){var g=document.getElementById('more-grid-ask');if(!g)return'{}';var cs=getComputedStyle(g);var items=[];var gTop=g.getBoundingClientRect().top;g.querySelectorAll('.more-item').forEach(function(it){var r=it.getBoundingClientRect();items.push({id:it.id,top:Math.round(r.top-gTop)});});return JSON.stringify({display:cs.display,cols:cs.gridTemplateColumns.split(' ').length,rows:items});})()"));
if (ask && ask.rows) {
  const t0 = ask.rows[0].top;
  const firstRow = ask.rows.filter((r) => r.top === t0);
  check('TA的提问网格第一行 = 4 个按钮', firstRow.length === 4, JSON.stringify(firstRow.map((x) => x.id)) + ' 共' + ask.rows.length + '项');
  check('TA的提问网格也是 4 列', ask.cols === 4, 'cols=' + ask.cols);
} else {
  check('TA的提问网格可打开', false, JSON.stringify(ask));
}

const pass = results.filter((r) => r.ok).length;
console.log('==== ' + pass + '/' + results.length + ' 通过 ====');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

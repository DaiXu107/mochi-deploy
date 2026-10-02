// ===== 专项验证：此间桌面图标 + 图标排位（花园/此间/喝水/同频/伸手） =====
// 用户需求：① 手机桌面要有「此间」按钮；② 喝水放第三页；③ 此间放喝水原位置（第二页，
//   喝水原在花园前 → 此间排在花园后）；④ 此间与花园调换（花园在左，此间在右，此间占
//   原喝水位）；最终第二排 = 花园 此间 同频 伸手，第三页 = 经期/记账/梦角档案/喝水/吃什么/存钱罐/番茄钟。
// 用例：
//   T1 第二页 p2-grid 含 花园、此间（data-app）图标；且顺序为 花园 此间 同频 伸手
//   T2 第三页 p3-grid 含 喝水；喝水不在第二页
//   T3 点桌面「此间」图标 → 打开 page-cjian；返回按钮回桌面（page-phone）
//   T4 聊天「更多功能」→ 此间 仍正常（返回回聊天）
//   T5 无 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cjian-desk-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cjian-desk-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);

  console.log('\n== T1 第二页图标排位 ==');
  const p2 = await evalJs("(function () { const g = document.querySelector('.app-grid.p2-grid'); if (!g) return null; return Array.prototype.map.call(g.querySelectorAll('.app'), function (a) { return a.getAttribute('data-app'); }); })()");
  ok('第二页网格存在', Array.isArray(p2), p2);
  ok('第二页包含 花园 与 此间', p2 && p2.indexOf('garden') >= 0 && p2.indexOf('cjian') >= 0, p2);
  ok('第二排顺序 = 花园 此间 同频 伸手（花园在左，此间在右）', p2 && p2.indexOf('garden') === 4 && p2.indexOf('cjian') === 5 && p2.indexOf('tongpin') > p2.indexOf('cjian') && p2.indexOf('shenshou') > p2.indexOf('tongpin'), p2);

  console.log('\n== T2 喝水在第三页 ==');
  const p3 = await evalJs("(function () { const g = document.querySelector('.app-grid.p3-grid'); if (!g) return null; return Array.prototype.map.call(g.querySelectorAll('.app'), function (a) { return a.getAttribute('data-app'); }); })()");
  ok('第三页网格存在', Array.isArray(p3), p3);
  ok('喝水在第三页', p3 && p3.indexOf('water') >= 0, p3);
  const waterInP2 = await evalJs("(function () { const g = document.querySelector('.app-grid.p2-grid'); return Array.prototype.some.call(g.querySelectorAll('.app'), function (a) { return a.getAttribute('data-app') === 'water'; }); })()");
  ok('喝水不在第二页', waterInP2 === false, waterInP2);

  console.log('\n== T3 桌面此间入口 ==');
  const clickOpen = await evalJs("(function () { const app = document.querySelector('.app[data-app=\"cjian\"]'); if (!app) return { ok: false }; app.click(); return { ok: true }; })()");
  await sleep(200);
  const opened = await evalJs("(function () { return { cjianOpen: !document.getElementById('page-cjian').hidden, phoneHidden: document.getElementById('page-phone').hidden }; })()");
  ok('点桌面「此间」图标打开 page-cjian', clickOpen && clickOpen.ok && opened && opened.cjianOpen && opened.phoneHidden, opened);
  // 返回回桌面
  await evalJs("document.getElementById('cj-back').click(); true");
  await sleep(150);
  const back = await evalJs("(function () { return { phoneOpen: !document.getElementById('page-phone').hidden, cjianHidden: document.getElementById('page-cjian').hidden }; })()");
  ok('返回按钮回桌面（page-phone）', back && back.phoneOpen && back.cjianHidden, back);

  console.log('\n== T4 聊天更多功能入口仍正常 ==');
  await evalJs("(function () { const t = document.querySelector('.tab[data-page=\"page-phone\"]'); if (t) t.click(); const app = document.querySelector('.app[data-app=\"chat\"]'); if (app) app.click(); return true; })()");
  await sleep(300);
  await evalJs("document.getElementById('chat-more-btn').click(); true");
  await sleep(120);
  const moreBtn = await evalJs("(function () { const b = document.getElementById('more-cjian'); return b && b.offsetParent !== null; })()");
  ok('聊天更多功能面板仍有「此间」入口', moreBtn === true, moreBtn);
  await evalJs("document.getElementById('more-cjian').click(); true");
  await sleep(150);
  const chatOpen = await evalJs("(function () { return { cjianOpen: !document.getElementById('page-cjian').hidden, from: window.__cjianFrom || '' }; })()");
  ok('聊天入口打开此间（来源 chat）', chatOpen && chatOpen.cjianOpen && chatOpen.from === 'chat', chatOpen);

  console.log('\n== T5 无 JS 异常 ==');
  ok('加载与操作全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

// ===== 回归：滚动锁「幽灵浮层」死锁修复（mobile-adapt.js v3.13.x） =====
// 用户反馈：字卡库无法滑动、卡顿。
// 根因：applyLock 只看浮层 hidden 属性——在聊天页打开更多面板/表情包等底半框后
//       不关闭直接离开聊天页（返回桌面/进字卡库，页面整体 display:none），
//       面板 hidden=false 但零渲染盒 → 被当成「开着」→ body.scroll-lock 永久残留，
//       且触摸兜底每次都重新确认锁 → 所有 .page 页面滑不动。
// 修复：floatIsOpen = !hidden && getClientRects().length>0（视觉可见才算开）
//       + 每秒看门狗对账 + period 手动锁弹层纳入判定 + window.scrollLockInfo 探针。
//
// 用例：
//   T1 基线：进聊天 → 开更多面板 → 锁挂上且探针报告该面板
//   T2 幽灵死锁复现与自愈：不关面板直接回桌面 → 探针立即不再报它；进字卡库可滚动（≤1.2s 看门狗内解锁）
//   T3 同型场景：表情包面板开→离开→解锁
//   T4 period 手动锁不被误摘：DOM 里存在 #period-day-pop 时锁保持；移除后自愈解锁
//   T5 正常开关路径无回归：面板打开锁上、关闭解锁
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
// 测试专用组装（同 build.mjs 顺序拼临时 index.html，不碰仓库产物，与构建状态解耦）
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'my-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'drift-bottle.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'connect-four.js', 'coop-mine.js', 'fishing.js', 'memory-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-lockghost-root-' + Date.now());
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-lockghost-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(300);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(400);

  // 进聊天页（真实路径：桌面 chat 图标）
  const entered = await evalJs("(function(){ var app=document.querySelector('.app[data-app=\"chat\"]'); if(!app) return 'no-app'; app.click(); return 'ok'; })()");
  await sleep(500);

  console.log('\n== T1 开更多面板 → 正常上锁 ==');
  await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
  await sleep(300);
  let st = await evalJs('window.scrollLockInfo()');
  ok('更多面板可见时锁挂上', entered === 'ok' && st && st.lock === true && st.open.indexOf('#chat-more-panel') >= 0, st);

  console.log('\n== T2 不关面板直接离开 → 自愈解锁、字卡库可滑动 ==');
  // 聊天页顶栏返回（真实路径），面板保持 hidden=false 遗留
  await evalJs("(function(){var b=document.querySelector('#page-chat .ch-back');if(b)b.click();return true;})()");
  await sleep(300);
  let heal = await evalJs('window.scrollLockInfo()');
  ok('离开聊天页后探针不再报任何浮层', heal && heal.open.length === 0, heal);
  // 进字卡库，等看门狗（1s 周期）+ 触摸兜底
  await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return true;})()");
  await sleep(200);
  await evalJs("(function(){var p=document.getElementById('page-chatcard'); if(p&&!p.hidden){ var ev=new Event('touchstart',{bubbles:true,cancelable:true}); document.dispatchEvent(ev);} return true; })()");
  await sleep(1300);
  heal = await evalJs("(function(){ var p=document.getElementById('page-chatcard'); p.scrollTop=80; var can=p.scrollTop===80||p.scrollHeight<=p.clientHeight; p.scrollTop=0; var i=window.scrollLockInfo(); return { lock:i&&i.lock, open:i&&i.open, can:can }; })()");
  ok('字卡库滚动锁已解除', heal && heal.lock === false && heal.open.length === 0, heal);
  ok('字卡库页面可滚动（scrollTop 生效）', heal && heal.can === true, heal);

  console.log('\n== T3 表情包面板同型场景 ==');
  // 回聊天 → 开表情包 → 直接返回桌面
  await evalJs("(function(){var app=document.querySelector('.app[data-app=\"chat\"]');if(app)app.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return true;})()");
  await sleep(300);
  let st3 = await evalJs('window.scrollLockInfo()');
  ok('表情包面板开着时锁挂上', st3 && st3.lock === true && st3.open.indexOf('#emoji-panel') >= 0, st3);
  await evalJs("(function(){var b=document.querySelector('#page-chat .ch-back');if(b)b.click();return true;})()");
  await sleep(1300);
  st3 = await evalJs('window.scrollLockInfo()');
  ok('遗留表情包面板被看门狗解锁', st3 && st3.lock === false && st3.open.length === 0, st3);

  console.log('\n== T4 period 手动锁不被误摘 ==');
  await evalJs("(function(){var d=document.createElement('div');d.id='period-day-pop';document.body.appendChild(d);return true;})()");
  await sleep(1300);
  let st4 = await evalJs('window.scrollLockInfo()');
  ok('period 弹层存在时锁保持挂上', st4 && st4.lock === true && st4.open.indexOf('#period-day-pop') >= 0, st4);
  await evalJs("(function(){var d=document.getElementById('period-day-pop');if(d)d.remove();return true;})()");
  await sleep(1300);
  st4 = await evalJs('window.scrollLockInfo()');
  ok('period 弹层移除后自愈解锁', st4 && st4.lock === false && st4.open.length === 0, st4);

  console.log('\n== T5 正常开关路径 ==');
  await evalJs("(function(){var app=document.querySelector('.app[data-app=\"chat\"]');if(app)app.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
  await sleep(200);
  let a = await evalJs('(window.scrollLockInfo().lock === true)');
  await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
  await sleep(200);
  let b2 = await evalJs('(window.scrollLockInfo().lock === false)');
  ok('面板开→锁上 / 关→解锁', a === true && b2 === true, { openLock: a, closeUnlock: b2 });

} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

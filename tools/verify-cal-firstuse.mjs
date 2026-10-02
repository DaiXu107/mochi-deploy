// ===== 日历「首次使用日」门控验证（src/js/calendar.js v3.12.x） =====
// 用户反馈：随便选日历里哪一天（包括从未用过本站的日期）都有 TA 留言——错误。
// 预期：每日内容只从「首次使用日」开始生成，更早的日期空态展示，且历史上误生成的数据被清理。
//
// 覆盖三场景（各自独立浏览器上下文，localStorage/IndexedDB 完全隔离）：
//   A 老用户回归：有 greeted-/cal-my-/quote-history/day-fish- 等真实痕迹 + 历史误生成的
//     cal-条目 → 首用日=最早真实痕迹；早于首用日的条目被清、点击空态不落盘；
//     首用日之后的条目原样保留；今天正常生成；未来日期仍空态（回归）。
//   B 自愈：已存 first-use-date 偏晚 + 存在更早的真实痕迹 → 取 min 前移，
//     且按前移后的首用日清掉中间区间的误生成条目。
//   C 全新用户：零痕迹 → 首用日=今天，昨天及以前空态、不生成不落盘。
//
// 注意：本工具【不执行 node build.mjs】（构建只归构建者）——按 build.mjs 同样的
// 拼装/压缩算法在内存里合成测试页直接测 src/ 最新源码；若 build.mjs 的
// cssFiles/jsFiles 数组或包装格式变化，需同步更新下面的副本。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

// ---- 与 build.mjs 一致的文件清单与压缩/包装（改动时同步） ----
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'period.js', 'accounting.js', 'garden.js', 'decision.js', 'pong.js', 'snake-game.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'mobile-adapt.js'];
const MINIFY_KEEP_LINE = 8000;
function minifyJs(code) {
  const lines = code.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length > MINIFY_KEEP_LINE) { out.push(raw); continue; }
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('//')) continue;
    out.push(t);
  }
  return out.join('\n');
}
function minifyCss(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\/\s*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}
function buildHtml() {
  const read = (p) => readFileSync(join(root, 'src', p), 'utf8');
  let html = read('template.html');
  const styles = cssFiles.map((f) => minifyCss(read(join('css', f)))).join('\n');
  const scripts = jsFiles.map((f) => {
    const code = minifyJs(read(join('js', f)));
    return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
  }).join('\n');
  html = html.replace('/*__STYLES__*/', styles);
  html = html.replace('/*__SCRIPTS__*/', scripts);
  html = html.split('__BUILD_INFO__').join('verify-cal-firstuse');
  html = html.split('__BUILD_TS__').join(String(Date.now()));
  html = html.split('__APP_VERSION__').join('v3.6.verify');
  return html;
}
const builtHtml = buildHtml();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const urlNoQ = decodeURIComponent(req.url.split('?')[0]);
    if (urlNoQ === '/' || urlNoQ === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(builtHtml);
      return;
    }
    let p = normalize(join(root, urlNoQ));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-calfu-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let msgId = 0; const pend = new Map();
function routeMessages(ws) {
  ws.onmessage = (ev) => {
    try { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } } catch (e) {}
  };
}
function connectWs(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => res(ws);
    ws.onerror = rej;
  });
}
async function openIsolatedPage() {
  // 每场景独立浏览器上下文：LS/IDB/SW 互不污染
  let blist = null;
  for (let i = 0; i < 60; i++) {
    try { blist = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/version')).json(); break; }
    catch (e) { await sleep(150); }
  }
  if (!blist) throw new Error('无法连接 Chrome 调试端口');
  const bws = await connectWs(blist.webSocketDebuggerUrl);
  routeMessages(bws);
  const bsend = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId; pend.set(id, resolve);
    bws.send(JSON.stringify({ id, method, params }));
  });
  const ctx = await bsend('Target.createBrowserContext', {});
  const t = await bsend('Target.createTarget', { url: 'about:blank', browserContextId: ctx.browserContextId });
  let info = null;
  for (let i = 0; i < 60; i++) {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    info = list.find((x) => x.id === t.targetId);
    if (info) break;
    await sleep(100);
  }
  if (!info) throw new Error('找不到新开页面');
  const pws = await connectWs(info.webSocketDebuggerUrl);
  routeMessages(pws);
  const psend = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId; pend.set(id, resolve);
    pws.send(JSON.stringify({ id, method, params }));
  });
  await psend('Page.enable');
  const evalJs = async (expr) => {
    try {
      const r = await psend('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  const close = async () => {
    try { await bsend('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
    try { await bsend('Target.disposeBrowserContext', { browserContextId: ctx.browserContextId }); } catch (e) {}
    try { pws.close(); } catch (e) {}
    try { bws.close(); } catch (e) {}
  };
  return { psend, evalJs, close };
}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 页内种子：按 ?case= 分支；每次导航先 clear 再种（隔离兜底）
const SEED_FN = `(function () {
  try { localStorage.clear(); } catch (e) {}
  var q = (location.search.match(/case=(\\w+)/) || [])[1] || '';
  var P = 'xy-home-v2:default:';
  function s(k, v) { try { localStorage.setItem(P + k, v); } catch (e) {} }
  function sLegacy(k, v) { try { localStorage.setItem('xy-home-v2:' + k, v); } catch (e) {} }
  function entry(m, msg, d) { return JSON.stringify({ mood: m, cat: '温暖', desc: 'd-' + d, activity: 'a-' + d, message: msg, date: d }); }
  if (q === 'old') {
    s('greeted-2026-7-1', '1');
    s('greeted-2026-8-1', '1');
    s('cal-my-2026-7-5', '早安');
    s('day-fish-2026-7-3', '5');
    sLegacy('greeted-2026-7-2', '1');
    s('quote-history', JSON.stringify([{ date: '2026-07-02', text: 'q' }]));
    s('cal-2026-05-01', entry('假', '不该出现的留言', '2026-05-01'));
    s('cal-2026-07-03', entry('开心', '首用后的留言', '2026-07-03'));
  } else if (q === 'heal') {
    s('first-use-date', '2026-08-20');
    s('greeted-2026-7-1', '1');
    // 前移后的首用日=2026-07-01：06-20 落在首用日前应补清理；07-10 在首用日后应保留
    s('cal-2026-06-20', entry('假', '首用前误生成', '2026-06-20'));
    s('cal-2026-07-10', entry('真', '首用后条目', '2026-07-10'));
  }
})();`;

async function enterApp(pg, caseName) {
  await pg.psend('Page.addScriptToEvaluateOnNewDocument', { source: SEED_FN });
  await pg.psend('Page.navigate', { url: baseUrl + '/index.html?case=' + caseName });
  for (let i = 0; i < 80; i++) { if (await pg.evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await pg.evalJs('(function(){var e=document.getElementById("splash-enter"); if(e&&!e.hidden) e.click();})()');
  await sleep(400);
  await pg.evalJs('(function(){var o=document.getElementById("splash-confirm-ok"); if(o&&document.getElementById("splash-confirm")&&!document.getElementById("splash-confirm").hidden) o.click();})()');
  for (let i = 0; i < 30; i++) { if (await pg.evalJs('document.getElementById("splash").classList.contains("hide")')) break; await sleep(200); }
  await sleep(300);
}
async function openCalendar(pg) {
  await pg.evalJs('(function(){var a=document.querySelector(\'.app[data-app="calendar"]\'); if(a) a.click();})()');
  await sleep(500);
}
// 日历打开时停在当前月——点历史/未来日期前先翻月到目标月份再点格子。
// 方向按当前月标签动态判断（视图可能已被上一次点击翻走，不能按与今天的距离算死方向）
async function clickCell(pg, ds) {
  return pg.evalJs('(function(){var ds="' + ds + '";var p=ds.split("-");var ty=+p[0],tm=+p[1];' +
    'for(var i=0;i<96;i++){' +
      'var t=document.getElementById("cal-month-txt").textContent||"";' +
      'if(t.indexOf(ty+" 年")>=0&&t.indexOf(tm+" 月")>=0)break;' +
      'var mm=/(\\d+) 年 (\\d+) 月/.exec(t);var cy=mm?+mm[1]:ty,cm=mm?+mm[2]:tm;' +
      'var back=(ty<cy)||(ty===cy&&tm<cm);' +
      '(back?document.getElementById("cal-prev"):document.getElementById("cal-next")).click();' +
    '}' +
    'var c=document.querySelector(".cal-cell[data-date=\\"" + ds + "\\"]");' +
    'if(!c)return "no-cell";c.click();return "ok";})()');
}

// ===== 场景 A：老用户回归 =====
{
  const pg = await openIsolatedPage();
  await enterApp(pg, 'old');
  await openCalendar(pg);
  const fu = await pg.evalJs('localStorage.getItem("xy-home-v2:default:first-use-date")');
  check('A1 首用日=最早真实痕迹 2026-07-01', fu === '2026-07-01', String(fu));
  const bogusGone = await pg.evalJs('localStorage.getItem("xy-home-v2:default:cal-2026-05-01")===null');
  check('A2 首用日之前的误生成条目已被清理', bogusGone);
  const keepReal = await pg.evalJs('!!localStorage.getItem("xy-home-v2:default:cal-2026-07-03")');
  check('A3 首用日之后的既有条目保留', keepReal);
  await clickCell(pg, '2026-05-01');
  await sleep(300);
  const st1 = await pg.evalJs('(function(){return JSON.stringify({empty:!document.getElementById("cal-empty-card").hidden, ta:document.getElementById("cal-ta-card").hidden, me:document.getElementById("cal-me-card").hidden, txt:document.getElementById("cal-empty-txt").textContent});})()');
  const o1 = JSON.parse(st1 || '{}');
  check('A4 点击 2026-05-01 显示空态卡（TA/我卡隐藏）', o1.empty && o1.ta && o1.me, st1);
  check('A5 空态文案区分「还没开始使用」', (o1.txt || '').indexOf('开始使用之前') >= 0, o1.txt);
  await clickCell(pg, '2026-06-15');
  await sleep(300);
  const st2 = await pg.evalJs('(function(){return JSON.stringify({empty:!document.getElementById("cal-empty-card").hidden, made:!!localStorage.getItem("xy-home-v2:default:cal-2026-06-15")});})()');
  const o2 = JSON.parse(st2 || '{}');
  check('A6 查看更早的无数据日期不生成不落盘', o2.empty && !o2.made, st2);
  await clickCell(pg, '2026-07-03');
  await sleep(300);
  const st3 = await pg.evalJs('(function(){return JSON.stringify({ta:!document.getElementById("cal-ta-card").hidden, msg:document.getElementById("cal-message").textContent});})()');
  const o3 = JSON.parse(st3 || '{}');
  check('A7 首用后日期正常显示既有内容', o3.ta && o3.msg === '首用后的留言', st3);
  const todayKey = await pg.evalJs('(function(){var d=new Date();var k=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");return !!localStorage.getItem("xy-home-v2:default:cal-"+k);})()');
  check('A8 今天仍正常生成', todayKey);
  await clickCell(pg, '2027-01-01');
  await sleep(300);
  const st4 = await pg.evalJs('(function(){return JSON.stringify({empty:!document.getElementById("cal-empty-card").hidden, made:!!localStorage.getItem("xy-home-v2:default:cal-2027-01-01"), txt:document.getElementById("cal-empty-txt").textContent});})()');
  const o4 = JSON.parse(st4 || '{}');
  check('A9 未来日期仍空态不生成（回归）', o4.empty && !o4.made && (o4.txt || '').indexOf('那一天') >= 0, st4);
  const jsErr = await pg.evalJs('(window.__jsErrors||[]).length');
  check('A10 无运行时异常', jsErr === 0, String(jsErr));
  await pg.close();
}

// ===== 场景 B：首用日自愈（已存偏晚 + 更早痕迹 → 取 min 并补清理） =====
{
  const pg = await openIsolatedPage();
  await enterApp(pg, 'heal');
  await openCalendar(pg);
  const fu = await pg.evalJs('localStorage.getItem("xy-home-v2:default:first-use-date")');
  check('B1 已存偏晚首用日被更早痕迹前移', fu === '2026-07-01', String(fu));
  const preGone = await pg.evalJs('localStorage.getItem("xy-home-v2:default:cal-2026-06-20")===null');
  check('B2 前移后按新首用日补清理首用前条目', preGone);
  const postKeep = await pg.evalJs('!!localStorage.getItem("xy-home-v2:default:cal-2026-07-10")');
  check('B2b 首用日之后的既有条目仍保留', postKeep);
  const jsErr = await pg.evalJs('(window.__jsErrors||[]).length');
  check('B3 无运行时异常', jsErr === 0, String(jsErr));
  await pg.close();
}

// ===== 场景 C：全新用户 =====
{
  const pg = await openIsolatedPage();
  await enterApp(pg, 'fresh');
  await openCalendar(pg);
  const todayDs = await pg.evalJs('(function(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");})()');
  const fu = await pg.evalJs('localStorage.getItem("xy-home-v2:default:first-use-date")');
  check('C1 零痕迹时首用日=今天', fu === todayDs, fu + ' vs ' + todayDs);
  const todayMade = await pg.evalJs('!!localStorage.getItem("xy-home-v2:default:cal-' + todayDs + '")');
  check('C2 今天正常生成', todayMade);
  const yds = await pg.evalJs('(function(){var d=new Date(Date.now()-86400000);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");})()');
  await clickCell(pg, yds);
  await sleep(300);
  const st = await pg.evalJs('(function(){return JSON.stringify({empty:!document.getElementById("cal-empty-card").hidden, made:!!localStorage.getItem("xy-home-v2:default:cal-' + yds + '"), txt:document.getElementById("cal-empty-txt").textContent});})()');
  const o = JSON.parse(st || '{}');
  check('C3 昨天以前（未用过）空态不生成', o.empty && !o.made && (o.txt || '').indexOf('开始使用之前') >= 0, st);
  const jsErr = await pg.evalJs('(window.__jsErrors||[]).length');
  check('C4 无运行时异常', jsErr === 0, String(jsErr));
  await pg.close();
}

try { chrome.kill(); } catch (e) {}
server.close();
const fail = results.filter((r) => !r.ok).length;
console.log('\\n===== verify-cal-firstuse: ' + (results.length - fail) + '/' + results.length + ' 通过 =====');
process.exit(fail ? 1 : 0);

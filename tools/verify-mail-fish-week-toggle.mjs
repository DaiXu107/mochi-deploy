// ===== 信箱「每周摸鱼小结寄信」开关验证（#648） =====
// 覆盖：设置行/接线静态在位 / 默认开＝周日 18 点后照常寄小结 / 关闭后 fishWeekTick 不再寄
//       （防重发标记不被写入，重新打开后补发窗口内恢复寄信）/ probe 反映键值 /
//       回复设置→信箱面板行 UI 同步 + 点击保存 + toast 文案。
// 运行前需已执行 node build.mjs（验证对象是构建产物 index.html）；不触发构建，可并行安全跑。
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

// 静态断言：构建产物含关键接线
const built = readFileSync(join(root, 'index.html'), 'utf8');
const staticChecks = [
  ['S1 设置行复选框 id="ml-fish-week-en" 在位', built.includes('id="ml-fish-week-en"')],
  ['S2 mailCfg 读取接线 fishWeekEn', built.includes("fishWeekEn: c['ml-fish-week-en'] !== undefined ? Number(c['ml-fish-week-en']) : 1")],
  ['S3 per-cid 覆盖对 ml-fish-week-en', built.includes("['ml-fish-week-en', 'fishWeekEn']")],
  ['S4 寄信判定守卫在位（防重发标记写入之前）', built.includes('if (!mailCfgFor(cid).fishWeekEn) return;')],
  ['S5 toast 名称登记 摸鱼小结寄信', built.includes("'ml-fish-week-en': '摸鱼小结寄信'")],
];
let allOk = true;
for (const [d, ok] of staticChecks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + d); if (!ok) allOk = false; }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fw-toggle-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const lsGet = (k) => evalJs(`localStorage.getItem('${k}')`);
// 清键必须走应用自身 API：xyStore 有 memoryCache（优先于 localStorage），
// 直接 localStorage.removeItem 删不掉本会话 cs.set 写入的标记/信件
const storeDel = (shortKey) => evalJs(`(function(){try{window.storeFor('default').remove(${JSON.stringify(shortKey)});return 'ok';}catch(e){return 'err:'+e.message;}})()`);
const lettersRaw = () => lsGet('xy-home-v2:default:mail-letters');
const markKeyExpr = `(function(){var n=new Date();var sun=new Date(n.getFullYear(),n.getMonth(),n.getDate()+((7-n.getDay())%7));return 'xy-home-v2:default:fish-week-report:'+(sun.getMonth()+1)+'-'+sun.getDate();})()`;
// 注入下一（或当前）周日 18:30 的时钟钩子 + 该周周五的一条摸鱼种子，返回标记键
const seedAndOverride = `(function(){
  try {
    var n = new Date();
    var sun = new Date(n.getFullYear(), n.getMonth(), n.getDate() + ((7 - n.getDay()) % 7));
    sun.setHours(18, 30, 0, 0);
    window.__fishWeekNowOverride = function () { return sun; };
    var k = 'xy-home-v2:default:fish-day-add';
    var list = []; try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
    var d = new Date(sun); d.setDate(d.getDate() - 2);
    var dk = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    list.push({ date: dk, mine: 10, ta: 5 });
    localStorage.setItem(k, JSON.stringify(list));
    return 'xy-home-v2:default:fish-week-report:' + (sun.getMonth() + 1) + '-' + sun.getDate();
  } catch (e) { return 'err:' + e.message; }
})()`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- A 组：回复设置→信箱面板 UI（行在位 / 默认开 / 点击保存 + toast）----
await gotoApp();
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
await sleep(400);
await evalJs("(function(){var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var b=c.querySelector('#splash-confirm-ok');if(b)b.click();}return true;})()");
await sleep(900);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
await sleep(700);
await evalJs("(function(){var b=document.getElementById('chat-settings-btn');if(b)b.click();return true;})()");
await sleep(400);
await evalJs("(function(){var b=document.getElementById('row-general');if(b)b.click();return true;})()");
await sleep(500);
await evalJs("(function(){var t=document.querySelector('#page-reply-settings .fav-tab[data-rp=\"mail\"]');if(t)t.click();return true;})()");
await sleep(400);
{
  const ui = JSON.parse(await evalJs(`(function(){
    var panel = document.querySelector('#page-reply-settings .gs-panel[data-rpanel="mail"]');
    if (!panel || panel.hidden) return JSON.stringify({ panel: false });
    var el = document.getElementById('ml-fish-week-en');
    var row = el ? el.closest('.gs-row') : null;
    return JSON.stringify({
      panel: true, hasEl: !!el,
      label: row && row.querySelector('span') ? row.querySelector('span').textContent : '',
      checked: el ? el.checked : null,
      inPanel: !!(el && panel.contains(el))
    });
  })()`) || '{}');
  check('A1 信箱面板含「摸鱼小结寄信」开关行', ui.panel && ui.hasEl && ui.inPanel && ui.label === '摸鱼小结寄信', JSON.stringify(ui));
  check('A2 默认开（无存量设置时勾选）', ui.checked === true, 'checked=' + ui.checked);
  await evalJs(`(function(){var el=document.getElementById('ml-fish-week-en');if(el)el.click();return true;})()`);
  await sleep(300);
  const stored = await lsGet('xy-home-v2:default:reply-ml-fish-week-en');
  const toast = await evalJs(`(function(){var t=document.getElementById('cc-toast');return t?t.textContent:'';})()`);
  check('A3 点击开关即时保存并 toast「已保存：摸鱼小结寄信（关）」', stored === '0' && String(toast).indexOf('摸鱼小结寄信') >= 0, 'stored=' + stored + ' toast=' + toast);
  await evalJs(`window.saveReplyCfg('ml-fish-week-en', 1)`);
}

// ---- B 组：寄信开关行为（默认开→寄 / 关→不寄 / 重开→补发窗口内恢复寄）----
await gotoApp();
{
  const markKey = await evalJs(seedAndOverride);
  check('B0 时钟钩子+种子就绪', typeof markKey === 'string' && markKey.indexOf('fish-week-report:') > 0, String(markKey));
  const markShort = String(markKey).slice('xy-home-v2:default:'.length);
  await storeDel('mail-letters');
  const probe1 = JSON.parse(await evalJs(`JSON.stringify(window.mailCfgForProbe ? window.mailCfgForProbe('default') : {})`) || '{}');
  let letter = null, tries = 0;
  while (tries++ < 20 && !letter) {
    await evalJs(`window.fishWeekTick && window.fishWeekTick()`);
    await sleep(500);
    const raw = await lettersRaw();
    if (raw && raw.indexOf('本周摸鱼小结') >= 0) { try { letter = JSON.parse(raw)[0]; } catch (e) {} }
  }
  check('B1 默认开：周日 18:30 后照常寄小结入信箱', !!letter && letter.tt === '本周摸鱼小结' && probe1.fishWeekEn === 1,
    'probe=' + probe1.fishWeekEn + ' letter=' + (!!letter ? letter.tt : '无'));
  check('B2 寄出后防重发标记写入', (await lsGet(markKey)) === '1');

  // 关闭开关：清信件与标记后 tick，断言零生成
  await evalJs(`window.saveReplyCfg('ml-fish-week-en', 0)`);
  const probe2 = JSON.parse(await evalJs(`JSON.stringify(window.mailCfgForProbe ? window.mailCfgForProbe('default') : {})`) || '{}');
  await storeDel('mail-letters');
  await storeDel(markShort);
  for (let i = 0; i < 4; i++) { await evalJs(`window.fishWeekTick && window.fishWeekTick()`); await sleep(300); }
  const rawOff = await lettersRaw();
  check('B3 关闭后不再寄小结（信件零生成、probe=0）', probe2.fishWeekEn === 0 && (rawOff == null || rawOff.indexOf('本周摸鱼小结') < 0), 'probe=' + probe2.fishWeekEn);

  // 重新打开：判定在标记写入之前 → 标记仍空，补发窗口内应恢复寄出
  await evalJs(`window.saveReplyCfg('ml-fish-week-en', 1)`);
  await evalJs(`window.fishWeekTick && window.fishWeekTick()`);
  await sleep(500);
  let letter2 = null;
  const raw2 = await lettersRaw();
  if (raw2 && raw2.indexOf('本周摸鱼小结') >= 0) { try { letter2 = JSON.parse(raw2)[0]; } catch (e) {} }
  check('B4 重新打开后补发窗口内恢复寄信', !!letter2 && letter2.tt === '本周摸鱼小结', (!!letter2 ? letter2.tt : '无'));
  const raw3 = await lettersRaw();
  await evalJs(`window.fishWeekTick && window.fishWeekTick()`);
  await sleep(400);
  check('B5 同一周不重复寄（标记防重仍生效）', raw3 === raw2, '');
}

const passed = results.filter((r) => r.ok).length;
console.log('\n运行时结果：' + passed + '/' + results.length + ' 项通过；静态断言 ' + staticChecks.filter(c => c[1]).length + '/' + staticChecks.length);
chrome.kill(); server.close();
process.exit(passed === results.length && staticChecks.every(c => c[1]) ? 0 : 1);

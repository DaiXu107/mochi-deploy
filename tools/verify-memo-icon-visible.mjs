// ===== #861 桌面第三页【备忘录】图标「莫名其妙不见了」行为验证 =====
// 两处已实证缺陷：
//   ①动态注入图标（备忘录/市集/心意柜/喝水/吃什么/存钱罐/番茄钟/同频/伸手）落位时躲过了
//     启动期 applyHiddenIcons（彼时尚未注入），下一次再跑要等 contact-switched ——
//     hidden-icons 名单里的图标「启动看得见、切一次桌面就消失」（红米 K80 实报）。
//     修后：window.applyDeskLayout 暴露口统一补套 → 名单图标注入即隐藏、口径与静态图标一致。
//   ②app-memo 不在装修组件库三张表（WIDGET_IDS/WIDGET_NAMES/WIDGET_PREV_HTML）——
//     同网格兄弟图标全在，唯独备忘录搜不到；图标一旦离页进隐藏池永远无法找回
//    （gift-shop.js #market 同案）。修后：装修「添加卡片」能找到备忘录。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- S 组：静态锚（产物全文池 = index.html + js/*.js，兼容内联/外置两代产物形态） ----
const poolFiles = ['index.html'].concat((() => { try { return readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f); } catch (e) { return []; } })());
const prodPool = poolFiles.map(f => { try { return String(readFileSync(join(root, f))); } catch (e) { return ''; } }).join('\n');
let srcP = ''; try { srcP = String(readFileSync(join(root, 'src/js/personalize.js'))); } catch (e) {}
const N1 = 'window.applyDeskLayout = function () { try { applyDeskLayout(); } finally { try { applyHiddenIcons(); } catch (e) {} } };';
check('S1 src personalize: window.applyDeskLayout 暴露口包一层补套 applyHiddenIcons（唯一）', srcP.split(N1).length - 1 === 1);
check('S2 产物: 同上锚在位', prodPool.includes(N1));
check('S2b src: 裸暴露 window.applyDeskLayout = applyDeskLayout 已不存在（回归即此条红）', srcP.length > 0 && !srcP.includes('window.applyDeskLayout = applyDeskLayout;'));
check('S3 src+产物: WIDGET_NAMES 登记备忘录', srcP.includes("'app-memo': '备忘录图标'") && prodPool.includes("'app-memo': '备忘录图标'"));
check('S4 src+产物: WIDGET_IDS 白名单含 app-memo', srcP.includes("'app-piggy', 'app-memo']") && prodPool.includes("'app-piggy', 'app-memo']"));
check('S5 src+产物: 组件库预览图登记', srcP.includes("'app-memo': _appIcoPrev('备忘录')") && prodPool.includes("'app-memo': _appIcoPrev('备忘录')"));

// ---- 无头环境 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (chromePath && typeof WebSocket === 'function') {
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
  const cdpPort = 9300 + Math.floor(Math.random() * 100);
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-861-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
  let ws = null, msgId = 0; const pend = new Map();
  async function cdpConnect() {
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
        const page = list.find((t) => t.type === 'page');
        if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
          ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
      } catch (e) {} await sleep(150);
    }
    throw new Error('无法连接');
  }
  function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
  async function evalJs(expr) {
    try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 200) };
      return r && r.result ? r.result.value : null; } catch (e) { return null; }
  }
  const P = 'xy-home-v2:default:';
  const MEMO = `(() => { var n = document.querySelector('[data-app="memo"][data-desk-widget="app-memo"]');
    if (!n) return { absent: true };
    var slides = document.querySelectorAll('.page-slide');
    return { disp: getComputedStyle(n).display,
      slide: Array.prototype.indexOf.call(slides, n.closest('.page-slide')),
      inGrid: !!n.closest('.app-grid'), inPool: !!n.closest('#desk-widget-pool') }; })()`;
  async function boot(waitMs = 3600) {
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(120); }
    await sleep(waitMs);
  }
  await cdpConnect(); await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 874, deviceScaleFactor: 3, mobile: true });

  // ---- A 组：隐藏名单口径一致性（本批判别面） ----
  await boot(1200);
  await evalJs(`localStorage.clear(); localStorage.setItem('${P}hidden-icons', JSON.stringify(['memo'])); 'seeded'`);
  await boot(3600);
  const a1 = await evalJs(MEMO);
  check('A1 名单含 memo：冷启动图标即 display:none（注入即套用，不再躲过启动期）', a1 && !a1.__err && !a1.absent && a1.disp === 'none', JSON.stringify(a1));
  await evalJs(`document.dispatchEvent(new Event('contact-switched')); 'fired'`);
  await sleep(700);
  const a2 = await evalJs(MEMO);
  check('A2 切桌面后仍 display:none（口径不翻转）', a2 && !a2.absent && a2.disp === 'none', JSON.stringify(a2));
  await evalJs(`localStorage.setItem('${P}hidden-icons', '[]'); document.dispatchEvent(new Event('contact-switched')); 'fired'`);
  await sleep(700);
  const a3 = await evalJs(MEMO);
  check('A3 名单清空后切桌面 → 恢复 display:flex（恢复图标路径可用）', a3 && !a3.absent && a3.disp === 'flex', JSON.stringify(a3));

  // ---- B 组：装修组件库能找回备忘录 ----
  await evalJs(`(function(){ var r = document.getElementById('row-custom-icon'); if (r) r.click(); return 'decor'; })()`);
  await sleep(500);
  await evalJs(`(function(){ var b = document.getElementById('decor-add-widget'); if (b) b.click(); return 'lib'; })()`);
  await sleep(600);
  const lib = await evalJs(`(() => { var names = [];
    document.querySelectorAll('.desk-lib-icon .dli-name').forEach(function(t){ names.push(t.textContent); });
    return { count: names.length, hasMemo: names.indexOf('备忘录') >= 0 }; })()`);
  check('B1 装修组件库图标条目含「备忘录」', lib && !lib.__err && lib.count > 0 && lib.hasMemo, JSON.stringify(lib));
  await evalJs(`(function(){ var b = document.getElementById('decor-done'); if (b) b.click(); return 'exit'; })()`);
  await sleep(300);

  // ---- C 组：无名单回归守卫（默认桌面不受伤） ----
  await evalJs('localStorage.clear(); "cleared"');
  await boot(3600);
  const c1 = await evalJs(MEMO);
  check('C1 无名单冷启动：图标在第三页网格内且可见', c1 && !c1.__err && !c1.absent && c1.slide === 2 && c1.inGrid && !c1.inPool && c1.disp === 'flex', JSON.stringify(c1));
  check('Z1 零 JS 异常', ((await evalJs('(window.__jsErrors || []).length')) || 0) === 0);
  chrome.kill(); server.close();
} else {
  check('无头环境（Chrome/Edge + Node21+）不可用，A/B/C/Z 组跳过', true);
}

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
process.exit(passed === results.length ? 0 : 1);

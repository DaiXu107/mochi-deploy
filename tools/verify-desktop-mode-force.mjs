// ===== 回归脚本：「桌面站点」模式手机伪装桌面强制走手机布局（v3.11.x 修复） =====
// 用法：node build.mjs && node tools/verify-desktop-mode-force.mjs
// 背景（用户反馈）：vivo Y35 + Edge 打开仍是 PC 端（模拟器外壳小框 + 两侧灰底），
//   只能手动关浏览器「桌面版网站」。v3.9.x 兜底靠「触摸 + screen.width<900」，
//   该机型 Edge 连 screen.width 都伪装成桌面大屏（≥900）→ 兜底失效。
// 修复：mobile-adapt.js 补不受 UA/screen 伪装影响的信号——
//   触摸 + UA 谎称桌面系统 + （window.orientation 存在 或 主输入 coarse 且无 hover）
//   → 强制手机布局；viewport 改写无效时再试显式像素宽，最后 force-mobile 类保底。
// 验证矩阵（无头桌面视口 980x800，@media(max-width:900px) 天然不命中）：
//   A  全套伪装（Win UA + screen.width=1024 + 触摸 + orientation 存在）→ force-mobile
//   D  同 A 但无 orientation API，靠 matchMedia 主输入 coarse/hover-none 伪造 → force-mobile
//   C  旧路径回归（Win UA + screen.width=360 + 触摸，v3.9.x 原判定）→ force-mobile
//   B  真桌面 PC 对照（Win UA + screen.width=1024 + 无触摸）→ 不加 force-mobile，
//      .phone 保持 390px 模拟器外壳
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dmode-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return; await sleep(200); }
};

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

try {
  await cdpConnect();
  await cdp('Page.enable');

  // 预注入脚本：按 ?dmcase= 分场景在站点脚本执行前伪造设备环境
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    (function () {
      var q = new URLSearchParams(location.search).get('dmcase') || '';
      if (q === 'b') return; // 真桌面对照组：不伪造触摸
      try { Object.defineProperty(window.screen, 'width', { get: function () { return q === 'c' ? 360 : 1024; }, configurable: true }); } catch (e) {}
      try { Object.defineProperty(window.screen, 'availWidth', { get: function () { return q === 'c' ? 360 : 1024; }, configurable: true }); } catch (e) {}
      try { Object.defineProperty(navigator, 'maxTouchPoints', { get: function () { return 5; }, configurable: true }); } catch (e) {}
      try { window.ontouchstart = null; } catch (e) {}
      // C 场景只验旧窄屏判定，无需后续伪造
      if (q === 'c') return;
      // D 场景：无 orientation API，改伪造主输入媒体查询（coarse + 无 hover）
      if (q !== 'd') {
        try { Object.defineProperty(window, 'orientation', { get: function () { return 0; }, configurable: true }); } catch (e) {}
      }
      var mm = window.matchMedia ? window.matchMedia.bind(window) : null;
      if (mm) window.matchMedia = function (query) {
        if (/pointer:\\s*coarse/.test(query) || /hover:\\s*none/.test(query)) {
          return { matches: true, media: query, onchange: null,
            addEventListener: function () {}, removeEventListener: function () {},
            addListener: function () {}, removeListener: function () {},
            dispatchEvent: function () { return false; } };
        }
        return mm(query);
      };
    })();
  ` });

  const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
  const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; vivo Y35) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

  async function loadCase(caseName) {
    await cdp('Network.setUserAgentOverride', { userAgent: caseName === 'b' ? WIN_UA : (caseName === 'legacy' ? ANDROID_UA : WIN_UA) });
    await cdp('Page.navigate', { url: baseUrl + '/index.html?dmcase=' + caseName });
    await waitReady();
    await sleep(1400); // 等 rAF 复查链（1帧→像素宽改写→2帧→force-mobile 类）跑完
    return evalJs(`(function(){
      var de = document.documentElement;
      var ph = document.querySelector('.phone');
      var cs = ph ? getComputedStyle(ph) : null;
      var meta = document.querySelector('meta[name="viewport"]');
      return {
        cls: de.className || '',
        hasForce: de.classList.contains('force-mobile'),
        hasTablet: de.classList.contains('tablet'),
        phoneW: cs ? cs.width : '',
        ghostInputs: document.querySelectorAll('.ce-ghost').length,
        metaContent: meta ? meta.getAttribute('content') : ''
      };
    })()`);
  }

  // ---- A：vivo Y35 + Edge「桌面站点」全套伪装 ----
  const a = await loadCase('a');
  check('A 全套伪装→强制手机布局(force-mobile)', a.hasForce === true, a.cls);
  check('A 未误判为平板', a.hasTablet === false, String(a.hasTablet));
  check('A 手机端输入转换已启用(isMobile 生效)', a.ghostInputs > 0, String(a.ghostInputs));
  check('A .phone 铺满视口宽(980 布局下不再 390 小框)', /^\d{3,4}px$/.test(a.phoneW) && parseFloat(a.phoneW) > 500, a.phoneW);

  // ---- D：orientation 缺失，主输入 coarse/hover-none 路径 ----
  const d = await loadCase('d');
  check('D 无 orientation+coarse/hover 伪造→force-mobile', d.hasForce === true, d.cls);

  // ---- C：旧路径回归（窄 screen.width，v3.9.x 判定不受影响）----
  const c = await loadCase('c');
  check('C 窄屏伪装旧路径仍生效→force-mobile', c.hasForce === true, c.cls);

  // ---- B：真桌面 PC 对照（无触摸）----
  const b = await loadCase('b');
  check('B 真桌面不加 force-mobile', b.hasForce === false, b.cls);
  check('B 桌面模拟器外壳保留(.phone=390px)', b.phoneW === '390px', b.phoneW);

  console.log('\\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  chrome.kill();
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error('脚本异常:', e.message);
  try { chrome.kill(); } catch (e2) {}
  process.exit(1);
}

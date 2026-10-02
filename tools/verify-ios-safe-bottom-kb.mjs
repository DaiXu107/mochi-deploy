// ===== 验证 #556：iOS 键盘期底部安全区归零（聊天输入栏与输入法之间不再露白带） =====
// 背景（iPhone 16 Pro / iOS 18.7 主屏幕 standalone，用户明说多机型同现；设置里的全屏模式同现）：
//   iOS 键盘是覆盖式，键盘在场时 env(safe-area-inset-bottom) 仍报 Home 指示条高度
//   （Face ID 机型=34px），聊天输入栏底内边距 calc(10px + var(--mochi-safe-bottom, env(...)))
//   在 standalone 下回落 env() → 输入栏被 34px 死带垫高，其与键盘之间露一段不受页面
//   控制的空白。安卓同症状已由 #530（syncSafeBottomA）修复；本条为 #530 的 iOS 镜像：
//   syncSafeBottom 键盘在场（_kbActive/_iProv/_kbNowLike）期间把变量钉 0px，收起摘除回落 env()。
// 验证方式（自组装临时站点，iPhone UA + 390×844 + navigator.standalone=true 模拟主屏幕；
// visualViewport.height 覆写模拟键盘收缩——与 verify-ios-pwa-kbd.mjs 同款垫片）：
//   S1 无键盘初态变量为空（#129 语义：standalone 摘除回落 env 正确避让 Home 条，不许常态归零）
//   S2 键盘开启（vv.height→400）后变量=0px（输入栏不再被 env 死带垫高）
//   S3 键盘收起后变量摘除（回落 env 语义恢复）
//   S4 键盘期输入栏仍正常停靠可视区内（#556 不破坏既有停靠链）
// 用法：
//   node tools/verify-ios-safe-bottom-kb.mjs          # src 自组装（默认）
//   PRODUCT=1 node tools/verify-ios-safe-bottom-kb.mjs # 测构建产物（修复前产物 S2 应 FAIL=RED 基线）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) : '') + (detail !== undefined ? ']' : ''));
}
const useProduct = process.env.PRODUCT === '1';

// ---- A 组：源码静态断言（哨兵已锚三处；这里再锚行为链完整性） ----
if (!useProduct) {
  const ma = readFileSync(join(root, 'src', 'js', 'mobile-adapt.js'), 'utf8');
  check('A1 syncSafeBottom 键盘在场判据（_kbActive/_iProv/_kbNowLike 三信号）',
    /if \(_kbActive \|\| _iProv \|\| _kbNowLike\(\)\) \{ \/\/ #556/.test(ma));
  // #1416 起这一发走唯一写入点 syncBottomSafe('pin')（落值逐字仍是 0px）；两种写法都算过＝同一把尺能量新旧两版产物
  check('A2 键盘期写 0px（走唯一写入点；旧写法＝判据分支内直写 setProperty）',
    /syncBottomSafe\('pin'\); \/\/ #556|setProperty\('--mochi-safe-bottom', '0px'\); \/\/ #556/.test(ma));
  check('A3 键盘开启路径显式调用（syncIosKb 开启分支，防 vv 事件漏触发）',
    /syncSafeBottom\(\); \/\/ #556：键盘开启即归零/.test(ma));
  check('A4 推定停靠路径同样调用（_iProvDock）',
    /syncSafeBottom\(\); \/\/ #556：推定停靠/.test(ma));
}

// ---- 组装临时站点（文件清单从 build.mjs 提取，防手抄漂移；解析守卫跳过并行改动中文件） ----
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-ios-sbkb-'));
let server = null, chrome = null;
try {
  if (useProduct) {
    writeFileSync(join(tmpSite, 'index.html'), readFileSync(join(root, 'index.html')));
  } else {
    const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
    const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
    const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
    const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
    const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
    const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
    if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
    const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
    const skipped = [];
    const jsAll = jsFiles.map((f) => {
      let code = '';
      try { code = readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
      const wrapped = '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("' + f + ': " + String(__e && __e.message || __e)); } })();';
      try { new vm.Script(wrapped); return wrapped; } catch (e) {
        skipped.push(f);
        return 'try { if (window.__jsErrors) window.__jsErrors.push("' + f + ': [parse-skip] 并行改动中，本验证跳过"); } catch (x) {}';
      }
    }).join('\n');
    globalThis.__skippedFiles = skipped;
    const outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
    writeFileSync(join(tmpSite, 'index.html'), outHtml);
    if (skipped.includes('mobile-adapt.js')) { console.error('mobile-adapt.js 处于并行编辑中解析失败，本验证无效，稍后重跑'); process.exit(1); }
  }

  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
  server = createServer((req, res) => {
    try {
      let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
      if (statSync(p).isDirectory()) p = join(p, 'index.html');
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
  if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

  const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ios-sbkb-' + Date.now()),
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

  await cdp('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
  });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__jsErrors = [];
  try { Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }); } catch(e){ window.__nsFail = 1; }
})();
` });

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

  const skipList = globalThis.__skippedFiles || [];
  if (skipList.length) console.log('WARN  解析守卫跳过（并行改动中）: ' + skipList.join(', '));
  const bootErrs = JSON.parse(await evalJs('JSON.stringify(window.__jsErrors || [])'));
  const realErrs = bootErrs.filter((s) => String(s).indexOf('[parse-skip]') < 0);
  check('R1 启动无非跳过模块报错', realErrs.length === 0, { errs: bootErrs });

  // visualViewport.height 覆写（加载后补写同实例；__kbH 模拟键盘收缩量）
  const vvRedef = await evalJs(`(function(){
    try {
      var vv = window.visualViewport;
      if (!vv) return 'no-vv';
      Object.defineProperty(vv, 'height', { configurable: true, get: function(){ return window.__kbH || window.innerHeight; } });
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: function(){ return window.__kbOff || 0; } });
      Object.defineProperty(vv, 'offsetLeft', { configurable: true, get: function(){ return 0; } });
      return 'ok';
    } catch (e) { return 'err:' + e; }
  })()`);
  check('R1b visualViewport 覆写就绪（height 可控模拟键盘）', vvRedef === 'ok', vvRedef);

  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(1200);
  await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
  await sleep(500);

  await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return !!app; })()`);
  await sleep(700);
  for (let i0 = 0; i0 < 20; i0++) {
    const vis = await evalJs(`(function(){ var p=document.getElementById('page-chat'); return p && !p.hidden; })()`);
    if (vis) break;
    await sleep(250);
  }
  const focusOk = await evalJs(`(function(){
    var el = document.getElementById('chat-input');
    if (!el) return 'no-input';
    el.focus();
    return document.activeElement === el || document.activeElement === document.body ? 'focused' : 'other';
  })()`);
  const standaloneCls = await evalJs(`document.documentElement.classList.contains('ios-pwa-standalone')`);
  check('R0 前置：standalone 类已加 + 聊天页可见 + 输入框已聚焦',
    standaloneCls === true && focusOk === 'focused', { standaloneCls, focusOk, product: useProduct });

  const varNow = () => evalJs(`(document.documentElement.style.getPropertyValue('--mochi-safe-bottom') || '')`);

  // S1 无键盘初态：变量必须为空（#129：standalone 摘除回落 env 避让 Home 条）
  const s1 = await varNow();
  check('S1 无键盘初态 --mochi-safe-bottom 为空（standalone 回落 env 避让语义保持）', s1 === '', s1);

  // 无头 Chrome 对 contenteditable 的程序化 focus 不派发 focusin（activeElement 停在
  // body，_textFocused 恒空 = 键盘开启链路整体跳过——verify-ios-kb-edge-scroll.mjs
  // 同款绕法：合成 FocusEvent 补发）。touchstart + focus + focusin + 收缩同帧同步，
  // 复刻真机「手指点输入栏 → 键盘弹出」时序。
  const kbOpen = await evalJs(`(function(){
    try {
      document.dispatchEvent(new Event('touchstart'));
      var i = document.getElementById('chat-input');
      if (!i) return 'no-input';
      i.focus();
      i.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      window.__kbH = 400;
      window.visualViewport.dispatchEvent(new Event('resize'));
      return 'opened';
    } catch (e) { return 'err:' + e; }
  })()`);
  check('S2pre 键盘开启序列已派发（focusin 合成 + vv 收缩）', kbOpen === 'opened', kbOpen);
  await sleep(1000); // 覆盖 _pinUntil(500ms) 动画窗口 + 至少 1 个 250ms 轮询 tick
  const s2 = await varNow();
  check('S2 键盘期 --mochi-safe-bottom=0px（#556 核心：输入栏不再被 env 死带垫高）', s2 === '0px', s2);
  const dock = JSON.parse(await evalJs(`(function(){
    var p = document.querySelector('.phone');
    var inp = document.getElementById('chat-input').closest('.chat-input-row') || document.getElementById('chat-input');
    var ri = inp.getBoundingClientRect();
    return JSON.stringify({ inpBottom: Math.round(ri.bottom), phoneH: Math.round(p.getBoundingClientRect().height) });
  })()`));
  check('S4 键盘期输入栏仍停靠可视区内（bottom ≤ 400+容差，#556 不破坏停靠链）',
    dock.inpBottom <= 404, dock);

  // S3 键盘收起 → 变量摘除（回落 env 语义恢复）
  await evalJs(`(function(){
    try {
      var i = document.getElementById('chat-input');
      if (i) { i.blur(); i.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }
      window.__kbH = null;
      window.visualViewport.dispatchEvent(new Event('resize'));
      return true;
    } catch (e) { return false; }
  })()`);
  await sleep(1000);
  const s3 = await varNow();
  check('S3 键盘收起后 --mochi-safe-bottom 摘除（回落 env 避让 Home 条语义恢复）', s3 === '', s3);

  const pass = results.filter(r => r.ok).length;
  console.log('---- ' + pass + '/' + results.length + ' PASS' + (useProduct ? '（产物级）' : ''));
  process.exitCode = pass === results.length ? 0 : 1;
} finally {
  try { if (chrome) chrome.kill(); } catch (e) {}
  try { if (server) server.close(); } catch (e) {}
}

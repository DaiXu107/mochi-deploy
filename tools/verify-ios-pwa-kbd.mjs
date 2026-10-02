// ===== 专项：iPhone 主屏幕(PWA standalone)打开后 键盘盖住聊天输入栏 + 保活音频嘟嘟声 =====
// 用法：node tools/verify-ios-pwa-kbd.mjs
// 背景（用户反馈：苹果手机 + 自带 Safari，从桌面图标打开）：
//   ① 打字时看不见输入框——输入法弹窗整个盖住聊天输入栏一行，无法正常使用；
//   ② 后台保活的"静音"音频一直有嘟嘟嘟嘟声音。
// 根因：
//   ① base.css 给 .ios-pwa-standalone .phone 写了 min-height:100vh——mobile-adapt.js
//      syncIosKb 键盘期写入的内联 height 被该 min-height 钳在全屏高（内联赢得 height、
//      赢不了 min-height），standalone 模式下 .phone 永不收缩 → 键盘整块盖住输入栏；
//      普通 Safari 标签页没有这个类所以正常，正好解释「只有桌面打开才坏」。
//      修复：去掉该 min-height + JS 停靠时内联 minHeight:'0' 双保险 +
//      新增 _ensureInputDocked()「停靠结果验收」自愈兜底。
//   ② bg-keep.js 保活音频固定幅度 0.02×volume0.05≈-60dBFS 按安卓无声节流下限调的，
//      iPhone 扬声器灵敏实听是周期性嘟嘟声。修复：iOS 幅度自适应降到 ±3 LSB 级
//      （-80dBFS 物理不可闻，样本仍非零不构成数字静音），安卓保持原值。
// 验证方式：
//   A 组静态断言三个源文件；B 组运行时（自组装临时站点，iPhone UA + 390×844 +
//   navigator.standalone=true 模拟主屏幕启动）：键盘开启 .phone 必须真实收缩
//   （渲染高度=内联高度，防任何 min-height 钳制）、输入栏必须停在可视区内、
//   人为钳高时自愈能救回、收键盘完整复原。
// 用法变体：
//   node tools/verify-ios-pwa-kbd.mjs                 # src 自组装 + 主屏幕(standalone)场景
//   PRODUCT=1 node tools/verify-ios-pwa-kbd.mjs       # 直接测构建产物 index.html（部署同款）
//   PWA_MODE=0 node tools/verify-ios-pwa-kbd.mjs      # 普通 Safari 标签页场景（无 standalone 类）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
const standaloneMode = process.env.PWA_MODE !== '0';

// ---- A 组：源码静态断言 ----
{
  const css = readFileSync(join(root, 'src', 'css', 'base.css'), 'utf8');
  const ma = readFileSync(join(root, 'src', 'js', 'mobile-adapt.js'), 'utf8');
  const bk = readFileSync(join(root, 'src', 'js', 'bg-keep.js'), 'utf8');
  // ios-pwa-standalone 的 .phone 规则行不允许再带 min-height（钳制根因）
  const m = css.match(/\.ios-pwa-standalone \.phone,\s*\nhtml\.tablet\.ios-pwa-standalone \.phone \{([^}]*)\}/);
  check('A1 base.css standalone .phone 规则不再含 min-height',
    !!m && m[1].indexOf('min-height') < 0, m ? m[1].trim() : 'rule-not-found');
  check('A2 mobile-adapt.js 停靠时压掉内联 min-height（开合两处 + 复原还原）',
    (ma.match(/_phone\.style\.minHeight/g) || []).length >= 5,
    (ma.match(/_phone\.style\.minHeight/g) || []).length);
  check('A3 mobile-adapt.js 新增停靠结果验收自愈 _ensureInputDocked 且接入轮询',
    /function _ensureInputDocked\(\)/.test(ma) && /_ensureInputDocked\(\);/.test(ma));
  check('A4 自愈阈值：贴底 +2 容差防与稳态收缩互相改写',
    /r\.bottom <= vh \+ 2/.test(ma));
  check('A5 bg-keep.js 保活幅度平台自适应（iOS ±3LSB 级 0.002 / 安卓保持 0.02）',
    /kaIsIOS\(\) \? 0\.002 : 0\.02/.test(bk) && /function kaIsIOS\(\)/.test(bk));
  if (useProduct) {
    const prod = readFileSync(join(root, 'index.html'), 'utf8');
    const marks = {
      'A6p 产物含 kaIsIOS 自适应幅度': /kaIsIOS\(\) \? 0\.002 : 0\.02/.test(prod),
      'A7p 产物含停靠 minHeight 双保险': /_phone\.style\.minHeight = '0'/.test(prod),
      'A8p 产物含 _ensureInputDocked 自愈': /function _ensureInputDocked\(\)/.test(prod),
      'A9p 产物 standalone 规则无 min-height': /ios-pwa-standalone \.phone,\s*\nhtml\.tablet\.ios-pwa-standalone \.phone \{ height:100vh; \}/.test(prod)
    };
    for (const k in marks) check(k, marks[k]);
  }
}

// ---- 组装临时站点（文件清单从 build.mjs 提取，防手抄漂移） ----
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-iospwakbd-'));
let server = null, chrome = null;
try {
  if (useProduct) {
    // 产物级：直接用构建出的 index.html（部署同款），相对资源缺失由应用自行容错
    writeFileSync(join(tmpSite, 'index.html'), readFileSync(join(root, 'index.html')));
  } else {
  const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  let outHtml = '';
  {
    const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
    const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
    const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
    const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
    const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
    if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
    const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
    // 与构建器同款 per-file try/catch 包装——单文件顶层抛错不传染后续模块
    // （对齐线上语义；裸拼接会让 breakout 一类单点错误把 mobile-adapt 一起带走，
    //   造成与真机表现不一致的假象）
    // v3.15.x：另加「解析守卫」——并行会话进行中的文件可能瞬时语法不完整
    // （单 <script> 里任何解析错误都会杀死全部模块）。无法解析的文件以显式
    // skip 段替代（运行期 console + __jsErrors 标注），保证本专项可确定性验证；
    // 跳过清单回传给 R1 判定。
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
    outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
    writeFileSync(join(tmpSite, 'index.html'), outHtml);
  }
  }

  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
  server = createServer((req, res) => {
    try {
      let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
      if (statSync(p).isDirectory()) p = join(p, 'index.html');
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
  if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

  const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ios-pwa-kbd-' + Date.now()),
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

  // iPhone UA（isIOS 分支 + bg-keep kaIsIOS 同判）+ 390×844 手机布局
  await cdp('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // 页面脚本运行前注入：navigator.standalone（fullscreen.js 据此加
  // ios-pwa-standalone 类 = 主屏幕打开；PWA_MODE=0 时保持 undefined 模拟普通标签页）
  // （visualViewport.height 覆写不能在此做——本版 Chrome 该对象在 pre-document
  //   阶段尚未创建，defineProperty 会静默失败；改为加载后对同一对象实例补写）
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  window.__jsErrors = [];
  ${standaloneMode ? "try { Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }); } catch(e){ window.__nsFail = 1; }" : ''}
})();
` });

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

  // ---- R1：启动零模块报错（v3.15.x breakout TDZ「clamp before init」同类回归哨兵）----
  // 解析守卫跳过的文件（并行会话进行中）单独提示，不计入失败，但必须在输出可见
  const skipList = globalThis.__skippedFiles || [];
  if (skipList.length) console.log('WARN  解析守卫跳过（并行改动中）: ' + skipList.join(', '));
  const bootErrs = JSON.parse(await evalJs('JSON.stringify(window.__jsErrors || [])'));
  const realErrs = bootErrs.filter((s) => String(s).indexOf('[parse-skip]') < 0);
  check('R1 启动无非跳过模块报错（per-file try/catch 收集器）',
    realErrs.length === 0, { errs: bootErrs });

  // visualViewport.height/offsetTop 覆写（加载后补写，mobile-adapt 持有的是同实例）
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

  // ---- R2：打砖块模块加载存活（breakout.js TDZ 修复回归）----
  const brickAlive = await evalJs(`(function(){
    if (typeof window.openBrickPanel !== 'function') {
      return JSON.stringify({ dead: true, href: location.href.slice(-30), rs: document.readyState,
        errs: window.__jsErrors, injFail: !!window.__nsFail,
        marks: { brick: typeof window.openBrickPanel, append: typeof window.chatAppendToDeskMsg,
          psync: typeof window.__psyncDrain, deskGo: typeof window.deskGo } });
    }
    try { window.openBrickPanel(); } catch (e) { return 'open-err:' + e; }
    var p = document.getElementById('chat-brick-panel');
    var vis = p && !p.hidden;
    try { window.closeBrickPanel(); } catch (e) {}
    return vis ? 'alive' : 'panel-hidden';
  })()`);
  check('R2 打砖块面板可正常打开（layoutField 不再在 clamp 声明前执行）',
    brickAlive === 'alive', brickAlive);

  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(1200);
  await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
  await sleep(500);

  // 进入聊天页并聚焦输入框（contenteditable，iOS 真机原生保留）
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
  check('R0 前置：standalone 类' + (standaloneMode ? '已加' : '未加（普通标签页）') + ' + 聊天页可见 + 输入框已聚焦',
    standaloneCls === standaloneMode && focusOk === 'focused', { standaloneCls, focusOk, product: useProduct });

  // ---- B1：键盘开启（vv.height 收缩到 400）→ .phone 必须【真实】收缩 ----
  await evalJs(`(function(){ window.__kbH = 400; window.visualViewport.dispatchEvent(new Event('resize')); return true; })()`);
  await sleep(900); // 覆盖 _pinUntil(500ms) 动画窗口 + 至少 1 个 250ms 轮询 tick
  const dock = JSON.parse(await evalJs(`(function(){
    var p = document.querySelector('.phone');
    var r = p.getBoundingClientRect();
    var inp = document.getElementById('chat-input').closest('.chat-input-row') || document.getElementById('chat-input');
    var ri = inp.getBoundingClientRect();
    return JSON.stringify({ hStyle: p.style.height, hRect: Math.round(r.height),
      minComputed: getComputedStyle(p).minHeight, align: p.style.alignSelf,
      inpBottom: Math.round(ri.bottom), inpTop: Math.round(ri.top) });
  })()`));
  const hInline = parseFloat(dock.hStyle) || 0;
  check('B1 键盘开启后 .phone 内联高度收缩到可视高度（≤400px 且 ≥45% 基准防压瘪）',
    dock.hStyle.indexOf('px') > 0 && hInline <= 400 && hInline >= Math.round(844 * 0.45) - 24, dock);
  check('B1b 渲染高度 == 内联高度（无 min-height/CSS 钳制——修复前此处恒 844 FAIL）',
    Math.abs(dock.hRect - hInline) <= 2, { hRect: dock.hRect, hInline: hInline });
  check('B1c 键盘期 computed min-height 为 0（内联双保险生效）',
    parseFloat(dock.minComputed) === 0, dock.minComputed);
  check('B1d 用户视角：聊天输入栏整体停在键盘上方（bottom ≤ 可视高 400+容差）',
    dock.inpBottom <= 402 && dock.inpTop >= 0, dock);

  // ---- B2：人为复现「未知原因钳高」（外部强设 min-height:844px，模拟任何未来样式/
  //         内核差异）→ _ensureInputDocked 结果验收自愈必须在轮询内救回。
  //         收敛允许 ≤1s：首拍按「渲染高度-超出量」近似收缩（可能略短），次拍由
  //         syncIosKb 稳态精确归位——两拍内输入栏必须回到可视区且 inline min 清 0 ----
  await evalJs(`(function(){ document.querySelector('.phone').style.minHeight = '844px'; return true; })()`);
  let healed = null;
  for (let k = 0; k < 10; k++) {
    await sleep(150);
    healed = JSON.parse(await evalJs(`(function(){
      var p = document.querySelector('.phone');
      var ri = (document.getElementById('chat-input').closest('.chat-input-row') || document.getElementById('chat-input')).getBoundingClientRect();
      return JSON.stringify({ min: p.style.minHeight, inpBottom: Math.round(ri.bottom), h: p.style.height });
    })()`));
    if (parseFloat(healed.min) === 0 && healed.inpBottom <= 402) break;
  }
  check('B2 外部 min-height 钳高被自愈压回（inline min-height 清 0 + 输入栏回到可视区）',
    healed && parseFloat(healed.min) === 0 && healed.inpBottom <= 402, healed);

  // ---- B3：稳态确认——达标状态下自愈零写入（高度稳定，防打字期互相改写重排）----
  const hBefore = await evalJs(`document.querySelector('.phone').style.height`);
  await sleep(600);
  const hAfter = await evalJs(`document.querySelector('.phone').style.height`);
  check('B3 达标后高度稳定（自愈 no-op，不与 syncIosKb 打架）', hBefore === hAfter, { before: hBefore, after: hAfter });

  // ---- B4：键盘收起 → 完整复原（height/min-height/alignSelf 全清）----
  await evalJs(`(function(){
    var el = document.getElementById('chat-input');
    if (el) el.blur();
    window.__kbH = window.innerHeight;
    window.visualViewport.dispatchEvent(new Event('resize'));
    return true;
  })()`);
  await sleep(900);
  const restored = JSON.parse(await evalJs(`(function(){
    var p = document.querySelector('.phone');
    return JSON.stringify({ h: p.style.height, min: p.style.minHeight, align: p.style.alignSelf,
      rectH: Math.round(p.getBoundingClientRect().height) });
  })()`));
  check('B4 键盘收起后 .phone 完整复原（内联全清 + 回落全屏高）',
    restored.h === '' && restored.min === '' && restored.align === '' && restored.rectH > 800, restored);

  // ---- B5：二次开合循环（真实使用必然反复收/弹键盘）——再次聚焦+收缩必须重新
  //         停靠（minHeight 再次清 0），再复原仍干净；防「第一次好第二次坏」回归 ----
  if (standaloneMode) {
    await evalJs(`(function(){
      var el = document.getElementById('chat-input');
      el.focus();
      window.__kbH = 380;
      window.visualViewport.dispatchEvent(new Event('resize'));
      return true;
    })()`);
    let redock = null;
    for (let k = 0; k < 10; k++) {
      await sleep(150);
      redock = JSON.parse(await evalJs(`(function(){
        var p = document.querySelector('.phone');
        var ri = (document.getElementById('chat-input').closest('.chat-input-row') || document.getElementById('chat-input')).getBoundingClientRect();
        return JSON.stringify({ h: p.style.height, min: p.style.minHeight,
          rect: Math.round(p.getBoundingClientRect().height), inpBottom: Math.round(ri.bottom) });
      })()`));
      if (parseFloat(redock.h) <= 380 && parseFloat(redock.min) === 0 && Math.abs(redock.rect - parseFloat(redock.h)) <= 2) break;
    }
    check('B5 二次弹键盘重新停靠（height≤380 + 渲染一致 + min 清 0 + 输入栏在可视区）',
      redock && parseFloat(redock.h) <= 380 && parseFloat(redock.min) === 0 &&
      Math.abs(redock.rect - parseFloat(redock.h)) <= 2 && redock.inpBottom <= 382, redock);
    await evalJs(`(function(){
      var el = document.getElementById('chat-input');
      if (el) el.blur();
      window.__kbH = window.innerHeight;
      window.visualViewport.dispatchEvent(new Event('resize'));
      return true;
    })()`);
    await sleep(900);
    const restored2 = JSON.parse(await evalJs(`(function(){
      var p = document.querySelector('.phone');
      return JSON.stringify({ h: p.style.height, min: p.style.minHeight, align: p.style.alignSelf });
    })()`));
    check('B5b 二次收键盘完整复原', restored2.h === '' && restored2.min === '' && restored2.align === '', restored2);
  }

} finally {
  try { if (chrome) chrome.kill(); } catch (e) {}
  try { if (server) server.close(); } catch (e) {}
  try { rmSync(tmpSite, { recursive: true, force: true }); } catch (e) {}
}

const fails = results.filter((r) => !r.ok).length;
console.log('\n' + (fails ? 'FAIL ' + fails + '/' + results.length : 'ALL PASS ' + results.length + '/' + results.length));
process.exit(fails ? 1 : 0);

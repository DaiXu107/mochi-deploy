// ===== 回归脚本（#664）：发消息时底部输入栏「弹跳一下」——iOS 清空管线走错分支 =====
// 用户报障（iPhone 17 / iOS 18.7 / 自带 Safari 主屏幕打开＝standalone，用户明说
// 「安卓没有这个情况」「其他设备型号也有出现」，并要求不要覆盖修改引发跨机型回归）：
//   聊天页面，发送消息时底部输入栏这一行会弹跳一下然后才恢复正常。
//
// 根因（零机型分支：判据是「焦点状态」，不是设备型号）：
//   chat.js clearChatInput 用 `document.activeElement === input` 判「输入框是否仍聚焦」，
//   聚焦态才走 execCommand 编辑管线清空（本函数注释：#115/#215 家族实测——聚焦中的
//   contenteditable 直写 textContent='' 会让输入法把刚提交的组合文本整体写回，迟到且
//   常不派发 input 事件）。而 iOS Safari 在 contenteditable 聚焦时【常返回
//   document.activeElement === <body>】——mobile-adapt.js iOS 分支的 _textFocused
//   （focusin 自记）就是为这同一个内核行为而存在的。⇒ iOS 上判据恒假 → 走「非聚焦
//   直写」分支 → 发出去的消息在输入栏里复活，只能等 200ms 的迟到兜底清掉：
//   「消息发出去了，输入栏还留着内容」+ 输入栏这一行先弹回旧内容再复位。
//   安卓 activeElement 正确（取 execCommand 分支）故无此现象，正好对上用户「安卓没有」。
//
// 修复：①补一个与平台无关的焦点信号（focusin/focusout 自记 + 选区落在输入框内的第二判据
//   inputStillFocused），聚焦态一律走 execCommand 管线；②迟到兜底首次复查 200ms → 60ms
//   （写回若仍发生，复活窗口从 ~200ms 收到 1~2 帧）；判据与后两次完全一致，不吞用户重打的字。
//
// 用法：node tools/verify-ios-send-clear.mjs            # src 自组装（修复后 = GREEN）
//       PRODUCT=1 node tools/verify-ios-send-clear.mjs  # 测构建产物（未含本修复时 B1 红 = RED 基线）
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
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}
const useProduct = process.env.PRODUCT === '1';

// ---- A 组：源码静态锚 ----
if (!useProduct) {
  const cj = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
  check('A1 输入框焦点自记在位（focusin/focusout 维护 inputFocused）',
    /let inputFocused = false;/.test(cj) && /addEventListener\('focusin', function \(\) \{ inputFocused = true; \}\)/.test(cj));
  check('A2 清空管线改用能力判据 inputStillFocused（focusin/focusout 自记）',
    /function inputStillFocused\(\)/.test(cj) && /input\.isContentEditable && inputStillFocused\(\)/.test(cj)
    && /return document\.activeElement === input \|\| inputFocused;/.test(cj));
  check('A2b 焦点判据不采用 DOM 选区（程序化失焦后选区仍在输入框内＝误弹输入法）',
    !/getSelection\(\)[\s\S]{0,120}input\.contains/.test(cj));
  check('A3 聚焦态清空仍走 execCommand 编辑管线（#115/#215 语义未改）',
    /document\.execCommand\('selectAll', false, null\)/.test(cj) && /document\.execCommand\('delete', false, null\)/.test(cj));
  check('A4 迟到兜底首次复查提前（60ms 档在位）', /\[60, 200, 800\]\.forEach/.test(cj));
  check('A5 旧判据（恒假路径）已从清空管线移除',
    !/input\.isContentEditable && document\.activeElement === input\)/.test(cj));
}

const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-iossend-'));
let server = null, chrome = null;
try {
  if (useProduct) {
    writeFileSync(join(tmpSite, 'index.html'), readFileSync(join(root, 'index.html')));
  } else {
    const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
    const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
    const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
    const cssFiles = parseArr(bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/));
    const jsFiles = parseArr(bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/));
    if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
    const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
    const skipped = [];
    const jsAll = jsFiles.map((f) => {
      let code = '';
      try { code = readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
      const wrapped = '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("' + f + ': " + String(__e && __e.message || __e)); } })();';
      try { new vm.Script(wrapped); return wrapped; } catch (e) {
        skipped.push(f);
        return 'try { if (window.__jsErrors) window.__jsErrors.push("' + f + ': [parse-skip] 并行改动中"); } catch (x) {}';
      }
    }).join('\n');
    globalThis.__skippedFiles = skipped;
    writeFileSync(join(tmpSite, 'index.html'), html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll));
    if (skipped.includes('chat.js')) { console.error('chat.js 并行编辑中解析失败，本验证无效，稍后重跑'); process.exit(1); }
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
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-iossend-' + Date.now()),
    '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
      if (r && r.exceptionDetails) {
        console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 240));
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 440, height: 956, deviceScaleFactor: 3, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){ window.__jsErrors=[];
  try { Object.defineProperty(navigator,'standalone',{configurable:true,value:true}); } catch(e){}
})();` });

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

  const bootErrs = JSON.parse(await evalJs('JSON.stringify(window.__jsErrors || [])'));
  const realErrs = bootErrs.filter((s) => String(s).indexOf('[parse-skip]') < 0);
  check('R1 启动无非跳过模块报错', realErrs.length === 0, { errs: bootErrs.slice(0, 4) });

  // 开屏进入（.splash:not(.hide) ~ .phone{visibility:hidden}——不开屏隐藏，整个 .phone
  // 不可见，contenteditable 的 innerText 在不可见元素上恒为 ''，应用内部按 innerText
  // 读文本的守卫会变成哑的）：年龄勾选 → 滑到底 → 点进入 → 强制公告页滑到底 → 确认进入
  for (let i = 0; i < 12; i++) {
    await evalJs(`(function(){
      var s=document.getElementById('splash');
      if (s && s.classList.contains('hide')) return 'done';
      var ac=document.getElementById('splash-age-check');
      if (ac && !ac.checked) { ac.checked=true; ac.dispatchEvent(new Event('change',{bubbles:true})); }
      var row=document.getElementById('splash-age-row'); if (row) row.hidden=false;
      var sb=document.getElementById('splash-box');
      if (sb) { sb.scrollTop=sb.scrollHeight; sb.dispatchEvent(new Event('scroll')); }
      var mand=document.getElementById('splash-mandatory');
      if (mand && !mand.hidden) {
        var ms=document.getElementById('splash-mandatory-scroll');
        if (ms) { ms.scrollTop=ms.scrollHeight; ms.dispatchEvent(new Event('scroll')); }
        var me=document.getElementById('splash-mandatory-enter'); if (me) me.click();
      } else {
        var se=document.getElementById('splash-enter'); if (se && !se.hidden) se.click();
        var fe=document.getElementById('splash-force-enter'); if (fe && !fe.hidden) fe.click();
      }
      var m=document.getElementById('cc-scope-mask'); if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}
      return 'try';
    })()`);
    await sleep(450);
    if (await evalJs(`(function(){var s=document.getElementById('splash');return !s || s.classList.contains('hide');})()`)) break;
  }
  const gate = JSON.parse(await evalJs(`(function(){
    var i=document.getElementById('chat-input');
    var s=document.getElementById('splash');
    return JSON.stringify({ splashHidden: !s || s.classList.contains('hide'),
      vis: i ? getComputedStyle(i).visibility : 'no-input' });
  })()`));
  check('R0 前置：开屏已隐藏 + 输入框 computed visibility=visible（innerText 有效）',
    gate.splashHidden === true && gate.vis === 'visible', gate);
  await evalJs(`(function(){ var app=document.querySelector('.app[data-app="chat"]'); if(app) app.click(); return !!app; })()`);
  for (let i = 0; i < 20; i++) { if (await evalJs(`(function(){var p=document.getElementById('page-chat');return p&&!p.hidden;})()`)) break; await sleep(250); }

  // 键盘垫片（与 verify-ios-safe-bottom-kb.mjs 同款：vv.height 覆写 + 合成 focusin）。
  // iOS 真机在 chatting 时输入框聚焦但 activeElement 报 <body>——本脚本用 activeElement
  // 取值覆写复刻该内核行为（R2 验证垫片生效），否则无头 Chrome 会给出「正确」的
  // activeElement，两种管线看不出差别。
  await evalJs(`(function(){ var vv=window.visualViewport;
    Object.defineProperty(vv,'height',{configurable:true,get:function(){return window.__kbH||window.innerHeight;}});
    Object.defineProperty(vv,'offsetTop',{configurable:true,get:function(){return 0;}});
    return 'ok'; })()`);
  const iosFocusStub = await evalJs(`(function(){
    try {
      window.__aeBody = false;
      var d = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');
      Object.defineProperty(document, 'activeElement', { configurable: true, get: function(){
        if (window.__aeBody) return document.body;
        return d && d.get ? d.get.call(this) : null;
      } });
      window.__ec = 0;
      var ec = document.execCommand ? document.execCommand.bind(document) : null;
      document.execCommand = function(){ window.__ec++; return ec ? ec.apply(document, arguments) : false; };
      return 'ok';
    } catch (e) { return 'err:' + e; }
  })()`);
  check('R2 垫片就绪（visualViewport + iOS activeElement=body 复刻 + execCommand 计数）', iosFocusStub === 'ok', iosFocusStub);

  const openKb = await evalJs(`(function(){
    document.dispatchEvent(new Event('touchstart'));
    var i=document.getElementById('chat-input');
    i.focus(); i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
    window.__kbH=380; window.visualViewport.dispatchEvent(new Event('resize'));
    window.__aeBody = true;   // iOS 内核行为：聚焦在 contenteditable 上，activeElement 却报 body
    return document.activeElement === document.body ? 'ios-stub' : 'stub-failed';
  })()`);
  check('R3 前置：键盘开启 + iOS activeElement=body 复刻生效', openKb === 'ios-stub', openKb);

  const sendAndRead = async (text) => {
    return await evalJs(`(function(){
      var i=document.getElementById('chat-input');
      i.textContent=${JSON.stringify(text)};
      i.dispatchEvent(new Event('input',{bubbles:true}));
      window.__ec = 0;
      var b=document.getElementById('chat-send');
      b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
      b.click();
      // 无头 Chrome 里 contenteditable 的 innerText 恒为 ''（需真实排版），断言一律用 textContent
      return JSON.stringify({ ec: window.__ec, txt: i.textContent || '' });
    })()`);
  };

  // ---- B1（核心判别点）：iOS 形态（聚焦 + activeElement=body）点发送 ----
  // 必须走 execCommand 编辑管线（终结输入法组合会话＝写回无从发生）；修复前走
  // 直写 textContent='' → 迟到写回复活，用户所见「输入栏这一行弹跳一下」。
  const b1 = JSON.parse(await sendAndRead('在吗，今晚一起吃饭吗'));
  check('B1 聚焦态清空走 execCommand 编辑管线（iOS activeElement=body 形态）', b1.ec >= 1, b1);
  check('B1b 消息发出后输入栏已清空', b1.txt.trim() === '', b1);

  // ---- B2：迟到写回（内核复活刚发的文本、不派发 input 事件）必须在 ~1~2 帧内被清 ----
  await evalJs(`(function(){
    var i=document.getElementById('chat-input');
    window.__wbT = performance.now();
    window.__wbClearedAt = 0;
    i.textContent='在吗，今晚一起吃饭吗';   // 复刻内核迟到写回（内容＝刚发出去的那条）
    var tick = setInterval(function(){
      if (!window.__wbClearedAt && !(i.textContent||'').trim()) { window.__wbClearedAt = performance.now(); clearInterval(tick); }
      if (performance.now() - window.__wbT > 1200) clearInterval(tick);
    }, 8);
    return true; })()`);
  await sleep(500);
  const b2 = JSON.parse(await evalJs(`JSON.stringify({ txt:(document.getElementById('chat-input').textContent||''), dt: window.__wbClearedAt ? Math.round(window.__wbClearedAt - window.__wbT) : -1 })`));
  check('B2 迟到写回被兜底清掉', b2.txt.trim() === '', b2);
  check('B2b 首查提前：写回存活 ≤150ms（修复前 [200,800] 档 ≥200ms）', b2.dt >= 0 && b2.dt <= 150, b2);

  // ---- B3：用户清空后「重打刚发过的同一句」不得被吞（#115 契约不回归）----
  await sendAndRead('好的');
  const b3 = await evalJs(`(function(){
    var i=document.getElementById('chat-input');
    // 真实输入活动：keydown + beforeinput(insert) + input（用户重打同款短句）
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'h',bubbles:true}));
    i.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',bubbles:true}));
    i.textContent='好的';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    return i.textContent || '';
  })()`);
  await sleep(900);
  const b3after = await evalJs(`(document.getElementById('chat-input').textContent || '')`);
  check('B3 用户清空后重打同一句不被守卫吞掉（#115 契约保持）', b3after.trim() === '好的', { typed: b3, after: b3after });

  // ---- B4：真·非聚焦（activeElement 不是输入框且无焦点自记）仍走直写分支（行为与改动前一致）----
  const b4 = await evalJs(`(function(){
    var i=document.getElementById('chat-input');
    i.textContent='';
    i.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
    try { i.blur(); } catch (e) {}
    window.__aeBody = true;
    i.textContent='程序化发送内容';
    window.__ec = 0;
    var b=document.getElementById('chat-send');
    b.click();
    return JSON.stringify({ ec: window.__ec, txt: i.textContent || '' });
  })()`);
  const b4j = JSON.parse(b4);
  check('B4 非聚焦态仍走原直写路径（未聚焦时行为与改动前一致：不调 execCommand）', b4j.ec === 0, b4j);
  check('B4b 非聚焦态内容同样被清空', b4j.txt.trim() === '', b4j);

  const pass = results.filter(r => r.ok).length;
  console.log('---- ' + pass + '/' + results.length + ' PASS' + (useProduct ? '（产物级：未含本修复应为 RED）' : '（src 自组装）'));
  process.exitCode = pass === results.length ? 0 : 1;
} finally {
  try { if (chrome) chrome.kill(); } catch (e) {}
  try { if (server) server.close(); } catch (e) {}
}

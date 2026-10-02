// ===== 回归脚本：聊天设置「隐藏音乐悬浮小窗」开关语义反转（v3.10.x 修复） =====
// 用法：node build.mjs && node tools/verify-cs-music-hide.mjs
// 背景（用户反馈）：聊天设置里原「音乐悬浮小窗」开关应为「隐藏」语义——勾选=隐藏悬浮
//   小窗，与同页「隐藏通话小框」一致；原实现是勾选=开启，文案与功能方向都反了。
// 修复：template.html 文案改「隐藏音乐悬浮小窗」；chat-settings.js mfGet/mfSet 反转
//   （勾选=hidden → 写 music-global.floatEn=false），并补 toast 反馈。
// 验证：
//   1) 文案为「隐藏音乐悬浮小窗」；默认未勾选（floatEn 默认开=不隐藏）
//   2) 勾选 → musicFloatGet()=false、music-global.floatEn=false、toast「已隐藏」
//   3) 700ms 轮询后不回弹；刷新页面后仍保持隐藏（持久化）
//   4) 外部 window.musicFloatSet(true)（模拟音乐页/音乐设置改回开启）→ 500ms 轮询同步回本页未勾选
//   5) 再勾选→取消勾选完整来回，floatEn 恢复 true
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-csmusic-' + Date.now()),
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
const openChatSettings = async () => {
  await evalJs(`(function(){ var b=document.getElementById('chat-settings-btn'); if(b)b.click(); return !!b; })()`);
  await sleep(400);
};

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(1200);
  await openChatSettings();

  // ---- 1. 初始状态：文案 + 默认不隐藏 ----
  const init = await evalJs(`(function(){
    var row=document.getElementById('cs-music-float-row'), el=document.getElementById('cs-music-float');
    var page=document.getElementById('page-chat-settings');
    return {
      label: row ? (row.querySelector('.txt')||{}).textContent : null,
      exists: !!el,
      checked: el ? el.checked : null,
      hookOn: typeof window.musicFloatGet==='function' ? window.musicFloatGet() : 'NO-HOOK',
      pageVisible: !!page && !page.hidden
    };
  })()`);
  check('聊天设置页可见', init.pageVisible);
  check('文案=隐藏音乐悬浮小窗', init.label === '隐藏音乐悬浮小窗', String(init.label));
  check('开关元素存在', init.exists);
  check('默认未勾选（不隐藏）', init.checked === false, String(init.checked));
  check('musicFloatGet()=true（浮窗默认开）', init.hookOn === true, String(init.hookOn));

  // ---- 2. 勾选 → 隐藏 ----
  await evalJs(`(function(){ document.getElementById('cs-music-float').closest('label.toggle').click(); return true; })()`);
  const hid = await evalJs(`(function(){
    var el=document.getElementById('cs-music-float');
    var s=null; try{ s=JSON.parse(window.activeStore().get('music-global')||'{}'); }catch(e){}
    var t=document.getElementById('cc-toast');
    return { checked: el.checked, hookOn: window.musicFloatGet(), floatEn: s.floatEn,
      toastText: t?t.textContent:'', toastShow: t?t.className:'' };
  })()`);
  check('勾选后 checked=true（隐藏中）', hid.checked === true, String(hid.checked));
  check('musicFloatGet()=false', hid.hookOn === false, String(hid.hookOn));
  check('music-global.floatEn=false', hid.floatEn === false, String(hid.floatEn));
  check('toast 提示已隐藏', /已隐藏/.test(hid.toastText) && /show/.test(hid.toastShow), hid.toastText);

  // ---- 3. 轮询不回弹 ----
  await sleep(700);
  const hold = await evalJs(`(function(){ var el=document.getElementById('cs-music-float'); return { checked: el.checked, hookOn: window.musicFloatGet() }; })()`);
  check('700ms 后仍勾选（未被轮询拨回）', hold.checked === true && hold.hookOn === false, JSON.stringify(hold));

  // ---- 4. 刷新后持久化（仍隐藏） ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(1200);
  await openChatSettings();
  const persist = await evalJs(`(function(){ var el=document.getElementById('cs-music-float'); return { checked: el.checked, hookOn: typeof window.musicFloatGet==='function'?window.musicFloatGet():'NO-HOOK' }; })()`);
  check('刷新后仍勾选（隐藏持久化）', persist.checked === true && persist.hookOn === false, JSON.stringify(persist));

  // ---- 5. 外部恢复开启（模拟音乐页/音乐设置 musicFloatSet）→ 本页同步取消勾选 ----
  await evalJs(`(function(){ window.musicFloatSet(true); return true; })()`);
  await sleep(700);
  const ext = await evalJs(`(function(){ var el=document.getElementById('cs-music-float'); return { checked: el.checked, hookOn: window.musicFloatGet() }; })()`);
  check('外部 musicFloatSet(true) 后本页自动取消勾选', ext.checked === false && ext.hookOn === true, JSON.stringify(ext));

  // ---- 6. 完整来回：再勾选再取消，状态恢复默认开 ----
  await evalJs(`(function(){ document.getElementById('cs-music-float').closest('label.toggle').click(); return true; })()`);
  const on1 = await evalJs(`(function(){ var el=document.getElementById('cs-music-float'); return { checked: el.checked, hookOn: window.musicFloatGet() }; })()`);
  await evalJs(`(function(){ document.getElementById('cs-music-float').closest('label.toggle').click(); return true; })()`);
  const off1 = await evalJs(`(function(){ var el=document.getElementById('cs-music-float'); var s=null; try{ s=JSON.parse(window.activeStore().get('music-global')||'{}'); }catch(e){} return { checked: el.checked, hookOn: window.musicFloatGet(), floatEn: s.floatEn }; })()`);
  check('再次勾选=隐藏生效', on1.checked === true && on1.hookOn === false, JSON.stringify(on1));
  check('取消勾选=恢复显示且 floatEn 回 true', off1.checked === false && off1.hookOn === true && off1.floatEn === true, JSON.stringify(off1));

  const failed = pass < pass + fail;
  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  if (fail) process.exitCode = 1;
  else console.log('全部通过');
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}
process.exit(process.exitCode || 0);

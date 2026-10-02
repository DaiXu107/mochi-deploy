// ===== 诊断复现：荣耀200Pro+Edge「气泡 CSS 输入后退出重进丢失」 =====
// 用法：node tools/repro-bubble-css.mjs
// 链路：聊天设置→气泡CSS(openTCPanel textarea→安卓转ce-box)→应用(store.set)→重进(boot applyCss)
// 场景：
//   A 正常 UI 全链路（打字→应用→存 LS/IDB→样式注入）
//   B 刷新后持久化（LS 有值→boot applyCss 应注入）
//   C 值只在 IDB（模拟 LS 写失败/迟到恢复）→ restore 后是否补应用
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-bcss-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  JS异常:', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const waitReady = async () => { for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) return true; await sleep(200); } return false; };
const openChatSettings = async () => {
  await evalJs(`(function(){ var b=document.getElementById('chat-settings-btn'); if(b)b.click(); return !!b; })()`);
  await sleep(400);
};
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info !== undefined ? '  [' + JSON.stringify(info) + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info !== undefined ? '  [' + JSON.stringify(info) + ']' : '')); }
}

const CSS_TEXT = 'border-radius:22px;box-shadow:0 3px 10px rgba(0,0,0,.15)';
const KEY_EXPR = `window.activePrefix()+':cs-bubble-css'`;

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(1200);

  // ---- A. 打开面板 → 模拟输入 → 应用 ----
  await openChatSettings();
  await evalJs(`(function(){ var r=document.getElementById('cs-css'); if(r)r.click(); return !!r; })()`);
  await sleep(300); // 等 MutationObserver 完成 ce-box 转换
  const st1 = await evalJs(`(function(){
    var ta=document.getElementById('cs-css-input');
    var box=document.querySelector('.ce-box[data-for="cs-css-input"]');
    return { maskOpen: !document.getElementById('tc-mask').hidden,
      taExists: !!ta, ghost: !!(ta&&ta.classList.contains('ce-ghost')),
      boxExists: !!box, proxyVal: ta ? (ta.__ceBox?'PROXY':'NATIVE') : 'NO-TA' };
  })()`);
  check('A1 面板打开且输入框已转 ce-box', st1 && st1.maskOpen && st1.taExists && st1.boxExists, st1);

  // 模拟真实打字结果：往 ce-box 写文本节点 + input 事件（与键盘输入终态一致）
  await evalJs(`(function(){
    var box=document.querySelector('.ce-box[data-for="cs-css-input"]');
    box.textContent=${JSON.stringify(CSS_TEXT)};
    box.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  const rd = await evalJs(`(function(){
    var ta=document.getElementById('cs-css-input');
    var v=''; try{ v=ta.value; }catch(e){ v='THROW:'+e.message; }
    return { proxyRead: v };
  })()`);
  check('A2 代理读回输入内容', rd && rd.proxyRead === CSS_TEXT, rd);

  await evalJs(`(function(){ var b=document.getElementById('cs-css-ok'); if(b)b.click(); return !!b; })()`);
  await sleep(200);
  const saved = await evalJs(`(async function(){
    var k=${KEY_EXPR};
    var ls=null; try{ ls=localStorage.getItem(k); }catch(e){}
    var idbV=await window.idbGet(k);
    var sty=document.getElementById('cs-bubble-style');
    return { stored: window.activeStore().get('cs-bubble-css'), ls: ls, idb: idbV||null,
      styleInjected: !!sty, styleHead: sty?sty.textContent.slice(0,80):null };
  })()`);
  check('A3 应用后 store 保存成功', saved && saved.stored === CSS_TEXT, saved && saved.stored);
  check('A4 localStorage 落盘', saved && saved.ls === CSS_TEXT, saved && saved.ls);
  check('A5 IndexedDB 落盘', saved && typeof saved.idb === 'string' && saved.idb === CSS_TEXT, saved && String(saved.idb).slice(0, 40));
  check('A6 样式已注入当前页', saved && saved.styleInjected, saved && saved.styleHead);

  // ---- B. 刷新后持久化 ----
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(1500);
  const b1 = await evalJs(`(function(){
    var sty=document.getElementById('cs-bubble-style');
    return { styleAfterReload: !!sty, head: sty?sty.textContent.slice(0,60):null,
      stored: window.activeStore().get('cs-bubble-css') };
  })()`);
  check('B1 刷新后气泡样式自动恢复', b1 && b1.styleAfterReload && b1.stored === CSS_TEXT, b1);

  // ---- C. 值只在 IDB（LS 写失败场景）：真键删 LS 留 IDB → 刷新 → restore 后是否补应用 ----
  await evalJs(`(async function(){
    var k=${KEY_EXPR};
    await window.idbSet(k, ${JSON.stringify(CSS_TEXT)});
    localStorage.removeItem(k);
    return true;
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await waitReady();
  await sleep(2500); // 给 idbRestore 分批回填留时间
  const c1 = await evalJs(`(function(){
    var sty=document.getElementById('cs-bubble-style');
    var k=${KEY_EXPR};
    return { styleApplied: !!sty, styleHead: sty?String(sty.textContent).slice(0,50):null,
      lsBackfilled: !!localStorage.getItem(k),
      memOrStore: window.activeStore().get('cs-bubble-css') };
  })()`);
  check('C1 IDB-only 值刷新后样式仍应生效（restore 后补应用）', c1 && c1.styleApplied && c1.memOrStore === CSS_TEXT, c1);

  console.log('\n==== 结果：' + (pass + fail) + ' 项检查，' + fail + ' 项失败 ====');
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}
process.exit(process.exitCode || 0);

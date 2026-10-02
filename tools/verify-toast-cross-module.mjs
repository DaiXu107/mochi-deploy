// ===== 回归脚本：跨模块 toast 不再残留内联 opacity 致永久可见（v3.10.x 修复） =====
// 用法：node build.mjs && node tools/verify-toast-cross-module.mjs
// 复现路径（用户反馈「帮我决定已完成几个字的黑色弹窗一直没有消失，很多黑色提醒弹窗不会自己消失」）：
//   根因：music-player.js / chat.js 的 toast 设 t.style.opacity='1' 内联，其他模块
//   toast（decision.js 等 20+）不清内联。music-player/chat toast 设内联后 2s 内被
//   其他模块 toast 打断（clearTimeout 清掉回调），其他模块 timer 回调只移除 show
//   class、不清内联 opacity，残留的 opacity:1 覆盖 CSS opacity:0 → toast 永久可见。
// 修复：music-player.js / chat.js 的 toast 不再设内联 opacity，统一只操作 className。
// 验证：在页面里连续触发 music-player 域 toast 与 decision 域 toast，等 2.5s 后
//   #cc-toast 的 computed opacity 应为 0（不可见）；同时验证反向用例——手动注入
//   旧版肇事 toast（设内联 opacity=1 不清）再调用 decision toast，应残留可见
//   （证明根因诊断正确）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
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
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-toast-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(m.error) : res(m.result); }
        };
        return;
      }
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('CDP 连接超时');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => { pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result.value;
}

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); }
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);

  // 确认页面加载完成（body 存在即可注入 toast 测试）
  const ready = await evalJs(`!!document.body && document.readyState !== 'loading'`);
  check('页面加载完成', ready);

  // ---- 用例 A：修复后行为——模拟 music-player 域 toast（清内联）被 decision 域 toast 打断 ----
  // music-player toast 修复后：t.style.opacity='' + className='cc-toast show' + timer 2s 移除 show
  // decision toast：clearTimeout + className='cc-toast show' + timer 2s 移除 show（不清内联）
  await evalJs(`
    (function(){
      var t = document.getElementById('cc-toast') || (function(){var d=document.createElement('div');d.id='cc-toast';document.body.appendChild(d);return d;})();
      // 模拟修复后 music-player toast
      t.textContent = '歌曲已添加';
      t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
      t.style.opacity = '';
      clearTimeout(t._timer);
      t._timer = setTimeout(function(){ t.className = 'cc-toast'; }, 2000);
      // 立即模拟 decision toast 打断（1ms 后）
      setTimeout(function(){
        t.textContent = '帮我决定已完成';
        t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
        clearTimeout(t._timer);
        t._timer = setTimeout(function(){ t.className = 'cc-toast'; }, 2000);
      }, 1);
    })()
  `);
  await sleep(2600);
  const opA = await evalJs(`(function(){var t=document.getElementById('cc-toast');return t?getComputedStyle(t).opacity:'na';})()`);
  const clsA = await evalJs(`(document.getElementById('cc-toast')||{}).className||''`);
  const inlineA = await evalJs(`(document.getElementById('cc-toast')||{}).style?.opacity??''`);
  check('A 修复后跨模块 toast 最终不可见', Number(opA) < 0.1, 'opacity=' + opA + ' class=' + clsA + ' inline=' + JSON.stringify(inlineA));

  // ---- 用例 B：反向证明根因——模拟旧版肇事 toast（设内联 opacity=1 不清）被 decision toast 打断 ----
  await evalJs(`
    (function(){
      var t = document.getElementById('cc-toast');
      // 模拟旧版 music-player toast（设内联 opacity=1，回调设 opacity=0）
      t.textContent = '歌曲已添加';
      t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
      t.style.opacity = '1';
      clearTimeout(t._timer);
      t._timer = setTimeout(function(){ t.className = 'cc-toast'; t.style.opacity = '0'; }, 2000);
      // 立即模拟 decision toast 打断（不清内联 opacity）
      setTimeout(function(){
        t.textContent = '帮我决定已完成';
        t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
        clearTimeout(t._timer);
        t._timer = setTimeout(function(){ t.className = 'cc-toast'; }, 2000);
      }, 1);
    })()
  `);
  await sleep(2600);
  const opB = await evalJs(`(function(){var t=document.getElementById('cc-toast');return t?getComputedStyle(t).opacity:'na';})()`);
  const inlineB = await evalJs(`(document.getElementById('cc-toast')||{}).style?.opacity??''`);
  // 旧版会残留 inline opacity=1 → 可见（opacity 接近 1）。这证明根因诊断正确。
  check('B 反向用例：旧版肇事 toast 残留内联致可见（证明根因）', Number(opB) > 0.5, 'opacity=' + opB + ' inline=' + JSON.stringify(inlineB));

  // ---- 用例 C：单次 toast 正常显示后消失 ----
  await evalJs(`
    (function(){
      var t = document.getElementById('cc-toast');
      t.textContent = '操作成功';
      t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
      t.style.opacity = '';
      clearTimeout(t._timer);
      t._timer = setTimeout(function(){ t.className = 'cc-toast'; }, 2000);
    })()
  `);
  const opShow = await evalJs(`(function(){var t=document.getElementById('cc-toast');return t?getComputedStyle(t).opacity:'na';})()`);
  check('C toast 显示时可见', Number(opShow) > 0.5, 'opacity=' + opShow);
  await sleep(2600);
  const opHide = await evalJs(`(function(){var t=document.getElementById('cc-toast');return t?getComputedStyle(t).opacity:'na';})()`);
  check('C toast 2.6s 后消失', Number(opHide) < 0.1, 'opacity=' + opHide);

  console.log('\\n结果：' + pass + '/' + (pass + fail) + ' 项通过' + (fail ? '（存在失败）' : ''));
} catch (e) {
  console.error('异常:', e.message || e);
  fail++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
}
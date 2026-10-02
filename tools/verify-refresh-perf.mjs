// ===== 验证脚本：#280/#281 刷新黑屏卡顿收口（令牌裸路径快速 404 + my-emoji 启动取回延迟） =====
// 用法：node build.mjs && node tools/verify-refresh-perf.mjs
//   （B 组跑的是仓库根目录产物 index.html + sw.js；未构建时 B 组会红——红的是产物不是源码，
//    源码层检查见 C 组，不依赖构建）
//
// #280 行为断言（B 组，真实 SW 拦截链）：SW 激活后往页面注入 src='@@m:<32hex>' 的 img——
//   修复前该请求会走 SW「网络优先 3.5s → catch 链无超时 fetch」发真实网络请求（本地复现：
//   请求命中本地静态服务器＝真实网络路径被占用；弱网/GitHub 国内即「黑屏卡顿几分钟」成分）；
//   修复后 SW 头部本地 404：服务器零命中 + error 事件毫秒级触发（#202 失败占位依赖 error）。
// #281 静态断言（C 组）：chat.js 启动取回调度（mochi-restore-done 后 4s）+ 防盲写闸门扩口径
//   （__myeIdbApplied）在位；sw.js 守卫顺序在 navCached/respondWith 之前。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- C 组：源码静态断言（不依赖构建） ----------
const swSrc = readFileSync(join(root, 'src', 'pwa', 'sw.js'), 'utf8');
const chatSrc = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
check('C1 sw.js 令牌路径快速 404 守卫在位', swSrc.includes("u.pathname.indexOf('@@m:') >= 0"));
const guardAt = swSrc.indexOf("u.pathname.indexOf('@@m:') >= 0");
const navAt = swSrc.indexOf("const navCached = req.mode === 'navigate'");
const rwa = swSrc.indexOf('e.respondWith(');
check('C2 守卫先于 navCached 导航链（头部短路，不走网络链），且守卫块自带 respondWith+return', guardAt > 0 && navAt > guardAt && (() => { const blk = swSrc.slice(guardAt, guardAt + 400); return blk.includes('e.respondWith(') && /return\s*;/.test(blk); })(), 'guard=' + guardAt + ' nav=' + navAt);
check('C3 sw.js 守卫是本地 404（无网络请求）', /indexOf\('@@m:'\) >= 0\)[\s\S]{0,200}status: 404/.test(swSrc));
check('C4 chat.js 启动取回延迟调度在位（restore-done 后 4s）', chatSrc.includes("document.addEventListener('mochi-restore-done', function () { setTimeout(tryRestore, 4000); });"));
check('C5 chat.js 防盲写闸门扩口径在位（__myeIdbApplied）', chatSrc.includes('window.__myeIdbApplied !== true'));
check('C6 myeApplyIdb 成功即置权威已应用标志', /cnt\(data\) > lc\) \{[\s\S]{0,400}?window\.__myeIdbApplied = true;/.test(chatSrc));

// ---------- B 组：行为断言（headless Chrome + 真实 SW） ----------
// #280 守卫在 src/pwa/sw.js，构建后复制为根目录 sw.js（不内嵌 index.html）——产物就绪探针读根 sw.js
let artifactReady = false;
try { artifactReady = readFileSync(join(root, 'sw.js'), 'utf8').includes("u.pathname.indexOf('@@m:') >= 0"); } catch (e) {}
if (!artifactReady) console.log('⚠️  根目录 sw.js 仍是旧版（无 #280 守卫）——请先 node build.mjs，B 组结果按旧版解读');

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('SKIP  找不到 Chrome/Edge（设 CHROME_PATH 可启用 B 组行为断言；C 组已覆盖源码层）');
} else if (typeof WebSocket !== 'function') {
  console.log('SKIP  需要 Node 21+（内置 WebSocket）跑 B 组；C 组已覆盖源码层');
} else {
  let tokenHits = 0; // 服务器侧：@@m: 路径命中数（修复后必须为 0）
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const server = createServer((req, res) => {
    try {
      if (req.url.indexOf('@@m:') >= 0) tokenHits++;
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

  const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 40));
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-refresh-perf-' + Date.now()),
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
      if (r && r.exceptionDetails) { console.error('  eval 异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  }

  try {
    await cdpConnect();
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(2500);
    // 等 SW 接管（修复只在 SW fetch 链生效）
    let ctl = false;
    for (let i = 0; i < 30; i++) {
      ctl = await evalJs("!!(navigator.serviceWorker && navigator.serviceWorker.controller)");
      if (ctl) break;
      await sleep(300);
    }
    check('B1 SW 已注册并接管页面', !!ctl);
    if (ctl) {
      // 注入令牌 img：error 事件应毫秒级触发（本地 404），且服务器零命中
      const r = await evalJs(`(function(){
        return new Promise(function(res){
          var im=new Image();
          var t0=performance.now();
          var done=false;
          function fin(ev){ if(done)return; done=true; res(JSON.stringify({ev:ev,ms:Math.round(performance.now()-t0)})); }
          im.onerror=function(){ fin('error'); };
          im.onload=function(){ fin('load'); };
          im.src='@@m:4013bebcae9d63be278fd7220618ebe2';
          setTimeout(function(){ fin('timeout'); }, 5000);
        });
      })()`);
      const o = r ? JSON.parse(r) : null;
      check('B2 令牌 img 毫秒级触发 error（SW 本地 404，不挂网络）', !!o && o.ev === 'error' && o.ms < 1500, o ? o.ev + '/' + o.ms + 'ms' : 'null');
      check('B3 服务器零次 @@m: 请求命中（不发真实网络）', tokenHits === 0, 'hits=' + tokenHits);
    }
  } catch (e) {
    check('B 组执行异常（环境缺口不算回归，C 组已覆盖源码层）', false, String(e && e.message || e).slice(0, 120));
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
}

const pass = results.filter((r) => r.ok).length;
console.log('==== ' + pass + '/' + results.length + ' 通过 ====');
process.exitCode = pass === results.length ? 0 : 1;

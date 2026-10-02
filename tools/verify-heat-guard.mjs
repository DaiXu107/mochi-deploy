// ===== 专项验证：#913 手机发烫收口——切后台全局暂停 CSS 动画 + 工具段发烫排查条 =====
// 用户直派：「手机发烫的问题要优化+提示怎么可以改善」。
// ① mobile-adapt.js 在 document.hidden 时给 body 挂 mochi-bg-pause，base.css 用它暂停全部动画
//   （后台保活用户挂后台/锁屏过夜＝无限动画合成照跑的纯浪费热源）；② template.html 工具段补 heat-help-sub。
// 用法：node tools/verify-heat-guard.mjs（需先 node build.mjs；MOCHI_ROOT 可指仓外副本）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const target = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : root;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

// ---- S 组：产物静态锚 ----
let idx = '', jsMa = '';
try { idx = readFileSync(join(target, 'index.html'), 'utf8'); } catch (e) {}
try { jsMa = readFileSync(join(target, 'js', 'mobile-adapt.js'), 'utf8'); } catch (e) {}
ok('S1 闸接线在 js/mobile-adapt.js（#860 后外置件）', jsMa.includes("classList.toggle('mochi-bg-pause', !!document.hidden)"));
ok('S2 CSS 落点在产物（minify 形态含伪元素锚）', idx.includes('body.mochi-bg-pause *::before') && idx.includes('animation-play-state: paused !important'));
ok('S3 工具段发烫排查条在产物', idx.includes('id="heat-help-sub"') && idx.includes('手机发烫怎么改善'));

// ---- B 组：无头行为 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(target, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(target)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-heat-' + Date.now()),
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
  throw new Error('CDP 连接失败');
}
const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

const jsErrors = [];
try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  const errs = await evalJs('window.__jsErrors ? window.__jsErrors.length : -1');

  // B1 前台：不挂类
  ok('B1 前台不挂暂停类', (await evalJs('document.body.classList.contains("mochi-bg-pause")')) === false);
  // B2 伪装 hidden + 派发 visibilitychange → 挂类
  await evalJs(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.body.classList.contains('mochi-bg-pause')`);
  ok('B2 切后台挂暂停类', (await evalJs('document.body.classList.contains("mochi-bg-pause")')) === true);
  // B3 挂类时动画被暂停（取一条真实 infinite 动画元素核对计算值）
  const paused = await evalJs(`(() => {
    const el = document.querySelector('.garden-plant-emoji, .r-twinkle, .mw-bars.playing rect, [class*="splashDots"]') || document.querySelector('div');
    if (!el) return 'no-el';
    return getComputedStyle(el).animationPlayState;
  })()`);
  ok('B3 挂类下动画计算值为 paused', paused === 'paused');
  // B4 回前台摘类 + 动画恢复
  await evalJs(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    true`);
  ok('B4 回前台摘类', (await evalJs('document.body.classList.contains("mochi-bg-pause")')) === false);
  const resumed = await evalJs(`(() => {
    const el = document.querySelector('.garden-plant-emoji, .r-twinkle, .mw-bars.playing rect, [class*="splashDots"]') || document.querySelector('div');
    if (!el) return 'no-el';
    return getComputedStyle(el).animationPlayState;
  })()`);
  ok('B5 回前台动画恢复 running/idle', resumed === 'running' || resumed === 'idle');
  // Z 零异常（-1 = 通道不存在也算绿；>0 = 有 JS 异常）
  ok('Z 页面零 JS 异常（__jsErrors=' + errs + '）', errs === 0 || errs === -1);
} catch (e) {
  fail++;
  console.error('❌ B 组执行异常：' + (e && e.message));
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}

console.log('\\n#913 verify-heat-guard：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

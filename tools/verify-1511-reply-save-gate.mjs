// #1511 行为回归尺：回复设置「保存设置」不许拿没读全的屏面值整包顶库。
// 作者实报（多设备型号同现＝纯行为口径）：「手机保存了【回复设置】但是刷新之后恢复上次调整的或默认，
//   没有正常保存设置」。本页＝从存储渲染 →「保存设置」把页面全部 stepper/开关值整包写回
//   （saveCurrentReplyPage ~50 键）；启动回填（idbRestore）落定前、或这台机 LS 写失败只靠 IDB 时，
//   屏面值可能是默认/旧账——此刻整包落笔＝把几十枚键一次性顶回默认/旧值（＝#1342 美化方案
//   「无法保存，重新刷新过后数据会被清除」iPhone 实报同族第三处）。
// 断言：
//   S1 保存前读数闸函数在位（replyKeyUnvouched）；
//   S2 整包保存 stepper 路接闸；
//   S3 整包保存开关路接闸；
//   S4 拦下时的照实文案在位（不谎报「已保存」）；
//   B1 回填未落定（mochiDataPending=true）＋键读空 ⇒ 点「保存设置」不落笔（红侧恰在此红＝整包写穿）＋toast 照实说；
//   B2 回填落定（mochiDataPending=false）⇒ 同一击照常落笔（闸不许变成新的存不进去）；
//   B3 未落定窗口内用户直接点开关 ⇒ 照常即时落笔（动过的键屏面即意图，#1342「写过即放行」）；
//   Z 全程零 JS 异常。
// 用法：node tools/verify-1511-reply-save-gate.mjs [被测根目录]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

// ---- S 组：源码/产物锚（外置 js/<file> 与内联 index.html 两种落点都认）----
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const rsCode = srcOf('reply-settings.js') + indexHtml;
console.log('S 源码/产物锚');
ok('S1 保存前读数闸函数在位', rsCode.includes('function replyKeyUnvouched(k) {'));
ok('S2 整包保存 stepper 路接闸', rsCode.includes('if (replyKeyUnvouched(k)) { skipped.push(k); return; }'));
ok('S3 整包保存开关路接闸', rsCode.includes('if (replyKeyUnvouched(k)) { if (skipped.indexOf(k) < 0) skipped.push(k); return; }'));
ok('S4 拦下时照实文案在位', rsCode.includes('部分设置这次没读全（存储正忙）'));

// ---- 无头浏览器 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1511-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr.trim() + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 423, height: 853, deviceScaleFactor: 1.7, mobile: true });
// 二级锁（#319）必须在文档脚本之前解锁；#1497 起解锁态只活本页生命周期，双腿都走
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.setItem('xy-home-v2:cardlock-pwver','2');}catch(e){}})()" });
let jsErr = 0;
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') jsErr++;
});
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500); // 等开屏数据就绪（空库回填毫秒级）＋各模块挂载

console.log('B 行为（无头）');
// B1：回填未落定＋键读空 ⇒ 「保存设置」不落笔（红侧＝整包写穿）
const pre1 = await evalJs(`
  try { localStorage.removeItem('xy-home-v2:default:reply-rs-min'); } catch (e) {}
  window.mochiDataPending = function(){ return true; };
  document.querySelectorAll('.page').forEach(p => p.hidden = true);
  const pg = document.getElementById('page-reply-settings');
  if (pg) pg.hidden = false;
  return { opened: !!pg && !pg.hidden, btn: !!document.getElementById('reply-save-btn') };
`);
ok('B1 前置：回复设置页与保存按钮在位', !!(pre1 && pre1.opened && pre1.btn), JSON.stringify(pre1));
await evalJs(`document.getElementById('reply-save-btn').click(); return 'clicked';`);
await sleep(400);
const b1 = await evalJs(`
  return { rsMin: localStorage.getItem('xy-home-v2:default:reply-rs-min'),
    toast: (document.getElementById('cc-toast') || {}).textContent || '' };
`);
ok('B1 未落定窗口点保存 ⇒ 不拿屏面值顶库（reply-rs-min 不落盘）', !!b1 && b1.rsMin === null, 'rsMin=' + JSON.stringify(b1 && b1.rsMin));
ok('B1 拦下时照实说（不谎报已保存）', !!(b1 && b1.toast && b1.toast.indexOf('没读全') >= 0), 'toast=' + JSON.stringify(b1 && b1.toast));

// B2：回填落定 ⇒ 同一击照常落笔（闸不许变成新的存不进去）
await evalJs(`window.mochiDataPending = function(){ return false; }; document.getElementById('reply-save-btn').click(); return 'clicked';`);
await sleep(400);
const b2 = await evalJs(`return localStorage.getItem('xy-home-v2:default:reply-rs-min');`);
ok('B2 回填落定后同一击照常落笔', typeof b2 === 'string' && b2.length > 0, 'rsMin=' + JSON.stringify(b2));

// B3：未落定窗口内用户直接点开关 ⇒ 照常即时落笔（写过即放行）
const pre3 = await evalJs(`
  window.mochiDataPending = function(){ return true; };
  localStorage.removeItem('xy-home-v2:default:reply-rc-en');
  const el = document.getElementById('rc-en');
  if (el) { el.checked = true; el.dispatchEvent(new Event('change')); }
  return !!el;
`);
await sleep(300);
const b3 = await evalJs(`return localStorage.getItem('xy-home-v2:default:reply-rc-en');`);
ok('B3 前置：开关在位', pre3 === true, JSON.stringify(pre3));
ok('B3 未落定窗口直接点开关 ⇒ 照常即时落笔（写过即放行）', b3 === '1', 'rcEn=' + JSON.stringify(b3));

ok('Z 全程零 JS 异常', jsErr === 0, 'jsErr=' + jsErr);

chrome.kill();
server.close();
console.log('\n结果：通过 ' + pass + ' ／ 失败 ' + fail);
process.exit(fail ? 1 : 0);

// ===== 回归脚本：#821 桌面第一页情侣卡片昵称「点击无法修改」（2026-09-19 用户直派）=====
// 用法：node tools/verify-deco-nick-click.mjs（MOCHI_ROOT 可指到仓外隔离副本的产物根）
// 根因：#738 给 .deco-avatar 整盒铺透明 label 激活层（absolute 覆盖 100%），昵称 span 在盒内
//   被盖住——点昵称命中的是 label＝唤起相册选择器，bindLabel 的「修改昵称」弹窗永不触发。
//   修＝home.css 给 .lbl 抬 position:relative;z-index:1 回到覆盖层之上（哨兵 #821a）。
// 断言：① elementFromPoint 在昵称中心命中的是昵称本身还是 #738 头像 label 覆盖层
//       ② 真点昵称是否弹出「修改昵称」弹窗（#modal-mask 显示且标题匹配）
//       ③（同绿回归守卫）点头像圆圈仍能唤起相册选择器——抬 z-index 不许波及头像路径
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize((process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..'));
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
const cdpPort = 9890 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-nick-repro-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 240)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs(`(function(){
  try {
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var me = document.getElementById('splash-mandatory-enter'); if (me && !me.hidden) me.click();
      mm.hidden = true;
    }
    var sp = document.getElementById('splash');
    if (sp) { sp.classList.add('hide'); sp.hidden = true; }
    var mask = document.getElementById('modal-mask');
    if (mask && !mask.hidden) mask.hidden = true;
    var qa = document.getElementById('qa-mask'); if (qa) qa.remove();
  } catch (e) {}
})()`);
await sleep(1200);

// 切到桌面页
await evalJs(`(function(){ try { document.getElementById('page-phone').hidden = false;
  document.querySelectorAll('.phone > .page').forEach(p => { if (p.id !== 'page-phone') p.hidden = true; }); } catch(e){} })()`);
await sleep(400);

for (const id of ['lbl-user', 'lbl-partner']) {
  const hit = await evalJs(`(function(){
    var el = document.getElementById('${id}');
    if (!el) return 'NO-EL';
    var r = el.getBoundingClientRect();
    var x = r.left + r.width/2, y = r.top + r.height/2;
    var top = document.elementFromPoint(x, y);
    if (!top) return 'NO-HIT';
    return top.tagName + '#' + (top.id||'') + '.' + (top.className||'') + (top.hasAttribute && top.hasAttribute('data-file-pick-for') ? ' [FILE-PICK-LABEL]' : '') + ' same=' + (top === el || el.contains(top) || top.contains(el));
  })()`);
  check('HIT ' + id + ' 昵称中心命中元素', hit && String(hit).indexOf('FILE-PICK-LABEL') === -1, String(hit));

  // 真点一次（CDP 派发 tap），看是否弹「修改昵称」
  await evalJs(`(function(){ try { document.getElementById('modal-mask').hidden = true; } catch(e){} })()`);
  const xy = await evalJs(`(function(){ var el = document.getElementById('${id}'); if (!el) return null;
    var r = el.getBoundingClientRect(); return JSON.stringify([r.left + r.width/2, r.top + r.height/2]); })()`);
  if (xy) {
    const [x, y] = JSON.parse(xy);
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(90);
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
  }
  const modal = await evalJs(`(function(){
    var m = document.getElementById('modal-mask');
    var open = m && !m.hidden && getComputedStyle(m).display !== 'none';
    var t = open ? (document.getElementById('modal-title') || {}).textContent : '';
    var fi = document.activeElement;
    return JSON.stringify({ open: !!open, title: (t||'').trim(), active: fi ? fi.tagName + '#' + (fi.id||'') : '' });
  })()`);
  const mo = JSON.parse(modal || '{}');
  check('TAP ' + id + ' 弹出修改昵称弹窗', mo.open && /昵称/.test(mo.title || ''), modal);
  await evalJs(`(function(){ try { document.getElementById('modal-mask').hidden = true; } catch(e){} })()`);
}

// ③ 同绿回归守卫：点头像圆圈仍唤起相册选择器（无头下表现为 file input 获得焦点/激活）
await evalJs(`(function(){ var g = document.getElementById('daily-greet'); if (g) g.remove(); })()`);
for (const box of ['avatar-user', 'avatar-partner']) {
  await evalJs(`(function(){ try { document.getElementById('modal-mask').hidden = true; } catch(e){} })()`);
  await evalJs(`document.body.focus(); (document.activeElement && document.activeElement.blur && document.activeElement.blur()); 'ok'`);
  const xy = await evalJs(`(function(){ var el = document.querySelector('#${box} .ring'); if (!el) return null;
    var r = el.getBoundingClientRect(); return JSON.stringify([r.left + r.width/2, r.top + r.height/2]); })()`);
  if (xy) {
    const [x, y] = JSON.parse(xy);
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(90);
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
  }
  const ringRes = await evalJs(`(function(){
    var fi = document.activeElement;
    var picked = fi && fi.id === 'mochi-avatar-pick';
    var m = document.getElementById('modal-mask');
    return JSON.stringify({ picked: !!picked, active: fi ? fi.tagName + '#' + (fi.id || '') : '', modalOpen: !!(m && !m.hidden) });
  })()`);
  check('RING ' + box + ' 点圆圈仍唤起相册', JSON.parse(ringRes || '{}').picked === true, ringRes);
}

console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' passed');
chrome.kill(); server.close();
process.exit(results.every(r => r.ok) ? 0 : 1);

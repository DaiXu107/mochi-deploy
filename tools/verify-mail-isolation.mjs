// ===== 回归脚本：多桌面信箱串桌面（iOS Safari 慢 IndexedDB 竞态） =====
// 用法：node build.mjs && node tools/verify-mail-isolation.mjs
// 复现路径（用户反馈「iOS 自带浏览器多个联系人时，信箱在哪个角色页面就显示全部是
// 这个角色来信，分不清谁是谁」）：
//   1. 慢 IDB 模拟：把 default 桌面的 idbGet('...mail-letters') 延迟 2500ms
//      （iOS Safari 事务慢/后台挂起时的典型表现），c 前缀桌面延迟 0。
//   2. default 写一封信 A → 切到 cX（权威加载完成）→ cX 写一封信 B。
//   3. 切回 default（权威加载 idbGet 挂起 2500ms）→ 200ms 后立即切到 cX。
//   4. default 的 idbGet 在「当前已切到 cX」时迟到返回：未修复时 mailMergeFromIdb
//      用动态 store（当前=cX）把 A 的信合并写进 cX 信箱 → 串桌面。
//   5. 断言：cX 信箱只含 B 不含 A；default 信箱仍含 A。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mail-iso-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 种子：default 一封信 + 新建联系人 cX ----
const seed = JSON.parse(await evalJs(`(function(){
  try {
    const cid = window.createContact('角色X');
    window.storeFor('default').set('mail-letters', JSON.stringify([
      { id: 'l_default_A', type: 'received', tt: '测试', content: '这是default桌面的信', tm: Date.now() - 200000 }
    ]));
    return JSON.stringify({ cid: cid, ok: true });
  } catch(e) { return JSON.stringify({ ok: false, err: e.message }); }
})()`) || '{}');
check('种子：新建联系人 + default 写信', seed.ok === true && !!seed.cid, JSON.stringify(seed));
if (!seed.ok || !seed.cid) process.exit(1);
const cid = seed.cid;

// ---- 注入慢 IDB：default 的 mail-letters 读取延迟 2500ms（模拟 iOS Safari 慢事务） ----
const patchOk = await evalJs(`(function(){
  if (!window.idbGet) return 'no idbGet';
  window.__origIdbGet = window.idbGet;
  window.idbGet = function (key) {
    const isMail = typeof key === 'string' && key.indexOf('mail-letters') >= 0;
    const delay = isMail ? (key.indexOf(':default:') >= 0 ? 2500 : 0) : 0;
    return new Promise(function (res) {
      setTimeout(function () { window.__origIdbGet(key).then(function (v) { res(v); }); }, delay);
    });
  };
  return 'ok';
})()`);
check('注入慢 IDB（default mail-letters 延迟 2500ms）', patchOk === 'ok', String(patchOk));
if (patchOk !== 'ok') process.exit(1);

// ---- 序列：default → cX（完成权威加载+写信）→ default（权威加载挂起）→ cX ----
await evalJs(`(function(){ window.setActiveContact(${JSON.stringify(cid)}); return true; })()`);
await sleep(600); // cX 权威加载（延迟 0）完成
const cxSeed = JSON.parse(await evalJs(`(function(){
  try {
    window.storeFor(${JSON.stringify(cid)}).set('mail-letters', JSON.stringify([
      { id: 'l_cx_A', type: 'received', tt: '测试', content: '这是cX桌面的信', tm: Date.now() - 100000 }
    ]));
    return JSON.stringify({ ok: true, cid: ${JSON.stringify(cid)}, active: window.__activeCid });
  } catch(e) { return JSON.stringify({ ok: false, err: e.message }); }
})()`) || '{}');
check('cX 桌面写信 B', cxSeed.ok === true && cxSeed.active === cid, JSON.stringify(cxSeed));

// 切回 default → default 权威加载挂起（2500ms）→ 200ms 后切到 cX
await evalJs(`(function(){ window.setActiveContact('default'); return true; })()`);
await sleep(200);
await evalJs(`(function(){ window.setActiveContact(${JSON.stringify(cid)}); return true; })()`);
// 此时 default 的 idbGet 还在飞；等待它迟到返回（2500ms 起点从切回 default 算起）
await sleep(3400);

// ---- 断言：cX 信箱不得混入 default 的信 ----
const after = JSON.parse(await evalJs(`(function(){
  const cid = ${JSON.stringify(cid)};
  const d = JSON.parse(window.storeFor('default').get('mail-letters') || '[]');
  const c = JSON.parse(window.storeFor(cid).get('mail-letters') || '[]');
  return JSON.stringify({
    active: window.__activeCid,
    defaultIds: d.map(x => x.id),
    cids: c.map(x => x.id),
    cCount: c.length
  });
})()`) || '{}');
console.log('  [切换后信箱数据]', JSON.stringify(after));
check('cX 信箱只含本桌面信（不含 default 的 A）', Array.isArray(after.cids) && after.cids.indexOf('l_default_A') < 0, 'cX ids=' + JSON.stringify(after.cids));
check('cX 自己的信仍在', Array.isArray(after.cids) && after.cids.indexOf('l_cx_A') >= 0, 'cX ids=' + JSON.stringify(after.cids));
check('default 信箱仍含自己的信', Array.isArray(after.defaultIds) && after.defaultIds.indexOf('l_default_A') >= 0, 'default ids=' + JSON.stringify(after.defaultIds));

// ---- UI 层：打开 cX 信箱页，列表只显示 cX 的信 ----
const ui = JSON.parse(await evalJs(`(function(){
  try {
    // 打开信箱页
    const app = document.querySelector('.app[data-app="mail"]');
    if (app) app.click();
    const list = document.getElementById('mail-in-list');
    const items = list ? Array.from(list.querySelectorAll('.mail-item')) : [];
    return JSON.stringify({ opened: !!list, count: items.length, titles: items.map(i => (i.querySelector('.mail-item-title')||{}).textContent || '') });
  } catch(e) { return JSON.stringify({ err: e.message }); }
})()`) || '{}');
console.log('  [信箱页 UI]', JSON.stringify(ui));
check('信箱页可打开且渲染列表', ui.opened === true && ui.count >= 1, 'count=' + ui.count);
check('信箱页无混入信件（仅 1 封 cX 的信）', ui.count === 1, 'count=' + ui.count);

const failed = results.filter(r => !r.ok);
console.log('\n===== 回归结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);

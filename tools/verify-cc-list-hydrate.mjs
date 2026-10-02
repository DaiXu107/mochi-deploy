// ===== 验证脚本：进入字卡库列表页 → 挂起的大键按需取回 + 两行角标重算 =====
// 用法：node build.mjs && node tools/verify-cc-list-hydrate.mjs
//   （跑的是仓库根目录产物 index.html；未构建时本脚本会红，红的是产物不是源码——
//    源码层同检查见 tools/verify-cc-lib-hydrate.mjs，不依赖构建）
//
// 复现目标（#266，用户报「导入了好多次字卡都是过一段时间就没了，刷新就消失字卡」）：
//   大库超预算被启动回填挂起（__xyIdbDeferredKeys）/ 回填链被 iOS 挂后台打断时，
//   内存与 localStorage 两路读空、只剩 IndexedDB 有权威数据。此时唯一会把库拉回来的
//   用户查看时点 = 进入 page-chatcard 列表页（chatcard.js 的 hidden 观察者）。
//   该观察者曾被 f143621 写成 `});`（IIFE 漏调用括号）→ 整段死代码 → 角标永远 0、
//   库永远不取回，用户看到的就是「字卡没了」。本脚本用真实 UI 路径断言这条链真的会跑。
//
// 双向对照：L1 先证明现场是「真冷」（角标 0 + 在挂起名单 + IDB 有数据），
//   L2/L3 再证明点进列表页后被恢复。只写 L2 的话，现场没构造成功也会假绿。
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node 21+（内置 WebSocket），当前 Node ' + process.version);
  process.exit(1);
}

// 产物新旧先报一句：红的时候别让人以为是行为回归（源码检查才是真信号）
try {
  const html = readFileSync(join(root, String(process.env.MOCHI_PAGE || 'index.html').replace(/^\/+/, '')), 'utf8');
  const invoked = /\.observe\(libPage,[\s\S]{0,120}?\}\)\(\);/.test(html);
  if (!invoked) console.log('⚠️  产物 index.html 仍是旧版（列表页兜底 IIFE 未被调用）——请先 node build.mjs 再看本脚本结果');
} catch (e) {}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cc-list-hydrate-' + Date.now()),
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

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// 默认跑仓库根产物；MOCHI_PAGE 可指向对照副本（红绿对照用，如打了补丁的临时产物）。
// 值写相对路径且不要带前导斜杠——Git Bash 会把 `/tools/x.html` 改写成
// `C:/Program Files/Git/tools/x.html`，导航静默失败在 about:blank 上。
const page = String(process.env.MOCHI_PAGE || 'index.html').replace(/^\/+/, '');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/' + page });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 导航失败会停在 about:blank，后续每条 eval 都抛 localStorage SecurityError，
// 看着像行为回归其实页面根本没起来——先卡一道，红得有意义。
const boot = await evalJs("JSON.stringify({href:location.href,app:typeof window.activePrefix})");
if (!/"app":"function"/.test(boot || '')) {
  console.error('页面未启动（导航失败或产物损坏）：' + boot + '  MOCHI_PAGE=' + page);
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(1);
}

// ① 构造「字卡库只在 IDB、内存与 LS 两路读空、且被回填挂起」现场
//    （页面刚启动时两键本就无数据 → 内存缓存为空，读不到才是真实现场；
//     idbSet 是 IDB 裸写，不碰内存缓存，所以取回前三路确实只有 IDB 有值）
// 先等一次性「作用域迁移」落定再播种：实测它在启动后数秒才跑，会把 default 桌面 cc-groups
// 当旧版存量整库搬进公用键并 st.remove 掉原键（chatcard.js 的 cc-scope-migration 块），
// 播种早于它 → 专属种子被搬走、公用角标数出别人的卡，断言数字全不可信。
for (let i = 0; i < 40; i++) {
  if ((await evalJs("localStorage.getItem('xy-home-v2:cc-scope-migrated')")) === '1') break;
  await sleep(300);
}
const PUB = { text: [['公用组', ['公用卡A', '公用卡B']]] };
const OWN = { text: [['专属组', ['专属卡C', '专属卡D', '专属卡E']]] };
const setup = await evalJs(`(async function(){
  const pubKey='xy-home-v2:cc-groups-public', ownKey=window.activePrefix()+':cc-groups';
  try { window.xyStore('xy-home-v2').set('cc-scope-migrated', '1'); } catch (e) {}
  window.__xyIdbDeferredKeys=[pubKey, ownKey];
  localStorage.removeItem(pubKey); localStorage.removeItem(ownKey);
  await window.idbSet(pubKey, ${JSON.stringify(JSON.stringify(PUB))});
  await window.idbSet(ownKey, ${JSON.stringify(JSON.stringify(OWN))});
  return JSON.stringify({
    pubKey: pubKey, ownKey: ownKey,
    migrated: localStorage.getItem('xy-home-v2:cc-scope-migrated') === '1',
    deferred: window.libScopesDeferred(['public','own']),
    lsPub: localStorage.getItem(pubKey) === null,
    lsOwn: localStorage.getItem(ownKey) === null,
    idbPub: (await window.idbGet(pubKey)) !== null,
    idbOwn: (await window.idbGet(ownKey)) !== null
  });
})()`);
const s = JSON.parse(setup || '{}');
check('现场构造：两键在挂起名单且 LS 无值', s.deferred === true && s.lsPub === true && s.lsOwn === true, JSON.stringify(s));
check('现场构造：作用域迁移已落定（否则会搬走专属种子、角标数字失真）', s.migrated === true, JSON.stringify(s));
check('现场构造：IndexedDB 有权威数据（读得到却用不上 = 复现条件）', s.idbPub === true && s.idbOwn === true);

// ② 反向对照：还没进列表页时，角标确实是 0（现场若已被别的链路救回，本脚本就没资格报绿）
const before = await evalJs(`(function(){
  return JSON.stringify({pub:document.getElementById('cc-pub-count').textContent,
    own:document.getElementById('cc-list-count').textContent,
    pageHidden:document.getElementById('page-chatcard').hidden});
})()`);
const b = JSON.parse(before || '{}');
check('进页前角标为 0（证明「空载」现场成立，非假绿）', b.pub === '0' && b.own === '0' && b.pageHidden === true, before);

// ③ 点底部 tab 进字卡库列表页 → 兜底取回 + 角标重算（真实用户路径，不碰任何内部函数）
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.dispatchEvent(new MouseEvent('click',{bubbles:true}));return JSON.stringify({shown:!document.getElementById('page-chatcard').hidden});})()");
let toastSeen = false, after = '', a = {};
for (let i = 0; i < 40; i++) {
  const r = await evalJs(`(function(){
    var t=document.getElementById('cc-toast');
    return JSON.stringify({toast:!!t&&/正在加载/.test(t.textContent||''),
      pub:document.getElementById('cc-pub-count').textContent,
      own:document.getElementById('cc-list-count').textContent,
      deferred:window.libScopesDeferred(['public','own'])});
  })()`);
  const d = JSON.parse(r || '{}');
  if (d.toast) toastSeen = true;
  after = r || '';
  a = d;
  if (d.pub !== '0' && d.own !== '0') break;
  await sleep(120);
}
check('进列表页 → 提示「字卡较多，正在加载…」（挂起分支命中）', toastSeen, 'toast=' + toastSeen);
check('进列表页 → 公用角标重算为 2', a.pub === '2', after);
check('进列表页 → 专属角标重算为 3', a.own === '3', after);
check('进列表页 → 两键移出挂起名单', a.deferred === false, after);

// ④ 取回后内存真的有了数据（角标不是只改了 DOM 文本）
const mem = await evalJs(`(function(){
  var p=window.getScopedGroups('text','public')||[], o=window.getScopedGroups('text','own')||[];
  return JSON.stringify({pub:p.length, own:o.length, first:(o[0]&&(o[0][1]||[])[0])||''});
})()`);
const m = JSON.parse(mem || '{}');
check('取回后作用域分组读得到数据（内存缓存已填，非仅改文本）', m.pub === 1 && m.own === 1 && m.first === '专属卡C', mem);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

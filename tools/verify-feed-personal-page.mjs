// ===== 专项脚本：#811 多联系人「个人朋友圈」按人显示（头像/背景/内容不再串身份） =====
// 用法：node tools/verify-feed-personal-page.mjs（MOCHI_ROOT=副本 可指到隔离构建目录）
// 背景（用户实报 vivo S9 Chrome，多机型同现）：多联系人下点头像进「个人朋友圈」原按「桌面」过滤——
//   ①进 B 的个人页，B 桌面上我的动态被并进来；②B 没设 TA 封面而设过我的朋友圈背景时，
//   B 的个人页背景显示成我的背景（feedAllBg「我的封面优先」）；③点我自己动态的头像（owner=发布
//   时所在桌面）进的还是同一桌面页＝「进我的朋友圈显示成了 B 的」。修复=页面按「人」两形态
//  （who='ta' 该桌面 TA 动态+feed-ta-cover / who='me' 我跨桌面全部动态+当前桌面 feed-cover-bg），
//   头像入口带 data-role 分流。
// 验证（无头 Chrome，种子=两桌面四条动态：A桌TA/A桌我/B桌TA/B桌我）：
//   S0 环境闸门：主列表四条全渲染；
//   A1 点 B 的 TA 动态头像 → 「B宝 的全部朋友圈」，只有 B桌TA 动态，我的动态不再并入（旧实现必红）；
//   A2 B 页背景不显示我的朋友圈背景（旧实现「我的封面优先」必红）；B 未设 TA 封面＝无背景（默认）；
//   B1 点 A 的 TA 动态头像 → 「A宝 的全部朋友圈」，只有 A桌TA 动态；背景=A 的 TA 封面（不是我的封面，旧实现必红）；
//   C1 点我在 B 桌动态的头像 → 「我的朋友圈」，我跨桌面两条动态全在、TA 动态不混入（旧实现进的是 B 的页＝必红）；
//   C2 我的页背景=当前桌面「我」的朋友圈背景；C3 封面昵称=「我」；
//   Z 全程零 JS 报错。
const root = (function () {
  // Git Bash 传入 /c/... 形态时 node 解析不到（全 404＝页面都起不来），归一成 Windows 盘符路径
  let r = process.env.MOCHI_ROOT || process.cwd();
  const m = r.match(/^\/([a-zA-Z])\/(.*)$/);
  if (m && process.platform === 'win32') r = m[1].toUpperCase() + ':/' + m[2];
  return r;
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const { spawn } = await import('node:child_process');
const { createServer } = await import('node:http');
const { readFileSync, statSync } = await import('node:fs');
const { join, normalize, extname } = await import('node:path');

const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
// 服务层：python http.server 优先——实测本机安全策略会单独拦「node 监听套接字」的入站
// （node 自 fetch 正常、浏览器连 localhost 被 chrome-error；python 起的服务浏览器可达）。
// CDP 是 node 主动外连不受影响。无 python 时退回 node 内置服务。
const { execFileSync } = await import('node:child_process');
let pyBin = null;
for (const c of [process.env.PYTHON_PATH, 'python', 'python3']) {
  if (!c) continue;
  try { execFileSync(c, ['--version'], { stdio: 'ignore' }); pyBin = c; break; } catch (e) {}
}
let server = null;
const srvPort = 18000 + Math.floor(Math.random() * 900);
if (pyBin) {
  server = spawn(pyBin, ['-m', 'http.server', String(srvPort), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
} else {
  server = createServer((req, res) => {
    try {
      let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (statSync(p).isDirectory()) p = join(p, 'index.html');
      res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
      res.end(readFileSync(p));
    } catch (e) { res.writeHead(404); res.end('nf'); }
  });
  await new Promise((r) => server.listen(srvPort, '127.0.0.1', r));
}
// 等服务就绪（node 侧 fetch 是出站，不受上述拦截影响）
for (let i = 0; i < 40; i++) {
  try { const r = await fetch('http://127.0.0.1:' + srvPort + '/index.html'); if (r.ok) break; } catch (e) {}
  await sleep(250);
}
const baseUrl = 'http://127.0.0.1:' + srvPort;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-feed-personal-' + Date.now()),
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}
async function gotoApp(reload) {
  if (reload) await cdp('Page.reload', { ignoreCache: false });
  else await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 背景用「假 dataURL 标记串」即可（safeBg 只验类型与长度，不解码）——断言按标记子串匹配
const ME1 = 'data:image/png;base64,ME1MARK-my-cover-on-default';
const MEB = 'data:image/png;base64,MEBMARK-my-cover-on-bdesk';
const TABG = 'data:image/png;base64,TABGMARK-ta-cover-on-default';

const boot = `
(function () {
  var T = Date.now();
  var posts = [
    { id: 'pa1', role: 'ta', owner: 'default', authorName: '小桃', taName: '小桃', authorAv: '', content: 'A桌TA动态', ts: T - 9000, likes: [], comments: [] },
    { id: 'pb1', role: 'ta', owner: 'bdesk', authorName: '小B', taName: '小B', authorAv: '', content: 'B桌TA动态', ts: T - 8000, likes: [], comments: [] },
    { id: 'pm1', role: 'me', owner: 'bdesk', authorName: '我', authorAv: '', content: '我在B桌发的动态', ts: T - 7000, likes: [], comments: [] },
    { id: 'pm2', role: 'me', owner: 'default', authorName: '我', authorAv: '', content: '我在A桌发的动态', ts: T - 6000, likes: [], comments: [] }
  ];
  var all = JSON.stringify(posts);
  localStorage.setItem('xy-home-v2:feed-posts', all);
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: 'A宝' }, { id: 'bdesk', name: 'B宝' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  localStorage.setItem('xy-home-v2:default:feed-cover-bg', '${ME1}');
  localStorage.setItem('xy-home-v2:default:feed-ta-cover', '${TABG}');
  localStorage.setItem('xy-home-v2:bdesk:feed-cover-bg', '${MEB}');
  localStorage.setItem('xy-home-v2:cardlock-state', 'open');
  ['xy-home-v2:', 'xy-home-v2:default:', 'xy-home-v2:bdesk:'].forEach(function (pre) {
    localStorage.setItem(pre + 'reply-fd-comment-prob', '0');
    localStorage.setItem(pre + 'reply-fd-likeback-prob', '0');
    localStorage.setItem(pre + 'reply-fd-reply-prob', '0');
  });
  var idbSeed = {};
  idbSeed['xy-home-v2:feed-posts'] = all;
  var gStub = function (k) { return Promise.resolve(idbSeed[k] !== undefined ? idbSeed[k] : null); };
  var sStub = function () { return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbDelete', { configurable: false, get: function () { return dStub; }, set: function () {} });
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 先注册种子再导航（addScriptToEvaluateOnNewDocument 对后续文档持续生效）——
// 两段式「先空库进一次再 reload」会让第一跳跑进首启引导态污染第二跳（实测 HEAD 包启动即挂）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await gotoApp(false);

// 关开屏层（.splash:not(.hide) ~ .phone 会让整页不可命中）
if (process.env.MOCHI_DEBUG) {
  const dbg = await evalJs(`(function(){
    return { href: location.href, title: document.title, bodyLen: (document.body||{}).innerHTML ? document.body.innerHTML.length : -1,
      hasPageFeed: !!document.getElementById('page-feed'), hasPhone: !!document.querySelector('.phone'),
      ready: !!window.__mochiDataReady, splashN: document.querySelectorAll('.splash').length };
  })()`);
  console.log('DEBUG-PAGE:', JSON.stringify(dbg));
}
await evalJs(`(function(){
  document.querySelectorAll('.splash, .splash-notice, .splash-box').forEach(function (n) {
    n.classList.add('hide'); n.style.display = 'none';
  });
  return true;
})()`);
await sleep(300);

// 打开朋友圈
await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
await sleep(900);

// S0 环境闸门：主列表四条全渲染
const s0 = await evalJs(`(function(){
  return {
    n: document.querySelectorAll('#feed-list .feed-post').length,
    pageVisible: !document.getElementById('page-feed').hidden
  };
})()`);
check('S0 主列表四条动态全渲染（环境闸门）', s0 && s0.n === 4 && s0.pageVisible, s0 ? ('n=' + s0.n) : 'null');

// 通用：点某条动态的头像 → 进个人页，取页面的标题/内容/背景
async function openPersonalAndProbe(pid) {
  await evalJs(`(function(){ var el = document.querySelector('#feed-post-${pid} .feed-head-av'); if (el) el.click(); return !!el; })()`);
  await sleep(500);
  const r = await evalJs(`(function(){
    var page = document.getElementById('page-feed-all');
    return {
      visible: page && !page.hidden,
      title: (document.getElementById('feed-all-title') || {}).textContent || '',
      list: (document.getElementById('feed-all-list') || {}).textContent || '',
      bg: (document.getElementById('feed-all-cover') || {}).style ? document.getElementById('feed-all-cover').style.backgroundImage : '',
      coverName: (document.getElementById('feed-all-name') || {}).textContent || ''
    };
  })()`);
  await evalJs(`(function(){ var b = document.getElementById('feed-all-back'); if (b) b.click(); return true; })()`);
  await sleep(400);
  return r;
}

// A1/A2：B 的个人页——只看 B 桌 TA 动态；背景不再用我的
const b = await openPersonalAndProbe('pb1');
check('A1 B 的个人页标题为「B宝 的全部朋友圈」', b && b.visible && b.title === 'B宝 的全部朋友圈', b ? b.title : 'null');
check('A1b B 的个人页含 B桌TA动态', b && b.list.indexOf('B桌TA动态') >= 0, '');
check('A1c B 的个人页不再并入我在 B 桌的动态（#811 主诉①）', b && b.list.indexOf('我在B桌发的动态') < 0, b ? ('len=' + b.list.length) : 'null');
check('A2 B 的个人页背景不再是我的朋友圈背景（#811 主诉②；B 未设 TA 封面＝默认无背景）', b && b.bg.indexOf('MEBMARK') < 0 && b.bg.indexOf('data:') < 0, b ? b.bg.slice(0, 60) : 'null');

// B1：A 的个人页——只看 A 桌 TA 动态；背景=A 的 TA 封面
const a = await openPersonalAndProbe('pa1');
check('B1 A 的个人页标题/内容正常', a && a.visible && a.title === 'A宝 的全部朋友圈' && a.list.indexOf('A桌TA动态') >= 0, a ? a.title : 'null');
check('B1b A 的个人页不并入我在 A 桌的动态', a && a.list.indexOf('我在A桌发的动态') < 0, '');
check('B1c A 的个人页背景=A 的 TA 封面（不是我的封面）', a && a.bg.indexOf('TABGMARK') >= 0 && a.bg.indexOf('ME1MARK') < 0, a ? a.bg.slice(0, 60) : 'null');

// C1~C3：点我在 B 桌动态的头像 → 「我的朋友圈」（我跨桌面全部动态，身份/背景=当前桌面「我」）
const m = await openPersonalAndProbe('pm1');
check('C1 点我的头像进的是「我的朋友圈」（#811 主诉③）', m && m.visible && m.title === '我的朋友圈', m ? m.title : 'null');
check('C1b 我的页含我在 A/B 两桌的全部动态', m && m.list.indexOf('我在B桌发的动态') >= 0 && m.list.indexOf('我在A桌发的动态') >= 0, '');
check('C1c 我的页不混入 TA 动态', m && m.list.indexOf('B桌TA动态') < 0 && m.list.indexOf('A桌TA动态') < 0, '');
check('C2 我的页背景=当前桌面我的朋友圈背景', m && m.bg.indexOf('ME1MARK') >= 0 && m.bg.indexOf('MEBMARK') < 0, m ? m.bg.slice(0, 60) : 'null');
check('C3 我的页封面昵称=「我」', m && m.coverName === '我', m ? m.coverName : 'null');

// Z：零 JS 报错
const errs = await evalJs('(window.__jsErrors || []).length');
check('Z 全程零 JS 报错', errs === 0, 'errors=' + errs);

try { chrome.kill(); } catch (e) {}
try { server.close ? server.close() : server.kill(); } catch (e) {}
const failed = results.filter(r => !r.ok);
console.log('==== ' + (results.length - failed.length) + '/' + results.length + ' 通过 ====');
process.exit(failed.length ? 1 : 0);

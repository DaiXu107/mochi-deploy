// ===== 回归脚本：全站 .page 结构与几何「全量」审计（不只查已知的少数子页）=====
// 立项原因（#474/#475 家族续）：#474 修的是「已知的 8 个子页」，但同族病（结构嵌套 → 父级 hidden
//   联动 → 整页纯白 / 整块消失）**天生是面状的**——模板里多一个或少一个 </div>，受害的是「其后所有 .page」，
//   具体是哪几个完全取决于闭合错在哪。只断言那 8 个 id，等于给这类 bug 留了「换一批受害页就漏」的口子。
//   本脚本改为**从产物里现取全部 .page**，一个不漏地查两件事：
//     ① 静态：标签栈解析，每个 .page 的父元素必须是 .phone 直子（除 page-phone 自身）；
//        且没有任何 .page 被另一个 .page 吞掉。
//     ② 动态：真实浏览器里按全站同款切页写法（隐藏所有 .page → 显示目标页）逐个打开，
//        几何必须 > 0 且占满视口宽（#474 坏产物实测：掉到 body 的子页 w=0 h=3583；被父级 hidden 的 = 0×0）。
//   附带：.tabbar 归属（#467）、page-* id 与实际 .page 集合的一致性、终态零未捕获异常。
//
// 与 tools/verify-page-nesting.mjs 的关系：那个脚本是 #474 的「定点精确捕获」（8 页 + 真实入口端到端，
//   判别力有红绿基线实证）；本脚本是「面状兜底」，防换一批受害页漏检。两者互补，都留在 verify:all。
//
// 用法：node tools/verify-all-pages.mjs
//       SERVE_ROOT=<隔离构建目录> node tools/verify-all-pages.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— 静态结构解析：标签栈（先剥注释/脚本/样式，避免字符串里的假标签）——
function stripBlocks(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');
}
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function parseTree(html) {
  const src = stripBlocks(html);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const stack = [];
  const all = [];
  let m;
  while ((m = re.exec(src))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    let attrs = m[3] || '';
    if (VOID.has(tag)) continue;
    if (!closing) {
      const idM = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
      const clsM = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
      const node = {
        tag,
        id: idM ? idM[1] : '',
        cls: clsM ? clsM[1] : '',
        parent: stack.length ? stack[stack.length - 1] : null,
      };
      all.push(node);
      stack.push(node);
      if (/\/\s*$/.test(attrs)) stack.pop();
    } else {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
    }
  }
  return all;
}
const hasCls = (n, c) => !!n && new RegExp('(^|\\s)' + c + '(\\s|$)').test(n.cls || '');
function ancestorWithCls(node, cls) {
  let p = node.parent;
  while (p) { if (hasCls(p, cls)) return p; p = p.parent; }
  return null;
}

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  ' + detail : '')); }
}

// ============ 阶段 A：静态结构（src 与产物双侧） ============
for (const [label, file] of [['src/template.html', join(__root, 'src', 'template.html')], ['index.html(产物)', join(root, 'index.html')]]) {
  let html = '';
  try { html = readFileSync(file, 'utf8'); } catch (e) { chk('A ' + label + ' 可读', false, e.message); continue; }
  const nodes = parseTree(html);
  const pages = nodes.filter((n) => hasCls(n, 'page'));
  const nested = pages.filter((p) => !!ancestorWithCls(p, 'page'))
    .map((p) => (p.id || p.tag) + '@' + (ancestorWithCls(p, 'page').id || ancestorWithCls(p, 'page').tag));
  const badParent = pages.filter((p) => p.id !== 'page-phone' && !hasCls(p.parent, 'phone'))
    .map((p) => (p.id || p.tag) + '→' + (p.parent ? (p.parent.id || p.parent.tag + '.' + p.parent.cls) : 'null'));
  const noId = pages.filter((p) => !p.id).length;
  console.log('A[' + label + '] pages=' + pages.length + ' nested=' + JSON.stringify(nested) + ' badParent=' + JSON.stringify(badParent));
  chk('A1 ' + label + ' 存在足量 .page（>=50）', pages.length >= 50, 'pages=' + pages.length);
  chk('A2 ' + label + ' 没有任何 .page 被另一个 .page 吞掉', nested.length === 0, JSON.stringify(nested));
  chk('A3 ' + label + ' 除 page-phone 外所有 .page 的父元素是 .phone 直子', badParent.length === 0, JSON.stringify(badParent));
  chk('A4 ' + label + ' 每个 .page 都有 id（可定位可审计）', noId === 0, 'noId=' + noId);
  const tb = nodes.filter((n) => hasCls(n, 'tabbar'));
  chk('A5 ' + label + ' .tabbar 存在且不在任何 .page 内（#467 同族）',
    tb.length > 0 && tb.every((t) => !ancestorWithCls(t, 'page')), 'tb=' + tb.length + ' inPage=' + tb.filter((t) => !!ancestorWithCls(t, 'page')).length);
}

// ============ 阶段 B/C：真实浏览器（三种机型尺寸） ============
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(fail ? 1 : 0); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9750 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-allpages-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank',
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
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
          if (m.method === 'Runtime.exceptionThrown') { jsErrors++; console.error('EXC', JSON.stringify(m.params.exceptionDetails).slice(0, 300)); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});

async function closeSplash() {
  for (let i = 0; i < 30; i++) {
    const s = await evalJs(`(function(){
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
        var men = document.getElementById('splash-mandatory-enter');
        if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
        return 'mwait';
      }
      var sp = document.getElementById('splash');
      if (!sp || sp.classList.contains('hide')) return 'closed';
      var sb = document.getElementById('splash-box'); if (sb) sb.scrollTop = sb.scrollHeight;
      var se = document.getElementById('splash-enter');
      if (se && !se.disabled) { se.click(); return 'clicked'; }
      return 'wait';
    })()`);
    if (s === 'closed') break;
    await sleep(300);
  }
  await evalJs(`(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men)men.click();mm.hidden=true;}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()`);
  await sleep(500);
}

const PROFILES = [
  ['390×844(iPhone 系)', 390, 844],
  ['360×640(小屏安卓)', 360, 640],
  ['412×915(大屏安卓)', 412, 915],
];

const LIST_PAGES_JS = `(function(){
  var out = [];
  var ps = document.querySelectorAll('.page');
  for (var i = 0; i < ps.length; i++) {
    var el = ps[i];
    var chain = [];
    var p = el.parentElement;
    while (p && p !== document.body) { chain.push(p.className || p.id || p.tagName); p = p.parentElement; }
    out.push({ id: el.id || ('(no-id#' + i + ')'), cls: el.className, chain: chain });
  }
  return out;
})()`;
const geomJs = (id) => `(function(){
  var ps = document.querySelectorAll('.page');
  for (var i = 0; i < ps.length; i++) { if (!ps[i].hidden) ps[i].hidden = true; }
  var el = document.getElementById(${JSON.stringify(id)});
  if (!el) return null;
  el.hidden = false;
  var r = el.getBoundingClientRect();
  var cs = getComputedStyle(el);
  return { w: Math.round(r.width), h: Math.round(r.height), disp: cs.display, vis: cs.display !== 'none' && cs.visibility !== 'hidden' };
})()`;
const RESET_JS = `(function(){var ps=document.querySelectorAll('.page');for(var i=0;i<ps.length;i++){if(!ps[i].hidden)ps[i].hidden=true;}var ph=document.getElementById('page-phone');if(ph)ph.hidden=false;return true;})()`;

let worseDetailed = [];
for (const [tag, w, h] of PROFILES) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  await closeSplash();

  const list = await evalJs(LIST_PAGES_JS);
  if (!list || !list.length) { chk(tag + 'B1 能枚举到 .page', false, JSON.stringify(list)); continue; }
  const domIds = list.map((p) => p.id);
  const dupIds = domIds.filter((v, i) => domIds.indexOf(v) !== i);
  chk(tag + 'B1 产物 .page 列表可枚举且 id 唯一', dupIds.length === 0, 'n=' + list.length + ' dup=' + JSON.stringify(dupIds));

  // 结构性：父链里不得再出现 .page；宽度/高度必须撑起来
  const bad = [];
  for (const p of list) {
    if (p.id === 'page-phone') continue;
    const g = await evalJs(geomJs(p.id));
    const hiddenInChain = p.chain.some((c) => /(^|\s)page(\s|$)/.test(c));
    const okGeom = g && g.w > 300 && g.h > 100 && g.vis === true;
    if (!okGeom || hiddenInChain) {
      bad.push({ id: p.id, geom: g, nestedInPage: hiddenInChain, chain: p.chain.slice(0, 4) });
    }
  }
  console.log('B3[' + tag + '] 检查 ' + (list.length - 1) + ' 个 .page，异常 ' + bad.length + ' 个');
  for (const b of bad.slice(0, 20)) console.log('    ⚠ ' + JSON.stringify(b));
  chk(tag + 'B3 全部 .page 逐个打开后几何 > 0 且不在其它 .page 内（' + (list.length - 1) + ' 个）', bad.length === 0, JSON.stringify(bad.slice(0, 8)));
  if (bad.length) worseDetailed = worseDetailed.concat(bad.map((b) => tag + ' ' + b.id));

  await evalJs(RESET_JS);
  await sleep(200);
}
const appErrs = await evalJs('(window.__jsErrors && __jsErrors.length) || 0');
chk('C1 终态无未捕获 JS 异常', appErrs === 0 && jsErrors === 0, 'cdp=' + jsErrors + ' app=' + appErrs);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

if (worseDetailed.length) console.log('异常页汇总：' + JSON.stringify(worseDetailed));
console.log('（作用域：' + (process.env.SERVE_ROOT ? 'SERVE_ROOT=' + process.env.SERVE_ROOT : '仓库根目录产品') + '）');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

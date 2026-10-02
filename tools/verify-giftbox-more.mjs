// ===== 专项：聊天更多功能【心意柜】快捷按钮（src/js/gift-shop.js #more-giftbox 入口） =====
// 覆盖：互动分类按钮存在且紧跟心意集市 / 点击开心意柜全屏页(收更多面板+全屏chrome) / 返回键回聊天页
//       （聊天页属 FULL_PAGES，恢复 tabbar 隐藏+无状态栏属正确态）/ 桌面图标路径回归仍回主页 / 零 JS 异常。
// 用法：node tools/verify-giftbox-more.mjs（自组装 src，不依赖构建产物）
// 临时冒烟：聊天更多功能【心意柜】快捷按钮（自组装 src，不依赖构建产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

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
if (!chromePath) { console.error('no chrome'); process.exit(1); }

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arrOf = (k) => (bm.match(new RegExp(k + '\\s*=\\s*\\[([\\s\\S]*?)\\]')) || [])[1]
  .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => {
  let code = '';
  try { code = readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) {}
  return '(function(){try{\n' + code + '\n}catch(__e){if(window.__jsErrors)window.__jsErrors.push("' + f + ':"+(__e&&__e.message||__e));}})();';
}).join('\n'));

const site = join(tmpdir(), 'mochi-giftbox-smoke-' + Date.now());
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'index.html'), html);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(site, decodeURIComponent(req.url.split('?')[0])));
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types['.html'] });
    res.end(body);
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(tmpdir(), 'mochi-giftbox-smoke-prof-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; }
  } catch (e) {}
  await sleep(150);
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    console.log('[console.' + m.params.type + ']', (m.params.args || []).map((a) => a.value !== undefined ? a.value : (a.description || '')).join(' ').slice(0, 300));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('[exception]', JSON.stringify(m.params.exceptionDetails && (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)).slice(0, 300));
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
};
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return '__ERR__' + JSON.stringify(r.exceptionDetails).slice(0, 200);
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function check(desc, ok, detail) { if (ok) { pass++; console.log('PASS  ' + desc); } else { fail++; console.log('FAIL  ' + desc + (detail ? '  [' + detail + ']' : '')); } }

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
let ready = false;
for (let i = 0; i < 60; i++) { if ((await evalJs('!!window.__mochiDataReady')) === true) { ready = true; break; } await sleep(250); }
if (!ready) {
  console.log('[diag]', await evalJs(`JSON.stringify({
    phone: !!document.querySelector('.phone'),
    splash: !!(document.getElementById('splash')),
    splashCls: (document.getElementById('splash')||{}).className,
    idbGet: typeof window.idbGet,
    chatAddIn: typeof window.chatAddIn,
    contacts: typeof window.getContacts,
    pages: document.querySelectorAll('.page').length
  })`));
}
check('T0 应用启动就绪', ready);
await sleep(800);

// A 静态：按钮存在/分类/DOM 紧跟心意集市
const a = await evalJs(`(function(){
  var b=document.getElementById('more-giftbox'), g=document.getElementById('more-gift');
  if(!b||!g) return JSON.stringify({ex:false});
  var panel=b.closest('#chat-more-panel');
  return JSON.stringify({
    ex:true, mcat:b.getAttribute('data-mcat'), label:(b.querySelector('span:last-child')||{}).textContent,
    title:b.getAttribute('title'), next:g.nextElementSibling===b, inPanel:!!panel
  });
})()`);
let ao = {}; try { ao = JSON.parse(a); } catch (e) {}
check('A1 more-giftbox 存在且在互动面板内', ao.ex && ao.inPanel, a);
check('A2 分类 data-mcat=chat', ao.mcat === 'chat', String(ao.mcat));
check('A3 文案为「心意柜」', ao.label === '心意柜' && ao.title === '心意柜', ao.label + '/' + ao.title);
check('A4 DOM 紧跟【心意集市】右侧（下一个兄弟节点）', ao.next === true);

// B 聊天入口：开更多面板 → 点心意柜
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return !!b;})()");
await sleep(200);
const bOpen = await evalJs("!document.getElementById('chat-more-panel').hidden");
check('B1 更多功能面板已打开', bOpen === true);
await evalJs("(function(){var b=document.getElementById('more-giftbox');if(b)b.click();return !!b;})()");
await sleep(500);
const b2 = await evalJs(`(function(){
  var pg=document.getElementById('page-giftbox');
  var tb=document.querySelector('.tabbar'); var ph=document.querySelector('.phone');
  return JSON.stringify({
    panelHidden:document.getElementById('chat-more-panel').hidden,
    boxVisible:!!pg&&!pg.hidden, full:!!(pg&&pg.classList.contains('full')),
    tabbarHidden:tb?tb.hidden:null, noSb:ph?ph.classList.contains('no-statusbar'):null,
    statIn:!!document.getElementById('giftbox-stat-in'),
    chatHidden:document.getElementById('page-chat').hidden
  });
})()`);
let bo = {}; try { bo = JSON.parse(b2); } catch (e) {}
check('B2 点击后更多面板收起', bo.panelHidden === true, b2);
check('B3 心意柜全屏页打开(.full)', bo.boxVisible === true && bo.full === true);
check('B4 全屏 chrome 正确(tabbar 隐藏+无状态栏)', bo.tabbarHidden === true && bo.noSb === true);
check('B5 心意柜内容已渲染', bo.statIn === true);

// C 返回：应回聊天页而非主页
await evalJs("(function(){var b=document.getElementById('giftbox-back');if(b)b.click();return !!b;})()");
await sleep(300);
const c1 = await evalJs(`(function(){
  var tb=document.querySelector('.tabbar'); var ph=document.querySelector('.phone');
  return JSON.stringify({
    chatVisible:!document.getElementById('page-chat').hidden,
    boxHidden:document.getElementById('page-giftbox').hidden,
    tabbarShown:tb?!tb.hidden:null,
    sbBack:ph?!ph.classList.contains('no-statusbar'):null,
    flagCleared:window.__giftboxFrom!=='chat'
  });
})()`);
let co = {}; try { co = JSON.parse(c1); } catch (e) {}
check('C1 返回键回到聊天页', co.chatVisible === true && co.boxHidden === true, c1);
// 聊天页属 FULL_PAGES：正常态就是 tabbar 隐藏 + 无模拟状态栏（syncChrome 恢复）
check('C2 返回后恢复聊天页全屏 chrome(tabbar 隐藏+无状态栏)', co.tabbarShown === false && co.sbBack === false, c1);
check('C3 __giftboxFrom 标记已清', co.flagCleared === true);

// D 桌面图标路径不受影响：直接点桌面图标 → 返回回主页
await evalJs("(function(){var el=document.querySelector('[data-app=\"giftbox\"]');if(el)el.click();return !!el;})()");
await sleep(400);
const d1 = await evalJs("!document.getElementById('page-giftbox').hidden");
check('D1 桌面图标仍能打开心意柜', d1 === true);
await evalJs("(function(){var b=document.getElementById('giftbox-back');if(b)b.click();return true;})()");
await sleep(300);
const d2 = await evalJs(`(function(){
  return JSON.stringify({ home:!document.getElementById('page-phone').hidden, chat:!document.getElementById('page-chat').hidden });
})()`);
let dobj = {}; try { dobj = JSON.parse(d2); } catch (e) {}
check('D2 桌面入口返回仍回手机主页', dobj.home === true && dobj.chat !== true, d2);

// E 无 JS 异常
const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
check('E1 全程零 JS 异常', errs === '[]', String(errs));

console.log('\\n== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

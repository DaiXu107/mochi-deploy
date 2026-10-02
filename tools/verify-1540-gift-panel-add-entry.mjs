// ===== 常驻回归 #1540：聊天送礼面板（标题「心意集市 · TA」）补「上传我的商品」入口 =====
// 报障（多机型同报）：「心意集市自己添加商品的按钮不见了」。排查实证：全屏市集页（桌面图标进）
// 的大按钮/底部胶囊一直在（现 build 无头截图＋线上 origin 产物双确认）；真正的缺口是**聊天里那个
// 标题就叫「心意集市」的送礼面板**——它只有分类与商品网格，添加商品的入口从 #858 起只存在于市集页。
// 用户在聊天面板找「自己添加商品」＝同名面缺入口（#1530 心意柜补领取同族：动作在一个面、用户在另一个
// 同名面找）。修法＝面板 init 注入一次「＋ 上传我的商品」入口（复用 openAddGiftForm 表单），
// 保存后 marketRerenderBoth 让开着的面板网格就地出新商品。零机型／零 UA 分支。
// 断言组：
//   S  源码口径（入口注入＋防重注入守卫、点击开表单、保存 marketRerenderBoth、样式与暗色）
//   B1 打开聊天送礼面板：标题「心意集市」、面板内出现【＋ 上传我的商品】
//   B2 点入口 → 弹出「添加商品」表单（#tc-mask 层）
//   B3 填名保存 → 表单关、面板网格就地出现新商品、market-custom 落库
//   B4 全屏市集页同样有这件新商品（两条入口同一份商品库）＋市集页原有大按钮仍在
//   Z1 全程零未捕获 JS 异常
// 红基线（纯 HEAD 副本）预期：S 全红；B1 入口红；B2/B3 红（无入口可点）；B4 市集侧绿（控制项）。
// 用法：node tools/verify-1540-gift-panel-add-entry.mjs
//       MOCHI_ROOT=<仓外副本> node tools/verify-1540-gift-panel-add-entry.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => { try { return JSON.parse(v); } catch (e) { return null; } };

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? ' \u2014 ' + extra : '')); }
};

// ---------------- S 层：源码断言 ----------------
console.log('S 层：源码口径');
{
  const gs = readFileSync(join(root, 'src/js/gift-shop.js'), 'utf8');
  const mc = readFileSync(join(root, 'src/css/market.css'), 'utf8');
  ok(/'<div class="gift-mine-row" id="gift-mine-entry"><button id="gift-mine-add" type="button">＋ 上传我的商品<\/button><\/div>'/.test(gs),
    'S1 面板注入「上传我的商品」入口（gift-mine-row）');
  ok(/if \(!document\.getElementById\('gift-mine-entry'\)\)/.test(gs),
    'S2 防重注入守卫（重开聊天不重复插行）');
  ok(/if \(mineAddBtn\) mineAddBtn\.addEventListener\('click', function \(\) \{ openAddGiftForm\(null\); \}\);/.test(gs),
    'S3 入口点击直接开 openAddGiftForm 表单（市集页与面板同一张表单）');
  ok(/customSave\(customs\); closeTc\(\); marketRerenderBoth\(\); toast\('已保存'\);/.test(gs),
    'S4 保存走 marketRerenderBoth（市集页＋开着的面板网格都就地重画）');
  ok(/\.gift-mine-row button \{ width: 100%; padding: 10px 0; border-radius: 12px; border: 1px solid rgba\(0, 0, 0, 0\.14\); background: #f7f7f7; color: #111; font-size: 13px; cursor: pointer; -webkit-tap-highlight-color: transparent; \}/.test(mc) &&
    /\[data-theme="dark"\] \.gift-mine-row button/.test(mc),
    'S5 入口样式与暗色适配在位（与心愿单入口同族）');
}

// ---------------- B 层：无头 Chrome 行为 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const site = join(tmpdir(), 'mochi-g1540-' + Date.now());
const profDir = join(tmpdir(), 'mochi-g1540-prof-' + Date.now());
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'index.html'), html);
const server = createServer((req, res) => {
  try {
    const p = normalize(join(site, decodeURIComponent(req.url.split('?')[0])));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9780 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
let booted = false;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); booted = true; break; }
  } catch (e) {}
  await sleep(150);
}
if (!booted) { console.error('无法连接无头 Chrome'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return '__ERR__' + JSON.stringify(r.exceptionDetails).slice(0, 300);
  return r && r.result ? r.result.value : null;
}
const goto = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) { if ((await evalJs('!!window.__mochiDataReady')) === true) return true; await sleep(250); }
  return false;
};
const finish = () => {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
  try { rmSync(site, { recursive: true, force: true }); } catch (e) {}
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
if (!(await goto())) { console.error('应用未就绪'); finish(); process.exit(1); }
await sleep(1000);

// 真实进场：公告滑到底（触发 scrolledBottom）→ 勾选 → 点进入
await evalJs(`(function(){
  var box = document.getElementById('splash-box');
  if (box) { box.scrollTop = box.scrollHeight; box.dispatchEvent(new Event('scroll')); }
  var c = document.getElementById('splash-age-check'); if (c && !c.checked) c.click();
  var e = document.getElementById('splash-enter');
  var dis = e && e.classList.contains('is-disabled');
  if (e && !dis) e.click();
  return 1;
})()`);
await sleep(1200);
// 首启备份提醒弹窗点「稍后」/取消类按钮
await evalJs(`(function(){
  var later = Array.prototype.find.call(document.querySelectorAll('button'), function(b){ return /稍后|取消/.test(String(b.textContent)); });
  if (later) later.click();
  return 1;
})()`);
await sleep(500);

const openChat = () => evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');}); var a=document.querySelector('.app[data-app=chat]'); if(a)a.click(); return 1; })()");
const openGiftPanel = () => evalJs("(function(){ var m=document.getElementById('more-gift'); if(!m) return 0; m.click(); return 1; })()");
const panelState = () => evalJs(`(function(){
  var p = document.getElementById('chat-gift-panel');
  if (!p) return JSON.stringify({ found: false });
  var head = p.querySelector('.poke-card-head span');
  var grid = p.querySelector('#gift-grid');
  return JSON.stringify({
    found: true, hidden: !!p.hidden,
    title: head ? String(head.textContent).slice(0, 12) : '',
    hasMineEntry: !!p.querySelector('#gift-mine-entry'),
    mineEntryText: p.querySelector('#gift-mine-add') ? String(p.querySelector('#gift-mine-add').textContent) : '',
    gridHasNew: grid ? String(grid.textContent).indexOf('验证小熊') >= 0 : false,
    gridHasEntryRow: !!p.querySelector('#gift-mine-entry')
  });
})()`);
const tcState = () => evalJs(`(function(){
  var mask = document.getElementById('tc-mask');
  var title = document.getElementById('tc-panel-title');
  return JSON.stringify({ open: !!(mask && !mask.hidden), title: title ? String(title.textContent) : '' });
})()`);
const customStore = () => evalJs(`(function(){
  try { return JSON.stringify(JSON.parse(window.xyStore('xy-home-v2').get('market-custom') || '[]').map(function(x){ return x && x.name; })); } catch (e) { return '[]'; }
})()`);

console.log('B 层：无头行为');
try {

// ---- B1：聊天送礼面板出现【＋ 上传我的商品】 ----
await openChat();
await sleep(400);
await openGiftPanel();
await sleep(500);
{
  const p = J(await panelState()) || {};
  ok(p.found && !p.hidden, 'B1 聊天送礼面板打开', JSON.stringify(p));
  ok(String(p.title).indexOf('心意集市') >= 0, 'B1b 面板标题就是「心意集市 · TA」（用户口中「心意集市」的这一面）', p.title);
  ok(p.hasMineEntry && String(p.mineEntryText).indexOf('上传我的商品') >= 0, 'B1c 面板内出现【＋ 上传我的商品】（#1540 主修复面）', JSON.stringify(p));
}

// ---- B2：点入口 → 「添加商品」表单 ----
{
  await evalJs("(function(){ var b=document.getElementById('gift-mine-add'); if(b)b.click(); return !!b; })()");
  await sleep(400);
  const t = J(await tcState()) || {};
  ok(t.open && t.title === '添加商品', 'B2 点入口弹出「添加商品」表单', JSON.stringify(t));
}

// ---- B3：填名保存 → 面板网格就地出新商品＋落库 ----
{
  await evalJs(`(function(){
    var n = document.getElementById('gm-name'); if (n) n.value = '验证小熊';
    var p = document.getElementById('gm-price'); if (p) p.value = '6.5';
    var w = document.getElementById('gm-wish'); if (w) w.value = '送给你呀';
    return 1;
  })()`);
  await sleep(150);
  await evalJs("(function(){ var b=document.getElementById('gm-ok'); if(b)b.click(); return !!b; })()");
  await sleep(500);
  const t = J(await tcState()) || {};
  const p = J(await panelState()) || {};
  const store = J(await customStore()) || [];
  ok(!t.open, 'B3 保存后表单关闭', JSON.stringify(t));
  ok(p.gridHasNew, 'B3b 面板网格就地出现新商品（marketRerenderBoth 生效）', JSON.stringify({ gridHasNew: p.gridHasNew }));
  ok(store.indexOf('验证小熊') >= 0, 'B3c market-custom 落库', JSON.stringify(store));
}

// ---- B4：全屏市集页同一份商品库＋原有大按钮仍在 ----
{
  await evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); var pg=document.getElementById('page-market'); if(pg){pg.hidden=false;} var a=document.querySelector('.app[data-app=market]'); if(a)a.click(); return 1; })()");
  await sleep(600);
  const r = await evalJs(`(function(){
    var grid = document.getElementById('market-grid');
    var mine = document.getElementById('market-mine');
    return JSON.stringify({
      marketHasNew: grid ? String(grid.textContent).indexOf('验证小熊') >= 0 : false,
      hasMineAdd: !!(mine && mine.querySelector('#market-mine-add')),
      hasToolAdd: !!document.getElementById('market-add')
    });
  })()`);
  const d = J(await r) || {};
  ok(d.marketHasNew, 'B4 全屏市集页同样有这件新商品（同一份商品库）', JSON.stringify(d));
  ok(d.hasMineAdd && d.hasToolAdd, 'B4b 市集页原有两处上传入口不受影响（零覆盖）', JSON.stringify(d));
}

} catch (e) {
  fail++;
  console.log('  \u2717 B 层执行中断：' + (e && e.message));
}

// ---- Z1：全程零未捕获 JS 异常 ----
{
  const errs = J(await evalJs('JSON.stringify(window.__jsErrors||[])')) || [];
  ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', JSON.stringify(errs));
}

finish();
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

// ===== 专项验证：设置开关反馈与状态一致性（v3.27.x） =====
// 用户反馈两件事：
//   ① 「底部导航栏的设置里，有好多按钮开启或关闭，我点了，但是没有提示弹窗显示开启还是关闭」
//      —— 根因：全项目 20+ 文件都写 `if (typeof window.toast === 'function') window.toast(...)`，
//         而 window.toast 从未被赋值（死通道）；少数模块自带自绘兜底（群聊开关等），
//         其余开关（#646 入口三项、全屏边缘防误触、桌面消息弹窗、摸鱼值累计…）点了零反馈。
//   ② 「设置里我没有开启『打开时先进入此间』，但每次进入都会进入」
//      —— 根因：三个入口开关只在脚本解析时读一次存储，而数据是异步从 IndexedDB 回填的；
//         localStorage 副本丢失而 IDB 有新值时（LS 写失败被标 ls-dirty / 浏览器清存储 / iOS 常见），
//         开关停在旧值「关」，回填后入口流程却按真实值「开」执行 = 开关说谎。
// 用例组：
//   A 提示通道：window.toast 存在、设置开关点击有提示、模块自有文案不叠两条
//   B 设置页开关扫描：逐个切换均有提示（用户点名的「好多开关没提示」）
//   C 开关不说谎：LS 副本丢失 + IDB 有值时，回填后开关回显与真实值一致、且入口行为与回显一致
//   D 存储权威：勾选后关闭写回 '0'，重载后开关与行为都为关
//   E 无 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-settings-toggle-feedback').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-stf-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__seed') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end('<!doctype html><title>seed</title>'); return; }
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-stf-prof-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(4500); }
const url = baseUrl + '/index.html';
const REG_SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  return true;
})()`;
async function scenario(seedExpr) {
  await navigate('about:blank');
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
  await navigate(baseUrl + '/__seed');
  await evalJs('(function(){\n' + seedExpr + ';\n})()');
  await navigate(url);
}
// 提示读取：文本 + 是否处于 .show（动画期内可见）
const TOAST = `(function(){ var t=document.getElementById('cc-toast'); return { txt: t?t.textContent:'', show: !!(t && t.className.indexOf('show')>=0) }; })()`;
// 每次点击前清空旧提示：防止上一条残留文案「冒充」本次反馈（RED 基线里已出现该假阳性）
const CLEAR_TOAST = `(function(){ var t=document.getElementById('cc-toast'); if (t) { t.textContent=''; t.className='cc-toast'; } window.__lastToastAt = 0; return true; })()`;
const TOGGLE = (id) => `(function(){ var el=document.getElementById(${JSON.stringify(id)}); if(!el) return 'no-el'; el.click(); return el.checked; })()`;
const STATE = `(function () {
  const cb = document.getElementById('entry-cjian-first');
  const cbL = document.getElementById('entry-show-list');
  const store = window.xyStore ? window.xyStore('xy-home-v2') : null;
  const vis = (el) => !!(el && !el.hidden && el.style.display !== 'none');
  return {
    cbChecked: cb ? cb.checked : null,
    cbDisabled: cb ? cb.disabled : null,
    cbListChecked: cbL ? cbL.checked : null,
    storeVal: store ? store.get('entry-cjian-first') : null,
    storeList: store ? store.get('entry-show-list') : null,
    lsVal: localStorage.getItem('xy-home-v2:entry-cjian-first'),
    cjian: vis(document.getElementById('page-cjian')),
    picker: vis(document.getElementById('entry-picker'))
  };
})()`;
// 剥掉 LS 副本 + LS 写日志（模拟「LS 写失败被标脏 / 浏览器清存储，IDB 仍是权威值」）
const STRIP_LS = `(function(){
  localStorage.removeItem('xy-home-v2:entry-cjian-first');
  try {
    var j = JSON.parse(localStorage.getItem('xy-home-v2:__wr-journal') || '[]');
    localStorage.setItem('xy-home-v2:__wr-journal', JSON.stringify(j.filter(function (e) { return e.k !== 'xy-home-v2:entry-cjian-first'; })));
  } catch (e) {}
  return localStorage.getItem('xy-home-v2:entry-cjian-first');
})()`;

try {
  await cdpConnect();
  await cdp('Runtime.enable'); await cdp('Page.enable');
  const jsErrors = [];
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 160));
    if (rawHandler) rawHandler(ev);
  };

  console.log('\n== A 提示通道 ==');
  await scenario(REG_SEED);
  ok('window.toast 已挂上（此前全站死通道）', (await evalJs('typeof window.toast')) === 'function');
  await evalJs(CLEAR_TOAST);
  await evalJs(TOGGLE('entry-cjian-first'));
  await sleep(200);
  let t = await evalJs(TOAST);
  ok('「打开时先进入此间」开启有提示', t && t.show === true && /已开启/.test(t.txt), t);
  ok('提示带上开关名（知道是哪一个）', t && /进入此间/.test(t.txt), t);
  await evalJs(CLEAR_TOAST);
  await evalJs(TOGGLE('entry-cjian-first'));
  await sleep(200);
  t = await evalJs(TOAST);
  ok('关闭也有提示且写明已关闭', t && /已关闭/.test(t.txt), t);
  await evalJs(CLEAR_TOAST);
  await evalJs(TOGGLE('sf-group-chat'));
  await sleep(250);
  t = await evalJs(TOAST);
  ok('模块自带专属文案的开关不被通用文案叠一条', t && /群聊/.test(t.txt) && t.txt.indexOf('已开启 已开启') < 0, t);
  ok('同一次切换只存在一条提示元素', (await evalJs("document.querySelectorAll('#cc-toast').length")) === 1);

  console.log('\n== B 设置页开关逐个切换都要有提示（用户点名场景） ==');
  await scenario(REG_SEED);
  const ids = await evalJs(`(function(){
    var skip = /(applock|bg-notify|fullscreen|force-mobile|entry-default|qa-en|reset|clear|night-mode)/;
    var out = [];
    document.querySelectorAll('#page-setting input[type=checkbox]').forEach(function (el) {
      if (!el.id || el.disabled || skip.test(el.id)) return;
      if (out.length < 8) out.push(el.id);
    });
    return out;
  })()`);
  ok('设置页取到待测开关样本', Array.isArray(ids) && ids.length >= 4, ids);
  for (const id of (ids || [])) {
    // 有的开关默认是开的（跨桌面查岗 / 桌面消息弹窗），首个点击是「关」——
    // 断言以「点击后的实际状态」为准：提示文案必须与实际状态一致。
    await evalJs(CLEAR_TOAST);
    const on1 = await evalJs(TOGGLE(id));
    await sleep(200);
    const tt1 = await evalJs(TOAST);
    ok('【' + id + '】切换有提示且文案与实际状态一致', tt1 && tt1.show === true && tt1.txt.indexOf(on1 ? '已开启' : '已关闭') >= 0, { on: on1, t: tt1 });
    await evalJs(CLEAR_TOAST);
    const on2 = await evalJs(TOGGLE(id));
    await sleep(200);
    const tt2 = await evalJs(TOAST);
    ok('【' + id + '】切回也有提示且文案一致', tt2 && tt2.show === true && tt2.txt.indexOf(on2 ? '已开启' : '已关闭') >= 0, { on: on2, t: tt2 });
    ok('【' + id + '】一次切换只留一条提示', (await evalJs("document.querySelectorAll('#cc-toast').length")) === 1);
  }

  console.log('\n== C 开关不说谎：LS 副本丢失、IDB 有值时回填后必须回显为开（RED 基线：回显恒为关） ==');
  await scenario(REG_SEED);
  await evalJs(TOGGLE('entry-cjian-first'));
  await sleep(900); // 等写入落 IDB
  ok('剥掉 LS 副本与写日志成功', (await evalJs(STRIP_LS)) === null);
  await cdp('Page.navigate', { url });
  await sleep(5200); // 等 IndexedDB 回填完成（mochi-restore-done）
  let s = await evalJs(STATE);
  ok('回填后存储值为开', s && s.storeVal === '1', s);
  ok('回填后开关回显为开（不再显示未开启）', s && s.cbChecked === true, s);
  ok('开关回显与存储值一致（UI 不说谎）', s && s.cbChecked === (s.storeVal === '1'), s);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(700);
  s = await evalJs(STATE);
  ok('入口行为与开关回显一致（开＝进此间）', s && s.cjian === true, s);

  console.log('\n== D 关掉它之后行为随之关闭 ==');
  await evalJs("(function(){ var b=document.getElementById('cj-back'); if(b) b.click(); })()");
  await sleep(300);
  await evalJs(TOGGLE('entry-cjian-first'));
  await sleep(300);
  s = await evalJs(STATE);
  ok('开关关掉后写回 0', s && s.storeVal === '0' && s.cbChecked === false, s);
  await navigate(url);
  s = await evalJs(STATE);
  ok('重载后开关仍为关', s && s.cbChecked === false && s.storeVal === '0', s);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(700);
  s = await evalJs(STATE);
  ok('关闭后重载不再自动进入此间', s && s.cjian === false, s);

  console.log('\n== e 入口三行在回填后整体重同步 ==');
  await scenario(REG_SEED + `
    localStorage.setItem('xy-home-v2:entry-default-contact', 'default');`);
  await cdp('Page.navigate', { url });
  await sleep(5200);
  const d = await evalJs("(function(){ var v=document.getElementById('entry-default-contact-val'); var cb=document.getElementById('entry-cjian-first'); return { val: v?v.textContent:null, dis: cb?cb.disabled:null, chk: cb?cb.checked:null }; })()");
  ok('「默认进入的桌面」回显联系人名', d && d.val === '宝贝', d);
  ok('被取代的两项回填后置灰且关闭', d && d.dis === true && d.chk === false, d);

  console.log('\n== G 无 JS 异常 ==');
  ok('全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

// ===== 专项验证：#646 进入桌面入口流程（打开时先进入此间 / 默认进入的桌面） =====
// 需求（用户直派）：设置里两项，均默认关闭，手动开启——
//   entry-cjian-first     每次打开 App 先进入此间，看完返回时弹出「选择本次进入的桌面」页，由用户选本次进哪个桌面
//   entry-default-contact 每次打开 App 直接进入所选联系人桌面
// 优先级：此间流程优先；本次选择的桌面覆盖默认，默认仅作预选/标记。
// 用例组：
//   A 默认关闭：调用入口流程不改任何东西
//   B 默认进入桌面：调用后切到所选桌面
//   C 先进入此间：打开此间 → 返回弹出「选择桌面」→ 选桌面生效
//   D 优先级：两者同开，选桌面覆盖默认；选择页标记默认项
//   E 存储：两个键是全局根键，刷新不被 migrateLegacy 迁走
//   F 设置页：开关默认关 + 选择默认桌面入口
//   G 无 JS 异常
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
testHtml = testHtml.split('__BUILD_INFO__').join('verify-entry-flow').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-entry-flow-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__seed') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><title>Entry test setup</title>');
      return;
    }
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-entry-flow-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(4200); }
async function scenario(seedExpr) {
  await navigate('about:blank');
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
  await navigate(baseUrl + '/__seed');
  await evalJs('(function(){\n' + seedExpr + ';\n})()');
  await navigate(baseUrl + '/index.html');
}
const REG_SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([
    { id: 'default', name: '宝贝' },
    { id: 'cta', name: '小桃' }
  ]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  return true;
})()`;
// 状态读取
const STATE = `(function () {
  const q = (id) => document.getElementById(id);
  const vis = (el) => !!(el && !el.hidden && el.style.display !== 'none');
  return {
    active: localStorage.getItem('xy-home-v2:active-contact'),
    cjian: vis(q('page-cjian')),
    phone: vis(q('page-phone')),
    chat: vis(q('page-chat')),
    picker: vis(q('entry-picker')),
    pickHead: (q('entry-picker') && q('entry-picker').textContent.indexOf('默认进入的桌面') >= 0) ? 'default' : ((q('entry-picker') && q('entry-picker').textContent.indexOf('选择本次进入的桌面') >= 0) ? 'entry' : ''),
    flowFn: typeof window.mochiContactEntryFlow === 'function'
  };
})()`;
const LEAVE_CJIAN = "(function(){ const b=document.getElementById('cj-back'); if(b){ b.click(); return true; } return false; })()";
const CLICK_CARD = (name) => `(function(){ const cs=document.querySelectorAll('#entry-picker div[style*="cursor"]'); for(const c of cs){ if(c.textContent.indexOf(${JSON.stringify(name)})>=0){ c.click(); return true; } } return false; })()`;

try {
  await cdpConnect();
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const jsErrors = [];
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };
  const url = baseUrl + '/index.html';
  await navigate(url);

  let s;
  if (process.env.ENTRY_CASE !== 'H') {
  console.log('\n== A 默认关闭：入口流程不改任何东西 ==');
  await scenario(REG_SEED);
  s = await evalJs(STATE);
  ok('入口流程函数已接线', s && s.flowFn === true, s);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(400);
  s = await evalJs(STATE);
  ok('两项默认关闭：不切桌面（仍 cta）', s && s.active === 'cta', s);
  ok('两项默认关闭：不打开此间', s && s.cjian === false, s);
  ok('两项默认关闭：不弹选择桌面页', s && s.picker === false, s);

  console.log('\n== B 默认进入的桌面 ==');
  await scenario(REG_SEED + `\nlocalStorage.setItem('xy-home-v2:entry-default-contact', 'default');`);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(500);
  s = await evalJs(STATE);
  ok('打开后直接进入默认桌面 default', s && s.active === 'default', s);
  ok('停在桌面主页', s && s.phone === true, s);
  ok('不打开此间 / 不弹选择页', s && s.cjian === false && s.picker === false, s);

  console.log('\n== C 打开时先进入此间 → 选择本次进入的桌面 ==');
  await scenario(REG_SEED + `\nlocalStorage.setItem('xy-home-v2:entry-cjian-first', '1');`);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(500);
  s = await evalJs(STATE);
  ok('先打开此间', s && s.cjian === true, s);
  ok('此时未弹选择页', s && s.picker === false, s);
  const allOn = await evalJs("(function(){ const c=document.querySelector('#cj-groups .cj-gchip.on'); return c ? c.textContent : ''; })()");
  ok('开屏进入此间默认停在「全部」总览', allOn === '全部', allOn);
  const hint = await evalJs("(function(){ const h=document.getElementById('entry-cjian-hint'); return h ? h.textContent : null; })()");
  ok('开屏此间显示【去找TA】进入桌面的提示', !!(hint && hint.indexOf('去找TA') >= 0), hint);
  ok('提示含「无状态时点【感知此间】」', !!(hint && hint.indexOf('感知此间') >= 0), hint);
  await evalJs(LEAVE_CJIAN);
  await sleep(400);
  s = await evalJs(STATE);
  ok('离开此间后弹出「选择本次进入的桌面」', s && s.picker === true && s.pickHead === 'entry', s);
  const clicked = await evalJs(CLICK_CARD('宝贝'));
  ok('选择页列出联系人可点', clicked === true, clicked);
  await sleep(300);
  s = await evalJs(STATE);
  ok('选择后切换到该桌面', s && s.active === 'default', s);
  ok('选择后关闭选择页并停在桌面', s && s.picker === false && s.phone === true, s);

  console.log('\n== C2 点【去找TA】直接进桌面、不再弹选择页 ==');
  await scenario(REG_SEED + `\nlocalStorage.setItem('xy-home-v2:entry-cjian-first', '1');`);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(500);
  const goClicked = await evalJs("(function(){ const b=document.querySelector('#cj-list .cj-go'); if(b){ b.click(); return true; } return false; })()");
  ok('此间列表存在【去找TA】按钮', goClicked === true, goClicked);
  await sleep(400);
  s = await evalJs(STATE);
  ok('点【去找TA】进入聊天页', s && s.chat === true, s);
  ok('点【去找TA】不弹选择桌面页', s && s.picker === false, s);

  console.log('\n== D 默认桌面开启时取代此间联动 ==');
  await scenario(REG_SEED + `
    localStorage.setItem('xy-home-v2:entry-cjian-first', '1');
    localStorage.setItem('xy-home-v2:entry-default-contact', 'default');`);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(500);
  s = await evalJs(STATE);
  ok('默认桌面生效：直接进入 default、不打开此间', s && s.active === 'default' && s.cjian === false, s);
  const dSync = await evalJs("(function(){ const cb=document.getElementById('entry-cjian-first'); return { d: cb.disabled, c: cb.checked }; })()");
  ok('「先进入此间」已被禁用且关闭', dSync && dSync.d === true && dSync.c === false, dSync);

  console.log('\n== E 全局根键刷新不被迁移 ==');
  await scenario(REG_SEED + `\nlocalStorage.setItem('xy-home-v2:entry-cjian-first', '1');`);
  await navigate(url);
  await sleep(500);
  let keys = await evalJs("({ root: localStorage.getItem('xy-home-v2:entry-cjian-first'), moved: localStorage.getItem('xy-home-v2:default:entry-cjian-first') })");
  ok('entry-cjian-first 根键仍在（未被 migrateLegacy 迁走）', keys && keys.root === '1' && keys.moved === null, keys);

  await scenario(REG_SEED + `\nlocalStorage.setItem('xy-home-v2:entry-default-contact', 'cta');`);
  await navigate(url);
  await sleep(500);
  keys = await evalJs("({ def: localStorage.getItem('xy-home-v2:entry-default-contact'), moved: localStorage.getItem('xy-home-v2:default:entry-default-contact') })");
  ok('entry-default-contact 根键仍在（未被 migrateLegacy 迁走）', keys && keys.def === 'cta' && keys.moved === null, keys);

  console.log('\n== F 设置页 ==');
  await scenario(REG_SEED);
  const uiF = await evalJs(`(function () {
    const cb = document.getElementById('entry-cjian-first');
    const lb = document.getElementById('entry-show-list');
    const row = document.getElementById('row-entry-default-contact');
    const val = document.getElementById('entry-default-contact-val');
    return { cb: !!cb, checked: cb ? cb.checked : null, lb: !!lb, lbChecked: lb ? lb.checked : null, row: !!row, val: val ? val.textContent : null };
  })()`);
  ok('「打开时先进入此间」开关存在且默认关', uiF && uiF.cb === true && uiF.checked === false, uiF);
  ok('「打开时显示联系人列表」开关存在且默认关', uiF && uiF.lb === true && uiF.lbChecked === false, uiF);
  ok('「默认进入的桌面」入口存在、默认显示关闭', uiF && uiF.row === true && uiF.val === '关闭', uiF);
  await evalJs("(function(){ const cb=document.getElementById('entry-cjian-first'); cb.checked=true; cb.dispatchEvent(new Event('change')); return true; })()");
  let v = await evalJs("localStorage.getItem('xy-home-v2:entry-cjian-first')");
  ok('开关开启写入根键', v === '1', v);
  await evalJs("(function(){ const lb=document.getElementById('entry-show-list'); lb.checked=true; lb.dispatchEvent(new Event('change')); return true; })()");
  v = await evalJs("localStorage.getItem('xy-home-v2:entry-show-list')");
  ok('「显示联系人列表」开关开启写入根键', v === '1', v);
  await evalJs("document.getElementById('row-entry-default-contact').click(); true");
  await sleep(200);
  s = await evalJs(STATE);
  ok('点入口弹出「默认进入的桌面」选择页', s && s.picker === true && s.pickHead === 'default', s);
  await evalJs(CLICK_CARD('小桃'));
  await sleep(200);
  v = await evalJs("({ v: document.getElementById('entry-default-contact-val').textContent, k: localStorage.getItem('xy-home-v2:entry-default-contact') })");
  ok('选中写入键且入口回显联系人名', v && v.v === '小桃' && v.k === 'cta', v);

  console.log('\n== F2 默认桌面开启时代替并禁用「先进入此间」/「显示联系人列表」 ==');
  const dis = await evalJs("(function(){ const cb=document.getElementById('entry-cjian-first'); const lb=document.getElementById('entry-show-list'); return { d: cb.disabled, c: cb.checked, k: localStorage.getItem('xy-home-v2:entry-cjian-first'), tip: !!document.getElementById('entry-cjian-first-tip'), ld: lb ? lb.disabled : null, lk: localStorage.getItem('xy-home-v2:entry-show-list') }; })()");
  ok('「先进入此间」被禁用且强制关闭', dis && dis.d === true && dis.c === false && dis.k === '0', dis);
  ok('「显示联系人列表」也一并被禁用且关闭', dis && dis.ld === true && dis.lk === '0', dis);
  ok('显示取代说明', dis && dis.tip === true, dis);
  await evalJs("document.getElementById('row-entry-default-contact').click(); true");
  await sleep(200);
  await evalJs(CLICK_CARD('关闭'));
  await sleep(200);
  const re = await evalJs("(function(){ const cb=document.getElementById('entry-cjian-first'); const lb=document.getElementById('entry-show-list'); return { d: cb.disabled, ld: lb ? lb.disabled : null, k: localStorage.getItem('xy-home-v2:entry-default-contact') }; })()");
  ok('把默认桌面设为「关闭」后两项恢复可用', re && re.d === false && re.ld === false && (re.k === null || re.k === ''), re);

  }
  console.log('\n== H 打开时显示联系人列表 ==');
  await scenario(REG_SEED + `\nlocalStorage.setItem('xy-home-v2:entry-show-list', '1');`);
  const entrySettings = await evalJs("(function(){ const store=window.xyStore('xy-home-v2'); return { list:store.get('entry-show-list'), cjian:store.get('entry-cjian-first'), defaultContact:store.get('entry-default-contact') }; })()");
  ok('启动实际读取到列表开关，其他入口未开启', entrySettings && entrySettings.list === '1' && !entrySettings.cjian && !entrySettings.defaultContact, entrySettings);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(500);
  s = await evalJs(STATE);
  ok('打开后直接弹出全部联系人列表', s && s.picker === true && s.pickHead === 'entry', s);
  ok('不经过此间', s && s.cjian === false, s);
  const clickedList = await evalJs(CLICK_CARD('宝贝'));
  ok('列表可点选', clickedList === true, clickedList);
  await sleep(300);
  s = await evalJs(STATE);
  ok('点选后进入该桌面', s && s.active === 'default' && s.picker === false && s.phone === true, s);
  await evalJs('window.mochiContactEntryFlow(); true');
  s = await evalJs(STATE);
  ok('同次启动不会重复弹列表', s && s.picker === false, s);
  await navigate(url);
  const savedList = await evalJs("({ stored:window.xyStore('xy-home-v2').get('entry-show-list'), checked:document.getElementById('entry-show-list').checked })");
  ok('刷新后列表设置仍开启且开关回显一致', savedList && savedList.stored === '1' && savedList.checked === true, savedList);
  await evalJs('window.mochiContactEntryFlow(); true');
  await sleep(300);
  s = await evalJs(STATE);
  ok('下一次启动仍显示联系人列表', s && s.picker === true && s.cjian === false, s);
  const allContacts = await evalJs("(function(){ const picker=document.getElementById('entry-picker'); return !!picker && window.getContacts().every(c => picker.textContent.includes(c.name || c.id)); })()");
  ok('列表包含全部联系人', allContacts === true, allContacts);
  await evalJs(CLICK_CARD('宝贝'));
  s = await evalJs(STATE);
  ok('选择当前联系人也能关闭列表并进入桌面', s && s.active === 'default' && s.picker === false && s.phone === true, s);
  await evalJs("(function(){ const cb=document.getElementById('entry-show-list'); cb.checked=false; cb.dispatchEvent(new Event('change')); })()");
  await navigate(url);
  await evalJs('window.mochiContactEntryFlow(); true');
  s = await evalJs(STATE);
  ok('关闭列表开关后重开不弹列表', s && s.picker === false && s.cjian === false, s);

  console.log('\n== G 无 JS 异常 ==');
  ok('全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' 项通过');
  process.exitCode = fail ? 1 : 0;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

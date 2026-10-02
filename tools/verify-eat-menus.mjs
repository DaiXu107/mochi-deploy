// ===== 专项验证：吃什么 多菜单 + 切换转盘 + 旧数据迁移 =====
// 用法：node tools/verify-eat-menus.mjs（需先 node build.mjs）
// 数据键实际为 xy-home-v2:<cid>:eat-*（curStore 按联系人命名空间），用 storeFor 操作
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9300 + Math.floor(Math.random() * 500));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-eat-' + Date.now()),
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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 用 storeFor（与产品代码 curStore 一致）写数据；删数据时手动 await idbDelete 防 idbRestore 回填旧值
async function setEat(key, val) {
  await evalJs("(function(){try{window.storeFor(window.__activeCid||'default').set(" + JSON.stringify(key) + "," + JSON.stringify(val) + ");}catch(e){}return true;})()");
}
async function delEat(key) {
  await evalJs("(async function(){var cid=window.__activeCid||'default';var fk='xy-home-v2:'+cid+':'+" + JSON.stringify(key) + ";try{localStorage.removeItem(fk);}catch(e){}try{await window.idbDelete(fk);}catch(e){}return true;})()");
}
async function clearEat() { for (const k of ['eat-menus', 'eat-cur-idx', 'eat-menu', 'eat-cards']) await delEat(k); }
// 读 eat-* 键（经命名空间）
async function readEat(key) {
  return evalJs("(function(){try{var cid=window.__activeCid||'default';return localStorage.getItem('xy-home-v2:'+cid+':'+" + JSON.stringify(key) + ");}catch(e){return null;}})()");
}

async function readyPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
}
async function openEat() {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"eat\"]');if(a)a.click();return true;})()");
  await sleep(500);
}
async function clickEl(id) { await evalJs("(function(){var b=document.getElementById('" + id + "');if(b)b.click();return true;})()"); await sleep(300); }

// T1 干净状态 → 默认菜单
await clearEat();
await readyPage();
await openEat();
let r1 = JSON.parse(await evalJs("(function(){var n=document.getElementById('eat-cur-name');var p=document.getElementById('page-eat');return JSON.stringify({name:n?n.textContent:'',shown:p?!p.hidden:false});})()") || '{}');
check('T1 干净状态显示「默认菜单」', r1.name === '默认菜单', r1.name);
check('T1 吃什么页已打开', r1.shown);
await clickEl('eat-menu-btn');
let r1c = JSON.parse(await evalJs("(function(){var c=document.getElementById('eat-menu-chips');return JSON.stringify({count:c?c.querySelectorAll('.eat-chip').length:0});})()") || '{}');
check('T1 编辑面板 1 个 chip', r1c.count === 1, String(r1c.count));

// T2 预设 2 菜单 + cur-idx=1
await setEat('eat-menus', JSON.stringify([{ name: '家常菜', dishes: ['番茄炒蛋', '红烧肉'] }, { name: '外卖', dishes: ['披萨', '汉堡'] }]));
await setEat('eat-cur-idx', '1');
await readyPage();
await openEat();
let r2 = JSON.parse(await evalJs("(function(){var n=document.getElementById('eat-cur-name');return JSON.stringify({name:n?n.textContent:''});})()") || '{}');
check('T2 预设 cur-idx=1 显示「外卖」', r2.name === '外卖', r2.name);
await clickEl('eat-menu-btn');
let r2c = JSON.parse(await evalJs("(function(){var c=document.getElementById('eat-menu-chips');return JSON.stringify({count:c?c.querySelectorAll('.eat-chip').length:0});})()") || '{}');
check('T2 编辑面板 2 个 chip', r2c.count === 2, String(r2c.count));

// T3 旧 eat-menu 迁移
await delEat('eat-menus'); await delEat('eat-cur-idx'); await delEat('eat-cards');
await setEat('eat-menu', JSON.stringify(['旧菜1', '旧菜2', '旧菜3']));
await readyPage();
await openEat();
let r3 = JSON.parse(await evalJs("(function(){var n=document.getElementById('eat-cur-name');return JSON.stringify({name:n?n.textContent:''});})()") || '{}');
check('T3 旧 eat-menu 迁移显示「我的菜单」', r3.name === '我的菜单', r3.name);
let r3mRaw = await readEat('eat-menus');
let r3mOld = await readEat('eat-menu');
let r3m = (() => { try { const a = JSON.parse(r3mRaw || '[]'); return { len: a.length, name: a[0] ? a[0].name : '', dishes: a[0] ? a[0].dishes.length : 0, oldCleared: r3mOld === '[]' }; } catch (e) { return {}; } })();
check('T3 迁移后 eat-menus=1 菜单3道 + 旧键清空', r3m.len === 1 && r3m.name === '我的菜单' && r3m.dishes === 3 && r3m.oldCleared, JSON.stringify(r3m));

// T4 旧 eat-cards 迁移（无 eat-menu）
await delEat('eat-menus'); await delEat('eat-cur-idx'); await delEat('eat-menu');
await setEat('eat-cards', JSON.stringify(['自定义菜A', '自定义菜B']));
await readyPage();
await openEat();
let r4 = JSON.parse(await evalJs("(function(){var n=document.getElementById('eat-cur-name');return JSON.stringify({name:n?n.textContent:''});})()") || '{}');
let r4mRaw = await readEat('eat-menus');
let r4m = (() => { try { const a = JSON.parse(r4mRaw || '[]'); return { len: a.length, hasA: a[0] ? a[0].dishes.indexOf('自定义菜A') >= 0 : false }; } catch (e) { return {}; } })();
check('T4 旧 eat-cards 迁移「我的菜单」含自定义菜', r4.name === '我的菜单' && r4m.len === 1 && r4m.hasA, JSON.stringify({ name: r4.name, m: r4m }));

// T5 切换浮层打开/关闭
await setEat('eat-menus', JSON.stringify([{ name: '菜单A', dishes: ['a1', 'a2'] }, { name: '菜单B', dishes: ['b1', 'b2'] }, { name: '菜单C', dishes: ['c1', 'c2'] }]));
await setEat('eat-cur-idx', '0');
await readyPage();
await openEat();
await clickEl('eat-switch-menu');
let r5 = JSON.parse(await evalJs("(function(){var o=document.getElementById('eat-switch-overlay');var c=document.getElementById('eat-switch-wheel');return JSON.stringify({open:o?!o.hidden:false,canvasW:c?c.width:0});})()") || '{}');
check('T5 切换浮层打开 + canvas 初始化', r5.open && r5.canvasW > 0, JSON.stringify(r5));
await clickEl('eat-switch-cancel');
let r5c = JSON.parse(await evalJs("(function(){var o=document.getElementById('eat-switch-overlay');return JSON.stringify({open:o?!o.hidden:false});})()") || '{}');
check('T5 取消后浮层关闭', !r5c.open, JSON.stringify(r5c));

// T6 仅 1 菜单时切换不打开浮层
await clearEat();
await readyPage();
await openEat();
await clickEl('eat-switch-menu');
let r6 = JSON.parse(await evalJs("(function(){var o=document.getElementById('eat-switch-overlay');return JSON.stringify({open:o?!o.hidden:false});})()") || '{}');
check('T6 仅 1 菜单时切换不打开浮层', !r6.open, JSON.stringify(r6));

// T7 当前菜单 3 道菜 + 转盘重画
await setEat('eat-menus', JSON.stringify([{ name: '测试菜单', dishes: ['菜1', '菜2', '新加菜'] }]));
await setEat('eat-cur-idx', '0');
await readyPage();
await openEat();
let r7 = JSON.parse(await evalJs("(function(){var c=document.getElementById('eat-wheel');try{var cid=window.__activeCid||'default';var a=JSON.parse(localStorage.getItem('xy-home-v2:'+cid+':eat-menus')||'[]');return JSON.stringify({dishes:a[0].dishes.length,hasNew:a[0].dishes.indexOf('新加菜')>=0,canvasW:c?c.width:0});}catch(e){return '{}';}})()") || '{}');
check('T7 当前菜单含新加菜 + 转盘重画', r7.dishes === 3 && r7.hasNew && r7.canvasW > 0, JSON.stringify(r7));

// T8 切换浮层新增「直接选菜单」chips：渲染 + 点 chip 立即切换
await setEat('eat-menus', JSON.stringify([{ name: '家常菜', dishes: ['番茄炒蛋', '红烧肉'] }, { name: '外卖', dishes: ['披萨', '汉堡'] }, { name: '夜宵', dishes: ['串串', '凉皮'] }]));
await setEat('eat-cur-idx', '0');
await readyPage();
await openEat();
await clickEl('eat-switch-menu');
let r8a = JSON.parse(await evalJs("(function(){var c=document.getElementById('eat-switch-chips');if(!c)return JSON.stringify({count:-1});var arr=[].slice.call(c.querySelectorAll('.eat-chip')).map(function(el){return {t:el.textContent,on:el.classList.contains('on')};});return JSON.stringify({count:arr.length,arr:arr});})()") || '{}');
check('T8 切换浮层渲染 3 个菜单 chip（当前菜单高亮）', r8a.count === 3 && r8a.arr && r8a.arr[0] && r8a.arr[0].t === '家常菜' && r8a.arr[0].on, JSON.stringify(r8a));
await evalJs("(function(){var c=document.getElementById('eat-switch-chips');if(!c)return;var chip=c.querySelector('.eat-chip');for(var i=0;i<chip.parentNode.children.length;i++){if(chip.parentNode.children[i].textContent==='外卖'){chip.parentNode.children[i].click();break;}}return true;})()");
await sleep(500);
let r8b = JSON.parse(await evalJs("(function(){var o=document.getElementById('eat-switch-overlay');var n=document.getElementById('eat-cur-name');var c=document.getElementById('eat-wheel');var cid=window.__activeCid||'default';var a=JSON.parse(localStorage.getItem('xy-home-v2:'+cid+':eat-menus')||'[]');var idx=localStorage.getItem('xy-home-v2:'+cid+':eat-cur-idx');return JSON.stringify({overlayClosed:o?o.hidden:false,name:n?n.textContent:'',idx:idx,dishes:a[1]?a[1].dishes:[],canvasW:c?c.width:0});})()") || '{}');
check('T8 点「外卖」chip 后：浮层关闭 + 切到外卖 + 转盘重画', r8b.overlayClosed && r8b.name === '外卖' && r8b.idx === '1' && JSON.stringify(r8b.dishes) === JSON.stringify(['披萨', '汉堡']) && r8b.canvasW > 0, JSON.stringify(r8b));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

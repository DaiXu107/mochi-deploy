// ===== 冒烟：记账功能（桌面第三页图标 + 记一笔 + 列表 + 删除） =====
// 场景：
//   1. 启动后 ensureP3 自动把 desk-page-count 提到 3，p3-grid 在第三页 slide 里
//   2. 记账图标存在，点击进入 page-accounting
//   3. 输入金额 + 选分类 + 点保存 → 记录入库 + 列表显示 + 概览更新
//   4. 删除记录 → 列表清空 + 概览归零
// 用法：node tools/smoke-accounting.mjs
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = 9900 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-smoke-acc-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
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
await sleep(1200);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 90) + ']' : ''));
}

// ---- 清空旧记账数据 ----
await evalJs("(function(){try{localStorage.removeItem('xy-home-v2:default:accounting-records');localStorage.removeItem('xy-home-v2:default:accounting-categories');}catch(e){}return true;})()");

// ---- 1. ensureP3：第三页存在 ----
// v3.11.x：修正断言键名——desk-page-count 实际存于 per-cid 命名空间（xy-home-v2:<cid>:desk-page-count），
// 旧键 xy-home-v2:desk-page-count 恒为 null 导致本断言长期 FAIL（功能本身正常）
let st = await evalJs("(function(){var n=parseInt(localStorage.getItem('xy-home-v2:default:desk-page-count'),10);var slides=document.querySelectorAll('#desktop-pages .page-slide').length;var p3=document.querySelector('[data-desk-widget=\"p3apps\"]');var inSlide=p3&&p3.closest&&p3.closest('.page-slide')&&!p3.closest('#desk-widget-pool');return{count:n,slides:slides,p3InSlide:!!inSlide};})()");
check('desk-page-count >= 3', st && st.count >= 3, String(st && st.count));
check('第三页 slide 存在（>=3 页）', st && st.slides >= 3, String(st && st.slides));
check('p3-grid 在第三页 slide 里（非隐藏池）', st && st.p3InSlide, JSON.stringify(st));

// ---- 2. 记账图标存在 ----
st = await evalJs("(function(){var a=document.querySelector('.app[data-app=\"accounting\"]');return{exists:!!a,name:a?a.querySelector('.app-name').textContent:'',hasSvg:!!(a&&a.querySelector('svg'))};})()");
check('记账图标存在', st && st.exists, JSON.stringify(st));
check('记账图标名称为「记账」', st && st.name === '记账', st && st.name);
check('记账图标含 SVG 矢量图', st && st.hasSvg, JSON.stringify(st));

// ---- 3. 点击记账图标进入 page-accounting ----
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"accounting\"]');if(a)a.click();return true;})()");
await sleep(600);
st = await evalJs("(function(){var p=document.getElementById('page-accounting');return{hidden:p.hidden,ovExpense:document.getElementById('acc-ov-expense')?document.getElementById('acc-ov-expense').textContent:'',ovIncome:document.getElementById('acc-ov-income')?document.getElementById('acc-ov-income').textContent:'',monthTxt:document.getElementById('acc-month-txt')?document.getElementById('acc-month-txt').textContent:''};})()");
check('点击后 page-accounting 可见', st && st.hidden === false, JSON.stringify(st));
check('概览栏渲染（月份文本非空）', st && st.monthTxt && st.monthTxt.length > 3, st && st.monthTxt);
check('概览初始支出 ¥0', st && st.ovExpense === '¥0', st && st.ovExpense);

// ---- 4. 记一笔：输入金额 + 选分类 + 保存 ----
await evalJs("(function(){var amt=document.getElementById('acc-amount');if(amt)amt.value='12.5';var note=document.getElementById('acc-note');if(note)note.value='测试午餐';var cats=document.querySelectorAll('#acc-cat-grid .acc-cat');for(var i=0;i<cats.length;i++){if(cats[i].textContent==='餐饮'){cats[i].click();break;}}return true;})()");
await sleep(300);
await evalJs("(function(){var b=document.getElementById('acc-save');if(b)b.click();return true;})()");
await sleep(500);
st = await evalJs("(function(){var raw=localStorage.getItem('xy-home-v2:default:accounting-records');var list=[];try{list=JSON.parse(raw||'[]');}catch(e){}var match=list.filter(function(r){return r.amount===12.5&&r.category==='餐饮'&&r.note==='测试午餐';});return{count:list.length,match:match.length,first:list[0]?{type:list[0].type,amount:list[0].amount,category:list[0].category,note:list[0].note}:null};})()");
check('记录已保存到 localStorage', st && st.count >= 1, JSON.stringify(st));
check('记录字段正确（支出 12.5 餐饮 测试午餐）', st && st.match === 1, JSON.stringify(st && st.first));

// ---- 5. 概览金额更新 + 列表显示 ----
st = await evalJs("(function(){return{ovExpense:document.getElementById('acc-ov-expense').textContent,rows:document.querySelectorAll('#acc-list .acc-row').length,catLabel:document.querySelector('#acc-list .acc-row-cat')?document.querySelector('#acc-list .acc-row-cat').textContent:'',noteLabel:document.querySelector('#acc-list .acc-row-note')?document.querySelector('#acc-list .acc-row-note').textContent:'',amount:document.querySelector('#acc-list .acc-row-amount')?document.querySelector('#acc-list .acc-row-amount').textContent:''};})()");
check('概览支出更新为 ¥12.5', st && st.ovExpense === '¥12.5', st && st.ovExpense);
check('列表显示 1 条记录', st && st.rows === 1, String(st && st.rows));
check('列表分类标签为「餐饮」', st && st.catLabel === '餐饮', st && st.catLabel);
check('列表备注为「测试午餐」', st && st.noteLabel === '测试午餐', st && st.noteLabel);
check('列表金额为 -¥12.5', st && st.amount === '-¥12.5', st && st.amount);

// ---- 6. 切到收入类型记一笔 ----
await evalJs("(function(){var tabs=document.querySelectorAll('#acc-type-tabs .acc-type-tab');for(var i=0;i<tabs.length;i++){if(tabs[i].getAttribute('data-type')==='income')tabs[i].click();}return true;})()");
await sleep(300);
await evalJs("(function(){var amt=document.getElementById('acc-amount');if(amt)amt.value='5000';var cats=document.querySelectorAll('#acc-cat-grid .acc-cat');for(var i=0;i<cats.length;i++){if(cats[i].textContent==='工资'){cats[i].click();break;}}return true;})()");
await sleep(200);
await evalJs("(function(){var b=document.getElementById('acc-save');if(b)b.click();return true;})()");
await sleep(500);
st = await evalJs("(function(){var raw=localStorage.getItem('xy-home-v2:default:accounting-records');var list=JSON.parse(raw||'[]');return{count:list.length,ovIncome:document.getElementById('acc-ov-income').textContent,ovBalance:document.getElementById('acc-ov-balance').textContent,rows:document.querySelectorAll('#acc-list .acc-row').length};})()");
check('收入记录已保存（共 2 条）', st && st.count === 2, String(st && st.count));
check('概览收入更新为 ¥5000', st && st.ovIncome === '¥5000', st && st.ovIncome);
check('概览结余 = 5000 - 12.5 = ¥4987.5', st && st.ovBalance === '¥4987.5', st && st.ovBalance);
check('列表显示 2 条记录', st && st.rows === 2, String(st && st.rows));

// ---- 7. 筛选：只看支出 ----
await evalJs("(function(){var tabs=document.querySelectorAll('#acc-filter-tabs .acc-filter-tab');for(var i=0;i<tabs.length;i++){if(tabs[i].getAttribute('data-filter')==='expense')tabs[i].click();}return true;})()");
await sleep(300);
st = await evalJs("(function(){return{rows:document.querySelectorAll('#acc-list .acc-row').length,firstCat:document.querySelector('#acc-list .acc-row-cat')?document.querySelector('#acc-list .acc-row-cat').textContent:''};})()");
check('筛选支出后只显示 1 条', st && st.rows === 1, String(st && st.rows));
check('筛选后记录是「餐饮」', st && st.firstCat === '餐饮', st && st.firstCat);

// ---- 8. 删除记录 ----
await evalJs("(function(){var del=document.querySelector('#acc-list .acc-row-del');if(del)del.click();return true;})()");
await sleep(400);
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(500);
st = await evalJs("(function(){var raw=localStorage.getItem('xy-home-v2:default:accounting-records');var list=JSON.parse(raw||'[]');return{count:list.length,rows:document.querySelectorAll('#acc-list .acc-row').length};})()");
check('删除后记录数减 1（剩 1 条）', st && st.count === 1, String(st && st.count));
check('删除后筛选支出列表为空（收入不显示）', st && st.rows === 0, String(st && st.rows));
// 切回全部筛选确认收入还在
await evalJs("(function(){var tabs=document.querySelectorAll('#acc-filter-tabs .acc-filter-tab');for(var i=0;i<tabs.length;i++){if(tabs[i].getAttribute('data-filter')==='all')tabs[i].click();}return true;})()");
await sleep(300);
st = await evalJs("(function(){return{rows:document.querySelectorAll('#acc-list .acc-row').length,cat:document.querySelector('#acc-list .acc-row-cat')?document.querySelector('#acc-list .acc-row-cat').textContent:''};})()");
check('切回全部筛选后列表显示 1 条收入', st && st.rows === 1, String(st && st.rows));
check('剩余记录是「工资」收入', st && st.cat === '工资', st && st.cat);

// ---- 9. 月份切换 ----
await evalJs("(function(){var p=document.getElementById('acc-prev');if(p)p.click();return true;})()");
await sleep(300);
st = await evalJs("(function(){return{rows:document.querySelectorAll('#acc-list .acc-row').length,ovExpense:document.getElementById('acc-ov-expense').textContent};})()");
check('切到上月后列表为空', st && st.rows === 0, String(st && st.rows));
check('切到上月后支出归零', st && st.ovExpense === '¥0', st && st.ovExpense);

// ---- 10. 返回键回桌面 ----
await evalJs("(function(){var b=document.getElementById('acc-back');if(b)b.click();return true;})()");
await sleep(400);
st = await evalJs("(function(){var p=document.getElementById('page-accounting');var h=document.getElementById('page-phone');return{accHidden:p.hidden,homeHidden:h.hidden};})()");
check('返回后 page-accounting 隐藏', st && st.accHidden === true, JSON.stringify(st));
check('返回后桌面 page-phone 可见', st && st.homeHidden === false, JSON.stringify(st));

// ---- 无 JS 异常 ----
const jsErr = await evalJs("(function(){try{return localStorage.getItem('xy-home-v2:js-errors')||'';}catch(e){return '';}})()");
check('页面无 JS 异常', !jsErr, String(jsErr).slice(0, 80));

try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? failed.length + ' FAILED / ' + results.length : 'ALL PASS ' + results.length);
process.exit(failed.length ? 1 : 0);
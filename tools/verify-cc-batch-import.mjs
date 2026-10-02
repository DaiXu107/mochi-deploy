// ===== 回归脚本：自定义字卡批量导入多行拆分（夸克内核 innerText 丢换行兜底） =====
// 用法：node build.mjs && node tools/verify-cc-batch-import.mjs
// 背景：安卓下 #modal-textarea 被 mobile-adapt.js 转成 contenteditable ce-box
//（white-space:pre-wrap，Enter 插入字面 \n 文本节点）。取值原依赖 box.innerText，
// 夸克浏览器（华为 Mate 60 Pro 实测）的 innerText 会丢掉文本节点里的字面 \n——
// 屏幕上分了行、读回却是一行 → 批量导入「一行一个」全部并成 1 张卡。
// v3.9.x 修复：mobile-adapt.js 多行取值 = innerText 与 DOM 遍历（ceMultiText）
// 取换行更多者；回填写值改 textContent 直写（pre-wrap 字面 \n 即换行显示）。
// 复现路径（无头 Chrome，390×844 手机视口，ce-box 转换生效）：
//   1. 标准内核路径：字面 \n 文本节点（安卓 Chrome Enter 行为）→ 3 张卡。
//   2. 块级 <div> 分行（部分内核 Enter 产生 div 结构）→ 3 张卡。
//   3. <br> 分行 → 3 张卡。
//   4. 夸克模拟：字面 \n + 覆写 box.innerText 丢换行（模拟夸克内核）→
//      textarea.value 仍含换行（DOM 遍历兜底生效）→ 3 张卡。
//   5. setter 回填：textarea.value 写多行再读回，换行保留 → 2 张卡。
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
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ccbi-' + Date.now()),
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
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

// 进入：底部 tab「字卡库」→ 列表页「自定义聊天字卡」→ 自定义字卡页
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return !!t;})()");
await sleep(700);
await evalJs("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
await sleep(700);

// 前置确认：#modal-textarea 已被转成 ce-box（安卓路径生效）
const ceReady = await evalJs("(function(){var inp=document.getElementById('modal-textarea');return !!(inp&&inp.__ceBox);})()");
check('批量导入弹窗 textarea 已转 ce-box（安卓路径生效）', ceReady === true);

// 通用：打开批量导入弹窗
async function openImportModal() {
  await evalJs("(function(){var b=document.getElementById('cc-import');if(b)b.click();return !!b;})()");
  await sleep(400);
  return await evalJs("(function(){var m=document.getElementById('modal-mask');var ta=document.getElementById('modal-textarea');return !!(m&&!m.hidden&&ta&&!ta.hidden);})()");
}
// 通用：读取导入结果——cc-groups 中指定分组的字卡数
async function groupCards(name) {
  return await evalJs("(function(){try{var g=JSON.parse(window.activeStore().get('cc-groups')||'null');if(!g||!g.text)return null;var hit=(g.text||[]).filter(function(x){return x[0]==='" + name + "';});return hit.length?hit[0][1]:null;}catch(e){return 'err:'+e.message;}})()");
}

// ---- 用例 1：标准内核——字面 \n 文本节点（安卓 Chrome Enter 行为）----
check('用例1 打开批量导入弹窗', (await openImportModal()) === true);
await evalJs(`(function(){
  var inp=document.getElementById('modal-textarea');
  var box=inp.__ceBox;
  // 模拟安卓标准内核 Enter：pre-wrap 下插入字面 \\n 文本节点
  box.textContent='【批量A】你今天真好看\\n我想你了\\n晚安';
  box.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`);
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(500);
const g1 = await groupCards('批量A');
check('用例1 字面\\n 文本 → 3 张独立字卡', Array.isArray(g1) && g1.length === 3 && g1.join(',') === '你今天真好看,我想你了,晚安', Array.isArray(g1) ? g1.join('/') : String(g1));

// ---- 用例 2：块级 <div> 分行 ----
check('用例2 打开批量导入弹窗', (await openImportModal()) === true);
await evalJs(`(function(){
  var box=document.getElementById('modal-textarea').__ceBox;
  // 模拟部分内核 Enter：产生 div 块结构
  box.innerHTML='【批量B】<div>早上好</div><div>午安</div><div>晚安</div>';
  box.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`);
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(500);
const g2 = await groupCards('批量B');
check('用例2 div 分行 → 3 张独立字卡', Array.isArray(g2) && g2.length === 3 && g2.join(',') === '早上好,午安,晚安', Array.isArray(g2) ? g2.join('/') : String(g2));

// ---- 用例 3：<br> 分行 ----
check('用例3 打开批量导入弹窗', (await openImportModal()) === true);
await evalJs(`(function(){
  var box=document.getElementById('modal-textarea').__ceBox;
  // 模拟 <br> 换行结构
  box.innerHTML='【批量C】第一行<br>第二行<br>第三行';
  box.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`);
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(500);
const g3 = await groupCards('批量C');
check('用例3 br 分行 → 3 张独立字卡', Array.isArray(g3) && g3.length === 3 && g3.join(',') === '第一行,第二行,第三行', Array.isArray(g3) ? g3.join('/') : String(g3));

// ---- 用例 4：夸克内核模拟——字面 \n + innerText 丢换行 ----
check('用例4 打开批量导入弹窗', (await openImportModal()) === true);
const val4 = await evalJs(`(function(){
  var inp=document.getElementById('modal-textarea');
  var box=inp.__ceBox;
  // 模拟夸克：Enter 仍是字面 \\n 文本节点（屏幕可见分行）……
  box.textContent='【批量D】在干嘛\\n吃了吗\\n早点休息';
  box.dispatchEvent(new Event('input',{bubbles:true}));
  // ……但内核 innerText 实现把文本节点里的字面 \\n 全部丢掉（读回一行）
  Object.defineProperty(box,'innerText',{configurable:true,get:function(){
    return box.textContent.replace(/\\n/g,'');
  }});
  // 修复前：textarea.value = box.innerText → 一行（bug）；修复后：DOM 遍历兜底 → 含换行
  return { hasNl: inp.value.indexOf('\\n') >= 0, lineCount: inp.value.split('\\n').filter(function(s){return s.trim();}).length };
})()`);
check('用例4 夸克模拟下 textarea.value 仍保留换行（DOM 遍历兜底生效）', !!val4 && val4.hasNl === true && val4.lineCount === 3, val4 ? JSON.stringify(val4) : 'n/a');
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(500);
// 还原 innerText（删掉实例覆写，避免影响后续用例）
await evalJs("(function(){var box=document.getElementById('modal-textarea').__ceBox;try{delete box.innerText;}catch(e){}return true;})()");
const g4 = await groupCards('批量D');
check('用例4 夸克模拟导入 → 3 张独立字卡（原 bug：1 张）', Array.isArray(g4) && g4.length === 3 && g4.join(',') === '在干嘛,吃了吗,早点休息', Array.isArray(g4) ? g4.join('/') : String(g4));

// ---- 用例 5：setter 回填往返（编辑回填 / txt 导入路径）----
check('用例5 打开批量导入弹窗', (await openImportModal()) === true);
const val5 = await evalJs(`(function(){
  var inp=document.getElementById('modal-textarea');
  // 程序化写入多行（openModal 回填 / txt 文件导入都走这条路）
  inp.value='【批量E】回填一\\n回填二';
  // 读回必须仍含换行
  return { hasNl: inp.value.indexOf('\\n') >= 0 };
})()`);
check('用例5 setter 写入多行后读回换行保留', !!val5 && val5.hasNl === true, val5 ? JSON.stringify(val5) : 'n/a');
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(500);
const g5 = await groupCards('批量E');
check('用例5 回填内容导入 → 2 张独立字卡', Array.isArray(g5) && g5.length === 2 && g5.join(',') === '回填一,回填二', Array.isArray(g5) ? g5.join('/') : String(g5));

// ---- 收尾 ----
const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

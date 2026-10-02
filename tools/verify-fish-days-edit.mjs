// ===== 回归脚本：#645 数据丢失后手动修改「已摸鱼天数」（设置 → 工具 #row-fish-days）=====
// 用法：node tools/verify-fish-days-edit.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-fish-days-edit.mjs   （测临时构建副本）
// 用户需求（2026-09-17）：fish-log（全局键，天数 = 去重自然日数）遇浏览器丢数据后从 0 重来，
// 要能在设置里手动改回原天数。
// 断言：
//   A 轴（源码锚）：设置行在 template.html；绑定 + 收缩/回补 + 写回逻辑在 personalize.js；
//                   功能大全文案接 #row-fish-days。
//   B 轴（真实产物）：点行弹窗预填当前天数；输入目标天数 → 桌面 #fish-days 与
//                     localStorage xy-home-v2:fish-log 同步为该值（回补日期止于今天、
//                     升序去重）；刷新后保持；收缩保留最近 n 天（含今天）；
//                     非法输入/原值不变 → 弹窗不关并就地提示。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚 ----------
let tplSrc = '', pzSrc = '', hubSrc = '';
try { tplSrc = readFileSync(join(root, 'src/template.html'), 'utf8'); } catch (e) {}
try { pzSrc = readFileSync(join(root, 'src/js/personalize.js'), 'utf8'); } catch (e) {}
try { hubSrc = readFileSync(join(root, 'src/js/feature-hub.js'), 'utf8'); } catch (e) {}
check('A1 设置行在模板（工具 tag 数据管理组 #row-fish-days）', tplSrc.includes('id="row-fish-days"'));
check('A2 行绑定在位（personalize.js）', pzSrc.includes("document.getElementById('row-fish-days')"));
check('A3 修正结果写回全局 fish-log（天数=去重日期数）', pzSrc.includes("gStore.set('fish-log', JSON.stringify(out));"));
check('A4 扩充=最早一天前回补连续自然日', pzSrc.includes('out.unshift(fmtDate(d))'));
check('A5 收缩=保留最近 n 天（含今天）', pzSrc.includes('list.slice(list.length - n)'));
check('A6 功能大全文案接入', hubSrc.includes("'#row-fish-days'"));
if (results.some(r => !r.ok)) {
  console.log('----');
  console.log('A 轴有 FAIL：源码锚缺失（修复被覆盖或未接入），B 轴跳过');
  process.exit(1);
}

// ---------- B 轴：真实浏览器行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  process.exit(2);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-644-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
          }
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
      jsErrors.push((r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 200));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  // 等应用就绪：设置行 + 弹窗组件都挂好（personalize.js 在 body 尾部同步执行，navigate 完成即可用）
  for (let i = 0; i < 80; i++) {
    const ok = await evalJs(`!!(document.getElementById('row-fish-days') && window.openModal && document.getElementById('modal-input'))`);
    if (ok) break;
    await sleep(250);
  }

  const today = await evalJs(`(function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})()`);

  // B1 点行 → 弹窗打开、输入框预填当前天数（全新环境 = 0 → 空）、说明文案在位
  await evalJs(`document.getElementById('row-fish-days').click()`);
  await sleep(120);
  const b1 = await evalJs(`(function(){
    var mask=document.getElementById('modal-mask'), inp=document.getElementById('modal-input'), st=document.getElementById('modal-static');
    if (!mask || mask.hidden) return 'no-mask';
    if (inp.hidden) return 'no-input';
    return JSON.stringify({ v: inp.value, hint: (st && !st.hidden) ? (st.textContent || '') : '' });
  })()`);
  let o = null; try { o = JSON.parse(b1); } catch (e) {}
  check('B1 点行弹窗打开·预填当前天数(0=空)·说明文案在位', o && o.v === '' && (o.hint || '').indexOf('当前已摸鱼 0 天') >= 0, b1);

  // B2 输入 365 → 确定 → #fish-days 与 localStorage 同步 365，回补日期止于今天、升序去重
  await evalJs(`(function(){var i=document.getElementById('modal-input'); i.value='365'; document.getElementById('modal-ok').click(); return 'ok';})()`);
  await sleep(120);
  const b2 = await evalJs(`(function(){
    var el=document.getElementById('fish-days');
    var raw=localStorage.getItem('xy-home-v2:fish-log');
    var arr; try { arr=JSON.parse(raw||'[]'); } catch(e) { return 'parse-err'; }
    var sorted = arr.every(function(d,i){ return i===0 || arr[i-1] < d; });
    var valid = arr.every(function(d){ return /^\\d{4}-\\d{2}-\\d{2}$/.test(d); });
    var uniq = new Set(arr).size === arr.length;
    return JSON.stringify({ shown: el && el.textContent, n: arr.length, last: arr[arr.length-1], sorted: sorted, valid: valid, uniq: uniq });
  })()`);
  o = null; try { o = JSON.parse(b2); } catch (e) {}
  check('B2 设为 365：桌面数字与 fish-log 同步', o && o.shown === '365' && o.n === 365, b2);
  check('B3 回补日期合法/升序/去重/止于今天', o && o.valid && o.sorted && o.uniq && o.last === today, b2);

  // B3b 当天再打卡/聊天（logFish）→ 今天已在 log，天数保持 365 不跳 366
  await evalJs(`window.logFish && window.logFish()`);
  await sleep(80);
  const b3b = await evalJs(`JSON.stringify({ shown: document.getElementById('fish-days').textContent, n: JSON.parse(localStorage.getItem('xy-home-v2:fish-log')||'[]').length })`);
  o = null; try { o = JSON.parse(b3b); } catch (e) {}
  check('B3b 当天打卡后天数保持 365（回补含今天＝logFish 不重复计）', o && o.shown === '365' && o.n === 365, b3b);

  // B4 刷新后保持（updateFishDays 启动重读）
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) {
    const t = await evalJs(`(document.getElementById('fish-days')||{}).textContent || ''`);
    if (t === '365') break;
    await sleep(250);
  }
  const b4 = await evalJs(`(document.getElementById('fish-days')||{}).textContent || 'none'`);
  check('B4 刷新后天数保持 365', b4 === '365', b4);

  // B5 收缩到 10：保留最近 10 天（最后一天仍是今天）
  await evalJs(`document.getElementById('row-fish-days').click()`);
  await sleep(120);
  const pre = await evalJs(`document.getElementById('modal-input').value`);
  check('B5 再开弹窗预填当前值 365', pre === '365', pre);
  await evalJs(`(function(){var i=document.getElementById('modal-input'); i.value='10'; document.getElementById('modal-ok').click(); return 'ok';})()`);
  await sleep(120);
  const b5 = await evalJs(`(function(){
    var arr=JSON.parse(localStorage.getItem('xy-home-v2:fish-log')||'[]');
    var today=new Date(); var t=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    return JSON.stringify({ shown: document.getElementById('fish-days').textContent, n: arr.length, last: arr[arr.length-1], today: t });
  })()`);
  o = null; try { o = JSON.parse(b5); } catch (e) {}
  check('B6 收缩为 10 天且最近 n 天保留（末位=今天）', o && o.shown === '10' && o.n === 10 && o.last === o.today, b5);

  // B7 非法输入 → 弹窗不关、就地提示
  await evalJs(`document.getElementById('row-fish-days').click()`);
  await sleep(120);
  await evalJs(`(function(){var i=document.getElementById('modal-input'); i.value='abc'; document.getElementById('modal-ok').click(); return 'ok';})()`);
  await sleep(120);
  const b7 = await evalJs(`(function(){
    var mask=document.getElementById('modal-mask'), st=document.getElementById('modal-static');
    return JSON.stringify({ open: mask && !mask.hidden, hint: st && !st.hidden ? st.textContent : '' });
  })()`);
  o = null; try { o = JSON.parse(b7); } catch (e) {}
  check('B7 非法输入不关窗并提示', o && o.open === true && (o.hint || '').indexOf('整数天数') >= 0, b7);
  await evalJs(`document.getElementById('modal-cancel').click()`);
  await sleep(80);

  // B8 原值不变 → 提示无变化、不关窗（fish-log 不被重写）
  await evalJs(`document.getElementById('row-fish-days').click()`);
  await sleep(120);
  await evalJs(`(function(){var i=document.getElementById('modal-input'); i.value='10'; document.getElementById('modal-ok').click(); return 'ok';})()`);
  await sleep(120);
  const b8 = await evalJs(`(function(){
    var mask=document.getElementById('modal-mask'), st=document.getElementById('modal-static');
    var arr=JSON.parse(localStorage.getItem('xy-home-v2:fish-log')||'[]');
    return JSON.stringify({ open: mask && !mask.hidden, hint: st && !st.hidden ? st.textContent : '', n: arr.length });
  })()`);
  o = null; try { o = JSON.parse(b8); } catch (e) {}
  check('B8 原值不变提示且不改写 fish-log', o && o.open === true && (o.hint || '').indexOf('没有变化') >= 0 && o.n === 10, b8);
  await evalJs(`document.getElementById('modal-cancel').click()`);

  check('全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const fails = results.filter(r => !r.ok);
console.log('----');
console.log('verify-fish-days-edit: ' + (results.length - fails.length) + '/' + results.length + ' 通过' + (fails.length ? '（存在 FAIL）' : ''));
process.exit(fails.length ? 1 : 0);

// ===== 回归：互动卡片自动弹窗「已看过的旧卡重弹」修复（ta-ask.js / ck-question.js v3.12.x） =====
// 用户反馈：切后台再回来再切出，开屏弹出几分钟前已在聊天里看过的互动弹窗；
//          聊天气泡里的卡片也会重复弹窗。
// 根因：五处自动弹窗都是 setTimeout(400)，只守 document.hidden——手机浏览器把后台页面
//       定时器冻结/深度节流，回前台时把到点未执行的定时器一次性补跑；补跑瞬间页面已可见，
//       旧守卫全部失效 → 弹出旧卡。
// 修复：调度时刻起算，回调迟到 >4s（正常 ~400ms）一律视为冻结补跑，不再自动弹。
//
// 用例：
//   T1 正常路径不受影响：询问卡（popupProb=100）触发后 ~400ms 自动弹窗打开
//   T2 迟到补跑不弹：调度后把时钟前拨 10 分钟再让回调执行 → 不弹（修复点）
//   T3 小问题同款双验：正常弹 tc 面板 / 时钟前拨后不弹
//   T4 五处弹窗点均已接入迟到守卫（构建产物静态断言）
//   T5 加载至今无未捕获异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
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
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-interactpopup-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  else { fail++; console.log('  ✗ ' + name + (extra ? ' —— ' + JSON.stringify(extra) : '')); }
}

try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500); // 等开屏/数据就绪

  // 安装时钟偏移钩子（模拟「定时器被冻结、回前台数分钟后才补跑」）
  await evalJs(`(function(){ window.__tsShift = 0; var o = Date.now.bind(Date); Date.now = function(){ return o() + (window.__tsShift || 0); }; return true; })()`);

  // 把询问/小问题的自动弹窗概率设为 100%（确定性触发）
  const setupOk = await evalJs(`(function(){
    try {
      var s = window.activeStore();
      ['ta-ask','ta-choose'].forEach(function(k){
        var d = {}; try { d = JSON.parse(s.get(k) || '{}') || {}; } catch(e) { d = {}; }
        d.settings = d.settings || {};
        d.settings.enabled = true;
        d.settings.popupProb = 100;
        s.set(k, JSON.stringify(d));
      });
      return typeof window.triggerTaAskNow === 'function' && typeof window.triggerTaChooseNow === 'function';
    } catch(e){ return String(e); }
  })()`);
  ok('前置：模块与设置就绪（popupProb=100）', setupOk === true, setupOk);

  const maskState = `(function(){ var m=document.getElementById('modal-mask'), t=document.getElementById('tc-mask'); return { modal: !!(m && !m.hidden), tc: !!(t && !t.hidden) }; })()`;

  console.log('\n== T1 正常路径：新鲜卡片照常自动弹窗 ==');
  // 关掉可能存在的既有弹层，从干净状态开始
  await evalJs(`(function(){ ['modal-mask','tc-mask'].forEach(function(id){ var el=document.getElementById(id); if(el) el.hidden=true; }); return true; })()`);
  await evalJs(`window.__tsShift = 0; window.triggerTaAskNow(); true`);
  await sleep(1000);
  let st = await evalJs(maskState);
  ok('询问卡 400ms 后弹窗打开（modal-mask 可见）', st && st.modal === true, st);

  console.log('\n== T2 迟到补跑：时钟前拨 10 分钟后不再弹旧卡 ==');
  await evalJs(`(function(){ var m=document.getElementById('modal-mask'); if(m) m.hidden=true; return true; })()`);
  await evalJs(`(function(){ window.__tsShift = 0; window.triggerTaAskNow(); window.__tsShift = 600000; return true; })()`);
  await sleep(1000);
  st = await evalJs(maskState);
  ok('迟到回调不弹窗（modal-mask 保持关闭）', st && st.modal === false, st);
  await evalJs(`window.__tsShift = 0; true`);
  // 卡片本体仍进了聊天记录（可手动点击作答）
  const cardIn = await evalJs(`(function(){ try { var a=window.getChatMsgs(); for(var i=a.length-1;i>=0;i--){ if(a[i] && a[i].special==='ask-card') return true; } } catch(e){} return false; })()`);
  ok('卡片仍写入聊天记录（只是不自动弹）', cardIn === true);

  console.log('\n== T3 小问题（tc 面板弹窗）同款双验 ==');
  await evalJs(`(function(){ ['modal-mask','tc-mask'].forEach(function(id){ var el=document.getElementById(id); if(el) el.hidden=true; }); return true; })()`);
  await evalJs(`window.__tsShift = 0; window.triggerTaChooseNow(); true`);
  await sleep(1000);
  st = await evalJs(maskState);
  ok('小问题正常弹出 tc 面板', st && st.tc === true, st);
  await evalJs(`(function(){ var t=document.getElementById('tc-mask'); if(t) t.hidden=true; return true; })()`);
  await evalJs(`(function(){ window.__tsShift = 0; window.triggerTaChooseNow(); window.__tsShift = 600000; return true; })()`);
  await sleep(1000);
  st = await evalJs(maskState);
  ok('小问题迟到回调不弹窗', st && st.tc === false && st.modal === false, st);
  await evalJs(`window.__tsShift = 0; true`);

  console.log('\n== T4 构建产物静态断言：五处弹窗点均接入迟到守卫 ==');
  const guardCount = (readFileSync(join(root, 'index.html'), 'utf8').match(/popSchedAt/g) || []).length;
  ok('index.html 中 popSchedAt 守卫 ≥ 10 处（5 个声明 + 5 个比较，含 ck-question 查岗）', guardCount >= 10, { guardCount });
  const ckGuard = readFileSync(join(root, 'src/js/ck-question.js'), 'utf8').includes('popSchedAt');
  const taGuards = (readFileSync(join(root, 'src/js/ta-ask.js'), 'utf8').match(/popSchedAt/g) || []).length;
  ok('ck-question.js（查岗卡）已接守卫', ckGuard === true);
  ok('ta-ask.js 四处推卡函数均接守卫（≥8 处引用）', taGuards >= 8, { taGuards });

  console.log('\n== T5 无未捕获异常 ==');
  ok('加载至今无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

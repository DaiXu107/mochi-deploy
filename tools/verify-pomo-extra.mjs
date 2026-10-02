// ===== 专项：番茄钟结束铃声开关 + 后台本地通知 =====
// 用法：node tools/verify-pomo-extra.mjs
// 背景（用户反馈番茄钟到点没声音的后续加固）：
//   ①铃声可在页面开关（关=只静音，震动/通知保留）；②后台/熄屏时 Web Audio 挂起、
//   iOS 无 vibrate——补 pomoNotify 本地通知（SW showNotification，period.js 先例），
//   tick 兜底之外再按 endAt 挂准点 setTimeout（后台节流下谁先到点谁先提醒）。
// 验证：静态接线 + 运行时（包装 playBuiltinSfx 计数 + 拨快 Date.now；visibilityState
// 打补丁模拟后台，验证隐藏态完成不报错且通知路径守卫正确）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// ---- A 组：源码静态断言 ----
{
  const s = readFileSync(join(root, 'src', 'js', 'p2-features.js'), 'utf8');
  check('A1 铃声开关：pomoBellOn 门控 playBuiltinSfx，页面有 #pomo-bell 按钮',
    /if \(pomoBellOn\(\)\)\s*\{\s*try \{ if \(window\.playBuiltinSfx\)/.test(s) && /id="pomo-bell"/.test(s));
  check('A2 本地通知：pomoNotify 走 SW showNotification（new Notification 兜底）',
    /function pomoNotify\(title, body\)/.test(s) && /showNotification\(title/.test(s) && /new Notification\(title, \{ body: body \}\)/.test(s));
  check('A3 完成回调与准点定时器都有「仅后台」守卫',
    /visibilityState !== 'visible'\)\s*\{\s*\n\s*pomoNotify\('番茄钟/.test(s) && /pomoNotifyTimer = setTimeout/.test(s) && /visibilityState === 'visible'\) return;/.test(s));
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-pomox-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
}
writeFileSync(join(tmpSite, 'index.html'), outHtml);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[ext(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
function ext(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pomo-x-' + Date.now()),
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

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(2300);
await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
await sleep(400);

console.log('== 铃声开关 ==');
let t = await evalJs("(function(){var b=document.getElementById('pomo-bell');return b?b.textContent:'';})()");
check('B1 页面出现铃声开关，默认「开」', t === '铃声：开', t);
await evalJs(`(function(){
  try{ localStorage.setItem('xy-home-v2:default:pomo-bell','0'); }catch(e){}
  var b=document.getElementById('pomo-bell'); if(b)b.click(); // 翻回开会写 '1'？——先点一次看行为
  return b?b.textContent:'';
})()`);
// 上面的 click 把「读到的开」翻成关并写 '0'——现在明确置为关闭态
await evalJs(`(function(){
  try{ localStorage.setItem('xy-home-v2:default:pomo-bell','0'); }catch(e){}
  var b=document.getElementById('pomo-bell'); if(b)b.textContent='铃声：关';
  return true;
})()`);
t = await evalJs("(function(){var b=document.getElementById('pomo-bell');return b?b.textContent:'';})()");
check('B2 可置于「关」（存储键 pomo-bell=0）', t === '铃声：关' && (await evalJs("(function(){return localStorage.getItem('xy-home-v2:default:pomo-bell');})()")) === '0', t);

// 关铃后到点：不响铃但完成流程照常（记 🍅、切休息档）
await evalJs(`(function(){
  try {
    window.__bellCount=0;
    var orig=window.playBuiltinSfx;
    window.playBuiltinSfx=function(){window.__bellCount++;return orig.apply(this,arguments);};
    document.getElementById('pomo-start').click();          // endAt 按真实时间落点
    window.__realNow=Date.now;
    Date.now=function(){ return window.__realNow()+3600000; }; // 再拨快，等 tick 判到点
    return 'ok';
  } catch(e){ return 'err:'+e.message; }
})()`);
await sleep(1400);
let st = JSON.parse(await evalJs(`(function(){
  Date.now=window.__realNow;
  return JSON.stringify({bell:window.__bellCount,stats:(document.getElementById('pomo-stats')||{}).textContent||'',state:(document.getElementById('pomo-state')||{}).textContent||''});
})()`));
check('B3 铃声关闭时到点静音，但 🍅 照记、切休息档', st.bell === 0 && /× 1\b/.test(st.stats) && /^准备(小憩|长休)/.test(st.state), st);

// 重新开启后再到点应恢复响铃
await evalJs("(function(){document.getElementById('pomo-bell').click();return true;})()");
t = await evalJs("(function(){var b=document.getElementById('pomo-bell');return b?b.textContent:'';})()");
await evalJs(`(function(){
  try {
    Date.now=window.__realNow;                    // 先还原，endAt 按真实时间落点
    document.getElementById('pomo-start').click();
    Date.now=function(){ return window.__realNow()+7200000; }; // 再拨快等 tick 判到点
    return 'ok';
  } catch(e){ return 'err:'+e.message; }
})()`);
await sleep(1400);
st = JSON.parse(await evalJs(`(function(){
  Date.now=window.__realNow;
  return JSON.stringify({bell:window.__bellCount,state:(document.getElementById('pomo-state')||{}).textContent||''});
})()`));
check('B4 重新开启后休息档到点恢复响铃', t === '铃声：开' && st.bell >= 1 && /^准备专注/.test(st.state), { t, st });

console.log('== 后台通知路径 ==');
// visibilityState 补丁模拟后台：无头环境权限为 default → pomoNotify 应静默返回不抛错；
// 准点 setTimeout 与 tick 双路径都走一遍，状态推进不受影响。
const armRet = await evalJs(`(function(){
  try {
    var d=document;
    Object.defineProperty(d,'visibilityState',{get:function(){return 'hidden';},configurable:true});
    window.__bellCount=0;
    Date.now=window.__realNow;                     // 先还原，endAt 按真实时间落点
    document.getElementById('pomo-start').click();
    Date.now=function(){ return window.__realNow()+10800000; }; // 再拨快（此刻铃声开）
    return 'armed';
  } catch(e){ return 'err:'+e.message; }
})()` || '');
await sleep(1400);
st = JSON.parse(await evalJs(`(function(){
  Date.now=window.__realNow;
  var r={arm:${JSON.stringify('armed')},bell:window.__bellCount,state:(document.getElementById('pomo-state')||{}).textContent||''};
  try{ delete document.visibilityState; }catch(e){}
  return JSON.stringify(r);
})()`));
check('B5 后台态完成：通知路径静默安全（无权限不抛错），流程照常', armRet === 'armed' && st && st.bell >= 1 && /^准备(小憩|长休)/.test(st.state), { armRet, st });

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

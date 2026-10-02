// ===== v3.26.x 验证脚本：#223 群聊颜色「一改就恢复」修复 + #224 dcfP 作用域修复 =====
// 用法：SERVE_DIR=<临时构建产物目录> node tools/verify-gc-color.mjs
// 背景：#223 群聊美化 pickGcColor 原对比度保护在选色后立即回滚（粉/浅色气泡配默认白字、
//      深色文字配默认黑底全被拒），用户怎么选都弹回旧色（荣耀畅玩40 Plus+夸克等多机型
//      报障，与机型无关）；修复=接受所选颜色，可读性由 applyGcBeauty 尾部 gcEnsureContrast
//      自愈兜底（方案同单聊 chat-settings._ensureBubbleContrast）。
//      #224 p2-features.js chk 在另一 IIFE 里引用 dcfP 必抛 ReferenceError（诊断日志每分钟
//      一条 dcfP is not defined），改经本 IIFE 助手 dcfPFish→window.dcfGet。
// 断言：S* 静态锚（src 直查），R* 运行时（无头 Chrome 走真实产物、真实 UI 弹窗流程）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const serveDir = normalize(process.env.SERVE_DIR || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 静态锚（对 src 断言） ----
const src = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');
const p2 = readFileSync(join(root, 'src/js/p2-features.js'), 'utf8');
check('S1 pickGcColor 不再回滚选色（删 gcBeautySet(key, prev) 回滚分支）', !src.includes('gcBeautySet(key, prev)'));
check('S2 pickGcColor 不再弹「已恢复」提示', !src.includes('该颜色与气泡太接近'));
check('S3 对比度自愈已按用户要求移除（2026-09-11：不强制换色）', !src.includes('function gcEnsureContrast()'));
check('S4 applyGcBeauty 不再接入自愈', !/applyGcCss\(\);\s*\n\s*gcEnsureContrast\(\);/.test(src));
check('S5 对比度警告/计算残留清零', !src.includes('gcColorPairBad') && !src.includes('gcColorWarnText') && !src.includes('gc-contrast-fix'));
check('S6 #224 chk 助手 dcfPFish 在位且不再跨 IIFE 引用 dcfP', p2.includes('function dcfPFish(def)') && !p2.includes("dcfP('fish'"));

// ---- 运行时（无头 Chrome 端到端） ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(serveDir, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(serveDir)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const cdpPort = 9700 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gccolor-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function connect() {
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
    if (r && r.exceptionDetails) return 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 300);
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await connect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

// 打开群聊页 + 群聊设置面板 + 美化视图（同 verify-gc-settings 的真实入口路径）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return 1;})()");
await evalJs("(function(){var el=document.getElementById('gc-more-settings');if(el){el.click();return 1;}return 0;})()");
await sleep(600);
await evalJs("(function(){var links=Array.from(document.querySelectorAll('#gc-set-body .gc-set-link'));var el=links.find(function(x){return x.innerText.indexOf('美化聊天')>=0;});if(el){el.click();return 1;}return 0;})()");
await sleep(500);

// 点击「我的气泡颜色」行 → 弹窗色板 → 选第 4 格樱花粉 #ffd6e0 → 确定
const clickRow = (label) => evalJs("(function(){var rows=document.querySelectorAll('#gc-set-body .gc-set-row');for(var i=0;i<rows.length;i++){var t=rows[i].querySelector('.txt');if(t&&t.textContent==='" + label + "'){rows[i].click();return 1;}}return 0;})()");
await clickRow('我的气泡颜色');
await sleep(400);
const modalInfo = await evalJs("(function(){var m=document.getElementById('modal-mask');if(!m||m.hidden)return 'CLOSED';return JSON.stringify({sw:document.getElementById('modal-swatches').children.length});})()");
check('R1 选「我的气泡颜色」弹出色板（9 格）', modalInfo !== 'CLOSED' && modalInfo.includes('"sw":9'), String(modalInfo));

await evalJs("(function(){var sw=document.getElementById('modal-swatches').children;sw[3].click();return 1;})()");
await sleep(150);
await evalJs("(function(){document.getElementById('modal-ok').click();return 1;})()");
await sleep(500);
const afterPick = await evalJs("(function(){var p=document.getElementById('page-group-chat');var fix=document.getElementById('gc-contrast-fix');var saved='';try{saved=JSON.parse(window.xyStore('xy-home-v2').get('gc-beauty')||'{}')['out-bg']||'';}catch(e){}return JSON.stringify({v:p.style.getPropertyValue('--msg-out-bg').trim(),saved:saved,fix:!!fix});})()");
let ap = {}; try { ap = JSON.parse(afterPick); } catch (e) {}
check('R2 选樱花粉后颜色生效（--msg-out-bg=#ffd6e0）——不再一改就恢复', ap.v === '#ffd6e0', afterPick);
check('R3 所选颜色已持久化（gc-beauty out-bg=#ffd6e0，未回滚）', ap.saved === '#ffd6e0', '');
check('R4 低对比组合不再被强制覆盖（无 gc-contrast-fix 注入）', ap.fix === false, '');

// 接着把「我的消息文字颜色」选黑色：粉底黑字对比充足 → 自愈样式应自动移除
await clickRow('我的消息文字颜色');
await sleep(400);
await evalJs("(function(){var sw=document.getElementById('modal-swatches').children;sw[0].click();return 1;})()");
await sleep(150);
await evalJs("(function(){document.getElementById('modal-ok').click();return 1;})()");
await sleep(500);
const afterInk = await evalJs("(function(){var p=document.getElementById('page-group-chat');var fix=document.getElementById('gc-contrast-fix');return JSON.stringify({ink:p.style.getPropertyValue('--msg-out-ink').trim(),fix:!!fix});})()");
let ai = {}; try { ai = JSON.parse(afterInk); } catch (e) {}
check('R5 文字改黑色后正常生效且无覆盖样式', ai.ink === '#111111' && ai.fix === false, afterInk);

// 黑底黑字经方案导入路径（applyGcBeautyData）也不再被强制改色——用户选什么就是什么
await evalJs("(function(){window.applyGcBeautyData({'in-bg':'#111111','in-ink':'#111111'});return 1;})()");
await sleep(400);
const blackOnBlack = await evalJs("(function(){var p=document.getElementById('page-group-chat');var fix=document.getElementById('gc-contrast-fix');return JSON.stringify({inbg:p.style.getPropertyValue('--msg-in-bg').trim(),inink:p.style.getPropertyValue('--msg-in-ink').trim(),fix:!!fix});})()");
let bb = {}; try { bb = JSON.parse(blackOnBlack); } catch (e) {}
check('R6 导入黑底黑字原样生效（无自愈覆盖）', bb.inbg === '#111111' && bb.inink === '#111111' && bb.fix === false, blackOnBlack);

// 恢复可读组合 → 依旧无覆盖样式
await evalJs("(function(){window.applyGcBeautyData({'in-bg':'#ffffff','in-ink':'#111111'});return 1;})()");
await sleep(400);
const restored = await evalJs("(function(){return JSON.stringify({fix:!!document.getElementById('gc-contrast-fix')});})()");
check('R7 恢复默认组合 → 无 gc-contrast-fix', restored === '{"fix":false}', restored);

// 全程无未捕获错误（含历史版本每分钟必抛的 dcfP is not defined）
const errs = await evalJs("(function(){var a=Array.isArray(window.__jsErrors)?window.__jsErrors:[];return JSON.stringify(a.map(function(e){return String(e.message||e).slice(0,80);}));})()");
let bad = []; try { bad = JSON.parse(errs).filter((m) => /dcfP|ReferenceError|TypeError/.test(m)); } catch (e) { bad = ['PARSE ' + errs]; }
check('R8 全程零未捕获错误（无 dcfP is not defined / ReferenceError）', bad.length === 0, JSON.stringify(bad));

chrome.kill();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);

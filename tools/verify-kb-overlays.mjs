// ===== v3.12.x：手机端浮层键盘停靠回归（qa-mask / tc-mask / period-day-pop） =====
// 背景：fixed → absolute 系列修复——手机端键盘弹出时 mobile-adapt 收缩 .phone
// （align-self:flex-start + height=可视高度），fixed 弹层仍相对整屏布局视口定位，
// 面板下半截沉到键盘后面（输入内容/按钮被盖住）。本脚本模拟 .phone 收缩，
// 断言各弹层遮罩随缩、面板仍在可视区内居中/贴底。
// 用法：node build.mjs && node tools/verify-kb-overlays.mjs
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9440 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kb-ovl-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
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

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
  else { fail++; console.log('FAIL  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(2300);
  await evalJs("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var b=document.getElementById('modal-ok');if(b)b.click();}return true;})()");
  await sleep(400);
  await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
  await sleep(300);
}
// 模拟键盘弹出 / 收起（mobile-adapt 同款行为）
const kbOn = `(function(){var p=document.querySelector('.phone');p.style.alignSelf='flex-start';p.style.height='400px';return true;})()`;
const kbOff = `(function(){var p=document.querySelector('.phone');p.style.height='';p.style.alignSelf='flex-start'==='x'?'':'';
  p.style.alignSelf='';return true;})()`;
// 量测：遮罩是否随 .phone 收缩 + 面板是否完整落在可视区内
function measure(maskSel, panelSel) {
  return `(function(){
    var mask=document.querySelector('${maskSel}');
    var panel=document.querySelector('${panelSel}');
    var phone=document.querySelector('.phone');
    if(!mask||mask.hidden||!phone) return JSON.stringify({err:'no-'+(mask?'panel':'mask')});
    var kb=mask.getBoundingClientRect(), pb=phone.getBoundingClientRect();
    var out={maskT:Math.round(kb.top),maskH:Math.round(kb.height),phoneH:Math.round(pb.height),phoneT:Math.round(pb.top)};
    if(panel){var n=panel.getBoundingClientRect();
      out.panelT=Math.round(n.top);out.panelB=Math.round(n.bottom);
      out.fits=n.top>=pb.top-1&&n.bottom<=pb.bottom+1;
      out.centered=Math.abs((n.top-pb.top)-(pb.height-n.height)/2)<=3;
    }
    return JSON.stringify(out);
  })()`;
}

await loadApp();

// ---- A. qa-mask（回答弹层，含 #qa-input 输入框）----
await evalJs(`(function(){
  var m=document.getElementById('qa-mask');
  document.getElementById('qa-body').innerHTML='<div class="qa-q">测试问题</div><input id="qa-input" class="qa-input" type="text" placeholder="回 TA 一句"><button class="qa-send" id="qa-send">回</button>';
  m.hidden=false;return true;
})()`);
await sleep(350);
const qa1 = JSON.parse(await evalJs(measure('#qa-mask', '.qa-panel')));
check('A1 qa-mask 打开且为 absolute（锚定 .phone）', qa1 && qa1.maskH === 844, qa1);
await evalJs(kbOn);
await sleep(300);
const qa2 = JSON.parse(await evalJs(measure('#qa-mask', '.qa-panel')));
check('A2 键盘弹出后 qa 面板完整落在可视区内（不再沉到键盘后）',
  qa2 && qa2.maskH === 400 && qa2.fits === true && qa2.centered === true, qa2);
await evalJs(kbOff);
await evalJs("(function(){document.getElementById('qa-mask').hidden=true;return true;})()");
await sleep(250);

// ---- B. tc-mask（选择题/TA问答子面板，openTCPanel 含文字输入）----
await evalJs(`(function(){
  if (window.openTCPanel) { window.openTCPanel('测试面板', '<div class="sm-fld"><input class="tc-input" id="kb-test-inp" value="abc"></div>'); return 'tc'; }
  return 'no-openTCPanel';
})()`);
await sleep(400);
const tcOpen = await evalJs(`(function(){var m=document.getElementById('tc-mask');return !!(m&&!m.hidden);})()`);
const tc1 = JSON.parse(await evalJs(measure('#tc-mask', '.tc-panel')));
check('B1 tc-mask 打开（openTCPanel）且为 absolute', tcOpen && tc1 && tc1.maskH === 844, tc1);
await evalJs(kbOn);
await sleep(300);
const tc2 = JSON.parse(await evalJs(measure('#tc-mask', '.tc-panel')));
check('B2 键盘弹出后 tc 面板完整落在可视区内', tc2 && tc2.maskH === 400 && tc2.fits === true && tc2.centered === true, tc2);
await evalJs(kbOff);
await evalJs("(function(){var m=document.getElementById('tc-mask');if(m)m.hidden=true;return true;})()");
await sleep(250);

// ---- C. period-day-pop（经期日详情浮层，含体温/备注输入）----
// 真实 UI 路径：桌面 → 经期记录 → 点日格
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"period\"]');if(a)a.click();return !!a;})()");
await sleep(900);
const cellSel = await evalJs(`(function(){
  var cells=document.querySelectorAll('#page-period .pc-cell:not(.blank)');
  if(!cells.length) return '';
  cells[Math.floor(cells.length/2)].click();
  return 'clicked';
})()`);
await sleep(500);
const popInPhone = await evalJs(`(function(){
  var pop=document.getElementById('period-day-pop');
  if(!pop) return 'no-pop';
  var p=pop.parentElement;
  return p ? (p.className===String(p.className)?String(p.className).split(' ')[0]:p.tagName) : 'orphan';
})()`);
const pd1 = JSON.parse(await evalJs(measure('#period-day-pop', '#period-day-pop .dp-sheet')));
check('C1 经期浮层挂到 .phone 内且为 absolute', popInPhone === 'phone' && pd1 && pd1.maskH === 844, { parent: popInPhone, m: pd1 });
check('C2 底部面板完整落在手机框内', pd1 && pd1.fits === true, pd1);
await evalJs(kbOn);
await sleep(300);
const pd2 = JSON.parse(await evalJs(measure('#period-day-pop', '#period-day-pop .dp-sheet')));
check('C3 键盘弹出后浮层随缩且底部面板完整落在可视区内（备注/保存不被键盘盖住）',
  pd2 && pd2.maskH === 400 && pd2.fits === true, pd2);
await evalJs(kbOff);

// 关闭浮层（点遮罩）
await evalJs("(function(){var pop=document.getElementById('period-day-pop');if(pop){var m=pop.querySelector('.dp-mask');if(m)m.click();}return true;})()");
await sleep(300);
const popClosed = await evalJs(`(function(){return !document.getElementById('period-day-pop');})()`);
check('C4 浮层可正常关闭（挂 .phone 后 remove 生效）', popClosed === true, popClosed);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);

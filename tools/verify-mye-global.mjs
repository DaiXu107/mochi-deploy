// ===== v3.12.x：我的表情包全局互通 + 链接导入弹窗键盘适配回归 =====
// A. 存量迁移：各联系人桌面键 + 顶层旧键一次性合并进全局键 xy-home-v2:my-emoji-groups
//    （同名分组并组、组内去重），迁移后删除各桌面键、置 mye-global-migrated 标记
// B. 桌面互通：切换联系人桌面后「我的表情包」显示同一份数据；全局键新增分组各桌面可见
// C. 弹窗位置：#modal-mask 改 absolute 锚定 .phone——键盘弹出（mobile-adapt 收缩
//    .phone 高度）后弹窗仍在可视区内居中，不再被拉到输入栏下方/键盘后面
// 用法：node build.mjs && node tools/verify-mye-global.mjs
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mye-global-' + Date.now()),
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
  // 启动通知弹窗（bug 报修须知等）可能延迟弹出——出现就点确认，防遮挡后续步骤
  await evalJs("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var b=document.getElementById('modal-ok');if(b)b.click();}return true;})()");
  await sleep(400);
  await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
  await sleep(300);
}

const IMG_A1 = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const IMG_A2 = 'data:image/gif;base64,R0lGODlhAQABAIAAAP/wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const IMG_B1 = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAACAkQBADs=';
const IMG_C1 = 'data:image/gif;base64,R0lGODlhAQABAIAAAP/oAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const IMG_NEW = 'data:image/gif;base64,R0lGODlhAQABAIAAAP/AAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

// ---- 种子：两个联系人；ctest1（激活）/ default 各有桌面级我的表情包 + 顶层旧键 ----
// 注意：首次 loadApp 时迁移块已跑过一次并把 mye-global-migrated 写进了 IDB——
// 种子阶段必须连 IDB 一起清（idbRestore 会把 IDB 标记回填 LS，导致迁移提前 return）
await loadApp();
await evalJs(`(async function(){
  try {
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{id:'default',name:'默认'},{id:'ctest1',name:'小A'}]));
    localStorage.setItem('xy-home-v2:active-contact', 'ctest1');
    localStorage.setItem('xy-home-v2:ctest1:lbl-partner', '小A');
    localStorage.setItem('xy-home-v2:default:lbl-partner', '默认');
    localStorage.setItem('xy-home-v2:ctest1:my-emoji-groups', JSON.stringify([['小A组',['${IMG_A1}','${IMG_A2}']]]));
    localStorage.setItem('xy-home-v2:default:my-emoji-groups', JSON.stringify([['默认组',['${IMG_B1}']]]));
    localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['旧组',['${IMG_C1}']]]));
    localStorage.removeItem('xy-home-v2:mye-global-migrated');
    if (window.idbDelete) {
      var dead = ['xy-home-v2:mye-global-migrated','xy-home-v2:my-emoji-groups','xy-home-v2:ctest1:my-emoji-groups','xy-home-v2:default:my-emoji-groups'];
      for (var i = 0; i < dead.length; i++) { try { await window.idbDelete(dead[i]); } catch (e) {} }
    }
    return true;
  } catch (e) { return 'err:' + e.message; }
})()`);
await loadApp();

// ---- A. 迁移：合并 + 清桌面键 + 标记 ----
const mig = JSON.parse(await evalJs(`(function(){
  function rd(k){ try { return JSON.parse(localStorage.getItem(k)||'null'); } catch(e){ return null; } }
  var g = rd('xy-home-v2:my-emoji-groups') || [];
  var names = g.map(function(x){ return x[0]; });
  var cnt = 0; g.forEach(function(x){ cnt += (x[1]||[]).length; });
  var uniqA = (g.find(function(x){return x[0]==='小A组';})||[[],[]])[1] || [];
  return JSON.stringify({
    names: names,
    cnt: cnt,
    a1: uniqA.indexOf('${IMG_A1}') >= 0, a2: uniqA.indexOf('${IMG_A2}') >= 0,
    b1: cnt > 0 && JSON.stringify(g).indexOf('${IMG_B1}') >= 0,
    c1: cnt > 0 && JSON.stringify(g).indexOf('${IMG_C1}') >= 0,
    deskCtest1: rd('xy-home-v2:ctest1:my-emoji-groups'),
    deskDefault: rd('xy-home-v2:default:my-emoji-groups'),
    migrated: localStorage.getItem('xy-home-v2:mye-global-migrated')
  });
})()`));
check('A1 全局键合并三个来源分组（顺序：当前桌面→其余桌面→顶层旧键）',
  JSON.stringify(mig.names) === JSON.stringify(['小A组', '默认组', '旧组']), mig.names);
check('A2 组内字卡齐全（A1/A2/B1/C1 共 4 张）', mig.cnt === 4 && mig.a1 && mig.a2 && mig.b1 && mig.c1, mig);
check('A3 各桌面旧键已清除', mig.deskCtest1 === null && mig.deskDefault === null,
  { ctest1: mig.deskCtest1, def: mig.deskDefault });
check('A4 迁移标记已置位', mig.migrated === '1', mig.migrated);

// ---- B. 桌面互通 ----
async function openMinePanel() {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()");
  await sleep(900);
  await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return !!b;})()");
  await sleep(450);
  await evalJs("(function(){var t=document.querySelector('#emoji-panel .emoji-tab[data-etab=\"mine\"]');if(t)t.click();return !!t;})()");
  await sleep(350);
}
async function mineChips() {
  return JSON.parse(await evalJs(`(function(){
    return JSON.stringify([].slice.call(document.querySelectorAll('#emoji-panel #emoji-groups .emoji-g-chip')).map(function(x){return x.textContent;}));
  })()`));
}
await openMinePanel();
let chips = await mineChips();
check('B1 小A 桌面面板分组 = 迁移后全局分组', JSON.stringify(chips) === JSON.stringify(['小A组2', '默认组1', '旧组1']), chips);

// 切到 default 桌面：同一份数据
await evalJs("(function(){var b=document.getElementById('emoji-close');if(b)b.click();return true;})()");
await sleep(250);
await evalJs("(function(){window.setActiveContact && window.setActiveContact('default');return true;})()");
await sleep(700);
await openMinePanel();
chips = await mineChips();
check('B2 切到默认桌面：面板分组与 小A 桌面一致（互通）',
  JSON.stringify(chips) === JSON.stringify(['小A组2', '默认组1', '旧组1']), chips);

// 全局键新增分组（模拟另一桌面写入）→ 当前桌面立即可见
await evalJs(`(function(){
  var g=null; try { g=JSON.parse(localStorage.getItem('xy-home-v2:my-emoji-groups')||'null'); } catch(e){}
  if (g) g.push(['新增组',['${IMG_NEW}']]);
  localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify(g));
  document.dispatchEvent(new Event('contact-switched'));
  return true;
})()`);
await sleep(600);
chips = await mineChips();
check('B3 全局键新增分组后各桌面可见', JSON.stringify(chips) === JSON.stringify(['小A组2', '默认组1', '旧组1', '新增组1']), chips);
await evalJs("(function(){var b=document.getElementById('emoji-close');if(b)b.click();return true;})()");
await sleep(250);

// ---- C. 链接导入弹窗位置（键盘适配）----
await openMinePanel();
const pos0 = JSON.parse(await evalJs(`(function(){
  var b=document.getElementById('mye-add-link'); if(b) b.click();
  return true;
})()`));
await sleep(600);
const m1 = JSON.parse(await evalJs(`(function(){
  var mask=document.getElementById('modal-mask');
  var modal=document.querySelector('#modal-mask .modal');
  var phone=document.querySelector('.phone');
  if(!mask||!modal||!phone||mask.hidden) return JSON.stringify({err:'no-modal'});
  var mb=modal.getBoundingClientRect(), pb=phone.getBoundingClientRect();
  return JSON.stringify({
    pos: getComputedStyle(mask).position,
    parentCls: mask.parentElement.className,
    modalT: Math.round(mb.top), modalH: Math.round(mb.height),
    phoneT: Math.round(pb.top), phoneH: Math.round(pb.height),
    centered: Math.abs((mb.top - pb.top) - (pb.height - mb.height)/2) <= 3
  });
})()`));
check('C1 弹窗打开且 #modal-mask 为 absolute（锚定 .phone）',
  m1 && m1.pos === 'absolute' && /phone/.test(m1.parentCls || ''), m1);
check('C2 无键盘时弹窗在 .phone 内垂直居中', m1 && m1.centered === true, m1);

// 模拟键盘弹出：mobile-adapt 收缩 .phone（align-self:flex-start + height=可视高度）
await evalJs(`(function(){
  var p=document.querySelector('.phone');
  p.style.alignSelf='flex-start';
  p.style.height='400px';
  return true;
})()`);
await sleep(300);
const m2 = JSON.parse(await evalJs(`(function(){
  var mask=document.getElementById('modal-mask');
  var modal=document.querySelector('#modal-mask .modal');
  var phone=document.querySelector('.phone');
  if(!modal||!phone) return JSON.stringify({err:'no-modal'});
  var mb=modal.getBoundingClientRect(), pb=phone.getBoundingClientRect(), kb=mask.getBoundingClientRect();
  return JSON.stringify({
    modalT: Math.round(mb.top), modalB: Math.round(mb.bottom), modalH: Math.round(mb.height),
    phoneT: Math.round(pb.top), phoneH: Math.round(pb.height),
    maskT: Math.round(kb.top), maskH: Math.round(kb.height),
    centered: Math.abs((mb.top - pb.top) - (pb.height - mb.height)/2) <= 3,
    fits: mb.top >= pb.top - 1 && mb.bottom <= pb.bottom + 1
  });
})()`));
check('C3 键盘弹出（.phone 收缩 400px）后弹窗仍在可视区内居中',
  m2 && m2.centered === true && m2.fits === true, m2);
// 修复点断言：遮罩随 .phone 收缩（高=可视高度 400），不再 fixed 整屏 844——
// 旧 bug 正是 fixed 遮罩保持整屏高、弹窗中心落在停靠输入栏下方/键盘后面
check('C4 遮罩随 .phone 收缩（maskH=400 可视高度，非整屏 844）',
  m2 && m2.maskH === m2.phoneH && m2.maskT === m2.phoneT && m2.maskH === 400, m2);

// 还原 .phone + 关弹窗
await evalJs(`(function(){
  var p=document.querySelector('.phone'); p.style.height=''; p.style.alignSelf='';
  var m=document.getElementById('modal-mask'); if(m) m.hidden=true;
  var b=document.getElementById('emoji-close'); if(b) b.click();
  return true;
})()`);

console.log('\\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);

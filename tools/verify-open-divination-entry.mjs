// ===== 回归脚本：#670 设置 → 工具 →【占卜】入口 ＋ 群聊模式收起桌面占卜图标的说明 =====
// 用法：node tools/verify-open-divination-entry.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-open-divination-entry.mjs   （测临时构建副本）
// 用户需求（2026-09-17 直派）：「当开启群聊模式，桌面的群聊图标显示出来，然后占卜的图标被隐藏。
// 打开桌面占卜的功能可以放在设置的工具里。并且这点也需要说明。」
// 断言：
//   A 轴（源码锚）：设置行/小字在 template.html；接线与「复用桌面图标处理器」「#393 pin 豁免判据」
//                   在 personalize.js；说明在 template.html + settings-help.js；功能大全收录；
//                   并且 #156 的收起语义仍在（没有为了本批把它改掉）。
//   B 轴（真实产物）：默认（群聊关）点行＝打开占卜页并渲染历史记录（与点桌面图标同一条路径）；
//                     开群聊 → 桌面占卜图标进隐藏池、群聊图标回第一页、小字变「已收起」，点行照样进占卜；
//                     装修固定过占卜（#393 pin）→ 图标不被收走、小字不谎报「已收起」；
//                     关群聊 → 图标回第一页、pin 被清、小字回「等效」；全程零 JS 异常。
// 产物未构建（root/index.html 里没有本行）时 B 轴按「环境不满足」退出码 2，不算回归。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
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
let tplSrc = '', pzSrc = '', shSrc = '', hubSrc = '';
try { tplSrc = readFileSync(join(root, 'src/template.html'), 'utf8'); } catch (e) {}
try { pzSrc = readFileSync(join(root, 'src/js/personalize.js'), 'utf8'); } catch (e) {}
try { shSrc = readFileSync(join(root, 'src/js/settings-help.js'), 'utf8'); } catch (e) {}
try { hubSrc = readFileSync(join(root, 'src/js/feature-hub.js'), 'utf8'); } catch (e) {}

check('A1 设置行 + 行下小字在模板（工具 tag #row-open-divination / #open-divination-sub）',
  tplSrc.includes('id="row-open-divination"') && tplSrc.includes('id="open-divination-sub"'));
check('A2 功能介绍写明「群聊模式期间占卜图标收起」（说明需求）',
  tplSrc.includes('<b>开启群聊模式期间桌面占卜图标会收起</b>'));
check('A3 行点击接线在位（personalize.js）',
  pzSrc.includes("row.addEventListener('click', openDivinePage);"));
check('A4 打开路径复用桌面占卜图标的 click 处理器（＝含打开即渲染历史，与点图标等效）',
  pzSrc.includes("const icon = document.querySelector('.app[data-app=\"divination\"]');") &&
  pzSrc.includes('icon.click()'));
check('A5 兜底导航在位（图标确实缺失时仍能进占卜页）',
  pzSrc.includes("const dp = document.getElementById('page-divine');") && pzSrc.includes('if (dp) dp.hidden = false;'));
check('A6 小字判据含 #393 pin 豁免（固定过占卜的桌面不许谎报「已收起」）',
  pzSrc.includes("try { return store.get('divination-desk-pin') !== '1'; } catch (e) { return true; }"));
check('A7 「开启群聊」功能说明同步写明收起 + 设置入口',
  shSrc.includes('桌面占卜图标会收进隐藏池——第一页留给群聊入口'));
check('A8 新行「功能说明」已登记', shSrc.includes("sel: '#row-open-divination'"));
check('A9 功能大全收录该入口（搜「占卜 图标不见了」能找到）',
  hubSrc.includes("go: ['#row-open-divination']"));
check('A10 #156 收起语义未被本批改动（群聊开启仍把占卜收进隐藏池）',
  pzSrc.includes('if (divBtn && divBtn.parentNode !== pool && !divPin) {') && pzSrc.includes('pool.appendChild(divBtn);'));
if (results.some(r => !r.ok)) {
  console.log('----');
  console.log('A 轴有 FAIL：源码锚缺失（修复被覆盖或未接入），B 轴跳过');
  process.exit(1);
}

// ---------- B 轴：真实浏览器行为（需已构建产物） ----------
const idxPath = join(root, 'index.html');
const builtHasRow = existsSync(idxPath) && readFileSync(idxPath, 'utf8').includes('id="row-open-divination"');
if (!builtHasRow) {
  console.log('----');
  console.log('环境不满足：产物 index.html 里还没有本行（本批未构建 / 构建者尚未收口）→ 构建后重跑');
  process.exit(2);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 15));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-670-' + Date.now()),
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
// 打开页后等设置行 + 占卜页就绪
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) {
    const ok = await evalJs(`!!(document.getElementById('row-open-divination') && document.querySelector('.app[data-app="divination"]') && document.getElementById('page-divine'))`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}
// 小字全文（用于判断「已收起 / 等效」二态）
const SUB = `(document.getElementById('open-divination-sub')||{}).textContent||''`;
// 桌面占卜图标当前是否可见（在任意 app-grid 内＝可见；在 #desk-widget-pool 内＝已收起）
const ICON_STATE = `(function(){
  var ic=document.querySelector('.app[data-app="divination"]');
  if(!ic) return 'missing';
  if(ic.closest('#desk-widget-pool')) return 'pooled';
  if(ic.closest('.app-grid')) return 'desk';
  return 'other';
})()`;

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');

  // 预置一条占卜历史（证明「点行＝走桌面图标的同一处理器」：图标处理器会 renderHistOnOpen 渲染历史）
  await boot();
  await evalJs(`window.storeFor('default').set('divine-history', JSON.stringify([{mode:'tarot',count:1,ts:Date.now(),question:'#670 自动化',cards:[{name:'愚者',rev:false}]}]))`);
  const bootOk = await boot();
  check('B0 应用就绪（设置行 + 桌面占卜图标 + 占卜页都在，且非默认桌面渲染异常）', bootOk === true, String(bootOk));

  // B1 默认（群聊关）：小字＝「等效」，点行 → 占卜页显示 + 历史记录已渲染（＝与点桌面图标同一条路径）
  const sub1 = await evalJs(SUB);
  check('B1a 群聊关闭时小字＝「与点桌面图标等效」', !!sub1 && sub1.indexOf('等效') >= 0, String(sub1));
  await evalJs(`document.getElementById('row-open-divination').click()`);
  await sleep(200);
  const b1 = await evalJs(`(function(){
    var dp=document.getElementById('page-divine');
    var h=document.getElementById('div-history');
    return JSON.stringify({ divine: dp && !dp.hidden, setting: (function(){var p=document.getElementById('page-setting');return p?p.hidden:null;})(), hist: h? h.innerHTML : null });
  })()`);
  let o = null; try { o = JSON.parse(b1); } catch (e) {}
  check('B1b 点行打开占卜页（#page-divine 显示、设置页隐去）', o && o.divine === true && o.setting === true, b1);
  check('B1c 占卜页历史记录已渲染（预置记录可见；「与点桌面图标同路径」由 A4 的 icon.click() 复用保证）',
    o && typeof o.hist === 'string' && o.hist.indexOf('占卜记录') >= 0 && o.hist.indexOf('愚者') >= 0, o ? String(o.hist).slice(0, 120) : b1);

  // B2 开群聊模式：桌面占卜图标进隐藏池、群聊图标回第一页、小字变「已收起」，点行照样进占卜
  await evalJs(`(function(){ window.xyStore('xy-home-v2').set('group-chat-enabled','1'); document.dispatchEvent(new Event('group-chat-mode-changed')); return 'ok'; })()`);
  await sleep(200);
  const icon2 = await evalJs(ICON_STATE);
  const sub2 = await evalJs(SUB);
  const gc2 = await evalJs(`(function(){ var g=document.querySelector('.app[data-app="group-chat"]'); return g? (g.closest('.app-grid')? 'desk':'pooled') : 'missing'; })()`);
  check('B2a 群聊开启：桌面占卜图标收进隐藏池（#156 语义保持）', icon2 === 'pooled', String(icon2));
  check('B2b 群聊开启：群聊图标出现在桌面图标组', gc2 === 'desk', String(gc2));
  check('B2c 群聊开启：小字改为「已收起 + 点这里直接打开」', !!sub2 && sub2.indexOf('已收起') >= 0, String(sub2));
  await evalJs(`document.getElementById('row-open-divination').click()`);
  await sleep(200);
  const b2 = await evalJs(`!document.getElementById('page-divine').hidden`);
  check('B2d 图标已被收起时点行仍能进占卜页', b2 === true, String(b2));

  // B3 #393 豁免：装修里显式把占卜加回桌面（pin=1）→ 不被强制收走，小字不谎报「已收起」
  await evalJs(`(function(){
    var ic=document.querySelector('.app[data-app="divination"]');
    var g=document.querySelector('.app-grid[data-app="main"]');
    if (g && ic && ic.parentNode !== g) g.appendChild(ic);
    window.activeStore().set('divination-desk-pin','1');
    document.dispatchEvent(new Event('decor-exited'));
    document.dispatchEvent(new Event('group-chat-mode-changed'));
    return 'ok';
  })()`);
  await sleep(200);
  const icon3 = await evalJs(ICON_STATE);
  const sub3 = await evalJs(SUB);
  check('B3a 装修固定过占卜（pin=1）：群聊开启期间图标仍留在桌面', icon3 === 'desk', String(icon3));
  check('B3b 此时小字不谎报「已收起」', !!sub3 && sub3.indexOf('已收起') < 0, String(sub3));

  // B4 关群聊：占卜图标回第一页、群聊图标收走、pin 被清、小字回「等效」
  await evalJs(`(function(){ window.xyStore('xy-home-v2').set('group-chat-enabled','0'); document.dispatchEvent(new Event('group-chat-mode-changed')); return 'ok'; })()`);
  await sleep(200);
  const icon4 = await evalJs(ICON_STATE);
  const gc4 = await evalJs(`(function(){ var g=document.querySelector('.app[data-app="group-chat"]'); return g? (g.closest('.app-grid')? 'desk':'pooled') : 'missing'; })()`);
  const pin4 = await evalJs(`String(window.activeStore().get('divination-desk-pin'))`);
  const sub4 = await evalJs(SUB);
  check('B4a 关闭群聊：占卜图标回桌面、群聊图标收走', icon4 === 'desk' && gc4 === 'pooled', icon4 + ' / ' + gc4);
  check('B4b 关闭群聊：装修固定标记被清除（恢复默认语义）', pin4 !== '1', String(pin4));
  check('B4c 关闭群聊：小字回「与点桌面图标等效」', !!sub4 && sub4.indexOf('等效') >= 0, String(sub4));

  check('全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const fails = results.filter(r => !r.ok);
console.log('----');
console.log('verify-open-divination-entry: ' + (results.length - fails.length) + '/' + results.length + ' 通过' + (fails.length ? '（存在 FAIL）' : ''));
process.exit(fails.length ? 1 : 0);

// ===== 验证脚本 #632 超大库「添加卡即 iOS 闪退」自动瘦身门 =====
// 用法：node build.mjs && node tools/verify-cc-auto-slim.mjs
//   需要：Node 21+（内嵌 fetch/WebSocket）、本机 Chrome/Edge（CHROME_PATH 可指定）
// 背景：字卡库单键可达 199MB（报障机 cc-groups-public 实测 199.31MB）。打开管理页会把整库
//   parse 成编辑树常驻，添加任意一张卡都要 JSON.stringify(整库) —— 解析树 + 原始串副本 + 新串
//   三份叠加，iOS WebKit 被 jetsam 杀掉＝「添加新的表情包/字卡就闪退」（其他机型大库同族）。
//   #632 在打开字卡库时按存储键体积自动检测，一次确认后运行 #554 迁移把库降到 MB 级。
// 断言口径：
//   A 组（静态，src）：阈值/入口/单遍扫描/体积检测/提示文案 五锚 + 迁移保险丝仍在
//   B 组（行为，无头真实产物）：
//     B1 小库（<阈值）打开字卡库＝零打扰（不弹瘦身门）、页面正常渲染；
//     B2 大库（>阈值）打开字卡库＝瘦身门自动弹出（标题正确）；
//     B3 点「确定」迁移后：存储键内容变 @@m: 令牌、体积大幅缩小、页面照常加载；
//     B4 令牌可解析（池数据在，不误报缺失）；
//     B5 零新增 JS 异常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
function J(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// ---- A 组：静态断言 ----
console.log('静态断言:');
const cc = read('src/js/chatcard.js');
J('A1 阈值常量在位（删则超大库判定失效）', cc.includes('const CC_BIG_SLIM_THRESHOLD = 16 * 1024 * 1024;'));
J('A2 瘦身门在 openCcPage 内被调用（删则不再自动瘦身）', cc.includes('maybeAutoSlimLib().then(function () {'));
J('A3 迁移单遍扫描 seenTok（删则 199MB 库迁移自身可能 OOM）', cc.includes('const seenTok = new Set();'));
J('A4 体积检测走 idbBigSize（删则只看内存态、挂起大库检测不到）', cc.includes('if (window.idbBigSize) n = Number(window.idbBigSize(fk)) || 0;'));
J('A5 瘦身确认标题在位', cc.includes("window.openModal('字卡库较大，先自动去重缩库？'"));
J('A6 迁移保险丝「不变小不写」仍在', cc.includes('if (!replaced || outStr.length >= raw.length) continue;'));

// ---- B 组：行为断言 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('\n未找到 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }
if (typeof WebSocket !== 'function') { console.log('\n需 Node 21+（内嵌 WebSocket）'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9980 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-cc-slim-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}
const modalTitle = `(function(){ var m=document.getElementById('modal-mask'); if(!m||m.hidden) return ''; var t=document.getElementById('modal-title'); return t?t.textContent:''; })()`;

try {
  await cdpConnect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 100; i++) { try { if (await evalJs('!!window.__mochiDataReady')) break; } catch (e) {} await sleep(200); }
  await sleep(800);

  // 抑制「自建字卡很少」提醒弹窗（与瘦身门同用全站唯一 modal，避免误判）
  await evalJs(`(function(){ try { var d=new Date(); var tk=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); window.activeStore().set('cc-lowcard-remind', tk); } catch(e){} return 1; })()`);

  // ---- B1 小库：零打扰 ----
  const small = await evalJs(`(function(){
    var lib = { text: [['问候', ['你好呀', '在吗']]], sticker: [], image: [], kaomoji: [], emoji: [], poke: [], voice: [] };
    var s = JSON.stringify(lib);
    window.xyStore('xy-home-v2').set('cc-groups-public', s);
    return s.length;
  })()`);
  await evalJs(`document.getElementById('li-custom-cards-public').click(); 1`);
  await sleep(1200);
  const tSmall = await evalJs(modalTitle);
  const pageShown = await evalJs(`(function(){ var p=document.getElementById('page-custom-cards'); return !!p && !p.hidden; })()`);
  const listHasCard = await evalJs(`(function(){ var l=document.getElementById('cc-list'); return !!l && l.textContent.indexOf('你好呀')>=0; })()`);
  J('B1 小库打开字卡库＝不弹瘦身门（' + small + 'B）', tSmall.indexOf('去重缩库') < 0);
  J('B1b 小库字卡页正常显示且内容渲染', pageShown && listHasCard);
  if (tSmall.indexOf('去重缩库') >= 0) console.log('  B1 现场: 误弹弹窗标题=' + tSmall);

  // 回到列表页再进（模拟用户再次打开）
  await evalJs(`document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); document.getElementById('page-phone').hidden=false; 1`);

  // ---- B2 大库：瘦身门自动弹出 ----
  const big = await evalJs(`(function(){
    var BIG = 'data:image/png;base64,' + new Array(18 * 1024 * 1024).join('A');
    var lib = { text: [['问候', ['你好呀']]], sticker: [['大图', [BIG]]], image: [], kaomoji: [], emoji: [], poke: [], voice: [] };
    var s = JSON.stringify(lib);
    window.xyStore('xy-home-v2').set('cc-groups-public', s);
    return { len: s.length, bigIdb: (window.idbBigSize ? window.idbBigSize('xy-home-v2:cc-groups-public') : 0) };
  })()`);
  await evalJs(`document.getElementById('li-custom-cards-public').click(); 1`);
  let tBig = '';
  for (let i = 0; i < 40; i++) { tBig = await evalJs(modalTitle); if (tBig.indexOf('去重缩库') >= 0) break; await sleep(150); }
  J('B2 大库（约 ' + Math.round((big.len || 0) / 1048576) + 'MB）打开字卡库＝瘦身门自动弹出', tBig.indexOf('去重缩库') >= 0);
  if (tBig.indexOf('去重缩库') < 0) console.log('  B2 现场: 标题=' + tBig + ' idbBigSize=' + (big && big.bigIdb));

  // ---- B3 点确定 → 迁移 → 键变令牌且大幅缩小、页面照常加载 ----
  await evalJs(`document.getElementById('modal-ok').click(); 1`);
  let after = null;
  for (let i = 0; i < 120; i++) {
    after = await evalJs(`(async function(){
      var raw = await window.idbGet('xy-home-v2:cc-groups-public');
      if (typeof raw !== 'string') { try { raw = window.xyStore('xy-home-v2').get('cc-groups-public'); } catch(e){} }
      if (typeof raw !== 'string') return null;
      var toks = (raw.match(/@@m:[0-9a-f]{32}/g) || []);
      return { len: raw.length, toks: toks.length, firstTok: toks[0] || '' };
    })()`);
    if (after && after.toks > 0 && after.len < 1024 * 1024) break;
    await sleep(300);
  }
  J('B3 迁移后存储键变 @@m: 令牌且体积大幅缩小', !!(after && after.toks >= 1 && after.len < 1024 * 1024));
  if (!(after && after.toks >= 1 && after.len < 1024 * 1024)) console.log('  B3 现场: ' + JSON.stringify(after));
  await sleep(500);
  const loadedBig = await evalJs(`(function(){ var p=document.getElementById('page-custom-cards'); var m=document.getElementById('modal-mask'); return { pageShown: !!p && !p.hidden, modalHidden: !m || !!m.hidden }; })()`);
  J('B3b 迁移后字卡页照常加载、瘦身弹窗已关', !!(loadedBig && loadedBig.pageShown && loadedBig.modalHidden));

  // ---- B4 令牌可解析（池数据在）----
  const tok = (after && after.firstTok) || '';
  const miss2 = await evalJs('window.mochiMediaTokenMissing(' + JSON.stringify(tok) + ')');
  J('B4 瘦身后的令牌可解析（池数据在，不误报缺失）', tok.indexOf('@@m:') === 0 && miss2 === false);

  // ---- B5 零新增 JS 异常 ----
  const errs = await evalJs(`(function(){ return (window.__jsErrors || []).map(function(e){ return (e && (e.msg || e.message)) || String(e); }); })()`);
  J('B5 全程零 JS 异常', Array.isArray(errs) && errs.length === 0);
  if (Array.isArray(errs) && errs.length) console.log('  B5 异常: ' + JSON.stringify(errs).slice(0, 300));
} catch (e) {
  console.log('\n❌ B 组执行异常：' + (e && e.message));
  fail++;
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

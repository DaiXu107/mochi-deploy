// ===== 验证 #291：桌面经期卡（desk-period）文字重叠修复 =====
// 用户报障（OPPO Reno6 5G + 雨见浏览器/Firefox152）：「经期组件文字有重叠」。
// 根因：160px 卡内 .dpd-inner 绝对定位 inset:0 垂直居中、无底部预留；底部周期进度条组
// （.dpd-bar-wrap bottom:10，含说明行 .dpd-bar-cap）是另一层绝对定位。居中列高度按浏览器
// 默认行高计算：Chrome 擦边幸免，Gecko 系默认行高更高 → dpd-sub 尾边越过 cap 顶边＝叠字。
// 修复＝.dpd-inner padding-bottom:26px + .dpd-label/.dpd-sub 显式 line-height:1.25。
// 本脚本在 360×800 无头 Chrome 实测 dpd-sub 底边与 dpd-bar-cap 顶边几何间距：
// 修复前同环境为负距/≈0（脚本有牙）；另加压 line-height:1.6 !important 模拟 Gecko 高行高，
// 以及「进度条隐藏态内容不溢出卡底」护栏。用法：node tools/verify-period-desk-card.mjs（需先 node build.mjs，需本机 Chrome/Edge）。
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-period-desk-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: String(r.exceptionDetails.text || '') };
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 3, mobile: true });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(800);
await ev("(function(){var t=document.querySelector('.tab[data-page=\\\"page-phone\\\"]');if(t)t.click();return true;})()");
await sleep(300);

// 几何量测：临时显示进度条组（量完还原），取 dpd-sub 底边与 dpd-bar-cap 顶边间距
const MEASURE = `(function(){
  var card=document.querySelector('[data-desk-widget="desk-period"]');
  if(!card) return {err:'no-card'};
  if(!card.getBoundingClientRect().height){
    var slide=card.closest('.page-slide');
    if(slide&&slide.scrollIntoView){try{slide.scrollIntoView({block:'nearest',inline:'center'});}catch(e){slide.scrollIntoView();}}
  }
  var wrap=card.querySelector('.dpd-bar-wrap');
  if(!wrap) return {err:'no-barwrap'};
  var wasHidden=wrap.hidden; wrap.hidden=false;
  var cap=card.querySelector('.dpd-bar-cap');
  if(cap&&!cap.textContent) cap.textContent='周期第 12/28 天';
  var sub=document.getElementById('dpd-sub');
  var r1=sub.getBoundingClientRect(),r2=cap.getBoundingClientRect(),r3=card.getBoundingClientRect();
  wrap.hidden=wasHidden;
  return {gap:+(r2.top-r1.bottom).toFixed(1),subBottom:+r1.bottom.toFixed(1),capTop:+r2.top.toFixed(1),cardH:+r3.height.toFixed(1),subText:sub.textContent};
})()`;

const m1 = await ev(MEASURE);
check('A1 经期卡可见且量到几何（无头环境准备）', m1 && !m1.err && m1.cardH > 0, JSON.stringify(m1));
check('A2 正常行高下 dpd-sub 与进度条说明不叠（间距≥4px；修复前同环境为负距＝叠字）', m1 && !m1.err && m1.gap >= 4, 'gap=' + (m1 && m1.gap));

await ev("(function(){var s=document.createElement('style');s.id='v291-lh';s.textContent='.desk-period .dpd-label,.desk-period .dpd-sub{line-height:1.6 !important}';document.head.appendChild(s);return true;})()");
await sleep(120);
const m2 = await ev(MEASURE);
check('A3 模拟 Gecko 高行高（1.6 加压）下仍不叠（间距≥2px）', m2 && !m2.err && m2.gap >= 2, 'gap=' + (m2 && m2.gap));
await ev("(function(){var s=document.getElementById('v291-lh');if(s)s.remove();return true;})()");

const m3 = await ev(`(function(){
  var card=document.querySelector('[data-desk-widget="desk-period"]');
  var wrap=card.querySelector('.dpd-bar-wrap'); wrap.hidden=true;
  var sub=document.getElementById('dpd-sub');
  var r1=sub.getBoundingClientRect(),r3=card.getBoundingClientRect();
  return {over:+(r1.bottom-r3.bottom).toFixed(1),cardH:+r3.height.toFixed(1)};
})()`);
check('A4 进度条隐藏态内容不溢出卡底（sub 底边≤卡底）', m3 && !m3.err && m3.over <= 0, 'over=' + (m3 && m3.over));

const prod = readFileSync(join(root, 'index.html'), 'utf8');
check('A5 产物含 dpd-inner 底部预留锚（padding-bottom:26px）', prod.indexOf('padding-bottom:26px') >= 0, '');
check('A6 产物含 dpd-label/dpd-sub 显式行高 1.25', prod.indexOf('.desk-period .dpd-label { font-size:13px; line-height:1.25;') >= 0 && prod.indexOf('.desk-period .dpd-sub { font-size:13px; line-height:1.25;') >= 0, '');

console.log('\n===== 汇总 =====');
const fails = results.filter(r => !r.ok);
console.log('PASS ' + (results.length - fails.length) + ' / ' + results.length + (fails.length ? '，失败 ' + fails.length + ' 项' : ''));
try { server.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(fails.length ? 1 : 0);

// ===== 回归脚本：屏幕适配微调面板对齐「边看边调」口径（#940）=====
// 背景（用户报障 2026-09-20）：「屏幕适配微调」不是和边看边调一样半透明的，而且不能拖动滑动，
//   不能预览其他页面。根因＝#764 新建该面板时没复用美化抽屉沉淀的三个口径：
//   ① #562 半透明底（它是 62vh 不透明整块）；② #760 bindDockDrag 拖动近底吸附（grip 纯装饰）；
//   ③ 收起成一条（贴底盖死 tabbar 切不了页）。
// 修法：src/js/personalize.js 面板底色 color-mix 72% 半透明＋纯色回落、max-height 40vh；
//   grip＋标题行 pointer 拖动（按钮让行、setPointerCapture 防内核抢滚动、会话内记忆不落盘）；
//   「收起」把面板收成小胶囊，即可点 tabbar 切任意页面看现场。
// #962（2026-09-21）沿用并收口：收起＝小胶囊（原来只折正文、外壳仍横贯底边 70px 高照样盖住
//   底部导航）、吸附目标由「贴底 0」改为「底部导航/输入栏之上」、胶囊自己可拖（展开态把手在
//   胶囊态不参与），故 B3/B5/B6/B8 的判定按新形态写；「只能设置里盲调」的行为面另见
//   tools/verify-957-screen-adj-entry.mjs。本脚本红侧（纯 HEAD）应红 B2/B3/B4/B5/B6，Z 两侧同绿。
// 用法：node build.mjs && node tools/verify-screen-adj-drawer.mjs
//      SERVE_ROOT=<隔离构建目录> 跑红绿对照
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end(); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9870 + Math.floor(Math.random() * 100);
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-adj-drawer-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=390,844',
  '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') jsErrors++; };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
const J = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}var m=document.getElementById('modal-mask');if(m){m.hidden=true;m.style.display='none';}return true;})()");
await sleep(400);
// 进设置页（与 verify-settings-tags 同法：直接切页面可见性，不依赖 tabbar 动画）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});return true;})()");
await sleep(200);

const openPanel = "(function(){var r=document.getElementById('row-screen-adj');if(!r)return 'norow';r.click();var p=document.getElementById('screen-adj-panel');return p?'open':'noclick';})()";

// B0 前置：入口行在位、点了能开面板
ok((await evalJs(openPanel)) === 'open', 'B0 设置页入口点开「屏幕适配微调」面板');

// B1 半透明底＋40vh（#562 口径）：cssText 经 CSSOM 序列化会补空格，先剥空白再比对；
// 「老内核纯色回落」＝同名 background 前一条，被 CSSOM 解析覆盖后无法回读，取源码文本断言
// （产物侧形态由 #940a 哨兵逐字钉死）。
const b1 = J(await evalJs("(async function(){var p=document.getElementById('screen-adj-panel');if(!p)return null;var cs=p.style.cssText.replace(/\\s+/g,'');var src=await (await fetch('js/personalize.js')).text();return JSON.stringify({mix:cs.indexOf('color-mix(insrgb,var(--card-bg,#fff)72%,transparent)')>=0,vh40:cs.indexOf('max-height:40vh')>=0,fallback:src.indexOf('background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent)')>=0});})()"));
ok(b1 && b1.mix && b1.fallback, 'B1a 底色半透明 color-mix 72%（含老内核纯色回落，源码形态）', JSON.stringify(b1));
ok(b1 && b1.vh40, 'B1b 高度上限 40vh（原 62vh 挡住大半屏）', JSON.stringify(b1));

// 拖动辅助：向标题行派发 pointer 序列（setPointerCapture 对合成事件抛错已被 try 吞掉，不影响）
const dragTo = (dy) => `(function(){var p=document.getElementById('screen-adj-panel');var hd=p.children[1];var r=hd.getBoundingClientRect();var x=r.left+r.width/2,y=r.top+r.height/2;
function fire(t,yy){var e=new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',clientX:x,clientY:yy,isPrimary:true});hd.dispatchEvent(e);}
fire('pointerdown',y);fire('pointermove',${dy < 0 ? '(y' + (dy >= 0 ? '+' : '-') + String(Math.abs(dy)) + ')' : 'y'});fire('pointerup',y);return p.style.bottom;})()`;

// B2 拖标题行上移 200px → 面板 bottom ＝ 起点（自动让位位 ≈90px）＋200
const b2 = await evalJs(dragTo(-200));
ok(parseFloat(b2) >= 280, 'B2 拖标题行面板上移（bottom 比自动位高 ~200px）', 'got=' + b2);

// B3 吸附：从高处拖回「底部操作区以内」→ 吸附回自动位（让开底部导航/输入栏）
//  #962 起吸附目标由「贴底 0」改为「底部导航/输入栏之上」（量出来的留白），故按自动位判定
const b3b = await evalJs("(function(){var p=document.getElementById('screen-adj-panel');var hd=p.children[1];var r=hd.getBoundingClientRect();var x=r.left+r.width/2,y=r.top+r.height/2;function fire(t,yy){hd.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:8,pointerType:'touch',clientX:x,clientY:yy,isPrimary:true}));}fire('pointerdown',y);fire('pointermove',y+285);var mid=p.style.bottom;fire('pointerup',y+285);return JSON.stringify({start:r.top,mid:mid,end:p.style.bottom});})()");
const b3j = J(b3b);
ok(b3j && parseFloat(b3j.mid) <= 20 && parseFloat(b3j.end) >= 80, 'B3 拖回底部操作区（低于自动位）自动吸附回让位位', b3b);

// B4 收起 → 收成一枚小胶囊（#962 前只折正文区、外壳仍横贯底边），面板高度骤降
const b4 = J(await evalJs("(function(){var p=document.getElementById('screen-adj-panel');var btns=p.querySelectorAll('button');var fold=null;btns.forEach(function(b){if(b.textContent==='收起')fold=b;});if(!fold)return JSON.stringify({nofold:1});var h0=p.getBoundingClientRect().height;fold.click();var h1=p.getBoundingClientRect().height;var m=p.querySelector('[data-adj-mini]');return JSON.stringify({h0:Math.round(h0),h1:Math.round(h1),pill:!!m&&m.style.display!=='none'});})()"));
ok(b4 && !b4.nofold && b4.h1 < 90 && b4.h1 < b4.h0 * 0.4, 'B4 收起后缩成小胶囊（面板高度骤降）', JSON.stringify(b4));
ok(b4 && b4.pill === true, 'B5 收起态是小胶囊（点开合的把手就位）', JSON.stringify(b4));
// B5b 点胶囊展开（#962 起没有「展开」按钮，胶囊本身就是展开入口）
ok(await evalJs("(function(){var p=document.getElementById('screen-adj-panel');var m=p.querySelector('[data-adj-mini]');if(!m)return 'no';m.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:11,pointerType:'touch'}));m.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:11,pointerType:'touch'}));return p.getBoundingClientRect().height>200?'grow':'flat';})()") === 'grow', 'B5b 点胶囊展开恢复正文区');

// B6 收起后再上移 → tabbar 露出可点（用户核心诉求「不能预览其他页面」）
//  #962 起胶囊自己可拖（展开态把手在胶囊态不参与），故拖动对象是胶囊
const b6b = await evalJs("(function(){var mk=document.getElementById('modal-mask');if(mk){mk.hidden=true;mk.style.display='none';}var p=document.getElementById('screen-adj-panel');var fold=null;p.querySelectorAll('button').forEach(function(b){if(b.textContent==='收起')fold=b;});if(fold)fold.click();var m=p.querySelector('[data-adj-mini]');var r=m.getBoundingClientRect();var x=r.left+r.width/2,y=r.top+r.height/2;function fire(t,yy){m.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:9,pointerType:'touch',clientX:x,clientY:yy,isPrimary:true}));}fire('pointerdown',y);fire('pointermove',y-300);fire('pointerup',y-300);var tb=document.querySelector('.tab[data-page=\"page-phone\"]');var tr=tb.getBoundingClientRect();var hit=document.elementFromPoint(Math.round(tr.left+tr.width/2),Math.round(tr.top+tr.height/2));return JSON.stringify({bottom:p.style.bottom,tabFree:!!hit&&!p.contains(hit)});})()");
const b6j = J(b6b);
ok(b6j && parseFloat(b6j.bottom) >= 380 && b6j.tabFree, 'B6 胶囊上移后 tabbar 不再被面板盖住（可点）', b6b);
const b7 = await evalJs("(function(){var tb=document.querySelector('.tab[data-page=\"page-phone\"]');tb.click();var ph=document.getElementById('page-phone');var p=document.getElementById('screen-adj-panel');return JSON.stringify({phone:!!ph&&!ph.hidden,panel:!!p});})()");
const b7j = J(b7);
ok(b7j && b7j.phone && b7j.panel, 'B7 面板开着即可切到桌面页看适配现场（面板不消失）', b7);

// B8 会话内记忆：点「完成」关掉再重开，拖动落位还在（面板是重建的，靠模块内记的落位抹回）
const b8 = await evalJs("(function(){var p=document.getElementById('screen-adj-panel');var done=null;p.querySelectorAll('button').forEach(function(b){if(b.textContent==='完成')done=b;});done.click();document.getElementById('page-setting').hidden=false;document.getElementById('page-phone').hidden=true;document.getElementById('row-screen-adj').click();var p2=document.getElementById('screen-adj-panel');return p2?p2.style.bottom:'gone';})()");
ok(parseFloat(b8) >= 380, 'B8 关闭重开会话内拖动落位仍在（bottom 保持 ≥380px）', 'got=' + b8);

// B9 滑杆核心链路未回归：拖顶部轴→mochiScreenAdj 值写入
const b9 = J(await evalJs("(function(){var sl=document.querySelector('#screen-adj-panel [data-adj-slider=\"top\"]');sl.value='5';sl.dispatchEvent(new Event('input',{bubbles:true}));var v=window.mochiScreenAdj.all().top;sl.value='0';sl.dispatchEvent(new Event('input',{bubbles:true}));return JSON.stringify({v:v,back:window.mochiScreenAdj.all().top});})()"));
ok(b9 && b9.v === 5 && b9.back === 0, 'B9 滑杆即时写入 mochiScreenAdj（原能力零回归）', JSON.stringify(b9));

// Z 零未捕获 JS 异常
ok(jsErrors === 0, 'Z 全程零未捕获 JS 异常', 'errors=' + jsErrors);

console.log(`\n${pass} PASS / ${fail} FAIL`);
try { ws.close(); } catch (e) {}
chrome.kill();
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

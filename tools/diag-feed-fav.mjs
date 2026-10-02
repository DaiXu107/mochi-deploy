// ===== 临时诊断：朋友圈收藏按钮点击是否生效 =====
// 用完即删。用法：node tools/diag-feed-fav.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
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
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-diag-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const consoleErrs = [];
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
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            consoleErrs.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
          }
          if (m.method === 'Runtime.exceptionThrown') {
            consoleErrs.push('EXC: ' + (m.params.exceptionDetails && m.params.exceptionDetails.text) + ' ' + ((m.params.exceptionDetails && m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || ''));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('no cdp');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r && r.result ? { val: r.result.value } : { val: null };
  } catch (e) { return { err: String(e) }; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { const r = await ev('!!window.__mochiDataReady'); if (r.val) break; await sleep(300); }
await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(900);

// 发一条动态
const addRes = await ev("window.feedAddPost ? (window.feedAddPost('收藏按钮测试动态内容', [])||'null') : 'no-fn'");
console.log('feedAddPost =>', JSON.stringify(addRes));

// 打开朋友圈页（点桌面图标）
const openRes = await ev("(function(){var a=document.querySelector('.app[data-app=\"feed\"]');if(!a){var pages=document.querySelectorAll('.page');return 'no-app-icon pages='+pages.length;}a.click();return 'clicked';})()");
console.log('openFeed =>', JSON.stringify(openRes));
await sleep(800);

const pageState = await ev("(function(){var fp=document.getElementById('page-feed');var list=document.getElementById('feed-list');var btns=document.querySelectorAll('.feed-act[data-fav]');var btn=btns[0];return JSON.stringify({pageHidden:fp?fp.hidden:null,cards:list?list.children.length:null,favBtns:btns.length,firstBtn:btn?btn.outerHTML.slice(0,120):null});})()");
console.log('pageState =>', pageState.val);

// 点击第一个收藏按钮
const clickRes = await ev("(function(){var b=document.querySelector('.feed-act[data-fav]');if(!b)return 'no-btn';var pid=b.dataset.fav;b.click();return 'clicked pid='+pid;})()");
console.log('click =>', JSON.stringify(clickRes));
await sleep(400);

// 检查收藏结果
const favRes = await ev("(function(){var s=window.activeStore?window.activeStore():null;if(!s)return 'no-activeStore';var raw=s.get('fav-msgs');var fav=[];try{fav=JSON.parse(raw||'[]');}catch(e){}var feeds=fav.filter(function(f){return (f.kind||'')==='feed';});var toast=document.getElementById('cc-toast');return JSON.stringify({favTotal:fav.length,feedFav:feeds.length,feedSample:feeds[0]?{text:feeds[0].text,ts:feeds[0].ts,by:feeds[0].by}:null,toast:toast?toast.textContent:null});})()");
console.log('fav =>', favRes.val);

// 命中测试：真实指针坐标点到的元素是不是按钮本身（防遮挡）
const hitRes = await ev("(function(){var b=document.querySelector('.feed-act[data-fav]');if(!b)return 'no-btn';var r=b.getBoundingClientRect();var el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);return JSON.stringify({btnClass:el&&el.className&&String(el.className),isBtn:!!(el&&el===b),rect:{l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}});})()");
console.log('hitTest =>', hitRes.val);

// 截图动作栏区域
const actRect = await ev("(function(){var a=document.querySelector('.feed-actions');var r=a.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});})()");
const act = JSON.parse(actRect.val || '{}');
await cdp('Page.captureScreenshot', { format: 'png', clip: { x: act.x, y: act.y, width: act.w, height: act.h, scale: 2 } }).then((r) => {
  writeFileSync(join(root, 'tools', 'feed-actions-before.png'), Buffer.from(r.data, 'base64'));
});
console.log('screenshot saved', actRect.val);

// 测量三个动作按钮 SVG 图形在 24x24 viewBox 中的包围盒（用于图标垂直对齐）
const bboxRes = await ev("(function(){var out={};document.querySelectorAll('.feed-actions .feed-act').forEach(function(btn){var svg=btn.querySelector('svg');var p=svg.querySelector('path');var vb=svg.viewBox.baseVal;var bb=p.getBBox();out[btn.textContent.trim()]={x:Math.round(bb.x*10)/10,y:Math.round(bb.y*10)/10,w:Math.round(bb.width*10)/10,h:Math.round(bb.height*10)/10,centerY:Math.round((bb.y+bb.height/2)*10)/10,vbCenter:vb.y+vb.height/2,align:getComputedStyle(btn).alignItems,disp:getComputedStyle(btn).display};});return JSON.stringify(out);})()");
console.log('bbox =>', bboxRes.val);

// 再点一次（去重 + 高亮态）
const click2 = await ev("(function(){var b=document.querySelector('.feed-act[data-fav]');if(!b)return 'no-btn';b.click();return 'clicked2';})()");
await sleep(300);
const favedRes = await ev("(function(){var b=document.querySelector('.feed-act[data-fav]');var toast=document.getElementById('cc-toast');return JSON.stringify({className:b?b.className:null,filled:b?b.querySelector('svg').getAttribute('fill'):null,toast:toast?toast.textContent:null});})()");
console.log('after2ndClick =>', favedRes.val);

// 全部朋友圈页
const allRes = await ev("(function(){var av=document.querySelector('.feed-head-av');if(!av)return 'no-av';av.click();return 'opened-all';})()");
console.log('openAll =>', JSON.stringify(allRes));
await sleep(700);
const allState = await ev("(function(){var al=document.getElementById('feed-all-list');var btns=al?al.querySelectorAll('.feed-act[data-fav]'):[];return JSON.stringify({allVisible:document.getElementById('page-feed-all')?document.getElementById('page-feed-all').hidden:null,cards:al?al.children.length:null,favBtns:btns.length});})()");
console.log('allState =>', allState.val);
if (allState.val && JSON.parse(allState.val).favBtns > 0) {
  const allClick = await ev("(function(){var b=document.querySelector('#feed-all-list .feed-act[data-fav]');var pid=b.dataset.fav;b.click();return 'clicked-all pid='+pid;})()");
  await sleep(300);
  const allFav = await ev("(function(){var s=window.activeStore();var fav=[];try{fav=JSON.parse(s.get('fav-msgs')||'[]');}catch(e){}var toast=document.getElementById('cc-toast');return JSON.stringify({feedFav:fav.filter(function(f){return (f.kind||'')==='feed';}).length,toast:toast?toast.textContent:null});})()");
  console.log('allClick =>', JSON.stringify(allClick), 'allFav =>', allFav.val);
}

console.log('consoleErrs =>', JSON.stringify(consoleErrs, null, 2));
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(0);

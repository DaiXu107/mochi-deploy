// ===== 验证脚本：开屏滚动容器（.splash-box / .splash-mandatory-scroll）高度与可滚性 =====
// 用户连续报「iPhone13 Safari 总卡卡 / 开屏划不动」，跨机型。根因假设：开屏加载早期
// .phone 高度瞬态（--mochi-ios-h 未写入或写错）不会影响 .splash（position:fixed 满屏），
// 但需实证两个滚动容器在任意视口下 clientHeight>0、overflow-y 生效、可滚动（有溢出）。
// 无头 Chrome 按 390×844 / 360×640 / 844 窄屏 检查。
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp','mochi-splash-'+Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i=0;i<60;i++){ try {
    const list = await (await fetch('http://127.0.0.1:'+cdpPort+'/json')).json();
    const page = list.find((t)=>t.type==='page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
      ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}}; return; }
  } catch(e){} await sleep(150); }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params={}){ const id=++msgId; return new Promise((res)=>{pend.set(id,res); ws.send(JSON.stringify({id,method,params}));}); }
async function evalJs(expr){ try{ const r=await cdp('Runtime.evaluate',{expression:expr,returnByValue:true}); if(r&&r.exceptionDetails)return null; return r&&r.result?r.result.value:null; }catch(e){return null;} }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail){ results.push({desc,ok:!!ok}); console.log((ok?'PASS':'FAIL')+'  '+desc+(detail?'  ['+detail+']':'')); }

async function runViewport(w, h) {
  await cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});
  // 加载完成后、数据就绪前（开屏早期瞬态）立刻采样一次
  await cdp('Page.navigate',{url:baseUrl+'/index.html'});
  await sleep(800);
  const early = JSON.parse(await evalJs("(function(){function box(el){var r=el.getBoundingClientRect();var cs=getComputedStyle(el);var ov=cs.overflowY;var sH=el.scrollHeight,cH=el.clientHeight;return {ch:Math.round(cH),sh:Math.round(sH),top:Math.round(r.top),bot:Math.round(r.bottom),ov:ov,overflow:sH>cH+1};}var sb=document.getElementById('splash-box');var sm=document.getElementById('splash-mandatory-scroll');var M=box(sb);var N=sm?box(sm):null;return JSON.stringify({innerH:innerHeight,sb:M,sm:N});})()") || '{}');
  check(w+'x'+h+' 开屏加载早期 splash-box 有正高度', early.sb && early.sb.ch > 50, JSON.stringify(early));
  check(w+'x'+h+' 开屏加载早期 splash-box overflow-y 生效', early.sb && (early.sb.ov==='auto'||early.sb.ov==='scroll'), early.sb&&early.sb.ov);

  // 等待数据就绪 + 公告渲染后采样一次（2026-10-01 #1536 同批收口：原「强制公告容器/滚动容器」三断言随
  //   d88075d「开屏改1页」退役——#splash-mandatory 独立容器已删，强制公告内容并入第一页底部由 .splash-box
  //   统一滚动（overflow 断言由上面 splash-box 两条承担），纯 origin/main 副本实测同红＝存量债非本批引入）
  await sleep(3000);
  const mid = JSON.parse(await evalJs("(function(){function box(el){if(!el)return null;var r=el.getBoundingClientRect();var cs=getComputedStyle(el);return {ch:Math.round(el.clientHeight),sh:Math.round(el.scrollHeight),top:Math.round(r.top),bot:Math.round(r.bottom),ov:cs.overflowY,overflow:el.scrollHeight>el.clientHeight+1};}var sb=document.getElementById('splash-box');return JSON.stringify({innerH:innerHeight,sb:box(sb)});})()") || '{}');
  check(w+'x'+h+' 渲染完成后 splash-box 仍正高度且可滚（并入的强制公告内容超视口）', mid.sb && mid.sb.ch > 50 && mid.sb.overflow === true, mid.sb?('sh='+mid.sb.sh+' ch='+mid.sb.ch):'');
}

for (const [w,h] of [[390,844],[360,640]]) { try{ await runViewport(w,h); }catch(e){ console.error('视口 '+w+'x'+h+' 异常: '+e); } }

try{ if(ws)ws.close(); }catch(e){}
try{ chrome.kill(); }catch(e){}
try{ server.close(); }catch(e){}
const fails = results.filter((r)=>!r.ok).length;
console.log('\n结果：'+(results.length-fails)+'/'+results.length+' 项通过');
process.exit(fails?1:0);
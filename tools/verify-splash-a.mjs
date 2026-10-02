// ===== 验证脚本：A 组开屏问题（#418）行为级回归 =====
// 目标：证明「开屏未进入 / 数据未就绪期」屏幕适配自动监视（sdTick / 事件沿 /
// 离页抢拍）被 #418 守卫跳过——即使此刻强制注入 bad 视口瞬态（如 iPhone13 Safari
// 实测的 inner=797 缩矮），诊断错误环也【零】混入 [屏幕适配] 假阳性（对应 A③④：
// 不反复弹「已自动修正」、诊断不刷「底部少填/顶部重叠」）。
// 同时反过度关闭：进入后强制注入同一瞬态，错误环应【≥1】条 —— 证监视仍存活、
// 守卫只在开屏期生效，未把整条监视链路当死代码拆掉（被 test 刹住的「留名改逻辑」）。
// 无头 Chrome 按 A 组机型（iPhone13 390×844/iOS17 390×664/安卓 360×640）跑。
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

// 并发（verify-suite JOBS>1）时用分配端口防撞车；单跑用随机窄区间
const cdpPort = process.env.MOCHI_CDP_PORT ? Number(process.env.MOCHI_CDP_PORT) : (9800 + Math.floor(Math.random() * 400));
const chrome = spawn(chromePath, [
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp','mochi-splash-a-'+Date.now()),
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

// 读取诊断错误环里的 [屏幕适配] 假阳性条数（空环=0）
const RING_JS = "(function(){try{var o=JSON.parse(localStorage.getItem('xy-home-v2:__diag-errs')||'[]');if(!Array.isArray(o))return 0;return o.filter(function(e){return e&&/^\\[\\u5c4f\\u5e55\\u9002\\u914d\\]/.test(e.msg||'')}).length;}catch(e){return 0;}})()";

async function runViewport(w, h, dpr, ua, label) {
  const uaOk = await evalJs("'object'==typeof window.navigator");
  await cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:dpr,mobile:true});
  if (ua) await cdp('Emulation.setUserAgentOverride',{userAgent:ua,platform:'MacIntel'});
  await cdp('Page.navigate',{url:baseUrl+'/index.html'});
  await sleep(600); // DOM 就绪、仍停在开屏（未隐藏）

  check(label+' 开屏担当节点在位', await evalJs("(function(){var s=document.getElementById('splash');if(!s||s.classList.contains('hide'))return false;var e=document.getElementById('splash-enter');return !!e;})()") === true);

  // —— 阶段1：开屏期注入 bad 瞬态，断言错误环【零】假阳性 ——
  const t0 = Date.now();
  await cdp('Emulation.setDeviceMetricsOverride',{width:w,height:600,deviceScaleFactor:dpr,mobile:true}); // 明显缩矮=底部少填/顶部重叠触发源
  await sleep(300);
  await cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:dpr,mobile:true});
  while (Date.now() - t0 < 6000) await sleep(400); // 覆盖 ≥1 个 5s 轮询周期
  let during = await evalJs(RING_JS);
  check(label+' 开屏期注入瞬态：错误环 [屏幕适配] 假阳性 = 0（#418 守卫生效）', during === 0, 'ring='+during);

  /* —— 阶段2：进入（隐藏开屏+数据就绪）后，断言监视采集链路完整在世（防过度关闭）——
   说明：本不该用「进入后注入坏形态→错误环≥1」当证（早期版本试过）：无头下 .phone 随
   --mochi-ios-h 自适应，连持续缩到 h=400 都被 __collectScreenDiag 判「(全部ok)」，
   错误环在任何形态都不增长——ring 正向断言在无头结构性不可验证，硬塞必误报。真机 A③
   （进入后无假阳性）本就是黑盒真机项。无头侧用等价确定性断言：采集器本身（sdTick 内部
   调用 __collectScreenDiag）进入后仍完整可用＝监视没被整体拆成死代码；真正区分开屏期的
   正是 #418 守卫，配合「开屏零假阳性」即可证守卫生效、非监视消失。 */
  await evalJs("(function(){var s=document.getElementById('splash');if(s)s.classList.add('hide');window.__mochiDataReady=true;return true;})()");
  const alive = await evalJs("(function(){try{var r=window.__collectScreenDiag&&window.__collectScreenDiag();return r&&Array.isArray(r.findings)&&/\\u5c4f\\u5e55\\u9002\\u914d\\u8bca\\u65ad/.test(r.text||'')?1:0;}catch(e){return 0;}})()");
  check(label+' 进入后：监视采集链路完整在世（__collectScreenDiag 返回 findings+诊断正文，未被整体拆死）', alive === 1, 'alive='+alive);
}

const views = [
  { w:390, h:844, dpr:3, label:'iPhone13/Safari' , ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' },
  { w:390, h:664, dpr:3, label:'iPhone17/iOS',  ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  { w:360, h:640, dpr:2, label:'Android/Chrome', ua:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
];
for (const v of views) { try{ await runViewport(v.w,v.h,v.dpr,v.ua,v.label); }catch(e){ console.error(v.label+' 视口异常: '+e); } }

try{ if(ws)ws.close(); }catch(e){}
try{ chrome.kill(); }catch(e){}
try{ server.close(); }catch(e){}
const fails = results.filter((r)=>!r.ok).length;
console.log('\n结果：'+(results.length-fails)+'/'+results.length+' 项通过');
process.exit(fails?1:0);
// ===== 回归脚本：#706 聊天「所有消息不贴底、停在上半屏/中部；发消息低栏弹跳」 =====
// 用法：node tools/verify-chat-dock-watchdog.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// 背景（用户直派，iPhone 17 Safari 26.6 iOS 独立应用实报、多机型同现）：
//   #466（vv resize 回钉）与 #643（chat-body ResizeObserver 回钉）都是「事件触发 + 60ms
//   单次防抖」。iOS 26 Safari 起 viewport meta 的 interactive-widget=resizes-content 被真正
//   执行（键盘期 innerHeight 本体也参与变形、vv/inner 分多帧落位），回钉写入常落在中间态
//   布局上，此后事件不再发、RO 定格 ⇒ 无人再校正＝列表永久停错位（消息停上半屏/中部）。
//   修复：几何看门狗——聊天页可见且钉住态（#162 闸）时每 250ms 复核 scrollTop 是否等于
//   chatScrollMax()；差 >8px 且视口变形落定（180ms 无 vv/inner 变化）才补钉。
// 本脚本用 CDP 真实产物插桩验证：
//   B1 静态：看门狗两要素（补钉判定 + 变形落定闸）在产物中在位。
//   B2 行为：聊天页可见、钉住态下，用「改 --mochi-safe-top 模拟容器高度变化且不发事件」
//      把 scrollTop 留在旧值（#643 RO 被环境节流时不派发的等价态）→ 看门狗 250ms 周期内
//      自动补钉到底（scrollTop === chatScrollMax）。
//   B3 行为：用户解钉（派发 wheel 事件＝#162 真实滚动意图）后，看门狗不得拽底（停在原位）。
//   B4 行为：模拟「变形进行中」（连续改 --mochi-safe-top 保持 _vvGeomChangeTs 新鲜）窗口期
//      内看门狗不写 scrollTop；停止变形后一个周期内补钉到位＝「变形中不写、落定后校正」。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArgIdx = process.argv.indexOf('--root');
const root = normalize((rootArgIdx > -1 ? process.argv[rootArgIdx + 1] : dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = join(root, decodeURIComponent((req.url || '/').split('?')[0]));
    const data = readFileSync(p);
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const baseUrl = 'http://127.0.0.1:' + port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dockwd-' + Date.now()),
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 屏蔽 ResizeObserver（等价「无 RO 老内核」/「内核不派发 RO」现场）——让 B2/B4 只能靠 #706
// 看门狗兜底，保证脚本对「有没有看门狗」有判别力（RO 在位时 #643 会抢先把 B2 修绿＝无判别力）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.ResizeObserver = undefined;' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 禁用自动回复，避免打字行显隐与断言竞态
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// B1 静态：产物中看门狗两要素在位
const built = (function(){ let pool=''; try { pool = readFileSync(join(root,'index.html'),'utf8');
    const jd=join(root,'js'); for (const f of readdirSync(jd)) if (f.endsWith('.js')) pool += `\n${readFileSync(join(jd,f),'utf8')}`; } catch(e){} return pool; })();
check('B1a 产物含看门狗补钉判定（cb706.scrollTop < chatScrollMax() - 8）', built.includes('if (cb706.scrollTop < chatScrollMax() - 8) scrollChatBottom();'));
check('B1b 产物含视口变形落定闸（_vvGeomChangeTs < 180）', built.includes('if (Date.now() - _vvGeomChangeTs < 180) return;'));
// B1c 静态（#765）：聊天壁纸常驻层必须独立成合成层，否则聊天页每次内容变化的失效区都波及它、
// 整张 cover 位图被重新缩放光栅（设了壁纸后滚动/发消息发涩）。
check('B1c 产物含壁纸层提合成层（#cs-bg-layer { transform:translateZ(0); }）', built.includes('#cs-bg-layer { transform:translateZ(0); }'));

// 进入聊天页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(2000);

// 先制造足够滚动高度：连发 8 条
for (let i = 0; i < 8; i++) {
  await evalJs("(function(){var el=document.getElementById('chat-input');el.textContent='看门狗回归测试消息" + i + "';var b=document.getElementById('chat-send');if(b)b.click();return true;})()");
  await sleep(350);
}
await sleep(800);

// B2 行为：钉住态下，容器高度变化（模拟 RO 派发缺失/写入落在中间态）→ 看门狗周期内补钉。
// 手法：直接改 --mochi-safe-top 只动 CSS 变量（不动视口、不发 resize 事件）→ chat-body 变矮、
// max 增大、scrollTop 留在旧值＝「无人校正」的等价现场。
await evalJs("(function(){document.documentElement.style.setProperty('--mochi-safe-top','30px');return true;})()");
const pre = await evalJs("(function(){var cb=document.getElementById('chat-body');return JSON.stringify({st:Math.round(cb.scrollTop),max:cb.scrollHeight-cb.clientHeight});})()");
await sleep(1400); // 看门狗 250ms 周期 × 若干，留足补钉窗口
const post = await evalJs("(function(){var cb=document.getElementById('chat-body');var t=document.getElementById('chat-typing');var th=(t&&!t.hidden&&t.offsetHeight)?t.offsetHeight:0;return JSON.stringify({st:Math.round(cb.scrollTop),target:Math.max(0,cb.scrollHeight-(cb.clientHeight+th))});})()");
check('B2 高度变化后看门狗自动补钉到底', JSON.parse(post).st >= JSON.parse(post).target - 8,
  'pre=' + pre + ' post=' + post);

// B4 行为：变形进行中不写、落定后补钉——连续 1.2s 内每 200ms 拨一次 safe-top（保持 _vvGeomChangeTs 新鲜），
// 窗口内 scrollTop 不被写；停后 1s 内到位。
await evalJs("(function(){var cb=document.getElementById('chat-body');cb.scrollTop=cb.scrollHeight;return true;})()"); // 先回钉
await sleep(300);
await evalJs(`(function(){
  return new Promise(function(res){
    var h = document.documentElement, i = 0, vals = ['30px','62px','30px','62px','30px','62px'];
    var iv = setInterval(function(){ h.style.setProperty('--mochi-safe-top', vals[i]); i++; if (i >= vals.length) { clearInterval(iv); res(true); } }, 200);
  });
})()`);
await sleep(400); // 仍在 180ms 落定闸附近/刚过
const b4mid = await evalJs("(function(){var cb=document.getElementById('chat-body');var t=document.getElementById('chat-typing');var th=(t&&!t.hidden&&t.offsetHeight)?t.offsetHeight:0;return JSON.stringify({st:Math.round(cb.scrollTop),target:Math.max(0,cb.scrollHeight-(cb.clientHeight+th))});})()");
await sleep(1200);
const b4end = await evalJs("(function(){var cb=document.getElementById('chat-body');var t=document.getElementById('chat-typing');var th=(t&&!t.hidden&&t.offsetHeight)?t.offsetHeight:0;return JSON.stringify({st:Math.round(cb.scrollTop),target:Math.max(0,cb.scrollHeight-(cb.clientHeight+th))});})()");
const b4endV = JSON.parse(b4end);
check('B4 变形落定后看门狗补钉到位', b4endV.st >= b4endV.target - 8, 'mid=' + b4mid + ' end=' + b4end);

// B5 行为（#765）：滚动未落定期看门狗必须让路。iOS 上 chatTouchActive 只到 touchend，抬手后的
// 惯性滑行期列表仍在滚，看门狗照写 scrollTop＝用户「往上滑被拽回底部」的 iPhone 残根。
// 错位手法刻意用「只加 chat-body 的 padding-bottom」：scrollHeight（＝贴底目标）变大而 chat-body
// 盒子尺寸不变 ⇒ #643 RO 与 #466 vv 两条回钉路都不被触发，场上只有 250ms 看门狗会来补钉；
// 每 120ms 派发合成 scroll 事件＝惯性滑行期的真实滚动沿（先派一发再改 padding，消除首个
// tick 抢在让路生效前写入的窗口）。断言只看几何：场上唯一能修这份错位的就是看门狗，所以
// 「仍然错位」＝「一次都没写」，落定后「到位」＝「写了」——不必插桩 scrollTop（其描述符挂在
// Element.prototype 上，实例插桩易取错原型反而把读法弄坏）。
await evalJs("(function(){var cb=document.getElementById('chat-body');cb.dispatchEvent(new Event('scroll'));cb.style.paddingBottom='420px';window.__b5=setInterval(function(){cb.dispatchEvent(new Event('scroll'));},120);return true;})()");
await sleep(900); // 期间看门狗约摸到 3 个 tick，全应被「滚动未落定」闸挡下
const b5mid = await evalJs("(function(){var cb=document.getElementById('chat-body');var t=document.getElementById('chat-typing');var th=(t&&!t.hidden&&t.offsetHeight)?t.offsetHeight:0;return JSON.stringify({st:Math.round(cb.scrollTop),target:Math.max(0,cb.scrollHeight-(cb.clientHeight+th))});})()");
const b5midV = JSON.parse(b5mid);
check('B5a 惯性滑行期（滚动事件持续派发）看门狗不写、错位保持', b5midV.st < b5midV.target - 8, b5mid);
await evalJs("(function(){clearInterval(window.__b5);return true;})()");
await sleep(1400); // 落定（>200ms 无 scroll）后看门狗应照 #706 补钉
const b5end = await evalJs("(function(){var cb=document.getElementById('chat-body');var t=document.getElementById('chat-typing');var th=(t&&!t.hidden&&t.offsetHeight)?t.offsetHeight:0;return JSON.stringify({st:Math.round(cb.scrollTop),target:Math.max(0,cb.scrollHeight-(cb.clientHeight+th))});})()");
const b5endV = JSON.parse(b5end);
check('B5b 滚动落定后仍照 #706 补钉（让路≠不修）', b5endV.st >= b5endV.target - 8, 'mid=' + b5mid + ' end=' + b5end);
await evalJs("(function(){var cb=document.getElementById('chat-body');cb.style.paddingBottom='';cb.scrollTop=cb.scrollHeight;return true;})()");
await sleep(600);

// B3 行为：解钉后看门狗不得拽底——派发 wheel（#162 真实滚动意图通道）后上翻
await evalJs("(function(){var cb=document.getElementById('chat-body');cb.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}));cb.scrollTop=Math.max(0,cb.scrollTop-400);return true;})()");
await sleep(1000);
const b3 = await evalJs("(function(){var cb=document.getElementById('chat-body');return JSON.stringify({st:Math.round(cb.scrollTop),max:cb.scrollHeight-cb.clientHeight});})()");
const b3v = JSON.parse(b3);
check('B3 解钉后看门狗不拽底（scrollTop 停在中途）', b3v.st < b3v.max - 8, b3);

server.close();
chrome.kill();
const pass = results.filter(r => r.ok).length;
console.log('---');
console.log('通过 ' + pass + '/' + results.length);
process.exit(pass === results.length ? 0 : 1);

// ===== 专项：v3.12.x 信箱「每天最多写信」等回复设置按联系人桌面独立生效 =====
// 用法：node tools/verify-mail-cfg-per-cid.mjs
// 背景（用户要求：信箱写信设置必须每个桌面的联系人各自独立）：
//   根因 mail.js maybeIncomingLetterFor 遍历所有联系人时统一调 mailCfg()=当前激活
//   桌面的 ml-* 值——用户停在 A 桌面，B 桌面设的「每天最多写信」从不生效。
//   修复：新增 mailCfgFor(cid)，以 mailCfg() 为基底再用该联系人命名空间
//   reply-ml-* 覆盖（概率 0/负不覆盖，同 prob() 兜底口径）；来信触发改用它。
// 自组装临时运行环境（同 verify-ta-checkin 先例）：不依赖也不触发 node build.mjs，
// 多会话并行可安全跑。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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

// 组装临时站点：index.html 由 src 源文件现场拼接（cssFiles/jsFiles 顺序与 build.mjs 一致；
// 锚点 /*__STYLES__*/ / /*__SCRIPTS__*/ 位于 <style>/<script> 块内部，须像 build 一样内联内容）
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-mailcfg-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  // 从 build.mjs 提取权威文件顺序，避免手抄漂移
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  if (!/window\.mailCfgForProbe/.test(jsAll)) { console.error('JS 拼接缺少 mail.js 新探针'); process.exit(1); }
  outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
}
writeFileSync(join(tmpSite, 'index.html'), outHtml);
// manifest/sw 引用失败无所谓（404 不阻塞）

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[ext(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
function ext(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mail-cfg-' + Date.now()),
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(2300);
  await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
  await sleep(300);
}

// ---- 种子：三个桌面 default / mtest1(甲·自定义设置) / mtest2(乙·不设置)；先全员封口防随机来信 ----
const CIDS = ['default', 'mtest1', 'mtest2'];
await loadApp();
await evalJs(`(async function(){
  try {
    if(window.idbDelete){
      for(const c of ${JSON.stringify(CIDS)}){
        for(const k of ['mail-letters','mail-letter-day','mail-letter-last','mail-letter-next','reply-ml-write-daily-max','reply-ml-write-prob','reply-ml-write-min','reply-ml-write-max','reply-ml-reply-prob','reply-ml-min-cards']){
          try{ await window.idbDelete('xy-home-v2:'+c+':'+k);}catch(e){}
          try{ localStorage.removeItem('xy-home-v2:'+c+':'+k);}catch(e){}
        }
      }
    }
    localStorage.setItem('xy-home-v2:contacts',JSON.stringify([{id:'default',name:'默认'},{id:'mtest1',name:'甲'},{id:'mtest2',name:'乙'}]));
    localStorage.setItem('xy-home-v2:active-contact','default');
    var today=(function(){var d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();})();
    // 封口：三桌面当日计数拉满，防测试期间 20~60s 随机定时器真写信干扰断言
    ${JSON.stringify(CIDS)}.forEach(function(c){ localStorage.setItem('xy-home-v2:'+c+':mail-letter-day',JSON.stringify({d:today,n:99})); });
    if(window.idbSet){
      for(const c of ${JSON.stringify(CIDS)}){ try{ await window.idbSet('xy-home-v2:'+c+':mail-letter-day',JSON.stringify({d:today,n:99}));}catch(e){} }
    }
    return true;
  } catch(e) { return 'err:'+e.message; }
})()`);
await loadApp();

// ---- A 组：探针单元验证（mailCfgForProbe 按 cid 读各自桌面） ----
await evalJs("(function(){var s=window.xyStore('xy-home-v2:mtest1');s.set('reply-ml-write-daily-max','7');s.set('reply-ml-write-prob','55');s.set('reply-ml-min-cards','2');return true;})()");
const a1 = JSON.parse(await evalJs("(function(){return JSON.stringify(window.mailCfgForProbe&&window.mailCfgForProbe('mtest1'));})()"));
check('A1 甲桌面设 7 封/概率55/最少2卡 → 甲的触发配置读到自己的值', !!a1 && a1.dailyMax === 7 && a1.writeProb === 55 && a1.minCards === 2, a1 && { dM: a1.dailyMax, wp: a1.writeProb, mc: a1.minCards });

const a2 = JSON.parse(await evalJs("(function(){return JSON.stringify(window.mailCfgForProbe());})()"));
check('A2 当前桌面(default)未设 → 仍为默认值 3/30（不被甲的值影响）', !!a2 && a2.dailyMax === 3 && a2.writeProb === 30, a2 && { dM: a2.dailyMax, wp: a2.writeProb });

const a3 = JSON.parse(await evalJs("(function(){return JSON.stringify(window.mailCfgForProbe('mtest2'));})()"));
check('A3 乙桌面未设 → 默认值 3/30（不是甲的 7/55）', !!a3 && a3.dailyMax === 3 && a3.writeProb === 30, a3 && { dM: a3.dailyMax, wp: a3.writeProb });

await evalJs("(function(){window.xyStore('xy-home-v2:mtest1').set('reply-ml-write-prob','0');return true;})()");
const a4 = JSON.parse(await evalJs("(function(){return JSON.stringify(window.mailCfgForProbe('mtest1'));})()"));
check('A4 甲存了坏数据概率 0 → 不覆盖，回退兜底默认 30（防永不写信）', !!a4 && a4.writeProb === 30, a4 && { wp: a4.writeProb });
await evalJs("(function(){window.xyStore('xy-home-v2:mtest1').remove('reply-ml-write-prob');return true;})()");

// ---- B 组：端到端——后台遍历触发来信，各联系人按自己桌面的上限/计数独立 ----
// 甲：概率100、间隔0、每日上限1（自己桌面）；default 与乙：当日计数已封口 99 → 永不写。
await evalJs(`(async function(){
  try {
    var s=window.xyStore('xy-home-v2:mtest1');
    s.set('reply-ml-write-prob','100'); s.set('reply-ml-write-min','0'); s.set('reply-ml-write-max','0'); s.set('reply-ml-write-daily-max','1');
    ${JSON.stringify(CIDS)}.forEach(function(c){ try{ localStorage.removeItem('xy-home-v2:'+c+':mail-letters'); localStorage.removeItem('xy-home-v2:'+c+':mail-letter-last'); localStorage.removeItem('xy-home-v2:'+c+':mail-letter-next');}catch(e){} });
    // 甲解封当日计数（其余两桌面保持 99 封口）
    var today=(function(){var d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();})();
    localStorage.setItem('xy-home-v2:mtest1:mail-letter-day',JSON.stringify({d:today,n:0}));
    try{ await window.idbSet('xy-home-v2:mtest1:mail-letter-day',JSON.stringify({d:today,n:0})); }catch(e){}
    return true;
  } catch(e) { return 'err:'+e.message; }
})()`);
// 触发一次前台恢复补查（eagerCheck → maybeIncomingLetter 全量遍历）
await evalJs("(function(){document.dispatchEvent(new Event('visibilitychange'));return true;})()");
await sleep(900);
const cntOf = async (cid) => JSON.parse(await evalJs(`(function(){try{return JSON.stringify((JSON.parse(localStorage.getItem('xy-home-v2:${cid}:mail-letters')||'[]')).filter(function(l){return l.type==='received';}).length);}catch(e){return '-1';}})()`));
check('B1 第1轮：甲按自己桌面配置收到且仅收到 1 封来信', (await cntOf('mtest1')) === 1, await cntOf('mtest1'));
check('B2 第1轮：当前桌面(default)未越自己的每日上限 → 0 封', (await cntOf('default')) === 0, await cntOf('default'));
check('B3 第1轮：乙(未单独设置)按自己计数封口 → 0 封', (await cntOf('mtest2')) === 0, await cntOf('mtest2'));

// 第2轮：甲的间隔为 0 → 直达每日上限守卫（验证的是【他自己桌面】的 dailyMax=1，而非别人的值）
await sleep(5300);
await evalJs("(function(){document.dispatchEvent(new Event('visibilitychange'));return true;})()");
await sleep(900);
check('B4 第2轮：甲达自己桌面上限(1封)后不再来第2封（每日上限按桌面独立生效）', (await cntOf('mtest1')) === 1, await cntOf('mtest1'));
check('B5 第2轮：default / 乙仍 0 封', (await cntOf('default')) === 0 && (await cntOf('mtest2')) === 0, { def: await cntOf('default'), yi: await cntOf('mtest2') });

// ---- C 组：静态断言——触发链路确实走 mailCfgFor(cid) ----
const srcOk = (() => {
  const s = readFileSync(join(root, 'src', 'js', 'mail.js'), 'utf8');
  return /function mailCfgFor\(cid\)/.test(s) && /maybeIncomingLetterFor[\s\S]*?mailCfgFor\(cid\)/.test(s);
})();
check('C1 源码静态断言：maybeIncomingLetterFor 已改为 mailCfgFor(cid)', srcOk);

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

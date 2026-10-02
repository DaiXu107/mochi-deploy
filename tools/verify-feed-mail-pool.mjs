// ===== 专项：v3.12.x 朋友圈/信箱 TA 素材池——默认字卡不再被自定义字卡挤出 + 开关按联系人桌面 =====
// 用法：node tools/verify-feed-mail-pool.mjs
// 背景（用户反馈 17promax：加了公用/专属自定义字卡后，联系人发朋友圈只用自定义字卡，
// 不再使用系统预设默认聊天字卡）：
//   根因 feed.js cardPool 补池门 `catOn('main') && !text.length`——自定义(公用+专属)
//   非空后默认主字卡永不参与。修复后 main 开启即始终混入（同聊天页 getPool）；
//   且开关按该联系人桌面读（某联系人关「朋友圈使用」→ 只有 TA 不用）。
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-feed-pool-' + Date.now()),
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

// ---- 种子：ftest1(甲·朋友圈使用开) / ftest2(乙·朋友圈使用关)，公用+各自专属文字字卡 ----
await loadApp();
await evalJs(`(async function(){
  try {
    var keys=['cc-groups-public','cc-scope-migrated','cc-scope-notice-done'];
    var cids=['ftest1','ftest2'];
    keys.forEach(function(k){ try{ localStorage.removeItem('xy-home-v2:'+k);}catch(e){} });
    ['cc-groups','dc-use-chat','dc-use-mail','dc-use-feed','dc-enabled'].forEach(function(k){
      cids.forEach(function(c){ try{ localStorage.removeItem('xy-home-v2:'+c+':'+k);}catch(e){} });
    });
    if(window.idbDelete){
      for(const k of keys){ try{ await window.idbDelete('xy-home-v2:'+k);}catch(e){} }
      for(const c of cids){ for(const k of ['cc-groups','dc-use-chat','dc-use-mail','dc-use-feed','dc-enabled']){ try{ await window.idbDelete('xy-home-v2:'+c+':'+k);}catch(e){} } }
    }
    var pub={text:[['公用组',['公用一句']]]};
    var g1={text:[['专属组',['专属甲句']]]};
    var g2={text:[['专属组',['专属乙句']]]};
    localStorage.setItem('xy-home-v2:contacts',JSON.stringify([{id:'default',name:'默认'},{id:'ftest1',name:'甲'},{id:'ftest2',name:'乙'}]));
    localStorage.setItem('xy-home-v2:active-contact','default');
    localStorage.setItem('xy-home-v2:cc-groups-public',JSON.stringify(pub));
    localStorage.setItem('xy-home-v2:cc-scope-migrated','1');
    localStorage.setItem('xy-home-v2:cc-scope-notice-done','1');
    localStorage.setItem('xy-home-v2:ftest1:cc-groups',JSON.stringify(g1));
    localStorage.setItem('xy-home-v2:ftest2:cc-groups',JSON.stringify(g2));
    localStorage.setItem('xy-home-v2:ftest2:dc-use-feed','0'); // 乙关闭了「朋友圈使用」
    if(window.idbSet){
      await window.idbSet('xy-home-v2:cc-groups-public',JSON.stringify(pub));
      await window.idbSet('xy-home-v2:ftest1:cc-groups',JSON.stringify(g1));
      await window.idbSet('xy-home-v2:ftest2:cc-groups',JSON.stringify(g2));
    }
    return true;
  } catch(e) { return 'err:'+e.message; }
})()`);
await loadApp();

// 页面内取一条纯文本默认主字卡探针
const probeCard = await evalJs(`(function(){
  var grps=((window.DEFAULT_CARD_DATA||{}).main)||[];
  for(var i=0;i<grps.length;i++){var arr=grps[i][1]||[];
    for(var j=0;j<arr.length;j++){var c=arr[j];
      if(typeof c==='string'&&c&&!/[\\uD800-\\uDBFF]/.test(c)&&!/^[\\uD800-\\uDBFF]/.test(c)&&!(/[\\(（｡◕]/.test(c)&&/[\\)）】)]/.test(c)))return c;
    }}
  return '';
})()`);

// F 组：朋友圈
const f1 = JSON.parse(await evalJs("(function(){return JSON.stringify(window.feedPoolFor&&window.feedPoolFor('ftest1'));})()"));
check('F1 甲的动态素材池含大量默认主字卡（自定义非空也不再挤掉默认池；4621+2）', f1 && f1.textN > 4600, f1);
const f1h = JSON.parse(await evalJs(`(function(){
  var h=window.feedPoolHas('ftest1',${JSON.stringify(probeCard)});
  var a=window.feedPoolHas('ftest1','公用一句'), b=window.feedPoolHas('ftest1','专属甲句');
  return JSON.stringify({def:h&&h.text,pub:a&&a.text,own:b&&b.text});
})()`));
check('F2 甲池同时含 默认+公用+专属 三来源', f1h.def === true && f1h.pub === true && f1h.own === true, f1h);

const f2 = JSON.parse(await evalJs("(function(){return JSON.stringify(window.feedPoolFor&&window.feedPoolFor('ftest2'));})()"));
check('F3 乙（已关「朋友圈使用」）池不含默认主字卡（只有这个联系人不参与）', f2 && f2.textN === 2, f2);

const f2h = JSON.parse(await evalJs(`(function(){
  var a=window.feedPoolHas('ftest2','公用一句'), b=window.feedPoolHas('ftest2','专属乙句');
  return JSON.stringify({pub:a&&a.text,own:b&&b.text});
})()`));
check('F4 乙池仍含 公用+专属（关场景开关不误伤自定义）', f2h.pub === true && f2h.own === true, f2h);

// F5 甲桌面关总开关 dc-enabled → 默认字卡退出（走 xyStore 写同步 memoryCache）
await evalJs("(function(){window.xyStore('xy-home-v2:ftest1').set('dc-enabled','0');return true;})()");
const f1off = JSON.parse(await evalJs("(function(){return JSON.stringify(window.feedPoolFor('ftest1'));})()"));
check('F5 甲桌面关「使用默认字卡」总开关后池只剩自定义（dc-enabled 按桌面生效）', f1off && f1off.textN === 2, f1off);
await evalJs("(function(){window.xyStore('xy-home-v2:ftest1').remove('dc-enabled');return true;})()");

// M 组：信箱（独立默认子池按概率混入；此处验证开关按桌面接线）
const m1 = JSON.parse(await evalJs("(function(){return JSON.stringify(window.mailPoolFor&&window.mailPoolFor('ftest1'));})()"));
check('M1 甲的信件默认子池已装载（defText>4000）', m1 && m1.defTextN > 4000, m1);
const m2 = JSON.parse(await evalJs("(function(){window.xyStore('xy-home-v2:ftest1').set('dc-use-mail','0');return JSON.stringify(window.mailPoolFor('ftest1'));})()"));
check('M2 甲桌面关「信箱使用」后默认子池清空（只影响这个联系人）', m2 && m2.defTextN === 0, m2);
await evalJs("(function(){window.xyStore('xy-home-v2:ftest1').remove('dc-use-mail');return true;})()");

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

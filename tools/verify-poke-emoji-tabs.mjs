// ===== v3.11.x：拍一拍/表情包面板三分区（公用/联系人昵称/我的）+ 联系人回复池回归 =====
// 背景：字卡库拆双作用域后，「打开一次公用字卡管理页再返回」会把内存 groups 换成公用库，
//   回复池（getCustomCards/getPokeCards/getMediaCards）以它为基准 → 专属拍一拍/表情包
//   从联系人侧消失。本脚本验证：
//   A. 合并池：联系人侧同时可用 公用+专属 拍一拍/表情包（可发送）
//   B. 根因回归：访问「公用字卡」管理页并返回后，合并池不变
//   C. 拍一拍面板三分区 tab 与各分区内容隔离
//   D. 表情包面板三分区 tab、动态昵称标签与各分区内容隔离
// 用法：node tools/verify-poke-emoji-tabs.mjs（需先 node build.mjs）
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-pe-' + Date.now()),
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

const GIF_PUB_HEAD = 'R0lGODlhAQABAIAAAP///wAA'; // GIF_PUB base64 开头
const GIF_OWN_HEAD = 'R0lGODlhAQABAIAAAP/wAAA'; // GIF_OWN base64 开头

// ---- 种子：两个联系人，active=ctest1(小A)；公用键 + ctest1 专属键各有 拍一拍+表情包 ----
await loadApp();
await evalJs(`(async function(){
  try {
    var keys=['cc-groups-public','cc-scope-migrated','cc-scope-notice-done'];
    var cids=['default','ctest1'];
    keys.forEach(function(k){ try{ localStorage.removeItem('xy-home-v2:'+k);}catch(e){} });
    cids.forEach(function(c){ try{ localStorage.removeItem('xy-home-v2:'+c+':cc-groups')}catch(e){} });
    if(window.idbDelete){
      for(const k of keys){ try{ await window.idbDelete('xy-home-v2:'+k);}catch(e){} }
      for(const c of cids){ try{ await window.idbDelete('xy-home-v2:'+c+':cc-groups')}catch(e){} }
    }
    var pub={text:[],kaomoji:[],emoji:[],sticker:[['公用表情',['data:image/gif;base64,${GIF_PUB_HEAD}CH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==']]],image:[],poke:[['公用互动',['公用戳戳PUB']]],voice:[]};
    var own={text:[['闲聊',['专属一句']]],poke:[['专属互动',['专属戳戳OWN']]],sticker:[['专属表情',['data:image/gif;base64,${GIF_OWN_HEAD}CH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==']]]};
    localStorage.setItem('xy-home-v2:cc-groups-public',JSON.stringify(pub));
    localStorage.setItem('xy-home-v2:ctest1:cc-groups',JSON.stringify(own));
    localStorage.setItem('xy-home-v2:contacts',JSON.stringify([{id:'default',name:'默认'},{id:'ctest1',name:'小A'}]));
    localStorage.setItem('xy-home-v2:active-contact','ctest1');
    localStorage.setItem('xy-home-v2:ctest1:lbl-partner','小A');
    localStorage.setItem('xy-home-v2:ctest1:lbl-user','我');
    if(window.idbSet){
      await window.idbSet('xy-home-v2:cc-groups-public',JSON.stringify(pub));
      await window.idbSet('xy-home-v2:ctest1:cc-groups',JSON.stringify(own));
    }
    return true;
  } catch(e){ return 'err:'+e.message; }
})()`);
await loadApp();

const gridProbe = `(function(){
  var imgs=[].slice.call(document.querySelectorAll('#emoji-panel .emoji-grid img')).map(function(x){return String(x.src);});
  return JSON.stringify({n:imgs.length,pub:imgs.some(function(s){return s.indexOf('${GIF_PUB_HEAD}')>=0;}),own:imgs.some(function(s){return s.indexOf('${GIF_OWN_HEAD}')>=0;})});
})()`;

// ---- A. 合并池（联系人可发送的基础） ----
const pool1 = JSON.parse(await evalJs(`(function(){
  var pk=(window.getPokeCards&&window.getPokeCards())||[];
  var st=(window.getMediaCards&&window.getMediaCards('sticker'))||[];
  return JSON.stringify({pk:pk,stN:st.length,stPub:st.some(function(s){return s.indexOf('${GIF_PUB_HEAD}')>0;}),stOwn:st.some(function(s){return s.indexOf('${GIF_OWN_HEAD}')>0;})});
})()`));
check('A1 合并池：getPokeCards 含 公用+专属 拍一拍', pool1.pk.indexOf('公用戳戳PUB') >= 0 && pool1.pk.indexOf('专属戳戳OWN') >= 0, pool1.pk);
check('A2 合并池：表情包池含 公用+专属 两张图', pool1.stPub && pool1.stOwn && pool1.stN === 2, pool1);

// ---- C/D. 面板三分区 UI ----
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()");
await sleep(900);
await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return !!b;})()");
await sleep(350);
await evalJs("(function(){var b=document.getElementById('more-poke');if(b)b.click();return !!b;})()");
await sleep(500);
const pokeTabs = JSON.parse(await evalJs(`(function(){
  var t=[].slice.call(document.querySelectorAll('#poke-card .poke-tab'));
  var sel=t.filter(function(x){return x.classList.contains('sel');})[0];
  return JSON.stringify({n:t.length,labels:t.map(function(x){return x.textContent;}),sel:sel?sel.dataset.ptab:''});
})()`));
check('C1 拍一拍面板 3 个 tab', pokeTabs.n === 3, pokeTabs);
check('C2 tab 标签 = 公用拍一拍 / 小A 的拍一拍 / 我的拍一拍',
  pokeTabs.labels[0] === '公用拍一拍' && pokeTabs.labels[1] === '小A 的拍一拍' && pokeTabs.labels[2] === '我的拍一拍', pokeTabs.labels);

// 公用分区内容
await evalJs("(function(){var t=document.querySelector('#poke-card .poke-tab-pub');if(t)t.click();return !!t;})()");
await sleep(350);
const pubView = JSON.parse(await evalJs(`(function(){
  var chips=[].slice.call(document.querySelectorAll('#poke-card .poke-groups .emoji-g-chip')).map(function(x){return x.textContent;});
  var txt=document.getElementById('poke-list').textContent;
  return JSON.stringify({chips:chips,hasPub:txt.indexOf('公用戳戳PUB')>=0,hasOwn:txt.indexOf('专属戳戳OWN')>=0});
})()`));
check('C3 公用分区：只显示公用分组与字卡', pubView.hasPub && !pubView.hasOwn, pubView);
// 联系人分区内容
await evalJs("(function(){var t=document.querySelector('#poke-card .poke-tab-ta');if(t)t.click();return !!t;})()");
await sleep(350);
const taView = JSON.parse(await evalJs(`(function(){
  var chips=[].slice.call(document.querySelectorAll('#poke-card .poke-groups .emoji-g-chip')).map(function(x){return x.textContent;});
  var txt=document.getElementById('poke-list').textContent;
  return JSON.stringify({chips:chips,hasPub:txt.indexOf('公用戳戳PUB')>=0,hasOwn:txt.indexOf('专属戳戳OWN')>=0});
})()`));
check('C4 联系人分区：只显示专属分组与字卡', taView.hasOwn && !taView.hasPub, taView);
// 我的分区：预设仍在
await evalJs("(function(){var t=document.querySelector('#poke-card .poke-tab-mine');if(t)t.click();return !!t;})()");
await sleep(350);
const mineView = JSON.parse(await evalJs(`(function(){
  var chips=[].slice.call(document.querySelectorAll('#poke-card .poke-groups .emoji-g-chip')).map(function(x){return x.textContent;});
  return JSON.stringify(chips);
})()`));
check('C5 我的分区：预设分组存在', mineView.some(s => String(s).indexOf('预设') >= 0), mineView);
await evalJs("(function(){var b=document.getElementById('poke-card-close');if(b)b.click();return !!b;})()");
await sleep(250);

// 表情包面板
await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return !!b;})()");
await sleep(500);
const emoHead = JSON.parse(await evalJs(`(function(){
  var t=[].slice.call(document.querySelectorAll('#emoji-panel .emoji-tab'));
  return JSON.stringify({n:t.length,labels:t.map(function(x){return x.textContent;})});
})()`));
check('D1 表情包面板 3 个 tab', emoHead.n === 3, emoHead);
check('D2 tab 标签 = 公用表情包 / 小A 的表情包 / 我的表情包',
  emoHead.labels[0] === '公用表情包' && emoHead.labels[1] === '小A 的表情包' && emoHead.labels[2] === '我的表情包', emoHead.labels);
// 公用分区
await evalJs("(function(){var t=document.querySelector('#emoji-panel .emoji-tab[data-etab=\"public\"]');if(t)t.click();return !!t;})()");
await sleep(350);
const emoPub = JSON.parse(await evalJs(`(function(){
  var els=[].slice.call(document.querySelectorAll('#emoji-panel .emoji-groups .emoji-g-chip'));
  var texts=els.map(function(x){return x.textContent;});
  if(els.length) els[0].click();
  return JSON.stringify(texts);
})()`));
await sleep(400);
const emoPubGrid = JSON.parse(await evalJs(gridProbe));
check('D3 公用分区：chip=公用表情，网格只含公用图',
  emoPub.some(s => String(s).indexOf('公用表情') >= 0) && emoPubGrid.pub && !emoPubGrid.own, { emoPub, emoPubGrid });
// 联系人分区
await evalJs("(function(){var t=document.querySelector('#emoji-panel .emoji-tab[data-etab=\"ta\"]');if(t)t.click();return !!t;})()");
await sleep(350);
const emoTa = JSON.parse(await evalJs(`(function(){
  var els=[].slice.call(document.querySelectorAll('#emoji-panel .emoji-groups .emoji-g-chip'));
  var texts=els.map(function(x){return x.textContent;});
  if(els.length) els[0].click();
  return JSON.stringify(texts);
})()`));
await sleep(400);
const emoTaGrid = JSON.parse(await evalJs(gridProbe));
check('D4 联系人分区：chip=专属表情，网格只含专属图',
  emoTa.some(s => String(s).indexOf('专属表情') >= 0) && emoTaGrid.own && !emoTaGrid.pub, { emoTa, emoTaGrid });
await evalJs("(function(){var b=document.getElementById('emoji-close');if(b)b.click();return !!b;})()");
await sleep(250);

// ---- B. 根因回归：打开「公用字卡」管理页 → 返回 → 池子不丢 ----
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return !!t;})()");
await sleep(400);
await evalJs("(function(){var li=document.getElementById('li-custom-cards-public');if(li)li.click();return !!li;})()");
await sleep(400);
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return !!b;})()");
await sleep(400);
const pool2 = JSON.parse(await evalJs(`(function(){
  var pk=(window.getPokeCards&&window.getPokeCards())||[];
  var st=(window.getMediaCards&&window.getMediaCards('sticker'))||[];
  var spk=(window.getScopedGroups&&window.getScopedGroups('poke','public'))||[];
  var sopk=(window.getScopedGroups&&window.getScopedGroups('poke','own'))||[];
  return JSON.stringify({pkPub:pk.indexOf('公用戳戳PUB')>=0,pkOwn:pk.indexOf('专属戳戳OWN')>=0,stN:st.length,
    stPub:st.some(function(s){return s.indexOf('${GIF_PUB_HEAD}')>0;}),stOwn:st.some(function(s){return s.indexOf('${GIF_OWN_HEAD}')>0;}),
    sPub:JSON.stringify(spk),sOwn:JSON.stringify(sopk)});
})()`));
check('B1 访问公用页后：拍一拍池仍含 公用+专属', pool2.pkPub && pool2.pkOwn, pool2);
check('B2 访问公用页后：表情包池仍含 公用+专属 两张图', pool2.stPub && pool2.stOwn && pool2.stN === 2, pool2);
check('B3 getScopedGroups：public/own 分区读取正确', pool2.sPub.indexOf('公用互动') >= 0 && pool2.sOwn.indexOf('专属互动') >= 0, pool2);
// 再开一次拍一拍面板确认渲染正常（离开管理页后 UI 未坏）
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()");
await sleep(700);
await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return !!b;})()");
await sleep(300);
await evalJs("(function(){var b=document.getElementById('more-poke');if(b)b.click();return !!b;})()");
await sleep(400);
const pokeAfter = JSON.parse(await evalJs(`(function(){
  var t=[].slice.call(document.querySelectorAll('#poke-card .poke-tab'));
  return JSON.stringify({n:t.length});
})()`));
check('B4 访问公用页后：拍一拍面板仍正常渲染 3 tab', pokeAfter.n === 3, pokeAfter);

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

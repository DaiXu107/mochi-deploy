// ===== 回归脚本：字卡库「公用字卡 / 专属字卡」双作用域（v3.11.x） =====
// 用法：node build.mjs && node tools/verify-cc-scope.mjs
// 覆盖：
//   A. 单桌面存量迁移——旧 cc-groups 迁入全局 cc-groups-public，原键清空，回复池合并可读
//   B. 多桌面存量归属——各联系人字卡原地保留为专属，不迁公用
//   C. 双入口读写——公用页写全局键、专属页写本联系人键；For 系列按联系人合并公用
//   D. 全局键防误迁——再次刷新后 cc-groups-public 仍在（contacts.js EXCLUDE 生效）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ccscope-' + Date.now()),
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

async function loadApp(keepNotice) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(2300); // 覆盖变动提醒弹窗的 1200ms 延迟
  if (!keepNotice) {
    // 默认自动关掉「字卡库更新提醒」弹窗（场景 E 才专门测它），避免遮罩挡住后续交互
    await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
    await sleep(300);
  }
}

// 清空所有字卡相关状态（LS + IDB，防场景间串数据），返回 true 表示执行成功
async function purgeCcState() {
  return await evalJs(`(async function(){
    try {
      var keys=['cc-groups-public','cc-scope-migrated','cc-scope-notice-done','cc-groups'];
      var cids=['default','ctest1','ctest2'];
      keys.forEach(function(k){ try{ localStorage.removeItem('xy-home-v2:'+k);}catch(e){} });
      cids.forEach(function(c){ try{ localStorage.removeItem('xy-home-v2:'+c+':cc-groups');}catch(e){} });
      if(window.idbDelete){
        for(const k of keys){ try{ await window.idbDelete('xy-home-v2:'+k);}catch(e){} }
        for(const c of cids){ try{ await window.idbDelete('xy-home-v2:'+c+':cc-groups');}catch(e){} }
      }
      return true;
    } catch(e) { return 'err:'+e.message; }
  })()`);
}

function lsGet(k) { return 'try{localStorage.getItem("' + k + '")}catch(e){null}'; }
const G = {
  pubRaw: "(function(){try{return localStorage.getItem('xy-home-v2:cc-groups-public');}catch(e){return null}})()",
  defRaw: "(function(){try{return localStorage.getItem('xy-home-v2:default:cc-groups');}catch(e){return null}})()",
  c1Raw: "(function(){try{return localStorage.getItem('xy-home-v2:ctest1:cc-groups');}catch(e){return null}})()",
  flag: "(function(){try{return localStorage.getItem('xy-home-v2:cc-scope-migrated');}catch(e){return null}})()"
};
function cntOf(raw) {
  // 在页面里数一张 json 的字卡总数
  return `(function(){try{var v=${raw};if(!v)return -1;var g=JSON.parse(v);var n=0;Object.keys(g).forEach(function(t){(g[t]||[]).forEach(function(grp){n+=(grp[1]||[]).length;});});return n;}catch(e){return 'err'}})()`;
}

// ================= 场景 A：单桌面存量 → 迁公用 =================
await loadApp();
await purgeCcState();
const seedA = await evalJs(`(async function(){
  try{
    var g={text:[['旧分组',['你好呀','晚安啦']]],poke:[['亲亲分组',['抱抱我']]]};
    var s=JSON.stringify(g);
    localStorage.setItem('xy-home-v2:default:cc-groups',s);
    localStorage.setItem('xy-home-v2:contacts',JSON.stringify([{id:'default',name:'默认'}]));
    localStorage.setItem('xy-home-v2:active-contact','default');
    localStorage.removeItem('xy-home-v2:cc-scope-migrated');
    localStorage.removeItem('xy-home-v2:cc-groups-public');
    if(window.idbSet) await window.idbSet('xy-home-v2:default:cc-groups',s);
    return true;
  }catch(e){ return 'err:'+e.message; }
})()`);
check('A0 种子写入成功', seedA === true, seedA);
await loadApp();

check('A1 迁移标记已置位', (await evalJs(G.flag)) === '1');
const pubCntA = await evalJs(cntOf(G.pubRaw));
check('A2 存量 3 张已迁入公用键', pubCntA === 3, pubCntA);
const defCntA = await evalJs(cntOf(G.defRaw));
check('A3 原专属键已清空（含回退根键）', defCntA === -1, defCntA);
const poolA = await evalJs('(window.getCustomCards ? window.getCustomCards().length : -1)');
check('A4 回复池读到迁移后的公用字卡', poolA === 3, poolA);
const pokeA = await evalJs('(window.getPokeCards ? JSON.stringify(window.getPokeCards()) : "n/a")');
check('A5 拍一拍池来自公用', pokeA === JSON.stringify(['抱抱我']), pokeA);

await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return !!t;})()");
await sleep(500);
const badgePubA = await evalJs("(document.getElementById('cc-pub-count')||{}).textContent");
const badgeOwnA = await evalJs("(document.getElementById('cc-list-count')||{textContent:'x'}).textContent");
check('A6 列表角标 公用=3 / 专属=0', badgePubA === '3' && badgeOwnA === '0', badgePubA + '/' + badgeOwnA);

// ================= 场景 B：多桌面存量 → 归专属原地保留 =================
await purgeCcState();
const seedB = await evalJs(`(async function(){
  try{
    var g={text:[['A的分组',['专属一句','再一句']]]};
    var s=JSON.stringify(g);
    localStorage.setItem('xy-home-v2:ctest1:cc-groups',s);
    localStorage.setItem('xy-home-v2:contacts',JSON.stringify([{id:'default',name:'默认'},{id:'ctest1',name:'小A'}]));
    localStorage.setItem('xy-home-v2:active-contact','ctest1');
    if(window.idbSet) await window.idbSet('xy-home-v2:ctest1:cc-groups',s);
    return true;
  }catch(e){ return 'err:'+e.message; }
})()`);
check('B0 种子写入成功', seedB === true, seedB);
await loadApp();

check('B-前置 当前联系人=ctest1', (await evalJs('(window.__activeCid||"")')) === 'ctest1');
const pubCntB = await evalJs(cntOf(G.pubRaw));
check('B1 多桌面时不生成公用迁移数据', pubCntB <= 0, pubCntB);
const c1CntB = await evalJs(cntOf(G.c1Raw));
check('B2 联系人专属字卡原地保留 2 张', c1CntB === 2, c1CntB);
const poolB = await evalJs('(window.getCustomCards ? window.getCustomCards().length : -1)');
check('B3 当前联系人回复池=专属2张', poolB === 2, poolB);
const otherB = await evalJs('(window.getCustomCardsFor ? window.getCustomCardsFor("cOther").length : -1)');
check('B4 其他联系人不读到该专属', otherB === 0, otherB);

// ================= 场景 C：双入口读写 + 合并池 =================
// C1 打开「公用字卡」→ 批量导入 → 写全局键
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return !!t;})()");
await sleep(400);
await evalJs("(function(){var li=document.getElementById('li-custom-cards-public');if(li)li.click();return !!li;})()");
await sleep(400);
const ttlC = await evalJs("(function(){var t=document.getElementById('cc-page-title');return t?t.textContent:'none';})()");
check('C1 公用入口打开后标题=公用字卡', ttlC === '公用字卡', ttlC);
await evalJs("(function(){var b=document.getElementById('cc-import');if(b)b.click();return !!b;})()");
await sleep(400);
await evalJs(`(function(){
  var inp=document.getElementById('modal-textarea');
  var box=inp&&(inp.__ceBox||inp);
  box.textContent='【公用组】公共卡一\\n公共卡二';
  box.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`);
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(600);
const pubCntC = await evalJs(cntOf(G.pubRaw));
check('C2 公用页导入写入全局键 2 张', pubCntC === 2, pubCntC);
const defCntC = await evalJs(cntOf(G.c1Raw));
check('C3 专属键不受影响', defCntC === 2, defCntC);

// C4 返回 → 打开「专属字卡」→ 导入写本联系人键
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return !!b;})()");
await sleep(400);
await evalJs("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
await sleep(400);
const ttlC2 = await evalJs("(function(){var t=document.getElementById('cc-page-title');return t?t.textContent:'none';})()");
check('C4 专属入口打开后标题=专属字卡', ttlC2 === '专属字卡', ttlC2);
await evalJs("(function(){var b=document.getElementById('cc-import');if(b)b.click();return !!b;})()");
await sleep(400);
await evalJs(`(function(){
  var inp=document.getElementById('modal-textarea');
  var box=inp&&(inp.__ceBox||inp);
  box.textContent='【专属组】只给小A';
  box.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`);
await evalJs("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(600);
const c1CntC = await evalJs(cntOf(G.c1Raw));
check('C5 专属页导入写入联系人键（2+1=3）', c1CntC === 3, c1CntC);
const mergeSelf = await evalJs('(window.getCustomCards ? window.getCustomCards().length : -1)');
check('C6 当前联系人回复池=公用2+专属3', mergeSelf === 5, mergeSelf);
const mergeOther = await evalJs('(window.getCustomCardsFor ? window.getCustomCardsFor("cOther").length : -1)');
check('C7 其他联系人只见公用 2 张', mergeOther === 2, mergeOther);

// ================= 场景 D：全局键防误迁（EXCLUDE 生效）=================
await loadApp();
const pubCntD = await evalJs(cntOf(G.pubRaw));
check('D1 刷新后公用键仍在（未被 migrateLegacy 迁走）', pubCntD === 2, pubCntD);
const badgePubD = await evalJs("(document.getElementById('cc-pub-count')||{textContent:'x'}).textContent");
check('D2 列表公用角标=2', badgePubD === '2', badgePubD);

// ================= 场景 E：变动提醒弹窗（一次性 + 导出引导）=================
await purgeCcState();
const seedE = await evalJs(`(async function(){
  try{
    var g={text:[['旧分组',['你好呀','晚安啦']]]};
    var s=JSON.stringify(g);
    localStorage.setItem('xy-home-v2:default:cc-groups',s);
    localStorage.setItem('xy-home-v2:contacts',JSON.stringify([{id:'default',name:'默认'}]));
    localStorage.setItem('xy-home-v2:active-contact','default');
    localStorage.removeItem('xy-home-v2:cc-scope-migrated');
    localStorage.removeItem('xy-home-v2:cc-groups-public');
    localStorage.removeItem('xy-home-v2:cc-scope-notice-done');
    if(window.idbSet) await window.idbSet('xy-home-v2:default:cc-groups',s);
    return true;
  }catch(e){ return 'err:'+e.message; }
})()`);
check('E0 种子写入成功', seedE === true, seedE);
await loadApp(true);
const maskVis = await evalJs("(function(){var m=document.getElementById('cc-scope-mask');return m&&!m.hidden?'open':'closed';})()");
check('E1 有存量字卡时弹窗出现', maskVis === 'open', maskVis);
const sumTxt = await evalJs("(function(){var s=document.getElementById('csn-summary');return s?s.textContent:'';})()");
check('E2 摘要显示检测到的字卡数（迁移后为公用 2 张）', sumTxt.indexOf('2 张') >= 0, sumTxt);
await evalJs("(function(){var b=document.getElementById('csn-ok');if(b)b.click();return true;})()");
await sleep(400);
const afterOk = await evalJs("(function(){var m=document.getElementById('cc-scope-mask');var f=localStorage.getItem('xy-home-v2:cc-scope-notice-done');return (m&&m.hidden?'hidden':'open')+'/'+f;})()");
check('E3 点「我已知晓」关闭并置已读标记', afterOk === 'hidden/1', afterOk);
await loadApp(true);
const maskAgain = await evalJs("(function(){var m=document.getElementById('cc-scope-mask');return m&&!m.hidden?'open':'closed';})()");
check('E4 已读后再启动不再弹窗', maskAgain === 'closed', maskAgain);

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

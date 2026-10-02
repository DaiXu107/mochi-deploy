// ===== 专项：v3.12.x 群聊成员字卡池 = 公用字卡 + 该成员桌面专属字卡 + 默认字卡（按成员桌面开关） =====
// 用法：node tools/verify-gc-pool-scope.mjs
// 背景（用户要求捋顺的三来源语义）：
//   ① 群聊成员回复池必须含【公用字卡】（旧实现文字/emoji/颜文字只读专属键）
//   ② 专属字卡按成员各自桌面隔离
//   ③ 默认字卡的【聊天使用】等开关按成员所在桌面独立生效——某成员桌面关闭后，
//      单聊和群聊里这个成员都不再使用默认字卡
//   另：旧 gcPool 按 {key:{cards:[{type,text}]}} 解析 cc-groups 与实际存储结构不符，
//   文字类专属字卡从未真正进过群聊池（本文件 T2 同时回归该修复）。
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gc-pool-' + Date.now()),
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

// ---- 种子：default / gtest1(甲·聊天使用开) / gtest2(乙·聊天使用关)，公用库有 文字+拍一拍 ----
await loadApp();
await evalJs(`(async function(){
  try {
    var keys=['cc-groups-public','cc-scope-migrated','cc-scope-notice-done'];
    var cids=['gtest1','gtest2'];
    keys.forEach(function(k){ try{ localStorage.removeItem('xy-home-v2:'+k);}catch(e){} });
    ['cc-groups','dc-use-chat','dc-enabled'].forEach(function(k){
      cids.forEach(function(c){ try{ localStorage.removeItem('xy-home-v2:'+c+':'+k);}catch(e){} });
    });
    if(window.idbDelete){
      for(const k of keys){ try{ await window.idbDelete('xy-home-v2:'+k);}catch(e){} }
      for(const c of cids){ for(const k of ['cc-groups','dc-use-chat','dc-enabled']){ try{ await window.idbDelete('xy-home-v2:'+c+':'+k);}catch(e){} } }
    }
    var pub={text:[['公用组',['公用一句']]],poke:[['互动',['公用戳戳']]]};
    var g1={text:[['专属组',['专属甲句']]]};
    var g2={text:[['专属组',['专属乙句']]]};
    localStorage.setItem('xy-home-v2:contacts',JSON.stringify([{id:'default',name:'默认'},{id:'gtest1',name:'甲'},{id:'gtest2',name:'乙'}]));
    localStorage.setItem('xy-home-v2:active-contact','default');
    localStorage.setItem('xy-home-v2:cc-groups-public',JSON.stringify(pub));
    localStorage.setItem('xy-home-v2:cc-scope-migrated','1');
    localStorage.setItem('xy-home-v2:cc-scope-notice-done','1');
    localStorage.setItem('xy-home-v2:gtest1:cc-groups',JSON.stringify(g1));
    localStorage.setItem('xy-home-v2:gtest2:cc-groups',JSON.stringify(g2));
    localStorage.setItem('xy-home-v2:gtest2:dc-use-chat','0'); // 乙关闭了【聊天使用】
    if(window.idbSet){
      await window.idbSet('xy-home-v2:cc-groups-public',JSON.stringify(pub));
      await window.idbSet('xy-home-v2:gtest1:cc-groups',JSON.stringify(g1));
      await window.idbSet('xy-home-v2:gtest2:cc-groups',JSON.stringify(g2));
    }
    return true;
  } catch(e) { return 'err:'+e.message; }
})()`);
await loadApp();

// 页面内选一条「纯文本」默认主字卡作探针（避开 emoji/颜文字被分到别的桶）
function poolProbe(cid, ownCard) {
  return `(function(){
    var p=(window.groupChatPoolFor&&window.groupChatPoolFor('${cid}'));
    if(!p) return JSON.stringify({err:'no pool for ${cid}'});
    var probe='';
    try{
      var grps=((window.DEFAULT_CARD_DATA||{}).main)||[];
      outer: for(var i=0;i<grps.length;i++){var arr=grps[i][1]||[];
        for(var j=0;j<arr.length;j++){var c=arr[j];
          if(typeof c==='string'&&c&&!/[\\uD800-\\uDBFF]/.test(c)&&!/^[\\uD800-\\uDBFF]/.test(c)&&!(/[\\(（｡◕]/.test(c)&&/[\\)）】)]/.test(c))){probe=c;break outer;}
        }}
    }catch(e){}
    return JSON.stringify({
      hasPub:p.text.indexOf('公用一句')>=0,
      hasOwn:p.text.indexOf('${ownCard}')>=0,
      hasOther:p.text.indexOf('${cid==='gtest1'?'专属乙句':'专属甲句'}')>=0,
      hasDefault:!!probe&&(p.text.indexOf(probe)>=0),
      probeLen:probe.length,
      textN:p.text.length
    });
  })()`;
}

const p1 = JSON.parse(await evalJs(poolProbe('gtest1', '专属甲句')));
check('T1 甲池含公用文字字卡（三来源之①）', p1.hasPub === true, p1);
check('T2a 甲池含自己桌面的专属字卡（旧结构解析 bug 回归）', p1.hasOwn === true, p1);
check('T2b 甲池不含乙的专属字卡（专属隔离）', p1.hasOther === false, p1);
check('T3 甲池含系统默认主字卡（甲桌面【聊天使用】开启）', p1.hasDefault === true, p1);

const p2 = JSON.parse(await evalJs(poolProbe('gtest2', '专属乙句')));
check('T4 乙池不含系统默认主字卡（乙桌面已关【聊天使用】→ 群聊里这个联系人也不用）', p2.hasDefault === false, p2);
check('T5 乙池仍含 公用+自己的专属（关默认字卡不误伤自定义）', p2.hasPub === true && p2.hasOwn === true, p2);

// T6 总开关同样按成员桌面生效（走 xyStore 写，同步 memoryCache，免刷新）
await evalJs("(function(){window.xyStore('xy-home-v2:gtest1').set('dc-enabled','0');return true;})()");
const p1off = JSON.parse(await evalJs(poolProbe('gtest1', '专属甲句')));
check('T6 甲桌面关总开关后池不含默认字卡（dc-enabled 按桌面）', p1off.hasDefault === false && p1off.textN < 100, p1off);
await evalJs("(function(){window.xyStore('xy-home-v2:gtest1').remove('dc-enabled');return true;})()");

// T7 公用拍一拍进 For 合并视图（gcPokeText 自定义兜底数据源）
const pk = JSON.parse(await evalJs(`(function(){
  var a=(window.getPokeCardsFor&&window.getPokeCardsFor('gtest1'))||[];
  return JSON.stringify({n:a.length,has:a.indexOf('公用戳戳')>=0});
})()`));
check('T7 甲的拍一拍池含公用拍一拍（getPokeCardsFor 合并视图）', pk.n >= 1 && pk.has === true, pk);

// T8 默认字卡页小字说明存在且提到【聊天使用】与群聊
await evalJs("(function(){var li=document.getElementById('li-default-cards');if(li)li.click();return !!li;})()");
await sleep(400);
const note = await evalJs(`(function(){
  var n=document.getElementById('dc-scope-note');
  if(!n) return JSON.stringify({has:false});
  var t=n.textContent||'';
  var inPage=(n.closest('#page-default-cards')!=null);
  return JSON.stringify({has:true,inPage:inPage,nearChatUse:t.indexOf('聊天使用')>=0,nearGroup:t.indexOf('群聊')>=0});
})()`);
const noteObj = JSON.parse(note || '{}');
check('T8 默认字卡页有小字说明（含【聊天使用】+群聊口径，位于本页）', noteObj.has === true && noteObj.inPage === true && noteObj.nearChatUse === true && noteObj.nearGroup === true, noteObj);

// T9 探针健壮性：未知 cid 不抛异常
const unk = await evalJs("(function(){try{return JSON.stringify(window.groupChatPoolFor('nobody'))||'null';}catch(e){return 'throw:'+e.message;}})()");
check('T9 探针对未知成员安全（返回空池/null，不抛错）', unk !== null && String(unk).indexOf('throw:') !== 0, unk);

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

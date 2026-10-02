// ===== 回归 #849：系统预设字卡去重（词典/默认聊天字卡不再出现重复内容） =====
// 背景（用户实报 2026-09-19）：「词典里有重复内容。默认聊天字卡里有重复内容，比如词典的基础汉字重复的【嗯】」
//   批量化补卡时同一句话被反复写进同一个分组、或写进多个分组：词典分类里「词库」与「基础汉字」等
//   扩展分组共用一份语言资源，「嗯」这类词在两个分组各有一份 → 词典页列两行、拼字抽卡池里同一张卡
//   被抽中的概率翻倍；默认聊天字卡的「随口回应」与「回应」等主题组也互有同文（main 实测 246 条重复）。
// 修复（src/js/default-cards.js #849a/b，零机型分支）：加载期统一去重——
//   ① 所有系统预设分类：组内同文只留第一张；
//   ② dict（内置 dict + dict_ext + 自建词条，在 mergeDictCustom 重建链上）与 main：整个分类跨分组判重，
//      分组顺序即优先级，先出现的分组保留（「嗯」留在「词库」，切词词典 dream-free.js 只读 词库* 分组，不受影响）。
// 断言（本脚本绿＝修复在位；SERVE_DIR 指向纯 HEAD 副本构建产物 → D1~D6 应红＝判别力确认）：
//   D1 全部分类组内零重复  D2 dict/main 分类内跨组零重复  D3 用户点名口径：「嗯」在词典里只有一处
//   D4 切词词典（词库* 分组）仍非空且关键功能字不受去重影响  D5 词典页角标 = 独立重算的唯一词条数
//   D6 拼字抽卡池（getDefaultCardGroups('dict') 合计）无同文
// 用法：node tools/verify-card-dedup.mjs
//       仓外副本验证：SERVE_DIR=<构建目录> node tools/verify-card-dedup.mjs
// verify-suite:timeout=120000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_DIR || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 90));
const profile = join(process.env.TEMP || '/tmp', 'mochi-849-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {} process.exit(1); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 260)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
};
let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + desc); }
  else { fail++; console.log('FAIL  ' + desc + (detail === undefined ? '' : '  [' + JSON.stringify(detail).slice(0, 300) + ']')); }
}

// ---- 启动到桌面（开屏滑到底→进入→关掉问答/协议遮罩；夹具显式解锁二级锁，否则系统预设整池为空） ----
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:cardlock-state','open');}catch(e){}" });
await cdp('Page.navigate', { url: baseUrl + '/index.html?v849=' + Date.now() });
for (let i = 0; i < 120; i++) {
  if (await evalJs("!!window.xyStore && !!window.__mochiLoaded && (!window.__mochiExtFiles || window.__mochiExtFiles.every(function(f){return window.__mochiLoaded.indexOf(f)>=0;}))")) break;
  await sleep(250);
}
await sleep(1000);
await evalJs("(function(){var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
await sleep(700);
await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
await sleep(400);

// ---- 独立重算（不复用修复本体函数，自己遍历 window.DEFAULT_CARD_DATA 判重） ----
const SCAN = "(function(){" +
  "var D=window.DEFAULT_CARD_DATA||{};" +
  "var intra=[],cross=[],cats=0;" +
  "Object.keys(D).forEach(function(k){" +
  "  var gs=D[k];if(!Array.isArray(gs))return;cats++;" +
  "  var catSeen=(k==='dict'||k==='main')?Object.create(null):null;" +
  "  gs.forEach(function(g){" +
  "    if(!g||!Array.isArray(g[1]))return;var seen=Object.create(null);" +
  "    g[1].forEach(function(c){" +
  "      if(typeof c!=='string')return;" +
  "      if(seen[c]){intra.push(k+'/'+g[0]+':'+c);}else{seen[c]=1;}" +
  "      if(catSeen&&catSeen[c]&&catSeen[c]!==g[0]){cross.push(k+':'+c+' ('+catSeen[c]+' | '+g[0]+')');}else if(catSeen&&!catSeen[c]){catSeen[c]=g[0];}" +
  "    });" +
  "  });" +
  "});" +
  "var uniq=function(arr){var m=Object.create(null),n=0;arr.forEach(function(x){if(!m[x]){m[x]=1;n++;}});return n;};" +
  "var dictGroups=(window.getDefaultCardGroups?window.getDefaultCardGroups('dict'):[]);" +
  "var pool=[];dictGroups.forEach(function(g){(g[1]||[]).forEach(function(c){if(typeof c==='string')pool.push(c);});});" +
  "var ck=function(name){var g=dictGroups.filter(function(x){return x[0]===name;})[0];return g?g[1].length:0;};" +
  "var hen=dictGroups.reduce(function(n,g){return n+((g[1]||[]).indexOf('嗯')>=0?1:0);},0);" +
  "var lib=document.getElementById('dc-dict-count');" +
  "return JSON.stringify({cats:cats,intra:intra,cross:cross,poolN:pool.length,poolUnique:uniq(pool)," +
  "dictBadge:lib?String(lib.textContent):null," +
  "wordbook:ck('词库'),baseHanzi:ck('基础汉字'),hen:hen," +
  "youInWordbook:(function(){var g=dictGroups.filter(function(x){return x[0]==='词库';})[0];return !!g&&g[1].indexOf('你')>=0&&g[1].indexOf('嗯')>=0;})()});" +
  "})()";
const scan = JSON.parse((await evalJs(SCAN)) || 'null');
check('D0 数据包真值在位（分类数 >=15、词典抽卡池 >1 万条）', !!scan && scan.cats >= 15 && scan.poolN > 10000, scan && { cats: scan.cats, poolN: scan.poolN });
check('D1 全部分类组内零重复（同组同文不列两行）', !!scan && scan.intra.length === 0, scan && scan.intra.slice(0, 6));
check('D2 词典/默认聊天字卡分类内跨组零重复', !!scan && scan.cross.length === 0, scan && scan.cross.slice(0, 6));
check('D3 用户点名口径：「嗯」在整个词典分类只出现一处', !!scan && scan.hen === 1, scan && scan.hen);
check('D4 切词词典未受损伤（词库分组非空且「你」「嗯」仍在词库）', !!scan && scan.wordbook > 500 && scan.youInWordbook, scan && { wordbook: scan.wordbook, youInWordbook: scan.youInWordbook });
check('D5 词典页角标 = 抽卡池唯一条数（列表与角标同口径、无重复行）', !!scan && scan.poolN === scan.poolUnique && scan.dictBadge === String(scan.poolN), scan && { dictBadge: scan.dictBadge, poolN: scan.poolN, poolUnique: scan.poolUnique });
check('D6 基础汉字分组未整组清空（去重留第一处，不是删光）', !!scan && scan.baseHanzi > 200, scan && scan.baseHanzi);
const jsErr = await evalJs("(window.__jsErrors||[]).slice(0,3)");
check('D7 全程零 JS 异常', !jsErr || !jsErr.length, jsErr);

try { await cdp('Browser.close'); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
console.log(fail ? '\n❌ ' + fail + ' 项失败 / ' + pass + ' 通过' : '\n✅ ' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);

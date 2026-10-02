// ===== 回归验证：#617 图片「闪一下／重新加载」第三轮 =====
// 用户报障（红米 K80 Chrome，2026-09-16，明说其他设备型号也有）：
//   ①「聊天里头像互动……每次打开，图片都会闪烁和重新加载」；
//   ②「头像互动点击给联系人换头像，图片会闪和重新加载」。
// 前两轮 #508 / #509（tools/verify-image-flash.mjs）收的是「网格整格重建」，网格侧已零重建；
// 本轮两条根因都在它们的覆盖面之外：
//
//  【A｜头像】chat.js fillAvatar() 无条件 el.innerHTML='' + 新建 img + 赋 src。
//     于是每一次调用都把该位置的头像换成新节点：旧节点先被清空（该位置空一帧）＋新节点从零解码。
//     触发面最广的是「头像互动里点一张换头像」→ refreshChatAvatars() 把**全部**已渲染消息的头像
//     与顶栏一起换（无头 390×844 实测：16~17 个 img 节点新建、17 次 load），回前台 / 切桌面
//     （avatar-lib 的 convergeAvatars）走同一条路——真机常切前后台，所以比无头更常见。
//     修复：值没变＝DOM 一律不碰（el.__avApplied 守卫）；值变了只改现有 img 的 src，不拆节点
//     （浏览器会继续画旧图直到新图解好，不出现空帧）。
//     A1/A2 就是判别位：只把守卫留着但值变了仍拆节点（或反过来）都过不了。
//
//  【B｜字卡库表情包页】chatcard.js 的图片回收池键曾用 ccImgKey()＝「原始字符串」djb2 指纹。
//     同一张卡在库里天然有两种形态：≥64KB 的原始 dataURL，与后台令牌化 pass 落盘后的 @@m: 令牌
//     （ccPoolAdopt 的 isImg 判定本来就同时认这两种）。形态一翻键就变 ⇒ 池全 miss ⇒ 已解码节点
//     成孤儿、整格新建重解码＝「每次打开都重新加载」。小图（<64KB）不被令牌化，所以只用小图夹具
//     的旧脚本永远测不出——这正是它躲过 #508/#509/#547 三轮的原因。
//     修复：池键改走 ccMediaCardIdent（令牌↔原文算同一身份，与 #547 同口径）。
//     B1 判别位：先把库渲染成令牌形态（回收进池），再把库换回原始 dataURL 形态重新渲染——
//     键稳定则节点被复用（fresh=0），键按原文算则整格新建（fresh=全部）。
//
// 用法：node tools/verify-img-noreload.mjs
//   MOCHI_SERVE_ROOT=<目录> 可对其他构建产物做红绿对照
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9710 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-613-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 24117RK2CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36' });

// 探针：img 新建计数 + load 事件计数（load ＝ 真的重新解码/重新取图）
const PROBE = `
(function(){
  window.__p613 = { create:0, loads:0 };
  var dc = document.createElement.bind(document);
  document.createElement = function(t){
    if (String(t).toLowerCase() === 'img') window.__p613.create++;
    return dc(t);
  };
  document.addEventListener('load', function(e){
    if (e.target && e.target.tagName === 'IMG') window.__p613.loads++;
  }, true);
  window.__p613Reset = function(){ window.__p613.create = 0; window.__p613.loads = 0; };
})();
`;
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function waitReady() {
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1000);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(500);
}
async function goto(url) { await cdp('Page.navigate', { url }); await sleep(2500); await waitReady(); }

// 24 张小图（头像池用）；贴纸用 >64KB 大图（会被令牌化，进 B 段）
const mkSmall = (n) => 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(' + (n * 37) + ',60%,55%)"/><text x="8" y="40" font-size="28" fill="white">' + n + '</text></svg>').toString('base64');
const mkBig = (n) => 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="hsl(' + (n * 37) + ',60%,55%)"/><text x="40" y="180" font-size="140" fill="white">' + n + '</text><!--' + 'p'.repeat(70000) + '--></svg>').toString('base64');
const AVATARS = JSON.stringify(Array.from({ length: 24 }, (_, i) => mkSmall(i)));
const STICKERS = Array.from({ length: 12 }, (_, i) => mkBig(i));

// JS 异常收集
const ERR_HOOK = "window.__err613 = window.__err613 || []; window.addEventListener('error', function(e){ window.__err613.push(String(e.message)); });";
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: ERR_HOOK });

await goto(baseUrl + '/index.html');
// 种子：头像池 24 张 + 30 条聊天记录（一半带图）+ 大图贴纸库（走 IDB，重载后生效）
await evalJs('(function(){window.activeStore().set("avatar-lib",' + AVATARS + ');window.xyStore("xy-home-v2").set("cc-scope-migrated","1");return true;})()');
await evalJs('(function(){var lib=' + AVATARS + ';var out=[];var now=Date.now();for(var i=0;i<30;i++){var w=(i%2===0);out.push({side:(w?"out":"in"),ts:now-(30-i)*60000,text:(w?"[表情包]":"聊天文字 "+i),parts:(w?[{k:"img",v:lib[i%lib.length]}]:[{k:"text",v:"聊天文字 "+i}])});}window.activeStore().set("chat-msgs",JSON.stringify(out));return out.length;})()');
await evalJs('(async function(){var g={text:[],kaomoji:[],emoji:[],sticker:[["大图分组",' + JSON.stringify(STICKERS) + ']],image:[],poke:[],voice:[]};var j=JSON.stringify(g);window.activeStore().set("cc-groups",j);if(window.idbSet){try{await window.idbSet(window.activePrefix()+":cc-groups",j);}catch(e){}}return true;})()');
await sleep(2500);
await goto(baseUrl + '/index.html');
// 头像池/生效头像都是字符串键：重载后再补种一次（启动期 idbRestore 会按 IDB 权威值回填，
// 先种的可能被冲掉）。cs-avatar-* 显式给值，气泡才有 <img>（否则是占位 svg，测不到节点复用）。
await evalJs('(function(){var av=' + AVATARS + ';window.activeStore().set("avatar-lib",JSON.stringify(av));window.activeStore().set("cs-avatar-partner",av[0]);window.activeStore().set("cs-avatar-user",av[1]);return true;})()');
await sleep(1000);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
await sleep(2200);
await evalJs('(function(){if(window.refreshChatAvatars)window.refreshChatAvatars();return true;})()');
await sleep(1500);

// ===================== S 段：环境闸门 =====================
const msgAvN = await evalJs("document.querySelectorAll('#chat-body .msg-av img').length");
check('S1 聊天已渲染出气泡头像（真实路径可达）', msgAvN >= 8, 'msg-av img = ' + msgAvN);

// ===================== A 段：头像互动点选换头像 =====================
await evalJs('(function(){if(window.openAvlib)window.openAvlib();return true;})()');
await sleep(1200);
const avN = await evalJs("document.querySelectorAll('#avlib-grid img').length");
check('S2 头像互动可打开且头像池非空', avN >= 8, 'avlib img = ' + avN);
// 标记聊天里所有头像节点（气泡 + 顶栏）
await evalJs("(function(){document.querySelectorAll('#chat-body .msg-av img').forEach(function(im,n){im.__pid='m'+n;});document.querySelectorAll('#chat-partner-av img').forEach(function(im){im.__pid='h';});window.__p613Reset();return true;})()");
await evalJs("(function(){var im=document.querySelectorAll('#avlib-grid img')[2];if(im)im.click();return true;})()");
await sleep(2500);
const aResRaw = await evalJs(`(function(){
  var avs = document.querySelectorAll('#chat-body .msg-av img');
  var kept=0, lost=0;
  avs.forEach(function(im){ if (im.__pid) kept++; else lost++; });
  var h = document.querySelector('#chat-partner-av img');
  // 功能面：界面显示的头像必须等于存储里的当前值（换头像路径带随机「邀请」分支可能回滚，
  // 所以断言「DOM 与存储一致」而不是断言某一具体下标——两者都比「没换来」强）
  var want = window.activeStore().get('cs-avatar-partner') || '';
  var headOk = !!h && !!want && h.getAttribute('src') === want;
  var bubbleOk = false;
  avs.forEach(function(im){ if (im.getAttribute('src') === want) bubbleOk = true; });
  var nowIdx=-1, nowOk=false;
  var cells = document.querySelectorAll('#avlib-grid .avlib-cell');
  cells.forEach(function(d,n){ if (d.classList.contains('avlib-now')) nowIdx=n; });
  if (nowIdx >= 0) { var ni = cells[nowIdx].querySelector('img'); nowOk = !!ni && ni.getAttribute('src') === want; }
  return JSON.stringify({ n:avs.length, kept:kept, replaced:lost,
    headKept: !!(h && h.__pid), headIsNew: headOk,
    funcOk: headOk && bubbleOk && nowOk, funcWant: want, funcHead: headOk, funcBubble: bubbleOk, funcNow: nowOk,
    created: window.__p613.create, loads: window.__p613.loads, nowIdx: nowIdx });
})()`);
const aRes = aResRaw ? JSON.parse(aResRaw) : null;
check('A1 换头像后聊天气泡头像 img 节点全部保留（不再整列重建/重新解码，#617）',
  !!aRes && aRes.n >= 8 && aRes.replaced === 0, JSON.stringify(aRes));
check('A2 聊天顶栏头像 img 节点同样保留（不再拆节点）',
  !!aRes && aRes.headKept === true, aRes ? 'headKept=' + aRes.headKept : 'null');
check('A3 功能不回归：顶栏与气泡显示的就是存储里的当前头像，池高亮与之一致',
  !!aRes && aRes.funcOk === true, aRes ? 'want=' + (aRes.funcWant || '').slice(0, 24) + '… head=' + aRes.funcHead + ' bubble=' + aRes.funcBubble + ' nowMatch=' + aRes.funcNow : 'null');

// A4：值没变时重复刷新，DOM 必须一动不动（原实现每次都整列重建）——先重新打标，只量本轮
await evalJs("(function(){document.querySelectorAll('#chat-body .msg-av img').forEach(function(im,n){im.__pid2='r'+n;});window.__p613Reset();return true;})()");
await evalJs('(function(){window.refreshChatAvatars();window.refreshChatAvatars();return true;})()');
await sleep(1200);
const a4 = await evalJs("JSON.stringify({created:window.__p613.create,loads:window.__p613.loads,replaced:(function(){var l=0;document.querySelectorAll('#chat-body .msg-av img').forEach(function(im){if(!im.__pid2)l++;});return l;})()})");
const a4j = a4 ? JSON.parse(a4) : null;
check('A4 值没变时重复 refreshChatAvatars：零新建 / 零替换（本轮）',
  !!a4j && a4j.created === 0 && a4j.replaced === 0, a4);

await evalJs('(function(){if(window.closeAvlib)window.closeAvlib();return true;})()');
await sleep(600);

// ===================== B 段：字卡库表情包页 池键跨「dataURL ↔ 令牌」形态稳定 =====================
// 先把库渲染成令牌形态（回收进池）→ 再把库换回原始 dataURL 形态 → 重新渲染。
// 键稳定 ⇒ 节点复用（fresh=0）；键按原文算 ⇒ 整格新建（fresh=全部）。
const tokN = await evalJs('(function(){return (window.mochiMediaTokenize?1:0)})()');
check('S3 媒体令牌化接口可用（B 段前提）', tokN === 1, 'mochiMediaTokenize=' + tokN);

// 1) 先渲染「原文形态」——此时还没跑令牌化 pass，字卡库读到的就是库里的原始 dataURL。
//    顺序很重要：令牌化 pass 一旦跑过，内存池就变令牌形态，这一步就测不到形态翻转了。
async function enterStickerPage() {
  await evalJs("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return true;})()");
  await sleep(1200);
  await evalJs("(function(){var tb=document.querySelector('#page-custom-cards .cc-tab[data-type=\"sticker\"]');if(tb)tb.click();return true;})()");
  await sleep(1800);
}
async function ccSnap(tag) {
  const raw = await evalJs(`(function(){
    var imgs = document.querySelectorAll('#page-custom-cards img');
    var kept=0, fresh=0, live=0, d=0, t=0;
    imgs.forEach(function(im){ if (im.__pid) kept++; else fresh++; if ((im.naturalWidth||0)>0) live++;
      var s = im.getAttribute('src') || ''; if (s.indexOf('data:')===0) d++; else if (s.indexOf('@@m:')===0) t++; });
    var cards = document.querySelectorAll('#page-custom-cards .cc-item');
    var cardFresh=0;
    cards.forEach(function(cd){ if (!cd.__cid) cardFresh++; });
    return JSON.stringify({ tag:'${tag}', n:imgs.length, kept:kept, fresh:fresh, live:live, form:(d>=t?'dataURL':'token'), cards:cards.length, cardFresh:cardFresh });
  })()`);
  return raw ? JSON.parse(raw) : null;
}
async function markAll() {
  await evalJs("(function(){document.querySelectorAll('#page-custom-cards img').forEach(function(im,n){im.__pid='t'+n;});document.querySelectorAll('#page-custom-cards .cc-item').forEach(function(cd,n){cd.__cid='c'+n;});return true;})()");
}
// 在页内切到别的 tab 再切回表情包 tab：这是一次确定会重建卡片的 render（不依赖进出页面）
async function retab() {
  await evalJs("(function(){var tb=document.querySelector('#page-custom-cards .cc-tab[data-type=\"text\"]');if(tb)tb.click();return true;})()");
  await sleep(800);
  await evalJs("(function(){var tb=document.querySelector('#page-custom-cards .cc-tab[data-type=\"sticker\"]');if(tb)tb.click();return true;})()");
  await sleep(1800);
}

await enterStickerPage();
const bFirst = await ccSnap('first-form');
check('B0 表情包页首渲为原文形态（形态翻转对照的前提）',
  !!bFirst && bFirst.n >= 8 && bFirst.form === 'dataURL', JSON.stringify(bFirst));
await markAll();
await retab();                                             // 先自证「切 tab 确实重建卡片」
const bSanity = await ccSnap('sanity');
check('B1 切 tab 会真实重建卡片（本段判据有效性的自证闸门）',
  !!bSanity && bSanity.cardFresh > 0 && bSanity.fresh === 0, JSON.stringify(bSanity));
// 原文形态这一轮写下的池键（data-cc-sig），供翻转后逐项比对
const sigRawArr = await evalJs("JSON.stringify([].slice.call(document.querySelectorAll('#page-custom-cards .cc-item[data-cc-sig]')).map(function(d){return d.dataset.ccSig;}))");

// 2) 触发应用自己的令牌化 pass（ownPoolRaw 建缓存时跑）：内存池变令牌形态，并填好
//    ccTokMemoRev（令牌→短指纹）——池键能否跨形态稳定，靠的就是它。
await evalJs('(function(){void (window.getScopedGroups && window.getScopedGroups("sticker","own"));return true;})()');
let poolForm = '';
for (let i = 0; i < 30; i++) {
  poolForm = await evalJs('(function(){var g=(window.getScopedGroups&&window.getScopedGroups("sticker","own"))||[];if(!g.length||!g[0][1].length)return "nogroup";return String(g[0][1][0]).indexOf("@@m:")===0?"token":"dataURL";})()') || '';
  if (poolForm === 'token') break;
  await sleep(500);
}
check('S4 大图贴纸库已令牌化（B 段能真实走到形态翻转）', poolForm === 'token', 'poolForm=' + poolForm);

// 3) 把 store 换成同一批图的令牌形态（媒体 pass 落盘后字卡库重新读库拿到的就是这个形态），
//    再走一次真实重建：池键稳定 ⇒ 两次渲染写下的 data-cc-sig 完全相同；键按原文算 ⇒ 必然不同。
const flipOk = await evalJs(`(function(){
  try {
    var pool = (window.getScopedGroups && window.getScopedGroups('sticker','own')) || [];
    if (!pool.length || !pool[0][1] || !pool[0][1].length) return 'nopool';
    var g = { text:[], kaomoji:[], emoji:[], sticker:[[pool[0][0], pool[0][1].slice()]], image:[], poke:[], voice:[] };
    window.activeStore().set('cc-groups', JSON.stringify(g));
    var back = JSON.parse(window.activeStore().get('cc-groups'));
    return String(back.sticker[0][1][0]).indexOf('@@m:') === 0 ? 'ok' : 'notoken';
  } catch (e) { return 'err:' + e.message; }
})()`);
check('S5 已把字卡库库内容翻成令牌形态（S4 之后的关键前提）', flipOk === 'ok', 'flip=' + flipOk);
await sleep(1200);
// 让字卡库重新读库（进出一次页面），再从别的 tab 切回表情包 tab 触发真实重建
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return true;})()");
await sleep(900);
await enterStickerPage();
await markAll();
await retab();
const bSecond = await ccSnap('second-form');
const sigTok = await evalJs("JSON.stringify([].slice.call(document.querySelectorAll('#page-custom-cards .cc-item[data-cc-sig]')).map(function(d){return d.dataset.ccSig;}))");
check('B2 形态翻转后仍真实重建了卡片（本段判据有效性自证闸门）',
  !!bSecond && bSecond.cardFresh > 0, bSecond ? 'cardFresh=' + bSecond.cardFresh : 'null');
check('B3 库形态 dataURL↔令牌翻转后，池键（data-cc-sig）逐项不变＝已解码节点可复用（#617）',
  !!sigRawArr && !!sigTok && sigTok !== '[]' && sigRawArr === sigTok,
  'raw=' + String(sigRawArr).slice(0, 90) + ' | tok=' + String(sigTok).slice(0, 90));
check('B4 复用的图确实有解码内容（不是空节点）',
  !!bSecond && bSecond.live === bSecond.n, bSecond ? 'live=' + bSecond.live + '/' + bSecond.n : 'null');

// ===================== Z 段：零 JS 异常 =====================
const errs = await evalJs('JSON.stringify(window.__err613 || [])');
check('Z1 全程 0 JS 异常', errs === '[]', String(errs));

chrome.kill(); server.close();
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

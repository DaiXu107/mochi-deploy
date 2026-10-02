// ===== 回归脚本：#662 表情包面板 / 头像互动「图片闪一下重新加载」第四轮 =====
// 用法：node tools/verify-panel-img-reuse.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// 背景（用户原话，红米 K80 Chrome 等多机型，用户明说其他设备型号也有）：
//   「聊天里头像互动和表情包页面里，点击表情包打开的页面，每次打开，图片都会闪烁和重新加载；
//     头像互动点击给联系人换头像，图片会闪和重新加载」；要求不要覆盖修改导致不同型号设备反复复发。
// 前情：#457（同内容连开短路）→ #508/#509（字卡库页回收池）→ #617（令牌↔原文同身份）三轮分别
//   收口了「连续两次渲染内容完全相同」「字卡库整格重建」「池键随令牌形态翻转」三条路径。本脚本
//   盯的是它们共同漏掉的第 4 条：**内容签名一变（切分组 A→B→A / 切分类 / 令牌化翻转 / IDB 回填
//   后重渲）就整格 innerHTML 重建**——已解码 img 节点被整批丢弃、浏览器从零重新解析每个 dataURL。
// 判据（全部按「行为」而非「名字」）：
//   A 轴（源码锚）：面板重建路径必须走回收池（emojiAdoptImg / emojiClearList）、头像侧必须保留
//                  #617 的落值守卫；
//   B 轴（真实产物 390×844，Android UA）：①首开渲染正常；②切到别的分组再切回**刚看过的分组**
//                 ――img 节点零替换、零 load（修前：12/12 全新建 + 12 次 load，可复现的「闪」）；
//                 ③图真的解码出来了（naturalWidth>0，不是空节点）；④重开面板仍零重建；
//                 ⑤重开时对已加载图调用过 decode()（#662 预解码：位图被浏览器回收时先解完再显示，
//                 这条节点身份测不出、也是前三轮漏掉的机型相关面）；⑥点图仍能发出去（功能不回归）；
//                 ⑦头像互动打开/点选换头像：库网格节点零替换、聊天气泡头像节点全保留且显示值＝存储值。
//   Z 轴：全程零 JS 异常。
// RED 判别（修前产物实测）：②项 kept=0 / replaced=12 / loads=12，⑤项 decode 调用 0 —— 恰红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)));
const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();
const root = normalize(process.env.MOCHI_ROOT || argRoot || join(here, '..'));

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- A 轴：源码锚 ----------
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const avSrc = readFileSync(join(root, 'src/js/avatar-lib.js'), 'utf8');
console.log('A 轴（源码作用域）   root=' + root);
chk('A1 面板保留「内容签名短路」（#457/#547 未回退）', chatSrc.includes('if (_sigTarget && _sigTarget === emojiRenderSig && emojiList.firstElementChild) return;'));
chk('A2 面板新建走回收池（禁止退回无条件 emojiNewImg 整格新建）', chatSrc.includes('function emojiAdoptImg(src)') && chatSrc.includes('const img = emojiAdoptImg(src);'));
chk('A3 一切整格重写都先回收旧节点（emojiList.innerHTML 写入前统一回收）', chatSrc.includes('set: function (v) { emojiPoolHarvest(); _emojiIH.set.call(this, v); }'));
chk('A4 池身份走令牌稳定身份（#547 ccMediaCardIdent，令牌↔原文同身份）', chatSrc.includes('if (window.ccMediaCardIdent) return window.ccMediaCardIdent(src);'));
chk('A5 显示前预解码（#662/#692：解码结算后才显示，等待期关闭即作废）', chatSrc.includes('function emojiShowWhenDecoded(show, token)') && chatSrc.includes('if (token !== undefined && token !== emojiShowToken) return;'));
chk('A6 头像侧 #617 落值守卫未回退（值没变不碰 DOM）', avSrc.includes('if (el.__avApplied === want) return;') && chatSrc.includes("if (el.__avApplied === (data || '')) return;"));
chk('A7 头像互动半框显示前同样预解码（#662/#692 同口径）', avSrc.includes('function avShowWhenDecoded(show, token)') && avSrc.includes('if (token !== undefined && token !== avShowToken) return;'));

// ---------- B 轴：真实产物 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }
if (!existsSync(join(root, 'index.html'))) { console.error('no index.html in ' + root); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const profile = join(process.env.TEMP || '/tmp', 'mochi-v662-' + Date.now());
const cdpPort = 9400 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) {
    const ex = r.exceptionDetails;
    console.error('JS exception:', (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text);
    return null;
  }
  return r && r.result ? r.result.value : null;
}
function cleanup(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(code);
}

// 中等体积贴图（>4096 字符 = 会被令牌化，贴近真机图库形态；小图夹具正是前三轮漏检的原因之一）
const mkMid = (n) => 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="hsl(' + (n * 29) + ',70%,55%)"/>' +
  '<text x="16" y="76" font-size="56" fill="white">' + n + '</text><!--' + 'p'.repeat(6000) + '--></svg>').toString('base64');
const G1 = Array.from({ length: 12 }, (_, i) => mkMid(i));
const G2 = Array.from({ length: 3 }, (_, i) => mkMid(100 + i));
const AVATARS = Array.from({ length: 12 }, (_, i) => mkMid(200 + i));

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; 24117RK2CC Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2.75, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(600);

// 种子（localStorage + IDB 双写，重载后由 idbRestore 权威回填）
const seed = await evalJs(`(async function(){
  var av = ${JSON.stringify(AVATARS)};
  var out = [];
  var now = Date.now();
  for (var i = 0; i < 8; i++) { var w = (i % 2 === 0); out.push({side:(w?'out':'in'),ts:now-(8-i)*60000,text:'聊天 '+i,parts:(w?[{k:'img',v:av[i%av.length]}]:[{k:'text',v:'聊天 '+i}])}); }
  var g = {text:[],kaomoji:[],emoji:[],sticker:[['G1',${JSON.stringify(G1)}],['G2',${JSON.stringify(G2)}]],image:[],poke:[],voice:[]};
  var json = JSON.stringify(g);
  window.xyStore(window.activePrefix()).set('cc-groups', json);
  window.xyStore('xy-home-v2').set('cc-scope-migrated', '1');
  window.xyStore('xy-home-v2').set('emoji-last', JSON.stringify({mode:'ta',ta:'G1',mine:'',pub:'',cat:'sticker'}));
  window.activeStore().set('avatar-lib', JSON.stringify(av));
  window.activeStore().set('cs-avatar-partner', av[0]);
  window.activeStore().set('chat-msgs', JSON.stringify(out));
  if (window.idbSet) {
    try {
      await window.idbSet(window.activePrefix() + ':cc-groups', json);
      await window.idbSet(window.activePrefix() + ':avatar-lib', JSON.stringify(av));
      await window.idbSet(window.activePrefix() + ':chat-msgs', JSON.stringify(out));
    } catch (e) {}
  }
  return 'seeded';
})()`);
await sleep(1200);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1200);
await evalJs("(function(){var av=" + JSON.stringify(AVATARS) + ";window.activeStore().set('avatar-lib',JSON.stringify(av));window.activeStore().set('cs-avatar-partner',av[0]);return 1;})()");
await sleep(800);
const groups = await evalJs("(function(){try{var g=window.getScopedGroups('sticker','own')||[];return JSON.stringify({groups:g.length,n:g.length?g[0][1].length:0});}catch(e){return 'ERR '+e.message;}})()");
chk('B0 种子就绪（专属库两组 G1=12 / G2=3）', groups === '{"groups":2,"n":12}', String(groups || seed));
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(2500);

// 仪表：#emoji-list 内 img 新建 / load / decode
await evalJs(`(() => {
  window.__v = { newImg: 0, loads: 0, decodes: 0 };
  const ce = document.createElement.bind(document);
  document.createElement = function (tag, o) {
    const el = ce(tag, o);
    if (String(tag).toLowerCase() === 'img') window.__v.newImg++;
    return el;
  };
  document.addEventListener('load', function (e) {
    const t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    if (t.closest && t.closest('#emoji-list')) window.__v.loads++;
  }, true);
  const dec = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () {
    try { if (this.closest && this.closest('#emoji-list')) window.__v.decodes++; } catch (e) {}
    return dec.apply(this, arguments);
  };
  window.__vReset = function () { window.__v = { newImg: 0, loads: 0, decodes: 0 }; };
  return 'ok';
})()`);

const chipLabel = (tag) => tag;
const clickChip = async (tag) => {
  const r = await evalJs(`(function(){var cs=document.querySelectorAll('#emoji-groups .emoji-g-chip');for(var i=0;i<cs.length;i++){if(cs[i].textContent.indexOf('${tag}')===0){cs[i].click();return 1;}}return 0;})()`);
  await sleep(1400);
  return r;
};
const stamp = async () => await evalJs("(function(){document.querySelectorAll('#emoji-list img').forEach(function(im,n){im.__v662='s'+n;});return 1;})()");
const keptReport = async () => await evalJs(`(function(){
  var imgs = document.querySelectorAll('#emoji-list img');
  var kept=0, replaced=0, live=0;
  imgs.forEach(function(im){ if(im.__v662) kept++; else replaced++; if(im.naturalWidth>0) live++; });
  return JSON.stringify({n:imgs.length, kept:kept, replaced:replaced, live:live, v:window.__v});
})()`);

// ---- B1 首开渲染 ----
await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return 1;})()");
await sleep(1600);
const b1 = await evalJs("(function(){return JSON.stringify({hidden:(document.getElementById('emoji-panel')||{}).hidden, n:document.querySelectorAll('#emoji-list img').length});})()");
chk('B1 打开表情包面板渲染出 G1 的 12 张图（真实路径可达）', b1 === '{"hidden":false,"n":12}', String(b1));
await stamp();

// ---- B2 切分组再切回刚看过的分组：节点必须原样复用 ----
const c2 = await clickChip('G2');
const b2a = await keptReport();
const c1 = await clickChip('G1');
await evalJs('(function(){window.__vReset();return 1;})()');
await clickChip('G2');
await sleep(200);
const back = await keptReport();
await clickChip('G1');
const b2b = await keptReport();
const b2j = b2b ? JSON.parse(b2b) : null;
chk('B2 切到 G2 正常渲染 3 张（判据有效性自证闸门）', c2 === 1 && b2a && JSON.parse(b2a).n === 3, String(b2a));
chk('B3 切回刚看过的分组：img 节点零替换（修前 12/12 全新建＝「闪一下重新加载」）', !!b2j && b2j.kept === 12 && b2j.replaced === 0, String(b2b));

// ---- B4 重开面板：零重建 + 零 load ----
await stamp(); // 以当前节点为准（B2 段已换过分组），本轮只量「关→再打开」
await evalJs('(function(){window.__vReset();return 1;})()');
await evalJs("(function(){var c=document.getElementById('emoji-close');if(c)c.click();return 1;})()");
await sleep(500);
await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return 1;})()");
await sleep(1400);
const b4raw = await keptReport();
const b4 = b4raw ? JSON.parse(b4raw) : null;
chk('B4 关→再打开：零新建 / 零 load / 节点全保留（#457 短路未回退）',
  !!b4 && b4.kept === 12 && b4.replaced === 0 && b4.v.newImg === 0 && b4.v.loads === 0, String(b4raw));

// ---- B5 重开时对已加载图调用过 decode()（#662 预解码：位图被回收后重开不再逐格重新解码）----
chk('B5 重开面板时对已加载图做过预解码（位图被回收的机型上不再出现空帧/逐个冒出）',
  !!b4 && b4.v.decodes >= 12, 'decodes=' + (b4 ? b4.v.decodes : 'n/a'));

// ---- B6 图真的有解码内容 + 点图仍能发出去（功能不回归）----
chk('B6 复用回来的图确有解码内容（不是空节点）', !!b4 && b4.live === 12, 'live=' + (b4 ? b4.live : 'n/a'));
const before = await evalJs("document.querySelectorAll('#chat-body .msg').length");
await evalJs("(function(){var im=document.querySelectorAll('#emoji-list img')[0];if(im)im.click();return 1;})()");
await sleep(1800);
const after = await evalJs("document.querySelectorAll('#chat-body .msg').length");
chk('B7 点图正常发出消息（功能不回归）', typeof before === 'number' && typeof after === 'number' && after > before, 'msg ' + before + ' -> ' + after);

// ---- B8 头像互动：打开 + 点选换头像 ----
await evalJs("(function(){var c=document.getElementById('emoji-close');if(c)c.click();return 1;})()");
await sleep(400);
await evalJs('(function(){if(window.openAvlib)window.openAvlib();return 1;})()');
await sleep(1600);
const avOpen = await evalJs("(function(){return JSON.stringify({hidden:(document.getElementById('avlib-card')||{}).hidden, n:document.querySelectorAll('#avlib-grid img').length});})()");
chk('B8 头像互动半框可打开且头像池非空', avOpen === '{"hidden":false,"n":12}', String(avOpen));
await evalJs("(function(){document.querySelectorAll('#avlib-grid img').forEach(function(im,n){im.__v662='a'+n;});document.querySelectorAll('#chat-body .msg-av img').forEach(function(im,n){im.__v662c='c'+n;});return 1;})()");
await evalJs("(function(){var im=document.querySelectorAll('#avlib-grid img')[2];if(im)im.click();return 1;})()");
await sleep(2200);
const avRes = await evalJs(`(function(){
  var want = window.activeStore().get('cs-avatar-partner') || '';
  var g = document.querySelectorAll('#avlib-grid img');
  var gKept=0; g.forEach(function(im){ if(im.__v662) gKept++; });
  var avs = document.querySelectorAll('#chat-body .msg-av img');
  var kept=0; avs.forEach(function(im){ if(im.__v662c) kept++; });
  var shown=false; avs.forEach(function(im){ if(im.getAttribute('src')===want) shown=true; });
  var head=document.querySelector('#chat-partner-av img');
  var nowIdx=-1; document.querySelectorAll('#avlib-grid .avlib-cell').forEach(function(d,n){ if(d.classList.contains('avlib-now')) nowIdx=n; });
  return JSON.stringify({wantLen:(want||'').length, grid:g.length, gridKept:gKept, bubbles:avs.length, bubblesKept:kept,
    shownInBubbles:shown, headOk:!!head && head.getAttribute('src')===want, nowIdx:nowIdx});
})()`);
const avJ = avRes ? JSON.parse(avRes) : null;
chk('B9 点选换头像后头像库网格节点零替换（#508/#509 未回退）', !!avJ && avJ.gridKept === avJ.grid, String(avRes));
chk('B10 换头像后聊天气泡头像节点全保留（#617 未回退）', !!avJ && avJ.bubbles > 0 && avJ.bubblesKept === avJ.bubbles, 'bubbles=' + (avJ ? avJ.bubbles + '/' + avJ.bubblesKept : 'n/a'));
chk('B11 功能不回归：气泡/顶栏显示的就是存储里的当前头像，池高亮一致', !!avJ && avJ.shownInBubbles && avJ.headOk && avJ.nowIdx >= 0, String(avRes));

// ---- Z 零异常 ----
const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
chk('Z1 全程零 JS 异常', errs === '[]', String(errs));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
cleanup(fail ? 1 : 0);

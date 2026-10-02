// ===== 回归脚本：#845 朋友圈动态操作栏「贴纸」按钮常驻 + 纯文字动态铺空白底纸承接落位 =====
// 用法：node build.mjs && node tools/verify-feed-sticker-always.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-feed-sticker-always.mjs   （红绿对照：测纯 HEAD 副本时本批应红）
// 背景（用户直派）：「有的手机型号的朋友圈里没有贴纸的功能，直接不显示这个功能，所以不知道有这个功能」——
//   指动态下面那一行操作按钮（赞/评论/收藏）缺【贴纸】。零机型分支：原实现把那颗按钮挂在
//   「这条动态有配图」的条件里（旧形态见 FIX_SENTINELS #845a 删除型），而配图动态要该联系人桌面
//   传过表情包/图片字卡才会被 TA 抽中（默认字卡只补文字/颜文字/emoji，从不补媒体池），
//   没传过的桌面就永远全是纯文字动态 → 入口永不出现在屏幕上。
// 修复：①两处卡片模板（主列表 postCardHtml / 个人页 postCardHtmlAll）按钮无条件渲染；
//   ②contentHtmlFor 的承载层不再只看配图——有贴纸也画（无配图时带 .feed-imgs-blank 底纸样式）；
//   ③feedPickStickerPos 对没有配图的动态先就地铺一张底纸（feedEnsureStickerBox），走同款
//     「点哪里贴哪里」，取消时把这张临时底纸收回（feedPickCtx.blank）。
// 断言面：S 产物锚 / A 纯文字动态有贴纸按钮 / B 面板与 emoji 贴纸组 / C 选位模式（底纸＋提示条）/
//   D 落位与持久（刷新后仍在）/ E 撤回后底纸收回 / F 取消选位不留空卡纸 / Z 零 JS 异常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const artifactJs = art('js/feed.js') || art('index.html');
const artifactCss = art('index.html');

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-sticker-always-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const events = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') events.push('exception:' + JSON.stringify(m.params.exceptionDetails).slice(0, 200));
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.log('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
async function gotoFresh() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
  // 开屏必须走 .hide（base.css `.splash:not(.hide) ~ .phone{visibility:hidden}`——只 hidden/display:none 会让整棵页面树量成不可见）
  await evalJs(`(function(){ var s=document.querySelector('.splash'); if(s) s.classList.add('hide'); var q=document.getElementById('qa-close'); if(q) q.click(); })()`);
  await sleep(400);
  await evalJs(`(function(){ var a=document.querySelector('.app[data-app="feed"]'); if(a) a.click(); })()`);
  await sleep(900);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- S. 产物锚（本批三处改动的逻辑形态） ----
check('S1 产物贴纸按钮无条件渲染（主列表＋个人页两处）', (artifactJs.match(/class="feed-act" data-sticker="/g) || []).length === 2, '实际' + (artifactJs.match(/class="feed-act" data-sticker="/g) || []).length + '处');
check('S2 产物不得再按配图条件决定这颗按钮（旧形态回流即红）', artifactJs.indexOf("|| p.img) ? '<button class=\"feed-act\" data-sticker=\"'") < 0);
check('S3 承载层认贴纸不只认配图（有贴纸也画，否则贴上去不显示）', artifactJs.indexOf('if (imgs.length || hasStickers) {') >= 0);
check('S4 就地铺底纸入口在位（纯文字动态走点选落位而非随机）', artifactJs.indexOf('function feedEnsureStickerBox(post) {') >= 0 && artifactJs.indexOf('blank: made.blank') >= 0);
check('S5 底纸样式进产物（零高度＝贴纸看不见）', artifactCss.indexOf('.feed-imgs.feed-imgs-blank { min-height:132px;') >= 0);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await gotoFresh();

// ---- A. 发一条纯文字动态（无任何配图），操作栏就该有【贴纸】 ----
await evalJs(`(function(){ var b=document.getElementById('feed-publish-btn'); if(b) b.click(); })()`);
await sleep(400);
const typed = await evalJs(`(function(){
  var t=document.getElementById('feed-input'); if(!t) return 'no-input';
  t.value='今天心情很好'; t.dispatchEvent(new Event('input',{bubbles:true}));
  var p=document.getElementById('feed-publish'); if(p) p.click(); return 'ok';
})()`);
await sleep(1200);
const mine = await evalJs(`(function(){
  var cards=[].slice.call(document.querySelectorAll('#feed-list .feed-post'));
  var hit=cards.filter(function(c){ return c.textContent.indexOf('今天心情很好')>=0; })[0];
  if(!hit) return null;
  return { id: hit.id, acts: [].slice.call(hit.querySelectorAll('.feed-act')).map(function(b){ return b.textContent.trim(); }).join('/'), imgs: hit.querySelectorAll('.feed-imgs').length };
})()`);
check('A1 纯文字动态发布成功（夹具前提）', !!mine, typed);
check('A2 该行按钮含【贴纸】（修复前纯文字动态只剩 赞/评论/收藏）', !!mine && /贴纸/.test(mine.acts), mine && mine.acts);
check('A3 未贴时不预先铺底纸（没有贴纸就没有承载层）', !!mine && mine.imgs === 0, mine && 'feed-imgs=' + mine.imgs);

// ---- B/C. 打开贴纸面板 → 选一个 emoji 贴纸 → 进入选位模式（临时底纸 + 提示条） ----
const panel = await evalJs(`(function(){
  var cards=[].slice.call(document.querySelectorAll('#feed-list .feed-post'));
  var hit=cards.filter(function(c){ return c.textContent.indexOf('今天心情很好')>=0; })[0];
  var b=hit && hit.querySelector('.feed-act[data-sticker]'); if(!b) return 'no-btn';
  b.click();
  var card=document.getElementById('feed-sticker-card');
  return { open: card ? !card.hidden : null, chips: [].slice.call(document.querySelectorAll('#feed-sticker-groups .emoji-g-chip')).map(function(c){return c.textContent;}), items: document.querySelectorAll('#feed-sticker-list .emoji-item').length };
})()`);
await sleep(500);
check('B1 点【贴纸】打开选择面板', panel && panel.open === true, JSON.stringify(panel).slice(0, 120));
check('B2 面板有可选条目（含 emoji 贴纸组）', panel && panel.items > 0, panel && 'items=' + panel.items);
const picking = await evalJs(`(function(){
  var it=document.querySelector('#feed-sticker-list .emoji-item'); if(!it) return 'no-item';
  it.click();
  var post=[].slice.call(document.querySelectorAll('#feed-list .feed-post')).filter(function(c){ return c.textContent.indexOf('今天心情很好')>=0; })[0];
  var box=post && post.querySelector('.feed-imgs');
  return { box: !!box, blank: box ? box.className.indexOf('feed-imgs-blank') >= 0 : null, hint: !!(post && post.querySelector('.feed-pick-hint')), h: box ? Math.round(box.getBoundingClientRect().height) : 0, pid: post ? post.id : '' };
})()`);
await sleep(300);
check('C1 纯文字动态选完贴纸即铺出底纸（修复前这里直接随机落位、没有选位）', picking && picking.box === true && picking.blank === true, JSON.stringify(picking).slice(0, 160));
check('C2 选位提示条在位且底纸有高度', picking && picking.hint === true && picking.h > 60, picking && 'h=' + picking.h);

// ---- D. 在底纸上点一下 → 贴纸落位；刷新后仍在（持久化 + 渲染层认贴纸） ----
const placed = await evalJs(`(function(){
  var post=[].slice.call(document.querySelectorAll('#feed-list .feed-post')).filter(function(c){ return c.textContent.indexOf('今天心情很好')>=0; })[0];
  var box=post.querySelector('.feed-imgs'); var r=box.getBoundingClientRect();
  box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.35, clientY: r.top + r.height * 0.4 }));
  return 'sent';
})()`);
await sleep(1500);
const afterPlace = await evalJs(`(function(){
  var post=[].slice.call(document.querySelectorAll('#feed-list .feed-post')).filter(function(c){ return c.textContent.indexOf('今天心情很好')>=0; })[0];
  if(!post) return null; var box=post.querySelector('.feed-imgs');
  return { stickers: post.querySelectorAll('.feed-sticker').length, blank: box ? box.className.indexOf('feed-imgs-blank') >= 0 : null, del: post.querySelectorAll('[data-sticker-del]').length };
})()`);
check('D1 点底纸即落位（贴纸出现在卡片上）', afterPlace && afterPlace.stickers === 1, JSON.stringify(afterPlace) + '/' + placed);
check('D2 落位后承载层是底纸形态（无配图也有显示位）', afterPlace && afterPlace.blank === true);
check('D3 我贴的那张可点撤回', afterPlace && afterPlace.del === 1);
await gotoFresh();
const reloaded = await evalJs(`(function(){
  var post=[].slice.call(document.querySelectorAll('#feed-list .feed-post')).filter(function(c){ return c.textContent.indexOf('今天心情很好')>=0; })[0];
  if(!post) return null; var box=post.querySelector('.feed-imgs');
  return { stickers: post.querySelectorAll('.feed-sticker').length, blank: box ? box.className.indexOf('feed-imgs-blank') >= 0 : null, acts: [].slice.call(post.querySelectorAll('.feed-act')).map(function(b){return b.textContent.trim();}).join('/') };
})()`);
check('D4 刷新后贴纸仍在（数据落盘 + 渲染层认贴纸，不靠配图）', reloaded && reloaded.stickers === 1 && reloaded.blank === true, JSON.stringify(reloaded));
check('D5 刷新后该行仍有【贴纸】入口', reloaded && /贴纸/.test(reloaded.acts || ''), reloaded && reloaded.acts);

// ---- E. 撤回最后一张 → 底纸随之收回 ----
const retracted = await evalJs(`(function(){
  var el=[].slice.call(document.querySelectorAll('[data-sticker-del]'))[0]; if(!el) return 'no-del';
  el.click(); return 'modal';
})()`);
await sleep(500);
await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); })()`);
await sleep(1200);
const afterRetract = await evalJs(`(function(){
  var post=[].slice.call(document.querySelectorAll('#feed-list .feed-post')).filter(function(c){ return c.textContent.indexOf('今天心情很好')>=0; })[0];
  if(!post) return null;
  return { stickers: post.querySelectorAll('.feed-sticker').length, boxes: post.querySelectorAll('.feed-imgs').length };
})()`);
check('E1 撤回最后一张贴纸后底纸收回（不残留空卡纸）', retracted === 'modal' && afterRetract && afterRetract.stickers === 0 && afterRetract.boxes === 0, JSON.stringify(afterRetract));

// ---- F. 选位中途取消 → 临时底纸不留 ----
const cancel = await evalJs(`(function(){
  var post=[].slice.call(document.querySelectorAll('#feed-list .feed-post')).filter(function(c){ return c.textContent.indexOf('今天心情很好')>=0; })[0];
  post.querySelector('.feed-act[data-sticker]').click();
  var it=document.querySelector('#feed-sticker-list .emoji-item'); if(it) it.click();
  var before=!!document.querySelector('.feed-imgs.feed-imgs-blank');
  var btn=document.querySelector('.feed-pick-hint button'); if(btn) btn.click();
  return { before: before, after: !!document.querySelector('.feed-imgs.feed-imgs-blank'), hint: !!document.querySelector('.feed-pick-hint') };
})()`);
await sleep(400);
check('F1 取消选位即收回临时底纸与提示条', cancel && cancel.before === true && cancel.after === false && cancel.hint === false, JSON.stringify(cancel));

// ---- Z. 零未捕获异常 ----
const jsErrors = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(-5).join(' | '); })()`);
check('Z1 全程零未捕获异常', events.length === 0 && !jsErrors, (events[0] || '') + ' | ' + (jsErrors || ''));

await server.close(); chrome.kill();
const failed = results.filter(r => !r.ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + (failed ? ' 失败 ' + failed : ' 全绿'));
process.exit(failed ? 1 : 0);

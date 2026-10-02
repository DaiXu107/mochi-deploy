// ===== 回归脚本：#847 朋友圈三处评论入口缺口（个人页点【评论】没反应 + 评论面板没有 emoji 组 + 个人页单卡刷新打在隐藏那份上）=====
// 用法：node build.mjs && node tools/verify-feed-comment-entry.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-feed-comment-entry.mjs （红绿对照：跑纯 HEAD 副本本批应红）
// 背景（#845 收口后用户点定的两项，零机型分支）：
//   ①「个人页点评论没反应」——评论条 #feed-comment-bar 与评论面板 #feed-comment-panel 只写在
//     #page-feed 里，而「全部朋友圈/个人页」#page-feed-all 是另一个 .page（同级兄弟）。在该页点
//     【评论】＝把一个隐藏祖先的子节点取消隐藏 → 屏幕上什么都不出现，看起来像按钮坏了。
//     修＝showCommentBar 先调 feedCommentBarAdopt()，把这两个节点搬挂到当前可见的那一页（同一实例，
//     不重复 id、不重绑监听）。
//   ②「评论条贴纸面板没有 emoji 组」——面板只有 TA 的/我的两个图片表情包 tab，没传过表情包的桌面
//     打开只看到一句「暂无表情包」，与动态侧贴纸面板（#669 起有 emoji 组）不对等。
//     修＝加第三个 tab（em），条目走文字网格（emoji-grid-text / emoji-text-item），点击把 emoji 追加进
//     评论输入框（不进 comImgData，不占 9 张图上限）。
// 断言面：S 产物锚 / A 个人页评论条真出现在屏上＋落位正确＋发得出 / R 回主列表换爹 / B emoji 组可选可插 /
//   C 发出去带 emoji / Z 零 JS 异常。
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
  '--user-data-dir=' + join(tmpdir(), 'mochi-comment-entry-' + Date.now()),
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
async function gotoFeed() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
  // 开屏必须走 .hide（base.css `.splash:not(.hide) ~ .phone{visibility:hidden}`）
  await evalJs(`(function(){ var s=document.querySelector('.splash'); if(s) s.classList.add('hide'); var q=document.getElementById('qa-close'); if(q) q.click(); })()`);
  await sleep(400);
  await evalJs(`(function(){ var a=document.querySelector('.app[data-app="feed"]'); if(a) a.click(); })()`);
  await sleep(900);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- S. 产物锚（本批两处修复的逻辑形态） ----
check('S1 显示评论条前调一次搬挂（删＝个人页点评论照旧没反应）', (artifactJs.match(/feedCommentBarAdopt\(\);/g) || []).length === 1, '实际' + (artifactJs.match(/feedCommentBarAdopt\(\);/g) || []).length + '处');
check('S2 搬挂认「当前可见那一页」且幂等（改成固定挂 #page-feed＝个人页复发）', artifactJs.indexOf("const host = all && !all.hidden ? all : document.getElementById('page-feed');") >= 0 && artifactJs.indexOf('if (!host || comBar.parentNode === host) return;') >= 0);
const tabBtns = (artifactJs.match(/<button class="emoji-tab[^"]*" data-cs-tab="/g) || []).length;
check('S3 评论面板三个 tab 按钮（缺 em＝用户点不到 emoji 组；注意 data-cs-tab=" 另有 1 处是 htsHide 的选择器，故按按钮计数）', tabBtns === 3 && ['ta', 'mine', 'em'].every(v => artifactJs.indexOf('data-cs-tab="' + v + '"') >= 0), '按钮' + tabBtns + '个');
check('S4 emoji 分组源在位（em tab 有内容可列）', artifactJs.indexOf("if (comStickerTab === 'em') return [['emoji \\u8868\\u60c5', FEED_STICKER_EMOJI]];") >= 0);
check('S5 emoji 走文本网格（漏 isEmoji 判定＝emoji 当图片 src 渲染成坏图）', artifactJs.indexOf("grid.className = isEmoji ? 'emoji-grid emoji-grid-text emoji-grid-emoji' : 'emoji-grid';") >= 0);
check('S6 点 emoji 进输入框而非图片附件（改回 push＝emoji 变图片、占 9 张图上限）', artifactJs.indexOf("if (comInput) comInput.value = (comInput.value || '') + src;") >= 0);
check('S7 单卡定位按可见页取（两页同 id＝getElementById 只会拿到隐藏那份，个人页刷新/贴纸选位打在看不见的卡上）', artifactJs.indexOf("const scope = all && !all.hidden ? document.getElementById('feed-all-list') : document;") >= 0 && artifactJs.indexOf('const post = feedPostEl(pid);') >= 0);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await gotoFeed();

// ---- 夹具：发一条纯文字动态，进它的个人页 ----
await evalJs(`(function(){ var b=document.getElementById('feed-publish-btn'); if(b) b.click(); })()`);
await sleep(400);
await evalJs(`(function(){
  var t=document.getElementById('feed-input'); if(!t) return 'no-input';
  t.value='个人页评论入口体检'; t.dispatchEvent(new Event('input',{bubbles:true}));
  var p=document.getElementById('feed-publish'); if(p) p.click(); return 'ok';
})()`);
await sleep(1400);
const enter = await evalJs(`(function(){
  var cards=[].slice.call(document.querySelectorAll('#feed-list .feed-post'));
  var hit=cards.filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  if(!hit) return 'no-post';
  var av=hit.querySelector('.feed-head-av'); if(!av) return 'no-av';
  av.click();
  var ap=document.getElementById('page-feed-all');
  var all=[].slice.call(document.querySelectorAll('#feed-all-list .feed-post'));
  var target=all.filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  return { pageVisible: ap ? !ap.hidden : null, hasCard: !!target, btn: target ? !!target.querySelector('.feed-act[data-comment]') : false };
})()`);
await sleep(600);
check('A1 个人页已进入（夹具前提：#page-feed-all 可见且那条动态在里面、有【评论】按钮）', enter && enter.pageVisible === true && enter.hasCard === true && enter.btn === true, JSON.stringify(enter));

// ---- A. 个人页点【评论】→ 评论条真的出现在屏上 ----
const tapCom = await evalJs(`(function(){
  var all=[].slice.call(document.querySelectorAll('#feed-all-list .feed-post'));
  var target=all.filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  if(!target) return 'no-card';
  target.querySelector('.feed-act[data-comment]').click();
  var bar=document.getElementById('feed-comment-bar');
  if(!bar) return 'no-bar';
  var r=bar.getBoundingClientRect();
  return { shown: !bar.hidden, h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
    onScreen: r.height > 20 && r.top >= 0 && r.bottom <= (window.innerHeight || 844) + 2,
    parent: bar.parentNode ? bar.parentNode.id : '', instances: document.querySelectorAll('.feed-comment-bar').length,
    focusOk: document.getElementById('feed-comment-input') === document.activeElement };
})()`);
await sleep(500);
check('A2 个人页点【评论】后评论条取消隐藏（修复前：只把隐藏页里的子节点 hidden=false，屏上无变化）', tapCom && tapCom.shown === true, JSON.stringify(tapCom));
check('A3 评论条量得出高度且在视口内（真看得见，不是 hidden 祖先里的幽灵节点）', tapCom && tapCom.onScreen === true && tapCom.h > 20, tapCom && 'h=' + tapCom.h + ' top=' + tapCom.top);
check('A4 评论条已搬挂到可见的个人页（同一实例、全站唯一）', tapCom && tapCom.parent === 'page-feed-all' && tapCom.instances === 1, tapCom && 'parent=' + tapCom.parent + ' n=' + tapCom.instances);

// ---- B. 面板三个 tab + emoji 组可选可插 ----
const tabs = await evalJs(`(function(){
  var b=document.getElementById('feed-comment-sticker'); if(!b) return 'no-ico';
  b.click();
  var host=document.getElementById('feed-comment-panel');
  return { hostParent: host ? host.parentNode.id : '', panelOpen: !!host && !host.hidden,
    tabs: [].slice.call(document.querySelectorAll('#feed-comment-panel [data-cs-tab]')).map(function(x){ return x.getAttribute('data-cs-tab'); }) };
})()`);
await sleep(400);
check('B1 评论面板也搬挂到了个人页并打开（面板与评论条同爹）', tabs && tabs.hostParent === 'page-feed-all' && tabs.panelOpen === true, JSON.stringify(tabs));
check('B2 面板有第三个 tab：em（修复前只有 ta/mine）', tabs && tabs.tabs.indexOf('em') >= 0, tabs && tabs.tabs.join('/'));
const emTab = await evalJs(`(function(){
  var t=document.querySelector('#feed-comment-panel [data-cs-tab="em"]'); if(!t) return 'no-tab';
  t.click();
  var list=document.getElementById('com-sticker-list');
  return { items: list.querySelectorAll('.emoji-text-item').length, imgs: list.querySelectorAll('img').length,
    empty: /暂无表情包|点击上方分组/.test(list.textContent), first: list.querySelector('.emoji-text-item') ? list.querySelector('.emoji-text-item').textContent : '' };
})()`);
await sleep(300);
check('B3 点 em 即出 emoji 网格（不必再点一次分组条；修复前这里停在「暂无表情包/点击上方分组」）', emTab && emTab.items > 0 && emTab.empty === false, JSON.stringify(emTab));
check('B4 emoji 当文本渲染不当图片（有 img＝坏图）', emTab && emTab.imgs === 0 && emTab.first.length > 0, emTab && 'imgs=' + emTab.imgs + ' first=' + emTab.first);
const picked = await evalJs(`(function(){
  var it=document.querySelector('#com-sticker-list .emoji-text-item'); if(!it) return 'no-item';
  var f=it.textContent; it.click(); it.click();
  var bar=document.getElementById('feed-comment-bar'); var host=document.getElementById('feed-comment-panel');
  var panel=document.querySelector('#feed-comment-panel .poke-card');
  var v=document.getElementById('feed-comment-input').value;
  return { val: v, twice: v === f + f, emoji: f, pvImgs: document.querySelectorAll('#feed-comment-pv img').length,
    panelOpen: panel ? !panel.hidden : null, hostOpen: host ? !host.hidden : null, barParent: bar.parentNode.id };
})()`);
await sleep(300);
check('B5 连点两次同一个 emoji，输入框值＝它重复两次（多码点 emoji 按字符数会算错，故直接比字符串）', picked && picked.twice === true, picked && JSON.stringify(picked.val));
check('B6 emoji 不进图片附件区（不占 9 张图上限、不会发成坏图）', picked && picked.pvImgs === 0, picked && 'pv=' + picked.pvImgs);
check('B7 选 emoji 后面板保持打开可连选（图片贴纸是选完即关，emoji 连选更顺手且不打断）', picked && picked.panelOpen === true && picked.hostOpen === true, JSON.stringify(picked));

// ---- C. 带着 emoji 发出评论 ----
const emo = picked && picked.emoji ? picked.emoji : '';
const sent = await evalJs(`(function(){
  var i=document.getElementById('feed-comment-input');
  i.value = i.value + ' ok';
  document.getElementById('feed-comment-send').click();
  return 'sent';
})()`);
await sleep(1400);
const landed = await evalJs(`(function(){
  var all=[].slice.call(document.querySelectorAll('#feed-all-list .feed-post'));
  var target=all.filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  if(!target) return null;
  var cs=[].slice.call(target.querySelectorAll('.feed-comments .feed-c-line'));
  return { n: cs.length, txt: cs.map(function(c){return c.textContent;}).join(' | ').slice(0, 200), barHidden: document.getElementById('feed-comment-bar').hidden };
})()`);
check('C1 评论发出去了（个人页这一行从点评论到落盘全链路可用）', landed && landed.n > 0 && /ok/.test(landed.txt), JSON.stringify(landed) + '/' + sent);
check('C2 落盘的评论里带着所选 emoji', landed && !!emo && (landed.txt || '').indexOf(emo) >= 0, landed && 'emoji=' + emo + ' txt=' + (landed.txt || '').slice(0, 60));
check('C3 发送后评论条收起', landed && landed.barHidden === true);

// ---- T. 个人页点【贴纸】：底纸/落位都要落在屏上那张卡（旧实现打在隐藏的主列表卡片上＝没反应） ----
await evalJs(`(function(){
  var t=[].slice.call(document.querySelectorAll('#feed-all-list .feed-post')).filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  if(t) t.querySelector('.feed-act[data-sticker]').click();
})()`);
await sleep(500);
const tPick = await evalJs(`(function(){
  var it=document.querySelector('#feed-sticker-list .emoji-item'); if(!it) return 'no-item';
  it.click();
  var t=[].slice.call(document.querySelectorAll('#feed-all-list .feed-post')).filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  var box=t && t.querySelector('.feed-imgs'); var r=box ? box.getBoundingClientRect() : {height:0};
  return { onVisibleCard: !!box && box.className.indexOf('feed-imgs-blank') >= 0, h: Math.round(r.height),
    hint: !!(t && t.querySelector('.feed-pick-hint')), blankElsewhere: document.querySelectorAll('.feed-imgs-blank').length };
})()`);
await sleep(300);
check('T1 个人页选完贴纸，底纸铺在屏上那张卡（修复前底纸进了隐藏的 #feed-list 卡片，个人页毫无反应）', tPick && tPick.onVisibleCard === true && tPick.h > 60 && tPick.hint === true, JSON.stringify(tPick));
const tPlace = await evalJs(`(function(){
  var t=[].slice.call(document.querySelectorAll('#feed-all-list .feed-post')).filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  var box=t && t.querySelector('.feed-imgs'); if(!box) return 'no-box';
  var r=box.getBoundingClientRect();
  box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.45 }));
  return 'clicked';
})()`);
await sleep(1500);
const tAfter = await evalJs(`(function(){
  var t=[].slice.call(document.querySelectorAll('#feed-all-list .feed-post')).filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  if(!t) return null;
  return { stickers: t.querySelectorAll('.feed-sticker').length, picking: !!t.querySelector('.feed-pick-hint') };
})()`);
check('T2 点底纸即落位且屏上立刻看得见（单卡局部刷新命中可见那份）', tAfter && tAfter.stickers === 1 && tAfter.picking === false, JSON.stringify(tAfter) + '/' + tPlace);

// ---- R. 回到主列表：评论条换回爹且仍可用（搬挂不是单向） ----
const back = await evalJs(`(function(){
  document.getElementById('feed-all-back').click();
  var cards=[].slice.call(document.querySelectorAll('#feed-list .feed-post'));
  var hit=cards.filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  if(!hit) return 'no-card';
  hit.querySelector('.feed-act[data-comment]').click();
  var bar=document.getElementById('feed-comment-bar'); var r=bar.getBoundingClientRect();
  return { parent: bar.parentNode.id, shown: !bar.hidden, h: Math.round(r.height), n: document.querySelectorAll('.feed-comment-bar').length };
})()`);
await sleep(500);
check('R1 回主列表点【评论】，评论条搬回 #page-feed 且可见（换页只换爹、不产生第二实例）', back && back.parent === 'page-feed' && back.shown === true && back.h > 20 && back.n === 1, JSON.stringify(back));

// ---- D. 刷新后仍在（搬挂不改数据） ----
await gotoFeed();
const afterReload = await evalJs(`(function(){
  var cards=[].slice.call(document.querySelectorAll('#feed-list .feed-post'));
  var hit=cards.filter(function(c){ return c.textContent.indexOf('个人页评论入口体检')>=0; })[0];
  if(!hit) return 'no-post';
  var bar=document.getElementById('feed-comment-bar');
  return { comments: hit.querySelectorAll('.feed-comments .feed-c-line').length, parent: bar ? bar.parentNode.id : '', n: document.querySelectorAll('.feed-comment-bar').length };
})()`);
await sleep(300);
check('D1 刷新后那条动态的评论仍在（持久化未受影响）', typeof afterReload === 'object' && afterReload.comments > 0, JSON.stringify(afterReload));
check('D2 刷新后评论条回到默认爹且唯一（搬挂不留残骸）', typeof afterReload === 'object' && afterReload.parent === 'page-feed' && afterReload.n === 1, JSON.stringify(afterReload));

// ---- Z. 零未捕获异常 ----
const jsErrors = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(-5).join(' | '); })()`);
check('Z1 全程零未捕获异常', events.length === 0 && !jsErrors, (events[0] || '') + ' | ' + (jsErrors || ''));

await server.close(); chrome.kill();
const failed = results.filter(r => !r.ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + (failed ? ' 失败 ' + failed : ' 全绿'));
process.exit(failed ? 1 : 0);

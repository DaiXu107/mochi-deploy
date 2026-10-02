// ===== 专项验证：聊天「更多功能」分类 chips + 表情包记住上次模式/分组 =====
// 用法：node tools/verify-more-cats.mjs
// 与其他 verify 脚本同款：不依赖仓库构建产物，从当前 src/ 临时组装页面（镜像 build.mjs
// 拼接顺序），避免与并行会话的官方构建互相干扰。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');

// ---- 从当前 src 临时组装 index.html（顺序与 build.mjs 一致，不做压缩）----
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const styles = cssFiles.map((f) => read(join('css', f))).join('\n');
const scripts = jsFiles.map((f) => {
  const code = read(join('js', f));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} } })();';
}).join('\n');
html = html.replace('/*__STYLES__*/', styles);
html = html.replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify-more-cats');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.15.x-verify');
const tmpHtml = join(tmpdir(), 'mochi-mc-verify-' + Date.now() + '.html');
writeFileSync(tmpHtml, html);

// ---- 静态服务：根路径回临时组装页，其余资源走仓库根 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-mc-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
  // 进入聊天页（关自动回复避免异步行干扰）
  await evalJs("(function(){try{var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');}catch(e){}document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(600);
}
const openMore = async () => { await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()"); await sleep(350); };
const closeMore = async () => { await evalJs("(function(){var p=document.getElementById('chat-more-panel');if(p)p.hidden=true;return true;})()"); };
const clickChip = async (cat) => {
  await evalJs("(function(){var t=document.querySelector('#more-tabs .more-tab[data-mcat=" + cat + "]');if(t)t.click();else window.__chipMiss=(window.__chipMiss||0)+1;return true;})()");
  await sleep(250);
};
const visibleFunIds = async () => J(await evalJs("(function(){var g=document.getElementById('more-grid-fun');if(!g)return'[]';var o=[];g.querySelectorAll('.more-item').forEach(function(it){if(!it.hidden)o.push(it.id);});return JSON.stringify(o);})()"));
const selChip = async () => { const v = await evalJs("(function(){var t=document.querySelector('#more-tabs .more-tab.sel');return t?t.dataset.mcat:'';})()"); return v || ''; };

console.log('---- Part A：更多功能分类（v3.16.x 无重复） ----');
await boot();

// A1 分类 chips=4（chat/game/tool/ask），已移除「常用」
const a1 = await evalJs("(function(){var bar=document.getElementById('more-tabs');if(!bar)return{err:'no-bar'};var cs=[].slice.call(bar.querySelectorAll('.more-tab')).map(function(t){return t.dataset.mcat;});return{n:cs.length,cs:cs};})()") || {};
check('A1 顶部分类 chips=4（chat/game/tool/ask，无常用）', a1.n === 4 && ['chat', 'game', 'tool', 'ask'].every((c) => (a1.cs || []).indexOf(c) >= 0) && (a1.cs || []).indexOf('often') < 0, JSON.stringify(a1));

const CHAT_IDS = ['more-invite', 'more-call', 'more-poke', 'more-rp', 'more-gift', 'more-avatar'];
const GAME_IDS = ['more-rps', 'more-pong', 'more-snake', 'more-brick'];
const TOOL_IDS = ['more-decide', 'more-gdecide', 'more-ask', 'more-search', 'more-divine', 'more-ck', 'more-cjian', 'more-room'];
const ASK_IDS = ['more-ask-now', 'more-choose-now', 'more-curious-now', 'more-roast-now', 'more-invite-now'];

// A2 首次打开默认落在「互动」，显示 6 项（原常用默认项已各自归位，不再重复出现）
await openMore();
let v = await visibleFunIds();
check('A2 默认打开落在「互动」=6项(邀请/通话/拍一拍/红包/礼物/头像互动)', (await selChip()) === 'chat' && v.length === 6 && CHAT_IDS.every((id) => v.indexOf(id) >= 0), JSON.stringify(v));

// A3/A4 各分类过滤正确
await clickChip('game');
v = await visibleFunIds();
check('A3 「小游戏」=4项(猜拳/Pong/贪吃蛇/打砖块)', v.length === 4 && GAME_IDS.every((id) => v.indexOf(id) >= 0), JSON.stringify(v));
await clickChip('tool');
v = await visibleFunIds();
check('A4 「工具」=8项(决定/多人决定/问问/搜索/占卜/查岗/此间/房间)', v.length === 8 && TOOL_IDS.every((id) => v.indexOf(id) >= 0), JSON.stringify(v));

// A5 TA的提问页签保留
await clickChip('ask');
const a5 = await evalJs("(function(){var f=document.getElementById('more-grid-fun');var k=document.getElementById('more-grid-ask');var n=k?k.querySelectorAll('.more-item:not([hidden])').length:0;return{fh:f&&!f.hidden,kh:k&&k.hidden,n:n};})()") || {};
check('A5 「TA的提问」独立网格显示5项', !!a5.fh === false && !a5.kh && a5.n === 5, JSON.stringify(a5));

// A6 分类定义无重复：18 个功能项 + 5 个提问项，id 全唯一
const idsAll = [].concat(CHAT_IDS, GAME_IDS, TOOL_IDS, ASK_IDS);
const seenSet = new Set(idsAll);
check('A6 分类定义 id 全唯一（共23项）', seenSet.size === 23, seenSet.size + ' unique');

// A6b 实际点击各分类，收集可见项：没有 id 出现在两个分类（跨分类零重复）
const a6b = J(await evalJs("(function(){var out={};['chat','game','tool','ask'].forEach(function(c){var t=document.querySelector('#more-tabs .more-tab[data-mcat='+c+']');if(t)t.click();var g=document.getElementById(c==='ask'?'more-grid-ask':'more-grid-fun');var ids=[];if(g)g.querySelectorAll('.more-item').forEach(function(it){if(!it.hidden)ids.push(it.id);});out[c]=ids;});return JSON.stringify(out);})()"));
const domSeen = {};
let domDup = null, total = 0;
for (const c of ['chat', 'game', 'tool', 'ask']) {
  for (const id of a6b[c] || []) { total++; if (domSeen[id]) domDup = domDup || id; domSeen[id] = 1; }
}
check('A6b 实际点击后无跨分类重复（共23项）', !domDup && total === 23, total + ' items' + (domDup ? ' dup=' + domDup : ''));

// A7 记住上次分类：选工具 → 刷新 → 打开仍在工具
await clickChip('tool');
await closeMore();
await boot();
await openMore();
const a7cat = await selChip();
const a7v = await visibleFunIds();
check('A7 刷新后仍停在「工具」分类', a7cat === 'tool' && a7v.length === 8 && TOOL_IDS.every((id) => a7v.indexOf(id) >= 0), a7cat + ' ' + JSON.stringify(a7v));
await closeMore();

console.log('---- Part B：表情包记住上次模式/分组 ----');
// 种子：一个「测试组」含 1 张 1x1 PNG（写入全局 my-emoji-groups 后重启加载）
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await evalJs("(function(){localStorage.setItem('xy-home-v2:my-emoji-groups',JSON.stringify([['测试组',['" + PNG + "']]]));return true;})()");
await boot();

// B1 手动进入 我的+测试组 → 偏好落库
const openEmoji = async () => { await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.click();return true;})()"); await sleep(350); };
await openEmoji();
await evalJs("(function(){var t=document.querySelector('#emoji-panel .emoji-tab[data-etab=mine]');if(t)t.click();return true;})()");
await sleep(250);
await evalJs("(function(){var chips=document.querySelectorAll('#emoji-groups .emoji-g-chip');for(var i=0;i<chips.length;i++){if(chips[i].textContent.indexOf('测试组')===0){chips[i].click();break;}}return true;})()");
await sleep(250);
const b1 = J(await evalJs("(function(){var pref={};try{pref=JSON.parse(window.activeStore().get('emoji-last')||'{}');}catch(e){}var sel=document.querySelector('#emoji-groups .emoji-g-chip.sel');var img=document.querySelectorAll('#emoji-list .emoji-item img').length;return JSON.stringify({mode:pref.mode,mine:pref.mine,chipSel:sel?sel.textContent:'',imgs:img});})()"));
check('B1 选「我的+测试组」后偏好保存(mode/mine)', b1.mode === 'mine' && b1.mine === '测试组' && b1.imgs === 1 && b1.chipSel.indexOf('测试组') === 0, JSON.stringify(b1));

// B2 核心：重启后直接打开表情包 → 自动落在 上次模式+分组，无需再点
await evalJs("(function(){var p=document.getElementById('emoji-panel');if(p)p.hidden=true;return true;})()");
await boot();
await openEmoji();
const b2 = J(await evalJs("(function(){var tab=document.querySelector('#emoji-panel .emoji-tab.sel');var chip=document.querySelector('#emoji-groups .emoji-g-chip.sel');var imgs=document.querySelectorAll('#emoji-list .emoji-item img').length;return JSON.stringify({tab:tab?tab.dataset.etab:'',chip:chip?chip.textContent:'',imgs:imgs});})()"));
check('B2 重启后打开直接落在「我的·测试组」并显示表情', b2.tab === 'mine' && b2.chip.indexOf('测试组') === 0 && b2.imgs === 1, JSON.stringify(b2));

// B3 上传到当前分组后，即使此前无偏好也补存（拦截文件选择框注入合成图片）
await evalJs("(function(){window.activeStore().remove('emoji-last');return true;})()");
await evalJs("(function(){window.__intercepted=0;var proto=HTMLInputElement.prototype;var orig=proto.click;proto.click=function(){if(this&&this.type==='file'){window.__intercepted++;var b64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';var bin=atob(b64);var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);var f=new File([arr],'up.png',{type:'image/png'});try{Object.defineProperty(this,'files',{value:[f],configurable:true});}catch(e){}var el=this;setTimeout(function(){el.dispatchEvent(new Event('change'));},60);proto.click=orig;return;}return orig.call(this);};return true;})()");
await evalJs("(function(){var b=document.getElementById('mye-add');if(b)b.click();return true;})()");
let b3 = null;
for (let i = 0; i < 25; i++) {
  await sleep(300);
  b3 = J(await evalJs("(function(){var pref={};try{pref=JSON.parse(window.activeStore().get('emoji-last')||'null')||{};}catch(e){}var gs=[];try{gs=JSON.parse(localStorage.getItem('xy-home-v2:my-emoji-groups')||'[]');}catch(e){}var tg=gs.filter(function(x){return x[0]==='测试组';})[0];var ic=(window.__intercepted||0);return JSON.stringify({mode:pref.mode,mine:pref.mine,cnt:tg?tg[1].length:0,ic:ic});})()"));
  if (b3.cnt === 2 && b3.mine === '测试组') break;
}
check('B3 上传完成自动把目标分组写入偏好(mode/mine 补存)', b3.ic === 1 && b3.cnt === 2 && b3.mode === 'mine' && b3.mine === '测试组', JSON.stringify(b3));

// B4 再重启 → 仍自动落在 测试组（现在有 2 张）
await evalJs("(function(){var p=document.getElementById('emoji-panel');if(p)p.hidden=true;return true;})()");
await boot();
await openEmoji();
const b4 = J(await evalJs("(function(){var tab=document.querySelector('#emoji-panel .emoji-tab.sel');var chip=document.querySelector('#emoji-groups .emoji-g-chip.sel');var imgs=document.querySelectorAll('#emoji-list .emoji-item img').length;return JSON.stringify({tab:tab?tab.dataset.etab:'',chip:chip?chip.textContent:'',imgs:imgs});})()"));
check('B4 再次重启仍直接落在「我的·测试组」(2张)', b4.tab === 'mine' && b4.chip.indexOf('测试组') === 0 && b4.imgs === 2, JSON.stringify(b4));

// ---- 收尾 ----
const pass = results.filter((r) => r.ok).length;
console.log('==== ' + pass + '/' + results.length + ' 通过 ====');
chrome.kill();
server.close();
process.exit(pass === results.length ? 0 : 1);

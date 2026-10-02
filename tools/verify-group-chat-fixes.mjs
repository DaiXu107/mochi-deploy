// ===== 专项验证：群聊四项修复（group-chat.js，用户反馈）=====
// ① 成员回复带心意字卡（情绪/心意/交流意图，triggerEmotionChain 同链）
// ② 群聊设置可开关「成员昵称显示在头像上方」（show-name）
// ③ 停留页内收发消息自动滚到底部（回看历史时不打扰；发送本身强制回底为常规设计）
// ④ 点聊天气泡弹出操作菜单→引用→发送带引用块
// 用法：node tools/verify-group-chat-fixes.mjs
// 注意：不依赖仓库根目录的构建产物——本脚本从当前 src/ 临时组装页面（镜像
// build.mjs 的拼接顺序），避免与并行会话的官方构建互相干扰。
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
html = html.split('__BUILD_INFO__').join('verify-gcfix');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.16.x-verify');
const tmpHtml = join(tmpdir(), 'mochi-gcfix-verify-' + Date.now() + '.html');
writeFileSync(tmpHtml, html);

// ---- 静态服务：根路径回临时组装页，其余资源走仓库根 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    if (req.url === '/' || req.url.split('?')[0] === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-gcfix-' + Date.now()),
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
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// ---- 静态断言：锚点/登记/链路接线 ----
const sTpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const sGc = readFileSync(join(root, 'src', 'js', 'group-chat.js'), 'utf8');
const sMa = readFileSync(join(root, 'src', 'js', 'mobile-adapt.js'), 'utf8');
const sCss = readFileSync(join(root, 'src', 'css', 'group-chat.css'), 'utf8');
check('S1 template 含 #gc-quote-bar / #gc-msg-actions 锚点', sTpl.indexOf("id=\"gc-quote-bar\"") >= 0 && sTpl.indexOf("id=\"gc-msg-actions\"") >= 0, '');
check('S2 mobile-adapt FLOAT_SELECTORS 已登记 #gc-msg-actions', sMa.indexOf("'#gc-msg-actions'") >= 0, '');
check('S3 group-chat.js 接入 triggerEmotionChain 心意字卡链', sGc.indexOf('window.triggerEmotionChain') >= 0 && sGc.indexOf("rec.mood = chain.map") >= 0, '');
check('S4 show-name 开关 + 昵称渲染 + cs-time-bubble 布局守卫齐备', sGc.indexOf("'show-name': 'off'") >= 0 && sGc.indexOf('gc-from-name') >= 0 && sCss.indexOf('.cs-time-bubble .msg-side .gc-from-name') >= 0, '');
check('S5 新消息自动跟底 followGcBottom 各分支已接', (sGc.match(/followGcBottom\(/g) || []).length >= 6, String((sGc.match(/followGcBottom\(/g) || []).length));

// ---- 群聊回复确定性设置：概率拉满、速度最快、无拍一拍/表情/撤回/多卡 ----
//（注意：群聊键经 saveReplyCfg 写为 reply-gc-gc-* 双前缀，直接手写 reply-gc-* 读不到）
await evalJs("(function(){[['gc-prob','100'],['gc-rs-min','1'],['gc-rs-max','1'],['gc-touch-prob','0'],['gc-reply-min','1'],['gc-reply-max','1'],['gc-sticker-prob','0'],['gc-emoji-prob','0'],['gc-image-prob','0'],['gc-voice-prob','0'],['gc-kaomoji-prob','0'],['gc-quote-prob','0'],['gc-rc-prob','0'],['gc-py-en','0']].forEach(function(kv){window.saveReplyCfg(kv[0],kv[1]);});return JSON.stringify(window.groupChatCfg());})()");
// 关闭聊天页普通回复干扰
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');return true;})()");
// 单成员驯化：getContacts 收敛为 1 人（回复延迟上限 ~4.8s，统一按 6s 预算等待）
await evalJs("(function(){window.getContacts=function(){return [{id:'gct1',name:'测试成员'}];};return true;})()");

// ---- 进入群聊页（桌面图标默认 hidden，测试直接亮出并点击）----
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"group-chat\"]');if(!a)return 'no-app';a.hidden=false;a.click();return document.getElementById('page-group-chat')&&!document.getElementById('page-group-chat').hidden?'in':'not-in';})()");
await sleep(800);
let rEnter = await evalJs("(function(){var p=document.getElementById('page-group-chat');return p&&!p.hidden?'in':'out';})()");
check('T0 进入群聊页', rEnter === 'in', String(rEnter));
// 清空历史消息，保证计数从零开始
await evalJs("(function(){window.groupChatClear();return true;})()");
await sleep(400);

// ---- T组① 心意字卡：驯化 triggerEmotionChain 返回固定链 → 成员回复必带心意字卡 ----
await evalJs("(function(){window.__origTEC=window.triggerEmotionChain;window.triggerEmotionChain=function(){return [{type:'mood',content:'【测】情绪卡'},{type:'heart',content:'【测】心意卡'},{type:'intent',content:'【测】意图卡'}];};return true;})()");
await evalJs("(function(){var i=document.getElementById('gc-input');i.innerText='群聊心意字卡测试一';document.getElementById('gc-send').click();return true;})()");
await sleep(6200); // 回复链路上限 ~4.8s（1-2s 打字 + 1.2-2.8s 条间）
let m1 = J(await evalJs("(function(){var b=document.getElementById('gc-body');var ins=b.querySelectorAll('.msg-in');var last=ins[ins.length-1];var tags=[].map.call(last?last.querySelectorAll('.msg-mood-tag'):[],function(x){return x.textContent;});var msgs=window.groupChatGetMsgs();var rec=msgs[msgs.length-1];return JSON.stringify({inCount:ins.length,tags:tags,moodSaved:!!rec.mood&&rec.mood.length===3,persistTag:rec.mood?String(rec.mood[1].tag):'',scrollAtBottom:(function(){var el=document.getElementById('gc-body');return el.scrollHeight-el.scrollTop-el.clientHeight<4;})()});})()"));
check('T1 成员回复气泡出现情绪/心意/意图三张字卡', m1.inCount >= 1 && m1.tags.join() === '情绪,心意,交流意图', JSON.stringify(m1.tags) + ' in=' + m1.inCount);
check('T2 心意字卡持久化到消息记录（重进不丢）', m1.moodSaved && m1.persistTag === '心意', m1.moodSaved + '/' + m1.persistTag);
check('T3 成员回复后自动滚动到底部（无需手动下滑）', m1.scrollAtBottom === true, 'atBottom=' + m1.scrollAtBottom);
await evalJs("(function(){window.triggerEmotionChain=window.__origTEC;return true;})()");

// ---- T组③ 回看历史时新回复不打扰视口 ----
// 发送后立刻滚离底部（发送本身强制回底是常规设计），在回复落地前处于「回看」状态：
// 收到回复时不应被拽走。先灌旧消息撑出可滚动空间。
await evalJs("(function(){var msgs=[];for(var i=0;i<30;i++){msgs.push({side:'in',cid:null,name:'成员',text:'历史填充'+i+' 哈哈哈哈 哈哈哈哈 哈哈哈哈',ts:Date.now()-60000+i});}var cur=null;try{cur=JSON.parse(localStorage.getItem('xy-home-v2:group-chat-msgs')||'[]');}catch(e){}cur=cur.concat(msgs);try{localStorage.setItem('xy-home-v2:group-chat-msgs',JSON.stringify(cur));}catch(e){}try{if(window.idbSet)window.idbSet('xy-home-v2:group-chat-msgs',JSON.stringify(cur));}catch(e){}return cur.length;})()");
// 不能点返回键（backBtn 会 saveNow 覆盖刚写入 LS 的历史）——直接再点桌面群聊图标重载
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"group-chat\"]');a.click();return true;})()");
// 等 loadMsgs 同步渲染 + IDB 回填重渲落定
await sleep(1500);
await evalJs("(function(){var i=document.getElementById('gc-input');i.innerText='回看历史不打扰测试';document.getElementById('gc-send').click();return true;})()");
await sleep(150); // 发送强制回底发生后，立刻滚回顶部制造「回看中」场景
// #378/#416：跟底闸只认「用户触摸接管」（gcUserGcScrollTouched）——纯程序化 scrollTop=0
// 不置位接管标记，回复落地 followGcBottom 照常拽底（测试假阴性）。先派发 touchstart
// 模拟真实触摸上翻，接管标记置位后 scrollTop=0 才是有效的「回看中」状态。
await evalJs("(function(){var el=document.getElementById('gc-body');try{el.dispatchEvent(new Event('touchstart'));}catch(e){}el.scrollTop=0;return el.scrollTop;})()");
await sleep(6000); // 等回复落地
let m2 = J(await evalJs("(function(){var msgs=window.groupChatGetMsgs();var last=msgs[msgs.length-1];var el=document.getElementById('gc-body');return JSON.stringify({lastSide:last.side,distFromBottom:el.scrollHeight-el.scrollTop-el.clientHeight});})()"));
check('T4 回看顶部期间收到回复不强制拽底', m2.lastSide === 'in' && m2.distFromBottom > 150, 'last=' + m2.lastSide + ' dist=' + Math.round(m2.distFromBottom));
// 贴底状态下新回复继续自动跟底
await evalJs("(function(){var el=document.getElementById('gc-body');el.scrollTop=el.scrollHeight;var i=document.getElementById('gc-input');i.innerText='贴底跟随测试';document.getElementById('gc-send').click();return true;})()");
await sleep(6200);
let m3 = J(await evalJs("(function(){var el=document.getElementById('gc-body');return JSON.stringify({atBottom:el.scrollHeight-el.scrollTop-el.clientHeight<4,lastIn:(function(){var m=window.groupChatGetMsgs();return m[m.length-1].side==='in';})()});})()"));
check('T5 贴底状态下新回复继续自动跟底', m3.atBottom === true && m3.lastIn === true, JSON.stringify(m3));

// ---- T组② 成员昵称显示开关 ----
let nmOff = J(await evalJs("(function(){var b=document.getElementById('gc-body');return JSON.stringify({names:b.querySelectorAll('.msg-in .gc-from-name').length,val:window.groupChatBeautyGet('show-name')});})()"));
check('T6 默认不显示成员昵称（与旧行为一致）', nmOff.names === 0 && nmOff.val !== 'on', JSON.stringify(nmOff));
await evalJs("(function(){window.groupChatBeautySet('show-name','on');return true;})()");
await sleep(500);
let nmOn = J(await evalJs("(function(){var b=document.getElementById('gc-body');var n=b.querySelector('.msg-in .gc-from-name');var side=n?n.parentNode:null;var av=side?side.querySelector('.msg-av'):null;return JSON.stringify({count:b.querySelectorAll('.msg-in .gc-from-name').length,isFirst:side?side.firstElementChild===n:false,aboveAv:(n&&av)?n.offsetTop<=av.offsetTop:false,text:n?n.textContent.trim():''});})()"));
check('T7 开启后昵称显示且位于头像上方', nmOn.count > 0 && nmOn.isFirst && nmOn.aboveAv, JSON.stringify(nmOn));
// 设置面板里行存在且回显正确
await evalJs("(function(){document.getElementById('gc-more-btn').click();document.getElementById('gc-more-settings').click();return true;})()");
await sleep(400);
let nmSet = J(await evalJs("(function(){var rows=[].slice.call(document.querySelectorAll('#gc-set-body .gc-set-row'));var row=rows.filter(function(r){return r.textContent.indexOf('成员昵称显示')>=0;})[0];return JSON.stringify({found:!!row,val:row?row.querySelector('.val').textContent.trim():''});})()"));
check('T8 群聊设置面板有「成员昵称显示」行且回显「头像上方显示」', nmSet.found && nmSet.val === '头像上方显示', JSON.stringify(nmSet));
await evalJs("(function(){window.groupChatBeautySet('show-name','off');var sp=document.getElementById('gc-settings-panel');if(sp)sp.hidden=true;return true;})()");
await sleep(300);

// ---- T组④ 点气泡弹引用框 → 引用发送 ----
// 先滚到底部让目标气泡进入视口（面板定位对视口外气泡会越界，真实用户点的是可见气泡）
await evalJs("(function(){var el=document.getElementById('gc-body');el.scrollTop=el.scrollHeight;return true;})()");
await sleep(300);
let actOpen = J(await evalJs("(function(){var b=document.getElementById('gc-body');var ins=b.querySelectorAll('.msg-in .msg-bubble');var target=null;for(var i=ins.length-1;i>=0;i--){if(ins[i].textContent.indexOf('历史填充')>=0){target=ins[i];break;}}if(!target)return JSON.stringify({found:false});target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));var panel=document.getElementById('gc-msg-actions');return JSON.stringify({found:true,open:panel?!panel.hidden:false,hasQuoteBtn:panel?!!panel.querySelector('[data-act=\"quote\"]'):false,y:panel?panel.style.top:''});})()"));
check('T9 点击成员气泡弹出操作菜单（含「引用」按钮）', actOpen.found && actOpen.open && actOpen.hasQuoteBtn, JSON.stringify(actOpen));
let qBar = J(await evalJs("(function(){var btn=document.querySelector('#gc-msg-actions [data-act=\"quote\"]');btn.click();var bar=document.getElementById('gc-quote-bar');var draft=document.getElementById('gc-draft');return JSON.stringify({barShown:bar?!bar.hidden:false,text:bar?((bar.querySelector('.chat-draft-quote-text')||{}).textContent||''):'',draftShown:draft?!draft.hidden:false,actionsClosed:document.getElementById('gc-msg-actions').hidden});})()"));
check('T10 点「引用」出现引用预览条并带原文', qBar.barShown && String(qBar.text).indexOf('历史填充') >= 0 && qBar.draftShown && qBar.actionsClosed, JSON.stringify(qBar));
await evalJs("(function(){var i=document.getElementById('gc-input');i.innerText='这条是引用回复';document.getElementById('gc-send').click();return true;})()");
await sleep(500);
let qSend = J(await evalJs("(function(){var msgs=window.groupChatGetMsgs();var rec=msgs[msgs.length-1];var b=document.getElementById('gc-body');var outs=b.querySelectorAll('.msg-out');var lastB=outs[outs.length-1];return JSON.stringify({quoteSaved:String(rec.quote||'').indexOf('历史填充')>=0,domQuote:!!lastB.querySelector('.msg-quote'),barHidden:document.getElementById('gc-quote-bar').hidden,inputCleared:document.getElementById('gc-input').innerText===''});})()"));
check('T11 发送的消息带上引用块（存储+DOM+预览条复位）', qSend.quoteSaved && qSend.domQuote && qSend.barHidden && qSend.inputCleared, JSON.stringify(qSend));
// 引用条 ✕ 取消
await evalJs("(function(){var b=document.getElementById('gc-body');var ins=b.querySelectorAll('.msg-in .msg-bubble');ins[ins.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));document.querySelector('#gc-msg-actions [data-act=\"quote\"]').click();var x=document.querySelector('#gc-quote-bar .chat-draft-quote-x');x.click();return true;})()");
let qCancel = J(await evalJs("(function(){return JSON.stringify({barHidden:document.getElementById('gc-quote-bar').hidden,draftHidden:document.getElementById('gc-draft').hidden});})()"));
check('T12 引用预览条 ✕ 可取消', qCancel.barHidden && qCancel.draftHidden, JSON.stringify(qCancel));
// 拍一拍居中条不弹菜单：临时把拍一拍概率拉到 100，真实触发一条拍一拍再点击
await evalJs("(function(){window.saveReplyCfg('gc-touch-prob','100');var i=document.getElementById('gc-input');i.innerText='拍一拍守卫测试';document.getElementById('gc-send').click();return true;})()");
await sleep(6200);
let pokeGuard = J(await evalJs("(function(){var pk=document.querySelector('.msg-poke:last-of-type')||document.querySelector('.msg-poke');if(!pk)return JSON.stringify({havePoke:false});var sp=pk.querySelector('span');sp.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));window.saveReplyCfg('gc-touch-prob','0');return JSON.stringify({havePoke:true,open:!document.getElementById('gc-msg-actions').hidden});})()"));
check('T13 拍一拍居中条点击不弹操作菜单', pokeGuard.havePoke && !pokeGuard.open, JSON.stringify(pokeGuard));

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('\n== 群聊四项修复验证: ' + pass + '/' + results.length + ' ==');
process.exit(pass === results.length ? 0 : 1);

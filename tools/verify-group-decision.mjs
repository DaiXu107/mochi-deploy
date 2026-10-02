// ===== 专项验证：多人决定（group-decision.js，聊天更多功能入口）=====
// 用法：node tools/verify-group-decision.mjs
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
html = html.split('__BUILD_INFO__').join('verify-gdec');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v3.14.x-verify');
const tmpHtml = join(tmpdir(), 'mochi-gd-verify-' + Date.now() + '.html');
writeFileSync(tmpHtml, html);

// ---- 静态服务：根路径回临时组装页，其余资源走仓库根 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    // 首页一律回自组装页（仓库根存在旧构建产物 index.html，不能让它漏出来）
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
  '--user-data-dir=' + join(tmpdir(), 'mochi-gd-' + Date.now()),
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
// 关自动回复/主动发送，避免异步回复行干扰聊天消息计数
await evalJs("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// 进入聊天页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(800);

// ---- T1 入口按钮存在且紧跟「帮我决定」右侧（DOM 顺序） ----
let r1 = J(await evalJs("(function(){var md=document.getElementById('more-decide');var mg=document.getElementById('more-gdecide');return JSON.stringify({md:!!md,mg:!!mg,adjacent:!!(md&&mg&&md.nextElementSibling===mg),label:mg?mg.textContent.trim():''});})()"));
check('T1 多人决定入口存在且在帮我决定右边', r1.mg && r1.adjacent, r1.label);

// ---- T2 点击入口 → 半框打开 + 默认 5 名成员全选 ----
await evalJs("(function(){var mp=document.getElementById('chat-more-panel');if(mp)mp.hidden=false;var b=document.getElementById('more-gdecide');if(b)b.click();return true;})()");
await sleep(400);
let r2 = J(await evalJs("(function(){var p=document.getElementById('chat-gdecision-panel');var list=document.getElementById('gd-members-list');return JSON.stringify({open:p?!p.hidden:false,chips:list?list.querySelectorAll('.gd-member').length:0,on:list?list.querySelectorAll('.gd-member.on').length:0});})()"));
check('T2 面板打开且默认 5 成员全选', r2.open && r2.chips === 5 && r2.on === 5, JSON.stringify(r2));

// ---- T3 添加成员（走 openModal） ----
await evalJs("(function(){var b=document.getElementById('gd-member-add');if(b)b.click();return true;})()");
await sleep(400);
await evalJs("(function(){var i=document.getElementById('modal-input');if(i)i.value='小明';return true;})()");
await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
await sleep(400);
let r3 = J(await evalJs("(function(){var list=document.getElementById('gd-members-list');var saved=null;try{saved=JSON.parse(localStorage.getItem('xy-home-v2:gdec-members')||'[]');}catch(e){}return JSON.stringify({chips:list?list.querySelectorAll('.gd-member').length:0,last:list&&list.lastElementChild?list.lastElementChild.textContent.trim():'',savedLen:Array.isArray(saved)?saved.length:0,savedHas:Array.isArray(saved)&&saved.indexOf('小明')>=0});})()"));
check('T3 添加成员「小明」生效并持久化', r3.chips === 6 && r3.savedLen === 6 && r3.savedHas, JSON.stringify(r3));

// ---- T4 全选/反选切换 ----
await evalJs("(function(){var b=document.getElementById('gd-member-all');if(b)b.click();return true;})()");
await sleep(200);
let r4a = J(await evalJs("(function(){var list=document.getElementById('gd-members-list');return JSON.stringify({on:list?list.querySelectorAll('.gd-member.on').length:0});})()"));
await evalJs("(function(){var b=document.getElementById('gd-member-all');if(b)b.click();return true;})()");
await sleep(200);
let r4b = J(await evalJs("(function(){var list=document.getElementById('gd-members-list');return JSON.stringify({on:list?list.querySelectorAll('.gd-member.on').length:0});})()"));
check('T4 全选→全不选→恢复全选', r4a.on === 0 && r4b.on === 6, r4a.on + '→' + r4b.on);

// ---- T5 删除选中成员（确认弹窗）：先反选全部，再只勾选最后一个（小明） ----
await evalJs("(function(){var b=document.getElementById('gd-member-all');if(b)b.click();return true;})()");
await sleep(200);
await evalJs("(function(){var cb=document.getElementById('gm-5');if(cb){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()");
await evalJs("(function(){var b=document.getElementById('gd-member-del');if(b)b.click();return true;})()");
await sleep(400);
let r5static = J(await evalJs("(function(){var s=document.getElementById('modal-static');return JSON.stringify({visible:s?!s.hidden:false,text:s?s.textContent:''});})()"));
await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
await sleep(400);
let r5 = J(await evalJs("(function(){var list=document.getElementById('gd-members-list');var saved=null;try{saved=JSON.parse(localStorage.getItem('xy-home-v2:gdec-members')||'[]');}catch(e){}return JSON.stringify({chips:list?list.querySelectorAll('.gd-member').length:0,savedLen:Array.isArray(saved)?saved.length:0,savedHas:Array.isArray(saved)&&saved.indexOf('小明')>=0});})()"));
check('T5 删除成员需确认并生效', r5static.visible && r5static.text.indexOf('1 个成员') >= 0 && r5.chips === 5 && r5.savedLen === 5 && !r5.savedHas, JSON.stringify(r5static) + ' / ' + JSON.stringify(r5));

// ---- T6 是/否/半对决定：倒计时→结果+历史+回聊天 ----
const chatCountBefore = (await evalJs("(function(){var cb=document.getElementById('chat-body');return cb?cb.innerText.split('【多人决定】').length-1:-1;})()")) || 0;
await evalJs("(function(){var q=document.getElementById('gd-q-a');if(q)q.value='今晚吃火锅吗？';var st=document.getElementById('gd-think-a');for(var i=0;i<2;i++){st.querySelector('.stp-min').click();}return true;})()");
await evalJs("(function(){var b=document.getElementById('gd-go-a');if(b)b.click();return true;})()");
await sleep(300);
let r6mid = J(await evalJs("(function(){var el=document.getElementById('gd-result-a');return JSON.stringify({show:el?!el.hidden:false,thinking:el?el.textContent.indexOf('思考中')>=0:false});})()"));
await sleep(1600);
let r6 = J(await evalJs("(function(){var el=document.getElementById('gd-result-a');var hist=[];try{hist=JSON.parse(localStorage.getItem('xy-home-v2:gdec-history')||'[]');}catch(e){}var cb=document.getElementById('chat-body');var cnt=cb?cb.innerText.split('【多人决定】').length-1:0;return JSON.stringify({done:el?el.classList.contains('done'):false,result:el?el.textContent:'',histLen:hist.length,histType:hist[0]?hist[0].type:'',chatCnt:cnt});})()"));
check('T6 决定出结果并写历史、回聊天', r6mid.show && r6mid.thinking && r6.done && r6.histLen === 1 && r6.histType === 'typea' && r6.chatCnt === chatCountBefore + 1, '结果[' + String(r6.result).replace(/\n/g, '|') + '] 聊天+' + (r6.chatCnt - chatCountBefore));

// ---- T7 自定义选项：空选项拦截 + 正常决定 ----
await evalJs("(function(){var t=document.querySelector('#chat-gdecision-body .dc-tab[data-dtab=\"typeb\"]');if(t)t.click();return true;})()");
await evalJs("(function(){var q=document.getElementById('gd-q-b');if(q)q.value='周末去哪？';var o=document.getElementById('gd-opts');if(o)o.value='';return true;})()");
await evalJs("(function(){var b=document.getElementById('gd-go-b');if(b)b.click();return true;})()");
await sleep(300);
let r7toast = J(await evalJs("(function(){var t=document.getElementById('cc-toast');return JSON.stringify({text:t?t.textContent:''});})()"));
check('T7a 空选项被拦截提示', r7toast.text.indexOf('请输入选项') >= 0, r7toast.text);
await evalJs("(function(){var o=document.getElementById('gd-opts');if(o)o.value='吃火锅\\n去游乐园';var st=document.getElementById('gd-think-b');for(var i=0;i<2;i++){st.querySelector('.stp-min').click();}return true;})()");
await evalJs("(function(){var b=document.getElementById('gd-go-b');if(b)b.click();return true;})()");
await sleep(1700);
let r7 = J(await evalJs("(function(){var el=document.getElementById('gd-result-b');var hist=[];try{hist=JSON.parse(localStorage.getItem('xy-home-v2:gdec-history')||'[]');}catch(e){}return JSON.stringify({done:el?el.classList.contains('done'):false,multi:el?el.textContent.split('\\n').length>1:false,optSaved:hist[0]&&Array.isArray(hist[0].options)?hist[0].options.length:0});})()"));
check('T7b 自定义选项逐成员出结果', r7.done && r7.multi && r7.optSaved === 2, JSON.stringify(r7));

// ---- T8 历史记录渲染 ----
await evalJs("(function(){var t=document.querySelector('#chat-gdecision-body .dc-tab[data-dtab=\"history\"]');if(t)t.click();return true;})()");
await sleep(300);
let r8 = J(await evalJs("(function(){var h=document.getElementById('gd-history');return JSON.stringify({items:h?h.querySelectorAll('.tc-listitem').length:0});})()"));
check('T8 历史记录列表渲染 2 条', r8.items === 2, String(r8.items));

// ---- T9 兄弟浮层互斥（MutationObserver 兜底） ----
await evalJs('(function(){if(window.openDecision)window.openDecision();return true;})()');
await sleep(300);
let r9 = J(await evalJs("(function(){var gp=document.getElementById('chat-gdecision-panel');var dp=document.getElementById('chat-decision-panel');return JSON.stringify({gHidden:gp?gp.hidden:null,dOpen:dp?!dp.hidden:null});})()"));
check('T9 帮我决定打开时多人决定自动收起', r9.gHidden === true && r9.dOpen === true, JSON.stringify(r9));

// ---- T10 关闭按钮：先重开本面板（T9 刚把它收起，避免在已隐藏状态下空点假绿），再点 × ----
await evalJs('(function(){if(window.openGroupDecision)window.openGroupDecision();return true;})()');
await sleep(300);
let r10pre = J(await evalJs("(function(){var gp=document.getElementById('chat-gdecision-panel');return JSON.stringify({hidden:gp?gp.hidden:null});})()"));
await evalJs("(function(){var b=document.getElementById('chat-gdecision-close');if(b)b.click();return true;})()");
await sleep(200);
let r10 = J(await evalJs("(function(){var gp=document.getElementById('chat-gdecision-panel');return JSON.stringify({hidden:gp?gp.hidden:null});})()"));
check('T10 重开后面板 × 关闭按钮收起面板', r10pre.hidden === false && r10.hidden === true, r10pre.hidden + '→' + r10.hidden);

// ---- T11 全桌面互通：模拟切换联系人后，成员/历史仍是同一份全局数据 ----
await evalJs("(function(){var dp=document.getElementById('chat-decision-panel');if(dp)dp.hidden=true;window.__activeCid='ctest9k2';document.dispatchEvent(new Event('contact-switched'));return true;})()");
await sleep(400);
await evalJs('(function(){if(window.openGroupDecision)window.openGroupDecision();return true;})()');
await sleep(300);
await evalJs("(function(){var q=document.getElementById('gd-q-a');if(q)q.value='跨桌面决定测试';var b=document.getElementById('gd-go-a');if(b)b.click();return true;})()");
await sleep(1700);
let r11 = J(await evalJs("(function(){var hist=[];try{hist=JSON.parse(localStorage.getItem('xy-home-v2:gdec-history')||'[]');}catch(e){}var list=document.getElementById('gd-members-list');var nnew='';try{nnew=localStorage.getItem('xy-home-v2:ctest9k2:chat-msgs')||'';}catch(e){}var oold='';try{oold=localStorage.getItem('xy-home-v2:default:chat-msgs')||'';}catch(e){}var cb=document.getElementById('chat-body');var domHit=cb?cb.innerText.indexOf('跨桌面决定测试')>=0:false;return JSON.stringify({chips:list?list.querySelectorAll('.gd-member').length:0,histLen:hist.length,newDeskHas:nnew.indexOf('跨桌面决定测试')>=0||domHit,oldDeskClean:oold.indexOf('跨桌面决定测试')<0});})()") || '{}');
check('T11 切换桌面后成员不变、历史写同一全局键、聊天进新桌面', r11.chips === 5 && r11.histLen === 3 && r11.newDeskHas && r11.oldDeskClean, JSON.stringify(r11));

// ---- T12 存量迁移：旧各桌面命名空间键合并进全局根键并清理（页内重发 restore-done 触发，
//      与生产同一条触发路径；避免同 URL 导航不真正刷新的假象）----
await evalJs("(function(){try{['dec-global-migrated','gdec-global-migrated'].forEach(function(f){window.xyStore('xy-home-v2').remove(f);});localStorage.setItem('xy-home-v2:coldsk1:decision-history',JSON.stringify([{id:'d_old1',type:'typea',question:'旧桌面的纠结',result:'是',ts:1111111111}]));localStorage.setItem('xy-home-v2:coldsk2:gdec-history',JSON.stringify([{id:'gd_old1',type:'typeb',question:'旧群决定',members:['老张'],results:{'老张':'否'},ts:1222222222}]));localStorage.setItem('xy-home-v2:coldsk2:gdec-members',JSON.stringify(['老张','老李']));}catch(e){}return true;})()");
await evalJs("(function(){document.dispatchEvent(new Event('mochi-restore-done'));return true;})()");
await sleep(1500);
let r12 = J(await evalJs("(function(){var out={};try{out.dh=(JSON.parse(localStorage.getItem('xy-home-v2:decision-history')||'[]')).some(function(x){return x.ts===1111111111;});out.gh=(JSON.parse(localStorage.getItem('xy-home-v2:gdec-history')||'[]')).some(function(x){return x.ts===1222222222;});var mem=JSON.parse(localStorage.getItem('xy-home-v2:gdec-members')||'[]');out.gmKeepRoot=mem.indexOf('成员A')>=0&&mem.indexOf('老张')<0;out.oldGone=localStorage.getItem('xy-home-v2:coldsk1:decision-history')===null&&localStorage.getItem('xy-home-v2:coldsk2:gdec-history')===null&&localStorage.getItem('xy-home-v2:coldsk2:gdec-members')===null;out.flag=!!localStorage.getItem('xy-home-v2:dec-global-migrated')&&!!localStorage.getItem('xy-home-v2:gdec-global-migrated');}catch(e){}return JSON.stringify(out);})()") || '{}');
check('T12 旧各桌面历史合并进根键、副本清理、标记生效', r12.dh && r12.gh && r12.gmKeepRoot && r12.oldGone && r12.flag, JSON.stringify(r12));

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter((r) => r.ok).length;
console.log('\n== 多人决定验证: ' + pass + '/' + results.length + ' ==');
process.exit(pass === results.length ? 0 : 1);

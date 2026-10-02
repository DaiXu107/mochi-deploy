// ===== 验证脚本：群聊「更多功能」面板与聊天页共享（构建后无头 Chrome） =====
// 用法：node build.mjs && node tools/verify-gc-more.mjs
// 检查项：①群聊更多面板=聊天页共享 #chat-more-panel（在 .page 外，.phone 级）
//         ②面板含分类 tabs（互动/工具/小游戏/TA的提问）+ 全部功能按钮
//         ③群聊打开面板时 @群成员 顶部栏显示（justify flex-end 最右），聊天页打开时隐藏
//         ④群聊点功能按钮 → 切到聊天页
//         ⑤点 @群成员 → 打开成员选择面板（不切页）
//         ⑥群聊输入栏按钮仍与聊天页一致
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node 21+（内置 WebSocket），当前 Node ' + process.version);
  process.exit(1);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-gcmore-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  eval 异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

// ---- ① chat-more-panel 在 .page 外（.phone 级共享） ----
const place = JSON.parse(await evalJs("(function(){" +
  "var mp=document.getElementById('chat-more-panel');" +
  "var p=mp?mp.parentElement:null;" +
  "return JSON.stringify({hasPanel:!!mp,parentCls:p?p.className:'',parentId:p?p.id:''});" +
  "})()") || '{}');
check('chat-more-panel 存在且为 .phone 直接子级', place.hasPanel === true && place.parentId === '' && place.parentCls === 'phone', JSON.stringify(place));

// ---- ② 面板含分类 tabs + 全部功能按钮 ----
const content = JSON.parse(await evalJs("(function(){" +
  "var tabs=document.querySelectorAll('#more-tabs .more-tab');" +
  "var items=document.querySelectorAll('#chat-more-panel .more-item');" +
  "return JSON.stringify({tabCount:tabs.length,tabs:Array.prototype.map.call(tabs,function(t){return t.textContent.trim();}),itemCount:items.length});" +
  "})()") || '{}');
check('面板有 4 个分类 tabs', content.tabCount === 4 && content.tabs.indexOf('互动') >= 0 && content.tabs.indexOf('工具') >= 0 && content.tabs.indexOf('小游戏') >= 0 && content.tabs.indexOf('TA的提问') >= 0, JSON.stringify(content.tabs));
check('面板有全部功能按钮(≥25)', content.itemCount >= 25, 'count=' + content.itemCount);

// ---- ②b 分组过滤：打开时只显示当前分类按钮，切 tab 换分组 ----
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return true;})()");
await sleep(300);
await evalJs("(function(){var b=document.getElementById('gc-input-more-btn');if(b)b.click();return true;})()");
await sleep(400);
const grouped = JSON.parse(await evalJs("(function(){" +
  "var fun=document.getElementById('more-grid-fun');" +
  "var ask=document.getElementById('more-grid-ask');" +
  "var items=fun?fun.querySelectorAll('.more-item'):[];" +
  "var visible=Array.prototype.filter.call(items,function(it){return !it.hidden;}).length;" +
  "var total=items.length;" +
  "var selTab=document.querySelector('#more-tabs .more-tab.sel');" +
  "var askOpen=ask?!ask.hidden:false;" +
  "return JSON.stringify({visible:visible,total:total,askOpen:askOpen,selTab:selTab?selTab.textContent.trim():''});" +
  "})()") || '{}');
check('群聊打开面板时按分类分组（仅显示当前分类按钮）', grouped.visible > 0 && grouped.visible < grouped.total, JSON.stringify(grouped));
// 切到「小游戏」分类
await evalJs("(function(){var t=document.querySelector('#more-tabs .more-tab[data-mcat=\"game\"]');if(t)t.click();return true;})()");
await sleep(300);
const groupedGame = JSON.parse(await evalJs("(function(){" +
  "var fun=document.getElementById('more-grid-fun');" +
  "var items=fun?fun.querySelectorAll('.more-item'):[];" +
  "var visible=Array.prototype.filter.call(items,function(it){return !it.hidden;}).length;" +
  "var selTab=document.querySelector('#more-tabs .more-tab.sel');" +
  "return JSON.stringify({visible:visible,selTab:selTab?selTab.textContent.trim():''});" +
  "})()") || '{}');
check('群聊面板切分类 tab 后分组变化', groupedGame.visible > 0 && groupedGame.selTab === '小游戏', JSON.stringify(groupedGame));
// 验证切换后显示的按钮集合确实不同（小游戏分类按钮 id）
const gameIds = JSON.parse(await evalJs("(function(){" +
  "var fun=document.getElementById('more-grid-fun');" +
  "var items=fun?fun.querySelectorAll('.more-item'):[];" +
  "var vis=Array.prototype.filter.call(items,function(it){return !it.hidden;}).map(function(it){return it.id;});" +
  "return JSON.stringify(vis);" +
  "})()") || '[]');
check('小游戏分类显示游戏类按钮', gameIds.indexOf('more-rps') >= 0 && gameIds.indexOf('more-pong') >= 0 && gameIds.indexOf('more-fish') >= 0, JSON.stringify(gameIds));
await evalJs("(function(){var b=document.getElementById('gc-input-more-btn');if(b)b.click();return true;})()");
await sleep(200);

// ---- ③ @群成员 在分类 tabs 行内最右（群聊打开显示，聊天页隐藏） ----
const atInfo = JSON.parse(await evalJs("(function(){" +
  "var tabs=document.getElementById('more-tabs');" +
  "var at=document.getElementById('gc-more-at');" +
  "var inTabs=tabs&&at?tabs.contains(at):false;" +
  "var atStyle=at?getComputedStyle(at):null;" +
  "var marginLeft=atStyle?atStyle.marginLeft:'';" +
  "var tabsStyle=tabs?getComputedStyle(tabs):null;" +
  "return JSON.stringify({inTabs:inTabs,marginLeft:marginLeft,tabsDisplay:tabsStyle?tabsStyle.display:'',hasAt:!!at,parentCls:at&&at.parentElement?at.parentElement.className:''});" +
  "})()") || '{}');
check('@群成员 在分类 tabs 行内且推到最右', atInfo.inTabs === true && (atInfo.marginLeft.indexOf('auto') >= 0) && atInfo.tabsDisplay === 'flex', JSON.stringify(atInfo));

// 群聊打开面板时 @ 显示
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return true;})()");
await sleep(300);
await evalJs("(function(){var b=document.getElementById('gc-input-more-btn');if(b)b.click();return true;})()");
await sleep(300);
const gcAtShow = JSON.parse(await evalJs("(function(){" +
  "var at=document.getElementById('gc-more-at');" +
  "var panel=document.getElementById('chat-more-panel');" +
  "return JSON.stringify({panelOpen:panel?!panel.hidden:false,atHidden:at?at.hidden:null});" +
  "})()") || '{}');
check('群聊打开面板时 @群成员 显示', gcAtShow.panelOpen === true && gcAtShow.atHidden === false, JSON.stringify(gcAtShow));
await evalJs("(function(){document.getElementById('gc-input-more-btn').click();return true;})()");
await sleep(200);
// 聊天页打开面板时 @ 隐藏
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(300);
await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
await sleep(300);
const chatAtHide = JSON.parse(await evalJs("(function(){" +
  "var at=document.getElementById('gc-more-at');" +
  "var panel=document.getElementById('chat-more-panel');" +
  "return JSON.stringify({panelOpen:panel?!panel.hidden:false,atHidden:at?at.hidden:null});" +
  "})()") || '{}');
check('聊天页打开面板时 @群成员 隐藏', chatAtHide.panelOpen === true && chatAtHide.atHidden === true, JSON.stringify(chatAtHide));
await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
await sleep(200);

// ---- ④ 群聊点功能按钮 → 切到聊天页 ----
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return true;})()");
await sleep(300);
await evalJs("(function(){document.getElementById('gc-input-more-btn').click();return true;})()");
await sleep(300);
// 点「帮我决定」功能按钮
await evalJs("(function(){var b=document.getElementById('more-decide');if(b)b.click();return true;})()");
await sleep(400);
const switchRes = JSON.parse(await evalJs("(function(){" +
  "var gc=document.getElementById('page-group-chat');" +
  "var chat=document.getElementById('page-chat');" +
  "var panel=document.getElementById('chat-more-panel');" +
  "return JSON.stringify({gcHidden:gc?gc.hidden:null,chatHidden:chat?chat.hidden:null,panelHidden:panel?panel.hidden:null,decisionOpen:document.getElementById('chat-decision-panel')?!document.getElementById('chat-decision-panel').hidden:false});" +
  "})()") || '{}');
check('群聊点功能按钮 → 切到聊天页', switchRes.gcHidden === true && switchRes.chatHidden === false, JSON.stringify(switchRes));
check('切页后对应功能半框打开', switchRes.decisionOpen === true, 'decision=' + switchRes.decisionOpen);
check('更多面板已关闭', switchRes.panelHidden === true, 'panel=' + switchRes.panelHidden);

// ---- ⑤ 点 @群成员 → 打开成员选择面板（不切页） ----
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return true;})()");
await sleep(300);
await evalJs("(function(){document.getElementById('gc-input-more-btn').click();return true;})()");
await sleep(300);
const atRes = await evalJs("(function(){" +
  "var at=document.getElementById('gc-more-at');" +
  "var atPanel=document.getElementById('gc-at-panel');" +
  "var gc=document.getElementById('page-group-chat');" +
  "if(!at||!atPanel)return 'missing';" +
  "at.click();" +
  "return JSON.stringify({atOpen:!atPanel.hidden,members:atPanel.querySelectorAll('.gc-at-item').length,gcVisible:!gc.hidden});" +
  "})()");
await sleep(300);
const atState = JSON.parse(atRes || '{}');
check('点 @群成员 打开成员面板且不切页', atState.atOpen === true && atState.gcVisible === true, atRes);
check('成员面板列出成员', atState.members > 0, 'members=' + atState.members);

// ---- ⑥ 群聊输入栏按钮与聊天页一致 ----
const btns = JSON.parse(await evalJs("(function(){" +
  "function ids(sel){return Array.prototype.map.call(document.querySelectorAll(sel+' button'),function(b){return b.id||'';}).filter(Boolean);}" +
  "return JSON.stringify({chat:ids('#page-chat .chat-input-row'),gc:ids('#page-group-chat .gc-input-row')});" +
  "})()") || '{}');
function strip(ids, prefix) { return (ids || []).map(id => id.indexOf(prefix) === 0 ? id.slice(prefix.length) : id); }
const chatSeq = strip(btns.chat, 'chat-').map(id => id === 'more-btn' ? 'input-more-btn' : id);
const gcSeq = strip(btns.gc, 'gc-');
check('群聊输入栏按钮与聊天页一致', JSON.stringify(chatSeq) === JSON.stringify(gcSeq), 'chat=[' + chatSeq.join(',') + '] gc=[' + gcSeq.join(',') + ']');

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

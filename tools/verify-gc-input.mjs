// ===== 验证脚本：群聊页输入栏与聊天页对齐（构建后无头 Chrome） =====
// 用法：node build.mjs && node tools/verify-gc-input.mjs
// 检查项：①群聊输入栏按钮与聊天页一致（更多/表情/输入框/图片/发送 + 语音/继续说/批量三按钮）
//         ②三个功能按钮显隐跟随当前桌面聊天设置（cs-voice-send / cs-trigger-bar / cs-batch-send）
//         ③@群成员 在更多功能面板顶部栏最右（仅群聊有，聊天页更多面板没有 @）
//         ④群聊页输入栏贴底、顶栏存在
//         ⑤点击「更多功能」打开面板 → @群成员 可打开成员选择面板
// 依赖：verify.mjs 相同的 CDP 无头 Chrome 方案
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-gc-' + Date.now()),
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

// ---- ① 输入栏按钮对比 ----
const btns = JSON.parse(await evalJs("(function(){" +
  "function ids(sel){return Array.prototype.map.call(document.querySelectorAll(sel+' button'),function(b){return b.id||'';}).filter(Boolean);}" +
  "return JSON.stringify({chat:ids('#page-chat .chat-input-row'),gc:ids('#page-group-chat .gc-input-row')});" +
  "})()") || '{}');
// 去掉前缀后比对（chat-* 与 gc-* 是同一套按钮的不同前缀；群聊更多按钮 id 为 input-more-btn）
function strip(ids, prefix) { return (ids || []).map(id => id.indexOf(prefix) === 0 ? id.slice(prefix.length) : id); }
const chatSeq = strip(btns.chat, 'chat-').map(id => id === 'more-btn' ? 'input-more-btn' : id);
const gcSeq = strip(btns.gc, 'gc-');
check('群聊输入栏按钮与聊天页完全一致（同序同集）', JSON.stringify(chatSeq) === JSON.stringify(gcSeq), 'chat=[' + chatSeq.join(',') + '] gc=[' + gcSeq.join(',') + ']');
const expected = ['mic-btn', 'continue-btn', 'input-more-btn', 'emoji-btn', 'img-btn', 'batch-btn', 'send'];
check('聊天页按钮顺序正确', JSON.stringify(chatSeq) === JSON.stringify(expected), 'chat=[' + chatSeq.join(',') + ']');

// ---- ② 三按钮显隐跟随当前桌面设置 ----
// 打开群聊页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return true;})()");
await sleep(400);
const hide0 = JSON.parse(await evalJs("(function(){" +
  "function st(id){var el=document.getElementById(id);return el?getComputedStyle(el).display:'';}" +
  "return JSON.stringify({mic:st('gc-mic-btn'),cont:st('gc-continue-btn'),batch:st('gc-batch-btn')});" +
  "})()") || '{}');
check('默认三按钮隐藏（未开启设置）', hide0.mic === 'none' && hide0.cont === 'none' && hide0.batch === 'none', JSON.stringify(hide0));
// 设置当前桌面聊天设置开启
await evalJs("(function(){try{var st=window.activeStore();st.set('cs-voice-send','1');st.set('cs-trigger-bar','1');st.set('cs-batch-send','1');}catch(e){return String(e);}document.dispatchEvent(new Event('voice-send-changed'));document.dispatchEvent(new Event('batch-send-changed'));document.dispatchEvent(new Event('continue-say-changed'));return true;})()");
await sleep(300);
const hide1 = JSON.parse(await evalJs("(function(){" +
  "function st(id){var el=document.getElementById(id);return el?getComputedStyle(el).display:'';}" +
  "return JSON.stringify({mic:st('gc-mic-btn'),cont:st('gc-continue-btn'),batch:st('gc-batch-btn')});" +
  "})()") || '{}');
check('开启聊天设置后三按钮显示', hide1.mic !== 'none' && hide1.cont !== 'none' && hide1.batch !== 'none', JSON.stringify(hide1));

// ---- ③ @群成员 在共享更多面板分类行最右（仅群聊有） ----
const atInfo = JSON.parse(await evalJs("(function(){" +
  "var mp=document.getElementById('chat-more-panel');" +
  "var tabs=document.getElementById('more-tabs');" +
  "var at=document.getElementById('gc-more-at');" +
  "var inTabs=tabs&&at?tabs.contains(at):false;" +
  "var marginLeft=at?getComputedStyle(at).marginLeft:'';" +
  "return JSON.stringify({inTabs:inTabs,marginLeft:marginLeft,atText:at?at.textContent.trim():''});" +
  "})()") || '{}');
check('@群成员 在共享面板分类行最右', atInfo.inTabs === true && atInfo.marginLeft.indexOf('auto') >= 0, JSON.stringify(atInfo));
check('@群成员 文本正确', atInfo.atText === '@群成员', atInfo.atText);

// ---- ④ 群聊页布局：顶栏存在 + 输入栏贴底 ----
const gcLayout = JSON.parse(await evalJs("(function(){" +
  "var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();" +
  "var pg=document.getElementById('page-group-chat');" +
  "var ch=pg.querySelector('.chat-head');" +
  "var ir=pg.querySelector('.gc-input-row');" +
  "if(!ch||!ir)return '{}';" +
  "return JSON.stringify({head:true,inputBottom:Math.round(ir.getBoundingClientRect().bottom-pr.top),phoneH:Math.round(pr.height)});" +
  "})()") || '{}');
check('群聊页顶栏存在', gcLayout.head === true);
if (gcLayout.head === true) check('群聊输入栏贴底', gcLayout.inputBottom >= gcLayout.phoneH - 5, gcLayout.inputBottom + ' vs ' + gcLayout.phoneH);

// ---- ⑤ 交互：点击「更多功能」→ @群成员 → 成员选择面板打开 ----
const moreClick = await evalJs("(function(){" +
  "var btn=document.getElementById('gc-input-more-btn');" +
  "var panel=document.getElementById('chat-more-panel');" +
  "if(!btn||!panel)return 'missing';" +
  "btn.click();" +
  "return 'ok';" +
  "})()");
await sleep(300);
const morePanelOpen = await evalJs("(function(){var p=document.getElementById('chat-more-panel');return p?!p.hidden:false;})()");
check('点击更多功能打开共享面板', morePanelOpen === true, 'click=' + moreClick);
const atClick = await evalJs("(function(){" +
  "var at=document.getElementById('gc-more-at');" +
  "var atPanel=document.getElementById('gc-at-panel');" +
  "if(!at||!atPanel)return 'missing';" +
  "at.click();" +
  "return JSON.stringify({atOpen:!atPanel.hidden,memberCount:atPanel.querySelectorAll('.gc-at-item').length});" +
  "})()");
await sleep(300);
const atState = JSON.parse(atClick || '{}');
check('点击 @群成员 打开成员选择面板', atState.atOpen === true, atClick);
check('@成员面板列出成员', atState.memberCount > 0, 'members=' + atState.memberCount);

// ---- ⑥ 运行时无 JS 异常（群聊复用语音/批量面板的全局入口就绪） ----
const globals = JSON.parse(await evalJs("(function(){" +
  "return JSON.stringify({openVoice:typeof window.openVoicePanelFor,openBatch:typeof window.openBatchPanelFor,applyCont:typeof window.applyContinueSayUI});" +
  "})()") || '{}');
check('群聊复用语音/批量面板的全局入口就绪', globals.openVoice === 'function' && globals.openBatch === 'function', JSON.stringify(globals));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

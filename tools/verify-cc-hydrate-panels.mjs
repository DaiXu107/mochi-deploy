// ===== 验证脚本：冷启动字卡库大键挂起时，聊天页 表情包/拍一拍 面板按需取回 =====
// 用法：node build.mjs && node tools/verify-cc-hydrate-panels.mjs
// 复现目标（用户反馈「开屏进入后点聊天页，表情包/拍一拍 是空的，需先开字卡库才加载」）：
//   ① 启动回填预算把字卡库键挂起在 IDB（__xyIdbDeferredKeys）时，聊天页面板读成空库
//   ② 打开拍一拍面板 → 自动按需取回（hydrateLibScopes）→ 面板重绘出字卡库的拍一拍
//   ③ 打开表情包面板 → 同样取回后显示字卡库的表情包
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cc-hydrate-' + Date.now()),
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

// ① 构造「启动回填挂起」现场：两把字卡库键进 __xyIdbDeferredKeys、LS 无数据、IDB 有权威数据
const setup = await evalJs(`(async function(){
  const pubKey='xy-home-v2:cc-groups-public', ownKey=window.activePrefix()+':cc-groups';
  window.__xyIdbDeferredKeys=[pubKey, ownKey];
  localStorage.removeItem(pubKey); localStorage.removeItem(ownKey);
  await window.idbSet(pubKey, JSON.stringify({text:[], poke:[['公用拍',['拍了拍你的小脑袋']]], sticker:[['公用表',['data:image/png;base64,AA==']]]}));
  await window.idbSet(ownKey, JSON.stringify({text:[], poke:[['TA拍',['拍了拍你的脸蛋','拍了拍你的肩膀']]], sticker:[['TA表',['data:image/png;base64,BB==']]]}));
  return JSON.stringify({deferred:Array.isArray(window.__xyIdbDeferredKeys)&&window.__xyIdbDeferredKeys.length, ownPoke:JSON.stringify(window.getScopedGroups('poke','own')||[]), ownSticker:JSON.stringify(window.getScopedGroups('sticker','own')||[])});
})()`);
const st = JSON.parse(setup || '{}');
check('构造挂起现场：两键进 deferred 名单', st.deferred === 2, 'deferred=' + st.deferred);
check('构造挂起现场：取回前专属拍一拍读成空库（复现条件）', st.ownPoke === '[]', String(st.ownPoke));

// ② 新 API 存在 + 可判定「是否挂起」
check('对外 API：window.libScopesDeferred 存在且为函数', await evalJs('typeof window.libScopesDeferred==="function"'));
check('对外 API：window.hydrateLibScopes 存在且为函数', await evalJs('typeof window.hydrateLibScopes==="function"'));
check('对外 API：libScopesDeferred 判定挂起为真', await evalJs('window.libScopesDeferred(["public","own"])===true'));

// ③ 打开拍一拍面板 → 自动取回 + 重绘（无需先开字卡库；chat.js 为 IIFE，经 UI 按钮触发）
await evalJs("(function(){try{localStorage.removeItem('poke-tab');localStorage.removeItem('poke-group-ta');}catch(e){};var b=document.getElementById('more-poke');if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;})()");
let pokeShown = false, pokeDetail = '';
for (let i = 0; i < 30; i++) {
  const r = await evalJs(`(function(){
    var list=document.getElementById('poke-list');
    var txts=list?Array.prototype.slice.call(list.querySelectorAll('.cc-txt .t')).map(function(e){return e.textContent;}):[];
    return JSON.stringify({shown:!!list&&!list.hidden&&txts.length, txts:txts});
  })()`);
  const d = JSON.parse(r || '{}');
  if ((d.txts || []).indexOf('拍了拍你的脸蛋') >= 0) { pokeShown = true; pokeDetail = JSON.stringify(d); break; }
  await sleep(300);
}
check('打开拍一拍面板 → 自动取回并显示字卡库拍一拍', pokeShown, pokeDetail);

// ④ 取回后两键移出 deferred 名单
check('取回完成：两键移出 deferred 名单', await evalJs('window.libScopesDeferred(["public","own"])===false'));

// ⑤ 打开表情包面板 → 显示字卡库表情包（取回后 LS/内存已有数据；emojiCurGroup 在 IIFE 内，
//    经分组 chip 点击写入，故先开面板 → 点「TA表」分组 chip → 断言出现 data:image 表情）
await evalJs("(function(){var b=document.getElementById('chat-emoji-btn');if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;})()");
let emojiImgs = [], emojiDetail = '';
for (let i = 0; i < 20; i++) {
  const r = await evalJs(`(function(){
    var chips=Array.prototype.slice.call(document.querySelectorAll('#emoji-panel .emoji-g-chip'));
    var target=chips.filter(function(c){return (c.textContent||'').indexOf('TA表')>=0;})[0];
    if(target) target.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    var list=document.getElementById('emoji-list');
    var imgs=list?Array.prototype.slice.call(list.querySelectorAll('img')).map(function(im){return im.src;}):[];
    return JSON.stringify({chips:chips.length, imgs:imgs});
  })()`);
  const d = JSON.parse(r || '{}');
  emojiImgs = d.imgs || [];
  emojiDetail = JSON.stringify(d);
  if (emojiImgs.some(s => /data:image/.test(s))) break;
  await sleep(300);
}
check('打开表情包面板 → 显示字卡库表情包', emojiImgs.some(s => /data:image/.test(s)), emojiDetail);

// ⑥ 对照：公用字卡同样在打开拍一拍面板时被取回（公用拍一拍在公用 tab 可见）
await evalJs("(function(){var t=document.querySelector('.poke-tab[data-ptab=\"public\"]');if(t)t.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;})()");
let pubShown = false, pubDetail = '';
for (let i = 0; i < 20; i++) {
  const r = await evalJs(`(function(){
    var list=document.getElementById('poke-list');
    var txts=list?Array.prototype.slice.call(list.querySelectorAll('.cc-txt .t')).map(function(e){return e.textContent;}):[];
    return JSON.stringify({shown:!!list&&!list.hidden&&txts.length, txts:txts});
  })()`);
  const d = JSON.parse(r || '{}');
  if ((d.txts || []).indexOf('拍了拍你的小脑袋') >= 0) { pubShown = true; pubDetail = JSON.stringify(d); break; }
  await sleep(300);
}
check('公用拍一拍在拍一拍面板公用 tab 可见（公用键同步取回）', pubShown, pubDetail);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

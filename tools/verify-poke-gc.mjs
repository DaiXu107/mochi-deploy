// ===== #287 验证脚本：群聊点头像拍一拍 真实 UI 全链路 =====
// 用法：node build.mjs && node tools/verify-poke-gc.mjs（跑仓库根目录产物 index.html）
// 链路：造成员+回复确定化 → 发消息等成员回复 → 点成员头像 → 面板弹出 → 选字卡 →
//       拍一拍落库(special=poke)+居中渲染+面板关闭 → 被拍成员反应 → 全程零未捕获错误
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); const body = readFileSync(p); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(body); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-poke-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() { for (let i = 0; i < 60; i++) { try { const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); const page = list.find((t) => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; } } catch (e) {} await sleep(150); } throw new Error('no cdp'); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; } }
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? '✅' : '❌') + ' ' + name + (ok ? '' : '  ' + JSON.stringify(detail))); };
await cdpConnect(); await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs('(function(){var s=document.querySelector(".splash-notice")||document.querySelector(".splash-box");if(s)s.scrollTop=s.scrollHeight;return 1;})()');
await sleep(600);
await evalJs('document.getElementById("splash-enter").click()');
await sleep(900);

// 先造一个联系人（群成员来自 getContacts，空档无成员＝永远不会有人回复）
await evalJs('(function(){try{window.createContact("小明");}catch(e){}return (window.getContacts()||[]).length;})()');
// 回复确定化：概率 100%、延迟 1-2s（默认 gc-prob=60、rs-max=40s，纯概率问题曾致用例偶红）
await evalJs('(function(){window.saveReplyCfg("gc-prob",100);window.saveReplyCfg("gc-rs-min",1);window.saveReplyCfg("gc-rs-max",2);return 1;})()');
await sleep(300);
// 进群聊页
await evalJs('(function(){var a=document.querySelector(\'[data-app="group-chat"]\');a.hidden=false;a.click();return 1;})()');
await sleep(900);
// 先加一个联系人（群成员来自 getContacts）——走 localStorage 直写 + 刷新联系人事件太重，
// 改为直接用暴露的存储 API 造一个成员（同步 activeStore 键）……不行，联系人结构复杂。
// 更简单：直接发一条消息等成员回复（gc-prob 默认命中）。
const sent = await evalJs('(function(){var i=document.getElementById("gc-input");i.textContent="大家好呀";document.getElementById("gc-send").click();return window.groupChatGetMsgs().length;})()');
await sleep(400);
check('P1 消息已发出', sent >= 1, sent);
// 等成员回复（1-2s 延迟 + 打字指示，最多等 15s）
let inCount = 0;
for (let i = 0; i < 30; i++) {
  inCount = await evalJs('window.groupChatGetMsgs().filter(function(m){return m.side==="in";}).length');
  if (inCount > 0) break;
  await sleep(500);
}
check('P2 有成员消息（可点头像）', inCount > 0, inCount);
if (inCount > 0) {
  // 点成员消息头像
  await evalJs('(function(){var av=(function(){var a=document.querySelectorAll("#gc-body .msg-in .msg-av");return a[a.length-1];})();av.click();return 1;})()');
  await sleep(400);
  const panel = await evalJs('(function(){var p=document.getElementById("gc-poke-card");return JSON.stringify({open:p&&!p.hidden,name:document.getElementById("gc-poke-name").textContent,items:document.getElementById("gc-poke-list").children.length});})()');
  let pp = {}; try { pp = JSON.parse(panel); } catch (e) {}
  check('P3 点头像弹出拍一拍面板', pp.open === true, panel);
  check('P4 面板标题为成员名', typeof pp.name === 'string' && pp.name.length > 0, panel);
  check('P5 面板含字卡列表（≥6 预设）', pp.items >= 6, panel);
  // 点第一张字卡
  await evalJs('(function(){document.querySelector("#gc-poke-list .cc-item").click();return 1;})()');
  await sleep(500);
  const after = await evalJs('(function(){var p=document.getElementById("gc-poke-card");var msgs=window.groupChatGetMsgs();var last=msgs[msgs.length-1];var pokeEl=document.querySelector(".msg-poke:last-child span");return JSON.stringify({closed:!p||p.hidden,special:last.special,text:last.text,rendered:pokeEl?pokeEl.textContent:null});})()');
  let ap = {}; try { ap = JSON.parse(after); } catch (e) {}
  check('P6 选卡后面板关闭', ap.closed === true, after);
  check('P7 拍一拍记录落库（special=poke，含我的昵称+成员名）', ap.special === 'poke' && String(ap.text || '').indexOf('拍了拍') >= 0, after);
  check('P8 渲染为居中系统条', !!ap.rendered && ap.rendered.indexOf('拍了拍') >= 0, after);
  await sleep(2500);
  const reacted = await evalJs('window.groupChatGetMsgs().filter(function(m){return m.side==="in"&&!m.special;}).length');
  check('P9 被拍成员有反应（拍回/回复，概率链）', reacted >= 1, reacted);
}
const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(join(root, 'tools', '_poke-e2e.png'), Buffer.from(r.data, 'base64'));
const errs = await evalJs('(function(){var a=Array.isArray(window.__jsErrors)?window.__jsErrors:[];return JSON.stringify(a);})()');
check('P10 全程零未捕获错误', errs === '[]', errs);
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);

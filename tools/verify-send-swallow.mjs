// #401 点【发送】消息被吞（单聊）——无头复现/断言
// 复现链：发「嗯」→ 1.2s 后真实重打「嗯」（有 keydown/input 活动=守卫应放行）→ 点发送
//  → 消息应入库 2 条；当前代码 addRec 文本去重窗 2500ms 静默吞掉第 2 条 = 0 新增（红）。
// 同时守住：机械双击（150ms 内两次 click、无编辑）仍只发 1 条；3s 后重发同文本 2 条。
// 用法：node #401 点【发送】消息被吞——行为断言（复现/回归两用）：
//  T1 重打同文本 1.2s 后再发=2 条（修前被 addRec 2500ms 窗静默吞=红）；T2 机械双击仍 1 条；T3 3s 重发=2 条
// 用法：node tools/verify-send-swallow.mjs.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  .find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9740 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-sws-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; }
  } catch (e) {}
  await sleep(150);
}
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('[eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: 'about:blank' });
await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
// #384 强制公告放行
await evalJs(`(function(){
  var m = document.getElementById('splash-mandatory');
  if (m && !m.hidden) {
    var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
    var en = document.getElementById('splash-mandatory-enter'); if (en) en.click();
  } else { var s = document.getElementById('splash'); if (s) s.click(); }
  return 1;
})()`);
await sleep(600);
// 禁自动回复干扰断言
await evalJs(`(function(){ try{ localStorage.setItem('xy-home-v2:reply-rs-min','9999'); localStorage.setItem('xy-home-v2:reply-rs-max','9999'); }catch(e){} return 1; })()`);
console.log('dbg ready=', await evalJs('!!window.__mochiDataReady'));
console.log('dbg splash=', await evalJs("(function(){var s=document.getElementById('splash');return s?s.className+' hidden='+s.hidden:'nosplash';})()"));
console.log('dbg icon=', await evalJs("(function(){var i=document.querySelector('.app[data-app=\"chat\"]');return i?('h='+i.hidden+' p='+(i.parentNode&&i.parentNode.className)):'none';})()"));
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="chat"]'); if (ic) ic.click(); return !!ic; })()`);
await sleep(1600);
console.log('dbg page=', await evalJs("(function(){var p=document.getElementById('page-chat');return p?('hidden='+p.hidden):'nopage';})()"));
console.log('dbg send=', await evalJs("(function(){var b=document.getElementById('chat-send');return b?('hidden='+b.hidden+' vis='+(b.offsetWidth+'x'+b.offsetHeight)):'nosend';})()"));

// 模拟真实输入：keydown（刷新 lastUserEditAt）+ 设文本 + input 事件
const TYPE_TXT = `(function(){
  var inp = document.getElementById('chat-input');
  var ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  inp.dispatchEvent(ev);
  inp.innerText = __TXT__;
  inp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: __TXT2__ }));
  return 1;
})()`;
function type(txt) { return evalJs(TYPE_TXT.replace('__TXT__', JSON.stringify(txt)).replace('__TXT2__', JSON.stringify(txt))); }

let pass = 0, fail = 0;
function chk(name, ok, detail) { if (ok) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, detail || ''); } }
const countOut = `(function(){ try { return window.getChatMsgs().filter(function(m){ return (m.side==='out') && (m.text||'')===__T__; }).length; } catch(e){ return 'err'; } })()`;

// T1 重打同文本 1.2s 后再发 → 应 2 条（当前代码预期被吞=1 条，红）
await type('嗯');
await evalJs(`(function(){ document.getElementById('chat-send').click(); return 1; })()`);
await sleep(1200);
const t1a = await evalJs(countOut.replace('__T__', '"嗯"'));
await type('嗯'); // 真实重打（keydown 已刷新 lastUserEditAt）
await evalJs(`(function(){ document.getElementById('chat-send').click(); return 1; })()`);
await sleep(600);
const t1b = await evalJs(countOut.replace('__T__', '"嗯"'));
chk('T1 重打同文本 1.2s 后再发=2 条', t1b === 2, '首次=' + t1a + ' 重发后=' + t1b + (t1b === 1 ? '  <<< 第二条被静默吞掉' : ''));

// T2 机械双击（150ms 两次 click，中间无编辑）→ 必须仍 1 条
await type('你好');
await evalJs(`(function(){ var b=document.getElementById('chat-send'); b.click(); setTimeout(function(){ b.click(); }, 150); return 1; })()`);
await sleep(800);
const t2 = await evalJs(countOut.replace('__T__', '"你好"'));
chk('T2 机械双击仍只发 1 条（守卫不回归）', t2 === 1, '实际=' + t2);

// T3 3s 后重发同文本 → 2 条（既有放行行为不回归）
await type('好');
await evalJs(`(function(){ document.getElementById('chat-send').click(); return 1; })()`);
await sleep(3100);
await type('好');
await evalJs(`(function(){ document.getElementById('chat-send').click(); return 1; })()`);
await sleep(600);
const t3 = await evalJs(countOut.replace('__T__', '"好"'));
chk('T3 3s 后重发同文本=2 条（不回归）', t3 === 2, '实际=' + t3);

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);

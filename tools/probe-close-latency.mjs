// 探针：诚实内核（Chrome 模型）下，主输入栏 vs 互动卡输入框，不同会话时长的收口耗时
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const p = join(root, u);
  try {
    if (!statSync(p).isFile()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': types[extname(p)] || 'text/plain' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(500); res.end('err'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const port = 32700 + Math.floor(Math.random() * 300);
const cands = [process.env.CHROME_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
const browserPath = cands.filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=390,844', '--user-data-dir=' + join(process.env.TEMP, 'probe-lat-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null;
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; }); break; } } catch (e) {}
  await sleep(300);
}
if (!ws) { console.log('no browser'); process.exit(1); }
let msgId = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (me, pa = {}) => { const i = ++msgId; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: me, params: pa })); }); };
const ev = async (ex) => { const r = await cdp('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true }); return r && r.result && r.result.result ? r.result.result.value : undefined; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
await cdp('Page.bringToFront');
for (let i = 0; i < 40; i++) { if (await ev("typeof window.mochiScreenAdj==='object'&&!!document.querySelector('.phone')")) break; await sleep(200); }
await ev("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}return 1;})()");
await sleep(300);
const H = "(function(){var p=document.querySelector('.phone');return p?p.style.height:null;})()";
const FAKE = `(function(){
  var vv = { height: 844, offsetTop: 0, scale: 1, _ls: [],
    dispatch: function (t) { (vv._ls[t] || []).slice().forEach(function (f) { try { f({}); } catch (e) {} }); } };
  vv.addEventListener = function (t, f) { (vv._ls[t] = vv._ls[t] || []).push(f); };
  try { Object.defineProperty(window, 'visualViewport', { configurable: true, get: function () { return vv; } }); } catch (e) {}
  window.__fakeVV = vv; return 1;
})()`;
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
await cdp('Page.bringToFront');
await sleep(400);
async function measure(label, holdMs) {
  await ev("(function(){var d=document.getElementById('ed');if(d&&d.blur)d.blur();window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
  await sleep(1200);
  const t0 = Date.now();
  await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
  console.log('  [focus] ' + await ev("(function(){var a=document.activeElement;return a?(a.id||a.tagName)+' ce='+(a.isContentEditable===true):'none';})()") + ' vvH=' + await ev('window.__fakeVV?Math.round(window.__fakeVV.height):-1'));
  const docked = await (async () => { const s = Date.now(); let last=null; while (Date.now() - s < 3000) { last = await ev(H); if (last === '360px') return true; await sleep(150); } console.log('  [dbg] 高度从未到 360px，3s 末尾=' + last); return false; })();
  await sleep(holdMs);
  const tc = Date.now();
  await ev("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
  let closed = false;
  while (Date.now() - tc < 6000) { if ((await ev(H)) === '') { closed = true; break; } await sleep(60); }
  console.log(label + '  docked=' + docked + '  closeMs=' + (closed ? Date.now() - tc : '>6000'));
}
await ev("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('ed');if(t&&document.activeElement!==t){try{t.focus();}catch(e){}}},400);return 1;})()");
await measure('hold=2500ms（主输入栏常态：打字一阵）', 2500);
await measure('hold=300ms （互动卡常态：点开即收） ', 300);
await measure('hold=0ms   （纯点一下）             ', 0);
try { ws.close(); } catch (e) {}
try { browser.kill(); } catch (e) {}
server.close();
process.exit(0);
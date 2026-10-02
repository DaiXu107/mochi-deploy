// verify-bg-keep-toggle.mjs —— #601d「后台保活」开关：用户手动关闭后不得被自动/回填重新打开
// 断言：
//   A0 初始默认关闭；A1 从未手动设过时，开启「后台通知」会自动一并开启保活（原设计保留）；
//   A2 手动关保活 → 存储 0 + 标记 __ka-user-off=1；A3 重开仍关；
//   A4 通知 off→on 不再强行打开保活（本次修复核心）；
//   A5 外部把存储写回 '1'（标记仍在）→ 重开仍为关，且存储被修回 '0'（兜底）；
//   A6 用户重新手动开启 → 存储 1 + 标记清零，重开仍开；A7 全程 0 JS 异常。
// 用 CDP Browser.grantPermissions 授权通知；开关监听在模块加载时即绑定，可不依赖设置页可见。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = 9900 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kgt-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true }); return r && r.result ? r.result.value : null; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
let pass = 0, fail = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) pass++; else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); } };
async function load() {
  await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(2600);
  await ev(`(function(){var c=document.getElementById('splash-age-check'); if(c){c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));} var b=document.getElementById('splash-confirm-ok'); if(b) b.click();})()`); await sleep(900);
}
const probe = async () => JSON.parse(await ev(`JSON.stringify({
  keep: (document.getElementById('bg-keepalive')||{}).checked,
  notify: (document.getElementById('bg-notify')||{}).checked,
  storedKeep: (function(){try{return window.xyStore('xy-home-v2').get('bg-keepalive');}catch(e){return 'ERR';}})(),
  userOff: (function(){try{return window.xyStore('xy-home-v2').get('__ka-user-off');}catch(e){return 'ERR';}})()
})`));
await load();
let s = await probe();
A('A0 初始默认关闭', s.keep === false, JSON.stringify(s));
await ev(`document.getElementById('bg-notify').click()`); await sleep(1500);
s = await probe();
A('A1 开通知自动开保活（从未手设）', s.keep === true && s.storedKeep === '1' && s.userOff === '0', JSON.stringify(s));
await ev(`document.getElementById('bg-keepalive').click()`); await sleep(600);
s = await probe();
A('A2 手动关保活 → 存0标记1', s.keep === false && s.storedKeep === '0' && s.userOff === '1', JSON.stringify(s));
await load();
s = await probe();
A('A3 重开仍关', s.keep === false && s.storedKeep === '0', JSON.stringify(s));
await ev(`document.getElementById('bg-notify').click()`); await sleep(600);
await ev(`document.getElementById('bg-notify').click()`); await sleep(1500);
s = await probe();
A('A4 通知off→on不再强开保活', s.keep === false && s.storedKeep === '0', JSON.stringify(s));
await ev(`(function(){var st=window.xyStore('xy-home-v2'); st.set('bg-keepalive','1'); st.set('__ka-user-off','1'); return 'ok';})()`);
await load();
s = await probe();
A('A5 外部改回1→仍关且修回0', s.keep === false && s.storedKeep === '0', JSON.stringify(s));
await ev(`document.getElementById('bg-keepalive').click()`); await sleep(600);
s = await probe();
A('A6a 重新手动开启→存1标记0', s.keep === true && s.storedKeep === '1' && s.userOff === '0', JSON.stringify(s));
await load();
s = await probe();
A('A6b 重开后仍开', s.keep === true && s.storedKeep === '1', JSON.stringify(s));
A('A7 无 JS 异常', (await ev(`(window.__jsErrors&&window.__jsErrors.length)||0`)) === 0);
console.log('PASS', pass, 'FAIL', fail);
if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n'));
ws.close(); chrome.kill(); server.close(); process.exit(fail ? 1 : 0);

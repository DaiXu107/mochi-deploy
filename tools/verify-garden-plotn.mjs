// verify-garden-plotn.mjs —— #601e 花园地块迁移：旧档默认 12 块、12 块后有花则保留（绝不裁花）
// 背景：旧 load() 在存档缺 plotN 时按等级补齐（满级 12→22）＝用户报「远超 12 块」。
// 断言（无头 390×844，真实产物）：
//   A 新档（无 plotN）→ 12 块；B 满级无 plotN 全空 → 12 块（不再 22）；
//   C plotN=22 花 0..7、尾部全空、无 pnUser → 收回 12 块且花不丢；
//   D plotN=22 第 15 块有花、无 pnUser → 保留 22 块、花不丢（有花不裁）；
//   E plotN=22 尾部全空但 pnUser=1（手动开垦过）→ 保留 22 块（尊重主动扩建）；
//   F 无 plotN 但花种到第 16 块 → 保留 16 块、花不丢。
// 种子 lpc 设为远未来 → checkPartnerPassive 早退，杜绝 TA 被动打理造成的随机，断言确定性。
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
const port = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-plotn-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true }); return r && r.result ? r.result.value : null; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
let pass = 0, fail = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) pass++; else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); } };

async function run(dataExpr) {
  await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(1500);
  await ev(`(function(){ var d = ${dataExpr}; var s = JSON.stringify(d); try { window.activeStore().set('garden-data', s); } catch(e){ localStorage.setItem('xy-home-v2:default:garden-data', s); } return 'ok'; })()`);
  await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(2400);
  await ev(`(function(){var c=document.getElementById('splash-age-check'); if(c){c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));} var b=document.getElementById('splash-confirm-ok'); if(b) b.click();})()`); await sleep(800);
  await ev(`document.querySelector('.app[data-app="garden"]')?.click()`); await sleep(1200);
  await ev(`(function(){var ms=document.querySelectorAll('[class*=modal],[class*=overlay]');ms.forEach(function(m){if(m&&m.style)m.style.display='none';});return true;})()`); await sleep(200);
  const st = JSON.parse(await ev(`(function(){ var d={}; try{ d=JSON.parse(window.activeStore().get('garden-data')||'{}'); }catch(e){} return JSON.stringify({ tiles:document.querySelectorAll('#garden-grid .garden-plot').length, storedPlotN:d.plotN, flowers:(d.p||[]).filter(Boolean).length }); })()`));
  return st;
}
const nowSec = 'Math.floor(Date.now()/1000)';
const flowers = (n, from = 0) => `(function(){var p=new Array(12).fill(null);for(var i=${from};i<${from + n};i++)p[i]={type:'rose',planted:${nowSec}-1000000,bloomedAt:${nowSec}-100,by:'我'};return p;})()`;
const tail = `l:[],lpc:${nowSec}+999999999,dex:{},inv:{},st:{},decor:{},visitor:null`;

let r = await run(`{p:new Array(12).fill(null),plotN:undefined,exp:0,${tail}}`);
A('A 新档=12块', r.tiles === 12 && r.storedPlotN === 12, JSON.stringify(r));
r = await run(`{p:new Array(12).fill(null),exp:5000,${tail}}`);
A('B 满级无plotN=12块（不再22）', r.tiles === 12 && r.storedPlotN === 12, JSON.stringify(r));
r = await run(`{p:${flowers(8)},plotN:22,exp:5000,${tail}}`);
A('C plotN22尾空→12块/花不丢', r.tiles === 12 && r.storedPlotN === 12 && r.flowers >= 8, JSON.stringify(r));
r = await run(`{p:(function(){var p=new Array(22).fill(null);p[0]={type:'rose',planted:${nowSec}-1000000,bloomedAt:${nowSec}-100,by:'我'};p[15]={type:'lily',planted:${nowSec}-1000000,bloomedAt:${nowSec}-100,by:'我'};return p;})(),plotN:22,exp:5000,${tail}}`);
A('D 12块后有花→保留22/花不丢', r.tiles === 22 && r.storedPlotN === 22 && r.flowers >= 2, JSON.stringify(r));
r = await run(`{p:${flowers(8)},plotN:22,pnUser:1,exp:5000,${tail}}`);
A('E 手动开垦过→保留22块', r.tiles === 22 && r.storedPlotN === 22, JSON.stringify(r));
r = await run(`{p:${flowers(16)},exp:5000,${tail}}`);
A('F 无plotN花到第16块→保留16/花不丢', r.tiles === 16 && r.storedPlotN === 16 && r.flowers >= 16, JSON.stringify(r));
A('G 无 JS 异常', (await ev(`(window.__jsErrors&&window.__jsErrors.length)||0`)) === 0);

console.log('PASS', pass, 'FAIL', fail);
if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n'));
ws.close(); chrome.kill(); server.close(); process.exit(fail ? 1 : 0);

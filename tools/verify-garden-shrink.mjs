// verify-garden-shrink.mjs —— #601c「花园·收地」行为回归
// 断言：A 中间空洞+尾部有花时，选中那块空地可单独收回、后面的花前移且不裁花（12→11、8 花不变）；
//       B 未选中时退回「收尾部连续空地」（12→8）；C 选中「有花的地块」明确提示不能收且不变；
//       D 已到下限 4 块时提示「最少保留 4 块」且不变；E 全程 0 JS 异常。
// 用 CDP Storage.clearDataForOrigin 清源存储后再种花园数据（否则 idbRestore 会用 IndexedDB 旧态回填覆盖种子）。
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-shrink2-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true }); return r && r.result ? r.result.value : null; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
let pass = 0, fail = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) pass++; else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); } };

// 种子方式：在已加载的 app 页写 localStorage（花园 load() 先读 LS；idbRestore 只在 LS 键缺失时回填，
// 故 LS 有值即种子生效），随后立即重载。
async function seedAndOpen(kind) {
  await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(1600);
  await ev(`(() => {
    const now = Math.floor(Date.now()/1000);
    const p = new Array(12).fill(null);
    const mk = () => ({ type:'rose', planted: now-1000000, bloomedAt: now-100, by:'我' });
    if ('${kind}' === 'holes') { [0,1,2,3,8,9,10,11].forEach(i=>p[i]=mk()); }
    else if ('${kind}' === 'tail') { for(let i=0;i<8;i++) p[i]=mk(); }
    else if ('${kind}' === 'allflower') { for(let i=0;i<12;i++) p[i]=mk(); }
    const d = { p:p, plotN:12, l:[], lpc:now+999999999, dex:{}, exp:100, inv:{}, st:{p:0,w:0,h:0,f:0,mp:0,mw:0,mh:0,mf:0}, decor:{}, visitor:null };
    const str = JSON.stringify(d);
    // 走 app 自己的 store 写入（同时写 memoryCache + LS + IDB）——只写 raw localStorage 会被
    // xyStore.get 的 memoryCache（IndexedDB 回填）遮蔽，导致重载后仍读回旧数据
    try { if (window.activeStore) window.activeStore().set('garden-data', str); else localStorage.setItem('xy-home-v2:default:garden-data', str); }
    catch (e) { localStorage.setItem('xy-home-v2:default:garden-data', str); }
    return 'ok';
  })()`);
  await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(2500);
  await ev(`(function(){var c=document.getElementById('splash-age-check'); if(c){c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));} var b=document.getElementById('splash-confirm-ok'); if(b) b.click();})()`); await sleep(900);
  await ev(`document.querySelector('.app[data-app="garden"]')?.click()`); await sleep(1200);
  await ev(`(function(){var ms=document.querySelectorAll('[class*=modal],[class*=overlay]');ms.forEach(function(m){if(m&&m.style)m.style.display='none';});return true;})()`); await sleep(200);
}
const state = () => ev(`JSON.stringify({ tiles: document.querySelectorAll('#garden-grid .garden-plot').length, flowers: document.querySelectorAll('#garden-grid .garden-plot:not(.empty)').length, maxIdx: (function(){var m=-1;document.querySelectorAll('#garden-grid .garden-plot:not(.empty)').forEach(function(el){var i=parseInt(el.getAttribute('data-idx'),10); if(!isNaN(i)&&i>m)m=i;});return m;})(), mask: !document.getElementById('modal-mask').hidden, title: document.getElementById('modal-title').textContent, static: document.getElementById('modal-static').textContent })`);

// A) 中间空洞 + 尾部有花：选中第 4 块空地 → 收这块，后面的花前移
await seedAndOpen('holes');
let s0 = JSON.parse(await state());
A('A0 初始 12 块 / 8 花', s0.tiles === 12 && s0.flowers === 8, JSON.stringify(s0));
// 点选第 5 块（index 4）空地
await ev(`(function(){var el=document.querySelector('#garden-grid .garden-plot[data-idx="4"]'); if(el) el.click(); return true;})()`); await sleep(200);
A('A1 空地已选中', await ev(`!!document.querySelector('#garden-grid .garden-plot[data-idx="4"].selected')`));
await ev(`document.querySelector('#garden-toolbar [data-tool="shrink"]')?.click()`); await sleep(500);
let mo = JSON.parse(await state());
A('A2 弹窗为收回这块', mo.mask && /收回第 5 块/.test(mo.static), mo.static);
await ev(`document.querySelector('#modal-pills .pill')?.click()`); await sleep(150);
await ev(`document.getElementById('modal-ok')?.click()`); await sleep(700);
let s1 = JSON.parse(await state());
A('A3 收回后 11 块', s1.tiles === 11, JSON.stringify(s1));
A('A4 花未丢（≥8，TA 可能被动多种）', s1.flowers >= 8, JSON.stringify(s1));
let st1 = JSON.parse(await ev(`(function(){var d=JSON.parse(localStorage.getItem('xy-home-v2:default:garden-data')||'{}');var f=(d.p||[]).filter(Boolean).length;return JSON.stringify({plotN:d.plotN,len:(d.p||[]).length,flowers:f});})()`));
A('A5 存储 plotN=11/len=11/花未丢', st1.plotN === 11 && st1.len === 11 && st1.flowers >= 8, JSON.stringify(st1));

// B) 尾部空地（无选中）→ 退回原逻辑（TA 可能被动种/收，故用「关系断言」而非绝对数）
await seedAndOpen('tail');
const before = JSON.parse(await state());
await ev(`document.querySelector('#garden-toolbar [data-tool="shrink"]')?.click()`); await sleep(500);
let sb = JSON.parse(await state());
A('B1 尾部收地弹窗', sb.mask && /把尾部 \d+ 块空地收回/.test(sb.static), sb.static);
await ev(`document.querySelector('#modal-pills .pill')?.click()`); await sleep(150);
await ev(`document.getElementById('modal-ok')?.click()`); await sleep(700);
let s2 = JSON.parse(await state());
A('B2 尾部空地全收（tiles=最后一株+1 且比之前少）', s2.tiles < before.tiles && s2.tiles === s2.maxIdx + 1 && s2.flowers >= 8, JSON.stringify({ before: before.tiles, after: s2 }));

// C) 选中「有花的地块」→ 明确提示不能收
await seedAndOpen('allflower');
await ev(`(function(){var el=document.querySelector('#garden-grid .garden-plot[data-idx="2"]'); if(el) el.click(); return true;})()`); await sleep(200);
await ev(`document.querySelector('#garden-toolbar [data-tool="shrink"]')?.click()`); await sleep(500);
let sc = JSON.parse(await state());
A('C1 有花地块提示不能收', sc.mask && /选中的地块有花/.test(sc.static), sc.static);
await ev(`document.getElementById('modal-ok')?.click()`); await sleep(300);
A('C2 点确定后仍 12 块', (await ev(`document.querySelectorAll('#garden-grid .garden-plot').length`)) === 12);

// D) 已到下限 4 块时选中空地 → 提示不能收
await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(1600);
await ev(`(() => { const d = { p:[null,null,null,null], plotN:4, l:[], lpc:Math.floor(Date.now()/1000)+999999999, dex:{}, exp:0, inv:{}, st:{p:0,w:0,h:0,f:0,mp:0,mw:0,mh:0,mf:0}, decor:{}, visitor:null }; const str = JSON.stringify(d); try { if (window.activeStore) window.activeStore().set('garden-data', str); else localStorage.setItem('xy-home-v2:default:garden-data', str); } catch (e) { localStorage.setItem('xy-home-v2:default:garden-data', str); } return 'ok'; })()`);
await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(2500);
await ev(`(function(){var c=document.getElementById('splash-age-check'); if(c){c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));} var b=document.getElementById('splash-confirm-ok'); if(b) b.click();})()`); await sleep(900);
await ev(`document.querySelector('.app[data-app="garden"]')?.click()`); await sleep(1200);
await ev(`(function(){var el=document.querySelector('#garden-grid .garden-plot[data-idx="1"]'); if(el) el.click(); return true;})()`); await sleep(200);
await ev(`document.querySelector('#garden-toolbar [data-tool="shrink"]')?.click()`); await sleep(500);
let sd = JSON.parse(await state());
A('D1 下限提示', sd.mask && /最少保留 4 块/.test(sd.static), sd.static);
await ev(`document.getElementById('modal-ok')?.click()`); await sleep(300);
A('D2 仍 4 块', (await ev(`document.querySelectorAll('#garden-grid .garden-plot').length`)) === 4);

A('E1 无 JS 异常', (await ev(`(window.__jsErrors&&window.__jsErrors.length)||0`)) === 0);

console.log('PASS', pass, 'FAIL', fail);
if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n'));
ws.close(); chrome.kill(); server.close(); process.exit(fail ? 1 : 0);

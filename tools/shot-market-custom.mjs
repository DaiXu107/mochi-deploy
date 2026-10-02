import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); const body = readFileSync(p); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(body); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9300 + Math.floor(Math.random() * 500);
const udd = join(process.env.TEMP || '/tmp', 'mochi-shot-mc-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() { for (let i = 0; i < 60; i++) { try { const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); const page = list.find((t) => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; } } catch (e) {} await sleep(150); } throw new Error('无法连接'); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; } }
await cdpConnect(); await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 预置一个带图自定义商品（48px 紫色渐变 JPEG）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
  var c=document.createElement('canvas');c.width=48;c.height=48;var x=c.getContext('2d');
  var g=x.createLinearGradient(0,0,48,48);g.addColorStop(0,'#8b7ac8');g.addColorStop(1,'#e8a4c8');x.fillStyle=g;x.fillRect(0,0,48,48);
  x.fillStyle='#fff';x.font='28px serif';x.textAlign='center';x.textBaseline='middle';x.fillText('🧸',24,26);
  var img=c.toDataURL('image/jpeg',.85);
  localStorage.setItem('xy-home-v2:market-custom', JSON.stringify([{id:'g_custom_shot',name:'测试熊',emoji:'🧸',img:img,price:66.5,cat:'关怀',wish:'测试留言'}]));
})()` });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
await sleep(800);
await evalJs("(function(){var b=document.querySelector('.app[data-app=\"market\"]');if(b){b.click();return true;}return false;})()");
await sleep(1200);
await evalJs("(function(){var cats=document.getElementById('market-cats');if(cats){var all=cats.querySelector('[data-cat=\"全部\"]');if(all)all.click();}var items=document.querySelectorAll('#market-grid .gift-item');for(var i=0;i<items.length;i++){if(items[i].dataset.id==='g_custom_shot'){items[i].scrollIntoView({block:'center'});break;}}return true;})()");
await sleep(800);
let r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
writeFileSync(join(root, 'market-img.jpg'), Buffer.from(r.data, 'base64'));
// 编辑表单（管理模式点商品）
await evalJs("(function(){document.getElementById('market-manage').click();return true;})()");
await sleep(400);
await evalJs("(function(){var items=document.querySelectorAll('#market-grid .gift-item');for(var i=0;i<items.length;i++){if(items[i].dataset.id==='g_custom_shot'){items[i].querySelector('.gift-item-edit').click();break;}}return true;})()");
await sleep(700);
r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
writeFileSync(join(root, 'market-form.jpg'), Buffer.from(r.data, 'base64'));
console.log('截图完成: market-img.jpg / market-form.jpg');
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { require('node:fs').rmSync(udd, { recursive: true, force: true }); } catch (e) {}

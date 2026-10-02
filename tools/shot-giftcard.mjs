import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || 'giftcard-before.jpg';
const candidates = [process.env.CHROME_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); const body = readFileSync(p); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(body); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-shot-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() { for (let i = 0; i < 60; i++) { try { const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); const page = list.find((t) => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; } } catch (e) {} await sleep(150); } throw new Error('无法连接'); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; } }
await cdpConnect(); await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
if (process.env.DARK) await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
await sleep(800);
// 进入聊天页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(1200);
for (var k = 0; k < 5; k++) { await evalJs("(function(){var ms=document.querySelectorAll('[class*=modal],[class*=overlay]');ms.forEach(function(m){if(m&&m.style)m.style.display='none';});return true;})()"); await sleep(200); }
// 注入两条礼物消息（我送出 / TA 送来）
await evalJs("(function(){try{window.chatAddGift({side:'out',special:'gift',giftId:'g_rose',giftName:'玫瑰',giftEmoji:'🌹',giftPrice:52,giftWish:'送你一束玫瑰，像见你那天的风',giftCat:'花束',ts:Date.now()});}catch(e){}try{window.chatAddGift({side:'in',special:'gift',giftId:'g_moon',giftName:'月亮',giftEmoji:'🌙',giftPrice:99.99,giftWish:'把月亮装好送你，今晚不用自己照路',giftCat:'星空',ts:Date.now()});}catch(e){}var b=document.querySelector('.chat-body');if(b)b.scrollTop=b.scrollHeight;return true;})()");
await sleep(800);
const info = await evalJs("(function(){var c=document.querySelector('.msg-gift-card');var r=c?c.getBoundingClientRect():null;return JSON.stringify({found:!!c,w:r&&Math.round(r.width),h:r&&Math.round(r.height)});})()");
console.log(OUT, info);
const r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
writeFileSync(join(root, OUT), Buffer.from(r.data, 'base64'));
console.log('截图已保存: ' + OUT);
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

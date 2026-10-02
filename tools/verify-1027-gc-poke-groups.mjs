// 临时诊断（不入库）：#1027 群聊拍一拍分组条行为验证
// 链路：造成员 → 写两个自建分组 + 一条存量扁平 → 点成员头像 → 断言分组条/筛选/记忆/发送
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean)
  .find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1027-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
await evalJs('(function(){try{window.createContact("小明");}catch(e){}return 1;})()');
await evalJs('(function(){window.saveReplyCfg("gc-prob",100);window.saveReplyCfg("gc-rs-min",1);window.saveReplyCfg("gc-rs-max",2);return 1;})()');
await sleep(300);
// 造数据：两个自建分组（其中一条是媒体形态＝应被守卫剔掉）+ 一条与预设重名（应被去重）
await evalJs(`(function(){var st=window.activeStore();
st.set('poke-groups-mine', JSON.stringify([['撒娇',['拍了拍我的小书包','撅起嘴等你哄']],['搞怪',['戴好头盔准备起飞','data:image/png;base64,AAAA','@@m:tok123']]]));
st.set('poke-user-mine', JSON.stringify(['拍了拍你','存量扁平的一条']));return 1;})()`) ;
await evalJs('(function(){var a=document.querySelector(\'[data-app="group-chat"]\');a.hidden=false;a.click();return 1;})()');
await sleep(900);
await evalJs('(function(){var i=document.getElementById("gc-input");i.textContent="大家好呀";document.getElementById("gc-send").click();return 1;})()');
let inCount = 0;
for (let i = 0; i < 30; i++) { inCount = await evalJs('window.groupChatGetMsgs().filter(function(m){return m.side==="in";}).length'); if (inCount > 0) break; await sleep(500); }
check('G0 有成员消息可点头像', inCount > 0, inCount);
const openPoke = () => evalJs('(function(){var a=document.querySelectorAll("#gc-body .msg-in .msg-av");a[a.length-1].click();return 1;})()');
await openPoke();
await sleep(400);
const snap = () => evalJs(`(function(){var p=document.getElementById('gc-poke-card');
var bar=p.querySelector('.poke-groups');
var chips=bar?Array.prototype.map.call(bar.querySelectorAll('.emoji-g-chip'),function(c){return c.textContent+(c.classList.contains('sel')?'*':'');}):[];
var items=Array.prototype.map.call(document.querySelectorAll('#gc-poke-list .cc-item .t'),function(e){return e.textContent;});
return JSON.stringify({open:!!p&&!p.hidden,barVisible:bar?getComputedStyle(bar).display:'none',chips:chips,items:items,pref:window.activeStore().get('gc-poke-group')||''});})()`);
let s = {}; try { s = JSON.parse(await snap()) } catch (e) {}
check('G1 面板打开且分组条可见', s.open === true && s.barVisible === 'flex', s);
const has = (arr, re) => arr.some((c) => re.test(c));
check('G2 四个来源各成一枚 chip（预设/撒娇/搞怪/存量，带条数、默认选中预设）',
  has(s.chips, /^预设6\*$/) && has(s.chips, /^撒娇2$/) && has(s.chips, /^搞怪1$/) && has(s.chips, /^我的新增1$/), s.chips);
check('G3 默认落在预设（6 条）', s.items.length === 6 && s.items[0] === '拍了拍你', s.items);
// 切到「撒娇」
await evalJs("(function(){var c=document.querySelectorAll('#gc-poke-card .poke-groups .emoji-g-chip');for(var i=0;i<c.length;i++){if(c[i].textContent.indexOf('撒娇')===0)c[i].click();}return 1;})()");
await sleep(300);
let s2 = {}; try { s2 = JSON.parse(await snap()) } catch (e) {}
check('G4 点 chip 后只显示该组字卡（媒体卡被守卫剔掉）', s2.items.length === 2 && s2.items.indexOf('拍了拍我的小书包') >= 0 && s2.items.join('|').indexOf('@@m:') < 0, s2.items);
check('G5 选中态与记忆键同步', /撒娇2\*/.test(s2.chips.join(',')) && s2.pref.indexOf('撒娇') > 0, s2);
// 重开面板应落回「撒娇」
await evalJs("document.getElementById('gc-poke-close').click()");
await sleep(200);
await openPoke();
await sleep(400);
let s3 = {}; try { s3 = JSON.parse(await snap()) } catch (e) {}
check('G6 重开面板记住上次的分组', s3.open === true && s3.items.length === 2, s3.items);
// 从选中组点卡发送
await evalJs("(function(){var d=document.querySelectorAll('#gc-poke-list .cc-item');for(var i=0;i<d.length;i++){if(d[i].textContent.indexOf('拍了拍我的小书包')>=0)d[i].click();}return 1;})()");
await sleep(500);
const sent = await evalJs("(function(){var m=window.groupChatGetMsgs().filter(function(x){return x.special==='poke';});var l=m[m.length-1]||{};return JSON.stringify({special:l.special,text:l.text,n:m.length});})()");
let sn = {}; try { sn = JSON.parse(sent) } catch (e) {}
check('G7 组内点卡照常发出拍一拍', sn.special === 'poke' && String(sn.text || '').indexOf('小书包') >= 0, sn);
// 只有单一来源时分组条收起
await evalJs("(function(){var st=window.activeStore();st.set('poke-groups-mine','[]');st.set('poke-user-mine','[]');return 1;})()");
await evalJs("document.getElementById('gc-poke-close').click()");
await sleep(200);
await openPoke();
await sleep(400);
let s4 = {}; try { s4 = JSON.parse(await snap()) } catch (e) {}
check('G8 只剩预设一个来源时分组条收起（不占一行）', s4.open === true && s4.items.length === 6 && (s4.chips || []).length === 0, s4);
const errs = await evalJs('(function(){var a=Array.isArray(window.__jsErrors)?window.__jsErrors:[];return JSON.stringify(a);})()');
check('G9 全程零未捕获错误', errs === '[]', errs);
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
server.close(); chrome.kill();
process.exit(pass === results.length ? 0 : 1);

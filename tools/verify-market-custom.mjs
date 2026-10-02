// 心意市集自定义商品（编辑/图片上传/全局互通）冒烟验证
// 用法：node tools/verify-market-custom.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name, extra || ''); } else { fail++; console.log('FAIL', name, extra || ''); } };
const candidates = [process.env.CHROME_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); const body = readFileSync(p); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(body); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9300 + Math.floor(Math.random() * 500));
const udd = join(process.env.TEMP || '/tmp', 'mochi-verify-mc-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const logs = [];
async function cdpConnect() { for (let i = 0; i < 60; i++) { try { const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); const page = list.find((t) => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300)); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; } } catch (e) {} await sleep(150); } throw new Error('无法连接'); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; } }
await cdpConnect(); await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('DOM.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

// ---- 预置旧数据（v1 扩库前格式）：default 桌面旧 market-gifts = 全部 v1 默认 - 玫瑰 + 旧自定义A；
//      c1 桌面 = 全部 v1 默认 + 旧自定义B
const V1 = ['g_rose','g_sun','g_stars','g_tulip','g_peach','g_cake','g_choc','g_tea','g_candy','g_berry','g_ring','g_neck','g_brace','g_bow','g_star1','g_moon','g_cloud','g_rainbow','g_meteor','g_galaxy','g_hug','g_kiss','g_night','g_soup','g_letter','g_couplecup','g_couplewear','g_lock','g_couavatar','g_coudiary','g_couframe','g_cousong','g_coucoin','g_towel','g_mug','g_umbrella','g_pillow','g_warmer','g_earphone','g_notebook','g_keychain','g_lamp','g_candle'];
const seed = `(function(){
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{id:'default',name:'默认'},{id:'c1',name:'二号桌面'}]));
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  var V1=${JSON.stringify(V1)};
  var mk=function(drop,extra){var a=V1.filter(function(id){return id!==drop}).map(function(id){return {id:id,name:id,emoji:'🎁',price:9.9,cat:'关怀',wish:'w'}});return JSON.stringify(a.concat(extra));};
  localStorage.setItem('xy-home-v2:default:market-gifts', mk('g_rose',[{id:'g_custom_a',name:'旧自定义A',emoji:'🧸',price:11,cat:'关怀',wish:'旧A'}]));
  localStorage.setItem('xy-home-v2:c1:market-gifts', mk(null,[{id:'g_custom_b',name:'旧自定义B',emoji:'🎲',price:22,cat:'关怀',wish:'旧B'}]));
  return true;})()`;
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: seed });

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(800);
}
async function openMarket() {
  const clicked = await evalJs("(function(){var b=document.querySelector('.app[data-app=\"market\"]');if(b){b.click();return 'ok';}return 'no-icon';})()");
  await sleep(1000);
  const st = await evalJs("(function(){var p=document.getElementById('page-market');return JSON.stringify({clicked:" + JSON.stringify(clicked) + ",hidden:p?p.hidden:'no-page',items:document.querySelectorAll('#market-grid .gift-item').length});})()");
  return JSON.parse(st);
}
function hideOverlays() { return evalJs("(function(){var ms=document.querySelectorAll('[class*=modal],[class*=overlay]');ms.forEach(function(m){if(m&&m.style)m.style.display='none';});var t=document.getElementById('tc-mask');if(t)t.hidden=true;return true;})()"); }

await boot();
// 1. 迁移
let r = JSON.parse(await evalJs("(function(){var a=JSON.parse(localStorage.getItem('xy-home-v2:market-custom')||'[]');return JSON.stringify({n:a.length,hasA:a.some(function(x){return x.id==='g_custom_a'}),hasB:a.some(function(x){return x.id==='g_custom_b'}),delRose:a.some(function(x){return x.id==='g_rose'&&x.del}),delOther:a.some(function(x){return x.del&&x.id!=='g_rose'}),mark:localStorage.getItem('xy-home-v2:market-migrated')});})()"));
ok('迁移-两桌面自定义商品入全局库', r.hasA === true && r.hasB === true, JSON.stringify(r));
ok('迁移-仅缺的v1默认记墓碑', r.delRose === true && r.delOther === false);
ok('迁移-幂等标记', r.mark === '1');

// 2. 市集渲染
let st = await openMarket();
ok('市集-页面打开且有商品', st.hidden === false && st.items > 0, JSON.stringify(st));
r = JSON.parse(await evalJs("(function(){var ids=[].map.call(document.querySelectorAll('#market-grid .gift-item'),function(x){return x.dataset.id});return JSON.stringify({hasA:ids.indexOf('g_custom_a')>=0,hasB:ids.indexOf('g_custom_b')>=0,hasRose:ids.indexOf('g_rose')>=0});})()"));
ok('市集-全局自定义渲染/被删默认不渲染', r.hasA && r.hasB && !r.hasRose, JSON.stringify(r));

// 3. 添加自定义商品（带图片：CDP 给持久 input 塞文件）
await hideOverlays();
await evalJs("(function(){var b=document.getElementById('market-add');if(b){b.click();return true;}return false;})()");
await sleep(600);
const doc = await cdp('DOM.getDocument', { depth: -1 });
const findNode = (n) => { if (n.nodeName === 'INPUT' && n.attributes && n.attributes.join(' ').includes('gm-img-input')) return n.nodeId; for (const c of (n.children || [])) { const f = findNode(c); if (f) return f; } return 0; };
const nodeId = findNode(doc.root);
ok('表单-持久化图片input已挂载', nodeId > 0);
const testPng = join(udd, 'mc-test.png');
writeFileSync(testPng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
if (nodeId) { await cdp('DOM.setFileInputFiles', { files: [testPng], nodeId }); await sleep(900); }
r = JSON.parse(await evalJs("(function(){var p=document.getElementById('gm-img-prev');return p?JSON.stringify({img:!!p.querySelector('img'),btn:(document.getElementById('gm-img-pick')||{}).textContent,clear:!!document.getElementById('gm-img-clear')}):'no-row';})()"));
ok('表单-图片压缩预览+换一张+清除', r && r.img === true && r.btn === '换一张' && r.clear === true, JSON.stringify(r));
await evalJs("(function(){document.getElementById('gm-name').value='测试熊';document.getElementById('gm-emoji').value='🧸';document.getElementById('gm-price').value='66.5';document.getElementById('gm-cat').value='关怀';document.getElementById('gm-wish').value='测试留言';return true;})()");
await evalJs("(function(){document.getElementById('gm-ok').click();return true;})()");
await sleep(600);
r = JSON.parse(await evalJs("(function(){var a=JSON.parse(localStorage.getItem('xy-home-v2:market-custom')||'[]');var c=a.filter(function(x){return x.name==='测试熊'})[0];return c?JSON.stringify({img:c.img&&c.img.indexOf('data:image/jpeg;base64,')===0,price:c.price,cat:c.cat,wish:c.wish}):'none';})()"));
ok('保存-自定义商品含压缩图(jpeg480)', r && r.img === true, JSON.stringify(r));
r = JSON.parse(await evalJs("(function(){var names=[].map.call(document.querySelectorAll('#market-grid .gift-item-name'),function(x){return x.textContent});var imgs=document.querySelectorAll('#market-grid .gift-item-img').length;return JSON.stringify({has:names.indexOf('测试熊')>=0,imgs:imgs});})()"));
ok('市集-新商品+图片渲染', r.has === true && r.imgs >= 1, JSON.stringify(r));

// 4. 编辑默认商品 → 覆盖项
await evalJs("(function(){var b=document.getElementById('market-manage');if(b){b.click();return true;}return false;})()");
await sleep(400);
await evalJs("(function(){var items=document.querySelectorAll('#market-grid .gift-item');for(var i=0;i<items.length;i++){var n=items[i].querySelector('.gift-item-name');if(n&&n.textContent==='向日葵'){items[i].querySelector('.gift-item-edit').click();break;}}return true;})()");
await sleep(600);
await evalJs("(function(){document.getElementById('gm-name').value='向日葵Pro';document.getElementById('gm-price').value='99';return true;})()");
await evalJs("(function(){document.getElementById('gm-ok').click();return true;})()");
await sleep(500);
r = JSON.parse(await evalJs("(function(){var a=JSON.parse(localStorage.getItem('xy-home-v2:market-custom')||'[]');var o=a.filter(function(x){return x.id==='g_sun'})[0];var names=[].map.call(document.querySelectorAll('#market-grid .gift-item-name'),function(x){return x.textContent});return JSON.stringify({base:o&&o.base===1,name:o&&o.name,rendered:names.indexOf('向日葵Pro')>=0});})()"));
ok('编辑默认-覆盖项生效并渲染', r && r.base === true && r.name === '向日葵Pro' && r.rendered === true, JSON.stringify(r));

// 5. 删除默认商品 → 墓碑 + 恢复默认按钮
await evalJs("(function(){var items=document.querySelectorAll('#market-grid .gift-item');for(var i=0;i<items.length;i++){var n=items[i].querySelector('.gift-item-name');if(n&&n.textContent==='小蛋糕'){items[i].querySelector('.gift-item-del').click();break;}}return true;})()");
await sleep(500);
await evalJs("(function(){var bs=[].slice.call(document.querySelectorAll('button')).filter(function(b){return /确定|确认/.test(b.textContent)});if(bs[0])bs[0].click();return true;})()");
await sleep(500);
r = JSON.parse(await evalJs("(function(){var names=[].map.call(document.querySelectorAll('#market-grid .gift-item-name'),function(x){return x.textContent});var rb=document.getElementById('market-reset');return JSON.stringify({gone:names.indexOf('小蛋糕')<0,resetVisible:rb&&!rb.hidden});})()"));
ok('删除默认-墓碑生效+恢复按钮出现', r && r.gone === true && r.resetVisible === true, JSON.stringify(r));
await evalJs("(function(){document.getElementById('market-reset').click();return true;})()");
await sleep(500);
await evalJs("(function(){var bs=[].slice.call(document.querySelectorAll('button')).filter(function(b){return /确定|确认/.test(b.textContent)});if(bs[0])bs[0].click();return true;})()");
await sleep(500);
r = JSON.parse(await evalJs("(function(){var names=[].map.call(document.querySelectorAll('#market-grid .gift-item-name'),function(x){return x.textContent});var a=JSON.parse(localStorage.getItem('xy-home-v2:market-custom')||'[]');return JSON.stringify({cakeBack:names.indexOf('小蛋糕')>=0,sunPro:names.indexOf('向日葵Pro')>=0,noDelLeft:!a.some(function(x){return x.del}),noBaseLeft:!a.some(function(x){return x.base}),customKept:a.some(function(x){return x.name==='测试熊'})});})()"));
ok('恢复默认-墓碑/覆盖清除+自定义保留', r && r.cakeBack === true && r.noDelLeft === true && r.noBaseLeft === true && r.customKept === true, JSON.stringify(r));

// 6. 全局互通：切到 c1 桌面（重载），default 桌面加的商品仍在
await evalJs("(function(){localStorage.setItem('xy-home-v2:active-contact','c1');return true;})()");
await boot();
st = await openMarket();
r = JSON.parse(await evalJs("(function(){var ids=[].map.call(document.querySelectorAll('#market-grid .gift-item'),function(x){return x.dataset.id});return JSON.stringify({cid:window.__activeCid,hasA:ids.indexOf('g_custom_a')>=0,hasB:ids.indexOf('g_custom_b')>=0,hasTest:ids.indexOf('g_custom_'+Object.keys({})||'')>=0,testName:[].map.call(document.querySelectorAll('#market-grid .gift-item-name'),function(x){return x.textContent}).indexOf('测试熊')>=0,sunPro:[].map.call(document.querySelectorAll('#market-grid .gift-item-name'),function(x){return x.textContent}).indexOf('向日葵')>=0});})()"));
ok('互通-c1桌面可见全部全局商品', r.hasA === true && r.hasB === true && r.testName === true, JSON.stringify(r));

// 7. 聊天送礼面板也用全局库 + 礼物消息卡片图片
await evalJs("(function(){var b=document.getElementById('more-btn')||document.querySelector('.chat-plus,.input-more');if(b){b.click();return true;}return false;})()");
await sleep(400);
await evalJs("(function(){var m=document.getElementById('more-gift');if(m)m.click();return true;})()");
await sleep(500);
r = JSON.parse(await evalJs("(function(){var names=[].map.call(document.querySelectorAll('#gift-grid .gift-item-name'),function(x){return x.textContent});return JSON.stringify({hasTest:names.indexOf('测试熊')>=0});})()"));
ok('聊天送礼面板-全局商品可见', r && r.hasTest === true, JSON.stringify(r));

// 8. 聊天礼物消息卡片：带图商品渲染 <img>
await evalJs("(function(){var p=document.getElementById('chat-gift-panel');if(p)p.hidden=true;var c=window.chatAddGift;var img='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICAgKDA8MCgsOCwgIDRENDg8QEBEQCgsSExIQEA8QEBD/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAA=//ZQ==';if(c)c({side:'out',special:'gift',giftId:'x',giftName:'测试熊',giftEmoji:'🧸',giftImg:img,giftPrice:66.5,giftWish:'测试留言',giftCat:'关怀',ts:Date.now()});return !!c;})()");
await sleep(800);
r = JSON.parse(await evalJs("(function(){var ms=document.querySelectorAll('.msg-gift');var m=ms[ms.length-1];if(!m)return 'no-msg';var im=m.querySelector('.msg-gift-img');return JSON.stringify({hasImg:!!im,name:m.querySelector('.msg-gift-name')&&m.querySelector('.msg-gift-name').textContent});})()"));
ok('聊天礼物卡片-带图商品渲染img', r && r.hasImg === true, JSON.stringify(r));

console.log('\nJS异常: ' + (logs.length ? logs.slice(0, 5).join(' | ') : '无'));
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);

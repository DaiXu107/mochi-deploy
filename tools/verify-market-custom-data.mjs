// #858 心意市集「自己上传商品」入口显眼化 + 商品数据导入/导出 行为验证
// 用法：node tools/verify-market-custom-data.mjs
// 断言面：
//   A 组＝入口显眼（用户原话「这个按钮要显眼一点，好多人不知道有这个功能」）——块存在、
//          主按钮在首屏内、整行宽、深色渐变主按钮；底部老入口不丢。
//   B 组＝上传链路仍通（点主按钮 → 表单 → 存进商品库 → 网格出现 → 计数行更新）。
//   C 组＝导出只装我自己上传的商品（del/base 记录不打包）、文件名/头字段正确。
//   D 组＝导入真实链路（点按钮 → 取文件 → 校验 → 弹窗报数 → 写库）：判重跳过、坏件丢弃、
//          外链图丢弃、默认商品改动记录不受影响、同一文件导入两次不翻倍。
//   E 组＝合并/换库两种模式 + id 撞车重新发号。
//   Z 组＝零异常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name, extra || ''); } else { fail++; console.log('FAIL', name, extra || ''); } };
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); const body = readFileSync(p); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(body); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 500));
const udd = join(process.env.TEMP || '/tmp', 'mochi-verify-mcd-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const logs = [];
async function cdpConnect() { for (let i = 0; i < 60; i++) { try { const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); const page = list.find((t) => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300)); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; } } catch (e) {} await sleep(150); } throw new Error('无法连接'); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; } }
async function js(s) { return JSON.parse((await evalJs(s)) || 'null'); }
await cdpConnect(); await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('DOM.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

// 干净的单桌面夹具（本批只关心商品库这一件事）
const seed = `(function(){
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{id:'default',name:'默认'}]));
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  return true;})()`;
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: seed });

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(800);
}
async function openMarket() {
  await evalJs("(function(){var b=document.querySelector('.app[data-app=\"market\"]');if(b)b.click();return true;})()");
  await sleep(900);
  return await js("(function(){var p=document.getElementById('page-market');return JSON.stringify({hidden:p?p.hidden:'no-page',items:document.querySelectorAll('#market-grid .gift-item').length});})()");
}
const customArr = async () => js("(function(){try{return JSON.stringify(JSON.parse(localStorage.getItem('xy-home-v2:market-custom')||'[]'));}catch(e){return '[]';}})()");
const mineOf = (arr) => arr.filter((c) => c && c.id && !c.del && !c.base);
const modalOpen = () => evalJs("(function(){var m=document.getElementById('modal-mask');return !!(m && !m.hidden);})()");
const modalText = async () => (await evalJs("(function(){var s=document.getElementById('modal-static');return s?s.textContent:'';})() || ''"));
const clickOk = async () => { await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()"); await sleep(400); };
const pickPill = async (i) => {
  await evalJs("(function(){var p=document.getElementById('modal-pills');if(p&&p.children[" + i + "])p.children[" + i + "].click();return true;})()");
  await sleep(150);
};
// 真实导入链路：触发 picker → 往常驻 input 灌 File → 派发 change（与用户选文件同一条 onFiles 路径）
async function feedImportFile(json, fname) {
  return evalJs("(function(){try{var inp=document.getElementById('market-goods-import-pick');if(!inp)return 'no-input';var dt=new DataTransfer();dt.items.add(new File([" + JSON.stringify(json) + "]," + JSON.stringify(fname || 'pack.json') + ",{type:'application/json'}));inp.files=dt.files;inp.dispatchEvent(new Event('change'));return 'ok';}catch(e){return 'err:'+e.message;}})()");
}
const clickBtn = async (id) => { await evalJs("(function(){var b=document.getElementById('" + id + "');if(b)b.click();return true;})()"); await sleep(350); };

const PACK1 = JSON.stringify({
  app: 'mochi-market-goods', version: '1.0', kind: 'market-goods', goods: [
    { id: 'g_custom_pack_a', name: '纸折星星', emoji: '⭐', price: 5.2, cat: '星空', wish: '一颗一颗都是我', img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
    { id: 'g_custom_pack_b', name: '我的手工饼干', emoji: '🍪', price: 13.14, cat: '甜品', wish: '吃一口就想起我' },
    { id: 'g_custom_pack_c', price: 9, cat: '甜品' },
    { id: 'g_custom_pack_d', name: '外链礼物', emoji: '🔗', price: 8, cat: '关怀', wish: '看看就好', img: 'https://example.com/x.png' }
  ]
});
const PACK2 = JSON.stringify({ goods: [{ id: 'g_custom_pack_e', name: '换库礼物', emoji: '🎀', price: 66, cat: '饰品', wish: '只留我' }] });
const PACK3 = JSON.stringify({ items: [{ id: 'g_custom_pack_e', name: '撞名礼物', emoji: '🎈', price: 77, cat: '娱乐', wish: '我才是新的' }] });
const PACK3B = JSON.stringify({ goods: [{ id: 'g_custom_pack_e', name: '换库礼物', emoji: '🎀', price: 99, cat: '饰品', wish: '只留我' }] });
const PACK4 = JSON.stringify({ goods: [{ id: 'g_custom_pack_f', name: '换库专属', emoji: '🧿', price: 66, cat: '饰品', wish: '换库后就剩我' }] });

// ================= 开始 =================
await boot();
let st = await openMarket();
ok('S0 市集页打开', st.hidden === false, JSON.stringify(st));

// ---- A 组：入口显眼 ----
let r = await js(`(function(){
  var box=document.getElementById('market-mine');
  var add=document.getElementById('market-mine-add');
  if(!box||!add) return JSON.stringify({box:!!box,add:!!add});
  var cs=getComputedStyle(add), rc=add.getBoundingClientRect();
  var foot=document.getElementById('market-add');
  return JSON.stringify({box:!!box,boxVisible:box.getBoundingClientRect().height>0,
    txt:add.textContent||'', top:Math.round(rc.top), h:Math.round(rc.height), w:Math.round(rc.width),
    vh:window.innerHeight, grad:(cs.backgroundImage||'').indexOf('gradient')>=0,
    footTxt:foot?(foot.textContent||''):'', footIn:!!foot});})()`);
ok('A1 我的商品块存在且可见', r.box === true && r.boxVisible === true, JSON.stringify(r));
ok('A2 主按钮文案含「上传我的商品」', typeof r.txt === 'string' && r.txt.indexOf('上传我的商品') >= 0, r.txt);
ok('A3 主按钮在首屏内（进页即见）', r.top >= 0 && r.top + r.h < r.vh, 'top=' + r.top + ' bottom=' + (r.top + r.h) + ' vh=' + r.vh);
ok('A4 主按钮整行宽（≥300）', r.w >= 300, 'w=' + r.w);
ok('A5 主按钮是深色渐变主按钮', r.grad === true, (r.grad ? 'has-gradient' : 'no-gradient'));
ok('A6 底部老入口不丢（＋上传商品）', r.footIn === true && r.footTxt.indexOf('上传商品') >= 0, r.footTxt);
// 窄屏（360×640，最小常见屏）与深色主题下同样要「进页即见、整行宽、深色主按钮」
const measureAdd = () => js(`(function(){
  var add=document.getElementById('market-mine-add');
  if(!add) return JSON.stringify({has:false});
  var cs=getComputedStyle(add), rc=add.getBoundingClientRect();
  return JSON.stringify({has:true, top:Math.round(rc.top), h:Math.round(rc.height), w:Math.round(rc.width),
    vh:window.innerHeight, grad:(cs.backgroundImage||'').indexOf('gradient')>=0, color:cs.color, bg:cs.backgroundColor});})()`);
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true });
await sleep(400);
r = await measureAdd();
ok('A7 窄屏 360 仍首屏可见且整行宽', r.has === true && r.top >= 0 && r.top + r.h < r.vh && r.w >= 300, JSON.stringify(r));
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evalJs("(function(){document.documentElement.setAttribute('data-theme','dark');return true;})()");
await sleep(300);
r = await measureAdd();
ok('A8 深色主题下主按钮反白仍醒目（浅底深字）', r.has === true && r.grad === true && r.color.indexOf('17, 17, 17') >= 0, JSON.stringify({ grad: r.grad, color: r.color }));
await evalJs("(function(){document.documentElement.removeAttribute('data-theme');return true;})()");
await sleep(200);

// ---- B 组：上传链路 ----
await clickBtn('market-mine-add');
r = await js("(function(){var m=document.getElementById('tc-mask');return JSON.stringify({tc:!!(m&&!m.hidden),name:!!document.getElementById('gm-name')});})()");
ok('B1 点主按钮打开上传表单', r.tc === true && r.name === true, JSON.stringify(r));
await evalJs(`(function(){
  document.getElementById('gm-name').value='我的手工饼干';
  document.getElementById('gm-emoji').value='🍪';
  document.getElementById('gm-price').value='13.14';
  document.getElementById('gm-cat').value='甜品';
  document.getElementById('gm-wish').value='吃一口就想起我';
  return true;})()`);
await clickBtn('gm-ok');
let arr = await customArr();
let mine = mineOf(arr);
ok('B2 表单保存进商品库', mine.length === 1 && mine[0].name === '我的手工饼干' && mine[0].price === 13.14, JSON.stringify(mine));
r = await js("(function(){var el=document.querySelector('#market-grid .gift-item[data-id=\"" + (mine[0] && mine[0].id) + "\"]');return JSON.stringify({inGrid:!!el});})()");
ok('B3 新商品出现在网格里', r.inGrid === true, JSON.stringify(r));
r = await js("(function(){var e=document.getElementById('market-mine-cnt');return JSON.stringify({txt:e?e.textContent:''});})()");
ok('B4 计数行报「已上传 1 件」', r.txt.indexOf('已上传 1 件') >= 0, r.txt);

// ---- C 组：导出 ----
// 先走界面删掉一件默认商品（生成 del 墓碑记录）：导出必须把它排除（否则导入方默认商品被误删）。
// 注意必须经界面/store 写，直接写 localStorage 会被 xyStore 的内存缓存盖掉（本脚本最早就是这么假绿的）
await clickBtn('market-manage');
await evalJs("(function(){var d=document.querySelector('#market-grid .gift-item-del[data-del=\"g_rose\"]');if(d)d.click();return true;})()");
await sleep(350);
await clickOk();
await clickBtn('market-manage');
r = await js("(function(){var a=JSON.parse(window.xyStore('xy-home-v2').get('market-custom')||'[]');return JSON.stringify({tomb:a.some(function(c){return c.id==='g_rose'&&c.del}),n:a.length});})()");
ok('C0 默认商品墓碑记录已生成（经界面删除）', r.tomb === true, JSON.stringify(r));
await evalJs("window.mochiExportFile=function(j,n,t){window.__mcdCap={json:j,fname:n,title:t};return Promise.resolve('ok');};window.__mcdCap=null;");
await clickBtn('market-mine-export');
ok('C1 导出弹窗出现', await modalOpen() === true, '');
let txt = await modalText();
ok('C2 弹窗说明不含默认商品/心意币', txt.indexOf('只有你上传的商品') >= 0 && txt.indexOf('心意币') >= 0, txt.slice(0, 60));
await clickOk();
let cap = await js("(function(){return JSON.stringify(window.__mcdCap||null);})()");
ok('C3 导出文件被交付（mochiExportFile）', !!cap && typeof cap.json === 'string', cap ? cap.fname : 'null');
let pack = {};
try { pack = JSON.parse((cap && cap.json) || '{}'); } catch (e) {}
let gc = (pack.goods || []);
ok('C4 文件头字段正确', pack.app === 'mochi-market-goods' && pack.kind === 'market-goods', JSON.stringify({ app: pack.app, kind: pack.kind }));
ok('C5 只装自定义商品（del/base 不进包）', gc.length === 1 && gc[0].name === '我的手工饼干', JSON.stringify(gc.map((x) => x.name)));
ok('C6 文件名带日期前缀', /^mochi心意商品_\d{4}-\d{2}-\d{2}\.json$/.test((cap && cap.fname) || ''), cap ? cap.fname : 'null');

// ---- D 组：导入（合并） ----
await clickBtn('market-mine-import');
r = await js("(function(){var i=document.getElementById('market-goods-import-pick');return JSON.stringify({has:!!i,accept:i?i.accept:''});})()");
ok('D1 导入走统一 pickup（input 常驻 + accept 正确）', r.has === true && r.accept === '.json,application/json', JSON.stringify(r));
let feed = await feedImportFile(PACK1, 'pack1.json');
await sleep(500);
ok('D2 灌文件成功', feed === 'ok', String(feed));
ok('D3 导入弹窗出现', await modalOpen() === true, '');
txt = await modalText();
ok('D4 弹窗如实报数（新增/跳过/坏件）', txt.indexOf('新增 2 件') >= 0 && txt.indexOf('跳过已存在的 1 件') >= 0 && txt.indexOf('格式不对') >= 0, txt.replace(/\n/g, ' | ').slice(0, 120));
await clickOk();
arr = await customArr(); mine = mineOf(arr);
const byName = {};
mine.forEach((c) => { byName[c.name] = (byName[c.name] || 0) + 1; });
ok('D5 新增进库（内嵌图保留）', byName['纸折星星'] === 1 && (mine.find((c) => c.name === '纸折星星') || {}).img === 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', JSON.stringify(mine.map((c) => c.name)));
ok('D6 同内容异 id 不翻倍（跳过）', byName['我的手工饼干'] === 1, JSON.stringify(byName));
ok('D7 缺名字的坏件没进库', !byName[''] && mine.length === 3, 'mine=' + mine.length);
ok('D8 外链图丢弃、条目保留', byName['外链礼物'] === 1 && (mine.find((c) => c.name === '外链礼物') || {}).img === '', JSON.stringify((mine.find((c) => c.name === '外链礼物') || {}).img));
ok('D9 文件里的 id 原样保留', !!mine.find((c) => c.id === 'g_custom_pack_a'), JSON.stringify(mine.map((c) => c.id)));
ok('D10 默认商品墓碑记录不受影响', arr.some((c) => c.id === 'g_rose' && c.del), '');
// 幂等：同一文件再导一次
await clickBtn('market-mine-import');
feed = await feedImportFile(PACK1, 'pack1.json');
await sleep(500);
const again = await modalOpen();
let toastTxt = await evalJs("(function(){var t=document.getElementById('cc-toast');return t?t.textContent:'';})() || ''");
ok('D11 重复导入不弹确认、直接提示已存在', again === false && toastTxt.indexOf('没有新增') >= 0, 'modal=' + again + ' toast=' + toastTxt);
ok('D12 重复导入件数不变', mineOf(await customArr()).length === 3, 'n=' + mineOf(await customArr()).length);

// ---- E 组：同 id 更新 / 撞号重新发号 / 换库模式 ----
await clickBtn('market-mine-import');
await feedImportFile(PACK2, 'pack2.json');
await sleep(500);
ok('E1 合并导入第二份', await modalOpen() === true, '');
await clickOk();
ok('E2 合并后共 4 件', mineOf(await customArr()).length === 4, 'n=' + mineOf(await customArr()).length);
// 同 id 不同名字＝别人导出的包撞了号：当新商品发新号（两条都在），绝不覆盖已有那件
await clickBtn('market-mine-import');
await feedImportFile(PACK3, 'pack3.json');
await sleep(500);
await clickOk();
arr = await customArr(); mine = mineOf(arr);
const same = mine.filter((c) => c.id === 'g_custom_pack_e');
const collide = mine.find((c) => c.name === '撞名礼物') || {};
ok('E3 id 撞号 → 发新号不覆盖（两条都在、id 不同）', mine.length === 5 && same.length === 1 && same[0].name === '换库礼物' && !!collide.id && collide.id !== 'g_custom_pack_e', JSON.stringify({ n: mine.length, same: same.length, newId: collide.id }));
// 同 id 同名字不同价格＝同一件商品的更新版：就地更新（不新增、不翻倍）
await clickBtn('market-mine-import');
await feedImportFile(PACK3B, 'pack3b.json');
await sleep(500);
ok('E4 同名同 id 走更新（弹窗报「更新 1 件」）', (await modalText()).indexOf('更新 1 件') >= 0, (await modalText()).split('\n')[0]);
await clickOk();
arr = await customArr(); mine = mineOf(arr);
const edited = mine.find((c) => c.id === 'g_custom_pack_e') || {};
ok('E5 就地更新价格、件数不变', mine.length === 5 && edited.price === 99, JSON.stringify({ n: mine.length, price: edited.price }));
// 换库模式：清空我的商品后只装文件里的（默认商品改动记录必须留下）
await clickBtn('market-mine-import');
await feedImportFile(PACK4, 'pack4.json');
await sleep(500);
ok('E6 换库弹窗出现', await modalOpen() === true, '');
await pickPill(1);
await clickOk();
arr = await customArr(); mine = mineOf(arr);
ok('E7 换库模式：只剩文件里的商品', mine.length === 1 && mine[0].name === '换库专属', JSON.stringify(mine.map((c) => c.name)));
ok('E8 换库不动默认商品墓碑记录', arr.some((c) => c.id === 'g_rose' && c.del), '');
r = await js("(function(){var e=document.getElementById('market-mine-cnt');return JSON.stringify({txt:e?e.textContent:''});})()");
ok('E9 换库后计数行同步', r.txt.indexOf('已上传 1 件') >= 0, r.txt);

// ---- Z 组：零异常 ----
const errs = await evalJs("(function(){try{return JSON.stringify(window.__jsErrors||[]);}catch(e){return '[]';}})()");
ok('Z1 页内无 JS 异常', errs === '[]' || errs === 'null', String(errs).slice(0, 200));
ok('Z2 CDP 无未捕获异常', logs.filter((l) => l.startsWith('EXC')).length === 0, logs.slice(0, 2).join(' | '));

console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

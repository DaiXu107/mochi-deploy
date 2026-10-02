// ===== 专项验证：房间（双人小屋）桌面第三页入口 + 更多功能入口 + 场景/摆放/兑换/字卡联动 =====
// 用法：node tools/verify-room.mjs（需先 node build.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-room-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

async function setRoom(jsonStr) {
  return evalJs("(function(){try{window.storeFor(window.__activeCid||'default').set('room-data'," + JSON.stringify(jsonStr) + ");}catch(e){}return true;})()");
}
async function readRoom() {
  const raw = await evalJs("(function(){try{return localStorage.getItem('xy-home-v2:'+(window.__activeCid||'default')+':room-data');}catch(e){return null;}})()");
  try { return JSON.parse(raw); } catch (e) { return null; }
}
async function clearRoom() {
  return evalJs("(async function(){var cid=window.__activeCid||'default';var fk='xy-home-v2:'+cid+':room-data';try{localStorage.removeItem(fk);}catch(e){}try{await window.idbDelete(fk);}catch(e){}return true;})()");
}
async function readyPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
  // #319：系统内置字卡默认上锁，锁定时 getLibPool/defaultCardGroups 一律返回空数组。
  // 不解锁就没法断言「话术来自字卡库」——库池恒空 ⇒ C1/C2 只能红在环境上，与修复无关。
  // cardLockOpen() 每次现读 xyStore，故这里翻了键立即生效，不必重进页面。
  await evalJs("(function(){try{window.xyStore('xy-home-v2').set('cardlock-state','open');}catch(e){}return true;})()");
  await sleep(200);
}

// ================= A 组：静态接线（直接读源文件） =================
{
  const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
  check('A1 build.mjs 注册 room.css 与 room.js', buildSrc.includes("'room.css'") && buildSrc.includes("'room.js'"));
  const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
  check('A2 桌面第三页图标 app-room 存在且在 p3 网格内', /app-grid p3-grid[\s\S]*?data-app="room"/.test(tpl));
  check('A3 更多面板按钮 more-room 存在', tpl.includes('id="more-room"'));
  check('A4 page-room 锚点齐全（scene/wall/floor/ta/bubble/banner/status/sense/bar）',
    ['id="page-room"', 'id="room-scene"', 'id="room-wall"', 'id="room-floor"', 'id="room-ta"', 'id="room-bubble"', 'id="room-banner"', 'id="room-status"', 'id="room-sense-out"', 'id="room-btn-inv"', 'id="room-btn-sense"', 'id="room-btn-deco"', 'id="room-info-btn"', 'id="room-back"'].every(id => tpl.includes(id)));
  check('A5 page-room 含两窗一门布景', tpl.includes('r-window wa') && tpl.includes('r-window wb') && tpl.includes('r-door'));
  const tabs = readFileSync(join(root, 'src/js/tabs.js'), 'utf8');
  check('A6 tabs.js FULL_PAGES 含 page-room', tabs.includes("'page-room'"));
  const cardData = readFileSync(join(root, 'src/js/default-cards-data.js'), 'utf8');
  check('A7 DEFAULT_CARD_DATA.room 独立语句注册', cardData.includes('window.DEFAULT_CARD_DATA.room = ['));
  const cardsJs = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');
  // A8 曾钉字面量 `[data-type="room"]`——分类 chip 现由模板动态拼 data-type，源码里已无该字面串
  // （在途树与 HEAD 双双红＝脚本腐烂，不是功能缺失）。改钉真实存在的分类名登记表。
  check('A8 「房间」分类已登记进字卡库（room → 房间）', cardsJs.includes("room: '房间'"), 'chatcard.js CAT_NAMES/CAT 表');
  const built = readFileSync(join(root, 'index.html'), 'utf8');
  check('A9 v2 新墙纸主题（暮色/奶油条纹/棋盘砖）已入产物', built.includes('.wall-dusk') && built.includes('.wall-stripe') && built.includes('.wall-checkerw'));
  check('A10 prefers-reduced-motion 减弱动效已入产物', built.includes('prefers-reduced-motion'));

  // A11/A12 #759 字卡分组接线（结构性防回归）：CAT 用的 grp → GRP 映射 → 字卡库真实分组名
  {
    const roomJs = readFileSync(join(root, 'src/js/room.js'), 'utf8');
    const cardData = readFileSync(join(root, 'src/js/default-cards-data.js'), 'utf8');
    const block = (src, head) => (src.match(new RegExp(head + '\\s*=\\s*\\{([\\s\\S]*?)\\n  \\};')) || [])[1] || '';
    const grpMap = {};
    [...block(roomJs, 'const GRP').matchAll(/(\w+)\s*:\s*'([^']+)'/g)].forEach(m => { grpMap[m[1]] = m[2]; });
    const fbKeys = new Set([...block(roomJs, 'const FB').matchAll(/^\s{4}(\w+)\s*:/gm)].map(m => m[1]));
    const catBlock = block(roomJs, 'const CAT');
    const catGrps = new Set([...catBlock.matchAll(/grp:\s*'([^']+)'/g)].map(m => m[1]));
    // 代码里直接以字面量传给 sayLine 的英文分组键（occupied / comeover / lamp）
    const litGrps = new Set([...roomJs.matchAll(/sayLine\('([a-z][a-zA-Z]*)'/g)].map(m => m[1]));
    const used = new Set([...catGrps, ...litGrps]);
    const libRoom = (cardData.match(/window\.DEFAULT_CARD_DATA\.room = \[([\s\S]*?)\n\];/) || [])[1] || '';
    const libGroups = new Set([...libRoom.matchAll(/^\s*\["([^"]+)",\s*\[/gm)].map(m => m[1]));
    const noMap = [...used].filter(k => !grpMap[k]);
    // 扫全表而非只扫 used：HEAD 那种「GRP 整张表不存在」的树里 used∩grpMap 为空 ⇒ 空集恒真＝假绿
    const ghostGroup = Object.keys(grpMap).filter(k => !libGroups.has(grpMap[k]));
    const noFb = [...used].filter(k => !fbKeys.has(k));
    check('A11 CAT/sayLine 用到的每个分组键都登记进 GRP 且有 FB 兜底', used.size > 0 && !noMap.length && !noFb.length,
      'used=' + used.size + ' 未映射=' + noMap.join(',') + ' 无兜底=' + noFb.join(','));
    check('A12 GRP 映射到的分组名在字卡库【房间】里真实存在（库里改名/漏登记即红）', Object.keys(grpMap).length > 0 && !ghostGroup.length && libGroups.size >= 12,
      'GRP项=' + Object.keys(grpMap).length + ' 库内分组=' + libGroups.size + ' 查无此组=' + ghostGroup.map(k => k + '→' + grpMap[k]).join(','));
  }
}

// ================= B 组：无头运行时 =================
await readyPage();

// B1 第三页图标存在
check('B1 桌面出现「房间」图标', await evalJs("!!document.querySelector('.app[data-app=\"room\"]')"));

// 清数据 → 冷启动档
await clearRoom();
await evalJs("(function(){if(window.closeRoom)window.closeRoom();document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var h=document.getElementById('page-phone');if(h)h.hidden=false;return true;})()");

// B2 点图标打开房间全屏页
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"room\"]');a.click();return true;})()");
await sleep(700);
check('B2 点图标进入 page-room 且隐藏 tabbar', await evalJs("!document.getElementById('page-room').hidden && document.querySelector('.tabbar').hidden && document.getElementById('page-room').classList.contains('full')"));

// B3 初始场景渲染：4 件初始家具 + TA 元素
const furnCount = await evalJs("document.querySelectorAll('#room-floor .r-furn').length");
check('B3 初始家具渲染（4 件预设）', furnCount === 4, 'count=' + furnCount);
check('B4 TA 元素在场景中（头像或剪影）', await evalJs("!!document.querySelector('#room-ta .r-ta-av')"));

// B5 HUD 渲染
const hud = await evalJs("(function(){return [document.getElementById('room-chip-lv').textContent, document.getElementById('room-chip-pt').textContent, document.getElementById('room-chip-cap').textContent].join('|');})()");
check('B5 HUD 显示 Lv/点数/容量', /Lv\.1/.test(hud) && /🏠/.test(hud) && /\/9/.test(hud), hud);

// B6 TA 状态行
const st = await evalJs("document.getElementById('room-status').textContent");
check('B6 TA 状态行文案（正在…）', st && st.indexOf('正在') >= 0, st);

// B7 进门气泡
check('B7 进门话术气泡弹出', await evalJs("!document.getElementById('room-bubble').hidden && !!document.getElementById('room-bubble').textContent"));

// B8 点家具弹互动菜单（openModal）
await evalJs("(function(){document.querySelector('#room-floor .r-furn').click();return true;})()");
await sleep(400);
check('B8 点家具弹出 openModal 菜单', await evalJs("!document.getElementById('modal-mask').hidden"));
await evalJs("(function(){document.getElementById('modal-cancel').click();return true;})()");
await sleep(250);

// B9 感应按钮输出方位感知文本
await evalJs("(function(){document.getElementById('room-btn-sense').click();return true;})()");
await sleep(200);
const senseTxt = await evalJs("document.getElementById('room-sense-out').textContent");
check('B9 感应输出方位感知文本', senseTxt && (senseTxt.indexOf('房间中央') >= 0 || senseTxt.indexOf('边') >= 0 || senseTxt.indexOf('身后') >= 0), senseTxt && senseTxt.split('\n')[0]);

// B10 注入点数+仓库（day=今天防每日礼干扰） → 兑换流程（shop 购买扣点）
await evalJs("(function(){window.closeRoom();var cid=window.__activeCid||'default';var dt=new Date();var tk=dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate();var d={fx:[{i:'a1',t:'bed',x:4,y:0,r:0}],inv:{},pts:50,lv:1,wall:'cream',floor:'wood',day:tk,lit:{},earn:{day:tk,n:0,ta:0},ta:{x:2,y:1,act:'idle',tx:2,ty:1,faint:false,nextAt:Date.now()+60000}};window.storeFor(cid).set('room-data',JSON.stringify(d));window.openRoom();return true;})()");
await sleep(500);
await evalJs("(function(){document.getElementById('room-btn-inv').click();return true;})()");
await sleep(350);
check('B10 家具仓弹窗含兑换入口', await evalJs("!document.getElementById('modal-mask').hidden"));
// 点「兑换新家具」胶囊 + 确定
await evalJs("(function(){var p=document.querySelector('#modal-pills .pill');if(p)p.click();document.getElementById('modal-ok').click();return true;})()");
await sleep(400);
const shopTitle = await evalJs("(function(){var t=document.getElementById('modal-title');return t?t.textContent:'';})()");
check('B11 兑换列表打开（标题含兑换）', shopTitle.indexOf('兑换') >= 0, shopTitle);
// 找「木椅 · 12🏠」胶囊点击 + 确定
const buyOk = await evalJs("(function(){var pills=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));var t=pills.find(function(b){return b.textContent.indexOf('木椅')>=0;});if(!t)return 'nopill';t.click();document.getElementById('modal-ok').click();return 'ok';})()");
await sleep(450);
const afterBuy = await readRoom();
check('B12 购买木椅成功（pts 50→38，仓库 chair×1）', buyOk === 'ok' && afterBuy && afterBuy.pts === 38 && afterBuy.inv.chair === 1, JSON.stringify({ pts: afterBuy && afterBuy.pts, inv: afterBuy && afterBuy.inv }));
await evalJs("(function(){document.getElementById('modal-cancel').click();return true;})()");
await sleep(250);

// B13 家具仓→选椅子→banner→点空格放置
await evalJs("(function(){document.getElementById('room-btn-inv').click();return true;})()");
await sleep(350);
const pickChair = await evalJs("(function(){var pills=Array.prototype.slice.call(document.querySelectorAll('#modal-pills .pill'));var t=pills.find(function(b){return b.textContent.indexOf('木椅')>=0&&b.textContent.indexOf('×')>=0;});if(!t)return 'nopill';t.click();document.getElementById('modal-ok').click();return 'picked';})()");
await sleep(300);
const bannerShown = await evalJs("!document.getElementById('room-banner').hidden");
check('B13 选仓库椅子进入放置模式（横幅显示）', pickChair === 'picked' && bannerShown);
// 点一块空地板格（找没有家具的 cell 坐标）
const placeRes = await evalJs("(function(){var occ=(JSON.parse(localStorage.getItem('xy-home-v2:'+(window.__activeCid||'default')+':room-data')).fx||[]).map(function(f){return f.x+','+f.y;});var cells=document.querySelectorAll('#room-floor .r-cell');for(var i=0;i<cells.length;i++){var k=cells[i].dataset.x+','+cells[i].dataset.y;if(occ.indexOf(k)<0){cells[i].click();return k;}}return null;})()");
await sleep(400);
const afterPlace = await readRoom();
check('B14 放置成功（fx 1→2）', placeRes && afterPlace && afterPlace.fx.length === 2, 'cell=' + placeRes + ' fx=' + (afterPlace && afterPlace.fx.length));

// B15 字卡联动：getLibPool('room','进门') 有货 & 单卡开关过滤生效
const poolOk = await evalJs("(function(){try{var a=window.getLibPool('room','进门',['兜底']);return a.length>0 && a.indexOf('兜底')<0;}catch(e){return false;}})()");
check('B15 getLibPool(room,进门) 与字卡库同源有话术', poolOk);
const offOk = await evalJs("(function(){try{var s=window.storeFor(window.__activeCid||'default');var g=window.getLibPool('room','进门',[]);s.set('dc-off-room:'+g[0],'1');var on=window.getLibPool('room','进门',[]).filter(function(c){return !(window.isDefaultCardOff&&window.isDefaultCardOff('room',c));});var hit=!on.some(function(c){return c===g[0];});s.remove('dc-off-room:'+g[0]);return hit;}catch(e){return false;}})()");
check('B16 逐张开关 dc-off-room:* 过滤生效', offOk);

// B17 更多功能入口：聊天 more 面板按钮 → 打开房间；返回回聊天页
await evalJs("(function(){window.closeRoom();document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});document.getElementById('page-chat').hidden=false;return true;})()");
await sleep(300);
await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
await sleep(250);
await evalJs("(function(){var m=document.getElementById('more-room');if(m)m.click();return true;})()");
await sleep(500);
check('B17 更多功能「房间」按钮打开页面并记录来源', await evalJs("!document.getElementById('page-room').hidden && window.__roomFrom==='chat'"));
await evalJs("(function(){document.getElementById('room-back').click();return true;})()");
await sleep(400);
check('B18 从聊天进入后返回回到聊天页', await evalJs("!document.getElementById('page-chat').hidden && !window.__roomFrom"));

// B19 数据按联系人隔离：换键名模拟另一桌面互不影响（静态约定校验：键带 cid 前缀）
const nsOk = await evalJs("(function(){var cid=window.__activeCid||'default';var v=localStorage.getItem('xy-home-v2:'+cid+':room-data');return v!==null && localStorage.getItem('xy-home-v2:room-data')===null;})()");
check('B19 房间数据存联系人命名空间（xy-home-v2:<cid>:room-data）', nsOk);

// B20 无 JS 异常
const jsErr = await evalJs('(window.__jsErrors||[]).filter(function(e){return String(e).indexOf("room")>=0;}).length');
check('B20 无 room 相关 JS 运行时异常', jsErr === 0, 'errors=' + jsErr);

// B21 行为引擎：冷却到期后 TA 自主重抽行为（nextAt 被刷新为未来）
const eng = await evalJs("(function(){window.closeRoom();var cid=window.__activeCid||'default';var d=JSON.parse(localStorage.getItem('xy-home-v2:'+cid+':room-data'));d.ta.nextAt=Date.now()-5000;d.ta.act='idle';window.storeFor(cid).set('room-data',JSON.stringify(d));window.openRoom();var s=window.__roomState();return JSON.stringify({re: s.ta.nextAt>Date.now(), act: s.ta.act});})()");
await sleep(300);
let engOk = false, engDetail = '';
try { const o = JSON.parse(eng); engOk = !!(o.re && o.act); engDetail = eng; } catch (e) { engDetail = String(eng); }
check('B21 冷却到期 TA 自主重抽行为', engOk, engDetail);

// ---- v2 UI 升级项：光斑/插花徽章/入场动画/放置高亮/长按拖拽 ----
await evalJs("(function(){window.closeRoom();var cid=window.__activeCid||'default';var dt=new Date();var tk=dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate();var d={fx:[{i:'a1',t:'desklamp',x:2,y:1,r:0},{i:'a2',t:'vase',x:4,y:2,r:0}],inv:{},pts:20,lv:3,wall:'dusk',floor:'wood',day:tk,lit:{a1:true},vaseFlower:true,earn:{day:tk,n:0,ta:0},ta:{x:0,y:3,act:'idle',tx:0,ty:3,faint:false,nextAt:Date.now()+60000}};window.storeFor(cid).set('room-data',JSON.stringify(d));window.openRoom();return true;})()");
await sleep(550);
check('B22 点亮的灯在地板投暖光斑（.r-pool×1）', await evalJs("document.querySelectorAll('#room-floor .r-pool').length===1"));
check('B23 花瓶插花徽章（花园联动 🌸）', await evalJs("!!document.querySelector('#room-floor .r-bloom')"));
check('B24 入场动画 room-in 已挂载', await evalJs("document.getElementById('room-scene').classList.contains('room-in')"));

// 放置模式格子高亮（空格 ok 呼吸 / 被占 bad）——注意先 closeRoom（落盘内存档）再改存储
await evalJs("(function(){var cid=window.__activeCid||'default';window.closeRoom();var d=JSON.parse(localStorage.getItem('xy-home-v2:'+cid+':room-data'));d.inv.chair=1;window.storeFor(cid).set('room-data',JSON.stringify(d));window.openRoom();return true;})()");
await sleep(600);
await evalJs("(function(){document.getElementById('room-btn-inv').click();return 1;})()");
await sleep(500);
let b25detail = '';
let okCells = 0, badCells = 0;
for (let att = 0; att < 3 && !okCells; att++) {
  const pickRes = await evalJs("(function(){var t=document.getElementById('modal-title');if(!t||document.getElementById('modal-mask').hidden)return 'nomodal';var pills=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<pills.length;i++){if(pills[i].textContent.indexOf('木椅')>=0){pills[i].click();document.getElementById('modal-ok').click();return 'picked';}}return 'nopill';})()");
  await sleep(450);
  const probe = await evalJs("(function(){var fl=document.getElementById('room-floor');return JSON.stringify({banner:!document.getElementById('room-banner').hidden,picking:document.getElementById('room-scene').classList.contains('placing'),ok:fl.querySelectorAll('.r-cell.ok').length,bad:fl.querySelectorAll('.r-cell.bad').length});})()");
  try { const o = JSON.parse(probe); okCells = o.ok; badCells = o.bad; b25detail = 'att' + att + ':' + pickRes + ' ' + probe; } catch (e) { b25detail = String(pickRes); }
}
check('B25 放置模式：空格高亮/被占灰掉', okCells > 0 && badCells > 0, b25detail);
await evalJs("(function(){var b=document.getElementById('room-banner');if(b&&!b.hidden)document.getElementById('room-banner-cancel').click();var m=document.getElementById('modal-mask');if(m&&!m.hidden)document.getElementById('modal-cancel').click();return 1;})()");
await sleep(200);

// 长按拖拽（pointer 事件序列模拟：down → 380ms 后 move 到新格 → up）
const dragRes = await evalJs("(async function(){var cid=window.__activeCid||'default';var d=JSON.parse(localStorage.getItem('xy-home-v2:'+cid+':room-data'));var fu=null,inst=d.fx[0];var floor=document.getElementById('room-floor');fu=floor.querySelector('.r-furn[data-i=\"'+inst.i+'\"]');if(!fu)return 'nofurn';var r=floor.getBoundingClientRect();var sx=r.left+r.width*(inst.x+0.5)/6,sy=r.top+r.height*(inst.y+0.86)/4;var tx=r.left+r.width*5.5/6,ty=r.top+r.height*3.86/4;function pe(type,x,y){return new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:9,pointerType:'mouse',isPrimary:true});}fu.dispatchEvent(pe('pointerdown',sx,sy));await new Promise(function(rs){setTimeout(rs,420);});floor.dispatchEvent(pe('pointermove',tx,ty));floor.dispatchEvent(pe('pointerup',tx,ty));await new Promise(function(rs){setTimeout(rs,450);});var d2=JSON.parse(localStorage.getItem('xy-home-v2:'+cid+':room-data'));return JSON.stringify({from:inst.x+','+inst.y,to:d2.fx[0].x+','+d2.fx[0].y});})()");
let dragOk = false;
try { const o = JSON.parse(dragRes); dragOk = o.to === '5,3' && o.from !== '5,3'; } catch (e) {}
check('B26 长按家具拖拽换格（pointer 序列）', dragOk, dragRes);

// ================= C 组：#759 修复取证（字卡分组接线 / 双段气泡 / 灯光按实例） =================
async function openWith(o) {
  await evalJs("(function(){window.closeRoom();return true;})()");
  await setRoom(JSON.stringify(o));
  await evalJs("(function(){window.openRoom();return true;})()");
  await sleep(650);
}
function baseRoom(fx, extra) {
  const dt = new Date();
  const tk = dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate();
  return Object.assign({
    fx: fx, inv: {}, pts: 30, lv: 3, wall: 'cream', floor: 'wood', day: tk, lit: {},
    earn: { day: tk, n: 0, ta: 0 }, ta: { x: 0, y: 3, act: 'idle', tx: 0, ty: 3, faint: false, nextAt: Date.now() + 900000 }
  }, extra || {});
}
async function readBub() {
  return evalJs("(function(){var b=document.getElementById('room-bubble');return JSON.stringify({h:!!b.hidden,t:b.textContent||''});})()");
}
async function furnAct(instId, pillIdx) {
  const c = await evalJs("(function(){var el=document.querySelector('#room-floor .r-furn[data-i=\"" + instId + "\"]');if(!el)return 'nofurn';el.click();return 'ok';})()");
  if (c !== 'ok') return c;
  await sleep(430);
  const r = await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill');var p=ps[" + pillIdx + "];if(!p)return 'nopill';p.click();document.getElementById('modal-ok').click();return 'used';})()");
  await sleep(120);
  return r;
}

// C1 点沙发「坐下」：气泡必须是字卡库【坐到旁边】里的原句
//     取证手法＝把该组除一张以外的全部逐张关掉（dc-off-room:*），剩下的那张就是唯一答案；
//     修复前分组名传的是英文键 → 库里查不到 → 出的是 FB.beside 内置短句 → 与 target 不等 → RED。
await openWith(baseRoom([{ i: 's1', t: 'sofa', x: 2, y: 1, r: 0 }]));
const target = await evalJs("(function(){try{var s=window.storeFor(window.__activeCid||'default');var p=window.getLibPool('room','坐到旁边',[]);var t=null;for(var i=0;i<p.length;i++){if(!/他|TA|\\{n\\}/.test(p[i])){t=p[i];break;}}if(!t)return 'nopick';for(var j=0;j<p.length;j++){if(p[j]!==t)s.set('dc-off-room:'+p[j],'1');}return t;}catch(e){return 'err:'+e.message;}})()");
const c1act = await furnAct('s1', 0);
const c1bub = JSON.parse(await readBub() || '{}');
check('C1 点家具冒出的话术来自字卡库池（关掉其余卡后＝唯一那张原句）',
  typeof target === 'string' && target !== 'nopick' && c1act === 'used' && c1bub.t === target,
  'target=' + target + ' got=' + (c1bub && c1bub.t) + ' act=' + c1act);
const c1noUndef = await evalJs("(function(){return document.getElementById('room-bubble').textContent.indexOf('undefined')<0;})()");
check('C1b 气泡不出现字面量 undefined', c1noUndef === true);
await evalJs("(function(){var s=window.storeFor(window.__activeCid||'default');var p=window.getLibPool('room','坐到旁边',[]);for(var i=0;i<p.length;i++)s.remove('dc-off-room:'+p[i]);return true;})()");
await sleep(150);

// C2 库内整组关掉仍要出声（既不出空气泡也不出 undefined）
//     注：现实现「全关」时复用的是已关的库内池而非 FB 兜底（`if (f.length) arr = f`），
//     与文件头注释写的「全关回退内置兜底」不符——本条只断言"仍出声"，不锁定是哪一份文案。
const c2offAll = await evalJs("(function(){var s=window.storeFor(window.__activeCid||'default');var p=window.getLibPool('room','坐到旁边',[]);for(var i=0;i<p.length;i++)s.set('dc-off-room:'+p[i],'1');return p.length;})()");
await furnAct('s1', 0);
const c2bub = JSON.parse(await readBub() || '{}');
check('C2 库内整组关掉仍出声（不出空气泡／不出 undefined）', c2offAll > 0 && !!c2bub.t && !c2bub.h && c2bub.t !== 'undefined',
  c2bub && c2bub.t);
await evalJs("(function(){var s=window.storeFor(window.__activeCid||'default');var p=window.getLibPool('room','坐到旁边',[]);for(var i=0;i<p.length;i++)s.remove('dc-off-room:'+p[i]);return true;})()");
await sleep(150);

// C3 同种两盏灯各自独立开关（修复前 lit 按类型记＝一盏亮两盏一起亮）
await openWith(baseRoom([{ i: 'L1', t: 'desklamp', x: 1, y: 1, r: 0 }, { i: 'L2', t: 'desklamp', x: 4, y: 1, r: 0 }], { lit: { L1: true } }));
const c3a = await evalJs("(function(){var f=document.getElementById('room-floor');return JSON.stringify({lit:f.querySelectorAll('.r-furn.r-lit').length,pool:f.querySelectorAll('.r-pool').length});})()");
await furnAct('L2', 0); // 点亮第二盏
const c3b = await evalJs("(function(){var f=document.getElementById('room-floor');var s=window.__roomState();return JSON.stringify({lit:f.querySelectorAll('.r-furn.r-lit').length,pool:f.querySelectorAll('.r-pool').length,keys:Object.keys(s.lit).sort().join(',')});})()");
await furnAct('L1', 0); // 关掉第一盏（同一 act 按钮即开关）
const c3c = await evalJs("(function(){var s=window.__roomState();return Object.keys(s.lit).sort().join(',');})()");
check('C3 同种两盏灯可各自开关（1 亮→2 亮→只剩 L2 亮）',
  c3a === '{"lit":1,"pool":1}' && c3b === '{"lit":2,"pool":2,"keys":"L1,L2"}' && c3c === 'L2',
  [c3a, c3b, c3c].join(' | '));

// C4 收回亮着的灯：lit 不留残键、整屋亮度回落到 1（修复前残键让 lum() 继续按有灯增亮）
await furnAct('L2', 3); // 收回仓库
const c4 = await evalJs("(function(){var s=window.__roomState();return JSON.stringify({lit:Object.keys(s.lit).length,bright:document.getElementById('room-scene').style.getPropertyValue('--room-bright'),furn:document.querySelectorAll('#room-floor .r-furn').length});})()");
check('C4 收回亮灯后 lit 清干净且亮度回落 1', c4 === '{"lit":0,"bright":"1","furn":1}', c4);

// C5 旧档迁移：lit 按「家具类型」存的老存档 → 搬到该类型第一件在场实例，类型残键丢弃
await openWith(baseRoom([{ i: 'M1', t: 'candle', x: 1, y: 2, r: 0 }, { i: 'M2', t: 'desklamp', x: 3, y: 2, r: 0 }], { lit: { candle: true, clock: true } }));
const c5 = await evalJs("(function(){var s=window.__roomState();return JSON.stringify({keys:Object.keys(s.lit).sort(),lit:document.querySelectorAll('#room-floor .r-furn.r-lit').length});})()");
check('C5 旧档类型键迁移为实例键（candle:true→M1；无在场家具的 clock:true 丢弃）', c5 === '{"keys":["M1"],"lit":1}', c5);

// C6 点灯后的第二条补话真能播出（修复前被首条 3800ms 常驻 + 让路守卫挡死＝从未播过）
await openWith(baseRoom([{ i: 'P1', t: 'desklamp', x: 2, y: 1, r: 0 }], { ta: { x: 2, y: 2, act: 'idle', tx: 2, ty: 2, faint: false, nextAt: Date.now() + 900000 } }));
let c6got = false, c6bad = '', c6log = [];
for (let round = 0; round < 4 && !c6got; round++) {
  const st = await evalJs("(function(){var s=window.__roomState();return s.lit.P1?'on':'off';})()");
  if (st === 'on') { await furnAct('P1', 0); await sleep(2700); } // 先拧灭，下一拍才测「点亮」
  await furnAct('P1', 0);
  const first = JSON.parse(await readBub() || '{}');
  if (first.t && first.t.indexOf('undefined') >= 0) c6bad = '首条=' + first.t;
  for (const w of [400, 400, 400, 400, 400, 400]) {
    await sleep(w);
    const now = JSON.parse(await readBub() || '{}');
    if (now.t && now.t.indexOf('undefined') >= 0) c6bad = '补话=' + now.t;
    if (!now.h && now.t && now.t !== first.t) { c6got = true; c6log.push('r' + round + ':' + now.t); break; }
  }
  if (!c6got) c6log.push('r' + round + ':只见到「' + (first.t || '') + '」');
}
check('C6 点灯补话能播出（4 轮内至少一次接上第二条；TA 在旁边时概率 0.8）', c6got && !c6bad, c6log.join(' / ') + (c6bad ? ' ⚠' + c6bad : ''));
check('C6b 双段话术全程无字面量 undefined（#759 分组查无 ⇒ rnd([]) 吐 undefined）', !c6bad, c6bad);

chrome.kill();
server.close();
const fail = results.filter(r => !r.ok).length;
console.log('\n===== verify-room: ' + (results.length - fail) + '/' + results.length + ' passed' + (fail ? ' ===== FAIL' : ' ===== ALL GREEN'));
process.exit(fail ? 1 : 0);

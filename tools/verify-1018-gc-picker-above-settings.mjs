// ===== #1018 验证脚本：群聊浮层必须浮在「群聊设置」整页面板之上 =====
// 用法：SERVE_DIR=<构建产物目录> node tools/verify-1018-gc-picker-above-settings.mjs
// 背景（用户实报「聊里的默认群聊无法删除和管理里面的成员」＋「无法新建群聊，功能失效」）：
//   .gc-members-panel 这一族浮层（群成员列表 / 群聊列表 / 头像昵称互动 / 成员选择器）里有三条
//   入口开在「群聊设置」整页面板**内部**：群聊 tag 的「新建群聊」行、成员 tag 的「＋ 添加成员」、
//   形象 tag 的「头像互动 / 昵称互动」（#794 把这几个入口搬进设置面板的 tag 里，用的还是
//   fillGroupsList / fillMembersList 这同源渲染）。
//   而设置面板 z-index 210 > 本组 200，两者又同在 #page-group-chat 这个 .page（z-index:2，
//   自成层叠上下文）里 ⇒ 本组被整块盖住：群名弹窗照常弹出（.modal-mask 是 .page 的兄弟、
//   不参与这里的比较），点「确定」后成员选择器渲染在面板背后＝用户看到「点了没反应、什么都没
//   发生」——设置面板里的建群路是死的，添加成员 / 头像互动同样点不开。
//   （并行批 #1016 在三点菜单补了一条并列的「新建群聊」，那条路走的是「设置面板未打开」的
//     场景，因此它之后**设置面板内的这三条路仍然是死的**——本脚本量的正是这三条。）
// 判据：
//   S* 静态——浮层族 z-index 与设置面板 z-index 的**相对**关系（不是写死数值，任一方被改层级都红）；
//            四个浮层节点都在浮层族里；三条入口的接线仍在。
//   R* 运行时——无头 Chrome 真实触摸 + elementFromPoint 命中测试：选择器/半框打开那一帧
//            「点它落到的确实是自己」，而不是被设置面板盖住（这正是缺陷态的可观测形状）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const serveDir = normalize(process.env.SERVE_DIR || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 静态：从 CSS 文本取某个选择器的 z-index ----
function zIndexOf(css, sel) {
  const i = css.indexOf(sel);
  if (i < 0) return null;
  const body = css.slice(i, css.indexOf('}', i));
  const m = body.match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
const srcCss = readFileSync(join(root, 'src/css/group-chat.css'), 'utf8');
let prodCss = '';
try { prodCss = readFileSync(join(serveDir, 'index.html'), 'utf8'); } catch (e) {}
const srcTmpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const srcJs = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');

const floatSrc = zIndexOf(srcCss, '.gc-members-panel {');
const panelSrc = zIndexOf(srcCss, '.gc-settings-panel {');
check('S1a src 能读到两个层级（浮层族 / 设置面板）', floatSrc !== null && panelSrc !== null, 'float=' + floatSrc + ' panel=' + panelSrc);
check('S1b src：浮层族恒在设置面板之上（改回 200 / 抬设置面板都会红）',
  floatSrc !== null && panelSrc !== null && floatSrc > panelSrc, 'float=' + floatSrc + ' panel=' + panelSrc);

const floatProd = zIndexOf(prodCss, '.gc-members-panel {');
const panelProd = zIndexOf(prodCss, '.gc-settings-panel {');
check('S2 产物（index.html）里同样是「浮层族 > 设置面板」',
  floatProd !== null && panelProd !== null && floatProd > panelProd, 'float=' + floatProd + ' panel=' + panelProd);

// 四个浮层节点必须都在浮层族里——只给成员选择器单独提层级，其余三个（群成员/群聊列表/互动）照样是死的
const floats = ['gc-members-panel', 'gc-groups-panel', 'gc-inter-panel', 'gc-gpick-panel'];
const allInFamily = floats.every((id) => new RegExp('class="gc-members-panel"[^>]*id="' + id + '"|id="' + id + '"[^>]*class="gc-members-panel"').test(srcTmpl));
check('S3 四个浮层节点同属 .gc-members-panel 族（单点提层级才覆盖全族）', allInFamily,
  floats.filter((id) => srcTmpl.indexOf('id="' + id + '"') < 0).join(',') || 'all-present');

// 三个入口的接线仍在（入口被摘掉＝浮层没机会打开，本批修复语义也就没了）
check('S4a 「新建群聊」行仍在列表面板内渲染且点了就走 startCreateGroup',
  srcJs.includes("newRow.addEventListener('click', startCreateGroup);"));
check('S4b 群名确认后进成员选择器（名字带过去）',
  srcJs.includes("openMemberPicker('create', name);"));
check('S4c 「添加成员」仍走同一个选择器（add 模式）',
  srcJs.includes("openMemberPicker('add')"));
check('S4d 设置面板「群聊 / 成员」两段的同源内嵌渲染仍在（面板内那几条入口走的就是这份渲染）',
  srcJs.includes("const emb = document.querySelector('#gc-set-body .gc-set-groups-list');")
  && srcJs.includes("const emb = document.querySelector('#gc-set-body .gc-set-members-list');"));

// 等一个元素布局稳定（矩形非零且连续两次位置一致）再判——三点菜单展开是带过渡的，紧接着取
// elementFromPoint 会偶发落在展开中途的位置上（实测同一坐标时而命中 SPAN、时而命中别的东西）
async function waitStable(sel, tries = 12) {
  let prev = '';
  for (let i = 0; i < tries; i++) {
    const r = await evalJs("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return '';var b=e.getBoundingClientRect();if(!b.width||!b.height)return '';return Math.round(b.left)+','+Math.round(b.top)+','+Math.round(b.width);})()");
    if (r && r === prev) return true;
    prev = r || '';
    await sleep(120);
  }
  return !!prev;
}

// ---- 运行时：无头 Chrome ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(serveDir, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(serveDir)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const chromePath = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean)
  .find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const cdpPort = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1018-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 80; i++) {
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
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EVAL-ERR ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 200);
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = async (expr) => { try { return JSON.parse((await evalJs('(' + expr + ')')) || 'null'); } catch (e) { return null; } };

// 命中测试：选择器元素是否真的「在最上面」（点它落到的确实是自己）
async function hit(sel) {
  const raw = await evalJs("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return JSON.stringify({miss:true});" +
    "var b=e.getBoundingClientRect();if(!b.width||!b.height)return JSON.stringify({miss:true,zero:true});" +
    "var cx=Math.round(b.left+b.width/2),cy=Math.round(b.top+b.height/2);var t=document.elementFromPoint(cx,cy);" +
    "var top=t?(t.tagName+(t.id?'#'+t.id:'')+(t.className&&typeof t.className==='string'?'.'+String(t.className).trim().split(/\\s+/)[0]:'')):'';" +
    "return JSON.stringify({miss:false,x:cx,y:cy,self:!!(t&&(t===e||e.contains(t))),top:top});})()");
  try { return JSON.parse(raw || 'null') || { miss: true }; } catch (e) { return { miss: true, raw: String(raw).slice(0, 120) }; }
}
// 合成 click + 命中测试：判定「这一格在最上层吗」用 elementFromPoint（本批的判据面），
// 触发用确定性 click。headless 下 dispatchTouchEvent → click 的合成在长链路里会偶发不落地
//（实测：同一坐标时而生效时而落空），而本批的缺陷是**绘制层序**、不是事件通道——
// 真正需要「手指亲自按」的证据只留 R10（勾选成员）一处。
async function clickSel(sel) {
  const h = await hit(sel);
  if (!h.miss) {
    await evalJs("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");if(e)e.click();return 1;})()");
    await sleep(420);
  }
  return h;
}
// 与其余群聊验证脚本同款：开屏未收起时 .phone 是 visibility:hidden（元素不可见也不可命中），
// 关掉开屏与几个会自动弹出的浮层，保证触摸落在目标上、命中测试有意义

// 真实触摸（只 R10 用）：判据是「手指按在这一行上」时命中确实是自己，再真按一下看勾没勾上
async function tapRaw(sel) {
  const h = await hit(sel);
  if (h.miss || h.self !== true) return h;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: h.x, y: h.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
  await sleep(70);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(450);
  return h;
}
async function clearFloaters() {
  for (let i = 0; i < 10; i++) {
    const hidden = await evalJs("(function(){['qa-mask','tc-mask','splash-mandatory','splash','backup-remind-bar','ver-update-bar','modal-mask'].forEach(function(id){var e=document.getElementById(id);if(e){e.hidden=true;}});" +
      "var q=document.getElementById('qa-mask-close');if(q)q.click();" +
      "var sp=document.querySelector('.splash');if(sp){sp.classList.add('hide');sp.hidden=true;}return document.getElementById('modal-mask').hidden;})()");
    if (hidden === true) {
      // 再确认一拍：弹窗层刚被两段式关闭流程重新显形过（实测 #modal-mask 会盖住整屏、
      // elementFromPoint 命中它），稳住两拍才算真收起
      await sleep(160);
      const again = await evalJs("document.getElementById('modal-mask').hidden === true");
      if (again === true) return;
    }
    await sleep(160);
  }
}

await connect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(400);
}
await boot();
// 造第二个联系人（成员选择器要有可勾的人；只勾第二个＝能验证 members 真按勾选写）
// 同时把「上次备份时间」写成刚刚——备份提醒弹窗每 2s 复查、会盖住整页吞掉触摸
//（本脚本量的是群聊浮层层级，不是备份提醒；不写这个键整套触摸都会被它挡住）。
// 注意键名：pwa.js 用的是无冒号的老式根键 G + '__last-backup'（xy-home-v2__last-backup），
// 不是 xyStore 的 xy-home-v2:__last-backup——写错键名提醒照样弹（实测踩过）。
await evalJs("(function(){try{var st=window.xyStore('xy-home-v2');var c=[];try{c=JSON.parse(st.get('contacts')||'[]');}catch(e){c=[];}" +
  "if(!c.some(function(x){return x.id==='c1018a2b3c4';})){c.push({id:'c1018a2b3c4',name:'验证联系人B'});st.set('contacts',JSON.stringify(c));}" +
  "localStorage.setItem('xy-home-v2__last-backup',String(Date.now()));" +
  "localStorage.setItem('xy-home-v2__last-backup-remind',String(Date.now()));return 1;}catch(e){return 'ERR';}})()");
await boot();
await clearFloaters();
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});return 1;})()");
await sleep(300);
const nContacts = await evalJs("(window.getContacts()||[]).length");
check('R1 前置：至少两名联系人可供勾选', nContacts >= 2, 'n=' + nContacts);

// 进入群聊设置：入口两跳（三点菜单 → 群聊设置）与 tag 切换用合成 click——它们不是本批的判据面，
// 且 headless 下「touch→click 合成」在开屏收起后的头几拍不稳（实测同一坐标时而落空）；
// 真正要量的浮层命中与勾选/确认一律走真实触摸。
await evalJs("(function(){document.getElementById('gc-more-btn').click();return 1;})()");
await waitStable('#gc-more-settings');
const setHit = await hit('#gc-more-settings');
await evalJs("(function(){document.getElementById('gc-more-settings').click();return 1;})()");
await sleep(500);
check('R2 群聊设置面板已打开（入口两跳都没被浮层挡住）',
  (await evalJs("!document.getElementById('gc-settings-panel').hidden")) === true && setHit.self === true, JSON.stringify(setHit));

// 「群聊」tag
await evalJs("(function(){var t=Array.from(document.querySelectorAll('#gc-set-body .them-tab')).find(function(x){return x.textContent.trim()==='群聊';});if(t)t.click();return 1;})()");
await sleep(350);
const listRows = await J("(function(){return JSON.stringify(Array.from(document.querySelectorAll('#gc-set-body .gc-set-groups-list > *')).map(function(e){return e.className;}));})()");
// #1016（并行批，本批一并把它的 src 回填了）把「新建群聊」行置顶 ⇒ 断言按内容判、不按位次，
// 只额外钉住「建群行在最上面」这条用户口径
check('R3 群聊 tag 有「默认群 + 新建群聊」两行、且新建群聊在最上面',
  Array.isArray(listRows) && listRows.length === 2 && String(listRows[0]).indexOf('gc-gp-new') >= 0 && String(listRows[1]).indexOf('gc-gp-item') >= 0,
  JSON.stringify(listRows));

// 新建群聊 → 群名弹窗
await clearFloaters();
await clickSel('#gc-set-body .gc-set-groups-list .gc-gp-new');
const modalOpen = await evalJs("document.getElementById('modal-mask').hidden === false");
const modalTitle = await evalJs("document.getElementById('modal-title').textContent");
check('R4 点「新建群聊」弹出群名弹窗', modalOpen === true && modalTitle === '群聊名称', String(modalTitle));
await evalJs("(function(){var i=document.getElementById('modal-input');i.value='验证群A';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
await clickSel('#modal-ok');
check('R5 群名弹窗已关（进入选成员这一步）', (await evalJs("document.getElementById('modal-mask').hidden")) === true);

// 关键判据：选择器打开那一帧「点它落到的确实是自己」，而不是被设置面板盖住
const pHit = await hit('#gc-gpick-panel');
const pOpen = await evalJs("!document.getElementById('gc-gpick-panel').hidden");
check('R6 成员选择器打开且未被设置面板盖住（缺陷态：elementFromPoint 命中 #gc-settings-panel）',
  pOpen === true && pHit.self === true, JSON.stringify(pHit));
const pRows = await J("(function(){return JSON.stringify(Array.from(document.querySelectorAll('#gc-gpick-body .gc-gpick-item')).map(function(r){return r.dataset.cid;}));})()");
check('R7 选择器列出全部联系人可供勾选', Array.isArray(pRows) && pRows.length >= 2, JSON.stringify(pRows));
const okHit = await hit('#gc-gpick-ok');
check('R8 选择器「确定」按钮同样在最上层（缺陷态：点不到）', okHit.self === true, JSON.stringify(okHit));
const rowHit = await hit('#gc-gpick-body .gc-gpick-item:nth-child(2)');
check('R9 选择器内的成员行同样在最上层', rowHit.self === true, JSON.stringify(rowHit));

// 触摸勾选第二行 → 确定
const rowTouch = await tapRaw('#gc-gpick-body .gc-gpick-item:nth-child(2)');
const checked = await J("(function(){return JSON.stringify(Array.from(document.querySelectorAll('#gc-gpick-body input[type=checkbox]')).map(function(c){return c.checked;}));})()");
check('R10 真实触摸按在这一行上：命中是自己、且真勾上了', rowTouch.self === true && Array.isArray(checked) && checked.filter(Boolean).length === 1 && checked[1] === true,
  JSON.stringify({ touch: rowTouch, checked: checked }));
await clickSel('#gc-gpick-ok');
await sleep(500);
const groups = await J("JSON.stringify(window.groupChatGetGroups())");
const created = Array.isArray(groups) ? groups[groups.length - 1] : null;
check('R11 群聊真被创建（名字来自弹窗、成员＝勾选的人）',
  !!created && created.name === '验证群A' && JSON.stringify(created.members) === JSON.stringify(['c1018a2b3c4']),
  JSON.stringify(created));
check('R12 当前群已切到新群', (await J("JSON.stringify(window.groupChatGetCurGroup())") || {}).id === (created && created.id), '');

// 自定义群的成员管理：添加成员走同一个选择器，同样不能被盖住
await evalJs("(function(){var t=Array.from(document.querySelectorAll('#gc-set-body .them-tab')).find(function(x){return x.textContent.trim()==='成员';});if(t)t.click();return 1;})()");
await sleep(350);
const memberBtns = await J("(function(){return JSON.stringify(Array.from(document.querySelectorAll('#gc-set-body .gc-set-members-list > *')).map(function(e){var b=e.querySelector('button');return b?b.textContent:'';}));})()");
check('R13 自定义群成员段有「移除」与「＋ 添加成员」', JSON.stringify(memberBtns).indexOf('移除') >= 0 && JSON.stringify(memberBtns).indexOf('添加成员') >= 0, JSON.stringify(memberBtns));
await clearFloaters();
const addBtnHit = await hit('#gc-set-body .gc-set-members-list .gc-mp-add button');
await clickSel('#gc-set-body .gc-set-members-list .gc-mp-add button');
const aHit = await hit('#gc-gpick-panel');
// 前置「添加成员按钮确实存在且点得到」必须一起成立——否则「选择器没被盖住」会被上一步遗留的旧选择器
// 蒙混过关（缺陷态实测：默认群没有这个按钮，断言却因旧选择器仍在屏上而假绿）
check('R14 「添加成员」的选择器同样未被盖住（缺陷态：点了没反应）',
  addBtnHit.self === true && (await evalJs("!document.getElementById('gc-gpick-panel').hidden")) === true && aHit.self === true,
  JSON.stringify({ btn: addBtnHit, panel: aHit }));
// 收面板一律用合成 click：真实触摸在长链路里偶尔落到旁边（本脚本量的是「浮层有没有被盖住」，
// 不是「手指落点准不准」，后续步骤不该被这种抖动带偏）
await evalJs("(function(){document.getElementById('gc-gpick-close').click();return 1;})()");
await sleep(250);

// 头像互动半框（同一族的第三个入口）
await evalJs("(function(){var t=Array.from(document.querySelectorAll('#gc-set-body .them-tab')).find(function(x){return x.textContent.trim()==='形象';});if(t)t.click();return 1;})()");
await sleep(350);
await clearFloaters();
await clickSel('#gc-set-body [data-inter="av"]');
const iHit = await hit('#gc-inter-panel');
check('R15 「头像互动」半框同样未被盖住', (await evalJs("!document.getElementById('gc-inter-panel').hidden")) === true && iHit.self === true, JSON.stringify(iHit));
await evalJs("(function(){document.getElementById('gc-inter-close').click();return 1;})()");
await sleep(250);

// 默认群的口径（设计如此）：无删除按钮、成员不可增删，提示指向「新建群聊」——这条同时守住
// 「别为了让默认群可删而偷偷改掉跟随全部联系人的语义」
await evalJs("(function(){var t=Array.from(document.querySelectorAll('#gc-set-body .them-tab')).find(function(x){return x.textContent.trim()==='群聊';});if(t)t.click();return 1;})()");
await sleep(350);
const rowInfo = await J("(function(){var rows=Array.from(document.querySelectorAll('#gc-set-body .gc-set-groups-list .gc-gp-item'));return JSON.stringify(rows.map(function(r){return {txt:r.innerText.replace(/\\n/g,'/'),del:!!r.querySelector('.gc-gp-del')};}));})()");
const defRow = (Array.isArray(rowInfo) ? rowInfo : []).find((r) => r.txt.indexOf('全部联系人') >= 0);
const cusRow = (Array.isArray(rowInfo) ? rowInfo : []).find((r) => r.txt.indexOf('验证群A') >= 0);
check('R16 默认群无删除按钮、自定义群有（默认群＝全部联系人，语义不变）',
  !!defRow && !!cusRow && defRow.del === false && cusRow.del === true, JSON.stringify(rowInfo));

// 删除自定义群这条路仍然通（浮层改动没碰坏管理路径）——给目标行打临时标记再取它那一行的删除按钮，
// 不用 nth-child 位次（#1016 把「新建群聊」行插到了列表第一位，位次算出来会指到默认群那行）
await clearFloaters();
const delSel = await evalJs("(function(){var all=Array.from(document.querySelectorAll('#gc-set-body .gc-set-groups-list > *'));" +
  "all.forEach(function(r){r.removeAttribute('data-vt');if(r.innerText.indexOf('验证群A')>=0)r.setAttribute('data-vt','1');});" +
  "return document.querySelector('[data-vt=\"1\"] .gc-gp-del') ? '[data-vt=\"1\"] .gc-gp-del' : '';})()");
const delHit = delSel ? await hit(delSel) : { miss: true };
await evalJs("(function(){var b=document.querySelector(" + JSON.stringify(delSel) + ");if(b)b.click();return 1;})()");
await sleep(450);
const delModal = await evalJs("document.getElementById('modal-mask').hidden === false");
check('R17 点「删除」弹确认弹窗（删除按钮在最上层且真的触发）', delHit.self === true && delModal === true, JSON.stringify({ sel: delSel, hit: delHit }));
await evalJs("(function(){document.getElementById('modal-ok').click();return 1;})()");
await sleep(550);
const groups2 = await J("JSON.stringify(window.groupChatGetGroups())");
check('R18 删除后只剩默认群，且当前群回落到默认群',
  Array.isArray(groups2) && groups2.length === 1 && groups2[0].id === 'default'
  && (await J("JSON.stringify(window.groupChatGetCurGroup())") || {}).id === 'default', JSON.stringify(groups2));

// R20：三点菜单入口（并行批 #1016 的「新建群聊」并列项；本批把它的 src 一并回填了）在本批后仍通——
// 那条路是在「设置面板已关」的状态下开选择器，同样不能被别的东西盖住。
// 先关设置面板、再清一遍浮层（上一步删除确认弹窗若还占着全站唯一 #modal-mask，openModal 会让路＝
// 这一步会假红），然后才点菜单。
await evalJs("(function(){var b=document.getElementById('gc-set-close');if(b)b.click();return 1;})()");
await sleep(450);
await clearFloaters();
await evalJs("(function(){document.getElementById('gc-more-btn').click();return 1;})()");
await waitStable('#gc-more-newgroup');
const menuHit = await hit('#gc-more-newgroup');
await evalJs("(function(){document.getElementById('gc-more-newgroup').click();return 1;})()");
await sleep(550);
const menuModalTitle = await evalJs("document.getElementById('modal-mask').hidden === false ? document.getElementById('modal-title').textContent : ''");
await evalJs("(function(){var i=document.getElementById('modal-input');i.value='验证群B';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
await clickSel('#modal-ok');
await sleep(550);
const menuPickerHit = await hit('#gc-gpick-panel');
check('R20 三点菜单「新建群聊」入口在本批后仍通（菜单项在最上层 → 群名弹窗 → 选择器不被盖住）',
  menuHit.self === true && menuModalTitle === '群聊名称'
  && (await evalJs("!document.getElementById('gc-gpick-panel').hidden")) === true && menuPickerHit.self === true,
  JSON.stringify({ menu: menuHit, title: menuModalTitle, picker: menuPickerHit }));
await clickSel('#gc-gpick-close');
await sleep(250);

const errs = await evalJs("JSON.stringify((window.__jsErrors||[]).slice(-3))");
check('R19 全程无 JS 报错', errs === '[]', String(errs));

await cdp('Browser.close').catch(() => {});
chrome.kill(); server.close();
const pass = results.filter(Boolean).length;
console.log('\n#1018 结果：' + pass + '/' + results.length + '  通过');
process.exit(pass === results.length ? 0 : 1);

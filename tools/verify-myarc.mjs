// ===== 专项验证：【我的档案】(my-arc) 与第三页图标接线 =====
// 覆盖：
//   S1-S5 静态：build 注册 / 第三页图标与梦角档案相邻 / 页面锚点四件套 / tabs FULL_PAGES /
//          contacts EXCLUDE(myarc 防误迁——缺失会导致档案键被 migrateLegacy 迁走"消失")
//   S6    my-arc.js 分区与桥接标记
//   P1    第三页顺序：梦角档案右边就是我的档案（用户诉求本体）
//   P2    打开页面：hero + 8 行菜单顺序
//   P3    关于我字段编辑写入 xy-home-v2:myarc
//   P4    喜好：喜欢分类两阶段 / 偏好单阶段
//   P5    描述卡三阶段（类型→内容→备注）
//   P6    我和TA / 我的IF世界 字段入库
//   P7    共同记录桥接：go-shared 直达梦角档案·共同记录；头部「去TA的档案」按钮同效
//   P8    刷新持久化
//   P9    全程零 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssList = [], jsList = [];
try {
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const jparse = (s) => JSON.parse(s.replace(/'/g, '"'));
  cssList = jparse(bm.match(/const cssFiles = (\[[^\]]+\]);/)[1]);
  jsList = jparse(bm.match(/const jsFiles = (\[[^\]]+\]);/)[1]);
} catch (e) { console.error('build.mjs 清单解析失败', e.message); process.exit(1); }

let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssList.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsList.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-myarc-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-myarc-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

// ---- S 组静态 ----
console.log('== S 组 静态 ==');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const tabsJs = readFileSync(join(root, 'src/js/tabs.js'), 'utf8');
const ctJs = readFileSync(join(root, 'src/js/contacts.js'), 'utf8');
const myJs = readFileSync(join(root, 'src/js/my-arc.js'), 'utf8');
ok('S1 build.mjs jsFiles 已注册 my-arc.js（紧跟 memo-arc.js）', /'memo-arc\.js',\s*'my-arc\.js'/.test(bm));
{
  // 直接在整份模板上定位两个图标：my-arc 必须出现在 memo-arc 之后，且两者之间没有第三个桌面图标
  const iMemo = tpl.indexOf('data-app="memo-arc"');
  const iMy = tpl.indexOf('data-app="my-arc"');
  // 两图标之间不得出现第三个桌面图标（slice 含起点自身，故 data-app 出现次数应为 1）
  const between = iMemo >= 0 && iMy > iMemo ? tpl.slice(iMemo, iMy) : '';
  const nIcons = between ? (between.match(/data-app="/g) || []).length : -1;
  ok('S2 第三页图标：my-arc 存在且紧邻 memo-arc 右侧', iMemo >= 0 && iMy > iMemo && nIcons === 1, { iMemo, iMy, nIcons });
}
ok('S3 page-my-arc 锚点三件套（back/title/root），右上角无「去TA的档案」按钮', ['id="page-my-arc"', 'id="myarc-back"', 'id="myarc-root"'].every((s) => tpl.indexOf(s) >= 0) && tpl.indexOf('id="myarc-ta"') === -1);
ok('S4 tabs.js FULL_PAGES 含 page-my-arc（全屏页 chrome 同步）', tabsJs.indexOf("'page-my-arc'") >= 0);
ok('S5 contacts.js EXCLUDE 保护 myarc 根键（防 migrateLegacy 误迁致档案消失）', /indexOf\('myarc'\)\s*===\s*0/.test(ctJs));
ok('S6 my-arc.js 七分区+桥接标记齐全', ['关于我', '我的喜好', '我的习惯', '我的物品', '我和TA', '我对自己的描述', '我的IF世界', 'go-shared'].every((k) => myJs.indexOf(k) >= 0));

try {
  await cdpConnect();
  const jsErrors = [];
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);

  async function modalState() {
    return JSON.parse(await evalJs("(function(){var m=document.getElementById('modal-mask'),t=document.getElementById('modal-title'),i=document.getElementById('modal-input'),p=document.getElementById('modal-pills');var o=p?p.querySelector('.pill.on'):null;return JSON.stringify({open:!!(m&&!m.hidden),title:t?t.textContent:'',inpHidden:!!(i&&i.hidden),val:(i&&!i.hidden)?i.value:'',pillsHidden:!!(p&&p.hidden),pills:[].map.call((p&&p.children)||[],function(b){return b.textContent;}),on:o?o.textContent:''});})()"));
  }
  async function pillByText(txt) { await evalJs('(function(){var ps=document.querySelectorAll("#modal-pills .pill");for(var i=0;i<ps.length;i++){if(ps[i].textContent===' + JSON.stringify(txt) + '){ps[i].click();break;}}return true;})()'); await sleep(120); }
  async function fillInput(v) { await evalJs('(function(){var i=document.getElementById("modal-input");i.value=' + JSON.stringify(v) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return true;})()'); }
  async function okBtn() { await evalJs('(function(){document.getElementById("modal-ok").click();return true;})()'); await sleep(300); }
  async function clickSel(sel) { return evalJs('(function(){var el=document.querySelector(' + JSON.stringify(sel) + ');if(el){el.click();return true;}return false;})()'); }
  async function cnt(sel) { return evalJs('(function(){return document.querySelectorAll(' + JSON.stringify(sel) + ').length;})()'); }
  async function has(txt) { return evalJs('(function(){return document.getElementById("myarc-root").innerHTML.indexOf(' + JSON.stringify(txt) + ')>=0;})()'); }
  async function myGet(cid) { return JSON.parse(await evalJs("(function(){return window.xyStore('" + (cid ? 'xy-home-v2:' + cid : 'xy-home-v2:default') + "').get('myarc');})()")); }

  // 种一个梦角名单（供 P7 桥接直达共同记录）
  await evalJs("(function(){var s=window.xyStore('xy-home-v2');s.set('cjian-roster',JSON.stringify([{id:'t1',name:'小梦'}]));var n=Date.now();s.set('narc-t1',JSON.stringify({created:n-86400000,loves:[],bonds:[{id:'b1',cat:'first',text:'第一次聊天',date:'8月1日',created:n}],moments:[],records:[],wonders:[],history:[]}));s.set('narc-cur','t1');return true;})()");

  console.log('\n== P1 第三页图标相邻 ==');
  const order = await evalJs('(function(){var g=document.querySelector(".app-grid.p3-grid");if(!g)return null;return [].map.call(g.children,function(c){return c.getAttribute("data-app");}).filter(Boolean);})()');
  ok('P1a 第三页含 memo-arc 与 my-arc', order && order.indexOf('memo-arc') >= 0 && order.indexOf('my-arc') >= 0, order);
  ok('P1b my-arc 紧跟 memo-arc 右侧（相邻一位）', order && order.indexOf('my-arc') === order.indexOf('memo-arc') + 1, order);

  console.log('\n== P2 打开与总览 ==');
  await evalJs('(function(){var a=document.querySelector(\'.app[data-app="my-arc"]\');if(a)a.click();return true;})()');
  await sleep(400);
  ok('P2a 点图标打开 page-my-arc', await evalJs('(function(){var p=document.getElementById("page-my-arc");return !!(p&&!p.hidden);})()'));
  const titles = await evalJs('(function(){return [].map.call(document.querySelectorAll(".narc-mrow .nm-title"),function(e){return e.childNodes[0].textContent;});})()');
  ok('P2b 菜单 8 行顺序正确（末行为共同记录桥接）', JSON.stringify(titles) === JSON.stringify(['关于我', '我的喜好', '我的习惯', '我的物品', '我和TA', '我对自己的描述', '我的IF世界', '我们的共同记录']), titles);

  console.log('\n== P3 关于我 ==');
  await evalJs('(function(){var bs=document.querySelectorAll(".narc-mrow");bs[0].click();return true;})()');
  await sleep(280);
  ok('P3a 关于我 8 个字段行', (await cnt('.narc-frow')) === 8, await cnt('.narc-frow'));
  await evalJs('(function(){var rows=document.querySelectorAll(".narc-frow");for(var i=0;i<rows.length;i++){if(rows[i].getAttribute("data-key")==="nature"){rows[i].click();break;}}return true;})()');
  await sleep(280);
  await fillInput('慢热，熟了以后话很多');
  await okBtn();
  let arc = await myGet();
  ok('P3b 性格写入 xy-home-v2:myarc', arc && arc.who && arc.who.f.nature === '慢热，熟了以后话很多', arc && arc.who);

  console.log('\n== P4 我的喜好 ==');
  await evalJs('(function(){document.querySelector(".narc-backhome").click();return true;})()');
  await sleep(240);
  await evalJs('(function(){var bs=document.querySelectorAll(".narc-mrow");bs[1].click();return true;})()');
  await sleep(260);
  await clickSel('[data-op="add-li"][data-kind="taste"]');
  await sleep(280);
  let ms = await modalState();
  ok('P4a 喜欢走分类胶囊阶段（12 类）', ms.open && ms.pills.length === 12 && ms.inpHidden, ms.pills.length);
  await pillByText('饮料');
  await okBtn();
  ms = await modalState();
  ok('P4b 切输入阶段且胶囊隐藏', !ms.inpHidden && ms.pillsHidden, ms);
  await fillInput('冰美式');
  await okBtn();
  arc = await myGet();
  ok('P4c 入库 g=like cat=饮料', arc.tastes.length === 1 && arc.tastes[0].cat === '饮料', arc.tastes);

  console.log('\n== P5 描述卡 ==');
  await evalJs('(function(){document.querySelector(".narc-backhome").click();return true;})()');
  await sleep(240);
  await evalJs('(function(){var bs=document.querySelectorAll(".narc-mrow");for(var i=0;i<bs.length;i++){if(bs[i].getAttribute("data-view")==="self"){bs[i].click();break;}}return true;})()');
  await sleep(260);
  await clickSel('[data-op="add-self"]');
  await sleep(280);
  ms = await modalState();
  ok('P5a 阶段一：8 类类型胶囊', ms.open && ms.pills.length === 8 && ms.inpHidden, ms.pills);
  await pillByText('别人以为，其实');
  await okBtn();
  ms = await modalState();
  ok('P5b 切内容阶段（标题=类型、胶囊隐藏）', ms.open && !ms.inpHidden && ms.pillsHidden && ms.title === '别人以为，其实', ms);
  await fillInput('别人以为我大大咧咧，其实我什么都记得');
  await okBtn();
  ms = await modalState();
  ok('P5c 备注阶段可留空', ms.open && /补充/.test(ms.title), ms);
  await okBtn();
  arc = await myGet();
  ok('P5d 描述卡入库 type=sreal', arc.selfs.length === 1 && arc.selfs[0].type === 'sreal', arc.selfs);
  ok('P5e 卡片渲染', (await has('其实我什么都记得')) === true);

  console.log('\n== P6 我和TA / IF世界 ==');
  await evalJs('(function(){document.querySelector(".narc-backhome").click();return true;})()');
  await sleep(240);
  await evalJs('(function(){var bs=document.querySelectorAll(".narc-mrow");for(var i=0;i<bs.length;i++){if(bs[i].getAttribute("data-view")==="relate"){bs[i].click();break;}}return true;})()');
  await sleep(260);
  ok('P6a 我和TA 6 个字段行', (await cnt('.narc-frow')) === 6, await cnt('.narc-frow'));
  await evalJs('(function(){var rows=document.querySelectorAll(".narc-frow");for(var i=0;i<rows.length;i++){if(rows[i].getAttribute("data-key")==="comfort"){rows[i].click();break;}}return true;})()');
  await sleep(250);
  await fillInput('别讲道理，先抱我');
  await okBtn();
  await evalJs('(function(){document.querySelector(".narc-backhome").click();return true;})()');
  await sleep(240);
  await evalJs('(function(){var bs=document.querySelectorAll(".narc-mrow");for(var i=0;i<bs.length;i++){if(bs[i].getAttribute("data-view")==="ifw"){bs[i].click();break;}}return true;})()');
  await sleep(260);
  await evalJs('(function(){var rows=document.querySelectorAll(".narc-frow");for(var i=0;i<rows.length;i++){if(rows[i].getAttribute("data-key")==="world"){rows[i].click();break;}}return true;})()');
  await sleep(250);
  await fillInput('海边小镇');
  await okBtn();
  arc = await myGet();
  ok('P6b relate.comfort 与 ifw.world 均入库', arc.relate.f.comfort === '别讲道理，先抱我' && arc.ifw.world === '海边小镇', { c: arc.relate.f.comfort, w: arc.ifw.world });

  console.log('\n== P7 共同记录桥接 ==');
  await evalJs('(function(){document.querySelector(".narc-backhome").click();return true;})()');
  await sleep(240);
  const bridge = await evalJs('(function(){var b=document.querySelector("[data-op=\\"go-shared\\"]");if(b)b.click();return !!b;})()');
  await sleep(420);
  ok('P7a 点桥接行切到梦角档案页', bridge === true && await evalJs('(function(){var p=document.getElementById("page-memo-arc");return !!(p&&!p.hidden);})()'));
  ok('P7b 直达「我们的共同记录」分区（时间线/第一次 tab 在）', await evalJs('(function(){var r=document.getElementById("narc-root");return r.innerHTML.indexOf("第一次")>=0&&r.innerHTML.indexOf("时间线")>=0;})()'));
  // 从梦角档案回桌面再进我的档案，确认右上角已无「去TA的档案」按钮（用户要求移除）
  await evalJs('(function(){document.getElementById("narc-back").click();return true;})()');
  await sleep(300);
  await evalJs('(function(){var a=document.querySelector(\'.app[data-app="my-arc"]\');if(a)a.click();return true;})()');
  await sleep(350);
  ok('P7c 右上角无「去TA的档案」按钮（#myarc-ta 已移除）', (await cnt('#myarc-ta')) === 0);

  console.log('\n== P8 刷新持久化 ==');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);
  await evalJs('(function(){var a=document.querySelector(\'.app[data-app="my-arc"]\');if(a)a.click();return true;})()');
  await sleep(400);
  // 总览只有计数徽章，进「我的喜好」分区再验证条目本体
  await evalJs('(function(){var bs=document.querySelectorAll(".narc-mrow");bs[1].click();return true;})()');
  await sleep(280);
  ok('P8 重开后喜好仍在（计数=1 且条目可见）', ((await myGet()).tastes.length) === 1 && (await has('冰美式')) === true);

  // ---- P10 多联系人：各存一份、chip 切换、互不串档 ----
  console.log('\n== P10 多联系人分档 ==');
  const cidB = await evalJs("(function(){return window.createContact ? (window.createContact('小北') || '') : '';})()");
  await sleep(300);
  ok('P10a 测试联系人「小北」创建成功', !!cidB, cidB);
  await evalJs('(function(){document.getElementById("myarc-back").click();return true;})()');
  await sleep(260);
  await evalJs('(function(){var a=document.querySelector(\'.app[data-app="my-arc"]\');if(a)a.click();return true;})()');
  await sleep(380);
  const chipLabels = await evalJs('(function(){return [].map.call(document.querySelectorAll(".narc-chips .narc-chip"),function(b){return b.textContent;});})()');
  ok('P10b chips 覆盖所有桌面联系人（默认+小北）', chipLabels && chipLabels.length === 2 && chipLabels.indexOf('小北') >= 0, chipLabels);
  await evalJs('(function(){var bs=document.querySelectorAll("[data-op=\\"pick-cid\\"]");for(var i=0;i<bs.length;i++){if(bs[i].textContent==="小北"){bs[i].click();break;}}return true;})()');
  await sleep(320);
  ok('P10c 切到小北后其 chip 高亮', await evalJs('(function(){var bs=document.querySelectorAll("[data-op=\\"pick-cid\\"]");for(var i=0;i<bs.length;i++){if(bs[i].textContent==="小北")return bs[i].className.indexOf("on")>=0;}return false;})()'));
  ok('P10d hero 副标题显示对应 TA 名（仍在总览）', (await has('写给「小北」的那一份')) === true);
  await evalJs('(function(){var bs=document.querySelectorAll(".narc-mrow");bs[0].click();return true;})()'); // 关于我
  await sleep(260);
  await evalJs('(function(){var rows=document.querySelectorAll(".narc-frow");for(var i=0;i<rows.length;i++){if(rows[i].getAttribute("data-key")==="nature"){rows[i].click();break;}}return true;})()');
  await sleep(250);
  await fillInput('在小北面前是个话痨');
  await okBtn();
  const arcA = await myGet();
  const arcB = await myGet(cidB);
  ok('P10e 小北那份独立入库，默认那份不受影响', arcB && arcB.who.f.nature === '在小北面前是个话痨' && (!arcA.who.f.nature || arcA.who.f.nature === '慢热，熟了以后话很多'), { b: arcB && arcB.who.f.nature, a: arcA && arcA.who.f.nature });
  await evalJs('(function(){var bs=document.querySelectorAll("[data-op=\\"pick-cid\\"]");for(var i=0;i<bs.length;i++){if(bs[i].textContent!=="小北"){bs[i].click();break;}}return true;})()');
  await sleep(320);
  ok('P10f 切回默认份：性格仍是原值（互不串档）', (await has('慢热，熟了以后话很多')) === true && !(await has('在小北面前是个话痨')));

  console.log('\n== P9 JS 异常 ==');
  ok('P9 全程零未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));
} catch (e) {
  fail++;
  console.log('  ✗ 运行时异常: ' + (e && e.message || e));
}

console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);

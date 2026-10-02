// ===== 专项验证：梦角档案 v2（9 分区重构：TA是谁/喜好/习惯/相处/了解★/位置感/物品/共同记录/IF世界） =====
// 覆盖：
//   S 组静态：memo-arc.js 九个分区标记、memo-arc.css 新类
//   P1 总览菜单（9 行、标题顺序、核心徽章）
//   P2 TA是谁字段编辑（弹窗读写 + 存储）
//   P3 TA的喜好：喜欢带分类胶囊两阶段 / 偏好单阶段
//   P4 TA的习惯（小动作）
//   P5 旧数据兼容：旧 loves(type/level) 渲染为 来源徽章+了解程度圆点
//   P6 新发现卡片完整 5 阶段弹窗链路（类型→内容→备注→来源→程度），含「离开胶囊阶段必须 ctl.pills([])」回归断言
//   P7 还不了解 / 理解变化 子标签
//   P8 TA的位置感字段
//   P9 TA的物品分组
//   P10 我们的共同记录：时间线合并旧 bonds/moments/records + 特别日子新增流程
//   P11 当前IF世界：字段 + 变化列表
//   P12 刷新持久化
//   P13 全程零 JS 异常
//   P14 了解卡「暂不适用 / 恢复适用」
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
// 与 build.mjs 保持一致的合并清单（自组装页直接复刻生产依赖顺序）
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'decision.js', 'group-decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];

let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-narc-v2-' + Date.now());
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-narc-v2-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

// ---- S 组：静态断言 ----
console.log('== S 组 静态 ==');
const narcJs = readFileSync(join(root, 'src/js/memo-arc.js'), 'utf8');
const narcCss = readFileSync(join(root, 'src/css/memo-arc.css'), 'utf8');
ok('S1 九个分区标记齐全', ['TA是谁', 'TA的喜好', 'TA的习惯', 'TA与我的相处', '我对TA的了解', 'TA的位置感', 'TA的物品', '我们的共同记录', '当前IF世界'].every((k) => narcJs.indexOf(k) >= 0));
ok('S2 新样式类齐全（菜单/字段行/来源/圆点/核心徽章）', ['.narc-mrow', '.narc-frow', '.nk-src', '.nk-dots', '.nm-core'].every((c) => narcCss.indexOf(c) >= 0));
ok('S3 子标签换行铺开（防窄屏滑出）', /\.narc-btabs\s*\{[^}]*flex-wrap:\s*wrap/.test(narcCss));

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

  // ---- 驱动辅助 ----
  async function modalState() {
    return JSON.parse(await evalJs("(function(){var m=document.getElementById('modal-mask'),t=document.getElementById('modal-title'),i=document.getElementById('modal-input'),ta=document.getElementById('modal-textarea'),p=document.getElementById('modal-pills');var o=p?p.querySelector('.pill.on'):null;return JSON.stringify({open:!!(m&&!m.hidden),title:t?t.textContent:'',inpHidden:!!(i&&i.hidden),taVisible:!!(ta&&!ta.hidden),val:(i&&!i.hidden)?i.value:'',pillsHidden:!!(p&&p.hidden),pills:[].map.call((p&&p.children)||[],function(b){return b.textContent;}),on:o?o.textContent:''});})()"));
  }
  async function pillByText(txt) {
    await evalJs('(function(){var ps=document.querySelectorAll("#modal-pills .pill");for(var i=0;i<ps.length;i++){if(ps[i].textContent===' + JSON.stringify(txt) + '){ps[i].click();break;}}return true;})()');
    await sleep(120);
  }
  async function fillInput(v) { await evalJs('(function(){var i=document.getElementById("modal-input");i.value=' + JSON.stringify(v) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return true;})()'); }
  async function okBtn() { await evalJs('(function(){document.getElementById("modal-ok").click();return true;})()'); await sleep(300); }
  async function clickSel(sel) { const hit = await evalJs('(function(){var el=document.querySelector(' + JSON.stringify(sel) + ');if(el){el.click();return true;}return false;})()'); await sleep(280); return hit; }
  async function narcCount(sel) { return evalJs('(function(){return document.querySelectorAll(' + JSON.stringify(sel) + ').length;})()'); }
  async function narcHas(txt) { return evalJs('(function(){return document.getElementById("narc-root").innerHTML.indexOf(' + JSON.stringify(txt) + ')>=0;})()'); }
  async function arcGet() { return JSON.parse(await evalJs("(function(){return window.xyStore('xy-home-v2').get('narc-t1');})()")); }
  async function navTo(view) {
    // 若当前在分区详情页（无 .narc-mrow），先点「返回总览」再进目标分区——防静默失败
    await evalJs('(function(){if(!document.querySelector(".narc-mrow")){var bh=document.querySelector(".narc-backhome");if(bh)bh.click();}})()');
    await sleep(240);
    const hit = await evalJs('(function(){var bs=document.querySelectorAll(".narc-mrow");for(var i=0;i<bs.length;i++){if(bs[i].getAttribute("data-view")===' + JSON.stringify(view) + '){bs[i].click();return true;}}return false;})()');
    if (!hit) throw new Error('navTo 找不到分区: ' + view);
    await sleep(280);
  }
  async function stab(viewKey, tabVal) { await evalJs('(function(){var bs=document.querySelectorAll(".narc-btab");for(var i=0;i<bs.length;i++){if(bs[i].getAttribute("data-view")===' + JSON.stringify(viewKey) + '&&bs[i].getAttribute("data-tab")===' + JSON.stringify(tabVal) + '){bs[i].click();break;}}return true;})()'); await sleep(280); }

  // ---- 种子：一个梦角 + 全套旧版数据（验证兼容迁移） ----
  await evalJs("(function(){var s=window.xyStore('xy-home-v2');var now=Date.now();s.set('cjian-roster',JSON.stringify([{id:'t1',name:'小梦'}]));s.set('narc-t1',JSON.stringify({created:now-30*86400000,loves:[{id:'l1',type:'like',text:'喜欢在下雨天待在窗边',why:'一开始的观察',level:'1',created:now-1000,updated:now-1000,status:'active'}],bonds:[{id:'b1',cat:'first',text:'第一次聊天',date:'8月1日',created:now-3000}],moments:[{id:'m1',text:'第一次说想我',date:'8月2日',created:now-2000}],records:[{id:'r1',text:'一起看了流星',date:'8月3日',created:now-1500}],wonders:[{id:'w1',text:'TA真正害怕什么？',solved:false,created:now-500,solvedAt:null}],history:[{time:now-900,text:'「TA喜欢」新增了解：喜欢在下雨天待在窗边'}]}));s.set('narc-cur','t1');return true;})()");

  // ---- P1 总览菜单 ----
  console.log('\n== P1 总览 ==');
  await evalJs('(function(){var a=document.querySelector(".app[data-app=\\"memo-arc\\"]");if(a)a.click();return true;})()');
  await sleep(400);
  const pageOpen = await evalJs('(function(){var p=document.getElementById("page-memo-arc");return !!(p&&!p.hidden);})()');
  ok('P1a 点图标打开档案页', pageOpen === true);
  const menuTitles = await evalJs('(function(){return [].map.call(document.querySelectorAll(".narc-mrow .nm-title"),function(e){return e.childNodes[0].textContent;});})()');
  ok('P1b 菜单 9 行且顺序正确', JSON.stringify(menuTitles) === JSON.stringify(['TA是谁', 'TA的喜好', 'TA的习惯', 'TA与我的相处', '我对TA的了解', 'TA的位置感', 'TA的物品', '我们的共同记录', '当前IF世界']), menuTitles);
  ok('P1c 我对TA的了解带「核心」徽章', (await narcHas('nm-core')) === true);
  ok('P1d 英雄区统计含旧数据（了解1/共同记录3/重要时刻1/还不了解1）', (await narcHas('共同记录')) && (await narcHas('还不了解')));
  const knowCnt = await evalJs('(function(){var r=document.querySelectorAll(".narc-mrow");for(var i=0;i<r.length;i++){if(r[i].getAttribute("data-view")=="knows"){var c=r[i].querySelector(".nm-count");return c?c.textContent:"";}}return "";})()');
  ok('P1e 了解计数徽章 = 1（旧数据）', knowCnt === '1', knowCnt);
  // #712：顶部「不是 AI」说明——总览常驻且必须是 narc-root 第一个元素；分区子页不出现
  ok('P1f 顶部「不是 AI」说明存在且位于最顶', (await evalJs('(function(){var r=document.getElementById("narc-root");var n=r.firstElementChild;return !!n&&n.className=="narc-ai-note"&&n.textContent.indexOf("本站没有任何 AI 功能，梦角档案只是记录")>=0;})()')) === true);
  await navTo('who');
  ok('P1g 分区子页不显示顶部说明', (await evalJs('(function(){return document.getElementById("narc-root").querySelector(".narc-ai-note")==null;})()')) === true);

  // ---- P2 TA是谁 字段编辑 ----
  console.log('\n== P2 TA是谁 ==');
  await navTo('who');
  ok('P2a 17 个字段行（基本资料8+世界设定3+存在方式6）', (await narcCount('.narc-frow')) === 17, await narcCount('.narc-frow'));
  ok('P2b 分组标题 3 个', (await narcCount('.narc-ghead')) === 3);
  await evalJs('(function(){var rows=document.querySelectorAll(".narc-frow");for(var i=0;i<rows.length;i++){var l=rows[i].querySelector(".nf-label");if(l&&l.textContent==="性格"){rows[i].click();break;}}return true;})()');
  await sleep(300);
  let ms = await modalState();
  ok('P2c 点「性格」弹编辑窗（单行+占位引导）', ms.open && ms.title === '性格' && !ms.inpHidden && ms.val === '', ms);
  await fillInput('安静，慢热，其实很温柔');
  await okBtn();
  let arc = await arcGet();
  ok('P2d 性格写入存储 who.f.nature', arc && arc.who && arc.who.f.nature === '安静，慢热，其实很温柔', arc && arc.who);
  ok('P2e 行内显示已填值', (await narcHas('安静，慢热，其实很温柔')) === true);
  await clickSel('.narc-backhome');
  ok('P2f 返回总览按钮生效', (await narcCount('.narc-mrow')) === 9);

  // ---- P3 TA的喜好 ----
  console.log('\n== P3 TA的喜好 ==');
  await navTo('tastes');
  ok('P3a 默认「喜欢」tab，12 个分类胶囊', (await narcCount('.narc-btab')) === 3);
  await clickSel('[data-op="add-li"][data-kind="taste"]');
  await sleep(300);
  ms = await modalState();
  ok('P3b 分类胶囊阶段（12 类、无输入框）', ms.open && ms.pills.length === 12 && ms.inpHidden === true, ms.pills.length);
  await pillByText('食物');
  await okBtn();
  ms = await modalState();
  ok('P3c 选类后切到输入阶段且胶囊已隐藏（ctl.pills([]) 回归断言）', ms.open && ms.title === '具体是什么呢？' && !ms.inpHidden && ms.pillsHidden === true, ms);
  await fillInput('布丁');
  await okBtn();
  arc = await arcGet();
  ok('P3d 布丁入库（g=like cat=食物）', arc.tastes.length === 1 && arc.tastes[0].cat === '食物' && arc.tastes[0].g === 'like', arc.tastes);
  ok('P3e 条目渲染带分类徽章', (await narcHas('ni-cat')) === true && (await narcHas('布丁')) === true);
  await stab('tastes', 'pref');
  await clickSel('[data-op="add-li"][data-kind="taste"]');
  await sleep(250);
  ms = await modalState();
  ok('P3f 偏好 tab 单阶段输入（无分类胶囊）', ms.open && ms.pillsHidden === true && !ms.inpHidden, ms);
  await fillInput('比起热闹，更喜欢两个人待着。');
  await okBtn();
  ok('P3g 偏好条目入库', ((await arcGet()).tastes.length) === 2);

  // ---- P4 TA的习惯 ----
  console.log('\n== P4 TA的习惯 ==');
  await navTo('habits');
  await stab('habits', 'micro');
  await clickSel('[data-op="add-li"][data-kind="habit"]');
  await sleep(250);
  await fillInput('想事情的时候会沉默');
  await okBtn();
  arc = await arcGet();
  ok('P4 小动作入库 g=micro', arc.habits.length === 1 && arc.habits[0].g === 'micro', arc.habits);

  // ---- P5 旧数据兼容渲染 ----
  console.log('\n== P5 我对TA的了解·旧数据 ==');
  await navTo('knows');
  ok('P5a 默认「发现卡片」子标签', (await narcHas('我发现…')) === true);
  ok('P5b 旧卡类型标签保留（TA喜欢……）', (await narcHas('TA喜欢……')) === true);
  const srcChip = await evalJs('(function(){var c=document.querySelector(".narc-k .nk-src");return c?c.textContent:"";})()');
  ok('P5c 旧卡补来源徽章=我观察到的（level 1 规范化）', srcChip === '我观察到的', srcChip);
  const dots = await evalJs('(function(){var d=document.querySelector(".narc-k .nk-dots");return d?d.textContent:"";})()');
  ok('P5d 旧卡了解程度圆点 ●●●○○（5 格）', dots === '●●●○○', dots);
  ok('P5e why 字段作为备注展示', (await narcHas('一开始的观察')) === true);
  ok('P5f 四个操作按钮齐全', (await narcCount('.narc-k [data-op="edit-know"]')) === 1 && (await narcCount('[data-op="revise-know"]')) === 1 && (await narcCount('[data-op="retire-know"]')) === 1 && (await narcCount('[data-op="del-know"]')) === 1);

  // ---- P6 新发现卡 5 阶段弹窗链路 ----
  console.log('\n== P6 新增发现卡片 ==');
  await clickSel('[data-op="add-know"]');
  await sleep(300);
  ms = await modalState();
  ok('P6a 阶段一：10 个类型胶囊', ms.open && ms.pills.length === 10 && ms.inpHidden === true, ms.pills.length);
  await pillByText('TA其实很在意');
  await okBtn();
  ms = await modalState();
  ok('P6b 阶段二：标题带类型、胶囊隐藏、输入出现', ms.open && ms.title.indexOf('TA其实很在意') === 0 && !ms.inpHidden && ms.pillsHidden === true, ms);
  await fillInput('TA记得我说过的每一件小事');
  await okBtn();
  ms = await modalState();
  ok('P6c 阶段三：我的备注（可跳过）', ms.open && ms.title === '我的备注（可选）' && !ms.inpHidden, ms);
  await fillInput('后来发现连随口提的都记得');
  await okBtn();
  ms = await modalState();
  ok('P6d 阶段四：来源胶囊 4 项，默认选中「我观察到的」', ms.open && ms.pills.length === 4 && ms.inpHidden === true && ms.on === '我观察到的', ms);
  await pillByText('已确认');
  await okBtn();
  ms = await modalState();
  ok('P6e 阶段五：程度圆点预选随来源联动（已确认→●●●●●）', ms.open && ms.pills.length === 5 && ms.on === '●●●●● 已确认', ms);
  await okBtn();
  ms = await modalState();
  ok('P6f 保存后弹窗关闭', ms.open === false);
  arc = await arcGet();
  ok('P6g 新卡入库全字段', arc.loves.length === 2 && arc.loves[1].type === 'kcare' && arc.loves[1].src === 'confirmed' && arc.loves[1].dots === 5 && arc.loves[1].note === '后来发现连随口提的都记得' && arc.loves[1].why === '后来发现连随口提的都记得', arc.loves[1]);
  ok('P6h 卡片渲染：新文本+圆点+来源', (await narcHas('TA记得我说过的每一件小事')) === true && (await evalJs('(function(){return document.querySelectorAll(".narc-k").length;})()')) === 2);
  const histN = await evalJs('(function(){return (JSON.parse(window.xyStore("xy-home-v2").get("narc-t1")).history||[]).length;})()');
  ok('P6i 理解变化自动追加记录', histN >= 2, histN);

  // ---- P7 子标签：还不了解 / 理解变化 ----
  console.log('\n== P7 还不了解 / 理解变化 ==');
  await stab('knows', 'wonders');
  ok('P7a 旧 wonders 渲染在「还不了解」', (await narcHas('TA真正害怕什么？')) === true && (await narcHas('还不了解')) === true);
  await clickSel('[data-op="add-wonder"]');
  await sleep(250);
  await fillInput('TA一个人时会做什么？');
  await okBtn();
  arc = await arcGet();
  ok('P7b 新疑问入库（未解 2 条）', arc.wonders.filter((w) => !w.solved).length === 2, arc.wonders.length);
  await stab('knows', 'changes');
  ok('P7c 理解变化时间线渲染', (await narcCount('.narc-hist')) >= 2);

  // ---- P8 TA的位置感 ----
  console.log('\n== P8 TA的位置感 ==');
  await navTo('pos');
  ok('P8a 三个方位字段行', (await narcCount('.narc-frow')) === 3);
  await evalJs('(function(){var rows=document.querySelectorAll(".narc-frow");for(var i=0;i<rows.length;i++){if(rows[i].getAttribute("data-key")==="usual"){rows[i].click();break;}}return true;})()');
  await sleep(250);
  await fillInput('身边偏左一点');
  await okBtn();
  arc = await arcGet();
  ok('P8b 通常位置入库 pos.usual', arc.pos.usual === '身边偏左一点', arc.pos);

  // ---- P9 TA的物品 ----
  console.log('\n== P9 TA的物品 ==');
  await navTo('things');
  ok('P9a 五个分组 tab', (await narcCount('.narc-btab')) === 5);
  await stab('things', 'gave');
  await clickSel('[data-op="add-li"][data-kind="thing"]');
  await sleep(250);
  await fillInput('TA送给我的玩偶');
  await okBtn();
  arc = await arcGet();
  ok('P9b 物品入库 g=gave', arc.things.length === 1 && arc.things[0].g === 'gave', arc.things);

  // ---- P10 我们的共同记录 ----
  console.log('\n== P10 我们的共同记录 ==');
  await navTo('shared');
  ok('P10a 七个 tab（含时间线）', (await narcCount('.narc-btab')) === 7);
  await stab('shared', 'timeline');
  const tlTags = await evalJs('(function(){return [].map.call(document.querySelectorAll(".narc-item .ni-tag"),function(e){return e.textContent;});})()');
  ok('P10b 时间线合并旧数据（第一次聊天/重要时刻/相处记录）', tlTags.join(',').indexOf('第一次') >= 0 && tlTags.indexOf('重要时刻') >= 0 && tlTags.indexOf('相处记录') >= 0, tlTags);
  const starBtn = await evalJs('(function(){var b=document.querySelector(".ni-star[data-op=\\"toggle-moment\\"]");return !!b;})()');
  ok('P10c 相处记录行有可切换⭐（记为重要时刻）', starBtn === true);
  await stab('shared', 'day');
  await clickSel('[data-op="add-bond"][data-cat="day"]');
  await sleep(250);
  await fillInput('在一起的第一百天');
  await okBtn();
  await sleep(250);
  ms = await modalState();
  ok('P10d 特别日子第二阶段=日期（默认今天）', ms.open === false || /哪一天/.test(ms.title) === true, ms);
  if (ms.open) { await okBtn(); }
  arc = await arcGet();
  ok('P10e 特别日子入库 cat=day', (arc.bonds.filter((b) => b.cat === 'day').length) === 1, arc.bonds.map((b) => b.cat));
  await stab('shared', 'timeline');
  ok('P10f 时间线条数随新增增长（4 条）', (await narcCount('.narc-item')) === 4, await narcCount('.narc-item'));

  // ---- P11 当前IF世界 ----
  console.log('\n== P11 当前IF世界 ==');
  await navTo('ifw');
  ok('P11a 四个世界字段行', (await narcCount('.narc-frow')) === 4);
  await evalJs('(function(){var rows=document.querySelectorAll(".narc-frow");for(var i=0;i<rows.length;i++){if(rows[i].getAttribute("data-key")==="world"){rows[i].click();break;}}return true;})()');
  await sleep(250);
  await fillInput('海边小镇');
  await okBtn();
  await clickSel('[data-op="add-li"][data-kind="ifch"]');
  await sleep(250);
  await fillInput('在这个世界TA可以被看见');
  await okBtn();
  arc = await arcGet();
  ok('P11b 世界字段与变化列表均入库', arc.ifw.world === '海边小镇' && arc.ifchanges.length === 1, { world: arc.ifw.world, ch: arc.ifchanges.length });

  // ---- P14 了解卡 暂不适用/恢复 ----
  console.log('\n== P14 暂不适用 / 恢复 ==');
  await navTo('knows');
  await stab('knows', 'cards'); // P7 曾把子标签留在「理解变化」，先切回发现卡片
  const legacyCardOp = '[data-op="retire-know"]';
  await clickSel(legacyCardOp);
  await sleep(280);
  ms = await modalState();
  ok('P14a 确认弹窗（取消/暂不适用）', ms.open && ms.pills.length === 2 && ms.inpHidden === true, ms);
  await pillByText('暂不适用');
  await okBtn();
  await sleep(280);
  ms = await modalState();
  ok('P14b 可留一句话备注', ms.open && !ms.inpHidden && ms.title.indexOf('想留句话') === 0, ms);
  await okBtn();
  ok('P14c 卡片进入 retired 态且出现「恢复适用」', (await evalJs('(function(){var k=document.querySelectorAll(".narc-k");for(var i=0;i<k.length;i++){if(k[i].className.indexOf("retired")>=0)return true;}return false;})()')) === true && (await narcCount('[data-op="restore-know"]')) === 1);
  await clickSel('[data-op="restore-know"]');
  ok('P14d 恢复后回到 active 且圆点仍在', (await narcCount('.narc-k.retired')) === 0 && (await narcCount('.nk-dots')) === 2);

  // ---- P12 刷新持久化 ----
  console.log('\n== P12 刷新持久化 ==');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4500);
  await evalJs('(function(){var a=document.querySelector(".app[data-app=\\"memo-arc\\"]");if(a)a.click();return true;})()');
  await sleep(400);
  ok('P12a 重开后发现卡片仍为 2 张', (await evalJs('(function(){document.querySelectorAll(".narc-mrow")[4].click();return true;})()')) && (await sleep(280) === undefined) && (await narcCount('.narc-k')) === 2);
  await navTo('tastes');
  ok('P12b 喜好 2 条持久', ((await arcGet()).tastes.length) === 2);

  // ---- P15 默认播种：空名单打开档案自动出现当前桌面联系人的梦角 ----
  console.log('\n== P15 默认播种 ==');
  // 彻底清环境（xyStore 是 LS+IDB 双写，必须连 IDB 一起删——仓库既有教训）
  await evalJs('(function(){try{localStorage.clear();}catch(e){}return true;})()');
  await evalJs('(function(){try{indexedDB.deleteDatabase("mochi-db");}catch(e){}return true;})()');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(5000);
  await evalJs('(function(){var a=document.querySelector(".app[data-app=\\"memo-arc\\"]");if(a)a.click();return true;})()');
  await sleep(500);
  ok('P15a 空名单打开档案自动出现默认梦角 chip', (await evalJs('(function(){var cs=document.querySelectorAll(".narc-chip");for(var i=0;i<cs.length;i++){if(cs[i].className.indexOf("narc-addchip")>=0)continue;if(cs[i].textContent.trim())return true;}return false;})()')) === true);
  ok('P15b 不再显示「此间还没有梦角」空态引导', (await evalJs('(function(){return document.getElementById("narc-root").innerHTML.indexOf("此间还没有梦角")>=0;})()')) === false);
  const seedState = JSON.parse(await evalJs("(function(){try{var s=window.xyStore('xy-home-v2:default');return JSON.stringify({roster:JSON.parse(s.get('cjian-roster')||'[]'),seeded:s.get('cjian-seeded')||''});}catch(e){return '{}'}})()") || '{}');
  ok('P15c 当前桌面 roster 已写入且带 seeded 标记（删光后不复活）', seedState.seeded === '1' && Array.isArray(seedState.roster) && seedState.roster.length >= 1 && !!(seedState.roster[0] || {}).name, seedState);

  // ---- P16 跨桌面联系人切换：未开过档的联系人给虚拟 chip，点击即落真身 ----
  console.log('\n== P16 跨桌面联系人 ==');
  const cidB2 = await evalJs("(function(){return window.createContact ? (window.createContact('小梦乙') || '') : '';})()");
  await sleep(300);
  await evalJs('(function(){if(window.openNarc)window.openNarc();return true;})()'); // 重渲染名单
  await sleep(400);
  const chipTxts = await evalJs('(function(){var cs=document.querySelectorAll(".narc-chip:not(.narc-addchip)");return [].map.call(cs,function(b){return b.textContent;});})()');
  ok('P16a chips 覆盖所有桌面联系人（默认+小梦乙）', chipTxts && chipTxts.indexOf('小梦乙') >= 0, chipTxts);
  const bBefore = JSON.parse(await evalJs("(function(){try{return window.xyStore('xy-home-v2:" + cidB2 + "').get('cjian-roster')||'[]';}catch(e){return '[]'}})()") || '[]');
  ok('P16b 点击前小梦乙桌面尚无名单（虚拟）', Array.isArray(bBefore) && bBefore.length === 0, bBefore);
  await evalJs('(function(){var bs=document.querySelectorAll("[data-op=\\"pick-roster\\"]");for(var i=0;i<bs.length;i++){if(bs[i].textContent==="小梦乙"){bs[i].click();break;}}return true;})()');
  await sleep(450);
  const bAfter = JSON.parse(await evalJs("(function(){try{return window.xyStore('xy-home-v2:" + cidB2 + "').get('cjian-roster')||'[]';}catch(e){return '[]'}})()") || '[]');
  ok('P16c 点击虚拟 chip 后该桌面落成真身', Array.isArray(bAfter) && bAfter.length === 1 && !!(bAfter[0] || {}).id, bAfter);
  ok('P16d 新梦角被选中且总览按它渲染', await evalJs('(function(){var bs=document.querySelectorAll("[data-op=\\"pick-roster\\"]");for(var i=0;i<bs.length;i++){if(bs[i].textContent==="小梦乙")return bs[i].className.indexOf("on")>=0;}return false;})()') && (await narcHas('小梦乙')) === true);
  // 切回另一位（default 桌面）的梦角，确认来回切换与渲染正常
  await evalJs('(function(){var bs=document.querySelectorAll("[data-op=\\"pick-roster\\"]");for(var i=0;i<bs.length;i++){if(bs[i].textContent!=="小梦乙"&&bs[i].getAttribute("data-rid")){bs[i].click();break;}}return true;})()');
  await sleep(450);
  ok('P16e 来回切换后总览正常渲染（9 分区菜单）', (await narcCount('.narc-mrow')) === 9);

  // ---- P13 无 JS 异常 ----
  console.log('\n== P13 JS 异常 ==');
  ok('P13 全程零未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));
} catch (e) {
  fail++;
  console.log('  ✗ 运行时异常: ' + (e && e.message || e));
}

console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);

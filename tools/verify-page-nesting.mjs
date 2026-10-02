// ===== 回归脚本：全屏子页结构嵌套（.page 不得被另一个 .page 吞掉）=====
// 背景（用户报障，多机型同现、「其他设备型号也有」）：聊天页右上角【聊天设置】打开后整页纯白；
//   实测影响面更大——房间/群聊/此间/漂流瓶/梦角档案/我的档案/心情 共 8 个子页全部 0×0 白屏。
//
// 根因（src/template.html 结构性回归，零机型分支，所有浏览器必现）：
//   108b918 删聊天页问TA半框 #chat-ask-actions 里三按钮时，把 #chat-ask-panel 自身的闭合 </div> 一并删掉；
//   #471 恢复了按钮却漏恢复那个闭合 → #chat-ask-panel 一直未闭合 → HTML 解析把其后的全部 .page
//   （此间/房间/漂流瓶/梦角档案/心情/我的档案/群聊/聊天设置）吞进 #page-chat 内部。
//   而全站的切页写法是「先把所有未隐藏的 .page 置 hidden，再显示目标页」——父级 #page-chat 被隐藏时，
//   嵌套的子页随父级 display:none 联动不可见 = 打开即纯白（.page{flex:1} 也无处可撑）。
//   与 #467（tabbar 被嵌进 page-chat 内部后桌面底部导航消失）同一族：**结构嵌套 = 父级联动隐藏**。
//
// 修复：src/template.html 补齐第 3 个闭合 </div>（最小改动，不动任何逻辑）。
//
// 本脚本的判别力（为什么值得长期留着）：
//   ① 该族已复发 3 次（#467 tabbar / #471 按钮 / #474 整个半框未闭合），症状是「纯白」或「整块消失」——
//      用户看得见、开发者容易只改文案或只改按钮，修一半（改了 src 没重建 / 闭合并错位置）就复发。
//      build.mjs 哨兵只证「模板里有这几个闭合」，证不了「产物里 .page 真的挂在 .phone 下」——
//      2026-09-14 实测：坏产物上 #474 哨兵照样命中（本脚本 RED 基线里 S2 是绿的）。
//   ② 断言分层递进：S1/S2 静态闭合锚 → B1/B2/B2b/B2c 结构不变量（B2b「父级必须是 .phone」是核心捕获点）
//      → B3 八个子页逐个打开测几何 → B4 真实入口端到端（点 #chat-settings-btn）→ B5 .tabbar 归属。
//      只把 src 修好没重建、或闭合并到别处把 .phone 提前关掉，B2b/B3/B4b 都会红（RED 基线 11 通过/10 失败）。
//   ③ 两个视口各跑一轮（390×844 / 360×640）：结构病与尺寸无关，但窄屏是「子页掉出 .phone」最易露馅的尺寸。
//
// #477 追加（2026-09-14，同族第二次复发后按「复发≥2 次必须配行为断言」规则补）：
//   810ab22 给 chat-ask-panel 补第 3 个闭合（#474，本身正确）后，tabbar 块被留在 .phone 真闭合
//   （sm-float 之后 2 空格缩进行）之外＝body 直子——body 是 flex 横排居中（#301 同机理），
//   tabbar 作为 .phone 的下一个 flex 项被排到手机壳右侧＝红米 K80 Chrome 等多机型
//   「底部导航跑到右侧」（无头 390 宽实测 w=118/left=331/底缘 459，整壳同时被推左）。
//   #467 旧哨兵只锚注释文字（位置哑哨兵）、B5 只断言「不在任何 .page 内」，都抓不住「掉出 .phone」。
//   新增：S3/S4/S5 静态位置锚 + B5b 父元素必须是 .phone 直子 + B5c 桌面页 tabbar 全宽贴底几何。
//   判别力实证：修复前本脚本 S3/S5/B5b×2/B5c×2 共 6 红；修复重建后 46/46 全绿。
//
// 用法（收口后）：node build.mjs && node tools/verify-page-nesting.mjs
// 用法（预收口验证隔离构建）：SERVE_ROOT=<隔离构建目录> node tools/verify-page-nesting.mjs
// 断言数：46（静态 5 + 两轮 × 20 + 终态 1）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root); // SERVE_ROOT=隔离构建目录；normalize 统一 Windows 分隔符，否则 403
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— #474 涉及的全屏子页（chat-settings 为用户报障页，其余为实测同现页）——
const PAGES = [
  ['page-chat-settings', '聊天设置'],
  ['page-room', '房间'],
  ['page-group-chat', '群聊'],
  ['page-cjian', '此间'],
  ['page-drift', '漂流瓶'],
  ['page-memo-arc', '梦角档案'],
  ['page-my-arc', '我的档案'],
  ['page-mood', '心情'],
];

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { console.error('SRV403', req.url); res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { console.error('SRVERR', req.url, e.message); try { res.writeHead(404); res.end('nf'); } catch (e2) { console.error('SRVHEADERR', e2.message); } }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 100)); // verify-suite 并发时由 runner 下发空闲端口
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-nest-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
          if (m.method === 'Runtime.exceptionThrown') { jsErrors++; console.error('EXC', JSON.stringify(m.params.exceptionDetails).slice(0, 300)); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0, skip = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
function note(name, detail) { skip++; console.log('  ⚠ SKIP', name, detail || ''); }

// —— S1 静态锚：src/template.html 里 chat-ask-panel 的三层闭合必须在位 ——
// 缺任何一个闭合（即上溯到 108b918 的 2 个闭合形态）＝ #474 复发。
// 注意：src 一律从仓库根读（SERVE_ROOT 指向隔离构建目录时，那里没有 src）。
const tplSrc = (() => { try { return readFileSync(join(__root, 'src', 'template.html'), 'utf8'); } catch (e) { return ''; } })();
chk('S1 源码 chat-ask-panel 三层闭合锚（3 个连续 </div> 缩进 10/8/6 接寻踪注释）',
  tplSrc.indexOf('</button>\n          </div>\n        </div>\n      </div>\n') >= 0);
// S2：被测产物里也带同一段（廉价交叉核对）。**本项只是补充锚，抓不住全部形态**——
// 2026-09-14 实测：产物在此锚存在的前提下，因别处多出一个 </div> 把 .phone 提前关掉，
// 8 个子页掉到 body、宽度算成 0 依旧白屏；那类形态只有下面的 B2b（浏览器实测父级）才抓得住。
const prodHtml = (() => { try { return readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } })();
chk('S2 产物 index.html 同步包含 chat-ask-panel 三层闭合锚',
  prodHtml.indexOf('<button class="cc-tool" id="chat-ask-ok">发送</button>\n          </div>\n        </div>\n      </div>\n') >= 0);

// —— S3/S4/S5 静态位置锚（#477）：tabbar 必须整体位于 .phone 闭合 </div> 之前 ——
// 位置用「tabbar 闭合(2 空格) → .phone 闭合(2 空格) → #477 移除说明注释」三行序列表达：
// tabbar 被移出 .phone（无论向前还是向后）、重嵌进任何 .page、.phone 闭合被多补/少补，
// 该序列即消失。缩进即结构（#476 教训）；改 tabbar 区缩进必须同步本锚与 build.mjs #477 哨兵。
// ⚠ 序列必须以 \n 开头锚定行首：不带 \n 时 `  </div>` 会被 `      </div>`（6 空格缩进闭合）
// 的尾部命中（2026-09-14 实测坏产物上假绿）——「缩进锚」必须含行首才算数。
const TAB_SEQ = '\n  </div>\n  </div>\n\n<!-- （#477）tabbar 原先位于本注释处';
const tplTabOpen = tplSrc.indexOf('<div class="tabbar">');
chk('S3 源码 tabbar 在 .phone 闭合之前（tabbar→.phone 闭合→#477 注释 位置序列在位且顺序正确）',
  tplTabOpen >= 0 && tplSrc.indexOf(TAB_SEQ) >= 0 && tplTabOpen < tplSrc.indexOf(TAB_SEQ));
chk('S4 源码 tabbar 块唯一（出现多副本＝结构已乱）',
  (tplSrc.match(/class="tabbar"/g) || []).length === 1);
chk('S5 产物 index.html 同步包含 tabbar 位置序列', prodHtml.indexOf(TAB_SEQ) >= 0);

// —— 关开屏（clock.js 门控：滑到底 + 点「点击进入」，失败则强制隐藏夹具兜底）——
// 抽成函数：第二轮 360×640 视口复测要再跑一遍（不同机型尺寸同验，防只测一个尺寸蒙过）
async function closeSplash(prefix) {
  let splashClosed = false;
  for (let i = 0; i < 30 && !splashClosed; i++) {
    const s = await evalJs(`(function(){
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
        var men = document.getElementById('splash-mandatory-enter');
        if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
        return 'mwait';
      }
      var sp = document.getElementById('splash');
      if (!sp || sp.classList.contains('hide')) return 'closed';
      var sb = document.getElementById('splash-box');
      if (sb) sb.scrollTop = sb.scrollHeight;
      var se = document.getElementById('splash-enter');
      if (se && !se.disabled) { se.click(); return 'clicked'; }
      return 'wait';
    })()`);
    splashClosed = s === 'closed';
    if (!splashClosed) await sleep(300);
  }
  if (!splashClosed) {
    await evalJs(`(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men)men.click();mm.hidden=true;}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()`);
    await sleep(500);
  }
  const spFinal = await evalJs(`(function(){var sp=document.getElementById('splash');return sp?sp.classList.contains('hide')||sp.hidden:true;})()`);
  chk('前置 ' + prefix + '开屏已关闭（可进入应用）', spFinal === true, 'spFinal=' + String(spFinal));
  await sleep(400);
}
await closeSplash('');

// —— 结构不变量 / 几何 / 真实入口：按视口各跑一轮（防只测一个尺寸蒙过，对齐 verify.mjs 双尺寸惯例）——
// B1/B2 结构不变量：.page 一律是 .phone 的直子，且没有任何 .page 被另一个 .page 吞掉
// B3 行为：用与全站一致「隐藏其它 .page → 显示目标页」的写法逐页打开，几何必须 > 0
//   （修复前：子页嵌在 page-chat 内 → 父级 hidden 联动 display:none → 0×0 纯白；或子页掉到 body → 宽度 0）
// B4 真实入口端到端：进聊天 → 点右上角【聊天设置】→ 设置页必须可见且有实际内容
const STRUCT_JS = `(function(){
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var nested = pages.filter(function(p){ return !!p.parentElement && p.parentElement.closest('.page'); })
    .map(function(p){ return p.id + '@' + (p.parentElement.closest('.page').id || '?'); });
  var chat = document.getElementById('page-chat');
  var chatNest = chat ? chat.querySelectorAll('.page').length : -1;
  var badParent = pages.filter(function(p){ return p.id !== 'page-phone' && (!p.parentElement || !p.parentElement.classList.contains('phone')); })
    .map(function(p){ return p.id + '→' + (p.parentElement ? (p.parentElement.id || p.parentElement.tagName) : 'null'); });
  return { total: pages.length, nested: nested, chatNest: chatNest, badParent: badParent,
           hasChat: !!chat, hasSettings: !!document.getElementById('page-chat-settings') };
})()`;
const geomJs = (id) => `(function(){
  var pages = document.querySelectorAll('.page');
  for (var i = 0; i < pages.length; i++) { if (!pages[i].hidden) pages[i].hidden = true; }
  var el = document.getElementById(${JSON.stringify(id)});
  if (!el) return null;
  el.hidden = false;
  var r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(el).display !== 'none' };
})()`;
const CS_OPEN_JS = `(function(){
  var b = document.getElementById('chat-settings-btn');
  if (!b) return 'no-btn';
  var ca = document.getElementById('page-chat');
  if (ca) ca.hidden = false;
  b.click();
  return 'clicked';
})()`;
const CS_STATE_JS = `(function(){
  var pg = document.getElementById('page-chat-settings');
  if (!pg) return null;
  var r = pg.getBoundingClientRect();
  var ca = document.getElementById('page-chat');
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    visible: !pg.hidden && getComputedStyle(pg).display !== 'none',
    chatHidden: ca ? ca.hidden : null,
    kidCount: pg.querySelectorAll('*').length
  };
})()`;
const TB_JS = `(function(){
  var t = document.querySelector('.tabbar');
  if (!t) return { miss: true };
  var p = t.parentElement;
  return { inPage: !!t.closest('.page'), isPhoneChild: !!(p && p.classList && p.classList.contains('phone')),
           parent: p ? (p.className || p.id || p.tagName) : null };
})()`;
// B5c 几何（#477）：必须在「回桌面页」复位之后取——桌面页可见时 tabbar 才显示。
// 期望（@media≤900px 路径，.phone padding 0 18px 18px）：宽=视口−36（>300）、左缘=18、
// 底缘=.phone 底−18（headless 安全区为 0）。掉 body 层时宽塌缩成内容宽（~118px）且被
// flex 横排推到 .phone 右侧（左缘 > 视口宽或远大于 18）＝本断言红。
const TB_GEOM_JS = `(function(){
  var t = document.querySelector('.tabbar');
  var ph = document.querySelector('.phone');
  if (!t || !ph) return null;
  var r = t.getBoundingClientRect(), pr = ph.getBoundingClientRect();
  return { hidden: !!t.hidden, w: Math.round(r.width), left: Math.round(r.left),
           bottom: Math.round(r.bottom), expLeft: Math.round(pr.left + 18),
           expBottom: Math.round(pr.bottom - 18), vw: document.documentElement.clientWidth };
})()`;

async function runRound(tag) {
  const struct = await evalJs(STRUCT_JS);
  console.log('STRUCT[' + tag + '] ' + JSON.stringify(struct));
  chk(tag + 'B1 存在足够数量的 .page 且 page-chat / page-chat-settings 都在', !!struct && struct.total >= 50 && struct.hasChat && struct.hasSettings, JSON.stringify(struct && struct.total));
  chk(tag + 'B2 没有任何 .page 被另一个 .page 吞掉（#474 根因不变量）', !!struct && struct.nested.length === 0, JSON.stringify(struct && struct.nested));
  chk(tag + 'B2b 除 page-phone 外所有 .page 的父元素都是 .phone 直子', !!struct && struct.badParent.length === 0, JSON.stringify(struct && struct.badParent));
  chk(tag + 'B2c #page-chat 内部 .page 后代数为 0（8 子页不再被吞）', !!struct && struct.chatNest === 0, 'chatNest=' + String(struct && struct.chatNest));

  for (const [id, label] of PAGES) {
    const g = await evalJs(geomJs(id));
    chk(tag + 'B3 ' + label + '（#' + id + '）打开后渲染几何 > 0', !!g && g.w > 0 && g.h > 0 && g.vis === true, JSON.stringify(g));
  }
  // 复位到桌面页
  await evalJs(`(function(){var pages=document.querySelectorAll('.page');for(var i=0;i<pages.length;i++){if(!pages[i].hidden)pages[i].hidden=true;}var ph=document.getElementById('page-phone');if(ph)ph.hidden=false;return true;})()`);
  await sleep(300);

  await evalJs('window.enterChat && window.enterChat(); true');
  await sleep(1200);
  const btn = await evalJs(CS_OPEN_JS);
  await sleep(600);
  const cs = await evalJs(CS_STATE_JS);
  console.log('CSSTATE[' + tag + '] ' + JSON.stringify(cs), 'btn=' + btn);
  chk(tag + 'B4 点聊天页右上角【聊天设置】→ 设置页可见（非隐藏且 display 非 none）', !!cs && cs.visible === true, JSON.stringify(cs));
  chk(tag + 'B4b 聊天设置页渲染几何 > 0 且占满视口宽', !!cs && cs.w > 300 && cs.h > 100, JSON.stringify(cs));
  chk(tag + 'B4c 聊天设置页 DOM 内容已渲染（存在子节点，非空壳）', !!cs && cs.kidCount > 10, 'kids=' + String(cs && cs.kidCount));
  chk(tag + 'B4d 打开子页时 page-chat 已隐藏（全屏页切换语义）', !!cs && cs.chatHidden === true, JSON.stringify(cs && cs.chatHidden));

  // B5/B5b #467/#477 同族防回归：.tabbar 必须在 .phone 内、所有 .page 之外
  const tb = await evalJs(TB_JS);
  chk(tag + 'B5 .tabbar 不在任何 .page 内部（#467 同族：嵌进 page 会随 hidden 消失）', !!tb && tb.miss !== true && tb.inPage === false, JSON.stringify(tb));
  chk(tag + 'B5b .tabbar 父元素必须是 .phone 直子（#477：掉出 .phone 落 body 层＝flex 横排把它排到手机壳右侧）', !!tb && tb.miss !== true && tb.isPhoneChild === true, JSON.stringify(tb));
  // 回桌面页，准备下一轮
  await evalJs(`(function(){var pages=document.querySelectorAll('.page');for(var i=0;i<pages.length;i++){if(!pages[i].hidden)pages[i].hidden=true;}var ph=document.getElementById('page-phone');if(ph)ph.hidden=false;return true;})()`);
  await sleep(300);
  // B5c #477 几何：桌面页上 tabbar 必须全宽贴底可见（掉 body 层＝宽塌缩+被推到壳右侧）
  const tbG = await evalJs(TB_GEOM_JS);
  chk(tag + 'B5c 桌面页 tabbar 几何：全宽贴底（宽>300、左缘≈.phone内容左缘、底缘≈.phone底−18）',
    !!tbG && tbG.hidden === false && tbG.w > 300 && Math.abs(tbG.left - tbG.expLeft) <= 2 && Math.abs(tbG.bottom - tbG.expBottom) <= 2, JSON.stringify(tbG));
}

await runRound('[390×844] ');

// —— 第二轮 360×640：更矮的窄屏是「子页掉出 .phone」最容易露馅的尺寸（tabbar/状态栏占比更高）——
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
await closeSplash('[360×640] ');
await runRound('[360×640] ');

const jsErrCount = await evalJs('(window.__jsErrors && __jsErrors.length) || 0');
chk('终态 无未捕获 JS 异常', jsErrCount === 0 && jsErrors === 0, 'cdp=' + String(jsErrors) + ' app=' + String(jsErrCount));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('（作用域：' + (process.env.SERVE_ROOT ? 'SERVE_ROOT=' + process.env.SERVE_ROOT : '仓库根目录产品') + '）');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过');
process.exit(fail ? 1 : 0);

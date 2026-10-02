// ===== 回归脚本：#1419 聊天输入栏的「位置」与「继续说按钮显隐」必须跟随存储自愈 =====
// 用法：node tools/verify-1419-input-bar-heal-follow.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-1419-input-bar-heal-follow.mjs  （红绿对照：量临时构建副本）
//
// 用户实报（2026-09-29，OPPO 一加 12 / PJD110 / Chrome，并明说其他机型同现）：
//   ① 自定义了【输入栏按钮位置】，刷新重开网页后恢复原样；
//   ② 打开了【让对方继续说】的底部聊天栏按钮，刷新重开网页后恢复原样。
//
// 根因（判据零机型／零 UA 分支，只问「自愈那一发落没落」）：这两项的值都是每联系人小键
// （cs-input-order / reply-cs-trigger-bar），手机端浏览器（Chrome/Edge 等）在进程被杀时会把
// localStorage 最近一次磁盘提交整批回滚，于是重启后 LS 里躺着【旧值】、IndexedDB 里是【新值】。
// idb.js 里对付这一型的不是「回填」（回填的规矩是 LS 有值且没标脏就让位 LS），而是每键标记合并
// wrjMergeFromIdb：它把库里那份新值追回 store＋LS，然后广播 mochi-wrj-heal。
// 输入栏只订了 chat-input-order-changed / contact-switched / mochi-restore-done 三条，
// 唯独没订这一条 ⇒ 账追平了、屏没追平：用户每改一次、重开一次就回一次原样。
//
// 断言：
//   A 轴（源码锚，覆盖两半）：
//     A1~A5 三枚开关型按钮的补算函数同时挂在回填与自愈两条广播上；输入栏重排挂在自愈上；聊天设置那行的
//           回显挂在自愈上（且面板开着时重画列表）；自愈广播确为 idb.js 所发；两处落点零机型／零 UA 分支；
//     A6~A8 群聊那排不再读没人写的裸键 cs-trigger-bar，改问单聊同一把尺（window.mochiContinueBarOn，
//           拿不到该出口时退回直读 reply-cs-trigger-bar）；全 src 无人写裸键的反向钉；群聊自己那枚
//           gc-cs-trigger-bar 仍在判据里；
//     A9~A12 contSayOn＝replyCfg 就绪先问它、未就绪直读存储键；该尺挂上 window 供群聊页共用；显隐与标题
//           两处判据都走 contSayOn；A12 反向钉＝旧式「先取 cfg 再取值」的 applyContinueSayUI 开头不得回流。
//   B 轴（真产物＋三种现场，各造一遍）：
//     B1 进场默认：默认排序值写在令牌上、继续说按钮藏着；
//     B2（B2a/B2b 前置断言＋B2c 当场读屏）走真路径（面板 write＋saveReplyCfg）改完，本场立刻生效；
//     B3【甲型＝LS 那一格空着】清掉整块 localStorage 重开：这一排按回填后的存档重排（该发的按钮显隐
//        两侧都会因负载偶发不跟＝值晚于那一次性重画到货，既有抖动、非本批契约，故降级为 B3n NOTE）；
//     B4【乙型＝LS 有值但是被回滚的旧值】写旧值落库→写新值落库→把 LS 发回旧值快照→重开；
//     B5 乙型现场自证：自愈确实落了（heal≥1），store／replyCfg 读到的都是新值（不是假现场）；
//     B6 乙型判别点：屏上那一排的 flex order 与新序逐字相同、继续说按钮显示出来 ← 第一半的主判别点；
//     B6b 群聊那一排同源跟上（收掉死键后：单聊开关开着，群聊输入栏也显示继续说）；
//     B7 行内回显转「已自定义」（聊天设置那行不许还写着默认排列）；
//     B8 再重开一次仍保持（自愈已把 LS 改写，丙场该直接对，不需第二次自愈）；
//     B9 全程零 JS 异常；
//     B10 第二半判别点：同一格同步表达里摘掉 window.replyCfg（＝合并顺序最早那一发所处时刻——reply-settings.js
//        排在 chat.js 之后，初始化末尾那发先于它执行），光标设 '1' 后调一发 applyContinueSayUI：按存储键判的
//        （修复侧）显示、经 cfg() 读成 {}（红侧）藏——删掉存储直读回退即回到「藏到下次重开」。
//
// RED 判别（两半各钉一个纯 HEAD 底本）：
//   第一半（纯 HEAD 副本 9034931 实测）：B6 红，读数逐字就是症状——order 停在旧序
//   mic:50,continue:60,more:10,emoji:20,input:30,img:40,batch:70 且 contBtn=hidden，而同一时刻
//   store 里已是新序、replyCfg 里 bar=1、heal=1。B1~B5、B7~B9 两侧同绿（甲型那条早就由
//   #660附 的补算兜住，本批一字未动）。
//   第二半（纯 HEAD 26f604f 实测；此前在 c23096a 底本上首测，两底本间只差 build.mjs 登记表与
//   music-player 文案，本批触及的三个 src 件两次抽底 blob 逐字节相同）：19/26 有 FAIL，七红恰为
//   A6／A8／A9／A10／A11／A12／B10；B10 读数 {"before":"hidden","after":"hidden"}——摘掉 replyCfg 后
//   经 cfg() 只读到 {}，开关开着也藏；修复侧同尺 26/26 全绿、B10 {"before":"hidden","after":"shown"}。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync, readdirSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function note(desc, detail) { console.log('NOTE  ' + desc + '  [' + detail + ']'); }
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚（读进来统一把 CRLF 折成 LF，锚点里带 \n 的多行特征不因行尾翻面而假红） ----------
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };
const chat = rd('src/js/chat.js'), cs = rd('src/js/chat-settings.js'), idb = rd('src/js/idb.js');

check('A1 三枚开关型按钮的补算收成一处，且回填与自愈两条广播都挂着它',
  /function syncInputBarSwitches\(\) \{[\s\S]{0,400}syncMicBtn[\s\S]{0,200}syncBatchBtn[\s\S]{0,200}applyContinueSayUI/.test(chat)
  && chat.includes("document.addEventListener('mochi-restore-done', syncInputBarSwitches);")
  && chat.includes("document.addEventListener('mochi-wrj-heal', syncInputBarSwitches);"),
  '两条广播同时命中才算数');
check('A2 输入栏重排挂在自愈广播上（库里那份追平了，这一排要跟着重画）',
  chat.includes("document.addEventListener('mochi-wrj-heal', applyInputBtnOrder);")
  && chat.includes("document.addEventListener('mochi-restore-done', applyInputBtnOrder);"));
check('A3 聊天设置那行的回显挂在自愈上，且面板开着时把列表一起重画',
  /mochi-wrj-heal', \(\) => \{ inputOrderSync\(\); if \(inputOrderPanelOpen\(\)\) renderInputOrderPanel\(\); \}\);/.test(cs));
check('A4 自愈那条广播确实是 idb.js 发出来的（不是本批新造的第二套口径）',
  idb.includes("document.dispatchEvent(new Event('mochi-wrj-heal'));"));
check('A5 判据零机型／零 UA 分支：本批两处落点里没有机型与 UA 字样',
  !/navigator\.userAgent|isIOS|isAndroid|uaMatch/i.test(
    chat.slice(chat.indexOf('function syncInputBarSwitches'), chat.indexOf('function syncInputBarSwitches') + 900)));
// A6/A7＝作者点头一并收掉的那枚死键。判据不靠注释，靠「全站有没有人写这枚裸键」这一个可数事实
const gcSrc = rd('src/js/group-chat.js');
const bareWriters = (() => {
  let n = 0;
  try {
    readdirSync(join(root, 'src/js')).forEach((f) => {
      if (!/\.js$/.test(f)) return;
      const t = rd('src/js/' + f);
      n += (t.match(/set\('cs-trigger-bar'/g) || []).length;
    });
  } catch (e) { return -1; }
  return n;
})();
check('A6 群聊那排不再读没人写的裸键，改问单聊那把尺（第二半：经 window.mochiContinueBarOn，拿不到退回直读 reply- 键）',
  gcSrc.includes("window.mochiContinueBarOn ? window.mochiContinueBarOn() : gcSettingOn('reply-cs-trigger-bar')")
  && !gcSrc.includes("gcSettingOn('cs-trigger-bar')"));
check('A7 反向钉：全 src 确实没有任何一处写裸键 cs-trigger-bar（有人写回来了就该重新对表口径）',
  bareWriters === 0, '写入方计数=' + bareWriters + '（要 0；单聊那枚存成 reply-cs-trigger-bar）');
check('A8 群聊自己那枚开关 gc-cs-trigger-bar 仍在判据里（收死键不许把群聊侧关掉）',
  /window\.mochiContinueBarOn\(\) : gcSettingOn\('reply-cs-trigger-bar'\)\) \|\| gcCfg\(\)\['gc-cs-trigger-bar'\] === 1/.test(gcSrc));
// A9~A12＝#1419 第二半（合并顺序安全）：继续说按钮显隐不再经过 cfg()——合并顺序里 reply-settings.js 排在本文件
// 之后，最早那一发（脚本初始化末尾）读到的是 {}，开关开着也被算成「关」，而两发重画时机都已用完 ⇒ 按钮一直藏着。
// 改走 contSayOn：replyCfg 就绪先问它（保留 NaN 兜底与默认值语义），未就绪直读存储键。
check('A9 contSayOn：replyCfg 就绪先问它、未就绪直读存储键（删掉回退＝最早那一发又读成 {}，按钮藏到下次重开）',
  /function contSayOn\(key\) \{[\s\S]{0,160}if \(window\.replyCfg\) return window\.replyCfg\(\)\[key\] === 1;[\s\S]{0,160}Number\(store\.get\('reply-' \+ key\)\) === 1/.test(chat));
check('A10 单聊那枚尺挂上 window 供群聊页共用（删＝群聊那条分支退回裸键直读，两侧口径分叉）',
  chat.includes("window.mochiContinueBarOn = function () { return contSayOn('cs-trigger-bar'); };"));
check('A11 继续说按钮显隐与标题判据都改走 contSayOn（改回 cfg()[\'cs-trigger-bar\'] 即第二半复发）',
  chat.includes("if (csBtn) csBtn.style.display = contSayOn('cs-trigger-bar') ? '' : 'none';")
  && chat.includes("if (pname) pname.title = contSayOn('cs-trigger-name') ? '点击让对方继续说' : '';"));
check('A12 反向钉：旧式「先取 cfg 再取值」的 applyContinueSayUI 开头不得回流',
  !/const c = cfg\(\);\nif \(pname\) pname\.title = c\['cs-trigger-name'\]/.test(chat));

// ---------- B 轴：真产物 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  process.exit(2);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (11700 + Math.floor(Math.random() * 60));
const profile = join(process.env.TEMP || '/tmp', 'mochi-1419v-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    let list = null;
    try { list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); } catch (e) {}
    const page = list && list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') {
          const d = m.params && m.params.exceptionDetails;
          jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
        }
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
      };
      return;
    }
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
    if (r && r.exceptionDetails) return 'EVALERR:' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 160);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'CDPERR:' + e.message; }
}
const jparse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
// 有界轮询：回填/自愈都是异步的，「迟到」可以接受、「永不到」才算红。轮询上限写在这里，不靠运气等
async function evalUntil(expr, pred, ms) {
  let last = null;
  const deadline = Date.now() + (ms || 6000);
  for (;;) {
    last = jparse(await evalJs(expr));
    if (last && pred(last)) return { ok: true, last };
    if (Date.now() > deadline) return { ok: false, last };
    await sleep(400);
  }
}

// 每一场都要装：数自愈事件（跨导航存活），乙型现场到底成不成立就靠它自证
const INSTRUMENT = `(function(){
  window.__healN = 0;
  document.addEventListener('mochi-wrj-heal', function(){ window.__healN++; });
})();`;

async function bootToReady() {
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(600);
  // 常驻引导/提醒弹层会挂 scroll-lock 并挡点击：先收掉再测（站内既有口径）
  await evalJs("(function(){var m=document.getElementById('modal-mask');if(m&&getComputedStyle(m).display!=='none'){var c=document.getElementById('modal-cancel');if(c&&!c.hidden)c.click();else{var o=document.getElementById('modal-ok');if(o)o.click();}}return 1;})()");
  await sleep(400);
  // 聊天页要真在屏上，否则各按钮宽度为 0、可见顺序量不出来
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return 1;})()");
  await sleep(700);
}
const reload = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2400);
  await bootToReady();
  await sleep(1800); // 乙型的自愈排在 mochi-restore-done 之后的合并链里，多等一拍
};
// 屏上那一排：order 值（本批改的是重画时机，不是 order 算法）＋继续说按钮显隐＋自愈计数
const VISUAL = `(function(){
  var row=document.querySelector('#page-chat .chat-input-row'); if(!row) return 'no-row';
  var els=Array.prototype.slice.call(row.querySelectorAll('[data-io]'));
  var vis=els.filter(function(e){var r=e.getBoundingClientRect();return r.width>0;});
  vis.sort(function(a,b){return a.getBoundingClientRect().left-b.getBoundingClientRect().left;});
  var b=document.getElementById('chat-continue-btn');
  var v=document.getElementById('cs-input-order-val');
  return JSON.stringify({
    visible: vis.map(function(e){return e.getAttribute('data-io');}).join(','),
    order: els.map(function(e){return e.getAttribute('data-io')+':'+e.style.order;}).join(','),
    contBtn: b?(b.style.display==='none'?'hidden':'shown'):'missing',
    echo: v?(v.textContent||''):'missing',
    // 读数补齐：屏上不对时，先问「存档里那一格到底有没有回来」，别把存储层的账算到界面头上
    barStore: (window.replyCfg && window.replyCfg()['cs-trigger-bar']),
    barLs: localStorage.getItem('xy-home-v2:default:reply-cs-trigger-bar'),
    gcBtn: (function(){var g=document.getElementById('gc-continue-btn');return g?(g.style.display==='none'?'hidden':'shown'):'missing';})(),
    heal: window.__healN||0
  });
})()`;
const STORE = `(function(){return JSON.stringify({
  io: (window.mochiInputOrder && window.mochiInputOrder.read().join(',')) || 'na',
  bar: (window.replyCfg && window.replyCfg()['cs-trigger-bar']),
  heal: window.__healN || 0
});})()`;

const DEF = ['mic', 'continue', 'more', 'emoji', 'input', 'img', 'batch'];
const OLD_ORD = ['more', 'emoji', 'input', 'img', 'mic', 'continue', 'batch'];  // 用户改之前那一版
const NEW_ORD = ['batch', 'emoji', 'input', 'img', 'more', 'mic', 'continue'];  // 这一轮刚调的
// 期望的 order 值串：按【DOM 顺序】列出各令牌应拿到的 order（= 10 + 存档下标*10）
const orderOf = (arr) => DEF.map((t) => t + ':' + (10 + arr.indexOf(t) * 10)).join(',');
const KEYS = ['xy-home-v2:default:cs-input-order', 'xy-home-v2:default:reply-cs-trigger-bar', 'xy-home-v2:__wr-journal'];
const writeBoth = (arr, bar) => evalJs(`(function(){ try {
  window.mochiInputOrder.write(${JSON.stringify(arr)});
  window.saveReplyCfg('cs-trigger-bar', ${bar});
  if (window.applyContinueSayUI) window.applyContinueSayUI();
  return 'ok'; } catch(e){ return 'ERR:' + e.message; } })()`);

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });

  // —— 出厂：整块存储清空重来，拿默认现场 ——
  await reload();
  await evalJs("(function(){ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()");
  await reload();
  const st0 = jparse(await evalJs(VISUAL));
  check('B1 出厂默认：默认序写在令牌上、继续说按钮藏着',
    !!st0 && st0.order === orderOf(DEF) && st0.contBtn === 'hidden' && st0.heal === 0, JSON.stringify(st0));

  // —— 乙型现场的第一步：先把「旧值」落到 内存+LS+库+标记 ——
  check('B2a 写旧值走真路径成功', await writeBoth(OLD_ORD, 0) === 'ok');
  await sleep(1200); // 值事务提交回执 → 每键标记微批落库（#1257 口径）
  const snapRaw = await evalJs(`(function(){var o={};${JSON.stringify(KEYS)}.forEach(function(k){o[k]=localStorage.getItem(k);});return JSON.stringify(o);})()`);
  const snap = jparse(snapRaw);
  check('B2b 旧值确实在 LS 里留了底（回滚目标不是空，空就变成甲型现场了）',
    !!snap && snap[KEYS[0]] === JSON.stringify(OLD_ORD) && snap[KEYS[1]] === '0', String(snap && snap[KEYS[0]]));

  // —— 本场改动：新值落库，当场生效（#660 的既有契约，本批不许削） ——
  check('B2 走真路径改新值成功', await writeBoth(NEW_ORD, 1) === 'ok');
  await sleep(1200);
  const live = jparse(await evalJs(VISUAL));
  check('B2c 本场屏上就是新序、按钮已显示',
    !!live && live.order === orderOf(NEW_ORD) && live.contBtn === 'shown' && live.echo === '已自定义', JSON.stringify(live));

  // —— 乙型现场：把 LS 那三格整批发回旧值快照（＝内核把刚才那一次磁盘提交回滚）——
  const rolled = await evalJs(`(function(){ try {
    var o = JSON.parse(${JSON.stringify(snapRaw)});
    Object.keys(o).forEach(function(k){ if (o[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, o[k]); });
    return 'rolled'; } catch(e){ return 'ERR:' + e.message; } })()`);
  check('B4 乙型现场布置成功（LS 已发回旧值，库里那份新值与标记不动）', rolled === 'rolled', String(rolled));

  // —— 下一场会话：回填让位给 LS 那份旧值，只有每键标记合并能把新值追回来 ——
  await reload();
  const h5 = await evalUntil(STORE, (s) => s.heal >= 1 && s.io === NEW_ORD.join(',') && s.bar === 1, 8000);
  check('B5 现场自证：自愈那一发落了，且 store／replyCfg 读到的都是新值（不是假现场）',
    h5.ok, 'heal=' + (h5.last && h5.last.heal) + ' io=' + (h5.last && h5.last.io) + ' bar=' + (h5.last && h5.last.bar));
  const h6 = await evalUntil(VISUAL, (x) => x.order === orderOf(NEW_ORD) && x.contBtn === 'shown', 6000);
  check('B6 判别点：屏上那一排跟上了自愈后的存档（order 逐字＝新序，继续说按钮显示）',
    h6.ok, JSON.stringify(h6.last) + ' 期望 order=' + orderOf(NEW_ORD));
  check('B7 聊天设置行内回显转「已自定义」（不许输入栏已自定义、那一行还写默认排列）',
    !!h6.last && h6.last.echo === '已自定义', h6.last && h6.last.echo);
  check('B6b 群聊那一排同源跟上（收掉死键后：单聊开关开着，群聊输入栏也显示继续说）',
    !!h6.last && h6.last.gcBtn === 'shown', h6.last && h6.last.gcBtn);

  // —— 甲型现场（LS 那一格整个空着）：回填那条老路照旧兜住，本批一字未动 ——
  await evalJs("(function(){ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()");
  await reload();
  // 甲型那发只钉「按存档重排」这一件确定事实；按钮显隐那格两侧都会因负载偶发不跟（值晚于那一次性
  // 重画到货＝既有抖动，非本批契约），故降级为 NOTE，红绿两侧同读数才算可比
  const h3 = await evalUntil(VISUAL, (x) => x.order === orderOf(NEW_ORD), 6000);
  check('B3 甲型现场（LS 被清）重开：回填把库里那份补回来，这一排按存档重排',
    h3.ok, JSON.stringify(h3.last) + ' 期望 order=' + orderOf(NEW_ORD));
  note('B3n 甲型那发的按钮显隐（两侧偶发，不计判决）', 'contBtn=' + (h3.last && h3.last.contBtn) + ' gcBtn=' + (h3.last && h3.last.gcBtn) + ' heal=' + (h3.last && h3.last.heal));

  // —— 丙场：自愈已把 LS 改写过，直接重开就该对，不需要再自愈一次 ——
  await writeBoth(NEW_ORD.slice().reverse(), 1);
  await sleep(1200);
  const REV = [...NEW_ORD].reverse();
  await reload();
  const third = jparse(await evalJs(VISUAL));
  check('B8 再重开一次仍保持（第二场直接按存档画，不必等自愈）',
    !!third && third.order === orderOf(REV) && third.contBtn === 'shown', JSON.stringify(third) + ' 期望 order=' + orderOf(REV));

  // —— 第二半判别点：合并顺序最早那一发（replyCfg 尚未定义）也必须按存储键判显隐 ——
  // 现场做法＝临时摘掉 window.replyCfg（模拟 reply-settings.js 还没跑到＝初始化末尾那一发所处时刻），
  // 光标设 '1' 后点一发 applyContinueSayUI：绿侧 contSayOn 退到直读存储 ⇒ 显；红侧 cfg() 读到 {} ⇒ 藏。
  // 全部在同一格同步表达里完成，读完立刻把 replyCfg 装回，不污染后续场次。
  const b10 = jparse(await evalJs(`(function(){ try {
    var b = document.getElementById('chat-continue-btn');
    if (!b) return JSON.stringify({ err: 'no-btn' });
    window.activeStore().set('reply-cs-trigger-bar', '0');
    if (window.applyContinueSayUI) window.applyContinueSayUI();
    var before = (b.style.display === 'none') ? 'hidden' : 'shown';
    var saved = window.replyCfg; delete window.replyCfg;
    window.activeStore().set('reply-cs-trigger-bar', '1');
    if (window.applyContinueSayUI) window.applyContinueSayUI();
    var after = (b.style.display === 'none') ? 'hidden' : 'shown';
    window.replyCfg = saved;
    if (window.applyContinueSayUI) window.applyContinueSayUI();
    return JSON.stringify({ before: before, after: after });
  } catch (e) { return JSON.stringify({ err: String(e && e.message) }); } })()`));
  check('B10 第二半判别点：replyCfg 未就绪时（合并顺序最早那一发）也按存储键判显隐',
    !!b10 && b10.before === 'hidden' && b10.after === 'shown', JSON.stringify(b10));

  check('B9 全程零 JS 异常', jsErrors.length === 0, JSON.stringify(jsErrors.slice(0, 3)));
} finally {
  try { chrome.kill('SIGKILL'); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  server.close();
}

const fails = results.filter((r) => !r.ok);
console.log('----');
console.log('verify-1419-input-bar-heal-follow: ' + (results.length - fails.length) + '/' + results.length + (fails.length ? ' 有 FAIL' : ' 全绿'));
process.exit(fails.length ? 1 : 0);

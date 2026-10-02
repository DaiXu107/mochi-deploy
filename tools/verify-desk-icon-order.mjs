// verify-desk-icon-order.mjs — #265 桌面图标顺序「改完退出浏览器就还原初始布局」回归验证
// 背景（小米13 + Edge 用户报障，明说其他机型同症状）：装修模式里拖动图标改桌面布局后
// 关闭浏览器重开，图标回到默认排布（小组件卡片的 desk-layout 由 #140/#151 的
// mochi-restore-done 重放链覆盖，图标顺序 app-icon-order-* 此前没有任何重放）。
// 三条独立根因（全在 personalize.js，零机型分支）：
//   R1 启动补读无优先级——「自定义图标大键可能只存 IDB」的补读块对 IDB 里所有 app-icon-*
//      键（含 app-icon-order-* / app-icon-opacity-* 这类小键）无条件 store.set 回写。
//      idbSet 是异步 fire-and-forget，Edge/真我/荣耀杀进程或事务挂起时 IDB 落后于
//      localStorage（idb.js retainValue 的同款判据），于是启动时把「陈旧 IDB 值」写进
//      内存缓存 + localStorage，把用户刚保存的新值覆盖掉。本次会话 DOM 已按新值排好
//      （所以用户看不出问题），下一次启动读到的就是被覆盖的旧值 = 「退出浏览器后还原」。
//   R2 图标顺序只在脚本加载期应用一次，mochi-restore-done 之后不重放——LS 副本缺失/
//      配额满/被清理（值只在 IDB）的设备首次同步读空 → 整会话停在默认排布。
//   R3 contact-switched 重应用清单里有 restoreAppIcons（图标图片）没有 restoreAppIconOrder
//      （图标顺序）→ 切桌面顺序互相串。
// 场景（每个场景独立 Chrome 实例 + 独立 profile，多次 Page.navigate 模拟「退出浏览器重开」）：
//   T1 跨重启覆盖链：boot1 落 IDB=OLD → 断掉 IDB 写并改 NEW（=Edge 丢写）→ boot2 屏上是
//      NEW 但存储被陈旧 IDB 回写成 OLD（反向对照）→ boot3 屏上变 OLD = 用户症状
//   T2 LS 失效设备：app-icon-order 与其 __wr-journal 镜像的 LS 写入恒抛 QuotaExceededError、
//      且 IDB 侧 journal 记录读成 undefined（让写自愈机制也帮不上），值只在 IDB →
//      回填完成后必须按 IDB 权威值重排
//   T3 切桌面：两个命名空间各存不同顺序 → setActiveContact 后屏上跟随新桌面
//   T4 不误伤原意图：只在 IDB 的大图标键（>200KB 不进 LS）启动后仍能补回并渲染
// verify-suite:timeout=300000
// 用法：node tools/verify-desk-icon-order.mjs [产物目录]（默认当前仓库根，须已构建；
//       也可用 SERVE_DIR 指向隔离副本做修复前/修复后红绿对照）。
//       调试端口用 --remote-debugging-port=0 由系统自选，不抢 MOCHI_CDP_PORT 区间。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.env.SERVE_DIR || process.argv[2];
const root = normalize(rootArg || dirname(fileURLToPath(import.meta.url)) + '/..');
const indexHtml = join(root, 'index.html');
try { if (!statSync(indexHtml).isFile()) throw new Error('nf'); } catch (e) {
  console.error('找不到 ' + indexHtml + '——请先 node build.mjs（或 SERVE_DIR 指向已构建副本）');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (v) => JSON.stringify(String(v));

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(2); }

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

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
};

const portSeq = { n: 0 };

// 一个浏览器实例 = 一份 profile（LS/IDB 隔离）；boot() 多次导航 = 反复「退出浏览器重开」
async function makeBrowser(initJs) {
  // 端口不能自己挑：本机常驻着其他用途的 Chrome/服务（曾占用随机调试端口，脚本会误连
  // 上别的进程 → no cdp / 连到别人的页面）。--remote-debugging-port=0 让 Chrome 自选，
  // 真实端口从 profile 里的 DevToolsActivePort 文件读，天然无冲突。
  const profile = join(process.env.TEMP || '/tmp', 'mochi-vdico-' + Date.now() + '-' + (portSeq.n++) + '-' + Math.floor(Math.random() * 1e6));
  const proc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'
  ], { stdio: 'ignore' });
  const api = {
    send: null, evl: null, boot: null, kill: () => { try { proc.kill(); } catch (e) {} }
  };
  process.on('exit', api.kill);
  let port = 0;
  for (let i = 0; i < 200 && !port; i++) {
    try {
      const first = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
      const p = Number(String(first).trim());
      if (p > 0) port = p;
    } catch (e) {}
    if (!port) await sleep(100);
  }
  if (!port) { api.kill(); throw new Error('no devtools port'); }
  let ws = null, id = 0; const pend = new Map();
  for (let i = 0; i < 80 && !ws; i++) {
    let page = null;
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) {}
    if (page) {
      let cand = null;
      try {
        cand = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error('ws timeout')), 4000);
          cand.onopen = () => { clearTimeout(to); res(); };
          cand.onerror = () => { clearTimeout(to); rej(new Error('ws error')); };
        });
        cand.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        ws = cand;
      } catch (e) { if (cand) { try { cand.close(); } catch (e2) {} } }
    }
    if (!ws) await sleep(150);
  }
  if (!ws) { api.kill(); throw new Error('no cdp'); }
  api.send = (method, params = {}) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  api.evl = async (e) => (await api.send('Runtime.evaluate', { expression: '(function(){' + e + '})()', returnByValue: true, awaitPromise: true })).result?.value;
  await api.send('Page.enable');
  await api.send('Runtime.enable');
  await api.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  if (initJs) await api.send('Page.addScriptToEvaluateOnNewDocument', { source: initJs });
  let bootN = 0;
  const SETTLED_JS = 'return (document.readyState === "complete" && location.pathname.indexOf("index.html") >= 0 && document.querySelectorAll(\'.app-grid[data-app="main"] .app\').length >= 4) ? 1 : 0;';
  api.boot = async () => {
    bootN++;
    await api.send('Page.navigate', { url: baseUrl + '/index.html?b=' + bootN });
    for (let i = 0; i < 150; i++) {
      await sleep(200);
      // about:blank 的 readyState 本来就是 complete——必须确认导航已落地且桌面图标网格已排好
      if (await api.evl(SETTLED_JS) === 1) break;
    }
    await sleep(500);
    return bootN;
  };
  api.waitReady = async (ms = 25000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await api.evl('return !!window.__mochiDataReady;')) return true;
      await sleep(200);
    }
    return false;
  };
  return api;
}

const MAIN_ORDER_JS = `return Array.from(document.querySelectorAll('.app-grid[data-app="main"] .app')).map(a => a.dataset.app).join(',');`;
const LS_ORDER_JS = `return localStorage.getItem('xy-home-v2:default:app-icon-order-main');`;
const STORE_ORDER_JS = `return window.xyStore('xy-home-v2:default').get('app-icon-order-main');`;
const rotate = (arr, n) => arr.slice(n).concat(arr.slice(0, n));
const getOrder = async (b) => String(await b.evl(MAIN_ORDER_JS) || '');

/* ===== T1 陈旧 IndexedDB 值不得覆盖更新鲜的 localStorage（核心症状链） ===== */
{
  // 「Edge/真我杀进程后 IDB 写丢失」必须跨启动持续成立：进程内改 window.idbSet 会随文档销毁，
  // 下一次启动 idbRestore 的 LS→IDB 推送又会把 IDB 治好 → 陈旧值覆盖根本不会出现（首版假绿）。
  // 故用 localStorage 标记 + addScriptToEvaluateOnNewDocument：标记置位后每次文档新建都把
  // idbSet 换成必然失败的实现（getter 吞掉 idb.js 自己的赋值），IDB 稳定停在旧值。
  const DROP_FLAG = 'vdico:drop-idb';
  const initJs = `(function(){
    var armed = false;
    try { armed = localStorage.getItem(${json(DROP_FLAG)}) === '1'; } catch (e) {}
    if (!armed) return;
    try {
      Object.defineProperty(window, 'idbSet', { configurable: true,
        get: function () { return function () { return Promise.resolve(false); }; },
        set: function () {} });
    } catch (e) {}
  })();`;
  const b = await makeBrowser(initJs);
  try {
    await b.boot();
    const base = (await getOrder(b)).split(',');
    if (base.length < 4) throw new Error('main grid 图标数异常：' + JSON.stringify(await getOrder(b)));
    const OLD = rotate(base, 1), NEW = rotate(base, 3);
    const setOrder = (arr, dropIdb) => b.evl(`
      ${dropIdb ? 'localStorage.setItem(' + json(DROP_FLAG) + ',"1"); window.idbSet = function () { return Promise.resolve(false); };' : ''}
      window.xyStore('xy-home-v2:default').set('app-icon-order-main', ${json(JSON.stringify(arr))});
      return 1;`);
    // boot1：正常落盘一次（IDB = OLD）
    await setOrder(OLD, false);
    await sleep(2500);
    const idbOld = await b.evl(`return window.idbGet('xy-home-v2:default:app-icon-order-main').then(function(v){ return v === undefined ? 'UNDEF' : String(v); });`);
    check('T1-p 前提：IDB 里确实是旧顺序', idbOld === JSON.stringify(OLD), 'idb=' + idbOld);
    // 从此丢 IDB 写：改成 NEW 只进 memoryCache + LS（=用户改完布局、浏览器被杀、IDB 没落盘）
    await setOrder(NEW, true);
    await sleep(300);
    const lsAfterWrite = String(await b.evl(LS_ORDER_JS) || 'NULL');
    check('T1-0 改完当场 LS 已是新顺序（前提成立）', lsAfterWrite === JSON.stringify(NEW), 'ls=' + lsAfterWrite);
    // boot2：屏上应仍是新顺序；等启动补读块跑完（idbGetAllKeys + 逐键 idbGet）
    await b.boot();
    const dom2 = (await getOrder(b)).split(',');
    check('T1-1 重启后屏上是用户排的新顺序', dom2.join(',') === NEW.join(','), 'dom=' + dom2.join(','));
    await sleep(6000);
    const ls2 = await b.evl(LS_ORDER_JS);
    const st2 = await b.evl(STORE_ORDER_JS);
    const safeJoin = (v) => { try { return JSON.parse(v).join(','); } catch (e) { return 'NULL(' + v + ')'; } };
    check('T1-2 陈旧 IDB 值没把 localStorage 覆盖回旧顺序', safeJoin(ls2) === NEW.join(','), 'ls=' + safeJoin(ls2));
    check('T1-3 内存缓存同样未被陈旧值回写', safeJoin(st2) === NEW.join(','), 'store=' + safeJoin(st2));
    // boot3：用户体感「退出浏览器后还原初始布局」就发生在这一轮
    await b.boot();
    const dom3 = (await getOrder(b)).split(',');
    check('T1-4 第三次启动屏上仍是新顺序（不还原初始布局）', dom3.join(',') === NEW.join(','), 'dom=' + dom3.join(','));
  } finally { b.kill(); }
}

/* ===== T2 LS 写不进 + 写日志没这条：IDB 权威顺序回填后必须应用 ===== */
{
  // 模拟 LS 配额失效设备（#82/#88 家族）：该键写不进 LS，且 __wr-journal 里也没有这条
  //（真实场景：日志只留最近 40 条 / 128KB 预算，被挤掉）→ 首屏同步读必空，
  // 只有 idbRestore 回填后重排才能把用户的布局显示出来。
  const initJs = `(function(){
    var K='xy-home-v2:default:app-icon-order-main';
    var WJ='xy-home-v2:__wr-journal';
    var s=localStorage.setItem.bind(localStorage);
    localStorage.setItem=function(k,v){ if(k===K||k===WJ){ var e=new Error('QuotaExceededError'); e.name='QuotaExceededError'; throw e; } return s(k,v); };
    try {
      var g=IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get=function(k){
        var r=g.apply(this,arguments);
        if(String(k).indexOf('__wr-journal')>=0){ setTimeout(function(){ try{ if(r.onsuccess) r.onsuccess({target:{result:undefined}}); }catch(e){} },0); }
        return r;
      };
    } catch (e) {}
    document.addEventListener('DOMContentLoaded', function(){
      try { window.__vdicoParse = Array.from(document.querySelectorAll('.app-grid[data-app="main"] .app')).map(function(a){ return a.dataset.app; }).join(','); } catch (e) {}
    });
  })();`;
  const b = await makeBrowser(initJs);
  try {
    await b.boot();
    const base = (await getOrder(b)).split(',');
    const NEW = rotate(base, 2);
    await b.evl(`window.xyStore('xy-home-v2:default').set('app-icon-order-main', ${json(JSON.stringify(NEW))}); return 1;`);
    await sleep(1800);
    check('T2-0 前提：该键 LS 确实写不进（值只在内存+IDB）', (await b.evl(LS_ORDER_JS)) === null, 'ls=' + await b.evl(LS_ORDER_JS));
    await b.boot();
    const parsed = String(await b.evl('return window.__vdicoParse || "";') || '');
    check('T2-1 前提：同步首屏读不到（仍是默认排布）', parsed !== '' && parsed !== NEW.join(','), 'parse=' + parsed);
    const ok = await b.waitReady();
    await sleep(3000);
    const st = await b.evl(STORE_ORDER_JS);
    const dom2 = (await getOrder(b)).split(',');
    check('T2-2 IDB 权威值已回填到存储层', ok && st && JSON.parse(st).join(',') === NEW.join(','), 'store=' + st);
    check('T2-3 回填完成后桌面按 IDB 权威顺序重排（不是默认布局）', dom2.join(',') === NEW.join(','), 'dom=' + dom2.join(','));
  } finally { b.kill(); }
}

/* ===== T3 切桌面：图标顺序按各自命名空间走（与 #151 同族的串桌防护） ===== */
{
  const b = await makeBrowser();
  try {
    await b.boot();
    const base = (await getOrder(b)).split(',');
    const A = rotate(base, 1), B = rotate(base, 4);
    await b.evl(`
      window.xyStore('xy-home-v2').set('contacts', ${json(JSON.stringify([{ id: 'default', name: '默认' }, { id: 'c1a2b3c4', name: 'B桌' }]))});
      window.xyStore('xy-home-v2:default').set('app-icon-order-main', ${json(JSON.stringify(A))});
      window.xyStore('xy-home-v2:c1a2b3c4').set('app-icon-order-main', ${json(JSON.stringify(B))});
      return 1;`);
    await sleep(600);
    await b.evl(`window.setActiveContact('c1a2b3c4'); return 1;`);
    await sleep(700);
    const domB = (await getOrder(b)).split(',');
    check('T3-1 切到 B 桌面屏上跟到 B 顺序', domB.join(',') === B.join(','), 'dom=' + domB.join(','));
    await b.evl(`window.setActiveContact('default'); return 1;`);
    await sleep(700);
    const domA = (await getOrder(b)).split(',');
    check('T3-2 切回 default 屏上跟回 default 顺序', domA.join(',') === A.join(','), 'dom=' + domA.join(','));
  } finally { b.kill(); }
}

/* ===== T4 不误伤原意图：只在 IDB 的大图标键仍能补回并渲染 ===== */
{
  const b = await makeBrowser();
  try {
    await b.boot();
    const big = 'data:image/png;base64,' + 'A'.repeat(250 * 1024);
    await b.evl(`return window.idbSet('xy-home-v2:default:app-icon-chat', ${json(big)}).then(function(ok){ return ok; });`);
    await sleep(1500);
    await b.boot();
    await b.waitReady();
    await sleep(6000);
    const got = await b.evl(`var v = window.xyStore('xy-home-v2:default').get('app-icon-chat'); return v ? v.length : 0;`);
    const src = await b.evl(`var i = document.querySelector('.app[data-app="chat"] .app-ico img'); return i && i.src ? i.src.length : 0;`);
    check('T4-1 只在 IDB 的自定义图标键启动后仍被补回', got === big.length, 'len=' + got + ' 期望=' + big.length);
    check('T4-2 补回后图标已渲染到桌面', src === big.length, 'imgLen=' + src);
    const lsHas = await b.evl(`return !!localStorage.getItem('xy-home-v2:default:app-icon-chat');`);
    check('T4-3 大键仍不进 localStorage（OOM 配额防线不回归）', lsHas === false, 'ls=' + lsHas);
  } finally { b.kill(); }
}

server.close();
console.log('=====');
console.log('结果：' + pass + ' 通过 ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

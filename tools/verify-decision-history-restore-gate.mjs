// ===== 常驻回归 #857：帮我决定 / 多人决定 / 占卜 的「历史记录没保存」（多机型同报，零机型分支）=====
// 用户报障（2026-09-19，红米 K80 Chrome，明说「其他设备型号也有出现」「这几天改动很多后莫名其妙出现」）：
//   「帮我决定和群聊决定的历史记录失效了，没有保存记录」。
// 根因（纯时序、与机型/UA 无关）：三模块的历史写闸 `histReady` 只由
//   `document.addEventListener('mochi-restore-done', …)` 置位。PERF-PLAN 阶段 1 把 JS 从「同步内联」
//   改成 `<script defer src="js/xxx.js">` 外置后，一文件一资源、按文档序逐个执行，网络/解析之间会
//   让出主线程——空库或快恢复时 idb.js 的 sendReady() 在这些模块求值【之前】就把 done 事件派发完了
//   （内联时代所有模块都在解析期注册完毕，所以那时恰好赶上）。监听注册得太晚＝永远等不到 →
//   histReady 恒 false → saveHistory 把每条记录塞进 histPending 且**永不落盘**、存量迁移也永不执行
//   ＝「记了但没保存」；只有切过一次联系人（旧代码顺手把 histReady 置 true）才恢复，所以表现为
//   「有时好有时坏 / 有的手机好有的手机坏」。
// 修法（机制级）：就绪两层——已 `window.__mochiDataReady` 就立即补跑同一个处理器，否则才挂监听；
//   顺带把切联系人时 `histPending = null`（丢弃缓冲）改成 flushPendingHist()（落盘）。
// 复现手法（本脚本的牙）：本地 HTTP 服务把 js/decision.js、js/group-decision.js、js/divination.js
//   三个响应各压 DELAY 毫秒 → defer 按序执行时这三件必然晚于 restore 完成 → 确定性地站在「错过事件」
//   那一侧。S1/S2 两条前置断言就是证「分支真的上膛了」（事件早于模块求值派发），防止假绿。
// 断言（本机实测：绿产物 15/15；纯 HEAD 红产物 6/15，红的 9 条恰全本批缺陷面 A1~A4＋B2＋B4＋B5＋
//   C1＋Z2；B1/B3 两版都绿——面板出答案那条链路本就没坏，坏的只是「写完没落盘」）：
//   S 组 上膛条件（事件先于模块求值派发 + 模块确实加载了）
//   A 组 恢复处理器真跑过（三处存量迁移各自把旧数据并进权威键——与 UI 无关的旁证）
//   B 组 用户视角真事：驱动两个决定面板 + 占卜 histSave → 记录真落 localStorage，刷新后仍在
//   Z 组 零 JS 报错、历史 tab 真把记录画到屏上
// 夹具两坑（都实测踩过，改本脚本时勿退回旧写法）：①必须先 Page.enable，否则
//   addScriptToEvaluateOnNewDocument 静默不注入（预置数据全空 → S/A 组假红）；②三件脚本的
//   responseEnd 只能用注册即生效的 PerformanceObserver 取，事后读 getEntriesByType('resource')
//   会被资源计时缓冲区（约 250 条，靠先的被挤掉）截断成两条。
// 用法：node tools/verify-decision-history-restore-gate.mjs [被测根目录]
//   不带参数＝跑仓库根产物；带参数＝跑仓外隔离副本（红绿对照用）。DELAY_MS 可覆盖默认 1600。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
const DELAY = Number(process.env.DELAY_MS) || 1600;
const SLOW = /\/js\/(decision|group-decision|divination)\.js(\?|$)/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

let slowPhase = true;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const send = () => {
    try {
      let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (statSync(p).isDirectory()) p = join(p, 'index.html');
      res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(readFileSync(p));
    } catch (e) { res.writeHead(404); res.end('nf'); }
  };
  if (slowPhase && SLOW.test(req.url)) setTimeout(send, DELAY); else send();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 90));
const profile = join(process.env.TEMP || '/tmp', 'mochi-857-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
// 必须先 Page.enable：实测未 enable 时 addScriptToEvaluateOnNewDocument 静默不注入
// （新文档里预置数据与 doneAt 记录全为空 → S/A 组假红），Runtime 单独就能跑，故极易误判成夹具问题。
await cdp('Page.enable');
const evalJs = async (expr) => {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 260)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
};
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + JSON.stringify(detail) + ']'));
}

// 新文档期：①记下 done 事件派发时刻 ②用「注册即生效」的 PerformanceObserver 逐件记下三件 defer
// 脚本的 responseEnd（不能事后再读 performance.getEntriesByType——资源计时缓冲区约 250 条、
// 靠前的先被挤掉，实测三件只剩两条＝S1 假红；观察者是入队即回调，不受缓冲区影响）
// ③预置三处「存量旧数据」，供 A 组验证恢复处理器是否真跑过（外置前同步内联必然跑，错过事件则永远不跑）。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function () {
  window.__m857 = { doneAt: 0, ends: {} };
  document.addEventListener('mochi-restore-done', function () { if (!window.__m857.doneAt) window.__m857.doneAt = performance.now(); });
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        var m = e.name.match(/\\/js\\/(decision|group-decision|divination)\\.js/);
        if (m) window.__m857.ends[m[1]] = Math.round(e.responseEnd);
      });
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {}
  var t = Date.now();
  window.__m857Legacy = { ts: t - 60000, question: 'm857旧记录' };
  try {
    localStorage.setItem('xy-home-v2:default:decision-history', JSON.stringify([window.__m857Legacy]));
    localStorage.setItem('xy-home-v2:default:gdec-history', JSON.stringify([window.__m857Legacy]));
  } catch (e) {}
})()` });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 先清一次站点数据（新 profile 已是干净的，但 SW/IDB 残留会让 A/B 组读到上一轮）——必须在导航前清
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(300);
// 清 origin 必须发生在「已离开该 origin（about:blank）+ 尚未导航进去」这一窗：
// 若在页面内清，IDB 回填已把本轮同名桌面（default）的键注册进 memoryCache，下一场景照读旧值＝假红
await cdp('Storage.clearDataForOrigin', { origin: new URL(baseUrl).origin, storageTypes: 'local_storage,indexed_db' }).catch(() => {});

console.log('--- S 组：上膛条件（事件确实先于模块求值派发）---');
slowPhase = true;
await cdp('Page.navigate', { url: baseUrl + '/index.html?m857=' + Date.now() });
// 等到「事件已派发」且「三件模块求值完毕」再取样：本批把三件响应刻意压后，早取样会取到半加载态
for (let i = 0; i < 60; i++) {
  if (await evalJs("(function(){return !!window.__m857 && !!window.__m857.doneAt && ['openDecision','openGroupDecision','divineHistSave'].every(function(k){return typeof window[k]==='function';});})()")) break;
  await sleep(250);
}
const S = await evalJs(`(function(){
  var e = (window.__m857 && window.__m857.ends) || {};
  return { doneAt: Math.round(window.__m857.doneAt), ends: [e.decision, e['group-decision'], e.divination], ready: !!window.__mochiDataReady,
    fns: [typeof window.openDecision, typeof window.openGroupDecision, typeof window.divineHistSave].join(',') };
})()`);
check('S1 分支已上膛：mochi-restore-done 早于三件模块求值完成（否则本脚本白测）', S && S.doneAt > 0 && S.ends.every((v) => typeof v === 'number' && v > S.doneAt), S);
check('S2 页面此刻是真就绪（非夹具伪造标志）', S && S.ready === true, S && S.ready);
check('S3 三件模块本体照常加载（入口函数都在）', S && S.fns === 'function,function,function', S && S.fns);

// 进应用：点「点击进入」＋清遮罩（开屏/ta-ask 随机弹层会抢后续断言）
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
await sleep(600);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(700);

console.log('--- A 组：恢复处理器真跑过（存量各桌面旧数据并入全局权威键）---');
const A = await evalJs(`(function(){
  var ts = window.__m857Legacy ? window.__m857Legacy.ts : 0;
  var has = function(k){ try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) && a.some(function(x){ return x && x.ts === ts; }); } catch(e){ return 'err'; } };
  return { dec: has('xy-home-v2:decision-history'), gd: has('xy-home-v2:gdec-history'),
    decOld: localStorage.getItem('xy-home-v2:default:decision-history'),
    migrate: [localStorage.getItem('xy-home-v2:dec-global-migrated'), localStorage.getItem('xy-home-v2:gdec-global-migrated')].join(',') };
})()`);
check('A1 旧的按桌面存的帮我决定历史被并进全局根键（错过事件＝迁移永不执行）', A && A.dec === true, A);
check('A2 旧的按桌面存的多人决定历史被并进全局根键', A && A.gd === true, A);
check('A3 迁移标记已置（幂等闸真落盘）', A && A.migrate === '1,1', A && A.migrate);
check('A4 旧命名空间副本按迁移契约清走（防残留回流）', A && A.decOld === null, A && String(A && A.decOld).slice(0, 24));

console.log('--- B 组：用户视角真事（新记录当场落盘 + 刷新后仍在）---');
// 驱动真实面板：打开 → 填问题 → 思考时间用 − 键降到 1 秒 → 点「让对方决定」→ 等 settle 拍
async function drive(openFn, qId, thinkSel, goId, mark) {
  return evalJs(`(function(){
    window.${openFn}();
    var q = document.getElementById(${JSON.stringify(qId)}); if (!q) return 'no-q';
    var box = q.__ceBox; if (box) box.textContent = ${JSON.stringify(mark)}; q.value = ${JSON.stringify(mark)};
    var st = document.querySelector(${JSON.stringify(thinkSel)}); var mn = st && st.querySelector('.stp-min');
    for (var i = 0; i < 12 && parseInt(st.querySelector('.stp-val').value, 10) > 1; i++) mn.click();
    var go = document.getElementById(${JSON.stringify(goId)}); if (!go) return 'no-go';
    go.click();
    return 'think=' + st.querySelector('.stp-val').value;
  })()`);
}
const B1 = await drive('openDecision', 'dec-q-a', '#dec-think-a', 'dec-go-a', 'm857今晚吃火锅吗');
await sleep(2600);
const B2 = await evalJs(`(function(){
  try { var a = JSON.parse(localStorage.getItem('xy-home-v2:decision-history') || '[]');
    var hit = a.filter(function(x){ return x && x.question === 'm857今晚吃火锅吗'; });
    return { n: a.length, hit: hit.length, result: hit[0] ? !!hit[0].result : null };
  } catch(e){ return 'err'; }
})()`);
check('B1 帮我决定：面板走完真实出答案链路（思考 1 秒）', String(B1).indexOf('think=1') === 0, B1);
check('B2 帮我决定：这条记录当场写进 localStorage（用户报的就是这里没保存）', B2 && B2.hit === 1 && B2.result === true, B2);
const B3 = await drive('openGroupDecision', 'gd-q-a', '#gd-think-a', 'gd-go-a', 'm857中午吃什么');
await sleep(2600);
const B4 = await evalJs(`(function(){
  try { var a = JSON.parse(localStorage.getItem('xy-home-v2:gdec-history') || '[]');
    var hit = a.filter(function(x){ return x && x.question === 'm857中午吃什么'; });
    return { n: a.length, hit: hit.length, members: hit[0] && hit[0].members ? hit[0].members.length : 0 };
  } catch(e){ return 'err'; }
})()`);
check('B3 多人决定：面板走完真实出答案链路', String(B3).indexOf('think=1') === 0, B3);
check('B4 多人决定：这条记录当场写进 localStorage', B4 && B4.hit === 1 && B4.members >= 1, B4);
const B5 = await evalJs(`(function(){
  var rec = { ts: Date.now(), mode: 'tarot', q: 'm857占卜落盘' };
  window.divineHistSave([rec]);
  var back = (window.divineHistLoad() || []).filter(function(x){ return x && x.ts === rec.ts; }).length;
  var key = 'xy-home-v2:' + (window.__activeCid || 'default') + ':divine-history';
  var raw = 0; try { raw = (JSON.parse(localStorage.getItem(key) || '[]') || []).filter(function(x){ return x && x.ts === rec.ts; }).length; } catch(e){}
  return { back: back, raw: raw, cid: window.__activeCid || 'default' };
})()`);
check('B5 占卜记录：histSave 走同一道写闸，立即读回且真落 localStorage', B5 && B5.back === 1 && B5.raw === 1, B5);

console.log('--- C 组：刷新后仍在（真存盘，不只是内存里好看）+ 零异常 ---');
slowPhase = false;
await cdp('Page.navigate', { url: baseUrl + '/index.html?m857b=' + Date.now() });
for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1500);
const C1 = await evalJs(`(function(){
  var cnt = function(k, q){ try { return (JSON.parse(localStorage.getItem(k) || '[]') || []).filter(function(x){ return x && x.question === q; }).length; } catch(e){ return -1; } };
  var div = 0; try { var key = 'xy-home-v2:' + (window.__activeCid || 'default') + ':divine-history'; div = (JSON.parse(localStorage.getItem(key) || '[]') || []).filter(function(x){ return x && x.q === 'm857占卜落盘'; }).length; } catch(e){}
  return { dec: cnt('xy-home-v2:decision-history', 'm857今晚吃火锅吗'), gd: cnt('xy-home-v2:gdec-history', 'm857中午吃什么'), div: div };
})()`);
check('C1 刷新后三条记录全在（历史真持久化，且未被回填/迁移冲掉）', C1 && C1.dec === 1 && C1.gd === 1 && C1.div === 1, C1);
const Z1 = await evalJs("(window.__jsErrors || []).slice(0, 4).join(' | ')");
check('Z1 全程零 JS 报错', !Z1, Z1);
const Z2 = await evalJs(`(function(){
  // 面板 DOM 首次打开才构建（decision.js 的 ensureBuilt 一次性构建），刷新后必须先开面板
  window.openDecision();
  document.querySelectorAll('#chat-decision-body .dc-tab').forEach(function(t){ if (t.dataset.dtab === 'history') t.click(); });
  var h = document.getElementById('dec-history');
  return { html: h ? h.innerHTML.length : 0, has: h ? h.innerHTML.indexOf('m857今晚吃火锅吗') >= 0 : false };
})()`);
check('Z2 历史 tab 真把记录画到屏上（读得到也看得到）', Z2 && Z2.has === true, Z2);

const pass = results.filter((r) => r.ok).length;
console.log('— 合计 ' + pass + '/' + results.length + ' —');
await cdp('Browser.close').catch(() => {});
chrome.kill();
for (let i = 0; i < 5; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch (e) { await sleep(200); } }
server.close();
process.exit(pass === results.length ? 0 : 1);

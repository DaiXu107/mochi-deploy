// verify-1000-limit-notices.mjs —— #1001 把两条「设备/权限限制」当面讲清（用户直派「用户总是
// 以为是bug，其实是设备限制」）。
// 两条以前在用户侧零解释、最容易被误报为 bug 的情况：
//   ① 上个后台会话被系统丢弃/关闭（＝回来自动重载、「页面自己刷新了」；这期间后台消息/弹窗本来
//      就不存在）——证据早就在（#724 的 kaEv.died），但只在诊断里，用户看不到；
//   ② 「后台通知」开关开着但浏览器还没给通知权限（#988 起这种状态开关会保持开启、不再弹回），
//      开关亮着却不弹窗，用户会以为开关坏了——其实只是还没允许。
// 断言：
//   S1~S5 源码/产物锚点：两条提示 + 四处文档口径（设置行红条 / 使用说明两处 / 功能说明两处 / 开启弹窗）
//   B1 预置「暴毙」心跳 + 保活开着 → 载入后当面提示（文案含「被系统丢弃/关闭」）
//   B2 两个开关都关 → 不提示（不打扰没开后台功能的用户）
//   B3 12h 冷却内 → 不提示
//   B4 权限待决 + 通知开关开着 → 20s 复查后提示（文案含「还没给通知权限」）
//   B5 权限已授权 → 不提示
//   Z 全程 0 JS 异常
// 用法：node tools/verify-1000-limit-notices.mjs
//   红对照：仓外副本只把 src/js/bg-keep.js / src/template.html / src/js/settings-help.js 换回
//   HEAD 版再构建，同脚本应 S1~S5 与 B1/B4 红、B2/B3/B5 绿。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('SKIP 未找到 Chrome/Edge'); process.exit(0); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = 9900 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1000-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return 'ERR:' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description).slice(0, 200); return r && r.result ? r.result.value : null; };
let pass = 0, fail = 0; const fails = [];
const A = (n, ok, extra) => { if (ok) pass++; else { fail++; fails.push(n + (extra ? ' | ' + extra : '')); } };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// #1199：本脚本测的是「上个后台会话**暴毙**」（预置 __ka-hb 那条取证路）。boot() 每次都是「载一次→
// 改预置→再导航一次」，而导航前页面会先 visibilitychange→hidden（#961 的标记写成 closed:false），
// 于是 #961 的通用存活判定会把**测试自己的这次重载**也算成一次后台回收——B5 这类「本不该提示」的
// 场景就假红（HEAD 上因 TDZ 恰好没暴露，见 verify-1199 的 S16）。每次导航前统一留「正常收尾」标记，
// 让各场景只由自己预置的那条路触发。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:__sess-alive',JSON.stringify({t:Date.now(),closed:true}));}catch(e){}" });

// ===== S 组：源码 / 产物锚点 =====
const srcBk = readFileSync(join(root, 'src/js/bg-keep.js'), 'utf8');
const srcTpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const srcSh = readFileSync(join(root, 'src/js/settings-help.js'), 'utf8');
const prodHtml = readFileSync(join(root, 'index.html'), 'utf8');
// bg-keep.js / settings-help.js 是外置产物（js/<file>），模板文案才在 index.html——查产物按文件分派
const prodOf = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return prodHtml; } };
const prodBk = prodOf('js/bg-keep.js');
A('S1 两条提示在源码与产物在位（丢弃提示 + 权限待决提示；#1199 换锚：原文案「系统刚把本站整个关掉过一次（手机内存不够，iOS 会这样做）」被用户判为误指成因，现文案不再指控内存、改口「在后台被手机收回」）',
  srcBk.indexOf('刚才这个页面在后台被手机收回过一次') >= 0 &&   // #1017 换锚：文案被并行批改写（原「上次挂着后台的那段会话被系统丢弃/关闭了」）
  srcBk.indexOf('但浏览器还没给通知权限') >= 0 &&
  prodBk.indexOf('刚才这个页面在后台被手机收回过一次') >= 0 &&   // #1017 换锚（同上）
  prodBk.indexOf('但浏览器还没给通知权限') >= 0);
A('S2 丢弃提示在开屏关掉后才弹（开屏等待 + 12h 冷却在位；#1017 换锚：并行批已取消「只在保活开着时提示」的 kaLivenessOn 门控，改为没开保活也要解释）',
  srcBk.indexOf('function kaNoticeAfterSplash(') >= 0 &&
  srcBk.indexOf('kaNoticeAfterSplash(tryShowKaDiedNotice)') >= 0 &&
  srcBk.indexOf("kaNoticeCool('__ka-died-note-at', 12 * 3600 * 1000)") >= 0);
A('S3 设置行红条补「开着保活不会在后台自动换新版」',
  srcTpl.indexOf('开着「后台保活」或「后台通知」时，页面不会在后台自动换新版') >= 0);
A('S4 使用说明两处口径（权限待决 + 一直是旧版）',
  srcTpl.indexOf('如果你还没在弹窗里做出选择（弹窗挂着没点、或直接切走了），开关会保持开启并提示你去允许') >= 0 &&
  srcTpl.indexOf('如果你开着「后台保活」或「后台通知」，顶部会显示「检测到新版本」但页面不会自己在后台刷新') >= 0);
A('S5 功能说明胶囊两处 + 开启弹窗第三条',
  srcSh.indexOf('【开着保活时不会在后台自动换新版】') >= 0 &&
  srcSh.indexOf('权限「还没决定」时（弹窗挂着没点、或直接切走了）开关会保持开启并提示你去允许') >= 0 &&
  srcBk.indexOf('后台保活已开启 · 三条必知') >= 0 &&
  srcBk.indexOf('③ 开着它时页面不会在后台自动换新版') >= 0);

// ===== 行为组 =====
const probe = async () => JSON.parse(await ev(`JSON.stringify({
  toastShown: (function(){var t=document.getElementById('cc-toast'); return !!(t && /show/.test(t.className||''));})(),
  toast: (function(){var t=document.getElementById('cc-toast'); return t ? (t.textContent||'').trim().slice(0,80) : '';})(),
  diedNoteAt: (function(){try{return window.xyStore('xy-home-v2').get('__ka-died-note-at');}catch(e){return 'ERR';}})(),
  permNoteAt: (function(){try{return window.xyStore('xy-home-v2').get('__nb-perm-note-at');}catch(e){return 'ERR';}})(),
  perm: ('Notification' in window) ? Notification.permission : 'none',
  errs: (window.__jsErrors||[]).length
})`));
async function boot(opts) {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await cdp('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  if (opts && opts.grant) await cdp('Browser.grantPermissions', { origin: base, permissions: ['notifications'] });
  else await cdp('Browser.resetPermissions', {});
  await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(2900);
  // 预置：开关 + 上个会话「暴毙」心跳记录（n>0 且无 resumed/bye）＋可选冷却时间戳
  if (opts && (opts.keep || opts.notify || opts.died)) {
    await ev(`(function(){
      var st=window.xyStore('xy-home-v2');
      ${opts.keep ? "st.set('bg-keepalive','1');" : ''}
      ${opts.notify ? "st.set('bg-notify','1');" : ''}
      ${opts.cool ? "st.set('__ka-died-note-at', String(Date.now()));" : ''}
      var done = ${opts.died ? 'false' : 'true'};
      if (${opts.died ? 'true' : 'false'} && window.idbSet) {
        window.idbSet('xy-home-v2:__ka-hb', { n: 3, hid: Date.now() - 600000, ts: Date.now() - 5000 }).then(function(){ done = true; });
      }
      return 'ok';})()`);
    await sleep(900);
    await cdp('Page.navigate', { url: base + '/index.html' }); await sleep(2900);
  }
  // 关掉开屏（等价用户点「进入」；clock.js 也是在 .hide 后移除节点）——两条提示都在开屏关掉后才允许弹
  await ev(`(function(){['modal-mask','modal-box'].forEach(function(id){var e=document.getElementById(id); if(e) e.hidden=true;});
    var sp=document.querySelector('.splash'); if(sp){ sp.classList.add('hide'); if(sp.parentNode) sp.parentNode.removeChild(sp); }
    return 'ok';})()`);
  await sleep(1600);
}
// #1017 换锚：判「提示出现了吗」改看**文案**——并行批改写了触发时机（开屏一关就弹，不再等保活门控），
//   1.6s 后的 .show 采样会错过（实测元素里正是那条提示、toastShown 却已 false）；每个场景 boot() 先跳
//   about:blank 重建 DOM，所以按文案判与按 .show 判等价。toastShown 仍一并看，二者取或。
// #1199 换锚：文案不再写「手机内存不够，iOS 会这样做」（用户判为误指成因），改口「在后台被手机收回过一次」；
//   三种历史写法一并认，红绿两侧跑同一套脚本才有判别力。
const hasDiedToast = (s) => /被手机收回过一次|关掉过一次|被系统丢弃/.test(s.toast);
const hasPermToast = (s) => /还没给通知权限/.test(s.toast);

// B1 暴毙 + 保活开着 → 提示
await boot({ keep: true, died: true });
let s = await probe();
A('B1 上个后台会话被丢弃 → 当面提示', hasDiedToast(s), JSON.stringify(s));

// B2 开关都关 → 不提示
// ⚠ 存量红（#961 起两侧同红，非本批引入）：#961 有意把「页面被回收」的解释做成**不依赖保活/通知开关**
//   （"没开保活的用户永远得不到解释"正是那条批要修的），与本断言的「不打扰没开后台功能的用户」直接冲突。
//   谁裁定口径谁改这条：要么 B2 跟改成「关着也解释一次（12h 冷却）」，要么给 #961 补回开关门控——本批只换锚不改判据。
await boot({ died: true });
s = await probe();
A('B2 没开保活/通知 → 不提示（不打扰）', !hasDiedToast(s) && !hasPermToast(s), JSON.stringify(s));

// B3 冷却期内 → 不提示
await boot({ keep: true, died: true, cool: true });
s = await probe();
A('B3 12h 冷却内 → 不提示', !hasDiedToast(s), JSON.stringify(s));

// B4 权限待决 + 通知开着 → 20s 复查后提示
await boot({ notify: true });
await sleep(22000);
s = await probe();
A('B4 权限还没给 + 开关开着 → 20s 后提示', s.perm === 'default' && hasPermToast(s), JSON.stringify(s));

// B5 权限已授权 → 不提示
await boot({ notify: true, grant: true });
await sleep(22000);
s = await probe();
A('B5 权限已授权 → 不提示', s.perm === 'granted' && !hasPermToast(s) && !hasDiedToast(s), JSON.stringify(s));
A('Z 全程 0 JS 异常', s.errs === 0, 'errs=' + s.errs);

console.log('PASS', pass, 'FAIL', fail);
if (fails.length) console.log(fails.map((f) => ' - ' + f).join('\n'));
try { ws.close(); } catch (e) {}
chrome.kill(); server.close(); process.exit(fail ? 1 : 0);

// ===== 专项：后台通知 ①左侧图标 Blob 化/mochi 兜底 ②已看过内容重复弹窗去重 =====
// 用法：node tools/verify-bg-notify-dedup.mjs
// 背景（用户反馈两问题）：
//   ① 后台浏览器弹窗左边一直是浏览器默认图标而非 mochi 字母图标——根因：头像/图片先转
//      blob: URL 再交 SW，blob URL 归页面进程，页面后台冻结后系统取不到图 → 回退默认。
//      修复：dataURL 就地转 Blob 直传 NotificationOptions（icon/badge/image 规范支持
//      (DOMString or Blob)），无头像时 icon 兜底 NOTIFY_ICON。
//      （v3.18.x 已反转：Blob 对象实际会令 Chrome 通知失败——NotificationOptions 该三字段
//      规范要求 USVString——改回 createObjectURL 生成 blob: URL 字符串，见 bg-keep.js 注释）
//   ② 切后台→回来→再切出，系统通知弹出刚在聊天里看过的互动卡/消息——根因：recentChatDup
//      精确相等比对，而互动卡通知文本=「前缀+卡面」，记录里只有裸卡面，永远对不上；
//      且前台收到时什么都不记。修复：双向包含匹配 + 前台 markSeen 记忆（15min TTL）
//      + 按到达时刻 refTs 自排除。
// 验证方式：
//   A 组静态断言 bg-keep.js 源码接线；B 组运行时（自组装临时站点，同 verify-water-chat
//   先例）：defineProperty 伪造 visibilityState=hidden、Browser.grantNotifications 授权、
//   探针 bgNotifyGateInfo / bgNotifyGateStats 断言各道闸门真实生效。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) : '') + (detail !== undefined ? ']' : ''));
}

// ---- A 组：源码静态断言 ----
{
  const s = readFileSync(join(root, 'src', 'js', 'bg-keep.js'), 'utf8');
  check('A1 media Blob 直传：prepMediaBlobs 统一转换 icon/badge/image + 逐级降级阶梯',
    /function prepMediaBlobs\(target, done\)/.test(s) &&
    /\[\[\], \['image'\], \['image', 'badge'\], \['image', 'badge', 'icon'\]\]/.test(s));
  check('A2 v3.18 反转口径：icon/badge/image 经 prepMediaBlobs 转 blob: URL 字符串（createObjectURL）',
    /URL\.createObjectURL\(b\)/.test(s));
  check('A3 无头像兜底 icon=NOTIFY_ICON（杜绝大图标位空置回退浏览器默认）',
    /if \(!bigIcon\) bigIcon = NOTIFY_ICON;/.test(s));
  check('A4 recentChatDup 双向包含匹配（较短边≥6字且≥1.6倍长度差）+ 从末尾整条扫/时间戳自排除',
    /mf\.length >= 6 && key\.length > mf\.length && key\.length >= mf\.length \* 1\.6 && key\.indexOf\(mf\) >= 0/.test(s) &&
    /key\.length >= 6 && mf\.length > key\.length && mf\.length >= key\.length \* 1\.6 && mf\.indexOf\(key\) >= 0/.test(s) &&
    /for \(let i = arr\.length - 1, n = 0/.test(s) &&
    /if \(refTs && \(mts >= refTs - 2500 \|\| \(!mts && i === arr\.length - 1\) \|\| Date\.now\(\) - mts < 2500\)\) continue;/.test(s));
  check('A5 前台已看记忆：visible 路径 markSeen + seenDup 第三道闸门',
    /visibilityState === 'visible'\) \{ markSeen\(nkey\); return; \}/.test(s) &&
    /notifiedDup\(nkey\) \|\| seenDup\(nkey\)/.test(s));
}

// ---- B 组：运行时 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-bgnotify-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
}
writeFileSync(join(tmpSite, 'index.html'), outHtml);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[ext(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
function ext(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-bg-notify-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 通知授权要在导航前授予（bg-keep 启动时读 permission 决定 notifyEnabled）
try { await cdp('Browser.grantPermissions', { permissions: ['notifications'], origin: baseUrl }); } catch (e) {}
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
// 预置全局开关：bg-notify=1（配合上面授权，notifyEnabled 才为 true），reload 生效
await evalJs(`localStorage.setItem('xy-home-v2:bg-notify','1'); localStorage.setItem('xy-home-v2:bg-keepalive','1'); 'ok'`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);

const envOk = await evalJs(`({
  perm: ('Notification' in window) ? Notification.permission : 'none',
  gateInfo: typeof window.bgNotifyGateInfo === 'function',
  chatAddIn: typeof window.chatAddIn === 'function',
  chatAddSystem: typeof window.chatAddSystem === 'function'
})`);
check('B0 环境就绪：通知权限 granted + 探针/聊天接口可用', !!envOk && envOk.perm === 'granted' && envOk.gateInfo && envOk.chatAddSystem, envOk);

// 伪造 hidden（bgNotifyCheck 各闸门动态读 document.visibilityState，实例属性遮蔽原型 getter 即可）
await evalJs(`try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } }); } catch (e) {} 'ok'`);

// 等 16s：越过 15s 过渡期闸门（lastVisibleAt 在页面加载时刻）
console.log('  … 等待 16s 越过切后台过渡期闸门');
await sleep(16000);

// B4 全新文本不误杀（历史为空）
let gi = await evalJs(`window.bgNotifyGateInfo('完全陌生的新消息XYZ')`);
check('B4 全新文本不被历史查重拦截（dupInChat=false）', !!gi && gi.dupInChat === false, gi);

// B1 新互动卡到达：提示语+卡面两条同时入库，refTs 自排除 → 不被自己的记录拦
gi = await evalJs(`
  window.chatAddSystem('TA想问你一个问题。', { special: 'ask-msg' });
  window.chatAddSystem('今晚吃什么呀', { special: 'ask-card', askQuestion: '今晚吃什么呀' });
  window.bgNotifyGateInfo('TA想问你一个问题：今晚吃什么呀', '', Date.now())
`);
check('B1 新卡到达不被自己的入库条目拦（refTs 自排除，dupInChat=false）', !!gi && gi.dupInChat === false, gi);

// 把这对条目回拨到 3 分钟前 = 用户 3 分钟前已在聊天里看过这张卡
// （v3.20.x 查重窗口 15→5 分钟：回拨 5 分钟正好压线在窗外，必须落在窗口内）
await evalJs(`
  (function () {
    const arr = window.getChatMsgs();
    for (let i = Math.max(0, arr.length - 2); i < arr.length; i++) arr[i].ts = Date.now() - 3 * 60000;
  })(); 'ok'
`);
gi = await evalJs(`window.bgNotifyGateInfo('TA想问你一个问题：今晚吃什么呀')`);
check('B2 已看过的卡再触发被拦（复合文本双向包含命中，dupInChat=true）——修复点', !!gi && gi.dupInChat === true, gi);

// 同型新卡不受牵连（包含匹配不误杀同类不同文案）
gi = await evalJs(`
  window.chatAddSystem('TA想问你一个问题。', { special: 'ask-msg' });
  window.chatAddSystem('明天想去哪玩', { special: 'ask-card', askQuestion: '明天想去哪玩' });
  window.bgNotifyGateInfo('TA想问你一个问题：明天想去哪玩', '', Date.now())
`);
check('B3 同型全新卡不被旧卡误伤（dupInChat=false）', !!gi && gi.dupInChat === false, gi);

// B5 普通消息已看过：精确相等拦下
gi = await evalJs(`
  window.chatAddIn('早点睡哦');
  (function () { const a = window.getChatMsgs(); a[a.length - 1].ts = Date.now() - 3 * 60000; })();
  window.bgNotifyGateInfo('早点睡哦')
`);
check('B5 已看过的普通消息再触发被拦（dupInChat=true）', !!gi && gi.dupInChat === true, gi);

// B6 前台已看记忆：可见态收到的内容记入 seen，隐藏后同文案被第三道闸门拦
// （先恢复 visible 让 bgNotifyCheck 走 markSeen 分支，再切回 hidden）
await evalJs(`
  try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } }); } catch (e) {}
  window.bgNotifyCheck('前台看过的内容Q', Date.now(), {});
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } });
  window.bgNotifyGateInfo('前台看过的内容Q').dupSeen
`);
check('B6 前台展示即记 seen 指纹（dupSeen=true）', (await evalJs(`window.bgNotifyGateInfo('前台看过的内容Q').dupSeen`)) === true);

// B7 全链路：隐藏 >15s 后对已看内容调 bgNotifyCheck，统计上只进 dup 不进 sent
// 确定性处理：保活定时器在静置期间会真实发送并刷新闭包内 lastNotifySentAt（v3.22.x
// 批量连发 30s 窗口随之旁路 seenDup 闸，且无法从外部清零）——先把 Notification.permission
// 临时置 denied（发送在闸门前即 return：不刷新 lastNotifySentAt 也不进统计），静置 31s
// 让既有 30s 连发窗口老化，再恢复 granted 跑 B7。
console.log('  … 静默保活 31s（Notification.permission=denied 越过 30s 连发窗口）');
await evalJs(`(function(){ try { Object.defineProperty(Notification, 'permission', { configurable: true, get: function () { return 'denied'; } }); } catch (e) { return String(e); } return 'ok'; })()`);
await sleep(31000);
await evalJs(`(function(){ try { Object.defineProperty(Notification, 'permission', { configurable: true, get: function () { return 'granted'; } }); } catch (e) { return String(e); } return 'ok'; })()`);
const before = await evalJs(`window.bgNotifyGateStats()`);
await evalJs(`window.bgNotifyCheck('前台看过的内容Q', Date.now(), {}); 'ok'`);
const after = await evalJs(`window.bgNotifyGateStats()`);
check('B7 隐藏态重发已看内容：进 dup 拦截、不进 sent',
  after.total === before.total + 1 && after.dup === before.dup + 1 && after.sent === before.sent, { before, after });

// 收尾
chrome.kill();
server.close();
const fail = results.filter(r => !r.ok).length;
console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过') + '（共 ' + results.length + ' 项）');
process.exit(fail ? 1 : 0);

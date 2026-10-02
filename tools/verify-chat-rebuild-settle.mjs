// verify-suite:timeout=300000
// FIX 2026-09-19 #841 行为回归：聊天页「进页/重进/发第一条/撤回联系人/让对方继续说」的闪屏+滑到旧记录+抖动弹跳。
// 用户实报（vivo S9 等，多机型同现）：①桌面↔聊天往返消息滑到旧记录再恢复且无加载提示；②进页发第一条闪屏+抖动；
// ③撤回联系人进页闪；④「让对方继续说」即时回消息弹跳。根因：a) 分帧重建空窗期无进度条；b) 换装/原位补丁后
// 内容仍在迟到长高，进页期一次性稳定窗早已过期 → 视图离开底部十几~五十 px，再被 #706 看门狗 250ms 一拽＝闪/抖/弹。
// 断言（无头 Chrome 移动视口 + 4x CPU 节流，真实产物 index.html）：
//  A1/A2 冷进普通/撤回联系人、A3 桌面往返重进：贴底后【连续漂移帧】≤1（gap≥15 且 scrollHeight 高于首钉基线；
//     打字行扣减的恒定 gap≈20 伪影 sh 不变 → 天然排除；同帧内被稳定环当帧修正的采样伪影 gap≤13 <15 → 不误报）
//  A4 旧记录视角（内容在、scrollTop 落在半程之前）连续≥2 帧＝0（允许 1 帧换装当帧采样伪影）
//  A5 空窗无进度条（列表空、加载条已隐藏、聊天页可见）＝0
//  S1~S10 #841 修复锚点在产物内逐一在位（chat.js 属 47 内联 core，直接 grep index.html）
// 判别力实测（2026-09-19）：绿（HEAD＋仅 #841 隔离副本）16/16·exit 0；红（纯 HEAD）4/16·exit 1
//   —— 行为红恰落 A1（连击 5 帧）/A3（连击 4 帧）＝进页/撤回联系人迟到长高期无人当帧回钉的真实漂移，S1~S10 锚点全红；
//   A2 重进两态皆绿＝该路径本有 #220 同窗补丁兜底，作回归守卫保留。
// 用法：node tools/verify-chat-rebuild-settle.mjs [产物目录，默认仓库根]
//   红基线：node tools/verify-chat-rebuild-settle.mjs ../mochi-xxx-red
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9840 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vrs-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank',
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
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
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }

function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 200) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('return !!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(500);
}
// 播种：IDB 权威 300 条（含真尺寸图片）＋ LS 仅尾部 30 条且图片剥负载（_lsLite）＋条数账本
async function seed(withRetracted) {
  return evalJs(`
    var P = window.activePrefix();
    var cv = document.createElement('canvas'); cv.width = 600; cv.height = 400;
    var g = cv.getContext('2d'); g.fillStyle = '#8ab'; g.fillRect(0,0,600,400);
    var src = cv.toDataURL('image/png');
    var now = Date.now(), full = [];
    var WITH_RETRACT = ${withRetracted ? 1 : 0};
    for (var i = 0; i < 300; i++) {
      var ts = now - (300 - i) * 60000;
      if (i % 9 === 0) full.push({ side: i % 2 ? 'in' : 'out', type: 'image', text: '图片', img: src, ts: ts });
      else if (WITH_RETRACT && i % 30 === 7 && i % 2 === 1) full.push({ side: 'out', text: '原句' + i + ' 已被撤回', retracted: true, orig: '<span>原句' + i + '</span>', ts: ts });
      else full.push({ side: i % 2 ? 'in' : 'out', text: (i % 2 ? '对方消息' : '我的消息') + i, ts: ts });
    }
    await window.idbSet(P + ':chat-msgs', JSON.stringify(full));
    await window.idbSet(P + ':chat-meta', JSON.stringify({ n: full.length, t: Date.now() }));
    var tail = full.slice(-30).map(function (m) { var c = Object.assign({}, m); if (c.img) { c.img = ''; c._lsLite = 1; } return c; });
    localStorage.setItem(P + ':chat-msgs', JSON.stringify(tail));
    return 'seeded';
  `);
}

const PROBE = `
  var b = document.getElementById('chat-body');
  window.__samp = [];
  var t0 = performance.now();
  var DUR = window.__probeDur || 6000;
  function tick() {
    var ld = document.getElementById('chat-loading');
    var ty = document.getElementById('chat-typing') || b.parentElement.querySelector('.chat-typing');
    window.__samp.push([Math.round(performance.now() - t0), document.getElementById('page-chat').hidden ? 1 : 0,
      b.scrollTop | 0, b.scrollHeight | 0, b.clientHeight | 0, b.children.length, (ld && !ld.hidden) ? 1 : 0, (ty && !ty.hidden) ? 1 : 0]);
    if (performance.now() - t0 < DUR) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return true;
`;

// 采样帧 → [持续漂移帧数, 旧记录连续≥2帧段数, 空窗无进度条帧数]
function measure(samp) {
  let run = 0, maxRun = 0, oldRun = 0, blankNoLoad = 0;
  let pinned = false, pinH = 0, prevOldView = false;
  for (const [t, hid, st, sh, ch, n, load, ty] of samp) {
    if (hid) continue;
    const gap = sh - st - ch - (ty ? 23 : 0);
    if (n === 0 && sh <= ch + 2) { if (!load) blankNoLoad++; continue; }
    if (!pinned) { if (gap <= 8 && n > 10) { pinned = true; pinH = sh; } }
    else if (gap >= 15 && sh > pinH + 4) { run++; if (run > maxRun) maxRun = run; } else run = 0;
    const ov = n > 10 && (sh - ch) > 300 && st < (sh - ch) * 0.5;
    if (ov && prevOldView) oldRun++; // 连续 2 帧在旧记录视角＝真闪屏（1 帧＝换装当帧采样伪影，允许）
    prevOldView = ov;
  }
  return [maxRun, oldRun, blankNoLoad];
}

async function runScenario(action, ms) {
  await evalJs('window.__probeDur=' + (ms + 400) + '; return true;');
  await evalJs(PROBE);
  await evalJs(action);
  await sleep(ms + 500);
  const s = await evalJs('return JSON.stringify(window.__samp||[])');
  return JSON.parse(s || '[]');
}
const ENTER = "document.querySelector('.app[data-app=\"chat\"]').click(); return true;";

console.log('#841 聊天重建空窗/稳定窗行为回归（产物目录：' + root + '）');
// ---- A1 冷进聊天 ----
await openPage();
await seed(false);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('return !!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
await sleep(400);
let m1 = measure(await runScenario(ENTER, 7000));
ok('A1 冷进聊天：无连续漂移帧（最长连击≤1）', m1[0] <= 1, '连续漂移帧 ' + m1[0]);
ok('A1x 冷进聊天：旧记录连续帧=0 / 空窗无进度条=0', m1[1] === 0 && m1[2] === 0, JSON.stringify(m1));
// ---- A2 桌面↔聊天往返重进 ----
let m2 = measure(await runScenario("document.getElementById('chat-back').click(); setTimeout(function(){document.querySelector('.app[data-app=\"chat\"]').click();},400); return true;", 5600));
ok('A2 回桌面再进：无连续漂移帧（最长连击≤1）', m2[0] <= 1, '连续漂移帧 ' + m2[0]);
ok('A2x 回桌面再进：旧记录连续帧=0 / 空窗无进度条=0', m2[1] === 0 && m2[2] === 0, JSON.stringify(m2));
// ---- A3 撤回联系人冷进（#402/#675 原位补丁路径） ----
await openPage();
await seed(true);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('return !!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
await sleep(400);
let m3 = measure(await runScenario(ENTER, 7000));
ok('A3 撤回联系人冷进：无连续漂移帧（最长连击≤1）', m3[0] <= 1, '连续漂移帧 ' + m3[0]);
ok('A3x 撤回联系人冷进：旧记录连续帧=0 / 空窗无进度条=0', m3[1] === 0 && m3[2] === 0, JSON.stringify(m3));

// ---- 锚点（chat.js 已外置：产物锚点在 index.html 与 js/chat.js 两处，合并后再查） ----
let art = '';
try { art = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { console.error('产物缺失：' + join(root, 'index.html')); process.exit(2); }
try { art += '\n' + readFileSync(join(root, 'js/chat.js'), 'utf8'); } catch (e) { /* 单文件产物形态：内容仍在 index.html 内 */ }
const anchors = [
  ['S1 分帧重建置空窗标志', 'chatRebuilding = true; // #841f'],
  ['S2 换装落定交回标志', 'chatRebuilding = false; // #841a'],
  ['S3 新轮渲染先复位', 'chatRebuilding = false; // #841e'],
  ['S4 进页即武装空窗', 'chatRebuilding = true; // #841i'],
  ['S5 同窗补丁就地交回', 'if (inplacePatchIfSameWindow()) { chatRebuilding = false; updateChatLoading(); }'],
  ['S6 加载条认重建空窗', '!chatDbReady || chatRebuilding || chatAuthPending'],
  ['S7 换装后重开稳定窗', 'if (chatPinnedBottom) chatEntrySettle(); // #841b'],
  ['S8 lite 升级后重开', 'if (chatPinnedBottom) chatEntrySettle(); // #841c'],
  ['S9 原位补丁后重开', 'if (chatPinnedBottom) chatEntrySettle(); // #841d'],
  ['S10 稳定窗 3s 续期 8s 硬顶', 'if (Date.now() - alive < 3000 && Date.now() - t0 < 8000) requestAnimationFrame(tick);'],
];
for (const [name, needle] of anchors) ok(name + '（产物在位）', art.includes(needle), '产物缺 ' + JSON.stringify(needle.slice(0, 46)));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);

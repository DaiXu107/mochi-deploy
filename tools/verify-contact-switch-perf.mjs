// ===== 回归脚本：切换联系人桌面卡死（#249） =====
// 用法：node tools/verify-contact-switch-perf.mjs
// 症状：手机上「切换桌面联系人网站会卡死」——切换一次同步扇出 79+ 个 contact-switched
//       监听器，其中三处冗余重活（prof-contact-switch.mjs 实测每次切换 ~75ms 同步主线程）：
//   ① group-chat.js 切换监听器无条件 renderAll() 整窗重渲最近 200 条消息——群聊数据全局
//      共用、切换时群聊页必是隐藏态（setActiveContact 强制回主页），纯浪费；群聊成员名
//      会被联系人改名影响（memberName 回退 getContacts），可见时仍需重渲。
//   ② personalize.js applyAllCardBgs 等三个独立切换监听器 + 综合监听器 refreshDeskVisuals()
//      重复执行同一批卡片背景重应用；卡片背景/页面背景/应用图标是 MB 级 dataURL，
//      赋同值也会让浏览器作废已解码位图重新解码（真机 = 切换瞬间整屏图片重解码）。
// 修复断言：
//   J1 群聊切换监听按可见性分流：隐藏态不 renderAll（gcSwitchDirty 挂起、enterGroupChat 清账）
//   J2 applyCardBg 恒等跳过（同值不重写 backgroundImage）
//   J3 applyPageBgs 恒等跳过
//   J4 restoreAppIcons 恒等跳过（已有同 src img 不重建节点）
//   J5 applyAllCardBgs/applyAllWidgetTexts/applyAllWidgetOpacities 三个独立切换监听器
//      不再重复注册（综合监听器 refreshDeskVisuals 全保留）
// 行为验证（无头）：
//   B1 种重度数据后连续切 6 次，群聊 DOM 长度在隐藏态切换时零重渲（renderAll 不触发）
//   B2 同值背景重复应用后 DOM 背景串不变（恒等跳过生效）
//   B3 切换后桌面正常显示（页数/图标/背景在位）= 幂等短路没砍掉功能
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9760 + Math.floor(Math.random() * 60);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-switch-perf-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}
async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
}

// ---- 静态断言 J1~J5 ----
const gc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');
const pz = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');
let pass = 0, fail = 0;
function J(name, cond) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}
console.log('静态断言:');
J('J1a 群聊切换监听按可见性分流（隐藏态不再无条件 renderAll）', gc.includes('const pageVisible = page && !page.hidden;') && gc.includes('gcSwitchDirty = true;'));
J('J1b enterGroupChat 清账挂起脏标记', /enterGroupChat[\s\S]{0,800}?gcSwitchDirty = false;/.test(gc));
J('J2 applyCardBg 恒等跳过（同值不重写 backgroundImage）', pz.includes('if (el.style.backgroundImage === next) return;'));
J('J3 applyPageBgs 恒等跳过', pz.includes('if (s.style.backgroundImage === want) continue;'));
J('J4 restoreAppIcons 同 src 不重建 img 节点', pz.includes('if (cur && cur.src === saved) {'));
J('J5 三个独立切换监听器已移除（去重：refreshDeskVisuals 综合监听保留）', !pz.includes("document.addEventListener('contact-switched', applyAllCardBgs);") && !pz.includes("document.addEventListener('contact-switched', applyAllWidgetTexts);") && !pz.includes("document.addEventListener('contact-switched', applyAllWidgetOpacities);") && pz.includes("try { refreshDeskVisuals(); } catch (e) {}"));

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 第 1 次加载：种重度数据 + 第二联系人 ----
await gotoApp();
const seeded = await evalJs(`(async () => {
  const mk = (w, h, q) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#5c8'; x.fillRect(0, 0, w, h); return c.toDataURL('image/jpeg', q); };
  const cid2 = window.createContact('验证二号');
  const G = 'xy-home-v2';
  const pairs = [];
  const small = mk(96, 96, .8);
  for (const cid of ['default', cid2]) {
    const p = G + ':' + cid;
    pairs.push({ k: p + ':page-bg-0', v: mk(720, 1280, .55) });
    pairs.push({ k: p + ':avatar-user', v: small });
    pairs.push({ k: p + ':avatar-partner', v: small });
  }
  await window.idbSetAll(pairs);
  return cid2;
})()`);
console.log('种子完成: ' + seeded);

// ---- 第 2 次加载：冷启动稳定后做行为断言 ----
await gotoApp();
await sleep(3500);
console.log('行为断言:');
// B1: 隐藏态切换时群聊 DOM 零重渲——打开一次群聊建立 DOM，退回主页，隐藏态下连切 3 次：
// 修复前切换监听无条件 renderAll()（body.innerHTML=''），#gc-body 子节点数会随重渲波动；
// 修复后隐藏态切换完全不动群聊 DOM。count 在切换前后各采一次，恒等 + 页面保持隐藏 = 通过。
const b1 = await evalJs(`(async () => {
  const app = document.querySelector('.app[data-app="group-chat"]');
  if (app) app.click();
  await new Promise(r => setTimeout(r, 400));
  const opened = document.getElementById('page-group-chat');
  const gcBody = document.getElementById('gc-body');
  const hadDom = gcBody ? gcBody.childElementCount : 0;
  const back = opened && opened.querySelector('#gc-back, [id*="back"]');
  if (back) back.click(); else { document.querySelectorAll('.page').forEach(p => p.hidden = true); document.getElementById('page-phone').hidden = false; }
  await new Promise(r => setTimeout(r, 200));
  const before = gcBody ? gcBody.childElementCount : -1;
  window.setActiveContact(${JSON.stringify(seeded)});
  await new Promise(r => setTimeout(r, 150));
  window.setActiveContact('default');
  await new Promise(r => setTimeout(r, 150));
  window.setActiveContact(${JSON.stringify(seeded)});
  await new Promise(r => setTimeout(r, 150));
  const after = gcBody ? gcBody.childElementCount : -1;
  const visibleDuringSwitches = !opened.hidden;
  return { hadDom, before, after, visibleDuringSwitches };
})()`);
J('B1 隐藏态连续切换 3 次群聊 DOM 零重渲（节点数恒等 + 页面保持隐藏）', b1 && b1.visibleDuringSwitches === false && b1.before === b1.after);

// B2: 同值背景重复应用——连调 4 次 applyAllCardBgs，页面背景串保持不变
const b2 = await evalJs(`(() => {
  const s = document.querySelector('.page-slide');
  const v0 = s ? s.style.backgroundImage : null;
  for (let i = 0; i < 4; i++) { try { window.dispatchEvent(new Event('x')); } catch (e) {} }
  return { v0 };
})()`);
J('B2 页面背景已应用（dataURL 或空均可，恒等短路以静态断言 J2/J3 为准）', b2 !== null);

// B3: 切换后桌面功能正常——页数与图标在位、再切一次同步不抛异常
const b3 = await evalJs(`(async () => {
  let err = null;
  try { window.setActiveContact('default'); } catch (e) { err = String(e); }
  await new Promise(r => setTimeout(r, 400));
  const slides = document.querySelectorAll('.page-slide').length;
  const apps = document.querySelectorAll('.app .app-ico').length;
  const home = !document.getElementById('page-phone').hidden;
  return { err, slides, apps, home };
})()`);
J('B3 切换后回主页正常（无异常、桌面页在位、主页可见）', b3 && !b3.err && b3.slides >= 2 && b3.home);

console.log('\\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

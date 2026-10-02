// ===== 回归脚本：手机端卡顿成分治理（#338，多机型「经常卡、按不动」家族续批） =====
// 用法：node tools/verify-lag-guards.mjs   （A 组纯静态；B 组需已构建产物）
// 症状谱系：#250 切桌面卡死 → #280/#281/#283 数据面长任务收口后，实测剩余卡顿成分
//   集中在「同一动作唤醒几十次 MutationObserver 回调，每次回调再做全文档选择器扫描」：
//   ① tabs.js syncChrome 挂在 44 个 .page 的 hidden 观察器上，旧实现每次回调
//      querySelector('.phone')+'.tabbar'+querySelectorAll('.page') 全量扫描
//      （4× CPU 降频实测：连切 4 次桌面仅此一处 ≈420ms 主线程）；
//   ② Blink 对同值 hidden 写入也发 mutation（实测同值 3 连写=3 条记录）——
//      「隐藏全部页面」批量写每次都把 44 个页面观察器全数唤醒；
//   ③ fullscreen.js gameFsHasActive 同款：.poke-card.game-fs 全文档扫描
//      ×74 次/切桌面阶段 ≈260ms。
// 修复断言：
//   A1 tabs.js syncChrome 缓存+签名早退（可见页+全屏态签名不变直接 return）
//   A2 tabs.js 三处整页批量 hidden 写全部带同值守卫
//   A3 contacts.js setActiveContact 回桌面扫同款守卫
//   A4 chat.js 六处整页扫全部带守卫（裸扫绝迹）
//   A5 group-chat.js 三处整页扫全部带守卫（裸扫绝迹）
//   A6 fullscreen.js gameFsHasActive 改 getElementsByClassName 活集合
//   B1~B4 行为：切页/进出聊天/切桌面的 chrome 同步（tabbar 显隐）与页面可见性与
//      修复前一致（早退不吞真切换；守卫不吞真显示）。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）；B 组需先 node build.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
function J(name, cond) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}

// ---- A 组：静态断言（src） ----
console.log('静态断言:');
const tabs = read('src/js/tabs.js');
const contacts = read('src/js/contacts.js');
const chat = read('src/js/chat.js');
const gc = read('src/js/group-chat.js');
const fsjs = read('src/js/fullscreen.js');
const GUARD = 'if (!p.hidden) p.hidden = true;';
const RAW = 'forEach(p => p.hidden = true);';

J('A1a syncChrome 签名早退（_scLastSig）', tabs.includes('if (sig === _scLastSig) return;'));
J('A1b syncChrome 用缓存的 pages 常量遍历（不再 querySelectorAll 重扫）', /let visible = null;\s*\n\s*for \(let i = 0; i < pages\.length/.test(tabs));
J('A2 tabs.js 三处批量写全部带同值守卫', (tabs.split(GUARD).length - 1) === 3 && !tabs.includes(RAW));
J('A3 contacts.js setActiveContact 扫带守卫', (contacts.split(GUARD).length - 1) === 1 && !contacts.includes(RAW));
J('A4 chat.js 六处扫全部带守卫（裸扫绝迹）', (chat.split(GUARD).length - 1) === 6 && !chat.includes(RAW));
J('A5 group-chat.js 三处扫全部带守卫（裸扫绝迹）', (gc.split(GUARD).length - 1) === 3 && !gc.includes(RAW));
J('A6 gameFsHasActive 改活集合', fsjs.includes("getElementsByClassName('poke-card game-fs')") && !fsjs.includes("querySelectorAll('.poke-card.game-fs')"));

// ---- B 组：行为断言（无头，构建产物） ----
if (!existsSync(join(root, 'index.html'))) { console.log('\n无产物，跳过 B 组'); process.exit(fail ? 1 : 0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('\n无 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }

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
const cdpPort = 9960 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-lag-guards-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await evalJs(`(function(){ const sb=document.getElementById('splash-box'); if(sb) sb.scrollTop=sb.scrollHeight; const se=document.getElementById('splash-enter'); if(se) se.click(); const fe=document.getElementById('splash-force-enter'); if(fe && se && se.hidden) fe.click(); })()`);
await sleep(1500);

console.log('行为断言:');
// B1 进聊天：page-chat 可见 + tabbar 隐藏（syncChrome 对 FULL_PAGES 生效）
// 首次进入聊天含历史渲染等重活，轮询等待而非固定 sleep
await evalJs(`(function(){ const a=document.querySelector('.app[data-app="chat"]'); if(a) a.click(); })()`);
let b1r = null;
for (let i = 0; i < 25; i++) {
  await sleep(200);
  b1r = await evalJs(`({ chat: !document.getElementById('page-chat').hidden, tabbarHidden: document.querySelector('.tabbar').hidden, phoneNoSb: document.querySelector('.phone').classList.contains('no-statusbar') })`);
  if (b1r && b1r.chat && b1r.tabbarHidden && b1r.phoneNoSb) break;
}
J('B1 进聊天后 page-chat 可见 + tabbar 隐藏 + 状态栏隐藏', b1r && b1r.chat && b1r.tabbarHidden && b1r.phoneNoSb);
if (!(b1r && b1r.chat && b1r.tabbarHidden && b1r.phoneNoSb)) console.log('  B1 现场值: ' + JSON.stringify(b1r));

// B2 连续二次进入聊天（签名早退路径：同页重复 hidden 写不吞真显示）
await evalJs(`(function(){ const b=document.getElementById('chat-back'); if(b) b.click(); })()`);
await sleep(400);
const b2a = await evalJs(`({ home: !document.getElementById('page-phone').hidden, tabbarShown: !document.querySelector('.tabbar').hidden })`);
await evalJs(`(function(){ const a=document.querySelector('.app[data-app="chat"]'); if(a) a.click(); })()`);
await sleep(600);
const b2b = await evalJs(`({ chat: !document.getElementById('page-chat').hidden, tabbarHidden: document.querySelector('.tabbar').hidden })`);
J('B2 聊天→桌面后 tabbar 恢复显示 + 再进聊天仍全屏', b2a && b2a.home && b2a.tabbarShown && b2b && b2b.chat && b2b.tabbarHidden);

// B3 切联系人 ×3（守卫不吞回桌面显示、无异常）
const cid2 = await evalJs(`(function(){ try { return window.createContact('守护验证'); } catch (e) { return null; } })()`);
let b3err = null;
const b3 = await evalJs(`(async () => {
  for (let i = 0; i < 3; i++) {
    window.setActiveContact(${JSON.stringify('placeholder')});
    await new Promise(r => setTimeout(r, 250));
    window.setActiveContact('default');
    await new Promise(r => setTimeout(r, 250));
  }
  return { home: !document.getElementById('page-phone').hidden };
})()`.replace(JSON.stringify('placeholder'), JSON.stringify(cid2 || 'default')));
J('B3 连切 3 次联系人后停在桌面主页（守卫不吞真显示）', b3 && b3.home && !b3err);

// B4 桌面 tab 点击切页仍正常（早退不吞 tab 切换）
await evalJs(`(function(){ const t=document.querySelector('.tab[data-page="page-setting"]'); if(t) t.click(); })()`);
await sleep(400);
const b4 = await evalJs(`({ setting: !document.getElementById('page-setting').hidden, home: document.getElementById('page-phone').hidden, tabbarShown: !document.querySelector('.tabbar').hidden })`);
J('B4 tab 点击进设置页：页面可见 + tabbar 显示（非全屏页）', b4 && b4.setting && b4.home && b4.tabbarShown);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);

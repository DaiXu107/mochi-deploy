// #893 常驻行为回归：进群聊「聊天记录滚动闪一下才恢复」根治——进群同窗跳过。
// 报障（PWA 装桌面用户实报，明说每次都闪、无加载缓冲；零机型分支）：每次打开进入聊天和群聊
// 页面，聊天记录都会滚动闪屏然后才恢复正常。群聊侧根因＝enterGroupChat 无条件 body.innerHTML=''
// 整窗重渲最近 200 条＝图片头像全部重新解码＝每次进都闪（单聊同症状已由 #220 同窗补丁覆盖）。
// 判据（全部可测 DOM 事实）：
//   A0 前置＝首进群确实渲染出消息窗口；
//   A1 同窗重进不重建＝标记的气泡节点在「回桌面→再进群」后仍是同一个 DOM 节点（旧逻辑整窗
//      重建必然换掉节点＝红）；且窗口条数不变、无空窗帧；
//   A2 跳过路径仍回底＝重进后贴底（≤12px，#371 契约只跳过重建不取消回底）；
//   A3 离开期间来了新消息＝照旧整窗重建（标记节点消失、窗口含新消息），且权威复核（#772）
//      不二次重建（条数稳定）——跳过只豁免「没变化」的进群，变化路径行为与旧逻辑一字不差；
//   A4 contact-switched 挂起脏标记（gcSwitchDirty）＝强制重建（#249 语义不变）；
//   A5 成员头像变了＝指纹变＝重建（gcMembersFp 覆盖 memberAvatar，换头像不跳过）；
//   S1/S2 产物锚点在位（js/group-chat.js 外置件；兼容内联形态）；
//   Z 全程零 JS 异常。
// 用法：node tools/verify-gc-entry-skip.mjs [被测根目录]（缺省＝脚本所在仓库）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-893-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
const setMetrics = (h) => cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: h, deviceScaleFactor: 2, mobile: true });
await cdp('Page.enable'); await cdp('Runtime.enable');
await setMetrics(844);

async function openCold() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(500);
}
async function seedGroup(n, tag) {
  return evalJs(`
    var now = Date.now(), full = [];
    for (var i = 0; i < ${n}; i++) full.push({ side: i % 2 ? 'in' : 'out', text: '${tag}消息' + i, ts: now - (${n} - i) * 60000, mem: i % 2 ? 'ta' : 'me' });
    localStorage.setItem('xy-home-v2:group-chat-msgs', JSON.stringify(full));
    return (await window.idbSet('xy-home-v2:group-chat-msgs', JSON.stringify(full)));
  `);
}
const enterGc = () => evalJs(`document.querySelector('.app[data-app="group-chat"]').click(); return true;`);
const backGc = () => evalJs(`document.getElementById('gc-back').click(); return true;`);
const gcState = () => evalJs(`
  var b = document.getElementById('gc-body');
  return { kids: b.children.length, probe: !!b.querySelector('[data-gc-probe="1"]'),
    gap: Math.round(b.scrollHeight - b.scrollTop - b.clientHeight),
    vis: !document.getElementById('page-group-chat').hidden,
    lastTxt: b.lastElementChild ? (b.lastElementChild.textContent || '').slice(-30) : '' };
`);

// ---- A0：首进群渲染 ----
await openCold();
await seedGroup(120, 'v1');
await openCold();
await enterGc();
await sleep(1500);
let st = await gcState();
ok('A0 首进群渲染出消息窗口', st && st.vis && st.kids > 50, JSON.stringify(st));
ok('A0b 首进群贴底', st && st.gap <= 12, 'gap=' + (st && st.gap));
const mark = await evalJs(`
  var b = document.getElementById('gc-body');
  var first = b.querySelector('.msg');
  if (!first) return false;
  first.dataset.gcProbe = '1';
  return true;
`);
ok('A0c 标记首个气泡节点', mark === true);

// ---- A1/A2：同窗重进不重建 ----
await backGc();
await sleep(900);
await enterGc();
await sleep(1200);
st = await gcState();
ok('A1 同窗重进：标记节点仍在＝未整窗重建', st && st.probe === true, JSON.stringify(st));
ok('A1b 同窗重进：窗口条数不变', st && st.kids >= 100, 'kids=' + (st && st.kids));
ok('A2 跳过路径仍回底', st && st.gap <= 12, 'gap=' + (st && st.gap));

// ---- A3：离开期间来新消息 → 照旧重建 + 权威复核不二次 ----
await backGc();
await sleep(900);
await seedGroup(125, 'v2');
await enterGc();
await sleep(1500);
const st3 = await gcState();
ok('A3 变化路径：标记节点消失＝照旧整窗重建', st3 && st3.probe === false, JSON.stringify(st3));
ok('A3b 新窗口含新消息（v2 标记在末条文案）', st3 && st3.lastTxt.indexOf('v2消息124') >= 0, 'lastTxt=' + (st3 && st3.lastTxt));
await sleep(1200); // 等权威（#772）复核窗口
const st3b = await gcState();
ok('A3c 权威复核不二次重建（条数稳定且无空窗）', st3b && st3b.kids === st3.kids && st3b.kids > 50, st3.kids + '→' + (st3b && st3b.kids));
ok('A3d 重建后贴底', st3b && st3b.gap <= 12, 'gap=' + (st3b && st3b.gap));

// ---- A4：contact-switched 挂起脏标记 → 强制重建 ----
const mark4 = await evalJs(`
  var b = document.getElementById('gc-body');
  var first = b.querySelector('.msg');
  if (!first) return false;
  first.dataset.gcProbe = '1';
  return true;
`);
ok('A4a 二次标记', mark4 === true);
await backGc();
await sleep(700);
await evalJs(`document.dispatchEvent(new Event('contact-switched')); return true;`);
await sleep(400);
await enterGc();
await sleep(1200);
const st4 = await gcState();
ok('A4 脏标记强制重建（标记节点消失）', st4 && st4.probe === false, JSON.stringify(st4));

// ---- A5：成员头像变了 → 指纹变 → 重建 ----
const mark5 = await evalJs(`
  var b = document.getElementById('gc-body');
  var first = b.querySelector('.msg');
  if (!first) return false;
  first.dataset.gcProbe = '1';
  return true;
`);
ok('A5a 三次标记', mark5 === true);
await backGc();
await sleep(700);
const av = await evalJs(`
  var cs = (window.getContacts && window.getContacts()) || [];
  if (!cs.length) return 'no-contacts';
  var cid = cs[0].id;
  try { window.storeFor(cid).set('cs-avatar-partner', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='); } catch (e) { return 'set-fail:' + e.message; }
  return cid;
`);
await enterGc();
await sleep(1200);
const st5 = await gcState();
ok('A5 成员头像变了＝指纹变＝重建（标记节点消失）', st5 && st5.probe === false && String(av).indexOf('no-contacts') < 0 && String(av).indexOf('set-fail') < 0, JSON.stringify(st5) + ' av=' + av);

// ---- S：产物锚点 ----
let art = '';
try { art = readFileSync(join(root, 'js', 'group-chat.js'), 'utf8'); } catch (e) {}
if (!art) { try { art = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e2) {} }
ok('S1 进群同窗跳过判定在产物', art.includes('if (!gcSwitchDirty && body.children.length && gcEntrySig() === gcRenderedFp) {'));
ok('S2 renderAll 指纹登记在产物', art.includes('gcRenderedFp = gcEntrySig(); //'));

// ---- Z：零 JS 异常 ----
const errs = await evalJs('return (window.__jsErrors || []).length;');
ok('Z 全程零 JS 异常', errs === 0, 'errors=' + errs);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);

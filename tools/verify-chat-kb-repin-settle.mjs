// #868 常驻行为回归：聊天「键盘收起 / 全屏切换」那一下的回钉必须**只在几何落定后写一枪**。
// 报障（红米 K80 Chrome，用户点名其他型号同现）：「发送消息后收起输入法弹窗，聊天消息还是会
// 闪屏回弹一下、然后恢复正常」；「主动开/关全屏模式也会闪屏」。
// 判据（全部是可测的几何事实，零机型分支）：
//   A0 前置＝两次变形确实换了聊天盒高度，且「键盘弹起」那一下非写不可（不写就看不到最新消息）——防假绿；
//   A1/A2 变形落定才写＝每一笔 scrollTop 写入时聊天盒 clientHeight 已等于该相位的落定值
//        （旧写法 60ms 单发会打在中间态高度上＝按「假底部」写一次，布局真落地后再校正一次＝回弹）；
//   A3 一次变形只写一枪＝收键盘期内写入的目标位置（±2px 合并）至多 1 个；
//   A4 画面不跳＝逐帧视觉锚点（第一个可见气泡相对容器顶的偏移，同一气泡才可比）帧间变化 ≤30px；
//   A5 观察窗内零新消息扰动（判据只作用几何）；
//   A6/A7 两相位的末态都必须真的贴底（|chatScrollMax()-scrollTop| ≤8）——防止「干脆不校正」也算过：
//        贴底本来就是 #466/#643 的原契约，落定锁只能推迟这一枪，不能取消它；
//   S 组＝产物侧锚点。
// 环境前提：A2/A3 只在「收键盘是分帧快速落位」时才有意义。机器被占满时 CDP 改视口的往返会拉到
// 几百毫秒，中间态成了准稳态（此时按当档高度写底本就是正确行为）→ 脚本自动重试，三次仍如此则
// exit 2 判「环境不满足」（不是产品回归，verify-suite 会单列一类）。
// 用法：node tools/verify-chat-kb-repin-settle.mjs [被测根目录]（缺省＝脚本所在仓库）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-868-' + Date.now()),
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
await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('return !!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(500);
}
async function seed(N) {
  return evalJs(`
    var P = window.activePrefix();
    var now = Date.now(), full = [];
    for (var i = 0; i < ${N}; i++) full.push({ side: i % 2 ? 'in' : 'out', text: (i % 2 ? '对方消息' : '我的消息') + i, ts: now - (${N} - i) * 60000 });
    await window.idbSet(P + ':chat-msgs', JSON.stringify(full));
    await window.idbSet(P + ':chat-meta', JSON.stringify({ n: full.length, t: Date.now() }));
    localStorage.setItem(P + ':chat-msgs', JSON.stringify(full.slice(-30)));
    return ${N};
  `);
}
// 探针：①#chat-body 每一笔 scrollTop 写入（连同写入时的盒高）②逐帧视觉锚点 ③页内相位标记
const PROBE = `
  window.__w868 = []; window.__s868 = []; window.__m868 = [];
  var b = document.getElementById('chat-body');
  if (!window.__hook868) {
    window.__hook868 = 1;
    var d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(b, 'scrollTop', { configurable: true,
      get: function () { return d.get.call(this); },
      set: function (v) { if (window.__w868) window.__w868.push({ t: Math.round(performance.now()), v: Math.round(v), ch: Math.round(b.clientHeight), sh: Math.round(b.scrollHeight) }); return d.set.call(this, v); } });
  }
  window.__mark868 = function (tag) { window.__m868.push([tag, Math.round(performance.now())]); return tag; };
  function anchor() {
    var kids = b.children, br = b.getBoundingClientRect().top;
    for (var i = 0; i < kids.length; i++) { var r = kids[i].getBoundingClientRect(); if (r.bottom > br + 1) return [kids[i].dataset.idx || '?', Math.round(r.top - br)]; }
    return ['?', 0];
  }
  var typ = document.getElementById('chat-typing'); // 与站内 chatScrollMax 同口径（该函数不在 window 上，故本地复算）
  var tok = (window.__tok868 = (window.__tok868 || 0) + 1); // 上一轮采样就此停手
  (function loop() {
    var typingH = typ && !typ.hidden && typ.offsetHeight ? typ.offsetHeight : 0;
    var gap = Math.max(0, b.scrollHeight - (b.clientHeight + typingH)) - b.scrollTop;
    window.__s868.push([Math.round(performance.now()), Math.round(b.scrollTop), Math.round(b.clientHeight), b.children.length, anchor(), Math.round(b.scrollHeight), Math.round(gap)]);
    if (window.__tok868 === tok) requestAnimationFrame(loop);
  })();
  return 'probing';
`;
const PULL = "return { w: window.__w868 || [], s: window.__s868 || [], m: window.__m868 || [], err: (window.__jsErrors || []).length };";

// 相位＝两次标记之间（up＝键盘弹起期，down＝收键盘期）；各相位末态盒高取该相位最后一帧
function judge(r) {
  const s = (r && r.s) || [], w = (r && r.w) || [], m = (r && r.m) || [];
  const tUp = m.length >= 1 ? m[0][1] : 0;
  const tDown = m.length >= 2 ? m[1][1] : Infinity;
  const sUp = s.filter((f) => f[0] >= tUp && f[0] < tDown);
  const sDown = s.filter((f) => f[0] >= tDown);
  const wUp = w.filter((x) => x.t >= tUp && x.t < tDown);
  const wDown = w.filter((x) => x.t >= tDown);
  const chUp = sUp.length ? sUp[sUp.length - 1][2] : 0;
  const chDown = sDown.length ? sDown[sDown.length - 1][2] : 0;
  console.log('  [测量] 弹起期 ' + sUp.length + ' 帧 / 写入 ' + wUp.length + ' 笔（落定盒高 ' + chUp + '）；'
    + '收键盘期 ' + sDown.length + ' 帧 / 写入 ' + wDown.length + ' 笔（落定盒高 ' + chDown + '）');
  console.log('  [测量] 收键盘期写入位=' + JSON.stringify(wDown.map((x) => x.v + '@ch' + x.ch)) + ' 弹起期写入位=' + JSON.stringify(wUp.map((x) => x.v + '@ch' + x.ch)));
  ok('A0 前置：聊天盒确实两档换高、且弹起期真写了一枪（回钉链已上膛）',
    !!chUp && !!chDown && Math.abs(chUp - chDown) > 30 && wUp.length >= 1,
    'chUp=' + chUp + ' chDown=' + chDown + ' 弹起期写入=' + wUp.length);
  const staleUp = wUp.filter((x) => Math.abs(x.ch - chUp) > 2);
  const staleDown = wDown.filter((x) => Math.abs(x.ch - chDown) > 2);
  ok('A1 弹起期每笔写入都落在落定盒高上（无中间态写入）', staleUp.length === 0,
    '越界=' + JSON.stringify(staleUp.slice(0, 3)) + ' 落定=' + chUp);
  ok('A2 收键盘期每笔写入都落在落定盒高上（旧写法在这里按压缩态高度补一枪＝回弹源头）', staleDown.length === 0,
    '越界=' + JSON.stringify(staleDown.slice(0, 3)) + ' 落定=' + chDown);
  const slots = [];
  wDown.forEach((x) => { if (!slots.some((v) => Math.abs(v - x.v) <= 2)) slots.push(x.v); });
  ok('A3 收键盘期把画面写到的位置至多一个（一次变形只校正一枪）', slots.length <= 1, '写入位=' + JSON.stringify(slots));
  let jump = 0, sample = '';
  for (let i = 1; i < sDown.length; i++) {
    const a0 = sDown[i - 1][4], a1 = sDown[i][4];
    if (!a0 || !a1 || a0[0] !== a1[0]) continue;
    if (Math.abs(a1[1] - a0[1]) > 30) { jump++; if (!sample) sample = a0.join('@') + '→' + a1.join('@') + ' @t' + sDown[i][0]; }
  }
  ok('A4 收键盘期逐帧视觉锚点无 >30px 跳动（肉眼所见「闪一下回弹」）', jump === 0, '跳动=' + jump + ' ' + sample);
  ok('A5 收键盘观察窗内零新消息扰动', sDown.every((f) => f[3] === (sDown[0] || [0, 0, 0, 0])[3]),
    '首帧 kids=' + ((sDown[0] || [])[3]) + ' 末帧 kids=' + ((sDown[sDown.length - 1] || [])[3]));
  const gUp = sUp.length ? sUp[sUp.length - 1][6] : null;
  const gDown = sDown.length ? sDown[sDown.length - 1][6] : null;
  console.log('  [测量] 末帧贴底离距：弹起期=' + gUp + 'px 收键盘期=' + gDown + 'px');
  ok('A6 弹起期末态确实贴底（回钉没被闸成永不校正）', gUp !== null && Math.abs(gUp) <= 8, 'gap=' + gUp);
  ok('A7 收键盘期末态确实贴底（最新消息不悬在半屏＝#466/#643 原契约）', gDown !== null && Math.abs(gDown) <= 8, 'gap=' + gDown);
}

// 一次「收键盘」在真机上是**分帧落位**的（输入法收起动画、mobile-adapt 恢复 .phone 内联高、
// 地址栏回弹各来一跳），无头环境里若只 setMetrics 一步到位，中间态根本不存在（实测红产物也全绿＝
// 假绿陷阱）。故这里按真机形态把回弹拆成三档、每档间隔 90ms（< 旧写法 60ms 防抖落定后的一枪），
// 让「按压缩态高度补一枪」这笔写入真实发生——这正是要拦的那件事本身，不是造出来的条件。
const RAMP = [[640, 90], [760, 90], [844, 0]];
async function kbCycle() {
  await evalJs(PROBE);
  await evalJs("document.getElementById('chat-input').focus(); window.__mark868('up'); return true;");
  await setMetrics(500);
  await sleep(1400);
  await evalJs("window.__mark868('down'); return true;");
  for (const [h, wait] of RAMP) { await setMetrics(h); if (wait) await sleep(wait); }
  await sleep(1800);
  return evalJs(PULL);
}
// 本脚本的判别力全押在「收键盘是分帧快速落位」这个前提上：机器一忙，CDP 的 setMetrics 往返被拉到
// 几百毫秒，中间态就成了准稳态（此时按中间态写底＝正确行为，A2/A3 失去意义＝假红）。故先量一下
// 收键盘期每一档盒高实际持续了多久：非末档持续 ≥170ms（闸值 180ms）判「环境不满足」，换机/等待后重试。
function stallMs(r) {
  const m = (r && r.m) || [], s = (r && r.s) || [];
  const tDown = m.length >= 2 ? m[1][1] : Infinity;
  const run = s.filter((f) => f[0] >= tDown);
  let worst = 0, i = 0;
  while (i < run.length) {
    let j = i;
    while (j + 1 < run.length && Math.abs(run[j + 1][2] - run[i][2]) <= 2) j++;
    if (j + 1 < run.length) worst = Math.max(worst, run[j][0] - run[i][0]); // 末档持续到观察窗结束，不计
    i = j + 1;
  }
  return worst;
}
async function runScenario() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await kbCycle();
    if (!r || !(r.s || []).length) { console.error('采样为空，判环境不满足'); chrome.kill(); server.close(); process.exit(2); }
    const st = stallMs(r);
    if (st < 170) { console.log('  [环境] 收键盘各中间档最长持续 ' + st + 'ms（<170ms＝真分帧落位）'); judge(r); return r; }
    console.log('  [环境] 中间档最长持续 ' + st + 'ms ≥170ms＝机器负载把分帧落位拉成准稳态，A2/A3 不可判，第 ' + attempt + ' 次重试');
    await sleep(4000);
  }
  console.error('环境不满足：三次尝试均把收键盘中间态拉成准稳态（CPU 被占满），非产品回归');
  chrome.kill(); server.close(); process.exit(2);
}

await openPage();
await seed(120);
await openPage();
await evalJs("document.querySelector('.app[data-app=\"chat\"]').click(); return true;");
await sleep(3500);
if (await evalJs("return document.getElementById('chat-body').children.length;") < 100) {
  console.error('夹具未铺满聊天列表（<100 条），判环境不满足'); chrome.kill(); server.close(); process.exit(2);
}

console.log('\n### 场景 A：聚焦输入栏 → 键盘弹起（视口压到 500）→ 收键盘（回 844），其间零新消息');
await sleep(3000); // 刚构建完时机器常忙，先让 CPU 空下来再量几何
const rA = await runScenario();

console.log('\n### 场景 B：报障原景——发一条消息 → 等 TA 回复落定（屏上条数稳定）→ 再走一次收键盘');
await evalJs(`
  var i = document.getElementById('chat-input'), sn = document.getElementById('chat-send');
  i.focus(); i.value = '键盘收起这条 ' + Date.now();
  i.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 150); });
  sn.click(); return 'sent';
`);
let lastN = -1, stable = 0;
for (let i = 0; i < 60 && stable < 3; i++) {
  await sleep(500);
  const n = await evalJs("return document.getElementById('chat-body').children.length;");
  stable = n === lastN ? stable + 1 : 0; lastN = n;
}
await sleep(700);
const rB = await runScenario();

console.log('\n### S 组：产物侧锚点');
const html = readFileSync(join(root, 'index.html'), 'utf8');
ok('S1 落定闸在位（视口/盒子/滚动三静默才写）', html.includes('now - _cbBoxChangeTs >= 180'));
ok('S2 RO 把盒子变化记成「还在变形」的证据', html.includes('_cbBoxChangeTs = Date.now();'));
ok('S3 看门狗同样让路给「盒子还在变」', html.includes('if (Date.now() - _cbBoxChangeTs < 180) return;'));
ok('S4 旧的两枪 60ms 单发已下线（#466/#643 都改走落定锁）',
  !html.includes('_kbRepinT = setTimeout') && !html.includes('if (t643) clearTimeout(t643);'),
  '仍在＝回钉又自己定时刻，中间态写入回归');
ok('S5 全程零 JS 异常', ((rA.err || 0) === (rB.err || 0)) && (rB.err || 0) === 0, 'err=' + rA.err + '/' + rB.err);

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' 通过 ' + pass + ' / 失败 ' + fail);
chrome.kill(); server.close();
process.exit(fail === 0 ? 0 : 1);

// ===== 专项验证 #856：边看边调「微调」分区里可更换「联系人主动发消息」的标识图案 =====
// 需求（用户原话）：「聊天设置的美化里的边看边调功能里。微调功能里缺少更换联系人主动发消息的标识图案」
//   原状＝#727 的标识池只有设置页那套 chips（回复设置→聊天→主动发送→标识），
//   抽屉「微调」分区只有标识/时间轴四条位置滑杆——换一枚图案得退出抽屉、跨一个页面找入口。
// 断言面：
//   A 视图在位（微调分区有标识块：内置五枚＋「＋」；默认只亮爱心＝#727 那套默认值；
//     屏上两条「TA 主动发来」的消息各带一枚爱心；抽屉只画视图，池的读写口全部来自 reply-settings.js）
//   B 换图案即时生效（点亮/取消写盘＋屏上真消息那两枚当场跟着变），且**只换标识节点、不整窗重建**
//     （#846 同族：整窗重建＝肉眼闪屏）；≥2 枚才出「抽取方式」行；池全关兜底回爱心
//   C 显示/隐藏总开关（reply-as-badge 写盘＋标识消失/回来）
//   D 自定义标识与设置页同源（同一条校验、同一个存储串、#asb-chips 一起刷新）
//   E 空对话时示例气泡显示的也是当前标识（不再是占位串 *~*）＋刷新后点亮态按存储重画＋零 JS 异常
// 用法：
//   node tools/verify-badge-tune.mjs          # 对 src 组合页（GREEN）
//   node tools/verify-badge-tune.mjs --red    # 本批两份源文件退回 HEAD＝判别力基线（应红在标识块/换图案面）
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const RED = process.argv.includes('--red');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
// RED＝只把本批两份源文件退回 HEAD（其余文件保持工作树原样，不把别的在途批算进红绿对照）
const overrides = {};
if (RED) {
  ['src/js/chat-settings.js', 'src/js/reply-settings.js'].forEach((f) => {
    overrides[f.split('/').pop()] = execFileSync('git', ['show', 'HEAD:' + f], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  });
}
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  const src = overrides[f] !== undefined ? overrides[f] : readFileSync(join(root, 'src/js', f), 'utf8');
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-badge-tune' + (RED ? '-red' : '')).split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-bt-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-bt-prof-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__seed') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end('<!doctype html><title>seed</title>'); return; }
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
async function navigate(u) { await cdp('Page.navigate', { url: u }); await sleep(4500); }
const url = baseUrl + '/index.html';
// 夹具：两个桌面 + 当前桌面三条聊天记录（两条「TA 主动发来」initiative:true、一条我发的）
// ——标识只出现在主动发来的入站气泡上，所以必须喂真数据，不能只靠示例气泡。
const REG_SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  return true;
})()`;
const SEED_MSGS = `(async function () {
  var t = Date.now();
  var arr = [
    { ts: t - 600000, side: 'in', text: '在忙吗', initiative: true },
    { ts: t - 590000, side: 'out', text: '在的呀' },
    { ts: t - 580000, side: 'in', text: '想你了', initiative: true }
  ];
  localStorage.setItem('xy-home-v2:cta:chat-msgs', JSON.stringify(arr));
  try { await window.idbSet('xy-home-v2:cta:chat-msgs', JSON.stringify(arr)); } catch (e) {}
  return true;
})()`;
async function boot() {
  await navigate('about:blank');
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
  await navigate(baseUrl + '/__seed');
  await evalJs(REG_SEED);
  await navigate(url);
  await evalJs(SEED_MSGS);
  await navigate(url);
}
// 抽屉里按文本点按钮（分区胶囊、标识 chips、胶囊行都用这一个）
const CLICK_BTN = (txt) => `(function(){ var d=document.getElementById('chat-beauty-drawer'); if(!d) return false;
  var bs=d.querySelectorAll('button'); for (var i=0;i<bs.length;i++){ if(bs[i].textContent===${JSON.stringify(txt)}){ bs[i].click(); return true; } } return false; })()`;
// 快照：微调分区三组控件（标识 chips / 显示标识 / 多枚抽取）＋屏上标识＋存储＋设置页那侧点亮的 chips
// 选中态按「计算后的背景色偏深」判（选中项走 var(--ink) 深底、未选走浅底）。读 inline style 会被
// var() 归一化坑到（实测拿不到值），按「同组只有一枚不同」判则在点亮≥2 枚时失效。
const SNAP = `(function(){
  var d=document.getElementById('chat-beauty-drawer'); if(!d) return null;
  function isDark(b){
    var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(getComputedStyle(b).backgroundColor);
    return !!m && (Number(m[1]) + Number(m[2]) + Number(m[3])) < 260;
  }
  function grp(sp){
    var bs=Array.prototype.slice.call(sp.parentNode.querySelectorAll('button'));
    return { labels: bs.map(function(b){ return b.textContent; }).join(''),
      lit: bs.map(function(b){ return b.textContent + (isDark(b) ? '*' : ''); }).join(',') };
  }
  var chips = { labels: '', lit: '' };
  d.querySelectorAll('span').forEach(function(sp){
    if((sp.textContent||'').indexOf('标识图案') !== 0) return;
    var g = grp(sp); chips.labels = g.labels; chips.lit = g.lit;
  });
  var pills = {};
  d.querySelectorAll('span').forEach(function(sp){
    var t=(sp.textContent||'').trim();
    if(t !== '显示标识' && t !== '多枚标识怎么抽取') return;
    pills[t] = grp(sp, false).lit;
  });
  var body=document.getElementById('chat-body'); var marks=[];
  body.querySelectorAll('.msg-hi-mark,.msg-hi-heart').forEach(function(n){
    marks.push((n.getAttribute('class')||'').indexOf('msg-hi-heart') >= 0 ? '\u2665' : n.textContent);
  });
  var setChips=[];
  document.querySelectorAll('#asb-chips .ppy-chip').forEach(function(c){
    if(c.className.indexOf('sel') >= 0) setChips.push((c.textContent||'').replace('\u00d7',''));
  });
  return { chips: chips, pills: pills, marks: marks, msgCount: body.querySelectorAll('.msg').length, setChips: setChips.join(','),
    ls: { badge: localStorage.getItem('xy-home-v2:cta:reply-as-badge'),
      heart: localStorage.getItem('xy-home-v2:cta:reply-as-badge-heart'),
      star: localStorage.getItem('xy-home-v2:cta:reply-as-badge-star'),
      rand: localStorage.getItem('xy-home-v2:cta:reply-as-badge-rand'),
      cust: localStorage.getItem('xy-home-v2:cta:reply-as-badge-custom') } };
})()`;
// 在 chat-body 上装顶层 childList 观察器（顶层增删＝整窗重建的证据），并给屏上气泡打探针
const ARM = `(function(){ var b=document.getElementById('chat-body');
  window.__topChanges=0; if(window.__btObs) window.__btObs.disconnect();
  window.__btObs=new MutationObserver(function(ms){ ms.forEach(function(m){ window.__topChanges+=m.addedNodes.length+m.removedNodes.length; }); });
  window.__btObs.observe(b,{childList:true});
  Array.prototype.forEach.call(b.querySelectorAll('.msg'), function(m,i){ m.dataset.btProbe=String(i); });
  return b.querySelectorAll('.msg').length; })()`;
const PROBE = `(function(){ var b=document.getElementById('chat-body');
  return { changes: window.__topChanges, alive: b.querySelectorAll('.msg[data-bt-probe]').length }; })()`;

const HEART = '\u2665', STAR = '\u2605', MOON = '\u263e', SPARK = '\u2726', PAW = '\ud83d\udc3e', PLUS = '\uff0b', FLOWER = '\u2740';

await cdpConnect();
await cdp('Runtime.enable');
await boot();

// 进聊天设置 → 开抽屉 → 切到「微调」分区
const nav = await evalJs(`(function(){
  var app=document.querySelector('.app[data-app="chat"]'); if(app) app.click();
  var g=document.getElementById('chat-settings-btn'); if(g) g.click();
  var b=document.getElementById('cs-live-adjust'); if(b) b.click();
  return { btn: !!b, chatVisible: !document.getElementById('page-chat').hidden };
})()`);
await sleep(600);
const secOk = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer'); if(!d) return false;
  var c=d.querySelector('button[data-sec="tune"]'); if(!c) return false; c.click(); return true; })()`);
await sleep(300);
let s = await evalJs(SNAP);
ok('A0 前置：抽屉开到「微调」分区，屏上有夹具的三条消息', !!(nav && nav.btn && secOk && s && s.msgCount >= 3), { nav, secOk, s: s && { msgCount: s.msgCount } });

console.log('== A 微调分区里的标识块 ==');
ok('A1 有标识块：内置五枚 chips ＋「＋添加」（♥★☾✦🐾＋）',
  !!s && s.chips.labels === HEART + STAR + MOON + SPARK + PAW + PLUS, s && s.chips);
ok('A2 默认点亮态＝只有爱心亮（#727 默认 heart=1、其余 0，抽屉读的是同一份默认）',
  !!s && s.chips.lit === [HEART + '*', STAR, MOON, SPARK, PAW, PLUS].join(','), s && s.chips);
ok('A3 屏上两条「TA 主动发来」的消息各带一枚爱心标识（夹具数据 ＋ 渲染侧 #727 口径）',
  !!s && s.marks.length === 2 && s.marks.join('') === HEART + HEART, s && s.marks);
const api = await evalJs(`({ items: typeof window.asBadgeItems, toggle: typeof window.asBadgeToggle, add: typeof window.asBadgeAdd, write: typeof window.asBadgeWrite, node: typeof window.asBadgeNode, refresh: typeof window.asBadgeRefreshMarks })`);
ok('A4 抽屉只画视图：池的读写口全在 reply-settings.js（items/toggle/add/write/node/refresh）',
  !!api && Object.keys(api).every(k => api[k] === 'function'), api);

console.log('== B 换图案即时生效（且不整窗重建） ==');
const armN = await evalJs(ARM);
const litStar = await evalJs(CLICK_BTN(STAR));
await sleep(300);
s = await evalJs(SNAP);
ok('B1 点「★」→ 写盘 reply-as-badge-star=1（与设置页同一批键、随当前桌面隔离）',
  litStar === true && !!s && s.ls.star === '1' && /\u2605\*/.test(s.chips.lit), s && { ls: s.ls, lit: s.chips.lit });
ok('B2 点亮第二枚后才出「抽取方式」行（一枚无意义，与设置页同口径）',
  !!s && s.pills['多枚标识怎么抽取'] === '每次随机*,按顺序轮换', s && s.pills);
ok('B2c 前置：默认「显示标识」＝亮「显示」，胶囊初态也读得到',
  !!s && s.pills['显示标识'] === '显示*,不显示', s && s.pills);
const p0 = await evalJs(PROBE);
ok('B2b 这一路改动 chat-body 顶层零增删、屏上气泡仍是同一批元素', !!p0 && p0.changes === 0 && p0.alive === armN, { p0, armN });
const unHeart = await evalJs(CLICK_BTN(HEART));
await sleep(300);
s = await evalJs(SNAP);
const p1 = await evalJs(PROBE);
ok('B3 取消「♥」→ 屏上那两枚标识当场换成 ★（真消息也跟着变，换图案即时可见）',
  unHeart === true && !!s && s.ls.heart === '0' && s.marks.length === 2 && s.marks.join('') === STAR + STAR, s && { ls: s.ls, marks: s.marks });
ok('B4 就地刷新＝只换标识节点、不整窗重建（顶层零增删、气泡仍是原来那几个元素）——防 #846 闪屏回归',
  !!p1 && p1.changes === 0 && p1.alive === armN, p1);
const lastOff = await evalJs(CLICK_BTN(STAR));
await sleep(300);
s = await evalJs(SNAP);
ok('B5 池内全关 → 兜底回爱心（#727 既有口径：抽屉里也不把标识调没了）',
  lastOff === true && !!s && s.marks.join('') === HEART + HEART, s && s.marks);
ok('B6 只剩一枚时「抽取方式」行收回', !!s && !s.pills['多枚标识怎么抽取'], s && s.pills);
const l1 = await evalJs(CLICK_BTN(STAR));
await sleep(300);
const l2 = await evalJs(CLICK_BTN(HEART));
await sleep(300);
const rot = await evalJs(CLICK_BTN('按顺序轮换'));
await sleep(300);
s = await evalJs(SNAP);
ok('B7 点亮两枚后「按顺序轮换」写盘 reply-as-badge-rand=0（两枚都在池里，屏上仍各有标识）',
  l1 === true && l2 === true && rot === true && !!s && s.ls.rand === '0' && s.marks.length === 2, s && { ls: s.ls, marks: s.marks });
// 收摊：关掉 ♥，只留 ★ 亮，给 C 组一个确定的起点
await evalJs(CLICK_BTN(HEART));
await sleep(300);

console.log('== C 显示 / 隐藏总开关 ==');
const hide = await evalJs(CLICK_BTN('不显示'));
await sleep(300);
s = await evalJs(SNAP);
ok('C1 「显示标识→不显示」→ reply-as-badge=0 且屏上标识全部消失',
  hide === true && !!s && s.ls.badge === '0' && s.marks.length === 0, s && { ls: s.ls, marks: s.marks });
const show = await evalJs(CLICK_BTN('显示'));
await sleep(300);
s = await evalJs(SNAP);
ok('C2 再点「显示」→ 标识回来（此时池里只剩 ★）', show === true && !!s && s.ls.badge === '1' && s.marks.join('') === STAR + STAR, s && { ls: s.ls, marks: s.marks });
// 把 ★ 也关掉：池为空＝渲染侧兜底爱心。D 组新增唯一一枚 ❀ 后，屏上那枚才会从兜底爱心换成 ❀
await evalJs(CLICK_BTN(STAR));
await sleep(300);

console.log('== D 自定义标识与设置页同源 ==');
const bads = await evalJs(`(function(){ var p=function(v){ var r=window.asBadgeAdd?window.asBadgeAdd(v):{ok:null,msg:null}; return [r.ok, r.msg]; };
  return { empty: p('  '), long: p(' abcdefgh '), builtin: p('\u2665') }; })()` || { empty: [], long: [], builtin: [] });
ok('D1 校验与设置页同一条（空/超 4 字/内置码值各拦各的）',
  bads.empty[0] === false && bads.empty[1] === '没有输入标识' &&
  bads.long[0] === false && bads.long[1] === '标识最长 4 个字符' &&
  bads.builtin[0] === false && bads.builtin[1] === '这是系统自带标识，点亮对应 chip 即可', bads);
const dup = await evalJs(`(function(){ if(!window.asBadgeAdd) return [null,null,null];
  var a=window.asBadgeAdd('\u2740'); var b=window.asBadgeAdd('\u2740'); return [a.ok, b.ok, b.msg]; })()`);
ok('D2 新增一枚自定义、并拦住重复添加', dup[0] === true && dup[1] === false && dup[2] === '该自定义标识已存在', dup);
// D3 前按「＋」按钮的同款链路补两步：asBadgeRefreshMarks 换屏上标识 ＋ 点分区胶囊重画本区视图
await evalJs(`(function(){ if(window.asBadgeRefreshMarks) window.asBadgeRefreshMarks();
  var c=document.querySelector('#chat-beauty-drawer button[data-sec="tune"]'); if(c) c.click(); return true; })()`);
await sleep(300);
s = await evalJs(SNAP);
ok('D3 抽屉 chips 出现「❀」且已点亮，屏上标识跟着变成它',
  !!s && s.chips.labels.indexOf(FLOWER) >= 0 && new RegExp(FLOWER + '\\*').test(s.chips.lit) && s.marks.join('') === FLOWER + FLOWER,
  s && { chips: s.chips, marks: s.marks });
ok('D4 设置页 #asb-chips 同步出这枚（同一份数据、两处视图，asbSync 一起刷新）',
  !!s && (s.setChips || '').indexOf(FLOWER) >= 0, s && s.setChips);
const cust = await evalJs(`(function(){ try { return JSON.parse(localStorage.getItem('xy-home-v2:cta:reply-as-badge-custom')||'[]'); } catch(e){ return null; } })()`);
ok('D5 自定义存 reply-as-badge-custom＝JSON [{s,on}]（与 #727 口径逐字一致）',
  Array.isArray(cust) && cust.length === 1 && cust[0].s === FLOWER && cust[0].on === 1, cust);

console.log('== E 空对话预览 / 刷新后状态 / 运行期健康 ==');
// 清屏后重开抽屉＝空对话路径：示例气泡自带的占位串要被换成当前标识
await evalJs(`(function(){ var b=document.getElementById('chat-body'); b.innerHTML='';
  var e=document.getElementById('cs-live-adjust'); if(e) e.click(); return true; })()`);
await sleep(500);
await evalJs(`(function(){ var c=document.querySelector('#chat-beauty-drawer button[data-sec="tune"]'); if(c) c.click(); })()`);
await sleep(300);
s = await evalJs(SNAP);
ok('E1 空对话注入示例气泡，其标识＝当前池那枚（不再是占位串 *~*）',
  !!s && s.msgCount === 2 && s.marks.join('') === FLOWER, s && { msgCount: s.msgCount, marks: s.marks });
const e0 = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(0,5); })()`);
ok('E2 到这一步零 JS 异常', Array.isArray(e0) && e0.length === 0, e0);
const pre = await evalJs(`(function(){ return { heart: localStorage.getItem('xy-home-v2:cta:reply-as-badge-heart'), star: localStorage.getItem('xy-home-v2:cta:reply-as-badge-star'), cust: localStorage.getItem('xy-home-v2:cta:reply-as-badge-custom') }; })()`);
await navigate(url);
await sleep(4200);
await evalJs(`(function(){
  var app=document.querySelector('.app[data-app="chat"]'); if(app) app.click();
  var g=document.getElementById('chat-settings-btn'); if(g) g.click();
  var b=document.getElementById('cs-live-adjust'); if(b) b.click(); return true; })()`);
await sleep(600);
await evalJs(`(function(){ var c=document.querySelector('#chat-beauty-drawer button[data-sec="tune"]'); if(c) c.click(); })()`);
await sleep(300);
s = await evalJs(SNAP);
ok('E3 刷新后重开抽屉：点亮态按存储重画（内置全灭、只有自定义 ❀ 亮），不是每次回到默认',
  !!s && s.chips.lit === [HEART, STAR, MOON, SPARK, PAW, FLOWER, PLUS].map((g, i) => i === 5 ? g + '*' : g).join(',') && pre.heart === '0' && pre.star === '0',
  { pre, lit: s && s.chips.lit });
const e3 = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(0,5); })()`);
ok('E4 全程（含刷新重开）零 JS 异常', Array.isArray(e3) && e3.length === 0, e3);

console.log('\n' + (RED ? '[RED 基线] ' : '') + '通过 ' + pass + ' / 失败 ' + fail);
try { chrome.kill(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);

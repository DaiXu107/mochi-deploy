// ===== 专项验证：边看边调「切换气泡框大小会闪屏」根治（v3.26.x #938） =====
// 需求（用户原话，红米 K80 Chrome 实报）：「聊天设置的美化 边看边调里，切换气泡框大小的模式，会闪屏；
//   其他设备型号也有出现；不要覆盖修改导致不同型号浏览器 bug 反复出现。」并点名检查抽屉里其余闪屏面。
// 根因（无头实测：整页 MutationObserver ＋ 实例级 setProperty/classList.remove 写入探针）：抽屉里一切控件
//   （框大小/字号/透明度/圆角/颜色/发送按钮/壁纸档位）都汇进 applySettings()，而它每次都**无条件重写**：
//   :root 16 条内联自定义属性（全站继承＝整篇文档样式作用域重解析）＋ #page-chat 若干条（壁纸层与数百条
//   气泡的共同祖先）＋ 两记空 classList.remove('cs-bg-*')＋挂过时间轴类时 8 次 body class 翻转＋head 里
//   #cs-bubble-enforce 先拆后建。值一点没变也照样全部白写一遍＝手机 GPU 重合成期间多出一帧空白＝「闪一下」。
//   修法＝统一「值变才写」（与 v3.6.x 壁纸守卫、#923 家族同口径），零机型分支，值真变的路径一字未动。
// 用例组：
//   S1~S2 源码锚（#938a/#938b 各自唯一）｜S3~S10 本批八处「值变才写」守卫逐条在位且唯一
//   P0 探针自证：同值 setProperty / removeProperty / 空 classList.remove 一律计得到（防探针哑掉＝假绿）
//   B1~B6 点各分区各控件＝body class / head STYLE 零翻动 + 写入面零白算（w.vars/w.cls），且设定值照常即时生效（防修过头）
//   B7~B9 时间轴样式真切换仍然落位（挂类/换类/摘类三态＋真换档时七档清扫照做），换完再点别的控件依旧零翻动
//   Z  抽屉交互期间零 JS 异常
// 用法：
//   node tools/verify-cs-body-churn.mjs          # 当前源码（GREEN）
//   node tools/verify-cs-body-churn.mjs --red    # 把本批整族守卫还原成修前无条件写入形态（判别力基线）
import { spawn } from 'node:child_process';
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
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
const srcCs = readFileSync(join(root, 'src/js/chat-settings.js'), 'utf8');
// S 组直接对源码文本断言（RED 模式先做替换，替换目标即「修前形态 vs 修后形态」的分界）
const GUARD_A = 'if (curTimeCls !== wantTimeCls) {';
const GUARD_B = 'if (old.textContent !== text) old.textContent = text; return;';
const HEAD_A = "TIME_STYLES.forEach(s => document.body.classList.remove('cs-time-' + s.value));\n    if (ts !== 'under-av') document.body.classList.add('cs-time-' + ts);";
// 本批「值变才写」守卫的每一行 ↔ 修前的无条件写入形态：一条行＝一个判别面，缺一行就红
const RED_PAIRS = [
  ['内联变量值变才写（setVar）',
    "const setVar = (el, name, value) => { if (!el) return; const v = String(value); if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v); };",
    "const setVar = (el, name, value) => { if (el) el.style.setProperty(name, String(value)); };"],
  ['变量删除前先确认挂着（delVar）',
    "const delVar = (el, name) => { if (el && el.style.getPropertyValue(name) !== '') el.style.removeProperty(name); };",
    "const delVar = (el, name) => { if (el) el.style.removeProperty(name); };"],
  ['设置页回显文本真变了才写',
    "const set = (id, v) => { const el = document.getElementById(id); const s = String(v); if (el && el.textContent !== s) el.textContent = s; };",
    "const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };"],
  ['栏位回显文本真变了才写',
    "Object.keys(labels).forEach(id => { const el = document.getElementById(id); if (el && el.textContent !== labels[id]) el.textContent = labels[id]; });",
    "Object.keys(labels).forEach(id => { const el = document.getElementById(id); if (el) el.textContent = labels[id]; });"],
  ['壁纸类摘除前先确认挂着',
    "if (chatPage.classList.contains('cs-bg-fill')) chatPage.classList.remove('cs-bg-fill');\n        if (chatPage.classList.contains('cs-bg-on')) chatPage.classList.remove('cs-bg-on');",
    "chatPage.classList.remove('cs-bg-fill');\n        chatPage.classList.remove('cs-bg-on');"],
  ['壁纸层 display/repeat 值变才写',
    "if (bgLayer.style.display !== 'none') bgLayer.style.display = 'none';\n        if (bgLayer.style.backgroundImage) bgLayer.style.backgroundImage = '';",
    "bgLayer.style.display = 'none'; bgLayer.style.backgroundImage = '';"],
  ['发送按钮 display 值变才写',
    "if (sendBtn) { const wantDisp = sendShow === 'hide' ? 'none' : ''; if (sendBtn.style.display !== wantDisp) sendBtn.style.display = wantDisp; }",
    "if (sendBtn) sendBtn.style.display = sendShow === 'hide' ? 'none' : '';"],
  ['对比度修正层文本真变了才写',
    "      const css = rules.join('\\n');\n      if (fix.textContent !== css) fix.textContent = css;",
    "      fix.textContent = rules.join('\\n');"],
];
let csText = srcCs;
const cntA = srcCs.split(GUARD_A).length - 1;
const cntB = srcCs.split(GUARD_B).length - 1;
if (RED) {
  const i = csText.indexOf(GUARD_A);
  const j = csText.indexOf('}\n    set(\'cs-time-style-val\'', i);
  if (i < 0 || j < 0) { console.error('RED：找不到 #938a 段'); process.exit(1); }
  csText = csText.slice(0, i) + HEAD_A + '\n    ' + csText.slice(j + 2);
  const k = csText.indexOf('    // #938：原实现先 old.remove()');
  const m = csText.indexOf('document.head.appendChild(st);\n  }', k);
  if (k < 0 || m < 0) { console.error('RED：找不到 #938b 段'); process.exit(1); }
  csText = csText.slice(0, k) + "    if (!rules.length) return;\n    const st = document.createElement('style');\n    st.id = 'cs-bubble-enforce';\n    st.textContent = rules.join('');\n  " + csText.slice(m);
  RED_PAIRS.forEach(([label, green, red]) => {
    const n = csText.split(green).length - 1;
    if (n !== 1) { console.error('RED：' + label + ' 的修后形态命中 ' + n + ' 次（应为 1）'); process.exit(1); }
    csText = csText.replace(green, red);
  });
}
const overrides = { 'chat-settings.js': csText };
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  const src = overrides[f] !== undefined ? overrides[f] : readFileSync(join(root, 'src/js', f), 'utf8');
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-cs-body-churn' + (RED ? '-red' : '')).split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cbc-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-cbc-prof-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/__seed') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end('<!doctype html><title>seed</title>'); return; }
    let p = normalize(join(tmpRoot, rel));
    let hit = false; try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { p = normalize(join(root, rel)); try { hit = statSync(p).isFile(); } catch (e) {} }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 60));
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
let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(4000); }

console.log('== S 源码锚 ==');
ok('S1 #938a 守卫行在 chat-settings.js 内唯一（body 类只在现状≠目标时翻转）', RED ? true : cntA === 1, { cntA });
ok('S2 #938b 守卫行在 chat-settings.js 内唯一（enforce 层按文本比对就地更新）', RED ? true : cntB === 1, { cntB });
RED_PAIRS.forEach((pair, idx) => {
  const n = srcCs.split(pair[1]).length - 1;
  ok('S' + (3 + idx) + ' 守卫「' + pair[0] + '」修后形态在 chat-settings.js 内唯一', RED ? true : n === 1, { n });
});

await cdpConnect();
await cdp('Runtime.enable');
await navigate('about:blank');
await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
await navigate(baseUrl + '/__seed');
await evalJs(`(function(){ localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  var msgs=[]; for (var i=0;i<120;i++){ msgs.push({ side: i%2? 'out':'in', text: '消息 '+i+' '+'哈'.repeat(4+i%30), ts: 1700000000000+i*60000 }); }
  localStorage.setItem('xy-home-v2:cta:chat-msgs', JSON.stringify(msgs));
  return true; })()`);
await navigate(baseUrl + '/index.html');
await evalJs(`(function(){ var app=document.querySelector('.app[data-app="chat"]'); if(app) app.click(); return 1; })()`);
await sleep(2500);
await evalJs(`(function(){ var g=document.getElementById('chat-settings-btn'); if(g) g.click(); return 1; })()`);
await sleep(500);
await evalJs(`(function(){ var b=document.getElementById('cs-live-adjust'); if(b) b.click(); return 1; })()`);
await sleep(800);
const bootOk = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  return { drawer: !!(d && getComputedStyle(d).display !== 'none'), msgs: document.querySelectorAll('#chat-body .msg').length }; })()`);
ok('B0 前置：120 条消息渲染 + 抽屉打开', !!(bootOk && bootOk.drawer && bootOk.msgs > 100), bootOk);
// 启动期异常基线：抽屉交互之前就有的记录（可能是并行批在其它文件里的加载期异常）不算本批断言，但原样打印出来
const jsBase = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(); })()`) || [];
if (jsBase.length) console.log('  · 启动期已有 JS 异常 ' + jsBase.length + ' 条（非本批面，Z 只查增量）：' + JSON.stringify(jsBase.slice(0, 3)));
// 观察器：body class 属性变更 + head STYLE 拆建，带时刻
await evalJs(`(function(){
  window.__ch = { body: [], head: [], all: [] };
  new MutationObserver(function(ms){ ms.forEach(function(m){ if (m.target === document.body) window.__ch.body.push(Math.round(performance.now())); }); })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(function(ms){ ms.forEach(function(m){
    m.removedNodes.forEach(function(n){ if (n.nodeName === 'STYLE') window.__ch.head.push(Math.round(performance.now()) + ' del'); });
    m.addedNodes.forEach(function(n){ if (n.nodeName === 'STYLE') window.__ch.head.push(Math.round(performance.now()) + ' add'); });
  }); }).observe(document.head, { childList: true });
  // 整页变更量：点一下控件到底让多少个节点被碰过（属性/增删/文本），RED vs GREEN 的关键量化面
  new MutationObserver(function(ms){ ms.forEach(function(m){
    var t = m.target, id = t.nodeName;
    if (t.nodeType === 1) { if (t.id) id += '#' + t.id; else if (t.className && typeof t.className === 'string') id += '.' + t.className.split(' ')[0]; }
    if (m.type === 'attributes') id += '[' + m.attributeName + ']';
    window.__ch.all.push({ t: Math.round(performance.now()), k: m.type, id: id });
  }); }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  // 同值白写的地面真值：setProperty/removeProperty/classList.remove 调用计数。
  // 这三处都改不到 DOM（同值写入不留属性变更记录），只能按「调了几次、写了哪些变量名」判别。
  // 注意：**不能只钩 CSSStyleDeclaration.prototype**——mobile-adapt.js 会在 documentElement.style
  // 上装实例级 set/removeProperty 包装（屏幕微调轴），原型钩子对 :root 的写入一律抓不到（实测 0 命中）。
  // 故按「抽屉真正写的那两个元素」逐个装实例钩子，并且链上当时已存在的包装函数。
  window.__w = { prop: [], rmProp: [], rmCls: [] };
  function hookStyle(el, tag) {
    if (!el) return;
    var s = el.style, _set = s.setProperty, _del = s.removeProperty;
    s.setProperty = function(n, v) { window.__w.prop.push(tag + '|' + n); return _set.apply(s, arguments); };
    s.removeProperty = function(n) { window.__w.rmProp.push(tag + '|' + n); return _del.apply(s, arguments); };
  }
  hookStyle(document.documentElement, 'root');
  hookStyle(document.getElementById('page-chat'), 'chat');
  var _rm = DOMTokenList.prototype.remove;
  DOMTokenList.prototype.remove = function() {
    for (var i = 0; i < arguments.length; i++) window.__w.rmCls.push(String(arguments[i]));
    return _rm.apply(this, arguments);
  };
  document.documentElement.style.setProperty('--n938-probe', '1px');
  document.documentElement.style.removeProperty('--n938-probe');
  document.body.classList.remove('n938-probe-cls');
  window.__selftest = { prop: window.__w.prop.length, del: window.__w.rmProp.length, cls: window.__w.rmCls.length };
  window.__w.prop.length = 0; window.__w.rmProp.length = 0; window.__w.rmCls.length = 0;
  return 'armed'; })()`);
// 点击辅助：清计数 → 点胶囊（按文本） → 等 180ms → 返回 {body: 变更次数, head: 拆建次数}
const CLICK_PILL = (label) => `(async function(){
  window.__ch.body.length = 0; window.__ch.head.length = 0; window.__ch.all.length = 0;
  window.__w.prop.length = 0; window.__w.rmProp.length = 0; window.__w.rmCls.length = 0;
  var t0 = Math.round(performance.now());
  var d=document.getElementById('chat-beauty-drawer');
  var bs=d.querySelectorAll('button'); var pick=null;
  bs.forEach(function(b){ if(b.textContent===${JSON.stringify(label)} && !pick) pick=b; });
  if(!pick) return null;
  pick.click();
  await new Promise(function(r){ setTimeout(r, 180); });
  var agg = {};
  window.__ch.all.forEach(function(e){ if (e.t < t0) return; var k = e.k + ' ' + e.id; agg[k] = (agg[k] || 0) + 1; });
  return { body: window.__ch.body.filter(function(t){ return t >= t0; }).length,
    head: window.__ch.head.filter(function(s){ return Number(s.split(' ')[0]) >= t0; }),
    all: Object.keys(agg).map(function(k){ return k + ' x' + agg[k]; }),
    w: (function(){
      var mine = function(n){ return /^--(msg|chat|typing|send)-/.test(n) || /^--cs-/.test(n); };
      var cut = function(s){ return s.split('|')[1]; };
      return { vars: window.__w.prop.filter(function(s){ return mine(cut(s)); }),
               del: window.__w.rmProp.filter(function(s){ return mine(cut(s)); }),
               cls: window.__w.rmCls.filter(function(c){ return c.indexOf('cs-') === 0; }) };
    })(),
    clicked: true }; })()`;
const SEC = (key) => `(function(){ var d=document.getElementById('chat-beauty-drawer'); var c=d.querySelector('button[data-sec="${key}"]'); if(c){ c.click(); return true; } return false; })()`;
const SET_SLIDER = (label, val) => `(function(){ var d=document.getElementById('chat-beauty-drawer');
  var rs=d.querySelectorAll('input[type=range]');
  for (var i=0;i<rs.length;i++){ var lb=rs[i].parentNode.querySelector('span');
    if(lb && lb.textContent===${JSON.stringify(label)}){ rs[i].value='${val}'; rs[i].dispatchEvent(new Event('input',{bubbles:true})); return rs[i].value; } }
  return null; })()`;
const padVar = () => evalJs(`document.documentElement.style.getPropertyValue('--chat-bubble-pad')`);
// 量「点一下控件到底让浏览器重算了多少样式」：CDP Performance 指标差值（秒→毫秒）
let perfOn = false;
async function perf() {
  if (!perfOn) { await cdp('Performance.enable'); perfOn = true; }
  const r = await cdp('Performance.getMetrics');
  const m = {}; (r.metrics || []).forEach((x) => { m[x.name] = x.value; });
  return { recalc: (m.RecalcStyleDuration || 0) * 1000, layout: (m.LayoutDuration || 0) * 1000 };
}
async function CLICK_PILL_PERF(label) {
  const a = await perf();
  const r = await evalJs(CLICK_PILL(label));
  const b = await perf();
  return { churn: r, recalc: +(b.recalc - a.recalc).toFixed(1), layout: +(b.layout - a.layout).toFixed(1) };
}

console.log('== B 点各控件＝全局零翻动（闪屏根因面） ==');
const st1 = await evalJs('window.__selftest');
ok('P0 探针自证：同值/空写入也计得到（root 写＋删、body 空 remove 各命中 1）', !!st1 && st1.prop === 1 && st1.del === 1 && st1.cls === 1, st1);
const vset = (r) => (r && r.w ? r.w.vars.map(s => s.split('|')[1]).join(',') : null);
const b1 = await evalJs(CLICK_PILL('宽松'));
const p1b = await CLICK_PILL_PERF('宽松');
const b1pad = await padVar();
ok('B1 点「气泡框大小·宽松」：body class 零变更 + head 零拆建（红米实报缺陷面）', !!b1 && b1.body === 0 && b1.head.length === 0, b1);
ok('B1w 真换档只写真正变的那一条变量（红＝:root/#page-chat 十几条同值白写·全站样式作用域整篇失效）', vset(b1) === '--chat-bubble-pad', vset(b1));
ok('B2 宽松档真的生效（防修过头：--chat-bubble-pad = 14px 18px）', b1pad === '14px 18px', b1pad);
const b1r = p1b.churn;
ok('B1r 再点同档（值未变）：内联变量零写零删 + cs-* 零摘 + body/head 零翻动（＝闪屏根因消除）',
  !!b1r && b1r.body === 0 && b1r.head.length === 0 && b1r.w.vars.length === 0 && b1r.w.del.length === 0 && b1r.w.cls.length === 0, b1r);
const b3 = await evalJs(CLICK_PILL('紧凑'));
const b3pad = await padVar();
ok('B3 点「紧凑」依旧零翻动，且 pad 变 8px 10px', !!b3 && b3.body === 0 && b3.head.length === 0 && b3pad === '8px 10px', { b3, b3pad });
ok('B3w 换档同样只写 --chat-bubble-pad 一条', vset(b3) === '--chat-bubble-pad', vset(b3));
const b4 = await evalJs(CLICK_PILL('大'));
const b4fs = await evalJs(`document.documentElement.style.getPropertyValue('--chat-font-size')`);
ok('B4 点「气泡字号·大」零翻动，且字号 16px 生效（用户点名排查的其余控件·同根因）', !!b4 && b4.body === 0 && b4.head.length === 0 && b4fs === '16px', { b4, b4fs });
ok('B4w 字号档只写 --chat-font-size 一条（颜色/圆角/形状等其余十五项同值不碰）', vset(b4) === '--chat-font-size', vset(b4));
await evalJs(SEC('bar'));
await sleep(250);
const b5 = await evalJs(CLICK_PILL('隐藏（回车发送）'));
const b5send = await evalJs(`getComputedStyle(document.getElementById('chat-send')).display`);
ok('B5 「栏位」分区点「发送按钮·隐藏」零翻动，且按钮真的没了（跨分区同闸）', !!b5 && b5.body === 0 && b5.head.length === 0 && b5send === 'none', { b5, b5send });
const b5fit = await evalJs(CLICK_PILL('平铺'));
ok('B5b 「壁纸铺满方式·平铺」零翻动（repeat 重写有壁纸才有像素面，无壁纸也须零翻动）', !!b5fit && b5fit.body === 0 && b5fit.head.length === 0, b5fit);
ok('B5c 无壁纸分支不再空摘 cs-bg-fill / cs-bg-on（红＝每次点击两记空 remove 脏化 #page-chat）', !!b5fit && b5fit.w.cls.filter(c => c.indexOf('cs-bg-') === 0).length === 0, b5fit && b5fit.w.cls);
await evalJs(SEC('bubble'));
await sleep(250);
// B6：先把透明度/圆角调离默认 → enforce STYLE 存在；再点胶囊＝节点身份与文本都不许变
const opv = await evalJs(SET_SLIDER('气泡透明度', 40));
await sleep(150);
const radv = await evalJs(SET_SLIDER('气泡圆角', 30));
await sleep(150);
const b6pre = await evalJs(`(function(){ var st=document.getElementById('cs-bubble-enforce'); if(!st) return null; st.__n938 = 1; return { has: true, text: st.textContent.slice(0, 60) }; })()`);
const b6 = await evalJs(CLICK_PILL('标准'));
const b6post = await evalJs(`(function(){ var st=document.getElementById('cs-bubble-enforce'); if(!st) return null; return { same: st.__n938 === 1, text: st.textContent.slice(0, 60) }; })()`);
ok('B6 非默认透明度/圆角下点胶囊：#cs-bubble-enforce 同一节点、文本不变、零拆建（同族第二处）',
  opv === '40' && radv === '30' && !!b6pre && !!b6 && b6.body === 0 && b6.head.length === 0 && !!b6post && b6post.same && b6post.text === b6pre.text, { b6pre, b6, b6post });
console.log('== B7~B9 时间轴样式真切换仍然工作（守卫没把功能闸死） ==');
await evalJs(SEC('type'));
await sleep(250);
const b7 = await evalJs(CLICK_PILL('气泡下方'));
const b7cls = await evalJs(`(function(){ var a=[]; document.body.classList.forEach(function(c){ if(c.indexOf('cs-time-')===0) a.push(c); }); return { cls: a.join(','), store: localStorage.getItem('xy-home-v2:cta:cs-time-style') }; })()`);
ok('B7 点「时间轴样式·气泡下方」：body 恰好挂上 cs-time-under-bubble + 存储写入', !!b7 && b7cls.cls === 'cs-time-under-bubble' && b7cls.store === 'under-bubble', { b7, b7cls });
ok('B7w 真换时间轴时按原实现走完七档清扫（防修过头：守卫只拦「没变」，不拦「变了」）', !!b7 && b7.w.cls.filter(c => c.indexOf('cs-time-') === 0).length === 7, b7 && b7.w.cls);
const b8 = await evalJs(SEC('bubble'));
await sleep(250);
const p8a = await CLICK_PILL_PERF('紧凑');
const p8b = await CLICK_PILL_PERF('紧凑');
const b8c = p8b.churn;
ok('B8 挂类态下再点框大小：变量零写零删 + cs-* 零摘 + body/head 零翻动（守卫含「已有类且相等→不动」）',
  !!b8c && b8c.body === 0 && b8c.head.length === 0 && b8c.w.vars.length === 0 && b8c.w.del.length === 0 && b8c.w.cls.length === 0, b8c);
console.log('  · 参考：真换档样式重算 ' + p8a.recalc + 'ms／同档重复点 ' + p8b.recalc + 'ms（无头绝对值随机器浮动，只看相对；修前形态下后一记同样要白算）');
await evalJs(SEC('type'));
await sleep(250);
const b9 = await evalJs(CLICK_PILL('头像下方'));
const b9cls = await evalJs(`(function(){ var a=[]; document.body.classList.forEach(function(c){ if(c.indexOf('cs-time-')===0) a.push(c); }); return a.join(','); })()`);
ok('B9 切回「头像下方」：body 摘净 cs-time-*（默认档还原路径）', !!b9 && b9cls === '', { b9, b9cls });
const zAll = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(); })()`) || [];
const z1 = zAll.slice(jsBase.length);
ok('Z 抽屉交互期间零 JS 异常', Array.isArray(z1) && z1.length === 0, z1);

console.log('\n' + (RED ? '[RED 基线] ' : '') + '通过 ' + pass + ' / 失败 ' + fail + (fails.length ? '：' + fails.join('；') : ''));
try { chrome.kill(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);

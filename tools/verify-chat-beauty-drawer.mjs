// ===== 专项验证：聊天美化「边看边调」底部抽屉（v3.34.x #673） =====
// 需求（用户原话）：「聊天设置里的美化也能像桌面美化一样做边看边调的功能吗？」
//   背景＝用户先反馈「顶栏/底栏与气泡透明、聊天气泡透明度、气泡 CSS、全局字体…这些设置都不能预览」
//   ——根因不是数值没生效，而是聊天美化只有居中弹窗、弹窗把聊天页整个盖住，调的时候看不到结果。
//   桌面美化早有一套「边看边调」（personalize.js openBeautyDrawer：桌面在上、控件在下、即时生效），
//   本批把同一套交互搬到聊天域。
// 用例组：
//   A 入口：按钮存在、在美化段最上方、文案与桌面版同口径
//   B 打开链路：点开＝切到聊天页 + 底部抽屉（分区胶囊默认「气泡」）
//   C 即时生效：滑杆/胶囊/色板/字体名/气泡 CSS 改动当场落到 -- 变量与存储（核心诉求）
//   D 收起与关闭：收起只剩标题行；✕ 关抽屉并回聊天设置页
//   E 零 JS 异常
// 用法：
//   node tools/verify-chat-beauty-drawer.mjs          # 对 src 组合页（GREEN）
//   node tools/verify-chat-beauty-drawer.mjs --red    # 抠掉本批代码（RED 判别力基线）
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
// --red：把 #673 整块从 chat-settings.js 抠掉（还原「只有居中弹窗、没有边看边调」的修前形态），
//        用来证明本脚本对用户要的这个能力真有判别力（不是恒绿的断言）。
const overrides = {};
if (RED) {
  const cs = readFileSync(join(root, 'src/js/chat-settings.js'), 'utf8');
  const marker = '// ================= v3.34.x #673';
  if (cs.indexOf(marker) < 0) { console.error('RED 模式：chat-settings.js 里找不到 #673 标记'); process.exit(1); }
  overrides['chat-settings.js'] = cs.split(marker)[0] + '\n})();\n';
}
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  const src = overrides[f] !== undefined ? overrides[f] : readFileSync(join(root, 'src/js', f), 'utf8');
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-chat-beauty-drawer' + (RED ? '-red' : '')).split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cbd-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-cbd-prof-' + Date.now());
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
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
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
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(4500); }
const url = baseUrl + '/index.html';
const REG_SEED = `(function () {
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  return true;
})()`;
async function boot(seedExpr) {
  await navigate('about:blank');
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
  await navigate(baseUrl + '/__seed');
  await evalJs('(function(){\n' + seedExpr + ';\n})()');
  await navigate(url);
}

// 通用：按可见文本点抽屉里的按钮
const CLICK_BTN = (txt) => `(function(){ var d=document.getElementById('chat-beauty-drawer'); if(!d) return false;
  var bs=d.querySelectorAll('button'); for (var i=0;i<bs.length;i++){ if(bs[i].textContent===${JSON.stringify(txt)}){ bs[i].click(); return true; } } return false; })()`;
// 通用：抽屉里按标签取滑杆并拨到某个值（派发 input 事件＝真实拖动）
const SET_SLIDER = (label, val) => `(function(){ var d=document.getElementById('chat-beauty-drawer'); if(!d) return null;
  var rs=d.querySelectorAll('input[type=range]');
  for (var i=0;i<rs.length;i++){ var lb=rs[i].parentNode.querySelector('span');
    if(lb && lb.textContent===${JSON.stringify(label)}){ rs[i].value='${val}'; rs[i].dispatchEvent(new Event('input',{bubbles:true})); return rs[i].value; } }
  return null; })()`;

await cdpConnect();
await cdp('Runtime.enable');
await boot(REG_SEED);

console.log('== A 入口 ==');
const a1 = await evalJs(`!!document.getElementById('cs-live-adjust')`);
ok('A1 美化段有「边看边调」入口按钮 #cs-live-adjust', a1 === true, a1);
const a2 = await evalJs(`(function(){ var b=document.getElementById('cs-live-adjust'); return b? b.textContent : ''; })()`);
ok('A2 按钮文案＝边看边调 + 即时生效（与桌面版同口径）', typeof a2 === 'string' && a2.indexOf('边看边调') >= 0 && a2.indexOf('即时生效') >= 0, a2);
const a3 = await evalJs(`(function(){
  var b=document.getElementById('cs-live-adjust'); if(!b) return null;
  var sec=b.closest('.them-sec'); if(!sec) return {sec:false};
  var gs=sec.querySelector('.gs-title');
  return { sec: sec.getAttribute('data-sec'), before: !!(gs && (b.compareDocumentPosition(gs) & Node.DOCUMENT_POSITION_FOLLOWING)) };
})()`);
ok('A3 位于「美化」段内且排在第一个分组标题之前（页面最上方）', !!(a3 && a3.sec === 'beautify' && a3.before), a3);

console.log('== B 打开链路：聊天页 + 底部抽屉 ==');
// 走真实链路：先进聊天页 → 点设置齿轮 → 进聊天设置页
const entered = await evalJs(`(function(){
  var app=document.querySelector('.app[data-app="chat"]'); if(app) app.click();
  var g=document.getElementById('chat-settings-btn'); if(g) g.click();
  return { chat: !document.getElementById('page-chat').hidden, cs: !document.getElementById('page-chat-settings').hidden };
})()`);
await sleep(400);
ok('B0 前置：能进到聊天设置页（真实入口链路可用）', !!(entered && entered.cs === true), entered);
const b1 = await evalJs(`(function(){ var b=document.getElementById('cs-live-adjust'); if(b) b.click(); return true; })()`);
await sleep(350);
const b1r = await evalJs(`(function(){
  var chat=document.getElementById('page-chat'), cs=document.getElementById('page-chat-settings');
  var d=document.getElementById('chat-beauty-drawer');
  return { chatVisible: !!(chat && !chat.hidden), csHidden: !!(cs && cs.hidden), drawer: !!d, disp: d? getComputedStyle(d).display : null };
})()`);
ok('B1 点入口＝切到聊天页（聊天设置页隐藏）——聊天就在眼前', !!(b1 && b1r && b1r.chatVisible && b1r.csHidden), b1r);
ok('B2 底部抽屉出现（display:flex）', !!(b1r && b1r.drawer && b1r.disp === 'flex'), b1r);
const b3 = await evalJs(`(function(){
  var d=document.getElementById('chat-beauty-drawer');
  var chips=d.querySelectorAll('button[data-sec]');
  var on=[]; chips.forEach(function(c){ if(c.style.background.indexOf('--ink')>=0) on.push(c.textContent); });
  var hd=d.children[1];
  return { n: chips.length, labels: Array.prototype.map.call(chips,function(c){return c.textContent;}), title: hd? hd.textContent : '' };
})()`);
ok('B3 三个分区胶囊（气泡/栏位/字体·其他）+ 标题「边看边调（即时生效）」', !!(b3 && b3.n === 3 && b3.title.indexOf('边看边调（即时生效）') >= 0 && b3.labels.join('/') === '气泡/栏位/字体 · 其他'), b3);
const b4 = await evalJs(`(function(){
  var d=document.getElementById('chat-beauty-drawer');
  return { z: getComputedStyle(d).zIndex, pos: getComputedStyle(d).position, bottom: getComputedStyle(d).bottom, radius: getComputedStyle(d).borderTopLeftRadius };
})()`);
ok('B4 抽屉贴底浮在聊天页之上（fixed/bottom:0/z-index 95）', !!(b4 && b4.pos === 'fixed' && b4.bottom === '0px' && Number(b4.z) >= 90), b4);

console.log('== C 即时生效（改哪看哪） ==');
const c1 = await evalJs(SET_SLIDER('气泡透明度', 30));
await sleep(120);
const c1r = await evalJs(`(function(){
  var chat=document.getElementById('page-chat');
  return { store: localStorage.getItem('xy-home-v2:cta:cs-bubble-opacity'),
    op: chat.style.getPropertyValue('--cs-bubble-opacity'),
    surf: chat.style.getPropertyValue('--cs-in-surface') };
})()`);
ok('C1 气泡透明度滑杆 → 当场写存储 + 聊天页 --cs-in-surface 带 0.3 alpha',
  c1 === '30' && !!(c1r && c1r.store === '30' && c1r.op === '0.3' && /,0\.3\)$/.test(c1r.surf || '')), { c1, c1r });
const c2 = await evalJs(SET_SLIDER('气泡圆角', 32));
await sleep(120);
const c2r = await evalJs(`document.documentElement.style.getPropertyValue('--chat-bubble-radius')`);
ok('C2 气泡圆角滑杆 → --chat-bubble-radius 立即变 32px', c2 === '32' && c2r === '32px', { c2, c2r });
const c3click = await evalJs(CLICK_BTN('大'));
await sleep(120);
const c3r = await evalJs(`({ fs: document.documentElement.style.getPropertyValue('--chat-font-size'), store: localStorage.getItem('xy-home-v2:cta:cs-font-size') })`);
ok('C3 气泡字号胶囊「大」→ 字号立即 16px', c3click === true && !!(c3r && c3r.fs === '16px' && c3r.store === '16px'), c3r);
const c4open = await evalJs(`(function(){
  var d=document.getElementById('chat-beauty-drawer');
  var items=d.querySelectorAll('div[style*="grid-template-columns"] > div');
  for (var i=0;i<items.length;i++){ if(items[i].textContent.indexOf('我的气泡色')>=0){ items[i].click(); return true; } }
  return false; })()`);
await sleep(150);
const c4pal = await evalJs(`(function(){
  var d=document.getElementById('chat-beauty-drawer');
  var sw=d.querySelectorAll('span[title]'); if(!sw.length) return null;
  var pick=null; for (var i=0;i<sw.length;i++){ if(sw[i].title==='樱花粉'){ pick=sw[i]; break; } }
  if(!pick) pick=sw[3];
  var c=pick.getAttribute('title'); pick.click();
  return { n: sw.length, color: pick.style.background, click: true };
})()`);
await sleep(150);
const c4r = await evalJs(`({ store: localStorage.getItem('xy-home-v2:cta:cs-out-bg'), varv: document.documentElement.style.getPropertyValue('--msg-out-bg') })`);
ok('C4 点气泡色块 → 调色盘就地展开 + 颜色当场生效（我的气泡色）',
  c4open === true && !!(c4pal && c4pal.n > 3) && !!(c4r && c4r.store && c4r.varv === c4r.store), { c4pal, c4r });
const c5sec = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  var c=d.querySelector('button[data-sec="bar"]'); if(c){ c.click(); return true; } return false; })()`);
await sleep(200);
const c5 = await evalJs(SET_SLIDER('顶栏不透明度', 0));
await sleep(120);
const c5r = await evalJs(`(function(){ var chat=document.getElementById('page-chat'); return { store: localStorage.getItem('xy-home-v2:cta:cs-head-opacity'), op: chat.style.getPropertyValue('--cs-head-opacity') }; })()`);
ok('C5 切「栏位」分区 + 顶栏不透明度滑杆 → 0%（全透明）立即生效', c5sec === true && c5 === '0' && !!(c5r && c5r.op === '0'), { c5sec, c5, c5r });
const c6sec = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  var c=d.querySelector('button[data-sec="type"]'); if(c){ c.click(); return true; } return false; })()`);
await sleep(200);
const c6 = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  var inp=d.querySelector('input[type=text]'); if(!inp) return null;
  inp.value='Microsoft YaHei'; inp.dispatchEvent(new Event('input',{bubbles:true}));
  return document.body.style.fontFamily; })()`);
ok('C6 全局字体名输入 → 字体立即应用到全站（含眼前这页聊天）', !!(c6 && c6.indexOf('Microsoft YaHei') >= 0), c6);
const c7 = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  var ta=d.querySelector('textarea'); if(!ta) return null;
  ta.value='border-radius:20px;'; ta.dispatchEvent(new Event('input',{bubbles:true}));
  return true; })()`);
await sleep(500);
const c7r = await evalJs(`(function(){ var st=document.getElementById('cs-bubble-style');
  return { has: !!st, out: st? st.textContent.slice(0,120) : '',
    store: localStorage.getItem('xy-home-v2:cta:cs-bubble-css') }; })()`);
ok('C7 气泡 CSS 边写边套用（160ms 防抖）+ 仍钉在 #page-chat 作用域（不泄漏群聊）',
  c7 === true && !!(c7r && c7r.has && c7r.out.indexOf('#page-chat .msg-out .msg-bubble') >= 0 && c7r.store === 'border-radius:20px;'), c7r);

console.log('== D 收起与关闭 ==');
const d1 = await evalJs(CLICK_BTN('收起'));
await sleep(120);
const d1r = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  var pb=d.children[2], hd=d.children[1];
  return { fold: getComputedStyle(pb).display, title: hd.textContent, btn: d.children[1].textContent }; })()`);
ok('D1 「收起」→ 控件区折叠、标题行仍在（随时看整屏）', d1 === true && d1r && d1r.fold === 'none' && d1r.title.indexOf('边看边调') >= 0, d1r);
const d2 = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  var bs=d.querySelectorAll('button'); for (var i=0;i<bs.length;i++){ if(bs[i].textContent==='\u2715'){ bs[i].click(); return true; } } return false; })()`);
await sleep(300);
const d2r = await evalJs(`(function(){ var d=document.getElementById('chat-beauty-drawer');
  var cs=document.getElementById('page-chat-settings');
  var tab=document.querySelector('#cs-tabs .them-tab.active');
  return { disp: d? getComputedStyle(d).display : null, cs: cs? !cs.hidden : false, tab: tab? tab.textContent : '' }; })()`);
ok('D2 ✕ 关抽屉 → 回聊天设置页（美化 tab 选中）', d2 === true && !!(d2r && d2r.disp === 'none' && d2r.cs === true && d2r.tab === '美化'), d2r);

console.log('== E 运行期健康 ==');
const e1 = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(0,5); })()`);
ok('E1 全程零 JS 异常', Array.isArray(e1) && e1.length === 0, e1);
const e2 = await evalJs(`(function(){
  return { bubble: getComputedStyle(document.documentElement).getPropertyValue('--chat-bubble-radius').trim(),
    fs: getComputedStyle(document.documentElement).getPropertyValue('--chat-font-size').trim(),
    outBg: getComputedStyle(document.documentElement).getPropertyValue('--msg-out-bg').trim() }; })()`);
ok('E2 关闭后设置仍在位（不是「关掉就回默认」）', !!(e2 && e2.bubble === '32px' && e2.fs === '16px'), e2);

console.log('\n' + (RED ? '[RED 基线] ' : '') + '通过 ' + pass + ' / 失败 ' + fail);
try { chrome.kill(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);

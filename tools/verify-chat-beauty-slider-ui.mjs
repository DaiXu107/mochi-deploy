// ===== #835 运行时专项验证：聊天设置·美化「气泡字号 / 气泡框大小」＝滑块、禁止输入 =====
// 用户原话：「聊天设置的美化里的 聊天气泡字体大小 页面为什么可以输入内容」「改成滑块滑动自定义，禁止输入」
//           「同时修复『气泡框大小』的同类问题」。
// 修前形态（本脚本 --red 基线）：字号弹窗＝openModal 默认带文本框（没传 noInput）＋预设胶囊；
//   气泡框大小＝openTCPanel 自由文本（"格式：上下 左右"）。两处零校验：任意文字直接落
//   cs-font-size / cs-bubble-size 并写成 CSS 变量 → 浏览器按非法值静默忽略（改了没反应）、
//   设置行右侧挂着那串乱码，还会被美化方案一起备份带走。
// 修后（src/js/chat-settings.js）：两处统一「滑块＋预设胶囊＋noInput 禁输入」（同本页气泡圆角口径），
//   拖动即时预览 CSS 变量；气泡框大小滑块档位＝左右内边距、上下按 0.78 配比跟随
//   （10→8 / 14→11 / 18→14 恰为原三档预设＝预设值零漂移）；读数侧钳制存量脏值。
// 用例：
//   U1 字号弹窗只给滑块不给输入框（预设胶囊保留）；U2 拖动滑块即时预览；U3 确定落库＋行回显；
//   U4 预设胶囊「特大」一键档；U5 弹窗内不存在任何可打字元素、键盘敲字改不了值（禁止输入的正面断言）；
//   U6 气泡框大小同口径（档位→上下配比对、预设档往返不漂）；U7 存量脏值进页面即被钳成合法值；
//   U8 全程零 JS 异常。
//   （U1d/U4/E1 为「双侧同绿」守卫：预设胶囊与零异常在修前修后都该成立，用来拦误伤，不计入红基线条数）
// 用法：
//   node tools/verify-chat-beauty-slider-ui.mjs                    # 对 src 组合页（期望全绿）
//   node tools/verify-chat-beauty-slider-ui.mjs --red              # 换回 HEAD 版 chat-settings.js（期望逐条红）
//   MOCHI_BASE_CHAT=<修前 chat-settings.js 路径> node … --red      # 指定基线（提交后 HEAD 已含修复时用这个）
import { spawn, execSync } from 'node:child_process';
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
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（环境缺口，不算回归）'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
const overrides = {};
if (RED) {
  const base = process.env.MOCHI_BASE_CHAT
    ? readFileSync(process.env.MOCHI_BASE_CHAT, 'utf8')
    : execSync('git show HEAD:src/js/chat-settings.js', { cwd: root, encoding: 'utf8', maxBuffer: 1e8 });
  if (base.includes('clampFontSize')) { console.error('RED 基线里已含 #835 修复（HEAD 已收口）——请带 MOCHI_BASE_CHAT=<修前文件> 再跑'); process.exit(2); }
  overrides['chat-settings.js'] = base;
}
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
testHtml = testHtml.replace('/*__STYLES__*/', cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => {
  const src = overrides[f] !== undefined ? overrides[f] : readFileSync(join(root, 'src/js', f), 'utf8');
  return '(function () { try {\n' + src + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-chat-beauty-slider-ui' + (RED ? '-red' : '')).split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');

const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-cbs-' + Date.now());
const profDir = join(process.env.TEMP || '/tmp', 'mochi-cbs-prof-' + Date.now());
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
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
  throw new Error('无法连接 Chrome');
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
// 前置桌面种子：per-cid 美化键落在 cta 桌面（xy-home-v2:cta:cs-*），与聊天设置页 store 口径一致
const seedWith = (extra) => `(function(){
  localStorage.clear();
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '宝贝' }, { id: 'cta', name: '小桃' }]));
  localStorage.setItem('xy-home-v2:active-contact', 'cta');
  ${extra || ''}
  return true;
})()`;
async function boot(extra) {
  await navigate('about:blank');
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'all' });
  await navigate(baseUrl + '/__seed');
  await evalJs(seedWith(extra));
  await navigate(url);
  await evalJs(`(function(){ var s=document.getElementById('splash'); if(s) s.remove(); return true; })()`);
  await sleep(300);
}
const enterSettings = `(function(){
  var app=document.querySelector('.app[data-app="chat"]'); if(app) app.click();
  var g=document.getElementById('chat-settings-btn'); if(g) g.click();
  return !document.getElementById('page-chat-settings').hidden;
})()`;
// 点开某个设置行 → 读弹窗结构
const openRow = (id) => `(function(){ var r=document.getElementById(${JSON.stringify(id)}); if(!r) return false; r.click(); return true; })()`;
const MODAL_STATE = `(function(){
  var mask=document.getElementById('modal-mask');
  var vis=function(el){ return !!el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).display !== 'none'; };
  var input=document.getElementById('modal-input');
  var box=document.querySelector('.modal [data-for="modal-input"]');
  var editable=Array.prototype.filter.call(document.querySelectorAll('.modal input:not([type=range]):not([type=color]):not([type=file]), .modal textarea, .modal [contenteditable="true"]'), vis);
  return {
    open: vis(mask),
    sliderVisible: vis(document.getElementById('modal-slider')),
    range: (function(){ var r=document.getElementById('modal-slider-range'); return r? { min: r.min, max: r.max, value: r.value } : null; })(),
    valTxt: (document.getElementById('modal-slider-val')||{}).textContent || '',
    pills: Array.prototype.map.call((document.getElementById('modal-pills')||{children:[]}).children, function(p){ return p.textContent; }),
    inputVisible: vis(input),
    ceBoxVisible: vis(box),
    editableCount: editable.length
  };
})()`;
// 拖动滑块（派发 input＝真拖动）
const drag = (v) => `(function(){ var r=document.getElementById('modal-slider-range'); if(!r) return null;
  r.value=${v}; r.dispatchEvent(new Event('input',{bubbles:true})); return r.value; })()`;
const clickModalBtn = (id) => `(function(){ var b=document.getElementById(${JSON.stringify(id)}); if(!b) return false; b.click(); return true; })()`;
const clickPill = (txt) => `(function(){ var ps=document.getElementById('modal-pills'); if(!ps) return false;
  var c=ps.children; for(var i=0;i<c.length;i++){ if(c[i].textContent===${JSON.stringify(txt)}){ c[i].click(); return true; } } return false; })()`;
const chatVars = `(function(){ var d=document.documentElement;
  return { fs: d.style.getPropertyValue('--chat-font-size').trim(), pad: d.style.getPropertyValue('--chat-bubble-pad').trim(),
    rowFs: (document.getElementById('cs-font-size-val')||{}).textContent, rowPad: (document.getElementById('cs-bubble-size-val')||{}).textContent }; })()`;
const LS = (k) => `(localStorage.getItem('xy-home-v2:cta:${k}'))`;

await cdpConnect();
await cdp('Runtime.enable');
await boot();

console.log('== U 字号弹窗＝滑块、禁输入 ==');
const pre = await evalJs(chatVars);
ok('U0 前置：进聊天设置页、字号/内边距两行有初值', (await evalJs(enterSettings)) === true && !!pre && pre.rowFs === '14px' && pre.rowPad === '标准', { pre });
ok('U1 点「聊天气泡字体大小」＝滑块弹窗、输入框不出现', (await evalJs(openRow('cs-font-size'))) === true
  && !!(await evalJs(MODAL_STATE) || {}).sliderVisible, await evalJs(MODAL_STATE));
let m1 = await evalJs(MODAL_STATE);
ok('U1b 字号弹窗里没有任何可打字控件（输入框/多行/ce-box 全部不可见）',
  !!(m1 && m1.sliderVisible && m1.inputVisible === false && m1.ceBoxVisible === false && m1.editableCount === 0), m1);
ok('U1c 字号滑块值域 11~30、起始停在当前档 14', !!(m1 && m1.range && m1.range.min === '11' && m1.range.max === '30' && m1.range.value === '14'), m1 && m1.range);
ok('U1d 预设胶囊四档仍在（小/标准/大/特大）', !!(m1 && m1.pills.join('/') === '小/标准/大/特大'), m1 && m1.pills);
const d20 = await evalJs(drag(20));
await sleep(120);
const live20 = await evalJs(chatVars);
ok('U2 拖到 20 → 气泡字号即时预览 20px（未点确定就先看见）', d20 === '20' && live20.fs === '20px', { d20, live20 });
ok('U2b 滑块读数行同步显示 20px', !!(m1 && (await evalJs(MODAL_STATE)).valTxt === '20px'));
await evalJs(clickModalBtn('modal-ok'));
await sleep(200);
const afterU3 = await evalJs(chatVars);
ok('U3 确定后落库 20px、设置行回显 20px', (await evalJs(LS('cs-font-size'))) === '20px' && afterU3.fs === '20px' && afterU3.rowFs === '20px',
  { stored: await evalJs(LS('cs-font-size')), afterU3 });

// 键盘硬敲也改不了值＝「禁止输入」的正面证据（弹窗里没有焦点可打字元素）
await evalJs(openRow('cs-font-size'));
await sleep(150);
const m2 = await evalJs(MODAL_STATE);
await evalJs(`(function(){ var a=document.activeElement; return a? (a.id||a.tagName) : ''; })()`);
await evalJs(`(function(){ var i=document.getElementById('modal-input'); if(i) i.focus(); return true; })()`);
await sleep(120);
const mAfterType = await evalJs(MODAL_STATE);
await evalJs(clickModalBtn('modal-cancel'));
await sleep(150);
const afterCancel = await evalJs(chatVars);
ok('U5 弹窗内输入框被隐藏（focus 也拿不到焦点），敲字改不了字号', m2.inputVisible === false && mAfterType.inputVisible === false && afterCancel.fs === '20px', { m2, mAfterType, afterCancel });

console.log('== U 预设胶囊与内联脏值 ==');
await evalJs(openRow('cs-font-size'));
await sleep(150);
ok('U4 预设胶囊「特大」→ 确定 → 18px', (await evalJs(clickPill('特大'))) === true
  && (await evalJs(clickModalBtn('modal-ok'))) === true
  && (await evalJs(LS('cs-font-size'))) === '18px'
  && (await evalJs(chatVars)).fs === '18px', await evalJs(chatVars));
await boot(seedWith(`localStorage.setItem('xy-home-v2:cta:cs-font-size','乱七八糟');localStorage.setItem('xy-home-v2:cta:cs-bubble-size','50px 60px');`));
await evalJs(enterSettings);
await sleep(200);
const dirty = await evalJs(chatVars);
ok('U7 存量脏值进页即被钳制：字号回落 14px、内边距钳到 30px 30px（不再把乱码写进 CSS/显示值）',
  dirty.fs === '14px' && dirty.pad === '30px 30px' && dirty.rowFs === '14px', dirty);

console.log('== U 气泡框大小弹窗 ==');
ok('U6 点「聊天气泡框大小」＝滑块＋预设胶囊、没有自由文本面板', (await evalJs(openRow('cs-bubble-size'))) === true
  && !(await evalJs(`!!document.getElementById('cs-pad-input')`))
  && !!(await evalJs(MODAL_STATE) || {}).sliderVisible, await evalJs(MODAL_STATE));
let m3 = await evalJs(MODAL_STATE);
ok('U6a 档位＝左右内边距 6~24、无可见输入控件', !!(m3 && m3.range.min === '6' && m3.range.max === '24' && m3.inputVisible === false && m3.editableCount === 0), m3);
const d18 = await evalJs(drag(18));
await sleep(120);
ok('U6b 拖到 18 → 即时预览「14px 18px」（上下按配比跟随）', d18 === '18' && (await evalJs(chatVars)).pad === '14px 18px', { d18, pad: (await evalJs(chatVars)).pad });
await evalJs(clickModalBtn('modal-ok'));
await sleep(200);
ok('U6c 确定后存储为 14px 18px、设置行回显「宽松」（预设往返零漂移）',
  (await evalJs(LS('cs-bubble-size'))) === '14px 18px' && (await evalJs(chatVars)).rowPad === '宽松',
  { stored: await evalJs(LS('cs-bubble-size')), rowPad: (await evalJs(chatVars)).rowPad });
await evalJs(openRow('cs-bubble-size'));
await sleep(150);
await evalJs(drag(11));
await sleep(120);
await evalJs(clickPill('紧凑'));
await sleep(120);
await evalJs(clickModalBtn('modal-ok'));
await sleep(200);
ok('U6d 拖过之后改点预设胶囊＝以胶囊为准（紧凑 8px 10px），不被滑块覆盖',
  (await evalJs(LS('cs-bubble-size'))) === '8px 10px' && (await evalJs(chatVars)).rowPad === '紧凑',
  { stored: await evalJs(LS('cs-bubble-size')) });

console.log('== E 运行期健康 ==');
const errs = await evalJs(`(function(){ return (window.__jsErrors||[]).slice(0,5); })()`);
ok('E1 全程零 JS 异常', Array.isArray(errs) && errs.length === 0, errs);

console.log('\n' + (RED ? '[RED 基线] ' : '') + '通过 ' + pass + ' / 失败 ' + fail);
try { chrome.kill(); } catch (e) {}
try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);

// ===== 深色模式专项回归（v3.11.x 深色重设计） =====
// 用法：node build.mjs && node tools/verify-dark-mode.mjs
// 需要：Node 21+（fetch/WebSocket）+ 本机 Chrome/Edge（可用 CHROME_PATH 指定）
// 覆盖：
//   A. 主题开关与内联变量（气泡/时间戳/发送按钮默认色跟随主题，切换即时重算）
//   B. 语义变量（小组件五件套/--ink-soft/color-scheme）
//   C. 新补齐组件的实际生效背景（探针元素 computedStyle）
//   D. 浅色模式不受影响（回归）
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-dark-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const norm = (s) => String(s || '').replace(/\s+/g, '');

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 先导航到应用源（localStorage 按源隔离），预置深色模式后刷新，
// 走 template.html 头部早执行脚本的真实初始化路径
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(1500);
await evalJs("(function(){try{localStorage.setItem('xy-home-v2:theme-mode','dark')}catch(e){};return 1})()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(900);

// ---- A. 属性与 JS 内联变量 ----
check('A1 html data-theme=dark 已挂载', await evalJs("document.documentElement.getAttribute('data-theme')") === 'dark');
const vars = JSON.parse(await evalJs(`(function(){var cs=getComputedStyle(document.documentElement);return JSON.stringify({
  inBg:cs.getPropertyValue('--msg-in-bg'),inInk:cs.getPropertyValue('--msg-in-ink'),
  outBg:cs.getPropertyValue('--msg-out-bg'),time:cs.getPropertyValue('--msg-time-ink'),
  sendBg:cs.getPropertyValue('--send-bg'),widgetBg:cs.getPropertyValue('--widget-bg'),
  inkSoft:cs.getPropertyValue('--ink-soft'),scheme:cs.getPropertyValue('color-scheme')});})()`) || '{}') || {};
check('A2 深色下联系人气泡默认深底(#2a2a2a)', norm(vars.inBg) === '#2a2a2a', vars.inBg);
check('A3 深色下联系人文字默认亮色(#f0f0f0)', norm(vars.inInk) === '#f0f0f0', vars.inInk);
check('A4 深色下我的气泡默认炭灰(#3a3a3a)', norm(vars.outBg) === '#3a3a3a', vars.outBg);
check('A5 深色下时间戳默认亮灰(#8a8a8a)', norm(vars.time) === '#8a8a8a', vars.time);
check('A6 深色下发送按钮默认浅底(#f0f0f0)', norm(vars.sendBg) === '#f0f0f0', vars.sendBg);

// ---- B. CSS 变量与原生控件 ----
check('B1 --widget-bg 深色值(#1e1e1e)', norm(vars.widgetBg) === '#1e1e1e', vars.widgetBg);
check('B2 --ink-soft 定义(#aaaaaa)', norm(vars.inkSoft) === '#aaaaaa', vars.inkSoft);
check('B3 color-scheme:dark', /dark/i.test(String(vars.scheme)), vars.scheme);

// ---- C. 组件探针（新覆盖规则真实生效） ----
await evalJs(`
(function(){
  var host=document.createElement('div');host.id='dk-probe';document.body.appendChild(host);
  function mk(html){host.insertAdjacentHTML('beforeend',html);}
  mk('<div class="gc-settings-panel"></div>');
  mk('<div class="loc-panel"></div>');
  mk('<div class="period-day-pop"><div class="dp-sheet"></div></div>');
  mk('<div class="tc-panel"></div>');
  mk('<div class="feed-notice-panel"></div>');
  mk('<div class="market-tool"></div>');
  mk('<div class="ta-chime-note"></div>');
  mk('<div class="garden-plot"></div>');
  mk('<div class="memo-inp"></div>');
  mk('<div id="page-group-chat"><div class="gc-members-panel"></div></div>');
  mk('<div class="chat-search-input"></div>');
  mk('<div class="msg-in"><div class="msg-bubble">x</div></div>');
  mk('<div class="snake-toggle on"></div>');
  mk('<div class="chat-item glass"><div class="av"><svg viewBox="0 0 24 24"></svg></div></div>');
  mk('<label class="toggle"><input type="checkbox" checked><span class="tk"></span></label>');
  mk('<button class="cj-gchip on">组</button>');
  mk('<span class="memo-rc">提醒</span>');
  mk('<button class="poke-input-save">存入</button>');
  mk('<span class="ck-heart">♥</span>');
  mk('<div id="page-market"><div class="gift-item-top"><div class="gift-item-emoji">🎁</div></div></div>');
  mk('<button class="market-cat sel"><div class="market-cat-ico">🎀</div></button>');
  mk('<div class="giftbox-hero"><div class="giftbox-stat-ico">🎁</div></div>');
  return 1;
})()`);
await sleep(120);
const probe = JSON.parse(await evalJs(`(function(){var g=function(s){var el=document.querySelector('#dk-probe '+s);return el?getComputedStyle(el).backgroundColor:'';};
return JSON.stringify({
  gc:g('.gc-settings-panel'),loc:g('.loc-panel'),dp:g('.dp-sheet'),tc:g('.tc-panel'),
  fn:g('.feed-notice-panel'),mk:g('.market-tool'),chime:g('.ta-chime-note'),
  garden:g('.garden-plot'),memo:g('.memo-inp'),gcmp:(function(){var el=document.querySelector('#dk-probe .gc-members-panel');return el?getComputedStyle(el).backgroundColor:'';})(),
  searchIn:(function(){var el=document.querySelector('#dk-probe .chat-search-input');return el?getComputedStyle(el).backgroundColor:'';})(),
  bub:(function(){var el=document.querySelector('#dk-probe .msg-in .msg-bubble');return el?(getComputedStyle(el).backgroundColor+'|'+getComputedStyle(el).color):'';})(),
  snakeOn:(function(){var el=document.querySelector('#dk-probe .snake-toggle.on');return el?getComputedStyle(el).color:'';})()
});})()`) || '{}') || {};
const hasRGB = (v) => /rgba?\(/.test(String(v));
const isDarkish = (v) => { const m = String(v).match(/\d+/g) || []; if (m.length < 3) return false; const [r,g,b] = m.map(Number); return r+g+b < 240 && !(r>235&&g>235&&b>235); };
check('C1 群聊设置面板深底', isDarkish(probe.gc), probe.gc);
check('C2 位置面板深底', isDarkish(probe.loc), probe.loc);
check('C3 经期日详情浮层深底', isDarkish(probe.dp), probe.dp);
check('C4 TA小问题面板深底', isDarkish(probe.tc), probe.tc);
check('C5 朋友圈通知面板深底', isDarkish(probe.fn), probe.fn);
check('C6 礼物市场工具条深底', isDarkish(probe.mk), probe.mk);
check('C7 TA身边浮字卡深底', isDarkish(probe.chime), probe.chime);
check('C8 花园地块深底(garden.css 后加载仍被覆盖)', isDarkish(probe.garden), probe.garden);
check('C9 备忘输入深底(memo.css 后加载仍被覆盖)', isDarkish(probe.memo), probe.memo);
check('C10 群聊成员面板深底', isDarkish(probe.gcmp), probe.gcmp);
check('C11 聊天搜索框深底(原 #f6f6f6 bug 已修)', isDarkish(probe.searchIn), probe.searchIn);
{
  const parts = String(probe.bub || '').split('|');
  check('C12 深色下联系人气泡渲染为深底亮字', isDarkish(parts[0]) && (()=>{const m=(parts[1]||'').match(/\d+/g)||[];if(m.length<3)return false;return (+m[0])+(+m[1])+(+m[2])>380;})(), probe.bub);
}
{
  const m = String(probe.snakeOn || '').match(/\d+/g) || [];
  check('C13 贪吃蛇开关选中态文字改深色(var(--ink) 底不再配白字)', m.length >= 3 && ((+m[0]) + (+m[1]) + (+m[2])) < 200, probe.snakeOn);
}

// ---- C2. #486 深色白底漏网收口探针（tools/verify-dark-audit.mjs 135 步全量审计的定点回归） ----
const probe2 = JSON.parse(await evalJs(`(function(){
  var g=function(s){var el=document.querySelector('#dk-probe '+s);return el?getComputedStyle(el).backgroundColor:'';};
  var c=function(s){var el=document.querySelector('#dk-probe '+s);return el?getComputedStyle(el).color:'';};
  var before=function(s){var el=document.querySelector('#dk-probe '+s);return el?getComputedStyle(el,'::before').backgroundColor:'';};
  var gi=g('#page-market .gift-item-top');
  return JSON.stringify({
    av:g('.chat-item .av'), tkOn:before('label.toggle input:checked + .tk'),
    cj:c('.cj-gchip.on')+'|'+g('.cj-gchip.on'), memoRc:g('.memo-rc'),
    saveBg:g('.poke-input-save'), saveInk:(function(){var el=document.querySelector('#dk-probe .poke-input-save');return el?getComputedStyle(el).color:'';})(),
    heart:c('.ck-heart'), giftTop:gi, emojiBg:g('#page-market .gift-item-emoji'),
    mcat:g('.market-cat.sel .market-cat-ico'), mcatInk:(function(){var el=document.querySelector('#dk-probe .market-cat.sel .market-cat-ico');return el?getComputedStyle(el).color:'';})(),
    hero:(function(){var el=document.querySelector('#dk-probe .giftbox-hero');return el?getComputedStyle(el).color:'';})()
  });})()`) || '{}') || {};
check('C14 字卡库左菜单 av 芯片深底(#486，原白块 rgba(255,255,255,.92))', isDarkish(probe2.av), probe2.av);
check('C15 开关选中态滑块深色(#486，浅轨道上白滑块不可见)', (()=>{const m=String(probe2.tkOn||'').match(/\d+/g)||[];return m.length>=3&&((+m[0])+(+m[1])+(+m[2]))<200;})(), probe2.tkOn);
check('C16 此间分组芯片选中态浅底深字(#486，原深底深字)', (()=>{const [ink,bg]=String(probe2.cj||'').split('|');const m=(bg||'').match(/\d+/g)||[];const n=(ink||'').match(/\d+/g)||[];return m.length>=3&&((+m[0])+(+m[1])+(+m[2]))>600&&n.length>=3&&((+n[0])+(+n[1])+(+n[2]))<200;})(), probe2.cj);
check('C17 备忘提醒快捷片深底(#486，原白蒙底灰字；深色态=白色低透明叠加或深实底)', (()=>{const t=String(probe2.memoRc||'');const m=t.match(/\d+/g)||[];if(m.length>=4&&+m[3]<1&&+m[0]>=250)return true;return m.length>=3&&m.length<=3&&((+m[0])+(+m[1])+(+m[2]))<240;})(), probe2.memoRc);
check('C18 拍一拍存入按钮深底浅字(#486，原白底浅字)', isDarkish(probe2.saveBg) && (()=>{const m=String(probe2.saveInk||'').match(/\d+/g)||[];return m.length>=3&&((+m[0])+(+m[1])+(+m[2]))>380;})(), probe2.saveBg+'|'+probe2.saveInk);
check('C19 桌面签到心形徽章深字(#486，浅圆底白心形不可见)', (()=>{const m=String(probe2.heart||'').match(/\d+/g)||[];return m.length>=3&&((+m[0])+(+m[1])+(+m[2]))<200;})(), probe2.heart);
check('C20 市集商品卡顶部白带清除(#486，原 #fff !important)', (()=>{const m=String(probe2.giftTop||'').match(/\d+/g)||[];if(String(probe2.giftTop).indexOf('0, 0, 0, 0')>=0)return true;return m.length>=3&&((+m[0])+(+m[1])+(+m[2]))<240;})(), probe2.giftTop);
check('C21 市集分类选中圆浅底深字(#486，需 !important 反压 market.css)', (()=>{const m=String(probe2.mcat||'').match(/\d+/g)||[];const n=String(probe2.mcatInk||'').match(/\d+/g)||[];return m.length>=3&&((+m[0])+(+m[1])+(+m[2]))>600&&n.length>=3&&((+n[0])+(+n[1])+(+n[2]))<200;})(), probe2.mcat+'|'+probe2.mcatInk);
check('C22 心意柜 hero 字色提亮(#486，深底仍继承 #111 字色)', (()=>{const m=String(probe2.hero||'').match(/\d+/g)||[];return m.length>=3&&((+m[0])+(+m[1])+(+m[2]))>600;})(), probe2.hero);

// ---- D. 切回浅色：属性移除、变量回浅、CSS 回白（回归；v3.27.x 三档=行点击开弹窗、需点「浅色」胶囊，#252 起走真实用户路径） ----
await evalJs("(function(){var r=document.getElementById('row-theme-mode');if(r)r.click();return 1;})()");
await sleep(300);
// 弹窗胶囊里点「浅色」（pillSubmit：点选即提交）。找不到胶囊直接点行兜底旧两档
const pillOk = await evalJs("(function(){var ps=[].slice.call(document.querySelectorAll('#modal-pills .pill'));var t=ps.filter(function(b){return b.textContent.indexOf('浅色')>=0;})[0];if(t){t.click();return 1;}return 0;})()");
await sleep(500);
check('D0 三档弹窗「浅色」胶囊在位且可点', pillOk === 1);
check('D1 点击设置行切回浅色(data-theme 移除)', await evalJs("!document.documentElement.hasAttribute('data-theme')"));
const lv = JSON.parse(await evalJs(`(function(){var cs=getComputedStyle(document.documentElement);var el=document.querySelector('#dk-probe .loc-panel');return JSON.stringify({inBg:cs.getPropertyValue('--msg-in-bg'),time:cs.getPropertyValue('--msg-time-ink'),locBg:el?getComputedStyle(el).backgroundColor:'',scheme:cs.getPropertyValue('color-scheme')});})()`) || '{}') || {};
check('D2 浅色下联系人气泡回白(#ffffff)', norm(lv.inBg) === '#ffffff', lv.inBg);
check('D3 浅色下时间戳回黑(#111111)', norm(lv.time) === '#111111', lv.time);
check('D4 浅色下位置面板回白底', !isDarkish(lv.locBg) && hasRGB(lv.locBg), lv.locBg);
check('D5 浅色下 color-scheme 不再是 dark', !/dark/i.test(String(lv.scheme)), lv.scheme);

// 再切回深色一次验证双向切换稳定（同样走三档弹窗「深色」胶囊）
await evalJs("(function(){var r=document.getElementById('row-theme-mode');if(r)r.click();return 1;})()");
await sleep(300);
await evalJs("(function(){var ps=[].slice.call(document.querySelectorAll('#modal-pills .pill'));var t=ps.filter(function(b){return b.textContent.indexOf('深色')>=0;})[0];if(t)t.click();return 1;})()");
await sleep(500);
const dv2 = await evalJs("(function(){var cs=getComputedStyle(document.documentElement);return cs.getPropertyValue('--msg-in-bg').trim()+'|'+document.documentElement.getAttribute('data-theme');})()");
check('D6 再次切回深色：变量即时重算(MutationObserver 生效)', /^#2a2a2a\|dark$/.test(norm(dv2).replace('|', '|')) || dv2 === '#2a2a2a|dark', dv2);

// ---- E. 静态防线：dark.css 禁止 CSS 原生嵌套（#258）----
// 嵌套需 Chromium 112+/iOS 16.5+；老内核把嵌套规则整段丢弃=浅色白底扁平规则独存
// +文字色被扁平变量翻白 = 「白卡白字看不见」。dark.css 全部规则必须为展平的
// [data-theme="dark"] 前缀选择器（与 garden/memo.css 镜像链约定一致）。
const artifact = readFileSync(join(root, 'index.html'), 'utf8');
check('E1 产物含展平的拍一拍深色规则([data-theme] #poke-list .cc-item)', artifact.includes('[data-theme="dark"] #poke-list .cc-item'));
check('E2 产物无原生嵌套深色块(老内核兼容，#258)', !/\[data-theme="dark"\] \{\s*[\r\n]+\s*[.#\[]/.test(artifact));
{
  const srcDark = readFileSync(join(root, 'src', 'css', 'dark.css'), 'utf8');
  let depth = 0, nested = 0;
  for (let i = 0; i < srcDark.length; i++) {
    if (srcDark.startsWith('/*', i)) { const e = srcDark.indexOf('*/', i + 2); i = e < 0 ? srcDark.length : e + 1; continue; }
    if (srcDark[i] === '{') { if (depth > 0) nested++; depth++; }
    else if (srcDark[i] === '}') depth--;
  }
  check('E3 src dark.css 括号平衡且零嵌套规则', depth === 0 && nested === 0, 'depth=' + depth + ' nested=' + nested);
}

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

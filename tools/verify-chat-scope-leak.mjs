// ===== 验证脚本：#536 单聊气泡样式/对比度自愈「作用域泄漏」到群聊 =====
// 用法：node tools/verify-chat-scope-leak.mjs        （需先 npm run build，脚本读仓库根 index.html）
// 背景（用户报障，Redmi K70E + Edge，明说其他设备型号也有、要求不要覆盖修改引发跨机型回归）：
//   「群聊里我发消息整个框变黑看不到字，没有修改过气泡和文字颜色，什么也没动过」。
// 根因（纯逻辑、零机型分支）：单聊的两处气泡样式注入都用【全局选择器】，而群聊页复用同一套
//   .msg-out/.msg-in/.msg-bubble 类名却有自己的气泡变量：
//   ① chat-settings.js `_ensureBubbleContrast()`——单聊文字/底色对比度 <1.5 时注入
//      `.msg-out .msg-bubble.msg-bubble{color:#111111!important}`（全局）。用户把单聊气泡改成浅色
//      （如 #ffffff）而文字色仍是默认白（他从未改过文字色）→ 触发自愈注入黑字；该规则同时命中
//      群聊「我的气泡」（群聊默认底 #111111）＝黑字黑底，整框看不见。这正是「什么也没动过」的形态。
//   ② chat-settings.js `applyCss()`——单聊自定义气泡 CSS 经 mochiMapBubbleCss 映射时 scope 传空串，
//      产出的 `.msg-out .msg-bubble{…}` 同样全局命中群聊。
// 修复口径：两处注入都收敛到单聊页作用域（#page-chat，收藏页 #page-fav 同源保留），群聊不再受影响。
// 断言分两层：
//   S 层（纯 Node 抽源码，快速）：确认源码里的自愈选择器已带页面作用域前缀、不再出现全局形态。
//   B 层（无头 Chrome 跑真实产物，行为级）：单聊仍自愈（黑字可读）、群聊不被污染（字色/对比度正常）、
//        单聊自定义气泡 CSS 只作用于单聊、群聊不受影响。
// RED 基线：把两处改回全局选择器（或对产物做等价替换）后 B2/B4 必红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? ' \u2014 ' + extra : '')); }
};

// ---------------- S 层：源码断言 ----------------
console.log('S 层：源码选择器作用域');
{
  const cs = readFileSync(join(root, 'src/js/chat-settings.js'), 'utf8');
  ok(cs.includes('#page-chat .msg-out .msg-bubble.msg-bubble'), 'S1 自愈出站选择器带 #page-chat 作用域');
  ok(cs.includes('#page-chat .msg-in .msg-bubble.msg-bubble'), 'S2 自愈入站选择器带 #page-chat 作用域');
  ok(!/rules\.push\('\.msg-out \.msg-bubble/.test(cs), 'S3 自愈不再出现全局 .msg-out 选择器');
  ok(!/rules\.push\('\.msg-in \.msg-bubble/.test(cs), 'S4 自愈不再出现全局 .msg-in 选择器');
  ok(cs.includes("mochiMapBubbleCss(css, '#page-chat ')"), 'S5 单聊自定义气泡 CSS 映射带 #page-chat 作用域');
  ok(!cs.includes("mochiMapBubbleCss(css, '')"), 'S6 单聊自定义气泡 CSS 不再用空 scope（全局）');
  ok(cs.includes('#page-fav .msg-out .msg-bubble.msg-bubble') || cs.includes('#page-page-fav'), 'S7 收藏页气泡保留自愈覆盖（同源页不降级）');
}

// ---------------- B 层：无头行为 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }
if (!existsSync(join(root, 'index.html'))) { console.error('index.html 不存在，先 npm run build'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

const cdpPort = 9800 + Math.floor(Math.random() * 400);
const profile = join(process.env.TEMP || '/tmp', 'mochi-536-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

async function waitWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + cdpPort + '/json/version');
      const j = await r.json();
      if (j && j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('Chrome 未就绪');
}
const wsUrl = await waitWs();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map();
ws.onmessage = (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params, sessionId) => new Promise((res) => {
  const id = ++mid; pend.set(id, res);
  ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
});

const t = await send('Target.createTarget', { url: 'about:blank' });
const targetId = t.result.targetId;
const att = await send('Target.attachToTarget', { targetId, flatten: true });
const sid = att.result.sessionId;
await send('Emulation.setDeviceMetricsOverride', { width: 406, height: 706, deviceScaleFactor: 2, mobile: true }, sid);
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36 EdgA/152.0.0.0' }, sid);
await send('Page.enable', {}, sid);
await send('Runtime.enable', {}, sid);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result && r.result.result ? r.result.result.value : null;
};

const SCAN = `(function(){
  var scan=function(rootId){var pg=document.getElementById(rootId);var out=[];if(!pg)return out;
    pg.querySelectorAll('.msg-bubble').forEach(function(b){var cs=getComputedStyle(b);
      out.push({cls:(b.closest('.msg')||{className:''}).className,bg:cs.backgroundColor,color:cs.color,text:(b.innerText||'').slice(0,10)});});
    return out;};
  var fx=document.getElementById('cs-contrast-fix');
  return {group:scan('page-group-chat'),chat:scan('page-chat'),
          heal:fx?fx.textContent:'',
          outVar:getComputedStyle(document.getElementById('page-chat')).getPropertyValue('--msg-out-bg').trim()};
})()`;

// 每次 case：先把种子注入到「新文档执行前」（等同 playwright addInitScript），再导航。
// 不要用「先 clear 再 reload」——那样首帧读到空存储、与真实用户路径不符（本脚本曾因此误报）。
async function seedAndLoad(cfg) {
  const r = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      try{
        localStorage.clear();
        localStorage.setItem('xy-home-v2:group-chat-enabled','1');
        localStorage.setItem('xy-home-v2:theme-mode','light');
        localStorage.setItem('xy-home-v2:__contacts', JSON.stringify([{id:'default',name:'默认'}]));
        ${cfg}
      }catch(e){}
    })();`
  }, sid);
  await send('Page.navigate', { url: baseUrl + '/index.html' }, sid);
  await sleep(2800);
  return r && r.result ? r.result.identifier : null;
}

async function openBoth() {
  // 先打开单聊灌一条我方消息
  await evalJs(`(function(){
    var splash=document.querySelector('.splash'); if(splash) splash.remove();
    document.querySelectorAll('.modal-mask,#backup-remind-bar').forEach(function(n){n.remove()});
    document.body.classList.remove('scroll-lock');
    var ca=document.querySelector('.app[data-app="chat"]'); if(ca) ca.click();
    return 1;
  })()`);
  await sleep(900);
  await evalJs(`(function(){
    var inp=document.getElementById('chat-input'); if(!inp) return 0;
    inp.focus(); inp.innerHTML='单聊测试文本';
    inp.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    var s=document.getElementById('chat-send'); if(s) s.click(); return 1;
  })()`);
  await sleep(700);
  // 再在群聊页灌一条我方消息（走真实发送链路；不隐藏单聊页，保证计算样式无 display:none 干扰）
  await evalJs(`(function(){
    var pg=document.getElementById('page-group-chat'); if(pg) pg.hidden=false;
    var inp=document.querySelector('#page-group-chat .chat-input'); if(!inp) return 0;
    inp.focus(); inp.innerHTML='群聊测试文本';
    inp.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    var b=document.getElementById('gc-send'); if(b) b.click(); return 1;
  })()`);
  await sleep(800);
  return await evalJs(SCAN);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
}
function parseRgb(c) {
  const m = /rgba?\(([^)]+)\)/.exec(String(c || ''));
  if (!m) return null;
  const p = m[1].split(',').map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function relLum(c) {
  const q = parseRgb(c); if (!q || q.a === 0) return null;
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(q.r) + 0.7152 * f(q.g) + 0.0722 * f(q.b);
}
function contrastOf(c1, c2) {
  const a = relLum(c1), b = relLum(c2);
  if (a === null || b === null) return null;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

console.log('B 层：无头 Chrome 真实产物（像素级对照：气泡底色/字色直接与元素同值比对）');

// B1/B3：单聊气泡改浅色 + 文字色仍默认白 → 触发自愈；单聊须可读、群聊不得被污染
{
  await seedAndLoad(`localStorage.setItem('xy-home-v2:default:cs-out-bg','#ffffff');`);
  const r = await openBoth();
  const chatOut = (r.chat || []).find((b) => /msg-out/.test(b.cls));
  const gcOut = (r.group || []).find((b) => /msg-out/.test(b.cls));
  const healText = r.heal || '';
  ok(!!healText && healText.indexOf('#page-chat') >= 0, 'B1 自愈规则已注入且带 #page-chat 作用域', healText.slice(0, 90));
  // 单聊：气泡底=白，字应被自愈成深色（与白底对比 >= 3）
  const chatContrast = chatOut ? contrastOf(chatOut.color, hexToRgb('#ffffff')) : null;
  ok(chatContrast !== null && chatContrast >= 3, 'B2 单聊浅色气泡的文字仍可读（自愈生效）',
    chatOut ? 'color=' + chatOut.color + ' vs 底#ffffff contrast=' + (chatContrast === null ? '-' : chatContrast.toFixed(2)) : '缺单聊气泡');
  // 群聊：默认黑底白字，不得被单聊自愈改成黑字
  ok(!!gcOut && gcOut.color !== 'rgb(17, 17, 17)', 'B3 群聊「我的气泡」文字未被单聊自愈写成深色（黑底黑字）',
    gcOut ? 'bg=' + gcOut.bg + ' color=' + gcOut.color : '缺群聊气泡');
  ok(!!gcOut && contrastOf(gcOut.color, gcOut.bg) >= 3, 'B4 群聊「我的气泡」文字可读（对比度 >= 3）',
    gcOut ? gcOut.bg + ' / ' + gcOut.color + ' = ' + contrastOf(gcOut.color, gcOut.bg).toFixed(2) : '缺群聊气泡');
}

// B5/B6：单聊自定义气泡 CSS（深色底）不得套进群聊
{
  await seedAndLoad(`localStorage.setItem('xy-home-v2:default:cs-bubble-css','background:#000080;color:#000080;');`);
  const r = await openBoth();
  const gcss = await evalJs(`(function(){var s=document.getElementById('cs-bubble-style');return s?s.textContent:''})()`);
  const gcOut = (r.group || []).find((b) => /msg-out/.test(b.cls));
  const chatOut = (r.chat || []).find((b) => /msg-out/.test(b.cls));
  ok(!!gcss && gcss.indexOf('#page-chat') >= 0, 'B5 单聊自定义气泡样式已加 #page-chat 作用域', String(gcss).slice(0, 90));
  ok(!gcss || gcss.indexOf('#page-group-chat') < 0, 'B6 单聊自定义气泡样式不含群聊作用域（不主动套群聊）', String(gcss).slice(0, 90));
  // 群聊气泡须保持默认黑底白字，不被单聊深蓝底/深蓝字污染
  ok(!!gcOut && gcOut.bg === 'rgb(17, 17, 17)' && contrastOf(gcOut.color, gcOut.bg) >= 3,
    'B7 群聊气泡未被单聊自定义样式污染（仍是默认黑底白字）',
    gcOut ? 'bg=' + gcOut.bg + ' color=' + gcOut.color + ' contrast=' + (contrastOf(gcOut.color, gcOut.bg) || 0).toFixed(2) : '缺群聊气泡');
  // 单聊侧自定义样式确实生效（深蓝底）
  ok(!!chatOut && chatOut.bg === 'rgb(0, 0, 128)', 'B8 单聊侧自定义气泡样式确实生效（作用域收窄未削弱单聊）',
    chatOut ? 'bg=' + chatOut.bg : '缺单聊气泡');
}

// B9：默认配色（未改任何颜色）下群聊/单聊均正常
{
  await seedAndLoad('');
  const r = await openBoth();
  const chatOut = (r.chat || []).find((b) => /msg-out/.test(b.cls));
  const gcOut = (r.group || []).find((b) => /msg-out/.test(b.cls));
  ok(!!chatOut && chatOut.bg === 'rgb(17, 17, 17)' && contrastOf(chatOut.color, chatOut.bg) >= 3,
    'B9 默认配色单聊「我的气泡」= 黑底白字可读',
    chatOut ? chatOut.bg + ' / ' + chatOut.color : '-');
  ok(!!gcOut && gcOut.bg === 'rgb(17, 17, 17)' && contrastOf(gcOut.color, gcOut.bg) >= 3,
    'B10 默认配色群聊「我的气泡」= 黑底白字可读',
    gcOut ? gcOut.bg + ' / ' + gcOut.color : '-');
}

try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

console.log('\n' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);

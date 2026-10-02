// ===== 验证脚本：聊天输入栏「打字不显示/空白」四道加固（#115，构建后跑产物） =====
// 用法：node build.mjs && node tools/verify-chat-input-guard.mjs
// 检查项：
//   ① 输入栏聚焦时独立合成层已建立（CSS 产物 + computed transform 实测）
//   ② 防复活守卫真实编辑闸门：发送后重打同一条短句必须留在框里（原缺陷会静默吞字）
//   ③ v3.14 语义保持：无输入活动的「内核迟到写回」仍然要被清掉
//   ④ 防双击连发仍生效（同文本两次 click 只落一条消息）
//   ⑤ 内部滚动残留自愈（伪造几何做逻辑级断言）+ 多行真滚动绝不误伤
//   ⑥ 安卓键盘探针与输入轨迹已接入诊断链路
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const built = readFileSync(join(root, 'index.html'), 'utf8');
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT || 9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-cig-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function connect() {
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = async (expr) => JSON.parse((await evalJs(expr)) || '{}');
// 逐键真实按键：与真人输入同序（keydown → beforeinput → input），守卫靠这个判「真实编辑」
async function typeKeys(text) {
  await evalJs("document.getElementById('chat-input').focus();1");
  await sleep(150);
  for (const ch of text) {
    const code = 'Key' + ch.toUpperCase();
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch, code, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
  }
  await sleep(120);
}
// 整段一次性提交（真实中文输入法 / 粘贴的事件形态）。逐键 ASCII 输入在第一个字符
// 就走进守卫的 else 分支摘掉 _mClearTxt，永远命不中「内容与刚发送文本完全一致」的
// 吞字判据；只有整段提交才会——而这正是用户报障的形态（发「好的」再打「好的」）。
async function imeCommit(text) {
  await evalJs("document.getElementById('chat-input').focus();1");
  await sleep(150);
  await evalJs("(function(){var el=document.getElementById('chat-input');" +
    "el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true, data:''}));" +
    "el.textContent='" + text + "';" +
    "el.dispatchEvent(new InputEvent('beforeinput', {bubbles:true, inputType:'insertCompositionText', isComposing:true}));" +
    "el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertCompositionText', isComposing:true}));" +
    "el.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true, data:'" + text + "'}));" +
    "el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText'}));return 1;})()");
  await sleep(120);
}
const SNAP = "(function(){var el=document.getElementById('chat-input');if(!el)return '{}';" +
  "return JSON.stringify({txt:el.textContent,len:(el.innerText||'').length," +
  "clearTxt:String(el._mClearTxt||''),st:Math.round(el.scrollTop),sh:Math.round(el.scrollHeight),ch:Math.round(el.clientHeight)});})()";

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await connect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 406, height: 739, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(1000);
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return 1;})()");
await sleep(500);
await evalJs("(function(){try{localStorage.removeItem('xy-home-v2:__diag-inp');}catch(e){}return 1;})()");

// ---- ① 合成层 ----
check('①a 产物含两条输入栏合成层规则', built.includes('.phone .chat-input { will-change:transform; }') && built.includes('.phone .chat-input:focus { transform: translateZ(0); }'));
await evalJs("document.getElementById('chat-input').focus();1");
await sleep(250);
const wc = await evalJs("(function(){var el=document.getElementById('chat-input');return JSON.stringify({wc:getComputedStyle(el).willChange,active:document.activeElement===el,hasFocus:document.hasFocus()});})()");
const wcj = JSON.parse(wc || '{}');
check('①b 常驻 will-change:transform 已生效（与焦点无关，层在键盘平移前就存在）', wcj.wc === 'transform', wc);
const cssom = await evalJs("(function(){var hit='';for(var i=0;i<document.styleSheets.length;i++){var rs;try{rs=document.styleSheets[i].cssRules;}catch(e){continue;}" +
  "for(var j=0;j<rs.length;j++){var r=rs[j];var list=r.type===4?r.cssRules:[r];" +
  "for(var k=0;k<list.length;k++){var c=list[k];if(c.selectorText&&/\\.phone \\.chat-input:focus/.test(c.selectorText)&&/translateZ|matrix3d/.test(c.cssText))hit=c.cssText;}}}" +
  "return hit;})()");
check('①c CSSOM 里 :focus translateZ 规则可命中（无头文档未获焦点时 :focus 不参与 computed，hasFocus=' + wcj.hasFocus + '）', !!cssom, String(cssom));
const gcWc = await evalJs("(function(){var el=document.getElementById('gc-input');return el?getComputedStyle(el).willChange:'MISSING';})()");
check('①d 群聊输入栏 #gc-input 共用 .chat-input 同样命中', gcWc === 'transform', String(gcWc));

// ---- ② 重打同一条短句不被吞 ----
const T = 'qz7k';
await typeKeys(T);
const s1 = await J(SNAP);
check('②a 逐键输入能进框（基线）', s1.txt === T, JSON.stringify(s1));
await evalJs("document.getElementById('chat-send').click();1");
await sleep(250);
const s2 = await J(SNAP);
check('②b 发送后框已清空且守卫已挂', s2.txt === '' && s2.clearTxt === T, JSON.stringify(s2));
await imeCommit(T);          // 用户视角：输入法整段上屏重打同一条短句（逐键打不会命中吞字判据）
const s3 = await J(SNAP);
check('②c 整段重打同一条短句 120ms 后仍在框里（原缺陷在此被静默清空）', s3.txt === T, JSON.stringify(s3));
await sleep(1000);           // 越过 [200,800]ms 迟到兜底
const s4 = await J(SNAP);
check('②d 兜底复查跑完（+1s）文本仍在、守卫标记已摘', s4.txt === T && s4.clearTxt === '', JSON.stringify(s4));

// ---- ③ 内核迟到写回仍被清（v3.14 语义保持） ----
await evalJs("(function(){var el=document.getElementById('chat-input');el.textContent='" + T + "';el.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
await sleep(120);
await evalJs("document.getElementById('chat-input').blur();document.getElementById('chat-send').click();1");
await sleep(100);
await evalJs("(function(){var el=document.getElementById('chat-input');el.focus();return 1;})()");
await sleep(150);
await evalJs("document.getElementById('chat-send').click();1");   // 清框并挂守卫
await sleep(120);
const s5 = await J(SNAP);
check('③a 再次发送后守卫就位（clearTxt 已挂）', s5.txt === '' && s5.clearTxt === T, JSON.stringify(s5));
// 无任何 keydown/composition 活动，内核把刚提交的组合文本整体写回
await evalJs("(function(){var el=document.getElementById('chat-input');el.textContent='" + T + "';el.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
await sleep(250);
const s6 = await J(SNAP);
check('③b 无输入活动的迟到写回仍被清掉（v3.14 防复活语义未退化）', s6.txt === '', JSON.stringify(s6));

// ---- ④ 防双击连发仍生效 ----
const D = 'w9tt';
await typeKeys(D);
await evalJs("document.getElementById('chat-send').click();1");
await sleep(60);
await evalJs("document.getElementById('chat-send').click();1");   // 两次 click 之间无键入
await sleep(400);
const cnt = await evalJs("(function(){var b=document.getElementById('chat-body');return (b.innerHTML.match(/" + D + "/g)||[]).length;})()");
check('④ 双击连点只落一条消息（防重发未被闸门放开）', Number(cnt) === 1, 'count=' + cnt);

// ---- ⑤ 内部滚动残留自愈（伪造几何：无头无法造出「缩了内容 scrollTop 还挂着」的真实现场） ----
const heal = await J("(function(){var el=document.getElementById('chat-input');" +
  "var out={};" +
  "Object.defineProperty(el,'scrollTop',{value:40,writable:true,configurable:true});" +
  "Object.defineProperty(el,'scrollHeight',{get:function(){return 23;},configurable:true});" +
  "Object.defineProperty(el,'clientHeight',{get:function(){return 23;},configurable:true});" +
  "el.textContent='短内容';el.dispatchEvent(new Event('input',{bubbles:true}));" +
  "out.afterShort=el.scrollTop;" +
  "Object.defineProperty(el,'scrollTop',{value:40,writable:true,configurable:true});" +
  "Object.defineProperty(el,'scrollHeight',{get:function(){return 300;},configurable:true});" +
  "Object.defineProperty(el,'clientHeight',{get:function(){return 96;},configurable:true});" +
  "el.dispatchEvent(new Event('input',{bubbles:true}));" +
  "out.afterTall=el.scrollTop;" +
  "delete el.scrollTop;out.cleaned=Object.getOwnPropertyDescriptor(el,'scrollTop')===undefined;" +
  "return JSON.stringify(out);})()");
check('⑤a 内容不超高而 scrollTop=40 → input 后归零', heal.afterShort === 0, JSON.stringify(heal));
check('⑤b 多行真滚动（sh>ch）不误伤，scrollTop 保持', heal.afterTall === 40, JSON.stringify(heal));

// ---- ⑥ 诊断链路 ----
const probe = await J("(function(){var kb=(typeof window.__mochiAndroidKb==='function')?window.__mochiAndroidKb():null;" +
  "var vg=(typeof window.mochiVvDiag==='function')?window.mochiVvDiag():null;" +
  "var tr=[];try{tr=JSON.parse(localStorage.getItem('xy-home-v2:__diag-inp')||'[]');}catch(e){}" +
  "return JSON.stringify({hasProbe:!!kb,kbActive:kb?kb.kbActive:null,diagKb:!!(vg&&vg.kb)," +
  "traceN:tr.length,traceTags:tr.map(function(i){return i.k+':'+i.x+':n'+i.n;}).slice(-6)});})()");
check('⑥a 安卓键盘探针已导出且 mochiVvDiag().kb 不再是 null', probe.hasProbe === true && probe.diagKb === true, JSON.stringify({ hasProbe: probe.hasProbe, diagKb: probe.diagKb }));
check('⑥b 输入轨迹已记录到诊断环形缓冲（含 chat-input 条目）', probe.traceN > 0 && (probe.traceTags || []).join('|').indexOf('chat-input') >= 0, JSON.stringify(probe.traceTags));
check('⑥c 诊断文本「聊天输入栏现场」行已接入产物', built.includes('聊天输入栏现场：元素='));

const errs = await evalJs("(function(){return JSON.stringify((window.__jsErrors||[]).slice(-3));})()");
check('⑦ 全程无新增 JS 异常', !errs || errs === '[]', String(errs));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

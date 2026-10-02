// ===== 常驻回归脚本 #978：切后台再切回「聊天记录不贴底、最新消息整块顶到上半屏、下半全空」 =====
// 用法：node tools/verify-chat-resume-realign.mjs [被测根目录]
// 缺陷形态（零机型分支）：#930 回场复核在固定 350ms 后【当场裸写】scrollChatBottom()——回场瞬间正是
// 浏览器自身几何恢复风暴（系统栏回归/瓦片重建/视口复核），几何变动中途写 scrollTop ⇒ 内核滚动树停
// 旧偏移（#871 真机定性＝内容整块上移、下方留白）；且撕裂态 scrollTop 读数 ≥ max−8，「离底>8」判据
// 与 #706 看门狗全数失明 ⇒ 停在坏态只有轻点屏幕（touchend 同值写）救得回。
// 修法断言面：回场贴底改「几何落定后同值重落一枪」。
// 判据口径（重要）：对 scrollTop 写入做【调用栈归因】——只认栈里带 chatResumeRealignStep 的写入
//（＝本批新落的「回场重对齐枪」）。回场窗口里来消息的合法跟底（renderMsg→maybeScrollChatBottom，
//   合成回前台会触发补投链）会污染原始写计数，但对新函数归因的判据完全免疫；
//   纯 HEAD 红副本没有该函数 ⇒ 归因写恒 0 ⇒ 行为断言全红，判别力确定。
//   S1~S4 产物锚（js/chat.js）；S5 旧裸写行必须已拆（删除型）。
//   A0 前置：进聊天贴底。
//   B0 预热回场：排干种子数据首轮回场的补投/跟底动画，之后是稳态回场口径。
//   B1 健康贴底短离场回场：贴底保持，且【本枪必然落发 ≥1 次】（撕裂态唯一修法；纯 HEAD＝0 必红）。
//   B2 回场几何风暴：BACK 后持续派发视口 resize（等效「系统栏回归/视口复核」风暴），风暴窗口内
//      本枪必须被落定闸摁住（=0）；风暴停＋几何落定后本枪补发 ≥1 且保持贴底。
//   B3 #162 契约：短离场＋解钉态回场零写入（含本枪 0 发）、不被拽底（防修过头守卫）。
//   B4 长离场（override 65s）＋解钉态回场：落定后回底（#930 语义保持）。
//   Z1 全程零 JS 异常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : '')); }
let product = '';
try { product = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
check('S1 回场重对齐入口在位', product.includes('function chatResumeRealign() {'));
check('S2 回场复核改排班落定枪（旧裸写调用点已替换）', product.includes('chatResumeRealign();'));
check('S3 落定闸未静默续等在位', product.includes('if (!chatRepinQuietEnough(now)) { if (now < _rsResumeDeadline) _rsResumeT = setTimeout(chatResumeRealignStep, 120); return; }'));
check('S4 回场分派（visibilitychange）在位', product.includes('else chatResumeRepin();'));
check('S5 旧「回场 350ms 当场裸写」已拆（删除型）', !product.includes('if (chatScrollMax() - body.scrollTop > 8) { scrollChatBottom(); chatEntrySettle(); }'));

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-976-' + Date.now()), '--remote-debugging-port=' + (Number(process.env.MOCHI_CDP_PORT) || 9326), 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsErrors = [];
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort() + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErrors.push(String(m.params.exceptionDetails.text || '').slice(0, 120)); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('no cdp');
}
function cdpPort() { return Number(process.env.MOCHI_CDP_PORT) || 9326; }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 160)); return null; }
  return r && r.result ? r.result.value : null;
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 772, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(900);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(800);
// 静音备份提醒/版本条 + 关自动回复概率（减少回场窗口的来消息噪声；残余噪声由栈归因判据免疫）
await evalJs("(function(){var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));st.set('cs-rp-auto-prob','0');try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}return true;})()");

// 种 320 条历史（尾部少量图＝常见形态）
await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return true;})()");
await sleep(300);
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(300);
await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(800);
await evalJs("(function(){var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));st.set('cs-rp-auto-prob','0');const now=Date.now();const arr=[];for(let i=0;i<320;i++){const r={side:i%2?'in':'out',text:'记录'+String(i).padStart(3,'0'),ts:now-(320-i)*60000};if(i>=314)r.img='/s'+i+'.png';arr.push(r);}st.set('chat-msgs',JSON.stringify(arr));return true;})()");
await sleep(400);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
await sleep(3000);

// 进入/回场驱动器：覆写 visibilityState（恢复原描述符）后派发事件＝事件契约的等效注入（与 #930 脚本同款）
const GO = (state, ageMs) => `(function(){
  try {
    if (${JSON.stringify(state)} === 'hidden') { window.__origVS = Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') || Object.getOwnPropertyDescriptor(document,'visibilityState'); }
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return ${JSON.stringify(state)};}});
    window.__chatHiddenAgeMs = ${ageMs === null ? 'null' : ageMs};
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const BACK = `(function(){
  try {
    if (window.__origVS) { Object.defineProperty(document,'visibilityState',window.__origVS); window.__origVS = null; }
    else { delete document.visibilityState; }
    document.dispatchEvent(new Event('visibilitychange'));
    delete window.__chatHiddenAgeMs; // 派发之后再清＝产品在 visible 分支读 override
  } catch (e) { return String(e && e.message || e); }
  return 'ok';
})()`;
const SNAP = `(function(){
  var b=document.getElementById('chat-body');
  if(!b)return JSON.stringify({err:1});
  return JSON.stringify({top:Math.round(b.scrollTop),gap:Math.round(b.scrollHeight-b.scrollTop-b.clientHeight),sh:b.scrollHeight,ch:b.clientHeight});
})()`;
// scrollTop 写入计数＋栈归因：__sets＝全部写入；__rs＝栈里带 chatResumeRealignStep 的写入（本枪）
const ARM = `(function(){
  var b=document.getElementById('chat-body');
  if(!b)return 'no-body';
  if (b.__stSet) { window.__sets = 0; window.__rs = 0; return 'ok'; }
  var d=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
  b.__stSet=d.set; b.__stGet=d.get;
  Object.defineProperty(b,'scrollTop',{configurable:true,get:function(){return this.__stGet.call(this);},set:function(v){
    window.__sets=(window.__sets||0)+1;
    try { var st=new Error().stack||''; if (st.indexOf('chatResumeRealignStep')>=0) window.__rs=(window.__rs||0)+1; } catch(e){}
    this.__stSet.call(this,v);
  }});
  window.__sets = 0; window.__rs = 0;
  return 'ok';
})()`;
const CNT = `(function(){return JSON.stringify({sets:window.__sets||0,rs:window.__rs||0});})()`;

// A0
let s = JSON.parse(await evalJs(SNAP) || '{}');
check('A0 前置：聊天页在贴底', !s.err && Math.abs(s.gap) <= 8, 'gap=' + s.gap);
check('A0b 写入计数器挂载', (await evalJs(ARM)) === 'ok');

// B0 预热回场：排干种子数据首轮回场的补投/跟底动画，之后各阶段为稳态回场口径
await evalJs(GO('hidden', null));
await sleep(1200);
await evalJs(BACK);
await sleep(2800);
s = JSON.parse(await evalJs(SNAP) || '{}');
check('B0 预热回场后仍贴底', !s.err && Math.abs(s.gap) <= 8, 'gap=' + (s && s.gap));

// B1 健康贴底＋短离场回场：贴底保持，且本枪必然落发 ≥1（撕裂态唯一修法；纯 HEAD＝0 必红）
await evalJs(GO('hidden', null));
await sleep(1200);
await evalJs("(function(){window.__sets=0;window.__rs=0;return true;})()"); // BACK 前清零＝只统计回场窗口
await evalJs(BACK);
await sleep(2800);
s = JSON.parse(await evalJs(SNAP) || '{}');
let c = JSON.parse(await evalJs(CNT) || '{}');
check('B1 健康回场贴底保持', !s.err && Math.abs(s.gap) <= 8, 'gap=' + (s && s.gap));
check('B1b 回场重对齐枪落发 ≥1（栈归因本枪；撕裂态唯一修法）', c.rs >= 1, 'rs=' + c.rs + ' sets=' + c.sets);

// B2 回场几何风暴：风暴窗口内本枪必须被落定闸摁住（=0）；风暴停＋落定后补发 ≥1 且贴底
await evalJs(GO('hidden', null));
await sleep(1000);
await evalJs("(function(){window.__sets=0;window.__rs=0;return true;})()"); // BACK 前清零
await evalJs(BACK);
for (let i = 0; i < 8; i++) { await evalJs("(function(){window.dispatchEvent(new Event('resize'));return true;})()"); await sleep(130); } // 风暴前半 ~1s（覆盖旧代码 350ms 裸写时点）
let cm = JSON.parse(await evalJs(CNT) || '{}');
for (let i = 0; i < 6; i++) { await evalJs("(function(){window.dispatchEvent(new Event('resize'));return true;})()"); await sleep(130); } // 风暴后半 ~0.8s
await sleep(2800); // 风暴停 + 几何落定（≥180ms）+ 落定闸重试窗口
s = JSON.parse(await evalJs(SNAP) || '{}');
c = JSON.parse(await evalJs(CNT) || '{}');
check('B2 风暴窗口内本枪被落定闸摁住（=0；裸写打风暴＝撕裂源）', cm.rs === 0, 'midRs=' + cm.rs + ' midSets=' + cm.sets);
check('B2b 风暴落定后本枪补发 ≥1 且贴底', c.rs >= 1 && !s.err && Math.abs(s.gap) <= 8, 'rs=' + c.rs + ' gap=' + (s && s.gap));

// B3 #162 契约：短离场＋解钉态回场零写入、不被拽底
await evalJs(`(function(){
  var b=document.getElementById('chat-body');
  try { var t=new Touch({identifier:1,target:b,clientX:100,clientY:600}); b.dispatchEvent(new TouchEvent('touchstart',{touches:[t],targetTouches:[t],changedTouches:[t],bubbles:true,cancelable:true})); } catch(e){ b.dispatchEvent(new Event('touchstart',{bubbles:true})); }
  b.scrollTop = Math.max(0, b.scrollHeight - b.clientHeight - 800);
  try { var t2=new Touch({identifier:1,target:b,clientX:100,clientY:600}); b.dispatchEvent(new TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[t2],bubbles:true,cancelable:true})); } catch(e){ b.dispatchEvent(new Event('touchend',{bubbles:true})); }
  return true;
})()`);
await sleep(300);
await evalJs("(function(){window.__sets=0;window.__rs=0;return true;})()");
await evalJs(GO('hidden', null));
await sleep(1200);
await evalJs(BACK);
await sleep(2800);
s = JSON.parse(await evalJs(SNAP) || '{}');
c = JSON.parse(await evalJs(CNT) || '{}');
check('B3 解钉态回场零写入（#162 不打扰；来消息跟底在解钉态同样被拦）', c.sets === 0 && c.rs === 0, 'sets=' + c.sets + ' rs=' + c.rs);
check('B3b 解钉态不被拽底（仍在历史位）', !s.err && s.gap > 300, 'gap=' + (s && s.gap));

// B4 长离场（65s）＋解钉态回场：视同重新进聊天＝回底（#930 语义保持）
await evalJs(GO('hidden', 65000));
await sleep(500);
await evalJs(BACK);
await sleep(3200);
s = JSON.parse(await evalJs(SNAP) || '{}');
check('B4 长离场回场视同进聊天＝回底', !s.err && Math.abs(s.gap) <= 8, 'gap=' + (s && s.gap));

check('Z1 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);

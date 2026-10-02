// #760 聊天美化「边看边调」抽屉遮挡自救批验证（无头 Chrome，测构建产物 index.html）
// 立项（用户 2026-09-18 派单「检查边看边调还能怎么优化」，审阅后全量落地）：
//   ① 抽屉可拖动（grip 此前是纯装饰）＋会话内记忆；② 键盘抬升走 visualViewport（源级=哨兵 #760a，
//   无头无法真弹键盘，行为面不测）；③ 打开滚到最新消息＋空对话注入示例气泡（关抽屉必清）；
//   ④ FLOAT_SELECTORS 登记锁背景；⑤ 补 cs-send-show / cs-time-ink 两个设置页有而抽屉缺的控件；
//   ⑥ 滑杆双击复位、调色盘收起、热区垫高。
// 用法：node build.mjs && node tools/verify-cs-beauty-drawer.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-cs-beauty-drawer.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vcbd-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };
// per-cid 命名空间键读取：按后缀找（xy-home-v2:<cid>:<key>）
const LSK = `function lsVal(k){var f=Object.keys(localStorage).find(function(x){return x===k||x.indexOf(':'+k)>=0;});return f?localStorage.getItem(f):null;}`;

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);

// ---- C3a 有真实消息：先克隆撑出可滚高度，滚到顶部后开抽屉应自动回到底 ----
const pre3 = J(await evalJs(`(function(){var cb=document.getElementById('chat-body');if(!cb)return JSON.stringify({real:-1});var m=cb.querySelector('.msg');for(var i=0;m&&i<20;i++)cb.appendChild(m.cloneNode(true));cb.scrollTop=0;return JSON.stringify({real:cb.querySelectorAll('.msg').length,atTop:cb.scrollTop<=4,overflow:cb.scrollHeight-cb.clientHeight>50});})()`));
await evalJs(`(function(){var b=document.getElementById('cs-live-adjust');if(b)b.click();return !!b;})()`);
await sleep(500);
const c3a = J(await evalJs(`(function(){var cb=document.getElementById('chat-body');return JSON.stringify({atBottom:cb.scrollHeight-cb.scrollTop-cb.clientHeight<=4});})()`));
ok(pre3.real <= 0 || c3a.atBottom === true,
  'C3a 打开即滚到最新消息（停在半屏时不再只看到时间轴碎片；前置：真消息数=' + pre3.real + '）', JSON.stringify(c3a));

// ---- C3b 空对话：关抽屉并清空消息 DOM（模拟新联系人/清空记录），重开应注入示例气泡 ----
await evalJs(`(function(){var d=document.getElementById('chat-beauty-drawer');var x=[...d.querySelectorAll('button')].find(function(b){return b.textContent==='\\u2715';});if(x)x.click();return true;})()`);
await sleep(300);
await evalJs(`(function(){var cb=document.getElementById('chat-body');if(cb)cb.innerHTML='';return true;})()`);
await evalJs(`(function(){var b=document.getElementById('cs-live-adjust');if(b)b.click();return !!b;})()`);
await sleep(500);
const c3b = J(await evalJs(`(function(){
  var cb=document.getElementById('chat-body');if(!cb)return JSON.stringify({err:'no-body'});
  return JSON.stringify({demo:cb.querySelectorAll('.msg[data-cs-demo]').length,
    real:cb.querySelectorAll('.msg:not([data-cs-demo])').length,
    bothSides:!!(cb.querySelector('.msg-out[data-cs-demo]')&&cb.querySelector('.msg-in[data-cs-demo]')),
    atBottom:cb.scrollHeight-cb.scrollTop-cb.clientHeight<=4});
})()`));
ok(c3b.demo === 2 && c3b.bothSides === true && c3b.atBottom === true,
  'C3b 空对话注入一入一出示例气泡并滚到底（「改哪看哪」在零消息会话也有得看；只进 DOM 不落存储）', JSON.stringify(c3b));
const c1 = J(await evalJs(`(function(){
  var d=document.getElementById('chat-beauty-drawer');if(!d)return JSON.stringify({err:'no-drawer'});
  return JSON.stringify({vis:d.getClientRects().length>0,disp:d.style.display,
    chat:!document.getElementById('page-chat').hidden,
    semi:d.style.background.indexOf('color-mix')>=0});
})()`));
ok(c1.vis === true && c1.disp === 'flex' && c1.chat === true,
  'C1 点入口＝抽屉打开且切到聊天页（改哪看哪的前提）', JSON.stringify(c1));
ok(c1.semi === true, 'C2 抽屉半透明底保持 #562 口径（纯色＝又整块挡住聊天）', JSON.stringify(c1));

// C4 拖动：header 上 pointer 序列 → 抬到约 120px；拖回近底 → 吸附 0
const c4 = J(await evalJs(`(function(){
  ${LSK}
  var d=document.getElementById('chat-beauty-drawer');
  var hd=d.children[1];
  function pe(el,t,y){el.dispatchEvent(new PointerEvent(t,{pointerId:7,pointerType:'touch',isPrimary:true,clientY:y,clientX:200,bubbles:true,cancelable:true}));}
  pe(hd,'pointerdown',420); pe(hd,'pointermove',300); pe(hd,'pointerup',300);
  var up=parseInt(d.style.bottom)||0;
  pe(hd,'pointerdown',300); pe(hd,'pointermove',560); pe(hd,'pointerup',560);
  var down=parseInt(d.style.bottom)||0;
  return JSON.stringify({up:up,down:down});
})()`));
ok(c4.up >= 100 && c4.up <= 130, 'C4 标题行竖向拖动生效（grip 不再是纯装饰；抬 120px 见 bottom≈120）', JSON.stringify(c4));
ok(c4.down === 0, 'C4b 拖回近底吸附回贴底（<24px 归零，会话内记忆不留残渣位置）', JSON.stringify(c4));

// C5 栏位区补「发送按钮显示/隐藏」：点隐藏 → #chat-send display:none + 键落盘；点显示复位
const c5 = J(await evalJs(`(function(){
  ${LSK}
  var d=document.getElementById('chat-beauty-drawer');
  [...d.querySelectorAll('[data-sec]')].find(function(b){return b.textContent==='栏位';}).click();
  var hide=[...d.querySelectorAll('button')].find(function(b){return b.textContent.indexOf('隐藏')>=0;});
  if(!hide)return JSON.stringify({err:'no-pill'});
  hide.click();
  var hidBtn=document.getElementById('chat-send');
  var r1={disp:hidBtn?hidBtn.style.display:'',key:lsVal('cs-send-show')};
  [...d.querySelectorAll('button')].find(function(b){return b.textContent==='显示';}).click();
  return JSON.stringify({r1:r1,disp2:hidBtn?hidBtn.style.display:''});
})()`));
ok(c5.r1 && c5.r1.disp === 'none' && c5.r1.key === 'hide' && c5.disp2 === '',
  'C5 抽屉内「发送按钮显示/隐藏」即时生效且可复位（设置页有、抽屉此前漏了的项）', JSON.stringify(c5));

// C6 字体·其他区补「时间轴文字色」：点色块出调色盘 → 点色块落盘 → 「收起」清盘
const c6 = J(await evalJs(`(function(){
  ${LSK}
  var d=document.getElementById('chat-beauty-drawer');
  [...d.querySelectorAll('[data-sec]')].find(function(b){return b.textContent.indexOf('字体')>=0;}).click();
  var item=[...d.querySelectorAll('div')].find(function(x){return x.childElementCount===2&&x.textContent==='时间轴文字色'|| (x.textContent||'').indexOf('时间轴文字色')>=0&&x.style&&x.style.cursor==='pointer';});
  if(!item)return JSON.stringify({err:'no-item'});
  item.click();
  var dots=[...d.querySelectorAll('span')].filter(function(s){return s.style&&s.style.width==='23px';});
  var tipOn=!![...d.querySelectorAll('div')].find(function(x){return x.childElementCount===0&&(x.textContent||'').indexOf('正在调')>=0;});
  if(dots.length)dots[0].click();
  var key=lsVal('cs-time-ink');
  var hideBtn=[...d.querySelectorAll('button')].find(function(b){return b.textContent==='收起';});
  if(hideBtn)hideBtn.click();
  var tipOff=!![...d.querySelectorAll('div')].find(function(x){return x.childElementCount===0&&(x.textContent||'').indexOf('正在调')>=0;});
  var rootVar=getComputedStyle(document.documentElement).getPropertyValue('--msg-time-ink').trim();
  return JSON.stringify({dots:dots.length,tipOn:tipOn,key:key,hasHide:!!hideBtn,tipOff:tipOff,rootVar:rootVar});
})()`));
ok(c6.dots > 0 && c6.tipOn === true && !!c6.key && c6.hasHide === true && c6.tipOff === true && /^#/.test(c6.rootVar || ''),
  'C6 抽屉内「时间轴文字色」调色盘展开→选色即时落盘并写 --msg-time-ink→「收起」就地收回（不再常驻占两行高）', JSON.stringify(c6));

// C7 滑杆双击复位：气泡圆角拖到 35 落盘，双击回默认 18
const c7 = J(await evalJs(`(function(){
  ${LSK}
  var d=document.getElementById('chat-beauty-drawer');
  [...d.querySelectorAll('[data-sec]')].find(function(b){return b.textContent==='气泡';}).click();
  var rows=[...d.querySelectorAll('div')].filter(function(x){return (x.textContent||'').indexOf('气泡圆角')>=0&&x.querySelector('input[type=range]');});
  var row=rows[rows.length-1]; if(!row)return JSON.stringify({err:'no-row'});
  var inp=row.querySelector('input[type=range]');
  inp.value='35'; inp.dispatchEvent(new Event('input',{bubbles:true}));
  var moved=lsVal('cs-bubble-radius');
  inp.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  return JSON.stringify({moved:moved,after:lsVal('cs-bubble-radius'),val:inp.value});
})()`));
ok(c7.moved === '35px' && c7.after === '18px' && c7.val === '18',
  'C7 滑杆双击恢复默认（35px→dblclick→18px 落盘，免回设置页复位）', JSON.stringify(c7));

// C8 背景滚动锁：以「#chat-beauty-drawer 是否在册」判定（自动化环境开屏问答门 #modal-mask
// 天然开着，body 级锁位归因不到本抽屉头上），等 1s 看门狗对账
await sleep(1300);
const c8b = J(await evalJs(`(function(){var i=window.scrollLockInfo?window.scrollLockInfo():{};return JSON.stringify({open:(i.open||[]).indexOf('#chat-beauty-drawer')>=0,bodyScroll:getComputedStyle(document.body).overflow});})()`));
ok(c8b.open === true && c8b.bodyScroll === 'hidden',
  'C8 抽屉开着＝FLOAT_SELECTORS 登记生效，被滚动锁在册（#527 同族约定补到聊天版）', JSON.stringify(c8b));
await evalJs(`(function(){var d=document.getElementById('chat-beauty-drawer');var x=[...d.querySelectorAll('button')].find(function(b){return b.textContent==='\\u2715';});if(x)x.click();return true;})()`);
await sleep(1300);
const c8c = J(await evalJs(`(function(){
  var cb=document.getElementById('chat-body');
  var i=window.scrollLockInfo?window.scrollLockInfo():{};
  return JSON.stringify({stillInList:(i.open||[]).indexOf('#chat-beauty-drawer')>=0,
    demo:cb?cb.querySelectorAll('.msg[data-cs-demo]').length:-1,
    drawerHidden:(document.getElementById('chat-beauty-drawer').style.display==='none'),
    settings:!document.getElementById('page-chat-settings').hidden});
})()`));
ok(c8c.stillInList === false, 'C8b 关抽屉后从滚动锁在册名单移除（不残留＝不复发「全页滑不动」）', JSON.stringify(c8c));
ok(c8c.demo === 0 && c8c.drawerHidden === true && c8c.settings === true,
  'C9 关抽屉：示例气泡全部清除、回聊天设置页（假消息绝不残留进正常聊天）', JSON.stringify(c8c));

// C10 全程零未捕获 JS 异常
const c10 = J(await evalJs(`(function(){return JSON.stringify({n:(window.__jsErrors||[]).length,e:(window.__jsErrors||[]).slice(0,2)});})()`));
ok(c10.n === 0, 'C10 全程零未捕获 JS 异常', JSON.stringify(c10));

console.log('\nverify-cs-beauty-drawer: ' + pass + ' PASS / ' + fail + ' FAIL');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

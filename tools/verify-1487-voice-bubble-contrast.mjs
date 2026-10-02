// ===== #1487 界面级回归：浅色「我的气泡」上语音条整块隐形（＝用户所见「发出去变成文字气泡、点不动」）=====
// 用法：SERVE_ROOT=<被测产物目录> node tools/verify-1487-voice-bubble-contrast.mjs
//   被测根＝该目录（副本 g＝HEAD+本批、副本 r＝纯 HEAD 各跑一次＝同尺 A/B）
// 报障：作者实报「在聊天里使用语音功能发送语音，会莫名其妙发送出去变成文字气泡而不是语音条，
//       发送出去后也不能播放点击听我的语音」＋截图（白底气泡里只剩「语音 2″」四个字，没有播放钮、没有波形）。
// 根因（零机型／零主题分支）：语音条的播放钮与波形在 out 侧被钉死成白色
//   （`.msg-out .msg-voice-play{color:#fff}` / `.msg-out .msg-voice-wave i{background:#fff}`），
//   而「我的消息底色」是用户可改的美化项（聊天设置 → 气泡底色）。底色一改成浅色：
//   ① 正文由 #536 对比度自愈（_ensureBubbleContrast）翻成深色＝文字看得见；
//   ② 钮与波形不吃这套，仍是白的＝与气泡底色同色＝整块隐形，只剩名称文字。
//   用户看到的就是「一条只有字的白气泡」＝报障原文的「变成文字气泡」；找不到能点的地方＝「不能播放」。
//   深色主题下 dark.css 那份兜底把钮钉成 --ink（浅色）＝同一个洞的另一半（C6）。
// 判据：只量两个事实——播放钮图标的实际用色、波形条的实际用色，各自与所在气泡底色的 WCAG 对比度。
//   阈值 1.5 与 #536 自愈同口径（低于它＝与底色撞色＝隐形）。
// 断言：
//   S1~S6 产物静态锚（五针＋旧形态不回流）
//   C1 默认深色 out 气泡：语音条可见（对照组，两侧皆绿＝没修过头）
//   C2/C3 浅色 out 气泡（作者场景）：钮图标／波形条与气泡底色对比 ≥1.5（红侧＝白钮白底＝整块隐形）
//   C4 浅色 out 气泡：整条仍是「钮＋波形＋名称」三件且钮真占位（不是退化成文字气泡）
//   C5 浅色 in 气泡：同一口径可见（in 侧旧写法吃全局 --ink，对照）
//   C6 深色主题＋浅色 out 气泡：仍可见（dark.css 那份钉色兜底不得反过来咬人）
//   P1 作者场景下点播放钮真的起播（隐形钮「点不动」在可见之后必须消失）
//   Z1 全程零未捕获异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || process.env.SERVE_DIR || here);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('被测根目录: ' + root);
if (!existsSync(join(root, 'index.html'))) { console.error('找不到产物 index.html'); process.exit(2); }

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : '  〈' + JSON.stringify(extra).slice(0, 300) + '〉'));
}
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const hits = (text, needle) => text.split(needle).length - 1;

const cssProd = read('index.html');

// ---------- S 组：产物静态锚（与 build.mjs 的 #1487a~e 同一批字符串） ----------
const ANCH = [
  ['S1 #1487a 钮底那层由 currentColor 现算（不再钉黑钉白）', ".msg-voice-play::before { content:''; position:absolute; inset:0; border-radius:50%; z-index:-1; background:currentColor; opacity:.16;", false],
  ['S2 #1487b 钮本体只认所在气泡的字色（自身不铺色＋描边吃 currentColor）', 'border:1px solid currentColor; background:transparent;', false],
  ['S3 #1487c 波形条同口径', 'width:3px; border-radius:2px; background:currentColor; opacity:.45;', false],
  ['S4 #1487d out 侧不再钉死白色', '.msg-out .msg-voice-play { color:inherit; }', false],
  ['S5 #1487e 深色模式那份钉色兜底已退役（回流＝深色主题＋浅色气泡又隐形）', '[data-theme="dark"] .msg-voice-play { background:var(--dark-card)', true],
];
ANCH.forEach(([n, needle, absent]) => { const h = hits(cssProd, needle); check(n, absent ? h === 0 : h === 1, h); });
check('S6 旧钉死形态不得回流（out 侧白底白字／波形钉白）',
  hits(cssProd, '.msg-out .msg-voice-play { background:rgba(255,255,255,.16)') === 0 && hits(cssProd, '.msg-out .msg-voice-wave i { background:#fff') === 0);

// ---------- 起浏览器 ----------
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10400 + Math.floor(Math.random() * 60));
const tmpProfile = join(process.env.TEMP || '/tmp', 'mochi-1487-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + tmpProfile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => {
  try { chrome.kill(); } catch (e) {}
  try { rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {}
});

let ws = null, msgId = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return true;
      }
    } catch (e) {}
    await sleep(150);
  }
  return false;
}
if (!await connect()) { console.error('无法连接无头浏览器'); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });

async function openApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var b=document.querySelector('.splash-confirm-btn')||document.getElementById('splash-confirm-ok');if(b)b.click();var s=document.querySelector('.splash')||document.getElementById('splash');if(s)s.classList.add('hide');return 1;})()");
  await sleep(400);
  await evalJs("(function(){try{window.enterChat();}catch(e){}return 1;})()");
  await sleep(900);
}

await openApp();
check('C0 应用已载入并进入聊天页', await evalJs("(function(){return !!window.getChatMsgs && !document.getElementById('page-chat').hidden;})()") === true);

// ---------- 夹具自证：页内真录一段（P1 要的是「点下去真出声」，不是「点下去有个提示」） ----------
const REC = await evalJs(`(async function(){
  try {
    var ac=new AudioContext(); var osc=ac.createOscillator(); var dst=ac.createMediaStreamDestination();
    osc.connect(dst); osc.start();
    var rec=new MediaRecorder(dst.stream,{mimeType:'audio/webm;codecs=opus'});
    var ch=[]; rec.ondataavailable=function(e){ if(e.data&&e.data.size) ch.push(e.data); };
    var st=new Promise(function(r){ rec.onstop=r; }); rec.start();
    await new Promise(function(r){ setTimeout(r,2000); }); rec.stop(); await st;
    osc.stop(); try { await ac.close(); } catch(e){}
    var b=new Blob(ch,{type:'audio/webm;codecs=opus'});
    var buf=new Uint8Array(await b.arrayBuffer());
    var s=''; for (var i=0;i<buf.length;i++) s+=String.fromCharCode(buf[i]);
    return { ok:true, src:'data:audio/webm;codecs=opus;base64,'+btoa(s), size:b.size };
  } catch(e){ return { ok:false, err:String(e&&e.message) }; }
})()`);
check('C0b 夹具真实：页内录到一段可解码的 webm（P1 的「出声」才有得量）', REC && REC.ok && REC.size > 2000, REC && { size: REC.size, err: REC.err });
if (!REC || !REC.ok) { console.error('夹具录音失败，后面全部无从判起'); process.exit(2); }
const VOICE_SRC = REC.src;

// 把两条语音（out/in 各一条）种进聊天记录，走应用自己的写库口再重载
async function seed(cfg) {
  const sets = Object.keys(cfg).map((k) => 's.set(' + JSON.stringify(k) + ',' + JSON.stringify(cfg[k]) + ');').join(' ');
  const r = await evalJs(`(function(){
    try {
      var s=window.activeStore(); var ts=Date.now();
      var recs=[
        {side:'out',text:'语音 2″|||${VOICE_SRC}',type:'voice',ts:ts},
        {side:'in',text:'语音 3″|||${VOICE_SRC}',type:'voice',ts:ts+1}
      ];
      var j=JSON.stringify(recs);
      s.set('chat-msgs', j);
      if (window.idbSet) window.idbSet((window.activePrefix()||'')+':chat-msgs', j);
      ${sets}
      return 'ok';
    } catch(e){ return 'err:'+(e&&e.message); }
  })()`);
  if (r !== 'ok') { console.error('种子写入失败: ' + r); process.exit(2); }
  await sleep(1500);
  await openApp();
}

// 量「语音条三件」的实际用色 vs 所在气泡底色
// ⚠️ 注入体里不许写正则字面量：模板串多剥一层反斜杠，Chrome 报「Invalid regular expression:
//    missing /」＝整段求值失败、读数为 null（实测踩过）。取色只按字符扫数字，rgb/rgba 通吃。
const MEASURE = `(function(){
  function nums(s){ var a=[], cur=''; s=String(s||'');
    for (var i=0;i<s.length;i++){ var ch=s.charAt(i);
      if ((ch>='0'&&ch<='9')||ch==='.') { cur+=ch; } else { if(cur){ a.push(parseFloat(cur)); cur=''; } } }
    if(cur){ a.push(parseFloat(cur)); } return a; }
  function lum(c){ var n=nums(c); if(n.length<3) return null;
    var a=n.length>3?n[3]:1; if(a>1){a=1;}
    var f=function(v){ v=(v/255)*a+(1-a); return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f(n[0])+0.7152*f(n[1])+0.0722*f(n[2]); }
  function ratio(a,b){ var l1=lum(a), l2=lum(b); if(l1===null||l2===null) return -1;
    return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); }
  function px(v){ var n=parseFloat(v); return isFinite(n)?n:0; }
  function one(side){
    var box=document.querySelector('#chat-body .msg-'+side+' .msg-voice'); if(!box) return null;
    var bubble=box.closest('.msg-bubble'); if(!bubble) return null;
    var btn=box.querySelector('.msg-voice-play'); if(!btn) return null;
    var svg=btn.querySelector('svg');
    var bar=box.querySelector('.msg-voice-wave i');
    var bg=getComputedStyle(bubble).backgroundColor;
    var icon=getComputedStyle(svg||btn).color;
    var barc=bar?getComputedStyle(bar).backgroundColor:'';
    var r=btn.getBoundingClientRect(), rr=bubble.getBoundingClientRect();
    return {
      bubbleBg:bg, iconColor:icon, barColor:barc,
      iconVsBubble:+ratio(icon,bg).toFixed(2),
      barVsBubble:+ratio(barc,bg).toFixed(2),
      btnW:px(r.width), btnH:px(r.height),
      btnInside:(r.left>=rr.left-1 && r.right<=rr.right+1 && px(r.width)>8),
      bars:box.querySelectorAll('.msg-voice-wave i').length,
      name:(box.querySelector('.msg-voice-name')||{}).textContent||''
    };
  }
  return { out:one('out'), in:one('in') };
})()`;

const PASS_MIN = 1.5; // 与 #536 对比度自愈同一阈值

// ---------- C1 默认配色（深色 out 气泡）——对照组 ----------
await seed({});
let m = await evalJs(MEASURE);
check('C1 默认深色 out 气泡：语音条可见（钮/波形都在，对比 ≥' + PASS_MIN + '）',
  m && m.out && m.out.iconVsBubble >= PASS_MIN && m.out.barVsBubble >= PASS_MIN && m.out.bars === 5, m && m.out);

// ---------- C2~C4 作者场景：把「我的消息底色」改成浅色 ----------
await seed({ 'cs-out-bg': '#ffffff' });
m = await evalJs(MEASURE);
const o = m && m.out;
check('C2 浅色 out 气泡：播放钮图标与气泡底色对比 ≥' + PASS_MIN + '（红侧＝白钮白底＝整块隐形）', !!o && o.iconVsBubble >= PASS_MIN, o);
check('C3 浅色 out 气泡：波形条与气泡底色对比 ≥' + PASS_MIN, !!o && o.barVsBubble >= PASS_MIN, o);
check('C4 浅色 out 气泡：语音条仍是「钮＋波形＋名称」三件且钮真占位（不是退化成文字气泡）',
  !!o && o.btnW >= 20 && o.btnH >= 20 && o.btnInside && o.bars === 5 && o.name.indexOf('语音') === 0, o);

// ---------- C5 浅色 in 气泡（in 侧旧写法吃全局 --ink，对照） ----------
await seed({ 'cs-in-bg': '#ffffff', 'cs-in-ink': '#ffffff' });
m = await evalJs(MEASURE);
check('C5 浅色 in 气泡：语音条同口径可见', !!m && !!m.in && m.in.iconVsBubble >= PASS_MIN && m.in.barVsBubble >= PASS_MIN, m && m.in);

// ---------- C6 深色主题 + 浅色 out 气泡 ----------
await seed({ 'cs-out-bg': '#ffffff' });
await evalJs("(function(){document.documentElement.setAttribute('data-theme','dark');return 1;})()");
await sleep(600);
m = await evalJs(MEASURE);
const o6 = m && m.out;
check('C6 深色主题＋浅色 out 气泡：语音条仍可见（dark.css 那份兜底不得反过来咬人）',
  !!o6 && o6.iconVsBubble >= PASS_MIN && o6.barVsBubble >= PASS_MIN, o6);

// ---------- P1 作者场景下点播放钮真的起播 ----------
await seed({ 'cs-out-bg': '#ffffff' });
await evalJs("(function(){var t=document.getElementById('cc-toast');if(t){t.textContent='';t.className='cc-toast';}return 1;})()");
const p1 = await evalJs(`(async function(){
  try {
    var btn=document.querySelector('#chat-body .msg-out .msg-voice-play'); if(!btn) return {err:'no-btn'};
    var r=btn.getBoundingClientRect();
    btn.click();
    await new Promise(function(res){ setTimeout(res,600); });
    var playing=btn.classList.contains('playing');
    var toast=(document.getElementById('cc-toast')||{}).textContent||'';
    var ring=(window.__mochiVoiceDead||[]).slice(-1)[0]||null;
    if (playing) { btn.click(); }
    return { playing:playing, w:Math.round(r.width), h:Math.round(r.height), toast:toast, ring:ring };
  } catch(e){ return {err:String(e&&e.message)}; }
})()`);
check('P1 作者场景下点播放钮真的起播（红侧＝钮隐形＝没有可点的地方）',
  !!p1 && !p1.err && p1.playing === true, p1);

// ---------- Z1 零未捕获异常 ----------
const errs = await evalJs("(function(){return (window.__jsErrors||[]).slice(0,5);})()");
check('Z1 全程零未捕获异常', Array.isArray(errs) && errs.length === 0, errs);

if (process.env.MOCHI_1487_SHOT) {
  // ⚠️ 「默认档」必须把本跑前面几轮 seed 写过的底色显式改回来：seed 只写不清，
  //    传 {} 会把上一轮的白气泡带到「默认」截图里（实测两张截图字节数几乎相同＝在拍同一个态）。
  await seed(process.env.MOCHI_1487_SHOT_DEF ? { 'cs-out-bg': '#111111', 'cs-out-ink': '#ffffff' } : { 'cs-out-bg': '#ffffff' });
  // 两者混用会截到别处（实测截成了开屏卡）；此处 clip 用视口坐标＋captureBeyondViewport:false。
  const where = await evalJs(`(function(){
    var a=document.querySelector('#chat-body .msg-out .msg-voice'); if(!a) return 'no-voice';
    a.scrollIntoView({block:'center'});
    var r=a.getBoundingClientRect();
    return { top:Math.round(r.top), left:Math.round(r.left), w:Math.round(r.width), splash:!(document.getElementById('splash')||{hidden:true}).hidden };
  })()`);
  await sleep(300);
  // 截图专用拆罩（不参与任何断言）：开屏把 .phone 整棵压成 visibility:hidden 的规则是
  // `.splash:not(.hide) ~ .phone`——只设 `#splash.hidden` 属性顶不掉它（旧写法量得到色、截出来一片白）。
  await evalJs("(function(){var s=document.querySelector('.splash')||document.getElementById('splash');if(s)s.classList.add('hide');document.body.classList.remove('scroll-lock');return 1;})()");
  await sleep(200);
  const clip = await evalJs(`(function(){
    var a=document.querySelector('#chat-body .msg-out .msg-voice'); if(!a) return null;
    var m=a.closest('.msg'), r=m.getBoundingClientRect();
    return { x:Math.max(0,r.left-10), y:Math.max(0,r.top-10), width:r.width+20, height:r.height+20 };
  })()`);
  const useClip = process.env.MOCHI_1487_SHOT_FULL ? null : clip;
  const shot = await cdp('Page.captureScreenshot', useClip ? { format: 'png', captureBeyondViewport: false, clip: Object.assign({ scale: 4 }, useClip) } : { format: 'png' });
  if (shot && shot.data) {
    const dest = join(here, 'tools', process.env.MOCHI_1487_SHOT);
    writeFileSync(dest, Buffer.from(shot.data, 'base64'));
    console.log('截图已存 ' + dest + '  〈' + JSON.stringify(where) + '〉');
  }
}

const pass = results.filter((r) => r.ok).length;
console.log('\n#1487 共 ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
server.close();
process.exit(pass === results.length ? 0 : 1);

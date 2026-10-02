// ===== v3.26.x 验证脚本：#1308 语音「播不了」＝录进来的字节里根本没有声音 =====
// 用法：cd <被测产物目录> && node tools/verify-1308-voice-empty-gate.mjs
//       （被测根＝本脚本所在仓库根，首行打印；副本 g=HEAD+本批、副本 r=纯 HEAD 各跑一次＝同尺 A/B）
// 报障：华为畅享70Pro／Chrome「我方发的语音没有办法播放 显示语音播放失败」，用户明说其他机型同现、
//       不许按机型打补丁。红米设备导出件【最近错误】里那几条 data:audio/webm;codecs=opus 的 base64
//       解出来＝36 字节 EBML 容器头 + 一长串 0 字节（无头实测内核回执：MEDIA_ERR_SRC_NOT_SUPPORTED）。
// 判据（零机型／零 UA 分支）：只取「内核有没有回话」与「内核报的是哪个 code」两个事实。
// 断言：
//   S1~S7 产物静态锚（七针逐条在位）；S8 旧形态（error 与 play() 双份笼统提示）不得回流
//   P1 夹具真实：空壳载荷被内核当场拒（两侧皆绿，证明「被测的这段字节确实播不了」）
//   P2 夹具真实：真录音能被内核读出元数据、而它的 duration 恒不是有限正数
//      ＝这条是「闸门不许拿 duration 当判据」的实证；两侧皆绿
//   G1 空壳走完真录音链路 → 被内核回执闸拦在发送之前（发送键仍灰／提示重录／气泡不增／现场留证）
//      ＝红侧（纯 HEAD）坏件照样发进聊天记录＝报障原文
//   G2 真数据走完同一条链路 → 照常发得出去（对照，闸门没把正常录音拦死）
//   D1 播放一条存量空壳 → 文案点名「没有可播放的声音，需要重新录一条」＋按钮回到未播放态＋留证 code=4
//   D2 自动播放被拒（NotAllowedError、无 MediaError）→ 不得误判成坏件，文案照旧（对照）
//   D3 试听那一路共用同一判据（chatVoiceUnopenable）
//   Z1 全程零未捕获异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = process.env.SERVE_ROOT ? normalize(process.env.SERVE_ROOT) : here;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('被测根目录: ' + root);
if (!existsSync(join(root, 'index.html'))) { console.error('找不到产物 index.html'); process.exit(2); }

const results = [];
function check(name, ok, extra) {
results.push({ name, ok: !!ok });
console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : '  〈' + JSON.stringify(extra).slice(0, 220) + '〉'));
}
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const hits = (text, needle) => text.split(needle).length - 1;

const chatProd = read('js/chat.js');
const indexProd = read('index.html');

// ---------- S 组：产物静态锚（与 build.mjs 的 #1308a~g 同一批字符串） ----------
const ANCH = [
['S1 #1308a 录音结账后的内核回执闸（拦下并留证）', chatProd, "chatVoiceWitness('gate', { kind: blob.type || '?', bytes: blob.size });"],
['S2 #1308b 探针「内核当场报错＝解不开」这条态在位', chatProd, "a.addEventListener('error', () => fin('no'));"],
['S3 #1308c 没回话＝unknown（不许认死）且窗口有下限', chatProd, "setTimeout(() => fin('unknown'), Math.max(120, ms || VOICE_PROBE_MS));"],
['S4 #1308d 回执迟到先对轮次', chatProd, 'if (_seq !== voiceProbeSeq) return;'],
['S5 #1308e 气泡播放按 MediaError.code 分流', chatProd, "chatVoiceWitness(dead ? 'play' : 'play-load'"],
['S6 #1308f 试听那一路同一判据', chatProd, "chatVoiceWitness(dead ? 'preview' : 'preview-load'"],
['S7 #1308g 诊断【数据】段回吐语音载荷体检', indexProd, "L.push('语音载荷体检：' + window.__voiceDiag())"],
];
ANCH.forEach(([n, text, needle]) => check(n, hits(text, needle) === 1, hits(text, needle)));
check('S8 旧形态不回流（播放失败的双份笼统提示收成一处）', hits(chatProd, "toast('语音播放失败'); });\na.play().then(() => {}).catch(() =>") === 0);

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 60));
const tmpProfile = join(process.env.TEMP || '/tmp', 'mochi-1308-' + Date.now());
const chrome = spawn(chromePath, [
'--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
'--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
'--autoplay-policy=no-user-gesture-required',
'--user-data-dir=' + tmpProfile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {} });

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

// ---------- 夹具：空壳（真机形态）与真录音 ----------
const DEAD_SRC = 'data:audio/webm;codecs=opus;base64,' + 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC' + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
await openApp();
check('P0 应用已载入且进入聊天页', await evalJs("(function(){return !!window.getChatMsgs && !document.getElementById('page-chat').hidden;})()") === true);

// ---------- 夹具：把一条「存量空壳语音」种进聊天记录后重载（与 verify-voice-play-icon 同款套路） ----------
// 不能靠页内 push+重渲染：chat.js 没有对外渲染入口，且真链路要走 loadMsgs/权威回填。
async function openApp() {
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var b=document.querySelector('.splash-confirm-btn')||document.getElementById('splash-confirm-ok');if(b)b.click();var s=document.getElementById('splash');if(s)s.hidden=true;return 1;})()");
await sleep(400);
await evalJs("(function(){try{window.enterChat();}catch(e){}return 1;})()");
await sleep(900);
}
const seedRes = await evalJs(`(function(){
  try {
    var recs=[{side:'out',text:'语音 2″|||${DEAD_SRC}',type:'voice',ts:Date.now()}];
    var j=JSON.stringify(recs);
    var s=window.activeStore(); s.set('chat-msgs', j);
    if (window.idbSet) window.idbSet((window.activePrefix()||'')+':chat-msgs', j);
    return 'ok';
  } catch(e){ return 'err:'+(e&&e.message); }
})()`);
if (seedRes !== 'ok') { console.error('种子写入失败: ' + seedRes); process.exit(2); }
await sleep(1200); // 等 idbSet 落盘再重载，避免权威回填把种子回滚
await openApp();
let playIdx = -1;
let seedDbg = null;
for (let t = 0; t < 14; t++) {
await sleep(500);
seedDbg = await evalJs("(function(){var a=document.querySelectorAll('#chat-body .msg-voice');var h=[];for(var i=0;i<a.length;i++)h.push((a[i].getAttribute('data-src')||'').slice(0,40));return {idx:-1,heads:h,msgs:(window.getChatMsgs()||[]).length};})()");
if (seedDbg) for (let i = 0; i < seedDbg.heads.length; i++) { if (seedDbg.heads[i].slice(0, 34) === DEAD_SRC.slice(0, 34)) seedDbg.idx = i; }
playIdx = seedDbg ? seedDbg.idx : -1;
if (playIdx >= 0) break;
}
check('D0 存量空壳语音已渲成气泡（夹具落地）', playIdx >= 0, seedDbg);

// P1/P2 用裸 <audio> 元素问内核（不调用被测函数＝夹具自身的真伪自证，两侧都必须绿）
const RAW = `(function(src){return new Promise(function(res){
  var a=new Audio(); a.preload='metadata'; a.style.display='none'; document.body.appendChild(a);
  var out={verdict:'',code:0,dur:null,finite:false};
  a.addEventListener('loadedmetadata',function(){ if(out.verdict)return; out.verdict='open'; out.dur=isFinite(a.duration)?a.duration:'Infinity'; out.finite=isFinite(a.duration)&&a.duration>0; document.body.removeChild(a); res(out); });
  a.addEventListener('error',function(){ if(out.verdict)return; out.verdict='refuse'; out.code=a.error?a.error.code:0; document.body.removeChild(a); res(out); });
  a.src=src; a.load(); setTimeout(function(){ if(!out.verdict){out.verdict='silent'; document.body.removeChild(a); res(out);} },5000);
});})`;
const p1 = await evalJs(`${RAW}(${JSON.stringify(DEAD_SRC)})`);
check('P1 夹具真实：空壳载荷被内核当场拒（code=4）', p1 && p1.verdict === 'refuse' && p1.code === 4, p1);

const realRecord = async (ms) => await evalJs(`(async function(){
  const ac=new AudioContext(); const osc=ac.createOscillator(); const dst=ac.createMediaStreamDestination();
  osc.connect(dst); osc.start();
  const rec=new MediaRecorder(dst.stream,{mimeType:'audio/webm;codecs=opus'});
  const ch=[]; rec.ondataavailable=(e)=>{ if(e.data&&e.data.size) ch.push(e.data); };
  const st=new Promise(r=>{rec.onstop=r;}); rec.start(); await new Promise(r=>setTimeout(r,${ms})); rec.stop(); await st;
  osc.stop(); try{ await ac.close(); }catch(e){}
  const b=new Blob(ch,{type:'audio/webm;codecs=opus'});
  const buf=new Uint8Array(await b.arrayBuffer());
  let zeros=0; for(let i=36;i<buf.length;i++){ if(buf[i]===0) zeros++; else break; }
  return { b64: 'data:audio/webm;codecs=opus;base64,'+btoa(String.fromCharCode.apply(null,Array.from(buf))), size:b.size, zerosAfterHeader:zeros };
})()`);
const REAL = await realRecord(1200);
check('P0b 页内真录一段 webm/opus 就绪（容器头之后不是零填充）', REAL && REAL.size > 2000 && REAL.zerosAfterHeader === 0, REAL && { size: REAL.size, z: REAL.zerosAfterHeader });
const p2 = await evalJs(`${RAW}(${JSON.stringify(REAL ? REAL.b64 : '')})`);
check('P2 真录音内核解得开，而 duration 不是有限正数（＝闸门不许拿时长当判据）', p2 && p2.verdict === 'open' && p2.finite === false, p2);

// ---------- D 组：播放侧分流（气泡已由种子渲染，夹具位置见 D0） ----------
// 放在录音面板链路之前跑：发出去的那一条会引来 TA 的自动反应（收藏/回复 toast），
// 那 toast 会盖掉播放失败的提示，读到的就不是本批要验的那句话。
async function tapPlay(idx) {
await evalJs("(function(){var t=document.getElementById('cc-toast');if(t){t.textContent='';t.className='cc-toast';}return 1;})()");
await evalJs(`(function(){var b=document.querySelectorAll('#chat-body .msg-voice-play')[${idx}];if(b){b._t=1;b.click();}return !!b;})()`);
await sleep(1400);
return await evalJs("(function(){var t=document.getElementById('cc-toast');var b=document.querySelectorAll('#chat-body .msg-voice-play');var pl=0;for(var i=0;i<b.length;i++){if(b[i].classList.contains('playing'))pl++;}return {toast:t?t.textContent:'', stuckPlaying:pl, deadN:window.__mochiVoiceDeadN||0, last:(window.__mochiVoiceDead||[]).slice(-1)[0]||null};})()");
}
const d1 = await tapPlay(playIdx);
check('D1 播放存量空壳 → 文案点名「没有可播放的声音／需要重新录」（不再是一句没原因的播放失败）', d1 && /重新录/.test(d1.toast) && /没有可播放的声音/.test(d1.toast), d1 && d1.toast);
check('D1b 按一次只提示一次、按钮回到未播放态', d1 && d1.stuckPlaying === 0);
check('D1c 现场留证记下内核码 4', d1 && d1.last && d1.last.where === 'play' && d1.last.code === 4, d1 && d1.last);
// D2：自动播放被拒（play() 落空但没有 MediaError）不得被判成坏件
await evalJs(`(function(){
  var Real=window.Audio; window.__RealAudio=Real;
  function Fake(src){ var e=new Real(src); e.play=function(){ return Promise.reject(new DOMException('blocked','NotAllowedError')); }; return e; }
  window.Audio=function(src){ return Fake(src); }; return 1;
})()`);
const d2 = await tapPlay(playIdx);
check('D2 自动播放被拒时仍给原提示（不许误判成「这条是坏件」）', d2 && d2.toast === '语音播放失败', d2 && d2.toast);
await evalJs("(function(){window.Audio=window.__RealAudio;return 1;})()");
check('D3 试听那一路与气泡播放共用同一判据（chatVoiceUnopenable）', hits(chatProd, 'chatVoiceUnopenable(a)') >= 1 && hits(chatProd, 'function chatVoiceUnopenable') === 1, hits(chatProd, 'chatVoiceUnopenable'));

// ---------- G 组：真录音面板链路（录 → 结账 → 真按发送） ----------
// 面板的「录制完成」只解禁发送键，气泡要等点发送才入列 ⇒ 断言必须走完那一次点击，
// 否则红侧（纯 HEAD）把坏件发进聊天记录这件事根本没机会显形。
async function panelRecord(holdMs) {
await evalJs("(function(){var b=document.getElementById('chat-mic-btn');if(b)b.click();return 1;})()");
await sleep(400);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(holdMs);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
// 结账里现在挂着一次异步内核回执（≤1.6s），等它落定
await sleep(2400);
const mid = await evalJs(`(function(){var sb=document.getElementById('voice-send-btn');var st=document.getElementById('voice-status');return {
  sendDisabled: sb?sb.disabled:null, status: st?st.textContent:'', previewHidden: (function(){try{return document.getElementById('voice-preview').hidden;}catch(e){return null;}})(),
  bubble: document.querySelectorAll('#chat-body .msg-voice-play').length,
  deadN: window.__mochiVoiceDeadN||0, last: (window.__mochiVoiceDead||[]).slice(-1)[0]||null };})()`);
const bubblesBefore = mid ? mid.bubble : -1;
await evalJs("(function(){var b=document.getElementById('voice-send-btn');if(b)b.click();return 1;})()");
await sleep(1200);
const after = await evalJs(`(function(){var t=document.getElementById('cc-toast');return {
  bubble: document.querySelectorAll('#chat-body .msg-voice-play').length,
  msgs: (window.getChatMsgs()||[]).length, toast: t?t.textContent:'' };})()`);
return Object.assign({}, mid, { bubblesBefore: bubblesBefore, bubble2: after.bubble, msgs: after.msgs, sent: after.bubble > bubblesBefore });
}
// 把 MediaRecorder 换成「只回放指定分片」的桩：G1 用空壳、G2 用真数据，链路其余部分全走真的
async function stubRecorder(b64) {
await evalJs(`(function(){
  if (!window.__RealMR) window.__RealMR = window.MediaRecorder;
  var raw=atob(${JSON.stringify(b64)}.split(',')[1]); var buf=new Uint8Array(raw.length);
  for (var i=0;i<raw.length;i++) buf[i]=raw.charCodeAt(i);
  window.__vChunk=new Blob([buf],{type:'audio/webm;codecs=opus'});
  function Rec(stream,opts){ this.stream=stream; this.opts=(opts===undefined)?null:opts; this.state='inactive'; this.ondataavailable=null; this.onstop=null; this.onerror=null; }
  Rec.prototype.start=function(){ this.state='recording'; };
  Rec.prototype.stop=function(){ if(this.state!=='recording')return; this.state='inactive'; var self=this;
    setTimeout(function(){ if(self.ondataavailable) self.ondataavailable({data:window.__vChunk}); if(self.onstop) self.onstop(); },30); };
  Rec.isTypeSupported=function(t){ return /^audio\\//.test(String(t)); };
  window.MediaRecorder=Rec; return window.__vChunk.size;
})()`);
}
const VOICEBTN = "(function(){return document.querySelectorAll('#chat-body .msg-voice-play').length;})()";
const bubbles0 = await evalJs(VOICEBTN);
await stubRecorder(REAL.b64);
// G2 先跑真数据（对照）：闸门不许拦正常录音
const g2 = await panelRecord(1200);
check('G2 真数据走完面板链路 → 照常录完并发送得出去（键解禁＋气泡入列）', g2 && g2.sendDisabled === false && g2.bubble2 === bubbles0 + 1 && g2.sent === true, Object.assign({ bubbles0: bubbles0 }, g2));
// G1 空壳：被闸拦下
await stubRecorder(DEAD_SRC);
const bubblesA = await evalJs(VOICEBTN);
const deadN0 = await evalJs("(function(){return window.__mochiVoiceDeadN||0;})()");
const g1 = await panelRecord(1200);
check('G1 空壳被内核回执闸拦在发送之前（发送键仍灰＋提示重录＋点了也发不出去）', g1 && g1.sendDisabled === true && /重录|重试/.test(g1.status) && g1.bubble === bubblesA && g1.sent === false, Object.assign({ bubblesA: bubblesA }, g1));
check('G1b 拦下那一刻留下现场（where=gate）', g1 && g1.deadN > deadN0 && g1.last && g1.last.where === 'gate', g1 && g1.last);
check('G1c 拦下后不污染数据：坏件没成为待发载荷（试听区仍收起）', g1 && g1.previewHidden === true, g1 && g1.previewHidden);
await evalJs("(function(){if(window.__RealMR)window.MediaRecorder=window.__RealMR;return 1;})()");

// ---------- 诊断读数 ----------
const diagLine = await evalJs("(function(){try{return window.__voiceDiag?window.__voiceDiag():'NOHOOK';}catch(e){return 'ERR';}})()");
check('X1 诊断回读给出次数与最近一条现场（本会话已拦到过）', typeof diagLine === 'string' && diagLine !== 'NOHOOK' && /次/.test(diagLine), diagLine);

const uncaught = await evalJs("(function(){return (window.__jsErrors||[]).filter(function(s){return /Uncaught|voice-heal|1308/.test(String(s));}).length;})()");
check('Z1 全程零未捕获异常', uncaught === 0, uncaught);

const pass = results.filter((r) => r.ok).length;
console.log('—'.repeat(30));
console.log('结果: ' + pass + ' 绿 / ' + (results.length - pass) + ' 红（共 ' + results.length + ' 断言）');
process.exit(pass === results.length ? 0 : 1);

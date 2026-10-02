// ===== v3.26.x 验证脚本：#228 语音「点结束卡在录音中发不出去」停止链路兜底（OPPO Reno6 5G+雨见 Gecko 等多机型） =====
// 用法：SERVE_DIR=<产物目录> node tools/verify-voice-send.mjs   （默认 SERVE_DIR=仓库根，需先 node build.mjs）
// 背景：#169 修过「启动期连点」后，停止链路仍有四个静默卡死洞——①慢壳 ondataavailable/onstop 迟到或丢失：
//       面板永远停在「正在录音…」、发送键永远灰；②录出空数据（isTypeSupported 谎报的壳）：onVoiceRecStop
//       对空 blob 静默 return，同样永久卡「正在录音…」；③getUserMedia 永久挂起：#169 的 voiceStarting
//       闸门永不复位，之后每次点「开始录音」被静默忽略=面板看似点不动；④停止结账期间连点会偷走新录音机
//       句柄。修复=停止结账统一收口 voiceFinalizeStop（voiceStopSettled 幂等闩）+ onstop 3s 看门狗 + 空数据
//       可见失败态并换浏览器默认容器重试 + 麦克风 15s 启动看门狗（迟到流停轨防泄漏）+ voiceStopping 防重入。
// 红绿对照：对 753cc65 旧源构建 16/24（R7 旧版停止后永久卡「正在录音…/停止录音」=报障原文复现；R8/R10/R11/R12/R14/R15/R16 亦红），修复后 24/24。
// 断言：S* 静态锚（src 直查）；R* 运行时（无头 Chrome 走真实产物+真实面板流程，桩 MediaRecorder/getUserMedia
//       精确复现 ok / onstop丢失 / 空数据 / onstop迟到连点 / 中途关面板 / getUserMedia挂起 六种形态）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const serveDir = normalize(process.env.SERVE_DIR || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push(!!ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && detail !== '' ? '  [' + String(detail).slice(0, 220) + ']' : ''));
}

// ---- S 组：静态锚（对 src 断言） ----
const src = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
check('S1 stopVoiceRec 发 stop 前置 voiceStopping 闸 + 武装 onstop 看门狗', src.includes('voiceStopping = true; // FIX #228') && /armVoiceStopWatchdog\(\);[\s\S]{0,80}try \{ voiceRec\.stop\(\); \} catch \(e\) \{ voiceFinalizeStop\(\); \}/.test(src));
check('S2 停止结账看门狗 3s 自行结账（onstop 迟到/丢失兜底）', src.includes('voiceStopWatchdog = setTimeout(() => { voiceStopWatchdog = null; voiceFinalizeStop(); }, 3000);'));
check('S3 voiceFinalizeStop 幂等闩（三路结账只走一次）', src.includes('function voiceFinalizeStop()') && src.includes('if (voiceStopSettled) return;'));
check('S4 空数据可见失败态（不再静默卡「正在录音…」）+ 换默认容器重试', src.includes("st0.textContent = '没录到声音数据，请重试'") && src.includes('voiceMimeFallback = true;'));
check('S5 空数据时清残留可发送状态（防旧录音被误发）', /voiceDataUrl = ''; voiceDur = 0;[\s\S]{0,80}sb0\.disabled = true;/.test(src));
check('S6 麦克风启动看门狗 15s + TimeoutError 专属提示 + 迟到流停轨', src.includes('acquireVoiceStreamGuarded(15000)') && src.includes('麦克风无响应，请检查录音权限或重启浏览器后重试') && src.includes("s.getTracks().forEach((t) => t.stop())"));
check('S7 toggle/启动双向防重入（voiceStopping 期间忽略连点）', /async function toggleVoiceRecord\(\) \{\s*\nif \(voiceStopping\) return;/.test(src) && src.includes("if (voiceStopping) { toast('正在停止录音，请稍候'); return; }"));

// ---- R 组：运行时（无头 Chrome 端到端，桩 MediaRecorder/getUserMedia） ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(serveDir, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(serveDir)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const cdpPort = 9700 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vs-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

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
    if (r && r.exceptionDetails) return 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 300);
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

// 桩：在应用脚本之前注入。mode 控制故障形态；媒体能力全绿让面板进入真实录音状态机。
const INIT = `(function(){
try { localStorage.setItem('xy-home-v2:cs-voice-send','1'); localStorage.setItem('xy-home-v2:default:cs-voice-send','1'); } catch(e){}
window.__v = { mode:'ok', recorders:[], streams:[], hangRes:null, toasts:[] };
// #1308 夹具更正：旧桩把 ondataavailable 的 data 给成 {size:2048,type:'audio/test'} 这个「形状像数据」
// 的假对象，进 new Blob() 会被转成字符串 "[object Object]"（15 字节、根本不是音频）。旧结账只看 size>0
// 所以照过；现在结账前多问内核一句「这段字节你解得开吗」，这种假字节当场被判打不开＝R4/R5 变红。
// 本脚本验的是停止链路时序，不是载荷真伪，所以把桩喂的换成一段真的、内核解得开的 200ms 静音 WAV。
window.__v.good = function(){ var sr=8000,n=Math.round(sr*0.2),buf=new ArrayBuffer(44+n*2),v=new DataView(buf);
  function ws(o,s){for(var i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));}
  ws(0,'RIFF');v.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);
  v.setUint16(32,2,true);v.setUint16(34,16,true);ws(36,'data');v.setUint32(40,n*2,true);
  return new Blob([new Uint8Array(buf)],{type:'audio/wav'}); };
window.__v._lt=''; setInterval(function(){ var t=document.getElementById('cc-toast'); var x=t?(t.textContent||''):''; if(x&&x!==window.__v._lt){ window.__v._lt=x; window.__v.toasts.push(x); } },50);
navigator.mediaDevices.getUserMedia = function(){
  if (window.__v.mode === 'hang') {
    return new Promise(function(res){ window.__v.hangRes = function(){ var track={kind:'audio',stopped:false,stop:function(){this.stopped=true;}}; var s={_track:track,getTracks:function(){return [track];},getAudioTracks:function(){return [track];}}; window.__v.streams.push(s); res(s); }; });
  }
  return new Promise(function(resolve){
    setTimeout(function(){
      var track={kind:'audio',stopped:false,stop:function(){this.stopped=true;}};
      var s={_track:track,getTracks:function(){return [track];},getAudioTracks:function(){return [track];}};
      window.__v.streams.push(s); resolve(s);
    }, 30);
  });
};
function Rec(stream, opts){ this.stream=stream; this.opts=(opts===undefined)?null:opts; this.state='inactive'; this.ondataavailable=null; this.onstop=null; this.onerror=null; window.__v.recorders.push(this); }
Rec.prototype.start = function(){ this.state='recording'; };
Rec.prototype.stop = function(){
  if (this.state!=='recording') return;
  this.state='inactive';
  var self=this, mode=window.__v.mode;
  if (mode==='no-stop') return; // 模拟慢壳 onstop 永不来
  var delay = (mode==='late-stop') ? 1200 : 20;
  setTimeout(function(){
    if (mode!=='empty' && self.ondataavailable) self.ondataavailable({ data: window.__v.good() });
    if (self.onstop) self.onstop();
  }, delay);
};
window.MediaRecorder = Rec;
Rec.isTypeSupported = function(){ return true; };
})();`;

await connect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }

// 进入聊天页并打开录音面板（真实按钮链路：mic 按钮 → voice-panel）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return 1;})()");
await sleep(300);
const micShown = await evalJs("(function(){var b=document.getElementById('chat-mic-btn');return b&&b.style.display!=='none'?'1':'0';})()");
check('R1 开关已启用 → 输入栏麦克风按钮可见（cs-voice-send 种子生效）', micShown === '1', 'display=' + micShown);
await evalJs("(function(){var b=document.getElementById('chat-mic-btn');if(b)b.click();return 1;})()");
await sleep(400);
const panelOpen = await evalJs("(function(){var p=document.getElementById('voice-panel');return p&&!p.hidden?'1':'0';})()");
check('R2 点麦克风弹出录音半框（初始态：开始录音/发送键灰）', panelOpen === '1' && (await evalJs("(function(){return document.getElementById('voice-record-btn').textContent;})()")) === '开始录音' && (await evalJs("(function(){return document.getElementById('voice-send-btn').disabled;})()")) === true);

// ---- 场景 A：正常 录音→停止→试听→发送（基线不回归；录满 1s 避开既有「太短(<800ms)丢弃」保护） ----
await evalJs("(function(){window.__v.mode='ok';document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(1100);
const recUi = await evalJs("(function(){return JSON.stringify({st:document.getElementById('voice-status').textContent,rb:document.getElementById('voice-record-btn').textContent});})()");
check('R3 录音态：正在录音… + 停止录音', recUi.includes('正在录音') && recUi.includes('停止录音'), recUi);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(500);
const doneUi = await evalJs("(function(){return JSON.stringify({st:document.getElementById('voice-status').textContent,pv:!document.getElementById('voice-preview').hidden,sb:!document.getElementById('voice-send-btn').disabled});})()");
check('R4 停止后进入试听态（录制完成+发送键可用）——onstop 正常路径不回归', doneUi.includes('录制完成') && doneUi.includes('"pv":true') && doneUi.includes('"sb":true'), doneUi);
await evalJs("(function(){document.getElementById('voice-send-btn').click();return 1;})()");
await sleep(800);
const sentVoice = await evalJs("(function(){var n=document.querySelectorAll('#chat-body .msg-voice').length;var p=document.getElementById('voice-panel');return JSON.stringify({n:n,panelHidden:!p||p.hidden});})()");
check('R5 发送到聊天 → 语音气泡入列+面板关闭', sentVoice.includes('"n":1') && sentVoice.includes('"panelHidden":true'), sentVoice);
await evalJs("(function(){var b=document.getElementById('chat-mic-btn');if(b)b.click();return 1;})()");
await sleep(300);

// ---- 场景 B：onstop 永不来（雨见慢壳形态）→ 3s 看门狗结账 → 空数据可见失败，不再卡「正在录音…」 ----
await evalJs("(function(){window.__v.mode='no-stop';document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(400);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(500);
const stuckProbe = await evalJs("(function(){return JSON.stringify({st:document.getElementById('voice-status').textContent,rb:document.getElementById('voice-record-btn').textContent});})()");
check('R6 onstop 丢失后 0.5s：旧版此处会永久卡「正在录音…」（观察点，看门狗未到期）', stuckProbe.includes('正在录音') || stuckProbe.includes('没录到'), stuckProbe);
await sleep(3200);
const watchdogUi = await evalJs("(function(){return JSON.stringify({st:document.getElementById('voice-status').textContent,rb:document.getElementById('voice-record-btn').textContent,sb:document.getElementById('voice-send-btn').disabled});})()");
check('R7 看门狗 3s 结账：可见失败态「没录到声音数据」+ 按钮复位开始录音 + 发送键保持灰', watchdogUi.includes('没录到声音数据') && watchdogUi.includes('开始录音') && watchdogUi.includes('"sb":true'), watchdogUi);

// ---- 场景 C：空数据后换浏览器默认容器（mime 兜底）→ 录成功后兜底标记清除 ----
await evalJs("(function(){window.__v.mode='ok';document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(400);
const fallbackRec = await evalJs("(function(){var r=window.__v.recorders[window.__v.recorders.length-1];return JSON.stringify({defaultMime:r.opts===null});})()");
check('R8 兜底生效：新录音机不带 mimeType（浏览器自选默认容器）', fallbackRec.includes('"defaultMime":true'), fallbackRec);
await sleep(800);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(500);
const fallbackDone = await evalJs("(function(){return JSON.stringify({st:document.getElementById('voice-status').textContent,pv:!document.getElementById('voice-preview').hidden});})()");
check('R9 默认容器路径录到数据 → 正常进试听态（兜底不误伤好壳）', fallbackDone.includes('录制完成') && fallbackDone.includes('"pv":true'), fallbackDone);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(300);

// ---- 场景 D：onstop 迟到 1.2s + 结账期间连点 → 不偷新录音机句柄、不二次结账 ----
await evalJs("(function(){window.__v.mode='late-stop';document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(900);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()"); // 停止（onstop 1.2s 后才回）
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()"); // 结账窗口内连点=旧版会启动新录音机被旧结账偷走
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()"); // 再连点一次
await sleep(400);
const raceCnt = await evalJs("(function(){return window.__v.recorders.length;})()");
check('R10 结账窗口内连点不创建新录音机（voiceStopping 防偷句柄；至本步累计 4 台）', raceCnt === 4, 'recorders=' + raceCnt);
await sleep(1300);
const lateDone = await evalJs("(function(){return JSON.stringify({st:document.getElementById('voice-status').textContent,pv:!document.getElementById('voice-preview').hidden});})()");
check('R11 onstop 迟到到达后正常结账进试听态', lateDone.includes('录制完成') && lateDone.includes('"pv":true'), lateDone);
await sleep(2200);
const latchUi = await evalJs("(function(){return JSON.stringify({st:document.getElementById('voice-status').textContent,pv:!document.getElementById('voice-preview').hidden});})()");
check('R12 看门狗到期不二次结账（幂等闩：试听态不被空数据失败态覆盖）', latchUi.includes('录制完成') && latchUi.includes('"pv":true'), latchUi);
await evalJs("(function(){window.__v.mode='ok';document.getElementById('voice-close').click();return 1;})()"); // 清场：复位模式+试听态直接关面板（不再起录）
await sleep(400);
await evalJs("(function(){var b=document.getElementById('chat-mic-btn');if(b)b.click();return 1;})()");
await sleep(300);

// ---- 场景 E：录音中途关面板 → 静默丢弃不误报失败 ----
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(500);
await evalJs("(function(){document.getElementById('voice-close').click();return 1;})()");
await sleep(600);
const closedOk = await evalJs("(function(){var t=document.getElementById('cc-toast');return JSON.stringify({panelHidden:document.getElementById('voice-panel').hidden,failToast:t&&/没录到/.test(t.textContent||'')});})()");
check('R13 录音中途关面板：静默丢弃（面板关+不弹「没录到声音数据」失败提示）', closedOk.includes('"panelHidden":true') && closedOk.includes('"failToast":false'), closedOk);
await evalJs("(function(){var b=document.getElementById('chat-mic-btn');if(b)b.click();return 1;})()");
await sleep(300);

// ---- 场景 F：getUserMedia 永久挂起 → 15s 看门狗报错复位（闸门不再永久锁死）+ 迟到流停轨 ----
await evalJs("(function(){window.__v.mode='hang';document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(16500);
const hangToast = await evalJs("(function(){return JSON.stringify({hist:window.__v.toasts});})()");
check('R14 麦克风挂起 15s 后报「麦克风无响应」并复位（旧版 voiceStarting 永久锁死=之后点不动）', hangToast.includes('麦克风无响应'), hangToast);
await evalJs("(function(){if(window.__v.hangRes)window.__v.hangRes();return 1;})()");
await sleep(300);
const leak = await evalJs("(function(){var s=window.__v.streams[window.__v.streams.length-1];return s?String(s._track.stopped):'none';})()");
check('R15 迟到的麦克风流被停轨（防常驻占用麦克风）', leak === 'true', 'stopped=' + leak);
await evalJs("(function(){window.__v.mode='ok';document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(500);
const gateReleased = await evalJs("(function(){return JSON.stringify({recording:document.getElementById('voice-status').textContent,cnt:window.__v.recorders.length});})()");
check('R16 闸门已释放：挂起超时后再次点「开始录音」能正常开录（旧版永久忽略）', gateReleased.includes('正在录音') && gateReleased.includes('"cnt":6'), gateReleased);

// ---- 全程零未捕获异常 ----
const errs = await evalJs("(function(){var a=Array.isArray(window.__jsErrors)?window.__jsErrors:[];return JSON.stringify(a.map(function(e){return String(e.message||e).slice(0,80);}));})()");
let bad = []; try { bad = JSON.parse(errs).filter((m) => /voice|ReferenceError|TypeError|SyntaxError/i.test(m)); } catch (e) { bad = ['PARSE ' + errs]; }
check('R17 全程零语音链路未捕获异常', bad.length === 0, JSON.stringify(bad));

chrome.kill();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);

// ===== v3.26.x 验证脚本：#507 语音播放按钮 touch 直驱（「点我发出去的语音听不了/点了只弹菜单」多机型同报） =====
// 用法：SERVE_DIR=<产物目录> node tools/verify-voice-touch-play.mjs   （默认 SERVE_DIR=仓库根，需先 node build.mjs）
// 根因：#480 气泡轻点直驱把播放按钮的轻点也当「点气泡」——body touchend 先开消息菜单+布 800ms 吞 click
//       窗口，吞 click 族内核（Via/夸克/部分壳与内核版本）补发的 click 根本不来＝点播放永远播不出；
//       健康内核也是菜单/播放双触发。修复=①msgActionEligible/gcActionEligible 把 .msg-voice-play 排除出
//       「点气泡」判定；②按钮 touchend 直驱播放 + vTapGuard/gvTapGuard 守卫吞补发 click 防双跑。
// 断言：S* 静态锚（src 直查，单聊+群聊）；R* 运行时（无头 Chrome 走真实产物，真实 webm/opus 分片 +
//       TouchEvent 触摸序列，不依赖内核合成 click＝精确模拟吞 click 族内核）：
//   R1 真实触摸轻点播放按钮 → 语音真实播出（ended）且消息菜单不弹（修复前：菜单弹+零 audio＝报障原文）
//   R2 合成 click（鼠标/健康内核路径）→ 仍正常播出（不回归）
//   R3 令牌路径触摸点播 → mochiMediaExpandAsync 取池后播出（#283 链路与直驱共存）
//   R4 长按气泡非按钮区（波纹/名称区）→ 消息菜单仍弹出（#480 菜单语义不丢）
//   R5 全程零未捕获异常（首稿曾因跨分段引用 msgAnyTap 抛 ReferenceError，此断言防复发）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const serveDir = normalize(process.env.SERVE_DIR || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push(!!ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && detail !== '' ? '  [' + String(detail).slice(0, 260) + ']' : ''));
}

// ---- S 组：静态锚（对 src 断言，单聊+群聊两刀都在才算修复在位） ----
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const gcSrc = readFileSync(join(root, 'src/js/group-chat.js'), 'utf8');
check('S1 单聊播放按钮 touch 直驱 + vTapGuard 守卫吞补发 click', /btn\.addEventListener\('touchend', function \(e\) \{[\s\S]{0,200}vTapGuard = Date\.now\(\) \+ 800;[\s\S]{0,80}vPlayAction\(\);/.test(chatSrc));
check('S2 单聊点气泡判定排除播放按钮（touchstart 不布点/不开菜单/不吞 click）', /function msgActionEligible\(t\) \{[\s\S]{0,900}if \(t\.closest\('\.msg-voice-play'\)\) return null;/.test(chatSrc));
check('S3 群聊播放按钮 touch 直驱 + gvTapGuard 守卫', /gvBtn\.addEventListener\('touchend', function \(e\) \{[\s\S]{0,300}gvTapGuard = Date\.now\(\) \+ 800;[\s\S]{0,120}gvPlayAction\(\);/.test(gcSrc));
check('S4 群聊点气泡判定排除播放按钮', /function gcActionEligible\(t\) \{[\s\S]{0,420}if \(t\.closest\('\.msg-voice-play'\)\) return null;/.test(gcSrc));
check('S5 直驱不引用跨分段状态（首稿 ReferenceError 回归即红）', !/if \(msgAnyTap && Date\.now\(\) - msgAnyTap\.t > 450\) return; \/\/ #50\d/.test(chatSrc) && !/endGcHold\(\);[\s\S]{0,40}gcTapStart = null;[\s\S]{0,40}gvTapGuard/.test(gcSrc));

// ---- R 组：运行时 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const cdpPort = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vtp-' + Date.now()),
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
    await sleep(250);
  }
  throw new Error('CDP 连接失败');
}
async function cdp(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pend.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'EVAL-ERR ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 300);
  return r && r.result ? r.result.value : null;
}

await connect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 用户现场 UA：iQOO/Edge Android（标准 Chromium 判定 → webm/opus 录音路径）
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36 EdgA/150.0.0.0' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 822, deviceScaleFactor: 3, mobile: true });

// 应用脚本之前注入：开语音开关 + 麦克风/录音桩（回放真实分片）+ 未捕获异常采集
const INIT = `(function(){
try { localStorage.setItem('xy-home-v2:cs-voice-send','1'); localStorage.setItem('xy-home-v2:default:cs-voice-send','1'); } catch(e){}
window.__v = { errs: [], realChunks: [] };
window.addEventListener('error', function (e) { window.__v.errs.push(String(e.message || e)); });
navigator.mediaDevices.getUserMedia = function(){
  return new Promise(function(resolve){
    setTimeout(function(){
      var track={kind:'audio',stopped:false,stop:function(){this.stopped=true;}};
      var s={_track:track,getTracks:function(){return [track];},getAudioTracks:function(){return [track];}};
      resolve(s);
    }, 30);
  });
};
})();`;
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40 && (await evalJs('!!window.__mochiDataReady')) !== true; i++) await sleep(300);

// 页内先真实录一段 webm/opus（与手机 MediaRecorder 同链路），分片交给录音桩
const rec0 = await evalJs(`(async function(){
  const ac = new AudioContext();
  const osc = ac.createOscillator(); const dst = ac.createMediaStreamDestination();
  osc.connect(dst); osc.start();
  const rec = new MediaRecorder(dst.stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];
  rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start(); await new Promise(r => setTimeout(r, 1100)); rec.stop(); await stopped;
  osc.stop(); try { await ac.close(); } catch(e){}
  window.__v.realChunks = chunks;
  return chunks.length;
})()`);
check('P0 页内真实录音 webm/opus 分片就绪', rec0 > 0, rec0);

// 录音桩：stop 时回放真实分片
await evalJs(`(function(){
  function Rec(stream, opts){ this.stream=stream; this.opts=(opts===undefined)?null:opts; this.state='inactive'; this.ondataavailable=null; this.onstop=null; this.onerror=null; }
  Rec.prototype.start = function(){ this.state='recording'; };
  Rec.prototype.stop = function(){
    if (this.state!=='recording') return; this.state='inactive';
    var self=this;
    setTimeout(function(){
      window.__v.realChunks.forEach(function(c){ if (self.ondataavailable) self.ondataavailable({ data:c }); });
      if (self.onstop) self.onstop();
    }, 30);
  };
  window.MediaRecorder = Rec; Rec.isTypeSupported = MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported.bind(MediaRecorder) : function(){ return true; };
  return 1;
})()`);

// 录发一条语音（真实面板按钮链路）
async function recordAndSend(holdMs) {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return 1;})()");
  await sleep(700);
  await evalJs("(function(){var b=document.getElementById('chat-mic-btn');if(b)b.click();return 1;})()");
  await sleep(300);
  await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
  await sleep(1100);
  await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
  await sleep(500);
  await evalJs("(function(){document.getElementById('voice-send-btn').click();return 1;})()");
  await sleep(600);
  return evalJs("(function(){return document.querySelectorAll('#chat-body .msg-voice-play').length;})()");
}
const bubbleN = await recordAndSend();
check('P1 录发一条语音入列', bubbleN > 0, bubbleN);

// 触摸序列点播断言：真实 TouchEvent（不派发 click＝精确模拟吞 click 族内核）
const TOUCH_PLAY = `(function(){
  return new Promise(function(res){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#chat-body .msg-voice-play'));
    if (!btns.length) { res(JSON.stringify({ err: 'no-play-btn' })); return; }
    var btn = btns[btns.length - 1];
    var r = btn.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var beforeAudio = document.querySelectorAll('audio').length;
    var ma0 = document.getElementById('msg-actions');
    var menuBefore = ma0 ? !ma0.hidden : false;
    var t1 = new Touch({ identifier: 7, target: btn, clientX: x, clientY: y });
    btn.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t1], targetTouches: [t1], changedTouches: [t1] }));
    setTimeout(function(){
      var t2 = new Touch({ identifier: 7, target: btn, clientX: x, clientY: y });
      btn.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t2] }));
      setTimeout(function(){
        var ma = document.getElementById('msg-actions');
        var out = { menuOpen: ma ? !ma.hidden : null, menuBefore: menuBefore, audioDelta: 0, played: false, how: '', srcHead: '' };
        var auds = Array.prototype.slice.call(document.querySelectorAll('audio')).slice(beforeAudio);
        out.audioDelta = auds.length;
        if (!auds.length) { res(JSON.stringify(out)); return; }
        var a = auds[0];
        out.srcHead = (a.getAttribute('src') || '').slice(0, 30);
        var done = function(k){ out.played = (k === 'ended'); out.how = k; try{a.pause();}catch(e){} res(JSON.stringify(out)); };
        a.addEventListener('ended', function(){ done('ended'); });
        a.addEventListener('error', function(){ done('error'); });
        setTimeout(function(){ done('timeout'); }, 4000);
      }, 250);
    }, 120);
  });
})()`;

const r1 = await evalJs(TOUCH_PLAY);
check('R1 真实触摸轻点播放按钮 → 真实播出（ended）且菜单不弹', r1 && !String(r1).startsWith('EVAL-ERR') && JSON.parse(r1).played === true && JSON.parse(r1).menuOpen === false, r1);

// 等令牌化落池后重发一条，验证令牌路径与直驱共存（强制 pass 有权威守卫可能让位，轮询自然 pass 12~18s）
let tokenState = 0;
for (let i = 0; i < 16 && tokenState !== 1; i++) {
  await evalJs("(async function(){ if (window.chatMediaNormalizeNow) { try { await window.chatMediaNormalizeNow(); } catch(e){} } if (window.mochiMediaFlush) { try { await window.mochiMediaFlush(); } catch(e){} } return 1; })()");
  await sleep(2500);
  tokenState = await evalJs("(async function(){var k=window.activePrefix()+':chat-msgs';var arr=await window.idbGet(k);if(typeof arr==='string'){try{arr=JSON.parse(arr);}catch(e){}}var vm=(arr||[]).filter(function(m){return m&&m.type==='voice';}).pop();return vm&&vm.text&&vm.text.indexOf('@@m:')>=0?1:0;})()");
}
check('P2 语音已令牌化入池', tokenState === 1, tokenState);

const r2 = await evalJs(TOUCH_PLAY);
check('R3 令牌路径触摸点播 → 取池播出', r2 && !String(r2).startsWith('EVAL-ERR') && JSON.parse(r2).played === true, r2);

// 合成 click（健康内核/鼠标路径）仍播出
const CLICK_PLAY = `(function(){
  return new Promise(function(res){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#chat-body .msg-voice-play'));
    if (!btns.length) { res(JSON.stringify({ err: 'no-play-btn' })); return; }
    var btn = btns[btns.length - 1];
    var beforeAudio = document.querySelectorAll('audio').length;
    btn.click();
    setTimeout(function(){
      var auds = Array.prototype.slice.call(document.querySelectorAll('audio')).slice(beforeAudio);
      var out = { audioDelta: auds.length, played: false };
      if (!auds.length) { res(JSON.stringify(out)); return; }
      var a = auds[0];
      var done = function(k){ out.played = (k === 'ended'); try{a.pause();}catch(e){} res(JSON.stringify(out)); };
      a.addEventListener('ended', function(){ done('ended'); });
      a.addEventListener('error', function(){ done('error'); });
      setTimeout(function(){ done('timeout'); }, 4000);
    }, 250);
  });
})()`;
const r3 = await evalJs(CLICK_PLAY);
check('R2 合成 click 点播（健康内核/鼠标路径）→ 仍正常播出', r3 && !String(r3).startsWith('EVAL-ERR') && JSON.parse(r3).played === true, r3);

// 长按气泡非按钮区（波纹/名称区）→ 菜单仍弹出（#480 菜单语义不丢）
const LONGPRESS_BUBBLE = `(function(){
  return new Promise(function(res){
    var bubbles = document.querySelectorAll('#chat-body .msg-voice .msg-voice-wave');
    if (!bubbles.length) { res(JSON.stringify({ err: 'no-wave' })); return; }
    var area = bubbles[bubbles.length - 1];
    var r = area.getBoundingClientRect();
    var x = r.left + Math.min(20, r.width / 2), y = r.top + r.height / 2;
    var t1 = new Touch({ identifier: 8, target: area, clientX: x, clientY: y });
    area.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t1], targetTouches: [t1], changedTouches: [t1] }));
    setTimeout(function(){
      var t2 = new Touch({ identifier: 8, target: area, clientX: x, clientY: y });
      area.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t2] }));
      setTimeout(function(){
        var ma = document.getElementById('msg-actions');
        res(JSON.stringify({ menuOpen: ma ? !ma.hidden : null }));
      }, 350);
    }, 650);
  });
})()`;
const r4 = await evalJs(LONGPRESS_BUBBLE);
check('R4 长按气泡非按钮区 → 消息菜单仍弹出（菜单语义保留）', r4 && !String(r4).startsWith('EVAL-ERR') && JSON.parse(r4).menuOpen === true, r4);

const r5 = await evalJs('JSON.stringify(window.__v.errs)');
check('R5 全程零未捕获异常（跨分段引用回归即红）', r5 === '[]', r5);

console.log('-----');
console.log('结果：' + results.filter(Boolean).length + '/' + results.length + ' 通过');
process.exit(results.every(Boolean) ? 0 : 2);

// ===== 专项脚本：聊天设置「我可发送语音」+ 输入栏麦克风录音发送（v3.16.x） =====
// 用法：
//   正式产物验证：node build.mjs && node tools/verify-voice-record.mjs
//   临时构建验证（不落仓库产物）：把仓库拷到临时目录构建后
//     node tools/verify-voice-record.mjs --root <临时目录>
// 验证内容：
//   A 组静态：template 麦克风按钮/录音半框/设置开关行、chat-settings 开关键与事件、
//     chat.js 显隐同步 + 录音 + 「名称|||dataURL」type=voice 发送、mobile-adapt 两列表登记、CSS。
//   B 组运行时（无头 Chrome --use-fake-device/ui-for-media-stream 假麦克风）：
//     默认隐藏 → 设置开启后显示 → 点开半框状态 → 真录一段 → 试听态 → 发送成语音气泡 →
//     刷新持久化 → 关闭开关按钮再隐藏 → 全程零 JS 异常。

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const root = argRoot || process.cwd();
const srcRoot = argRoot ? join(process.cwd(), 'src') : join(root, 'src');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 220) + ']' : '')); }

// ---------------- A 组：静态断言 ----------------
const tpl = readFileSync(join(srcRoot, 'template.html'), 'utf8');
const chatSrc = readFileSync(join(srcRoot, 'js', 'chat.js'), 'utf8');
const csSrc = readFileSync(join(srcRoot, 'js', 'chat-settings.js'), 'utf8');
const maSrc = readFileSync(join(srcRoot, 'js', 'mobile-adapt.js'), 'utf8');
const cmCss = readFileSync(join(srcRoot, 'css', 'chat-main.css'), 'utf8');

check('A1 输入栏左端有「麦克风」按钮 #chat-mic-btn（默认 display:none）', /id="chat-mic-btn"[^>]*style="display:none"/.test(tpl));
check('A2 麦克风按钮位于输入行最左（在 chat-continue-btn 之前）', tpl.indexOf('id="chat-mic-btn"') >= 0 && tpl.indexOf('id="chat-mic-btn"') < tpl.indexOf('id="chat-continue-btn"'));
check('A3 录音半框 #voice-panel 存在且含 录制/试听/发送 三控件', /id="voice-panel"/.test(tpl) && /id="voice-record-btn"/.test(tpl) && /id="voice-play-btn"/.test(tpl) && /id="voice-send-btn"/.test(tpl));
check('A4 聊天设置页有「我可发送语音」开关行 cs-voice-send', /id="cs-voice-send-row"/.test(tpl) && /id="cs-voice-send"/.test(tpl));
check('A5 chat-settings.js 开关写 cs-voice-send 并广播 voice-send-changed', csSrc.includes("store.get('cs-voice-send')") && csSrc.includes("'voice-send-changed'"));
check('A6 chat.js syncMicBtn 读同一键控制显隐', chatSrc.includes("store.get('cs-voice-send')") && chatSrc.includes('function syncMicBtn'));
check('A7 chat.js 发送走既有语音格式（type:\'voice\' + 名称|||dataURL）', /addRec\(\{ side: 'out', text: name \+ '\|\|\|' \+ voiceDataUrl, type: 'voice' \}\)/.test(chatSrc));
check('A8 mobile-adapt 两浮层列表均已登记 #voice-panel', maSrc.includes("'#voice-panel'") && (maSrc.match(/'#voice-panel'/g) || []).length >= 2);
check('A9 chat-main.css 有 .voice-* 样式段 + 深色兜底 + reduced-motion', cmCss.includes('.voice-card') && cmCss.includes('[data-theme="dark"] .voice-preview') && cmCss.includes('prefers-reduced-motion'));
check('A10 录音过短保护（<800ms 丢弃 + toast）', chatSrc.includes("Date.now() - voiceStartTs < 800") && chatSrc.includes("录音太短"));
check('A11 到 60 秒自动停止提示', chatSrc.includes("已达最长 60 秒"));
check('A12 录音中途切后台停止（visibilitychange 监听 + 清理）', chatSrc.includes('voiceVisHandler') && chatSrc.includes("addEventListener('visibilitychange', voiceVisHandler)") && chatSrc.includes("removeEventListener('visibilitychange', voiceVisHandler)"));
check('A13 麦克风约束优先关回声消除（vivo/iQOO 安静音修复）且带 {audio:true} 兜底 + recorder.onerror 复位', /echoCancellation:\s*false/.test(chatSrc) && /\{ audio: true \}/.test(chatSrc) && chatSrc.includes('acquireVoiceStream') && chatSrc.includes('rec.onerror') && chatSrc.includes('renderVoiceIdle'));
check('A14 录音 MIME 优先 mp4/aac（本机能录又能播）', /const list = \['audio\/mp4', 'audio\/aac', 'audio\/webm;codecs=opus'/.test(chatSrc));
check('A15 试听把 Audio 挂到 DOM 再播 + 出错清理（防止雨见等静默空放）', chatSrc.includes('document.body.appendChild(a)') && /a\.addEventListener\('error'/.test(chatSrc) && chatSrc.includes('语音播放失败'));

if (!results.every(r => r.ok)) { console.log('\n静态断言未全绿，停止运行时验证'); process.exit(1); }

// ---------------- 运行时准备 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const { spawn } = await import('node:child_process');
const { createServer } = await import('node:http');
const { rmSync } = await import('node:fs');
const { normalize, extname } = await import('node:path');

const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const tmpProfile = join(process.env.TEMP || '/tmp', 'mochi-voicerec-' + Date.now());
// --use-fake-device-for-media-stream：内置假麦克风（正弦音）；--use-fake-ui-for-media-stream：自动授予权限
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + tmpProfile,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {} });

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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function openApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  // 过开屏 + 进聊天页（与 verify-brick.mjs 同款可靠方式：splash-confirm-ok 在 hidden 的
  // splash-confirm 内，直接 .click() 命中不到，需先显式关 splash 再切页）
  await evalJs("(function(){var b=document.querySelector('.splash-confirm-btn')||document.getElementById('splash-confirm-ok');if(b)b.click();var s=document.getElementById('splash');if(s)s.hidden=true;return 1;})()");
  await sleep(400);
  // 必须走 enterChat() 触发 loadMsgs + renderWindow，仅切 page-chat 的 hidden 不渲染消息
  await evalJs("(function(){try{window.enterChat();}catch(e){}return 1;})()");
  await sleep(900);
}

await openApp();

// ---- B1 默认隐藏 ----
let b1 = await evalJs("(function(){var b=document.getElementById('chat-mic-btn');return b?getComputedStyle(b).display:'missing';})()");
check('B1 默认关闭时「麦克风」按钮不显示', b1 === 'none', b1);

// ---- B2 设置开启 → 即时显示 ----
await evalJs("(function(){window.activeStore().set('cs-voice-send','1');document.dispatchEvent(new Event('voice-send-changed'));return 1;})()");
await sleep(300);
let b2 = await evalJs("(function(){var b=document.getElementById('chat-mic-btn');return b?getComputedStyle(b).display:'missing';})()");
check('B2 开启后「麦克风」按钮即时显示', b2 !== 'none' && b2 !== 'missing', b2);

// ---- B3 点开半框：初始态 ----
await evalJs("(function(){document.getElementById('chat-mic-btn').click();return 1;})()");
await sleep(400);
let b3 = JSON.parse(await evalJs("(function(){var p=document.getElementById('voice-panel');if(!p)return '{}';var sb=document.getElementById('voice-send-btn');return JSON.stringify({open:!p.hidden,rec:document.getElementById('voice-record-btn').textContent,sendDis:sb.disabled,time:document.getElementById('voice-time').textContent});})()") || '{}');
check('B3 半框打开且为初始态（开始录音/发送禁用/00:00）', b3.open === true && b3.rec === '开始录音' && b3.sendDis === true && b3.time === '00:00', JSON.stringify(b3));

// ---- B4 真录一段（假麦克风）→ 停止 → 试听态 ----
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(1800);
let recState = JSON.parse(await evalJs("(function(){var p=document.getElementById('voice-panel');var tm=document.getElementById('voice-time');return JSON.stringify({rec:p.className.indexOf('recording')>=0,time:tm.textContent,btn:document.getElementById('voice-record-btn').textContent});})()") || '{}');
check('B4 录音中：面板进入 recording 态、计时走表、按钮变停止', recState.rec === true && /^00:0[12]$/.test(recState.time) && recState.btn === '停止录音', JSON.stringify(recState));
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
let done = {};
for (let t = 0; t < 16; t++) {
  await sleep(400);
  done = JSON.parse(await evalJs("(function(){var pv=document.getElementById('voice-preview');var sb=document.getElementById('voice-send-btn');return JSON.stringify({shown:pv&&!pv.hidden,txt:(document.getElementById('voice-preview-txt')||{}).textContent||'',sendEn:sb&&!sb.disabled,btn:document.getElementById('voice-record-btn').textContent});})()") || '{}');
  if (done.shown && done.sendEn) break;
}
check('B5 停止后出试听行（时长≥1″）、发送可用、按钮变重新录音', done.shown && done.sendEn && /^[^0]*[1-9]/.test(String(done.txt)) && done.btn === '重新录音', JSON.stringify(done));

// ---- B6 关闭重开 → 状态复位（旧录音丢弃，不会误发） ----
await evalJs("(function(){document.getElementById('voice-close').click();return 1;})()");
await sleep(250);
await evalJs("(function(){document.getElementById('chat-mic-btn').click();return 1;})()");
await sleep(350);
let b6 = JSON.parse(await evalJs("(function(){var p=document.getElementById('voice-panel');return JSON.stringify({open:!p.hidden,sendDis:document.getElementById('voice-send-btn').disabled,rec:document.getElementById('voice-record-btn').textContent,pvHidden:document.getElementById('voice-preview').hidden});})()") || '{}');
check('B6 重开后状态复位（发送禁用/开始录音/试听行收起）', b6.open && b6.sendDis && b6.rec === '开始录音' && b6.pvHidden, JSON.stringify(b6));

// ---- B7 再录一段并发送 → 聊天出现语音气泡（out 侧 .msg-voice，data-src 为 data:audio） ----
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(1500);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
for (let t = 0; t < 16; t++) { await sleep(400); if (await evalJs("!document.getElementById('voice-send-btn').disabled")) break; }
await evalJs("(function(){document.getElementById('voice-send-btn').click();return 1;})()");
let sent = {};
for (let t = 0; t < 10; t++) {
  await sleep(400);
  sent = JSON.parse(await evalJs("(function(){var outs=[].slice.call(document.querySelectorAll('#chat-body .msg-out'));for(var i=outs.length-1;i>=0;i--){var v=outs[i].querySelector('.msg-voice');if(!v)continue;var src=v.getAttribute('data-src')||'';var nm=(v.querySelector('.msg-voice-name')||{}).textContent||'';return JSON.stringify({found:true,audio:src.indexOf('data:audio')===0,name:nm,panelClosed:document.getElementById('voice-panel').hidden});}return '{}';})()") || '{}');
  if (sent.found) break;
}
check('B7 发送后聊天出现我的语音气泡（data:audio + 时长名）', sent.found === true && sent.audio === true && /^语音 \d+″$/.test(String(sent.name)), JSON.stringify(sent));
check('B8 发送后半框自动关闭', sent.panelClosed === true);

// ---- B9 刷新持久化：语音消息仍在（IDB 回填后渲染气泡可播） ----
// saveMsgs 有 400ms 防抖，重载前先 flushSave 强制落盘，否则导航卸载页面时定时器未执行→丢消息
await evalJs("(function(){try{window.chatFlushSave&&window.chatFlushSave();}catch(e){}return 1;})()");
await sleep(700);
await openApp();
let persist = {};
for (let t = 0; t < 12; t++) {
  await sleep(600);
  persist = JSON.parse(await evalJs("(function(){var outs=[].slice.call(document.querySelectorAll('#chat-body .msg-out'));for(var i=outs.length-1;i>=0;i--){var v=outs[i].querySelector('.msg-voice');if(!v)continue;var play=v.querySelector('.msg-voice-play');return JSON.stringify({found:true,srcOk:(v.getAttribute('data-src')||'').indexOf('data:audio')===0,hasPlayBtn:!!play});}return '{}';})()") || '{}');
  if (persist.found) break;
}
check('B9 重进聊天语音气泡仍在且带播放钮', persist.found === true && persist.srcOk === true && persist.hasPlayBtn === true, JSON.stringify(persist));

// ---- B9b 视觉回归哨兵（#1487 重基线）：out 气泡上的播放钮／波形必须吃「气泡自己的字色」 ----
// 旧断言写死「三处都得是 255,255,255」＝把「out 侧钉白」当成契约，而那枚钉白正是 #1487 的病灶：
// 用户把「我的消息底色」改成浅色时正文被 #536 自愈翻深、钮却仍是白的＝整块隐形（作者报障原文）。
// 新口径两半都要成立：① 钮与波形＝气泡字色（默认深色气泡上仍是白，原「黑底不可见」不回退）；
// ② 那层浅底由 currentColor 现算（挂在 ::before 上），钮自身不铺色。
const b9b = JSON.parse(await evalJs("(function(){var v=document.querySelector('#chat-body .msg-out .msg-voice');if(!v)return '{}';var pb=v.querySelector('.msg-voice-play');var wi=v.querySelector('.msg-voice-wave i');var bub=v.closest('.msg-bubble');var cs=pb?getComputedStyle(pb):null;var cs2=wi?getComputedStyle(wi):null;var cf=pb?getComputedStyle(pb,'::before'):null;return JSON.stringify({bubColor:bub?getComputedStyle(bub).color:'',pbColor:cs?cs.color:'',pbBg:cs?cs.backgroundColor:'',fillBg:cf?cf.backgroundColor:'',fillOp:cf?cf.opacity:'',waveBg:cs2?cs2.backgroundColor:''});})()") || '{}');
check('B9b out 气泡播放钮/波形＝气泡字色（#1487：不再钉死白）', b9b.pbColor === b9b.bubColor && b9b.waveBg === b9b.bubColor, JSON.stringify(b9b));
check('B9b2 默认深色 out 气泡上仍是白色系（原「黑底不可见」不回退）', /255,\s*255,\s*255/.test(String(b9b.bubColor)), JSON.stringify(b9b));
check('B9b3 钮自身不铺色、浅底改由 currentColor 那层现算（拿回钉色＝这条先红）', String(b9b.pbBg).indexOf('rgba(0, 0, 0, 0') === 0 && b9b.fillBg === b9b.bubColor && parseFloat(b9b.fillOp) > 0 && parseFloat(b9b.fillOp) < 0.5, JSON.stringify(b9b));

// ---- B9c 视觉回归哨兵：试听行 hidden 属性必须真的 display:none（display:flex 压过 UA [hidden] 的坑） ----
await evalJs("(function(){window.activeStore().set('cs-voice-send','1');document.dispatchEvent(new Event('voice-send-changed'));document.getElementById('chat-mic-btn').click();return 1;})()");
await sleep(400);
const b9c = JSON.parse(await evalJs("(function(){var pv=document.getElementById('voice-preview');if(!pv)return '{}';return JSON.stringify({hiddenAttr:pv.hidden,display:getComputedStyle(pv).display});})()") || '{}');
check('B9c 初始态试听行实际不占位（display:none）', b9c.hiddenAttr === true && b9c.display === 'none', JSON.stringify(b9c));
await evalJs("(function(){document.getElementById('voice-close').click();window.activeStore().set('cs-voice-send','0');document.dispatchEvent(new Event('voice-send-changed'));return 1;})()");
await sleep(250);

// ---- B10 关闭开关 → 按钮再隐藏、开着的话半框一并收起 ----
await evalJs("(function(){window.activeStore().set('cs-voice-send','0');document.dispatchEvent(new Event('voice-send-changed'));return 1;})()");
await sleep(300);
let b10 = await evalJs("(function(){var b=document.getElementById('chat-mic-btn');var p=document.getElementById('voice-panel');return JSON.stringify({mic:getComputedStyle(b).display,panelHidden:p.hidden});})()");
check('B10 关闭后按钮隐藏、半框收起', /none/.test(String(b10)) && /true/.test(String(b10)), b10);

// ---- B12 录音过短保护（<800ms 丢弃，发送按钮仍禁用） ----
await evalJs("(function(){window.activeStore().set('cs-voice-send','1');document.dispatchEvent(new Event('voice-send-changed'));document.getElementById('chat-mic-btn').click();return 1;})()");
await sleep(400);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()"); // 开始
await sleep(150);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()"); // 立即停止（~150ms < 800ms）
await sleep(1200);
const b12 = JSON.parse(await evalJs("(function(){var sb=document.getElementById('voice-send-btn');var pv=document.getElementById('voice-preview');return JSON.stringify({sendDis:sb.disabled,pvHidden:pv.hidden,btn:document.getElementById('voice-record-btn').textContent});})()") || '{}');
check('B12 录音过短被丢弃（发送仍禁用/试听行不显示）', b12.sendDis === true && b12.pvHidden === true, JSON.stringify(b12));
await evalJs("(function(){document.getElementById('voice-close').click();return 1;})()");
await sleep(250);

// ---- B13 录音中途切后台停止（visibilitychange→hidden） ----
await evalJs("(function(){document.getElementById('chat-mic-btn').click();return 1;})()");
await sleep(400);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(800);
await evalJs("(function(){Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));return 1;})()");
await sleep(600);
const b13 = JSON.parse(await evalJs("(function(){var p=document.getElementById('voice-panel');var rb=document.getElementById('voice-record-btn');return JSON.stringify({recording:p.className.indexOf('recording')>=0,btn:rb.textContent});})()") || '{}');
check('B13 切后台后录音停止（退出 recording 态/按钮变重新录音）', b13.recording === false && b13.btn === '重新录音', JSON.stringify(b13));
await evalJs("(function(){document.getElementById('voice-close').click();window.activeStore().set('cs-voice-send','0');document.dispatchEvent(new Event('voice-send-changed'));return 1;})()");
await sleep(250);

// ---- B11 全程零 JS 异常 ----
const errs = await evalJs('window.__jsErrors ? window.__jsErrors.length : 0');
check('B11 运行时无 JS 异常', !errs, String(errs));

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
process.exit(pass === results.length ? 0 : 1);

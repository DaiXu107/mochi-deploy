// ===== 专项脚本：语音播放钮互动反馈（v3.26.x）+ 录制半框 UI 对齐重设计 =====
// 用户反馈：①录制面板试听钮 / 聊天语音气泡的播放矢量图点击无互动变化；
//          ②录制语音半框 UI 没对齐、按钮大小不一致。
// 修复：播放/暂停双 SVG + .playing 换暂停竖条 + :active 按压缩放；录制半框两按钮统一
//       44px 高/14px 圆角/14px 字号等宽对齐（send 不再复用 .poke-big，去掉多余 margin-top）。
// 用法：node build.mjs && node tools/verify-voice-play-icon.mjs
//   A 组静态断言（源码特征）→ B 组运行时（无头 Chrome + 假麦克风）。

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 220) + ']' : '')); }

// ---------------- A 组：静态断言 ----------------
const tpl = readFileSync(join(process.cwd(), 'src', 'template.html'), 'utf8');
const chatSrc = readFileSync(join(process.cwd(), 'src', 'js', 'chat.js'), 'utf8');
const gcSrc = readFileSync(join(process.cwd(), 'src', 'js', 'group-chat.js'), 'utf8');
const cmCss = readFileSync(join(process.cwd(), 'src', 'css', 'chat-main.css'), 'utf8');

check('A1 试听钮 #voice-play-btn 含播放+暂停双图标', (() => {
  const m = tpl.match(/<button[^>]*id="voice-play-btn"[\s\S]*?<\/button>/);
  return !!m && m[0].includes('voice-ico-play') && m[0].includes('voice-ico-pause');
})());
check('A2 聊天气泡渲染含播放+暂停双图标（chat.js fillVoiceBubble）', chatSrc.includes('class="voice-ico-play"') && chatSrc.includes('class="voice-ico-pause"'));
check('A3 群聊语音气泡渲染含播放+暂停双图标（group-chat.js）', gcSrc.includes('class="voice-ico-play"') && gcSrc.includes('class="voice-ico-pause"'));
check('A4 CSS：playing 时三角隐藏/暂停竖条显示', cmCss.includes('.msg-voice-play.playing .voice-ico-play { display:none; }') && cmCss.includes('.msg-voice-play.playing .voice-ico-pause { display:block; }'));
check('A5 CSS：点按压缩放反馈（:active scale）', /\.msg-voice-play:active \{ transform:scale\(\.85\); \}/.test(cmCss));
check('A6 发送钮不再复用 .poke-big（去掉 margin-top:12px 错位源）', tpl.includes('<button class="voice-send-big" id="voice-send-btn"') && !tpl.includes('poke-big voice-send-big'));
check('A7 CSS：两按钮统一规格（同高44px/圆角14/等宽 flex:1）', (() => {
  const m = cmCss.match(/\.voice-rec-btn, \.voice-send-big \{[\s\S]*?\n\}/);
  return !!m && m[0].includes('height:44px') && m[0].includes('border-radius:14px') && m[0].includes('flex:1; min-width:0');
})());
check('A8 CSS：rec 描边次按钮 + rec 态红底；send 主色主按钮', /\.voice-rec-btn \{[^}]*border:1\.5px solid[^}]*background:transparent/.test(cmCss) && /\.voice-send-big \{[^}]*background:var\(--btn-bg/.test(cmCss));
check('A9 CSS：试听行左边距归零（原 margin 2px 错位）+ 深色模式 rec 钮兜底', cmCss.includes('padding:8px 14px; margin:10px 0 0;') && cmCss.includes('[data-theme="dark"] .voice-rec-btn'));

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

const root = process.cwd();
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
const tmpProfile = join(process.env.TEMP || '/tmp', 'mochi-voiceico-' + Date.now());
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

// 页面内生成 3 秒静音 WAV dataURL（免外部资源；3s 足够断言 playing 态再等 ended 回落）
const wavFn = `(function(){var sr=8000,sec=3,n=sr*sec,buf=new ArrayBuffer(44+n*2),v=new DataView(buf);
function ws(o,s){for(var i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));}
ws(0,'RIFF');v.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');v.setUint32(16,16,true);
v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);
v.setUint16(32,2,true);v.setUint16(34,16,true);ws(36,'data');v.setUint32(40,n*2,true);
var o=44;for(var i=0;i<n;i++){v.setInt16(o,0,true);o+=2;}
var b='';var u8=new Uint8Array(buf);for(var i=0;i<u8.length;i+=32768){b+=String.fromCharCode.apply(null,u8.subarray(i,i+32768));}
return 'data:audio/wav;base64,'+btoa(b);})()`;

async function openApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var b=document.querySelector('.splash-confirm-btn')||document.getElementById('splash-confirm-ok');if(b)b.click();var s=document.getElementById('splash');if(s)s.hidden=true;return 1;})()");
  await sleep(400);
  await evalJs("(function(){try{window.enterChat();}catch(e){}return 1;})()");
  await sleep(900);
}

// 种一条 3″ 语音消息（out 侧，既有「名称|||dataURL」type:voice 格式）后重载进聊天
await openApp();
const seedRes = await evalJs(`(function(){
  try {
    var src=${wavFn};
    var recs=[{side:'out',text:'语音 3″|||'+src,type:'voice',ts:Date.now()}];
    var j=JSON.stringify(recs);
    var s=window.activeStore(); s.set('chat-msgs', j);
    if (window.idbSet) window.idbSet((window.activePrefix()||'')+':chat-msgs', j);
    return 'ok';
  } catch(e) { return 'err:'+(e&&e.message); }
})()`);
if (seedRes !== 'ok') { console.error('种子写入失败: ' + seedRes); process.exit(1); }
await sleep(1100); // 等 idbSet 落盘再重载，避免权威回填把种子回滚
await openApp();
let seeded = {};
for (let t = 0; t < 14; t++) {
  await sleep(500);
  seeded = JSON.parse(await evalJs("(function(){var v=document.querySelector('#chat-body .msg-out .msg-voice');if(!v)return '{}';var pb=v.querySelector('.msg-voice-play');return JSON.stringify({found:true,svgs:pb?pb.querySelectorAll('svg').length:0});})()") || '{}');
  if (seeded.found) break;
}
check('B1 聊天语音气泡渲染且播放钮含双 SVG', seeded.found === true && seeded.svgs === 2, JSON.stringify(seeded));

// ico 状态辅助：play/pause 两 svg 的 computed display + playing 类
const icoState = "(function(){var pb=document.querySelector('#chat-body .msg-voice-play');if(!pb)return '{}';var a=pb.querySelector('.voice-ico-play'),b=pb.querySelector('.voice-ico-pause');return JSON.stringify({playing:pb.classList.contains('playing'),play:getComputedStyle(a).display,pause:getComputedStyle(b).display});})()";

// ---- B2 点击播放 → playing 态：三角隐/暂停显 ----
await evalJs("(function(){document.querySelector('#chat-body .msg-voice-play').click();return 1;})()");
await sleep(350);
let s2 = JSON.parse(await evalJs(icoState) || '{}');
check('B2 播放中：按钮 playing、三角隐、暂停显', s2.playing === true && s2.play === 'none' && s2.pause === 'block', JSON.stringify(s2));

// ---- B3 再点（停止）→ 复位三角 ----
await evalJs("(function(){document.querySelector('#chat-body .msg-voice-play').click();return 1;})()");
await sleep(350);
let s3 = JSON.parse(await evalJs(icoState) || '{}');
check('B3 再点停止：恢复三角（playing 退）', s3.playing === false && s3.play === 'block' && s3.pause === 'none', JSON.stringify(s3));

// ---- B4 再点播放，等播完 ended 自动回落三角 ----
await evalJs("(function(){document.querySelector('#chat-body .msg-voice-play').click();return 1;})()");
await sleep(350);
let s4mid = JSON.parse(await evalJs(icoState) || '{}');
let s4end = s4mid;
for (let t = 0; t < 16; t++) { await sleep(500); s4end = JSON.parse(await evalJs(icoState) || '{}'); if (s4end.playing === false) break; }
check('B4 播完 ended 自动回落三角（中途 playing→结束复位）', s4mid.playing === true && s4end.playing === false && s4end.pause === 'none', JSON.stringify(s4mid) + ' → ' + JSON.stringify(s4end));

// ---- B5 按压反馈规则在 CSSOM 生效 ----
const b5 = await evalJs("(function(){var hit=null;for(var i=0;i<document.styleSheets.length;i++){var rs;try{rs=document.styleSheets[i].cssRules;}catch(e){continue;}for(var j=0;j<rs.length;j++){var t=rs[j].selectorText||'';if(t.indexOf('.msg-voice-play:active')>=0&&String(rs[j].cssText).indexOf('scale')>=0)hit=rs[j].cssText;}}return hit||'';})()");
check('B5 :active 按压缩放规则已入 CSSOM', !!b5 && b5.indexOf('scale') >= 0, b5);

// ---- B6 录制面板试听钮：双图标 + 试听播放互动态 ----
await evalJs("(function(){window.activeStore().set('cs-voice-send','1');document.dispatchEvent(new Event('voice-send-changed'));document.getElementById('chat-mic-btn').click();return 1;})()");
await sleep(400);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
await sleep(1600);
await evalJs("(function(){document.getElementById('voice-record-btn').click();return 1;})()");
let pv = {};
for (let t = 0; t < 16; t++) {
  await sleep(400);
  pv = JSON.parse(await evalJs("(function(){var p=document.getElementById('voice-preview');if(!p||p.hidden)return '{}';var pb=document.getElementById('voice-play-btn');return JSON.stringify({shown:true,svgs:pb?pb.querySelectorAll('svg').length:0});})()") || '{}');
  if (pv.shown) break;
}
check('B6 试听行出现且试听钮含双 SVG', pv.shown === true && pv.svgs === 2, JSON.stringify(pv));
const pvState = "(function(){var pb=document.getElementById('voice-play-btn');if(!pb)return '{}';var a=pb.querySelector('.voice-ico-play'),b=pb.querySelector('.voice-ico-pause');return JSON.stringify({playing:pb.classList.contains('playing'),play:getComputedStyle(a).display,pause:getComputedStyle(b).display});})()";
await evalJs("(function(){document.getElementById('voice-play-btn').click();return 1;})()");
await sleep(350);
let s6 = JSON.parse(await evalJs(pvState) || '{}');
await evalJs("(function(){document.getElementById('voice-play-btn').click();return 1;})()");
await sleep(350);
let s6b = JSON.parse(await evalJs(pvState) || '{}');
check('B7 试听播放中暂停显/停止复位三角', s6.playing === true && s6.pause === 'block' && s6b.playing === false && s6b.pause === 'none', JSON.stringify(s6) + ' → ' + JSON.stringify(s6b));

// ---- B8 重设计对齐：两底部按钮同高/同顶/同圆角/同字号，试听行左边距 0 ----
const ui = JSON.parse(await evalJs("(function(){var r=document.getElementById('voice-record-btn'),s=document.getElementById('voice-send-btn');var p=document.getElementById('voice-preview');var f=document.querySelector('.voice-foot');if(!r||!s)return '{}';var a=r.getBoundingClientRect(),b=s.getBoundingClientRect(),cs=getComputedStyle(r),cs2=getComputedStyle(s);return JSON.stringify({footW:f?f.getBoundingClientRect().width:-1,hDiff:Math.abs(a.height-b.height),topDiff:Math.abs(a.top-b.top),wDiff:Math.abs(a.width-b.width),rw:a.width,sw:b.width,rFlex:cs.flex,sFlex:cs2.flex,rGrow:cs.flexGrow,sGrow:cs2.flexGrow,rBasis:cs.flexBasis,sBasis:cs2.flexBasis,recRadius:cs.borderRadius,sendRadius:cs2.borderRadius,recFs:cs.fontSize,sendFs:cs2.fontSize,pvMl:p?getComputedStyle(p).marginLeft:''});})()") || '{}');
check('B8 两按钮等高/同顶/等宽（差<0.6px）', ui.hDiff < 0.6 && ui.topDiff < 0.6 && ui.wDiff < 0.6, JSON.stringify(ui));
check('B9 圆角/字号统一（14px/14px）', String(ui.recRadius) === '14px' && String(ui.sendRadius) === '14px' && String(ui.recFs) === '14px' && String(ui.sendFs) === '14px', JSON.stringify(ui));
check('B10 试听行左边距归零（对齐面板内容）', String(ui.pvMl) === '0px', String(ui.pvMl));

// ---- 收尾：关面板关开关 + 零 JS 异常 ----
await evalJs("(function(){document.getElementById('voice-close').click();window.activeStore().set('cs-voice-send','0');document.dispatchEvent(new Event('voice-send-changed'));return 1;})()");
const errs = await evalJs('window.__jsErrors ? window.__jsErrors.length : 0');
check('B11 运行时无 JS 异常', !errs, String(errs));

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
process.exit(pass === results.length ? 0 : 1);

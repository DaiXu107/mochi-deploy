// ===== 回归脚本：#283 聊天语音令牌化（媒体池收 data:audio） =====
// 用法：node build.mjs && node tools/verify-voice-pool.mjs
// 背景（用户机诊断）：vivo S60+Chrome 实测 25fps/堆 307MB/长任务 50~405ms「经常卡、按不动」
// ——历史语音/语音字卡以「名称|||data:audio;base64…」整份内联在消息 text（IDB chat-msgs
// 79.2MB/2277 条），每次落盘 structured clone 整包。#142 池 v1 只收 data:image/，语音漏收。
// 覆盖：
//   W1 聊天语音令牌化（名称|||data:audio → 名称|||@@m:hash；同音频同令牌/异音频异令牌）
//   W2 池数据落盘（xy-home-v2:media:<hash> 与原 data:audio 一致）
//   W3 播放取回（mochiMediaExpandAsync 令牌→音频；未知令牌→null）
//   W4 内存纪律（音频不进 map 热缓存：mochiMediaExpand 同步展开对音频恒 null）
//   W5 聊天落盘（flush 后 IDB chat-msgs 持有「名称|||@@m:」，不再内联 data:audio）
//   W6 裸音频文本（无名称形态 → 「|||@@m:hash」，名称缺省由渲染层补「语音消息」）
//   W7 收藏语音令牌化（favImgPassNow 管道同步收口 data:audio）
//   W8 幂等（再跑一次 pass 令牌不变、池键数不增长）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-voicepool-' + Date.now()),
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 200) + ']' : ''));
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

// 载入应用（全新存储）
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(2000);
// 等权威归属就绪（chatMediaNormalizeNow 的守卫依赖 authLoadedPrefix）
for (let i = 0; i < 20; i++) {
  const ok = await evalJs("(function(){try{window.getChatMsgs().push({side:'out',text:'probe',ts:1});var n=window.getChatMsgs().length;window.getChatMsgs().pop();return n===1;}catch(e){return false;}})()");
  if (ok) break;
  await sleep(400);
}

// 页内生成两段不同频率的 WAV dataURL（1s/8kHz≈22KB，超 1024 令牌化阈值且内容互异）
const AUD_A = await evalJs("(function(){function mkWav(freq){var sr=8000,n=sr,buf=new ArrayBuffer(44+n*2),dv=new DataView(buf);function ws(o,s){for(var i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));}ws(0,'RIFF');dv.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,sr,true);dv.setUint32(28,sr*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);ws(36,'data');dv.setUint32(40,n*2,true);for(var i=0;i<n;i++)dv.setInt16(44+i*2,Math.sin(freq*2*Math.PI*i/sr)*12000,true);var bin='',u8=new Uint8Array(buf);for(var j=0;j<u8.length;j++)bin+=String.fromCharCode(u8[j]);return 'data:audio/wav;base64,'+btoa(bin);}window.__mkWav=mkWav;return mkWav(440);})()");
const AUD_B = await evalJs('window.__mkWav(880)');
check('前置 测试音频生成且超令牌化阈值', typeof AUD_A === 'string' && AUD_A.length > 1024 && AUD_B.length > 1024 && AUD_A !== AUD_B, [AUD_A && AUD_A.length, AUD_B && AUD_B.length]);

// W1 聊天语音令牌化：同音频两条（名称不同）+ 异音频一条
const L0 = await evalJs('window.getChatMsgs().length');
await evalJs(`(function(){var ms=window.getChatMsgs();ms.push({side:'out',text:'你好呀|||'+${JSON.stringify(AUD_A)},type:'voice',ts:Date.now()});ms.push({side:'in',text:'唱给你听|||'+${JSON.stringify(AUD_A)},type:'voice',ts:Date.now()+1});ms.push({side:'out',text:'另一段|||'+${JSON.stringify(AUD_B)},type:'voice',ts:Date.now()+2});return ms.length;})()`);
let norm1 = null;
for (let i = 0; i < 12; i++) {
  norm1 = await evalJs(`(function(){return window.chatMediaNormalizeNow().then(function(){var ms=window.getChatMsgs();var a=ms[${L0}],b=ms[${L0 + 1}],c=ms[${L0 + 2}];if(!a||!b||!c)return {t0:'missing'};var ta=String(a.text).split('|||')[1],tb=String(b.text).split('|||')[1],tc=String(c.text).split('|||')[1];return {same:ta===tb&&ta.indexOf('@@m:')===0,diff:tc!==ta&&tc.indexOf('@@m:')===0,nameKept:a.text.indexOf('你好呀|||')===0,nameKept2:b.text.indexOf('唱给你听|||')===0};});})()`);
  // 同音频不同名称→全文必不等，比对对象是 ||| 后的令牌段
  if (norm1 && norm1.same && norm1.diff && norm1.nameKept && norm1.nameKept2) break;
  await sleep(1000);
}
check('W1 语音令牌化：同音频同令牌/异音频异令牌/名称段保留', norm1 && norm1.same && norm1.diff && norm1.nameKept && norm1.nameKept2, norm1);
const TOK_A = await evalJs(`window.getChatMsgs()[${L0}].text.split('|||')[1]`);
const TOK_B = await evalJs(`window.getChatMsgs()[${L0 + 2}].text.split('|||')[1]`);

// W2 池数据落盘且与原音频一致
const poolA = await evalJs(`(function(){return window.mochiMediaFlush().then(function(){return window.idbGet('xy-home-v2:media:'+${JSON.stringify(TOK_A)}.slice(4)).then(function(v){return v===${JSON.stringify(AUD_A)};});});})()`);
check('W2 池键 xy-home-v2:media:<hash> 内容与原音频一致', poolA === true);

// W3 播放取回：ExpandAsync 令牌→音频；未知令牌→null（回调式 API，包成 Promise 断言）
const expand = await evalJs(`(function(){function ex(s){return new Promise(function(res){window.mochiMediaExpandAsync(s,function(v){res(v);});});}return ex(${JSON.stringify(TOK_A)}).then(function(v){return ex('@@m:'+'0'.repeat(32)).then(function(m){return {ok:v===${JSON.stringify(AUD_A)},miss:m===null};});});})()`);
check('W3 mochiMediaExpandAsync 令牌→音频；未知令牌→null', expand && expand.ok === true && expand.miss === true, expand);

// W4 内存纪律：音频不进 map 热缓存（同步 mochiMediaExpand 对音频恒 null；图片路径不变由 verify-media-pool 覆盖）
const memDisc = await evalJs(`window.mochiMediaExpand(${JSON.stringify(TOK_A)})===null`);
check('W4 音频不进 map 热缓存（同步展开恒 null）', memDisc === true);

// W5 聊天落盘：flush 后 IDB chat-msgs 持有「名称|||@@m:」，无内联 data:audio
await evalJs('window.chatFlushSave();');
await sleep(800);
const persisted = await evalJs(`(function(){return window.idbGet('xy-home-v2:default:chat-msgs').then(function(v){var arr=typeof v==='string'?JSON.parse(v):v;if(!Array.isArray(arr))return {ok:false,len:-1};var bad=[];for(var i=0;i<arr.length;i++){var m=arr[i];if(m&&typeof m.text==='string'&&m.text.indexOf('data:audio')>=0)bad.push(i);}var a=arr[${L0}],c=arr[${L0 + 2}];return {ok:!!a&&!!c&&a.text.indexOf('你好呀|||@@m:')===0&&c.text.indexOf('另一段|||@@m:')===0&&bad.length===0,bad:bad.slice(0,3)};});})()`);
check('W5 IDB chat-msgs 持有语音令牌（不再内联 data:audio）', persisted && persisted.ok === true, persisted);

// W6 裸音频文本（无名称）→ 「|||@@m:hash」
await evalJs(`(function(){window.getChatMsgs().push({side:'in',text:${JSON.stringify(AUD_A)},ts:Date.now()+3});return 1;})()`);
const bare = await evalJs(`(function(){return window.chatMediaNormalizeNow().then(function(){var ms=window.getChatMsgs();var m=ms[ms.length-1];return (m.text.indexOf('|||@@m:')===0 && m.text==='|||'+${JSON.stringify(TOK_A)}) ? m.text.slice(0,9) : ('bad:'+m.text.slice(0,12));});})()`);
check('W6 裸音频文本令牌化为「|||@@m:」（同音频复用同一令牌）', bare === ('|||' + TOK_A).slice(0, 9), bare);

// W7 收藏语音令牌化（favImgPassNow 管道）
await evalJs(`(function(){window.xyStore('xy-home-v2:default').set('fav-msgs',JSON.stringify([{side:'out',text:'晚安曲|||'+${JSON.stringify(AUD_B)},type:'voice',ts:Date.now()}]));return 1;})()`);
const favDone = await evalJs('window.favImgPassNow()');
await sleep(500);
const favTok = await evalJs(`(function(){var raw=localStorage.getItem('xy-home-v2:default:fav-msgs')||'';var arr=[];try{arr=JSON.parse(raw);}catch(e){return {ok:false,err:'parse'};}if(!Array.isArray(arr)||!arr.length)return {ok:false,err:'len'};var t=arr[0].text;return {ok:t.indexOf('晚安曲|||@@m:')===0,lt:t.length<100};})()`);
check('W7 收藏语音令牌化（名称|||@@m:）', favDone === true && favTok && favTok.ok === true && favTok.lt === true, favTok);

// W8 幂等：再跑 pass 令牌不变、池键数不增长
const poolCount1 = await evalJs("(function(){return window.mochiMediaFlush().then(function(){return window.idbGetAllKeys().then(function(ks){return (ks||[]).filter(function(k){return String(k).indexOf('xy-home-v2:media:')===0;}).length;});});})()");
const reNorm = await evalJs(`(function(){var before=window.getChatMsgs()[${L0}].text;return window.chatMediaNormalizeNow().then(function(){return {same:window.getChatMsgs()[${L0}].text===before};});})()`);
const poolCount2 = await evalJs("(function(){return window.mochiMediaFlush().then(function(){return window.idbGetAllKeys().then(function(ks){return (ks||[]).filter(function(k){return String(k).indexOf('xy-home-v2:media:')===0;}).length;});});})()");
check('W8 再跑 pass 令牌不变、池键数不增长', reNorm && reNorm.same === true && poolCount2 === poolCount1, [poolCount1, poolCount2]);

// 汇总
const pass = results.filter(r => r.ok).length;
console.log('-----\n结果：' + pass + '/' + results.length + ' 通过');
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

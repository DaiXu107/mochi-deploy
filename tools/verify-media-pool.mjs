// ===== 回归脚本：#142 媒体池（聊天/收藏图片内容寻址去重） =====
// 用法：node build.mjs && node tools/verify-media-pool.mjs
// 覆盖：
//   T1 聊天消息图片令牌化（重复图片 → 同一令牌）
//   T2 池数据落盘（xy-home-v2:media:<hash> 与原 dataURL 一致）
//   T3 展开助手（mochiMediaExpand 令牌→原图，编辑入口同源逻辑）
//   T4 渲染解析（MutationObserver 把 img[src=令牌] 重写为池数据）
//   T5 聊天落盘（flush 后 IDB 里 chat-msgs 持有令牌而非原图）
//   T6 收藏令牌化（favImgPassNow 管道：压缩→令牌化→池先落盘→CAS 落盘）
//   T7 增量幂等（同一张图再次出现 → 同一令牌、池键数不增长）
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
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mediapool-' + Date.now()),
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

// 载入应用（全新存储）——清空该临时 profile 无需 purge，user-data-dir 每次新建
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

// 页内生成测试图片（噪点内容：压缩重编码后仍 >1KB，保证令牌化阈值与压缩路径都可达）
const IMG_A = await evalJs("(function(){var c=document.createElement('canvas');c.width=256;c.height=256;var x=c.getContext('2d');for(var i=0;i<6000;i++){x.fillStyle='rgb('+(i*7)%256+','+(i*13)%256+','+(i*29)%256+')';x.fillRect(i%256,(i*31)%256,2,2);}return c.toDataURL('image/png');})()");
const IMG_B = await evalJs("(function(){var c=document.createElement('canvas');c.width=220;c.height=220;var x=c.getContext('2d');for(var i=0;i<5000;i++){x.fillStyle='rgb('+(i*11)%256+','+(i*3)%256+','+(i*37)%256+')';x.fillRect((i*17)%220,i%220,2,2);}return c.toDataURL('image/png');})()");
check('前置 测试图片生成且超令牌化阈值', typeof IMG_A === 'string' && IMG_A.length > 1024 && typeof IMG_B === 'string' && IMG_B.length > 1024, [IMG_A && IMG_A.length, IMG_B && IMG_B.length]);

// T1 聊天令牌化：两条同图 + 一条异图（权威归属就绪前 normalize 会被守卫拦下 → 重试；
// App 启动会自产系统消息，取长度偏移而非固定下标）
const L0 = await evalJs('window.getChatMsgs().length');
await evalJs(`(function(){var ms=window.getChatMsgs();ms.push({side:'out',text:${JSON.stringify(IMG_A)},ts:Date.now()});ms.push({side:'in',text:${JSON.stringify(IMG_A)},ts:Date.now()+1});ms.push({side:'out',text:${JSON.stringify(IMG_B)},ts:Date.now()+2});return ms.length;})()`);
let norm1 = null;
for (let i = 0; i < 12; i++) {
  norm1 = await evalJs(`(function(){return window.chatMediaNormalizeNow().then(function(){var ms=window.getChatMsgs();var a=ms[${L0}],b=ms[${L0 + 1}],c=ms[${L0 + 2}];if(!a||!b||!c)return {t0:'missing'};return {t0:a.text.slice(0,8),t1:b.text.slice(0,8),t2:c.text.slice(0,8),same:a.text===b.text,diff:a.text!==c.text};});})()`);
  // 必须确认已令牌化才 break——启动期自动 pass 可能占用 _mediaPassBusy 令本次调用空转重排
  if (norm1 && norm1.same && norm1.diff && norm1.t0.indexOf('@@m:') === 0) break;
  await sleep(1000);
}
check('T1 重复图片令牌化且同图同令牌/异图异令牌', norm1 && norm1.same && norm1.diff && norm1.t0.indexOf('@@m:') === 0, norm1);
const TOK_A = await evalJs(`window.getChatMsgs()[${L0}].text`);
const TOK_B = await evalJs(`window.getChatMsgs()[${L0 + 2}].text`);

// T2 池数据落盘且与原 dataURL 一致
const poolA = await evalJs(`(function(){var h=${JSON.stringify(TOK_A)}.slice(4);return window.idbGet('xy-home-v2:media:'+h).then(function(v){return v===${JSON.stringify(IMG_A)};});})()`);
check('T2 池键 xy-home-v2:media:<hash> 内容与原图一致', poolA === true);

// T3 展开助手（编辑消息入口同一判定源）
const expand = await evalJs(`(function(){return window.mochiMediaExpand(${JSON.stringify(TOK_A)})===${JSON.stringify(IMG_A)} && window.mochiMediaExpand(${JSON.stringify(IMG_A)})===null && window.mochiMediaExpand('@@m:'+'0'.repeat(32))===null;})()`);
check('T3 mochiMediaExpand 令牌→原图；非令牌→null（含未知哈希）', expand === true);

// T4 渲染解析：令牌 src 的 img 插入 DOM → 观察器重写为池数据
const rendered = await evalJs(`(function(){return new Promise(function(res){var im=document.createElement('img');im.src=${JSON.stringify(TOK_A)};im.id='mp-test-img';document.body.appendChild(im);setTimeout(function(){res(im.src.slice(0,10)==='data:image' && im.src.length>1000);},800);});})()`);
check('T4 MutationObserver 把令牌 src 解析为池数据', rendered === true);
await evalJs("(function(){var n=document.getElementById('mp-test-img');if(n)n.remove();return 1;})()");

// T5 聊天落盘：flush 后 IDB 里 chat-msgs 持有令牌
await evalJs('window.chatFlushSave();');
await sleep(800);
const persisted = await evalJs(`(function(){return window.idbGet('xy-home-v2:default:chat-msgs').then(function(v){var arr=typeof v==='string'?JSON.parse(v):v;if(!Array.isArray(arr)||arr.length<${L0 + 3})return {ok:false,len:arr&&arr.length};var a=arr[${L0}],c=arr[${L0 + 2}];return {ok:a.text.slice(0,4)==='@@m:' && a.text.length<100 && c.text.slice(0,4)==='@@m:'};});})()`)
check('T5 IDB chat-msgs 持有令牌（不再内联原图）', persisted && persisted.ok === true, persisted);

// T6 收藏令牌化：压缩→令牌化→池先落盘→CAS 落盘
await evalJs(`(function(){window.xyStore('xy-home-v2:default').set('fav-msgs',JSON.stringify([{side:'out',text:${JSON.stringify(IMG_A)},type:'image',ts:Date.now()},{side:'out',text:${JSON.stringify(IMG_B)},type:'image',ts:Date.now()+1}]));return 1;})()`);
const favDone = await evalJs('window.favImgPassNow()');
await sleep(500);
const favTok = await evalJs(`(function(){var raw=localStorage.getItem('xy-home-v2:default:fav-msgs')||'';var arr=[];try{arr=JSON.parse(raw);}catch(e){return {ok:false,err:'parse'};}if(!Array.isArray(arr)||arr.length<2)return {ok:false,err:'len'};var t0=arr[0].text,t1=arr[1].text;var h0=t0.slice(4);return window.idbGet('xy-home-v2:media:'+h0).then(function(v){return {ok:t0.slice(0,4)==='@@m:'&&t1.slice(0,4)==='@@m:'&&typeof v==='string'&&v.length>1000,lt:t0.length<100};});})()`);
check('T6 收藏图片令牌化且池可回查', favDone === true && favTok && favTok.ok === true && favTok.lt === true, favTok);

// T7 增量幂等：同一张图再次出现 → 同一令牌，池键数不增长（先冲刷池写缓冲防计数竞态）
const poolCount1 = await evalJs("(function(){return window.mochiMediaFlush().then(function(){return window.idbGetAllKeys().then(function(ks){return (ks||[]).filter(function(k){return String(k).indexOf('xy-home-v2:media:')===0;}).length;});});})()");
await evalJs(`(function(){window.getChatMsgs().push({side:'in',text:${JSON.stringify(IMG_A)},ts:Date.now()+3});return 1;})()`);
const norm2 = await evalJs(`(function(){return window.chatMediaNormalizeNow().then(function(){var ms=window.getChatMsgs();return {same:ms[ms.length-1].text===${JSON.stringify(TOK_A)}};});})()`);
const poolCount2 = await evalJs("(function(){return window.mochiMediaFlush().then(function(){return window.idbGetAllKeys().then(function(ks){return (ks||[]).filter(function(k){return String(k).indexOf('xy-home-v2:media:')===0;}).length;});});})()");
check('T7 再次出现同图 → 同一令牌、池键数不增长', norm2 && norm2.same === true && poolCount2 === poolCount1, [poolCount1, poolCount2]);

// T8 #275 池值体检：池条目被腐蚀成空串（旧「只备份文字」备份导入残留）→ 绝不许当有效数据。
// 旧实现 typeof 判定放行空串 → map 缓存 '' + img.src=''（解析成页面 URL）＝永久坏图+误报占位；
// 修复后与「池缺失」同路：令牌 src 原样保留（交 #186/#202 占位），且不入负缓存。
const BAD_H = 'f'.repeat(32);
await evalJs(`(function(){return window.idbSet('xy-home-v2:media:' + '${BAD_H}', '').then(function(ok){return ok;});})()`);
const badRes = await evalJs(`(function(){return new Promise(function(res){var im=document.createElement('img');im.src='@@m:${BAD_H}';im.id='mp-bad-img';document.body.appendChild(im);setTimeout(function(){res({attr:im.getAttribute('src'),stillTok:im.src.indexOf('@@m:')>=0});},900);});})()`);
check('T8 #275 池值空串（腐蚀条目）→ 令牌 src 原样保留，不被改写成空串/页面URL', badRes && badRes.attr === '@@m:' + BAD_H && badRes.stillTok === true, badRes);
await evalJs("(function(){var n=document.getElementById('mp-bad-img');if(n)n.remove();return 1;})()");

// T9 #275 自愈/回归双证：同一池键补回有效 dataURL（＝完整备份导入补池）→ 新令牌 img 经
// map-miss→idbGet 异步路径解析成功（T4 走的是 map 命中同步路径，这条才覆盖体检放行分支）。
const healRes = await evalJs(`(function(){return window.idbSet('xy-home-v2:media:' + '${BAD_H}', ${JSON.stringify(IMG_B)}).then(function(ok){return new Promise(function(res){var im=document.createElement('img');im.src='@@m:${BAD_H}';im.id='mp-heal-img';document.body.appendChild(im);setTimeout(function(){res({ok:im.src.slice(0,10)==='data:image',len:im.src.length});},900);});});})()`);
check('T9 #275 池值补回有效数据 → 同令牌新渲染自愈（体检放行 data:image/ 且观察器照常改写）', healRes && healRes.ok === true && healRes.len > 1000, healRes);
await evalJs("(function(){var n=document.getElementById('mp-heal-img');if(n)n.remove();return 1;})()");

// 汇总
const pass = results.filter(r => r.ok).length;
console.log('-----\n结果：' + pass + '/' + results.length + ' 通过');
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);

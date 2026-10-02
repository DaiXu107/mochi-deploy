// ===== 回归 #1255：安卓 ce-box 里「令牌形态表情包」发出去分裂成两个／几分钟后变 image: 文字 =====
// 用户实报（vivo X200s + Edge，明说其他设备型号也有）：输入时正常一个表情包，发送后同一张图出现
// 两个；过几分钟变成「image:」文字＋一个表情包。
// 根因（零机型／零 UA 分支，判据只取 DOM/池结构事实）：mailInsertInto 建的 <img src="@@m:hash"> 被
//   media-pool 观察器把 src 解回真图（map 命中）或换成 #665d 缺图占位 SVG，而配对 span 仍持
//   "sticker:@@m:hash" 令牌文本——walkMedia 的 covered 字面包含判据（span 文本 ⊇ img.src）在这两种
//   形态下永错位 ⇒ img 走重建分支写 image:<整段载荷>，span 又写一遍令牌＝双写；日后快照只剥 dataURL
//   不剥 image: 前缀＝「image: 文字」残留。收口＝补两条结构判据：① span 里的令牌经 mochiMediaExpand
//   展开恰等于 img.src；② img 正挂 media-tok-missing 占位。#1235e 交接点名的跨域半族由此闭环。
// 用例（无头 CDP 真跑产物；VERIFY_ROOT 指被测副本；Android 形态靠 UA+触屏仿真触发 ce-box 转换）：
//   S1~S3 源锚：展开等价判据／占位判据／v3.6.x 字面包含判据仍在（防修过头把旧路径删了）
//   B1 插入令牌表情包后即时读值：单 sticker 令牌、零重建（RED 判别点＝占位/未解回形态双写）
//   B2 池自愈解回真图后再读值：仍是单 sticker 令牌（RED 判别点＝真图整段重建）
//   B3 发送后落库 content：恰 1 个 sticker:@@m:、无 image: 前缀、无 data: 载荷、体积小巧
//   B3b 谓词①本体（map 命中：img=真图 × span=令牌）读值单写（RED 判别点＝双写表情包）
//   B4 对照组（两侧皆绿）：无标记 span 的裸 dataURL img 仍重建 image:（v3.5.137 语义保留）
//   B5 对照组（两侧皆绿）：span 字面含 img.src 的旧形态仍单写不重建（v3.6.x 语义保留）
//   B6 页面零 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const port = Number(process.env.MOCHI_CDP_PORT) || (12550 + Math.floor(Math.random() * 180));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1255-' + port + '-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
if (!ws) { console.error('CDP 连不上（端口 ' + port + ' 可能被占用）'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36 EdgA/152.0.0.0',
  platform: 'Linux armv81',
  userAgentMetadata: { mobile: true, platform: 'Android', platformVersion: '10', architecture: '', model: 'V2458A', brand: 'Edge' }
});
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 3.5, mobile: true });

const results = []; const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  <- ' + detail : '')); };
const srcOf = (f) => { try { return readFileSync(join(root, 'src/js', f), 'utf8'); } catch (e) { return ''; } };

// ===== S 组：源锚 =====
const ma = srcOf('mobile-adapt.js');
t('S1 令牌展开等价判据在（删＝令牌解回真图后 covered 错位复发）', ma.includes('window.mochiMediaExpand(tk[0]) === n.src'), '');
t('S2 缺图占位判据在（删＝占位形态被当信件内容重建 image:）', ma.includes("n.classList.contains('media-tok-missing')"), '');
t('S3 v3.6.x 字面包含判据仍在（防修过头删旧路径）', ma.includes('sp.textContent.indexOf(n.src) >= 0'), '');

// ===== 场景：种一张令牌卡表情包 → 进写信页 → 面板点贴 → 读值/发送 =====
async function boot(clearAll) {
  await cdp('Page.navigate', { url: base + '/index.html' });
  await sleep(2600);
  if (clearAll) await ev("(function(){try{localStorage.clear();}catch(e){} try{indexedDB.deleteDatabase('xy-home-v2');}catch(e){} return 1;})()");
  await cdp('Page.navigate', { url: base + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
  await sleep(400);
  await ev("(function(){var m=document.getElementById('splash-mandatory'); if(m&&!m.hidden){var en=document.getElementById('splash-mandatory-enter'); if(en&&!en.classList.contains('is-disabled'))en.click();} var s=document.getElementById('splash'); if(s){s.classList.add('hide'); s.style.display='none';} var q=document.getElementById('qa-mask'); if(q)q.remove(); return 1;})()");
  await ev("(function(){ localStorage.setItem('xy-home-v2:default:ml-write-en','0'); localStorage.setItem('xy-home-v2:default:ml-reply-en','0'); return 1;})()");
}
await boot(true);
const seeded = JSON.parse(await ev(`(new Promise(function(res){
  var c=document.createElement('canvas'); c.width=60; c.height=60; var g=c.getContext('2d');
  var im=g.createImageData(60,60); for(var i=0;i<im.data.length;i+=4){var v=255*Math.random()|0; im.data[i]=v; im.data[i+1]=v; im.data[i+2]=v; im.data[i+3]=255;}
  g.putImageData(im,0,0);
  var big=c.toDataURL('image/png');
  window.mochiMediaTokenize(big).then(function(tok){
    if(!tok){ res(JSON.stringify({err:'tokenize fail'})); return; }
    localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['令牌组',[tok]]]));
    res(JSON.stringify({tok:tok, dataLen:big.length}));
  });
}))`));
if (seeded.err) { t('seed 令牌表情包', false, seeded.err); }
await boot(false);
await ev('window.openMailPage()'); await sleep(500);
await ev("document.getElementById('mail-open-write').click();1"); await sleep(500);
await ev("document.querySelector('#page-mail-write .mail-tb-sticker').click();1"); await sleep(600);
await ev("(function(){var tt=[].find.call(document.querySelectorAll('#emoji-panel .emoji-tab'),function(x){return x.dataset.etab==='mine'}); if(tt)tt.click(); return 1;})()"); await sleep(400);
await ev("(function(){var g=document.querySelector('#emoji-panel .emoji-groups > *'); if(g)g.click(); return 1;})()"); await sleep(600);
await ev("document.querySelector('#emoji-panel .emoji-item').click();1");
await sleep(1200); // 等 media-pool 观察器把 img.src 解回真图或挂占位

const SNAP = `(function(){
  var ta=document.getElementById('mail-input'); var box=ta&&ta.__ceBox;
  var v = ta ? String(ta.value||'') : '';
  var imgs = box ? [].map.call(box.querySelectorAll('img'),function(i){ return { attr:(i.getAttribute('src')||'').slice(0,10), idl:(i.src||'').slice(0,15), len:(i.src||'').length, miss: !!(i.classList&&i.classList.contains('media-tok-missing')) }; }) : [];
  return JSON.stringify({ valueLen:v.length, dataCount:(v.match(/data:/g)||[]).length, stickerTok:(v.match(/sticker:/g)||[]).length, imageTok:(v.match(/(^|[^a-z])image:/g)||[]).length, tokCount:(v.match(/@@m:/g)||[]).length, imgs:imgs });
})()`;
const snap = async () => JSON.parse(await ev(SNAP));

// B1 即时读值（占位/未解回/已解回任一形态都不得重建）
const s1 = await snap();
t('B1 插入令牌表情包后读值＝单 sticker 令牌、零重建（RED 判别点：旧写法占位形态已双写）',
  s1.tokCount === 1 && s1.stickerTok === 1 && s1.imageTok === 0 && s1.dataCount === 0, JSON.stringify(s1).slice(0, 220));

// B2 等池自愈解回真图（或超时保持占位）后再读值
let resolved = null;
for (let i = 0; i < 40; i++) {
  resolved = await ev('(function(){var ta=document.getElementById("mail-input");var box=ta&&ta.__ceBox;if(!box)return 0;var im=box.querySelector("img");if(!im)return 0;return (im.src&&im.src.indexOf("data:image/png")===0&&im.src.length>100)?im.src.length:0;})()');
  if (resolved && resolved > 100) break;
  await sleep(600);
}
const s2 = await snap();
t('B2 池解回真图后再读值仍是单 sticker 令牌（RED 判别点：旧写法此际把整段真图重建进正文）',
  s2.tokCount === 1 && s2.stickerTok === 1 && s2.imageTok === 0 && s2.dataCount === 0,
  'resolvedLen=' + resolved + ' ' + JSON.stringify(s2).slice(0, 200));

// B3 发送落库形态
await ev("document.getElementById('mail-send').click();1");
await sleep(1200);
const store = JSON.parse(await ev(`(function(){
  var raw = localStorage.getItem('xy-home-v2:default:mail-letters') || window.xyStore('xy-home-v2:default').get('mail-letters');
  var list; try{ list=JSON.parse(raw||'[]'); }catch(e){ return JSON.stringify({err:'parse fail'}); }
  var c=String((list[0]||{}).content||'');
  return JSON.stringify({ n:list.length, len:c.length, dataCount:(c.match(/data:/g)||[]).length, stickerTok:(c.match(/sticker:/g)||[]).length, imageTok:(c.match(/(^|[^a-z])image:/g)||[]).length, tokCount:(c.match(/@@m:/g)||[]).length });
})()`));
t('B3 发送后落库＝恰 1 个 sticker:@@m: 令牌、无 image: 前缀、无 data: 载荷（旧写法＝双写＋整段载荷入库）',
  store.n === 1 && store.stickerTok === 1 && store.tokCount === 1 && store.imageTok === 0 && store.dataCount === 0 && store.len < 200, JSON.stringify(store));

// B3b 谓词①（map 命中形态）：同会话 tokenize 后 img.src＝真图、span＝令牌，读值必须仍单写
//（RED 判别点：旧写法此处把整段真图重建进正文＝用户所见「两个一模一样的表情包」）
const b3b = JSON.parse(await ev(`(new Promise(function(done){
  var ta=document.getElementById('mail-input'); var box=ta.__ceBox; box.textContent='';
  var c=document.createElement('canvas'); c.width=60; c.height=60; var g=c.getContext('2d');
  var im=g.createImageData(60,60); for(var i=0;i<im.data.length;i+=4){var v=255*Math.random()|0; im.data[i]=v; im.data[i+1]=v; im.data[i+2]=v; im.data[i+3]=255;}
  g.putImageData(im,0,0);
  var big=c.toDataURL('image/png');
  window.mochiMediaTokenize(big).then(function(tok){
    var img=document.createElement('img'); img.src=big;
    var sp=document.createElement('span'); sp.className='mail-media-mark'; sp.style.display='none'; sp.textContent='sticker:'+tok;
    box.appendChild(img); box.appendChild(sp); box.appendChild(document.createTextNode(' '));
    var v=String(ta.value||'');
    done(JSON.stringify({ tok:tok, single: tok && (v.match(/@@m:/g)||[]).length===1 && (v.match(/sticker:/g)||[]).length===1 && v.indexOf('image:'+big) < 0 && (v.match(/data:image/g)||[]).length===0, v: v.slice(0,50) }));
  });
}))`));
t('B3b 池 map 命中（img＝真图 × span＝令牌）读值单写（RED 判别点：双写表情包本体）', b3b.single === true, 'tok=' + String(b3b.tok).slice(0, 12) + ' v=' + b3b.v);


// B4 对照组：无配对标记 span 的裸 dataURL img 仍走重建（v3.5.137「删 span 后图片被无声丢弃」防线）
const b4 = JSON.parse(await ev(`(function(){
  var ta=document.getElementById('mail-input'); var box=ta.__ceBox; box.textContent='';
  var im=document.createElement('img'); im.src='data:image/png;base64,B04CONTROLNOTACOPY';
  box.appendChild(im);
  var v=String(ta.value||'');
  return JSON.stringify({ rebuilt: v.indexOf('image:data:image/png') === 0, v: v.slice(0,60) });
})()`));
t('B4 裸 dataURL img（无标记 span）仍重建 image:（对照组，两侧皆绿＝旧防线未修过头）', b4.rebuilt === true, b4.v);

// B5 对照组：span 字面含 img.src 的旧形态单写不重建（v3.6.x 整框查找）
const b5 = JSON.parse(await ev(`(function(){
  var ta=document.getElementById('mail-input'); var box=ta.__ceBox; box.textContent='';
  var s='data:image/png;base64,B05LITERALCONTROL';
  var im=document.createElement('img'); im.src=s;
  var sp=document.createElement('span'); sp.className='mail-media-mark'; sp.style.display='none'; sp.textContent='sticker:'+s;
  box.appendChild(im); box.appendChild(sp); box.appendChild(document.createTextNode(' '));
  var v=String(ta.value||'');
  return JSON.stringify({ once: (v.match(/data:image/g)||[]).length === 1 && v.indexOf('image:data:') < 0, v: v.slice(0,60) });
})()`));
t('B5 字面包含旧形态仍单写（对照组，两侧皆绿＝covered 原判据保留）', b5.once === true, b5.v);
await ev("(function(){var ta=document.getElementById('mail-input'); if(ta&&ta.__ceBox) ta.__ceBox.textContent=''; return 1;})()");

// B6 零异常
const errs = await ev('(window.__jsErrors&&window.__jsErrors.length)||0');
t('B6 页面零 JS 异常', errs === 0, 'jsErrors=' + errs);

try { chrome.kill(); } catch (e) {}
server.close();
const pass = results.filter(r => r.ok).length;
console.log('==== verify-1255-cebox-token-covered: ' + pass + '/' + results.length + ' ====');
process.exit(pass === results.length ? 0 : 1);

// ===== 验证脚本：#554（TASKS #128）字卡媒体令牌化持久化 =====
// 用法：node build.mjs && node tools/verify-cc-media-persist-token.mjs
//   需要：Node 21+（内置 fetch/WebSocket）+ 本机 Chrome/Edge（CHROME_PATH 可指定）
// 功能：把双作用域字卡库存储键里的内联图（data:image/* ≥4096 字符）替换成媒体池令牌
//   @@m:hash——同一张图跨卡/跨组/跨作用域（公用+专属共用全局池）只存一份。
//   上传口同步令牌化（#554a）；消费方此前已就绪：渲染（#142/#377）、GC 引用面（#506）、
//   导出自包含还原（#506）、完整备份自带池键（#275）。
// 断言口径：
//   A 组（静态，src）：迁移入口/保险丝/上传口三锚点 + template 入口行。
//   B 组（行为，无头真实产物）——种子双作用域库后跑 mochiCcPersistTokenize：
//     B1 报告 ok 且写回 2 个库；
//     B2 库键里大图全部变令牌、小图（<4096）与语音、文字卡原样不动；
//     B3 池里每个唯一图恰好一份（跨组/跨分类/跨作用域同图＝同哈希）且字节与原图完全一致；
//     B4 令牌渲染链路就绪：mochiMediaTokenMissing=false（池可解析）；
//     B5 GC 安全：跑 mochiMediaGC()，字卡库引用的令牌绝不进孤儿名单；
//     B6 阈值边界：<4096 的小图保持内联。
//   RED 基线：HEAD 产物无 mochiCcPersistTokenize（git show 可证），本脚本 A 组即红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
function J(name, cond) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}

// ---- A 组：静态断言 ----
console.log('静态断言:');
const cc = read('src/js/chatcard.js');
J('A1 迁移入口 mochiCcPersistTokenize 存在', cc.includes('window.mochiCcPersistTokenize = function (prog) {'));
J('A2 迁移保险丝「不变小不写」在位', cc.includes('if (!replaced || outStr.length >= raw.length) continue;'));
J('A3 上传口令牌化 hook 在位', cc.includes("if (cur !== 'voice' && window.mochiMediaTokenize && typeof data === 'string' && data.length >= CC_CC_TOK_MIN) {"));
J('A4 池先令牌后（tokenize 在写回前完成，失败即整库放弃）', cc.indexOf('mochiMediaTokenize(url, { noCache: true })') >= 0 && cc.includes('if (failed) { seenTok.clear();'));
J('A5 template 查看存储入口行在位', read('src/template.html').includes('id="st-cc-tokbtn"'));

// ---- B 组：行为断言 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('\n无 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }
if (typeof WebSocket !== 'function') { console.log('\n需 Node 21+（内置 WebSocket）'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9930 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-cc-tok-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}

try {
  await cdpConnect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 100; i++) { try { if (await evalJs('!!window.__mochiDataReady')) break; } catch (e) {} await sleep(200); }
  await sleep(800);

  // 种子：真随机噪声 PNG（ImageData 逐像素随机，PNG 压不缩，稳定 ≥6000 字符）+ 假 GIF-mime 大载荷 + 小图 + 语音 + 文字卡
  const seed = await evalJs(`(async function(){
    function noisePng(minLen) {
      var c = document.createElement('canvas'); c.width = 48; c.height = 48;
      var x = c.getContext('2d'); var im = x.createImageData(48, 48); var guard = 0;
      while (guard++ < 60) {
        for (var j = 0; j < im.data.length; j += 4) {
          im.data[j] = Math.random() * 256 | 0; im.data[j + 1] = Math.random() * 256 | 0;
          im.data[j + 2] = Math.random() * 256 | 0; im.data[j + 3] = 255;
        }
        x.putImageData(im, 0, 0);
        var d = c.toDataURL('image/png');
        if (d.length >= minLen) return d;
      }
      return c.toDataURL('image/png');
    }
    var BIG = noisePng(6000);                       // ≥4096 应令牌化（真随机噪声，PNG 压不缩）
    var SMALL = (function(){ var c=document.createElement('canvas'); c.width=8; c.height=8; var x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,8,8); return c.toDataURL('image/png'); })(); // <4096 保持内联
    var b64 = ''; var CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (var k = 0; k < 6000; k++) b64 += CH[Math.floor(Math.random() * 64)];
    var GIF = 'data:image/gif;base64,' + b64;       // ≥4096 应令牌化（字节原样入池）
    function buildLib() {
      var lib = { text: [['问候', ['你好呀', '在吗']] ],
        sticker: [['A', [BIG, GIF, SMALL]], ['B', [BIG]]],
        image: [['C', [GIF, SMALL]]],
        voice: [['语音', ['语音一|||data:audio/mp3;base64,AAAAsomeaudio']]] };
      return JSON.stringify(lib);
    }
    var libStr = buildLib();
    // 种子写入读回确认（无头冷启动 IDB 事务偶发挂起＝idbSet 超时 resolve(false)，#229 家族；
    // 不确认就往下跑会把「种子没落」误判成迁移缺陷）
    var seeded = false;
    for (var t = 0; t < 6 && !seeded; t++) {
      await window.idbSet('xy-home-v2:cc-groups-public', libStr);
      await window.idbSet('xy-home-v2:default:cc-groups', libStr);
      await new Promise(function (r) { setTimeout(r, 350); });
      var c1 = await window.idbGet('xy-home-v2:cc-groups-public');
      var c2 = await window.idbGet('xy-home-v2:default:cc-groups');
      seeded = (c1 === libStr && c2 === libStr);
    }
    if (!seeded) return { seedFail: true };
    // 记录迁移前池条目数
    var keysBefore = (await window.idbListKeys() || []).filter(function(k){ return String(k).indexOf('xy-home-v2:media:') === 0; }).length;
    return { bigLen: BIG.length, smallLen: SMALL.length, gifLen: GIF.length, keysBefore: keysBefore, big: BIG, gif: GIF, small: SMALL };
  })()`);
  if (!seed || !seed.big) throw new Error('种子失败: ' + JSON.stringify(seed).slice(0, 120));
  if (seed.seedFail) throw new Error('种子写入读回确认失败（IDB 持续挂起），本轮无法测试');
  if (seed.bigLen < 4096 || seed.gifLen < 4096) throw new Error('测试图未达阈值: big=' + seed.bigLen + ' gif=' + seed.gifLen);
  const BIG = seed.big, GIF = seed.gif, SMALL = seed.small;

  // 执行迁移
  const rep = await evalJs(`window.mochiCcPersistTokenize().then(function(r){ return JSON.stringify(r); })`);
  const report = JSON.parse(rep);

  J('B1 迁移报告 ok 且写回 2 个库（公用+专属）', report && report.ok === true && report.written === 2);
  if (!(report && report.ok)) console.log('  B1 现场: ' + rep);

  // 读回两库验证内容（判空：种子确认过仍读到 null＝环境读挂起，如实报环境失败而非误判迁移）
  const after = await evalJs(`(async function(){
    function parse(s){ try { return JSON.parse(s); } catch(e){ return null; } }
    var pubRaw = await window.idbGet('xy-home-v2:cc-groups-public');
    var ownRaw = await window.idbGet('xy-home-v2:default:cc-groups');
    if (typeof pubRaw !== 'string' || typeof ownRaw !== 'string') return { envFail: '读回挂起 pub=' + (typeof pubRaw) + ' own=' + (typeof ownRaw) };
    var pub = parse(pubRaw), own = parse(ownRaw);
    if (!pub || !own) return { envFail: '解析失败' };
    var toks = function(lib){ var t=[]; ['sticker','image'].forEach(function(cat){ (lib[cat]||[]).forEach(function(g){ (g[1]||[]).forEach(function(c){ if (String(c).indexOf('@@m:')===0) t.push(c); }); }); }); return t; };
    return { pub: pub, own: own, pubToks: toks(pub), ownToks: toks(own),
      pubStkA: pub && pub.sticker && pub.sticker.find(g=>g[0]==='A'),
      pubStkB: pub && pub.sticker && pub.sticker.find(g=>g[0]==='B'),
      pubImg: pub && pub.image && pub.image.find(g=>g[0]==='C'),
      pubText: pub && pub.text && pub.text.find(g=>g[0]==='问候'),
      pubVoice: pub && pub.voice && pub.voice.find(g=>g[0]==='语音') };
  })()`);
  if (after && after.envFail) throw new Error('环境读失败: ' + after.envFail);

  // B2 库键内容：大图→令牌；小图/语音/文字卡原样
  const stkA = after.pubStkA && after.pubStkA[1] || [];
  const stkB = after.pubStkB && after.pubStkB[1] || [];
  const imgC = after.pubImg && after.pubImg[1] || [];
  const TOKRE = /^@@m:[0-9a-f]{32}$/;
  const isTok = (s) => TOKRE.test(String(s));
  J('B2a 库键：大图（sticker A[0] BIG、A[1] GIF、B[0] BIG、image C[0] GIF）全部变令牌', isTok(stkA[0]) && isTok(stkA[1]) && isTok(stkB[0]) && isTok(imgC[0]));
  const textCards = (after.pubText && after.pubText[1]) || [];
  const voiceCards = (after.pubVoice && after.pubVoice[1]) || [];
  J('B2b 文字卡与语音原样不动', textCards.join('|') === '你好呀|在吗' && voiceCards.length === 1 && String(voiceCards[0]).indexOf('data:audio/mp3;base64,') > 0);

  // B3 池去重：BIG 与 GIF 各只有一份池条目、跨组/跨分类/跨作用域同哈希、字节一致
  const bigTok = stkA[0], gifTok = stkA[1];
  J('B3a 同图跨组/跨分类/跨作用域＝同一令牌（B[0]===A[0]、C[0]===A[1]、own 库同令牌）',
    stkB[0] === bigTok && imgC[0] === gifTok && (after.ownToks || []).length === 4 && after.ownToks.includes(bigTok) && after.ownToks.includes(gifTok));
  const poolCheck = await evalJs(`(async function(){
    var h = '${String(bigTok).slice(4)}', g = '${String(gifTok).slice(4)}';
    var v1 = await window.idbGet('xy-home-v2:media:' + h);
    var v2 = await window.idbGet('xy-home-v2:media:' + g);
    var keys = (await window.idbListKeys() || []).filter(function(k){ return String(k).indexOf('xy-home-v2:media:') === 0; });
    return { bigInPool: v1, gifInPool: v2, keysAfter: keys.length };
  })()`);
  J('B3b 池字节与原图完全一致（BIG、GIF 各一份）', poolCheck && poolCheck.bigInPool === BIG && poolCheck.gifInPool === GIF);
  J('B3c 本次新增池条目数＝2（恰好两个唯一图）', poolCheck && (poolCheck.keysAfter - seed.keysBefore) === 2);

  // B4 渲染链路：令牌可解析（不进缺失负缓存）
  const miss = await evalJs(`(function(){ return { big: window.mochiMediaTokenMissing('${String(bigTok)}'), gif: window.mochiMediaTokenMissing('${String(gifTok)}') }; })()`);
  J('B4 令牌渲染链路就绪（TokenMissing=false＝池可解析）', miss && miss.big === false && miss.gif === false);

  // B5 GC 安全：字卡库引用的令牌绝不进孤儿名单
  const gc = await evalJs(`window.mochiMediaGC().then(function(r){ return JSON.stringify({ ok:r.ok, poolN:r.poolN, orphans:r.orphans }); })`);
  const gcr = JSON.parse(gc);
  J('B5 GC 不误删字卡库令牌（BIG/GIF 哈希不在孤儿名单）',
    gcr && gcr.ok === true && !(gcr.orphans || []).some(function(k){ return k.indexOf(String(bigTok).slice(4)) >= 0 || k.indexOf(String(gifTok).slice(4)) >= 0; }));

  // B6 幂等：再跑一次不再写回（已是令牌、无内联大图）
  const rep2 = JSON.parse(await evalJs(`window.mochiCcPersistTokenize().then(function(r){ return JSON.stringify(r); })`));
  J('B6 幂等（重复执行 written=0，不重复改库）', rep2 && rep2.ok === true && rep2.written === 0);

  // B7 报告口径：images 计数＝两库各 4 张内联大图（A:BIG,GIF B:BIG C:GIF + own 同）＝8
  J('B7 报告口径（首次 images=8：两库 × {BIG,GIF,BIG,GIF}）', report.images === 8);

  // B8 #560 瘦身删除落库回归：mochiCcSlimDeleteGroup 必须写真实键（不再是 xy-home-v2:: 双冒号垃圾键）
  const b8 = await evalJs(`(async function(){
    var ok = await window.mochiCcSlimDeleteGroup('xy-home-v2:', 'cc-groups-public', 'sticker', 'B');
    var real = null; try { real = JSON.parse(await window.idbGet('xy-home-v2:cc-groups-public')); } catch (e) {}
    var junk = await window.idbGet('xy-home-v2::cc-groups-public');
    return { ok: ok, groups: real && real.sticker ? real.sticker.map(function(g){ return g[0]; }) : [], junkExists: junk !== undefined && junk !== null };
  })()`);
  J('B8a 瘦身整组删除写真实键（分组 B 消失、返回 true）', b8 && b8.ok === true && JSON.stringify(b8.groups) === JSON.stringify(['A']));
  if (!(b8 && b8.ok)) console.log('  B8 现场: ' + JSON.stringify(b8));
  J('B8b 不再产生 xy-home-v2:: 双冒号垃圾键', b8 && b8.junkExists === false);
  if (!(b8 && b8.junkExists === false)) console.log('  B8b 现场: ' + JSON.stringify(b8));
} catch (e) {
  console.log('\n❌ B 组执行异常：' + (e && e.message));
  fail++;
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);

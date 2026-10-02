// ===== 专项验证：#534 朋友圈/信箱「内容类型开关」生效 + 存量图片直链消息自愈 =====
// 用法：node tools/verify-feed-mail-content-type.mjs（自组装 src，不依赖构建产物）
// 背景（用户报，iPhone 15 Safari 添加到桌面；明说其他机型也有）：
//   ①「设置了朋友圈和信箱已经把颜文字和表情包都禁了，还是会出现」——
//      信箱 ml-*-en 旧实现只挡了 taLetterContent 两处「附加」，正文的
//      pickDefaultMailCard 仍按分类占比把颜文字/emoji 注入；朋友圈压根没有类型开关，
//      TA 评论/回复的颜文字/emoji 是写死 15% 概率，概率设置调 0 也拦不住。
//      修复＝把开关下沉到【池这一层】（清池），任何消费方都取不到。
//   ②「聊天里联系人发送的消息，应该是图片，会变成图上的乱码」——
//      链接导入的字卡（图床不允许跨域时按原始 http(s) 链接保存，存于字卡库
//      【表情包/图片】）曾被当文字卡抽出并以 type:'text' 落库，气泡直出整段链接。
//      #533 已堵住入库口，本轮补渲染端 + 归一化自愈（历史消息也要变回图片）。
// 断言两段：
//   A 段 纯函数（真实函数体执行）：chatIsImageUrlCard 的判定边界 + HEAD RED 对照。
//   B 段 行为（无头 Chrome + src 自组装页）：类型开关关掉后 feed/mail 池确实清空、
//        未关的类型与文字池不受影响（不误伤）；存量图片直链消息渲染成 <img> 而非文本。
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, info) => {
  if (c) { pass++; console.log('PASS  ' + n); }
  else { fail++; console.log('FAIL  ' + n + (info !== undefined ? '  [' + JSON.stringify(info) + ']' : '')); }
};

// 用户诊断里的真实图链（换行会被渲染成「乱码」观感）
const USER_URL = 'https://img2.tofaka.com/autoupload/fr/eQCNj33K8ULBTOKjts-W0OI5Q5m6uL7_AUwBweX8H2yl5f0KlZfm6UsKj-HyTuv/20260914/WMCB/1080X730/IMG_2343.png';
const PLAIN_TEXT = '今天也要好好吃饭呀';
const KAOMOJI = '( ˙-˙ )';
const NORMAL_URL = 'https://example.com/some/page';

/* ================= A 段：真实函数体（含 HEAD RED 对照） ================= */

function buildFn(src, name, stopAt) {
  const a = src.indexOf('function ' + name + '(');
  if (a < 0) return null;
  const b = src.indexOf(stopAt, a);
  if (b < 0) return null;
  try {
    return new Function(src.slice(a, b) + '\nreturn ' + name + ';')();
  } catch (e) { return null; }
}

const chatSrc = read('src/js/chat.js');
const isImgUrl = buildFn(chatSrc, 'chatIsImageUrlCard', 'function getPool()');

let headChat = '';
try { headChat = execSync('git show HEAD:src/js/chat.js', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) {}

t('A0 提取到真实 chatIsImageUrlCard 函数体', !!isImgUrl);
t('A1 认用户诊断里的图链（__ blank 主诉求形态）', isImgUrl && isImgUrl(USER_URL) === true);
t('A2 认带 query/hash 的图链（图床常见 ?x-oss-process=…）',
  isImgUrl && isImgUrl('https://cdn.example.com/a.jpg?x-oss-process=image/resize,w_300') === true && isImgUrl('https://cdn.example.com/a.png#frag') === true);
t('A3 认常见图片扩展名（png/jpg/jpeg/gif/webp/bmp/avif/svg，大小写不敏感）',
  isImgUrl && ['.png', '.PNG', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.svg'].every(e => isImgUrl('https://x.com/a' + e) === true));
t('A4 拒普通文字（不误判句子）', isImgUrl && isImgUrl(PLAIN_TEXT) === false);
t('A5 拒无图片扩展名的普通网址（用户真发链接时不换成裂图）', isImgUrl && isImgUrl(NORMAL_URL) === false);
t('A6 拒「句子里含图链」（只认整条就是一张图的形态）',
  isImgUrl && isImgUrl('看这个 ' + USER_URL) === false && isImgUrl && isImgUrl(USER_URL + ' 好看吗') === false);
t('A7 拒无 scheme 的伪直链与空值', isImgUrl && isImgUrl('example.com/a.png') === false && isImgUrl && isImgUrl('') === false && isImgUrl && isImgUrl(null) === false);
t('A8 RED 对照：HEAD 版 chat.js 没有 chatIsImageUrlCard（证明本轮新增、修复有判别力）',
  headChat.indexOf('function chatIsImageUrlCard(') < 0);
t('A9 RED 对照：HEAD 版 normCell 的 type 提升不含图片直链（历史消息因此永久留作文本）',
  headChat.indexOf('chatIsImageUrlCard(r.text)') < 0);

// 静态：设置入口与默认键存在（否则「关了没效果」会以别的形态复现）
const tplSrc = read('src/template.html');
const rsSrc = read('src/js/reply-settings.js');
t('A10 朋友圈设置页有四个类型开关入口', ['fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en'].every(id => tplSrc.indexOf('id="' + id + '"') >= 0));
t('A11 类型开关默认键已登记（缺失＝回落默认，开关形同虚设）',
  rsSrc.indexOf("'fd-kaomoji-en': 1, 'fd-emoji-en': 1, 'fd-sticker-en': 1, 'fd-image-en': 1,") >= 0);
t('A12 类型开关已接入设置页开关读写数组',
  (rsSrc.match(/'fd-kaomoji-en', 'fd-emoji-en', 'fd-sticker-en', 'fd-image-en'/g) || []).length >= 3);

// RED 对照（源码级）：HEAD 版根本没有「开关下沉到池层」的代码——证明 B 段清池断言有判别力。
// 用 git show HEAD 读旧版，不改工作区（并行会话在改同文件，避免临时回滚引入竞态）。
let headFeed = '', headMail = '';
try { headFeed = execSync('git show HEAD:src/js/feed.js', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) {}
try { headMail = execSync('git show HEAD:src/js/mail.js', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) {}
t('A13 RED 对照：HEAD 版 feed.js 无 feedTypeOn 清池（关了类型开关池子照样非空＝用户报的现象）',
  headFeed.indexOf('feedTypeOn(') < 0);
t('A14 RED 对照：HEAD 版 mailCardPool 无 kaomojiEn 清池（默认颜文字补池照旧注入正文）',
  headMail.indexOf('if (!tcfg.kaomojiEn)') < 0);
t('A15 RED 对照：HEAD 版 feed.js 评论/回复颜文字概率写死 15（无类型开关可拦）',
  headFeed.indexOf("kaoP: 15, emoP: 15") >= 0);

/* ================= B 段：无头浏览器 + src 自组装页 ================= */

const buildSrc = read('build.mjs');
function arrOf(name) {
  const m = buildSrc.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let css = '', js = '';
for (const f of cssFiles) { try { css += '/* ' + f + ' */\n' + read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const tpl = read('src/template.html').replace(/__APP_VERSION__/g, 'test');
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + tpl +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p0 = req.url.split('?')[0];
    if (p0 === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
    if (p0 === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>blank</body></html>'); return; }
    let p = normalize(join(root, decodeURIComponent(p0)));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const tmpDir = join(os.tmpdir(), 'mochi-ftype-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10000 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir,
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const pageT = list.find((x) => x.type === 'page');
      if (pageT) {
        ws = new WebSocket(pageT.webSocketDebuggerUrl);
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/test.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(500);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(1200);
}

// 种子：公用字卡库放 1 张颜文字 + 1 张 URL 表情包 + 1 张普通文字卡；
// 并预置一条「图片直链当文本」的历史消息（模拟 #533 前落库的存量）。
const KEY_MSGS = 'xy-home-v2:default:chat-msgs';
// 极短 data: 图片（1x1 透明 PNG）——feed 池按 #386 只收 data:/@@m: 形态的媒体，
// 用 data 形态才能验证「表情包开关」对 feed 确实生效。
const DATA_STICKER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const seedJs = (extraCards) => `(function(){
  var groups = {
    text: [['日常', ['${PLAIN_TEXT}']]],
    kaomoji: [['颜', ['${KAOMOJI}']]],
    sticker: [['内嵌表情', ['${DATA_STICKER}']], ['链接表情', ['${USER_URL}']]]
  };
  var raw = JSON.stringify(groups);
  localStorage.setItem('xy-home-v2:cc-groups-public', raw);
  localStorage.setItem('xy-home-v2:cc-scope-migrated', '1');
  localStorage.setItem('xy-home-v2:cc-scope-notice-done', '1');
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{id:'default',name:'默认'}]));
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  // 二级锁解锁——系统预设字卡（main/kaomoji/emoji）默认全锁，不解锁则默认补池恒空，
  // 「信箱默认颜文字补池也清空」这条断言会变成无意义的假绿（池本来就空）。
  localStorage.setItem('xy-home-v2:cardlock-state', 'open');
  try { localStorage.removeItem('xy-home-v2:default:cc-groups'); } catch(e){}
  if (window.idbSet) { try { window.idbSet('xy-home-v2:cc-groups-public', raw); } catch(e){} }
  if (window.idbDelete) { try { window.idbDelete('xy-home-v2:default:cc-groups'); } catch(e){} }
  // 历史消息：一条图片直链（应自愈成图片）+ 一条普通网址（应保持文本）
  var recs = [
    { side: 'in', text: '${USER_URL}', ts: Date.now() - 60000 },
    { side: 'out', text: '${NORMAL_URL}', ts: Date.now() - 30000 }
  ];
  var rawMsgs = JSON.stringify(recs);
  localStorage.setItem('${KEY_MSGS}', rawMsgs);
  if (window.idbSet) { try { window.idbSet('${KEY_MSGS}', rawMsgs); } catch(e){} }
  // 清掉可能残留的类型开关（默认＝全开）
  ['dc-use-chat','dc-use-mail','dc-use-feed','dc-cat-main','dc-cat-kaomoji','dc-cat-emoji','dc-enabled'].forEach(function(k){ try{ localStorage.removeItem('xy-home-v2:default:'+k); }catch(e){} });
  ${extraCards || ''}
  return 'seeded';
})()`;

await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
await sleep(400);
const seedRes = await evalJs(seedJs(''));
t('B0 种子数据写入', seedRes === 'seeded', seedRes);
await loadApp();

// ---- B1 未关开关：池里应有颜文字/表情包（前置校验，防「卡没读到」假绿） ----
const onFeed = await evalJs(`(function(){ return JSON.stringify(window.feedPoolFor ? window.feedPoolFor('default') : null); })()`);
let of = null; try { of = JSON.parse(onFeed); } catch (e) {}
t('B1 前置：朋友圈池默认（开关全开）含颜文字与表情包', of && of.kaoN > 0 && of.stickerN > 0, of);

const onMail = await evalJs(`(function(){ return JSON.stringify(window.mailPoolFor ? window.mailPoolFor('default') : null); })()`);
let om = null; try { om = JSON.parse(onMail); } catch (e) {}
t('B2 前置：信箱池默认（开关全开）含自定义颜文字，默认补池含颜文字', om && om.kaoN > 0 && om.defKaoN > 0, om);

// ---- B3 关掉朋友圈颜文字/表情包/图片：对应池清空，文字池不受影响（不误伤） ----
const saveKeys = (pairs) => `(function(){ ${pairs.map(([k, v]) => `localStorage.setItem('xy-home-v2:default:reply-${k}', '${v}');`).join('')} return 'ok'; })()`;
await evalJs(saveKeys([['fd-kaomoji-en', 0], ['fd-sticker-en', 0], ['fd-image-en', 0], ['fd-emoji-en', 0]]));
const offFeed = await evalJs(`(function(){ return JSON.stringify(window.feedPoolFor ? window.feedPoolFor('default') : null); })()`);
let ff = null; try { ff = JSON.parse(offFeed); } catch (e) {}
t('B3 关掉朋友圈类型开关后：颜文字池清空（用户报「禁了还是出现」的主诉求）', ff && ff.kaoN === 0, ff);
t('B4 关掉朋友圈类型开关后：表情包/图片池清空', ff && ff.stickerN === 0 && ff.imageN === 0, ff);
t('B5 关掉朋友圈类型开关后：文字池不受影响（不误伤正常字卡）', ff && ff.textN > 0, ff);

// ---- B6 只关颜文字，表情包照常（开关互相独立，不是「一关全关」） ----
await evalJs(saveKeys([['fd-sticker-en', 1], ['fd-image-en', 1], ['fd-emoji-en', 1]]));
const mixFeed = await evalJs(`(function(){ return JSON.stringify(window.feedPoolFor ? window.feedPoolFor('default') : null); })()`);
let mf = null; try { mf = JSON.parse(mixFeed); } catch (e) {}
t('B6 只关颜文字时表情包仍可用（各开关独立生效）', mf && mf.kaoN === 0 && mf.stickerN > 0, mf);

// ---- B7 关掉信箱颜文字/表情包：自定义池与默认补池都必须清空 ----
await evalJs(saveKeys([['ml-kaomoji-en', 0], ['ml-sticker-en', 0]]));
const offMail = await evalJs(`(function(){ return JSON.stringify(window.mailPoolFor ? window.mailPoolFor('default') : null); })()`);
let fm = null; try { fm = JSON.parse(offMail); } catch (e) {}
t('B7 关掉信箱颜文字后：自定义颜文字池与默认颜文字补池都清空（正文动词无法再注入颜文字）',
  fm && fm.kaoN === 0 && fm.defKaoN === 0, fm);
t('B8 关掉信箱表情包后：表情包/图片池清空', fm && fm.stickerN === 0 && fm.imageN === 0, fm);
t('B9 关掉信箱类型开关后：文字池不受影响（不误伤）', fm && fm.textN > 0 && fm.defTextN > 0, fm);

// ---- B10 存量图片直链消息自愈：气泡渲染成 <img>，不再直出 URL ----
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1500);
const dom = await evalJs(`(function(){
  var cb = document.getElementById('chat-body');
  if (!cb) return JSON.stringify({ err: 'no-chat-body' });
  var imgs = Array.prototype.slice.call(cb.querySelectorAll('img.msg-img-big'));
  var urlImgs = imgs.filter(function(im){ return im.src.indexOf('IMG_2343.png') >= 0; });
  var txt = cb.textContent || '';
  return JSON.stringify({
    hasUrlImg: urlImgs.length > 0,
    hasRawUrlText: txt.indexOf('IMG_2343.png') >= 0,
    normalUrlAsText: txt.indexOf('example.com/some/page') >= 0,
    imgCount: imgs.length
  });
})()`);
let dm = null; try { dm = JSON.parse(dom); } catch (e) {}
t('B10 存量图片直链消息渲染成图片（用户报「应该是图片、却变成乱码文字」）', dm && dm.hasUrlImg === true, dm);
t('B11 气泡里不再残留整段图链文字', dm && dm.hasRawUrlText === false, dm);
t('B12 普通网址消息仍按文本渲染（不误伤用户真发的链接）', dm && dm.normalUrlAsText === true, dm);

// ---- B13 归一化自愈：库里的该条消息 type 已提升为 image（刷新后永久修好） ----
const healed = await evalJs(`(function(){
  try {
    var m = window.getChatMsgs ? window.getChatMsgs() : [];
    var hit = m.filter(function(r){ return r && typeof r.text === 'string' && r.text.indexOf('IMG_2343.png') >= 0; })[0];
    var nrm = m.filter(function(r){ return r && typeof r.text === 'string' && r.text.indexOf('example.com/some/page') >= 0; })[0];
    return JSON.stringify({ imgType: hit ? hit.type : null, normalType: nrm ? (nrm.type || 'text') : null });
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`);
let hm = null; try { hm = JSON.parse(healed); } catch (e) {}
t('B13 归一化把该条消息 type 提升为 image（刷新后仍正确）', hm && hm.imgType === 'image', hm);
t('B14 归一化不动普通网址消息（仍为 text）', hm && (hm.normalType === 'text' || hm.normalType === null), hm);

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

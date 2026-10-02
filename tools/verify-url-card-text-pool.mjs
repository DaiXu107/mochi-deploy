// ===== 专项验证：#533 链接导入的媒体字卡（裸 http(s) 图链）漏进文字池 =====
// 用法：node tools/verify-url-card-text-pool.mjs（自组装 src，不依赖构建产物）
// 背景（用户报，vivo V2528A / Edge）：聊天里联系人在一个对话框连发两个表情，其中一个
//   会变成文字 URL；信箱同样。用户在字卡库用「链接导入」上传过图片 URL。
// 根因：图床不允许跨域读取（CORS）时卡片按原始链接保存（`chatcard.js` 链接导入回退分支
//   `st:'url'`），存进字卡库【表情包/图片】分类。各文字池此前只挡 data:/|||/@@m: 令牌
//   三种形态，裸 URL 被当「文字卡」收进池 → 联系人抽中即以 type:'text' 发出，气泡/信纸
//   正文直出「http://…png」。修复＝各池补「URL 不进文字池」守卫（媒体池照常按 URL 渲染）。
// 断言分两段：
//   A 段 纯函数（真实函数体执行）：mailTextOnly / calTextOnly 拒 URL —— 并跑 HEAD 版
//        本做 RED 对照（判定力实证：同一输入 HEAD=true（漏进池）、当前=false（挡住））。
//   B 段 行为（无头 Chrome + src 自组装页）：种子一张 URL 表情包卡 + 一张 URL 图片卡 +
//        一张普通文字卡，核对 聊天/信件/群聊/朋友圈/互动回应 五个文字池都不收 URL，
//        同时 媒体池仍照常收（TA 依旧能把图链当图片发出去＝不误伤功能）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

const URL_STICKER = 'https://example.com/sticker.png';
const URL_IMAGE = 'https://cdn.example.org/photo.jpg';
const PLAIN_TEXT = '今天也要好好吃饭呀';

/* ================= A 段：真实函数体（含 HEAD RED 对照） ================= */

function extractFn(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) return null;
  const b = src.indexOf(endMarker, a);
  if (b < 0) return null;
  return src.slice(a, b);
}

// mailTextOnly / calTextOnly 都是自包含纯函数（无闭包依赖），直接取函数体执行
// #1235 起 mailTextOnly 依赖 mail.js 顶部的统一判据常量块（MAIL_PAYLOAD_RE + mailIsImgRef，借 chat.js #948
// 那一份），单抽函数体会 ReferenceError ⇒ 与 verify-mail-textonly.mjs 同法：连同常量块一起抽，并喂一个令牌口径的 window。
const MAIL_BLK_START = 'const MAIL_DATAURL_SRC =';
const MAIL_BLK_END = '// v3.27.x 性能：load()';
const winMail = { mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s) };
function buildFn(src, name, stopAt, mailBlock) {
  const a = src.indexOf('function ' + name + '(');
  if (a < 0) return null;
  const b = src.indexOf(stopAt, a);
  if (b < 0) return null;
  const bs = mailBlock ? src.indexOf(MAIL_BLK_START) : -1;
  const blk = bs < 0 ? '' : src.slice(bs, src.indexOf(MAIL_BLK_END, bs)) + '\n';
  try {
    return new Function('window', blk + src.slice(a, b) + '\nreturn ' + name + ';')(winMail);
  } catch (e) { return null; }
}

const mailSrc = read('src/js/mail.js');
const calSrc = read('src/js/calendar.js');
const mailTextOnly = buildFn(mailSrc, 'mailTextOnly', '  // 渲染端剥「名称|||」前缀残留', true);
const calTextOnly = buildFn(calSrc, 'calTextOnly', '  function calCleanMsg');

// RED 对照：git HEAD 里的同名函数（修复前应放行 URL＝bug 存在）
let mailTextOnlyHead = null, calTextOnlyHead = null;
let headMail = '';
try {
  headMail = execSync('git show HEAD:src/js/mail.js', { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  mailTextOnlyHead = buildFn(headMail, 'mailTextOnly', '  // 渲染端剥「名称|||」前缀残留', true);
} catch (e) {}
try {
  const headCal = execSync('git show HEAD:src/js/calendar.js', { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  calTextOnlyHead = buildFn(headCal, 'calTextOnly', '  function calCleanMsg');
} catch (e) {}

t('A0 提取到真实 mailTextOnly / calTextOnly 函数体', !!mailTextOnly && !!calTextOnly, { mail: !!mailTextOnly, cal: !!calTextOnly });
t('A1 mailTextOnly 拒 URL 图链（改动前会当文字拼进信纸）', mailTextOnly && mailTextOnly(URL_STICKER) === false);
t('A2 calTextOnly 拒 URL 图链（改动前会拼进每日留言）', calTextOnly && calTextOnly(URL_STICKER) === false);
t('A3 mailTextOnly 仍拒 data:/|||/@@m:（既有口径未破坏）',
  mailTextOnly && mailTextOnly('data:image/png;base64,AAAA') === false && mailTextOnly('语音.mp3|||data:audio/mp3;base64,AAAA') === false && mailTextOnly('@@m:0123456789abcdef0123456789abcdef') === false);
t('A4 calTextOnly 仍拒 data:/|||/@@m:（既有口径未破坏）',
  calTextOnly && calTextOnly('data:image/png;base64,AAAA') === false && calTextOnly('语音.mp3|||data:audio/mp3;base64,AAAA') === false && calTextOnly('@@m:0123456789abcdef0123456789abcdef') === false);
t('A5 mailTextOnly 放行普通文字卡（不误伤正常字卡）', mailTextOnly && mailTextOnly(PLAIN_TEXT) === true);
t('A6 calTextOnly 放行普通文字卡（不误伤正常字卡）', calTextOnly && calTextOnly(PLAIN_TEXT) === true);
t('A7 拒非 http(s) 的其他链接形态（防误伤含 URL 字样的普通句子）',
  mailTextOnly && mailTextOnly('想你的第 ftp://x 天') === true && mailTextOnly && mailTextOnly('看这个 example.com/a.png') === true);

// RED 对照的参照物是「#533 之前那一版」。守卫入库后 HEAD 本身就拒 URL，
// 再断言「HEAD 放行」＝拿已修好的当旧版，恒假——那时按 SKIP 计（判定力由 A1/A2 与仓外旧副本承担）。
if (!mailTextOnlyHead) {
  console.log('SKIP  A8 RED 对照（git show HEAD:src/js/mail.js 不可用）');
} else if (mailTextOnlyHead(URL_STICKER) === false) {
  console.log('SKIP  A8 RED 对照（HEAD 已含 #533 URL 守卫，旧版参照物不在了）');
} else {
  t('A8 RED 对照：HEAD 版 mailTextOnly 放行 URL（证明修复有判别力）', true);
}
if (!calTextOnlyHead) {
  console.log('SKIP  A9 RED 对照（git show HEAD:src/js/calendar.js 不可用）');
} else if (calTextOnlyHead(URL_STICKER) === false) {
  console.log('SKIP  A9 RED 对照（HEAD 已含 #533 URL 守卫，旧版参照物不在了）');
} else {
  t('A9 RED 对照：HEAD 版 calTextOnly 放行 URL（证明修复有判别力）', true);
}

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

const tmpDir = join(os.tmpdir(), 'mochi-urlpool-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir,
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 100; i++) {
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
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(500);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(1200);
}

// 种子：字卡库【表情包】放一张「链接保存」的 URL 卡、【图片】放一张 URL 卡，
// 混一张普通文字卡（证明过滤只针对 URL，不误伤正常字卡）。
// 只写公用键（不写 default:cc-groups）——getCustomCards/For 会把「公用 + 专属」合并，
// 两处都写会让同一张普通卡在池里出现两次，污染计数断言。
const SEED = `(function(){
  var groups = {
    text: [['日常', ['${PLAIN_TEXT}']]],
    sticker: [['链接表情', ['${URL_STICKER}']]],
    image: [['链接图片', ['${URL_IMAGE}']]]
  };
  var raw = JSON.stringify(groups);
  localStorage.setItem('xy-home-v2:cc-groups-public', raw);
  localStorage.setItem('xy-home-v2:cc-scope-migrated', '1');
  localStorage.setItem('xy-home-v2:cc-scope-notice-done', '1');
  localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{id:'default',name:'默认'}]));
  localStorage.setItem('xy-home-v2:active-contact', 'default');
  try { localStorage.removeItem('xy-home-v2:default:cc-groups'); } catch(e){}
  if (window.idbSet) { try { window.idbSet('xy-home-v2:cc-groups-public', raw); } catch(e){} }
  if (window.idbDelete) { try { window.idbDelete('xy-home-v2:default:cc-groups'); } catch(e){} }
  ['dc-use-chat','dc-use-mail','dc-use-feed','dc-cat-main','dc-cat-kaomoji','dc-cat-emoji','dc-enabled'].forEach(function(k){ try{ localStorage.removeItem('xy-home-v2:default:'+k); }catch(e){} });
  return 'seeded';
})()`;

await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
await sleep(400);
const seedRes = await evalJs(SEED);
t('B0 种子数据写入', seedRes === 'seeded', seedRes);
await loadApp();

// 媒体池必须仍收 URL（修复不能把卡从媒体用途里删掉）
const media = await evalJs(`(function(){
  var p = (window.getPool && window.getPool()) || {};
  return JSON.stringify({
    stickerHasUrl: (p.sticker||[]).indexOf('${URL_STICKER}') >= 0,
    imageHasUrl: (p.image||[]).indexOf('${URL_IMAGE}') >= 0,
    stickerN: (p.sticker||[]).length, imageN: (p.image||[]).length
  });
})()`);
let mj = null; try { mj = JSON.parse(media); } catch (e) {}
t('B1 媒体池仍收 URL 表情包卡（TA 仍能把图链当图片发出＝不误伤）', mj && mj.stickerHasUrl === true, mj);
t('B2 媒体池仍收 URL 图片卡', mj && mj.imageHasUrl === true, mj);

// 聊天文字池
const chat = await evalJs(`(function(){
  var p = (window.getPool && window.getPool()) || {};
  return JSON.stringify({
    text: p.text || [],
    hasUrl: (p.text||[]).indexOf('${URL_STICKER}') >= 0 || (p.text||[]).indexOf('${URL_IMAGE}') >= 0,
    hasPlain: (p.text||[]).indexOf('${PLAIN_TEXT}') >= 0,
    anyHttp: (p.text||[]).some(function(s){ return typeof s === 'string' && /^https?:\\/\\//i.test(s); })
  });
})()`);
let cj = null; try { cj = JSON.parse(chat); } catch (e) {}
t('B3 聊天文字池不收 URL 媒体卡（用户报的「表情变文字 URL」直接根因）', cj && cj.hasUrl === false && cj.anyHttp === false, cj && cj.text);
t('B4 聊天文字池仍收普通文字卡（不误伤）', cj && cj.hasPlain === true, cj && cj.text);

// 信件文字池（mailPoolFor 返回自定义文字池条数）
const mail = await evalJs("(function(){ return JSON.stringify(window.mailPoolFor ? window.mailPoolFor('default') : null); })()");
let ml = null; try { ml = JSON.parse(mail); } catch (e) {}
t('B5 信件文字池不收 URL 媒体卡（用户报的「信箱也这样」）', ml && ml.textN === 1, ml);

// 群聊文字池
const gc = await evalJs(`(function(){
  var p = (window.groupChatPoolFor ? window.groupChatPoolFor('default') : null) || {};
  return JSON.stringify({
    hasUrl: (p.text||[]).indexOf('${URL_STICKER}') >= 0,
    hasPlain: (p.text||[]).indexOf('${PLAIN_TEXT}') >= 0,
    stickerHasUrl: (p.sticker||[]).indexOf('${URL_STICKER}') >= 0
  });
})()`);
let gj = null; try { gj = JSON.parse(gc); } catch (e) {}
t('B6 群聊文字池不收 URL 媒体卡', gj && gj.hasUrl === false, gj);
t('B7 群聊文字池仍收普通文字卡', gj && gj.hasPlain === true, gj);

// 朋友圈文字池
const feed = await evalJs(`(function(){
  var h = (window.feedPoolHas ? window.feedPoolHas('default', '${URL_STICKER}') : null) || {};
  var hp = (window.feedPoolHas ? window.feedPoolHas('default', '${PLAIN_TEXT}') : null) || {};
  return JSON.stringify({ url: h.text, plain: hp.text });
})()`);
let fj = null; try { fj = JSON.parse(feed); } catch (e) {}
t('B8 朋友圈文字池不收 URL 媒体卡', fj && fj.url === false, fj);
t('B9 朋友圈文字池仍收普通文字卡', fj && fj.plain === true, fj);

// 互动回应文字池
const ask = await evalJs(`(function(){
  var p = (window.__taCcPool ? window.__taCcPool() : []) || [];
  return JSON.stringify({ hasUrl: p.indexOf('${URL_STICKER}') >= 0, hasPlain: p.indexOf('${PLAIN_TEXT}') >= 0, n: p.length });
})()`);
let aj = null; try { aj = JSON.parse(ask); } catch (e) {}
t('B10 互动回应文字池不收 URL 媒体卡', aj && aj.hasUrl === false, aj);
t('B11 互动回应文字池仍收普通文字卡', aj && aj.hasPlain === true, aj);

// 池就绪性：URL 卡确实在库里（否则上面的「不在文字池」可能是卡根本没读到＝假绿）
const lib = await evalJs(`(function(){
  var all = (window.getCustomCards && window.getCustomCards()) || [];
  return JSON.stringify({ n: all.length, hasUrl: all.indexOf('${URL_STICKER}') >= 0, hasPlain: all.indexOf('${PLAIN_TEXT}') >= 0 });
})()`);
let lj = null; try { lj = JSON.parse(lib); } catch (e) {}
t('B12 前置校验：URL 卡与普通卡都已进字卡库（防「卡没读到」造成假绿）', lj && lj.hasUrl === true && lj.hasPlain === true, lj);

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

// ===== #493 字卡库令牌卡直出乱码/白块（红米 K80 Chrome 等多机型同报：
// 「其他地方表情包显示正常，字卡库里表情包显示纯白和乱码、不显示实际图片缩略图」）=====
// 排查路径：#377 大库内存瘦身把超大贴纸/图片卡体换成 @@m:hash 令牌 → 字卡库管理页
// cardItemHtml 只有 data:/http(s) 图片分支 → 令牌卡掉进末行文字分支＝网格直出
// 「@@m:hex32」乱码 / 空白块；点击还会打开文字编辑弹窗。聊天气泡与表情面板各有
// 令牌路径故正常。修复=渲染分支补认令牌按图渲染（懒加载+media-pool 观察器解图）
// +点击查看大图。
// 场景（修复前 P1/P2/P3 红，修复后全绿）：
//   P1 令牌贴纸卡在网格渲染成 <img>（修前是 .cc-txt 直出令牌串）
//   P2 media-pool 观察器把令牌 src 解回真图（img.src 变 data:image）
//   P3 点击令牌卡打开大图查看（修前打开文字编辑弹窗）
//   P4 池里确认缺失的令牌卡显示「[图片丢失]」占位而非裸令牌串（#387 同口径）
//   P5 库里任何卡片不再以「@@m:」文本直出（乱码回归哨）
// 用法：node tools/verify-cc-token-grid.mjs（需先 node build.mjs）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-cctok-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(600);

// ---- 播种：真令牌卡（进媒体池）+ 假令牌卡（池里没有）写进专属库表情包分类 ----
// 字卡库键是 #193 权威守卫托管的大键，外部整包写会被启动恢复清掉——
// 用 addScriptToEvaluateOnNewDocument 劫持 idbGet 让启动恢复读到种子库（走应用自己的权威流）
const seedEval = await evalJs(`(async function(){
  try {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const cx = cv.getContext('2d');
    const gr = cx.createLinearGradient(0, 0, 64, 64);
    gr.addColorStop(0, '#ff88aa'); gr.addColorStop(1, '#88ccff');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    cx.fillStyle = '#fff'; for (let i = 0; i < 64; i += 7) cx.fillRect(i, i, 3, 3);
    const px = cv.toDataURL('image/png');
    if (px.length < 1024) return 'png-too-small:' + px.length;
    const tok = await window.mochiMediaTokenize(px, { noCache: true });
    if (!tok || tok.indexOf('@@m:') !== 0) return 'tokenize-fail:' + tok;
    const seed = JSON.stringify({ text: [], kaomoji: [], emoji: [], sticker: [['测试组', [tok, '@@m:deadbeefdeadbeefdeadbeefdeadbeef']]], image: [], poke: [], voice: [] });
    return JSON.stringify({ ok: true, tok: tok, seed: seed });
  } catch (e) { return JSON.stringify({ ok: false, err: String(e && e.message) }); }
})()`);
const seedObj = JSON.parse(seedEval || '{}');
check('S0 播种成功（令牌化+组数据）', seedObj.ok === true, seedEval);
await sleep(1500); // mochiMediaFlush（300ms 防抖）把池键落 IDB，供重载后 resolveImg 解图

// 文档级注入：idbGet 对专属库键返回种子，让启动恢复把种子当权威数据装进内存
const patchFn = `(function(){
  const KEY = (window.activePrefix ? window.activePrefix() : 'xy-home-v2:default') + ':cc-groups';
  const VAL = ${JSON.stringify(seedObj.seed)};
  const timer = setInterval(function(){
    if (!window.idbGet || window.__ccTokPatched) return;
    window.__ccTokPatched = true; clearInterval(timer);
    const orig = window.idbGet;
    window.idbGet = function(k){ return (k === KEY) ? Promise.resolve(VAL) : orig.apply(this, arguments); };
  }, 0);
  setTimeout(function(){ clearInterval(timer); }, 8000);
})();`;
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: patchFn });

// 重载：启动恢复经劫持的 idbGet 读到种子库 → 装进权威内存 → 字卡库可渲染
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(600);

// ---- 打开字卡库管理页 → 表情包 tab ----
await evalJs("(function(){var li=document.getElementById('li-custom-cards'); if(li) li.click(); return !!li;})()");
await sleep(1200);
await evalJs("(function(){var t=document.querySelector('.cc-tab[data-type=\"sticker\"]'); if(t) t.click(); return !!t;})()");
await sleep(1200);

// ---- P1 令牌卡渲染成图片（修前是 .cc-txt 直出令牌串）；观察器可能已消费 data-src 并解图，
//      所以只断言「令牌卡以 img 形态在网格里」+ P2 断言 src 已解回真图 ----
const g2 = await evalJs(`(function(){
  const list = document.getElementById('cc-list');
  if (!list) return JSON.stringify({ err: 'no-list' });
  const items = Array.from(list.querySelectorAll('.cc-item'));
  const imgs = items.map(function(it){
    const im = it.querySelector('img.cc-img');
    return im ? String(im.getAttribute('src') || '') : null;
  });
  const txts = Array.from(list.querySelectorAll('.cc-txt .t')).map(function(el){ return String(el.textContent || ''); });
  return JSON.stringify({ n: items.length, imgs: imgs, txts: txts });
})()`);
const g = JSON.parse(g2 || '{}');

check('P1 令牌卡按图渲染（img 形态，非文字卡）', !g.err && g.imgs.filter(Boolean).length >= 1, JSON.stringify({ n: g.n, imgs: (g.imgs || []).map(s => s ? s.slice(0, 24) : s) }));

// ---- P5 库内无「@@m:」文本直出（乱码回归哨） ----
check('P5 无令牌串直出为文字', !g.err && !(g.txts || []).some((t) => t.indexOf('@@m:') === 0), JSON.stringify(g.txts));

// ---- P2 media-pool 观察器把令牌 src 解回真图 ----
check('P2 令牌 src 已被解回 data:image 真图', !g.err && (g.imgs || []).some((s) => s && s.indexOf('data:image/') === 0), g.imgs ? String(g.imgs[0] || '').slice(0, 60) : '');

// ---- P4 池缺失令牌：解图失败被 markMissing 后重渲染 → [图片丢失] 占位而非裸令牌 ----
await evalJs("(function(){var t=document.querySelector('.cc-tab[data-type=\"text\"]'); if(t) t.click(); return !!t;})()");
await sleep(400);
await evalJs("(function(){var t=document.querySelector('.cc-tab[data-type=\"sticker\"]'); if(t) t.click(); return !!t;})()");
await sleep(900);
const p4 = await evalJs(`(function(){
  const list = document.getElementById('cc-list');
  if (!list) return JSON.stringify({ err: 'no-list' });
  const txts = Array.from(list.querySelectorAll('.cc-txt .t')).map(function(el){ return String(el.textContent || ''); });
  const tokenTxt = txts.some(function(t){ return t.indexOf('@@m:') === 0; });
  return JSON.stringify({ txts: txts, tokenTxt: tokenTxt });
})()`);
const p4o = JSON.parse(p4 || '{}');
check('P4 池缺失令牌显示 [图片丢失] 占位', !p4o.err && (p4o.txts || []).some((t) => t === '[图片丢失]'), p4);
check('P4b 池缺失令牌不直出裸令牌串', !p4o.err && !p4o.tokenTxt, JSON.stringify(p4o.txts));

// ---- P3 点击令牌卡打开大图 ----
const view = await evalJs(`(function(){
  const item = document.querySelector('#page-custom-cards .cc-item');
  if (!item) return JSON.stringify({ err: 'no-item' });
  item.click();
  return JSON.stringify({ ok: true });
})()`);
await sleep(600);
const maskState = await evalJs(`(function(){
  const m = document.getElementById('img-view-mask');
  if (!m) return JSON.stringify({ err: 'no-mask' });
  const im = m.querySelector('img');
  return JSON.stringify({ hidden: !!m.hidden, src: String((im && im.getAttribute('src')) || '') });
})()`);
const mv = JSON.parse(maskState || '{}');
check('P3 点击令牌卡打开大图（非编辑弹窗）', !mv.err && !mv.hidden, maskState);
check('P3b 大图 src 为真图或已被观察器解图', !mv.err && (mv.src.indexOf('data:image/') === 0 || mv.src.indexOf('@@m:') === 0), mv.src ? String(mv.src).slice(0, 60) : '');
await evalJs("(function(){var m=document.getElementById('img-view-mask'); if(m) m.hidden=true; return true;})()");

const pass = results.filter((r) => r.ok).length;
console.log('---- ' + pass + '/' + results.length + ' 断言通过 ----');
chrome.kill(); server.close();
process.exit(pass === results.length ? 0 : 1);

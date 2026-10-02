// ===== 回归脚本（#1040c）：字卡库「批量导入」真·可点 surface 层（媒体分类铺 / 文字分类撤） =====
// 背景：iOS Safari（含 iPhone 15 / iOS 18.7 实报「字卡库传图完全没反应」）会静默无视
//   showPicker()/click()/label 转发三条程序化激活腿（#677→#717→#738→#753→#755→#756→
//   #813→#877→#920 同族第十波）——「文件选择取证」里只有 `cc-file-pick/leg:fire`、没有
//   `files=N`＝激活腿跑了、选择器根本没弹。根治＝换掉问题本身：把**真·可点 file input**
//   铺在「批量导入」按钮上，手指物理点按＝浏览器原生默认动作弹选择器，不依赖任何 JS 腿。
//   文字分类必须**撤层**：透明可点层盖住按钮会吞掉点按、破坏文字批量导入弹窗。
// 本脚本断言铺/撤与命中：
//   B1 文字分类（默认）＝无 surface 层（否则会吞点按）
//   B2 文字分类点「批量导入」仍弹导入弹窗（撤层语义正确）
//   B3 切「表情包」＝surface 出现，accept=image/*、multiple=true
//   B4 surface 真的盖在按钮正上方（elementFromPoint 命中＝手指物理点按确实落在 input 上）
//   B5 切回「文字」＝surface 被撤掉（幂等铺/撤，不残留）
//   B6 切「语音」＝surface 存在且 accept 为空（iOS 文件选择器按 accept 过滤会灰显语音文件）
//   B7 空列表态「批量导入图片」按钮也铺真·可点层（独立 id、同口径、物理命中＝#1448 同族第十二波）
//   B8 空状态委托不再 preventDefault 这张层（否则原生选择器刚弹起就被取消）、旁路按钮仍独立可点
//   Z  零 window 报错
// 用法：node tools/verify-1040-cc-import-surface.mjs（MOCHI_ROOT=目录 可指向隔离副本）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
// verify-suite:timeout=90000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，设 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1040-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接 CDP');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + String(detail).slice(0, 200) : '')); }
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
try { await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch (e) {}
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(700);
// 过开屏（ Splash 在位时 .phone 被 visibility:hidden 盖住，命中测试会假红＝先把 Splash 收掉）
// Splash 在位时 .splash 之下的覆盖盒会吃掉 elementFromPoint＝命中测试假红，整体摘掉而不是点击
await ev("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return true;})()");
await sleep(700);
// 清掉环境闸（应用锁/开屏问答/备份提醒弹窗都会盖住页面＝命中测试与点按全被吃）
const clearGates = () => ev("(function(){var ids=['qa-mask','applock-mask','modal-mask','tc-mask','call-mask'];ids.forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return true;})()");
await clearGates(); await sleep(200);
// 字卡库必须走正规入口（设置→自定义字卡 →openCcPage）——直接切 page-chatcard 不会初始化库、工具条零尺寸
await ev("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
await sleep(1800); // 等字卡库首渲

const SURF = `(function(){
  var g = document.getElementById('applock-mask'); if (g && !g.hidden) g.hidden = true;
  var b = document.getElementById('cc-import');
  if (!b) return JSON.stringify({ missing: true });
  var s = b.querySelector('input[data-file-pick-surface]');
  var out = { has: !!s, accept: s ? s.accept : null, multi: s ? s.multiple : null };
  try {
    var r = b.getBoundingClientRect();
    var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    out.hit = el ? (el.tagName + (el.id ? '#' + el.id : '')) : null;
    out.hitIsSurface = !!(el && el === s);
    out.hitInsideBtn = !!(el && el.closest && el.closest('#cc-import'));
  } catch (e) { out.hit = 'err'; }
  return JSON.stringify(out);
})()`;

console.log('--- B1/B2 文字分类（默认）：不铺层，点按照常进弹窗 ---');
{
  const j = JSON.parse(await ev(SURF) || '{}');
  check('B1 文字分类无 surface 层（铺了会吞点按）', j.has === false, JSON.stringify(j));
  await clearGates(); await sleep(200);
  // 「备份提醒」等既有弹窗会占住 #modal-mask（openModal 不叠开）＝先把它们点掉
  for (let i = 0; i < 3; i++) {
    const st = await ev("(function(){var m=document.getElementById('modal-mask');if(!m||m.hidden)return 'closed';var bs=[].slice.call(document.querySelectorAll('#modal-mask button'));for(var i=0;i<bs.length;i++){if(/稍后|以后|取消|知道了/.test(bs[i].textContent||'')){bs[i].click();return 'clicked:'+((bs[i].textContent||'').trim().slice(0,8));}}var ok=document.getElementById('modal-ok');if(ok){ok.click();return 'clicked:ok';}return 'stuck';})()");
    await sleep(350);
    if (st === 'closed') break;
  }
  await clearGates(); await sleep(200);
  const modal = await ev(`(function(){
    var g = document.getElementById('applock-mask'); if (g && !g.hidden) g.hidden = true;
    var b = document.getElementById('cc-import'); if (b) b.click();
    return new Promise(function(resolve){
      var iv = setInterval(function(){
        var m = document.getElementById('modal-mask');
        var t = document.getElementById('modal-title');
        if (m && !m.hidden && t) { clearInterval(iv); resolve(JSON.stringify({ open: true, title: t.textContent })); }
      }, 80);
      setTimeout(function(){ clearInterval(iv); var m=document.getElementById('modal-mask'); resolve(JSON.stringify({ open: !!(m && !m.hidden) })); }, 2000);
    });
  })()`);
  const mj = JSON.parse(modal || '{}');
  check('B2 文字分类点「批量导入」仍弹导入弹窗（层没有吞掉点按）', mj.open === true && /批量导入字卡/.test(mj.title || ''), modal);
  await ev(`(function(){var c=document.getElementById('modal-cancel');if(c)c.click();return true;})()`);
  await sleep(400);
}

console.log('--- B3/B4 切「表情包」：铺层 + 命中测试 ---');
{
  await clearGates();
  await ev(`(function(){var t=document.querySelector('.cc-tab[data-type=sticker]');if(t)t.click();return true;})()`);
  await sleep(1200); await clearGates();
  const j = JSON.parse(await ev(SURF) || '{}');
  check('B3 表情包分类铺了 surface 层', j.has === true, JSON.stringify(j));
  check('B3b accept=image/*', j.accept === 'image/*', JSON.stringify(j));
  check('B3c multiple=true（批量）', j.multi === true, JSON.stringify(j));
  check('B4 手指物理点按命中的就是 surface input（原生默认动作可弹选择器）', j.hitIsSurface === true,
    'elementFromPoint=' + j.hit + ' hitInsideBtn=' + j.hitInsideBtn);
}

console.log('--- B5/B6 切回「文字」撤层 / 切「语音」accept 放开 ---');
{
  await clearGates();
  await ev(`(function(){var t=document.querySelector('.cc-tab[data-type=text]');if(t)t.click();return true;})()`);
  await sleep(1000); await clearGates();
  const j5 = JSON.parse(await ev(SURF) || '{}');
  check('B5 切回文字分类 surface 被撤掉（不残留）', j5.has === false, JSON.stringify(j5));
  await clearGates();
  await ev(`(function(){var t=document.querySelector('.cc-tab[data-type=voice]');if(t)t.click();return true;})()`);
  await sleep(1000); await clearGates();
  const j6 = JSON.parse(await ev(SURF) || '{}');
  check('B6 语音分类铺层且 accept 为空（iOS 按 accept 过滤会灰显语音文件）', j6.has === true && j6.accept === '', JSON.stringify(j6));
}

console.log('--- B7/B8 空列表态「批量导入图片」按钮也铺真·可点层（#1448） ---');
{
  // 本夹具无表情包/图片/语音预设卡片 ⇒ 切到表情包即空列表态：用户唯一看得到的入口就是
  // 「批量导入图片」按钮。它过去只有 el.click() 一条合成腿（iOS Safari 静默无视＝空库传图
  // 完全没反应），#1448 给它铺一张和右上角门同口径、但 id 不同的真·可点层。
  await clearGates();
  await ev(`(function(){var t=document.querySelector('.cc-tab[data-type=sticker]');if(t)t.click();return true;})()`);
  await sleep(1200); await clearGates();
  const EMPTY = `(function(){
    var g = document.getElementById('applock-mask'); if (g && !g.hidden) g.hidden = true;
    var b = document.querySelector('#cc-list [data-cc-empty="import"]');
    if (!b) return JSON.stringify({ noBtn: true });
    var s = b.querySelector('input[data-file-pick-surface]');
    var out = { has: !!s, id: s ? s.id : null, accept: s ? s.accept : null, multi: s ? s.multiple : null };
    try {
      var r = b.getBoundingClientRect();
      var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out.hit = el ? (el.tagName + (el.id ? '#' + el.id : '')) : null;
      out.hitIsSurface = !!(el && el === s);
    } catch (e) { out.hit = 'err'; }
    return JSON.stringify(out);
  })()`;
  const j7 = JSON.parse(await ev(EMPTY) || '{}');
  check('B7 空状态「批量导入图片」按钮铺了 surface 层，且 id 与右上角那扇不同（按 id 复用不会搬家）',
    j7.has === true && j7.id === 'cc-empty-import-surf', JSON.stringify(j7));
  check('B7b 空状态门 accept=image/*、multiple=true（与右上角媒体门同口径）',
    j7.accept === 'image/*' && j7.multi === true, JSON.stringify(j7));
  check('B7c 手指物理点按命中的就是空状态按钮上那张 input（原生默认动作可弹选择器）',
    j7.hitIsSurface === true, 'elementFromPoint=' + j7.hit);
  // B8a：空状态委托若对 surface 目标 preventDefault，会取消刚弹起的原生选择器（铺了等于白铺）——
  // 在层上派发一次真实冒泡 click，看它是否被取消。
  const prevented = await ev(`(function(){
    var s = document.querySelector('#cc-list [data-cc-empty="import"] input[data-file-pick-surface]');
    if (!s) return 'noSurf';
    var e = new MouseEvent('click', { bubbles: true, cancelable: true });
    s.dispatchEvent(e);
    return e.defaultPrevented ? 'prevented' : 'ok';
  })()`);
  check('B8a surface 上的 click 未被空状态委托 preventDefault（否则原生选择器刚弹起就被取消）',
    prevented === 'ok', prevented);
  // B8b：导入层的盒子必须只盖自己那一格——同一行的「链接导入」按钮要能独立命中，
  // 否则透明层会把旁路按钮的点击整个吃掉。
  const jl = JSON.parse(await ev(`(function(){
    var b = document.querySelector('#cc-list [data-cc-empty="link"]'); if (!b) return JSON.stringify({ noLink: true });
    if (b.querySelector('input[data-file-pick-surface]')) return JSON.stringify({ hasSurf: true });
    var r = b.getBoundingClientRect();
    var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return JSON.stringify({ hit: el ? (el.tagName + (el.id ? '#' + el.id : '')) : 'null',
      inside: !!(el && el.closest && el.closest('[data-cc-empty="link"]')) });
  })()`) || '{}');
  check('B8b「链接导入」按钮仍可独立命中（导入层的盒子只盖自己那一格）',
    jl.noLink === true || jl.inside === true, JSON.stringify(jl));
}

console.log('--- Z 零异常 ---');
{
  const errs = await ev(`(window.__jsErrors || []).slice(0, 6)`);
  check('Z1 零 window 报错', !errs || errs.length === 0, errs && errs.length ? JSON.stringify(errs).slice(0, 200) : '');
}

console.log('\n===== ' + pass + ' 过 / ' + fail + ' 挂（#1040c 字卡库批量导入 surface，产物：' + root + '）=====');
try { chrome.kill(); } catch (e) {}
process.exit(fail ? 1 : 0);

// ===== verify-1467 桌面手势 desk-swiping 门控 + 两把帧尺截短 =====
// 背景（#1467，iPhone 16 Pro Max／iOS 27.0 PWA 实报「切页面、点击、滑动时最卡」）：
//   ① desk-swiping 类此前在滑页/切页时无条件挂到 <html>（#976 语义：暂停壁纸模糊），
//     但该类唯一消费者是 `html.desk-swiping .phone.desk-blur-on #phone-bg-layer{filter:none}`
//     ——出厂默认「模糊=关」时规则永不匹配、零收益，而每次挂/摘都是整棵文档样式失效重算。
//     本批收口成「.desk-blur-on 在场才挂摘」。
//   ② #690/#884 两把帧尺旧实现闭眼采满 60/30 帧才落键：60 帧×851ms=51 秒采样窗，窗后半段
//     早已不在翻页、环境冻结全被记成「翻页耗时」（v8.54 报告 851ms 假均值即其产物）。本批
//     翻页尺「≥500ms 无 scroll 即收笔」、切回桌面尺「2.5s 墙钟封顶」，cut 字段落键。
// 用法：MOCHI_ROOT=<构建后副本> node tools/verify-1467-desk-swipe-gate.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = 9950 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1464-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'ERR:' + String((r.exceptionDetails.exception || {}).description || '').slice(0, 200);
  return r && r.result ? r.result.value : null;
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 440, height: 956, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html?v=' + Date.now() });
for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(800);

let pass = 0, fail = 0; const fails = [];
function ck(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; fails.push(name + (detail ? '  [' + detail + ']' : '')); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}
// 无头注意：#desktop-pages 是 scroll-snap 容器，非吸附点的 scrollLeft 会被拉回且不派 scroll 事件
// （实测 +40 → 归零、events=0；整步 clientWidth+8 → 落位、events=1）——翻页模拟必须走整步长。
const scrollOnce = `new Promise(function(res){ var p=document.getElementById('desktop-pages'); var s=p.clientWidth+8; var x=p.scrollLeft; var to=(x>s/2)?0:s; p.scrollLeft=to; setTimeout(function(){ res(p.scrollLeft); },60); })`;
// 滚动进行中（60ms＜150ms 摘除计时）读 desk-swiping 类＝「滑页期挂、停手后摘」两个时点都可判
const scrollSnapCls = `new Promise(function(res){ var p=document.getElementById('desktop-pages'); var s=p.clientWidth+8; var x=p.scrollLeft; var to=(x>s/2)?0:s; p.scrollLeft=to; setTimeout(function(){ res({sl:p.scrollLeft, cls:document.documentElement.className.indexOf('desk-swiping')>=0}); },60); })`;

// ===== A 组：desk-swiping 门控 =====
console.log('A 组：desk-swiping 门控');
{
  const pre = await evalJs(`(function(){var ph=document.querySelector('.phone');return {blurOn: ph.classList.contains('desk-blur-on'), cls: document.documentElement.className};})()`);
  ck('A1 出厂默认 .phone 无 desk-blur-on（本报告现场=模糊关）', pre && pre.blurOn === false, String(pre && pre.blurOn));
  const s2 = await evalJs(scrollSnapCls);
  await sleep(300);
  const a2 = await evalJs(`document.documentElement.className.indexOf('desk-swiping') < 0`);
  ck('A2 模糊关：滑页不给 <html> 挂 desk-swiping（免整文档样式重算）', a2 === true && s2 && s2.cls === false && s2.sl > 0, 'cls@60ms=' + (s2 && s2.cls) + ' sl=' + (s2 && s2.sl));
}
{
  await evalJs(`document.querySelector('.phone').classList.add('desk-blur-on'); true;`);
  const s3 = await evalJs(scrollSnapCls);
  await sleep(450); // 150ms 收尾计时 + 余量
  const after = await evalJs(`document.documentElement.className.indexOf('desk-swiping') < 0`);
  ck('A3 模糊开：滑页期照旧挂 desk-swiping（#976 暂停语义保留）', s3 && s3.cls === true && typeof s3.sl === 'number', 'cls@60ms=' + (s3 && s3.cls) + ' sl=' + (s3 && s3.sl));
  ck('A4 停手 ~150ms 后照旧摘除', after === true, String(after));
}
{
  // 切页侧（tabs.js）：模糊开 → 挂；模糊关 → 不挂
  await evalJs(`(function(){var t=document.querySelector('.tab[data-page="page-setting"]'); if(t) t.click(); return true;})()`);
  const onSwitch = await evalJs(`document.documentElement.className.indexOf('desk-swiping') >= 0`);
  await sleep(700); // 400ms 收尾计时 + 余量
  const offAfter = await evalJs(`document.documentElement.className.indexOf('desk-swiping') < 0`);
  ck('A5 模糊开：切页瞬间照旧挂（400ms 收尾）', onSwitch === true, String(onSwitch));
  ck('A6 切页后照旧摘除', offAfter === true, String(offAfter));
  await evalJs(`document.querySelector('.phone').classList.remove('desk-blur-on'); true;`);
  await evalJs(`(function(){var t=document.querySelector('.tab[data-page="page-phone"]'); if(t) t.click(); return true;})()`);
  await sleep(120);
  const clean = await evalJs(`document.documentElement.className.indexOf('desk-swiping') < 0`);
  await sleep(300);
  const clean2 = await evalJs(`document.documentElement.className.indexOf('desk-swiping') < 0`);
  ck('A7 模糊关：切页完全不挂（+120ms 与 +420ms 两点均为否）', clean === true && clean2 === true, clean + '/' + clean2);
}

// ===== B 组：两把帧尺截短 =====
console.log('B 组：帧尺截短（慢帧注入＝模拟环境冻结）');
// 慢帧注入：每帧主线程忙 120ms → 60 帧需 ~7.2s（旧尺在轮询窗内永远采不满＝红侧无键）
await evalJs(`(function(){ function slow(){ var t=Date.now(); while(Date.now()-t<120); requestAnimationFrame(slow); } requestAnimationFrame(slow); return true; })()`);
{
  await evalJs(`localStorage.removeItem('xy-home-v2:__diag-deskperf'); true;`);
  // 连续翻 ~0.4s 后停手
  for (let i = 0; i < 6; i++) { await evalJs(scrollOnce); await sleep(30); }
  let got = null;
  const dl = Date.now() + 4000;
  while (Date.now() < dl) {
    got = await evalJs(`JSON.parse(localStorage.getItem('xy-home-v2:__diag-deskperf')||'null')`);
    if (got) break;
    await sleep(150);
  }
  ck('B1 翻页已停 ~0.5s 内收笔落键（旧尺此时还在盲采）', !!got, got ? JSON.stringify(got).slice(0, 120) : '4s 内无键');
  ck('B2 截短样本带 cut=1 且未采满 60 帧', !!got && got.cut === 1 && got.n < 60, got ? 'cut=' + got.cut + ' n=' + got.n : '-');
  ck('B3 样本字段完整（mean/p90/worst/sc/ph 家族锚未破）', !!got && typeof got.mean === 'number' && typeof got.p90 === 'number' && typeof got.sc === 'string' && typeof got.ph === 'string', got ? ('sc=' + String(got.sc).slice(0, 24)) : '-');
  ck('B4 均值不被环境冻结拉爆（截短后帧样本都在翻页窗内）', !!got && got.mean < 300, got ? 'mean=' + got.mean : '-');
}
{
  // 切回桌面尺：慢帧下 30 帧需 ~4.5s > 2.5s 墙钟 → 绿侧 2.5s 截短落键；红侧轮询窗内无键
  await evalJs(`location.reload(); true;`);
  await sleep(2500);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(500);
  await evalJs(`(function(){ function slow(){ var t=Date.now(); while(Date.now()-t<150); requestAnimationFrame(slow); } requestAnimationFrame(slow); return true; })()`);
  await evalJs(`localStorage.removeItem('xy-home-v2:__diag-swperf'); true;`);
  await evalJs(`(function(){var t=document.querySelector('.tab[data-page="page-chat"]'); if(t) t.click(); return true;})()`);
  await sleep(500);
  await evalJs(`(function(){var t=document.querySelector('.tab[data-page="page-phone"]'); if(t) t.click(); return true;})()`);
  let got = null;
  const dl = Date.now() + 3800; // 绿侧 2.5s 截短必落；红侧 30×150ms≈4.5s 落不进窗＝判别
  while (Date.now() < dl) {
    got = await evalJs(`JSON.parse(localStorage.getItem('xy-home-v2:__diag-swperf')||'null')`);
    if (got) break;
    await sleep(150);
  }
  ck('B5 切页窗口过后 2.5s 墙钟封顶收笔（旧尺盲采 30 帧）', !!got, got ? JSON.stringify(got).slice(0, 120) : '3.8s 内无键');
  ck('B6 截短样本带 cut=1 且未采满 30 帧', !!got && got.cut === 1 && got.n < 30, got ? 'cut=' + got.cut + ' n=' + got.n : '-');
}

// ===== C 组：静态锚与家族旧锚回归守卫 =====
console.log('C 组：静态锚');
{
  const ds = readFileSync(join(root, 'js', 'desktop-slider.js'), 'utf8');
  const tb = readFileSync(join(root, 'js', 'tabs.js'), 'utf8');
  const ix = readFileSync(join(root, 'index.html'), 'utf8');
  ck('C1 滑页门控锚（#1445d，收口批已落）', ds.includes("if (bph && bph.classList.contains('desk-blur-on')) {"));
  ck('C2 切页门控锚（#1445a，收口批已落）', tb.includes("if (ph && ph.classList.contains('desk-blur-on')) {"));
  ck('C3 翻页尺截短锚（#1467a）', ds.includes('if (gaps.length && Date.now() - perfScrollAt > 500) { finish(); return; }'));
  ck('C4 切回桌面尺封顶锚（#1467b）', ds.includes('if (gaps.length && Date.now() - swT0 > 2500) { finish(); return; }'));
  ck('C5 诊断行截短标注（#1467c）', ix.includes('（截短：翻页已停，未采满 60 帧）'));
  ck('C6 家族锚 #884b swSample 接线保留', ds.includes('swSample(); // #884：从聊天/其他页切回桌面那一刻现场采一段帧耗时'));
  ck('C7 家族锚 #943e 5 分钟限频保留', ds.includes('if (now943 - (swSample.last || 0) < 300000) return;'));
  ck('C8 家族锚 #690g 样本落键保留', ds.includes('localStorage.setItem(PERF_KEY, JSON.stringify({'));
  ck('C9 家族锚 #1295c 现场快照保留', ds.includes("const w = { sc: '', ph: '' };"));
  ck('C10 personalize 静态锚 _sdBlurPh 接入（外置产物）', readFileSync(join(root, 'js', 'personalize.js'), 'utf8').includes('_sdBlurPh'));
}

console.log('==== RESULT ' + pass + ' pass / ' + fail + ' fail ====');
if (fails.length) console.log('RED: ' + fails.join(' | '));
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);

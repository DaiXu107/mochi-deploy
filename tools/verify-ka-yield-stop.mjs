// ===== 专项验证：#924 保活隐藏期音频焦点让位 + 关闭彻底化 =====
// 用户实报 iPhone 16 Plus Safari（多机型同族 #901 残余）：①开着保活切去刷视频总被截停
// ＝隐藏期被外部 App 抢走音频焦点后，pause 退避补播 / 5s 心跳补播 / 切后台瞬间补播三个
// 口子仍回抢 play()；②「后台保活关不掉」＝el.src='' 把页面文档当媒体加载 + iOS 媒体条
// 只清 metadata 不落 paused 的滞留。修法见 src/js/bg-keep.js #924 各注释（WebKit 能力
// 分支，安卓 Chromium 三个补播口子零改动）。
// 用法：node tools/verify-ka-yield-stop.mjs（需先 node build.mjs；MOCHI_ROOT 可指仓外副本）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const target = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : root;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

// ---- S 组：产物静态锚（bg-keep.js 自 #860 起为外置件 js/bg-keep.js）----
let jsKa = '', idx = '';
try { jsKa = readFileSync(join(target, 'js', 'bg-keep.js'), 'utf8'); } catch (e) {}
try { idx = readFileSync(join(target, 'index.html'), 'utf8'); } catch (e) {}
if (!jsKa) jsKa = idx; // 兼容旧内联落点
ok('S1 让位判定函数在产物（删＝隐藏期被抢焦点仍回抢，刷视频截停复发）', jsKa.includes('function kaYieldStealFocus()'));
ok('S2 pause 退避补播口子已加让位闸（删＝外部抢焦点后排补播回抢复发）', /addEventListener\('pause', function \(\) \{[\s\S]*?kaYieldStealFocus\(\)\) return;/.test(jsKa));
ok('S3 5s 心跳补播口子已加让位闸（删＝隐藏期漏网场景排补播回抢复发）', jsKa.includes('if (!kaTimer && !kaYieldStealFocus()) kaSchedule();'));
ok('S4 切后台瞬间立即补播口子已加让位闸（删＝切去刷视频当场被截停复发）', /visibilityState !== 'hidden'\) return;[\s\S]{0,400}if \(kaYieldStealFocus\(\)\) return;/.test(jsKa));
ok('S5 停用保活不再 el.src=\'\'（删＝空 src 按相对路径把页面文档当媒体加载，关闭不彻底复发）', jsKa.includes("keepAudio.el.removeAttribute('src')") && !jsKa.includes("keepAudio.el.src = '';"));
ok('S6 停用保活媒体会话先落 paused（删＝iOS 媒体条滞留「正在播放」＝看似关不掉复发）', /playbackState = 'paused'/.test(jsKa));
ok('S7 iPhone 开通知如实告知能力边界（删＝用户继续拿「必须弹」的预期对 iOS，反复报失效）', jsKa.includes('iPhone 提示：受系统限制'));

// ---- B 组：无头行为（停用保活彻底性：开关 off 后 probe 归零 + 媒体会话落 paused）----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(target, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(target)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ka924-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('CDP 连接失败');
}
const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

const jsErrors = [];
try {
  await cdpConnect();
  await cdp('Page.enable', {});
  await cdp('Runtime.enable', {});
  cdp('Runtime.evaluate', { expression: 'window.__jsErrors = window.__jsErrors || []' });
  // 预置「保活开」：走正式 boot 恢复路径（IIFE 读 bg-keepalive）
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('xy-home-v2:bg-keepalive','1');localStorage.setItem('xy-home-v2:__ka-user-off','0');}catch(e){}` });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(5200);
  // 关开屏（splash 盖着整屏会拦掉后续对开关的一切点击，实积 atPoint=splash-brandcard）：
  // 有「进入」按钮点按钮，没有则直接加 hide 类——只影响本测试会话的 DOM 状态
  await evalJs(`(function(){ const sp = document.getElementById('splash'); if (!sp || sp.classList.contains('hide')) return 'no-splash'; const en = document.getElementById('splash-enter'); if (en && !en.hidden && !en.classList.contains('is-disabled')) { en.click(); return 'enter-click'; } sp.classList.add('hide'); return 'force-hide'; })()`);
  await sleep(800);

  const probeOn = await evalJs(`(function(){ try { const p = window.__kaProbe ? window.__kaProbe() : null; return p ? { keep: p.keep, hasAudio: !!p.audio, paused: p.audio ? p.audio.paused : null } : null; } catch(e){ return { err: String(e) }; } })()`);
  ok('B1 预置开＝boot 后保活在跑（keep=true 且音频实例存在）', !!probeOn && probeOn.keep === true && probeOn.hasAudio === true);

  // 真实用户手势关开关（#921f 手势闸要求 isTrusted=true，走 CDP 原始点击）。
  // 开关在 page-setting 里；input 本体是 0×0 隐藏元素，可视点击目标是 label.toggle
  //（label 原生转发 click→input change，isTrusted=true）。
  const st0 = await evalJs(`(function(){ const t = document.querySelector('.tab[data-page="page-setting"]'); if (t) t.click(); const el = document.getElementById('bg-keepalive'); if (!el) return null; const sec = el.closest('.them-sec'); if (sec && sec.hidden) { const tab = document.querySelector('#set-tabs .them-tab[data-tab="' + sec.getAttribute('data-sec') + '"]'); if (tab) tab.click(); } const lb = el.closest('label'); if (!lb) return null; lb.scrollIntoView({ block: 'center' }); const r = lb.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, checked: el.checked }; })()`);
  ok('B2 开关在设置页且可视点击目标在位（tab 切页成功＋label 命中坐标）', !!st0 && st0.x > 0 && st0.y > 0);
  if (st0 && st0.x > 0) {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: st0.x, y: st0.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: st0.x, y: st0.y, button: 'left', clickCount: 1 });
    await sleep(1200);
    const probeOff = await evalJs(`(function(){ try { return { keep: window.__kaProbe().keep, hasAudio: !!window.__kaProbe().audio, stored: localStorage.getItem('xy-home-v2:bg-keepalive'), userOff: localStorage.getItem('xy-home-v2:__ka-user-off'), ps: ('mediaSession' in navigator && navigator.mediaSession) ? navigator.mediaSession.playbackState : null }; } catch(e){ return { err: String(e) }; } })()`);
    ok('B3 用户手势关＝保活停（keep=false 且音频实例拆除）', probeOff && probeOff.keep === false && probeOff.hasAudio === false);
    ok('B4 关闭落账（存储 0 + user-off 锁，防回填/联动再开）', probeOff && probeOff.stored === '0' && probeOff.userOff === '1');
    ok('B5 媒体会话播放态落回 paused（#924b：iOS 媒体条滞留治理；HEAD 红点）', probeOff && probeOff.ps === 'paused');
  }

  await sleep(300);
  const errs = await evalJs('JSON.stringify((window.__jsErrors || []).slice(-5))');
  (JSON.parse(errs) || []).forEach((e) => jsErrors.push(e));
  ok('Z 零 JS 异常', jsErrors.length === 0);
} catch (e) {
  fail++; console.error('❌ B 组执行失败: ' + e.message);
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}

console.log(`\\n#924 结果: 通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);

// ===== 回归脚本：#1394 通话中挂断概率「数 tick」→「量墙钟」＋掷骰按归属桌面读设置 =====
// 用法：node tools/verify-1394-hangup-wallclock.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-1394-hangup-wallclock.mjs   （测临时构建副本）
//
// 作者直派（2026-09-29）：「为什么没开【禁止联系人挂断电话】、开了【刷新后恢复通话】，
// 但每次刷新网页接上通话后，一直都没有触发通话中挂断概率」。
//
// 实测过的两条根因（都在 src/js/call.js 的 startCallDuration）：
//   ① 掷骰周期用「1 秒 interval 数满 60 个 tick」实现。通话时页面通常在息屏/后台：隐藏页定时器
//      被内核节流到约 1 次/分钟、安卓 5 分钟后整页冻结（#757 在同一文件写下过这件事）——60 个
//      tick 最长走 60 分钟，冻结期间压根不走。
//   ② 计数是闭包局部（checkCount），每刷新/恢复一次就从零重数＝反复刷新可无限续命，且锚不落盘。
//   ③ 掷骰读的是「当前激活桌面」的概率（replyCfg → activeStore 按 __activeCid 动态解析），
//      而通话有归属桌面 currentCall.cid：通话中切桌面／刷新回到别的桌面＝A 的通话按 B 的概率判定。
//
// 断言（RED 判别靠「快进时钟」把节流等价复刻：1 个 tick 之间墙钟走 30 秒）：
//   S 轴 产物锚：墙钟锚五处写法在位＋旧「数满 60 tick」写法已除（删除型，底本须命中）＋#200 旧邻针仍在。
//   D 轴 行为：D1 节流下墙钟到期即掷（红侧 0 掷）；D2a 锚跨刷新不清零（红侧须重新数 60 tick）；
//      D2b 锚在未来时不提前掷（防「恢复即掷」假绿）；D3 掷骰按归属桌面读概率（红侧按当前桌面）；
//      D3r 归属＝当前时照常（没改出第二条路）。
//   Z 轴 两侧皆绿＝没修过头：概率 0／总开关开＝永不掷；不接快进时钟时 3 分钟保护期仍在；
//      刷新仍续上且时长从接通时刻继续；call-active 键体仍 <1KB（#757 口径）；挂断仍落归属桌面记录。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
console.log('被测根目录 = ' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- S 轴：产物锚 ----------
let prod = '';
try { prod = readFileSync(join(root, 'js/call.js'), 'utf8'); } catch (e) {}
const html = (() => { try { return readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) { return ''; } })();
const hits = (s, n) => (n === '' ? 0 : s.split(n).length - 1);
check('S1 掷骰改问墙钟（Date.now() >= currentCall.hangupAt）', hits(prod, 'Date.now() >= currentCall.hangupAt') === 1);
check('S2 掷后把锚推到下一个 60 秒墙钟点', hits(prod, 'currentCall.hangupAt = Date.now() + 60000') === 1);
check('S3 首掷锚＝接通满 3 分钟（且不早于当下）', hits(prod, 'Math.max(currentCall.connectedTime + 180000, Date.now())') === 1);
check('S4 锚随 call-active 载荷落盘', hits(prod, 'hangupAt: currentCall.hangupAt || 0') === 1);
check('S5 恢复时把锚带回来（旧载荷无此字段则重算）', hits(prod, 'hangupAt: info.hangupAt || 0') === 1);
check('S6 掷骰按通话归属桌面读设置', hits(prod, 'const hp = callCfg(currentCall.cid);') === 1);
check('S7 旧写法「数满 60 个 tick」已除（删除型；底本须命中＝本针不是空炮）',
  hits(prod, 'checkCount >= 60') === 0 && hits(readFileSync(join(root, 'src/js/call.js'), 'utf8'), 'checkCount') === 0);
check('S8 #200 旧硬闸两针仍在（没顺手拆掉「设 0／总开关不掷」）',
  hits(prod, "if (!(hp.nohangup || hp.hangup <= 0) && Math.random() * 100 < hp.hangup) {") === 1
  && hits(prod, "nohangup: c['call-no-hangup'] === 1 || c['call-no-hangup'] === '1',") === 1);
check('S9 通话设置页两处说明已按新口径改口（周期含义＋「不是全站总开关」）',
  hits(html, '不是全站总开关') === 1 && hits(html, '判定按墙钟走') === 1);

// ---------- 浏览器 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----'); console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  console.log((results.filter(r => !r.ok).length === 0 ? 'S 轴全绿' : 'S 轴有红')); process.exit(2);
}
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9820 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1394-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
          }
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      jsErrors.push((r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 200));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function ready() {
  for (let i = 0; i < 80; i++) {
    if (await ev(`!!(window.placeCall && window.getCallState && window.idbGet && window.replyCfg)`)) return true;
    await sleep(250);
  }
  return false;
}
async function reload() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!await ready()) throw new Error('刷新后应用未就绪');
  await sleep(1000); // 等 mochi-restore-done → bootCallResume
}
const KEY = 'xy-home-v2:call-active';
// 清场：挂断活通话＋摘三路标记＋清通话记录＋桌面指回 default
async function reset() {
  await ev(`(async function(){
    try { if (window.getCallState && window.getCallState()) window.hangupCall(); } catch(e){}
    try { sessionStorage.removeItem('${KEY}'); } catch(e){}
    try { localStorage.removeItem('${KEY}'); } catch(e){}
    try { await window.idbSet('${KEY}', { ts: 0 }); } catch(e){}
    try { localStorage.removeItem('xy-home-v2:default:records-call'); } catch(e){}
    try { window.idbSet('xy-home-v2:default:records-call', []); } catch(e){}
    try { window.__activeCid = 'default'; } catch(e){}
    return 'reset';
  })()`);
  await sleep(350);
}
// 概率设置按命名空间写（走 xyStore，与页面同一读法，绕开它的内存缓存）
async function setCfg(ns, k, v) {
  return ev(`(function(){ try { window.xyStore('${ns}').set('reply-${k}', String(${JSON.stringify(v)})); return 'ok'; } catch(e){ return 'err:'+e.message } })()`);
}
// 快进时钟＝节流的等价现场：真实 1 秒之间墙钟走 rate 秒
async function patchClock(rate) {
  return ev(`(function(){
    if (window.__fc1394) { window.__fc1394.rate = ${rate}; return 'again'; }
    var od = Date.now;
    var h = window.__fc1394 = { od: od, real0: od.call(Date), fake0: od.call(Date), rate: ${rate} };
    Date.now = function(){ return h.fake0 + (h.od.call(Date) - h.real0) * h.rate; };
    return 'patched';
  })()`);
}
async function unpatchClock() {
  await ev(`(function(){ var h = window.__fc1394; if (h && h.od) { Date.now = h.od; } window.__fc1394 = null; return 'ok'; })()`);
}
// 真实去电接通（Math.random 钉 0.5 → 落 70% 接听档）
async function dialConnected() {
  await ev(`Math.random = (function(){ return function(){ return 0.5; }; })(); window.placeCall(); 'dial'`);
  for (let i = 0; i < 40; i++) {
    const st = await ev(`JSON.stringify(window.getCallState())`);
    try { const o = JSON.parse(st); if (o && o.status === 'connected') return o; } catch (e) {}
    await sleep(300);
  }
  return null;
}
async function seed(o) {
  return ev(`(async function(){
    var p = Object.assign({ cid:'default', direction:'out', status:'connected',
      startTime: Date.now()-600000, connectedTime: Date.now()-600000, name:'TA', av:'', ts: Date.now()-3000 }, ${JSON.stringify(o)});
    try { sessionStorage.setItem('${KEY}', JSON.stringify(p)); } catch(e){}
    try { localStorage.setItem('${KEY}', JSON.stringify(p)); } catch(e){}
    try { await window.idbSet('${KEY}', p); } catch(e){}
    return JSON.stringify(p);
  })()`);
}
// 观察 windowMs 真实毫秒：TA 有没有把电话挂掉（看归属桌面的通话记录）
async function watchHangup(windowMs) {
  const t0 = Date.now();
  for (;;) {
    const r = await ev(`(function(){ try { var a = JSON.parse(localStorage.getItem('xy-home-v2:default:records-call')||'[]');
      var t = String((a[0]||{}).text||''); return t.indexOf('对方挂断') >= 0 ? t : ''; } catch(e){ return '' } })()`);
    if (r) return { hit: true, atSec: ((Date.now() - t0) / 1000).toFixed(1), text: String(r).slice(0, 40) };
    if (Date.now() - t0 > windowMs) return { hit: false, atSec: (windowMs / 1000).toFixed(0) };
    await sleep(1000);
  }
}
const state = async () => JSON.parse(await ev(`JSON.stringify(window.getCallState())`) || 'null');

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!await ready()) throw new Error('应用未就绪');
  await sleep(1000);
  await setCfg('xy-home-v2:default', 'call-hangup', 100);
  await setCfg('xy-home-v2:default', 'call-no-hangup', 0);
  await setCfg('xy-home-v2:default', 'call-resume', 1);

  // ---- D1 节流（快进时钟）下：墙钟到期就该掷 ----
  await reset();
  await unpatchClock();
  const d1conn = await dialConnected();
  await patchClock(30);
  const d1 = await watchHangup(20000);
  await unpatchClock();
  check('D1 隐藏页节流复刻（墙钟 30 倍速）：接通满 3 分钟后掷骰命中 → 被挂断（红侧＝60 个 tick 走不满＝0 掷）',
    !!d1conn && d1.hit, 'at=' + d1.atSec + 's ' + (d1.text || ''));
  await reset(); await unpatchClock();

  // ---- D2a 锚跨刷新不清零：种子锚在过去 → 续上后很快掷 ----
  await seed({ connectedTime: Date.now() - 600000, hangupAt: Date.now() - 1000 });
  await reload();
  const d2aState = await state();
  await patchClock(30);
  const d2a = await watchHangup(15000);
  await unpatchClock();
  check('D2a 刷新续上后锚仍作数（已过期→当拍即掷；红侧＝重新数 60 tick，窗口内 0 掷）',
    !!d2aState && d2aState.status === 'connected' && d2a.hit, 'resume=' + JSON.stringify(d2aState) + ' at=' + d2a.atSec + 's');
  await reset(); await unpatchClock();

  // ---- D2b 锚在未来：不得提前掷（防「恢复即掷」假绿） ----
  await seed({ connectedTime: Date.now() - 600000, hangupAt: Date.now() + 180000 });
  await reload();
  const d2bState = await state();
  await patchClock(3);
  const d2b = await watchHangup(20000);
  await unpatchClock();
  check('D2b 锚在未来 3 分钟 → 续上后 20 秒真实窗内不掷（证明锚真被采纳）',
    !!d2bState && d2bState.status === 'connected' && !d2b.hit, 'notHit=' + !d2b.hit);
  await reset(); await unpatchClock();

  // ---- D3 掷骰按归属桌面读：通话属 default（100%），切到 other（0%）后仍该掷 ----
  await setCfg('xy-home-v2:other', 'call-hangup', 0);
  await setCfg('xy-home-v2:other', 'call-no-hangup', 0);
  await reset();
  const d3conn = await dialConnected();               // cid = default
  await ev(`window.__activeCid = 'other'; 'switched'`); // 模拟通话中切到别的联系人桌面
  await patchClock(30);
  const d3 = await watchHangup(20000);
  await unpatchClock();
  await ev(`window.__activeCid = 'default'; 'back'`);
  check('D3 通话归属 default（概率 100）而界面停在 other（概率 0）→ 仍按归属桌面的 100 掷（红侧＝按当前的 0 永不掷）',
    !!d3conn && d3.hit, 'at=' + d3.atSec + 's');
  await reset(); await unpatchClock();

  // ---- Z1 概率 0 → 永不掷（两侧皆绿＝#200 硬闸没被改坏） ----
  await setCfg('xy-home-v2:default', 'call-hangup', 0);
  const z1conn = await dialConnected();
  await patchClock(30);
  const z1 = await watchHangup(20000);
  await unpatchClock();
  check('Z1 挂断概率设 0 → 节流快进下也永不挂断（两侧皆绿：#200 硬闸仍在）', !!z1conn && !z1.hit, 'notHit=' + !z1.hit);
  await reset(); await unpatchClock();

  // ---- Z2 总开关开 → 永不掷 ----
  await setCfg('xy-home-v2:default', 'call-hangup', 100);
  await setCfg('xy-home-v2:default', 'call-no-hangup', 1);
  const z2conn = await dialConnected();
  await patchClock(30);
  const z2 = await watchHangup(20000);
  await unpatchClock();
  await setCfg('xy-home-v2:default', 'call-no-hangup', 0);
  check('Z2 「禁止联系人挂断电话」开 → 概率 100 也不挂（两侧皆绿：开关仍形同有实）', !!z2conn && !z2.hit, 'notHit=' + !z2.hit);
  await reset(); await unpatchClock();

  // ---- Z3 不接快进时钟时，3 分钟保护期仍在（前台观感没被改快） ----
  const z3conn = await dialConnected();
  const z3 = await watchHangup(45000);
  check('Z3 真实时钟下接通 45 秒内不掷（3 分钟保护期原样，前台节奏没被改快）', !!z3conn && !z3.hit, 'notHit=' + !z3.hit);
  await reset();

  // ---- Z4 刷新仍续上＋时长从接通时刻继续（#757 那族没破） ----
  await seed({ connectedTime: Date.now() - 600000, hangupAt: Date.now() + 1800000 });
  await reload();
  const z4 = await state();
  check('Z4 刷新后续上通话，且时长从接通时刻继续（≥9 分钟）',
    !!z4 && z4.status === 'connected' && z4.durationSec >= 590, JSON.stringify(z4));
  const z4anchor = await ev(`(function(){ try { var o = JSON.parse(localStorage.getItem('${KEY}')||'null'); return JSON.stringify({ has: typeof o.hangupAt, num: typeof o.hangupAt === 'number', bytes: (localStorage.getItem('${KEY}')||'').length }); } catch(e){ return 'err' } })()`);
  let za = null; try { za = JSON.parse(z4anchor); } catch (e) {}
  check('Z5 call-active 键体仍 <1KB（#757 瘦身口径，加锚不许撑爆）', !!za && za.bytes > 0 && za.bytes < 1024, z4anchor);
  check('Z6 载荷里的锚是数字（红侧＝旧产物根本没写这个字段）', !!za && za.num, z4anchor);
  await reset();

  // ---- D4 挂断仍按原链落归属桌面记录（依赖掷骰真发生，故红侧会红） ----
  await reset();
  const z7conn = await dialConnected();
  await setCfg('xy-home-v2:default', 'call-hangup', 100);
  await patchClock(30);
  const z7 = await watchHangup(20000);
  await unpatchClock();
  const z7rec = await ev(`(function(){ try { var a = JSON.parse(localStorage.getItem('xy-home-v2:default:records-call')||'[]'); return JSON.stringify(a[0]||{}) } catch(e){ return 'err' } })()`);
  check('D4 被挂断那一发仍按原链落账（文案带时长；红侧因窗口内压根不掷骰而红＝新契约载体，不是旧回归）', !!z7conn && z7.hit && String(z7rec).indexOf('对方挂断') >= 0, String(z7rec).slice(0, 90));
  await reset();

  const errs = jsErrors.slice(0, 4);
  check('Z8 全程无未捕获 JS 异常', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('测试跑通（非断言失败）', false, String(e && e.message || e));
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}
const fails = results.filter(r => !r.ok).length;
console.log('----');
console.log(fails === 0 ? 'ALL PASS ' + results.length + '/' + results.length : 'FAIL ' + (results.length - fails) + '/' + results.length);
process.exit(fails === 0 ? 0 : 1);

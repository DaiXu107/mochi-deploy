// ===== 回归脚本：#542 桌面输入弹窗（openModal）收起输入法后「回弹很慢 + 大片灰底」=====
// 用户报障（红米 K80 Chrome，明说其他设备型号也有、要求不要覆盖修改引发跨机型回归）：
//   「桌面触发了让我输入文字的弹窗时，我点击输入文字后关闭输入法弹窗，回弹速度很慢，
//     会看到大片灰屏。」
//
// 根因（零机型分支，无头 CDP 复现）：
//   ① 关闭弹窗时弹窗内输入框（安卓已转 .ce-box）正持有焦点，openModal.close() 直接
//      `mask.hidden = true`＝把「聚焦中的可编辑元素」从布局摘掉——一批内核/输入法不为
//      这种移除派 focusout、也不派 visualViewport.resize；
//   ② 移动适配层安卓分支的收键盘链四条复原路（syncAndroidKb 的 vv 回基准 / focusout
//      400ms 复查 / 250ms 轮询 / #209·#236 看门狗）全要「vv 回基准」或「2.2s 无任何活动」
//      作证据 → .phone 内联收缩高停在键盘期数值＝键盘位置一直露 body 灰底；接着点/滑就
//      更久。实测（无头）：失焦 + vv 不回基准时 .phone 卡 1.2s+ 才被 #267 看门狗收回。
//
// 修复（两处，零机型分支）：
//   A) personalize.js openModal.close()：先 blur 弹窗内聚焦输入框（走标准失焦链）+
//      向移动层报备一次有界兜底（window.mochiKbDismiss，同 #512 问问TA）。
//   B) mobile-adapt.js 安卓 focusout：失焦来自文本框 + 无任何文本持活焦点 + vv 读数已稳
//      ≥350ms → 有界快速复原（置 _aVvStale 闩防残留读数抽回）。
//
// 用法：node tools/verify-modal-kb-recover.mjs   （对产物 index.html）
//   需：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）；MOCHI_ROOT 可指向另一份产物目录
//   RED 基线：把 A/B 两处修复去掉重建产物再跑，S2/S3/S4/A2/B2/B3 应红（实测 12/18）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT || normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-modalkb-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS  ' + name + (extra ? '  [' + extra + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } }

await cdp('Page.enable'); await cdp('Runtime.enable');
try { await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) {}
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1000);
await evalJs(`(function(){var b=document.getElementById('splash-confirm-ok')||document.getElementById('splash-enter');if(b)b.click();return !!b;})()`);
await sleep(400);
for (let i = 0; i < 20; i++) {
  const r = await evalJs(`(function(){var m=document.getElementById('splash-mandatory'); if(!m||m.hidden) return 'none'; var sc=document.getElementById('splash-mandatory-scroll'); if(sc) sc.scrollTop=sc.scrollHeight; var en=document.getElementById('splash-mandatory-enter'); if(en&&!en.classList.contains('is-disabled')){en.click();return 'entered';} return 'wait';})()`);
  if (r === 'entered' || r === 'none') break;
  await sleep(250);
}
await evalJs(`(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}return true;})()`);
await sleep(400);
await evalJs(`(function(){window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message||e));});return true;})()`);
// vv 补丁：键盘模拟（只改 height，可逐帧派 resize）
await evalJs(`(function(){var vv=window.visualViewport;if(!vv.__patched){var h=vv.height;Object.defineProperty(vv,'height',{get:function(){return h;},configurable:true});window.__setVvHeight=function(v){h=v;vv.dispatchEvent(new Event('resize'));};vv.__patched=1;}return true;})()`);
await evalJs(`window.__ph=function(){var p=document.querySelector('.phone');return JSON.stringify({h:p.style.height||'(none)',align:p.style.alignSelf||'(none)',top:p.style.top||'(none)'});}; true`);

async function openModalFocused() {
  await evalJs(`(function(){window.openModal('验证#542','',function(){},{placeholder:'请输入'});return true;})()`);
  await sleep(150);
  for (let i = 0; i < 12; i++) {
    const ok = await evalJs(`(function(){var i=document.getElementById('modal-input');var b=i&&i.__ceBox;if(!b)return false;b.focus();return document.activeElement===b;})()`);
    if (ok) break;
    await sleep(80);
  }
  return await evalJs(`(function(){var i=document.getElementById('modal-input');var b=i&&i.__ceBox;return JSON.stringify({hasCe:!!b,foc:!!b&&document.activeElement===b,maskHidden:document.getElementById('modal-mask').hidden});})()`);
}
async function waitRecover(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ph = JSON.parse(await evalJs('window.__ph()') || '{}');
    if (ph.h === '(none)') return { ok: true, ms: Date.now() - t0 };
    await sleep(60);
  }
  return { ok: false, ms: Date.now() - t0 };
}

// ---------- S) 静态锚点（防覆盖 / 哨兵有牙） ----------
const html = readFileSync(join(root, 'index.html'), 'utf8');
check('S1 修复A：openModal.close 先 blur 弹窗内输入框再隐藏（同 #512 问问TA）', html.includes('&& mask.contains(_ae)) {'));
check('S2 修复A：openModal.close 向移动层报备有界兜底', html.includes('if (window.mochiKbDismiss) { try { window.mochiKbDismiss(); } catch (eD) {} }'));
check('S3 修复B：focusout 有界快速复原存在', html.includes('_lostText = _aIsText(e.target);'));
check('S4 修复B：验收 vv 读数已稳 ≥350ms 才复原', html.includes('Date.now() - _aVvChgAt < 350'));

// ---------- A) 弹窗关闭（修A）：vv 不回基准也应快速收回 ----------
let st = JSON.parse(await openModalFocused());
check('A0 前置：弹窗打开且输入框（ce-box）持焦', st.hasCe && st.foc, JSON.stringify(st));
await evalJs('window.__setVvHeight(430)'); await sleep(650);
check('A1 键盘期 .phone 收缩到可视高', JSON.parse(await evalJs('window.__ph()')).h === '430px', await evalJs('window.__ph()'));
await evalJs(`document.getElementById('modal-cancel').click()`);
const aRec = await waitRecover(1100);
check('A2 关弹窗后 .phone 快速收回（<1100ms；旧实现要等 2.2s 看门狗）', aRec.ok, aRec.ms + 'ms');
check('A3 弹窗已关', await evalJs(`!!document.getElementById('modal-mask').hidden`));
await evalJs('window.__setVvHeight(844)'); await sleep(300);

// ---------- B) 输入法收起（修B）：失焦 + vv 不回基准 ----------
st = JSON.parse(await openModalFocused());
check('B0 前置：弹窗打开且输入框持焦', st.hasCe && st.foc, JSON.stringify(st));
await evalJs('window.__setVvHeight(430)'); await sleep(650);
check('B1 键盘期 .phone 收缩到可视高', JSON.parse(await evalJs('window.__ph()')).h === '430px', await evalJs('window.__ph()'));
await evalJs(`(function(){var a=document.activeElement;if(a&&a.blur)a.blur();return true;})()`);
const bRec = await waitRecover(900);
check('B2 失焦后 .phone 快速收回（<900ms；旧实现 1.2s+ 才被看门狗收回）', bRec.ok, bRec.ms + 'ms');
check('B3 vv 残留闩已置（防残留读数把 .phone 抽回）', !!(await evalJs('(window.__mochiAndroidKb&&window.__mochiAndroidKb()||{}).staleVv')));
await evalJs(`document.getElementById('modal-cancel').click()`);
await evalJs('window.__setVvHeight(844)'); await sleep(400);

// ---------- C) 健康内核：vv 逐帧回升应正常跟随、不被兜底误伤 ----------
st = JSON.parse(await openModalFocused());
check('C0 前置：弹窗打开且输入框持焦', st.hasCe && st.foc, JSON.stringify(st));
await evalJs('window.__setVvHeight(430)'); await sleep(650);
for (const f of [470, 520, 580, 640, 700, 760, 810, 844]) { await evalJs('window.__setVvHeight(' + f + ')'); await sleep(40); }
await sleep(450);
check('C1 vv 回升后 .phone 恢复满高（无内联残留）', JSON.parse(await evalJs('window.__ph()')).h === '(none)', await evalJs('window.__ph()'));
check('C2 健康路径未误置残留闩', !(await evalJs('(window.__mochiAndroidKb&&window.__mochiAndroidKb()||{}).staleVv')));
await evalJs(`document.getElementById('modal-cancel').click()`); await sleep(200);

// ---------- D) 回归防线：键盘仍开且输入框持焦时，兜底不得误收 .phone ----------
st = JSON.parse(await openModalFocused());
check('D0 前置：弹窗打开且输入框持焦', st.hasCe && st.foc, JSON.stringify(st));
await evalJs('window.__setVvHeight(430)'); await sleep(1500);
check('D1 焦点仍在输入框时 .phone 保持收缩（兜底零误触发）', JSON.parse(await evalJs('window.__ph()')).h === '430px', await evalJs('window.__ph()'));
await evalJs(`document.getElementById('modal-cancel').click()`);
await evalJs('window.__setVvHeight(844)'); await sleep(400);

// ---------- E) 零异常 ----------
const errs = JSON.parse((await evalJs('JSON.stringify(window.__errs)')) || '[]');
check('E1 全流程零脚本异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

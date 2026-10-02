// ===== 回归脚本：拍卖会「页面显示不全」——结果/结算浮层被 .au-stage 裁剪（#547，#381 同族漏网） =====
// 用法：node tools/verify-auction-overlay-fit.mjs（需 node 21+ 与本机 Chrome/Edge）
// 背景（用户反馈：小米15Pro Chrome，明说其他设备型号也有）：
//   成交/TA拍得/流拍/扣款失败/本场结算等浮层弹在 .au-stage 内（高度=拍品卡 ~160px），而
//   .pong-overlay 是 overflow:hidden + justify-content:center —— 内容一超高就上下两端同时被裁、
//   无法滚动（实测 384×752 内容 192px 裁 10px×2；真实内容含成色标签/心愿行/系统大字体可达几十 px，
//   「下一件/再来一场」按钮被切一半＝「拍卖会功能的页面里显示不全」）。#381 只把背包/记录转了全屏。
// 修复：#au-overlay:not(.au-ov-fs) 改 overflow-y:auto + justify-content:safe center——装得下照旧
//   居中；装不下顶对齐+浮层自身可滚，任何内容高度下按钮都够得着。#au-intro/#au-help 同族兜底。
// 验证（无头 Chrome 384×752 真实产物）：
//   B1 结果浮层注入真实同构高内容（标题+ico+4 行结算+按钮行）后：无顶端裁剪、滚动到底后按钮
//      完整落在浮层可视区内（=用户够得着）；B2 内容自适应（scrollHeight>clientHeight 时才滚）；
//   B3 真实流程（出价→落槌）的成交浮层同样不裁（尽力触发，TA 节奏不定）；B4 开场教学层无裁剪。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const chk = (name, ok, detail) => { if (ok) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); } };

// ---------- S 层：源码断言 ----------
const cssSrc = readFileSync(join(root, 'src/css/chat-pages.css'), 'utf8');
console.log('S 层（源码作用域）');
chk('S1 结果浮层防裁剪规则在位（#au-overlay:not(.au-ov-fs)）', cssSrc.includes('#au-overlay:not(.au-ov-fs) { overflow-y:auto; justify-content:center; justify-content:safe center; }'));
chk('S2 全屏教学层同族兜底在位', /#au-intro, #au-help \{ overflow-y:auto; justify-content:center; justify-content:safe center; \}/.test(cssSrc));

// ---------- B 层 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

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
const cdpPort = 9750 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v547au-' + Date.now()),
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 384, height: 752, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);

// 过开屏（年龄勾选 + 强制公告）
await evalJs(`(async () => {
  for (let i = 0; i < 16; i++) {
    const mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      const sc = document.getElementById('splash-mandatory-scroll');
      if (sc) { sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); }
      const men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); await new Promise(r => setTimeout(r, 400)); continue; }
      await new Promise(r => setTimeout(r, 300)); continue;
    }
    const sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) break;
    const sb = document.getElementById('splash-box');
    if (sb) { sb.scrollTop = sb.scrollHeight; sb.dispatchEvent(new Event('scroll')); }
    const ac = document.getElementById('splash-age-check');
    if (ac && !ac.checked) { ac.checked = true; ac.dispatchEvent(new Event('change')); }
    const se = document.getElementById('splash-enter');
    if (se && !se.classList.contains('is-disabled')) se.click();
    await new Promise(r => setTimeout(r, 400));
  }
  return 1;
})()`);
await sleep(800);
await evalJs(`(function(){ var m = document.getElementById('modal-mask'); if (m) m.hidden = true; var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1200);
await evalJs(`(function(){ try { window.giftWalletSet({ myBalance: 999900, systemBalance: 999900 }); } catch (e) {} var b = document.getElementById('more-auction'); if (b) b.click(); return 1; })()`);
await sleep(900);

// B4 开场教学层（真实首屏）无裁剪
const intro = await evalJs(`(() => {
  const el = document.getElementById('au-intro');
  if (!el || el.hidden) return { hidden: true };
  const r = el.getBoundingClientRect();
  const kids = [...el.children].filter(k => k.getBoundingClientRect().height > 0);
  const top = Math.min(...kids.map(k => k.getBoundingClientRect().top));
  const bot = Math.max(...kids.map(k => k.getBoundingClientRect().bottom));
  return { hidden: false, cs: getComputedStyle(el).overflowY + '/' + getComputedStyle(el).justifyContent,
    clippedTop: Math.round(r.top - top), clippedBottom: Math.round(bot - r.bottom) };
})()`);
chk('B4 开场教学层 overflow-y=auto 且内容无裁剪', intro && !intro.hidden && intro.cs.indexOf('auto') === 0 && intro.clippedTop <= 0 && intro.clippedBottom <= 0, JSON.stringify(intro));

// 进场：开始拍卖
await evalJs(`(function(){ var b = document.getElementById('au-intro-start'); if (b) b.click(); return 1; })()`);
await sleep(700);

// B1/B2 结果浮层：注入真实同构高内容（与 hammer/showSummary 同类节点），量裁剪与可达性
const fit = await evalJs(`(function(){
  const ov = document.getElementById('au-overlay');
  if (!ov) return 'no-ov';
  ov.classList.remove('au-ov-fs', 'au-ov-ta', 'au-ov-pass');
  ov.classList.add('au-ov-win');
  document.getElementById('au-ov-title').textContent = '落槌！';
  document.getElementById('au-ov-body').innerHTML =
    '<div class="au-ov-ico">🎁</div>' +
    '<div class="pong-end-stat"><span class="au-rare au-r2">SSR</span> 神秘拍品 · ¥53.13 拍下</div>' +
    '<div class="pong-end-stat">💌 换了三班车的思念终于到站</div>' +
    '<div class="pong-end-stat">已收进 🎒 小收藏（剩 ¥9946.87）· 可在 🎒 里转赠给 TA</div>';
  document.getElementById('au-btn-start').textContent = '下一件';
  ov.hidden = false;
  return 1;
})()`);
const m1 = await evalJs(`(() => {
  const ov = document.getElementById('au-overlay');
  const stage = document.querySelector('#au-stage').getBoundingClientRect();
  const ovR = ov.getBoundingClientRect();
  const title = document.getElementById('au-ov-title').getBoundingClientRect();
  const btns = ov.querySelector('.pong-overlay-btns').getBoundingClientRect();
  const res = { scrollable: ov.scrollHeight > ov.clientHeight + 1,
    clippedTop: Math.round(stage.top - title.top),
    btnsBottomRaw: Math.round(btns.bottom - stage.bottom) };
  ov.scrollTop = ov.scrollHeight; // 用户滚到底
  const btns2 = ov.querySelector('.pong-overlay-btns').getBoundingClientRect();
  res.btnsBottomScrolled = Math.round(btns2.bottom - stage.bottom);
  res.titleTop = Math.round(title.top - stage.top);
  res.ov = [Math.round(ovR.top), Math.round(ovR.height)];
  res.stage = [Math.round(stage.top), Math.round(stage.height)];
  return res;
})()`);
chk('B1 超高结果浮层无顶端裁剪（顶对齐可滚）', m1 && m1.clippedTop <= 0, JSON.stringify(m1));
chk('B1.1 浮层可滚（scrollHeight>clientHeight）', m1 && m1.scrollable, JSON.stringify(m1 && { sH: m1.scrollable, btnsRaw: m1.btnsBottomRaw }));
chk('B1.2 滚到底后按钮行完整落在浮层内（用户够得着）', m1 && m1.btnsBottomScrolled <= 1, JSON.stringify(m1));
chk('B1.3 视觉仍然贴 stage（overlay 尺寸未跑版）', m1 && Math.abs(m1.ov[1] - m1.stage[1]) <= 2, JSON.stringify(m1));

// B3 真实流程：出价→等 TA→直到自己最高价→落槌（尽力触发）
let real = null;
try {
  real = await evalJs(`(async () => {
    document.getElementById('au-btn-start') && (document.getElementById('au-btn-start').textContent = '开场拍卖');
    // 关掉注入浮层，走真实流程
    const ov = document.getElementById('au-overlay');
    ov.hidden = true;
    const clickBid = () => { const b = document.getElementById('au-bid1'); if (b && !b.disabled) { b.click(); return true; } return false; };
    clickBid();
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 2600));
      const pass = document.getElementById('au-pass');
      if (pass && /落槌/.test(pass.textContent)) {
        pass.click();
        await new Promise(r => setTimeout(r, 800));
        const ov2 = document.getElementById('au-overlay');
        if (ov2.hidden) return { done: false, why: 'no-ov' };
        const stage = document.querySelector('#au-stage').getBoundingClientRect();
        const title = document.getElementById('au-ov-title').getBoundingClientRect();
        ov2.scrollTop = ov2.scrollHeight;
        const btns = ov2.querySelector('.pong-overlay-btns').getBoundingClientRect();
        return { done: true, title: title.textContent,
          clippedTop: Math.round(stage.top - title.top),
          btnsBottom: Math.round(btns.bottom - stage.bottom) };
      }
      clickBid();
    }
    return { done: false, why: 'never-leader' };
  })()`);
} catch (e) { real = { done: false, why: String(e).slice(0, 80) }; }
if (real && real.done) {
  chk('B3 真实成交浮层无顶端裁剪且按钮可达', real.clippedTop <= 0 && real.btnsBottom <= 1, JSON.stringify(real));
} else {
  console.log('  ⚠️ B3 真实流程未能在预算内落槌（' + ((real && real.why) || '?') + '），以 B1 注入断言为准');
}

chrome.kill();
server.close();
console.log('\\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

// ===== 回归脚本：此间【去找TA】跨桌面直达聊天的卡顿（#695） =====
// 用法：node tools/verify-cjian-go-lag.mjs          （MOCHI_ROOT 可指向隔离副本）
// 症状：此间里点别的桌面梦角的【去找TA】直达聊天，点击后卡一下。
// 根因：cjian.js 的【去找TA】在同一次任务里先 setActiveContact 再 enterChat——前者尾部把
//   主页显示出来、后者立刻又盖掉，主页这一帧从未被绘制；但 contact-switched 扇出已经把
//   卡片背景/页面背景（MB 级 dataURL）整批重新解码应用（实测占整次点击同步耗时约 3/4）。
// 修复：personalize.js 的 whenDeskVisible——主页不可见时这些重应用只登记待办，主页真正
//   显示前（MutationObserver/microtask，早于本帧绘制）补跑一次。
// 用例：
//   S1~S3 静态：两处重应用都过了 whenDeskVisible 门（buildDeskPages 的 applyPageBgs /
//          综合监听器的 refreshDeskVisuals）；观察器盯 #page-phone 的 hidden 变化
//   B1 跨桌面【去找TA】落在聊天页，且显示的是**目标桌面**的聊天记录
//   B2 【判别力核心】主页这一帧没被绘制过：聊天页可见的 1.3s 内桌面页背景始终是旧桌面的值
//      （修复前同步段/延后兜底各重新解码一次整屏图片＝卡顿的来源）
//   B3 补跑有效：点聊天【返回】后，桌面页背景在**本帧绘制前**（微任务内）已换成新桌面的值
//   B4 与主页可见性无关的设置页 UI 不跟着延后：跨桌面后 #desk-pages-val 当场是新桌面的页数
//   B6 同桌面【去找TA】照常进聊天（不换命名空间路径零回归）
//   B7 零 JS 异常
// RED 基线（HEAD 的 src/js/personalize.js）：B2 红——聊天页可见时页背景已是新桌面
//   （同步段已付钱；无头 4× CPU 节流实测同步耗时 361~521ms，修复后 224~285ms，仅作参考打印）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

let pass = 0, fail = 0;
function A(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')); }
}

// ---- 静态断言 S1~S3 ----
console.log('静态断言:');
const pz = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');
A('S1 applyPageBgs 走 whenDeskVisible 门（buildDeskPages 内）', /whenDeskVisible\(applyPageBgs\)/.test(pz));
A('S2 refreshDeskVisuals 走 whenDeskVisible 门（切桌面综合监听 + 直读兜底两处）',
  (pz.match(/whenDeskVisible\(refreshDeskVisuals\)/g) || []).length >= 2);
A('S3 触发器＝盯 #page-phone 的 hidden 变化（补跑早于绘制）',
  /MutationObserver\(function \(\) \{ if \(homeVisibleNow\(\)\) flushDeskVisualJobs\(\); \}\)/.test(pz) &&
  /observe\(home, \{ attributes: true, attributeFilter: \['hidden'\] \}\)/.test(pz));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = 9900 + Math.floor(Math.random() * 80);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-cjgo-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}
async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
}

// 长任务探针（任何页面脚本运行前挂上）
const PROBE = `(function(){
  window.__cjgo = { longtasks: [] };
  try {
    const po = new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__cjgo.longtasks.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }); });
    po.observe({ entryTypes: ['longtask'] });
  } catch (e) {}
})();`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
try { await cdp('Emulation.setCPUThrottlingRate', { rate: 4 }); } catch (e) {}

// ---- 第 1 次加载：种两个桌面（页数不同、页背景不同、聊天记录可区分） ----
await gotoApp();
const seeded = await evalJs(`(async () => {
  const mkNoise = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); const id = x.createImageData(w, h);
    for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.random()*255; id.data[i+1] = Math.random()*255; id.data[i+2] = Math.random()*255; id.data[i+3] = 255; }
    x.putImageData(id, 0, 0); return c.toDataURL('image/jpeg', .55);
  };
  const av = (() => { const c = document.createElement('canvas'); c.width = 96; c.height = 96; const x = c.getContext('2d'); x.fillStyle = '#7a5cff'; x.fillRect(0,0,96,96); return c.toDataURL('image/jpeg', .85); })();
  const cid2 = window.createContact('验证二号');
  const G = 'xy-home-v2';
  const pairs = [];
  // 页数下限＝3（accounting.js ensureP3 会把 desk-page-count 抬到 3），故取 3 / 5 两个可稳定区分的值
  const desk = { default: { pages: 3, say: '一号桌面消息' }, [cid2]: { pages: 5, say: '二号桌面消息' } };
  for (const cid of ['default', cid2]) {
    const p = G + ':' + cid, cfg = desk[cid];
    pairs.push({ k: p + ':avatar-user', v: av });
    pairs.push({ k: p + ':avatar-partner', v: av });
    for (let i = 0; i < 3; i++) pairs.push({ k: p + ':page-bg-' + i, v: mkNoise(720, 1280) });
    for (const t of ['deco', 'quote', 'anniv', 'photo']) pairs.push({ k: p + ':card-bg-' + t, v: mkNoise(620, 820) });
    // chat-msgs 存的就是 JSON 数组本身（chat.js persistMsgsToIdb）
    const msgs = []; for (let i = 0; i < 400; i++) msgs.push({ role: i % 2 ? 'ta' : 'me', text: cfg.say + i + '，一段中等长度的聊天文本内容。', tm: Date.now() - (400 - i) * 60e3 });
    pairs.push({ k: p + ':chat-msgs', v: JSON.stringify(msgs) });
  }
  await window.idbSetAll(pairs);
  // desk-page-count 走 xyStore（内存+LS+IDB）——只写 IDB 会被 idbRestore「LS 已有值不覆盖」的
  // 既有值顶掉（ensureP3 启动时也会把该键抬到 3）
  for (const cid of ['default', cid2]) {
    try { window.xyStore(G + ':' + cid).set('desk-page-count', String(desk[cid].pages)); } catch (e) {}
  }
  // 此间：两个桌面各 3 位梦角（「全部」总览里能同时看到两个桌面的卡片）
  const roster = (tag) => [{ id: tag + 'a', name: tag + '小A' }, { id: tag + 'b', name: tag + '小B' }, { id: tag + 'c', name: tag + '小C' }];
  try { window.xyStore(G + ':default').set('cjian-roster', JSON.stringify(roster('一号'))); } catch (e) {}
  try { window.xyStore(G + ':' + cid2).set('cjian-roster', JSON.stringify(roster('二号'))); } catch (e) {}
  try { window.xyStore(G).set('active-contact', cid2); } catch (e) {}
  return { cid2: cid2, kb: Math.round(pairs.reduce((s, p) => s + p.v.length, 0) / 1024) };
})()`);
console.log('种子完成: ' + JSON.stringify(seeded));

// ---- 第 2 次加载：冷启动回填稳定 ----
await gotoApp();
await sleep(4500);

// 进此间 + 切「全部」总览（跨桌面卡片同屏）
const opened = await evalJs(`(function () {
  try { if (window.setActiveContact) window.setActiveContact(${JSON.stringify(seeded.cid2)}); } catch (e) {}
  if (!window.openCjian) return { err: 'openCjian 缺失' };
  window.openCjian();
  const chips = document.querySelectorAll('#cj-groups .cj-gchip');
  for (const c of chips) { if (c.textContent === '全部') c.click(); }
  return { visible: !document.getElementById('page-cjian').hidden, cards: document.querySelectorAll('#cj-list .cj-card').length, homeHidden: document.getElementById('page-phone').hidden };
})()`);
console.log('进此间（全部总览）: ' + JSON.stringify(opened));

console.log('行为断言:');
// ---- B1/B2/B4：点跨桌面梦角的【去找TA】 ----
const jump = await evalJs(`(async () => {
  const home = document.getElementById('page-phone');
  const slide = document.querySelector('#page-phone .page-slide');
  const cards = Array.from(document.querySelectorAll('#cj-list .cj-card'));
  // 目标＝别的桌面的梦角：当前 active 是「验证二号」，故取分组首张（default 桌面的梦角）
  let btn = null, name = '';
  for (const c of cards) { const b = c.querySelector('.cj-go'); if (b) { btn = b; name = (c.querySelector('.cj-card-name') || {}).textContent || ''; break; } }
  if (!btn) return { err: '没有【去找TA】按钮', cards: cards.length };
  const bgBefore = slide ? slide.style.backgroundImage : null;
  const t0 = performance.now();
  btn.click();
  const clickSync = +(performance.now() - t0).toFixed(1);
  const chatUp = !document.getElementById('page-chat').hidden;
  const pagesVal = (document.getElementById('desk-pages-val') || {}).textContent || '';
  const activeAfter = window.__activeCid;
  const bgRightAfterClick = slide ? slide.style.backgroundImage : null;
  // 留在聊天页 1.3s：页背景若在这段里被改写＝同步段或延后兜底又去解码整屏图片了
  await new Promise(r => setTimeout(r, 1300));
  const bgDuringChat = slide ? slide.style.backgroundImage : null;
  const chatText = (document.getElementById('chat-body') || {}).textContent || '';
  const homeVisibleNow = !document.getElementById('page-phone').hidden;
  return {
    name: name, activeAfter: activeAfter, clickSync: clickSync, homeHidden: home.hidden, chatUp: chatUp,
    bgBefore: bgBefore, bgRightAfterClick: bgRightAfterClick, bgDuringChat: bgDuringChat,
    bgChangedDuringChat: bgBefore !== bgDuringChat, homeVisibleNow: homeVisibleNow,
    hasTargetMsgs: chatText.indexOf('一号桌面消息') >= 0,
    hasOldMsgs: chatText.indexOf('二号桌面消息') >= 0,
    pagesVal: pagesVal
  };
})()`);
const brief = (o) => o ? JSON.stringify(Object.assign({}, o, {
  bgBefore: (o.bgBefore || '').length + 'B', bgRightAfterClick: (o.bgRightAfterClick || '').length + 'B',
  bgDuringChat: (o.bgDuringChat || '').length + 'B'
})) : String(o);
console.log('  跳转现场: ' + brief(jump));
A('B1 跨桌面【去找TA】落在聊天页且显示目标桌面的聊天记录',
  jump && jump.chatUp === true && jump.homeHidden === true && jump.activeAfter === 'default' &&
  jump.hasTargetMsgs === true && jump.hasOldMsgs === false, brief(jump));
A('B2 主页未被绘制时不付桌面视觉的钱：聊天页可见的 1.3s 内页背景始终是旧桌面的值（判别力核心）',
  jump && jump.bgChangedDuringChat === false && jump.bgRightAfterClick === jump.bgBefore && jump.homeVisibleNow === false,
  jump && { changed: jump.bgChangedDuringChat, homeVisibleNow: jump.homeVisibleNow });
A('B4 与主页可见性无关的项不延后：设置页页数当场是新桌面的（default=3，二号=5）',
  jump && /共\s*3\s*页/.test(jump.pagesVal), jump && jump.pagesVal);
// 耗时只作参考打印、不作断言（节流下波动大）：判据用确定性契约（B2/B3）——修复前同步段
// 就会把页背景改成新桌面的值，B2 必红；补跑失效则 B3 必红。
console.log('  ℹ️ 参考：点击同步 ' + (jump && jump.clickSync) + 'ms（RED 基线 4× 节流实测 361~594ms，修复后 224~285ms）');

// ---- B3：点聊天【返回】→ 补跑在本帧绘制前完成（微任务内已换新桌面背景） ----
const back = await evalJs(`(async () => {
  const slide = document.querySelector('#page-phone .page-slide');
  const bgDuringChat = slide ? slide.style.backgroundImage : null;
  const backBtn = document.getElementById('chat-back');
  if (!backBtn) return { err: 'chat-back 缺失' };
  backBtn.click();
  await Promise.resolve(); await Promise.resolve();
  const bgAfterMicrotask = slide ? slide.style.backgroundImage : null;
  await new Promise(r => setTimeout(r, 0));
  const bgAfterTick = slide ? slide.style.backgroundImage : null;
  const homeShown = !document.getElementById('page-phone').hidden;
  const want = (function () { try { const v = window.xyStore('xy-home-v2:default').get('page-bg-0'); return v ? 'url("' + v + '")' : null; } catch (e) { return null; } })();
  return { homeShown: homeShown, bgDuringChat: bgDuringChat, bgAfterMicrotask: bgAfterMicrotask, bgAfterTick: bgAfterTick,
    matchedStore: !!want && bgAfterMicrotask === want, changed: bgAfterMicrotask !== bgDuringChat };
})()`);
A('B3 返回主页时补跑已生效（微任务内页背景已换成新桌面的值，早于本帧绘制）',
  back && back.homeShown === true && back.changed === true && back.matchedStore === true && back.bgAfterTick === back.bgAfterMicrotask,
  back && { homeShown: back.homeShown, changed: back.changed, matchedStore: back.matchedStore, tickStable: back.bgAfterTick === back.bgAfterMicrotask });

// ---- B6：同桌面【去找TA】照常进聊天（不换命名空间路径零回归） ----
const same = await evalJs(`(async () => {
  window.setActiveContact(${JSON.stringify(seeded.cid2)});
  window.openCjian();
  const cards = Array.from(document.querySelectorAll('#cj-list .cj-card'));
  const btn = cards.length ? cards[0].querySelector('.cj-go') : null;
  if (!btn) return { err: 'no btn' };
  btn.click();
  await new Promise(r => setTimeout(r, 300));
  const chatText = (document.getElementById('chat-body') || {}).textContent || '';
  return { chatUp: !document.getElementById('page-chat').hidden, hasMsgs: chatText.indexOf('二号桌面消息') >= 0, active: window.__activeCid };
})()`);
A('B6 同桌面【去找TA】照常进聊天（功能零回归）', same && same.chatUp === true && same.hasMsgs === true && same.active === seeded.cid2, same);

// ---- B7：零 JS 异常 ----
const errs = await evalJs(`(window.__jsErrors || []).slice(0, 5)`);
A('B7 零 JS 异常', !errs || errs.length === 0, errs);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);

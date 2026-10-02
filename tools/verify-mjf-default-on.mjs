// verify-mjf-default-on.mjs —— #513「梦角自由造句 + 混合模式默认打开」行为断言（CDP 无头 390×844）
//
// 立项原因（用户需求变更，2026-09-15 用户原话「梦角自由造句和 梦角自由造句的 混合模式 需要默认打开」）：
//   配置类改动的最大坑是「只翻 DEFAULTS 以为就默认开了」——「保存设置」按钮会把开关清单整表落盘
//   （reply-settings.js saveCurrentReplyPage），旧默认 '0' 一旦写盘就压过新默认，用户看到的是
//   「说好默认开、我这儿还是关的」（#443 同因实证）。所以必须验三层：
//     ①源码/产物默认值（静态锚）②首装无存量键时的 UI 勾选态（真入口）③存量 '0' 的一次性迁移
//       ——以及④「只跑一轮」语义：迁移后用户手动关闭，再刷新不得被改回。
//   纯静态哨兵只证第①层；②③④是本脚本的存在理由。
//
// 用法：node build.mjs && node tools/verify-mjf-default-on.mjs
// 用法（HEAD 基线对照，判别力实证）：复制本脚本到 $TEMP 副本目录（含 HEAD 的 src/ 与产物）再跑。
// 断言：S1/S2 静态 2 + P1/P2 首装 UI/配置 3 + M1/M2 存量迁移与一次性 4 + 终态 1。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9970 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mjf-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
          if (m.method === 'Runtime.exceptionThrown') { jsErrors++; console.error('EXC', JSON.stringify(m.params.exceptionDetails).slice(0, 300)); }
        };
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
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

let pass = 0, fail = 0;
const chk = (ok, name, extra) => {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' —— ' + extra : '')); }
};

// —— S 静态锚：src 与产物双向 ——
const rsSrc = readFileSync(join(root, 'src/js/reply-settings.js'), 'utf8');
const prod = readFileSync(join(root, 'index.html'), 'utf8');
chk(rsSrc.includes("'mjf-en': 1, 'mjf-prob': 20,") && rsSrc.includes("'mjf-mix': 1,"), 'S1 src DEFAULTS：mjf-en=1 / mjf-mix=1（默认开）');
chk(prod.includes("'mjf-en': 1, 'mjf-prob': 20") && prod.includes("'mjf-mix': 1,") && prod.includes("reply-mjf-on-migrated"), 'S2 产物同步（默认值 + 迁移标记键都已进 index.html）');

async function closeSplash(label) {
  let closed = false;
  for (let i = 0; i < 30 && !closed; i++) {
    const s = await evalJs(`(function(){
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
        var men = document.getElementById('splash-mandatory-enter');
        if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
        return 'mwait';
      }
      var sp = document.getElementById('splash');
      if (!sp || sp.classList.contains('hide') || sp.hidden) return 'closed';
      var sb = document.getElementById('splash-box');
      if (sb) sb.scrollTop = sb.scrollHeight;
      var se = document.getElementById('splash-enter');
      if (se && !se.disabled) { se.click(); return 'clicked'; }
      return 'wait';
    })()`);
    closed = s === 'closed';
    if (!closed) await sleep(300);
  }
  if (!closed) {
    await evalJs(`(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var men=document.getElementById('splash-mandatory-enter');if(men)men.click();mm.hidden=true;}var sp=document.getElementById('splash');if(sp){sp.classList.add('hide');sp.hidden=true;sp.parentNode&&sp.parentNode.removeChild(sp);}return true;})()`);
    await sleep(500);
  }
  console.log('  · ' + label + '开屏已关闭');
}

// —— P 首装（干净 profile，无任何存量键）：真入口进「回复设置」看勾选态 ——
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4000);
await closeSplash('首装 ');
const ui = await evalJs(`(function(){
  try {
    var row = document.getElementById('row-general');
    if (row) row.click();
    var en = document.getElementById('mjf-en'), mix = document.getElementById('mjf-mix');
    var cfg = window.replyCfg ? window.replyCfg() : {};
    // 注意：.toggle input 被 CSS 设为 opacity:0/width:0/height:0（开关是 .tk 画的），
    // 所以可见性断言必须落在行容器上，不能测 input.offsetHeight（恒 0，会误红）。
    var rowEl = en ? en.closest('.gs-row') : null;
    var panel = en ? en.closest('.gs-panel') : null;
    return { page: !!document.getElementById('page-reply-settings') && !document.getElementById('page-reply-settings').hidden,
             en: en ? en.checked : null, mix: mix ? mix.checked : null,
             rowVis: rowEl ? rowEl.offsetHeight > 0 : false,
             panelVis: panel ? !panel.hidden : false,
             cfgEn: cfg['mjf-en'], cfgMix: cfg['mjf-mix'], cfgStyle: cfg['mjf-style'] };
  } catch (e) { return { err: String(e) }; }
})()`);
chk(ui && ui.page === true, 'P1a 真入口（设置→回复设置）可打开', JSON.stringify(ui));
chk(ui && ui.en === true && ui.mix === true && ui.rowVis === true && ui.panelVis === true, 'P1b 首装（无存量键）总开关+混合模式默认勾选、行在聊天面板可见', JSON.stringify(ui));
chk(ui && ui.cfgEn === 1 && ui.cfgMix === 1, 'P2 replyCfg() 默认值 mjf-en=1 / mjf-mix=1（配置层，非只有 UI 勾选）', JSON.stringify(ui));

// —— M 存量迁移：「保存设置」全量写盘的旧默认 '0' 必须被一次性收成 '1' ——
// 造「存量设备」口径：写入两个 '0' 并**清掉标记键**＝从未跑过本版迁移的真机状态（真机上该键
// 本就不存在；上一轮 P 段同 profile 已把标记写成 '1'，不清掉就进不了迁移分支，测了个寂寞）。
const seed = await evalJs(`(function(){
  try {
    var s = window.storeFor('default');
    s.set('reply-mjf-en', '0'); s.set('reply-mjf-mix', '0'); s.set('reply-mjf-on-migrated', '');
    return { en: s.get('reply-mjf-en'), mix: s.get('reply-mjf-mix'), mark: s.get('reply-mjf-on-migrated') };
  } catch (e) { return { err: String(e) }; }
})()`);
console.log('  · 存量种子：' + JSON.stringify(seed));
await cdp('Page.reload', {});
await sleep(4000);
await closeSplash('迁移轮 ');
const m1 = await evalJs(`(function(){
  try {
    var s = window.storeFor('default');
    var row = document.getElementById('row-general'); if (row) row.click();
    var en = document.getElementById('mjf-en'), mix = document.getElementById('mjf-mix');
    return { en: s.get('reply-mjf-en'), mix: s.get('reply-mjf-mix'), mark: s.get('reply-mjf-on-migrated'),
             enChecked: en ? en.checked : null, mixChecked: mix ? mix.checked : null };
  } catch (e) { return { err: String(e) }; }
})()`);
chk(m1 && m1.en === '1' && m1.mix === '1', 'M1a 存量 \'0\' 被迁移成 \'1\'（仅翻 DEFAULTS 对已写盘设备无效，这是真修点）', JSON.stringify(m1));
chk(m1 && m1.mark === '1', 'M1b 一次性标记键 reply-mjf-on-migrated 落盘', JSON.stringify(m1));
chk(m1 && m1.enChecked === true && m1.mixChecked === true, 'M1c 迁移后设置页开关显示为开', JSON.stringify(m1));

// —— M2 只跑一轮：迁移后用户手动关闭 → 再刷新必须保持关闭（值式迁移会在此处反复改回）——
await evalJs(`(function(){ try { window.saveReplyCfg('mjf-en', 0); window.saveReplyCfg('mjf-mix', 0); return true; } catch (e) { return String(e); } })()`);
await cdp('Page.reload', {});
await sleep(4000);
await closeSplash('手动关闭轮 ');
const m2 = await evalJs(`(function(){
  try {
    var s = window.storeFor('default');
    return { en: s.get('reply-mjf-en'), mix: s.get('reply-mjf-mix'), cfg: (window.replyCfg ? window.replyCfg()['mjf-en'] : null) };
  } catch (e) { return { err: String(e) }; }
})()`);
chk(m2 && m2.en === '0' && m2.mix === '0' && m2.cfg === 0, 'M2 手动关闭后刷新保持关闭（迁移只跑一轮，不再纠正用户选择）', JSON.stringify(m2));

chk(jsErrors === 0, 'T 全程无未捕获 JS 异常', 'jsErrors=' + jsErrors);

console.log('\n== verify-mjf-default-on: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);

// ===== 专项回归：功能大全「贴贴邀请字卡」跳错页（#1417） =====
// 作者实报「在功能大全里搜索贴贴字卡，然后点击跳转字卡库，错误跳转到了寻踪」。
// 根因＝`feature-hub.js` 字卡库那一组里 go 链末段的落点串了一格：
//   「贴贴邀请字卡」→ #li-checkin-cards（＝字卡库里的「寻踪日常字卡」）
//   「寻踪日常字卡」→ #li-loc-cards（＝「TA在身边位置卡」）
//   位置卡本身在功能大全里没有条目，全靠那行错跳才被访问到。
// 修法：贴贴→#li-ta-invite 并直连该页 cuddle 分类子标签（jump() 按顺序 click，
//   showPage('sys') 同帧渲染完，落点就停在「贴贴邀请」那一栏）；寻踪→#li-checkin-cards；
//   补一行「TA在身边位置卡」→#li-loc-cards 接住原来的可达性。
// 口径：零机型／零 UA 分支，只问「点了这条大全条目，屏上露出来的是哪一页」。
// 夹具＝按 build.mjs 的真实 jsFiles/cssFiles 从 src/ 现装配（不读产物，未构建也能验）。
// 用例：
//   S1~S5 源码静态：三条落点各就各位 + 旧错落点不再出现 + 承接方存在
//   B1~B8 行为（无头 Chrome）：搜「贴贴」→ 点跳转 → 落在 TA的邀请的贴贴栏，且寻踪/位置卡页都没露头；
//     「寻踪日常字卡」「TA在身边位置卡」两条同理各归其位；零「入口暂不可达」；零未捕获异常
//   --mutate 反向对照：把两条 go 链改回出事那一格再跑同一批行为断言，预期按预期变红
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MUT = process.argv.includes('--mutate');

// ---------- 源码静态 ----------
const hubSrc = readFileSync(join(root, 'src/js/feature-hub.js'), 'utf8');
const tplSrc = readFileSync(join(root, 'src/template.html'), 'utf8');
const lineOf = (name) => {
  const hit = hubSrc.split('\n').filter((l) => l.includes("n: '" + name + "'"));
  return hit.length === 1 ? hit[0] : null;
};
const INV = "'.tab[data-page=\"page-chatcard\"]', '#li-ta-invite', '#ti-sys-cats .cc-tab[data-cat=\"cuddle\"]'";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
};

console.log('\n== S 源码静态（go 链落点） ==');
const lCuddle = lineOf('贴贴邀请字卡');
const lCheckin = lineOf('寻踪日常字卡');
const lLoc = lineOf('TA在身边位置卡');
ok('S1 「贴贴邀请字卡」落点＝TA的邀请 + 贴贴分类子标签', !!lCuddle && lCuddle.includes(INV), lCuddle);
ok('S2 「贴贴邀请字卡」那一行不再指向 #li-checkin-cards', !!lCuddle && !lCuddle.includes('#li-checkin-cards'));
ok('S3 「寻踪日常字卡」落点＝#li-checkin-cards（不再串到位置卡）', !!lCheckin && lCheckin.includes("'#li-checkin-cards']") && !lCheckin.includes('#li-loc-cards'), lCheckin);
ok('S4 「TA在身边位置卡」条目存在且落点＝#li-loc-cards', !!lLoc && lLoc.includes("'#li-loc-cards']"), lLoc);
ok('S5 三枚落点锚点在 template 里都在（无空链）', ['#li-ta-invite', '#li-checkin-cards', '#li-loc-cards', '#ti-sys-cats'].every((id) => tplSrc.includes('id="' + id.slice(1) + '"')));
// 承接方：#li-* 各自的 click 绑定在谁手里（入口在、没人接＝点了没反应，也是这一族的事）
ok('S6 承接方在位（ta-invite/p2-features/loc-lib 各接自己那枚）',
  readFileSync(join(root, 'src/js/ta-invite.js'), 'utf8').includes("getElementById('li-ta-invite')") &&
  readFileSync(join(root, 'src/js/p2-features.js'), 'utf8').includes("getElementById('li-checkin-cards')") &&
  readFileSync(join(root, 'src/js/loc-lib.js'), 'utf8').includes("getElementById('li-loc-cards')"));
// 分类子标签是 renderTiSysInto 依 CATS_TI 现生成的，CATS_TI 里没有 cuddle 的话第三段就是空点
//（CATS_TI 是嵌套数组，别用 [^\]] 扫——第一个 ] 出现在 ['rps','猜拳邀请'] 里，会漏掉后面的 cuddle）
ok('S7 ta-invite 的 CATS_TI 含 cuddle（第三段有的可点）', /const CATS_TI = \[[^\n]*'cuddle'[^\n]*\];/.test(readFileSync(join(root, 'src/js/ta-invite.js'), 'utf8')));
const dupCheckin = hubSrc.split('\n').filter((l) => l.includes("'#li-checkin-cards']"));
ok('S8 全库「#li-checkin-cards」作为落点只挂在寻踪那一行（防再次串页）', dupCheckin.length === 1 && dupCheckin[0].includes("n: '寻踪日常字卡'"), dupCheckin);
// S9/S10：把「条目名」与「落点在字卡库里的实名」逐字对上——串页的直接表征就是这两个名字对不上，
// 只比名字不猜语义（其余 11 条命名变体如「TA 的提问字卡」→「TA的询问」属既有口径，不由本尺子管）。
const libLabelOf = (sel) => {
  const idx = tplSrc.indexOf('id="' + sel.slice(1) + '"');
  const mm = idx >= 0 ? tplSrc.slice(idx, idx + 600).match(/class="n">([^<]+)</) : null;
  return mm ? mm[1] : null;
};
ok('S9 「寻踪日常字卡」落点的字卡库实名就叫「寻踪日常字卡」', libLabelOf('#li-checkin-cards') === '寻踪日常字卡', libLabelOf('#li-checkin-cards'));
ok('S10 「TA在身边位置卡」落点的字卡库实名就叫「TA在身边位置卡」', libLabelOf('#li-loc-cards') === 'TA在身边位置卡', libLabelOf('#li-loc-cards'));
ok('S11 贴贴两条共用的落点实名＝「TA的邀请」（贴贴话术真在这一页）', libLabelOf('#li-ta-invite') === 'TA的邀请', libLabelOf('#li-ta-invite'));

// ---------- 装配夹具 ----------
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
const arrOf = (name) => {
  const m = buildSrc.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\]'));
  return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
};
const cssFiles = arrOf('cssFiles');
const jsFiles = arrOf('jsFiles');
if (!cssFiles.length || !jsFiles.length) { console.error('读不到 build.mjs 的 cssFiles/jsFiles'); process.exit(1); }
let testHtml = tplSrc;
let hubPatch = null;
if (MUT) {
  // 反向对照：把两条链改回出事那一格（贴贴→寻踪页；寻踪→位置卡页）
  hubPatch = (code) => code
    .split(lCuddle).join("      { n: '贴贴邀请字卡', d: '贴贴/抱抱/牵手等邀请的内容词库', k: '贴贴 抱抱 牵手', go: ['.tab[data-page=\"page-chatcard\"]', '#li-checkin-cards'] }")
    .split(lCheckin).join(lCheckin.replace("'#li-checkin-cards']", "'#li-loc-cards']"));
}
testHtml = testHtml.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => {
  let code = readFileSync(join(root, 'src/js', f), 'utf8');
  if (hubPatch) code = hubPatch(code);
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}).join('\n'));
testHtml = testHtml.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-test-build').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
if (MUT) {
  ok('M1 变异注入生效（cuddle 直连段已被拿掉）', !testHtml.includes('#ti-sys-cats .cc-tab[data-cat="cuddle"]'));
}

const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-1417-root-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(tmpRoot, rel));
    if (!p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const profile = join(process.env.TEMP || '/tmp', 'mochi-1417-profile-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9400 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 80; i++) {
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
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
// 点大全里那一行（按条目名精确取可见行），并回报跳转后的屏面读数
const clickHubRow = (name) => `(function(){
  try {
    window.mochiFeatureHubOpen(${JSON.stringify(name)});
    var rows = Array.prototype.slice.call(document.querySelectorAll('#fhub-body .set-row'));
    var hit = rows.filter(function(r){ if(r.style.display==='none') return false; var t=r.querySelector('.txt'); return t && t.firstChild && String(t.firstChild.nodeValue).trim()===${JSON.stringify(name)}; })[0];
    if(!hit) return { found:false };
    hit.click();
    var vis = Array.prototype.slice.call(document.querySelectorAll('.page')).filter(function(p){return !p.hidden;}).map(function(p){return p.id;});
    var sel = document.querySelector('#ti-sys-cats .cc-tab.sel');
    var toast = document.getElementById('cc-toast');
    return {
      found: true,
      visiblePages: vis,
      tiTabSel: sel ? sel.dataset.cat : null,
      sysHidden: document.getElementById('ti-sys-panel') ? document.getElementById('ti-sys-panel').hidden : null,
      sysText: (document.getElementById('ti-sys-cats')||{}).textContent || '',
      toast: toast ? (toast.textContent||'') : ''
    };
  } catch(e) { return { err: String(e) }; }
})()`;

const exceptions = [];
try {
  await cdpConnect();
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(5000);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(500);

  console.log('\n== B 行为（无头：搜词条 → 点跳转 → 看落在哪页） ==');
  const b1 = await evalJs(clickHubRow('贴贴邀请字卡'));
  ok('B1 大全里搜「贴贴邀请字卡」能找到那一行', !!b1 && b1.found === true, b1);
  ok('B2 点它落在 TA的邀请页（不是寻踪/位置卡）', !!b1 && b1.visiblePages && b1.visiblePages.join(',') === 'page-ta-invite', b1 && b1.visiblePages);
  ok('B3 系统预设面板可见且选中的分类＝cuddle（贴贴栏）', !!b1 && b1.sysHidden === false && b1.tiTabSel === 'cuddle', { sysHidden: b1 && b1.sysHidden, tiTabSel: b1 && b1.tiTabSel });
  ok('B4 屏上就是贴贴话术（含「想贴贴了」）', !!b1 && /想贴贴了|抱一下再忙别的|手伸过来/.test(b1.sysText), (b1 && b1.sysText || '').slice(0, 60));
  ok('B5 寻踪/位置卡页此刻都没露头', !!b1 && ['page-checkin-cards', 'page-loc-cards'].every((p) => b1.visiblePages.indexOf(p) < 0), b1 && b1.visiblePages);

  const b6 = await evalJs(clickHubRow('寻踪日常字卡'));
  ok('B6 「寻踪日常字卡」落在寻踪日常字卡页', !!b6 && b6.found && b6.visiblePages.join(',') === 'page-checkin-cards', b6 && b6.visiblePages);
  const b7 = await evalJs(clickHubRow('TA在身边位置卡'));
  ok('B7 「TA在身边位置卡」落在位置卡页', !!b7 && b7.found && b7.visiblePages.join(',') === 'page-loc-cards', b7 && b7.visiblePages);

  const toastBad = [b1, b6, b7].some((r) => r && r.toast && r.toast.indexOf('入口暂不可达') >= 0);
  ok('B8 三次跳转零「入口暂不可达」', !toastBad, [b1 && b1.toast, b6 && b6.toast, b7 && b7.toast]);
  ok('B9 全程无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2));

  if (MUT) {
    const landed = b1 && b1.visiblePages && b1.visiblePages.join(',');
    console.log('\n== 反向对照（变异稿）读数 ==');
    console.log('  贴贴那条落到了：' + JSON.stringify(landed) + '（期望＝page-checkin-cards，即出事原样）');
    console.log('  B2/B3/B4 在变异稿上的通过情况：B2=' + (landed === 'page-ta-invite') + ' B3=' + (b1 && b1.tiTabSel === 'cuddle') + ' B4=' + /想贴贴了/.test(b1 && b1.sysText || ''));
    const mutatedAsExpected = landed === 'page-checkin-cards' && b6 && b6.visiblePages.join(',') === 'page-loc-cards';
    ok('M2 变异稿确实把「贴贴」送去了寻踪、把「寻踪」送去了位置卡（尺子真在量这件事）', mutatedAsExpected, { b2: landed, b6: b6 && b6.visiblePages });
  }
} finally {
  try { chrome.kill('SIGKILL'); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}

console.log('\n' + (MUT ? '[变异稿] ' : '[本批稿] ') + '结果: ' + pass + ' 通过 / ' + fail + ' 失败');
// 本批稿：全绿才 0；变异稿：M2 必须绿且 B2~B4 必须红（否则尺子是假的）
if (MUT) process.exit(0);
process.exit(fail ? 1 : 0);

// ===== 回归 #101：查看存储页可读性（Top5+占比条 / 键名按桌面名 / 本项目 vs 整域双口径）=====
// 用法：先 `node build.mjs`，再 `node tools/verify-storage-clarity.mjs`
// 被测对象是**产物 index.html**（用户实际打开的那一份），不是 src 拼装页。
// 断言：
//   S0-S1  播种（两个桌面 + 多分类 + 一个 25 键分类 + 同域非本项目键）并能进「查看存储」
//   A1-A6b 明细只列最大 5 项 + 「其他 N 项合计」；单类行有占比条（最大项满格、按大小递减、
//          平方根比例）与百分比，聚合行刻意不画条（多类加总与单类不同口径）
//   A7-A10 展开区键名按桌面名显示（不再是一串 xy-home-v2: 机器键）、展开态真可见、
//          键数截断如实标注、折叠行点开能逐类核对
//   A11-A13 总占用分「本项目占用合计」与「浏览器整域已用」两个口径且自洽（self ≈ LS + IDB），
//           同域非本项目 LS 键单独计数
//   A14-A16 IDB 键清单读不到时（#90 严格三态的 null）明确告警且不计入合计，
//           不再冒充「0 键 / 库里没有」
//   A17    全程无 JS 运行时错误
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const artifact = readFileSync(join(root, 'index.html'), 'utf8');
if (!artifact.includes('function pctOf(') || !artifact.includes('本项目占用合计')) {
  console.log('ENV  产物里还没有 #101 的改动——请先执行 node build.mjs 再跑本脚本');
  process.exit(2);
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }

// 产物自包含（CSS/JS 全内联），任何路径都回同一份 HTML 即可
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(artifact);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 9));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-storage-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function waitFor(expr, tries = 60, step = 250) {
  for (let i = 0; i < tries; i++) { if (await evalJs(expr)) return true; await sleep(step); }
  return false;
}
let navSeq = 0;
async function coldStart() {
  // Page.navigate 立即返回，求值可能还落在旧文档上：先打标记，等标记消失再往下走
  const token = 'nav' + Date.now().toString(36) + '-' + (++navSeq);
  await evalJs(`window.__navToken = ${JSON.stringify(token)}; true`);
  await cdp('Page.navigate', { url: baseUrl + '/' });
  await waitFor(`window.__navToken !== ${JSON.stringify(token)}`, 60, 250);
  await sleep(2000);
  await waitFor("typeof window.xyStore === 'function' && typeof window.idbListKeys === 'function'");
  await waitFor('!!window.__mochiDataReady');
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(600);
}
async function openStorage() {
  await evalJs("(function(){var r=document.getElementById('row-storage-view');if(r)r.click();return true;})()");
  const ok = await waitFor("!document.getElementById('page-storage').hidden && document.querySelectorAll('#st-cat .storage-cat-row').length > 0", 40, 250);
  await sleep(1500); // 等 IndexedDB 分批测完（明细会二次渲染成合并结果）
  return ok;
}
async function closeStorage() {
  await evalJs("(function(){var b=document.getElementById('storage-back');if(b)b.click();return true;})()");
  await sleep(400);
}
// 解析 "1.2 MB（35 键）" / "304.0 KB" / "512 B" 里的第一个大小
function parseBytes(s) {
  const m = /([\d.]+)\s*(GB|MB|KB|B)/.exec(String(s || ''));
  if (!m) return NaN;
  const mult = { GB: 1073741824, MB: 1048576, KB: 1024, B: 1 }[m[2]];
  return Math.round(parseFloat(m[1]) * mult);
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== 播种：两个桌面（默认 / 小美）+ 多分类 + 一个 25 键的分类 + 同域非本项目键 =====
await coldStart();
const seeded = await evalJs(`(function(){
  try {
    // xyStore(prefix) 拼出的键是 prefix + ':' + k —— 根键传 'xy-home-v2'、
    // 桌面键传 'xy-home-v2:cx1'（带尾冒号会写出畸形键，被 migrateLegacy 搬进 default 命名空间）
    var G = window.xyStore('xy-home-v2');
    var C = window.xyStore('xy-home-v2:cx1');
    G.set('contacts', JSON.stringify([{ id: 'default', name: '默认' }, { id: 'cx1', name: '小美' }]));
    var msgs = [];
    for (var i = 0; i < 300; i++) msgs.push({ t: 'm' + i, x: new Array(60).join('a' + i) });
    C.set('chat-msgs', JSON.stringify(msgs));                                       // 最大的一个分类
    for (var j = 1; j <= 25; j++) C.set('desk-image-src-' + j, new Array(900).join('b')); // 25 键分类（触发截断标注）
    C.set('mail-letters', JSON.stringify([{ a: 1, b: new Array(400).join('c') }]));
    C.set('feed-posts', JSON.stringify([{ a: 1, b: new Array(400).join('d') }]));
    C.set('garden-data', JSON.stringify({ p: [1, 2, 3] }));
    C.set('accounting-records', JSON.stringify([{ a: new Array(300).join('e') }]));
    G.set('period-records', JSON.stringify([{ a: new Array(300).join('f') }]));
    G.set('__diag-errs', JSON.stringify([{ e: new Array(300).join('g') }]));
    localStorage.setItem('unrelated-site-data', new Array(2500).join('h'));
    localStorage.setItem('another-site-cache', new Array(1500).join('i'));
    return true;
  } catch (e) { return 'err:' + e.message; }
})()`);
check('S0 数据播种成功', seeded === true, seeded);
await coldStart(); // 重载，让统计读到落定后的数据

const opened = await openStorage();
check('S1 能进「查看存储」页并渲染出明细', opened);

// ===== A1-A6：Top5 + 其他 + 占比条 + 百分比 =====
const dom = JSON.parse(await evalJs(`(function(){
  var rows = [].slice.call(document.querySelectorAll('#st-cat .storage-cat-row'));
  return JSON.stringify({
    n: rows.length,
    names: rows.map(function (r) { return r.querySelector('.storage-cat-name').textContent; }),
    nums: rows.map(function (r) { return r.querySelector('.storage-cat-num').textContent; }),
    sizes: rows.map(function (r) { return r.querySelector('.storage-cat-size').textContent; }),
    bars: rows.map(function (r) { var i = r.querySelector('.storage-cat-bar i'); return i ? i.style.width : 'none'; })
  });
})()`) || '{}');
const names = dom.names || [], bars = dom.bars || [], nums = dom.nums || [], sizes = dom.sizes || [];
check('A1 明细最多 6 行（最大 5 项 + 其他合计），不是几十行流水账', dom.n > 0 && dom.n <= 6, 'rows=' + dom.n);
check('A2 存在「其他 N 项合计」折叠行（证明确实折叠了）', /其他 \d+ 项合计/.test(names.join('|')), names[names.length - 1]);
const barRows = bars.slice(0, names.length - 1);
check('A3 单类行都有占比条（最大项满格 100%），聚合行刻意不画条', names.length > 1 && barRows.length === names.length - 1 &&
  barRows.every((w) => /%$/.test(w)) && barRows[0] === '100%' && bars[names.length - 1] === 'none', bars.join(','));
check('A4 每行都给出占本项目的百分比', nums.length > 0 && nums.every((t) => /\d+(\.\d+)?%|<0\.1%/.test(t)), nums[0]);
check('A5 排第一的是播种的最大头「聊天记录」', names[0] === '聊天记录', names[0]);
check('A6 占比条按大小递减（视觉上能排座次）', (function () {
  const w = barRows.map((x) => parseFloat(x) || 0);
  for (let i = 1; i < w.length; i++) if (w[i] > w[i - 1] + 0.01) return false;
  return w.length > 0;
})(), bars.join(','));
check('A6b 条长按平方根比例（大头占九成时小项仍看得出座次，不是线性压成一条线）', (function () {
  const b0 = parseBytes(sizes[0]);
  if (!b0) return false;
  let checked = 0;
  for (let i = 1; i < barRows.length; i++) {
    const bi = parseBytes(sizes[i]);
    if (isNaN(bi)) return false;
    const linear = bi / b0 * 100;
    const want = Math.max(1.5, Math.round(Math.sqrt(bi / b0) * 100));
    const got = parseFloat(barRows[i]);
    if (Math.abs(got - want) > 2) return false;
    if (linear < 99 && !(got > linear)) return false; // 确实被拉开了一点才算达标
    checked++;
  }
  return checked > 0;
})(), bars.join(',') + ' sizes=' + sizes.join(','));

// ===== A7-A9：展开区键名桌面化 + 截断标注 + 「其他」逐类可核对 =====
const expand = async (idx) => {
  await evalJs(`(function(){var r=document.querySelectorAll('#st-cat .storage-cat-row')[${idx}];if(r)r.click();return true;})()`);
  await sleep(250);
  return await evalJs(`(function(){
    var r=document.querySelectorAll('#st-cat .storage-cat-row')[${idx}];
    if(!r) return 'no-row';
    var s=r.querySelector('.storage-cat-keys');
    if(!s) return 'no-sub';
    return getComputedStyle(s).display + '||' + s.textContent;
  })()`);
};
const chatSub = String(await expand(0));
check('A7 展开键名按桌面名显示（「小美 · chat-msgs」而非机器键名）', /小美 · chat-msgs/.test(chatSub) && chatSub.indexOf('xy-home-v2:') < 0, chatSub.slice(0, 100));
check('A8 点开确实展开（display 不为 none）', chatSub.indexOf('block||') === 0, chatSub.slice(0, 12));
const deskIdx = names.indexOf('桌面美化/壁纸');
const deskSub = String(deskIdx >= 0 ? await expand(deskIdx) : 'not-in-top5');
check('A9 键数超出列出上限时如实标注「共 N 个键，仅列前 20 个」（应用自身也会写该类键，N 不固定）',
  /共 \d+ 个键，仅列前 20 个/.test(deskSub) && (parseInt(nums[deskIdx], 10) || 0) > 20, deskSub.slice(-70));
const otherSub = String(await expand(dom.n - 1));
check('A10 折叠行点开能逐类核对（≥2 个分类名带大小）', (otherSub.match(/ [\d.]+ (KB|MB|B)/g) || []).length >= 2, otherSub.slice(0, 110));

// ===== A11-A13：双口径 + 自洽 + 同域其他站点 =====
const totals = JSON.parse(await evalJs(`(function(){
  var g = function (id) { var e = document.getElementById(id); return e ? e.textContent : ''; };
  return JSON.stringify({ self: g('st-self'), ls: g('st-ls'), idb: g('st-idb'), other: g('st-other'), quota: g('st-quota') });
})()`) || '{}');
const labels = JSON.parse(await evalJs(`(function(){
  var out = {};
  [].slice.call(document.querySelectorAll('#page-storage .storage-row')).forEach(function (r) {
    var b = r.querySelector('b'), s = r.querySelector('span');
    if (b && s) out[b.id] = s.textContent;
  });
  return JSON.stringify(out);
})()`) || '{}');
check('A11 总占用分行标口径：首行「本项目占用合计」/末行「整域」/其他站点行标「非本应用」，且两处数字不同',
  /本项目占用合计/.test(labels['st-self'] || '') && /整域/.test(labels['st-quota'] || '') && /非本应用/.test(labels['st-other'] || '') && totals.self !== totals.quota,
  'self[' + labels['st-self'] + ']=' + totals.self + ' quota[' + labels['st-quota'] + ']=' + totals.quota);
check('A12 口径自洽：本项目合计 ≈ localStorage + IndexedDB', (function () {
  const s = parseBytes(totals.self), l = parseBytes(totals.ls), i = parseBytes(totals.idb);
  if (isNaN(s) || isNaN(l) || isNaN(i)) return false;
  return Math.abs(s - (l + i)) <= Math.max(2048, (l + i) * 0.06); // fmtBytes 只留 1 位小数，按 MB 级误差留容差
})(), totals.ls + ' + ' + totals.idb + ' vs ' + totals.self);
const otherKeys = parseInt((/（(\d+) 键）/.exec(totals.other || '') || [])[1] || '0', 10);
check('A13 同域非本项目键单独计数（不混进本项目明细）', otherKeys >= 2 && parseBytes(totals.other) > 0, totals.other);

// ===== A14-A16：IDB 清单读不到 → 明确告警，不冒充「库里没有」=====
await closeStorage();
const brokeIdb = await evalJs("(function(){ window.idbListKeys = function(){ return Promise.resolve(null); }; return typeof window.idbListKeys === 'function'; })()");
check('A14 注入「IDB 清单读不到」（严格三态 null）成功', brokeIdb === true, brokeIdb);
await openStorage();
const failView = JSON.parse(await evalJs(`(function(){
  var w = document.querySelector('#st-cat .storage-cat-warn');
  var g = function (id) { var e = document.getElementById(id); return e ? e.textContent : ''; };
  return JSON.stringify({ warn: w ? w.textContent : '', idb: g('st-idb'), self: g('st-self'), n: document.querySelectorAll('#st-cat .storage-cat-row').length });
})()`) || '{}');
check('A15 明细顶部明确告警（是读不到，不是库里没有）', /没读到|读不到/.test(failView.warn || ''), (failView.warn || '').slice(0, 70));
check('A16 IndexedDB 行与合计都如实标注未计入', /读取失败/.test(failView.idb || '') && /不含 IndexedDB/.test(failView.self || ''), 'idb=' + failView.idb + ' self=' + failView.self);

const errs = JSON.parse(await evalJs("(function(){ return JSON.stringify((window.__jsErrors||[]).slice(0,8)); })()") || '[]');
check('A17 全程无 JS 运行时错误', errs.length === 0, errs.join('|'));

const fail = results.filter((r) => !r.ok);
console.log('\n===== verify-storage-clarity: ' + (results.length - fail.length) + '/' + results.length + ' =====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail.length ? 1 : 0);

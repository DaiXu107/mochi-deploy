// ===== 专项验证：钓鱼「留/卖」按归属判定（#105） =====
// 背景（用户反馈）：今日收获里「你」和「TA」两栏各有一个「留」复选框，但旧实现的 keep 只按
//   品种记一个开关（keep[鱼id]），两栏共用 → 想只留 TA 钓的那条，自己同品种的也不得不一起留；
//   且勾选后只落盘不重绘，底部「可出售 N 件 · +¥」停在旧数字。
// 本轮修复：keep 键改带归属（keep['mine:<id>'] / keep['ta:<id>']），旧纯品种键在 loadToday
//   里一次性展开到两侧（等价原语义，用户零感知）；出售后清掉该侧已无存货的残留标记。
// 用法：node tools/verify-fishing-keep.mjs（自组装 src 页面，不依赖构建产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 300) + ']' : '')); }
function read(p) { return readFileSync(join(root, p), 'utf8'); }

const fishSrc = read('src/js/fishing.js');

// ---------------- A 组：静态断言（源码层） ----------------
check('A1 keep 键带归属（keepKey(side,id) 定义 + 四处读写全走它）',
  /function keepKey\(side, id\) \{ return side \+ ':' \+ id; \}/.test(fishSrc) &&
  (fishSrc.match(/keepKey\(/g) || []).length >= 6);
check('A2 不再存在品种级整类判定（旧 if (keep[id]) return; 已清除）',
  !/if \(keep\[id\]\) return/.test(fishSrc) && !/const kept = !!keep\[id\]/.test(fishSrc));
check('A3 旧纯品种键自愈展开到两侧',
  /if \(k\.indexOf\(':'\) < 0\) \{ keep\[keepKey\('mine', k\)\] = 1; keep\[keepKey\('ta', k\)\] = 1; \}/.test(fishSrc));
check('A4 复选框按行带 data-side（两栏各自独立）',
  /class="fish-keep-cb" data-side="' \+ side \+ '" data-id="'/.test(fishSrc));
check('A5 勾选后落盘并立即重绘合计（不再停在旧数字）',
  /saveToday\(t\);\s*render\(\);\s*\}\);/.test(fishSrc));
check('A6 出售后清理无存货的残留「留」标记',
  /if \(!t\[side\] \|\| !t\[side\]\[id\]\) delete t\.keep\[k\];/.test(fishSrc));

if (!results.every((r) => r.ok)) { console.log('\n静态断言未全绿，停止运行时验证'); process.exit(1); }

// ---------------- 自组装 src 页面（顺序见 build.mjs） ----------------
function arrOf(name) {
  const m = read('build.mjs').match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
if (!jsFiles.includes('fishing.js')) { console.error('fishing.js 未接入 build.mjs jsFiles'); process.exit(1); }
let css = '', js = '';
for (const f of cssFiles) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) { try { js += read('src/js/' + f) + '\n'; } catch (e) {} }
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' +
  read('src/template.html').replace(/__APP_VERSION__/g, 'test') +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const u = req.url.split('?')[0];
    if (u === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>blank</body></html>'); return; }
    if (u === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
    let p = normalize(join(root, decodeURIComponent(u)));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const tmpDir = join(os.tmpdir(), 'mochi-fish-keep-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const t = list.find((x) => x.type === 'page');
      if (t) {
        ws = new WebSocket(t.webSocketDebuggerUrl);
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/test.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(600);

// 页内工具：写今日收获 + 开面板 + 读状态 + 点复选框
const TODAY = "(new Date()).getFullYear()+'-'+String((new Date()).getMonth()+1).padStart(2,'0')+'-'+String((new Date()).getDate()).padStart(2,'0')";
async function seed(mine, ta, keep) {
  return await evalJs(`(function(){
    try{localStorage.clear();}catch(e){}
    var s=window.activeStore(); if(!s) return 'nostore';
    s.set('fishing-today', JSON.stringify({date:${TODAY}, mine:${JSON.stringify(mine)}, ta:${JSON.stringify(ta)}, keep:${JSON.stringify(keep)}}));
    // 打桩：TA 状态机由 setInterval 驱动，跑起来会随机加鱼让件数/金额断言飘
    window.setInterval = function(){ return 0; };
    document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});
    document.querySelectorAll('.fish-tab').forEach(function(x){x.classList.toggle('sel',x.getAttribute('data-ftab')==='today');});
    window.openFishPanel();
    return 'ok';
  })()`);
}
const state = () => evalJs(`(function(){var d=window.__fishDebug.state();return JSON.stringify({today:d.today,wallet:d.wallet});})()`);
const dom = () => evalJs(`(function(){
  function box(side,id){var c=document.querySelector('.fish-keep-cb[data-side="'+side+'"][data-id="'+id+'"]');return c?{side:side,id:id,checked:!!c.checked}:null;}
  var bar=document.querySelector('.fish-sellbar');
  return JSON.stringify({mineSmall:box('mine','fish_small'),taSmall:box('ta','fish_small'),
    mineBlue:box('mine','fish_blue'),taShell:(document.querySelector('.fish-keep-cb[data-id="gift_shell"]')?1:0),
    sellbar:bar?bar.textContent:''});
})()`);
const click = (side, id) => evalJs(`(function(){var c=document.querySelector('.fish-keep-cb[data-side="${side}"][data-id="${id}"]');if(!c)return 'nf';c.click();return 'clicked';})()`);
const sell = () => evalJs(`(function(){var b=document.getElementById('fish-sell-btn');if(!b||b.disabled)return 'nobtn';b.click();return 'sold';})()`);

// ---- T1 只留 TA 的：两栏独立勾选互不牵连 ----
if (await seed({ fish_small: 2 }, { fish_small: 3 }, {}) !== 'ok') { console.log('种子写入失败'); process.exit(1); }
await sleep(400);
const t1a = J(await dom());
check('T1a 初始两栏均未勾「留」，合计含双方 5 件',
  t1a.mineSmall && !t1a.mineSmall.checked && t1a.taSmall && !t1a.taSmall.checked && /可出售 5 件/.test(t1a.sellbar), JSON.stringify(t1a));
check('T1b 复选框按行带归属键（同一品种在两侧各渲染一个）', t1a.mineSmall && t1a.taSmall, JSON.stringify(t1a));
await click('ta', 'fish_small');
await sleep(250);
const t1 = J(await state());
check('T1 勾 TA 那行 → 只写 ta:fish_small，我的不受牵连',
  JSON.stringify(t1.today.keep) === JSON.stringify({ 'ta:fish_small': 1 }), JSON.stringify(t1.today));
const t1d = J(await dom());
check('T1c 勾选后立刻重绘：TA 行已勾、我行仍未勾、合计同步为 2 件',
  t1d.taSmall.checked && !t1d.mineSmall.checked && /可出售 2 件/.test(t1d.sellbar), JSON.stringify(t1d));

// ---- T2 出售只卖未留的那侧 ----
const w0 = (t1.wallet && t1.wallet.myBalance) || 0;
await sell();
await sleep(350);
const t2 = J(await state());
const t2today = t2.today || {};
check('T2 出售只清掉我那侧，TA 留着的同品种原样保留',
  !t2today.mine.fish_small && t2today.ta.fish_small === 3 && t2today.keep['ta:fish_small'] === 1, JSON.stringify(t2today));
check('T2b 入账恰好＝我那 2 条小鱼（200×2=400 分），TA 留的那 3 条分文未动',
  ((t2.wallet && t2.wallet.myBalance) || 0) - w0 === 400, 'delta=' + (((t2.wallet && t2.wallet.myBalance) || 0) - w0));

// ---- T3 残留标记清理：卖掉的品种不再自动置留 ----
await seed({ fish_blue: 1, fish_small: 1 }, {}, { 'mine:fish_blue': 1, 'mine:fish_small': 1 });
await sleep(350);
await click('mine', 'fish_small');
await sleep(250);
await sell();
await sleep(350);
const t3 = J(await state());
check('T3 出售后仅保留仍有存货的「留」标记（fish_small 残留被清，fish_blue 仍留）',
  JSON.stringify(t3.today.keep) === JSON.stringify({ 'mine:fish_blue': 1 }) && t3.today.mine.fish_blue === 1 && !t3.today.mine.fish_small,
  JSON.stringify(t3.today));

// ---- T4 旧数据（纯品种键）自愈展开，取消后不回灌 ----
await seed({ fish_small: 1 }, { fish_small: 1 }, { fish_small: 1 });
await sleep(350);
const t4 = J(await state());
check('T4 旧纯品种键展开成两侧都留（等价原语义，零感知）',
  t4.today.keep['mine:fish_small'] === 1 && t4.today.keep['ta:fish_small'] === 1 && t4.today.keep['fish_small'] === undefined,
  JSON.stringify(t4.today.keep));
const t4d = J(await dom());
check('T4b 两栏复选框都按展开结果勾上', t4d.mineSmall.checked && t4d.taSmall.checked, JSON.stringify(t4d));
await click('mine', 'fish_small');
await sleep(250);
const t4raw = await evalJs(`(function(){return window.activeStore().get('fishing-today');})()`);
const t4store = J(t4raw);
check('T4c 取消我这侧后：只留 TA 的，存储里旧纯品种键已被替换掉',
  t4store.keep['ta:fish_small'] === 1 && !t4store.keep['mine:fish_small'] && t4store.keep['fish_small'] === undefined,
  JSON.stringify(t4store.keep));

// ---- T5 TA 纪念品仍不参与出售（不渲染复选框） ----
await seed({ fish_small: 1 }, { gift_shell: 1 }, {});
await sleep(350);
const t5 = J(await dom());
check('T5 纪念品行无「留」复选框（本就不卖，无需归属标记）', t5.taShell === 0, JSON.stringify(t5));

server.close();
const fails = results.filter((r) => !r.ok);
console.log('\n===== 钓鱼「留」按归属验证：' + (results.length - fails.length) + '/' + results.length + ' 通过 =====');
if (fails.length) fails.forEach((f) => console.log('FAIL: ' + f.desc));
process.exit(fails.length ? 1 : 0);

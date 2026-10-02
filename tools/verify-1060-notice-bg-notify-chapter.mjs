// ===== 验证 #1060：开屏公告末章「关于后台通知相关设置（怎么开、收不到怎么办）」=====
// 用户直派：「关于后台通知相关设置也放在公告里，放在公告的最后新增一个目录。」
// 两份权威源同步（硬规则）：在线 src/pwa/notice.json（sections 末条，渲染走 textContent＝纯文本）
//   ＋离线兜底 src/template.html（.splash-sec-wrap 末个块，可用 <b>）；开屏「目录（N 章）」由
//   clock.js 按 .splash-sec 自动计数，新增章节应自动 +1。
// 断言：S 两份源各含该章且在最后；P 产物（index.html / 根 notice.json）；B 无头真实渲染
//   （末章标题、6 条要点、目录计数包含本章、进入流程不受影响）。
// 用法：node tools/verify-1060-notice-bg-notify-chapter.mjs [--root=<已构建副本目录>]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize((process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1] || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? ' | ' + x : '')); } };

const H = '关于后台通知相关设置（怎么开、收不到怎么办）';
const tpl = read('src/template.html');
const json = read('src/pwa/notice.json');
const prodHtml = read('index.html');
const prodJson = read('notice.json');

// ---- S/P 静态 ----
ok(tpl.includes(H + '</p>'), 'S1 离线兜底（template.html）含该章标题（#1502 起目录统一编号，判据去前导「>」＝对「N、」前缀不敏感）');
const tplBlocks = tpl.split('class="splash-sec-wrap"');
ok(tplBlocks[tplBlocks.length - 1].includes(H), 'S2 该章是公告的最后一个章节块（用户要求放最后）');
const tplChunk = tplBlocks[tplBlocks.length - 1].split('class="splash-bullet"').length - 1;
ok(tplChunk >= 6, 'S3 离线兜底 6 条要点齐（实为 ' + tplChunk + ' 条）');
let J = null;
try { J = JSON.parse(json); } catch (e) {}
ok(!!J && String(J.sections[J.sections.length - 1].h).replace(/^\d+、/, '') === H, 'S4 在线权威源 notice.json 的 sections 末条＝该章（#1502 起剥编号前缀再比）');
ok(!!J && (J.sections[J.sections.length - 1].p || []).length >= 6, 'S5 在线源要点数 ≥6（实为 ' + (J ? (J.sections[J.sections.length - 1].p || []).length : '-') + '）');
ok(!json.includes('<b>'), 'S6 在线源保持纯文本（渲染走 textContent，写 <b> 会显示成字面量）');
ok(prodHtml.includes(H), 'P1 产物 index.html 含该章（离线兜底已构建）');
ok(prodJson.includes(H), 'P2 产物根 notice.json 含该章（在线权威源已构建）');

// ---- B 行为：真实渲染 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（CHROME_PATH）'); process.exit(1); }
const port = 11900 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(tmpdir(), 'mochi-1060-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 160); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url });
await sleep(3500);
for (let i = 0; i < 50; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);

const seen = await ev(`(function(){
  var seps=[].slice.call(document.querySelectorAll('#splash .splash-sec'));
  var last=seps.length?seps[seps.length-1].textContent.trim():'';
  var lastWrap=seps.length?seps[seps.length-1].closest('.splash-sec-wrap'):null;
  var bullets=lastWrap?lastWrap.querySelectorAll('.splash-bullet').length:0;
  var toc=[].slice.call(document.querySelectorAll('#splash *')).map(function(n){return (n.textContent||'')}).filter(function(t){return /^目录（\\d+ 章）$/.test(t.trim())});
  return JSON.stringify({seps:seps.length,last:last,bullets:bullets,toc:toc[0]||''});
})()`);
const S = (() => { try { return JSON.parse(seen || '{}'); } catch (e) { return {}; } })();
ok(String(S.last).replace(/^\d+、/, '') === H, 'B1 开屏渲染出的最后一个章节就是本章（#1502 起剥编号前缀再比）', 'last=' + String(S.last).slice(0, 40));
ok(Number(S.bullets) >= 6, 'B2 本章 6 条要点渲染出来（实为 ' + S.bullets + ' 条）');
const nToc = Number((String(S.toc).match(/(\d+)/) || [])[1] || 0);
ok(nToc > 0 && nToc >= Number(S.seps), 'B3 「目录（N 章）」计数包含本章（章数 ' + S.seps + ' / 目录显示 ' + nToc + '）', S.toc);
await ev("(function(){var w=document.querySelector('.splash-scroll')||document.querySelector('.splash-box');if(w)w.scrollTop=999999;return true;})()");
await sleep(300);
await ev("(function(){var b=[].slice.call(document.querySelectorAll('#splash button,#splash [role=button]')).filter(function(x){return /我已阅读/.test(x.textContent||'')})[0];if(b)b.click();return true;})()");
await sleep(500);
const entered = await ev("(function(){var m=document.getElementById('splash-mandatory');if(m&&!m.hidden){return 'mandatory-open';}var e=document.getElementById('splash-enter');return e&&!e.hidden?'enter-ok':'?';})()");
ok(entered === 'mandatory-open' || entered === 'enter-ok', 'B4 进入流程不受影响（滑到底→我已阅读→强制公告）', String(entered));
ok(Number(await ev('(window.__jsErrors||[]).length')) === 0, 'Z1 全程零 JS 异常');

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #1060 开屏公告末章验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);

// ===== #571 字卡回复延迟遥测（设定值+实测落地耗时进诊断） =====
// 用户报障（2026-09-16，iPhone 14 Pro Safari，明说其他 iOS 机型也有）：
//   「字卡延迟反应卡顿5、6秒，昨天质检了一下也只优化了几秒，还是有3、4秒卡顿延迟反应」
// 现场诊断（v3.26.712）：63fps/无长任务/最近错误无/字卡库仅 11KB——回复等待全部来自
//   chat.js scheduleReply 的「回复速度」设定随机（默认 rs-min=1~rs-max=40 秒）。
// 本批只加遥测（零行为改动）：诊断【数据】节新增 回复时间=设定值 / 回复实测=最近落地耗时 /
//   无回应概率rn——下次报障实测≈设定＝「设定即此延迟」，实测≫设定＝回复链真有额外等待。
// 断言（修前产物 S/B 全红＝现场回盲；本脚本对现行产物应全绿）：
//   S1 诊断含 回复时间= 设定值；S2 诊断含 回复实测=（初始无记录）；S3 诊断含 无回应概率rn=
//   B1 发送触发的回复链：挂起起点→来卡落地耗时被记录（≈挂起时长）且起点用后即清
//   B2 无挂起起点时的普通来消息不再新增实测记录
//   B3 记录后诊断「回复实测=」带出秒值
//   Z 全程零未捕获 JS 错误
// 用法：node tools/verify-reply-latency-diag.mjs（需先 node build.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-rld-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
const jsErrors = [];
await cdp('Runtime.evaluate', { expression: "window.__jsErrors = window.__jsErrors || []; true", returnByValue: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(600);

console.log('--- S 组：诊断现场字段 ---');
{
  const diag = String(await evalJs('window.__replyPoolDiag ? String(window.__replyPoolDiag()) : ""') || '');
  check('S1 诊断含「回复时间=」设定值（默认 1~40s）', /回复时间=\d+(\.\d+)?~\d+(\.\d+)?s/.test(diag), diag.slice(diag.indexOf('回复时间'), diag.indexOf('回复时间') + 24));
  check('S2 诊断含「回复实测=」（初始无记录也应出字段）', /回复实测=(无记录|[\d.]+s)/.test(diag), diag.slice(diag.indexOf('回复实测'), diag.indexOf('回复实测') + 26));
  check('S3 诊断含「无回应概率rn=」', /无回应概率rn=\d+%/.test(diag), 'rn段=' + (diag.match(/无回应概率rn=[^/]+/) || [''])[0].trim());
}

console.log('--- B 组：回复链实测 ---');
{
  // 模拟 scheduleReply 的挂起起点（真机链路由 scheduleReply 自动挂；这里直驱 addRec 侧断言）
  await evalJs('window.__replyWaitT0 = Date.now() - 5200; true');
  const n0 = Number(await evalJs('(window.__replyLatLog || []).length') || 0);
  await evalJs("window.chatAddIn('遥测延迟测试卡A', { silent: true, enter: false }); true");
  await sleep(400);
  const log = (await evalJs('JSON.stringify(window.__replyLatLog || [])') || '[]');
  const arr = JSON.parse(log);
  const last = arr.length ? arr[arr.length - 1] : NaN;
  check('B1 发送触发的回复链落地耗时被记录（≈挂起 5200ms±600）', arr.length > n0 && Math.abs(last - 5200) <= 600, 'last=' + last + 'ms log=' + log);
  check('B2 起点用后即清（下一条普通来消息不再计）', await evalJs('window.__replyWaitT0 === null || window.__replyWaitT0 === undefined'));
  const n1 = arr.length;
  await evalJs("window.chatAddIn('遥测延迟测试卡B', { silent: true, enter: false }); true");
  await sleep(400);
  const n2 = Number(await evalJs('(window.__replyLatLog || []).length') || 0);
  check('B3 无挂起起点的来消息不新增实测记录', n2 === n1, 'n1=' + n1 + ' n2=' + n2);
  const diag = String(await evalJs('String(window.__replyPoolDiag())') || '');
  check('B4 诊断「回复实测=」带出秒值', /回复实测=[\d.]+s/.test(diag), (diag.match(/回复实测=[^/]+/) || [''])[0].trim());
}

console.log('--- Z 组：零未捕获错误 ---');
{
  const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
  let errArr = [];
  try { errArr = JSON.parse(errs || '[]'); } catch (e) {}
  check('Z1 无未捕获 JS 错误', errArr.length === 0, 'n=' + errArr.length);
}

await chrome.kill();
const fail = results.filter(r => !r.ok).length;
console.log('== 结果：' + (results.length - fail) + '/' + results.length + (fail ? '  FAIL=' + fail : '  全绿'));
process.exit(fail ? 1 : 0);
